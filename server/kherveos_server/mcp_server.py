"""KherveOS as an MCP server: Claude, ChatGPT and other AI apps can use KherveOS.

The tools themselves live in the browser (src/os/ai/tools.ts), because KherveOS
runs in a browser tab: its drive, windows and Python are there. This module is
the relay between MCP clients and that tab:

    MCP client --HTTP--> /mcp (this server) --/api/ws--> the user's KherveOS tab
               <-------- the tool's result  <----------

The tab (src/os/ai/mcpBridge.ts) speaks over the existing realtime websocket:

    tab -> server   {"type": "mcp.tools", "tab", "tools": [{name, description, inputSchema, annotations?}]}
                    {"type": "mcp.active", "tab"}       the user is looking at this tab
                    {"type": "mcp.result", "id", "ok", "result" | "error"}
                    {"type": "mcp.bye", "tab"}          the page is closing
    server -> tab   {"type": "mcp.ready", "tab", "tools": <count>}       registration received
                    {"type": "mcp.call", "id", "tab", "tool", "args", "client"?}
                    {"type": "mcp.cancel", "id", "tab"}  nobody waits for that call any more

A call goes to one tab only (the live one the user used last); every tab of the
user receives the event and the others ignore it. The last tool list a tab
registered is kept in the database, so tools/list still answers while KherveOS
is closed (and tools/call then says to open it).

Endpoints
    GET  /api/mcp/token         the signed-in user's MCP token (made on first use) and the MCP URL
    POST /api/mcp/token/rotate  a new token; the old one stops working at once
    /mcp                        the MCP endpoint (Streamable HTTP), "Authorization: Bearer <token>"
    /mcp/t/<token>              the same with the token in the path, for clients that cannot
                                send headers (ChatGPT connectors)

The endpoint is stateless (no MCP sessions, so a server restart never strands a
client) and answers in JSON. Both protocol eras work: the initialize handshake
(2024-11-05 ... 2025-11-25) and the per-request envelope of 2026-07-28.

Wiring (app.py): `app.include_router(mcp_server.router)`. The router carries its
own lifespan, which FastAPI runs inside the app's (after `hub.loop` is set).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from typing import Any

import mcp_types as types
from fastapi import APIRouter, Depends, FastAPI
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.shared.exceptions import MCPError
from pydantic import ValidationError
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.routing import NoMatchFound
from starlette.types import Receive, Scope, Send

from . import __version__, db
from .auth import User, current_user
from .realtime import hub

log = logging.getLogger("kherveos.mcp")

# Seconds a tools/call waits for the KherveOS tab to answer: long enough for the user to answer
# a question (send this mail? run this command?) and for terminal_run_command's own wait (at most 240 s).
CALL_TIMEOUT = 300.0
# Where people open KherveOS, and where MCP clients reach this server.
OS_URL = os.environ.get("KHERVEOS_OS_URL", "http://localhost:5173")
PUBLIC_URL = os.environ.get("KHERVEOS_PUBLIC_URL", f"http://localhost:{os.environ.get('KHERVEOS_PORT', '8787')}")

NO_TAB = f"Open KherveOS in your browser ({OS_URL}) and sign in."
TAB_CLOSED = f"KherveOS was closed before the tool finished. Open KherveOS in your browser ({OS_URL}) and sign in, then try again."
SERVER_STOPPING = "The KherveOS server is stopping."

INSTRUCTIONS = (
    "KherveOS is the user's desktop operating system, running in their web browser. These tools act on it "
    "live: the files on its drive (\"~\" is the home folder, /home/user), its apps and windows, and Python "
    "(Pyodide) running in the browser. They work while KherveOS is open and signed in in a browser tab. "
    "KherveOS asks the user before anything is deleted or overwritten, and before mail or messages are sent "
    "or Terminal commands run. "
    "Every app has its own tools, named <app>_<action> (khervesheet_set_cells, email_list_messages, "
    "tetris_get_state...): they are always listed, and calling one opens the app if no window of it is open. "
    "list_apps shows every app with its tools; open_app opens one (with a file); list_windows shows the open "
    "windows with their ids; arrange_window focuses, minimises, maximises or moves a window; close_window "
    "closes one; take_screenshot saves a picture of a window or the screen. An app tool acts on the app's "
    'front window unless you pass "window" (a window id from list_windows).'
)

TOKEN_PREFIX = "kos_"
MAX_TOOLS = 400
MAX_TOOLS_JSON = 1024 * 1024
MAX_RESULT_CHARS = 400_000
MAX_ERROR_CHARS = 8000

_TOOL_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_TAB_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_HINT_TYPES: dict[str, type] = {
    "title": str,
    "readOnlyHint": bool,
    "destructiveHint": bool,
    "idempotentHint": bool,
    "openWorldHint": bool,
}
_USER_KEY = "kherveos.user"  # where the endpoint puts the token's owner in the ASGI scope


db.register_schema(
    """
    CREATE TABLE IF NOT EXISTS mcp_tokens (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        created_at REAL NOT NULL,
        last_used  REAL
    );
    CREATE TABLE IF NOT EXISTS mcp_tools (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tools      TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    """
)


# ------------------------------------------------------------------- tokens

def _new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def get_or_create_token(user_id: int) -> dict[str, Any]:
    with db.connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO mcp_tokens (user_id, token, created_at) VALUES (?, ?, ?)",
            (user_id, _new_token(), time.time()),
        )
        row = conn.execute(
            "SELECT token, created_at, last_used FROM mcp_tokens WHERE user_id = ?", (user_id,)
        ).fetchone()
    return dict(row)


def rotate_token(user_id: int) -> dict[str, Any]:
    token, now = _new_token(), time.time()
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO mcp_tokens (user_id, token, created_at, last_used) VALUES (?, ?, ?, NULL)
               ON CONFLICT(user_id) DO UPDATE SET token = excluded.token,
                   created_at = excluded.created_at, last_used = NULL""",
            (user_id, token, now),
        )
    return {"token": token, "created_at": now, "last_used": None}


