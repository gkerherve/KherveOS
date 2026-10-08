# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/Optical_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/Optical_Import.py
"""
Importers for the optical wavelength techniques: UV-Vis absorption,
photoluminescence and spectroscopic ellipsometry.

Most instrument exports are delimited text (.csv / .txt / .dat / .asc): a
wavelength column followed by one or more value columns, with any amount of
header text above the numbers. The generic parser keeps whatever rows parse
as numbers and ignores the rest, which already covers Shimadzu UVProbe .txt,
PerkinElmer Lambda .asc, JASCO ASCII exports, Ocean Optics/Ocean Insight
.txt (header + '>>>>>Begin Spectral Data<<<<<' marker) and the Horiba
FluoroLog / FluorEssence two-column .dat/.txt files.

Two vendor layouts need real handling on top of that:

- Agilent/Varian **Cary** .csv batches: sample names on line one, a repeated
  'Wavelength (nm),Abs' header on line two, the samples side by side in
  column pairs, and a metadata/audit block after the data. Each pair becomes
  its own sheet, named after the sample, with the ordinate read from the
  header token (Abs / %T / %R).
- **J.A. Woollam** (CompleteEASE/WVASE) ellipsometry ASCII: wavelength (or
  photon energy - converted here), angle of incidence, Ψ, Δ columns, with
  multi-angle measurements stacked in blocks. Each angle becomes its own
  Ellips sheet with the AOI recorded on it.

Sheets follow the KherveFitting name convention that drives the technique
dispatch: UVvis, UVvis1, ... / PL, PL1, ... / Ellips plus its Ellips~Delta
companion. Projects are written straight to .kfit — these spectra carry
absorbances of ~1e-2 and the .xlsx round-trip rounds to two decimals.
"""

import os
import re

import wx

from libraries.FileMenu.KFitting_Import import (
    TECH_UVVIS, TECH_PL, TECH_ELLIPS, build_generic_sheet, _unique_sheet_name)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_columns_file(file_path, max_columns=4):
    """Read a delimited text file into numeric columns.

    Returns ``(rows, metadata)`` where ``rows`` is a list of tuples of floats
    (all the same length — the most common numeric column count in the file)
    and ``metadata`` maps any ``key=value`` / ``key: value`` header lines.
    """
    counted = {}          # n_columns -> list of rows with that many numbers
    metadata = {}
    decimal_comma = None  # decided on the first candidate line

    with open(file_path, 'r', errors='ignore') as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith(('#', '//', ';;')):
                continue

            # Header metadata: key=value or key: value (no leading digit)
            if not line[0].isdigit() and line[0] not in '+-.':
                for sep in ('=', ':'):
                    if sep in line:
                        key, _, value = line.partition(sep)
                        if key.strip():
                            metadata[key.strip()] = value.strip()
                        break
                continue

            # Decide once whether the comma is a decimal symbol: a line like
            # "350,2<tab>0,584" has no dots, digit,digit pairs AND another
            # delimiter between the pairs. When commas are the only separator
            # ("350,1200") they are column separators, decimals or not.
            if decimal_comma is None:
                decimal_comma = ('.' not in line
                                 and re.search(r'\d,\d', line) is not None
                                 and re.search(r'[\t; ]', line) is not None)

            candidate = line.replace(',', '.') if decimal_comma else line
            splitter = r'[\t;\s]+' if decimal_comma else r'[\t;,\s]+'
            tokens = [t for t in re.split(splitter, candidate) if t]

            values = []
            for token in tokens[:max_columns]:
                try:
                    values.append(float(token))
                except ValueError:
                    values = []
                    break
            if len(values) >= 2:
                counted.setdefault(len(values), []).append(tuple(values))

    if not counted:
        return [], metadata
    # Keep the dominant column count so a stray footer line cannot poison the
    # shape of the data.
    n_cols = max(counted, key=lambda n: len(counted[n]))
    return counted[n_cols], metadata


