"""Headless QGraphicsScene / QGraphicsView / QGraphicsItem.

The 2D sketch view of KherveCAD is a QGraphicsScene subclass full of
logic: which shapes to show for the selection, handles, drawing tools,
snapping, dragging a part into place. This runs that code as it is:
items keep their geometry, flags and selection, the scene dispatches
mouse events the way Qt does (press selects, drag moves movable items,
handles grab the mouse, empty space starts a rubber band), and the view
keeps a zoom and centre. The web side draws the items
(kcweb.sketch.serialize) and feeds mouse events in.

Only what the sketch uses is modelled: translation (no rotated items),
cosmetic pens, ignore-transformation handles.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import math

from ._core import Inert, InertObject, Lenient, QObject, QPointF, \
    QRectF, pyqtSignal
from ._widgets import KcBase, QWidget


# --------------------------------------------------------------- transform

class QTransform(Lenient):
    """2D affine: x' = m11 x + m21 y + dx ; y' = m12 x + m22 y + dy."""

    def __init__(self, m11=1.0, m12=0.0, m21=0.0, m22=1.0, dx=0.0,
                 dy=0.0, *rest):
        if isinstance(m11, QTransform):
            o = m11
            m11, m12, m21, m22, dx, dy = o._m
        if rest:                       # the 9-argument form
            m11, m12, _m13, m21, m22, _m23, dx, dy = (m11, m12, m21, m22,
                                                      dx, dy) + rest[:2]
        self._m = [float(m11), float(m12), float(m21), float(m22),
                   float(dx), float(dy)]

    def m11(self):
        return self._m[0]

    def m12(self):
        return self._m[1]

    def m21(self):
        return self._m[2]

    def m22(self):
        return self._m[3]

    def dx(self):
        return self._m[4]

    def dy(self):
        return self._m[5]

    m31 = dx
    m32 = dy

    def map(self, *a):
        if len(a) == 2:
            x, y = a
            m = self._m
            return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
        p = a[0]
        if isinstance(p, QPointF):
            x, y = self.map(p.x(), p.y())
            return QPointF(x, y)
        from .QtGui import QPainterPath, QPolygonF
        if isinstance(p, QPainterPath):
            out = QPainterPath()
            out._subs = [[self.map(x, y) for x, y in s] for s in p._subs]
            return out
        if isinstance(p, (QPolygonF, list)):
            return QPolygonF([self.map(q) for q in p])
        if isinstance(p, QRectF):
            return self.mapRect(p)
        return p

    def mapRect(self, r):
        pts = [self.map(r.left(), r.top()), self.map(r.right(), r.top()),
               self.map(r.left(), r.bottom()),
               self.map(r.right(), r.bottom())]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return QRectF(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    def __mul__(self, o):
        a, b = self._m, o._m
        return QTransform(
            a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5])

    def __rmul__(self, other):
        from .QtGui import QPainterPath
        if isinstance(other, QPainterPath):
            return self.map(other)
        return NotImplemented

    def scale(self, sx, sy):
        self._m = (QTransform(sx, 0, 0, sy, 0, 0) * self)._m
        return self

    def translate(self, dx, dy):
        self._m = (QTransform(1, 0, 0, 1, dx, dy) * self)._m
        return self

    def rotate(self, deg, *_a):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        self._m = (QTransform(c, s, -s, c, 0, 0) * self)._m
        return self

    def inverted(self):
        m11, m12, m21, m22, dx, dy = self._m
        det = m11 * m22 - m12 * m21
        if abs(det) < 1e-15:
            return QTransform(), False
        i11, i12 = m22 / det, -m12 / det
        i21, i22 = -m21 / det, m11 / det
        return QTransform(i11, i12, i21, i22,
                          -(dx * i11 + dy * i21),
                          -(dx * i12 + dy * i22)), True

    def isIdentity(self):
        return self._m == [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]

    @staticmethod
    def fromScale(sx, sy):
        return QTransform(sx, 0, 0, sy, 0, 0)

    @staticmethod
    def fromTranslate(dx, dy):
        return QTransform(1, 0, 0, 1, dx, dy)


# ------------------------------------------------------------------- items

class QGraphicsItem(Inert, KcBase):
    ItemIsMovable = 0x1
    ItemIsSelectable = 0x2
    ItemIsFocusable = 0x4
    ItemIgnoresTransformations = 0x20
    ItemSendsGeometryChanges = 0x800
    ItemSendsScenePositionChanges = 0x10000
    ItemPositionChange = 0
    ItemSelectedChange = 4
    ItemVisibleChange = 2
    ItemPositionHasChanged = 9
    ItemSelectedHasChanged = 14
    ItemVisibleHasChanged = 12
    ItemSceneChange = 11
    ItemTransformChange = 8
    NoCache = 0
    ItemCoordinateCache = 1
    DeviceCoordinateCache = 2
    Type = 1
    UserType = 65536

    def __init__(self, *args, **kwargs):
        self._kc_init()
        self._g_parent = None
        self._g_children = []
        self._g_pos = QPointF(0, 0)
        self._g_z = 0.0
        self._g_flags = 0
        self._g_selected = False
        self._g_visible = True
        self._g_enabled = True
        self._g_scene = None
        self._g_cursor = 0
        self._g_tip = ""
        self._g_data = {}
        self._g_opacity = 1.0
        self._g_xform = None
        self._g_buttons = 7
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        if parent is not None:
            self.setParentItem(parent)

    def __bool__(self):
        return True

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)

    # -- tree
    def setParentItem(self, parent):
        if self._g_parent is not None and self in self._g_parent._g_children:
            self._g_parent._g_children.remove(self)
        self._g_parent = parent
        if parent is not None:
            parent._g_children.append(self)
            if parent._g_scene is not None:
                parent._g_scene._kc_attach(self)
        self._touch()

    def parentItem(self):
        return self._g_parent

    def childItems(self):
        return list(self._g_children)

    def topLevelItem(self):
        it = self
        while it._g_parent is not None:
            it = it._g_parent
        return it

    def scene(self):
        return self._g_scene

    # -- position
    def pos(self):
        return QPointF(self._g_pos)

    def x(self):
        return self._g_pos.x()

    def y(self):
        return self._g_pos.y()

    def setPos(self, x, y=None):
        new = QPointF(x, y) if y is not None else QPointF(x)
        sends = self._g_flags & self.ItemSendsGeometryChanges
        if sends and self._g_scene is not None:
            new = self.itemChange(self.ItemPositionChange, new)
            if not isinstance(new, QPointF):
                new = QPointF(new)
        if new == self._g_pos:
            return
        self._g_pos = new
        self._touch()
        if sends and self._g_scene is not None:
            self.itemChange(self.ItemPositionHasChanged, QPointF(new))

    def setX(self, x):
        self.setPos(x, self._g_pos.y())

    def setY(self, y):
        self.setPos(self._g_pos.x(), y)

    def moveBy(self, dx, dy):
        self.setPos(self._g_pos.x() + dx, self._g_pos.y() + dy)

    def scenePos(self):
        p = QPointF(self._g_pos)
        it = self._g_parent
        while it is not None:
            p = p + it._g_pos
            it = it._g_parent
        return p

    def mapToScene(self, *a):
        sp = self.scenePos()
        if len(a) == 2 and not isinstance(a[0], QPointF):
            return QPointF(a[0] + sp.x(), a[1] + sp.y())
        p = a[0]
        if isinstance(p, QRectF):
            return p.translated(sp.x(), sp.y())
        if isinstance(p, QPointF):
            return QPointF(p.x() + sp.x(), p.y() + sp.y())
        from .QtGui import QPolygonF, QPainterPath
        if isinstance(p, QPainterPath):
            return p.translated(sp.x(), sp.y())
        return QPolygonF([QPointF(q.x() + sp.x(), q.y() + sp.y())
                          for q in p])

    def mapFromScene(self, *a):
        sp = self.scenePos()
        if len(a) == 2:
            return QPointF(a[0] - sp.x(), a[1] - sp.y())
        p = a[0]
        if isinstance(p, QPointF):
            return QPointF(p.x() - sp.x(), p.y() - sp.y())
        return p

    def mapToParent(self, p):
        return p + self._g_pos

    def setTransform(self, t, *_a):
        self._g_xform = t
        self._touch()

    def transform(self):
        return self._g_xform or QTransform()

    def setRotation(self, *a):
        pass

    def setScale(self, *a):
        pass

    # -- geometry (subclasses)
    def boundingRect(self):
        return QRectF()

    def sceneBoundingRect(self):
        r = self.boundingRect()
        sp = self.scenePos()
        if self._g_flags & self.ItemIgnoresTransformations:
            return QRectF(sp.x(), sp.y(), 0, 0)
        return r.translated(sp.x(), sp.y())

    def shape(self):
        from .QtGui import QPainterPath
        path = QPainterPath()
        path.addRect(self.boundingRect())
        return path

    def _kc_hit(self, local, tol):
        r = self.boundingRect()
        return r.adjusted(-tol, -tol, tol, tol).contains(local)

    # -- flags & state
    def setFlag(self, flag, on=True):
        if on:
            self._g_flags |= int(flag)
        else:
            self._g_flags &= ~int(flag)

    def setFlags(self, flags):
        self._g_flags = int(flags)

    def flags(self):
        return self._g_flags

    def setSelected(self, on):
        on = bool(on)
        if not self._g_flags & self.ItemIsSelectable and on:
            return
        if on == self._g_selected:
            return
        value = self.itemChange(self.ItemSelectedChange, on)
        self._g_selected = bool(value)
        self._touch()
        self.itemChange(self.ItemSelectedHasChanged, self._g_selected)
        if self._g_scene is not None:
            self._g_scene._kc_selection_changed()

    def isSelected(self):
        return self._g_selected

    def setVisible(self, on):
        self._g_visible = bool(on)
        self._touch()

    def isVisible(self):
        it = self
        while it is not None:
            if not it._g_visible:
                return False
            it = it._g_parent
        return True

    def show(self):
        self.setVisible(True)

    def hide(self):
        self.setVisible(False)

    def setEnabled(self, on):
        self._g_enabled = bool(on)

    def isEnabled(self):
        return self._g_enabled

    def setZValue(self, z):
        self._g_z = float(z)
        self._touch()

    def zValue(self):
        return self._g_z

    def setOpacity(self, o):
        self._g_opacity = float(o)
        self._touch()

    def opacity(self):
        return self._g_opacity

    def setCursor(self, cursor):
        self._g_cursor = int(cursor) if isinstance(cursor, int) else 0

    def cursor(self):
        return self._g_cursor

    def unsetCursor(self):
        self._g_cursor = 0

    def setToolTip(self, tip):
        self._g_tip = str(tip or "")

    def toolTip(self):
        return self._g_tip

    def setData(self, key, value):
        self._g_data[key] = value

    def data(self, key):
        return self._g_data.get(key)

    def setAcceptedMouseButtons(self, buttons):
        self._g_buttons = int(buttons)

    def acceptedMouseButtons(self):
        return self._g_buttons

    def setAcceptHoverEvents(self, *a):
        pass

    def setCacheMode(self, *a):
        pass

    def setGraphicsEffect(self, *a):
        pass

    def update(self, *a):
        self._touch()

    def prepareGeometryChange(self):
        self._touch()

    def itemChange(self, change, value):
        return value

    def type(self):
        return self.Type

    # -- default mouse handling (Qt's: select on press, drag to move)
    def mousePressEvent(self, event):
        scene = self._g_scene
        if self._g_flags & self.ItemIsSelectable:
            multi = bool(event.modifiers() & 0x04000000)   # Ctrl
            if multi:
                self._kc_ctrl_pending = True
            elif not self._g_selected:
                if scene is not None:
                    scene._kc_clear_selection(except_item=self)
                self.setSelected(True)
        if not (self._g_flags & (self.ItemIsMovable
                                 | self.ItemIsSelectable)):
            event.ignore()
            return
        event.accept()

    def mouseMoveEvent(self, event):
        if not event.buttons() & 1:
            return
        scene = self._g_scene
        if scene is None:
            return
        delta = event.scenePos() - event.lastScenePos()
        movers = [it for it in scene.selectedItems()
                  if it._g_flags & it.ItemIsMovable] \
            if self._g_selected else \
            ([self] if self._g_flags & self.ItemIsMovable else [])
        for it in movers:
            # a child whose ancestor also moves rides along with it
            anc = it._g_parent
            skip = False
            while anc is not None:
                if anc in movers:
                    skip = True
                    break
                anc = anc._g_parent
            if not skip:
                it._kc_drag_moved = True
                it.setPos(it._kc_drag_origin + (event.scenePos()
                                                - event.buttonDownScenePos())
                          if hasattr(it, "_kc_drag_origin")
                          else it.pos() + delta)

    def mouseReleaseEvent(self, event):
        if getattr(self, "_kc_ctrl_pending", False):
            self._kc_ctrl_pending = False
            if not getattr(self, "_kc_drag_moved", False):
                self.setSelected(not self._g_selected)
        self._kc_drag_moved = False

    def mouseDoubleClickEvent(self, event):
        self.mousePressEvent(event)

    def hoverEnterEvent(self, event):
        pass

    def hoverLeaveEvent(self, event):
        pass

    def hoverMoveEvent(self, event):
        pass

    def contextMenuEvent(self, event):
        event.ignore()

    def paint(self, *a):
        pass


def _pen_props(pen):
    """(colour, width, cosmetic, cap, style) of a QPen stand-in."""
    if pen is None:
        return None
    return pen


class QAbstractGraphicsShapeItem(QGraphicsItem):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        from .QtGui import QPen, QBrush
        self._g_pen = QPen()
        self._g_brush = QBrush()

    def setPen(self, pen):
        self._g_pen = pen
        self._touch()

    def pen(self):
        return self._g_pen

    def setBrush(self, brush):
        self._g_brush = brush
        self._touch()

    def brush(self):
        return self._g_brush

    def _kc_select_frame(self, painter):
        """Qt's dashed frame round a selected standard item."""
        if self._g_selected:
            from .QtGui import QPen, QColor
            pen = QPen(QColor(128, 128, 128))
            pen.setCosmetic(True)
            pen.setStyle(2)
            painter.setPen(pen)
            painter.setBrush(0)
            painter.drawRect(self.boundingRect())

    def paint(self, painter, option=None, widget=None):
        painter.setPen(self._g_pen)
        painter.setBrush(self._g_brush)
        self._kc_draw(painter)
        self._kc_select_frame(painter)

    def _kc_draw(self, painter):
        pass


