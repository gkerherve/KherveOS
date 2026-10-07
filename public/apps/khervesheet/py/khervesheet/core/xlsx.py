"""Excel (.xlsx) without Qt: reading a workbook into KherveSheet's shared
layout (sheets, cell sources, formats, widths, frozen panes, charts) and
writing one back — what KherveCELL uses in the browser. The desktop's
excel_import / excel_export share the conversion tables below.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from .values import BLANK

# ── Colours ──────────────────────────────────────────────────────────
# Default Office theme palette, ordered by the *style* theme index
# (0=background1/lt1, 1=text1/dk1, 2=lt2, 3=dk2, 4..9=accent1..6,
# 10=hlink, 11=folHlink).  Used as a fallback when the workbook theme
# can't be parsed.
_DEFAULT_THEME = [
    "#FFFFFF", "#000000", "#E7E6E6", "#44546A",
    "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000",
    "#5B9BD5", "#70AD47", "#0563C1", "#954F72",
]


def _argb_to_hex(s):
    """'00FFFF99'/'FFFF0000'/'000000' -> '#RRGGBB' (alpha dropped)."""
    if not isinstance(s, str):
        return None
    if len(s) == 8:
        s = s[2:]
    if len(s) == 6:
        return "#" + s.upper()
    return None


def _apply_tint(hex_color, tint):
    """Lighten/darken a #RRGGBB color by an OpenXML tint factor."""
    if not tint:
        return hex_color
    try:
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
    except (ValueError, IndexError):
        return hex_color

    def adj(c):
        c = c * (1 + tint) if tint < 0 else c * (1 - tint) + 255 * tint
        return max(0, min(255, int(round(c))))

    return f"#{adj(r):02X}{adj(g):02X}{adj(b):02X}"


def build_theme_palette(wb):
    """Parse the workbook's theme colour scheme into the indexed list
    used by style theme references.  Falls back to the Office default."""
    raw = getattr(wb, "loaded_theme", None)
    if not raw:
        return list(_DEFAULT_THEME)
    try:
        ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
        root = ET.fromstring(raw)
        scheme = root.find(".//a:clrScheme", ns)
        by_name = {}
        for child in scheme:
            name = child.tag.split("}")[-1]
            srgb = child.find("a:srgbClr", ns)
            sysc = child.find("a:sysClr", ns)
            if srgb is not None:
                by_name[name] = "#" + srgb.get("val").upper()
            elif sysc is not None:
                by_name[name] = "#" + (
                    sysc.get("lastClr") or "000000").upper()
        order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2",
                 "accent3", "accent4", "accent5", "accent6",
                 "hlink", "folHlink"]
        pal = [by_name.get(n) or _DEFAULT_THEME[i]
               for i, n in enumerate(order)]
        return pal
    except Exception:
        return list(_DEFAULT_THEME)


def _color_hex(color, palette):
    """Resolve an openpyxl Color (rgb/theme/indexed) to '#RRGGBB'."""
    if color is None:
        return None
    ctype = getattr(color, "type", None)
    if ctype == "rgb":
        return _argb_to_hex(getattr(color, "rgb", None))
    if ctype == "theme":
        try:
            idx = int(color.theme)
        except (TypeError, ValueError):
            return None
        if 0 <= idx < len(palette):
            return _apply_tint(palette[idx], float(getattr(color, "tint", 0)
                                                  or 0))
        return None
    if ctype == "indexed":
        from openpyxl.styles.colors import COLOR_INDEX
        try:
            idx = int(color.indexed)
        except (TypeError, ValueError):
            return None
        if 0 <= idx < len(COLOR_INDEX):
            return _argb_to_hex(COLOR_INDEX[idx])
    return None


def _hex_to_argb(hex_color: str) -> str:
    """Convert '#RRGGBB' or '#AARRGGBB' to 8-char ARGB for openpyxl."""
    h = hex_color.lstrip("#")
    if len(h) == 6:
        return "FF" + h.upper()
    if len(h) == 8:
        return h.upper()
    return "FF000000"


