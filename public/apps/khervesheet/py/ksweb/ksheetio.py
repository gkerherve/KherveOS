"""The desktop's native .ksheet files (HDF5, read and written with h5py),
following ``MainWindow._load_ksheet`` / ``_save_to_ksheet`` attribute by
attribute, so a workbook goes back and forth between KherveOS and the
desktop app.

What the web app does not draw (shapes, the Layout tab, the solver and
fitting set-ups…) is read and written back unchanged. Its own extras —
row heights and frozen panes — are stored in attributes the desktop
ignores (``web_row_heights``, ``web_freeze``).

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import base64
import json

#: The desktop's default column width (QHeaderView default section size).
DEFAULT_COL_WIDTH = 80
#: The smallest sheet written, like a new desktop sheet (1000 × 26).
MIN_ROWS, MIN_COLS = 1000, 26


def _text(v):
    """An HDF5 attribute as str (h5py gives bytes or numpy strings)."""
    if v is None:
        return None
    if isinstance(v, bytes):
        return v.decode("utf-8")
    try:
        import numpy as np
        if isinstance(v, np.bytes_):
            return bytes(v).decode("utf-8")
        if isinstance(v, np.generic):
            v = v.item()
    except Exception:
        pass
    return v if isinstance(v, str) else str(v)


def _json(attrs, key, default=None):
    raw = _text(attrs.get(key))
    if not raw:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


def _num(v, cast=int, default=0):
    try:
        return cast(v.item() if hasattr(v, "item") else v)
    except (TypeError, ValueError):
        return default


# ── Reading ──────────────────────────────────────────────────────────
def _read_chart(cg):
    """One chart group, as the desktop's _load_ksheet builds its dict."""
    series = []
    for ki in range(_num(cg.attrs.get("series_count", 0))):
        key = f"series_{ki}"
        if key not in cg:
            continue
        srg = cg[key]
        sd = {"x": srg["x"][()].tolist() if "x" in srg else [],
              "y": srg["y"][()].tolist() if "y" in srg else [],
              "label": _text(srg.attrs.get("label")) or "",
              "plot_type": _text(srg.attrs.get("plot_type")) or "Line"}
        props = _json(srg.attrs, "props", {})
        if isinstance(props, dict):
            sd.update(props)
        series.append(sd)
    a = cg.attrs
    d = {
        "series": series,
        "pos_x": _num(a.get("pos_x", 40)),
        "pos_y": _num(a.get("pos_y", 40)),
        "width": _num(a.get("width", 480)),
        "height": _num(a.get("height", 320)),
        "title": _text(a.get("title")) or "",
        "xlabel": _text(a.get("xlabel", "X")) or "",
        "ylabel": _text(a.get("ylabel", "Y")) or "",
        "xscale": _text(a.get("xscale", "linear")) or "linear",
        "yscale": _text(a.get("yscale", "linear")) or "linear",
        "grid": bool(_num(a.get("grid", False), bool, False)),
        "top_label": _text(a.get("top_label")) or "",
        "right_label": _text(a.get("right_label")) or "",
        "legend_visible": bool(_num(a.get("legend_visible", True), bool,
                                    True)),
        "legend_size": _num(a.get("legend_size", 8)),
    }
    if a.get("legend_font"):
        d["legend_font"] = _text(a.get("legend_font"))
    for key, attr in (("legend_props", "legend_props"),
                      ("axis_props", "axis_props"),
                      ("general_props", "general_props"),
                      ("y_cols", "y_cols"), ("cat_labels", "cat_labels"),
                      ("bar_config", "bar_config"),
                      ("pie_config", "pie_config"),
                      ("heatmap_config", "heatmap_config"),
                      ("surface3d_config", "surface3d_config"),
                      ("trendlines", "trendlines"),
                      ("annotations", "annotations")):
        value = _json(a, attr)
        if value is not None:
            d[key] = value
    if "x_col" in a:
        d["x_col"] = _num(a["x_col"])
    if _num(a.get("time_x", False), bool, False):
        d["time_x"] = True
    return d


