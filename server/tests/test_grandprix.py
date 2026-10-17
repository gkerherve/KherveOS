"""Kherve Grand Prix race rooms: host, join, start (the grid), relay, leave."""

from conftest import make_user

from kherveos_server.grandprix import lineup


def test_lineup_gives_players_their_team_then_the_ai_the_rest():
    cars = lineup([(1, "Ann", 2), (2, "Bob", 2), (3, "Cy", 2)], ai=True)
    assert len(cars) == 12
    humans = {c["car"]: c["name"] for c in cars if c["human"]}
    # two cars per team: the third player who wants team 2 gets the first free car
    assert humans == {4: "Ann", 5: "Bob", 0: "Cy"}
    assert [c["car"] for c in lineup([(1, "Ann", 5)], ai=False)] == [10]


def test_guests_can_host_without_an_account(client):
    # a friend's tablet that never signed in to this KherveOS
    assert client.get("/api/gp/rooms").status_code == 200
    with client.websocket_connect("/api/gp/ws") as g:
        g.send_json({"t": "host", "name": "", "team": 0, "settings": {"track": "park"}})
        room = g.receive_json()
        assert room["t"] == "room" and room["players"][0]["name"] == "Guest"


def test_host_join_start_and_relay(client):
    from kherveos_server import config

    # two players on one test client (one event loop), each with their own session cookie
    make_user(client, "bob")
    bob = {"cookie": f"{config.SESSION_COOKIE}={client.cookies.get(config.SESSION_COOKIE)}"}
    client.cookies.clear()
    make_user(client, "alice")
    alice = {"cookie": f"{config.SESSION_COOKIE}={client.cookies.get(config.SESSION_COOKIE)}"}
    assert client.get("/api/gp/rooms").status_code == 200
    client.cookies.clear()
    with client.websocket_connect("/api/gp/ws", headers=alice) as a:
        a.send_json({"t": "host", "name": "Alice", "team": 1, "settings": {"track": "park", "laps": 3, "ai": False, "evil": "x"}})
        room = a.receive_json()
        assert room["t"] == "room" and room["host"] == room["you"]
        assert "evil" not in room["settings"]
        code = room["code"]
        assert client.get("/api/gp/rooms", headers=alice).json()["rooms"][0]["code"] == code
        with client.websocket_connect("/api/gp/ws", headers=bob) as b:
            b.send_json({"t": "join", "code": "0000", "name": "Bob"})
            assert b.receive_json()["t"] == "error"
            b.send_json({"t": "join", "code": code, "name": "Bob", "team": 1})
            joined = b.receive_json()
            assert [p["name"] for p in joined["players"]] == ["Alice", "Bob"]
            assert len(a.receive_json()["players"]) == 2
            # only the host starts
            b.send_json({"t": "start"})
            a.send_json({"t": "start", "seed": 42})
            start = a.receive_json()
            assert start["t"] == "start" and start["seed"] == 42
            assert [(c["car"], c["name"]) for c in start["lineup"]] == [(2, "Alice"), (3, "Bob")]
            assert b.receive_json()["t"] == "start"
            a.receive_json(), b.receive_json()  # the room, now racing
            # cars are relayed to the others, not back
            b.send_json({"t": "cars", "c": [[3, 1.5, 0, 2.5]]})
            got = a.receive_json()
            assert got == {"t": "cars", "from": joined["you"], "c": [[3, 1.5, 0, 2.5]]}
            b.send_json({"t": "leave"})
            assert a.receive_json() == {"t": "left", "id": joined["you"]}
            assert len(a.receive_json()["players"]) == 1
