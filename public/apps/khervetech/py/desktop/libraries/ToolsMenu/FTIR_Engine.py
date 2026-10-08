# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/FTIR_Engine.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/FTIR_Engine.py
"""
FTIR numerics: ordinate units, preprocessing operations and the
non-destructive processing pipeline.

No wx in here - everything is pure numpy so it can be unit-tested and reused
(batch processing, series analysis, export).

The central idea is that a sheet keeps its *raw* spectrum forever
(``FTIR_Raw``) and a list of processing *steps* (``FTIR_Steps``).  What the
main plot shows is always ``apply_pipeline(raw, steps)`` - so a step can be
switched off, re-ordered or re-tuned at any time and nothing is ever lost.
"""

import numpy as np


# ---------------------------------------------------------------------------
# Ordinate units
# ---------------------------------------------------------------------------
# Every conversion is routed through absorbance.  "Arbitrary" is a real unit
# here, not a fallback: single-beam interferogram intensities and
# instrument-scaled exports must NOT be silently treated as %T - doing that
# is what produces absorbances of -4.5.

U_T_PCT = "Transmittance (%)"
U_T_FRAC = "Transmittance (fraction)"
U_ABSORBANCE = "Absorbance"
U_R_PCT = "Reflectance (%)"
U_KM = "Kubelka-Munk"
U_ARB = "Intensity (a.u.)"

ALL_UNITS = (U_T_PCT, U_T_FRAC, U_ABSORBANCE, U_R_PCT, U_KM, U_ARB)

# Units whose bands point *down* (a transmittance-like ordinate)
_DOWNWARD = (U_T_PCT, U_T_FRAC, U_R_PCT)

UNIT_DESCRIPTIONS = {
    U_T_PCT: "Percent transmittance, 0-100. Bands point down.",
    U_T_FRAC: "Transmittance as a fraction, 0-1. Bands point down.",
    U_ABSORBANCE: "Absorbance, A = -log10(T). Bands point up.",
    U_R_PCT: "Percent reflectance, 0-100 (specular / diffuse).",
    U_KM: "Kubelka-Munk f(R) = (1-R)^2 / 2R. DRIFTS pseudo-absorbance.",
    U_ARB: "Uncalibrated intensity (single-beam, counts, instrument units). "
           "No physical conversion to absorbance is possible.",
}

# Conversions that only make sense for a given measurement mode.  DRIFTS gets
# Kubelka-Munk; ATR and transmission do not.
MODE_UNITS = {
    "ATR": (U_T_PCT, U_T_FRAC, U_ABSORBANCE, U_ARB),
    "Transmission": (U_T_PCT, U_T_FRAC, U_ABSORBANCE, U_ARB),
    "DRIFTS": (U_R_PCT, U_KM, U_ABSORBANCE, U_ARB),
    "Specular reflectance": (U_R_PCT, U_ABSORBANCE, U_ARB),
    "Unknown": ALL_UNITS,
}


def bands_point_down(unit):
    return unit in _DOWNWARD


# ---------------------------------------------------------------------------
# Unit detection
# ---------------------------------------------------------------------------

def detect_y_unit(y_values):
    """Guess the ordinate unit from the shape of the data.

    Returns ``(unit, confidence, reason)`` with confidence in 0-1.  Anything
    below ~0.7 should be confirmed by the user rather than assumed - a wrong
    guess here silently corrupts every later number.
    """
    y = np.asarray([v for v in np.asarray(y_values, dtype=float).ravel()
                    if np.isfinite(v)], dtype=float)
    if y.size == 0:
        return U_ARB, 0.0, "No finite data points."

    lo, hi = float(np.min(y)), float(np.max(y))
    span = hi - lo
    if span <= 0:
        return U_ARB, 0.0, "Spectrum is flat."

    median = float(np.median(y))
    # Where the baseline sits inside the data range: transmittance-like data
    # rests near the top (most of the spectrum is "no absorption"),
    # absorbance-like data rests near the bottom.
    baseline_pos = (median - lo) / span

    if hi > 150 or lo < -1.5:
        # Far outside every calibrated ordinate.  Single-beam intensity,
        # counts, or an already-broken conversion.
        return (U_ARB, 0.9,
                f"Values span {lo:.4g} to {hi:.4g}, outside any calibrated "
                f"ordinate (%T is 0-100, absorbance roughly 0-4).")

    if 0.0 <= lo and hi <= 110.0 and hi > 5.0:
        if baseline_pos > 0.6:
            return (U_T_PCT, 0.9,
                    f"0-100 range with the baseline near the top "
                    f"({100 * baseline_pos:.0f}% of the range): percent "
                    f"transmittance.")
        return (U_T_PCT, 0.45,
                "0-100 range, but the baseline sits low - could be percent "
                "transmittance of a very absorbing sample, or an absorbance "
                "spectrum on an unusual scale.")

    if hi <= 1.05 and lo >= -0.05:
        if baseline_pos > 0.6:
            return (U_T_FRAC, 0.8,
                    "0-1 range with a high baseline: transmittance as a "
                    "fraction.")
        return (U_ABSORBANCE, 0.75,
                "0-1 range with a low baseline and upward bands: absorbance.")

    if hi <= 6.0 and lo >= -0.5 and baseline_pos < 0.5:
        return (U_ABSORBANCE, 0.8,
                f"Range {lo:.3g} to {hi:.3g} with a low baseline and upward "
                f"bands: absorbance.")

    return (U_ARB, 0.3,
            f"Range {lo:.4g} to {hi:.4g} does not match any expected "
            f"ordinate cleanly.")


