# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: what the mouse and the keyboard do to the data on the
# desktop (KherveFitting-AI dev-AI v1.93), without wx:
#   - the red background lines (On_Mouse_Defs.on_release / on_click with
#     Shift, Fitting_Screen.on_min/max_range_change, on_offset_h/l_change,
#     on_range_box_click, update_active_region_positions,
#     update_peak_fitting_grid_background_data) - the regions are redrawn
#     with fitops.redraw_all_regions_background as on the desktop;
#   - the selected peak (On_Key_Defs Alt+arrows / Alt+Shift+arrows,
#     On_Mouse_Defs.on_mouse_wheel, MyFrame.update_peak_fwhm for Shift+drag,
#     update_linked_peak_fwhm / update_linked_fwhm_recursive);
#   - the peak table's right-click menu (On_Mouse_Defs.add_peak_with_model,
#     insert_cross_core_constraint, Utilities.propagate_fwhm_difference).
# The page sends the line positions and the mouse position; everything else is
# the desktop's own code, with self.window -> window.

import re

import numpy as np

from .numberformat import format_intensity, round_sig

VOIGT_SIGMA = ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)", "Voigt (Area, L/G, σ, S)"]


def _f(window, row, col, default=None):
    try:
        return float(window.peak_params_grid.GetCellValue(row, col))
    except (TypeError, ValueError):
        if default is None:
            raise
        return default


def _sheet(window):
    return window.sheet_combobox.GetValue()


def _peaks(window):
    cl = window.Data['Core levels'].get(_sheet(window), {})
    fitting = cl.get('Fitting')
    return fitting.get('Peaks', {}) if isinstance(fitting, dict) else {}


