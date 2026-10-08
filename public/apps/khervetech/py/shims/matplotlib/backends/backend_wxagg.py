"""matplotlib.backends.backend_wxagg for the recording matplotlib: a canvas that is a wx widget.

The headless wx serialises it as a 'Canvas' node holding the recorded figure,
which the page draws (src/apps/khervetech/FigurePlot.tsx). Mouse events the
desktop code connects with mpl_connect are kept, and a double-click on the
canvas reaches its wx EVT_LEFT_DCLICK handlers.
"""

import wx

from .._rec import _CanvasBase


class FigureCanvasWxAgg(wx.Window, _CanvasBase):
    _kind = 'Canvas'

    def __init__(self, parent, id=-1, figure=None):
        wx.Window.__init__(self, parent, id)
        _CanvasBase.__init__(self, figure)
        self._seen = -1

    def draw_idle(self):
        self.figure._touch()
        self.Dirty()

    draw = draw_idle

    def _serial(self):
        from .._rec import current_arrays, serialise_figure
        d = self._common()
        d['fig'] = serialise_figure(self.figure, current_arrays())
        self._seen = self.figure.version
        return d


FigureCanvas = FigureCanvasWxAgg


class NavigationToolbar2WxAgg(wx.Window):
    def __init__(self, canvas, *a, **kw):
        wx.Window.__init__(self, canvas.GetParent() if hasattr(canvas, 'GetParent') else None)

    def Realize(self):
        pass

    def update(self):
        pass


NavigationToolbar2Wx = NavigationToolbar2WxAgg
