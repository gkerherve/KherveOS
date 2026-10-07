"""Reference metadata lookups for KherveRef: Crossref / doi.org, arXiv, OpenLibrary.

The browser can't call these services itself everywhere (CORS, and arXiv's API
sends none), so KherveRef asks here:

    GET /api/refs/lookup?id=<DOI, arXiv id or ISBN>     whichever it is
    GET /api/refs/doi?doi=10.1038/nphys1170
    GET /api/refs/arxiv?id=2101.00001
    GET /api/refs/isbn?isbn=9780262033848
    GET /api/refs/search?title=...&author=...            Crossref, near-exact title only

Every answer is ``{"kind", "id", "source", "csl"}``: the record as CSL-JSON
(what doi.org content negotiation returns, so the app maps one format), plus
``"arxiv"`` when the record came from an arXiv id. Unknown identifiers are
404, unreachable services 502, malformed identifiers 400.

It is deliberately narrow, like the Git proxy:

* it never takes a URL: each request is built here from a validated identifier;
* only https, only the hosts in ALLOWED_HOSTS; redirects (doi.org hands
  DataCite DOIs to DataCite) are followed by hand, at most 3, and only to
  those hosts;
* 5 s to connect, 15 s per read, 30 s per lookup in all; answers over 4 MB are
  refused;
* nothing of the caller's request (cookies, headers) goes out;
* signed-in users, or a browser on this computer.

Mirrors ``kherveref/fetch.py`` of the desktop KherveRef (dev branch).
"""

from __future__ import annotations

import asyncio
import difflib
import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote, urlencode, urljoin, urlsplit

from fastapi import APIRouter, HTTPException, Request

from . import __version__, auth
from .gitproxy import _from_this_computer

try:
    import httpx
except ImportError:  # pragma: no cover - the server still starts; lookups say what is missing
    httpx = None  # type: ignore[assignment]

router = APIRouter(prefix="/api/refs", tags=["refs"])

CROSSREF = "api.crossref.org"
DOI_ORG = "doi.org"
ARXIV = "export.arxiv.org"
OPENLIBRARY = "openlibrary.org"
# doi.org content negotiation answers with a redirect to the registration
# agency's own service: Crossref or DataCite.
ALLOWED_HOSTS = frozenset({CROSSREF, DOI_ORG, "data.crossref.org", "api.datacite.org", "data.datacite.org", ARXIV, OPENLIBRARY})
MAX_REDIRECTS = 3
MAX_BYTES = 4 * 1024 * 1024
TOTAL_SECONDS = 30.0
USER_AGENT = f"KherveOS-KherveRef/{__version__} (+https://github.com/gkerherve/KherveOS)"
CSL_JSON = "application/vnd.citationstyles.csl+json"
TITLE_THRESHOLD = 0.92


class NotFound(Exception):
    """The service answered that it has no such record."""


class Unreachable(Exception):
    """No usable answer (offline, timeout, server error, too large)."""


def _client():
    if httpx is None:  # pragma: no cover
        raise HTTPException(500, "The server needs httpx for reference lookups (pip install httpx).")
    return httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0),
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT},
        trust_env=False,
    )


