"""kArduino's toolchain: arduino-cli on the server compiles sketches for a board.

All endpoints need a signed-in user.

  GET  /api/arduino/status            {cli, version, cores}
  GET  /api/arduino/boards            {cli, source, boards: [{name, fqbn}]}
  GET  /api/arduino/ports             {cli, ports: [{address, protocol, label, boards}]}
  POST /api/arduino/compile           {code, files?, board}  ->  {ok, cli, output, diagnostics, size}
  POST /api/arduino/upload            {code, files?, board, port?}  (board on the server's own machine)
  GET  /api/arduino/libraries         the installed libraries
  POST /api/arduino/libraries/search  {query}
  POST /api/arduino/libraries/install {name}
  POST /api/arduino/core/install      {core}   e.g. "arduino:avr"

`code` is the main sketch; `files` are the other tabs (.h .cpp .c .hpp .ino). The board is a
fully qualified board name such as "arduino:avr:uno". Without arduino-cli on the server every
endpoint answers {cli: false, ...} with a message instead of failing. Uploading only works
when the board is plugged into the machine the server runs on: the web page cannot flash.
"""

import json
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import User, current_user
from .config import DATA_DIR

router = APIRouter(prefix="/api/arduino", tags=["arduino"])

MAX_CODE = 200_000
MAX_FILE = 100_000
MAX_FILES = 12
MAX_TOTAL = 400_000
MAX_OUTPUT = 60_000
TIMEOUT = 180
QUICK = 30
INSTALL_TIMEOUT = 300
UPLOAD_TIMEOUT = 240

# "arduino:avr:uno", "arduino:avr:nano:cpu=atmega328"
BOARD = re.compile(r"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(:[A-Za-z0-9_.=,-]+)?$")
CORE_ID = re.compile(r"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(@[0-9][A-Za-z0-9_.+-]*)?$")
# Library names have spaces ("Adafruit NeoPixel"); never a leading "-" (an option for the CLI).
LIB_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.+()-]{0,79}(@[0-9][A-Za-z0-9_.+-]*)?$")
LIB_QUERY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.+():=-]{0,79}$")
PORT = re.compile(r"^(/dev/[A-Za-z0-9_.-]{1,60}|COM[0-9]{1,3})$")
FILE_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$")
FILE_EXT = {".ino", ".h", ".cpp", ".c", ".hpp"}
MAIN = "sketch.ino"

# The boards kArduino offers first; keep in step with src/apps/karduino/boards.ts.
CURATED_BOARDS = [
    {"name": "Arduino Uno", "fqbn": "arduino:avr:uno"},
    {"name": "Arduino Uno R4 WiFi", "fqbn": "arduino:renesas_uno:unor4wifi"},
    {"name": "Arduino Uno R4 Minima", "fqbn": "arduino:renesas_uno:minima"},
    {"name": "Arduino Nano", "fqbn": "arduino:avr:nano:cpu=atmega328"},
    {"name": "Arduino Nano (old bootloader)", "fqbn": "arduino:avr:nano:cpu=atmega328old"},
    {"name": "Arduino Nano Every", "fqbn": "arduino:megaavr:nona4809"},
    {"name": "Arduino Mega 2560", "fqbn": "arduino:avr:mega:cpu=atmega2560"},
    {"name": "Arduino Leonardo", "fqbn": "arduino:avr:leonardo"},
    {"name": "Arduino Micro", "fqbn": "arduino:avr:micro"},
    {"name": "Arduino Pro Mini (5 V, 16 MHz)", "fqbn": "arduino:avr:pro:cpu=16MHzatmega328"},
    {"name": "Arduino Due (programming port)", "fqbn": "arduino:sam:arduino_due_x_dbg"},
    {"name": "Arduino MKR WiFi 1010", "fqbn": "arduino:samd:mkrwifi1010"},
    {"name": "ESP32 Dev Module", "fqbn": "esp32:esp32:esp32"},
    {"name": "ESP8266 NodeMCU 1.0", "fqbn": "esp8266:esp8266:nodemcuv2"},
    {"name": "Raspberry Pi Pico", "fqbn": "rp2040:rp2040:rpipico"},
]

