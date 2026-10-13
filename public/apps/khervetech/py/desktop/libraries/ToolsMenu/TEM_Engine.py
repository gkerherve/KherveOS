# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_Engine.py. Regenerate with tools/export_khervetech.py.
"""
TEM analysis engine — pure numpy/scipy, no wx and no matplotlib.

Four groups of functions:

    Line profiles     sample a band of pixels along a line and average
                      across the width (``line_profile``), then find the
                      periodic maxima and the lattice spacing they imply
                      (``profile_peaks``, ``spacing_stats``)
    Region FFT        resample a rotated rectangle onto a regular grid,
                      window it and return the centred power spectrum with
                      its reciprocal calibration (``region_fft``)
    Spot detection    find diffraction spots in a power spectrum, pair the
                      Friedel mates and group them into families of equal
                      |g| (``detect_spots``, ``group_spot_families``)
    Indexing          match a set of d-spacings against the allowed
                      reflection sequences of the common structure types
                      and assign hkl (``identify_structure``), or against a
                      lattice the user names outright (``hkl_table``)
    Bragg filtering   build a soft mask over chosen spots and invert the
                      transform to reconstruct just those lattice planes
                      (``build_mask``, ``masked_inverse_fft``)
    Mapping           scan the image with a moving window for the local
                      d-spacing and orientation (``local_fft_map``), or take
                      two g-vectors and produce geometric-phase strain maps
                      (``gpa_strain``)

Conventions: reciprocal distances g are in 1/nm *without* the 2π factor, so
d = 1/g — the convention used for FFT rulers in DigitalMicrograph and in
every d-spacing table. Angles are in degrees.

Particle counting is NOT here: the SEM engine
(``libraries.ToolsMenu.SEM_Engine.analyse``) is technique-agnostic — it
takes an array, a mask and a pixel size — so the TEM window calls it
directly rather than duplicating the pipeline.
"""

import numpy as np


# ---------------------------------------------------------------------------
# Line profile
# ---------------------------------------------------------------------------

def line_profile(image, start, end, width=1):
    """Average intensity along the line ``start``->``end`` (pixel coords).

    ``width`` is the full integration width in pixels, sampled perpendicular
    to the line and *averaged* (not summed), so changing the width changes
    the noise, not the scale of the profile.

    Returns (distance_px, values): the distance from the start point of each
    sample, in pixels, ready to be multiplied by nm/px.
    """
    from scipy.ndimage import map_coordinates

    image = np.asarray(image, dtype=float)
    x0, y0 = float(start[0]), float(start[1])
    x1, y1 = float(end[0]), float(end[1])
    length = float(np.hypot(x1 - x0, y1 - y0))
    if length < 1:
        return np.array([]), np.array([])

    n_samples = int(np.ceil(length)) + 1
    t = np.linspace(0.0, 1.0, n_samples)
    xs = x0 + t * (x1 - x0)
    ys = y0 + t * (y1 - y0)

    # Perpendicular unit vector for the width band.
    px = -(y1 - y0) / length
    py = (x1 - x0) / length

    width = max(1, int(round(width)))
    offsets = (np.linspace(-(width - 1) / 2.0, (width - 1) / 2.0, width)
               if width > 1 else np.array([0.0]))

    rows = []
    for w in offsets:
        # map_coordinates wants (row, col) = (y, x); linear interpolation so
        # a 1-px line through a lattice fringe is not aliased to whole pixels.
        coords = np.vstack([ys + py * w, xs + px * w])
        rows.append(map_coordinates(image, coords, order=1, mode='nearest'))
    values = np.mean(rows, axis=0)
    distance_px = t * length
    return distance_px, values


def particle_roi_mask(roi, shape):
    """Boolean mask of the pixels a particle ROI keeps.

    ``roi`` is a shape descriptor in *image-pixel* coordinates, or None for
    the whole image:

        {'kind': 'rect',    'x0', 'y0', 'x1', 'y1'}
        {'kind': 'ellipse', 'cx', 'cy', 'rx', 'ry'}

    A square is just a rect with equal sides and a circle an ellipse with
    equal radii — the drawing code enforces that, so only two shapes reach
    here. An empty or degenerate ROI falls back to the whole image rather
    than a mask that counts nothing.
    """
    h, w = int(shape[0]), int(shape[1])
    if not roi:
        return np.ones((h, w), bool)

    kind = str(roi.get('kind', 'rect'))
    if kind == 'rect':
        x0 = max(0, min(w, int(round(min(roi['x0'], roi['x1'])))))
        x1 = max(0, min(w, int(round(max(roi['x0'], roi['x1'])))))
        y0 = max(0, min(h, int(round(min(roi['y0'], roi['y1'])))))
        y1 = max(0, min(h, int(round(max(roi['y0'], roi['y1'])))))
        mask = np.zeros((h, w), bool)
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = True
        return mask if mask.any() else np.ones((h, w), bool)

    if kind == 'ellipse':
        rx = max(1e-6, float(roi.get('rx', 0.0)))
        ry = max(1e-6, float(roi.get('ry', 0.0)))
        yy, xx = np.mgrid[0:h, 0:w]
        mask = (((xx - float(roi.get('cx', 0.0))) / rx) ** 2
                + ((yy - float(roi.get('cy', 0.0))) / ry) ** 2) <= 1.0
        return mask if mask.any() else np.ones((h, w), bool)

    return np.ones((h, w), bool)


def smooth_profile(values, window=5):
    """Gaussian-smoothed copy of a profile, for peak finding and display.

    ``window`` is the full width in samples; the Gaussian sigma is a sixth of
    it, so the kernel dies away inside the stated width. A lattice profile is
    a noisy sinusoid — smoothing is what turns a scatter of samples into the
    curve whose maxima are the fringes.
    """
    values = np.asarray(values, dtype=float)
    window = int(round(window))
    if values.size < 3 or window <= 1:
        return values.copy()
    from scipy.ndimage import gaussian_filter1d
    return gaussian_filter1d(values, sigma=max(0.5, window / 6.0),
                             mode='nearest')