class QGraphicsLineItem(QAbstractGraphicsShapeItem):
    Type = 6

    def __init__(self, *args, **kwargs):
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        super().__init__(parent)
        self._g_line = QLineF(*nums) if len(nums) == 4 else QLineF()

    def setLine(self, *a):
        self._g_line = a[0] if len(a) == 1 else QLineF(*a)
        self._touch()

    def _kc_draw(self, painter):
        painter.drawLine(self._g_line)

    def line(self):
        return QLineF(self._g_line)

    def boundingRect(self):
        p1, p2 = self._g_line.p1(), self._g_line.p2()
        return QRectF(min(p1.x(), p2.x()), min(p1.y(), p2.y()),
                      abs(p2.x() - p1.x()), abs(p2.y() - p1.y()))

    def _kc_hit(self, local, tol):
        a, b = self._g_line.p1(), self._g_line.p2()
        w = getattr(self._g_pen, "_width", 1.0)
        cosmetic = getattr(self._g_pen, "_cosmetic", False)
        reach = tol + (0 if cosmetic else w / 2.0)
        vx, vy = b.x() - a.x(), b.y() - a.y()
        wx, wy = local.x() - a.x(), local.y() - a.y()
        seg2 = vx * vx + vy * vy
        t = 0.0 if seg2 < 1e-12 else max(0.0, min(1.0, (wx * vx + wy * vy)
                                                  / seg2))
        dx, dy = a.x() + t * vx - local.x(), a.y() + t * vy - local.y()
        return math.hypot(dx, dy) <= reach


