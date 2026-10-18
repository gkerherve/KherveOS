"""Kherve Grand Prix multiplayer: race rooms on this server.

A player hosts a room (a four-digit code); others on the same KherveOS server
(the same computer, or a tablet or phone on the network that opened
http://<this computer's address>:5173) join it. The host picks the circuit,
series and laps and starts the race; the server hands every car on the grid
to a player or to the AI, then relays what each game sends: every player's
own car, and the AI cars, which the host's game drives for everyone.

Guests may play without a KherveOS account (a friend's tablet that has not signed in):
a room only relays car positions, nothing of anyone's files. Messages are JSON over /api/gp/ws:
  client -> server: host {name, team, settings} · join {code, name, team} ·
      team {team} · settings {settings} · start {seed} · lobby · cars {c} · leave
  server -> client: room {code, you, host, players, settings, state} ·
      start {settings, seed, lineup} · cars {from, c} · left {id} · error {text}
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
import random
import socket
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from .auth import websocket_user

router = APIRouter(prefix="/api/gp")

CARS = 12  # two per team, six teams
MAX_PLAYERS = 8
MAX_ROOMS = 30
MAX_MESSAGE = 8192  # bytes: a full grid of car states is about 1.5 kB
MAX_RATE = 80  # messages a second per player


@dataclass
class Player:
    id: int
    name: str
    team: int
    ws: WebSocket
    user: int
    sent: list[float] = field(default_factory=list)


@dataclass
class Room:
    code: str
    host: int
    settings: dict
    players: dict[int, Player] = field(default_factory=dict)
    state: str = "lobby"  # lobby | racing
    created: float = field(default_factory=time.time)


rooms: dict[str, Room] = {}
_next_id = 1


def _new_id() -> int:
    global _next_id
    _next_id += 1
    return _next_id


def _clean_name(v: object, fallback: str) -> str:
    s = "".join(ch for ch in str(v or "") if ch.isprintable()).strip()[:24]
    return s or fallback


def _clean_team(v: object) -> int:
    try:
        return max(0, min(CARS // 2 - 1, int(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _clean_settings(v: object) -> dict:
    if not isinstance(v, dict):
        return {}
    keep = {"track", "series", "laps", "difficulty", "assists", "damage", "time", "ai"}
    out = {k: v[k] for k in keep if k in v and isinstance(v[k], (str, int, float, bool))}
    if "laps" in out:
        try:
            out["laps"] = max(1, min(30, int(out["laps"])))
        except (TypeError, ValueError):
            out.pop("laps")
    return out


def lineup(players: list[tuple[int, str, int]], ai: bool) -> list[dict]:
    """Every car on the grid: each player gets a car of the team they chose (the
    first free one, else any free car), in the order they joined; the AI drives
    the rest (or they stay in the garage). Car c belongs to team c // 2."""
    taken: dict[int, dict] = {}
    for pid, name, team in players:
        want = [2 * team, 2 * team + 1] + list(range(CARS))
        car = next(c for c in want if c not in taken)
        taken[car] = {"car": car, "id": pid, "name": name, "human": True}
    cars = [taken.get(c) or {"car": c, "id": 0, "name": "", "human": False} for c in range(CARS)]
    return [c for c in cars if c["human"] or ai]


def _room_msg(room: Room, you: int) -> dict:
    return {
        "t": "room",
        "code": room.code,
        "you": you,
        "host": room.host,
        "state": room.state,
        "settings": room.settings,
        "players": [{"id": p.id, "name": p.name, "team": p.team} for p in room.players.values()],
    }


async def _send(p: Player, msg: dict) -> None:
    try:
        await p.ws.send_text(json.dumps(msg, separators=(",", ":")))
    except Exception:
        pass  # gone: its own handler cleans up


async def _announce(room: Room) -> None:
    await asyncio.gather(*(_send(p, _room_msg(room, p.id)) for p in list(room.players.values())))


async def _leave(room: Room, pid: int) -> None:
    room.players.pop(pid, None)
    if not room.players:
        rooms.pop(room.code, None)
        return
    if room.host == pid:
        room.host = next(iter(room.players))
        if room.state == "racing":
            # the AI was driven by the old host's game: the race cannot go on as it was
            room.state = "lobby"
    await asyncio.gather(*(_send(p, {"t": "left", "id": pid}) for p in room.players.values()))
    await _announce(room)


def _code() -> str:
    for _ in range(200):
        c = f"{random.randint(1000, 9999)}"
        if c not in rooms:
            return c
    raise RuntimeError("no free room code")


@router.get("/rooms")
def list_rooms():
    """The rooms waiting for players."""
    return {
        "rooms": [
            {
                "code": r.code,
                "host": r.players[r.host].name if r.host in r.players else "",
                "players": len(r.players),
                "state": r.state,
                "settings": r.settings,
            }
            for r in rooms.values()
        ]
    }


