"""The game launcher, run against fake games in a temporary folder."""

import socket
import sys
import threading
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

import pytest
from conftest import make_user
from fastapi.testclient import TestClient

from kherveos_server import config, games

# A game whose server is a tiny http.server serving its own folder on $PORT.
FAKE_SERVE = """
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
port = int(os.environ["PORT"])
print(f"fake game on {port}, HOST={os.environ.get('HOST')}", flush=True)
HTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler).serve_forever()
"""
CRASHY_SERVE = "import sys\nprint('boom: no planet today')\nsys.exit(3)\n"
SLEEPY_SERVE = "import time\ntime.sleep(60)\n"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def fake(tmp_path, monkeypatch):
    """Point the whitelist at fake games; returns it."""
    root = tmp_path / "projects"
    for folder, script in (("FakeGame", FAKE_SERVE), ("Crashy", CRASHY_SERVE), ("Sleepy", SLEEPY_SERVE)):
        (root / folder).mkdir(parents=True)
        (root / folder / "serve.py").write_text(script)
    (root / "FakeGame" / "index.html").write_text("<h1>fake game</h1>")
    whitelist = [
        games.Game("fake", "Fake Game", "FakeGame", "serve.py", free_port(), python=sys.executable),
        games.Game("crashy", "Crashy", "Crashy", "serve.py", free_port(), python=sys.executable),
        games.Game("sleepy", "Sleepy", "Sleepy", "serve.py", free_port(), python=sys.executable),
        games.Game("missing", "Missing", "NotInstalled", "serve.py", free_port(), python=sys.executable),
    ]
    monkeypatch.setenv("KHERVEOS_GAMES_DIR", str(root))
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(games, "GAMES", {g.id: g for g in whitelist})
    yield games.GAMES
    games.stop_all()


@pytest.fixture()
def local(client):
    """A client calling from 127.0.0.1, like a browser on this computer (`client` calls from elsewhere)."""
    from kherveos_server.app import app

    return TestClient(app, client=("127.0.0.1", 50000))


def test_list(client, fake):
    r = client.get("/api/games")
    assert r.status_code == 200
    listed = {g["id"]: g for g in r.json()["games"]}
    assert set(listed) == {"fake", "crashy", "sleepy", "missing"}
    assert listed["fake"] == {
        "id": "fake", "name": "Fake Game", "port": fake["fake"].port,
        "available": True, "running": False, "managed": False,
    }
    assert listed["missing"]["available"] is False


def test_start_and_stop(local, fake, monkeypatch):
    monkeypatch.setenv("HOST", "somewhere.example")  # must not reach the game
    port = fake["fake"].port
    r = local.post("/api/games/fake/start")
    assert r.status_code == 200, r.text
    assert r.json() == {"id": "fake", "url": f"http://testserver:{port}/", "started": True, "managed": True}
    assert games._listening(port)
    # started in its own folder, on $PORT, with its output in the log
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=5) as page:
        assert b"fake game" in page.read()
    assert f"fake game on {port}, HOST=None" in (config.DATA_DIR / "games" / "fake.log").read_text()

    again = local.post("/api/games/fake/start")
    assert again.status_code == 200 and again.json()["started"] is False

    listed = {g["id"]: g for g in local.get("/api/games").json()["games"]}
    assert listed["fake"]["running"] is True and listed["fake"]["managed"] is True

    assert local.post("/api/games/fake/stop").json() == {"id": "fake", "stopped": True, "running": False}
    assert not games._listening(port)
    assert local.post("/api/games/fake/stop").json()["stopped"] is False


def test_url_uses_the_host_the_browser_used(local, fake):
    port = fake["fake"].port
    assert local.post("/api/games/fake/start", headers={"host": "192.168.1.20:5173"}).json()["url"] == (
        f"http://192.168.1.20:{port}/"
    )
    assert local.post("/api/games/fake/start", headers={"host": "[::1]:5173"}).json()["url"] == f"http://[::1]:{port}/"


def test_already_running(client, fake):
    """Something already answers on the port: just return it, and never stop what we didn't start."""
    port = fake["fake"].port
    httpd = HTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        r = client.post("/api/games/fake/start")  # nothing gets started, so no sign-in needed
        assert r.status_code == 200
        assert r.json() == {"id": "fake", "url": f"http://testserver:{port}/", "started": False, "managed": False}
        make_user(client)
        assert client.post("/api/games/fake/stop").json() == {"id": "fake", "stopped": False, "running": True}
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_others_must_sign_in(client, fake):
    port = fake["fake"].port
    assert client.post("/api/games/fake/start").status_code == 401
    assert client.post("/api/games/fake/stop").status_code == 401
    assert not games._listening(port)

    make_user(client, "gamer")
    r = client.post("/api/games/fake/start")
    assert r.status_code == 200 and r.json()["started"] is True
    assert client.post("/api/games/fake/stop").json()["stopped"] is True


def test_other_sites_and_forwarded_requests_must_sign_in(local, fake):
    for headers in ({"origin": "http://evil.example"}, {"origin": "null"}, {"x-forwarded-for": "203.0.113.9"}):
        assert local.post("/api/games/fake/start", headers=headers).status_code == 401, headers
    assert not games._listening(fake["fake"].port)
    assert local.post("/api/games/fake/start", headers={"origin": "http://testserver"}).status_code == 200


def test_unknown_game(local, fake):
    assert local.post("/api/games/nope/start").status_code == 404
    assert local.post("/api/games/nope/stop").status_code == 404
    assert local.post("/api/games/..%2Fevil/start").status_code == 404


def test_not_installed(local, fake):
    r = local.post("/api/games/missing/start")
    assert r.status_code == 503
    assert "isn't installed" in r.json()["detail"]


def test_did_not_start(local, fake, monkeypatch):
    r = local.post("/api/games/crashy/start")
    assert r.status_code == 504
    detail = r.json()["detail"]
    assert "exit code 3" in detail and "boom: no planet today" in detail

    monkeypatch.setattr(games, "START_TIMEOUT", 1.0)
    r = local.post("/api/games/sleepy/start")
    assert r.status_code == 504
    assert "didn't open port" in r.json()["detail"]
    assert "sleepy" not in games._procs  # the half-started server was stopped


def test_stop_all(local, fake):
    port = fake["fake"].port
    assert local.post("/api/games/fake/start").status_code == 200
    games.stop_all()
    assert not games._listening(port)
    assert games._procs == {}
