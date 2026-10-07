"""A complete workbook without Qt: what KherveCELL runs in the browser.

It follows the desktop sheet step for step, so the same workbook computes
the same values in both:

- typing a value or formula     → ``SheetWidget._on_cell_changed_impl``
- dependencies and recalculation → ``_register_deps`` / ``_recalc_from_seeds``
- cross-sheet refresh            → ``WorkbookWidget.refresh_cross_sheet``
- loading a saved workbook       → the cell pass of ``MainWindow._load_ksheet``

Cells are addressed (row, col), 0-based.  A cell has a *source* (what was
typed: a value or a formula) and a *text* (what is shown).  Formulas read
the shown text of other cells, exactly as the desktop sheet does.

Python (=PY) cells run only once the workbook is given a runtime and the
cell's code is trusted (see ``Workbook.enable_python``); until then they
show PYTHON_NOT_RUN.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Tuple

from .compiler import compile_formula, evaluate_cell
from .functions import build_namespace, lower_names
from .numbers import format_number, format_value, general_display
from .python import (  # noqa: F401 (is_python_source is re-exported)
    PY_MARKER, PyResult, badge_for, extract_refs, is_python_source,
    source_hash, strip_marker, value_to_block,
)
from .refs import XREF_PATTERN, parse_cell_refs
from .refs import letter_to_col_index
from .values import BLANK, CellValues

Cell = Tuple[int, int]

DEFAULT_ROWS = 5000
DEFAULT_COLS = 50
PYTHON_NOT_RUN = "⟨Python — not run⟩"

_RANGE_END = re.compile(r"\$?([A-Za-z]{1,3})?\$?(\d{1,7})?")


def _range_bounds(cells: str, sheet: "Sheet"):
    """((c1, r1), (c2, r2)) of ``A1``, ``A1:B5``, ``B:B`` or ``3:3``."""
    parts = cells.replace(" ", "").split(":")
    if not 1 <= len(parts) <= 2 or not all(parts):
        raise ValueError(f"Not a range: {cells!r}")
    last_row, last_col = sheet.used_extent()
    ends = []
    for i, part in enumerate(parts * (2 // len(parts))):
        m = _RANGE_END.fullmatch(part)
        if not m or not (m.group(1) or m.group(2)):
            raise ValueError(f"Not a range: {cells!r}")
        col = letter_to_col_index(m.group(1)) if m.group(1) else (
            0 if i == 0 else last_col)
        row = int(m.group(2)) - 1 if m.group(2) else (
            0 if i == 0 else last_row)
        ends.append((col, row))
    (c1, r1), (c2, r2) = ends
    return (min(c1, c2), min(r1, r2)), (max(c1, c2), max(r1, r2))


_DECIMALS = {"0": 0, "0.0": 1, "0.00": 2, "0.000": 3, "0.0000": 4}


class Sheet(CellValues):
    """One sheet of cells.  Create through ``Workbook.add_sheet``."""

    def __init__(self, workbook: "Workbook", name: str,
                 rows: int = DEFAULT_ROWS, cols: int = DEFAULT_COLS):
        self.workbook = workbook
        self.name = name
        self.rows = rows
        self.cols = cols
        #: What was typed in each non-empty cell.
        self.sources: Dict[Cell, str] = {}
        #: What each non-empty cell shows.
        self.texts: Dict[Cell, str] = {}
        #: Number formats ("General", "0.00", "Currency:€", …).
        self.cell_formats: Dict[Cell, str] = {}
        self.column_formats: Dict[int, str] = {}
        self.default_format = "General"

        self._cell_formulas: Dict[Cell, str] = {}
        self._dependents: Dict[Cell, set] = {}
        self._xref_cells: set = set()
        self._compiled_cache: dict = {}
        #: Exact numbers behind rounded text (see core.values).
        self._precise: dict = {}
        self._last_raw = None
        self._eval_ns = None
        self._eval_ns_lower = None
        #: =PY outputs: live objects, cells a run filled (spills and
        #: ks_set), figures as SVG, tracebacks and printed text.
        self._py_objects: Dict[Cell, object] = {}
        self._py_outputs: Dict[Cell, List[Cell]] = {}
        self.py_figures: Dict[Cell, str] = {}
        self.py_errors: Dict[Cell, str] = {}
        self.py_stdout: Dict[Cell, str] = {}

    # ── Reading ──────────────────────────────────────────────────────
    def text(self, row: int, col: int) -> str:
        return self.texts.get((row, col), "")

    def source(self, row: int, col: int) -> str:
        return self.sources.get((row, col), "")

    def formula(self, row: int, col: int) -> Optional[str]:
        return self._cell_formulas.get((row, col))

    def used_extent(self) -> Cell:
        """(last row, last column) holding something; (0, 0) when empty."""
        if not self.texts:
            return 0, 0
        return (max(r for r, _c in self.texts),
                max(c for _r, c in self.texts))

    # CellValues host interface.
    def _cell_text(self, r, c):
        return self.texts.get((r, c), "")

    def row_count(self) -> int:
        return self.rows

    def _workbook(self):
        return self.workbook

    # ── Typing into a cell ───────────────────────────────────────────
    def set_cell(self, row: int, col: int, source: str) -> List[tuple]:
        """Type *source* into a cell, like pressing Enter on the desktop.

        Returns what changed on screen, across the workbook:
        ``[(sheet name, row, col, text), …]``."""
        with self.workbook._collect() as changes:
            self._type(row, col, source or "")
            self._recalc_from_seeds([(row, col)])
            self.workbook.refresh_cross_sheet()
        return changes

    def _type(self, row, col, text):
        self._ensure_size(row, col)
        key = (row, col)
        if text:
            self.sources[key] = text
        else:
            self.sources.pop(key, None)
        dec = self._cell_decimals(row, col)

        if text == "=":
            # A bare "=" starts formula entry on the desktop; it is
            # never a value.
            self.sources.pop(key, None)
            self._write(row, col, "")
            return
        if is_python_source(text):
            self._cell_formulas[key] = text
            self._register_py_deps(row, col, text)
            self._write(row, col, self._evaluate_python(text, row, col, dec))
            return
        self._clear_py_outputs(row, col)
        if text.startswith("="):
            self._cell_formulas[key] = text
            self._register_deps(row, col, text)
            display = self._apply_cell_number_format(
                str(self._evaluate_formula(text, row, col, dec)), row, col,
                exact=self._last_raw)
            self._write(row, col, display)
            self._remember_value(row, col, display, self._last_raw)
            return

        self._cell_formulas.pop(key, None)
        self._unregister_deps(row, col)
        typed_number = None
        if text:
            try:
                typed_number = float(text)
                text = str(format_number(typed_number, dec))
            except ValueError:
                pass
        display = self._apply_cell_number_format(text, row, col,
                                                 exact=typed_number)
        self._write(row, col, display)
        self._remember_value(row, col, display, typed_number)

    def _write(self, row, col, text):
        key = (row, col)
        if self.texts.get(key, "") == text:
            return
        if text:
            self.texts[key] = text
        else:
            self.texts.pop(key, None)
        self.workbook._changed(self, row, col, text)

    def _ensure_size(self, row, col):
        if row >= self.rows:
            self.rows = row + 1
        if col >= self.cols:
            self.cols = col + 1

    # ── Number formats ───────────────────────────────────────────────
    def _number_format(self, row, col):
        nf = self.cell_formats.get((row, col))
        if not nf:
            nf = self.column_formats.get(col)
        return nf

    def _cell_decimals(self, row, col):
        """Decimal precision for a cell based on its format."""
        nf = self.cell_formats.get((row, col))
        if not nf:
            nf = self.column_formats.get(col, self.default_format)
        return _DECIMALS.get(nf, 3)

    def _apply_cell_number_format(self, text, row, col, exact=None):
        """Numbers show two decimals unless the cell or column says
        otherwise (as on the desktop)."""
        nf = self._number_format(row, col)
        if nf == "Text" or not text:
            return text
        if not nf or nf == "General":
            try:
                val = (float(exact) if isinstance(exact, (int, float))
                       and not isinstance(exact, bool) else float(text))
                return general_display(val)
            except (ValueError, TypeError):
                return text
        return format_value(text, nf)

    def set_number_format(self, row, col, fmt: Optional[str]) -> List[tuple]:
        """Give a cell a number format (None: back to the column's)."""
        if fmt:
            self.cell_formats[(row, col)] = fmt
        else:
            self.cell_formats.pop((row, col), None)
        source = self.sources.get((row, col))
        return self.set_cell(row, col, source) if source else []

    # ── Formulas ─────────────────────────────────────────────────────
    def _build_eval_ns(self):
        if self._eval_ns is None:
            self._eval_ns = build_namespace(self)
            self._eval_ns_lower = lower_names(self._eval_ns)
        return self._eval_ns

    def _compile_formula(self, formula):
        self._build_eval_ns()
        return compile_formula(formula, self._eval_ns, self._eval_ns_lower)

    def _evaluate_formula(self, formula: str, row: int, col: int,
                          decimals: int = 3):
        """Evaluate a cell formula and return its display; a list result
        spills below (see core.compiler.evaluate_cell)."""
        return evaluate_cell(self, formula, row, col, decimals)

    def _spill_array(self, values, row, col):
        for i, v in enumerate(values[1:], start=1):
            self._ensure_size(row + i, col)
            text = str(format_number(v))
            self._write(row + i, col, text)
            self._remember_value(row + i, col, text, v)

    # ── Dependencies ─────────────────────────────────────────────────
    def _register_deps(self, row, col, formula):
        self._unregister_deps(row, col)
        for ref in parse_cell_refs(formula):
            self._dependents.setdefault(ref, set()).add((row, col))
        if XREF_PATTERN.search(formula or ""):
            self._xref_cells.add((row, col))
        else:
            self._xref_cells.discard((row, col))

    def _unregister_deps(self, row, col):
        key = (row, col)
        self._xref_cells.discard(key)
        for deps in self._dependents.values():
            deps.discard(key)

    def _recalc_from_seeds(self, seeds: Iterable[Cell], exclude=None):
        """Re-evaluate every formula that depends on *seeds*, each after
        all of its inputs (topological order); *exclude* is skipped."""
        affected = set()
        stack = list(seeds)
        while stack:
            for dep in self._dependents.get(stack.pop(), ()):
                if dep not in affected:
                    affected.add(dep)
                    stack.append(dep)
        if not affected:
            return
        indeg = {k: 0 for k in affected}
        adj = {k: [] for k in affected}
        for u in affected:
            for v in self._dependents.get(u, ()):
                if v in affected:
                    adj[u].append(v)
                    indeg[v] += 1
        queue = [k for k in affected if indeg[k] == 0]
        order = []
        while queue:
            u = queue.pop()
            order.append(u)
            for v in adj[u]:
                indeg[v] -= 1
                if indeg[v] == 0:
                    queue.append(v)
        if len(order) < len(affected):   # cycle: best effort
            done = set(order)
            order.extend(k for k in affected if k not in done)
        for (r, c) in order:
            if exclude and (r, c) in exclude:
                continue
            self._reeval_formula_cell(r, c)

    def _reeval_formula_cell(self, r, c):
        formula = self._cell_formulas.get((r, c))
        if not formula:
            return
        if is_python_source(formula):
            self._write(r, c, self._evaluate_python(
                formula, r, c, self._cell_decimals(r, c)))
            return
        dec = self._cell_decimals(r, c)
        result = self._apply_cell_number_format(
            str(self._evaluate_formula(formula, r, c, dec)), r, c,
            exact=self._last_raw)
        self._write(r, c, result)
        self._remember_value(r, c, result, self._last_raw)


    # ── Python (=PY) cells ───────────────────────────────────────────
    def _register_py_deps(self, row, col, source):
        """A =PY cell depends on the cells its ks() calls read."""
        self._unregister_deps(row, col)
        cross = False
        for ref in extract_refs(strip_marker(source)):
            if "!" in ref:
                cross = True
                continue
            for dep in parse_cell_refs("=" + ref):
                self._dependents.setdefault(dep, set()).add((row, col))
        if cross:
            self._xref_cells.add((row, col))

    def _clear_py_outputs(self, row, col):
        """Forget what the cell's last run produced (spilled cells too)."""
        key = (row, col)
        self._py_objects.pop(key, None)
        self.py_figures.pop(key, None)
        self.py_errors.pop(key, None)
        self.py_stdout.pop(key, None)
        for cell in self._py_outputs.pop(key, []):
            if cell not in self.sources:
                self._write(*cell, "")
                self._precise.pop(cell, None)

    def _py_text(self, value, dec):
        if isinstance(value, str):
            return value
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if value is None:
            return ""
        try:
            return str(format_number(float(value), dec))
        except (TypeError, ValueError):
            return str(value)

    def _py_put(self, row, col, value, owner):
        """Show *value* in a cell filled by the =PY cell *owner*."""
        if (row, col) == owner or (row, col) in self.sources:
            return False   # never over what someone typed
        self._ensure_size(row, col)
        text = self._py_text(value, self._cell_decimals(row, col))
        self._write(row, col, text)
        exact = value if isinstance(value, (int, float)) and not \
            isinstance(value, bool) else None
        self._remember_value(row, col, text, exact)
        self._py_outputs.setdefault(owner, []).append((row, col))
        return True

    def _py_write(self, coords, value, cur_cell, written):
        """ks_set(): write *value* into the range *coords*."""
        r1, c1, r2, c2 = coords
        for i, values in enumerate(value_to_block(value, r1, c1, r2, c2)):
            for j, v in enumerate(values):
                if self._py_put(r1 + i, c1 + j, v, cur_cell) and \
                        written is not None:
                    written.add((r1 + i, c1 + j))

    def _evaluate_python(self, source, row, col, dec=3):
        """Run a =PY cell (if Python may run) and return what it shows."""
        self._clear_py_outputs(row, col)
        workbook = self.workbook
        if workbook.python is None or not workbook.may_run(source):
            return PYTHON_NOT_RUN
        code = strip_marker(source)
        if not code.strip():
            return ""
        runtime = workbook.python
        res = runtime.run(code, self, row, col)
        writes = getattr(runtime, "last_writes", None)
        if writes:
            self._recalc_from_seeds(list(writes), exclude={(row, col)})
        if res.stdout:
            self.py_stdout[(row, col)] = res.stdout
        if not res.ok:
            self.py_errors[(row, col)] = res.error
            return "#PYERR"
        if res.kind == PyResult.FIGURE:
            self.py_figures[(row, col)] = res.svg
            return "📈 plot"
        if res.kind == PyResult.NONE:
            return ""
        value = res.value
        if res.kind == PyResult.SCALAR:
            return self._py_text(value, dec)
        if res.kind in (PyResult.ARRAY1D, PyResult.ARRAY2D):
            block = value if res.kind == PyResult.ARRAY2D else \
                [[v] for v in value]
            for i, values in enumerate(block):
                for j, v in enumerate(values):
                    if i or j:
                        self._py_put(row + i, col + j, v, (row, col))
            spilled = self._py_outputs.get((row, col))
            if spilled:
                self._recalc_from_seeds(list(spilled), exclude={(row, col)})
            head = block[0][0] if block and block[0] else ""
            return self._py_text(head, dec)
        self._py_objects[(row, col)] = value
        return badge_for(value)


class Workbook:
    """Sheets, looked up by name like the desktop workbook."""

    def __init__(self):
        self.sheets: List[Sheet] = []
        self._in_xref_refresh = False
        self._changes: Optional[List[tuple]] = None
        #: The Python runtime for =PY cells (None: they are not run), and
        #: the sources the user trusts (None: all of them).
        self.python = None
        self.trusted: Optional[set] = None

    # ── Python ───────────────────────────────────────────────────────
    def may_run(self, source: str) -> bool:
        return self.trusted is None or source_hash(source) in self.trusted

    def enable_python(self, runtime=None, trusted: Optional[set] = None
                      ) -> List[tuple]:
        """Run =PY cells from now on (only the *trusted* ones, if given:
        hashes from ``source_hash``), and run those not run yet."""
        from .python import PythonRuntime
        self.python = runtime or self.python or PythonRuntime()
        self.trusted = trusted
        return self.rerun_python()

    def rerun_python(self) -> List[tuple]:
        """Run every =PY cell again (and what depends on them)."""
        with self._collect() as changes:
            for sheet in self.sheets:
                cells = [rc for rc, f in sheet._cell_formulas.items()
                         if is_python_source(f)]
                for r, c in cells:
                    sheet._reeval_formula_cell(r, c)
                if cells:
                    sheet._recalc_from_seeds(cells)
            self.refresh_cross_sheet()
        return changes

    # ── Sheets ───────────────────────────────────────────────────────
    def add_sheet(self, name: Optional[str] = None,
                  rows: int = DEFAULT_ROWS, cols: int = DEFAULT_COLS) -> Sheet:
        if not name:
            name = f"Sheet{len(self.sheets) + 1}"
        if self.sheet_by_name(name) is not None:
            raise ValueError(f"A sheet is already called {name!r}")
        sheet = Sheet(self, name, rows, cols)
        self.sheets.append(sheet)
        return sheet

    def sheet_by_name(self, name: str) -> Optional[Sheet]:
        """Find a sheet by name (case-insensitive, quotes ignored)."""
        if not name:
            return None
        target = name.strip().strip("'").lower()
        for sheet in self.sheets:
            if sheet.name.lower() == target:
                return sheet
        return None

    def sheet_names(self) -> List[str]:
        return [sheet.name for sheet in self.sheets]

    def range_values(self, ref: str, sheet: Optional[str] = None) -> list:
        """The values of a range such as ``B2:B20``, ``Sheet2!A1:C3`` or
        ``'My data'!B:B``, row by row; None for empty cells.

        A whole column or row stops at the sheet's last filled cell."""
        name, _, cells = ref.rpartition("!")
        target = self.sheet_by_name(name) if name else (
            self.sheet_by_name(sheet) if sheet else None) or (
            self.sheets[0] if self.sheets else None)
        if target is None:
            raise ValueError(f"No sheet called {name or sheet!r}")
        (c1, r1), (c2, r2) = _range_bounds(cells, target)
        return [None if v is BLANK else v
                for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)
                for v in (target._value(r, c),)]

    def rename_sheet(self, old: str, new: str) -> List[tuple]:
        sheet = self.sheet_by_name(old)
        if sheet is None:
            raise KeyError(old)
        other = self.sheet_by_name(new)
        if other is not None and other is not sheet:
            raise ValueError(f"A sheet is already called {new!r}")
        sheet.name = new
        with self._collect() as changes:
            self.refresh_cross_sheet()
        return changes

    def remove_sheet(self, name: str) -> List[tuple]:
        sheet = self.sheet_by_name(name)
        if sheet is None:
            raise KeyError(name)
        self.sheets.remove(sheet)
        with self._collect() as changes:
            self.refresh_cross_sheet()
        return changes

    # ── Recalculation ────────────────────────────────────────────────
    def refresh_cross_sheet(self):
        """Re-evaluate every cross-sheet formula and cascade locally."""
        if self._in_xref_refresh:
            return
        self._in_xref_refresh = True
        try:
            for sheet in self.sheets:
                cells = list(sheet._xref_cells)
                if not cells:
                    continue
                for (r, c) in cells:
                    sheet._reeval_formula_cell(r, c)
                sheet._recalc_from_seeds(cells)
        finally:
            self._in_xref_refresh = False

    def load(self, cells: Dict[str, Dict[Cell, str]]) -> None:
        """Fill sheets from saved sources, as opening a .ksheet does:
        values as they are, then formulas evaluated twice so formulas
        that read other formulas settle."""
        pending = []
        for name, sheet_cells in cells.items():
            sheet = self.sheet_by_name(name) or self.add_sheet(name)
            for (r, c), text in sheet_cells.items():
                if not text:
                    continue
                sheet._ensure_size(r, c)
                sheet.sources[(r, c)] = text
                if is_python_source(text):
                    sheet._cell_formulas[(r, c)] = text
                    sheet.texts[(r, c)] = PYTHON_NOT_RUN
                elif text.startswith("="):
                    sheet._cell_formulas[(r, c)] = text
                    pending.append((sheet, r, c, text))
                else:
                    sheet.texts[(r, c)] = text
        for _pass in range(2):
            for sheet, r, c, formula in pending:
                if _pass == 0:
                    sheet._register_deps(r, c, formula)
                result = str(sheet._evaluate_formula(formula, r, c))
                if result:
                    sheet.texts[(r, c)] = result
                else:
                    sheet.texts.pop((r, c), None)
                sheet._remember_value(r, c, result, sheet._last_raw)

    # ── Change collection ────────────────────────────────────────────
    def _changed(self, sheet: Sheet, row: int, col: int, text: str):
        if self._changes is not None:
            self._changes.append((sheet.name, row, col, text))

    def _collect(self):
        workbook = self

        class _Collector:
            def __enter__(self):
                self.outer = workbook._changes
                if self.outer is None:
                    workbook._changes = []
                    self.changes = workbook._changes
                else:
                    self.changes = []   # nested: the outer call reports
                return self.changes

            def __exit__(self, *exc):
                if self.outer is None:
                    # Last write per cell wins, in first-change order.
                    latest = {}
                    for name, r, c, text in workbook._changes:
                        latest[(name, r, c)] = text
                    self.changes[:] = [(n, r, c, t)
                                       for (n, r, c), t in latest.items()]
                    workbook._changes = None
                return False

        return _Collector()