def validate_values(y_values, unit):
    """Sanity-check data against the unit it claims to be in.

    Returns a list of human-readable warnings (empty if all is well).
    """
    y = np.asarray(y_values, dtype=float)
    y = y[np.isfinite(y)]
    warnings = []
    if y.size == 0:
        return ["Spectrum contains no finite values."]
    lo, hi = float(np.min(y)), float(np.max(y))

    if unit == U_T_PCT:
        if hi > 110:
            warnings.append(f"Maximum is {hi:.4g} %T - above the 0-100 range. "
                            f"The data may not be percent transmittance.")
        if lo < -1:
            warnings.append(f"Minimum is {lo:.4g} %T - negative transmittance "
                            f"is unphysical.")
    elif unit == U_T_FRAC:
        if hi > 1.1 or lo < -0.05:
            warnings.append(f"Range {lo:.4g} to {hi:.4g} is outside the 0-1 "
                            f"fractional transmittance range.")
    elif unit == U_R_PCT:
        if hi > 110 or lo < -1:
            warnings.append(f"Range {lo:.4g} to {hi:.4g} is outside the "
                            f"0-100 %R range.")
    elif unit == U_ABSORBANCE:
        if lo < -0.5:
            warnings.append(f"Minimum absorbance is {lo:.4g}. Strongly "
                            f"negative absorbance usually means the ordinate "
                            f"was mis-identified, or the background is "
                            f"stronger than the sample single beam.")
        if hi > 6:
            warnings.append(f"Maximum absorbance is {hi:.4g}; above ~3 the "
                            f"detector is normally saturated and band shapes "
                            f"are not quantitative.")
    return warnings


class ConversionError(ValueError):
    """Raised when a requested ordinate conversion is not physically defined."""


# ---------------------------------------------------------------------------
# Conversions (everything routed through absorbance)
# ---------------------------------------------------------------------------

_T_FLOOR = 1e-6  # transmittance floor, keeps log10 finite


def to_absorbance(y, unit):
    y = np.asarray(y, dtype=float)
    if unit == U_ABSORBANCE:
        return y.copy()
    if unit == U_T_PCT:
        return -np.log10(np.clip(y / 100.0, _T_FLOOR, None))
    if unit == U_T_FRAC:
        return -np.log10(np.clip(y, _T_FLOOR, None))
    if unit == U_R_PCT:
        return -np.log10(np.clip(y / 100.0, _T_FLOOR, None))
    if unit == U_KM:
        return -np.log10(np.clip(km_to_reflectance(y), _T_FLOOR, None))
    raise ConversionError(
        f"'{unit}' is an uncalibrated ordinate - there is no defined "
        f"conversion to absorbance. Set the correct input unit first "
        f"(or ratio the spectrum against its background).")


def from_absorbance(a, unit):
    a = np.asarray(a, dtype=float)
    if unit == U_ABSORBANCE:
        return a.copy()
    if unit == U_T_PCT:
        return 100.0 * np.power(10.0, -a)
    if unit == U_T_FRAC:
        return np.power(10.0, -a)
    if unit == U_R_PCT:
        return 100.0 * np.power(10.0, -a)
    if unit == U_KM:
        return reflectance_to_km(np.power(10.0, -a))
    raise ConversionError(
        f"'{unit}' is an uncalibrated ordinate - a spectrum cannot be "
        f"converted into it.")


def reflectance_to_km(r):
    """Kubelka-Munk f(R) = (1 - R)^2 / (2R), R as a fraction."""
    r = np.clip(np.asarray(r, dtype=float), 1e-6, 1.0)
    return (1.0 - r) ** 2 / (2.0 * r)


def km_to_reflectance(f):
    """Invert Kubelka-Munk. Root of R^2 - 2(1 + f)R + 1 = 0 with R <= 1."""
    f = np.clip(np.asarray(f, dtype=float), 0.0, None)
    b = 1.0 + f
    # The stable root: b - sqrt(b^2 - 1) cancels catastrophically for large f
    # (strongly absorbing samples), which is exactly where DRIFTS data live.
    return 1.0 / (b + np.sqrt(np.clip(b * b - 1.0, 0.0, None)))


