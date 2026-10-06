from conftest import make_user


def test_health(client):
    assert client.get("/api/health").json()["ok"] is True


def test_register_login_logout(client):
    user = make_user(client, "alice")
    assert client.get("/api/auth/me").json()["user"]["username"] == "alice"

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None

    bad = client.post("/api/auth/login", json={"username": "alice", "password": "nope-nope"})
    assert bad.status_code == 401
    ok = client.post("/api/auth/login", json={"username": "ALICE", "password": "correct-horse"})
    assert ok.status_code == 200 and ok.json()["user"]["id"] == user["id"]


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"username": "a", "password": "longenough"}).status_code == 400
    assert client.post("/api/auth/register", json={"username": "bob", "password": "short"}).status_code == 400
    make_user(client, "bob")
    assert client.post("/api/auth/register", json={"username": "Bob", "password": "longenough"}).status_code == 409


def test_protected_endpoint_needs_login(client):
    assert client.get("/api/users/search").status_code == 401


def test_websocket_requires_session(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/ws") as ws:
            ws.receive_text()
    make_user(client, "carol")
    with client.websocket_connect("/api/ws") as ws:
        assert '"hello"' in ws.receive_text()
