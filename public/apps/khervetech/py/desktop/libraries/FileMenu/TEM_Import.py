# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/TEM_Import.py. Regenerate with tools/export_khervetech.py.
"""
TEM image import for KherveFitting.

Loads a transmission-electron-microscope image (Gatan DigitalMicrograph
.dm3/.dm4/.dm5, or a plain TIFF/PNG) into ``Data['Core levels']`` as a sheet
named 'TEM~Map', flagged ``'_tem': True`` so every XPS/spectral code path
skips it. The sheet holds a 2-D numpy array plus the pixel calibration in
nanometres — everything downstream (scale bar, line profiles, particle
sizing, FFT d-spacings) is derived from that single ``TEM_NM_Per_Px`` value.

The DM files are read with the native tag-tree reader already used for EELS
(``libraries.EELS_Utilities``): .dm3/.dm4 are a big-endian tag tree parsed by
``_DMTagReader``; .dm5 is the same tree stored in HDF5 and read with h5py.
No external microscopy library is needed.

Three kinds of image sheet share the flag, told apart by ``_tem_kind``:

    'map'    a real-space micrograph, calibrated in nm/px — either imported,
             or reconstructed by inverse FFT through a Bragg-filter mask
    'fft'    a reciprocal-space power spectrum computed from a map region,
             calibrated in 1/nm per px (``TEM_RecipPerPx``)
    'scalar' a real-space map of a measured quantity (local d-spacing, plane
             orientation, strain) drawn with a colour scale and a key rather
             than as a greyscale micrograph

Only the maps are imported; the rest are created by the analysis window, but
all of them persist through the same routes.
"""

import os

import numpy as np
import wx

try:
    import h5py
    HAS_H5PY = True
except ImportError:
    HAS_H5PY = False


TEM_WILDCARD = ("TEM images (*.dm3;*.dm4;*.dm5;*.tif;*.tiff;*.png)|"
                "*.dm3;*.dm4;*.dm5;*.tif;*.tiff;*.png|"
                "DigitalMicrograph (*.dm3;*.dm4;*.dm5)|*.dm3;*.dm4;*.dm5|"
                "All files (*.*)|*.*")

# Heavy arrays kept out of the project JSON (see the persistence section).
_TEM_ARRAY_KEYS = ('_tem_image', '_tem_overlay', '_tem_labels')
_TEM_H5_GROUP = 'TEM'

# Per-sheet keys that must survive the project round trip untouched. The JSON
# copy of a project is rounded to two decimals, which would turn a 0.2355 nm
# d-spacing into 0.24 and a 0.004 strain limit into 0.0, so these travel in the
# HDF5 alongside the pixels instead. The first two keep their historical attr
# names so projects saved before the rest existed still read back.
_TEM_JSON_ATTRS = ('TEM_FFT_Spots', 'TEM_FFT_Structure', 'TEM_FFT_Masks',
                   'TEM_Profile_Line', 'TEM_Profile_Peaks', 'TEM_Profile_Stats',
                   'TEM_Inset_Style', 'TEM_Particle_ROI')
_TEM_LEGACY_ATTRS = {'TEM_FFT_Spots': 'spots_json',
                     'TEM_FFT_Structure': 'structure_json'}
# Plain scalars stored as HDF5 attributes rather than as JSON strings.
_TEM_SCALAR_ATTRS = ('TEM_Scalar_Label', 'TEM_Scalar_CMap', 'TEM_Scalar_Min',
                     'TEM_Scalar_Max', 'TEM_Profile_Width', 'TEM_Mask_Label',
                     'TEM_Derived_From')
_TEM_NUMERIC_ATTRS = ('TEM_Scalar_Min', 'TEM_Scalar_Max', 'TEM_Profile_Width')


def _json_attr(key):
    return _TEM_LEGACY_ATTRS.get(key, key.lower() + '_json')


