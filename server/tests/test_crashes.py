"""Crash reports: sign-in needed, written to the log, rate-limited."""

from conftest import make_user
from kherveos_server import crashes


def test_needs_login(client):
    assert client.post("/api/crash", json={"app": "Email", "message": "x"}).status_code == 401


def test_written_to_the_log(client, capsys):
    make_user(client)
    r = client.post("/api/crash", json={"app": "Email", "message": "TypeError: x is undefined", "stack": "at render (Email.tsx:10)"})
    assert r.status_code == 204
    err = capsys.readouterr().err
    assert "[crash] Email" in err and "TypeError: x is undefined" in err and "Email.tsx:10" in err


def test_rate_limited(client, capsys):
    crashes._recent.clear()  # the limit is per process; other tests used it
    make_user(client)
    for i in range(25):
        assert client.post("/api/crash", json={"app": "Loop", "message": f"boom {i}"}).status_code == 204
    assert capsys.readouterr().err.count("[crash] Loop") == 20
