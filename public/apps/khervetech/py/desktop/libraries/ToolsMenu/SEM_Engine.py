# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/SEM_Engine.py. Regenerate with tools/export_khervetech.py.
"""
Nanoparticle detection and sizing for SEM images.

Pure numpy/scipy/scikit-image — no wx, no matplotlib — so it can be tested
headlessly and reused. The pipeline is deliberately conservative:

    threshold -> fill holes -> drop specks -> (optionally) split clusters
              -> discard edge-truncated particles -> measure

Two decisions in here matter more than the rest.

**Splitting is opt-in and size-gated.** Watershed on a distance transform is the
standard way to separate touching particles, but on a dense field of small
particles it happily splits *single* ones: on the reference image it turned
4121 objects into 9486 and pulled the median diameter from 36 nm down to 25 nm.
So splitting is off by default, and when enabled it only touches blobs bigger
than ``split_min_multiple`` times the median blob area — genuine clusters —
leaving isolated particles alone.

**Edge-truncated particles are discarded, and the area is shrunk to match.**
A particle clipped by the frame is the wrong size, so it cannot be measured;
but simply not counting it while dividing by the full area under-reports the
number density. The Miles-Lantuejoul correction handles both: count only
particles wholly inside, and divide by the area of the region in which a
particle's reference point could sit without touching the edge, i.e. each
usable band shrunk by one mean diameter in each direction.
"""

import numpy as np
from scipy import ndimage as ndi

# Detection defaults. 'split_touching' is False on purpose — see the module
# docstring; turning it on by default silently doubles the count.
DEFAULTS = {
    'polarity': 'bright',        # 'bright' or 'dark' particles
    'threshold_method': 'otsu',  # 'otsu' | 'tophat' | 'manual'
    'threshold_value': None,     # used when threshold_method == 'manual'
    'tophat_radius': 12,         # > particle radius; only for the local method
    'min_size_px': 6,
    'max_size_px': 0,            # 0 = no upper limit (area, in pixels)
    # Brightness/contrast applied before thresholding so faint or low-contrast
    # particles separate from the background. 0 leaves the image untouched.
    'brightness': 0.0,           # -100 .. 100
    'contrast': 0.0,             # -100 .. 100
    'auto_contrast': False,      # percentile stretch before manual adjust
    # Feret diameter and solidity need a convex hull per particle, which on a
    # dense field costs ~5 s each against ~0.2 s for everything else. Off by
    # default so the preview stays interactive; the Results tab turns them on.
    'shape_metrics': False,
    'fill_holes': True,
    'split_touching': False,
    'split_min_multiple': 3.0,   # only split blobs > N x the median blob area
    'split_sigma': 1.5,          # smoothing of the distance transform
    'split_min_distance': 3,     # minimum separation of watershed seeds
    'exclude_edge': True,
}

# Below this many pixels across, shape and size measurements are dominated by
# the sampling rather than the sample, and the tool says so.
MIN_RELIABLE_DIAMETER_PX = 10


def adjust_image(image, brightness=0.0, contrast=0.0, auto=False):
    """Return a brightness/contrast-adjusted copy of ``image``.

    Used both for the on-screen preview and as a pre-processing step before
    thresholding, so that faint or low-contrast particles can be pulled clear of
    the background before detection. ``brightness`` and ``contrast`` run from
    -100 to 100 (0 = unchanged); ``auto`` first stretches the 1st-99th
    percentile to the full range, which fixes most low-contrast micrographs on
    its own.

    Returns the input unchanged (same object) when nothing is asked for, so the
    common no-adjustment path costs nothing.
    """
    brightness = float(brightness)
    contrast = float(contrast)
    if not auto and brightness == 0.0 and contrast == 0.0:
        return image
    work = np.asarray(image, dtype=np.float64)
    if work.size == 0:
        return image
    top = float(work.max())
    if top <= 0:
        return image
    norm = np.clip(work / top, 0.0, 1.0)
    if auto:
        lo, hi = np.percentile(norm, (1.0, 99.0))
        if hi > lo:
            norm = np.clip((norm - lo) / (hi - lo), 0.0, 1.0)
    if contrast != 0.0 or brightness != 0.0:
        gain = 1.0 + contrast / 100.0          # [-100, 100] -> [0, 2]
        offset = brightness / 100.0
        norm = np.clip((norm - 0.5) * gain + 0.5 + offset, 0.0, 1.0)
    return norm * top


