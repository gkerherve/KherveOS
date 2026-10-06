"""Messages: conversations, sending, paging, unread counts, permissions and live events.

Each person gets their own TestClient (its own cookie jar). Websockets that
must *receive* events are opened on the `client` fixture: it runs the app's
lifespan, so its event loop is the one the realtime hub publishes on.
"""

import pytest
from fastapi.testclient import TestClient

from conftest import make_user

API = "/api/messages"


def new_client() -> TestClient:
    from kherveos_server.app import app

    return TestClient(app)


@pytest.fixture()
def people(client):
    """alice on the main client; bob and carol on clients of their own."""
    bob_client, carol_client = new_client(), new_client()
    users = {
        "alice": make_user(client, "alice"),
        "bob": make_user(bob_client, "bob"),
        "carol": make_user(carol_client, "carol"),
    }
    return {"alice": client, "bob": bob_client, "carol": carol_client}, users


def start_chat(c, *usernames, title=None):
    r = c.post(f"{API}/conversations", json={"usernames": list(usernames), "title": title})
    assert r.status_code == 200, r.text
    return r.json()


def send(c, conversation_id, body, **extra):
    r = c.post(f"{API}/conversations/{conversation_id}/messages", json={"body": body, **extra})
    assert r.status_code == 200, r.text
    return r.json()["message"]


def conversations(c):
    r = c.get(f"{API}/conversations")
    assert r.status_code == 200, r.text
    return r.json()["conversations"]


def find(c, conversation_id):
    return next((x for x in conversations(c) if x["id"] == conversation_id), None)


def receive_until(ws, event_type, limit=20):
    """Read events until one of `event_type` arrives (skipping hello, presence…)."""
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == event_type:
            return event
    raise AssertionError(f"no {event_type!r} event")


# ----------------------------------------------------------------- basics

def test_needs_login(client):
    assert client.get(f"{API}/conversations").status_code == 401
    assert client.post(f"{API}/conversations", json={"usernames": ["bob"]}).status_code == 401


def test_direct_conversation_is_created_once(people):
    c, users = people
    first = start_chat(c["alice"], "bob")
    conv = first["conversation"]
    assert first["created"] is True
    assert conv["kind"] == "direct"
    assert conv["title"] == "Bob"  # the other person's display name
    assert {m["username"] for m in conv["members"]} == {"alice", "bob"}
    assert set(conv["members"][0]) == {"id", "username", "display_name", "online"}
    assert conv["unread_count"] == 0 and conv["last_message"] is None

    again = start_chat(c["alice"], "BOB")  # usernames are case-insensitive
    assert again["created"] is False and again["conversation"]["id"] == conv["id"]

    from_bob = start_chat(c["bob"], "alice")
    assert from_bob["conversation"]["id"] == conv["id"]
    assert from_bob["conversation"]["title"] == "Alice"

    # Listing yourself along with one other person is still a direct chat.
    assert start_chat(c["alice"], "alice", "bob")["conversation"]["id"] == conv["id"]


def test_create_validation(people):
    c, _ = people
    r = c["alice"].post(f"{API}/conversations", json={"usernames": ["bob", "nobody"]})
    assert r.status_code == 404
    assert "nobody" in r.json()["detail"]
    assert c["alice"].post(f"{API}/conversations", json={"usernames": []}).status_code == 400
    assert c["alice"].post(f"{API}/conversations", json={"usernames": ["alice"]}).status_code == 400


def test_group_conversation(people):
    c, _ = people
    named = start_chat(c["alice"], "bob", "carol", title="  Weekend   trip ")["conversation"]
    assert named["kind"] == "group"
    assert named["title"] == "Weekend trip"
    assert len(named["members"]) == 3

    unnamed = start_chat(c["alice"], "bob", "carol")["conversation"]
    assert unnamed["id"] != named["id"]  # groups are never reused
    assert unnamed["title"] == "Bob, Carol"
    assert find(c["carol"], unnamed["id"])["title"] == "Alice, Bob"

    # Group members see the new group straight away, before anyone writes.
    assert find(c["bob"], named["id"]) is not None


def test_empty_direct_chat_appears_for_the_other_person_on_first_message(people):
    c, _ = people
    conv = start_chat(c["alice"], "bob")["conversation"]
    assert find(c["alice"], conv["id"]) is not None
    assert find(c["bob"], conv["id"]) is None
    send(c["alice"], conv["id"], "Hello Bob")
    assert find(c["bob"], conv["id"])["last_message"]["body"] == "Hello Bob"
    # It can still be fetched directly.
    assert c["bob"].get(f"{API}/conversations/{conv['id']}").status_code == 200


# ---------------------------------------------------------------- sending