# Unit label -> factor turning one of that unit into nanometres.
_TO_NM = {'pm': 1e-3, 'nm': 1.0, 'um': 1e3, 'µm': 1e3, 'μm': 1e3,
          'micron': 1e3, 'mm': 1e6, 'm': 1e9, 'a': 0.1,
          'angstrom': 0.1}


def _scale_to_nm(scale, units):
    """Convert an axis scale in ``units`` to nm per pixel, or None."""
    if not scale:
        return None
    key = str(units or '').strip().lower().replace('å', 'a')
    factor = _TO_NM.get(key)
    if factor is None:
        return None
    return float(scale) * factor


def _pick_image_plane(data):
    """Reduce a DM dataset to a single 2-D image plane.

    Stacks (rare for plain TEM captures) keep their first frame; anything
    that cannot be read as a 2-D image is rejected.
    """
    data = np.asarray(data)
    if data.ndim == 2:
        return data
    if data.ndim == 3:
        # An RGB(A) capture has its colour channels last and tiny.
        if data.shape[-1] in (3, 4) and data.shape[-1] < min(data.shape[:2]):
            return data[..., 0]
        return data[0]
    raise ValueError(f'Not a 2-D image (shape {data.shape})')


def read_tem_image(file_path):
    """Load a TEM file into (2-D array, nm_per_px or None, info dict)."""
    ext = os.path.splitext(file_path)[0], os.path.splitext(file_path)[1].lower()
    ext = ext[1]

    if ext in ('.dm3', '.dm4', '.dm5'):
        return _read_dm_image(file_path)

    # Plain image fallback (a TEM exported as TIFF/PNG has no calibration).
    from PIL import Image
    img = Image.open(file_path)
    if img.mode in ('I;16', 'I;16B', 'I;16L', 'I'):
        array = np.asarray(img, dtype=np.uint16)
    else:
        array = np.asarray(img.convert('L'), dtype=np.uint8)
    info = {'Technique': 'TEM',
            'Image Size': f'{array.shape[1]} x {array.shape[0]} px'}
    return array, None, info


def _read_dm_image(file_path):
    """Read a .dm3/.dm4/.dm5 via the native EELS_Utilities readers."""
    from libraries.EELS_Utilities import load_dm3_dm4, load_dm5

    ext = os.path.splitext(file_path)[1].lower()
    signal = load_dm5(file_path) if ext == '.dm5' else load_dm3_dm4(file_path)

    array = _pick_image_plane(signal.data)

    # Pixel size: prefer a spatial axis whose units convert to nm. DM images
    # are square-pixel, so one axis is enough; when both are present and
    # differ we keep x and record the anisotropy in the info dict.
    axes = list(getattr(signal.axes_manager, '_axes', []))
    nm_values = []
    for axis in axes[-2:]:
        nm = _scale_to_nm(getattr(axis, 'scale', None),
                          getattr(axis, 'units', ''))
        if nm:
            nm_values.append(nm)
    nm_per_px = nm_values[-1] if nm_values else None

    info = {'Technique': 'TEM'}
    metadata = getattr(signal, 'metadata', None)
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            if value in (None, ''):
                continue
            try:
                info[str(key)] = (float(value) if isinstance(value, (int, float))
                                  and not isinstance(value, bool) else str(value))
            except Exception:
                continue
    info['Image Size'] = f'{array.shape[1]} x {array.shape[0]} px'
    if nm_per_px:
        info['Pixel Size'] = f'{nm_per_px:.4g} nm'
        info['Field of View'] = (
            f'{array.shape[1] * nm_per_px:.4g} x '
            f'{array.shape[0] * nm_per_px:.4g} nm')
        if len(nm_values) == 2 and abs(nm_values[0] - nm_values[1]) > 1e-9:
            info['Pixel Size Y'] = f'{nm_values[0]:.4g} nm'
    return array, nm_per_px, info


# ---------------------------------------------------------------------------
# Data-model helpers
# ---------------------------------------------------------------------------

