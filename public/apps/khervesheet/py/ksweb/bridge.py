"""The requests the web grid sends to Python, and their JSON answers.

The page runs ``await ksweb.bridge.run(<json>)`` in the window's Pyodide
worker with a batch of requests ``[{"op": …, "args": {…}}…]``; the answers
(one per request, in order) are printed on stdout between ``START`` and
``END``. Each answer is ``{"ok": true, …}`` or ``{"ok": false, "error"}``.

What changed in the cells comes back in the same few fields:

- ``cells``    [[sheet, r, c, text, number]] — what cells now show
- ``sources``  [[sheet, r, c, source]]       — what was typed in them
- ``snapshot`` {sheet: [[r, c, source, text, number]]} — a whole sheet
- ``py``       [[sheet, r, c, {fig, err, out} | null]] — =PY outputs
- ``pyPending`` how many =PY cells are waiting for the user's trust

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import base64
import importlib
import importlib.util
import json
import math
import re
import sys
import traceback

START = "\x02KS-JSON\x03"
END = "\x02/KS-JSON\x03"


class _State:
    workbook = None
    #: =PY outputs already sent: (id(sheet), r, c) → signature.
    py_sent: dict = {}
    scipy_functions: set = set()


S = _State()


# ── Packages (Pyodide loads them on demand) ──────────────────────────
def _importable(name):
    if name in sys.modules:
        return True
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


async def ensure(names):
    """Load Pyodide packages that are not there yet (no-op elsewhere)."""
    missing = sorted(n for n in set(names) if n and not _importable(n))
    if not missing:
        return
    try:
        import pyodide_js
        from pyodide.ffi import to_js
    except ImportError:
        return
    pip = [n for n in missing if n == "openpyxl"]
    dist = [n for n in missing if n != "openpyxl"]
    if dist:
        await pyodide_js.loadPackage(to_js(dist))
    if pip:
        await pyodide_js.loadPackage("micropip")
        import micropip
        await micropip.install(pip)
    importlib.invalidate_caches()


#: Pure-Python packages =PY cells may import that Pyodide does not ship:
#: installed from PyPI the first time a trusted cell imports them.
PIP_IMPORTS = {"lmfit": "lmfit"}


async def ensure_imports(code):
    """Load what a =PY cell imports (pyodide's own import scan)."""
    try:
        import pyodide_js
        from pyodide.code import find_imports
    except ImportError:
        return
    await pyodide_js.loadPackagesFromImports(code)
    pip = [PIP_IMPORTS[n] for n in find_imports(code)
           if n in PIP_IMPORTS and not _importable(n)]
    if pip:
        await pyodide_js.loadPackage("micropip")
        import micropip
        await micropip.install(pip)
        importlib.invalidate_caches()


_FUNC = re.compile(r"([A-Za-z_][A-Za-z0-9_.]*)\s*\(")


def _scipy_functions():
    """Formula functions that need scipy (their code imports it)."""
    if S.scipy_functions:
        return S.scipy_functions
    import khervesheet.core.functions as fn
    names = set()
    try:
        with open(fn.__file__, encoding="utf-8") as f:
            src = f.read()
        blocks = re.split(r"\n    def ", src)
        users = {b.split("(", 1)[0].strip() for b in blocks[1:]
                 if "scipy" in b}
        for key, value in re.findall(r'"([A-Z0-9_.]+)":\s*(_[A-Za-z0-9_]+)',
                                     src):
            if value in users:
                names.add(key.replace(".", "_"))
    except OSError:
        pass
    S.scipy_functions = names or {
        "DERIV_SMOOTH", "CUMTRAPZ", "SIMPS", "SAVGOL", "LOWPASS",
        "HIGHPASS", "BANDPASS", "MEDIAN_FILTER", "INTERP_SPLINE",
        "INTERP_AKIMA", "FIND_PEAKS", "FIND_PEAKS_X", "FIND_PEAKS_Y",
        "BASELINE_ALS"}
    return S.scipy_functions


PY_PACKAGES = ("numpy", "matplotlib", "pandas")


async def ensure_for_sources(sources, trusted=None):
    """Load what the formulas and =PY cells in *sources* need."""
    from khervesheet.core.python import (is_python_source, source_hash,
                                         strip_marker)
    needs = set()
    codes = []
    scipy_names = _scipy_functions()
    for src in sources:
        if not src or not src.startswith("="):
            continue
        if is_python_source(src):
            if trusted is not None and source_hash(src) not in trusted:
                continue
            needs.update(PY_PACKAGES)
            code = strip_marker(src)
            if "scipy" in code:
                needs.add("scipy")
            if "import" in code:
                codes.append(code)
            continue
        for name in _FUNC.findall(src):
            if name.upper().replace(".", "_") in scipy_names:
                needs.add("scipy")
                break
    await ensure(needs)
    for code in codes:
        await ensure_imports(code)
    if needs & set(PY_PACKAGES):
        _refresh_py_globals()


def _refresh_py_globals():
    """Give =PY cells np, plt, pd, scipy once those packages are loaded
    (the runtime looks for them only the first time it runs)."""
    wb = S.workbook
    rt = getattr(wb, "python", None) if wb else None
    if rt is None or rt._globals is None:
        return
    g = rt._globals
    for module, names in (("numpy", ("np", "numpy")),
                          ("matplotlib.pyplot", ("plt",)),
                          ("pandas", ("pd", "pandas")),
                          ("scipy", ("scipy",))):
        if all(n in g for n in names):
            continue
        try:
            if module == "matplotlib.pyplot":
                import matplotlib
                matplotlib.use("Agg", force=False)
            mod = importlib.import_module(module)
        except Exception:
            continue
        for n in names:
            g.setdefault(n, mod)


def _patch_urllib():
    """urllib.request.urlopen for plain GETs through the browser (a
    synchronous request from the worker), so =PY cells that fetch live
    data work where the site allows it (CORS). Same as KherveBook's."""
    try:
        import io
        import pyodide.http as ph
        import urllib.error as ue
        import urllib.request as ur
    except ImportError:
        return
    if getattr(ur, "_ksheet_patched", False):
        return
    ur._ksheet_patched = True
    orig = ur.urlopen

    class _Response(io.BytesIO):
        def __init__(self, data, url):
            super().__init__(data)
            self.url = url
            self.status = self.code = 200
            self.headers = {}

        def getcode(self):
            return self.status

        def geturl(self):
            return self.url

        def info(self):
            return self.headers

    def urlopen(url, data=None, timeout=None, *args, **kwargs):
        target = getattr(url, "full_url", url)
        method = url.get_method() if hasattr(url, "get_method") else (
            "POST" if data is not None else "GET")
        if isinstance(target, str) and target.startswith(
                ("http://", "https://")) and method == "GET" and data is None:
            try:
                text = ph.open_url(target).getvalue()
            except Exception as exc:
                raise ue.URLError(f"{exc} (the browser may not be allowed "
                                  "to read this site: CORS)") from None
            return _Response(text.encode("utf-8"), target)
        if timeout is not None:
            kwargs["timeout"] = timeout
        return orig(url, data, *args, **kwargs)

    ur.urlopen = urlopen


# ── Answers ──────────────────────────────────────────────────────────
def _finite(v):
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def _cells(changes):
    """The engine's [(sheet, r, c, text)] with each cell's number."""
    from .workbook import number
    wb = S.workbook
    out = []
    for name, r, c, text in changes:
        sheet = wb.sheet_by_name(name)
        out.append([name, r, c, text,
                    number(sheet, r, c) if sheet is not None else None])
    return out


def _sources(pairs):
    return [[sheet.name, r, c, sheet.sources.get((r, c), "")]
            for sheet, r, c in pairs]


def _py_diff():
    """=PY outputs that changed since the last answer."""
    wb = S.workbook
    out = []
    seen = set()
    for sheet in wb.sheets:
        keys = set(sheet.py_figures) | set(sheet.py_errors) | \
            set(sheet.py_stdout)
        for (r, c) in keys:
            fig = sheet.py_figures.get((r, c))
            err = sheet.py_errors.get((r, c))
            std = sheet.py_stdout.get((r, c))
            sig = (hash(fig), err, std)
            k = (id(sheet), r, c)
            seen.add(k)
            if S.py_sent.get(k) != sig:
                S.py_sent[k] = sig
                out.append([sheet.name, r, c,
                            {"fig": fig, "err": err, "out": std}])
    names = {id(s): s.name for s in wb.sheets}
    for k in [k for k in S.py_sent if k not in seen]:
        del S.py_sent[k]
        if k[0] in names:
            out.append([names[k[0]], k[1], k[2], None])
    return out


def _py_pending():
    from khervesheet.core.python import is_python_source
    wb = S.workbook
    n = 0
    for sheet in wb.sheets:
        for src in sheet._cell_formulas.values():
            if is_python_source(src) and (wb.python is None
                                          or not wb.may_run(src)):
                n += 1
    return n


def _sheet(args):
    name = args.get("sheet")
    sheet = S.workbook.sheet_by_name(name) if S.workbook else None
    if sheet is None:
        raise KeyError(f"No sheet called {name!r}")
    return sheet


def _sheet_names():
    return [s.name for s in S.workbook.sheets]


def _trust_typed(sources):
    """=PY cells the user typed run: trust their exact source."""
    from khervesheet.core.python import (PythonRuntime, is_python_source,
                                         source_hash)
    wb = S.workbook
    hashes = {source_hash(s) for s in sources if is_python_source(s)}
    if not hashes:
        return
    if wb.trusted is None:
        wb.trusted = set()
    wb.trusted |= hashes
    if wb.python is None:
        wb.python = PythonRuntime()


async def _changing(fn, *a):
    """Run an edit, collecting what the cells show afterwards."""
    with S.workbook._collect() as changes:
        result = fn(*a)
    return result, changes


# ── Requests ─────────────────────────────────────────────────────────
async def op_init(args):
    import khervesheet
    _patch_urllib()
    from khervesheet.core import catalog
    from khervesheet.core.fitting import MODELS, MOVING_AVERAGE_KEY
    from khervesheet.core.solver import METHODS
    return {
        "core": khervesheet.CORE_SOURCE,
        "python": sys.version.split()[0],
        "catalog": {"categories": catalog.FUNCTION_CATEGORIES,
                    "order": catalog.CATEGORY_ORDER,
                    "help": catalog.FUNCTION_HELP},
        "scipyFunctions": sorted(_scipy_functions()),
        "trendModels": list(MODELS) + [MOVING_AVERAGE_KEY],
        "solverMethods": METHODS,
    }


async def op_new(args):
    from .workbook import WebWorkbook
    S.workbook = WebWorkbook()
    S.py_sent = {}
    for name in args.get("sheets") or ["Sheet1"]:
        S.workbook.add_sheet(name)
    return {"sheets": _sheet_names(), "pyPending": 0}


async def op_type(args):
    from .workbook import type_cells
    sheet = _sheet(args)
    cells = [(int(r), int(c), s or "") for r, c, s in args.get("cells")]
    if args.get("trust"):
        _trust_typed([s for _r, _c, s in cells])
    await ensure_for_sources([s for _r, _c, s in cells], S.workbook.trusted)
    _r, changes = await _changing(type_cells, sheet, cells)
    return {"cells": _cells(changes),
            "sources": _sources([(sheet, r, c) for r, c, _s in cells]),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_put(args):
    from .workbook import put_raw
    sheet = _sheet(args)
    cells = args.get("cells") or []
    await ensure_for_sources([c[2] for c in cells], S.workbook.trusted)
    _r, changes = await _changing(put_raw, sheet, cells)
    return {"cells": _cells(changes),
            "sources": _sources([(sheet, int(c[0]), int(c[1]))
                                 for c in cells]),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_numfmt(args):
    """Number formats of cells ([r, c, fmt | None]); cells holding
    something are typed again, as the core's set_number_format does."""
    from .workbook import type_cells
    sheet = _sheet(args)
    retype = []
    for r, c, fmt in args.get("cells") or []:
        r, c = int(r), int(c)
        if fmt:
            sheet.cell_formats[(r, c)] = fmt
        else:
            sheet.cell_formats.pop((r, c), None)
        src = sheet.sources.get((r, c))
        if src:
            retype.append((r, c, src))
    _r, changes = await _changing(type_cells, sheet, retype)
    return {"cells": _cells(changes), "py": _py_diff()}


async def op_fill(args):
    from .edit import fill
    sheet = _sheet(args)
    src = [int(v) for v in args["src"]]
    dst = [int(v) for v in args["dst"]]
    sources = [sheet.sources.get((r, c), "")
               for r in range(src[0], src[2] + 1)
               for c in range(src[1], src[3] + 1)]
    await ensure_for_sources(sources, S.workbook.trusted)
    written, changes = await _changing(fill, sheet, src, dst)
    return {"cells": _cells(changes),
            "sources": _sources([(sheet, r, c) for r, c in written]),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_paste(args):
    from .edit import paste
    sheet = _sheet(args)
    rows = args.get("rows") or []
    flat = [s for line in rows for s in line if s]
    if args.get("trust"):
        _trust_typed(flat)
    await ensure_for_sources(flat, S.workbook.trusted)
    written, changes = await _changing(paste, sheet, args["at"], rows,
                                       args.get("shift"))
    return {"cells": _cells(changes),
            "sources": _sources([(sheet, r, c) for r, c in written]),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_sort(args):
    from .edit import sort_range
    sheet = _sheet(args)
    rng = [int(v) for v in args["range"]]
    perm, changes = await _changing(
        sort_range, sheet, rng, int(args["key"]),
        bool(args.get("ascending", True)), bool(args.get("header")))
    written = [(sheet, r, c) for r in range(rng[0], rng[2] + 1)
               for c in range(rng[1], rng[3] + 1)]
    return {"cells": _cells(changes), "sources": _sources(written),
            "perm": perm, "py": _py_diff()}


async def op_restructure(args):
    """Insert (n > 0) or delete (n < 0) rows or columns."""
    from .edit import Change, restructure
    from .workbook import snapshot
    sheet = _sheet(args)
    change = Change(args["axis"], args["at"], args["n"])
    touched, changes = await _changing(restructure, S.workbook, sheet,
                                       change)
    others = [ch for ch in changes if ch[0] != sheet.name]
    return {"snapshot": {sheet.name: snapshot(sheet)},
            "cells": _cells(others), "sources": _sources(touched),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_replace(args):
    """Replace a sheet's cells (and number formats) with a snapshot."""
    from .workbook import clear_sheet, fill_sheet, snapshot
    sheet = _sheet(args)
    cells = args.get("cells") or []
    await ensure_for_sources([c[2] for c in cells], S.workbook.trusted)
    clear_sheet(sheet)
    sheet.cell_formats = {(int(r), int(c)): f
                          for r, c, f in args.get("numfmts") or [] if f}
    with S.workbook._collect() as changes:
        fill_sheet(sheet, cells)
        S.workbook.refresh_cross_sheet()
    others = [ch for ch in changes if ch[0] != sheet.name]
    return {"snapshot": {sheet.name: snapshot(sheet)},
            "cells": _cells(others), "py": _py_diff(),
            "pyPending": _py_pending()}


async def op_add_sheet(args):
    from .workbook import fill_sheet, snapshot
    wb = S.workbook
    sheet = wb.add_sheet(args.get("name") or None)
    index = args.get("index")
    if index is not None:
        wb.sheets.remove(sheet)
        wb.sheets.insert(max(0, min(int(index), len(wb.sheets))), sheet)
    cells = args.get("cells") or []
    sheet.cell_formats = {(int(r), int(c)): f
                          for r, c, f in args.get("numfmts") or [] if f}
    with wb._collect() as changes:
        if cells:
            await ensure_for_sources([c[2] for c in cells], wb.trusted)
            fill_sheet(sheet, cells)
        wb.refresh_cross_sheet()
    return {"sheets": _sheet_names(), "name": sheet.name,
            "snapshot": {sheet.name: snapshot(sheet)},
            "cells": _cells([ch for ch in changes if ch[0] != sheet.name]),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_rename_sheet(args):
    _r, changes = await _changing(S.workbook.rename_sheet, args["old"],
                                  args["new"])
    return {"sheets": _sheet_names(), "cells": _cells(changes)}


async def op_remove_sheet(args):
    _r, changes = await _changing(S.workbook.remove_sheet, args["name"])
    return {"sheets": _sheet_names(), "cells": _cells(changes),
            "py": _py_diff(), "pyPending": _py_pending()}


async def op_move_sheet(args):
    wb = S.workbook
    sheet = _sheet({"sheet": args["name"]})
    wb.sheets.remove(sheet)
    wb.sheets.insert(max(0, min(int(args["index"]), len(wb.sheets))), sheet)
    return {"sheets": _sheet_names()}


async def _trust_all():
    """Trust every =PY cell of the workbook and run them; returns what
    the cells show afterwards."""
    from khervesheet.core.python import PythonRuntime, source_hash, \
        is_python_source
    wb = S.workbook
    sources = [src for sheet in wb.sheets
               for src in sheet._cell_formulas.values()
               if is_python_source(src)]
    trusted = set(wb.trusted or ()) | {source_hash(s) for s in sources}
    await ensure_for_sources(sources)
    if wb.python is None:
        wb.python = PythonRuntime()
    _refresh_py_globals()
    with wb._collect() as changes:
        wb.enable_python(wb.python, trusted)
    return changes


async def op_trust(args):
    """Run the workbook's =PY cells (the user trusts them all)."""
    changes = await _trust_all()
    return {"cells": _cells(changes), "py": _py_diff(), "pyPending": 0}


async def op_py_names(args):
    """Names in the =PY namespace, for the Python editor's autocomplete
    (the desktop's _DialogCodeEditor reads runtime._globals)."""
    wb = S.workbook
    rt = getattr(wb, "python", None) if wb else None
    g = getattr(rt, "_globals", None) or {}
    return {"names": sorted(k for k in g if not k.startswith("_"))}


async def op_science(args):
    """The Science menu's first seven tools (the desktop's science.py
    _compute methods): X/Y in, (header, values) columns out."""
    import numpy as np
    tool = args.get("tool")
    o = args.get("opts") or {}
    y = np.array([np.nan if v is None else v for v in args.get("y") or []],
                 dtype=float)
    if y.size == 0:
        raise ValueError("Select a Y range first.")
    xs = args.get("x")
    x = (np.array([np.nan if v is None else v for v in xs], dtype=float)
         if xs else np.arange(y.size, dtype=float))
    n = min(x.size, y.size)
    x, y = x[:n], y[:n]
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    if x.size < 2:
        raise ValueError("Need at least two finite data points.")
    order = np.argsort(x)
    x, y = x[order], y[order]
    message = None
    if tool == "Normalisation":
        lo, hi = float(o.get("lo", 0.0)), float(o.get("hi", 1.0))
        ymin, ymax = float(np.min(y)), float(np.max(y))
        if ymax == ymin:
            raise ValueError("Y is constant \u2014 cannot normalise.")
        cols = [(f"norm[{lo:g},{hi:g}]",
                 (y - ymin) / (ymax - ymin) * (hi - lo) + lo)]
    elif tool == "Integration":
        try:
            from numpy import trapezoid as _trapz
        except ImportError:
            from numpy import trapz as _trapz
        if o.get("mode") == 1:
            total = float(_trapz(y, x))
            message = f"Definite integral = {total:.6g}"
            cols = [("integral", np.array([total]))]
        else:
            try:
                from scipy.integrate import cumulative_trapezoid as _cum
            except ImportError:
                from scipy.integrate import cumtrapz as _cum
            cols = [("cum_integral", _cum(y, x, initial=0.0))]
    elif tool == "Derivative":
        d = np.gradient(y, x)
        label = "dy/dx"
        if o.get("order") == 1:
            d = np.gradient(d, x)
            label = "d2y/dx2"
        cols = [(label, d)]
    elif tool == "Smooth":
        win = int(o.get("window", 5))
        if o.get("method") == 1:
            from scipy.signal import savgol_filter
            if win % 2 == 0:
                win += 1
            win = min(win, y.size if y.size % 2 else y.size - 1)
            poly = min(int(o.get("poly", 2)), win - 1)
            cols = [(f"savgol{win}", savgol_filter(y, win, poly))]
        else:
            win = min(win, y.size)
            cols = [(f"avg{win}",
                     np.convolve(y, np.ones(win) / win, mode="same"))]
    elif tool == "FFT":
        n = y.size
        dx = float(np.mean(np.diff(x))) if n > 1 else 1.0
        if dx <= 0:
            dx = 1.0
        freq = np.fft.rfftfreq(n, d=dx)
        spec = np.fft.rfft(y)
        kind = o.get("kind", "Magnitude")
        if kind == "Power":
            mag, label = (np.abs(spec) ** 2) / n, "power"
        elif kind == "Amplitude":
            mag, label = np.abs(spec) * 2.0 / n, "amplitude"
        else:
            mag, label = np.abs(spec), "magnitude"
        cols = [("freq", freq), (label, mag)]
    elif tool == "Interpolation":
        from scipy.interpolate import interp1d
        x, idx = np.unique(x, return_index=True)
        y = y[idx]
        if x.size < 2:
            raise ValueError("Need at least two unique X values.")
        f = interp1d(x, y, kind=o.get("kind", "linear"),
                     bounds_error=False, fill_value="extrapolate")
        xn = np.linspace(x.min(), x.max(), int(o.get("points", 200)))
        cols = [("x_interp", xn), ("y_interp", f(xn))]
    elif tool == "Find Peaks":
        from scipy.signal import find_peaks
        kw = {"distance": int(o.get("distance", 1))}
        if o.get("height") is not None:
            kw["height"] = float(o["height"])
        if o.get("prominence") is not None:
            kw["prominence"] = float(o["prominence"])
        idx, _props = find_peaks(y, **kw)
        if idx.size == 0:
            return {"columns": [],
                    "message": "No peaks found with these settings."}
        cols = [("peak_x", x[idx]), ("peak_y", y[idx])]
    else:
        raise ValueError(f"Unknown tool: {tool}")
    return {"columns": [[h, [float(v) if np.isfinite(v) else None
                             for v in np.asarray(a, dtype=float)]]
                        for h, a in cols],
            "message": message}


async def op_recalc(args):
    """Evaluate every formula again (F9): random numbers, =PY cells…"""
    from khervesheet.core.python import is_python_source
    wb = S.workbook
    sources = [s for sheet in wb.sheets for s in sheet._cell_formulas.values()]
    await ensure_for_sources(sources, wb.trusted)
    with wb._collect() as changes:
        for sheet in wb.sheets:
            cells = list(sheet._cell_formulas)
            only = args.get("python")
            if only:
                cells = [k for k in cells
                         if is_python_source(sheet._cell_formulas[k])]
                if only is not True:
                    cells = [k for k in cells if sheet.name == only[0]
                             and [k[0], k[1]] == list(only[1:3])]
            for r, c in cells:
                sheet._reeval_formula_cell(r, c)
            if cells:
                sheet._recalc_from_seeds(cells)
        wb.refresh_cross_sheet()
    return {"cells": _cells(changes), "py": _py_diff()}


def _load_answer():
    from khervesheet.core.python import is_python_source
    from .workbook import snapshot
    wb = S.workbook
    return {"sheets": _sheet_names(),
            "snapshot": {s.name: snapshot(s) for s in wb.sheets},
            "py": _py_diff(), "pyPending": _py_pending(),
            "pythonCells": sum(1 for s in wb.sheets
                               for src in s._cell_formulas.values()
                               if is_python_source(src))}


async def _start(sheets, trust_python=False):
    """A new workbook from [{"name", "rows", "cols", "cells": {(r, c):
    source}, "numfmts": {(r, c): fmt}}], loaded like a saved file."""
    from khervesheet.core.engine import DEFAULT_COLS, DEFAULT_ROWS
    from .workbook import WebWorkbook, settle
    wb = WebWorkbook()
    S.workbook = wb
    S.py_sent = {}
    names = []
    for sh in sheets:
        name = sh["name"]
        if wb.sheet_by_name(name) is not None:
            name = f"{name} ({len(wb.sheets) + 1})"
        sheet = wb.add_sheet(name, max(int(sh.get("rows") or 0),
                                       DEFAULT_ROWS),
                             max(int(sh.get("cols") or 0), DEFAULT_COLS))
        sheet.cell_formats.update(sh.get("numfmts") or {})
        names.append(name)
    all_sources = [s for sh in sheets for s in sh["cells"].values()]
    await ensure_for_sources(all_sources, set() if not trust_python
                             else None)
    wb.load({name: sh["cells"] for name, sh in zip(names, sheets)})
    settle(wb)
    if trust_python:
        await _trust_all()
    return names


def _numfmts(formats):
    out = {}
    for key, fmt in (formats or {}).items():
        if isinstance(fmt, dict) and fmt.get("number_format"):
            r, c = key.split(",")
            out[(int(r), int(c))] = fmt["number_format"]
    return out


async def op_load_ksheet(args):
    from .chartsio import spec_from_desktop
    from .ksheetio import read_ksheet
    await ensure(["h5py"])
    book = read_ksheet(base64.b64decode(args["data"]))
    for sh in book["sheets"]:
        sh["numfmts"] = _numfmts(sh["formats"])
    names = await _start(book["sheets"], bool(args.get("trust")))
    layouts = []
    for name, sh in zip(names, book["sheets"]):
        charts = []
        for d in sh["charts"]:
            try:
                charts.append(spec_from_desktop(d))
            except Exception:
                pass
        layouts.append({
            "name": name, "rows": sh["rows"], "cols": sh["cols"],
            "formats": sh["formats"], "merges": sh["merges"],
            "widths": sh["widths"], "designations": sh["designations"],
            "insertOps": sh["insertOps"], "pyLoops": sh["pyLoops"],
            "charts": charts, "images": sh["images"],
            "shapes": sh["shapes"], "equations": sh["equations"],
            "solverConfig": sh["solverConfig"],
            "fitConfig": sh["fitConfig"],
            "rowHeights": sh["rowHeights"], "freeze": sh["freeze"]})
    answer = _load_answer()
    answer.update({"layouts": layouts,
                   "layoutSettings": book["layoutSettings"]})
    return answer


async def op_save_ksheet(args):
    from .ksheetio import write_ksheet
    await ensure(["h5py"])
    if any(t for sh in args.get("sheets") or []
           for ch in sh.get("charts") or [] for t in ch.get("trendlines")
           or []):
        await ensure(["scipy"])
    data = write_ksheet(S.workbook, args)
    return {"data": base64.b64encode(data).decode("ascii")}


def _csv_rows(text):
    import csv
    import io
    text = text.lstrip("﻿")
    sample = text[:4096]
    delimiter = ","
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
    except csv.Error:
        if "\t" in sample and "," not in sample:
            delimiter = "\t"
    return list(csv.reader(io.StringIO(text), delimiter=delimiter))


async def op_load_csv(args):
    rows = _csv_rows(args.get("text") or "")
    cells = {(r, c): v for r, row in enumerate(rows)
             for c, v in enumerate(row) if v}
    sheet = {"name": args.get("name") or "Sheet1", "rows": len(rows),
             "cols": max((len(r) for r in rows), default=0), "cells": cells}
    await _start([sheet])
    return _load_answer()


async def op_export_csv(args):
    import csv
    import io
    from .workbook import used_extent
    sheet = _sheet(args)
    rows, cols = used_extent(sheet)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in range(rows):
        w.writerow([sheet.texts.get((r, c), "") for c in range(cols)])
    return {"text": buf.getvalue()}


async def op_load_xlsx(args):
    from .chartsio import spec_from_xlsx
    await ensure(["openpyxl"])
    from khervesheet.core.xlsx import read_xlsx
    book = read_xlsx(base64.b64decode(args["data"]))
    sheets = []
    for sh in book["sheets"]:
        numfmts = {(int(r), int(c)): f["number_format"]
                   for r, c, f in sh["formats"] if f.get("number_format")}
        sheets.append({"name": sh["name"], "rows": sh["rows"],
                       "cols": sh["cols"], "numfmts": numfmts,
                       "cells": {(int(r), int(c)): s
                                 for r, c, s in sh["cells"]}})
    names = await _start(sheets)
    widths_px = {sh["name"]: dict((int(c), int(px)) for c, px in sh["widths"])
                 for sh in book["sheets"]}
    layouts = []
    for name, sh in zip(names, book["sheets"]):
        wmap = widths_px.get(sh["name"], {})

        def col_left(col, wmap=wmap):
            return sum(wmap.get(c, 80) for c in range(col))

        charts = [spec_from_xlsx(spec, col_left, lambda row: row * 20)
                  for spec in book["charts"] if spec.get("sheet") == sh["name"]]
        layouts.append({
            "name": name, "rows": sh["rows"], "cols": sh["cols"],
            "formats": {f"{r},{c}": f for r, c, f in sh["formats"]},
            "widths": wmap, "charts": charts,
            "freeze": [sh.get("freezeRows") or 0, sh.get("freezeCols") or 0]})
    answer = _load_answer()
    answer["layouts"] = layouts
    return answer


async def op_save_xlsx(args):
    await ensure(["openpyxl"])
    from khervesheet.core.xlsx import write_xlsx
    data = write_xlsx(S.workbook, args)
    return {"data": base64.b64encode(data).decode("ascii")}


async def op_charts(args):
    """Draw charts: [{"id", "sheet", "spec"}] → [{"id", "svg", "fits"}]."""
    from .chartsio import render
    items = args.get("charts") or []
    needs = {"matplotlib"}
    if any(it["spec"].get("trendlines") for it in items):
        needs.add("scipy")
    await ensure(needs)
    out = []
    for it in items:
        try:
            res = render(S.workbook, it["sheet"], it["spec"])
            out.append({"id": it["id"], "svg": res["svg"],
                        "fits": res["fits"]})
        except Exception as exc:
            out.append({"id": it["id"],
                        "error": f"{type(exc).__name__}: {exc}"})
    return {"charts": out}


async def op_values(args):
    sheet = _sheet(args)
    values = S.workbook.range_values(args["ref"], sheet=sheet.name)
    return {"values": [_finite(v) if not isinstance(v, str) else v
                       for v in values]}


async def op_solve(args):
    from khervesheet.core import solver as core_solver
    sheet = _sheet(args)
    await ensure(["scipy"])
    objective = core_solver.parse_ref(args["objective"])
    variables = core_solver.parse_range(args["variables"])
    if objective is None:
        raise ValueError("The objective must be one cell, e.g. B10.")
    if not variables:
        raise ValueError("Choose the cells to change, e.g. B2:B4.")
    constraints = []
    for con in args.get("constraints") or []:
        cell = core_solver.parse_ref(con["cell"])
        if cell is None:
            raise ValueError(f"Not a cell: {con['cell']!r}")
        constraints.append(core_solver.Constraint(cell, con["op"],
                                                  float(con["value"])))
    problem = core_solver.Problem(
        objective=objective, variables=variables,
        goal=args.get("goal", "min"), target=float(args.get("target") or 0),
        constraints=constraints, non_negative=bool(args.get("nonNegative")),
        method=args.get("method") or "GRG Nonlinear")
    before = {rc: sheet.sources.get(rc, "") for rc in variables}
    host = core_solver.EngineHost(sheet)
    with S.workbook._collect() as changes:
        try:
            outcome = core_solver.solve(host, problem)
        except Exception:
            from .workbook import type_cells
            type_cells(sheet, [(r, c, s) for (r, c), s in before.items()])
            raise
        if outcome.x is None:
            from .workbook import type_cells
            type_cells(sheet, [(r, c, s) for (r, c), s in before.items()])
        else:
            from .workbook import type_cells
            cells = list(dict.fromkeys(variables))
            type_cells(sheet, [
                (r, c, core_solver.display_number(
                    v, sheet._cell_decimals(r, c)))
                for (r, c), v in zip(cells, outcome.x)])
    value = sheet._value(*objective)
    return {"cells": _cells(changes),
            "sources": _sources([(sheet, r, c) for r, c in variables]),
            "outcome": {"success": bool(outcome.success),
                        "found": outcome.x is not None,
                        "message": outcome.message,
                        "objective": _finite(value)
                        if isinstance(value, float) else None},
            "py": _py_diff()}


OPS = {name[3:]: fn for name, fn in globals().items()
       if name.startswith("op_")}


async def run(payload: str) -> None:
    """Answer a batch of requests (see the module docstring)."""
    try:
        requests = json.loads(payload)
    except ValueError as exc:
        requests = []
        answers = [{"ok": False, "error": f"Bad request: {exc}"}]
    else:
        answers = []
    for req in requests:
        op = req.get("op")
        fn = OPS.get(op)
        try:
            if fn is None:
                raise ValueError(f"Unknown request {op!r}")
            if op not in ("init", "new", "load_ksheet", "load_csv",
                          "load_xlsx") and S.workbook is None:
                raise RuntimeError("No workbook is open.")
            result = await fn(req.get("args") or {})
            answers.append({"ok": True, **result})
        except Exception as exc:
            answers.append({"ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                            "trace": traceback.format_exc()})
    try:
        text = json.dumps(answers, default=_default, allow_nan=False)
    except ValueError:
        text = json.dumps(_sanitize(answers), default=_default)
    sys.stdout.write(START + text + END)
    sys.stdout.flush()


def _sanitize(o):
    """NaN and infinities (not JSON) become null."""
    if isinstance(o, float):
        return _finite(o)
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize(v) for v in o]
    return o


def _default(o):
    try:
        import numpy as np
        if isinstance(o, np.generic):
            return _finite(o.item())
        if isinstance(o, np.ndarray):
            return [_finite(v) for v in o.tolist()]
    except ImportError:
        pass
    if isinstance(o, (set, tuple)):
        return list(o)
    return str(o)