def sync_peaks_from_grid(window):
    """The peak table is what the desktop draws and fits; keep Data's peaks
    (what a sheet change, a save or a fit reads back) in step with it."""
    peaks = _peaks(window)
    if not peaks:
        return
    keys = list(peaks.keys())
    grid = window.peak_params_grid
    cols = {'Position': 2, 'Height': 3, 'FWHM': 4, 'L/G': 5, 'Area': 6, 'Sigma': 7, 'Gamma': 8, 'Skew': 9}
    for i in range(grid.GetNumberRows() // 2):
        label = grid.GetCellValue(i * 2, 1)
        key = label if label in peaks else (keys[i] if i < len(keys) else None)
        if key is None:
            continue
        for name, col in cols.items():
            try:
                peaks[key][name] = float(grid.GetCellValue(i * 2, col))
            except (TypeError, ValueError):
                pass


# ── Background lines and regions (Fitting window, BKG tab) ───────────────
def _ranges(window):
    return window.fitting_window.get_recorded_ranges_from_data()


def _set_ranges(window, ranges):
    cl = window.Data['Core levels'][_sheet(window)]
    cl.setdefault('Background', {})['Recorded_Ranges'] = [tuple(r) for r in ranges]


def update_window_data_background_range(window):
    """FittingWindow.update_window_data_background_range."""
    cl = window.Data['Core levels'].get(_sheet(window))
    if cl is None:
        return
    overall_min, overall_max = window.fitting_window.get_overall_background_range()
    bg = cl.setdefault('Background', {})
    bg['Bkg Low'] = overall_min
    bg['Bkg High'] = overall_max
    window.bg_min_energy = overall_min
    window.bg_max_energy = overall_max


def update_peak_fitting_grid_background_data(window, offset_h, offset_l):
    """FittingWindow.update_peak_fitting_grid_background_data (offset_h/l: the
    two Offset fields)."""
    grid = window.peak_params_grid
    if grid.GetNumberRows() <= 0:
        return
    overall_bg_low, overall_bg_high = window.fitting_window.get_overall_background_range()
    if overall_bg_low is None or overall_bg_high is None:
        return
    for i in range(grid.GetNumberRows() // 2):
        row = i * 2
        grid.SetCellValue(row, 14, window.background_method)
        grid.SetCellValue(row, 15, f"{overall_bg_low:.2f}")
        grid.SetCellValue(row, 16, f"{overall_bg_high:.2f}")
        grid.SetCellValue(row, 17, f"{offset_l:.2f}")
        grid.SetCellValue(row, 18, f"{offset_h:.2f}")
    for peak_data in _peaks(window).values():
        peak_data['Bkg Type'] = window.background_method
        peak_data['Bkg Low'] = float(overall_bg_low)
        peak_data['Bkg High'] = float(overall_bg_high)
        peak_data['Bkg Offset Low'] = float(offset_l)
        peak_data['Bkg Offset High'] = float(offset_h)


def _overall_to_peaks(window):
    """on_release: Bkg Type and the overall range into the Background and every peak."""
    cl = window.Data['Core levels'][_sheet(window)]
    bg = cl.setdefault('Background', {})
    if window.background_method:
        bg['Bkg Type'] = window.background_method
    low, high = window.fitting_window.get_overall_background_range()
    if low is None or high is None:
        return
    bg['Bkg Low'] = float(low)
    bg['Bkg High'] = float(high)
    peaks = _peaks(window)
    for peak_data in peaks.values():
        peak_data['Bkg Type'] = window.background_method
        peak_data['Bkg Low'] = float(low)
        peak_data['Bkg High'] = float(high)
    grid = window.peak_params_grid
    for i in range(grid.GetNumberRows() // 2):
        grid.SetCellValue(i * 2, 14, window.background_method)
        grid.SetCellValue(i * 2, 15, f"{low:.2f}")
        grid.SetCellValue(i * 2, 16, f"{high:.2f}")


def _redraw(window):
    from .fitops import redraw_all_regions_background
    redraw_all_regions_background(window)
    window.load_view()


def lines_released(window, low, high, active, offset_h, offset_l):
    """On_Mouse_Defs.on_release after dragging one red line (or both, Ctrl+drag):
    the lines are at [low, high]; with an active region its range follows
    them (update_active_region_positions) and every region is redrawn."""
    window.vlines = (float(min(low, high)), float(max(low, high)))
    ranges = list(_ranges(window))
    if active is not None and 0 <= int(active) < len(ranges):
        ranges[int(active)] = (float(offset_h), float(offset_l),
                               round(min(low, high), 2), round(max(low, high), 2))
        _set_ranges(window, ranges)
    if ranges:
        _overall_to_peaks(window)
        _redraw(window)
    else:
        # No region yet: the desktop only keeps the limits (Bkg Low / Bkg High).
        cl = window.Data['Core levels'][_sheet(window)]
        bg = cl.setdefault('Background', {})
        bg['Bkg Low'] = float(min(low, high))
        bg['Bkg High'] = float(max(low, high))
    sync_peaks_from_grid(window)


def range_fields(window, low, high, active, offset_h, offset_l):
    """FittingWindow.on_min_range_change / on_max_range_change (Region fields)."""
    window.vlines = (float(min(low, high)), float(max(low, high)))
    cl = window.Data['Core levels'][_sheet(window)]
    bg = cl.setdefault('Background', {})
    bg['Bkg Low'] = float(min(low, high))
    bg['Bkg High'] = float(max(low, high))
    update_peak_fitting_grid_background_data(window, offset_h, offset_l)
    ranges = list(_ranges(window))
    if active is not None and 0 <= int(active) < len(ranges):
        ranges[int(active)] = (float(offset_h), float(offset_l),
                               round(min(low, high), 2), round(max(low, high), 2))
        _set_ranges(window, ranges)
    if ranges:
        _redraw(window)
    sync_peaks_from_grid(window)


def set_offsets(window, offset_h, offset_l, active, redraw=True):
    """FittingWindow.on_offset_h_change / on_offset_l_change (and the Shift+click
    on the plot): offsets are never positive; the active region takes them and
    every region is redrawn."""
    offset_h = min(float(offset_h), 0.0)
    offset_l = min(float(offset_l), 0.0)
    window.offset_h = offset_h
    window.offset_l = offset_l
    cl = window.Data['Core levels'][_sheet(window)]
    bg = cl.setdefault('Background', {})
    bg['Bkg Offset Low'] = offset_l
    bg['Bkg Offset High'] = offset_h
    ranges = list(_ranges(window))
    if active is not None and 0 <= int(active) < len(ranges):
        o_h, o_l, lo, hi = ranges[int(active)][:4]
        ranges[int(active)] = (offset_h, offset_l, lo, hi)
        _set_ranges(window, ranges)
    update_peak_fitting_grid_background_data(window, offset_h, offset_l)
    if ranges and redraw:
        _redraw(window)
    sync_peaks_from_grid(window)


def select_region(window, index):
    """FittingWindow.on_range_box_click / on_reset_vlines2 (Tab): the lines go to
    the region; Data's Bkg Low / High become the overall range."""
    ranges = _ranges(window)
    if not ranges:
        return None
    index = int(index) % len(ranges)
    offset_h, offset_l, lo, hi = ranges[index][:4]
    window.vlines = (float(min(lo, hi)), float(max(lo, hi)))
    window.offset_h, window.offset_l = float(offset_h), float(offset_l)
    update_window_data_background_range(window)
    return index


# ── The selected peak: keys, wheel and Shift+drag ────────────────────────
def update_linked_peak_fwhm(window, peak_index, new_fwhm):
    """MyFrame.update_linked_peak_fwhm, unchanged."""
    self = window
    row = peak_index * 2
    constraint_row = row + 1
    model = self.peak_params_grid.GetCellValue(row, 13)

    new_sigma = None
    new_gamma = None
    new_linked_fwhm = None

    if model in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)"]:
        sigma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 7)
        current_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
        lg_ratio = float(self.peak_params_grid.GetCellValue(row, 5))

        if '*' in sigma_constraint:
            factor = float(sigma_constraint.split('*')[1].split('#')[0])
            new_sigma = current_sigma * factor
            new_gamma = (lg_ratio / 100 * new_sigma) / (1 - lg_ratio / 100)
            self.peak_params_grid.SetCellValue(row, 7, f"{new_sigma:.2f}")
            self.peak_params_grid.SetCellValue(row, 8, f"{new_gamma:.2f}")
    elif model in ["Voigt (Area, L/G, σ, S)"]:
        sigma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 7)
        current_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
        lg_ratio = float(self.peak_params_grid.GetCellValue(row, 5))

        if '*' in sigma_constraint:
            factor = float(sigma_constraint.split('*')[1].split('#')[0])
            new_sigma = current_sigma * factor
            new_gamma = (lg_ratio / 100 * new_sigma) / (1 - lg_ratio / 100)
            self.peak_params_grid.SetCellValue(row, 7, f"{new_sigma:.2f}")
            self.peak_params_grid.SetCellValue(row, 8, f"{new_gamma:.2f}")
    elif model in ["DS (A, σ, γ)"]:
        sigma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 7)
        current_sigma = float(self.peak_params_grid.GetCellValue(row, 7))

        if '*' in sigma_constraint:
            factor = float(sigma_constraint.split('*')[1].split('#')[0])
            new_sigma = current_sigma * factor
            self.peak_params_grid.SetCellValue(row, 7, f"{new_sigma:.2f}")
    elif model == "DS*G (A, σ, γ, S)":
        sigma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 7)
        gamma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 8)
        skew_constraint = self.peak_params_grid.GetCellValue(constraint_row, 9)

        current_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
        current_gamma = float(self.peak_params_grid.GetCellValue(row, 8))
        current_skew = float(self.peak_params_grid.GetCellValue(row, 9))

        if '*' in sigma_constraint:
            factor = float(sigma_constraint.split('*')[1].split('#')[0])
            new_sigma = current_sigma * factor
            self.peak_params_grid.SetCellValue(row, 7, f"{new_sigma:.2f}")
        if '*' in gamma_constraint:
            factor = float(gamma_constraint.split('*')[1].split('#')[0])
            new_gamma = current_gamma * factor
            self.peak_params_grid.SetCellValue(row, 8, f"{new_gamma:.2f}")
        if '*' in skew_constraint:
            factor = float(skew_constraint.split('*')[1].split('#')[0])
            new_skew = current_skew * factor
            self.peak_params_grid.SetCellValue(row, 9, f"{new_skew:.2f}")
    elif model == "ExpGauss.(Area, σ, γ)":
        gamma_constraint = self.peak_params_grid.GetCellValue(constraint_row, 8)
        current_gamma = float(self.peak_params_grid.GetCellValue(row, 8))

        if '*' in gamma_constraint:
            factor = float(gamma_constraint.split('*')[1].split('#')[0])
            new_gamma = current_gamma * factor
            self.peak_params_grid.SetCellValue(row, 8, f"{new_gamma:.2f}")
    else:
        fwhm_constraint = self.peak_params_grid.GetCellValue(constraint_row, 4)
        if '*' in fwhm_constraint:
            factor = float(fwhm_constraint.split('*')[1].split('#')[0])
            new_linked_fwhm = new_fwhm * factor
            self.peak_params_grid.SetCellValue(row, 4, f"{new_linked_fwhm:.2f}")

    self.recalculate_peak_area(peak_index)

    peak_label = self.peak_params_grid.GetCellValue(row, 1)
    peaks = _peaks(self)
    if peak_label in peaks:
        if model in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)"] and new_sigma is not None:
            peaks[peak_label]['Sigma'] = new_sigma
            peaks[peak_label]['Gamma'] = new_gamma
        elif model in ["Voigt (Area, L/G, σ, S)", "DS (A, σ, γ)",
                       "DS*G (A, σ, γ, S)"] and new_sigma is not None:
            peaks[peak_label]['Sigma'] = new_sigma
            peaks[peak_label]['Gamma'] = new_gamma
        elif model == "ExpGauss.(Area, σ, γ)" and new_gamma is not None:
            peaks[peak_label]['Gamma'] = new_gamma
        elif new_linked_fwhm is not None:
            peaks[peak_label]['FWHM'] = new_linked_fwhm


