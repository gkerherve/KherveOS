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
# Synced with KherveFitting-AI (dev-AI v1.93): the new methods (Iterated
# Shirley, Spline Shirley/Tougaard, Poly-2/3, ALS, Power-EELS), the Active
# Shirley replay, and the fitting window's fit drivers (on_fit_peaks /
# on_fit_multi, with the Active Shirley / Active Tougaard / Iterated Shirley
# background recomputed from the fitted peaks): fit_once, fit_until_stable.

import numpy as np

from .backgrounds import BackgroundCalculations

#: The methods of the desktop's background list (normal mode, dev-AI), without
#: the "-----" separators.
METHODS = ["Smart", "Shirley", "Iterated Shirley", "Linear", "Offset", "U4-Tougaard", "U2-Tougaard",
           "Spline Shirley", "Spline Tougaard", "Active Shirley", "Active Tougaard",
           "Poly-2", "Poly-3", "ALS", "ALS-Raman", "Arctan-XAS", "Power-EELS"]


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
    elif method == "Iterated Shirley":
        background_filtered = B.calculate_iterated_shirley_background(
            x_values_filtered, y_values_filtered, offset_h, offset_l, iterations=averaging_points)
    elif method == "Spline Shirley":
        init_bg = B.calculate_shirley_background(x_values_filtered, y_values_filtered, offset_h,
                                                 offset_l, num_points=averaging_points)
        background_filtered = B.calculate_spline_background(
            x_values_filtered, y_values_filtered, init_bg, offset_h, offset_l, num_points=averaging_points)
    elif method == "Spline Tougaard":
        init_bg = B.calculate_tougaard_background(x_values_filtered, y_values_filtered, sheet_name, window)
        background_filtered = B.calculate_spline_background(
            x_values_filtered, y_values_filtered, init_bg, offset_h, offset_l, num_points=averaging_points)
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
    elif method == "Poly-2":
        background_filtered = B.calculate_polynomial_background(
            x_values_filtered, y_values_filtered, order=2, start_offset=offset_h,
            end_offset=offset_l, num_points=averaging_points)
    elif method == "Poly-3":
        background_filtered = B.calculate_polynomial_background(
            x_values_filtered, y_values_filtered, order=3, start_offset=offset_h,
            end_offset=offset_l, num_points=averaging_points)
    elif method == "ALS":
        background_filtered = B.calculate_als_baseline(
            x_values_filtered, y_values_filtered, start_offset=offset_h,
            end_offset=offset_l, num_points=averaging_points)
    elif method == "Arctan-XAS":
        background_filtered = B.calculate_arctan_background(x_values_filtered, y_values_filtered, offset_h,
                                                            offset_l, num_points=averaging_points)
    elif method == "Power-EELS":
        background_filtered = B.calculate_power_eels_background(
            x_values_filtered, y_values_filtered, sheet_name, window, num_points=averaging_points)
    elif method == "ALS-Raman":
        # The Raman model window's λ and p (window.als_lambda / window.als_p here)
        background_filtered = B.calculate_als_background_spectral(
            x_values_filtered, y_values_filtered,
            lambda_val=float(getattr(window, 'als_lambda', 1e5)), p=float(getattr(window, 'als_p', 0.001)))
    elif method == "Active Shirley":
        stored_k = bg.get('Active_Shirley_k', None)
        stored_const_base = bg.get('Active_Shirley_const_base', None)
        if stored_k is not None and stored_const_base is not None:
            new_const = stored_const_base + offset_l
            # peaks = data above the background itself (see calculate_active_shirley_replay)
            background_filtered = B.calculate_active_shirley_replay(
                x_values_filtered, y_values_filtered, stored_k, new_const)
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


