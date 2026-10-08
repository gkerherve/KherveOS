# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/JCAMP_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/JCAMP_Import.py
"""
JCAMP-DX infrared spectrum support.

- parse_jcamp(): reads .jdx/.dx files (the universal FTIR exchange format used
  by NIST WebBook, SDBS, instrument software, ...). Supports the tabular
  ##XYDATA=(X++(Y..Y)) form in plain AFFN as well as ASDF-compressed data
  (SQZ / DIF / DUP pseudo-digits), plus ##XYPOINTS / ##PEAK TABLE pairs.
- import_jcamp_file(): File > Import menu action -> sheets FTIR, FTIR1, ...
- nist_search_cas() / nist_fetch_ir() / nist_fetch_ms(): look up a compound on the NIST
  Chemistry WebBook by name or CAS number and download its IR spectrum.
  NIST data is fetched at the user's request for their own use only - it is
  never bundled with KherveFitting.
- add_ftir_reference_to_project(): append a reference spectrum as a new
  FTIRn sheet of the currently open project so it can be overlaid on
  measured data.
"""

import os
import re

import numpy as np

from libraries.FileMenu.FTIR_Import import (_next_ftir_sheet_name,
                                            _write_ftir_sheet,
                                            Y_UNIT_TRANSMITTANCE,
                                            Y_UNIT_ABSORBANCE)

# ---------------------------------------------------------------------------
# ASDF pseudo-digit tables (JCAMP-DX 4.24)
# ---------------------------------------------------------------------------
_SQZ = {'@': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7,
        'H': 8, 'I': 9,
        'a': -1, 'b': -2, 'c': -3, 'd': -4, 'e': -5, 'f': -6, 'g': -7,
        'h': -8, 'i': -9}
_DIF = {'%': 0, 'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'O': 6, 'P': 7,
        'Q': 8, 'R': 9,
        'j': -1, 'k': -2, 'l': -3, 'm': -4, 'n': -5, 'o': -6, 'p': -7,
        'q': -8, 'r': -9}
_DUP = {'S': 1, 'T': 2, 'U': 3, 'V': 4, 'W': 5, 'X': 6, 'Y': 7, 'Z': 8,
        's': 9}

_TOKEN_START = set(_SQZ) | set(_DIF) | set(_DUP)


def _tokenize_asdf(line):
    """Split one ASDF/AFFN data line into number tokens. A new token starts at
    whitespace/comma, at a +/- sign, or at any SQZ/DIF/DUP pseudo-digit."""
    tokens = []
    current = ""
    for ch in line:
        if ch in ' \t,;':
            if current:
                tokens.append(current)
                current = ""
        elif ch in '+-' or ch in _TOKEN_START:
            if current:
                tokens.append(current)
            current = ch
        else:  # digit, '.', 'E' exponent etc.
            current += ch
    if current:
        tokens.append(current)
    return tokens


def _decode_token_number(first_digit, rest):
    """Build the integer value from a pseudo-digit start plus trailing digits."""
    digits = str(abs(first_digit)) + rest
    value = int(digits) if digits else 0
    return -value if first_digit < 0 else value


def _decode_xydata_lines(lines):
    """Decode ##XYDATA=(X++(Y..Y)) lines (AFFN or ASDF-compressed).

    Returns (x_starts, y_rows, dif_row_flags) where each y_rows[i] is the list
    of ordinates for that line and dif_row_flags[i] says whether the line's
    values continue a DIF sequence (first value = check value)."""
    all_y = []
    x_starts = []
    row_starts_in_dif = []

    prev_line_ended_in_dif = False
    last_y = None

    for line in lines:
        tokens = _tokenize_asdf(line)
        if not tokens:
            continue
        try:
            x_start = float(tokens[0])
        except ValueError:
            continue

        row_y = []
        in_dif = False
        last_diff = 0
        first_value_of_line = True

        for tok in tokens[1:]:
            c = tok[0]
            if c in _DUP:
                count = _decode_token_number(_DUP[c], tok[1:])
                # Repeat the previous action (count - 1) more times
                for _ in range(max(0, count - 1)):
                    if in_dif:
                        last_y = last_y + last_diff
                    row_y.append(last_y)
            elif c in _DIF:
                last_diff = _decode_token_number(_DIF[c], tok[1:])
                last_y = (last_y if last_y is not None else 0) + last_diff
                row_y.append(last_y)
                in_dif = True
            elif c in _SQZ:
                last_y = _decode_token_number(_SQZ[c], tok[1:])
                row_y.append(last_y)
                in_dif = False
            else:
                try:
                    last_y = float(tok)
                except ValueError:
                    continue
                row_y.append(last_y)
                in_dif = False

            if first_value_of_line:
                first_value_of_line = False

        x_starts.append(x_start)
        all_y.append(row_y)
        row_starts_in_dif.append(prev_line_ended_in_dif)
        prev_line_ended_in_dif = in_dif

    return x_starts, all_y, row_starts_in_dif


