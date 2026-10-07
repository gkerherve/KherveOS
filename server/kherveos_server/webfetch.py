"""A page fetcher for the KherveOS Browser: shows sites that refuse to be framed.

Many sites send ``X-Frame-Options`` or ``Content-Security-Policy: frame-ancestors``
so browsers won't show them inside another page. The Browser then asks for the
page through this module instead:

    GET /api/web/token                                -> {"token", "expires", "prefix"}
    GET /api/web/f/<token>/https/example.org/a/b?c=d  -> https://example.org/a/b?c=d

The target address is kept in the path ("path style"), so addresses that a
fetched stylesheet or script builds relative to itself still come back here.

Safety comes first:

* **Public hosts only (SSRF).** The host is resolved and every address must be
  public: loopback, private, link-local, multicast, reserved, CGNAT… (IPv4 and
  IPv6, incl. IPv4-mapped, 6to4 and NAT64 forms) are refused. The connection
  then goes to the address that was checked (the host name stays in the Host
  header and TLS SNI), so a second DNS answer can't swap it. Redirects are
  followed here, and each hop is checked again. Only http(s), ports 80 and 443.
* **Who may use it.** The token comes from ``/api/web/token``, which needs a
  signed-in user or a request from this computer (as the Git proxy). Tokens are
  signed with a key that lives only in this process and expire after 12 hours.
  They travel in the fetched pages' addresses (the pages' scripts can see them),
  which is why the fetcher itself only does public GETs, with limits.
* GET only, 20 s without progress aborts, pages and stylesheets up to 5 MB,
  other files up to 50 MB. No cookies or Authorization go out (only a browser
  User-Agent, Accept, Accept-Language and Range), and no Set-Cookie comes back.
* X-Frame-Options, the site's CSP and every other upstream header are dropped.
  Every answer carries ``Content-Security-Policy: sandbox …`` *without*
  allow-same-origin: even opened on its own, a fetched page gets an opaque
  origin and can never reach KherveOS's cookies or storage (the Browser's
  iframe is sandboxed the same way).
* HTML is rewritten: a ``<base>`` pointing at the real page, links, forms,
  frames, images, stylesheets and scripts through the fetcher, and a small
  helper (webfetch_frame.js) that keeps link clicks in the frame, reports the
  address to the Browser by postMessage and declines cookie banners.
  Stylesheets get their ``url()`` and ``@import`` rewritten too.
* Bot walls (Google's "unusual traffic", Cloudflare challenges, HTTP 429) come
  back as a short page that tells the Browser, which then offers the real browser.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import html
import ipaddress
import json
import re
import secrets
import socket
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from . import auth
from .gitproxy import _from_this_computer

try:
    import httpx
except ImportError:  # pragma: no cover - the server still starts; the fetcher says what is missing
    httpx = None  # type: ignore[assignment]

router = APIRouter(prefix="/api/web", tags=["web"])

PREFIX = "/api/web/f/"
TOKEN_TTL = 12 * 3600
TIMEOUT = 20.0
TOTAL_TIMEOUT = 45.0
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_REDIRECTS = 6
PORTS = (80, 443)
DEFAULT_PORTS = {"http": 80, "https": 443}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)

# The sandbox every answer gets. No allow-same-origin (opaque origin), no
# allow-popups / allow-top-navigation (new windows go to the Browser instead).
SANDBOX = "sandbox allow-scripts allow-forms allow-modals allow-downloads allow-pointer-lock"
SECURITY_HEADERS = {
    "content-security-policy": SANDBOX,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    # The page has an opaque origin, so its fonts and module scripts are cross-origin requests.
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
}
PASS_HEADERS = ("content-type", "content-language", "last-modified", "content-range", "accept-ranges", "content-disposition")
RAW_HEADERS = ("content-length", "content-encoding")

HTML_TYPES = ("text/html", "application/xhtml+xml")
REFUSED_NAMES = re.compile(r"(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$")
NAT64 = ipaddress.ip_network("64:ff9b::/96")

FRAME_JS = (Path(__file__).with_name("webfetch_frame.js")).read_text(encoding="utf-8")


class Refused(Exception):
    """A request the fetcher won't make. `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 403, kind: str = "refused"):
        super().__init__(message)
        self.status = status
        self.kind = kind


