# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TGA_Plot.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/TGA_Plot.py
"""
Main-frame plotting for TGA sheets.

A TGA run records several signals at once, so every TGA plot carries one or
more axes pinned to the right.  What goes where depends on the sheet
(``TGA_View``):

  * ``time`` - the as-imported run: the temperature programme on the main
    axis, the mass and the DSC heat flow on two right-hand axes, all against
    time.  This is the plot the range lines select on, and it shows every
    signal at once because that is what tells the operator which ramp is worth
    extracting.
  * ``temperature`` - derived from a selected slice of the above: mass against
    temperature, with the DSC on the right.  The standard TGA/DSC figure, and
    what the mass-step and peak-area tools work on.

The right-hand axes are ``twinx`` of the main axes, created fresh on every
redraw and torn down as soon as a non-TGA sheet is shown, because the rest of
KherveFitting assumes the figure holds one data axes.

Measured DSC peak areas are stored on the sheet (``TGA_DSC_Peaks``) rather than
only drawn, so they survive a replot and go into the saved project.  Mass steps
go one better and live in the sheet's ``Labels`` list, so the Label Manager can
move, restyle or delete them.
"""

import numpy as np
import matplotlib.pyplot as plt

from libraries.FileMenu.TGA_Import import VIEW_TIME
from libraries.PlotLabelEdit import legend_frame_kwargs

DSC_COLOUR = (0.80, 0.30, 0.20)
MASS_COLOUR = (0.20, 0.40, 0.75)
DTG_COLOUR = (0.45, 0.25, 0.60)
RAW_COLOUR = (0.55, 0.55, 0.55)
BASELINE_COLOUR = (0.35, 0.35, 0.35)


# Figure width left to the main axes, by how many right-hand axes it carries.
_AXES_WIDTH = {0: 0.85, 1: 0.80, 2: 0.68, 3: 0.58}


def _axes_width(n_right_axes):
    return _AXES_WIDTH.get(n_right_axes, 0.50)


def is_tga_sheet(sheet_name):
    return bool(sheet_name) and str(sheet_name).upper().startswith('TGA')


def remove_dsc_axis(window):
    """Drop every right-hand (mass / DSC) axes currently attached."""
    extra_axes = getattr(window, 'tga_axes', None) or []
    for ax in extra_axes:
        try:
            ax.figure.delaxes(ax)
        except (ValueError, KeyError, AttributeError):
            pass
    if extra_axes:
        # _draw_secondary_axes hides the main patch so the extra curves can sit
        # underneath; every other sheet expects an opaque white background.
        try:
            window.ax.patch.set_visible(True)
        except AttributeError:
            pass
    window.tga_axes = []
    window.ax_dsc = None
    window.ax_dtg = None


def draw_tga_extras(window, sheet_name):
    """Add the right-hand axes and the stored measurement annotations.

    Safe to call for any sheet: it removes leftover axes and returns
    immediately when the sheet is not a TGA one.
    """
    remove_dsc_axis(window)

    if not is_tga_sheet(sheet_name):
        return
    sheet = window.Data.get('Core levels', {}).get(sheet_name)
    if not isinstance(sheet, dict):
        return

    _draw_secondary_axes(window, sheet)
    draw_layers(window, sheet)
    _draw_annotations(window, sheet)
    draw_overlay(window, sheet_name)
    _refresh_legend(window)


def draw_overlay(window, sheet_name):
    """Overlay the other runs chosen on the Compare tab.

    The overlay is a view: every sheet keeps its own data, and nothing is
    resampled except for the difference curves, which have to share an
    abscissa to be subtracted at all.
    """
    overlay = window.Data.get('TGA_Overlay') or {}
    names = overlay.get('sheets') or []
    if len(names) < 2 and overlay.get('signal') != 'Difference from first':
        if not names or names == [sheet_name]:
            return

    core_levels = window.Data.get('Core levels', {})
    signal = overlay.get('signal', 'Mass')
    align = overlay.get('align', True)

    reference = core_levels.get(names[0], {}) if names else {}
    ref_x = np.asarray(reference.get('B.E.', []), dtype=float)
    ref_y = _overlay_trace(reference, signal if signal != 'Difference from first'
                           else 'Mass')

    colours = plt.cm.tab10(np.linspace(0, 1, 10))
    for position, name in enumerate(names):
        sheet = core_levels.get(name)
        if not isinstance(sheet, dict):
            continue
        x = np.asarray(sheet.get('B.E.', []), dtype=float)
        y = _overlay_trace(sheet, signal if signal != 'Difference from first'
                           else 'Mass')
        if y is None or x.size != y.size or x.size == 0:
            continue

        if signal == 'Difference from first':
            if position == 0 or ref_y is None or ref_x.size == 0:
                continue
            order = np.argsort(x)
            y = np.interp(ref_x, x[order], y[order]) - ref_y
            x = ref_x
        elif align and ref_x.size and position:
            order = np.argsort(x)
            y = np.interp(ref_x, x[order], y[order])
            x = ref_x

        # The sheet the main plot is already drawing is not drawn twice
        style = '-' if name != sheet_name else ':'
        window.ax.plot(x, y, color=colours[position % 10], linewidth=1.0,
                       linestyle=style, label=f"{name} ({signal})"
                       if signal != 'Mass' else name)