def convert(y, src_unit, dst_unit):
    """Convert a spectrum between ordinates.

    Returns ``(values, warnings)``.  Raises :class:`ConversionError` when the
    conversion is undefined (uncalibrated data in either direction).
    """
    y = np.asarray(y, dtype=float)
    if src_unit == dst_unit:
        return y.copy(), []
    warnings = list(validate_values(y, src_unit))
    absorbance = to_absorbance(y, src_unit)
    out = from_absorbance(absorbance, dst_unit)
    warnings.extend(validate_values(out, dst_unit))
    # De-duplicate while keeping order
    seen, unique = set(), []
    for w in warnings:
        if w not in seen:
            seen.add(w)
            unique.append(w)
    return out, unique


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------

def als_baseline(y, lam=1e6, p=0.001, niter=10):
    """Asymmetric least-squares baseline (Eilers & Boelens 2005)."""
    from scipy import sparse
    from scipy.sparse.linalg import spsolve

    y = np.asarray(y, dtype=float)
    L = len(y)
    if L < 3:
        return np.zeros_like(y)
    D = sparse.diags([1, -2, 1], [0, -1, -2], shape=(L, L - 2))
    D = lam * D.dot(D.transpose())
    w = np.ones(L)
    W = sparse.spdiags(w, 0, L, L)
    z = y.copy()
    for _ in range(niter):
        W.setdiag(w)
        z = spsolve((W + D).tocsc(), w * y)
        w = p * (y > z) + (1 - p) * (y < z)
    return z


def rubberband_baseline(x, y):
    """Rubberband (lower convex hull) baseline."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    order = np.argsort(x)
    xs, ys = x[order], y[order]

    hull = []
    for i in range(len(xs)):
        while len(hull) >= 2:
            (x1, y1), (x2, y2) = hull[-2], hull[-1]
            if (x2 - x1) * (ys[i] - y1) - (y2 - y1) * (xs[i] - x1) <= 0:
                hull.pop()
            else:
                break
        hull.append((xs[i], ys[i]))

    hx = np.array([pt[0] for pt in hull])
    hy = np.array([pt[1] for pt in hull])
    baseline_sorted = np.interp(xs, hx, hy)
    baseline = np.empty_like(baseline_sorted)
    baseline[order] = baseline_sorted
    return baseline


def polynomial_baseline(x, y, order=3, niter=25):
    """Iterative polynomial baseline: fit, clip anything above the fit, repeat.

    Converges onto the lower envelope without the ALS smoothing parameter.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    # Normalise x, otherwise a degree-5 fit over 4000 cm-1 is ill-conditioned
    xn = (x - x.mean()) / (x.std() or 1.0)
    work = y.copy()
    fit = np.zeros_like(y)
    for _ in range(niter):
        coeffs = np.polyfit(xn, work, order)
        fit = np.polyval(coeffs, xn)
        new = np.minimum(work, fit)
        if np.allclose(new, work):
            break
        work = new
    return fit


BASELINE_METHODS = ("ALS (asymmetric least squares)",
                    "Rubberband (convex hull)",
                    "Polynomial (iterative)")


def compute_baseline(x, y, method="ALS (asymmetric least squares)", **params):
    if method.startswith("Rubberband"):
        return rubberband_baseline(x, y)
    if method.startswith("Polynomial"):
        return polynomial_baseline(x, y, order=int(params.get('order', 3)))
    return als_baseline(y, lam=float(params.get('lam', 1e6)),
                        p=float(params.get('p', 0.001)))


# ---------------------------------------------------------------------------
# Smoothing / despiking
# ---------------------------------------------------------------------------

def savgol_smooth(y, window=9, order=2):
    from scipy.signal import savgol_filter
    y = np.asarray(y, dtype=float)
    window = int(window)
    if window % 2 == 0:
        window += 1
    window = max(3, min(window, len(y) - (1 - len(y) % 2)))
    if window <= order or len(y) < window:
        return y.copy()
    return savgol_filter(y, window, int(order))


def despike(y, threshold=6.0, width=3):
    """Remove single-channel spikes (cosmic rays, detector glitches).

    Whitaker-Hayes: a spike is an outlier of the *first difference*, not of
    the spectrum.  Testing the spectrum itself against a running median (the
    obvious approach) flags the apex of every sharp band, because a band's
    curvature also departs from its local median - which would quietly delete
    real narrow features such as the nitrate 1384 cm-1 line.
    """
    from scipy.signal import medfilt
    y = np.asarray(y, dtype=float)
    if len(y) < 5:
        return y.copy(), 0

    d = np.diff(y)
    mad = np.median(np.abs(d - np.median(d)))
    if mad <= 0:
        return y.copy(), 0
    z = 0.6745 * (d - np.median(d)) / mad

    flagged = np.abs(z) > float(threshold)
    # d[j] is the step from y[j] to y[j+1]; point i is a spike when the step
    # into it and the step out of it are both extreme and opposite in sign.
    bad = np.zeros(len(y), dtype=bool)
    bad[1:-1] = (flagged[:-1] & flagged[1:]
                 & (np.sign(d[:-1]) != np.sign(d[1:])))

    if not np.any(bad):
        return y.copy(), 0

    k = int(width)
    if k % 2 == 0:
        k += 1
    k = max(3, k)
    med = medfilt(y, kernel_size=k)
    out = y.copy()
    out[bad] = med[bad]
    return out, int(np.count_nonzero(bad))


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