class _TooLarge(Exception):
    pass


# ------------------------------------------------------------------- tokens

_KEY = secrets.token_bytes(32)  # this process only: a restart retires every token


def _sign(body: str) -> str:
    digest = hmac.new(_KEY, b"kherveos-webfetch:" + body.encode(), hashlib.sha256).digest()[:18]
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def make_token(now: float | None = None) -> tuple[str, int]:
    expires = int((time.time() if now is None else now) + TOKEN_TTL)
    body = format(expires, "x")
    return f"{body}.{_sign(body)}", expires


def token_ok(token: str, now: float | None = None) -> bool:
    body, _, sig = token.partition(".")
    if not body or not sig or not re.fullmatch(r"[0-9a-f]{1,12}", body):
        return False
    if not hmac.compare_digest(sig, _sign(body)):
        return False
    return int(body, 16) > (time.time() if now is None else now)


# ------------------------------------------------------------ public hosts

def is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """A global unicast address: not loopback, private, link-local, multicast, reserved, CGNAT…"""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:  # ::ffff:10.0.0.1
            return is_public_ip(ip.ipv4_mapped)
        if ip.sixtofour is not None:  # 2002:0a00:0001::
            return is_public_ip(ip.sixtofour)
        if ip.teredo is not None:
            return False
        if ip in NAT64:  # 64:ff9b::10.0.0.1
            return is_public_ip(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
        if ip.is_site_local:
            return False
    return bool(
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def _ip_literal(host: str):
    try:
        return ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    # Old-style IPv4 forms the resolver also accepts: 2130706433, 0x7f.1, 017700000001…
    if re.fullmatch(r"(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+)){0,3}", host, re.I):
        try:
            return ipaddress.IPv4Address(socket.inet_aton(host))
        except OSError:
            raise Refused(f"“{host}” is not a valid address.", 400) from None
    return None


@dataclass
class Target:
    url: str  # as asked for (scheme://host[:port]/path?query)
    scheme: str
    host: str  # lower-case ASCII (IDNA), no brackets
    port: int
    path: str  # /path?query, as sent

    @property
    def host_header(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return host if self.port == DEFAULT_PORTS[self.scheme] else f"{host}:{self.port}"


def check_url(url: str) -> Target:
    """Refuse anything but http(s) to a named or public host on port 80/443 (before DNS)."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise Refused("That is not a web address.", 400) from None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise Refused("Only http and https pages can be fetched.", 400)
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise Refused("Addresses with a user name or password are not fetched.", 400)
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise Refused("That address has no host.", 400)
    port = port if port is not None else DEFAULT_PORTS[scheme]
    if port not in PORTS:
        raise Refused(f"Only ports 80 and 443 can be fetched (not {port}).", 403)
    ip = _ip_literal(host)
    if ip is not None:
        if not is_public_ip(ip):
            raise Refused(f"{host} is a private or local address: KherveOS only fetches public sites.")
        host = str(ip)
    else:
        try:
            host = host.encode("idna").decode("ascii").lower()
        except UnicodeError:
            raise Refused(f"“{host}” is not a valid host name.", 400) from None
        if not re.fullmatch(r"[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*", host):
            raise Refused(f"“{host}” is not a valid host name.", 400)
        if "." not in host or REFUSED_NAMES.search(host):
            raise Refused(f"{host} is a local name: KherveOS only fetches public sites.")
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return Target(url=url, scheme=scheme, host=host, port=port, path=path)


async def _resolve(host: str, port: int) -> list[str]:
    """Every address the host name resolves to (tests replace this)."""
    loop = asyncio.get_running_loop()
    infos = await asyncio.wait_for(loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), TIMEOUT)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


async def public_address(target: Target) -> str:
    """The address to connect to, once every address of the host has been checked."""
    if _ip_literal(target.host) is not None:
        return target.host
    try:
        addresses = await _resolve(target.host, target.port)
    except (OSError, asyncio.TimeoutError):
        raise Refused(f"Could not find {target.host}.", 502, "unreachable") from None
    if not addresses:
        raise Refused(f"Could not find {target.host}.", 502, "unreachable")
    for address in addresses:
        try:
            if "%" in address:  # a zone id: link-local
                raise ValueError(address)
            ip = ipaddress.ip_address(address)
        except ValueError:
            raise Refused(f"{target.host} has an address KherveOS can't check.") from None
        if not is_public_ip(ip):
            raise Refused(f"{target.host} points to a private or local address: KherveOS only fetches public sites.")
    return addresses[0]


# ------------------------------------------------------------- addresses

def _quote_path(path: str) -> str:
    return quote(path, safe="/%:@!$&'()*+,;=-._~")


def _quote_query(query: str) -> str:
    return quote(query, safe="/?%:@!$&'()*+,;=-._~")


def proxied(url: str, prefix: str) -> str | None:
    """The fetcher address for an http(s) address, or None for other kinds (data:, mailto:…)."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname or parts.username is not None:
        return None
    host = parts.hostname.rstrip(".")
    try:
        host = host.encode("idna").decode("ascii").lower() if not host.isascii() else host.lower()
    except UnicodeError:
        return None
    if ":" in host:
        host = f"[{host}]"
    hostport = host if port in (None, DEFAULT_PORTS[scheme]) else f"{host}:{port}"
    out = f"{prefix}{scheme}/{hostport}{_quote_path(parts.path or '/')}"
    if parts.query:
        out += "?" + _quote_query(parts.query)
    if parts.fragment:
        out += "#" + _quote_query(parts.fragment)
    return out


def target_from_path(raw_path: str, query: str) -> tuple[str, str]:
    """(token, real address) from /api/web/f/<token>/<scheme>/<host[:port]>/<path>."""
    if not raw_path.startswith(PREFIX):
        raise Refused("Expected /api/web/f/<token>/<scheme>/<host>/<path>.", 400)
    token, _, rest = raw_path[len(PREFIX):].partition("/")
    scheme, _, rest = rest.partition("/")
    hostport, slash, path = rest.partition("/")
    hostport = unquote(hostport)
    if scheme not in ("http", "https") or not hostport:
        raise Refused("Expected /api/web/f/<token>/<scheme>/<host>/<path>.", 400)
    url = f"{scheme}://{hostport}/{path if slash else ''}"
    if query:
        url += "?" + query
    return token, url


def _origin(request: Request) -> str:
    """KherveOS's own origin as the browser sees it (the dev server proxies /api with X-Forwarded-*)."""
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() or request.url.scheme
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip() or request.headers.get("host", "")
    if proto not in ("http", "https") or not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]{1,255}", host):
        raise HTTPException(400, "Bad Host header.")
    return f"{proto}://{host}"


# ---------------------------------------------------------- HTML and CSS

_CSS_URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)""", re.I)
_CSS_IMPORT = re.compile(r"""@import\s+(?:"([^"]*)"|'([^']*)')""", re.I)
_SKIP = re.compile(r"^\s*(#|data:|javascript:|mailto:|tel:|blob:|about:|sms:)", re.I)


