"""A headless stand-in for the parts of PyQt5 KherveCAD's model uses.

KherveOS runs the desktop KherveCAD's own Python (the document model,
the OpenSCAD code generator, the tessellator, the part library…) in
Pyodide, where there is no Qt. Those modules import PyQt5 for a few
things — QObject signals, a 0 ms QTimer that batches undo snapshots,
QUndoStack, QSettings — and the UI modules import widgets they never get
to show here. This package provides:

- working QObject / pyqtSignal / QTimer / QUndoStack / QUndoCommand /
  QSettings, with Qt's semantics where the model relies on them;
- for every other name, an inert class: it can be subclassed,
  instantiated, called and asked for any attribute, and does nothing.

The web UI (React, src/apps/khervecad) is the window; nothing here draws.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import inspect
import itertools

_ids = itertools.count(1)


# ----------------------------------------------------------- inert things

class _InertMeta(type):
    """Class-level attribute access (Qt.AlignCenter, QFont.Bold,
    QDialog.Accepted…) gives a stable int, like Qt's enums."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = _enum_value(name)
        setattr(cls, name, value)
        return value


_ENUMS = {}


def _enum_value(name):
    if name not in _ENUMS:
        _ENUMS[name] = 1 << (len(_ENUMS) % 30)
    return _ENUMS[name]


class Inert(metaclass=_InertMeta):
    """Anything: every attribute is another Inert, calling one returns an
    Inert, and it is falsy, empty and zero."""

    def __init__(self, *args, **kwargs):
        pass

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return Inert()

    def __call__(self, *args, **kwargs):
        return Inert()

    def __bool__(self):
        return False

    def __getitem__(self, key):
        return Inert()

    def __setitem__(self, key, value):
        pass

    def __delitem__(self, key):
        pass

    def __contains__(self, key):
        return False

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0

    def __int__(self):
        return 0

    def __float__(self):
        return 0.0

    def __index__(self):
        return 0

    def __str__(self):
        return ""

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)

    def __lt__(self, other):
        return False

    __gt__ = __le__ = __ge__ = __lt__

    def __add__(self, other):
        return other

    __radd__ = __add__

    def __sub__(self, other):
        return 0

    __rsub__ = __mul__ = __rmul__ = __truediv__ = __rtruediv__ = __sub__
    __floordiv__ = __rfloordiv__ = __sub__

    def __or__(self, other):
        return other

    __ror__ = __and__ = __rand__ = __or__

    def __neg__(self):
        return 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


_CLASSES = {}


def inert_class(name, base=None):
    """The inert class called *name* (one per name, so isinstance and
    subclassing behave). Widgets (Q…Widget, dialogs, views, items with
    signals) are QObjects too, so pyqtSignal works on their subclasses."""
    if name not in _CLASSES:
        if base is None:
            base = InertObject if _is_object(name) else Inert
        _CLASSES[name] = _InertMeta(name, (base,), {})
    return _CLASSES[name]


_PLAIN = {"QColor", "QFont", "QPen", "QBrush", "QIcon", "QPixmap",
          "QImage", "QPainter", "QPainterPath", "QPolygonF", "QPolygon",
          "QTransform", "QKeySequence", "QFontMetrics", "QFontMetricsF",
          "QLinearGradient", "QRadialGradient", "QConicalGradient",
          "QTextCharFormat", "QTextCursor", "QTextOption", "QCursor",
          "QVector3D", "QMatrix4x4", "QPalette", "QRegion", "QUrl",
          "QMimeData", "QDesktopServices", "QFileInfo", "QDir", "QLocale",
          "QDateTime", "QDate", "QTime", "QRegularExpression", "QVariant",
          "QModelIndex", "QItemSelection", "QSizePolicy", "QTreeWidgetItem",
          "QTableWidgetItem", "QListWidgetItem", "QStandardItem",
          "QTextDocument", "QTextBlockFormat", "QFontDatabase",
          "QStyleOptionViewItem", "QGuiApplication", "QOpenGLShader"}


def _is_object(name):
    return name not in _PLAIN


# ------------------------------------------------------------- signals

