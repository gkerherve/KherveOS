"""The Assistant: chat with Claude, or with a local Ollama model when Claude is not set up.

Claude needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the server's environment;
the key never reaches the browser. Ollama is reached at OLLAMA_URL (default
http://localhost:11434), model OLLAMA_MODEL or the first one installed.

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
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import User, current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])

CLAUDE_MODEL = os.environ.get("KHERVEOS_CLAUDE_MODEL", "claude-opus-5-5")
SYSTEM = (
    "You are the Assistant in KherveOS, a free, open-source browser operating system "
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
