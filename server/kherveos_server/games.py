"""Starts the web games' own servers on demand.

PlanetCraft, SimAI and FaceCraft are separate projects next to KherveOS, each
with a small Python server of its own. Their pages fetch absolute paths
(/api/save, /ws, /shot...) on their own origin, so KherveOS cannot serve them:
it starts the game's server, and the OS shows http://<host>:<port>/ in an iframe.

Only the games in GAMES are ever run. Their servers need nothing but the
standard library, so they run on the system `python3` (or, failing that, the
Python running KherveOS), each in a session of its own with its output
appended to data/games/<id>.log.

    GET  /api/games             {"games": [{id, name, port, available, running, managed}]}
    POST /api/games/{id}/start  {"id", "url", "started", "managed"}
                                404 unknown game, 503 not installed, 504 did not start
    POST /api/games/{id}/stop   {"id", "stopped", "running"}

Starting or stopping a program needs no account when the request comes from
this computer; from anywhere else it needs a signed-in user.
"""

from __future__ import annotations

import atexit
import ipaddress
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request

from . import auth, config

router = APIRouter(prefix="/api/games", tags=["games"])

START_TIMEOUT = 15.0  # seconds a game gets to open its port
LOG_TAIL = 15  # log lines quoted when a game does not start
LOG_MAX = 1_000_000  # a log bigger than this starts again from empty


@dataclass(frozen=True)
class Game:
    id: str
    name: str
    folder: str  # relative to the games folder
    script: str
    port: int
    python: str = "python3"  # the games only use the standard library

    @property
    def path(self) -> Path:
        return games_dir() / self.folder

    @property
    def available(self) -> bool:
        return (self.path / self.script).is_file()


#: The whitelist. Nothing else is ever started.
GAMES: dict[str, Game] = {
    g.id: g
    for g in (
        Game("planetcraft", "PlanetCraft", "KhervePlanet", "serve.py", 8123),
        Game("simai", "SimAI", "SimAI", "serve.py", 8137),
        Game("madsci", "Mad Scientist SIM", "MadScientistSIM", "serve.py", 8147),
        Game("facecraft", "FaceCraft", "KherveSkins", "serve.py", 8140),
    )
}


def games_dir() -> Path:
    """The folder holding the game projects: $KHERVEOS_GAMES_DIR, else the one holding KherveOS."""
    return Path(os.environ.get("KHERVEOS_GAMES_DIR") or config.PROJECTS_DIR)


# ----------------------------------------------------------------- processes

