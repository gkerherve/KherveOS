"""Editing whole ranges on the engine: the fill handle, paste, sort, and
inserting or deleting rows and columns.

Fill follows the desktop sheet (``_apply_fill_*``, ``_detect_pattern``):
formulas are copied with their relative references shifted
(``core.refs.shift_formula``), values continue a linear series or repeat.
Inserting and deleting move cells without re-typing them and adjust the
references that point past the change, as Excel does (a reference into
deleted cells becomes #REF!).

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import re

from khervesheet.core.python import _XL_CALL, is_python_source
from khervesheet.core.refs import (
    XREF_PATTERN, col_index_to_letter, letter_to_col_index, shift_formula,
)
from khervesheet.core.values import BLANK

from .workbook import _Deps, put_raw, type_cells


# ── Fill (the fill handle, Ctrl+D, Ctrl+R) ───────────────────────────
def _number_text(value: float) -> str:
    """A filled number as typed text, without float noise."""
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return format(value, ".15g")


def detect_pattern(vals):
    """The desktop's series detection over the source texts."""
    nums = []
    for v in vals:
        try:
            nums.append(float(v))
        except (TypeError, ValueError):
            nums.append(None)
    if all(n is not None for n in nums) and len(nums) >= 2:
        diffs = [nums[i + 1] - nums[i] for i in range(len(nums) - 1)]
        if all(abs(d - diffs[0]) < 1e-12 for d in diffs):
            return {"type": "linear", "start": nums[0], "step": diffs[0]}
        return {"type": "numeric_repeat", "values": nums}
    if all(n is not None for n in nums) and len(nums) == 1:
        return {"type": "constant", "value": vals[0]}
    return {"type": "repeat", "values": vals}


def pattern_value(pattern, idx, vals):
    """The value *idx* steps from the first source cell (negative: before)."""
    kind = pattern["type"]
    n = len(vals)
    if kind == "linear":
        return _number_text(pattern["start"] + pattern["step"] * idx)
    if kind == "constant":
        return pattern["value"]
    if kind == "numeric_repeat":
        return _number_text(pattern["values"][idx % n])
    return pattern["values"][idx % n]


def fill(sheet, src, dst):
    """Fill *dst* from *src* (both (r1, c1, r2, c2)); *dst* contains *src*
    and extends it in one direction. Returns the cells written."""
    sr1, sc1, sr2, sc2 = src
    dr1, dc1, dr2, dc2 = dst
    out = []

    def run(cells, positions, along):
        """cells: the source line's (r, c); positions: target (r, c) with
        their offset from the first source cell along the fill."""
        sources = [sheet.sources.get(rc, "") for rc in cells]
        formulas = [s if s.startswith("=") and s != "=" else None
                    for s in sources]
        n = len(cells)
        if any(formulas):
            for (r, c), k in positions:
                i = k % n
                f = formulas[i]
                if f is None:
                    out.append((r, c, sources[i]))
                elif is_python_source(f):
                    out.append((r, c, f))
                else:
                    d = k - i
                    out.append((r, c, shift_formula(
                        f, d if along == "rows" else 0,
                        d if along == "cols" else 0)))
        else:
            pattern = detect_pattern(sources)
            for (r, c), k in positions:
                out.append((r, c, pattern_value(pattern, k, sources)))

    if dr2 > sr2 or dr1 < sr1:          # down or up
        for c in range(sc1, sc2 + 1):
            cells = [(r, c) for r in range(sr1, sr2 + 1)]
            rows = list(range(sr2 + 1, dr2 + 1)) + list(range(dr1, sr1))
            run(cells, [((r, c), r - sr1) for r in rows], "rows")
    elif dc2 > sc2 or dc1 < sc1:        # right or left
        for r in range(sr1, sr2 + 1):
            cells = [(r, c) for c in range(sc1, sc2 + 1)]
            cols = list(range(sc2 + 1, dc2 + 1)) + list(range(dc1, sc1))
            run(cells, [((r, c), c - sc1) for c in cols], "cols")
    type_cells(sheet, out)
    return [(r, c) for r, c, _s in out]