class QLineF(Lenient):
    def __init__(self, *a):
        if len(a) == 1 and isinstance(a[0], QLineF):
            self._a, self._b = QPointF(a[0]._a), QPointF(a[0]._b)
        elif len(a) == 2:
            self._a, self._b = QPointF(a[0]), QPointF(a[1])
        elif len(a) == 4:
            self._a, self._b = QPointF(a[0], a[1]), QPointF(a[2], a[3])
        else:
            self._a, self._b = QPointF(), QPointF()

    def p1(self):
        return QPointF(self._a)

    def p2(self):
        return QPointF(self._b)

    def x1(self):
        return self._a.x()

    def y1(self):
        return self._a.y()

    def x2(self):
        return self._b.x()

    def y2(self):
        return self._b.y()

    def length(self):
        return math.hypot(self._b.x() - self._a.x(),
                          self._b.y() - self._a.y())

    def dx(self):
        return self._b.x() - self._a.x()

    def dy(self):
        return self._b.y() - self._a.y()

    def angle(self):
        return math.degrees(math.atan2(-(self.dy()), self.dx())) % 360.0

    def setP1(self, p):
        self._a = QPointF(p)

    def setP2(self, p):
        self._b = QPointF(p)

    def pointAt(self, t):
        return QPointF(self._a.x() + t * self.dx(), self._a.y() + t * self.dy())

    def center(self):
        return self.pointAt(0.5)