def update_linked_fwhm_recursive(window, peak_index, new_fwhm, visited=None):
    """MyFrame.update_linked_fwhm_recursive, unchanged."""
    self = window
    if visited is None:
        visited = set()
    if peak_index in visited:
        return
    visited.add(peak_index)

    linked_peaks = self.get_linked_peaks(peak_index)
    for linked_peak in linked_peaks:
        if linked_peak not in visited:
            row = peak_index * 2
            model = self.peak_params_grid.GetCellValue(row, 13)

            if model in ["Voigt (Area, L/G, σ)", "Voigt (Area, L/G, σ, S)", "DS (A, σ, γ)",
                         "DS*G (A, σ, γ, S)"]:
                original_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
                original_lg = float(self.peak_params_grid.GetCellValue(row, 5))
                linked_sigma = original_sigma
                linked_gamma = (original_lg / 100 * linked_sigma) / (1 - original_lg / 100)
                self.peak_params_grid.SetCellValue(linked_peak * 2, 7, f"{linked_sigma:.2f}")
                self.peak_params_grid.SetCellValue(linked_peak * 2, 8, f"{linked_gamma:.2f}")
                update_linked_fwhm_recursive(self, linked_peak, new_fwhm, visited)
            elif model in ["Voigt (Area, σ, γ)", "DS*G (A, σ, γ, S)"]:
                original_gamma = float(self.peak_params_grid.GetCellValue(row, 8))
                original_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
                linked_gamma = original_gamma
                self.peak_params_grid.SetCellValue(linked_peak * 2, 7, f"{original_sigma:.3f}")
                self.peak_params_grid.SetCellValue(linked_peak * 2, 8, f"{linked_gamma:.3f}")
                update_linked_fwhm_recursive(self, linked_peak, new_fwhm, visited)
            elif model == "ExpGauss.(Area, σ, γ)":
                original_gamma = float(self.peak_params_grid.GetCellValue(row, 8))
                original_sigma = float(self.peak_params_grid.GetCellValue(row, 7))
                linked_gamma = original_gamma
                self.peak_params_grid.SetCellValue(linked_peak * 2, 7, f"{original_sigma:.2f}")
                self.peak_params_grid.SetCellValue(linked_peak * 2, 8, f"{linked_gamma:.2f}")
                update_linked_fwhm_recursive(self, linked_peak, new_fwhm, visited)
            else:
                linked_fwhm = float(self.peak_params_grid.GetCellValue(linked_peak * 2, 4))
                update_linked_peak_fwhm(self, linked_peak, new_fwhm)
                update_linked_fwhm_recursive(self, linked_peak, linked_fwhm, visited)