def user_for_token(token: str | None) -> User | None:
    """The owner of an MCP token (and note that it was used), or None."""
    if not token or len(token) > 200:
        return None
    with db.connect() as conn:
        row = conn.execute(
            """SELECT u.id, u.username, u.display_name, t.last_used FROM mcp_tokens t
               JOIN users u ON u.id = t.user_id WHERE t.token = ?""",
            (token,),
        ).fetchone()
        if row is None:
            return None
        now = time.time()
        if row["last_used"] is None or now - row["last_used"] > 60:
            conn.execute("UPDATE mcp_tokens SET last_used = ? WHERE token = ?", (now, token))
    return User(id=row["id"], username=row["username"], display_name=row["display_name"])


# -------------------------------------------------------------------- relay

@dataclass
class _Tab:
    id: str
    tools: list[dict[str, Any]]
    # The task serving the tab's websocket: done once the tab has disconnected.
    task: asyncio.Task[Any] | None
    active: float = field(default_factory=time.monotonic)

    @property
    def alive(self) -> bool:
        return self.task is None or not self.task.done()


@dataclass
class _Call:
    user_id: int
    tab: str
    future: asyncio.Future[tuple[bool, Any]]


class Relay:
    """Which KherveOS tabs serve tools, and the tool calls waiting for them."""

    def __init__(self) -> None:
        self._tabs: dict[int, dict[str, _Tab]] = {}
        self._calls: dict[str, _Call] = {}
        self._stored: dict[int, str] = {}  # user id -> the tool list JSON last written to the database
        self._clients: dict[tuple[int, str], str] = {}  # (user id, User-Agent) -> MCP client name

    def reset(self) -> None:
        self._fail_calls(lambda _c: True, SERVER_STOPPING)
        self._tabs.clear()
        self._stored.clear()
        self._clients.clear()

    # -- tabs -----------------------------------------------------------------

    def register(self, user_id: int, tab_id: str, tools: list[dict[str, Any]], task: asyncio.Task[Any] | None) -> None:
        tabs = self._tabs.setdefault(user_id, {})
        old = tabs.get(tab_id)
        tabs[tab_id] = _Tab(tab_id, tools, task)
        if task is not None and (old is None or old.task is not task):
            task.add_done_callback(partial(self._task_done, user_id, tab_id))
        self._store(user_id, tools)

    def activate(self, user_id: int, tab_id: str) -> None:
        tab = self._tabs.get(user_id, {}).get(tab_id)
        if tab is not None:
            tab.active = time.monotonic()

    def drop_tab(self, user_id: int, tab_id: str) -> None:
        tabs = self._tabs.get(user_id)
        if not tabs or tabs.pop(tab_id, None) is None:
            return
        if not tabs:
            del self._tabs[user_id]
        self._fail_calls(lambda c: c.user_id == user_id and c.tab == tab_id, TAB_CLOSED)

    def drop_user(self, user_id: int) -> None:
        self._tabs.pop(user_id, None)
        self._fail_calls(lambda c: c.user_id == user_id, TAB_CLOSED)

    def _task_done(self, user_id: int, tab_id: str, task: asyncio.Task[Any]) -> None:
        tab = self._tabs.get(user_id, {}).get(tab_id)
        if tab is not None and tab.task is task:
            self.drop_tab(user_id, tab_id)

    def pick(self, user_id: int) -> _Tab | None:
        """The tab that answers this user's calls: the live one used last."""
        live = [t for t in self._tabs.get(user_id, {}).values() if t.alive]
        return max(live, key=lambda t: t.active, default=None)

    def tools_for(self, user_id: int) -> list[dict[str, Any]]:
        tab = self.pick(user_id)
        return tab.tools if tab is not None else self._load(user_id)

    # -- the database copy of the tool list -----------------------------------

    def _store(self, user_id: int, tools: list[dict[str, Any]]) -> None:
        text = json.dumps(tools, separators=(",", ":"), sort_keys=True)
        if self._stored.get(user_id) == text:
            return
        with db.connect() as conn:
            conn.execute(
                """INSERT INTO mcp_tools (user_id, tools, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET tools = excluded.tools, updated_at = excluded.updated_at""",
                (user_id, text, time.time()),
            )
        self._stored[user_id] = text

    def _load(self, user_id: int) -> list[dict[str, Any]]:
        with db.connect() as conn:
            row = conn.execute("SELECT tools FROM mcp_tools WHERE user_id = ?", (user_id,)).fetchone()
        if row is None:
            return []
        try:
            tools = json.loads(row["tools"])
        except ValueError:
            return []
        return _clean_tools(tools) or []

    # -- calls ----------------------------------------------------------------

    async def call(self, user_id: int, tool: str, args: dict[str, Any], client: str | None = None) -> tuple[bool, Any]:
        """Run a tool in the user's KherveOS tab: (True, result) or (False, error message)."""
        tab = self.pick(user_id)
        if tab is None:
            return False, NO_TAB
        call_id = secrets.token_urlsafe(12)
        future: asyncio.Future[tuple[bool, Any]] = asyncio.get_running_loop().create_future()
        self._calls[call_id] = _Call(user_id, tab.id, future)
        event: dict[str, Any] = {"type": "mcp.call", "id": call_id, "tab": tab.id, "tool": tool, "args": args}
        if client:
            event["client"] = client
        log.info("MCP call %s for user %s (%s)", tool, user_id, client or "unknown client")
        hub.publish([user_id], event)
        timeout = CALL_TIMEOUT
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return False, (
                f"KherveOS did not answer within {timeout:g} seconds. It may still be working (the first Python "
                "run downloads Python), or be asking the user something (for example to allow a deletion) in "
                "the KherveOS tab."
            )
        finally:
            self._calls.pop(call_id, None)
            if not future.done() or future.cancelled():  # timed out, or the MCP client went away
                hub.publish([user_id], {"type": "mcp.cancel", "id": call_id, "tab": tab.id})

    def resolve(self, user_id: int, call_id: str, ok: bool, payload: Any) -> None:
        call = self._calls.get(call_id)
        if call is not None and call.user_id == user_id and not call.future.done():
            call.future.set_result((ok, payload))

    def _fail_calls(self, which: Callable[[_Call], bool], message: str) -> None:
        for call in list(self._calls.values()):
            if which(call) and not call.future.done():
                try:
                    call.future.set_result((False, message))
                except RuntimeError:  # its event loop is gone (a previous server run)
                    pass

    # -- which MCP client is calling -----------------------------------------

    def remember_client(self, user_id: int, agent: str, name: str) -> None:
        if len(self._clients) > 1000:
            self._clients.clear()
        self._clients[(user_id, agent)] = name
        self._clients[(user_id, "")] = name

    def client_name(self, user_id: int, agent: str) -> str | None:
        return self._clients.get((user_id, agent)) or self._clients.get((user_id, ""))


