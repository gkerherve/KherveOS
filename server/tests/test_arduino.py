"""kArduino's server side with arduino-cli mocked: no CLI, no board, no compile happens."""

import json
import subprocess

import pytest
from conftest import make_user

from kherveos_server import arduino

API = "/api/arduino"
SKETCH = "void setup() {}\nvoid loop() {}\n"

GCC_ERROR = """\
/data/arduino/abc123/sketch/sketch.ino: In function 'void loop()':
/data/arduino/abc123/sketch/sketch.ino:7:3: error: 'digitlWrite' was not declared in this scope
   digitlWrite(13, HIGH);
   ^~~~~~~~~~~
/data/arduino/abc123/sketch/util.h:2:10: warning: unused variable 'x' [-Wunused-variable]
/home/u/Arduino/libraries/Servo/src/Servo.h:12:5: warning: something in a library
/data/arduino/abc123/sketch/sketch.ino:9: fatal error: Missing.h: No such file or directory
Error during build: exit status 1
"""

OK_OUTPUT = """\
Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.
Global variables use 9 bytes (0%) of dynamic memory, leaving 2039 bytes for local variables. Maximum is 2048 bytes.
"""


class FakeCli:
    """Stands in for subprocess.run: records every command and answers from `answers`."""

    def __init__(self):
        self.calls = []
        self.answers = {}

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        args = " ".join(cmd[1:])
        for key, (rc, out) in self.answers.items():
            if key in args:
                return subprocess.CompletedProcess(cmd, rc, out, "")
        return subprocess.CompletedProcess(cmd, 0, "", "")


@pytest.fixture()
def cli(monkeypatch):
    fake = FakeCli()
    monkeypatch.setattr(arduino.shutil, "which", lambda name: "/usr/bin/arduino-cli")
    monkeypatch.setattr(arduino.subprocess, "run", fake)
    return fake


@pytest.fixture()
def nocli(monkeypatch):
    monkeypatch.setattr(arduino.shutil, "which", lambda name: None)


@pytest.fixture()
def user(client):
    make_user(client)
    return client


# ----------------------------------------------------------------- parsing

def test_parse_diagnostics():
    d = arduino.parse_diagnostics(GCC_ERROR, {"sketch.ino", "util.h"})
    assert d[0] == {"file": "sketch.ino", "line": 7, "col": 3, "severity": "error", "message": "'digitlWrite' was not declared in this scope"}
    assert d[1]["file"] == "util.h" and d[1]["severity"] == "warning" and d[1]["line"] == 2 and "external" not in d[1]
    assert d[2]["external"] is True and d[2]["file"].endswith("Servo.h")
    assert d[3]["severity"] == "error" and d[3]["col"] == 1 and d[3]["line"] == 9
    assert len(d) == 4


def test_parse_diagnostics_preprocessed_name_and_windows_path():
    out = "C:\\Users\\a\\AppData\\Local\\Temp\\sketch\\sketch.ino:3:1: error: expected ';' before '}' token\n"
    d = arduino.parse_diagnostics(out)
    assert d == [{"file": "sketch.ino", "line": 3, "col": 1, "severity": "error", "message": "expected ';' before '}' token"}]
    d = arduino.parse_diagnostics("/tmp/b/sketch/sketch.ino.cpp:4:2: error: boom\n")
    assert d[0]["file"] == "sketch.ino"


def test_parse_size():
    assert arduino.parse_size(OK_OUTPUT) == {"flash": 924, "flashMax": 32256, "ram": 9, "ramMax": 2048}
    assert arduino.parse_size("Sketch uses 100 bytes (1%) of program storage space.") == {"flash": 100, "flashMax": None}
    assert arduino.parse_size("nothing here") is None