def _read_image(ig):
    ds = ig["png_data"]
    raw = bytes(ds[()]) if ds.shape == () else bytes(ds[:].tobytes())
    a = ig.attrs
    img = {"pos_x": _num(a.get("pos_x", 0)), "pos_y": _num(a.get("pos_y", 0)),
           "width": _num(a.get("width", 100)),
           "height": _num(a.get("height", 100)),
           "data": base64.b64encode(raw).decode("ascii")}
    crop = _json(a, "crop")
    if crop is not None:
        img["crop"] = crop
    for key in ("hue_shift", "saturation", "brightness", "group_id"):
        if key in a:
            img[key] = _num(a[key])
    if "keep_aspect_ratio" in a:
        img["keep_aspect_ratio"] = bool(_num(a["keep_aspect_ratio"], bool))
    return img


def _cells_array(ds):
    """The flat cell strings of a sheet, as str."""
    try:
        return ds.asstr()[()].tolist()
    except (AttributeError, TypeError, ValueError):
        return [_text(v) or "" for v in ds[()].tolist()]


def read_ksheet(data: bytes) -> dict:
    """Everything in a .ksheet file:

    {"layoutSettings": str | None,
     "sheets": [{"name", "rows", "cols", "cells": {(r, c): source},
                 "formats": {"r,c": fmt}, "merges", "widths",
                 "designations", "insertOps", "pyLoops", "charts",
                 "images", "shapes", "equations", "solverConfig",
                 "fitConfig", "rowHeights", "freeze"}…]}"""
    import h5py

    out = {"layoutSettings": None, "sheets": []}
    with _scratch(data) as path, h5py.File(path, "r") as f:
        if _text(f.attrs.get("format")) != "ksheet":
            raise ValueError("Not a valid .ksheet file.")
        out["layoutSettings"] = _text(f.attrs.get("layout_settings"))
        count = _num(f.attrs.get("sheet_count", 0))
        for si in range(count):
            key = f"sheet_{si}"
            if key not in f:
                continue
            sg = f[key]
            a = sg.attrs
            rows, cols = _num(a.get("rows", 0)), _num(a.get("cols", 0))
            cells = {}
            if "cells" in sg and cols > 0:
                for idx, val in enumerate(_cells_array(sg["cells"])):
                    if val:
                        cells[divmod(idx, cols)] = val
            sheet = {
                "name": _text(a.get("name")) or f"Sheet{si + 1}",
                "rows": rows, "cols": cols, "cells": cells,
                "formats": _json(a, "cell_formats", {}) or {},
                "merges": _json(a, "merged_ranges", []) or [],
                "designations": _json(a, "col_designations", {}) or {},
                "insertOps": _json(a, "insert_ops", {}) or {},
                "pyLoops": _json(a, "py_loops", {}) or {},
                "solverConfig": _json(a, "solver_config"),
                "fitConfig": _json(a, "fit_config"),
                "rowHeights": _json(a, "web_row_heights", {}) or {},
                "freeze": _json(a, "web_freeze"),
                "widths": [int(w) for w in sg["col_widths"][()].tolist()]
                if "col_widths" in sg else [],
                "charts": [], "images": [], "shapes": [], "equations": [],
            }
            for ci in range(_num(a.get("chart_count", 0))):
                if f"chart_{ci}" in sg:
                    try:
                        sheet["charts"].append(_read_chart(sg[f"chart_{ci}"]))
                    except Exception:
                        pass   # one bad chart must not cost the file
            for ii in range(_num(a.get("image_count", 0))):
                if f"image_{ii}" in sg:
                    try:
                        sheet["images"].append(_read_image(sg[f"image_{ii}"]))
                    except Exception:
                        pass
            for kind, prefix, count_key in (
                    ("shapes", "shape", "shape_count"),
                    ("equations", "equation", "equation_count")):
                for i in range(_num(a.get(count_key, 0))):
                    g = f"{prefix}_{i}"
                    if g in sg:
                        item = _json(sg[g].attrs, "data")
                        if item is not None:
                            sheet[kind].append(item)
            out["sheets"].append(sheet)
    return out