relay = Relay()


def _clean_tools(raw: Any) -> list[dict[str, Any]] | None:
    """The tool definitions a tab sent, checked and trimmed; None if unusable."""
    if not isinstance(raw, list):
        return None
    if len(raw) > MAX_TOOLS:
        log.warning("ignoring a tool list of %d tools (at most %d)", len(raw), MAX_TOOLS)
        return None
    tools: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not _TOOL_NAME.match(name) or name in seen:
            continue
        schema = item.get("inputSchema")
        if not isinstance(schema, dict) or schema.get("type") != "object":
            schema = {"type": "object", "properties": {}}
        description = item.get("description")
        tool: dict[str, Any] = {
            "name": name,
            "description": description[:4000] if isinstance(description, str) else "",
            "inputSchema": schema,
        }
        hints = item.get("annotations")
        if isinstance(hints, dict):
            kept = {k: v for k, v in hints.items() if k in _HINT_TYPES and isinstance(v, _HINT_TYPES[k])}
            if kept:
                tool["annotations"] = kept
        seen.add(name)
        tools.append(tool)
    size = len(json.dumps(tools))
    if size > MAX_TOOLS_JSON:
        log.warning("ignoring a tool list of %d bytes (at most %d)", size, MAX_TOOLS_JSON)
        return None
    return tools


