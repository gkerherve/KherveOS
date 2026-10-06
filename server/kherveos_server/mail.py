"""Email: an IMAP/SMTP bridge for the Email app.

Browsers cannot speak IMAP or SMTP, so the Email app calls these endpoints and
the server talks to the user's own mail providers on their behalf:

    GET    /api/mail/providers                       presets: Gmail, iCloud, Fastmail…
    GET    /api/mail/accounts                        the user's accounts (never the passwords)
    POST   /api/mail/accounts                        add one — the IMAP and SMTP logins are tested first
    PATCH  /api/mail/accounts/{id}                   change the name, password or servers (re-tested)
    DELETE /api/mail/accounts/{id}
    GET    /api/mail/accounts/{id}/folders
    GET    /api/mail/accounts/{id}/messages?folder=INBOX&offset=0&limit=50&q=
    GET    /api/mail/accounts/{id}/messages/{uid}?folder=            (marks it read)
    GET    /api/mail/accounts/{id}/messages/{uid}/attachments/{index}?folder=
    POST   /api/mail/accounts/{id}/messages/{uid}/flags   {folder, seen?, flagged?, answered?}
    POST   /api/mail/accounts/{id}/messages/{uid}/move    {folder, to}
    POST   /api/mail/accounts/{id}/messages/{uid}/delete  {folder}
    POST   /api/mail/accounts/{id}/send                   {to, cc, bcc, subject, text, html?, …}

Passwords (normally the provider's "app passwords") are encrypted with Fernet
under the key in config.SECRET_KEY_PATH and never leave the server again.

Errors meant for the user are MailErrors: 400 for things they can fix (wrong
password, bad address), 404 for folders/messages that are gone, 502 when a mail
server can't be reached or fails. `detail` is a readable sentence and the
X-Mail-Error header says what kind of problem it is (auth, connect, tls…).

Every request uses an IMAP connection with a 20 s timeout. Logged-in
connections are kept for a few minutes and reused ("Connection cache" below).
Only the standard library (imaplib, smtplib, email, ssl) and cryptography.
"""

from __future__ import annotations

import base64
import binascii
import codecs
import email
import email.errors
import email.policy
import email.utils
import functools
import hashlib
import imaplib
import logging
import mimetypes
import os
import quopri
import re
import smtplib
import socket
import ssl
import threading
import time
import urllib.parse
from collections import OrderedDict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.headerregistry import Address
from email.message import EmailMessage, Message
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterator, Literal

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from . import config, db
from .auth import User, current_user

log = logging.getLogger("kherveos.mail")

router = APIRouter(prefix="/api/mail", tags=["mail"])

TIMEOUT = 20  # seconds, for every IMAP / SMTP socket operation
# imaplib refuses response lines over 1 MB; a SEARCH in a huge mailbox can be longer.
imaplib._MAXLINE = max(getattr(imaplib, "_MAXLINE", 0), 32 * 1024 * 1024)
PAGE_MAX = 200
MAX_ATTACHMENTS = 25 * 1024 * 1024  # what Gmail, iCloud and most providers accept
MAX_INLINE_IMAGES = 15 * 1024 * 1024  # cid: pictures embedded into a message's HTML

db.register_schema(
    """
    CREATE TABLE IF NOT EXISTS mail_accounts (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email         TEXT NOT NULL,
        display_name  TEXT NOT NULL DEFAULT '',
        imap_host     TEXT NOT NULL,
        imap_port     INTEGER NOT NULL,
        imap_security TEXT NOT NULL,
        smtp_host     TEXT NOT NULL,
        smtp_port     INTEGER NOT NULL,
        smtp_security TEXT NOT NULL,
        username      TEXT NOT NULL,
        password_enc  TEXT NOT NULL,
        created_at    REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mail_accounts_user ON mail_accounts(user_id);
    """
)

Security = Literal["ssl", "starttls", "none"]
DEFAULT_PORTS = {
    "imap": {"ssl": 993, "starttls": 143, "none": 143},
    "smtp": {"ssl": 465, "starttls": 587, "none": 587},
}
_LABEL = {"IMAP": "Incoming mail (IMAP)", "SMTP": "Outgoing mail (SMTP)"}


class MailError(HTTPException):
    """An error to show the user, with its kind in the X-Mail-Error header."""

    def __init__(self, status: int, message: str, kind: str = "server") -> None:
        super().__init__(status_code=status, detail=message, headers={"X-Mail-Error": kind})
        self.message = message
        self.kind = kind


# ------------------------------------------------------------------ providers

PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "gmail",
        "name": "Gmail",
        "supported": True,
        "domains": ["gmail.com", "googlemail.com"],
        "imap": {"host": "imap.gmail.com", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp.gmail.com", "port": 465, "security": "ssl"},
        "password_label": "App password",
        "note": (
            "Gmail needs an app password, not your normal password. 2-Step Verification must be on; "
            "then go to Google Account › Security › App passwords, create one and paste the 16 letters here."
        ),
        "help_url": "https://myaccount.google.com/apppasswords",
    },
    {
        "id": "icloud",
        "name": "iCloud Mail",
        "supported": True,
        "domains": ["icloud.com", "me.com", "mac.com"],
        "imap": {"host": "imap.mail.me.com", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp.mail.me.com", "port": 587, "security": "starttls"},
        "password_label": "App-specific password",
        "note": (
            "iCloud needs an app-specific password: sign in at account.apple.com, open "
            "Sign-In and Security › App-Specific Passwords, create one and paste it here."
        ),
        "help_url": "https://account.apple.com",
    },
    {
        "id": "fastmail",
        "name": "Fastmail",
        "supported": True,
        "domains": ["fastmail.com", "fastmail.fm", "fastmail.net", "fastmail.org", "fastmail.us", "messagingengine.com"],
        "imap": {"host": "imap.fastmail.com", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp.fastmail.com", "port": 465, "security": "ssl"},
        "password_label": "App password",
        "note": (
            "Fastmail needs an app password: Settings › Privacy & Security › Manage app passwords › "
            "New app password, with access to IMAP and SMTP."
        ),
        "help_url": None,
    },
    {
        "id": "yahoo",
        "name": "Yahoo Mail",
        "supported": True,
        "domains": [
            "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.es",
            "yahoo.it", "yahoo.ca", "yahoo.com.au", "yahoo.in", "yahoo.com.br",
        ],
        "imap": {"host": "imap.mail.yahoo.com", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp.mail.yahoo.com", "port": 465, "security": "ssl"},
        "password_label": "App password",
        "note": "Yahoo needs an app password: Account info › Account security › Generate app password.",
        "help_url": "https://login.yahoo.com/account/security",
    },
    {
        "id": "outlook",
        "name": "Outlook.com",
        "supported": False,
        "domains": [
            "outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.fr", "hotmail.fr", "live.fr",
            "hotmail.co.uk", "live.co.uk", "outlook.de", "hotmail.de",
        ],
        "imap": {"host": "outlook.office365.com", "port": 993, "security": "ssl"},
        "smtp": {"host": "smtp-mail.outlook.com", "port": 587, "security": "starttls"},
        "password_label": "Password",
        "note": (
            "Not supported yet: Microsoft only lets apps sign in to Outlook.com, Hotmail and Live accounts "
            "with OAuth (a Microsoft sign-in page), which KherveOS doesn't do yet."
        ),
        "help_url": None,
    },
    {
        "id": "other",
        "name": "Other (IMAP/SMTP)",
        "supported": True,
        "domains": [],
        "imap": None,
        "smtp": None,
        "password_label": "Password",
        "note": (
            "Enter the IMAP (incoming) and SMTP (outgoing) settings from your provider's help pages. "
            "Many providers want an app password rather than your normal password."
        ),
        "help_url": None,
    },
]
_PROVIDERS_BY_ID = {p["id"]: p for p in PROVIDERS}


def _provider_for(provider_id: str, domain: str) -> dict | None:
    if provider_id in _PROVIDERS_BY_ID:
        return _PROVIDERS_BY_ID[provider_id]
    return next((p for p in PROVIDERS if domain in p["domains"]), None)


def _provider_id_for_host(imap_host: str) -> str:
    host = imap_host.lower()
    for p in PROVIDERS:
        if p["imap"] and p["imap"]["host"] == host:
            return p["id"]
    return "other"


def _is_gmail(account: dict) -> bool:
    hosts = (account["imap_host"].lower(), account["smtp_host"].lower())
    return any(h.endswith(("gmail.com", "googlemail.com")) for h in hosts)


# ----------------------------------------------------------- password storage

_fernet_cache: tuple[Path, Fernet] | None = None
_fernet_lock = threading.Lock()


def _fernet() -> Fernet:
    """The Fernet key in config.SECRET_KEY_PATH, created (mode 600) on first use."""
    global _fernet_cache
    path = Path(config.SECRET_KEY_PATH)
    with _fernet_lock:
        if _fernet_cache is not None and _fernet_cache[0] == path:
            return _fernet_cache[1]
        data = path.read_bytes().strip() if path.exists() else b""
        if not data:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = Fernet.generate_key()
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        try:
            fernet = Fernet(data)
        except (ValueError, TypeError):
            # The file holds some other kind of secret: derive a Fernet key from it.
            fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"kherveos-mail\0" + data).digest()))
        _fernet_cache = (path, fernet)
        return fernet


def encrypt_password(password: str) -> str:
    return _fernet().encrypt(password.encode("utf-8")).decode("ascii")


