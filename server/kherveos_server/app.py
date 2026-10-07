"""The FastAPI application: every route lives under /api."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket

from . import __version__, ai, auth, crashes, db, games, gitproxy, latex, mail, mcp_server, messages, refs
from .realtime import hub


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    hub.loop = asyncio.get_running_loop()
    yield
    games.stop_all()


app = FastAPI(title="KherveOS server", version=__version__, lifespan=lifespan)
app.include_router(auth.router)
app.include_router(auth.users_router)
app.include_router(messages.router)
app.include_router(mail.router)
app.include_router(games.router)
app.include_router(gitproxy.router)
app.include_router(latex.router)
app.include_router(refs.router)
app.include_router(ai.router)
app.include_router(mcp_server.router)
app.include_router(crashes.router)


@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__}


@app.websocket("/api/ws")
async def websocket(ws: WebSocket):
    await hub.serve(ws)