def profile_peaks(distance, values, smooth=5, prominence_frac=0.10,
                  min_separation=None):
    """Locate the periodic maxima of a line profile.

    Peaks are found on the smoothed curve and then refined by a three-point
    parabolic fit, so a fringe spacing is not quantised to whole samples —
    at 0.02 nm/px a one-sample error is 10 % of a 0.2 nm lattice plane.

    ``prominence_frac`` is a fraction of the smoothed peak-to-trough range;
    ``min_separation`` is in the units of ``distance`` (None = automatic from
    the dominant period of the profile's own power spectrum).

    Returns {'positions', 'heights', 'smoothed', 'indices'} — positions in
    the units of ``distance``.
    """
    from scipy.signal import find_peaks

    distance = np.asarray(distance, dtype=float)
    values = np.asarray(values, dtype=float)
    empty = {'positions': np.array([]), 'heights': np.array([]),
             'smoothed': values.copy(), 'indices': np.array([], dtype=int)}
    if distance.size < 5 or distance.size != values.size:
        return empty

    curve = smooth_profile(values, smooth)
    span = float(curve.max() - curve.min())
    if span <= 0:
        return empty

    step = float(np.mean(np.diff(distance))) if distance.size > 1 else 1.0
    if min_separation is None:
        distance_samples = _dominant_period_samples(curve)
    else:
        distance_samples = max(1.0, float(min_separation) / max(step, 1e-12))

    indices, _props = find_peaks(curve,
                                 prominence=max(1e-12, prominence_frac * span),
                                 distance=max(1, int(round(distance_samples * 0.6))))
    if indices.size == 0:
        return {**empty, 'smoothed': curve}

    positions = []
    for i in indices:
        positions.append(_parabolic_vertex(distance, curve, int(i)))
    return {'positions': np.asarray(positions, dtype=float),
            'heights': curve[indices],
            'smoothed': curve,
            'indices': indices.astype(int)}


def _dominant_period_samples(curve):
    """Period of the strongest oscillation in a 1-D curve, in samples.

    Used only as a default minimum peak separation: the profile across a
    lattice is dominated by one frequency, and half of that period is a
    sound floor for "these are two different fringes".
    """
    curve = np.asarray(curve, dtype=float)
    n = curve.size
    if n < 8:
        return 2.0
    spectrum = np.abs(np.fft.rfft((curve - curve.mean()) * np.hanning(n)))
    if spectrum.size < 3:
        return 2.0
    # Bin 0 is the mean, already removed; bin 1 is the whole-window ramp.
    k = int(np.argmax(spectrum[2:])) + 2
    return max(2.0, n / float(k))


def _parabolic_vertex(x, y, i):
    """Sub-sample abscissa of the maximum near index ``i`` of (x, y)."""
    if i <= 0 or i >= len(y) - 1:
        return float(x[i])
    y0, y1, y2 = float(y[i - 1]), float(y[i]), float(y[i + 1])
    denominator = y0 - 2.0 * y1 + y2
    if abs(denominator) < 1e-15:
        return float(x[i])
    offset = 0.5 * (y0 - y2) / denominator
    offset = max(-1.0, min(1.0, offset))
    step = float(x[i + 1] - x[i - 1]) / 2.0
    return float(x[i]) + offset * step


def spacing_stats(positions):
    """Adjacent-peak spacings and their statistics.

    Returns {'spacings', 'mean', 'sd', 'sem', 'n_periods'} — ``n_periods`` is
    the number of measured gaps, one less than the number of peaks, which is
    what a lattice-spacing measurement is actually averaging over. ``sd`` is
    the sample standard deviation (ddof=1) so a two-peak measurement reports
    the spread honestly rather than as zero.
    """
    positions = np.sort(np.asarray(positions, dtype=float))
    spacings = np.diff(positions) if positions.size > 1 else np.array([])
    if spacings.size == 0:
        return {'spacings': spacings, 'mean': None, 'sd': None, 'sem': None,
                'n_periods': 0}
    mean = float(np.mean(spacings))
    sd = float(np.std(spacings, ddof=1)) if spacings.size > 1 else 0.0
    return {'spacings': spacings, 'mean': mean, 'sd': sd,
            'sem': sd / np.sqrt(spacings.size) if spacings.size > 1 else 0.0,
            'n_periods': int(spacings.size)}


# ---------------------------------------------------------------------------
# Rotated-region extraction and FFT
# ---------------------------------------------------------------------------

def extract_rotated_region(image, center, width, height, angle_deg):
    """Resample the rotated rectangle onto a regular (height x width) grid.

    ``center`` is (cx, cy) in pixel coordinates of ``image``; ``angle_deg``
    rotates the box anticlockwise in the image frame (the same convention as
    the on-screen ROI). Sampling is bilinear at the image's native pixel
    pitch, so the extracted grid keeps the source calibration.
    """
    from scipy.ndimage import map_coordinates

    image = np.asarray(image, dtype=float)
    w = max(2, int(round(width)))
    h = max(2, int(round(height)))
    cx, cy = float(center[0]), float(center[1])
    a = np.radians(angle_deg)
    cos_a, sin_a = np.cos(a), np.sin(a)

    # Local box coordinates, centred on the box.
    lx = np.arange(w) - (w - 1) / 2.0
    ly = np.arange(h) - (h - 1) / 2.0
    lxx, lyy = np.meshgrid(lx, ly)

    gx = cx + lxx * cos_a - lyy * sin_a
    gy = cy + lxx * sin_a + lyy * cos_a
    return map_coordinates(image, np.vstack([gy.ravel(), gx.ravel()]),
                           order=1, mode='nearest').reshape(h, w)


def region_fft_complex(region, nm_per_px=None, pad_to=None):
    """Centred complex spectrum of a real-space region, and how to undo it.

    The region is mean-subtracted and Hann-windowed (edges of a crop are
    step discontinuities that would streak the transform), then zero-padded
    into a square so both reciprocal axes share one calibration.

    Everything the inverse transform needs comes back with the spectrum, so
    a Bragg-filtered reconstruction is computed from exactly the transform
    the user masked — not from a second, subtly different one:

        spectrum      complex128, DC at the centre (fftshifted)
        recip_per_px  1/nm per pixel of the spectrum (None uncalibrated)
        placement     (y0, x0, h, w) of the region inside the padded square
    """
    region = np.asarray(region, dtype=float)
    h, w = region.shape

    region = region - region.mean()
    win = np.outer(np.hanning(h), np.hanning(w))
    region = region * win

    size = int(pad_to or max(h, w))
    size = max(size, h, w)
    if size % 2:
        size += 1
    padded = np.zeros((size, size), dtype=float)
    y0 = (size - h) // 2
    x0 = (size - w) // 2
    padded[y0:y0 + h, x0:x0 + w] = region

    spectrum = np.fft.fftshift(np.fft.fft2(padded))
    recip_per_px = None
    if nm_per_px:
        recip_per_px = 1.0 / (size * float(nm_per_px))
    return spectrum, recip_per_px, (y0, x0, h, w)


def region_fft(region, nm_per_px=None, pad_to=None):
    """Power spectrum of a real-space region, centred with fftshift.

    Returns (power, recip_per_px):
        power         2-D float32 magnitude, DC at the centre
        recip_per_px  1/nm per pixel of ``power`` (None when uncalibrated)
    """
    spectrum, recip_per_px, _placement = region_fft_complex(region, nm_per_px,
                                                            pad_to)
    return np.abs(spectrum).astype(np.float32), recip_per_px