def _cary_y_mode(header_token):
    """Map a Cary column header (Abs, %T, %R...) to a UVVIS_Y_Mode."""
    token = header_token.strip().upper()
    if 'T' in token and '%' in token:
        return 'transmittance'
    if 'R' in token and '%' in token:
        return 'reflectance'
    return 'absorbance'


def parse_cary_csv(file_path):
    """Parse an Agilent/Varian Cary batch .csv.

    Returns a list of {'name', 'rows', 'y_mode'} - one entry per sample pair
    of columns - or None when the file is not in the Cary layout (no repeated
    'Wavelength' header on the second line).
    """
    with open(file_path, 'r', errors='ignore') as fh:
        lines = fh.read().splitlines()
    if len(lines) < 3:
        return None
    header = [t.strip() for t in lines[1].split(',')]
    wl_cols = [i for i, t in enumerate(header)
               if t.lower().startswith(('wavelength', 'nm'))]
    if not wl_cols:
        return None

    names = [t.strip() for t in lines[0].split(',')]
    samples = []
    for col in wl_cols:
        if col + 1 >= len(header):
            continue
        name = names[col] if col < len(names) and names[col] else ''
        samples.append({'name': name, 'col': col,
                        'y_mode': _cary_y_mode(header[col + 1]),
                        'rows': []})
    if not samples:
        return None

    for line in lines[2:]:
        cells = line.split(',')
        got_any = False
        for sample in samples:
            col = sample['col']
            if col + 1 >= len(cells):
                continue
            try:
                x = float(cells[col])
                y = float(cells[col + 1])
            except ValueError:
                continue
            sample['rows'].append((x, y))
            got_any = True
        if not got_any and any(s['rows'] for s in samples):
            break                       # end of the data block: audit trail next
    samples = [s for s in samples if len(s['rows']) >= 3]
    return samples or None


def parse_optical_file(file_path):
    """Parse any supported UV-Vis / PL text export.

    Returns a list of {'name', 'rows', 'y_mode'} - several entries for a Cary
    batch file, one (with name '' and y_mode None, meaning 'infer') for
    everything the generic column parser handles.
    """
    if file_path.lower().endswith('.csv'):
        samples = parse_cary_csv(file_path)
        if samples:
            return [{'name': s['name'], 'rows': s['rows'],
                     'y_mode': s['y_mode']} for s in samples]
    rows, _meta = parse_columns_file(file_path)
    if not rows:
        return []
    return [{'name': '', 'rows': [(r[0], r[1]) for r in rows],
             'y_mode': None}]


EV_NM = 1239.84193


def _looks_like_energy_axis(x_values):
    """A 'wavelength' column that never exceeds 10 is photon energy in eV."""
    return bool(x_values) and 0.1 < max(x_values) < 10.0


def _split_ellips_columns(rows):
    """Blocks of (x, psi, delta, aoi) from parsed ellipsometry rows.

    Two columns is Ψ only; three is λ, Ψ, Δ. Four or more is the Woollam
    layout λ, AOI, Ψ, Δ when the second column is angle-like (20-90° with at
    most eight distinct values) - a multi-angle file yields one block per
    angle - otherwise λ, Ψ, Δ plus ignored extras (depolarisation etc.).
    """
    n_cols = len(rows[0])
    if n_cols == 2:
        return [([r[0] for r in rows], [r[1] for r in rows], None, None)]
    if n_cols >= 4:
        col2 = [r[1] for r in rows]
        distinct = sorted({round(v, 3) for v in col2})
        if 20.0 <= min(col2) and max(col2) <= 90.0 and len(distinct) <= 8:
            blocks = []
            for angle in distinct:
                sub = [r for r in rows if round(r[1], 3) == angle]
                blocks.append(([r[0] for r in sub], [r[2] for r in sub],
                               [r[3] for r in sub], float(angle)))
            return blocks
    return [([r[0] for r in rows], [r[1] for r in rows],
              [r[2] for r in rows], None)]