# ── Paste ────────────────────────────────────────────────────────────
def paste(sheet, at, rows, shift=None):
    """Paste a block of sources at *at* (r, c). Formulas are typed (their
    relative references shifted by *shift* when they come from this app's
    own copy); values are put as they are, like the desktop's paste."""
    r0, c0 = int(at[0]), int(at[1])
    typed, raw, written = [], [], []
    for i, line in enumerate(rows):
        for j, src in enumerate(line):
            r, c = r0 + i, c0 + j
            src = "" if src is None else str(src)
            written.append((r, c))
            if src.startswith("=") and src != "=":
                if shift and not is_python_source(src):
                    src = shift_formula(src, int(shift[0]), int(shift[1]))
                typed.append((r, c, src))
            else:
                raw.append((r, c, src, src, None))
    if raw:
        put_raw(sheet, raw)
    if typed:
        type_cells(sheet, typed)
    return written


# ── Sort ─────────────────────────────────────────────────────────────
def _sort_key(v):
    if isinstance(v, float):
        return (0, v, "")
    return (1, 0.0, str(v).lower())


def sort_range(sheet, rng, key_col, ascending=True, header=False):
    """Sort the rows of *rng* (r1, c1, r2, c2) by column *key_col*.
    Empty keys go last either way; formulas keep pointing at their own
    row (relative references move with the row, as in Excel).
    Returns [(new row, old row)…]."""
    r1, c1, r2, c2 = rng
    start = r1 + 1 if header else r1
    rows = list(range(start, r2 + 1))
    filled = [r for r in rows if sheet._value(r, key_col) is not BLANK]
    blank = [r for r in rows if sheet._value(r, key_col) is BLANK]
    filled.sort(key=lambda r: _sort_key(sheet._value(r, key_col)),
                reverse=not ascending)
    order = filled + blank
    old = {}
    for r in rows:
        for c in range(c1, c2 + 1):
            key = (r, c)
            src = sheet.sources.get(key, "")
            old[key] = (src, sheet.texts.get(key, "") if src else "",
                        sheet._precise.get(key))
    old_nf = {(r, c): sheet.cell_formats.get((r, c))
              for r in rows for c in range(c1, c2 + 1)}
    cells = []
    for new_r, old_r in zip(rows, order):
        for c in range(c1, c2 + 1):
            src, text, precise = old[(old_r, c)]
            if src.startswith("=") and src != "=" and \
                    not is_python_source(src):
                src = shift_formula(src, new_r - old_r, 0)
            num = precise[1] if precise and precise[0] == text else None
            cells.append((new_r, c, src, text, num))
            nf = old_nf[(old_r, c)]
            if nf:
                sheet.cell_formats[(new_r, c)] = nf
            else:
                sheet.cell_formats.pop((new_r, c), None)
    put_raw(sheet, cells)
    return list(zip(rows, order))


# ── Inserting and deleting rows / columns ────────────────────────────
class Change:
    """Rows or columns inserted (n > 0) or deleted (n < 0) at *at*."""

    def __init__(self, axis, at, n):
        self.axis = axis            # "rows" or "cols"
        self.at = int(at)
        self.n = int(n)

    def index(self, i):
        """Where index *i* goes; None if it was deleted."""
        if self.n > 0:
            return i + self.n if i >= self.at else i
        gone = -self.n
        if i < self.at:
            return i
        if i < self.at + gone:
            return None
        return i - gone

    def span(self, i1, i2):
        """Where the span i1..i2 goes; None if all of it was deleted."""
        lo, hi = min(i1, i2), max(i1, i2)
        if self.n > 0:
            return self.index(lo), self.index(hi)
        gone = -self.n
        end = self.at + gone
        if lo >= self.at and hi < end:
            return None
        nlo = lo if lo < self.at else (self.at if lo < end else lo - gone)
        nhi = hi if hi < self.at else (self.at - 1 if hi < end else hi - gone)
        return nlo, nhi

    def cell(self, r, c):
        if self.axis == "rows":
            nr = self.index(r)
            return None if nr is None else (nr, c)
        nc = self.index(c)
        return None if nc is None else (r, nc)