def decrypt_password(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        raise MailError(
            409,
            "The saved password for this account can't be decrypted any more (the server's secret key "
            "changed). Edit the account and enter the password again.",
            "auth",
        ) from None


# ---------------------------------------------------- folder names (RFC 3501)

def decode_mutf7(name: str | bytes) -> str:
    """IMAP's "modified UTF-7" folder names: "Entw&APw-rfe" → "Entwürfe"."""
    if isinstance(name, (bytes, bytearray)):
        name = bytes(name).decode("utf-8", "replace")
    out: list[str] = []
    i, n = 0, len(name)
    while i < n:
        ch = name[i]
        if ch != "&":
            out.append(ch)
            i += 1
            continue
        end = name.find("-", i + 1)
        if end == -1:  # malformed: keep the rest as it is
            out.append(name[i:])
            break
        chunk = name[i + 1:end]
        if not chunk:
            out.append("&")
        else:
            b64 = chunk.replace(",", "/")
            try:
                out.append(base64.b64decode(b64 + "=" * (-len(b64) % 4), validate=True).decode("utf-16-be"))
            except (ValueError, UnicodeDecodeError):
                out.append(name[i:end + 1])
        i = end + 1
    return "".join(out)


def encode_mutf7(text: str) -> str:
    """The inverse of decode_mutf7."""
    out: list[str] = []
    pending: list[str] = []

    def flush() -> None:
        if pending:
            raw = "".join(pending).encode("utf-16-be")
            out.append("&" + base64.b64encode(raw).decode("ascii").rstrip("=").replace("/", ",") + "-")
            pending.clear()

    for ch in text:
        if 0x20 <= ord(ch) <= 0x7E:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            pending.append(ch)
    flush()
    return "".join(out)


# ------------------------------------------------------ charsets and headers

_CHARSET_ALIASES = {
    "utf8": "utf-8", "unicode-1-1-utf-8": "utf-8", "us-ascii": "utf-8", "ascii": "utf-8", "ansi_x3.4-1968": "utf-8",
    "x-unknown": "utf-8", "unknown": "utf-8", "unknown-8bit": "utf-8", "default": "utf-8",
    # Mail clients, like browsers, mean Windows-1252 when they say Latin-1.
    "iso-8859-1": "windows-1252", "iso8859-1": "windows-1252", "latin1": "windows-1252", "latin-1": "windows-1252",
    "x-user-defined": "windows-1252",
    "iso-8859-8-i": "iso-8859-8", "iso-8859-8-e": "iso-8859-8", "iso-8859-6-i": "iso-8859-6",
    "ks_c_5601-1987": "cp949", "ks_c_5601": "cp949", "euc-kr": "cp949",
    "gb2312": "gb18030", "gbk": "gb18030", "x-gbk": "gb18030", "cn-gb": "gb18030", "gb_2312-80": "gb18030",
    "big5": "big5hkscs", "x-big5": "big5hkscs",
    "shift_jis": "cp932", "shift-jis": "cp932", "x-sjis": "cp932", "sjis": "cp932", "windows-31j": "cp932",
    "tis-620": "cp874", "windows-874": "cp874", "iso-8859-11": "cp874",
    "macintosh": "mac-roman", "x-mac-roman": "mac-roman",
}


def _codec(charset: str | None) -> str | None:
    if not charset:
        return None
    cs = str(charset).strip().strip("\"'").lower()
    cs = _CHARSET_ALIASES.get(cs, cs)
    try:
        return codecs.lookup(cs).name
    except LookupError:
        return None


def decode_bytes(data: bytes, charset: str | None = None) -> str:
    """Decode text in its declared charset, surviving unknown charsets and mislabelled text."""
    declared = _codec(charset)
    for cs in dict.fromkeys(c for c in (declared, "utf-8") if c):
        try:
            return data.decode(cs)
        except (UnicodeDecodeError, LookupError):
            pass
    fallback = declared if declared and declared != "utf-8" else "windows-1252"
    return data.decode(fallback, errors="replace")


def _s(value: Any) -> str:
    """A protocol value (bytes, str, None…) as text."""
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    return str(value)


def _int(value: Any) -> int | None:
    try:
        return int(_s(value).strip())
    except ValueError:
        return None


def _text(value: Any, limit: int = 300) -> str:
    """A server reply or an exception, as one short readable line."""
    if isinstance(value, BaseException):
        parts = value.args or (str(value),)
    elif isinstance(value, (list, tuple)):
        parts = value
    else:
        parts = (value,)
    text = " ".join(_s(p if not isinstance(p, tuple) else p[0]) for p in parts if p is not None)
    text = " ".join(text.split())
    return text[:limit] + ("…" if len(text) > limit else "")


def _one_line(value: str | None) -> str:
    return " ".join((value or "").split())


def _unfold(value: str) -> str:
    return re.sub(r"\r?\n[ \t]*", " ", value).replace("\r", " ").replace("\n", " ")


def _raw_text(value: str | None) -> str:
    """A raw header value as text: raw 8-bit bytes decoded (UTF-8, else Windows-1252) and unfolded.

    Parsed from bytes, header values carry undecodable bytes as surrogate escapes.
    RFC 2047 encoded words are left alone (see header_text)."""
    if not value:
        return ""
    value = str(value)
    if any("\udc80" <= ch <= "\udcff" for ch in value):
        value = decode_bytes(value.encode("utf-8", "surrogateescape"), "utf-8")
    return _unfold(value)


_ENCODED_WORD = re.compile(r"=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=")


def _word_bytes(m: re.Match) -> bytes | None:
    enc, payload = m.group(2).upper(), m.group(3)
    try:
        if enc == "B":
            payload = re.sub(r"[^A-Za-z0-9+/]", "", payload)
            return base64.b64decode(payload + "=" * (-len(payload) % 4))
        return quopri.decodestring(payload.replace("_", " ").encode("ascii", "replace"), header=True)
    except (ValueError, binascii.Error):
        return None


def _decode_words(text: str) -> str:
    """Decode RFC 2047 encoded words. Adjacent words in one charset are joined before
    decoding (some mailers split a character across two words); the whitespace
    between encoded words is dropped (RFC 2047 §6.2)."""
    out: list[str] = []
    pending_cs: str | None = None
    pending = b""
    pos = 0

    def flush() -> None:
        nonlocal pending_cs, pending
        if pending_cs is not None:
            out.append(decode_bytes(pending, pending_cs))
        pending_cs, pending = None, b""

    for m in _ENCODED_WORD.finditer(text):
        gap = text[pos:m.start()]
        pos = m.end()
        raw = _word_bytes(m)
        if raw is None:
            flush()
            out.append(gap + m.group(0))
            continue
        if gap.strip() or pending_cs is None:
            flush()
            out.append(gap)
        charset = m.group(1).split("*", 1)[0]  # "utf-8*en": RFC 2231 language tag
        if pending_cs is not None and charset.lower() != pending_cs.lower():
            flush()
        if pending_cs is None:
            pending_cs = charset
        pending += raw
    flush()
    out.append(text[pos:])
    return "".join(out)


def header_text(value: str | None) -> str:
    """A header as clean display text: '=?utf-8?q?Caf=C3=A9?=' → 'Café'."""
    text = _raw_text(value)
    if "=?" in text:
        text = _decode_words(text)
    return re.sub(r"\s+", " ", text).strip()


def _raw(msg: Message, name: str) -> str | None:
    """The first raw value of a header (str, possibly with surrogate escapes)."""
    name = name.lower()
    for key, value in msg.raw_items():
        if key.lower() == name:
            return value if isinstance(value, str) else str(value)
    return None


def parse_addresses(value: str | None) -> list[dict]:
    """'"Doe, John" <j@x.org>, =?utf-8?q?Jos=C3=A9?= <jose@x.org>' → [{name, address}, …]."""
    text = _raw_text(value)
    if not text.strip():
        return []
    pairs = email.utils.getaddresses([text])
    if not any(addr for _, addr in pairs):
        try:  # the strict parser gave up; be lenient
            pairs = email.utils.getaddresses([text], strict=False)
        except TypeError:
            pass
    out = []
    for name, addr in pairs:
        name = header_text(name).strip().strip('"').strip()
        addr = addr.strip()
        if not addr and "@" in name:
            addr, name = name, ""
        if addr:
            out.append({"name": name, "address": addr})
    return out


_MSGID = re.compile(r"<[^<>\s]+>")


def _msgids(value: str | None) -> list[str]:
    return _MSGID.findall(value or "")


_MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
_IMAP_DATE = re.compile(r"(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})")


def parse_date(value: str | None) -> datetime | None:
    """An RFC 5322 date (or an IMAP INTERNALDATE) as an aware datetime, or None."""
    value = (value or "").strip()
    if not value:
        return None
    dt: datetime | None = None
    try:
        dt = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        m = _IMAP_DATE.search(value)
        if m:
            day, mon, year, hh, mm, ss, sign, oh, om = m.groups()
            try:
                offset = timedelta(hours=int(oh), minutes=int(om)) * (1 if sign == "+" else -1)
                dt = datetime(int(year), _MONTHS[mon.lower()], int(day), int(hh), int(mm), int(ss), tzinfo=timezone(offset))
            except (KeyError, ValueError):
                dt = None
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _safe_filename(name: str, fallback: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", name.replace("\\", "/").split("/")[-1]).strip()
    if name in (".", ".."):
        name = ""
    return name[:180] or fallback


# ------------------------------------------------ IMAP protocol data parsing

_LITERAL = re.compile(rb"~?\{(\d+)\+?\}\r\n")
_SPACE = frozenset(b" \t\r\n")
_ATOM_STOP = frozenset(b" \t\r\n()")


def parse_imap(data: bytes) -> list:
    """Parse IMAP response data into Python values.

    Atoms become str ("NIL" becomes None), "quoted strings" and {literals} become
    bytes, and (lists) become lists. An atom keeps any [...] section whole, so
    BODY[HEADER.FIELDS (FROM)] is one token."""
    root: list = []
    stack = [root]
    pos, n = 0, len(data)
    while pos < n:
        c = data[pos]
        if c in _SPACE:
            pos += 1
        elif c == 0x28:  # (
            child: list = []
            stack[-1].append(child)
            stack.append(child)
            pos += 1
        elif c == 0x29:  # )
            if len(stack) > 1:
                stack.pop()
            pos += 1
        elif c == 0x22:  # "
            pos += 1
            buf = bytearray()
            while pos < n and data[pos] != 0x22:
                if data[pos] == 0x5C and pos + 1 < n:  # backslash escape
                    pos += 1
                buf.append(data[pos])
                pos += 1
            pos += 1
            stack[-1].append(bytes(buf))
        else:
            m = _LITERAL.match(data, pos) if c in (0x7B, 0x7E) else None
            if m:
                start, size = m.end(), int(m.group(1))
                stack[-1].append(data[start:start + size])
                pos = start + size
                continue
            start, depth = pos, 0
            while pos < n:
                ch = data[pos]
                if ch == 0x5B:  # [
                    depth += 1
                elif ch == 0x5D and depth:  # ]
                    depth -= 1
                elif not depth and ch in _ATOM_STOP:
                    break
                pos += 1
            atom = data[start:pos].decode("utf-8", "replace")
            stack[-1].append(None if atom.upper() == "NIL" else atom)
    return root


def _responses(data: Any) -> list[bytes]:
    """imaplib returns each response as a bytes line, or as (line, literal) tuples followed
    by the rest of the line; stitch every response back together with its literals inline."""
    out: list[bytes] = []
    cur = b""
    for item in data or ():
        if isinstance(item, tuple):
            cur += bytes(item[0]) + b"\r\n" + bytes(item[1])
        elif isinstance(item, (bytes, bytearray)):
            out.append(cur + bytes(item))
            cur = b""
    if cur:
        out.append(cur)
    return out


def _fetch_key(key: str) -> str:
    k = key.upper().replace("BODY.PEEK[", "BODY[")
    k = re.sub(r"<\d+>$", "", k)
    return "BODY[HEADER.FIELDS]" if k.startswith("BODY[HEADER.FIELDS") else k


def _fetch_items(data: Any) -> list[dict]:
    """FETCH responses as dicts: {"UID": "12", "FLAGS": [...], "BODY[]": b"...", …}."""
    items = []
    for resp in _responses(data):
        vals = parse_imap(resp)
        lst = next((v for v in vals if isinstance(v, list)), None)
        if lst is None:
            continue
        item = {}
        for i in range(0, len(lst) - 1, 2):
            if isinstance(lst[i], str):
                item[_fetch_key(lst[i])] = lst[i + 1]
        items.append(item)
    return items


def _flag_set(value: Any) -> set[str]:
    return {_s(f).lower() for f in value} if isinstance(value, list) else set()


def _plist(value: Any) -> dict[str, str]:
    """A BODYSTRUCTURE parameter list ("NAME" "x.pdf" …) as a dict."""
    if not isinstance(value, list):
        return {}
    return {_s(value[i]).lower(): _s(value[i + 1]) for i in range(0, len(value) - 1, 2)}


def _bs_has_attachments(bs: Any, parent: str = "") -> bool | None:
    """Whether a BODYSTRUCTURE has attachments (None if there is none to look at)."""
    if not isinstance(bs, list) or not bs:
        return None
    if isinstance(bs[0], list):  # multipart: (part)(part)… "subtype" (params) …
        parts: list = []
        subtype = ""
        for x in bs:
            if not isinstance(x, list):
                subtype = _s(x).lower()
                break
            parts.append(x)
        return any(_bs_has_attachments(p, subtype) for p in parts)
    maintype = _s(bs[0]).lower()
    subtype = _s(bs[1]).lower() if len(bs) > 1 else ""
    params = _plist(bs[2]) if len(bs) > 2 else {}
    if maintype == "text":
        at = 9
    elif maintype == "message" and subtype in ("rfc822", "global"):
        return True
    else:
        at = 8
    disposition = bs[at] if len(bs) > at else None
    dtype, named = "", any(k.startswith("name") for k in params)
    if isinstance(disposition, list) and disposition:
        dtype = _s(disposition[0]).lower()
        dparams = _plist(disposition[1]) if len(disposition) > 1 else {}
        named = named or any(k.startswith("filename") for k in dparams)
    elif isinstance(disposition, (bytes, str)):  # some servers send the raw header: "attachment; filename=…"
        text = _s(disposition).lower()
        dtype = text.split(";", 1)[0].strip()
        named = named or "filename" in text
    has_id = len(bs) > 3 and bs[3] is not None
    if parent == "related" and (has_id or maintype != "text"):
        return False  # a picture shown inside the HTML
    if dtype == "attachment":
        return True
    return named or maintype not in ("text", "multipart")


# ------------------------------------------------------------ MIME messages

class _TextExtractor(HTMLParser):
    BLOCKS = {
        "p", "div", "li", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "hr",
        "section", "article", "header", "footer", "ul", "ol", "dl", "dt", "dd", "address", "center", "td",
    }
    SKIP = {"script", "style", "title", "template", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.pre = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag in self.BLOCKS:
            self.parts.append("\n")
        if tag == "pre":
            self.pre += 1

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        if tag not in self.SKIP:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if tag == "pre":
            self.pre = max(0, self.pre - 1)
        if tag in self.BLOCKS and tag != "li":  # the next <li> starts its own line
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data if self.pre else re.sub(r"\s+", " ", data))


def html_to_text(html: str) -> str:
    """A readable plain-text version of an HTML body (for quoting in replies)."""
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
        text = "".join(parser.parts)
    except Exception:  # html.parser is lenient, but never let a body break reading
        text = re.sub(r"<[^>]*>", " ", html)
    lines = [line.strip() for line in text.replace("\xa0", " ").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _payload(part: Message) -> bytes:
    try:
        data = part.get_payload(decode=True)
    except Exception:
        data = None
    if isinstance(data, bytes):
        return data
    raw = part.get_payload()
    return raw.encode("utf-8", "surrogateescape") if isinstance(raw, str) else b""


def _message_bytes(part: Message) -> bytes:
    inner = part.get_payload()
    if isinstance(inner, list) and inner and isinstance(inner[0], Message):
        try:
            return inner[0].as_bytes()
        except Exception:
            pass
    return _payload(part)


class _MimeWalk:
    """Sorts a message's parts into body text, body HTML, attachments and inline pictures."""

    def __init__(self, keep_data: bool) -> None:
        self.keep_data = keep_data
        self.text: list[str] = []
        self.html: list[str] = []
        self.attachments: list[dict] = []
        self.inline: list[dict] = []

    def walk(self, part: Message, parent: str = "", depth: int = 0) -> None:
        if depth > 40:
            return
        ctype = part.get_content_type()
        maintype = part.get_content_maintype()
        payload = part.get_payload()
        if maintype == "multipart" and isinstance(payload, list):
            for child in payload:
                if isinstance(child, Message):
                    self.walk(child, part.get_content_subtype(), depth + 1)
            return
        try:
            filename = part.get_filename()
        except Exception:
            filename = None
        filename = _safe_filename(header_text(filename), "") if filename else ""
        disposition = part.get_content_disposition()
        if maintype == "message" and part.get_content_subtype() in ("rfc822", "global"):
            inner = payload[0] if isinstance(payload, list) and payload and isinstance(payload[0], Message) else None
            subject = header_text(_raw(inner, "subject")) if inner is not None else ""
            name = filename or _safe_filename(f"{subject or 'message'}.eml", "message.eml")
            self.add_attachment(name, "message/rfc822", _message_bytes(part), disposition, None)
            return
        if ctype in ("text/plain", "text/html") and disposition != "attachment" and not filename:
            body = decode_bytes(_payload(part), part.get_content_charset()).replace("\r\n", "\n").replace("\r", "\n")
            (self.text if ctype == "text/plain" else self.html).append(body)
            return
        cid = header_text(_raw(part, "content-id")).strip("<> ") or None
        data = _payload(part)
        if cid and maintype == "image":  # shown inside the HTML if it uses it, else an attachment (finish_html)
            self.inline.append({"cid": cid, "type": ctype, "data": data, "filename": filename, "disposition": disposition})
            return
        self.add_attachment(filename, ctype, data, disposition, cid)

    def add_attachment(self, filename: str, ctype: str, data: bytes, disposition: str | None, cid: str | None) -> None:
        index = len(self.attachments)
        if not filename:
            ext = mimetypes.guess_extension(ctype) or ""
            filename = f"attachment-{index + 1}{ext}"
        entry: dict[str, Any] = {
            "index": index,
            "filename": filename,
            "content_type": ctype,
            "size": len(data),
            "inline": disposition == "inline",
            "content_id": cid,
        }
        if self.keep_data:
            entry["data"] = data
        self.attachments.append(entry)

    def finish_html(self, html: str) -> str:
        """Embed cid: pictures as data: URIs; the ones the HTML never uses become attachments."""
        by_cid: dict[str, dict] = {}
        for item in self.inline:
            by_cid.setdefault(item["cid"].lower(), item)
        used: set[int] = set()
        budget = [MAX_INLINE_IMAGES]

        def embed(m: re.Match) -> str:
            item = by_cid.get(urllib.parse.unquote(m.group(1)).strip("<> ").lower())
            if item is None or not re.fullmatch(r"image/[a-z0-9.+-]+", item["type"]):
                return m.group(0)
            if id(item) not in used:
                if len(item["data"]) > budget[0]:
                    return m.group(0)
                budget[0] -= len(item["data"])
                used.add(id(item))
            return f"data:{item['type']};base64,{base64.b64encode(item['data']).decode('ascii')}"

        html = re.sub(r"(?<![\w-])cid:([^\s\"'<>)]+)", embed, html, flags=re.IGNORECASE)
        for item in self.inline:
            if id(item) not in used:
                self.add_attachment(item["filename"], item["type"], item["data"], item["disposition"], item["cid"])
        return html


def parse_message(raw: bytes, keep_data: bool = False) -> dict:
    """A raw RFC 5322 message → headers, text, html and attachments (with their bytes if keep_data)."""
    msg = email.message_from_bytes(raw)  # compat32: never raises on bad input
    walker = _MimeWalk(keep_data)
    walker.walk(msg)
    html = "\n".join(walker.html) if walker.html else None
    html = walker.finish_html(html or "") if html is not None or walker.inline else html
    if html == "":
        html = None
    text = "\n".join(walker.text)
    if not text.strip() and html:
        text = html_to_text(html)
    sender = parse_addresses(_raw(msg, "from"))
    date = parse_date(header_text(_raw(msg, "date")))
    in_reply_to = _msgids(header_text(_raw(msg, "in-reply-to")))
    return {
        "headers": {
            "subject": header_text(_raw(msg, "subject")),
            "from": sender[0] if sender else None,
            "to": parse_addresses(_raw(msg, "to")),
            "cc": parse_addresses(_raw(msg, "cc")),
            "reply_to": parse_addresses(_raw(msg, "reply-to")),
            "date": date.isoformat() if date else None,
            "message_id": (_msgids(header_text(_raw(msg, "message-id"))) or [""])[0] or None,
            "in_reply_to": in_reply_to[0] if in_reply_to else None,
            "references": " ".join(_msgids(header_text(_raw(msg, "references")))),
        },
        "text": text,
        "html": html,
        "attachments": walker.attachments,
    }


def _summary(item: dict) -> dict | None:
    """One row of the message list, from a FETCH of FLAGS, headers and BODYSTRUCTURE."""
    uid = _int(item.get("UID"))
    header = item.get("BODY[HEADER.FIELDS]")
    if uid is None or not isinstance(header, bytes):
        return None
    flags = _flag_set(item.get("FLAGS"))
    row: dict[str, Any] = {
        "uid": uid,
        "subject": "",
        "from": None,
        "to": [],
        "cc": [],
        "date": None,
        "message_id": None,
        "seen": "\\seen" in flags,
        "flagged": "\\flagged" in flags,
        "answered": "\\answered" in flags,
        "draft": "\\draft" in flags,
        "has_attachments": False,
        "size": _int(item.get("RFC822.SIZE")) or 0,
    }
    try:
        hdr = email.message_from_bytes(header)
        sender = parse_addresses(_raw(hdr, "from"))
        date = parse_date(header_text(_raw(hdr, "date"))) or parse_date(_s(item.get("INTERNALDATE")))
        has = _bs_has_attachments(item.get("BODYSTRUCTURE"))
        if has is None:
            has = header_text(_raw(hdr, "content-type")).lower().startswith("multipart/mixed")
        row.update(
            subject=header_text(_raw(hdr, "subject")),
            to=parse_addresses(_raw(hdr, "to")),
            cc=parse_addresses(_raw(hdr, "cc")),
            date=date.isoformat() if date else None,
            message_id=(_msgids(header_text(_raw(hdr, "message-id"))) or [None])[0],
            has_attachments=bool(has),
        )
        row["from"] = sender[0] if sender else None
    except Exception:  # one odd message must not break the whole list
        log.warning("could not read the headers of message %s", uid, exc_info=True)
    return row


# ---------------------------------------------------------- building mail

_POLICY = email.policy.SMTP.clone(cte_type="7bit")  # QP / base64 bodies, RFC 2047 headers: any server takes it
_MIME_TYPE = re.compile(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*")


class OutgoingAttachment(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    data_base64: str


class SendBody(BaseModel):
    to: list[str] = []
    cc: list[str] = []
    bcc: list[str] = []
    subject: str = ""
    text: str = ""
    html: str | None = None
    in_reply_to: str | None = None
    references: str | None = None
    attachments: list[OutgoingAttachment] = []


def _address(name: str, addr: str) -> Address:
    addr = addr.strip()
    local, _, domain = addr.rpartition("@")
    if not local or not domain or any(c.isspace() for c in addr):
        raise MailError(400, f"“{addr or name}” is not a valid email address.", "recipients")
    try:
        return Address(display_name=_one_line(name), addr_spec=addr)
    except Exception:
        raise MailError(400, f"“{addr}” is not a valid email address.", "recipients") from None


def _recipients(values: list[str]) -> list[Address]:
    out = []
    for value in values:
        value = _one_line(value)
        if not value:
            continue
        for name, addr in email.utils.getaddresses([value]):
            if not name and not addr:
                raise MailError(400, f"“{value}” is not a valid email address.", "recipients")
            out.append(_address(name, addr or name))
    return out


def _attachment_type(content_type: str, filename: str) -> tuple[str, str]:
    ctype = (content_type or "").split(";")[0].strip().lower()
    if not _MIME_TYPE.fullmatch(ctype):
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    maintype, subtype = ctype.split("/", 1)
    if maintype in ("multipart", "message"):
        return "application", "octet-stream"
    return maintype, subtype


def build_message(account: dict, body: SendBody) -> tuple[EmailMessage, list[str]]:
    """The message to send, and every envelope recipient (Bcc included, never in the headers)."""
    to, cc, bcc = _recipients(body.to), _recipients(body.cc), _recipients(body.bcc)
    if not (to or cc or bcc):
        raise MailError(400, "Add at least one recipient.", "recipients")
    sender = _address(account.get("display_name") or "", account["email"])
    msg = EmailMessage(policy=_POLICY)
    msg["From"] = sender
    if to:
        msg["To"] = to
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = _one_line(body.subject)
    msg["Date"] = email.utils.format_datetime(datetime.now().astimezone())
    msg["Message-ID"] = email.utils.make_msgid(domain=sender.domain or "kherveos.local")
    parent = _msgids(body.in_reply_to)[:1]
    refs = list(dict.fromkeys(_msgids(body.references) + parent))
    if len(refs) > 20:  # keep the thread's first message and the most recent ones
        refs = refs[:1] + refs[-19:]
    if parent:
        msg["In-Reply-To"] = parent[0]
    if refs:
        msg["References"] = " ".join(refs)
    msg["User-Agent"] = "KherveOS Mail"
    msg.set_content(body.text or "")
    if body.html:
        msg.add_alternative(body.html, subtype="html")
    total = 0
    for att in body.attachments:
        filename = _safe_filename(_one_line(att.filename), "attachment")
        data64 = att.data_base64.split(",", 1)[1] if att.data_base64.startswith("data:") else att.data_base64
        try:
            data = base64.b64decode(data64)
        except (ValueError, binascii.Error):
            raise MailError(400, f"The attachment “{filename}” could not be read.", "attachments") from None
        total += len(data)
        if total > MAX_ATTACHMENTS:
            raise MailError(
                413, "Attachments are limited to 25 MB in total — most mail providers refuse bigger messages.", "attachments"
            )
        maintype, subtype = _attachment_type(att.content_type, filename)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    recipients = list(dict.fromkeys(a.addr_spec for a in (*to, *cc, *bcc)))
    return msg, recipients


# --------------------------------------------------------------- networking

def _ca_bundles() -> Iterator[str]:
    yield from ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt")
    try:
        import certifi  # type: ignore[import-not-found]

        yield certifi.where()
    except ImportError:
        pass


_ssl_ctx: ssl.SSLContext | None = None


def _ssl_context() -> ssl.SSLContext:
    """A verifying TLS context. Some Pythons (python.org builds on macOS) ship without CA
    certificates; then the system's bundle (or certifi's) is loaded."""
    global _ssl_ctx
    if _ssl_ctx is None:
        ctx = ssl.create_default_context()
        if not ctx.cert_store_stats().get("x509_ca"):
            for cafile in _ca_bundles():
                try:
                    ctx.load_verify_locations(cafile=cafile)
                    break
                except (OSError, ssl.SSLError):
                    continue
        _ssl_ctx = ctx
    return _ssl_ctx


@functools.lru_cache(maxsize=1)
def _ehlo_name() -> str:
    # smtplib's default (socket.getfqdn) can stall for seconds on a Mac.
    name = socket.gethostname()
    return name if re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,250}[A-Za-z0-9])?", name or "") else "localhost"


def _security_hint(service: str, port: int, security: str) -> str:
    ssl_port, starttls_ports = (993, (143,)) if service == "IMAP" else (465, (587, 25))
    if port == ssl_port and security != "ssl":
        return f"Port {port} normally uses SSL/TLS."
    if port in starttls_ports and security == "ssl":
        return f"Port {port} normally uses STARTTLS, not SSL/TLS."
    return "Check the server name, port and security settings."


@contextmanager
def _network_errors(service: str, host: str, port: int, security: str) -> Iterator[None]:
    """Turn socket, TLS and protocol failures into readable MailErrors."""
    label, where = _LABEL[service], f"{host}:{port}"
    try:
        yield
    except MailError:
        raise
    except ssl.SSLCertVerificationError as e:
        reason = getattr(e, "verify_message", None) or getattr(e, "reason", None) or _text(e)
        raise MailError(502, f"{label}: the security certificate of {host} could not be verified ({reason}).", "tls") from None
    except ssl.SSLError as e:
        raise MailError(
            502,
            f"{label}: the encrypted (TLS) connection to {where} failed ({getattr(e, 'reason', None) or _text(e)}). "
            f"{_security_hint(service, port, security)}",
            "tls",
        ) from None
    except socket.gaierror:
        raise MailError(502, f"{label}: cannot find the server “{host}”. Check its name.", "connect") from None
    except ConnectionRefusedError:
        raise MailError(502, f"{label}: {where} refused the connection. Check the port.", "connect") from None
    except TimeoutError:
        raise MailError(
            502, f"{label}: {where} did not answer within {TIMEOUT} seconds. {_security_hint(service, port, security)}", "connect"
        ) from None
    except smtplib.SMTPNotSupportedError as e:
        raise MailError(502, f"{label}: {where} doesn't support {_text(e)}.", "tls") from None
    except smtplib.SMTPConnectError as e:
        raise MailError(502, f"{label}: {where} refused the connection ({_smtp_text(e)}).", "connect") from None
    except (imaplib.IMAP4.abort, smtplib.SMTPServerDisconnected, ConnectionError, EOFError) as e:
        why = _text(e) or "no reason given"
        raise MailError(
            502, f"{label}: {where} closed the connection ({why}). {_security_hint(service, port, security)}", "connect"
        ) from None
    except smtplib.SMTPResponseException as e:
        raise MailError(502, f"{label}: the server answered {_smtp_text(e)}.", "server") from None
    except OSError as e:
        raise MailError(502, f"{label}: cannot connect to {where} ({e.strerror or _text(e)}).", "connect") from None
    except imaplib.IMAP4.error as e:
        raise MailError(502, f"{label}: {_text(e)}", "server") from None


def _smtp_text(e: smtplib.SMTPResponseException) -> str:
    return f"{e.smtp_code} {_text(e.smtp_error)}".strip()


def _auth_error(service: str, host: str, server_said: str) -> MailError:
    message = f"{_LABEL[service]}: the server refused the user name or password."
    if server_said:
        message += f" It said: “{server_said[:200]}”."
    host = host.lower()
    if host.endswith(("gmail.com", "googlemail.com")):
        message += " Gmail needs an app password (Google Account › Security › App passwords), not your normal password."
    elif host.endswith("mail.me.com"):
        message += " iCloud needs an app-specific password from account.apple.com."
    elif "yahoo" in host or "fastmail" in host:
        message += " This provider needs an app password, not your normal password."
    return MailError(400, message, "auth")


def _quote(value: str) -> str:
    """An IMAP quoted string. CR, LF and NUL can't be quoted (or injected)."""
    if any(c in value for c in "\r\n\0"):
        raise MailError(400, "Folder names and searches can't contain line breaks.", "input")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _mailbox_arg(raw: str) -> str:
    if len(raw) > 1000:
        raise MailError(400, "That folder name is too long.", "input")
    return _quote(raw if raw.isascii() else encode_mutf7(raw))


_SPECIAL_USE = {
    "\\sent": "sent", "\\drafts": "drafts", "\\trash": "trash", "\\junk": "junk", "\\archive": "archive",
    "\\all": "all", "\\flagged": "flagged", "\\important": "important",
}
_ROLE_NAMES = {
    "sent": (
        "sent", "sent items", "sent mail", "sent messages", "sent-mail", "gesendet", "gesendete elemente",
        "gesendete objekte", "envoyés", "envoyes", "éléments envoyés", "messages envoyés", "enviados",
        "elementos enviados", "inviata", "posta inviata", "verzonden", "verzonden items",
    ),
    "drafts": ("drafts", "draft", "brouillons", "entwürfe", "borradores", "bozze", "concepten"),
    "trash": (
        "trash", "deleted", "deleted items", "deleted messages", "bin", "corbeille", "éléments supprimés",
        "papierkorb", "gelöschte elemente", "papelera", "elementos eliminados", "cestino", "prullenbak",
    ),
    "junk": (
        "junk", "spam", "junk e-mail", "junk email", "junk mail", "bulk mail", "courrier indésirable",
        "indésirables", "pourriel", "spamverdacht", "correo no deseado", "posta indesiderata", "ongewenste e-mail",
    ),
    "archive": ("archive", "archives", "archiv", "archivo", "archivio", "archief"),
}
_ROLE_BY_NAME = {name: role for role, names in _ROLE_NAMES.items() for name in names}
_STATUS_ROLES = ("inbox", "junk", "drafts")


def _folder_entries(data: Any) -> list[dict]:
    """LIST responses → folders with decoded names and roles (SPECIAL-USE flags, else common names)."""
    folders = []
    for resp in _responses(data):
        vals = parse_imap(resp)
        if len(vals) < 3 or not isinstance(vals[0], list) or vals[2] is None:
            continue
        flags = [f for f in vals[0] if isinstance(f, str)]
        lower = {f.lower() for f in flags}
        delim = _s(vals[1]) or None
        raw = _s(vals[2])
        is_inbox = raw.upper() == "INBOX"
        name = "INBOX" if is_inbox else decode_mutf7(raw)
        role = "inbox" if is_inbox else next((r for f, r in _SPECIAL_USE.items() if f in lower), None)
        folders.append({
            "name": name,
            "raw": "INBOX" if is_inbox else raw,
            "delimiter": delim,
            "label": "Inbox" if is_inbox else (name.rsplit(delim, 1)[-1] if delim else name),
            "role": role,
            "flags": flags,
            "selectable": not ({"\\noselect", "\\nonexistent"} & lower),
            "depth": name.count(delim) if delim else 0,
            "unread": None,
            "total": None,
        })
    taken = {f["role"] for f in folders if f["role"]}
    for f in sorted(folders, key=lambda f: f["depth"]):
        role = _ROLE_BY_NAME.get(f["label"].lower())
        if not f["role"] and f["selectable"] and role and role not in taken:
            f["role"] = role
            taken.add(role)
    return folders


class ImapSession:
    """One logged-in IMAP connection and the operations the endpoints need."""

    LIST_ITEMS = (
        "(UID FLAGS RFC822.SIZE INTERNALDATE BODYSTRUCTURE "
        "BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC DATE MESSAGE-ID CONTENT-TYPE)])"
    )

    def __init__(self, imap: imaplib.IMAP4, capabilities: set[str], host: str) -> None:
        self.imap = imap
        self.caps = capabilities
        self.host = host
        self.broken = False

    # -- plumbing

    def call(self, what: str, fn: Callable, *args: Any, check: bool = True) -> tuple[str, list]:
        """Run one imaplib command; failures become MailErrors (and mark a dead connection)."""
        try:
            typ, data = fn(*args)
        except imaplib.IMAP4.readonly:
            raise MailError(403, "This folder is read-only.", "readonly") from None
        except imaplib.IMAP4.abort as e:
            self.broken = True
            raise MailError(502, f"The connection to the mail server was lost while trying to {what} ({_text(e)}). Please try again.", "connect") from None
        except imaplib.IMAP4.error as e:
            raise MailError(502, f"The mail server could not {what}: {_text(e)}", "server") from None
        except (OSError, EOFError) as e:
            self.broken = True
            why = "did not answer in time" if isinstance(e, TimeoutError) else f"connection failed ({_text(e)})"
            raise MailError(502, f"The mail server {why} while trying to {what}.", "connect") from None
        if check and typ != "OK":
            raise MailError(502, f"The mail server could not {what}: {_text(data)}", "server")
        return typ, data

    def reset(self) -> None:
        """Forget responses left over from an earlier request: imaplib refuses every
        command after a stray [READ-ONLY] until its untagged responses are flushed."""
        try:
            self.imap.untagged_responses = {}
        except Exception:
            pass

    def alive(self) -> bool:
        sock = getattr(self.imap, "sock", None)
        try:
            if sock is not None:
                sock.settimeout(5)
            return self.imap.noop()[0] == "OK"
        except Exception:
            return False
        finally:
            if sock is not None:
                try:
                    sock.settimeout(TIMEOUT)
                except OSError:
                    pass

    def close(self) -> None:
        imap = self.imap
        try:
            sock = getattr(imap, "sock", None)
            if sock is not None:
                sock.settimeout(3)
            imap.logout()
        except Exception:
            _close_imap(imap)

    # -- folders

    def folders(self, counts: bool = True) -> list[dict]:
        _, data = self.call("list the folders", self.imap.list)
        folders = _folder_entries(data)
        if counts:
            few_custom = sum(1 for f in folders if f["selectable"] and not f["role"]) <= 30
            for f in folders:
                if f["selectable"] and (f["role"] in _STATUS_ROLES or (f["role"] is None and few_custom)):
                    status = self.status(f["raw"])
                    f["unread"], f["total"] = status.get("UNSEEN"), status.get("MESSAGES")
        return folders

    def status(self, raw: str) -> dict[str, int | None]:
        try:
            _, data = self.call("count the messages", self.imap.status, _mailbox_arg(raw), "(MESSAGES UNSEEN)")
        except MailError:
            if self.broken:
                raise
            return {}
        for resp in _responses(data):
            lst = next((v for v in reversed(parse_imap(resp)) if isinstance(v, list)), None)
            if lst:
                return {_s(lst[i]).upper(): _int(lst[i + 1]) for i in range(0, len(lst) - 1, 2)}
        return {}

    def role_folder(self, role: str) -> str | None:
        return next((f["raw"] for f in self.folders(counts=False) if f["role"] == role and f["selectable"]), None)

    def select(self, folder: str, readonly: bool = True) -> tuple[int, int | None]:
        """Open a folder; returns (number of messages, UIDVALIDITY)."""
        typ, data = self.call("open the folder", self.imap.select, _mailbox_arg(folder), readonly, check=False)
        if typ != "OK":
            raise MailError(404, f"The folder “{decode_mutf7(folder)}” doesn't exist on the mail server (any more).", "folder")
        uidvalidity = (self.imap.untagged_responses.get("UIDVALIDITY") or [None])[-1]
        return _int(data[0] if data else None) or 0, _int(uidvalidity)

    # -- messages

    def search(self, query: str) -> list[int]:
        q = _one_line(query)[:200]
        if q.isascii():
            _, data = self.call("search", self.imap.uid, "SEARCH", "TEXT", _quote(q))
        else:
            self.imap.literal = q.encode("utf-8")
            _, data = self.call("search", self.imap.uid, "SEARCH", "CHARSET", "UTF-8", "TEXT")
        uids: list[int] = []
        for chunk in data or ():
            if isinstance(chunk, (bytes, bytearray)):
                uids += [int(x) for x in bytes(chunk).split() if x.isdigit()]
        return uids

    def messages(self, folder: str, offset: int, limit: int, query: str = "") -> tuple[list[dict], int, int | None]:
        """A page of the folder, newest first, read with BODY.PEEK so nothing gets marked as read."""
        exists, uidvalidity = self.select(folder, readonly=True)
        if query.strip():
            uids = sorted(set(self.search(query)), reverse=True)
            total, page = len(uids), uids[offset:offset + limit]
            if not page:
                return [], total, uidvalidity
            _, data = self.call("read the message list", self.imap.uid, "FETCH", ",".join(map(str, page)), self.LIST_ITEMS)
        else:
            total = exists
            if offset >= exists:
                return [], total, uidvalidity
            hi = exists - offset
            lo = max(1, hi - limit + 1)
            _, data = self.call("read the message list", self.imap.fetch, f"{lo}:{hi}", self.LIST_ITEMS)
        merged: dict[int, dict] = {}
        for item in _fetch_items(data):
            uid = _int(item.get("UID"))
            if uid is not None:
                merged.setdefault(uid, {}).update(item)
        rows = [row for row in map(_summary, merged.values()) if row]
        rows.sort(key=lambda r: r["uid"], reverse=True)
        return rows, total, uidvalidity

    def fetch_message(self, uid: int) -> tuple[bytes, set[str]]:
        _, data = self.call("read the message", self.imap.uid, "FETCH", str(uid), "(UID FLAGS BODY.PEEK[])")
        for item in _fetch_items(data):
            if _int(item.get("UID")) == uid and isinstance(item.get("BODY[]"), bytes):
                return item["BODY[]"], _flag_set(item.get("FLAGS"))
        raise MailError(404, "This message isn't there any more — it may have been moved or deleted.", "gone")

    def fetch_flags(self, uid: int) -> set[str]:
        _, data = self.call("read the message", self.imap.uid, "FETCH", str(uid), "(UID FLAGS)")
        for item in _fetch_items(data):
            if _int(item.get("UID")) == uid:
                return _flag_set(item.get("FLAGS"))
        raise MailError(404, "This message isn't there any more — it may have been moved or deleted.", "gone")

    def set_flag(self, uid: int, flag: str, on: bool) -> None:
        self.call("update the message", self.imap.uid, "STORE", str(uid), "+FLAGS.SILENT" if on else "-FLAGS.SILENT", f"({flag})")

    def expunge(self, uid: int) -> None:
        if "UIDPLUS" in self.caps:
            self.call("delete the message", self.imap.uid, "EXPUNGE", str(uid))
        else:
            self.call("delete the message", self.imap.expunge)

    def move(self, uid: int, dest: str) -> None:
        """Move a message out of the selected folder (MOVE, else COPY + delete)."""
        target = _mailbox_arg(dest)
        if "MOVE" in self.caps:
            typ, data = self.call("move the message", self.imap.uid, "MOVE", str(uid), target, check=False)
        else:
            typ, data = self.call("copy the message", self.imap.uid, "COPY", str(uid), target, check=False)
            if typ == "OK":
                self.set_flag(uid, "\\Deleted", True)
                self.expunge(uid)
        if typ != "OK":
            said = _text(data)
            if "TRYCREATE" in said.upper() or "NONEXISTENT" in said.upper():
                raise MailError(404, f"The folder “{decode_mutf7(dest)}” doesn't exist on the mail server.", "folder")
            raise MailError(502, f"The mail server could not move the message: {said}", "server")

    def append(self, folder: str, raw: bytes, flags: str = "(\\Seen)") -> None:
        self.call("save a copy of the message", self.imap.append, _mailbox_arg(folder), flags, time.time(), raw)


def _close_imap(imap: Any) -> None:
    try:
        imap.shutdown()
    except Exception:
        pass


def _imap_connect(host: str, port: int, security: str) -> imaplib.IMAP4:
    """Open (but don't log in to) an IMAP connection. Tests replace this."""
    if security == "ssl":
        return imaplib.IMAP4_SSL(host, port, ssl_context=_ssl_context(), timeout=TIMEOUT)
    imap = imaplib.IMAP4(host, port, timeout=TIMEOUT)
    if security == "starttls":
        try:
            if "STARTTLS" not in imap.capabilities:
                raise MailError(
                    502, f"{_LABEL['IMAP']}: {host}:{port} doesn't offer STARTTLS. Choose SSL/TLS (usually port 993).", "tls"
                )
            imap.starttls(ssl_context=_ssl_context())
        except BaseException:
            _close_imap(imap)
            raise
    return imap


def _capabilities_after_login(imap: Any, login_reply: Any) -> set[str]:
    m = re.search(r"\[CAPABILITY ([^\]]*)\]", " ".join(_s(x) for x in login_reply or () if not isinstance(x, tuple)), re.I)
    if m:
        return {c.upper() for c in m.group(1).split()}
    try:
        typ, data = imap.capability()
        if typ == "OK" and data and data[-1]:
            return {c.upper() for c in _s(data[-1]).split()}
    except imaplib.IMAP4.error:
        pass
    return set()


def _login_imap(host: str, port: int, security: str, username: str, password: str) -> ImapSession:
    with _network_errors("IMAP", host, port, security):
        imap = _imap_connect(host, port, security)
        try:
            caps = {str(c).upper() for c in getattr(imap, "capabilities", ())}
            if security == "none" and "LOGINDISABLED" in caps:
                raise MailError(
                    400, f"{_LABEL['IMAP']}: this server only accepts passwords over an encrypted connection. Choose SSL/TLS or STARTTLS.", "tls"
                )
            try:
                if (username + password).isascii():
                    _, reply = imap.login(username, password)
                else:
                    blob = b"\0" + username.encode() + b"\0" + password.encode()
                    _, reply = imap.authenticate("PLAIN", lambda _challenge: blob)
            except imaplib.IMAP4.abort:
                raise
            except imaplib.IMAP4.error as e:
                raise _auth_error("IMAP", host, _text(e)) from None
            caps = _capabilities_after_login(imap, reply) or caps
            try:
                imap.capabilities = tuple(sorted(caps))
            except Exception:
                pass
        except BaseException:
            _close_imap(imap)
            raise
    return ImapSession(imap, caps, host)


def _smtp_connect(host: str, port: int, security: str) -> smtplib.SMTP:
    """Open an SMTP connection, upgraded to TLS as configured (not logged in). Tests replace this."""
    ctx = _ssl_context()
    if security == "ssl":
        smtp: smtplib.SMTP = smtplib.SMTP_SSL(host, port, local_hostname=_ehlo_name(), timeout=TIMEOUT, context=ctx)
    else:
        smtp = smtplib.SMTP(host, port, local_hostname=_ehlo_name(), timeout=TIMEOUT)
    try:
        smtp.ehlo()
        if security == "starttls":
            if not smtp.has_extn("starttls"):
                raise MailError(
                    502, f"{_LABEL['SMTP']}: {host}:{port} doesn't offer STARTTLS. Choose SSL/TLS (usually port 465).", "tls"
                )
            smtp.starttls(context=ctx)
            smtp.ehlo()
    except BaseException:
        _close_smtp(smtp)
        raise
    return smtp


def _close_smtp(smtp: smtplib.SMTP) -> None:
    try:
        if getattr(smtp, "sock", None) is not None:
            smtp.sock.settimeout(3)
        smtp.quit()
    except Exception:
        try:
            smtp.close()
        except Exception:
            pass


@contextmanager
def _smtp_session(settings: dict, password: str) -> Iterator[smtplib.SMTP]:
    """A logged-in SMTP connection for an account (or for settings being tested)."""
    host, port, security = settings["smtp_host"], int(settings["smtp_port"]), settings["smtp_security"]
    username = settings.get("username") or settings["email"]
    with _network_errors("SMTP", host, port, security):
        smtp = _smtp_connect(host, port, security)
        try:
            if smtp.has_extn("auth"):
                try:
                    smtp.login(username, password)
                except smtplib.SMTPAuthenticationError as e:
                    raise _auth_error("SMTP", host, _text(e.smtp_error)) from None
                except UnicodeEncodeError:
                    raise MailError(
                        400, f"{_LABEL['SMTP']}: the user name or password has characters this server can't accept.", "auth"
                    ) from None
                except smtplib.SMTPException as e:
                    if type(e) is not smtplib.SMTPException:
                        raise
                    raise MailError(502, f"{_LABEL['SMTP']}: the server offers no login method KherveOS knows ({_text(e)}).", "auth") from None
            elif security == "none" and smtp.has_extn("starttls"):
                raise MailError(
                    400, f"{_LABEL['SMTP']}: this server only accepts passwords over an encrypted connection. Choose STARTTLS.", "tls"
                )
            yield smtp
        finally:
            _close_smtp(smtp)


def _sendmail(smtp: smtplib.SMTP, sender: str, recipients: list[str], raw: bytes) -> dict:
    """Send; returns the recipients the server refused (when it accepted some)."""
    try:
        return smtp.sendmail(sender, recipients, raw)
    except smtplib.SMTPRecipientsRefused as e:
        bad = "; ".join(f"{addr} ({code} {_text(msg)})" for addr, (code, msg) in e.recipients.items())
        raise MailError(400, f"The mail server refused the recipients: {bad}", "recipients") from None
    except smtplib.SMTPSenderRefused as e:
        raise MailError(400, f"The mail server won't send from {sender}: {_smtp_text(e)}", "sender") from None
    except smtplib.SMTPDataError as e:
        raise MailError(502, f"The mail server rejected the message: {_smtp_text(e)}", "server") from None


# ----------------------------------------------------------- connection cache
#
# Logging in costs a TLS handshake and a few round trips, so a logged-in
# connection is put back after each request and reused for a few minutes.
# Each request has a connection of its own (imaplib isn't thread-safe); a
# connection that was idle a while is checked with NOOP before reuse.

_POOL_IDLE = 300.0
_POOL_CHECK_AFTER = 30.0
_POOL_PER_ACCOUNT = 3
_pool: dict[tuple, list[tuple[float, ImapSession]]] = {}
_pool_lock = threading.Lock()


def _close_later(sessions: list[ImapSession]) -> None:
    """Log out in the background: a dead socket can take seconds to give up."""
    if sessions:
        threading.Thread(target=lambda: [s.close() for s in sessions], name="mail-logout", daemon=True).start()


def _pool_key(account: dict) -> tuple:
    return (
        account["id"], account["imap_host"], int(account["imap_port"]), account["imap_security"],
        account["username"], account["password_enc"],
    )


def _checkout(key: tuple) -> ImapSession | None:
    now = time.monotonic()
    stale: list[ImapSession] = []
    found: ImapSession | None = None
    idle = 0.0
    with _pool_lock:
        for k in list(_pool):
            fresh = [(t, s) for t, s in _pool[k] if now - t <= _POOL_IDLE]
            stale += [s for t, s in _pool[k] if now - t > _POOL_IDLE]
            if fresh:
                _pool[k] = fresh
            else:
                del _pool[k]
        if _pool.get(key):
            last_used, found = _pool[key].pop()
            idle = now - last_used
            if not _pool[key]:
                del _pool[key]
    _close_later(stale)
    if found is not None:
        found.reset()
        if idle > _POOL_CHECK_AFTER and not found.alive():
            found.close()
            found = None
    return found


def _checkin(key: tuple, session: ImapSession) -> None:
    if session.broken:
        session.close()
        return
    with _pool_lock:
        entries = _pool.setdefault(key, [])
        keep = len(entries) < _POOL_PER_ACCOUNT
        if keep:
            entries.append((time.monotonic(), session))
    if not keep:
        _close_later([session])


def _forget_account(account_id: int) -> None:
    doomed: list[ImapSession] = []
    with _pool_lock:
        for k in [k for k in _pool if k[0] == account_id]:
            doomed += [s for _, s in _pool.pop(k)]
    for s in doomed:
        s.close()
    _raw_cache.forget(account_id)


def reset_connections() -> None:
    """Close every cached connection (used by the tests)."""
    with _pool_lock:
        doomed = [s for entries in _pool.values() for _, s in entries]
        _pool.clear()
    for s in doomed:
        s.close()
    _raw_cache.clear()


def _connect_account(account: dict) -> ImapSession:
    return _login_imap(
        account["imap_host"], int(account["imap_port"]), account["imap_security"],
        account["username"] or account["email"], decrypt_password(account["password_enc"]),
    )


@contextmanager
def imap_session(account: dict) -> Iterator[ImapSession]:
    """A logged-in IMAP connection for the account, from the cache when there is one."""
    key = _pool_key(account)
    session = _checkout(key) or _connect_account(account)
    try:
        yield session
    except MailError:
        _checkin(key, session)  # closes it if it broke
        raise
    except BaseException:
        session.close()
        raise
    else:
        _checkin(key, session)


class _RawCache:
    """Recently read messages, so downloading attachments doesn't fetch a message again."""

    def __init__(self, max_bytes: int = 48 * 1024 * 1024, ttl: float = 600.0) -> None:
        self.max_bytes, self.ttl = max_bytes, ttl
        self._items: OrderedDict[tuple, tuple[float, bytes]] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def get(self, key: tuple) -> bytes | None:
        with self._lock:
            hit = self._items.get(key)
            if hit is None:
                return None
            if time.monotonic() - hit[0] > self.ttl:
                self._drop(key)
                return None
            self._items.move_to_end(key)
            return hit[1]

    def put(self, key: tuple, data: bytes) -> None:
        if len(data) > self.max_bytes // 4:
            return
        with self._lock:
            if key in self._items:
                self._drop(key)
            self._items[key] = (time.monotonic(), data)
            self._size += len(data)
            while self._size > self.max_bytes and self._items:
                self._drop(next(iter(self._items)))

    def forget(self, account_id: int) -> None:
        with self._lock:
            for key in [k for k in self._items if k[0] == account_id]:
                self._drop(key)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._size = 0

    def _drop(self, key: tuple) -> None:
        _, data = self._items.pop(key)
        self._size -= len(data)


_raw_cache = _RawCache()


def _load_raw(s: ImapSession, account: dict, folder: str, uidvalidity: int | None, uid: int, flags: bool = True) -> tuple[bytes, set[str]]:
    key = (account["id"], account["imap_host"], account["username"], folder, uidvalidity, uid) if uidvalidity else None
    cached = _raw_cache.get(key) if key else None
    if cached is not None:
        return cached, (s.fetch_flags(uid) if flags else set())
    raw, flag_set = s.fetch_message(uid)
    if key:
        _raw_cache.put(key, raw)
    return raw, flag_set


# ------------------------------------------------------------------ accounts

_PUBLIC_FIELDS = (
    "id", "email", "display_name", "imap_host", "imap_port", "imap_security",
    "smtp_host", "smtp_port", "smtp_security", "username", "created_at",
)
_CONNECTION_FIELDS = ("imap_host", "imap_port", "imap_security", "smtp_host", "smtp_port", "smtp_security", "username")
_EMAIL = re.compile(r"^[^@\s<>\"]+@[^@\s<>\"]+$")
_HOST = re.compile(r"^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\]|[0-9A-Fa-f:]+)$")


class AccountIn(BaseModel):
    email: str
    password: str
    display_name: str = ""
    username: str = ""
    provider: str = ""
    imap_host: str = ""
    imap_port: int | None = None
    imap_security: Security | None = None
    smtp_host: str = ""
    smtp_port: int | None = None
    smtp_security: Security | None = None


class AccountPatch(BaseModel):
    display_name: str | None = None
    password: str | None = None
    username: str | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    imap_security: Security | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_security: Security | None = None


def _public(account: dict) -> dict:
    out = {k: account[k] for k in _PUBLIC_FIELDS}
    out["provider"] = _provider_id_for_host(account["imap_host"])
    return out


def _account(user: User, account_id: int) -> dict:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM mail_accounts WHERE id = ? AND user_id = ?", (account_id, user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "No such mail account.")
    return dict(row)


def _validate(settings: dict) -> None:
    for service in ("imap", "smtp"):
        label = _LABEL[service.upper()]
        host = settings[f"{service}_host"]
        if not host:
            raise MailError(400, f"{label}: enter the server name (for example {service}.example.com).", "input")
        if not _HOST.match(host):
            raise MailError(400, f"{label}: “{host}” is not a valid server name.", "input")
        if not 1 <= int(settings[f"{service}_port"]) <= 65535:
            raise MailError(400, f"{label}: the port must be between 1 and 65535.", "input")
        if settings[f"{service}_security"] not in DEFAULT_PORTS[service]:
            raise MailError(400, f"{label}: unknown security setting.", "input")


def _resolve_settings(body: AccountIn) -> dict:
    """The settings to test and store: what the form sent, completed from the provider preset."""
    address = body.email.strip()
    if not _EMAIL.match(address):
        raise MailError(400, "Enter a valid email address.", "input")
    if not body.password:
        raise MailError(400, "Enter the password (or app password) for this account.", "input")
    preset = _provider_for(body.provider, address.rsplit("@", 1)[1].lower())
    if preset and not preset["supported"] and not (body.imap_host.strip() and body.smtp_host.strip()):
        raise MailError(400, preset["note"], "unsupported")
    settings: dict[str, Any] = {
        "email": address,
        "display_name": _one_line(body.display_name)[:120],
        "username": body.username.strip() or address,
    }
    for service in ("imap", "smtp"):
        defaults = (preset or {}).get(service) or {}
        security = getattr(body, f"{service}_security") or defaults.get("security") or "ssl"
        port = getattr(body, f"{service}_port")
        if not port:
            port = defaults["port"] if defaults.get("security") == security else DEFAULT_PORTS[service][security]
        settings[f"{service}_host"] = getattr(body, f"{service}_host").strip() or defaults.get("host", "")
        settings[f"{service}_port"] = int(port)
        settings[f"{service}_security"] = security
    _validate(settings)
    return settings


def _check_login(settings: dict, password: str) -> ImapSession:
    """Log in to IMAP and to SMTP with these settings; returns the IMAP session."""
    session = _login_imap(
        settings["imap_host"], int(settings["imap_port"]), settings["imap_security"], settings["username"], password
    )
    try:
        with _smtp_session(settings, password):
            pass
    except BaseException:
        session.close()
        raise
    return session


# ----------------------------------------------------------------- endpoints

@router.get("/providers")
def providers(user: User = Depends(current_user)):
    return {"providers": PROVIDERS}


@router.get("/accounts")
def list_accounts(user: User = Depends(current_user)):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY created_at, id", (user.id,)).fetchall()
    return {"accounts": [_public(dict(r)) for r in rows]}


@router.post("/accounts")
def add_account(body: AccountIn, user: User = Depends(current_user)):
    settings = _resolve_settings(body)
    with db.connect() as conn:
        if conn.execute(
            "SELECT 1 FROM mail_accounts WHERE user_id = ? AND lower(email) = lower(?)", (user.id, settings["email"])
        ).fetchone():
            raise MailError(409, f"{settings['email']} is already in your accounts.", "duplicate")
    session = _check_login(settings, body.password)
    try:
        account = {**settings, "user_id": user.id, "password_enc": encrypt_password(body.password), "created_at": time.time()}
        with db.connect() as conn:
            cur = conn.execute(
                """INSERT INTO mail_accounts (user_id, email, display_name, imap_host, imap_port, imap_security,
                       smtp_host, smtp_port, smtp_security, username, password_enc, created_at)
                   VALUES (:user_id, :email, :display_name, :imap_host, :imap_port, :imap_security,
                       :smtp_host, :smtp_port, :smtp_security, :username, :password_enc, :created_at)""",
                account,
            )
            account["id"] = cur.lastrowid
    except BaseException:
        session.close()
        raise
    _checkin(_pool_key(account), session)  # the app opens the inbox right away
    return {"account": _public(account)}


@router.patch("/accounts/{account_id}")
def update_account(account_id: int, body: AccountPatch, user: User = Depends(current_user)):
    account = _account(user, account_id)
    updated = dict(account)
    if body.display_name is not None:
        updated["display_name"] = _one_line(body.display_name)[:120]
    for field in _CONNECTION_FIELDS:
        value = getattr(body, field)
        if value is not None:
            updated[field] = value.strip() if isinstance(value, str) else value
    updated["username"] = updated["username"] or updated["email"]
    _validate(updated)
    if body.password or any(updated[f] != account[f] for f in _CONNECTION_FIELDS):
        password = body.password or decrypt_password(account["password_enc"])
        _check_login(updated, password).close()
        if body.password:
            updated["password_enc"] = encrypt_password(body.password)
    with db.connect() as conn:
        conn.execute(
            """UPDATE mail_accounts SET display_name = :display_name, imap_host = :imap_host, imap_port = :imap_port,
                   imap_security = :imap_security, smtp_host = :smtp_host, smtp_port = :smtp_port,
                   smtp_security = :smtp_security, username = :username, password_enc = :password_enc
               WHERE id = :id""",
            updated,
        )
    _forget_account(account_id)
    return {"account": _public(updated)}


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, user: User = Depends(current_user)):
    _account(user, account_id)
    with db.connect() as conn:
        conn.execute("DELETE FROM mail_accounts WHERE id = ? AND user_id = ?", (account_id, user.id))
    _forget_account(account_id)
    return {"ok": True}


@router.get("/accounts/{account_id}/folders")
def folders(account_id: int, user: User = Depends(current_user)):
    account = _account(user, account_id)
    with imap_session(account) as s:
        return {"folders": s.folders()}


@router.get("/accounts/{account_id}/messages")
def list_messages(
    account_id: int,
    folder: str = "INBOX",
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=PAGE_MAX),
    q: str = "",
    user: User = Depends(current_user),
):
    account = _account(user, account_id)
    with imap_session(account) as s:
        rows, total, uidvalidity = s.messages(folder, offset, limit, q)
    return {
        "folder": folder, "query": q, "offset": offset, "limit": limit,
        "total": total, "uidvalidity": uidvalidity, "messages": rows,
    }


@router.get("/accounts/{account_id}/messages/{uid}")
def read_message(account_id: int, uid: int, folder: str = "INBOX", user: User = Depends(current_user)):
    account = _account(user, account_id)
    with imap_session(account) as s:
        writable = True
        try:
            _, uidvalidity = s.select(folder, readonly=False)
        except MailError as e:
            if e.kind != "readonly":
                raise
            writable = False
            _, uidvalidity = s.select(folder, readonly=True)
        raw, flags = _load_raw(s, account, folder, uidvalidity, uid)
        if writable and "\\seen" not in flags:
            s.set_flag(uid, "\\Seen", True)
            flags.add("\\seen")
    parsed = parse_message(raw)
    return {
        "uid": uid,
        "folder": folder,
        **parsed,
        "seen": "\\seen" in flags,
        "flagged": "\\flagged" in flags,
        "answered": "\\answered" in flags,
        "size": len(raw),
    }


def _content_disposition(filename: str) -> str:
    fallback = re.sub(r'[^\x20-\x7e]|["\\]', "_", filename) or "attachment"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{urllib.parse.quote(filename, safe='')}"


@router.get("/accounts/{account_id}/messages/{uid}/attachments/{index}")
def download_attachment(account_id: int, uid: int, index: int, folder: str = "INBOX", user: User = Depends(current_user)):
    account = _account(user, account_id)
    with imap_session(account) as s:
        _, uidvalidity = s.select(folder, readonly=True)
        raw, _ = _load_raw(s, account, folder, uidvalidity, uid, flags=False)
    attachments = parse_message(raw, keep_data=True)["attachments"]
    if not 0 <= index < len(attachments):
        raise HTTPException(404, "No such attachment.")
    att = attachments[index]
    media_type = att["content_type"] if _MIME_TYPE.fullmatch(att["content_type"]) else "application/octet-stream"
    return Response(
        content=att["data"],
        media_type=media_type,
        headers={
            "Content-Disposition": _content_disposition(att["filename"]),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, no-store",
        },
    )


class FlagsBody(BaseModel):
    folder: str = "INBOX"
    seen: bool | None = None
    flagged: bool | None = None
    answered: bool | None = None


@router.post("/accounts/{account_id}/messages/{uid}/flags")
def set_flags(account_id: int, uid: int, body: FlagsBody, user: User = Depends(current_user)):
    account = _account(user, account_id)
    with imap_session(account) as s:
        s.select(body.folder, readonly=False)
        for flag, value in (("\\Seen", body.seen), ("\\Flagged", body.flagged), ("\\Answered", body.answered)):
            if value is not None:
                s.set_flag(uid, flag, value)
    return {"ok": True}


class MoveBody(BaseModel):
    folder: str = "INBOX"
    to: str


@router.post("/accounts/{account_id}/messages/{uid}/move")
def move_message(account_id: int, uid: int, body: MoveBody, user: User = Depends(current_user)):
    account = _account(user, account_id)
    if body.to == body.folder:
        return {"ok": True}
    with imap_session(account) as s:
        s.select(body.folder, readonly=False)
        s.move(uid, body.to)
    return {"ok": True}


class FolderBody(BaseModel):
    folder: str = "INBOX"


@router.post("/accounts/{account_id}/messages/{uid}/delete")
def delete_message(account_id: int, uid: int, body: FolderBody, user: User = Depends(current_user)):
    """Move to the Trash folder; delete for good when there is none (or it's already there)."""
    account = _account(user, account_id)
    with imap_session(account) as s:
        trash = s.role_folder("trash")
        s.select(body.folder, readonly=False)
        if trash and trash != body.folder:
            s.move(uid, trash)
            return {"ok": True, "moved_to": trash}
        s.set_flag(uid, "\\Deleted", True)
        s.expunge(uid)
    return {"ok": True, "moved_to": None}


@router.post("/accounts/{account_id}/send")
def send(account_id: int, body: SendBody, user: User = Depends(current_user)):
    account = _account(user, account_id)
    msg, recipients = build_message(account, body)
    raw = msg.as_bytes()
    with _smtp_session(account, decrypt_password(account["password_enc"])) as smtp:
        refused = _sendmail(smtp, account["email"], recipients, raw)
    warnings = []
    if refused:
        warnings.append("Not delivered to " + ", ".join(refused) + ".")
    saved = False
    if not _is_gmail(account):  # Gmail files sent mail by itself
        try:
            with imap_session(account) as s:
                sent = s.role_folder("sent")
                if sent:
                    s.append(sent, raw)
                    saved = True
                else:
                    warnings.append("This account has no Sent folder, so no copy was kept.")
        except MailError as e:
            warnings.append(f"The copy for your Sent folder could not be saved ({e.message})")
    return {
        "ok": True,
        "message_id": msg["Message-ID"],
        "saved_to_sent": saved,
        "warning": " ".join(warnings) or None,
    }
