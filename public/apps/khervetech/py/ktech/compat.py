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


def pandas_openpyxl():
    """pandas 3 (Pyodide's) asks for openpyxl >= 3.1.5 to read a workbook; the desktop
    pins 3.1.2 (KherveFitting's wheel, which reads everything the importers write)."""
    try:
        from pandas.compat import _optional
        if 'openpyxl' in getattr(_optional, 'VERSIONS', {}):
            _optional.VERSIONS['openpyxl'] = '3.1.2'
    except ImportError:
        pass
