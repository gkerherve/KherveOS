"""The AI service: chat with Claude, or with a local Ollama model when Claude is not set up.

Claude needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the server's environment;
the key never reaches the browser. Ollama is reached at OLLAMA_URL (default
http://localhost:11434), model OLLAMA_MODEL or the first one installed.

POST /api/ai/anthropic/messages relays KherveAI's own Claude requests (tool use
included) with the server's key; see anthropic_messages.

POST /api/ai/chat streams newline-delimited JSON:
  {"provider": "claude"|"ollama", "model": ...}   once, first
  {"text": "..."}                                  many
  {"error": "..."}                                 on failure
  {"done": true}                                   last
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .auth import User, current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])

CLAUDE_MODEL = os.environ.get("KHERVEOS_CLAUDE_MODEL", "claude-opus-5-5")
SYSTEM = (
    "You are KherveAI in KherveOS, a free, open-source browser operating system "
    "made for the people. Be helpful, clear and friendly. Format answers in Markdown."
)


def ollama_url() -> str:
    return os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")


def claude_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


async def ollama_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            r = await client.get(f"{ollama_url()}/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
    except (httpx.HTTPError, ValueError, KeyError):
        return []


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=200_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)
    provider: Literal["auto", "claude", "ollama"] = "auto"
    model: str | None = None  # an Ollama model name


@router.get("/status")
async def status(_user: User = Depends(current_user)):
    models = await ollama_models()
    return {
        "claude": claude_configured(),
        "claude_model": CLAUDE_MODEL,
        "ollama": bool(models),
        "ollama_models": models,
    }


def _line(obj: dict) -> bytes:
    return (json.dumps(obj) + "\n").encode()


class _Unavailable(Exception):
    """The provider could not start answering; the next one may be tried."""


async def _claude(messages: list[dict]) -> AsyncIterator[bytes]:
    import anthropic

    client = anthropic.AsyncAnthropic()
    started = False
    try:
        async with client.beta.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=64000,
            system=SYSTEM,
            messages=messages,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            async for text in stream.text_stream:
                if not started:
                    started = True
                    yield _line({"provider": "claude", "model": CLAUDE_MODEL})
                yield _line({"text": text})
            final = await stream.get_final_message()
            if final.stop_reason == "refusal":
                yield _line({"error": "Claude declined to answer this."})
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        if not started:
            raise _Unavailable(f"Claude: the API key was refused ({e.status_code}).") from e
        yield _line({"error": "Claude: the API key was refused."})
    except anthropic.RateLimitError:
        if not started:
            raise _Unavailable("Claude is rate-limited right now.")
        yield _line({"error": "Claude is rate-limited right now."})
    except anthropic.APIConnectionError as e:
        if not started:
            raise _Unavailable("Claude could not be reached.") from e
        yield _line({"error": "The connection to Claude was lost."})
    except anthropic.APIStatusError as e:
        if not started:
            raise _Unavailable(f"Claude error {e.status_code}: {e.message}") from e
        yield _line({"error": f"Claude error {e.status_code}."})


async def _ollama(messages: list[dict], model: str | None) -> AsyncIterator[bytes]:
    models = await ollama_models()
    if not models:
        raise _Unavailable(f"Ollama is not running at {ollama_url()} (or has no models).")
    model = model if model in models else os.environ.get("OLLAMA_MODEL") or models[0]
    body = {"model": model, "stream": True, "messages": [{"role": "system", "content": SYSTEM}, *messages]}
    started = False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=300)) as client:
            async with client.stream("POST", f"{ollama_url()}/api/chat", json=body) as r:
                if r.status_code != 200:
                    raise _Unavailable(f"Ollama error {r.status_code}.")
                yield _line({"provider": "ollama", "model": model})
                started = True
                async for raw in r.aiter_lines():
                    if not raw.strip():
                        continue
                    chunk = json.loads(raw)
                    if chunk.get("error"):
                        yield _line({"error": f"Ollama: {chunk['error']}"})
                        return
                    text = chunk.get("message", {}).get("content", "")
                    if text:
                        yield _line({"text": text})
    except httpx.HTTPError as e:
        if not started:
            raise _Unavailable("Ollama could not be reached.") from e
        yield _line({"error": "The connection to Ollama was lost."})


@router.post("/chat")
async def chat(req: ChatRequest, _user: User = Depends(current_user)):
    messages = [m.model_dump() for m in req.messages]
    if messages[-1]["role"] != "user":
        raise HTTPException(400, "The last message must be from the user.")

    order: list[str]
    if req.provider == "claude":
        order = ["claude"]
    elif req.provider == "ollama":
        order = ["ollama"]
    else:
        order = (["claude"] if claude_configured() else []) + ["ollama"]
    if req.provider == "claude" and not claude_configured():
        raise HTTPException(503, "Claude is not set up: start the server with ANTHROPIC_API_KEY set.")

    async def run() -> AsyncIterator[bytes]:
        problems: list[str] = []
        for provider in order:
            gen = _claude(messages) if provider == "claude" else _ollama(messages, req.model)
            try:
                async for chunk in gen:
                    yield chunk
                yield _line({"done": True})
                return
            except _Unavailable as e:
                problems.append(str(e))
        yield _line({"error": " ".join(problems) or "No AI is available."})
        yield _line({"done": True})

    return StreamingResponse(run(), media_type="application/x-ndjson")


# ------------------------------------------- Claude for KherveAI, tools included

ANTHROPIC_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
# The parts of a Messages request that are passed on; anything else is dropped.
_MESSAGE_FIELDS = ("model", "max_tokens", "messages", "system", "tools", "tool_choice", "temperature", "thinking", "stop_sequences")
_MAX_REQUEST = 4_000_000  # bytes
_MAX_TOKENS = 64_000


def _relay_error(status: int, message: str) -> JSONResponse:
    # Anthropic's error shape, which KherveAI already reads.
    return JSONResponse({"type": "error", "error": {"type": "kherveos_error", "message": message}}, status_code=status)


@router.post("/anthropic/messages")
async def anthropic_messages(request: Request, _user: User = Depends(current_user)):
    """KherveAI's Claude calls made with this server's key, which never reaches the browser.

    The body is an Anthropic Messages request and the answer is Anthropic's own
    event stream, passed through unchanged, so tool use works exactly as with a
    key of one's own. Only the known request fields are forwarded.
    """
    if not claude_configured():
        return _relay_error(503, "Claude is not set up on this KherveOS server: start it with ANTHROPIC_API_KEY set.")
    raw = await request.body()
    if len(raw) > _MAX_REQUEST:
        return _relay_error(413, "This conversation is too long to send.")
    try:
        body = json.loads(raw)
    except ValueError:
        return _relay_error(400, "The request is not JSON.")
    if not isinstance(body, dict) or not isinstance(body.get("model"), str) or not isinstance(body.get("messages"), list):
        return _relay_error(400, "A Messages request needs a model and messages.")
    payload = {k: body[k] for k in _MESSAGE_FIELDS if k in body}
    payload["stream"] = True
    asked = payload.get("max_tokens")
    payload["max_tokens"] = min(asked, _MAX_TOKENS) if isinstance(asked, int) and asked > 0 else 16_000

    headers = {"anthropic-version": "2023-06-01", "content-type": "application/json"}
    if os.environ.get("ANTHROPIC_API_KEY"):
        headers["x-api-key"] = os.environ["ANTHROPIC_API_KEY"]
    else:
        headers["authorization"] = f"Bearer {os.environ['ANTHROPIC_AUTH_TOKEN']}"

    client = httpx.AsyncClient(timeout=httpx.Timeout(15, read=600))
    try:
        upstream = await client.send(
            client.build_request("POST", f"{ANTHROPIC_URL}/v1/messages", json=payload, headers=headers), stream=True
        )
    except httpx.HTTPError:
        await client.aclose()
        return _relay_error(502, "Claude could not be reached from the KherveOS server.")
    if upstream.status_code != 200:
        text = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        if upstream.status_code in (401, 403):
            # Not the person's key: say whose it is.
            return _relay_error(502, f"The KherveOS server's Claude key was refused ({upstream.status_code}).")
        return Response(text, status_code=upstream.status_code, media_type=upstream.headers.get("content-type", "application/json"))

    async def relay() -> AsyncIterator[bytes]:
        try:
            # Decoded bytes: the upstream may be compressed, and its encoding header isn't passed on.
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(relay(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
