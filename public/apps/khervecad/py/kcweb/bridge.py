"""KherveCAD in Pyodide: install the desktop package, answer requests.

The web side (src/apps/khervecad/bridge.ts) runs, once per window:

    await install(base_url, root)       # khervecad.zip + data stubs
    reply(boot_json)                    # builds the desktop MainWindow

and then `reply(request_json)` for every batch of user input. Each reply
is printed between two markers so nothing the desktop code prints can
be mistaken for it.

The package's data files (library parts, the human model, planet maps,
help pictures…) are created empty and fetched from the server the first
time the desktop code opens one: `open()` is wrapped for files under the
package (synchronous XMLHttpRequest, which a Web Worker may use).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import builtins
import io
import json
import os
import re
import sys
import traceback

_NON_FINITE = re.compile(r'(?<=[:\[,])(-?Infinity|NaN)(?=[,\]}])')

START = "\x02KC-JSON\x03"
END = "\x02/KC-JSON\x03"

ROOT = "/kherveos/khervecad"
PKG = ROOT + "/khervecad"
BASE = ""
#: package-relative paths still to fetch
LAZY = set()

_real_open = builtins.open


def _fetch_bytes(url):
    from js import Uint8Array, XMLHttpRequest
    req = XMLHttpRequest.new()
    req.open("GET", url, False)
    req.responseType = "arraybuffer"
    req.send(None)
    if req.status != 200:
        raise OSError(f"could not fetch {url} ({req.status})")
    return bytes(Uint8Array.new(req.response).to_py())


def _ensure(path):
    """Fetch *path* if it is a package data file not yet downloaded."""
    if not LAZY:
        return
    try:
        p = os.path.abspath(os.fspath(path))
    except TypeError:
        return
    if not p.startswith(PKG + "/"):
        return
    rel = p[len(PKG) + 1:]
    if rel not in LAZY:
        return
    from urllib.parse import quote
    data = _fetch_bytes(BASE + "data/khervecad/" + quote(rel))
    # A server may send a .gz with "Content-Encoding: gzip" (Vite does), and the
    # browser then hands over the unpacked bytes: pack them again for gzip.open
    if rel.endswith(".gz") and not data.startswith(b"\x1f\x8b"):
        import gzip
        data = gzip.compress(data)
    with _real_open(p, "wb") as fh:
        fh.write(data)
    LAZY.discard(rel)


def _lazy_open(file, mode="r", *args, **kwargs):
    if isinstance(file, (str, bytes, os.PathLike)) and "r" in mode:
        _ensure(file)
    return _real_open(file, mode, *args, **kwargs)


async def install(base_url, root=ROOT):
    """Unpack khervecad.zip and the kcweb sources, create the data
    stubs and put both on sys.path."""
    global BASE
    import zipfile
    from pyodide.http import pyfetch
    BASE = base_url
    os.makedirs(root, exist_ok=True)
    resp = await pyfetch(base_url + "khervecad.zip")
    if not resp.ok:
        raise OSError(f"khervecad.zip: HTTP {resp.status}")
    data = await resp.bytes()
    zipfile.ZipFile(io.BytesIO(data)).extractall(root)
    resp = await pyfetch(base_url + "lazy.json")
    lazy = (await resp.json())["files"]
    for rel in lazy:
        path = os.path.join(root, "khervecad", rel)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            _real_open(path, "wb").close()
            LAZY.add(rel)
    fonts = os.path.join(root, "data", "fonts")
    os.makedirs(fonts, exist_ok=True)
    builtins.open = _lazy_open
    io.open = _lazy_open
    if root not in sys.path:
        sys.path.insert(0, root)
    return len(lazy)


def fetch_font(name):
    """The Liberation fonts for the preview's text, on first use."""
    path = os.path.join(ROOT, "data", "fonts", name)
    if not os.path.exists(path):
        with _real_open(path, "wb") as fh:
            fh.write(_fetch_bytes(BASE + "data/fonts/" + name))
    return path


def reply(payload):
    from kcweb import app
    try:
        out = app.request(payload)
    except BaseException as exc:          # never leave the web side waiting
        out = {"fatal": f"{type(exc).__name__}: {exc}",
               "trace": traceback.format_exc()}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"),
                      default=_jsonable)
    # JSON has no NaN / Infinity: a stray one becomes null
    text = _NON_FINITE.sub("null", text)
    sys.stdout.write(START + text + END + "\n")
    sys.stdout.flush()


def _jsonable(value):
    if isinstance(value, (set, tuple)):
        return list(value)
    if hasattr(value, "_kc_id"):
        return value._kc_id
    return str(value)