class QGraphicsRectItem(QAbstractGraphicsShapeItem):
    Type = 3

    def __init__(self, *args, **kwargs):
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        rect = next((a for a in args if isinstance(a, QRectF)), None)
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        super().__init__(parent)
        self._g_rect = rect if rect is not None else \
            (QRectF(*nums) if len(nums) == 4 else QRectF())

    def setRect(self, *a):
        self._g_rect = a[0] if len(a) == 1 else QRectF(*a)
        self._touch()

    def rect(self):
        return QRectF(self._g_rect)

    def boundingRect(self):
        return QRectF(self._g_rect).normalized()

    def _kc_draw(self, painter):
        painter.drawRect(self._g_rect)

    def _kc_hit(self, local, tol):
        return self.boundingRect().adjusted(-tol, -tol, tol, tol) \
            .contains(local)


class QGraphicsEllipseItem(QGraphicsRectItem):
    Type = 4

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._g_start = 0
        self._g_span = 360 * 16

    def setStartAngle(self, a):
        self._g_start = int(a)
        self._touch()

    def setSpanAngle(self, a):
        self._g_span = int(a)
        self._touch()

    def _kc_draw(self, painter):
        if abs(self._g_span) >= 5760:
            painter.drawEllipse(self._g_rect)
        else:
            painter.drawPie(self._g_rect, self._g_start, self._g_span)

    def startAngle(self):
        return self._g_start

    def spanAngle(self):
        return self._g_span

    def _kc_hit(self, local, tol):
        r = self.boundingRect()
        rx, ry = r.width() / 2 + tol, r.height() / 2 + tol
        if rx <= 0 or ry <= 0:
            return False
        c = r.center()
        return ((local.x() - c.x()) / rx) ** 2 + \
            ((local.y() - c.y()) / ry) ** 2 <= 1.0


def _in_poly(x, y, pts):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and \
                x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-30) + xi:
            inside = not inside
        j = i
    return inside