_procs: dict[str, subprocess.Popen] = {}  # the servers we started, by game id
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(game_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(game_id, threading.Lock())


def _listening(port: int) -> bool:
    """Is something on this computer accepting connections on `port`?"""
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            continue
    return False


def _managed(game_id: str) -> bool:
    """Did we start this game's server, and is it still running?"""
    proc = _procs.get(game_id)
    if proc is not None and proc.poll() is not None:
        _procs.pop(game_id, None)  # it ended by itself (and is now reaped)
        return False
    return proc is not None


def _log_path(game: Game) -> Path:
    return config.DATA_DIR / "games" / f"{game.id}.log"


def _log_tail(path: Path, offset: int) -> str:
    """The last lines written to the log since `offset`."""
    try:
        with open(path, "rb") as fh:
            size = fh.seek(0, os.SEEK_END)
            fh.seek(max(offset, size - 16384))
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        return ""
    return "\n".join(text.strip().splitlines()[-LOG_TAIL:])


def _launch(game: Game) -> tuple[subprocess.Popen, int]:
    """Start the game's server; returns the process and where its output starts in the log."""
    log_path = _log_path(game)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    python = shutil.which(game.python) or sys.executable
    # Each game binds where it means to; a stray HOST (some shells export one) would move it.
    env = {k: v for k, v in os.environ.items() if k != "HOST"}
    env.update(PORT=str(game.port), PYTHONUNBUFFERED="1")
    fresh = not log_path.exists() or log_path.stat().st_size > LOG_MAX
    with open(log_path, "wb" if fresh else "ab") as log:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        log.write(f"\n--- {stamp}  {python} {game.script}  (port {game.port})\n".encode())
        log.flush()
        offset = log.tell()
        try:
            proc = subprocess.Popen(
                [python, game.script],
                cwd=game.path,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # our Ctrl+C is not theirs; stop_all() ends them
            )
        except OSError as exc:
            raise HTTPException(503, f"Could not run {game.name}'s server with {python}: {exc}") from exc
    return proc, offset


def _wait_for_port(game: Game, proc: subprocess.Popen, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _listening(game.port):
            return True
        if proc.poll() is not None:  # it gave up
            return False
        time.sleep(0.1)
    return _listening(game.port)


def _signal(proc: subprocess.Popen, sig: int) -> None:
    try:
        if hasattr(os, "killpg"):
            os.killpg(proc.pid, sig)  # the whole session, helpers included
        elif sig == signal.SIGTERM:
            proc.terminate()
        else:
            proc.kill()
    except OSError:  # already gone
        pass


def _terminate(procs: list[subprocess.Popen], grace: float = 5.0) -> None:
    alive = [p for p in procs if p.poll() is None]
    for p in alive:
        _signal(p, signal.SIGTERM)
    deadline = time.monotonic() + grace
    for p in alive:
        try:
            p.wait(max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            _signal(p, getattr(signal, "SIGKILL", signal.SIGTERM))
            try:
                p.wait(2)
            except subprocess.TimeoutExpired:
                pass


def _stop(game_id: str) -> bool:
    """Stop the game's server if we started it. True if it was running."""
    proc = _procs.pop(game_id, None)
    if proc is None or proc.poll() is not None:
        return False
    _terminate([proc])
    return True


def stop_all() -> None:
    """Stop every game server KherveOS started (the server is shutting down)."""
    procs = [_procs.pop(game_id) for game_id in list(_procs)]
    _terminate(procs)


atexit.register(stop_all)  # in case the server ends without its shutdown hook


# ------------------------------------------------------------------- access

def _is_loopback(address: str | None) -> bool:
    try:
        ip = ipaddress.ip_address((address or "").strip().strip("[]"))
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)  # ::ffff:127.0.0.1
    return (mapped or ip).is_loopback


def _from_this_computer(request: Request) -> bool:
    """From a loopback address, not forwarded from elsewhere, and not sent by another site's page."""
    if not _is_loopback(request.client.host if request.client else None):
        return False
    forwarded = [a for a in request.headers.get("x-forwarded-for", "").split(",") if a.strip()]
    if not all(_is_loopback(a) for a in forwarded):
        return False
    origin = request.headers.get("origin")
    return origin is None or urlsplit(origin).netloc.lower() == request.headers.get("host", "").lower()


def _check_may_run(request: Request) -> None:
    """Running programs: fine from this computer, otherwise only for a signed-in user (401)."""
    if not _from_this_computer(request):
        auth.current_user(request)


def _game(game_id: str) -> Game:
    game = GAMES.get(game_id)
    if game is None:
        raise HTTPException(404, f"There is no game called {game_id!r}.")
    return game


def _url(request: Request, port: int) -> str:
    """The game's address, on the host name the browser used to reach KherveOS."""
    host = request.url.hostname or "127.0.0.1"
    if ":" in host:  # an IPv6 address
        host = f"[{host}]"
    return f"http://{host}:{port}/"


# ---------------------------------------------------------------- endpoints

@router.get("")
def list_games():
    return {
        "games": [
            {
                "id": g.id,
                "name": g.name,
                "port": g.port,
                "available": g.available,
                "running": _listening(g.port),
                "managed": _managed(g.id),
            }
            for g in GAMES.values()
        ]
    }


@router.post("/{game_id}/start")
def start_game(game_id: str, request: Request):
    """Start the game's server unless something already answers on its port; return its address."""
    game = _game(game_id)
    started = False
    with _lock(game.id):
        if not _listening(game.port):
            _check_may_run(request)
            if not game.available:
                raise HTTPException(503, f"{game.name} isn't installed: {game.path / game.script} was not found.")
            _stop(game.id)  # a copy of ours that stopped answering
            proc, offset = _launch(game)
            _procs[game.id] = proc
            if not _wait_for_port(game, proc, START_TIMEOUT):
                code = proc.poll()
                _stop(game.id)
                log_path = _log_path(game)
                why = (
                    f"{game.name}'s server stopped straight away (exit code {code})."
                    if code is not None
                    else f"{game.name}'s server didn't open port {game.port} within {START_TIMEOUT:g} seconds."
                )
                tail = _log_tail(log_path, offset) or "(it printed nothing)"
                raise HTTPException(504, f"{why}\nLast lines of {log_path}:\n{tail}")
            started = True
    return {"id": game.id, "url": _url(request, game.port), "started": started, "managed": _managed(game.id)}


@router.post("/{game_id}/stop")
def stop_game(game_id: str, request: Request):
    """Stop the game's server if KherveOS started it (one started by hand is left alone)."""
    game = _game(game_id)
    _check_may_run(request)
    with _lock(game.id):
        stopped = _stop(game.id)
    return {"id": game.id, "stopped": stopped, "running": _listening(game.port)}