def _check_url(url: str) -> str:
    """The host of an allowed https URL, else ValueError."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or host not in ALLOWED_HOSTS or parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError(f"refusing to fetch {url!r}")
    return host


async def _get(url: str, accept: str = "application/json") -> bytes:
    async with _client() as client:
        for _hop in range(MAX_REDIRECTS + 1):
            try:
                host = _check_url(url)
            except ValueError:
                raise Unreachable("the service sent the lookup somewhere KherveOS does not go") from None
            try:
                async with client.stream("GET", url, headers={"Accept": accept}) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        location = r.headers.get("location")
                        if not location:
                            raise Unreachable(f"{host} answered with an empty redirect")
                        url = urljoin(url, location)
                        continue
                    if r.status_code in (400, 404, 410):
                        raise NotFound(f"{host} has no such record")
                    if r.status_code != 200:
                        raise Unreachable(f"{host} answered HTTP {r.status_code}")
                    length = r.headers.get("content-length")
                    if length and length.isdigit() and int(length) > MAX_BYTES:
                        raise Unreachable(f"{host} sent too much")
                    body = bytearray()
                    async for chunk in r.aiter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            raise Unreachable(f"{host} sent too much")
                    return bytes(body)
            except httpx.TimeoutException:
                raise Unreachable(f"{host} did not answer in time") from None
            except httpx.HTTPError:
                raise Unreachable(f"could not reach {host}") from None
    raise Unreachable("too many redirects")


def _json(data: bytes):
    try:
        return json.loads(data)
    except ValueError:
        raise Unreachable("the service sent an unreadable answer") from None


# ------------------------------------------------------------- identifiers

_DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>{}]+)", re.I)
_ARXIV_NEW = re.compile(r"^(\d{4}\.\d{4,5})(v\d+)?$")
_ARXIV_OLD = re.compile(r"^([a-z\-]+(?:\.[a-z]{2})?/\d{7})(v\d+)?$", re.I)


def clean_doi(raw: str) -> str:
    """A bare, lower-case DOI from "doi:…", "https://doi.org/…" or running text; "" if none."""
    s = re.sub(r"^\s*(https?://)?(dx\.)?doi\.org/", "", raw.strip(), flags=re.I)
    s = re.sub(r"^doi:\s*", "", s, flags=re.I)
    m = _DOI_RE.match(s)
    if not m:
        return ""
    d = m.group(1).rstrip(".,;:'\"")
    pairs = {")": "(", "]": "["}
    while d and d[-1] in pairs and d.count(d[-1]) > d.count(pairs[d[-1]]):
        d = d[:-1].rstrip(".,;:")
    if len(d) > 300 or any(seg in (".", "..") for seg in d.split("/")) or any(ord(c) < 32 for c in d):
        return ""
    return d.lower()


def clean_arxiv(raw: str) -> str:
    """"arXiv:2101.00001v2", "https://arxiv.org/abs/hep-th/9901001" → the id without version; "" if none."""
    s = re.sub(r"^\s*(https?://)?(export\.)?arxiv\.org/(abs|pdf)/", "", raw.strip(), flags=re.I)
    s = re.sub(r"^arxiv:\s*", "", s, flags=re.I)
    s = re.sub(r"\.pdf$", "", s, flags=re.I)
    m = _ARXIV_NEW.match(s) or _ARXIV_OLD.match(s)
    return m.group(1) if m else ""


def isbn_ok(s: str) -> bool:
    if len(s) == 10:
        if not (s[:9].isdigit() and (s[9].isdigit() or s[9] == "X")):
            return False
        return sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(s)) % 11 == 0
    if len(s) == 13 and s.isdigit():
        return sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s)) % 10 == 0
    return False


def clean_isbn(raw: str) -> str:
    s = re.sub(r"^\s*isbn(-1[03])?:?\s*", "", raw.strip(), flags=re.I)
    s = re.sub(r"[\s\-]", "", s).upper()
    return s if isbn_ok(s) else ""


def classify(raw: str) -> tuple[str, str]:
    """("doi" | "arxiv" | "isbn", id) for what someone typed, or ("", "")."""
    s = raw.strip()
    if not s or len(s) > 400:
        return "", ""
    a = clean_arxiv(s)
    if a and ("arxiv" in s.lower() or _ARXIV_NEW.match(s)):
        return "arxiv", a
    d = clean_doi(s)
    if d:
        return "doi", d
    i = clean_isbn(s)
    if i:
        return "isbn", i
    if a:
        return "arxiv", a
    return "", ""


# ----------------------------------------------------------------- names

_PARTICLES = {"von", "van", "der", "den", "de", "del", "della", "di", "da", "du", "dos", "das", "la", "le", "ter", "ten", "zu", "af", "al", "el", "bin", "ibn", "st.", "y"}


def csl_name(text: str) -> dict:
    """"Given von Family" or "Family, Given" as a CSL name (the desktop's parse_name)."""
    s = " ".join(text.split())
    if "," in s:
        family, _, given = s.partition(",")
        out = {"family": family.strip()}
        if given.strip():
            out["given"] = given.strip()
        return out
    words = s.split(" ")
    if len(words) <= 1:
        return {"family": s}
    start = len(words) - 1
    for i, w in enumerate(words[1:-1], start=1):
        if w.lower() in _PARTICLES and w[0].islower():
            start = i
            break
    return {"family": " ".join(words[start:]), "given": " ".join(words[:start])}


# ---------------------------------------------------------------- lookups

async def lookup_doi(doi: str) -> dict:
    """CSL-JSON for a DOI: Crossref's record, else doi.org content negotiation (DataCite…)."""
    path = quote(doi, safe="/:;()")
    try:
        msg = _json(await _get(f"https://{CROSSREF}/works/{path}")).get("message")
        if isinstance(msg, dict) and msg.get("title"):
            return {"kind": "doi", "id": doi, "source": "Crossref", "csl": msg}
    except NotFound:
        pass
    data = _json(await _get(f"https://{DOI_ORG}/{path}", CSL_JSON))
    if not isinstance(data, dict) or not data.get("title"):
        raise NotFound(f"no record for DOI {doi}")
    return {"kind": "doi", "id": doi, "source": "doi.org", "csl": data}


_ATOM = "{http://www.w3.org/2005/Atom}"
_ARXIV_NS = "{http://arxiv.org/schemas/atom}"


async def lookup_arxiv(arxiv_id: str, follow_doi: bool = True) -> dict:
    """CSL-JSON for an arXiv preprint; the journal version when arXiv knows its DOI."""
    data = await _get(f"https://{ARXIV}/api/query?{urlencode({'id_list': arxiv_id})}", "application/atom+xml")
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise Unreachable("arXiv sent an unreadable answer") from None
    entry = root.find(f"{_ATOM}entry")
    title = entry.findtext(f"{_ATOM}title") if entry is not None else None
    if entry is None or not title or "/api/errors" in (entry.findtext(f"{_ATOM}id") or ""):
        raise NotFound(f"no arXiv record {arxiv_id}")
    doi = clean_doi(entry.findtext(f"{_ARXIV_NS}doi") or "")
    if doi and follow_doi:
        try:
            found = await lookup_doi(doi)
            return {**found, "kind": "arxiv", "id": arxiv_id, "arxiv": arxiv_id}
        except (NotFound, Unreachable):
            pass
    csl: dict = {
        "type": "preprint",
        "title": " ".join(title.split()),
        "author": [csl_name(a.findtext(f"{_ATOM}name") or "") for a in entry.findall(f"{_ATOM}author")],
        "URL": f"https://arxiv.org/abs/{arxiv_id}",
        "publisher": "arXiv",
    }
    published = (entry.findtext(f"{_ATOM}published") or "")[:10]
    parts = [int(p) for p in re.findall(r"\d+", published)[:3]]
    if parts:
        csl["issued"] = {"date-parts": [parts]}
    summary = " ".join((entry.findtext(f"{_ATOM}summary") or "").split())
    if summary:
        csl["abstract"] = summary
    if doi:
        csl["DOI"] = doi
    jref = " ".join((entry.findtext(f"{_ARXIV_NS}journal_ref") or "").split())
    if jref:
        csl["note"] = jref
    return {"kind": "arxiv", "id": arxiv_id, "source": "arXiv", "arxiv": arxiv_id, "csl": csl}


async def lookup_isbn(isbn: str) -> dict:
    data = _json(await _get(f"https://{OPENLIBRARY}/api/books?{urlencode({'format': 'json', 'jscmd': 'data', 'bibkeys': f'ISBN:{isbn}'})}"))
    book = data.get(f"ISBN:{isbn}") if isinstance(data, dict) else None
    if not isinstance(book, dict) or not book.get("title"):
        raise NotFound(f"no book with ISBN {isbn}")
    csl: dict = {"type": "book", "title": book["title"], "ISBN": isbn}
    if book.get("subtitle"):
        csl["subtitle"] = book["subtitle"]
    authors = [csl_name(a.get("name", "")) for a in book.get("authors") or [] if isinstance(a, dict) and a.get("name")]
    if authors:
        csl["author"] = authors
    year = re.search(r"\d{4}", str(book.get("publish_date", "")))
    if year:
        csl["issued"] = {"date-parts": [[int(year.group(0))]]}
    pubs = [p.get("name", "") for p in book.get("publishers") or [] if isinstance(p, dict)]
    if pubs and pubs[0]:
        csl["publisher"] = pubs[0]
    places = [p.get("name", "") for p in book.get("publish_places") or [] if isinstance(p, dict)]
    if places and places[0]:
        csl["publisher-place"] = places[0]
    if book.get("url"):
        csl["URL"] = str(book["url"])
    return {"kind": "isbn", "id": isbn, "source": "OpenLibrary", "csl": csl}


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def title_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm_title(a), _norm_title(b)).ratio()