def _tab_id(value: Any) -> str | None:
    return value if isinstance(value, str) and _TAB_ID.match(value) else None


# ------------------------------------------------------- websocket messages

@hub.on("mcp.tools")
async def _on_tools(user: User, event: dict) -> None:
    tab = _tab_id(event.get("tab"))
    tools = _clean_tools(event.get("tools"))
    if tab is None or tools is None:
        return
    # This handler runs in the task that serves the tab's websocket.
    relay.register(user.id, tab, tools, asyncio.current_task())
    hub.publish([user.id], {"type": "mcp.ready", "tab": tab, "tools": len(tools)})


@hub.on("mcp.active")
async def _on_active(user: User, event: dict) -> None:
    tab = _tab_id(event.get("tab"))
    if tab is not None:
        relay.activate(user.id, tab)


@hub.on("mcp.bye")
async def _on_bye(user: User, event: dict) -> None:
    tab = _tab_id(event.get("tab"))
    if tab is not None:
        relay.drop_tab(user.id, tab)


@hub.on("mcp.result")
async def _on_result(user: User, event: dict) -> None:
    call_id = event.get("id")
    if not isinstance(call_id, str):
        return
    if event.get("ok") is True:
        relay.resolve(user.id, call_id, True, event.get("result"))
    else:
        error = event.get("error")
        relay.resolve(user.id, call_id, False, error if isinstance(error, str) and error else "The tool failed.")


@hub.on_presence
async def _on_presence(user: User, online: bool) -> None:
    if not online:  # the user's last tab has gone
        relay.drop_user(user.id)


# --------------------------------------------------------------- MCP server

