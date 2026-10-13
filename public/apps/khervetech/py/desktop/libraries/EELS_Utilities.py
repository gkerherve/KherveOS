# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/EELS_Utilities.py. Regenerate with tools/export_khervetech.py.
"""
EELS_Utilities.py
Standalone EELS (Electron Energy Loss Spectroscopy) analysis utilities
Replaces HyperSpy dependencies for .dm3/.dm4/.dm5 file import and analysis.

This module provides:
- DM3/DM4 file reading (Digital Micrograph tag tree) - built in, no dependencies
- DM5 file reading (Digital Micrograph 5, HDF5 container) using h5py
- HDF5 EELS data loading
- Signal class with axes management for compatibility
- Basic EELS data structures

Author: KherveFitting Project
License: BSD-3-Clause
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional, List, Any, Dict


# =============================================================================
# AXES MANAGEMENT (compatible with HyperSpy interface)
# =============================================================================

@dataclass
class Axis:
    """Axis calibration for signal dimensions"""
    size: int
    scale: float = 1.0
    offset: float = 0.0
    units: str = ''
    name: str = ''

    @property
    def axis(self) -> np.ndarray:
        """Generate axis values using offset"""
        return np.arange(self.size) * self.scale + self.offset

    @property
    def axis_no_offset(self) -> np.ndarray:
        """Generate axis values starting from 0 (ignore offset)"""
        return np.arange(self.size) * self.scale


class AxesManager:
    """
    Manages axes for signals (compatible with HyperSpy).

    Convention: last axis is signal axis, others are navigation axes
    """

    def __init__(self, shape: tuple):
        self._axes = []
        self._signal_axes = []
        self._navigation_axes = []

        for i, size in enumerate(shape):
            axis = Axis(size=size, name=f'axis-{i}')
            self._axes.append(axis)

        # By default, last axis is signal axis
        if self._axes:
            self._signal_axes = [self._axes[-1]]
            self._navigation_axes = self._axes[:-1]

    def __getitem__(self, index: int) -> Axis:
        return self._axes[index]

    def __len__(self):
        return len(self._axes)

    @property
    def signal_axes(self) -> List[Axis]:
        return self._signal_axes

    @property
    def navigation_axes(self) -> List[Axis]:
        return self._navigation_axes

    @property
    def shape(self) -> tuple:
        return tuple(ax.size for ax in self._axes)


# =============================================================================
# SIGNAL CLASSES (compatible with HyperSpy interface)
# =============================================================================

class Signal1D:
    """
    1D signal class compatible with HyperSpy interface.
    Used for EELS spectrum handling.
    """

    def __init__(self, data: np.ndarray):
        """
        Initialize signal with data.

        Parameters
        ----------
        data : np.ndarray
            Signal data (can be 1D or multidimensional for spectrum images)
        """
        self.data = np.asarray(data)
        self.axes_manager = AxesManager(self.data.shape)
        self.metadata = {}
        self._signal_type = 'EELS'
        # True for a line-scan spectrum image, i.e. one spatial axis only.
        # Such data is displayed as a profile heatmap (energy vs position)
        # rather than as a spatial map with the energy axis summed away.
        self.is_line_profile = False

    def set_signal_type(self, signal_type: str):
        """Set the signal type (e.g., 'EELS')"""
        self._signal_type = signal_type

    def sum(self, axis=None):
        """Sum signal along specified axis"""
        if axis is None:
            # Sum over navigation axes (spatial dimensions)
            if len(self.data.shape) > 1:
                summed_data = np.sum(self.data, axis=tuple(range(len(self.data.shape) - 1)))
            else:
                summed_data = self.data
        else:
            summed_data = np.sum(self.data, axis=axis)

        return Signal1D(summed_data)


# =============================================================================
# LINE-PROFILE SPECTRUM IMAGES
# =============================================================================

def promote_line_profile(signal: Signal1D) -> Signal1D:
    """
    Promote a 2D line-scan SI from (position, energy) to (1, position, energy).

    A line scan has a single spatial axis, so it arrives 2D while the rest of
    the application expects a 3D spectrum image. Adding the length-1 axis keeps
    every map/ROI code path working, and the returned signal is flagged as a
    profile so it gets drawn as an energy-vs-position heatmap rather than as a
    spatial map with the energy axis summed away.

    Signals that are not 2D, or whose last axis is not an energy axis, are
    returned unchanged.
    """
    axes = signal.axes_manager._axes

    if signal.data.ndim != 2 or len(axes) != 2:
        return signal
    if str(axes[-1].units).lower() not in ('ev', 'electron volt'):
        return signal

    position_axis, energy_axis = axes[0], axes[1]

    promoted = Signal1D(signal.data[np.newaxis, :, :])
    promoted.metadata = signal.metadata
    promoted.is_line_profile = True

    new_axes = promoted.axes_manager._axes
    # The length-1 axis borrows the position calibration so anything reading
    # navigation axis 0 for a distance still gets a sensible number
    for target, source in zip(new_axes, [position_axis, position_axis, energy_axis]):
        target.scale = source.scale
        target.units = source.units
    new_axes[0].offset = 0.0
    new_axes[1].offset = position_axis.offset
    new_axes[2].offset = energy_axis.offset

    new_axes[0].name = 'Y'
    new_axes[1].name = 'Position'
    new_axes[2].name = 'Energy Loss'
    promoted.axes_manager._navigation_axes = new_axes[:2]
    promoted.axes_manager._signal_axes = [new_axes[2]]

    print(f"Line-profile SI: {position_axis.size} positions x {energy_axis.size} channels")

    return promoted


def build_dm_signal(data, scales, offsets, units, metadata, label='DM'):
    """
    Build a calibrated Signal1D from a Digital Micrograph dataset.

    Shared by the DM3/DM4 and DM5 readers: both arrive with the data already in
    numpy order plus one (scale, offset, units) triple per axis. This puts the
    energy axis last so it becomes the signal axis, promotes line scans, and
    names the axes.
    """
    scales, offsets, units = list(scales), list(offsets), list(units)

    energy_index = None
    for i, unit in enumerate(units):
        if str(unit).lower() in ('ev', 'electron volt'):
            energy_index = i
            break

    if energy_index is not None and energy_index != data.ndim - 1:
        order = [i for i in range(data.ndim) if i != energy_index] + [energy_index]
        data = np.transpose(data, order)
        scales = [scales[i] for i in order]
        offsets = [offsets[i] for i in order]
        units = [units[i] for i in order]

    signal = Signal1D(data)
    signal.metadata = metadata

    for i, axis in enumerate(signal.axes_manager._axes):
        axis.scale = scales[i]
        axis.offset = offsets[i]
        axis.units = units[i]

    # A line scan arrives as (position, energy) and is promoted to 3D
    signal = promote_line_profile(signal)

    axes = signal.axes_manager._axes
    if len(axes) == 3 and not signal.is_line_profile:
        axes[0].name = 'Y'
        axes[1].name = 'X'
        axes[2].name = 'Energy Loss'
        if not axes[2].units:
            axes[2].units = 'eV'
        signal.axes_manager._navigation_axes = axes[:2]
        signal.axes_manager._signal_axes = [axes[2]]
    elif len(axes) == 1:
        axes[0].name = 'Energy Loss'
        if not axes[0].units:
            axes[0].units = 'eV'

    print(f"Loaded {label}: shape {signal.data.shape}")
    for i, ax in enumerate(signal.axes_manager._axes):
        print(f"  Axis {i} ({ax.name}): scale={ax.scale:.4f} {ax.units}, offset={ax.offset:.4f}")

    return signal


# =============================================================================
# DM3/DM4 TAG TREE READER (native - no ncempy/hyperspy needed)
# =============================================================================

# DM encodes the type of every scalar it stores. Data itself is little endian;
# the structure around it (lengths, type codes) is big endian.
_DM_DTYPES = {
    2: '<i2',    # short
    3: '<i4',    # long
    4: '<u2',    # ushort - also how DM stores text
    5: '<u4',    # ulong
    6: '<f4',    # float
    7: '<f8',    # double
    8: '<u1',    # boolean
    9: '<i1',    # char
    10: '<i1',   # octet
    11: '<i8',
    12: '<u8',
}
_DM_SIZES = {2: 2, 3: 4, 4: 2, 5: 4, 6: 4, 7: 8, 8: 1, 9: 1, 10: 1, 11: 8, 12: 8}

_DM_TAG_DIR = 20
_DM_TAG_DATA = 21


class TruncatedDMFileError(ValueError):
    """The DM file ends before its declared image data does (partial copy)"""
_DM_TYPE_STRING = 18
_DM_TYPE_STRUCT = 15
_DM_TYPE_ARRAY = 20

# Arrays smaller than this are text (units, labels); anything larger is bulk
# data whose position is recorded and read only if it turns out to be needed.
_DM_INLINE_ARRAY_BYTES = 1024


class _LazyArray:
    """A bulk array in a DM file, recorded by position rather than read"""

    def __init__(self, offset, dtype, count, file_size=None):
        self.offset = offset
        self.dtype = dtype
        self.count = count
        self.file_size = file_size

    @property
    def end_offset(self):
        return self.offset + self.count * np.dtype(self.dtype).itemsize

    @property
    def truncated(self):
        """True when the file ends before the declared array does"""
        return self.file_size is not None and self.end_offset > self.file_size

    def read(self, filepath):
        return np.fromfile(filepath, dtype=self.dtype, count=self.count,
                           offset=self.offset)


class _DMTagReader:
    """
    Parser for the Digital Micrograph tag tree (.dm3 / .dm4).

    The two formats differ only in the width of their length fields: 4 bytes in
    DM3, 8 in DM4, plus one extra length per tag in DM4.
    """

    def __init__(self, fh, version):
        self.fh = fh
        self.version = version
        self.size_dtype = '>u8' if version == 4 else '>u4'
        position = fh.tell()
        fh.seek(0, 2)
        self.file_size = fh.tell()
        fh.seek(position)

    def _scalar(self, dtype):
        return np.frombuffer(self.fh.read(np.dtype(dtype).itemsize), dtype=dtype)[0]

    def _size(self):
        return int(self._scalar(self.size_dtype))

    def read_directory(self):
        """Read a tag directory into a dict; unlabelled entries are indexed"""
        self.fh.read(2)  # sorted / open flags
        count = self._size()

        entries = {}
        for index in range(count):
            name, value = self._read_tag(index)
            if value is not None:
                entries[name] = value
        return entries

    def _read_tag(self, index):
        kind = self.fh.read(1)
        if not kind:
            return str(index), None
        kind = kind[0]

        label_length = int(self._scalar('>u2'))
        label = self.fh.read(label_length).decode('latin-1') if label_length else str(index)

        if self.version == 4:
            self._size()  # total bytes in this tag, unused

        if kind == _DM_TAG_DIR:
            return label, self.read_directory()
        if kind == _DM_TAG_DATA:
            return label, self._read_tag_data(label)
        return label, None  # end of directory / unknown

    def _read_tag_data(self, label=''):
        if self.fh.read(4) != b'%%%%':
            raise ValueError("Corrupt DM file: missing tag delimiter")

        self._size()  # number of info values that follow, redundant
        encoded_type = self._size()

        if encoded_type in _DM_DTYPES:
            return self._scalar(_DM_DTYPES[encoded_type])

        if encoded_type == _DM_TYPE_STRING:
            length = int(self._scalar('>u4'))
            return self.fh.read(length).decode('latin-1')

        if encoded_type == _DM_TYPE_STRUCT:
            return self._read_struct()

        if encoded_type == _DM_TYPE_ARRAY:
            return self._read_array(label)

        raise ValueError(f"Unsupported DM tag type: {encoded_type}")

    def _read_struct_types(self):
        self._size()  # name length, unused
        field_count = self._size()
        if field_count > 100:
            raise ValueError("Corrupt DM file: implausible struct")
        return [self._size() for _ in range(field_count * 2)][1::2]

    def _read_struct(self):
        return tuple(self._scalar(_DM_DTYPES[t]) for t in self._read_struct_types())

    def _read_array_types(self):
        array_type = self._size()
        if array_type == _DM_TYPE_STRUCT:
            return self._read_struct_types()
        if array_type == _DM_TYPE_ARRAY:
            return self._read_array_types()
        return [array_type]

    def _read_array(self, label=''):
        item_types = self._read_array_types()
        length = self._size()

        try:
            item_size = sum(_DM_SIZES[t] for t in item_types)
        except KeyError:
            raise ValueError(f"Unsupported DM array type: {item_types}")

        total_bytes = length * item_size

        # The image itself is always bulk, however small the image happens to be
        if label != 'Data' and total_bytes < _DM_INLINE_ARRAY_BYTES and len(item_types) == 1:
            # Short arrays are text - DM stores strings as arrays of ushort
            raw = np.frombuffer(self.fh.read(total_bytes),
                                dtype=_DM_DTYPES[item_types[0]], count=length)
            return ''.join(chr(int(c)) for c in raw if int(c) > 0)

        # Bulk data: note where it is and step over it
        array = _LazyArray(self.fh.tell(), _DM_DTYPES[item_types[0]], length,
                           file_size=self.file_size) \
            if len(item_types) == 1 else None
        self.fh.seek(total_bytes, 1)
        return array


def read_dm_tags(filepath: str):
    """Parse a .dm3/.dm4 file into a nested dict of its tag tree"""
    with open(filepath, 'rb') as fh:
        version = int(np.frombuffer(fh.read(4), dtype='>u4')[0])
        if version not in (3, 4):
            raise ValueError(f"Not a DM3/DM4 file (version tag = {version})")

        reader = _DMTagReader(fh, version)
        reader._size()          # total length of the root directory
        reader._scalar('>u4')   # byte order flag; data is always little endian

        return reader.read_directory(), version


def load_dm3_dm4_native(filepath: str) -> Signal1D:
    """
    Load a DM3/DM4 spectrum image without ncempy or hyperspy.

    Same tag tree as DM5, just in DM's own container instead of HDF5, so the
    calibration is read the same way: Dimension [0] is the fastest-varying axis
    (the last numpy axis) and the origin is in pixels, hence
    offset = -Origin * Scale.
    """
    tags, version = read_dm_tags(filepath)

    image_list = tags.get('ImageList')
    if not image_list:
        raise ValueError("No ImageList in DM file")

    # DM stores an RGB thumbnail beside the real data; score the entries so the
    # EELS/largest numeric one wins
    best, best_score, best_name = None, None, ''
    for key, entry in image_list.items():
        if not isinstance(entry, dict):
            continue
        image_data = entry.get('ImageData')
        if not isinstance(image_data, dict) or not isinstance(image_data.get('Data'), _LazyArray):
            continue

        # DataType 23/8 are the RGB display images
        if int(image_data.get('DataType', 0) or 0) in (8, 23):
            continue

        units = _dm_dimension_field(image_data, 'Units', '')
        is_eels = any(str(u).lower() == 'ev' for u in units)
        signal_tag = entry.get('ImageTags', {}).get('Meta Data', {}).get('Signal', '')
        if str(signal_tag).upper() == 'EELS':
            is_eels = True

        score = (is_eels, int(image_data['Data'].count))
        if best_score is None or score > best_score:
            best, best_score, best_name = entry, score, entry.get('Name', key)

    if best is None:
        raise ValueError("No numeric image data found in DM file")

    image_data = best['ImageData']

    # Dimensions are listed fastest-varying first, numpy wants slowest first
    dimensions = image_data.get('Dimensions', {})
    shape = [int(dimensions[k]) for k in sorted(dimensions, key=_dm_index)][::-1]

    lazy = image_data['Data']
    if lazy.truncated:
        # A file cut mid-write also loses every tag after the data block
        # (Dimensions among them), so nothing downstream can be trusted.
        raise TruncatedDMFileError(
            f"DM file is truncated: the image data runs to "
            f"{lazy.end_offset / 1e6:.1f} MB but the file is only "
            f"{lazy.file_size / 1e6:.1f} MB. Re-copy or re-export the file.")
    expected = int(np.prod(shape)) if shape else 0
    if expected and expected != lazy.count:
        raise ValueError(f"DM data size {lazy.count} does not match dimensions {shape}")

    data = lazy.read(filepath)
    if shape:
        data = data.reshape(shape)

    ndim = data.ndim
    scales, offsets, units = [1.0] * ndim, [0.0] * ndim, [''] * ndim
    for dm_index, calibration in _dm_dimensions(image_data):
        axis_index = ndim - 1 - dm_index
        if not 0 <= axis_index < ndim:
            continue
        scale = float(calibration.get('Scale', 1.0) or 1.0)
        origin = float(calibration.get('Origin', 0.0) or 0.0)
        scales[axis_index] = scale
        offsets[axis_index] = -origin * scale
        units[axis_index] = str(calibration.get('Units', '') or '')

    metadata = {'Name': str(best.get('Name', best_name) or '')}
    image_tags = best.get('ImageTags', {})
    for group in [image_tags.get('EELS', {}).get('Experimental Conditions'),
                  image_tags.get('EELS Spectrometer'),
                  image_tags.get('Microscope Info'),
                  image_tags.get('Meta Data')]:
        if isinstance(group, dict):
            for key, value in group.items():
                if not isinstance(value, (dict, _LazyArray)):
                    metadata[key] = value

    return build_dm_signal(data, scales, offsets, units, metadata,
                           label=f"DM{version} '{metadata['Name']}'")


def _dm_index(key):
    """Sort key for DM's index-style tag names ('0', '1', '[0]', ...)"""
    digits = ''.join(c for c in str(key) if c.isdigit())
    return int(digits) if digits else 0


