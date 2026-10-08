"""The 3D view for the web side.

The desktop's View3D (view3d.py) keeps running: the main window hands
it meshes, colours, the selection's triangles, anchors, a cut, a pick
mode; its camera is the desktop's (yaw / pitch / distance / target, a
focal length of 1.2 × the shorter side). Three.js draws it
(src/apps/khervecad/View3D.tsx) from what this module sends, and
orbits / pans / zooms locally, reporting the camera back. In a pick or
Edit Mode the canvas forwards the mouse here instead.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import base64
from array import array

from . import ui

_SENT = {"mesh": None, "hi": None, "cam": None, "look": None,
         "markers": None, "refs": None}


def install():
    from khervecad.view3d import View3D
    ui.CUSTOM[View3D] = _view_node


def _view_node(view):
    overlays = []
    for name in ("lighting_bar", "nav_bar", "cut_bar"):
        w = getattr(view, name, None)
        if w is not None:
            node = ui.serialize(w)
            overlays.append(node)
    return {"t": "view3d", "overlays": overlays}


def _b64f(values):
    return base64.b64encode(array("f", values).tobytes()).decode("ascii")


def _b64u16(values):
    return base64.b64encode(array("H", values).tobytes()).decode("ascii")


def _flat(tris):
    return [c for tri in tris for v in tri for c in v]


def _colour_key(c):
    """A per-face colour (colour, alpha[, material]) as JSON."""
    if c is None:
        return None
    value = c[0]
    if isinstance(value, (list, tuple)):
        value = [float(x) for x in value[:3]]
    else:
        value = str(value)
    alpha = float(c[1]) if len(c) > 1 and c[1] is not None else 1.0
    mat = str(c[2]) if len(c) > 2 and c[2] else ""
    return [value, alpha, mat]


def mesh_payload(tris, colors):
    out = {"pos": _b64f(_flat(tris)), "n": len(tris)}
    if colors:
        pal, idx = {}, []
        for c in colors:
            key = repr(_colour_key(c))
            if key not in pal:
                pal[key] = (len(pal), _colour_key(c))
            idx.append(pal[key][0])
        out["pal"] = [v for _i, v in sorted(pal.values(),
                                             key=lambda p: p[0])]
        out["idx"] = _b64u16(idx)
    return out


def state(win, session):
    v = win.view3d
    out = {}
    mesh_key = (v._mesh_serial, id(v.mesh), len(v.mesh),
                id(v.colors) if v.colors else None)
    if mesh_key != _SENT["mesh"]:
        _SENT["mesh"] = mesh_key
        out["mesh"] = mesh_payload(v.mesh, v.colors)
    hi_key = (id(v.highlight_mesh), len(v.highlight_mesh))
    if hi_key != _SENT["hi"]:
        _SENT["hi"] = hi_key
        out["hi"] = {"pos": _b64f(_flat(v.highlight_mesh)),
                     "n": len(v.highlight_mesh)}
    cam = (round(v.yaw, 6), round(v.pitch, 6), round(v.distance, 6),
           tuple(round(t, 6) for t in v.target), v.projection)
    if cam != _SENT["cam"]:
        _SENT["cam"] = cam
        out["cam"] = {"yaw": v.yaw, "pitch": v.pitch,
                      "distance": v.distance, "target": list(v.target),
                      "projection": v.projection}
    from khervecad.view3d import BACKGROUNDS
    from khervecad.style import tokens
    look = {"style": v.style, "bg": v.background,
            "bgc": BACKGROUNDS.get(v.background) or
            [tokens()["editor"], tokens()["editor"]],
            "stage": v.stage, "cavity": v.cavity, "edges": v.edges,
            "smooth": v.smooth, "grid": v.grid, "scale_bar": v.scale_bar,
            "overlay": v.overlay, "unit": v.unit,
            "real_scale": v.real_scale, "source": v.source,
            "light": [v.brightness, v.contrast, v.light_turn,
                      v.light_height],
            "flash": v._flash_text, "banner": v._pick_banner,
            "pick": 1 if v._pick_cb is not None else 0,
            "edit": 1 if v.edit_tool is not None else 0,
            "cut": v.cut_state(), "user_moved": v.user_moved,
            "base": tokens()["select"], "border": tokens()["border"],
            "text": tokens()["text"],
            "ratio": _ratio(v.real_scale),
            "cursor": v.__dict__.get("_kc_cursor", 0)}
    hover = v._pick_hover or v._pick_pinned
    if hover is not None:
        desc, label = hover
        look["hover"] = {"label": label, "kind": desc.get("kind"),
                         "pos": desc.get("pos"),
                         "tris": _b64f(_flat(desc.get("tris") or []))
                         if desc.get("tris") else None}
    if look != _SENT["look"]:
        _SENT["look"] = look
        out["look"] = look
    markers = [{"pos": list(m.get("pos", (0, 0, 0))),
                "dir": list(m.get("dir", (0, 0, 1))),
                "name": m.get("name", ""), "kind": m.get("kind", "")}
               for m in v.anchor_markers]
    if markers != _SENT["markers"]:
        _SENT["markers"] = markers
        out["markers"] = markers
    refs = [{k: r.get(k) for k in ("path", "plane", "x", "y", "width",
                                    "height", "offset", "opacity",
                                    "visible")}
            for r in v.reference_images]
    if refs != _SENT["refs"]:
        _SENT["refs"] = refs
        out["refs"] = refs
    return out or None


def _ratio(n):
    """'1 : 250 000 000' under the scale bar of a scale model."""
    if not n or abs(n - 1.0) < 1e-9:
        return ""
    from khervecad import units
    return units.ratio_text(n)


def reset():
    for k in _SENT:
        _SENT[k] = None


def event(win, ev):
    v = win.view3d
    op = ev["op"]
    if op == "v3_camera":
        v.yaw = float(ev.get("yaw", v.yaw))
        v.pitch = float(ev.get("pitch", v.pitch))
        v.distance = float(ev.get("distance", v.distance))
        if ev.get("target"):
            v.target = [float(t) for t in ev["target"]]
        if ev.get("w"):
            v._kc_w, v._kc_h = int(ev["w"]), int(ev["h"])
        if ev.get("moved"):
            v.user_moved = True
        _SENT["cam"] = (round(v.yaw, 6), round(v.pitch, 6),
                        round(v.distance, 6),
                        tuple(round(t, 6) for t in v.target), v.projection)
        return
    x, y = float(ev.get("x", 0)), float(ev.get("y", 0))
    me = ui.MouseEvent(x, y, ev.get("button", 1), ev.get("buttons", 0),
                       ev.get("mods", 0), ev.get("dy", 0))
    if op == "v3_press":
        v.mousePressEvent(me)
    elif op == "v3_move":
        if v._pick_cb is not None and v._last is None:
            # hover pre-highlight, at once (no timer to wait for)
            from PyQt5.QtCore import QPointF
            v._hover_pos = QPointF(x, y)
            v._hover_pick()
        else:
            v.mouseMoveEvent(me)
    elif op == "v3_release":
        v.mouseReleaseEvent(me)
    elif op == "v3_dbl":
        v.mouseDoubleClickEvent(me)
    elif op == "v3_wheel":
        v.wheelEvent(me)
    elif op == "v3_key":
        key = ui.KeyEvent(ev.get("key", 0), ev.get("mods", 0),
                          ev.get("text", ""))
        if key.key() == 0x01000001 and not key.modifiers() & 0x0C000000:
            v.tab_pressed.emit()
        else:
            v.keyPressEvent(key)