def _after_peak_change(window):
    window.update_ratios()
    sync_peaks_from_grid(window)
    window.load_view()


def nudge_position(window, peak_index, left):
    """On_Key_Defs._handle_alt_arrow_keys: Alt+Left / Alt+Right move the peak 0.1 eV."""
    grid = window.peak_params_grid
    row = peak_index * 2
    current_position = float(grid.GetCellValue(row, 2))
    delta = 0.1 if left else -0.1
    new_position = current_position + delta
    grid.SetCellValue(row, 2, f"{new_position:.2f}")
    window.update_linked_peaks_recursive(peak_index, new_position, float(grid.GetCellValue(row, 3)))
    _after_peak_change(window)


def nudge_height(window, peak_index, up):
    """On_Key_Defs._handle_alt_up_down_keys: Alt+Up / Alt+Down change the height by 5 %."""
    grid = window.peak_params_grid
    row = peak_index * 2
    current_height = float(grid.GetCellValue(row, 3))
    intensity_factor = 0.05
    delta = intensity_factor * current_height * (1 if up else -1)
    new_height = max(0, current_height + delta)
    grid.SetCellValue(row, 3, format_intensity(new_height))
    window.recalculate_peak_area(peak_index)
    window.update_linked_peaks_recursive(peak_index, float(grid.GetCellValue(row, 2)), new_height)
    _after_peak_change(window)


