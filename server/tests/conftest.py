"""Every test gets a fresh, empty data folder and a TestClient."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["KHERVEOS_DATA"] = tempfile.mkdtemp(prefix="kherveos-test-")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from kherveos_server import config

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "SECRET_KEY_PATH", tmp_path / "secret.key")
    from kherveos_server.app import app

    with TestClient(app) as c:
        yield c


def make_user(client, username="alice", password="correct-horse", display_name=None):
    """Register a user on a client; the client keeps that user's session cookie."""
    r = client.post(
        "/api/auth/register",
        json={"username": username, "display_name": display_name or username.title(), "password": password},
    )
    assert r.status_code == 200, r.text
    return r.json()["user"]
