# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/TGA_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/TGA_Import.py
"""
TGA / STA (thermogravimetric analysis) importer.

Most instruments export a CSV whose top block is metadata and whose bottom
block is the measurement table.  A NETZSCH STA 449 "DATA ALL" export looks
like::

    #EXPORTTYPE:                 ,DATA ALL      ,,,,,,
    #SAMPLE MASS /mg:            ,10.225,,,,,,
    #EXO:                        ,1,,,,,,
    ,,,,,,,
    ##Temp./C,Time/min,DSC/(uV/mg),Mass/%,Gas Flow...,Sensit./(uV/mW),Segment
    25.243,0,-3.73E-04,100,50,20,1,1
    ...

Files that carry no metadata at all - a bare ``temperature,mass`` CSV - are
handled by the same parser: the header block is simply empty.

Sheets are named TGA, TGA1, TGA2, ... which follows the KherveFitting row
convention (base name + row index) and triggers the TGA plot mode
(ascending temperature x-axis, mass y-axis, DSC on a right-hand axis).

Like the SQUID importer this one writes ``window.Data`` directly and saves a
``.kfit`` project rather than building an .xlsx: DSC signals are of order
1e-4 uV/mg, which the two-decimal rounding of the .xlsx/.json format would
collapse to zero.
"""

import os
import re
import wx


X_LABEL_TEMPERATURE = "Temperature (°C)"
X_LABEL_TIME = "Time (min)"
Y_LABEL_TEMPERATURE = "Temperature (°C)"
Y_LABEL_MASS_MG = "Mass (mg)"
Y_LABEL_MASS_PCT = "Mass (%)"

# How a TGA sheet is plotted, stored per sheet as 'TGA_View'.
VIEW_TIME = 'time'                 # temperature programme vs time, mass right
VIEW_TEMPERATURE = 'temperature'   # mass vs temperature, DSC right

# Delimiters tried, in order, when the file declares none.
_DELIMITERS = (',', ';', '\t')


# ---------------------------------------------------------------------------
# Column matching
# ---------------------------------------------------------------------------

def _norm(name):
    """Lower-case, strip punctuation - for tolerant column-header matching."""
    return re.sub(r'[^a-z0-9]', '', str(name).lower())


def _find_column(headers, predicate):
    """Index of the first header for which ``predicate(normalised)`` is true."""
    for i, header in enumerate(headers):
        if predicate(_norm(header)):
            return i
    return None


def _mass_unit(header):
    """'%' or 'mg' for a mass column header, or None when it says neither."""
    text = str(header).lower()
    if '%' in text:
        return '%'
    if 'mg' in text:
        return 'mg'
    return None


def identify_columns(headers):
    """Map a column-name row onto the quantities the TGA tool understands.

    Returns a dict with any of the keys ``temperature``, ``time``, ``mass``,
    ``dsc``, ``sensitivity``, ``segment`` -> column index, plus ``mass_unit``.
    """
    found = {
        'temperature': _find_column(headers, lambda h: h.startswith('temp')),
        'time': _find_column(headers, lambda h: h.startswith('time')),
        'dsc': _find_column(headers, lambda h: h.startswith('dsc') or
                            h.startswith('heatflow') or h.startswith('hf')),
        'sensitivity': _find_column(headers, lambda h: h.startswith('sensit')),
        'segment': _find_column(headers, lambda h: h.startswith('segment')),
    }
    # 'tg' matches the NETZSCH 'TG /mg' column; 'mass' and 'weight' cover the
    # TA Instruments and Mettler wordings.
    found['mass'] = _find_column(
        headers, lambda h: h.startswith('mass') or h.startswith('weight') or
        h == 'tg' or h.startswith('tgmg') or h.startswith('tg'))

    found['mass_unit'] = (_mass_unit(headers[found['mass']])
                          if found['mass'] is not None else None)
    return found


# ---------------------------------------------------------------------------
# File splitting
# ---------------------------------------------------------------------------

