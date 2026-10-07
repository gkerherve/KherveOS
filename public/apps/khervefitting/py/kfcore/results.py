# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: the results table (atomic %). "Export" copies the fitted
# peaks of the current core level into Data['Results TableN'] (FileMenu/
# Export.py) and the atomic and weight percentages are worked out as in
# MyFrame.update_atomic_percentages. The desktop's results grid holds
# numbers as 2-decimal text; the same rounding is applied here.

import json
import re

from .backgrounds import AtomicConcentrations

ATOMIC_MASSES = {
    'H': 1.008, 'He': 4.003, 'Li': 6.94, 'Be': 9.012, 'B': 10.81, 'C': 12.01, 'N': 14.01, 'O': 16.00,
    'F': 19.00, 'Ne': 20.18, 'Na': 22.99, 'Mg': 24.31, 'Al': 26.98, 'Si': 28.09, 'P': 30.97, 'S': 32.07,
    'Cl': 35.45, 'Ar': 39.95, 'K': 39.10, 'Ca': 40.08, 'Sc': 44.96, 'Ti': 47.87, 'V': 50.94, 'Cr': 52.00,
    'Mn': 54.94, 'Fe': 55.85, 'Co': 58.93, 'Ni': 58.69, 'Cu': 63.55, 'Zn': 65.38, 'Ga': 69.72, 'Ge': 72.63,
    'As': 74.92, 'Se': 78.96, 'Br': 79.90, 'Kr': 83.80, 'Rb': 85.47, 'Sr': 87.62, 'Y': 88.91, 'Zr': 91.22,
    'Nb': 92.91, 'Mo': 95.96, 'Tc': 98.00, 'Ru': 101.07, 'Rh': 102.91, 'Pd': 106.42, 'Ag': 107.87, 'Cd': 112.41,
    'In': 114.82, 'Sn': 118.71, 'Sb': 121.76, 'Te': 127.60, 'I': 126.90, 'Xe': 131.29, 'Cs': 132.91, 'Ba': 137.33,
    'La': 138.91, 'Ce': 140.12, 'Pr': 140.91, 'Nd': 144.24, 'Pm': 145.00, 'Sm': 150.36, 'Eu': 151.96, 'Gd': 157.25,
    'Tb': 158.93, 'Dy': 162.50, 'Ho': 164.93, 'Er': 167.26, 'Tm': 168.93, 'Yb': 173.05, 'Lu': 174.97, 'Hf': 178.49,
    'Ta': 180.95, 'W': 183.84, 'Re': 186.21, 'Os': 190.23, 'Ir': 192.22, 'Pt': 195.08, 'Au': 196.97, 'Hg': 200.59,
    'Tl': 204.38, 'Pb': 207.2, 'Bi': 208.98, 'Po': 209.00, 'At': 210.00, 'Rn': 222.00, 'Fr': 223.00, 'Ra': 226.00,
    'Ac': 227.00, 'Th': 232.04, 'Pa': 231.04, 'U': 238.03
}


def _2(v):
    """A number as the desktop's grid keeps it: text with 2 decimals."""
    return float(f"{float(v):.2f}")


def extract_element_symbol(peak_name):
    """Area_Calculation.extract_element_symbol."""
    clean_name = peak_name.replace(' ', '').strip()
    match = re.match(r'^([A-Z][a-z]?)', clean_name)
    if match and match.group(1) in ATOMIC_MASSES:
        return match.group(1)
    for element in ATOMIC_MASSES:
        if clean_name.upper().startswith(element.upper()):
            return element
    return 'C'


def load_library(text):
    """The sensitivity-factor library (made from KherveFitting_library.parquet):
    {"El|orbital": {instrument: rsf}} → {(El, orbital): {instrument: {'rsf': rsf}}}."""
    raw = json.loads(text)
    data = {}
    for key, per_instr in raw.get('rsf', {}).items():
        element, orbital = key.split('|', 1)
        data[(element, orbital)] = {ins: {'rsf': v} for ins, v in per_instr.items()}
    return data, raw.get('instruments', [])


def table_key(sheet_name):
    match = re.search(r'(\d+)$', sheet_name)
    return f'Results Table{int(match.group(1)) if match else 0}'


