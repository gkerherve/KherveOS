"""The LaTeX service: request checks, access rules, and real tectonic compiles.

The compile tests are skipped when tectonic is not installed. The first real
compile on a machine downloads TeX packages, so they get a generous timeout.
"""

import base64

import pytest
from conftest import make_user
from fastapi.testclient import TestClient

from kherveos_server import latex

HAVE_TECTONIC = latex.engine() is not None
needs_tectonic = pytest.mark.skipif(not HAVE_TECTONIC, reason="tectonic is not installed")
needs_sandbox = pytest.mark.skipif(
    not HAVE_TECTONIC or latex.sandbox_kind() != "sandbox-exec", reason="needs tectonic and sandbox-exec (macOS)"
)

HELLO = r"""\documentclass{article}
\begin{document}
Hello, KherveOS! $E = mc^2$.
\end{document}
"""


@pytest.fixture()
def local(client):
    """A client calling from 127.0.0.1, like a browser on this computer (`client` calls from elsewhere)."""
    from kherveos_server.app import app

    return TestClient(app, client=("127.0.0.1", 50000))


@pytest.fixture()
def slow_ok(monkeypatch):
    """Room for the first compile on a machine, which downloads packages."""
    monkeypatch.setattr(latex, "TIMEOUT", 900.0)


def job(text=HELLO, **extra):
    files = {"document.tex": {"text": text}}
    files.update(extra)
    return {"main": "document.tex", "files": files}


# ------------------------------------------------------------------- access


def test_needs_sign_in_from_elsewhere(client):
    r = client.post("/api/latex/compile", json=job())
    assert r.status_code == 401
    assert client.get("/api/latex/status").status_code == 401


def test_status_from_this_computer(local):
    r = local.get("/api/latex/status")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is HAVE_TECTONIC
    if HAVE_TECTONIC:
        assert "ectonic" in body["engine"]


def test_signed_in_user_from_elsewhere(client, monkeypatch):
    make_user(client)
    monkeypatch.setattr(latex, "compile_files", lambda main, files: latex.Result(True, "fake log", [], b"%PDF-fake"))
    monkeypatch.setattr(latex, "engine", lambda: latex._Engine("tectonic", "Tectonic test", None))
    monkeypatch.setattr(latex, "sandbox_kind", lambda: "sandbox-exec")
    r = client.post("/api/latex/compile", json=job())
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    assert base64.b64decode(r.json()["pdf"]) == b"%PDF-fake"


def test_no_sandbox_means_this_computer_only(client, local, monkeypatch):
    make_user(client)
    monkeypatch.setattr(latex, "compile_files", lambda main, files: latex.Result(True, "", [], b"%PDF"))
    monkeypatch.setattr(latex, "engine", lambda: latex._Engine("tectonic", "Tectonic test", None))
    monkeypatch.setattr(latex, "sandbox_kind", lambda: None)
    monkeypatch.delenv("KHERVEOS_LATEX_SANDBOX", raising=False)
    assert client.post("/api/latex/compile", json=job()).status_code == 503
    assert local.post("/api/latex/compile", json=job()).status_code == 200
    monkeypatch.setenv("KHERVEOS_LATEX_SANDBOX", "off")
    assert client.post("/api/latex/compile", json=job()).status_code == 200


def test_tectonic_missing(local, monkeypatch):
    monkeypatch.setattr(latex, "_find_tectonic", lambda: None)
    r = local.post("/api/latex/compile", json=job())
    assert r.status_code == 503
    assert local.get("/api/latex/status").json()["available"] is False


# ------------------------------------------------------------- the request


@pytest.mark.parametrize(
    "name",
    ["/etc/passwd", "../up.tex", "a/../../b.tex", "a//b.tex", "./a.tex", "a\\b.tex", "", "~/x.tex",
     "C:/x.tex", "bad\x00name.tex", "a/./b.tex"],
)
def test_rejects_unsafe_paths(local, monkeypatch, name):
    monkeypatch.setattr(latex, "engine", lambda: latex._Engine("tectonic", "Tectonic test", None))
    body = {"main": "document.tex", "files": {"document.tex": {"text": HELLO}, name: {"text": "x"}}}
    r = local.post("/api/latex/compile", json=body)
    assert r.status_code == 400, (name, r.text)