def _drop_by_size(labels, min_px, max_px):
    """Zero out particles whose pixel area is outside [min_px, max_px].

    ``min_px`` is re-applied here (as well as on the pre-split binary) because
    splitting a cluster can leave fragments below the floor; ``max_px`` of 0
    means no upper limit.
    """
    if labels.max() == 0:
        return labels
    sizes = np.bincount(labels.ravel())
    remove = np.zeros(sizes.size, bool)
    if min_px and min_px > 1:
        remove |= sizes < int(min_px)
    if max_px and max_px > 0:
        remove |= sizes > int(max_px)
    remove[0] = False                          # background is never a particle
    if remove.any():
        labels = np.where(remove[labels], 0, labels)
    return labels


def _threshold(image, mask, params):
    """Return (binary foreground, threshold value or None for local methods)."""
    from skimage.filters import threshold_otsu

    method = params.get('threshold_method', 'otsu')
    bright = params.get('polarity', 'bright') == 'bright'

    if method == 'manual' and params.get('threshold_value') is not None:
        level = float(params['threshold_value'])
        return ((image > level) if bright else (image < level)), level

    if method == 'tophat':
        # For images with an uneven background: a white top-hat removes
        # everything larger than the structuring element, flattening the
        # illumination gradient while leaving the particles, and Otsu then
        # works on the residual.
        #
        # (Sauvola, the usual local-threshold suggestion, is wrong here: it is
        # built for document binarization, where the background is meant to
        # survive the comparison. On a flat SEM background it selects ~97% of
        # the frame.)
        image = _flatten_background(image, params, bright)
        bright = True

    values = image[mask]
    if values.size == 0 or values.min() == values.max():
        return np.zeros(image.shape, bool), None
    level = float(threshold_otsu(values))
    return ((image > level) if bright else (image < level)), level


def _flatten_background(image, params, bright):
    """White top-hat the image so particles sit on a flat background.

    Dark particles are inverted first, so the caller can always treat the
    result as bright-on-dark.
    """
    from skimage.morphology import disk, white_tophat

    working = image.astype(float)
    if not bright:
        working = float(image.max()) - working
    radius = int(params.get('tophat_radius', 12))
    return white_tophat(working, disk(max(radius, 1)))


def _clean(binary, params):
    """Fill interior holes and remove sub-resolution specks."""
    from skimage.morphology import remove_small_objects

    if params.get('fill_holes', True):
        binary = ndi.binary_fill_holes(binary)
    min_size = int(params.get('min_size_px', 6))
    if min_size > 1:
        # skimage 0.26 renamed min_size -> max_size and changed the comparison
        # to '<=', so pass min_size - 1 to keep 'remove anything smaller than
        # min_size' meaning the same thing across versions.
        try:
            binary = remove_small_objects(binary, max_size=min_size - 1)
        except TypeError:
            binary = remove_small_objects(binary, min_size=min_size)
    return binary


def _split_clusters(binary, params):
    """Watershed-split only the blobs large enough to be genuine clusters."""
    from skimage.feature import peak_local_max
    from skimage.measure import label
    from skimage.segmentation import watershed

    base = label(binary)
    if base.max() == 0:
        return base

    sizes = np.bincount(base.ravel())[1:]
    if sizes.size == 0:
        return base
    threshold = np.median(sizes) * float(params.get('split_min_multiple', 3.0))
    cluster_labels = np.where(sizes >= threshold)[0] + 1
    if cluster_labels.size == 0:
        return base

    clusters = np.isin(base, cluster_labels)
    distance = ndi.distance_transform_edt(clusters)
    sigma = float(params.get('split_sigma', 1.5))
    if sigma > 0:
        # Smoothing first is what stops a single noisy particle producing
        # several distance maxima and being split into fragments.
        distance = ndi.gaussian_filter(distance, sigma)

    seeds = peak_local_max(distance, labels=clusters, exclude_border=False,
                           min_distance=int(params.get('split_min_distance', 3)))
    if len(seeds) == 0:
        return base
    markers = np.zeros(distance.shape, int)
    markers[tuple(seeds.T)] = 1
    markers = ndi.label(markers)[0]

    split = watershed(-distance, markers, mask=clusters)
    # Re-join the untouched blobs, renumbered above the split ones.
    singles = label(binary & ~clusters)
    singles[singles > 0] += split.max()
    return np.where(clusters, split, singles)