def display_fft(power, gamma=0.5):
    """Log-stretched copy of a power spectrum for display, scaled 0..1."""
    power = np.asarray(power, dtype=float)
    # A power spectrum is a magnitude and cannot be negative, but a derived one
    # — a PCA-denoised FFT especially — can carry small negatives or NaNs from
    # the reconstruction. Those make log1p and **gamma invalid, so clean the
    # array to a non-negative, finite magnitude first.
    power = np.nan_to_num(power, nan=0.0, posinf=0.0, neginf=0.0)
    np.clip(power, 0.0, None, out=power)
    out = np.log1p(power)
    top = out.max()
    if top > 0:
        out = out / top
    if gamma != 1.0:
        np.clip(out, 0.0, None, out=out)
        out = out ** gamma
    return out


# ---------------------------------------------------------------------------
# Spot detection
# ---------------------------------------------------------------------------

def _centroid_refine(power, y, x, radius=2):
    """Sub-pixel spot position by intensity centroid in a small window."""
    h, w = power.shape
    y0, y1 = max(0, y - radius), min(h, y + radius + 1)
    x0, x1 = max(0, x - radius), min(w, x + radius + 1)
    patch = power[y0:y1, x0:x1]
    total = patch.sum()
    if total <= 0:
        return float(y), float(x)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    return float((yy * patch).sum() / total), float((xx * patch).sum() / total)


def detect_spots(power, recip_per_px=None, max_spots=30,
                 d_max_nm=2.5, d_min_nm=0.05):
    """Find diffraction spots in a centred power spectrum.

    Works on the log-stretched spectrum so weak higher-order spots are not
    drowned by the transmitted beam. The central peak and everything below
    the ``d_max_nm`` ring (long spatial wavelengths — contrast, not lattice)
    are excluded, as is the region beyond ``d_min_nm`` (numerical noise near
    Nyquist).

    Returns a list of dicts sorted by intensity:
        {'x','y'      offset from centre in pixels (x right, y down),
         'g_px'       radial distance in pixels,
         'g'          |g| in 1/nm (None uncalibrated),
         'd_nm'       1/|g| (None uncalibrated),
         'angle'      polar angle in degrees, anticlockwise from +x,
         'intensity'  log-magnitude at the spot}
    """
    from skimage.feature import peak_local_max

    power = np.asarray(power, dtype=float)
    # The origin is the array centre — but the array need not be square (an
    # imported diffraction pattern is often landscape), so the x and y centres
    # differ. Using one dimension for both mis-centres the whole search.
    h, w = power.shape[:2]
    cy, cx = h // 2, w // 2
    half = min(h, w) / 2.0
    logp = np.log1p(np.clip(np.nan_to_num(power), 0.0, None))

    yy, xx = np.mgrid[0:h, 0:w]
    r_px = np.hypot(yy - cy, xx - cx)

    # Radial exclusion: convert the d window to pixel radii when calibrated,
    # otherwise fall back to geometry-based bounds.
    if recip_per_px:
        r_lo = max(3.0, (1.0 / d_max_nm) / recip_per_px)
        r_hi = min(half - 2.0, (1.0 / d_min_nm) / recip_per_px)
    else:
        r_lo = max(3.0, min(h, w) * 0.02)
        r_hi = half - 2.0
    mask = (r_px >= r_lo) & (r_px <= r_hi)
    if not mask.any():
        return []

    # Threshold on the annulus statistics: a spot must stand clear of the
    # diffuse background, which falls off radially — the median+k*sigma of
    # the *masked* region is a serviceable global floor.
    values = logp[mask]
    floor = np.median(values) + 4.0 * values.std()

    search = np.where(mask, logp, 0.0)
    peaks = peak_local_max(search, min_distance=3, threshold_abs=floor,
                           num_peaks=max_spots * 2, exclude_border=False)

    spots = []
    for y, x in peaks:
        ry, rx = _centroid_refine(power, int(y), int(x))
        dx, dy = rx - cx, ry - cy
        g_px = float(np.hypot(dx, dy))
        if g_px < r_lo:
            continue
        g = g_px * recip_per_px if recip_per_px else None
        spots.append({
            'x': float(dx), 'y': float(dy), 'g_px': g_px,
            'g': float(g) if g else None,
            'd_nm': float(1.0 / g) if g else None,
            'angle': float(np.degrees(np.arctan2(-dy, dx))),   # y down -> flip
            'intensity': float(logp[int(y), int(x)]),
        })
        if len(spots) >= max_spots:
            break
    spots.sort(key=lambda s: -s['intensity'])
    return spots


def pair_friedel_mates(spots, tol_px=3.0):
    """Group spots with their centrosymmetric (g, -g) partners.

    A real diffraction spot has a Friedel mate; a peak without one is
    usually noise or the tail of the central beam, so unpaired spots are
    dropped. Returns a list of pairs' *mean* geometry (one entry per g
    direction, angle folded into [0, 180)).
    """
    used = [False] * len(spots)
    pairs = []
    for i, a in enumerate(spots):
        if used[i]:
            continue
        for j in range(i + 1, len(spots)):
            if used[j]:
                continue
            b = spots[j]
            if (abs(a['x'] + b['x']) <= tol_px
                    and abs(a['y'] + b['y']) <= tol_px):
                used[i] = used[j] = True
                merged = dict(a)
                merged['g_px'] = (a['g_px'] + b['g_px']) / 2.0
                if a.get('g') and b.get('g'):
                    merged['g'] = (a['g'] + b['g']) / 2.0
                    merged['d_nm'] = 1.0 / merged['g']
                merged['angle'] = a['angle'] % 180.0
                merged['intensity'] = max(a['intensity'], b['intensity'])
                pairs.append(merged)
                break
    return pairs


def group_spot_families(spots, tol=0.03):
    """Group paired spots into families of equal |g| (within ``tol``, relative).

    Returns a list sorted by d descending:
        {'d_nm' or 'g_px', 'members': [spots], 'count', 'angles': [deg]}
    """
    remaining = sorted(spots, key=lambda s: s['g_px'])
    families = []
    for spot in remaining:
        placed = False
        for family in families:
            ref = family['g_px']
            if abs(spot['g_px'] - ref) <= tol * ref:
                family['members'].append(spot)
                family['g_px'] = float(np.mean([m['g_px']
                                                for m in family['members']]))
                placed = True
                break
        if not placed:
            families.append({'g_px': spot['g_px'], 'members': [spot]})

    out = []
    for family in families:
        members = family['members']
        gs = [m['g'] for m in members if m.get('g')]
        entry = {
            'g_px': family['g_px'],
            'count': len(members),
            'members': members,
            'angles': sorted(m['angle'] for m in members),
            'g': float(np.mean(gs)) if gs else None,
            'd_nm': float(1.0 / np.mean(gs)) if gs else None,
            'intensity': float(max(m['intensity'] for m in members)),
        }
        out.append(entry)
    out.sort(key=lambda f: f['g_px'])
    return out