def nudge_width(window, peak_index, right):
    """On_Key_Defs._handle_alt_shift_arrow_keys: Alt+Shift+Right / Left widen / narrow by 0.05."""
    grid = window.peak_params_grid
    row = peak_index * 2
    model = grid.GetCellValue(row, 13)
    delta = 0.05 if right else -0.05
    current_fwhm = float(grid.GetCellValue(row, 4))
    new_fwhm = current_fwhm

    if model in VOIGT_SIGMA:
        current_sigma = float(grid.GetCellValue(row, 7))
        lg_ratio = float(grid.GetCellValue(row, 5))
        new_sigma = max(current_sigma + delta, 0.4)
        new_gamma = (lg_ratio / 100 * new_sigma) / (1 - lg_ratio / 100)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
    elif model in ["DS (A, σ, γ)"]:
        current_sigma = float(grid.GetCellValue(row, 7))
        new_sigma = max(current_sigma + delta, 0.4)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
    elif model == "DS*G (A, σ, γ, S)":
        current_sigma = float(grid.GetCellValue(row, 7))
        current_gamma = float(grid.GetCellValue(row, 8))
        new_sigma = max(current_sigma + delta, 0.2)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
        new_gamma = max(current_gamma + delta * 0.5, 0.1)
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
    elif model == "ExpGauss.(Area, σ, γ)":
        current_gamma = float(grid.GetCellValue(row, 8))
        new_gamma = max(current_gamma + delta, 0.2)
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
    else:
        new_fwhm = max(current_fwhm + delta, 0.3)
        grid.SetCellValue(row, 4, f"{new_fwhm:.2f}")

    window.recalculate_peak_area(peak_index)
    update_linked_fwhm_recursive(window, peak_index, new_fwhm)
    _after_peak_change(window)


def wheel_width(window, peak_index, up):
    """On_Mouse_Defs.on_mouse_wheel with a peak selected on the Fitting tab:
    one notch widens (up) or narrows the peak by 0.05 (sigma for the Voigt
    models; the area for a SingleEntity)."""
    grid = window.peak_params_grid
    delta = 0.05 if up else -0.05
    row = peak_index * 2
    fitting_model = grid.GetCellValue(row, 13)
    new_sigma = new_fwhm = None
    if fitting_model == "SingleEntity":
        peaks_dict = _peaks(window)
        current_area = float(grid.GetCellValue(row, 6))
        area_delta = max(abs(current_area) * 0.05, 1e-12)
        if not up:
            area_delta = -area_delta
        new_area = max(current_area + area_delta, 0.0)
        for peak_name, data in peaks_dict.items():
            if data.get('Fitting Model') == 'SingleEntity':
                position = float(grid.GetCellValue(row, 2))
                if abs(data.get('Position', 0) - position) < 0.01:
                    true_original_area = data.get('Original_Area', data.get('L/G', 1))
                    new_scale = new_area / true_original_area if true_original_area != 0 else 1.0
                    grid.SetCellValue(row, 6, format_intensity(new_area))
                    grid.SetCellValue(row, 8, f"{new_scale:.2f}")
                    grid.SetCellValue(row, 5, format_intensity(true_original_area))
                    if 'y_data' in data:
                        original_max_height = float(np.max(np.array(data['y_data'])))
                        new_height = original_max_height * new_scale
                        grid.SetCellValue(row, 3, format_intensity(new_height))
                        data['Height'] = new_height
                    data['Area'] = new_area
                    data['Gamma'] = new_scale
                    break
        window.update_ratios()
        window.load_view()
        return
    elif fitting_model in VOIGT_SIGMA:
        current_sigma = float(grid.GetCellValue(row, 7))
        new_sigma = max(current_sigma + delta, 0.1)
        grid.SetCellValue(row, 7, f"{new_sigma:.2f}")
        lg_ratio = float(grid.GetCellValue(row, 5))
        new_gamma = (lg_ratio / 100 * new_sigma) / (1 - lg_ratio / 100)
        grid.SetCellValue(row, 8, f"{new_gamma:.2f}")
    else:
        current_fwhm = float(grid.GetCellValue(row, 4))
        new_fwhm = max(current_fwhm + delta, 0.1)
        grid.SetCellValue(row, 4, f"{new_fwhm:.2f}")
    width = new_sigma if fitting_model.startswith("Voigt (Area,") else new_fwhm
    window.recalculate_peak_area(peak_index)
    update_linked_fwhm_recursive(window, peak_index, width)
    window.recalculate_peak_area(peak_index)
    update_linked_fwhm_recursive(window, peak_index, width)
    _after_peak_change(window)


