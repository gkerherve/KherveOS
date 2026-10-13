# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/AFM_Engine.py. Regenerate with tools/export_khervetech.py.
"""
AFM image and force-curve processing. Pure numpy — no GUI, no wx.

The image half implements the standard SPM corrections and measurements in
the shapes Gwyddion made canonical:

- **Leveling**: an AFM height image is acquired line by line, so it carries
  two artefacts a micrograph does not — an overall tilt (the sample is never
  mounted perfectly flat) and line-to-line offsets (thermal drift and PID
  error between scan lines). Flattening the 2-D background (plane or
  polynomial) fixes the first; aligning the rows fixes the second, by any of
  Gwyddion's "Align Rows" estimators — median, median of differences, modus,
  matching, facet-level tilt, polynomial, trimmed mean and trimmed mean of
  differences — in either scan direction.
- **Roughness**: the ISO 25178 areal parameters (Sa, Sq, Ssk, Sku, Sp, Sv,
  Sz) on the leveled image, the hybrid quantities that need the pixel size
  (surface area, volume, Sdq, Sdr, variation, inclination) and the 1-D
  Ra/Rq/Rz along an extracted profile.
- **Profiles / PSD / histogram** for line sections and texture analysis.

The force half analyses one curve of a force map: splitting into approach /
dwell / retract using the ARDF segment markers, baseline correction from the
far-from-surface ends, and the standard metrics (maximum load, adhesion).
The adhesion computation was validated against the instrument's own
MapAdhesion channel in a test .ARDF (agreement within 0.5 nN on every pixel).
"""

import numpy as np


# ---------------------------------------------------------------------------
# Leveling
# ---------------------------------------------------------------------------

# Choice keys for the two leveling steps, in UI order. The row-alignment set is
# Gwyddion's "Align Rows" list, which is the vocabulary an AFM user already
# has: each entry is a different estimator of "what this row's offset is", and
# which one is right depends on what the sample looks like, not on the data.
PLANE_METHODS = ('none', 'plane', 'poly2', 'poly3')
LINE_METHODS = ('none', 'median', 'median_diff', 'modus', 'matching', 'facet',
                'poly', 'trimmed', 'trimmed_diff')
DIRECTIONS = ('horizontal', 'vertical')

# Units a "height" channel is measured in — the ones where a zero reference
# means something. A phase (deg) or potential (V) map has no floor to sit on.
LENGTH_UNITS = ('nm', 'µm', 'um', 'm', 'pm', 'Å', 'A', 'angstrom')

# The recipe a height channel starts with. A raw AFM height map is tilted (the
# sample is never mounted flat) and striped (the lines drift), so the useful
# default is the correction almost every image needs: subtract the plane, match
# each line to the previous by the median of their difference — which unlike a
# plain median keeps real slow-axis topography — and pin the minimum to zero so
# the colour key reads 0 at the bottom. All of it stays undoable from the Level
# tab, and 'Reset (raw data)' turns every step off.
DEFAULT_LEVEL = {'plane': 'plane', 'lines': 'median_diff', 'scars': False,
                 'zero': 'min', 'direction': 'horizontal',
                 'degree': 3, 'trim': 5.0}


def default_level(units=''):
    """The starting leveling recipe for a channel in ``units``, or None.

    Applied by ``afm_array`` whenever a sheet carries no recipe of its own, so
    old projects and fresh imports both open with the zero reference in place.
    """
    if str(units).strip() not in LENGTH_UNITS:
        return None
    return dict(DEFAULT_LEVEL)


def level_plane(z):
    """Subtract the least-squares plane (1st-order background)."""
    z = np.asarray(z, dtype=float)
    h, w = z.shape
    y, x = np.mgrid[0:h, 0:w]
    A = np.column_stack([x.ravel(), y.ravel(), np.ones(z.size)])
    coef, *_ = np.linalg.lstsq(A, z.ravel(), rcond=None)
    return z - (A @ coef).reshape(h, w)


def level_poly(z, order=2):
    """Subtract a 2-D polynomial background of the given total order."""
    z = np.asarray(z, dtype=float)
    h, w = z.shape
    y, x = np.mgrid[0:h, 0:w]
    x = x.ravel() / max(w - 1, 1)
    y = y.ravel() / max(h - 1, 1)
    cols = [x ** i * y ** j
            for i in range(order + 1) for j in range(order + 1 - i)]
    A = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(A, z.ravel(), rcond=None)
    return z - (A @ coef).reshape(h, w)


def _modus(values, bins=None):
    """The most common value of a row, estimated from its histogram.

    On a sample that is mostly flat substrate with features on top, the modus
    is the substrate level: unlike the median it is not pulled up by the
    features however much of the row they cover.
    """
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return 0.0
    if v.max() == v.min():
        return float(v[0])
    if bins is None:
        bins = int(np.clip(np.sqrt(v.size) * 2, 16, 256))
    counts, edges = np.histogram(v, bins=bins)
    i = int(np.argmax(counts))
    inside = v[(v >= edges[i]) & (v <= edges[i + 1])]
    return float(inside.mean()) if inside.size else float(
        (edges[i] + edges[i + 1]) / 2.0)


def _trimmed_mean(values, trim=0.05):
    """Mean of a row with ``trim`` of the values discarded from each tail.

    Between the mean (trim 0) and the median (trim 0.5): keeps the mean's use
    of every point while dropping the outliers a tip event leaves behind.
    """
    v = np.asarray(values, dtype=float)
    v = np.sort(v[np.isfinite(v)])
    if v.size == 0:
        return 0.0
    k = int(round(v.size * float(np.clip(trim, 0.0, 0.49))))
    if 2 * k >= v.size:
        return float(np.median(v))
    return float(v[k:v.size - k].mean())


def _match_offset(diff, iterations=12):
    """Offset between two rows that best matches the parts that agree.

    A robust (Lorentzian-weighted) mean of their difference, solved by
    iteratively reweighted least squares from the median. Where a terrace
    steps between the two rows the difference is large, gets almost no weight
    and does not drag the offset — which is what makes this the method for
    stepped and terraced samples, where a plain median splits the difference
    between the two levels and leaves a ripple.
    """
    d = np.asarray(diff, dtype=float)
    d = d[np.isfinite(d)]
    if d.size == 0:
        return 0.0
    offset = float(np.median(d))
    scale = float(np.median(np.abs(d - offset))) * 1.4826
    if not scale > 0:
        return offset
    for _ in range(iterations):
        weight = 1.0 / (1.0 + ((d - offset) / scale) ** 2)
        total = weight.sum()
        if not total > 0:
            break
        offset = float((weight * d).sum() / total)
    return offset


def _facet_slope(row):
    """The row's dominant local slope — the modus of its first difference.

    Facet leveling asks which way the surface *mostly* points rather than
    fitting a line through everything, so a row crossed by a tall feature is
    still de-tilted by the substrate it sits on.
    """
    d = np.diff(np.asarray(row, dtype=float))
    return _modus(d) if d.size else 0.0


def flatten_lines(z, method='median', order=1, trim=0.05,
                  direction='horizontal'):
    """Align the scan lines of an image, Gwyddion's "Align Rows" methods.

    Each method is a different estimate of a row's own offset (or tilt), which
    is then subtracted:

    'median'        the row's median — the safe default
    'median_diff'   match each row to the previous by the median of their
                    difference, preserving real slow-axis topography better
                    on stepped samples
    'modus'         the row's most common value: the substrate level of a
                    surface covered in features
    'matching'      robustly match each row to the previous, ignoring the
                    pixels where they genuinely differ — for terraces
    'facet'         remove each row's dominant local slope, then match offsets
    'poly' /
    'polyfit'       subtract a per-row polynomial of ``order``
    'trimmed'       the row's trimmed mean, ``trim`` cut from each tail
    'trimmed_diff'  the trimmed mean of the difference to the previous row

    ``direction`` 'vertical' runs the same correction down the columns, for
    images whose striping is along the slow axis.
    """
    z = np.asarray(z, dtype=float)
    if str(direction).lower().startswith('v'):
        return flatten_lines(z.T, method, order, trim, 'horizontal').T
    if method in (None, 'none') or z.ndim != 2 or z.size == 0:
        return z
    if method == 'median':
        return z - np.median(z, axis=1, keepdims=True)
    if method == 'mean':
        return z - z.mean(axis=1, keepdims=True)
    if method == 'modus':
        return z - np.array([[_modus(row)] for row in z])
    if method == 'trimmed':
        return z - np.array([[_trimmed_mean(row, trim)] for row in z])
    if method in ('median_diff', 'trimmed_diff', 'matching'):
        estimator = {'median_diff': lambda d: float(np.median(d)),
                     'trimmed_diff': lambda d: _trimmed_mean(d, trim),
                     'matching': _match_offset}[method]
        out = z.copy()
        for i in range(1, z.shape[0]):
            out[i] -= estimator(out[i] - out[i - 1])
        return out - np.median(out)
    if method == 'facet':
        x = np.arange(z.shape[1], dtype=float)
        out = np.empty_like(z)
        for i, row in enumerate(z):
            out[i] = row - _facet_slope(row) * x
        # De-tilting leaves every row at an offset of its own; matching them by
        # the median of their difference keeps whatever slow-axis shape is real.
        return flatten_lines(out, 'median_diff')
    if method in ('poly', 'polyfit'):
        x = np.arange(z.shape[1])
        out = np.empty_like(z)
        for i, row in enumerate(z):
            coef = np.polyfit(x, row, max(int(order), 1))
            out[i] = row - np.polyval(coef, x)
        return out
    raise ValueError(f'Unknown line-flatten method {method!r}')