def _ref(value: str, base: str, prefix: str) -> str | None:
    """`value` (relative to `base`) through the fetcher, or None to leave it alone."""
    value = value.strip()
    if not value or _SKIP.match(value):
        return None
    try:
        absolute = urljoin(base, value)
    except ValueError:
        return None
    return proxied(absolute, prefix)


def rewrite_css(css: str, base: str, prefix: str) -> str:
    def url(m: re.Match) -> str:
        p = _ref(m.group(1) if m.group(1) is not None else m.group(2) if m.group(2) is not None else m.group(3) or "", base, prefix)
        return f'url("{p}")' if p else m.group(0)

    def imp(m: re.Match) -> str:
        p = _ref(m.group(1) if m.group(1) is not None else m.group(2) or "", base, prefix)
        return f'@import "{p}"' if p else m.group(0)

    return _CSS_IMPORT.sub(imp, _CSS_URL.sub(url, css))


# Attributes that navigate (pages) and that load something (images, scripts, styles…).
URL_ATTRS = {
    "a": ("href",), "area": ("href",), "form": ("action",), "iframe": ("src",), "frame": ("src",),
    "img": ("src", "lowsrc"), "script": ("src",), "link": ("href",), "source": ("src",),
    "video": ("src", "poster"), "audio": ("src",), "track": ("src",), "input": ("src", "formaction"),
    "button": ("formaction",), "embed": ("src",), "object": ("data",), "image": ("href", "xlink:href"),
    "body": ("background",), "table": ("background",), "td": ("background",), "th": ("background",),
}
SRCSET_ATTRS = {"img": ("srcset",), "source": ("srcset",), "link": ("imagesrcset",)}
DROP_ATTRS = ("integrity", "ping", "nonce")
DROP_META = ("content-security-policy", "content-security-policy-report-only", "x-frame-options", "set-cookie")
# Players that are made to be framed: left as they are.
DIRECT_FRAMES = re.compile(r"^https://(www\.)?(youtube(-nocookie)?\.com/embed/|player\.vimeo\.com/)", re.I)
_REFRESH = re.compile(r"^(\s*\d*\.?\d*\s*[;,]\s*url\s*=\s*)(['\"]?)(.*?)\2\s*$", re.I | re.S)
_BASE_HREF = re.compile(r"<base\b[^>]*?\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))", re.I)