def _is_numeric_row(tokens):
    """True when the row's first two fields both parse as numbers."""
    numeric = [t for t in tokens[:2] if t.strip()]
    if len(numeric) < 2:
        return False
    try:
        float(numeric[0])
        float(numeric[1])
    except ValueError:
        return False
    return True


def _pick_delimiter(lines):
    """Choose the field separator by looking for the one that yields the most
    columns on a line the file itself declares, then on the data rows."""
    for line in lines:
        if line.upper().startswith('#SEPARATOR'):
            declared = line.split(',', 1)[-1].strip().upper()
            if declared.startswith('COMMA'):
                return ','
            if declared.startswith('SEMICOLON'):
                return ';'
            if declared.startswith('TAB'):
                return '\t'
    counts = {d: max((line.count(d) for line in lines[:200]), default=0)
              for d in _DELIMITERS}
    best = max(counts, key=counts.get)
    return best if counts[best] else ','


def split_metadata_and_table(lines, delimiter):
    """Split a TGA export into ``(metadata, column_names, data_rows)``.

    The table starts at the first row whose first two fields are numbers; the
    column names are the last non-empty row above it.  Everything above that
    is metadata - both ``#KEY:,value`` (NETZSCH) and bare ``key,value`` pairs.
    """
    first_data = None
    for i, line in enumerate(lines):
        if _is_numeric_row(line.split(delimiter)):
            first_data = i
            break

    if first_data is None:
        return {}, [], []

    header_row = None
    for i in range(first_data - 1, -1, -1):
        if lines[i].strip(delimiter + ' \t'):
            header_row = i
            break

    columns = []
    if header_row is not None:
        raw = lines[header_row].lstrip('#')
        columns = [c.strip() for c in raw.split(delimiter)]
        # A header row must not itself be data (bare CSVs start at row 0)
        if _is_numeric_row(columns):
            columns = []
            header_row = None

    metadata = _parse_metadata(
        lines[:header_row if header_row is not None else first_data], delimiter)

    rows = []
    for line in lines[first_data:]:
        tokens = line.split(delimiter)
        if _is_numeric_row(tokens):
            rows.append(tokens)

    return metadata, columns, rows


def _parse_metadata(header_lines, delimiter):
    """Read ``#KEY:,value`` / ``key,value`` pairs out of the header block."""
    metadata = {}
    for line in header_lines:
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(delimiter)]
        key = parts[0].lstrip('#').rstrip(':').strip()
        value = next((p for p in parts[1:] if p), '')
        if key and value:
            metadata[key] = value
    return metadata


def _column(rows, index):
    """Extract one column as a list of floats, with None where unparseable."""
    out = []
    for row in rows:
        if index is None or index >= len(row):
            out.append(None)
            continue
        try:
            out.append(float(row[index].strip()))
        except ValueError:
            out.append(None)
    return out


def _metadata_float(metadata, *keys):
    """First metadata entry among ``keys`` that parses as a number."""
    for key in keys:
        for name, value in metadata.items():
            if _norm(name) == _norm(key):
                try:
                    return float(str(value).replace(',', '.'))
                except ValueError:
                    continue
    return None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _pretty_dsc_label(header):
    """Turn an instrument DSC column name into a plottable axis label.

    'DSC/(uV/mg)' -> 'DSC (µV/mg)'
    """
    text = str(header).strip().replace('uV', 'µV')
    match = re.match(r'^([^/(]+)[/ ]*\(?([^)]*)\)?$', text)
    if match and match.group(2):
        return f"{match.group(1).strip()} ({match.group(2).strip()})"
    return text


def _read_lines(file_path):
    """Read a TGA export as text.

    NETZSCH writes '#FTYPE: ANSI' files whose degree sign is cp1252, so a
    strict UTF-8 read fails on exactly the column header we need ('Temp./°C').
    """
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            with open(file_path, 'r', encoding=encoding) as f:
                return f.read().splitlines()
        except UnicodeDecodeError:
            continue
    with open(file_path, 'r', errors='replace') as f:
        return f.read().splitlines()


