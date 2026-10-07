# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port of the "Survey Identification / Labelling" window
# (libraries/ToolsMenu/survey.py: Add Labels, Remove last/all labels, Add peak
# (SurveyID)) and of the classic Auto ID engine of the free edition
# (libraries/ToolsMenu/AutoID.py: AutoSurveyID, AutoIDWindow, Method1Identifier
# peak finding, Method2Identifier assignments). Only the data side is kept:
# the lists, highlights and plot texts belong to the web page.
#
# The element lists the window shows come from data/elements.json (fetched by
# the page). The engine needs the whole desktop library (position and RSF per
# instrument, in the desktop's dict order): data/autoid.json.

import json
import os
import re

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks, peak_widths

from .backgrounds import BackgroundCalculations
from .compat import trapz

AUTOID_NOT_SURVEY = "Auto ID is only available for Survey or Wide scan sheets"

# ── Library (data/autoid.json) ──────────────────────────────────────────
_LIBRARY = None


def _library_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'autoid.json')


def load_autoid_library(text=None):
    """{(element, orbital): {instrument: {'position', 'rsf'}}} like
    FileMenu/Open.load_library_data (same entry and instrument order; NaN kept)."""
    global _LIBRARY
    if text is None:
        if _LIBRARY is not None:
            return _LIBRARY
        with open(_library_path(), encoding='utf-8') as f:
            text = f.read()
    raw = json.loads(text)
    instruments = raw['instruments']
    nan = float('nan')
    lib = {}
    for element, orbital, entries in raw['lib']:
        lib[(element, orbital)] = {
            instruments[i]: {'position': nan if pos is None else pos, 'rsf': nan if rsf is None else rsf}
            for i, pos, rsf in entries}
    _LIBRARY = lib
    return lib