def _winding(x, y, pts):
    wn = 0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if y1 <= y:
            if y2 > y and (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0:
                wn += 1
        elif y2 <= y and (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0:
            wn -= 1
    return wn


class QGraphicsPolygonItem(QAbstractGraphicsShapeItem):
    Type = 5

    def __init__(self, *args, **kwargs):
        from .QtGui import QPolygonF
        poly = next((a for a in args if isinstance(a, (QPolygonF, list))),
                    None)
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        super().__init__(parent)
        self._g_poly = QPolygonF(poly or [])

    def setPolygon(self, poly):
        from .QtGui import QPolygonF
        self._g_poly = QPolygonF(poly)
        self._touch()

    def polygon(self):
        from .QtGui import QPolygonF
        return QPolygonF(self._g_poly)

    def _kc_draw(self, painter):
        painter.drawPolygon(self._g_poly)

    def boundingRect(self):
        return self._g_poly.boundingRect()

    def _kc_hit(self, local, tol):
        pts = [(p.x(), p.y()) for p in self._g_poly]
        if len(pts) < 3:
            return False
        if _in_poly(local.x(), local.y(), pts):
            return True
        return _near_outline(local, pts, tol)


def _near_outline(local, pts, tol):
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        vx, vy = bx - ax, by - ay
        seg2 = vx * vx + vy * vy
        t = 0.0 if seg2 < 1e-12 else max(0.0, min(1.0, (
            (local.x() - ax) * vx + (local.y() - ay) * vy) / seg2))
        if math.hypot(ax + t * vx - local.x(), ay + t * vy - local.y()) \
                <= tol:
            return True
    return False


class QGraphicsPathItem(QAbstractGraphicsShapeItem):
    Type = 2

    def __init__(self, *args, **kwargs):
        from .QtGui import QPainterPath
        path = next((a for a in args if isinstance(a, QPainterPath)), None)
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        super().__init__(parent)
        self._g_path = path if path is not None else QPainterPath()

    def setPath(self, path):
        self._g_path = path
        self._kc_bbox = None
        self._touch()

    def path(self):
        return self._g_path

    def _kc_draw(self, painter):
        painter.drawPath(self._g_path)

    def boundingRect(self):
        box = getattr(self, "_kc_bbox", None)
        if box is None:
            box = self._kc_bbox = self._g_path.boundingRect()
        return QRectF(box)

    def _kc_hit(self, local, tol):
        if not self.boundingRect().adjusted(-tol, -tol, tol, tol) \
                .contains(local):
            return False
        subs = [s for s in self._g_path._subs if len(s) >= 3]
        rule = getattr(self._g_path, "_fill_rule", 0)
        if rule == 1:                  # winding: any piece covers it
            if any(_winding(local.x(), local.y(), s) != 0 for s in subs):
                return True
        else:
            count = sum(1 for s in subs if _in_poly(local.x(), local.y(), s))
            if count % 2 == 1:
                return True
        return any(_near_outline(local, s, tol) for s in subs)


class QGraphicsSimpleTextItem(QAbstractGraphicsShapeItem):
    Type = 9

    def __init__(self, *args, **kwargs):
        text = next((a for a in args if isinstance(a, str)), "")
        parent = next((a for a in args if isinstance(a, QGraphicsItem)),
                      None)
        super().__init__(parent)
        self._g_text = text

    def setText(self, t):
        self._g_text = str(t)
        self._touch()

    def text(self):
        return self._g_text

    def setFont(self, font):
        self._g_font = font

    def font(self):
        from .QtGui import QFont
        return QFont(getattr(self, "_g_font", None) or QFont())

    def _kc_draw(self, painter):
        if getattr(self, "_g_font", None) is not None:
            painter.setFont(self._g_font)
        painter.drawText(QPointF(0, 12), self._g_text)

    def boundingRect(self):
        return QRectF(0, 0, 6 * len(self._g_text), 12)


class QGraphicsTextItem(QGraphicsSimpleTextItem):
    Type = 8

    def setPlainText(self, t):
        self.setText(t)

    def toPlainText(self):
        return self._g_text

    def setHtml(self, t):
        self.setText(t)

    def setDefaultTextColor(self, *a):
        pass

    def setTextInteractionFlags(self, *a):
        pass


class QGraphicsPixmapItem(QGraphicsItem):
    Type = 7

    def setPixmap(self, *a):
        pass

    def setOffset(self, *a):
        pass


class QGraphicsItemGroup(QGraphicsItem):
    Type = 10

    def addToGroup(self, item):
        item.setParentItem(self)

    def removeFromGroup(self, item):
        item.setParentItem(None)


class QGraphicsObject(QGraphicsItem, QObject):
    def __init__(self, *a, **k):
        QObject.__init__(self)
        QGraphicsItem.__init__(self, *a, **k)


# ------------------------------------------------------------------ events

class SceneMouseEvent(Inert):
    """What QGraphicsScene's mouse handlers receive."""

    def __init__(self, scene_pos, last_pos, down_pos, button, buttons,
                 modifiers, screen=None):
        self._p = QPointF(scene_pos)
        self._last = QPointF(last_pos)
        self._down = QPointF(down_pos)
        self._button = button
        self._buttons = buttons
        self._mods = modifiers
        self._accepted = True
        self._screen = screen or QPointF()
        self._item_pos = QPointF(scene_pos)

    def scenePos(self):
        return QPointF(self._p)

    def lastScenePos(self):
        return QPointF(self._last)

    def buttonDownScenePos(self, *_a):
        return QPointF(self._down)

    def pos(self):
        return QPointF(self._item_pos)

    def screenPos(self):
        return QPointF(self._screen)

    def button(self):
        return self._button

    def buttons(self):
        return self._buttons

    def modifiers(self):
        return self._mods

    def accept(self):
        self._accepted = True

    def ignore(self):
        self._accepted = False

    def isAccepted(self):
        return self._accepted

    def setAccepted(self, on):
        self._accepted = bool(on)

    def widget(self):
        return None


# ------------------------------------------------------------------- scene

class QGraphicsScene(InertObject, KcBase):
    selectionChanged = pyqtSignal()
    changed = pyqtSignal(object)
    sceneRectChanged = pyqtSignal(object)
    focusItemChanged = pyqtSignal(object, object, int)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QObject)), None)
        QObject.__init__(self, parent)
        self._kc_init()
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        rect = next((a for a in args if isinstance(a, QRectF)), None)
        self._g_rect = rect if rect is not None else \
            (QRectF(*nums) if len(nums) == 4 else QRectF())
        self._g_items = []             # top-level items, insertion order
        self._g_views = []
        self._g_grabber = None
        self._g_band = None            # (start QPointF, current QPointF)
        self._g_last = QPointF()
        self._g_down = QPointF()
        self._g_sel_batch = 0
        self._g_sel_dirty = False

    # -- items
    def _kc_attach(self, item):
        item._g_scene = self
        for c in item._g_children:
            self._kc_attach(c)
        self._touch()

    def addItem(self, item):
        if item._g_scene is self and item in self._g_items:
            return
        if item._g_parent is None:
            self._g_items.append(item)
        self._kc_attach(item)
        if item._g_selected:
            self._kc_selection_changed()

    def removeItem(self, item):
        if item._g_parent is not None:
            if item in item._g_parent._g_children:
                item._g_parent._g_children.remove(item)
            item._g_parent = None
        elif item in self._g_items:
            self._g_items.remove(item)
        was_selected = any(i._g_selected for i in _walk(item))
        for i in _walk(item):
            i._g_scene = None
            if i is self._g_grabber:
                self._g_grabber = None
        self._touch()
        if was_selected:
            self._kc_selection_changed()

    def clear(self):
        for item in list(self._g_items):
            self.removeItem(item)

    def items(self, *args):
        allitems = [i for top in self._g_items for i in _walk(top)]
        if args and isinstance(args[0], QPointF):
            return self._kc_items_at(args[0], 0.0)
        # Qt: descending stacking order (top-most first)
        return list(reversed(allitems))

    def _kc_ppu(self):
        view = self._g_views[0] if self._g_views else None
        return view.px_per_mm() if view is not None else 4.0

    def _kc_items_at(self, pos, tol_px=3.0):
        ppu = self._kc_ppu()
        out = []
        for top in self._g_items:
            for it in _walk(top):
                if not it.isVisible():
                    continue
                sp = it.scenePos()
                if it._g_flags & it.ItemIgnoresTransformations:
                    # a constant-size handle: its rect is in pixels
                    r = it.boundingRect()
                    lx = (pos.x() - sp.x()) * ppu
                    ly = -(pos.y() - sp.y()) * ppu
                    if r.adjusted(-2, -2, 2, 2).contains(QPointF(lx, ly)):
                        out.append(it)
                    continue
                local = QPointF(pos.x() - sp.x(), pos.y() - sp.y())
                if it._kc_hit(local, tol_px / max(ppu, 1e-9)):
                    out.append(it)
        # top-most first: children above parents, later above earlier,
        # higher z above lower
        order = {id(it): k for k, it in enumerate(
            i for top in self._g_items for i in _walk(top))}
        out.sort(key=lambda it: (_z_of(it), order[id(it)]), reverse=True)
        return out

    def itemAt(self, pos, *_transform):
        hits = self._kc_items_at(QPointF(pos))
        return hits[0] if hits else None

    def selectedItems(self):
        return [i for top in self._g_items for i in _walk(top)
                if i._g_selected]

    def _kc_clear_selection(self, except_item=None):
        self._g_sel_batch += 1
        try:
            for it in self.selectedItems():
                if it is not except_item:
                    it.setSelected(False)
        finally:
            self._g_sel_batch -= 1
        if self._g_sel_dirty and not self._g_sel_batch:
            self._g_sel_dirty = False
            self.selectionChanged.emit()

    def clearSelection(self):
        self._kc_clear_selection()

    def _kc_selection_changed(self):
        self._touch()
        if self._g_sel_batch:
            self._g_sel_dirty = True
            return
        if not self.signalsBlocked():
            self.selectionChanged.emit()

    def setSelectionArea(self, path, *a):
        pass

    def itemsBoundingRect(self):
        rect = None
        for top in self._g_items:
            for it in _walk(top):
                if not it.isVisible() or \
                        it._g_flags & it.ItemIgnoresTransformations:
                    continue
                r = it.sceneBoundingRect()
                if r.width() <= 0 and r.height() <= 0:
                    continue
                rect = r if rect is None else rect.united(r)
        return rect or QRectF()

    def sceneRect(self):
        return QRectF(self._g_rect)

    def setSceneRect(self, *a):
        self._g_rect = a[0] if len(a) == 1 else QRectF(*a)

    def width(self):
        return self._g_rect.width()

    def height(self):
        return self._g_rect.height()

    def views(self):
        return list(self._g_views)

    def mouseGrabberItem(self):
        return self._g_grabber

    def update(self, *a):
        self._touch()

    def invalidate(self, *a):
        self._touch()

    def setBackgroundBrush(self, *a):
        pass

    def setItemIndexMethod(self, *a):
        pass

    def addLine(self, *args):
        from .QtGui import QPen
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        line = next((a for a in args if isinstance(a, QLineF)), None)
        item = QGraphicsLineItem()
        item.setLine(line if line is not None else QLineF(*nums[:4]))
        pen = next((a for a in args if isinstance(a, QPen)), None)
        if pen is not None:
            item.setPen(pen)
        self.addItem(item)
        return item

    def addRect(self, *args):
        from .QtGui import QPen, QBrush
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        rect = next((a for a in args if isinstance(a, QRectF)), None)
        item = QGraphicsRectItem()
        item.setRect(rect if rect is not None else QRectF(*nums[:4]))
        pen = next((a for a in args if isinstance(a, QPen)), None)
        brush = next((a for a in args if isinstance(a, QBrush)), None)
        if pen is not None:
            item.setPen(pen)
        if brush is not None:
            item.setBrush(brush)
        self.addItem(item)
        return item

    def addEllipse(self, *args):
        from .QtGui import QPen, QBrush
        nums = [a for a in args if isinstance(a, (int, float))
                and not isinstance(a, bool)]
        rect = next((a for a in args if isinstance(a, QRectF)), None)
        item = QGraphicsEllipseItem()
        item.setRect(rect if rect is not None else QRectF(*nums[:4]))
        pen = next((a for a in args if isinstance(a, QPen)), None)
        brush = next((a for a in args if isinstance(a, QBrush)), None)
        if pen is not None:
            item.setPen(pen)
        if brush is not None:
            item.setBrush(brush)
        self.addItem(item)
        return item

    def addPath(self, path, pen=None, brush=None):
        item = QGraphicsPathItem(path)
        if pen is not None:
            item.setPen(pen)
        if brush is not None:
            item.setBrush(brush)
        self.addItem(item)
        return item

    def addPolygon(self, poly, pen=None, brush=None):
        item = QGraphicsPolygonItem(poly)
        if pen is not None:
            item.setPen(pen)
        if brush is not None:
            item.setBrush(brush)
        self.addItem(item)
        return item

    def addSimpleText(self, text, *a):
        item = QGraphicsSimpleTextItem(text)
        self.addItem(item)
        return item

    def addText(self, text, *a):
        item = QGraphicsTextItem(text)
        self.addItem(item)
        return item

    def addPixmap(self, *a):
        item = QGraphicsPixmapItem()
        self.addItem(item)
        return item

    def createItemGroup(self, items):
        group = QGraphicsItemGroup()
        self.addItem(group)
        for it in items:
            group.addToGroup(it)
        return group

    # -- Qt's default mouse dispatch
    def mousePressEvent(self, event):
        items = self._kc_items_at(event.scenePos())
        for item in items:
            if not item.acceptedMouseButtons() & event.button():
                continue
            event._item_pos = item.mapFromScene(event.scenePos())
            event.accept()
            item._kc_drag_origin = item.pos()
            item.mousePressEvent(event)
            if event.isAccepted():
                self._g_grabber = item
                for it in self.selectedItems():
                    it._kc_drag_origin = it.pos()
                return
        # empty space: clear the selection, start a rubber band
        if not event.modifiers() & 0x04000000:
            self.clearSelection()
        if event.button() == 1:
            self._g_band = (event.scenePos(), event.scenePos())

    def mouseMoveEvent(self, event):
        grabber = self._g_grabber
        if grabber is not None:
            event._item_pos = grabber.mapFromScene(event.scenePos())
            grabber.mouseMoveEvent(event)
            return
        if self._g_band is not None:
            self._g_band = (self._g_band[0], event.scenePos())
            self._touch()

    def mouseReleaseEvent(self, event):
        grabber = self._g_grabber
        if grabber is not None:
            event._item_pos = grabber.mapFromScene(event.scenePos())
            grabber.mouseReleaseEvent(event)
            for it in self.selectedItems():
                it.__dict__.pop("_kc_drag_origin", None)
            grabber.__dict__.pop("_kc_drag_origin", None)
            self._g_grabber = None
            return
        if self._g_band is not None:
            a, b = self._g_band
            self._g_band = None
            band = QRectF(a, b).normalized()
            if band.width() > 0 or band.height() > 0:
                self._g_sel_batch += 1
                try:
                    for top in self._g_items:
                        for it in _walk(top):
                            if not it.isVisible() or not (
                                    it._g_flags & it.ItemIsSelectable):
                                continue
                            r = it.sceneBoundingRect()
                            hit = not (r.right() < band.left()
                                       or r.left() > band.right()
                                       or r.bottom() < band.top()
                                       or r.top() > band.bottom())
                            if hit:
                                it.setSelected(True)
                finally:
                    self._g_sel_batch -= 1
                if self._g_sel_dirty:
                    self._g_sel_dirty = False
                    self.selectionChanged.emit()
            self._touch()

    def mouseDoubleClickEvent(self, event):
        items = self._kc_items_at(event.scenePos())
        if items:
            event._item_pos = items[0].mapFromScene(event.scenePos())
            items[0].mouseDoubleClickEvent(event)
            return
        self.mousePressEvent(event)

    def contextMenuEvent(self, event):
        pass

    def keyPressEvent(self, event):
        pass


