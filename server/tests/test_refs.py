"""KherveRef's metadata lookups, against fake Crossref / doi.org / arXiv / OpenLibrary
services (an httpx MockTransport): no network."""

import asyncio
import json

import httpx
import pytest
from conftest import make_user
from fastapi.testclient import TestClient

from kherveos_server import refs

CROSSREF_WORK = {
    "status": "ok",
    "message": {
        "DOI": "10.1038/nphys1170",
        "type": "journal-article",
        "title": ["Measured measurement"],
        "container-title": ["Nature Physics"],
        "author": [{"given": "Markus", "family": "Aspelmeyer"}],
        "issued": {"date-parts": [[2009, 4]]},
        "volume": "5",
        "page": "11-12",
    },
}

ARXIV_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2101.00001v1</id>
    <published>2021-01-01T00:00:00Z</published>
    <title>A  preprint
      about things</title>
    <summary>  It is about
      things. </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Ludwig van Beethoven</name></author>
    {doi}
  </entry>
</feed>"""

ARXIV_ERROR = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id>
<title>Error</title></entry></feed>"""

OPENLIBRARY = {
    "ISBN:9780262033848": {
        "title": "Introduction to Algorithms",
        "authors": [{"name": "Thomas H. Cormen"}, {"name": "Charles E. Leiserson"}],
        "publish_date": "2009",
        "publishers": [{"name": "MIT Press"}],
        "publish_places": [{"name": "Cambridge, Mass"}],
    }
}


