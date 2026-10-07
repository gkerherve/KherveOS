"""Charts: the desktop's saved charts ↔ chart specs, and drawing them.

The web grid keeps each chart as the spec ``core.charts`` draws (see its
docstring), plus ``left``/``top`` (the chart's place on the sheet in
pixels, the desktop's ``pos_x``/``pos_y``) and ``desktop`` (what a
desktop chart saved that a spec cannot say, written back unchanged).

A desktop chart drawn from grid columns becomes ranges ("B20:B540"); one
holding its own numbers (a pie, a heatmap, an old file) keeps them in
``data`` and refers to them as "@…" ranges.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import copy
import math
import re

from khervesheet.core.refs import col_index_to_letter, letter_to_col_index

CHART_TYPES = [
    "Line", "Line+Symbol", "Scatter", "Bar", "Step", "Stem", "Histogram",
    "Box", "Pie", "Doughnut", "3D Pie", "Heatmap", "3D Surface",
]
PIE_TYPES = {"Pie", "Doughnut", "3D Pie"}
MATRIX_TYPES = {"Heatmap", "3D Surface"}
_NO_X = {"Histogram", "Box", "Heatmap", "3D Surface"}

#: Desktop chart keys a spec carries itself (the rest stay in "desktop").
_SPEC_KEYS = {"series", "pos_x", "pos_y", "width", "height", "title",
              "xlabel", "ylabel", "xscale", "yscale", "grid",
              "legend_visible", "x_col", "y_cols", "cat_labels", "time_x",
              "trendlines", "pie_config"}
_COLUMN = re.compile(
    r"^\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?([A-Za-z]{1,3})\$?(\d{1,7}))?$")


def _col_ref(col, r1=None, r2=None):
    letter = col_index_to_letter(int(col))
    if r1 is None or r2 is None:
        return f"{letter}:{letter}"
    return f"{letter}{int(r1) + 1}:{letter}{int(r2) + 1}"


def _floats(values):
    out = []
    for v in values:
        try:
            f = float(v)
        except (TypeError, ValueError):
            out.append(None)
            continue
        out.append(f if math.isfinite(f) else None)
    return out


def _texts(values):
    return ["" if v is None else str(v) for v in values]


# ── Desktop → spec ───────────────────────────────────────────────────
def spec_from_desktop(d: dict) -> dict:
    """A spec for a chart read from a .ksheet (its dict as the desktop's
    ``EmbeddedChart.to_dict``)."""
    series = d.get("series") or []
    kind = (series[0].get("plot_type") if series else None) or "Line"
    if kind not in CHART_TYPES:
        kind = "Line"
    y_cols = d.get("y_cols") or []
    data: dict = {}
    out = []
    x_ref = None
    if kind in MATRIX_TYPES and series:
        rows = series[0].get("y") or []
        for i, row in enumerate(rows):
            key = f"@m{i}"
            data[key] = _floats(row if isinstance(row, (list, tuple))
                                else [row])
            out.append({"ref": key, "name": series[0].get("label") or None})
    elif kind in PIE_TYPES and series:
        s = series[0]
        data["@pie"] = _floats(s.get("y") or [])
        labels = (d.get("pie_config") or {}).get("labels")
        if labels:
            data["@labels"] = _texts(labels)
            x_ref = "@labels"
        out.append({"ref": "@pie", "name": s.get("label") or None})
    else:
        for i, s in enumerate(series):
            yc = s.get("y_col", y_cols[i] if i < len(y_cols) else None)
            color = s.get("color") or s.get("markerfacecolor")
            name = s.get("label") or None
            if yc is not None:
                ref = _col_ref(yc, s.get("y_row_start"), s.get("y_row_end"))
            else:
                ref = f"@y{i}"
                data[ref] = _floats(s.get("y") or [])
            entry = {"ref": ref, "name": name, "color": color}
            if s.get("plot_type") and s.get("plot_type") != kind:
                # Mixed types (a fit drawn as a line over symbols): the
                # spec draws one type, the desktop keeps each series' own.
                entry["plotType"] = s["plot_type"]
            out.append(entry)
            if i == 0:
                xc = s.get("x_col", d.get("x_col"))
                if xc is not None and yc is not None:
                    x_ref = _col_ref(xc, s.get("x_row_start",
                                               s.get("y_row_start")),
                                     s.get("x_row_end", s.get("y_row_end")))
                elif yc is None and d.get("cat_labels"):
                    data["@x"] = _texts(d["cat_labels"])
                    x_ref = "@x"
                elif yc is None and s.get("x") is not None:
                    data["@x"] = _floats(s.get("x") or [])
                    x_ref = "@x"
    trend = []
    for t in d.get("trendlines") or []:
        trend.append({
            "series": int(t.get("series_idx", 0) or 0),
            "model": t.get("model_name") or "Linear",
            "polyOrder": int(t.get("poly_order", 4) or 4),
            "maPeriod": int(t.get("ma_period", 2) or 2),
            "color": t.get("color") or None,
            "showEquation": bool(t.get("show_equation")),
            "showR2": bool(t.get("show_r_squared")),
            "linestyle": t.get("linestyle") or "--",
            "linewidth": float(t.get("linewidth") or 1.5),
        })
    labels = {"x": d.get("xlabel") or "", "y": d.get("ylabel") or ""}
    scales = {"x": d.get("xscale"), "y": d.get("yscale")}
    axis = d.get("axis_props")
    if isinstance(axis, dict):
        # The desktop applies its saved axis state last: it wins.
        for direction in ("x", "y"):
            st = axis.get(direction)
            if isinstance(st, dict):
                if "title_text" in st:
                    labels[direction] = (st.get("title_text") or "") \
                        if st.get("title_show", True) else ""
                if st.get("scale"):
                    scales[direction] = st["scale"]
    spec = {
        "type": kind,
        "title": d.get("title") or "",
        "xLabel": labels["x"],
        "yLabel": labels["y"],
        "x": x_ref,
        "series": out,
        "legend": bool(d.get("legend_visible", True)),
        "grid": bool(d.get("grid", False)),
        "logX": scales["x"] == "log",
        "logY": scales["y"] == "log",
        "width": int(d.get("width") or 480),
        "height": int(d.get("height") or 320),
        "left": int(d.get("pos_x") or 0),
        "top": int(d.get("pos_y") or 0),
        "trendlines": trend,
    }
    pie = {k: v for k, v in (d.get("pie_config") or {}).items()
           if k != "labels"}
    if pie:
        spec["pie"] = pie
    if data:
        spec["data"] = data
    keep = {k: v for k, v in d.items() if k not in _SPEC_KEYS}
    keep["series"] = [{k: v for k, v in s.items() if k not in ("x", "y")}
                      for s in series]
    spec["desktop"] = keep
    return spec


def spec_from_xlsx(spec: dict, col_left, row_top) -> dict:
    """A spec read by core.xlsx (anchored to a cell) placed in pixels."""
    out = dict(spec)
    out.pop("sheet", None)
    out["left"] = int(col_left(int(spec.get("col") or 0)))
    out["top"] = int(row_top(int(spec.get("row") or 0)))
    out.setdefault("trendlines", [])
    return out


# ── Reading a spec's ranges ──────────────────────────────────────────
def reader(workbook, sheet_name, spec):
    """read(ref) for core.charts: a range of the workbook (relative to the
    chart's sheet) or one of the spec's own "@…" lists."""
    data = spec.get("data") or {}

    def read(ref):
        if ref in data:
            return list(data[ref])
        if not ref:
            return []
        return workbook.range_values(ref, sheet=sheet_name)
    return read


def render(workbook, sheet_name, spec, dpi=96):
    """{"svg", "fits"} for one chart (core.charts.render_chart)."""
    from khervesheet.core.charts import render_chart
    clean = {k: v for k, v in spec.items() if k not in ("desktop", "data")}
    return render_chart(clean, reader(workbook, sheet_name, spec), dpi)


# ── Spec → desktop ───────────────────────────────────────────────────
def _single_column(ref, sheet_name):
    """(col, r1, r2) of a one-column range on the chart's own sheet."""
    if not ref or ref.startswith("@"):
        return None
    name, bang, cells = ref.rpartition("!")
    if bang and name.strip().strip("'").lower() != sheet_name.lower():
        return None
    m = _COLUMN.match(cells.strip())
    if not m:
        m2 = re.match(r"^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$",
                      cells.strip())
        if m2 and m2.group(1).upper() == m2.group(2).upper():
            return letter_to_col_index(m2.group(1)), None, None
        return None
    c1 = letter_to_col_index(m.group(1))
    c2 = letter_to_col_index(m.group(3)) if m.group(3) else c1
    if c1 != c2:
        return None
    r1 = int(m.group(2)) - 1
    r2 = int(m.group(4)) - 1 if m.group(4) else r1
    return c1, min(r1, r2), max(r1, r2)


def _clean(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def desktop_from_spec(workbook, sheet_name, spec):
    """The dict the desktop's ``EmbeddedChart.from_dict`` reads, with the
    chart's current numbers as its series data."""
    import numpy as np
    from khervesheet.core.charts import numbers, series_xy

    base = copy.deepcopy(spec.get("desktop") or {})
    old_series = base.pop("series", None) or []
    read = reader(workbook, sheet_name, spec)
    kind = spec.get("type") or "Line"
    s_specs = [s for s in spec.get("series") or [] if s.get("ref")]
    x_ref = spec.get("x") or None
    x_values = read(x_ref) if x_ref and kind not in _NO_X else None
    series = []
    cat_labels, time_x = None, False
    points = {}

    def props(i, extra):
        sd = dict(old_series[i]) if i < len(old_series) else {}
        sd.update(extra)
        return sd

    if kind in MATRIX_TYPES:
        rows = [numbers(read(s["ref"])) for s in s_specs]
        width = min((len(r) for r in rows), default=0)
        matrix = [list(map(float, np.nan_to_num(r[:width]))) for r in rows]
        series.append(props(0, {
            "x": [float(i) for i in range(width)], "y": matrix,
            "label": (s_specs[0].get("name") if s_specs else None) or "Data",
            "plot_type": kind}))
    elif kind in PIE_TYPES:
        values = numbers(read(s_specs[0]["ref"])) if s_specs else \
            np.array([])
        mask = ~np.isnan(values)
        vals = [float(v) for v in values[mask]]
        series.append(props(0, {
            "x": [float(i) for i in range(len(vals))], "y": vals,
            "label": (s_specs[0].get("name") if s_specs else None) or "Data",
            "plot_type": kind}))
        if x_values is not None:
            labels = _texts(x_values)
            base_pie = dict(spec.get("pie") or {})
            base_pie["labels"] = [lab for lab, m in zip(labels, mask) if m]
            base["pie_config"] = base_pie
    else:
        y_cols, x_col = [], None
        for i, s in enumerate(s_specs):
            x, y, labels = series_xy(x_values, read(s["ref"]))
            if labels == "TIME":
                time_x = True
            elif labels is not None:
                cat_labels = cat_labels or labels
            points[i] = (x, y, 1.0 if labels not in (None, "TIME") or
                         x_values is None else 0.0)
            sd = props(i, {"x": [float(v) for v in x],
                           "y": [float(v) for v in y],
                           "label": s.get("name") or s["ref"],
                           "plot_type": s.get("plotType") or kind})
            if s.get("color"):
                sd["color"] = s["color"]
            for k in ("x_col", "y_col", "x_row_start", "x_row_end",
                      "y_row_start", "y_row_end"):
                sd.pop(k, None)
            ycol = _single_column(s["ref"], sheet_name)
            xcol = _single_column(x_ref, sheet_name) if x_ref else None
            if ycol is not None:
                y_cols.append(ycol[0])
                sd["y_col"] = ycol[0]
                if ycol[1] is not None:
                    # Like the desktop's add_series: X rows follow Y's
                    # unless the X range says otherwise.
                    sd["y_row_start"], sd["y_row_end"] = ycol[1], ycol[2]
                    sd["x_row_start"], sd["x_row_end"] = ycol[1], ycol[2]
                if xcol is not None:
                    sd["x_col"] = xcol[0]
                    x_col = xcol[0] if x_col is None else x_col
                    if xcol[1] is not None:
                        sd["x_row_start"], sd["x_row_end"] = xcol[1], xcol[2]
            series.append(sd)
        if y_cols and len(y_cols) == len(series):
            base["y_cols"] = y_cols
            if x_col is not None:
                base["x_col"] = x_col
        if cat_labels:
            base["cat_labels"] = cat_labels
        if time_x:
            base["time_x"] = True

    base.update({
        "series": series,
        "pos_x": int(spec.get("left") or 0),
        "pos_y": int(spec.get("top") or 0),
        "width": int(spec.get("width") or 480),
        "height": int(spec.get("height") or 320),
        "title": spec.get("title") or "",
        "xlabel": spec.get("xLabel") or "",
        "ylabel": spec.get("yLabel") or "",
        "xscale": "log" if spec.get("logX") else "linear",
        "yscale": "log" if spec.get("logY") else "linear",
        "grid": bool(spec.get("grid")),
        "legend_visible": bool(spec.get("legend", len(series) > 1)),
    })
    if kind in PIE_TYPES and spec.get("pie") and "pie_config" not in base:
        base["pie_config"] = dict(spec["pie"])
    axis = base.get("axis_props")
    if isinstance(axis, dict):
        # The web edits titles and scales: keep the desktop's saved axis
        # state in step, or it would win when the desktop opens the file.
        for direction, label, log in (("x", "xlabel", "logX"),
                                      ("y", "ylabel", "logY")):
            st = axis.get(direction)
            if isinstance(st, dict):
                st["scale"] = "log" if spec.get(log) else "linear"
                if base[label] or st.get("title_show", True):
                    st["title_text"] = base[label]
    base["trendlines"] = _desktop_trendlines(spec, points)
    if not base["trendlines"]:
        base.pop("trendlines")
    return base


def _desktop_trendlines(spec, points):
    """The spec's trendlines as the desktop's TrendlineInfo dicts."""
    out = []
    tl = spec.get("trendlines") or []
    if not tl:
        return out
    from khervesheet.core.fitting import MOVING_AVERAGE_KEY, fit_series
    for t in tl:
        index = int(t.get("series", 0) or 0)
        model = t.get("model") or "Linear"
        params, equation, gof = {}, "", {}
        if index in points:
            x, y, shift = points[index]
            fit = fit_series(x + shift, y, model,
                             poly_order=int(t.get("polyOrder") or 2),
                             ma_period=int(t.get("maPeriod") or 2))
            if "error" not in fit:
                params = {k: _clean(v) for k, v in fit["params"].items()}
                equation = fit.get("equation", "")
                gof = {k: _clean(v) for k, v in fit.get("gof", {}).items()}
        d = {
            "series_idx": index,
            "model_name": model,
            "params": params,
            "equation": equation,
            "gof": gof,
            "show_equation": bool(t.get("showEquation")),
            "show_r_squared": bool(t.get("showR2")),
            "color": t.get("color") or "#d62728",
            "linestyle": t.get("linestyle") or "--",
            "linewidth": float(t.get("linewidth") or 1.5),
        }
        if model == "Polynomial":
            d["poly_order"] = int(t.get("polyOrder") or 2)
        if model == MOVING_AVERAGE_KEY:
            d["ma_period"] = int(t.get("maPeriod") or 2)
        out.append(d)
    return out