def test_send_validation_and_trimming(people):
    c, _ = people
    cid = start_chat(c["alice"], "bob")["conversation"]["id"]
    url = f"{API}/conversations/{cid}/messages"
    assert c["alice"].post(url, json={"body": ""}).status_code == 400
    assert c["alice"].post(url, json={"body": "  \n\t "}).status_code == 400
    assert c["alice"].post(url, json={"body": "x" * 4001}).status_code == 400
    assert send(c["alice"], cid, "x" * 4000)["body"] == "x" * 4000
    m = send(c["alice"], cid, "  hi there \r\n second line  ")
    assert m["body"] == "hi there \n second line"
    assert m["sender_id"] is not None and m["deleted"] is False and m["edited_at"] is None


def test_paging_oldest_first(people):
    c, _ = people
    cid = start_chat(c["alice"], "bob")["conversation"]["id"]
    sent = [send(c["alice" if i % 2 else "bob"], cid, f"message {i}")["id"] for i in range(120)]

    page = c["bob"].get(f"{API}/conversations/{cid}/messages").json()
    assert [m["id"] for m in page["messages"]] == sent[-50:]
    assert page["has_more"] is True

    page2 = c["bob"].get(f"{API}/conversations/{cid}/messages", params={"before": sent[-50]}).json()
    assert [m["id"] for m in page2["messages"]] == sent[-100:-50]
    assert page2["has_more"] is True

    page3 = c["bob"].get(f"{API}/conversations/{cid}/messages", params={"before": sent[-100], "limit": 50}).json()
    assert [m["id"] for m in page3["messages"]] == sent[:20]
    assert page3["has_more"] is False

    small = c["bob"].get(f"{API}/conversations/{cid}/messages", params={"limit": 5}).json()
    assert [m["body"] for m in small["messages"]] == [f"message {i}" for i in range(115, 120)]
    assert c["bob"].get(f"{API}/conversations/{cid}/messages", params={"limit": 0}).status_code == 422


def test_list_is_newest_activity_first(people):
    c, _ = people
    with_bob = start_chat(c["alice"], "bob")["conversation"]["id"]
    with_carol = start_chat(c["alice"], "carol")["conversation"]["id"]
    send(c["alice"], with_bob, "first")
    send(c["alice"], with_carol, "second")
    assert [x["id"] for x in conversations(c["alice"])] == [with_carol, with_bob]
    send(c["bob"], with_bob, "third")
    listing = conversations(c["alice"])
    assert [x["id"] for x in listing] == [with_bob, with_carol]
    assert listing[0]["last_message"]["body"] == "third"
    assert listing[0]["updated_at"] >= listing[1]["updated_at"]


# ------------------------------------------------------------ read state

def test_unread_counts_and_marking_read(people):
    c, _ = people
    cid = start_chat(c["alice"], "bob")["conversation"]["id"]
    ids = [send(c["alice"], cid, f"hi {i}")["id"] for i in range(3)]

    assert find(c["bob"], cid)["unread_count"] == 3
    assert find(c["alice"], cid)["unread_count"] == 0  # your own messages are never unread

    r = c["bob"].post(f"{API}/conversations/{cid}/read", json={"message_id": ids[1]})
    assert r.status_code == 200 and r.json()["unread_count"] == 1 and r.json()["last_read_id"] == ids[1]
    assert find(c["bob"], cid)["unread_count"] == 1

    # The read marker never moves backwards, nor past the newest message.
    assert c["bob"].post(f"{API}/conversations/{cid}/read", json={"message_id": ids[0]}).json()["last_read_id"] == ids[1]
    assert c["bob"].post(f"{API}/conversations/{cid}/read", json={"message_id": 10**9}).json()["last_read_id"] == ids[2]
    assert find(c["bob"], cid)["unread_count"] == 0

    later = send(c["alice"], cid, "one more")
    assert find(c["bob"], cid)["unread_count"] == 1
    assert c["bob"].post(f"{API}/conversations/{cid}/read", json={}).json()["last_read_id"] == later["id"]

    # Replying marks the conversation read for the person replying.
    send(c["alice"], cid, "are you there?")
    assert find(c["bob"], cid)["unread_count"] == 1
    send(c["bob"], cid, "yes!")
    assert find(c["bob"], cid)["unread_count"] == 0
    assert find(c["alice"], cid)["unread_count"] == 1

    # A deleted message no longer counts as unread.
    gone = send(c["bob"], cid, "oops")
    assert find(c["alice"], cid)["unread_count"] == 2
    assert c["bob"].delete(f"{API}/messages/{gone['id']}").status_code == 200
    assert find(c["alice"], cid)["unread_count"] == 1


# ------------------------------------------------------------ permissions

