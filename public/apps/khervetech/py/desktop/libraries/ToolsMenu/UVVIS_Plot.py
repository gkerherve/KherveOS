# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/UVVIS_Plot.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/UVVIS_Plot.py
"""
Main-frame plotting for UV-Vis sheets.

The ``UVvis~Tauc`` sheet - the photon-energy transform - carries the dotted
extrapolation line of the linear fit (``UVVIS_Fit_X`` / ``UVVIS_Fit_Y``), the
band-gap readout drawn straight on the plot, and, while a UV-Vis Analysis
window is open, the shared red vline pair marking the linear-fit window,
draggable exactly like a background range.

The Tauc plot can also sit as an inset on the measured spectrum - the
publication figure. That is not done here: it is an ordinary Label Manager
inset with a ``source`` key naming the Tauc sheet, so it can be moved,
resized, renamed, given axis ranges and label sizes, or deleted with every
other label. ``UVVIS_Analysis.on_insert_inset`` creates the entry.

Everything here is drawn from what is stored on the sheet, so a replot, a
sheet switch or a project reload always reproduces the same figure.
"""

import json

import numpy as np

FIT_COLOUR = (0.7, 0.13, 0.13)


def is_uvvis_sheet(sheet_name):
    return str(sheet_name or '').upper().startswith('UVVIS')


def is_tauc_sheet(sheet_name):
    name = str(sheet_name or '').upper()
    return name.startswith('UVVIS') and '~TAUC' in name


def draw_uvvis_extras(window, sheet_name):
    """Add the stored Tauc fit, its readout and the range lines.

    Safe to call for any sheet: it returns immediately when the sheet is not
    a Tauc one.
    """
    if not is_tauc_sheet(sheet_name):
        return
    sheet = window.Data.get('Core levels', {}).get(sheet_name)
    if not isinstance(sheet, dict):
        return
    _draw_tauc_fit(window, sheet)
    restore_range_vlines(window)


def _tauc_results(sheet):
    try:
        return json.loads(sheet.get('UVVIS_Results') or '{}').get('tauc')
    except (TypeError, ValueError):
        return None


def _draw_tauc_fit(window, sheet):
    """The dotted extrapolation line and the Eg readout on a Tauc sheet."""
    ax = window.ax
    # The Tauc quantity is >= 0 and the whole point of the figure is the
    # intercept with the energy axis, so the axis must sit at zero.
    ax.set_ylim(bottom=0)

    fit_x, fit_y = sheet.get('UVVIS_Fit_X'), sheet.get('UVVIS_Fit_Y')
    if fit_x and fit_y and len(fit_x) == len(fit_y):
        ax.plot(fit_x, fit_y, color=FIT_COLOUR, linestyle=':', linewidth=1.6)

    tauc = _tauc_results(sheet)
    if not tauc:
        return

    eg = float(tauc['eg'])
    ax.plot([eg], [0.0], marker='o', markersize=5, color=FIT_COLOUR,
            clip_on=False)
    # Keep the intercept on screen even when it falls below the first data
    # point (a spectrum that stops just above the edge).
    x_lo, x_hi = ax.get_xlim()
    if eg < x_lo:
        ax.set_xlim(left=eg - 0.05 * (x_hi - x_lo))

    lines = [f"Eg = {eg:.3f} eV",
             f"R² = {tauc.get('r2', 0.0):.4f}"]
    if tauc.get('transition'):
        lines.append(tauc['transition'])
    ax.text(0.03, 0.97, "\n".join(lines), transform=ax.transAxes,
            va='top', ha='left', fontsize=11, color=FIT_COLOUR,
            bbox=dict(facecolor='white', edgecolor='gray', alpha=0.75,
                      boxstyle='round,pad=0.4'))


def restore_range_vlines(window):
    """Create/refresh the red fit-window lines on the current Tauc sheet.

    Only while a UV-Vis Analysis window is open - the lines are the shared
    vline1/vline2 pair, so the fitting and area screens keep priority over
    them (same rule as the EIS / SQUID / TGA tools).
    """
    if getattr(window, 'uvvis_analysis_window', None) is None:
        return
    if (getattr(window, 'background_tab_selected', False) or
            getattr(window, 'area_tab_selected', False)):
        return
    sheet_name = window.sheet_combobox.GetValue()
    sheet = window.Data.get('Core levels', {}).get(sheet_name)
    if not isinstance(sheet, dict) or not is_tauc_sheet(sheet_name):
        return
    x_values = sheet.get('B.E.', [])
    if not x_values:
        return

    x_lo, x_hi = min(x_values), max(x_values)
    background = sheet.setdefault('Background', {})
    low = background.get('Bkg Low')
    high = background.get('Bkg High')
    if not isinstance(low, (int, float)) or not (x_lo <= low <= x_hi):
        low = x_lo
    if not isinstance(high, (int, float)) or not (x_lo <= high <= x_hi):
        high = x_hi
    background['Bkg Low'] = float(min(low, high))
    background['Bkg High'] = float(max(low, high))

    for attr in ('vline1', 'vline2'):
        line = getattr(window, attr, None)
        if line is not None:
            try:
                line.remove()
            except (ValueError, NotImplementedError):
                pass
        setattr(window, attr, None)

    window.vline1 = window.ax.axvline(background['Bkg Low'], color='r',
                                      linestyle='--', alpha=0.7)
    window.vline2 = window.ax.axvline(background['Bkg High'], color='r',
                                      linestyle='--', alpha=0.7)
    window.canvas.draw_idle()