def _arity(slot):
    """How many positional arguments *slot* takes (None = any)."""
    try:
        sig = inspect.signature(slot)
    except (TypeError, ValueError):
        return None
    count = 0
    for p in sig.parameters.values():
        if p.kind == p.VAR_POSITIONAL:
            return None
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            count += 1
    return count


class BoundSignal:
    def __init__(self, owner, name):
        self._owner = owner
        self._name = name
        self._slots = []

    def connect(self, slot, *_type):
        if isinstance(slot, BoundSignal):
            target = slot
            slot = lambda *a: target.emit(*a)        # noqa: E731
        self._slots.append((slot, _arity(slot)))

    def disconnect(self, slot=None):
        if slot is None:
            self._slots.clear()
            return
        before = len(self._slots)
        self._slots = [(s, n) for s, n in self._slots if s != slot]
        if len(self._slots) == before:
            raise TypeError("disconnect() failed between signal and slot")

    def emit(self, *args):
        owner = self._owner
        if owner is not None and getattr(owner, "_kc_blocked", False):
            return
        for slot, n in list(self._slots):
            slot(*(args if n is None else args[:n]))

    def __call__(self, *args):
        self.emit(*args)

    def __getitem__(self, _types):
        return self


class pyqtSignal:
    """Class attribute; each instance gets its own BoundSignal."""

    def __init__(self, *types, **kwargs):
        self._name = None

    def __set_name__(self, owner, name):
        self._name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        key = "_kc_sig_" + (self._name or str(id(self)))
        bound = obj.__dict__.get(key)
        if bound is None:
            bound = BoundSignal(obj, self._name)
            obj.__dict__[key] = bound
        return bound


def pyqtSlot(*_a, **_k):
    def wrap(fn):
        return fn
    return wrap


def pyqtProperty(*_a, **_k):
    def wrap(fn):
        return property(fn)
    return wrap


class QObject(metaclass=_InertMeta):
    """A real (attribute-strict) QObject: the model subclasses it, and a
    missing attribute there must stay an AttributeError."""
    destroyed = pyqtSignal()
    objectNameChanged = pyqtSignal(str)

    def __init__(self, parent=None, *args, **kwargs):
        self._kc_parent = parent if isinstance(parent, QObject) else None
        self._kc_blocked = False
        self._kc_props = {}
        self._kc_name = ""

    def parent(self):
        return self.__dict__.get("_kc_parent")

    def setParent(self, parent):
        self._kc_parent = parent

    def blockSignals(self, block):
        old = self.__dict__.get("_kc_blocked", False)
        self._kc_blocked = bool(block)
        return old

    def signalsBlocked(self):
        return self.__dict__.get("_kc_blocked", False)

    def objectName(self):
        return self.__dict__.get("_kc_name", "")

    def setObjectName(self, name):
        self._kc_name = name

    def setProperty(self, key, value):
        self.__dict__.setdefault("_kc_props", {})[key] = value

    def property(self, key):
        return self.__dict__.get("_kc_props", {}).get(key)

    def tr(self, text, *_a):
        from khervecad import language
        return language.tr(text)

    def deleteLater(self):
        pass

    def installEventFilter(self, *_a):
        pass

    def thread(self):
        return Inert()

    def moveToThread(self, *_a):
        pass

    def startTimer(self, *_a):
        return 0

    def killTimer(self, *_a):
        pass

    def event(self, *_a):
        return False

    def eventFilter(self, *_a):
        return False

    def removeEventFilter(self, *_a):
        pass

    def sender(self):
        return None

    def isWidgetType(self):
        return False

    def inherits(self, name):
        return any(c.__name__ == name for c in type(self).__mro__)

    def metaObject(self):
        return Inert()

    def dumpObjectTree(self):
        pass

    def children(self):
        return []

    def findChildren(self, *_a):
        return []

    def findChild(self, *_a):
        return None


#: attribute names the desktop code assigns somewhere (self.x = …,
#: win._y = …): on a widget, a missing one of these raises AttributeError
#: as with real Qt, so getattr(w, "x", None) and hasattr work; any other
#: name is taken for a Qt method we do not model and is inert.
#: Filled by learn_attrs() from the desktop sources.
DESKTOP_ATTRS = set()