def make_tem_sheet(name, array, nm_per_px=None, exp_info=None, source_file=''):
    """Build the standard TEM map sheet dict."""
    array = np.asarray(array)
    return (name or 'TEM~Map'), {
        'Name': name or 'TEM~Map',
        '_tem': True,
        '_tem_kind': 'map',
        '_tem_image': array,
        'TEM_NM_Per_Px': float(nm_per_px) if nm_per_px else None,
        'TEM_Scale_Source': 'metadata' if nm_per_px else 'uncalibrated',
        'TEM_Source_File': os.path.basename(source_file),
        'TEM_Particles': None,              # filled in by the analysis window
        'ExperimentalInfo': dict(exp_info) if exp_info else {'Technique': 'TEM'},
    }


def make_tem_fft_sheet(name, power, recip_per_px, source_sheet, roi=None):
    """Build a TEM FFT sheet dict from an already-computed power spectrum.

    ``power`` is the fftshifted magnitude (linear, not log — the renderer
    applies the log stretch so the display can be re-scaled without touching
    the data). ``recip_per_px`` is the reciprocal-space calibration in
    1/nm per pixel; None when the source map was uncalibrated.
    """
    power = np.asarray(power, dtype=np.float32)
    return (name or 'TEM~FFT'), {
        'Name': name or 'TEM~FFT',
        '_tem': True,
        '_tem_kind': 'fft',
        '_tem_image': power,
        'TEM_NM_Per_Px': None,
        'TEM_RecipPerPx': float(recip_per_px) if recip_per_px else None,
        'TEM_Scale_Source': 'computed',
        'TEM_FFT_Source': source_sheet,
        'TEM_FFT_ROI': list(roi) if roi else None,   # [cx, cy, w, h, angle] px
        'TEM_FFT_Spots': [],                # measured spots / d-labels
        'TEM_FFT_Structure': None,          # indexing result
        'ExperimentalInfo': {'Technique': 'TEM', 'Content': 'FFT (reciprocal space)',
                             'Source Sheet': source_sheet},
    }


def make_tem_filtered_sheet(name, image, nm_per_px, source_sheet, mask_label='',
                            description='Inverse FFT (Bragg-filtered)',
                            extra_info=None):
    """Build a real-space map sheet for a reconstructed / derived image.

    Used for the Bragg-filtered lattice images: they are ordinary maps as far
    as the scale bar, profiles and particle counting are concerned, and carry
    a note of where they came from so a stack of them stays readable.
    """
    image = np.asarray(image, dtype=np.float32)
    info = {'Technique': 'TEM', 'Content': description,
            'Source Sheet': source_sheet}
    if mask_label:
        info['Mask'] = str(mask_label)
    if extra_info:
        info.update(extra_info)
    return (name or 'TEM~IFFT'), {
        'Name': name or 'TEM~IFFT',
        '_tem': True,
        '_tem_kind': 'map',
        '_tem_image': image,
        'TEM_NM_Per_Px': float(nm_per_px) if nm_per_px else None,
        'TEM_Scale_Source': 'computed',
        'TEM_Derived_From': source_sheet,
        'TEM_Mask_Label': str(mask_label or ''),
        'TEM_Particles': None,
        'ExperimentalInfo': info,
    }


