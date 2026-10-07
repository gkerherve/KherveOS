# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: importing spectra that are not KherveFitting workbooks —
# VAMAS (.vms, FileMenu/Open.open_vamas_file, read with the `vamas` package
# as on the desktop), two-column CSV (import_xps_csv_file) and text files
# (import_raman_txt_file). Each block becomes a core level, as the desktop's
# converted workbook would give. Synced with KherveFitting-AI (dev-AI v1.93,
# FileMenu/Vamas_Import.py): PHI spin-orbit digits dropped from region names,
# blocks trimmed to the points both axes have, the full Experimental
# Description block.

import os
import re

from .session import empty_data
from .workbook import core_level_from_rows

CASA_INFO_FIELDS = [
    'Casa Sample Name', 'Stage Position', 'Angle', 'FoV Position', 'Lens Mode',
    'Neutraliser', 'Charge Balance', 'Filament Current', 'Filament Bias',
    'Magnet Lens Trim Coil', 'Aperture', 'Iris Position'
]


# Labels of the per-sheet Experimental Description block (Vamas_Import, dev-AI)
VAMAS_EXP_LABELS = [
    "Sample ID", "Date", "Time", "Technique", "Species & Transition", "Number of scans",
    "Source Label", "Source Energy", "Source width X", "Source width Y", "Pass Energy", "Work Function",
    "Analyzer Mode", "Sputtering Energy", "Sputter Time", "Sample Tilt",
    "Take-off Polar Angle", "Take-off Azimuth", "Target Bias",
    "Analysis Width X", "Analysis Width Y", "X Label", "X Units", "X Start", "X Step", "Num Y Values",
    "Num Scans", "Collection Time", "Time Correction", "Y Unit", "# Comment Lines", "Block Comment"
] + list(CASA_INFO_FIELDS)


def normalize_sheet_name(name):
    """Open.normalize_sheet_name: 'C 1s Scan' -> 'C1s', survey/VB names."""
    new_name = name
    lower_name = name.lower()
    if 'survey' in lower_name:
        new_name = 'Survey'
    elif 'wide' in lower_name:
        new_name = 'Wide'
    elif 'su1s' in lower_name or '_su' in lower_name or name.lower().endswith('_su'):
        new_name = 'Survey'
    elif any(term in lower_name for term in ['valence', 'valence band', 'valence scan', 'vb scan', 'vb',
                                             'valence band scan']):
        new_name = 'VB'
    elif any(term in lower_name for term in ['fermi', 'fermi scan']):
        new_name = 'Fermi'
    else:
        match = re.search(r'([A-Z][a-z]?)\s+(\d+[spdf])', name)
        if match:
            element, orbital = match.groups()
            new_name = f"{element}{orbital}"
        match = re.search(r'([A-Z][a-z]?\d+[spdf])', new_name)
        if match and len(new_name) > len(match.group(1)):
            new_name = match.group(1)
    suffix_match = re.search(r'(\d+)$', name)
    if suffix_match and not re.search(r'\d+$', new_name):
        new_name = f"{new_name}{suffix_match.group(1)}"
    return new_name


_SPIN_ORBIT_DIGITS = {'p': '13', 'd': '35', 'f': '57'}


def phi_region_base(name):
    """Open.phi_region_base: 'Fe2p3' (a PHI 2p3/2 window) -> 'Fe2p'; only a
    digit that is a valid j label for that orbital is removed."""
    m = re.match(r'^([A-Z][a-z]?\d[pdf])(\d)$', str(name).strip())
    if m and m.group(2) in _SPIN_ORBIT_DIGITS[m.group(1)[-1]]:
        return m.group(1)
    return name


def normalize_auger_and_valence_names(sheet_name):
    """Open.normalize_auger_and_valence_names: 'Fe LM2' -> 'Felmm', 'V.B.' -> 'VB'."""
    if re.match(r'^V\.?B\.?\s*$', sheet_name.strip(), re.IGNORECASE):
        return "VB"
    match = re.match(r'^([A-Z][a-z]?)\s+([A-Z]+\d*)$', sheet_name.strip())
    if match:
        auger_letters = re.sub(r'\d+', '', match.group(2)).lower()
        if len(auger_letters) >= 2:
            auger_letters += auger_letters[-1]
        return f"{match.group(1)}{auger_letters}"
    return sheet_name