def _attr_text(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


class _Rewriter(HTMLParser):
    def __init__(self, base: str, prefix: str, inject: str):
        super().__init__(convert_charrefs=False)
        self.base = base
        self.prefix = prefix
        self.inject = inject
        self.injected = False
        self.in_style = False
        self.out: list[str] = []

    # -- helpers
    def _inject(self) -> None:
        if not self.injected:
            self.injected = True
            self.out.append(self.inject)

    def _direct_frame(self, value: str) -> bool:
        try:
            return bool(DIRECT_FRAMES.match(urljoin(self.base, value.strip())))
        except ValueError:
            return False

    def _srcset(self, value: str) -> str:
        if "data:" in value:
            return value
        out = []
        for candidate in value.split(","):
            c = candidate.strip()
            if not c:
                continue
            url, _, desc = c.partition(" ")
            p = _ref(url, self.base, self.prefix)
            out.append(f"{p or url} {desc.strip()}".strip())
        return ", ".join(out)

    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> tuple[list[tuple[str, str | None]], bool]:
        changed = False
        out: list[tuple[str, str | None]] = []
        urls = URL_ATTRS.get(tag, ())
        srcsets = SRCSET_ATTRS.get(tag, ())
        for name, value in attrs:
            if name in DROP_ATTRS:
                changed = True
                continue
            if value is not None:
                new = value
                if name in urls:
                    if not (tag in ("iframe", "frame") and self._direct_frame(value)):
                        new = _ref(value, self.base, self.prefix) or value
                elif name in srcsets:
                    new = self._srcset(value)
                elif name == "style" and "url(" in value.lower():
                    new = rewrite_css(value, self.base, self.prefix)
                elif name == "crossorigin" and value.strip().lower() == "use-credentials":
                    new = "anonymous"
                if new != value:
                    changed = True
                    value = new
            out.append((name, value))
        return out, changed

    def _tag(self, tag: str, attrs: list[tuple[str, str | None]], closed: bool) -> None:
        if not self.injected and tag not in ("html", "head"):
            self._inject()
        if tag == "base":
            return  # ours (in the injection) is the only one
        if tag == "meta":
            equiv = (dict(attrs).get("http-equiv") or "").strip().lower()
            if equiv in DROP_META:
                return
            if equiv == "refresh":
                content = dict(attrs).get("content") or ""
                m = _REFRESH.match(content)
                p = m and _ref(m.group(3), self.base, self.prefix)
                if p:
                    attrs = [(k, f"{m.group(1)}{p}" if k == "content" else v) for k, v in attrs]
                    self.out.append(self._serialize(tag, attrs, closed))
                    return
        new, changed = self._attrs(tag, attrs)
        text = self.get_starttag_text() or ""
        self.out.append(self._serialize(tag, new, closed) if changed or not text else text)
        if tag == "head":
            self._inject()
        if tag == "style" and not closed:
            self.in_style = True

    @staticmethod
    def _serialize(tag: str, attrs: list[tuple[str, str | None]], closed: bool) -> str:
        parts = [f"<{tag}"]
        for name, value in attrs:
            parts.append(f" {name}" if value is None else f' {name}="{_attr_text(value)}"')
        parts.append(" />" if closed else ">")
        return "".join(parts)

    # -- HTMLParser
    def handle_starttag(self, tag, attrs):
        self._tag(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._tag(tag, attrs, True)

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False
        if tag in ("head", "body", "html") and not self.injected:
            self._inject()
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        self.out.append(rewrite_css(data, self.base, self.prefix) if self.in_style else data)

    def handle_entityref(self, name):
        self.out.append(f"&{name};")

    def handle_charref(self, name):
        self.out.append(f"&#{name};")

    def handle_comment(self, data):
        self.out.append(f"<!--{data}-->")

    def handle_decl(self, decl):
        self.out.append(f"<!{decl}>")

    def handle_pi(self, data):
        self.out.append(f"<?{data}>")

    def unknown_decl(self, data):
        self.out.append(f"<![{data}]>")


def _script_json(value) -> str:
    """JSON that is safe inside <script>…</script>."""
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def rewrite_html(text: str, page_url: str, prefix: str, origin: str) -> str:
    """The page with a <base> at the real address, its links and resources through the fetcher, and the frame helper."""
    m = _BASE_HREF.search(text)
    base = page_url
    if m:
        href = html.unescape(next(g for g in m.groups() if g is not None)).strip()
        try:
            candidate = urljoin(page_url, href)
            if urlsplit(candidate).scheme in ("http", "https"):
                base = candidate
        except ValueError:
            pass
    config = {"url": page_url, "prefix": prefix, "origin": origin}
    inject = (
        f'<base href="{_attr_text(base)}">'
        f"<script>window.__KHERVEOS_WEB__={_script_json(config)};</script>"
        f"<script>{FRAME_JS}</script>"
    )
    parser = _Rewriter(base, prefix, inject)
    parser.feed(text)
    parser.close()
    if not parser.injected:
        parser.out.insert(0, inject)
    return "".join(parser.out)


def _charset(content_type: str, head: bytes) -> str:
    m = re.search(r"charset=[\"']?([\w.:-]+)", content_type, re.I)
    if not m:
        if head.startswith(b"\xef\xbb\xbf"):
            return "utf-8-sig"
        m = re.search(rb"<meta[^>]+charset=[\"']?([\w.:-]+)", head[:4096], re.I)
    name = m.group(1) if m else "utf-8"
    if isinstance(name, bytes):
        name = name.decode("ascii", "replace")
    try:
        "".encode(name)
        return name
    except LookupError:
        return "utf-8"


# ------------------------------------------------------------- bot walls

_WALL_MARKERS = (
    "our systems have detected unusual traffic",
    "please show you're not a robot",
    "<title>just a moment...</title>",
    'id="captcha-form"',
    "gs_captcha_f",
    'id="challenge-form"',
    "anomaly-modal",  # DuckDuckGo
)


def is_bot_wall(status: int, headers, body: bytes | None = None, url: str = "") -> bool:
    if status == 429 or (headers.get("cf-mitigated") or "").lower() == "challenge":
        return True
    if re.search(r"(^|\.)google\.[a-z.]+/sorry/", url.split("://", 1)[-1]):
        return True
    if body:
        low = body[:300_000].decode("utf-8", "replace").lower()
        return any(marker in low for marker in _WALL_MARKERS)
    return False


# ---------------------------------------------------------------- answers

def _wants_page(request: Request) -> bool:
    dest = request.headers.get("sec-fetch-dest", "")
    if dest:
        return dest in ("document", "iframe", "frame", "embed", "object")
    return "text/html" in request.headers.get("accept", "")


ERROR_TITLES = {
    "blocked": "This site turned KherveOS away",
    "unreachable": "This site could not be reached",
    "refused": "KherveOS won't fetch this address",
    "expired": "This page needs reloading",
    "form": "This form needs your real browser",
    "too-large": "This page is too large",
}


def _error(request: Request, message: str, status: int, kind: str, url: str = "", origin: str = "*") -> Response:
    headers = dict(SECURITY_HEADERS)
    headers["cache-control"] = "no-store"
    if not _wants_page(request):
        return Response(message, status_code=status, media_type="text/plain; charset=utf-8", headers=headers)
    title = ERROR_TITLES.get(kind, "This page can't be shown")
    note = {"source": "kherveos-web", "type": "error", "kind": kind, "url": url, "message": message, "status": status}
    body = f"""<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>html{{background:#0b0f0c;color:#d7e4da;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
body{{display:flex;min-height:90vh;align-items:center;justify-content:center;margin:0;padding:20px}}
main{{max-width:520px;text-align:center}}h1{{font-size:18px;color:#7ee2a0;margin:0 0 8px}}p{{color:#9fb3a5;margin:6px 0}}
code{{color:#d7e4da;word-break:break-all}}</style></head><body><main><h1>{html.escape(title)}</h1>
<p>{html.escape(message)}</p>{f"<p><code>{html.escape(url)}</code></p>" if url else ""}</main>
<script>try{{if(parent!==window)parent.postMessage({_script_json(note)},{_script_json(origin)})}}catch(e){{}}</script>
</body></html>"""
    return Response(body, status_code=status, media_type="text/html; charset=utf-8", headers=headers)


def _client() -> "httpx.AsyncClient":
    """One client per request, never using proxy settings from the environment (tests replace this)."""
    return httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT), follow_redirects=False, trust_env=False)


