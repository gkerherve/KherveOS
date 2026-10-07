"""Python (=PY) cells without Qt: the shared namespace every =PY cell of a
workbook runs in, reading cells with ks("A1:B10"), writing with ks_set(),
and turning results into what a cell shows (a value, a spilled list, a
matplotlib figure as SVG, or a live object).

Used by the Qt-free engine (KherveCELL, in the browser's Python); the
desktop's python_engine follows the same rules.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import ast
import hashlib
import re
from typing import Optional

from .refs import letter_to_col_index
from .values import BLANK

PY_MARKER = "=PY"

# ks("A1"), cell('A1:B10'), ks("Sheet1!A1"): the cells a =PY cell reads,
# registered as its dependencies.
_XL_CALL = re.compile(r"\b(?:ks|xl|cell)\s*\(\s*([\"'])(.+?)\1")

_REF_RE = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d{1,7})$")
_RANGE_RE = re.compile(
    r"^\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*:\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})$")


def is_python_source(text) -> bool:
    """True if *text* is a Python cell: the =PY marker, then the end, a
    space or a line break (so =PYTHAGORAS(…) stays a formula)."""
    if not isinstance(text, str):
        return False
    s = text.lstrip()
    return (s[:len(PY_MARKER)].upper() == PY_MARKER
            and s[len(PY_MARKER):len(PY_MARKER) + 1] in ("", " ", "\n",
                                                         "\r", "\t"))


def strip_marker(text: str) -> str:
    """The Python code of a =PY cell."""
    body = text.lstrip()[len(PY_MARKER):]
    if body[:1] in ("\n", " "):
        body = body[1:]
    return body


def extract_refs(code: str):
    """The A1 references used in ks()/xl()/cell() calls in *code*."""
    return [m.group(2) for m in _XL_CALL.finditer(code or "")]


def source_hash(text: str) -> str:
    """What a viewer approves: the exact source of a =PY cell."""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


# ── Results ──────────────────────────────────────────────────────────
class PyResult:
    SCALAR = "scalar"
    ARRAY1D = "array1d"
    ARRAY2D = "array2d"
    OBJECT = "object"
    FIGURE = "figure"
    NONE = "none"

    def __init__(self, value=None, kind=NONE, svg=None, error=None,
                 stdout=""):
        self.value = value
        self.kind = kind
        self.svg = svg          # a figure, drawn as SVG
        self.error = error      # the traceback, or None
        self.stdout = stdout    # what print() wrote

    @property
    def ok(self):
        return self.error is None


def classify(value):
    """(kind, normalised value) of what a =PY cell returned."""
    if value is None:
        return PyResult.NONE, None
    try:
        from matplotlib.figure import Figure
        if isinstance(value, Figure):
            return PyResult.FIGURE, value
    except Exception:
        pass
    if isinstance(value, (bool, int, float, complex, str)):
        return PyResult.SCALAR, value
    try:
        import numpy as np
        if isinstance(value, np.generic):
            return PyResult.SCALAR, value.item()
    except Exception:
        pass
    # Lists and tuples spill into the grid (nested ones as a block);
    # arrays, DataFrames, dicts… stay live objects in the cell.
    if isinstance(value, (list, tuple)):
        seq = list(value)
        if seq and all(isinstance(r, (list, tuple)) for r in seq):
            return PyResult.ARRAY2D, [list(r) for r in seq]
        if all(not isinstance(r, (list, tuple, dict)) for r in seq):
            return PyResult.ARRAY1D, seq
    return PyResult.OBJECT, value


def badge_for(value) -> str:
    """What a cell holding a live object shows."""
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            shape = ", ".join(str(d) for d in value.shape)
            if value.ndim == 1:
                shape += ","
            return f"▮ ndarray({shape})"
    except Exception:
        pass
    try:
        import pandas as pd
        if isinstance(value, pd.DataFrame):
            return f"▮ DataFrame[{value.shape[0]}×{value.shape[1]}]"
        if isinstance(value, pd.Series):
            return f"▮ Series[{len(value)}]"
    except Exception:
        pass
    if isinstance(value, dict):
        return f"▮ dict[{len(value)}]"
    return f"▮ {type(value).__name__}"


def figure_svg(figure) -> str:
    import io
    out = io.StringIO()
    figure.savefig(out, format="svg", bbox_inches="tight", facecolor="white")
    return out.getvalue()


# ── References ───────────────────────────────────────────────────────
def parse_ref_coords(ref: str):
    """"A1" or "A1:B10" → (r1, c1, r2, c2), 0-based, normalised."""
    ref = ref.strip()
    m = _REF_RE.match(ref)
    if m:
        c = letter_to_col_index(m.group(1))
        r = int(m.group(2)) - 1
        return r, c, r, c
    m = _RANGE_RE.match(ref)
    if not m:
        raise ValueError(f"bad cell reference: {ref!r}")
    c1 = letter_to_col_index(m.group(1))
    r1 = int(m.group(2)) - 1
    c2 = letter_to_col_index(m.group(3))
    r2 = int(m.group(4)) - 1
    return min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)


def _read_one(sheet, r, c):
    """A live object if the cell holds one, else its value."""
    objects = getattr(sheet, "_py_objects", None)
    if objects and (r, c) in objects:
        return objects[(r, c)]
    v = sheet._value(r, c)
    if v is BLANK:
        return None
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def resolve_ref(sheet, ref: str):
    """"A1" → a value; "A1:A9" → a 1-D array; "A1:C9" → a 2-D array;
    "Sheet2!A1" reads another sheet."""
    ref = ref.strip()
    if "!" in ref:
        name, _, rest = ref.partition("!")
        target = sheet.workbook.sheet_by_name(name.strip().strip("'"))
        if target is None:
            raise ValueError(f"unknown sheet: {name!r}")
        return resolve_ref(target, rest.strip())
    r1, c1, r2, c2 = parse_ref_coords(ref)
    if (r1, c1) == (r2, c2):
        return _read_one(sheet, r1, c1)
    rows = [[_read_one(sheet, r, c) for c in range(c1, c2 + 1)]
            for r in range(r1, r2 + 1)]
    flat = None
    if len(rows) == 1:
        flat = rows[0]
    elif all(len(r) == 1 for r in rows):
        flat = [r[0] for r in rows]
    import numpy as np
    try:
        return np.array(flat if flat is not None else rows, dtype=float)
    except (TypeError, ValueError):
        return flat if flat is not None else rows


def value_to_block(value, r1, c1, r2, c2):
    """Shape what ks_set() writes into rows of values for the range."""
    single_row = r1 == r2 and c2 > c1
    try:
        import numpy as np
        if isinstance(value, np.ndarray):
            if value.ndim == 0:
                return [[value.item()]]
            if value.ndim == 1:
                v = value.tolist()
                return [v] if single_row else [[x] for x in v]
            return [list(row) for row in value.tolist()]
    except Exception:
        pass
    if isinstance(value, (list, tuple)):
        seq = list(value)
        if seq and all(isinstance(x, (list, tuple)) for x in seq):
            return [list(x) for x in seq]
        return [seq] if single_row else [[x] for x in seq]
    return [[value for _ in range(c1, c2 + 1)] for _ in range(r1, r2 + 1)]


# ── The runtime ──────────────────────────────────────────────────────
class PythonRuntime:
    """The namespace shared by every =PY cell of a workbook."""

    def __init__(self, timeout: float = 30.0):
        self._globals: Optional[dict] = None
        self._sheet = None
        self._cur_cell = None
        self._written = None
        #: Seconds a cell may run before it is stopped (0: no limit).
        self.timeout = timeout

    def _ensure_globals(self):
        if self._globals is not None:
            return self._globals
        g = {"__builtins__": __builtins__}
        import math
        g["math"] = math
        try:
            import numpy as np
            if not hasattr(np, "trapezoid"):
                np.trapezoid = np.trapz          # type: ignore[attr-defined]
            g["np"] = g["numpy"] = np
        except Exception:
            pass
        for module, names in (("matplotlib.pyplot", ("plt",)),
                              ("pandas", ("pd", "pandas")),
                              ("scipy", ("scipy",))):
            try:
                if module == "matplotlib.pyplot":
                    import matplotlib
                    matplotlib.use("Agg", force=False)
                imported = __import__(module, fromlist=["_"])
            except Exception:
                continue
            for name in names:
                g[name] = imported
        g["ks"] = g["xl"] = g["cell"] = self._ks
        g["ks_set"] = g["write"] = self._ks_set
        self._globals = g
        return g

    def reset(self):
        self._globals = None

    def _ks(self, ref):
        if self._sheet is None:
            raise RuntimeError("ks() is only available inside a =PY cell")
        return resolve_ref(self._sheet, str(ref))

    def _ks_set(self, ref, value):
        sheet = self._sheet
        if sheet is None:
            raise RuntimeError("ks_set() is only available inside a =PY cell")
        if "!" in str(ref):
            raise ValueError("ks_set() cannot write to another sheet")
        sheet._py_write(parse_ref_coords(str(ref)), value, self._cur_cell,
                        self._written)
        return value

    def run(self, code: str, sheet, row: int, col: int) -> PyResult:
        """Run *code* for the cell (row, col) of *sheet*."""
        import contextlib
        import io
        import traceback

        g = self._ensure_globals()
        prev = (self._sheet, self._cur_cell, self._written)
        self._sheet, self._cur_cell, self._written = sheet, (row, col), set()
        plt = g.get("plt")
        before = set(plt.get_fignums()) if plt is not None else set()
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                value = self._with_time_limit(
                    lambda: self._exec_with_value(code, g))
        except TimeoutError as exc:
            return PyResult(error=f"TimeoutError: {exc}",
                            stdout=buf.getvalue())
        except Exception:
            return PyResult(error=traceback.format_exc(),
                            stdout=buf.getvalue())
        finally:
            self.last_writes = self._written or set()
            self._sheet, self._cur_cell, self._written = prev
        out = buf.getvalue()
        kind, norm = classify(value)
        figure = norm if kind == PyResult.FIGURE else None
        if figure is None and plt is not None:
            new = [n for n in plt.get_fignums() if n not in before]
            if new:
                figure = plt.figure(new[-1])
        if figure is not None:
            try:
                svg = figure_svg(figure)
            finally:
                if plt is not None:
                    plt.close(figure)
            return PyResult(value=None, kind=PyResult.FIGURE, svg=svg,
                            stdout=out)
        return PyResult(value=norm, kind=kind, stdout=out)

    def _with_time_limit(self, fn):
        """Stop *fn* when it runs past the time limit: checked on every
        Python line (no thread, so it works in the browser too)."""
        if not self.timeout or self.timeout <= 0:
            return fn()
        import sys
        import time
        deadline = time.monotonic() + self.timeout
        limit = self.timeout

        def trace(frame, event, arg):
            if time.monotonic() > deadline:
                raise TimeoutError(
                    f"execution exceeded {limit:g} s — possible infinite "
                    "loop. Increase the limit or fix the code.")
            return trace

        old = sys.gettrace()
        sys.settrace(trace)
        try:
            return fn()
        finally:
            sys.settrace(old)

    @staticmethod
    def _exec_with_value(code, g):
        """Run the code; the value of a final expression is the result."""
        tree = ast.parse(code, "<py-cell>", "exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body[-1].value)
            head = ast.Module(body=tree.body[:-1], type_ignores=[])
            exec(compile(head, "<py-cell>", "exec"), g)        # noqa: S102
            return eval(compile(last, "<py-cell>", "eval"), g)  # noqa: S307
        exec(compile(tree, "<py-cell>", "exec"), g)            # noqa: S102
        return None