def drag_width(window, peak_index, initial_fwhm, initial_x, x):
    """MyFrame.update_peak_fwhm (Shift+drag of the selected peak): the width
    follows the mouse from where the drag started."""
    self = window
    grid = window.peak_params_grid
    row = peak_index * 2
    peak_label = grid.GetCellValue(row, 1)
    model = grid.GetCellValue(row, 13)
    delta_x = float(x) - float(initial_x)
    new_sigma = new_gamma = None

    if model in VOIGT_SIGMA:
        current_sigma = float(grid.GetCellValue(row, 7))
        lg_ratio = float(grid.GetCellValue(row, 5))
        new_sigma = max(current_sigma + delta_x * 1, 0.4)
        new_gamma = (lg_ratio / 100 * new_sigma) / (1 - lg_ratio / 100)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
        new_fwhm = initial_fwhm
    elif model in ["DS (A, σ, γ)"]:
        current_sigma = float(grid.GetCellValue(row, 7))
        new_sigma = max(current_sigma + delta_x * 1, 0.4)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
        new_fwhm = initial_fwhm
    elif model == "DS*G (A, σ, γ, S)":
        current_sigma = float(grid.GetCellValue(row, 7))
        current_gamma = float(grid.GetCellValue(row, 8))
        new_sigma = max(current_sigma + delta_x * 0.5, 0.2)
        grid.SetCellValue(row, 7, f"{new_sigma:.3f}")
        new_gamma = max(current_gamma + delta_x * 0.3, 0.1)
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
        new_fwhm = initial_fwhm
    elif model == "ExpGauss.(Area, σ, γ)":
        current_sigma = float(grid.GetCellValue(row, 7))
        current_gamma = float(grid.GetCellValue(row, 8))
        new_gamma = max(current_gamma + delta_x * 0.5, 0.2)
        grid.SetCellValue(row, 7, f"{current_sigma:.3f}")
        grid.SetCellValue(row, 8, f"{new_gamma:.3f}")
        new_fwhm = initial_fwhm
    else:
        new_fwhm = max(float(initial_fwhm) + delta_x * 1, 0.3)
        grid.SetCellValue(row, 4, f"{new_fwhm:.3f}")

    peaks = _peaks(self)
    if peak_label in peaks:
        peaks[peak_label]['FWHM'] = new_fwhm
        if new_sigma is not None:
            peaks[peak_label]['Sigma'] = new_sigma
        if new_gamma is not None:
            peaks[peak_label]['Gamma'] = new_gamma
    self.recalculate_peak_area(peak_index)
    update_linked_fwhm_recursive(self, peak_index, new_fwhm)
    _after_peak_change(window)
    return new_fwhm


# ── The peak table's right-click menu ─────────────────────────────────────
def insert_cross_core_constraint(window, constraint_ref, row, col):
    """On_Mouse_Defs.insert_cross_core_constraint, unchanged."""
    self = window
    if row % 2 == 0:
        constraint_row = row + 1
        parameter_row = row
    else:
        constraint_row = row
        parameter_row = row - 1

    core_level_name, peak_letter = constraint_ref.rsplit('_', 1)
    if core_level_name not in self.Data['Core levels']:
        return
    core_level_data = self.Data['Core levels'][core_level_name]
    if not ('Fitting' in core_level_data and 'Peaks' in core_level_data['Fitting']):
        return
    peaks = core_level_data['Fitting']['Peaks']
    peak_keys = list(peaks.keys())
    peak_index = ord(peak_letter) - ord('A')
    if peak_index >= len(peak_keys):
        return
    ref_peak_data = peaks[peak_keys[peak_index]]

    if col == 2:
        current_pos = float(self.peak_params_grid.GetCellValue(parameter_row, col))
        ref_pos = float(ref_peak_data.get('Position', current_pos))
        difference = current_pos - ref_pos
        if difference >= 0:
            constraint_value = f"{constraint_ref}+{difference:.2f}#0.1"
        else:
            constraint_value = f"{constraint_ref}{difference:.2f}#0.1"
    elif col == 6:
        current_area = float(self.peak_params_grid.GetCellValue(parameter_row, col))
        ref_area = float(ref_peak_data.get('Area', current_area))
        ratio = (current_area / ref_area) if ref_area != 0 else 1
        if ratio != 1:
            constraint_value = f"{constraint_ref}*{ratio:.2f}#0.01"
        else:
            constraint_value = f"{constraint_ref}*1"
    else:
        constraint_value = f"{constraint_ref}*1"

    self.peak_params_grid.SetCellValue(constraint_row, col, constraint_value)
    peaks_data = _peaks(self)
    current_peak_index = constraint_row // 2
    keys = list(peaks_data.keys())
    if current_peak_index < len(keys):
        key = keys[current_peak_index]
        peaks_data[key].setdefault('Constraints', {})
        name = {2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G', 6: 'Area', 7: 'Sigma', 8: 'Gamma',
                9: 'Skew'}.get(col)
        if name:
            peaks_data[key]['Constraints'][name] = constraint_value


