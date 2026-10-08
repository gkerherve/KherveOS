"""Notes sync: the user's ~/Notes kept on the server, with hashes and tombstones."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from conftest import make_user

API = "/api/notes/sync"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    from kherveos_server import config

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put(c, path, data, base="", device_id="mac1"):
    return c.put(f"{API}/file", params={"path": path, "base": base, "device_id": device_id}, content=data)


def test_needs_sign_in(client):
    assert client.get(API).status_code == 401
    assert put(client, "a.md", b"x").status_code == 401


def test_upload_download_manifest(client):
    make_user(client)
    assert client.get(API).json()["files"] == {}
    r = put(client, "Work/Plan.md", b"---\nid: n-1\n---\nPlan\n")
    assert r.status_code == 200, r.text
    assert r.json()["hash"] == sha(b"---\nid: n-1\n---\nPlan\n")
    files = client.get(API).json()["files"]
    assert list(files) == ["Work/Plan.md"]
    assert files["Work/Plan.md"]["size"] == len(b"---\nid: n-1\n---\nPlan\n")
    got = client.get(f"{API}/file", params={"path": "Work/Plan.md"})
    assert got.status_code == 200
    assert got.content == b"---\nid: n-1\n---\nPlan\n"
    assert got.headers["x-hash"] == files["Work/Plan.md"]["hash"]


def test_writes_must_be_based_on_the_current_version(client):
    make_user(client)
    h1 = put(client, "a.md", b"one").json()["hash"]
    # Another computer that never saw it, or saw an older version, is refused.
    assert put(client, "a.md", b"two", base="").status_code == 409
    assert put(client, "a.md", b"two", base="0" * 64).status_code == 409
    # The same content is fine (nothing to lose); the right base too.
    assert put(client, "a.md", b"one", base="").status_code == 200
    h2 = put(client, "a.md", b"two", base=h1).json()["hash"]
    assert client.delete(f"{API}/file", params={"path": "a.md", "base": h1}).status_code == 409
    assert client.delete(f"{API}/file", params={"path": "a.md", "base": h2}).status_code == 200
    assert client.get(API).json()["files"]["a.md"]["hash"] is None, "a tombstone"
    assert client.get(f"{API}/file", params={"path": "a.md"}).status_code == 404
    # A deleted file can be written again from scratch.
    assert put(client, "a.md", b"three").status_code == 200


def test_each_user_has_their_own_notes(client):
    make_user(client, "alice")
    put(client, "mine.md", b"alice")
    from kherveos_server.app import app

    with TestClient(app) as bob:
        make_user(bob, "bob")
        assert bob.get(API).json()["files"] == {}
        assert bob.get(f"{API}/file", params={"path": "mine.md"}).status_code == 404


@pytest.mark.parametrize("bad", ["../x.md", "/etc/passwd", "a/../../b.md", "a\\b.md", "C:/x.md", "a//", "", "x\x00.md", "./a.md"])
def test_unsafe_paths_are_refused(client, bad):
    make_user(client)
    assert put(client, bad, b"x").status_code in (400, 422)


def test_limits(client, monkeypatch):
    from kherveos_server import notes_sync

    make_user(client)
    monkeypatch.setattr(notes_sync, "MAX_FILE", 10)
    assert put(client, "big.md", b"x" * 11).status_code == 413
    monkeypatch.setattr(notes_sync, "MAX_TOTAL", 15)
    assert put(client, "a.md", b"x" * 10).status_code == 200
    assert put(client, "b.md", b"x" * 6).status_code == 413


def test_changes_are_announced(client):
    make_user(client)
    with client.websocket_connect("/api/ws") as ws:
        put(client, "a.md", b"hello", device_id="pc-2")
        for _ in range(20):
            event = ws.receive_json()
            if event["type"] == "notes.changed":
                break
        assert event == {"type": "notes.changed", "path": "a.md", "device_id": "pc-2"}
