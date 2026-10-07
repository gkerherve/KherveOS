"""The Git CORS proxy, against a fake upstream (an httpx MockTransport)."""

import gzip
import os

import httpx
import pytest
from conftest import make_user
from fastapi.testclient import TestClient

from kherveos_server import gitproxy

REFS = "/api/git/proxy/github.com/octo/repo.git/info/refs?service=git-upload-pack"
UPLOAD = "/api/git/proxy/github.com/octo/repo.git/git-upload-pack"
ADVERT = b"001e# service=git-upload-pack\n0000"


def reply(status: int, headers: dict | None = None, body: bytes = b"") -> httpx.Response:
    """An upstream response whose body is still to be streamed, as from the network."""
    headers = {"content-length": str(len(body)), **(headers or {})}
    return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body))


class Upstream:
    """Records what reaches "GitHub" and answers with `respond(request)`."""

    def __init__(self):
        self.requests: list[tuple[httpx.Request, bytes]] = []
        self.respond = lambda request: reply(200, {"content-type": "application/x-git-upload-pack-advertisement"}, ADVERT)

    async def handler(self, request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        self.requests.append((request, body))
        return self.respond(request)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1][0]


@pytest.fixture()
def upstream(monkeypatch):
    up = Upstream()
    monkeypatch.setattr(
        gitproxy,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(up.handler), timeout=httpx.Timeout(gitproxy.TIMEOUT)),
    )
    return up


@pytest.fixture()
def local(client):
    """A client calling from 127.0.0.1, like a browser on this computer (`client` calls from elsewhere)."""
    from kherveos_server.app import app

    return TestClient(app, client=("127.0.0.1", 50000))


# ------------------------------------------------------------- forwarding

def test_ref_discovery_is_forwarded_with_git_headers_only(local, upstream):
    upstream.respond = lambda request: reply(
        200,
        {
            "content-type": "application/x-git-upload-pack-advertisement",
            "x-github-request-id": "ABC:123",
            "set-cookie": "tracking=1",
            "www-authenticate": 'Basic realm="GitHub"',
            "x-frame-options": "deny",
        },
        ADVERT,
    )
    r = local.get(
        REFS,
        headers={
            "authorization": "Basic eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA==",
            "git-protocol": "version=2",
            "accept": "*/*",
            "cookie": "kherveos_session=never-forward-me",
            "x-custom": "nope",
            "user-agent": "Mozilla/5.0",
        },
    )
    assert r.status_code == 200, r.text
    assert r.content == ADVERT
    assert r.headers["content-type"] == "application/x-git-upload-pack-advertisement"
    assert r.headers["x-github-request-id"] == "ABC:123"
    for dropped in ("set-cookie", "www-authenticate", "x-frame-options"):
        assert dropped not in r.headers

    sent = upstream.last
    assert sent.method == "GET"
    assert str(sent.url) == "https://github.com/octo/repo.git/info/refs?service=git-upload-pack"
    assert sent.headers["host"] == "github.com"
    assert sent.headers["authorization"] == "Basic eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA=="
    assert sent.headers["git-protocol"] == "version=2"
    assert sent.headers["accept"] == "*/*"
    assert sent.headers["user-agent"].startswith("git/")  # GitHub only speaks smart HTTP to git clients
    assert "cookie" not in sent.headers
    assert "x-custom" not in sent.headers


def test_a_git_user_agent_is_kept(local, upstream):
    local.get(REFS, headers={"user-agent": "git/2.45.0"})
    assert upstream.last.headers["user-agent"] == "git/2.45.0"


