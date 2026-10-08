# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/TRI_Import.py. Regenerate with tools/export_khervetech.py.
# libraries/FileMenu/TRI_Import.py
"""
TA Instruments TRIOS ``.tri`` importer (DSC / multi-sample DSC).

A ``.tri`` file is TA's proprietary TRIOS binary container.  The relevant part,
once the .NET-serialised metadata header and the embedded instrument thumbnail
(a PNG) are stepped over, is the raw signal block: for every *procedure segment*
(each ramp or isothermal dwell of the temperature programme) the instrument
writes one length-prefixed ``float32`` array per signal, in the exact order the
``proceduresignals`` metadata string lists them::

    [int32 count][count * float32]  <- signal 0 (Time)
    [68-byte record header]
    [int32 count][count * float32]  <- signal 1 (Tzero Temperature)
    ...

The arrays of one segment all share the same ``count`` and a constant 68-byte
gap separates them, so a segment is walked at a fixed stride once its Time array
is found; the next segment is the next Time-like array whose first value
continues the global clock.

The X3 DSC in the example files runs three samples at once, so it carries
``Temperature A/B/C`` and ``Heat Flow A/B/C``: each sample becomes its own sheet,
plotting heat flow against temperature (the standard DSC figure) with the time
axis kept alongside.  Sheets are named TGA, TGA1, ... so they trigger the shared
TGA / DSC plot mode and open in the TGA / DSC Analysis tool.

Like the TGA and SQUID importers this one writes ``window.Data`` directly and
saves a ``.kfit`` project: heat-flow signals are of order 1e-3 mW, which the
two-decimal rounding of the .xlsx/.json format would collapse to zero.
"""

import os
import re
import struct
import wx

try:
    import numpy as np
except ImportError:  # pragma: no cover - numpy is a hard dependency of the app
    np = None


X_LABEL_TEMPERATURE = "Temperature (°C)"
Y_LABEL_HEATFLOW = "Heat Flow (mW)"

# TRIOS stores heat flow in SI watts; DSC is conventionally read in milliwatts.
# The scale is fixed by physics, not a guess: the raw signal is of order
# 1e-3-1e-2 (so 1-10 mW for a few-mg pan), and only the mW reading makes a melt
# enthalpy land in the 100-150 J/g range instead of a physically impossible
# 0.1 J/g. Storing in mW also lets ΔH come out as mJ/mg = J/g directly.
_HEATFLOW_W_TO_MW = 1000.0

# Bytes separating two consecutive signal arrays inside one segment. Constant
# across every file examined; the walker reads at a fixed stride from the Time
# anchor rather than trusting this alone, so a stray value cannot derail it.
_HEADER_GAP = 68

# The raw signal block always sits ahead of the analysis / rendered-curve
# objects; stop the walk before those to avoid mistaking a display copy for a
# measured segment. 5 characters into 'C:\ProgramData\TA Instruments\TRIOS' is a
# reliable marker of where the analysis section begins.
_ANALYSIS_MARKER = b'ProgramData\\TA Instruments\\TRIOS'


# ---------------------------------------------------------------------------
# Metadata (.NET 7-bit length-prefixed strings)
# ---------------------------------------------------------------------------

def _read_7bit(data, pos):
    """Decode a .NET BinaryReader 7-bit-encoded length. Returns (value, pos)."""
    result = 0
    shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, pos


def _read_string_after(data, key):
    """The length-prefixed string that immediately follows ``key`` in the header."""
    p = data.find(key)
    if p < 0:
        return None
    try:
        ln, pos = _read_7bit(data, p + len(key))
    except IndexError:
        return None
    if not (0 <= ln <= 4096) or pos + ln > len(data):
        return None
    return data[pos:pos + ln].decode('utf-8', 'replace')