def remove_scars(z, threshold=3.0, max_width=4):
    """Remove scars (strokes): short runs of scan lines corrupted by a tip
    event, visible as horizontal streaks that match neither the row above nor
    the row below.

    Gwyddion's classic "remove scars" correction. A pixel is a scar candidate
    when it differs from *both* vertical neighbours by more than ``threshold``
    times the image's median row-to-row noise, with the same sign; candidate
    runs at most ``max_width`` rows tall are replaced by the average of the
    clean rows bounding them.
    """
    z = np.asarray(z, dtype=float).copy()
    h, w = z.shape
    if h < 3:
        return z
    row_diff = np.diff(z, axis=0)
    noise = np.median(np.abs(row_diff)) or 1e-12
    limit = threshold * noise

    up = z[1:-1] - z[:-2]      # this row vs the row above
    down = z[1:-1] - z[2:]     # this row vs the row below
    scar = (np.abs(up) > limit) & (np.abs(down) > limit) \
        & (np.sign(up) == np.sign(down))

    mask = np.zeros_like(z, dtype=bool)
    mask[1:-1] = scar
    # Grow vertically joined candidates into runs, discard tall ones (those
    # are real topography, not scars).
    for col in range(w):
        rows = np.flatnonzero(mask[:, col])
        if not rows.size:
            continue
        run_start = rows[0]
        prev = rows[0]
        for row in list(rows[1:]) + [None]:
            if row is not None and row == prev + 1:
                prev = row
                continue
            run_end = prev
            if run_end - run_start + 1 <= max_width \
                    and run_start > 0 and run_end < h - 1:
                top = z[run_start - 1, col]
                bottom = z[run_end + 1, col]
                for i, r in enumerate(range(run_start, run_end + 1)):
                    frac = (i + 1) / (run_end - run_start + 2)
                    z[r, col] = top * (1 - frac) + bottom * frac
            if row is not None:
                run_start = prev = row
    return z


# Row methods as they were named before the Gwyddion set: the degree was part
# of the key rather than a control of its own.
_LEGACY_LINES = {'poly1': ('poly', 1), 'poly2': ('poly', 2),
                 'poly3': ('poly', 3)}


def apply_level(z, level):
    """Apply a stored leveling description to an image.

    ``level`` is the dict kept on the sheet under ``AFM_Level``:
    ``{'plane': 'none'|'plane'|'poly2'|'poly3', 'lines': <LINE_METHODS>,
    'direction': 'horizontal'|'vertical', 'degree': int, 'trim': percent,
    'scars': bool, 'zero': 'none'|'min'|'mean'}`` — flatten (the 2-D
    background) first, then the row alignment, then scar removal, then the
    zero reference, matching the order the tool applies them interactively.

    The stored pixels are never modified; this is applied on the way to every
    display and measurement, so the leveling stays undoable.
    """
    z = np.asarray(z, dtype=float)
    if not isinstance(level, dict) or z.ndim != 2:
        return z
    plane = level.get('plane', 'none')
    if plane == 'plane':
        z = level_plane(z)
    elif plane in ('poly2', 'poly3'):
        z = level_poly(z, int(plane[-1]))
    lines = level.get('lines', 'none')
    if lines and lines != 'none':
        method, order = _LEGACY_LINES.get(
            lines, (lines, int(level.get('degree', 3) or 3)))
        try:
            z = flatten_lines(z, method, order=order,
                              trim=float(level.get('trim', 5.0) or 0.0) / 100.0,
                              direction=level.get('direction', 'horizontal'))
        except (ValueError, TypeError):
            pass
    if level.get('scars'):
        z = remove_scars(z)
    zero = level.get('zero', 'none')
    if zero == 'min':
        z = z - np.nanmin(z)
    elif zero == 'mean':
        z = z - np.nanmean(z)
    return z


# ---------------------------------------------------------------------------
# Regions of interest
#
# A number measured over the whole frame is often the wrong number: the
# roughness of a film is not the roughness of the film plus the scratch across
# it, and a grain count should not include the dust. So every measurement can
# be restricted to regions the user draws — rectangles, circles or freehand
# outlines — each either the part to measure or the part to leave out.
# ---------------------------------------------------------------------------

ROI_SHAPES = ('rect', 'circle', 'polygon')
ROI_MODES = ('include', 'exclude')


