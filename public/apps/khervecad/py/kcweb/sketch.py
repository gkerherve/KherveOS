"""The 2D sketch view for the web side.

The desktop's SketchScene / SketchView (view2d.py) run unchanged on the
headless QGraphicsScene; this module reads their items and the view's
zoom for the canvas that draws them (src/apps/khervecad/Sketch.tsx),
and turns the canvas's mouse, wheel and keys back into Qt events.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import base64
from array import array

from PyQt5 import _graphics
from PyQt5.QtCore import QPointF

from . import ui

#: what the web side last got: (scene rev, view rev)
_SENT = {"scene": None, "view": None}


def install():
    from khervecad.view2d import SketchView
    ui.CUSTOM[SketchView] = _view_node


def _view_node(view):
    """The view's place in the window, with its floating nav bar."""
    bar = getattr(view, "nav_bar", None)
    return {"t": "sketch",
            "overlays": [ui.serialize(bar)] if bar is not None else []}


def _b64(values):
    a = array("f", values)
    return base64.b64encode(a.tobytes()).decode("ascii")


def _color(c):
    """'#rrggbbaa' of a QColor."""
    if c is None:
        return None
    try:
        return "#%02x%02x%02x%02x" % (c.red(), c.green(), c.blue(),
                                      c.alpha())
    except Exception:
        return None


def _pen(pen):
    if pen is None or getattr(pen, "_style", 1) == 0:
        return None
    return [_color(pen._color), pen._width, 1 if pen.isCosmetic() else 0,
            pen._style, getattr(pen, "_cap", 0x10)]


def _brush(brush):
    if brush is None or not getattr(brush, "_style", 0) or \
            brush._color is None:
        return None
    return _color(brush._color)


def _path(path):
    subs = [s for s in path._subs if len(s) >= 2]
    flat = [v for s in subs for p in s for v in p]
    return {"pts": _b64(flat), "lens": [len(s) for s in subs],
            "rule": getattr(path, "_fill_rule", 0)}


def _item(it):
    node = {"i": it._kc_id, "x": it._g_pos.x(), "y": it._g_pos.y(),
            "cls": type(it).__name__}
    if it._g_z:
        node["z"] = it._g_z
    if not it._g_visible:
        node["hid"] = 1
    if it._g_selected:
        node["sel"] = 1
    if it._g_flags & it.ItemIgnoresTransformations:
        node["ign"] = 1
    if it._g_flags & it.ItemIsMovable:
        node["mov"] = 1
    if it._g_cursor:
        node["cur"] = it._g_cursor
    if it._g_opacity != 1.0:
        node["op"] = it._g_opacity
    if isinstance(it, _graphics.QAbstractGraphicsShapeItem):
        pen = _pen(it._g_pen)
        if pen:
            node["pen"] = pen
        brush = _brush(it._g_brush)
        if brush:
            node["br"] = brush
    if isinstance(it, _graphics.QGraphicsLineItem):
        ln = it._g_line
        node["k"] = "line"
        node["g"] = [ln.x1(), ln.y1(), ln.x2(), ln.y2()]
    elif isinstance(it, _graphics.QGraphicsEllipseItem):
        r = it._g_rect
        node["k"] = "ellipse"
        node["g"] = [r.x(), r.y(), r.width(), r.height(), it._g_start,
                     it._g_span]
    elif isinstance(it, _graphics.QGraphicsRectItem):
        r = it._g_rect
        node["k"] = "rect"
        node["g"] = [r.x(), r.y(), r.width(), r.height()]
    elif isinstance(it, _graphics.QGraphicsPolygonItem):
        node["k"] = "poly"
        node["g"] = [v for p in it._g_poly for v in (p.x(), p.y())]
    elif isinstance(it, _graphics.QGraphicsPathItem):
        node["k"] = "path"
        faces = getattr(it, "_faces", None)
        if faces:
            # the part's own coloured faces, painter-ordered (planview)
            pal, idx, flat = {}, [], []
            for poly, col in faces:
                key = _color(col)
                if key not in pal:
                    pal[key] = len(pal)
                idx.append(pal[key])
                for p in poly[:3]:
                    flat += (p.x(), p.y())
            node["faces"] = {"pts": _b64(flat), "idx": idx,
                             "pal": list(pal)}
            if it._g_selected:
                node["path"] = _path(it._g_path)
        else:
            node["path"] = _path(it._g_path)
        label = getattr(it, "_label", None)
        if label:
            node["label"] = label
            lc = getattr(it, "_label_color", None)
            node["lc"] = _color(lc)
            lp = getattr(it, "_label_pos", None)
            if lp is not None:
                node["lp"] = [lp.x(), lp.y()]
                box = it._g_path.boundingRect()
                node["lh"] = box.height()
    elif isinstance(it, _graphics.QGraphicsSimpleTextItem):
        node["k"] = "text"
        node["text"] = it._g_text
    else:
        node["k"] = "none"
    if it._g_children:
        node["kids"] = [_item(c) for c in it._g_children]
    return node