def angles_between_families(families):
    """Unique inter-family angles (deg, folded to [0, 90]) for the report."""
    angles = []
    for i, fa in enumerate(families):
        for fb in families[i + 1:]:
            if not fa['angles'] or not fb['angles']:
                continue
            diff = abs(fa['angles'][0] - fb['angles'][0]) % 180.0
            if diff > 90.0:
                diff = 180.0 - diff
            angles.append((fa.get('d_nm'), fb.get('d_nm'), diff))
    return angles


# ---------------------------------------------------------------------------
# Structure identification from d-spacing ratios
# ---------------------------------------------------------------------------
#
# For a cubic lattice 1/d^2 = N/a^2 with N = h^2+k^2+l^2, so the *ratios*
# d_1^2/d_i^2 form a sequence of small integers characteristic of the
# lattice type regardless of a. The allowed N sequences:
#
#   SC       1,2,3,4,5,6,8,...          (all hkl)
#   BCC      2,4,6,8,10,12,14,...       (h+k+l even)
#   FCC      3,4,8,11,12,16,19,20,...   (h,k,l all odd or all even)
#   Diamond  3,8,11,16,19,24,27,...     (FCC minus the 200-type)
#
# HCP is matched the same way through the equivalent quadratic form
# 1/d^2 = (4/3(h^2+hk+k^2) + l^2/(c/a)^2) / a^2 evaluated at the ideal
# c/a = 1.633, normalised to its first reflection.
#
# A single FFT sees only the reflections in one zone axis, so the matcher
# scores by how many measured families it can place, not by requiring the
# full powder sequence — and it reports the lattice parameter implied by
# every assignment so an inconsistent match is visible immediately.

_CUBIC_HKL = {
    1: '100', 2: '110', 3: '111', 4: '200', 5: '210', 6: '211', 8: '220',
    9: '221/300', 10: '310', 11: '311', 12: '222', 13: '320', 14: '321',
    16: '400', 17: '410', 18: '411/330', 19: '331', 20: '420', 21: '421',
    22: '332', 24: '422', 25: '500/430', 26: '510/431', 27: '511/333',
    29: '520/432', 30: '521', 32: '440',
}


def _cubic_sequence(rule, n_max=33):
    out = []
    for n in range(1, n_max):
        found = None
        for h in range(0, 6):
            for k in range(0, h + 1):
                for l in range(0, k + 1):
                    if h * h + k * k + l * l != n:
                        continue
                    if rule(h, k, l):
                        found = (h, k, l)
                        break
                if found:
                    break
            if found:
                break
        if found and found != (0, 0, 0):
            out.append((n, _CUBIC_HKL.get(n, f'{found[0]}{found[1]}{found[2]}')))
    return out


def _hcp_sequence(c_over_a=1.633, n_reflections=12):
    """(Q, 'hkl') pairs for HCP, Q = a^2/d^2, sorted ascending."""
    seen = {}
    for h in range(0, 4):
        for k in range(0, 4):
            for l in range(0, 5):
                if h == 0 and k == 0 and l == 0:
                    continue
                # HCP structure factor: forbidden when h+2k = 3m and l odd.
                if (h + 2 * k) % 3 == 0 and l % 2 == 1:
                    continue
                q = 4.0 / 3.0 * (h * h + h * k + k * k) + (l / c_over_a) ** 2
                label = f'{h}{k}{l}'
                if all(abs(q - q0) > 1e-6 for q0 in seen):
                    seen[q] = label
    ordered = sorted(seen.items())[:n_reflections]
    return [(q, label) for q, label in ordered]


STRUCTURES = {
    'FCC': _cubic_sequence(lambda h, k, l:
                           (h % 2 == k % 2 == l % 2)),
    'BCC': _cubic_sequence(lambda h, k, l: (h + k + l) % 2 == 0),
    'Simple cubic': _cubic_sequence(lambda h, k, l: True),
    'Diamond cubic': _cubic_sequence(
        lambda h, k, l: (h % 2 == k % 2 == l % 2 == 1)
        or ((h % 2 == k % 2 == l % 2 == 0) and (h + k + l) % 4 == 0)),
    'HCP (c/a=1.633)': _hcp_sequence(),
}


# A d-ratio pattern is often consistent with more than one lattice (a BCC
# powder sequence indexes perfectly as SC, and as the even-index subset of
# FCC), so exact ties are broken by prevalence among real materials.
_STRUCTURE_PREFERENCE = ('FCC', 'BCC', 'HCP (c/a=1.633)', 'Diamond cubic',
                         'Simple cubic')


def identify_structure(d_spacings, tol=0.04):
    """Match measured d-spacings against the standard structure sequences.

    ``d_spacings`` in nm, any order. For each candidate structure the
    largest measured d is anchored to each of the first few allowed
    reflections in turn; every other spacing is then placed on the implied
    sequence position or counted as a miss.

    The score rewards two things: how many *measured* spacings the structure
    places, and how many of the structure's *expected* reflections in the
    measured range were actually seen. The second term is what separates
    degenerate candidates — a BCC pattern also fits FCC as {200, 220, 222},
    but only by silently skipping 111 and 311, which the completeness term
    punishes.

    Returns a list of candidate dicts sorted by score:
        {'structure', 'score', 'matched', 'total', 'completeness',
         'a_nm'        mean lattice parameter from the assignments,
         'a_spread'    relative spread of a (consistency check),
         'assignments' [{'d_nm', 'hkl', 'a_nm'} or {'d_nm', 'hkl': None}]}
    """
    ds = sorted((float(d) for d in d_spacings if d and d > 0), reverse=True)
    if not ds:
        return []

    results = []
    for name, sequence in STRUCTURES.items():
        if not sequence:
            continue
        best = None
        # Anchor the largest d to each of the first candidate reflections:
        # the strongest low-order spot is not always the first allowed one
        # (a zone axis may simply not contain it).
        for anchor_idx in range(min(4, len(sequence))):
            q_anchor = sequence[anchor_idx][0]
            # a^2 = d^2 * Q  (cubic: Q = N)
            a_sq = ds[0] ** 2 * q_anchor
            assignments = []
            spread_as = []
            hit_qs = set()
            matched = 0
            for d in ds:
                q_implied = a_sq / (d * d)
                hit = None
                for q, label in sequence:
                    if abs(q - q_implied) <= tol * q_implied + 1e-9:
                        hit = (q, label)
                        break
                if hit:
                    a_nm = d * np.sqrt(hit[0])
                    assignments.append({'d_nm': d, 'hkl': hit[1],
                                        'a_nm': float(a_nm)})
                    spread_as.append(a_nm)
                    hit_qs.add(hit[0])
                    matched += 1
                else:
                    assignments.append({'d_nm': d, 'hkl': None, 'a_nm': None})
            if matched == 0:
                continue
            # Completeness: of the reflections this structure allows between
            # the smallest and largest matched Q, how many were observed?
            q_lo, q_hi = min(hit_qs), max(hit_qs)
            expected = [q for q, _ in sequence
                        if q_lo - 1e-9 <= q <= q_hi + 1e-9]
            completeness = len(hit_qs) / len(expected) if expected else 0.0
            a_mean = float(np.mean(spread_as))
            a_spread = (float(np.std(spread_as) / a_mean)
                        if len(spread_as) > 1 else 0.0)
            score = (0.6 * matched / len(ds) + 0.4 * completeness
                     - 2.0 * a_spread - 0.02 * anchor_idx)
            candidate = {'structure': name, 'score': float(score),
                         'matched': matched, 'total': len(ds),
                         'completeness': float(completeness),
                         'a_nm': a_mean, 'a_spread': a_spread,
                         'assignments': assignments}
            if best is None or candidate['score'] > best['score']:
                best = candidate
        if best:
            results.append(best)

    preference = {name: i for i, name in enumerate(_STRUCTURE_PREFERENCE)}
    results.sort(key=lambda r: (-round(r['score'], 6),
                                preference.get(r['structure'], 99)))
    return results