def _overlay_trace(sheet, signal):
    """The trace an overlay should show for one sheet."""
    if signal == 'DTG':
        return (np.asarray(sheet['TGA_DTG'], dtype=float)
                if sheet.get('TGA_DTG') else None)
    if signal == 'DSC':
        return (np.asarray(sheet['TGA_DSC'], dtype=float)
                if sheet.get('TGA_DSC') else None)
    return (np.asarray(sheet['Raw Data'], dtype=float)
            if sheet.get('Raw Data') else None)


def _right_axis_traces(sheet):
    """The traces that belong on right-hand axes, outermost last.

    Each entry is ``(values, label, colour, is_dsc)``.

    The time view shows all three signals of the run at once - temperature on
    the main axis, then mass and DSC on their own scales - because that is
    what the operator reads to decide which ramp is worth extracting.  The
    derived temperature view already has the mass on the main axis, so only
    the DSC is left for the right.
    """
    dsc = (sheet.get('TGA_DSC'), sheet.get('TGA_DSC_Unit', 'DSC (µV/mg)'),
           DSC_COLOUR, True)

    if sheet.get('TGA_View') != VIEW_TIME:
        return [dsc]

    # Percent is preferred for the mass: it makes the size of each step obvious
    # at a glance. The label has to follow whichever trace was available.
    if sheet.get('TGA_Mass_Pct'):
        mass = (sheet['TGA_Mass_Pct'], 'Mass (%)', MASS_COLOUR, False)
    else:
        mass = (sheet.get('TGA_Mass_mg'), 'Mass (mg)', MASS_COLOUR, False)
    return [mass, dsc]


def _draw_secondary_axes(window, sheet):
    """Plot the secondary signals on right-hand axes sharing the x-axis."""
    x_values = np.asarray(sheet.get('B.E.', []), dtype=float)
    traces = [(np.asarray(values, dtype=float), label, colour, is_dsc)
              for values, label, colour, is_dsc in _right_axis_traces(sheet)
              if values is not None and len(values) == x_values.size]
    if not traces or x_values.size == 0:
        return

    # The default axes fills the figure out to x = 0.95, leaving no room for a
    # right-hand label. Each extra axis needs its own strip, so the box has to
    # be narrowed for ALL of them up front - including the DTG layer, which is
    # added afterwards and would otherwise have its label fall off the figure.
    layers = sheet.get('TGA_Layers') or {}
    total_right = len(traces) + (1 if layers.get('dtg') else 0)
    window.ax.set_position([0.1, 0.1, _axes_width(total_right), 0.85])

    window.tga_axes = []
    for offset, (values, label, colour, is_dsc) in enumerate(traces):
        ax = window.ax.twinx()
        # twinx takes its box from the original subplot spec, not from the
        # manual set_position calls the plot code makes, so pin it explicitly.
        ax.set_position(window.ax.get_position())
        if offset:
            # Second and later axes step outwards so the spines do not overlap
            ax.spines['right'].set_position(('outward', 52 * offset))
        ax.plot(x_values, values, color=colour, linewidth=1.0, label=label)
        ax.set_ylabel(label, color=colour)
        ax.tick_params(axis='y', colors=colour)
        ax.spines['right'].set_color(colour)
        ax.ticklabel_format(style='plain', axis='y')

        # The secondary curves must never sit on top of the vlines / peak
        # markers that the tools draw on the main axes.
        ax.set_zorder(window.ax.get_zorder() - 1)

        finite = values[np.isfinite(values)]
        if finite.size:
            lo, hi = float(finite.min()), float(finite.max())
            pad = 0.1 * (hi - lo) if hi > lo else (abs(hi) or 1.0)
            ax.set_ylim(lo - pad, hi + pad)

        if is_dsc:
            exo_up = bool(sheet.get('TGA_Exo_Up', True))
            ax.annotate('exo ↑' if exo_up else 'exo ↓',
                        xy=(1.0, 1.01), xycoords='axes fraction',
                        ha='right', va='bottom', fontsize=8, color=colour)
            window.ax_dsc = ax

        window.tga_axes.append(ax)

    window.ax.patch.set_visible(False)


