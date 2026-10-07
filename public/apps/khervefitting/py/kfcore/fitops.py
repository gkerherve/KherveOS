# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: more buttons of the Fitting window (ToolsMenu/Fitting_Screen.py,
# dev-AI v1.93) - Add Doublet / Add Named Doublet, Remove (active) region, and
# the Batching tab's Propagate Fittings / Constraints / Row - with the pieces
# they call: On_Mouse_Defs.redraw_all_regions_background,
# PlotManager.plot_background, FileManagerWindow.recreate_background_from_ranges,
# Save.copy_all_peak_parameters / paste_all_peak_parameters (the definitions in
# force: Save.py defines them twice, the later ones win) and the window's
# copy/paste_background_directly. The desktop's temporary clipboard files are
# plain dicts here; wx dialogs become arguments or ValueError messages.

import copy
import json
import os
import re

import numpy as np

from .backgrounds import BackgroundCalculations
from .compat import trapz


def print(*a, **k):  # noqa: A001 - the desktop's console messages are not wanted on stdout here
    pass


class FitOpError(ValueError):
    """The desktop's message box (the operation does nothing)."""


# ── Library: doublet splittings (data/splittings.json) ──────────────────
_DS = None


def _splittings():
    global _DS
    if _DS is None:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'splittings.json')
        try:
            with open(path, encoding='utf-8') as f:
                _DS = json.load(f)['ds']
        except OSError:
            _DS = {}
    return _DS


def get_doublet_splitting(element, orbital):
    """FittingWindow.get_doublet_splitting: library 'ds' of instrument C-Al1486 (0.0 if none)."""
    m = re.match(r'(\d)([spdf])', orbital)
    if m:
        v = _splittings().get(f"{element}|{m.group(1)}{m.group(2)}")
        if v is not None:
            return v
    return 0.0


# ── Add Doublet / Add Named Doublet ─────────────────────────────────────
AREA_BASED = ["GL (Area)", "SGL (Area)", "Pseudo-Voigt (Area)",
              "Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)",
              "Voigt (Area, L/G, σ, S)", "ExpGauss.(Area, σ, γ)",
              "LA (Area, σ, γ)", "LA (Area, σ/γ, γ)",
              "LA*G (Area, σ/γ, γ)", "DS (A, σ, γ)",
              "DS*G (A, σ, γ, S)"]
# on_add_named_doublet's list spells this one "ExpGauss (Area, ...)" (no dot).
AREA_BASED_NAMED = [m.replace("ExpGauss.(", "ExpGauss (") for m in AREA_BASED]


def _first_peak(w):
    """add_peak_params() without a position: at the maximum of the data / residual."""
    from .curves import residual_for_new_peak
    from .sheets import add_peak
    w.load_view()
    return add_peak(w, residual=residual_for_new_peak(w))