def _walk(item):
    yield item
    for c in item._g_children:
        yield from _walk(c)


def _z_of(item):
    z, it = 0.0, item
    depth = 0
    while it is not None:
        z = it._g_z if depth == 0 else z
        it = it._g_parent
        depth += 1
    top = item.topLevelItem()
    return (top._g_z, depth, item._g_z)


# -------------------------------------------------------------------- view

class _ScrollBar(Inert):
    def __init__(self, view, axis):
        self._view, self._axis = view, axis

    def value(self):
        v = self._view
        s = v.px_per_mm()
        if self._axis == 0:
            return int(round(v._kc_cx * s))
        return int(round(-v._kc_cy * s))

    def setValue(self, value):
        v = self._view
        s = v.px_per_mm()
        if self._axis == 0:
            v._kc_cx = value / s
        else:
            v._kc_cy = -value / s
        v._kc_moved()

    def maximum(self):
        return 10 ** 9

    def minimum(self):
        return -10 ** 9

    def pageStep(self):
        return self._view._kc_vw if self._axis == 0 else self._view._kc_vh

    def singleStep(self):
        return 20


class _Viewport(Inert):
    def __init__(self, view):
        self._view = view

    def width(self):
        return self._view._kc_vw

    def height(self):
        return self._view._kc_vh

    def rect(self):
        return QRectF(0, 0, self._view._kc_vw, self._view._kc_vh)

    def geometry(self):
        return self.rect()

    def update(self, *a):
        self._view._touch()

    def setCursor(self, *a):
        pass

    def unsetCursor(self):
        pass

    def setMouseTracking(self, *a):
        pass


