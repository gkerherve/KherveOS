# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/AFM_Import.py. Regenerate with tools/export_khervetech.py.
"""
AFM image import for KherveFitting.

Loads an atomic-force-microscopy file into ``Data['Core levels']`` as one
sheet per channel — an AFM capture is inherently multi-channel (a tapping
scan records height, amplitude and phase in one pass; KPFM adds a surface
potential; cAFM adds one or two currents) and each channel is its own map
with its own physical unit. Sheets are named ``AFM~<Channel>`` — except the
topography map, which is the technique's base sheet and is named plainly
``AFM`` — and flagged ``'_afm': True`` so every XPS/spectral code path skips
them. The ``~`` suffix marks the derived views: ``AFM~3D`` (a rendered
surface of the height channel, created at import) and ``AFM~Profile``.

Five vendor formats are read natively (no external AFM library):

- Igor Binary Wave ``.ibw`` (Asylum Research / Oxford Instruments): an IBW v5
  wave whose third dimension is the channel stack, with channel names in the
  dimension-2 labels and the full instrument note as \\r-separated key:value
  pairs (layout per Igor Tech Note TN003).
- Bruker Nanoscope ``.spm`` and numbered ``.001``/``.002``… files: an ASCII
  ``\\*File list`` header describing one binary int16/int32 block per channel,
  scaled by the ``@2:Z scale`` hard value times the ``@Sens.`` soft scale.
- Asylum Research ``.ARDF`` force maps: a block-tree (FTOC/IMAG/VOLM) holding
  instrument-computed image maps plus one force curve per pixel; the curve
  segment markers (approach / dwell / retract) and the adhesion analysis were
  validated against the instrument's own MapAdhesion channel.
- Gwyddion ``.gwy`` (the native serialized-GwyContainer format of the
  open-source SPM package — one file can hold many unrelated scans, each
  with its own calibration) and ``.gsf`` (Gwyddion Simple Field: a text
  header plus a float32 raster).
- Velox ``.emd`` (Thermo Fisher / FEI): the scanned images of an HDF5 EMD
  container. An STM topograph or a STEM detector map is a raster of one
  signal per pixel with an isotropic pixel size — an AFM channel map in
  everything but name — so each detector in the file becomes a channel here.

Every channel is converted to a display unit at import (heights and
amplitudes m -> nm, currents A -> nA, phase deg, potential V); the array
stored on the sheet is already in that unit and ``AFM_Units`` names it.

The pixel calibration comes from the scan size in the vendor metadata
(``AFM_NM_Per_Px``, with ``AFM_NM_Per_Px_Y`` when the scan is anisotropic).

A force-volume file additionally carries the whole curve set on the height
sheet under ``_afm_volume`` — kept out of the JSON like the images, and
persisted to HDF5 alongside them.
"""

import os
import struct

import numpy as np
import wx

try:
    import h5py
    HAS_H5PY = True
except ImportError:
    HAS_H5PY = False


AFM_WILDCARD = ("AFM / SPM files (*.ibw;*.spm;*.ardf;*.gwy;*.gsf;*.emd;*.0*)|"
                "*.ibw;*.spm;*.ardf;*.gwy;*.gsf;*.emd;*.0*|"
                "Asylum / Igor wave (*.ibw)|*.ibw|"
                "Bruker Nanoscope (*.spm;*.0*)|*.spm;*.0*|"
                "Asylum force map (*.ardf)|*.ardf|"
                "Gwyddion (*.gwy;*.gsf)|*.gwy;*.gsf|"
                "Velox scanned image (*.emd)|*.emd|"
                "All files (*.*)|*.*")

# Heavy arrays kept out of the project JSON (see the persistence section).
_AFM_ARRAY_KEYS = ('_afm_image', '_afm_overlay', '_afm_volume')
_AFM_H5_GROUP = 'AFM'

# Per-sheet keys that must survive the project round trip untouched: the JSON
# copy rounds every float to 2 dp, which would turn a 39.06 nm pixel into 39.06
# (fine) but a 0.098 nm Sa into 0.1 and a profile endpoint at x=12.345 µm into
# 12.35 — so, like the TEM keys, they travel in the HDF5 as JSON strings.
_AFM_JSON_ATTRS = ('AFM_Profile_Line', 'AFM_Profile_Stats', 'AFM_Roughness',
                   'AFM_Level', 'AFM_Force_Maps', 'AFM_3D',
                   'AFM_Profile_CD', 'AFM_Profile_CD_Range',
                   'AFM_Particles', 'AFM_Display_Range', 'AFM_Grain_Fit',
                   'AFM_ScaleBar_Pos', 'AFM_Roughness_Overlay',
                   'AFM_Profile_Lines', 'AFM_Profile_Active',
                   'AFM_ROIs', 'AFM_Crop')
_AFM_SCALAR_ATTRS = ('AFM_Channel', 'AFM_Units', 'AFM_Mode', 'AFM_Derived_From',
                     'AFM_Scalar_CMap', 'AFM_Source_Sheet')
# The volume can be large; above this many float32 values it is not embedded
# in the project file and is reloaded from the source .ARDF instead.
_VOLUME_EMBED_LIMIT = 50_000_000


def _json_attr(key):
    return key.lower() + '_json'


# ---------------------------------------------------------------------------
# Igor Binary Wave v5 (Asylum Research)
# ---------------------------------------------------------------------------

# Igor numeric type codes -> numpy dtype (NT_CMPLX excluded; an AFM image is
# never complex).
_IGOR_TYPES = {2: '<f4', 4: '<f8', 8: '<i1', 0x10: '<i2', 0x20: '<i4',
               0x48: '<u1', 0x50: '<u2', 0x60: '<u4'}


