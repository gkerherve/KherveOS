"""KherveLAB: booking the instruments of one lab, as a KherveOS server module.

A port of the desktop KherveLAB (../KherveLAB, khervelab/logic.py): the same
instruments, booking periods, sessions, approval modes, rates and rules, on
the KherveOS accounts. Not ported: reports and exports beyond iCal, PPMS
import, the MCP server and the lab's own accounts (KherveOS accounts are used).

Times are lab-local wall clock strings, 'YYYY-MM-DDTHH:MM', in the lab's time
zone (setting `timezone`); billing hours count real elapsed time.

Tables (all prefixed lab_, next to the OS's own users/sessions)
  lab_settings        key/value: lab_name, currency, timezone, categories,
                      account_approval, show_names
  lab_members         a KherveOS user's place in the lab: role (user,
                      superuser, admin), status (pending, active, disabled),
                      rate category and group. Made the first time a user
                      opens the lab (or the manager lists the users).
  lab_instruments     free-time periods (daytime, evening, weekend), slot
                      lengths, shortest/longest, days ahead, approval mode
  lab_sessions        fixed sessions of a 'sessions' instrument, and
  lab_session_prices  their fixed price per rate category
  lab_rates           hourly rate per instrument and category
  lab_trained         who is trained on what ('trained' approval)
  lab_bookings        the bookings; the rate/price in force is stored with each
  lab_issues          reported problems and out-of-order periods

Roles: the lab manager ('admin') is the user(s) named in the environment
variable KHERVELAB_ADMINS (comma separated usernames) or, when it is not set,
the first account on the server. The manager can make others managers or
super users (who book for anyone, with that person's rules).

Live events (realtime.py), to every lab member:
  lab.changed   {what: 'bookings' | 'instruments' | 'members' | 'settings' | 'issues',
                 instrument_id?}
and to the owner when someone else acts on their booking:
  lab.booking   {action: 'approved' | 'rejected' | 'cancelled' | 'moved' | 'reassigned' | 'booked',
                 booking, by}
"""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import db
from .auth import User, current_user
from .realtime import hub

router = APIRouter(prefix="/api/lab", tags=["lab"])

FMT = "%Y-%m-%dT%H:%M"
MAX_RANGE_DAYS = 62
MAX_PURPOSE = 500

db.register_schema(
    """
    CREATE TABLE IF NOT EXISTS lab_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lab_members (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superuser', 'admin')),
        status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'disabled')),
        category   TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT '',
        created    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lab_instruments (
        id             INTEGER PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        location       TEXT NOT NULL DEFAULT '',
        colour         TEXT NOT NULL DEFAULT '#22b357',
        active         INTEGER NOT NULL DEFAULT 1,
        approval       TEXT NOT NULL DEFAULT 'manual' CHECK (approval IN ('auto', 'trained', 'manual')),
        booking_mode   TEXT NOT NULL DEFAULT 'free' CHECK (booking_mode IN ('free', 'sessions')),
        slot_minutes   INTEGER NOT NULL DEFAULT 30,
        min_minutes    INTEGER NOT NULL DEFAULT 30,
        max_minutes    INTEGER NOT NULL DEFAULT 480,
        max_days_ahead INTEGER NOT NULL DEFAULT 60,
        open_time      TEXT NOT NULL DEFAULT '08:00',
        close_time     TEXT NOT NULL DEFAULT '20:00',
        evening_mode   TEXT NOT NULL DEFAULT 'closed',
        evening_start  TEXT NOT NULL DEFAULT '17:00',
        evening_end    TEXT NOT NULL DEFAULT '08:00',
        evening_slot   INTEGER NOT NULL DEFAULT 60,
        weekend_mode   TEXT NOT NULL DEFAULT 'closed',
        weekend_start  TEXT NOT NULL DEFAULT '08:00',
        weekend_end    TEXT NOT NULL DEFAULT '20:00',
        weekend_slot   INTEGER NOT NULL DEFAULT 60,
        weekend_span   TEXT NOT NULL DEFAULT 'daily'
    );
    CREATE TABLE IF NOT EXISTS lab_sessions (
        id            INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        start_time    TEXT NOT NULL,
        end_time      TEXT NOT NULL,
        days          TEXT NOT NULL DEFAULT '01234',
        sort          INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS lab_session_prices (
        session_id INTEGER NOT NULL REFERENCES lab_sessions(id) ON DELETE CASCADE,
        category   TEXT NOT NULL,
        price      REAL NOT NULL,
        PRIMARY KEY (session_id, category)
    );
    CREATE TABLE IF NOT EXISTS lab_rates (
        instrument_id INTEGER NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
        category      TEXT NOT NULL,
        rate          REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (instrument_id, category)
    );
    CREATE TABLE IF NOT EXISTS lab_trained (
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        instrument_id INTEGER NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, instrument_id)
    );
    CREATE TABLE IF NOT EXISTS lab_bookings (
        id            INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start         TEXT NOT NULL,
        end           TEXT NOT NULL,
        purpose       TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        rate          REAL NOT NULL DEFAULT 0,
        created       TEXT NOT NULL,
        decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        decided_at    TEXT,
        note          TEXT NOT NULL DEFAULT '',
        session_id    INTEGER REFERENCES lab_sessions(id) ON DELETE SET NULL,
        price         REAL
    );
    CREATE INDEX IF NOT EXISTS lab_bookings_slot ON lab_bookings (instrument_id, start);
    CREATE INDEX IF NOT EXISTS lab_bookings_user ON lab_bookings (user_id, start);
    CREATE TABLE IF NOT EXISTS lab_issues (
        id            INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('problem', 'down')),
        start         TEXT NOT NULL,
        end           TEXT,
        note          TEXT NOT NULL DEFAULT '',
        reported_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lab_issues_instrument ON lab_issues (instrument_id, start);
    """
)

DEFAULT_SETTINGS = {
    "lab_name": "My lab",
    "currency": "£",
    "timezone": "Europe/London",
    "categories": "Internal\nExternal academic\nIndustry",
    # KherveOS accounts already exist, so by default they may book at once;
    # "1" makes new lab members wait for the manager, as on the desktop.
    "account_approval": "0",
    "show_names": "1",
}

ROLE_LABELS = {"user": "User", "superuser": "Super user (books for others)", "admin": "Lab manager"}
APPROVAL_LABELS = {
    "auto": "Approved automatically",
    "trained": "Automatic for trained users, otherwise the lab manager approves",
    "manual": "The lab manager approves every booking",
}
PERIOD_MODES = ("closed", "block", "daytime", "own")
PERIOD_NAMES = {"day": "Daytime", "evening": "Evening", "weekend": "Weekend"}
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# The desktop's starting instruments: name, description, approval, colour, open, close,
# weekend mode, longest booking (minutes).
EXAMPLES = [
    ("XPS", "X-ray photoelectron spectroscopy", "trained", "#22b357", "00:00", "24:00", "daytime", 1440),
    ("NAP-XPS", "Near ambient pressure XPS, UPS and LEED", "manual", "#8250df", "08:00", "20:00", "closed", 600),
    ("TGA / DSC", "Thermogravimetric analysis and calorimetry", "trained", "#cf222e", "00:00", "24:00", "daytime", 4320),
    ("Dilatometer", "Thermal expansion and sintering", "trained", "#e16f24", "00:00", "24:00", "daytime", 4320),
    ("BET", "Gas sorption surface area and porosity", "auto", "#c9a227", "00:00", "24:00", "daytime", 4320),
    ("Glovebox", "Argon glovebox for air-sensitive samples", "auto", "#57606a", "08:00", "20:00", "closed", 480),
]


class BookingError(ValueError):
    pass


# ------------------------------------------------------------------ settings and time

def setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM lab_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else DEFAULT_SETTINGS.get(key, "")


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO lab_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def categories(conn: sqlite3.Connection) -> list[str]:
    return [c.strip() for c in setting(conn, "categories").splitlines() if c.strip()]


def tz(conn: sqlite3.Connection) -> ZoneInfo:
    try:
        return ZoneInfo(setting(conn, "timezone"))
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def now_local(conn: sqlite3.Connection) -> datetime:
    """The lab's wall clock, to the minute (tests replace this)."""
    return datetime.now(tz(conn)).replace(tzinfo=None, second=0, microsecond=0)


def parse(text: str) -> datetime:
    """'2026-10-07T09:00' (also with seconds, a space or an offset) as lab-local naive."""
    t = str(text).strip().replace(" ", "T")
    dt = datetime.fromisoformat(t)
    return dt.replace(tzinfo=None, second=0, microsecond=0)


def fmt(dt: datetime) -> str:
    return dt.strftime(FMT)


def fmt_duration(minutes: float) -> str:
    """30 min, 4.5 h, 24 h, 1 h 10 min."""
    minutes = int(round(minutes))
    if minutes < 60:
        return f"{minutes} min"
    h, m = divmod(minutes, 60)
    if m == 0:
        return f"{h} h"
    if m in (15, 30, 45):
        return f"{minutes / 60:g} h"
    return f"{h} h {m} min"


