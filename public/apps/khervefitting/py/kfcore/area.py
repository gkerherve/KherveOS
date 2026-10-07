# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the "Measure Area" window (ToolsMenu/AreaFit_Screen.py,
# BackgroundWindow): "Create Background / Area" (on_background_only, with
# handle_tougaard_background_special and PlotManager.plot_background) and the
# Batching tab's "Propagate Area to Column" (on_propagate_area,
# clear_all_peaks_from_sheet, create_area_for_sheet). Background maths are
# BackgroundCalculations (kfcore.backgrounds), unchanged.
#
# What the desktop stores for an area: a peak with 'Fitting Model' "Unfitted" in
# Data['Core levels'][sheet]['Fitting']['Peaks'][name] = {'Position', 'Height',
# 'FWHM', 'L/G': 0, 'Area', 'Sigma': 0, 'Gamma': 0, 'Skew': 0, 'Fitting Model':
# 'Unfitted', 'Bkg Type', 'Bkg Low', 'Bkg High', 'Constraints': all 'Fixed'},
# and the background in Data['Core levels'][sheet]['Background']['Bkg Y'] (only
# the points between the two limits change). Nothing is written to the results
# table: the main window's Export does that later.

import re

import numpy as np

from .backgrounds import BackgroundCalculations
from .compat import trapz

#: Background methods of the window's Method list (XPS sheets; the default
#: selection is index 4, "U2-Tougaard").
METHODS = ["Smart", "Shirley", "Linear", "U4-Tougaard", "U2-Tougaard", "Poly-2", "Poly-3", "ALS"]
#: The list on FTIR sheets and on EELS sheets (refresh_for_technique).
FTIR_METHODS = ["Linear", "Poly-2", "Poly-3", "ALS"]
EELS_METHODS = ["Power-EELS", "Linear", "Poly-2", "Poly-3", "ALS"]
DEFAULT_METHOD = "U2-Tougaard"
#: The window's Tougaard1 "B,C,D,T0" default.
DEFAULT_TOUGAARD = (2866.0, 1643.0, 1.0, 0.0)


