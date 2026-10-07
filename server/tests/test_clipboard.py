"""Clipboard: copy on one computer, paste on another (one zip per user)."""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from conftest import make_user

API = "/api/clipboard"


@pytest.fixture(autouse=True)
def mounted(tmp_path, monkeypatch):
    """Mount the router (until app.py does) and keep the clipboard in a fresh folder."""
    from kherveos_server import clipboard, config
    from kherveos_server.app import app

    if not any(getattr(r, "path", "").startswith(API) for r in app.routes):
        app.include_router(clipboard.router)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)


def new_client() -> TestClient:
    from kherveos_server.app import app

    return TestClient(app)


def make_zip(entries: dict[str, bytes | None]) -> bytes:
    """name -> bytes for files, None for a folder entry ("name/")."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            if data is None:
                zf.writestr(name if name.endswith("/") else name + "/", b"")
            else:
                zf.writestr(name, data)
    return buf.getvalue()


def copy(c, data: bytes, device_id="mac1", device="Chrome on macOS"):
    return c.put(
        API,
        params={"device_id": device_id, "device": device},
        content=data,
        headers={"Content-Type": "application/zip"},
    )


def receive_until(ws, event_type, limit=20):
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == event_type:
            return event
    raise AssertionError(f"no {event_type!r} event")


SAMPLE = {
    "Report.txt": b"hello",
    "Project/": None,
    "Project/notes.md": b"# notes",
    "Project/data/table.csv": b"a,b\n1,2\n",
    "Project/empty/": None,
}


def test_needs_login(client):
    assert client.get(API).status_code == 401
    assert copy(client, make_zip(SAMPLE)).status_code == 401
    assert client.get(f"{API}/data").status_code == 401
    assert client.delete(API).status_code == 401


def test_empty_at_first(client):
    make_user(client, "alice")
    r = client.get(API)
    assert r.status_code == 200
    assert r.json()["clipboard"] is None
    assert r.json()["limit"] == 100 * 1024 * 1024
    assert client.get(f"{API}/data").status_code == 404


def test_copy_then_paste_elsewhere_keeps_folders(client):
    make_user(client, "alice", password="correct-horse")
    data = make_zip(SAMPLE)
    r = copy(client, data)
    assert r.status_code == 200, r.text
    info = r.json()["clipboard"]
    assert info["device"] == "Chrome on macOS"
    assert info["device_id"] == "mac1"
    assert info["files"] == 3
    assert info["folders"] == 3  # Project, Project/data, Project/empty
    assert info["size"] == len(b"hello") + len(b"# notes") + len(b"a,b\n1,2\n")
    assert {(i["name"], i["type"]) for i in info["items"]} == {("Report.txt", "file"), ("Project", "dir")}

    # "another computer": a second client signed in to the same account
    other = new_client()
    r = other.post("/api/auth/login", json={"username": "alice", "password": "correct-horse"})
    assert r.status_code == 200, r.text
    assert other.get(API).json()["clipboard"]["id"] == info["id"]
    got = other.get(f"{API}/data")
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/zip"
    assert got.headers["x-clipboard-id"] == info["id"]
    assert got.content == data
    with zipfile.ZipFile(io.BytesIO(got.content)) as zf:
        assert zf.read("Project/data/table.csv") == b"a,b\n1,2\n"
        assert "Project/empty/" in zf.namelist()


def test_each_copy_replaces_the_last(client):
    make_user(client, "alice")
    first = copy(client, make_zip({"a.txt": b"1"})).json()["clipboard"]
    second = copy(client, make_zip({"b.txt": b"22"}), device_id="win1", device="Edge on Windows").json()["clipboard"]
    assert first["id"] != second["id"]
    now = client.get(API).json()["clipboard"]
    assert now["id"] == second["id"]
    assert now["items"] == [{"name": "b.txt", "type": "file"}]
    assert now["device"] == "Edge on Windows"
    with zipfile.ZipFile(io.BytesIO(client.get(f"{API}/data").content)) as zf:
        assert zf.namelist() == ["b.txt"]


def test_one_clipboard_per_user(client):
    make_user(client, "alice")
    copy(client, make_zip({"secret.txt": b"alice only"}))
    bob = new_client()
    make_user(bob, "bob")
    assert bob.get(API).json()["clipboard"] is None
    assert bob.get(f"{API}/data").status_code == 404
    bob.delete(API)  # bob clearing his own clipboard leaves alice's alone
    assert client.get(API).json()["clipboard"] is not None


def test_clear(client):
    make_user(client, "alice")
    copy(client, make_zip({"a.txt": b"1"}))
    assert client.delete(API).json() == {"ok": True}
    assert client.get(API).json()["clipboard"] is None
    assert client.get(f"{API}/data").status_code == 404
    assert client.delete(API).status_code == 200  # clearing twice is fine


def test_size_limit(client, monkeypatch):
    from kherveos_server import clipboard

    make_user(client, "alice")
    monkeypatch.setattr(clipboard, "MAX_BYTES", 1000)
    monkeypatch.setattr(clipboard, "MAX_UPLOAD_SLACK", 100_000)
    # a small zip that unpacks to more than the limit
    r = copy(client, make_zip({"big.txt": b"x" * 5000}))
    assert r.status_code == 413
    # an upload bigger than the limit itself
    monkeypatch.setattr(clipboard, "MAX_UPLOAD_SLACK", 0)
    r = copy(client, b"PK" + b"\0" * 5000)
    assert r.status_code == 413
    assert client.get(API).json()["clipboard"] is None
    # nothing left behind in the folder but what a good copy writes
    assert copy(client, make_zip({"ok.txt": b"fine"})).status_code == 200
    from kherveos_server import config

    assert sorted(p.name for p in (config.DATA_DIR / "clipboard").iterdir()) == ["1.json", "1.zip"]


@pytest.mark.parametrize(
    "body",
    [
        b"not a zip at all",
        b"",
    ],
)
def test_rejects_non_zip(client, body):
    make_user(client, "alice")
    assert copy(client, body).status_code == 400
    assert client.get(API).json()["clipboard"] is None


@pytest.mark.parametrize("name", ["../escape.txt", "/etc/passwd", "a/../../b.txt", "C:/win.txt", "a\\b.txt"])
def test_rejects_unsafe_names(client, name):
    make_user(client, "alice")
    r = copy(client, make_zip({name: b"x"}))
    assert r.status_code == 400, r.text
    assert client.get(API).json()["clipboard"] is None


def test_device_name_is_cleaned(client):
    make_user(client, "alice")
    info = copy(client, make_zip({"a.txt": b"1"}), device_id="ab$%cd", device="  " + "x" * 200 + "\n").json()["clipboard"]
    assert info["device_id"] == "abcd"
    assert info["device"] == "x" * 60
    info = copy(client, make_zip({"a.txt": b"1"}), device="").json()["clipboard"]
    assert info["device"] == "another computer"


def test_other_tabs_hear_about_copies(client):
    make_user(client, "alice")
    with client.websocket_connect("/api/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        info = copy(client, make_zip({"a.txt": b"1"})).json()["clipboard"]
        event = receive_until(ws, "clipboard.changed")
        assert event["clipboard"]["id"] == info["id"]
        client.delete(API)
        assert receive_until(ws, "clipboard.changed")["clipboard"] is None