def test_parse_ports_both_layouts():
    v1 = {"detected_ports": [{"port": {"address": "/dev/ttyACM0", "protocol": "serial", "label": "ACM0"},
                              "matching_boards": [{"name": "Arduino Uno", "fqbn": "arduino:avr:uno"}]}]}
    v0 = [{"address": "/dev/ttyUSB0", "protocol": "serial", "boards": [{"name": "Nano", "fqbn": "arduino:avr:nano"}]}]
    assert arduino.parse_ports(v1)[0]["boards"][0]["fqbn"] == "arduino:avr:uno"
    assert arduino.parse_ports(v0)[0]["address"] == "/dev/ttyUSB0"
    assert arduino.parse_ports("junk") == []


def test_validators():
    assert arduino.BOARD.match("arduino:avr:nano:cpu=atmega328")
    assert not arduino.BOARD.match("arduino:avr")
    assert not arduino.BOARD.match("arduino:avr:uno; rm -rf /")
    assert arduino.LIB_NAME.match("Adafruit NeoPixel@1.12.0")
    assert not arduino.LIB_NAME.match("--git-url")
    assert not arduino.LIB_NAME.match("a;b")
    assert arduino.CORE_ID.match("esp32:esp32")
    assert not arduino.CORE_ID.match("esp32")
    assert arduino.PORT.match("/dev/ttyUSB0") and arduino.PORT.match("COM3")
    assert not arduino.PORT.match("/etc/passwd") and not arduino.PORT.match("/dev/../etc/x")


def test_curated_boards_are_valid():
    for b in arduino.CURATED_BOARDS:
        assert arduino.BOARD.match(b["fqbn"]), b


# -------------------------------------------------------------------- auth

@pytest.mark.parametrize("method,path", [
    ("get", "/status"), ("get", "/boards"), ("get", "/ports"), ("get", "/libraries"),
    ("post", "/compile"), ("post", "/upload"), ("post", "/libraries/search"),
    ("post", "/libraries/install"), ("post", "/core/install"),
])
def test_sign_in_required(client, method, path):
    r = getattr(client, method)(API + path, **({"json": {}} if method == "post" else {}))
    assert r.status_code == 401


# ----------------------------------------------------------------- no CLI

def test_no_cli(user, nocli):
    r = user.post(f"{API}/compile", json={"code": SKETCH, "board": "arduino:avr:uno"}).json()
    assert r["ok"] is False and r["cli"] is False and "arduino-cli" in r["output"]
    assert r["diagnostics"] == [] and r["size"] is None
    s = user.get(f"{API}/status").json()
    assert s["cli"] is False and s["cores"] == []
    b = user.get(f"{API}/boards").json()
    assert b["source"] == "curated" and any(x["fqbn"] == "arduino:avr:uno" for x in b["boards"])
    assert user.post(f"{API}/upload", json={"code": SKETCH, "board": "arduino:avr:uno"}).json()["cli"] is False
    assert user.post(f"{API}/libraries/install", json={"name": "Servo"}).json()["cli"] is False
    assert user.post(f"{API}/core/install", json={"core": "arduino:avr"}).json()["cli"] is False


# ----------------------------------------------------------------- compile

def test_compile_ok_with_size(user, cli):
    cli.answers["compile"] = (0, OK_OUTPUT)
    r = user.post(f"{API}/compile", json={"code": SKETCH, "board": "arduino:avr:uno"}).json()
    assert r["ok"] and r["cli"] and r["size"] == {"flash": 924, "flashMax": 32256, "ram": 9, "ramMax": 2048}
    assert r["diagnostics"] == [] and "Sketch uses" in r["output"]
    assert cli.calls[-1][:4] == ["/usr/bin/arduino-cli", "compile", "--fqbn", "arduino:avr:uno"]


def test_compile_errors_are_structured(user, cli):
    cli.answers["compile"] = (1, GCC_ERROR)
    body = {"code": SKETCH, "board": "arduino:avr:uno", "files": [{"name": "util.h", "content": "int x;"}]}
    r = user.post(f"{API}/compile", json=body).json()
    assert r["ok"] is False and r["cli"] is True
    assert r["diagnostics"][0]["file"] == "sketch.ino" and r["diagnostics"][0]["line"] == 7
    assert r["diagnostics"][1]["file"] == "util.h"
    assert r["size"] is None