def _upstream_headers(request: Request, target: Target) -> dict[str, str]:
    headers = {
        "host": target.host_header,
        "user-agent": USER_AGENT,
        "accept": request.headers.get("accept") or "*/*",
        "accept-language": request.headers.get("accept-language") or "en",
        "accept-encoding": "gzip, deflate",
    }
    rng = request.headers.get("range")
    if rng and re.fullmatch(r"bytes=[0-9,\- ]{1,100}", rng):
        headers["range"] = rng
    return headers  # never Cookie, Authorization, Referer, Origin…


async def fetch(client: "httpx.AsyncClient", request: Request, url: str) -> tuple[str, "httpx.Response"]:
    """GET `url`, following redirects; every hop is checked again. Returns (final address, streamed response)."""
    for _ in range(MAX_REDIRECTS + 1):
        target = check_url(url)
        address = await public_address(target)
        host = f"[{address}]" if ":" in address else address
        req = client.build_request(
            "GET",
            f"{target.scheme}://{host}:{target.port}{target.path}",
            headers=_upstream_headers(request, target),
            extensions={"sni_hostname": target.host} if target.scheme == "https" else {},
        )
        resp = await client.send(req, stream=True)
        location = resp.headers.get("location")
        if resp.status_code in (301, 302, 303, 307, 308) and location:
            await resp.aclose()
            try:
                url = urljoin(url, location.strip())
            except ValueError:
                raise Refused("The site redirected to an address that isn't valid.", 502, "unreachable") from None
            if is_bot_wall(200, {}, url=url):
                raise Refused("The site asks for a check that only your real browser can pass (it blocks automated visits).", 403, "blocked")
            continue
        return url, resp
    raise Refused("Too many redirects.", 502, "unreachable")