def parse_jcamp(file_path):
    """Parse a JCAMP-DX infrared file.

    Returns dict with keys: x (np.array, cm-1, ascending), y (np.array),
    y_unit ('Transmittance (%)' or 'Absorbance'), title, cas, state, origin,
    molform. Raises ValueError on unusable files."""
    headers = {}
    data_lines = []
    data_mode = None  # 'XYDATA' | 'XYPOINTS'

    with open(file_path, 'r', errors='ignore') as f:
        for raw in f:
            line = raw.rstrip('\n').rstrip('\r')
            # strip inline comments  $$ ...
            if '$$' in line:
                line = line.split('$$')[0]
            if not line.strip():
                continue
            if line.startswith('##'):
                key, _, value = line[2:].partition('=')
                key = key.strip().upper().replace(' ', '')
                value = value.strip()
                if key == 'XYDATA':
                    data_mode = 'XYDATA'
                    data_lines = []
                elif key in ('XYPOINTS', 'PEAKTABLE'):
                    data_mode = 'XYPOINTS'
                    data_lines = []
                elif key == 'END':
                    break
                else:
                    headers[key] = value
            elif data_mode:
                data_lines.append(line)

    if not data_lines:
        raise ValueError("No spectral data table found (##XYDATA / ##XYPOINTS)")

    x_factor = float(headers.get('XFACTOR', 1.0) or 1.0)
    y_factor = float(headers.get('YFACTOR', 1.0) or 1.0)

    if data_mode == 'XYPOINTS':
        xs, ys = [], []
        for line in data_lines:
            numbers = re.findall(r'[+-]?\d+\.?\d*(?:[eE][+-]?\d+)?', line)
            for i in range(0, len(numbers) - 1, 2):
                xs.append(float(numbers[i]))
                ys.append(float(numbers[i + 1]))
        x = np.array(xs) * x_factor
        y = np.array(ys) * y_factor
    else:
        x_starts, y_rows, dif_flags = _decode_xydata_lines(data_lines)
        n_expected = None
        try:
            n_expected = int(headers.get('NPOINTS', ''))
        except ValueError:
            pass

        # Collect ordinates, dropping the X-sequence check value that starts
        # every line which continues a DIF sequence
        ys = []
        kept_rows = []
        for i, row in enumerate(y_rows):
            if dif_flags[i] and row:
                row = row[1:]
            kept_rows.append(row)
            ys.extend(row)

        y = np.array(ys, dtype=float) * y_factor

        # Abscissae: prefer the exact FIRSTX/LASTX grid (immune to the
        # ambiguity of what a DIF line's X value refers to); fall back to
        # per-line reconstruction from the line X values.
        first_x = headers.get('FIRSTX', '')
        last_x = headers.get('LASTX', '')
        if first_x and last_x and n_expected and len(y) == n_expected and n_expected > 1:
            x = np.linspace(float(first_x), float(last_x), n_expected)
        else:
            try:
                delta_x = float(headers.get('DELTAX', ''))
            except ValueError:
                delta_x = None
            xs = []
            for i, row in enumerate(kept_rows):
                if not row:
                    continue
                x0 = x_starts[i] * x_factor
                if dif_flags[i]:
                    # Line X belongs to the check value (previous line's last point)
                    if delta_x is not None:
                        x0 += delta_x
                if delta_x is None:
                    if i + 1 < len(x_starts):
                        delta_here = (x_starts[i + 1] - x_starts[i]) * x_factor / len(y_rows[i])
                    else:
                        delta_here = xs[-1] - xs[-2] if len(xs) >= 2 else 0
                else:
                    delta_here = delta_x
                for j in range(len(row)):
                    xs.append(x0 + j * delta_here)
            x = np.array(xs, dtype=float)

        if n_expected and abs(len(y) - n_expected) > max(2, 0.01 * n_expected):
            print(f"JCAMP warning: decoded {len(y)} points, header says {n_expected}")

    if len(x) < 2:
        raise ValueError("Fewer than 2 data points decoded")

    # --- X units -> cm-1 ---
    x_units = headers.get('XUNITS', '1/CM').upper()
    if 'MICROMETER' in x_units or 'MICRON' in x_units:
        with np.errstate(divide='ignore'):
            x = 10000.0 / x
    # NANOMETERS occasionally appears for NIR
    elif 'NANOMETER' in x_units:
        with np.errstate(divide='ignore'):
            x = 1.0e7 / x

    # --- Y units ---
    y_units = headers.get('YUNITS', '').upper()
    if 'ABSORBANCE' in y_units:
        y_unit = Y_UNIT_ABSORBANCE
    else:
        y_unit = Y_UNIT_TRANSMITTANCE
        if 'TRANSMITTANCE' in y_units and np.nanmax(y) <= 1.5:
            y = y * 100.0  # fractional transmittance -> %

    # Sort ascending in wavenumber and drop non-finite points
    good = np.isfinite(x) & np.isfinite(y)
    x, y = x[good], y[good]
    order = np.argsort(x)
    x, y = x[order], y[order]

    return {
        'x': x,
        'y': y,
        'y_unit': y_unit,
        'title': headers.get('TITLE', os.path.splitext(os.path.basename(file_path))[0]),
        'cas': headers.get('CASREGISTRYNO', ''),
        'state': headers.get('STATE', ''),
        'origin': headers.get('ORIGIN', ''),
        'molform': headers.get('MOLFORM', ''),
    }


