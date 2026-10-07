"""The Solver without Qt: find the values of variable cells that make an
objective cell as large or small as possible, or equal to a target, under
constraints — what KherveSheet's Solver dialog runs, and what KherveCELL
runs in the browser.

The sheet is reached through a small *host* (see SolverHost), so the same
numerical path serves the desktop sheet and the Qt-free engine.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Tuple

from .refs import col_index_to_letter, letter_to_col_index

Cell = Tuple[int, int]

METHODS = ["GRG Nonlinear", "LP Simplex", "Evolutionary"]
OPERATORS = ("<=", ">=", "=")

_CELL_RE = re.compile(r'\$?([A-Za-z]{1,3})\$?(\d{1,7})', re.ASCII)


# ── References ───────────────────────────────────────────────────────
def parse_ref(ref: str) -> Optional[Cell]:
    """'$D$5' or 'A1' → (row, col), 0-based; None if not a cell."""
    m = _CELL_RE.fullmatch((ref or "").strip())
    if not m:
        return None
    return int(m.group(2)) - 1, letter_to_col_index(m.group(1))


def parse_range(text: str) -> List[Cell]:
    """'A1', 'A1:A5' or 'A1:A5,C1:D3' → the cells, in order."""
    cells: List[Cell] = []
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            ends = part.split(":")
            if len(ends) != 2:
                continue
            start, end = parse_ref(ends[0]), parse_ref(ends[1])
            if start is None or end is None:
                continue
            (r1, c1), (r2, c2) = start, end
            for r in range(min(r1, r2), max(r1, r2) + 1):
                for c in range(min(c1, c2), max(c1, c2) + 1):
                    cells.append((r, c))
        else:
            rc = parse_ref(part)
            if rc:
                cells.append(rc)
    return cells


def ref_str(row: int, col: int) -> str:
    """(row, col) → '$A$1'."""
    return f"${col_index_to_letter(col)}${row + 1}"


# ── The problem ──────────────────────────────────────────────────────
class SolverHost:
    """What the Solver needs from a sheet.

    ``value`` reads a cell at full precision (None if not a number);
    ``try_values`` writes trial values (full precision) into the variable
    cells and recalculates what depends on them."""

    def value(self, cell: Cell) -> Optional[float]:  # pragma: no cover
        raise NotImplementedError

    def try_values(self, cells: Sequence[Cell],
                   values: Sequence[float]) -> None:  # pragma: no cover
        raise NotImplementedError


@dataclass
class Constraint:
    cell: Cell
    op: str                 # "<=", ">=" or "="
    value: float


@dataclass
class Problem:
    objective: Cell
    variables: List[Cell]
    goal: str = "min"       # "min", "max" or "value"
    target: float = 0.0
    constraints: List[Constraint] = field(default_factory=list)
    non_negative: bool = False
    method: str = "GRG Nonlinear"
    keep_searching: bool = False


@dataclass
class Outcome:
    """The best values found (clipped into the constraints' limits)."""
    x: Optional[List[float]]
    success: bool
    message: str = ""
    cancelled: bool = False


class Cancelled(Exception):
    """Raised by a *pump* to stop the search."""


def solve(host: SolverHost, problem: Problem,
          pump: Optional[Callable[[], None]] = None) -> Outcome:
    """Search for the best variable values; the variable cells are left
    holding the last trial values (callers write the final ones).

    *pump* runs on every iteration (keep a window alive, redraw charts);
    raising Cancelled from it stops the search, keeping the best so far.
    With *keep_searching* the search restarts from random points until
    cancelled."""
    import numpy as np
    from scipy import optimize as opt

    var_cells = list(dict.fromkeys(problem.variables))
    obj_rc = problem.objective
    x0 = []
    for rc in var_cells:
        v = host.value(rc)
        x0.append(v if v is not None else 0.0)

    # The only box bounds come from "non-negative"; constraints on a
    # variable cell are also remembered as limits so the final result can
    # be clipped into range (the search itself is unchanged).
    bounds = ([(0, None)] if problem.non_negative else [(None, None)]) \
        * len(var_cells)
    var_index = {rc: i for i, rc in enumerate(var_cells)}
    clip_lo: List[Optional[float]] = [None] * len(var_cells)
    clip_hi: List[Optional[float]] = [None] * len(var_cells)

    def set_vars(x):
        host.try_values(var_cells, [float(v) for v in x])

    goal, target = problem.goal, problem.target

    def objective(x):
        set_vars(x)
        val = host.value(obj_rc)
        if val is None:
            return 1e30
        if goal == "max":
            return -val
        if goal == "value":
            return (val - target) ** 2
        return val

    scipy_constraints = []
    for con in problem.constraints:
        idx = var_index.get(con.cell)
        if idx is not None:
            if con.op == "<=":
                clip_hi[idx] = (con.value if clip_hi[idx] is None
                                else min(clip_hi[idx], con.value))
            elif con.op == ">=":
                clip_lo[idx] = (con.value if clip_lo[idx] is None
                                else max(clip_lo[idx], con.value))
            else:
                clip_lo[idx] = clip_hi[idx] = con.value

        def cfn(x, _rc=con.cell, _rhs=con.value, _op=con.op):
            set_vars(x)
            v = host.value(_rc)
            if v is None:
                return -1e30
            return _rhs - v if _op == "<=" else v - _rhs

        scipy_constraints.append(
            {"type": "eq" if con.op == "=" else "ineq", "fun": cfn})

    def callback(*_args, **_kwargs):
        if pump is not None:
            pump()

    powell_bounds = [(-np.inf if lo is None else lo,
                      np.inf if hi is None else hi) for lo, hi in bounds]

    def solve_nonlinear(start):
        # Spreadsheet models are often badly scaled; Powell (no
        # derivatives) copes and matches Excel's GRG on them. SLSQP only
        # when there are constraints, which Powell cannot honour.
        if scipy_constraints:
            return opt.minimize(
                objective, start, method="SLSQP", bounds=bounds,
                constraints=scipy_constraints, callback=callback,
                options={"maxiter": 1000, "ftol": 1e-9})
        return opt.minimize(
            objective, start, method="Powell", bounds=powell_bounds,
            callback=callback,
            options={"maxiter": 20000, "xtol": 1e-8, "ftol": 1e-8})

    # Evolutionary needs finite bounds, and penalties for constraints.
    de_bounds = []
    for i, (lo, hi) in enumerate(bounds):
        lo2 = lo if lo is not None else x0[i] - 1000
        hi2 = hi if hi is not None else x0[i] + 1000
        if lo2 >= hi2:
            hi2 = lo2 + 1000
        de_bounds.append((lo2, hi2))

    def penalised(x):
        v = objective(x)
        for cd in scipy_constraints:
            cv = cd["fun"](x)
            if cd["type"] == "ineq" and cv < 0:
                v += 1e6 * cv ** 2
            elif cd["type"] == "eq":
                v += 1e6 * cv ** 2
        return v

    def run_once(start):
        if problem.method == "Evolutionary":
            return opt.differential_evolution(
                penalised, de_bounds, maxiter=1000, tol=1e-12,
                callback=callback)
        return solve_nonlinear(start)

    rng = np.random.default_rng()

    def restart(base):
        nx = list(base)
        for i in range(len(var_cells)):
            lo, hi = clip_lo[i], clip_hi[i]
            spread = max(1.0, abs(base[i]))
            if lo is not None and hi is not None:
                nx[i] = float(rng.uniform(lo, hi))
            elif lo is not None:
                nx[i] = lo + abs(rng.normal(0.0, spread))
            elif hi is not None:
                nx[i] = hi - abs(rng.normal(0.0, spread))
            else:
                nx[i] = base[i] + rng.normal(0.0, spread)
        return nx

    best = None
    cancelled = False
    start = list(x0)
    while True:
        try:
            res = run_once(start)
        except Cancelled:
            cancelled = True
            break
        if (getattr(res, "x", None) is not None and np.isfinite(res.fun)
                and (best is None or res.fun < best.fun)):
            best = res
            set_vars(best.x)
        if not problem.keep_searching:
            break
        try:
            callback()
        except Cancelled:
            cancelled = True
            break
        start = restart(best.x if best is not None else x0)

    if best is None:
        return Outcome(None, False, cancelled=cancelled,
                       message="Solver stopped before finding a solution."
                       if cancelled else "Solver could not find a solution.")
    x = [float(v) for v in best.x]
    for i in range(len(var_cells)):
        if clip_lo[i] is not None and x[i] < clip_lo[i]:
            x[i] = clip_lo[i]
        if clip_hi[i] is not None and x[i] > clip_hi[i]:
            x[i] = clip_hi[i]
    return Outcome(x, bool(best.success) or cancelled,
                   message=str(getattr(best, "message", "")),
                   cancelled=cancelled)


# ── The Qt-free engine as a host ─────────────────────────────────────
class EngineHost(SolverHost):
    """A core.engine.Sheet: trial values are typed in at full precision
    and everything depending on them is recalculated."""

    def __init__(self, sheet):
        self.sheet = sheet

    def value(self, cell):
        v = self.sheet._value(*cell)
        if isinstance(v, bool):
            return float(v)
        return float(v) if isinstance(v, (int, float)) else None

    def try_values(self, cells, values):
        for (r, c), v in zip(cells, values):
            self.sheet._type(r, c, repr(float(v)))
        self.sheet._recalc_from_seeds(list(cells))
        self.sheet.workbook.refresh_cross_sheet()


def display_number(value: float, decimals: int) -> str:
    """A solved value as it is written into its cell (the cell's own
    precision, no trailing zeros), like the desktop Solver."""
    value = float(value)
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    text = f"{round(value, decimals):.{decimals}f}"
    return text.rstrip("0").rstrip(".")