def propagate_fwhm_difference(window, row, col):
    """Utilities.propagate_fwhm_difference, unchanged."""
    if col != 4 or row % 2 != 1:
        return
    param_row = row - 1
    ref_peak_letter = window.peak_params_grid.GetCellValue(param_row, 0)
    ref_peak_index = ord(ref_peak_letter) - 65
    ref_fwhm = float(window.peak_params_grid.GetCellValue(ref_peak_index * 2, 4))
    num_peaks = window.peak_params_grid.GetNumberRows() // 2
    peaks = _peaks(window)
    keys = list(peaks.keys())
    for i in range(num_peaks):
        if i != ref_peak_index:
            current_fwhm = float(window.peak_params_grid.GetCellValue(i * 2, 4))
            difference = current_fwhm - ref_fwhm
            if difference >= 0:
                constraint_str = f"{ref_peak_letter}+{difference:.2f}#0.1"
            else:
                constraint_str = f"{ref_peak_letter}{difference:.2f}#0.1"
            window.peak_params_grid.SetCellValue(i * 2 + 1, col, constraint_str)
            if i < len(keys):
                peaks[keys[i]].setdefault('Constraints', {})['FWHM'] = constraint_str


def shift_constraint_letters_after_insert(constraint, insert_index):
    """On_Mouse_Defs.shift_constraint_letters_after_insert, unchanged."""
    if not constraint or constraint in ['Fixed', '']:
        return constraint

    def replace_letter(match):
        letter = match.group(1)
        letter_index = ord(letter) - 65
        if letter_index >= insert_index:
            return chr(65 + letter_index + 1)
        return letter

    pattern = r'([A-Z])(?=[+\-*/]|$|#)'
    return re.sub(pattern, replace_letter, constraint)