def _dm_dimensions(image_data):
    """Yield (dimension index, calibration dict) for one ImageData tag group"""
    dimension = image_data.get('Calibrations', {}).get('Dimension', {})
    if isinstance(dimension, dict):
        for key, calibration in dimension.items():
            if isinstance(calibration, dict):
                yield _dm_index(key), calibration


def _dm_dimension_field(image_data, field, default=None):
    return [calibration.get(field, default) for _, calibration in _dm_dimensions(image_data)]


# =============================================================================
# DM3/DM4 FILE READER (Digital Micrograph format)
# =============================================================================

def load_dm3_dm4(filepath: str) -> Signal1D:
    """
    Load DM3/DM4 file.

    Tries multiple methods in order:
    1. the built-in tag tree reader (no dependencies)
    2. ncempy, if installed
    3. hyperspy, if installed

    Parameters
    ----------
    filepath : str
        Path to DM3/DM4 file

    Returns
    -------
    Signal1D
        EELS signal object
    """
    # Built-in reader first: it needs nothing extra installed, and it applies
    # DM's pixel-origin convention (offset = -Origin * Scale) which the ncempy
    # path below does not.
    try:
        return load_dm3_dm4_native(filepath)
    except TruncatedDMFileError:
        # No fallback reader can conjure up data the file does not contain
        raise
    except Exception as e:
        print(f"Built-in DM reader failed: {e}, trying ncempy...")
        import traceback
        traceback.print_exc()

    # Try ncempy next
    try:
        import ncempy.io.dm as dm

        dm_file = dm.fileDM(filepath)

        # Get dataset (usually index 0 is the main data)
        data_dict = dm_file.getDataset(0)
        data = data_dict['data']

        # Get calibration
        pixelSize = data_dict.get('pixelSize', [])
        pixelOrigin = data_dict.get('pixelOrigin', [])
        pixelUnit = data_dict.get('pixelUnit', [])

        print(f"DM3/DM4 data shape: {data.shape}")
        print(f"Pixel sizes: {pixelSize}")
        print(f"Pixel origins: {pixelOrigin}")
        print(f"Pixel units: {pixelUnit}")

        # DETECT AXIS ORDER: Find which axis is the energy axis
        # Energy axis has units 'eV' and typically larger size (hundreds to thousands)
        energy_axis_idx = None

        for i, unit in enumerate(pixelUnit):
            unit_str = str(unit).lower() if unit else ''
            if 'ev' in unit_str or 'electron' in unit_str:
                energy_axis_idx = i
                print(f"Detected energy axis at index {i}")
                break

        # If energy axis is first (common in some EELS formats), need to transpose
        if energy_axis_idx == 0 and len(data.shape) == 3:
            print(f"Energy axis is FIRST - transposing data from (E,Y,X) to (Y,X,E)")
            # Transpose from (Energy, Y, X) to (Y, X, Energy)
            data = np.transpose(data, (1, 2, 0))
            # Reorder calibration arrays
            pixelSize = [pixelSize[1], pixelSize[2], pixelSize[0]]
            pixelOrigin = [pixelOrigin[1], pixelOrigin[2], pixelOrigin[0]]
            pixelUnit = [pixelUnit[1], pixelUnit[2], pixelUnit[0]]
            print(f"New data shape after transpose: {data.shape}")
            print(f"New pixel units order: {pixelUnit}")

        # Create signal
        signal = Signal1D(data)

        # Set up axes with calibration
        # Convention: for 3D data (y, x, energy), axes are [y, x, energy]
        for i, axis in enumerate(signal.axes_manager._axes):
            if i < len(pixelSize) and pixelSize[i] is not None:
                axis.scale = float(pixelSize[i])
            else:
                axis.scale = 1.0

            if i < len(pixelOrigin) and pixelOrigin[i] is not None:
                axis.offset = float(pixelOrigin[i])
            else:
                axis.offset = 0.0

            if i < len(pixelUnit) and pixelUnit[i]:
                unit_str = str(pixelUnit[i])
                # Clean up unit string
                if unit_str.lower() in ['nm', 'nanometer', 'nanometers']:
                    axis.units = 'nm'
                elif unit_str.lower() in ['µm', 'um', 'micrometer', 'micrometers', 'micron']:
                    axis.units = 'µm'
                elif unit_str.lower() in ['ev', 'electron volt']:
                    axis.units = 'eV'
                else:
                    axis.units = unit_str
            else:
                axis.units = ''

        # Identify axis types based on position (after transpose, should be Y, X, Energy)
        if len(signal.axes_manager._axes) == 3:
            # Standard EELS: [Y, X, Energy]
            signal.axes_manager._axes[0].name = 'Y'
            signal.axes_manager._axes[1].name = 'X'
            signal.axes_manager._axes[2].name = 'Energy Loss'

            # If last axis doesn't have units, assume eV
            if not signal.axes_manager._axes[2].units:
                signal.axes_manager._axes[2].units = 'eV'

            # Update navigation/signal axes
            signal.axes_manager._navigation_axes = signal.axes_manager._axes[:2]
            signal.axes_manager._signal_axes = [signal.axes_manager._axes[2]]

        # A line scan arrives as (position, energy) and is promoted to 3D
        signal = promote_line_profile(signal)

        print(f"Loaded with ncempy:")
        for i, ax in enumerate(signal.axes_manager._axes):
            print(f"  Axis {i} ({ax.name}): scale={ax.scale:.4f} {ax.units}, offset={ax.offset:.4f}")

        return signal

    except ImportError:
        print("ncempy not available, trying hyperspy...")
    except Exception as e:
        print(f"ncempy failed: {e}, trying hyperspy...")
        import traceback
        traceback.print_exc()

    # Try hyperspy as fallback
    try:
        import hyperspy.api as hs

        hs_signal = hs.load(filepath)

        if isinstance(hs_signal, list):
            hs_signal = hs_signal[0]

        # Convert to our Signal1D
        signal = Signal1D(hs_signal.data)

        # Copy axis calibration
        if hasattr(hs_signal, 'axes_manager'):
            for i, hs_axis in enumerate(hs_signal.axes_manager._axes):
                if i < len(signal.axes_manager._axes):
                    signal.axes_manager._axes[i].scale = hs_axis.scale
                    signal.axes_manager._axes[i].offset = hs_axis.offset
                    signal.axes_manager._axes[i].units = hs_axis.units
                    signal.axes_manager._axes[i].name = hs_axis.name

            # Copy navigation/signal axes designation
            signal.axes_manager._navigation_axes = []
            signal.axes_manager._signal_axes = []

            for hs_ax in hs_signal.axes_manager.navigation_axes:
                idx = hs_signal.axes_manager._axes.index(hs_ax)
                if idx < len(signal.axes_manager._axes):
                    signal.axes_manager._navigation_axes.append(signal.axes_manager._axes[idx])

            for hs_ax in hs_signal.axes_manager.signal_axes:
                idx = hs_signal.axes_manager._axes.index(hs_ax)
                if idx < len(signal.axes_manager._axes):
                    signal.axes_manager._signal_axes.append(signal.axes_manager._axes[idx])

        # A line scan arrives as (position, energy) and is promoted to 3D
        signal = promote_line_profile(signal)

        print(f"Loaded with hyperspy:")
        for i, ax in enumerate(signal.axes_manager._axes):
            print(f"  Axis {i} ({ax.name}): scale={ax.scale:.4f} {ax.units}, offset={ax.offset:.4f}")

        return signal

    except ImportError:
        print("hyperspy not available")
    except Exception as e:
        print(f"hyperspy failed: {e}")
        import traceback
        traceback.print_exc()

    raise IOError("Could not read this DM3/DM4 file. The built-in reader could not "
                  "parse it (see the log above for why), and neither 'ncempy' nor "
                  "'hyperspy' is installed to try as a fallback.")