def learn_attrs(package_dir):
    """Collect every attribute name assigned in the .py files under
    *package_dir* (the khervecad package)."""
    import os
    import re
    pat = re.compile(r"\.\s*([A-Za-z_]\w*)\s*=(?!=)")
    for root, _dirs, files in os.walk(package_dir):
        for f in files:
            if f.endswith(".py"):
                try:
                    with open(os.path.join(root, f), encoding="utf-8") as fh:
                        DESKTOP_ATTRS.update(pat.findall(fh.read()))
                except OSError:
                    pass
    # Qt names a desktop file also assigns on its own objects
    DESKTOP_ATTRS.difference_update({"text", "value", "data", "font"})


class InertObject(QObject, Inert):
    """A QObject (signals work) that otherwise accepts Qt calls — the base
    of every widget, dialog and view the UI modules build."""

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name in DESKTOP_ATTRS and \
                not type(self).__module__.startswith("PyQt5"):
            # a desktop class's own attribute that is not set (yet)
            raise AttributeError(name)
        return Inert()

    def __init__(self, *args, **kwargs):
        parent = args[0] if args and isinstance(args[0], QObject) else None
        QObject.__init__(self, parent)

    def __bool__(self):
        return True

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)


# --------------------------------------------------------------- timers

_PENDING = []          # timers waiting for the next event-loop turn


class QTimer(QObject):
    timeout = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._single = False
        self._interval = 0
        self._active = False
        self._id = next(_ids)

    def setSingleShot(self, on):
        self._single = bool(on)

    def isSingleShot(self):
        return self._single

    def setInterval(self, ms):
        self._interval = int(ms)

    def interval(self):
        return self._interval

    def start(self, ms=None):
        if ms is not None:
            self._interval = int(ms)
        self._active = True
        if self not in _PENDING:
            _PENDING.append(self)

    def stop(self):
        self._active = False
        if self in _PENDING:
            _PENDING.remove(self)

    def isActive(self):
        return self._active

    def remainingTime(self):
        return 0 if self._active else -1

    def setTimerType(self, *_a):
        pass

    @staticmethod
    def singleShot(_ms, *args):
        fn = args[-1] if args else None
        if callable(fn):
            t = QTimer()
            t.setSingleShot(True)
            t.timeout.connect(fn)
            t.start()


def process_events(max_rounds=50):
    """One turn of the event loop: fire every started timer (a repeating
    timer fires once per turn). Called by the bridge after each request,
    which is what makes one request one undo step, as one event-loop cycle
    is on the desktop."""
    for _ in range(max_rounds):
        if not _PENDING:
            return
        due = list(_PENDING)
        _PENDING.clear()
        for t in due:
            if not t._active:
                continue
            if t._single:
                t._active = False
            t.timeout.emit()


# ------------------------------------------------------------------ undo

class QUndoCommand(metaclass=_InertMeta):
    def __init__(self, text="", parent=None):
        self._kc_text = text if isinstance(text, str) else ""

    def text(self):
        return self._kc_text

    def setText(self, text):
        self._kc_text = text

    def id(self):
        return -1

    def mergeWith(self, other):
        return False

    def redo(self):
        pass

    def undo(self):
        pass