def _drop_edge_particles(labels, mask):
    """Remove particles touching the image edge or the excluded region.

    A particle clipped by the frame — or by the databar — has an unknowable
    true size, so it must not enter the statistics.
    """
    if labels.max() == 0:
        return labels, 0
    forbidden = np.zeros(labels.shape, bool)
    forbidden[0, :] = forbidden[-1, :] = True
    forbidden[:, 0] = forbidden[:, -1] = True
    # Pixels just outside the analysed region count as an edge too.
    outside = ~mask
    if outside.any():
        forbidden |= ndi.binary_dilation(outside, np.ones((3, 3), bool))

    touching = np.unique(labels[forbidden])
    touching = touching[touching > 0]
    dropped = len(touching)
    if dropped:
        labels = np.where(np.isin(labels, touching), 0, labels)
    return labels, dropped


def _effective_area_px(mask, mean_diameter_px):
    """Area available to a whole particle's centre, per Miles-Lantuejoul.

    Particles touching an edge are discarded, so dividing the survivors by the
    full area would under-report the density. The unbiased denominator is the
    set of positions where a particle's centre can sit without its body
    crossing an edge — which is exactly the mask eroded by the particle's own
    size.

    Erosion is used rather than the textbook (W - d)(H - d) rectangle formula
    because the analysed region is not generally a rectangle: it may be the
    frame minus a databar band, a user-drawn detection region, or both at once.
    The rectangle formula silently assumes full image width, which under-reports
    the density by the ratio of the frame width to the region width.
    """
    size = int(round(mean_diameter_px))
    if size < 1:
        return float(mask.sum())
    # Erode by an N x N square. Done as an explicit N x N footprint this is
    # O(area x N^2) and on a large image with large particles takes minutes -
    # the tool looked frozen. An N x N square is the Minkowski sum of an N x 1
    # column and a 1 x N row, so eroding by the column then the row gives the
    # identical result in O(area x N), tens of times faster (146 s -> 4 s on a
    # 5 MP image with 120 px particles). border_value=0 treats the image edge as
    # outside, like any other boundary, and is kept on both 1-D passes.
    line_col = np.ones((size, 1), bool)
    line_row = np.ones((1, size), bool)
    eroded = ndi.binary_erosion(mask, line_col, border_value=0)
    eroded = ndi.binary_erosion(eroded, line_row, border_value=0)
    return float(eroded.sum())


def analyse(image, mask=None, nm_per_px=None, params=None):
    """Detect and measure particles.

    Args:
        image:      2-D array (already cropped to the region of interest).
        mask:       boolean array of pixels that count as sample; None = all.
        nm_per_px:  calibration, or None for an uncalibrated (pixel) result.
        params:     overrides for ``DEFAULTS``.

    Returns a dict with the label image, the binary mask, per-particle
    measurements and the summary statistics, keyed for direct display.
    """
    from skimage.measure import label, regionprops_table

    settings = dict(DEFAULTS)
    settings.update(params or {})

    image = np.asarray(image)
    if mask is None:
        mask = np.ones(image.shape[:2], bool)
    mask = np.asarray(mask, bool)

    image = adjust_image(image, settings.get('brightness', 0.0),
                         settings.get('contrast', 0.0),
                         settings.get('auto_contrast', False))

    binary, level = _threshold(image, mask, settings)
    binary &= mask
    binary = _clean(binary, settings)
    binary &= mask

    coverage = 100.0 * binary.sum() / mask.sum() if mask.any() else 0.0

    if settings.get('split_touching'):
        labels = _split_clusters(binary, settings)
    else:
        labels = label(binary)

    labels = _drop_by_size(labels, settings.get('min_size_px', 6),
                           settings.get('max_size_px', 0))
    detected = int(np.count_nonzero(np.unique(labels)))

    dropped = 0
    if settings.get('exclude_edge', True):
        labels, dropped = _drop_edge_particles(labels, mask)

    return measure_labels(labels, mask, nm_per_px, settings, binary=binary,
                          level=level, coverage=coverage, detected=detected,
                          dropped=dropped)


