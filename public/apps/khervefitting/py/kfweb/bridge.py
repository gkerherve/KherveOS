"""The requests the KherveFitting web page sends to Python, and their answers.

The page runs ``await kfweb.bridge.run(<json>)`` in the window's Pyodide
worker with a batch of requests ``[{"op": …, "args": {…}}…]``; the answers
(one per request, in order) are printed on stdout between START and END.
Each answer is ``{"ok": true, …}`` or ``{"ok": false, "error": …}``.

Ops that change what is shown answer with ``view``: the current core level's
arrays, peak table, background settings and results table.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0 (KherveFitting code: GPL-3.0-only).
"""

from __future__ import annotations

import base64
import importlib
import importlib.util
import json
import math
import os
import sys
import traceback

START = "\x02KF-JSON\x03"
END = "\x02/KF-JSON\x03"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _State:
    session = None
    undo: list = []
    redo: list = []
    sheets: list = []
    original: bytes | None = None
    file_name = ""
    instruments: list = []


S = _State()


# ── Packages (Pyodide loads them on demand) ──────────────────────────
def _importable(name):
    if name in sys.modules:
        return True
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


# Pure-Python packages shipped with the app (py/wheels/, unpacked into
# <root>/site by the page): no PyPI round trip, which could stall for minutes.
PIP = {"lmfit", "openpyxl", "vamas", "asteval", "dill", "et_xmlfile"}


async def ensure(names):
    """Load numpy/scipy/uncertainties from Pyodide; lmfit/openpyxl/vamas come with the app (PyPI only as a fallback)."""
    missing = sorted(n for n in set(names) if n and not _importable(n))
    if not missing:
        return
    try:
        import pyodide_js
        from pyodide.ffi import to_js
    except ImportError:
        return
    dist = [n for n in missing if n not in PIP]
    pip = [n for n in missing if n in PIP]
    if dist:
        await pyodide_js.loadPackage(to_js(dist))
    if pip:
        await pyodide_js.loadPackage("micropip")
        import micropip
        await micropip.install(pip)
    importlib.invalidate_caches()


CORE = ["numpy", "scipy", "uncertainties", "lmfit"]
NEEDS = {
    "open": CORE + ["openpyxl"], "save": CORE + ["openpyxl"], "import": CORE + ["vamas"],
}


# ── Helpers ──────────────────────────────────────────────────────────
def _session():
    if S.session is None:
        from kfcore.session import Session
        S.session = Session()
        _load_library(S.session)
    return S.session


def _load_library(session):
    path = os.path.join(ROOT, 'data', 'library.json')
    try:
        from kfcore.results import load_library
        with open(path, encoding='utf-8') as f:
            session.library_data, S.instruments = load_library(f.read())
    except OSError:
        session.library_data, S.instruments = {}, []


def _clean(values):
    """Floats for JSON (NaN/inf become null)."""
    out = []
    for v in values:
        f = float(v)
        out.append(round(f, 6) if math.isfinite(f) else None)
    return out


def _bg_info(w, name):
    cl = w.Data['Core levels'].get(name, {})
    bg = cl.get('Background', {}) or {}
    ranges = [list(r[:4]) for r in (bg.get('Recorded_Ranges') or []) if len(r) >= 4]
    return {
        'type': bg.get('Bkg Type', '') or '',
        'low': bg.get('Bkg Low', ''), 'high': bg.get('Bkg High', ''),
        'offsetLow': bg.get('Bkg Offset Low', ''), 'offsetHigh': bg.get('Bkg Offset High', ''),
        'ranges': ranges,
        'tougaard': [bg.get('Tougaard_B', 2866.0), bg.get('Tougaard_C', 1643.0),
                     bg.get('Tougaard_D', 1.0), bg.get('Tougaard_T0', 0.0)],
    }