# =============================================================================
# DM5 FILE READER (Digital Micrograph 5 / GMS 3.5+, HDF5 container)
# =============================================================================

def _dm5_attr(group, key, default=None):
    """Read an HDF5 attribute, decoding bytes to str"""
    value = group.attrs.get(key, default)
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    return value


def load_dm5(filepath: str) -> Signal1D:
    """
    Load a DM5 file (Digital Micrograph 5, written by GMS 3.5+).

    DM5 keeps the familiar DM tag tree but stores it in an HDF5 container:
    the data lives in ImageList/[n]/ImageData/Data and the calibration in
    ImageList/[n]/ImageData/Calibrations/Dimension/[i] as Scale/Origin/Units
    attributes. Dimension [0] is the fastest-varying axis, i.e. the LAST
    numpy axis.

    DM stores the origin in pixels, so the calibrated axis is
    (index - Origin) * Scale, meaning offset = -Origin * Scale.

    Parameters
    ----------
    filepath : str
        Path to DM5 file

    Returns
    -------
    Signal1D
        EELS signal object
    """
    import h5py

    with h5py.File(filepath, 'r') as f:
        if 'ImageList' not in f:
            raise ValueError("Not a DM5 file: no ImageList group found")

        image_list = f['ImageList']

        # Score every image in the list: DM writes an RGB thumbnail alongside
        # the real data, so pick the EELS/largest numeric dataset.
        best = None
        best_score = None

        for key in image_list.keys():
            entry = image_list[key]
            if 'ImageData' not in entry or 'Data' not in entry['ImageData']:
                continue

            dataset = entry['ImageData']['Data']
            if dataset.dtype.names is not None or dataset.dtype == np.uint8:
                continue  # RGB thumbnail / compound display data

            dims = entry['ImageData'].get('Calibrations', {})
            units = []
            if 'Dimension' in dims:
                dimension = dims['Dimension']
                units = [str(_dm5_attr(dimension[d], 'Units', '') or '')
                         for d in sorted(dimension.keys())]

            is_eels = any('ev' == u.lower() for u in units)
            meta = entry.get('ImageTags/Meta Data')
            if meta is not None and str(_dm5_attr(meta, 'Signal', '')).upper() == 'EELS':
                is_eels = True

            score = (is_eels, int(np.prod(dataset.shape)))
            if best_score is None or score > best_score:
                best_score = score
                best = entry

        if best is None:
            raise ValueError("No numeric image data found in DM5 file")

        data = np.array(best['ImageData']['Data'])
        name = _dm5_attr(best, 'Name', '')

        # Calibration: DM dimension i corresponds to numpy axis (ndim - 1 - i)
        scales = [1.0] * data.ndim
        offsets = [0.0] * data.ndim
        units = [''] * data.ndim

        calibrations = best['ImageData'].get('Calibrations')
        if calibrations is not None and 'Dimension' in calibrations:
            dimension = calibrations['Dimension']
            for key in dimension.keys():
                try:
                    dm_index = int(key.strip('[]'))
                except ValueError:
                    continue
                axis_index = data.ndim - 1 - dm_index
                if not 0 <= axis_index < data.ndim:
                    continue
                scale = float(_dm5_attr(dimension[key], 'Scale', 1.0) or 1.0)
                origin = float(_dm5_attr(dimension[key], 'Origin', 0.0) or 0.0)
                scales[axis_index] = scale
                offsets[axis_index] = -origin * scale
                units[axis_index] = str(_dm5_attr(dimension[key], 'Units', '') or '')

        # Metadata worth keeping
        metadata = {'Name': name}
        for tag_path in ['ImageTags/EELS/Experimental Conditions',
                         'ImageTags/EELS Spectrometer',
                         'ImageTags/Microscope Info',
                         'ImageTags/Meta Data']:
            tag_group = best.get(tag_path)
            if tag_group is not None:
                for key in tag_group.attrs:
                    label = key.decode('utf-8', errors='replace') if isinstance(key, bytes) else str(key)
                    metadata[label] = _dm5_attr(tag_group, key)

    return build_dm_signal(data, scales, offsets, units, metadata,
                           label=f"DM5 '{name}'")