# ── Number formats and formulas ──────────────────────────────────────
def _convert_number_format(fmt: str) -> str:
    """Convert KherveSheet number format string to Excel number format."""
    if not fmt or fmt == "General":
        return "General"
    if fmt == "Text":
        return "@"
    # Fixed decimal: "0", "0.0", "0.00", …
    if fmt.startswith("0"):
        return fmt
    # Scientific
    if fmt == "Scientific" or fmt.startswith("Sci:"):
        dec = 2
        if fmt.startswith("Sci:"):
            try:
                dec = int(fmt.split(":")[1])
            except (IndexError, ValueError):
                pass
        return "0." + "0" * dec + "E+00"
    # Percentage
    if fmt == "Percentage":
        return "0.00%"
    # Currency
    if fmt.startswith("Currency"):
        sym = "$"
        if ":" in fmt:
            sym = fmt.split(":", 1)[1]
        return f'{sym}#,##0.00'
    # Date
    if fmt.startswith("Date"):
        # Convert strftime patterns to Excel date format codes
        pattern = "yyyy-mm-dd"
        if ":" in fmt:
            py_pat = fmt.split(":", 1)[1]
            pattern = (py_pat
                       .replace("%Y", "yyyy")
                       .replace("%y", "yy")
                       .replace("%m", "mm")
                       .replace("%d", "dd")
                       .replace("%B", "mmmm")
                       .replace("%b", "mmm"))
        return pattern
    # Time
    if fmt.startswith("Time"):
        pattern = "hh:mm:ss"
        if ":" in fmt:
            py_pat = fmt.split(":", 1)[1]
            pattern = (py_pat
                       .replace("%H", "hh")
                       .replace("%M", "mm")
                       .replace("%S", "ss")
                       .replace("%I", "hh")
                       .replace("%p", "AM/PM"))
        return pattern
    return "General"


# Functions that exist in Excel with the same name and semantics.
_EXCEL_FUNCTIONS = {
    "ABS", "ACOS", "ACOSH", "AND", "ASIN", "ASINH", "ATAN", "ATAN2",
    "ATANH", "AVERAGE", "CEILING", "CHAR", "CHOOSE", "CLEAN", "CODE",
    "COLUMN", "COLUMNS", "COMBIN", "CONCAT", "CONCATENATE", "COS",
    "COSH", "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS",
    "DATE", "DAY", "DAYS", "DEGREES", "EVEN", "EXACT", "EXP", "FACT",
    "FALSE", "FIND", "FLOOR", "FV", "GCD", "HLOOKUP", "HOUR", "IF",
    "IFERROR", "IFNA", "IFS", "INDEX", "INT", "IPMT", "IRR", "ISBLANK",
    "ISERR", "ISERROR", "ISLOGICAL", "ISNA", "ISNONTEXT", "ISNUMBER",
    "ISTEXT", "LARGE", "LCM", "LEFT", "LEN", "LN", "LOG", "LOG10",
    "LOWER", "MATCH", "MAX", "MEDIAN", "MID", "MIN", "MINUTE", "MOD",
    "MONTH", "NOT", "NOW", "NPER", "NPV", "ODD", "OR", "PERCENTILE",
    "PI", "PMT", "POWER", "PPMT", "PRODUCT", "PROPER", "PV", "QUOTIENT",
    "RADIANS", "RAND", "RANDBETWEEN", "RANK", "RATE", "REPLACE", "REPT",
    "RIGHT", "ROUND", "ROUNDDOWN", "ROUNDUP", "ROW", "ROWS", "SEARCH",
    "SECOND", "SIGN", "SIN", "SINH", "SMALL", "SORT", "SQRT", "STDEV",
    "SUBSTITUTE", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "SUMSQ",
    "SWITCH", "TAN", "TANH", "TEXT", "TIME", "TODAY", "TRIM", "TRUE",
    "TRUNC", "TYPE", "UPPER", "VALUE", "VLOOKUP", "WEEKDAY", "XOR",
    "YEAR",
}

# Pattern for function names in a formula (word before open-paren).
_FUNC_RE = re.compile(r'([A-Za-z_][A-Za-z0-9_.]*)\s*\(')


