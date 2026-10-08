"""PyQt5.QtGui stand-in (see _core.py).

Real enough where the model needs it: QColor parses and converts
colours, and QFont / QFontMetricsF / QPainterPath lay text out (glyph
outlines from the bundled Liberation Sans through fontTools) so the
built-in preview of a text node has its letters, as on the desktop where
Qt draws them. Everything else is inert.
"""
import colorsys
import math

from ._core import Inert, Lenient, QPointF, QRectF, inert_class

# ------------------------------------------------------------------ QColor

_NAMED = {
    "black": "#000000", "white": "#ffffff", "red": "#ff0000",
    "green": "#008000", "blue": "#0000ff", "yellow": "#ffff00",
    "cyan": "#00ffff", "magenta": "#ff00ff", "gray": "#808080",
    "grey": "#808080", "darkgray": "#a9a9a9", "darkgrey": "#a9a9a9",
    "lightgray": "#d3d3d3", "lightgrey": "#d3d3d3", "orange": "#ffa500",
    "purple": "#800080", "brown": "#a52a2a", "pink": "#ffc0cb",
    "silver": "#c0c0c0", "gold": "#ffd700", "navy": "#000080",
    "teal": "#008080", "olive": "#808000", "maroon": "#800000",
    "lime": "#00ff00", "aqua": "#00ffff", "fuchsia": "#ff00ff",
    "transparent": "#00000000",
}


def _named_colors():
    try:
        from khervecad import scadcolors          # optional, if present
        return getattr(scadcolors, "NAMED", {})
    except Exception:
        return {}