def test_compile_writes_the_files_in_the_sketch_folder(user, monkeypatch):
    seen = {}
    monkeypatch.setattr(arduino.shutil, "which", lambda name: "/usr/bin/arduino-cli")

    def run(cmd, **kw):
        folder = arduino.Path(cmd[-1])
        seen["files"] = sorted(p.name for p in folder.iterdir())
        seen["util"] = (folder / "util.h").read_text()
        return subprocess.CompletedProcess(cmd, 0, "ok", "")

    monkeypatch.setattr(arduino.subprocess, "run", run)
    body = {"code": SKETCH, "board": "arduino:avr:uno", "files": [{"name": "util.h", "content": "int x;"}, {"name": "m.cpp", "content": ""}]}
    assert user.post(f"{API}/compile", json=body).json()["ok"] is True
    assert seen["files"] == ["m.cpp", "sketch.ino", "util.h"] and seen["util"] == "int x;"


def test_compile_old_client_without_files(user, cli):
    cli.answers["compile"] = (0, "Done")
    assert user.post(f"{API}/compile", json={"code": SKETCH}).json()["ok"] is True


def test_compile_timeout(user, monkeypatch):
    monkeypatch.setattr(arduino.shutil, "which", lambda name: "/x/arduino-cli")

    def slow(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)

    monkeypatch.setattr(arduino.subprocess, "run", slow)
    r = user.post(f"{API}/compile", json={"code": SKETCH}).json()
    assert r["ok"] is False and "longer than" in r["output"]


@pytest.mark.parametrize("body", [
    {"code": SKETCH, "board": "uno"},
    {"code": SKETCH, "board": "arduino:avr:uno --upload"},
    {"code": "   ", "board": "arduino:avr:uno"},
    {"code": SKETCH, "files": [{"name": "../evil.h", "content": ""}]},
    {"code": SKETCH, "files": [{"name": "a/b.h", "content": ""}]},
    {"code": SKETCH, "files": [{"name": "evil.sh", "content": ""}]},
    {"code": SKETCH, "files": [{"name": ".hidden.h", "content": ""}]},
    {"code": SKETCH, "files": [{"name": "sketch.ino", "content": ""}]},
    {"code": SKETCH, "files": [{"name": "a.h", "content": ""}, {"name": "A.H", "content": ""}]},
    {"code": SKETCH, "files": [{"name": f"f{i}.h", "content": ""} for i in range(13)]},
    {"code": SKETCH, "files": [{"name": "big.h", "content": "x" * 100_001}]},
    {"code": "x" * 200_001},
])
def test_compile_rejects_bad_input(user, cli, body):
    assert user.post(f"{API}/compile", json=body).status_code in (400, 422)
    assert cli.calls == []


def test_total_size_limit(user, cli):
    files = [{"name": f"f{i}.h", "content": "x" * 90_000} for i in range(5)]
    assert user.post(f"{API}/compile", json={"code": SKETCH, "files": files}).status_code == 400
    assert cli.calls == []


# ------------------------------------------------------------------ status

def test_status_and_boards(user, cli):
    cli.answers["version"] = (0, json.dumps({"VersionString": "1.1.1"}))
    cli.answers["core list"] = (0, json.dumps({"platforms": [{"id": "arduino:avr", "installed_version": "1.8.6", "name": "Arduino AVR Boards"}]}))
    cli.answers["board listall"] = (0, json.dumps({"boards": [{"name": "Arduino Uno", "fqbn": "arduino:avr:uno"}, {"name": "bad", "fqbn": "no good"}]}))
    s = user.get(f"{API}/status").json()
    assert s == {"cli": True, "version": "1.1.1", "cores": [{"id": "arduino:avr", "version": "1.8.6", "name": "Arduino AVR Boards"}]}
    b = user.get(f"{API}/boards").json()
    assert b["source"] == "cli" and b["boards"] == [{"name": "Arduino Uno", "fqbn": "arduino:avr:uno"}]


