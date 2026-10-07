"""The AI routes: auth, provider choice, the Ollama stream, and the Claude relay."""

import json

import httpx

from conftest import make_user
from kherveos_server import ai


def lines(r):
    return [json.loads(l) for l in r.text.splitlines() if l.strip()]


def test_needs_login(client):
    assert client.get("/api/ai/status").status_code == 401


def test_nothing_available(client, monkeypatch):
    make_user(client)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)

    async def none():
        return []

    monkeypatch.setattr(ai, "ollama_models", none)
    r = client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    out = lines(r)
    assert "error" in out[0] and out[-1] == {"done": True}
    assert client.post("/api/ai/chat", json={"provider": "claude", "messages": [{"role": "user", "content": "hi"}]}).status_code == 503


def test_ollama_stream(client, monkeypatch):
    make_user(client)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)

    async def models():
        return ["tiny"]

    def handler(request):
        body = "\n".join(json.dumps({"message": {"content": t}}) for t in ["Hel", "lo"])
        return httpx.Response(200, text=body)

    real = httpx.AsyncClient
    monkeypatch.setattr(ai, "ollama_models", models)
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler)))
    out = lines(client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}))
    assert out[0] == {"provider": "ollama", "model": "tiny"}
    assert "".join(o.get("text", "") for o in out) == "Hello"
    assert out[-1] == {"done": True}


# ------------------------------------------------ the Claude relay for KherveAI

def test_relay_needs_a_server_key(client, monkeypatch):
    make_user(client)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    r = client.post("/api/ai/anthropic/messages", json={"model": "claude-sonnet-5-5", "messages": []})
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["error"]["message"]


def test_relay_needs_login(client):
    assert client.post("/api/ai/anthropic/messages", json={"model": "m", "messages": []}).status_code == 401


def test_relay_passes_the_stream_and_only_known_fields(client, monkeypatch):
    make_user(client)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-server")
    seen = {}
    sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n'

    def handler(request):
        seen["key"] = request.headers.get("x-api-key")
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})

    real = httpx.AsyncClient
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler)))
    tools = [{"name": "list_files", "description": "List files", "input_schema": {"type": "object"}}]
    r = client.post(
        "/api/ai/anthropic/messages",
        json={"model": "claude-sonnet-5-5", "max_tokens": 999_999, "messages": [{"role": "user", "content": "hi"}],
              "tools": tools, "metadata": {"user_id": "x"}, "anthropic_key": "nope"},
    )
    assert r.status_code == 200 and r.text == sse
    assert seen["key"] == "sk-test-server" and seen["url"].endswith("/v1/messages")
    assert seen["body"]["stream"] is True and seen["body"]["tools"] == tools
    assert seen["body"]["max_tokens"] == 64_000
    assert "metadata" not in seen["body"] and "anthropic_key" not in seen["body"]


def test_relay_reports_a_refused_server_key(client, monkeypatch):
    make_user(client)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-bad")
    real = httpx.AsyncClient
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(
        lambda request: httpx.Response(401, json={"type": "error", "error": {"message": "invalid x-api-key"}}))))
    r = client.post("/api/ai/anthropic/messages", json={"model": "m", "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 502 and "server's Claude key" in r.json()["error"]["message"]