class QUndoStack(QObject):
    indexChanged = pyqtSignal(int)
    canUndoChanged = pyqtSignal(bool)
    canRedoChanged = pyqtSignal(bool)
    cleanChanged = pyqtSignal(bool)
    undoTextChanged = pyqtSignal(str)
    redoTextChanged = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cmds = []
        self._index = 0
        self._clean = 0
        self._limit = 0

    def _changed(self):
        self.indexChanged.emit(self._index)
        self.canUndoChanged.emit(self.canUndo())
        self.canRedoChanged.emit(self.canRedo())

    def push(self, cmd):
        cmd.redo()
        del self._cmds[self._index:]
        top = self._cmds[-1] if self._cmds else None
        if top is not None and cmd.id() != -1 and top.id() == cmd.id() \
                and self._clean != len(self._cmds) and top.mergeWith(cmd):
            pass
        else:
            self._cmds.append(cmd)
            if self._limit and len(self._cmds) > self._limit:
                del self._cmds[0]
                self._clean -= 1
        self._index = len(self._cmds)
        self._changed()

    def undo(self):
        if self._index > 0:
            self._index -= 1
            self._cmds[self._index].undo()
            self._changed()

    def redo(self):
        if self._index < len(self._cmds):
            self._cmds[self._index].redo()
            self._index += 1
            self._changed()

    def canUndo(self):
        return self._index > 0

    def canRedo(self):
        return self._index < len(self._cmds)

    def count(self):
        return len(self._cmds)

    def index(self):
        return self._index

    def setIndex(self, idx):
        while self._index > idx and self.canUndo():
            self.undo()
        while self._index < idx and self.canRedo():
            self.redo()

    def clear(self):
        self._cmds.clear()
        self._index = 0
        self._clean = 0
        self._changed()

    def setClean(self):
        self._clean = self._index
        self.cleanChanged.emit(True)

    def isClean(self):
        return self._clean == self._index

    def setUndoLimit(self, n):
        self._limit = int(n)

    def undoText(self):
        return self._cmds[self._index - 1].text() if self.canUndo() else ""

    def redoText(self):
        return self._cmds[self._index].text() if self.canRedo() else ""

    def command(self, i):
        return self._cmds[i]

    def beginMacro(self, *_a):
        pass

    def endMacro(self):
        pass

    def _kc_action(self, parent, prefix, undo):
        """Qt's createUndoAction / createRedoAction: an action that runs
        undo / redo, enabled only when there is something to undo, its
        text the prefix and the command's text ("Undo edit")."""
        from ._widgets import QAction
        default = "&Undo" if undo else "&Redo"
        prefix = prefix if isinstance(prefix, str) and prefix else default
        act = QAction(prefix, parent if isinstance(parent, QObject) else None)

        def sync(*_a):
            can = self.canUndo() if undo else self.canRedo()
            text = self.undoText() if undo else self.redoText()
            act._kc_enabled = can
            act._kc_text = f"{prefix} {text}" if can and text else prefix
            act._changed()

        act.triggered.connect(lambda *_a: self.undo() if undo
                              else self.redo())
        self.indexChanged.connect(sync)
        sync()
        return act

    def createUndoAction(self, parent=None, prefix=""):
        return self._kc_action(parent, prefix, True)

    def createRedoAction(self, parent=None, prefix=""):
        return self._kc_action(parent, prefix, False)


# -------------------------------------------------------------- settings

#: every QSettings shares one store; the bridge loads and saves it so the
#: desktop code's remembered choices persist (in the browser's storage)
SETTINGS = {}
SETTINGS_DIRTY = [False]


def _convert(value, kind):
    if kind is None or value is None:
        return value
    if kind is bool:
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes")
        return bool(value)
    if kind is list:
        return value if isinstance(value, list) else [value]
    try:
        return kind(value)
    except (TypeError, ValueError):
        return kind()


class QSettings(QObject):
    IniFormat = 1
    NativeFormat = 0
    UserScope = 0

    def __init__(self, *args, **kwargs):
        super().__init__()
        self._group = []

    def _key(self, key):
        return "/".join(self._group + [str(key)])

    def value(self, key, default=None, type=None):
        value = SETTINGS.get(self._key(key), default)
        return _convert(value, type)

    def setValue(self, key, value):
        if isinstance(value, (bytes, bytearray)):
            return
        SETTINGS[self._key(key)] = value
        SETTINGS_DIRTY[0] = True

    def contains(self, key):
        return self._key(key) in SETTINGS

    def remove(self, key):
        prefix = self._key(key)
        for k in [k for k in SETTINGS if k == prefix
                  or k.startswith(prefix + "/")]:
            del SETTINGS[k]
        SETTINGS_DIRTY[0] = True

    def beginGroup(self, name):
        self._group.append(str(name))

    def endGroup(self):
        if self._group:
            self._group.pop()

    def allKeys(self):
        prefix = "/".join(self._group)
        return [k[len(prefix) + 1:] if prefix else k for k in SETTINGS
                if not prefix or k.startswith(prefix + "/")]

    def childKeys(self):
        return [k for k in self.allKeys() if "/" not in k]

    def sync(self):
        pass

    def fileName(self):
        return ""


