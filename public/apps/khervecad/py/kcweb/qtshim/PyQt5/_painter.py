"""A QPainter that records: the desktop's custom-drawn widgets and
graphics items (the House Builder's floor plan, the City Builder's map,
the Lego plan, the chamber's port map…) paint into this, and the web side
replays the commands on a canvas (src/apps/khervecad/qt/paint.ts).

Commands are short lists: ["line", x1, y1, x2, y2], ["rect", x, y, w, h],
["pen", colour, width, cosmetic, style, cap] … in the painter's current
coordinates; ["tf", m11, m12, m21, m22, dx, dy] sets the transform.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import math

from ._core import Inert, Lenient, QPointF, QRectF


def _hex(color):
    try:
        return "#%02x%02x%02x%02x" % (color.red(), color.green(),
                                      color.blue(), color.alpha())
    except Exception:
        return None


class _State:
    __slots__ = ("pen", "brush", "font", "tf", "opacity")

    def __init__(self, pen=None, brush=None, font=None, tf=None, opacity=1.0):
        self.pen, self.brush, self.font = pen, brush, font
        self.tf = tf or [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        self.opacity = opacity


class QPainter(Lenient):
    Antialiasing = 1
    TextAntialiasing = 2
    SmoothPixmapTransform = 4
    HighQualityAntialiasing = 8
    CompositionMode_SourceOver = 0
    CompositionMode_Multiply = 13
    CompositionMode_Clear = 2
    CompositionMode_Source = 3

    def __init__(self, device=None):
        self.ops = []
        self._st = _State()
        self._stack = []
        self._active = False
        if device is not None:
            self.begin(device)

    # -- lifecycle
    def begin(self, device):
        ops = getattr(device, "_kc_ops", None)
        if isinstance(ops, list):
            self.ops = ops
        self._device = device
        self._active = True
        return True

    def end(self):
        self._active = False
        return True

    def isActive(self):
        return self._active

    def device(self):
        return getattr(self, "_device", None)

    # -- state
    def _emit_tf(self):
        self.ops.append(["tf"] + [round(v, 6) for v in self._st.tf])

    def save(self):
        self._stack.append(_State(self._st.pen, self._st.brush,
                                  self._st.font, list(self._st.tf),
                                  self._st.opacity))
        self.ops.append(["save"])

    def restore(self):
        if self._stack:
            self._st = self._stack.pop()
        self.ops.append(["restore"])

    def setPen(self, pen):
        from .QtGui import QColor, QPen
        if isinstance(pen, QPen):
            p = pen
        elif isinstance(pen, QColor):
            p = QPen(pen)
        elif isinstance(pen, int):
            p = QPen(pen) if pen == 0 else QPen()
        else:
            p = QPen(pen)
        self._st.pen = p
        if p.style() == 0:
            self.ops.append(["pen", None])
        else:
            self.ops.append(["pen", _hex(p.color()), p.widthF(),
                             1 if p.isCosmetic() else 0, p.style(),
                             p.capStyle()])

    def pen(self):
        from .QtGui import QPen
        return self._st.pen or QPen()

    def setBrush(self, brush):
        from .QtGui import QBrush, QColor
        if isinstance(brush, QBrush):
            b = brush
        elif isinstance(brush, QColor):
            b = QBrush(brush)
        elif isinstance(brush, int):
            b = QBrush(brush)
        else:
            b = QBrush(brush)
        self._st.brush = b
        if not b.style() or b._color is None:
            self.ops.append(["brush", None])
        else:
            self.ops.append(["brush", _hex(b._color), b.style()])

    def brush(self):
        from .QtGui import QBrush
        return self._st.brush or QBrush()

    def setFont(self, font):
        self._st.font = font
        self.ops.append(["font", font._px() if hasattr(font, "_px") else 13,
                         1 if getattr(font, "_bold", False) else 0,
                         1 if getattr(font, "_italic", False) else 0,
                         getattr(font, "_family", "")])

    def font(self):
        from .QtGui import QFont
        return QFont(self._st.font) if self._st.font is not None else QFont()

    def fontMetrics(self):
        from .QtGui import QFontMetricsF
        return QFontMetricsF(self.font())

    def setOpacity(self, a):
        self._st.opacity = float(a)
        self.ops.append(["op", float(a)])

    def opacity(self):
        return self._st.opacity

    def setRenderHint(self, *a):
        pass

    def setRenderHints(self, *a):
        pass

    def setCompositionMode(self, mode):
        self.ops.append(["comp", int(mode)])

    def setClipRect(self, *a):
        pass

    def setClipPath(self, *a):
        pass

    def setClipping(self, *a):
        pass

    def setBackground(self, *a):
        pass

    def setBackgroundMode(self, *a):
        pass

    def setWorldMatrixEnabled(self, *a):
        pass

    # -- transform
    def _mul(self, m):
        a = m
        b = self._st.tf
        self._st.tf = [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
                       a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
                       a[4] * b[0] + a[5] * b[2] + b[4],
                       a[4] * b[1] + a[5] * b[3] + b[5]]
        self._emit_tf()

    def translate(self, dx, dy=None):
        if isinstance(dx, QPointF):
            dx, dy = dx.x(), dx.y()
        self._mul([1, 0, 0, 1, float(dx), float(dy)])

    def scale(self, sx, sy):
        self._mul([float(sx), 0, 0, float(sy), 0, 0])

    def rotate(self, deg):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        self._mul([c, s, -s, c, 0, 0])

    def setTransform(self, t, combine=False):
        m = [t.m11(), t.m12(), t.m21(), t.m22(), t.dx(), t.dy()]
        if combine:
            self._mul(m)
        else:
            self._st.tf = m
            self._emit_tf()

    setWorldTransform = setTransform

    def transform(self):
        from ._graphics import QTransform
        return QTransform(*self._st.tf)

    worldTransform = transform

    def resetTransform(self):
        self._st.tf = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        self._emit_tf()

    # -- drawing
    @staticmethod
    def _rect(a):
        if len(a) == 1:
            r = a[0]
            return [r.x(), r.y(), r.width(), r.height()]
        if len(a) == 2 and isinstance(a[0], QPointF):
            p, q = a
            return [p.x(), p.y(), q.x() - p.x(), q.y() - p.y()]
        return [float(v) for v in a[:4]]

    def drawLine(self, *a):
        if len(a) == 1:
            ln = a[0]
            x1, y1, x2, y2 = ln.x1(), ln.y1(), ln.x2(), ln.y2()
        elif len(a) == 2:
            x1, y1, x2, y2 = a[0].x(), a[0].y(), a[1].x(), a[1].y()
        else:
            x1, y1, x2, y2 = (float(v) for v in a[:4])
        self.ops.append(["line", x1, y1, x2, y2])

    def drawLines(self, lines):
        for ln in lines:
            self.drawLine(ln)

    def drawPoint(self, *a):
        p = a[0] if len(a) == 1 else QPointF(a[0], a[1])
        self.ops.append(["point", p.x(), p.y()])

    def drawRect(self, *a):
        self.ops.append(["rect"] + self._rect(a))

    def drawRects(self, rects):
        for r in rects:
            self.drawRect(r)

    def drawRoundedRect(self, *a, **k):
        if isinstance(a[0], QRectF):
            r, rx, ry = a[0], a[1], a[2] if len(a) > 2 else a[1]
            box = [r.x(), r.y(), r.width(), r.height()]
        else:
            box, rx, ry = list(a[:4]), a[4], a[5] if len(a) > 5 else a[4]
        self.ops.append(["rrect"] + [float(v) for v in box] +
                        [float(rx), float(ry)])

    def fillRect(self, *a):
        from .QtGui import QBrush, QColor
        fill = a[-1]
        box = self._rect(a[:-1])
        if isinstance(fill, QBrush):
            color = _hex(fill.color()) if fill.style() else None
        elif isinstance(fill, QColor):
            color = _hex(fill)
        elif isinstance(fill, str):
            color = _hex(QColor(fill))
        elif hasattr(fill, "color"):
            color = _hex(fill.color())
        else:
            color = None
        if color:
            self.ops.append(["fill"] + box + [color])

    def eraseRect(self, *a):
        pass

    def drawEllipse(self, *a):
        if len(a) == 3 and isinstance(a[0], QPointF):
            c, rx, ry = a
            self.ops.append(["ellipse", c.x(), c.y(), float(rx), float(ry)])
            return
        x, y, w, h = self._rect(a)
        self.ops.append(["ellipse", x + w / 2, y + h / 2, w / 2, h / 2])

    def drawArc(self, *a):
        r = a[0] if isinstance(a[0], QRectF) else QRectF(*a[:4])
        start, span = (a[1], a[2]) if isinstance(a[0], QRectF) else \
            (a[4], a[5])
        self.ops.append(["arc", r.center().x(), r.center().y(),
                         r.width() / 2, r.height() / 2, start / 16.0,
                         span / 16.0, 0])

    def drawPie(self, *a):
        r = a[0] if isinstance(a[0], QRectF) else QRectF(*a[:4])
        start, span = (a[1], a[2]) if isinstance(a[0], QRectF) else \
            (a[4], a[5])
        self.ops.append(["arc", r.center().x(), r.center().y(),
                         r.width() / 2, r.height() / 2, start / 16.0,
                         span / 16.0, 1])

    drawChord = drawPie

    def _points(self, pts):
        flat = []
        for p in pts:
            if isinstance(p, QPointF):
                flat += [p.x(), p.y()]
            else:
                flat += [float(p[0]), float(p[1])]
        return flat

    def drawPolygon(self, *a, **k):
        pts = a[0] if len(a) == 1 or not isinstance(a[0], QPointF) else a
        self.ops.append(["poly", self._points(pts), 1])

    def drawConvexPolygon(self, *a):
        self.drawPolygon(*a)

    def drawPolyline(self, *a):
        pts = a[0] if len(a) == 1 or not isinstance(a[0], QPointF) else a
        self.ops.append(["poly", self._points(pts), 0])

    def drawPath(self, path):
        subs = [[c for p in s for c in p] for s in path._subs if len(s) >= 2]
        self.ops.append(["path", subs, getattr(path, "_fill_rule", 0), 1])

    def fillPath(self, path, brush):
        from .QtGui import QBrush, QColor
        color = _hex(brush.color()) if isinstance(brush, QBrush) \
            else _hex(QColor(brush))
        subs = [[c for p in s for c in p] for s in path._subs if len(s) >= 2]
        self.ops.append(["fillpath", subs, getattr(path, "_fill_rule", 0),
                         color])

    def strokePath(self, path, pen):
        self.save()
        self.setPen(pen)
        subs = [[c for p in s for c in p] for s in path._subs if len(s) >= 2]
        self.ops.append(["path", subs, 0, 0])
        self.restore()

    def drawText(self, *a):
        """(x, y, text) | (QPointF, text) | (rect, flags, text) |
        (x, y, w, h, flags, text)."""
        if len(a) == 2 and isinstance(a[0], QPointF):
            self.ops.append(["text", a[0].x(), a[0].y(), str(a[1])])
        elif len(a) == 3 and not isinstance(a[0], QRectF):
            self.ops.append(["text", float(a[0]), float(a[1]), str(a[2])])
        elif len(a) >= 3 and isinstance(a[0], QRectF):
            r = a[0]
            self.ops.append(["textr", r.x(), r.y(), r.width(), r.height(),
                             int(a[1]) if isinstance(a[1], int) else 0,
                             str(a[2])])
        elif len(a) >= 6:
            self.ops.append(["textr"] + [float(v) for v in a[:4]] +
                            [int(a[4]), str(a[5])])

    def drawStaticText(self, *a):
        pass

    def drawImage(self, *a):
        pass

    def drawPixmap(self, *a):
        pass

    def drawTiledPixmap(self, *a):
        pass

    def boundingRect(self, *a):
        return QRectF()


class QStyleOptionGraphicsItem(Inert):
    def __init__(self, *a):
        self.state = 0
        self.exposedRect = QRectF()
        self.rect = QRectF()


def record(fn, *args):
    """Run *fn(painter, *args)* and return its commands."""
    p = QPainter()
    p._active = True
    try:
        fn(p, *args)
    except Exception as exc:              # a paint must never break a reply
        p.ops.append(["error", f"{type(exc).__name__}: {exc}"])
    return p.ops