def view(include_arrays=True):
    """Everything the page shows for the current core level."""
    import numpy as np
    from kfcore.curves import overall_fit, peak_curve, region_mask
    from kfcore.results import results_rows

    w = _session()
    name = w.sheet_combobox.GetValue()
    out = {
        'file': S.file_name, 'sheets': S.sheets, 'sheet': name,
        'grid': w.peak_params_grid.snapshot(),
        'background': _bg_info(w, name) if name else None,
        'settings': settings_of(w),
        'fit': None,
    }
    if w.fit_results:
        fr = w.fit_results
        out['fit'] = {
            'r2': fr.get('r_squared'), 'chi2': float(fr.get('chi_square', 0) or 0),
            'redChi2': float(fr.get('red_chi_square', 0) or 0), 'nfev': int(fr.get('nfev', 0) or 0),
            'rsd': fr.get('rsd'), 'text': fr.get('text', ''),
        }
    key, rows = results_rows(w)
    out['resultsKey'] = key
    out['results'] = rows
    from kfweb.gridstyle import grid_colours
    from kfweb.tables import fit_stats, results_grid
    out['gridColours'] = grid_colours(w.peak_params_grid)
    out['resultsGrid'] = results_grid(w)[1]
    out['stats'] = fit_stats(w) if name else {}
    out['peakErrors'] = _peak_errors(w, name)
    out['extra'] = {}
    if name and _features() is not None and hasattr(_features(), 'view_extra'):
        try:
            out['extra'] = _features().view_extra(w, name) or {}
        except Exception as e:  # an extra must never break the view
            out['extra'] = {'error': f"{type(e).__name__}: {e}"}
    if include_arrays and name and len(w.x_values):
        x = w.x_values
        out['x'] = _clean(x)
        out['y'] = _clean(w.y_values)
        out['bkg'] = _clean(w.background)
        mask = region_mask(w, x)
        curves = []
        grid = w.peak_params_grid
        for i in range(grid.GetNumberRows() // 2):
            try:
                c = peak_curve(w, i * 2, x)
            except Exception:
                c = None
            if c is None:
                curves.append(None)
            else:
                curves.append(_clean(np.where(mask, c + w.background, np.nan)))
        out['peaks'] = curves
        fit, residuals = overall_fit(w)
        if fit is not None:
            out['envelope'] = _clean(np.where(mask[:len(fit)], fit, np.nan))
            out['residuals'] = _clean(np.where(mask[:len(residuals)], residuals, np.nan))
        else:
            out['envelope'] = None
            out['residuals'] = None
    return out


def _peak_errors(w, name):
    """Per peak, its 1σ uncertainties after a fit (Fit_Uncertainty: 'Errors_MC' or 'Errors')."""
    out = []
    try:
        peaks = ((w.Data['Core levels'].get(name) or {}).get('Fitting') or {}).get('Peaks') or {}
        for p in peaks.values():
            e = (p or {}).get('Errors_MC') or (p or {}).get('Errors') or {}
            row = {}
            for q in ('Position', 'Height', 'FWHM', 'L/G', 'Area'):
                v = e.get(q)
                if isinstance(v, (int, float)) and math.isfinite(v):
                    row[q] = float(v)
            st = e.get('status') or {}
            row.update({f"{q}Status": str(v) for q, v in st.items() if isinstance(v, str)})
            if e.get('method'):
                row['method'] = str(e.get('method'))
            out.append(row)
    except Exception:
        return []
    return out


_FEATURES = []


def _features():
    """kfweb.features (the dev-AI tools: peak library, ID, D-parameter...), if present."""
    if not _FEATURES:
        try:
            from kfweb import features
            _FEATURES.append(features)
        except Exception:
            _FEATURES.append(None)
    return _FEATURES[0]


def settings_of(w):
    return {
        'model': w.selected_fitting_method, 'method': w.background_method or 'Smart',
        'maxIterations': w.max_iterations, 'optimization': w.fitting_window.optimization_method,
        'weights': w.fitting_window.weights_method, 'photons': w.photons, 'instrument': w.current_instrument,
        'libraryType': w.library_type, 'averagingPoints': w.averaging_points, 'workfunction': w.workfunction,
        'instruments': S.instruments,
    }


def _set_file(data, sheets, name, original=None):
    from kfcore.sheets import select_sheet
    from kfcore.session import Session
    w = Session()
    w.library_data = _session().library_data
    for k in ('photons', 'current_instrument', 'library_type', 'max_iterations', 'averaging_points',
              'workfunction', 'selected_fitting_method'):
        setattr(w, k, getattr(_session(), k))
    w.fitting_window.optimization_method = _session().fitting_window.optimization_method
    w.fitting_window.weights_method = _session().fitting_window.weights_method
    w.Data = data
    S.session = w
    S.undo, S.redo = [], []
    S.sheets = sheets
    S.original = original
    S.file_name = name
    if sheets:
        select_sheet(w, sheets[0])
        w.background_method = w.background_method or 'Smart'


# ── Operations ───────────────────────────────────────────────────────
def op_open(a):
    from kfcore.workbook import open_workbook
    raw = base64.b64decode(a['xlsx'])
    data, sheets, dismissed = open_workbook(raw, a.get('json') or None, a.get('name', ''))
    if not sheets:
        lines = '\n'.join(f"  - {n} : {r}" for n, r in dismissed)
        raise ValueError("Cannot open this file - no usable sheets were found.\n\n" + lines)
    _set_file(data, sheets, a.get('name', ''), raw)
    return {'view': view(), 'dismissed': dismissed}


def op_import(a):
    from kfcore.importers import import_file
    data, sheets = import_file(a['name'], base64.b64decode(a['bytes']), _session().workfunction)
    if not sheets:
        raise ValueError("No spectra were found in this file.")
    _set_file(data, sheets, a['name'], None)
    return {'view': view()}


def op_new(a):
    from kfcore.session import empty_data
    _set_file(empty_data(), [], '', None)
    return {'view': view()}


def op_view(a):
    return {'view': view()}


def op_select(a):
    from kfcore.sheets import select_sheet
    w = _session()
    select_sheet(w, a['sheet'])
    if not w.background_method:
        w.background_method = 'Smart'
    return {'view': view()}


def op_settings(a):
    w = _session()
    m = {'model': 'selected_fitting_method', 'maxIterations': 'max_iterations', 'photons': 'photons',
         'instrument': 'current_instrument', 'libraryType': 'library_type',
         'averagingPoints': 'averaging_points', 'workfunction': 'workfunction', 'method': 'background_method'}
    for k, attr in m.items():
        if k in a:
            v = a[k]
            if attr in ('max_iterations', 'averaging_points'):
                v = int(v)
            elif attr in ('photons', 'workfunction'):
                v = float(v)
            setattr(w, attr, v)
    if 'optimization' in a:
        w.fitting_window.optimization_method = a['optimization']
    if 'weights' in a:
        w.fitting_window.weights_method = a['weights']
    if 'tougaard' in a:
        name = w.sheet_combobox.GetValue()
        bg = w.Data['Core levels'][name].setdefault('Background', {})
        b, c, d, t0 = (float(v) for v in a['tougaard'])
        bg.update({'Tougaard_B': b, 'Tougaard_C': c, 'Tougaard_D': d, 'Tougaard_T0': t0})
    if any(k in a for k in ('instrument', 'libraryType', 'photons')):
        from kfcore.results import update_atomic_percentages
        w.update_ratios()
        update_atomic_percentages(w)
    return {'view': view(include_arrays=False)}


def op_background(a):
    from kfcore.background import apply_background
    w = _session()
    apply_background(w, a.get('method') or 'Smart', float(a['low']), float(a['high']),
                     float(a.get('offsetHigh', 0) or 0), float(a.get('offsetLow', 0) or 0),
                     record=a.get('record', 'replace'))
    return {'view': view()}


def op_clear_background(a):
    from kfcore.background import clear_background, clear_background_only
    w = _session()
    (clear_background_only if a.get('only') else clear_background)(w)
    return {'view': view()}


def op_add_peak(a):
    from kfcore.curves import residual_for_new_peak
    from kfcore.sheets import add_peak
    w = _session()
    if a.get('model'):
        w.selected_fitting_method = a['model']
    w.load_view()
    x, y = a.get('x'), a.get('y')
    if x is not None and y is not None:
        import numpy as np
        # A click on the plot: the height is measured from the background.
        bkg = w.background[int(np.argmin(np.abs(w.x_values - float(x))))]
        index = add_peak(w, float(x), max(float(y) - float(bkg), 0.0))
    else:
        index = add_peak(w, residual=residual_for_new_peak(w))
    w.load_view()
    return {'view': view(), 'index': index}


def op_remove_peak(a):
    from kfcore.sheets import delete_peak, remove_last_peak
    w = _session()
    if a.get('index') is None:
        remove_last_peak(w)
    else:
        delete_peak(w, int(a['index']))
    return {'view': view()}


def op_set_cell(a):
    from kfcore.sheets import set_cell
    w = _session()
    set_cell(w, int(a['row']), int(a['col']), str(a['text']))
    w.load_view()
    return {'view': view()}


def op_drag_peak(a):
    from kfcore.sheets import drag_peak
    w = _session()
    drag_peak(w, int(a['index']), float(a['x']), float(a['y']))
    return {'view': view()}


def op_fit(a):
    """Fit One Time (mode 'once') or Fit Until Stable (mode 'stable', the
    Fitting tab's adaptive loop, 'stable' passes, at most 'maxPasses')."""
    from kfcore import background as BG, fitting as F
    w = _session()
    until = getattr(F, 'fit_until_stable', None) or getattr(BG, 'fit_until_stable', None)
    once = getattr(F, 'fit_once', None) or getattr(BG, 'fit_once', None)
    mode = a.get('mode') or 'once'
    log = []
    if mode == 'stable' and until is not None:
        passes = until(w, int(a.get('stable', 6) or 6), int(a.get('maxPasses', 40) or 40)) or []
        for p in passes:
            log.append({'i': int(p.get('pass', len(log) + 1)), 'r2': float(p.get('r2') or 0),
                        'redChi2': float(p.get('redChi') or 0), 'chi': float(p.get('chi') or 0),
                        'nfev': int(p.get('nfev') or 0)})
    else:
        n = max(1, int(a.get('iterations', 1) or 1)) if mode != 'stable' else max(1, int(a.get('maxPasses', 6) or 6))
        for i in range(n):
            r = once(w) if once is not None else F.fit_peaks(w, w.peak_params_grid)
            if r:
                r2, rsd, red = r
                log.append({'i': i + 1, 'r2': float(r2), 'redChi2': float(red), 'chi': float(rsd),
                            'nfev': int((w.fit_results or {}).get('nfev', 0) or 0)})
    w.load_view()
    return {'view': view(), 'log': log}


def op_report(a):
    w = _session()
    if not w.fit_results or 'result' not in w.fit_results:
        return {'report': ''}
    result = w.fit_results['result']
    try:
        report = result.fit_report()
        report += "\n\nAdditional Information:"
        report += f"\nNumber of function evaluations: {result.nfev}"
        report += f"\nNumber of variables: {result.nvarys}"
        report += f"\nNumber of data points: {result.ndata}"
        report += f"\nDegrees of freedom: {result.nfree}"
        report += f"\nAborted: {result.aborted}"
        report += f"\nError flags: {result.errorbars}"
        report += f"\nCovariance matrix: \n{result.covar}"
    except Exception as e:
        report = f"No report: {e}"
    return {'report': report}


def op_export(a):
    from kfcore.results import export_results
    export_results(_session())
    return {'view': view(include_arrays=False)}


def op_results_set(a):
    from kfcore.results import set_result_field
    set_result_field(_session(), a['key'], a['field'], a['value'])
    return {'view': view(include_arrays=False)}


def op_results_delete(a):
    from kfcore.results import delete_results
    delete_results(_session(), a.get('keys'))
    return {'view': view(include_arrays=False)}


def op_save(a):
    from kfcore.workbook import save_workbook
    w = _session()
    original = S.original if a.get('keepOriginal', True) else None
    xlsx, js = save_workbook(w, S.sheets, original)
    S.original = xlsx
    if a.get('name'):
        S.file_name = a['name']
    return {'xlsx': base64.b64encode(xlsx).decode('ascii'), 'json': js, 'view': view()}


# ── Undo (the desktop's save_state / undo / redo) ───────────────────
MUTATING = {'settings', 'background', 'clear_background', 'add_peak', 'remove_peak', 'set_cell', 'fit',
            'export', 'results_set', 'results_delete', 'checkpoint'}


def _snapshot():
    import copy
    w = _session()
    return (copy.deepcopy(w.Data), w.sheet_combobox.GetValue(), list(S.sheets), S.original)


def _restore(snap):
    from kfcore.sheets import select_sheet
    w = _session()
    w.Data, sheet, S.sheets, S.original = snap
    if sheet and sheet in w.Data.get('Core levels', {}):
        select_sheet(w, sheet)
        w.background_method = w.background_method or 'Smart'
    elif S.sheets:
        select_sheet(w, S.sheets[0])


def op_checkpoint(a):
    return {}


def op_undo(a):
    if not S.undo:
        return {'view': view(), 'nothing': True}
    S.redo.append(_snapshot())
    _restore(S.undo.pop())
    return {'view': view()}


def op_redo(a):
    if not S.redo:
        return {'view': view(), 'nothing': True}
    S.undo.append(_snapshot())
    _restore(S.redo.pop())
    return {'view': view()}


OPS = {
    'checkpoint': op_checkpoint, 'undo': op_undo, 'redo': op_redo,
    'open': op_open, 'import': op_import, 'new': op_new, 'view': op_view, 'select': op_select,
    'settings': op_settings, 'background': op_background, 'clear_background': op_clear_background,
    'add_peak': op_add_peak, 'remove_peak': op_remove_peak, 'set_cell': op_set_cell,
    'drag_peak': op_drag_peak, 'fit': op_fit, 'report': op_report, 'export': op_export,
    'results_set': op_results_set, 'results_delete': op_results_delete, 'save': op_save,
}


async def run(requests_json):
    """Answer a batch of requests; print the answers between the markers."""
    requests = json.loads(requests_json)
    answers = []
    for req in requests:
        op = req.get('op')
        args = req.get('args') or {}
        try:
            feats = _features()
            f_ops = getattr(feats, 'OPS', {}) if feats is not None else {}
            await ensure(NEEDS.get(op) or (getattr(feats, 'NEEDS', {}) or {}).get(op) or CORE)
            fn = OPS.get(op) or f_ops.get(op)
            if fn is None:
                raise ValueError(f"Unknown request: {op}")
            mutating = op in MUTATING or op in (getattr(feats, 'MUTATING', set()) if feats is not None else set())
            if mutating and S.session is not None and S.session.sheet_combobox.GetValue():
                S.undo.append(_snapshot())
                del S.undo[:-30]
                S.redo.clear()
            ans = fn(args)
            ans['canUndo'] = bool(S.undo)
            ans['canRedo'] = bool(S.redo)
            ans['ok'] = True
        except Exception as e:  # every failure goes back to the page as text
            from kfcore.sheets import CellRejected
            if isinstance(e, CellRejected):
                ans = {'ok': False, 'error': str(e) or 'This value is not accepted.', 'rejected': True}
            else:
                ans = {'ok': False, 'error': f"{type(e).__name__}: {e}", 'trace': traceback.format_exc()}
            try:
                ans['view'] = view()
            except Exception:
                pass
        answers.append(ans)
    sys.stdout.write(START + json.dumps(answers, allow_nan=False, default=_json_default) + END + "\n")


def _json_default(o):
    if hasattr(o, 'tolist'):
        return o.tolist()
    if isinstance(o, float):
        return None
    return str(o)