_CLIENT_NAMES = (
    ("claude-code", "Claude Code"),
    ("claude", "Claude"),
    ("openai", "ChatGPT"),
    ("chatgpt", "ChatGPT"),
    ("open-webui", "Open WebUI"),
    ("cursor", "Cursor"),
)


def _friendly(name: Any, title: Any = None) -> str | None:
    """'claude-code' -> 'Claude Code': how the KherveOS tab names who is asking."""
    if not isinstance(name, str) or not name.strip():
        return None
    low = name.strip().lower()
    for key, label in _CLIENT_NAMES:
        if low.startswith(key):
            return label
    text = title if isinstance(title, str) and title.strip() else name
    return text.strip()[:40]


def _agent(ctx: ServerRequestContext[Any, Any]) -> str:
    request = ctx.request
    return request.headers.get("user-agent", "")[:200] if request is not None else ""


def _client_name(ctx: ServerRequestContext[Any, Any], user_id: int) -> str | None:
    params = ctx.session.client_params  # set on 2026-07-28 requests that carry clientInfo
    if params is not None and params.client_info is not None:
        return _friendly(params.client_info.name, params.client_info.title)
    agent = _agent(ctx)
    remembered = relay.client_name(user_id, agent)
    if remembered:
        return remembered
    low = agent.lower()
    return next((label for key, label in _CLIENT_NAMES if key in low), None)


def _caller(ctx: ServerRequestContext[Any, Any]) -> User:
    request = ctx.request
    user = request.scope.get(_USER_KEY) if request is not None else None
    if not isinstance(user, User):
        raise MCPError(code=types.INVALID_REQUEST, message="Not authenticated.")
    return user


async def _remember_client(ctx: ServerRequestContext[Any, Any], call_next: CallNext) -> HandlerResult:
    """Middleware: note the client's name from `initialize` (stateless: later requests don't carry it)."""
    if ctx.method == "initialize" and ctx.request is not None:
        user = ctx.request.scope.get(_USER_KEY)
        info = (ctx.params or {}).get("clientInfo")
        if isinstance(user, User) and isinstance(info, Mapping):
            name = _friendly(info.get("name"), info.get("title"))
            if name:
                relay.remember_client(user.id, _agent(ctx), name)
    return await call_next(ctx)


def _mcp_tool(t: dict[str, Any]) -> types.Tool:
    hints = t.get("annotations") or {}
    return types.Tool(
        name=t["name"],
        title=hints.get("title"),
        description=t.get("description") or None,
        input_schema=t["inputSchema"],
        annotations=types.ToolAnnotations(
            title=hints.get("title"),
            read_only_hint=hints.get("readOnlyHint"),
            destructive_hint=hints.get("destructiveHint"),
            idempotent_hint=hints.get("idempotentHint"),
            open_world_hint=hints.get("openWorldHint"),
        )
        if hints
        else None,
    )


def _text(value: Any) -> str:
    if value is None:
        return "Done."
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + f"\n… (cut: the result was {len(text)} characters)"
    return text


async def _list_tools(ctx: ServerRequestContext[Any, Any], params: types.PaginatedRequestParams | None) -> types.ListToolsResult:
    user = _caller(ctx)
    tools: list[types.Tool] = []
    for t in relay.tools_for(user.id):
        try:
            tools.append(_mcp_tool(t))
        except ValidationError:
            log.warning("skipping malformed tool definition %r", t.get("name"))
    return types.ListToolsResult(tools=tools)


async def _call_tool(ctx: ServerRequestContext[Any, Any], params: types.CallToolRequestParams) -> types.CallToolResult:
    user = _caller(ctx)
    known = {t["name"] for t in relay.tools_for(user.id)}
    if known and params.name not in known:
        raise MCPError(code=types.INVALID_PARAMS, message=f"Unknown tool: {params.name}")
    ok, payload = await relay.call(user.id, params.name, dict(params.arguments or {}), _client_name(ctx, user.id))
    if ok:
        return types.CallToolResult(content=[types.TextContent(text=_text(payload))])
    message = payload if isinstance(payload, str) else _text(payload)
    return types.CallToolResult(content=[types.TextContent(text=message[:MAX_ERROR_CHARS])], is_error=True)


