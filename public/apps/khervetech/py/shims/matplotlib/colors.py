"""matplotlib.colors for the recording matplotlib."""

import numpy as np

from ._rec import css_colour


def to_hex(c, keep_alpha=False):
    s = css_colour(c)
    return s if s.startswith('#') else '#000000'


def to_rgba(c, alpha=None):
    if isinstance(c, (tuple, list, np.ndarray)) and len(c) in (3, 4) and all(isinstance(v, (int, float, np.floating)) for v in c):
        vals = [float(v) for v in c]
        if max(vals[:3]) > 1:
            vals = [v / 255 for v in vals[:3]] + vals[3:]
        r, g, b = vals[:3]
        a = vals[3] if len(vals) > 3 else 1.0
        return (r, g, b, a if alpha is None else alpha)
    s = to_hex(c)
    r, g, b = (int(s[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return (r, g, b, 1.0 if alpha is None else alpha)


def to_rgb(c):
    return to_rgba(c)[:3]


def rgb2hex(c, keep_alpha=False):
    return to_hex(c)


def is_color_like(c):
    try:
        to_rgba(c)
        return True
    except Exception:
        return False


def same_color(a, b):
    return to_hex(a) == to_hex(b)


class Normalize:
    def __init__(self, vmin=None, vmax=None, clip=False):
        self.vmin, self.vmax = vmin, vmax

    def __call__(self, v):
        lo = self.vmin if self.vmin is not None else float(np.nanmin(v))
        hi = self.vmax if self.vmax is not None else float(np.nanmax(v))
        return (np.asarray(v, dtype=float) - lo) / ((hi - lo) or 1.0)


LogNorm = PowerNorm = TwoSlopeNorm = CenteredNorm = Normalize

from .cm import Colormap, ListedColormap, LinearSegmentedColormap  # noqa: E402,F401

BASE_COLORS = {'b': (0, 0, 1), 'g': (0, 0.5, 0), 'r': (1, 0, 0), 'c': (0, 0.75, 0.75), 'm': (0.75, 0, 0.75),
               'y': (0.75, 0.75, 0), 'k': (0, 0, 0), 'w': (1, 1, 1)}
TABLEAU_COLORS = {f'tab:{n}': c for n, c in zip(
    ['blue', 'orange', 'green', 'red', 'purple', 'brown', 'pink', 'gray', 'olive', 'cyan'],
    ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'])}
CSS4_COLORS = {'black': '#000000', 'white': '#ffffff', 'red': '#ff0000', 'green': '#008000', 'blue': '#0000ff',
               'gray': '#808080', 'grey': '#808080', 'lightgreen': '#90ee90', 'orange': '#ffa500'}