def add_peak_with_model(window, model_name, row=None):
    """On_Mouse_Defs.add_peak_with_model (the table's "Add Peak" submenu): a
    new peak of that model, placed at the largest residual, inserted after the
    clicked peak; the table is then rebuilt from Data (on_sheet_selected)."""
    from .curves import overall_fit
    from .sheets import select_sheet
    if row is None:
        row = 0
    insert_index = row // 2 if row % 2 == 0 else (row + 1) // 2
    sheet_name = window.sheet_combobox.GetValue()
    cl = window.Data['Core levels'][sheet_name]
    bg = cl.get('Background', {}) or {}
    if window.bg_min_energy is None or window.bg_max_energy is None:
        low, high = bg.get('Bkg Low'), bg.get('Bkg High')
        if not bg.get('Bkg Type') or low in (None, '') or high in (None, ''):
            raise ValueError("Please create a background first.")
        window.bg_min_energy, window.bg_max_energy = float(low), float(high)

    peaks_data = list(_peaks(window).items())
    old_method = window.selected_fitting_method
    window.selected_fitting_method = model_name
    window.load_view()
    window.peak_count = window.peak_params_grid.GetNumberRows() // 2
    window.peak_count += 1

    if len(peaks_data) == 0:
        residual = window.y_values - np.array(bg['Bkg Y'])
        peak_y = residual[np.argmax(residual)]
        peak_x = window.x_values[np.argmax(residual)]
    else:
        _, residual = overall_fit(window)
        if residual is not None:
            peak_y = residual.max()
            peak_x = window.x_values[np.argmax(residual)]
        else:
            peak_y = window.y_values.max()
            peak_x = window.x_values[np.argmax(window.y_values)]
    peak_x = float(peak_x)
    peak_y = float(peak_y)

    new_peak_key = f"{sheet_name} p{window.peak_count}"
    x_values = cl['B.E.']
    position_constraint = f"{min(x_values):.2f}:{max(x_values):.2f}"

    if model_name in ["ExpGauss.(Area, σ, γ)"]:
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 20,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.3,
            'Gamma': 1.2,
            'Skew': 0.64,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.01:1",
                'Gamma': "0.01:3",
                'Skew': "0.01:2"
            }
        }
    elif model_name in ["LA (Area, σ/γ, γ)", "LA*G (Area, σ/γ, γ)"]:
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 50,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 2.7,
            'Gamma': 2.7,
            'Skew': 0.64,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.01:10" if "LA*G" not in model_name else "0.01:4",
                'Gamma': "0.01:10" if "LA*G" not in model_name else "0.01:4",
                'Skew': "0.01:2"
            }
        }
    elif model_name in ["Voigt (Area, L/G, σ, S)"]:
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 20,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 1.2,
            'Gamma': 0.4,
            'Skew': 0.01,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "15:85",
                'Area': '0:1e7',
                'Sigma': "0.2:1.5",
                'Gamma': "0.2:1.5",
                'Skew': "0.01:0.7"
            }
        }
    elif model_name in ["DS (A, σ, γ)", "DS*G (A, σ, γ, S)"]:
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.0,
            'L/G': 20,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.5,
            'Gamma': 0.5 if "DS*G" in model_name else 0.0,
            'Skew': 0.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.3:1.5",
                'Gamma': "0.1:1.5" if "DS*G" in model_name else "-0.1:1.5",
                'Skew': "0:0.2" if "DS*G" in model_name else "-0.2:0.2"
            }
        }
    elif model_name in ["A*GL (Area, a, b)", "A*SGL (Area, a, b)"]:
        # CasaXPS A(a,b,0)GL(p) / A(a,b,0)SGL(p): sigma/gamma columns hold a and b
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 30,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.2,
            'Gamma': 0.4,
            'Skew': 0.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "Fixed",
                'Gamma': "Fixed",
                'Skew': "0.01:2"
            }
        }
    elif model_name == "LF (Area, σ, γ, w)":
        # LA power form with damping width w in the skew column
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 50,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 2.7,
            'Gamma': 2.7,
            'Skew': 30.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.01:10",
                'Gamma': "0.01:10",
                'Skew': "Fixed"
            }
        }
    elif model_name == "Voigt (Area)":
        # Simple Voigt: width driven directly by the FWHM column, mixing by L/G
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 30,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.0,
            'Gamma': 0.0,
            'Skew': 0.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "5:80",
                'Area': '0:1e7',
                'Sigma': "0.3:3",
                'Gamma': "0.3:3",
                'Skew': "0.01:2"
            }
        }
    elif model_name == "Voigt (Area, L/G, S)":
        # Hybrid Voigt: FWHM column drives the width, L/G the mixing, S the tail
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 30,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.0,
            'Gamma': 0.0,
            'Skew': 0.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "5:80",
                'Area': '0:1e7',
                'Sigma': "0.3:3",
                'Gamma': "0.3:3",
                'Skew': "0.01:0.7"
            }
        }
    elif model_name == "TLA (A, μ, α, Wg)":
        # CasaXPS TLA: mu (tail) in sigma column, Gaussian width in gamma column,
        # exponent alpha in skew column
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.0,
            'L/G': 0,
            'Area': round_sig(peak_y * 1.0 * 1.5),
            'Sigma': 20.0,
            'Gamma': 1.0,
            'Skew': 0.8,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.1:200",
                'Gamma': "Fixed",
                'Skew': "0.2:3"
            }
        }
    elif model_name == "SB (Height)":
        # Shirley-background component: sigmoid step of a Voigt bell
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 30,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 0.0,
            'Gamma': 0.0,
            'Skew': 0.0,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.3:3",
                'Gamma': "0.3:3",
                'Skew': "0.01:2"
            }
        }
    elif model_name == "DL (A, σ, γ, aDL)":
        # Double Lorentzian: sigma = Lorentzian width, gamma = Gaussian FWHM,
        # skew column = asymmetry a_dl (>= 1)
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.2,
            'L/G': 0,
            'Area': round_sig(peak_y * 1.2 * 1.064),
            'Sigma': 0.4,
            'Gamma': 1.0,
            'Skew': 1.5,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "Fixed",
                'Area': '0:1e7',
                'Sigma': "0.05:3",
                'Gamma': "0.05:3",
                'Skew': "1:5"
            }
        }
    else:
        # Default for GL, SGL, Pseudo-Voigt, etc.
        new_peak_data = {
            'Position': peak_x,
            'Height': peak_y,
            'FWHM': 1.6,
            'L/G': 20,
            'Area': round_sig(peak_y * 1.6 * 1.064),
            'Sigma': 1.0,
            'Gamma': 0.15,
            'Skew': 0.64,
            'Fitting Model': model_name,
            'Bkg Type': window.background_method,
            'Bkg Low': window.bg_min_energy,
            'Bkg High': window.bg_max_energy,
            'Bkg Offset Low': window.offset_l,
            'Bkg Offset High': window.offset_h,
            'Constraints': {
                'Position': position_constraint,
                'Height': "0:1e7",
                'FWHM': "0.3:3.5",
                'L/G': "5:80",
                'Area': '0:1e7',
                'Sigma': "0.3:3",
                'Gamma': "0.3:3",
                'Skew': "0.01:2"
            }
        }


    peaks_data.insert(insert_index, (new_peak_key, new_peak_data))
    for i, (key, data) in enumerate(peaks_data):
        if i > insert_index and 'Constraints' in data:
            for constraint_key, constraint_value in data['Constraints'].items():
                if isinstance(constraint_value, str):
                    data['Constraints'][constraint_key] = shift_constraint_letters_after_insert(
                        constraint_value, insert_index)
    if not isinstance(cl.get('Fitting'), dict):
        cl['Fitting'] = {}
    cl['Fitting']['Peaks'] = {key: data for key, data in peaks_data}
    window.selected_fitting_method = old_method
    select_sheet(window, sheet_name)
    window.update_ratios()
    window.load_view()
    return insert_index
