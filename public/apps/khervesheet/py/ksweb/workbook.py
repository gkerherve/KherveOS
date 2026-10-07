"""The core engine's Workbook, as the web app uses it.

``WebWorkbook`` is ``core.engine.Workbook`` with one change of speed, not
of behaviour: each sheet remembers which cells a formula registered as
its inputs, so forgetting a formula's dependencies no longer walks every
dependency of the sheet (that walk made pasting or filling thousands of
formulas quadratic). Formulas, recalculation and values are the core's.

Also here: typing many cells at once (like the desktop's undo replay),
putting cells back exactly as they were (raw restore), and snapshots.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import math

from khervesheet.core.engine import Sheet, Workbook
from khervesheet.core.python import is_python_source
from khervesheet.core.values import BLANK


# ── A dependency map that knows each formula's inputs ────────────────
class _DepSet(set):
    """The formulas reading one cell; adding one records the reverse link."""

    __slots__ = ("ref", "index")

    def add(self, cell):
        set.add(self, cell)
        self.index.setdefault(cell, set()).add(self.ref)


class _Deps(dict):
    """``Sheet._dependents`` (cell → formulas reading it) plus ``index``
    (formula → the cells it reads), kept in step by ``_DepSet.add``."""

    def __init__(self):
        super().__init__()
        self.index = {}

    def setdefault(self, ref, default=None):
        deps = dict.get(self, ref)
        if deps is None:
            deps = _DepSet()
            deps.ref = ref
            deps.index = self.index
            dict.__setitem__(self, ref, deps)
        return deps


class WebSheet(Sheet):
    """A core Sheet whose dependency bookkeeping is indexed."""

    def _unregister_deps(self, row, col):
        key = (row, col)
        self._xref_cells.discard(key)
        deps = self._dependents
        for ref in deps.index.pop(key, ()):
            readers = dict.get(deps, ref)
            if readers is not None:
                set.discard(readers, key)


def _make_web(sheet):
    sheet.__class__ = WebSheet
    sheet._dependents = _Deps()
    return sheet


class WebWorkbook(Workbook):
    """A core Workbook whose sheets are WebSheets."""

    def add_sheet(self, name=None, rows=None, cols=None):
        from khervesheet.core.engine import DEFAULT_COLS, DEFAULT_ROWS
        sheet = super().add_sheet(name, rows or DEFAULT_ROWS,
                                  cols or DEFAULT_COLS)
        return _make_web(sheet)


# ── Values for the page ──────────────────────────────────────────────
def number(sheet, r, c):
    """The cell's number at full precision, or None (text, empty)."""
    v = sheet._value(r, c)
    if v is BLANK or isinstance(v, bool) or not isinstance(v, float):
        return None
    return v if math.isfinite(v) else None


def cell_record(sheet, r, c):
    """[r, c, source, text, number] of one cell."""
    return [r, c, sheet.sources.get((r, c), ""), sheet.texts.get((r, c), ""),
            number(sheet, r, c)]


def snapshot(sheet):
    """Every non-empty cell of a sheet: [[r, c, source, text, number]]."""
    keys = set(sheet.sources) | set(sheet.texts)
    return [cell_record(sheet, r, c) for (r, c) in sorted(keys)]


def used_extent(sheet):
    """(rows, cols) holding a source or a text (0, 0 when empty)."""
    keys = set(sheet.sources) | set(sheet.texts)
    if not keys:
        return 0, 0
    return (max(r for r, _ in keys) + 1, max(c for _, c in keys) + 1)


# ── Typing and restoring ─────────────────────────────────────────────
def type_cells(sheet, cells):
    """Type ``[(r, c, source)…]`` like pressing Enter in each, then
    recalculate what depends on them once (the desktop's undo replay)."""
    seeds = []
    for r, c, source in cells:
        sheet._type(int(r), int(c), source or "")
        seeds.append((int(r), int(c)))
    if seeds:
        sheet._recalc_from_seeds(seeds)
        sheet.workbook.refresh_cross_sheet()