def make_tem_denoised_fft_sheet(power, source_fft_sheet, source_name,
                                description='FFT denoised (PCA)'):
    """Build an FFT sheet for a PCA-cleaned power spectrum.

    Denoising an FFT keeps it an FFT: the reciprocal calibration, any measured
    spots and the indexing result are carried over from the sheet it came from
    so the Measure tab still works on the cleaned diffractogram.
    """
    # PCA reconstruction can push a few cells slightly negative; a magnitude
    # spectrum cannot be, so clamp back to a valid non-negative power.
    power = np.clip(np.nan_to_num(np.asarray(power, dtype=np.float32)),
                    0.0, None)
    src = source_fft_sheet if isinstance(source_fft_sheet, dict) else {}
    root = src.get('TEM_FFT_Source', source_name)
    return 'TEM~FFT', {
        'Name': 'TEM~FFT',
        '_tem': True,
        '_tem_kind': 'fft',
        '_tem_image': power,
        'TEM_NM_Per_Px': None,
        'TEM_RecipPerPx': src.get('TEM_RecipPerPx'),
        'TEM_Scale_Source': src.get('TEM_Scale_Source', 'computed'),
        'TEM_FFT_Source': root,
        'TEM_FFT_ROI': list(src['TEM_FFT_ROI']) if src.get('TEM_FFT_ROI') else None,
        'TEM_FFT_Spots': [dict(s) for s in (src.get('TEM_FFT_Spots') or [])],
        'TEM_FFT_Structure': src.get('TEM_FFT_Structure'),
        'TEM_Denoise': 'PCA',
        'ExperimentalInfo': {'Technique': 'TEM', 'Content': description,
                             'Source Sheet': root},
    }


def make_tem_scalar_sheet(name, values, nm_per_px, source_sheet, label,
                          cmap='viridis', vmin=None, vmax=None,
                          description='Scalar map', extra_info=None):
    """Build a colour-scaled map sheet for a measured quantity.

    ``values`` may contain NaN where nothing was measurable; the colour scale
    limits are stored explicitly because the sensible range for a strain map
    (symmetric about zero) is not the one autoscaling would choose.
    """
    values = np.asarray(values, dtype=np.float32)
    info = {'Technique': 'TEM', 'Content': description,
            'Source Sheet': source_sheet, 'Quantity': str(label)}
    if extra_info:
        info.update(extra_info)
    return (name or 'TEM~Map'), {
        'Name': name or 'TEM~Map',
        '_tem': True,
        '_tem_kind': 'scalar',
        '_tem_image': values,
        'TEM_NM_Per_Px': float(nm_per_px) if nm_per_px else None,
        'TEM_Scale_Source': 'computed',
        'TEM_Derived_From': source_sheet,
        'TEM_Scalar_Label': str(label),
        'TEM_Scalar_CMap': str(cmap),
        'TEM_Scalar_Min': float(vmin) if vmin is not None else None,
        'TEM_Scalar_Max': float(vmax) if vmax is not None else None,
        'ExperimentalInfo': info,
    }


def is_tem_fft(sheet):
    return bool(isinstance(sheet, dict) and sheet.get('_tem')
                and sheet.get('_tem_kind') == 'fft')


def is_tem_scalar(sheet):
    return bool(isinstance(sheet, dict) and sheet.get('_tem')
                and sheet.get('_tem_kind') == 'scalar')


def promote_named_fft(sheet, name):
    """Treat a TEM image named ``TEM~FFT…`` as an FFT even if imported as a map.

    An FFT saved as a plain picture, or an acquired diffraction pattern, imports
    as a real-space map (``_tem_kind='map'``); the Measure and Filter tools key
    off that flag, not the sheet name, so such an image is not measurable. Since
    ``TEM~FFT`` is the reserved name for a diffractogram, a ``_tem`` map carrying
    it is flipped to an FFT in place and seeded with the FFT bookkeeping. The
    pixels are untouched; only the kind and the (centred) extent change.

    Returns True only when it actually promotes a map, so the caller can redraw
    the re-centred axes once.
    """
    if not (isinstance(sheet, dict) and sheet.get('_tem')):
        return False
    if sheet.get('_tem_kind', 'map') != 'map':
        return False
    label = name or sheet.get('Name') or ''
    if not str(label).startswith('TEM~FFT'):
        return False
    sheet['_tem_kind'] = 'fft'
    sheet.setdefault('TEM_FFT_Spots', [])
    sheet.setdefault('TEM_FFT_Structure', None)
    sheet.setdefault('TEM_FFT_Source', None)
    sheet.setdefault('TEM_RecipPerPx', sheet.get('TEM_RecipPerPx'))
    return True


