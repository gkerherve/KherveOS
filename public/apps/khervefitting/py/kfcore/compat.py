"""Small differences between the desktop's NumPy 1.26 and Pyodide's NumPy 2.x.

np.trapz was renamed np.trapezoid in NumPy 2.0 and removed later; both
compute the same trapezoidal sum.
"""

import numpy as np

trapz = getattr(np, "trapezoid", None) or np.trapz