# ---------------------------------------------------------------------------
# Indexing against a lattice the user names
# ---------------------------------------------------------------------------
#
# ``identify_structure`` above works blind, from the ratios alone. This is the
# other half of the job: the user already suspects what the material is, so
# they give the structure type and the lattice parameter and ask how well the
# measured spacings agree. The answer is a percentage error per spacing, which
# is the number that decides whether the candidate is right.

LATTICE_SYSTEMS = ('FCC', 'BCC', 'Simple cubic', 'Diamond cubic',
                   'HCP', 'Tetragonal (body-centred)', 'Tetragonal (primitive)')

# Systems whose d-spacings need a c as well as an a.
_NEEDS_C = ('HCP', 'Tetragonal (body-centred)', 'Tetragonal (primitive)')


def system_needs_c(system):
    return str(system) in _NEEDS_C


def _reflections(system, a_nm, c_nm=None, n_max=6):
    """Allowed (hkl, d_nm) of a named lattice, largest d first."""
    a = float(a_nm)
    c = float(c_nm) if c_nm else a
    if a <= 0 or c <= 0:
        return []

    def allowed(h, k, l):
        if system == 'FCC':
            return h % 2 == k % 2 == l % 2
        if system == 'BCC' or system == 'Tetragonal (body-centred)':
            return (h + k + l) % 2 == 0
        if system == 'Diamond cubic':
            return ((h % 2 == k % 2 == l % 2 == 1)
                    or ((h % 2 == k % 2 == l % 2 == 0) and (h + k + l) % 4 == 0))
        if system == 'HCP':
            return not ((h + 2 * k) % 3 == 0 and l % 2 == 1)
        return True

    out = {}
    for h in range(0, n_max + 1):
        for k in range(0, n_max + 1):
            for l in range(0, n_max + 1):
                if h == k == l == 0 or not allowed(h, k, l):
                    continue
                if system == 'HCP':
                    inv_d2 = (4.0 / 3.0 * (h * h + h * k + k * k) / (a * a)
                              + (l * l) / (c * c))
                elif system.startswith('Tetragonal'):
                    inv_d2 = (h * h + k * k) / (a * a) + (l * l) / (c * c)
                else:
                    inv_d2 = (h * h + k * k + l * l) / (a * a)
                if inv_d2 <= 0:
                    continue
                d = 1.0 / np.sqrt(inv_d2)
                # Keep one label per distinct spacing: {200} and {020} are the
                # same ring and listing both only pads the table. The label is
                # the conventional representative — indices descending, so the
                # family reads as 110 rather than 011. In the uniaxial systems
                # l is not interchangeable with h and k, so only those two sort.
                if system == 'HCP' or system.startswith('Tetragonal'):
                    label = f'{max(h, k)}{min(h, k)}{l}'
                else:
                    label = ''.join(str(i) for i in sorted((h, k, l), reverse=True))
                key = round(d, 6)
                if key not in out:
                    out[key] = label
    return sorted(((d, hkl) for d, hkl in out.items()), reverse=True)


def hkl_table(d_measured, system, a_nm, c_nm=None, tol_percent=5.0):
    """Match measured d-spacings against a lattice the user specified.

    Returns (rows, summary) where each row is
        {'d_nm', 'hkl', 'd_calc_nm', 'error_percent'}   (hkl None = no match
        inside ``tol_percent``)
    and ``summary`` is {'matched', 'total', 'rms_percent', 'a_refined_nm'} —
    ``a_refined_nm`` being the lattice parameter the matched spacings imply,
    which is the honest answer when the entered a is close but not exact.
    """
    reflections = _reflections(system, a_nm, c_nm)
    rows = []
    errors = []
    scale_ratios = []
    for d in sorted((float(x) for x in d_measured if x and x > 0), reverse=True):
        best = None
        for d_calc, hkl in reflections:
            error = (d - d_calc) / d_calc * 100.0
            if best is None or abs(error) < abs(best[2]):
                best = (d_calc, hkl, error)
        if best and abs(best[2]) <= float(tol_percent):
            rows.append({'d_nm': d, 'hkl': best[1], 'd_calc_nm': best[0],
                         'error_percent': best[2]})
            errors.append(best[2])
            scale_ratios.append(d / best[0])
        else:
            rows.append({'d_nm': d, 'hkl': None, 'd_calc_nm': None,
                         'error_percent': None})
    summary = {
        'matched': len(errors), 'total': len(rows),
        'rms_percent': float(np.sqrt(np.mean(np.square(errors)))) if errors else None,
        'a_refined_nm': (float(a_nm) * float(np.mean(scale_ratios))
                         if scale_ratios else None),
    }
    return rows, summary


# ---------------------------------------------------------------------------
# Bragg filtering: FFT masks and the inverse transform
# ---------------------------------------------------------------------------
#
# A mask region is stored in the same coordinates as a measured spot —
# pixels from the centre of the spectrum, x right and y down — so a region
# placed on a spot stays on it through every redraw and recalibration.
#
#     {'kind': 'circle',  'x', 'y', 'r'}
#     {'kind': 'ellipse', 'x', 'y', 'rx', 'ry', 'angle'}
#     {'kind': 'polygon', 'points': [[x, y], ...]}
#
# The edges are softened before the inverse transform. A hard-edged aperture
# is a sinc in real space, and the reconstruction then rings with fringes
# that are an artefact of the aperture rather than of the lattice.


