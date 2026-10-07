# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the "Background" button of the fitting window
# (Fitting_Screen.on_background → PlotManager.plot_background and
# _calculate_other_background → record_current_range) and the two
# "Clear" buttons. The calculations are BackgroundCalculations, unchanged.

import numpy as np

from .backgrounds import BackgroundCalculations

#: The methods of the desktop's background list (normal mode).
METHODS = ["Smart", "Shirley", "Linear", "Offset", "U4-Tougaard", "U2-Tougaard",
           "Active Shirley", "Active Tougaard", "ALS-Raman", "Arctan-XAS"]


def _calculate_other_background(window, x_values, y_values, method, offset_h, offset_l):
    """PlotManager._calculate_other_background (the vlines are window.vlines)."""
    sheet_name = window.sheet_combobox.GetValue()
    bg = window.Data['Core levels'][sheet_name]['Background']

    if window.vlines is not None:
        bg_min_energy = min(window.vlines)
        bg_max_energy = max(window.vlines)
        data_min = min(x_values)
        data_max = max(x_values)
        bg_min_energy = max(bg_min_energy, data_min)
        bg_max_energy = min(bg_max_energy, data_max)
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
    x_values_filtered = x_values[mask]
    y_values_filtered = y_values[mask]
    if len(x_values_filtered) < 2:
        mask = np.zeros(len(x_values), dtype=bool)
        mask[0] = True
        mask[-1] = True
        x_values_filtered = x_values[mask]
        y_values_filtered = y_values[mask]

    averaging_points = getattr(window, 'averaging_points', 5)
    B = BackgroundCalculations

    if method == "Shirley":
        background_filtered = B.calculate_shirley_background(x_values_filtered, y_values_filtered, offset_h,
                                                             offset_l, num_points=averaging_points)
    elif method == "Linear":
        background_filtered = B.calculate_linear_background(x_values_filtered, y_values_filtered, offset_h,
                                                            offset_l, num_points=averaging_points)
    elif method in ["Smart", "Multi-Regions Smart", "Multiple Regions Smart"]:
        background_filtered = B.calculate_smart_background(x_values_filtered, y_values_filtered, offset_h,
                                                           offset_l, num_points=averaging_points)
    elif method == "Offset":
        background_filtered = B.calculate_offset_background(x_values_filtered, y_values_filtered, offset_h,
                                                            offset_l)
    elif method == "U4-Tougaard":
        background_filtered = B.calculate_tougaard_background(x_values_filtered, y_values_filtered,
                                                              sheet_name, window)
    elif method == "U2-Tougaard":
        background_filtered = B.calculate_u2_tougaard_background(x_values_filtered, y_values_filtered,
                                                                 sheet_name, window)
    elif method == "2x U4-Tougaard":
        background_filtered = B.calculate_double_tougaard_background(x_values_filtered, y_values_filtered,
                                                                     sheet_name, window)
    elif method == "3x U4-Tougaard":
        background_filtered = B.calculate_triple_tougaard_background(x_values_filtered, y_values_filtered,
                                                                     sheet_name, window)
    elif method == "Arctan-XAS":
        background_filtered = B.calculate_arctan_background(x_values_filtered, y_values_filtered, offset_h,
                                                            offset_l, num_points=averaging_points)
    elif method == "ALS-Raman":
        background_filtered = B.calculate_als_background_spectral(x_values_filtered, y_values_filtered,
                                                                  lambda_val=1e5, p=0.001)
    elif method == "Active Shirley":
        stored_k = bg.get('Active_Shirley_k', None)
        stored_const_base = bg.get('Active_Shirley_const_base', None)
        if stored_k is not None and stored_const_base is not None:
            new_const = stored_const_base + offset_l
            dx = np.abs(np.mean(np.diff(x_values_filtered))) if len(x_values_filtered) > 1 else 1
            y_above_const = np.maximum(y_values_filtered - new_const, 0)
            cumulative_integral = np.cumsum(y_above_const[::-1])[::-1] * dx
            cumulative_integral = np.roll(cumulative_integral, -1)
            cumulative_integral[-1] = 0
            background_filtered = new_const + stored_k * cumulative_integral
        else:
            background_filtered = B.calculate_active_shirley_background(
                x_values_filtered, y_values_filtered, offset_h, offset_l, num_points=averaging_points)
    elif method == "Active Tougaard":
        stored_B = bg.get('Active_Tougaard_B', None)
        if stored_B is not None:
            C = float(bg.get('Tougaard_C', 1643))
            base_baseline = B.calculate_endpoint_average(
                x_values_filtered, y_values_filtered, x_values_filtered[-1], averaging_points)
            baseline = base_baseline + offset_l
            y_shifted = np.maximum(y_values_filtered - baseline, 0)
            dx = np.abs(np.mean(np.diff(x_values_filtered)))
            n = len(x_values_filtered)
            out = np.zeros(n, dtype=float)
            for i in range(n - 1):
                T = np.abs(x_values_filtered[i + 1:] - x_values_filtered[i])
                K = stored_B * T / ((C + T ** 2) ** 2)
                out[i] = np.sum(K * y_shifted[i + 1:]) * dx
            background_filtered = out + baseline
        else:
            background_filtered = B.calculate_active_tougaard_background(
                x_values_filtered, y_values_filtered, offset_h, offset_l, num_points=averaging_points)
    else:
        background_filtered = B.calculate_smart_background(x_values_filtered, y_values_filtered, offset_h,
                                                           offset_l)

    new_background = np.array(bg['Bkg Y'], dtype=float)
    new_background[mask] = background_filtered
    return new_background