def _refresh_legend(window):
    """One legend covering every axis, drawn after all the layers exist.

    It has to run last: a legend built while only the first axes had been
    populated would silently omit the DTG and raw-mass layers.  The raw
    trace's entry can be renamed per sheet (``TGA_Raw_Legend``) - 'Raw Data'
    is rarely what the figure should say.
    """
    sheet_name = window.sheet_combobox.GetValue()
    sheet = window.Data.get('Core levels', {}).get(sheet_name, {})
    custom = (sheet.get('TGA_Raw_Legend') or '').strip()

    handles, labels = window.ax.get_legend_handles_labels()
    for ax in getattr(window, 'tga_axes', []) or []:
        extra_handles, extra_labels = ax.get_legend_handles_labels()
        handles += extra_handles
        labels += extra_labels

    if not handles:
        return

    if custom:
        labels = [custom if label == 'Raw Data' else label for label in labels]

    window.ax.legend(handles, labels, loc='upper left', **legend_frame_kwargs(window))


def _draw_annotations(window, sheet):
    """Redraw the measured DSC areas and the baseline preview on this sheet.

    Mass steps are not drawn here: they are Label Manager entries, which the
    generic Labels pass in the plot code already draws (and which the user can
    move, restyle or delete).  Only the shaded DSC integral needs its own
    artist, since a filled area is not something Labels can express.
    """
    ax_dsc = getattr(window, 'ax_dsc', None)
    target = window.ax if ax_dsc is None else ax_dsc

    for peak in sheet.get('TGA_DSC_Peaks', []) or []:
        _draw_dsc_peak(target, peak)

    for transition in sheet.get('TGA_Glass_Transitions', []) or []:
        _draw_glass_transition(target, transition)

    _draw_baseline_preview(target, sheet)


def _draw_glass_transition(ax, transition):
    """Draw the two extrapolated baselines and mark the characteristic Tg's."""
    try:
        t_values = np.asarray(transition['t_selected'], dtype=float)
        pre_line = np.asarray(transition['pre_line'], dtype=float)
        post_line = np.asarray(transition['post_line'], dtype=float)
    except (KeyError, TypeError, ValueError):
        return
    if t_values.size < 2 or t_values.size != pre_line.size:
        return

    ax.plot(t_values, pre_line, color='gray', linestyle=':', linewidth=0.8)
    ax.plot(t_values, post_line, color='gray', linestyle=':', linewidth=0.8)

    midpoint = transition.get('midpoint_temperature')
    for key, style in (('onset_temperature', 0.4),
                       ('endset_temperature', 0.4),
                       ('midpoint_temperature', 0.9)):
        value = transition.get(key)
        if isinstance(value, (int, float)):
            ax.axvline(value, color=DSC_COLOUR, linestyle='--',
                       linewidth=0.9, alpha=style)

    if isinstance(midpoint, (int, float)):
        label = f"Tg {midpoint:.1f} °C"
        delta_cp = transition.get('delta_cp')
        if delta_cp is not None:
            label += f"\nΔCp {delta_cp:.3g} J/(g·K)"
        ax.annotate(label, xy=(midpoint, 1.0), xycoords=('data', 'axes fraction'),
                    xytext=(3, -12), textcoords='offset points',
                    fontsize=8, color=DSC_COLOUR, ha='left', va='top')


def _draw_baseline_preview(ax, sheet):
    """Show the baseline that *would* be used, before anything is integrated.

    Seeing the construction against the data is the only way to tell whether
    it is the right one for the event, which is the whole reason for offering
    six of them.
    """
    preview = sheet.get('TGA_Baseline_Preview')
    if not preview:
        return
    try:
        x = np.asarray(preview['x'], dtype=float)
        y = np.asarray(preview['y'], dtype=float)
    except (KeyError, TypeError, ValueError):
        return
    if x.size < 2 or x.size != y.size:
        return

    ax.plot(x, y, color=BASELINE_COLOUR, linestyle='--', linewidth=1.2,
            label=f"{preview.get('method', 'Baseline')} baseline")


