"""SQLite storage.

Each feature module registers its tables with `register_schema()` when it is
imported; `init()` creates them all at startup. Use `connect()` for a
short-lived connection (one per request is fine with SQLite):

    with db.connect() as conn:
        conn.execute("INSERT ...")      # committed when the block exits
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from . import config

_SCHEMAS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at REAL NOT NULL,
        last_seen  REAL NOT NULL
    );
    """
]


def register_schema(sql: str) -> None:
    """Add CREATE TABLE IF NOT EXISTS ... statements to run at startup."""
    _SCHEMAS.append(sql)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        for sql in _SCHEMAS:
            conn.executescript(sql)


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None
