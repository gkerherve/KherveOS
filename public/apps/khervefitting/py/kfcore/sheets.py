# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the peak table. What happens when a core level is chosen
# (Sheet_Operations.on_sheet_selected), when a peak is added, removed or
# dragged (PeakFittingGrid, Functions.remove_peak, On_Mouse_Defs,
# PeakManipulation) and when a cell is edited
# (PeakFittingGrid.on_peak_params_cell_changed, Utilities.propagate_constraint).
# Only the data side is kept: colours, focus and redraws belong to the web page.

import re

import numpy as np

from .peak_functions import PeakFunctions


class CellRejected(Exception):
    """The desktop vetoes this edit (the cell keeps its old text)."""


def _safe_float(value_str):
    """PeakFittingGrid.safe_float_convert."""
    try:
        return float(value_str) if value_str else 0.0
    except (ValueError, TypeError):
        return 0.0


def extract_core_level_name(sheet_name):
    """'Sr3d1' -> 'Sr3d', 'C1s1' -> 'C1s' (PlotManager.extract_core_level_name)."""
    match = re.match(r'([A-Z][a-z]?\d+[spdf])', sheet_name)
    if match:
        return match.group(1)
    return None


def is_part_of_doublet(current_label, next_label):
    """PlotManager.is_part_of_doublet: two adjacent peaks of one spin-orbit pair."""
    current_parts = current_label.split()
    next_parts = next_label.split()
    if len(current_parts) < 1 or len(next_parts) < 1:
        return False

    def extract_core_level(label):
        match = re.match(r'([A-Za-z]+\d+[spdf])', label)
        return match.group(1) if match else label

    current_core_level = extract_core_level(current_parts[0])
    next_core_level = extract_core_level(next_parts[0])
    if current_core_level != next_core_level:
        return False
    orbital = re.search(r'\d([spdf])', current_core_level)
    if not orbital:
        return False
    orbital = orbital.group(1)

    def has_component(parts, component):
        return any(component in part for part in parts)

    if orbital == 'p':
        return has_component(current_parts, '3/2') and has_component(next_parts, '1/2')
    elif orbital == 'd':
        return has_component(current_parts, '5/2') and has_component(next_parts, '3/2')
    elif orbital == 'f':
        return has_component(current_parts, '7/2') and has_component(next_parts, '5/2')
    return False


# ── Choosing a core level ───────────────────────────────────────────────
def select_sheet(window, selected_sheet):
    """Sheet_Operations.on_sheet_selected: rebuild the peak table from Data."""
    window.sheet_combobox.SetValue(selected_sheet)
    window.peak_count = 0
    window.bg_min_energy = None
    window.bg_max_energy = None
    window.selected_peak_index = None
    window.fit_results = None
    window.vlines = None
    grid = window.peak_params_grid
    grid.DeleteRows(0, grid.GetNumberRows())

    core_level_data = window.Data['Core levels'].get(selected_sheet)
    if core_level_data is None or 'Raw Data' not in core_level_data:
        window.load_view()
        return

    if 'Background' not in core_level_data:
        core_level_data['Background'] = {
            'Bkg X': core_level_data.get('B.E.', []),
            'Bkg Y': core_level_data.get('Raw Data', []),
            'Bkg Type': '', 'Bkg Low': '', 'Bkg High': '',
            'Bkg Offset Low': '', 'Bkg Offset High': '',
        }
    if 'Bkg Y' not in core_level_data['Background']:
        core_level_data['Background']['Bkg Y'] = core_level_data['Raw Data']

    fitting = core_level_data.get('Fitting')
    if isinstance(fitting, dict) and 'Peaks' in fitting:
        peaks = fitting['Peaks']
        window.peak_count = len(peaks)
        grid.AppendRows(window.peak_count * 2)
        x_values = core_level_data['B.E.']
        for i, (peak_label, peak_data) in enumerate(peaks.items()):
            row = i * 2
            grid.SetCellValue(row, 0, chr(65 + i))
            grid.SetCellValue(row, 1, peak_label)
            try:
                grid.SetCellValue(row, 2, f"{peak_data.get('Position', 'N/A'):.2f}")
            except (ValueError, TypeError):
                grid.SetCellValue(row, 2, f"{peak_data.get('Position', 'N/A')}")
            grid.SetCellValue(row, 3, f"{peak_data.get('Height', '1e4')}")
            grid.SetCellValue(row, 4, f"{peak_data.get('FWHM', '1.6')}")
            grid.SetCellValue(row, 5, f"{peak_data.get('L/G', '20')}")
            grid.SetCellValue(row, 6, f"{peak_data.get('Area', '1e4')}")
            grid.SetCellValue(row, 7, f"{peak_data.get('Sigma', '0.6')}")
            grid.SetCellValue(row, 8, f"{peak_data.get('Gamma', '0.4')}")
            grid.SetCellValue(row, 9, f"{peak_data.get('Skew', '0.1')}")
            grid.SetCellValue(row, 13, f"{peak_data.get('Fitting Model', 'GL (Area)')}")
            grid.SetCellValue(row, 14, f"{peak_data.get('Bkg Type', '0')}")
            grid.SetCellValue(row, 15, f"{peak_data.get('Bkg Low', '0')}")
            grid.SetCellValue(row, 16, f"{peak_data.get('Bkg High', '0')}")
            grid.SetCellValue(row, 17, f"{peak_data.get('Bkg Offset Low', '0')}")
            grid.SetCellValue(row, 18, f"{peak_data.get('Bkg Offset High', '0')}")

            position_constraint = f"{min(x_values):.2f}:{max(x_values):.2f}"
            if 'Constraints' in peak_data:
                constraints = peak_data['Constraints']
                default_constraints = {
                    'Position': position_constraint, 'Height': '1:1e7', 'FWHM': '0.3:3.7',
                    'L/G': '5:80', 'Area': '1:1e7', 'Sigma': '0.3:3', 'Gamma': '0.3:3', 'Skew': '0.01:2',
                }
                keys = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
                for col_idx, key in enumerate(keys, 2):
                    constraint_value = constraints.get(key, '')
                    is_valid = (constraint_value == 'Fixed' or
                                ':' in str(constraint_value) or ',' in str(constraint_value) or
                                '*' in str(constraint_value) or '#' in str(constraint_value) or
                                '+' in str(constraint_value) or '-' in str(constraint_value))
                    if not constraint_value or not is_valid:
                        constraint_value = default_constraints[key]
                        constraints[key] = constraint_value
                    grid.SetCellValue(row + 1, col_idx, str(constraint_value))
            else:
                default_constraints = {
                    'Position': position_constraint, 'Height': '1:1e7', 'FWHM': '0.3:3.6',
                    'L/G': '5:80', 'Area': '1:1e7', 'Sigma': '0.3:3', 'Gamma': '0.3:3', 'Skew': '0.01:2',
                }
                peak_data['Constraints'] = default_constraints.copy()
                for col_idx, (key, value) in enumerate(default_constraints.items(), 2):
                    grid.SetCellValue(row + 1, col_idx, str(value))
            window.selected_fitting_method = grid.GetCellValue(row, 13)

        bg_data = core_level_data['Background']
        window.bg_min_energy = bg_data.get('Bkg Low', '')
        window.bg_max_energy = bg_data.get('Bkg High', '')
        window.background_method = bg_data.get('Bkg Type', '')
        window.offset_l = bg_data.get('Bkg Offset Low', '')
        window.offset_h = bg_data.get('Bkg Offset High', '')
        for key in ('Bkg Type', 'Bkg Low', 'Bkg High', 'Bkg Offset Low', 'Bkg Offset High'):
            bg_data.setdefault(key, "")

    # The fitting window draws its two limit lines at the stored limits
    # (initialize_or_restore_background_vlines).
    bg_data = core_level_data['Background']
    try:
        low, high = float(bg_data.get('Bkg Low')), float(bg_data.get('Bkg High'))
        if bg_data.get('Bkg Type') and low < high:
            window.vlines = (low, high)
    except (TypeError, ValueError):
        pass

    window.load_view()
    window.update_ratios()


