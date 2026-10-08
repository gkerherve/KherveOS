# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TGA_Engine.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/TGA_Engine.py
"""
Numerical core of the TGA / DSC tool - no wx, so it can be exercised directly.

Two quantities are computed from a temperature window selected on the main
plot (the red dashed lines):

*Mass step* - the difference between the mass at the two ends of the window.
Both ends are averaged over a few points because the balance signal is noisy,
and the step is reported in mg and as a percentage of the initial mass, which
is the number quoted in the literature ("8.4 % mass loss between 250 and
400 °C").

*DSC peak area* - the integral of the heat-flow signal above a straight
baseline joining the two ends of the window.  This is the same construction
the Measure Area tool uses for an FTIR band (linear background, trapezoid
integration); the only addition is that a DSC area has to be integrated over
*time*, not temperature, to become an enthalpy:

    A_t = ∫ (DSC - baseline) dt          [µV·s/mg]
    ΔH  = A_t / S                        [mW·s/mg] = [mJ/mg] = [J/g]

where S is the calorimetric sensitivity in µV/mW recorded alongside the scan.
Instruments that already export mW/mg (= W/g) skip the division.  When the
file carries no time column the area is still reported, but only in
signal·°C/mg, which is scan-rate dependent and cannot be converted.
"""

import numpy as np


# Sensitivity values this close to 1 µV/mW mean the operator ran with the
# zero-sensitivity calibration file (NETZSCH SENSZERO), i.e. the DSC signal is
# uncalibrated and any enthalpy derived from it is meaningless.
_UNCALIBRATED_SENSITIVITY = 1.0


SMOOTH_METHODS = ('Savitzky-Golay', 'Moving average', 'Gaussian')