def _region_mask(shape, region):
    """Boolean mask of one region on an array of ``shape`` (centre-origin)."""
    height, width = shape
    cy, cx = height // 2, width // 2
    yy, xx = np.mgrid[0:height, 0:width]
    dx = xx - cx
    dy = yy - cy

    kind = str(region.get('kind', 'circle'))
    if kind == 'circle':
        r = max(1e-6, float(region.get('r', 5.0)))
        return ((dx - float(region.get('x', 0.0))) ** 2
                + (dy - float(region.get('y', 0.0))) ** 2) <= r * r
    if kind == 'ellipse':
        rx = max(1e-6, float(region.get('rx', 5.0)))
        ry = max(1e-6, float(region.get('ry', 5.0)))
        angle = np.radians(float(region.get('angle', 0.0)))
        ox = dx - float(region.get('x', 0.0))
        oy = dy - float(region.get('y', 0.0))
        # Rotate into the ellipse's own frame (y down, so the sign of the
        # sine terms follows the on-screen angle convention).
        rot_x = ox * np.cos(angle) + oy * np.sin(angle)
        rot_y = -ox * np.sin(angle) + oy * np.cos(angle)
        return (rot_x / rx) ** 2 + (rot_y / ry) ** 2 <= 1.0
    if kind == 'polygon':
        points = np.asarray(region.get('points') or [], dtype=float)
        if points.shape[0] < 3:
            return np.zeros(shape, dtype=bool)
        from matplotlib.path import Path
        path = Path(points)
        inside = path.contains_points(
            np.column_stack([dx.ravel(), dy.ravel()]))
        return inside.reshape(shape)
    return np.zeros(shape, dtype=bool)


def build_mask(shape, regions, symmetric=True, smooth_px=2.0,
               include_dc=False, dc_radius_px=3.0):
    """Soft 0..1 aperture over ``regions``, ready to multiply a spectrum.

    ``symmetric`` adds each region's centrosymmetric partner, which is what
    makes the reconstruction real: a lattice fringe is the sum of +g and -g,
    and keeping only one of them halves the amplitude and shifts the phase.

    ``include_dc`` keeps the transmitted beam, so the reconstruction carries
    the region's mean brightness instead of oscillating about zero.
    """
    shape = (int(shape[0]), int(shape[1]))
    mask = np.zeros(shape, dtype=bool)
    for region in (regions or []):
        mask |= _region_mask(shape, region)
        if symmetric:
            mask |= _region_mask(shape, _mirror_region(region))
    if include_dc:
        mask |= _region_mask(shape, {'kind': 'circle', 'x': 0.0, 'y': 0.0,
                                     'r': max(1.0, float(dc_radius_px))})
    if not mask.any():
        return np.zeros(shape, dtype=float)

    soft = mask.astype(float)
    if smooth_px and smooth_px > 0:
        from scipy.ndimage import gaussian_filter
        soft = gaussian_filter(soft, sigma=float(smooth_px))
        top = soft.max()
        if top > 0:
            soft = np.clip(soft / top, 0.0, 1.0)
    return soft


def _mirror_region(region):
    """The centrosymmetric partner of a mask region."""
    mirrored = dict(region)
    if region.get('kind') == 'polygon':
        points = np.asarray(region.get('points') or [], dtype=float)
        mirrored['points'] = (-points).tolist() if points.size else []
    else:
        mirrored['x'] = -float(region.get('x', 0.0))
        mirrored['y'] = -float(region.get('y', 0.0))
        if 'angle' in region:
            mirrored['angle'] = float(region['angle'])
    return mirrored


def masked_inverse_fft(region_image, mask, nm_per_px=None, pad_to=None):
    """Reconstruct the real-space image from the masked spectrum.

    ``region_image`` is the same real-space crop the FFT was computed from,
    so the transform being inverted is exactly the one on screen. The mask is
    applied to the centred spectrum, the transform is inverted, and the
    padding is cropped away again.

    Returns (filtered, amplitude):
        filtered   real part — the lattice fringes themselves
        amplitude  |complex| — the envelope, which shows where those planes
                   are actually present in the field of view
    """
    spectrum, _recip, (y0, x0, h, w) = region_fft_complex(
        region_image, nm_per_px, pad_to)
    mask = np.asarray(mask, dtype=float)
    if mask.shape != spectrum.shape:
        raise ValueError(f'Mask {mask.shape} does not match the spectrum '
                         f'{spectrum.shape}')
    image = np.fft.ifft2(np.fft.ifftshift(spectrum * mask))
    crop = (slice(y0, y0 + h), slice(x0, x0 + w))
    return (np.real(image)[crop].astype(np.float32),
            np.abs(image)[crop].astype(np.float32))


# ---------------------------------------------------------------------------
# Local FFT mapping
# ---------------------------------------------------------------------------

def local_fft_map(image, nm_per_px, window_px=128, step_px=32,
                  target_g_px=None, tolerance=0.25, progress=None):
    """Map the local lattice spacing and orientation across an image.

    A window is stepped over the image; each position gets its own FFT, and
    the strongest spot inside the acceptance band is measured. With
    ``target_g_px`` given (in pixels of the *window's* spectrum) only spots
    within ``tolerance`` of that radius count, which is how one set of planes
    is followed across a grain rather than whichever spot happens to be
    brightest.

    ``progress(fraction)`` is called as the scan proceeds; returning False
    from it cancels and yields whatever was finished.

    Returns {'d_nm', 'angle_deg', 'g_px', 'valid', 'window_px', 'step_px',
             'origin_px'} — 2-D arrays over the window centres, NaN where no
    spot was found.
    """
    image = np.asarray(image, dtype=float)
    height, width = image.shape[:2]
    window = int(max(16, min(window_px, min(height, width))))
    if window % 2:
        window += 1
    step = int(max(1, step_px))

    y_starts = list(range(0, max(1, height - window + 1), step))
    x_starts = list(range(0, max(1, width - window + 1), step))
    if not y_starts or not x_starts:
        return None

    recip_per_px = (1.0 / (window * float(nm_per_px))) if nm_per_px else None
    hann = np.outer(np.hanning(window), np.hanning(window))
    centre = window // 2
    yy, xx = np.mgrid[0:window, 0:window]
    radius = np.hypot(yy - centre, xx - centre)

    # The usable annulus: inside r_lo is the transmitted beam and the slow
    # contrast variation, outside r_hi is Nyquist noise.
    if target_g_px:
        r_lo = max(2.0, float(target_g_px) * (1.0 - tolerance))
        r_hi = min(window / 2.0 - 1.0, float(target_g_px) * (1.0 + tolerance))
    else:
        r_lo = max(3.0, window * 0.04)
        r_hi = window / 2.0 - 1.0
    band = (radius >= r_lo) & (radius <= r_hi)
    if not band.any():
        return None

    d_map = np.full((len(y_starts), len(x_starts)), np.nan)
    angle_map = np.full_like(d_map, np.nan)
    g_map = np.full_like(d_map, np.nan)

    total = len(y_starts) * len(x_starts)
    done = 0
    for iy, y in enumerate(y_starts):
        for ix, x in enumerate(x_starts):
            patch = image[y:y + window, x:x + window]
            patch = (patch - patch.mean()) * hann
            power = np.abs(np.fft.fftshift(np.fft.fft2(patch)))
            power = np.where(band, power, 0.0)
            flat = int(np.argmax(power))
            py, px = divmod(flat, window)
            if power[py, px] <= 0:
                continue
            ry, rx = _centroid_refine(power, py, px, radius=2)
            dx, dy = rx - centre, ry - centre
            g_px = float(np.hypot(dx, dy))
            if g_px < r_lo:
                continue
            g_map[iy, ix] = g_px
            angle_map[iy, ix] = float(np.degrees(np.arctan2(-dy, dx))) % 180.0
            if recip_per_px:
                d_map[iy, ix] = 1.0 / (g_px * recip_per_px)
        done += len(x_starts)
        if progress is not None and progress(done / total) is False:
            break

    return {'d_nm': d_map, 'angle_deg': angle_map,
            'angle_rel_deg': centre_orientation(angle_map), 'g_px': g_map,
            'valid': np.isfinite(g_map),
            'window_px': window, 'step_px': step,
            'origin_px': (float(x_starts[0] + window / 2.0),
                          float(y_starts[0] + window / 2.0))}