# ── Adding a peak ───────────────────────────────────────────────────────
def add_peak(window, custom_peak_x=None, custom_peak_y=None, residual=None):
    """PeakFittingGrid.add_peak_params. Returns the new peak's index.

    Without a position the peak goes where the data (or, once there are
    peaks, the residual passed in) is highest, as on the desktop.
    """
    sheet_name = window.sheet_combobox.GetValue()
    is_raman = sheet_name.startswith('RA') or 'RAMAN' in sheet_name.upper()
    grid = window.peak_params_grid
    num_peaks = grid.GetNumberRows() // 2

    overall_bg_low, overall_bg_high = window.fitting_window.get_overall_background_range()
    window.bg_min_energy = overall_bg_low
    window.bg_max_energy = overall_bg_high
    if window.bg_min_energy in (None, '') or window.bg_max_energy in (None, ''):
        raise CellRejected("Please create a background first.")
    window.bg_min_energy = float(window.bg_min_energy)
    window.bg_max_energy = float(window.bg_max_energy)

    if custom_peak_x is not None and custom_peak_y is not None:
        peak_x, peak_y = custom_peak_x, custom_peak_y
    else:
        if num_peaks == 0 or residual is None:
            bkg = np.array(window.Data['Core levels'][sheet_name]['Background']['Bkg Y'])
            res = window.y_values - bkg
            peak_y = res[np.argmax(res)]
            peak_x = window.x_values[np.argmax(res)]
        else:
            peak_y = residual.max()
            peak_x = window.x_values[np.argmax(residual)]
        peak_x, peak_y = float(peak_x), float(peak_y)

    window.peak_count = num_peaks + 1  # (the desktop counts from its own counter)
    grid.AppendRows(2)
    row = grid.GetNumberRows() - 2
    letter_id = chr(64 + window.peak_count)
    core_level_name = extract_core_level_name(sheet_name) or sheet_name
    method = window.selected_fitting_method
    set_ = grid.SetCellValue

    set_(row, 0, letter_id)
    set_(row, 1, f"{core_level_name} p{window.peak_count}")
    set_(row, 2, f"{peak_x:.2f}")
    set_(row, 3, f"{peak_y:.2f}")
    set_(row, 4, "15" if is_raman else "1.6")
    set_(row, 5, "20")
    fwhm_val = 15 if is_raman else 1.6
    if method == 'SGL (Area)':
        fwhm = fwhm_val
        fraction = 20
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
        gamma = fwhm / 2
        area = peak_y * ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (fraction / 100) * np.pi * gamma)
        set_(row, 6, f"{area:.2f}")
    else:
        set_(row, 6, f"{peak_y * fwhm_val * 1.064:.2f}")
    if method == "ExpGauss.(Area, σ, γ)":
        set_(row, 7, "0.3"); set_(row, 8, '1.2'); set_(row, 9, '0.64')
    elif method in ["LA (Area, σ/γ, γ)", "LA*G (Area, σ/γ, γ)"]:
        set_(row, 5, "50"); set_(row, 7, "2.7"); set_(row, 8, '2.7'); set_(row, 9, '0.64')
    elif method == "LA (Area, σ, γ)":
        set_(row, 5, "50"); set_(row, 7, "2.7"); set_(row, 8, '2.7'); set_(row, 9, '0')
    elif method == "Voigt (Area, L/G, σ, S)":
        set_(row, 5, "20"); set_(row, 7, "10" if is_raman else "1.2"); set_(row, 8, '0.4'); set_(row, 9, '0.01')
    elif method == "DS (A, σ, γ)":
        set_(row, 7, "0.5"); set_(row, 8, "0.0"); set_(row, 9, "0.0")
    elif method == "DS*G (A, σ, γ, S)":
        x_range = np.linspace(-10, 10, 1000)
        y_values = PeakFunctions.DS_G(x_range, 0, 1.0, 0.4, 0.0, 0.8)
        set_(row, 6, f"{peak_y / np.max(y_values):.2f}")
        set_(row, 7, "0.8"); set_(row, 8, "0.4"); set_(row, 9, "0.0")
    elif method == "D-parameter":
        set_(row, 5, "2"); set_(row, 7, "1"); set_(row, 8, '1'); set_(row, 9, '7')
    else:
        set_(row, 7, "1"); set_(row, 8, '0.15'); set_(row, 9, "0.64")
    for col in (10, 11, 12):
        set_(row, col, '')
    set_(row, 13, method)
    set_(row, 14, window.background_method)
    set_(row, 15, f"{window.bg_min_energy:.2f}")
    set_(row, 16, f"{window.bg_max_energy:.2f}")
    set_(row, 17, f"{float(window.offset_l or 0):.2f}")
    set_(row, 18, f"{float(window.offset_h or 0):.2f}")

    position_constraint = f"{window.bg_min_energy:.2f},{window.bg_max_energy:.2f}"
    set_(row + 1, 2, position_constraint)
    set_(row + 1, 3, "1:1e7")
    set_(row + 1, 4, "5:50" if is_raman else "0.3:3.5")
    set_(row + 1, 5, "2:80")
    set_(row + 1, 6, "1:1e7")
    set_(row + 1, 7, "5:50" if is_raman else "0.3:3")
    set_(row + 1, 8, "0.3:3")
    set_(row + 1, 9, '0.01:2')
    if method == "ExpGauss.(Area, σ, γ)":
        set_(row + 1, 7, "0.01:1"); set_(row + 1, 8, "0.01:3"); set_(row + 1, 9, '0.01:2')
    elif method in ["LA (Area, σ, γ)", "LA (Area, σ/γ, γ)", "LA*G (Area, σ/γ, γ)"]:
        set_(row + 1, 5, "Fixed"); set_(row + 1, 7, "0.01:10"); set_(row + 1, 8, "0.01:10"); set_(row + 1, 9, '0.01:2')
    elif method == "Voigt (Area, L/G, σ, S)":
        set_(row + 1, 5, "15:85"); set_(row + 1, 7, "5:50" if is_raman else "0.2:1.5")
        set_(row + 1, 8, "0.2:1.5"); set_(row + 1, 9, '0.01:0.7')
    elif method == "DS (A, σ, γ)":
        set_(row + 1, 7, "0.3:1.5"); set_(row + 1, 8, "-0.1:1.5"); set_(row + 1, 9, "-0.2:0.2")
    elif method == "DS*G (A, σ, γ, S)":
        set_(row + 1, 7, "0.3:1.5"); set_(row + 1, 8, "0.1:1.5"); set_(row + 1, 9, "0:0.2")
    else:
        set_(row + 1, 7, "0.3:3"); set_(row + 1, 8, "0.3:3"); set_(row + 1, 9, '0.01:2')
    # The desktop also writes 0.1 / 0.1:1 in the unused skew column of these models.
    if method in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)", "ExpGauss.(Area, σ, γ)",
                  "LA (Area, σ, γ)", "LA (Area, σ/γ, γ)"]:
        set_(row, 9, "0.1")
        set_(row + 1, 9, "0.1:1")

    window.selected_peak_index = num_peaks
    cl = window.Data['Core levels'][sheet_name]
    if not isinstance(cl.get('Fitting'), dict):
        cl['Fitting'] = {}
    cl['Fitting'].setdefault('Peaks', {})

    common = {
        'Fitting Model': method, 'Bkg Type': window.background_method,
        'Bkg Low': window.bg_min_energy, 'Bkg High': window.bg_max_energy,
        'Bkg Offset Low': window.offset_l, 'Bkg Offset High': window.offset_h,
    }
    if method == "Voigt (Area, L/G, σ, S)":
        peak_data = {'Position': peak_x, 'Height': peak_y, 'FWHM': fwhm_val, 'L/G': 20,
                     'Area': peak_y * fwhm_val * 1.064, 'Sigma': 10 if is_raman else 1.2, 'Gamma': 0.4,
                     'Skew': 0.01, **common,
                     'Constraints': {'Position': position_constraint, 'Height': "1:1e7",
                                     'FWHM': "5:50" if is_raman else "0.3:3.5", 'L/G': "2:80", 'Area': '1:1e7',
                                     'Sigma': "5:50" if is_raman else "0.3:3", 'Gamma': "0.3:3", 'Skew': "0.01:2"}}
    elif method in ["DS (A, σ, γ)", "DS*G (A, σ, γ, S)"]:
        ds = method == "DS (A, σ, γ)"
        peak_data = {'Position': peak_x, 'Height': peak_y, 'FWHM': 1.0, 'L/G': 20, 'Area': peak_y * 1.0 * 1.0,
                     'Sigma': 0.5, 'Gamma': 0.0 if ds else 0.5, 'Skew': 0.0, **common,
                     'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                     'L/G': "Fixed", 'Area': '1:1e7', 'Sigma': "0.3:1.5", 'Gamma': "0.1:1.5",
                                     'Skew': "-0.2:0.2" if ds else "0:0.2"}}
    else:
        peak_data = {'Position': peak_x, 'Height': peak_y, 'FWHM': 1.6, 'L/G': 20, 'Area': peak_y * 1.6 * 1.064,
                     'Sigma': 1.2, 'Gamma': 0.4, 'Skew': 0.64, **common,
                     'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                     'L/G': "2:80", 'Area': '1:1e7', 'Sigma': "0.3:3", 'Gamma': "0.3:3",
                                     'Skew': "0.00:2"}}
    if method in ["LA (Area, σ, γ)", "LA (Area, σ/γ, γ)"]:
        peak_data.update({'L/G': 50, 'Sigma': 2.75, 'Gamma': 2.75,
                          'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                          'L/G': "Fixed", 'Area': '1:1e7', 'Sigma': "0.01:10", 'Gamma': "0.01:10"}})
    elif method == "LA*G (Area, σ/γ, γ)":
        peak_data.update({'L/G': 50, 'Sigma': 2.75, 'Gamma': 2.75, 'Skew': 0.64,
                          'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                          'L/G': "Fixed", 'Area': '1:1e7', 'Sigma': "0.01:4", 'Gamma': "0.01:4",
                                          'Skew': "0.01:2"}})
    elif method in ["Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)"]:
        peak_data.update({'Sigma': 1, 'Gamma': 0.5,
                          'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                          'L/G': "1:80", 'Area': '1:1e7', 'Sigma': "0.3:3", 'Gamma': "0.3:3"}})
    elif method == "Voigt (Area, L/G, σ, S)":
        peak_data.update({'Sigma': 1, 'Gamma': 0.5, 'skew': 0.01,
                          'Constraints': {'Position': position_constraint, 'Height': "1:1e7", 'FWHM': "0.3:3.5",
                                          'L/G': "1:80", 'Area': '1:1e7', 'Sigma': "0.3:3", 'Gamma': "0.3:3",
                                          'Skew': "0.01:0.7"}})
    elif method == "SGL (Area)":
        fwhm = fwhm_val
        fraction = 20
        sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
        gamma = fwhm / 2
        sgl_area = peak_y * ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (fraction / 100) * np.pi * gamma)
        peak_data.update({'Area': sgl_area, 'FWHM': fwhm, 'L/G': fraction,
                          'Constraints': {'Position': position_constraint, 'Height': "1:1e7",
                                          'FWHM': "5:50" if is_raman else "0.3:3.5", 'L/G': "1:80",
                                          'Area': '1:1e7', 'Sigma': "5:50" if is_raman else "0.3:3",
                                          'Gamma': "0.3:3", 'Skew': "0.01:0.7"}})

    cl['Fitting']['Peaks'][core_level_name + f" p{window.peak_count}"] = peak_data
    window.update_ratios()
    return num_peaks


# ── Removing peaks ──────────────────────────────────────────────────────
def remove_last_peak(window):
    """Functions.remove_peak: drop the last peak."""
    grid = window.peak_params_grid
    num_rows = grid.GetNumberRows()
    if num_rows == 0:
        raise CellRejected("No peaks to remove.")
    sheet_name = window.sheet_combobox.GetValue()
    grid.DeleteRows(max(0, num_rows - 2), 2 if num_rows >= 2 else 1)
    window.peak_count = num_rows // 2 - 1
    cl = window.Data['Core levels'][sheet_name]
    peaks = (cl.get('Fitting') or {}).get('Peaks') if isinstance(cl.get('Fitting'), dict) else None
    if peaks:
        last_peak_key = f"p{window.peak_count + 1}"
        if last_peak_key in peaks:
            del peaks[last_peak_key]
        else:
            peaks.popitem()
    window.selected_peak_index = None
    window.update_ratios()


def _update_constraint_references(constraint, deleted_index):
    """On_Mouse_Defs.update_constraint_references: re-letter after a deletion."""
    if not constraint or constraint in ['Fixed', '']:
        return constraint

    def replace_letter(match):
        letter = match.group(1)
        letter_index = ord(letter) - 65
        if letter_index > deleted_index:
            return chr(65 + letter_index - 1)
        elif letter_index == deleted_index:
            return "1:1000"
        return letter

    updated = re.sub(r'([A-Z])(?=[+\-*/]|$)', replace_letter, constraint)
    if updated.startswith('1:1000') and ':' not in constraint:
        return "1:1000"
    return updated


def delete_peak(window, peak_index):
    """On_Mouse_Defs.delete_peak_at_index: delete one peak, re-letter the rest."""
    sheet_name = window.sheet_combobox.GetValue()
    grid = window.peak_params_grid
    grid.DeleteRows(peak_index * 2, 2)
    cl = window.Data['Core levels'][sheet_name]
    peaks = cl.get('Fitting', {}).get('Peaks') if isinstance(cl.get('Fitting'), dict) else None
    if peaks is not None:
        keys = list(peaks.keys())
        if peak_index < len(keys):
            items = [(k, peaks[k]) for k in keys]
            items.pop(peak_index)
            peaks.clear()
            for label, data in items:
                for ck, cv in list(data.get('Constraints', {}).items()):
                    if isinstance(cv, str):
                        data['Constraints'][ck] = _update_constraint_references(cv, peak_index)
                peaks[label] = data
    select_sheet(window, sheet_name)


# ── Dragging a peak on the plot ─────────────────────────────────────────
def update_peak(window, peak_index, new_x, new_height, area=None):
    """PeakManipulation.update_peak (without the FWHM read-out)."""
    row = peak_index * 2
    sheet_name = window.sheet_combobox.GetValue()
    grid = window.peak_params_grid
    peak_label = grid.GetCellValue(row, 1)
    fitting_model = grid.GetCellValue(row, 13)
    grid.SetCellValue(row, 2, f"{new_x:.2f}")
    if "LA" in fitting_model and area is not None:
        grid.SetCellValue(row, 6, f"{area:.2f}")
    grid.SetCellValue(row, 3, f"{new_height:.2f}")
    cl = window.Data['Core levels'].get(sheet_name, {})
    peaks = cl.get('Fitting', {}).get('Peaks', {}) if isinstance(cl.get('Fitting'), dict) else {}
    if peak_label in peaks:
        peaks[peak_label]['Position'] = new_x
        peaks[peak_label]['Height'] = new_height
        if "LA" in fitting_model and area is not None:
            peaks[peak_label]['Area'] = area
    if "LA" not in fitting_model:
        window.recalculate_peak_area(peak_index)


def drag_peak(window, peak_index, x, y):
    """PeakManipulation.on_cross_release for a plain drag: the top of the
    peak goes to (x, y); the height is y minus the background there."""
    grid = window.peak_params_grid
    row = peak_index * 2
    fitting_model = grid.GetCellValue(row, 13)
    window.load_view()
    bkg_y = window.background[np.argmin(np.abs(window.x_values - x))]
    new_height = max(y - bkg_y, 0)
    if "LA" in fitting_model:
        fwhm = float(grid.GetCellValue(row, 4))
        sigma = float(grid.GetCellValue(row, 7))
        gamma = float(grid.GetCellValue(row, 8))
        skew = float(grid.GetCellValue(row, 9)) if "LA*G" in fitting_model else None
        new_area = window.calculate_peak_area(fitting_model, new_height, fwhm, 0, sigma, gamma, skew)
        update_peak(window, peak_index, x, new_height, new_area)
        window.update_linked_peaks_recursive(peak_index, x, new_height, new_area)
    else:
        update_peak(window, peak_index, x, new_height)
        window.update_linked_peaks_recursive(peak_index, x, new_height)
    window.update_ratios()


# ── Editing a cell ──────────────────────────────────────────────────────
def set_cell(window, row, col, text):
    """Type `text` into a cell, as on the desktop: the edit is applied, then
    checked; a rejected edit puts the old text back and raises CellRejected."""
    grid = window.peak_params_grid
    old = grid.GetCellValue(row, col)
    grid.SetCellValue(row, col, text)
    try:
        peak_cell_changed(window, row, col)
    except CellRejected:
        grid.SetCellValue(row, col, old)
        raise
    except (ValueError, TypeError, KeyError, IndexError) as e:
        grid.SetCellValue(row, col, old)
        raise CellRejected(str(e))
    window.update_ratios()


# Utilities.propagate_constraint (typing '=' in a constraint cell), unchanged.
def propagate_constraint(window, row, col):
    """Propagate the constraint in the selected cell to all other peaks in the same column"""
    if row % 2 != 1 or col not in [2, 3, 4, 5, 6, 7, 8, 9]:
        return  # Only work on constraint rows and specific columns


    peak_index = row // 2
    peak_letter = chr(65 + peak_index)  # Convert peak index to letter (A, B, C...)

    # Get values from the source peak
    data_row = peak_index * 2
    source_value = float(window.peak_params_grid.GetCellValue(data_row, col))

    # Update all other rows based on column type
    num_peaks = window.peak_params_grid.GetNumberRows() // 2
    sheet_name = window.sheet_combobox.GetValue()
    peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']

    constraint_names = {
        2: 'Position',
        3: 'Height',
        4: 'FWHM',
        5: 'L/G',
        6: 'Area',
        7: 'Sigma',
        8: 'Gamma',
        9: 'Skew'
    }

    constraint_name = constraint_names.get(col)

    for i in range(num_peaks):
        if i == peak_index:  # Skip the source peak
            continue

        data_row_i = i * 2
        constraint_row_i = i * 2 + 1

        # Different handling based on column
        if col == 2:  # Position
            # Calculate split (difference in position)
            target_pos = float(window.peak_params_grid.GetCellValue(data_row_i, col))
            split = target_pos - source_value
            # Fix the +- issue when split is negative
            if split >= 0:
                constraint_value = f"{peak_letter}+{split:.2f}#0.1"
            else:
                constraint_value = f"{peak_letter}{split:.2f}#0.1"  # split is already negative
        elif col == 6:  # Area
            # Calculate ratio
            target_area = float(window.peak_params_grid.GetCellValue(data_row_i, col))
            source_area = float(window.peak_params_grid.GetCellValue(data_row, col))
            ratio = (target_area / source_area) if source_area != 0 else 1
            constraint_value = f"{peak_letter}*{ratio:.2f}"

        elif col == 7:  # Sigma - also update Gamma
            constraint_value = f"{peak_letter}*1"
            # Update sigma value
            window.peak_params_grid.SetCellValue(data_row_i, col, f"{source_value:.2f}")

            # Also update gamma and its constraint
            source_gamma = float(window.peak_params_grid.GetCellValue(data_row, 8))
            window.peak_params_grid.SetCellValue(data_row_i, 8, f"{source_gamma:.2f}")
            window.peak_params_grid.SetCellValue(constraint_row_i, 8, f"{peak_letter}*1")

            # Update in Data structure
            if i < len(list(peaks.values())):
                peak_data = list(peaks.values())[i]
                peak_data['Sigma'] = source_value
                peak_data['Gamma'] = source_gamma
                if 'Constraints' not in peak_data:
                    peak_data['Constraints'] = {}
                peak_data['Constraints']['Sigma'] = constraint_value
                peak_data['Constraints']['Gamma'] = f"{peak_letter}*1"

        elif col == 8:  # Gamma - also update Sigma
            constraint_value = f"{peak_letter}*1"
            # Update gamma value
            window.peak_params_grid.SetCellValue(data_row_i, col, f"{source_value:.2f}")

            # Also update sigma and its constraint
            source_sigma = float(window.peak_params_grid.GetCellValue(data_row, 7))
            window.peak_params_grid.SetCellValue(data_row_i, 7, f"{source_sigma:.2f}")
            window.peak_params_grid.SetCellValue(constraint_row_i, 7, f"{peak_letter}*1")

            # Update in Data structure
            if i < len(list(peaks.values())):
                peak_data = list(peaks.values())[i]
                peak_data['Gamma'] = source_value
                peak_data['Sigma'] = source_sigma
                if 'Constraints' not in peak_data:
                    peak_data['Constraints'] = {}
                peak_data['Constraints']['Gamma'] = constraint_value
                peak_data['Constraints']['Sigma'] = f"{peak_letter}*1"

        elif col in [4, 5, 9]:  # FWHM, L/G, Skew
            # Set all to the same value for these parameters
            constraint_value = f"{peak_letter}*1"
            # Also update the actual value in the data row
            window.peak_params_grid.SetCellValue(data_row_i, col, f"{source_value:.2f}")

            # Update in Data structure
            if constraint_name and i < len(list(peaks.values())):
                peak_data = list(peaks.values())[i]
                peak_data[constraint_name] = source_value

        else:  # Other columns
            constraint_value = f"{peak_letter}*1"

        # Set the constraint in the grid (if not already set for special cases)
        if col not in [7, 8] or not window.peak_params_grid.GetCellValue(constraint_row_i, col):
            window.peak_params_grid.SetCellValue(constraint_row_i, col, constraint_value)

        # Update in Data structure (if not already handled in special cases)
        if constraint_name and col not in [7, 8] and i < len(list(peaks.values())):
            peak_data = list(peaks.values())[i]
            if 'Constraints' not in peak_data:
                peak_data['Constraints'] = {}
            peak_data['Constraints'][constraint_name] = constraint_value


# PeakFittingGrid.on_peak_params_cell_changed, unchanged but for the wx calls.
def peak_cell_changed(window, row, col):
    """on_peak_params_cell_changed: the cell (row, col) already holds the new text."""
    new_value = window.peak_params_grid.GetCellValue(row, col)
    sheet_name = window.sheet_combobox.GetValue()
    peak_index = row // 2

    # # Define default constraint values
    # sheet_name = window.sheet_combobox.GetValue()
    # x_values = window.Data['Core levels'][sheet_name]['B.E.']
    # new_value = f"{min(x_values):.2f}:{max(x_values):.2f}"
    default_constraints = {
        2: '1:1000',  # Position
        3: '1:1e7',  # Height
        4: '0.3:3.5',  # FWHM
        5: '5:80',  # L/G
        6: '1:1e7',  # Area
        7: '0.3:3',  # Sigma
        8: '0.3:3',  # Gamma
        9: '0.01:2' # Skew
    }
    # Check each constraint cell with bounds checking
    constraint_row = row + 1
    max_rows = window.peak_params_grid.GetNumberRows()
    max_cols = window.peak_params_grid.GetNumberCols()

    # Only proceed if constraint row exists
    if constraint_row < max_rows:
        for col_idx in range(2, min(10, max_cols)):  # Don't exceed column bounds
            # Check if constraint cell is empty
            if not window.peak_params_grid.GetCellValue(constraint_row, col_idx).strip():
                # If empty, set default constraint
                window.peak_params_grid.SetCellValue(constraint_row, col_idx, default_constraints[col_idx])

    # Also update constraints in Data structure
    peak_index = row // 2
    sheet_name = window.sheet_combobox.GetValue()
    if sheet_name in window.Data['Core levels'] and 'Fitting' in window.Data['Core levels'][sheet_name]:
        peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']
        if peaks and peak_index < len(list(peaks.keys())):
            peak_label = list(peaks.keys())[peak_index]
            if 'Constraints' not in peaks[peak_label]:
                peaks[peak_label]['Constraints'] = {}

            # Map column indices to constraint names
            constraint_names = {
                2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G',
                6: 'Area', 7: 'Sigma', 8: 'Gamma', 9: 'Skew'
            }

            # Update any empty constraints
            for col_idx in range(2, 10):
                constraint_name = constraint_names[col_idx]
                if not peaks[peak_label]['Constraints'].get(constraint_name, ''):
                    peaks[peak_label]['Constraints'][constraint_name] = default_constraints[col_idx]



    if col == 1:  # Peak label column
        # Check for duplicate names
        existing_names = []
        for i in range(0, window.peak_params_grid.GetNumberRows(), 2):
            if i != row:  # Skip current row
                existing_names.append(window.peak_params_grid.GetCellValue(i, 1))

        if new_value in existing_names:
            raise CellRejected(f"Peak name '{new_value}' already exists. Cannot have duplicate peak names.")
    elif col in [2, 3, 4, 5, 6, 7, 8, 9] and row % 2 == 1:  # Constraint rows

        # Check if this is a constraint row and the value contains "="
        if row % 2 == 1 and col in [2, 3, 4, 5, 6, 7, 8, 9] and "=" in new_value:
            # Remove the "=" from the cell
            window.peak_params_grid.SetCellValue(row, col, new_value.replace("=", ""))

            # Import and call the propagate_constraint function
            propagate_constraint(window, row, col)
            return  # Skip the rest of the function
        elif new_value.lower() in ['fi', 'fix', 'fixe', 'fixed']:
            new_value = 'Fixed'
            # Make sure the "Fixed" value gets saved right away to the Data structure
            constraint_keys = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
            constraint_key = constraint_keys[col - 2]

            # Save to the Data structure immediately
            if sheet_name in window.Data['Core levels'] and 'Fitting' in window.Data['Core levels'][sheet_name]:
                peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']
                correct_peak_key = list(peaks.keys())[peak_index]

                if 'Constraints' not in peaks[correct_peak_key]:
                    peaks[correct_peak_key]['Constraints'] = {}

                # Save the "Fixed" value directly
                peaks[correct_peak_key]['Constraints'][constraint_key] = new_value

            # Update the cell value
            window.peak_params_grid.SetCellValue(row, col, new_value)
            return
        elif new_value == 'F':
            new_value = 'F*1'
            window.peak_params_grid.SetCellValue(row, col, new_value)
            return
        elif new_value.startswith('#'):
            # Check if '#' is not followed by at least one digit
            if len(new_value) == 1 or not new_value[1:].replace('.', '', 1).isdigit():
                raise CellRejected(f"Wrong Value entered")

            # If '#' is followed by a valid number, proceed with the calculation
            peak_value = float(window.peak_params_grid.GetCellValue(row - 1, col))
            new_value = str(round(peak_value - float(new_value[1:]), 2)) + ':' + str(
                round(peak_value + float(new_value[1:]), 2))
            window.peak_params_grid.SetCellValue(row, col, new_value)

            # Save to Data structure before returning
            sheet_name = window.sheet_combobox.GetValue()
            peak_index = row // 2
            if sheet_name in window.Data['Core levels'] and 'Fitting' in window.Data['Core levels'][sheet_name]:
                peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']
                if peaks and peak_index < len(list(peaks.keys())):
                    peak_label = list(peaks.keys())[peak_index]
                    if 'Constraints' not in peaks[peak_label]:
                        peaks[peak_label]['Constraints'] = {}

                    # Map column indices to constraint names
                    constraint_names = {
                        2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G',
                        6: 'Area', 7: 'Sigma', 8: 'Gamma', 9: 'Skew'
                    }

                    peaks[peak_label]['Constraints'][constraint_names[col]] = new_value

            return
        elif new_value.startswith(('+', '/', '*')):
            raise CellRejected(f"Wrong Value entered")
        # Add validation for expressions starting with '-' and not containing ':'
        elif new_value.startswith('-') and ':' not in new_value:
            raise CellRejected(f"Wrong Value entered")

        elif ':' in new_value:
            parts = new_value.split(':')
            if len(parts) != 2:
                raise CellRejected("Constraint with ':' must have exactly one colon")

            try:
                # Check if both parts are valid numbers
                float(parts[0].strip())
                float(parts[1].strip())
            except ValueError:
                raise CellRejected("Constraint with ':' must have numbers before and after the colon")

        # Pattern to match all possible formats
        pattern = r'^([A-Z])([+\-*/])(\d+\.?\d*)(?:#(\d+\.?\d*))?$'
        match = re.match(pattern, new_value)
        if not new_value:  # If empty string
            if col == 2:
                sheet_name = window.sheet_combobox.GetValue()
                x_values = window.Data['Core levels'][sheet_name]['B.E.']
                new_value = f"{min(x_values):.2f}:{max(x_values):.2f}"
            elif col == 4:
                new_value = "0.3:3.5"
            elif col == 5:
                new_value = "1:80"
            elif col == 6:
                new_value = "1:1e7"
            elif col == 7:
                new_value = "0.2:3"
            elif col == 8:
                new_value = "0.2:3"
            elif col == 9:
                new_value = "0.1:1"
            window.peak_params_grid.SetCellValue(row, col, new_value)

        # Save ALL constraint changes to Data structure
        sheet_name = window.sheet_combobox.GetValue()
        peak_index = row // 2
        if sheet_name in window.Data['Core levels'] and 'Fitting' in window.Data['Core levels'][
            sheet_name]:
            peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']
            if peaks and peak_index < len(list(peaks.keys())):
                peak_label = list(peaks.keys())[peak_index]
                if 'Constraints' not in peaks[peak_label]:
                    peaks[peak_label]['Constraints'] = {}

                # Map column indices to constraint names
                constraint_names = {
                    2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G',
                    6: 'Area', 7: 'Sigma', 8: 'Gamma', 9: 'Skew'
                }

                # Save the constraint value
                if col in constraint_names:
                    peaks[peak_label]['Constraints'][constraint_names[col]] = new_value

        if match:
            referenced_peak = match.group(1)
            letter_index = ord(referenced_peak) - 65
            current_peak = row // 2

            if letter_index == current_peak:
                raise CellRejected(f"Cannot reference the same peak ({referenced_peak}).")

            if letter_index * 2 >= window.peak_params_grid.GetNumberRows():
                raise CellRejected(f"Peak {referenced_peak} does not exist.")

        elif new_value.upper() in 'ABCDEFGHIJKLMNOP':
            letter_index = ord(new_value.upper()) - 65
            current_peak = row // 2

            if letter_index == current_peak:
                raise CellRejected(f"Cannot reference the same peak ({new_value.upper()}).")

            if letter_index * 2 >= window.peak_params_grid.GetNumberRows():
                raise CellRejected(f"Peak {new_value.upper()} does not exist.")
    elif col in [0, 10, 11, 12]:
        raise CellRejected("")
    elif col not in [13, 14] and row % 2 == 1:  # Constraint row
        if not new_value:  # If the cell is empty
            new_value = default_constraints.get(col, '')
            window.peak_params_grid.SetCellValue(row, col, new_value)
    # Allow only numeric input for specific columns in non-constraint rows
    elif col not in [1, 13, 14] and row % 2 == 0:
        try:
            float(new_value)  # This will handle integers, floats, and scientific notation
        except ValueError:
            raise CellRejected("")


    if col == 2 and new_value.upper() in 'ABCDEFGHIJKLMNOP':
        letter_index = ord(new_value.upper()) - 65
        if letter_index * 2 == row - 1:  # Same peak
            new_value = "0:1000"  # Default value
        else:
            current_split = float(window.peak_params_grid.GetCellValue(row-1, 12))
            ref_split = float(window.peak_params_grid.GetCellValue(letter_index * 2, 12))
            split_diff = current_split - ref_split

            if split_diff != 0:
                if split_diff >= 0:
                    new_value = f"{new_value.upper()}+{split_diff:.2f}#0.1"
                else:
                    new_value = f"{new_value.upper()}{split_diff:.2f}#0.1"  # split_diff is already negative
            else:
                new_value = new_value.upper() + '*1'
    elif col == 6 and new_value.upper() in 'ABCDEFGHIJKLMNOP':
        letter_index = ord(new_value.upper()) - 65
        if letter_index * 2 == row - 1:  # Same peak
            new_value = "1:1e7"  # Default value
        else:
            current_ratio = float(window.peak_params_grid.GetCellValue(row - 1, 11))
            ref_ratio = float(window.peak_params_grid.GetCellValue(letter_index * 2, 11))
            ratio = current_ratio / ref_ratio
            if ratio != 1:
                new_value = f"{new_value.upper()}*{ratio:.2f}#0.01"
            else:
                new_value = new_value.upper() + '*1'
    elif new_value.lower() in 'abcdefghijklmnop':
        letter_index = ord(new_value.upper()) - 65
        if letter_index * 2 == row - 1:  # Same peak
            if col == 2:
                sheet_name = window.sheet_combobox.GetValue()
                x_values = window.Data['Core levels'][sheet_name]['B.E.']
                new_value = f"{min(x_values):.2f}:{max(x_values):.2f}"
            elif col ==4:
                new_value = "0.3:3.5"
            elif col ==5:
                new_value = "1:80"
            elif col ==6:
                new_value = "1:1e7"
            elif col ==7:
                new_value = "0.2:3"
            elif col ==8:
                new_value = "0.2:3"
            elif col ==9:
                new_value = "0.1:1"
        else:
            new_value = new_value.upper() + '*1'
        window.peak_params_grid.SetCellValue(row, col, new_value)

    # NEW CODE - Handle cross-core-level constraint auto-expansion with error checking
    elif row % 2 == 1 and col in [2, 3, 4, 5, 6, 7, 8, 9]:
        # Check if it matches cross-core-level pattern like "C1s_A", "sr3d_a", "Sr3d_A"
        cross_core_pattern = r'^([^_]+)_([A-Za-z])$'
        match = re.match(cross_core_pattern, new_value, re.IGNORECASE)

        if match:
            core_level_name, peak_letter = match.groups()

            # Normalize the peak letter to uppercase
            peak_letter = peak_letter.upper()

            # Find the core level with case-insensitive matching
            actual_core_level_name = None
            for existing_name in window.Data['Core levels'].keys():
                if existing_name.lower() == core_level_name.lower():
                    actual_core_level_name = existing_name
                    break

            # Error: Core level doesn't exist
            if not actual_core_level_name:
                raise CellRejected(f"Core level '{core_level_name}' does not exist.")

            core_level_data = window.Data['Core levels'][actual_core_level_name]

            # Error: Core level has no fitting data
            if ('Fitting' not in core_level_data or
                    'Peaks' not in core_level_data['Fitting']):
                raise CellRejected(f"Core level '{actual_core_level_name}' has no fitted peaks.")

            peaks = core_level_data['Fitting']['Peaks']
            peak_keys = list(peaks.keys())
            peak_index = ord(peak_letter) - ord('A')

            # Error: Peak letter doesn't exist in that core level
            if peak_index >= len(peak_keys):
                raise CellRejected(f"Peak {peak_letter} does not exist in core level '{actual_core_level_name}'.")

            # Success: Expand the constraint
            peak_key = peak_keys[peak_index]
            ref_peak_data = peaks[peak_key]

            # Use the actual core level name in the constraint
            normalized_ref = f"{actual_core_level_name}_{peak_letter}"

            if col == 2:  # Position constraint
                # Get current position and reference position
                current_pos = float(window.peak_params_grid.GetCellValue(row - 1, col))
                ref_pos = float(ref_peak_data.get('Position', current_pos))

                # Calculate difference
                difference = current_pos - ref_pos

                # Create constraint string
                if difference >= 0:
                    new_value = f"{normalized_ref}+{difference:.2f}#0.1"
                else:
                    new_value = f"{normalized_ref}{difference:.2f}#0.1"  # difference is already negative

            elif col == 6:  # Area constraint
                # Get current area and reference area for ratio calculation
                current_area = float(window.peak_params_grid.GetCellValue(row - 1, col))
                ref_area = float(ref_peak_data.get('Area', current_area))

                # Calculate ratio
                ratio = (current_area / ref_area) if ref_area != 0 else 1

                if ratio != 1:
                    new_value = f"{normalized_ref}*{ratio:.2f}#0.01"
                else:
                    new_value = f"{normalized_ref}*1"

            else:  # FWHM, Sigma, Gamma, Height, L/G, Skew
                # For non-position/area parameters, just add *1
                new_value = f"{normalized_ref}*1"

            # Update the cell with expanded constraint
            window.peak_params_grid.SetCellValue(row, col, new_value)

    # Convert lowercase to uppercase in expressions like a*0.5
    if '*' in new_value or '+' in new_value or '-' in new_value:
        # Determine the operator and split accordingly
        if '*' in new_value:
            operator = '*'
        elif '+' in new_value:
            operator = '+'
        else:  # '-' in new_value
            operator = '-'

        parts = new_value.split(operator)
        if len(parts) == 2 and parts[0].lower() in 'abcdefghij':
            parts[0] = parts[0].upper()
            new_value = operator.join(parts)
            window.peak_params_grid.SetCellValue(row, col, new_value)

    if sheet_name in window.Data['Core levels'] and 'Fitting' in window.Data['Core levels'][sheet_name] and 'Peaks' in \
            window.Data['Core levels'][sheet_name]['Fitting']:
        peaks = window.Data['Core levels'][sheet_name]['Fitting']['Peaks']
        peak_keys = list(peaks.keys())

        if peak_index < len(peak_keys):
            correct_peak_key = peak_keys[peak_index]

            if row % 2 == 0:  # Main parameter row
                if col == 1:  # Label
                    # Update the label while preserving order
                    new_peaks = {}
                    for i, (key, value) in enumerate(peaks.items()):
                        if i == peak_index:
                            new_peaks[new_value] = value
                        else:
                            new_peaks[key] = value
                    window.Data['Core levels'][sheet_name]['Fitting']['Peaks'] = new_peaks
                elif col == 2:  # Position
                    peaks[correct_peak_key]['Position'] = float(new_value)
                elif col in [3, 4, 5, 6, 7, 8,9]:  # Height, FWHM, L/G, Area, Sigma, Gamma changed
                    def try_float(value, default=0.0):
                        try:
                            return float(value)
                        except (ValueError, TypeError):
                            return default


                    model = peaks[correct_peak_key]['Fitting Model']
                    height = float(window.peak_params_grid.GetCellValue(row, 3))
                    fwhm = float(window.peak_params_grid.GetCellValue(row, 4))
                    fraction = float(window.peak_params_grid.GetCellValue(row, 5))
                    area = float(window.peak_params_grid.GetCellValue(row, 6))
                    sigma = try_float(window.peak_params_grid.GetCellValue(row, 7), 0.0)
                    gamma = try_float(window.peak_params_grid.GetCellValue(row, 8), 0.0)
                    skew = try_float(window.peak_params_grid.GetCellValue(row, 9))
                    # Handle SingleEntity model
                    if model == 'SingleEntity':
                        # For SingleEntity, preserve envelope data during updates
                        current_data = peaks[correct_peak_key]

                        # Store envelope data if it exists
                        envelope_backup = {}
                        if 'x_data' in current_data:
                            envelope_backup['x_data'] = current_data['x_data']
                        if 'y_data' in current_data:
                            envelope_backup['y_data'] = current_data['y_data']
                        if 'Original_Position' in current_data:
                            envelope_backup['Original_Position'] = current_data['Original_Position']

                        # Update standard parameters
                        peaks[correct_peak_key].update({
                            'Position': float(window.peak_params_grid.GetCellValue(row, 2)),
                            'Height': height,
                            'FWHM': fwhm,
                            'L/G': fraction,
                            'Area': area,
                            'Sigma': sigma,  # Shift value
                            'Gamma': gamma,  # Scale value
                            'Fitting Model': model
                        })

                        # Restore envelope data
                        peaks[correct_peak_key].update(envelope_backup)
                    elif model in ["LA (Area, \u03c3/\u03b3, \u03b3)"]:
                        if col == 5:  # L/G ratio changed
                            gamma = float(window.peak_params_grid.GetCellValue(row, 8))
                            sigma = (fraction / 100) * gamma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.2f}")
                        elif col == 7:  # Sigma changed
                            fraction = 100 * sigma / (sigma + gamma)
                            window.peak_params_grid.SetCellValue(row, 5, f"{fraction:.2f}")
                        elif col == 8:  # Gamma changed
                            sigma = (fraction / 100) * gamma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.3f}")
                        elif col == 9:
                            pass
                    elif model in ["LA (Area, \u03c3, \u03b3)"]:
                        if col == 5:  # L/G ratio changed
                            pass
                        elif col == 7:  # Sigma changed
                            fraction = 100 * sigma / (sigma + gamma)
                            window.peak_params_grid.SetCellValue(row, 5, f"{fraction:.2f}")
                        elif col == 8:  # Gamma changed
                            sigma = (fraction / 100) * gamma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.3f}")
                        elif col == 9:
                            pass
                    elif model in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
                        if col == 5:  # L/G ratio changed
                            gamma = float(window.peak_params_grid.GetCellValue(row, 8))
                            sigma = (fraction / 100) * gamma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.2f}")
                        elif col == 7:  # Sigma changed
                            fraction = 100 * sigma / (sigma + gamma)
                            window.peak_params_grid.SetCellValue(row, 5, f"{fraction:.2f}")
                        elif col == 8:  # Gamma changed
                            sigma = (fraction / 100) * gamma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.3f}")
                        elif col == 9:
                            skew = float(window.peak_params_grid.GetCellValue(row, 9))
                            peaks[correct_peak_key]['Skew'] = float(new_value)
                    elif model in ["Voigt (Area, L/G, \u03c3)"]:
                        if col == 5: # L/G ratio changed
                            sigma = float(window.peak_params_grid.GetCellValue(row, 7))
                            gamma = (fraction / 100) * sigma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 8, f"{gamma:.3f}")
                        elif col == 7:  # Sigma changed
                            fraction = float(window.peak_params_grid.GetCellValue(row, 5))
                            gamma = (fraction / 100) * sigma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 8, f"{gamma:.3f}")
                        elif col == 8:
                            pass
                    elif model in ["Voigt (Area, L/G, \u03c3, S)"]:
                        if col == 5: # L/G ratio changed
                            sigma = float(window.peak_params_grid.GetCellValue(row, 7))
                            gamma = (fraction / 100) * sigma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 8, f"{gamma:.3f}")
                        elif col == 7:  # Sigma changed
                            fraction = float(window.peak_params_grid.GetCellValue(row, 5))
                            gamma = (fraction / 100) * sigma / (1 - fraction / 100)
                            window.peak_params_grid.SetCellValue(row, 8, f"{gamma:.3f}")
                        elif col == 8:
                            pass
                        elif col == 9:
                            value = float(window.peak_params_grid.GetCellValue(row, 9))
                            if value == 0:
                                skew = 0.1
                                window.peak_params_grid.SetCellValue(row, 9, f"{skew:.3f}")
                    elif model in ["DS (A, \u03c3, \u03b3)", "DS*G (A, \u03c3, \u03b3, S)"]:
                        # For DS model, sigma and gamma are independent parameters
                        # No need to update other parameters when one changes
                        if col == 5:
                            # L/G ratio isn't relevant for DS model, ignore changes
                            pass
                        elif col == 7:
                            # Sigma changed, no automatic updates needed
                            pass
                        elif col == 8:
                            # Gamma changed, no automatic updates needed
                            pass
                        elif col == 9:
                            value = float(window.peak_params_grid.GetCellValue(row, 9))
                            if value == 0:
                                skew = 0.0
                                window.peak_params_grid.SetCellValue(row, 9, f"{skew:.3f}")
                    elif model in ["GL (Area)"]:
                            # For Gaussian-Lorentzian area-based model
                            sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
                            height = area / (sigma * np.sqrt(2 * np.pi))
                            window.peak_params_grid.SetCellValue(row, 3, f"{height:.2f}")
                    elif model in ["SGL (Area)"]:
                            # For Sum of Gaussian-Lorentzian area-based model
                            sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
                            gamma = fwhm / 2
                            height = area / ((1 - fraction / 100) * sigma * np.sqrt(2 * np.pi) + (
                                        fraction / 100) * np.pi * gamma)
                            window.peak_params_grid.SetCellValue(row, 3, f"{height:.2f}")
                    elif model == "D-parameter":
                        return
                    else:
                        # Recalculate area
                        area = window.calculate_peak_area(model, height, fwhm, fraction, sigma, gamma,skew)
                        window.peak_params_grid.SetCellValue(row, 6, f"{area:.2f}")

                    window.update_ratios()
                    # Update grid and data
                    peaks[correct_peak_key].update({
                        'Height': round(height, 2),
                        'FWHM': round(fwhm, 2),
                        'L/G': round(fraction, 2),
                        'Area': round(area, 2),
                        'Sigma': round(sigma, 2),
                        'Gamma': round(gamma, 2),
                        'Skew': round(skew, 3)
                    })
                elif col == 13:  # Fitting Model changed
                    peaks[correct_peak_key]['Fitting Model'] = new_value

                    # Default values based on model type
                    if new_value in ["LA (Area, \u03c3, \u03b3)", "LA (Area, \u03c3/\u03b3, \u03b3)"]:
                        # LA models
                        fraction = 50.0
                        sigma = 2.7
                        gamma = 2.7
                        skew = 0.64
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.01:10")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.01:10")  # Gamma constraint
                    elif new_value in ["LA*G (Area, \u03c3/\u03b3, \u03b3)"]:
                        # LA*G model
                        fraction = 50.0
                        sigma = 2.7
                        gamma = 2.7
                        skew = 0.64
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.01:4")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.01:4")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "0.01:2")  # Skew constraint
                    elif new_value == "Pseudo-Voigt (Area)":
                        # Pseudo-Voigt
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.15
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "5:80")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "Fixed")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "Fixed")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "Fixed")  # Skew constraint
                    elif new_value in ["Voigt (Area, L/G, \u03c3)"]:
                        # Voigt models with L/G
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.5
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "15:85")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.3:3")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.3:3")  # Gamma constraint
                    elif new_value in ["Voigt (Area, \u03c3, \u03b3)"]:
                        # Voigt models with separate sigma/gamma
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.5
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.3:3")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.3:3")  # Gamma constraint
                    elif new_value in ["Voigt (Area, L/G, \u03c3, S)"]:
                        # Skewed Voigt
                        fraction = 20.0
                        sigma = 1.2
                        gamma = 0.4
                        skew = 0.01
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "15:85")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.2:1.5")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.2:1.5")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "0.01:0.7")  # Skew constraint
                    elif new_value in ["DS (A, \u03c3, \u03b3)"]:
                        # Doniach-Sunjic model
                        fraction = 0.0  # Not used in DS model
                        sigma = 0
                        gamma = 0.5
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint (not used)
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.3:1.5")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.1:1.5")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "-0.2:0.2")  # Skew/asymmetry constraint
                    elif new_value in ["DS*G (A, \u03c3, \u03b3, S)"]:
                        # Doniach-Sunjic model
                        fraction = 20  # Not used in DS model
                        sigma = 0.5
                        gamma = 0.5
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint (not used)
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.3:1.5")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.1:1.5")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "0:0.2")  # Skew/asymmetry constraint
                    elif new_value == "ExpGauss.(Area, \u03c3, \u03b3)":
                        # Exponential Gaussian
                        fraction = 20.0
                        sigma = 0.3
                        gamma = 1.2
                        skew = 0.64
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "0.01:1")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "0.01:3")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "0.01:2")  # Skew constraint
                    elif new_value == "GL (Area)":
                        # GL Area based
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.15
                        skew = 0.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "5:80")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "Fixed")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "Fixed")  # Gamma constraint
                    elif new_value == "SGL (Area)":
                        # SGL Area based
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.15
                        skew = 0.1
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "5:80")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "Fixed")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "Fixed")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "0.01:1")  # Skew constraint
                    elif new_value == "D-parameter":
                        # D-parameter
                        fraction = 2.0
                        sigma = 1.0
                        gamma = 1.0
                        skew = 7.0
                        # Set constraints
                        window.peak_params_grid.SetCellValue(row + 1, 5, "Fixed")  # L/G constraint
                        window.peak_params_grid.SetCellValue(row + 1, 7, "Fixed")  # Sigma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 8, "Fixed")  # Gamma constraint
                        window.peak_params_grid.SetCellValue(row + 1, 9, "5:9")  # Skew constraint
                    else:
                        # Default values for any other model
                        fraction = 20.0
                        sigma = 1.0
                        gamma = 0.15
                        skew = 0.1

                    # Get height and FWHM from grid
                    height = float(
                        window.peak_params_grid.GetCellValue(row, 3)) if window.peak_params_grid.GetCellValue(row,
                                                                                                          3) else 1000.0
                    fwhm = float(window.peak_params_grid.GetCellValue(row, 4)) if window.peak_params_grid.GetCellValue(
                        row, 4) else 1.6

                    # Update grid values with model-specific defaults
                    window.peak_params_grid.SetCellValue(row, 5, f"{fraction:.2f}")
                    window.peak_params_grid.SetCellValue(row, 7, f"{sigma:.3f}")
                    window.peak_params_grid.SetCellValue(row, 8, f"{gamma:.3f}")
                    window.peak_params_grid.SetCellValue(row, 9, f"{skew:.3f}")

                    # Recalculate area with new model parameters
                    area = window.calculate_peak_area(new_value, height, fwhm, fraction, sigma, gamma, skew)
                    window.peak_params_grid.SetCellValue(row, 6, f"{area:.2f}")

                    # Update peak data in memory
                    peaks[correct_peak_key].update({
                        'L/G': fraction,
                        'Sigma': sigma,
                        'Gamma': gamma,
                        'Skew': skew,
                        'Area': area
                    })

                    # Update constraints in data structure
                    if 'Constraints' not in peaks[correct_peak_key]:
                        peaks[correct_peak_key]['Constraints'] = {}

                    # Get all constraint values from grid
                    for c_idx, c_key in enumerate(
                            ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew'], 2):
                        constraint_value = window.peak_params_grid.GetCellValue(row + 1, c_idx)
                        peaks[correct_peak_key]['Constraints'][c_key] = constraint_value

                    # Refresh the display
                    select_sheet(window, sheet_name)
            elif row % 2 == 1:  # Constraint rowelse:  # Constraint row
                if col in [2, 3, 4, 5, 6, 7, 8, 9]:
                    constraint_keys = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
                    column_to_constraint = {2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9:7}
                    constraint_key = constraint_keys[column_to_constraint[col]]

                    if 'Constraints' not in peaks[correct_peak_key]:
                        peaks[correct_peak_key]['Constraints'] = {}

                    # Always save the constraint value exactly as entered
                    peaks[correct_peak_key]['Constraints'][constraint_key] = new_value

        # Ensure numeric values are displayed with 2 decimal places
    if col in [2, 3, 4, 5, 6, 7, 8, 9] and row % 2 == 0:  # Only for main parameter rows, not constraint rows
        try:
            formatted_value = f"{float(new_value):.2f}"
            window.peak_params_grid.SetCellValue(row, col, formatted_value)
        except ValueError:
            pass


    # Update all data in window.Data for all peaks
    for i in range(window.peak_params_grid.GetNumberRows() // 2):
        row_data = i * 2  # Data row
        row_constraint = i * 2 + 1  # Constraint row
        peak_label = window.peak_params_grid.GetCellValue(row_data, 1)

        # Update main parameters with safe conversion
        sigma_str = window.peak_params_grid.GetCellValue(row_data, 7)
        gamma_str = window.peak_params_grid.GetCellValue(row_data, 8)

        # PRESERVE EXISTING DATA - don't replace, just update
        if peak_label not in peaks:
            peaks[peak_label] = {}

        # Preserve SingleEntity envelope data
        existing_data = peaks[peak_label]
        envelope_backup = {}
        if existing_data.get('Fitting Model') == 'SingleEntity':
            if 'x_data' in existing_data:
                envelope_backup['x_data'] = existing_data['x_data']
            if 'y_data' in existing_data:
                envelope_backup['y_data'] = existing_data['y_data']
            if 'Original_Position' in existing_data:
                envelope_backup['Original_Position'] = existing_data['Original_Position']

        peaks[peak_label].update({
            'Position': float(window.peak_params_grid.GetCellValue(row_data, 2)),
            'Height': float(window.peak_params_grid.GetCellValue(row_data, 3)),
            'FWHM': float(window.peak_params_grid.GetCellValue(row_data, 4)),
            'L/G': float(window.peak_params_grid.GetCellValue(row_data, 5)),
            'Area': float(window.peak_params_grid.GetCellValue(row_data, 6)),
            'Sigma': _safe_float(sigma_str),
            'Gamma': _safe_float(gamma_str),
            'Skew': float(window.peak_params_grid.GetCellValue(row_data, 9)),
            'Fitting Model': window.peak_params_grid.GetCellValue(row_data, 13),
        })

        # Restore envelope data for SingleEntity
        if envelope_backup:
            peaks[peak_label].update(envelope_backup)

        # Update constraints

        if 'Constraints' not in peaks[peak_label]:
            peaks[peak_label]['Constraints'] = {}

        constraint_keys = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
        for col_idx, key in enumerate(constraint_keys, start=2):
            value = window.peak_params_grid.GetCellValue(row_constraint, col_idx)

            # If value is empty, use defaults
            if not value:
                # Use appropriate default based on column
                if key == 'Position':
                    # Get min/max from current sheet's data
                    x_values = window.Data['Core levels'][sheet_name]['B.E.']
                    min_pos = min(x_values)
                    max_pos = max(x_values)
                    value = f"{min_pos:.2f}:{max_pos:.2f}"
                elif key == 'Height':
                    value = '1:1e7'
                elif key == 'FWHM':
                    value = '0.3:3.5'
                elif key == 'L/G':
                    value = '5:80'
                elif key == 'Area':
                    value = '1:1e7'
                elif key == 'Sigma':
                    value = '0.3:3'
                elif key == 'Gamma':
                    value = '0.3:3'
                elif key == 'Skew':
                    value = '0.01:2'

                # Update grid with default
                window.peak_params_grid.SetCellValue(row_constraint, col_idx, value)

            peaks[peak_label]['Constraints'][key] = value

    # Refresh the grid to ensure it reflects the current state of window.Data
    

    # Replot the peaks with updated parameters