NORMALISE_MODES = ("Max band = 1", "Unit vector (SNV-free)", "Min-max 0-1",
                   "SNV (standard normal variate)", "Area = 1")


def normalise(y, mode="Max band = 1"):
    """Normalise an absorbance-like ordinate.

    Never divides by a peak height that could be negative or zero - that is
    what made the old 'Absorbance %' button a no-op on data whose maximum was
    negative.
    """
    y = np.asarray(y, dtype=float)
    if y.size == 0:
        return y.copy()
    finite = y[np.isfinite(y)]
    if finite.size == 0:
        return y.copy()

    lo, hi = float(np.min(finite)), float(np.max(finite))
    span = hi - lo
    if mode == "Min-max 0-1":
        return (y - lo) / span if span > 0 else y - lo
    if mode == "SNV (standard normal variate)":
        sd = float(np.std(finite))
        return (y - float(np.mean(finite))) / sd if sd > 0 else y - np.mean(finite)
    if mode == "Unit vector (SNV-free)":
        norm = float(np.sqrt(np.sum(finite ** 2)))
        return y / norm if norm > 0 else y.copy()
    if mode == "Area = 1":
        area = float(np.sum(np.abs(finite)))
        return y / area if area > 0 else y.copy()
    # "Max band = 1": measure the band height above the local floor, so a
    # spectrum sitting on a negative offset still normalises correctly.
    return (y - lo) / span if span > 0 else y - lo


# ---------------------------------------------------------------------------
# Atmospheric water vapour and CO2
# ---------------------------------------------------------------------------

# Rotational-vibrational H2O vapour structure: the two band systems, with the
# characteristic ~ 10-20 cm-1 line spacing that makes atmospheric residuals
# look like noise on top of real bands.
_H2O_SYSTEMS = ((3500.0, 3960.0, 3756.0, 260.0),   # nu1/nu3 stretch envelope
                (1300.0, 2000.0, 1595.0, 240.0))   # nu2 bend envelope
_H2O_SPACING = 14.0
_H2O_WIDTH = 3.0

# CO2: the asymmetric stretch doublet and the bending mode
_CO2_LINES = ((2361.0, 6.0, 1.00), (2341.0, 6.0, 0.85), (667.0, 8.0, 0.35))

ATMOSPHERIC_REGIONS = (("H2O stretch", 3500.0, 3960.0),
                       ("CO2 stretch", 2280.0, 2400.0),
                       ("H2O bend", 1300.0, 2000.0),
                       ("CO2 bend", 630.0, 700.0))


def _gaussian(x, centre, width):
    return np.exp(-0.5 * ((x - centre) / width) ** 2)


def h2o_vapour_reference(x):
    """Synthetic water-vapour absorbance reference on the grid ``x``."""
    x = np.asarray(x, dtype=float)
    ref = np.zeros_like(x)
    for lo, hi, centre, sigma in _H2O_SYSTEMS:
        envelope_peak = _gaussian(np.array([centre]), centre, sigma)[0]
        line = lo
        while line <= hi:
            amp = _gaussian(np.array([line]), centre, sigma)[0] / envelope_peak
            ref += amp * _gaussian(x, line, _H2O_WIDTH)
            line += _H2O_SPACING
    peak = float(np.max(ref)) if ref.size else 0.0
    return ref / peak if peak > 0 else ref


def co2_reference(x):
    """Synthetic atmospheric CO2 absorbance reference on the grid ``x``."""
    x = np.asarray(x, dtype=float)
    ref = np.zeros_like(x)
    for centre, width, amp in _CO2_LINES:
        ref += amp * _gaussian(x, centre, width)
    peak = float(np.max(ref)) if ref.size else 0.0
    return ref / peak if peak > 0 else ref


def _sharp_component(x, y, window_cm=60.0):
    """The high-frequency part of a spectrum.

    Atmospheric structure is sharp; sample bands in a condensed phase are
    broad.  Fitting only the sharp component stops the correction from eating
    a genuine broad O-H band that happens to sit under the vapour region.
    """
    x = np.asarray(x, dtype=float)
    step = float(np.median(np.abs(np.diff(x)))) if len(x) > 1 else 1.0
    win = max(5, int(round(window_cm / max(step, 1e-9))))
    if win % 2 == 0:
        win += 1
    if win >= len(y):
        return np.zeros_like(y)
    return y - savgol_smooth(y, window=win, order=2)