def _scene_rev(scene):
    rev = scene._kc_rev
    for top in scene._g_items:
        for it in _graphics._walk(top):
            if it._kc_rev > rev:
                rev = it._kc_rev
    return rev


def state(win):
    """What changed in the sketch since the last answer (or None)."""
    scene, view = win.scene, win.view2d
    out = {}
    srev = _scene_rev(scene)
    if srev != _SENT["scene"]:
        _SENT["scene"] = srev
        out["items"] = [_item(it) for it in scene._g_items]
        out.update(_overlay(win))
    if view._kc_view_rev != _SENT["view"]:
        _SENT["view"] = view._kc_view_rev
        out["view"] = {"sx": view._kc_sx, "sy": view._kc_sy,
                       "cx": view._kc_cx, "cy": view._kc_cy,
                       "rev": view._kc_view_rev}
    if out:
        out["cursor"] = view._kc_cursor
    return out or None


def _overlay(win):
    """Everything drawForeground / drawBackground read."""
    from khervecad.style import tokens
    scene = win.scene
    band = scene._g_band
    a, b = scene._measure_a, scene._measure_b
    cur = scene._measure_cursor
    return {"plane": scene.plane, "grid": scene.show_grid,
            "gs": scene.grid_size, "dims": scene.show_dims,
            "tool": scene.tool, "unit": scene.unit(),
            "ma": [a.x(), a.y()] if a is not None else None,
            "mb": [b.x(), b.y()] if b is not None else
            ([cur.x(), cur.y()] if cur is not None else None),
            "placed": [d for d in getattr(scene.model, "dimensions", [])
                       if d.get("plane") == scene.plane],
            "band": [band[0].x(), band[0].y(), band[1].x(), band[1].y()]
            if band is not None else None,
            "tok": {k: v for k, v in tokens().items()
                    if isinstance(v, str)}}


def event(win, ev):
    view = win.view2d
    op = ev["op"]
    if op == "sk_view":
        # the canvas's own pan / zoom / size: adopt without echoing back
        view._kc_sx = float(ev.get("sx", view._kc_sx))
        view._kc_sy = float(ev.get("sy", view._kc_sy))
        view._kc_cx = float(ev.get("cx", view._kc_cx))
        view._kc_cy = float(ev.get("cy", view._kc_cy))
        view._kc_vw = int(ev.get("w", view._kc_vw))
        view._kc_vh = int(ev.get("h", view._kc_vh))
        view.zoom_changed.emit(view.px_per_mm())
        return
    x, y = float(ev.get("x", 0)), float(ev.get("y", 0))
    me = ui.MouseEvent(x, y, ev.get("button", 1), ev.get("buttons", 0),
                       ev.get("mods", 0), ev.get("dy", 0))
    if op == "sk_press":
        view.mousePressEvent(me)
    elif op == "sk_move":
        view.mouseMoveEvent(me)
    elif op == "sk_release":
        view.mouseReleaseEvent(me)
    elif op == "sk_dbl":
        view.mouseDoubleClickEvent(me)
    elif op == "sk_wheel":
        view._kc_anchor_px = (x, y)
        try:
            view.wheelEvent(me)
        finally:
            view._kc_anchor_px = None
    elif op == "sk_menu":
        view.contextMenuEvent(_ContextEvent(x, y))
    elif op == "sk_key":
        key = ui.KeyEvent(ev.get("key", 0), ev.get("mods", 0),
                          ev.get("text", ""))
        if key.key() in (0x01000001, 0x01000002):
            view.step_object.emit(1 if key.key() == 0x01000001 else -1)
        else:
            view.keyPressEvent(key)


class _ContextEvent(ui.MouseEvent):
    def globalPos(self):
        return QPointF(self._p)