# =============================================================================
# HDF5 EELS DATA READER
# =============================================================================

def load_hdf5_eels(filepath: str) -> Signal1D:
    """
    Load EELS data from HDF5 file.

    Parameters
    ----------
    filepath : str
        Path to HDF5 file

    Returns
    -------
    Signal1D
        EELS signal object
    """
    import h5py

    with h5py.File(filepath, 'r') as f:
        # Common HDF5 structures for EELS data
        data_paths = [
            'EELS/data', 'eels/data', 'Data/data',
            'Experiments/EELS/data', 'entry/data/data',
            'spectrum', 'data', 'counts', 'intensity'
        ]

        energy_paths = [
            'EELS/energy', 'eels/energy', 'Data/energy',
            'Experiments/EELS/energy', 'entry/data/energy',
            'energy_loss', 'energy', 'axis', 'x'
        ]

        data = None
        energy_axis = None

        # Find data
        for path in data_paths:
            if path in f:
                data = np.array(f[path])
                break

        if data is None:
            # Try to find any 3D dataset
            def find_3d_dataset(name, obj):
                if isinstance(obj, h5py.Dataset) and len(obj.shape) == 3:
                    return obj

            f.visititems(lambda n, o: find_3d_dataset(n, o))

        if data is None:
            raise ValueError("No EELS data found in HDF5 file")

        # Find energy axis
        for path in energy_paths:
            if path in f:
                energy_axis = np.array(f[path])
                break

        # Read metadata
        metadata = {}
        if 'metadata' in f.attrs:
            for key, value in f.attrs.items():
                metadata[key] = value

    # Create signal
    signal = Signal1D(data)
    signal.metadata = metadata

    # Set up energy axis
    if energy_axis is not None and len(data.shape) >= 1:
        signal_axis_idx = len(signal.axes_manager) - 1
        axis = signal.axes_manager[signal_axis_idx]

        if len(energy_axis) > 1:
            axis.scale = float(energy_axis[1] - energy_axis[0])
            axis.offset = float(energy_axis[0])
        elif len(energy_axis) == len(data.shape[-1]):
            axis.scale = 1.0
            axis.offset = float(energy_axis[0])

        axis.units = 'eV'
        axis.name = 'Energy Loss'

    return signal