def measure_labels(labels, mask, nm_per_px, settings, binary=None, level=None,
                   coverage=None, detected=None, dropped=0):
    """Turn a finished label image into the statistics result dict.

    Split out of ``analyse`` so a detector that produces labels some other way
    (the blob finder, which rasterises round particles) gets exactly the same
    measurements, warnings and result shape as the threshold pipeline. When
    ``coverage`` / ``detected`` are not supplied they are derived from the
    labels themselves.
    """
    from skimage.measure import regionprops_table

    settings = dict(DEFAULTS, **(settings or {}))
    labels = np.asarray(labels)
    if mask is None:
        mask = np.ones(labels.shape, bool)
    if binary is None:
        binary = labels > 0
    if coverage is None:
        coverage = 100.0 * (labels > 0).sum() / mask.sum() if mask.any() else 0.0
    if detected is None:
        detected = int(np.count_nonzero(np.unique(labels)))

    if labels.max() == 0:
        return _empty_result(binary, labels, level, coverage, detected, dropped,
                             nm_per_px, settings)

    wanted = ['label', 'area', 'equivalent_diameter_area', 'centroid', 'perimeter']
    if settings.get('shape_metrics'):
        wanted += ['feret_diameter_max', 'eccentricity', 'solidity']
    props = regionprops_table(labels, properties=tuple(wanted))

    area_px = np.asarray(props['area'], dtype=float)
    ecd_px = np.asarray(props['equivalent_diameter_area'], dtype=float)
    feret_px = (np.asarray(props['feret_diameter_max'], dtype=float)
                if 'feret_diameter_max' in props else None)

    scale = float(nm_per_px) if nm_per_px else 1.0
    calibrated = bool(nm_per_px)
    ecd = ecd_px * scale
    feret = feret_px * scale if feret_px is not None else np.array([])
    area = area_px * scale ** 2

    count = int(len(ecd))
    area_eff_px = _effective_area_px(mask, float(ecd_px.mean()))
    if calibrated:
        # px -> nm -> um^2
        area_eff_um2 = area_eff_px * (scale ** 2) / 1e6
    else:
        area_eff_um2 = area_eff_px  # pixels; density is then per px^2
    density = count / area_eff_um2 if area_eff_um2 > 0 else 0.0

    unit = 'nm' if calibrated else 'px'
    stats = {
        'Count': count,
        'Detected (before edge removal)': detected,
        'Edge-truncated (excluded)': dropped,
        'Threshold': level,
        f'Density (per {"um2" if calibrated else "px2"})': density,
        'Areal Coverage (%)': coverage,
        f'ECD Mean ({unit})': float(ecd.mean()),
        f'ECD Median ({unit})': float(np.median(ecd)),
        f'ECD Std ({unit})': float(ecd.std(ddof=1)) if count > 1 else 0.0,
        f'ECD Min ({unit})': float(ecd.min()),
        f'ECD Max ({unit})': float(ecd.max()),
        f'D10 ({unit})': float(np.percentile(ecd, 10)),
        f'D50 ({unit})': float(np.percentile(ecd, 50)),
        f'D90 ({unit})': float(np.percentile(ecd, 90)),
        'Median Diameter (px)': float(np.median(ecd_px)),
    }
    if feret.size:
        stats[f'Max Feret Mean ({unit})'] = float(feret.mean())
    if 'solidity' in props:
        stats['Solidity Mean'] = float(np.mean(props['solidity']))
        stats['Eccentricity Mean'] = float(np.mean(props['eccentricity']))

    return {
        'labels': labels,
        'binary': binary,
        'stats': stats,
        'diameters': ecd,
        'feret': feret,
        'areas': area,
        'centroids': np.column_stack((props['centroid-0'], props['centroid-1'])),
        'calibrated': calibrated,
        'unit': unit,
        'warnings': _warnings(ecd_px, settings, calibrated),
        'params': settings,
    }