def smooth_trace(values, method='Savitzky-Golay', width=15, polyorder=3):
    """Smooth a trace, returning a new array of the same length.

    Savitzky-Golay is the default because it preserves the height and position
    of a step, which a plain moving average rounds off - and the height of the
    step is the measurement.  ``width`` is in points and is forced odd; a
    window wider than the data, or a polynomial order the window cannot
    support, is clamped rather than raising.
    """
    values = np.asarray(values, dtype=float)
    if values.size < 3:
        return values.copy()

    width = int(max(3, min(int(width), values.size)))
    if width % 2 == 0:
        width -= 1

    if method == 'Moving average':
        kernel = np.ones(width) / width
        # 'same' would taper the two ends towards zero; pad with the edge
        # values so the start and end of the trace keep their level.
        padded = np.pad(values, width // 2, mode='edge')
        return np.convolve(padded, kernel, mode='valid')

    if method == 'Gaussian':
        from scipy.ndimage import gaussian_filter1d
        # Match the nominal window: +-2 sigma covers it
        return gaussian_filter1d(values, sigma=max(width / 4.0, 0.5),
                                 mode='nearest')

    from scipy.signal import savgol_filter
    return savgol_filter(values, window_length=width,
                         polyorder=min(int(polyorder), width - 1))


def normalise_to_percent(mass, reference=None):
    """Mass trace rescaled so that ``reference`` (default: the first point)
    reads 100 %."""
    mass = np.asarray(mass, dtype=float)
    if reference is None:
        reference = mass[0]
    if not reference:
        raise ValueError("Reference mass is zero - cannot normalise.")
    return mass * 100.0 / float(reference)


def window_indices(temperature, t_low, t_high, segment=None, segment_value=None):
    """Indices of the points inside the selected temperature window.

    Acquisition order is preserved: a TGA programme with heating and cooling
    ramps visits the same temperature several times, so sorting by temperature
    would splice unrelated segments together.  ``segment_value`` restricts the
    result to one segment of the programme.
    """
    temperature = np.asarray(temperature, dtype=float)
    lo, hi = min(t_low, t_high), max(t_low, t_high)
    mask = (temperature >= lo) & (temperature <= hi)

    if segment is not None and segment_value is not None:
        mask &= np.isclose(np.asarray(segment, dtype=float), float(segment_value))

    return np.flatnonzero(mask)


def _edge_mean(values, indices, n_average, at_start):
    """Mean of the first (or last) ``n_average`` points of a selection."""
    picked = indices[:n_average] if at_start else indices[-n_average:]
    return float(np.nanmean(np.asarray(values, dtype=float)[picked]))


def mass_step(temperature, mass, indices, initial_mass=None, n_average=5,
              unit='mg'):
    """Mass change across the selected window.

    ``mass`` is in ``unit`` ('mg' or '%').  ``initial_mass`` (mg) is what the
    percentage is referred to; without it the percentage is taken relative to
    the mass at the start of the window.
    """
    indices = np.asarray(indices, dtype=int)
    if indices.size < 2:
        raise ValueError("Select a wider temperature range - fewer than two "
                         "points fall inside it.")

    n_average = max(1, min(int(n_average), indices.size // 2))
    temperature = np.asarray(temperature, dtype=float)

    m_start = _edge_mean(mass, indices, n_average, at_start=True)
    m_end = _edge_mean(mass, indices, n_average, at_start=False)
    delta = m_end - m_start

    if unit == '%':
        delta_pct = delta
        delta_mg = delta * initial_mass / 100.0 if initial_mass else None
    else:
        delta_mg = delta
        reference = initial_mass or m_start
        delta_pct = delta * 100.0 / reference if reference else None

    return {
        't_start': float(temperature[indices[0]]),
        't_end': float(temperature[indices[-1]]),
        'mass_start': m_start,
        'mass_end': m_end,
        'delta': delta,
        'delta_mg': delta_mg,
        'delta_pct': delta_pct,
        'unit': unit,
        'n_points': int(indices.size),
        'n_average': n_average,
        # A negative change is a loss; the sign is what tells volatilisation
        # from oxidation/uptake.
        'direction': 'gain' if delta > 0 else 'loss',
    }


def linear_baseline(x, y, indices):
    """Straight line joining the first and last selected points.

    Returned over the selected points only, in acquisition order - the same
    linear background the Measure Area tool puts under an FTIR band.
    """
    x = np.asarray(x, dtype=float)[indices]
    y = np.asarray(y, dtype=float)[indices]
    if x.size < 2 or x[-1] == x[0]:
        return np.full_like(y, y[0])
    slope = (y[-1] - y[0]) / (x[-1] - x[0])
    return y[0] + slope * (x - x[0])


# ---------------------------------------------------------------------------
# DSC baselines
#
# Which construction is right depends on what the event did to the sample. A
# melt leaves the heat capacity essentially unchanged, so a straight line is
# honest. A glass transition or a decomposition changes Cp, so the signal
# before and after the peak sit on different levels and a straight line
# systematically mis-assigns area to one side - that is what the tangential
# and sigmoidal constructions exist to fix.
# ---------------------------------------------------------------------------

BASELINE_STRAIGHT = 'Straight'
BASELINE_TANGENTIAL = 'Tangential'
BASELINE_SIGMOIDAL = 'Sigmoidal'
BASELINE_POLYNOMIAL = 'Polynomial'
BASELINE_ANCHORS = 'Manual anchors'
BASELINE_BLANK = 'Blank subtracted'

BASELINE_METHODS = (BASELINE_STRAIGHT, BASELINE_TANGENTIAL, BASELINE_SIGMOIDAL,
                    BASELINE_POLYNOMIAL, BASELINE_ANCHORS, BASELINE_BLANK)

BASELINE_DESCRIPTIONS = {
    BASELINE_STRAIGHT:
        "Straight line between the two ends of the range. Right when the heat "
        "capacity is the same before and after the event (a melt).",
    BASELINE_TANGENTIAL:
        "Tangents fitted to the flat regions on each side, blended with a "
        "step at the peak. Use when the signal returns to a different level.",
    BASELINE_SIGMOIDAL:
        "Like tangential, but the crossover follows the fraction of the peak "
        "already integrated (ISO 11357 sigmoidal). The usual choice when the "
        "heat capacity changes across the event.",
    BASELINE_POLYNOMIAL:
        "Polynomial fitted to the flat regions on each side only, then "
        "evaluated across the peak. For a curved instrument baseline.",
    BASELINE_ANCHORS:
        "Straight segments through temperatures you choose. Full manual "
        "control when nothing automatic fits.",
    BASELINE_BLANK:
        "The blank (empty-crucible) run is already subtracted from the "
        "signal, so the baseline is flat at zero.",
}

# Fraction of the range at each end taken as 'flat' when fitting tangents.
_EDGE_FRACTION = 0.15


def _edge_slices(n_points, edge_fraction=_EDGE_FRACTION):
    """Index slices of the flat regions at each end of a selection."""
    edge = max(2, int(round(n_points * edge_fraction)))
    edge = min(edge, max(2, n_points // 3))
    return slice(0, edge), slice(n_points - edge, n_points)


def _fit_line(x, y):
    """Least-squares slope and intercept, tolerant of a degenerate x."""
    if x.size < 2 or np.ptp(x) == 0:
        return 0.0, float(np.mean(y))
    slope, intercept = np.polyfit(x, y, 1)
    return float(slope), float(intercept)


def dsc_baseline(x_sel, y_sel, method=BASELINE_STRAIGHT, anchors=None,
                 poly_order=2, edge_fraction=_EDGE_FRACTION):
    """Baseline under a DSC peak, over the selected points.

    ``x_sel``/``y_sel`` are the selection only, in acquisition order.
    ``anchors`` are x positions for the manual-anchor method.
    """
    x_sel = np.asarray(x_sel, dtype=float)
    y_sel = np.asarray(y_sel, dtype=float)
    n = x_sel.size
    if n < 2:
        return np.full_like(y_sel, y_sel[0] if n else 0.0)

    if method == BASELINE_BLANK:
        # The blank has already been subtracted point by point; anything left
        # is signal, so the reference level is zero.
        return np.zeros_like(y_sel)

    if method == BASELINE_STRAIGHT:
        slope = ((y_sel[-1] - y_sel[0]) / (x_sel[-1] - x_sel[0])
                 if x_sel[-1] != x_sel[0] else 0.0)
        return y_sel[0] + slope * (x_sel - x_sel[0])

    if method == BASELINE_ANCHORS:
        points = sorted(float(a) for a in (anchors or []))
        if len(points) < 2:
            raise ValueError("The manual-anchor baseline needs at least two "
                             "anchor temperatures.")
        # Read the signal at each anchor, then join them with straight
        # segments and extend the end segments to the edges of the range.
        anchor_y = [float(np.interp(p, x_sel, y_sel)) if x_sel[0] < x_sel[-1]
                    else float(np.interp(p, x_sel[::-1], y_sel[::-1]))
                    for p in points]
        return np.interp(x_sel, points, anchor_y,
                         left=anchor_y[0], right=anchor_y[-1])

    left, right = _edge_slices(n, edge_fraction)

    if method == BASELINE_POLYNOMIAL:
        # Fit the two flat ends only - fitting through the peak would let the
        # polynomial chase the peak and swallow the area being measured.
        x_fit = np.concatenate([x_sel[left], x_sel[right]])
        y_fit = np.concatenate([y_sel[left], y_sel[right]])
        order = int(max(1, min(poly_order, x_fit.size - 1)))
        return np.polyval(np.polyfit(x_fit, y_fit, order), x_sel)

    # Tangential and sigmoidal share the two straight tangents and differ only
    # in how they cross over between them.
    slope_l, intercept_l = _fit_line(x_sel[left], y_sel[left])
    slope_r, intercept_r = _fit_line(x_sel[right], y_sel[right])
    line_l = slope_l * x_sel + intercept_l
    line_r = slope_r * x_sel + intercept_r

    if method == BASELINE_TANGENTIAL:
        # Step at the peak: the left tangent up to the extremum, the right one
        # after it.
        straight = y_sel[0] + ((y_sel[-1] - y_sel[0]) /
                               (x_sel[-1] - x_sel[0]) if x_sel[-1] != x_sel[0]
                               else 0.0) * (x_sel - x_sel[0])
        peak_index = int(np.argmax(np.abs(y_sel - straight)))
        weight = np.zeros(n)
        weight[peak_index:] = 1.0
        return (1.0 - weight) * line_l + weight * line_r

    if method == BASELINE_SIGMOIDAL:
        # ISO 11357: the crossover follows the fraction of the peak already
        # integrated, so the baseline moves from one level to the other at the
        # rate the transition itself progresses. Solved by one iteration from
        # the tangential guess, which is what makes it stable.
        straight = y_sel[0] + ((y_sel[-1] - y_sel[0]) /
                               (x_sel[-1] - x_sel[0]) if x_sel[-1] != x_sel[0]
                               else 0.0) * (x_sel - x_sel[0])
        weight = np.zeros(n)
        for _ in range(6):
            baseline = (1.0 - weight) * line_l + weight * line_r
            corrected = y_sel - baseline
            cumulative = np.abs(np.concatenate(
                [[0.0], np.cumsum(np.abs(np.diff(x_sel)) *
                                  0.5 * (corrected[1:] + corrected[:-1]))]))
            total = cumulative[-1]
            if total <= 0:
                break
            new_weight = np.clip(cumulative / total, 0.0, 1.0)
            if np.max(np.abs(new_weight - weight)) < 1e-6:
                weight = new_weight
                break
            weight = new_weight
        else:
            pass
        return (1.0 - weight) * line_l + weight * line_r

    raise ValueError(f"Unknown baseline method: {method}")


# ---------------------------------------------------------------------------
# Blank-run subtraction
# ---------------------------------------------------------------------------

def subtract_blank(sample_x, sample_y, blank_x, blank_y):
    """Subtract a blank run from a sample run, on the sample's own abscissa.

    The two runs are never sampled at identical temperatures, so the blank is
    interpolated onto the sample's grid.  Returns ``(corrected, interpolated
    blank)`` so the correction curve can be shown in its own right.
    """
    sample_x = np.asarray(sample_x, dtype=float)
    sample_y = np.asarray(sample_y, dtype=float)
    blank_x = np.asarray(blank_x, dtype=float)
    blank_y = np.asarray(blank_y, dtype=float)

    if blank_x.size < 2:
        raise ValueError("The blank run has too few points.")

    # np.interp needs an increasing abscissa; a cooling ramp is decreasing.
    order = np.argsort(blank_x)
    blank_on_sample = np.interp(sample_x, blank_x[order], blank_y[order])

    overlap = ((sample_x >= blank_x.min()) & (sample_x <= blank_x.max()))
    if not overlap.any():
        raise ValueError("The blank run covers no part of the sample's "
                         "temperature range.")

    return sample_y - blank_on_sample, blank_on_sample, overlap


def blank_coverage_note(sample_x, blank_x):
    """Warn when the blank does not span the whole sample run."""
    sample_x = np.asarray(sample_x, dtype=float)
    blank_x = np.asarray(blank_x, dtype=float)
    if blank_x.min() <= sample_x.min() and blank_x.max() >= sample_x.max():
        return ''
    return (f"The blank covers {blank_x.min():.0f}-{blank_x.max():.0f} °C but "
            f"the sample runs {sample_x.min():.0f}-{sample_x.max():.0f} °C. "
            f"Outside the overlap the blank is held at its end value.")


def _signal_unit(dsc_label):
    """Unit string inside a DSC axis label, e.g. 'DSC (µV/mg)' -> 'µV/mg'."""
    if '(' in dsc_label and ')' in dsc_label:
        return dsc_label[dsc_label.index('(') + 1:dsc_label.rindex(')')].strip()
    return dsc_label.strip()


def dsc_area(temperature, dsc, indices, time_min=None, sensitivity=None,
             dsc_label='DSC (µV/mg)', exo_up=True,
             baseline_method=BASELINE_STRAIGHT, anchors=None, poly_order=2,
             sample_mass_mg=None):
    """Integrate a DSC peak above a baseline over the selected window.

    Returns a dict with the raw area, the enthalpy when the file supports it,
    the characteristic temperatures (extrapolated onset, peak, endset), the
    peak height and FWHM, and a transparency block recording every input the
    enthalpy depends on.
    """
    indices = np.asarray(indices, dtype=int)
    if indices.size < 3:
        raise ValueError("Select a wider temperature range - fewer than three "
                         "points fall inside it.")

    temperature = np.asarray(temperature, dtype=float)
    dsc = np.asarray(dsc, dtype=float)

    t_sel = temperature[indices]
    y_sel = dsc[indices]
    baseline = dsc_baseline(t_sel, y_sel, method=baseline_method,
                            anchors=anchors, poly_order=poly_order)
    corrected = y_sel - baseline

    unit = _signal_unit(dsc_label)
    # µV/mg and mW/mg both carry a per-mass factor, so the area is per-mass too.
    signal_unit = unit.split('/')[0] if '/' in unit else unit

    # Area over temperature: always available, but scan-rate dependent.
    area_temperature = float(np.trapz(corrected, t_sel))

    area_time = None
    enthalpy = None
    enthalpy_note = ''
    sensitivity_used = None
    warnings = []

    if time_min is not None:
        t_seconds = np.asarray(time_min, dtype=float)[indices] * 60.0
        area_time = float(np.trapz(corrected, t_seconds))

        if signal_unit.lower() in ('mw', 'w'):
            # mW/mg integrated over seconds is already mJ/mg = J/g
            enthalpy = area_time
        elif sensitivity is not None:
            sens = float(np.nanmean(np.asarray(sensitivity, dtype=float)[indices]))
            if sens:
                sensitivity_used = sens
                enthalpy = area_time / sens
                if abs(sens - _UNCALIBRATED_SENSITIVITY) < 1e-9:
                    enthalpy_note = ("Sensitivity is 1 µV/mW (zero-sensitivity "
                                     "calibration) - the enthalpy is not "
                                     "calibrated.")
                    warnings.append(enthalpy_note)
        else:
            enthalpy_note = ("No calorimetric sensitivity (µV/mW) in the file - "
                             "the area cannot be converted to J/g.")
            warnings.append(enthalpy_note)
    else:
        enthalpy_note = ("No time column in the file - a DSC area can only be "
                         "converted to an enthalpy by integrating over time.")
        warnings.append(enthalpy_note)

    if not sample_mass_mg:
        warnings.append(
            "No sample mass recorded. A per-mass DSC signal (µV/mg, mW/mg) "
            "already carries it, but check the instrument normalised by the "
            "mass you think it did.")

    # The extremum of the baseline-corrected signal is the peak of the event.
    peak_index = int(np.argmax(np.abs(corrected)))
    peak_value = float(corrected[peak_index])

    # 'Exothermic up' is the instrument's own convention (NETZSCH '#EXO: 1').
    exothermic = (peak_value > 0) if exo_up else (peak_value < 0)

    heating_rate = _heating_rate(t_sel, time_min, indices)

    result = {
        't_start': float(t_sel[0]),
        't_end': float(t_sel[-1]),
        'area_temperature': area_temperature,
        'area_temperature_unit': f"{signal_unit}·°C/mg",
        'area_time': area_time,
        'area_time_unit': f"{signal_unit}·s/mg",
        'enthalpy_j_per_g': enthalpy,
        'enthalpy_note': enthalpy_note,
        'sensitivity': sensitivity_used,
        'peak_temperature': float(t_sel[peak_index]),
        'peak_height': peak_value,
        'peak_height_unit': unit,
        'onset_temperature': extrapolated_onset(t_sel, corrected, peak_index),
        'endset_temperature': extrapolated_endset(t_sel, corrected, peak_index),
        'fwhm': peak_fwhm(t_sel, corrected, peak_index),
        'nature': 'exothermic' if exothermic else 'endothermic',
        'n_points': int(indices.size),
        'baseline': baseline,
        'baseline_method': baseline_method,
        't_selected': t_sel,
        'y_selected': y_sel,
        'heating_rate': heating_rate,
        'sample_mass_mg': sample_mass_mg,
        'dsc_unit': unit,
        'exo_up': bool(exo_up),
        'warnings': warnings,
    }
    result['transparency'] = _enthalpy_transparency(result)
    return result


def _heating_rate(t_sel, time_min, indices):
    """Mean heating rate over the selection, in K/min, or None."""
    if time_min is None:
        return None
    minutes = np.asarray(time_min, dtype=float)[indices]
    if minutes.size < 2 or minutes[-1] == minutes[0]:
        return None
    return float((t_sel[-1] - t_sel[0]) / (minutes[-1] - minutes[0]))


def _enthalpy_transparency(result):
    """Every input the enthalpy depends on, as ordered ``(label, value)`` rows.

    A DSC enthalpy is a chain of conversions, each of which can silently be
    wrong; listing the inputs is what lets the number be checked rather than
    trusted.
    """
    rows = [
        ('Sample mass',
         f"{result['sample_mass_mg']:g} mg" if result['sample_mass_mg']
         else "not recorded"),
        ('DSC signal unit', result['dsc_unit']),
        ('Calorimetric sensitivity',
         f"{result['sensitivity']:g} µV/mW" if result['sensitivity']
         else ("not needed (signal already in mW/mg)"
               if result['dsc_unit'].split('/')[0].lower() in ('mw', 'w')
               else "not recorded")),
        ('Heating rate',
         f"{result['heating_rate']:.3g} K/min" if result['heating_rate']
         else "not available (no time column)"),
        ('Integration range',
         f"{result['t_start']:.1f} - {result['t_end']:.1f} °C "
         f"({result['n_points']} points)"),
        ('Baseline method', result['baseline_method']),
        ('Sign convention',
         f"exothermic {'up' if result['exo_up'] else 'down'}"),
        ('Final enthalpy unit', 'J/g (= mJ/mg)'),
    ]
    return rows


def extrapolated_endset(temperature, corrected, peak_index):
    """Extrapolated endset: the trailing-edge counterpart of the onset.

    Same ISO 11357 construction, applied to the falling side - where the
    steepest tangent after the peak crosses the baseline.
    """
    corrected = np.asarray(corrected, dtype=float)
    temperature = np.asarray(temperature, dtype=float)
    if peak_index > corrected.size - 3:
        return None

    # Mirror the trailing edge and reuse the onset construction
    t_edge = temperature[peak_index:][::-1]
    y_edge = corrected[peak_index:][::-1]
    return extrapolated_onset(t_edge, y_edge, y_edge.size - 1)


def peak_fwhm(temperature, corrected, peak_index):
    """Full width at half maximum of a baseline-corrected peak, in °C.

    The half-height crossings are interpolated between points, and None is
    returned when the peak does not come back down to half height inside the
    selection - a truncated peak has no defined width.
    """
    temperature = np.asarray(temperature, dtype=float)
    corrected = np.asarray(corrected, dtype=float)
    peak_value = corrected[peak_index]
    if peak_value == 0:
        return None

    half = peak_value / 2.0
    # Work on a signal that is positive at the peak, so one test covers both
    # endothermic and exothermic events.
    signal = corrected if peak_value > 0 else -corrected
    half = abs(half)

    def _crossing(start, stop, step):
        for i in range(start, stop, step):
            if signal[i] < half:
                # Interpolate between i and the point one step back
                j = i - step
                span = signal[j] - signal[i]
                if span == 0:
                    return float(temperature[i])
                frac = (signal[j] - half) / span
                return float(temperature[j] + frac * (temperature[i] - temperature[j]))
        return None

    left = _crossing(peak_index, -1, -1)
    right = _crossing(peak_index, signal.size, 1)
    if left is None or right is None:
        return None
    return abs(right - left)


def extrapolated_onset(temperature, corrected, peak_index):
    """Extrapolated onset: where the steepest tangent of the leading edge
    crosses the baseline.

    This is the ISO 11357 construction, and it is the temperature quoted for a
    transition - the point where the signal first *departs* from the baseline
    is far too noise-sensitive to use.  Returns None when the leading edge is
    too short to fit a tangent.
    """
    if peak_index < 2:
        return None

    t_edge = np.asarray(temperature, dtype=float)[:peak_index + 1]
    y_edge = np.asarray(corrected, dtype=float)[:peak_index + 1]
    if t_edge.size < 3 or t_edge[-1] == t_edge[0]:
        return None

    with np.errstate(divide='ignore', invalid='ignore'):
        slopes = np.gradient(y_edge, t_edge)
    if not np.isfinite(slopes).any():
        return None

    steepest = int(np.nanargmax(np.abs(slopes)))
    slope = slopes[steepest]
    if not np.isfinite(slope) or slope == 0:
        return None

    # Tangent y = y0 + slope * (T - T0), solved for y = 0 (the baseline).
    onset = t_edge[steepest] - y_edge[steepest] / slope

    # A tangent that extrapolates outside the window is meaningless.
    lo, hi = min(t_edge[0], t_edge[-1]), max(t_edge[0], t_edge[-1])
    return float(onset) if lo <= onset <= hi else None


# ---------------------------------------------------------------------------
# Glass transition (DSC step)
# ---------------------------------------------------------------------------

def _line_intersection(m1, c1, m2, c2):
    """x where two lines y = m·x + c meet, or None when they are parallel."""
    if abs(m1 - m2) < 1e-12:
        return None
    return (c2 - c1) / (m1 - m2)


def glass_transition(temperature, heat_flow, indices, exo_up=True,
                     heating_rate=None, sample_mass_mg=None):
    """Characterise a glass transition - the step in the heat-flow trace.

    The ISO 11357-2 construction: a line is fitted to the flat region before the
    step and another to the flat region after it, and the inflection tangent is
    taken at the point of steepest slope between them.  From those three lines
    come the extrapolated onset (pre-line ∩ inflection tangent), the extrapolated
    end (post-line ∩ inflection tangent) and the midpoint / half-height Tg (where
    the trace sits halfway between the two extrapolated baselines).  The step
    height between the baselines gives the specific-heat change when a heating
    rate and sample mass are known.

    ``temperature`` must be monotonic across the selection (a single ramp).
    Returns a dict of the characteristic temperatures and the step, or raises
    ``ValueError`` when the window is too short to fit the three lines.
    """
    indices = np.asarray(indices, dtype=int)
    if indices.size < 9:
        raise ValueError("Select a wider range - a glass transition needs a flat "
                         "region on each side of the step.")

    t = np.asarray(temperature, dtype=float)[indices]
    y = np.asarray(heat_flow, dtype=float)[indices]

    order = np.argsort(t)
    t = t[order]
    y = y[order]
    if t[-1] == t[0]:
        raise ValueError("The temperature does not change across the selection.")

    pre_slice, post_slice = _edge_slices(t.size)
    pre_m, pre_c = _fit_line(t[pre_slice], y[pre_slice])
    post_m, post_c = _fit_line(t[post_slice], y[post_slice])

    pre_line = pre_m * t + pre_c
    post_line = post_m * t + post_c

    # The inflection is the steepest point of the step, measured on the part of
    # the trace that lies between the two flat regions.
    mid = np.arange(pre_slice.stop, post_slice.start)
    if mid.size < 3:
        mid = np.arange(1, t.size - 1)
    with np.errstate(divide='ignore', invalid='ignore'):
        slope = np.gradient(y, t)
    inner = slope[mid]
    infl_local = int(np.nanargmax(np.abs(inner)))
    infl = int(mid[infl_local])
    infl_slope = float(slope[infl])
    infl_c = float(y[infl] - infl_slope * t[infl])

    onset = _line_intersection(pre_m, pre_c, infl_slope, infl_c)
    endset = _line_intersection(post_m, post_c, infl_slope, infl_c)

    lo, hi = float(t[0]), float(t[-1])

    def _clip(x):
        return float(x) if x is not None and lo <= x <= hi else None

    onset = _clip(onset)
    endset = _clip(endset)
    inflection = float(t[infl])

    # Midpoint: where the trace crosses the mean of the two extrapolated
    # baselines (the half-Cp temperature).
    midline = 0.5 * (pre_line + post_line)
    crossings = np.where(np.diff(np.sign(y - midline)) != 0)[0]
    if crossings.size:
        # The crossing nearest the inflection is the transition's own.
        j = crossings[np.argmin(np.abs(crossings - infl))]
        x0, x1 = t[j], t[j + 1]
        d0, d1 = (y - midline)[j], (y - midline)[j + 1]
        midpoint = float(x0 - d0 * (x1 - x0) / (d1 - d0)) if d1 != d0 else float(x0)
    else:
        midpoint = inflection

    # Step in the signal between the extrapolated baselines, read at the
    # midpoint. Positive means the post-transition level is higher.
    step_signal = float((post_m * midpoint + post_c) - (pre_m * midpoint + pre_c))

    # ΔCp = ΔΦ / (m · β): heat-flow step (W) over sample mass (g) and heating
    # rate (K/s). Only meaningful for a heating ramp with both known.
    delta_cp = None
    if (heating_rate and sample_mass_mg and heating_rate > 0
            and sample_mass_mg > 0):
        rate_k_per_s = abs(heating_rate) / 60.0
        step_watts = abs(step_signal) * 1e-3        # mW -> W
        mass_g = sample_mass_mg * 1e-3              # mg -> g
        delta_cp = step_watts / (mass_g * rate_k_per_s)

    return {
        'onset_temperature': onset,
        'midpoint_temperature': midpoint,
        'inflection_temperature': inflection,
        'endset_temperature': endset,
        'step_signal_mw': abs(step_signal),
        'delta_cp': delta_cp,
        'heating_rate': heating_rate,
        'sample_mass_mg': sample_mass_mg,
        't_start': lo,
        't_end': hi,
        'n_points': int(indices.size),
        'pre_line': pre_line,
        'post_line': post_line,
        't_selected': t,
        'y_selected': y,
    }


def format_glass_transition(result):
    """A readable summary of a glass_transition() result."""
    def _t(value):
        return f"{value:.2f} °C" if isinstance(value, (int, float)) else "-"

    lines = [
        "Glass transition (ISO 11357-2)",
        f"  Onset (extrapolated) : {_t(result.get('onset_temperature'))}",
        f"  Midpoint (half Cp)   : {_t(result.get('midpoint_temperature'))}",
        f"  Inflection           : {_t(result.get('inflection_temperature'))}",
        f"  End (extrapolated)   : {_t(result.get('endset_temperature'))}",
        f"  Step in heat flow    : {result.get('step_signal_mw', 0):.4g} mW",
    ]
    delta_cp = result.get('delta_cp')
    if delta_cp is not None:
        lines.append(f"  ΔCp                  : {delta_cp:.4g} J/(g·K)")
    else:
        lines.append("  ΔCp                  : needs heating rate + sample mass")
    rate = result.get('heating_rate')
    if rate:
        lines.append(f"  Heating rate         : {rate:.2f} K/min")
    lines.append(f"  Window               : {result['t_start']:.1f} - "
                 f"{result['t_end']:.1f} °C, {result['n_points']} points")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Mass normalisation
# ---------------------------------------------------------------------------

NORM_RAW_MG = 'Raw mass (mg)'
NORM_PCT_INITIAL = '% of initial mass'
NORM_PCT_RANGE = '% of mass at range start'
NORM_DRY_BASIS = '% of dry mass'
NORM_PER_GRAM = 'Mass change per gram (mg/g)'
NORM_PER_MOLE = 'Mass change per mole (g/mol)'

NORMALISATION_MODES = (NORM_RAW_MG, NORM_PCT_INITIAL, NORM_PCT_RANGE,
                       NORM_DRY_BASIS, NORM_PER_GRAM, NORM_PER_MOLE)

NORMALISATION_UNITS = {
    NORM_RAW_MG: 'mg',
    NORM_PCT_INITIAL: '%',
    NORM_PCT_RANGE: '%',
    NORM_DRY_BASIS: '%',
    NORM_PER_GRAM: 'mg/g',
    NORM_PER_MOLE: 'g/mol',
}


def normalise_mass(mass_mg, mode=NORM_PCT_INITIAL, initial_mass=None,
                   range_start_mass=None, dry_mass=None, molar_mass=None):
    """Put a mass trace (in mg) onto the requested basis.

    Returns ``(values, unit, label)``.  Raises ValueError when the mode needs a
    reference the caller has not supplied - guessing one would quietly change
    every number downstream.
    """
    mass = np.asarray(mass_mg, dtype=float)
    if mass.size == 0:
        raise ValueError("The mass trace is empty.")

    if mode == NORM_RAW_MG:
        return mass.copy(), 'mg', 'Mass (mg)'

    if mode == NORM_PCT_INITIAL:
        reference = initial_mass or mass[0]
        if not reference:
            raise ValueError("The initial mass is zero.")
        return mass * 100.0 / reference, '%', 'Mass (%)'

    if mode == NORM_PCT_RANGE:
        reference = range_start_mass if range_start_mass else mass[0]
        if not reference:
            raise ValueError("The mass at the start of the range is zero.")
        return mass * 100.0 / reference, '%', 'Mass (% of range start)'

    if mode == NORM_DRY_BASIS:
        if not dry_mass:
            raise ValueError("The dry-mass basis needs a dry mass - the mass "
                             "after the moisture step has finished.")
        return mass * 100.0 / float(dry_mass), '%', 'Mass (% of dry mass)'

    if mode == NORM_PER_GRAM:
        reference = initial_mass or mass[0]
        if not reference:
            raise ValueError("The initial mass is zero.")
        # Change relative to the start, expressed per gram of sample
        return (mass - mass[0]) * 1000.0 / reference, 'mg/g', 'Mass change (mg/g)'

    if mode == NORM_PER_MOLE:
        if not molar_mass:
            raise ValueError("The per-mole basis needs the molar mass of the "
                             "sample.")
        reference = initial_mass or mass[0]
        if not reference:
            raise ValueError("The initial mass is zero.")
        moles = reference / 1000.0 / float(molar_mass)   # mg -> g -> mol
        return (mass - mass[0]) / 1000.0 / moles, 'g/mol', 'Mass change (g/mol)'

    raise ValueError(f"Unknown normalisation mode: {mode}")


# ---------------------------------------------------------------------------
# DTG - the derivative of the mass trace
# ---------------------------------------------------------------------------

DTG_PER_TEMPERATURE = 'dm/dT'
DTG_PER_TIME = 'dm/dt'


def derivative_trace(mass, temperature=None, time_min=None,
                     mode=DTG_PER_TEMPERATURE, smooth_width=51,
                     smooth_method='Savitzky-Golay'):
    """DTG curve: the rate of mass change against temperature or time.

    Differentiation amplifies noise savagely - so much so that smoothing the
    mass and then calling ``np.gradient`` still leaves noise excursions larger
    than the real peak, which makes any peak search meaningless.  Instead the
    derivative is taken *analytically* from a Savitzky-Golay polynomial fitted
    over the window, and converted to the requested axis by the chain rule:

        dm/dT = (dm/di) / (dT/di)

    Both derivatives come from the same well-conditioned filter, and the
    denominator is a smooth ramp, so the result is usable straight away.  This
    also handles the uneven sampling of a real programme for free.

    Returns ``(values, unit)``; the sign convention is the physical one, so a
    loss is negative.
    """
    from scipy.signal import savgol_filter

    mass = np.asarray(mass, dtype=float)
    if mass.size < 5:
        raise ValueError("The trace is too short to differentiate.")

    if mode == DTG_PER_TIME:
        if time_min is None:
            raise ValueError("dm/dt needs the time column, which this file "
                             "does not have.")
        axis = np.asarray(time_min, dtype=float)
        unit = '/min'
    else:
        if temperature is None:
            raise ValueError("dm/dT needs the temperature column.")
        axis = np.asarray(temperature, dtype=float)
        unit = '/°C'

    if axis.size != mass.size:
        raise ValueError("The axis and the mass trace have different lengths.")

    width = int(max(5, min(int(smooth_width or 51), mass.size)))
    if width % 2 == 0:
        width -= 1
    order = min(3, width - 1)

    if smooth_method == 'Savitzky-Golay' or smooth_method is None:
        d_mass = savgol_filter(mass, width, order, deriv=1)
        d_axis = savgol_filter(axis, width, order, deriv=1)
    else:
        # Honour the chosen smoother, then difference - still per index, so
        # the chain rule below is unchanged.
        smoothed = smooth_trace(mass, method=smooth_method, width=width)
        d_mass = np.gradient(smoothed)
        d_axis = np.gradient(smooth_trace(axis, method=smooth_method, width=width))

    # A dwell has dT/di = 0, where dm/dT is genuinely undefined; those points
    # are masked rather than allowed to blow up.
    scale = np.nanmax(np.abs(d_axis)) or 1.0
    with np.errstate(divide='ignore', invalid='ignore'):
        derivative = np.where(np.abs(d_axis) > 1e-6 * scale, d_mass / d_axis,
                              np.nan)
    derivative[~np.isfinite(derivative)] = np.nan
    return derivative, unit


def find_dtg_peaks(temperature, dtg, prominence_fraction=0.05,
                   min_separation=5.0, min_height_fraction=0.05):
    """Locate mass-loss (and gain) events in a DTG curve.

    A DTG peak is a mass *rate* extremum, which is what actually defines the
    temperature of a decomposition step - far better than eyeballing the
    inflection of the mass trace.  ``prominence_fraction`` is relative to the
    largest excursion, so the same value works for any sample.
    """
    from scipy.signal import find_peaks

    temperature = np.asarray(temperature, dtype=float)
    dtg = np.asarray(dtg, dtype=float)
    finite = np.isfinite(dtg)
    if finite.sum() < 5:
        return []

    values = dtg[finite]
    # A plain max is set by the worst noise spike, so a fraction of it lets
    # every other noise spike through. The 99.5th percentile is driven by the
    # real peak instead.
    scale = float(np.percentile(np.abs(values), 99.5))
    if scale <= 0:
        return []

    # Noise floor: the residual against a heavily smoothed copy of the DTG.
    # Consecutive points of a Savitzky-Golay derivative are strongly
    # correlated, so a point-to-point difference reads the noise as far
    # smaller than the wiggle actually is and lets every ripple through as a
    # peak. Comparing against a broad smooth measures the wiggle itself.
    # The MAD is used because it ignores the real peaks, which are a small
    # fraction of the trace; 1.4826 makes it a sigma for Gaussian noise.
    reference_width = max(11, min(values.size // 8 * 2 + 1, 201))
    if values.size > reference_width:
        residual = values - smooth_trace(values, 'Savitzky-Golay', reference_width)
        noise = 1.4826 * float(np.median(np.abs(residual - np.median(residual))))
    else:
        noise = 0.0

    # A peak has to clear both the relative bar and the noise, so neither a
    # very clean nor a very noisy trace floods the list.
    threshold = max(prominence_fraction * scale, 5.0 * noise)

    # Convert the temperature separation into a number of points
    spacing = float(np.nanmedian(np.abs(np.diff(temperature)))) or 1.0
    distance = max(1, int(round(min_separation / spacing)))

    peaks = []
    # Losses appear as negative excursions, gains as positive ones; both are
    # events, so search the signal and its negative.
    for sign in (-1.0, 1.0):
        signal = np.where(finite, sign * dtg, 0.0)
        found, _ = find_peaks(signal, prominence=threshold, distance=distance)
        for index in found:
            # The rate returning to zero between two steps is a genuine local
            # maximum but not an event, so a peak also has to stand at a real
            # rate, not merely stand out from its neighbours.
            if abs(dtg[index]) < min_height_fraction * scale:
                continue
            peaks.append({
                'index': int(index),
                'peak_temperature': float(temperature[index]),
                'peak_height': float(dtg[index]),
                'direction': 'loss' if sign < 0 else 'gain',
            })

    peaks.sort(key=lambda p: p['peak_temperature'])
    return peaks


def dtg_peak_bounds(temperature, dtg, peak_index, threshold_fraction=0.10):
    """Start and end temperature of a DTG peak.

    The bounds are where the rate falls back to a small fraction of the peak
    rate, which is the usual way of saying "the step is over".
    """
    temperature = np.asarray(temperature, dtype=float)
    dtg = np.asarray(dtg, dtype=float)
    peak_value = dtg[peak_index]
    if peak_value == 0:
        return float(temperature[peak_index]), float(temperature[peak_index])

    signal = dtg / peak_value          # 1.0 at the peak, whatever its sign
    threshold = threshold_fraction

    start = 0
    for i in range(peak_index, -1, -1):
        if not np.isfinite(signal[i]) or signal[i] < threshold:
            start = i
            break
    end = signal.size - 1
    for i in range(peak_index, signal.size):
        if not np.isfinite(signal[i]) or signal[i] < threshold:
            end = i
            break
    return float(temperature[start]), float(temperature[end]), int(start), int(end)


# ---------------------------------------------------------------------------
# Isothermal kinetics
#
# On a dwell the temperature is constant, so the mass relaxes towards a new
# equilibrium and the shape of that relaxation says how the process is limited.
# All models are fitted to m(t) directly rather than to a linearised form:
# linearising (the classic Avrami double-log plot) weights the early points
# enormously and is why literature rate constants disagree so often.
# ---------------------------------------------------------------------------

KINETIC_SINGLE = 'Single exponential'
KINETIC_DOUBLE = 'Double exponential'
KINETIC_AVRAMI = 'Avrami (JMAK)'
KINETIC_DIFFUSION = 'Diffusion (Jander)'
KINETIC_PARABOLIC = 'Parabolic (sqrt-t)'

KINETIC_MODELS = (KINETIC_SINGLE, KINETIC_DOUBLE, KINETIC_AVRAMI,
                  KINETIC_DIFFUSION, KINETIC_PARABOLIC)

KINETIC_EQUATIONS = {
    KINETIC_SINGLE: "m(t) = m_inf + A exp(-t/tau)",
    KINETIC_DOUBLE: "m(t) = m_inf + A1 exp(-t/tau1) + A2 exp(-t/tau2)",
    KINETIC_AVRAMI: "m(t) = m_inf + A exp(-(k t)^n)",
    KINETIC_DIFFUSION: "alpha(t) from Jander: [1-(1-alpha)^(1/3)]^2 = k t",
    KINETIC_PARABOLIC: "m(t) = m_0 + A sqrt(k t)",
}


def _kinetic_model(name):
    """Return ``(function, initial-guess builder, parameter names)``."""
    if name == KINETIC_SINGLE:
        def f(t, m_inf, amplitude, tau):
            return m_inf + amplitude * np.exp(-t / np.maximum(tau, 1e-12))

        def p0(t, y):
            return [y[-1], y[0] - y[-1], max((t[-1] - t[0]) / 3.0, 1e-3)]
        return f, p0, ('m_inf', 'A', 'tau')

    if name == KINETIC_DOUBLE:
        def f(t, m_inf, a1, tau1, a2, tau2):
            return (m_inf + a1 * np.exp(-t / np.maximum(tau1, 1e-12))
                    + a2 * np.exp(-t / np.maximum(tau2, 1e-12)))

        def p0(t, y):
            span = t[-1] - t[0]
            return [y[-1], 0.5 * (y[0] - y[-1]), max(span / 10.0, 1e-3),
                    0.5 * (y[0] - y[-1]), max(span / 2.0, 1e-3)]
        return f, p0, ('m_inf', 'A1', 'tau1', 'A2', 'tau2')

    if name == KINETIC_AVRAMI:
        def f(t, m_inf, amplitude, k, n):
            kt = np.maximum(k, 1e-12) * np.maximum(t, 0.0)
            return m_inf + amplitude * np.exp(-np.power(kt, np.maximum(n, 1e-3)))

        def p0(t, y):
            return [y[-1], y[0] - y[-1], 3.0 / max(t[-1] - t[0], 1e-3), 1.0]
        return f, p0, ('m_inf', 'A', 'k', 'n')

    if name == KINETIC_DIFFUSION:
        # Jander: the reacted fraction follows [1-(1-a)^(1/3)]^2 = k t.
        # Written for m(t) so it is fitted on the same footing as the others.
        def f(t, m_0, amplitude, k):
            kt = np.clip(np.maximum(k, 1e-15) * np.maximum(t, 0.0), 0.0, 1.0)
            alpha = 1.0 - np.power(np.clip(1.0 - np.sqrt(kt), 0.0, 1.0), 3.0)
            return m_0 + amplitude * alpha

        def p0(t, y):
            return [y[0], y[-1] - y[0], 1.0 / max(t[-1] - t[0], 1e-3)]
        return f, p0, ('m_0', 'A', 'k')

    if name == KINETIC_PARABOLIC:
        def f(t, m_0, amplitude, k):
            return m_0 + amplitude * np.sqrt(np.maximum(k, 0.0) *
                                             np.maximum(t, 0.0))

        def p0(t, y):
            return [y[0], y[-1] - y[0], 1.0 / max(t[-1] - t[0], 1e-3)]
        return f, p0, ('m_0', 'A', 'k')

    raise ValueError(f"Unknown kinetic model: {name}")


def fit_isothermal(time_min, mass, indices, model=KINETIC_SINGLE):
    """Fit a relaxation model to an isothermal mass trace.

    Time is measured from the start of the selection, not from the start of
    the run - the process being fitted starts when the dwell does.
    """
    from scipy.optimize import curve_fit

    indices = np.asarray(indices, dtype=int)
    if indices.size < 6:
        raise ValueError("Select a longer isothermal segment - at least six "
                         "points are needed to fit a relaxation.")

    t = np.asarray(time_min, dtype=float)[indices]
    y = np.asarray(mass, dtype=float)[indices]
    t = t - t[0]

    function, guess, names = _kinetic_model(model)
    try:
        popt, pcov = curve_fit(function, t, y, p0=guess(t, y), maxfev=20000)
    except Exception as e:
        raise ValueError(f"The {model} fit did not converge ({e}).")

    fitted = function(t, *popt)
    residuals = y - fitted
    ss_res = float(np.sum(residuals ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r_squared = 1.0 - ss_res / ss_tot if ss_tot else float('nan')

    errors = (np.sqrt(np.diag(pcov)) if pcov is not None
              and np.all(np.isfinite(pcov)) else [None] * len(popt))

    parameters = {}
    for name, value, error in zip(names, popt, errors):
        parameters[name] = {'value': float(value),
                            'error': float(error) if error is not None else None}

    # Characteristic time: tau directly, or 1/k for the rate-constant models
    if 'tau' in parameters:
        characteristic = parameters['tau']['value']
    elif 'tau1' in parameters:
        characteristic = min(parameters['tau1']['value'],
                             parameters['tau2']['value'])
    elif 'k' in parameters and parameters['k']['value']:
        characteristic = 1.0 / parameters['k']['value']
    else:
        characteristic = None

    return {
        'model': model,
        'equation': KINETIC_EQUATIONS[model],
        'parameters': parameters,
        'characteristic_time_min': characteristic,
        'r_squared': r_squared,
        'rmse': float(np.sqrt(ss_res / t.size)),
        't_relative': t,
        'fitted': fitted,
        'residuals': residuals,
        'amplitude': (parameters.get('A', {}).get('value')
                      if 'A' in parameters else
                      (parameters.get('A1', {}).get('value', 0.0) +
                       parameters.get('A2', {}).get('value', 0.0))),
        'n_points': int(indices.size),
    }


def format_isothermal(result):
    """Human-readable summary of :func:`fit_isothermal`."""
    lines = [f"{result['model']}", f"  {result['equation']}"]
    for name, entry in result['parameters'].items():
        if entry['error'] is not None:
            lines.append(f"  {name:8s}= {entry['value']:.6g} "
                         f"± {entry['error']:.3g}")
        else:
            lines.append(f"  {name:8s}= {entry['value']:.6g}")
    if result['characteristic_time_min'] is not None:
        lines.append(f"  Characteristic time = "
                     f"{result['characteristic_time_min']:.4g} min")
    lines.append(f"  R² = {result['r_squared']:.6f},  "
                 f"RMSE = {result['rmse']:.4g}  "
                 f"({result['n_points']} points)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stepped-isothermal Arrhenius
# ---------------------------------------------------------------------------

R_GAS = 8.314462618   # J / (mol K)


def find_isothermal_dwells(temperature, segment=None, min_points=6,
                           max_temp_span=3.0):
    """Index ranges of the isothermal holds of a stepped programme.

    A dwell is a stretch whose temperature stays within ``max_temp_span``
    degrees. The instrument's own segment numbering is used when the file has
    one; otherwise the temperature trace is walked and every flat run emitted.
    Returns ``[(i_start, i_end, mean_temperature_C), ...]``.
    """
    temperature = np.asarray(temperature, dtype=float)
    n = temperature.size

    if segment is not None and len(segment) == n:
        seg = np.asarray(segment, dtype=float)
        spans, start = [], 0
        for i in range(1, n):
            if seg[i] != seg[i - 1]:
                spans.append((start, i - 1))
                start = i
        spans.append((start, n - 1))
    else:
        spans, start = [], 0
        for i in range(1, n):
            if abs(temperature[i] - temperature[start]) > max_temp_span:
                spans.append((start, i - 1))
                start = i
        spans.append((start, n - 1))

    dwells = []
    for a, b in spans:
        if b - a + 1 < min_points:
            continue
        seg_t = temperature[a:b + 1]
        if float(seg_t.max() - seg_t.min()) <= max_temp_span:
            dwells.append((a, b, float(np.mean(seg_t))))
    return dwells


def arrhenius_from_dwells(time_min, temperature, mass, segment=None,
                          model=KINETIC_SINGLE, min_points=6,
                          max_temp_span=3.0):
    """Fit each isothermal dwell of a stepped run, then Arrhenius-fit the rates.

    Each dwell gives a rate constant ``k = 1/τ`` (τ from :func:`fit_isothermal`).
    A straight line through ``ln k`` vs ``1/T`` gives the activation energy from
    ``ln k = ln A − Ea/(R·T)``. Needs at least three usable dwells at different
    temperatures, or it raises ValueError.
    """
    dwells = find_isothermal_dwells(temperature, segment, min_points,
                                    max_temp_span)
    rows = []
    for a, b, t_c in dwells:
        indices = np.arange(a, b + 1)
        try:
            fit = fit_isothermal(time_min, mass, indices, model=model)
        except ValueError:
            continue
        tau = fit.get('characteristic_time_min')
        if not tau or tau <= 0 or not np.isfinite(tau):
            continue
        rows.append({'t_c': t_c, 't_k': t_c + 273.15, 'k': 1.0 / tau,
                     'r_squared': fit['r_squared'], 'n_points': int(indices.size)})

    # Distinct temperatures only: two dwells at the same T give one Arrhenius
    # point, not two, and would fake a tighter line.
    unique_t = {round(r['t_k'], 1) for r in rows}
    if len(rows) < 3 or len(unique_t) < 3:
        raise ValueError(
            f"Found {len(rows)} isothermal dwell(s) with a usable rate constant "
            f"at {len(unique_t)} distinct temperature(s). An Arrhenius fit needs "
            f"at least three dwells at different temperatures — i.e. a "
            f"stepped-isothermal programme (hold, step up, hold, ...).")

    t_k = np.array([r['t_k'] for r in rows], dtype=float)
    ln_k = np.array([np.log(r['k']) for r in rows], dtype=float)
    inv_t = 1.0 / t_k
    slope, intercept = np.polyfit(inv_t, ln_k, 1)
    predicted = slope * inv_t + intercept
    ss_res = float(np.sum((ln_k - predicted) ** 2))
    ss_tot = float(np.sum((ln_k - np.mean(ln_k)) ** 2))

    return {
        'model': model,
        'dwells': rows,
        'temperature_k': t_k.tolist(),
        'ln_k': ln_k.tolist(),
        'slope': float(slope),
        'intercept': float(intercept),
        'activation_energy_kj': float(-slope * R_GAS / 1000.0),
        'pre_exponential': float(np.exp(intercept)),
        'r_squared': (1.0 - ss_res / ss_tot) if ss_tot else float('nan'),
    }


# ---------------------------------------------------------------------------
# Cycle analysis
# ---------------------------------------------------------------------------

def split_cycles(temperature, segment=None, min_span=20.0):
    """Split a run into cycles.

    The instrument's own segment numbering is used when the file has one - it
    is the programme as actually executed.  Otherwise cycles are found from
    the turning points of the temperature trace, a cycle being one heating leg
    plus the cooling leg that follows it.
    """
    temperature = np.asarray(temperature, dtype=float)

    if segment is not None and len(segment) == temperature.size:
        segments = np.asarray(segment, dtype=float)
        cycles = []
        start = 0
        for i in range(1, segments.size):
            if segments[i] != segments[i - 1]:
                cycles.append((start, i - 1))
                start = i
        cycles.append((start, segments.size - 1))
        return [(a, b) for a, b in cycles if b > a]

    # Turning points: where the sign of the temperature change flips
    direction = np.sign(np.diff(temperature))
    direction = direction[direction != 0]
    if direction.size == 0:
        return [(0, temperature.size - 1)]

    turns = [0]
    current = direction[0]
    for i in range(1, temperature.size):
        step = temperature[i] - temperature[i - 1]
        if step == 0:
            continue
        if np.sign(step) != current:
            # Only accept a turn that ends a leg of real extent
            if abs(temperature[i - 1] - temperature[turns[-1]]) >= min_span:
                turns.append(i - 1)
                current = np.sign(step)
    turns.append(temperature.size - 1)

    return [(turns[i], turns[i + 1]) for i in range(len(turns) - 1)
            if turns[i + 1] > turns[i]]


def cycle_analysis(temperature, mass, cycles, tolerance_fraction=0.05):
    """Reversible / irreversible mass change over repeated cycles.

    For each cycle the mass at the start and end is compared: what comes back
    is reversible, what does not is drift.  ``tolerance_fraction`` is the
    fraction of the largest cycle amplitude within which the mass is called
    stabilised.
    """
    temperature = np.asarray(temperature, dtype=float)
    mass = np.asarray(mass, dtype=float)

    rows = []
    for number, (start, end) in enumerate(cycles, start=1):
        span = mass[start:end + 1]
        if span.size < 2:
            continue
        m_start, m_end = float(span[0]), float(span[-1])
        amplitude = float(np.max(span) - np.min(span))
        irreversible = m_end - m_start
        # What the sample gave up and took back within the cycle
        reversible = amplitude - abs(irreversible)
        rows.append({
            'cycle': number,
            't_start': float(temperature[start]),
            't_end': float(temperature[end]),
            't_min': float(np.min(temperature[start:end + 1])),
            't_max': float(np.max(temperature[start:end + 1])),
            'mass_start': m_start,
            'mass_end': m_end,
            'amplitude': amplitude,
            'reversible': reversible,
            'irreversible': irreversible,
            'recovery_pct': (100.0 * reversible / amplitude) if amplitude else None,
            'n_points': int(span.size),
        })

    if not rows:
        raise ValueError("No cycles could be identified in this run.")

    # Drift from one cycle to the next, and the cycle at which it settles
    largest = max(abs(r['amplitude']) for r in rows) or 1.0
    stabilised = None
    for i, row in enumerate(rows):
        row['drift'] = (row['mass_end'] - rows[i - 1]['mass_end']) if i else 0.0
        if stabilised is None and i > 0 and \
                abs(row['drift']) <= tolerance_fraction * largest:
            stabilised = row['cycle']

    # Hysteresis: the largest gap between the heating and cooling legs, taken
    # over the temperatures both legs actually visited.
    for row, (start, end) in zip(rows, cycles):
        row['hysteresis'] = _leg_hysteresis(temperature[start:end + 1],
                                            mass[start:end + 1])

    return {
        'cycles': rows,
        'n_cycles': len(rows),
        'total_irreversible': sum(r['irreversible'] for r in rows),
        'mean_reversible': float(np.mean([r['reversible'] for r in rows])),
        'stabilised_at': stabilised,
    }


def _leg_hysteresis(temperature, mass):
    """Largest mass difference between the up and down legs of one cycle."""
    if temperature.size < 4:
        return None
    turn = int(np.argmax(temperature)) if temperature[-1] < temperature[0] \
        else int(np.argmin(temperature))
    up, down = temperature[:turn + 1], temperature[turn:]
    if up.size < 2 or down.size < 2:
        return None

    lo = max(min(up.min(), up.max()), min(down.min(), down.max()))
    hi = min(max(up.min(), up.max()), max(down.min(), down.max()))
    if hi <= lo:
        return None

    grid = np.linspace(lo, hi, 50)
    def _on(t_leg, m_leg):
        order = np.argsort(t_leg)
        return np.interp(grid, t_leg[order], m_leg[order])

    return float(np.max(np.abs(_on(up, mass[:turn + 1]) -
                               _on(down, mass[turn:]))))


# ---------------------------------------------------------------------------
# Combined event detection
# ---------------------------------------------------------------------------

def _detrend(x, y, edge_fraction=0.05):
    """Remove the straight instrument drift from a signal.

    The line joins robust estimates of the two ends (medians of the outer few
    percent) rather than the first and last points, so a single noisy sample
    at an end cannot tilt the whole trace.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    edge = max(3, int(round(y.size * edge_fraction)))
    x_lo = float(np.median(x[:edge]))
    x_hi = float(np.median(x[-edge:]))
    y_lo = float(np.median(y[:edge]))
    y_hi = float(np.median(y[-edge:]))
    if x_hi == x_lo:
        return y - y_lo
    slope = (y_hi - y_lo) / (x_hi - x_lo)
    return y - (y_lo + slope * (x - x_lo))


def detect_events(temperature, mass, dtg=None, dsc=None, time_min=None,
                  prominence_fraction=0.05, dsc_prominence_fraction=0.05,
                  match_tolerance=25.0):
    """Suggest thermal events from the mass, DTG and DSC signals together.

    DTG peaks give the mass events and DSC peaks the thermal ones; a DSC peak
    within ``match_tolerance`` of a DTG peak is attached to it, since the two
    are then almost certainly the same physical process.

    Everything returned is a *suggestion* to be reviewed - the boundaries in
    particular are only as good as the smoothing, and a shoulder can be read
    as one event or two.
    """
    temperature = np.asarray(temperature, dtype=float)
    mass = np.asarray(mass, dtype=float)

    events = []

    if dtg is not None:
        dtg = np.asarray(dtg, dtype=float)
        for peak in find_dtg_peaks(temperature, dtg, prominence_fraction):
            t_start, t_end, i_start, i_end = dtg_peak_bounds(
                temperature, dtg, peak['index'])
            events.append({
                'kind': 'mass',
                't_start': t_start,
                't_end': t_end,
                'dtg_peak_temperature': peak['peak_temperature'],
                'dtg_peak_height': peak['peak_height'],
                'direction': peak['direction'],
                'mass_change': float(mass[i_end] - mass[i_start]),
                'onset_temperature': None,
                'dsc_peak_temperature': None,
                'enthalpy_j_per_g': None,
                'name': '',
            })

    dsc_peaks = []
    dsc_detrended = None
    if dsc is not None:
        dsc = np.asarray(dsc, dtype=float)
        # A DSC trace sits on a sloping instrument baseline, and searching it
        # raw finds the two ends of that slope as 'peaks'. Detrending first is
        # what makes the search see events instead of the ramp.
        dsc_detrended = _detrend(temperature, dsc)
        dsc_peaks = find_dtg_peaks(temperature, dsc_detrended,
                                   dsc_prominence_fraction)

    for peak in dsc_peaks:
        nearest = None
        for event in events:
            if event['kind'] != 'mass':
                continue
            distance = abs(event['dtg_peak_temperature'] - peak['peak_temperature'])
            if distance <= match_tolerance and (
                    nearest is None or distance < nearest[0]):
                nearest = (distance, event)
        if nearest is not None:
            nearest[1]['dsc_peak_temperature'] = peak['peak_temperature']
        else:
            # A thermal event with no mass change - a melt or a polymorphic
            # transition, which is exactly the interesting case.
            t_start, t_end, _i0, _i1 = dtg_peak_bounds(temperature,
                                                       dsc_detrended,
                                                       peak['index'])
            events.append({
                'kind': 'thermal',
                't_start': t_start,
                't_end': t_end,
                'dtg_peak_temperature': None,
                'dtg_peak_height': None,
                'direction': 'none',
                'mass_change': 0.0,
                'onset_temperature': None,
                'dsc_peak_temperature': peak['peak_temperature'],
                'enthalpy_j_per_g': None,
                'name': '',
            })

    events.sort(key=lambda e: e['t_start'])
    return events


def interpret_event(event, mass_unit='%'):
    """Possible chemical readings of an event - explicitly not conclusions.

    The temperature ranges are the conventional ones for oxide and hydrate
    thermal analysis.  They overlap, they are atmosphere-dependent, and
    nothing here is evidence on its own; the phrasing must stay tentative
    because only an evolved-gas measurement can actually identify a species.
    """
    if event.get('kind') == 'thermal':
        return ["Thermal event with no mass change - possibly a melt, a "
                "polymorphic transition, a glass transition or a magnetic "
                "ordering transition."]

    t_peak = event.get('dtg_peak_temperature') or event.get('t_start') or 0.0
    change = event.get('mass_change', 0.0)
    suggestions = []

    if change < 0:
        if t_peak < 150:
            suggestions.append("Loss of physisorbed / surface water.")
        if 100 <= t_peak < 350:
            suggestions.append("Loss of structural or interlayer water, or of "
                               "hydroxide (dehydroxylation).")
        if 250 <= t_peak < 600:
            suggestions.append("Decomposition of nitrate, acetate or another "
                               "organic precursor residue.")
        if 400 <= t_peak < 900:
            suggestions.append("Carbonate decomposition releasing CO2.")
        if t_peak >= 250:
            suggestions.append("Lattice oxygen release (reduction), if the "
                               "sample is a non-stoichiometric oxide.")
    elif change > 0:
        if t_peak < 200:
            suggestions.append("Uptake of moisture, or hydration.")
        if t_peak >= 200:
            suggestions.append("Oxidation, or re-uptake of lattice oxygen.")
        suggestions.append("Carbonation, if CO2 is present in the atmosphere.")

    if not suggestions:
        suggestions.append("No conventional assignment for this temperature "
                           "and direction.")

    return suggestions


def format_mass_step(result):
    """Human-readable summary of :func:`mass_step`."""
    lines = [
        f"Mass {result['direction']} between {result['t_start']:.1f} and "
        f"{result['t_end']:.1f} °C",
        f"  Start:  {result['mass_start']:.4f} {result['unit']}",
        f"  End:    {result['mass_end']:.4f} {result['unit']}",
    ]
    if result['delta_mg'] is not None:
        lines.append(f"  Change: {result['delta_mg']:+.4f} mg")
    if result['delta_pct'] is not None:
        lines.append(f"  Change: {result['delta_pct']:+.3f} %")
    lines.append(f"  ({result['n_points']} points, edges averaged over "
                 f"{result['n_average']})")
    return "\n".join(lines)


def format_dsc_area(result, include_transparency=True):
    """Human-readable summary of :func:`dsc_area`."""
    lines = [
        f"{result['nature'].capitalize()} peak between {result['t_start']:.1f} "
        f"and {result['t_end']:.1f} °C",
    ]
    if result.get('onset_temperature') is not None:
        lines.append(f"  Onset (extrapolated) = {result['onset_temperature']:8.2f} °C")
    lines.append(f"  Peak                 = {result['peak_temperature']:8.2f} °C")
    if result.get('endset_temperature') is not None:
        lines.append(f"  Endset (extrapolated)= {result['endset_temperature']:8.2f} °C")
    if result.get('fwhm') is not None:
        lines.append(f"  FWHM                 = {result['fwhm']:8.2f} °C")
    lines.append(f"  Peak height          = {result['peak_height']:8.4g} "
                 f"{result.get('peak_height_unit', '')}")
    lines.append(f"  Area                 = {result['area_temperature']:8.4g} "
                 f"{result['area_temperature_unit']}")
    if result['area_time'] is not None:
        lines.append(f"  Area                 = {result['area_time']:8.4g} "
                     f"{result['area_time_unit']}")
    if result['enthalpy_j_per_g'] is not None:
        lines.append(f"  Enthalpy ΔH          = {result['enthalpy_j_per_g']:+8.4g} J/g")

    if include_transparency and result.get('transparency'):
        lines.append("  How the enthalpy was obtained:")
        for label, value in result['transparency']:
            lines.append(f"    {label:26s}{value}")

    for warning in result.get('warnings', []):
        lines.append(f"  ! {warning}")
    return "\n".join(lines)