def _other_background(window, sheet_name, x_values, y_values, method, offset_h, offset_l, vlines):
    """PlotManager._calculate_other_background (dev-AI). vlines is the pair of
    limit positions (binding energy) or None, as window.vline1/vline2."""
    bg = window.Data['Core levels'][sheet_name]['Background']
    if vlines is not None:
        bg_min_energy = min(vlines)
        bg_max_energy = max(vlines)
        bg_min_energy = max(bg_min_energy, min(x_values))
        bg_max_energy = min(bg_max_energy, max(x_values))
        if bg_min_energy >= bg_max_energy:
            bg_min_energy = bg.get('Bkg Low')
            bg_max_energy = bg.get('Bkg High')
    else:
        bg_min_energy = bg.get('Bkg Low')
        bg_max_energy = bg.get('Bkg High')

    try:
        if bg_min_energy is None or bg_max_energy is None or bg_min_energy >= bg_max_energy:
            bg_min_energy = min(x_values)
            bg_max_energy = max(x_values)
    except TypeError:
        bg_min_energy = min(x_values)
        bg_max_energy = max(x_values)
    try:
        bg_min_energy = float(bg_min_energy) if bg_min_energy != '' else min(x_values)
        bg_max_energy = float(bg_max_energy) if bg_max_energy != '' else max(x_values)
    except (ValueError, TypeError):
        bg_min_energy = min(x_values)
        bg_max_energy = max(x_values)

    mask = (x_values >= bg_min_energy) & (x_values <= bg_max_energy)
    if np.sum(mask) < 2:
        mask = np.ones(len(x_values), dtype=bool)
    xf = x_values[mask]
    yf = y_values[mask]
    if len(xf) < 2:
        mask = np.zeros(len(x_values), dtype=bool)
        mask[0] = True
        mask[-1] = True
        xf = x_values[mask]
        yf = y_values[mask]

    n = getattr(window, 'averaging_points', 5)
    B = BackgroundCalculations
    if method == "Shirley":
        b = B.calculate_shirley_background(xf, yf, offset_h, offset_l, num_points=n)
    elif method == "Iterated Shirley":
        b = B.calculate_iterated_shirley_background(xf, yf, offset_h, offset_l, iterations=n)
    elif method == "Spline Shirley":
        init = B.calculate_shirley_background(xf, yf, offset_h, offset_l, num_points=n)
        b = B.calculate_spline_background(xf, yf, init, offset_h, offset_l, num_points=n)
    elif method == "Spline Tougaard":
        init = B.calculate_tougaard_background(xf, yf, sheet_name, window)
        b = B.calculate_spline_background(xf, yf, init, offset_h, offset_l, num_points=n)
    elif method == "Linear":
        b = B.calculate_linear_background(xf, yf, offset_h, offset_l, num_points=n)
    elif method in ["Smart", "Multi-Regions Smart", "Multiple Regions Smart"]:
        b = B.calculate_smart_background(xf, yf, offset_h, offset_l, num_points=n)
    elif method == "Offset":
        b = B.calculate_offset_background(xf, yf, offset_h, offset_l)
    elif method == "U4-Tougaard":
        b = B.calculate_tougaard_background(xf, yf, sheet_name, window)
    elif method == "U2-Tougaard":
        b = B.calculate_u2_tougaard_background(xf, yf, sheet_name, window)
    elif method == "2x U4-Tougaard":
        b = B.calculate_double_tougaard_background(xf, yf, sheet_name, window)
    elif method == "3x U4-Tougaard":
        b = B.calculate_triple_tougaard_background(xf, yf, sheet_name, window)
    elif method == "Poly-2":
        b = B.calculate_polynomial_background(xf, yf, order=2, start_offset=offset_h,
                                              end_offset=offset_l, num_points=n)
    elif method == "Poly-3":
        b = B.calculate_polynomial_background(xf, yf, order=3, start_offset=offset_h,
                                              end_offset=offset_l, num_points=n)
    elif method == "ALS":
        b = B.calculate_als_baseline(xf, yf, start_offset=offset_h, end_offset=offset_l, num_points=n)
    elif method == "Arctan-XAS":
        b = B.calculate_arctan_background(xf, yf, offset_h, offset_l, num_points=n)
    elif method == "Power-EELS":
        b = B.calculate_power_eels_background(xf, yf, sheet_name, window, num_points=n)
    elif method == "ALS-Raman":
        b = B.calculate_als_background_spectral(xf, yf, lambda_val=1e5, p=0.001)
    elif method == "Active Shirley":
        k = bg.get('Active_Shirley_k', None)
        base = bg.get('Active_Shirley_const_base', None)
        if k is not None and base is not None:
            b = B.calculate_active_shirley_replay(xf, yf, k, base + offset_l)
        else:
            b = B.calculate_active_shirley_background(xf, yf, offset_h, offset_l, num_points=n)
    elif method == "Active Tougaard":
        stored_B = bg.get('Active_Tougaard_B', None)
        if stored_B is not None:
            C = float(bg.get('Tougaard_C', 1643))
            baseline = B.calculate_endpoint_average(xf, yf, xf[-1], n) + offset_l
            y_shifted = np.maximum(yf - baseline, 0)
            dx = np.abs(np.mean(np.diff(xf)))
            out = np.zeros(len(xf), dtype=float)
            for i in range(len(xf) - 1):
                T = np.abs(xf[i + 1:] - xf[i])
                K = stored_B * T / ((C + T ** 2) ** 2)
                out[i] = np.sum(K * y_shifted[i + 1:]) * dx
            b = out + baseline
        else:
            b = B.calculate_active_tougaard_background(xf, yf, offset_h, offset_l, num_points=n)
    else:
        b = B.calculate_smart_background(xf, yf, offset_h, offset_l)

    new_background = np.array(bg['Bkg Y'], dtype=float)
    new_background[mask] = b
    return new_background


