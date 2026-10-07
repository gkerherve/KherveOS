"""A CORS proxy for Git over HTTPS, for isomorphic-git in the browser.

Browsers may not talk to github.com's Git endpoints directly (no CORS), so the
Git service (src/os/services/git.ts) gives isomorphic-git
``corsProxy = "/api/git/proxy"``. isomorphic-git then asks for

    /api/git/proxy/github.com/owner/repo.git/info/refs?service=git-upload-pack

and this module forwards it to

    https://github.com/owner/repo.git/info/refs?service=git-upload-pack

streaming the bodies both ways. It is deliberately narrow:

* only https, only github.com, gitlab.com, bitbucket.org and codeberg.org;
* only Git's smart-HTTP requests (ref discovery, upload-pack, receive-pack),
  so it can't be used to fetch arbitrary pages;
* only Git's headers go out (Authorization — the user's GitHub token, set by
  isomorphic-git — Content-Type, Accept, Git-Protocol…); never our cookies;
* you must be signed in, unless the request comes from this computer;
* 30 s without progress aborts; uploads are capped at 100 MB and downloads at 1 GB.

Uses httpx (installed with the dev requirements; add it to requirements.txt).
"""

from __future__ import annotations

import ipaddress
from collections.abc import AsyncIterator
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from . import auth

try:
    import httpx
except ImportError:  # pragma: no cover - the server still starts; the proxy says what is missing
    httpx = None  # type: ignore[assignment]

router = APIRouter(prefix="/api/git", tags=["git"])

PREFIX = "/api/git/proxy"
ALLOWED_HOSTS = frozenset({"github.com", "gitlab.com", "bitbucket.org", "codeberg.org"})
SERVICES = ("git-upload-pack", "git-receive-pack")
TIMEOUT = 30.0
MAX_REQUEST_BYTES = 100 * 1024 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024 * 1024
# GitHub sniffs the User-Agent and only speaks smart HTTP to Git clients.
USER_AGENT = "git/isomorphic-git (KherveOS)"

REQUEST_HEADERS = ("accept", "accept-encoding", "authorization", "content-type", "content-encoding", "git-protocol")
RESPONSE_HEADERS = (
    "content-type",
    "content-length",
    "content-encoding",
    "cache-control",
    "expires",
    "pragma",
    "etag",
    "last-modified",
    "x-github-request-id",
)


class _TooLarge(Exception):
    pass


# ------------------------------------------------------------------- access

def _is_loopback(address: str | None) -> bool:
    try:
        ip = ipaddress.ip_address((address or "").strip().strip("[]"))
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)  # ::ffff:127.0.0.1
    return (mapped or ip).is_loopback


def _from_this_computer(request: Request) -> bool:
    """From a loopback address, not forwarded from elsewhere, and not sent by another site's page."""
    if not _is_loopback(request.client.host if request.client else None):
        return False
    forwarded = [a for a in request.headers.get("x-forwarded-for", "").split(",") if a.strip()]
    if not all(_is_loopback(a) for a in forwarded):
        return False
    origin = request.headers.get("origin")
    return origin is None or urlsplit(origin).netloc.lower() == request.headers.get("host", "").lower()


def _check_access(request: Request) -> None:
    if _from_this_computer(request):
        return
    try:
        auth.current_user(request)
    except HTTPException as exc:
        raise HTTPException(401, "Sign in to KherveOS to use Git over the network (clone, pull, push).") from exc


# ------------------------------------------------------------------ request

def _target(request: Request) -> tuple[str, str]:
    """The upstream (host, URL) for this request, or 400/403."""
    raw = request.scope.get("raw_path") or request.url.path.encode()
    path = raw.decode("latin-1")
    if not path.startswith(PREFIX + "/"):
        raise HTTPException(400, "Expected /api/git/proxy/<host>/<repository path>.")
    host, _, rest = path[len(PREFIX) + 1:].partition("/")
    host = host.lower()
    if host not in ALLOWED_HOSTS:
        allowed = ", ".join(sorted(ALLOWED_HOSTS))
        raise HTTPException(403, f"The Git proxy only reaches {allowed} (not “{unquote(host)}”).")
    segments = unquote(rest).split("/")
    if not rest or any(s in (".", "..") for s in segments) or "\\" in rest:
        raise HTTPException(400, "That is not a repository path.")
    query = request.url.query
    if not _is_git_request(request.method, "/" + rest, query, request.headers.get("content-type", "")):
        raise HTTPException(403, "The Git proxy only forwards Git requests (info/refs, git-upload-pack, git-receive-pack).")
    return host, f"https://{host}/{rest}" + (f"?{query}" if query else "")