def _walk_header_strings(data, max_tokens=200):
    """Read the header's key/value string pairs in order, as a flat token list.

    The header is a run of length-prefixed strings; numeric values break the run,
    so this stops at the first token that does not decode, which is enough to
    recover the text fields (sample name, operator, dates, procedure text)."""
    start = data.find(b'instrumenttype')
    if start < 0:
        return []
    pos = max(0, start - 1)
    tokens = []
    for _ in range(max_tokens):
        try:
            ln, p = _read_7bit(data, pos)
        except IndexError:
            break
        if not (0 <= ln <= 512) or p + ln > len(data):
            break
        chunk = data[p:p + ln]
        try:
            s = chunk.decode('utf-8')
        except UnicodeDecodeError:
            break
        if ln and not any(32 <= c < 127 for c in chunk):
            break
        tokens.append(s)
        pos = p + ln
    return tokens


def _metadata(data):
    """Pull the human-readable header fields into a dict."""
    meta = {}
    for key in ('instrumenttype', 'instrumentname', 'instrumentserialnumber',
                'companyname', 'rundate', 'operator', 'project', 'samplename',
                'comments', 'pantype', 'procedurename'):
        value = _read_string_after(data, key.encode('ascii'))
        if value:
            meta[key] = value

    signals = _read_string_after(data, b'proceduresignals')
    meta['_signals'] = ([s.strip() for s in signals.split(';') if s.strip()]
                        if signals else [])

    segments = _read_string_after(data, b'proceduresegments')
    if segments:
        meta['proceduresegments'] = segments

    # Per-sample pan numbers (X3 runs three samples, A/B/C).
    tokens = _walk_header_strings(data)
    pans = {}
    for i in range(len(tokens) - 1):
        if tokens[i] in ('samplepannumber', 'samplepannumberb', 'samplepannumberc'):
            pans[tokens[i]] = tokens[i + 1]
    meta['_pans'] = pans
    return meta


# ---------------------------------------------------------------------------
# Raw signal block
# ---------------------------------------------------------------------------

def _read_array_at(data, pos, exact_n=None):
    """If ``pos`` holds ``int32 count`` + ``count`` finite float32, return the
    numpy array, else None.  ``exact_n`` requires a specific length."""
    n = len(data)
    if pos + 4 > n:
        return None
    count = struct.unpack_from('<i', data, pos)[0]
    if exact_n is not None:
        if count != exact_n:
            return None
    elif not (2 <= count <= 5_000_000):
        return None
    end = pos + 4 + count * 4
    if end > n:
        return None
    arr = np.frombuffer(data, dtype='<f4', count=count, offset=pos + 4)
    if not np.all(np.isfinite(arr)) or np.max(np.abs(arr)) > 1e7:
        return None
    return arr


def _is_time_like(arr):
    """True for a monotonically increasing array with a near-constant step -
    the signature of the Time channel, and nothing else."""
    if arr is None or arr.size < 50:
        return False
    d = np.diff(arr)
    if not np.all(d > 0):
        return False
    median = np.median(d)
    return median > 0 and bool(np.all(np.abs(d - median) < 0.5 * median + 1e-6))


def _read_signal_block(data, n_signals):
    """Walk every segment and return the per-signal arrays and segment sizes.

    Returns ``(columns, seg_sizes)`` where ``columns[i]`` is the full
    acquisition of signal ``i`` (index into ``proceduresignals``) stitched over
    every segment in order, and ``seg_sizes`` gives the point count of each
    programme segment (one ramp or dwell).  Returns None when the block cannot
    be located.
    """
    if np is None or n_signals < 2:
        return None

    marker = data.find(_ANALYSIS_MARKER)
    limit = marker if marker > 0 else len(data)

    # The first Time array anchors the whole block.
    anchor = None
    for pos in range(0, min(limit, 500_000)):
        arr = _read_array_at(data, pos)
        if arr is not None and abs(arr[0]) < 0.5 and _is_time_like(arr):
            anchor = pos
            break
    if anchor is None:
        return None

    columns = [[] for _ in range(n_signals)]
    seg_sizes = []
    pos = anchor
    seen = 0
    while pos is not None and pos < limit and seen < 10_000:
        time_arr = _read_array_at(data, pos)
        if not _is_time_like(time_arr):
            break
        count = time_arr.size
        stride = count * 4 + 4 + _HEADER_GAP

        seg = []
        for i in range(n_signals):
            arr = _read_array_at(data, pos + i * stride, exact_n=count)
            if arr is None:
                seg = None
                break
            seg.append(arr)
        if seg is None:
            break

        for i in range(n_signals):
            columns[i].append(seg[i])
        seg_sizes.append(count)
        seen += 1
        last_time = float(seg[0][-1])

        # The next segment's Time array is the next time-like array that carries
        # the clock forward from where this one stopped.
        search_from = pos + n_signals * stride
        nxt = None
        for q in range(search_from, min(search_from + 400_000, limit)):
            candidate = _read_array_at(data, q)
            if _is_time_like(candidate) and abs(candidate[0] - last_time) < 5.0:
                nxt = q
                break
        pos = nxt

    if not seen:
        return None
    columns = [np.concatenate(col) if col else np.array([]) for col in columns]
    return columns, seg_sizes


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_SAMPLE_RE = re.compile(r'^(.*?)\s+([A-Z])$')


