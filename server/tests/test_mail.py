"""The Email bridge: MIME/IMAP parsing, password storage, and the /api/mail endpoints.

Endpoint tests talk to an in-memory fake of imaplib.IMAP4 (FakeIMAP) and to a
real SMTP server (aiosmtpd). One end-to-end test runs against pymap, a real
IMAP server, when it is installed (requirements-dev.txt).
"""

import base64
import email
import email.policy
import imaplib
import re
import smtplib
import socket
import ssl
import stat
import subprocess
import sys
import time
from email.message import EmailMessage
from pathlib import Path

import pytest

from conftest import make_user
from kherveos_server import mail

# --------------------------------------------------------------- fixtures


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(autouse=True)
def fresh_connections():
    mail.reset_connections()
    yield
    mail.reset_connections()


class SmtpCollector:
    def __init__(self):
        self.envelopes = []

    async def handle_DATA(self, server, session, envelope):
        self.envelopes.append(envelope)
        return "250 Message accepted"


SMTP_USERS = {(b"me@example.com", b"app-password"), (b"demouser", b"demopass")}


@pytest.fixture(scope="module")
def smtp_server():
    """A real SMTP server on localhost that wants a login (no TLS)."""
    from aiosmtpd.controller import Controller
    from aiosmtpd.smtp import AuthResult, LoginPassword

    def authenticator(server, session, envelope, mechanism, auth_data):
        ok = isinstance(auth_data, LoginPassword) and (auth_data.login, auth_data.password) in SMTP_USERS
        return AuthResult(success=ok, handled=False)  # handled=False: aiosmtpd answers 535 itself

    handler = SmtpCollector()
    port = free_port()
    controller = Controller(
        handler, hostname="127.0.0.1", port=port, authenticator=authenticator, auth_required=True, auth_require_tls=False
    )
    controller.start()
    yield handler, port
    controller.stop()


# ---------------------------------------------------------- the fake IMAP


class FakeMessage:
    def __init__(self, uid, raw, flags=()):
        self.uid = uid
        self.raw = raw
        self.flags = set(flags)
        self.internaldate = "06-Oct-2026 10:00:00 +0000"


class FakeBox:
    def __init__(self, name, flags=()):
        self.name = name
        self.flags = list(flags)
        self.messages = []
        self.next_uid = 1


class FakeServer:
    """An in-memory IMAP server shared by every FakeIMAP connection."""

    def __init__(self, username="me@example.com", password="app-password", caps=("MOVE", "UIDPLUS", "SPECIAL-USE")):
        self.credentials = (username, password)
        self.caps = ["IMAP4rev1", *caps]
        self.boxes = {}
        self.commands = []
        self.logins = 0
        self.connections = []
        self.add_box("INBOX")

    def add_box(self, name, flags=()):
        self.boxes[name] = FakeBox(name, flags)
        return self.boxes[name]

    def deliver(self, box, raw, flags=()):
        b = self.boxes[box]
        msg = FakeMessage(b.next_uid, raw, flags)
        b.next_uid += 1
        b.messages.append(msg)
        return msg.uid


def unquote(arg):
    if arg.startswith('"') and arg.endswith('"'):
        return re.sub(r"\\(.)", r"\1", arg[1:-1])
    return arg


def header_block(raw, fields):
    head = re.split(rb"\r?\n\r?\n", raw, maxsplit=1)[0]
    lines = re.split(rb"\r?\n(?![ \t])", head)
    keep = [line for line in lines if line.split(b":", 1)[0].strip().upper().decode() in fields]
    return b"\r\n".join(keep) + b"\r\n\r\n"


class FakeIMAP:
    """Just enough of imaplib.IMAP4 for the bridge."""

    def __init__(self, server):
        self.server = server
        self.capabilities = ("IMAP4REV1", "AUTH=PLAIN")
        self.untagged_responses = {}
        self.literal = None
        self.box = None
        self.closed = False
        server.connections.append(self)

    def _log(self, *args):
        self.server.commands.append(args)

    def login(self, user, password):
        self._log("LOGIN", user)
        if (user, password) != self.server.credentials:
            raise imaplib.IMAP4.error(b"[AUTHENTICATIONFAILED] Invalid credentials (Failure)")
        self.server.logins += 1
        return "OK", [b"[CAPABILITY " + " ".join(self.server.caps).encode() + b"] Logged in"]

    def capability(self):
        return "OK", [" ".join(self.server.caps).encode()]

    def list(self, directory='""', pattern="*"):
        out = []
        for name, box in self.server.boxes.items():
            flags = " ".join(["\\HasNoChildren", *box.flags])
            if '"' in name:  # sent as a literal, like real servers do
                out += [(f'({flags}) "/" {{{len(name)}}}'.encode(), name.encode()), b""]
            else:
                out.append(f'({flags}) "/" "{name}"'.encode())
        return "OK", out

    def select(self, mailbox, readonly=False):
        self._log("SELECT" if not readonly else "EXAMINE", unquote(mailbox))
        box = self.server.boxes.get(unquote(mailbox))
        if box is None or "\\Noselect" in box.flags:
            return "NO", [b"[NONEXISTENT] Unknown Mailbox"]
        self.box = box
        n = str(len(box.messages)).encode()
        self.untagged_responses = {"UIDVALIDITY": [b"7"], "EXISTS": [n]}
        return "OK", [n]

    def status(self, mailbox, names):
        box = self.server.boxes[unquote(mailbox)]
        unseen = sum(1 for m in box.messages if "\\Seen" not in m.flags)
        return "OK", [f"{mailbox} (MESSAGES {len(box.messages)} UNSEEN {unseen})".encode()]

    def noop(self):
        return "OK", [b"NOOP completed"]

    def logout(self):
        self.closed = True
        return "BYE", [b"Logging out"]

    def shutdown(self):
        self.closed = True

    def expunge(self):
        self._log("EXPUNGE")
        self.box.messages = [m for m in self.box.messages if "\\Deleted" not in m.flags]
        return "OK", [None]

    def append(self, mailbox, flags, date_time, message):
        self._log("APPEND", unquote(mailbox), flags)
        box = self.server.boxes[unquote(mailbox)]
        msg = FakeMessage(box.next_uid, message, re.findall(r"\\\w+", flags or ""))
        box.next_uid += 1
        box.messages.append(msg)
        return "OK", [b"[APPENDUID 7 1] Append completed"]

    def fetch(self, message_set, parts):
        lo, hi = (int(x) for x in message_set.split(":"))
        chosen = [(i + 1, m) for i, m in enumerate(self.box.messages) if lo <= i + 1 <= hi]
        return self._fetch(chosen, parts)

    def _by_uid(self, uid_set):
        wanted = {int(u) for u in uid_set.split(",")}
        return [(i + 1, m) for i, m in enumerate(self.box.messages) if m.uid in wanted]

    def uid(self, command, *args):
        command = command.upper()
        self._log("UID", command, *args)
        if command == "FETCH":
            return self._fetch(self._by_uid(args[0]), args[1])
        if command == "SEARCH":
            if self.literal is not None:
                needle, self.literal = self.literal.decode("utf-8"), None
            else:
                needle = unquote(args[-1])
            hits = [str(m.uid) for m in self.box.messages if needle.lower() in m.raw.decode("utf-8", "replace").lower()]
            return "OK", [" ".join(hits).encode()]
        if command == "STORE":
            uid, how, flags = args
            for _, m in self._by_uid(uid):
                names = set(re.findall(r"\\\w+", flags))
                m.flags = m.flags | names if how.startswith("+") else m.flags - names
            return "OK", [None]
        if command in ("MOVE", "COPY"):
            uid, dest = args
            target = self.server.boxes.get(unquote(dest))
            if target is None:
                return "NO", [b"[TRYCREATE] No such mailbox"]
            for _, m in self._by_uid(uid):
                target.messages.append(FakeMessage(target.next_uid, m.raw, m.flags))
                target.next_uid += 1
                if command == "MOVE":
                    self.box.messages.remove(m)
            return "OK", [None]
        if command == "EXPUNGE":
            uids = {int(args[0])}
            self.box.messages = [m for m in self.box.messages if not (m.uid in uids and "\\Deleted" in m.flags)]
            return "OK", [None]
        raise imaplib.IMAP4.error(f"unexpected UID {command}")

    def _fetch(self, chosen, parts):
        p = parts.upper()
        out = []
        for seq, m in chosen:
            items = [f"UID {m.uid}", f"FLAGS ({' '.join(sorted(m.flags))})"]
            if "RFC822.SIZE" in p:
                items.append(f"RFC822.SIZE {len(m.raw)}")
            if "INTERNALDATE" in p:
                items.append(f'INTERNALDATE "{m.internaldate}"')
            head = " ".join(items)
            if "HEADER.FIELDS" in p:
                if "BODY[HEADER" in p:  # not PEEK: a real server would mark it read
                    m.flags.add("\\Seen")
                fields = re.search(r"HEADER\.FIELDS \(([^)]*)\)", p).group(1).split()
                block = header_block(m.raw, fields)
                out += [(f"{seq} ({head} BODY[HEADER.FIELDS ({' '.join(fields)})] {{{len(block)}}}".encode(), block), b")"]
            elif "BODY.PEEK[]" in p or "BODY[]" in p:
                if "BODY[]" in p:
                    m.flags.add("\\Seen")
                out += [(f"{seq} ({head} BODY[] {{{len(m.raw)}}}".encode(), m.raw), b")"]
            else:
                out.append(f"{seq} ({head})".encode())
        return "OK", out or [None]