def add_doublet(w, name=None):
    """on_add_doublet (name None: the core level from the sheet name) or
    on_add_named_doublet (name: the core level typed in its dialog, e.g. 'Fe2p').
    Returns the indices of the peaks added ([i] for an s level on_add_doublet)."""
    from .sheets import CellRejected, add_peak
    if "----" in (w.selected_fitting_method or ''):
        raise FitOpError("Please select a valid peak model.")
    low, high = w.fitting_window.get_overall_background_range()
    if low in (None, '') or high in (None, ''):
        raise CellRejected("Please create a background first.")
    sheet_name = w.sheet_combobox.GetValue()
    grid = w.peak_params_grid
    named = name is not None

    if named:
        custom_name = (name or '').strip()
        if not custom_name:
            raise FitOpError("Please enter a valid core level name.")
        m = re.search(r'(\d+[spdf])', custom_name)
        if not m:
            raise FitOpError("Invalid core level name. Must contain orbital (e.g., 1s, 2p, 3d, 4f).")
        orbital = m.group()
        em = re.match(r'([A-Z][a-z]*)', custom_name)
        if not em:
            raise FitOpError("Invalid core level name. Must start with element symbol.")
        element = em.group(1)
        if orbital[-1] == 's':
            raise FitOpError("Cannot fit doublet peak on a S orbital core level.")
        element_orbital = custom_name
    else:
        m = re.match(r'([A-Z][a-z]*\d+[spdf])', sheet_name)
        element_orbital = m.group(1) if m else sheet_name.split()[0]
        om = re.search(r'(\d+[spdf])', element_orbital)
        if not om:
            raise FitOpError("Cannot fit doublet peak on a S orbital core level.")
        orbital = om.group()
        element = re.match(r'([A-Z][a-z]*)', element_orbital).group(1)
        if orbital[-1] == 's':
            return [_first_peak(w)]

    first_peak = _first_peak(w)
    row1 = first_peak * 2
    first_position = float(grid.GetCellValue(row1, 2))
    first_height = float(grid.GetCellValue(row1, 3))
    intensity_factor = {'p': 0.50, 'd': 0.667, 'f': 0.75}.get(orbital[-1], 0.50)
    splitting = get_doublet_splitting(element, orbital)
    second_peak = add_peak(w, first_position + splitting, first_height * intensity_factor)
    row2 = second_peak * 2
    letter = chr(65 + first_peak)
    method = w.selected_fitting_method

    if any(e in element_orbital for e in ['Ti2p', 'V2p']) and any(x in method for x in ["Voigt (Area, L/G"]):
        lg_constraint = "2:80"
    else:
        lg_constraint = f"{letter}*1"
    grid.SetCellValue(row2 + 1, 5, lg_constraint)

    if any(e in element_orbital for e in ['Ti2p', 'V2p']) and any(x in method for x in ["LA", "GL", "SGL"]):
        fwhm_constraint = "0.3:3.5"
    elif "Voigt" in method and method not in ["Voigt (Area)", "Voigt (Area, L/G, S)"]:
        fwhm_constraint = "0.3:3.5"
    else:
        fwhm_constraint = f"{letter}*1"
    grid.SetCellValue(row2 + 1, 4, fwhm_constraint)

    height_constraint = "0:1e7"
    area_constraint = "0:1e7"
    if named:
        factor = {'p': 0.5, 'd': 0.667, 'f': 0.75}.get(orbital[-1], 0.5)
        if method in AREA_BASED_NAMED:
            area_constraint = f"{letter}*{factor:.3f}#0.01"
        else:
            height_constraint = f"{letter}*{factor:.3f}#0.01"
    else:
        factor = {'p': 0.5, 'd': 0.667, 'f': 0.75}[orbital[-1]]
        if method in AREA_BASED:
            area_constraint = f"{letter}*{factor}#0.01"
        else:
            height_constraint = f"{letter}*{factor}#0.01"
    grid.SetCellValue(row2 + 1, 3, height_constraint)
    grid.SetCellValue(row2 + 1, 6, area_constraint)

    position_constraint = f"{letter}+{splitting:.2f}#0.2" if named else f"{letter}+{splitting}#0.2"
    grid.SetCellValue(row2 + 1, 2, position_constraint)

    sigma_constraint = f"{letter}*1"
    grid.SetCellValue(row2 + 1, 7, sigma_constraint)
    if any(e in element_orbital for e in ['Ti2p', 'V2p']) and any(x in method for x in ["Voigt (Area, σ", "DS*G"]):
        gamma_constraint = "0.3:3"
    else:
        gamma_constraint = f"{letter}*1"
    grid.SetCellValue(row2 + 1, 8, gamma_constraint)
    skew_constraint = f"{letter}*1"
    grid.SetCellValue(row2 + 1, 9, skew_constraint)

    n1, n2 = first_peak + 1, second_peak + 1
    sub1, sub2 = {'p': ('3/2', '1/2'), 'd': ('5/2', '3/2'), 'f': ('7/2', '5/2')}[orbital[-1]]
    peak1_name = f"{element_orbital}{sub1} p{n1}"
    peak2_name = f"{element_orbital}{sub2}_p{n2}"
    grid.SetCellValue(row1, 1, peak1_name)
    grid.SetCellValue(row2, 1, peak2_name)

    first_position = float(grid.GetCellValue(row1, 2))
    second_position = first_position + splitting
    grid.SetCellValue(row2, 2, f"{second_position:.2f}")

    cl = w.Data['Core levels'][sheet_name]
    if isinstance(cl.get('Fitting'), dict) and 'Peaks' in cl['Fitting']:
        new_peaks = {}
        for i, (key, value) in enumerate(cl['Fitting']['Peaks'].items()):
            if i == first_peak:
                new_peaks[peak1_name] = value
                value['Name'] = peak1_name
            elif i == second_peak:
                new_peaks[peak2_name] = value
                value['Name'] = peak2_name
                value['Position'] = second_position
                value['Constraints'] = {
                    'Position': position_constraint, 'Height': height_constraint, 'FWHM': fwhm_constraint,
                    'L/G': lg_constraint, 'Area': area_constraint, 'Sigma': sigma_constraint,
                    'Gamma': gamma_constraint, 'Skew': skew_constraint,
                }
            else:
                new_peaks[key] = value
        cl['Fitting']['Peaks'] = new_peaks
    w.load_view()
    return [first_peak, second_peak]


# ── Background regions ──────────────────────────────────────────────────
def plot_background(window):
    """PlotManager.plot_background (the calculation and what it stores)."""
    from .background import _calculate_other_background
    sheet_name = window.sheet_combobox.GetValue()
    if sheet_name not in window.Data['Core levels']:
        return
    try:
        cl = window.Data['Core levels'][sheet_name]
        x_values = np.array(cl['B.E.'], dtype=float)
        y_values = np.array(cl['Raw Data'], dtype=float)
        if 'Bkg Y' not in cl['Background'] or not cl['Background']['Bkg Y']:
            cl['Background']['Bkg Y'] = y_values.tolist()
        method = window.background_method
        try:
            offset_h = float(window.offset_h)
        except (AttributeError, ValueError, TypeError):
            offset_h = 0
        try:
            offset_l = float(window.offset_l)
        except (AttributeError, ValueError, TypeError):
            offset_l = 0
        if method == "Multi-Regions Smart":
            if window.vlines is not None:
                adaptive_range = (min(window.vlines), max(window.vlines))
            else:
                adaptive_range = (min(x_values), max(x_values))
            cl['Background']['Bkg Low'], cl['Background']['Bkg High'] = adaptive_range
            background = BackgroundCalculations.calculate_adaptive_smart_background(
                x_values, y_values, adaptive_range, np.array(cl['Background']['Bkg Y']), offset_h, offset_l,
                num_points=getattr(window, 'averaging_points', 5))
        else:
            background = _calculate_other_background(window, x_values, y_values, method, offset_h, offset_l)
        # _update_background_data
        if window.vlines is not None:
            bg_low, bg_high = round(min(window.vlines), 2), round(max(window.vlines), 2)
        else:
            bg_low, bg_high = round(min(x_values), 2), round(max(x_values), 2)
        cl['Background'].update({
            'Bkg Y': background.tolist(), 'Bkg Type': method, 'Bkg Low': bg_low, 'Bkg High': bg_high,
            'Bkg Offset Low': offset_l, 'Bkg Offset High': offset_h, 'Bkg X': x_values.tolist(),
        })
        window.background = background
    except Exception as e:
        print("Error in plot_background:", str(e))