def _sample_channels(names):
    """Group the signal names into per-sample (temperature, heat-flow) channels.

    Returns a list of dicts ``{'label', 'temperature_index', 'heatflow_index'}``.
    A multi-sample DSC has 'Temperature A/B/C' and 'Heat Flow A/B/C'; a single
    sample has plain 'Temperature' / 'Heat Flow'.
    """
    heatflow = {}   # sample letter (or '') -> index
    temperature = {}
    for i, name in enumerate(names):
        low = name.lower()
        m = _SAMPLE_RE.match(name)
        letter = m.group(2) if m else ''
        if low.startswith('heat flow'):
            heatflow[letter] = i
        elif low.startswith('temperature') and letter:
            temperature[letter] = i

    # A shared sample temperature to fall back on (single-sample files, or a
    # heat-flow channel whose own temperature sensor was not stored).
    shared_temp = None
    for i, name in enumerate(names):
        if name.lower() in ('temperature', 'sample temperature', 'tzero temperature'):
            shared_temp = i
            break

    channels = []
    for letter in sorted(heatflow):
        t_index = temperature.get(letter, shared_temp)
        if t_index is None:
            continue
        channels.append({
            'label': letter,
            'temperature_index': t_index,
            'heatflow_index': heatflow[letter],
        })
    return channels


def _time_index(names):
    for i, name in enumerate(names):
        if name.strip().lower() == 'time':
            return i
    return None


def parse_tri_file(file_path):
    """Parse a TA TRIOS ``.tri`` DSC file.

    Returns a dict with ``metadata``, ``time_min`` (list or None) and a list of
    ``samples``; each sample is ``{'label', 'temperature', 'heat_flow'}`` with
    the traces as plain float lists.  Raises ``ValueError`` when no usable signal
    block is found.
    """
    if np is None:
        raise ValueError("numpy is required to read .tri files")

    with open(file_path, 'rb') as f:
        data = f.read()

    meta = _metadata(data)
    names = meta.get('_signals') or []
    if len(names) < 2:
        raise ValueError("no signal list in the file header")

    block = _read_signal_block(data, len(names))
    if block is None:
        raise ValueError("could not locate the raw signal block")
    columns, seg_sizes = block

    channels = _sample_channels(names)
    if not channels:
        raise ValueError("no Heat Flow / Temperature channel pair found")

    time_idx = _time_index(names)
    time_col = columns[time_idx] if time_idx is not None else None
    npoints = columns[channels[0]['heatflow_index']].size

    # Time is stored in seconds; the tool works in minutes like the CSV importer.
    time_min = None
    if time_col is not None and time_col.size == npoints:
        time_min = [float(v) / 60.0 for v in time_col]

    # A 1-based programme-segment id per point (one ramp or dwell each), so the
    # analysis can isolate a single monotonic ramp from a run that passes the
    # same temperature several times.
    segment = []
    for seg_id, size in enumerate(seg_sizes, start=1):
        segment.extend([seg_id] * size)
    if len(segment) != npoints:
        segment = None

    samples = []
    for ch in channels:
        temperature = columns[ch['temperature_index']]
        heat_flow = columns[ch['heatflow_index']]
        if temperature.size != npoints or heat_flow.size != npoints:
            continue
        samples.append({
            'label': ch['label'],
            'temperature': [float(v) for v in temperature],
            'heat_flow': [float(v) for v in heat_flow],
        })

    if not samples:
        raise ValueError("signal channels have mismatched lengths")

    return {
        'metadata': meta,
        'time_min': time_min,
        'segment': segment,
        'samples': samples,
        'n_points': npoints,
    }