def test_members_only(people):
    c, _ = people
    cid = start_chat(c["alice"], "bob")["conversation"]["id"]
    mid = send(c["alice"], cid, "private")["id"]
    carol = c["carol"]
    assert carol.get(f"{API}/conversations/{cid}").status_code == 404
    assert carol.get(f"{API}/conversations/{cid}/messages").status_code == 404
    assert carol.post(f"{API}/conversations/{cid}/messages", json={"body": "let me in"}).status_code == 404
    assert carol.post(f"{API}/conversations/{cid}/read", json={"message_id": mid}).status_code == 404
    assert carol.patch(f"{API}/messages/{mid}", json={"body": "hacked"}).status_code == 404
    assert carol.delete(f"{API}/messages/{mid}").status_code == 404
    assert find(carol, cid) is None
    assert c["alice"].get(f"{API}/conversations/99999/messages").status_code == 404
    assert c["alice"].patch(f"{API}/messages/99999", json={"body": "?"}).status_code == 404


def test_edit_and_delete_own_messages_only(people):
    c, _ = people
    cid = start_chat(c["alice"], "bob")["conversation"]["id"]
    mid = send(c["alice"], cid, "helo")["id"]

    assert c["bob"].patch(f"{API}/messages/{mid}", json={"body": "nope"}).status_code == 403
    assert c["bob"].delete(f"{API}/messages/{mid}").status_code == 403
    assert c["alice"].patch(f"{API}/messages/{mid}", json={"body": "   "}).status_code == 400

    edited = c["alice"].patch(f"{API}/messages/{mid}", json={"body": "hello"}).json()["message"]
    assert edited["body"] == "hello" and edited["edited_at"] is not None
    assert c["bob"].get(f"{API}/conversations/{cid}/messages").json()["messages"][0]["body"] == "hello"

    deleted = c["alice"].delete(f"{API}/messages/{mid}").json()["message"]
    assert deleted["deleted"] is True and deleted["body"] == ""
    seen_by_bob = c["bob"].get(f"{API}/conversations/{cid}/messages").json()["messages"]
    assert seen_by_bob == [deleted]  # the row stays, the text is gone
    assert find(c["bob"], cid)["last_message"]["deleted"] is True
    assert c["alice"].patch(f"{API}/messages/{mid}", json={"body": "back"}).status_code == 409
    assert c["alice"].delete(f"{API}/messages/{mid}").status_code == 200  # deleting twice is fine


# -------------------------------------------------------------- realtime

def test_websocket_receives_new_messages(client):
    # bob listens on the lifespan client; alice writes from her own client.
    bob = make_user(client, "bob")
    alice_client = new_client()
    alice = make_user(alice_client, "alice")
    cid = start_chat(alice_client, "bob")["conversation"]["id"]

    with client.websocket_connect("/api/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        message = send(alice_client, cid, "Hi Bob!", client_id="tmp-1")
        event = receive_until(ws, "message.new")
        assert event["conversation_id"] == cid
        assert event["message"] == message
        assert event["sender"]["id"] == alice["id"] and event["sender"]["display_name"] == "Alice"
        assert event["client_id"] == "tmp-1"

        # bob is online while his tab is open, and alice can see it.
        members = {m["id"]: m for m in find(alice_client, cid)["members"]}
        assert members[bob["id"]]["online"] is True and members[alice["id"]]["online"] is False

        alice_client.patch(f"{API}/messages/{message['id']}", json={"body": "Hi Bob!!"})
        updated = receive_until(ws, "message.updated")
        assert updated["message"]["body"] == "Hi Bob!!" and updated["message"]["edited_at"] is not None

        alice_client.delete(f"{API}/messages/{message['id']}")
        assert receive_until(ws, "message.updated")["message"]["deleted"] is True

        client.post(f"{API}/conversations/{cid}/read", json={"message_id": message["id"]})
        read = receive_until(ws, "conversation.read")
        assert read == {"type": "conversation.read", "conversation_id": cid, "last_read_id": message["id"], "unread_count": 0}


def test_websocket_new_group_typing_and_presence(client):
    make_user(client, "bob")
    alice_client, carol_client = new_client(), new_client()
    alice = make_user(alice_client, "alice")
    make_user(carol_client, "carol")

    with client.websocket_connect("/api/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        group = start_chat(alice_client, "bob", "carol", title="Plans")["conversation"]
        assert receive_until(ws, "conversation.new")["conversation_id"] == group["id"]

        with alice_client.websocket_connect("/api/ws") as alice_ws:
            assert alice_ws.receive_json()["type"] == "hello"
            presence = receive_until(ws, "presence")
            assert presence == {"type": "presence", "user_id": alice["id"], "online": True}

            alice_ws.send_json({"type": "typing", "conversation_id": group["id"]})
            typing = receive_until(ws, "typing")
            assert typing["conversation_id"] == group["id"]
            assert typing["user"] == {"id": alice["id"], "username": "alice", "display_name": "Alice"}

        offline = receive_until(ws, "presence")
        assert offline == {"type": "presence", "user_id": alice["id"], "online": False}