def draw_layers(window, sheet):
    """Draw the raw / smoothed / derivative layers of the mass trace.

    Smoothing is non-destructive: the measurement stays in TGA_Mass_Raw and
    the smoothed copy is a layer over it, so the two can always be compared
    and the raw trace can never be lost.
    """
    layers = sheet.get('TGA_Layers') or {}
    ax = window.ax

    # A stored model fit (e.g. a published TGA~Kinetics relaxation) drawn over
    # its data.
    fit_x, fit_y = sheet.get('TGA_Fit_X'), sheet.get('TGA_Fit_Y')
    if fit_x and fit_y and len(fit_x) == len(fit_y):
        ax.plot(fit_x, fit_y, color=DSC_COLOUR, linewidth=1.4,
                label=sheet.get('TGA_Fit_Label', 'Fit'))

    if layers.get('raw') and sheet.get('TGA_Mass_Raw'):
        x = np.asarray(sheet.get('B.E.', []), dtype=float)
        raw = np.asarray(sheet['TGA_Mass_Raw'], dtype=float)
        if raw.size == x.size:
            ax.plot(x, raw, color=RAW_COLOUR, linewidth=0.8, alpha=0.55,
                    linestyle='-', label='Raw mass')

    if layers.get('dtg') and sheet.get('TGA_DTG'):
        _draw_dtg_layer(window, sheet)


def _draw_dtg_layer(window, sheet):
    """Put the DTG curve on its own right-hand axis."""
    x = np.asarray(sheet.get('B.E.', []), dtype=float)
    dtg = np.asarray(sheet.get('TGA_DTG', []), dtype=float)
    if dtg.size != x.size or dtg.size == 0:
        return

    offset = len(getattr(window, 'tga_axes', []) or [])
    if not offset:
        # No secondary axes were drawn (a sheet with no DSC), so nothing has
        # narrowed the box yet and the DTG label would fall off the figure.
        window.ax.set_position([0.1, 0.1, _axes_width(1), 0.85])
    ax = window.ax.twinx()
    ax.set_position(window.ax.get_position())
    if offset:
        ax.spines['right'].set_position(('outward', 52 * offset))

    label = sheet.get('TGA_DTG_Label', 'DTG')
    ax.plot(x, dtg, color=DTG_COLOUR, linewidth=1.0, label=label)
    ax.set_ylabel(label, color=DTG_COLOUR)
    ax.tick_params(axis='y', colors=DTG_COLOUR)
    ax.spines['right'].set_color(DTG_COLOUR)
    ax.set_zorder(window.ax.get_zorder() - 1)

    finite = dtg[np.isfinite(dtg)]
    if finite.size:
        lo, hi = float(finite.min()), float(finite.max())
        pad = 0.1 * (hi - lo) if hi > lo else (abs(hi) or 1.0)
        ax.set_ylim(lo - pad, hi + pad)

    window.tga_axes.append(ax)
    window.ax_dtg = ax
    window.ax.patch.set_visible(False)


def _draw_dsc_peak(ax, peak):
    """Shade the integrated peak and label it with the enthalpy."""
    try:
        t_values = np.asarray(peak['t_selected'], dtype=float)
        y_values = np.asarray(peak['y_selected'], dtype=float)
        baseline = np.asarray(peak['baseline'], dtype=float)
    except (KeyError, TypeError, ValueError):
        return
    if t_values.size < 2 or t_values.size != y_values.size:
        return

    ax.fill_between(t_values, baseline, y_values, facecolor='lightgreen',
                    alpha=0.5)
    ax.plot(t_values, baseline, color='gray', linestyle=':', linewidth=0.8)

    if peak.get('enthalpy_j_per_g') is not None:
        text = f"{float(peak['enthalpy_j_per_g']):+.3g} J/g"
    else:
        text = f"{float(peak['area_temperature']):.3g} {peak.get('area_temperature_unit', '')}"

    corrected = y_values - baseline
    peak_index = int(np.argmax(np.abs(corrected)))
    # Keep the label clear of the peak it belongs to: above an upward peak,
    # below a downward one.
    offset = 6 if corrected[peak_index] >= 0 else -12
    ax.annotate(text, xy=(t_values[peak_index], y_values[peak_index]),
                xytext=(0, offset), textcoords='offset points',
                fontsize=8, color=DSC_COLOUR, ha='center')