# =============================================================================
# GENERIC LOADER
# =============================================================================

def load_eels(filepath: str) -> Signal1D:
    """
    Load EELS data from various file formats.

    Supports:
    - DM3/DM4 (Digital Micrograph) - built-in reader, ncempy/hyperspy as fallback
    - DM5 (Digital Micrograph 5, HDF5 container) - uses h5py
    - HDF5

    Parameters
    ----------
    filepath : str
        Path to EELS file

    Returns
    -------
    Signal1D
        EELS signal object
    """
    import os

    ext = os.path.splitext(filepath)[1].lower()

    if ext in ['.dm3', '.dm4']:
        return load_dm3_dm4(filepath)

    elif ext == '.dm5':
        return load_dm5(filepath)

    elif ext in ['.hdf5', '.h5', '.hspy']:
        return load_hdf5_eels(filepath)

    else:
        raise ValueError(f"Unsupported file format: {ext}. Supported: .dm3, .dm4, .dm5, .hdf5, .h5")


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def create_eels_signal(data: np.ndarray,
                       energy_scale: float = 1.0,
                       energy_offset: float = 0.0,
                       energy_units: str = 'eV') -> Signal1D:
    """
    Create an EELS signal from numpy array with energy calibration.

    Parameters
    ----------
    data : np.ndarray
        EELS data (can be 1D spectrum or 3D spectrum image)
    energy_scale : float
        Energy scale (eV per channel)
    energy_offset : float
        Energy offset (eV)
    energy_units : str
        Energy units

    Returns
    -------
    Signal1D
        EELS signal object
    """
    signal = Signal1D(data)

    # Set up energy axis on last axis (signal axis)
    signal_axis_idx = len(signal.axes_manager) - 1
    axis = signal.axes_manager[signal_axis_idx]
    axis.scale = energy_scale
    axis.offset = energy_offset
    axis.units = energy_units
    axis.name = 'Energy Loss'

    return signal