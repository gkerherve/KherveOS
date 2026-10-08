# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/PlotConfig.py. Regenerate with tools/export_khervetech.py.
import numpy as np
from libraries.Plot_Operations import sheet_x_is_forward, is_image_sheet


def x_axis_step(limits, fraction=0.02, minimum=0.2):
    """A zoom / pan / edge-nudge step scaled to what is on screen.

    A flat 0.2 was written for binding energy, where the window is a few eV
    wide. It is a rounding error on a diffractogram over seventy degrees, on
    an EELS spectrum over a thousand eV or on a TGA run to 1000 °C - which is
    why the toolbar's BE arrows looked dead on every technique but XPS. The
    step is a fraction of the current span instead, never smaller than the old
    constant so XPS behaves as it always did.

    Shared with ``On_Key_Defs`` so Ctrl+/- and the toolbar arrows move by the
    same amount.
    """
    try:
        span = abs(float(limits['Xmax']) - float(limits['Xmin']))
    except (KeyError, TypeError, ValueError):
        return minimum
    return max(span * fraction, minimum)


def intensity_step(window, limits, fraction):
    """A y-axis step for the intensity controls.

    Scaled to the tallest point of the trace, as it always was - but a SQUID
    moment, a DSC trace or a Nyquist reactance is routinely all-negative, and
    ``fraction * max(y)`` is then negative, so every press moved the axis the
    wrong way. Anything that is not a positive peak height falls back to the
    span of the current limits, which is positive by construction.
    """
    peak = 0.0
    try:
        values = np.asarray(window.y_values, dtype=float)
        if values.size:
            peak = float(np.nanmax(values))
    except (AttributeError, TypeError, ValueError):
        peak = 0.0
    if not np.isfinite(peak) or peak <= 0:
        try:
            peak = abs(float(limits['Ymax']) - float(limits['Ymin']))
        except (KeyError, TypeError, ValueError):
            peak = 0.0
    if not np.isfinite(peak) or peak <= 0:
        peak = 1.0
    return fraction * peak