async def _read_capped(resp: "httpx.Response", limit: int) -> bytes:
    length = resp.headers.get("content-length", "")
    if length.isdigit() and int(length) > limit and not resp.headers.get("content-encoding"):
        raise _TooLarge()
    chunks, total = [], 0
    async for chunk in resp.aiter_bytes():  # decoded: a small gzip can't unpack past the limit
        total += len(chunk)
        if total > limit:
            raise _TooLarge()
        chunks.append(chunk)
    return b"".join(chunks)


async def _stream_capped(resp: "httpx.Response", close) -> AsyncIterator[bytes]:
    total = 0
    try:
        async for chunk in resp.aiter_raw():
            total += len(chunk)
            if total > MAX_FILE_BYTES:
                raise _TooLarge()  # the browser sees a cut-off download, i.e. a failure
            yield chunk
    finally:
        await close()


def _pass_headers(resp: "httpx.Response", raw: bool) -> dict[str, str]:
    names = PASS_HEADERS + (RAW_HEADERS if raw else ())
    headers = {k: v for k in names if (v := resp.headers.get(k)) is not None}
    headers.update(SECURITY_HEADERS)
    headers["cache-control"] = "private, max-age=300"
    return headers


# --------------------------------------------------------------- endpoints

@router.get("/token")
def token(request: Request):
    """A fetcher token for the Browser: signed in, or a request from this computer."""
    if not _from_this_computer(request):
        try:
            auth.current_user(request)
        except HTTPException as exc:
            raise HTTPException(401, "Sign in to KherveOS to show sites that refuse to be framed.") from exc
    value, expires = make_token()
    return JSONResponse(
        {"token": value, "expires": expires, "prefix": f"{PREFIX}{value}/"},
        headers={"cache-control": "no-store"},
    )


