"""KherveOS as an MCP server: tokens, the /mcp endpoint, and tool calls relayed to
a KherveOS browser tab over the /api/ws websocket.

The tab is played by a websocket opened on the `client` fixture (it runs the app's
lifespan, so its event loop is the one the realtime hub publishes on). A tools/call
blocks until the tab answers, so the tab answers from a background thread.
"""

import json
import threading
import time

import pytest

from conftest import make_user
from kherveos_server import mcp_server

TOOLS = [
    {
        "name": "list_files",
        "description": "List the files in a folder.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "A folder, e.g. ~/Documents"}},
            "required": [],
        },
        "annotations": {"title": "List files", "readOnlyHint": True, "destructiveHint": False},
    },
    {
        "name": "delete",
        "description": "Delete a file or folder.",
        "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        "annotations": {"title": "Delete", "destructiveHint": True},
    },
]


@pytest.fixture(autouse=True)
def _mcp_installed(monkeypatch):
    from kherveos_server.app import app

    mcp_server.install(app)  # a no-op once app.py includes mcp_server.router
    monkeypatch.setattr(mcp_server, "CALL_TIMEOUT", 10.0)  # a broken test fails fast


# ----------------------------------------------------------------- helpers

def receive_until(ws, event_type, match=lambda e: True, limit=30):
    """Read events until one of `event_type` (and `match`) arrives, skipping the rest."""
    for _ in range(limit):
        event = ws.receive_json()
        if event["type"] == event_type and match(event):
            return event
    raise AssertionError(f"no {event_type!r} event")


def token_for(client) -> str:
    r = client.get("/api/mcp/token")
    assert r.status_code == 200, r.text
    return r.json()["token"]