def _ecf(window, binding_energy):
    kinetic_energy = window.photons - binding_energy
    t = window.library_type
    if t == "Scofield":
        return kinetic_energy ** 0.6
    if t == "Wagner":
        return kinetic_energy ** 1.0
    if t == "TPP-2M":
        return AtomicConcentrations.calculate_imfp_tpp2m(kinetic_energy) * 26.2
    if t == "EAL":
        return (0.65 + 0.007 * kinetic_energy ** 0.93) / (50 ** 0.38)
    return 1.0


def _checkbox_state(peak_name):
    """Export._determine_checkbox_state: tick all but the second doublet component."""
    if re.search(r'\d+s', peak_name):
        return '1'
    if 'p1/2' in peak_name or 'd3/2' in peak_name or 'f5/2' in peak_name:
        return '0'
    return '1'


def export_results(window):
    """FileMenu/Export.export_results for the current core level."""
    sheet_name = window.sheet_combobox.GetValue()
    key = table_key(sheet_name)
    window.Data.setdefault(key, {'Peak': {}})
    window.Data[key].setdefault('Peak', {})
    results = window.Data[key]['Peak']
    grid = window.peak_params_grid
    library = window.library_data
    num_peaks = grid.GetNumberRows() // 2

    def sf(v):
        try:
            return float(v) if str(v).strip() else 0.0
        except (ValueError, AttributeError):
            return 0.0

    if window.library_type == "Scofield":
        ecf_type = "KE^0.6"
    elif window.library_type == "Wagner":
        ecf_type = "KE^1.0"
    elif window.library_type == "TPP-2M":
        ecf_type = "TPP-2M"
    else:
        ecf_type = "1.0"

    for i in range(num_peaks):
        row = i * 2
        g = grid.GetCellValue
        peak_name = g(row, 1)
        match = re.match(r'([A-Z][a-z]*)(\d+[spdf])(?:(\d+/\d+))?', peak_name)
        if match:
            element, orbital, suborbital = match.groups()
        else:
            element, orbital, suborbital = ''.join(filter(str.isalnum, peak_name.split()[0])) if peak_name else '', '', None
        lib_key = (element, orbital + (suborbital or ''))
        rsf = library[lib_key][window.current_instrument]['rsf'] \
            if lib_key in library and window.current_instrument in library[lib_key] else 1.0

        area = float(g(row, 6))
        ecf = _ecf(window, float(g(row, 2)))
        normalized_area = 0 if (rsf == 0 or ecf == 0) else area / (rsf * 1.0 * ecf * 1.0)
        rel_area = round(normalized_area, 2)

        existing = [int(k.split('_')[1]) for k in results if k.startswith('Peak_') and k.split('_')[1].isdigit()]
        label = f"Peak_{max(existing + [-1]) + 1}"
        same = next((k for k, v in results.items()
                     if v.get('Name') == peak_name and v.get('Sheetname') == sheet_name), None)
        if same:
            label = same
        entry = {
            'Label': label, 'Name': peak_name,
            'Position': sf(g(row, 2)), 'Height': sf(g(row, 3)), 'FWHM': sf(g(row, 4)), 'L/G': sf(g(row, 5)),
            'Area': round(area, 2),
            'at. %': results.get(label, {}).get('at. %', 0.00),
            'RSF': rsf, 'TXFN': 1.0, 'ECF': ecf_type, 'Instrument': window.current_instrument,
            'Fitting Model': g(row, 13), 'Rel. Area': rel_area,
            'Sigma': sf(g(row, 7)), 'Gamma': sf(g(row, 8)), 'Skew': sf(g(row, 9)),
            'Bkg Low': window.bg_min_energy, 'Bkg High': window.bg_max_energy,
            'Sheetname': sheet_name,
            'Pos. Constraint': g(row + 1, 2), 'Height Constraint': g(row + 1, 3),
            'FWHM Constraint': g(row + 1, 4), 'L/G Constraint': g(row + 1, 5),
            'Area Constraint': g(row + 1, 6), 'Sigma Constraint': g(row + 1, 7),
            'Gamma Constraint': g(row + 1, 8),
            'Checkbox': _checkbox_state(peak_name),
        }
        if same:
            cl = window.Data['Core levels'][sheet_name]
            peaks = cl.get('Fitting', {}).get('Peaks') if isinstance(cl.get('Fitting'), dict) else None
            if peaks and i < len(peaks):
                source = list(peaks.values())[i]
                if 'Constraints' in source:
                    entry['Constraints'] = source['Constraints']
        results[label] = entry
    update_atomic_percentages(window)


