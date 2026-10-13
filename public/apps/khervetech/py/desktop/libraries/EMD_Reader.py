# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/EMD_Reader.py. Regenerate with tools/export_khervetech.py.
"""
EMD_Reader.py
Reader for Velox EMD files (Thermo Fisher Scientific / FEI).

Velox writes an HDF5 container in which every signal sits at

    Data/<Kind>/<uid>/Data          the numbers
    Data/<Kind>/<uid>/Metadata      a JSON document, one column per frame

and <Kind> is Image, Spectrum, SpectrumImage or SpectrumStream. An EDX map is
almost always a SpectrumStream: rather than a cube of counts, Velox stores the
raw detector event stream, a list of uint16 words in which

    0 .. 65534    an X-ray was counted in that channel of the current pixel
    65535         end of pixel, move to the next one in the scan

so the stream is read once and histogrammed back into a cube. The scan is
raster order (row by row) and repeats for every frame, which are summed.

Energy calibration comes from the analytical detector in the metadata,
'Dispersion' eV per channel and 'OffsetEnergy' eV at channel zero, or from
BinaryResult when Velox has already written the axis out.

This module provides Velox EMD reading without HyperSpy dependency.

Author: KherveFitting Project
License: BSD-3-Clause
"""

import json
import os
import re
from typing import Any, Dict, List, Optional

import numpy as np


# End-of-pixel marker in a Velox spectrum stream
STREAM_GATE = 65535

# Streams are histogrammed a chunk at a time so a long acquisition never has to
# be held in memory as one index array
STREAM_CHUNK = 4_000_000

# A 1024 x 1024 map at 4096 channels is 4.3e9 cells - 17 GB dense - so a cube
# that big has to be reduced to fit in memory. The budget is in cells; as
# uint32 this one is about 500 MB.
MAX_CUBE_CELLS = 128_000_000

# What the reduction is allowed to cost. Channels go first: an EDX peak is
# ~130 eV wide, so 20 eV channels still oversample it, while map pixels are
# looked at directly. Both floors give way if the cube is still too big.
MIN_CHANNELS = 1024
MIN_MAP_SIDE = 256


# =============================================================================
# METADATA
# =============================================================================

def read_metadata(entry) -> Dict[str, Any]:
    """
    Parse the JSON document Velox stores next to a dataset.

    It is kept as a uint8 dataset of shape (bytes, frames); the columns differ
    only in their timestamps, so the first one is enough.
    """
    dataset = entry.get('Metadata') if hasattr(entry, 'get') else None
    if dataset is None:
        return {}

    raw = np.asarray(dataset)
    if raw.ndim > 1:
        raw = raw[:, 0]

    try:
        text = raw.tobytes().rstrip(b'\x00').decode('utf-8', errors='replace')
        return json.loads(text)
    except Exception:
        return {}


def read_settings(entry) -> Dict[str, Any]:
    """Parse AcquisitionSettings, the JSON blob beside a spectrum stream"""
    dataset = entry.get('AcquisitionSettings') if hasattr(entry, 'get') else None
    if dataset is None:
        return {}

    try:
        raw = np.asarray(dataset).ravel()[0]
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', errors='replace')
        return json.loads(raw)
    except Exception:
        return {}


def _number(value, default=0.0) -> float:
    """Velox writes every number as a string; empty ones fall back to default"""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return default if not np.isfinite(result) else result


