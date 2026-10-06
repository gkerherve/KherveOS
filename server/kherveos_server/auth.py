"""Accounts and sessions.

Passwords are hashed with scrypt. Signing in sets an HttpOnly session cookie,
so the browser sends it with every /api request and the websocket — the
front end never handles a token.

Other modules protect their endpoints with:

    from .auth import User, current_user
    @router.get("/thing")
    def thing(user: User = Depends(current_user)): ...
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import asdict, dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket
from pydantic import BaseModel

from . import config, db

router = APIRouter(prefix="/api/auth", tags=["auth"])
users_router = APIRouter(prefix="/api/users", tags=["users"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MIN_PASSWORD = 8


@dataclass
class User:
    id: int
    username: str
    display_name: str

    def public(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ hashing

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2**14, 8, 1
    digest = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# ----------------------------------------------------------------- sessions

def _user_from_row(row) -> User:
    return User(id=row["id"], username=row["username"], display_name=row["display_name"])


def user_for_token(token: str | None) -> User | None:
    if not token:
        return None
    now = time.time()
    with db.connect() as conn:
        row = conn.execute(
            """SELECT u.id, u.username, u.display_name, s.last_seen FROM sessions s
               JOIN users u ON u.id = s.user_id WHERE s.token = ?""",
            (token,),
        ).fetchone()
        if row is None:
            return None
        if now - row["last_seen"] > config.SESSION_DAYS * 86400:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
        if now - row["last_seen"] > 3600:
            conn.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (now, token))
        return _user_from_row(row)


def _start_session(response: Response, request: Request, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)",
            (token, user_id, now, now),
        )
    response.set_cookie(
        config.SESSION_COOKIE,
        token,
        max_age=config.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def current_user(request: Request) -> User:
    user = user_for_token(request.cookies.get(config.SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in.")
    return user


def optional_user(request: Request) -> User | None:
    return user_for_token(request.cookies.get(config.SESSION_COOKIE))


def websocket_user(ws: WebSocket) -> User | None:
    return user_for_token(ws.cookies.get(config.SESSION_COOKIE))


def get_user(user_id: int) -> User | None:
    with db.connect() as conn:
        row = conn.execute("SELECT id, username, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
    return _user_from_row(row) if row else None


def get_user_by_name(username: str) -> User | None:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, username, display_name FROM users WHERE username = ?", (username,)
        ).fetchone()
    return _user_from_row(row) if row else None


# ---------------------------------------------------------------- endpoints

class RegisterBody(BaseModel):
    username: str
    display_name: str = ""
    password: str


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/register")
def register(body: RegisterBody, request: Request, response: Response):
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "Usernames are 3–32 characters: letters, digits, dot, dash or underscore.")
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(400, f"Passwords need at least {MIN_PASSWORD} characters.")
    display_name = (body.display_name or username).strip()[:64] or username
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            raise HTTPException(409, "That username is taken.")
        cur = conn.execute(
            "INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (username, display_name, hash_password(body.password), time.time()),
        )
        user_id = cur.lastrowid
    _start_session(response, request, user_id)
    return {"user": User(user_id, username, display_name).public()}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, username, display_name, password_hash FROM users WHERE username = ?",
            (body.username.strip(),),
        ).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Wrong username or password.")
    _start_session(response, request, row["id"])
    return {"user": _user_from_row(row).public()}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(config.SESSION_COOKIE)
    if token:
        with db.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User | None = Depends(optional_user)):
    return {"user": user.public() if user else None}


@users_router.get("/search")
def search_users(q: str = "", user: User = Depends(current_user)):
    """Find people to talk to, by username or display name."""
    like = f"%{q.strip()}%"
    with db.connect() as conn:
        rows = conn.execute(
            """SELECT id, username, display_name FROM users
               WHERE id != ? AND (username LIKE ? OR display_name LIKE ?)
               ORDER BY display_name COLLATE NOCASE LIMIT 20""",
            (user.id, like, like),
        ).fetchall()
    return {"users": [_user_from_row(r).public() for r in rows]}