# ---------------------------------------------------------------------------
# Sheet construction
# ---------------------------------------------------------------------------

def _sample_display_name(meta, label):
    """A readable name for one sample: the file's sample name plus the A/B/C tag."""
    base = (meta.get('samplename') or '').strip()
    # 'EVOH-...-C,1' style names already end in a sample index; keep the pan tag.
    pans = meta.get('_pans') or {}
    pan_key = {'A': 'samplepannumber', 'B': 'samplepannumberb',
               'C': 'samplepannumberc'}.get(label)
    pan = pans.get(pan_key) if pan_key else None
    parts = [p for p in (base, f"({label})" if label else '') if p]
    name = ' '.join(parts) if parts else (label or 'DSC')
    if pan:
        name += f" [pan {pan}]"
    return name


def build_dsc_sheet(parsed, sample, file_path, sheet_name):
    """Assemble the ``window.Data['Core levels'][sheet]`` entry for one sample.

    The sheet is a DSC-primary temperature view: heat flow on the main axis
    against temperature.  ``B.E.`` / ``Raw Data`` are the plotted pair; the
    temperature, heat flow and time traces are also stored under ``TGA_`` keys so
    KherveFitting keeps them losslessly and the Heat Flow analysis tab can slice
    them.
    """
    from libraries.FileMenu.TGA_Import import VIEW_TEMPERATURE

    meta = parsed['metadata']
    temperature = sample['temperature']
    heat_flow = [v * _HEATFLOW_W_TO_MW for v in sample['heat_flow']]
    label = _sample_display_name(meta, sample['label'])

    x_lo, x_hi = min(temperature), max(temperature)
    span = x_hi - x_lo

    sheet = {
        'Name': sheet_name,
        'B.E.': list(temperature),
        'Raw Data': list(heat_flow),
        'TGA_View': VIEW_TEMPERATURE,
        'TGA_Signal_Kind': 'heatflow',
        'TGA_X_Label': X_LABEL_TEMPERATURE,
        'TGA_Y_Label': Y_LABEL_HEATFLOW,
        'TGA_Y_Unit': 'mW',
        'TGA_Mass_Label': Y_LABEL_HEATFLOW,
        'TGA_Mass_Unit': 'mW',
        'TGA_Normalised': False,
        'TGA_Label': label,
        'TGA_Source': os.path.basename(file_path),
        'TGA_Sample_Mass_mg': None,
        'TGA_DSC_Unit': 'Heat Flow (mW)',
        'TGA_HeatFlow_Unit': 'mW',
        'TGA_Exo_Up': True,
        'ExperimentalInfo': _experimental_info(parsed, sample, file_path),
        'Background': {
            'Bkg Y': list(heat_flow),
            'Bkg Type': '',
            'Bkg Low': float(x_lo + 0.25 * span),
            'Bkg High': float(x_lo + 0.75 * span),
            'Bkg Offset Low': 0,
            'Bkg Offset High': 0,
        },
    }

    sheet['TGA_Temperature'] = list(temperature)
    sheet['TGA_HeatFlow'] = list(heat_flow)
    if parsed['time_min'] is not None:
        sheet['TGA_Time_min'] = list(parsed['time_min'])
    if parsed.get('segment') is not None:
        sheet['TGA_Segment'] = [float(v) for v in parsed['segment']]

    return sheet


