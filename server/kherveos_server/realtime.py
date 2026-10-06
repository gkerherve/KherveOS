"""Live events over one websocket per browser tab (/api/ws).

Server -> browser: call `hub.publish(user_ids, {"type": "...", ...})` from any
endpoint — sync (thread pool) or async — and every open tab of those users
receives the event. The front end listens with `realtime.on("type", fn)`.

Browser -> server: register a handler with

    @hub.on("typing")
    async def typing(user, event): ...
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Awaitable, Callable, Iterable

from fastapi import WebSocket, WebSocketDisconnect

from .auth import User, websocket_user

log = logging.getLogger("kherveos.realtime")

Handler = Callable[[User, dict], Awaitable[None]]


class Hub:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._handlers: dict[str, Handler] = {}
        self._on_connect: list[Callable[[User, bool], Awaitable[None]]] = []

    # -- registration -------------------------------------------------------

    def on(self, event_type: str):
        def deco(fn: Handler) -> Handler:
            self._handlers[event_type] = fn
            return fn

        return deco

    def on_presence(self, fn: Callable[[User, bool], Awaitable[None]]):
        """fn(user, online) runs when a user's first tab connects / last tab leaves."""
        self._on_connect.append(fn)
        return fn

    # -- queries ------------------------------------------------------------

    def is_online(self, user_id: int) -> bool:
        return bool(self._conns.get(user_id))

    def online_ids(self) -> list[int]:
        return [uid for uid, conns in self._conns.items() if conns]

    # -- sending ------------------------------------------------------------

    async def _send_many(self, user_ids: Iterable[int], event: dict) -> None:
        text = json.dumps(event, default=str)
        for uid in set(user_ids):
            for ws in list(self._conns.get(uid, ())):
                try:
                    await ws.send_text(text)
                except Exception:  # the tab went away mid-send
                    self._conns[uid].discard(ws)

    def publish(self, user_ids: Iterable[int], event: dict) -> None:
        """Send an event to users. Safe to call from sync or async code."""
        if self.loop is None:
            return
        ids = list(user_ids)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            self.loop.create_task(self._send_many(ids, event))
        else:
            asyncio.run_coroutine_threadsafe(self._send_many(ids, event), self.loop)

    # -- the websocket endpoint ---------------------------------------------

    async def serve(self, ws: WebSocket) -> None:
        user = websocket_user(ws)
        if user is None:
            await ws.close(code=4401)
            return
        await ws.accept()
        first = not self._conns.get(user.id)
        self._conns[user.id].add(ws)
        await ws.send_text(json.dumps({"type": "hello", "user": user.public()}))
        if first:
            for fn in self._on_connect:
                await fn(user, True)
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                handler = self._handlers.get(str(event.get("type")))
                if handler:
                    try:
                        await handler(user, event)
                    except Exception:
                        log.exception("realtime handler %s failed", event.get("type"))
        except WebSocketDisconnect:
            pass
        finally:
            self._conns[user.id].discard(ws)
            if not self._conns[user.id]:
                for fn in self._on_connect:
                    try:
                        await fn(user, False)
                    except Exception:
                        log.exception("presence handler failed")


hub = Hub()