def remove_region(w, index):
    """FittingWindow.on_remove_active_region for region `index` (0-based)."""
    from .background import clear_background_only
    fw = w.fitting_window
    ranges = fw.get_recorded_ranges_from_data()
    if index is None or int(index) < 0 or int(index) >= len(ranges):
        raise FitOpError("No active region selected to remove.")
    ranges = list(ranges)
    ranges.pop(int(index))
    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet_name]
    cl.setdefault('Background', {})['Recorded_Ranges'] = ranges
    if ranges:
        fw.active_range_index = 0
        offset_h, offset_l, min_range, max_range = ranges[0]
        w.vlines = (min_range, max_range)         # the limit lines go to region 1
        overall_min, overall_max = fw.get_overall_background_range()
        cl['Background']['Bkg Low'] = overall_min
        cl['Background']['Bkg High'] = overall_max
        w.bg_min_energy, w.bg_max_energy = overall_min, overall_max
        redraw_all_regions_background(w)
    else:
        fw.active_range_index = -1
        cl['Background']['Bkg Low'] = None
        cl['Background']['Bkg High'] = None
        w.bg_min_energy = w.bg_max_energy = None
        clear_background_only(w)
    w.load_view()
    return len(ranges)


# ── Batching: propagate ─────────────────────────────────────────────────
def extract_column_type(sheet_name):
    """FittingWindow.extract_column_type: C1s1 -> C1s, Bi4f1 -> Bi4f, VB1 -> VB."""
    if not sheet_name:
        return ""
    cleaned = sheet_name.strip()
    for sep in ['_', ' ', '-', '.']:
        if sep in cleaned:
            cleaned = cleaned.split(sep)[0]
            break
    core_type = re.sub(r'\d+$', '', cleaned)
    return core_type if core_type else cleaned


def extract_row_number(sheet_name):
    """FittingWindow.extract_row_number: C1s3 -> 3, C1s -> 0."""
    m = re.search(r'(\d+)(?:_.*)?$', sheet_name)
    return int(m.group(1)) if m else 0


def find_source_sheet_for_row_and_type(w, row_number, core_type):
    """FittingWindow.find_source_sheet_for_row_and_type."""
    for sheet_name in w.Data['Core levels'].keys():
        if extract_column_type(sheet_name) == core_type and extract_row_number(sheet_name) == row_number:
            return sheet_name
    if row_number == 0:
        for sheet_name in w.Data['Core levels'].keys():
            if sheet_name == core_type:
                return sheet_name
            pattern = f"^{re.escape(core_type)}(?:_.*)?$"
            if re.match(pattern, sheet_name) and not re.search(r'\d', sheet_name.split('_')[0]):
                return sheet_name
    return None


_BG_KEYS = ['Bkg Type', 'Bkg Low', 'Bkg High', 'Bkg Offset Low', 'Bkg Offset High', 'Recorded_Ranges',
            'Active_Shirley_k', 'Active_Shirley_const', 'Active_Tougaard_B', 'Tougaard_C', 'Method',
            'Tougaard_B', 'Tougaard_D', 'Tougaard_T0',
            'Tougaard_B2', 'Tougaard_C2', 'Tougaard_D2', 'Tougaard_T02',
            'Tougaard_B3', 'Tougaard_C3', 'Tougaard_D3', 'Tougaard_T03']


def _clipboard(obj):
    """What the desktop's JSON clipboard file gives back (tuples become lists)."""
    return json.loads(json.dumps(obj))


def copy_current_background(w):
    """FittingWindow.copy_current_background_directly -> the background clipboard (or None)."""
    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'].get(sheet_name)
    if not cl or 'Background' not in cl or 'Bkg Y' not in cl['Background']:
        return None
    src = cl['Background']
    out = {}
    for key in _BG_KEYS:
        if key not in src:
            continue
        if key == 'Bkg Type':
            out[key] = src[key]
        elif key == 'Recorded_Ranges' and src[key]:
            out[key] = [tuple(float(f"{float(v):.2f}") for v in r[:4]) for r in src[key]]
        elif key in ['Bkg Low', 'Bkg High', 'Bkg Offset Low', 'Bkg Offset High', 'Tougaard_C']:
            try:
                out[key] = float(f"{float(src[key]):.2f}")
            except (ValueError, TypeError):
                out[key] = src[key]
        elif key in ['Active_Shirley_k', 'Active_Shirley_const', 'Active_Tougaard_B']:
            try:
                v = float(src[key])
                out[key] = float(f"{v:.6f}") if 'k' in key else float(f"{v:.2f}")
            except (ValueError, TypeError):
                out[key] = src[key]
        else:
            out[key] = src[key]
    return _clipboard(out)


def paste_background(w, background_data):
    """FittingWindow.paste_background_directly on the current sheet."""
    if background_data is None:
        return
    sheet_name = w.sheet_combobox.GetValue()
    target = w.Data['Core levels'][sheet_name]
    target_bg = target.setdefault('Background', {})
    if 'Raw Data' in target:
        target_bg['Bkg Y'] = target['Raw Data'][:]
    if 'B.E.' in target:
        target_bg['Bkg X'] = target['B.E.'][:]
    for key in _BG_KEYS:
        if key in background_data:
            target_bg[key] = copy.deepcopy(background_data[key])
    w.background_method = background_data.get('Bkg Type', 'Smart')
    w.background = np.array(target['Raw Data'])
    if 'B.E.' in target:
        w.x_values = np.array(target['B.E.'])
    if background_data.get('Recorded_Ranges'):
        recreate_background_from_ranges(w, sheet_name, background_data['Recorded_Ranges'],
                                        background_data.get('Bkg Type', 'Smart'))