def _is_excel_compatible(formula: str) -> bool:
    """Check whether a KherveSheet formula can be written to Excel as-is.

    Returns True for formulas that only use Excel-compatible functions,
    standard cell refs, ranges, and arithmetic operators.
    Returns False for =PY(...) cells and KherveSheet-specific functions.
    """
    if not formula or not formula.startswith("="):
        return False
    from .python import is_python_source
    body = formula[1:].strip()
    # Python cells are never compatible
    if is_python_source(formula) or body.upper().startswith("PY("):
        return False
    # Check every function call in the formula
    for m in _FUNC_RE.finditer(body):
        name = m.group(1).upper().replace(".", "_")
        if name not in _EXCEL_FUNCTIONS:
            return False
    return True


def _formula_for_excel(formula: str) -> str:
    """Prepare a KherveSheet formula for Excel.

    Replaces ^ (power) with Excel-compatible syntax and normalises
    function names.  The leading '=' is preserved.
    """
    # KherveSheet uses ^ for power like Excel, but the internal compiler
    # converts it to **.  The raw stored formula still has ^, so it's
    # already Excel-compatible.  Just return it as-is.
    return formula


# ── Chart references ─────────────────────────────────────────────────
_TYPE_MAP = {
    "lineChart": "Line", "line3DChart": "Line",
    "scatterChart": "Scatter",
    "barChart": "Bar", "bar3DChart": "Bar",
    "areaChart": "Line", "area3DChart": "Line",
}


def _parse_ref(ref):
    """Parse an Excel range ref ('Sheet1!$L$2:$L$252' or 'L2:L252')
    into (sheet_title|None, col0, row_start0, row_end0).  0-based."""
    if not ref:
        return None
    from openpyxl.utils import range_boundaries
    title = None
    rng = ref
    if "!" in ref:
        title, rng = ref.rsplit("!", 1)
        title = title.strip().strip("'").replace("''", "'")
    rng = rng.replace("$", "")
    try:
        min_col, min_row, max_col, max_row = range_boundaries(rng)
    except Exception:
        return None
    return title, min_col - 1, min_row - 1, max_row - 1


def _series_ref(src):
    """Return the .f range string from a num/str data source, or None."""
    if src is None:
        return None
    for attr in ("numRef", "strRef", "multiLvlStrRef"):
        ref = getattr(src, attr, None)
        if ref is not None and getattr(ref, "f", None):
            return ref.f
    return None


def _series_title(ser):
    tx = getattr(ser, "tx", None)
    if tx is None:
        return None
    v = getattr(tx, "v", None)
    if v:
        return str(v)
    sref = getattr(tx, "strRef", None)
    if sref is not None:
        cache = getattr(sref, "strCache", None)
        pts = getattr(cache, "pt", None) if cache is not None else None
        if pts:
            return str(pts[0].v)
        return sref.f
    return None


# ── Reading .xlsx into the shared layout ─────────────────────────────
#: Qt alignment flags, as the shared formats store them (see CellFormat).
_QT_ALIGN = {"left": 0x01, "center": 0x04, "centerContinuous": 0x04,
             "right": 0x02, "justify": 0x08}
_QT_VCENTER = 0x80
#: Qt pen styles and widths of Excel border styles (BorderSpec).
_BORDERS = {
    "thin": (1, 1.0), "medium": (1, 2.0), "thick": (1, 3.0),
    "dashed": (2, 1.0), "mediumDashed": (2, 2.0), "dotted": (3, 1.0),
    "double": (1, 2.5), "hair": (1, 0.5), "dashDot": (4, 1.0),
    "dashDotDot": (5, 1.0),
}
_XL_BORDER = {1: "thin", 2: "dashed", 3: "dotted", 4: "dashDot",
              5: "dashDotDot"}
_DEFAULT_FONTS = {"Calibri", "Aptos", "Aptos Narrow", "Arial"}
_PX_PER_CHAR = 7.0
_COL_PADDING = 5