# ── Writing ──────────────────────────────────────────────────────────
def _set_json(attrs, key, value):
    if value:
        attrs[key] = json.dumps(value)


def _write(f, workbook, layout):
    import h5py
    import numpy as np

    from .chartsio import desktop_from_spec

    sheets = {s.get("name"): s for s in layout.get("sheets") or []}
    f.attrs["format"] = "ksheet"
    f.attrs["version"] = 1
    f.attrs["sheet_count"] = len(workbook.sheets)
    if layout.get("layoutSettings"):
        f.attrs["layout_settings"] = layout["layoutSettings"]
    for i, sheet in enumerate(workbook.sheets):
        lay = sheets.get(sheet.name) or {}
        sg = f.create_group(f"sheet_{i}")
        used_r = max((r for r, _c in sheet.sources), default=-1) + 1
        used_c = max((c for _r, c in sheet.sources), default=-1) + 1
        rows = max(used_r, int(lay.get("rows") or MIN_ROWS))
        cols = max(used_c, int(lay.get("cols") or MIN_COLS))
        sg.attrs["name"] = sheet.name
        sg.attrs["rows"] = rows
        sg.attrs["cols"] = cols
        flat = [""] * (rows * cols)
        for (r, c), src in sheet.sources.items():
            if r < rows and c < cols:
                flat[r * cols + c] = src
        sg.create_dataset("cells", data=flat, dtype=h5py.string_dtype())
        _set_json(sg.attrs, "cell_formats", lay.get("formats"))
        _set_json(sg.attrs, "merged_ranges", lay.get("merges"))
        _set_json(sg.attrs, "col_designations", lay.get("designations"))
        _set_json(sg.attrs, "insert_ops", lay.get("insertOps"))
        _set_json(sg.attrs, "py_loops", lay.get("pyLoops"))
        _set_json(sg.attrs, "web_row_heights", lay.get("rowHeights"))
        if lay.get("freeze") and any(lay["freeze"]):
            sg.attrs["web_freeze"] = json.dumps(lay["freeze"])
        given = {int(k): int(v) for k, v in (lay.get("widths") or {}).items()}
        widths = [given.get(c, DEFAULT_COL_WIDTH) for c in range(cols)]
        sg.create_dataset("col_widths", data=np.array(widths, dtype=np.int64))

        charts = lay.get("charts") or []
        written = 0
        for spec in charts:
            try:
                d = desktop_from_spec(workbook, sheet.name, spec)
            except Exception:
                continue
            if not d.get("series"):
                continue
            _write_chart(sg.create_group(f"chart_{written}"), d)
            written += 1
        sg.attrs["chart_count"] = written

        images = lay.get("images") or []
        sg.attrs["image_count"] = len(images)
        for ii, img in enumerate(images):
            ig = sg.create_group(f"image_{ii}")
            for key in ("pos_x", "pos_y", "width", "height"):
                ig.attrs[key] = int(img.get(key) or 0)
            if "crop" in img:
                ig.attrs["crop"] = json.dumps(img["crop"])
            for key in ("hue_shift", "saturation", "brightness"):
                if img.get(key):
                    ig.attrs[key] = int(img[key])
            if img.get("keep_aspect_ratio") is False:
                ig.attrs["keep_aspect_ratio"] = False
            if img.get("group_id") is not None:
                ig.attrs["group_id"] = int(img["group_id"])
            raw = base64.b64decode(img.get("data") or "")
            ig.create_dataset("png_data",
                              data=np.frombuffer(raw, dtype=np.uint8))
        for kind, prefix, count_key in (("shapes", "shape", "shape_count"),
                                        ("equations", "equation",
                                         "equation_count")):
            items = lay.get(kind) or []
            sg.attrs[count_key] = len(items)
            for k, item in enumerate(items):
                sg.create_group(f"{prefix}_{k}").attrs["data"] = \
                    json.dumps(item)
        _set_json(sg.attrs, "solver_config", lay.get("solverConfig"))
        _set_json(sg.attrs, "fit_config", lay.get("fitConfig"))