def _is_git_request(method: str, path: str, query: str, content_type: str) -> bool:
    """Only Git's smart-HTTP protocol: ref discovery, then upload-pack (fetch) or receive-pack (push)."""
    if method == "GET":
        return path.endswith("/info/refs") and parse_qs(query).get("service") in ([s] for s in SERVICES)
    if method == "POST":
        ctype = content_type.split(";")[0].strip().lower()
        return any(path.endswith("/" + s) and ctype == f"application/x-{s}-request" for s in SERVICES)
    return False


def _request_headers(request: Request) -> dict[str, str]:
    headers = {k: v for k in REQUEST_HEADERS if (v := request.headers.get(k)) is not None}
    agent = request.headers.get("user-agent", "")
    headers["user-agent"] = agent if agent.startswith("git/") else USER_AGENT
    headers.setdefault("accept-encoding", "identity")
    length = request.headers.get("content-length")
    if request.method == "POST" and length is not None:
        try:
            size = int(length)
        except ValueError:
            raise HTTPException(400, "Bad Content-Length.") from None
        if size > MAX_REQUEST_BYTES:
            raise HTTPException(413, f"Too large for the Git proxy (over {MAX_REQUEST_BYTES // 2**20} MB).")
        headers["content-length"] = str(size)
    return headers


async def _capped_upload(request: Request) -> AsyncIterator[bytes]:
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_REQUEST_BYTES:
            raise _TooLarge()
        if chunk:
            yield chunk


# ----------------------------------------------------------------- response

def _response_headers(upstream: "httpx.Response", url: str) -> dict[str, str]:
    headers = {k: v for k in RESPONSE_HEADERS if (v := upstream.headers.get(k)) is not None}
    location = upstream.headers.get("location")
    if location:
        # Redirects stay inside the proxy (and inside the allowed hosts).
        target = urlsplit(urljoin(url, location))
        if target.scheme == "https" and (target.hostname or "").lower() in ALLOWED_HOSTS and target.port in (None, 443):
            headers["location"] = f"{PREFIX}/{target.hostname}{target.path}" + (f"?{target.query}" if target.query else "")
    return headers


async def _capped_download(upstream: "httpx.Response", close) -> AsyncIterator[bytes]:
    total = 0
    try:
        async for chunk in upstream.aiter_raw():
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise _TooLarge()  # the client sees a cut-off response, i.e. a failure
            yield chunk
    finally:
        await close()  # also when the browser goes away mid-download


def _client() -> "httpx.AsyncClient":
    """One client per request (tests replace this with one on a fake transport)."""
    return httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT), follow_redirects=False)


# ---------------------------------------------------------------- endpoint

@router.api_route("/proxy/{target:path}", methods=["GET", "POST"])
async def proxy(target: str, request: Request):
    _check_access(request)
    host, url = _target(request)
    if httpx is None:
        raise HTTPException(503, "The Git proxy needs the httpx package on the server (pip install httpx).")
    headers = _request_headers(request)
    body = _capped_upload(request) if request.method == "POST" else None

    client = _client()
    try:
        upstream = await client.send(client.build_request(request.method, url, headers=headers, content=body), stream=True)
    except BaseException as exc:
        await client.aclose()
        if isinstance(exc, _TooLarge) or isinstance(exc.__cause__ or exc.__context__, _TooLarge):
            raise HTTPException(413, f"Too large for the Git proxy (over {MAX_REQUEST_BYTES // 2**20} MB).") from None
        if httpx is not None and isinstance(exc, httpx.TimeoutException):
            raise HTTPException(504, f"{host} did not answer within {TIMEOUT:g} seconds.") from None
        if httpx is not None and isinstance(exc, httpx.HTTPError):
            raise HTTPException(502, f"Could not reach {host}.") from None
        raise

    async def close() -> None:
        await upstream.aclose()
        await client.aclose()

    length = upstream.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_RESPONSE_BYTES:
        await close()
        raise HTTPException(413, f"Too large for the Git proxy (over {MAX_RESPONSE_BYTES // 2**30} GB).")

    return StreamingResponse(
        _capped_download(upstream, close),
        status_code=upstream.status_code,
        headers=_response_headers(upstream, url),
        background=BackgroundTask(close),
    )