class QGraphicsView(QWidget):
    NoDrag = 0
    ScrollHandDrag = 1
    RubberBandDrag = 2
    AnchorUnderMouse = 2
    AnchorViewCenter = 1
    NoAnchor = 0
    FullViewportUpdate = 0
    SmartViewportUpdate = 2
    MinimalViewportUpdate = 1
    BoundingRectViewportUpdate = 4

    def __init__(self, *args, **kwargs):
        scene = next((a for a in args if isinstance(a, QGraphicsScene)),
                     None)
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_scene = None
        #: the view: pixels per scene unit (x, y — y negative for a
        #: Y-up view), the scene point at the viewport's centre and the
        #: viewport's size in pixels (the web side tells us)
        self._kc_sx, self._kc_sy = 1.0, 1.0
        self._kc_cx, self._kc_cy = 0.0, 0.0
        self._kc_vw, self._kc_vh = 800, 400
        self._kc_drag = 0
        self._kc_anchor_px = None      # zoom about the mouse (wheel)
        self._kc_view_rev = 0
        self._kc_vport = _Viewport(self)
        self._kc_hbar = _ScrollBar(self, 0)
        self._kc_vbar = _ScrollBar(self, 1)
        self._kc_cursor = 0
        if scene is not None:
            self.setScene(scene)

    def setScene(self, scene):
        self._kc_scene = scene
        if self not in scene._g_views:
            scene._g_views.append(self)

    def scene(self):
        return self._kc_scene

    def viewport(self):
        return self._kc_vport

    def horizontalScrollBar(self):
        return self._kc_hbar

    def verticalScrollBar(self):
        return self._kc_vbar

    def _kc_moved(self):
        self._kc_view_rev += 1
        self._touch()

    # -- transform
    def transform(self):
        return QTransform(self._kc_sx, 0, 0, self._kc_sy, 0, 0)

    def setTransform(self, t, *a):
        self._kc_sx, self._kc_sy = t.m11(), t.m22()
        self._kc_moved()

    def resetTransform(self):
        self._kc_sx, self._kc_sy = 1.0, 1.0
        self._kc_moved()

    def scale(self, sx, sy):
        anchor = self._kc_anchor_px
        before = self.mapToScene(*anchor) if anchor is not None else None
        self._kc_sx *= sx
        self._kc_sy *= sy
        if before is not None:
            after = self.mapToScene(*anchor)
            self._kc_cx += before.x() - after.x()
            self._kc_cy += before.y() - after.y()
        self._kc_moved()

    def centerOn(self, x, y=None):
        if isinstance(x, QGraphicsItem):
            p = x.sceneBoundingRect().center()
            x, y = p.x(), p.y()
        elif y is None:
            x, y = x.x(), x.y()
        self._kc_cx, self._kc_cy = float(x), float(y)
        self._kc_moved()

    def fitInView(self, rect, *a):
        if isinstance(rect, QGraphicsItem):
            rect = rect.sceneBoundingRect()
        if rect.width() <= 0 or rect.height() <= 0:
            return
        s = min(self._kc_vw / rect.width(), self._kc_vh / rect.height())
        self._kc_sx = s
        self._kc_sy = -s if self._kc_sy < 0 else s
        self.centerOn(rect.center())

    def px_scale(self):
        return abs(self._kc_sx)

    def mapToScene(self, *a):
        if len(a) == 2:
            x, y = float(a[0]), float(a[1])
        else:
            p = a[0]
            if isinstance(p, QRectF):
                tl = self.mapToScene(p.left(), p.top())
                br = self.mapToScene(p.right(), p.bottom())
                from .QtGui import QPolygonF
                return QPolygonF([tl, QPointF(br.x(), tl.y()), br,
                                  QPointF(tl.x(), br.y())])
            x, y = p.x(), p.y()
        return QPointF(self._kc_cx + (x - self._kc_vw / 2) / self._kc_sx,
                       self._kc_cy + (y - self._kc_vh / 2) / self._kc_sy)

    def mapFromScene(self, *a):
        if len(a) == 2:
            x, y = float(a[0]), float(a[1])
        else:
            p = a[0]
            x, y = p.x(), p.y()
        return QPointF(self._kc_vw / 2 + (x - self._kc_cx) * self._kc_sx,
                       self._kc_vh / 2 + (y - self._kc_cy) * self._kc_sy)

    def setDragMode(self, mode):
        self._kc_drag = int(mode)

    def dragMode(self):
        return self._kc_drag

    def setRenderHints(self, *a):
        pass

    def setRenderHint(self, *a):
        pass

    def setTransformationAnchor(self, *a):
        pass

    def setResizeAnchor(self, *a):
        pass

    def setViewportUpdateMode(self, *a):
        pass

    def setOptimizationFlags(self, *a):
        pass

    def setCacheMode(self, *a):
        pass

    def setBackgroundBrush(self, brush):
        from .QtGui import QBrush
        self._kc_bg = brush if isinstance(brush, QBrush) else QBrush(brush)
        self._touch()

    def backgroundBrush(self):
        from .QtGui import QBrush
        return getattr(self, "_kc_bg", None) or QBrush()

    def ensureVisible(self, *a):
        pass

    def setHorizontalScrollBarPolicy(self, *a):
        pass

    def setVerticalScrollBarPolicy(self, *a):
        pass

    def setSceneRect(self, *a):
        pass

    def setCursor(self, cursor):
        self._kc_cursor = int(cursor) if isinstance(cursor, int) else 0
        self._touch()

    def unsetCursor(self):
        self._kc_cursor = 0

    def rubberBandRect(self):
        return QRectF()

    def items(self, *a):
        return self._kc_scene.items() if self._kc_scene else []

    def itemAt(self, *a):
        p = a[0] if len(a) == 1 else QPointF(a[0], a[1])
        return self._kc_scene.itemAt(self.mapToScene(p)) \
            if self._kc_scene else None

    # -- Qt's default event handling: hand the mouse to the scene
    def _kc_scene_event(self, event):
        p = self.mapToScene(event.pos())
        last = getattr(self, "_kc_last_scene", p)
        down = getattr(self, "_kc_down_scene", p)
        return SceneMouseEvent(p, last, down, event.button(),
                               event.buttons(), event.modifiers(),
                               event.pos())

    def mousePressEvent(self, event):
        if self._kc_scene is None:
            return
        p = self.mapToScene(event.pos())
        self._kc_down_scene = p
        self._kc_last_scene = p
        self._kc_scene.mousePressEvent(self._kc_scene_event(event))

    def mouseMoveEvent(self, event):
        if self._kc_scene is None:
            return
        ev = self._kc_scene_event(event)
        self._kc_scene.mouseMoveEvent(ev)
        self._kc_last_scene = ev.scenePos()

    def mouseReleaseEvent(self, event):
        if self._kc_scene is None:
            return
        ev = self._kc_scene_event(event)
        self._kc_scene.mouseReleaseEvent(ev)
        self._kc_last_scene = ev.scenePos()

    def mouseDoubleClickEvent(self, event):
        if self._kc_scene is None:
            return
        p = self.mapToScene(event.pos())
        self._kc_down_scene = p
        self._kc_last_scene = p
        self._kc_scene.mouseDoubleClickEvent(self._kc_scene_event(event))

    def wheelEvent(self, event):
        pass

    def keyPressEvent(self, event):
        pass

    def contextMenuEvent(self, event):
        pass

    def drawBackground(self, painter, rect):
        pass

    def drawForeground(self, painter, rect):
        pass

    def event(self, e):
        return False
