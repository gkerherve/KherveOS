"""Reading cell values for formulas, for any grid that can give a cell's text.

``CellValues`` is mixed into the desktop sheet (cells in a Qt table) and
into the Qt-free engine (cells in a dict).  A host provides:

- ``_cell_text(r, c)``  → the cell's displayed text ("" when empty)
- ``row_count()``        → number of rows, for whole-column functions
- ``_workbook()``        → an object with ``sheet_by_name(name)``, or None
- ``_precise``           → a dict, for ``_remember_value``

Formulas see what Excel would see:

- a number cell gives its full-precision number, not the rounded text on
  screen (hosts record it with ``_remember_value`` when they write a cell);
- a text cell gives its text;
- an empty cell gives ``BLANK``: 0 in arithmetic, "" as text;
- a range gives a ``Range``: its values in reading order (row by row),
  with the rows × columns ``grid`` kept for lookups.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""


class Blank(float):
    """An empty cell: 0 in arithmetic, "" as text, equal to "" and None."""

    def __new__(cls):
        return super().__new__(cls, 0.0)

    def __str__(self):
        return ""

    def __repr__(self):
        return "BLANK"

    def __eq__(self, other):
        if other is None or (isinstance(other, str) and other == ""):
            return True
        return float.__eq__(self, other)

    def __ne__(self, other):
        return not self.__eq__(other)

    __hash__ = float.__hash__


BLANK = Blank()


class Range(list):
    """The values of a rectangular range, row by row; ``grid`` keeps the
    rows × columns shape (blank cells are ``BLANK`` in both)."""

    def __init__(self, grid):
        self.grid = grid
        super().__init__(v for row in grid for v in row)

    @property
    def rows(self):
        return len(self.grid)

    @property
    def columns(self):
        return len(self.grid[0]) if self.grid else 0


class CellValues:
    """The runtime helpers compiled formulas call: _C, _RANGE, _COL, _XC…"""

    #: Boolean cell text → its numeric value, as Excel coerces them.
    _BOOL_VALUES = {"TRUE": 1.0, "FALSE": 0.0}

    def _cell_text(self, r, c):  # pragma: no cover - provided by hosts
        raise NotImplementedError

    def row_count(self):  # pragma: no cover - provided by hosts
        raise NotImplementedError

    def _workbook(self):
        return None

    # ── Full-precision numbers behind the displayed text ─────────────
    def _remember_value(self, r, c, text, value):
        """Record the exact number behind a cell's displayed *text*.

        Kept only while the cell still shows that text, so a cell rewritten
        by any other path simply falls back to its text."""
        precise = self._precise
        if isinstance(value, (int, float)) and not isinstance(value, bool) \
                and text != "":
            precise[(r, c)] = (text, float(value))
        else:
            precise.pop((r, c), None)

    def _value(self, r, c):
        """The cell's value: BLANK, a number (full precision) or text."""
        t = self._cell_text(r, c)
        if not t:
            return BLANK
        known = self._precise.get((r, c))
        if known is not None and known[0] == t:
            return known[1]
        try:
            return float(t)
        except ValueError:
            # TRUE/FALSE are values, not stray text: a checkbox cell
            # holds one, and =IF(A1,…) over it has to work.
            b = self._BOOL_VALUES.get(t.strip().upper())
            return b if b is not None else t

    # ── What compiled formulas call ──────────────────────────────────
    def _cell_val(self, r, c):
        """A single reference (A1)."""
        return self._value(r, c)

    def _cell_raw(self, r, c):
        """A reference given to an IS… function: "" when empty."""
        v = self._value(r, c)
        return "" if v is BLANK else v

    def _apply_agg(self, func, vals):
        if func == "sum":
            return sum(vals) if vals else 0
        if func == "sumsq":
            return sum(v * v for v in vals) if vals else 0
        if func in ("average", "avg", "mean"):
            return sum(vals) / len(vals) if vals else 0
        if func == "min":
            return min(vals) if vals else 0
        if func == "max":
            return max(vals) if vals else 0
        if func in ("count", "counta"):
            return len(vals)
        if func == "stdev":
            if len(vals) < 2:
                return 0
            mn = sum(vals) / len(vals)
            return (sum((v - mn) ** 2 for v in vals)
                    / (len(vals) - 1)) ** 0.5
        return 0

    def _numbers(self, cells):
        out = []
        for r, c in cells:
            v = self._value(r, c)
            if isinstance(v, float) and v is not BLANK:
                out.append(v)
        return out

    def _range_values(self, c1, r1, c2, r2):
        """A range (A1:B10) as a Range."""
        value = self._value
        return Range([[value(r, c) for c in range(c1, c2 + 1)]
                      for r in range(r1, r2 + 1)])

    def _range_values_2d(self, c1, r1, c2, r2):
        """A 2-D list (rows × cols) of cell values; None when empty."""
        value = self._value
        return [[None if v is BLANK else v
                 for v in (value(r, c) for c in range(c1, c2 + 1))]
                for r in range(r1, r2 + 1)]

    def _agg_range(self, func, c1, r1, c2, r2):
        return self._apply_agg(func, self._numbers(
            (r, c) for c in range(c1, c2 + 1) for r in range(r1, r2 + 1)))

    def _agg_col(self, func, c):
        """A whole-column aggregate: SUM(A)."""
        return self._apply_agg(func, self._numbers(
            (r, c) for r in range(self.row_count())))

    def _XC(self, name, r, c):
        """Read a single cell value from another sheet (Sheet!A1)."""
        wb = self._workbook()
        s = wb.sheet_by_name(name) if wb else None
        return s._cell_val(r, c) if s is not None else BLANK

    def _XRANGE(self, name, c1, r1, c2, r2):
        """Read a range of values from another sheet (Sheet!A1:B10)."""
        wb = self._workbook()
        s = wb.sheet_by_name(name) if wb else None
        return s._range_values(c1, r1, c2, r2) if s is not None \
            else Range([])