def _plot_background(window, sheet_name, vlines):
    """PlotManager.plot_background (use_smoothing=False): the background from
    window.background_method / offset_h / offset_l between the limits, stored
    with _update_background_data. Errors are swallowed, as on the desktop."""
    cl = window.Data['Core levels'][sheet_name]
    try:
        x_values = np.array(cl['B.E.'], dtype=float)
        y_values = np.array(cl['Raw Data'], dtype=float)
        bg = cl['Background']
        if 'Bkg Y' not in bg or not bg['Bkg Y']:
            bg['Bkg Y'] = y_values.tolist()
        method = window.background_method
        try:
            offset_h = float(window.offset_h)
        except (AttributeError, ValueError, TypeError):
            offset_h = 0
        try:
            offset_l = float(window.offset_l)
        except (AttributeError, ValueError, TypeError):
            offset_l = 0
        background = _other_background(window, sheet_name, x_values, y_values, method,
                                       offset_h, offset_l, vlines)
        # _update_background_data
        if vlines is not None:
            bg_low = round(min(vlines), 2)
            bg_high = round(max(vlines), 2)
        else:
            bg_low = round(min(x_values), 2)
            bg_high = round(max(x_values), 2)
        bg.update({
            'Bkg Y': background.tolist(),
            'Bkg Type': method,
            'Bkg Low': float(bg_low),
            'Bkg High': float(bg_high),
            'Bkg Offset Low': offset_l,
            'Bkg Offset High': offset_h,
            'Bkg X': x_values.tolist(),
        })
        window.background = background
        return None
    except Exception as e:  # the desktop prints "Error in plot_background"
        return f"Error in plot_background: {e}"


def _tougaard_special(window, sheet_name, method, vline1_x, vline2_x):
    """BackgroundWindow.handle_tougaard_background_special: a Tougaard background
    applied only between the limits (U4 computed on the whole spectrum, U2 on
    the region). Only 'Bkg Y' changes in Data['...']['Background']."""
    cl = window.Data['Core levels'][sheet_name]
    full_x = np.array(cl['B.E.'], dtype=float)
    full_raw = np.array(cl['Raw Data'], dtype=float)
    if 'Background' in cl and 'Bkg Y' in cl['Background']:
        current = np.array(cl['Background']['Bkg Y'], dtype=float)
    else:
        current = full_raw.copy()
        cl.setdefault('Background', {})
        cl['Background']['Bkg Y'] = current.tolist()

    range_min = min(vline1_x, vline2_x)
    range_max = max(vline1_x, vline2_x)
    m = (full_x >= range_min) & (full_x <= range_max)
    current[m] = full_raw[m]
    B = BackgroundCalculations
    try:
        if method == "U4-Tougaard":
            full_bg = B.calculate_tougaard_background(full_x, full_raw, sheet_name, window)
        elif method == "U2-Tougaard":
            part = B.calculate_u2_tougaard_background(full_x[m], full_raw[m], sheet_name, window,
                                                      (vline1_x, vline2_x))
            full_bg = current.copy()
            full_bg[m] = part
        elif method == "2x U4-Tougaard":
            full_bg = B.calculate_double_tougaard_background(full_x, full_raw, sheet_name, window)
        elif method == "3x U4-Tougaard":
            full_bg = B.calculate_triple_tougaard_background(full_x, full_raw, sheet_name, window)
        else:
            return _plot_background(window, sheet_name, (vline1_x, vline2_x))
        current[m] = full_bg[m]
        cl['Background']['Bkg Y'] = current.tolist()
        window.background = current
        return None
    except Exception as e:
        warn = _plot_background(window, sheet_name, (vline1_x, vline2_x))
        return f"Error calculating Tougaard background: {e}" + (f"; {warn}" if warn else "")


def _measure(x_values, y_values, background, range_min, range_max):
    """The area and the peak parameters of on_background_only / create_area_for_sheet."""
    mask = (x_values >= range_min) & (x_values <= range_max)
    x_range = x_values[mask]
    y_range = y_values[mask]
    bg_range = background[mask]
    y_minus_bg = y_range - bg_range
    order = np.argsort(x_range)
    area = trapz(y_minus_bg[order], x_range[order])
    peak_index = np.argmax(y_minus_bg)
    peak_position = x_range[peak_index]
    peak_height = y_minus_bg[peak_index]
    if peak_height > 0:
        fwhm = 2 * np.sqrt(2 * np.log(2)) * abs(area) / (peak_height * np.sqrt(2 * np.pi))
    else:
        fwhm = 0
    return (float(abs(round(area, 2))), float(round(peak_position, 2)), float(round(peak_height, 2)),
            float(round(fwhm, 2)), int(mask.sum()))


