// KherveBook's side of the KherveOS Python worker.
//
// The module below is written to /kherveos/khervebook_rt.py when Python
// starts (outside the home folder, so it never shows up on the drive). It
// gives code cells what the desktop kernel (kernel.py) gives them: math, np,
// plt and pd preloaded, ks()/ks_set() for sheet cells, NumPy 2 compatibility
// names; it computes sheet cells' =formulas like sheetcell.py; and it
// teaches the shared runtime the desktop's echo rules (a trailing Figure,
// PIL image or RGB array shows as a picture, not as its repr).
//
// Everything the notebook sends to Python is built here, so notebook.ts
// never has to write Python inline.

const PY_HELPER = String.raw`"""kBook helpers for the KherveOS Python worker (see pyhelper.ts)."""

import base64
import io
import json
import math
import re
import statistics
import sys

# Formula refs, as in the desktop's sheetcell.py (rows up to 999).
_REF = re.compile(r"\b([A-Z]{1,2})(\d{1,3})\b")
_RANGE = re.compile(r"\b([A-Z]{1,2})(\d{1,3})\s*:\s*([A-Z]{1,2})(\d{1,3})\b")
# Stored grid keys may go further down.
_KEY = re.compile(r"^([A-Z]{1,2})(\d{1,6})$")
# Spreadsheet ^ (outside quoted strings) is Python's **.
_CARET = re.compile(r"\^(?=(?:[^'\"]*(['\"])[^'\"]*\1)*[^'\"]*$)")
_KS_REF = re.compile(r"^([A-Za-z]{1,2})(\d{1,4})$")
_KS_RANGE = re.compile(r"^([A-Za-z]{1,2})(\d{1,4}):([A-Za-z]{1,2})(\d{1,4})$")
MAX_PASSES = 8

_writes = []        # ks("A1", v) writes waiting for the notebook: [sheet, ref, raw]


def _flat(args):
    out = []
    for a in args:
        if isinstance(a, (list, tuple)):
            out.extend(_flat(a))
        else:
            out.append(a)
    return out


def _nums(args):
    return [x for x in _flat(args)
            if isinstance(x, (int, float)) and not isinstance(x, bool)]


SHEET_FUNCS = {
    "SUM": lambda *a: sum(_nums(a)),
    "AVERAGE": lambda *a: (sum(_nums(a)) / len(_nums(a)) if _nums(a) else 0),
    "AVG": lambda *a: (sum(_nums(a)) / len(_nums(a)) if _nums(a) else 0),
    "MIN": lambda *a: (min(_nums(a)) if _nums(a) else 0),
    "MAX": lambda *a: (max(_nums(a)) if _nums(a) else 0),
    "COUNT": lambda *a: len(_nums(a)),
    "COUNTA": lambda *a: len([x for x in _flat(a) if x not in (None, "")]),
    "PRODUCT": lambda *a: (math.prod(_nums(a)) if _nums(a) else 0),
    "MEDIAN": lambda *a: (statistics.median(_nums(a)) if _nums(a) else 0),
    "STDEV": lambda *a: (statistics.stdev(_nums(a)) if len(_nums(a)) > 1 else 0),
    "VAR": lambda *a: (statistics.variance(_nums(a)) if len(_nums(a)) > 1 else 0),
    "ROUND": lambda x, n=0: round(float(x), int(n)),
    "ABS": abs, "SQRT": lambda x: math.sqrt(x),
    "POWER": lambda x, y: x ** y, "MOD": lambda x, y: x % y,
    "INT": lambda x: int(x), "EXP": lambda x: math.exp(x),
    "LN": lambda x: math.log(x), "LOG": lambda x, b=10: math.log(x, b),
    "LOG10": lambda x: math.log10(x), "SIGN": lambda x: (x > 0) - (x < 0),
    "PI": lambda: math.pi, "SIN": lambda x: math.sin(x),
    "COS": lambda x: math.cos(x), "TAN": lambda x: math.tan(x),
    "DEGREES": lambda x: math.degrees(x), "RADIANS": lambda x: math.radians(x),
    "IF": lambda c, a, b=False: a if c else b,
    "AND": lambda *a: all(_flat(a)), "OR": lambda *a: any(_flat(a)),
    "NOT": lambda x: not x, "TRUE": True, "FALSE": False,
    "CONCAT": lambda *a: "".join(str(x) for x in _flat(a)),
    "CONCATENATE": lambda *a: "".join(str(x) for x in _flat(a)),
    "LEN": lambda x: len(str(x)), "UPPER": lambda x: str(x).upper(),
    "LOWER": lambda x: str(x).lower(), "TRIM": lambda x: str(x).strip(),
}


def col_letter(c):
    out = ""
    c += 1
    while c:
        c, rem = divmod(c - 1, 26)
        out = chr(65 + rem) + out
    return out


def letter_col(s):
    c = 0
    for ch in s.upper():
        c = c * 26 + (ord(ch) - 64)
    return c - 1


def parse_value(text):
    try:
        f = float(text)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError, OverflowError):
        return text


def format_value(value):
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


# -- the kernel seed (desktop kernel.py) -------------------------------------

def _np_compat(np):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for new, old in (("trapezoid", "trapz"), ("isin", "in1d"),
                         ("vstack", "row_stack"), ("prod", "product"),
                         ("cumprod", "cumproduct"), ("all", "alltrue"),
                         ("any", "sometrue"), ("round", "round_")):
            try:
                if hasattr(np, new) and not hasattr(np, old):
                    setattr(np, old, getattr(np, new))
                elif hasattr(np, old) and not hasattr(np, new):
                    setattr(np, new, getattr(np, old))
            except Exception:
                pass
        for alias, target in (("NaN", "nan"), ("NAN", "nan"), ("Inf", "inf"),
                              ("Infinity", "inf"), ("PINF", "inf"),
                              ("float_", "float64"), ("complex_", "complex128"),
                              ("unicode_", "str_"), ("bool8", "bool_"),
                              ("object0", "object_")):
            try:
                if not hasattr(np, alias) and hasattr(np, target):
                    setattr(np, alias, getattr(np, target))
            except Exception:
                pass
        try:
            if not hasattr(np, "NINF"):
                np.NINF = -np.inf
        except Exception:
            pass


def seed(g):
    """Fill a fresh namespace like the desktop kernel (after the imports ran)."""
    g["math"] = math
    np = sys.modules.get("numpy")
    if np is not None:
        _np_compat(np)
        g["np"] = np
        g["numpy"] = np
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        g["plt"] = plt
    pd = sys.modules.get("pandas")
    if pd is not None:
        g["pd"] = pd
        g["pandas"] = pd
    ks, ks_set = make_ks(g)
    g["ks"] = ks
    g["xl"] = ks
    g["cell"] = ks
    g["ks_set"] = ks_set


_UNSET = object()


def _writer(g, name):
    grid = g.get(name)
    if not isinstance(grid, list):
        return None

    def write(ref, value):
        m = _KS_REF.fullmatch(str(ref).strip().upper())
        if not m:
            raise ValueError(f"bad cell reference: {ref!r}")
        r, c = int(m.group(2)) - 1, letter_col(m.group(1))
        if not (0 <= r < len(grid) and 0 <= c < len(grid[r])):
            raise IndexError(f"cell {ref} is outside the sheet")
        raw = value if isinstance(value, str) else format_value(value)
        grid[r][c] = value if isinstance(value, str) else parse_value(raw)
        _writes.append([name, col_letter(c) + str(r + 1), raw])
        return value

    return write


def make_ks(g):
    """ks(ref[, value]): read a sheet grid (sheet1 by default, or "Sheet2!A1");
    with a value, write one cell back into the live sheet."""

    def _target(ref):
        ref = str(ref).strip()
        name = "sheet1"
        if "!" in ref:
            sheet, _, ref = ref.partition("!")
            sheet = sheet.strip().strip("'\"").lower().replace(" ", "")
            name = sheet if sheet.startswith("sheet") else "sheet1"
        return name, ref

    def _at(grid, r, c):
        if 0 <= r < len(grid) and 0 <= c < len(grid[r]):
            v = grid[r][c]
            return 0 if v is None else v
        return 0

    def ks(ref, value=_UNSET):
        name, ref = _target(ref)
        if value is not _UNSET:
            w = _writer(g, name)
            if w is None:
                raise NameError(f"{name} cannot be written yet — run the sheet cell first")
            return w(ref, value)
        grid = g.get(name)
        if grid is None:
            raise NameError(f"{name} is not available yet — run the sheet cell first")
        m = _KS_RANGE.match(ref)
        if m:
            r1, c1 = int(m.group(2)) - 1, letter_col(m.group(1))
            r2, c2 = int(m.group(4)) - 1, letter_col(m.group(3))
            r1, r2 = sorted((r1, r2))
            c1, c2 = sorted((c1, c2))
            rows = [[_at(grid, r, c) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)]
            flat = None
            if len(rows) == 1:
                flat = rows[0]
            elif all(len(x) == 1 for x in rows):
                flat = [x[0] for x in rows]
            np = sys.modules.get("numpy")
            if np is None:
                return flat if flat is not None else rows
            try:
                return np.array(flat if flat is not None else rows, dtype=float)
            except (TypeError, ValueError):
                return flat if flat is not None else rows
        m = _KS_REF.match(ref)
        if m:
            return _at(grid, int(m.group(2)) - 1, letter_col(m.group(1)))
        raise ValueError(f"bad cell reference: {ref!r}")

    def ks_set(ref, value):
        name, ref = _target(ref)
        w = _writer(g, name)
        if w is None:
            raise NameError(f"{name} cannot be written yet — run the sheet cell first")
        rng = _KS_RANGE.match(ref)
        if not rng:
            return w(ref, value)
        r1, c1 = int(rng.group(2)) - 1, letter_col(rng.group(1))
        r2, c2 = int(rng.group(4)) - 1, letter_col(rng.group(3))
        r1, r2 = sorted((r1, r2))
        c1, c2 = sorted((c1, c2))
        seq = None
        if hasattr(value, "__iter__") and not isinstance(value, (str, bytes)):
            seq = list(value)
        targets = [(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)]
        for i, (r, c) in enumerate(targets):
            v = seq[i] if seq is not None and i < len(seq) else (value if seq is None else 0)
            w(f"{col_letter(c)}{r + 1}", v)
        return value

    return ks, ks_set


def drain():
    """The ks() writes since the last call, as JSON (or "" when none)."""
    if not _writes:
        return ""
    out = json.dumps(_writes, default=str)
    _writes.clear()
    return out


def forget(g, names):
    """A per-cell restart: drop the globals a cell created."""
    for name in json.loads(names):
        g.pop(name, None)


# -- sheet formulas (desktop sheetcell.py) ----------------------------------

def _is_figure(value):
    mod = sys.modules.get("matplotlib.figure")
    return mod is not None and isinstance(value, mod.Figure)


def _figure_png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    return buf.getvalue()


def _eval(expr, values, blocked, g):
    expr = _CARET.sub("**", str(expr))

    def lookup(r, c):
        if (r, c) in blocked:
            raise KeyError((r, c))
        return values.get((r, c), 0)

    def sub_range(m):
        r1, r2 = sorted((int(m.group(2)), int(m.group(4))))
        c1, c2 = sorted((letter_col(m.group(1)), letter_col(m.group(3))))
        rows = [[lookup(r, c) for c in range(c1, c2 + 1)] for r in range(r1 - 1, r2)]
        if len(rows) == 1:
            return repr(rows[0])
        if all(len(row) == 1 for row in rows):
            return repr([row[0] for row in rows])
        return repr(rows)

    def sub_ref(m):
        return repr(lookup(int(m.group(2)) - 1, letter_col(m.group(1))))

    py = _REF.sub(sub_ref, _RANGE.sub(sub_range, expr))
    return eval(py, {**g, **SHEET_FUNCS})


def _compute_sheet(sheet, g):
    rows = int(sheet.get("rows") or 6)
    cols = int(sheet.get("cols") or 4)
    values, formulas = {}, {}
    for key, raw in (sheet.get("data") or {}).items():
        m = _KEY.match(str(key))
        if not m or not raw:
            continue
        rc = (int(m.group(2)) - 1, letter_col(m.group(1)))
        if rc[0] >= rows or rc[1] >= cols:
            continue
        raw = str(raw)
        if raw.lstrip().startswith("="):
            formulas[rc] = raw.lstrip()[1:]
        else:
            values[rc] = parse_value(raw)
    plt = sys.modules.get("matplotlib.pyplot")
    before = set(plt.get_fignums()) if plt else set()
    pending = dict(formulas)
    for _ in range(MAX_PASSES):
        if not pending:
            break
        progressed = False
        for rc, expr in list(pending.items()):
            blocked = set(pending) - {rc}
            try:
                values[rc] = _eval(expr, values, blocked, g)
            except KeyError:
                continue
            except Exception as exc:
                values[rc] = f"#ERR {exc.__class__.__name__}"
            del pending[rc]
            progressed = True
        if not progressed:
            break
    for rc in pending:
        values[rc] = "#ERR circular"
    display, pngs, captured = {}, [], set()
    for rc in formulas:
        value = values[rc]
        key = col_letter(rc[1]) + str(rc[0] + 1)
        if _is_figure(value):
            pngs.append(_figure_png(value))
            captured.add(getattr(value, "number", None))
            values[rc] = "[plot]"
            display[key] = "[plot]"
        else:
            try:
                display[key] = format_value(value)
            except Exception:
                display[key] = "#ERR repr"
    if plt:
        for num in plt.get_fignums():
            if num in before:
                continue
            if num not in captured:
                pngs.append(_figure_png(plt.figure(num)))
            plt.close(num)
    grid = [[values.get((r, c)) for c in range(cols)] for r in range(rows)]
    return grid, display, pngs


def compute(g, payload):
    """Compute every sheet cell (document order) and publish sheet1, sheet2…"""
    req = json.loads(payload)
    out = []
    n = 0
    for cell in req.get("cells", []):
        res = {"id": cell.get("id"), "display": [], "plots": []}
        for sheet in cell.get("sheets", []):
            n += 1
            try:
                grid, display, pngs = _compute_sheet(sheet, g)
            except Exception as exc:
                grid, display, pngs = [], {"A1": f"#ERR {exc.__class__.__name__}"}, []
            g[f"sheet{n}"] = grid
            res["display"].append(display)
            res["plots"].extend(base64.b64encode(p).decode("ascii") for p in pngs)
        out.append(res)
    return json.dumps(out, default=str)


def plot_range(g, payload):
    """Chart a block of a computed sheet (Create Plot): a base64 PNG, or ""."""
    req = json.loads(payload)
    plt = sys.modules.get("matplotlib.pyplot")
    grid = g.get(req.get("var") or "")
    if plt is None or not isinstance(grid, list):
        return ""
    r1, r2, c1, c2 = req["r1"], req["r2"], req["c1"], req["c2"]
    kind = req.get("kind", "line")

    def val(r, c):
        return grid[r][c] if 0 <= r < len(grid) and 0 <= c < len(grid[r]) else None

    def num(r, c):
        v = val(r, c)
        if isinstance(v, bool):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    rows = list(range(r1, r2 + 1))
    cols = list(range(c1, c2 + 1))
    top = rows[0]
    has_header = len(rows) > 1 and any(num(top, c) is None and val(top, c) not in (None, "") for c in cols)
    data_rows = rows[1:] if has_header else rows

    def label(c):
        if has_header and val(top, c) not in (None, ""):
            return str(val(top, c))
        return col_letter(c)

    first = cols[0]
    use_x = len(cols) > 1 and all(num(r, first) is not None for r in data_rows)
    if use_x:
        xs_all = [num(r, first) for r in data_rows]
        ycols, xlabel = cols[1:], label(first)
    else:
        xs_all = [r + 1 for r in data_rows]
        ycols, xlabel = cols, "row"
    fig = plt.figure(figsize=(5, 3.2))
    ax = fig.add_subplot(111)
    plotted = 0
    for c in ycols:
        pairs = [(x, num(r, c)) for x, r in zip(xs_all, data_rows) if num(r, c) is not None]
        if not pairs:
            continue
        xs, ys = zip(*pairs)
        if kind == "bar":
            ax.bar([str(x) for x in xs], ys, label=label(c))
        elif kind == "scatter":
            ax.scatter(xs, ys, label=label(c))
        else:
            ax.plot(xs, ys, marker="o", label=label(c))
        plotted += 1
    if not plotted:
        plt.close(fig)
        return ""
    ax.set_xlabel(xlabel)
    if plotted > 1:
        ax.legend()
    ax.set_title(req.get("title") or "Chart")
    fig.tight_layout()
    png = _figure_png(fig)
    plt.close(fig)
    return base64.b64encode(png).decode("ascii")


# -- the desktop's echo rules, taught to the shared runtime ------------------

_MANAGED = object()


def _image_png(value):
    try:
        if _is_figure(value):
            plt = sys.modules.get("matplotlib.pyplot")
            if plt is not None and getattr(value, "number", None) in plt.get_fignums():
                return _MANAGED            # captured with the other open figures
            return _figure_png(value)
        if isinstance(value, (bytes, bytearray)):
            head = bytes(value[:4])
            if head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8"):
                return bytes(value)
            return None
        pil = sys.modules.get("PIL.Image")
        if pil is not None and isinstance(value, pil.Image):
            buf = io.BytesIO()
            value.convert("RGBA").save(buf, format="PNG")
            return buf.getvalue()
        np = sys.modules.get("numpy")
        plt = sys.modules.get("matplotlib.pyplot")
        if (np is not None and plt is not None and isinstance(value, np.ndarray)
                and value.ndim == 3 and value.shape[2] in (3, 4)):
            buf = io.BytesIO()
            plt.imsave(buf, value.astype(np.uint8), format="png")
            return buf.getvalue()
    except Exception:
        return None
    return None


def _patch_urllib():
    """urllib.request.urlopen for plain GETs through the browser (a synchronous
    request from the worker), so notebooks that fetch live data work when the
    site allows it (CORS). Anything else goes to the original urlopen."""
    try:
        import pyodide.http as ph
        import urllib.error as ue
        import urllib.request as ur
    except Exception:
        return
    if getattr(ur, "_kbook_patched", False):
        return
    ur._kbook_patched = True
    orig = ur.urlopen

    class _Response(io.BytesIO):
        def __init__(self, data, url):
            super().__init__(data)
            self.url = url
            self.status = self.code = 200
            self.headers = {}

        def getcode(self):
            return self.status

        def geturl(self):
            return self.url

        def info(self):
            return self.headers

    def urlopen(url, data=None, timeout=None, *args, **kwargs):
        target = getattr(url, "full_url", url)
        method = url.get_method() if hasattr(url, "get_method") else ("POST" if data is not None else "GET")
        if isinstance(target, str) and target.startswith(("http://", "https://")) and method == "GET" and data is None:
            try:
                text = ph.open_url(target).getvalue()
            except Exception as exc:
                raise ue.URLError(f"{exc} (the browser may not be allowed to read this site: CORS)") from None
            return _Response(text.encode("utf-8"), target)
        if timeout is not None:
            kwargs["timeout"] = timeout
        return orig(url, data, *args, **kwargs)

    ur.urlopen = urlopen


def install():
    """Once per Python process: patch kherveos_runtime (this window's worker only)."""
    _patch_urllib()
    try:
        import kherveos_runtime as rt
    except Exception:
        return
    if getattr(rt, "_kbook_patched", False):
        return
    rt._kbook_patched = True
    pending = []
    orig_repr = getattr(rt, "_repr", None)
    orig_capture = getattr(rt, "capture_figures", None)
    orig_run = getattr(rt, "run_cell", None)

    if orig_repr is not None and orig_capture is not None:
        def _repr(value):
            png = _image_png(value)
            if png is _MANAGED:
                return None
            if png is not None:
                pending.append(base64.b64encode(png).decode("ascii"))
                return None
            return orig_repr(value)

        def capture_figures():
            figs = list(pending)
            pending.clear()
            return figs + orig_capture()

        rt._repr = _repr
        rt.capture_figures = capture_figures

    if orig_run is not None and hasattr(rt, "namespace"):
        async def run_cell(source, ns_name, filename="<cell>"):
            ns = rt.namespace(ns_name)
            before = set(ns)
            out = await orig_run(source, ns_name, filename)
            try:
                out["new_names"] = sorted(k for k in ns if k not in before)
            except Exception:
                pass
            return out

        rt.run_cell = run_cell
`

