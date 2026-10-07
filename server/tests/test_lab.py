"""KherveLAB: instruments, booking rules, approval, roles, sessions, issues, iCal and live events.

The lab's clock is frozen at Monday 5 October 2026, 07:00 (Europe/London), so
"tomorrow" is a Tuesday. Each person gets their own TestClient (cookie jar);
websockets that must receive events are opened on the `client` fixture, whose
lifespan runs the hub's event loop.
"""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from conftest import make_user
from kherveos_server import lab
from kherveos_server.app import app

# Until app.py includes it (app.include_router(lab.router)), the tests do.
if not any(getattr(r, "path", "").startswith("/api/lab/") for r in app.routes):
    app.include_router(lab.router)

API = "/api/lab"
NOW = datetime(2026, 10, 5, 7, 0)  # a Monday
TUE = "2026-10-06"
WED = "2026-10-07"
SAT = "2026-10-10"


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.delenv("KHERVELAB_ADMINS", raising=False)
    monkeypatch.setattr(lab, "now_local", lambda conn: NOW)


def new_client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def people(client):
    """boss (the first account: the lab manager) on the main client; alice and bob on their own."""
    alice_client, bob_client = new_client(), new_client()
    users = {
        "boss": make_user(client, "boss"),
        "alice": make_user(alice_client, "alice"),
        "bob": make_user(bob_client, "bob"),
    }
    return {"boss": client, "alice": alice_client, "bob": bob_client}, users


def ok(r, status=200):
    assert r.status_code == status, r.text
    return r.json()


def add_instrument(c, **fields):
    body = {"name": "XPS", "approval": "auto", **fields}
    return ok(c.post(f"{API}/instruments", json=body))["instrument"]


def book(c, inst, start, end, **extra):
    return c.post(f"{API}/bookings", json={"instrument_id": inst["id"], "start": start, "end": end, **extra})


def booked(c, inst, start, end, **extra):
    return ok(book(c, inst, start, end, **extra))["bookings"]


def receive_until(ws, event_type, limit=20):
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == event_type:
            return event
    raise AssertionError(f"no {event_type!r} event")


# ------------------------------------------------------------------ roles

def test_needs_login(client):
    assert client.get(f"{API}/me").status_code == 401
    assert client.get(f"{API}/instruments").status_code == 401


def test_first_account_manages_the_lab(people):
    c, users = people
    assert ok(c["boss"].get(f"{API}/me"))["member"]["role"] == "admin"
    me = ok(c["alice"].get(f"{API}/me"))
    assert me["member"]["role"] == "user" and me["member"]["status"] == "active"
    assert me["settings"]["timezone"] == "Europe/London"
    assert me["categories"] == ["Internal", "External academic", "Industry"]
    assert c["alice"].post(f"{API}/instruments", json={"name": "SEM"}).status_code == 403
    assert c["alice"].get(f"{API}/members").status_code == 403


def test_configured_admin(people, monkeypatch):
    c, users = people
    monkeypatch.setenv("KHERVELAB_ADMINS", "alice, someone-else")
    assert ok(c["alice"].get(f"{API}/me"))["member"]["role"] == "admin"
    assert ok(c["alice"].get(f"{API}/me"))["member"]["locked"] is True
    assert ok(c["boss"].get(f"{API}/me"))["member"]["role"] in ("admin", "user")  # keeps a role given earlier
    # a manager by configuration cannot be demoted from the app
    r = c["alice"].patch(f"{API}/members/{users['alice']['id']}", json={"role": "user"})
    assert r.status_code == 409


