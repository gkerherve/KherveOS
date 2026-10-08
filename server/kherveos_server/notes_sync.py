"""Notes sync: the user's ~/Notes folder, the same on every computer.

Files in KherveOS live in each browser (IndexedDB). The Notes app keeps
~/Notes (Markdown notes and their attachments) in step with a copy here, one
per user, when the user is signed in. The client decides what to send and
fetch from content hashes (src/apps/notes/syncPlan.ts); the server only keeps
files, their hashes and tombstones, and refuses a write that was not based on
the version it has (409), so two computers never overwrite each other blindly.

Stored under data/notes/<user id>/: files/<relative path> and index.json
({"files": {path: {"hash": sha256 | null (deleted), "size", "mtime"}}}).

Endpoints (signed-in users only)
  GET    /api/notes/sync                      {"files": {path: {hash, size, mtime}}, "limit": MAX_TOTAL}
  GET    /api/notes/sync/file?path=…          the file
  PUT    /api/notes/sync/file?path=…&base=…&device_id=…   body: the bytes; base = the hash the client
                                              last saw ("" = none)
  DELETE /api/notes/sync/file?path=…&base=…&device_id=…

Live event (see realtime.py), to every tab of the user:
  notes.changed  {path, device_id}
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from . import config
from .auth import User, current_user
from .realtime import hub

log = logging.getLogger("kherveos.notes")

router = APIRouter(prefix="/api/notes/sync", tags=["notes"])

MAX_FILE = 25 * 1024 * 1024  # one note or attachment
MAX_TOTAL = 500 * 1024 * 1024  # everything of one user
MAX_FILES = 20_000
MAX_PATH = 400

_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(user_id: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(user_id, threading.Lock())


def _base(user_id: int) -> Path:
    d = config.DATA_DIR / "notes" / str(int(user_id))
    (d / "files").mkdir(parents=True, exist_ok=True)
    return d


def _read_index(user_id: int) -> dict:
    p = _base(user_id) / "index.json"
    try:
        data = json.loads(p.read_text("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("files"), dict):
            return data
    except (OSError, ValueError):
        pass
    return {"files": {}}


def _write_index(user_id: int, index: dict) -> None:
    p = _base(user_id) / "index.json"
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index), "utf-8")
    os.replace(tmp, p)


def _clean_path(path: str) -> str:
    """A relative path inside the Notes folder, or a 400."""
    if not path or len(path) > MAX_PATH or "\\" in path or re.search(r"[\x00-\x1f\x7f]", path):
        raise HTTPException(400, "Not a valid note path.")
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        raise HTTPException(400, "Not a valid note path.")
    parts = path.split("/")
    if not parts or any(p in ("", ".", "..") or len(p) > 255 for p in parts):
        raise HTTPException(400, "Not a valid note path.")
    return "/".join(parts)


def _file(user_id: int, rel: str) -> Path:
    root = (_base(user_id) / "files").resolve()
    target = (root / rel).resolve()
    if root not in target.parents:
        raise HTTPException(400, "Not a valid note path.")
    return target


def _clean_device(device_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", device_id)[:64]


# ------------------------------------------------------------------ routes

@router.get("")
def manifest(user: User = Depends(current_user)):
    with _lock(user.id):
        index = _read_index(user.id)
    return {"files": index["files"], "limit": MAX_TOTAL}


@router.get("/file")
def get_file(path: str, user: User = Depends(current_user)):
    rel = _clean_path(path)
    with _lock(user.id):
        entry = _read_index(user.id)["files"].get(rel)
        target = _file(user.id, rel)
        if not entry or entry.get("hash") is None or not target.is_file():
            raise HTTPException(404, "No such note file.")
        data = target.read_bytes()
    return Response(data, media_type="application/octet-stream", headers={"X-Hash": entry["hash"], "Cache-Control": "no-store"})


@router.put("/file")
async def put_file(request: Request, path: str, base: str = "", device_id: str = "", user: User = Depends(current_user)):
    rel = _clean_path(path)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_FILE:
        raise HTTPException(413, f"A note file can be at most {MAX_FILE // (1024 * 1024)} MB.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_FILE:
            raise HTTPException(413, f"A note file can be at most {MAX_FILE // (1024 * 1024)} MB.")
        chunks.append(chunk)
    data = b"".join(chunks)
    digest = hashlib.sha256(data).hexdigest()
    with _lock(user.id):
        index = _read_index(user.id)
        files = index["files"]
        current = files.get(rel)
        current_hash = current.get("hash") if current else None
        if current_hash is not None and current_hash != (base or None) and current_hash != digest:
            raise HTTPException(409, "This file changed on another computer: sync again.")
        live = [e for k, e in files.items() if e.get("hash") is not None and k != rel]
        if sum(int(e.get("size", 0)) for e in live) + len(data) > MAX_TOTAL:
            raise HTTPException(413, f"Synced notes can take at most {MAX_TOTAL // (1024 * 1024)} MB.")
        if current is None and len(files) >= MAX_FILES:
            raise HTTPException(413, f"At most {MAX_FILES} synced files.")
        target = _file(user.id, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".up-")
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        os.replace(tmp, target)
        entry = {"hash": digest, "size": len(data), "mtime": time.time()}
        files[rel] = entry
        _write_index(user.id, index)
    hub.publish([user.id], {"type": "notes.changed", "path": rel, "device_id": _clean_device(device_id)})
    return {"path": rel, **entry}


@router.delete("/file")
def delete_file(path: str, base: str = "", device_id: str = "", user: User = Depends(current_user)):
    rel = _clean_path(path)
    with _lock(user.id):
        index = _read_index(user.id)
        current = index["files"].get(rel)
        current_hash = current.get("hash") if current else None
        if current_hash is None:
            return {"path": rel, "hash": None}
        if current_hash != base:
            raise HTTPException(409, "This file changed on another computer: sync again.")
        target = _file(user.id, rel)
        target.unlink(missing_ok=True)
        # Remove folders left empty, up to the user's files folder.
        root = (_base(user.id) / "files").resolve()
        parent = target.parent
        while parent != root and root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
        index["files"][rel] = {"hash": None, "size": 0, "mtime": time.time()}
        _write_index(user.id, index)
    hub.publish([user.id], {"type": "notes.changed", "path": rel, "device_id": _clean_device(device_id)})
    return {"path": rel, "hash": None}