def number_format_from_xl(code: str):
    """An Excel number format as one of KherveSheet's, or None."""
    if not code or code == "General":
        return None
    if code == "@":
        return "Text"
    plain = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", code).split(";")[0]
    if "%" in plain:
        return "Percentage"
    if "E+" in plain.upper():
        return "Scientific"
    for sym in ("€", "$", "£"):
        if sym in code:
            return f"Currency:{sym}"
    low = plain.lower()
    if "y" in low or "d" in low:
        year_first = "y" in low and "d" in low and \
            low.index("y") < low.index("d")
        return "Date:%Y-%m-%d" if year_first else "Date:%d/%m/%Y"
    if "h" in low and ("m" in low or "s" in low):
        return "Time:%H:%M"
    m = re.fullmatch(r"#?,?#*0(?:\.(0{1,4}))?", plain.replace("#,##", ""))
    if m:
        return "0." + m.group(1) if m.group(1) else "0"
    return None


def format_from_xl(cell, palette) -> dict:
    """The shared format (CellFormat.to_dict keys) of an openpyxl cell."""
    fmt: dict = {}
    f = getattr(cell, "font", None)
    if f is not None:
        if f.bold:
            fmt["bold"] = True
        if f.italic:
            fmt["italic"] = True
        if f.underline:
            fmt["underline"] = True
        fc = _color_hex(f.color, palette)
        if fc and fc != "#000000":
            fmt["font_color"] = fc
        if f.name and f.name not in _DEFAULT_FONTS:
            fmt["font_family"] = f.name
        if f.sz and float(f.sz) != 11:
            fmt["font_size"] = float(f.sz)
    fill = getattr(cell, "fill", None)
    if fill is not None and getattr(fill, "patternType", None) == "solid":
        bg = _color_hex(fill.fgColor, palette)
        if bg:
            fmt["bg"] = bg
    al = getattr(cell, "alignment", None)
    if al is not None:
        if al.horizontal in _QT_ALIGN:
            fmt["alignment"] = _QT_ALIGN[al.horizontal] | _QT_VCENTER
        if al.wrap_text:
            fmt["wrap_text"] = True
    b = getattr(cell, "border", None)
    if b is not None:
        for side in ("top", "bottom", "left", "right"):
            s = getattr(b, side, None)
            style = getattr(s, "style", None) if s is not None else None
            if style:
                pen, width = _BORDERS.get(style, (1, 1.0))
                fmt[f"b_{side}"] = {
                    "style": pen, "width": width,
                    "color": _color_hex(getattr(s, "color", None), palette)
                    or "#000000"}
    number = number_format_from_xl(getattr(cell, "number_format", ""))
    if number:
        fmt["number_format"] = number
    return fmt


def _source(value, number_format=None) -> str:
    """What typing the cell's value would be."""
    import datetime
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime.datetime):
        if value.time() == datetime.time(0):
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 1e15:
            return str(int(value))
        return repr(value)
    return str(value)


def _series_name(ser, book):
    """A series' name; a name that is a cell reference is read there."""
    name = _series_title(ser)
    ref = _parse_ref(name) if name and "!" in name else None
    if ref:
        title, col, row, _ = ref
        try:
            value = book[title].cell(row + 1, col + 1).value
        except KeyError:
            value = None
        return None if value is None else _source(value)
    return name