_STRING = re.compile(r'"(?:[^"]|"")*"')
_RANGE = re.compile(
    r"(?<![A-Za-z0-9_.!$])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})\s*:\s*"
    r"(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])")
_REF = re.compile(
    r"(?<![A-Za-z0-9_.!$:])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})"
    r"(?![A-Za-z0-9_(:])")
_WHOLE_COL = re.compile(
    r"\b(SUM|AVERAGE|AVG|MEAN|MIN|MAX|COUNT|STDEV)(\s*\(\s*)([A-Za-z]{1,3})"
    r"(\s*\))", re.IGNORECASE)
_NOT_COLUMNS = {"PI", "TRUE", "FALSE"}
_A1 = re.compile(r"^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$")
_REF_ERROR = "#REF!"


def _ref_text(d1, letters, d2, row):
    return f"{d1}{letters}{d2}{row}"


def _move_ref(m, change):
    """One A1 reference after *change* (None: deleted)."""
    d1, letters, d2, digits = m[0], m[1], m[2], m[3]
    col = letter_to_col_index(letters)
    row = int(digits) - 1
    if change.axis == "rows":
        nr = change.index(row)
        if nr is None:
            return None
        return _ref_text(d1, letters, d2, nr + 1)
    nc = change.index(col)
    if nc is None:
        return None
    return _ref_text(d1, col_index_to_letter(nc), d2, digits)


def _move_range(g, change):
    """A1:B5 after *change* (None: all of it deleted)."""
    (a1, al, a2, ad), (b1, bl, b2, bd) = g[:4], g[4:]
    ca, cb = letter_to_col_index(al), letter_to_col_index(bl)
    ra, rb = int(ad) - 1, int(bd) - 1
    if change.axis == "rows":
        span = change.span(ra, rb)
        if span is None:
            return None
        lo, hi = span
        if ra > rb:
            lo, hi = hi, lo
        return f"{a1}{al}{a2}{lo + 1}:{b1}{bl}{b2}{hi + 1}"
    span = change.span(ca, cb)
    if span is None:
        return None
    lo, hi = span
    if ca > cb:
        lo, hi = hi, lo
    return (f"{a1}{col_index_to_letter(lo)}{a2}{ad}:"
            f"{b1}{col_index_to_letter(hi)}{b2}{bd}")


def _move_ref_text(ref, change):
    """"A1" or "A1:B5" (one reference string) after *change*."""
    parts = [p.strip() for p in ref.split(":")]
    if len(parts) == 2:
        ma, mb = _A1.match(parts[0]), _A1.match(parts[1])
        if ma and mb:
            return _move_range(ma.groups() + mb.groups(), change)
        return ref
    m = _A1.match(parts[0])
    return _move_ref(m.groups(), change) if m else ref


def adjust_formula(formula, change, local, target_name):
    """*formula* with its references to the changed sheet adjusted.

    *local*: the formula sits on the changed sheet (its plain references
    point there); cross-sheet references are adjusted when they name it."""
    if is_python_source(formula):
        return _adjust_python(formula, change, local, target_name)
    target = target_name.lower()
    out = []
    pos = 0
    for m in _STRING.finditer(formula):
        out.append(_adjust_code(formula[pos:m.start()], change, local,
                                target))
        out.append(m.group(0))
        pos = m.end()
    out.append(_adjust_code(formula[pos:], change, local, target))
    return "".join(out)


