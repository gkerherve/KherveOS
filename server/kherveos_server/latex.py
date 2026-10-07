"""LaTeX compilation with tectonic, for KherveTeX, KherveSlide and KherveNote.

    POST /api/latex/compile
        {"main": "document.tex",
         "files": {"document.tex": {"text": "..."},
                   "figures/figure_001.png": {"base64": "..."}}}
        -> {"ok": true,  "pdf": "<base64>", "log": "...", "errors": [...]}
        -> {"ok": false, "log": "...", "errors": [{"line": 12, "file": "document.tex", "message": "..."}]}
        A document that does not compile is still a 200: the caller shows the log.
        400 bad request (paths, base64...), 401 not signed in, 413 too big,
        503 tectonic missing / busy / no sandbox for a remote request.
    GET  /api/latex/status
        -> {"available": bool, "engine": "Tectonic 0.17.0" | null, "sandbox": "sandbox-exec" | "bwrap" | null}

Like games.py, a request from this computer needs no account; from anywhere
else it needs a signed-in user.

How a compile runs. The files are written into a fresh temporary folder
(their paths must be relative, without ".." — anything else is refused) and
tectonic runs there with --untrusted (no shell escape) under a time limit,
first from its package cache only and, when a package or font is missing,
once more online — the way the desktop KherveTeX compiles.

TeX can still read and write any file the server can: tectonic follows
absolute and "../" paths in \\input and \\openout even when untrusted. So
tectonic runs in an OS sandbox that only lets it write into its folder and
its package cache, and hides the home folders, the server's data and other
temporary folders from it: sandbox-exec on macOS, bubblewrap (bwrap) on
Linux (that one is untested so far). Without a sandbox, compiles are only
accepted from this computer, unless KHERVEOS_LATEX_SANDBOX=off says to
accept the risk. Either way, a run that reports reading or writing outside
its folder gets no PDF and no log back.

Environment: KHERVEOS_TECTONIC (the tectonic binary), KHERVEOS_LATEX_TIMEOUT
(seconds, default 90), KHERVEOS_LATEX_JOBS (compiles at a time, default 2),
KHERVEOS_LATEX_SANDBOX ("auto" or "off").
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from . import auth, config
from .games import _from_this_computer

router = APIRouter(prefix="/api/latex", tags=["latex"])

TIMEOUT = float(os.environ.get("KHERVEOS_LATEX_TIMEOUT") or 90)  # seconds for the whole compile
MAX_REQUEST_BYTES = 64 * 1024 * 1024  # the JSON body (base64 adds a third)
MAX_FILES = 500
MAX_FILE_BYTES = 30 * 1024 * 1024
MAX_TOTAL_BYTES = 45 * 1024 * 1024
MAX_PATH = 240
MAX_PDF_BYTES = 80 * 1024 * 1024
MAX_LOG_CHARS = 400_000
MAX_ERRORS = 100
QUEUE_WAIT = 60.0  # seconds a request waits for a free compile slot

_jobs = threading.BoundedSemaphore(max(1, int(os.environ.get("KHERVEOS_LATEX_JOBS") or 2)))

# The images graphicx tries when \includegraphics names a file without extension.
_GRAPHIC_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".eps", ".PDF", ".PNG", ".JPG", ".JPEG", ".EPS")

# --------------------------------------------------------------------- tectonic


@dataclass
class _Engine:
    path: str
    version: str
    cache_dir: Path | None


_engine: _Engine | None = None
_engine_lock = threading.Lock()


def _find_tectonic() -> str | None:
    env = os.environ.get("KHERVEOS_TECTONIC")
    if env:
        return env if Path(env).is_file() else None
    found = shutil.which("tectonic")
    if found:
        return found
    for c in (
        Path("/opt/homebrew/bin/tectonic"),
        Path("/usr/local/bin/tectonic"),
        Path.home() / ".cargo" / "bin" / "tectonic",
        Path.home() / "bin" / "tectonic",
    ):
        if c.is_file():
            return str(c)
    return None


def _default_cache_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "TectonicProject.Tectonic"
    base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    return base / "Tectonic"


def engine() -> _Engine | None:
    """The tectonic binary, its version and its package cache (looked up once)."""
    global _engine
    with _engine_lock:
        path = _find_tectonic()
        if path is None:
            return None
        if _engine is not None and _engine.path == path:
            return _engine
        version = "tectonic"
        cache: Path | None = None
        try:
            out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=15)
            version = (out.stdout or out.stderr).strip().splitlines()[0] or version
        except (OSError, subprocess.SubprocessError, IndexError):
            pass
        try:
            out = subprocess.run(
                [path, "-X", "show", "user-cache-dir"], capture_output=True, text=True, timeout=15
            )
            lines = out.stdout.strip().splitlines()
            if out.returncode == 0 and lines:
                cache = Path(lines[-1].strip())
        except (OSError, subprocess.SubprocessError):
            pass
        cache = cache or _default_cache_dir()
        if cache.name == "bundles":  # formats/ etc. sit beside bundles/
            cache = cache.parent
        _engine = _Engine(path, version, cache)
        return _engine


# ---------------------------------------------------------------------- sandbox

_SEATBELT_PROFILE = """\
(version 1)
(allow default)
(deny process-fork)
(deny file-write*)
(allow file-write*
  (subpath (param "WORK"))
  (subpath (param "CACHE"))
  (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper")
  (regex #"^/dev/fd/"))
(deny file-read*
  (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders")
  (subpath (param "HOME")) (subpath (param "DATA")) (subpath (param "SERVER")))
(allow file-read*
  (subpath (param "WORK"))
  (subpath (param "CACHE"))
  (subpath (param "ENGINE")))
"""


def sandbox_mode() -> str:
    return (os.environ.get("KHERVEOS_LATEX_SANDBOX") or "auto").strip().lower()


def sandbox_kind() -> str | None:
    """The OS sandbox tectonic runs in: "sandbox-exec", "bwrap" or None."""
    if sandbox_mode() == "off":
        return None
    if sys.platform == "darwin" and Path("/usr/bin/sandbox-exec").is_file():
        return "sandbox-exec"
    if sys.platform.startswith("linux") and shutil.which("bwrap"):
        return "bwrap"
    return None


def _real(p: Path | str) -> str:
    return os.path.realpath(str(p))


def seatbelt_command(work: Path, eng: _Engine) -> list[str]:
    params = {
        "WORK": _real(work),
        "CACHE": _real(eng.cache_dir or _default_cache_dir()),
        "HOME": _real(Path.home()),
        "DATA": _real(config.DATA_DIR),
        "SERVER": _real(config.SERVER_DIR),
        "ENGINE": _real(Path(_real(eng.path)).parent),
    }
    cmd = ["/usr/bin/sandbox-exec", "-p", _SEATBELT_PROFILE]
    for k, v in params.items():
        cmd += ["-D", f"{k}={v}"]
    return cmd


def bwrap_command(work: Path, eng: _Engine, bwrap: str = "bwrap") -> list[str]:
    """A bubblewrap jail: the system read-only, a private /tmp, no home
    folders, write access only to the build folder and tectonic's cache."""
    cmd = [
        bwrap, "--die-with-parent", "--new-session", "--unshare-all", "--share-net",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    ]
    for d in (
        "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/opt", "/nix/store",
        "/etc/ssl", "/etc/pki", "/etc/ca-certificates", "/etc/resolv.conf", "/etc/hosts",
        "/etc/nsswitch.conf", "/etc/fonts", "/etc/ld.so.cache", "/etc/localtime",
    ):
        cmd += ["--ro-bind-try", d, d]
    engine_dir = str(Path(_real(eng.path)).parent)
    cmd += ["--ro-bind-try", engine_dir, engine_dir]
    cache = _real(eng.cache_dir or _default_cache_dir())
    cmd += ["--bind-try", cache, cache]
    w = _real(work)
    cmd += ["--bind", w, w, "--chdir", w]
    return cmd


# ------------------------------------------------------------------ the request


class BadRequest(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def check_path(name: object) -> str:
    """A file name from the request, as a clean relative POSIX path."""
    if not isinstance(name, str) or not name.strip():
        raise BadRequest("Every file needs a name.")
    if len(name) > MAX_PATH:
        raise BadRequest(f"File name too long: {name[:60]}…")
    if any(ord(c) < 32 or c == "\x7f" for c in name) or "\\" in name:
        raise BadRequest(f"Invalid file name: {name!r}")
    if name.startswith("/") or name.startswith("~") or re.match(r"^[A-Za-z]:", name):
        raise BadRequest(f"File names must be relative: {name!r}")
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise BadRequest(f"File names may not contain '..', '.' or empty parts: {name!r}")
    if len(parts) > 12:
        raise BadRequest(f"Folders nested too deep: {name!r}")
    return name


def parse_job(payload: object) -> tuple[str, dict[str, bytes]]:
    """(main file, {path: bytes}) from the request body, validated."""
    if not isinstance(payload, dict):
        raise BadRequest("Send a JSON object with 'main' and 'files'.")
    files_in = payload.get("files")
    if not isinstance(files_in, dict) or not files_in:
        raise BadRequest("'files' must map file names to {text} or {base64}.")
    if len(files_in) > MAX_FILES:
        raise BadRequest(f"Too many files (at most {MAX_FILES}).", 413)
    files: dict[str, bytes] = {}
    total = 0
    for raw_name, spec in files_in.items():
        name = check_path(raw_name)
        if not isinstance(spec, dict):
            raise BadRequest(f"{name}: expected {{\"text\": ...}} or {{\"base64\": ...}}.")
        if isinstance(spec.get("text"), str):
            data = spec["text"].encode("utf-8")
        elif isinstance(spec.get("base64"), str):
            try:
                data = base64.b64decode(spec["base64"], validate=True)
            except (binascii.Error, ValueError):
                raise BadRequest(f"{name}: invalid base64.") from None
        else:
            raise BadRequest(f"{name}: expected {{\"text\": ...}} or {{\"base64\": ...}}.")
        if len(data) > MAX_FILE_BYTES:
            raise BadRequest(f"{name} is too big (at most {MAX_FILE_BYTES // 2**20} MB).", 413)
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise BadRequest(f"The files are too big together (at most {MAX_TOTAL_BYTES // 2**20} MB).", 413)
        files[name] = data
    main = payload.get("main", "document.tex")
    main = check_path(main)
    if not main.lower().endswith(".tex"):
        raise BadRequest("The main file must be a .tex file.")
    if main not in files:
        raise BadRequest(f"The main file {main!r} is not among the files.")
    names = set(files)
    for n in names:  # "a" as a file and "a/b.png" can't both exist
        parts = n.split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in names:
                raise BadRequest(f"{'/'.join(parts[:i])!r} is both a file and a folder.")
    return main, files


# ----------------------------------------------------------- missing images

_INCLUDEGRAPHICS_RE = re.compile(r"\\includegraphics(\*?)(\[[^\]]*\])?\{([^}]+)\}")
_GRAPHICSPATH_RE = re.compile(r"\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}")


def _graphics_dirs(sources: list[str]) -> list[str]:
    dirs = [""]
    for src in sources:
        for m in _GRAPHICSPATH_RE.finditer(src):
            for d in re.findall(r"\{([^{}]*)\}", m.group(1)):
                d = d.strip().removeprefix("./")
                if d and not d.endswith("/"):
                    d += "/"
                if d not in dirs:
                    dirs.append(d)
    return dirs


def _norm(path: str) -> str | None:
    """A relative path with './' and 'a/../' folded, or None when it leaves the folder."""
    out: list[str] = []
    for part in path.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not out:
                return None
            out.pop()
        else:
            out.append(part)
    return "/".join(out)


def mark_missing_images(tex: str, names: set[str], base: str, dirs: list[str]) -> str:
    """Replace each \\includegraphics of a file that was not sent with a framed
    note, as the desktop KherveTeX does: xdvipdfmx would otherwise stop the
    whole compile ("Image inclusion failed")."""

    def found(path: str) -> bool:
        p = path.strip().strip('"')
        if "\\" in p or "#" in p or p.startswith("example-image"):
            return True  # a macro, or a picture from the TeX bundle (mwe)
        if p.startswith("/"):
            return False
        for d in dirs:
            joined = _norm(f"{base}/{d}{p}" if base else f"{d}{p}")
            if joined is None:
                continue
            if joined in names:
                return True
            if not PurePosixPath(p).suffix and any(joined + e in names for e in _GRAPHIC_EXTS):
                return True
        return False

    def placeholder(path: str) -> str:
        safe = path.replace("\\", "/")
        for ch in "_#%&$^{}~":
            safe = safe.replace(ch, "\\" + ch if ch not in "^~" else "?")
        return r"\fbox{\texttt{\small [missing image: " + safe + r"]}}"

    return _INCLUDEGRAPHICS_RE.sub(lambda m: m.group(0) if found(m.group(3)) else placeholder(m.group(3)), tex)


# ------------------------------------------------------------------- the run

# Signs in tectonic's output, from the desktop KherveTeX (compiler.py).
_NETWORK_ERROR_RE = re.compile(
    r"error sending request|failed to (?:fetch|connect)|dns error|tcp connect error|Connection refused"
    r"|network is unreachable|timed out|failed to lookup address",
    re.IGNORECASE,
)
_MISSING_FILE_RE = re.compile(r"File `([^']+)' not found")
_MISSING_BST_RE = re.compile(r"I couldn't open style file (\S+)")
_MISSING_FONT_RE = re.compile(
    r"Font [^=\s]+=\[?([^\]:;\s]+)[^\n]* not loadable: Metric \(TFM\) file"
    r"|Could not locate a virtual/physical font named ([^\s.]+)"
    r"|Cannot proceed without \.vf or \"physical\" font for (\S+)"
)
_ERROR_LINE_RE = re.compile(r"^error: (?P<file>[^\n:]+?):(?P<line>\d+): (?P<msg>.+)$", re.MULTILINE)
_ERROR_BANG_RE = re.compile(r"^error: !\s*(?P<msg>.+)$", re.MULTILINE)
_ABS_ACCESS_RE = re.compile(r"accessing absolute path `([^`]+)`")
_WRITING_RE = re.compile(r"^note: Writing `([^`]+)`", re.MULTILINE)
_LOG_ESCAPE_RE = re.compile(r"\((\.\./[^\s()]+)")


@dataclass
class Result:
    ok: bool
    log: str
    errors: list[dict] = field(default_factory=list)
    pdf: bytes | None = None

    def response(self) -> dict:
        out: dict = {"ok": self.ok, "log": self.log, "errors": self.errors}
        if self.ok and self.pdf is not None:
            out["pdf"] = base64.b64encode(self.pdf).decode("ascii")
        return out


def _missing(output: str, blg: str) -> list[str]:
    found = _MISSING_FILE_RE.findall(output)
    found += [next(g for g in m if g) for m in _MISSING_FONT_RE.findall(output.replace("\n", ""))]
    found += _MISSING_BST_RE.findall(blg)
    return found


def parse_errors(output: str, tex_log: str = "") -> list[dict]:
    """[{line, file, message}] from tectonic's own output, falling back to the TeX log."""
    errors: list[dict] = []
    seen: set[tuple] = set()

    def add(message: str, line: int | None = None, file: str | None = None) -> None:
        message = message.strip().removeprefix("!").strip()
        key = (file, line, message)
        if not message or key in seen or len(errors) >= MAX_ERRORS:
            return
        seen.add(key)
        err: dict = {"message": message}
        if line is not None:
            err["line"] = line
        if file:
            err["file"] = file.removeprefix("./")
        errors.append(err)

    events: list[tuple[int, str, int | None, str | None]] = []
    for m in _ERROR_LINE_RE.finditer(output):
        events.append((m.start(), m.group("msg"), int(m.group("line")), m.group("file")))
    for m in _ERROR_BANG_RE.finditer(output):
        events.append((m.start(), m.group("msg"), None, None))
    for _, msg, line, file in sorted(events, key=lambda e: e[0]):
        add(msg, line, file)
    if not errors and tex_log:
        lines = tex_log.splitlines()
        for i, text in enumerate(lines):
            if text.startswith("! "):
                line = None
                for follow in lines[i + 1 : i + 12]:
                    lm = re.match(r"^l\.(\d+)", follow)
                    if lm:
                        line = int(lm.group(1))
                        break
                add(text[2:], line)
    return errors


def _clip(text: str) -> str:
    if len(text) <= MAX_LOG_CHARS:
        return text
    head = MAX_LOG_CHARS // 4
    return text[:head] + "\n\n[… log shortened …]\n\n" + text[-(MAX_LOG_CHARS - head) :]


def _env() -> dict[str, str]:
    keep = {"PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR", "TZ", "SYSTEMROOT"}
    prefixes = ("LC_", "XDG_", "SSL_", "TECTONIC_", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY")
    env = {k: v for k, v in os.environ.items() if k in keep or k.upper().startswith(prefixes)}
    for k in ("http_proxy", "https_proxy", "no_proxy", "all_proxy"):
        if k in os.environ:
            env[k] = os.environ[k]
    return env


def _run(cmd: list[str], cwd: Path, timeout: float) -> tuple[int | None, str]:
    """(exit code or None on timeout, combined output). The whole process group dies on timeout."""
    env = _env()
    env["TMPDIR"] = str(cwd)  # tectonic's temporary files stay in the build folder
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        env=env, start_new_session=True,
    )
    try:
        out, _ = proc.communicate(timeout=max(1.0, timeout))
        return proc.returncode, out.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            proc.kill()
        out, _ = proc.communicate()
        return None, out.decode("utf-8", errors="replace")


def _escapes(output: str, tex_log: str, work: Path) -> list[str]:
    """Files outside the build folder that tectonic says it read or wrote."""
    root = _real(work)
    out: list[str] = []
    for p in _ABS_ACCESS_RE.findall(output):
        if not _real(p).startswith(root + os.sep):
            out.append(p)
    for p in _WRITING_RE.findall(output):
        full = p if os.path.isabs(p) else os.path.join(root, p)
        if not _real(full).startswith(root + os.sep):
            out.append(p)
    out += _LOG_ESCAPE_RE.findall(tex_log)
    return list(dict.fromkeys(out))


def compile_files(main: str, files: dict[str, bytes], *, build_root: str | None = None) -> Result:
    """Compile `main` with tectonic among `files`. Never raises for TeX problems."""
    eng = engine()
    if eng is None:
        return Result(False, "tectonic is not installed on the KherveOS server.",
                      [{"message": "tectonic is not installed on the KherveOS server."}])
    sandbox = sandbox_kind()
    deadline = time.monotonic() + TIMEOUT
    work = Path(tempfile.mkdtemp(prefix="kherveos-latex-", dir=build_root))
    try:
        names = set(files)
        sources = [d.decode("utf-8", errors="replace") for n, d in files.items() if n.lower().endswith(".tex")]
        base = str(PurePosixPath(main).parent).removeprefix(".")
        dirs = _graphics_dirs(sources)
        root = _real(work)
        for name, data in files.items():
            target = work.joinpath(*name.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            if not _real(target.parent).startswith(root):  # names are checked; belt and braces
                msg = f"Refused file name {name!r}."
                return Result(False, msg, [{"message": msg}])
            if name.lower().endswith(".tex"):
                text = data.decode("utf-8", errors="replace")
                data = mark_missing_images(text, names, base, dirs).encode("utf-8")
            target.write_bytes(data)

        main_path = work / main
        out_dir = main_path.parent
        pdf_path = out_dir / (main_path.stem + ".pdf")
        log_path = out_dir / (main_path.stem + ".log")
        blg_path = out_dir / (main_path.stem + ".blg")
        base_cmd = [eng.path, "-X", "compile", "--untrusted", "-Z", "continue-on-errors", "--keep-logs",
                    "--outdir", str(out_dir), main]
        if sandbox == "sandbox-exec":
            prefix = seatbelt_command(work, eng)
        elif sandbox == "bwrap":
            if eng.cache_dir:
                eng.cache_dir.mkdir(parents=True, exist_ok=True)
            prefix = bwrap_command(work, eng, shutil.which("bwrap") or "bwrap")
        else:
            prefix = []

        def run(online: bool) -> tuple[int | None, str]:
            cmd = list(base_cmd)
            if not online:
                cmd.insert(3, "--only-cached")
            return _run(prefix + cmd, work, deadline - time.monotonic())

        code, output = run(online=False)
        blg = blg_path.read_text("utf-8", errors="replace") if blg_path.exists() else ""
        missing = _missing(output, blg)
        notes: list[str] = []
        final_output = output  # what the errors are read from: the last run only
        if code is not None and (code != 0 or missing or not pdf_path.exists()) and deadline - time.monotonic() > 2:
            cached_output = output
            pdf_path.unlink(missing_ok=True)
            code, final_output = run(online=True)
            output = cached_output + "\n--- online retry (downloading missing packages) ---\n" + final_output
            if _NETWORK_ERROR_RE.search(final_output):
                names_missing = ", ".join(sorted(set(missing))) or "some TeX files"
                notes.append(f"The server is offline, and {names_missing} is not in its TeX cache yet.")

        tex_log = log_path.read_text("utf-8", errors="replace") if log_path.exists() else ""
        escaped = _escapes(output, tex_log, work)
        if escaped:
            msg = ("The document tried to use files outside its own folder ("
                   + ", ".join(escaped[:3])
                   + "). The LaTeX service only gives a document the files sent with it.")
            return Result(False, msg, [{"message": msg}])
        if code is None:
            msg = f"The compile took longer than {TIMEOUT:g} seconds and was stopped."
            notes.append(msg)
        log = output
        if tex_log and tex_log.strip() not in output:
            log += f"\n\n----- {main_path.stem}.log -----\n" + tex_log
        if notes:
            log = "\n".join(notes) + "\n\n" + log
        errors = parse_errors(final_output, tex_log)
        ok = code == 0 and pdf_path.exists()
        if not ok:
            for note in reversed(notes):
                errors.insert(0, {"message": note})
            if not errors:
                errors.append({"message": f"tectonic stopped (exit code {code})." if code is not None
                               else "The compile was stopped."})
        pdf = None
        if ok:
            if pdf_path.stat().st_size > MAX_PDF_BYTES:
                msg = f"The PDF is bigger than {MAX_PDF_BYTES // 2**20} MB."
                return Result(False, _clip(log), [{"message": msg}, *errors])
            pdf = pdf_path.read_bytes()
        return Result(ok, _clip(log), errors[:MAX_ERRORS], pdf)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ----------------------------------------------------------------- endpoints


def _check_access(request: Request) -> bool:
    """True when the request comes from this computer; otherwise it needs a user (401)."""
    if _from_this_computer(request):
        return True
    auth.current_user(request)
    return False


async def _read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, f"The request is too big (at most {limit // 2**20} MB).")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"The request is too big (at most {limit // 2**20} MB).")
        chunks.append(chunk)
    return b"".join(chunks)


def _compile_with_slot(main: str, files: dict[str, bytes]) -> dict:
    if not _jobs.acquire(timeout=QUEUE_WAIT):
        raise HTTPException(503, "The LaTeX service is busy; try again in a moment.")
    try:
        return compile_files(main, files).response()
    finally:
        _jobs.release()


@router.post("/compile")
async def compile_latex(request: Request):
    local = _check_access(request)
    if await run_in_threadpool(engine) is None:
        raise HTTPException(503, "tectonic is not installed on the KherveOS server.")
    if not local and sandbox_kind() is None and sandbox_mode() != "off":
        raise HTTPException(
            503,
            "This server has no sandbox for LaTeX (install bubblewrap), so it only compiles "
            "for its own computer. KHERVEOS_LATEX_SANDBOX=off lifts this.",
        )
    body = await _read_body(request, MAX_REQUEST_BYTES)
    try:
        payload = json.loads(body)
    except ValueError:
        raise HTTPException(400, "The request is not valid JSON.") from None
    try:
        main, files = parse_job(payload)
    except BadRequest as e:
        raise HTTPException(e.status, str(e)) from None
    return await run_in_threadpool(_compile_with_slot, main, files)


@router.get("/status")
def status(request: Request):
    _check_access(request)
    eng = engine()
    return {
        "available": eng is not None,
        "engine": eng.version if eng else None,
        "sandbox": sandbox_kind() if eng else None,
    }