# ---------------------------------------------------------------------------
# Project building
# ---------------------------------------------------------------------------

def _open_as_kfit_project(window, core_levels, project_path, sample_name):
    """Adopt ``core_levels`` as a fresh project and write/open it as .kfit."""
    from libraries.FileMenu.KFitting_IO import write_kfitting, open_kfitting_file
    from libraries.ConfigFile import Init_Measurement_Data

    window.Data = Init_Measurement_Data(window)
    window.Data['Core levels'] = core_levels
    window.Data['Number of Core levels'] = len(core_levels)
    window.Data['FilePath'] = project_path
    window.Data['SampleNames'] = {0: sample_name}

    write_kfitting(window, project_path)
    open_kfitting_file(window, project_path)


def _project_path_for(file_paths, combined_name):
    if len(file_paths) == 1:
        base = os.path.splitext(os.path.basename(file_paths[0]))[0]
        return os.path.join(os.path.dirname(file_paths[0]), base + '.kfit')
    return os.path.join(os.path.dirname(file_paths[0]), combined_name + '.kfit')


from libraries.FileMenu.KFitting_Import import TECH_UVVIS as _TECH_UVVIS

_UVVIS_MODE_LABELS = {
    'absorbance': 'Absorbance (a.u.)',
    'transmittance': 'Transmittance (%)',
    'reflectance': 'Reflectance (%)',
}


def _import_two_column(window, file_paths, technique, base, combined_name):
    """Shared UV-Vis / PL import: one sheet per spectrum. A Cary batch file
    yields several sheets, everything else one per file."""
    core_levels = {}
    skipped = []
    for file_path in sorted(file_paths):
        try:
            spectra = parse_optical_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue
        if not spectra:
            skipped.append(f"{os.path.basename(file_path)}: no numeric data")
            continue
        for spectrum in spectra:
            rows = sorted(spectrum['rows'], key=lambda r: r[0])
            name = _unique_sheet_name(base, core_levels)
            source = (spectrum['name']
                      or os.path.splitext(os.path.basename(file_path))[0])
            sheet = build_generic_sheet(
                technique, name, [r[0] for r in rows], [r[1] for r in rows],
                source_name=source)
            # A Cary header names the ordinate outright - that beats the
            # magnitude heuristic in build_generic_sheet.
            if technique == _TECH_UVVIS and spectrum.get('y_mode'):
                mode = spectrum['y_mode']
                sheet['UVVIS_Y_Mode'] = mode
                sheet['UVVIS_Y_Label'] = _UVVIS_MODE_LABELS[mode]
            core_levels[name] = sheet

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid data found.\n" + "\n".join(skipped))
        return

    project_path = _project_path_for(sorted(file_paths), combined_name)
    sample = os.path.splitext(os.path.basename(project_path))[0]
    _open_as_kfit_project(window, core_levels, project_path, sample)

    if skipped:
        window.show_popup_message2(
            "Warning", "Some files were skipped:\n" + "\n".join(skipped))