class Fake:
    """Records the requests that would leave the server and answers them with `routes`."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        for prefix, answer in self.routes.items():
            if url.startswith(prefix):
                return answer(request) if callable(answer) else answer
        return httpx.Response(404, text="not found")

    @property
    def hosts(self) -> list[str]:
        return [r.url.host for r in self.requests]


@pytest.fixture()
def fake(monkeypatch):
    f = Fake()
    monkeypatch.setattr(
        refs,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(f.handler), follow_redirects=False, headers={"User-Agent": refs.USER_AGENT}),
    )
    return f


@pytest.fixture()
def local(client):
    """A browser on this computer (the plain `client` calls from elsewhere)."""
    from kherveos_server.app import app

    return TestClient(app, client=("127.0.0.1", 50000))


# ------------------------------------------------------------ identifiers

def test_identifiers_are_recognised():
    assert refs.classify("10.1038/NPHYS1170") == ("doi", "10.1038/nphys1170")
    assert refs.classify("https://doi.org/10.1038/nphys1170.") == ("doi", "10.1038/nphys1170")
    assert refs.classify("doi: 10.1000/xyz(123)") == ("doi", "10.1000/xyz(123)")
    assert refs.classify("10.1000/abc)") == ("doi", "10.1000/abc")
    assert refs.classify("arXiv:2101.00001v2") == ("arxiv", "2101.00001")
    assert refs.classify("2101.00001") == ("arxiv", "2101.00001")
    assert refs.classify("https://arxiv.org/abs/hep-th/9901001") == ("arxiv", "hep-th/9901001")
    assert refs.classify("ISBN 978-0-262-03384-8") == ("isbn", "9780262033848")
    assert refs.classify("0-306-40615-2") == ("isbn", "0306406152")
    assert refs.classify("978-0-262-03384-9") == ("", "")  # bad check digit
    assert refs.classify("hello world") == ("", "")
    assert refs.classify("") == ("", "")


def test_dois_that_could_walk_the_api_are_refused():
    assert refs.clean_doi("10.1000/../../members") == ""
    assert refs.clean_doi("10.1000/./x") == ""
    assert refs.clean_doi("10.1000/" + "a" * 400) == ""


def test_names_split_like_the_desktop():
    assert refs.csl_name("Ada Lovelace") == {"family": "Lovelace", "given": "Ada"}
    assert refs.csl_name("Ludwig van Beethoven") == {"family": "van Beethoven", "given": "Ludwig"}
    assert refs.csl_name("Curie, Marie") == {"family": "Curie", "given": "Marie"}
    assert refs.csl_name("Plato") == {"family": "Plato"}


def test_only_allowed_https_hosts():
    assert refs._check_url("https://api.crossref.org/works/x") == "api.crossref.org"
    for bad in (
        "http://api.crossref.org/works/x",
        "https://evil.example/works",
        "https://api.crossref.org.evil.example/",
        "https://user@api.crossref.org/",
        "https://api.crossref.org:8443/",
        "https://127.0.0.1/",
        "file:///etc/passwd",
    ):
        with pytest.raises(ValueError):
            refs._check_url(bad)


# ---------------------------------------------------------------- lookups

def test_doi_from_crossref(local, fake):
    fake.routes["https://api.crossref.org/works/10.1038/nphys1170"] = httpx.Response(200, json=CROSSREF_WORK)
    r = local.get("/api/refs/lookup", params={"id": "https://doi.org/10.1038/NPHYS1170"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "doi" and body["id"] == "10.1038/nphys1170" and body["source"] == "Crossref"
    assert body["csl"]["title"] == ["Measured measurement"]
    assert fake.hosts == ["api.crossref.org"]
    sent = fake.requests[0]
    assert sent.headers["user-agent"].startswith("KherveOS-KherveRef/")
    assert "cookie" not in sent.headers


def test_doi_not_at_crossref_goes_through_doi_org_and_its_redirect(local, fake):
    datacite = {"type": "dataset", "title": "Some data", "DOI": "10.5281/zenodo.1"}
    fake.routes["https://doi.org/10.5281/zenodo.1"] = httpx.Response(302, headers={"location": "https://data.datacite.org/x/10.5281/zenodo.1"})
    fake.routes["https://data.datacite.org/"] = lambda req: httpx.Response(200, json=datacite) if "csl+json" in req.headers["accept"] else httpx.Response(406)
    r = local.get("/api/refs/doi", params={"doi": "10.5281/zenodo.1"})
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "doi.org" and r.json()["csl"]["title"] == "Some data"
    assert fake.hosts == ["api.crossref.org", "doi.org", "data.datacite.org"]


def test_redirect_to_another_host_is_not_followed(local, fake):
    fake.routes["https://doi.org/"] = httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
    r = local.get("/api/refs/doi", params={"doi": "10.1234/abc"})
    assert r.status_code == 502
    assert "169.254.169.254" not in fake.hosts


def test_redirect_loops_stop(local, fake):
    fake.routes["https://doi.org/"] = httpx.Response(302, headers={"location": "https://doi.org/10.1234/abc"})
    r = local.get("/api/refs/doi", params={"doi": "10.1234/abc"})
    assert r.status_code == 502 and "redirect" in r.json()["detail"]
    assert fake.hosts.count("doi.org") == refs.MAX_REDIRECTS + 1


def test_unknown_doi_is_404(local, fake):
    r = local.get("/api/refs/doi", params={"doi": "10.1234/nothing"})
    assert r.status_code == 404


def test_bad_identifiers_are_400_without_any_request(local, fake):
    assert local.get("/api/refs/doi", params={"doi": "not a doi"}).status_code == 400
    assert local.get("/api/refs/arxiv", params={"id": "nope"}).status_code == 400
    assert local.get("/api/refs/isbn", params={"isbn": "1234"}).status_code == 400
    assert local.get("/api/refs/lookup", params={"id": "https://evil.example/"}).status_code == 400
    assert local.get("/api/refs/search", params={"title": "short"}).status_code == 400
    assert fake.requests == []


def test_arxiv_preprint(local, fake):
    fake.routes["https://export.arxiv.org/api/query"] = httpx.Response(200, text=ARXIV_ATOM.replace("{doi}", ""))
    r = local.get("/api/refs/lookup", params={"id": "arXiv:2101.00001v3"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["arxiv"] == "2101.00001"
    csl = body["csl"]
    assert csl["type"] == "preprint" and csl["title"] == "A preprint about things"
    assert csl["author"] == [{"family": "Lovelace", "given": "Ada"}, {"family": "van Beethoven", "given": "Ludwig"}]
    assert csl["issued"] == {"date-parts": [[2021, 1, 1]]}
    assert csl["abstract"] == "It is about things."
    assert csl["URL"] == "https://arxiv.org/abs/2101.00001"
    assert fake.requests[0].url.params["id_list"] == "2101.00001"


def test_arxiv_with_a_doi_gives_the_journal_version(local, fake):
    fake.routes["https://export.arxiv.org/"] = httpx.Response(200, text=ARXIV_ATOM.replace("{doi}", "<arxiv:doi>10.1038/nphys1170</arxiv:doi>"))
    fake.routes["https://api.crossref.org/works/10.1038/nphys1170"] = httpx.Response(200, json=CROSSREF_WORK)
    body = local.get("/api/refs/arxiv", params={"id": "2101.00001"}).json()
    assert body["kind"] == "arxiv" and body["arxiv"] == "2101.00001"
    assert body["csl"]["container-title"] == ["Nature Physics"]


def test_arxiv_error_feed_is_404(local, fake):
    fake.routes["https://export.arxiv.org/"] = httpx.Response(200, text=ARXIV_ERROR)
    assert local.get("/api/refs/arxiv", params={"id": "2101.99999"}).status_code == 404


def test_isbn_from_openlibrary(local, fake):
    fake.routes["https://openlibrary.org/api/books"] = httpx.Response(200, json=OPENLIBRARY)
    body = local.get("/api/refs/lookup", params={"id": "978-0-262-03384-8"}).json()
    csl = body["csl"]
    assert body["kind"] == "isbn" and csl["type"] == "book"
    assert csl["author"][0] == {"family": "Cormen", "given": "Thomas H."}
    assert csl["publisher"] == "MIT Press" and csl["publisher-place"] == "Cambridge, Mass"
    assert csl["issued"] == {"date-parts": [[2009]]}
    fake.routes["https://openlibrary.org/api/books"] = httpx.Response(200, json={})
    assert local.get("/api/refs/isbn", params={"isbn": "0306406152"}).status_code == 404


def test_title_search_needs_a_near_exact_match(local, fake):
    items = [{"title": ["Deep residual learning for image recognition"], "DOI": "10.1109/cvpr.2016.90", "type": "proceedings-article"}]
    fake.routes["https://api.crossref.org/works?"] = httpx.Response(200, json={"message": {"items": items}})
    good = local.get("/api/refs/search", params={"title": "Deep Residual Learning for Image Recognition", "author": "He"}).json()
    assert good["csl"]["DOI"] == "10.1109/cvpr.2016.90" and good["score"] == 1.0
    assert fake.requests[-1].url.params["query.bibliographic"] == "Deep Residual Learning for Image Recognition He"
    loose = local.get("/api/refs/search", params={"title": "Shallow learning for speech recognition"}).json()
    assert loose["csl"] is None


def test_network_errors_and_timeouts_are_502(local, fake):
    def boom(request):
        raise httpx.ConnectError("offline", request=request)

    fake.routes["https://api.crossref.org/"] = boom
    r = local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"})
    assert r.status_code == 502 and "api.crossref.org" in r.json()["detail"]

    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    fake.routes["https://api.crossref.org/"] = slow
    r = local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"})
    assert r.status_code == 502 and "in time" in r.json()["detail"]


def test_total_time_is_capped(local, monkeypatch):
    async def never(_doi):
        await asyncio.sleep(10)

    monkeypatch.setattr(refs, "TOTAL_SECONDS", 0.05)
    monkeypatch.setattr(refs, "lookup_doi", never)
    r = local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"})
    assert r.status_code == 502 and "too long" in r.json()["detail"]


def test_oversized_answers_are_refused(local, fake, monkeypatch):
    monkeypatch.setattr(refs, "MAX_BYTES", 100)
    fake.routes["https://api.crossref.org/"] = httpx.Response(200, content=json.dumps({"message": {"title": ["x" * 500]}}).encode())
    r = local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"})
    assert r.status_code == 502 and "too much" in r.json()["detail"]


def test_unreadable_answers_are_502(local, fake):
    fake.routes["https://api.crossref.org/"] = httpx.Response(200, text="<html>oops</html>")
    assert local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"}).status_code == 502


# ----------------------------------------------------------------- access

def test_strangers_must_sign_in(client, fake):
    fake.routes["https://api.crossref.org/works/10.1038/nphys1170"] = httpx.Response(200, json=CROSSREF_WORK)
    r = client.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"})
    assert r.status_code == 401 and fake.requests == []
    make_user(client)
    assert client.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"}).status_code == 200


def test_another_sites_page_on_this_computer_is_refused(local, fake):
    r = local.get("/api/refs/doi", params={"doi": "10.1038/nphys1170"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 401 and fake.requests == []