class Mcp:
    """A tiny MCP client: JSON-RPC over the TestClient (the server answers in JSON)."""

    def __init__(self, client, token=None, url="/mcp", agent="kherveos-tests/1.0"):
        self.client, self.url, self.next_id = client, url, 1
        self.headers = {"Accept": "application/json, text/event-stream", "User-Agent": agent}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    def post(self, body):
        return self.client.post(self.url, json=body, headers=self.headers)

    def rpc(self, method, params=None):
        body = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            body["params"] = params
        self.next_id += 1
        r = self.post(body)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/json")
        reply = r.json()
        assert reply["id"] == body["id"]
        return reply

    def initialize(self, name="claude-code"):
        reply = self.rpc(
            "initialize",
            {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": name, "version": "1.0"}},
        )
        self.headers["MCP-Protocol-Version"] = reply["result"]["protocolVersion"]
        assert self.post({"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
        return reply["result"]

    def tool_names(self):
        return [t["name"] for t in self.rpc("tools/list")["result"]["tools"]]

    def call(self, name, arguments=None):
        return self.rpc("tools/call", {"name": name, "arguments": arguments or {}})


class Tab:
    """A fake KherveOS tab: registers tools and answers calls (from a thread)."""

    def __init__(self, ws, tab_id="tab-one"):
        self.ws, self.id = ws, tab_id
        self.calls = []

    def register(self, tools=TOOLS):
        self.ws.send_json({"type": "mcp.tools", "tab": self.id, "tools": tools})
        ready = receive_until(self.ws, "mcp.ready", lambda e: e["tab"] == self.id)
        assert ready["tools"] == len(tools)

    def answer(self, reply=None, then=None):
        """Wait (in a thread) for the next call meant for this tab and answer it."""

        def run():
            event = receive_until(self.ws, "mcp.call", lambda e: e["tab"] == self.id)
            self.calls.append(event)
            if reply is not None:
                self.ws.send_json({"type": "mcp.result", "id": event["id"], **reply(event)})
            if then is not None:
                then()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread


def text_of(reply):
    content = reply["result"]["content"]
    assert len(content) == 1 and content[0]["type"] == "text"
    return content[0]["text"]


def wait_until(condition, seconds=5.0):
    deadline = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


# ------------------------------------------------------------------ tokens

def test_token_endpoints_need_sign_in(client):
    assert client.get("/api/mcp/token").status_code == 401
    assert client.post("/api/mcp/token/rotate").status_code == 401


def test_token_is_made_once_then_rotated(client):
    make_user(client)
    first = client.get("/api/mcp/token").json()
    assert first["token"].startswith("kos_") and len(first["token"]) > 40
    assert first["url"].endswith("/mcp")
    assert first["last_used"] is None
    assert client.get("/api/mcp/token").json()["token"] == first["token"]

    Mcp(client, first["token"]).initialize()
    assert client.get("/api/mcp/token").json()["last_used"] is not None

    rotated = client.post("/api/mcp/token/rotate").json()
    assert rotated["token"] != first["token"] and rotated["last_used"] is None
    assert client.get("/api/mcp/token").json()["token"] == rotated["token"]
    assert Mcp(client, first["token"]).post({"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401
    Mcp(client, rotated["token"]).initialize()


def test_tokens_are_per_user(client):
    from fastapi.testclient import TestClient

    from kherveos_server.app import app

    make_user(client, "alice")
    bob_client = TestClient(app)
    make_user(bob_client, "bob")
    assert token_for(client) != token_for(bob_client)


def test_endpoint_rejects_missing_and_wrong_tokens(client):
    make_user(client)
    token_for(client)
    ping = {"jsonrpc": "2.0", "id": 1, "method": "ping"}

    r = Mcp(client).post(ping)
    assert r.status_code == 401
    assert "Authorization: Bearer" in r.json()["error"]["message"]
    assert r.headers["www-authenticate"].startswith("Bearer")

    r = Mcp(client, "kos_not-a-real-token").post(ping)
    assert r.status_code == 401 and "not valid" in r.json()["error"]["message"]

    assert Mcp(client, url="/mcp/t/kos_not-a-real-token").post(ping).status_code == 401


# ------------------------------------------------------------------- MCP

def test_initialize_and_list_the_tabs_tools(client):
    make_user(client)
    mcp = Mcp(client, token_for(client))
    with client.websocket_connect("/api/ws") as ws:
        Tab(ws).register()
        info = mcp.initialize()
        assert info["serverInfo"]["name"] == "kherveos"
        assert info["protocolVersion"] == "2025-11-25"
        assert "tools" in info["capabilities"]
        assert "KherveOS" in info["instructions"]

        tools = mcp.rpc("tools/list")["result"]["tools"]
        assert [t["name"] for t in tools] == ["list_files", "delete"]
        listing = tools[0]
        assert listing["description"] == "List the files in a folder."
        assert listing["inputSchema"]["properties"]["path"]["description"] == "A folder, e.g. ~/Documents"
        assert listing["annotations"]["readOnlyHint"] is True and listing["annotations"]["title"] == "List files"
        assert tools[1]["annotations"]["destructiveHint"] is True
        assert tools[1]["inputSchema"]["required"] == ["path"]


def test_tool_calls_are_relayed_to_the_tab(client):
    make_user(client)
    mcp = Mcp(client, token_for(client))
    with client.websocket_connect("/api/ws") as ws:
        tab = Tab(ws)
        tab.register()
        mcp.initialize(name="claude-code")

        files = {"path": "~", "entries": [{"name": "notes.txt", "type": "file", "size": 12}]}
        thread = tab.answer(lambda e: {"ok": True, "result": files})
        reply = mcp.call("list_files", {"path": "~"})
        thread.join(5)
        call = tab.calls[0]
        assert call["tool"] == "list_files" and call["args"] == {"path": "~"}
        assert call["tab"] == "tab-one"
        assert call["client"] == "Claude Code"  # remembered from initialize's clientInfo
        assert reply["result"].get("isError") is not True
        assert json.loads(text_of(reply)) == files

        # A string result is passed on as it is.
        thread = tab.answer(lambda e: {"ok": True, "result": "Hello"})
        assert text_of(mcp.call("list_files")) == "Hello"
        thread.join(5)

        # A failure in the tab (here: the user said no) is a tool error the model can read.
        thread = tab.answer(lambda e: {"ok": False, "error": "The user did not allow this."})
        reply = mcp.call("delete", {"path": "~/notes.txt"})
        thread.join(5)
        assert reply["result"]["isError"] is True
        assert text_of(reply) == "The user did not allow this."

        # Tools the tab did not register are refused without asking it.
        reply = mcp.call("format_disk")
        assert reply["error"]["code"] == -32602 and "Unknown tool" in reply["error"]["message"]


def test_token_in_the_path(client):
    """/mcp/t/<token> is for clients that cannot send headers (ChatGPT connectors)."""
    make_user(client)
    mcp = Mcp(client, url=f"/mcp/t/{token_for(client)}", agent="openai-mcp/1.0.0")
    with client.websocket_connect("/api/ws") as ws:
        tab = Tab(ws)
        tab.register()
        mcp.initialize(name="openai-mcp")
        assert mcp.tool_names() == ["list_files", "delete"]
        thread = tab.answer(lambda e: {"ok": True, "result": {"ok": 1}})
        assert json.loads(text_of(mcp.call("list_files"))) == {"ok": 1}
        thread.join(5)
        assert tab.calls[0]["client"] == "ChatGPT"


def test_no_tab_open(client):
    make_user(client)
    mcp = Mcp(client, token_for(client))
    mcp.initialize()
    assert mcp.tool_names() == []
    reply = mcp.call("list_files")
    assert reply["result"]["isError"] is True
    assert text_of(reply) == mcp_server.NO_TAB
    assert "Open KherveOS in your browser (http://localhost:5173) and sign in." in mcp_server.NO_TAB

    # Once a tab has registered, its tools stay listed after it closes; calls ask to open KherveOS.
    with client.websocket_connect("/api/ws") as ws:
        Tab(ws).register()
    assert mcp.tool_names() == ["list_files", "delete"]
    reply = mcp.call("list_files")
    assert reply["result"]["isError"] is True and text_of(reply) == mcp_server.NO_TAB


def test_closing_the_tab_ends_a_waiting_call(client):
    make_user(client)
    mcp = Mcp(client, token_for(client))
    mcp.initialize()
    with client.websocket_connect("/api/ws") as ws:
        tab = Tab(ws)
        tab.register()
        thread = tab.answer(then=ws.close)  # the call arrives, then the tab goes away
        started = time.monotonic()
        reply = mcp.call("delete", {"path": "~/a"})
        thread.join(5)
    assert time.monotonic() - started < 5  # not the 10 s timeout
    assert reply["result"]["isError"] is True and text_of(reply) == mcp_server.TAB_CLOSED


def test_unanswered_call_times_out_and_is_cancelled(client, monkeypatch):
    monkeypatch.setattr(mcp_server, "CALL_TIMEOUT", 0.3)
    make_user(client)
    mcp = Mcp(client, token_for(client))
    with client.websocket_connect("/api/ws") as ws:
        tab = Tab(ws)
        tab.register()
        reply = mcp.call("list_files")
        assert reply["result"]["isError"] is True
        assert "did not answer within 0.3 seconds" in text_of(reply)
        call = receive_until(ws, "mcp.call")
        cancel = receive_until(ws, "mcp.cancel")
        assert cancel["id"] == call["id"] and cancel["tab"] == "tab-one"
        # A late answer is ignored.
        ws.send_json({"type": "mcp.result", "id": call["id"], "ok": True, "result": 1})


def test_calls_go_to_the_tab_used_last(client):
    user = make_user(client)
    mcp = Mcp(client, token_for(client))
    mcp.initialize()

    def target():  # read on the event loop's thread, where the relay changes
        tab = client.portal.call(mcp_server.relay.pick, user["id"])
        return tab.id if tab else None

    with client.websocket_connect("/api/ws") as ws1:
        one = Tab(ws1, "tab-one")
        one.register()
        with client.websocket_connect("/api/ws") as ws2:
            two = Tab(ws2, "tab-two")
            two.register()  # registered last: it gets the calls
            thread = two.answer(lambda e: {"ok": True, "result": "from two"})
            assert text_of(mcp.call("list_files")) == "from two"
            thread.join(5)

            ws1.send_json({"type": "mcp.active", "tab": "tab-one"})  # the user went back to tab one
            wait_until(lambda: target() == "tab-one")
            thread = one.answer(lambda e: {"ok": True, "result": "from one"})
            assert text_of(mcp.call("list_files")) == "from one"
            thread.join(5)

            ws2.send_json({"type": "mcp.active", "tab": "tab-two"})
            wait_until(lambda: target() == "tab-two")
        # Tab two closed: tab one answers again.
        wait_until(lambda: target() == "tab-one")
        thread = one.answer(lambda e: {"ok": True, "result": "one again"})
        assert text_of(mcp.call("list_files")) == "one again"
        thread.join(5)

        ws1.send_json({"type": "mcp.bye", "tab": "tab-one"})  # the page is closing
        wait_until(lambda: target() is None)
        assert text_of(mcp.call("list_files")) == mcp_server.NO_TAB


def test_bad_registrations_are_ignored(client):
    user = make_user(client)
    with client.websocket_connect("/api/ws") as ws:
        ws.send_json({"type": "mcp.tools", "tab": "x", "tools": TOOLS})  # tab id too short
        ws.send_json({"type": "mcp.tools", "tab": "tab-one", "tools": "nope"})
        odd = [
            {"name": "bad name!", "inputSchema": {"type": "object"}},
            {"name": "no_schema"},
            {"name": "no_schema"},  # duplicate
            "junk",
        ]
        ws.send_json({"type": "mcp.tools", "tab": "tab-one", "tools": odd})
        ready = receive_until(ws, "mcp.ready")
        assert ready["tools"] == 1
        tools = client.portal.call(mcp_server.relay.tools_for, user["id"])
        assert tools == [{"name": "no_schema", "description": "", "inputSchema": {"type": "object", "properties": {}}}]


# -------------------------------------------- with the official MCP client

@pytest.mark.parametrize("mode", ["legacy", "auto"])
def test_official_client_in_both_protocol_eras(client, mode):
    """The SDK's own client: 'legacy' does the initialize handshake, 'auto' speaks 2026-07-28."""
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    from mcp_types import Implementation

    from kherveos_server.app import app

    make_user(client)
    token = token_for(client)

    async def session():
        http = httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app),
            base_url="http://kherveos.test",
            headers={"Authorization": f"Bearer {token}"},
        )
        async with http:
            transport = streamable_http_client("http://kherveos.test/mcp", http_client=http)
            info = Implementation(name="claude-code", version="2.0")
            async with Client(transport, mode=mode, client_info=info, cache=None) as mcp:
                tools = await mcp.list_tools()
                result = await mcp.call_tool("list_files", {"path": "~/Documents"})
                return mcp.protocol_version, tools, result

    with client.websocket_connect("/api/ws") as ws:
        tab = Tab(ws)
        tab.register()
        thread = tab.answer(lambda e: {"ok": True, "result": {"entries": []}})
        version, tools, result = client.portal.call(session)
        thread.join(5)

    assert version == ("2025-11-25" if mode == "legacy" else "2026-07-28")
    assert [t.name for t in tools.tools] == ["list_files", "delete"]
    assert tools.tools[0].annotations.read_only_hint is True
    assert result.is_error is False
    assert json.loads(result.content[0].text) == {"entries": []}
    assert tab.calls[0]["args"] == {"path": "~/Documents"}
    assert tab.calls[0]["client"] == "Claude Code"