def tem_array(sheet):
    """The sheet's image as a 2-D numpy array, or None."""
    array = sheet.get('_tem_image')
    if array is None:
        return None
    return np.asarray(array)


def tem_extent(sheet):
    """matplotlib ``extent`` for the sheet plus its unit label.

    Maps:  [0, W, H, 0] in nm (or µm when the field is wider than 2 µm),
           falling back to pixels when uncalibrated.
    FFTs:  centred, [-gx, gx, gy, -gy] in 1/nm (y reversed for
           origin='upper'), falling back to pixels-from-centre.
    """
    array = tem_array(sheet)
    if array is None:
        return None, 'px'
    height, width = array.shape[:2]

    if is_tem_fft(sheet):
        recip = sheet.get('TEM_RecipPerPx')
        if not recip:
            return [-width / 2, width / 2, height / 2, -height / 2], 'px'
        return [-width / 2 * recip, width / 2 * recip,
                height / 2 * recip, -height / 2 * recip], '1/nm'

    nm = sheet.get('TEM_NM_Per_Px')
    if not nm:
        return [0, width, height, 0], 'px'
    if width * nm > 2000.0:
        return [0, width * nm / 1000.0, height * nm / 1000.0, 0], 'µm'
    return [0, width * nm, height * nm, 0], 'nm'


# ---------------------------------------------------------------------------
# Project persistence
#
# Identical routing to the SEM images: the pixel array never goes into the
# project JSON (2-decimal rounding would corrupt it and bloat the file).
#
#   .kfit  -> embedded in the project HDF5 itself under 'tem_images/<sheet>'
#   .xlsx  -> the companion <project>.hdf5 shared with ARPES/EDX/EELS/SEM,
#             under a '/TEM/<sheet>' group
#
# In both cases the JSON keeps the light metadata plus a '_tem_h5' marker.
# ---------------------------------------------------------------------------

def tem_h5_path(project_path):
    """Companion HDF5 path, shared with ARPES/EDX/EELS/SEM: <project>.hdf5."""
    return os.path.splitext(project_path)[0] + '.hdf5'


def _tem_sheets(core_levels):
    return {n: s for n, s in core_levels.items()
            if isinstance(s, dict) and s.get('_tem')
            and s.get('_tem_image') is not None}


def _write_sheet_group(parent, name, sheet):
    """Write one TEM sheet's binary data as a group of datasets.

    The calibrations are attrs here rather than trusted to the JSON because
    ``convert_to_serializable_and_round`` rounds to 2 dp — 0.0936 nm/px would
    become 0.09, a 4% error in every d-spacing.
    """
    group = parent.create_group(name)
    group.create_dataset('image', data=np.asarray(sheet['_tem_image']),
                         compression='gzip', compression_opts=4)
    overlay = sheet.get('_tem_overlay')
    if overlay is not None:
        group.create_dataset('overlay', data=np.asarray(overlay, dtype=np.uint8),
                             compression='gzip', compression_opts=4)
    group.attrs['kind'] = str(sheet.get('_tem_kind', 'map'))
    if sheet.get('TEM_NM_Per_Px'):
        group.attrs['nm_per_px'] = float(sheet['TEM_NM_Per_Px'])
    if sheet.get('TEM_RecipPerPx'):
        group.attrs['recip_per_px'] = float(sheet['TEM_RecipPerPx'])
    for key in _TEM_SCALAR_ATTRS:
        value = sheet.get(key)
        if value is not None:
            group.attrs[key] = (float(value) if isinstance(value, (int, float))
                                and not isinstance(value, bool) else str(value))
    # Spot measurements, masks and the structure result carry d-spacings at
    # sub-picometre precision; the JSON copy rounds every float to 2 dp
    # (0.2355 nm would become 0.24), so the exact values travel here as a
    # JSON string and overwrite the rounded copies on read.
    import json
    for key in _TEM_JSON_ATTRS:
        value = sheet.get(key)
        if value:
            try:
                group.attrs[_json_attr(key)] = json.dumps(value)
            except (TypeError, ValueError):
                pass
    return group


