"""A recording matplotlib for KherveOS's technique apps.

The desktop draws the main plot and the companion views with matplotlib on
wx canvases. Here the same calls record what is drawn - axes, lines,
scatters, fills, texts, annotations, arrows, tables, legends, twin axes
with their outward spines - and ``serialise_figure`` hands that to the page,
which draws it as the desktop would (src/apps/khervetech/FigurePlot.tsx).
No pixels are made in Python, so the plot stays interactive in the browser
(the red range lines are dragged there) and nothing heavy is loaded.

Only the parts the technique tools call are here.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0.
"""

from ._rec import (  # noqa: F401
    Artist, Axes, Figure, Line2D, Text, Patch, Legend, Table, rcParams, serialise_figure, reset_sent,
)
from . import colors, cm  # noqa: F401

__version__ = '3.9.0'
rcParamsDefault = dict(rcParams)


def use(*a, **kw):
    pass


def get_backend():
    return 'agg'


def interactive(b):
    pass


def is_interactive():
    return False


def rc(*a, **kw):
    pass


colormaps = cm._REGISTRY