def parse_casa_info_lines(comment_text):
    """Extract Kratos/Casa informational fields from a 'Casa Info Follows' block.

    Returns a dict keyed by the labels in CASA_INFO_FIELDS. Missing fields map to
    empty strings. Lines are matched by keyword anchors (not by position) so the
    parser survives reordering or missing entries.
    """
    result = {k: '' for k in CASA_INFO_FIELDS}
    if not comment_text or 'Casa Info Follows' not in comment_text:
        return result

    tail = comment_text.split('Casa Info Follows', 1)[1]
    # Only scan the first ~15 lines — after that Kratos writes numeric setup data.
    candidate_lines = [ln.strip() for ln in tail.split('\n') if ln.strip()][:15]

    # Sample Name: first non-zero, non-numeric line.
    for ln in candidate_lines:
        try:
            float(ln)
            continue
        except ValueError:
            pass
        if ln.lower().startswith(('xps', 'aes', 'uhv')):
            break
        # Skip lines that are clearly structured (contain ':' or '(')
        if ':' in ln or '(' in ln or '=' in ln or ln.startswith('FoV') or ln.startswith('Aperture') or ln.startswith('Iris'):
            break
        result['Casa Sample Name'] = ln
        break

    for ln in candidate_lines:
        # Stage position + angle line: "(x, y, z)  Angle: N degrees"
        if ln.startswith('(') and 'Angle' in ln:
            paren_end = ln.find(')')
            if paren_end != -1:
                result['Stage Position'] = ln[:paren_end + 1]
            angle_part = ln.split('Angle:', 1)[1].strip() if 'Angle:' in ln else ''
            result['Angle'] = angle_part
        elif ln.startswith('FoV Position'):
            result['FoV Position'] = ln.split('FoV Position', 1)[1].strip()
        elif ln.startswith('Lens Mode'):
            result['Lens Mode'] = ln.split(':', 1)[1].strip() if ':' in ln else ''
        elif ln.startswith('Neutraliser'):
            result['Neutraliser'] = ln.split(':', 1)[1].strip() if ':' in ln else ''
        elif ln.startswith('Charge Balance'):
            # Compound line "A = 1 : B = 2 : C = 3 : D = 4"
            for part in ln.split(':'):
                if '=' not in part:
                    continue
                key, val = part.split('=', 1)
                key, val = key.strip(), val.strip()
                if key in result:
                    result[key] = val
        elif ln.startswith('Aperture Description'):
            result['Aperture'] = ln.split(':', 1)[1].strip() if ':' in ln else ''
        elif ln.startswith('Iris Position Description'):
            result['Iris Position'] = ln.split(':', 1)[1].strip().rstrip('.') if ':' in ln else ''

    return result