def minutes_of(hhmm: str) -> int:
    h, m = hhmm.strip().split(":")
    return int(h) * 60 + int(m)


def hours(conn: sqlite3.Connection, start: datetime, end: datetime) -> float:
    """Real elapsed hours: a booking across a clock change is billed for the time that passed."""
    z = tz(conn)
    s = start.replace(tzinfo=z).astimezone(timezone.utc)
    e = end.replace(tzinfo=z).astimezone(timezone.utc)
    return max(0.0, (e - s).total_seconds() / 3600)


# ------------------------------------------------------------------ members and roles

def configured_admins() -> set[str]:
    raw = os.environ.get("KHERVELAB_ADMINS", "")
    return {n.strip().lower() for n in re.split(r"[,\s]+", raw) if n.strip()}


def _forced_admin(conn: sqlite3.Connection, user_id: int, username: str) -> bool:
    """The lab manager by configuration: KHERVELAB_ADMINS, or else the first account."""
    admins = configured_admins()
    if admins:
        return username.lower() in admins
    return conn.execute("SELECT MIN(id) FROM users").fetchone()[0] == user_id


def _member_dict(row: sqlite3.Row, locked: bool) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["display_name"],
        "role": row["role"],
        "status": row["status"],
        "category": row["category"],
        "group_name": row["group_name"],
        "created": row["created"],
        "locked": locked,  # a manager by configuration: role and status cannot be changed here
    }


_MEMBER_SQL = """SELECT u.id, u.username, u.display_name, m.role, m.status, m.category, m.group_name, m.created
                 FROM users u JOIN lab_members m ON m.user_id = u.id"""


def member(conn: sqlite3.Connection, user_id: int) -> dict | None:
    """A user's place in the lab, made the first time it is needed."""
    u = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if u is None:
        return None
    forced = _forced_admin(conn, u["id"], u["username"])
    row = conn.execute(_MEMBER_SQL + " WHERE u.id = ?", (user_id,)).fetchone()
    if row is None:
        cats = categories(conn)
        status = "active" if forced or setting(conn, "account_approval") != "1" else "pending"
        conn.execute(
            "INSERT OR IGNORE INTO lab_members (user_id, role, status, category, created) VALUES (?, ?, ?, ?, ?)",
            (user_id, "admin" if forced else "user", status, cats[0] if cats else "", fmt(now_local(conn))),
        )
        row = conn.execute(_MEMBER_SQL + " WHERE u.id = ?", (user_id,)).fetchone()
    elif forced and (row["role"] != "admin" or row["status"] != "active"):
        conn.execute("UPDATE lab_members SET role = 'admin', status = 'active' WHERE user_id = ?", (user_id,))
        row = conn.execute(_MEMBER_SQL + " WHERE u.id = ?", (user_id,)).fetchone()
    return _member_dict(row, forced)


def all_members(conn: sqlite3.Connection) -> list[dict]:
    """Every account on the server, each with its lab place (made if missing)."""
    ids = [r[0] for r in conn.execute("SELECT id FROM users ORDER BY display_name COLLATE NOCASE, id")]
    return [m for m in (member(conn, i) for i in ids) if m is not None]


def acts_for_others(u: dict | None) -> bool:
    return u is not None and u["role"] in ("admin", "superuser")


def is_admin(u: dict | None) -> bool:
    return u is not None and u["role"] == "admin"


def is_trained(conn: sqlite3.Connection, user_id: int, instrument_id: int) -> bool:
    return (
        conn.execute("SELECT 1 FROM lab_trained WHERE user_id = ? AND instrument_id = ?", (user_id, instrument_id)).fetchone()
        is not None
    )


# ------------------------------------------------------------------ rates and issues

def rate_for(conn: sqlite3.Connection, instrument_id: int, category: str) -> float:
    r = conn.execute("SELECT rate FROM lab_rates WHERE instrument_id = ? AND category = ?", (instrument_id, category)).fetchone()
    return float(r["rate"]) if r else 0.0


def rates(conn: sqlite3.Connection, instrument_id: int) -> dict[str, float]:
    return {c: rate_for(conn, instrument_id, c) for c in categories(conn)}


def issues(conn: sqlite3.Connection, instrument_id: int, start: datetime, end: datetime) -> list[sqlite3.Row]:
    """Issues overlapping [start, end); an open-ended issue runs on until fixed."""
    return conn.execute(
        "SELECT * FROM lab_issues WHERE instrument_id = ? AND start < ? AND (end IS NULL OR end > ?) ORDER BY start",
        (instrument_id, fmt(end), fmt(start)),
    ).fetchall()


def issue_state(conn: sqlite3.Connection, instrument_id: int, start: datetime, end: datetime) -> str:
    kinds = {r["kind"] for r in issues(conn, instrument_id, start, end)}
    return "down" if "down" in kinds else "problem" if "problem" in kinds else "ok"


def current_issue(conn: sqlite3.Connection, instrument_id: int) -> sqlite3.Row | None:
    now = now_local(conn)
    rows = issues(conn, instrument_id, now, now + timedelta(minutes=1))
    return next((r for r in rows if r["kind"] == "down"), rows[0] if rows else None)


# ------------------------------------------------------------------ periods (free time)

@dataclass(frozen=True)
class Period:
    kind: str  # day, evening, weekend
    start: datetime
    end: datetime
    slot: int | None  # minutes; None = the whole period is one booking

    @property
    def label(self) -> str:
        return PERIOD_NAMES[self.kind]


def _span(day: date, start_hhmm: str, end_hhmm: str) -> tuple[datetime, datetime]:
    """A daily window; an end at or before the start is the next day."""
    base = datetime(day.year, day.month, day.day)
    s, e = minutes_of(start_hhmm), minutes_of(end_hhmm)
    if e <= s:
        e += 1440
    return base + timedelta(minutes=s), base + timedelta(minutes=e)


def _slot_for(inst, kind: str) -> int | None:
    mode = inst[f"{kind}_mode"]
    if mode == "block":
        return None
    if mode == "own":
        return inst[f"{kind}_slot"]
    return inst["slot_minutes"]


def periods(inst, start: datetime, end: datetime) -> list[Period]:
    """The bookable windows of a free-time instrument overlapping [start, end):
    the daytime on weekdays, the evening (weekdays) and the weekend, each in
    its own way. A window overlapping an earlier one is trimmed."""
    out: list[Period] = []
    day = start.date() - timedelta(days=2)  # a whole weekend can start two days back
    while day <= end.date():
        if day.weekday() < 5:
            s0, s1 = _span(day, inst["open_time"], inst["close_time"])
            out.append(Period("day", s0, s1, inst["slot_minutes"]))
            if inst["evening_mode"] != "closed":
                s0, s1 = _span(day, inst["evening_start"], inst["evening_end"])
                out.append(Period("evening", s0, s1, _slot_for(inst, "evening")))
        elif inst["weekend_mode"] != "closed":
            if inst["weekend_span"] == "whole":
                if day.weekday() == 5:  # Saturday start -> Monday end
                    s0 = _span(day, inst["weekend_start"], inst["weekend_start"])[0]
                    monday = day + timedelta(days=2)
                    s1 = datetime(monday.year, monday.month, monday.day) + timedelta(minutes=minutes_of(inst["weekend_end"]))
                    out.append(Period("weekend", s0, s1, _slot_for(inst, "weekend")))
            else:
                s0, s1 = _span(day, inst["weekend_start"], inst["weekend_end"])
                out.append(Period("weekend", s0, s1, _slot_for(inst, "weekend")))
        day += timedelta(days=1)
    out.sort(key=lambda p: p.start)
    trimmed: list[Period] = []
    for p in out:
        if trimmed and p.start < trimmed[-1].end:
            p = Period(p.kind, trimmed[-1].end, p.end, p.slot)
        if p.end > p.start:
            trimmed.append(p)
    return [p for p in trimmed if p.start < end and p.end > start]