def analytical_detector(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return the EDX detector block that carries the energy calibration.

    Every document lists every detector fitted to the microscope, so the one
    wanted is an AnalyticalDetector that actually reports a dispersion. On a
    dual- or quad-detector column they all share the same calibration, so the
    first is representative.
    """
    for detector in (metadata.get('Detectors') or {}).values():
        if not isinstance(detector, dict):
            continue
        if 'Analytical' not in str(detector.get('DetectorType', '')):
            continue
        if _number(detector.get('Dispersion'), 0.0) > 0:
            return detector
    return {}


def energy_calibration(metadata: Dict[str, Any]) -> tuple:
    """
    Energy of channel zero and eV per channel, both in eV.

    BinaryResult is authoritative when it describes the energy axis; otherwise
    the detector's own dispersion is used, which is the only record a spectrum
    stream carries.
    """
    binary = metadata.get('BinaryResult') or {}

    if str(binary.get('PixelUnitX', '')).lower() == 'ev':
        dispersion = _number((binary.get('PixelSize') or {}).get('width'), 0.0)
        offset = _number((binary.get('Offset') or {}).get('x'), 0.0)
        if dispersion > 0:
            return offset, dispersion

    detector = analytical_detector(metadata)
    dispersion = _number(detector.get('Dispersion'), 10.0) or 10.0
    offset = _number(detector.get('OffsetEnergy'), 0.0)

    return offset, dispersion


def scan_shape(metadata: Dict[str, Any], settings: Dict[str, Any]) -> Optional[tuple]:
    """(height, width) of the scan, from the acquisition settings or metadata"""
    raster = settings.get('RasterScanDefinition') or {}
    height = int(_number(raster.get('Height'), 0))
    width = int(_number(raster.get('Width'), 0))

    if not (height and width):
        size = (metadata.get('Scan') or {}).get('ScanSize') or {}
        height = int(_number(size.get('height'), 0))
        width = int(_number(size.get('width'), 0))

    return (height, width) if height and width else None


def flatten_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Pull the scalar entries of the sections worth showing into one dict"""
    flat = {}
    for section in ('Core', 'Instrument', 'Acquisition', 'Optics', 'Stage', 'Scan'):
        for key, value in (metadata.get(section) or {}).items():
            if not isinstance(value, (dict, list)):
                flat[f"{section}.{key}"] = value

    detector = analytical_detector(metadata)
    for key, value in detector.items():
        if not isinstance(value, (dict, list)):
            flat[f"Detector.{key}"] = value

    return flat


# =============================================================================
# SPECTRUM STREAM DECODING
# =============================================================================

def _stream_chunks(stream):
    """Yield the stream a chunk at a time, whether it is on disk or in memory"""
    total = int(np.prod(stream.shape))
    for start in range(0, total, STREAM_CHUNK):
        yield np.asarray(stream[start:start + STREAM_CHUNK]).reshape(-1)


def survey_spectrum_stream(stream, n_bins: int) -> tuple:
    """
    First pass over a stream: the summed spectrum and how many pixels it holds.

    Reading this first is what makes the second pass affordable - it says which
    channels were ever used, so the empty top of the range (an EDX detector set
    to 40 keV rarely sees anything past 20) is never allocated.

    Returns
    -------
    (np.ndarray, int)
        Counts per channel, and the number of pixels the stream steps through
    """
    histogram = np.zeros(n_bins, dtype=np.int64)
    pixels = 0

    for chunk in _stream_chunks(stream):
        gate = chunk == STREAM_GATE
        pixels += int(gate.sum())
        channel = np.clip(chunk[~gate].astype(np.int64), 0, n_bins - 1)
        histogram += np.bincount(channel, minlength=n_bins)

    return histogram, pixels


def reduction_factors(n_used: int, height: int, width: int) -> tuple:
    """
    Channel and pixel binning needed to bring a cube within MAX_CUBE_CELLS.

    Channels are given up first, down to MIN_CHANNELS, because an EDX peak is
    far wider than a channel; then pixels, down to MIN_MAP_SIDE. If the cube is
    still too big both floors are ignored and the two are halved in turn.

    Returns
    -------
    (int, int)
        Channels summed together, pixels summed together along each side
    """
    energy, spatial = 1, 1

    def cells():
        return ((height // spatial) * (width // spatial)) * (n_used // energy)

    while cells() > MAX_CUBE_CELLS and n_used // (energy * 2) >= MIN_CHANNELS:
        energy *= 2
    while cells() > MAX_CUBE_CELLS and min(height, width) // (spatial * 2) >= MIN_MAP_SIDE:
        spatial *= 2

    # Still too big: an enormous scan, so give up the floors alternately
    while cells() > MAX_CUBE_CELLS:
        if n_used // (energy * 2) >= 64:
            energy *= 2
        elif min(height, width) // (spatial * 2) >= 8:
            spatial *= 2
        else:
            break

    return energy, spatial


def decode_spectrum_stream(stream, height: int, width: int, n_bins: int,
                           n_used: int = None, energy_bin: int = 1,
                           spatial_bin: int = 1) -> np.ndarray:
    """
    Histogram a Velox event stream into a (y, x, channel) cube.

    Every word is either a channel number - an X-ray counted in the pixel the
    stream has reached - or the 65535 marker that closes a pixel. So the pixel
    an event belongs to is simply how many markers came before it, and the scan
    wraps round for every frame, which sums them.

    Parameters
    ----------
    stream : h5py.Dataset or np.ndarray
        The raw uint16 stream
    height, width : int
        Shape of one frame of the scan
    n_bins : int
        Channels the detector was set to
    n_used : int
        Channels to keep, the rest being empty
    energy_bin, spatial_bin : int
        Channels and pixels summed together, to keep the cube in memory

    Returns
    -------
    np.ndarray
        (height // spatial_bin, width // spatial_bin, n_used // energy_bin)
    """
    n_used = n_used or n_bins
    # Rounded up so a range that does not divide evenly keeps its last channels
    channels = max(1, -(-n_used // energy_bin))
    rows = max(1, -(-height // spatial_bin))
    columns = max(1, -(-width // spatial_bin))

    n_pixels = height * width
    cube = np.zeros(rows * columns * channels, dtype=np.uint32)
    pixels_passed = 0

    for chunk in _stream_chunks(stream):
        gate = chunk == STREAM_GATE
        # Markers before each word, i.e. the pixel that word belongs to
        pixel = np.cumsum(gate, dtype=np.int64) - gate + pixels_passed
        pixels_passed = int(pixel[-1]) + int(gate[-1])

        events = ~gate
        if not events.any():
            continue

        channel = chunk[events].astype(np.int64) // energy_bin
        # Events above the used range are noise in empty channels
        keep = channel < channels
        if not keep.any():
            continue
        channel = channel[keep]

        pixel = pixel[events][keep] % n_pixels
        if spatial_bin > 1:
            pixel = ((pixel // width) // spatial_bin) * columns + \
                    ((pixel % width) // spatial_bin)
            np.clip(pixel, 0, rows * columns - 1, out=pixel)

        index = pixel * channels + channel

        # unique-then-add is far cheaper than an unbuffered scatter-add
        cells, counts = np.unique(index, return_counts=True)
        cube[cells] += counts.astype(np.uint32)

    frames = max(1, int(round(pixels_passed / n_pixels)))
    print(f"  Stream: {pixels_passed} pixels read = {frames} frame(s)")

    return cube.reshape(rows, columns, channels)


# =============================================================================
# READER
# =============================================================================

def _open_emd(filepath: str):
    """
    Open an EMD file, saying so plainly when the file is incomplete.

    HDF5 writes its directory of objects at the end, so a part-copied EMD is
    not partly readable - it is not readable at all, and the error it raises
    ("truncated file") says nothing about why.
    """
    import h5py

    try:
        return h5py.File(filepath, 'r')
    except OSError as error:
        message = str(error)
        if 'truncated' not in message.lower():
            raise

        on_disk = os.path.getsize(filepath)
        expected = re.search(r'stored_eof\s*=\s*(\d+)', message)
        expected = int(expected.group(1)) if expected else 0

        raise ValueError(
            f"This EMD file is incomplete: {on_disk / 1e6:.1f} MB of the "
            f"{expected / 1e6:.1f} MB it says it should be.\n\n"
            "The copy or download stopped early. HDF5 keeps its index of the "
            "data at the end of the file, so nothing in it can be read until "
            "the whole file is there - copy it again from the microscope.")


def describe_contents(filepath: str) -> List[str]:
    """One line per signal in the file, for reporting what a file does hold"""
    import h5py

    contents = []
    with h5py.File(filepath, 'r') as f:
        for kind in f.get('Data', {}):
            group = f['Data'][kind]
            if not isinstance(group, h5py.Group):
                continue
            for uid in group:
                entry = group[uid]
                if not isinstance(entry, h5py.Group) or 'Data' not in entry:
                    continue
                binary = (read_metadata(entry).get('BinaryResult') or {})
                detector = binary.get('Detector') or '?'
                contents.append(f"{kind} '{detector}' {entry['Data'].shape}")

    return contents


def load_emd(filepath: str) -> Dict[str, Any]:
    """
    Load the EDX spectrum or spectrum image from a Velox EMD file.

    Streams from several detectors (DualX, Super-X) are summed, which is what
    Velox itself displays.

    Parameters
    ----------
    filepath : str
        Path to the EMD file

    Returns
    -------
    dict
        'data'        counts, (y, x, channels) for a map or (channels,) for a
                      single spectrum
        'energy_axis' matching energy axis in keV (also under 'energy')
        'metadata'    flattened acquisition metadata
    """
    import h5py

    with _open_emd(filepath) as f:
        if 'Data' not in f:
            raise ValueError("Not a Velox EMD file: no 'Data' group found")

        cube = None
        spectrum = None
        metadata = {}
        shape = None
        bin_factor = 1

        streams = []
        for uid in f['Data'].get('SpectrumStream', {}):
            entry = f['Data']['SpectrumStream'][uid]
            if isinstance(entry, h5py.Group) and 'Data' in entry:
                streams.append(entry)

        for entry in streams:
            metadata = read_metadata(entry)
            settings = read_settings(entry)

            shape = scan_shape(metadata, settings)
            if shape is None:
                raise ValueError("Velox EMD spectrum stream without a scan size - "
                                 "cannot tell what shape the map was")

            height, width = shape
            n_bins = int(_number(settings.get('bincount'), 4096)) or 4096

            # First pass: which channels were used, so the empty top of the
            # range costs nothing, and how much the cube has to be reduced
            histogram, _ = survey_spectrum_stream(entry['Data'], n_bins)
            used = np.nonzero(histogram)[0]
            n_used = int(used[-1]) + 1 if used.size else n_bins

            bin_factor, spatial_bin = reduction_factors(n_used, height, width)

            frame = decode_spectrum_stream(entry['Data'], height, width, n_bins,
                                           n_used, bin_factor, spatial_bin)

            if bin_factor > 1 or spatial_bin > 1 or n_used < n_bins:
                print(f"  {height}x{width}x{n_bins} reduced to "
                      f"{frame.shape[0]}x{frame.shape[1]}x{frame.shape[2]}"
                      f" ({spatial_bin}x{spatial_bin} pixels summed, {bin_factor}"
                      f" channels summed, {n_bins - n_used} empty channels dropped)")

            cube = frame if cube is None else cube + frame
            shape = cube.shape[:2]

        # A dense spectrum image, or a single spectrum, needs no decoding
        if cube is None:
            for kind in ('SpectrumImage', 'Spectrum'):
                for uid in f['Data'].get(kind, {}):
                    entry = f['Data'][kind][uid]
                    if not isinstance(entry, h5py.Group) or 'Data' not in entry:
                        continue
                    metadata = read_metadata(entry)
                    data = np.squeeze(np.asarray(entry['Data']))
                    if data.ndim == 3:
                        shape = data.shape[:2]
                        cube = data.reshape(-1, data.shape[2])
                    else:
                        spectrum = data.reshape(-1)
                    break
                if cube is not None or spectrum is not None:
                    break

        if cube is None and spectrum is None:
            listing = '\n'.join(f"  - {item}" for item in describe_contents(filepath))
            raise ValueError(
                "No EDX data in this EMD file. It contains only:\n" +
                (listing or "  (nothing)") +
                "\n\nExport the spectrum or the spectrum image from Velox - a "
                "survey image on its own carries no X-ray counts.")

    offset_eV, dispersion_eV = energy_calibration(metadata)
    dispersion_eV *= bin_factor
    # Binning moves the first channel to the centre of the channels it covers
    offset_eV += (bin_factor - 1) * dispersion_eV / (2.0 * bin_factor)

    if cube is not None:
        data = cube.reshape(shape[0], shape[1], cube.shape[-1])
    else:
        data = spectrum

    n_channels = data.shape[-1]
    energy_axis = (offset_eV + np.arange(n_channels) * dispersion_eV) / 1000.0

    flat_metadata = flatten_metadata(metadata)
    flat_metadata['Source'] = os.path.basename(filepath)

    print(f"Loaded Velox EMD: shape {data.shape}, "
          f"{energy_axis[0]:.2f} - {energy_axis[-1]:.2f} keV "
          f"at {dispersion_eV:.1f} eV/channel")

    return {
        'data': data,
        'energy_axis': energy_axis,
        'energy': energy_axis,
        'metadata': flat_metadata,
    }