def centre_orientation(angle_deg):
    """Re-express plane orientations as a departure from their mean.

    An orientation lives on [0, 180) and wraps, so a grain sitting at 0°
    scatters its pixels between 0 and 180 and a plain colour scale paints it
    as maximum contrast. Doubling the angle turns the axis into a proper
    direction, the mean of which is well defined; the residual is folded back
    to (-90, 90] and is what a strain- or bending-contrast map should show.
    """
    angles = np.asarray(angle_deg, dtype=float)
    finite = np.isfinite(angles)
    if not finite.any():
        return angles
    doubled = np.radians(2.0 * angles[finite])
    mean = np.arctan2(np.mean(np.sin(doubled)), np.mean(np.cos(doubled)))
    out = np.full_like(angles, np.nan)
    residual = np.degrees(np.angle(np.exp(1j * (doubled - mean)))) / 2.0
    out[finite] = residual
    return out


# ---------------------------------------------------------------------------
# Geometric phase analysis (GPA)
# ---------------------------------------------------------------------------
#
# Hytch's method. For a chosen reciprocal vector g the Bragg-filtered complex
# image H_g(r) carries a phase whose departure from 2*pi*g.r is the local
# displacement of those planes:
#
#     P_g(r) = angle(H_g) - 2*pi*g.r        and      P_g = -2*pi*g.u(r)
#
# Two non-collinear g-vectors give the full 2-D displacement field, and its
# gradient is the distortion tensor. The gradient is taken from the complex
# field (Im(grad H / H)) rather than from the wrapped phase, so no phase
# unwrapping is needed — a wrapped phase differentiates correctly and only
# the branch cut, which the imaginary-part form never sees, is a problem.


def _bragg_component(spectrum, g_px, mask_radius_px):
    """Complex Bragg-filtered image for one g, with a Gaussian aperture."""
    size = spectrum.shape[0]
    centre = size // 2
    yy, xx = np.mgrid[0:size, 0:size]
    dx = xx - centre - float(g_px[0])
    dy = yy - centre - float(g_px[1])
    sigma = max(1.0, float(mask_radius_px)) / 2.0
    aperture = np.exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma))
    return np.fft.ifft2(np.fft.ifftshift(spectrum * aperture))


def _phase_gradient(component, g_px, size):
    """(dP/dx, dP/dy) of the geometric phase, in radians per pixel."""
    # Im(grad H / H) is the gradient of the raw phase, wrapping and all.
    safe = np.where(np.abs(component) < 1e-12, 1e-12, component)
    grad_y, grad_x = np.gradient(component)
    dphi_dx = np.imag(grad_x / safe)
    dphi_dy = np.imag(grad_y / safe)
    # Subtract the carrier 2*pi*g.r, whose gradient is 2*pi*g (per pixel).
    return (dphi_dx - 2.0 * np.pi * float(g_px[0]) / size,
            dphi_dy - 2.0 * np.pi * float(g_px[1]) / size)


def gpa_strain(region_image, g1_px, g2_px, mask_radius_px=None,
               nm_per_px=None, smooth_px=3.0):
    """Strain maps from two g-vectors of a lattice image.

    ``g1_px`` / ``g2_px`` are (x, y) offsets from the centre of the region's
    own spectrum, in pixels — exactly what a measured spot carries. They must
    not be collinear: two parallel g-vectors describe one set of planes and
    the system is singular.

    Returns {'exx', 'eyy', 'exy', 'rotation', 'shape'} — dimensionless
    strains (multiply by 100 for %) and rotation in degrees, referenced to
    the *average* lattice of the region, which is the usual convention when
    no unstrained reference area has been nominated.
    """
    region_image = np.asarray(region_image, dtype=float)
    spectrum, _recip, (y0, x0, h, w) = region_fft_complex(region_image,
                                                          nm_per_px)
    size = spectrum.shape[0]

    g1 = (float(g1_px[0]), float(g1_px[1]))
    g2 = (float(g2_px[0]), float(g2_px[1]))
    matrix = np.array([[g1[0], g1[1]], [g2[0], g2[1]]], dtype=float)
    if abs(np.linalg.det(matrix)) < 1e-9:
        raise ValueError('The two g-vectors are collinear — pick spots from '
                         'two different sets of planes.')

    if not mask_radius_px:
        # Half the shorter g keeps the two apertures from overlapping while
        # still passing enough of the sideband to resolve strain.
        mask_radius_px = 0.25 * min(np.hypot(*g1), np.hypot(*g2))

    gradients = []
    for g in (g1, g2):
        component = _bragg_component(spectrum, g, mask_radius_px)
        gradients.append(_phase_gradient(component, g, size))

    # Rows: dP_i/dx, dP_i/dy. D = -(1/2pi) A^-1 [dP/dx dP/dy].
    stacked = np.array([[gradients[0][0], gradients[0][1]],
                        [gradients[1][0], gradients[1][1]]])
    inverse = np.linalg.inv(matrix) * size
    distortion = np.einsum('ij,jkyx->ikyx', inverse, stacked) / (-2.0 * np.pi)

    crop = (slice(y0, y0 + h), slice(x0, x0 + w))
    exx = distortion[0, 0][crop]
    exy_raw = distortion[0, 1][crop]
    eyx_raw = distortion[1, 0][crop]
    eyy = distortion[1, 1][crop]

    exy = 0.5 * (exy_raw + eyx_raw)
    rotation = np.degrees(0.5 * (eyx_raw - exy_raw))

    if smooth_px and smooth_px > 0:
        from scipy.ndimage import gaussian_filter
        exx, eyy, exy, rotation = (gaussian_filter(m, sigma=float(smooth_px))
                                   for m in (exx, eyy, exy, rotation))

    # Reference the strain to the region's own mean lattice.
    exx = exx - np.nanmean(exx)
    eyy = eyy - np.nanmean(eyy)
    exy = exy - np.nanmean(exy)
    rotation = rotation - np.nanmean(rotation)
    return {'exx': exx.astype(np.float32), 'eyy': eyy.astype(np.float32),
            'exy': exy.astype(np.float32),
            'rotation': rotation.astype(np.float32), 'shape': (h, w)}