def apply_background(window, method, low, high, offset_h=0.0, offset_l=0.0, record='append'):
    """Fitting_Screen.on_background: compute the background between the two
    limits (binding energies) and store it in Data, as the desktop does.

    record: 'append' adds the region to the recorded ones (the desktop's
    multi-region backgrounds), 'replace' makes it the only one, '' keeps them.
    """
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'][sheet_name]
    if method not in METHODS and method not in ("2x U4-Tougaard", "3x U4-Tougaard"):
        method = "Smart"
    window.background_method = method
    window.offset_h = float(offset_h)
    window.offset_l = float(offset_l)
    window.vlines = (float(low), float(high))
    window.bg_min_energy = min(window.vlines)
    window.bg_max_energy = max(window.vlines)

    bg = cl.setdefault('Background', {})
    bg['Bkg Low'] = window.bg_min_energy
    bg['Bkg High'] = window.bg_max_energy
    bg['Method'] = method

    # PlotManager.plot_background
    x_values = np.array(cl['B.E.'], dtype=float)
    y_values = np.array(cl['Raw Data'], dtype=float)
    if 'Bkg Y' not in bg or not bg['Bkg Y']:
        bg['Bkg Y'] = y_values.tolist()
    background = _calculate_other_background(window, x_values, y_values, method,
                                              window.offset_h, window.offset_l)
    bg.update({
        'Bkg Y': background.tolist(),
        'Bkg Type': method,
        'Bkg Low': round(min(window.vlines), 2),
        'Bkg High': round(max(window.vlines), 2),
        'Bkg Offset Low': window.offset_l,
        'Bkg Offset High': window.offset_h,
        'Bkg X': x_values.tolist(),
    })
    window.background = background

    # update_all_peaks_background_info, then record_current_range
    if record:
        ranges = list(bg.get('Recorded_Ranges') or []) if record == 'append' else []
        ranges.append((window.offset_h, window.offset_l, window.bg_min_energy, window.bg_max_energy))
        bg['Recorded_Ranges'] = ranges
    overall_low, overall_high = window.fitting_window.get_overall_background_range()
    grid = window.peak_params_grid
    for i in range(grid.GetNumberRows() // 2):
        grid.SetCellValue(i * 2, 14, method)
        grid.SetCellValue(i * 2, 15, f"{overall_low:.2f}")
        grid.SetCellValue(i * 2, 16, f"{overall_high:.2f}")
    fitting = cl.get('Fitting')
    if isinstance(fitting, dict):
        for peak in fitting.get('Peaks', {}).values():
            peak['Bkg Type'] = method
            peak['Bkg Low'] = overall_low
            peak['Bkg High'] = overall_high
    window.load_view()


def clear_background(window):
    """Fitting_Screen "Clear All": background back to the data, peaks removed."""
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'][sheet_name]
    x_values = cl['B.E.']
    y_values = cl['Raw Data']
    bg = cl.setdefault('Background', {})
    bg['Bkg X'] = list(x_values)
    bg['Bkg Y'] = list(y_values)
    bg.update({'Bkg Type': '', 'Bkg Low': '', 'Bkg High': '', 'Bkg Offset Low': '', 'Bkg Offset High': ''})
    bg['Recorded_Ranges'] = []
    grid = window.peak_params_grid
    grid.DeleteRows(0, grid.GetNumberRows())
    window.peak_count = 0
    window.selected_peak_index = None
    if 'Fitting' in cl:
        cl['Fitting'] = {}
    window.offset_l = 0
    window.offset_h = 0
    window.vlines = None
    window.bg_min_energy = window.bg_max_energy = None
    window.fit_results = None
    window.load_view()


def clear_background_only(window):
    """PlotManager.clear_background_only: keep the peaks, drop the background."""
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'][sheet_name]
    raw_data = cl['Raw Data']
    cl['Background'] = {
        'Bkg Type': '', 'Bkg Low': None, 'Bkg High': None,
        'Bkg Offset Low': 0, 'Bkg Offset High': 0,
        'Bkg Y': list(raw_data),
    }
    window.vlines = None
    window.bg_min_energy = window.bg_max_energy = None
    window.offset_l = 0
    window.offset_h = 0
    window.load_view()