@router.api_route("/f/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def fetch_page(rest: str, request: Request):
    raw = (request.scope.get("raw_path") or request.url.path.encode()).decode("latin-1")
    query = request.scope.get("query_string", b"").decode("latin-1")
    try:
        origin = _origin(request)
        tok, url = target_from_path(raw, query)
    except Refused as exc:
        return _error(request, str(exc), exc.status, exc.kind)
    if not token_ok(tok):
        return _error(request, "The page fetcher's pass has expired. Reload the page.", 401, "expired", url, origin)
    if request.method != "GET":
        message = "Forms that send data (sign-ins, comments, purchases…) only work in your real browser."
        return _error(request, message, 405, "form", url, origin)
    if httpx is None:
        return _error(request, "The page fetcher needs the httpx package on the server (pip install httpx).", 503, "unreachable", url, origin)
    prefix = f"{origin}{PREFIX}{tok}/"

    client = _client()
    resp = None
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT):
            final, resp = await fetch(client, request, url)
            ctype = resp.headers.get("content-type", "")
            kind = ctype.split(";")[0].strip().lower()
            if kind in HTML_TYPES or kind == "text/css":
                body = await _read_capped(resp, MAX_PAGE_BYTES)
                status, upstream_headers = resp.status_code, resp.headers
                await resp.aclose()
                await client.aclose()
                if kind in HTML_TYPES and is_bot_wall(status, upstream_headers, body, final):
                    raise Refused("The site asks for a check that only your real browser can pass (it blocks automated visits).", 403, "blocked")
                text = body.decode(_charset(ctype, body), errors="replace")
                if kind == "text/css":
                    out = rewrite_css(text, final, prefix)
                    media = "text/css; charset=utf-8"
                else:
                    out = rewrite_html(text, final, prefix, origin)
                    media = "text/html; charset=utf-8"
                headers = _pass_headers(resp, raw=False)
                headers.pop("content-type", None)
                return Response(out.encode("utf-8"), status_code=status, media_type=media, headers=headers)
            if is_bot_wall(resp.status_code, resp.headers, None, final):
                raise Refused("The site asks for a check that only your real browser can pass (it blocks automated visits).", 403, "blocked")
    except Refused as exc:
        await _close(resp, client)
        return _error(request, str(exc), exc.status, exc.kind, url, origin)
    except _TooLarge:
        await _close(resp, client)
        return _error(request, f"Over {MAX_PAGE_BYTES // 2**20} MB: open it in your real browser.", 413, "too-large", url, origin)
    except (TimeoutError, asyncio.TimeoutError):
        await _close(resp, client)
        return _error(request, "The site did not answer in time.", 504, "unreachable", url, origin)
    except BaseException as exc:
        await _close(resp, client)
        if httpx is not None and isinstance(exc, httpx.HTTPError):
            host = urlsplit(url).hostname or url
            return _error(request, f"Could not reach {host}.", 502, "unreachable", url, origin)
        raise

    # Anything else (images, scripts, fonts, PDFs…) streams through as it is.
    length = resp.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_FILE_BYTES:
        await _close(resp, client)
        return _error(request, f"Over {MAX_FILE_BYTES // 2**20} MB: open it in your real browser.", 413, "too-large", url, origin)

    async def close() -> None:
        await _close(resp, client)

    return StreamingResponse(
        _stream_capped(resp, close),
        status_code=resp.status_code,
        headers=_pass_headers(resp, raw=True),
        background=BackgroundTask(close),
    )


async def _close(resp, client) -> None:
    if resp is not None:
        await resp.aclose()
    await client.aclose()