def vamas_blocks(path, workfunction=0.0):
    """The sheets open_vamas_file writes: [(name, rows, experimental info)].

    rows[0] is the header [x label, "Corrected Data", "Raw Data", "Transmission"].
    """
    from vamas import Vamas

    vamas_data = Vamas(path)
    names = []
    out = []
    for i, block in enumerate(vamas_data.blocks, start=1):
        if block.num_scans_to_compile_block == 0:
            continue
        if block.species_label.lower() == "wide" or block.transition_or_charge_state_label.lower() == "none":
            raw_sheet_name = block.species_label
        else:
            raw_sheet_name = f"{block.species_label}{block.transition_or_charge_state_label}"
        raw_sheet_name = raw_sheet_name.replace("/", "_")
        raw_sheet_name = normalize_auger_and_valence_names(raw_sheet_name)
        sheet_name = normalize_sheet_name(phi_region_base(raw_sheet_name))
        if sheet_name in names:
            count = 1
            while f"{sheet_name}{count}" in names:
                count += 1
            sheet_name = f"{sheet_name}{count}"
        names.append(sheet_name)

        num_points = block.num_y_values
        x_values = [block.x_start + j * block.x_step for j in range(num_points)]
        y_values = block.corresponding_variables[0].y_values
        y_unit = block.corresponding_variables[0].unit
        num_scans = block.num_scans_to_compile_block
        try:
            collection_time = getattr(block, 'signal_collection_time', None)
            if collection_time is None:
                collection_time = getattr(block, 'dwell_time', None)
            if collection_time is None:
                collection_time = 1.0
        except (AttributeError, TypeError):
            collection_time = 1.0
        if y_unit != "c/s" and collection_time > 0:
            y_values = [y / (num_scans * collection_time) for y in y_values]
        elif y_unit != "c/s":
            y_values = [y / num_scans for y in y_values]
        if block.x_label.lower() in ["kinetic energy", "ke"]:
            photon_energy = block.analysis_source_characteristic_energy
            x_values = [photon_energy - x - workfunction for x in x_values]
            x_label = "Binding Energy"
        else:
            x_label = block.x_label

        # num_y_values counts the ordinates of all corresponding variables:
        # trim to what both axes have
        n_points = min(len(x_values), len(y_values))
        x_values = x_values[:n_points]
        y_values = y_values[:n_points]

        rows = [[x_label, "Corrected Data", "Raw Data", "Transmission"]]
        if len(block.corresponding_variables) > 1:
            raw_t = block.corresponding_variables[1].y_values
            if collection_time > 0:
                transmission = [t / (num_scans * collection_time) for t in raw_t]
            else:
                transmission = [t / num_scans for t in raw_t]
        else:
            t = 1.0 / (num_scans * collection_time) if collection_time > 0 else 1.0 / num_scans
            transmission = [t] * len(y_values)
        for j, (x, y) in enumerate(zip(x_values, y_values)):
            trans = transmission[j] if j < len(transmission) else 1.0
            if collection_time > 0:
                corrected_y = (y / abs(trans)) / (num_scans * collection_time)
            else:
                corrected_y = (y / abs(trans)) / num_scans
            rows.append([x, corrected_y, y, trans])

        sputter_source = getattr(block, 'sputtering_source', None)
        sputter_time_val = ''
        if sputter_source is not None:
            sputter_time_val = getattr(sputter_source, 'mode', '') or ''
        values = [
            block.sample_identifier,
            f"{block.year}/{block.month}/{block.day}",
            f"{block.hour}:{block.minute}:{block.second}",
            block.technique,
            f"{block.species_label} {block.transition_or_charge_state_label}",
            block.num_scans_to_compile_block,
            block.analysis_source_label,
            block.analysis_source_characteristic_energy,
            getattr(block, 'analysis_source_beam_width_x', ''),
            getattr(block, 'analysis_source_beam_width_y', ''),
            block.analyzer_pass_energy_or_retard_ratio_or_mass_res,
            getattr(block, 'analyzer_work_function_or_acceptance_energy', ''),
            block.analyzer_mode,
            block.sputtering_source_energy if hasattr(block, 'sputtering_source_energy') else 'N/A',
            sputter_time_val,
            getattr(block, 'sample_normal_polar_angle_tilt', ''),
            getattr(block, 'analyzer_axis_take_off_polar_angle', ''),
            getattr(block, 'analyzer_axis_take_off_azimuth', ''),
            getattr(block, 'target_bias', ''),
            getattr(block, 'analysis_width_x', ''),
            getattr(block, 'analysis_width_y', ''),
            block.x_label,
            getattr(block, 'x_units', ''),
            block.x_start,
            block.x_step,
            block.num_y_values,
            block.num_scans_to_compile_block,
            block.signal_collection_time,
            getattr(block, 'signal_time_correction', ''),
            y_unit,
            getattr(block, 'num_lines_block_comment', ''),
            block.block_comment,
        ]
        casa_info = parse_casa_info_lines(block.block_comment)
        values.extend(casa_info.get(f, '') for f in CASA_INFO_FIELDS)
        info = dict(zip(VAMAS_EXP_LABELS, values))
        out.append((sheet_name, rows, {k: str(v) for k, v in info.items()}))
    return out


def _two_columns(text):
    """Numeric rows of a two-column text file (',', ';', tab or spaces)."""
    data = []
    header = None
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        parts = [p for p in re.split(r'[,;\t ]+', s) if p]
        if len(parts) < 2:
            continue
        try:
            data.append([float(parts[0]), float(parts[1])])
        except ValueError:
            if not data and header is None:
                header = parts
            continue
    return data, header


def text_sheet(filename, text):
    """import_xps_csv_file / import_raman_txt_file: one core level from a text file."""
    base = os.path.basename(filename).split('.')[0]
    ext = os.path.splitext(filename)[1].lower()
    data, header = _two_columns(text)
    if not data:
        raise ValueError("No valid data found in the file.")
    head_text = ' '.join(header or []).lower()
    raman = ext == '.txt' and ('wavenumber' in head_text or 'cm-1' in head_text or 'raman' in base.lower())
    if raman:
        name = f"Raman_{base}"
        rows = [["Wavenumber (cm-1)", "Raw Data"]] + data
    else:
        name = base
        rows = [["Binding Energy (eV)", "Raw Data"]] + data
    return name[:31], rows


def import_file(filename, raw_bytes, workfunction=0.0, tmp_dir='/tmp'):
    """Data and sheet names for a .vms, .csv or .txt file."""
    data = empty_data()
    ext = os.path.splitext(filename)[1].lower()
    if ext in ('.vms', '.npl'):
        path = os.path.join(tmp_dir, 'kf_import' + ext)
        with open(path, 'wb') as f:
            f.write(raw_bytes)
        try:
            blocks = vamas_blocks(path, workfunction)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    else:
        text = raw_bytes.decode('utf-8', errors='replace')
        name, rows = text_sheet(filename, text)
        blocks = [(name, rows, {})]
    sheets = []
    for name, rows, info in blocks:
        cl = core_level_from_rows(name, rows, info)
        if cl['B.E.']:
            data['Core levels'][name] = cl
            sheets.append(name)
    data['Number of Core levels'] = len(data['Core levels'])
    return data, sheets
