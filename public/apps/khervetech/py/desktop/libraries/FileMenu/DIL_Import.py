# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/DIL_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/DIL_Import.py
"""
Dilatometry importer (pushrod dilatometer, NETZSCH DIL and compatible).

A NETZSCH DIL 402 export is the same family of file as the STA/TGA CSV the
TGA importer already reads - a ``#KEY:,value`` metadata block above a numeric
table - so the splitting, delimiter and encoding handling are reused from
``TGA_Import``::

    #FORMAT:               ,NETZSCH5
    #MTYPE:                ,DIL
    #SAMPLE LENGTH /mm:    ,13.37
    ##Temp./°C,Time/min,dL/Lo,Segment
    23.99,0.0000e+000,2.4173e-005,1
    ...

Files with no metadata at all - a bare ``temperature,dL/L0`` CSV - are read
by the same parser with an empty header block.

Sheets are named DIL, DIL1, DIL2, ... which triggers the dilatometry plot
mode (forward temperature axis, dL/L0 ordinate, per-sheet axis labels).
Projects always go to .kfit: dL/L0 is of order 1e-5, far below the
two-decimal rounding of the .xlsx/.json format.
"""

import os
import wx

# The NETZSCH CSV plumbing is shared with the TGA importer: same metadata
# block, same declared separator/decimal, same cp1252 '°C' header trap.
from libraries.FileMenu.TGA_Import import (
    _read_lines, _pick_delimiter, split_metadata_and_table, _column,
    _metadata_float, _norm, _find_column)


X_LABEL_TEMPERATURE = "Temperature (°C)"
Y_LABEL_STRAIN = "dL/L$_0$"
Y_LABEL_MICRON = "dL (µm)"


# ---------------------------------------------------------------------------
# Column matching
# ---------------------------------------------------------------------------

def identify_columns(headers):
    """Map a column-name row onto the quantities the dilatometry tool reads.

    Returns a dict with ``temperature``, ``time``, ``length``, ``segment``
    -> column index (or None), plus ``length_unit`` in {'rel', 'um', 'mm',
    'percent', None}.
    """
    found = {
        'temperature': _find_column(headers, lambda h: h.startswith('temp')),
        'time': _find_column(headers, lambda h: h.startswith('time')),
        'segment': _find_column(headers, lambda h: h.startswith('segment')),
    }
    # 'dL/Lo' normalises to 'dllo'; 'dL /µm' to 'dlm'; TA and Linseis exports
    # write 'Delta L', 'Dimension Change' or 'Strain'.
    found['length'] = _find_column(
        headers, lambda h: h.startswith(('dllo', 'dll0', 'dl', 'deltal',
                                         'dimensionchange', 'strain',
                                         'shrinkage', 'expansion')))

    unit = None
    if found['length'] is not None:
        text = str(headers[found['length']]).lower()
        if 'lo' in text.replace(' ', '') or 'l0' in text.replace(' ', '') \
                or 'strain' in text:
            unit = 'rel'
        elif '%' in text:
            unit = 'percent'
        elif 'µm' in text or 'um' in text or 'micro' in text:
            unit = 'um'
        elif 'mm' in text:
            unit = 'mm'
    found['length_unit'] = unit
    return found


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_dil_file(file_path):
    """Parse a dilatometer CSV/TXT/DAT export.

    Returns a dict with ``temperature``, ``strain`` (dL/L0, when it can be
    formed), ``dl_um``, ``time_min``, ``segment``, ``sample_length_mm``,
    ``metadata``, ``columns``. Raises ``ValueError`` when no usable table is
    found.
    """
    lines = _read_lines(file_path)
    delimiter = _pick_delimiter(lines)
    metadata, columns, rows = split_metadata_and_table(lines, delimiter)

    if not rows:
        raise ValueError("no numeric data rows found")

    if columns:
        found = identify_columns(columns)
    else:
        # Bare two-column export: temperature, dL/L0
        found = {'temperature': 0, 'length': 1, 'time': None,
                 'segment': None, 'length_unit': None}

    if found['temperature'] is None:
        found['temperature'] = 0
    if found['length'] is None:
        raise ValueError("no dL/L0 / dL / strain column found")

    temperature = _column(rows, found['temperature'])
    length = _column(rows, found['length'])
    time_min = _column(rows, found['time']) if found['time'] is not None else None
    segment = _column(rows, found['segment']) if found['segment'] is not None else None

    keep = [i for i, (t, v) in enumerate(zip(temperature, length))
            if t is not None and v is not None]
    if not keep:
        raise ValueError("no rows with both a temperature and a length change")

    def _select(values):
        if values is None:
            return None
        picked = [values[i] for i in keep]
        return picked if any(v is not None for v in picked) else None

    temperature = [temperature[i] for i in keep]
    length = [length[i] for i in keep]
    time_min = _select(time_min)
    segment = _select(segment)

    sample_length_mm = _metadata_float(
        metadata, 'SAMPLE LENGTH /mm', 'Sample length', 'Sample Length (mm)',
        'L0', 'Lo', 'Initial length')

    unit = found['length_unit']
    if unit is None:
        # No unit in the header: dL/L0 stays within a few percent of zero,
        # while a micron trace runs to tens or hundreds.
        unit = 'rel' if max(abs(v) for v in length) < 0.5 else 'um'

    strain = None
    dl_um = None
    if unit == 'rel':
        strain = length
    elif unit == 'percent':
        strain = [v / 100.0 for v in length]
    elif unit == 'um':
        dl_um = length
        if sample_length_mm:
            strain = [v / (sample_length_mm * 1000.0) for v in length]
    elif unit == 'mm':
        dl_um = [v * 1000.0 for v in length]
        if sample_length_mm:
            strain = [v / sample_length_mm for v in length]

    return {
        'temperature': temperature,
        'strain': strain,
        'dl_um': dl_um,
        'time_min': time_min,
        'segment': segment,
        'sample_length_mm': sample_length_mm,
        'metadata': metadata,
        'columns': columns,
    }