def _read_sheet_group(group, sheet):
    """Restore one TEM sheet's binary data written by ``_write_sheet_group``."""
    sheet['_tem_image'] = np.asarray(group['image'][()])
    if 'overlay' in group:
        sheet['_tem_overlay'] = np.asarray(group['overlay'][()], dtype=bool)
    sheet['_tem'] = True
    sheet.pop('_tem_h5', None)
    kind = group.attrs.get('kind', 'map')
    if isinstance(kind, bytes):
        kind = kind.decode('utf-8')
    sheet.setdefault('_tem_kind', str(kind))
    if 'nm_per_px' in group.attrs:
        sheet['TEM_NM_Per_Px'] = float(group.attrs['nm_per_px'])
    if 'recip_per_px' in group.attrs:
        sheet['TEM_RecipPerPx'] = float(group.attrs['recip_per_px'])
    for key in _TEM_SCALAR_ATTRS:
        if key not in group.attrs:
            continue
        value = group.attrs[key]
        if isinstance(value, bytes):
            value = value.decode('utf-8')
        sheet[key] = (float(value) if key in _TEM_NUMERIC_ATTRS else str(value))
    import json
    for key in _TEM_JSON_ATTRS:
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


def strip_tem_arrays_for_json(core_levels_serialised):
    """Replace each TEM sheet's pixel array with a '_tem_h5' marker.

    Operates in place on an already-serialisable copy — never on live
    window.Data, which must keep its arrays.
    """
    for sheet in core_levels_serialised.values():
        if isinstance(sheet, dict) and sheet.get('_tem'):
            for key in _TEM_ARRAY_KEYS:
                sheet.pop(key, None)
            sheet['_tem_h5'] = True


def save_tem_companion(core_levels, project_path):
    """Write every TEM image into '/TEM/<sheet>' of the project .hdf5."""
    if not HAS_H5PY:
        return 0
    sheets = _tem_sheets(core_levels)
    path = tem_h5_path(project_path)
    if not sheets:
        if os.path.exists(path):
            try:
                with h5py.File(path, 'a') as f:
                    if _TEM_H5_GROUP in f:
                        del f[_TEM_H5_GROUP]
            except Exception:
                pass
        return 0
    with h5py.File(path, 'a') as f:
        if _TEM_H5_GROUP in f:
            del f[_TEM_H5_GROUP]
        root = f.create_group(_TEM_H5_GROUP)
        for name, sheet in sheets.items():
            _write_sheet_group(root, name, sheet)
    return len(sheets)


def route_tem_for_json(core_levels, json_data, file_path, console=None):
    """Save TEM images to the companion .hdf5 and strip them out of ``json_data``.

    Returns the (possibly new) json_data dict. Used by the .xlsx save paths,
    which each build their own json_data copy.
    """
    try:
        count = save_tem_companion(core_levels, file_path)
        if not count:
            return json_data
        core = {k: (dict(v) if isinstance(v, dict) and v.get('_tem') else v)
                for k, v in json_data.get('Core levels', {}).items()}
        strip_tem_arrays_for_json(core)
        json_data = dict(json_data)
        json_data['Core levels'] = core
        if console:
            console(f"Saved {count} TEM image(s) to companion .hdf5")
    except Exception as e:
        print(f"TEM companion save skipped: {e}")
    return json_data


def write_tem_into_h5(h5file, core_levels):
    """Embed TEM images directly in an open .kfit file (already HDF5)."""
    sheets = _tem_sheets(core_levels)
    if not sheets:
        return 0
    grp = h5file.create_group('tem_images')
    for name, sheet in sheets.items():
        _write_sheet_group(grp, name, sheet)
    return len(sheets)


