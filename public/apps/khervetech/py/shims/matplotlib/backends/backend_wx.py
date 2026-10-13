"""matplotlib.backends.backend_wx for the recording matplotlib: the navigation toolbar the desktop windows put under a canvas."""

from .backend_wxagg import FigureCanvasWxAgg, NavigationToolbar2Wx, NavigationToolbar2WxAgg  # noqa: F401

FigureCanvasWx = FigureCanvasWxAgg