_busy = threading.Lock()  # one install or upload at a time


class SketchFile(BaseModel):
    name: str = Field(max_length=80)
    content: str = Field(default="", max_length=MAX_FILE)


class CompileBody(BaseModel):
    code: str = Field(max_length=MAX_CODE)
    files: list[SketchFile] = Field(default_factory=list, max_length=MAX_FILES)
    board: str = Field(default="arduino:avr:uno", max_length=120)


class UploadBody(CompileBody):
    port: str | None = Field(default=None, max_length=80)


class QueryBody(BaseModel):
    query: str = Field(max_length=120)


class LibraryBody(BaseModel):
    name: str = Field(max_length=120)


class CoreBody(BaseModel):
    core: str = Field(max_length=120)


# ------------------------------------------------------------------ the CLI

def cli_path() -> str | None:
    return shutil.which("arduino-cli")


def no_cli() -> dict:
    return {
        "ok": False,
        "cli": False,
        "output": "arduino-cli is not installed on the KherveOS server. Install it from arduino.cli.arduino.cc, then try again.",
    }


def _clip(text: str) -> str:
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT] + "\n… (output cut)"


def run_cli(cli: str, args: list[str], timeout: int) -> tuple[int, str]:
    """Run arduino-cli; (return code, stdout + stderr). A timeout answers (-1, message)."""
    try:
        proc = subprocess.run([cli, *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return -1, f"Took longer than {timeout} s and was stopped."
    except OSError as e:
        return -1, f"Could not run arduino-cli: {e}"
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def run_json(cli: str, args: list[str], timeout: int = QUICK):
    """`arduino-cli … --format json` parsed; None when it fails or prints something else."""
    try:
        proc = subprocess.run([cli, *args, "--format", "json"], capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return None


# ------------------------------------------------------------- parsing output

DIAG = re.compile(
    r"^(?P<file>.+?):(?P<line>\d+):(?:(?P<col>\d+):)?\s*(?P<sev>fatal error|error|warning|note):\s*(?P<msg>.*)$"
)
FLASH = re.compile(r"Sketch uses (\d+) bytes(?: \(\d+%\))?(?: of program storage space\.?)?(?: Maximum is (\d+) bytes)?", re.I)
RAM = re.compile(r"Global variables use (\d+) bytes(?: \(\d+%\))?(?: of dynamic memory)?(?:, leaving \d+ bytes for local variables)?(?:\. Maximum is (\d+) bytes)?", re.I)


def _own_name(path: str, names: set[str]) -> str | None:
    """The sketch file a compiler path points to ("sketch.ino", "util.h"), or None for a library or core file."""
    p = path.replace("\\", "/")
    if "/libraries/" in p or "/cores/" in p or "/packages/" in p:
        return None
    base = p.rsplit("/", 1)[-1]
    if base.endswith(".ino.cpp"):
        base = base[:-4]
    return base if base in names else None


def parse_diagnostics(output: str, names: set[str] | None = None) -> list[dict]:
    """gcc-style `file:line:col: error: message` lines of arduino-cli's output.

    `file` is the sketch file ("sketch.ino" is the main one); a message from a library or the
    core gets `external: true` and the path as printed."""
    names = names or {MAIN}
    out: list[dict] = []
    for raw in output.splitlines():
        m = DIAG.match(raw.strip())
        if not m:
            continue
        sev = "error" if m["sev"] == "fatal error" else m["sev"]
        own = _own_name(m["file"], names)
        item = {
            "file": own if own else m["file"],
            "line": int(m["line"]),
            "col": int(m["col"]) if m["col"] else 1,
            "severity": sev,
            "message": m["msg"].strip(),
        }
        if own is None:
            item["external"] = True
        if item not in out:
            out.append(item)
        if len(out) >= 200:
            break
    return out


def parse_size(output: str) -> dict | None:
    """{flash, flashMax, ram, ramMax} from "Sketch uses N bytes …" and "Global variables use N bytes …"."""
    size: dict = {}
    f = FLASH.search(output)
    if f:
        size["flash"] = int(f.group(1))
        size["flashMax"] = int(f.group(2)) if f.group(2) else None
    r = RAM.search(output)
    if r:
        size["ram"] = int(r.group(1))
        size["ramMax"] = int(r.group(2)) if r.group(2) else None
    return size or None


# ------------------------------------------------------------------ the sketch

def validate_files(code: str, files: list[SketchFile]) -> None:
    if not code.strip():
        raise HTTPException(400, "The sketch is empty.")
    seen: set[str] = set()
    total = len(code)
    for f in files:
        name = f.name
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if not FILE_NAME.match(name) or ".." in name or ext not in FILE_EXT:
            raise HTTPException(400, f"“{name[:40]}” is not a valid file name: use letters, digits, _ - and one of .ino .h .cpp .c .hpp.")
        if name.lower() == MAIN or name.lower() in seen:
            raise HTTPException(400, f"The file name “{name}” is used twice.")
        seen.add(name.lower())
        total += len(f.content)
    if total > MAX_TOTAL:
        raise HTTPException(400, "The sketch is too big.")


def validate_board(board: str) -> None:
    if not BOARD.match(board):
        raise HTTPException(400, "The board must be a full name such as arduino:avr:uno.")


def write_sketch(work: Path, code: str, files: list[SketchFile]) -> Path:
    sketch = work / "sketch"
    sketch.mkdir(parents=True)
    (sketch / MAIN).write_text(code, encoding="utf-8")
    for f in files:
        (sketch / f.name).write_text(f.content, encoding="utf-8")
    return sketch


def scratch() -> Path:
    return Path(DATA_DIR) / "arduino" / uuid.uuid4().hex


def build_result(rc: int, output: str, names: set[str]) -> dict:
    return {
        "ok": rc == 0,
        "cli": True,
        "output": _clip(output or ("Done." if rc == 0 else "Failed.")),
        "diagnostics": parse_diagnostics(output, names),
        "size": parse_size(output),
    }


def compile_sketch(code: str, board: str, files: list[SketchFile] | None = None) -> dict:
    """Compile the sketch in a scratch folder under the server data directory."""
    cli = cli_path()
    if cli is None:
        return {**no_cli(), "diagnostics": [], "size": None}
    files = files or []
    work = scratch()
    try:
        sketch = write_sketch(work, code, files)
        rc, output = run_cli(cli, ["compile", "--fqbn", board, "--no-color", str(sketch)], TIMEOUT)
        if rc == -1:
            return {"ok": False, "cli": True, "output": output, "diagnostics": [], "size": None}
        return build_result(rc, output, {MAIN, *(f.name for f in files)})
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------ boards and ports

def _fqbn_ok(fqbn: object) -> bool:
    return isinstance(fqbn, str) and BOARD.match(fqbn) is not None


def parse_boards(data) -> list[dict]:
    """`board listall --format json` (any version) as [{name, fqbn}]."""
    rows = data.get("boards", []) if isinstance(data, dict) else data if isinstance(data, list) else []
    out = []
    for b in rows:
        if isinstance(b, dict) and _fqbn_ok(b.get("fqbn")) and isinstance(b.get("name"), str):
            out.append({"name": b["name"], "fqbn": b["fqbn"]})
    return out


def parse_ports(data) -> list[dict]:
    """`board list --format json` (v0 and v1 layouts) as [{address, protocol, label, boards}]."""
    rows = data.get("detected_ports", []) if isinstance(data, dict) else data if isinstance(data, list) else []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        port = row.get("port") if isinstance(row.get("port"), dict) else row
        address = port.get("address")
        if not isinstance(address, str):
            continue
        boards = row.get("matching_boards") or row.get("boards") or []
        out.append({
            "address": address,
            "protocol": str(port.get("protocol") or ""),
            "label": str(port.get("label") or port.get("protocol_label") or ""),
            "boards": [{"name": b.get("name", ""), "fqbn": b.get("fqbn", "")} for b in boards if isinstance(b, dict) and _fqbn_ok(b.get("fqbn"))],
        })
    return out


def parse_cores(data) -> list[dict]:
    rows = data.get("platforms", []) if isinstance(data, dict) else data if isinstance(data, list) else []
    out = []
    for p in rows:
        if not isinstance(p, dict):
            continue
        cid = p.get("id") or p.get("ID")
        if isinstance(cid, str):
            out.append({
                "id": cid,
                "version": str(p.get("installed_version") or p.get("installed") or p.get("Installed") or ""),
                "name": str(p.get("name") or p.get("Name") or cid),
            })
    return out


def parse_libraries(data) -> list[dict]:
    """`lib search` and `lib list` (several layouts) as [{name, version, author, sentence}]."""
    rows = data.get("libraries", []) if isinstance(data, dict) else data if isinstance(data, list) else []
    out = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        lib = item.get("library") if isinstance(item.get("library"), dict) else item
        latest = item.get("latest") if isinstance(item.get("latest"), dict) else {}
        name = lib.get("name")
        if not isinstance(name, str):
            continue
        out.append({
            "name": name,
            "version": str(lib.get("version") or latest.get("version") or ""),
            "author": str(lib.get("author") or latest.get("author") or ""),
            "sentence": str(lib.get("sentence") or latest.get("sentence") or ""),
        })
    return out


def list_ports(cli: str) -> list[dict]:
    return parse_ports(run_json(cli, ["board", "list"], 20))


# -------------------------------------------------------------------- routes

@router.get("/status")
def status(user: User = Depends(current_user)) -> dict:
    cli = cli_path()
    if cli is None:
        return {"cli": False, "version": None, "cores": [], "message": no_cli()["output"]}
    version = None
    data = run_json(cli, ["version"])
    if isinstance(data, dict):
        version = data.get("VersionString") or data.get("version")
    if not version:
        rc, text = run_cli(cli, ["version"], QUICK)
        m = re.search(r"Version:\s*([0-9][^\s]*)", text) if rc == 0 else None
        version = m.group(1) if m else None
    return {"cli": True, "version": version, "cores": parse_cores(run_json(cli, ["core", "list"]))}


@router.get("/boards")
def boards(user: User = Depends(current_user)) -> dict:
    cli = cli_path()
    if cli is not None:
        found = parse_boards(run_json(cli, ["board", "listall"], 60))
        if found:
            return {"cli": True, "source": "cli", "boards": found}
    return {"cli": cli is not None, "source": "curated", "boards": CURATED_BOARDS}


@router.get("/ports")
def ports(user: User = Depends(current_user)) -> dict:
    cli = cli_path()
    if cli is None:
        return {"cli": False, "ports": []}
    return {"cli": True, "ports": list_ports(cli)}


@router.post("/compile")
def compile_(body: CompileBody, user: User = Depends(current_user)) -> dict:
    validate_board(body.board)
    validate_files(body.code, body.files)
    return compile_sketch(body.code, body.board, body.files)


def pick_port(body: UploadBody, found: list[dict]) -> tuple[str | None, str]:
    """The serial port to upload to, or (None, why not)."""
    serial = [p for p in found if p["protocol"] in ("serial", "")]
    if body.port:
        if not PORT.match(body.port):
            raise HTTPException(400, "That is not a serial port name such as /dev/ttyUSB0 or COM3.")
        if body.port not in {p["address"] for p in serial}:
            names = ", ".join(p["address"] for p in serial) or "none"
            return None, f"The server's computer does not see a board on {body.port} (ports it sees: {names})."
        return body.port, ""
    if not serial:
        return None, "No board is plugged into the computer the KherveOS server runs on. Uploading from the web page is not possible: plug the board into the server's computer, or upload with the Arduino IDE."
    same = [p for p in serial if any(b["fqbn"].split(":")[:3] == body.board.split(":")[:3] for b in p["boards"])]
    pool = same or serial
    if len(pool) > 1:
        return None, "Several boards are plugged in (" + ", ".join(p["address"] for p in pool) + "): choose the port."
    return pool[0]["address"], ""


@router.post("/upload")
def upload(body: UploadBody, user: User = Depends(current_user)) -> dict:
    validate_board(body.board)
    validate_files(body.code, body.files)
    cli = cli_path()
    if cli is None:
        return {**no_cli(), "diagnostics": [], "size": None, "uploaded": False, "ports": []}
    found = list_ports(cli)
    port, why = pick_port(body, found)
    if port is None:
        return {"ok": False, "cli": True, "uploaded": False, "output": why, "diagnostics": [], "size": None, "ports": found}
    if not _busy.acquire(blocking=False):
        raise HTTPException(409, "Another upload or install is running on the server: try again in a minute.")
    work = scratch()
    try:
        sketch = write_sketch(work, body.code, body.files)
        rc, output = run_cli(cli, ["compile", "--upload", "-p", port, "--fqbn", body.board, "--no-color", str(sketch)], UPLOAD_TIMEOUT)
        if rc == -1:
            return {"ok": False, "cli": True, "uploaded": False, "output": output, "diagnostics": [], "size": None, "ports": found}
        res = build_result(rc, output, {MAIN, *(f.name for f in body.files)})
        return {**res, "uploaded": rc == 0, "port": port, "ports": found}
    finally:
        _busy.release()
        shutil.rmtree(work, ignore_errors=True)


@router.get("/libraries")
def libraries(user: User = Depends(current_user)) -> dict:
    cli = cli_path()
    if cli is None:
        return {**no_cli(), "libraries": []}
    return {"ok": True, "cli": True, "libraries": parse_libraries(run_json(cli, ["lib", "list"]))[:300]}


@router.post("/libraries/search")
def libraries_search(body: QueryBody, user: User = Depends(current_user)) -> dict:
    query = body.query.strip()
    if not LIB_QUERY.match(query):
        raise HTTPException(400, "Search for a library by name, e.g. “Servo” or “Adafruit NeoPixel”.")
    cli = cli_path()
    if cli is None:
        return {**no_cli(), "libraries": []}
    data = run_json(cli, ["lib", "search", query], 90)
    if data is None:
        return {"ok": False, "cli": True, "output": "The library search failed (is the server online?).", "libraries": []}
    return {"ok": True, "cli": True, "libraries": parse_libraries(data)[:25]}


@router.post("/libraries/install")
def libraries_install(body: LibraryBody, user: User = Depends(current_user)) -> dict:
    name = body.name.strip()
    if not LIB_NAME.match(name):
        raise HTTPException(400, "That is not a library name (letters, digits, spaces and . _ + ( ) -, optional @version).")
    cli = cli_path()
    if cli is None:
        return no_cli()
    if not _busy.acquire(blocking=False):
        raise HTTPException(409, "Another upload or install is running on the server: try again in a minute.")
    try:
        rc, output = run_cli(cli, ["lib", "install", name], INSTALL_TIMEOUT)
    finally:
        _busy.release()
    return {"ok": rc == 0, "cli": True, "output": _clip(output or ("Installed." if rc == 0 else "Failed."))}


@router.post("/core/install")
def core_install(body: CoreBody, user: User = Depends(current_user)) -> dict:
    core = body.core.strip()
    if not CORE_ID.match(core):
        raise HTTPException(400, "A core is named like arduino:avr or esp32:esp32.")
    cli = cli_path()
    if cli is None:
        return no_cli()
    if not _busy.acquire(blocking=False):
        raise HTTPException(409, "Another upload or install is running on the server: try again in a minute.")
    try:
        run_cli(cli, ["core", "update-index"], INSTALL_TIMEOUT)
        rc, output = run_cli(cli, ["core", "install", core], INSTALL_TIMEOUT)
    finally:
        _busy.release()
    return {"ok": rc == 0, "cli": True, "output": _clip(output or ("Installed." if rc == 0 else "Failed."))}