def _experimental_info(parsed, sample, file_path):
    meta = parsed['metadata']
    temperature = sample['temperature']
    info = {
        'Technique': 'DSC (TA TRIOS)',
        'Source File': os.path.basename(file_path),
        'Number of Points': str(parsed['n_points']),
        'Temperature Range (°C)': f"{min(temperature):.1f} - {max(temperature):.1f}",
        'Sample': _sample_display_name(meta, sample['label']),
    }
    for src, dst in (('instrumentname', 'Instrument'),
                     ('instrumentserialnumber', 'Serial'),
                     ('samplename', 'Material'),
                     ('rundate', 'Acquired'),
                     ('operator', 'Operator'),
                     ('companyname', 'Laboratory'),
                     ('pantype', 'Pan'),
                     ('proceduresegments', 'Programme')):
        value = meta.get(src)
        if value:
            info[dst] = value
    return info


# ---------------------------------------------------------------------------
# Import entry points
# ---------------------------------------------------------------------------

def next_tga_sheet_name(existing_names):
    from libraries.FileMenu.TGA_Import import next_tga_sheet_name as _next
    return _next(existing_names)


def _import_tri_paths(window, file_paths, project_path):
    """Load the given .tri files into window.Data and save a .kfit project."""
    from libraries.FileMenu.KFitting_IO import write_kfitting, open_kfitting_file
    from libraries.ConfigFile import Init_Measurement_Data

    core_levels = {}
    skipped = []

    for file_path in sorted(file_paths):
        try:
            parsed = parse_tri_file(file_path)
        except Exception as e:
            skipped.append(f"{os.path.basename(file_path)}: {e}")
            continue

        for sample in parsed['samples']:
            sheet_name = next_tga_sheet_name(core_levels.keys())
            core_levels[sheet_name] = build_dsc_sheet(
                parsed, sample, file_path, sheet_name)

    if not core_levels:
        window.show_popup_message2(
            "Error", "No valid DSC data found in the .tri file(s).\n"
            + "\n".join(skipped))
        return False

    window.Data = Init_Measurement_Data(window)
    window.Data['Core levels'] = core_levels
    window.Data['Number of Core levels'] = len(core_levels)
    window.Data['FilePath'] = project_path

    write_kfitting(window, project_path)
    open_kfitting_file(window, project_path)

    if skipped:
        window.show_popup_message2(
            "Warning", "Some files were skipped:\n" + "\n".join(skipped))
    return True


def _project_path_for(file_paths, combined_name):
    directory = os.path.dirname(file_paths[0])
    if len(file_paths) == 1:
        base = os.path.splitext(os.path.basename(file_paths[0]))[0]
        return os.path.join(directory, f"{base}.kfit")
    return os.path.join(directory, combined_name)


def import_tri_file(window):
    """Import one or more TA TRIOS .tri DSC files as sheets TGA, TGA1, ..."""
    with wx.FileDialog(window, "Open TA TRIOS .tri file(s)",
                       wildcard="TRIOS files (*.tri)|*.tri;*.TRI|"
                                "All files (*.*)|*.*",
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST | wx.FD_MULTIPLE) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        file_paths = dlg.GetPaths()

    if not file_paths:
        return

    try:
        _import_tri_paths(window, file_paths,
                          _project_path_for(file_paths, "DSC_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing .tri file(s): {str(e)}")


def import_multiple_tri_files(window):
    """Import every .tri file in a folder as sheets TGA, TGA1, ..."""
    with wx.DirDialog(window, "Choose a directory containing .tri files",
                      style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dlg:
        if dlg.ShowModal() == wx.ID_CANCEL:
            return
        dir_path = dlg.GetPath()

    try:
        found = sorted(f for f in os.listdir(dir_path)
                       if f.lower().endswith('.tri'))
        if not found:
            window.show_popup_message2(
                "Information", "No .tri files found in the selected folder.")
            return
        file_paths = [os.path.join(dir_path, f) for f in found]
        _import_tri_paths(window, file_paths,
                          os.path.join(dir_path, "DSC_Data.kfit"))
    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing .tri files: {str(e)}")