# ---------------------------------------------------------------------------
# PCA denoising
# ---------------------------------------------------------------------------
#
# A single image is turned into an "observations x features" matrix, PCA is
# fitted, and the image is rebuilt from only the leading components. The small
# components carry the variance that is uncorrelated between observations —
# the noise — so dropping them cleans the image while the reconstruction adds
# the mean back, so the greyscale is preserved.
#
# Two ways to define an observation, chosen by the caller:
#
#   line     each image row (or column) is one observation. The features are
#            the pixels along the line. This exploits redundancy *between*
#            lines, so it is at its best where the structure repeats along one
#            axis (lattice fringes, a stack of line scans).
#   patch    each small overlapping tile is one observation, flattened to a
#            vector of its pixels. This exploits redundancy between *similar
#            tiles* anywhere in the field — the standard local-PCA image
#            denoiser, and the better default for a general micrograph.


def _line_matrix(image, axis=0):
    """(observations x features) matrix for line-wise PCA, and how to undo it.

    ``axis=0`` makes each row an observation; ``axis=1`` each column. The
    restore callback turns a reconstructed matrix of the same shape back into
    an image with the original orientation.
    """
    img = np.asarray(image, dtype=float)
    if axis == 0:
        return img, (lambda m: m)
    return img.T, (lambda m: m.T)


def _patch_coords(height, width, patch, stride):
    """Top-left (y, x) of every tile, always covering the bottom/right edges."""
    p = int(patch)
    s = max(1, int(stride))
    ys = list(range(0, max(1, height - p + 1), s))
    xs = list(range(0, max(1, width - p + 1), s))
    if ys[-1] != height - p:
        ys.append(max(0, height - p))
    if xs[-1] != width - p:
        xs.append(max(0, width - p))
    return [(y, x) for y in ys for x in xs]


def _patch_matrix(image, patch, stride):
    """(n_patches x patch*patch) matrix, its tile coords and the padded patch."""
    img = np.asarray(image, dtype=float)
    h, w = img.shape[:2]
    p = int(min(patch, h, w))
    p = max(2, p)
    coords = _patch_coords(h, w, p, stride)
    patches = np.stack([img[y:y + p, x:x + p].ravel() for y, x in coords])
    return patches, coords, p


def _fit_pca(matrix, n_components):
    """Fit sklearn PCA on ``matrix`` with a clamped component count."""
    from sklearn.decomposition import PCA
    n_obs, n_feat = matrix.shape
    k = int(max(1, min(int(n_components), n_obs, n_feat)))
    model = PCA(n_components=k)
    scores = model.fit_transform(matrix)
    return model, scores, k


def pca_denoise_lines(image, n_components, axis=0):
    """Line-wise PCA reconstruction of ``image`` from ``n_components`` PCs.

    Returns a float32 array the same shape as ``image``.
    """
    matrix, restore = _line_matrix(image, axis)
    model, scores, _ = _fit_pca(matrix, n_components)
    recon = model.inverse_transform(scores)
    return np.asarray(restore(recon), dtype=np.float32)


def pca_denoise_patches(image, n_components, patch=8, stride=4):
    """Patch-based (local) PCA reconstruction of ``image``.

    Overlapping tiles are reconstructed from ``n_components`` PCs and averaged
    back into place, so every pixel is the mean of the reconstructions of the
    tiles that covered it. Returns a float32 array the shape of ``image``.
    """
    img = np.asarray(image, dtype=float)
    h, w = img.shape[:2]
    patches, coords, p = _patch_matrix(img, patch, stride)
    model, scores, _ = _fit_pca(patches, n_components)
    recon = model.inverse_transform(scores)

    out = np.zeros((h, w), dtype=float)
    weight = np.zeros((h, w), dtype=float)
    for (y, x), row in zip(coords, recon):
        out[y:y + p, x:x + p] += row.reshape(p, p)
        weight[y:y + p, x:x + p] += 1.0
    weight[weight == 0] = 1.0
    return (out / weight).astype(np.float32)


def pca_variance_ratio(image, mode='patch', axis=0, patch=8, stride=4,
                       max_components=25):
    """Explained-variance ratio per component, for a scree read-out.

    Returns the per-component ratio array (already sorted, largest first) for
    however the caller intends to build the matrix, so the UI can show how many
    components carry signal before the tail flattens into noise.
    """
    if mode == 'line':
        matrix, _ = _line_matrix(image, axis)
    else:
        matrix, _coords, _p = _patch_matrix(image, patch, stride)
    model, _scores, _k = _fit_pca(matrix, max_components)
    return np.asarray(model.explained_variance_ratio_, dtype=float)


def pca_analyse(image, mode='patch', axis=0, patch=8, stride=4,
                max_components=12):
    """Fit PCA and return the diagnostics a plots window needs.

    ``loadings`` are the principal-component patterns (``model.components_``):
    for line mode each is a 1-D vector over the pixels along a line; for patch
    mode each is a ``patch x patch`` image, so ``feat_shape`` says how to
    reshape it. ``explained_variance_ratio`` is per component, largest first.
    """
    if mode == 'line':
        matrix, _ = _line_matrix(image, axis)
        feat_shape = None
    else:
        matrix, _coords, p = _patch_matrix(image, patch, stride)
        feat_shape = (p, p)
    model, _scores, _k = _fit_pca(matrix, max_components)
    return {
        'explained_variance_ratio': np.asarray(model.explained_variance_ratio_,
                                                dtype=float),
        'loadings': np.asarray(model.components_, dtype=float),
        'feat_shape': feat_shape,
        'n_features': int(matrix.shape[1]),
        'n_observations': int(matrix.shape[0]),
    }
