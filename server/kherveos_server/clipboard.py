"""Clipboard: copy files on one computer, paste them on another.

Files in KherveOS live in each browser (IndexedDB), so a Copy normally stays on
that computer. When the user is signed in, Copy also sends the copied items
here, as one zip that keeps their folders, and Paste on any other computer
signed in to the same account fetches it.

One clipboard per user, replaced by each Copy, kept on disk under
data/clipboard/ as <user id>.zip plus <user id>.json (what is in it, which
computer it came from, when). At most MAX_BYTES of files (uncompressed).

Endpoints (signed-in users only)
  GET    /api/clipboard         {"clipboard": info | null, "limit": MAX_BYTES}
  PUT    /api/clipboard?device_id=…&device=…   body: the zip (application/zip)
  GET    /api/clipboard/data    the zip
  DELETE /api/clipboard         empty it

Live event (see realtime.py), to every tab of the user:
  clipboard.changed  {clipboard: info | null}
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from . import config
from .auth import User, current_user
from .realtime import hub

log = logging.getLogger("kherveos.clipboard")

router = APIRouter(prefix="/api/clipboard", tags=["clipboard"])

MAX_BYTES = 100 * 1024 * 1024  # files in the clipboard, uncompressed
MAX_UPLOAD_SLACK = 4 * 1024 * 1024  # a zip of incompressible files is a little bigger than they are
MAX_ENTRIES = 20_000
MAX_DEVICE = 60


def _dir() -> Path:
    d = config.DATA_DIR / "clipboard"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _paths(user_id: int) -> tuple[Path, Path]:
    d = _dir()
    return d / f"{user_id}.zip", d / f"{user_id}.json"


def _read_info(user_id: int) -> dict | None:
    zip_path, info_path = _paths(user_id)
    if not zip_path.exists() or not info_path.exists():
        return None
    try:
        return json.loads(info_path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _safe_name(name: str) -> bool:
    """A zip entry that unpacks inside the folder it is pasted into."""
    if not name or "\\" in name or "\x00" in name or name.startswith("/"):
        return False
    if re.match(r"^[A-Za-z]:", name):
        return False
    parts = [p for p in PurePosixPath(name).parts if p not in ("", ".")]
    return bool(parts) and ".." not in parts


def _inspect(zip_path: Path) -> dict:
    """Check an uploaded zip and describe it; raises HTTPException when it is not acceptable."""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            infos = zf.infolist()
    except (zipfile.BadZipFile, OSError):
        raise HTTPException(400, "The clipboard must be a zip file.")
    if not infos:
        raise HTTPException(400, "Nothing was copied.")
    if len(infos) > MAX_ENTRIES:
        raise HTTPException(413, f"Too many items for the shared clipboard (at most {MAX_ENTRIES}).")
    size = 0
    files = 0
    folders: set[str] = set()
    top: dict[str, str] = {}
    for info in infos:
        if not _safe_name(info.filename):
            raise HTTPException(400, f"Unsafe name in the clipboard: {info.filename!r}")
        parts = [p for p in PurePosixPath(info.filename).parts if p not in ("", ".")]
        is_dir = info.is_dir()
        # every folder on the way counts, also when the zip has no entry for it
        for i in range(1, len(parts) if not is_dir else len(parts) + 1):
            folders.add("/".join(parts[:i]))
        if not is_dir:
            files += 1
            size += info.file_size
        kind = "dir" if is_dir or len(parts) > 1 else "file"
        if top.get(parts[0]) != "dir":
            top[parts[0]] = kind
    if size > MAX_BYTES:
        raise HTTPException(413, f"The shared clipboard holds at most {MAX_BYTES // (1024 * 1024)} MB.")
    return {
        "items": [{"name": name, "type": kind} for name, kind in top.items()],
        "files": files,
        "folders": len(folders),
        "size": size,
    }


def _clean_device(name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:MAX_DEVICE] or "another computer"


# ------------------------------------------------------------------ routes

@router.get("")
def get_clipboard(user: User = Depends(current_user)):
    return {"clipboard": _read_info(user.id), "limit": MAX_BYTES}


@router.put("")
async def put_clipboard(request: Request, device_id: str = "", device: str = "", user: User = Depends(current_user)):
    """Replace the user's clipboard with the zip in the request body."""
    cap = MAX_BYTES + MAX_UPLOAD_SLACK
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > cap:
        raise HTTPException(413, f"The shared clipboard holds at most {MAX_BYTES // (1024 * 1024)} MB.")
    zip_path, info_path = _paths(user.id)
    fd, tmp_name = tempfile.mkstemp(dir=_dir(), prefix=f".{user.id}-", suffix=".zip")
    tmp = Path(tmp_name)
    try:
        received = 0
        with os.fdopen(fd, "wb") as out:
            async for chunk in request.stream():
                received += len(chunk)
                if received > cap:
                    raise HTTPException(413, f"The shared clipboard holds at most {MAX_BYTES // (1024 * 1024)} MB.")
                out.write(chunk)
        if not received:
            raise HTTPException(400, "Nothing was copied.")
        info = {
            "id": uuid.uuid4().hex,
            "created_at": time.time(),
            "device_id": re.sub(r"[^A-Za-z0-9_-]", "", device_id)[:64],
            "device": _clean_device(device),
            **_inspect(tmp),
            "zip_size": received,
        }
        tmp_info = info_path.with_suffix(".json.tmp")
        tmp_info.write_text(json.dumps(info), "utf-8")
        os.replace(tmp, zip_path)
        os.replace(tmp_info, info_path)
    finally:
        tmp.unlink(missing_ok=True)
    log.info("user %s copied %s files (%s bytes) from %s", user.id, info["files"], info["size"], info["device"])
    hub.publish([user.id], {"type": "clipboard.changed", "clipboard": info})
    return {"clipboard": info}


@router.get("/data")
def get_clipboard_data(user: User = Depends(current_user)):
    zip_path, _ = _paths(user.id)
    info = _read_info(user.id)
    if info is None:
        raise HTTPException(404, "The clipboard is empty.")
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename="clipboard.zip",
        headers={"X-Clipboard-Id": info["id"], "Cache-Control": "no-store"},
    )


@router.delete("")
def clear_clipboard(user: User = Depends(current_user)):
    zip_path, info_path = _paths(user.id)
    existed = zip_path.exists() or info_path.exists()
    info_path.unlink(missing_ok=True)
    zip_path.unlink(missing_ok=True)
    if existed:
        hub.publish([user.id], {"type": "clipboard.changed", "clipboard": None})
    return {"ok": True}