async def search_title(title: str, author: str = "") -> dict:
    """The Crossref record whose title matches almost exactly, or csl None. A loose
    match is worse than none: the wrong paper's details would go unnoticed."""
    q = urlencode({"query.bibliographic": f"{title} {author}".strip(), "rows": 5})
    data = _json(await _get(f"https://{CROSSREF}/works?{q}"))
    items = ((data or {}).get("message") or {}).get("items") or []
    best, score = None, 0.0
    for item in items:
        t = item.get("title") or [""]
        s = title_similarity(title, t[0] if isinstance(t, list) and t else str(t))
        if s > score:
            best, score = item, s
    ok = best is not None and score >= TITLE_THRESHOLD
    return {"kind": "title", "id": title, "source": "Crossref", "csl": best if ok else None, "score": round(score, 3)}


# --------------------------------------------------------------- endpoints

def _check_access(request: Request) -> None:
    if _from_this_computer(request):
        return
    try:
        auth.current_user(request)
    except HTTPException as exc:
        raise HTTPException(401, "Sign in to KherveOS to look references up online.") from exc


async def _run(coro):
    try:
        return await asyncio.wait_for(coro, TOTAL_SECONDS)
    except NotFound as e:
        raise HTTPException(404, str(e)) from None
    except Unreachable as e:
        raise HTTPException(502, f"Lookup failed: {e}.") from None
    except asyncio.TimeoutError:
        raise HTTPException(502, "Lookup failed: the service took too long.") from None


