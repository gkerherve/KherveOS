# KherveOS port: libraries/NumberFormat.py (KherveFitting-AI, dev-AI v1.93), unchanged.
"""
Number resolution for intensities (peak Height, Area, and anything derived
from them).

KherveFitting grew up on photoemission counts, where an area is thousands of
CPS.eV and whole numbers or two decimals are plenty. Normalised data, CPS
scaled down, or other techniques give areas of 0.35 or 0.004; writing those
with '%.0f' / '%.2f', or storing them with round(x, 2), turns them into 0 and
the next fit starts from nothing. These two helpers keep the familiar look for
large numbers and keep significant figures for small ones.
"""

import math


def round_sig(value, sig=6):
    """Round for storage: ``sig`` significant figures, never to zero.

    Large numbers are untouched in practice (6 significant figures of 123456.7
    is 123457); 0.0041234567 keeps 0.00412346 instead of becoming 0.0.
    Non-numbers are returned unchanged.
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return value
    if v == 0 or not math.isfinite(v):
        return v
    digits = sig - 1 - int(math.floor(math.log10(abs(v))))
    return round(v, digits)


def format_intensity(value, sig=4):
    """Text for a Height / Area cell.

    |v| >= 100 : whole number, as before ('12345')
    |v| >= 1   : two decimals ('12.35', '1.20')
    |v| <  1   : ``sig`` significant figures, trailing zeros dropped but at
                 least two decimals ('0.35', '0.004123'); below 1e-6 in
                 exponent form.
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(v):
        return f"{v}"
    a = abs(v)
    if a >= 100:
        return f"{v:.0f}"
    if a >= 1:
        return f"{v:.2f}"
    if a == 0:
        return "0.00"
    if a < 1e-6:
        return f"{v:.{sig - 1}e}"
    places = sig - 1 - int(math.floor(math.log10(a)))
    text = f"{v:.{places}f}".rstrip('0')
    whole, _, frac = text.partition('.')
    if len(frac) < 2:
        frac = frac.ljust(2, '0')
    return f"{whole}.{frac}"