# ---------------------------------------------------------------------------
# Sheet construction
# ---------------------------------------------------------------------------

def next_dil_sheet_name(existing_names):
    """Return the next free DIL sheet name: DIL, DIL1, DIL2, ..."""
    existing = {str(name).upper() for name in existing_names}
    if 'DIL' not in existing:
        return 'DIL'
    idx = 1
    while f'DIL{idx}' in existing:
        idx += 1
    return f'DIL{idx}'


def build_dil_sheet(parsed, file_path, sheet_name):
    """Assemble the ``window.Data['Core levels'][sheet]`` entry for one run.

    The sheet is plotted as dL/L0 against temperature. A run that heats and
    cools passes the same temperature twice and draws the classic expansion /
    hysteresis loop; nothing is ever sorted by temperature, and the analysis
    tool isolates single ramps through the segment column (or by detecting
    the reversals itself).
    """
    temperature = [float(v) for v in parsed['temperature']]

    if parsed['strain'] is not None:
        y_values = [float(v) for v in parsed['strain']]
        y_label, y_unit = Y_LABEL_STRAIN, 'rel'
    else:
        y_values = [float(v) for v in parsed['dl_um']]
        y_label, y_unit = Y_LABEL_MICRON, 'um'

    label = os.path.splitext(os.path.basename(file_path))[0]

    sheet = {
        'Name': sheet_name,
        'B.E.': temperature,
        'Raw Data': y_values,
        'Fitting': {'Peaks': {}},
        'DIL_X_Label': X_LABEL_TEMPERATURE,
        'DIL_Y_Label': y_label,
        'DIL_Y_Unit': y_unit,
        'DIL_Label': label,
        'DIL_Source': os.path.basename(file_path),
        'DIL_Sample_Length_mm': parsed['sample_length_mm'],
        'ExperimentalInfo': _experimental_info(parsed, file_path,
                                               len(temperature)),
        'Background': {
            'Bkg Y': list(y_values),
            'Bkg Type': '',
            'Bkg Low': float(min(temperature)),
            'Bkg High': float(max(temperature)),
            'Bkg Offset Low': 0,
            'Bkg Offset High': 0,
        },
    }

    # Every trace is kept row for row so the tool can slice them together.
    # DIL_-prefixed keys are stored losslessly by KFitting_IO (dL/L0 is of
    # order 1e-5).
    for key, values in (('DIL_Temperature', parsed['temperature']),
                        ('DIL_Strain', parsed['strain']),
                        ('DIL_dL_um', parsed['dl_um']),
                        ('DIL_Time_min', parsed['time_min']),
                        ('DIL_Segment', parsed['segment'])):
        if values is not None:
            sheet[key] = [float(v) if v is not None else float('nan')
                          for v in values]

    return sheet


