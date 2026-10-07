"""Shape-spec → Qt graphics items.

The model engine emits *shape specs* (plain dicts). This module turns them
into `QGraphicsItem`s for the interactive scenes, and can rasterise a spec
list to a `QImage` for PNG export. Lit spheres use an off-centre radial
("sun") gradient so circles read as 3D balls.

Copyright (C) 2026 Gwilherm Kerherve

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""

from PyQt5.QtCore import QLineF, QPointF, QRectF, Qt
from PyQt5.QtGui import (QBrush, QColor, QFont, QGradient, QImage,
                         QLinearGradient, QPainter, QPen, QPolygonF,
                         QRadialGradient)
from PyQt5.QtWidgets import (QGraphicsEllipseItem, QGraphicsLineItem,
                             QGraphicsPolygonItem, QGraphicsSimpleTextItem)

#: Geometry of the "sun" highlight, in unit bounding-box coordinates.
_SUN_CENTER = (0.35, 0.35)
_SUN_FOCAL = (0.25, 0.25)
_SUN_RADIUS = 0.95


def _brush_from_grad(spec):
    kind = spec.get("kind", "solid")
    c1 = QColor(spec.get("c1", "#cccccc"))
    c2 = QColor(spec.get("c2", "#ffffff"))
    if kind == "sun":
        g = QRadialGradient(QPointF(*_SUN_CENTER), _SUN_RADIUS,
                            QPointF(*_SUN_FOCAL))
        g.setCoordinateMode(QGradient.ObjectBoundingMode)
        g.setColorAt(0.0, c2)
        g.setColorAt(1.0, c1)
        return QBrush(g)
    if kind == "radial":
        g = QRadialGradient(QPointF(0.5, 0.5), 0.7071, QPointF(0.5, 0.5))
        g.setCoordinateMode(QGradient.ObjectBoundingMode)
        g.setColorAt(0.0, c1)
        g.setColorAt(1.0, c2)
        return QBrush(g)
    if kind == "linear":
        g = QLinearGradient(QPointF(0.5, 0.0), QPointF(0.5, 1.0))
        g.setCoordinateMode(QGradient.ObjectBoundingMode)
        g.setColorAt(0.0, c1)
        g.setColorAt(1.0, c2)
        return QBrush(g)
    return QBrush(c1)


def _pen(spec):
    color = spec.get("stroke", "#1a1a1a")
    if not color or str(color).lower() == "none":
        return QPen(Qt.NoPen)
    pen = QPen(QColor(color), float(spec.get("width", 2)))
    pen.setCapStyle(Qt.RoundCap)
    pen.setJoinStyle(Qt.RoundJoin)
    return pen


def _brush(spec):
    fill = spec.get("fill")
    if isinstance(fill, dict):
        return _brush_from_grad(fill)
    if not fill or str(fill).lower() == "none":
        return QBrush(Qt.NoBrush)
    return QBrush(QColor(fill))


def spec_to_item(spec):
    """One spec → a QGraphicsItem, or None for an unknown shape."""
    shape = str(spec.get("shape", "")).lower()
    if shape == "line":
        item = QGraphicsLineItem(QLineF(
            float(spec.get("x1", 0)), float(spec.get("y1", 0)),
            float(spec.get("x2", 0)), float(spec.get("y2", 0))))
        item.setPen(_pen(spec))
        return item
    if shape in ("circle", "ellipse"):
        rect = QRectF(float(spec.get("x", 0)), float(spec.get("y", 0)),
                      float(spec.get("w", 10)), float(spec.get("h", 10)))
        item = QGraphicsEllipseItem(rect)
        item.setPen(_pen(spec))
        item.setBrush(_brush(spec))
        return item
    if shape == "polygon":
        poly = QPolygonF([QPointF(float(px), float(py))
                          for px, py in spec.get("points", [])])
        item = QGraphicsPolygonItem(poly)
        item.setPen(_pen(spec))
        item.setBrush(_brush(spec))
        if "opacity" in spec:
            item.setOpacity(float(spec["opacity"]))
        return item
    if shape == "text":
        item = QGraphicsSimpleTextItem(str(spec.get("text", "")))
        item.setBrush(QBrush(QColor(spec.get("stroke", "#1a1a1a"))))
        font = QFont("Segoe UI", int(spec.get("size", 12)))
        font.setBold(bool(spec.get("bold", True)))
        item.setFont(font)
        x, y = float(spec.get("x", 0)), float(spec.get("y", 0))
        if str(spec.get("anchor", "")).lower() == "center":
            box = item.boundingRect()       # (x, y) is the centre, not the
            x -= box.width() / 2.0          # top-left corner
            y -= box.height() / 2.0
        item.setPos(x, y)
        return item
    return None


def add_specs(scene, specs):
    """Add every spec to *scene* (in order, so later specs sit in front).

    Sphere specs carrying an ``"_atom"`` index get it stored via
    ``setData(0, index)`` for hit-testing. Returns the created items."""
    items = []
    for spec in specs:
        item = spec_to_item(spec)
        if item is None:
            continue
        item.setZValue(len(items))
        if "_atom" in spec:
            item.setData(0, spec["_atom"])
        scene.addItem(item)
        items.append(item)
    return items


def specs_from_graph2d(atoms, bonds, r=15.0, bond_w=6.0):
    """Ball-and-stick specs from a flat 2D graph (atoms ``[el,x,y]``,
    bonds ``[i,j,order]``) — used to preview a 2D depiction."""
    from . import model
    specs = []
    for i, j, order in bonds:
        a, b = atoms[i], atoms[j]
        specs += model.bond_specs((a[1], a[2]), (b[1], b[2]), order,
                                  width=bond_w)
    for el, x, y in atoms:
        specs += model.atom_specs(x, y, r, el)
    return specs


def render_image(specs, width, height, background="#ffffff", margin=24,
                 transparent=False):
    """Rasterise *specs* into a QImage sized (width, height), scaled to fit
    with *margin* px. Used for PNG export."""
    from PyQt5.QtWidgets import QGraphicsScene
    scene = QGraphicsScene()
    add_specs(scene, specs)
    box = scene.itemsBoundingRect()
    if box.isEmpty():
        box = QRectF(0, 0, 1, 1)
    img = QImage(int(width), int(height), QImage.Format_ARGB32)
    img.fill(Qt.transparent if transparent else QColor(background))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    target = QRectF(margin, margin, max(1, width - 2 * margin),
                    max(1, height - 2 * margin))
    scene.render(p, target, box, Qt.KeepAspectRatio)
    p.end()
    return img