def _adjust_code(code, change, local, target):
    masks = []

    def mask(text):
        masks.append(text)
        return f"\x00{len(masks) - 1}\x00"

    def xref(m):
        name = m.group(1) if m.group(1) is not None else m.group(2)
        if name.strip().lower() != target:
            return mask(m.group(0))
        moved = _move_ref_text(m.group(3), change)
        head = m.group(0)[:m.start(3) - m.start(0)]
        return mask(head + (moved if moved is not None else _REF_ERROR))

    code = XREF_PATTERN.sub(xref, code)
    if local:
        def rng(m):
            moved = _move_range(m.groups(), change)
            return mask(moved if moved is not None else _REF_ERROR)

        def ref(m):
            moved = _move_ref(m.groups(), change)
            return mask(moved if moved is not None else _REF_ERROR)

        def whole(m):
            if change.axis != "cols" or m.group(3).upper() in _NOT_COLUMNS:
                return m.group(0)
            nc = change.index(letter_to_col_index(m.group(3)))
            if nc is None:
                return mask(_REF_ERROR)
            return mask(m.group(1) + m.group(2) + col_index_to_letter(nc)
                        + m.group(4))

        code = _WHOLE_COL.sub(whole, code)
        code = _RANGE.sub(rng, code)
        code = _REF.sub(ref, code)
    return re.sub(r"\x00(\d+)\x00", lambda m: masks[int(m.group(1))], code)


def _adjust_python(source, change, local, target):
    """ks("A1:B5") references inside a =PY cell."""
    def call(m):
        ref = m.group(2)
        name, bang, cells = ref.rpartition("!")
        if bang:
            if name.strip().strip("'").lower() != target.lower():
                return m.group(0)
        elif not local:
            return m.group(0)
        moved = _move_ref_text(cells, change)
        if moved is None or moved == cells:
            return m.group(0)
        new = (name + bang if bang else "") + moved
        return m.group(0).replace(ref, new, 1)
    return _XL_CALL.sub(call, source)


def restructure(workbook, sheet, change):
    """Insert or delete rows/columns of *sheet*; every formula of the
    workbook that points past the change is adjusted. Values keep their
    text; formulas are evaluated again. Returns the cells of other sheets
    whose source changed: [(sheet, r, c)…]."""
    def remap(d):
        out = {}
        for (r, c), v in d.items():
            nk = change.cell(r, c)
            if nk is not None:
                out[nk] = v
        return out

    for key in list(sheet._py_outputs):
        sheet._clear_py_outputs(*key)
    sources = remap(sheet.sources)
    texts = {k: v for k, v in remap(sheet.texts).items() if k in sources}
    precise = remap(sheet._precise)
    sheet.cell_formats = remap(sheet.cell_formats)
    sheet.sources, sheet.texts, sheet._precise = {}, {}, {}
    sheet._cell_formulas.clear()
    sheet._dependents = _Deps()
    sheet._xref_cells.clear()
    sheet._py_objects.clear()
    sheet.py_figures.clear()
    sheet.py_errors.clear()
    sheet.py_stdout.clear()
    if change.n > 0:
        if change.axis == "rows":
            sheet.rows += change.n
        else:
            sheet.cols += change.n

    cells = []
    for (r, c), src in sorted(sources.items()):
        if src.startswith("=") and src != "=":
            src = adjust_formula(src, change, True, sheet.name)
            cells.append((r, c, src, None, None))
        else:
            text = texts.get((r, c), "")
            p = precise.get((r, c))
            cells.append((r, c, src, text,
                          p[1] if p and p[0] == text else None))
    from .workbook import fill_sheet
    fill_sheet(sheet, cells)

    touched = []
    for other in workbook.sheets:
        if other is sheet:
            continue
        retyped = []
        for (r, c), src in list(other._cell_formulas.items()):
            new = adjust_formula(src, change, False, sheet.name)
            if new != src:
                retyped.append((r, c, new, None, None))
                touched.append((other, r, c))
        if retyped:
            put_raw(other, retyped)
    workbook.refresh_cross_sheet()
    return touched
