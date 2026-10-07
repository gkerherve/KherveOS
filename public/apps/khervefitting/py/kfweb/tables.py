"""The desktop's results grid and fit statistics, as text for the web page.

results_grid follows KherveFittingPro dev-AI libraries/Grid_Operations.py
populate_results_grid (31 columns + the 7 uncertainty columns of
Fit_Uncertainty), with NumberFormat.format_intensity and Fit_Uncertainty.fmt_err;
fit_stats follows PlotLabelEdit.fit_stats (the chi shown beside the residuals).

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0 (KherveFitting code: GPL-3.0-only).
"""

import math
import re

RESULT_ERROR_COLUMNS = [
    ('Pos. Err', 'Position'), ('Height Err', 'Height'), ('FWHM Err', 'FWHM'), ('L/G Err', 'L/G'),
    ('Area Err', 'Area'), ('at. % Err', None), ('Err Method', None),
]


def format_intensity(value, sig=4):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(v):
        return f"{v}"
    a = abs(v)
    if a >= 100:
        return f"{v:.0f}"
    if a >= 1:
        return f"{v:.2f}"
    if a == 0:
        return "0.00"
    if a < 1e-6:
        return f"{v:.{sig - 1}e}"
    places = sig - 1 - int(math.floor(math.log10(a)))
    text = f"{v:.{places}f}".rstrip('0')
    whole, _, frac = text.partition('.')
    if len(frac) < 2:
        frac = frac.ljust(2, '0')
    return f"{whole}.{frac}"


def fmt_err(value):
    if value is None or value == '':
        return ''
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(v):
        return ''
    if v == 0:
        return '0'
    digits = max(0, 1 - int(math.floor(math.log10(abs(v)))))
    return f"{v:.{min(digits, 8)}f}"


def _f2(v, default=0):
    try:
        return f"{float(v if v not in (None, '') else default):.2f}"
    except (TypeError, ValueError):
        return str(v)


def results_key(sheet_name):
    m = re.search(r'(\d+)$', sheet_name or '')
    return f"Results Table{int(m.group(1)) if m else 0}"


def results_grid(window):
    """[{key, cells: [38 strings], checked}] for the current sample."""
    from kfcore.results import ATOMIC_MASSES, extract_element_symbol
    key = results_key(window.sheet_combobox.GetValue())
    peaks = (window.Data.get(key) or {}).get('Peak') or {}
    rows = []
    for label, p in peaks.items():
        name = p.get('Name', '')
        cells = [
            name, _f2(p.get('Position', 0)), format_intensity(p.get('Height', '')), str(p.get('FWHM', '')),
            str(p.get('L/G', '')), format_intensity(p.get('Area', 0)), _f2(p.get('at. %', 0)),
            str(p.get('Checkbox', '0')), _f2(p.get('RSF', 0)), _f2(p.get('TXFN', 1.0)), str(p.get('ECF', '')),
            str(p.get('Instrument', 'Al1486')), str(p.get('Fitting Model', '')), format_intensity(p.get('Rel. Area', 0)),
            str(p.get('Sigma', '')), str(p.get('Gamma', '')), str(p.get('Bkg Type', '')), str(p.get('Bkg Low', '')),
            str(p.get('Bkg High', '')), str(p.get('Bkg Offset Low', '')), str(p.get('Bkg Offset High', '')),
            str(p.get('Sheetname', '')), str(p.get('Pos. Constraint', '')), str(p.get('Height Constraint', '')),
            str(p.get('FWHM Constraint', '')), str(p.get('L/G Constraint', '')), str(p.get('Area Constraint', '')),
            str(p.get('Sigma Constraint', '')), str(p.get('Gamma Constraint', '')), _f2(p.get('wt. %', 0)),
            f"{ATOMIC_MASSES.get(extract_element_symbol(name), 12.01):.2f}",
        ]
        for k, _q in RESULT_ERROR_COLUMNS:
            v = p.get(k, '')
            cells.append(v if isinstance(v, str) else fmt_err(v))
        rows.append({'key': label, 'cells': cells, 'checked': str(p.get('Checkbox', '0')) == '1'})
    return key, rows


def fit_stats(window, sheet_name=None):
    """Chi, R2 and reduced chi2 of the sheet's last fit ({} if never fitted)."""
    sheet_name = sheet_name or window.sheet_combobox.GetValue()
    saved = (((window.Data.get('Core levels', {}).get(sheet_name, {}) or {}).get('Fitting') or {})
             .get('Fit Stats') or {})
    fr = getattr(window, 'fit_results', None) or {}
    if fr.get('sheet_name', sheet_name) == sheet_name and fr.get('rsd') is not None:
        out = {'Chi': float(fr['rsd'])}
        if fr.get('red_chi_square') is not None:
            out['RedChi'] = float(fr['red_chi_square'])
        if saved.get('R2') is not None:
            out['R2'] = float(saved['R2'])
        elif fr.get('r_squared') is not None:
            out['R2'] = float(fr['r_squared'])
        return out
    out = {}
    for k, v in saved.items():
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            pass
    return out