def atmospheric_correction(x, y, do_h2o=True, do_co2=True, max_scale=None):
    """Estimate and subtract atmospheric H2O and CO2 from an absorbance-like
    spectrum.

    The references are fitted by least squares against the *sharp* component
    of the spectrum inside the atmospheric windows only, so broad sample
    bands are untouched.

    Returns ``(corrected, info)`` where ``info`` holds the scale factors, the
    subtracted curve and the residual RMS inside each corrected window.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    sharp = _sharp_component(x, y)

    total = np.zeros_like(y)
    info = {'scales': {}, 'residual_rms': {}, 'components': {}}

    jobs = []
    if do_h2o:
        jobs.append(("H2O", h2o_vapour_reference(x),
                     [(lo, hi) for name, lo, hi in ATMOSPHERIC_REGIONS
                      if name.startswith("H2O")]))
    if do_co2:
        jobs.append(("CO2", co2_reference(x),
                     [(lo, hi) for name, lo, hi in ATMOSPHERIC_REGIONS
                      if name.startswith("CO2")]))

    for name, ref, regions in jobs:
        mask = np.zeros_like(x, dtype=bool)
        for lo, hi in regions:
            mask |= (x >= lo) & (x <= hi)
        mask &= np.isfinite(sharp) & (ref > 1e-6)
        if not np.any(mask):
            info['scales'][name] = 0.0
            continue

        ref_sharp = _sharp_component(x, ref)
        denom = float(np.sum(ref_sharp[mask] ** 2))
        if denom <= 0:
            info['scales'][name] = 0.0
            continue
        scale = float(np.sum(ref_sharp[mask] * sharp[mask]) / denom)
        # A negative scale would *add* atmosphere; clamp at zero.
        scale = max(0.0, scale)
        if max_scale is not None:
            scale = min(scale, float(max_scale))

        component = scale * ref
        total += component
        info['scales'][name] = scale
        info['components'][name] = component
        resid = sharp[mask] - scale * ref_sharp[mask]
        info['residual_rms'][name] = float(np.sqrt(np.mean(resid ** 2)))

    info['curve'] = total
    return y - total, info


# ---------------------------------------------------------------------------
# ATR correction
# ---------------------------------------------------------------------------

ATR_CRYSTALS = {"Diamond": 2.4, "ZnSe": 2.4, "Ge": 4.0, "Si": 3.4, "KRS-5": 2.37}


def atr_correction(x, y, crystal="Diamond", angle_deg=45.0, n_sample=1.5,
                   bounces=1):
    """Correct an ATR spectrum towards a transmission-like band profile.

    ATR penetration depth grows with wavelength, so low-wavenumber bands are
    over-represented relative to a transmission spectrum.  The standard
    first-order correction scales absorbance by the wavenumber-dependent
    effective path length.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n1 = ATR_CRYSTALS.get(crystal, 2.4)
    theta = np.radians(float(angle_deg))
    ratio = float(n_sample) / n1
    denom = np.sin(theta) ** 2 - ratio ** 2
    if denom <= 0:
        raise ValueError(
            f"No total internal reflection for {crystal} (n={n1}) at "
            f"{angle_deg} deg with a sample index of {n_sample}. "
            f"Increase the incident angle or check the crystal.")
    # d_p proportional to 1/(wavenumber); the correction divides it out.
    safe_x = np.clip(np.abs(x), 1.0, None)
    dp = 1.0 / (2.0 * np.pi * safe_x * n1 * np.sqrt(denom))
    # Reference the correction at 1000 cm-1 so absolute levels stay familiar
    dp_ref = 1.0 / (2.0 * np.pi * 1000.0 * n1 * np.sqrt(denom))
    return y * (dp_ref / dp) / max(1, int(bounces))


# ---------------------------------------------------------------------------
# Processing pipeline
# ---------------------------------------------------------------------------

STEP_DESPIKE = 'despike'
STEP_ATMOSPHERIC = 'atmospheric'
STEP_ATR = 'atr'
STEP_BASELINE = 'baseline'
STEP_SMOOTH = 'smooth'
STEP_NORMALISE = 'normalise'

# Fixed execution order.  Spikes first (they poison every fit), atmosphere
# next (it is an additive instrument artefact), then optics, then baseline,
# then cosmetics.
STEP_ORDER = (STEP_DESPIKE, STEP_ATMOSPHERIC, STEP_ATR, STEP_BASELINE,
              STEP_SMOOTH, STEP_NORMALISE)

STEP_LABELS = {
    STEP_DESPIKE: "Spike removal",
    STEP_ATMOSPHERIC: "Atmospheric correction (H2O / CO2)",
    STEP_ATR: "ATR correction",
    STEP_BASELINE: "Baseline correction",
    STEP_SMOOTH: "Smoothing",
    STEP_NORMALISE: "Normalisation",
}