def _row_range(w, sheet_name, row, as_text=False):
    """(Bkg Type, Bkg Low, Bkg High) of a peak-table row, as the desktop grid holds
    them while the Measure Area window is in use: an area row keeps its own
    method and range (columns 14-16 written by on_background_only). The
    desktop's on_sheet_selected later overwrites those columns with the
    sheet-level Background values; select_sheet does the same here, so the
    area's own values are read back from its Data entry."""
    grid = w.peak_params_grid
    vals = [grid.GetCellValue(row, c) for c in (14, 15, 16)]
    peaks = w.Data['Core levels'].get(sheet_name, {}).get('Fitting', {})
    peaks = peaks.get('Peaks', {}) if isinstance(peaks, dict) else {}
    p = peaks.get(grid.GetCellValue(row, 1))
    if isinstance(p, dict) and p.get('Fitting Model') == 'Unfitted' and \
            all(p.get(k) not in (None, '') for k in ('Bkg Type', 'Bkg Low', 'Bkg High')):
        vals = [p['Bkg Type'], p['Bkg Low'], p['Bkg High']]
    if as_text:
        return tuple('' if v in (None, '') else str(v) for v in vals)
    return vals[0], float(vals[1]), float(vals[2])


def _fixed_constraints():
    return {k: "Fixed" for k in ('Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew')}


def _set_tougaard(window, sheet_name, tougaard):
    """on_cross_section_change: the "B,C,D,T0" field into the sheet's Background."""
    if tougaard is None:
        return
    if isinstance(tougaard, str):
        tougaard = tougaard.split(',')
    try:
        b, c, d, t0 = (float(v) for v in list(tougaard)[:4])
    except (ValueError, TypeError):
        return
    window.Data['Core levels'][sheet_name].setdefault('Background', {}).update({
        'Tougaard_B': b, 'Tougaard_C': c, 'Tougaard_D': d, 'Tougaard_T0': t0})