def _experimental_info(parsed, file_path, n_points):
    """Human-readable acquisition summary shown in the info panel."""
    metadata = parsed.get('metadata', {})
    temperature = parsed['temperature']
    info = {
        'Technique': 'Dilatometry',
        'Source File': os.path.basename(file_path),
        'Number of Points': str(n_points),
        'Temperature Range (°C)': f"{min(temperature):.1f} - {max(temperature):.1f}",
    }
    if parsed['sample_length_mm']:
        info['Sample Length (mm)'] = f"{parsed['sample_length_mm']:g}"

    for src, dst in (('INSTRUMENT', 'Instrument'),
                     ('SAMPLE', 'Sample'),
                     ('IDENTITY', 'Identity'),
                     ('MATERIAL', 'Material'),
                     ('MEASMODE', 'Measurement Mode'),
                     ('DATE/TIME', 'Acquired'),
                     ('OPERATOR', 'Operator'),
                     ('LABORATORY', 'Laboratory'),
                     ('GAS 1', 'Gas'),
                     ('RANGE', 'Programme'),
                     ('CORR. FILE', 'Correction File')):
        for name, value in metadata.items():
            if _norm(name) == _norm(src) and value:
                info[dst] = value
                break
    return info


# ---------------------------------------------------------------------------
# Import entry points
# ---------------------------------------------------------------------------

def _import_dil_paths(window, file_paths, project_path):
    """Load the given dilatometer files into window.Data and save a .kfit."""
    from libraries.FileMenu.KFitting_IO import write_kfitting, open_kfitting_file
    from libraries.ConfigFile import Init_Measurement_Data

    core_levels = {}
    skipped = []

    for file_path in sorted(file_paths):
        try:
            parsed = parse_dil_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue

        sheet_name = next_dil_sheet_name(core_levels.keys())
        core_levels[sheet_name] = build_dil_sheet(parsed, file_path, sheet_name)

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid dilatometry data found.\n" + "\n".join(skipped))
        return False

    window.Data = Init_Measurement_Data(window)
    window.Data['Core levels'] = core_levels
    window.Data['Number of Core levels'] = len(core_levels)
    window.Data['FilePath'] = project_path

    # dL/L0 is of order 1e-5, far below the two-decimal rounding the
    # .xlsx/.json project format applies, so this always goes to .kfit.
    write_kfitting(window, project_path)
    open_kfitting_file(window, project_path)

    if skipped:
        window.show_popup_message2("Warning",
                                   "Some files were skipped:\n" + "\n".join(skipped))
    return True


def _project_path_for(file_paths, combined_name):
    """Where to put the .kfit project for this selection."""
    directory = os.path.dirname(file_paths[0])
    if len(file_paths) == 1:
        base = os.path.splitext(os.path.basename(file_paths[0]))[0]
        return os.path.join(directory, f"{base}.kfit")
    return os.path.join(directory, combined_name)


def import_dil_file(window):
    """Import one or more dilatometer exports as sheets DIL, DIL1, DIL2, ..."""
    with wx.FileDialog(window, "Open dilatometry file(s)",
                       # Both cases are listed because wx wildcards are
                       # case-sensitive on GTK
                       wildcard="Dilatometry files (*.csv;*.txt;*.dat)|"
                                "*.csv;*.CSV;*.txt;*.TXT;*.dat;*.DAT|"
                                "All files (*.*)|*.*",
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = dlg.GetPaths()

    if not file_paths:
        return

    try:
        _import_dil_paths(window, file_paths,
                          _project_path_for(file_paths, "DIL_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2(
            "Error", f"Error processing dilatometry file(s): {str(e)}")


def import_multiple_dil_files(window):
    """Import every dilatometer export in a folder as DIL, DIL1, DIL2, ..."""
    with wx.DirDialog(window, "Choose a directory containing dilatometry files",
                      style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        dir_path = dlg.GetPath()

    try:
        found = sorted(f for f in os.listdir(dir_path)
                       if f.lower().endswith(('.csv', '.txt', '.dat')))
        if not found:
            window.show_popup_message2(
                "Information", "No .csv/.txt/.dat files found in the selected folder.")
            return

        file_paths = [os.path.join(dir_path, f) for f in found]
        _import_dil_paths(window, file_paths,
                          os.path.join(dir_path, "DIL_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2(
            "Error", f"Error processing dilatometry files: {str(e)}")