STEP_DEFAULTS = {
    STEP_DESPIKE: {'threshold': 6.0, 'width': 3},
    STEP_ATMOSPHERIC: {'h2o': True, 'co2': True},
    STEP_ATR: {'crystal': 'Diamond', 'angle': 45.0, 'n_sample': 1.5},
    STEP_BASELINE: {'method': BASELINE_METHODS[0], 'lam': 1e6, 'p': 0.001,
                    'order': 3},
    STEP_SMOOTH: {'window': 9, 'order': 2},
    STEP_NORMALISE: {'mode': NORMALISE_MODES[0]},
}

# Auto Clean presets.  "Gentle" only removes what is unambiguously an
# artefact; "Strong" is for badly drifting or noisy data and will visibly
# reshape the spectrum.
AUTO_CLEAN_PRESETS = {
    "Gentle": [
        (STEP_DESPIKE, {'threshold': 8.0, 'width': 3}),
        (STEP_ATMOSPHERIC, {'h2o': True, 'co2': True}),
    ],
    "Standard": [
        (STEP_DESPIKE, {'threshold': 6.0, 'width': 3}),
        (STEP_ATMOSPHERIC, {'h2o': True, 'co2': True}),
        (STEP_BASELINE, {'method': BASELINE_METHODS[0], 'lam': 1e6,
                         'p': 0.001}),
        (STEP_SMOOTH, {'window': 7, 'order': 2}),
    ],
    "Strong": [
        (STEP_DESPIKE, {'threshold': 4.0, 'width': 5}),
        (STEP_ATMOSPHERIC, {'h2o': True, 'co2': True}),
        (STEP_BASELINE, {'method': BASELINE_METHODS[0], 'lam': 1e5,
                         'p': 0.005}),
        (STEP_SMOOTH, {'window': 15, 'order': 2}),
        (STEP_NORMALISE, {'mode': NORMALISE_MODES[0]}),
    ],
}


def make_step(step_id, enabled=True, **params):
    merged = dict(STEP_DEFAULTS.get(step_id, {}))
    merged.update(params)
    return {'id': step_id, 'enabled': bool(enabled), 'params': merged}


def default_steps():
    """A full, all-disabled step list - the panel shows every stage even when
    nothing has been applied yet."""
    return [make_step(sid, enabled=False) for sid in STEP_ORDER]


def preset_steps(preset):
    """Step list for an Auto Clean preset (every other stage present but off)."""
    chosen = dict(AUTO_CLEAN_PRESETS.get(preset, []))
    steps = []
    for sid in STEP_ORDER:
        if sid in chosen:
            steps.append(make_step(sid, enabled=True, **chosen[sid]))
        else:
            steps.append(make_step(sid, enabled=False))
    return steps


