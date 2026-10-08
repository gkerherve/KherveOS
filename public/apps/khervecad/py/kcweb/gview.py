"""Graphics views and custom-drawn widgets in the desktop's dialogs.

The House Builder's floor plan and the City Builder's map are
QGraphicsViews whose items paint themselves; the Lego plan and the
chamber's port map are widgets with their own paintEvent. Each is drawn
here into the recording QPainter (qtshim/_painter.py) and replayed by the
web side (src/apps/khervecad/qt/GView.tsx, PaintWidget.tsx); the mouse,
wheel and keys come back as Qt events.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

from PyQt5 import _graphics
from PyQt5._painter import QStyleOptionGraphicsItem, record
from PyQt5._widgets import QWidget
from PyQt5.QtCore import QPointF, QRectF

from . import ui


def _view_rev(view):
    rev = view._kc_rev
    scene = view._kc_scene
    if scene is not None:
        rev = max(rev, scene._kc_rev)
        for top in scene._g_items:
            for it in _graphics._walk(top):
                if it._kc_rev > rev:
                    rev = it._kc_rev
    return rev


def _item(it):
    node = {"i": it._kc_id, "x": it._g_pos.x(), "y": it._g_pos.y()}
    if it._g_z:
        node["z"] = it._g_z
    if it._g_flags & it.ItemIgnoresTransformations:
        node["ign"] = 1
    if it._g_opacity != 1.0:
        node["op"] = it._g_opacity
    if it._g_cursor:
        node["cur"] = it._g_cursor
    if it._g_selected:
        node["sel"] = 1
    option = QStyleOptionGraphicsItem()
    option.state = 1 if it._g_selected else 0
    node["ops"] = record(lambda p: it.paint(p, option, None))
    kids = [c for c in it._g_children if c._g_visible]
    if kids:
        node["kids"] = [_item(c) for c in kids]
    return node


def view_node(view):
    """A QGraphicsView: its background, items and zoom."""
    scene = view._kc_scene
    tl = view.mapToScene(0, 0)
    br = view.mapToScene(view._kc_vw, view._kc_vh)
    exposed = QRectF(min(tl.x(), br.x()), min(tl.y(), br.y()),
                     abs(br.x() - tl.x()), abs(br.y() - tl.y()))
    bg = getattr(view, "_kc_bg", None)
    node = {"t": "gview",
            "view": [view._kc_sx, view._kc_sy, view._kc_cx, view._kc_cy,
                     view._kc_view_rev],
            "bgc": ui_color(bg.color()) if bg is not None and bg.style()
            else None,
            "back": record(lambda p: view.drawBackground(p, exposed)),
            "fore": record(lambda p: view.drawForeground(p, exposed)),
            "items": [_item(it) for it in (scene._g_items if scene else [])
                      if it._g_visible],
            "cursor": view._kc_cursor}
    band = scene._g_band if scene is not None else None
    if band is not None:
        node["band"] = [band[0].x(), band[0].y(), band[1].x(), band[1].y()]
    return node


def ui_color(c):
    try:
        return "#%02x%02x%02x%02x" % (c.red(), c.green(), c.blue(),
                                      c.alpha())
    except Exception:
        return None


def paints_itself(w):
    """A desktop widget with its own paintEvent (and no children to lay
    out instead). Buttons are not: their paintEvent only decorates the
    button Qt draws first (MenuButton's chevron), so they stay buttons."""
    from PyQt5.QtWidgets import QAbstractButton
    if isinstance(w, QAbstractButton):
        return False
    fn = type(w).__dict__.get("paintEvent") or next(
        (c.__dict__["paintEvent"] for c in type(w).__mro__
         if "paintEvent" in c.__dict__), None)
    return fn is not None and not getattr(fn, "__module__",
                                          "PyQt5").startswith("PyQt5")


def paint_node(w):
    w._kc_ops = []
    try:
        w.paintEvent(_PaintEvent(w))
    except Exception as exc:
        w._kc_ops.append(["error", f"{type(exc).__name__}: {exc}"])
    ops, w._kc_ops = w._kc_ops, None
    return {"t": "paint", "ops": ops, "pw": w._kc_w, "ph": w._kc_h}


class _PaintEvent(ui._core.Inert):
    def __init__(self, w):
        self._rect = QRectF(0, 0, w._kc_w, w._kc_h)

    def rect(self):
        return QRectF(self._rect)

    def region(self):
        return self


def install():
    ui.CUSTOM[_graphics.QGraphicsView] = view_node
    ui.REV_HOOKS.append(lambda w: _view_rev(w)
                        if isinstance(w, _graphics.QGraphicsView) else 0)
    ui.PAINTERS.append((paints_itself, paint_node))


def event(ev):
    """Mouse / wheel / keys on a dialog's graphics view or painted widget
    (ops gv_* and pw_*)."""
    w = ui.find(ev.get("id", 0))
    if w is None:
        return
    op = ev["op"]
    if op in ("gv_view", "pw_size"):
        if isinstance(w, _graphics.QGraphicsView):
            w._kc_sx = float(ev.get("sx", w._kc_sx))
            w._kc_sy = float(ev.get("sy", w._kc_sy))
            w._kc_cx = float(ev.get("cx", w._kc_cx))
            w._kc_cy = float(ev.get("cy", w._kc_cy))
            w._kc_vw = int(ev.get("w", w._kc_vw))
            w._kc_vh = int(ev.get("h", w._kc_vh))
        w._kc_w = int(ev.get("w", w._kc_w))
        w._kc_h = int(ev.get("h", w._kc_h))
        return
    me = ui.MouseEvent(float(ev.get("x", 0)), float(ev.get("y", 0)),
                       ev.get("button", 1), ev.get("buttons", 0),
                       ev.get("mods", 0), ev.get("dy", 0))
    kind = op.split("_", 1)[1]
    if kind == "press":
        w.mousePressEvent(me)
    elif kind == "move":
        w.mouseMoveEvent(me)
    elif kind == "release":
        w.mouseReleaseEvent(me)
    elif kind == "dbl":
        w.mouseDoubleClickEvent(me)
    elif kind == "wheel":
        if isinstance(w, _graphics.QGraphicsView):
            w._kc_anchor_px = (me.x(), me.y())
        try:
            w.wheelEvent(me)
        finally:
            if isinstance(w, _graphics.QGraphicsView):
                w._kc_anchor_px = None
    elif kind == "key":
        w.keyPressEvent(ui.KeyEvent(ev.get("key", 0), ev.get("mods", 0),
                                    ev.get("text", "")))
    elif kind == "menu":
        handler = getattr(w, "contextMenuEvent", None)
        if handler is not None:
            handler(me)


__all__ = ["install", "event", "view_node", "paint_node", "QPointF",
           "QWidget"]
