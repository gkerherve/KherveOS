# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the Peaks Library (FileMenu/Save.save_peaks_library and
# load_peaks_library). The file dialogs are the web page's; the JSON written
# and read is the desktop's own format, so files move between the two.

import json
import os
import re

import numpy as np

from .compat import trapz

KINDS = {
    'peaks': "Individual Peaks",
    'single': "SingleEntity using Peak Model",
    'raw': "SingleEntity using Raw Data",
}


def _to_list(obj):
    """save_peaks_library.convert_numpy_to_list."""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: _to_list(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_list(v) for v in obj]
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


def _envelope_name(file_name, fallback):
    """The envelope takes the file's name, without 'SingleEntity'."""
    filename = os.path.splitext(os.path.basename(file_name or ''))[0]
    name = re.sub(r'SingleEntity', '', filename, flags=re.IGNORECASE).strip()
    name = re.sub(r'[_\s]+', ' ', name).strip()
    return name or fallback


def save_choices(w):
    """The choices of the "Choose save format" dialog for the current sheet."""
    sheet = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'].get(sheet, {})
    bg = cl.get('Background') or {}
    choices = ['peaks']
    if w.peak_params_grid.GetNumberRows() > 0:
        choices.append('single')
    if bg.get('Bkg Y') is not None and len(bg.get('Bkg Y')) > 0:
        choices.append('raw')
    return choices


def suggested_name(w, kind):
    sheet = w.sheet_combobox.GetValue()
    if kind == 'single':
        return f"{sheet} Envelope.json"
    if kind == 'raw':
        return f"{sheet} RawData.json"
    return f"{sheet}.json"


