"""Messages: real-time conversations between people on this KherveOS server.

Tables
  conversations         one row per chat: 'direct' (two people) or 'group'
  conversation_members  who is in a chat, and how far each of them has read
  messages              the messages; deleting one keeps the row (soft delete)

Every endpoint needs a signed-in user and answers 404 for conversations (and
messages) the user is not a member of, so ids reveal nothing to outsiders.

Live events (see realtime.py) go to the members' open tabs:
  message.new        {conversation_id, message, sender, client_id, conversation}  to every member
  message.updated    {conversation_id, message}            edited or deleted; to every member
  conversation.new   {conversation_id}                     a group you are in was created
  conversation.read  {conversation_id, last_read_id, unread_count}  to the reader's own tabs
  typing             {conversation_id, user}               to the other members
  presence           {user_id, online}                     to people who share a conversation
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Mapping

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import db
from .auth import User, current_user
from .realtime import hub

log = logging.getLogger("kherveos.messages")

router = APIRouter(prefix="/api/messages", tags=["messages"])

MAX_BODY = 4000
MAX_TITLE = 100
MAX_GROUP = 50

db.register_schema(
    """
    CREATE TABLE IF NOT EXISTS conversations (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        title      TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at       REAL NOT NULL,
        last_read_id    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS conversation_members_by_user ON conversation_members (user_id, conversation_id);
    CREATE TABLE IF NOT EXISTS messages (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body            TEXT NOT NULL,
        created_at      REAL NOT NULL,
        edited_at       REAL,
        deleted         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, id);
    """
)


# ------------------------------------------------------------------ helpers

def _message(row: sqlite3.Row | Mapping) -> dict:
    deleted = bool(row["deleted"])
    return {
        "id": row["id"],
        "conversation_id": row["conversation_id"],
        "sender_id": row["sender_id"],
        "body": "" if deleted else row["body"],
        "created_at": row["created_at"],
        "edited_at": row["edited_at"],
        "deleted": deleted,
    }


def _clean_body(text: str) -> str:
    body = text.replace("\r\n", "\n").strip()
    if not body:
        raise HTTPException(400, "A message can't be empty.")
    if len(body) > MAX_BODY:
        raise HTTPException(400, f"Messages can be at most {MAX_BODY} characters long.")
    return body


def _member_ids(conn: sqlite3.Connection, conversation_id: int) -> list[int]:
    rows = conn.execute("SELECT user_id FROM conversation_members WHERE conversation_id = ?", (conversation_id,))
    return [r[0] for r in rows]


def _require_member(conn: sqlite3.Connection, conversation_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute(
        """SELECT c.id, c.kind, c.title, m.last_read_id FROM conversations c
           JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
           WHERE c.id = ?""",
        (user_id, conversation_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Conversation not found.")
    return row


def _own_message(conn: sqlite3.Connection, message_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute(
        """SELECT m.* FROM messages m
           JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
           WHERE m.id = ?""",
        (user_id, message_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Message not found.")
    if row["sender_id"] != user_id:
        raise HTTPException(403, "You can only change your own messages.")
    return row


def _unread(conn: sqlite3.Connection, conversation_id: int, user_id: int, last_read_id: int) -> int:
    return conn.execute(
        """SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND id > ? AND deleted = 0
           AND (sender_id IS NULL OR sender_id != ?)""",
        (conversation_id, last_read_id, user_id),
    ).fetchone()[0]


def _group_title(names: list[str]) -> str:
    if not names:
        return "Group"
    if len(names) <= 3:
        return ", ".join(names)
    return f"{', '.join(names[:3])} +{len(names) - 3}"


def _summaries(conn: sqlite3.Connection, user_id: int, only: int | None = None, listing: bool = False) -> list[dict]:
    """Conversation summaries as `user_id` sees them, newest activity first.

    `only` restricts to one conversation. `listing` hides direct conversations
    that someone else opened with this user but nobody has written in yet.
    """
    sql = """
        SELECT c.id, c.kind, c.title, c.created_by, c.created_at, me.last_read_id,
               lm.id AS lm_id, lm.conversation_id AS lm_conversation_id, lm.sender_id AS lm_sender_id,
               lm.body AS lm_body, lm.created_at AS lm_created_at, lm.edited_at AS lm_edited_at,
               lm.deleted AS lm_deleted,
               (SELECT COUNT(*) FROM messages u
                 WHERE u.conversation_id = c.id AND u.id > me.last_read_id AND u.deleted = 0
                   AND (u.sender_id IS NULL OR u.sender_id != me.user_id)) AS unread
        FROM conversation_members me
        JOIN conversations c ON c.id = me.conversation_id
        LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
        WHERE me.user_id = ?
    """
    params: list = [user_id]
    if only is not None:
        sql += " AND c.id = ?"
        params.append(only)
    if listing:
        sql += " AND (c.kind = 'group' OR c.created_by = me.user_id OR lm.id IS NOT NULL)"
    rows = conn.execute(sql, params).fetchall()
    if not rows:
        return []

    member_sql = """
        SELECT cm.conversation_id, u.id, u.username, u.display_name
        FROM conversation_members cm JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id {} ORDER BY u.display_name COLLATE NOCASE, u.id
    """
    if only is not None:
        member_rows = conn.execute(member_sql.format("= ?"), (only,))
    else:
        member_rows = conn.execute(
            member_sql.format("IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)"), (user_id,)
        )
    members: dict[int, list[dict]] = {}
    for m in member_rows:
        members.setdefault(m["conversation_id"], []).append(
            {"id": m["id"], "username": m["username"], "display_name": m["display_name"], "online": hub.is_online(m["id"])}
        )

    out = []
    for r in rows:
        people = members.get(r["id"], [])
        others = [p for p in people if p["id"] != user_id]
        if r["kind"] == "direct":
            title = others[0]["display_name"] if others else "Just you"
        else:
            title = r["title"] or _group_title([p["display_name"] for p in others])
        last = None
        if r["lm_id"] is not None:
            last = _message({k[3:]: r[k] for k in r.keys() if k.startswith("lm_")})
        out.append(
            {
                "id": r["id"],
                "kind": r["kind"],
                "title": title,
                "custom_title": r["title"] if r["kind"] == "group" else "",
                "members": people,
                "last_message": last,
                "unread_count": r["unread"],
                "last_read_id": r["last_read_id"],
                "created_by": r["created_by"],
                "created_at": r["created_at"],
                "updated_at": last["created_at"] if last else r["created_at"],
            }
        )
    out.sort(key=lambda c: (c["updated_at"], c["id"]), reverse=True)
    return out


def _summary(conn: sqlite3.Connection, user_id: int, conversation_id: int) -> dict:
    found = _summaries(conn, user_id, only=conversation_id)
    if not found:
        raise HTTPException(404, "Conversation not found.")
    return found[0]


def _quoted_list(names: list[str]) -> str:
    quoted = [f"“{n}”" for n in names]
    return quoted[0] if len(quoted) == 1 else f"{', '.join(quoted[:-1])} and {quoted[-1]}"


# --------------------------------------------------------------- endpoints

class CreateBody(BaseModel):
    usernames: list[str] = Field(default_factory=list)
    title: str | None = None


class SendBody(BaseModel):
    body: str
    # Echoed back in the message.new event so the sending tab can match it to
    # the message it is already showing. Not stored.
    client_id: str | None = Field(default=None, max_length=64)


class EditBody(BaseModel):
    body: str


class ReadBody(BaseModel):
    # The newest message the user has seen; omitted = everything so far.
    message_id: int | None = None


@router.get("/conversations")
def list_conversations(user: User = Depends(current_user)):
    with db.connect() as conn:
        return {"conversations": _summaries(conn, user.id, listing=True)}


@router.post("/conversations")
def create_conversation(body: CreateBody, user: User = Depends(current_user)):
    wanted: list[str] = []
    seen: set[str] = set()
    for raw in body.usernames:
        name = raw.strip().lstrip("@").strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            wanted.append(name)
    if not wanted:
        raise HTTPException(400, "Choose at least one person to talk to.")
    if len(wanted) > MAX_GROUP:
        raise HTTPException(400, f"A conversation can have at most {MAX_GROUP} people.")

    now = time.time()
    created = False
    with db.connect() as conn:
        # One writer at a time, so two quick clicks can't open the same direct chat twice.
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            f"SELECT id, username, display_name FROM users WHERE username IN ({','.join('?' * len(wanted))})", wanted
        ).fetchall()
        by_name = {r["username"].lower(): r for r in rows}
        missing = [n for n in wanted if n.lower() not in by_name]
        if missing:
            noun = "an account" if len(missing) == 1 else "accounts"
            raise HTTPException(404, f"There is no {noun} named {_quoted_list(missing)} on this server.")
        others = [by_name[n.lower()] for n in wanted if by_name[n.lower()]["id"] != user.id]
        if not others:
            raise HTTPException(400, "Choose someone other than yourself.")

        if len(others) == 1:
            kind = "direct"
            existing = conn.execute(
                """SELECT c.id FROM conversations c
                   JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
                   JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
                   WHERE c.kind = 'direct' ORDER BY c.id LIMIT 1""",
                (user.id, others[0]["id"]),
            ).fetchone()
            conversation_id = existing["id"] if existing else None
            title = ""
        else:
            kind = "group"
            conversation_id = None
            title = " ".join((body.title or "").split())[:MAX_TITLE]

        if conversation_id is None:
            created = True
            conversation_id = conn.execute(
                "INSERT INTO conversations (kind, title, created_by, created_at) VALUES (?, ?, ?, ?)",
                (kind, title, user.id, now),
            ).lastrowid
            conn.executemany(
                "INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
                [(conversation_id, uid, now) for uid in [user.id, *(o["id"] for o in others)]],
            )
        summary = _summary(conn, user.id, conversation_id)

    if created and kind == "group":
        hub.publish([m["id"] for m in summary["members"]], {"type": "conversation.new", "conversation_id": conversation_id})
    return {"conversation": summary, "created": created}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, user: User = Depends(current_user)):
    with db.connect() as conn:
        return {"conversation": _summary(conn, user.id, conversation_id)}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: int,
    before: int | None = Query(None, ge=1, description="Only messages older than this message id"),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(current_user),
):
    with db.connect() as conn:
        _require_member(conn, conversation_id, user.id)
        if before is None:
            rows = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
                (conversation_id, limit + 1),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
                (conversation_id, before, limit + 1),
            ).fetchall()
    has_more = len(rows) > limit
    return {"messages": [_message(r) for r in reversed(rows[:limit])], "has_more": has_more}


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: int, body: SendBody, user: User = Depends(current_user)):
    text = _clean_body(body.body)
    with db.connect() as conn:
        conv = _require_member(conn, conversation_id, user.id)
        message_id = conn.execute(
            "INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)",
            (conversation_id, user.id, text, time.time()),
        ).lastrowid
        # Writing in a conversation means you have read it.
        conn.execute(
            "UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ? AND last_read_id < ?",
            (message_id, conversation_id, user.id, message_id),
        )
        message = _message(conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone())
        member_ids = _member_ids(conn, conversation_id)
    hub.publish(
        member_ids,
        {
            "type": "message.new",
            "conversation_id": conversation_id,
            "message": message,
            "sender": user.public(),
            "client_id": body.client_id,
            "conversation": {"kind": conv["kind"], "title": conv["title"]},
        },
    )
    return {"message": message}


@router.post("/conversations/{conversation_id}/read")
def mark_read(conversation_id: int, body: ReadBody | None = None, user: User = Depends(current_user)):
    with db.connect() as conn:
        _require_member(conn, conversation_id, user.id)
        newest = conn.execute(
            "SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ?", (conversation_id,)
        ).fetchone()[0]
        wanted = body.message_id if body is not None and body.message_id is not None else newest
        target = max(0, min(wanted, newest))  # never past the newest message, never backwards
        conn.execute(
            "UPDATE conversation_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?",
            (target, conversation_id, user.id),
        )
        last_read = conn.execute(
            "SELECT last_read_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
            (conversation_id, user.id),
        ).fetchone()[0]
        unread = _unread(conn, conversation_id, user.id, last_read)
    hub.publish(
        [user.id],
        {"type": "conversation.read", "conversation_id": conversation_id, "last_read_id": last_read, "unread_count": unread},
    )
    return {"ok": True, "last_read_id": last_read, "unread_count": unread}


@router.patch("/messages/{message_id}")
def edit_message(message_id: int, body: EditBody, user: User = Depends(current_user)):
    text = _clean_body(body.body)
    with db.connect() as conn:
        row = _own_message(conn, message_id, user.id)
        if row["deleted"]:
            raise HTTPException(409, "This message has been deleted.")
        changed = row["body"] != text
        if changed:
            conn.execute("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?", (text, time.time(), message_id))
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        member_ids = _member_ids(conn, row["conversation_id"])
    message = _message(row)
    if changed:
        hub.publish(member_ids, {"type": "message.updated", "conversation_id": row["conversation_id"], "message": message})
    return {"message": message}


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, user: User = Depends(current_user)):
    with db.connect() as conn:
        row = _own_message(conn, message_id, user.id)
        changed = not row["deleted"]
        if changed:
            # Soft delete: the row stays (paging and read markers keep working); the text goes.
            conn.execute("UPDATE messages SET deleted = 1, body = '' WHERE id = ?", (message_id,))
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        member_ids = _member_ids(conn, row["conversation_id"])
    message = _message(row)
    if changed:
        hub.publish(member_ids, {"type": "message.updated", "conversation_id": row["conversation_id"], "message": message})
    return {"message": message}


# ---------------------------------------------------------------- realtime
# These run on the event loop. They only read (SQLite in WAL mode never makes
# readers wait), so they query directly instead of hopping to a thread.

def _as_id(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


@hub.on("typing")
async def _typing(user: User, event: dict) -> None:
    conversation_id = _as_id(event.get("conversation_id"))
    if conversation_id is None:
        return
    with db.connect() as conn:
        ids = _member_ids(conn, conversation_id)
    if user.id not in ids:
        return
    others = [i for i in ids if i != user.id]
    if others:
        hub.publish(others, {"type": "typing", "conversation_id": conversation_id, "user": user.public()})


@hub.on_presence
async def _presence(user: User, online: bool) -> None:
    try:
        with db.connect() as conn:
            rows = conn.execute(
                """SELECT DISTINCT other.user_id FROM conversation_members mine
                   JOIN conversation_members other ON other.conversation_id = mine.conversation_id
                   WHERE mine.user_id = ? AND other.user_id != ?""",
                (user.id, user.id),
            ).fetchall()
    except sqlite3.Error:
        log.exception("could not look up who to tell about %s", user.username)
        return
    ids = [r[0] for r in rows]
    if ids:
        hub.publish(ids, {"type": "presence", "user_id": user.id, "online": online})