server: Server[Any] = Server(
    "kherveos",
    version=__version__,
    title="KherveOS",
    instructions=INSTRUCTIONS,
    on_list_tools=_list_tools,
    on_call_tool=_call_tool,
)
server.middleware.append(_remember_client)


# ------------------------------------------------------------ HTTP endpoint

_manager: StreamableHTTPSessionManager | None = None


def _rpc_error(status: int, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    body = {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": message}}
    return JSONResponse(body, status_code=status, headers=headers)


def _bearer(scope: Scope) -> str | None:
    value = Headers(scope=scope).get("authorization", "").strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    return value or None


class _Endpoint:
    """/mcp and /mcp/t/<token>: check the token, then hand the request to the MCP transport."""

    def __init__(self, *, token_in_path: bool) -> None:
        self.token_in_path = token_in_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        token = (scope.get("path_params") or {}).get("token") if self.token_in_path else _bearer(scope)
        user = user_for_token(token)
        if user is None:
            if token:
                message = (
                    "This KherveOS MCP token is not valid (it may have been replaced). "
                    "Copy the current one from KherveOS: Settings > AI & MCP."
                )
            else:
                message = (
                    'Missing token: send the header "Authorization: Bearer <token>". '
                    "KherveOS shows it in Settings > AI & MCP."
                )
            challenge = 'Bearer realm="KherveOS"' + (', error="invalid_token"' if token else "")
            await _rpc_error(401, message, {"WWW-Authenticate": challenge})(scope, receive, send)
            return
        manager = _manager
        if manager is None:
            await _rpc_error(503, "The KherveOS MCP endpoint is not running.")(scope, receive, send)
            return
        await manager.handle_request({**scope, _USER_KEY: user}, receive, send)


@asynccontextmanager
async def _lifespan(_app: Any) -> AsyncIterator[None]:
    global _manager
    relay.reset()
    if hub.loop is None:
        hub.loop = asyncio.get_running_loop()
    manager = StreamableHTTPSessionManager(app=server, json_response=True, stateless=True)
    async with manager.run():
        _manager = manager
        try:
            yield
        finally:
            _manager = None
            relay.reset()


router = APIRouter(tags=["mcp"], lifespan=_lifespan)


def _token_info(info: dict[str, Any]) -> dict[str, Any]:
    return {
        "token": info["token"],
        "url": f"{PUBLIC_URL.rstrip('/')}/mcp",
        "created_at": info["created_at"],
        "last_used": info["last_used"],
    }


@router.get("/api/mcp/token")
def get_token(user: User = Depends(current_user)):
    """The user's MCP access token (created on first use) and the MCP endpoint URL."""
    return _token_info(get_or_create_token(user.id))


@router.post("/api/mcp/token/rotate")
def rotate(user: User = Depends(current_user)):
    """Replace the token: clients set up with the old one stop working."""
    return _token_info(rotate_token(user.id))


router.add_route("/mcp", _Endpoint(token_in_path=False), name="kherveos_mcp")
router.add_route("/mcp/t/{token}", _Endpoint(token_in_path=True), name="kherveos_mcp_token")


def install(app: FastAPI) -> None:
    """The same as `app.include_router(router)`, but safe to call more than once."""
    try:
        app.url_path_for("kherveos_mcp")
    except NoMatchFound:
        app.include_router(router)


class _HideTokens(logging.Filter):
    """Keep the tokens of /mcp/t/<token> URLs out of the access log."""

    _pattern = re.compile(r"/mcp/t/[^/?#\s\"]+")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and any(isinstance(a, str) and "/mcp/t/" in a for a in record.args):
            record.args = tuple(self._pattern.sub("/mcp/t/<token>", a) if isinstance(a, str) else a for a in record.args)
        return True


logging.getLogger("uvicorn.access").addFilter(_HideTokens())
