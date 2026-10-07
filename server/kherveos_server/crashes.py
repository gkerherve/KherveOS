"""Crash reports from the KherveOS apps, written to the server log.

When an app crashes in someone's browser, the browser sends the error here (only
when signed in), so it can be read in the server's log instead of being copied
out of a dialog. Reports are also appended to data/crashes.log, which outlives
restarts. POST /api/crash {app, message, stack, component}.
"""

from __future__ import annotations

import sys
import time

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from . import config
from .auth import User, current_user

router = APIRouter(prefix="/api/crash", tags=["crash"])

_recent: dict[int, list[float]] = {}
_PER_MINUTE = 20


class Crash(BaseModel):
    app: str = Field(max_length=80)
    message: str = Field(max_length=2000)
    stack: str = Field(default="", max_length=8000)
    component: str = Field(default="", max_length=8000)


@router.post("", status_code=204)
async def report(crash: Crash, user: User = Depends(current_user)) -> Response:
    # A crash loop must not flood the log: at most 20 reports a minute per person.
    now = time.monotonic()
    times = [t for t in _recent.get(user.id, []) if now - t < 60]
    if len(times) < _PER_MINUTE:
        times.append(now)
        lines = [f"[crash] {crash.app} ({user.username}): {crash.message}"]
        lines += [f"    {line}" for line in (crash.stack + "\n" + crash.component).strip().splitlines()[:60]]
        text = "\n".join(lines)
        print(text, file=sys.stderr, flush=True)
        try:
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            with open(config.DATA_DIR / "crashes.log", "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
        except OSError:
            pass
    _recent[user.id] = times
    return Response(status_code=204)