# ---------------------------------------------------------------------------
# JCAMP-DX writer (compact AFFN XYDATA on a uniform grid)
# ---------------------------------------------------------------------------
def write_jcamp(path, x, y, title, y_unit=Y_UNIT_ABSORBANCE, origin="",
                cas="", extra=None):
    """Write a spectrum as a compact JCAMP-DX 4.24 file.

    ``x`` must be a (near) uniform ascending wavenumber grid in cm-1. Ordinates
    are stored as integers scaled by ##YFACTOR so files stay small while
    keeping ~5 significant figures; :func:`parse_jcamp` reads them straight
    back via the FIRSTX/LASTX/NPOINTS grid. ``extra`` is an optional dict of
    extra ##HEADER=value lines.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = int(x.size)
    if n < 2 or y.size != n:
        raise ValueError("write_jcamp needs matching x/y of length >= 2")

    x0, x1 = float(x[0]), float(x[-1])
    delta = (x1 - x0) / (n - 1)
    maxabs = float(np.nanmax(np.abs(y))) or 1.0
    yfactor = maxabs / 99999.0          # keep integers to ~5 digits
    yint = np.rint(y / yfactor).astype(np.int64)

    is_abs = str(y_unit).lower().startswith('abs')
    lines = [
        f"##TITLE={title}",
        "##JCAMP-DX=4.24",
        "##DATA TYPE=INFRARED SPECTRUM",
        f"##ORIGIN={origin}",
        "##OWNER=public domain",
    ]
    if cas:
        lines.append(f"##CAS REGISTRY NO={cas}")
    for k, v in (extra or {}).items():
        lines.append(f"##{k}={v}")
    lines += [
        "##XUNITS=1/CM",
        f"##YUNITS={'ABSORBANCE' if is_abs else 'TRANSMITTANCE'}",
        "##XFACTOR=1.0",
        f"##YFACTOR={yfactor:.8g}",
        f"##FIRSTX={x0:.6g}",
        f"##LASTX={x1:.6g}",
        f"##DELTAX={delta:.6g}",
        f"##NPOINTS={n}",
        f"##FIRSTY={y[0]:.6g}",
        "##XYDATA=(X++(Y..Y))",
    ]

    per_line = 10
    out = []
    for i in range(0, n, per_line):
        xi = x0 + i * delta
        row = " ".join(str(int(v)) for v in yint[i:i + per_line])
        out.append(f"{xi:.6g} {row}")
    lines.extend(out)
    lines.append("##END=")

    with open(path, 'w', encoding='ascii', errors='replace') as f:
        f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# Online (GitHub) reference library
# ---------------------------------------------------------------------------
def fetch_online_index(base_url=None, use_cache_on_error=True):
    """Download the online reference-library ``index.json``.

    Returns a list of spectrum dicts (keys include 'name', 'library', 'file').
    On a network error the last cached copy is returned if available (unless
    ``use_cache_on_error`` is False). Raises RuntimeError if neither works.
    """
    import json
    import requests
    from libraries.ConfigFile import (get_ftir_online_base,
                                      get_ftir_online_cache_path)

    base = (base_url or get_ftir_online_base())
    if not base.endswith('/'):
        base += '/'
    cache = get_ftir_online_cache_path()
    try:
        resp = requests.get(base + 'index.json', headers=_UA, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        spectra = data.get('spectra', data) if isinstance(data, dict) else data
        try:
            with open(cache, 'w', encoding='utf-8') as f:
                json.dump({'base': base, 'spectra': spectra}, f)
        except OSError:
            pass
        return spectra
    except Exception as e:
        if use_cache_on_error and os.path.exists(cache):
            try:
                with open(cache, 'r', encoding='utf-8') as f:
                    cached = json.load(f)
                if cached.get('base') == base:
                    return cached.get('spectra', [])
            except (OSError, ValueError):
                pass
        raise RuntimeError(f"Could not fetch the online library index: {e}")


def fetch_online_spectrum(rel_file, base_url=None):
    """Download and parse one spectrum (its manifest 'file' path) from the
    online library. Returns the parse_jcamp() dict."""
    import tempfile
    import requests
    from libraries.ConfigFile import get_ftir_online_base

    base = (base_url or get_ftir_online_base())
    if not base.endswith('/'):
        base += '/'
    url = base + rel_file.lstrip('/')
    resp = requests.get(url, headers=_UA, timeout=30)
    resp.raise_for_status()

    with tempfile.NamedTemporaryFile(suffix='.jdx', delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = tmp.name
    try:
        return parse_jcamp(tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# NIST Chemistry WebBook lookup
# ---------------------------------------------------------------------------
_NIST_BASE = "https://webbook.nist.gov"
_UA = {'User-Agent': 'KherveFitting (FTIR reference lookup)'}
_CAS_RE = re.compile(r'^\d{2,7}-\d{2}-\d$')


def nist_search_cas(query, spectrum='IR'):
    """Resolve a compound name or CAS number to a NIST WebBook species ID
    ('C64175' style). Returns (species_id, display_name) or (None, message).

    ``spectrum`` ('IR' or 'MS') restricts the name search to species that
    actually carry that kind of spectrum, so a compound with no mass spectrum
    is reported as a miss rather than resolving to an ID that then 404s.
    """
    import requests

    query = query.strip()
    if _CAS_RE.match(query):
        return 'C' + query.replace('-', ''), query

    url = f"{_NIST_BASE}/cgi/cbook.cgi"
    flag = 'cMS' if str(spectrum).upper() in ('MS', 'MASS') else 'cIR'
    try:
        # cIR/cMS=on restricts the search to species that have that data
        resp = requests.get(url, params={'Name': query, 'Units': 'SI', flag: 'on'},
                            headers=_UA, timeout=30)
    except Exception as e:
        return None, f"Network error: {e}"

    if resp.status_code != 200:
        return None, f"NIST returned HTTP {resp.status_code}"

    text = resp.text

    title_match = re.search(r'<title>(.*?)</title>', text, re.IGNORECASE | re.DOTALL)
    page_title = title_match.group(1).strip() if title_match else query

    candidates = re.findall(r'cbook\.cgi\?ID=(C\d+)[^"\']*["\']>([^<]+)<', text)
    if candidates:
        # Disambiguation list: prefer the link whose text equals the query
        for cid, cname in candidates:
            if cname.strip().lower() == query.lower():
                return cid, cname.strip()
        # Species page served directly: its own ID appears in many section
        # links (thermochemistry, spectra, ...), while cross-references to
        # isotopologues appear once - take the most frequent ID.
        counts = {}
        for cid, _ in candidates:
            counts[cid] = counts.get(cid, 0) + 1
        best = max(counts, key=counts.get)
        if counts[best] > 1:
            return best, page_title
        return candidates[0][0], candidates[0][1].strip()

    match = re.search(r'cbook\.cgi\?ID=(C\d+)', text)
    if match:
        return match.group(1), page_title
    return None, f"No NIST WebBook match for '{query}'"


def nist_fetch_jcamp(species_id, spec_type='IR', index=0):
    """Download one spectrum (JCAMP-DX bytes) for a NIST species ID.

    ``spec_type`` is the WebBook's own name for the data: 'IR', 'Mass',
    'UVVis'. Returns bytes, or None if that spectrum index doesn't exist.
    """
    import requests

    url = f"{_NIST_BASE}/cgi/cbook.cgi"
    try:
        resp = requests.get(url, params={'JCAMP': species_id,
                                         'Type': spec_type, 'Index': index},
                            headers=_UA, timeout=30)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    data = resp.content
    # A valid JCAMP file starts with ##TITLE; anything else is an HTML error page
    if not data.lstrip()[:2] == b'##':
        return None
    return data


def nist_fetch_ir(species_id, index=0):
    """Download the IR spectrum (JCAMP-DX bytes) for a NIST species ID."""
    return nist_fetch_jcamp(species_id, 'IR', index)


def nist_fetch_ms(species_id, index=0):
    """Download the EI mass spectrum (JCAMP-DX bytes) for a NIST species ID.

    The WebBook serves 70 eV electron-ionisation spectra from the NIST/EPA/NIH
    library as a ``##PEAK TABLE`` of m/z, relative-intensity pairs.
    """
    return nist_fetch_jcamp(species_id, 'Mass', index)


# ---------------------------------------------------------------------------
# Project integration
# ---------------------------------------------------------------------------

def add_ftir_reference_to_project(window, x, y, title, y_unit, source=""):
    """Append a reference spectrum as a new FTIRn sheet of the open project
    (memory + Excel file) and show it. Returns the sheet name or None."""
    import openpyxl
    from libraries.FileMenu.Save import save_state

    file_path = window.Data.get('FilePath')
    if not file_path or not os.path.exists(file_path):
        window.show_popup_message2(
            "No project open",
            "Open or import a project first - the reference spectrum is added "
            "as a new FTIR sheet of the current file.")
        return None

    save_state(window)
    core_levels = window.Data.setdefault('Core levels', {})
    sheet_name = _next_ftir_sheet_name(core_levels.keys())

    x_list = [float(v) for v in x]
    y_list = [float(v) for v in y]

    core_levels[sheet_name] = {
        'Name': sheet_name,
        'B.E.': x_list,
        'Raw Data': y_list,
        'FTIR_Y_Unit': y_unit,
        'FTIR_Input_Unit': y_unit,
        # The pristine spectrum, so the FTIR tool's non-destructive pipeline
        # can always recompute from it
        'FTIR_Raw': {'x': x_list.copy(), 'y': y_list.copy(), 'unit': y_unit},
        'FTIR_Reference': title if not source else f"{title} [{source}]",
        'Background': {
            'Bkg Type': '',
            'Bkg Low': '',
            'Bkg High': '',
            'Bkg Offset Low': '',
            'Bkg Offset High': '',
            'Bkg Y': y_list.copy(),
        },
    }
    if 'Number of Core levels' in window.Data:
        window.Data['Number of Core levels'] += 1

    # Persist: Excel sheet only for .xlsx projects, then the native project
    # store (.kfit archive, or the sibling .json) via persist_project.
    try:
        if file_path.lower().endswith('.xlsx'):
            wb = openpyxl.load_workbook(file_path)
            if sheet_name in wb.sheetnames:
                wb.remove(wb[sheet_name])
            _write_ftir_sheet(wb, sheet_name, list(zip(x_list, y_list)))
            wb.save(file_path)
        from libraries.FileMenu.KFitting_IO import persist_project
        persist_project(window)
    except Exception as e:
        window.show_popup_message2(
            "Warning",
            f"Reference added to the session but the project file could not be "
            f"updated ({e}). Save the project to persist it.")

    # Show it
    if window.sheet_combobox.FindString(sheet_name) == -1:
        window.sheet_combobox.Append(sheet_name)
    from libraries.Sheet_Operations import on_sheet_selected
    window.sheet_combobox.SetValue(sheet_name)
    on_sheet_selected(window, sheet_name)
    return sheet_name


# ---------------------------------------------------------------------------
# Import menu action (creates a new workbook, like the FTIR text import)
# ---------------------------------------------------------------------------

def import_jcamp_file(window):
    """Import one or more JCAMP-DX files into a new Excel workbook with
    sheets FTIR, FTIR1, ..."""
    import wx
    import openpyxl
    from libraries.FileMenu.Open import open_xlsx_file

    wildcard = ("JCAMP-DX files (*.jdx;*.dx;*.jcm)|*.jdx;*.dx;*.jcm|"
                "All files (*.*)|*.*")
    with wx.FileDialog(window, "Open JCAMP-DX file(s)", wildcard=wildcard,
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = sorted(dlg.GetPaths())

    if not file_paths:
        return

    try:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        unit_by_sheet = {}
        skipped = []
        exp_rows = []

        for fp in file_paths:
            try:
                spec = parse_jcamp(fp)
            except Exception as e:
                skipped.append(f"{os.path.basename(fp)}: {e}")
                continue
            sheet_name = _next_ftir_sheet_name(wb.sheetnames)
            _write_ftir_sheet(wb, sheet_name, list(zip(spec['x'].tolist(),
                                                       spec['y'].tolist())))
            unit_by_sheet[sheet_name] = spec['y_unit']
            exp_rows.append((sheet_name, spec, fp))

        if not exp_rows:
            window.show_popup_message2("Error",
                                       "No valid JCAMP-DX data found.\n" + "\n".join(skipped))
            return

        exp_sheet = wb.create_sheet("Experimental description")
        exp_sheet.column_dimensions['A'].width = 30
        exp_sheet.column_dimensions['B'].width = 60
        row = 1
        for sheet_name, spec, fp in exp_rows:
            for key, val in (("Sheet", sheet_name),
                             ("Source File", os.path.basename(fp)),
                             ("Title", spec['title']),
                             ("CAS", spec['cas']),
                             ("State", spec['state']),
                             ("Origin", spec['origin']),
                             ("Mol. Formula", spec['molform']),
                             ("Y Units", spec['y_unit']),
                             ("Number of Points", str(len(spec['x'])))):
                if val:
                    exp_sheet[f"A{row}"] = key
                    exp_sheet[f"B{row}"] = val
                    row += 1
            row += 1

        if len(file_paths) == 1:
            base = os.path.splitext(os.path.basename(file_paths[0]))[0]
            excel_path = os.path.join(os.path.dirname(file_paths[0]), f"{base}.xlsx")
        else:
            excel_path = os.path.join(os.path.dirname(file_paths[0]), "FTIR_JCAMP_Data.xlsx")
        wb.save(excel_path)

        open_xlsx_file(window, excel_path)

        core_levels = window.Data.get('Core levels', {})
        for sheet_name, y_unit in unit_by_sheet.items():
            if sheet_name in core_levels:
                sheet = core_levels[sheet_name]
                sheet['FTIR_Y_Unit'] = y_unit
                sheet['FTIR_Input_Unit'] = y_unit
                sheet['FTIR_Raw'] = {'x': list(sheet.get('B.E.', [])),
                                     'y': list(sheet.get('Raw Data', [])),
                                     'unit': y_unit}

        if skipped:
            window.show_popup_message2("Warning",
                                       "Some files were skipped:\n" + "\n".join(skipped))

    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing JCAMP-DX file(s): {str(e)}")