/** A Python string literal (JSON's escapes are all valid Python). */
export const pyStr = (s: string) => JSON.stringify(s)

const RT = "__import__('khervebook_rt')"

/**
 * Once per Python process: work in the notebook's folder, report the Python
 * version, print line by line (so output streams while a cell runs), give
 * Jupyter notebooks a plain display(), and install the helper module. Only
 * __import__ is used, so the user's variables are never touched.
 */
export function setupCode(dir: string): string {
  const d = pyStr(dir)
  return [
    `__import__('os').chdir(${d}) if __import__('os').path.isdir(${d}) else None`,
    `print(__import__('sys').version.split()[0], end='')`,
    `hasattr(__import__('builtins'), 'display') or setattr(__import__('builtins'), 'display', lambda *objs, **kw: None if [print(repr(o)) for o in objs] else None)`,
    `[getattr(f, 'reconfigure', lambda **kw: None)(line_buffering=True) for f in (__import__('sys').stdout, __import__('sys').stderr)] and None`,
    `__import__('os').makedirs('/kherveos', exist_ok=True)`,
    `open('/kherveos/khervebook_rt.py', 'w', encoding='utf-8').write(${pyStr(PY_HELPER)}) and None`,
    `__import__('importlib').invalidate_caches()`,
    `${RT}.install()`,
  ].join('\n')
}