def _import_ellips_paths(window, file_paths):
    """Ellipsometry import: each measured block (one per angle of incidence
    in a Woollam multi-angle file) gives an Ellips sheet (Ψ) and, when it
    carries Δ, an Ellips~Delta companion sheet."""
    core_levels = {}
    skipped = []
    for file_path in sorted(file_paths):
        try:
            rows, _meta = parse_columns_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue
        if not rows:
            skipped.append(f"{os.path.basename(file_path)}: no numeric data")
            continue
        rows.sort(key=lambda r: r[0])
        source = os.path.splitext(os.path.basename(file_path))[0]

        for x, psi, delta, aoi in _split_ellips_columns(rows):
            # Woollam exports can put the abscissa in eV rather than nm.
            if _looks_like_energy_axis(x):
                order = sorted(range(len(x)), key=lambda i: EV_NM / x[i])
                x = [EV_NM / x[i] for i in order]
                psi = [psi[i] for i in order]
                if delta is not None:
                    delta = [delta[i] for i in order]

            name = _unique_sheet_name('Ellips', core_levels)
            label = source if aoi is None else f"{source} @ {aoi:g}°"
            sheet = build_generic_sheet(TECH_ELLIPS, name, x, psi,
                                        source_name=source,
                                        extra_values=delta)
            sheet['ELLIPS_Label'] = label
            if aoi is not None:
                sheet['ELLIPS_AOI_deg'] = float(aoi)
            core_levels[name] = sheet

            if delta is not None:
                # The ~ keeps the Δ sheets in a Sample Manager column of
                # their own.
                suffix = name[len('Ellips'):]
                delta_name = f'Ellips~Delta{suffix}'
                delta_sheet = build_generic_sheet(TECH_ELLIPS, delta_name, x,
                                                  delta, source_name=source)
                delta_sheet.update({
                    'ELLIPS_Y_Label': 'Δ (°)',
                    'ELLIPS_Quantity': 'delta',
                    'ELLIPS_Psi': list(psi),
                    'ELLIPS_Delta': list(delta),
                    'ELLIPS_Label': label,
                })
                if aoi is not None:
                    delta_sheet['ELLIPS_AOI_deg'] = float(aoi)
                core_levels[delta_name] = delta_sheet

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid data found.\n" + "\n".join(skipped))
        return

    project_path = _project_path_for(sorted(file_paths), 'Ellipsometry_Data')
    sample = os.path.splitext(os.path.basename(project_path))[0]
    _open_as_kfit_project(window, core_levels, project_path, sample)

    if skipped:
        window.show_popup_message2(
            "Warning", "Some files were skipped:\n" + "\n".join(skipped))


# ---------------------------------------------------------------------------
# Menu entry points
# ---------------------------------------------------------------------------

_WILDCARD = ("Spectrum files (*.csv;*.txt;*.dat;*.asc)|"
             "*.csv;*.txt;*.dat;*.asc;*.CSV;*.TXT;*.DAT;*.ASC|"
             "All files (*.*)|*.*")


def _ask_files(window, title):
    with wx.FileDialog(window, title, wildcard=_WILDCARD,
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST
                       | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return []
        return dlg.GetPaths()


def import_uvvis_file(window):
    """Import UV-Vis spectra (wavelength + absorbance/transmittance columns).
    Each file becomes a sheet UVvis, UVvis1, ..."""
    paths = _ask_files(window, "Open UV-Vis file(s)")
    if paths:
        try:
            _import_two_column(window, paths, TECH_UVVIS, 'UVvis', 'UVvis_Data')
        except Exception as e:
            import traceback
            traceback.print_exc()
            window.show_popup_message2("Error", f"Error importing UV-Vis: {e}")


def import_pl_file(window):
    """Import photoluminescence spectra (wavelength + intensity columns).
    Each file becomes a sheet PL, PL1, ..."""
    paths = _ask_files(window, "Open photoluminescence file(s)")
    if paths:
        try:
            _import_two_column(window, paths, TECH_PL, 'PL', 'PL_Data')
        except Exception as e:
            import traceback
            traceback.print_exc()
            window.show_popup_message2("Error", f"Error importing PL: {e}")


def import_ellips_file(window):
    """Import spectroscopic-ellipsometry files (wavelength, Ψ, Δ and an
    optional angle-of-incidence column). Each file becomes an Ellips sheet
    plus an Ellips~Delta companion."""
    paths = _ask_files(window, "Open ellipsometry file(s)")
    if paths:
        try:
            _import_ellips_paths(window, paths)
        except Exception as e:
            import traceback
            traceback.print_exc()
            window.show_popup_message2("Error",
                                       f"Error importing ellipsometry: {e}")
