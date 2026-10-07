# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the D-parameter window (ToolsMenu/Dpara_Screen.py,
# DParameterWindow.on_calculate / on_clear) and what the main plot draws for a
# sheet holding a D-parameter (PlotManager.plot_peak, "D-parameter" branch).
# The smoothing/derivative is OtherCalc.smooth_and_differentiate, unchanged.
#
# What the desktop stores: one peak in Data['Core levels'][sheet]['Fitting']
# ['Peaks']['D-parameter'] = {'Position': centre, 'FWHM': D, 'Sigma': pre-smooth
# passes, 'Gamma': post-smooth passes, 'Skew': smooth width, 'L/G': differentiation
# width, 'Fitting Model': 'D-parameter', 'Derivative': [normalised derivative]}.
# The grid row shows it as label/model "D-parameter". Nothing goes to the
# results table. The smoothing algorithm is not stored.

import numpy as np

#: The window's smoothing algorithms (Smooth Algorithm combo box).
ALGORITHMS = ["Gaussian", "Savitsky-Golay", "Moving Average", "Wiener", "None"]

# sp2 vs D-parameter calibration (Dpara_Screen.py, after D. J. Morgan,
# C 2021, 7, 51): the two anchors and the digitised scatter groups.
DPARA_DIAMOND = (14.3, 0.0)
DPARA_HOPG = (22.5, 100.0)
DPARA_GROUPS = {
    'Ion deposited\namorphous carbons': {
        'label_xy': (16.5, 8.0), 'label_va': 'top',
        'points': [(16.0, 20.0), (16.5, 28.0), (17.0, 34.0)],
    },
    'Hydrogenated\ncarbons': {
        'label_xy': (19.5, 86.0), 'label_va': 'bottom',
        'points': [(18.8, 55.0), (19.3, 60.0), (19.55, 61.0),
                   (19.7, 63.0), (20.0, 69.0), (19.4, 75.0)],
    },
    'Defected\ngraphite': {
        'label_xy': (20.7, 103.0), 'label_va': 'bottom',
        'points': [(21.8, 91.0), (21.95, 95.0), (22.05, 98.0)],
    },
}


def _reference_rows():
    """_dpara_reference_rows: (material, D-parameter eV, sp2 %), sorted by D."""
    rows = [('Diamond', DPARA_DIAMOND[0], DPARA_DIAMOND[1])]
    for name, g in DPARA_GROUPS.items():
        fam = name.replace('\n', ' ')
        for x, y in g['points']:
            rows.append((fam, x, y))
    rows.append(('HOPG', DPARA_HOPG[0], DPARA_HOPG[1]))
    rows.sort(key=lambda r: r[1])
    return rows


def _sp2(d_param):
    """sp2 % read off the diamond-HOPG line, clamped to 0-100 (_mark_dparameter)."""
    dx, dy = DPARA_DIAMOND
    hx, hy = DPARA_HOPG
    sp2 = dy + (hy - dy) / (hx - dx) * (d_param - dx)
    return max(0.0, min(100.0, sp2))


def dparam_calibration():
    """The window's calibration tab and reference table, as data for the page."""
    dx, dy = DPARA_DIAMOND
    hx, hy = DPARA_HOPG
    slope = (hy - dy) / (hx - dx)
    line_x = [dx - 0.4, hx + 0.4]
    return {
        'line': {'x': line_x, 'y': [dy + slope * (v - dx) for v in line_x]},
        'anchors': [{'name': 'Diamond', 'x': dx, 'y': dy}, {'name': 'HOPG', 'x': hx, 'y': hy}],
        'groups': [{'name': name, 'label_xy': list(g['label_xy']), 'label_va': g['label_va'],
                    'points': [list(p) for p in g['points']]} for name, g in DPARA_GROUPS.items()],
        'xlim': [13.6, 23.6], 'ylim': [-10, 120],
        'reference': [{'material': m, 'd': d, 'sp2': s} for m, d, s in _reference_rows()],
        'citation': 'After D. J. Morgan, J. Carbon Res. (C) 2021, 7, 51',
    }