/** Once per namespace: the desktop kernel's preloaded names (np, plt, pd, math, ks…). */
export const PRELOAD_CODE = [
  'try:',
  '    import numpy as np',
  'except Exception:',
  '    pass',
  'try:',
  '    import matplotlib.pyplot as plt',
  'except Exception:',
  '    pass',
  'try:',
  '    import pandas as pd',
  'except Exception:',
  '    pass',
  `${RT}.seed(globals())`,
].join('\n')

/**
 * Modules the desktop kernel also preloads. Loading them up front would cost
 * many megabytes, so they are imported the first time a cell uses the name.
 */
export const LAZY_MODULES = ['scipy', 'sympy', 'lmfit']

export function lazyImportCode(names: string[]): string {
  return names.map((n) => `try:\n    import ${n}\nexcept Exception:\n    pass`).join('\n')
}

/** Names a cell uses without importing them itself. */
export function lazyNeeds(source: string): string[] {
  return LAZY_MODULES.filter((n) => {
    if (!new RegExp(`(?<![\\w.])${n}\\.`).test(source)) return false
    return !new RegExp(`^\\s*(?:import\\s+${n}\\b|from\\s+${n}\\b)`, 'm').test(source)
  })
}

export interface SheetPayloadCell {
  id: string
  sheets: { name: string; rows: number; cols: number; data: Record<string, string> }[]
}

export const computeCode = (cells: SheetPayloadCell[]) =>
  `print(${RT}.compute(globals(), ${pyStr(JSON.stringify({ cells }))}), end='')`

export const drainCode = () => `print(${RT}.drain(), end='')`

export const forgetCode = (names: string[]) => `${RT}.forget(globals(), ${pyStr(JSON.stringify(names))})`

export const plotRangeCode = (req: { var: string; r1: number; r2: number; c1: number; c2: number; kind: string; title: string }) =>
  `print(${RT}.plot_range(globals(), ${pyStr(JSON.stringify(req))}), end='')`
