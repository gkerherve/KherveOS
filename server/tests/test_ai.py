"""The Assistant route: auth, provider choice, and the Ollama stream."""

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