def detect_blobs(image, mask=None, nm_per_px=None, params=None):
    """Find round particles with a Laplacian-of-Gaussian blob detector.

    Thresholding fails on a dense agglomerate of overlapping particles: Otsu
    merges the whole film into one blob and a top-hat only picks up the
    texture inside it. A LoG blob detector instead responds to round dark (or
    bright) spots at a range of scales, so it isolates the individual
    particles even where they touch — which is what nanoparticle TEM images
    usually are.

    Each blob becomes a filled disk in a label image, so coverage, the size
    distribution and every downstream sheet are measured exactly as for the
    threshold pipeline (via ``measure_labels``). Detection runs on a
    downsampled copy (particles are many pixels across, so nothing is lost)
    to keep it interactive on a multi-megapixel micrograph.

    ``params`` keys, beyond the shared ones:
        blob_sensitivity  0..100; higher finds more, fainter particles
        min_size_px       area floor, as elsewhere (also sets the smallest
                          blob scale)
        max_size_px       area cap; 0 lets the detector search up to ~1/8 of
                          the frame
    """
    from skimage.feature import blob_log

    settings = dict(DEFAULTS, **(params or {}))
    image = np.asarray(image, dtype=float)
    if mask is None:
        mask = np.ones(image.shape[:2], bool)
    mask = np.asarray(mask, bool)

    image = adjust_image(image, settings.get('brightness', 0.0),
                         settings.get('contrast', 0.0),
                         settings.get('auto_contrast', False))

    # Work on a bright-particle, 0..1 copy so one threshold means the same on
    # any image; dark-field particles are inverted first.
    bright = settings.get('polarity', 'bright') == 'bright'
    work = image if bright else (float(image.max()) - image)
    work = np.where(mask, work, work.min())
    span = float(work.max() - work.min())
    if span <= 0:
        return _empty_result(np.zeros(image.shape, bool),
                             np.zeros(image.shape, int), None, 0.0, 0, 0,
                             nm_per_px, settings)
    work = (work - work.min()) / span

    # Downsample so blob_log is quick; particles are big enough to survive it.
    factor = max(1, int(np.ceil(max(work.shape) / 1100.0)))
    small = work[::factor, ::factor]
    small = ndi.gaussian_filter(small, 1.0)

    min_size = max(1.0, float(settings.get('min_size_px', 6)))
    max_size = float(settings.get('max_size_px', 0) or 0)
    d_min = 2.0 * np.sqrt(min_size / np.pi)                 # full-res px
    sigma_min = max(1.2, (d_min / (2.0 * np.sqrt(2.0))) / factor)
    d_max = (2.0 * np.sqrt(max_size / np.pi) if max_size > min_size
             else 0.12 * max(work.shape))
    sigma_max = max(sigma_min + 1.0, (d_max / (2.0 * np.sqrt(2.0))) / factor)

    sensitivity = float(settings.get('blob_sensitivity', 50))
    threshold = 0.02 + (100.0 - np.clip(sensitivity, 0, 100)) / 100.0 * 0.12

    blobs = blob_log(small, min_sigma=sigma_min, max_sigma=sigma_max,
                     num_sigma=10, threshold=threshold, overlap=0.4)
    # Draw the largest first, so a small particle overlapping a big one still
    # gets its own label rather than being swallowed.
    if len(blobs):
        blobs = blobs[np.argsort(-blobs[:, 2])]

    # Rasterise each blob as a filled disk into a label image at full size.
    labels = np.zeros(image.shape[:2], dtype=np.int32)
    yy, xx = np.mgrid[0:image.shape[0], 0:image.shape[1]]
    next_label = 1
    detected = 0
    for by, bx, bsigma in blobs:
        cy, cx = by * factor, bx * factor
        radius = bsigma * np.sqrt(2.0) * factor
        if radius < 1.0:
            continue
        cyi, cxi = int(round(cy)), int(round(cx))
        if not (0 <= cyi < mask.shape[0] and 0 <= cxi < mask.shape[1]
                and mask[cyi, cxi]):
            continue                                       # centre outside ROI
        area_px = np.pi * radius * radius
        if area_px < min_size or (max_size and area_px > max_size):
            continue
        disk = ((xx - cx) ** 2 + (yy - cy) ** 2) <= radius * radius
        disk &= mask
        # Larger blobs are drawn first (rasterised in descending size), so a
        # satellite particle overlapping a big one keeps its own label.
        labels[disk & (labels == 0)] = next_label
        next_label += 1
        detected += 1

    coverage = 100.0 * (labels > 0).sum() / mask.sum() if mask.any() else 0.0
    dropped = 0
    if settings.get('exclude_edge', True):
        labels, dropped = _drop_edge_particles(labels, mask)

    return measure_labels(labels, mask, nm_per_px, settings, level=None,
                          coverage=coverage, detected=detected, dropped=dropped)