def test_post_bodies_stream_both_ways(local, upstream):
    sent_body = os.urandom(300_000)
    pack = os.urandom(1_500_000)
    upstream.respond = lambda request: reply(200, {"content-type": "application/x-git-upload-pack-result"}, pack)
    r = local.post(
        UPLOAD,
        content=sent_body,
        headers={"content-type": "application/x-git-upload-pack-request", "accept": "application/x-git-upload-pack-result"},
    )
    assert r.status_code == 200, r.text
    assert r.content == pack
    assert r.headers["content-type"] == "application/x-git-upload-pack-result"
    request, body = upstream.requests[-1]
    assert request.method == "POST"
    assert str(request.url) == "https://github.com/octo/repo.git/git-upload-pack"
    assert body == sent_body
    assert request.headers["content-type"] == "application/x-git-upload-pack-request"
    assert request.headers["content-length"] == str(len(sent_body))


def test_push_requests_are_forwarded(local, upstream):
    upstream.respond = lambda request: reply(200, {"content-type": "application/x-git-receive-pack-result"}, b"0000")
    assert local.get("/api/git/proxy/github.com/octo/repo.git/info/refs?service=git-receive-pack").status_code == 200
    r = local.post(
        "/api/git/proxy/github.com/octo/repo.git/git-receive-pack",
        content=b"PACK....",
        headers={"content-type": "application/x-git-receive-pack-request", "authorization": "Basic dG9rZW4="},
    )
    assert r.status_code == 200
    assert upstream.last.headers["authorization"] == "Basic dG9rZW4="


def test_status_and_compressed_bodies_pass_through(local, upstream):
    upstream.respond = lambda request: reply(
        401, {"content-type": "text/plain", "content-encoding": "gzip"}, gzip.compress(b"Invalid username or password.")
    )
    r = local.get(REFS, headers={"accept-encoding": "gzip"})
    assert r.status_code == 401
    assert r.headers["content-encoding"] == "gzip"
    assert r.text == "Invalid username or password."  # the client un-gzips
    assert upstream.last.headers["accept-encoding"] == "gzip"


def test_identity_encoding_when_the_client_names_none(local, upstream):
    del local.headers["accept-encoding"]
    local.get(REFS)
    assert upstream.last.headers["accept-encoding"] == "identity"