def _f(v, nd=None):
    """A JSON-safe float (None for NaN/inf)."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(v):
        return None
    return round(v, nd) if nd is not None else v


def _is_survey(sheet_name):
    return any(x in sheet_name.lower() for x in ['survey', 'wide'])


# ── Utilities.format_survey_label (wx-free) ─────────────────────────────
AUGER_PREFIXES = ('kll', 'klm', 'lmm', 'mnn', 'mvv', 'mnv')


def _format_orbital(orbital):
    """'2p3/2' -> '2p$_{3/2}$' (matplotlib mathtext subscript)."""
    m = re.match(r'^(\d+[spdfg])(\d+/\d+)$', orbital)
    if m:
        return f"{m.group(1)}$_{{{m.group(2)}}}$"
    return orbital


def format_survey_label(label):
    """'Co2p' -> 'Co 2p', 'Co2p3/2' -> 'Co 2p$_{3/2}$', 'Ckll' -> 'C kll'."""
    if not label:
        return label
    if ' ' in label:
        element, orbital = label.split(' ', 1)
        return f"{element} {_format_orbital(orbital)}"
    if len(label) > 2 and label[0].isupper() and label[1].islower():
        rest = label[2:]
        if rest[0].isdigit() or rest.lower().startswith(AUGER_PREFIXES):
            return f"{label[:2]} {_format_orbital(rest)}"
    if len(label) > 1 and label[0].isupper():
        rest = label[1:]
        if rest[0].isdigit() or rest.lower().startswith(AUGER_PREFIXES):
            return f"{label[0]} {_format_orbital(rest)}"
    return label


# ── Labels (PeriodicTableWindow.OnAddLabels / OnRemoveLastLabel / OnRemoveAllLabels)
_LABEL_KEYS = ('type', 'fontsize', 'fontfamily', 'fontweight', 'color', 'va', 'ha', 'x2', 'y2', 'is_table')


def labels_of(w, sheet=None):
    """The labels stored with a core level: [{index, text, x, y, rotation, ...}]."""
    sheet = sheet or w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'].get(sheet) or {}
    out = []
    for i, ld in enumerate(cl.get('Labels') or []):
        if not isinstance(ld, dict):
            continue
        item = {'index': i, 'text': str(ld.get('text', '')), 'x': _f(ld.get('x')), 'y': _f(ld.get('y')),
                'rotation': _f(ld.get('rotation', 90))}
        for k in _LABEL_KEYS:
            v = ld.get(k)
            if isinstance(v, (str, bool)):
                item[k] = v
            elif isinstance(v, (int, float)):
                item[k] = _f(v)
        out.append(item)
    return out


def add_labels(w, labels):
    """OnAddLabels. labels = [{text, x, y?, format?=True}].

    y missing: highest raw count within ±5 eV of x plus 5 % of the spectrum's
    maximum (the desktop's rule); when no point lies within ±5 eV the desktop
    adds nothing, and neither does this (reported in 'skipped').
    """
    sheet = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet]
    x_values = np.asarray(cl.get('B.E.', []), dtype=float)
    y_values = np.asarray(cl.get('Raw Data', []), dtype=float)
    added, skipped = [], []
    for lab in labels or []:
        text = str(lab.get('text', ''))
        be = float(lab['x'])
        if lab.get('format', True):
            text = format_survey_label(text.strip())
        y = lab.get('y')
        if y is None:
            if y_values.size == 0:
                skipped.append(text)
                continue
            max_y = max(y_values)
            mask = (x_values >= be - 5) & (x_values <= be + 5)
            if not np.any(mask):
                skipped.append(text)
                continue
            y = float(np.max(y_values[mask])) + 0.05 * float(max_y)
        if 'Labels' not in cl:
            cl['Labels'] = []
        entry = {'text': text, 'x': be, 'y': float(y), 'rotation': 90}
        cl['Labels'].append(entry)
        added.append(entry)
    return {'added': [dict(e) for e in added], 'skipped': skipped, 'labels': labels_of(w, sheet)}


def remove_last_label(w):
    """OnRemoveLastLabel."""
    sheet = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet]
    removed = None
    if 'Labels' in cl and cl['Labels']:
        removed = cl['Labels'].pop()
    return {'removed': removed is not None, 'labels': labels_of(w, sheet)}


def clear_labels(w):
    """OnRemoveAllLabels (only when the sheet already has a 'Labels' list)."""
    sheet = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet]
    if 'Labels' in cl:
        cl['Labels'] = []
    return {'labels': labels_of(w, sheet)}


# ── Add peak (SurveyID) ─────────────────────────────────────────────────
def _add_peak_to_grid(w, peak_name, library):
    """PeriodicTableWindow.add_peak_to_grid (the Data side)."""
    sheet_name = w.sheet_combobox.GetValue()
    cl = w.Data['Core levels'][sheet_name]
    if 'Fitting' not in cl:
        cl['Fitting'] = {}
    if 'Peaks' not in cl['Fitting']:
        cl['Fitting']['Peaks'] = {}
    match = re.match(r'([A-Z][a-z]*)(\d+[spdf])', peak_name)
    if not match:
        return False
    element, orbital = match.groups()
    position = None
    for (elem, orb), data in library.items():
        if elem == element and orb.lower() == orbital.lower():
            instrument = 'Al' if 'Al' in data else next(iter(data))
            if 'position' in data[instrument]:
                position = float(data[instrument]['position'])
                break
    if position:
        cl['Fitting']['Peaks'][peak_name] = {
            'Position': position, 'Height': 0, 'FWHM': 2.0, 'L/G': 30, 'Area': 0,
            'Fitting Model': 'SurveyID',
        }
        return True
    return False


def add_survey_peaks(w, names):
    """OnAddPeak: SurveyID rows for the main core levels (…1s, 2p, 3d, 4f) of a
    Survey / Wide sheet. names like 'C1s', 'Fe2p' (the list text before ':')."""
    from .sheets import select_sheet
    sheet = w.sheet_combobox.GetValue()
    added = []
    if any(x in sheet.lower() for x in ['survey', 'wide']):
        library = load_autoid_library()
        for name in names or []:
            element = str(name).split(':')[0]
            if any(element.endswith(x) for x in ['1s', '2p', '3d', '4f']):
                if _add_peak_to_grid(w, element, library):
                    added.append(element)
        select_sheet(w, sheet)
    return {'added': added}


# ══ Classic Auto ID engine (libraries/ToolsMenu/AutoID.py) ═══════════════
class _Box:
    """The force-elements text control."""

    def __init__(self, value=''):
        self.value = value or ''

    def GetValue(self):
        return self.value


class AutoSurveyID:
    """AutoSurveyID: the element database and the area measurement."""

    def __init__(self, parent):
        self.parent = parent
        self.library_data = load_autoid_library()
        self.use_main_library = True
        self.excluded_elements = []
        self.excluded_core_levels = []
        self._ranges_cache = {}

    # get_core_level_ranges_from_library (cached: it only depends on these inputs)
    def get_core_level_ranges_from_library(self, max_energy=1400.0, tolerance=15.0):
        photon_energy = getattr(self.parent, 'photons', 1486.6)
        key = (tuple(self.excluded_elements), tuple(self.excluded_core_levels), photon_energy,
               self.parent.current_instrument, max_energy, tolerance)
        if key in self._ranges_cache:
            return self._ranges_cache[key]
        elements_db = {}
        for (element, orbital), data in self.library_data.items():
            if any(element.lower() == excl.lower() for excl in self.excluded_elements):
                continue
            core_level = f"{element}{orbital}"
            if any(core_level.lower() == excl.lower() for excl in self.excluded_core_levels):
                continue
            instrument = 'A-ALTHERMO1'
            if instrument not in data:
                instrument = self.parent.current_instrument
                if instrument not in data:
                    instrument = 'Al1486' if 'Al1486' in data else next(iter(data))
            if 'position' in data[instrument]:
                position = float(data[instrument]['position'])
                if self.is_auger_orbital_expanded(orbital.lower()):
                    binding_energy = photon_energy - position + 0
                else:
                    binding_energy = position
                if binding_energy <= max_energy and binding_energy > 0:
                    if element not in elements_db:
                        elements_db[element] = {}
                    be_min = float(f"{binding_energy - tolerance:.2f}")
                    be_max = float(f"{binding_energy + tolerance:.2f}")
                    elements_db[element][orbital] = (be_min, be_max)
        self._ranges_cache[key] = elements_db
        return elements_db

    def is_auger_orbital_expanded(self, orbital_lower):
        auger_patterns = ['kll', 'klm', 'kmm', 'lmm', 'lmv', 'mnn', 'mvv', 'nvv',
                          'noo', 'moo', 'lll', 'mmm', 'nnn', 'mnv']
        for pattern in auger_patterns:
            if pattern in orbital_lower:
                return True
        if re.search(r'[klmno]{2}\d+', orbital_lower):
            return True
        if re.search(r'[klmno]{3}\d+', orbital_lower):
            return True
        return False

    def calculate_decision_value(self, element, orbital, distance):
        # The desktop computes a weighted value but returns the plain distance.
        return distance

    def get_possible_assignments(self, peak_position, tolerance=6.0):
        elements_db = self.get_core_level_ranges()
        possible = []
        for element, orbitals in elements_db.items():
            for orbital, (be_min, be_max) in orbitals.items():
                be_center = (be_min + be_max) / 2
                distance = abs(peak_position - be_center)
                if distance <= tolerance:
                    possible.append({
                        'element': element, 'orbital': orbital, 'position': be_center,
                        'distance': distance,
                        'decision': self.calculate_decision_value(element, orbital, distance),
                        'assignment': f"{element}{orbital}",
                    })
        possible.sort(key=lambda x: x['decision'])
        return possible

    def get_core_level_ranges(self, max_energy=1400.0):
        # use_main_library is always True in the window (the hardcoded table is unused).
        return self.get_core_level_ranges_from_library(max_energy)

    # ── Areas ──────────────────────────────────────────────────────────
    def create_peaks_and_measure(self, identified_elements, x_data, y_data, sheet_name):
        cl = self.parent.Data['Core levels'][sheet_name]
        if 'Fitting' not in cl:
            cl['Fitting'] = {}
        if 'Peaks' not in cl['Fitting']:
            cl['Fitting']['Peaks'] = {}
        peaks_data = cl['Fitting']['Peaks']
        if 'Background' not in cl:
            cl['Background'] = {}
        cl['Background']['Bkg Y'] = y_data.tolist()

        sorted_elements = sorted(identified_elements.items(), key=lambda x: x[1]['peak_position'], reverse=True)
        filtered_elements = {}
        elements_below_600 = {}
        for peak_name, element_data in sorted_elements:
            if element_data['peak_position'] < 1050.0:
                elements_below_600.setdefault(element_data['element'], []).append({
                    'peak_name': peak_name, 'orbital': element_data['orbital'], 'data': element_data})

        for element, orbitals in elements_below_600.items():
            orbital_names = [o['orbital'] for o in orbitals]
            has_2p32 = '2p3/2' in orbital_names
            has_3d52 = '3d5/2' in orbital_names
            has_4f72 = '4f7/2' in orbital_names
            for orbital_info in orbitals:
                peak_name = orbital_info['peak_name']
                orbital = orbital_info['orbital']
                element_data = orbital_info['data']
                simple = {'2p1/2': ('2p', has_2p32), '2p3/2': ('2p', False),
                          '3d3/2': ('3d', has_3d52), '3d5/2': ('3d', False),
                          '4f5/2': ('4f', has_4f72), '4f7/2': ('4f', False)}
                if orbital in simple:
                    main, dismiss = simple[orbital]
                    if dismiss:
                        continue
                    element_data = element_data.copy()
                    element_data['orbital'] = main
                    filtered_elements[f"{element}{main}"] = element_data
                else:
                    filtered_elements[peak_name] = element_data

        for peak_name, element_data in sorted_elements:
            if element_data['peak_position'] >= 1050.0:
                filtered_elements[peak_name] = element_data

        created = []
        for peak_name, element_data in filtered_elements.items():
            area, bg_low, bg_high, peak_height, background_type = \
                self.calculate_peak_area_and_height_with_background(
                    element_data['peak_position'], x_data, y_data, sheet_name, element_data['orbital'])
            formatted_peak_name = f"{peak_name} ."
            peaks_data[formatted_peak_name] = {
                'Position': float(f"{element_data['peak_position']:.2f}"),
                'Height': float(f"{peak_height:.2f}"),
                'FWHM': 2.00, 'L/G': 30.00,
                'Area': float(f"{area:.2f}"),
                'Sigma': 0.00, 'Gamma': 0.00, 'Skew': 0.00,
                'Fitting Model': 'Unfitted',
                'Bkg Type': background_type,
                'Bkg Low': float(f"{bg_low:.2f}"),
                'Bkg High': float(f"{bg_high:.2f}"),
                'Bkg Offset Low': 0.00, 'Bkg Offset High': 0.00,
                'Constraints': {'position': 'Fixed', 'height': 'Fixed', 'fwhm': 'Fixed',
                                'lg_ratio': 'Fixed', 'area': 'Fixed'},
            }
            created.append(formatted_peak_name)
        self.parent.peak_count = len(created)
        return created

    def calculate_adaptive_range_from_position(self, peak_position):
        if peak_position < 100:
            range_width = 5.0
        elif peak_position < 200:
            range_width = 7.0
        elif peak_position < 400:
            range_width = 10.0
        elif peak_position < 600:
            range_width = 15.0
        elif peak_position < 900:
            range_width = 20.0
        else:
            range_width = 25.0
        return peak_position - range_width, peak_position + range_width

    def calculate_peak_area_and_height_with_background(self, peak_position, x_data, y_data, sheet_name, orbital=''):
        bg_low_adaptive, bg_high_adaptive = self.calculate_adaptive_range_from_position(peak_position)
        current_background = np.array(self.parent.Data['Core levels'][sheet_name]['Background']['Bkg Y'])
        mask_adaptive = (x_data >= bg_low_adaptive) & (x_data <= bg_high_adaptive)
        x_range_adaptive = x_data[mask_adaptive]
        y_range_adaptive = y_data[mask_adaptive]
        if len(x_range_adaptive) < 3:
            return 0.00, bg_low_adaptive, bg_high_adaptive, 0.00, "U2-Tougaard"

        peak_start, peak_end = self.find_peak_boundaries(peak_position, x_range_adaptive, y_range_adaptive)
        if orbital.lower() == '1s' or peak_position < 550.00:
            if 'si' in orbital.lower() and '2p' in orbital.lower():
                bg_low = min(peak_start, peak_end) - 5.00
                bg_high = max(peak_start, peak_end) + 4.00
            else:
                bg_low = min(peak_start, peak_end) - 6.00
                bg_high = max(peak_start, peak_end) + 7.00
        else:
            bg_low, bg_high = bg_low_adaptive, bg_high_adaptive

        mask = (x_data >= bg_low) & (x_data <= bg_high)
        x_range = x_data[mask]
        y_range = y_data[mask]
        if len(x_range) < 3:
            return 0.00, bg_low, bg_high, 0.00, "U2-Tougaard"

        background_type = "Linear" if self.is_background_decreasing(x_range, y_range, bg_low, bg_high) \
            else "U2-Tougaard"
        try:
            if background_type == "Linear":
                range_background = BackgroundCalculations.calculate_linear_background(x_range, y_range, 0.00, 0.00)
            else:
                range_background = BackgroundCalculations.calculate_u2_tougaard_background(
                    x_range, y_range, sheet_name, self.parent, (bg_low, bg_high))
            background_filtered = current_background.copy()
            background_filtered[mask] = range_background
        except Exception:
            background_filtered = current_background.copy()
            background_type = "U2-Tougaard"

        self.parent.Data['Core levels'][sheet_name]['Background']['Bkg Y'] = background_filtered.tolist()

        mask = (x_data >= bg_low) & (x_data <= bg_high)
        x_range = x_data[mask]
        y_range = y_data[mask]
        bg_range = background_filtered[mask]
        if len(x_range) < 3:
            return 0.00, bg_low, bg_high, 0.00, background_type
        y_minus_bg = y_range - bg_range
        sorted_indices = np.argsort(x_range)
        area = trapz(y_minus_bg[sorted_indices], x_range[sorted_indices])
        peak_height = y_minus_bg[np.argmax(y_minus_bg)]
        return abs(area), bg_low, bg_high, max(0.00, peak_height), background_type

    def find_peak_boundaries(self, peak_position, x_data, y_data):
        peak_idx = np.argmin(np.abs(x_data - peak_position))
        edge_width = max(5, len(x_data) // 8)
        baseline_left = np.min(y_data[:edge_width])
        baseline_right = np.min(y_data[-edge_width:])
        baseline_avg = (baseline_left + baseline_right) / 2.00
        peak_height = y_data[peak_idx] - baseline_avg
        threshold = baseline_avg + peak_height * 0.005
        dy = np.gradient(y_data, x_data)
        dy_smooth = gaussian_filter1d(dy, sigma=2.0)

        left_idx = 0
        for i in range(peak_idx, 0, -1):
            if y_data[i] <= threshold:
                left_idx = i
                break
            if i > 5 and abs(dy_smooth[i]) < abs(dy_smooth[peak_idx]) * 0.05:
                local_region = y_data[max(0, i - 3):i + 1]
                if np.max(local_region) - np.min(local_region) < peak_height * 0.05:
                    left_idx = i
                    break

        right_idx = len(y_data) - 1
        for i in range(peak_idx, len(y_data)):
            if y_data[i] <= threshold:
                right_idx = i
                break
            if i < len(y_data) - 5 and abs(dy_smooth[i]) < abs(dy_smooth[peak_idx]) * 0.05:
                local_region = y_data[i:min(len(y_data), i + 4)]
                if np.max(local_region) - np.min(local_region) < peak_height * 0.05:
                    right_idx = i
                    break
        return x_data[left_idx], x_data[right_idx]

    def is_background_decreasing(self, x_data, y_data, bg_low, bg_high):
        left_idx = np.argmin(np.abs(x_data - bg_high))
        right_idx = np.argmin(np.abs(x_data - bg_low))
        edge_width = max(3, abs(right_idx - left_idx) // 10)
        left_start = max(0, left_idx - edge_width)
        left_region = y_data[left_start:left_idx]
        left_avg = np.mean(left_region) if len(left_region) > 0 else y_data[left_idx]
        right_end = min(len(y_data), right_idx + edge_width)
        right_region = y_data[right_idx:right_end]
        right_avg = np.mean(right_region) if len(right_region) > 0 else y_data[right_idx]
        avg_level = (left_avg + right_avg) / 2.00
        threshold = avg_level * 0.005
        return (right_avg - left_avg) > threshold


MAIN_ORBITALS = {
    'H': '1s', 'He': '1s',
    'Li': '1s', 'Be': '1s', 'B': '1s', 'C': '1s', 'N': '1s', 'O': '1s', 'F': '1s', 'Ne': '1s',
    'Na': '1s', 'Mg': '1s', 'Al': '2p', 'Si': '2p', 'P': '2p', 'S': '2p', 'Cl': '2p', 'Ar': '2p',
    'K': '2p', 'Ca': '2p', 'Sc': '2p', 'Ti': '2p', 'V': '2p', 'Cr': '2p', 'Mn': '2p', 'Fe': '2p', 'Co': '2p',
    'Ni': '2p', 'Cu': '2p', 'Zn': '2p', 'Ga': '2p', 'Ge': '2p', 'As': '2p', 'Se': '2p', 'Br': '2p', 'Kr': '2p',
    'Rb': '3d', 'Sr': '3d', 'Y': '3d', 'Zr': '3d', 'Nb': '3d', 'Mo': '3d', 'Tc': '3d', 'Ru': '3d', 'Rh': '3d',
    'Pd': '3d', 'Ag': '3d', 'Cd': '3d', 'In': '3d', 'Sn': '3d', 'Sb': '3d', 'Te': '3d', 'I': '3d', 'Xe': '3d',
    'Cs': '3d', 'Ba': '3d', 'La': '3d', 'Ce': '3d', 'Pr': '3d', 'Nd': '3d', 'Pm': '3d', 'Sm': '3d', 'Eu': '3d',
    'Gd': '3d', 'Tb': '3d', 'Dy': '3d', 'Ho': '3d', 'Er': '3d', 'Tm': '3d', 'Yb': '3d', 'Lu': '3d',
    'Hf': '4f', 'Ta': '4f', 'W': '4f', 'Re': '4f', 'Os': '4f', 'Ir': '4f', 'Pt': '4f', 'Au': '4f', 'Hg': '4f',
    'Tl': '4f', 'Pb': '4f', 'Bi': '4f', 'Po': '4f', 'At': '4f', 'Rn': '4f',
    'Fr': '4f', 'Ra': '4f', 'Ac': '4f', 'Th': '4f', 'Pa': '4f', 'U': '4f', 'Np': '4f', 'Pu': '4f', 'Am': '4f',
    'Cm': '4f', 'Bk': '4f', 'Cf': '4f', 'Es': '4f', 'Fm': '4f', 'Md': '4f', 'No': '4f', 'Lr': '4f',
}
ALWAYS_SELECT = ['C', 'O', 'N', 'Na', 'Mg']


class AutoIDWindow:
    """AutoIDWindow without its lists: the run parameters, the found peaks and
    the actions on ticked peaks (ticked = the Results list's ✓ column)."""

    def __init__(self, parent, prominence=0.9, force='', tolerance=12, width=0.6, width_max=20.0,
                 distance=5.0):
        self.parent = parent
        self.auto_survey_id = AutoSurveyID(parent)
        self.prominence = prominence / 100.0   # the control is in %
        self.width = width
        self.width_max = width_max
        self.distance = distance
        self.tolerance = tolerance
        self.all_peaks = []
        self.force_elements_ctrl = _Box(force)
        self.ticked = set()                    # ids of ticked peaks (Results list)

    # parse_forced_elements
    def parse_forced_elements(self, force_text):
        if not force_text.strip():
            return [], [], [], []
        forced_elements, forced_core_levels, excluded_elements, excluded_core_levels = [], [], [], []
        for item in [item.strip() for item in force_text.split(',')]:
            if not item:
                continue
            if item.startswith('-'):
                excluded_item = item[1:].strip()
                if any(c.isdigit() for c in excluded_item) or 'kll' in excluded_item.lower():
                    excluded_core_levels.append(excluded_item)
                else:
                    excluded_elements.append(excluded_item)
                continue
            if any(c.isdigit() for c in item) or 'kll' in item.lower():
                forced_core_levels.append(item)
            else:
                forced_elements.append(item)
        return forced_elements, forced_core_levels, excluded_elements, excluded_core_levels

    def _excluded_elements(self):
        return self.parse_forced_elements(self.force_elements_ctrl.GetValue())[2]

    def _apply_exclusions_to_peaks(self, peaks_to_check):
        excluded_elements = self._excluded_elements()
        if not excluded_elements:
            return peaks_to_check
        filtered = []
        for peak in peaks_to_check:
            assignment = peak.get('assignment', '')
            if not assignment:
                filtered.append(peak)
                continue
            match = re.match(r'([A-Z][a-z]?)', assignment)
            if match:
                if not any(match.group(1).lower() == e.lower() for e in excluded_elements):
                    filtered.append(peak)
            else:
                filtered.append(peak)
        return filtered

    def _apply_exclusions_to_final_assignments(self):
        excluded_elements = self._excluded_elements()
        if not excluded_elements:
            return
        for peak in self.all_peaks:
            if not peak.get('assigned') or peak.get('dismissed'):
                continue
            assignment = peak.get('assignment', '')
            if not assignment:
                continue
            match = re.match(r'([A-Z][a-z]?)', assignment)
            if match and any(match.group(1).lower() == e.lower() for e in excluded_elements):
                peak['assigned'] = False
                peak['assignment'] = ''
                peak['confidence'] = 0

    # The Results list: assigned, not dismissed, by B.E.
    def assigned_rows(self):
        sorted_peaks = sorted(self.all_peaks, key=lambda x: x['position'])
        return [p for p in sorted_peaks if not p.get('dismissed') and p.get('assignment')
                and p.get('assignment') != '']

    def _auto_tick_assigned_peaks(self):
        for peak in self.assigned_rows():
            if peak.get('assigned'):
                self.ticked.add(id(peak))
                peak['create_region'] = True

    def on_select_main_peaks(self):
        """on_select_main_peaks on the Results tab (the tab shown by default)."""
        self.ticked = set()
        for peak in self.assigned_rows():
            match = re.match(r'([A-Z][a-z]?)(\d+[spdf])(?:\d+/\d+)?', peak.get('assignment', ''))
            if not match:
                continue
            element, orbital = match.groups()
            confidence = float(peak.get('confidence', 0))
            is_always_select = element in ALWAYS_SELECT and MAIN_ORBITALS.get(element) == orbital
            if not is_always_select and confidence < 90.0:
                continue
            if element in MAIN_ORBITALS and MAIN_ORBITALS[element] == orbital:
                self.ticked.add(id(peak))

    def ticked_items(self):
        return [{'position': p['position'], 'assignment': p['assignment']}
                for p in self.assigned_rows() if id(p) in self.ticked]

    # ── Actions on ticked peaks ─────────────────────────────────────────
    def create_labels(self, items):
        """on_create_labels (items = ticked [{position, assignment}])."""
        parent = self.parent
        sheet_name = parent.sheet_combobox.GetValue()
        cl = parent.Data['Core levels'][sheet_name]
        if 'Labels' not in cl:
            cl['Labels'] = []
        else:
            cl['Labels'].clear()
        ticked_peaks = self._apply_exclusions_to_peaks(list(items))
        if not ticked_peaks:
            return 0
        y_data = np.array(cl['Raw Data'])
        x_data = np.array(cl['B.E.'])
        max_y = np.max(y_data)
        font_size = getattr(parent, 'label_font_size', 8)
        created = 0
        for peak_data in ticked_peaks:
            position = peak_data['position']
            original = peak_data['assignment']
            label_text = original
            if position < 600.0:
                em = re.match(r'([A-Z][a-z]?)', original)
                element = em.group(1) if em else ""
                element_orbitals = []
                for other in ticked_peaks:
                    if other['position'] < 600.0 and other['assignment'].startswith(element):
                        for o in ('2p1/2', '2p3/2', '3d3/2', '3d5/2', '4f5/2', '4f7/2'):
                            if o in other['assignment']:
                                element_orbitals.append(o)
                                break
                if '2p1/2' in original:
                    if '2p3/2' in element_orbitals:
                        continue
                    label_text = original.replace('2p1/2', '2p')
                elif '2p3/2' in original:
                    label_text = original.replace('2p3/2', '2p')
                elif '3d3/2' in original:
                    if '3d5/2' in element_orbitals:
                        continue
                    label_text = original.replace('3d3/2', '3d')
                elif '3d5/2' in original:
                    label_text = original.replace('3d5/2', '3d')
                elif '4f5/2' in original:
                    if '4f7/2' in element_orbitals:
                        continue
                    label_text = original.replace('4f5/2', '4f')
                elif '4f7/2' in original:
                    label_text = original.replace('4f7/2', '4f')
            mask = (x_data >= position - 2) & (x_data <= position + 2)
            if np.any(mask):
                label_y = np.max(y_data[mask]) + 0.05 * max_y
                cl['Labels'].append({
                    'text': label_text,
                    'x': float(f"{position:.2f}"),
                    'y': float(f"{label_y:.2f}"),
                    'rotation': 90,
                    'fontsize': font_size,
                    'fontfamily': 'Arial',
                    'fontweight': 'normal',
                })
                created += 1
        return created

    def _clear_all_peaks_and_data(self, sheet_name):
        parent = self.parent
        grid = parent.peak_params_grid
        if grid.GetNumberRows() > 0:
            grid.DeleteRows(0, grid.GetNumberRows())
        parent.peak_count = 0
        if sheet_name in parent.Data['Core levels']:
            cl = parent.Data['Core levels'][sheet_name]
            if 'Fitting' in cl:
                if 'Peaks' in cl['Fitting']:
                    cl['Fitting']['Peaks'].clear()
                if 'Results' in cl['Fitting']:
                    cl['Fitting']['Results'].clear()
            if 'Background' not in cl:
                cl['Background'] = {}
            cl['Background']['Bkg Y'] = list(cl['Raw Data'])

    def create_regions(self, items):
        """on_create_regions (items = ticked [{position, assignment}]). None when nothing is ticked."""
        selected_peaks = self._apply_exclusions_to_peaks(list(items))
        if not selected_peaks:
            return None
        sheet_name = self.parent.sheet_combobox.GetValue()
        self._clear_all_peaks_and_data(sheet_name)
        cl = self.parent.Data['Core levels'][sheet_name]
        x_values = np.array(cl['B.E.'])
        y_values_raw = np.array(cl['Raw Data'])
        identified_elements = {}
        for peak_data in selected_peaks:
            assignment = peak_data['assignment']
            match = re.match(r'([A-Z][a-z]?)(.+)', assignment)
            if match:
                identified_elements[assignment] = {
                    'peak_position': peak_data['position'], 'element': match.group(1),
                    'orbital': match.group(2), 'priority': 1, 'prominence': 0.1, 'confidence': 100,
                }
        return self.auto_survey_id.create_peaks_and_measure(identified_elements, x_values, y_values_raw,
                                                            sheet_name)

    def delete_all(self):
        """on_delete_all (after the confirmation)."""
        sheet_name = self.parent.sheet_combobox.GetValue()
        self._clear_all_peaks_and_data(sheet_name)
        cl = self.parent.Data['Core levels'][sheet_name]
        if 'Labels' in cl:
            cl['Labels'].clear()


class Method1Identifier:
    """Only its peak finding is used (Method 2 is the window's method)."""

    def __init__(self, parent_window):
        self.parent_window = parent_window
        self.auto_survey_id = parent_window.auto_survey_id
        self.process_log = []

    def _find_peaks(self):
        pw = self.parent_window
        parent = self.auto_survey_id.parent
        sheet_name = parent.sheet_combobox.GetValue()
        if sheet_name not in parent.Data['Core levels']:
            self.process_log.append("ERROR: No data found for selected sheet")
            return
        x_values = np.array(parent.Data['Core levels'][sheet_name]['B.E.'])
        y_values_raw = np.array(parent.Data['Core levels'][sheet_name]['Raw Data'])
        y_values = gaussian_filter1d(y_values_raw, sigma=1.0)
        max_intensity = np.max(y_values)
        prominence_threshold = pw.prominence * max_intensity
        eV_per_point = abs(x_values[1] - x_values[0])
        width_min_points = pw.width / eV_per_point
        width_max_points = pw.width_max / eV_per_point
        peaks, properties = find_peaks(y_values, prominence=prominence_threshold,
                                       width=(width_min_points, width_max_points), distance=pw.distance)
        widths_half = peak_widths(y_values, peaks, rel_height=0.5)
        pw.all_peaks = []
        for i, peak_idx in enumerate(peaks):
            width_eV = widths_half[0][i] * eV_per_point
            normalized_prominence = properties['prominences'][i] / max_intensity
            pw.all_peaks.append({
                'index': i,
                'position': float(f"{x_values[peak_idx]:.2f}"),
                'intensity': float(f"{y_values[peak_idx]:.2f}"),
                'prominence': float(f"{normalized_prominence:.4f}"),
                'width': float(f"{width_eV:.2f}"),
                'create_region': False,
                'peak_idx': int(peak_idx),
            })
        self.process_log.append(f"Found {len(pw.all_peaks)} peaks (prominence >= {pw.prominence}, "
                                f"width {pw.width} - {pw.width_max} eV, distance >= {pw.distance} points)")


class Method2Identifier:
    """Method 2 GK 25/08/25 - automatic assignments (the window's default)."""

    def __init__(self, parent_window):
        self.parent_window = parent_window
        self.auto_survey_id = parent_window.auto_survey_id
        self.process_log = []

    def run(self):
        self.process_log = []
        m1 = Method1Identifier(self.parent_window)
        m1._find_peaks()
        self.process_log.extend(m1.process_log)
        self._dismiss_wide_peaks()
        self._process_forced_elements()
        self._identify_usual_suspects()
        self._check_companions()
        self.parent_window._apply_exclusions_to_final_assignments()

    @property
    def peaks(self):
        return self.parent_window.all_peaks

    def _dismiss_wide_peaks(self):
        for peak in self.peaks:
            if peak['width'] > self.parent_window.width_max:
                peak['dismissed'] = True
                peak['dismiss_reason'] = f"Too wide ({peak['width']:.2f} > {self.parent_window.width_max:.1f})"

    def _identify_usual_suspects(self):
        self._check_oxygen()
        self._check_carbon()
        self._check_sodium()
        self._check_nitrogen()
        self._check_fluorine()
        self._check_silicon()
        self._check_2p_2s_pairs()
        self._check_single_peaks()
        self._check_silver()
        self._check_gold()
        self._check_copper()
        self._check_zinc()

    def _check_oxygen(self):
        o1s_candidates = [p for p in self.peaks
                          if 525 <= p['position'] <= 535 and not p.get('assigned') and not p.get('dismissed')]
        prominent = [p for p in o1s_candidates if p['prominence'] >= 0.15]
        if not prominent:
            return
        o1s_peak = max(prominent, key=lambda x: x['prominence'])
        okll_position = self._get_auger_position('O', 'kll')
        if okll_position:
            okll_peak = self._find_peak_near_position(okll_position, tolerance=4.0)
            if okll_peak:
                self._assign_peak(o1s_peak, 'O1s', confidence=95, locked=True)
                self._assign_peak(okll_peak, 'Okll', confidence=95, locked=True)
                self.process_log.append("Assigned O1s + Okll (95%)")
            else:
                self._assign_peak(o1s_peak, 'O1s', confidence=85, locked=True)
                self.process_log.append("Assigned O1s only (85%)")

    def _check_pair_1s(self, name, be_min, be_max, auger_orbital, tolerance):
        """_check_carbon / _check_nitrogen / _check_fluorine."""
        peak_1s = self._find_peak_in_range(be_min, be_max)
        if peak_1s:
            auger_position = self._get_auger_position(name, auger_orbital)
            if auger_position:
                auger_peak = self._find_peak_near_position(auger_position, tolerance=tolerance)
                if auger_peak:
                    self._assign_peak(peak_1s, f'{name}1s', confidence=95, locked=True)
                    self._assign_peak(auger_peak, f'{name}kll', confidence=95, locked=True)
                else:
                    self._assign_peak(peak_1s, f'{name}1s', confidence=85, locked=True)

    def _check_carbon(self):
        self._check_pair_1s('C', 282, 293, 'kll', 4.0)

    def _check_nitrogen(self):
        self._check_pair_1s('N', 395, 405, 'kll', 8.0)

    def _check_fluorine(self):
        self._check_pair_1s('F', 680, 688, 'KL1', 10.0)

    def _check_sodium(self):
        na1s_candidates = [p for p in self.peaks
                           if abs(p['position'] - 1072) <= 6.0 and not p.get('assigned') and not p.get('dismissed')]
        if not na1s_candidates:
            return
        na1s_peak = min(na1s_candidates, key=lambda x: abs(x['position'] - 1072))
        nakll_found = False
        for pattern in ['kll', 'KL1', 'KLL1']:
            nakll_position = self._get_auger_position('Na', pattern.lower())
            if nakll_position:
                nakll_peak = self._find_peak_near_position(nakll_position, tolerance=6.0)
                if nakll_peak:
                    possible = self.auto_survey_id.get_possible_assignments(nakll_peak['position'],
                                                                            self.parent_window.tolerance)
                    na_auger = [p for p in possible if p['element'] == 'Na' and 'k' in p['orbital'].lower()]
                    if na_auger:
                        self._assign_peak(na1s_peak, 'Na1s', confidence=95, locked=True)
                        self._assign_peak(nakll_peak, na_auger[0]['assignment'], confidence=95, locked=True)
                        nakll_found = True
                        break
        if not nakll_found:
            self._assign_peak(na1s_peak, 'Na1s', confidence=90, locked=True)

    def _check_silicon(self):
        si2p_peak = self._find_peak_in_range(94, 105)
        if si2p_peak:
            si2s_position = self._get_library_position('Si', '2s')
            if si2s_position:
                si2s_peak = self._find_peak_near_position(si2s_position, tolerance=6.0)
                if si2s_peak:
                    if self._check_rsf_ratio('Si', '2p', '2s', si2p_peak, si2s_peak):
                        self._assign_peak(si2p_peak, 'Si2p', confidence=95, locked=True)
                        self._assign_peak(si2s_peak, 'Si2s', confidence=95, locked=True)
                else:
                    self._assign_peak(si2p_peak, 'Si2p', confidence=75)

    def _check_2p_2s_pairs(self):
        for element in ['P', 'S', 'Cl', 'Ca', 'K', 'Al']:
            p2p_pos = self._get_library_position(element, '2p')
            p2s_pos = self._get_library_position(element, '2s')
            if p2p_pos and p2s_pos:
                p2p_peak = self._find_peak_near_position(p2p_pos, tolerance=8.0)
                p2s_peak = self._find_peak_near_position(p2s_pos, tolerance=8.0)
                if p2p_peak and p2s_peak:
                    if self._check_rsf_ratio(element, '2p', '2s', p2p_peak, p2s_peak):
                        self._assign_peak(p2p_peak, f'{element}2p', confidence=95, locked=True)
                        self._assign_peak(p2s_peak, f'{element}2s', confidence=95, locked=True)
                        if element != 'Al' and p2p_peak['prominence'] > 0.2:
                            self._check_3p_3s_companions(element, p2p_peak)

    def _check_3p_3s_companions(self, element, p2p_peak):
        p3p_pos = self._get_library_position(element, '3p')
        if p3p_pos:
            p3p_peak = self._find_peak_near_position(p3p_pos, tolerance=4.0)
            if p3p_peak and not p3p_peak.get('assigned'):
                rsf_2p = self._get_rsf_for_assignment(f'{element}2p')
                rsf_3p = self._get_rsf_for_assignment(f'{element}3p')
                if rsf_2p > 0 and rsf_3p > 0:
                    expected_ratio = rsf_2p / rsf_3p
                    observed_ratio = (p2p_peak['prominence'] * p2p_peak['width']) / \
                                     (p3p_peak['prominence'] * p3p_peak['width'])
                    if 0.2 <= (observed_ratio / expected_ratio) <= 5.0:
                        self._assign_peak(p3p_peak, f'{element}3p', confidence=85, locked=True)
        # The desktop then only logs what it finds near the 3s position (no assignment).

    def _check_single_peaks(self):
        mg1s_pos = self._get_library_position('Mg', '1s')
        if mg1s_pos:
            mg1s_peak = self._find_peak_near_position(mg1s_pos, tolerance=5.0)
            if mg1s_peak and mg1s_peak['width'] < 5.0:
                self._assign_peak(mg1s_peak, 'Mg1s', confidence=90, locked=True)
        f1s_pos = self._get_library_position('F', '1s')
        if f1s_pos:
            f1s_peak = self._find_peak_near_position(f1s_pos, tolerance=5.0)
            if f1s_peak and f1s_peak['width'] < 5.0:
                self._assign_peak(f1s_peak, 'F1s', confidence=90, locked=True)

    def _check_silver(self):
        ag3d_pos = self._get_library_position('Ag', '3d')
        if ag3d_pos:
            ag3d_peak = self._find_peak_near_position(ag3d_pos, tolerance=5.0)
            if ag3d_peak:
                ag3p_pos = self._get_library_position('Ag', '3p')
                ag3s_pos = self._get_library_position('Ag', '3s')
                ag3p_peak = self._find_peak_near_position(ag3p_pos, tolerance=4.0) if ag3p_pos else None
                ag3s_peak = self._find_peak_near_position(ag3s_pos, tolerance=4.0) if ag3s_pos else None
                if ag3p_peak and ag3s_peak:
                    self._assign_peak(ag3d_peak, 'Ag3d', confidence=95, locked=True)
                    self._assign_peak(ag3p_peak, 'Ag3p', confidence=95, locked=True)
                    self._assign_peak(ag3s_peak, 'Ag3s', confidence=95, locked=True)
                elif ag3p_peak:
                    self._assign_peak(ag3d_peak, 'Ag3d', confidence=85, locked=True)
                    self._assign_peak(ag3p_peak, 'Ag3p', confidence=85, locked=True)

    def _check_gold(self):
        au4f_pos = self._get_library_position('Au', '4f')
        if au4f_pos:
            au4f_peak = self._find_peak_near_position(au4f_pos, tolerance=5.0)
            if au4f_peak:
                au4p_pos = self._get_library_position('Au', '4p')
                au4p_peak = self._find_peak_near_position(au4p_pos, tolerance=4.0) if au4p_pos else None
                if au4p_peak:
                    self._assign_peak(au4f_peak, 'Au4f', confidence=95, locked=True)
                    self._assign_peak(au4p_peak, 'Au4p', confidence=95, locked=True)
                    if au4f_peak['prominence'] > 0.3:
                        au4s_pos = self._get_library_position('Au', '4s')
                        if au4s_pos:
                            au4s_peak = self._find_peak_near_position(au4s_pos, tolerance=4.0)
                            if au4s_peak:
                                self._assign_peak(au4s_peak, 'Au4s', confidence=90, locked=True)

    def _check_split_2p(self, element):
        """_check_copper / _check_zinc."""
        pos_2p = self._get_library_position(element, '2p')
        if pos_2p:
            peak_2p = self._find_peak_near_position(pos_2p, tolerance=8.0)
            if peak_2p:
                pos_32 = self._get_library_position(element, '2p3/2')
                pos_12 = self._get_library_position(element, '2p1/2')
                if pos_32 and pos_12:
                    peak_32 = self._find_peak_near_position(pos_32, tolerance=3.0)
                    peak_12 = self._find_peak_near_position(pos_12, tolerance=3.0)
                    if peak_32 and peak_12:
                        self._assign_peak(peak_32, f'{element}2p3/2', confidence=95, locked=True)
                        self._assign_peak(peak_12, f'{element}2p1/2', confidence=95, locked=True)
                        if peak_32.get('prominence', 0) > 0.15:
                            self._check_3p_companion(element)
                            self._check_auger_companions(element)
                    else:
                        self._assign_peak(peak_2p, f'{element}2p', confidence=75)
                        if peak_2p.get('prominence', 0) > 0.15:
                            self._check_3p_companion(element)
                            self._check_auger_companions(element)

    def _check_copper(self):
        self._check_split_2p('Cu')

    def _check_zinc(self):
        self._check_split_2p('Zn')

    def _check_companions(self):
        unassigned = [p for p in self.peaks if not p.get('assigned') and not p.get('dismissed')]
        unassigned.sort(key=lambda x: x['prominence'], reverse=True)
        for peak in unassigned:
            if peak.get('assigned'):
                continue
            possible = self.auto_survey_id.get_possible_assignments(peak['position'], self.parent_window.tolerance)
            for assignment in possible[:]:
                element = assignment['element']
                orbital = assignment['orbital']
                if element in ['Cr', 'Fe', 'Co', 'Ni', 'Cu'] and orbital == '2p':
                    if self._check_transition_metal_companions(peak, element):
                        break
                elif element in ['Ce', 'La'] and orbital == '3d':
                    if self._check_lanthanide_companions(peak, element):
                        break
                else:
                    if self._check_general_companions(peak, element, orbital):
                        break

    def _check_transition_metal_companions(self, peak, element):
        if peak['position'] > 400:
            shifted_peak = dict(peak)
            shifted_peak['position'] = peak['position'] + 4.0
            if self._check_2p_doublet(shifted_peak, element):
                self._check_auger_companions(element)
                if peak['prominence'] > 0.15:
                    self._check_3p_companion(element)
                return True
        return self._check_auger_companions(element, peak)

    def _check_2p_doublet(self, main_peak, element):
        p2p32_pos = self._get_library_position(element, '2p3/2')
        p2p12_pos = self._get_library_position(element, '2p1/2')
        if not p2p32_pos or not p2p12_pos:
            return False
        expected_separation = abs(p2p12_pos - p2p32_pos)
        tolerance = max(5.0, expected_separation * 0.3)
        p2p32_peak = self._find_peak_near_position(p2p32_pos, tolerance=tolerance)
        p2p12_peak = self._find_peak_near_position(p2p12_pos, tolerance=tolerance)
        if p2p32_peak and p2p12_peak:
            if p2p32_peak.get('assigned') or p2p12_peak.get('assigned'):
                return False
            intensity_ratio = p2p32_peak['prominence'] / p2p12_peak['prominence']
            if 1.0 <= intensity_ratio <= 3.5:
                self._assign_peak(p2p32_peak, f'{element}2p3/2', confidence=95, locked=True)
                self._assign_peak(p2p12_peak, f'{element}2p1/2', confidence=95, locked=True)
                return True
        return None   # the desktop falls off the end (None) in the other cases

    def _check_auger_companions(self, element, main_peak=None):
        for auger_orbital in ['lmm', 'mnn', 'LM1', 'LM2', 'MN1', 'MN2']:
            auger_pos = self._get_auger_position(element, auger_orbital)
            if auger_pos:
                auger_peak = self._find_peak_near_position(auger_pos, tolerance=8.0)
                if auger_peak and not auger_peak.get('assigned'):
                    assign_auger = True
                    if main_peak:
                        assign_auger = self._check_rsf_ratio(element, '2p', auger_orbital, main_peak, auger_peak)
                    if assign_auger:
                        if not main_peak:
                            self._assign_peak(auger_peak, f'{element}{auger_orbital}', confidence=90, locked=True)
                        else:
                            self._assign_peak(main_peak, f'{element}2p', confidence=85, locked=True)
                            self._assign_peak(auger_peak, f'{element}{auger_orbital}', confidence=85, locked=True)
                        return True
        return False

    def _check_3p_companion(self, element):
        p3p_pos = self._get_library_position(element, '3p')
        if p3p_pos:
            p3p_peak = self._find_peak_near_position(p3p_pos, tolerance=4.0)
            if p3p_peak and not p3p_peak.get('assigned'):
                self._assign_peak(p3p_peak, f'{element}3p', confidence=80)
                self._check_3s_companion(element)

    def _check_3s_companion(self, element):
        p3s_pos = self._get_library_position(element, '3s')
        if p3s_pos:
            p3s_peak = self._find_peak_near_position(p3s_pos, tolerance=4.0)
            if p3s_peak and not p3s_peak.get('assigned'):
                self._assign_peak(p3s_peak, f'{element}3s', confidence=70)

    def _check_lanthanide_companions(self, peak, element):
        p4d_pos = self._get_library_position(element, '4d')
        if p4d_pos and p4d_pos < 70.0:
            p4d_peak = self._find_peak_near_position(p4d_pos, tolerance=4.0)
            if p4d_peak and not p4d_peak.get('assigned'):
                if self._check_rsf_ratio(element, '3d', '4d', peak, p4d_peak):
                    self._assign_peak(peak, f'{element}3d', confidence=90, locked=True)
                    self._assign_peak(p4d_peak, f'{element}4d', confidence=90, locked=True)
                    return True
        return False

    def _check_general_companions(self, peak, element, orbital):
        if orbital == '2p' and peak['position'] > 400:
            return self._check_transition_metal_companions(peak, element)
        companion_orbital = {'2p': '2s', '3d': '3p', '4f': '4d'}.get(orbital)
        if not companion_orbital:
            return False
        if MAIN_ORBITALS.get(element, '2p') != orbital:
            if not self._is_element_main_orbital_assigned(element):
                return False
        comp_pos = self._get_library_position(element, companion_orbital)
        if comp_pos:
            comp_peak = self._find_peak_near_position(comp_pos, tolerance=4.0)
            if comp_peak and not comp_peak.get('assigned'):
                if self._check_rsf_ratio(element, orbital, companion_orbital, peak, comp_peak):
                    self._assign_peak(peak, f'{element}{orbital}', confidence=85)
                    self._assign_peak(comp_peak, f'{element}{companion_orbital}', confidence=85)
                    return True
        return False

    # ── helpers ────────────────────────────────────────────────────────
    def _find_peak_in_range(self, be_min, be_max, min_prominence=0.0):
        candidates = [p for p in self.peaks
                      if be_min <= p['position'] <= be_max and p['prominence'] >= min_prominence
                      and not p.get('assigned') and not p.get('dismissed')]
        return max(candidates, key=lambda x: x['prominence']) if candidates else None

    def _find_peak_near_position(self, position, tolerance=4.0):
        best_peak = None
        best_distance = tolerance
        for peak in self.peaks:
            if not peak.get('assigned') and not peak.get('dismissed'):
                distance = abs(peak['position'] - position)
                if distance < best_distance:
                    best_distance = distance
                    best_peak = peak
        return best_peak

    def _instrument(self, data):
        instrument = 'A-ALTHERMO1'
        if instrument not in data:
            instrument = self.auto_survey_id.parent.current_instrument
            if instrument not in data:
                instrument = next(iter(data))
        return instrument

    def _get_library_position(self, element, orbital):
        key = (element, orbital)
        if key in self.auto_survey_id.library_data:
            data = self.auto_survey_id.library_data[key]
            instrument = self._instrument(data)
            if 'position' in data[instrument]:
                position = float(data[instrument]['position'])
                if self.auto_survey_id.is_auger_orbital_expanded(orbital.lower()):
                    photon_energy = getattr(self.auto_survey_id.parent, 'photons', 1486.6)
                    return photon_energy - position + 4.5
                return position
        return None

    def _get_auger_position(self, element, auger_orbital):
        position = self._get_library_position(element, auger_orbital)
        if position:
            return position
        variations = []
        if auger_orbital.lower() == 'kll':
            variations = ['KLL', 'KL1', 'KLL1', 'kll', 'kl1']
        elif auger_orbital.lower() == 'lmm':
            variations = ['LMM', 'LM1', 'LMM1', 'lmm', 'lm1']
        for variation in variations:
            position = self._get_library_position(element, variation)
            if position:
                return position
        return None

    def _get_rsf_for_assignment(self, assignment):
        return _rsf_for_assignment(self.auto_survey_id, assignment)

    def _assign_peak(self, peak, assignment, confidence=0, locked=False):
        peak['assignment'] = assignment
        peak['confidence'] = confidence
        peak['locked'] = locked
        peak['assigned'] = True

    def _check_rsf_ratio(self, element, orbital1, orbital2, peak1, peak2):
        rsf1 = self._get_rsf_for_assignment(f"{element}{orbital1}")
        rsf2 = self._get_rsf_for_assignment(f"{element}{orbital2}")
        if rsf1 <= 0 or rsf2 <= 0:
            return True
        expected_ratio = rsf1 / rsf2
        observed_ratio = peak1['prominence'] / peak2['prominence']
        return 0.5 <= (observed_ratio / expected_ratio) <= 2.0

    def _is_element_main_orbital_assigned(self, element):
        main_assignment = f"{element}{MAIN_ORBITALS.get(element, '2p')}"
        return any(p.get('assignment') == main_assignment for p in self.peaks)

    def _process_forced_elements(self):
        pw = self.parent_window
        forced_elements, forced_core_levels, excluded_elements, _ = pw.parse_forced_elements(
            pw.force_elements_ctrl.GetValue())
        self.auto_survey_id.excluded_elements = excluded_elements
        for excluded_element in excluded_elements:
            for peak in self.peaks:
                if peak.get('assigned') or peak.get('dismissed'):
                    continue
                possible = self.auto_survey_id.get_possible_assignments(peak['position'], pw.tolerance)
                for p in possible:
                    if p['element'].lower() == excluded_element.lower():
                        peak['dismissed'] = True
                        peak['dismiss_reason'] = f'Excluded: {excluded_element}'
                        break
        if not forced_elements and not forced_core_levels:
            return

        for element in forced_elements:
            element_assignments = []
            for peak in self.peaks:
                if peak.get('assigned') or peak.get('dismissed'):
                    continue
                possible = self.auto_survey_id.get_possible_assignments(peak['position'], pw.tolerance)
                element_possibilities = [p for p in possible if p['element'].lower() == element.lower()]
                if element_possibilities:
                    element_possibilities.sort(key=lambda x: x['distance'])
                    best = element_possibilities[0]
                    element_assignments.append({
                        'peak': peak, 'assignment': best['assignment'], 'distance': best['distance'],
                        'rsf': self._get_rsf_for_assignment(best['assignment']), 'orbital': best['orbital']})
            element_assignments.sort(key=lambda x: x['rsf'], reverse=True)
            for ea in element_assignments:
                if ea['peak'].get('assigned') or ea['peak'].get('dismissed'):
                    continue
                self._assign_peak(ea['peak'], ea['assignment'], confidence=95, locked=True)
                self.process_log.append(f"FORCED: {ea['assignment']} at {ea['peak']['position']:.2f} eV")

        for core_level_str in forced_core_levels:
            element = ""
            orbital = ""
            if 'kll' in core_level_str.lower():
                element = core_level_str.lower().replace('kll', '')
                orbital = 'kll'
            else:
                for i, char in enumerate(core_level_str):
                    if char.isdigit():
                        element = core_level_str[:i]
                        orbital = core_level_str[i:]
                        break
            if not (element and orbital):
                self.process_log.append(f"Could not parse element and orbital from {core_level_str}")
                continue
            assignment = f"{element}{orbital}"
            best_peak = None
            best_distance = float('inf')
            best_rsf = 1.0
            for peak in self.peaks:
                if peak.get('assigned') or peak.get('dismissed'):
                    continue
                possible = self.auto_survey_id.get_possible_assignments(peak['position'], pw.tolerance)
                for p in possible:
                    if p['assignment'].lower() == assignment.lower():
                        if p['distance'] < best_distance:
                            best_distance = p['distance']
                            best_peak = peak
                            best_rsf = self._get_rsf_for_assignment(p['assignment'])
                            break
            if not best_peak:
                self.process_log.append(f"No peak found for forced core level {core_level_str}")
                continue
            self._assign_peak(best_peak, assignment, confidence=95, locked=True)
            self.process_log.append(f"FORCED: {assignment} at {best_peak['position']:.2f} eV")
            related = []
            for peak in self.peaks:
                if peak.get('assigned') or peak.get('dismissed') or peak is best_peak:
                    continue
                possible = self.auto_survey_id.get_possible_assignments(peak['position'], pw.tolerance)
                element_possibilities = [p for p in possible if p['element'].lower() == element.lower()]
                if element_possibilities:
                    element_possibilities.sort(key=lambda x: x['distance'])
                    related.append({
                        'peak': peak, 'assignment': element_possibilities[0]['assignment'],
                        'distance': element_possibilities[0]['distance'],
                        'rsf': self._get_rsf_for_assignment(element_possibilities[0]['assignment'])})
            related.sort(key=lambda x: x['rsf'], reverse=True)
            for ra in related[:3]:
                intensity_ratio = ra['peak']['prominence'] / best_peak['prominence']
                rsf_ratio = ra['rsf'] / best_rsf if best_rsf > 0 else 1
                if rsf_ratio == 0 or 0.05 <= intensity_ratio / rsf_ratio <= 20:
                    self._assign_peak(ra['peak'], ra['assignment'], confidence=90, locked=True)


def _rsf_for_assignment(asi, assignment):
    """_get_rsf_for_assignment (A-ALTHERMO1, else the current instrument, else the first)."""
    if not assignment:
        return 1.0
    match = re.match(r'([A-Z][a-z]?)(.+)', assignment)
    if not match:
        return 1.0
    key = match.groups()
    if key in asi.library_data:
        data = asi.library_data[key]
        instrument = 'A-ALTHERMO1'
        if instrument not in data:
            instrument = asi.parent.current_instrument
            if instrument not in data:
                instrument = next(iter(data))
        if 'rsf' in data[instrument]:
            return float(data[instrument]['rsf'])
    return 1.0


# ── Web functions ───────────────────────────────────────────────────────
def _check_survey(w):
    sheet = w.sheet_combobox.GetValue()
    if not _is_survey(sheet):
        raise ValueError(AUTOID_NOT_SURVEY)
    if sheet not in w.Data['Core levels']:
        raise ValueError("No data found for selected sheet")
    return sheet


def possible_assignments(w, position, tolerance=12, force=''):
    """The 'Force Assignment' choices for a peak (get_possible_assignments)."""
    win = AutoIDWindow(w, force=force, tolerance=tolerance)
    win.auto_survey_id.excluded_elements = win._excluded_elements() if force else []
    return [{'assignment': p['assignment'], 'element': p['element'], 'line': p['orbital'],
             'expected': _f(p['position'], 2), 'distance': _f(p['distance'], 2)}
            for p in win.auto_survey_id.get_possible_assignments(float(position), tolerance)]


def auto_id(w, prominence=0.9, force='', tolerance=12, width=0.6, width_max=20.0, distance=5.0, apply=True,
            max_possibilities=20):
    """AutoIDWindow.on_run with the classic engine (Method 2) on the current sheet.

    prominence is in % of the strongest (smoothed) peak, force is the "Force
    Elements/Core Levels" text ('Ni, Br3d, Nakll, -Zn'). With apply=True (what
    the desktop's Run does) the run is followed by Create Labels (all assigned
    peaks), Select Main Peaks and Create Areas (the main peaks), then the
    atomic concentrations and the sheet are refreshed.
    Each detected peak lists its first max_possibilities candidates (the desktop
    shows all within the tolerance — often 200+; possible_assignments gives them all).
    """
    sheet = _check_survey(w)
    prominence = float(prominence)
    if prominence <= 0 or prominence > 100:
        raise ValueError("Prominence should be between 0.1% and 100%")
    win = AutoIDWindow(w, prominence=prominence, force=force or '', tolerance=tolerance, width=width,
                       width_max=width_max, distance=distance)
    method = Method2Identifier(win)
    method.run()
    win._auto_tick_assigned_peaks()

    created = []
    if apply:
        try:
            win.create_labels(win.ticked_items())
            win.on_select_main_peaks()
            created = win.create_regions(win.ticked_items()) or []
        except Exception as e:  # the desktop prints and carries on
            method.process_log.append(f"Error in auto sequence: {e}")
        from .sheets import select_sheet
        select_sheet(w, sheet)

    asi = win.auto_survey_id
    proposals = []
    for i, p in enumerate(win.assigned_rows()):
        assignment = p['assignment']
        m = re.match(r'([A-Z][a-z]?)(.+)', assignment)
        possible = asi.get_possible_assignments(p['position'], win.tolerance)
        match = next((q for q in possible if q['assignment'] == assignment), None)
        proposals.append({
            'index': i,
            'element': m.group(1) if m else assignment,
            'line': m.group(2) if m else '',
            'assignment': assignment,
            'be': p['position'],
            'position': p['position'],
            'expected': _f(match['position'], 2) if match else None,
            'distance': _f(match['distance'], 2) if match else None,
            'score': p.get('confidence', 0),
            'confidence': p.get('confidence', 0),
            'locked': bool(p.get('locked')),
            'ticked': id(p) in win.ticked,
            'rsf': _f(_rsf_for_assignment(asi, assignment)),
            'width': p['width'], 'prominence': p['prominence'], 'intensity': p['intensity'],
        })
    peaks = []
    for p in sorted(win.all_peaks, key=lambda x: x['position']):
        possible = asi.get_possible_assignments(p['position'], win.tolerance)
        peaks.append({
            'be': p['position'], 'intensity': p['intensity'], 'prominence': p['prominence'],
            'width': p['width'], 'dismissed': bool(p.get('dismissed')),
            'reason': p.get('dismiss_reason', ''),
            'assignment': p.get('assignment', '') or '',
            'confidence': p.get('confidence', 0),
            'possibilities': [{'assignment': q['assignment'], 'distance': _f(q['distance'], 2)} for q in possible[:max_possibilities]],
            'nPossibilities': len(possible),
        })
    return {
        'sheet': sheet,
        'proposals': proposals,
        'peaks': peaks,
        'applied': bool(apply),
        'created': created,
        'labels': labels_of(w, sheet),
        'log': method.process_log,
        'options': {'prominence': prominence, 'force': force or '', 'tolerance': tolerance, 'width': width,
                    'width_max': width_max, 'distance': distance},
    }


def auto_id_create(w, items, mode, force=''):
    """on_create_labels / on_create_regions / on_create_regions_labels for the
    ticked proposals (items = [{assignment, be}] — 'position' is accepted too).

    'labels' replaces the sheet's labels; 'areas' replaces the sheet's peaks
    with one 'Unfitted' area per line (Linear or U2-Tougaard background) and
    rebuilds the background; 'both' does the areas then the labels. The
    exclusions ('-El' in force) are applied as in the window.
    """
    from .sheets import select_sheet
    sheet = _check_survey(w)
    if mode not in ('labels', 'areas', 'both'):
        raise ValueError("mode must be 'labels', 'areas' or 'both'")
    ticked = []
    for it in items or []:
        pos = it.get('be', it.get('position'))
        if pos is None or not it.get('assignment'):
            continue
        ticked.append({'position': float(pos), 'assignment': str(it['assignment'])})
    ticked.sort(key=lambda t: t['position'])   # the Results list order
    win = AutoIDWindow(w, force=force or '')
    created = None
    n_labels = None
    if mode in ('areas', 'both'):
        created = win.create_regions(ticked)
    if mode in ('labels', 'both'):
        n_labels = win.create_labels(ticked)
    select_sheet(w, sheet)
    return {'created': created or [], 'areasDone': created is not None,
            'labelsCreated': n_labels, 'labels': labels_of(w, sheet)}


def auto_id_clear(w):
    """AutoIDWindow.on_delete_all: remove every area (peak) and label of the sheet."""
    from .sheets import select_sheet
    sheet = w.sheet_combobox.GetValue()
    AutoIDWindow(w).delete_all()
    select_sheet(w, sheet)
    return {'labels': labels_of(w, sheet)}