def _chart_spec(ch, sheet_title, ws, book=None) -> dict:
    """A chart spec (sheet names, not ids) from an openpyxl chart."""
    tag = getattr(ch, "tagname", "")
    kind = {"pieChart": "Pie", "pie3DChart": "3D Pie",
            "doughnutChart": "Doughnut"}.get(tag) or _TYPE_MAP.get(tag, "Line")
    if kind == "Scatter":
        style = getattr(ch, "scatterStyle", None)
        if style in ("lineMarker", "line", "smoothMarker", "smooth"):
            kind = "Line+Symbol"
    series, x_ref = [], None

    def ref(parsed):
        title, col, r1, r2 = parsed
        text = (f"{_letter(col)}{r1 + 1}:{_letter(col)}{r2 + 1}")
        if title and title != sheet_title:
            q = title if re.fullmatch(r"[A-Za-z_]\w*", title) else \
                "'" + title.replace("'", "''") + "'"
            return f"{q}!{text}"
        return text

    for ser in getattr(ch, "series", []) or []:
        yp = _parse_ref(_series_ref(getattr(ser, "val", None))
                        or _series_ref(getattr(ser, "yVal", None)))
        if not yp:
            continue
        series.append({"ref": ref(yp), "name": _series_name(ser, book)
                       if book is not None else _series_title(ser)})
        if x_ref is None:
            xp = _parse_ref(_series_ref(getattr(ser, "xVal", None))
                            or _series_ref(getattr(ser, "cat", None)))
            if xp:
                x_ref = ref(xp)
    title = ""
    try:
        runs = ch.title.tx.rich.p[0].r
        title = "".join(r.t for r in runs or [])
    except Exception:
        pass
    row = col = 0
    width, height = 480, 300
    anc = getattr(ch, "anchor", None)
    frm = getattr(anc, "_from", None)
    if frm is not None and hasattr(frm, "col"):
        col, row = int(frm.col), int(frm.row)
        to = getattr(anc, "to", None)
        if to is not None and hasattr(to, "col"):
            w = sum(_col_px(ws, c) for c in range(col, int(to.col)))
            h = (int(to.row) - row) * 20
            if w > 60 and h > 60:
                width, height = max(240, w), max(180, h)
    elif getattr(ch, "width", None):
        width = int(ch.width / 2.54 * 96)
        height = int(ch.height / 2.54 * 96)
    return {"sheet": sheet_title, "row": row, "col": col, "width": width,
            "height": height, "type": kind, "title": title, "x": x_ref,
            "series": series, "legend": len(series) > 1}


def _letter(col: int) -> str:
    from .refs import col_index_to_letter
    return col_index_to_letter(col)


def _col_px(ws, col: int) -> int:
    dim = ws.column_dimensions.get(_letter(col))
    width = getattr(dim, "width", None) if dim is not None else None
    return int(round(width * _PX_PER_CHAR + _COL_PADDING)) if width else 100


def read_xlsx(data: bytes) -> dict:
    """An .xlsx file as the shared layout:

    {"sheets": [{"name", "rows", "cols", "freezeRows", "freezeCols",
                 "cells": [[r, c, source]…], "formats": [[r, c, fmt]…],
                 "widths": [[c, px]…]}…],
     "charts": [chart spec with "sheet": name…]}"""
    import io

    import openpyxl
    from openpyxl.utils.cell import coordinate_from_string, \
        column_index_from_string

    book = openpyxl.load_workbook(io.BytesIO(data), data_only=False)
    palette = build_theme_palette(book)
    out = {"sheets": [], "charts": []}
    for ws in book.worksheets:
        cells, formats = [], []
        max_r = max_c = 0
        for row in ws.iter_rows():
            for cell in row:
                if not hasattr(cell, "column"):
                    continue          # the rest of a merged range
                r, c = cell.row - 1, cell.column - 1
                value = cell.value
                text = getattr(value, "text", None)   # array formulas
                source = text if isinstance(text, str) and \
                    text.startswith("=") else _source(value)
                fmt = format_from_xl(cell, palette)
                if source:
                    cells.append([r, c, source])
                if fmt:
                    formats.append([r, c, fmt])
                if source or fmt:
                    max_r, max_c = max(max_r, r), max(max_c, c)
        widths = []
        for letter, dim in ws.column_dimensions.items():
            if getattr(dim, "width", None) and not dim.hidden:
                try:
                    col = column_index_from_string(letter) - 1
                except ValueError:
                    continue
                px = int(round(dim.width * _PX_PER_CHAR + _COL_PADDING))
                if px != 100:
                    widths.append([col, px])
        freeze_rows = freeze_cols = 0
        if ws.freeze_panes:
            letters, number = coordinate_from_string(ws.freeze_panes)
            freeze_cols = column_index_from_string(letters) - 1
            freeze_rows = number - 1
        out["sheets"].append({
            "name": ws.title, "rows": max(5000, max_r + 1),
            "cols": max(50, max_c + 1), "freezeRows": freeze_rows,
            "freezeCols": freeze_cols, "cells": cells, "formats": formats,
            "widths": widths})
        for ch in getattr(ws, "_charts", []) or []:
            spec = _chart_spec(ch, ws.title, ws, book)
            if spec["series"]:
                out["charts"].append(spec)
    return out