def _empty_result(binary, labels, level, coverage, detected, dropped,
                  nm_per_px, settings):
    return {
        'labels': labels,
        'binary': binary,
        'stats': {'Count': 0, 'Detected (before edge removal)': detected,
                  'Edge-truncated (excluded)': dropped, 'Threshold': level,
                  'Areal Coverage (%)': coverage},
        'diameters': np.array([]), 'feret': np.array([]), 'areas': np.array([]),
        'centroids': np.empty((0, 2)),
        'calibrated': bool(nm_per_px), 'unit': 'nm' if nm_per_px else 'px',
        'warnings': ['No particles were detected. Try inverting the polarity '
                     'or lowering the minimum size.'],
        'params': settings,
    }


def _warnings(ecd_px, settings, calibrated):
    """Caveats the numbers cannot express on their own."""
    messages = []
    if not calibrated:
        messages.append('Uncalibrated image — sizes are in pixels, not nanometres.')
    median_px = float(np.median(ecd_px))
    if median_px < MIN_RELIABLE_DIAMETER_PX:
        messages.append(
            f'Median particle is only {median_px:.1f} px across. Below about '
            f'{MIN_RELIABLE_DIAMETER_PX} px the size distribution is limited by '
            f'image resolution — consider a higher magnification.')
    floor_px = 2.0 * np.sqrt(float(settings.get('min_size_px', 6)) / np.pi)
    if np.percentile(ecd_px, 10) <= floor_px * 1.05:
        messages.append(
            f'The smallest particles sit on the {settings.get("min_size_px")} px '
            f'minimum-size filter, so the low end of the distribution is '
            f'truncated by the setting rather than by the sample.')
    return messages


def boundary_overlay(labels):
    """Boolean mask of particle outlines, for drawing over the image.

    Returned as a mask rather than contours because a dense field can hold
    thousands of particles, and one RGBA overlay draws far faster than
    thousands of separate line objects.
    """
    from skimage.segmentation import find_boundaries
    if labels is None or labels.max() == 0:
        return None
    return find_boundaries(labels, mode='outer')


def histogram(diameters, bins=40):
    """(counts, bin_edges) for the size distribution."""
    diameters = np.asarray(diameters)
    if diameters.size == 0:
        return np.array([]), np.array([])
    return np.histogram(diameters, bins=bins)


def default_bin_width(diameters, target_bins=35):
    """A round bin width (1/2/5 x 10^n) giving roughly ``target_bins`` bins.

    Physical widths are what a reader can reason about — '2 nm bins' means
    something, 'bins = 37' does not — so the tool works in nanometres and picks
    a sensible round starting value rather than a bin count.
    """
    diameters = np.asarray(diameters, dtype=float)
    if diameters.size < 2:
        return 1.0
    span = float(diameters.max() - diameters.min())
    if span <= 0:
        return 1.0
    raw = span / max(target_bins, 1)
    decade = 10.0 ** np.floor(np.log10(raw))
    for step in (1.0, 2.0, 5.0, 10.0):
        if raw <= step * decade:
            return float(step * decade)
    return float(10.0 * decade)