@pytest.mark.parametrize(
    "body",
    [
        {"main": "document.tex"},
        {"main": "document.tex", "files": []},
        {"main": "missing.tex", "files": {"document.tex": {"text": HELLO}}},
        {"main": "document.pdf", "files": {"document.pdf": {"text": HELLO}}},
        {"main": "document.tex", "files": {"document.tex": {"base64": "%%% not base64"}}},
        {"main": "document.tex", "files": {"document.tex": "just a string"}},
        {"main": "document.tex", "files": {"document.tex": {"text": HELLO}, "a": {"text": "x"}, "a/b.png": {"text": "y"}}},
    ],
)
def test_rejects_bad_requests(local, monkeypatch, body):
    monkeypatch.setattr(latex, "engine", lambda: latex._Engine("tectonic", "Tectonic test", None))
    assert local.post("/api/latex/compile", json=body).status_code == 400


def test_size_limits(local, monkeypatch):
    monkeypatch.setattr(latex, "engine", lambda: latex._Engine("tectonic", "Tectonic test", None))
    monkeypatch.setattr(latex, "MAX_TOTAL_BYTES", 1000)
    big = {"main": "document.tex", "files": {"document.tex": {"text": HELLO}, "big.txt": {"text": "x" * 2000}}}
    assert local.post("/api/latex/compile", json=big).status_code == 413
    monkeypatch.setattr(latex, "MAX_REQUEST_BYTES", 100)
    assert local.post("/api/latex/compile", json=job()).status_code == 413
    assert local.post("/api/latex/compile", content=b"{not json").status_code in (400, 413)


def test_parse_job_decodes_files():
    main, files = latex.parse_job(
        {"main": "document.tex", "files": {"document.tex": {"text": "é"}, "figures/a.png": {"base64": "AAEC"}}}
    )
    assert main == "document.tex"
    assert files == {"document.tex": "é".encode(), "figures/a.png": b"\x00\x01\x02"}


# --------------------------------------------------------- helper functions


def test_missing_images_become_placeholders():
    tex = (r"\includegraphics[width=3cm]{figures/a.png} \includegraphics{figures/b} "
           r"\includegraphics{/abs/c.png} \includegraphics{gone_1.png} \includegraphics{\figdir/x}")
    out = latex.mark_missing_images(tex, {"figures/a.png", "figures/b.pdf"}, "", [""])
    assert r"\includegraphics[width=3cm]{figures/a.png}" in out
    assert r"\includegraphics{figures/b}" in out
    assert r"[missing image: /abs/c.png]" in out
    assert r"[missing image: gone\_1.png]" in out
    assert r"\includegraphics{\figdir/x}" in out


def test_graphicspath_is_honoured():
    tex = r"\graphicspath{{figures/}{img/}}\includegraphics{a.png}"
    dirs = latex._graphics_dirs([tex])
    assert latex.mark_missing_images(tex, {"img/a.png"}, "", dirs) == tex


def test_parse_errors_from_tectonic_output():
    out = (
        "note: Running TeX ...\n"
        "error: document.tex:3: Undefined control sequence\n"
        "error: document.tex:3: Undefined control sequence\n"
        "error: ./chap.tex:7: ! LaTeX Error: File `zzz.sty' not found.\n"
        "error: !Emergency stop\n"
        "error: something bad happened inside XeTeX; its output follows:\n"
    )
    assert latex.parse_errors(out) == [
        {"message": "Undefined control sequence", "line": 3, "file": "document.tex"},
        {"message": "LaTeX Error: File `zzz.sty' not found.", "line": 7, "file": "chap.tex"},
        {"message": "Emergency stop"},
    ]


def test_parse_errors_falls_back_to_the_tex_log():
    log = "(document.tex\n! Missing $ inserted.\n<inserted text>\n                $\nl.12 a_b\n"
    assert latex.parse_errors("", log) == [{"message": "Missing $ inserted.", "line": 12}]