def test_boards_fall_back_to_the_curated_list(user, cli):
    cli.answers["board listall"] = (1, "")
    assert user.get(f"{API}/boards").json()["source"] == "curated"


# --------------------------------------------------------------- libraries

def test_library_search_and_install(user, cli):
    cli.answers["lib search"] = (0, json.dumps({"libraries": [{"name": "Servo", "latest": {"version": "1.2.1", "author": "Arduino", "sentence": "Control servos"}}]}))
    r = user.post(f"{API}/libraries/search", json={"query": "servo"}).json()
    assert r["libraries"] == [{"name": "Servo", "version": "1.2.1", "author": "Arduino", "sentence": "Control servos"}]
    cli.answers["lib install"] = (0, "Installed Servo@1.2.1")
    r = user.post(f"{API}/libraries/install", json={"name": "Servo"}).json()
    assert r["ok"] and cli.calls[-1][1:] == ["lib", "install", "Servo"]


@pytest.mark.parametrize("path,body", [
    ("/libraries/install", {"name": "--git-url=http://x"}),
    ("/libraries/install", {"name": "Servo; rm -rf /"}),
    ("/libraries/install", {"name": ""}),
    ("/libraries/search", {"query": "-x"}),
    ("/libraries/search", {"query": "a|b"}),
    ("/core/install", {"core": "arduino"}),
    ("/core/install", {"core": "--additional-urls x:y"}),
])
def test_installs_reject_bad_names(user, cli, path, body):
    assert user.post(API + path, json=body).status_code == 400
    assert cli.calls == []


def test_core_install(user, cli):
    cli.answers["core install"] = (0, "Platform installed")
    r = user.post(f"{API}/core/install", json={"core": "arduino:avr"}).json()
    assert r["ok"] is True
    assert ["core", "install", "arduino:avr"] in [c[1:] for c in cli.calls]


# ------------------------------------------------------------------ upload

UNO_PORT = json.dumps({"detected_ports": [{"port": {"address": "/dev/ttyACM0", "protocol": "serial"},
                                           "matching_boards": [{"name": "Arduino Uno", "fqbn": "arduino:avr:uno"}]}]})


def test_upload_without_a_board(user, cli):
    cli.answers["board list"] = (0, json.dumps({"detected_ports": []}))
    r = user.post(f"{API}/upload", json={"code": SKETCH, "board": "arduino:avr:uno"}).json()
    assert r["ok"] is False and r["uploaded"] is False and "plugged" in r["output"]
    assert not any("--upload" in c for c in cli.calls)


def test_upload_finds_the_port(user, cli):
    cli.answers["board list"] = (0, UNO_PORT)
    cli.answers["--upload"] = (0, OK_OUTPUT + "\navrdude done.")
    r = user.post(f"{API}/upload", json={"code": SKETCH, "board": "arduino:avr:uno"}).json()
    assert r["ok"] and r["uploaded"] and r["port"] == "/dev/ttyACM0" and r["size"]["flash"] == 924
    assert cli.calls[-1][1:6] == ["compile", "--upload", "-p", "/dev/ttyACM0", "--fqbn"]


def test_upload_port_must_be_a_listed_port(user, cli):
    cli.answers["board list"] = (0, UNO_PORT)
    body = {"code": SKETCH, "board": "arduino:avr:uno"}
    assert user.post(f"{API}/upload", json={**body, "port": "/etc/passwd"}).status_code == 400
    assert user.post(f"{API}/upload", json={**body, "port": "/dev/ttyUSB9; id"}).status_code == 400
    r = user.post(f"{API}/upload", json={**body, "port": "/dev/ttyUSB9"}).json()
    assert r["uploaded"] is False and "does not see" in r["output"]
    assert not any("--upload" in c for c in cli.calls)


def test_upload_rejects_a_bad_board(user, cli):
    assert user.post(f"{API}/upload", json={"code": SKETCH, "board": "x y"}).status_code == 400