def area_create(w, method=DEFAULT_METHOD, low=None, high=None, name=None, offset_low=0.0,
                offset_high=0.0, averaging_points=1, tougaard=None):
    """"Create Background / Area" (BackgroundWindow.on_background_only) on the current sheet.

    low/high: the two limit lines (binding energy; order does not matter).
    name: the "Area Name" field ('' or None: "<sheet> p<n+1>", or "<El> ." on a
    survey). offset_high is "Offset (Left)" (window.offset_h), offset_low is
    "Offset (Right)" (window.offset_l). averaging_points: the window's
    "Averaging Points" (default 1; the window sets the main window's value).
    tougaard: optional "B,C,D,T0" (string or 4 numbers) stored in the sheet's
    Background as Tougaard_B/C/D/T0 (on_cross_section_change).
    An area whose name already exists is re-measured in place (its previous
    background range is first reset to the raw data).
    """
    from .sheets import select_sheet

    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet_name]
    if low is None or high is None:
        raise ValueError("Two limits are needed")
    vline1_x, vline2_x = float(high), float(low)
    if len(w.x_values) == 0:
        w.load_view()
    cl.setdefault('Background', {})
    if not cl['Background'].get('Bkg Y'):
        cl['Background']['Bkg Y'] = list(cl['Raw Data'])

    try:
        n = int(averaging_points)
    except (TypeError, ValueError):
        n = 1
    w.averaging_points = n if n > 0 else 1
    _set_tougaard(w, sheet_name, tougaard)
    w.background_method = method
    w.offset_h = float(offset_high)
    w.offset_l = float(offset_low)

    is_survey = any(s in sheet_name.lower() for s in ['survey', 'wide'])
    grid = w.peak_params_grid
    area_name = (name or '').strip()
    if not area_name:
        if is_survey:
            base_name = sheet_name.replace('Survey', '').replace('Wide', '').strip()
            area_name = f"{base_name} ." if base_name else "Unknown ."
        else:
            area_name = f"{sheet_name} p{grid.GetNumberRows() // 2 + 1}"
    elif is_survey and not area_name.endswith(' .'):
        area_name = f"{area_name} ."

    existing_row = -1
    for row in range(0, grid.GetNumberRows(), 2):
        if grid.GetCellValue(row, 1) == area_name:
            existing_row = row
            break
    if existing_row >= 0:
        # clear_background_between_range(previous Bkg Low, Bkg High)
        prev_low, prev_high = _row_range(w, sheet_name, existing_row)[1:]
        x_values = np.array(w.x_values, dtype=float)
        raw = np.array(cl['Raw Data'], dtype=float)
        background = np.array(cl['Background']['Bkg Y'], dtype=float)
        m = (x_values >= min(prev_low, prev_high)) & (x_values <= max(prev_low, prev_high))
        background[m] = raw[m]
        cl['Background']['Bkg Y'] = background.tolist()
        w.background = background

    if "Tougaard" in method:
        warning = _tougaard_special(w, sheet_name, method, vline1_x, vline2_x)
    else:
        warning = _plot_background(w, sheet_name, (vline1_x, vline2_x))

    x_values = np.array(cl['B.E.'], dtype=float)
    y_values = np.array(cl['Raw Data'], dtype=float)
    background = np.array(cl['Background']['Bkg Y'], dtype=float)
    range_min = round(min(vline1_x, vline2_x), 2)
    range_max = round(max(vline1_x, vline2_x), 2)
    mask = (x_values >= range_min) & (x_values <= range_max)
    if not mask.any():
        raise ValueError("No data points between the two limits")
    area, peak_position, peak_height, fwhm, npts = _measure(x_values, y_values, background,
                                                            range_min, range_max)

    if existing_row >= 0:
        row = existing_row
        peak_letter = grid.GetCellValue(row, 0)
    else:
        num_peaks = grid.GetNumberRows() // 2
        peak_letter = chr(65 + num_peaks)
        grid.AppendRows(2)
        row = num_peaks * 2
    s = grid.SetCellValue
    s(row, 0, peak_letter)
    s(row, 1, area_name)
    s(row, 2, f"{peak_position:.2f}")
    s(row, 3, f"{peak_height:.2f}")
    s(row, 4, f"{fwhm:.2f}")
    s(row, 5, "0")
    s(row, 6, f"{area:.2f}")
    s(row, 7, "")
    s(row, 8, "")
    s(row, 9, "")
    s(row, 13, "Unfitted")
    s(row, 14, method)
    s(row, 15, f"{range_min}")
    s(row, 16, f"{range_max}")
    for col in (2, 3, 4, 6):
        s(row + 1, col, "Fixed")
    for col in (7, 8, 9):
        s(row + 1, col, "")
    w.update_ratios()

    if 'Fitting' not in cl or not isinstance(cl['Fitting'], dict):
        cl['Fitting'] = {}
    if 'Peaks' not in cl['Fitting']:
        cl['Fitting']['Peaks'] = {}
    cl['Fitting']['Peaks'][area_name] = {
        'Position': peak_position,
        'Height': peak_height,
        'FWHM': fwhm,
        'L/G': 0.00,
        'Area': area,
        'Sigma': 0,
        'Gamma': 0,
        'Skew': 0,
        'Fitting Model': "Unfitted",
        'Bkg Type': method,
        'Bkg Low': range_min,
        'Bkg High': range_max,
        'Constraints': _fixed_constraints(),
    }

    select_sheet(w, sheet_name)
    index = list(cl['Fitting']['Peaks']).index(area_name)
    out = {
        'sheet': sheet_name, 'name': area_name, 'row': index * 2, 'index': index,
        'area': area, 'position': peak_position, 'height': peak_height, 'fwhm': fwhm,
        'method': method, 'low': float(range_min), 'high': float(range_max), 'points': npts,
        'replaced': existing_row >= 0, 'survey': is_survey,
    }
    if warning:
        out['warning'] = warning
    return out


def extract_column_type(sheet_name):
    """BackgroundWindow.extract_column_type: 'C1s2' -> 'C1s'."""
    if not sheet_name:
        return ""
    cleaned_name = sheet_name.strip()
    match = re.match(r'^([A-Z][a-z]?\d+[a-z]*)(?:\d+)?.*', cleaned_name)
    if match:
        return match.group(1)
    for sep in ['_', ' ', '-', '.']:
        if sep in cleaned_name:
            first_part = cleaned_name.split(sep)[0]
            if re.match(r'^[A-Z][a-z]?\d+[a-z]*\d*$', first_part):
                m = re.match(r'^([A-Z][a-z]?\d+[a-z]*)', first_part)
                if m:
                    return m.group(1)
            break
    m = re.search(r'([A-Z][a-z]?\d+[a-z]*)', cleaned_name)
    if m:
        return m.group(1)
    return cleaned_name[:4] if len(cleaned_name) > 4 else cleaned_name


