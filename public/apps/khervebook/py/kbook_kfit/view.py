"""The KFit cell's Plot and Data views (desktop kfitcell._refresh,
_draw_plot, _draw_residuals, _fill_table), returned as JSON for the page:
the plot as a PNG, the table as headers + rows.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import base64
import io
import json
import os

import numpy as np

from . import kfitio

# desktop kfitcell.py: KherveFitting's own colours.
SCATTER_COLOR = "#000000"
SCATTER_SIZE = 4
BACKGROUND_COLOR = "#808080"
BACKGROUND_ALPHA = 0.5
ENVELOPE_COLOR = "#0000FF"
ENVELOPE_ALPHA = 0.6
RESIDUAL_COLOR = "#00FF00"
RESIDUAL_ALPHA = 0.4
PEAK_ALPHA = 0.3
PEAK_LINE_ALPHA = 0.7
PEAK_COLORS = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF",
               "#00FFFF", "#FFA500", "#800080", "#008000", "#000080"]
_SCATTER_LIMIT = 5000
#: rows sent to the page for the Data table (the rest stay in Python).
MAX_ROWS = 20000

_cache = {}


def load(path):
    """The parsed project at *path*, re-read when the file changes."""
    st = os.stat(path)
    key = (path, st.st_mtime, st.st_size)
    hit = _cache.get(path)
    if hit and hit[0] == key:
        return hit[1]
    project = kfitio.read_path(path)
    _cache[path] = (key, project)
    return project


def _coverage_note(sheet, curves):
    bits = []
    if curves["skipped"]:
        bits.append("Not drawn — KherveBook has no lineshape for: "
                    + ", ".join(curves["skipped"]))
    if not sheet.peaks:
        bits.append("No fitted peaks in this sheet — showing the raw data"
                    + (" and its background." if sheet.has_background
                       else "."))
    return "  ".join(bits)


def _draw_residuals(ax, x, y, curves):
    mask = curves["mask"]
    if not mask.any():
        return
    residual = np.where(mask, y - curves["envelope"], np.nan)
    top = np.nanmax(y[mask]) if mask.any() else 0.0
    span = np.nanmax(np.abs(residual[mask])) if mask.any() else 0.0
    if not np.isfinite(top) or not np.isfinite(span) or span == 0:
        return
    ax.plot(x, residual + top + 1.5 * span, color=RESIDUAL_COLOR,
            alpha=RESIDUAL_ALPHA, lw=1, label="Residuals", zorder=2)


def plot_png(sheet, curves, dpi=100):
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    figure = Figure(figsize=(6.4, 4.4), tight_layout=True)
    FigureCanvasAgg(figure)
    ax = figure.add_subplot(111)
    x = curves["x"]
    y = np.asarray(sheet.y, dtype=float)
    if y.shape != x.shape:
        y = np.zeros_like(x)
    if len(x) <= _SCATTER_LIMIT and kfitio.is_xps_like(sheet.name):
        ax.scatter(x, y, s=SCATTER_SIZE, c=SCATTER_COLOR, marker="o",
                   label="Raw data", zorder=3)
    else:
        ax.plot(x, y, color=SCATTER_COLOR, lw=1.0, label="Raw data",
                zorder=3)
    if sheet.has_background:
        ax.plot(x, curves["background"], color=BACKGROUND_COLOR,
                alpha=BACKGROUND_ALPHA, ls="--", lw=1, label="Background",
                zorder=2)
    background = curves["background"]
    for i, (name, curve) in enumerate(curves["peaks"]):
        color = PEAK_COLORS[i % len(PEAK_COLORS)]
        top = background + curve
        inside = np.where(curves["mask"], top, np.nan)
        ax.fill_between(x, background, top, where=curves["mask"],
                        color=color, alpha=PEAK_ALPHA, edgecolor="none",
                        label=name, zorder=1)
        ax.plot(x, inside, color=color, alpha=PEAK_LINE_ALPHA, lw=1,
                zorder=2)
    if curves["envelope"] is not None:
        ax.plot(x, np.where(curves["mask"], curves["envelope"], np.nan),
                color=ENVELOPE_COLOR, alpha=ENVELOPE_ALPHA, lw=1,
                label="Envelope", zorder=4)
        _draw_residuals(ax, x, y, curves)
    ax.set_xlabel(sheet.x_label)
    ax.set_ylabel(sheet.y_label)
    ax.set_title(sheet.name)
    if len(x):
        lo, hi = float(np.nanmin(x)), float(np.nanmax(x))
        ax.set_xlim((hi, lo) if sheet.descending else (lo, hi))
    if 0 < len(curves["peaks"]) <= 12:
        ax.legend(fontsize=7, framealpha=0.6)
    buf = io.BytesIO()
    figure.savefig(buf, format="png", dpi=dpi)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def table(sheet, curves):
    headers = [sheet.x_label, sheet.y_label]
    columns = [curves["x"], np.asarray(sheet.y, dtype=float)]
    if sheet.has_background:
        headers.append("Background")
        columns.append(curves["background"])
    for name, curve in curves["peaks"]:
        headers.append(name)
        columns.append(curves["background"] + curve)
    if curves["envelope"] is not None:
        headers.append("Envelope")
        columns.append(curves["envelope"])
    columns = [np.asarray(c, dtype=float) for c in columns]
    n = max((len(c) for c in columns), default=0)

    def cell(c, r):
        # desktop _CurveModel: "%.6g", blank past a column's end or for NaN
        if r >= len(c) or not np.isfinite(c[r]):
            return ""
        return "%.6g" % c[r]

    rows = [[cell(c, r) for c in columns] for r in range(min(n, MAX_ROWS))]
    return headers, rows, n


def render(path, sheet_name="", view="plot", file_name=""):
    """Everything the cell shows, as a JSON string."""
    out = {"ok": True, "names": [], "sheet": "", "info": "", "hint": ""}
    try:
        project = load(path)
    except Exception as exc:          # a project we cannot read says so
        out.update(ok=False, hint=str(exc))
        return json.dumps(out)
    names = project.names
    out["names"] = names
    sheet = project.sheet(sheet_name) if names else None
    if sheet is None:
        out["hint"] = ("No project loaded. Drop a .kfit file here, "
                       "or click “Load .kfit…”.")
        return json.dumps(out)
    out["sheet"] = sheet.name
    sample = project.sample
    out["info"] = (f"{file_name}  ·  {sheet.summary()}"
                   + (f"  ·  {sample}" if sample and sample != file_name
                      else ""))
    curves = sheet.curves()
    out["hint"] = _coverage_note(sheet, curves)
    if view == "data":
        out["headers"], out["rows"], out["nrows"] = table(sheet, curves)
    else:
        out["png"] = plot_png(sheet, curves)
    return json.dumps(out)


def make_kfit(cells):
    """The kernel's kfit(sheet=None, cell=1) (desktop Kernel._make_kfit).

    *cells* lists the notebook's KFit cells in order as dicts
    {"path", "name", "title"}.
    """
    def resolve(which):
        if isinstance(which, str):
            for c in cells:
                stem = os.path.splitext(c["name"])[0]
                if which in (c["name"], c["title"], stem) and c["path"]:
                    return load(c["path"])
            return None
        try:
            index = int(which)
        except (TypeError, ValueError):
            return None
        if 1 <= index <= len(cells) and cells[index - 1]["path"]:
            return load(cells[index - 1]["path"])
        return None

    def kfit(sheet=None, cell=1):
        project = resolve(cell)
        if project is None:
            raise NameError(
                "no KherveFitting project yet — add a KFit cell and "
                "load a .kfit into it"
                if not isinstance(cell, str) else
                f"no KFit cell matching {cell!r}")
        if sheet is None:
            return project
        name = str(sheet)
        for candidate in project.sheets:
            if candidate.name == name:
                return candidate
        raise KeyError(f"no sheet named {name!r} in this project "
                       f"(it has: {', '.join(project.names)})")

    return kfit