def apply_background(window, method, low, high, offset_h=0.0, offset_l=0.0, record='append',
                     power_eels_window=None, smooth=False):
    """Fitting_Screen.on_background: compute the background between the two
    limits (binding energies) and store it in Data, as the desktop does.

    record: 'append' adds the region to the recorded ones (the desktop's
    multi-region backgrounds), 'replace' makes it the only one, '' keeps them.
    power_eels_window: the Power-EELS pre-edge fit window in eV (0 = auto),
    the one number the desktop's parameter box takes for that method.
    """
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'][sheet_name]
    if method not in METHODS and method not in ("2x U4-Tougaard", "3x U4-Tougaard"):
        method = "Smart"
    # Active Tougaard only supports a single region (dev-AI on_background)
    if method == "Active Tougaard" and record == 'append' and \
            (cl.get('Background', {}) or {}).get('Recorded_Ranges'):
        raise ValueError("Active Tougaard only supports a single region. "
                         "Remove the existing region first to create a new one.")
    if power_eels_window is not None:
        try:
            cl.setdefault('Background', {})['Power_EELS_Window'] = float(f"{float(power_eels_window):.2f}")
        except (TypeError, ValueError):
            pass
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
    # "Smooth noisy data" (plot_background(use_smoothing)): gaussian_filter1d(sigma=5) for the calculation
    y_calc = y_values
    if smooth:
        from scipy.ndimage import gaussian_filter1d
        y_calc = gaussian_filter1d(y_values, sigma=5)
    background = _calculate_other_background(window, x_values, y_calc, method,
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


# ── Backgrounds recomputed from the fitted peaks (Fitting_Screen, dev-AI) ──
def apply_iterated_shirley_from_fit(window, bg_range=None):
    """Fitting_Screen.apply_iterated_shirley_from_fit: recalculate the Iterated
    Shirley background of the current sheet from the fitted peak envelope,
    each Recorded_Range on its own."""
    try:
        sheet_name = window.sheet_combobox.GetValue()
        if sheet_name not in window.Data['Core levels']:
            return

        core_level_data = window.Data['Core levels'][sheet_name]
        x_values = np.array(core_level_data['B.E.'])
        y_raw = np.array(core_level_data['Raw Data'])

        if bg_range is None:
            bg_range = (core_level_data['Background'].get('Bkg Low', min(x_values)),
                        core_level_data['Background'].get('Bkg High', max(x_values)))
        try:
            bg_min, bg_max = float(bg_range[0]), float(bg_range[1])
        except (ValueError, TypeError):
            bg_min, bg_max = min(x_values), max(x_values)

        full_mask = (x_values >= min(bg_min, bg_max)) & (x_values <= max(bg_min, bg_max))
        x_full = x_values[full_mask]
        y_raw_full = y_raw[full_mask]

        fit_results = getattr(window, 'fit_results', None)
        if not fit_results or fit_results.get('result') is None:
            return
        y_peaks_full = np.asarray(fit_results['result'].best_fit)
        if len(y_peaks_full) != len(x_full):
            return

        iterations = getattr(window, 'averaging_points', 5)
        num_points = 5

        current_background = np.array(core_level_data['Background']['Bkg Y'])
        recorded_ranges = core_level_data['Background'].get('Recorded_Ranges', [])

        if not recorded_ranges:
            offset_h = float(core_level_data['Background'].get('Bkg Offset High', 0))
            offset_l = float(core_level_data['Background'].get('Bkg Offset Low', 0))
            current_background[full_mask] = BackgroundCalculations.calculate_iterated_shirley_from_peaks(
                x_full, y_raw_full, y_peaks_full, iterations=iterations,
                num_points=num_points, offset_h=offset_h, offset_l=offset_l)
        else:
            for range_entry in recorded_ranges:
                offset_h = float(range_entry[0])
                offset_l = float(range_entry[1])
                min_r = float(range_entry[2])
                max_r = float(range_entry[3])

                region_mask = (x_values >= min(min_r, max_r)) & (x_values <= max(min_r, max_r))
                region_in_full = region_mask[full_mask]
                x_region = x_full[region_in_full]

                if len(x_region) < 3 or int(np.sum(region_mask)) != len(x_region):
                    continue

                current_background[region_mask] = BackgroundCalculations.calculate_iterated_shirley_from_peaks(
                    x_region, y_raw_full[region_in_full], y_peaks_full[region_in_full],
                    iterations=iterations, num_points=num_points,
                    offset_h=offset_h, offset_l=offset_l)

        core_level_data['Background']['Bkg Y'] = current_background.tolist()
        window.background = current_background

    except Exception as e:
        print(f"Error updating Iterated Shirley background: {e}")


def update_active_shirley_background(window):
    """Fitting_Screen.update_active_shirley_background: the Active Shirley
    background from the fitted peaks, each Recorded_Range on its own."""
    try:
        sheet_name = window.sheet_combobox.GetValue()
        if sheet_name not in window.Data['Core levels']:
            return

        core_level_data = window.Data['Core levels'][sheet_name]
        x_values = np.array(core_level_data['B.E.'])
        y_raw = np.array(core_level_data['Raw Data'])

        bg_min, bg_max = window.fitting_window.get_overall_background_range()
        try:
            bg_min = float(bg_min)
            bg_max = float(bg_max)
        except (ValueError, TypeError):
            bg_min = min(x_values)
            bg_max = max(x_values)

        full_mask = (x_values >= min(bg_min, bg_max)) & (x_values <= max(bg_min, bg_max))
        x_full = x_values[full_mask]
        y_raw_full = y_raw[full_mask]

        if getattr(window, 'fit_results', None) is not None:
            if 'result' in window.fit_results and window.fit_results['result'] is not None:
                y_peaks_full = window.fit_results['result'].best_fit
            else:
                return
        else:
            return

        num_points = int(getattr(window, 'averaging_points', 5))
        current_background = np.array(core_level_data['Background']['Bkg Y'])
        recorded_ranges = core_level_data['Background'].get('Recorded_Ranges', [])

        if not recorded_ranges:
            offset_h = float(core_level_data['Background'].get('Bkg Offset High', 0))
            offset_l = float(core_level_data['Background'].get('Bkg Offset Low', 0))
            new_bg, k, const = BackgroundCalculations.calculate_active_shirley_from_peaks(
                x_full, y_raw_full, y_peaks_full, k=None, num_points=num_points,
                offset_h=offset_h, offset_l=offset_l)
            current_background[full_mask] = new_bg
            core_level_data['Background']['Active_Shirley_k'] = float(f"{k:.6f}")
            core_level_data['Background']['Active_Shirley_const'] = float(f"{const:.2f}")
            core_level_data['Background']['Active_Shirley_const_base'] = float(f"{const - offset_l:.2f}")
            core_level_data['Background']['Active_Shirley_params'] = [[float(f"{k:.6f}"), float(f"{const:.2f}")]]
        else:
            per_range_params = []
            for range_entry in recorded_ranges:
                offset_h = float(range_entry[0])
                offset_l = float(range_entry[1])
                min_r = float(range_entry[2])
                max_r = float(range_entry[3])

                region_mask = (x_values >= min(min_r, max_r)) & (x_values <= max(min_r, max_r))
                region_in_full = region_mask[full_mask]
                x_region = x_full[region_in_full]
                y_raw_region = y_raw_full[region_in_full]
                y_peaks_region = y_peaks_full[region_in_full]

                if len(x_region) < 3:
                    per_range_params.append([0.0, 0.0])
                    continue

                new_bg_region, k, const = BackgroundCalculations.calculate_active_shirley_from_peaks(
                    x_region, y_raw_region, y_peaks_region, k=None, num_points=num_points,
                    offset_h=offset_h, offset_l=offset_l)
                current_background[region_mask] = new_bg_region
                per_range_params.append([float(f"{k:.6f}"), float(f"{const:.2f}")])

            core_level_data['Background']['Active_Shirley_params'] = per_range_params
            if per_range_params:
                core_level_data['Background']['Active_Shirley_k'] = per_range_params[0][0]
                core_level_data['Background']['Active_Shirley_const'] = per_range_params[0][1]

        core_level_data['Background']['Bkg Y'] = current_background.tolist()
        window.background = current_background

    except Exception as e:
        print(f"Error updating Active Shirley background: {e}")


def update_active_tougaard_background(window):
    """Fitting_Screen.update_active_tougaard_background: the Tougaard
    background from the fitted peak envelope (B fitted, C kept)."""
    try:
        sheet_name = window.sheet_combobox.GetValue()
        if sheet_name not in window.Data['Core levels']:
            return

        core_level_data = window.Data['Core levels'][sheet_name]
        x_values = np.array(core_level_data['B.E.'])
        y_raw = np.array(core_level_data['Raw Data'])

        bg_min, bg_max = window.fitting_window.get_overall_background_range()
        try:
            bg_min = float(bg_min)
            bg_max = float(bg_max)
        except (ValueError, TypeError):
            bg_min = min(x_values)
            bg_max = max(x_values)

        mask = (x_values >= bg_min) & (x_values <= bg_max)
        x_filtered = x_values[mask]
        y_raw_filtered = y_raw[mask]

        if getattr(window, 'fit_results', None) is not None:
            if 'result' in window.fit_results and window.fit_results['result'] is not None:
                y_peaks_filtered = window.fit_results['result'].best_fit
            else:
                return
        else:
            return

        num_points = int(getattr(window, 'averaging_points', 5))
        offset_h = float(core_level_data['Background'].get('Bkg Offset High', 0))
        offset_l = float(core_level_data['Background'].get('Bkg Offset Low', 0))
        C = float(core_level_data['Background'].get('Tougaard_C', 1643))

        new_bg_filtered, B = BackgroundCalculations.calculate_active_tougaard_from_peaks(
            x_filtered, y_raw_filtered, y_peaks_filtered,
            B=None, C=C, num_points=num_points,
            offset_h=offset_h, offset_l=offset_l
        )

        current_background = np.array(core_level_data['Background']['Bkg Y'])
        current_background[mask] = new_bg_filtered

        core_level_data['Background']['Bkg Y'] = current_background.tolist()
        core_level_data['Background']['Active_Tougaard_B'] = float(f"{B:.2f}")
        core_level_data['Background']['Active_Tougaard_offset_l'] = float(f"{offset_l:.2f}")

        window.background = current_background

    except Exception as e:
        print(f"Error updating Active Tougaard background: {e}")


def _fit_background_method(window):
    """The sheet's background method, as the fit drivers read it."""
    sheet_name = window.sheet_combobox.GetValue()
    if sheet_name in window.Data['Core levels']:
        bg_data = window.Data['Core levels'][sheet_name].get('Background', {})
        return bg_data.get('Method', window.background_method)
    return None


def update_background_after_fit(window, bg_method=None):
    """Recompute the Active Shirley / Active Tougaard / Iterated Shirley
    background from the last fit (nothing for the other methods).
    Returns True when the background changed."""
    bg_method = bg_method or _fit_background_method(window)
    if getattr(window, 'fit_results', None) is None:
        return False
    if bg_method == "Active Shirley":
        update_active_shirley_background(window)
    elif bg_method == "Active Tougaard":
        update_active_tougaard_background(window)
    elif bg_method == "Iterated Shirley":
        apply_iterated_shirley_from_fit(window, window.fitting_window.get_overall_background_range())
    else:
        return False
    return True


# ── The fitting window's Fit buttons (Fitting_Screen, dev-AI) ────────────
def fit_once(window):
    """Fitting_Screen.on_fit_peaks: one fit, then (Active Shirley, Active
    Tougaard, Iterated Shirley) the background recomputed from the fitted
    peaks. Returns (r_squared, chi, red_chi_square) or None."""
    from .fitting import fit_peaks
    result = fit_peaks(window, window.peak_params_grid)
    if result:
        update_background_after_fit(window)
        window.load_view()
        return result
    return None


def fit_until_stable(window, stable_target=6, max_passes=40, on_pass=None):
    """Fitting_Screen.on_fit_multi: fit again and again with the adaptive
    max_nfev control until chi has not risen (1 % tolerance) for
    ``stable_target`` passes. Chi rising -> max_nfev x0.7 (not below 30);
    three stable passes in a row -> x1.3 (not above the set maximum). The
    Active Shirley / Active Tougaard / Iterated Shirley background is
    recomputed between passes. window.max_iterations is restored at the end.

    The desktop loop runs until stable or until Stop is pressed; here
    ``max_passes`` caps it, and ``on_pass(entry)`` returning False stops it.
    Returns one dict per pass: {pass, chi, r2, redChi, nfev, maxNfev, stable}.
    """
    from .fitting import fit_peaks
    stable_target = max(1, int(stable_target))
    bg_method = _fit_background_method(window)
    original_max_nfev = window.max_iterations
    current_max_nfev = float(original_max_nfev)
    min_nfev = 30
    chi_history = []
    stable_streak = 0
    iteration = 0
    log = []
    try:
        while iteration < max_passes:
            iteration += 1
            window.max_iterations = int(current_max_nfev)
            used_nfev = window.max_iterations
            result = fit_peaks(window, window.peak_params_grid)
            stop = False      # Stop button: after this pass's background update
            if result:
                r_squared, rsd, red_chi_square = result
                chi_history.append(rsd)
                if len(chi_history) >= 2:
                    prev = chi_history[-2]
                    curr = chi_history[-1]
                    tolerance = prev * 0.01
                    if curr > prev + tolerance:
                        current_max_nfev = max(current_max_nfev * 0.7, min_nfev)
                        stable_streak = 0
                    else:
                        stable_streak += 1
                        if stable_streak >= 3:
                            current_max_nfev = min(current_max_nfev * 1.3, original_max_nfev)
                entry = {'pass': iteration, 'chi': float(rsd), 'r2': float(r_squared),
                         'redChi': float(red_chi_square),
                         'nfev': int((window.fit_results or {}).get('nfev', 0) or 0),
                         'maxNfev': int(used_nfev), 'stable': stable_streak}
                log.append(entry)
                if on_pass is not None and on_pass(entry) is False:
                    stop = True
                # Stable: the desktop leaves the loop before the background update
                if stable_streak >= stable_target:
                    break
            update_background_after_fit(window, bg_method)
            if stop:
                break
    finally:
        window.max_iterations = original_max_nfev
        window.load_view()
    return log