def _create_area_for_sheet(w, sheet_name, bkg_type, bkg_low, bkg_high, offset_h, offset_l,
                           original_peak_name=None):
    """BackgroundWindow.create_area_for_sheet (the sheet is already selected)."""
    try:
        cl = w.Data['Core levels'].get(sheet_name)
        if cl is None or 'B.E.' not in cl or 'Raw Data' not in cl:
            return False
        w.background_method = bkg_type
        w.offset_h = offset_h
        w.offset_l = offset_l
        w.bg_min_energy = bkg_low
        w.bg_max_energy = bkg_high
        bg = cl.setdefault('Background', {})
        bg['Bkg Type'] = bkg_type
        bg['Bkg Low'] = float(bkg_low)
        bg['Bkg High'] = float(bkg_high)
        bg['Bkg Offset Low'] = float(offset_l)
        bg['Bkg Offset High'] = float(offset_h)
        x_values = np.array(cl['B.E.'], dtype=float)
        y_values = np.array(cl['Raw Data'], dtype=float)
        # plot_background with no limit lines on screen (plot_data cleared them):
        # the region comes from Bkg Low/High; Bkg Low/High are then rewritten
        # with the whole data range, as on the desktop.
        _plot_background(w, sheet_name, None)
        background = np.array(bg['Bkg Y'], dtype=float)
        mask = (x_values >= bkg_low) & (x_values <= bkg_high)
        if mask.sum() < 3:
            return False
        area, peak_position, peak_height, fwhm, _ = _measure(x_values, y_values, background,
                                                             bkg_low, bkg_high)
        grid = w.peak_params_grid
        num_peaks = grid.GetNumberRows() // 2
        area_name = original_peak_name or f"{sheet_name} p{num_peaks + 1}"
        grid.AppendRows(2)
        row = num_peaks * 2
        s = grid.SetCellValue
        s(row, 0, chr(65 + num_peaks))
        s(row, 1, area_name)
        s(row, 2, f"{peak_position:.2f}")
        s(row, 3, f"{peak_height:.2f}")
        s(row, 4, f"{fwhm:.2f}")
        s(row, 5, "0.00")
        s(row, 6, f"{area:.2f}")
        s(row, 7, "0.00")
        s(row, 8, "0.00")
        s(row, 9, "0.00")
        s(row, 13, "Unfitted")
        s(row, 14, bkg_type)
        s(row, 15, f"{bkg_low:.2f}")
        s(row, 16, f"{bkg_high:.2f}")
        for col in range(2, 10):
            s(row + 1, col, "Fixed")
        if 'Fitting' not in cl or not isinstance(cl['Fitting'], dict):
            cl['Fitting'] = {}
        if 'Peaks' not in cl['Fitting']:
            cl['Fitting']['Peaks'] = {}
        cl['Fitting']['Peaks'][area_name] = {
            'Position': peak_position, 'Height': peak_height, 'FWHM': fwhm, 'L/G': 0.00,
            'Area': area, 'Sigma': 0.00, 'Gamma': 0.00, 'Skew': 0.00,
            'Fitting Model': "Unfitted", 'Bkg Type': bkg_type,
            'Bkg Low': bkg_low, 'Bkg High': bkg_high,
            'Constraints': _fixed_constraints(),
        }
        w.update_ratios()
        return True
    except Exception:
        return False


