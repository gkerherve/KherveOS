# KherveFitting - XPS Data Analysis Software
# Copyright (C) 2024-2026 Gwilherm Kerherve <g.kerherve@ic.ac.uk>
#
# KherveFitting is dual-licensed:
#   - GNU GPL v3.0 (see LICENSE-GPL.txt) for open-source use
#   - Commercial Licence (see LICENSE-COMMERCIAL.txt) for proprietary use
# SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-KherveFitting-Commercial
#
# KherveOS port: shirley_calculate from the top of libraries/Peak_Functions.py
# (KherveFitting-AI, dev-AI v1.93), unchanged. dev-AI replaced lmfitxps's
# shirley_calculate (which the develop port copied here) by this version, which
# clips the signal above the background at zero; lmfitxps is no longer needed.

import numpy as np
from scipy.integrate import cumulative_trapezoid


def shirley_calculate(x, y, tol=1e-5, maxit=10):
    """Iterative Shirley background between the first and last points of y
    (the end levels), as lmfitxps.backgrounds.shirley_calculate, with one
    difference: the signal above the background is clipped at zero.

    B(E) = I_low + k * integral from E to the low end of (y - I_low - B)+
    with k set so that B reaches I_high at the other end.

    Unclipped (lmfitxps), a region where the data dip below the background -
    typically a valley just inside a window edge that sits on a rising line -
    adds negative area: the background then bulges above its own end level
    and, as the total area approaches zero, k diverges (values of 1e5 CPS
    were seen on an Fe 2p window). Clipped, the background is monotonic
    between its end levels and identical wherever the data stay above it.
    Stops when the mean squared change is below tol (tol=0: maxit passes)."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(x) < 2 or len(x) != len(y):
        return np.zeros_like(y)
    rev = y[0] < y[-1]               # integrate from the lower end
    if rev:
        x, y = x[::-1], y[::-1]
    i_hi, i_lo = y[0], y[-1]
    b = np.zeros_like(y)
    for _ in range(max(1, int(maxit))):
        signal = np.clip(y - i_lo - b, 0.0, None)
        q = cumulative_trapezoid(signal[::-1], x[::-1], initial=0)[::-1]
        k = (i_hi - i_lo) / q[0] if q[0] != 0 else 0.0
        new = k * q
        change = float(np.mean((new - b) ** 2))
        b = new
        if tol > 0 and change < tol:
            break
    out = i_lo + b
    return out[::-1] if rev else out