def size_distribution(diameters, bins=40, bin_width=None):
    """Binned size distribution as (centres, counts, frequency %).

    ``bin_width`` is in the same units as ``diameters`` (nanometres for a
    calibrated image) and takes precedence over ``bins``. Edges are snapped to
    multiples of the width so the bins line up on round numbers and two
    datasets binned the same way stay directly comparable.

    Frequency is each bin's share of the whole population, so the values sum to
    100 regardless of bin width or particle count — which is what makes two
    images with different particle counts comparable.
    """
    diameters = np.asarray(diameters, dtype=float)
    if diameters.size == 0:
        return np.array([]), np.array([]), np.array([])

    if bin_width and bin_width > 0:
        low = np.floor(diameters.min() / bin_width) * bin_width
        high = np.ceil(diameters.max() / bin_width) * bin_width
        if high <= low:
            high = low + bin_width
        edges = np.arange(low, high + 0.5 * bin_width, bin_width)
        if edges.size < 2:
            edges = np.array([low, low + bin_width])
    else:
        edges = bins

    counts, edges = np.histogram(diameters, bins=edges)
    centres = 0.5 * (edges[1:] + edges[:-1])
    frequency = 100.0 * counts / diameters.size
    return centres, counts.astype(float), frequency


def mean_with_error(diameters):
    """Mean particle size with both spreads that get called 'the error'.

    ``sd`` describes how much the particles themselves vary — the right figure
    for 'the particles are 39 ± 16 nm'. ``sem`` is the uncertainty on the mean
    itself, which shrinks as more particles are counted and is the right figure
    for comparing two samples. Reporting one when the reader assumes the other
    is the usual way this number gets misread, so both are returned.
    """
    diameters = np.asarray(diameters, dtype=float)
    if diameters.size == 0:
        return None
    count = int(diameters.size)
    mean = float(diameters.mean())
    sd = float(diameters.std(ddof=1)) if count > 1 else 0.0
    return {
        'count': count,
        'mean': mean,
        'sd': sd,
        'sem': sd / np.sqrt(count) if count > 1 else 0.0,
        'ci95': 1.96 * sd / np.sqrt(count) if count > 1 else 0.0,
    }


def lognormal_curve(fit, x, n_total, bin_width, as_frequency=False):
    """The fitted distribution sampled at ``x``, scaled to the plotted y-axis.

    A probability density has to be scaled by the population and the bin width
    to sit on a histogram: counts integrate to N, frequencies to 100. Getting
    that wrong is the usual reason a fit curve floats above or below its bars.
    """
    x = np.asarray(x, dtype=float)
    if fit is None or x.size == 0:
        return None
    positive = x > 0
    density = np.zeros_like(x)
    if positive.any():
        xi = x[positive]
        density[positive] = (
            np.exp(-(np.log(xi) - fit['mu']) ** 2 / (2 * fit['sigma'] ** 2))
            / (xi * fit['sigma'] * np.sqrt(2 * np.pi)))
    scale = 100.0 if as_frequency else float(n_total)
    return density * scale * float(bin_width)


def format_mean(summary, unit='nm'):
    """One-line 'mean ± SD' with the sample size, for annotating a plot.

    SD rather than SEM: on a size distribution the reader wants to know how
    much the particles vary, not how precisely the mean is pinned down.
    """
    if not summary:
        return ''
    return (f"Mean {summary['mean']:.1f} ± {summary['sd']:.1f} {unit}"
            f"   (n = {summary['count']})")


def lognormal_fit(diameters):
    """Fit a lognormal to the size distribution.

    Nanoparticle sizes are conventionally reported this way because growth
    processes are multiplicative. Returns None when there is too little data.
    """
    diameters = np.asarray(diameters, dtype=float)
    diameters = diameters[diameters > 0]
    if diameters.size < 10:
        return None
    logs = np.log(diameters)
    mu, sigma = float(logs.mean()), float(logs.std(ddof=1))
    return {
        'mu': mu,
        'sigma': sigma,
        'median': float(np.exp(mu)),          # geometric mean
        'mode': float(np.exp(mu - sigma ** 2)),
        'mean': float(np.exp(mu + sigma ** 2 / 2)),
        'gsd': float(np.exp(sigma)),          # geometric standard deviation
    }