def put_raw(sheet, cells):
    """Put cells back exactly: ``[(r, c, source, text, number)…]``.

    A value keeps the text it showed (no re-typing, so 1.8333 stays
    1.8333); a formula is evaluated again. A text without a source (a
    spilled value) is shown as it was; a missing text (None) types the
    source instead."""
    seeds, formulas, typed = [], [], []
    for item in cells:
        r, c, source, text = int(item[0]), int(item[1]), item[2] or "", item[3]
        num = item[4] if len(item) > 4 else None
        key = (r, c)
        sheet._ensure_size(r, c)
        seeds.append(key)
        if source.startswith("=") and source != "=":
            sheet.sources[key] = source
            sheet._cell_formulas[key] = source
            if is_python_source(source):
                sheet._register_py_deps(r, c, source)
            else:
                sheet._clear_py_outputs(r, c)
                sheet._register_deps(r, c, source)
            formulas.append(key)
            continue
        if text is None:
            typed.append((r, c, source))
            continue
        sheet._clear_py_outputs(r, c)
        sheet._cell_formulas.pop(key, None)
        sheet._unregister_deps(r, c)
        if source:
            sheet.sources[key] = source
        else:
            sheet.sources.pop(key, None)
        sheet._write(r, c, text)
        sheet._remember_value(r, c, text, num if isinstance(
            num, (int, float)) and not isinstance(num, bool) else None)
    for r, c, source in typed:
        sheet._type(r, c, source)
    for r, c in formulas:
        sheet._reeval_formula_cell(r, c)
    if seeds:
        sheet._recalc_from_seeds(seeds)
        sheet.workbook.refresh_cross_sheet()


def clear_sheet(sheet):
    """Forget every cell of a sheet (sources, texts, formulas, outputs)."""
    for key in list(sheet._py_outputs):
        sheet._clear_py_outputs(*key)
    sheet.sources.clear()
    sheet.texts.clear()
    sheet._precise.clear()
    sheet._cell_formulas.clear()
    sheet._dependents = _Deps()
    sheet._xref_cells.clear()
    sheet._py_objects.clear()
    sheet._py_outputs.clear()
    sheet.py_figures.clear()
    sheet.py_errors.clear()
    sheet.py_stdout.clear()


def fill_sheet(sheet, cells):
    """Fill an empty sheet with ``[(r, c, source, text, number)…]``:
    values as they were, formulas evaluated in dependency order."""
    formulas = []
    for item in cells:
        r, c, source, text = int(item[0]), int(item[1]), item[2] or "", \
            item[3] or ""
        num = item[4] if len(item) > 4 else None
        key = (r, c)
        sheet._ensure_size(r, c)
        if source.startswith("=") and source != "=":
            sheet.sources[key] = source
            sheet._cell_formulas[key] = source
            if is_python_source(source):
                sheet._register_py_deps(r, c, source)
            else:
                sheet._register_deps(r, c, source)
            formulas.append(key)
            continue
        if source:
            sheet.sources[key] = source
        if text:
            sheet.texts[key] = text
            if isinstance(num, (int, float)) and not isinstance(num, bool):
                sheet._precise[key] = (text, float(num))
    for r, c in formulas:
        sheet._reeval_formula_cell(r, c)
    if formulas:
        sheet._recalc_from_seeds(formulas)


def settle(workbook, rounds=2):
    """Finish what ``Workbook.load`` started.

    Load evaluates the formulas twice in reading order, which leaves a
    longer chain stale (a fit line reading a slope that reads sums of
    other formulas). Here every formula is evaluated once more after the
    formulas it reads (dependency order), shown the way load shows it."""
    from khervesheet.core.python import is_python_source
    for _round in range(rounds):
        for sheet in workbook.sheets:
            formulas = {k: f for k, f in sheet._cell_formulas.items()
                        if not is_python_source(f)}
            if not formulas:
                continue
            indeg = dict.fromkeys(formulas, 0)
            for u in formulas:
                for v in sheet._dependents.get(u, ()):
                    if v in indeg and v != u:
                        indeg[v] += 1
            queue = [k for k, n in indeg.items() if n == 0]
            order = []
            while queue:
                u = queue.pop()
                order.append(u)
                for v in sheet._dependents.get(u, ()):
                    if v in indeg and v != u:
                        indeg[v] -= 1
                        if indeg[v] == 0:
                            queue.append(v)
            if len(order) < len(formulas):        # a cycle: best effort
                done = set(order)
                order.extend(k for k in formulas if k not in done)
            for r, c in order:
                result = str(sheet._evaluate_formula(formulas[(r, c)], r, c))
                if result:
                    sheet.texts[(r, c)] = result
                else:
                    sheet.texts.pop((r, c), None)
                sheet._remember_value(r, c, result, sheet._last_raw)