def cars_dir() -> Path:
    """Where cars shaped in KherveCAD wait for the game: a .glb per classic model."""
    return Path(os.environ.get("KHERVEOS_GP_CARS", str(Path.home() / "Documents" / "Kherve Grand Prix cars")))


CAR_NAMES = ("stoccarda", "dieppe", "bavaria")


@router.get("/cars")
def list_cars():
    """The classic models that have a KherveCAD car (<model>.glb) in the cars folder."""
    folder = cars_dir()
    return {"cars": [n for n in CAR_NAMES if (folder / f"{n}.glb").is_file()], "folder": str(folder)}


@router.get("/cars/{name}.glb")
def car_file(name: str):
    """One car's glTF binary (read-only, only the known model names)."""
    if not re.fullmatch(r"[a-z]+", name) or name not in CAR_NAMES:
        raise HTTPException(status_code=404, detail="No such car.")
    path = cars_dir() / f"{name}.glb"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="No such car.")
    return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "no-store"})


@router.get("/info")
def info():
    """This computer's network addresses, for the other players to type into their browser."""
    addrs: list[str] = []
    try:
        # no packet is sent: connecting a UDP socket only picks the outgoing interface
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            addrs.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for a in socket.gethostbyname_ex(socket.gethostname())[2]:
            if a not in addrs and not a.startswith("127."):
                addrs.append(a)
    except OSError:
        pass
    return {"addresses": [a for a in addrs if not a.startswith("127.")]}


async def serve(ws: WebSocket) -> None:
    user = websocket_user(ws)  # None for a guest: they play under the name they type
    await ws.accept()
    uid = user.id if user else 0
    fallback = (user.display_name or user.username) if user else "Guest"
    me: Player | None = None
    room: Room | None = None
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MESSAGE:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            t = msg.get("t")
            if t in ("host", "join"):
                if room and me:
                    await _leave(room, me.id)
                    room = me = None
                name = _clean_name(msg.get("name"), fallback)
                if t == "host":
                    if len(rooms) >= MAX_ROOMS:
                        await ws.send_text(json.dumps({"t": "error", "text": "Too many rooms are open on this server."}))
                        continue
                    me = Player(_new_id(), name, _clean_team(msg.get("team")), ws, uid)
                    room = Room(_code(), me.id, _clean_settings(msg.get("settings")))
                    rooms[room.code] = room
                else:
                    r = rooms.get(str(msg.get("code", "")).strip())
                    if r is None:
                        await ws.send_text(json.dumps({"t": "error", "text": "No room with that code."}))
                        continue
                    if len(r.players) >= MAX_PLAYERS:
                        await ws.send_text(json.dumps({"t": "error", "text": "That room is full."}))
                        continue
                    if r.state != "lobby":
                        await ws.send_text(json.dumps({"t": "error", "text": "That race has already started."}))
                        continue
                    room = r
                    me = Player(_new_id(), name, _clean_team(msg.get("team")), ws, uid)
                room.players[me.id] = me
                await _announce(room)
                continue
            if not room or not me:
                continue
            if t == "cars":
                # rate limit, then relay to everyone else in the room
                now = time.monotonic()
                me.sent = [x for x in me.sent if now - x < 1] + [now]
                if len(me.sent) > MAX_RATE or room.state != "racing":
                    continue
                out = json.dumps({"t": "cars", "from": me.id, "c": msg.get("c")}, separators=(",", ":"))
                for p in list(room.players.values()):
                    if p.id != me.id:
                        try:
                            await p.ws.send_text(out)
                        except Exception:
                            pass
            elif t == "team":
                me.team = _clean_team(msg.get("team"))
                await _announce(room)
            elif t == "settings" and me.id == room.host:
                room.settings = _clean_settings(msg.get("settings"))
                await _announce(room)
            elif t == "start" and me.id == room.host and room.state == "lobby":
                room.state = "racing"
                players = [(p.id, p.name, p.team) for p in room.players.values()]
                seed = msg.get("seed") if isinstance(msg.get("seed"), int) else random.randint(1, 2**31)
                start = {"t": "start", "settings": room.settings, "seed": seed, "lineup": lineup(players, bool(room.settings.get("ai", True)))}
                await asyncio.gather(*(_send(p, start) for p in room.players.values()))
                await _announce(room)
            elif t == "lobby" and me.id == room.host:
                room.state = "lobby"
                await _announce(room)
            elif t == "leave":
                await _leave(room, me.id)
                room = me = None
    except WebSocketDisconnect:
        pass
    finally:
        if room and me:
            await _leave(room, me.id)


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    await serve(ws)
