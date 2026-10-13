# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/SEM_Sheets.py. Regenerate with tools/export_khervetech.py.
"""
Turn an SEM size distribution into an ordinary KherveFitting sheet.

The analysis window can publish either plot as a sheet — ``SEM~Count``
(particles per bin) or ``SEM~Freq`` (percentage of the population per bin).
These are *not* image sheets: they carry a normal x/y pair in ``B.E.`` and
``Raw Data``, so every existing mechanism works on them unchanged — they plot
on the main canvas, save into the .kfit, and export to .xlsx as columns.

'B.E.' holds the particle size rather than a binding energy. That is a
deliberate reuse of the generic x-array slot, the same one the FTIR, TGA and
SQUID sheets use for wavenumber, temperature and field: the alternative is a
parallel plotting path for what is, structurally, just a curve. The ``SEM~``
prefix is what tells the plotting and axis code to label it as a size and to
leave the axis running low-to-high instead of reversing it as XPS does.
"""

import numpy as np

# Sheet names, and the y-axis label each one carries.
COUNT_SHEET = 'SEM~Count'
FREQ_SHEET = 'SEM~Freq'

_KINDS = {
    'count': (COUNT_SHEET, 'Number of particles'),
    'frequency': (FREQ_SHEET, 'Frequency of particles (%)'),
}


def is_sem_plot_sheet(sheet_name):
    """True for the derived distribution sheets (not the image sheet)."""
    return bool(sheet_name) and str(sheet_name).startswith('SEM~')


def sem_plot_labels(sheet, sheet_name=''):
    """(x label, y label) for a derived SEM distribution sheet."""
    if isinstance(sheet, dict):
        x_label = sheet.get('SEM_X_Label')
        y_label = sheet.get('SEM_Y_Label')
        if x_label and y_label:
            return x_label, y_label
    y_label = ('Frequency of particles (%)'
               if str(sheet_name).startswith(FREQ_SHEET)
               else 'Number of particles')
    return 'Particle size (nm)', y_label


BRAND = (79 / 255, 190 / 255, 159 / 255)


def bin_width_of(sheet, x_values=None):
    """Bin width of a distribution sheet, falling back to the point spacing."""
    if isinstance(sheet, dict) and sheet.get('SEM_Bin_Width'):
        try:
            return float(sheet['SEM_Bin_Width'])
        except (TypeError, ValueError):
            pass
    x = np.asarray(x_values if x_values is not None else [], dtype=float)
    if x.size > 1:
        return float(abs(x[1] - x[0]))
    return 1.0


def draw_distribution_bars(ax, x_values, y_values, sheet=None):
    """Draw a distribution sheet as a histogram, with its fit and mean.

    A binned distribution is not a sampled curve: the generic scatter/line
    rendering turns it into a cloud of dots whose spacing carries no meaning,
    and hides that each point represents a whole interval. Bars of the stored
    bin width show it as what it is, and match the plot in the analysis window
    — including the fitted curve and the mean, so a published sheet says the
    same thing as the tool it came from.
    """
    from libraries.ToolsMenu.SEM_Engine import format_mean, lognormal_curve

    x = np.asarray(x_values, dtype=float)
    y = np.asarray(y_values, dtype=float)
    if x.size == 0 or y.size == 0:
        return
    width = bin_width_of(sheet, x)
    colours = sheet if isinstance(sheet, dict) else {}
    ax.bar(x, y, width=width * 0.92,
           color=colours.get('SEM_Bar_Color', BRAND),
           edgecolor=colours.get('SEM_Edge_Color', 'black'),
           linewidth=0.4, label='Raw Data', zorder=2)

    if not isinstance(sheet, dict):
        return
    fit = sheet.get('SEM_Fit')
    summary = sheet.get('SEM_Stats')
    unit = sheet.get('SEM_Unit', 'nm')

    if fit and summary:
        # Sample the curve finely rather than at the bin centres, so it reads
        # as a smooth fit rather than a polyline joining the bars.
        fine = np.linspace(max(x.min() - width, 1e-9), x.max() + width, 400)
        curve = lognormal_curve(fit, fine, summary.get('count', 0), width,
                                as_frequency=sheet.get('SEM_Kind') == 'frequency')
        if curve is not None:
            ax.plot(fine, curve, color=colours.get('SEM_Fit_Color', 'firebrick'),
                    lw=1.6, label='Lognormal fit', zorder=3)

    if summary:
        ax.annotate(format_mean(summary, unit),
                    xy=(0.97, 0.95), xycoords='axes fraction',
                    ha='right', va='top', fontsize=9, zorder=4,
                    bbox=dict(facecolor='white', alpha=0.75,
                              edgecolor='lightgray', boxstyle='round,pad=0.35'))