def area_batch(w, sheets=None, offset_low=0.0, offset_high=0.0):
    """Batching tab, "Propagate/Prop. Area to Column" (on_propagate_area).

    Every row of the current sheet's peak table that has a background type and
    range (columns Bkg Type / Low / High) is re-created as an 'Unfitted' area,
    with the same name, method and range, on each ticked sheet (sheets; None =
    all, the window's default) of the same core-level type (C1s, C1s2... ->
    'C1s'). Each target sheet's peaks are removed first; its background is
    recomputed region by region. offset_low/offset_high are the Measure Area
    tab's offsets. The current sheet is restored afterwards.
    """
    from .sheets import select_sheet

    current = w.sheet_combobox.GetValue()
    if not current or current not in w.Data['Core levels']:
        raise ValueError("No core level selected")
    grid = w.peak_params_grid
    if grid.GetNumberRows() == 0:
        raise ValueError("No areas/peaks to propagate from current core level")
    to_copy = []
    for i in range(grid.GetNumberRows() // 2):
        row = i * 2
        bkg_type, lo, hi = _row_range(w, current, row, as_text=True)
        if not bkg_type or not lo or not hi:
            continue
        try:
            to_copy.append({'name': grid.GetCellValue(row, 1), 'bkg_type': bkg_type,
                            'bkg_low': float(lo), 'bkg_high': float(hi)})
        except ValueError:
            continue
    if not to_copy:
        raise ValueError("No valid peaks with background information found in current core level")

    if sheets is None:
        sheets = list(w.Data['Core levels'].keys())
    if not sheets:
        raise ValueError("No core levels selected for propagation")
    column = extract_column_type(current)
    targets, omitted = [], []
    for s in sheets:
        if s == current:
            continue
        (targets if extract_column_type(s) == column else omitted).append(s)
    if not targets:
        raise ValueError(f"No core levels of the same column type ({column}) are selected for propagation.")

    done, failed, total = [], [], 0
    oh, ol = float(offset_high), float(offset_low)
    try:
        for target in targets:
            try:
                select_sheet(w, target)
                # clear_all_peaks_from_sheet
                if grid.GetNumberRows() > 0:
                    grid.DeleteRows(0, grid.GetNumberRows())
                tcl = w.Data['Core levels'].get(target, {})
                if isinstance(tcl.get('Fitting'), dict) and 'Peaks' in tcl['Fitting']:
                    tcl['Fitting']['Peaks'] = {}
                w.peak_count = 0
                made = 0
                for p in to_copy:
                    if _create_area_for_sheet(w, target, p['bkg_type'], p['bkg_low'], p['bkg_high'],
                                              oh, ol, p['name']):
                        made += 1
                total += made
                (done if made > 0 else failed).append(target)
            except Exception:
                failed.append(target)
    finally:
        select_sheet(w, current)
    return {'done': done, 'skipped': failed + omitted, 'failed': failed, 'omitted': omitted,
            'areas': [p['name'] for p in to_copy], 'areas_created': total, 'column': column}


def area_fills(w, sheet=None):
    """What the main plot draws for the 'Unfitted' rows of a sheet
    (PlotManager.clear_and_replot): the region between the background and the
    data, from the row's Bkg Low to Bkg High, in the row's peak colour
    (peak_colors[i]) at alpha 0.5, labelled with the area name. x is binding
    energy; points outside the range are None. Also says whether the envelope
    and residuals are drawn (not when any row is Unfitted/D-parameter/...)."""
    sheet = sheet or w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'].get(sheet)
    if not cl or 'B.E.' not in cl:
        return None
    fitting = cl.get('Fitting')
    peaks = fitting.get('Peaks') if isinstance(fitting, dict) else None
    if not peaks:
        return None
    x = np.array(cl['B.E.'], dtype=float)
    y = np.array(cl['Raw Data'], dtype=float)
    bkg = cl.get('Background', {}).get('Bkg Y') or cl['Raw Data']
    bkg = np.array(bkg, dtype=float)
    fills = []
    special = False
    for i, (label, p) in enumerate(peaks.items()):
        model = p.get('Fitting Model') if isinstance(p, dict) else None
        if model in ("Unfitted", "D-parameter", "Fermi", "VBM", "Cut-Off", "SurveyID", "Curie-Weiss",
                     "Equivalent Circuit"):
            special = True
        if model != "Unfitted":
            continue
        try:
            lo, hi = float(p.get('Bkg Low', 0)), float(p.get('Bkg High', 0))
        except (TypeError, ValueError):
            continue
        m = (x >= lo) & (x <= hi)
        if len(bkg) != len(x):
            continue
        fills.append({
            'label': label, 'peak_index': i, 'low': lo, 'high': hi, 'area': p.get('Area'),
            'x': [float(v) if k else None for v, k in zip(x, m)],
            'y': [float(v) if k else None for v, k in zip(y, m)],
            'bkg': [float(v) if k else None for v, k in zip(bkg, m)],
        })
    survey = any(t in sheet.lower() for t in ("survey", "wide"))
    return {'fills': fills, 'envelope': not (special or survey)}