# ── Writing the shared layout as .xlsx ───────────────────────────────
def _side(spec: dict):
    from openpyxl.styles import Side
    style = _XL_BORDER.get(int(spec.get("style", 1)), "thin")
    width = float(spec.get("width", 1.0))
    if style == "thin" and width >= 2.5:
        style = "thick"
    elif style == "thin" and width >= 1.5:
        style = "medium"
    return Side(style=style, color=_hex_to_argb(spec.get("color")
                                                or "#000000"))


def apply_format(cell, fmt: dict):
    """Style an openpyxl cell from a shared format dict."""
    from openpyxl.styles import Alignment, Border, Font, PatternFill
    font = {}
    for key in ("bold", "italic"):
        if fmt.get(key):
            font[key] = True
    if fmt.get("underline"):
        font["underline"] = "single"
    if fmt.get("font_family"):
        font["name"] = fmt["font_family"]
    if fmt.get("font_size"):
        font["size"] = float(fmt["font_size"])
    if fmt.get("font_color"):
        font["color"] = _hex_to_argb(fmt["font_color"])
    if font:
        cell.font = Font(**font)
    if fmt.get("bg"):
        argb = _hex_to_argb(fmt["bg"])
        cell.fill = PatternFill(start_color=argb, end_color=argb,
                                fill_type="solid")
    sides = {side: _side(fmt[f"b_{side}"])
             for side in ("top", "bottom", "left", "right")
             if isinstance(fmt.get(f"b_{side}"), dict)}
    if sides:
        cell.border = Border(**sides)
    align = {}
    flags = fmt.get("alignment")
    if isinstance(flags, int):
        align["horizontal"] = ("center" if flags & 0x04 else "right"
                               if flags & 0x02 else "justify"
                               if flags & 0x08 else "left")
        align["vertical"] = "center"
    if fmt.get("wrap_text"):
        align["wrap_text"] = True
    if align:
        cell.alignment = Alignment(**align)
    if fmt.get("number_format"):
        cell.number_format = _convert_number_format(fmt["number_format"])


def _typed_value(source: str):
    """A cell's value for Excel: numbers as numbers, TRUE/FALSE as
    booleans, the rest as text."""
    if source.upper() in ("TRUE", "FALSE"):
        return source.upper() == "TRUE"
    try:
        number = float(source.replace(",", "")) if source.strip() else None
    except ValueError:
        return source
    if number is None:
        return source
    return int(number) if number.is_integer() and "." not in source \
        and "e" not in source.lower() else number


def _xl_chart(spec: dict, sheets: dict, default_sheet: str):
    """A native Excel chart for a spec, or None for types Excel lacks."""
    from openpyxl.chart import (
        BarChart, DoughnutChart, LineChart, PieChart, Reference,
        ScatterChart, Series,
    )

    kind = spec.get("type") or "Line"
    if kind in ("Scatter", "Line+Symbol"):
        chart = ScatterChart()
        chart.style = 13
    elif kind in ("Bar", "Histogram"):
        chart = BarChart()
    elif kind in ("Pie", "3D Pie"):
        chart = PieChart()
    elif kind == "Doughnut":
        chart = DoughnutChart()
    elif kind in ("Line", "Step", "Stem"):
        chart = LineChart()
    else:
        return None

    def reference(ref):
        if not ref:
            return None
        name, _, cells = ref.rpartition("!")
        name = name.strip("'").replace("''", "'") or default_sheet
        ws = sheets.get(name.lower())
        m = re.fullmatch(r"\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})"
                         r"\$?(\d+))?", cells.strip())
        if ws is None or not m:
            return None
        from openpyxl.utils import column_index_from_string as idx
        c1, r1 = idx(m.group(1).upper()), int(m.group(2))
        c2 = idx((m.group(3) or m.group(1)).upper())
        r2 = int(m.group(4) or m.group(2))
        return Reference(ws, min_col=c1, min_row=r1, max_col=c2, max_row=r2)

    x = reference(spec.get("x"))
    for s in spec.get("series") or []:
        y = reference(s.get("ref"))
        if y is None:
            continue
        if isinstance(chart, ScatterChart):
            sr = Series(y, xvalues=x, title=s.get("name") or None)
            if kind == "Scatter":
                sr.marker.symbol = "circle"
                sr.graphicalProperties.line.noFill = True
            chart.series.append(sr)
        else:
            chart.add_data(y, titles_from_data=False)
            if s.get("name"):
                from openpyxl.chart.series import SeriesLabel
                chart.series[-1].tx = SeriesLabel(v=s["name"])
        color = (s.get("color") or "").lstrip("#")
        if len(color) == 6 and not isinstance(chart, (PieChart,
                                                     DoughnutChart)):
            props = chart.series[-1].graphicalProperties
            props.line.solidFill = color
            if isinstance(chart, BarChart):
                props.solidFill = color
    if not chart.series:
        return None
    if x is not None and not isinstance(chart, ScatterChart):
        chart.set_categories(x)
    chart.title = spec.get("title") or None
    if hasattr(chart, "x_axis") and not isinstance(chart, (PieChart,
                                                           DoughnutChart)):
        chart.x_axis.title = spec.get("xLabel") or None
        chart.y_axis.title = spec.get("yLabel") or None
        if spec.get("logX"):
            chart.x_axis.scaling.logBase = 10
        if spec.get("logY"):
            chart.y_axis.scaling.logBase = 10
        if not spec.get("grid"):
            chart.y_axis.majorGridlines = None
    if spec.get("legend") is False:
        chart.legend = None
    chart.width = (spec.get("width") or 480) / 96 * 2.54
    chart.height = (spec.get("height") or 300) / 96 * 2.54
    return chart