def parse_tga_file(file_path):
    """Parse a TGA/STA CSV export.

    Returns a dict with ``temperature``, ``mass_mg``, ``mass_pct``, ``time_min``,
    ``dsc``, ``sensitivity``, ``segment``, ``dsc_unit``, ``sample_mass_mg``,
    ``exo_up``, ``metadata``.  Lists that the file does not provide are None.

    Raises ``ValueError`` when the file holds no usable table.
    """
    lines = _read_lines(file_path)
    delimiter = _pick_delimiter(lines)
    metadata, columns, rows = split_metadata_and_table(lines, delimiter)

    if not rows:
        raise ValueError("no numeric data rows found")

    if columns:
        found = identify_columns(columns)
    else:
        # Bare two-column export: temperature, mass
        found = {'temperature': 0, 'mass': 1, 'time': None, 'dsc': None,
                 'sensitivity': None, 'segment': None, 'mass_unit': None}

    if found['temperature'] is None:
        found['temperature'] = 0
    if found['mass'] is None:
        raise ValueError("no mass / TG column found")

    temperature = _column(rows, found['temperature'])
    mass = _column(rows, found['mass'])
    time_min = _column(rows, found['time']) if found['time'] is not None else None
    dsc = _column(rows, found['dsc']) if found['dsc'] is not None else None
    sensitivity = (_column(rows, found['sensitivity'])
                   if found['sensitivity'] is not None else None)
    segment = _column(rows, found['segment']) if found['segment'] is not None else None

    # Drop rows where either axis is missing, keeping every column in step.
    keep = [i for i, (t, m) in enumerate(zip(temperature, mass))
            if t is not None and m is not None]
    if not keep:
        raise ValueError("no rows with both a temperature and a mass")

    def _select(values):
        if values is None:
            return None
        picked = [values[i] for i in keep]
        return picked if any(v is not None for v in picked) else None

    temperature = [temperature[i] for i in keep]
    mass = [mass[i] for i in keep]
    time_min = _select(time_min)
    dsc = _select(dsc)
    sensitivity = _select(sensitivity)
    segment = _select(segment)

    sample_mass_mg = _metadata_float(metadata, 'SAMPLE MASS /mg', 'Sample mass',
                                     'Sample Mass (mg)', 'Mass', 'Initial mass')

    mass_unit = found.get('mass_unit')
    if mass_unit is None:
        # No unit in the header: a trace that starts near 100 and stays inside
        # 0-110 is a percentage; anything else is read as milligrams.
        mass_unit = '%' if (0 <= min(mass) and max(mass) <= 110 and
                            abs(mass[0] - 100.0) < 5.0) else 'mg'

    # NETZSCH writes '#EXO: 1' when exothermic events point upwards; when the
    # file says nothing, assume that convention (it is the common one).
    exo_flag = _metadata_float(metadata, 'EXO')
    exo_up = True if exo_flag is None else exo_flag != 0

    if mass_unit == '%':
        mass_pct = mass
        mass_mg = ([v * sample_mass_mg / 100.0 for v in mass]
                   if sample_mass_mg else None)
    else:
        mass_mg = mass
        reference = sample_mass_mg or mass[0]
        mass_pct = ([v * 100.0 / reference for v in mass] if reference else None)
        if sample_mass_mg is None:
            sample_mass_mg = mass[0]

    return {
        'temperature': temperature,
        'mass_mg': mass_mg,
        'mass_pct': mass_pct,
        'time_min': time_min,
        'dsc': dsc,
        'sensitivity': sensitivity,
        'segment': segment,
        'dsc_unit': (_pretty_dsc_label(columns[found['dsc']])
                     if found['dsc'] is not None and columns else 'DSC (µV/mg)'),
        'sample_mass_mg': sample_mass_mg,
        'exo_up': exo_up,
        'metadata': metadata,
        'columns': columns,
    }