def _store_and_apply_tight_constraints(window):
    """Save.store_and_apply_tight_constraints."""
    original = {}
    grid = window.peak_params_grid
    cols = [2, 3, 4, 5, 6, 7, 8, 9]
    names = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
    for peak_idx in range(grid.GetNumberRows() // 2):
        row = peak_idx * 2
        original[peak_idx] = {}
        for col, name in zip(cols, names):
            original[peak_idx][name] = grid.GetCellValue(row + 1, col)
            try:
                v = float(grid.GetCellValue(row, col))
                grid.SetCellValue(row + 1, col, f"{v - 0.01:.3f},{v + 0.01:.3f}")
            except (ValueError, TypeError):
                continue
    return original


def _restore_original_constraints(window, original):
    """Save.restore_original_constraints."""
    cols = [2, 3, 4, 5, 6, 7, 8, 9]
    names = ['Position', 'Height', 'FWHM', 'L/G', 'Area', 'Sigma', 'Gamma', 'Skew']
    for peak_idx, constraints in original.items():
        for col, name in zip(cols, names):
            if name in constraints:
                window.peak_params_grid.SetCellValue(peak_idx * 2 + 1, col, constraints[name])


def _envelope_entry(name, x_data, y_envelope):
    x = np.asarray(x_data, dtype=float)
    y = np.asarray(y_envelope, dtype=float)
    y_max = float(np.max(y))
    x_center = float(x[int(np.argmax(y))])
    order = np.argsort(x)
    y_area = float(abs(trapz(y[order], x[order])))
    return {
        name: {
            "Position": round(x_center, 2),
            "Height": round(y_max, 2),
            "FWHM": 0.0,
            "L/G": round(y_area, 2),
            "Area": round(y_area, 2),
            "Sigma": 0.00,
            "Gamma": 1.00,
            "Skew": 0.0,
            "Fitting Model": "SingleEntity",
            "x_data": _to_list(x_data),
            "y_data": _to_list(y_envelope),
            "Original_Position": round(x_center, 2),
            "Original_Area": round(y_area, 2),
            "Original_Height": round(y_max, 2),
            "Constraints": {
                "Position": f"{float(np.min(x)):.2f},{float(np.max(x)):.2f}",
                "Sigma": "-10:10",
                "Gamma": "0.1:10",
                "Skew": "0.00:3.00",
            },
        }
    }


def save_library(w, kind='peaks', file_name=None):
    """save_peaks_library. Returns (file name, JSON text).

    kind: 'peaks' (Individual Peaks), 'single' (SingleEntity using Peak Model:
    one constrained fit, then the model's envelope) or 'raw' (SingleEntity
    using Raw Data: data minus background). file_name names the envelope as on
    the desktop (its file name without 'SingleEntity').
    """
    sheet = w.sheet_combobox.GetValue()
    if not sheet or sheet not in w.Data['Core levels']:
        raise ValueError("No core level selected.")
    cl = w.Data['Core levels'][sheet]
    if kind not in KINDS:
        raise ValueError(f"Unknown save format: {kind}")
    file_name = file_name or suggested_name(w, kind)

    if kind == 'single':
        if w.peak_params_grid.GetNumberRows() == 0:
            raise ValueError("No peaks defined. Add peaks first before saving as envelope")
        envelope_name = _envelope_name(file_name, f"{sheet} Envelope")
        from .fitting import fit_peaks
        original = _store_and_apply_tight_constraints(w)
        try:
            ok = fit_peaks(w, w.peak_params_grid, evaluate=False) is not None
            if not ok:
                raise ValueError("Fitting failed. Cannot create SingleEntity envelope.")
            x_data = np.array(cl['B.E.'])
            y_envelope = None
            if w.fit_results and w.fit_results.get('result') is not None:
                y_envelope = w.fit_results['result'].eval(x=x_data)
            if y_envelope is None:
                raise ValueError("No fitted model found after constrained fitting.")
        finally:
            _restore_original_constraints(w, original)
        peaks_data = {
            'type': 'envelope',
            'Core levels': {sheet: {'Fitting': {'Peaks': _envelope_entry(envelope_name, x_data, y_envelope),
                                                'Model': 'SingleEntity'}}},
        }
    elif kind == 'raw':
        bg = cl.get('Background') or {}
        if bg.get('Bkg Y') is None or len(bg.get('Bkg Y')) == 0:
            raise ValueError("No background found. Create a background first.")
        x_data = np.array(cl['B.E.'])
        y_envelope = np.maximum(np.array(cl['Raw Data']) - np.array(bg['Bkg Y']), 0)
        # The desktop names this envelope after the open workbook, not the library file.
        envelope_name = _envelope_name(w.Data.get('FilePath') or '', f"{sheet} RawData")
        peaks_data = {
            'type': 'envelope_rawdata',
            'Core levels': {sheet: {'Fitting': {'Peaks': _envelope_entry(envelope_name, x_data, y_envelope),
                                                'Model': 'SingleEntity'}}},
        }
    else:
        if not isinstance(cl.get('Fitting'), dict) or not cl['Fitting'].get('Peaks'):
            raise ValueError("No peaks to save in this core level.")
        peaks_data = {
            'type': 'peaks',
            'Core levels': {sheet: {'Fitting': _to_list(cl['Fitting'])}},
        }
    return file_name, json.dumps(peaks_data, indent=2)


def _shift_constraint(constraint_str, offset):
    """load_peaks_library.update_constraint_references."""
    if not constraint_str or constraint_str == 'Fixed' or not isinstance(constraint_str, str):
        return constraint_str

    def replace_peak_ref(match):
        letter = match.group(1)
        return match.group(0).replace(letter, chr(ord('A') + ord(letter) - ord('A') + offset))

    updated = re.sub(r'\b([A-P])(?=[*+\-/])', replace_peak_ref, constraint_str)
    return re.sub(r'^([A-P])$', replace_peak_ref, updated)


def load_library(w, json_text, mode='overwrite'):
    """load_peaks_library on the current core level.

    mode 'overwrite' replaces the peaks (also the answer when there are none),
    'add' appends them after the existing ones, renaming duplicate labels and
    shifting the A/B/C references of their constraints.
    """
    import copy
    from .sheets import select_sheet

    peaks_data = json.loads(json_text) if isinstance(json_text, str) else json_text
    sheet = w.sheet_combobox.GetValue()
    if not sheet or sheet not in w.Data['Core levels']:
        raise ValueError("No core level selected.")
    try:
        source_sheet = list(peaks_data['Core levels'].keys())[0]
        source = copy.deepcopy(peaks_data['Core levels'][source_sheet])
        source['Fitting']['Peaks']
    except (KeyError, IndexError, TypeError):
        raise ValueError("This is not a KherveFitting peaks library file.")

    cl = w.Data['Core levels'][sheet]
    existing = {}
    if isinstance(cl.get('Fitting'), dict) and 'Peaks' in cl['Fitting']:
        existing = cl['Fitting']['Peaks']
    count = len(existing)
    overwrite = mode != 'add' or count == 0

    if overwrite:
        cl['Fitting'] = source['Fitting']
    else:
        if not isinstance(cl.get('Fitting'), dict):
            cl['Fitting'] = {}
        target = cl['Fitting'].setdefault('Peaks', {})
        for key, peak in source['Fitting']['Peaks'].items():
            new_peak = dict(peak)
            new_key = key
            if new_key in target:
                suffix = 2
                while f"{key} ({suffix})" in target:
                    suffix += 1
                new_key = f"{key} ({suffix})"
            if 'Constraints' in new_peak:
                new_peak['Constraints'] = {k: _shift_constraint(v, count)
                                           for k, v in new_peak['Constraints'].items()}
            target[new_key] = new_peak
        w.peak_count = len(target)

    select_sheet(w, sheet)
    grid = w.peak_params_grid
    low, high = grid.GetCellValue(0, 15), grid.GetCellValue(0, 16)
    try:
        w.bg_min_energy, w.bg_max_energy = float(low), float(high)
    except (TypeError, ValueError):
        x = cl['B.E.']
        w.bg_min_energy, w.bg_max_energy = min(x) + 0.2, max(x) - 0.2
    return {'peaks': len(cl['Fitting'].get('Peaks', {})), 'mode': 'overwrite' if overwrite else 'add'}