def update_atomic_percentages(window, sheet_name=None):
    """MyFrame.update_atomic_percentages on Data['Results TableN']."""
    sheet_name = sheet_name or window.sheet_combobox.GetValue()
    key = table_key(sheet_name)
    results = window.Data.setdefault(key, {'Peak': {}}).setdefault('Peak', {})
    total = 0.0
    checked = []
    for label, p in results.items():
        binding_energy = _2(p.get('Position', 0))
        area = _2(p.get('Area', 0))
        rsf = _2(p.get('RSF', 1.0))
        txfn = _2(p.get('TXFN', 1.0))
        ecf = _ecf(window, binding_energy)
        angular = 1.0
        if window.use_angular_correction:
            angular = AtomicConcentrations.calculate_angular_correction(window, p.get('Name', ''),
                                                                        window.analysis_angle)
        try:
            normalized = area / (rsf * txfn * ecf * angular)
        except ZeroDivisionError:
            normalized = 0.0
        p['Rel. Area'] = normalized
        if str(p.get('Checkbox', '0')) == '1':
            total += normalized
            checked.append((label, normalized))
        else:
            p['at. %'] = 0.00
            p['wt. %'] = 0.00
    weights = []
    for label, normalized in checked:
        at = (normalized / total) * 100 if total > 0 else 0
        results[label]['at. %'] = at
        mass = ATOMIC_MASSES.get(extract_element_symbol(results[label].get('Name', '')), 12.01)
        weights.append((label, at * mass))
    wsum = sum(w for _, w in weights)
    for label, w in weights:
        results[label]['wt. %'] = (w / wsum) * 100 if wsum > 0 else 0


def results_rows(window, sheet_name=None):
    """The results table as the web page shows it."""
    sheet_name = sheet_name or window.sheet_combobox.GetValue()
    key = table_key(sheet_name)
    rows = []
    for label, p in window.Data.get(key, {}).get('Peak', {}).items():
        name = p.get('Name', '')
        rows.append({
            'key': label, 'name': name, 'position': p.get('Position', 0), 'height': p.get('Height', ''),
            'fwhm': p.get('FWHM', ''), 'lg': p.get('L/G', ''), 'area': p.get('Area', 0),
            'at': p.get('at. %', 0), 'checked': str(p.get('Checkbox', '0')) == '1',
            'rsf': p.get('RSF', 0), 'txfn': p.get('TXFN', 1.0), 'ecf': str(p.get('ECF', '')),
            'instrument': str(p.get('Instrument', '')), 'model': p.get('Fitting Model', ''),
            'relArea': p.get('Rel. Area', 0), 'sheet': p.get('Sheetname', ''), 'wt': p.get('wt. %', 0),
            'mass': ATOMIC_MASSES.get(extract_element_symbol(name), 12.01),
        })
    return key, rows


def set_result_field(window, label, field, value):
    """Tick/untick a row or change its RSF / TXFN (Grid_Operations handlers)."""
    key = table_key(window.sheet_combobox.GetValue())
    p = window.Data[key]['Peak'][label]
    if field == 'checked':
        p['Checkbox'] = '1' if value else '0'
    elif field == 'rsf':
        p['RSF'] = float(value)
    elif field == 'txfn':
        p['TXFN'] = float(value)
    elif field == 'name':
        p['Name'] = str(value)
    update_atomic_percentages(window)


def delete_results(window, labels=None):
    """Remove rows (all of them when labels is None)."""
    key = table_key(window.sheet_combobox.GetValue())
    peaks = window.Data.setdefault(key, {'Peak': {}}).setdefault('Peak', {})
    if labels is None:
        peaks.clear()
    else:
        for label in labels:
            peaks.pop(label, None)
    update_atomic_percentages(window)
