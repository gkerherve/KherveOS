"""matplotlib.widgets for the recording matplotlib.

The selectors the desktop tools drag out with the mouse (RectangleSelector, SpanSelector, LassoSelector...) are kept as
objects that know their state but are never driven here: a canvas in the page has no mouse events to give them yet, so a
tool that needs a drawn region gets it from its own typed controls or from the AI actions instead.
"""


class _Widget:
    def __init__(self, ax=None, onselect=None, *a, **kw):
        self.ax = ax
        self.canvas = getattr(getattr(ax, 'figure', None), 'canvas', None)
        self.onselect = onselect
        self.active = True
        self.visible = True
        self.extents = (0.0, 0.0, 0.0, 0.0)
        self.artists = []

    def set_active(self, a):
        self.active = bool(a)

    def get_active(self):
        return self.active

    def set_visible(self, v):
        self.visible = bool(v)

    def set_props(self, **kw):
        pass

    def set_handle_props(self, **kw):
        pass

    def update(self):
        pass

    def clear(self):
        pass

    def disconnect_events(self):
        pass

    def connect_event(self, *a, **kw):
        pass

    def remove(self):
        pass

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return lambda *a, **kw: None


class _Drag(_Widget):
    """A selector driven by the canvas's mouse events: press, drag (a rectangle is drawn), release -> onselect(press, release)."""

    def __init__(self, ax=None, onselect=None, *a, **kw):
        super().__init__(ax, onselect)
        self._buttons = kw.get('button')
        self._minspan = kw.get('minspanx', kw.get('minspan', 0))
        self._props = kw.get('props') or kw.get('rectprops') or {}
        self._press = None
        self._patch = None
        self._cids = []
        canvas = self.canvas
        if canvas is not None:
            self._cids = [canvas.mpl_connect('button_press_event', self._on_press),
                          canvas.mpl_connect('motion_notify_event', self._on_motion),
                          canvas.mpl_connect('button_release_event', self._on_release)]

    def _ok(self, ev):
        if not self.active or ev.inaxes is not self.ax or ev.xdata is None:
            return False
        b = self._buttons
        return b is None or ev.button == b or (isinstance(b, (list, tuple)) and ev.button in b)

    def _on_press(self, ev):
        if self._ok(ev):
            self._press = ev

    def _on_motion(self, ev):
        if self._press is not None and ev.xdata is not None:
            self._draw(self._press, ev)

    def _on_release(self, ev):
        press, self._press = self._press, None
        self._erase()
        if press is None or ev.xdata is None or not self.active:
            return
        self.extents = (min(press.xdata, ev.xdata), max(press.xdata, ev.xdata), min(press.ydata, ev.ydata), max(press.ydata, ev.ydata))
        if self.onselect is not None:
            self.onselect(press, ev)

    def _draw(self, a, b):
        pass

    def _erase(self):
        if self._patch is not None:
            try:
                self._patch.remove()
            except Exception:
                pass
            self._patch = None
            if self.canvas is not None:
                self.canvas.draw_idle()

    def disconnect_events(self):
        for cid in self._cids:
            self.canvas.mpl_disconnect(cid)
        self._cids = []

    def set_active(self, a):
        self.active = bool(a)
        if not a:
            self._press = None
            self._erase()

    def remove(self):
        self.disconnect_events()
        self._erase()


class RectangleSelector(_Drag):
    def _draw(self, a, b):
        from ._rec import Patch
        if self._patch is None:
            self._patch = Patch('rect', facecolor=self._props.get('facecolor', 'red'), edgecolor=self._props.get('edgecolor', 'red'),
                                alpha=self._props.get('alpha', 0.2), linewidth=1.5, zorder=20)
            self.ax.add_patch(self._patch)
        self._patch.set_xy((min(a.xdata, b.xdata), min(a.ydata, b.ydata)))
        self._patch.set_width(abs(b.xdata - a.xdata))
        self._patch.set_height(abs(b.ydata - a.ydata))
        self.canvas.draw_idle()


class SpanSelector(_Drag):
    def __init__(self, ax=None, onselect=None, direction='horizontal', *a, **kw):
        self._direction = direction
        super().__init__(ax, onselect, *a, **kw)

    def _draw(self, a, b):
        from ._rec import Patch
        if self._patch is None:
            self._patch = Patch('rect', facecolor='red', edgecolor='none', alpha=0.2, zorder=20)
            self.ax.add_patch(self._patch)
        if self._direction == 'horizontal':
            lo, hi = self.ax.get_ylim()
            self._patch.set_xy((min(a.xdata, b.xdata), min(lo, hi)))
            self._patch.set_width(abs(b.xdata - a.xdata))
            self._patch.set_height(abs(hi - lo))
        else:
            lo, hi = self.ax.get_xlim()
            self._patch.set_xy((min(lo, hi), min(a.ydata, b.ydata)))
            self._patch.set_width(abs(hi - lo))
            self._patch.set_height(abs(b.ydata - a.ydata))
        self.canvas.draw_idle()

    def _on_release(self, ev):
        press, self._press = self._press, None
        self._erase()
        if press is None or ev.xdata is None or not self.active:
            return
        lo, hi = ((press.xdata, ev.xdata) if self._direction == 'horizontal' else (press.ydata, ev.ydata))
        if self.onselect is not None and abs(hi - lo) > self._minspan:
            self.onselect(min(lo, hi), max(lo, hi))


class EllipseSelector(RectangleSelector):
    pass


class LassoSelector(_Widget):
    pass


class PolygonSelector(_Widget):
    pass


class Cursor(_Widget):
    pass


class MultiCursor(_Widget):
    pass


class Button(_Widget):
    def __init__(self, ax=None, label='', *a, **kw):
        super().__init__(ax)
        self.label = label

    def on_clicked(self, fn):
        return 0


class Slider(_Widget):
    def __init__(self, ax=None, label='', valmin=0, valmax=1, valinit=0.5, *a, **kw):
        super().__init__(ax)
        self.val, self.valmin, self.valmax = valinit, valmin, valmax

    def on_changed(self, fn):
        return 0

    def set_val(self, v):
        self.val = v


class CheckButtons(_Widget):
    pass


class RadioButtons(_Widget):
    pass


class TextBox(_Widget):
    pass