def test_redirects_stay_inside_the_proxy(local, upstream):
    upstream.respond = lambda request: reply(301, {"location": "https://github.com/octo/renamed.git/info/refs?service=git-upload-pack"})
    r = local.get(REFS, follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"] == "/api/git/proxy/github.com/octo/renamed.git/info/refs?service=git-upload-pack"

    upstream.respond = lambda request: reply(302, {"location": "https://evil.example/steal"})
    r = local.get(REFS, follow_redirects=False)
    assert r.status_code == 302
    assert "location" not in r.headers


# --------------------------------------------------------------- allowlist

@pytest.mark.parametrize("host", ["github.com", "GitHub.com", "gitlab.com", "bitbucket.org", "codeberg.org"])
def test_allowed_hosts(local, upstream, host):
    r = local.get(f"/api/git/proxy/{host}/octo/repo.git/info/refs?service=git-upload-pack")
    assert r.status_code == 200, r.text
    assert upstream.last.url.host == host.lower()
    assert upstream.last.url.scheme == "https"


@pytest.mark.parametrize(
    "host",
    ["evil.example", "github.com.evil.example", "api.github.com", "github.com:8443", "user@github.com", "127.0.0.1", "localhost"],
)
def test_other_hosts_are_refused(local, upstream, host):
    r = local.get(f"/api/git/proxy/{host}/octo/repo.git/info/refs?service=git-upload-pack")
    assert r.status_code == 403
    assert "only reaches" in r.json()["detail"]
    assert upstream.requests == []


@pytest.mark.parametrize(
    "method, path, ctype",
    [
        ("GET", "/api/git/proxy/github.com/octo/repo", None),  # a web page
        ("GET", "/api/git/proxy/github.com/octo/repo.git/info/refs", None),  # no service
        ("GET", "/api/git/proxy/github.com/octo/repo.git/info/refs?service=evil", None),
        ("GET", "/api/git/proxy/github.com/octo/repo.git/git-upload-pack", None),
        ("POST", "/api/git/proxy/github.com/octo/repo.git/git-upload-pack", "text/plain"),
        ("POST", "/api/git/proxy/github.com/octo/repo.git/git-receive-pack", "application/x-git-upload-pack-request"),
        ("POST", "/api/git/proxy/github.com/octo/repo.git/info/refs?service=git-upload-pack", "application/x-git-upload-pack-request"),
    ],
)
def test_only_git_requests_are_forwarded(local, upstream, method, path, ctype):
    r = local.request(method, path, content=b"x" if method == "POST" else None, headers={"content-type": ctype} if ctype else {})
    assert r.status_code == 403, r.text
    assert upstream.requests == []


def test_bad_paths(local, upstream):
    assert local.get("/api/git/proxy/github.com/%2e%2e/evil/info/refs?service=git-upload-pack").status_code == 400
    assert local.get("/api/git/proxy/github.com").status_code == 400  # no repository path
    assert local.put(REFS).status_code == 405
    assert upstream.requests == []


# -------------------------------------------------------------------- auth

def test_sign_in_needed_from_elsewhere(client, upstream):
    r = client.get(REFS)  # TestClient's address is "testclient", not this computer
    assert r.status_code == 401
    assert r.json()["detail"].startswith("Sign in to KherveOS")
    assert upstream.requests == []
    make_user(client)
    assert client.get(REFS).status_code == 200


@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
def test_this_computer_needs_no_sign_in(client, upstream, address):
    from kherveos_server.app import app

    assert TestClient(app, client=(address, 50000)).get(REFS).status_code == 200


def test_forwarded_or_cross_site_requests_need_sign_in(local, upstream):
    assert local.get(REFS, headers={"x-forwarded-for": "203.0.113.9"}).status_code == 401
    assert local.get(REFS, headers={"x-forwarded-for": "127.0.0.1"}).status_code == 200  # the dev proxy (vite xfwd)
    assert local.get(REFS, headers={"origin": "https://evil.example"}).status_code == 401
    assert local.get(REFS, headers={"origin": "http://testserver"}).status_code == 200


# ------------------------------------------------------------------ limits

def test_upload_limit(local, upstream, monkeypatch):
    monkeypatch.setattr(gitproxy, "MAX_REQUEST_BYTES", 1000)
    headers = {"content-type": "application/x-git-upload-pack-request"}
    assert local.post(UPLOAD, content=b"x" * 2000, headers=headers).status_code == 413  # by Content-Length
    assert upstream.requests == []

    def chunks():  # no Content-Length: counted while streaming
        for _ in range(4):
            yield b"y" * 400

    assert local.post(UPLOAD, content=chunks(), headers=headers).status_code == 413
    assert local.post(UPLOAD, content=b"x" * 900, headers=headers).status_code == 200


def test_download_limit(local, upstream, monkeypatch):
    monkeypatch.setattr(gitproxy, "MAX_RESPONSE_BYTES", 1000)
    upstream.respond = lambda request: reply(200, {}, b"z" * 5000)  # declares Content-Length
    assert local.get(REFS).status_code == 413

    async def stream():
        for _ in range(10):
            yield b"z" * 500

    upstream.respond = lambda request: httpx.Response(200, content=stream())  # chunked: cut off mid-stream
    with pytest.raises(Exception):
        local.get(REFS)


def test_upstream_failures(local, upstream):
    def unreachable(request):
        raise httpx.ConnectError("no route", request=request)

    upstream.respond = unreachable
    r = local.get(REFS)
    assert r.status_code == 502 and "Could not reach github.com" in r.json()["detail"]

    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    upstream.respond = slow
    r = local.get(REFS)
    assert r.status_code == 504 and "30 seconds" in r.json()["detail"]


def test_real_client_settings():
    c = gitproxy._client()
    assert c.timeout.connect == c.timeout.read == c.timeout.write == 30.0
    assert c.follow_redirects is False