def _on_grid(p: Period, t: datetime) -> bool:
    if t in (p.start, p.end):
        return True
    if p.slot is None:
        return False
    return int((t - p.start).total_seconds() // 60) % p.slot == 0


def describe_periods(inst) -> str:
    def window(s: str, e: str) -> str:
        return f"{s}–{e}" + (" (next day)" if minutes_of(e) <= minutes_of(s) else "")

    around = inst["open_time"] == "00:00" and inst["close_time"] in ("24:00", "23:59")
    parts = [
        ("Weekdays around the clock" if around else f"Daytime {window(inst['open_time'], inst['close_time'])}")
        + f" in {fmt_duration(inst['slot_minutes'])} slots"
    ]
    for kind in ("evening", "weekend"):
        mode = inst[f"{kind}_mode"]
        if mode == "closed":
            parts.append(f"{PERIOD_NAMES[kind]} closed")
            continue
        how = "as one booking" if mode == "block" else f"in {fmt_duration(_slot_for(inst, kind))} slots"
        if kind == "weekend" and inst["weekend_span"] == "whole":
            parts.append(f"Weekend Sat {inst['weekend_start']} → Mon {inst['weekend_end']} {how}")
            continue
        parts.append(
            f"{PERIOD_NAMES[kind]} {window(inst[kind + '_start'], inst[kind + '_end'])}"
            + (" each day" if kind == "weekend" else "")
            + f" {how}"
        )
    return " · ".join(parts)


def period_errors(inst, start: datetime, end: datetime) -> list[str]:
    """A free-time booking lies in bookable periods with no gap, starts and ends
    on a slot of its period and takes a one-booking period whole. Shortest and
    longest apply to daytime bookings."""
    ps = periods(inst, start, end)
    first = next((p for p in ps if p.start <= start < p.end), None)
    if first is None:
        if start.weekday() >= 5 and inst["weekend_mode"] == "closed":
            return [f"{inst['name']} cannot be booked at weekends"]
        return [f"{inst['name']} is closed at {start:%a %H:%M} ({describe_periods(inst)})"]
    chain = [first]
    while chain[-1].end < end:
        nxt = next((p for p in ps if p.start == chain[-1].end), None)
        if nxt is None:
            return [
                f"{inst['name']} is closed from {chain[-1].end:%a %H:%M}, so the booking must end by then "
                f"({describe_periods(inst)})"
            ]
        chain.append(nxt)
    last = chain[-1]
    errors = []
    minutes = (end - start).total_seconds() / 60
    slot_set = {p.slot for p in chain}
    # a run through slotted periods of one slot length only needs whole slots
    whole_run = len(chain) > 1 and len(slot_set) == 1 and None not in slot_set and minutes % first.slot == 0
    for p, t, what in ((first, start, "start"), (last, end, "end")):
        if what == "end" and whole_run:
            continue
        if not _on_grid(p, t):
            if p.slot is None:
                errors.append(f"the {p.label.lower()} ({p.start:%H:%M}–{p.end:%H:%M}) is booked as one block")
            else:
                errors.append(
                    f"the {what} must fall on a {fmt_duration(p.slot)} slot of the {p.label.lower()}, "
                    f"counted from {p.start:%H:%M}"
                )
    if all(p.kind == "day" for p in chain):
        if minutes < inst["min_minutes"]:
            errors.append(f"the shortest booking is {fmt_duration(inst['min_minutes'])}")
        if minutes > inst["max_minutes"]:
            errors.append(f"the longest booking is {fmt_duration(inst['max_minutes'])}")
    return errors


def _period_at(inst, t: datetime) -> Period | None:
    return next((p for p in periods(inst, t, t + timedelta(minutes=1)) if p.start <= t < p.end), None)


def snap_start(inst, t: datetime) -> datetime:
    """Where a press at t starts a booking: its slot, or the whole block."""
    p = _period_at(inst, t)
    if p is None:
        return t
    if p.slot is None:
        return p.start
    steps = int((t - p.start).total_seconds() // 60) // p.slot
    return p.start + timedelta(minutes=steps * p.slot)


def snap_nearest_start(inst, t: datetime) -> datetime:
    """Where a booking dropped at t starts: the nearest slot start of its period."""
    p = _period_at(inst, t)
    if p is None:
        return t
    if p.slot is None:
        return p.start
    steps = round((t - p.start).total_seconds() / 60 / p.slot)
    s = p.start + timedelta(minutes=steps * p.slot)
    return s if s < p.end else snap_start(inst, t)


def snap_end(inst, start: datetime, t: datetime) -> datetime:
    """The end for a drag from start to t: the nearest slot boundary (at least one slot), or the block's end."""
    t = max(t, start + timedelta(minutes=1))
    p = next((p for p in periods(inst, t - timedelta(minutes=1), t) if p.start < t <= p.end), None)
    if p is None:
        return t
    if p.slot is None:
        return p.end
    origin = max(p.start, start) if p.start <= start < p.end else p.start
    steps = max(1, round((t - origin).total_seconds() / 60 / p.slot))
    return min(p.end, origin + timedelta(minutes=steps * p.slot))


# ------------------------------------------------------------------ sessions

@dataclass(frozen=True)
class Occurrence:
    session_id: int
    name: str
    start: datetime
    end: datetime


def sessions(conn: sqlite3.Connection, instrument_id: int) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM lab_sessions WHERE instrument_id = ? ORDER BY sort, start_time", (instrument_id,)).fetchall()


def session_hours(start_time: str, end_time: str) -> float:
    s, e = minutes_of(start_time), minutes_of(end_time)
    return ((e - s) % 1440 or 1440) / 60


def days_label(days: str) -> str:
    if days == "0123456":
        return "every day"
    if days == "01234":
        return "weekdays"
    if days == "56":
        return "weekends"
    return ", ".join(DAY_NAMES[int(d)] for d in days)


def occurrences(conn: sqlite3.Connection, instrument_id: int, start: datetime, end: datetime) -> list[Occurrence]:
    """Session occurrences overlapping [start, end). A session belongs to the day it starts on."""
    out = []
    rows = sessions(conn, instrument_id)
    day = start.date() - timedelta(days=1)
    while day <= end.date():
        for s in rows:
            if str(day.weekday()) not in s["days"]:
                continue
            s0 = datetime.combine(day, datetime.min.time()) + timedelta(minutes=minutes_of(s["start_time"]))
            s1 = s0 + timedelta(hours=session_hours(s["start_time"], s["end_time"]))
            if s0 < end and s1 > start:
                out.append(Occurrence(s["id"], s["name"], s0, s1))
        day += timedelta(days=1)
    return sorted(out, key=lambda o: o.start)


def matching_session(conn: sqlite3.Connection, instrument_id: int, start: datetime, end: datetime) -> Occurrence | None:
    return next((o for o in occurrences(conn, instrument_id, start, end) if o.start == start and o.end == end), None)


def session_price(conn: sqlite3.Connection, session_id: int, category: str) -> float | None:
    r = conn.execute("SELECT price FROM lab_session_prices WHERE session_id = ? AND category = ?", (session_id, category)).fetchone()
    return float(r["price"]) if r else None


def slots(conn: sqlite3.Connection, inst, start: datetime, end: datetime) -> list[tuple[datetime, datetime, str]]:
    """Every bookable slot overlapping [start, end): session occurrences, or each
    free-time period cut into its slots (a one-booking period is one slot)."""
    if inst["booking_mode"] == "sessions":
        return [(o.start, o.end, o.name) for o in occurrences(conn, inst["id"], start, end)]
    out = []
    for p in periods(inst, start, end):
        if p.slot is None:
            out.append((p.start, p.end, p.label))
            continue
        t = p.start
        while t < p.end and t < end:
            t1 = min(p.end, t + timedelta(minutes=p.slot))
            if t1 > start:
                out.append((t, t1, p.label))
            t = t1
    return out


# ------------------------------------------------------------------ the rules

def check(conn: sqlite3.Connection, inst, user: dict, start: datetime, end: datetime, exclude: int | None = None) -> list[str]:
    """Every reason the slot cannot be booked by `user`; empty when it can.
    The lab manager is held only to the hard rules (no clash, end after start)."""
    if end <= start:
        return ["the end must be after the start"]
    errors = []
    admin = is_admin(user)
    now = now_local(conn)
    if not inst["active"]:
        errors.append(f"{inst['name']} is not available for booking")
    if not admin:
        for r in issues(conn, inst["id"], start, end):
            if r["kind"] == "down":
                until = f" until {r['end'].replace('T', ' ')}" if r["end"] else " until fixed"
                errors.append(f"{inst['name']} is out of order{until}" + (f": {r['note']}" if r["note"] else ""))
                break
        if start < now:
            errors.append("the start is in the past")
        if start > now + timedelta(days=inst["max_days_ahead"]):
            errors.append(f"bookings open {inst['max_days_ahead']} days ahead")
        if inst["booking_mode"] == "sessions":
            if matching_session(conn, inst["id"], start, end) is None:
                errors.append(f"{inst['name']} is booked by session; choose one of its sessions")
        else:
            errors += period_errors(inst, start, end)
    clash = conn.execute(
        """SELECT b.start, b.end FROM lab_bookings b WHERE b.instrument_id = ? AND b.status IN ('pending', 'approved')
           AND b.start < ? AND b.end > ? AND b.id != ? LIMIT 1""",
        (inst["id"], fmt(end), fmt(start), exclude or 0),
    ).fetchone()
    if clash:
        errors.append(f"the slot overlaps a booking from {clash['start'][11:]} to {clash['end'][11:]} on {clash['start'][:10]}")
    return errors


def instant_for(conn: sqlite3.Connection, inst, user: dict, actor: dict | None = None) -> bool:
    actor = actor or user
    return is_admin(actor) or inst["approval"] == "auto" or (inst["approval"] == "trained" and is_trained(conn, user["id"], inst["id"]))


def _session_and_price(conn, inst, start: datetime, end: datetime, category: str) -> tuple[int | None, float | None]:
    if inst["booking_mode"] != "sessions":
        return None, None
    occ = matching_session(conn, inst["id"], start, end)
    if occ is None:  # the lab manager blocking free-form time
        return None, None
    return occ.session_id, session_price(conn, occ.session_id, category)


def _instrument(conn: sqlite3.Connection, instrument_id: int) -> sqlite3.Row:
    inst = conn.execute("SELECT * FROM lab_instruments WHERE id = ?", (instrument_id,)).fetchone()
    if inst is None:
        raise HTTPException(404, "Instrument not found.")
    return inst


def _begin(conn: sqlite3.Connection) -> None:
    """One writer at a time: the clash check and the insert cannot interleave."""
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")


def book_one(conn, inst, owner: dict, actor: dict, start: datetime, end: datetime, purpose: str) -> tuple[int, str]:
    """Insert one booking (inside the caller's BEGIN IMMEDIATE); raises BookingError."""
    if owner["status"] != "active":
        raise BookingError(
            "your lab account is not active yet" if owner["id"] == actor["id"] else f"{owner['full_name']}'s lab account is not active"
        )
    if owner["id"] != actor["id"] and not acts_for_others(actor):
        raise BookingError("only the lab manager or a super user can book for someone else")
    # the manager is held to the hard rules only; a super user books exactly as the person would
    rules_for = actor if is_admin(actor) else owner
    errors = check(conn, inst, rules_for, start, end)
    if errors:
        raise BookingError("; ".join(errors))
    status = "approved" if instant_for(conn, inst, owner, actor) else "pending"
    rate = rate_for(conn, inst["id"], owner["category"])
    session_id, price = _session_and_price(conn, inst, start, end, owner["category"])
    stamp = fmt(now_local(conn))
    bid = conn.execute(
        """INSERT INTO lab_bookings (instrument_id, user_id, start, end, purpose, status, rate, created,
           decided_by, decided_at, session_id, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            inst["id"], owner["id"], fmt(start), fmt(end), purpose.strip()[:MAX_PURPOSE], status, rate, stamp,
            actor["id"] if actor["id"] != owner["id"] else None, stamp if status == "approved" else None, session_id, price,
        ),
    ).lastrowid
    return bid, status


def book_range(conn, inst, owner: dict, actor: dict, start: datetime, end: datetime, purpose: str) -> tuple[list[tuple[int, str]], list[str]]:
    """Book every free session of a session instrument in the range (one booking each), or the range itself."""
    if inst["booking_mode"] != "sessions":
        return [book_one(conn, inst, owner, actor, start, end, purpose)], []
    occs = occurrences(conn, inst["id"], start, end)
    if not occs:
        if is_admin(actor):  # the manager blocking free-form time
            return [book_one(conn, inst, owner, actor, start, end, purpose)], []
        raise BookingError(f"no {inst['name']} session falls in that time")
    made, problems = [], []
    for o in occs:
        try:
            made.append(book_one(conn, inst, owner, actor, o.start, o.end, purpose))
        except BookingError as exc:
            problems.append(f"{o.name} {o.start:%a %d %b %H:%M}: {exc}")
    if not made:
        raise BookingError("; ".join(problems))
    return made, problems


def normalise_range(inst, start: datetime, end: datetime) -> tuple[datetime, datetime]:
    """Where a dragged range lands: free time snaps to its slots (a one-booking
    period is taken whole) and is stretched to the shortest daytime booking."""
    if inst["booking_mode"] != "free":
        return start, end
    start = snap_start(inst, start)
    end = snap_end(inst, start, end)
    shortest = start + timedelta(minutes=inst["min_minutes"])
    if end < shortest and period_errors(inst, start, end):
        end = snap_end(inst, start, shortest)
    return start, end


def cost(conn: sqlite3.Connection, b) -> float:
    """A session's fixed price, or the hours actually elapsed at the hourly rate."""
    if b["price"] is not None:
        return round(b["price"], 2)
    return round(hours(conn, parse(b["start"]), parse(b["end"])) * b["rate"], 2)


def quote(conn: sqlite3.Connection, inst, owner: dict, actor: dict, start: datetime, end: datetime) -> dict:
    """What booking [start, end) would mean: the item(s), each one's cost and rule problems, the total."""
    rules_for = actor if is_admin(actor) else owner
    rate = rate_for(conn, inst["id"], owner["category"])
    items = []
    occs = occurrences(conn, inst["id"], start, end) if inst["booking_mode"] == "sessions" else []
    if occs:
        for o in occs:
            price = session_price(conn, o.session_id, owner["category"])
            c = price if price is not None else hours(conn, o.start, o.end) * rate
            items.append({"start": fmt(o.start), "end": fmt(o.end), "label": o.name, "cost": round(c, 2),
                          "errors": check(conn, inst, rules_for, o.start, o.end)})
    else:
        s, e = normalise_range(inst, start, end)
        errors = check(conn, inst, rules_for, s, e)
        if inst["booking_mode"] == "sessions" and not is_admin(actor):
            errors = [f"no {inst['name']} session falls in that time"]
        items.append({"start": fmt(s), "end": fmt(e), "label": "", "cost": round(hours(conn, s, e) * rate, 2), "errors": errors})
    if owner["status"] != "active":
        for i in items:
            i["errors"].insert(0, "the lab account is not active yet")
    ok = [i for i in items if not i["errors"]]
    return {
        "items": items,
        "bookable": bool(ok),
        "currency": setting(conn, "currency"),
        "total": round(sum(i["cost"] for i in ok), 2),
        "instant": instant_for(conn, inst, owner, actor),
        "for": {"id": owner["id"], "full_name": owner["full_name"]},
    }


# ------------------------------------------------------------------ JSON shapes

INSTRUMENT_FIELDS = (
    "name", "description", "location", "colour", "active", "approval", "booking_mode", "slot_minutes", "min_minutes",
    "max_minutes", "max_days_ahead", "open_time", "close_time", "evening_mode", "evening_start", "evening_end",
    "evening_slot", "weekend_mode", "weekend_start", "weekend_end", "weekend_slot", "weekend_span",
)


def _instrument_json(conn: sqlite3.Connection, inst, me: dict) -> dict:
    out = {k: inst[k] for k in ("id", *INSTRUMENT_FIELDS)}
    out["active"] = bool(inst["active"])
    out["rates"] = rates(conn, inst["id"])
    out["my_rate"] = rate_for(conn, inst["id"], me["category"])
    out["instant"] = instant_for(conn, inst, me)
    out["trained_me"] = is_trained(conn, me["id"], inst["id"])
    out["describe"] = describe_periods(inst) if inst["booking_mode"] == "free" else "Booked by fixed sessions"
    out["approval_label"] = APPROVAL_LABELS[inst["approval"]]
    out["sessions"] = [
        {
            "id": s["id"], "name": s["name"], "start_time": s["start_time"], "end_time": s["end_time"], "days": s["days"],
            "days_label": days_label(s["days"]), "hours": session_hours(s["start_time"], s["end_time"]),
            "prices": {
                r["category"]: r["price"]
                for r in conn.execute("SELECT category, price FROM lab_session_prices WHERE session_id = ?", (s["id"],))
            },
        }
        for s in sessions(conn, inst["id"])
    ]
    issue = current_issue(conn, inst["id"])
    out["issue"] = _issue_json(issue) if issue else None
    if is_admin(me):
        out["trained"] = [r[0] for r in conn.execute("SELECT user_id FROM lab_trained WHERE instrument_id = ?", (inst["id"],))]
        out["bookings_count"] = conn.execute("SELECT COUNT(*) FROM lab_bookings WHERE instrument_id = ?", (inst["id"],)).fetchone()[0]
    return out


def _issue_json(r) -> dict:
    return {k: r[k] for k in ("id", "instrument_id", "kind", "start", "end", "note", "reported_by", "created")}


def _booking_json(conn: sqlite3.Connection, b, me: dict, show_names: bool | None = None) -> dict:
    """A booking as `me` may see it: other people's purposes and costs stay private."""
    mine = b["user_id"] == me["id"]
    acting = acts_for_others(me)
    if show_names is None:
        show_names = setting(conn, "show_names") == "1"
    now = fmt(now_local(conn))
    open_ = b["status"] in ("pending", "approved")
    may_change = open_ and (is_admin(me) or ((mine or acting) and b["start"] > now))
    return {
        "id": b["id"],
        "instrument_id": b["instrument_id"],
        "instrument": b["instrument"],
        "colour": b["colour"],
        "user_id": b["user_id"],
        "who": b["full_name"] if (mine or acting or show_names) else "Booked",
        "username": b["username"] if (mine or acting or show_names) else "",
        "start": b["start"],
        "end": b["end"],
        "status": b["status"],
        "mine": mine,
        "purpose": b["purpose"] if (mine or acting) else "",
        "note": b["note"] if (mine or acting) else "",
        "cost": cost(conn, b) if (mine or acting) else None,
        "price_basis": ("session" if b["session_id"] else "fixed") if b["price"] is not None else "hourly",
        "rate": b["rate"] if (mine or acting) else None,
        "session": bool(b["session_id"]),
        "created": b["created"] if (mine or acting) else None,
        "editable": may_change,
        "cancellable": may_change,
        "issue": (lambda s: "" if s == "ok" else s)(issue_state(conn, b["instrument_id"], parse(b["start"]), parse(b["end"]))),
    }


_BOOKING_SQL = """SELECT b.*, u.display_name AS full_name, u.username, i.name AS instrument, i.colour
                  FROM lab_bookings b JOIN users u ON u.id = b.user_id JOIN lab_instruments i ON i.id = b.instrument_id"""


def _booking_row(conn: sqlite3.Connection, booking_id: int) -> sqlite3.Row:
    b = conn.execute(_BOOKING_SQL + " WHERE b.id = ?", (booking_id,)).fetchone()
    if b is None:
        raise HTTPException(404, "Booking not found.")
    return b


# ------------------------------------------------------------------ live events

def _publish(event: dict) -> None:
    with db.connect() as conn:
        ids = [r[0] for r in conn.execute("SELECT user_id FROM lab_members")]
    if ids:
        hub.publish(ids, event)


def _changed(what: str, instrument_id: int | None = None) -> None:
    ev = {"type": "lab.changed", "what": what}
    if instrument_id is not None:
        ev["instrument_id"] = instrument_id
    _publish(ev)


def _tell_owner(owner_id: int, actor: dict, action: str, booking: dict) -> None:
    if owner_id != actor["id"]:
        hub.publish([owner_id], {"type": "lab.booking", "action": action, "booking": booking,
                                 "by": {"id": actor["id"], "full_name": actor["full_name"]}})


# ------------------------------------------------------------------ request helpers

def _me(conn: sqlite3.Connection, user: User) -> dict:
    m = member(conn, user.id)
    if m is None:
        raise HTTPException(401, "Please sign in.")
    return m


def _require_admin(me: dict) -> None:
    if not is_admin(me):
        raise HTTPException(403, "Only the lab manager can do this.")


def _target(conn: sqlite3.Connection, me: dict, user_id: int | None) -> dict:
    """The person an action is for: yourself, or (manager / super user) someone else."""
    if not user_id or user_id == me["id"]:
        return me
    if not acts_for_others(me):
        raise HTTPException(403, "Only the lab manager or a super user can act for someone else.")
    m = member(conn, user_id)
    if m is None:
        raise HTTPException(404, "There is no such person.")
    return m


def _time(value: str, what: str) -> datetime:
    try:
        return parse(value)
    except (ValueError, TypeError):
        raise HTTPException(400, f"The {what} is not a date and time (YYYY-MM-DDTHH:MM).") from None


def _range(start: str, end: str) -> tuple[datetime, datetime]:
    s, e = _time(start, "start"), _time(end, "end")
    if e <= s:
        raise HTTPException(400, "The end must be after the start.")
    if e - s > timedelta(days=MAX_RANGE_DAYS):
        raise HTTPException(400, f"Ask for at most {MAX_RANGE_DAYS} days at a time.")
    return s, e


# ------------------------------------------------------------------ endpoints: the lab

@router.get("/me")
def get_me(user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        return {
            "member": me,
            "settings": {k: setting(conn, k) for k in DEFAULT_SETTINGS},
            "categories": categories(conn),
            "now": fmt(now_local(conn)),
            "roles": ROLE_LABELS,
        }


class SettingsBody(BaseModel):
    lab_name: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, max_length=8)
    timezone: str | None = Field(default=None, max_length=64)
    categories: list[str] | None = None
    account_approval: bool | None = None
    show_names: bool | None = None


@router.patch("/settings")
def patch_settings(body: SettingsBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        if body.lab_name is not None:
            set_setting(conn, "lab_name", body.lab_name.strip() or "My lab")
        if body.currency is not None:
            set_setting(conn, "currency", body.currency.strip())
        if body.timezone is not None:
            try:
                ZoneInfo(body.timezone.strip())
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(400, f"“{body.timezone}” is not a time zone (e.g. Europe/London).") from None
            set_setting(conn, "timezone", body.timezone.strip())
        if body.categories is not None:
            cats = []
            for c in body.categories:
                c = " ".join(c.split())[:60]
                if c and c not in cats:
                    cats.append(c)
            if not cats:
                raise HTTPException(400, "Keep at least one rate category.")
            set_setting(conn, "categories", "\n".join(cats))
            conn.execute(f"UPDATE lab_members SET category = ? WHERE category NOT IN ({','.join('?' * len(cats))})", (cats[0], *cats))
        if body.account_approval is not None:
            set_setting(conn, "account_approval", "1" if body.account_approval else "0")
        if body.show_names is not None:
            set_setting(conn, "show_names", "1" if body.show_names else "0")
        out = {k: setting(conn, k) for k in DEFAULT_SETTINGS}
    _changed("settings")
    return {"settings": out}


# ------------------------------------------------------------------ instruments

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")
COLOUR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class SessionSpec(BaseModel):
    id: int | None = None
    name: str
    start_time: str
    end_time: str
    days: str = "01234"
    prices: dict[str, float | None] = Field(default_factory=dict)


class InstrumentBody(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=120)
    colour: str | None = None
    active: bool | None = None
    approval: str | None = None
    booking_mode: str | None = None
    slot_minutes: int | None = None
    min_minutes: int | None = None
    max_minutes: int | None = None
    max_days_ahead: int | None = None
    open_time: str | None = None
    close_time: str | None = None
    evening_mode: str | None = None
    evening_start: str | None = None
    evening_end: str | None = None
    evening_slot: int | None = None
    weekend_mode: str | None = None
    weekend_start: str | None = None
    weekend_end: str | None = None
    weekend_slot: int | None = None
    weekend_span: str | None = None
    rates: dict[str, float] | None = None
    sessions: list[SessionSpec] | None = None
    trained: list[int] | None = None


def _clean_instrument(body: InstrumentBody) -> dict:
    """The instrument columns set in `body`, checked."""
    vals = {k: getattr(body, k) for k in INSTRUMENT_FIELDS if getattr(body, k) is not None}
    if "name" in vals:
        vals["name"] = " ".join(vals["name"].split())
        if not vals["name"]:
            raise HTTPException(400, "Give the instrument a name.")
    for k in ("description", "location"):
        if k in vals:
            vals[k] = vals[k].strip()
    if "colour" in vals and not COLOUR_RE.match(vals["colour"]):
        raise HTTPException(400, "The colour is a #rrggbb value.")
    if "active" in vals:
        vals["active"] = 1 if vals["active"] else 0
    choices = {
        "approval": ("auto", "trained", "manual"),
        "booking_mode": ("free", "sessions"),
        "evening_mode": PERIOD_MODES,
        "weekend_mode": PERIOD_MODES,
        "weekend_span": ("daily", "whole"),
    }
    for k, allowed in choices.items():
        if k in vals and vals[k] not in allowed:
            raise HTTPException(400, f"{k} must be one of: {', '.join(allowed)}.")
    for k in ("open_time", "close_time", "evening_start", "evening_end", "weekend_start", "weekend_end"):
        if k in vals and not TIME_RE.match(vals[k]):
            raise HTTPException(400, f"{k.replace('_', ' ')} must be a time like 08:00.")
    if vals.get("open_time") == "24:00":
        raise HTTPException(400, "The daytime cannot open at 24:00.")
    limits = {
        "slot_minutes": (5, 1440, "slot length"),
        "min_minutes": (5, 1440, "shortest booking"),
        "max_minutes": (5, 7 * 1440, "longest booking"),
        "evening_slot": (5, 1440, "evening slot"),
        "weekend_slot": (5, 4320, "weekend slot"),
        "max_days_ahead": (0, 3650, "days ahead"),
    }
    for k, (lo, hi, label) in limits.items():
        if k in vals and not lo <= vals[k] <= hi:
            raise HTTPException(400, f"The {label} must be between {lo} and {hi}.")
    return vals


def _save_extras(conn: sqlite3.Connection, instrument_id: int, body: InstrumentBody) -> None:
    if body.rates is not None:
        conn.execute("DELETE FROM lab_rates WHERE instrument_id = ?", (instrument_id,))
        for cat, rate in body.rates.items():
            conn.execute("INSERT INTO lab_rates (instrument_id, category, rate) VALUES (?, ?, ?)", (instrument_id, cat, max(0.0, float(rate))))
    if body.trained is not None:
        conn.execute("DELETE FROM lab_trained WHERE instrument_id = ?", (instrument_id,))
        for uid in set(body.trained):
            if conn.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone():
                conn.execute("INSERT INTO lab_trained (user_id, instrument_id) VALUES (?, ?)", (uid, instrument_id))
    if body.sessions is not None:
        save_sessions(conn, instrument_id, body.sessions)


def save_sessions(conn: sqlite3.Connection, instrument_id: int, specs: list[SessionSpec]) -> None:
    """Replace an instrument's sessions; kept ids stay (bookings point at them)."""
    for sp in specs:
        if not sp.name.strip():
            raise HTTPException(400, "Every session needs a name.")
        if not sp.days or not set(sp.days) <= set("0123456"):
            raise HTTPException(400, f"Session “{sp.name}” must run on at least one day.")
        for t in (sp.start_time, sp.end_time):
            if not TIME_RE.match(t) or t == "24:00":
                raise HTTPException(400, f"Session “{sp.name}”: {t} is not a time.")
    keep = {sp.id for sp in specs if sp.id}
    for r in sessions(conn, instrument_id):
        if r["id"] not in keep:
            conn.execute("DELETE FROM lab_sessions WHERE id = ?", (r["id"],))
    for n, sp in enumerate(specs):
        days = "".join(sorted(set(sp.days)))
        sid = None
        if sp.id:
            cur = conn.execute(
                "UPDATE lab_sessions SET name = ?, start_time = ?, end_time = ?, days = ?, sort = ? WHERE id = ? AND instrument_id = ?",
                (sp.name.strip(), sp.start_time, sp.end_time, days, n, sp.id, instrument_id),
            )
            sid = sp.id if cur.rowcount else None
        if sid is None:
            sid = conn.execute(
                "INSERT INTO lab_sessions (instrument_id, name, start_time, end_time, days, sort) VALUES (?, ?, ?, ?, ?, ?)",
                (instrument_id, sp.name.strip(), sp.start_time, sp.end_time, days, n),
            ).lastrowid
        conn.execute("DELETE FROM lab_session_prices WHERE session_id = ?", (sid,))
        for cat, price in sp.prices.items():
            if price is not None:
                conn.execute("INSERT INTO lab_session_prices (session_id, category, price) VALUES (?, ?, ?)", (sid, cat, max(0.0, float(price))))


@router.get("/instruments")
def list_instruments(all: bool = False, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        sql = "SELECT * FROM lab_instruments" + ("" if all and is_admin(me) else " WHERE active = 1") + " ORDER BY name COLLATE NOCASE, id"
        return {"instruments": [_instrument_json(conn, i, me) for i in conn.execute(sql).fetchall()]}


@router.post("/instruments")
def create_instrument(body: InstrumentBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        vals = _clean_instrument(body)
        if "name" not in vals:
            raise HTTPException(400, "Give the instrument a name.")
        keys = list(vals)
        iid = conn.execute(
            f"INSERT INTO lab_instruments ({', '.join(keys)}) VALUES ({', '.join('?' * len(keys))})", [vals[k] for k in keys]
        ).lastrowid
        _save_extras(conn, iid, body)
        out = _instrument_json(conn, _instrument(conn, iid), me)
    _changed("instruments", iid)
    return {"instrument": out}


@router.post("/instruments/examples")
def add_examples(user: User = Depends(current_user)):
    """The desktop's starting set (XPS, NAP-XPS, TGA/DSC, dilatometer, BET, glovebox)."""
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        have = {r[0].lower() for r in conn.execute("SELECT name FROM lab_instruments")}
        added = 0
        for name, desc, approval, colour, open_t, close_t, weekend, longest in EXAMPLES:
            if name.lower() in have:
                continue
            conn.execute(
                """INSERT INTO lab_instruments (name, description, approval, colour, open_time, close_time, max_minutes,
                   weekend_mode, weekend_start, weekend_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (name, desc, approval, colour, open_t, close_t, longest, weekend, open_t, close_t),
            )
            added += 1
    if added:
        _changed("instruments")
    return {"added": added}


@router.patch("/instruments/{instrument_id}")
def update_instrument(instrument_id: int, body: InstrumentBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        _instrument(conn, instrument_id)
        vals = _clean_instrument(body)
        if vals:
            conn.execute(
                f"UPDATE lab_instruments SET {', '.join(f'{k} = ?' for k in vals)} WHERE id = ?", [*vals.values(), instrument_id]
            )
        _save_extras(conn, instrument_id, body)
        out = _instrument_json(conn, _instrument(conn, instrument_id), me)
    _changed("instruments", instrument_id)
    return {"instrument": out}


@router.delete("/instruments/{instrument_id}")
def delete_instrument(instrument_id: int, with_bookings: bool = False, user: User = Depends(current_user)):
    """Delete an instrument. One with bookings is refused unless `with_bookings`
    (retiring it, active = false, keeps them)."""
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        _instrument(conn, instrument_id)
        n = conn.execute("SELECT COUNT(*) FROM lab_bookings WHERE instrument_id = ?", (instrument_id,)).fetchone()[0]
        if n and not with_bookings:
            raise HTTPException(409, f"The instrument has {n} booking(s): retire it to keep them, or delete it with its bookings.")
        conn.execute("DELETE FROM lab_instruments WHERE id = ?", (instrument_id,))
    _changed("instruments", instrument_id)
    return {"ok": True}


# ------------------------------------------------------------------ calendar and quote

@router.get("/calendar")
def calendar(
    start: str,
    end: str,
    instrument: int | None = None,
    with_slots: bool = Query(True, alias="slots"),
    user: User = Depends(current_user),
):
    """What the calendar draws: bookable slots (with problem / out-of-order state),
    bookings and issues, for one instrument or all of them."""
    s, e = _range(start, end)
    with db.connect() as conn:
        me = _me(conn, user)
        if instrument is not None:
            insts = [_instrument(conn, instrument)]
        else:
            insts = conn.execute("SELECT * FROM lab_instruments WHERE active = 1 ORDER BY name COLLATE NOCASE, id").fetchall()
        show_names = setting(conn, "show_names") == "1"
        out_slots, out_issues, out_bookings = [], [], []
        for inst in insts:
            inst_issues = issues(conn, inst["id"], s, e)
            out_issues += [_issue_json(r) for r in inst_issues]
            if with_slots:
                for s0, s1, label in slots(conn, inst, s, e):
                    kinds = {i["kind"] for i in inst_issues if parse(i["start"]) < s1 and (i["end"] is None or parse(i["end"]) > s0)}
                    out_slots.append({
                        "instrument_id": inst["id"], "start": fmt(s0), "end": fmt(s1), "label": label,
                        "state": "down" if "down" in kinds else "problem" if "problem" in kinds else "free",
                    })
            for b in conn.execute(
                _BOOKING_SQL + " WHERE b.instrument_id = ? AND b.status IN ('pending', 'approved') AND b.start < ? AND b.end > ? ORDER BY b.start",
                (inst["id"], fmt(e), fmt(s)),
            ).fetchall():
                out_bookings.append(_booking_json(conn, b, me, show_names))
        return {"slots": out_slots, "bookings": out_bookings, "issues": out_issues, "now": fmt(now_local(conn))}


@router.get("/quote")
def get_quote(instrument: int, start: str, end: str, for_user: int | None = Query(None, alias="for"), user: User = Depends(current_user)):
    s, e = _range(start, end)
    with db.connect() as conn:
        me = _me(conn, user)
        inst = _instrument(conn, instrument)
        owner = _target(conn, me, for_user)
        return quote(conn, inst, owner, me, s, e)


@router.get("/free")
def free_slots(instrument: int, start: str, end: str, user: User = Depends(current_user)):
    """The slots in [start, end) that `user` could book now (not taken, not past, within the rules)."""
    s, e = _range(start, end)
    with db.connect() as conn:
        me = _me(conn, user)
        inst = _instrument(conn, instrument)
        out = []
        for s0, s1, label in slots(conn, inst, s, e):
            if s0 >= s and not check(conn, inst, me, s0, s1):
                out.append({"start": fmt(s0), "end": fmt(s1), "label": label})
        return {"instrument": inst["name"], "slots": out, "now": fmt(now_local(conn))}


# ------------------------------------------------------------------ bookings

class BookBody(BaseModel):
    instrument_id: int
    start: str
    end: str
    purpose: str = Field(default="", max_length=MAX_PURPOSE)
    user_id: int | None = None  # book for someone else (manager / super user)


class ChangeBody(BaseModel):
    start: str | None = None
    end: str | None = None
    purpose: str | None = Field(default=None, max_length=MAX_PURPOSE)
    # 'move' keeps the length and lands on the nearest slot (or session);
    # 'resize' snaps the end to a slot boundary. Without it, times are taken as given.
    snap: str | None = None


class NoteBody(BaseModel):
    note: str = Field(default="", max_length=500)


class DecideBody(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=500)


class ReassignBody(BaseModel):
    user_id: int


@router.post("/bookings")
def create_booking(body: BookBody, user: User = Depends(current_user)):
    s, e = _range(body.start, body.end)
    with db.connect() as conn:
        me = _me(conn, user)
        owner = _target(conn, me, body.user_id)
        inst = _instrument(conn, body.instrument_id)
        s, e = normalise_range(inst, s, e)  # snapped exactly as the calendar shows it
        _begin(conn)
        try:
            made, problems = book_range(conn, inst, owner, me, s, e, body.purpose)
        except BookingError as exc:
            raise HTTPException(409, f"Not booked: {exc}.") from None
        bookings = [_booking_json(conn, _booking_row(conn, bid), me) for bid, _ in made]
    _changed("bookings", inst["id"])
    for b in bookings:
        _tell_owner(owner["id"], me, "booked", b)
    return {"bookings": bookings, "problems": problems}


@router.get("/bookings")
def list_bookings(
    user_id: int | None = Query(None, alias="user"),
    scope: str = Query("upcoming", pattern="^(upcoming|past|all)$"),
    instrument: int | None = None,
    user: User = Depends(current_user),
):
    """One person's bookings (yourself; anyone for the manager and super users), with this month's total."""
    with db.connect() as conn:
        me = _me(conn, user)
        owner = _target(conn, me, user_id)
        now = fmt(now_local(conn))
        sql = _BOOKING_SQL + " WHERE b.user_id = ?"
        args: list = [owner["id"]]
        if instrument is not None:
            sql += " AND b.instrument_id = ?"
            args.append(instrument)
        if scope == "upcoming":
            sql += " AND b.end > ? AND b.status IN ('pending', 'approved') ORDER BY b.start"
            args.append(now)
        elif scope == "past":
            sql += " AND (b.end <= ? OR b.status IN ('rejected', 'cancelled')) ORDER BY b.start DESC"
            args.append(now)
        else:
            sql += " ORDER BY b.start DESC"
        rows = conn.execute(sql + " LIMIT 500", args).fetchall()
        month0 = now[:8] + "01T00:00"
        month_rows = conn.execute(
            _BOOKING_SQL + " WHERE b.user_id = ? AND b.status = 'approved' AND b.start >= ? AND b.start < ?",
            (owner["id"], month0, _next_month(month0)),
        ).fetchall()
        return {
            "owner": {"id": owner["id"], "full_name": owner["full_name"], "username": owner["username"]},
            "bookings": [_booking_json(conn, b, me) for b in rows],
            "month_total": round(sum(cost(conn, b) for b in month_rows), 2),
            "currency": setting(conn, "currency"),
        }


def _next_month(month0: str) -> str:
    d = parse(month0)
    return fmt(d.replace(year=d.year + 1, month=1) if d.month == 12 else d.replace(month=d.month + 1))


@router.get("/bookings/{booking_id}")
def get_booking(booking_id: int, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        return {"booking": _booking_json(conn, _booking_row(conn, booking_id), me)}


def _snapped(conn: sqlite3.Connection, inst, b, start: datetime, end: datetime, snap: str | None) -> tuple[datetime, datetime]:
    if snap == "move":
        length = parse(b["end"]) - parse(b["start"])
        if inst["booking_mode"] == "sessions":
            near = occurrences(conn, inst["id"], start - timedelta(hours=12), start + timedelta(hours=12))
            if near:
                o = min(near, key=lambda o: abs((o.start - start).total_seconds()))
                return o.start, o.end
            return start, start + length
        s = snap_nearest_start(inst, start)
        return s, snap_end(inst, s, s + length)
    if snap == "resize" and inst["booking_mode"] == "free":
        return start, snap_end(inst, start, end)
    return start, end


@router.patch("/bookings/{booking_id}")
def change_booking(booking_id: int, body: ChangeBody, user: User = Depends(current_user)):
    """Move, resize or re-describe a booking. A change by its owner (or a super
    user) on an instrument that needs approval goes back to the manager."""
    with db.connect() as conn:
        me = _me(conn, user)
        _begin(conn)
        b = _booking_row(conn, booking_id)
        mine = b["user_id"] == me["id"]
        if not mine and not acts_for_others(me):
            raise HTTPException(403, "You can only change your own bookings.")
        if b["status"] not in ("pending", "approved"):
            raise HTTPException(409, "This booking can no longer be changed.")
        admin = is_admin(me)
        if not admin and b["start"] <= fmt(now_local(conn)):
            raise HTTPException(409, "A booking that has started can only be changed by the lab manager.")
        inst = _instrument(conn, b["instrument_id"])
        owner = member(conn, b["user_id"])
        start = _time(body.start, "start") if body.start else parse(b["start"])
        end = _time(body.end, "end") if body.end else parse(b["end"])
        start, end = _snapped(conn, inst, b, start, end, body.snap)
        moved = fmt(start) != b["start"] or fmt(end) != b["end"]
        if moved:
            errors = check(conn, inst, me if admin else owner, start, end, exclude=booking_id)
            if errors:
                raise HTTPException(409, "Not changed: " + "; ".join(errors) + ".")
            if admin:
                status = b["status"]
            else:
                status = "approved" if instant_for(conn, inst, owner) else "pending"
            session_id, price = _session_and_price(conn, inst, start, end, owner["category"])
            if price is None and b["price"] is not None and not b["session_id"]:
                price = b["price"]  # a fixed charge stays
            conn.execute(
                "UPDATE lab_bookings SET start = ?, end = ?, status = ?, session_id = ?, price = ? WHERE id = ?",
                (fmt(start), fmt(end), status, session_id, price, booking_id),
            )
        if body.purpose is not None:
            conn.execute("UPDATE lab_bookings SET purpose = ? WHERE id = ?", (body.purpose.strip(), booking_id))
        out = _booking_json(conn, _booking_row(conn, booking_id), me)
    _changed("bookings", inst["id"])
    if moved:
        _tell_owner(b["user_id"], me, "moved", out)
    return {"booking": out}


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, body: NoteBody | None = None, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        b = _booking_row(conn, booking_id)
        if not is_admin(me):
            if b["user_id"] != me["id"] and not acts_for_others(me):
                raise HTTPException(403, "You can only cancel your own bookings.")
            if b["start"] <= fmt(now_local(conn)):
                raise HTTPException(409, "A booking that has started can only be cancelled by the lab manager.")
        if b["status"] not in ("pending", "approved"):
            raise HTTPException(409, "This booking is already closed.")
        conn.execute(
            "UPDATE lab_bookings SET status = 'cancelled', decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
            (me["id"], fmt(now_local(conn)), (body.note if body else "").strip(), booking_id),
        )
        out = _booking_json(conn, _booking_row(conn, booking_id), me)
    _changed("bookings", b["instrument_id"])
    _tell_owner(b["user_id"], me, "cancelled", out)
    return {"booking": out}


@router.post("/bookings/{booking_id}/decide")
def decide_booking(booking_id: int, body: DecideBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        b = _booking_row(conn, booking_id)
        if b["status"] != "pending":
            raise HTTPException(409, "This booking is no longer waiting for a decision.")
        if body.approve:
            inst = _instrument(conn, b["instrument_id"])
            clash = check(conn, inst, me, parse(b["start"]), parse(b["end"]), exclude=booking_id)
            if clash:
                raise HTTPException(409, "Cannot approve: " + "; ".join(clash) + ".")
        conn.execute(
            "UPDATE lab_bookings SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
            ("approved" if body.approve else "rejected", me["id"], fmt(now_local(conn)), body.note.strip(), booking_id),
        )
        out = _booking_json(conn, _booking_row(conn, booking_id), me)
    _changed("bookings", b["instrument_id"])
    _tell_owner(b["user_id"], me, "approved" if body.approve else "rejected", out)
    return {"booking": out}


@router.post("/bookings/{booking_id}/reassign")
def reassign_booking(booking_id: int, body: ReassignBody, user: User = Depends(current_user)):
    """Give a booking to someone else; it is re-priced at their category."""
    with db.connect() as conn:
        me = _me(conn, user)
        if not acts_for_others(me):
            raise HTTPException(403, "Only the lab manager or a super user can change who a booking is for.")
        b = _booking_row(conn, booking_id)
        if b["status"] not in ("pending", "approved"):
            raise HTTPException(409, "This booking can no longer be changed.")
        if not is_admin(me) and b["start"] <= fmt(now_local(conn)):
            raise HTTPException(409, "A booking that has started can only be changed by the lab manager.")
        new = member(conn, body.user_id)
        if new is None or new["status"] != "active":
            raise HTTPException(400, "Choose someone with an active lab account.")
        rate = rate_for(conn, b["instrument_id"], new["category"])
        price = session_price(conn, b["session_id"], new["category"]) if b["session_id"] else b["price"]
        conn.execute("UPDATE lab_bookings SET user_id = ?, rate = ?, price = ? WHERE id = ?", (new["id"], rate, price, booking_id))
        out = _booking_json(conn, _booking_row(conn, booking_id), me)
    _changed("bookings", b["instrument_id"])
    _tell_owner(b["user_id"], me, "reassigned", out)
    _tell_owner(new["id"], me, "booked", out)
    return {"booking": out}


# ------------------------------------------------------------------ requests and members

@router.get("/requests")
def requests(user: User = Depends(current_user)):
    """What waits for the lab manager: booking requests and new lab accounts."""
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        rows = conn.execute(_BOOKING_SQL + " WHERE b.status = 'pending' ORDER BY b.start").fetchall()
        pending = conn.execute(_MEMBER_SQL + " WHERE m.status = 'pending' ORDER BY m.created").fetchall()
        return {
            "bookings": [_booking_json(conn, b, me) for b in rows],
            "members": [_member_dict(r, False) for r in pending],
        }


@router.get("/members")
def list_members(user: User = Depends(current_user)):
    """Everyone on the server with their lab role (manager), or the people a
    super user can book for (active members)."""
    with db.connect() as conn:
        me = _me(conn, user)
        if not acts_for_others(me):
            raise HTTPException(403, "Only the lab manager or a super user can list the lab's people.")
        people = all_members(conn)
        if not is_admin(me):
            return {"members": [{k: p[k] for k in ("id", "username", "full_name", "status")} for p in people if p["status"] == "active"]}
        trained: dict[int, list[int]] = {}
        for r in conn.execute("SELECT user_id, instrument_id FROM lab_trained"):
            trained.setdefault(r[0], []).append(r[1])
        for p in people:
            p["trained"] = trained.get(p["id"], [])
        return {"members": people}


class MemberBody(BaseModel):
    role: str | None = None
    status: str | None = None
    category: str | None = None
    group_name: str | None = Field(default=None, max_length=100)
    trained: list[int] | None = None


@router.patch("/members/{user_id}")
def update_member(user_id: int, body: MemberBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        m = member(conn, user_id)
        if m is None:
            raise HTTPException(404, "There is no such person.")
        if m["locked"] and ((body.role and body.role != "admin") or (body.status and body.status != "active")):
            raise HTTPException(409, f"{m['full_name']} manages the lab by configuration; their role cannot be changed here.")
        if body.role is not None:
            if body.role not in ROLE_LABELS:
                raise HTTPException(400, "The role is user, superuser or admin.")
            if m["id"] == me["id"] and body.role != "admin":
                raise HTTPException(409, "You cannot stop being the lab manager yourself: ask another manager.")
            conn.execute("UPDATE lab_members SET role = ? WHERE user_id = ?", (body.role, user_id))
        if body.status is not None:
            if body.status not in ("pending", "active", "disabled"):
                raise HTTPException(400, "The status is pending, active or disabled.")
            if m["id"] == me["id"] and body.status != "active":
                raise HTTPException(409, "You cannot disable your own lab account.")
            conn.execute("UPDATE lab_members SET status = ? WHERE user_id = ?", (body.status, user_id))
        if body.category is not None:
            if body.category not in categories(conn):
                raise HTTPException(400, f"Unknown rate category “{body.category}”.")
            conn.execute("UPDATE lab_members SET category = ? WHERE user_id = ?", (body.category, user_id))
        if body.group_name is not None:
            conn.execute("UPDATE lab_members SET group_name = ? WHERE user_id = ?", (body.group_name.strip(), user_id))
        if body.trained is not None:
            conn.execute("DELETE FROM lab_trained WHERE user_id = ?", (user_id,))
            for iid in set(body.trained):
                if conn.execute("SELECT 1 FROM lab_instruments WHERE id = ?", (iid,)).fetchone():
                    conn.execute("INSERT INTO lab_trained (user_id, instrument_id) VALUES (?, ?)", (user_id, iid))
        out = member(conn, user_id)
    _changed("members")
    return {"member": out}


# ------------------------------------------------------------------ issues

class IssueBody(BaseModel):
    instrument_id: int
    kind: str
    start: str | None = None  # default: now
    end: str | None = None  # None: until fixed
    note: str = Field(default="", max_length=500)


@router.get("/issues")
def list_issues(instrument: int | None = None, user: User = Depends(current_user)):
    """Open issues and those of the last 90 days."""
    with db.connect() as conn:
        _me(conn, user)
        since = fmt(now_local(conn) - timedelta(days=90))
        sql = """SELECT x.*, i.name AS instrument, u.display_name AS reporter FROM lab_issues x
                 JOIN lab_instruments i ON i.id = x.instrument_id LEFT JOIN users u ON u.id = x.reported_by
                 WHERE (x.end IS NULL OR x.end > ?)"""
        args: list = [since]
        if instrument is not None:
            sql += " AND x.instrument_id = ?"
            args.append(instrument)
        rows = conn.execute(sql + " ORDER BY x.start DESC", args).fetchall()
        return {"issues": [{**_issue_json(r), "instrument": r["instrument"], "reporter": r["reporter"]} for r in rows]}


@router.post("/issues")
def report_issue(body: IssueBody, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        if me["status"] != "active":
            raise HTTPException(403, "Your lab account is not active yet.")
        if body.kind not in ("problem", "down"):
            raise HTTPException(400, "The kind is problem or down (out of order).")
        _instrument(conn, body.instrument_id)
        start = _time(body.start, "start") if body.start else now_local(conn)
        end = _time(body.end, "end") if body.end else None
        if end is not None and end <= start:
            raise HTTPException(400, "The end must be after the start.")
        iid = conn.execute(
            "INSERT INTO lab_issues (instrument_id, kind, start, end, note, reported_by, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.instrument_id, body.kind, fmt(start), fmt(end) if end else None, body.note.strip(), me["id"], fmt(now_local(conn))),
        ).lastrowid
        out = _issue_json(conn.execute("SELECT * FROM lab_issues WHERE id = ?", (iid,)).fetchone())
    _changed("issues", body.instrument_id)
    return {"issue": out}


@router.post("/issues/{issue_id}/resolve")
def resolve_issue(issue_id: int, user: User = Depends(current_user)):
    """Fixed now: the issue ends now (one that had not begun is removed)."""
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        row = conn.execute("SELECT * FROM lab_issues WHERE id = ?", (issue_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Issue not found.")
        now = now_local(conn)
        if parse(row["start"]) > now:
            conn.execute("DELETE FROM lab_issues WHERE id = ?", (issue_id,))
        else:
            conn.execute("UPDATE lab_issues SET end = ? WHERE id = ?", (fmt(now), issue_id))
    _changed("issues", row["instrument_id"])
    return {"ok": True}


@router.delete("/issues/{issue_id}")
def delete_issue(issue_id: int, user: User = Depends(current_user)):
    with db.connect() as conn:
        me = _me(conn, user)
        _require_admin(me)
        row = conn.execute("SELECT * FROM lab_issues WHERE id = ?", (issue_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Issue not found.")
        conn.execute("DELETE FROM lab_issues WHERE id = ?", (issue_id,))
    _changed("issues", row["instrument_id"])
    return {"ok": True}


# ------------------------------------------------------------------ iCal

def _ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def _ics_fold(line: str) -> str:
    """Lines of at most 75 octets, continued with a space (RFC 5545 3.1)."""
    out, cur = [], b""
    for ch in line:
        enc = ch.encode()
        if len(cur) + len(enc) > (75 if not out else 74):
            out.append(cur.decode())
            cur = b""
        cur += enc
    out.append(cur.decode())
    return "\r\n ".join(out)


def _ics_utc(conn: sqlite3.Connection, stamp: str) -> str:
    return parse(stamp).replace(tzinfo=tz(conn)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@router.get("/ical")
def ical(
    user_id: int | None = Query(None, alias="user"),
    instrument: int | None = None,
    user: User = Depends(current_user),
):
    """An .ics calendar: your bookings (or someone's, for the manager and super
    users), or every booking on one instrument when `instrument` is given."""
    with db.connect() as conn:
        me = _me(conn, user)
        lab_name = setting(conn, "lab_name")
        if instrument is not None and user_id is None:
            inst = _instrument(conn, instrument)
            rows = conn.execute(
                _BOOKING_SQL + " WHERE b.instrument_id = ? AND b.status IN ('pending', 'approved') ORDER BY b.start", (instrument,)
            ).fetchall()
            name = f"{lab_name} — {inst['name']}"
        else:
            owner = _target(conn, me, user_id)
            sql = _BOOKING_SQL + " WHERE b.user_id = ? AND b.status IN ('pending', 'approved')"
            args: list = [owner["id"]]
            if instrument is not None:
                sql += " AND b.instrument_id = ?"
                args.append(instrument)
            rows = conn.execute(sql + " ORDER BY b.start", args).fetchall()
            name = f"{lab_name} — {owner['full_name']}"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        lines = [
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KherveOS//KherveLAB//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
            f"X-WR-CALNAME:{_ics_text(name)}",
        ]
        for r in rows:
            b = _booking_json(conn, r, me)
            summary = r["instrument"] if b["mine"] else f"{r['instrument']} — {b['who']}"
            if b["status"] == "pending":
                summary += " (pending)"
            desc = [f"Status: {b['status']}"]
            if b["purpose"]:
                desc.append(f"Purpose: {b['purpose']}")
            if b["cost"] is not None:
                desc.append(f"Cost: {setting(conn, 'currency')}{b['cost']:.2f}")
            lines += [
                "BEGIN:VEVENT",
                f"UID:khervelab-{r['id']}@kherveos",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{_ics_utc(conn, r['start'])}",
                f"DTEND:{_ics_utc(conn, r['end'])}",
                f"SUMMARY:{_ics_text(summary)}",
                f"DESCRIPTION:{_ics_text(chr(10).join(desc))}",
                f"LOCATION:{_ics_text(lab_name)}",
                f"STATUS:{'CONFIRMED' if b['status'] == 'approved' else 'TENTATIVE'}",
                "END:VEVENT",
            ]
        lines.append("END:VCALENDAR")
    body = "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="khervelab.ics"'})