def smooth_and_differentiate(x_values, y_values, smooth_width=2.0, pre_smooth=1, diff_width=1.0,
                             post_smooth=1, algorithm="Gaussian"):
    """OtherCalc.smooth_and_differentiate, also returning the pre-smoothed data.

    Returns (smoothed, normalized_deriv); the second is exactly the desktop's
    return value.
    """
    from scipy.ndimage import gaussian_filter
    from scipy.signal import savgol_filter, wiener

    def apply_smooth(data, width, algorithm):
        if algorithm == "Gaussian":
            return gaussian_filter(data, width)
        elif algorithm == "Savitsky-Golay":
            window = int(width * 10) if int(width * 10) % 2 == 1 else int(width * 10) + 1
            return savgol_filter(data, window, 3)
        elif algorithm == "Moving Average":
            window = int(width * 10)
            return np.convolve(data, np.ones(window) / window, mode='same')
        elif algorithm == "Wiener":
            return wiener(data, int(width * 10))
        else:  # "None"
            return data

    smoothed = y_values.copy()
    for _ in range(int(pre_smooth)):
        smoothed = apply_smooth(smoothed, smooth_width, algorithm)
    pre_smoothed = smoothed

    derivative = -1 * np.gradient(smoothed, x_values)

    for _ in range(int(post_smooth)):
        derivative = apply_smooth(derivative, diff_width, algorithm)

    data_range = np.max(y_values) - np.min(y_values)
    deriv_range = np.max(derivative) - np.min(derivative)
    normalized_deriv = ((derivative - np.min(derivative)) / deriv_range * data_range) + np.min(y_values)
    return pre_smoothed, normalized_deriv


def _f(v):
    v = float(v)
    return v if np.isfinite(v) else None


def _list(a):
    return [_f(v) for v in np.asarray(a, dtype=float)]