def apply_pipeline(x, y_raw, raw_unit, target_unit, steps, mode="Unknown"):
    """Run the whole non-destructive pipeline.

    Returns a dict with:
      ``y``        final processed spectrum in ``target_unit``
      ``stages``   [(label, values)] after each enabled step, raw first
      ``curves``   named diagnostic curves (baseline, atmospheric)
      ``warnings`` anything the user needs to know
      ``notes``    per-step one-line summaries for the history panel

    Processing always happens in absorbance (where the operations are
    linear and physically meaningful) and the result is converted into the
    display unit at the very end.
    """
    x = np.asarray(x, dtype=float)
    y_raw = np.asarray(y_raw, dtype=float)
    warnings, notes = [], []
    curves = {}

    result = {'y': y_raw.copy(), 'stages': [], 'curves': curves,
              'warnings': warnings, 'notes': notes, 'work_unit': raw_unit}

    # --- into the working (absorbance) domain -----------------------------
    if raw_unit == U_ARB:
        # Nothing physical can be done; pass the data through untouched so the
        # user still sees their spectrum, but say so loudly.
        warnings.append(
            "The ordinate is uncalibrated (%s). Set the correct input unit in "
            "Data & Metadata before processing - conversions, baselines and "
            "band intensities are not meaningful otherwise." % U_ARB)
        result['stages'].append(("Raw spectrum", y_raw.copy()))
        return result

    try:
        work = to_absorbance(y_raw, raw_unit)
    except ConversionError as exc:
        warnings.append(str(exc))
        result['stages'].append(("Raw spectrum", y_raw.copy()))
        return result

    warnings.extend(validate_values(y_raw, raw_unit))
    result['stages'].append(("Raw spectrum", y_raw.copy()))

    by_id = {s['id']: s for s in (steps or [])}
    for step_id in STEP_ORDER:
        step = by_id.get(step_id)
        if not step or not step.get('enabled'):
            continue
        params = dict(STEP_DEFAULTS.get(step_id, {}))
        params.update(step.get('params') or {})

        try:
            if step_id == STEP_DESPIKE:
                work, n_spikes = despike(work, params['threshold'],
                                         params['width'])
                notes.append(f"Spike removal: {n_spikes} point(s) replaced "
                             f"(> {params['threshold']:g} sigma).")

            elif step_id == STEP_ATMOSPHERIC:
                work, info = atmospheric_correction(
                    x, work, do_h2o=bool(params.get('h2o', True)),
                    do_co2=bool(params.get('co2', True)))
                curves['atmospheric'] = info['curve']
                scale_txt = ", ".join(f"{k} x{v:.4g}"
                                      for k, v in info['scales'].items())
                rms_txt = ", ".join(f"{k} residual RMS {v:.3g}"
                                    for k, v in info['residual_rms'].items())
                summary = scale_txt or "nothing to subtract"
                notes.append(f"Atmospheric correction: {summary}"
                             + (f"; {rms_txt}" if rms_txt else ""))
                for name, scale in info['scales'].items():
                    if scale > 0.5:
                        warnings.append(
                            f"The fitted {name} contribution is large "
                            f"(x{scale:.3g}). Check that a real sample band "
                            f"is not being subtracted.")

            elif step_id == STEP_ATR:
                if mode not in ("ATR", "Unknown"):
                    warnings.append(
                        f"ATR correction was applied to data recorded in "
                        f"{mode} mode, where it does not apply.")
                work = atr_correction(x, work, params['crystal'],
                                      params['angle'], params['n_sample'])
                notes.append(f"ATR correction: {params['crystal']} crystal at "
                             f"{params['angle']:g} deg, n_sample "
                             f"{params['n_sample']:g}.")

            elif step_id == STEP_BASELINE:
                extra = {k: v for k, v in params.items() if k != 'method'}
                baseline = compute_baseline(x, work, params['method'], **extra)
                curves['baseline'] = baseline
                work = work - baseline
                notes.append(f"Baseline: {params['method']}.")

            elif step_id == STEP_SMOOTH:
                work = savgol_smooth(work, params['window'], params['order'])
                notes.append(f"Smoothing: Savitzky-Golay, window "
                             f"{int(params['window'])}, order "
                             f"{int(params['order'])}.")

            elif step_id == STEP_NORMALISE:
                work = normalise(work, params['mode'])
                notes.append(f"Normalisation: {params['mode']}.")

        except Exception as exc:      # a bad parameter must not kill the plot
            warnings.append(f"{STEP_LABELS[step_id]} failed: {exc}")
            continue

        result['stages'].append((STEP_LABELS[step_id], work.copy()))

    # --- back out to the display unit --------------------------------------
    normalised = any(s.get('id') == STEP_NORMALISE and s.get('enabled')
                     for s in (steps or []))
    baselined = any(s.get('id') == STEP_BASELINE and s.get('enabled')
                    for s in (steps or []))
    if target_unit != U_ABSORBANCE and (normalised or baselined):
        # A normalised or baseline-corrected ordinate is no longer a physical
        # absorbance, so 10^-A is not a physical transmittance.
        warnings.append(
            f"The spectrum has been {'normalised' if normalised else 'baseline corrected'}"
            f", so it is no longer a calibrated absorbance. Displaying it as "
            f"{target_unit} is for appearance only.")

    try:
        final = from_absorbance(work, target_unit)
    except ConversionError as exc:
        warnings.append(str(exc))
        final = work
        target_unit = U_ABSORBANCE

    result['y'] = final
    result['work_unit'] = target_unit
    if result['stages']:
        result['stages'][-1] = ("Processed spectrum", final.copy())
    return result


# ---------------------------------------------------------------------------
# Band detection
# ---------------------------------------------------------------------------

DETECTION_METHODS = ("Intensity (prominence)",
                     "2nd derivative (resolves shoulders)")


