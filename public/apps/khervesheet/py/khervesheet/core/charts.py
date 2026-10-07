"""Charts drawn with matplotlib, without Qt: the drawing KherveSheet's
chart windows use, and whole charts rendered to SVG for KherveCELL (the
web spreadsheet, where this runs in the browser's Python).

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import io
import math
import re as _re
from typing import Callable, List, Optional, Sequence

import numpy as np

DEFAULT_LINEWIDTH = 1.0
DEFAULT_MARKERSIZE = 3.0

DEFAULT_PIE_CONFIG = {
    "start_angle": 90,
    "direction": "counter-clockwise",
    "explode_pct": 0.0,
    "label_mode": "label+percent",  # percent | value | label | label+percent | none
    "decimal_places": 1,
    "shadow": False,
    "doughnut_width": 0.4,       # only used for Doughnut type
    "labels": None,              # list[str] | None — slice labels
}

PIE_TYPES = {"Pie", "Doughnut", "3D Pie"}


DEFAULT_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
    "#aec7e8", "#ffbb78", "#98df8a", "#ff9896", "#c5b0d5",
]


# ── Time strings ──────────────────────────────────────────────────────
_TIME_HM = _re.compile(
    r'^(\d{1,2}):(\d{2})(?::(\d{2}))?$')           # 8:00  20:00  13:45:30
_TIME_AMPM = _re.compile(
    r'^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$', _re.I)   # 8am  8:30pm


def _parse_time_str(text: str):
    """Try to parse *text* as a time-of-day string.

    Returns fractional hours (float) on success, or ``None``.
    """
    text = text.strip()
    m = _TIME_HM.match(text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        s = int(m.group(3)) if m.group(3) else 0
        if 0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59:
            return h + mi / 60.0 + s / 3600.0
    m = _TIME_AMPM.match(text)
    if m:
        h = int(m.group(1))
        mi = int(m.group(2)) if m.group(2) else 0
        pm = m.group(3).lower() == 'pm'
        if 1 <= h <= 12 and 0 <= mi <= 59:
            if h == 12:
                h = 0
            if pm:
                h += 12
            return h + mi / 60.0
    return None


def parse_time_column(strings, start=0, count=None):
    """Parse a list of strings as time values.

    Returns ``(hours, labels)`` where *hours* is a float ndarray of
    fractional hours (with day-wrap adjustment so the sequence is
    monotonically non-decreasing when it crosses midnight) and *labels*
    is a list of the original strings.  Returns ``(None, None)`` if
    fewer than half the values parse as valid times.
    """
    if count is None:
        count = len(strings) - start
    sub = strings[start:start + count]
    hours = []
    for s in sub:
        h = _parse_time_str(s)
        hours.append(h)

    valid = sum(1 for h in hours if h is not None)
    if valid < len(hours) / 2 or valid == 0:
        return None, None

    # Replace None entries with NaN, then adjust day wraps.
    result = np.empty(len(hours))
    day_offset = 0.0
    prev = None
    for i, h in enumerate(hours):
        if h is None:
            result[i] = np.nan
            continue
        val = h + day_offset
        if prev is not None and val < prev - 1.0:
            # Clock wrapped past midnight — add 24h.
            day_offset += 24.0
            val += 24.0
        result[i] = val
        prev = val
    return result, sub


# ── Drawing one series ────────────────────────────────────────────────
def plot_one(ax, x, y, label, plot_type):
    """Plot a single series and return the artist."""
    if plot_type == "Line":
        lines = ax.plot(x, y, label=label,
                        linewidth=DEFAULT_LINEWIDTH)
        return lines[0] if lines else None
    elif plot_type == "Scatter":
        return ax.scatter(x, y, label=label,
                          s=DEFAULT_MARKERSIZE ** 2)
    elif plot_type == "Line+Symbol":
        lines = ax.plot(x, y, 'o-', label=label,
                        linewidth=DEFAULT_LINEWIDTH,
                        markersize=DEFAULT_MARKERSIZE)
        return lines[0] if lines else None
    elif plot_type == "Bar":
        return ax.bar(x, y, label=label)
    elif plot_type == "Step":
        lines = ax.step(x, y, label=label, where='mid',
                        linewidth=DEFAULT_LINEWIDTH)
        return lines[0] if lines else None
    elif plot_type == "Stem":
        container = ax.stem(x, y, label=label)
        return container
    elif plot_type == "Histogram":
        _, _, patches = ax.hist(y, bins='auto', label=label,
                                alpha=0.7)
        return patches
    elif plot_type == "Box":
        bp = ax.boxplot([y], labels=[label], patch_artist=True)
        return bp
    elif plot_type == "Heatmap":
        # For heatmap, y is expected to be a 2D array; if 1D,
        # reshape into a single-row matrix.
        data = np.atleast_2d(np.asarray(y))
        im = ax.imshow(data, aspect='auto', origin='lower',
                       cmap='viridis')
        return im
    elif plot_type in ("Pie", "Doughnut", "3D Pie"):
        # Pie charts are drawn by pie_options.plot_pie;
        # _plot_one just returns a placeholder — the real draw
        # happens in _redraw_pie or from_dict.
        from .pie_options import plot_pie
        result = plot_pie(ax, y, None, {}, plot_type)
        if result is not None:
            return result[0]  # list of Wedge patches
        return None
    elif plot_type == "3D Surface":
        # 3D surface expects y to be a 2D array (Z matrix).
        # x is ignored here; X/Y are generated from shape.
        data = np.atleast_2d(np.asarray(y))
        rows, cols = data.shape
        X = np.arange(cols)
        Y = np.arange(rows)
        X, Y = np.meshgrid(X, Y)
        surf = ax.plot_surface(X, Y, data, cmap='viridis',
                               edgecolor='none', alpha=0.9)
        return surf
    else:
        lines = ax.plot(x, y, label=label)
        return lines[0] if lines else None


def plot_pie(ax, values, labels, pie_config, plot_type="Pie",
             colors=None):
    """Draw a pie / doughnut / 3-D pie on *ax*.

    Parameters
    ----------
    ax : matplotlib Axes
    values : array-like  — slice sizes (will be abs'd, zeros removed)
    labels : list[str] | None — per-slice labels
    pie_config : dict
    plot_type : str — "Pie", "Doughnut", or "3D Pie"
    colors : list[str] | None

    Returns
    -------
    (wedges, texts, autotexts) — the three lists returned by ax.pie
    """
    ax.clear()

    vals = np.asarray(values, dtype=float)
    # Remove zero / nan slices.
    mask = (vals > 0) & ~np.isnan(vals)
    vals = vals[mask]
    n = len(vals)
    if n == 0:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                transform=ax.transAxes, fontsize=10)
        return None

    if labels is not None:
        labels = [labels[i] for i, m in enumerate(mask) if m]
    else:
        labels = [f"Slice {i+1}" for i in range(n)]
    # Truncate / pad labels to match values.
    while len(labels) < n:
        labels.append(f"Slice {len(labels)+1}")
    labels = labels[:n]

    if colors is None:
        colors = [DEFAULT_COLORS[i % len(DEFAULT_COLORS)]
                  for i in range(n)]
    else:
        while len(colors) < n:
            colors.append(DEFAULT_COLORS[len(colors) % len(DEFAULT_COLORS)])
        colors = colors[:n]

    cfg = dict(DEFAULT_PIE_CONFIG)
    cfg.update(pie_config or {})

    start = cfg["start_angle"]
    ccw = cfg["direction"] == "counter-clockwise"
    shadow = cfg["shadow"]
    explode_pct = cfg["explode_pct"]

    explode = [explode_pct] * n if explode_pct > 0 else None

    # Build autopct string.
    lm = cfg["label_mode"]
    dp = cfg["decimal_places"]
    fmt = f"%.{dp}f%%"

    show_labels = lm in ("label", "label+percent")
    show_pct = lm in ("percent", "label+percent")
    show_val = lm == "value"

    if show_pct:
        autopct = fmt
    elif show_val:
        # autopct receives the percentage; convert back to value.
        total = vals.sum()
        def autopct(pct, _t=total, _dp=dp):
            v = pct * _t / 100.0
            return f"{v:.{_dp}f}"
    else:
        autopct = None

    pie_labels = labels if show_labels else None

    kw = dict(
        labels=pie_labels,
        autopct=autopct,
        startangle=start,
        colors=colors,
        counterclock=ccw,
        shadow=shadow,
        explode=explode,
    )

    # Doughnut: ring shape.
    if plot_type == "Doughnut":
        w = cfg.get("doughnut_width", 0.4)
        kw["wedgeprops"] = dict(width=w, edgecolor="white", linewidth=1.5)
    else:
        kw["wedgeprops"] = dict(edgecolor="white", linewidth=1.0)

    # 3D Pie: fake depth via shadow + slight explode + squash.
    if plot_type == "3D Pie":
        kw["shadow"] = True
        if explode is None:
            kw["explode"] = [0.02] * n
        ax.set_aspect(0.7)  # squash vertically for 3-D illusion
    else:
        ax.set_aspect("equal")

    result = ax.pie(vals, **kw)

    # Hide axes frame.
    ax.set_frame_on(False)
    ax.set_xticks([])
    ax.set_yticks([])

    return result


# ── Whole charts from a spec (KherveCELL) ─────────────────────────────
#
# A chart spec is plain JSON, shared between everyone editing the workbook:
#
#   {"type": "Line", "title": "", "xLabel": "", "yLabel": "",
#    "x": "Sheet1!A2:A20" | null,
#    "series": [{"ref": "B2:B20", "name": "Sales", "color": "#1f77b4"}],
#    "legend": true, "grid": false, "logX": false, "logY": false,
#    "width": 480, "height": 300,
#    "trendlines": [{"series": 0, "model": "Linear", "polyOrder": 2,
#                    "maPeriod": 2, "color": "#d62728", "showEquation": true,
#                    "showR2": true, "forward": 0, "backward": 0}]}
#
# The caller reads the ranges; render_svg only sees their values.

CHART_TYPES = [
    "Line", "Line+Symbol", "Scatter", "Bar", "Step", "Stem", "Histogram",
    "Box", "Pie", "Doughnut", "3D Pie", "Heatmap", "3D Surface",
]
_NO_X = {"Histogram", "Box", "Heatmap", "3D Surface"}


def _number(value) -> float:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    return math.nan


def numbers(values: Sequence) -> np.ndarray:
    """Cell values as floats; text and blanks become NaN."""
    return np.array([_number(v) for v in values], dtype=float)


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def series_xy(x_values: Optional[Sequence], y_values: Sequence):
    """(x, y, labels) for one series, as KherveSheet's charts read them:
    labels is a list of tick labels for text X values, "TIME" for times of
    day, or None for numbers. Points without a number are left out."""
    y = numbers(y_values)
    if x_values is None:
        x = np.arange(len(y), dtype=float)
        mask = ~np.isnan(y)
        return x[mask], y[mask], None
    x_num = numbers(x_values)
    n = min(len(x_num), len(y))
    x_num, y = x_num[:n], y[:n]
    if n and int(np.isnan(x_num).sum()) > n / 2:
        labels = [_text(v) for v in list(x_values)[:n]]
        hours, _ = parse_time_column(labels)
        if hours is not None:
            mask = ~(np.isnan(hours) | np.isnan(y))
            return hours[mask], y[mask], "TIME"
        mask = ~np.isnan(y)
        return (np.arange(n, dtype=float)[mask], y[mask],
                [lab for lab, m in zip(labels, mask) if m])
    mask = ~(np.isnan(x_num) | np.isnan(y))
    return x_num[mask], y[mask], None


def _categorical_x(fig, ax, labels: List[str], positions=None):
    if not labels:
        return
    ax.set_xticks(np.arange(len(labels)) if positions is None
                  else positions)
    turn = len(labels) > 5 or max(len(s) for s in labels) > 8
    ax.set_xticklabels(labels, rotation=45 if turn else 0,
                       ha="right" if turn else "center")


def _time_x(ax):
    import matplotlib.ticker as ticker

    def fmt(val, _pos):
        h = val % 24
        m = round((h - int(h)) * 60)
        return f"{int(h):02d}:{m:02d}"

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(fmt))


def _message(ax, text):
    ax.set_axis_off()
    ax.text(0.5, 0.5, text, ha="center", va="center",
            transform=ax.transAxes, fontsize=10, color="#666666")


def draw_chart(fig, spec: dict, read: Callable[[str], Sequence],
               fits: Optional[list] = None):
    """Draw the chart *spec* on the matplotlib figure *fig*.

    *read(ref)* returns the values of a range, row by row (a list). The
    result of each trendline's fit is appended to *fits*."""
    kind = spec.get("type") or "Line"
    series = [s for s in spec.get("series") or [] if s.get("ref")]
    x_ref = spec.get("x") or None
    is_3d = kind == "3D Surface"
    ax = fig.add_subplot(111, projection="3d" if is_3d else None)
    if not series:
        _message(ax, "Choose the data to plot")
        return ax

    x_values = read(x_ref) if x_ref and kind not in _NO_X else None
    columns = [(s, read(s["ref"])) for s in series]
    colors = [s.get("color") or DEFAULT_COLORS[i % len(DEFAULT_COLORS)]
              for i, s in enumerate(series)]
    names = [s.get("name") or s["ref"] for s in series]
    drawn = False

    if kind in PIE_TYPES:
        values = numbers(columns[0][1])
        labels = [_text(v) for v in x_values] if x_values is not None \
            else None
        if labels is not None:
            labels = (labels + [""] * len(values))[:len(values)]
            labels = [lab or f"Slice {i + 1}" for i, lab in enumerate(labels)]
        drawn = plot_pie(ax, values, labels, spec.get("pie") or {}, kind) \
            is not None
    elif kind in ("Heatmap", "3D Surface"):
        rows = [numbers(v) for _s, v in columns]
        width = min(len(r) for r in rows)
        if width:
            data = np.array([r[:width] for r in rows])
            if kind == "Heatmap" and len(rows) == 1:
                data = np.atleast_2d(data)
            artist = plot_one(ax, None, data, names[0], kind)
            if kind == "Heatmap":
                fig.colorbar(artist, ax=ax)
                ax.set_yticks(range(len(names)))
                ax.set_yticklabels(names)
            drawn = True
    elif kind == "Box":
        data = [numbers(v) for _s, v in columns]
        data = [d[~np.isnan(d)] for d in data]
        if any(len(d) for d in data):
            bp = ax.boxplot(data, patch_artist=True)
            ax.set_xticks(range(1, len(names) + 1))
            ax.set_xticklabels(names)
            for patch, color in zip(bp["boxes"], colors):
                patch.set_facecolor(color)
                patch.set_alpha(0.6)
            drawn = True
    elif kind == "Histogram":
        for (s, values), name, color in zip(columns, names, colors):
            y = numbers(values)
            y = y[~np.isnan(y)]
            if len(y):
                ax.hist(y, bins=spec.get("bins") or "auto", label=name,
                        alpha=0.7 if len(columns) > 1 else 0.9,
                        color=color)
                drawn = True
    else:
        labels = None
        bars = kind == "Bar"
        points = {}
        width = 0.8 / max(1, len(columns))
        for i, ((s, values), name, color) in enumerate(
                zip(columns, names, colors)):
            x, y, lab = series_xy(x_values, values)
            if not len(y):
                continue
            if lab is not None:
                labels = labels or lab
            # Categories (and plain 1, 2, 3…) count from 1 in the fit,
            # as in Excel, though they are drawn at 0, 1, 2…
            points[i] = (x, y, 1.0 if lab not in (None, "TIME") or
                         x_values is None else 0.0)
            if bars:
                # Side by side: numeric X keeps its spacing.
                step = 1.0
                if lab is None and x_values is not None and len(x) > 1:
                    step = float(np.min(np.diff(np.unique(x)))) or 1.0
                offset = (i - (len(columns) - 1) / 2) * width * step
                ax.bar(x + offset, y, width=width * step, label=name,
                       color=color)
            else:
                artist = plot_one(ax, x, y, name, kind)
                _color(artist, color)
            drawn = True
        results = _trendlines(ax, spec, points, colors)
        if fits is not None:
            fits.extend(results)
        if labels == "TIME":
            _time_x(ax)
        elif labels:
            _categorical_x(fig, ax, labels)
        elif bars and x_values is None:
            ax.set_xticks(np.arange(max(len(v) for _s, v in columns)))

    if not drawn:
        ax.clear()
        _message(ax, "No numbers to plot in this range")
        return ax

    if kind not in PIE_TYPES:
        if spec.get("xLabel"):
            ax.set_xlabel(spec["xLabel"])
        if spec.get("yLabel"):
            ax.set_ylabel(spec["yLabel"])
        for axis, key in (("x", "logX"), ("y", "logY")):
            if spec.get(key) and not is_3d:
                try:
                    getattr(ax, f"set_{axis}scale")("log")
                except ValueError:
                    pass
        if spec.get("grid"):
            ax.grid(True, alpha=0.4)
    if spec.get("title"):
        ax.set_title(spec["title"])
    legend = spec.get("legend", len(series) > 1 or bool(
        spec.get("trendlines")))
    if legend and kind not in PIE_TYPES and kind not in (
            "Heatmap", "3D Surface", "Box"):
        ax.legend(loc="best", fontsize=8)
    return ax


def _clean(value):
    """A number for JSON (NaN and infinities become None)."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _trendlines(ax, spec: dict, points: dict, colors: List[str]) -> list:
    """Fit and draw the spec's trendlines; returns what each fit found."""
    from .fitting import MOVING_AVERAGE_KEY, fit_series

    results = []
    notes = []
    # Default colours: red, purple, brown… but never the series' own.
    spare = [c for c in DEFAULT_COLORS[3:] + DEFAULT_COLORS[:3]
             if c not in colors] or DEFAULT_COLORS
    for k, t in enumerate(spec.get("trendlines") or []):
        index = int(t.get("series", 0) or 0)
        model = t.get("model") or "Linear"
        if index not in points:
            results.append({"error": "That series has no data."})
            continue
        x, y, shift = points[index]
        fit = fit_series(x + shift, y, model,
                         poly_order=int(t.get("polyOrder") or 2),
                         ma_period=int(t.get("maPeriod") or 2))
        if "error" in fit:
            results.append({"error": fit["error"]})
            continue
        color = t.get("color") or spare[k % len(spare)]
        if model == MOVING_AVERAGE_KEY:
            period = int(t.get("maPeriod") or 2)
            xs = x[period - 1:]
            ys = np.convolve(y, np.ones(period) / period, mode="valid")
        else:
            lo = float(np.min(x)) - float(t.get("backward") or 0)
            hi = float(np.max(x)) + float(t.get("forward") or 0)
            xs = np.linspace(lo, hi, 300)
            with np.errstate(all="ignore"):
                ys = np.asarray(fit["predict"](xs + shift), dtype=float)
        name = t.get("name") or (
            f"{model} ({(spec['series'][index].get('name') or 'series ' + str(index + 1))})")
        ax.plot(xs, ys, linestyle=t.get("linestyle") or "--",
                linewidth=float(t.get("linewidth") or 1.5), color=color,
                label=name)
        gof = fit.get("gof", {})
        if t.get("showEquation") and fit.get("equation"):
            notes.append((fit["equation"], color))
        if t.get("showR2") and _clean(gof.get("R²")) is not None:
            notes.append((f"R² = {gof['R²']:.4f}", color))
        results.append({
            "model": fit.get("model", model),
            "equation": fit.get("equation", ""),
            "params": {k: _clean(v) for k, v in fit["params"].items()},
            "errors": {k: _clean(v) for k, v in fit["errors"].items()},
            "gof": {k: _clean(v) for k, v in gof.items()},
        })
    y_pos = 0.95
    for text, color in notes:
        ax.text(0.03, y_pos, text, transform=ax.transAxes, fontsize=8,
                color=color, va="top",
                bbox=dict(boxstyle="round,pad=0.25", facecolor="white",
                          edgecolor=color, alpha=0.85))
        y_pos -= 0.09
    return results


def _color(artist, color):
    """Give a line, scatter or stem series its colour."""
    try:
        if hasattr(artist, "set_color"):
            artist.set_color(color)
        elif hasattr(artist, "markerline"):          # stem
            artist.markerline.set_color(color)
            artist.stemlines.set_color(color)
    except Exception:
        pass


def render_svg(spec: dict, read: Callable[[str], Sequence],
               dpi: int = 96) -> str:
    """The chart *spec* as an SVG image (text kept as text)."""
    return render_chart(spec, read, dpi)["svg"]


def render_chart(spec: dict, read: Callable[[str], Sequence],
                 dpi: int = 96) -> dict:
    """{"svg": the chart as SVG, "fits": each trendline's fit}."""
    import matplotlib
    matplotlib.rcParams["svg.fonttype"] = "none"
    from matplotlib.figure import Figure

    width = max(160, int(spec.get("width") or 480))
    height = max(120, int(spec.get("height") or 300))
    fig = Figure(figsize=(width / dpi, height / dpi), dpi=dpi)
    fig.patch.set_facecolor("white")
    fits: list = []
    draw_chart(fig, spec, read, fits)
    try:
        fig.tight_layout()
    except Exception:
        pass
    out = io.StringIO()
    fig.savefig(out, format="svg", facecolor="white")
    return {"svg": out.getvalue(), "fits": fits}