def update_plot_limits(self, window, sheet_name, x_min=None, x_max=None, y_min=None, y_max=None):
    # Check if sheet exists in Core levels data
    if sheet_name not in window.Data.get('Core levels', {}):
        print(f"Warning: Sheet '{sheet_name}' not found in Core levels data")
        return
    if is_image_sheet(window, sheet_name):
        return

    if sheet_name not in self.plot_limits:
        self.plot_limits[sheet_name] = {}
        self.original_limits[sheet_name] = {}

    limits = self.plot_limits[sheet_name]
    original = self.original_limits[sheet_name]

    # Store original limits if not already stored
    if not original:
        # Check if B.E. and Raw Data exist
        core_level_data = window.Data['Core levels'][sheet_name]
        if 'B.E.' not in core_level_data or 'Raw Data' not in core_level_data:
            print(f"Warning: Sheet '{sheet_name}' missing B.E. or Raw Data")
            return

        x_values = core_level_data['B.E.']
        y_values = core_level_data['Raw Data']

        # Ensure we have valid data
        if not x_values or not y_values:
            print(f"Warning: Sheet '{sheet_name}' has empty B.E. or Raw Data")
            return

        original['Xmin'] = min(x_values)
        original['Xmax'] = max(x_values)

        if sheet_name.upper().startswith('FTIR'):
            # FTIR: leave room on the band side for the vertical band
            # labels (below the dips in %T, above the peaks in absorbance).
            y_lo, y_hi = min(y_values), max(y_values)
            span = (y_hi - y_lo) or (abs(y_hi) or 1.0)
            y_unit = core_level_data.get('FTIR_Y_Unit', 'Transmittance (%)')
            if 'Absorbance' in y_unit:
                original['Ymin'] = y_lo - 0.05 * span
                original['Ymax'] = y_hi + 0.70 * span
            else:
                original['Ymin'] = y_lo - 0.70 * span
                original['Ymax'] = y_hi + 0.05 * span
        elif sheet_name.upper().startswith('TGA'):
            # A mass trace sits on a high, nearly flat baseline (100 % or
            # the sample mass): the XPS rule below would push Ymin to
            # roughly zero and squash the whole step into the top line.
            y_lo, y_hi = min(y_values), max(y_values)
            span = (y_hi - y_lo) or (abs(y_hi) or 1.0)
            original['Ymin'] = y_lo - 0.10 * span
            original['Ymax'] = y_hi + 0.10 * span
        elif sheet_name.upper().startswith('SQUID'):
            # Magnetic moments are routinely negative (diamagnetic samples,
            # M(H) loops), so pad symmetrically. The XPS rule below scales
            # Ymax by 1.2, which would put Ymax *below* Ymin on all-negative
            # data and collapse the axis.
            y_lo, y_hi = min(y_values), max(y_values)
            span = (y_hi - y_lo) or (abs(y_hi) or 1.0)
            original['Ymin'] = y_lo - 0.05 * span
            original['Ymax'] = y_hi + 0.10 * span
        elif sheet_name.startswith(('TEM~Plot', 'AFM~')):
            # A TEM line profile sits on a large, nearly flat intensity
            # offset (the mean image brightness, ~1e6) with only a small
            # fringe modulation on top. The XPS rule below scales Ymax by
            # 1.2, which on a 2.95e6 trace adds ~0.6e6 of headroom - ten
            # times the actual data range - and squashes the fringes into a
            # flat line at the bottom. Pad by the data span instead.
            # An AFM height profile has the same shape: a large offset
            # (absolute height) with small real modulation on top.
            y_lo, y_hi = min(y_values), max(y_values)
            span = (y_hi - y_lo) or (abs(y_hi) or 1.0)
            # Extra room on top for the peak ticks and the spacing labels
            # that sit above the tallest fringe.
            original['Ymin'] = y_lo - 0.08 * span
            original['Ymax'] = y_hi + 0.24 * span
        elif sheet_name.upper().startswith('EIS'):
            # -Z'' goes negative wherever the leads are inductive, log|Z|
            # is often negative and ln(sigma T) can be either, so pad
            # symmetrically rather than scaling Ymax by 1.2 as below, which
            # would put Ymax under Ymin on all-negative data.
            y_lo, y_hi = min(y_values), max(y_values)
            span = (y_hi - y_lo) or (abs(y_hi) or 1.0)
            # On a Nyquist plot y = 0 is the real axis, so it has to stay in
            # view whatever the data do - it is what the intercepts are read
            # against. On the Bode and Arrhenius views zero means nothing,
            # and forcing it in squashes the curve into a corner.
            if core_level_data.get('EIS_View', 'nyquist') == 'nyquist':
                original['Ymin'] = min(y_lo, 0.0) - 0.10 * span
            else:
                original['Ymin'] = y_lo - 0.10 * span
            original['Ymax'] = y_hi + 0.10 * span
        else:
            original['Ymin'] = min(y_values) - 0.015 * max(y_values)
            original['Ymax'] = max(y_values) * 1.2  # Add 20% padding to the top

    # Update current limits
    if x_min is not None: limits['Xmin'] = x_min
    if x_max is not None: limits['Xmax'] = x_max
    if y_min is not None: limits['Ymin'] = y_min
    if y_max is not None: limits['Ymax'] = y_max

    # If any limit is not set, use the original values
    if window.energy_scale == 'KE':
        limits['Xmin'] = limits.get('Xmin', original['Xmin'])
        limits['Xmax'] = limits.get('Xmax', original['Xmax'])
    else:
        limits['Xmin'] = limits.get('Xmin', original['Xmin'])
        limits['Xmax'] = limits.get('Xmax', original['Xmax'])
    limits['Ymin'] = limits.get('Ymin', original['Ymin'])
    limits['Ymax'] = limits.get('Ymax', original['Ymax'])


def reset_plot_limits(self, window, sheet_name):
    if sheet_name in self.original_limits:
        self.plot_limits[sheet_name] = self.original_limits[sheet_name].copy()
    else:
        self.update_plot_limits(window, sheet_name)