@pytest.fixture()
def imap(monkeypatch):
    """A fake IMAP server with the usual folders; every connection the bridge opens goes to it."""
    server = FakeServer()
    server.add_box("Sent", ["\\Sent"])
    server.add_box("Drafts", ["\\Drafts"])
    server.add_box("Trash", ["\\Trash"])
    server.add_box("Spam")  # no SPECIAL-USE flag: found by its name
    server.add_box("Entw&APw-rfe")
    server.add_box('My "Quotes"')
    monkeypatch.setattr(mail, "_imap_connect", lambda host, port, security: FakeIMAP(server))
    return server


def account_body(smtp_port, **extra):
    return {
        "email": "me@example.com",
        "password": "app-password",
        "display_name": "Me Myself",
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "127.0.0.1",
        "smtp_port": smtp_port,
        "smtp_security": "none",
        **extra,
    }


def add_account(client, smtp_port, **extra):
    r = client.post("/api/mail/accounts", json=account_body(smtp_port, **extra))
    assert r.status_code == 200, r.text
    return r.json()["account"]


def make_raw(subject="Hello", sender="Alice <alice@example.com>", to="me@example.com", text="Hi there", html=None,
             attachments=(), date="Mon, 05 Oct 2026 09:30:00 +0200", **headers):
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = date
    msg["Message-ID"] = headers.pop("message_id", f"<{abs(hash(subject))}@example.com>")
    for k, v in headers.items():
        msg[k.replace("_", "-")] = v
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    for name, ctype, data in attachments:
        maintype, subtype = ctype.split("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return msg.as_bytes(policy=email.policy.SMTP)


# ----------------------------------------------------------- unit: parsing


def test_modified_utf7_round_trip():
    assert mail.decode_mutf7("Entw&APw-rfe") == "Entwürfe"
    assert mail.decode_mutf7("~peter/mail/&U,BTFw-/&ZeVnLIqe-") == "~peter/mail/台北/日本語"  # RFC 3501's example
    assert mail.decode_mutf7(b"Tom &- Jerry") == "Tom & Jerry"
    assert mail.encode_mutf7("~peter/mail/台北/日本語") == "~peter/mail/&U,BTFw-/&ZeVnLIqe-"
    assert mail.encode_mutf7("Tom & Jerry") == "Tom &- Jerry"
    for name in ("Envoyés", "Éléments supprimés", "📧 Mail", "Входящие", "a&b", "plain"):
        assert mail.decode_mutf7(mail.encode_mutf7(name)) == name
        assert mail.encode_mutf7(name).isascii()
    # Broken names are shown as they are instead of failing.
    assert mail.decode_mutf7("Bad &!!!- name") == "Bad &!!!- name"
    assert mail.decode_mutf7("Unterminated &AOk") == "Unterminated &AOk"


def test_header_decoding():
    assert mail.header_text("=?utf-8?q?Caf=C3=A9_cr=C3=A8me?=") == "Café crème"
    assert mail.header_text("=?UTF-8?B?wqFIb2xhIQ==?=") == "¡Hola!"
    assert mail.header_text("Re: =?iso-8859-1?q?r=E9union?= demain") == "Re: réunion demain"
    # Whitespace between encoded words disappears; a character split across two words survives.
    assert mail.header_text("=?utf-8?q?a?= =?utf-8?q?b?=") == "ab"
    assert mail.header_text("=?utf-8?b?w6k=?= =?utf-8?b?w6k=?=") == "éé"
    assert mail.header_text("=?utf-8?q?=E2=98?= =?utf-8?q?=95?=") == "☕"
    # Folded headers, missing padding, unknown charsets, garbage.
    assert mail.header_text("A long\r\n subject") == "A long subject"
    assert mail.header_text("=?utf-8?b?w6k?=") == "é"
    assert mail.header_text("=?x-made-up?q?caf=C3=A9?=") == "café"
    assert mail.header_text("=?utf-8?q?ok?= =?bogus") == "ok =?bogus"
    assert mail.header_text(None) == ""
    # Raw 8-bit headers (no encoded words): UTF-8, else Windows-1252.
    msg = email.message_from_bytes(b"Subject: caf\xc3\xa9\r\nFrom: Andr\xe9 <a@b.c>\r\n\r\nx")
    assert mail.header_text(mail._raw(msg, "subject")) == "café"
    assert mail.parse_addresses(mail._raw(msg, "from")) == [{"name": "André", "address": "a@b.c"}]


def test_addresses_and_dates():
    parsed = mail.parse_addresses('"Doe, John" <j@x.org>, =?utf-8?q?Jos=C3=A9?= <jose@x.org>, bob@y.org')
    assert parsed == [
        {"name": "Doe, John", "address": "j@x.org"},
        {"name": "José", "address": "jose@x.org"},
        {"name": "", "address": "bob@y.org"},
    ]
    assert mail.parse_addresses("=?utf-8?q?Doe=2C_Jane?= <jane@x.org>") == [{"name": "Doe, Jane", "address": "jane@x.org"}]
    assert mail.parse_addresses("undisclosed-recipients:;") == []
    assert mail.parse_addresses("") == []

    assert mail.parse_date("Mon, 5 Oct 2026 09:30:00 +0200").isoformat() == "2026-10-05T09:30:00+02:00"
    assert mail.parse_date("05-Oct-2026 09:30:00 -0500").isoformat() == "2026-10-05T09:30:00-05:00"  # INTERNALDATE
    assert mail.parse_date(" 5-Oct-2026 09:30:00 +0000").isoformat() == "2026-10-05T09:30:00+00:00"
    assert mail.parse_date("Mon, 5 Oct 2026 09:30:00").tzinfo is not None  # no zone: UTC
    assert mail.parse_date("yesterday-ish") is None
    assert mail.parse_date(None) is None


def test_imap_response_parsing():
    vals = mail.parse_imap(b'12 (UID 101 FLAGS (\\Seen $Junk) BODY[HEADER.FIELDS (DATE FROM)] {5}\r\nab)cd "q\\"x\\\\" NIL ~{2}\r\n\x00\x01)')
    assert vals == ["12", ["UID", "101", "FLAGS", ["\\Seen", "$Junk"], "BODY[HEADER.FIELDS (DATE FROM)]", b"ab)cd", b'q"x\\', None, b"\x00\x01"]]
    # imaplib splits responses with literals into (line, literal) tuples plus the rest of the line.
    data = [
        (b"1 (UID 5 FLAGS () BODY[HEADER.FIELDS (SUBJECT)] {14}", b"Subject: a\r\n\r\n"),
        (b" BODYSTRUCTURE (\"text\" \"plain\" (\"name\" {3}", b"x.y"),
        b") NIL NIL \"7bit\" 3 1 NIL NIL NIL NIL))",
        b"2 (UID 6 FLAGS (\\Seen))",
        None,
    ]
    items = mail._fetch_items(data)
    assert items[0]["UID"] == "5" and items[0]["BODY[HEADER.FIELDS]"] == b"Subject: a\r\n\r\n"
    assert items[0]["BODYSTRUCTURE"][2] == [b"name", b"x.y"]
    assert items[1] == {"UID": "6", "FLAGS": ["\\Seen"]}


def test_bodystructure_attachment_detection():
    def has(text):
        return mail._bs_has_attachments(mail.parse_imap(text.encode())[0])

    plain = '("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 12 1 NIL NIL NIL NIL)'
    html = '("text" "html" ("charset" "utf-8") NIL NIL "7bit" 100 3 NIL NIL NIL NIL)'
    pdf = '("application" "pdf" ("name" "a.pdf") NIL NIL "base64" 1000 NIL ("attachment" ("filename" "a.pdf")) NIL NIL)'
    logo = '("image" "png" ("name" "logo.png") "<logo@x>" NIL "base64" 500 NIL ("inline" ("filename" "logo.png")) NIL NIL)'
    assert has(plain) is False
    assert has('("TEXT" "PLAIN" NIL NIL NIL "7BIT" 192 10 NIL NIL NIL NIL)') is False
    assert has(f'({plain}{html} "alternative" ("boundary" "a") NIL NIL NIL)') is False
    assert has(f'({plain}{pdf} "mixed" ("boundary" "b") NIL NIL NIL)') is True
    assert has(f'({html}{logo} "related" ("boundary" "c") NIL NIL NIL)') is False
    assert has(f'(({plain}({html}{logo} "related") "alternative"){pdf} "mixed")') is True
    assert has('("message" "rfc822" NIL NIL NIL "7bit" 300 NIL NIL NIL 10 NIL NIL NIL NIL)') is True
    assert mail._bs_has_attachments(None) is None


def test_parse_plain_and_alternative():
    parsed = mail.parse_message(make_raw(subject="Plain", text="Line one\nLine two"))
    assert parsed["headers"]["subject"] == "Plain"
    assert parsed["headers"]["from"] == {"name": "Alice", "address": "alice@example.com"}
    assert parsed["headers"]["date"] == "2026-10-05T09:30:00+02:00"
    assert parsed["text"].strip() == "Line one\nLine two"
    assert parsed["html"] is None and parsed["attachments"] == []

    parsed = mail.parse_message(make_raw(text="Plain version", html="<p>HTML <b>version</b></p>"))
    assert parsed["text"].strip() == "Plain version"
    assert "<b>version</b>" in parsed["html"]

    # HTML only: a text version is made for replies.
    raw = b"Subject: x\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>p{}</style></head><body><p>Caf\xc3\xa9</p><ul><li>one</li><li>two</li></ul>a<br>b</body></html>"
    parsed = mail.parse_message(raw)
    assert parsed["text"] == "Café\n\n• one\n• two\na\nb"


def test_parse_attachments_and_inline_images():
    root = EmailMessage()
    root["From"] = "=?utf-8?q?Jos=C3=A9?= <jose@example.com>"
    root["To"] = "me@example.com, Bob <bob@example.com>"
    root["Cc"] = "carol@example.com"
    root["Reply-To"] = "replies@example.com"
    root["Subject"] = "=?utf-8?q?Photos_=F0=9F=93=B7?="
    root["Message-ID"] = "<abc@example.com>"
    root["In-Reply-To"] = "<parent@example.com>"
    root["References"] = "<root@example.com> <parent@example.com>"
    root.set_content("See the pictures.")
    root.add_alternative('<p>Look: <img src="cid:logo@x"> <img src="cid:missing@x"></p>', subtype="html")
    html_part = root.get_payload()[1]
    html_part.add_related(b"\x89PNG-logo", maintype="image", subtype="png", cid="<logo@x>", filename="logo.png")
    html_part.add_related(b"\x89PNG-unused", maintype="image", subtype="png", cid="<unused@x>")
    root.add_attachment(b"%PDF-1.4 report", maintype="application", subtype="pdf", filename="Résumé été.pdf")
    inner = EmailMessage()
    inner["Subject"] = "Forwarded one"
    inner.set_content("inner text")
    root.add_attachment(inner)
    raw = root.as_bytes(policy=email.policy.SMTP)

    parsed = mail.parse_message(raw, keep_data=True)
    h = parsed["headers"]
    assert h["subject"] == "Photos 📷"
    assert h["from"] == {"name": "José", "address": "jose@example.com"}
    assert [a["address"] for a in h["to"]] == ["me@example.com", "bob@example.com"]
    assert h["cc"] == [{"name": "", "address": "carol@example.com"}]
    assert h["reply_to"] == [{"name": "", "address": "replies@example.com"}]
    assert h["message_id"] == "<abc@example.com>"
    assert h["in_reply_to"] == "<parent@example.com>"
    assert h["references"] == "<root@example.com> <parent@example.com>"
    assert parsed["text"].strip() == "See the pictures."
    # The referenced picture is embedded; the unknown cid stays as it is.
    assert "data:image/png;base64," + base64.b64encode(b"\x89PNG-logo").decode() in parsed["html"]
    assert "cid:missing@x" in parsed["html"]
    names = [a["filename"] for a in parsed["attachments"]]
    assert names == ["Résumé été.pdf", "Forwarded one.eml", "attachment-3.png"]
    pdf, eml, unused = parsed["attachments"]
    assert pdf["data"] == b"%PDF-1.4 report" and pdf["size"] == len(b"%PDF-1.4 report")
    assert pdf["content_type"] == "application/pdf" and [a["index"] for a in parsed["attachments"]] == [0, 1, 2]
    assert eml["content_type"] == "message/rfc822" and b"inner text" in eml["data"]
    assert unused["data"] == b"\x89PNG-unused"
    # Without keep_data there are no bytes in the result.
    assert "data" not in mail.parse_message(raw)["attachments"][0]


def test_parse_bad_charsets_and_odd_filenames():
    raw = (
        b"Subject: =?x-unknown-charset?q?caf=C3=A9?=\r\n"
        b"MIME-Version: 1.0\r\n"
        b'Content-Type: multipart/mixed; boundary="b"\r\n\r\n'
        b"--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLatin-1 lie: caf\xe9\r\n"
        b"--b\r\nContent-Type: text/plain; charset=klingon\r\n\r\nNo such charset: caf\xc3\xa9\r\n"
        b'--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="=?utf-8?b?w6l0w6kucGRm?="\r\n'
        b"Content-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n"
        b"--b\r\nContent-Type: application/x-thing\r\nContent-Disposition: attachment; filename=\"../../etc/passwd\"\r\n\r\nx\r\n"
        b"--b\r\nContent-Type: text/calendar; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n!!!not base64!!!\r\n"
        b"--b--\r\n"
    )
    parsed = mail.parse_message(raw)
    assert parsed["headers"]["subject"] == "café"
    assert "Latin-1 lie: café" in parsed["text"]
    assert "No such charset: café" in parsed["text"]
    names = [a["filename"] for a in parsed["attachments"]]
    assert names[0] == "été.pdf" and parsed["attachments"][0]["size"] == 5
    assert names[1] == "passwd"
    assert names[2] == "attachment-3.ics"
    # Garbage in, something out: never an exception.
    assert mail.parse_message(b"\x00\xff garbage without headers")["attachments"] == []
    assert mail.parse_message(b"")["text"] == ""


def test_build_message():
    account = {"email": "me@example.com", "display_name": "Gwilhérm Kérhervé"}
    body = mail.SendBody(
        to=['"Doe, John" <john@example.com>', "ann@example.com"],
        cc=["carol@example.com"],
        bcc=["secret@example.com"],
        subject="Re: Café\r\nBcc: injected@example.com",
        text="Bonjour à tous,\n> quoted\n",
        in_reply_to="<parent@example.com>",
        references="<root@example.com> <parent@example.com>",
        attachments=[mail.OutgoingAttachment(filename="notes é.txt", content_type="text/plain", data_base64=base64.b64encode(b"notes").decode())],
    )
    msg, recipients = mail.build_message(account, body)
    raw = msg.as_bytes()
    assert raw.isascii() and b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n")
    assert recipients == ["john@example.com", "ann@example.com", "carol@example.com", "secret@example.com"]
    parsed = email.message_from_bytes(raw, policy=email.policy.default)
    assert parsed["From"].addresses[0].display_name == "Gwilhérm Kérhervé"
    assert parsed["From"].addresses[0].addr_spec == "me@example.com"
    assert [a.addr_spec for a in parsed["To"].addresses] == ["john@example.com", "ann@example.com"]
    assert parsed["To"].addresses[0].display_name == "Doe, John"
    assert parsed["Bcc"] is None and b"secret@" not in raw
    assert parsed["Subject"] == "Re: Café Bcc: injected@example.com"  # no header injection
    assert parsed["In-Reply-To"] == "<parent@example.com>"
    assert parsed["References"] == "<root@example.com> <parent@example.com>"
    assert parsed["Message-ID"].endswith("@example.com>") and parsed["Date"]
    assert parsed.get_body(("plain",)).get_content().replace("\r\n", "\n") == "Bonjour à tous,\n> quoted\n"
    att = next(parsed.iter_attachments())
    assert att.get_filename() == "notes é.txt" and att.get_content() in (b"notes", "notes")

    # The reply's parent is appended to References when missing.
    msg, _ = mail.build_message(account, mail.SendBody(to=["a@b.c"], in_reply_to="<p@x>", references="<r@x>"))
    assert msg["References"] == "<r@x> <p@x>"

    with pytest.raises(mail.MailError) as e:
        mail.build_message(account, mail.SendBody(to=["not an address"]))
    assert e.value.status_code == 400 and "not a valid email address" in e.value.detail
    with pytest.raises(mail.MailError):
        mail.build_message(account, mail.SendBody(to=[]))
    big = base64.b64encode(b"x" * (mail.MAX_ATTACHMENTS + 1)).decode()
    with pytest.raises(mail.MailError) as e:
        mail.build_message(account, mail.SendBody(to=["a@b.c"], attachments=[{"filename": "big.bin", "data_base64": big}]))
    assert e.value.status_code == 413


def test_password_encryption(tmp_path, monkeypatch):
    key_path = tmp_path / "keys" / "secret.key"
    monkeypatch.setattr(mail.config, "SECRET_KEY_PATH", key_path)
    token = mail.encrypt_password("p4ssw0rd-é")
    assert "p4ssw0rd" not in token
    assert mail.decrypt_password(token) == "p4ssw0rd-é"
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
    # A fresh process (no cache) reads the same key back.
    monkeypatch.setattr(mail, "_fernet_cache", None)
    assert mail.decrypt_password(token) == "p4ssw0rd-é"
    # A different key can't decrypt it: a clear error, not a crash.
    monkeypatch.setattr(mail.config, "SECRET_KEY_PATH", tmp_path / "other.key")
    with pytest.raises(mail.MailError) as e:
        mail.decrypt_password(token)
    assert e.value.status_code == 409
    # A key file holding some other kind of secret still works (a key is derived from it).
    odd = tmp_path / "odd.key"
    odd.write_bytes(b"not a fernet key")
    monkeypatch.setattr(mail.config, "SECRET_KEY_PATH", odd)
    assert mail.decrypt_password(mail.encrypt_password("x")) == "x"


@pytest.mark.parametrize(
    "exc, kind, words",
    [
        (ssl.SSLCertVerificationError(1, "certificate verify failed"), "tls", "certificate"),
        (ssl.SSLError(1, "[SSL: WRONG_VERSION_NUMBER] wrong version number"), "tls", "TLS"),
        (socket.gaierror(8, "nodename nor servname provided"), "connect", "cannot find"),
        (ConnectionRefusedError(61, "Connection refused"), "connect", "refused"),
        (TimeoutError("timed out"), "connect", "did not answer"),
        (imaplib.IMAP4.abort("socket error: EOF"), "connect", "closed the connection"),
        (smtplib.SMTPServerDisconnected("Connection unexpectedly closed"), "connect", "closed the connection"),
        (smtplib.SMTPNotSupportedError("STARTTLS extension not supported by server."), "tls", "STARTTLS"),
        (OSError(65, "No route to host"), "connect", "cannot connect"),
    ],
)
def test_network_errors_are_readable(exc, kind, words):
    with pytest.raises(mail.MailError) as e:
        with mail._network_errors("IMAP", "imap.example.com", 143, "ssl"):
            raise exc
    assert e.value.status_code == 502 and e.value.kind == kind
    assert words.lower() in e.value.detail.lower()
    assert e.value.headers == {"X-Mail-Error": kind}


# --------------------------------------------------------------- endpoints


def test_providers(client):
    make_user(client)
    providers = {p["id"]: p for p in client.get("/api/mail/providers").json()["providers"]}
    assert providers["gmail"]["imap"] == {"host": "imap.gmail.com", "port": 993, "security": "ssl"}
    assert providers["icloud"]["smtp"] == {"host": "smtp.mail.me.com", "port": 587, "security": "starttls"}
    assert "app password" in providers["gmail"]["note"].lower()
    assert providers["outlook"]["supported"] is False
    assert set(providers) >= {"gmail", "icloud", "fastmail", "yahoo", "outlook", "other"}


def test_add_account_tests_logins_and_hides_password(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    assert imap.logins == 1
    assert account["email"] == "me@example.com" and account["username"] == "me@example.com"
    accounts = client.get("/api/mail/accounts").json()["accounts"]
    assert [a["id"] for a in accounts] == [account["id"]]
    assert not any("password" in key for key in accounts[0])
    from kherveos_server import db

    with db.connect() as conn:
        stored = conn.execute("SELECT password_enc FROM mail_accounts").fetchone()["password_enc"]
    assert "app-password" not in stored and mail.decrypt_password(stored) == "app-password"
    # Adding it twice is refused.
    r = client.post("/api/mail/accounts", json=account_body(smtp_port, email="ME@example.com"))
    assert r.status_code == 409


def test_add_account_errors(client, imap, smtp_server, monkeypatch):
    _, smtp_port = smtp_server
    make_user(client)

    def post(**extra):
        r = client.post("/api/mail/accounts", json={**account_body(smtp_port), **extra})
        return r.status_code, r.headers.get("x-mail-error"), r.json()["detail"]

    status, kind, detail = post(password="wrong")
    assert (status, kind) == (400, "auth") and "AUTHENTICATIONFAILED" in detail and "IMAP" in detail
    status, kind, detail = post(imap_host="imap.gmail.com", password="wrong")
    assert "app password" in detail

    imap.credentials = ("me@example.com", "other-pass")  # IMAP accepts it, SMTP doesn't
    status, kind, detail = post(password="other-pass")
    assert (status, kind) == (400, "auth") and "SMTP" in detail
    imap.credentials = ("me@example.com", "app-password")

    status, kind, detail = post(smtp_port=free_port())
    assert (status, kind) == (502, "connect") and "refused" in detail

    def failing(exc):
        def connect(host, port, security):
            raise exc
        return connect

    monkeypatch.setattr(mail, "_imap_connect", failing(ssl.SSLCertVerificationError(1, "certificate verify failed")))
    status, kind, detail = post()
    assert (status, kind) == (502, "tls")
    monkeypatch.setattr(mail, "_imap_connect", failing(socket.gaierror(8, "nodename nor servname provided")))
    status, kind, detail = post()
    assert (status, kind) == (502, "connect") and "imap.example.com" in detail

    status, kind, detail = post(email="someone@outlook.com", imap_host="", smtp_host="", provider="")
    assert (status, kind) == (400, "unsupported") and "OAuth" in detail
    status, kind, detail = post(email="not-an-email")
    assert status == 400
    status, kind, detail = post(imap_host="bad host!")
    assert status == 400 and "not a valid server name" in detail
    assert client.get("/api/mail/accounts").json()["accounts"] == []


def test_provider_presets_fill_in_the_servers(client, monkeypatch):
    make_user(client)
    seen = {}

    def connect(host, port, security):
        seen["imap"] = (host, port, security)
        raise ConnectionRefusedError(61, "refused")

    monkeypatch.setattr(mail, "_imap_connect", connect)
    r = client.post("/api/mail/accounts", json={"email": "someone@icloud.com", "password": "x"})
    assert r.status_code == 502
    assert seen["imap"] == ("imap.mail.me.com", 993, "ssl")


def test_accounts_are_private(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client, "alice")
    account = add_account(client, smtp_port)
    imap.deliver("INBOX", make_raw())
    base = f"/api/mail/accounts/{account['id']}"
    client.post("/api/auth/logout")
    assert client.get("/api/mail/accounts").status_code == 401
    assert client.get(f"{base}/folders").status_code == 401

    make_user(client, "bob")
    assert client.get("/api/mail/accounts").json()["accounts"] == []
    for method, path, body in [
        ("GET", f"{base}/folders", None),
        ("GET", f"{base}/messages", None),
        ("GET", f"{base}/messages/1", None),
        ("GET", f"{base}/messages/1/attachments/0", None),
        ("POST", f"{base}/messages/1/flags", {"folder": "INBOX", "seen": True}),
        ("POST", f"{base}/messages/1/move", {"folder": "INBOX", "to": "Trash"}),
        ("POST", f"{base}/messages/1/delete", {"folder": "INBOX"}),
        ("POST", f"{base}/send", {"to": ["x@example.com"], "subject": "hi", "text": "hi"}),
        ("PATCH", base, {"display_name": "Bob"}),
        ("DELETE", base, None),
    ]:
        r = client.request(method, path, json=body)
        assert r.status_code == 404, (method, path, r.text)
    assert len(imap.boxes["INBOX"].messages) == 1


def test_folders(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    imap.add_box("[Gmail]", ["\\Noselect"])
    imap.deliver("INBOX", make_raw(subject="one"))
    imap.deliver("INBOX", make_raw(subject="two"), ["\\Seen"])
    imap.deliver("Spam", make_raw(subject="spam"))
    folders = {f["raw"]: f for f in client.get(f"/api/mail/accounts/{account['id']}/folders").json()["folders"]}
    assert folders["INBOX"]["role"] == "inbox" and folders["INBOX"]["label"] == "Inbox"
    assert (folders["INBOX"]["unread"], folders["INBOX"]["total"]) == (1, 2)
    assert folders["Sent"]["role"] == "sent" and folders["Trash"]["role"] == "trash" and folders["Drafts"]["role"] == "drafts"
    assert folders["Spam"]["role"] == "junk" and folders["Spam"]["unread"] == 1
    assert folders["Entw&APw-rfe"]["name"] == "Entwürfe" and folders["Entw&APw-rfe"]["role"] is None
    assert folders['My "Quotes"']["name"] == 'My "Quotes"'
    assert folders["[Gmail]"]["selectable"] is False
    assert folders["Sent"]["unread"] is None  # not counted: nobody needs it


def test_list_and_read_messages(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    base = f"/api/mail/accounts/{account['id']}"
    for i in range(1, 6):
        imap.deliver("INBOX", make_raw(subject=f"Message {i}", text=f"Body {i}"), ["\\Seen"] if i == 1 else [])
    uid = imap.deliver(
        "INBOX",
        make_raw(subject="With attachment", html="<p>Hello <img src='https://tracker.example/p.gif'></p>",
                 attachments=[("report.pdf", "application/pdf", b"%PDF-report")]),
        ["\\Flagged"],
    )

    page = client.get(f"{base}/messages", params={"folder": "INBOX", "limit": 4}).json()
    assert page["total"] == 6 and page["uidvalidity"] == 7
    assert [m["uid"] for m in page["messages"]] == [6, 5, 4, 3]
    first = page["messages"][0]
    assert first["subject"] == "With attachment" and first["from"] == {"name": "Alice", "address": "alice@example.com"}
    assert first["has_attachments"] is True and first["flagged"] is True and first["seen"] is False
    assert first["date"] == "2026-10-05T09:30:00+02:00" and first["size"] > 0
    assert page["messages"][1]["has_attachments"] is False
    more = client.get(f"{base}/messages", params={"folder": "INBOX", "offset": 4, "limit": 4}).json()
    assert [m["uid"] for m in more["messages"]] == [2, 1] and more["messages"][1]["seen"] is True
    # Listing never marks anything as read.
    assert all("\\Seen" not in m.flags for m in imap.boxes["INBOX"].messages[1:])
    assert not any(c[:2] == ("UID", "FETCH") and "BODY[" in c[-1] and "PEEK" not in c[-1] for c in imap.commands)

    detail = client.get(f"{base}/messages/{uid}", params={"folder": "INBOX"}).json()
    assert detail["headers"]["subject"] == "With attachment"
    assert detail["seen"] is True and detail["flagged"] is True
    assert "tracker.example" in detail["html"] and detail["text"].strip() == "Hi there"
    assert detail["attachments"] == [
        {"index": 0, "filename": "report.pdf", "content_type": "application/pdf", "size": 11, "inline": False, "content_id": None}
    ]
    assert "\\Seen" in imap.boxes["INBOX"].messages[-1].flags

    r = client.get(f"{base}/messages/{uid}/attachments/0", params={"folder": "INBOX"})
    assert r.status_code == 200 and r.content == b"%PDF-report"
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith('attachment; filename="report.pdf"')
    assert r.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"{base}/messages/{uid}/attachments/5", params={"folder": "INBOX"}).status_code == 404

    r = client.get(f"{base}/messages/999", params={"folder": "INBOX"})
    assert r.status_code == 404 and r.headers["x-mail-error"] == "gone"
    r = client.get(f"{base}/messages", params={"folder": "Nope"})
    assert r.status_code == 404 and "Nope" in r.json()["detail"]
    r = client.get(f"{base}/messages", params={"folder": "Bad\r\nA1 DELETE INBOX"})
    assert r.status_code == 400


def test_search(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    imap.deliver("INBOX", make_raw(subject="Lunch on Friday"))
    imap.deliver("INBOX", make_raw(subject="Quarterly report"))
    imap.deliver("INBOX", make_raw(subject="Déjeuner vendredi", text="à bientôt"))
    base = f"/api/mail/accounts/{account['id']}/messages"
    page = client.get(base, params={"folder": "INBOX", "q": "report"}).json()
    assert page["total"] == 1 and page["messages"][0]["subject"] == "Quarterly report"
    page = client.get(base, params={"folder": "INBOX", "q": "bientôt"}).json()  # sent as a UTF-8 literal
    assert [m["subject"] for m in page["messages"]] == ["Déjeuner vendredi"]
    assert ("UID", "SEARCH", "CHARSET", "UTF-8", "TEXT") in imap.commands
    assert client.get(base, params={"folder": "INBOX", "q": "nothing-like-this"}).json() == {
        "folder": "INBOX", "query": "nothing-like-this", "offset": 0, "limit": 50, "total": 0, "uidvalidity": 7, "messages": [],
    }


def test_flags_move_and_delete(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    base = f"/api/mail/accounts/{account['id']}/messages"
    for i in range(3):
        imap.deliver("INBOX", make_raw(subject=f"m{i}"))
    inbox = imap.boxes["INBOX"]

    assert client.post(f"{base}/1/flags", json={"folder": "INBOX", "seen": True, "flagged": True}).json() == {"ok": True}
    assert inbox.messages[0].flags == {"\\Seen", "\\Flagged"}
    client.post(f"{base}/1/flags", json={"folder": "INBOX", "seen": False, "answered": True})
    assert inbox.messages[0].flags == {"\\Flagged", "\\Answered"}

    assert client.post(f"{base}/2/move", json={"folder": "INBOX", "to": "Entw&APw-rfe"}).json() == {"ok": True}
    assert [m.uid for m in inbox.messages] == [1, 3] and len(imap.boxes["Entw&APw-rfe"].messages) == 1
    r = client.post(f"{base}/3/move", json={"folder": "INBOX", "to": "Missing"})
    assert r.status_code == 404 and r.headers["x-mail-error"] == "folder"

    assert client.post(f"{base}/3/delete", json={"folder": "INBOX"}).json() == {"ok": True, "moved_to": "Trash"}
    assert [m.uid for m in inbox.messages] == [1] and len(imap.boxes["Trash"].messages) == 1
    # Deleting from the Trash deletes for good.
    assert client.post(f"{base}/1/delete", json={"folder": "Trash"}).json() == {"ok": True, "moved_to": None}
    assert imap.boxes["Trash"].messages == []


def test_move_without_move_capability(client, imap, smtp_server):
    _, smtp_port = smtp_server
    imap.caps = ["IMAP4rev1"]  # no MOVE, no UIDPLUS
    make_user(client)
    account = add_account(client, smtp_port)
    imap.deliver("INBOX", make_raw(subject="a"))
    imap.deliver("INBOX", make_raw(subject="b"))
    r = client.post(f"/api/mail/accounts/{account['id']}/messages/1/move", json={"folder": "INBOX", "to": "Sent"})
    assert r.json() == {"ok": True}
    assert [m.uid for m in imap.boxes["INBOX"].messages] == [2] and len(imap.boxes["Sent"].messages) == 1
    assert ("UID", "COPY", "1", '"Sent"') in imap.commands and ("EXPUNGE",) in imap.commands


def test_send(client, imap, smtp_server):
    collector, smtp_port = smtp_server
    collector.envelopes.clear()
    make_user(client)
    account = add_account(client, smtp_port)
    body = {
        "to": ["Friend <friend@example.com>"],
        "cc": [],
        "bcc": ["secret@example.com"],
        "subject": "Hello ☕",
        "text": "Hi!\n",
        "in_reply_to": "<parent@example.com>",
        "references": "<parent@example.com>",
        "attachments": [{"filename": "a.txt", "content_type": "text/plain", "data_base64": base64.b64encode(b"attached").decode()}],
    }
    r = client.post(f"/api/mail/accounts/{account['id']}/send", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["saved_to_sent"] is True and r.json()["warning"] is None
    [envelope] = collector.envelopes
    assert envelope.mail_from == "me@example.com"
    assert envelope.rcpt_tos == ["friend@example.com", "secret@example.com"]
    sent = email.message_from_bytes(envelope.content, policy=email.policy.default)
    assert sent["Subject"] == "Hello ☕" and sent["Bcc"] is None
    assert sent["From"].addresses[0].display_name == "Me Myself"
    assert sent["In-Reply-To"] == "<parent@example.com>"
    # A copy went to the Sent folder, already read.
    [copy] = imap.boxes["Sent"].messages
    assert copy.flags == {"\\Seen"} and b"Hello" in copy.raw

    r = client.post(f"/api/mail/accounts/{account['id']}/send", json={"to": ["nope"], "text": "x"})
    assert r.status_code == 400 and r.headers["x-mail-error"] == "recipients"


def test_send_with_gmail_keeps_no_copy(client, imap, smtp_server):
    collector, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port, imap_host="imap.gmail.com")
    r = client.post(f"/api/mail/accounts/{account['id']}/send", json={"to": ["a@example.com"], "subject": "s", "text": "t"})
    assert r.status_code == 200 and r.json()["saved_to_sent"] is False and r.json()["warning"] is None
    assert imap.boxes["Sent"].messages == []


def test_update_and_delete_account(client, imap, smtp_server):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    base = f"/api/mail/accounts/{account['id']}"
    r = client.patch(base, json={"display_name": "New Name"})
    assert r.status_code == 200 and r.json()["account"]["display_name"] == "New Name"
    assert imap.logins == 1  # nothing to re-test
    r = client.patch(base, json={"password": "wrong"})
    assert r.status_code == 400 and r.headers["x-mail-error"] == "auth"
    imap.credentials = ("me@example.com", "new-pass")
    SMTP_USERS.add((b"me@example.com", b"new-pass"))
    try:
        assert client.patch(base, json={"password": "new-pass"}).status_code == 200
    finally:
        SMTP_USERS.discard((b"me@example.com", b"new-pass"))
    assert client.get(f"{base}/folders").status_code == 200  # logs in with the new password
    assert client.delete(base).json() == {"ok": True}
    assert client.get("/api/mail/accounts").json()["accounts"] == []
    assert client.get(f"{base}/folders").status_code == 404
    assert all(c.closed for c in imap.connections)


def test_connections_are_reused(client, imap, smtp_server, monkeypatch):
    _, smtp_port = smtp_server
    make_user(client)
    account = add_account(client, smtp_port)
    base = f"/api/mail/accounts/{account['id']}"
    for _ in range(3):
        assert client.get(f"{base}/folders").status_code == 200
    assert imap.logins == 1  # the login made while adding the account is reused
    # A connection that broke is dropped and a new one is made.
    imap.connections[-1].noop = lambda: (_ for _ in ()).throw(imaplib.IMAP4.abort("gone"))
    monkeypatch.setattr(mail, "_POOL_CHECK_AFTER", -1.0)
    assert client.get(f"{base}/folders").status_code == 200
    assert imap.logins == 2
    # Idle connections expire.
    monkeypatch.setattr(mail, "_POOL_IDLE", -1.0)
    assert client.get(f"{base}/folders").status_code == 200
    assert imap.logins == 3


# ------------------------------------------------------ end to end: pymap

PYMAP = Path(sys.executable).with_name("pymap")


@pytest.fixture()
def pymap_port():
    """A real IMAP server (pymap's in-memory demo backend: user demouser / demopass)."""
    if not PYMAP.exists():
        pytest.skip("pymap is not installed (pip install -r requirements-dev.txt)")
    port = free_port()
    proc = subprocess.Popen(
        [str(PYMAP), "--host", "127.0.0.1", "--port", str(port), "--no-tls", "dict", "--demo-data"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    deadline = time.time() + 20
    while True:
        if proc.poll() is not None:
            pytest.skip("pymap did not start: " + proc.stderr.read().decode(errors="replace")[-300:])
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
            break
        except OSError:
            if time.time() > deadline:
                proc.kill()
                pytest.skip("pymap did not start in time")
            time.sleep(0.1)
    yield port
    proc.terminate()
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_end_to_end_with_pymap(client, pymap_port, smtp_server):
    collector, smtp_port = smtp_server
    collector.envelopes.clear()
    make_user(client)
    settings = {
        "email": "demouser@example.com",
        "username": "demouser",
        "password": "demopass",
        "display_name": "Demo User",
        "imap_host": "127.0.0.1",
        "imap_port": pymap_port,
        "imap_security": "none",
        "smtp_host": "127.0.0.1",
        "smtp_port": smtp_port,
        "smtp_security": "none",
    }
    # Wrong password, TLS on a plain port, nothing listening: three different, readable errors.
    r = client.post("/api/mail/accounts", json={**settings, "password": "nope"})
    assert r.status_code == 400 and r.headers["x-mail-error"] == "auth"
    r = client.post("/api/mail/accounts", json={**settings, "imap_security": "ssl"})
    assert r.status_code == 502 and r.headers["x-mail-error"] == "tls"
    r = client.post("/api/mail/accounts", json={**settings, "imap_port": free_port()})
    assert r.status_code == 502 and r.headers["x-mail-error"] == "connect"

    r = client.post("/api/mail/accounts", json=settings)
    assert r.status_code == 200, r.text
    base = f"/api/mail/accounts/{r.json()['account']['id']}"

    folders = {f["raw"]: f for f in client.get(f"{base}/folders").json()["folders"]}
    assert {k: f["role"] for k, f in folders.items()} == {"INBOX": "inbox", "Sent": "sent", "Trash": "trash"}
    unread = folders["INBOX"]["unread"]

    page = client.get(f"{base}/messages", params={"folder": "INBOX"}).json()
    assert page["total"] == 4
    rows = page["messages"]
    assert [m["uid"] for m in rows] == sorted((m["uid"] for m in rows), reverse=True)
    newest = rows[0]
    assert newest["subject"] == "Hello, World!" and newest["seen"] is False
    assert newest["from"]["address"] == "friend@example.com" and newest["date"].startswith("2010-01-01")
    assert next(m for m in rows if m["subject"] == "Random question")["answered"] is True
    assert client.get(f"{base}/folders").json()["folders"][0]["unread"] == unread  # listing marked nothing

    detail = client.get(f"{base}/messages/{newest['uid']}", params={"folder": "INBOX"}).json()
    assert detail["headers"]["subject"] == "Hello, World!" and detail["text"].strip() and detail["seen"] is True
    row = client.get(f"{base}/messages", params={"folder": "INBOX"}).json()["messages"][0]
    assert row["seen"] is True

    client.post(f"{base}/messages/{newest['uid']}/flags", json={"folder": "INBOX", "seen": False, "flagged": True})
    row = client.get(f"{base}/messages", params={"folder": "INBOX"}).json()["messages"][0]
    assert (row["seen"], row["flagged"]) == (False, True)

    found = client.get(f"{base}/messages", params={"folder": "INBOX", "q": "Random"}).json()
    assert {m["subject"] for m in found["messages"]} == {"Random question", "Re: Re: Random question"}

    # Send with an attachment: delivered over SMTP, and a copy lands in Sent.
    sent_before = client.get(f"{base}/messages", params={"folder": "Sent"}).json()["total"]
    r = client.post(f"{base}/send", json={
        "to": ["friend@example.com"], "bcc": ["boss@example.com"], "subject": "Report ✓", "text": "Here it is.",
        "attachments": [{"filename": "report.csv", "content_type": "text/csv", "data_base64": base64.b64encode(b"a,b\n1,2\n").decode()}],
    })
    assert r.status_code == 200 and r.json()["saved_to_sent"] is True, r.text
    assert collector.envelopes[-1].rcpt_tos == ["friend@example.com", "boss@example.com"]
    sent = client.get(f"{base}/messages", params={"folder": "Sent"}).json()
    assert sent["total"] == sent_before + 1
    copy = sent["messages"][0]
    assert copy["subject"] == "Report ✓" and copy["seen"] is True and copy["has_attachments"] is True
    detail = client.get(f"{base}/messages/{copy['uid']}", params={"folder": "Sent"}).json()
    assert [a["filename"] for a in detail["attachments"]] == ["report.csv"]
    r = client.get(f"{base}/messages/{copy['uid']}/attachments/0", params={"folder": "Sent"})
    assert r.content == b"a,b\n1,2\n"

    # pymap's demo Trash is read-only: deleting says so, and the cached connection still works afterwards.
    oldest = rows[-1]["uid"]
    r = client.post(f"{base}/messages/{oldest}/delete", json={"folder": "INBOX"})
    assert r.status_code == 502 and "read-only" in r.json()["detail"].lower()
    assert client.get(f"{base}/folders").status_code == 200
    raw_imap = imaplib.IMAP4("127.0.0.1", pymap_port)
    raw_imap.login("demouser", "demopass")
    assert raw_imap.delete("Trash")[0] == "OK" and raw_imap.create("Trash")[0] == "OK"
    raw_imap.logout()

    # Delete moves to the Trash; deleting from the Trash removes it for good.
    trash_before = client.get(f"{base}/messages", params={"folder": "Trash"}).json()["total"]
    assert client.post(f"{base}/messages/{oldest}/delete", json={"folder": "INBOX"}).json()["moved_to"] == "Trash"
    assert client.get(f"{base}/messages", params={"folder": "INBOX"}).json()["total"] == 3
    trash = client.get(f"{base}/messages", params={"folder": "Trash"}).json()
    assert trash["total"] == trash_before + 1
    r = client.post(f"{base}/messages/{trash['messages'][0]['uid']}/delete", json={"folder": "Trash"})
    assert r.json() == {"ok": True, "moved_to": None}
    assert client.get(f"{base}/messages", params={"folder": "Trash"}).json()["total"] == trash_before

    # Move between folders.
    uid = rows[1]["uid"]
    assert client.post(f"{base}/messages/{uid}/move", json={"folder": "INBOX", "to": "Sent"}).json() == {"ok": True}
    assert client.get(f"{base}/messages", params={"folder": "INBOX"}).json()["total"] == 2