def _write_chart(cg, d):
    """One chart, attribute by attribute like the desktop's save."""
    import numpy as np

    cg.attrs["pos_x"] = int(d["pos_x"])
    cg.attrs["pos_y"] = int(d["pos_y"])
    cg.attrs["width"] = int(d["width"])
    cg.attrs["height"] = int(d["height"])
    cg.attrs["title"] = d.get("title", "")
    cg.attrs["xlabel"] = d.get("xlabel", "X")
    cg.attrs["ylabel"] = d.get("ylabel", "Y")
    cg.attrs["xscale"] = d.get("xscale", "linear")
    cg.attrs["yscale"] = d.get("yscale", "linear")
    cg.attrs["grid"] = bool(d.get("grid", False))
    cg.attrs["series_count"] = len(d["series"])
    for key in ("axis_props", "general_props", "legend_props", "y_cols",
                "cat_labels", "bar_config", "pie_config", "heatmap_config",
                "surface3d_config", "trendlines", "annotations"):
        if d.get(key):
            cg.attrs[key] = json.dumps(d[key])
    cg.attrs["top_label"] = d.get("top_label", "")
    cg.attrs["right_label"] = d.get("right_label", "")
    if d.get("x_col") is not None:
        cg.attrs["x_col"] = int(d["x_col"])
    if d.get("time_x"):
        cg.attrs["time_x"] = True
    cg.attrs["legend_visible"] = bool(d.get("legend_visible", True))
    if d.get("legend_font"):
        cg.attrs["legend_font"] = d["legend_font"]
    cg.attrs["legend_size"] = int(d.get("legend_size", 8) or 8)
    for ki, s in enumerate(d["series"]):
        srg = cg.create_group(f"series_{ki}")
        srg.create_dataset("x", data=np.asarray(s.get("x") or [],
                                                dtype=float))
        srg.create_dataset("y", data=np.asarray(s.get("y") or [],
                                                dtype=float))
        srg.attrs["label"] = str(s.get("label") or "")
        srg.attrs["plot_type"] = str(s.get("plot_type") or "Line")
        props = {k: v for k, v in s.items()
                 if k not in ("x", "y", "label", "plot_type")
                 and isinstance(v, (str, int, float, bool, dict, type(None)))}
        if props:
            srg.attrs["props"] = json.dumps(props)


def write_ksheet(workbook, layout) -> bytes:
    """The workbook as .ksheet bytes; *layout* holds what the grid keeps
    (formats, widths, charts…), one entry per sheet name."""
    import h5py

    with _scratch() as path:
        try:
            with h5py.File(path, "w") as f:
                _write(f, workbook, layout)
        except (ValueError, RuntimeError, OSError):
            # Attributes over 64 kB (many formatted cells) need the newer
            # HDF5 layout; the desktop's h5py reads it.
            with h5py.File(path, "w", libver="latest") as f:
                _write(f, workbook, layout)
        with open(path, "rb") as f:
            return f.read()


class _scratch:
    """A temporary file (outside the user's folder, so the drive never
    sees it) holding *data*; h5py reads and writes real files."""

    def __init__(self, data: bytes = b""):
        self.data = data
        self.path = None

    def __enter__(self):
        import os
        import tempfile
        fd, self.path = tempfile.mkstemp(suffix=".ksheet")
        with os.fdopen(fd, "wb") as f:
            f.write(self.data)
        return self.path

    def __exit__(self, *exc):
        import os
        try:
            os.remove(self.path)
        except OSError:
            pass
        return False