class QColor(Lenient):
    def __init__(self, *a):
        self._valid = True
        self._r = self._g = self._b = 0
        self._a = 255
        if not a:
            self._valid = False
            return
        if len(a) == 1:
            v = a[0]
            if isinstance(v, QColor):
                self._r, self._g, self._b, self._a = v._r, v._g, v._b, v._a
                self._valid = v._valid
                return
            if isinstance(v, int):
                self._r, self._g, self._b = (v >> 16) & 255, (v >> 8) & 255, \
                    v & 255
                return
            self.setNamedColor(str(v))
            return
        vals = [int(x) for x in a[:4]]
        self._r, self._g, self._b = vals[:3]
        if len(vals) > 3:
            self._a = vals[3]

    def setNamedColor(self, text):
        t = text.strip().lower()
        t = _NAMED.get(t, None) or _named_colors().get(t, None) or t
        if t.startswith("#"):
            h = t[1:]
            try:
                if len(h) == 3:
                    self._r, self._g, self._b = (int(c * 2, 16) for c in h)
                    self._a = 255
                elif len(h) == 6:
                    self._r, self._g, self._b = (int(h[i:i + 2], 16)
                                                 for i in (0, 2, 4))
                    self._a = 255
                elif len(h) == 8:
                    # Qt reads #AARRGGBB; the KherveCAD code writes #RRGGBB
                    self._a, self._r, self._g, self._b = (
                        int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
                else:
                    self._valid = False
                    return
                self._valid = True
                return
            except ValueError:
                pass
        self._valid = False

    @staticmethod
    def isValidColor(text):
        return QColor(text).isValid()

    def isValid(self):
        return self._valid

    def name(self, *_fmt):
        return "#%02x%02x%02x" % (self._r, self._g, self._b)

    def red(self):
        return self._r

    def green(self):
        return self._g

    def blue(self):
        return self._b

    def alpha(self):
        return self._a

    def redF(self):
        return self._r / 255.0

    def greenF(self):
        return self._g / 255.0

    def blueF(self):
        return self._b / 255.0

    def alphaF(self):
        return self._a / 255.0

    def setAlpha(self, a):
        self._a = int(a)

    def setAlphaF(self, a):
        self._a = int(round(float(a) * 255))

    def setRgb(self, r, g, b, a=255):
        self._r, self._g, self._b, self._a = int(r), int(g), int(b), int(a)
        self._valid = True

    def setRgbF(self, r, g, b, a=1.0):
        self.setRgb(r * 255, g * 255, b * 255, a * 255)

    def getRgb(self):
        return self._r, self._g, self._b, self._a

    def getRgbF(self):
        return self.redF(), self.greenF(), self.blueF(), self.alphaF()

    def rgb(self):
        return (0xff << 24) | (self._r << 16) | (self._g << 8) | self._b

    def getHsvF(self):
        h, s, v = colorsys.rgb_to_hsv(self.redF(), self.greenF(),
                                      self.blueF())
        return (h if s > 0 else -1.0), s, v, self.alphaF()

    def getHslF(self):
        h, l, s = colorsys.rgb_to_hls(self.redF(), self.greenF(),
                                      self.blueF())
        return (h if s > 0 else -1.0), s, l, self.alphaF()

    def hueF(self):
        return self.getHsvF()[0]

    def saturationF(self):
        return self.getHsvF()[1]

    def valueF(self):
        return self.getHsvF()[2]

    def lightnessF(self):
        return self.getHslF()[2]

    def lightness(self):
        return int(round(self.lightnessF() * 255))

    @staticmethod
    def fromHsvF(h, s, v, a=1.0):
        r, g, b = colorsys.hsv_to_rgb(max(h, 0.0), s, v)
        c = QColor()
        c.setRgbF(r, g, b, a)
        return c

    @staticmethod
    def fromHslF(h, s, l, a=1.0):
        r, g, b = colorsys.hls_to_rgb(max(h, 0.0), l, s)
        c = QColor()
        c.setRgbF(r, g, b, a)
        return c

    @staticmethod
    def fromRgbF(r, g, b, a=1.0):
        c = QColor()
        c.setRgbF(r, g, b, a)
        return c

    @staticmethod
    def fromRgb(r, g, b, a=255):
        c = QColor()
        c.setRgb(r, g, b, a)
        return c

    def lighter(self, factor=150):
        h, s, v, a = self.getHsvF()
        return QColor.fromHsvF(h, s, min(1.0, v * factor / 100.0), a)

    def darker(self, factor=200):
        h, s, v, a = self.getHsvF()
        return QColor.fromHsvF(h, s, v * 100.0 / factor, a)

    def __eq__(self, o):
        return isinstance(o, QColor) and o.getRgb() == self.getRgb() and \
            o._valid == self._valid

    def __hash__(self):
        return hash(self.getRgb())

    def __repr__(self):
        return f"QColor({self.name()})"


# ---------------------------------------------------------------- text

#: Qt's logical DPI on Windows, where the desktop app is mostly used:
#: a 100 pt QFont is 133.3 px — the size the preview's text is laid out at
DPI = 96.0


class QFont(Lenient):
    Bold = 75
    Normal = 50
    PercentageSpacing = 0
    AbsoluteSpacing = 1
    Monospace = 7
    TypeWriter = 7

    def __init__(self, family="", size=-1, *a):
        if isinstance(family, QFont):
            self.__dict__.update(family.__dict__)
            return
        self._family = family or ""
        self._mono = any(k in self._family.lower() for k in
                         ("consolas", "courier", "mono", "menlo"))
        self._pt = float(size) if size and size > 0 else 12.0
        self._bold = False
        self._italic = False
        self._spacing = 100.0

    def family(self):
        return self._family

    def setFamily(self, f):
        self._family = f

    def setPointSizeF(self, s):
        self._pt = float(s)

    def setPointSize(self, s):
        self._pt = float(s)

    def pointSizeF(self):
        return self._pt

    def pointSize(self):
        return int(self._pt)

    def setPixelSize(self, px):
        self._pt = float(px) * 72.0 / DPI

    def setBold(self, on):
        self._bold = bool(on)

    def bold(self):
        return self._bold

    def setItalic(self, on):
        self._italic = bool(on)

    def italic(self):
        return self._italic

    def setWeight(self, w):
        self._bold = int(w) >= 63

    def setLetterSpacing(self, kind, value):
        if kind == QFont.PercentageSpacing:
            self._spacing = float(value)

    def setStyleHint(self, hint, *_a):
        if hint in (QFont.Monospace, QFont.TypeWriter):
            self._mono = True

    def setUnderline(self, *_a):
        pass

    def setFixedPitch(self, on):
        self._mono = bool(on)

    def _px(self):
        return self._pt * DPI / 72.0


def _face(font):
    from kcweb import fonts
    return fonts.face(font.family(), font.bold(), font.italic())


class QFontMetricsF(Lenient):
    def __init__(self, font, *_a):
        self._font = QFont(font) if isinstance(font, QFont) else QFont()

    def _scale(self):
        return self._font._px() / _face(self._font).units_per_em

    def height(self):
        f = _face(self._font)
        return (f.ascent - f.descent) * self._scale()

    def ascent(self):
        return _face(self._font).ascent * self._scale()

    def descent(self):
        return -_face(self._font).descent * self._scale()

    def horizontalAdvance(self, text, *_a):
        f = _face(self._font)
        spacing = self._font._spacing / 100.0
        return sum(f.advance(ch) for ch in str(text)) * self._scale() * \
            spacing

    width = horizontalAdvance

    def boundingRect(self, text, *_a):
        return QRectF(0, -self.ascent(), self.horizontalAdvance(text),
                      self.height())


QFontMetrics = QFontMetricsF


class QPainterPath(Lenient):
    """Polylines only (curves are flattened as they are added): what the
    preview's text and outline code read back with toSubpathPolygons()."""

    def __init__(self, *a):
        self._subs = []         # [[(x, y)]]
        if a and isinstance(a[0], QPointF):
            self._subs.append([(a[0].x(), a[0].y())])

    def moveTo(self, x, y=None):
        if isinstance(x, QPointF):
            x, y = x.x(), x.y()
        self._subs.append([(float(x), float(y))])

    def lineTo(self, x, y=None):
        if isinstance(x, QPointF):
            x, y = x.x(), x.y()
        if not self._subs:
            self._subs.append([(0.0, 0.0)])
        self._subs[-1].append((float(x), float(y)))

    def closeSubpath(self):
        if self._subs and len(self._subs[-1]) > 1 and \
                self._subs[-1][0] != self._subs[-1][-1]:
            self._subs[-1].append(self._subs[-1][0])

    def addPolygon(self, poly):
        pts = [(p.x(), p.y()) for p in poly]
        if pts:
            self._subs.append(pts)

    def addRect(self, *a):
        r = a[0] if len(a) == 1 else QRectF(*a)
        x0, y0, x1, y1 = r.left(), r.top(), r.right(), r.bottom()
        self._subs.append([(x0, y0), (x1, y0), (x1, y1), (x0, y1),
                           (x0, y0)])

    def addEllipse(self, *a):
        if len(a) == 1:
            r = a[0]
        elif len(a) == 3:
            c, rx, ry = a
            r = QRectF(c.x() - rx, c.y() - ry, 2 * rx, 2 * ry)
        else:
            r = QRectF(*a)
        cx, cy = r.center().x(), r.center().y()
        rx, ry = r.width() / 2, r.height() / 2
        n = 48
        self._subs.append([(cx + rx * math.cos(2 * math.pi * i / n),
                            cy + ry * math.sin(2 * math.pi * i / n))
                           for i in range(n + 1)])

    def addText(self, x, y, font=None, text=None):
        if isinstance(x, QPointF):
            x, y, font, text = x.x(), x.y(), y, font
        f = _face(font)
        px = font._px()
        scale = px / f.units_per_em
        spacing = font._spacing / 100.0
        pen_x = float(x)
        for ch in str(text):
            for contour in f.contours(ch):
                self._subs.append([(pen_x + gx * scale, float(y) - gy * scale)
                                   for gx, gy in contour])
            pen_x += f.advance(ch) * scale * spacing

    def addPath(self, other):
        self._subs.extend([list(s) for s in other._subs])

    def translate(self, dx, dy=None):
        if isinstance(dx, QPointF):
            dx, dy = dx.x(), dx.y()
        self._subs = [[(x + dx, y + dy) for x, y in s] for s in self._subs]

    def translated(self, dx, dy=None):
        out = QPainterPath()
        out._subs = [list(s) for s in self._subs]
        out.translate(dx, dy)
        return out

    def boundingRect(self):
        pts = [p for s in self._subs for p in s]
        if not pts:
            return QRectF()
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return QRectF(min(xs), min(ys), max(xs) - min(xs),
                      max(ys) - min(ys))

    controlPointRect = boundingRect

    def isEmpty(self):
        return not any(len(s) > 1 for s in self._subs)

    def toSubpathPolygons(self, *_a):
        return [[QPointF(x, y) for x, y in s] for s in self._subs
                if len(s) > 1]

    def toFillPolygons(self, *_a):
        return self.toSubpathPolygons()

    def simplified(self):
        return self

    def setFillRule(self, rule):
        # Qt.OddEvenFill = 0, Qt.WindingFill = 1
        self._fill_rule = int(rule)

    def fillRule(self):
        return getattr(self, "_fill_rule", 0)

    def __mul__(self, transform):
        return transform.map(self)

    def united(self, other):
        out = QPainterPath()
        out._subs = [list(s) for s in self._subs + other._subs]
        return out

    def contains(self, p):
        from ._graphics import _in_poly
        if isinstance(p, QPointF):
            n = sum(1 for s in self._subs if len(s) >= 3
                    and _in_poly(p.x(), p.y(), s))
            return n % 2 == 1
        return False

    def currentPosition(self):
        if self._subs and self._subs[-1]:
            x, y = self._subs[-1][-1]
            return QPointF(x, y)
        return QPointF()

    def quadTo(self, c, e, *more):
        if not isinstance(c, QPointF):
            c, e = QPointF(c, e), QPointF(*more)
        p0 = self.currentPosition()
        for i in range(1, 9):
            t = i / 8
            a, b, d = (1 - t) ** 2, 2 * (1 - t) * t, t * t
            self.lineTo(a * p0.x() + b * c.x() + d * e.x(),
                        a * p0.y() + b * c.y() + d * e.y())

    def cubicTo(self, c1, c2, e, *more):
        if not isinstance(c1, QPointF):
            vals = (c1, c2, e) + more
            c1, c2, e = (QPointF(vals[0], vals[1]), QPointF(vals[2], vals[3]),
                         QPointF(vals[4], vals[5]))
        p0 = self.currentPosition()
        for i in range(1, 13):
            t = i / 12
            a, b = (1 - t) ** 3, 3 * (1 - t) ** 2 * t
            c, d = 3 * (1 - t) * t * t, t ** 3
            self.lineTo(a * p0.x() + b * c1.x() + c * c2.x() + d * e.x(),
                        a * p0.y() + b * c1.y() + c * c2.y() + d * e.y())

    def arcMoveTo(self, rect, angle):
        cx, cy = rect.center().x(), rect.center().y()
        rx, ry = rect.width() / 2, rect.height() / 2
        a = math.radians(angle)
        self.moveTo(cx + rx * math.cos(a), cy - ry * math.sin(a))

    def arcTo(self, rect, start, sweep, *more):
        if not isinstance(rect, QRectF):
            rect = QRectF(rect, start, sweep, more[0])
            start, sweep = more[1], more[2]
        cx, cy = rect.center().x(), rect.center().y()
        rx, ry = rect.width() / 2, rect.height() / 2
        n = max(4, int(abs(sweep) / 6))
        for i in range(n + 1):
            a = math.radians(start + sweep * i / n)
            self.lineTo(cx + rx * math.cos(a), cy - ry * math.sin(a))

    def addRoundedRect(self, rect, *a):
        self.addRect(rect)

    def length(self):
        total = 0.0
        for s in self._subs:
            for (x0, y0), (x1, y1) in zip(s, s[1:]):
                total += math.hypot(x1 - x0, y1 - y0)
        return total

    def elementCount(self):
        return sum(len(s) for s in self._subs)


class QPolygonF(list, Lenient):
    def __init__(self, pts=()):
        super().__init__(QPointF(p) if not isinstance(p, QPointF) else p
                         for p in pts)

    def append(self, p):
        super().append(p)

    def count(self, *a):
        return len(self)

    def boundingRect(self):
        if not self:
            return QRectF()
        xs = [p.x() for p in self]
        ys = [p.y() for p in self]
        return QRectF(min(xs), min(ys), max(xs) - min(xs),
                      max(ys) - min(ys))


from ._widgets import QIcon, QKeySequence  # noqa: E402,F401
from ._painter import QPainter  # noqa: E402,F401
from ._graphics import QTransform  # noqa: E402,F401

NO_PEN, SOLID = 0, 1


class QPen(Lenient):
    """Colour, width, cosmetic flag and style — what the sketch view's
    items are drawn with."""

    def __init__(self, *a):
        self._color = QColor("#000000")
        self._width = 1.0
        self._cosmetic = False
        self._style = SOLID
        self._cap = 0x10
        for x in a:
            if isinstance(x, QPen):
                self.__dict__.update(x.__dict__)
                self._color = QColor(x._color)
            elif isinstance(x, QColor):
                self._color = QColor(x)
            elif isinstance(x, str):
                self._color = QColor(x)
            elif isinstance(x, QBrush):
                self._color = QColor(x.color())
            elif isinstance(x, float):
                self._width = x
            elif isinstance(x, int) and not isinstance(x, bool):
                if x == NO_PEN and len(a) == 1:
                    self._style = NO_PEN
                else:
                    self._width = float(x)

    def color(self):
        return QColor(self._color)

    def setColor(self, c):
        self._color = QColor(c)

    def width(self):
        return int(self._width)

    def widthF(self):
        return self._width

    def setWidth(self, w):
        self._width = float(w)

    setWidthF = setWidth

    def isCosmetic(self):
        return self._cosmetic or self._width == 0

    def setCosmetic(self, on):
        self._cosmetic = bool(on)

    def style(self):
        return self._style

    def setStyle(self, s):
        self._style = int(s)

    def setCapStyle(self, cap):
        self._cap = int(cap)

    def capStyle(self):
        return self._cap

    def setJoinStyle(self, *a):
        pass

    def setDashPattern(self, pattern):
        self._style = 2
        self._dash = list(pattern)

    def setBrush(self, b):
        self._color = QColor(b.color())

    def brush(self):
        return QBrush(self._color)


class QBrush(Lenient):
    def __init__(self, *a):
        self._color = None
        self._style = 0
        for x in a:
            if isinstance(x, QBrush):
                self._color, self._style = x._color, x._style
            elif isinstance(x, QColor):
                self._color, self._style = QColor(x), 1
            elif isinstance(x, str):
                self._color, self._style = QColor(x), 1
            elif isinstance(x, int) and not isinstance(x, bool):
                if self._color is None and x in (0, 1):
                    self._style = x
                    if x == 1:
                        self._color = QColor("#000000")
                elif self._color is None:
                    self._color, self._style = QColor(x), 1
            elif hasattr(x, "setColorAt"):          # a gradient
                self._color, self._style = getattr(x, "_first", None), 1

    def color(self):
        return QColor(self._color) if self._color is not None else QColor(0, 0, 0)

    def setColor(self, c):
        self._color = QColor(c)
        if not self._style:
            self._style = 1

    def style(self):
        return self._style

    def setStyle(self, s):
        self._style = int(s)


#: URLs the desktop asked the system to open (the web side opens them)
OPENED_URLS = []


class QDesktopServices(Inert):
    @staticmethod
    def openUrl(url):
        OPENED_URLS.append(url.toString() if hasattr(url, "toString")
                           and not isinstance(url, str) else str(url))
        return True


class QPalette(Lenient):
    """The theme's colours (khervecad.style tokens), as Qt roles."""
    Window, WindowText, Base, AlternateBase, ToolTipBase, ToolTipText, \
        Text, Button, ButtonText, BrightText, Highlight, \
        HighlightedText, Link, Mid, Dark, Light, Shadow, Midlight, \
        PlaceholderText = range(19)
    Active, Inactive, Disabled = 0, 1, 2

    _ROLE = {0: "window", 1: "text", 2: "card", 3: "editor", 4: "card",
             5: "text", 6: "text", 7: "chrome", 8: "text", 9: "text",
             10: "select", 11: "card", 12: "select", 13: "border",
             14: "border", 15: "card", 16: "border", 17: "chrome",
             18: "border"}

    def _token(self, role):
        try:
            from khervecad.style import tokens
            return tokens().get(self._ROLE.get(int(role), "window"),
                                "#808080")
        except Exception:
            return "#808080"

    def color(self, *a):
        role = a[-1] if a else 0
        return QColor(self._token(role))

    def brush(self, *a):
        return QBrush(self.color(*a))

    def setColor(self, *a):
        pass

    def setBrush(self, *a):
        pass

    def window(self):
        return self.brush(0)

    def base(self):
        return self.brush(2)

    def text(self):
        return self.brush(6)

    def windowText(self):
        return self.brush(1)

    def button(self):
        return self.brush(7)

    def buttonText(self):
        return self.brush(8)

    def highlight(self):
        return self.brush(10)

    def highlightedText(self):
        return self.brush(11)

    def mid(self):
        return self.brush(13)

    def dark(self):
        return self.brush(14)

    def light(self):
        return self.brush(15)

    def alternateBase(self):
        return self.brush(3)

    def placeholderText(self):
        return self.brush(18)


class QLinearGradient(Inert):
    def __init__(self, *a):
        self._first = None

    def setColorAt(self, pos, color):
        if self._first is None:
            self._first = QColor(color)


QRadialGradient = QLinearGradient
QConicalGradient = QLinearGradient


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return inert_class(name)