def _polygon_mask(shape, points):
    """Even-odd point-in-polygon test over a whole pixel grid.

    Vectorised ray casting rather than matplotlib's Path, so the engine stays
    numpy-only and testable without a GUI stack.
    """
    h, w = shape
    poly = np.asarray(points, dtype=float)
    if poly.ndim != 2 or poly.shape[0] < 3:
        return np.zeros((h, w), bool)
    yy, xx = np.mgrid[0:h, 0:w]
    xx = xx + 0.5                      # test pixel centres
    yy = yy + 0.5
    inside = np.zeros((h, w), bool)
    x0, y0 = poly[:, 0], poly[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    for ax_, ay, bx, by in zip(x0, y0, x1, y1):
        if ay == by:
            continue                   # horizontal edge crosses no ray
        straddles = ((ay > yy) != (by > yy))
        # x of the edge at this row, only where the edge spans the row
        with np.errstate(invalid='ignore', divide='ignore'):
            cross = (bx - ax_) * (yy - ay) / (by - ay) + ax_
        inside ^= straddles & (xx < cross)
    return inside


def _roi_shape_mask(shape, roi):
    """The pixels one ROI covers."""
    h, w = shape
    kind = str(roi.get('shape', 'rect'))
    points = roi.get('points') or []
    if kind == 'rect' and len(points) >= 4:
        x0, y0, x1, y1 = [float(v) for v in points[:4]]
        yy, xx = np.mgrid[0:h, 0:w]
        return ((xx + 0.5 >= min(x0, x1)) & (xx + 0.5 <= max(x0, x1))
                & (yy + 0.5 >= min(y0, y1)) & (yy + 0.5 <= max(y0, y1)))
    if kind == 'circle' and len(points) >= 3:
        cx, cy, radius = [float(v) for v in points[:3]]
        yy, xx = np.mgrid[0:h, 0:w]
        return np.hypot(xx + 0.5 - cx, yy + 0.5 - cy) <= abs(radius)
    if kind == 'polygon':
        pairs = np.asarray(points, dtype=float).reshape(-1, 2)
        return _polygon_mask(shape, pairs)
    return np.zeros((h, w), bool)


def roi_mask(shape, rois):
    """Boolean mask of the pixels an analysis should use.

    With no regions at all, everything counts. Otherwise the includes are
    unioned (nothing is measured outside them) and the excludes are then cut
    out of whatever is left — so an exclude alone means "all of it except
    this", which is how a scratch or a piece of dust is dropped without having
    to outline the rest of the image.
    """
    h, w = int(shape[0]), int(shape[1])
    rois = [r for r in (rois or []) if isinstance(r, dict)]
    if not rois:
        return np.ones((h, w), bool)
    includes = [r for r in rois if r.get('mode', 'include') != 'exclude']
    mask = np.zeros((h, w), bool) if includes else np.ones((h, w), bool)
    for roi in includes:
        mask |= _roi_shape_mask((h, w), roi)
    for roi in rois:
        if roi.get('mode') == 'exclude':
            mask &= ~_roi_shape_mask((h, w), roi)
    return mask


def masked(z, mask=None):
    """``z`` with the pixels outside ``mask`` set to NaN.

    Every measurement below is NaN-aware, so this is all a region restriction
    needs to be: the array keeps its shape (so gradients, row alignment and
    the image geometry still work) and the excluded pixels simply stop
    contributing.
    """
    z = np.asarray(z, dtype=float)
    if mask is None:
        return z
    mask = np.asarray(mask, bool)
    if mask.shape != z.shape or mask.all():
        return z
    return np.where(mask, z, np.nan)


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def rms_grainwise(z, labels, mask=None):
    """RMS height with each grain's own mean subtracted.

    Gwyddion's "RMS (grain-wise)": the roughness *within* the grains, which
    is a different number from Sq as soon as the grains sit at different
    heights — Sq then counts the spread between them as roughness. With no
    grains marked there is nothing to subtract grain by grain, and it is Sq.
    """
    z = masked(z, mask)
    labels = np.asarray(labels) if labels is not None else None
    if labels is None or labels.shape != z.shape or labels.max() < 1:
        centred = z - np.nanmean(z)
        return float(np.sqrt(np.nanmean(centred ** 2)))
    inside = (labels > 0) & np.isfinite(z)
    if not inside.any():
        return float('nan')
    index = np.arange(1, int(labels.max()) + 1)
    from scipy import ndimage as ndi
    means = np.zeros(int(labels.max()) + 1)
    means[1:] = ndi.mean(np.nan_to_num(z), labels, index)
    residual = z[inside] - means[labels[inside]]
    return float(np.sqrt(np.mean(residual ** 2)))


def roughness_stats(z, mask=None, labels=None):
    """ISO 25178 areal roughness parameters on a (leveled) height image.

    ``mask`` restricts every parameter to the drawn regions; ``labels`` (a
    grain marking) adds the grain-wise RMS.

    Sa    arithmetic mean deviation
    Sq    root-mean-square deviation
    Ssk   skewness (asymmetry: >0 peaks dominate, <0 pits dominate)
    Sku   kurtosis (3 = Gaussian; higher = spiky)
    Sp/Sv maximum peak height / pit depth from the mean plane
    Sz    maximum height (Sp + Sv)
    """
    z = masked(z, mask)
    centred = z - np.nanmean(z)
    sa = float(np.nanmean(np.abs(centred)))
    sq = float(np.sqrt(np.nanmean(centred ** 2)))
    ssk = float(np.nanmean(centred ** 3) / sq ** 3) if sq else 0.0
    sku = float(np.nanmean(centred ** 4) / sq ** 4) if sq else 0.0
    sp = float(np.nanmax(centred))
    sv = float(-np.nanmin(centred))
    return {'Sa': sa, 'Sq': sq, 'Ssk': ssk, 'Sku': sku,
            'Sq_grainwise': rms_grainwise(z, labels),
            'Sku_excess': sku - 3.0 if sq else 0.0,
            'Sp': sp, 'Sv': sv, 'Sz': sp + sv,
            'mean': float(np.nanmean(z)), 'median': float(np.nanmedian(z)),
            'min': float(np.nanmin(z)), 'max': float(np.nanmax(z)),
            'discrepancy': scan_line_discrepancy(z)}


def hybrid_stats(z, dx=1.0, dy=1.0, mask=None):
    """The quantities that mix heights with lateral distances.

    Gwyddion's "hybrid" group — every one of these needs the pixel size, so
    they are meaningless on an uncalibrated image and are reported only when
    the scan size is known. ``dx``/``dy`` are the pixel sizes in the same unit
    as ``z``, and every result is in that unit (area unit², volume unit³).

    projected   the scanned area, width x height
    surface     the area of the real surface, triangulated two triangles per
                pixel cell — always >= projected, and equal only for a plane
    volume      the integral of z over the scan, signed and measured from
                z = 0, so it follows the zero reference the leveling sets
    Sdq         RMS surface slope
    variation   the integral of |grad z|: how much surface the relief adds
    theta/phi   inclination of the mean facet normal, in degrees — theta is
                how far the surface tilts, phi which way it faces
    """
    z = masked(z, mask)
    if z.ndim != 2 or z.size < 4:
        return {}
    dx = float(dx) or 1.0
    dy = float(dy) or 1.0
    # The footprint is the measured pixels, not the frame — a region covering
    # a tenth of the scan must not report the whole scan's area.
    projected = float(np.count_nonzero(np.isfinite(z))) * dx * dy
    if projected <= 0:
        return {}

    # Two triangles per pixel cell, sharing the cell's leading diagonal.
    z00, z01 = z[:-1, :-1], z[:-1, 1:]
    z10, z11 = z[1:, :-1], z[1:, 1:]
    cell = dx * dy / 2.0
    upper = np.sqrt(1.0 + ((z01 - z00) / dx) ** 2 + ((z11 - z01) / dy) ** 2)
    lower = np.sqrt(1.0 + ((z11 - z10) / dx) ** 2 + ((z10 - z00) / dy) ** 2)
    surface = float(np.nansum(upper + lower) * cell)
    # A cell needs all four corners; scale the cells that had them back up to
    # the measured footprint, so surface and projected areas share it.
    complete = float(np.count_nonzero(np.isfinite(upper + lower)))
    surface *= projected / max(complete * dx * dy, 1e-30)

    gy, gx = np.gradient(z, dy, dx)
    slope = np.hypot(gx, gy)
    return {'projected_area': projected,
            'surface_area': surface,
            'volume': float(np.nansum(z) * dx * dy),
            'Sdq': float(np.sqrt(np.nanmean(gx ** 2 + gy ** 2))),
            'variation': float(np.nanmean(slope) * projected),
            'theta': float(np.degrees(np.arctan(
                np.hypot(np.nanmean(gx), np.nanmean(gy))))),
            'phi': float(np.degrees(np.arctan2(np.nanmean(gy),
                                               np.nanmean(gx))))}


def scan_line_discrepancy(z):
    """How badly neighbouring scan lines match, as a dimensionless number.

    Differences down the slow axis carry the real topography *and* whatever
    offset error is left between the lines; differences along the fast axis
    carry only the topography. The excess of the first over the second,
    normalised by the height variance, is what remains of the line offsets:
    zero for a well-aligned image, and rising as the lines drift apart. Use it
    to tell whether a row alignment is still needed — not as a roughness.
    """
    z = np.asarray(z, dtype=float)
    if z.ndim != 2 or min(z.shape) < 2:
        return 0.0
    variance = float(np.nanvar(z))
    if not variance > 0:
        return 0.0
    excess = (float(np.nanmean(np.diff(z, axis=0) ** 2))
              - float(np.nanmean(np.diff(z, axis=1) ** 2)))
    return float(max(excess, 0.0) / (2.0 * variance))


def surface_area_ratio(z, dx, dy, mask=None):
    """Sdr: developed interfacial area ratio, in percent.

    How much more area the real surface has than its projection — 0% for a
    perfect plane. ``dx``/``dy`` are the pixel sizes in the same unit as z.
    """
    gz_y, gz_x = np.gradient(masked(z, mask), dy, dx)
    area = np.nanmean(np.sqrt(1.0 + gz_x ** 2 + gz_y ** 2))
    return float((area - 1.0) * 100.0)


def histogram(z, bins=256):
    """Height histogram -> (bin centres, counts)."""
    z = np.asarray(z, dtype=float)
    z = z[np.isfinite(z)]
    counts, edges = np.histogram(z, bins=bins)
    centres = 0.5 * (edges[:-1] + edges[1:])
    return centres, counts


def psd_radial(z, dx=1.0):
    """Radially averaged 2-D power spectral density.

    Returns (spatial frequency, PSD) with the frequency axis in cycles per
    unit of ``dx``. A Hann window suppresses the leakage from the image
    edges, which otherwise dominates the spectrum of any tilted surface.
    """
    z = np.asarray(z, dtype=float)
    h, w = z.shape
    window = np.hanning(h)[:, None] * np.hanning(w)[None, :]
    f = np.fft.fftshift(np.fft.fft2((z - z.mean()) * window))
    psd2 = np.abs(f) ** 2
    y, x = np.indices(psd2.shape)
    r = np.hypot(x - w // 2, y - h // 2).astype(int)
    sums = np.bincount(r.ravel(), psd2.ravel())
    counts = np.bincount(r.ravel())
    radial = sums / np.maximum(counts, 1)
    freqs = np.arange(len(radial)) / (max(h, w) * dx)
    n = min(h, w) // 2
    return freqs[1:n], radial[1:n]


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

def line_profile(z, p0, p1, width=1, n=None):
    """Bilinear-interpolated profile between pixel coords p0=(x0,y0), p1=(x1,y1).

    Returns (distance along the line in px, values). ``n`` defaults to one
    sample per pixel of line length. ``width`` > 1 averages that many
    parallel sample lines spread symmetrically about the drawn one
    (Gwyddion's profile "thickness") — the standard way to beat noise on a
    profile without smoothing along it.
    """
    z = np.asarray(z, dtype=float)
    x0, y0 = float(p0[0]), float(p0[1])
    x1, y1 = float(p1[0]), float(p1[1])
    length = np.hypot(x1 - x0, y1 - y0)
    if n is None:
        n = max(int(np.ceil(length)) + 1, 2)

    def _sample(ox, oy):
        xs = np.linspace(x0 + ox, x1 + ox, n)
        ys = np.linspace(y0 + oy, y1 + oy, n)
        xi = np.clip(np.floor(xs).astype(int), 0, z.shape[1] - 2)
        yi = np.clip(np.floor(ys).astype(int), 0, z.shape[0] - 2)
        fx = np.clip(xs - xi, 0.0, 1.0)
        fy = np.clip(ys - yi, 0.0, 1.0)
        return (z[yi, xi] * (1 - fx) * (1 - fy)
                + z[yi, xi + 1] * fx * (1 - fy)
                + z[yi + 1, xi] * (1 - fx) * fy
                + z[yi + 1, xi + 1] * fx * fy)

    width = max(1, int(width))
    if width == 1 or length <= 0:
        return np.linspace(0.0, length, n), _sample(0.0, 0.0)
    # Unit normal of the line; offsets span the band symmetrically.
    nx, ny = -(y1 - y0) / length, (x1 - x0) / length
    offsets = np.linspace(-(width - 1) / 2.0, (width - 1) / 2.0, width)
    values = np.mean([_sample(nx * o, ny * o) for o in offsets], axis=0)
    return np.linspace(0.0, length, n), values


def profile_roughness(values):
    """1-D roughness Ra/Rq/Rz of a profile (mean-line referenced)."""
    values = np.asarray(values, dtype=float)
    centred = values - np.mean(values)
    return {'Ra': float(np.mean(np.abs(centred))),
            'Rq': float(np.sqrt(np.mean(centred ** 2))),
            'Rz': float(np.max(centred) - np.min(centred))}


def step_height(distance, values, split=None):
    """Height difference between the two halves of a profile drawn across a
    step. ``split`` is the x position of the edge; defaults to the midpoint.
    Each side is measured by its median, so a slightly misplaced split or a
    rough terrace barely moves the answer.
    """
    distance = np.asarray(distance, dtype=float)
    values = np.asarray(values, dtype=float)
    if split is None:
        split = 0.5 * (distance[0] + distance[-1])
    left = values[distance < split]
    right = values[distance >= split]
    if not len(left) or not len(right):
        return 0.0
    return float(abs(np.median(right) - np.median(left)))


# ---------------------------------------------------------------------------
# Grains
#
# Thresholding answers "which pixels are grain and which are substrate"; on a
# continuous film there is no substrate to find and the question is instead
# "where does one grain end and the next begin". That is what Gwyddion's Mark
# Grains by Watershed does, and this is the same two-stage shape with the same
# parameter names:
#
#   1. Grain location — water is poured on the surface in ``locate_steps``
#      steps of ``locate_dropsize``; it runs downhill and pools, and the lakes
#      that form are the grain seeds. Lakes smaller than ``locate_threshold``
#      pixels are noise and are dropped.
#   2. Segmentation — more water, ``seg_steps`` of ``seg_dropsize``, until the
#      lakes meet; where they meet is a grain boundary.
#
# Gwyddion defines a drop as raising the local minimum by
# ``dropsize * (max - min) / 5000``, so a stage's total water is
# ``steps * dropsize * (max - min) / 5000`` — a depth in height units. That is
# exactly the h of an h-minima transform, which is how it is computed here:
# h-minima for the seeds and a marker-based Vincent-Soille watershed for the
# segmentation, rather than simulating the drops one at a time. Same
# parameters, same meaning, seconds instead of minutes.
#
# Of the tools that do this in Python — TopoStats (AFM-SPM), GrainStat,
# ImageGrains, the NIST intercept scripts — all of them land on the same
# recipe: threshold or h-transform for markers, then scikit-image's watershed,
# then regionprops. This follows it, with Gwyddion's parameterisation on top
# so the numbers a user already knows still mean what they meant.
# ---------------------------------------------------------------------------

# Gwyddion's own defaults, as its dialog opens.
WATERSHED_DEFAULTS = {
    'invert': False,          # True to find pits rather than grains
    'locate_steps': 4,
    'locate_dropsize': 1.69,  # percent
    'locate_threshold': 4,    # px^2
    'seg_steps': 283,
    'seg_dropsize': 1.0,      # percent
    # Not a Gwyddion parameter: the width, in pixels, of the blur used to find
    # the seeds. See mark_grains_watershed for why it has to exist.
    'smoothing': 1.5,
}

# The divisor in Gwyddion's drop-size definition: one "drop" raises the local
# minimum by dropsize*(max-min)/5000.
_DROP_SCALE = 5000.0


def _water_depth(z, steps, dropsize):
    """Height a stage's water reaches, in the units of ``z``."""
    finite = z[np.isfinite(z)]
    if finite.size == 0:
        return 0.0
    span = float(np.nanmax(finite) - np.nanmin(finite))
    return max(float(steps), 0.0) * max(float(dropsize), 0.0) \
        * span / _DROP_SCALE


def _pixel_noise(z):
    """Robust sigma of the pixel-to-pixel noise, in the units of ``z``.

    From the median absolute difference between horizontal neighbours: real
    topography is correlated over several pixels, noise is not, so the
    one-pixel difference is almost all noise. The 1.4826 is the MAD-to-sigma
    factor and the sqrt(2) undoes the differencing of two noisy samples.
    """
    diff = np.abs(np.diff(z, axis=1))
    diff = diff[np.isfinite(diff)]
    if diff.size == 0:
        return 0.0
    return float(1.4826 * np.median(diff) / np.sqrt(2.0))


def _feature_length(z):
    """Lateral size of the surface features, in pixels.

    The lag at which the autocovariance has fallen to 1/e — the standard SPM
    correlation length, and the closest thing a height map has to "how big is
    a grain" before any grain has been found.
    """
    finite = np.isfinite(z)
    if not finite.all():
        z = np.where(finite, z, np.nanmean(z[finite]) if finite.any() else 0.0)
    rows = z - z.mean(axis=1, keepdims=True)
    var = float(np.mean(rows ** 2))
    if var <= 0:
        return 2.0
    # Averaged over rows, out to an eighth of the width: past that the
    # estimate is made of too few overlapping samples to mean anything.
    lags = max(2, min(int(z.shape[1] // 8), 64))
    for lag in range(1, lags + 1):
        if float(np.mean(rows[:, :-lag] * rows[:, lag:])) / var < np.exp(-1.0):
            return float(lag)
    return float(lags)


def _seed_markers(surface, depth, threshold, valid=None):
    """Labelled grain seeds of a flooded surface — the location stage.

    Shared by the marking and by the sweep that tunes it, so what the sweep
    measures is exactly what the marking will then do. Every caller wants the
    same two fallbacks: too little water to pool anywhere falls back to the
    plain minima, and a threshold that would reject *every* seed is ignored
    rather than obeyed into an empty answer.
    """
    from skimage.morphology import h_minima
    from skimage.measure import label as cc_label

    seeds = (h_minima(surface, depth) > 0) if depth > 0 else np.zeros(
        surface.shape, bool)
    if not seeds.any():
        seeds = h_minima(surface, np.finfo(float).eps * 10) > 0
    if valid is not None:
        seeds &= valid
    markers = cc_label(seeds)
    threshold = int(threshold or 0)
    if threshold > 1 and markers.max() > 0:
        # Drop the lakes too small to be a grain. Done by counting labels
        # rather than through remove_small_objects, whose signature has moved
        # between scikit-image versions.
        sizes = np.bincount(markers.ravel())
        small = sizes < threshold
        small[0] = False
        if not small[1:].all():              # never filter away every seed
            markers = cc_label(np.where(small[markers], 0, markers) > 0)
    return markers


def auto_watershed_params(z, mask=None, invert=False):
    """Watershed parameters measured off the image instead of guessed.

    Gwyddion's six numbers are unguessable without knowing what they mean, so
    this derives them from the surface itself:

    * **Seed smoothing** from the correlation length — a blur a quarter of the
      feature size, which erases the pixel noise that would otherwise put a
      local minimum (and so a grain) almost everywhere, without touching the
      grains themselves.
    * **Location threshold** from the same length: a lake smaller than a
      quarter of a feature across is noise, not a grain.
    * **Location water** by a stability sweep rather than a rule of thumb. The
      grain count falls as the water rises; the depth that matters is the one
      on the flattest part of that curve, because there the answer does not
      depend on the exact setting. This is the persistence argument, and it is
      measured, not assumed.
    * **Segmentation water** from the height of what was found, so the flood
      reaches the substrate around the grains rather than a fixed fraction of
      a range one tall spike can set.

    Returns a dict that can be handed straight to ``mark_grains_watershed``,
    plus a ``'_report'`` key describing what was measured — the numbers are
    the user's to override, and an automation that will not say what it did is
    one you cannot argue with.
    """
    z = masked(np.asarray(z, dtype=float), mask)
    finite = z[np.isfinite(z)]
    out = dict(WATERSHED_DEFAULTS, invert=bool(invert))
    if finite.size < 64:
        out['_report'] = 'Too little data to measure; Gwyddion defaults kept.'
        return out

    # A robust span: the full min-to-max is set by whatever single spike the
    # scan happened to catch, and every drop size is a fraction of it.
    lo, hi = np.percentile(finite, (0.5, 99.5))
    span = float(hi - lo)
    if span <= 0:
        out['_report'] = 'The image is flat; Gwyddion defaults kept.'
        return out
    sq = float(np.std(finite))
    noise = _pixel_noise(z)
    length = _feature_length(z)

    smoothing = float(np.clip(length / 4.0, 0.5, 6.0))
    # A seed is the bottom of a basin, a handful of pixels — not a grain — so
    # this stays near Gwyddion's 4 px². It widens with the blur, because a
    # broader blur flattens the basin floors it is measured on.
    threshold = int(np.clip(round(1.0 + smoothing ** 2), 2, 25))

    from scipy import ndimage as ndi
    surface = z if invert else -z
    valid = np.isfinite(surface)
    filled = np.where(valid, surface, np.nanmax(surface[valid]))
    # Sub-sampled for the sweep only: the plateau is a property of the
    # surface, not of its sampling, and a 1024 px force map would otherwise
    # make this a coffee break.
    stride = max(1, int(max(filled.shape) // 256))
    probe = ndi.gaussian_filter(filled, smoothing)[::stride, ::stride]
    probe_threshold = max(1, int(threshold / (stride * stride)))

    # From "just above the noise" to "half the roughness" — below the first
    # every noise dip is a grain, above the last only the tallest survive.
    low = max(3.0 * noise, 0.002 * span)
    high = max(low * 1.02, 0.75 * sq if sq > 0 else 0.1 * span)
    depths = np.geomspace(low, high, 9)
    counts = np.array([_seed_markers(probe, d, probe_threshold).max()
                       for d in depths], dtype=float)

    usable = counts > 0
    if usable.sum() < 3:
        depth = float(np.sqrt(low * high))
        note = 'no stable plateau — took the middle of the range'
    else:
        # Flattest stretch of log(count) against log(depth): where the count
        # is least sensitive to the setting, so the setting is least arbitrary.
        ld = np.log(depths[usable])
        lc = np.log(np.maximum(counts[usable], 1.0))
        slope = np.abs(np.gradient(lc, ld))
        best = int(np.argmin(slope))
        depth = float(depths[usable][best])
        note = (f'{int(counts[usable][best])} seeds on the flattest part of '
                f'the count curve')

    # Back to Gwyddion's parameterisation. The step count is what carries the
    # depth, with the drop left at one percent: solving the other way round
    # runs the drop past its 100 % ceiling on a fine-grained scan, and a
    # clamped drop is a depth other than the one that was measured.
    drop = 1.0
    steps = int(np.clip(round(depth * _DROP_SCALE / (drop * span)), 1, 10000))

    # The flood has to clear the grains it is filling around. Their height is
    # a few Sq; a fixed fraction of the span is what makes the Gwyddion
    # default miss on a scan with one tall speck on it.
    seg_drop = 1.0
    flood = min(3.0 * sq, 0.5 * span) if sq > 0 else 0.06 * span
    seg_steps = int(np.clip(round(flood * _DROP_SCALE / (seg_drop * span)),
                            1, 100000))

    out.update({'locate_steps': steps,
                'locate_dropsize': round(float(drop), 3),
                'locate_threshold': threshold,
                'seg_steps': seg_steps,
                'seg_dropsize': round(float(seg_drop), 3),
                'smoothing': round(smoothing, 1)})
    out['_report'] = (
        f'Feature size {length:.0f} px, noise {noise:.3g}, Sq {sq:.3g}. '
        f'Seed depth {depth:.3g} ({note}); flood {flood:.3g}.')
    return out


def mark_grains_watershed(z, mask=None, params=None):
    """Label the grains of a height map, Gwyddion's watershed marking.

    Returns an integer label image (0 = boundary or outside the mask). Grains
    are hills unless ``invert`` is set, in which case they are pits — the same
    "Invert height" switch the Gwyddion dialog carries.
    """
    from skimage.segmentation import watershed

    from scipy import ndimage as ndi

    settings = dict(WATERSHED_DEFAULTS, **(params or {}))
    z = masked(z, mask)
    if z.ndim != 2 or z.size < 9:
        return np.zeros(np.shape(z), dtype=int)
    valid = np.isfinite(z)
    if not valid.any():
        return np.zeros(z.shape, dtype=int)

    # Water runs downhill, so a grain (a hill) has to be turned upside down
    # before it can hold a lake. 'invert' flips that back for pits.
    surface = z if settings.get('invert') else -z
    filled = np.where(valid, surface, np.nanmax(surface[valid]))

    # Seeds are found on a smoothed copy, and only the seeds: pixel noise puts
    # a local minimum almost everywhere, and Gwyddion's location water is a
    # fraction of a percent of the height range, well under the noise of a raw
    # scan — without this the surface is all seeds and none survive the
    # threshold. The flooding below still runs on the real surface, so no
    # grain boundary is moved by the smoothing.
    smoothing = float(settings.get('smoothing', 1.5) or 0.0)
    locate_on = ndi.gaussian_filter(filled, smoothing) if smoothing > 0 \
        else filled

    depth = _water_depth(locate_on, settings['locate_steps'],
                         settings['locate_dropsize'])
    markers = _seed_markers(locate_on, depth,
                            settings.get('locate_threshold'), valid)
    if markers.max() == 0:
        return np.zeros(z.shape, dtype=int)

    labels = watershed(filled, markers, mask=valid, watershed_line=True)

    # The second stage's water is how far the flood rises from each grain's
    # own summit; anything it never reached belongs to no grain. Measured per
    # grain rather than globally, so a shallow grain does not inherit the
    # reach of a tall one.
    flood = _water_depth(filled, settings['seg_steps'],
                         settings['seg_dropsize'])
    if flood > 0 and labels.max() > 0:
        index = np.arange(1, labels.max() + 1)
        summit = np.zeros(labels.max() + 1)
        summit[1:] = ndi.minimum(filled, labels, index)
        reach = np.where(labels > 0, summit[labels] + flood, -np.inf)
        labels = np.where((labels > 0) & (filled <= reach), labels, 0)
    return np.asarray(labels, dtype=int)


def grain_stats(labels, dx=1.0, dy=1.0, unit='px'):
    """Per-grain sizes of a label image, in Gwyddion's vocabulary.

    ``equivalent square side`` is the side of a square with the grain's
    projected area — the size axis Gwyddion plots a distribution against —
    and ``equivalent disc radius`` its counterpart for a circle. Both come
    from the same projected area, so a distribution in one is a rescaling of
    the other; they are quoted together because different fields quote
    different ones.
    """
    from skimage.measure import regionprops_table

    labels = np.asarray(labels, dtype=int)
    if labels.max() == 0:
        return {'count': 0, 'area': np.array([]), 'a_eq': np.array([]),
                'ecd': np.array([]), 'disc_radius': np.array([]),
                'unit': unit}
    props = regionprops_table(labels, properties=('label', 'area',
                                                  'equivalent_diameter_area'))
    area_px = np.asarray(props['area'], dtype=float)
    pixel_area = float(dx) * float(dy)
    area = area_px * pixel_area
    return {'count': int(area.size),
            'area': area,
            'a_eq': np.sqrt(area),                       # equivalent square side
            'ecd': np.asarray(props['equivalent_diameter_area'],
                              dtype=float) * float(dx),
            'disc_radius': np.sqrt(area / np.pi),
            'unit': unit}


def gaussian(x, y0, a, x0, b):
    """Gwyddion's Gaussian: y0 + a*exp(-(x - x0)^2 / b^2)."""
    x = np.asarray(x, dtype=float)
    return y0 + a * np.exp(-((x - x0) / float(b)) ** 2)


def gaussian_fit(x, y, x_from=None, x_to=None):
    """Fit ``y0 + a exp(-((x-x0)/b)^2)`` to a distribution.

    Written in Gwyddion's parameterisation, so the numbers can be compared
    with its Fit Graph directly: ``b`` is not a standard deviation but
    sqrt(2)*sigma, and the width usually quoted, the FWHM, is
    2*sqrt(ln 2)*b. ``x_from``/``x_to`` fit only part of the distribution —
    a grain distribution usually has a spike of single-pixel fragments at the
    left that no Gaussian should be asked to describe.

    Returns None when there is nothing to fit.
    """
    from scipy.optimize import curve_fit

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    if x_from is not None and x_to is not None:
        lo, hi = sorted((float(x_from), float(x_to)))
        keep &= (x >= lo) & (x <= hi)
    x, y = x[keep], y[keep]
    if x.size < 4:
        return None

    y0 = float(np.min(y))
    peak = int(np.argmax(y))
    a = float(y[peak] - y0) or 1.0
    x0 = float(x[peak])
    # Start the width at the span of the points above half the peak, which is
    # a far better guess than the range on a distribution with a long tail.
    above = x[y >= y0 + a / 2.0]
    b = float(above.max() - above.min()) or float(x.max() - x.min()) / 4.0
    b = max(b, (float(x.max() - x.min()) or 1.0) / 100.0)
    try:
        popt, _cov = curve_fit(gaussian, x, y, p0=[y0, a, x0, b], maxfev=20000)
    except Exception:
        return None
    y0, a, x0, b = (float(v) for v in popt)
    b = abs(b)
    residual = y - gaussian(x, y0, a, x0, b)
    total = float(np.sum((y - y.mean()) ** 2))
    return {'y0': y0, 'a': a, 'x0': x0, 'b': b,
            'sigma': b / np.sqrt(2.0),
            'fwhm': 2.0 * np.sqrt(np.log(2.0)) * b,
            'r2': float(1.0 - np.sum(residual ** 2) / total) if total else 0.0,
            'x_from': float(x.min()), 'x_to': float(x.max()),
            'n': int(x.size)}


def size_distribution(values, bins=None):
    """(bin centres, counts, bin width) for a set of grain sizes."""
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if values.size == 0:
        return np.array([]), np.array([]), 0.0
    if bins is None:
        bins = int(np.clip(np.sqrt(values.size) * 1.5, 8, 80))
    counts, edges = np.histogram(values, bins=int(bins))
    return 0.5 * (edges[:-1] + edges[1:]), counts, float(edges[1] - edges[0])


# ---------------------------------------------------------------------------
# Critical dimensions — measuring one feature of a profile
# ---------------------------------------------------------------------------

# The shapes a feature can be fitted as, Gwyddion's critical-dimension set.
# Which one to use is the user's reading of the profile, not something to
# guess: a hill is a positive step, a trench a negative one, and a single
# transition an edge measured from whichever side is the reference.
CD_FUNCTIONS = ('step_positive', 'step_negative', 'edge_left', 'edge_right',
                'circle_up', 'circle_down')
CD_LABELS = {'step_positive': 'Step height (positive)',
             'step_negative': 'Step height (negative)',
             'edge_left': 'Edge height (left)',
             'edge_right': 'Edge height (right)',
             'circle_up': 'Circle (up)',
             'circle_down': 'Circle (down)'}


def _fit_circle(x, y):
    """Least-squares circle through a set of points (Kasa's linear fit).

    x² + y² = 2·cx·x + 2·cy·y + (r² − cx² − cy²) is linear in (cx, cy, c), so
    the fit is one lstsq with no starting guess — which matters here because
    an arc across a profile can be a very shallow piece of a very large
    circle, where an iterative fit wanders.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    A = np.column_stack([2.0 * x, 2.0 * y, np.ones(x.size)])
    try:
        coef, *_ = np.linalg.lstsq(A, x ** 2 + y ** 2, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy, c = (float(v) for v in coef)
    inside = c + cx ** 2 + cy ** 2
    if not inside > 0:
        return None
    return cx, cy, float(np.sqrt(inside))


def _level_crossing(x, y, index, level, lo=None, hi=None):
    """Sub-sample x where the profile crosses ``level`` nearest ``index``.

    The edge of a real feature is never one sample wide — the tip rounds it
    over several — so the position is taken where the profile passes the
    half-height, interpolated between the two samples that straddle it, and
    the crossing chosen is the one closest to the fitted break point.
    ``lo``/``hi`` bound the search, which is what keeps the two edges of a
    step from both snapping onto the same crossing.
    """
    side = np.sign(y - level)
    crossings = np.flatnonzero(side[:-1] * side[1:] < 0)
    if lo is not None:
        crossings = crossings[crossings >= lo]
    if hi is not None:
        crossings = crossings[crossings < hi]
    if crossings.size == 0:
        return float(x[min(max(index, 0), len(x) - 1)])
    i = int(crossings[np.argmin(np.abs(crossings - (index - 1)))])
    y0, y1 = y[i], y[i + 1]
    if y1 == y0:
        return float(x[i])
    t = float(np.clip((level - y0) / (y1 - y0), 0.0, 1.0))
    return float(x[i] + t * (x[i + 1] - x[i]))


def critical_dimension(x, y, kind='step_positive', x_from=None, x_to=None,
                       min_points=3):
    """Fit one feature of a line profile and measure it.

    The model is piecewise constant — the shape a critical-dimension
    measurement assumes, because what is being measured is *the height
    between two levels*, not the shape of the flank:

    step_positive / step_negative
        a hill or a trench: one level inside the feature (``y2``) and one
        outside it (``y1``), with both edges fitted, so the feature's width
        ``x2 - x1`` comes out of the same fit
    edge_left / edge_right
        a single transition: ``y1`` is the reference side (left or right
        respectively) and ``y2`` the other, so ``h`` is signed the way that
        side reads it

    Every break point is placed by exhaustive least squares over the
    selection — no starting guess to get wrong — and then refined to
    sub-sample precision at the half-height crossing. ``x_from``/``x_to``
    restrict it to the feature the user picked; without them the whole
    profile is used.

    The quoted errors are the standard deviations of the points making up
    each level (the roughness of the terraces, which is what limits the
    measurement), and the error on ``h`` adds them in quadrature. Returns
    None if the selection is too short to hold a feature.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    if x_from is not None and x_to is not None:
        lo, hi = sorted((float(x_from), float(x_to)))
        keep &= (x >= lo) & (x <= hi)
    x, y = x[keep], y[keep]
    n = y.size
    min_points = max(int(min_points), 1)
    if kind not in CD_FUNCTIONS or n < 2 * min_points + 1:
        return None

    if kind.startswith('circle'):
        # An arc, not a step: the answer is a radius. 'up' is a dome, 'down'
        # a dish, and the fit is rejected if the centre is on the wrong side —
        # a dome fitted as a dish is a number with no meaning.
        fit = _fit_circle(x, y)
        if fit is None:
            return None
        cx, cy, radius = fit
        dome = cy < float(np.mean(y))
        if dome != (kind == 'circle_up'):
            return None
        residual = np.hypot(x - cx, y - cy) - radius
        return {'kind': kind, 'radius': radius, 'cx': cx, 'cy': cy,
                'h': float(np.nanmax(y) - np.nanmin(y)),
                'h_err': float(np.std(residual)),
                'y1': float(np.nanmin(y)), 'y2': float(np.nanmax(y)),
                'y1_err': float(np.std(residual)),
                'y2_err': float(np.std(residual)),
                'x1': float(x[0]), 'x2': float(x[-1]),
                'width': float(x[-1] - x[0]),
                'rms': float(np.sqrt(np.mean(residual ** 2))),
                'x_from': float(x[0]), 'x_to': float(x[-1]), 'n': int(n)}

    cumulative = np.concatenate(([0.0], np.cumsum(y)))
    total = cumulative[-1]

    if kind.startswith('edge'):
        if n < 2 * min_points:
            return None
        k = np.arange(min_points, n - min_points + 1)
        gain = cumulative[k] ** 2 / k + (total - cumulative[k]) ** 2 / (n - k)
        split = int(k[np.argmax(gain)])
        left, right = y[:split], y[split:]
        # 'left' reads the step from the left terrace, 'right' from the right;
        # the fit is the same, the sign of h is not.
        if kind == 'edge_left':
            first, second = left, right
        else:
            first, second = right, left
        y1, y2 = float(first.mean()), float(second.mean())
        edge = _level_crossing(x, y, split, 0.5 * (left.mean() + right.mean()))
        return {'kind': kind, 'h': y2 - y1, 'y1': y1, 'y2': y2,
                'y1_err': float(first.std()), 'y2_err': float(second.std()),
                'h_err': float(np.hypot(first.std(), second.std())),
                'x1': edge, 'x2': None, 'width': None,
                'x_from': float(x[0]), 'x_to': float(x[-1]), 'n': int(n)}

    positive = kind == 'step_positive'
    best = (-np.inf, 0, 0)
    for i in range(min_points, n - 2 * min_points + 1):
        j = np.arange(i + min_points, n - min_points + 1)
        inner_n = (j - i).astype(float)
        inner_sum = cumulative[j] - cumulative[i]
        outer_n = n - inner_n
        outer_sum = total - inner_sum
        gain = inner_sum ** 2 / inner_n + outer_sum ** 2 / outer_n
        wanted = ((inner_sum / inner_n > outer_sum / outer_n) if positive
                  else (inner_sum / inner_n < outer_sum / outer_n))
        gain = np.where(wanted, gain, -np.inf)
        top = int(np.argmax(gain))
        if gain[top] > best[0]:
            best = (float(gain[top]), i, int(j[top]))
    if not np.isfinite(best[0]):
        return None                      # no feature of the requested sign
    _score, i, j = best

    inner = y[i:j]
    outer = np.concatenate([y[:i], y[j:]])
    y1, y2 = float(outer.mean()), float(inner.mean())
    level = 0.5 * (y1 + y2)
    x1 = _level_crossing(x, y, i, level, hi=j)
    x2 = _level_crossing(x, y, j, level, lo=i)
    return {'kind': kind, 'h': y2 - y1, 'y1': y1, 'y2': y2,
            'y1_err': float(outer.std()), 'y2_err': float(inner.std()),
            'h_err': float(np.hypot(outer.std(), inner.std())),
            'x1': x1, 'x2': x2, 'width': abs(x2 - x1),
            'x_from': float(x[0]), 'x_to': float(x[-1]), 'n': int(n)}


def cd_model_curve(x, result):
    """The fitted step as a curve over ``x``, for drawing it on the profile."""
    x = np.asarray(x, dtype=float)
    if not isinstance(result, dict):
        return None
    if result.get('radius'):
        cx, cy, radius = (float(result['cx']), float(result['cy']),
                          float(result['radius']))
        inside = radius ** 2 - (x - cx) ** 2
        arc = np.sqrt(np.clip(inside, 0.0, None))
        curve = cy + arc if result.get('kind') == 'circle_up' else cy - arc
        return np.where(inside > 0, curve, np.nan)
    y1, y2 = float(result.get('y1', 0.0)), float(result.get('y2', 0.0))
    x1 = result.get('x1')
    if x1 is None:
        return None
    if result.get('x2') is None:
        # An edge: y1 is the reference side, so which side it draws on
        # depends on which one that is.
        left, right = ((y1, y2) if result.get('kind') == 'edge_left'
                       else (y2, y1))
        return np.where(x < float(x1), left, right)
    inside = (x >= float(x1)) & (x <= float(result['x2']))
    return np.where(inside, y2, y1)


# ---------------------------------------------------------------------------
# Force curves
# ---------------------------------------------------------------------------

def force_curve_split(z, d, seg=None):
    """Split a force curve into (approach, dwell, retract) pairs of arrays.

    ARDF segment markers are (approach_start, dwell_start, retract_start) —
    validated on Asylum data, where the Z sensor rises through the approach,
    holds at its maximum through the dwell, and falls through the retract.
    Without markers the Z maximum is used as the turnaround (no dwell).
    """
    z = np.asarray(z, dtype=float)
    d = np.asarray(d, dtype=float)
    n = len(z)
    if seg is not None and len(seg) >= 3 and 0 < seg[1] <= seg[2] < n:
        s1, s2 = int(seg[1]), int(seg[2])
    else:
        s1 = s2 = int(np.argmax(z))
        if s1 < 2 or s1 > n - 2:
            s1 = s2 = n // 2
    return (z[:s1], d[:s1]), (z[s1:s2], d[s1:s2]), (z[s2:], d[s2:])


def force_curve_analyze(z, d, k=1.0, seg=None, baseline_frac=0.3):
    """Metrics of one force curve. ``z``/``d`` (deflection) in metres,
    ``k`` (spring constant) in N/m; forces come out in newtons.

    Each segment is zeroed on its own far-from-surface baseline (the start
    of the approach, the end of the retract) — using one baseline for both
    overestimates adhesion whenever the deflection drifts during the dwell.
    """
    (za, da), (zd, dd), (zr, dr) = force_curve_split(z, d, seg)
    nb_a = max(int(len(da) * baseline_frac), 5)
    base_a = float(np.median(da[:nb_a])) if len(da) else 0.0
    nb_r = max(int(len(dr) * baseline_frac), 5)
    base_r = float(np.median(dr[-nb_r:])) if len(dr) else base_a
    fa = (da - base_a) * k
    fd = (dd - base_a) * k
    fr = (dr - base_r) * k
    return {'approach': (za, fa), 'dwell': (zd, fd), 'retract': (zr, fr),
            'max_force': float(np.nanmax(fa)) if len(fa) else 0.0,
            'adhesion': float(-np.nanmin(fr)) if len(fr) else 0.0,
            'baseline_approach': base_a, 'baseline_retract': base_r}


def volume_channel_index(volume, *names):
    """Index of the first matching channel name in a force volume, or None."""
    channels = [c.lower() for c in (volume.get('channels') or [])]
    for name in names:
        if name.lower() in channels:
            return channels.index(name.lower())
    return None


# Every quantity a force curve gives up, as (key, label, unit, scale from SI).
# The instrument's own map viewer offers a tab per channel — AdF for adhesion,
# HtF for the height the trigger force was reached at, and so on — so the same
# set is computed here from the curves themselves rather than read back from
# whatever the instrument happened to save.
FORCE_METRICS = (
    ('adhesion', 'Adhesion', 'nN', 1e9),
    ('max_force', 'Maximum force', 'nN', 1e9),
    ('snap_in', 'Snap-in force', 'nN', 1e9),
    ('height_at_force', 'Height at max force', 'nm', 1e9),
    ('contact_height', 'Height at contact', 'nm', 1e9),
    ('indentation', 'Indentation', 'nm', 1e9),
    ('stiffness', 'Contact stiffness', 'N/m', 1.0),
    ('modulus', 'DMT modulus', 'MPa', 1e-6),
    ('dissipation', 'Dissipation', 'aJ', 1e18),
    ('slope_baseline', 'Baseline slope', 'N/m', 1.0),
)
FORCE_METRIC_LABELS = {k: (label, unit) for k, label, unit, _s in FORCE_METRICS}


def _contact_metrics(z, force, k, poisson=0.5, tip_radius=10e-9):
    """Contact point, stiffness, indentation and DMT modulus of an approach.

    The contact point is where the curve leaves its baseline: the last sample
    below the baseline noise before the force climbs to its maximum. From it,
    the stiffness is the slope of the top third of the loading curve, the
    indentation the sample deformation (piezo travel minus cantilever
    deflection), and the modulus a DMT fit of F = 4/3 E* sqrt(R) d^1.5 over
    the same top third.

    A modulus from a single tip radius is only ever indicative — that is true
    of the instrument's own number too — so the radius is a parameter and the
    stiffness, which needs no contact model at all, is reported beside it.
    """
    out = {'contact_height': np.nan, 'stiffness': np.nan,
           'indentation': np.nan, 'modulus': np.nan, 'snap_in': np.nan}
    z = np.asarray(z, dtype=float)
    force = np.asarray(force, dtype=float)
    if z.size < 8 or force.size != z.size:
        return out
    peak = int(np.argmax(force))
    if peak < 4:
        return out
    noise = float(np.std(force[:max(peak // 4, 5)])) or 1e-15
    below = np.flatnonzero(force[:peak] < 3.0 * noise)
    contact = int(below[-1]) if below.size else 0
    out['contact_height'] = float(z[contact])
    # Snap-in: how far the force dips below the baseline before contact, the
    # jump-to-contact of an attractive tip.
    if contact > 1:
        out['snap_in'] = float(-np.min(force[:contact]))

    top = np.arange(contact + int(0.66 * (peak - contact)), peak + 1)
    if top.size < 3:
        return out
    travel = z[top] - z[contact]
    deflection = force[top] / k if k else np.zeros_like(force[top])
    indent = travel - (deflection - deflection[0])
    # Sign: on approach the piezo moves the surface into the tip, and which
    # way z counts differs by instrument. Work in magnitudes.
    indent = np.abs(indent)
    out['indentation'] = float(indent[-1])
    slope = np.polyfit(np.abs(travel), force[top], 1)[0]
    out['stiffness'] = float(slope)
    usable = indent > 0
    if usable.sum() >= 3:
        # F = 4/3 E* sqrt(R) d^1.5  ->  E* is the slope against d^1.5
        basis = indent[usable] ** 1.5
        scale = float(np.dot(basis, force[top][usable]) / np.dot(basis, basis))
        e_star = scale * 3.0 / (4.0 * np.sqrt(tip_radius))
        out['modulus'] = float(e_star * (1.0 - poisson ** 2))
    return out


def force_curve_metrics(z, d, k=1.0, seg=None, tip_radius=10e-9,
                        poisson=0.5):
    """Every scalar a single force curve yields, in SI units."""
    result = force_curve_analyze(z, d, k, seg)
    za, fa = result['approach']
    _zr, fr = result['retract']
    metrics = {'adhesion': result['adhesion'],
               'max_force': result['max_force'],
               'height_at_force': (float(za[int(np.argmax(fa))])
                                   if len(fa) else np.nan),
               'dissipation': np.nan,
               'slope_baseline': np.nan}
    metrics.update(_contact_metrics(za, fa, k, poisson, tip_radius))
    # Dissipation: the area enclosed between loading and unloading, which is
    # the energy the surface kept. Both branches are integrated against the
    # same z, so a different sample count on each does not bias it.
    zr, _fr = result['retract']
    if len(za) > 2 and len(zr) > 2:
        lo = max(min(za.min(), zr.min()), min(za.max(), zr.max()) - 1e30)
        grid = np.linspace(max(za.min(), zr.min()), min(za.max(), zr.max()),
                           256)
        if grid[-1] > grid[0]:
            fa_i = np.interp(grid, np.sort(za), fa[np.argsort(za)])
            fr_i = np.interp(grid, np.sort(zr), fr[np.argsort(zr)])
            metrics['dissipation'] = float(abs(np.trapezoid(fa_i - fr_i, grid))
                                           if hasattr(np, 'trapezoid') else
                                           abs(np.trapz(fa_i - fr_i, grid)))
    if len(fa) > 10:
        n = max(len(fa) // 5, 5)
        metrics['slope_baseline'] = float(np.polyfit(za[:n], fa[:n], 1)[0])
    return metrics


def volume_extra_channels(volume):
    """Channels of a volume that are not Z or deflection.

    The instrument's map viewer has a tab per recorded channel — amplitude at
    force, the drive voltages — and those are simply other channels sampled
    along the same curve. Each becomes a map of "its value where the force
    peaked", which is what "at force" means.
    """
    channels = list(volume.get('channels') or [])
    iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
    idefl = volume_channel_index(volume, 'Defl', 'Deflection')
    return [(i, name) for i, name in enumerate(channels)
            if i not in (iz, idefl)]


def force_volume_maps(volume, tip_radius=10e-9, poisson=0.5, extras=True):
    """Per-pixel metric maps from a force volume.

    Returns one 2-D array per entry of ``FORCE_METRICS``, in that entry's
    unit and NaN where a pixel has no curve, plus (when ``extras``) one
    ``'at:<channel>'`` map per other recorded channel, holding that channel's
    value at the moment of maximum force. Row 0 of every map is the TOP of
    the frame, matching how the imported image channels are stored.
    """
    lines = int(volume.get('lines', 0))
    points = int(volume.get('points', 0))
    iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
    idefl = volume_channel_index(volume, 'Defl', 'Deflection')
    if not lines or not points or iz is None or idefl is None:
        return {}
    k = spring_constant(volume)
    maps = {key: np.full((lines, points), np.nan)
            for key, _l, _u, _s in FORCE_METRICS}
    scales = {key: scale for key, _l, _u, scale in FORCE_METRICS}
    others = volume_extra_channels(volume) if extras else []
    for _i, name in others:
        maps[f'at:{name}'] = np.full((lines, points), np.nan)
    for curve in volume.get('curves') or []:
        row, col = curve['line'], curve['point']
        if not (0 <= row < lines and 0 <= col < points):
            continue
        data = curve['data']
        if iz >= len(data) or idefl >= len(data):
            continue
        try:
            metrics = force_curve_metrics(data[iz], data[idefl], k,
                                          curve['seg'], tip_radius, poisson)
        except Exception:
            continue
        # line 0 is the bottom scan line; flip to the image row convention.
        for key, value in metrics.items():
            if key in maps:
                maps[key][lines - 1 - row, col] = value * scales[key]
        if others:
            defl = np.asarray(data[idefl], dtype=float)
            if defl.size:
                peak = int(np.nanargmax(defl))
                for i, name in others:
                    if i < len(data):
                        channel = np.asarray(data[i], dtype=float)
                        if peak < channel.size:
                            maps[f'at:{name}'][lines - 1 - row, col] = \
                                float(channel[peak])
    return maps


def spring_constant(volume):
    """The cantilever's k in N/m, from the volume's note (1.0 if unstated)."""
    try:
        return float(volume.get('meta', {}).get('SpringConstant', 1.0)) or 1.0
    except (TypeError, ValueError):
        return 1.0


def force_curve_rows(volume, stride=1, segments=True):
    """Yield every sample of every curve as a flat row, for export.

    ``(line, point, segment, index, z_nm, deflection_nm, force_nN)``. A force
    map is tens of millions of samples, so this is a generator: the writer
    streams it out rather than the tool building the whole table in memory.
    ``stride`` keeps every n-th sample, for when a full export is more than a
    spreadsheet can hold.
    """
    iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
    idefl = volume_channel_index(volume, 'Defl', 'Deflection')
    if iz is None or idefl is None:
        return
    k = spring_constant(volume)
    stride = max(int(stride), 1)
    for curve in volume.get('curves') or []:
        data = curve['data']
        if iz >= len(data) or idefl >= len(data):
            continue
        z = np.asarray(data[iz], dtype=float)
        d = np.asarray(data[idefl], dtype=float)
        n = min(z.size, d.size)
        if not n:
            continue
        result = force_curve_analyze(z[:n], d[:n], k, curve['seg'])
        pieces = ((('approach', result['approach']),
                   ('dwell', result['dwell']),
                   ('retract', result['retract']))
                  if segments else (('all', (z[:n], (d[:n] - 0.0) * k)),))
        for name, (zs, fs) in pieces:
            for i in range(0, len(zs), stride):
                yield (int(curve['line']), int(curve['point']), name, i,
                       float(zs[i]) * 1e9, float(fs[i]) / k * 1e9,
                       float(fs[i]) * 1e9)


def force_metric_rows(volume, tip_radius=10e-9, poisson=0.5):
    """Yield one row of every metric per curve: (line, point, *values)."""
    iz = volume_channel_index(volume, 'ZSnsr', 'Raw', 'ZSensor')
    idefl = volume_channel_index(volume, 'Defl', 'Deflection')
    if iz is None or idefl is None:
        return
    k = spring_constant(volume)
    keys = [key for key, _l, _u, _s in FORCE_METRICS]
    scales = {key: scale for key, _l, _u, scale in FORCE_METRICS}
    for curve in volume.get('curves') or []:
        data = curve['data']
        if iz >= len(data) or idefl >= len(data):
            continue
        try:
            metrics = force_curve_metrics(data[iz], data[idefl], k,
                                          curve['seg'], tip_radius, poisson)
        except Exception:
            continue
        yield ([int(curve['line']), int(curve['point'])]
               + [float(metrics.get(key, np.nan)) * scales[key]
                  for key in keys])
