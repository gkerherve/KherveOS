# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/PeakFittingGrid.py. Regenerate with tools/export_khervetech.py.
import numpy as np


def format_peak_value(value, decimals=2):
    """Format a number for the peak grid without throwing small ones away.

    The grid was written with '%.2f' throughout, which is right for
    photoemission - positions in eV and intensities in counts, where two
    decimal places is more precision than the measurement has.  It is wrong
    for anything whose numbers are small: a DRT peak 0.0077 wide, or an area
    of 0.004, comes out as '0.00', and the peak is then a division by zero.

    So: two decimal places as before whenever that actually shows the number,
    and enough places to keep two significant figures when it does not.  A
    value that needs more than six places is written in exponent form rather
    than as a row of zeros.
    """
    try:
        value = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not np.isfinite(value):
        return f"{value}"
    if value == 0:
        return f"{0.0:.{decimals}f}"

    magnitude = abs(value)
    if magnitude >= 10.0 ** -decimals:
        return f"{value:.{decimals}f}"
    # Two significant figures for anything smaller.
    places = int(np.floor(-np.log10(magnitude))) + 2
    if places > 6:
        return f"{value:.3e}"
    return f"{value:.{places}f}"