def test_manager_sets_roles_categories_and_training(people):
    c, users = people
    inst = add_instrument(c["boss"], approval="trained")
    members = ok(c["boss"].get(f"{API}/members"))["members"]
    assert {m["username"] for m in members} == {"boss", "alice", "bob"}  # every account, even before opening the lab
    ok(c["boss"].patch(f"{API}/members/{users['bob']['id']}", json={"role": "superuser", "category": "Industry", "trained": [inst["id"]]}))
    bob = ok(c["bob"].get(f"{API}/me"))["member"]
    assert bob["role"] == "superuser" and bob["category"] == "Industry"
    assert c["boss"].patch(f"{API}/members/{users['bob']['id']}", json={"category": "Nope"}).status_code == 400
    assert c["boss"].patch(f"{API}/members/{users['boss']['id']}", json={"role": "user"}).status_code == 409
    # a super user lists people to book for, but cannot manage
    assert {m["username"] for m in ok(c["bob"].get(f"{API}/members"))["members"]} == {"boss", "alice", "bob"}
    assert c["bob"].patch(f"{API}/members/{users['alice']['id']}", json={"role": "admin"}).status_code == 403


def test_account_approval(people):
    c, users = people
    ok(c["boss"].patch(f"{API}/settings", json={"account_approval": True}))
    inst = add_instrument(c["boss"])
    me = ok(c["alice"].get(f"{API}/me"))["member"]
    assert me["status"] == "pending"
    r = book(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00")
    assert r.status_code == 409 and "not active" in r.json()["detail"]
    pending = ok(c["boss"].get(f"{API}/requests"))["members"]
    assert [m["username"] for m in pending] == ["alice"]
    ok(c["boss"].patch(f"{API}/members/{users['alice']['id']}", json={"status": "active"}))
    assert booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00")[0]["status"] == "approved"


def test_settings_validation(people):
    c, _ = people
    assert c["alice"].patch(f"{API}/settings", json={"lab_name": "Mine"}).status_code == 403
    assert c["boss"].patch(f"{API}/settings", json={"timezone": "Mars/Olympus"}).status_code == 400
    assert c["boss"].patch(f"{API}/settings", json={"categories": ["  ", ""]}).status_code == 400
    s = ok(c["boss"].patch(f"{API}/settings", json={"lab_name": "Surface lab", "currency": "€", "categories": ["Internal", "External"]}))
    assert s["settings"]["lab_name"] == "Surface lab" and s["settings"]["categories"] == "Internal\nExternal"


# ------------------------------------------------------------------ instruments

def test_instrument_validation_and_examples(people):
    c, _ = people
    for bad in ({"name": ""}, {"name": "X", "approval": "maybe"}, {"name": "X", "open_time": "8am"},
                {"name": "X", "slot_minutes": 0}, {"name": "X", "colour": "green"}, {"name": "X", "evening_mode": "sometimes"}):
        assert c["boss"].post(f"{API}/instruments", json=bad).status_code == 400, bad
    assert ok(c["boss"].post(f"{API}/instruments/examples"))["added"] == 6
    assert ok(c["boss"].post(f"{API}/instruments/examples"))["added"] == 0
    names = [i["name"] for i in ok(c["alice"].get(f"{API}/instruments"))["instruments"]]
    assert names == ["BET", "Dilatometer", "Glovebox", "NAP-XPS", "TGA / DSC", "XPS"]


def test_rates_quote_and_cost(people):
    c, users = people
    inst = add_instrument(c["boss"], rates={"Internal": 20, "Industry": 100})
    assert inst["rates"] == {"Internal": 20.0, "External academic": 0.0, "Industry": 100.0}
    q = ok(c["alice"].get(f"{API}/quote", params={"instrument": inst["id"], "start": f"{TUE}T09:10", "end": f"{TUE}T11:20"}))
    # snapped to the 30 min slots, as the calendar shows it
    assert q["items"][0]["start"] == f"{TUE}T09:00" and q["items"][0]["end"] == f"{TUE}T11:30"
    assert q["items"][0]["cost"] == 50.0 and q["bookable"] and q["instant"] and q["currency"] == "£"
    b = booked(c["alice"], inst, f"{TUE}T09:10", f"{TUE}T11:20")[0]
    assert (b["start"], b["end"], b["cost"]) == (f"{TUE}T09:00", f"{TUE}T11:30", 50.0)
    # a later price change never rewrites the charge
    ok(c["boss"].patch(f"{API}/instruments/{inst['id']}", json={"rates": {"Internal": 999}}))
    mine = ok(c["alice"].get(f"{API}/bookings"))
    assert mine["bookings"][0]["cost"] == 50.0 and mine["month_total"] == 50.0


def test_delete_or_retire_instrument(people):
    c, _ = people
    inst = add_instrument(c["boss"])
    booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00")
    assert c["boss"].delete(f"{API}/instruments/{inst['id']}").status_code == 409
    ok(c["boss"].patch(f"{API}/instruments/{inst['id']}", json={"active": False}))
    assert ok(c["alice"].get(f"{API}/instruments"))["instruments"] == []
    assert len(ok(c["boss"].get(f"{API}/instruments", params={"all": 1}))["instruments"]) == 1
    r = book(c["alice"], inst, f"{WED}T09:00", f"{WED}T10:00")
    assert r.status_code == 409 and "not available" in r.json()["detail"]
    ok(c["boss"].delete(f"{API}/instruments/{inst['id']}", params={"with_bookings": 1}))
    assert ok(c["alice"].get(f"{API}/bookings", params={"scope": "all"}))["bookings"] == []


# ------------------------------------------------------------------ approval

def test_manual_waits_for_the_manager(people):
    c, _ = people
    inst = add_instrument(c["boss"], approval="manual")
    b = booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T11:00")[0]
    assert b["status"] == "pending"
    assert c["alice"].post(f"{API}/bookings/{b['id']}/decide", json={"approve": True}).status_code == 403
    assert [x["id"] for x in ok(c["boss"].get(f"{API}/requests"))["bookings"]] == [b["id"]]
    d = ok(c["boss"].post(f"{API}/bookings/{b['id']}/decide", json={"approve": True, "note": "fine"}))["booking"]
    assert d["status"] == "approved" and d["note"] == "fine"
    assert c["boss"].post(f"{API}/bookings/{b['id']}/decide", json={"approve": False}).status_code == 409


def test_trained_mode(people):
    c, users = people
    inst = add_instrument(c["boss"], approval="trained", trained=[users["alice"]["id"]])
    assert booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00")[0]["status"] == "approved"
    assert booked(c["bob"], inst, f"{TUE}T10:00", f"{TUE}T11:00")[0]["status"] == "pending"


def test_rejected_slot_is_free_again(people):
    c, _ = people
    inst = add_instrument(c["boss"], approval="manual")
    b = booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T11:00")[0]
    ok(c["boss"].post(f"{API}/bookings/{b['id']}/decide", json={"approve": False, "note": "maintenance"}))
    assert booked(c["bob"], inst, f"{TUE}T09:00", f"{TUE}T11:00")[0]["status"] == "pending"


# ------------------------------------------------------------------ rules

def test_clash_blocks_including_pending(people):
    c, _ = people
    inst = add_instrument(c["boss"], approval="manual")
    booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T11:00")
    r = book(c["bob"], inst, f"{TUE}T10:00", f"{TUE}T12:00")
    assert r.status_code == 409 and "overlaps" in r.json()["detail"]
    booked(c["bob"], inst, f"{TUE}T11:00", f"{TUE}T12:00")  # touching is fine


@pytest.mark.parametrize(
    "start,end,msg",
    [
        (f"{TUE}T06:00", f"{TUE}T07:00", "closed at"),
        (f"{TUE}T09:00", f"{TUE}T19:00", "longest booking is 8 h"),
        (f"{SAT}T09:00", f"{SAT}T10:00", "cannot be booked at weekends"),
        ("2026-10-02T09:00", "2026-10-02T10:00", "past"),
        ("2026-12-15T09:00", "2026-12-15T10:00", "60 days ahead"),
        (f"{TUE}T19:00", f"{TUE}T22:00", "closed from"),
    ],
)
def test_rules(people, start, end, msg):
    c, _ = people
    inst = add_instrument(c["boss"])
    r = book(c["alice"], inst, start, end)
    assert r.status_code == 409 and msg in r.json()["detail"], r.text


def test_shortest_booking_is_stretched_when_dragged(people):
    c, _ = people
    inst = add_instrument(c["boss"], min_minutes=60)
    b = booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T09:30")[0]
    assert (b["start"], b["end"]) == (f"{TUE}T09:00", f"{TUE}T10:00")


def test_manager_is_held_to_hard_rules_only(people):
    c, users = people
    inst = add_instrument(c["boss"], approval="manual")
    b = booked(c["boss"], inst, f"{SAT}T22:07", f"{SAT}T23:00")[0]  # a weekend, off the grid
    assert b["status"] == "approved"
    # booking for someone: approved, at their rate
    b = booked(c["boss"], inst, f"{TUE}T09:00", f"{TUE}T10:00", user_id=users["alice"]["id"])[0]
    assert b["status"] == "approved" and b["user_id"] == users["alice"]["id"]
    r = book(c["boss"], inst, f"{TUE}T09:30", f"{TUE}T10:30")
    assert r.status_code == 409 and "overlaps" in r.json()["detail"]
    # plain users cannot book for others
    assert book(c["alice"], inst, f"{WED}T09:00", f"{WED}T10:00", user_id=users["bob"]["id"]).status_code == 403


def test_evening_block_and_slots(people):
    c, _ = people
    inst = add_instrument(
        c["boss"], open_time="08:00", close_time="17:00", slot_minutes=270, min_minutes=270, max_minutes=540,
        evening_mode="block", evening_start="17:00", evening_end="08:00",
    )
    assert "Evening 17:00–08:00 (next day) as one booking" in inst["describe"]
    # dragging inside the evening takes it whole (15 h: "longest" is for the daytime)
    b = booked(c["alice"], inst, f"{TUE}T17:00", f"{TUE}T22:00")[0]
    assert (b["start"], b["end"]) == (f"{TUE}T17:00", f"{WED}T08:00")
    # the afternoon slot runs into the evening only as a whole
    cal = ok(c["alice"].get(f"{API}/calendar", params={"instrument": inst["id"], "start": f"{WED}T00:00", "end": f"{WED}T23:59"}))
    labels = [(s["start"][11:], s["end"][11:], s["label"]) for s in cal["slots"]]
    assert ("08:00", "12:30", "Daytime") in labels and ("12:30", "17:00", "Daytime") in labels and ("17:00", "08:00", "Evening") in labels


def test_weekend_whole_span(people):
    c, _ = people
    inst = add_instrument(
        c["boss"], weekend_mode="block", weekend_span="whole", weekend_start="08:00", weekend_end="08:00",
        evening_mode="block", evening_start="17:00", evening_end="08:00", close_time="17:00",
    )
    b = booked(c["alice"], inst, f"{SAT}T10:00", f"{SAT}T11:00")[0]
    assert (b["start"], b["end"]) == (f"{SAT}T08:00", "2026-10-12T08:00")


def test_sessions(people):
    c, users = people
    inst = add_instrument(
        c["boss"], name="NAP-XPS", booking_mode="sessions", rates={"Internal": 10},
        sessions=[
            {"name": "Morning", "start_time": "08:00", "end_time": "12:30", "prices": {"Internal": 100}},
            {"name": "Afternoon", "start_time": "12:30", "end_time": "17:00"},
            {"name": "Evening and overnight", "start_time": "17:00", "end_time": "08:00"},
        ],
    )
    assert [s["name"] for s in inst["sessions"]] == ["Morning", "Afternoon", "Evening and overnight"]
    assert inst["sessions"][2]["hours"] == 15
    # a drag across the morning and the afternoon books both, each its own booking
    made = booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T13:00")
    assert [(b["start"][11:], b["end"][11:], b["cost"]) for b in made] == [("08:00", "12:30", 100.0), ("12:30", "17:00", 45.0)]
    # taken sessions are reported, free ones still booked
    r = ok(book(c["bob"], inst, f"{TUE}T13:00", f"{TUE}T18:00"))
    assert [b["start"][11:] for b in r["bookings"]] == ["17:00"] and len(r["problems"]) == 1
    # free-form time is refused to users, allowed to the manager
    assert c["alice"].patch(f"{API}/bookings/{made[0]['id']}", json={"start": f"{WED}T09:00", "end": f"{WED}T10:00"}).status_code == 409
    moved = ok(c["alice"].patch(f"{API}/bookings/{made[0]['id']}", json={"start": f"{WED}T09:00", "end": f"{WED}T13:30", "snap": "move"}))
    assert (moved["booking"]["start"], moved["booking"]["end"]) == (f"{WED}T08:00", f"{WED}T12:30")
    # editing sessions keeps ids
    s0 = inst["sessions"][0]
    inst2 = ok(c["boss"].patch(f"{API}/instruments/{inst['id']}", json={"sessions": [{**s0, "name": "AM"}]}))["instrument"]
    assert [(s["id"], s["name"]) for s in inst2["sessions"]] == [(s0["id"], "AM")]


# ------------------------------------------------------------------ changes

def test_move_and_resize(people):
    c, _ = people
    inst = add_instrument(c["boss"], approval="trained")
    b = booked(c["boss"], inst, f"{TUE}T09:00", f"{TUE}T10:00", user_id=None)[0]
    other = booked(c["alice"], inst, f"{TUE}T12:00", f"{TUE}T13:00")[0]
    assert other["status"] == "pending"
    # a move by drag snaps to the nearest slot and keeps the length
    m = ok(c["alice"].patch(f"{API}/bookings/{other['id']}", json={"start": f"{TUE}T14:10", "end": f"{TUE}T15:10", "snap": "move"}))["booking"]
    assert (m["start"], m["end"], m["status"]) == (f"{TUE}T14:00", f"{TUE}T15:00", "pending")
    # resize snaps the end to a slot boundary
    m = ok(c["alice"].patch(f"{API}/bookings/{other['id']}", json={"end": f"{TUE}T16:20", "snap": "resize"}))["booking"]
    assert m["end"] == f"{TUE}T16:30"
    # onto someone else's booking: refused
    r = c["alice"].patch(f"{API}/bookings/{other['id']}", json={"start": f"{TUE}T09:30", "end": f"{TUE}T10:30"})
    assert r.status_code == 409 and "overlaps" in r.json()["detail"]
    # not yours
    assert c["bob"].patch(f"{API}/bookings/{other['id']}", json={"purpose": "mine now"}).status_code == 403
    m = ok(c["alice"].patch(f"{API}/bookings/{other['id']}", json={"purpose": "Ti 2p survey"}))["booking"]
    assert m["purpose"] == "Ti 2p survey"
    assert b["status"] == "approved"


def test_cancel(people, monkeypatch):
    c, _ = people
    inst = add_instrument(c["boss"])
    b = booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00")[0]
    assert c["bob"].post(f"{API}/bookings/{b['id']}/cancel").status_code == 403
    # once started, only the manager can cancel
    monkeypatch.setattr(lab, "now_local", lambda conn: datetime(2026, 10, 6, 9, 30))
    assert c["alice"].post(f"{API}/bookings/{b['id']}/cancel").status_code == 409
    monkeypatch.setattr(lab, "now_local", lambda conn: NOW)
    out = ok(c["alice"].post(f"{API}/bookings/{b['id']}/cancel", json={"note": "sample not ready"}))["booking"]
    assert out["status"] == "cancelled"
    assert c["alice"].post(f"{API}/bookings/{b['id']}/cancel").status_code == 409
    booked(c["bob"], inst, f"{TUE}T09:00", f"{TUE}T10:00")  # free again
    upcoming = ok(c["alice"].get(f"{API}/bookings"))["bookings"]
    past = ok(c["alice"].get(f"{API}/bookings", params={"scope": "past"}))["bookings"]
    assert upcoming == [] and [x["status"] for x in past] == ["cancelled"]


def test_super_user_books_and_reassigns_for_others(people):
    c, users = people
    ok(c["boss"].patch(f"{API}/members/{users['bob']['id']}", json={"role": "superuser"}))
    ok(c["boss"].patch(f"{API}/members/{users['alice']['id']}", json={"category": "Industry"}))
    inst = add_instrument(c["boss"], approval="manual", rates={"Internal": 10, "Industry": 50})
    # a super user books with the person's rules, approval and price
    b = booked(c["bob"], inst, f"{TUE}T09:00", f"{TUE}T10:00", user_id=users["alice"]["id"])[0]
    assert b["status"] == "pending" and b["user_id"] == users["alice"]["id"] and b["cost"] == 50.0
    r = book(c["bob"], inst, f"{SAT}T09:00", f"{SAT}T10:00", user_id=users["alice"]["id"])
    assert r.status_code == 409
    # reassign: re-priced at the new owner's category
    out = ok(c["bob"].post(f"{API}/bookings/{b['id']}/reassign", json={"user_id": users["boss"]["id"]}))["booking"]
    assert out["user_id"] == users["boss"]["id"] and out["cost"] == 10.0
    assert c["alice"].post(f"{API}/bookings/{b['id']}/reassign", json={"user_id": users["alice"]["id"]}).status_code == 403
    # and sees other people's bookings
    assert ok(c["bob"].get(f"{API}/bookings", params={"user": users["boss"]["id"]}))["bookings"][0]["id"] == b["id"]
    assert c["alice"].get(f"{API}/bookings", params={"user": users["boss"]["id"]}).status_code == 403


# ------------------------------------------------------------------ calendar, privacy, issues

def test_calendar_privacy(people):
    c, users = people
    inst = add_instrument(c["boss"], rates={"Internal": 10})
    booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:00", purpose="secret project")
    params = {"instrument": inst["id"], "start": f"{TUE}T00:00", "end": f"{WED}T00:00"}
    mine = ok(c["alice"].get(f"{API}/calendar", params=params))["bookings"][0]
    assert mine["mine"] and mine["purpose"] == "secret project" and mine["cost"] == 10.0 and mine["editable"]
    theirs = ok(c["bob"].get(f"{API}/calendar", params=params))["bookings"][0]
    assert theirs["who"] == "Alice" and theirs["purpose"] == "" and theirs["cost"] is None and not theirs["editable"]
    ok(c["boss"].patch(f"{API}/settings", json={"show_names": False}))
    assert ok(c["bob"].get(f"{API}/calendar", params=params))["bookings"][0]["who"] == "Booked"
    assert ok(c["boss"].get(f"{API}/calendar", params=params))["bookings"][0]["purpose"] == "secret project"
    # All instruments: no instrument given
    every = ok(c["bob"].get(f"{API}/calendar", params={"start": f"{TUE}T00:00", "end": f"{WED}T00:00", "slots": 0}))
    assert every["slots"] == [] and len(every["bookings"]) == 1
    assert c["bob"].get(f"{API}/calendar", params={"start": f"{TUE}T00:00", "end": "2027-03-01T00:00"}).status_code == 400


def test_out_of_order_blocks_users_not_the_manager(people):
    c, _ = people
    inst = add_instrument(c["boss"])
    issue = ok(c["alice"].post(f"{API}/issues", json={"instrument_id": inst["id"], "kind": "down", "start": f"{TUE}T00:00", "note": "pump"}))["issue"]
    r = book(c["bob"], inst, f"{TUE}T09:00", f"{TUE}T10:00")
    assert r.status_code == 409 and "out of order until fixed: pump" in r.json()["detail"]
    booked(c["boss"], inst, f"{TUE}T09:00", f"{TUE}T10:00")  # e.g. the repair
    cal = ok(c["bob"].get(f"{API}/calendar", params={"instrument": inst["id"], "start": f"{TUE}T00:00", "end": f"{WED}T00:00"}))
    assert {s["state"] for s in cal["slots"]} == {"down"} and cal["bookings"][0]["issue"] == "down"
    assert c["alice"].post(f"{API}/issues/{issue['id']}/resolve").status_code == 403
    ok(c["boss"].post(f"{API}/issues/{issue['id']}/resolve"))  # had not begun at 07:00 Monday: removed
    booked(c["bob"], inst, f"{TUE}T10:00", f"{TUE}T11:00")
    # a problem warns but does not block
    ok(c["alice"].post(f"{API}/issues", json={"instrument_id": inst["id"], "kind": "problem", "start": f"{WED}T00:00", "end": f"{WED}T12:00"}))
    booked(c["bob"], inst, f"{WED}T10:00", f"{WED}T11:00")
    assert len(ok(c["bob"].get(f"{API}/issues"))["issues"]) == 1


def test_free_slots(people):
    c, _ = people
    inst = add_instrument(c["boss"], open_time="09:00", close_time="12:00", slot_minutes=60, min_minutes=60)
    booked(c["alice"], inst, f"{TUE}T10:00", f"{TUE}T11:00")
    free = ok(c["bob"].get(f"{API}/free", params={"instrument": inst["id"], "start": f"{TUE}T00:00", "end": f"{WED}T00:00"}))
    assert [s["start"][11:] for s in free["slots"]] == ["09:00", "11:00"]


# ------------------------------------------------------------------ iCal

def test_ical_export(people):
    c, users = people
    inst = add_instrument(c["boss"], name="XPS, bay 2", rates={"Internal": 12})
    booked(c["alice"], inst, f"{TUE}T09:00", f"{TUE}T10:30", purpose="C 1s; O 1s")
    booked(c["bob"], inst, f"{WED}T09:00", f"{WED}T10:00")
    r = c["alice"].get(f"{API}/ical")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    text = r.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert text.count("BEGIN:VEVENT") == 1
    assert "DTSTART:20261006T080000Z" in text and "DTEND:20261006T093000Z" in text  # London is on BST
    assert "SUMMARY:XPS\\, bay 2" in text and "C 1s\\; O 1s" in text and "STATUS:CONFIRMED" in text
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    # the whole instrument: everyone's bookings, names as the calendar shows them
    every = c["alice"].get(f"{API}/ical", params={"instrument": inst["id"]}).text
    assert every.count("BEGIN:VEVENT") == 2 and "XPS\\, bay 2 — Bob" in every
    assert c["alice"].get(f"{API}/ical", params={"user": users["bob"]["id"]}).status_code == 403


# ------------------------------------------------------------------ live events

def test_live_updates(client):
    # the manager registers first; alice listens on the lifespan client.
    boss_client = new_client()
    boss = make_user(boss_client, "boss")
    make_user(client, "alice")
    inst = add_instrument(boss_client, approval="manual")

    with client.websocket_connect("/api/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        b = booked(client, inst, f"{TUE}T09:00", f"{TUE}T10:00")[0]
        ev = receive_until(ws, "lab.changed")
        assert ev == {"type": "lab.changed", "what": "bookings", "instrument_id": inst["id"]}

        # alice hears about the manager's decision on her booking
        ok(boss_client.post(f"{API}/bookings/{b['id']}/decide", json={"approve": True}))
        ev = receive_until(ws, "lab.booking")
        assert ev["action"] == "approved" and ev["booking"]["id"] == b["id"] and ev["by"]["id"] == boss["id"]

        ok(boss_client.patch(f"{API}/instruments/{inst['id']}", json={"description": "Bay 2"}))
        assert receive_until(ws, "lab.changed")["what"] == "instruments"