def write_xlsx(workbook, layout: dict) -> bytes:
    """The engine's *workbook* as .xlsx bytes.

    *layout* holds what the engine does not: {"sheets": {name: {"formats":
    [[r, c, fmt]…], "widths": [[c, px]…], "freezeRows", "freezeCols"}},
    "charts": [chart spec with "sheet": name…]}.

    Formulas Excel understands are written as formulas; the others (=PY
    cells, KherveSheet-only functions) as the value they show."""
    import io

    import openpyxl
    from openpyxl.utils import get_column_letter

    from .python import is_python_source

    book = openpyxl.Workbook()
    book.remove(book.active)
    by_name = {}
    extras = layout.get("sheets") or {}
    for i, sheet in enumerate(workbook.sheets):
        safe = re.sub(r"[\\/?*\[\]:]", "-", sheet.name)[:31] or f"Sheet{i + 1}"
        ws = book.create_sheet(title=safe)
        by_name[sheet.name.lower()] = ws
        extra = extras.get(sheet.name) or {}
        cells = set(sheet.sources) | set(sheet.texts)
        for (r, c) in sorted(cells):
            source = sheet.sources.get((r, c), "")
            if source.startswith("=") and _is_excel_compatible(source) \
                    and not is_python_source(source):
                value = _formula_for_excel(source)
            else:
                text = sheet.texts.get((r, c), "")
                if not source.startswith("="):
                    text = source or text
                value = sheet._value(r, c)
                if not isinstance(value, float) or isinstance(value, bool) \
                        or value is BLANK:
                    value = _typed_value(text) if text else None
                elif value.is_integer() and abs(value) < 1e15:
                    value = int(value)
            if value is not None and value != "":
                ws.cell(row=r + 1, column=c + 1, value=value)
        for r, c, fmt in extra.get("formats") or []:
            if fmt:
                apply_format(ws.cell(row=r + 1, column=c + 1), fmt)
        for c, px in extra.get("widths") or []:
            ws.column_dimensions[get_column_letter(c + 1)].width = max(
                0.0, (px - _COL_PADDING) / _PX_PER_CHAR)
        fr, fc = extra.get("freezeRows") or 0, extra.get("freezeCols") or 0
        if fr or fc:
            ws.freeze_panes = f"{get_column_letter(fc + 1)}{fr + 1}"
    for spec in layout.get("charts") or []:
        name = spec.get("sheet") or ""
        ws = by_name.get(name.lower())
        if ws is None:
            continue
        chart = _xl_chart(spec, by_name, name)
        if chart is not None:
            anchor = f"{get_column_letter(int(spec.get('col') or 0) + 1)}" \
                     f"{int(spec.get('row') or 0) + 1}"
            ws.add_chart(chart, anchor)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
