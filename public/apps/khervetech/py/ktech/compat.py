"""The desktop runs NumPy 1.26; Pyodide ships NumPy 2.x, where a few names
the unchanged desktop code uses are gone. Put them back (same functions)."""

import numpy as np

if not hasattr(np, 'trapz'):
    np.trapz = np.trapezoid
if not hasattr(np, 'product'):
    np.product = np.prod
if not hasattr(np, 'cumproduct'):
    np.cumproduct = np.cumprod
if not hasattr(np, 'in1d'):
    np.in1d = np.isin
if not hasattr(np, 'row_stack'):
    np.row_stack = np.vstack
if not hasattr(np, 'NaN'):
    np.NaN = np.nan
if not hasattr(np, 'Inf'):
    np.Inf = np.inf
