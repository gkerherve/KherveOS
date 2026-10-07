"""Export a molecule as an SVG that KhervePaint can open as native items.

KhervePaint's SVG format (its native save/open format) writes one element
per item — spheres as ``<ellipse>`` filled with an ``objectBoundingBox``
radial gradient, bonds as ``<line>`` — under the SVG namespace, with a
private ``kp:`` namespace for extras. We emit exactly that shape so a
molecule opens in KhervePaint as editable, movable, gradient-filled circles
and lines (the same look as its own molecule builder).

The "sun" lit-sphere gradient is written the way KhervePaint reads it back:
an off-centre radial (``cx=0.35 cy=0.35 r=0.95 fx=0.25 fy=0.25``) with the
light colour first, so it round-trips as a sun fill.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

import math
import xml.etree.ElementTree as ET

from PyQt5.QtGui import QColor

from . import elements

SVG_NS = "http://www.w3.org/2000/svg"
KP_NS = "https://kerherve.app/khervepaint"
ET.register_namespace("", SVG_NS)
ET.register_namespace("kp", KP_NS)


def _svg(tag):
    return f"{{{SVG_NS}}}{tag}"


def _kp(tag):
    return f"{{{KP_NS}}}{tag}"


def _hex(color):
    return QColor(color).name()


def _gradient(defs, counter, fill):
    """Write *fill* (a gradient spec dict) into <defs>, KhervePaint-style,
    and return its id."""
    counter[0] += 1
    gid = f"kpgrad{counter[0]}"
    kind = fill.get("kind", "sun")
    el = ET.SubElement(defs, _svg("radialGradient"))
    el.set("id", gid)
    el.set("gradientUnits", "objectBoundingBox")
    if kind == "sun":
        el.set("cx", "0.35")
        el.set("cy", "0.35")
        el.set("r", "0.95")
        el.set("fx", "0.25")
        el.set("fy", "0.25")
        stops = [("0", fill.get("c2", "#ffffff")),
                 ("1", fill.get("c1", "#888888"))]
    else:                                       # radial
        el.set("cx", "0.5")
        el.set("cy", "0.5")
        el.set("r", "0.7071")
        stops = [("0", fill.get("c1", "#888888")),
                 ("1", fill.get("c2", "#ffffff"))]
    for offset, color in stops:
        stop = ET.SubElement(el, _svg("stop"))
        stop.set("offset", offset)
        stop.set("stop-color", _hex(color))
    return gid


def _stroke(el, spec):
    color = spec.get("stroke", "#1a1a1a")
    if not color or str(color).lower() == "none":
        el.set("stroke", "none")
    else:
        el.set("stroke", _hex(color))
        el.set("stroke-width", f"{float(spec.get('width', 2)):g}")
        el.set("stroke-linecap", "round")
        el.set("stroke-linejoin", "round")


def specs_to_svg(specs, width, height, dpi=96):
    """Build a KhervePaint-compatible SVG (ElementTree root) from *specs*."""
    w, h = int(round(width)), int(round(height))
    root = ET.Element(_svg("svg"))
    root.set("width", f"{w / dpi:g}in")
    root.set("height", f"{h / dpi:g}in")
    root.set("viewBox", f"0 0 {w} {h}")
    root.set(_kp("dpi"), str(dpi))
    root.set(_kp("app"), "KherveMol")
    defs = ET.SubElement(root, _svg("defs"))
    counter = [0]

    for spec in specs:
        shape = str(spec.get("shape", "")).lower()
        if shape == "line":
            el = ET.SubElement(root, _svg("line"))
            el.set("x1", f"{float(spec.get('x1', 0)):g}")
            el.set("y1", f"{float(spec.get('y1', 0)):g}")
            el.set("x2", f"{float(spec.get('x2', 0)):g}")
            el.set("y2", f"{float(spec.get('y2', 0)):g}")
            _stroke(el, spec)
        elif shape in ("circle", "ellipse"):
            x = float(spec.get("x", 0))
            y = float(spec.get("y", 0))
            bw = float(spec.get("w", 10))
            bh = float(spec.get("h", 10))
            el = ET.SubElement(root, _svg("ellipse"))
            el.set("cx", f"{x + bw / 2:g}")
            el.set("cy", f"{y + bh / 2:g}")
            el.set("rx", f"{bw / 2:g}")
            el.set("ry", f"{bh / 2:g}")
            _stroke(el, spec)
            fill = spec.get("fill")
            if isinstance(fill, dict):
                el.set("fill", f"url(#{_gradient(defs, counter, fill)})")
            elif fill and str(fill).lower() != "none":
                el.set("fill", _hex(fill))
            else:
                el.set("fill", "none")
        elif shape == "polygon":
            # KhervePaint reads <polygon> as an editable PolygonItem, so a
            # coordination polyhedron stays a set of movable faces there.
            el = ET.SubElement(root, _svg("polygon"))
            el.set("points", " ".join(f"{float(px):g},{float(py):g}"
                                      for px, py in spec.get("points", [])))
            _stroke(el, spec)
            fill = spec.get("fill")
            el.set("fill", _hex(fill) if fill and str(fill).lower() != "none"
                   else "none")
            if "opacity" in spec:
                el.set("fill-opacity", f"{float(spec['opacity']):g}")
        elif shape == "text":
            el = ET.SubElement(root, _svg("text"))
            el.set("x", f"{float(spec.get('x', 0)):g}")
            el.set("y", f"{float(spec.get('y', 0)):g}")
            centred = str(spec.get("anchor", "")).lower() == "center"
            el.set("text-anchor", "middle" if centred else "start")
            el.set("dominant-baseline", "central" if centred else "hanging")
            el.set("font-family", "Segoe UI, sans-serif")
            el.set("font-size", f"{float(spec.get('size', 14)):g}")
            el.set("font-weight", "bold")
            el.set("fill", _hex(spec.get("stroke", "#1a1a1a")))
            el.text = str(spec.get("text", ""))

    if len(defs) == 0:
        root.remove(defs)
    return root


def save_specs(path, specs, width, height, dpi=96):
    root = specs_to_svg(specs, width, height, dpi)
    ET.ElementTree(root).write(path, xml_declaration=True, encoding="utf-8")


def bounds(specs):
    xs, ys = [], []
    for s in specs:
        sh = s.get("shape")
        if sh == "line":
            xs += [s["x1"], s["x2"]]
            ys += [s["y1"], s["y2"]]
        elif sh in ("circle", "ellipse"):
            xs += [s["x"], s["x"] + s["w"]]
            ys += [s["y"], s["y"] + s["h"]]
        elif sh == "polygon":
            for px, py in s.get("points", []):
                xs.append(px)
                ys.append(py)
        elif sh == "text":
            xs.append(s["x"])
            ys.append(s["y"])
    if not xs:
        return (0.0, 0.0, 1.0, 1.0)
    return (min(xs), min(ys), max(xs), max(ys))


def normalize(specs, margin=24):
    """Shift *specs* so their bounding box sits at (margin, margin); return
    ``(shifted_specs, width, height)`` so the SVG viewBox fits exactly."""
    x0, y0, x1, y1 = bounds(specs)
    dx, dy = margin - x0, margin - y0
    out = []
    for s in specs:
        s = dict(s)
        sh = s.get("shape")
        if sh == "line":
            s["x1"] += dx
            s["y1"] += dy
            s["x2"] += dx
            s["y2"] += dy
        elif sh in ("circle", "ellipse"):
            s["x"] += dx
            s["y"] += dy
        elif sh == "polygon":
            s["points"] = [[px + dx, py + dy] for px, py in s["points"]]
        elif sh == "text":
            s["x"] += dx
            s["y"] += dy
        out.append(s)
    return out, (x1 - x0) + 2 * margin, (y1 - y0) + 2 * margin


# --------------------------------------------------------- 2D sketch → specs
def sketch_specs(atoms, bonds, show_labels=False, mode="skeletal"):
    """Line+label specs for a 2D graph (atoms [el,x,y]) in representation
    *mode*, matching the on-screen sketch — for SVG export of the 2D tab."""
    from . import molrepr
    gap = 13.0
    lw = 2.3
    sep = 4.5
    dot_r = 1.6
    if mode == "condensed":
        if not atoms:
            return []
        return [{"shape": "text", "text": molrepr.hill_formula(atoms, bonds),
                 "x": 0.0, "y": 0.0, "anchor": "center", "size": 34,
                 "stroke": "#1a1a1a"}]
    show_labels = show_labels or molrepr.shows_all_labels(mode)

    def deg(idx):
        return sum(1 for i, j, _o in bonds if idx in (i, j))

    def labeled(idx):
        el = atoms[idx][0]
        if show_labels:
            return True
        if el in ("C", "H"):
            return deg(idx) == 0
        return True

    specs = []
    for i, j, order in bonds:
        if not show_labels and (atoms[i][0] == "H" or atoms[j][0] == "H"):
            continue
        (_e1, x1, y1), (_e2, x2, y2) = atoms[i], atoms[j]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        ux, uy = dx / length, dy / length
        px, py = -uy, ux
        gi = gap if labeled(i) else 0.0
        gj = gap if labeled(j) else 0.0
        sx, sy = x1 + ux * gi, y1 + uy * gi
        ex, ey = x2 - ux * gj, y2 - uy * gj
        offs = {1: [0.0], 2: [-1.0, 1.0], 3: [-1.0, 0.0, 1.0]}.get(order, [0.0])
        for o in offs:
            ox, oy = px * o * sep, py * o * sep
            specs.append({"shape": "line", "x1": sx + ox, "y1": sy + oy,
                          "x2": ex + ox, "y2": ey + oy,
                          "stroke": "#1b1b1b", "width": lw})
    for idx, (el, x, y) in enumerate(atoms):
        if not show_labels and el == "H" and deg(idx) > 0:
            continue
        if labeled(idx):
            specs.append({"shape": "text", "text": el, "x": x, "y": y,
                          "anchor": "center", "size": 15,
                          "stroke": elements.color(el)})
        if mode == "lewis":
            for dx, dy in molrepr.dot_positions(idx, atoms, bonds,
                                                gap + dot_r * 2.2, 2.6):
                specs.append({"shape": "circle", "x": dx - dot_r,
                              "y": dy - dot_r, "w": 2 * dot_r,
                              "h": 2 * dot_r, "stroke": "none",
                              "fill": "#1a1a1a"})
    return specs