@router.get("/lookup")
async def lookup(id: str, request: Request):
    _check_access(request)
    kind, value = classify(id)
    if kind == "doi":
        return await _run(lookup_doi(value))
    if kind == "arxiv":
        return await _run(lookup_arxiv(value))
    if kind == "isbn":
        return await _run(lookup_isbn(value))
    raise HTTPException(400, "That is not a DOI, an arXiv id or an ISBN.")


@router.get("/doi")
async def doi(doi: str, request: Request):
    _check_access(request)
    value = clean_doi(doi)
    if not value:
        raise HTTPException(400, "That is not a DOI (they look like 10.1038/nphys1170).")
    return await _run(lookup_doi(value))


@router.get("/arxiv")
async def arxiv(id: str, request: Request):
    _check_access(request)
    value = clean_arxiv(id)
    if not value:
        raise HTTPException(400, "That is not an arXiv id (they look like 2101.00001 or hep-th/9901001).")
    return await _run(lookup_arxiv(value))


@router.get("/isbn")
async def isbn(isbn: str, request: Request):
    _check_access(request)
    value = clean_isbn(isbn)
    if not value:
        raise HTTPException(400, "That is not a valid ISBN.")
    return await _run(lookup_isbn(value))


@router.get("/search")
async def search(title: str, request: Request, author: str = ""):
    _check_access(request)
    title = " ".join(title.split())
    if len(_norm_title(title)) < 15 or len(title) > 500 or len(author) > 200:
        raise HTTPException(400, "Give a title of 15 to 500 characters.")
    return await _run(search_title(title, " ".join(author.split())))