def detect_bands(x, y, unit, method=DETECTION_METHODS[0], prominence_pct=5.0,
                 min_distance_cm=25.0, deriv_window=11):
    """Find bands in a spectrum.

    The 2nd-derivative method finds the minima of d2y/dnu2, which sit at band
    centres even when two bands overlap into one apparent maximum - the usual
    way of resolving shoulders in a condensed-phase IR spectrum.

    Returns a list of dicts: ``wavenumber``, ``y``, ``height``,
    ``relative_height`` (0-1 against the strongest band), ``fwhm`` (crude,
    from the half-height width) and ``method``.
    """
    from scipy.signal import find_peaks, peak_widths

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if x.size < 5:
        return []

    order = np.argsort(x)
    xs, ys = x[order], y[order]

    # Work in a "bands point up" signal whatever the ordinate is
    signal = -ys if bands_point_down(unit) else ys.copy()
    span = float(np.max(signal) - np.min(signal))
    if span <= 0:
        return []

    step = float(np.median(np.abs(np.diff(xs)))) or 1.0
    distance = max(1, int(round(float(min_distance_cm) / step)))

    if method.startswith("2nd derivative"):
        smooth = savgol_smooth(signal, window=int(deriv_window), order=3)
        d2 = np.gradient(np.gradient(smooth, xs), xs)
        search = -d2
        search_span = float(np.max(search) - np.min(search)) or 1.0
        prominence = (float(prominence_pct) / 100.0) * search_span
    else:
        search = signal
        prominence = (float(prominence_pct) / 100.0) * span

    indices, props = find_peaks(search, prominence=prominence,
                                distance=distance)
    if indices.size == 0:
        return []

    heights = signal[indices] - float(np.min(signal))
    strongest = float(np.max(heights)) or 1.0

    try:
        widths = peak_widths(signal, indices, rel_height=0.5)[0] * step
    except Exception:
        widths = np.full(indices.shape, np.nan)

    bands = []
    for k, idx in enumerate(indices):
        bands.append({
            'wavenumber': float(xs[idx]),
            'y': float(ys[idx]),
            'height': float(heights[k]),
            'relative_height': float(heights[k] / strongest),
            'fwhm': float(widths[k]) if np.isfinite(widths[k]) else None,
            'method': method,
        })
    bands.sort(key=lambda b: -b['wavenumber'])
    return bands


# ---------------------------------------------------------------------------
# Sheet helpers (the storage contract used by the UI)
# ---------------------------------------------------------------------------

def ensure_raw(sheet_data):
    """Capture the pristine spectrum the first time a sheet is processed.

    After this, ``Raw Data`` is free to hold the processed spectrum - the
    original is safe in ``FTIR_Raw`` and every step is reversible.
    """
    raw = sheet_data.get('FTIR_Raw')
    if raw and raw.get('y'):
        return raw
    raw = {'x': list(sheet_data.get('B.E.', [])),
           'y': list(sheet_data.get('Raw Data', [])),
           'unit': sheet_data.get('FTIR_Input_Unit')
                   or sheet_data.get('FTIR_Y_Unit', U_T_PCT)}
    sheet_data['FTIR_Raw'] = raw
    sheet_data.setdefault('FTIR_Input_Unit', raw['unit'])
    return raw


def get_steps(sheet_data):
    steps = sheet_data.get('FTIR_Steps')
    if not steps:
        steps = default_steps()
        sheet_data['FTIR_Steps'] = steps
    # Repair a step list saved by an older version
    by_id = {s['id']: s for s in steps if isinstance(s, dict) and 'id' in s}
    ordered = []
    for sid in STEP_ORDER:
        step = by_id.get(sid) or make_step(sid, enabled=False)
        params = dict(STEP_DEFAULTS.get(sid, {}))
        params.update(step.get('params') or {})
        ordered.append({'id': sid, 'enabled': bool(step.get('enabled')),
                        'params': params})
    sheet_data['FTIR_Steps'] = ordered
    return ordered


def recompute(sheet_data):
    """Re-run the pipeline for a sheet and write the result into ``Raw Data``.

    Returns the pipeline result dict.
    """
    raw = ensure_raw(sheet_data)
    steps = get_steps(sheet_data)
    meta = sheet_data.get('FTIR_Meta', {})
    x = np.asarray(raw['x'], dtype=float)
    y = np.asarray(raw['y'], dtype=float)
    target = sheet_data.get('FTIR_Y_Unit') or raw['unit']

    result = apply_pipeline(x, y, raw['unit'], target, steps,
                            mode=meta.get('mode', 'Unknown'))

    sheet_data['Raw Data'] = np.asarray(result['y'], dtype=float).tolist()
    sheet_data['FTIR_Y_Unit'] = result['work_unit']
    sheet_data['FTIR_History'] = list(result['notes'])

    # Diagnostic curves are kept so they can be plotted and exported
    curves = {}
    for name, values in result['curves'].items():
        arr = np.asarray(values, dtype=float)
        if arr.size:
            curves[name] = arr.tolist()
    sheet_data['FTIR_Curves'] = curves

    bkg = sheet_data.get('Background', {})
    if 'Bkg Y' in bkg and bkg['Bkg Y']:
        bkg['Bkg Y'] = sheet_data['Raw Data']

    return result


def reset_processing(sheet_data):
    """Throw away every processing step and go back to the raw spectrum."""
    raw = ensure_raw(sheet_data)
    sheet_data['FTIR_Steps'] = default_steps()
    sheet_data['FTIR_Y_Unit'] = raw['unit']
    sheet_data['Raw Data'] = list(raw['y'])
    sheet_data['FTIR_History'] = []
    sheet_data['FTIR_Curves'] = {}
    bkg = sheet_data.get('Background', {})
    if 'Bkg Y' in bkg and bkg['Bkg Y']:
        bkg['Bkg Y'] = list(raw['y'])
    return raw