def copy_all_peak_parameters(w):
    """Save.copy_all_peak_parameters (the definition in force, near the end of
    Save.py) -> the peak clipboard, or None ("No peak parameters to copy")."""
    from .workbook import to_json_data
    sheet_name = w.sheet_combobox.GetValue()
    if sheet_name not in w.Data['Core levels'] or 'Fitting' not in w.Data['Core levels'][sheet_name]:
        return None
    clip = {
        'sheet_name': sheet_name,
        'grid_data': w.peak_params_grid.snapshot(),
        'peak_data': copy.deepcopy(w.Data['Core levels'][sheet_name]['Fitting']),
        'peak_count': w.peak_count,
    }
    # The clipboard file is written through convert_to_serializable_and_round (2 decimals).
    return _clipboard(to_json_data(clip))


def paste_all_peak_parameters(w, clip):
    """Save.paste_all_peak_parameters (the definition in force): the copied
    Fitting (peaks with their names) into the current sheet, then the sheet is
    reselected so the peak table is rebuilt from Data."""
    from .sheets import select_sheet
    if not clip:
        return
    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet_name]
    if 'peak_data' in clip:
        if 'Fitting' not in cl:
            cl['Fitting'] = {}
        for key, value in clip['peak_data'].items():
            if key != 'Peaks':
                cl['Fitting'][key] = copy.deepcopy(value)
        if 'Peaks' in clip['peak_data']:
            cl['Fitting']['Peaks'] = {}
            for key, peak in clip['peak_data']['Peaks'].items():
                cl['Fitting']['Peaks'][key] = copy.deepcopy(peak)
    w.peak_count = len(clip['peak_data']['Peaks']) if 'peak_data' in clip and 'Peaks' in clip['peak_data'] else 0
    select_sheet(w, sheet_name)
    w.update_ratios()


def _check_targets(sheets):
    if not sheets:
        raise FitOpError("No core levels selected for propagation.")


def _same_column(current_sheet, selected_sheets):
    column = extract_column_type(current_sheet)
    same, omitted = [], []
    for sheet in selected_sheets:
        if sheet == current_sheet:
            continue
        (same if extract_column_type(sheet) == column else omitted).append(sheet)
    return column, same, omitted


def _omitted_text(omitted):
    text = ''
    if omitted:
        text += f"\n\n{len(omitted)} core levels were omitted (different column type):\n"
        text += ", ".join(omitted[:5])
        if len(omitted) > 5:
            text += f" and {len(omitted) - 5} more..."
    return text


def propagate_fittings(w, sheets):
    """FittingWindow.on_propagate_fittings: the current sheet's peak table and
    background pasted onto the selected sheets of the same column."""
    from .sheets import select_sheet
    current = w.sheet_combobox.GetValue()
    if not current or current not in w.Data['Core levels']:
        raise FitOpError("No core level selected")
    if w.peak_params_grid.GetNumberRows() == 0:
        raise FitOpError("No peaks to propagate from current core level")
    _check_targets(sheets)
    column, same, omitted = _same_column(current, list(sheets))
    if not same:
        raise FitOpError(f"No core levels of the same column type ({column}) are selected for propagation.")
    peaks_clip = copy_all_peak_parameters(w)
    bg_clip = copy_current_background(w)
    done, failed = [], []
    for target in same:
        try:
            select_sheet(w, target)
            paste_background(w, bg_clip)
            paste_all_peak_parameters(w, peaks_clip)
            done.append(target)
        except Exception:
            failed.append(target)
    select_sheet(w, current)
    total = len(same)
    msg = f"Successfully propagated fittings to {len(done)}/{total} {column} core levels."
    if failed:
        msg += f"\n\nFailed to propagate to {len(failed)} core levels: {', '.join(failed[:3])}"
        if len(failed) > 3:
            msg += f" and {len(failed) - 3} more..."
    msg += _omitted_text(omitted)
    if not done:
        msg = "Failed to propagate to any core levels"
    return {'done': done, 'omitted': omitted, 'failed': failed, 'message': msg}