# ----------------------------------------------------------- small values

class Lenient(metaclass=_InertMeta):
    """A modelled value type (QColor, QFont, QPen, QRectF…): what we model
    works; any other Qt method is inert rather than an AttributeError, and
    class constants (QFont.SansSerif) are stable ints."""

    def __getattr__(self, name):
        if name.startswith("_") or name in DESKTOP_ATTRS:
            raise AttributeError(name)
        return Inert()


class QPointF(Lenient):
    def __init__(self, x=0.0, y=0.0):
        if isinstance(x, QPointF):
            x, y = x._x, x._y
        self._x, self._y = float(x), float(y)

    def x(self):
        return self._x

    def y(self):
        return self._y

    def setX(self, v):
        self._x = float(v)

    def setY(self, v):
        self._y = float(v)

    def __add__(self, o):
        return QPointF(self._x + o._x, self._y + o._y)

    def __sub__(self, o):
        return QPointF(self._x - o._x, self._y - o._y)

    def __mul__(self, k):
        return QPointF(self._x * k, self._y * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return QPointF(self._x / k, self._y / k)

    def __neg__(self):
        return QPointF(-self._x, -self._y)

    def __eq__(self, o):
        return isinstance(o, QPointF) and o._x == self._x and o._y == self._y

    def __hash__(self):
        return hash((self._x, self._y))

    def manhattanLength(self):
        return abs(self._x) + abs(self._y)

    def toPoint(self):
        return QPoint(round(self._x), round(self._y))

    def __repr__(self):
        return f"QPointF({self._x}, {self._y})"


class QPoint(QPointF):
    pass


class QSizeF(Lenient):
    def __init__(self, w=0.0, h=0.0):
        if isinstance(w, QSizeF):
            w, h = w._w, w._h
        self._w, self._h = float(w), float(h)

    def __mul__(self, k):
        return type(self)(self._w * k, self._h * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return type(self)(self._w / k, self._h / k)

    def __add__(self, o):
        return type(self)(self._w + o._w, self._h + o._h)

    def __eq__(self, o):
        return isinstance(o, QSizeF) and (self._w, self._h) == (o._w, o._h)

    def __hash__(self):
        return hash((self._w, self._h))

    def isValid(self):
        return self._w >= 0 and self._h >= 0

    def isEmpty(self):
        return self._w <= 0 or self._h <= 0

    def setWidth(self, w):
        self._w = float(w)

    def setHeight(self, h):
        self._h = float(h)

    def scaled(self, *a):
        return type(self)(self)

    def toSize(self):
        return QSize(round(self._w), round(self._h))

    def width(self):
        return self._w

    def height(self):
        return self._h


class QSize(QSizeF):
    pass


class QRectF(Lenient):
    def __init__(self, *a):
        if len(a) == 4:
            x, y, w, h = a
        elif len(a) == 2 and isinstance(a[0], QPointF):
            p, q = a
            if isinstance(q, QPointF):
                x, y, w, h = p.x(), p.y(), q.x() - p.x(), q.y() - p.y()
            else:
                x, y, w, h = p.x(), p.y(), q.width(), q.height()
        elif len(a) == 1 and isinstance(a[0], QRectF):
            r = a[0]
            x, y, w, h = r._x, r._y, r._w, r._h
        else:
            x = y = w = h = 0.0
        self._x, self._y, self._w, self._h = map(float, (x, y, w, h))

    def x(self):
        return self._x

    def y(self):
        return self._y

    def width(self):
        return self._w

    def height(self):
        return self._h

    def left(self):
        return self._x

    def top(self):
        return self._y

    def right(self):
        return self._x + self._w

    def bottom(self):
        return self._y + self._h

    def center(self):
        return QPointF(self._x + self._w / 2, self._y + self._h / 2)

    def isEmpty(self):
        return self._w <= 0 or self._h <= 0

    def isNull(self):
        return self._w == 0 and self._h == 0

    def isValid(self):
        return self._w > 0 and self._h > 0

    def united(self, o):
        if self.isNull():
            return QRectF(o)
        if o.isNull():
            return QRectF(self)
        l = min(self.left(), o.left())
        t = min(self.top(), o.top())
        r = max(self.right(), o.right())
        b = max(self.bottom(), o.bottom())
        return QRectF(l, t, r - l, b - t)

    def translated(self, dx, dy=None):
        if isinstance(dx, QPointF):
            dx, dy = dx.x(), dx.y()
        return QRectF(self._x + dx, self._y + dy, self._w, self._h)

    def adjusted(self, a, b, c, d):
        return QRectF(self._x + a, self._y + b, self._w - a + c,
                      self._h - b + d)

    def contains(self, p):
        return self.left() <= p.x() <= self.right() and \
            self.top() <= p.y() <= self.bottom()

    def topLeft(self):
        return QPointF(self._x, self._y)

    def bottomRight(self):
        return QPointF(self.right(), self.bottom())

    def topRight(self):
        return QPointF(self.right(), self._y)

    def bottomLeft(self):
        return QPointF(self._x, self.bottom())

    def setX(self, v):
        self._w += self._x - float(v)
        self._x = float(v)

    def setY(self, v):
        self._h += self._y - float(v)
        self._y = float(v)

    def setLeft(self, v):
        self.setX(v)

    def setTop(self, v):
        self.setY(v)

    def setRight(self, v):
        self._w = float(v) - self._x

    def setBottom(self, v):
        self._h = float(v) - self._y

    def setWidth(self, w):
        self._w = float(w)

    def setHeight(self, h):
        self._h = float(h)

    def setRect(self, x, y, w, h):
        self._x, self._y, self._w, self._h = map(float, (x, y, w, h))

    def moveCenter(self, p):
        self._x = p.x() - self._w / 2
        self._y = p.y() - self._h / 2

    def moveTo(self, x, y=None):
        if isinstance(x, QPointF):
            x, y = x.x(), x.y()
        self._x, self._y = float(x), float(y)

    def moveTopLeft(self, p):
        self.moveTo(p)

    def translate(self, dx, dy=None):
        if isinstance(dx, QPointF):
            dx, dy = dx.x(), dx.y()
        self._x += dx
        self._y += dy

    def intersects(self, o):
        return not (o.left() > self.right() or o.right() < self.left()
                    or o.top() > self.bottom() or o.bottom() < self.top())

    def intersected(self, o):
        l = max(self.left(), o.left())
        t = max(self.top(), o.top())
        r = min(self.right(), o.right())
        b = min(self.bottom(), o.bottom())
        if r < l or b < t:
            return QRectF()
        return QRectF(l, t, r - l, b - t)

    def marginsAdded(self, m):
        return self.adjusted(-m.left(), -m.top(), m.right(), m.bottom())

    def toRect(self):
        return QRect(self)

    def getRect(self):
        return self._x, self._y, self._w, self._h

    def getCoords(self):
        return self._x, self._y, self.right(), self.bottom()

    def __eq__(self, o):
        return isinstance(o, QRectF) and self.getRect() == o.getRect()

    def __hash__(self):
        return hash(self.getRect())

    def __repr__(self):
        return f"QRectF({self._x}, {self._y}, {self._w}, {self._h})"

    def size(self):
        return QSizeF(self._w, self._h)

    def normalized(self):
        x, w = (self._x, self._w) if self._w >= 0 else (self._x + self._w,
                                                        -self._w)
        y, h = (self._y, self._h) if self._h >= 0 else (self._y + self._h,
                                                        -self._h)
        return QRectF(x, y, w, h)


class QRect(QRectF):
    pass


class QByteArray(bytes):
    pass


class QBuffer(Inert):
    pass


class QCoreApplication(QObject):
    @staticmethod
    def instance():
        return None

    @staticmethod
    def processEvents(*_a):
        pass

    @staticmethod
    def installTranslator(*_a):
        pass

    @staticmethod
    def translate(_ctx, text, *_a):
        return text

    @staticmethod
    def applicationDirPath():
        return "/"


class QStandardPaths(Inert):
    CacheLocation = 1
    AppDataLocation = 2
    AppLocalDataLocation = 3
    DocumentsLocation = 4
    HomeLocation = 5
    TempLocation = 6
    GenericDataLocation = 7

    @staticmethod
    def writableLocation(_kind):
        return ""