def read_tem_from_h5(h5file, core_levels):
    """Restore TEM images embedded in an open .kfit file."""
    if 'tem_images' not in h5file:
        return []
    restored = []
    for name in h5file['tem_images']:
        sheet = core_levels.get(name)
        if not isinstance(sheet, dict):
            sheet = {'Name': name, '_tem': True}
            core_levels[name] = sheet
        _read_sheet_group(h5file['tem_images'][name], sheet)
        restored.append(name)
    return restored


def load_tem_companion(core_levels, project_path):
    """Restore TEM images from the companion .hdf5. Returns restored names."""
    path = tem_h5_path(project_path)
    if not HAS_H5PY or not os.path.exists(path):
        return []
    restored = []
    with h5py.File(path, 'r') as f:
        if _TEM_H5_GROUP not in f:
            return []
        for name in f[_TEM_H5_GROUP]:
            sheet = core_levels.get(name)
            if not isinstance(sheet, dict):
                sheet = {'Name': name, '_tem': True}
                core_levels[name] = sheet
            _read_sheet_group(f[_TEM_H5_GROUP][name], sheet)
            restored.append(name)
    return restored


# ---------------------------------------------------------------------------
# Import entry point
# ---------------------------------------------------------------------------

def register_tem_sheet(window, sheet_name, sheet):
    """Insert a TEM sheet into window.Data and select it in the combobox."""
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


def start_fresh_for_tem(window):
    """A TEM import starts a new project; offer to save whatever is open first.

    Same reasoning as the SEM import: an image sheet shares nothing with the
    spectra it would sit beside. Returns False if the user cancels the reset.
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


def import_tem_image(window, file_path=None):
    """File > Import > TEM Image... — load a DM file as a new 'TEM~Map' sheet.

    ``file_path`` skips the dialog — used by the drag-and-drop route, where the
    file is already chosen and only the technique had to be picked."""
    if file_path is None:
        with wx.FileDialog(window, "Open TEM image", wildcard=TEM_WILDCARD,
                           style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dialog:
            if dialog.ShowModal() == wx.ID_CANCEL:
                return None
            file_path = dialog.GetPath()

    if not start_fresh_for_tem(window):
        return None

    try:
        array, nm_per_px, info = read_tem_image(file_path)
    except Exception as e:
        import traceback
        traceback.print_exc()
        wx.MessageBox(f"Could not read the file:\n{e}", "TEM Import",
                      wx.OK | wx.ICON_ERROR)
        return None

    sheet_name, sheet = make_tem_sheet('TEM~Map', array, nm_per_px, info,
                                       file_path)
    sheet_name = register_tem_sheet(window, sheet_name, sheet)

    if not nm_per_px:
        wx.MessageBox(
            "No pixel-size calibration was found in this file.\n\n"
            "Distances, particle sizes and d-spacings cannot be reported in "
            "nanometres until the scale is set — use Tools > TEM Analysis > "
            "Calibrate to enter the pixel size.",
            "TEM Import", wx.OK | wx.ICON_INFORMATION)

    from libraries.Sheet_Operations import on_sheet_selected
    on_sheet_selected(window, sheet_name)

    # A TEM import always starts a fresh project, so there is no project file
    # yet. Create one now, silently: the project is named after the image and
    # written to the same folder, so the calibration, particle counts and FFT
    # sheets have somewhere to persist from the first edit — without a Save-As
    # prompt, since the image is already on disk and names the project. (Same
    # as the SEM import; ``ask=False`` uses the saved format preference,
    # defaulting to .kfit.)
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
        scale = f'{nm_per_px:.4g} nm/px' if nm_per_px else 'uncalibrated'
        window.update_console(
            f"Imported {os.path.basename(file_path)} as '{sheet_name}' "
            f"({array.shape[1]}x{array.shape[0]} px, {scale})")
    return sheet_name