def _read_ibw(buf):
    """Parse an IBW v5 file (already in memory) into wave data + metadata.

    Layout per Igor Tech Note TN003: BinHeader5 (64 bytes), WaveHeader5
    (320 bytes), the data, then the optional trailing blocks (formula, note,
    units, dimension labels) whose sizes the BinHeader records. Asylum puts
    the channel names in the dimension-2 labels and the whole instrument
    state in the note.
    """
    version = struct.unpack_from('<h', buf, 0)[0]
    if version != 5:
        raise ValueError(f'Unsupported Igor wave version {version} '
                         f'(only IBW v5 is supported)')

    formula_size, note_size, data_eunits_size = struct.unpack_from('<3i', buf, 8)
    dim_eunits_size = struct.unpack_from('<4i', buf, 20)
    dim_labels_size = struct.unpack_from('<4i', buf, 36)

    wh = 64                                   # WaveHeader5
    npnts = struct.unpack_from('<i', buf, wh + 12)[0]
    wtype = struct.unpack_from('<h', buf, wh + 16)[0]
    bname = buf[wh + 28: wh + 60].split(b'\x00')[0].decode('latin-1')
    ndim = struct.unpack_from('<4i', buf, wh + 68)

    dtype = _IGOR_TYPES.get(wtype)
    if dtype is None:
        raise ValueError(f'Unsupported Igor data type 0x{wtype:x}')
    tsize = np.dtype(dtype).itemsize

    data_start = 64 + 320
    data = np.frombuffer(buf, dtype=dtype, count=npnts, offset=data_start)
    dims = [d for d in ndim if d > 0]
    # Igor stores rows fastest (index = i0 + i1*n0 + i2*n0*n1), so a C-order
    # reshape of the reversed dims gives arr[layer, y, x].
    data = data.reshape(tuple(reversed(dims)))

    pos = data_start + npnts * tsize + formula_size
    note = buf[pos: pos + note_size].decode('latin-1', errors='replace')
    pos += note_size + data_eunits_size + sum(dim_eunits_size)

    labels = [[] for _ in range(4)]
    for i, size in enumerate(dim_labels_size):
        if size > 0:
            for k in range(size // 32):
                lab = buf[pos + 32 * k: pos + 32 * (k + 1)]
                labels[i].append(lab.split(b'\x00')[0].decode('latin-1'))
        pos += size

    meta = _parse_note(note)

    # Channel names: dimension-2 labels, element 0 being the label for the
    # whole dimension (usually empty) and 1..n the per-layer names.
    if len(dims) == 3:
        nlayers = dims[2]
        lab = labels[2]
        names = []
        for k in range(nlayers):
            if len(lab) > k + 1 and lab[k + 1]:
                names.append(lab[k + 1])
            else:
                names.append(f'Channel{k + 1}')
        channels = [(names[k], np.asarray(data[k], dtype=np.float64))
                    for k in range(nlayers)]
    else:
        channels = [(bname or 'Channel1', np.asarray(data, dtype=np.float64))]
    return channels, meta


def _parse_note(text):
    """Asylum note / ARDF note: \\r-separated 'Key: Value' pairs."""
    meta = {}
    for line in text.replace('\r\n', '\r').split('\r'):
        if ':' in line:
            key, _, value = line.partition(':')
            key = key.strip()
            if key:
                meta[key] = value.strip()
    return meta


# Asylum channel base name -> (display unit, factor from the stored SI value).
_ASYLUM_UNITS = {
    'Height': ('nm', 1e9), 'ZSensor': ('nm', 1e9), 'Raw': ('nm', 1e9),
    'Amplitude': ('nm', 1e9), 'NapAmplitude': ('nm', 1e9),
    'Amplitude2': ('nm', 1e9),
    'Deflection': ('nm', 1e9), 'NapDeflection': ('nm', 1e9),
    'Defl': ('nm', 1e9), 'ZSnsr': ('nm', 1e9),
    'Phase': ('deg', 1.0), 'NapPhase': ('deg', 1.0), 'Phase2': ('deg', 1.0),
    'Potential': ('V', 1.0), 'NapPotential': ('V', 1.0), 'Bias': ('V', 1.0),
    'Current': ('nA', 1e9), 'Current2': ('nA', 1e9),
    'Cur': ('nA', 1e9), 'Curr2': ('nA', 1e9),
    'Frequency': ('Hz', 1.0), 'NapFrequency': ('Hz', 1.0),
    'Capacitance': ('F', 1.0),
    'MapHeight': ('nm', 1e9), 'MapAdhesion': ('nN', 1e9),
}


def _asylum_channel_unit(name):
    """(unit, factor) for an Asylum channel name such as 'HeightRetrace'."""
    base = name
    for suffix in ('Retrace', 'Trace'):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return _ASYLUM_UNITS.get(base, ('', 1.0))


def _short_channel_name(name, taken):
    """Display name for a channel: drop the Trace/Retrace suffix and spaces.

    Every channel of a normal capture is the retrace, so the suffix carries no
    information; it is kept only when dropping it would collide with a channel
    already named (a file holding both HeightTrace and HeightRetrace).
    """
    short = str(name).replace(' ', '')
    for suffix in ('Retrace', 'Trace'):
        if short.endswith(suffix) and short != suffix:
            candidate = short[: -len(suffix)]
            if candidate not in taken:
                return candidate
            break
    return short


def _asylum_mode(meta, channel_names):
    """Human name of the imaging mode from the Asylum note + channel list."""
    mode = str(meta.get('ImagingMode', '')).strip()
    nap = str(meta.get('NapMode', '0')).strip() not in ('', '0')
    names = ' '.join(channel_names)
    if 'PFM' in mode:
        return 'PFM'
    if nap and 'Potential' in names:
        return 'KPFM'
    if nap and ('NapAmplitude' in names or 'NapPhase' in names):
        return 'MFM'
    if 'Current' in names and mode.startswith('Contact'):
        return 'cAFM'
    if mode.startswith('Contact'):
        return 'Contact Mode'
    if mode == 'AC Mode':
        return 'Tapping (AC Mode)'
    return mode or 'AFM'


def _read_asylum_ibw(file_path):
    """Read one Asylum .ibw into the common channel-list structure."""
    with open(file_path, 'rb') as fh:
        buf = fh.read()
    raw_channels, meta = _read_ibw(buf)

    channels = []
    taken = set()
    for name, data in raw_channels:
        unit, factor = _asylum_channel_unit(name)
        short = _short_channel_name(name, taken)
        taken.add(short)
        # Asylum stores the first scan line as the bottom of the frame; row 0
        # must be the top for the shared origin='upper' rendering.
        channels.append({'name': short, 'source_name': name,
                         'data': np.flipud(data * factor).astype(np.float32),
                         'units': unit})

    ny, nx = channels[0]['data'].shape if channels else (0, 0)
    nm_x = nm_y = None
    try:
        nm_x = float(meta['FastScanSize']) * 1e9 / max(nx, 1)
        nm_y = float(meta['SlowScanSize']) * 1e9 / max(ny, 1)
    except (KeyError, ValueError):
        pass

    mode = _asylum_mode(meta, [c['source_name'] for c in channels])
    info = {'Technique': 'AFM', 'Instrument': 'Asylum Research', 'Mode': mode}
    for key, label in (('ScanRate', 'Scan Rate (Hz)'),
                       ('ScanAngle', 'Scan Angle'),
                       ('SpringConstant', 'Spring Constant (N/m)'),
                       ('AmpInvOLS', 'Amp InvOLS (m/V)'),
                       ('InvOLS', 'InvOLS (m/V)'),
                       ('DriveFrequency', 'Drive Frequency (Hz)'),
                       ('Date', 'Date'), ('Time', 'Time')):
        if meta.get(key):
            info[label] = meta[key]
    return {'channels': channels, 'nm_per_px': nm_x, 'nm_per_px_y': nm_y,
            'info': info, 'mode': mode, 'volume': None, 'meta': meta}


# ---------------------------------------------------------------------------
# Bruker Nanoscope (.spm and numbered .001/.002/... files)
# ---------------------------------------------------------------------------

def _nanoscope_header(buf):
    """Parse the ASCII header into a list of (section name, {param: value}).

    ``@``-parameters embed a group prefix and colons of their own
    (``\\@2:Z scale: V [Sens. Zsens] (0.006 V/LSB) 440.0 V``), so they are
    split after the full parameter name, not at the first colon.
    """
    import re
    text = buf.decode('latin-1', errors='replace')
    end = text.find('\\*File list end')
    if end < 0:
        raise ValueError('Not a Nanoscope file (missing \\*File list end)')
    sections = []
    current = None
    for line in text[:end].split('\r\n'):
        if not line.startswith('\\'):
            continue
        line = line[1:]
        if line.startswith('*'):
            current = (line[1:].strip(), {})
            sections.append(current)
            continue
        if current is None or ':' not in line:
            continue
        if line.startswith('@'):
            match = re.match(r'^(@(?:\d+:)?[^:]+):\s?(.*)$', line)
            if not match:
                continue
            key, value = match.group(1), match.group(2)
        else:
            key, _, value = line.partition(':')
        params = current[1]
        key, value = key.strip(), value.strip()
        if key in params:
            if not isinstance(params[key], list):
                params[key] = [params[key]]
            params[key].append(value)
        else:
            params[key] = value
    return sections


def _nanoscope_at_value(text):
    """Split 'V [Sens. Zsens] (0.0067 V/LSB) 440.0 V' into its three parts."""
    import re
    soft_ref = None
    match = re.search(r'\[([^\]]*)\]', text)
    if match:
        soft_ref = match.group(1)
    per_lsb = None
    match = re.search(r'\(([-0-9.eE+]+)\s*[^)]*/LSB\)', text)
    if match:
        per_lsb = float(match.group(1))
    hard = None
    match = re.search(r'\)\s*([-0-9.eE+]+)\s*(\S*)\s*$', text)
    if match:
        hard = float(match.group(1))
    return soft_ref, per_lsb, hard


def _read_nanoscope(file_path):
    """Read a Bruker Nanoscope file into the common channel-list structure."""
    import re
    with open(file_path, 'rb') as fh:
        buf = fh.read()
    sections = _nanoscope_header(buf)

    # Soft-scale sensitivities ('@Sens. Zsens: V 9.26 nm/V') live in the
    # scanner / scan lists and are referenced by name from each channel.
    sens = {}
    scan_params = {}
    for name, params in sections:
        for key, value in params.items():
            if not key.startswith('@Sens.'):
                continue
            values = value if isinstance(value, list) else [value]
            match = re.match(r'V\s+([-0-9.eE+]+)\s*(\S+)', values[0])
            if match:
                sens[key[1:]] = (float(match.group(1)), match.group(2))
        if name in ('Ciao scan list', 'Scanner list', 'File list',
                    'Fast Scan list'):
            scan_params.update({k: v for k, v in params.items()
                                if not isinstance(v, list)})

    scan_size_nm = None
    size_value = scan_params.get('Scan Size') or scan_params.get('Scan size')
    if size_value:
        parts = str(size_value).split()
        try:
            scan_size_nm = float(parts[0])
            unit = parts[-1].lower() if len(parts) > 1 else 'nm'
            scan_size_nm *= {'nm': 1.0, 'um': 1e3, '~m': 1e3, 'µm': 1e3,
                             'mm': 1e6, 'pm': 1e-3}.get(unit, 1.0)
        except ValueError:
            scan_size_nm = None

    channels = []
    taken = set()
    for name, params in sections:
        if 'image list' not in name.lower():
            continue
        try:
            offset = int(str(params['Data offset']))
            length = int(str(params['Data length']))
            bpp = int(str(params.get('Bytes/data', '2')))
            samps = int(str(params.get('Samps/line', '0')).split()[0])
            lines = int(str(params.get('Number of lines', '0')).split()[0])
        except (KeyError, ValueError, IndexError):
            continue
        if not samps or not lines:
            continue
        # Old files sometimes declare 2 bytes but store 4 (or vice versa);
        # the block length is what actually counts.
        actual = length // (samps * lines)
        if actual in (2, 4):
            bpp = actual
        raw = np.frombuffer(buf, dtype='<i2' if bpp == 2 else '<i4',
                            count=samps * lines, offset=offset)
        raw = raw.reshape(lines, samps)

        channel_name = None
        for key, value in params.items():
            if key.endswith('Image Data'):
                text = value if not isinstance(value, list) else value[0]
                match = re.search(r'"([^"]*)"', text)
                if match:
                    channel_name = match.group(1)
                break
        channel_name = channel_name or name

        soft_ref = per_lsb = hard = None
        for key in params:
            if key.startswith('@') and key.endswith('Z scale'):
                text = params[key]
                text = text if not isinstance(text, list) else text[0]
                soft_ref, per_lsb, hard = _nanoscope_at_value(text)
                break
        scale, unit = 1.0, 'LSB'
        if per_lsb is None and hard is not None:
            per_lsb = hard / float(2 ** (8 * bpp))
        if per_lsb is not None:
            scale, unit = per_lsb, 'V'
            if soft_ref and soft_ref in sens:
                scale *= sens[soft_ref][0]
                unit = sens[soft_ref][1].split('/')[0]

        short = _short_channel_name(channel_name, taken)
        base = short
        counter = 2
        while short in taken:
            short = f'{base}{counter}'
            counter += 1
        taken.add(short)
        # Nanoscope stores the first line at the bottom of the frame.
        channels.append({'name': short, 'source_name': channel_name,
                         'data': np.flipud(raw.astype(np.float64) * scale)
                         .astype(np.float32),
                         'units': unit})

    ny = channels[0]['data'].shape[0] if channels else 0
    nx = channels[0]['data'].shape[1] if channels else 0
    nm_x = scan_size_nm / nx if (scan_size_nm and nx) else None
    nm_y = scan_size_nm / ny if (scan_size_nm and ny) else None

    names = ' '.join(c['source_name'] for c in channels)
    if 'Peak Force' in names or 'DMT' in names:
        mode = 'PeakForce Tapping'
    elif 'Current' in names or 'TUNA' in names:
        mode = 'cAFM'
    elif 'Amplitude' in names:
        mode = 'Tapping Mode'
    elif 'Deflection' in names:
        mode = 'Contact Mode'
    else:
        mode = 'AFM'

    info = {'Technique': 'AFM', 'Instrument': 'Bruker', 'Mode': mode}
    for key, label in (('Scan Rate', 'Scan Rate (Hz)'),
                       ('Tip Serial Number', 'Tip'),
                       ('Date', 'Date'),
                       ('Microscope Model', 'Instrument')):
        if scan_params.get(key):
            info[label] = str(scan_params[key])
    return {'channels': channels, 'nm_per_px': nm_x, 'nm_per_px_y': nm_y,
            'info': info, 'mode': mode, 'volume': None, 'meta': scan_params}


# ---------------------------------------------------------------------------
# Asylum ARDF force maps
# ---------------------------------------------------------------------------
# Block tree layout after Gwyddion's reverse-engineered reader (ardf.c) and
# ViscoIndent's import_ARDF.py. Every block starts with a 16-byte pointer:
# uint32 CRC, uint32 size, char[4] tag, uint32 misc. FTOC lists the IMAG
# (image) and VOLM (force volume) containers; TTOC lists the TEXT notes.

def _ardf_ptr(buf, pos):
    crc, size = struct.unpack_from('<II', buf, pos)
    tag = buf[pos + 8: pos + 12].decode('latin-1')
    return crc, size, tag


def _ardf_toc(buf, pos):
    """Read a table-of-contents block; entry layout depends on entry size."""
    _, size, tag = _ardf_ptr(buf, pos)
    size_table, count, size_entry = struct.unpack_from('<QII', buf, pos + 16)
    entries = []
    p = pos + 32
    for _ in range(count):
        _, _, etag = _ardf_ptr(buf, p)
        if not etag.strip('\x00'):
            break
        entry = {'tag': etag}
        if size_entry == 24:
            entry['ptr'] = struct.unpack_from('<Q', buf, p + 16)[0]
        elif size_entry == 32:
            entry['index'], entry['ptr'] = struct.unpack_from('<QQ', buf, p + 16)
        elif size_entry == 40:
            entry['points'], entry['lines'] = struct.unpack_from('<II', buf, p + 16)
            entry['ptr'] = struct.unpack_from('<Q', buf, p + 32)[0]
        entries.append(entry)
        p += size_entry
    return {'tag': tag, 'size_table': size_table, 'entries': entries}


def _ardf_text(buf, pos):
    _, _, _tag = _ardf_ptr(buf, pos)
    _, size_note = struct.unpack_from('<II', buf, pos + 16)
    return buf[pos + 24: pos + 24 + size_note].decode('latin-1',
                                                      errors='replace')


def _ardf_imag(buf, pos):
    """One IMAG container -> (title, 2-D float array, local note dict)."""
    imag_toc = _ardf_toc(buf, pos)
    p = pos + imag_toc['size_table']
    imag_ttoc = _ardf_toc(buf, p)
    p += imag_ttoc['size_table']
    meta = {}
    for entry in imag_ttoc['entries']:
        if entry['tag'] == 'TOFF' and entry.get('ptr'):
            meta.update(_parse_note(_ardf_text(buf, entry['ptr'])))
    _, size, _tag = _ardf_ptr(buf, p)                      # IDEF
    points, lines = struct.unpack_from('<II', buf, p + 16)
    title = buf[p + 120: p + 152].split(b'\x00')[0].decode('latin-1')
    p += size
    rows = []
    while p < len(buf) - 16:
        _, size, tag = _ardf_ptr(buf, p)
        if tag == 'IDAT':
            n = (size - 16) // 4
            rows.append(np.frombuffer(buf, dtype='<f4', count=n, offset=p + 16))
            p += size
        elif tag == 'IBOX':
            p += 32
        else:
            break
    if rows:
        data = np.vstack(rows)
    else:
        data = np.zeros((lines, points), dtype=np.float32)
    return title, data, meta


def _ardf_volm(buf, pos):
    """One VOLM container -> volume dict with every curve loaded."""
    volm_toc = _ardf_toc(buf, pos)
    p = pos + volm_toc['size_table']
    volm_ttoc = _ardf_toc(buf, p)
    p += volm_ttoc['size_table']
    meta = {}
    for entry in volm_ttoc['entries']:
        if entry['tag'] == 'TOFF' and entry.get('ptr'):
            meta.update(_parse_note(_ardf_text(buf, entry['ptr'])))
    _, size, _tag = _ardf_ptr(buf, p)                      # VDEF
    points, lines = struct.unpack_from('<II', buf, p + 16)
    p += size

    channel_names = []
    xdef = ''
    while p < len(buf) - 16:
        _, size, tag = _ardf_ptr(buf, p)
        if tag == 'VCHN':
            channel_names.append(buf[p + 16: p + 48].split(b'\x00')[0]
                                 .decode('latin-1'))
            p += size
        elif tag == 'XDEF':
            _, text_size = struct.unpack_from('<II', buf, p + 16)
            xdef = buf[p + 24: p + 24 + text_size].decode('latin-1',
                                                          errors='replace')
            p += size
        else:
            break

    vtoc = _ardf_toc(buf, p)
    line_ptrs = [e for e in vtoc['entries'] if e['tag'] == 'VOFF' and e.get('ptr')]

    curves = []
    seen = set()
    for entry in line_ptrs:
        for curve in _ardf_read_line(buf, entry['ptr'], len(channel_names)):
            key = (curve['line'], curve['point'])
            if key not in seen:
                seen.add(key)
                curves.append(curve)
    return {'points': points, 'lines': lines, 'channels': channel_names,
            'xdef': [s for s in xdef.split(';') if s], 'meta': meta,
            'curves': curves}


def _ardf_read_line(buf, pos, nchan):
    """Read the VSET -> VNAM -> VDAT chain starting at one line pointer.

    The chains of consecutive lines run into each other in the file, so the
    caller dedupes on (line, point) rather than this function guessing where
    a line ends.
    """
    out = []
    p = pos
    while 0 < p < len(buf) - 16:
        _, size, tag = _ardf_ptr(buf, p)
        if tag != 'VSET':
            break
        _force, line, point = struct.unpack_from('<III', buf, p + 16)
        p += size
        _, size, tag = _ardf_ptr(buf, p)
        if tag == 'VNAM':
            p += size
            _, size, tag = _ardf_ptr(buf, p)
        data = []
        seg = (0, 0, 0)
        for _ in range(nchan):
            if tag != 'VDAT':
                break
            (_f, _l, _pt, n_samples, _ftype,
             seg0, seg1, seg2) = struct.unpack_from('<8I', buf, p + 16)
            data.append(np.frombuffer(buf, dtype='<f4', count=n_samples,
                                      offset=p + 56).copy())
            seg = (seg0, seg1, seg2)
            p += size
            _, size, tag = _ardf_ptr(buf, p)
        out.append({'line': int(line), 'point': int(point),
                    'seg': [int(s) for s in seg], 'data': data})
        if tag == 'XDAT':
            p += size
            _, size, tag = _ardf_ptr(buf, p)
        if tag != 'VSET':
            break
    return out


def _read_ardf(file_path):
    """Read an .ARDF force map into the common channel-list structure.

    The instrument-computed maps (MapHeight, MapAdhesion, ...) become image
    channels; the per-pixel force curves come along as a volume dict that the
    import attaches to the first map sheet.
    """
    with open(file_path, 'rb') as fh:
        buf = fh.read()
    _, _, tag = _ardf_ptr(buf, 0)
    if tag != 'ARDF':
        raise ValueError('Not an ARDF file')

    ftoc = _ardf_toc(buf, 16)
    ttoc = _ardf_toc(buf, 16 + ftoc['size_table'])
    meta = {}
    for entry in ttoc['entries']:
        if entry['tag'] == 'TOFF' and entry.get('ptr'):
            meta.update(_parse_note(_ardf_text(buf, entry['ptr'])))

    channels = []
    taken = set()
    volume = None
    for entry in ftoc['entries']:
        if not entry.get('ptr'):
            continue
        if entry['tag'] == 'IMAG':
            title, data, _local = _ardf_imag(buf, entry['ptr'])
            name = title or f'Map{len(channels) + 1}'
            unit, factor = _ASYLUM_UNITS.get(name, ('', 1.0))
            if not unit:
                lowered = name.lower()
                if 'height' in lowered or 'zsnsr' in lowered:
                    unit, factor = 'nm', 1e9
                elif 'adhesion' in lowered or 'force' in lowered:
                    unit, factor = 'nN', 1e9
                elif 'young' in lowered or 'modulus' in lowered:
                    unit, factor = 'MPa', 1e-6
            short = _short_channel_name(name, taken)
            taken.add(short)
            channels.append({'name': short, 'source_name': name,
                             'data': np.flipud(data * factor)
                             .astype(np.float32),
                             'units': unit})
        elif entry['tag'] == 'VOLM' and volume is None:
            volume = _ardf_volm(buf, entry['ptr'])

    if volume is not None:
        volume['meta'] = {k: meta.get(k, '') for k in
                          ('SpringConstant', 'InvOLS', 'ScanSize',
                           'FastScanSize', 'SlowScanSize', 'ImagingMode',
                           'NumPtsPerSec', 'TriggerPoint')
                          if meta.get(k)}

    ny, nx = channels[0]['data'].shape if channels else (0, 0)
    nm_x = nm_y = None
    try:
        nm_x = float(meta['FastScanSize']) * 1e9 / max(nx, 1)
        nm_y = float(meta.get('SlowScanSize', meta['FastScanSize'])) \
            * 1e9 / max(ny, 1)
    except (KeyError, ValueError):
        pass

    info = {'Technique': 'AFM', 'Instrument': 'Asylum Research',
            'Mode': 'Force Map'}
    if volume:
        info['Force Curves'] = (f"{len(volume['curves'])} "
                                f"({volume['points']} x {volume['lines']} grid)")
        info['Curve Channels'] = ', '.join(volume['channels'])
    for key, label in (('SpringConstant', 'Spring Constant (N/m)'),
                       ('InvOLS', 'InvOLS (m/V)'),
                       ('ImagingMode', 'Imaging Mode')):
        if meta.get(key):
            info[label] = meta[key]
    return {'channels': channels, 'nm_per_px': nm_x, 'nm_per_px_y': nm_y,
            'info': info, 'mode': 'Force Map', 'volume': volume, 'meta': meta}


# ---------------------------------------------------------------------------
# Gwyddion .gwy / .gsf
# ---------------------------------------------------------------------------
# .gwy is a serialized GwyContainer ("GWYP" magic, then one object). An
# object is: NUL-terminated type name, uint32 payload size, then components;
# a component is: NUL-terminated name, one type character, value. Atomic
# types: b (uint8 bool), c (char), i (int32), q (int64), d (double),
# s (NUL-terminated string), o (object); the uppercase letters are arrays of
# the same, prefixed with a uint32 item count. All little-endian, per the
# published format spec in the Gwyddion user guide.

# Gwyddion z-unit string -> (display unit, factor). Values in a GwyDataField
# are in base SI units, same as the Asylum channels.
_GWY_Z_UNITS = {'m': ('nm', 1e9), 'A': ('nA', 1e9), 'V': ('V', 1.0),
                'deg': ('deg', 1.0), 'N': ('nN', 1e9), 'Pa': ('MPa', 1e-6),
                'Hz': ('Hz', 1.0), 'F': ('F', 1.0), 'W': ('W', 1.0),
                'A/m': ('A/m', 1.0), 's': ('s', 1.0)}


def _gwy_component(buf, pos):
    """Parse one component at ``pos``; return (name, value, new_pos).

    Objects come back as dicts carrying their type name in '_type'; arrays
    of objects as lists of such dicts.
    """
    end = buf.index(b'\x00', pos)
    name = buf[pos:end].decode('utf-8', errors='replace')
    pos = end + 1
    ctype = chr(buf[pos])
    pos += 1

    def _string(p):
        e = buf.index(b'\x00', p)
        return buf[p:e].decode('utf-8', errors='replace'), e + 1

    if ctype == 'b':
        return name, bool(buf[pos]), pos + 1
    if ctype == 'c':
        return name, chr(buf[pos]), pos + 1
    if ctype == 'i':
        return name, struct.unpack_from('<i', buf, pos)[0], pos + 4
    if ctype == 'q':
        return name, struct.unpack_from('<q', buf, pos)[0], pos + 8
    if ctype == 'd':
        return name, struct.unpack_from('<d', buf, pos)[0], pos + 8
    if ctype == 's':
        value, pos = _string(pos)
        return name, value, pos
    if ctype == 'o':
        value, pos = _gwy_object(buf, pos)
        return name, value, pos
    if ctype in 'CIQD':
        count = struct.unpack_from('<I', buf, pos)[0]
        pos += 4
        fmt, size = {'C': ('<B', 1), 'I': ('<i', 4),
                     'Q': ('<q', 8), 'D': ('<d', 8)}[ctype]
        dtype = {'C': '<u1', 'I': '<i4', 'Q': '<i8', 'D': '<f8'}[ctype]
        value = np.frombuffer(buf, dtype=dtype, count=count, offset=pos)
        return name, value, pos + count * size
    if ctype == 'S':
        count = struct.unpack_from('<I', buf, pos)[0]
        pos += 4
        values = []
        for _ in range(count):
            v, pos = _string(pos)
            values.append(v)
        return name, values, pos
    if ctype == 'O':
        count = struct.unpack_from('<I', buf, pos)[0]
        pos += 4
        values = []
        for _ in range(count):
            v, pos = _gwy_object(buf, pos)
            values.append(v)
        return name, values, pos
    raise ValueError(f'Unknown GWY component type {ctype!r} at {pos}')


def _gwy_object(buf, pos):
    """Parse one serialized object at ``pos``; return (dict, new_pos)."""
    end = buf.index(b'\x00', pos)
    type_name = buf[pos:end].decode('utf-8', errors='replace')
    pos = end + 1
    size = struct.unpack_from('<I', buf, pos)[0]
    pos += 4
    stop = pos + size
    obj = {'_type': type_name}
    while pos < stop:
        name, value, pos = _gwy_component(buf, pos)
        obj[name] = value
    return obj, stop


def _gwy_unit(field, key):
    unit = field.get(key)
    if isinstance(unit, dict):
        return str(unit.get('unitstr', '') or '')
    return ''


def _read_gwy(file_path):
    """Read a Gwyddion .gwy container into the common channel-list structure.

    Every image channel ('/N/data' GwyDataField) becomes a channel. One .gwy
    can hold completely unrelated scans, so the calibration is per channel,
    not per file.
    """
    import re
    with open(file_path, 'rb') as fh:
        buf = fh.read()
    if buf[:4] != b'GWYP':
        raise ValueError('Not a Gwyddion .gwy file (v2 GWYP magic missing)')
    container, _ = _gwy_object(buf, 4)

    fields = {}
    for key, value in container.items():
        match = re.match(r'^/(\d+)/data$', key)
        if match and isinstance(value, dict) \
                and value.get('_type') == 'GwyDataField':
            fields[int(match.group(1))] = value

    channels = []
    taken = set()
    for index in sorted(fields):
        field = fields[index]
        xres = int(field.get('xres', 0))
        yres = int(field.get('yres', 0))
        data = field.get('data')
        if not xres or not yres or data is None or len(data) != xres * yres:
            continue
        title = str(container.get(f'/{index}/data/title', '')
                    or f'Channel{index + 1}')
        z_unit = _gwy_unit(field, 'si_unit_z')
        unit, factor = _GWY_Z_UNITS.get(z_unit, (z_unit, 1.0))
        # Gwyddion's data origin is the top-left corner, matching the shared
        # origin='upper' rendering — no flip needed.
        array = (np.asarray(data, dtype=np.float64).reshape(yres, xres)
                 * factor).astype(np.float32)

        nm_x = nm_y = None
        xy_unit = _gwy_unit(field, 'si_unit_xy')
        if xy_unit == 'm':
            xreal = float(field.get('xreal', 0.0) or 0.0)
            yreal = float(field.get('yreal', 0.0) or 0.0)
            nm_x = xreal * 1e9 / xres if xreal else None
            nm_y = yreal * 1e9 / yres if yreal else None

        base = title.replace(' ', '') or f'Channel{index + 1}'
        short = base
        counter = 2
        while short in taken:
            short = f'{base}{counter}'
            counter += 1
        taken.add(short)
        channels.append({'name': short, 'source_name': title, 'data': array,
                         'units': unit, 'nm_per_px': nm_x, 'nm_per_px_y': nm_y})

    info = {'Technique': 'AFM', 'Instrument': 'Gwyddion file',
            'Mode': 'SPM (Gwyddion)'}
    first = channels[0] if channels else {}
    return {'channels': channels,
            'nm_per_px': first.get('nm_per_px'),
            'nm_per_px_y': first.get('nm_per_px_y'),
            'info': info, 'mode': 'SPM (Gwyddion)', 'volume': None,
            'meta': {}}


def _read_gsf(file_path):
    """Read a Gwyddion Simple Field .gsf into the common structure.

    Format: 'Gwyddion Simple Field 1.0' magic line, 'Name = value' text
    header, NUL padding to a multiple of 4 bytes, then XRes*YRes little-
    endian float32 values, top row first.
    """
    with open(file_path, 'rb') as fh:
        buf = fh.read()
    magic = b'Gwyddion Simple Field 1.0\n'
    if not buf.startswith(magic):
        raise ValueError('Not a Gwyddion Simple Field (.gsf) file')
    nul = buf.index(b'\x00')
    header = {}
    for line in buf[len(magic):nul].decode('utf-8', errors='replace').split('\n'):
        if '=' in line:
            key, _, value = line.partition('=')
            header[key.strip()] = value.strip()
    data_start = (nul // 4 + 1) * 4

    xres = int(header['XRes'])
    yres = int(header['YRes'])
    z_unit = header.get('ZUnits', '')
    unit, factor = _GWY_Z_UNITS.get(z_unit, (z_unit, 1.0))
    array = (np.frombuffer(buf, dtype='<f4', count=xres * yres,
                           offset=data_start).reshape(yres, xres)
             .astype(np.float64) * factor).astype(np.float32)

    nm_x = nm_y = None
    if header.get('XYUnits', 'm') == 'm':
        try:
            nm_x = float(header['XReal']) * 1e9 / xres
            nm_y = float(header.get('YReal', header['XReal'])) * 1e9 / yres
        except (KeyError, ValueError):
            pass

    title = header.get('Title', '') or 'Topography'
    info = {'Technique': 'AFM', 'Instrument': 'Gwyddion file',
            'Mode': 'SPM (Gwyddion)'}
    channels = [{'name': title.replace(' ', ''), 'source_name': title,
                 'data': array, 'units': unit,
                 'nm_per_px': nm_x, 'nm_per_px_y': nm_y}]
    return {'channels': channels, 'nm_per_px': nm_x, 'nm_per_px_y': nm_y,
            'info': info, 'mode': 'SPM (Gwyddion)', 'volume': None,
            'meta': dict(header)}


# ---------------------------------------------------------------------------
# Velox .emd scanned images (STM / STEM)
# ---------------------------------------------------------------------------
# A Velox .emd is an HDF5 container: each scanned image sits in
# 'Data/Image/<uid>/Data' as (y, x, frame) with a JSON metadata document in a
# uint8 dataset beside it. A scanning-probe image — an STM topograph, a STEM
# detector map — is a raster of one signal per pixel with an isotropic pixel
# size, which is exactly an AFM channel map, so each detector of the file
# becomes an AFM channel here rather than going through the TEM importer.
#
# The same extension is also used for EDX spectrum images; those hold a
# 'SpectrumStream' and no image, and belong to File > Import > EDX.

# Velox writes the acquisition time as a Unix epoch second count, in a string.
def _emd_datetime(meta):
    import datetime
    stamp = ((meta.get('Acquisition') or {})
             .get('AcquisitionStartDatetime') or {}).get('DateTime')
    try:
        seconds = int(str(stamp))
    except (TypeError, ValueError):
        return ''
    if seconds <= 0:
        return ''
    return datetime.datetime.fromtimestamp(seconds).strftime('%Y-%m-%d %H:%M')


def _emd_detector(meta):
    """The detector block behind this image, by the index BinaryResult names."""
    binary = meta.get('BinaryResult') or {}
    index = binary.get('DetectorIndex')
    detectors = meta.get('Detectors') or {}
    entry = detectors.get(f'Detector-{index}')
    if isinstance(entry, dict):
        return entry
    name = str(binary.get('Detector') or '')
    for entry in detectors.values():
        if isinstance(entry, dict) and str(entry.get('DetectorName')) == name:
            return entry
    return {}


def _read_emd(file_path):
    """Read the scanned images of a Velox .emd into the common structure."""
    if not HAS_H5PY:
        raise ValueError('Reading .emd files needs h5py, which is not '
                         'installed in this Python')
    from libraries.EMD_Reader import _number, _open_emd, read_metadata

    channels = []
    taken = set()
    file_meta = {}
    with _open_emd(file_path) as f:
        images = f['Data']['Image'] if ('Data' in f and 'Image' in f['Data']) \
            else None
        if images is None:
            raise ValueError(
                'This .emd holds no scanned image. An EDX spectrum image is '
                'imported through File > Import > EDX instead.')

        for uid in images:
            entry = images[uid]
            if not isinstance(entry, h5py.Group) or 'Data' not in entry:
                continue
            raw = entry['Data']
            if raw.ndim < 2 or not raw.size:
                continue
            meta = read_metadata(entry)
            binary = meta.get('BinaryResult') or {}
            if not file_meta:
                file_meta = meta

            # (y, x, frame): a multi-frame capture is a drift-corrected series
            # of the same field, so the channel is their average — what Velox
            # itself shows for the stack.
            frames = int(raw.shape[2]) if raw.ndim == 3 else 1
            if raw.ndim == 3:
                data = (np.asarray(raw[:, :, 0], dtype=np.float64) if frames == 1
                        else np.asarray(raw, dtype=np.float64).mean(axis=2))
            else:
                data = np.asarray(raw, dtype=np.float64)

            detector = _emd_detector(meta)
            name = (str(binary.get('Detector') or '')
                    or str(detector.get('DetectorName') or '')
                    or f'Image{len(channels) + 1}')
            # A scanning detector reports a raw count per pixel; anything
            # reconstructed (iDPC, dDPC) is in arbitrary units of its own.
            unit = 'counts'
            if 'Scanning' not in str(detector.get('DetectorType', 'Scanning')):
                unit = ''

            nm_x = nm_y = None
            pixel = binary.get('PixelSize') or {}
            if str(binary.get('PixelUnitX', 'm')).lower() == 'm':
                nm_x = _number(pixel.get('width'), 0.0) * 1e9 or None
                nm_y = _number(pixel.get('height'), 0.0) * 1e9 or nm_x

            short = _short_channel_name(name, taken)
            base = short
            counter = 2
            while short in taken:
                short = f'{base}{counter}'
                counter += 1
            taken.add(short)
            # Velox rasters from the top-left corner, the same origin the
            # shared origin='upper' rendering assumes — no flip needed.
            channels.append({'name': short, 'source_name': name,
                             'data': data.astype(np.float32), 'units': unit,
                             'nm_per_px': nm_x, 'nm_per_px_y': nm_y,
                             'frames': frames})

    if not channels:
        raise ValueError('No image data found in this .emd file')

    instrument = file_meta.get('Instrument') or {}
    maker = ' '.join(str(instrument.get(key, '') or '') for key in
                     ('Manufacturer', 'InstrumentModel')).strip()
    detector_names = ', '.join(c['source_name'] for c in channels)
    mode = f"Scanning image ({channels[0]['source_name']})"

    info = {'Technique': 'AFM', 'Instrument': maker or 'Velox EMD',
            'Mode': mode, 'Detector': detector_names}
    optics = file_meta.get('Optics') or {}
    scan = file_meta.get('Scan') or {}
    voltage = _number(optics.get('AccelerationVoltage'), 0.0)
    if voltage:
        info['Acceleration Voltage'] = f'{voltage / 1000:.0f} kV'
    dwell = _number(scan.get('DwellTime'), 0.0)
    if dwell:
        info['Dwell Time'] = f'{dwell * 1e6:.3g} µs'
    rotation = _number(scan.get('ScanRotation'), 0.0)
    if rotation:
        info['Scan Rotation'] = f'{np.degrees(rotation):.4g}°'
    if channels[0]['frames'] > 1:
        info['Frames'] = str(channels[0]['frames'])
    sample = (file_meta.get('Sample') or {}).get('SampleId')
    if sample:
        info['Sample'] = str(sample)
    when = _emd_datetime(file_meta)
    if when:
        info['Date'] = when

    first = channels[0]
    return {'channels': channels, 'nm_per_px': first['nm_per_px'],
            'nm_per_px_y': first['nm_per_px_y'], 'info': info, 'mode': mode,
            'volume': None, 'meta': {}}


# ---------------------------------------------------------------------------
# Format detection and the common reader
# ---------------------------------------------------------------------------

_HDF5_MAGIC = b'\x89HDF\r\n\x1a\n'


def sniff_afm_format(file_path):
    """'ibw', 'nanoscope', 'ardf', 'gwy', 'gsf', 'emd' or None — by content,
    not extension.

    Bruker numbers its files (.001, .002, ...) so the extension alone cannot
    be trusted; all the vendor formats start with unmistakable magic. The
    exception is the Velox .emd, which is a plain HDF5 file like several other
    things this program reads, so there the extension does have to agree.
    """
    try:
        with open(file_path, 'rb') as fh:
            head = fh.read(32)
    except OSError:
        return None
    if len(head) >= 12 and head[8:12] == b'ARDF':
        return 'ardf'
    if head.startswith(b'\\*File list'):
        return 'nanoscope'
    if head.startswith(b'GWYP'):
        return 'gwy'
    if head.startswith(b'Gwyddion Simple Field 1.0'):
        return 'gsf'
    if head.startswith(_HDF5_MAGIC) and \
            os.path.splitext(file_path)[1].lower() == '.emd':
        return 'emd'
    if len(head) >= 2 and struct.unpack_from('<h', head, 0)[0] == 5:
        return 'ibw'
    return None


def read_afm_file(file_path):
    """Load any supported AFM file into the common structure.

    Returns a dict with 'channels' (list of {'name', 'data', 'units'}),
    'nm_per_px' / 'nm_per_px_y', 'info', 'mode' and, for force maps,
    'volume'.
    """
    kind = sniff_afm_format(file_path)
    if kind == 'ibw':
        result = _read_asylum_ibw(file_path)
    elif kind == 'nanoscope':
        result = _read_nanoscope(file_path)
    elif kind == 'ardf':
        result = _read_ardf(file_path)
    elif kind == 'gwy':
        result = _read_gwy(file_path)
    elif kind == 'gsf':
        result = _read_gsf(file_path)
    elif kind == 'emd':
        result = _read_emd(file_path)
    else:
        raise ValueError('Unrecognised AFM file (expected an Asylum .ibw, '
                         'a Bruker Nanoscope .spm/.00x, an Asylum .ARDF, '
                         'a Gwyddion .gwy/.gsf or a Velox .emd)')
    if not result['channels']:
        raise ValueError('No image channels found in this file')

    info = result['info']
    first = result['channels'][0]['data']
    info['Image Size'] = f'{first.shape[1]} x {first.shape[0]} px'
    info['Channels'] = ', '.join(c['name'] for c in result['channels'])
    nm = result['nm_per_px']
    if nm:
        info['Pixel Size'] = f'{nm:.4g} nm'
        info['Scan Size'] = (f'{first.shape[1] * nm / 1000:.3g} x '
                             f"{first.shape[0] * (result['nm_per_px_y'] or nm) / 1000:.3g} µm")
    return result


# ---------------------------------------------------------------------------
# Data-model helpers
# ---------------------------------------------------------------------------

# Channel names that mean "this is *the* map" rather than one signal among
# several. Such a channel is the technique's base sheet and is named plainly
# 'AFM', the way the base EIS sweep is 'EIS' — the '~' suffix is reserved for
# the derived views ('AFM~3D', 'AFM~Profile') so each gets its own Sample
# Manager column.
_PLAIN_CHANNELS = ('topography',)


def afm_sheet_name(channel_name, plain=False):
    """Sheet name for a channel: 'AFM' for the topography map, else 'AFM~<Channel>'.

    ``plain`` forces the bare name — the importer uses it for the file's
    height channel, whatever the instrument happened to call it
    ('HeightRetrace', 'Topography', 'Z'), so the scan itself is 'AFM' and the
    '~' names are kept for the other signals and the derived views.
    """
    if plain or str(channel_name).strip().lower() in _PLAIN_CHANNELS:
        return 'AFM'
    return f'AFM~{channel_name}'


def make_afm_sheet(channel_name, array, units='', nm_per_px=None,
                   nm_per_px_y=None, exp_info=None, source_file='',
                   channel_source='', mode='', plain=False):
    """Build the standard AFM sheet dict for one channel."""
    array = np.asarray(array, dtype=np.float32)
    name = afm_sheet_name(channel_name, plain)
    return name, {
        'Name': name,
        '_afm': True,
        '_afm_kind': 'map',
        '_afm_image': array,
        'AFM_Channel': str(channel_source or channel_name),
        'AFM_Units': str(units or ''),
        'AFM_Mode': str(mode or ''),
        'AFM_NM_Per_Px': float(nm_per_px) if nm_per_px else None,
        'AFM_NM_Per_Px_Y': float(nm_per_px_y) if nm_per_px_y else None,
        'AFM_Scale_Source': 'metadata' if nm_per_px else 'uncalibrated',
        'AFM_Source_File': os.path.basename(source_file),
        'AFM_Source_Path': str(source_file),
        'AFM_Level': None,                # leveling applied by the tool
        'ExperimentalInfo': dict(exp_info) if exp_info else {'Technique': 'AFM'},
    }


def make_afm_scalar_sheet(name, values, units, nm_per_px, source_sheet, label,
                          cmap='viridis', exp_info=None):
    """Build a derived AFM map (adhesion, stiffness, ...) computed by a tool."""
    values = np.asarray(values, dtype=np.float32)
    info = {'Technique': 'AFM', 'Content': str(label),
            'Source Sheet': source_sheet}
    if exp_info:
        info.update(exp_info)
    sheet_name = f'AFM~{name}'
    return sheet_name, {
        'Name': sheet_name,
        '_afm': True,
        '_afm_kind': 'map',
        '_afm_image': values,
        'AFM_Channel': str(name),
        'AFM_Units': str(units or ''),
        'AFM_NM_Per_Px': float(nm_per_px) if nm_per_px else None,
        'AFM_Scale_Source': 'computed',
        'AFM_Derived_From': source_sheet,
        'AFM_Scalar_CMap': str(cmap),
        'AFM_Level': None,
        'ExperimentalInfo': info,
    }


# ---------------------------------------------------------------------------
# The 3D surface sheet
# ---------------------------------------------------------------------------

AFM_3D_SHEET = 'AFM~3D'

# elev/azim are the matplotlib view angles, zscale the height exaggeration
# (1.0 = the box is a third as tall as it is wide), mesh the largest surface
# grid the renderer will build, 'auto' cmap = whatever the source channel is
# drawn with on the 2D map.
AFM_3D_DEFAULTS = {'source': '', 'elev': 45.0, 'azim': -60.0, 'zscale': 1.0,
                   'cmap': 'auto', 'shade': True, 'mesh': 200}

# Channel names a 3D surface is worth building from: relief is what a surface
# renders, so height — not phase, amplitude or current — is the default source.
_TOPO_HINTS = ('topograph', 'height', 'zsensor', 'zsnsr')


def topography_index(channels):
    """Index of the channel a 3D surface should be built from.

    The height channel by name, then the first channel measured in nm, then
    simply the first — a file that names nothing recognisably still gets a
    surface, and the 3D tab can re-point it.
    """
    for i, channel in enumerate(channels):
        if any(h in str(channel.get('name', '')).lower() for h in _TOPO_HINTS):
            return i
    for i, channel in enumerate(channels):
        if str(channel.get('units', '')) == 'nm':
            return i
    return 0


def make_afm_3d_sheet(source_name, source_sheet, options=None):
    """Build the 'AFM~3D' surface companion of a channel map.

    The surface is rendered from the *source* channel whenever it is still in
    the project, so leveling, recalibration and a colour-map change reach the
    3D view without touching this sheet. The array carried here is the
    fallback that keeps the sheet standing on its own — and is what the
    project file stores, so a 3D sheet whose source was deleted still draws.
    """
    view = dict(AFM_3D_DEFAULTS)
    view.update(options or {})
    view['source'] = str(source_name)
    info = {'Technique': 'AFM', 'Content': '3D surface',
            'Source Sheet': str(source_name)}
    for key, value in (source_sheet.get('ExperimentalInfo') or {}).items():
        info.setdefault(key, value)
    return AFM_3D_SHEET, {
        'Name': AFM_3D_SHEET,
        '_afm': True,
        '_afm_kind': '3d',
        '_afm_image': np.asarray(source_sheet.get('_afm_image'),
                                 dtype=np.float32),
        'AFM_Channel': str(source_sheet.get('AFM_Channel', '')),
        'AFM_Units': str(source_sheet.get('AFM_Units', '')),
        'AFM_Mode': str(source_sheet.get('AFM_Mode', '')),
        'AFM_NM_Per_Px': source_sheet.get('AFM_NM_Per_Px'),
        'AFM_NM_Per_Px_Y': source_sheet.get('AFM_NM_Per_Px_Y'),
        'AFM_Scale_Source': source_sheet.get('AFM_Scale_Source', ''),
        'AFM_Source_File': source_sheet.get('AFM_Source_File', ''),
        'AFM_Source_Path': source_sheet.get('AFM_Source_Path', ''),
        'AFM_Source_Sheet': str(source_name),
        'AFM_3D': view,
        'AFM_Level': None,
        'ExperimentalInfo': info,
    }


def is_afm_3d(sheet):
    """True for the 'AFM~3D' surface sheets."""
    return bool(isinstance(sheet, dict) and sheet.get('_afm_kind') == '3d')


def afm_array(sheet):
    """The sheet's channel map as a 2-D numpy array (leveled view), or None.

    No recipe means no correction: a freshly imported scan is shown exactly
    as the instrument recorded it. The Level tab arrives with the usual
    recipe *selected* — plane plus median-of-differences plus a zero
    reference — but nothing is subtracted until it is applied, so what is on
    screen is never a correction nobody asked for.
    """
    array = sheet.get('_afm_image')
    if array is None:
        return None
    array = np.asarray(array)
    # The crop comes first: levelling a cropped image fits the background to
    # the part being kept, which is the whole point of cropping to a clean
    # patch. Stored in pixels of the *original* image, so repeated crops
    # compose (the same convention as SEM_Crop).
    crop = sheet.get('AFM_Crop')
    if crop and len(crop) == 4:
        x0, y0, x1, y1 = [int(v) for v in crop]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(array.shape[1], x1), min(array.shape[0], y1)
        if x1 - x0 >= 2 and y1 - y0 >= 2:
            array = array[y0:y1, x0:x1]
    try:
        from libraries.ToolsMenu.AFM_Engine import apply_level
        level = sheet.get('AFM_Level')
        if level:
            array = apply_level(array, level)
    except Exception:
        pass
    return array


def afm_shape(sheet):
    """(height, width) of the array as displayed — after any crop."""
    array = sheet.get('_afm_image')
    if array is None:
        return None
    height, width = np.asarray(array).shape[:2]
    crop = sheet.get('AFM_Crop')
    if crop and len(crop) == 4:
        x0, y0, x1, y1 = [int(v) for v in crop]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(width, x1), min(height, y1)
        if x1 - x0 >= 2 and y1 - y0 >= 2:
            return y1 - y0, x1 - x0
    return height, width


def afm_extent(sheet):
    """matplotlib ``extent`` for the sheet plus its unit label.

    [0, W, H, 0] in µm (nm when the field is under 2 µm), pixels when
    uncalibrated — same conventions as the SEM/TEM sheets. Measured on the
    displayed array, so a cropped image reports the field it actually shows
    while the pixel size (and so every measurement) stays untouched.
    """
    shape = afm_shape(sheet)
    if shape is None:
        return None, 'px'
    height, width = shape
    nm = sheet.get('AFM_NM_Per_Px')
    if not nm:
        return [0, width, height, 0], 'px'
    nm_y = sheet.get('AFM_NM_Per_Px_Y') or nm
    if width * nm > 2000.0:
        return [0, width * nm / 1000.0, height * nm_y / 1000.0, 0], 'µm'
    return [0, width * nm, height * nm_y, 0], 'nm'


# ---------------------------------------------------------------------------
# Project persistence
#
# Identical routing to the SEM/TEM images: the pixel array never goes into
# the project JSON (2-decimal rounding would corrupt it and bloat the file).
#
#   .kfit  -> embedded in the project HDF5 under 'afm_images/<sheet>'
#   .xlsx  -> the companion <project>.hdf5 shared with ARPES/EDX/EELS/SEM/TEM,
#             under a '/AFM/<sheet>' group
#
# A force volume rides along as a 'volume' subgroup of its sheet, unless it
# is too large to embed, in which case it is reloaded from the source .ARDF.
# ---------------------------------------------------------------------------

def afm_h5_path(project_path):
    """Companion HDF5 path, shared with the other techniques: <project>.hdf5."""
    return os.path.splitext(project_path)[0] + '.hdf5'


def _afm_sheets(core_levels):
    return {n: s for n, s in core_levels.items()
            if isinstance(s, dict) and s.get('_afm')
            and s.get('_afm_image') is not None}


def _write_volume_group(group, volume):
    """Write a force volume as datasets (curves padded to a common length)."""
    import json
    curves = volume.get('curves') or []
    nchan = len(volume.get('channels') or [])
    if not curves or not nchan:
        return
    max_len = max((len(d) for c in curves for d in c['data']), default=0)
    total = len(curves) * nchan * max_len
    if not max_len or total > _VOLUME_EMBED_LIMIT:
        group.attrs['volume_external'] = True
        return
    data = np.full((len(curves), nchan, max_len), np.nan, dtype=np.float32)
    index = np.zeros((len(curves), 2), dtype=np.int32)
    seg = np.zeros((len(curves), 3), dtype=np.int64)
    for i, curve in enumerate(curves):
        index[i] = (curve['line'], curve['point'])
        seg[i] = curve['seg']
        for j, values in enumerate(curve['data'][:nchan]):
            data[i, j, :len(values)] = values
    vol = group.create_group('volume')
    vol.create_dataset('data', data=data, compression='gzip',
                       compression_opts=4)
    vol.create_dataset('index', data=index)
    vol.create_dataset('seg', data=seg)
    vol.attrs['points'] = int(volume.get('points', 0))
    vol.attrs['lines'] = int(volume.get('lines', 0))
    vol.attrs['channels'] = json.dumps(volume.get('channels') or [])
    vol.attrs['xdef'] = json.dumps(volume.get('xdef') or [])
    vol.attrs['meta'] = json.dumps(volume.get('meta') or {})


def _read_volume_group(vol):
    """Restore a force volume written by ``_write_volume_group``."""
    import json
    data = np.asarray(vol['data'][()])
    index = np.asarray(vol['index'][()])
    seg = np.asarray(vol['seg'][()])
    curves = []
    for i in range(data.shape[0]):
        arrays = []
        for j in range(data.shape[1]):
            values = data[i, j]
            valid = np.isfinite(values)
            arrays.append(values[: int(valid.sum())] if valid.any() else values[:0])
        curves.append({'line': int(index[i, 0]), 'point': int(index[i, 1]),
                       'seg': [int(s) for s in seg[i]], 'data': arrays})
    return {'points': int(vol.attrs.get('points', 0)),
            'lines': int(vol.attrs.get('lines', 0)),
            'channels': json.loads(vol.attrs.get('channels', '[]')),
            'xdef': json.loads(vol.attrs.get('xdef', '[]')),
            'meta': json.loads(vol.attrs.get('meta', '{}')),
            'curves': curves}


def _write_sheet_group(parent, name, sheet):
    """Write one AFM sheet's binary data as a group of datasets.

    The calibration and every measured number live here rather than in the
    JSON because ``convert_to_serializable_and_round`` rounds to 2 dp — an
    Sa of 0.098 nm would come back as 0.1.
    """
    import json
    group = parent.create_group(name)
    group.attrs['kind'] = str(sheet.get('_afm_kind') or 'map')
    group.create_dataset('image', data=np.asarray(sheet['_afm_image']),
                         compression='gzip', compression_opts=4)
    overlay = sheet.get('_afm_overlay')
    if overlay is not None:
        group.create_dataset('overlay', data=np.asarray(overlay, dtype=np.uint8),
                             compression='gzip', compression_opts=4)
    if sheet.get('AFM_NM_Per_Px'):
        group.attrs['nm_per_px'] = float(sheet['AFM_NM_Per_Px'])
    if sheet.get('AFM_NM_Per_Px_Y'):
        group.attrs['nm_per_px_y'] = float(sheet['AFM_NM_Per_Px_Y'])
    for key in _AFM_SCALAR_ATTRS:
        value = sheet.get(key)
        if value is not None:
            group.attrs[key] = (float(value) if isinstance(value, (int, float))
                                and not isinstance(value, bool) else str(value))
    for key in _AFM_JSON_ATTRS:
        value = sheet.get(key)
        if value:
            try:
                group.attrs[_json_attr(key)] = json.dumps(value)
            except (TypeError, ValueError):
                pass
    volume = sheet.get('_afm_volume')
    if volume:
        try:
            _write_volume_group(group, volume)
        except Exception as e:
            print(f'AFM volume save skipped: {e}')
    return group


def _read_sheet_group(group, sheet):
    """Restore one AFM sheet's binary data written by ``_write_sheet_group``."""
    import json
    sheet['_afm_image'] = np.asarray(group['image'][()])
    if 'overlay' in group:
        sheet['_afm_overlay'] = np.asarray(group['overlay'][()], dtype=bool)
    sheet['_afm'] = True
    kind = group.attrs.get('kind')
    if isinstance(kind, bytes):
        kind = kind.decode('utf-8')
    sheet['_afm_kind'] = str(kind) if kind else sheet.get('_afm_kind') or 'map'
    sheet.pop('_afm_h5', None)
    if 'nm_per_px' in group.attrs:
        sheet['AFM_NM_Per_Px'] = float(group.attrs['nm_per_px'])
    if 'nm_per_px_y' in group.attrs:
        sheet['AFM_NM_Per_Px_Y'] = float(group.attrs['nm_per_px_y'])
    for key in _AFM_SCALAR_ATTRS:
        if key not in group.attrs:
            continue
        value = group.attrs[key]
        if isinstance(value, bytes):
            value = value.decode('utf-8')
        sheet[key] = str(value)
    for key in _AFM_JSON_ATTRS:
        attr = _json_attr(key)
        if attr not in group.attrs:
            continue
        raw = group.attrs[attr]
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8')
        try:
            sheet[key] = json.loads(raw)
        except (TypeError, ValueError):
            pass
    if 'volume' in group:
        try:
            sheet['_afm_volume'] = _read_volume_group(group['volume'])
        except Exception as e:
            print(f'AFM volume restore skipped: {e}')
    elif group.attrs.get('volume_external') and sheet.get('AFM_Source_Path'):
        # Too large to embed: reload the curves from the source .ARDF when
        # it is still where it was.
        path = sheet.get('AFM_Source_Path')
        if path and os.path.exists(path):
            try:
                sheet['_afm_volume'] = _read_ardf(path)['volume']
            except Exception as e:
                print(f'AFM volume reload skipped: {e}')


def strip_afm_arrays_for_json(core_levels_serialised):
    """Replace each AFM sheet's arrays with an '_afm_h5' marker.

    Operates in place on an already-serialisable copy — never on live
    window.Data, which must keep its arrays.
    """
    for sheet in core_levels_serialised.values():
        if isinstance(sheet, dict) and sheet.get('_afm'):
            for key in _AFM_ARRAY_KEYS:
                sheet.pop(key, None)
            sheet['_afm_h5'] = True


def save_afm_companion(core_levels, project_path):
    """Write every AFM channel map into '/AFM/<sheet>' of the project .hdf5."""
    if not HAS_H5PY:
        return 0
    sheets = _afm_sheets(core_levels)
    path = afm_h5_path(project_path)
    if not sheets:
        if os.path.exists(path):
            try:
                with h5py.File(path, 'a') as f:
                    if _AFM_H5_GROUP in f:
                        del f[_AFM_H5_GROUP]
            except Exception:
                pass
        return 0
    with h5py.File(path, 'a') as f:
        if _AFM_H5_GROUP in f:
            del f[_AFM_H5_GROUP]
        root = f.create_group(_AFM_H5_GROUP)
        for name, sheet in sheets.items():
            _write_sheet_group(root, name, sheet)
    return len(sheets)


def route_afm_for_json(core_levels, json_data, file_path, console=None):
    """Save AFM maps to the companion .hdf5 and strip them out of ``json_data``.

    Returns the (possibly new) json_data dict. Used by the .xlsx save paths,
    which each build their own json_data copy.
    """
    try:
        count = save_afm_companion(core_levels, file_path)
        if not count:
            return json_data
        core = {k: (dict(v) if isinstance(v, dict) and v.get('_afm') else v)
                for k, v in json_data.get('Core levels', {}).items()}
        strip_afm_arrays_for_json(core)
        json_data = dict(json_data)
        json_data['Core levels'] = core
        if console:
            console(f"Saved {count} AFM channel map(s) to companion .hdf5")
    except Exception as e:
        print(f"AFM companion save skipped: {e}")
    return json_data


def write_afm_into_h5(h5file, core_levels):
    """Embed AFM maps directly in an open .kfit file (already HDF5)."""
    sheets = _afm_sheets(core_levels)
    if not sheets:
        return 0
    grp = h5file.create_group('afm_images')
    for name, sheet in sheets.items():
        _write_sheet_group(grp, name, sheet)
    return len(sheets)


def read_afm_from_h5(h5file, core_levels):
    """Restore AFM maps embedded in an open .kfit file."""
    if 'afm_images' not in h5file:
        return []
    restored = []
    for name in h5file['afm_images']:
        sheet = core_levels.get(name)
        if not isinstance(sheet, dict):
            sheet = {'Name': name, '_afm': True}
            core_levels[name] = sheet
        _read_sheet_group(h5file['afm_images'][name], sheet)
        restored.append(name)
    return restored


def load_afm_companion(core_levels, project_path):
    """Restore AFM maps from the companion .hdf5. Returns restored names."""
    path = afm_h5_path(project_path)
    if not HAS_H5PY or not os.path.exists(path):
        return []
    restored = []
    with h5py.File(path, 'r') as f:
        if _AFM_H5_GROUP not in f:
            return []
        for name in f[_AFM_H5_GROUP]:
            sheet = core_levels.get(name)
            if not isinstance(sheet, dict):
                sheet = {'Name': name, '_afm': True}
                core_levels[name] = sheet
            _read_sheet_group(f[_AFM_H5_GROUP][name], sheet)
            restored.append(name)
    return restored


# ---------------------------------------------------------------------------
# Import entry point
# ---------------------------------------------------------------------------

def register_afm_sheet(window, sheet_name, sheet):
    """Insert an AFM sheet into window.Data and add it to the combobox."""
    if 'Core levels' not in window.Data:
        window.Data['Core levels'] = {}

    base = sheet_name
    counter = 2
    while sheet_name in window.Data['Core levels']:
        sheet_name = f'{base}{counter}'
        counter += 1
    sheet['Name'] = sheet_name
    window.Data['Core levels'][sheet_name] = sheet
    window.Data['Number of Core levels'] = len(window.Data['Core levels'])

    try:
        if sheet_name not in list(window.sheet_combobox.GetStrings()):
            window.sheet_combobox.Append(sheet_name)
        window.sheet_combobox.SetStringSelection(sheet_name)
    except Exception:
        pass
    return sheet_name


def start_fresh_for_afm(window):
    """An AFM import starts a new project; offer to save whatever is open first.

    Same reasoning as the SEM/TEM imports: an image sheet shares nothing with
    the spectra it would sit beside. Returns False if the user cancels.
    """
    try:
        if not window.Data.get('Core levels'):
            return True
    except AttributeError:
        return True
    try:
        from libraries.Widgets_Toolbars import on_new
        return on_new(window) is not False
    except Exception:
        return True


def import_afm_file(window, file_path=None):
    """File > Import > AFM... — load every channel of a file as an AFM sheet.

    ``file_path`` skips the dialog — used by the drag-and-drop route, where
    the file is already chosen."""
    if file_path is None:
        with wx.FileDialog(window, "Open AFM file", wildcard=AFM_WILDCARD,
                           style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dialog:
            if dialog.ShowModal() == wx.ID_CANCEL:
                return None
            file_path = dialog.GetPath()

    if not start_fresh_for_afm(window):
        return None

    try:
        result = read_afm_file(file_path)
    except Exception as e:
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Could not read the file:\n{e}", "AFM Import",
                      wx.OK | wx.ICON_ERROR)
        return None

    registered = []
    first_sheet = None
    # The scan itself is 'AFM'; the other signals are 'AFM~Phase' and so on.
    # Which channel *is* the scan is the same question the 3D surface asks.
    try:
        topo_index = topography_index(result['channels'])
    except Exception:
        topo_index = 0
    for index, channel in enumerate(result['channels']):
        # A Gwyddion container can hold unrelated scans of different sizes,
        # so a channel-level calibration overrides the file-level one.
        name, sheet = make_afm_sheet(
            channel['name'], channel['data'], channel['units'],
            channel.get('nm_per_px') or result['nm_per_px'],
            channel.get('nm_per_px_y') or result['nm_per_px_y'],
            result['info'], file_path,
            channel.get('source_name', ''), result['mode'],
            plain=(index == topo_index))
        name = register_afm_sheet(window, name, sheet)
        registered.append(name)
        if first_sheet is None:
            first_sheet = name

    # The force curves of an .ARDF ride on the first map sheet; the Force
    # Curves tab of the analysis window finds them there.
    if result.get('volume') and first_sheet:
        window.Data['Core levels'][first_sheet]['_afm_volume'] = result['volume']

    # A rendered surface of the height channel, on the sheet list from the
    # start — a 3D view is how most people first read an AFM scan, and making
    # it a sheet means it exports, prints and saves like any other. The 3D tab
    # of the analysis window re-points and restyles it.
    if registered:
        try:
            topo = registered[topography_index(result['channels'])]
            name_3d, sheet_3d = make_afm_3d_sheet(
                topo, window.Data['Core levels'][topo])
            register_afm_sheet(window, name_3d, sheet_3d)
        except Exception as e:
            print(f'AFM 3D sheet skipped: {e}')

    if not result['nm_per_px']:
        wx.MessageBox(
            "No scan-size metadata was found in this file, so distances are "
            "in pixels. Use Tools > AFM Analysis > Channels to set the scan "
            "size.", "AFM Import", wx.OK | wx.ICON_INFORMATION)

    # Registering each channel moved the combobox selection along with it;
    # bring it back to the first channel (the height map) so the sheet shown
    # and the sheet selected agree.
    try:
        window.sheet_combobox.SetStringSelection(first_sheet)
    except Exception:
        pass
    from libraries.Sheet_Operations import on_sheet_selected
    on_sheet_selected(window, first_sheet)

    # An AFM import always starts a fresh project, so there is no project file
    # yet. Create one now, silently: the project is named after the file and
    # written to the same folder, so leveling, roughness results and profiles
    # have somewhere to persist from the first edit. (Same as SEM/TEM;
    # ``ask=False`` uses the saved format preference, defaulting to .kfit.)
    if not window.Data.get('FilePath'):
        try:
            from libraries.FileMenu.KFitting_IO import create_new_project_file
            create_new_project_file(
                window,
                suggested_name=os.path.splitext(os.path.basename(file_path))[0],
                default_dir=os.path.dirname(file_path),
                ask=False)
        except Exception as e:
            print(f'Project creation skipped: {e}')

    if hasattr(window, 'update_console'):
        nm = result['nm_per_px']
        scale = f'{nm:.4g} nm/px' if nm else 'uncalibrated'
        window.update_console(
            f"Imported {os.path.basename(file_path)} — "
            f"{len(registered)} channel(s): {', '.join(registered)} ({scale})")
    return first_sheet