def get_current_constraints(w, sheet_name):
    """FittingWindow.get_current_constraints: {peak index: {name: constraint}} from the peak table."""
    out = {}
    cl = w.Data['Core levels'].get(sheet_name)
    if not cl or not isinstance(cl.get('Fitting'), dict) or 'Peaks' not in cl['Fitting']:
        return out
    grid = w.peak_params_grid
    names = {2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G', 6: 'Area', 7: 'Sigma', 8: 'Gamma', 9: 'Skew'}
    for peak_index, row in enumerate(range(1, grid.GetNumberRows(), 2)):
        c = {}
        for col, name in names.items():
            v = grid.GetCellValue(row, col)
            if v and v.strip():
                c[name] = v.strip()
        if c:
            out[peak_index] = c
    return out


def propagate_constraints_to_sheet(w, source_constraints, target_sheet):
    """FittingWindow.propagate_constraints_to_sheet."""
    from .sheets import select_sheet
    original = w.sheet_combobox.GetValue()
    try:
        select_sheet(w, target_sheet)
        grid = w.peak_params_grid
        cols = {'Position': 2, 'Height': 3, 'FWHM': 4, 'L/G': 5, 'Area': 6, 'Sigma': 7, 'Gamma': 8, 'Skew': 9}
        rows_updated = 0
        for peak_index, constraints in source_constraints.items():
            constraint_row = peak_index * 2 + 1
            if constraint_row >= grid.GetNumberRows():
                continue
            for name, value in constraints.items():
                if name in cols:
                    grid.SetCellValue(constraint_row, cols[name], value)
            rows_updated += 1
        if target_sheet in w.Data['Core levels']:
            peaks = w.Data['Core levels'][target_sheet].get('Fitting', {}).get('Peaks', {})
            keys = list(peaks.keys())
            for peak_index, constraints in source_constraints.items():
                if peak_index < len(keys):
                    p = peaks[keys[peak_index]]
                    p.setdefault('Constraints', {})
                    for name, value in constraints.items():
                        p['Constraints'][name] = value
        select_sheet(w, original)
        return rows_updated > 0
    except Exception:
        return False


def propagate_constraints(w, sheets):
    """FittingWindow.on_propagate_constraints."""
    current = w.sheet_combobox.GetValue()
    if not current:
        raise FitOpError("No current core level selected.")
    _check_targets(sheets)
    column, same, omitted = _same_column(current, list(sheets))
    source = get_current_constraints(w, current)
    if not source:
        raise FitOpError("No constraints found in current core level.")
    if not same:
        raise FitOpError(f"No core levels of the same column type ({column}) are selected for propagation.")
    done, failed = [], []
    for target in same:
        try:
            (done if propagate_constraints_to_sheet(w, source, target) else failed).append(target)
        except Exception:
            failed.append(target)
    msg = f"Successfully propagated constraints to {len(done)}/{len(same)} {column} core levels."
    msg += _omitted_text(omitted)
    if not done:
        msg = "No constraints were propagated."
    return {'done': done, 'omitted': omitted, 'failed': failed, 'message': msg}


def propagate_row(w, sheets):
    """FittingWindow.on_propagate_row: for each core-level type among the
    selected sheets, the sheet of that type in the current row (sample) is
    the source of its fit."""
    from .sheets import select_sheet
    current = w.sheet_combobox.GetValue()
    if not current:
        raise FitOpError("No current core level selected.")
    current_row = extract_row_number(current)
    _check_targets(sheets)
    groups = {}
    for sheet in sheets:
        groups.setdefault(extract_column_type(sheet), []).append(sheet)
    propagation, missing = [], []
    for core_type, targets in groups.items():
        source = find_source_sheet_for_row_and_type(w, current_row, core_type)
        if source and source in w.Data['Core levels']:
            targets = [s for s in targets if s != source]
            if targets:
                propagation.append({'source': source, 'targets': targets, 'core_type': core_type})
        else:
            missing.append(core_type)
    if not propagation:
        raise FitOpError("No valid source core levels found for selected targets.")
    done, failed, summary = [], [], []
    total_targets = 0
    try:
        for group in propagation:
            select_sheet(w, group['source'])
            if w.peak_params_grid.GetNumberRows() == 0:
                summary.append(f"{group['core_type']}: No fitting data in source {group['source']}")
                continue
            peaks_clip = copy_all_peak_parameters(w)
            bg_clip = copy_current_background(w)
            ok = 0
            for target in group['targets']:
                try:
                    select_sheet(w, target)
                    paste_background(w, bg_clip)
                    paste_all_peak_parameters(w, peaks_clip)
                    ok += 1
                    done.append(target)
                except Exception:
                    failed.append(target)
            total_targets += len(group['targets'])
            summary.append(f"{group['core_type']}: {ok}/{len(group['targets'])} core levels")
    finally:
        select_sheet(w, current)
    msg = f"Row {current_row} propagation completed: {len(done)}/{total_targets} core levels updated."
    msg += "\n\nDetails:\n" + "\n".join(summary)
    if missing:
        msg += f"\n\nMissing sources for: {', '.join(missing)}"
    if not done:
        msg = "No fits were propagated."
    return {'done': done, 'omitted': [], 'missing': missing, 'failed': failed, 'message': msg}


# ── Copied from On_Mouse_Defs.py / FileManager.py (self.window / self.parent -> window) ──
def redraw_all_regions_background(window):
    """On_Mouse_Defs.redraw_all_regions_background: delete the whole background
    and redraw it from region 1, 2, 3... in sequence."""
    if not hasattr(window, 'fitting_window') or window.fitting_window is None:
        return

    sheet_name = window.sheet_combobox.GetValue()
    if sheet_name not in window.Data['Core levels']:
        return

    # Get all recorded ranges from window.data
    ranges = window.fitting_window.get_recorded_ranges_from_data()
    if not ranges:
        return

    # Clear existing background
    x_values = np.array(window.Data['Core levels'][sheet_name]['B.E.'], dtype=float)
    y_values = np.array(window.Data['Core levels'][sheet_name]['Raw Data'], dtype=float)

    # Initialize background to raw data
    window.Data['Core levels'][sheet_name]['Background']['Bkg Y'] = y_values.tolist()
    current_background = np.array(y_values)

    # Get active region index
    active_region_index = getattr(window.fitting_window, 'active_range_index', -1)

    method = window.background_method

    # HANDLE TOUGAARD METHODS SEPARATELY (OUTSIDE THE MAIN LOOP)
    if method in ["U4-Tougaard", "U2-Tougaard", "2x U4-Tougaard", "3x U4-Tougaard"]:

        # Store original values
        temp_bg_min = window.bg_min_energy
        temp_bg_max = window.bg_max_energy

        # Set full range for Tougaard calculation
        window.bg_min_energy = float(np.min(x_values))
        window.bg_max_energy = float(np.max(x_values))

        try:
            if method == "U4-Tougaard":
                full_tougaard_bg = BackgroundCalculations.calculate_tougaard_background(
                    x_values, y_values, sheet_name, window)
                # Apply to all regions
                for offset_h, offset_l, min_range, max_range in ranges:
                    region_mask = (x_values >= min_range) & (x_values <= max_range)
                    current_background[region_mask] = full_tougaard_bg[region_mask]

            elif method == "U2-Tougaard":
                # For U2-Tougaard: Calculate each region independently using ONLY region data
                for i, (offset_h, offset_l, min_range, max_range) in enumerate(ranges):
                    print(f"Calculating U2-Tougaard for region {i + 1}: {min_range:.2f} - {max_range:.2f} eV")

                    # CRITICAL: Extract only the data within this region's range
                    region_mask = (x_values >= min_range) & (x_values <= max_range)
                    x_region = x_values[region_mask]
                    y_region = y_values[region_mask]

                    if len(x_region) < 3:  # Need minimum points for calculation
                        print(f"Warning: Region {i + 1} has insufficient data points, skipping")
                        continue

                    region_vline_range = (min_range, max_range)

                    # Calculate U2-Tougaard using ONLY the region data
                    region_tougaard_bg = BackgroundCalculations.calculate_u2_tougaard_background(
                        x_region, y_region, sheet_name, window, region_vline_range)

                    # Apply the calculated background to this region in the full spectrum
                    current_background[region_mask] = region_tougaard_bg

                    # Get the fitted parameters for logging
                    fitted_b = window.Data['Core levels'][sheet_name]['Background'].get('Fitted_B', 0)
                    fitted_c = window.Data['Core levels'][sheet_name]['Background'].get('Fitted_C', 1643)
                    print(f"Region {i + 1} U2-Tougaard: B={fitted_b:.2f}, C={fitted_c:.2f} applied to {min_range:.2f}-{max_range:.2f}")
                    print(f"  Using {len(x_region)} data points from region")
        finally:
            # Restore original values
            window.bg_min_energy = temp_bg_min
            window.bg_max_energy = temp_bg_max

    else:
        # HANDLE NON-TOUGAARD METHODS WITH MAIN LOOP
        for i, (offset_h, offset_l, min_range, max_range) in enumerate(ranges):
            if method == "Multi-Regions Smart":
                current_background = BackgroundCalculations.calculate_adaptive_smart_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Shirley":
                current_background = BackgroundCalculations.calculate_adaptive_shirley_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Iterated Shirley":
                current_background = BackgroundCalculations.calculate_adaptive_iterated_shirley_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l,
                    iterations=getattr(window, 'averaging_points', 5))
            elif method == "Spline Shirley":
                current_background = BackgroundCalculations.calculate_adaptive_spline_shirley_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Spline Tougaard":
                current_background = BackgroundCalculations.calculate_adaptive_spline_tougaard_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l,
                    sheet_name=sheet_name, window=window)
            elif method == "Linear":
                current_background = BackgroundCalculations.calculate_adaptive_linear_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Active Shirley":
                # Check if we have stored k and const from previous fitting
                stored_k = window.Data['Core levels'][sheet_name]['Background'].get('Active_Shirley_k', None)
                stored_const = window.Data['Core levels'][sheet_name]['Background'].get('Active_Shirley_const', None)

                if stored_k is not None and stored_const is not None:
                    # Use stored values to recalculate background with new range
                    mask = (x_values >= min_range) & (x_values <= max_range)
                    x_filtered = x_values[mask]
                    y_filtered = y_values[mask]

                    # Recalculate using stored k (peaks not available, use raw-const as proxy)
                    # This gives a Shirley-like curve based on stored parameters
                    if len(x_filtered) > 0:
                        # peaks = data above the background itself (see calculate_active_shirley_replay)
                        new_bg = BackgroundCalculations.calculate_active_shirley_replay(
                            x_filtered, y_filtered, stored_k, stored_const)
                        current_background[mask] = new_bg
                else:
                    # No stored values, use initial flat background
                    current_background = BackgroundCalculations.calculate_adaptive_active_shirley_background(
                        x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Active Tougaard":
                print('Active Tougaard')
                stored_B = window.Data['Core levels'][sheet_name]['Background'].get('Active_Tougaard_B', None)

                if stored_B is not None:
                    # Use stored B to recalculate background using raw data (like U2-Tougaard)
                    mask = (x_values >= min_range) & (x_values <= max_range)
                    x_filtered = x_values[mask]
                    y_filtered = y_values[mask]

                    C = float(window.Data['Core levels'][sheet_name]['Background'].get('Tougaard_C', 1643))
                    averaging_points = getattr(window, 'averaging_points', 5)

                    if len(x_filtered) > 0:
                        # Get baseline at low BE
                        baseline = BackgroundCalculations.calculate_endpoint_average(
                            x_filtered, y_filtered, x_filtered[-1], averaging_points) + offset_l

                        y_shifted = y_filtered - baseline
                        dx = np.abs(np.mean(np.diff(x_filtered)))
                        n = len(x_filtered)
                        bg = np.zeros(n, dtype=float)

                        # Calculate Tougaard integral (same as U2-Tougaard)
                        for i in range(n):
                            E_prime_minus_E = x_filtered[:i] - x_filtered[i] if x_filtered[0] > x_filtered[-1] else x_filtered[i + 1:] - x_filtered[i]
                            E_prime_minus_E = np.abs(E_prime_minus_E)
                            if len(E_prime_minus_E) > 0:
                                K = stored_B * E_prime_minus_E / ((C + E_prime_minus_E ** 2) ** 2)
                                if x_filtered[0] > x_filtered[-1]:
                                    bg[i] = trapz(K * y_shifted[:i], dx=dx) if i > 0 else 0
                                else:
                                    bg[i] = trapz(K * y_shifted[i + 1:], dx=dx) if i < n - 1 else 0

                        current_background[mask] = bg + baseline
                else:
                    current_background = BackgroundCalculations.calculate_adaptive_active_tougaard_background(
                        x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Power-EELS":
                current_background = BackgroundCalculations.calculate_adaptive_power_eels_background(
                    x_values, y_values, (min_range, max_range), current_background,
                    sheet_name, window)
            elif method == "Arctan-XAS":
                current_background = BackgroundCalculations.calculate_adaptive_arctan_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Poly-2":
                current_background = BackgroundCalculations.calculate_adaptive_polynomial_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l, order=2)
            elif method == "Poly-3":
                current_background = BackgroundCalculations.calculate_adaptive_polynomial_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l, order=3)
            elif method == "ALS":
                current_background = BackgroundCalculations.calculate_adaptive_als_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Smart":
                current_background = BackgroundCalculations.calculate_adaptive_single_smart_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Active Shirley":
                # Check if we have stored k and const from previous fitting
                stored_k = window.Data['Core levels'][sheet_name]['Background'].get('Active_Shirley_k', None)
                stored_const_base = window.Data['Core levels'][sheet_name]['Background'].get('Active_Shirley_const_base', None)

                if stored_k is not None and stored_const_base is not None:
                    # Use stored base const and apply current offset_l
                    mask = (x_values >= min_range) & (x_values <= max_range)
                    x_filtered = x_values[mask]
                    y_filtered = y_values[mask]

                    if len(x_filtered) > 0:
                        # Apply current offset_l to base const
                        new_const = stored_const_base + offset_l
                        # peaks = data above the background itself (see calculate_active_shirley_replay)
                        new_bg = BackgroundCalculations.calculate_active_shirley_replay(
                            x_filtered, y_filtered, stored_k, new_const)
                        current_background[mask] = new_bg

                        # Update the stored const to reflect current offset
                        window.Data['Core levels'][sheet_name]['Background']['Active_Shirley_const'] = float(f"{new_const:.2f}")
                else:
                    # No stored values, use initial flat background
                    current_background = BackgroundCalculations.calculate_adaptive_active_shirley_background(
                        x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            elif method == "Active Tougaard":
                stored_B = window.Data['Core levels'][sheet_name]['Background'].get('Active_Tougaard_B', None)
                original_offset_l = window.Data['Core levels'][sheet_name]['Background'].get('Active_Tougaard_offset_l', 0)

                if stored_B is not None:
                    mask = (x_values >= min_range) & (x_values <= max_range)
                    x_filtered = x_values[mask]
                    y_filtered = y_values[mask]

                    C = float(window.Data['Core levels'][sheet_name]['Background'].get('Tougaard_C', 1643))
                    averaging_points = getattr(window, 'averaging_points', 5)

                    if len(x_filtered) > 0:
                        # Calculate base baseline (without any offset)
                        base_baseline = BackgroundCalculations.calculate_endpoint_average(
                            x_filtered, y_filtered, x_filtered[-1], averaging_points)

                        # Apply current offset_l
                        baseline = base_baseline + offset_l

                        y_shifted = np.maximum(y_filtered - baseline, 0)
                        dx = np.abs(np.mean(np.diff(x_filtered)))
                        n = len(x_filtered)
                        bg = np.zeros(n, dtype=float)

                        # Vectorized Tougaard integral
                        for j in range(n - 1):
                            T = np.abs(x_filtered[j + 1:] - x_filtered[j])
                            K = stored_B * T / ((C + T ** 2) ** 2)
                            bg[j] = np.sum(K * y_shifted[j + 1:]) * dx

                        current_background[mask] = bg + baseline
                else:
                    current_background = BackgroundCalculations.calculate_adaptive_active_tougaard_background(
                        x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)
            else:
                # Fallback to smart for unknown methods
                current_background = BackgroundCalculations.calculate_adaptive_smart_background(
                    x_values, y_values, (min_range, max_range), current_background, offset_h, offset_l)

    # Update the final background
    window.Data['Core levels'][sheet_name]['Background']['Bkg Y'] = current_background.tolist()
    window.background = current_background

    # CRITICAL: Update window offset values to match active region offsets
    if active_region_index >= 0 and active_region_index < len(ranges):
        active_offset_h, active_offset_l, _, _ = ranges[active_region_index]
        window.offset_h = active_offset_h
        window.offset_l = active_offset_l

    # Only redraw plot for non-Tougaard methods (Tougaard background is already calculated above)
    if method not in ["U4-Tougaard", "U2-Tougaard", "2x U4-Tougaard", "3x U4-Tougaard"]:
        plot_background(window)


def recreate_background_from_ranges(window, sheet_name, recorded_ranges, background_method=None):
    """FileManagerWindow.recreate_background_from_ranges (no fitting window needed)."""
    try:
        if sheet_name not in window.Data['Core levels']:
            return

        core_level_data = window.Data['Core levels'][sheet_name]

        # Get the data
        x_values = np.array(core_level_data['B.E.'], dtype=float)
        y_values = np.array(core_level_data['Raw Data'], dtype=float)

        # Initialize background to raw data
        current_background = np.array(y_values)

        # Get background method from parameter or parent (default to Smart if not available)
        method = background_method or getattr(window, 'background_method', 'Smart')

        # Special handling for Tougaard methods - they cannot be applied region-by-region
        if method in ["U4-Tougaard", "U2-Tougaard", "2x U4-Tougaard", "3x U4-Tougaard"]:
            try:
                # Mask x/y to the Bkg Low/Bkg High window so that the Tougaard
                # calculation uses the correct background start position
                bg_data = core_level_data.get('Background', {})
                bkg_low = bg_data.get('Bkg Low')
                bkg_high = bg_data.get('Bkg High')

                if bkg_low is not None and bkg_high is not None:
                    lo = min(float(bkg_low), float(bkg_high))
                    hi = max(float(bkg_low), float(bkg_high))
                    mask = (x_values >= lo) & (x_values <= hi)
                    x_masked = x_values[mask]
                    y_masked = y_values[mask]
                else:
                    mask = None
                    x_masked = x_values
                    y_masked = y_values

                if method == "U2-Tougaard":
                    tougaard_bg = BackgroundCalculations.calculate_u2_tougaard_background(
                        x_masked, y_masked, sheet_name, window)
                elif method == "U4-Tougaard":
                    tougaard_bg = BackgroundCalculations.calculate_tougaard_background(
                        x_masked, y_masked, sheet_name, window)
                elif method == "2x U4-Tougaard":
                    tougaard_bg = BackgroundCalculations.calculate_double_tougaard_background(
                        x_masked, y_masked, sheet_name, window)
                elif method == "3x U4-Tougaard":
                    tougaard_bg = BackgroundCalculations.calculate_triple_tougaard_background(
                        x_masked, y_masked, sheet_name, window)

                # Place result back into full-length array
                if mask is not None:
                    current_background[mask] = tougaard_bg
                else:
                    current_background = tougaard_bg

            except Exception as e:
                print(f"Error applying Tougaard background method {method}: {e}")

        else:
            # Apply each recorded range in sequence for non-Tougaard methods
            for range_idx, range_entry in enumerate(recorded_ranges):
                offset_h, offset_l, min_range, max_range = (
                    float(range_entry[0]), float(range_entry[1]),
                    float(range_entry[2]), float(range_entry[3]))
                try:
                    # Apply background calculation for this range
                    if method == "Multi-Regions Smart":
                        current_background = BackgroundCalculations.calculate_adaptive_smart_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Shirley":
                        current_background = BackgroundCalculations.calculate_adaptive_shirley_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Iterated Shirley":
                        current_background = BackgroundCalculations.calculate_adaptive_iterated_shirley_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"),
                            iterations=getattr(window, 'averaging_points', 5))
                    elif method == "Spline Shirley":
                        current_background = BackgroundCalculations.calculate_adaptive_spline_shirley_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Spline Tougaard":
                        current_background = BackgroundCalculations.calculate_adaptive_spline_tougaard_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Linear":
                        current_background = BackgroundCalculations.calculate_adaptive_linear_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Active Shirley":
                        # Use per-range params if available, fall back to global k/const
                        params_list = core_level_data['Background'].get('Active_Shirley_params', [])
                        if range_idx < len(params_list):
                            stored_k, stored_const = params_list[range_idx]
                        else:
                            stored_k = core_level_data['Background'].get('Active_Shirley_k', None)
                            stored_const = core_level_data['Background'].get('Active_Shirley_const', None)
                        if stored_k is not None and stored_const is not None:
                            mask = ((x_values >= min(min_range, max_range)) &
                                    (x_values <= max(min_range, max_range)))
                            x_f = x_values[mask]
                            y_f = y_values[mask]
                            if len(x_f) > 0:
                                # peaks = data above the background itself (see calculate_active_shirley_replay)
                                current_background[mask] = BackgroundCalculations.calculate_active_shirley_replay(
                                    x_f, y_f, stored_k, stored_const)
                        else:
                            current_background = BackgroundCalculations.calculate_adaptive_active_shirley_background(
                                x_values, y_values, (min_range, max_range), current_background,
                                float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Offset":
                        current_background = BackgroundCalculations.calculate_adaptive_linear_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Poly-2":
                        current_background = BackgroundCalculations.calculate_adaptive_polynomial_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"), order=2)
                    elif method == "Poly-3":
                        current_background = BackgroundCalculations.calculate_adaptive_polynomial_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"), order=3)
                    elif method == "ALS":
                        current_background = BackgroundCalculations.calculate_adaptive_als_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Active Tougaard":
                        stored_B = core_level_data['Background'].get('Active_Tougaard_B', None)

                        if stored_B is not None:
                            mask = ((x_values >= min(min_range, max_range)) &
                                    (x_values <= max(min_range, max_range)))
                            x_filtered = x_values[mask]
                            y_filtered = y_values[mask]

                            C = float(core_level_data['Background'].get('Tougaard_C', 1643))
                            averaging_points = 5

                            if len(x_filtered) > 0:
                                baseline = BackgroundCalculations.calculate_endpoint_average(
                                    x_filtered, y_filtered, x_filtered[-1], averaging_points) + offset_l

                                y_shifted = y_filtered - baseline
                                dx = np.abs(np.mean(np.diff(x_filtered)))
                                n = len(x_filtered)
                                bg = np.zeros(n, dtype=float)

                                for i in range(n):
                                    # For BE-descending: integrate over lower BE (higher indices, j > i)
                                    # For BE-ascending: integrate over higher BE (higher indices, j > i)
                                    E_prime_minus_E = np.abs(x_filtered[i + 1:] - x_filtered[i])
                                    if len(E_prime_minus_E) > 0:
                                        K = stored_B * E_prime_minus_E / ((C + E_prime_minus_E ** 2) ** 2)
                                        bg[i] = trapz(K * y_shifted[i + 1:], dx=dx) if i < n - 1 else 0

                                current_background[mask] = bg + baseline
                        else:
                            current_background = BackgroundCalculations.calculate_adaptive_active_tougaard_background(
                                x_values, y_values, (min_range, max_range), current_background,
                                float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Power-EELS":
                        current_background = BackgroundCalculations.calculate_adaptive_power_eels_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            sheet_name, window)
                    elif method == "Arctan-XAS":
                        current_background = BackgroundCalculations.calculate_adaptive_arctan_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    elif method == "Smart":
                        current_background = BackgroundCalculations.calculate_adaptive_single_smart_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))
                    else:
                        # Fallback to smart for unknown methods
                        current_background = BackgroundCalculations.calculate_adaptive_single_smart_background(
                            x_values, y_values, (min_range, max_range), current_background,
                            float(f"{offset_h:.2f}"), float(f"{offset_l:.2f}"))

                except Exception as e:
                    print(f"Error applying background range {min_range}-{max_range}: {e}")
                    continue

        # Update the background in the data structure
        core_level_data['Background']['Bkg Y'] = current_background.tolist()
        window.background = current_background


    except Exception as e:
        print(f"Error recreating background for {sheet_name}: {e}")