def dparam(w, smooth=7.0, pre=2, diff=1.0, post=1, algorithm="Gaussian"):
    """DParameterWindow.on_calculate on the current sheet.

    smooth: Smooth Width (default 7.0); pre: Pre-Smooth Passes (2);
    diff: Differentiation Width in eV (1.0) - the post-smoothing width;
    post: Post-Smooth Passes (1); algorithm: one of ALGORITHMS ("Gaussian").
    """
    from .sheets import select_sheet

    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet_name]
    if len(w.x_values) == 0:
        w.load_view()
    x_values = np.asarray(w.x_values, dtype=float)
    y_values = np.asarray(w.y_values, dtype=float)
    if len(x_values) < 3:
        raise ValueError("No data on this sheet")
    if algorithm not in ALGORITHMS:
        raise ValueError(f"Unknown smoothing algorithm: {algorithm}")
    smooth = float(smooth)
    diff = float(diff)
    pre = int(pre)
    post = int(post)

    # Remove previous D-parameter rows from the grid (the Data entry is replaced below)
    grid = w.peak_params_grid
    for row in range(grid.GetNumberRows() - 1, -1, -1):
        if grid.GetCellValue(row, 13) == "D-parameter":
            grid.DeleteRows(row, 2)

    smoothed, normalized_deriv = smooth_and_differentiate(x_values, y_values, smooth, pre, diff, post,
                                                          algorithm)

    min_idx = int(np.argmin(normalized_deriv))
    max_idx = int(np.argmax(normalized_deriv))
    x_min = float(x_values[min_idx])
    x_max = float(x_values[max_idx])
    center = (x_max + x_min) / 2
    d_param = round(abs(x_max - x_min), 2)

    # The new grid row (as the window writes it; select_sheet rebuilds it from Data)
    row = grid.GetNumberRows()
    grid.AppendRows(2)
    grid.SetCellValue(row, 0, chr(65 + row // 2))
    grid.SetCellValue(row, 1, "D-parameter")
    grid.SetCellValue(row, 2, f"{center:.2f}")
    grid.SetCellValue(row, 4, f"{d_param:.2f}")
    grid.SetCellValue(row, 7, f"{pre:.2f}")
    grid.SetCellValue(row, 8, f"{post:.2f}")
    grid.SetCellValue(row, 9, f"{smooth:.2f}")
    grid.SetCellValue(row, 5, f"{diff:.2f}")
    grid.SetCellValue(row, 13, "D-parameter")

    if 'Fitting' not in cl or not isinstance(cl['Fitting'], dict):
        cl['Fitting'] = {}
    if 'Peaks' not in cl['Fitting']:
        cl['Fitting']['Peaks'] = {}
    cl['Fitting']['Peaks']['D-parameter'] = {
        'Position': center,
        'FWHM': d_param,
        'Sigma': pre,
        'Gamma': post,
        'Skew': smooth,
        'L/G': diff,
        'Fitting Model': 'D-parameter',
        'Derivative': _list(normalized_deriv),
    }
    _CACHE.pop(sheet_name, None)

    select_sheet(w, sheet_name)

    rows = _reference_rows()
    nearest = min(range(len(rows)), key=lambda i: abs(rows[i][1] - d_param))
    return {
        'sheet': sheet_name,
        'x': _list(x_values),
        'smoothed': _list(smoothed),
        'derivative': _list(normalized_deriv),
        'max': {'x': x_max, 'y': _f(normalized_deriv[max_idx])},
        'min': {'x': x_min, 'y': _f(normalized_deriv[min_idx])},
        'd': d_param,
        'center': center,
        'sp2': _sp2(d_param),
        'nearest': {'material': rows[nearest][0], 'd': rows[nearest][1], 'sp2': rows[nearest][2]},
        'params': {'smooth': smooth, 'pre': pre, 'diff': diff, 'post': post, 'algorithm': algorithm},
    }


def dparam_clear(w):
    """DParameterWindow.on_clear: empties the grid and Data['...']['Fitting']
    of the current sheet (every peak, as the desktop does, not only the
    D-parameter)."""
    from .sheets import select_sheet

    sheet_name = w.sheet_combobox.GetValue()
    grid = w.peak_params_grid
    if grid.GetNumberRows() > 0:
        grid.DeleteRows(0, grid.GetNumberRows())
    if sheet_name in w.Data['Core levels'] and 'Fitting' in w.Data['Core levels'][sheet_name]:
        w.Data['Core levels'][sheet_name]['Fitting'] = {}
    w.peak_count = 0
    _CACHE.pop(sheet_name, None)
    select_sheet(w, sheet_name)
    return {'sheet': sheet_name, 'd': 0}


# Recomputed derivatives (sheet -> (key, list)), for D-parameter peaks saved
# without a usable 'Derivative'.
_CACHE = {}


def dparam_view(w, sheet):
    """The curve the main plot draws for a D-parameter on this sheet, or None.

    The desktop draws only the normalised derivative as a line (data units, so
    it spans the raw data's min..max) on top of the raw data - no markers, no
    vertical lines; and on such a sheet it draws no background line, no
    envelope/residuals and no legend. Right after Calculate the line is red;
    on a replot it takes the peak colour of its row (peak_colors[i]).
    x is binding energy (the page converts for the KE scale).
    """
    cl = w.Data['Core levels'].get(sheet)
    if not cl or 'B.E.' not in cl:
        return None
    fitting = cl.get('Fitting')
    peaks = fitting.get('Peaks') if isinstance(fitting, dict) else None
    if not peaks:
        return None
    index, label, peak = None, None, None
    for i, (name, data) in enumerate(peaks.items()):
        if isinstance(data, dict) and data.get('Fitting Model') == 'D-parameter':
            index, label, peak = i, name, data
            break
    if peak is None:
        return None
    x = cl['B.E.']
    deriv = peak.get('Derivative')
    if not (isinstance(deriv, list) and len(deriv) == len(x)):
        # PlotManager.plot_peak recomputes from the row: Skew = smooth width,
        # Sigma = pre passes, L/G = differentiation width, Gamma = post passes,
        # with the default (Gaussian) algorithm.
        try:
            params = (float(peak.get('Skew', 7.0)), float(peak.get('Sigma', 2)),
                      float(peak.get('L/G', 1.0)), float(peak.get('Gamma', 1)))
        except (TypeError, ValueError):
            return None
        key = (params, len(x), id(cl['Raw Data']))
        hit = _CACHE.get(sheet)
        if hit and hit[0] == key:
            deriv = hit[1]
        else:
            _, d = smooth_and_differentiate(np.asarray(x, dtype=float),
                                            np.asarray(cl['Raw Data'], dtype=float),
                                            params[0], params[1], params[2], params[3])
            deriv = _list(d)
            _CACHE[sheet] = (key, deriv)
    return {
        'label': label,
        'peak_index': index,
        'x': list(x),
        'y': deriv,
        'd': peak.get('FWHM'),
        'center': peak.get('Position'),
        'color_after_calculate': 'red',
        'hide': ['background', 'envelope', 'residuals', 'legend'],
    }