# ---------------------------------------------------------------------------
# Sheet construction
# ---------------------------------------------------------------------------

def next_tga_sheet_name(existing_names):
    """Return the next free TGA sheet name: TGA, TGA1, TGA2, ..."""
    existing = {str(name).upper() for name in existing_names}
    if 'TGA' not in existing:
        return 'TGA'
    idx = 1
    while f'TGA{idx}' in existing:
        idx += 1
    return f'TGA{idx}'


def next_tga_view_sheet_name(existing_names, suffix):
    """Next free 'TGA~<suffix>' name (TGA~Mass, TGA~Mass1, ...).

    Derived plots are named with a '~' view suffix so each kind gets its own
    Sample Manager column (which splits on '~'), the same convention EIS uses.
    """
    base = f'TGA~{suffix}'
    existing = {str(name).upper() for name in existing_names}
    if base.upper() not in existing:
        return base
    idx = 1
    while f'{base}{idx}'.upper() in existing:
        idx += 1
    return f'{base}{idx}'


def build_tga_sheet(parsed, file_path, sheet_name):
    """Assemble the ``window.Data['Core levels'][sheet]`` entry for one run.

    The imported sheet is the *time* view: the temperature programme plotted
    against time, with the mass on the right-hand axis.  A run holds several
    ramps and dwells and passes the same temperature repeatedly, so a mass-vs-
    temperature plot only means something once one ramp has been picked out -
    which is what the TGA tool does with the range lines on this plot.

    Files with no time column (a bare temperature/mass CSV) go straight to the
    temperature view, since there is nothing to select on.
    """
    time_min = parsed['time_min']
    temperature = [float(v) for v in parsed['temperature']]

    if parsed['mass_mg'] is not None:
        mass = [float(v) for v in parsed['mass_mg']]
        mass_label, mass_unit = Y_LABEL_MASS_MG, 'mg'
    else:
        mass = [float(v) for v in parsed['mass_pct']]
        mass_label, mass_unit = Y_LABEL_MASS_PCT, '%'

    if time_min is not None:
        view = VIEW_TIME
        x_values = [float(v) for v in time_min]
        y_values = temperature
        x_label, y_label, y_unit = X_LABEL_TIME, Y_LABEL_TEMPERATURE, '°C'
    else:
        view = VIEW_TEMPERATURE
        x_values = temperature
        y_values = mass
        x_label, y_label, y_unit = X_LABEL_TEMPERATURE, mass_label, mass_unit

    label = os.path.splitext(os.path.basename(file_path))[0]

    # The selection range lives in the Background entry, which is what the
    # shared vline drag handler writes to. Default to the middle half of the run.
    x_lo, x_hi = min(x_values), max(x_values)
    span = x_hi - x_lo

    sheet = {
        'Name': sheet_name,
        'B.E.': x_values,
        'Raw Data': y_values,
        'TGA_View': view,
        'TGA_X_Label': x_label,
        'TGA_Y_Label': y_label,
        'TGA_Y_Unit': y_unit,
        'TGA_Mass_Label': mass_label,
        'TGA_Mass_Unit': mass_unit,
        'TGA_Normalised': False,
        'TGA_Label': label,
        'TGA_Source': os.path.basename(file_path),
        'TGA_Sample_Mass_mg': parsed['sample_mass_mg'],
        'TGA_DSC_Unit': parsed['dsc_unit'],
        'TGA_Exo_Up': bool(parsed['exo_up']),
        'ExperimentalInfo': _experimental_info(parsed, file_path, len(x_values)),
        'Background': {
            'Bkg Y': list(y_values),
            'Bkg Type': '',
            'Bkg Low': float(x_lo + 0.25 * span),
            'Bkg High': float(x_lo + 0.75 * span),
            'Bkg Offset Low': 0,
            'Bkg Offset High': 0,
        },
    }

    # Every trace is kept, row for row, whichever pair of them is on the axes:
    # the tool slices all of them together when it derives a sheet. Keys are
    # prefixed TGA_ so KFitting_IO stores them losslessly next to B.E./Raw Data
    # (DSC is of order 1e-4 µV/mg).
    for key, values in (('TGA_Temperature', parsed['temperature']),
                        ('TGA_DSC', parsed['dsc']),
                        ('TGA_Time_min', parsed['time_min']),
                        ('TGA_Sensitivity', parsed['sensitivity']),
                        ('TGA_Segment', parsed['segment']),
                        ('TGA_Mass_mg', parsed['mass_mg']),
                        ('TGA_Mass_Pct', parsed['mass_pct'])):
        if values is not None:
            sheet[key] = [float(v) if v is not None else float('nan')
                          for v in values]

    return sheet


