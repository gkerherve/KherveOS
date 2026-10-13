# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ViewMenu/XYMapViewer.py. Regenerate with tools/export_khervetech.py.
import numpy as np


def _make_grid_rotatable(ax, callback):
    """
    EDX's RotatableRectangle hit-tests handles with fixed thresholds in DATA units
    (tuned for 256x256 maps). On a small pixel grid (e.g. 6x5) those thresholds cover
    the whole shape, so an inside-click is always read as 'resize' and the box can't be
    moved. This subclass hit-tests in DISPLAY pixels instead, so move/resize/rotate work
    at any data scale. EDX itself is left untouched.
    """
    from libraries.ToolsMenu.EDX_SEM_Analysis import RotatableRectangle

    class _GridRotatableRectangle(RotatableRectangle):
        def on_press(self, event):
            if not self.active or event.inaxes != self.ax or event.button != 1:
                return
            if self._stored_xlim is None:
                self._stored_xlim = self.ax.get_xlim()
                self._stored_ylim = self.ax.get_ylim()
            trans = self.ax.transData.transform
            ex, ey = event.x, event.y

            # rotation handle (display-pixel distance)
            if self.rotation_handle is not None:
                hd = self.rotation_handle.get_data()
                hx, hy = trans((hd[0][0], hd[1][0]))
                if np.hypot(ex - hx, ey - hy) < 12:
                    self.rotating = True
                    self.drag_start = (event.xdata, event.ydata)
                    return

            # nearest resize handle (display-pixel distance)
            closest, idx = float('inf'), None
            for i, h in enumerate(self.resize_handles):
                hd = h.get_data()
                hx, hy = trans((hd[0][0], hd[1][0]))
                d = np.hypot(ex - hx, ey - hy)
                if d < closest:
                    closest, idx = d, i
            if closest < 10:
                self.resizing = True
                self.resize_corner = idx
                self.drag_start = (event.xdata, event.ydata)
                return

            # inside the box -> MOVE (this is what was unreachable before)
            if self.point_in_rectangle(event.xdata, event.ydata):
                self.dragging = True
                self.drag_start = (event.xdata, event.ydata)
                return

            # just outside a corner -> resize
            if closest < 16:
                self.resizing = True
                self.resize_corner = idx
                self.drag_start = (event.xdata, event.ydata)

    return _GridRotatableRectangle(ax, callback)

