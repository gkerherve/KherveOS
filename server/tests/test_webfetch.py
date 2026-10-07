"""The page fetcher (webfetch.py): access, SSRF, header hygiene, HTML/CSS rewriting.

DNS and the network are faked: `dns` maps host names to addresses, and
`upstream` answers in place of the web (an httpx MockTransport).
"""

import ipaddress
import time

import httpx
import pytest
from conftest import make_user
from fastapi.testclient import TestClient

from kherveos_server import webfetch
from kherveos_server.app import app

# Until app.py includes the router (app.include_router(webfetch.router)).
if not any(getattr(route, "path", "").startswith("/api/web/") for route in app.routes):
    app.include_router(webfetch.router)

PUBLIC = "93.184.215.14"
PAGE = "<!doctype html><html><head><title>Hi</title></head><body><a href='/next'>next</a></body></html>"


def reply(status: int, headers: dict | None = None, body: bytes = b"") -> httpx.Response:
    headers = {"content-length": str(len(body)), **(headers or {})}
    return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body))


def html(body: str = PAGE, status: int = 200, headers: dict | None = None) -> httpx.Response:
    return reply(status, {"content-type": "text/html; charset=utf-8", **(headers or {})}, body.encode())


class Upstream:
    """Records what reaches "the web" and answers with `respond(request)`."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.respond = lambda request: html()

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)

    @property
    def last(self) -> httpx.Request:
        return self.requests[-1]


@pytest.fixture()
def dns(monkeypatch):
    table = {"example.org": [PUBLIC], "www.example.org": [PUBLIC], "cdn.example.net": ["2606:4700::6810:1"]}

    async def resolve(host, port):
        if host not in table:
            raise OSError("not found")
        return table[host]

    monkeypatch.setattr(webfetch, "_resolve", resolve)
    return table


@pytest.fixture()
def upstream(monkeypatch, dns):
    up = Upstream()
    monkeypatch.setattr(
        webfetch,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(up.handler), timeout=httpx.Timeout(webfetch.TIMEOUT)),
    )
    return up


@pytest.fixture()
def local(client):
    """A client on this computer (127.0.0.1); `client` calls from elsewhere."""
    from kherveos_server.app import app

    return TestClient(app, client=("127.0.0.1", 50000))


@pytest.fixture()
def web(client):
    """A client for /api/web/f/… with a valid token (the fetcher itself needs only the token)."""
    tok, _ = webfetch.make_token()

    def get(target: str, **kw):
        scheme, _, rest = target.partition("://")
        kw.setdefault("headers", {}).setdefault("sec-fetch-dest", "iframe")
        return client.get(f"/api/web/f/{tok}/{scheme}/{rest}", **kw)

    get.token = tok
    get.client = client
    return get


# ------------------------------------------------------------------ access

def test_token_needs_sign_in_from_another_computer(client):
    r = client.get("/api/web/token")
    assert r.status_code == 401
    make_user(client)
    r = client.get("/api/web/token")
    assert r.status_code == 200
    data = r.json()
    assert webfetch.token_ok(data["token"])
    assert data["prefix"] == f"/api/web/f/{data['token']}/"
    assert data["expires"] > time.time() + 3600


def test_token_from_this_computer_without_sign_in(local):
    assert local.get("/api/web/token").status_code == 200
    # …but not when another site's page asks (Origin), nor a sandboxed page (Origin: null).
    assert local.get("/api/web/token", headers={"origin": "https://evil.example"}).status_code == 401
    assert local.get("/api/web/token", headers={"origin": "null"}).status_code == 401
    assert local.get("/api/web/token", headers={"x-forwarded-for": "203.0.113.9"}).status_code == 401


def test_tokens_are_signed_and_expire():
    tok, expires = webfetch.make_token()
    assert webfetch.token_ok(tok)
    body, _, sig = tok.partition(".")
    assert not webfetch.token_ok(f"{body}.{sig[:-1]}{'A' if sig[-1] != 'A' else 'B'}")
    assert not webfetch.token_ok(f"{format(expires + 10, 'x')}.{sig}")
    assert not webfetch.token_ok("")
    assert not webfetch.token_ok("nonsense")
    old, _ = webfetch.make_token(now=time.time() - webfetch.TOKEN_TTL - 5)
    assert not webfetch.token_ok(old)


def test_fetch_needs_a_valid_token(client, upstream):
    r = client.get("/api/web/f/123abc.forged/https/example.org/", headers={"sec-fetch-dest": "iframe"})
    assert r.status_code == 401
    assert "expired" in r.text and "kherveos-web" in r.text
    assert upstream.requests == []


# -------------------------------------------------------------------- SSRF

PRIVATE = [
    "127.0.0.1", "127.8.9.10", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "100.64.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.8", "198.18.0.1", "240.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3",
    "64:ff9b::a00:1", "2002:7f00:1::1", "2001:db8::1", "fec0::1",
]


@pytest.mark.parametrize("address", PRIVATE)
def test_private_addresses_are_not_public(address):
    assert not webfetch.is_public_ip(ipaddress.ip_address(address))


@pytest.mark.parametrize("address", ["93.184.215.14", "1.1.1.1", "2606:4700::6810:1", "::ffff:8.8.8.8", "64:ff9b::808:808"])
def test_public_addresses(address):
    assert webfetch.is_public_ip(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    "target",
    [
        "http://127.0.0.1/", "http://10.0.0.1/admin", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/",
        "http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://127.1/",
        "http://100.64.1.1/", "http://[64:ff9b::7f00:1]/",
    ],
)
def test_literal_private_addresses_are_refused(web, upstream, target):
    r = web(target)
    assert r.status_code == 403, r.text
    assert upstream.requests == []


@pytest.mark.parametrize("target", ["http://localhost/", "http://printer.local/", "http://intranet/", "http://db.internal/"])
def test_local_names_are_refused(web, upstream, target):
    assert web(target).status_code == 403
    assert upstream.requests == []


@pytest.mark.parametrize("bad", [["10.0.0.7"], ["127.0.0.1"], [PUBLIC, "192.168.0.10"], ["fd00::1"], ["::ffff:169.254.169.254"], ["fe80::1%en0"]])
def test_dns_answers_pointing_inside_are_refused(web, upstream, dns, bad):
    dns["rebind.example.com"] = bad
    r = web("https://rebind.example.com/")
    assert r.status_code == 403
    assert "private or local" in r.text or "can't check" in r.text
    assert upstream.requests == []


def test_unknown_host(web, upstream):
    r = web("https://no-such-host.example/")
    assert r.status_code == 502
    assert upstream.requests == []


def test_connects_to_the_checked_address(web, upstream):
    r = web("https://example.org/a/b?c=d")
    assert r.status_code == 200
    req = upstream.last
    assert req.url.host == PUBLIC  # pinned: DNS is not asked again by the HTTP client
    assert req.url.port in (None, 443)
    assert req.url.raw_path == b"/a/b?c=d"
    assert req.headers["host"] == "example.org"
    assert req.extensions["sni_hostname"] == "example.org"  # TLS still checks example.org's certificate


def test_ipv6_hosts(web, upstream):
    assert web("https://cdn.example.net/x.png").status_code == 200
    assert upstream.last.url.host == "2606:4700::6810:1"


@pytest.mark.parametrize("path", ["ftp/example.org/x", "file/etc/passwd", "gopher/example.org/", "javascript/alert(1)"])
def test_only_http_and_https(web, upstream, path):
    r = web.client.get(f"/api/web/f/{web.token}/{path}", headers={"sec-fetch-dest": "iframe"})
    assert r.status_code == 400
    assert upstream.requests == []


@pytest.mark.parametrize("target", ["https://example.org:8443/", "http://example.org:22/", "http://example.org:6379/", "https://example.org:0/"])
def test_only_ports_80_and_443(web, upstream, target):
    assert web(target).status_code in (400, 403)
    assert upstream.requests == []


def test_ports_80_and_443_are_fine(web, upstream):
    assert web("http://example.org:80/").status_code == 200
    assert web("https://example.org:443/").status_code == 200
    assert web("http://example.org:443/").status_code == 200


def test_no_user_info(web, upstream):
    assert web("https://user:pw@example.org/").status_code == 400
    assert upstream.requests == []


@pytest.mark.parametrize(
    "location",
    [
        "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:80/", "http://localhost/",
        "https://rebind.example.com/",
    ],
)
def test_redirects_inside_are_refused(web, upstream, dns, location):
    dns["rebind.example.com"] = ["10.1.1.1"]
    upstream.respond = lambda request: reply(302, {"location": location})
    r = web("https://example.org/go")
    assert r.status_code == 403
    assert len(upstream.requests) == 1  # only the first, public hop


@pytest.mark.parametrize("location", ["file:///etc/passwd", "ftp://example.org/x", "gopher://example.org/", "https://example.org:8080/"])
def test_redirects_to_other_schemes_and_ports_are_refused(web, upstream, location):
    upstream.respond = lambda request: reply(301, {"location": location})
    r = web("https://example.org/go")
    assert r.status_code in (400, 403)
    assert len(upstream.requests) == 1


def test_public_redirects_are_followed_and_reported(web, upstream):
    def respond(request):
        if request.url.path == "/old":
            return reply(301, {"location": "/new?x=1"})
        return html()

    upstream.respond = respond
    r = web("https://example.org/old")
    assert r.status_code == 200
    assert [q.url.path for q in upstream.requests] == ["/old", "/new"]
    assert '"url": "https://example.org/new?x=1"' in r.text  # the Browser's address bar follows


def test_redirect_loops_stop(web, upstream):
    upstream.respond = lambda request: reply(302, {"location": "/again"})
    assert web("https://example.org/again").status_code == 502
    assert len(upstream.requests) == webfetch.MAX_REDIRECTS + 1


# ------------------------------------------------------------ hygiene

def test_headers_both_ways(web, upstream):
    upstream.respond = lambda request: html(
        headers={
            "x-frame-options": "DENY",
            "content-security-policy": "frame-ancestors 'none'",
            "set-cookie": "track=1; Path=/",
            "strict-transport-security": "max-age=1",
            "access-control-allow-credentials": "true",
        }
    )
    r = web(
        "https://example.org/",
        headers={
            "sec-fetch-dest": "iframe",
            "cookie": "kherveos_session=secret-session",
            "authorization": "Bearer secret-token",
            "accept-language": "fr-FR",
            "referer": "http://localhost:5173/api/web/f/xyz/https/elsewhere.org/",
            "origin": "http://localhost:5173",
        },
    )
    assert r.status_code == 200
    sent = upstream.last.headers
    for name in ("cookie", "authorization", "referer", "origin", "x-forwarded-for"):
        assert name not in sent
    assert "secret" not in str(sent)
    assert sent["accept-language"] == "fr-FR"
    assert "Mozilla" in sent["user-agent"]

    got = {k.lower(): v for k, v in r.headers.items()}
    assert "x-frame-options" not in got
    assert "set-cookie" not in got
    assert "strict-transport-security" not in got
    assert "access-control-allow-credentials" not in got
    csp = got["content-security-policy"]
    assert csp.startswith("sandbox ") and "allow-scripts" in csp
    assert "allow-same-origin" not in csp and "allow-top-navigation" not in csp and "allow-popups" not in csp
    assert got["x-content-type-options"] == "nosniff"
    assert got["referrer-policy"] == "no-referrer"


def test_get_only(web, upstream):
    r = web.client.post(f"/api/web/f/{web.token}/https/example.org/login", data={"user": "x"}, headers={"sec-fetch-dest": "iframe"})
    assert r.status_code == 405
    assert "real browser" in r.text and '"kind": "form"' in r.text
    assert upstream.requests == []


def test_pages_over_the_limit(web, upstream, monkeypatch):
    monkeypatch.setattr(webfetch, "MAX_PAGE_BYTES", 1000)
    upstream.respond = lambda request: html("<p>" + "x" * 5000 + "</p>")
    r = web("https://example.org/big")
    assert r.status_code == 413


def test_files_over_the_limit(web, upstream, monkeypatch):
    monkeypatch.setattr(webfetch, "MAX_FILE_BYTES", 1000)
    upstream.respond = lambda request: reply(200, {"content-type": "application/pdf"}, b"%" * 5000)
    r = web("https://example.org/big.pdf", headers={"sec-fetch-dest": "document"})
    assert r.status_code == 413


def test_other_files_stream_through(web, upstream):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    upstream.respond = lambda request: reply(200, {"content-type": "image/png", "set-cookie": "a=b"}, png)
    r = web("https://example.org/i.png", headers={"sec-fetch-dest": "image", "range": "bytes=0-10"})
    assert r.status_code == 200
    assert r.content == png
    assert r.headers["content-type"] == "image/png"
    assert "set-cookie" not in r.headers
    assert r.headers["access-control-allow-origin"] == "*"
    assert upstream.last.headers["range"] == "bytes=0-10"


def test_timeouts_and_network_errors(web, upstream):
    def boom(request):
        raise httpx.ConnectError("nope")

    upstream.respond = boom
    r = web("https://example.org/")
    assert r.status_code == 502
    upstream.respond = lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow"))
    assert web("https://example.org/").status_code == 502


def test_errors_for_resources_are_plain_text(web, upstream):
    r = web("http://127.0.0.1/x.js", headers={"sec-fetch-dest": "script"})
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("text/plain")


# ------------------------------------------------------------- bot walls

def test_too_many_requests(web, upstream):
    upstream.respond = lambda request: html("<p>slow down</p>", status=429)
    r = web("https://example.org/")
    assert r.status_code == 403
    assert '"kind": "blocked"' in r.text


def test_google_sorry_redirect(web, upstream, dns):
    dns["scholar.google.com"] = [PUBLIC]
    dns["www.google.com"] = [PUBLIC]
    upstream.respond = lambda request: reply(302, {"location": "https://www.google.com/sorry/index?continue=x"})
    r = web("https://scholar.google.com/scholar?q=iron")
    assert r.status_code == 403
    assert '"kind": "blocked"' in r.text
    assert len(upstream.requests) == 1


def test_captcha_page(web, upstream):
    upstream.respond = lambda request: html("<html><body><form id=\"captcha-form\"></form>Our systems have detected unusual traffic</body></html>")
    r = web("https://example.org/")
    assert r.status_code == 403
    assert "only your real browser" in r.text


def test_cloudflare_challenge(web, upstream):
    upstream.respond = lambda request: html("<title>Just a moment...</title>", status=403, headers={"cf-mitigated": "challenge"})
    assert web("https://example.org/").status_code == 403


# ------------------------------------------------------------ rewriting

P = "http://localhost:5173/api/web/f/TOK/"
O = "http://localhost:5173"


def test_addresses_round_trip():
    for url in ["https://example.org/", "http://example.org/a/b.html?x=1&y=%20z", "https://example.org:8443/p", "https://xn--bcher-kva.example/"]:
        fetched = webfetch.proxied(url, P)
        raw = fetched[len(O):]
        path, _, query = raw.partition("?")
        tok, back = webfetch.target_from_path(path, query)
        assert tok == "TOK"
        assert back == url
    assert webfetch.proxied("https://bücher.example/ä b", P) == P + "https/xn--bcher-kva.example/%C3%A4%20b"
    assert webfetch.proxied("https://Example.org:443/", P) == P + "https/example.org/"
    for other in ["mailto:a@b.c", "data:text/plain,hi", "javascript:alert(1)", "ftp://x.org/", "https://u:p@x.org/"]:
        assert webfetch.proxied(other, P) is None


def rewrite(page: str, url: str = "https://example.org/dir/page.html") -> str:
    out = webfetch.rewrite_html(page, url, P, O)
    return out.replace(webfetch.FRAME_JS, "<FRAME_JS>")


def test_html_base_links_resources_and_helper():
    out = rewrite(
        '<!doctype html><html><head><meta charset="utf-8"><title>T</title>'
        '<link rel="stylesheet" href="s.css" integrity="sha384-x" crossorigin="use-credentials"></head><body>'
        '<a href="/next?a=1&amp;b=2">n</a><a href="#top">top</a><a href="mailto:x@y.z">m</a>'
        '<img src="//cdn.example.net/i.png" srcset="a.png 1x, b.png 2x"><script src="app.js"></script>'
        '<form action="search"><input name="q"></form><iframe src="https://other.org/embed"></iframe>'
        '<iframe src="https://www.youtube.com/embed/abc"></iframe><a href="javascript:void 0">js</a></body></html>'
    )
    head = out.index("<head>")
    assert out[head:].startswith('<head><base href="https://example.org/dir/page.html"><script>window.__KHERVEOS_WEB__=')
    assert '"url": "https://example.org/dir/page.html"' in out and '"origin": "http://localhost:5173"' in out
    assert "<FRAME_JS>" in out
    assert f'href="{P}https/example.org/dir/s.css"' in out
    assert "integrity" not in out and 'crossorigin="anonymous"' in out
    assert f'href="{P}https/example.org/next?a=1&amp;b=2"' in out
    assert 'href="#top"' in out and 'href="mailto:x@y.z"' in out and 'href="javascript:void 0"' in out
    assert f'src="{P}https/cdn.example.net/i.png"' in out
    assert f'srcset="{P}https/example.org/dir/a.png 1x, {P}https/example.org/dir/b.png 2x"' in out
    assert f'src="{P}https/example.org/dir/app.js"' in out
    assert f'action="{P}https/example.org/dir/search"' in out
    assert f'src="{P}https/other.org/embed"' in out
    assert 'src="https://www.youtube.com/embed/abc"' in out  # players made for framing stay direct


def test_html_keeps_the_rest_as_it_was():
    page = (
        "<html><head><title>A &amp; B &#169;</title></head><body><!-- note --><p class=x>Text é</p>"
        '<script>if (a < b && c > d) document.write("</div>")</script><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></body></html>'
    )
    out = rewrite(page)
    assert "<title>A &amp; B &#169;</title>" in out
    assert "<!-- note --><p class=x>Text é</p>" in out
    assert '<script>if (a < b && c > d) document.write("</div>")</script>' in out
    assert '<svg viewBox="0 0 1 1"><path d="M0 0"/>' in out


def test_html_page_base_and_meta_tags():
    out = rewrite(
        '<html><head><base href="/docs/" target="_blank"><meta http-equiv="Content-Security-Policy" content="default-src none">'
        '<meta http-equiv="X-Frame-Options" content="deny"><meta http-equiv="refresh" content="3; url=/moved">'
        '</head><body><a href="x.html">x</a></body></html>'
    )
    assert out.count("<base ") == 1 and '<base href="https://example.org/docs/">' in out
    assert "Content-Security-Policy" not in out and "X-Frame-Options" not in out
    assert f'content="3; url={P}https/example.org/moved"' in out
    assert f'href="{P}https/example.org/docs/x.html"' in out


def test_html_without_head_or_html_tags():
    out = rewrite("<p>Just <a href='b'>a</a> fragment</p>", "https://example.org/a/")
    assert out.startswith('<base href="https://example.org/a/">')
    assert f'href="{P}https/example.org/a/b"' in out
    assert rewrite("plain text").startswith("<base ")


def test_injected_config_cannot_break_out_of_the_script():
    out = webfetch.rewrite_html("<p>x</p>", "https://example.org/</script><script>alert(1)</script>", P, O)
    config = out.split("window.__KHERVEOS_WEB__=")[1].split(";</script>")[0]
    assert "</script>" not in config and "<" not in config


def test_css_urls_and_imports():
    css = (
        "@import 'base.css'; @import url(\"/print.css\");"
        ".a{background:url(img/a.png)} .b{background:url( '//cdn.example.net/b.svg#i' )}"
        ".c{background:url(data:image/png;base64,AAAA)} .d{mask:url(#m)}"
    )
    out = webfetch.rewrite_css(css, "https://example.org/css/site.css", P)
    assert f'@import "{P}https/example.org/css/base.css"' in out
    assert f'url("{P}https/example.org/print.css")' in out
    assert f'url("{P}https/example.org/css/img/a.png")' in out
    assert f'url("{P}https/cdn.example.net/b.svg#i")' in out
    assert "url(data:image/png;base64,AAAA)" in out and "url(#m)" in out


def test_inline_styles_are_rewritten():
    out = rewrite('<div style="background:url(/bg.png)">x</div><style>p{background:url(p.png)}</style>')
    assert f"background:url(&quot;{P}https/example.org/bg.png&quot;)" in out
    assert f'p{{background:url("{P}https/example.org/dir/p.png")}}' in out


def test_served_page_is_rewritten_with_the_real_origin(web, upstream):
    r = web("https://example.org/dir/")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/html; charset=utf-8"
    assert f'href="http://testserver/api/web/f/{web.token}/https/example.org/next"' in r.text
    assert '"origin": "http://testserver"' in r.text
    assert "cookie_banner" in r.text  # the cookie-banner decliner rides along


def test_served_css_is_rewritten(web, upstream):
    upstream.respond = lambda request: reply(200, {"content-type": "text/css"}, b"body{background:url(bg.png)}")
    r = web("https://example.org/css/a.css", headers={"sec-fetch-dest": "style"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/css; charset=utf-8"
    assert f"/api/web/f/{web.token}/https/example.org/css/bg.png" in r.text


def test_charsets(web, upstream):
    upstream.respond = lambda request: reply(200, {"content-type": "text/html; charset=iso-8859-1"}, "<p>café</p>".encode("latin-1"))
    assert "café" in web("https://example.org/").text
    upstream.respond = lambda request: reply(200, {"content-type": "text/html"}, '<meta charset="windows-1252"><p>€</p>'.encode("cp1252"))
    assert "€" in web("https://example.org/").text


def test_forwarded_origin(web, upstream):
    r = web("https://example.org/", headers={"sec-fetch-dest": "iframe", "x-forwarded-proto": "https", "x-forwarded-host": "os.example.org"})
    assert '"origin": "https://os.example.org"' in r.text
    r = web("https://example.org/", headers={"sec-fetch-dest": "iframe", "x-forwarded-host": "bad host\"<"})
    assert r.status_code == 400