def make_distribution_sheet(kind, centres, values, source_sheet, stats=None,
                            fit=None, summary=None, colours=None):
    """Build the sheet dict for a size distribution.

    Args:
        kind:         'count' or 'frequency'
        centres:      bin centres (particle size)
        values:       counts, or frequency percentages
        source_sheet: name of the SEM image sheet the data came from
        stats:        the detection statistics, recorded for provenance
        fit:          lognormal fit parameters, so the curve can be redrawn
        summary:      mean/SD/SEM, so the sheet can report them itself
    """
    if kind not in _KINDS:
        raise ValueError(f"Unknown distribution kind: {kind}")
    name, y_label = _KINDS[kind]

    centres = np.asarray(centres, dtype=float)
    values = np.asarray(values, dtype=float)
    unit = 'nm'
    if stats and 'ECD Mean (px)' in stats:
        unit = 'px'
    x_label = f'Particle size ({unit})'

    info = {'Technique': 'SEM', 'Source Sheet': source_sheet}
    for key in ('Count', 'Density (per um2)', 'Areal Coverage (%)',
                f'ECD Mean ({unit})', f'ECD Median ({unit})',
                f'ECD Std ({unit})'):
        if stats and key in stats:
            info[key] = stats[key]

    # The bin width has to travel with the sheet: from bin centres alone the
    # renderer cannot tell a 2 nm bin from a gap in the data.
    width = float(centres[1] - centres[0]) if centres.size > 1 else 1.0

    return name, {
        'Name': name,
        'B.E.': centres.tolist(),          # generic x-array: particle size
        'Raw Data': values.tolist(),
        'SEM_X_Label': x_label,
        'SEM_Y_Label': y_label,
        'SEM_Bin_Width': width,
        'SEM_Kind': kind,
        'SEM_Unit': unit,
        # Carried so the sheet can redraw its own fit and quote its own mean,
        # instead of only looking right inside the analysis window.
        'SEM_Fit': dict(fit) if fit else None,
        'SEM_Stats': dict(summary) if summary else None,
        # Colours chosen in the Results tab, so the sheet renders like the
        # chart it was published from.
        'SEM_Bar_Color': (colours or {}).get('bar'),
        'SEM_Edge_Color': (colours or {}).get('edge'),
        'SEM_Fit_Color': (colours or {}).get('fit'),
        'SEM_Source_Sheet': source_sheet,
        'ExperimentalInfo': info,
        'Background': {
            'Bkg Y': np.zeros_like(centres).tolist(),
            'Bkg Type': 'Linear', 'Bkg Low': '', 'Bkg High': '',
            'Bkg Offset Low': 0, 'Bkg Offset High': 0,
        },
        'Fitting': {'Peaks': {}},
    }


def publish_distribution(window, kind, centres, values, source_sheet, stats=None,
                         fit=None, summary=None, colours=None):
    """Add (or replace) a distribution sheet and select it.

    Re-publishing overwrites the existing sheet rather than accumulating
    SEM~Count1, SEM~Count2, ...: the plot is a view of the current detection,
    so a stale copy left behind would be actively misleading.
    """
    name, sheet = make_distribution_sheet(kind, centres, values, source_sheet,
                                          stats, fit, summary, colours)
    if 'Core levels' not in window.Data:
        window.Data['Core levels'] = {}
    window.Data['Core levels'][name] = sheet
    window.Data['Number of Core levels'] = len(window.Data['Core levels'])

    try:
        if name not in list(window.sheet_combobox.GetStrings()):
            window.sheet_combobox.Append(name)
    except Exception:
        pass
    return name