def _experimental_info(parsed, file_path, n_points):
    """Human-readable acquisition summary shown in the info panel."""
    metadata = parsed.get('metadata', {})
    temperature = parsed['temperature']
    info = {
        'Technique': 'TGA / STA',
        'Source File': os.path.basename(file_path),
        'Number of Points': str(n_points),
        'Temperature Range (°C)': f"{min(temperature):.1f} - {max(temperature):.1f}",
    }
    if parsed['sample_mass_mg']:
        info['Sample Mass (mg)'] = f"{parsed['sample_mass_mg']:g}"
    if parsed['dsc'] is not None:
        info['DSC Signal'] = parsed['dsc_unit']

    for src, dst in (('INSTRUMENT', 'Instrument'),
                     ('SAMPLE', 'Sample'),
                     ('IDENTITY', 'Identity'),
                     ('MATERIAL', 'Material'),
                     ('DATE/TIME', 'Acquired'),
                     ('OPERATOR', 'Operator'),
                     ('LABORATORY', 'Laboratory'),
                     ('TYPE OF CRUCIBLE', 'Crucible'),
                     ('REFERENCE', 'Reference'),
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

def _import_tga_paths(window, file_paths, project_path):
    """Load the given TGA files into window.Data and save a .kfit project."""
    from libraries.FileMenu.KFitting_IO import write_kfitting, open_kfitting_file
    from libraries.ConfigFile import Init_Measurement_Data

    core_levels = {}
    skipped = []

    for file_path in sorted(file_paths):
        try:
            parsed = parse_tga_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue

        sheet_name = next_tga_sheet_name(core_levels.keys())
        core_levels[sheet_name] = build_tga_sheet(parsed, file_path, sheet_name)

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid TGA data found.\n" + "\n".join(skipped))
        return False

    window.Data = Init_Measurement_Data(window)
    window.Data['Core levels'] = core_levels
    window.Data['Number of Core levels'] = len(core_levels)
    window.Data['FilePath'] = project_path

    # DSC signals are of order 1e-4 µV/mg, far below the two-decimal rounding
    # the .xlsx/.json project format applies, so this always goes to .kfit.
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


def import_tga_file(window):
    """Import one or more TGA/STA CSV exports as sheets TGA, TGA1, TGA2, ..."""
    with wx.FileDialog(window, "Open TGA file(s)",
                       # Both cases are listed because wx wildcards are
                       # case-sensitive on GTK
                       wildcard="TGA files (*.csv;*.txt;*.dat)|"
                                "*.csv;*.CSV;*.txt;*.TXT;*.dat;*.DAT|"
                                "All files (*.*)|*.*",
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = dlg.GetPaths()

    if not file_paths:
        return

    try:
        _import_tga_paths(window, file_paths,
                          _project_path_for(file_paths, "TGA_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing TGA file(s): {str(e)}")


def import_multiple_tga_files(window):
    """Import every TGA export in a folder as TGA, TGA1, TGA2, ..."""
    with wx.DirDialog(window, "Choose a directory containing TGA files",
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
        _import_tga_paths(window, file_paths,
                          os.path.join(dir_path, "TGA_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing TGA files: {str(e)}")