def test_escapes_are_detected(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    out = (f"warning: accessing absolute path `/etc/hosts`; build may not be reproducible\n"
           f"note: Writing `{work}/document.pdf` (3 KiB)\n"
           f"note: Writing `{tmp_path}/evil.txt` (8 B)\n"
           "note: Writing `../escape.txt` (8 B)\n")
    found = latex._escapes(out, "(./document.tex (../secret.txt)", work)
    assert "/etc/hosts" in found
    assert f"{tmp_path}/evil.txt" in found
    assert "../escape.txt" in found
    assert "../secret.txt" in found
    assert not any("document.pdf" in f for f in found)


def test_bwrap_jail_only_writes_build_folder_and_cache(tmp_path):
    eng = latex._Engine("/usr/bin/tectonic", "Tectonic test", tmp_path / "cache")
    cmd = latex.bwrap_command(tmp_path / "work", eng)
    assert cmd[0] == "bwrap" and "--unshare-all" in cmd and "--share-net" in cmd
    writable = [cmd[i + 1] for i, a in enumerate(cmd) if a in ("--bind", "--bind-try")]
    assert sorted(writable) == sorted([latex._real(tmp_path / "work"), latex._real(tmp_path / "cache")])
    assert not any(a == "--bind" and cmd[i + 1].startswith("/home") for i, a in enumerate(cmd))
    assert cmd[-2:] == ["--chdir", latex._real(tmp_path / "work")]


# ------------------------------------------------------------ real compiles


@needs_tectonic
def test_compiles_a_pdf(local, slow_ok):
    r = local.post("/api/latex/compile", json=job())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True, body["log"]
    assert base64.b64decode(body["pdf"]).startswith(b"%PDF")
    assert body["errors"] == []


@needs_tectonic
def test_reports_errors_with_line_numbers(local, slow_ok):
    bad = "\\documentclass{article}\n\\begin{document}\nHello \\nosuchmacro{x}.\n\\textbf{unclosed\n\\end{document}\n"
    body = local.post("/api/latex/compile", json=job(bad)).json()
    assert body["ok"] is False
    assert "pdf" not in body
    assert {"message": "Undefined control sequence", "line": 3, "file": "document.tex"} in body["errors"]
    assert body["log"]


@needs_tectonic
def test_recoverable_errors_still_give_a_pdf(local, slow_ok):
    text = "\\documentclass{article}\n\\begin{document}\nHello \\nosuchmacro{x} world.\n\\end{document}\n"
    body = local.post("/api/latex/compile", json=job(text)).json()
    assert body["ok"] is True
    assert body["errors"][0]["line"] == 3


@needs_tectonic
def test_figures_and_missing_figures(local, slow_ok):
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    text = ("\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n"
            "\\includegraphics[width=2cm]{figures/figure_001.png}\n"
            "\\includegraphics[width=2cm]{figures/not_sent.png}\n\\end{document}\n")
    body = local.post(
        "/api/latex/compile",
        json=job(text, **{"figures/figure_001.png": {"base64": base64.b64encode(png).decode()}}),
    ).json()
    assert body["ok"] is True, body["log"]
    assert base64.b64decode(body["pdf"]).startswith(b"%PDF")


@needs_sandbox
def test_documents_cannot_reach_outside_their_folder(local, slow_ok, tmp_path, monkeypatch):
    """tectonic itself follows absolute and ../ paths; the sandbox must stop it."""
    box = tmp_path / "box"  # the conftest keeps its database in tmp_path
    root = box / "builds"
    root.mkdir(parents=True)
    secret = box / "secret.txt"
    secret.write_text("TOPSECRET")
    real_compile = latex.compile_files
    monkeypatch.setattr(latex, "compile_files", lambda main, files: real_compile(main, files, build_root=str(root)))
    attempts = [
        "\\input{../../secret.txt}",
        f"\\input{{{secret}}}",
        "\\newwrite\\f\\immediate\\openout\\f=../escape.txt\\immediate\\write\\f{x}\\immediate\\closeout\\f",
        f"\\newwrite\\f\\immediate\\openout\\f={box}/abs.txt\\immediate\\write\\f{{x}}\\immediate\\closeout\\f",
    ]
    for attempt in attempts:
        text = f"\\documentclass{{article}}\n\\begin{{document}}\nHi {attempt}\n\\end{{document}}\n"
        body = local.post("/api/latex/compile", json=job(text)).json()
        assert "TOPSECRET" not in body["log"], attempt
        if body["ok"]:
            assert b"TOPSECRET" not in base64.b64decode(body["pdf"]), attempt
    assert sorted(p.name for p in box.iterdir()) == ["builds", "secret.txt"]
    assert list(root.iterdir()) == []  # build folders are cleaned up
