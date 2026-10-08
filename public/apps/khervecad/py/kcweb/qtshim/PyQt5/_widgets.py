"""Headless Qt widgets: state and signals without pixels.

The desktop KherveCAD builds its window, panels and dialogs out of Qt
widgets. Here they are plain Python objects that keep the same state
(text, value, checked, items, current tab…) and emit the same signals
when it changes, so the desktop code runs unmodified. The web side
(src/apps/khervecad/qt) reads them through kcweb.ui.serialize and sends
user input back through kcweb.ui.dispatch.

Anything not modelled falls back to Inert (it accepts every call and
does nothing), so an unusual widget call never stops the desktop code.

Every state change calls `_touch()`, which bumps the widget's revision;
the serializer only re-sends what changed.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

import itertools
import re
import weakref

from ._core import Inert, InertObject, QObject, QPointF, QRectF, \
    QSize, pyqtSignal

_ids = itertools.count(1)
#: every live widget-like object by id (the web side addresses them so);
#: weak, so panels the desktop rebuilds are not kept alive here
REGISTRY = weakref.WeakValueDictionary()
#: global revision counter
_REV = [0]


def _next_rev():
    _REV[0] += 1
    return _REV[0]


class KcBase:
    """Identity + revision for anything the web side can see."""

    def _kc_init(self):
        if "_kc_id" in self.__dict__:
            return
        self._kc_id = next(_ids)
        self._kc_rev = _next_rev()
        REGISTRY[self._kc_id] = self

    def _touch(self):
        self.__dict__["_kc_rev"] = _next_rev()


def _plain(text):
    return str(text or "").replace("&&", "\0").replace("&", "") \
        .replace("\0", "&")


def _icon_name(icon):
    return getattr(icon, "_kc_name", None) if icon is not None else None


class QIcon(Inert):
    """An icon that remembers its MDI name (khervecad.icons.icon)."""

    def __init__(self, *a, **k):
        self._kc_name = a[0] if a and isinstance(a[0], str) else None
        self._kc_color = None

    def isNull(self):
        return not self._kc_name

    def name(self):
        return self._kc_name or ""

    def cacheKey(self):
        return hash(self._kc_name)

    def pixmap(self, *a):
        return Inert()

    def __bool__(self):
        return bool(self._kc_name)


# ------------------------------------------------------------------ widget

class QWidget(InertObject, KcBase):
    """State every widget shares: parent/children, visibility, enabled,
    tooltips, a layout, a size."""

    def __init__(self, *args, **kwargs):
        parent = args[0] if args and isinstance(args[0], QWidget) else \
            kwargs.get("parent")
        QObject.__init__(self, parent if isinstance(parent, QObject)
                         else None)
        self._kc_init()
        self._kc_children = []
        self._kc_hidden = False       # setVisible(False) / hide()
        self._kc_shown = False        # show() on a window
        self._kc_enabled = True
        self._kc_tip = ""
        self._kc_status_tip = ""
        self._kc_title = ""
        self._kc_layout = None
        self._kc_w, self._kc_h = 640, 480
        self._kc_min_w = self._kc_min_h = 0
        self._kc_max_w = self._kc_max_h = 0
        self._kc_fixed_w = self._kc_fixed_h = 0
        self._kc_style = ""
        self._kc_window = False       # a top-level window (dialog…)
        self._kc_font = None
        if isinstance(parent, QWidget):
            parent._kc_add_child(self)

    # -- tree
    def _kc_add_child(self, child):
        old = child.__dict__.get("_kc_parent")
        if isinstance(old, QWidget) and old is not self and \
                child in old._kc_children:
            old._kc_children.remove(child)
        child._kc_parent = self
        if child not in self._kc_children:
            self._kc_children.append(child)
        self._touch()

    def setParent(self, parent, *flags):
        if isinstance(parent, QWidget):
            parent._kc_add_child(self)
        else:
            old = self.__dict__.get("_kc_parent")
            if isinstance(old, QWidget) and self in old._kc_children:
                old._kc_children.remove(self)
                old._touch()
            self._kc_parent = parent

    def parentWidget(self):
        p = self.__dict__.get("_kc_parent")
        return p if isinstance(p, QWidget) else None

    def window(self):
        w = self
        while True:
            if w._kc_window:
                return w
            p = w.parentWidget()
            if p is None:
                return w
            w = p

    def children(self):
        return list(self._kc_children)

    def findChildren(self, cls, name=None, *_a):
        out = []
        for c in self._kc_children:
            if isinstance(c, cls) and (name is None
                                       or c.objectName() == name):
                out.append(c)
            out.extend(c.findChildren(cls, name))
        for item in getattr(self, "_kc_actions", []):
            if isinstance(item, cls):
                out.append(item)
        return out

    def findChild(self, cls, name=None, *_a):
        found = self.findChildren(cls, name)
        return found[0] if found else None

    def deleteLater(self):
        self.setParent(None)
        self._kc_hidden = True

    # -- visibility
    def isVisible(self):
        if self._kc_hidden:
            return False
        p = self.parentWidget()
        if self._kc_window or p is None:
            return self._kc_shown
        return p.isVisible()

    def isHidden(self):
        return self._kc_hidden

    def isVisibleTo(self, _ancestor):
        return not self._kc_hidden

    def setVisible(self, on):
        on = bool(on)
        if self._kc_window or self.parentWidget() is None:
            if on != (self._kc_shown and not self._kc_hidden):
                self._kc_shown = on
                self._kc_hidden = not on
                self._touch()
                self._kc_visibility_changed(on)
            return
        if self._kc_hidden == on:
            self._kc_hidden = not on
            self._touch()
            p = self.parentWidget()
            if p is not None:
                p._touch()
            self._kc_visibility_changed(on)

    def _kc_visibility_changed(self, on):
        pass

    def show(self):
        self.setVisible(True)

    def hide(self):
        self.setVisible(False)

    def setHidden(self, hidden):
        self.setVisible(not hidden)

    def close(self):
        self.closeEvent(Inert())
        self.setVisible(False)
        return True

    def closeEvent(self, event):
        pass

    def raise_(self):
        pass

    def activateWindow(self):
        pass

    def showNormal(self):
        self.show()

    def isWindow(self):
        return self._kc_window or self.parentWidget() is None

    # -- state
    def setEnabled(self, on):
        if self._kc_enabled != bool(on):
            self._kc_enabled = bool(on)
            self._touch()

    def setDisabled(self, off):
        self.setEnabled(not off)

    def isEnabled(self):
        if not self._kc_enabled:
            return False
        p = self.parentWidget()
        return p.isEnabled() if p is not None else True

    def setToolTip(self, tip):
        self._kc_tip = str(tip or "")
        self._touch()

    def toolTip(self):
        return self._kc_tip

    def setStatusTip(self, tip):
        self._kc_status_tip = str(tip or "")

    def statusTip(self):
        return self._kc_status_tip

    def setWhatsThis(self, *_a):
        pass

    def setWindowTitle(self, title):
        self._kc_title = str(title or "")
        self._touch()

    def windowTitle(self):
        return self._kc_title

    def setStyleSheet(self, css):
        self._kc_style = str(css or "")
        self._touch()

    def styleSheet(self):
        return self._kc_style

    def setFont(self, font):
        self._kc_font = font
        self._touch()

    def font(self):
        from .QtGui import QFont
        return QFont(self._kc_font) if self._kc_font is not None else QFont()

    def fontMetrics(self):
        from .QtGui import QFontMetricsF
        return QFontMetricsF(self.font())

    def palette(self):
        from .QtGui import QPalette
        return QPalette()

    def setPalette(self, *a):
        pass

    def backgroundRole(self):
        return 0

    def foregroundRole(self):
        return 1

    def setAutoFillBackground(self, *a):
        pass

    def style(self):
        return Inert()

    def contentsRect(self):
        return QRectF(0, 0, self._kc_w, self._kc_h)

    def frameGeometry(self):
        return QRectF(0, 0, self._kc_w, self._kc_h)

    # -- layout
    def setLayout(self, layout):
        self._kc_layout = layout
        layout._kc_set_owner(self)
        self._touch()

    def layout(self):
        return self._kc_layout

    # -- geometry (only remembered: the browser lays out)
    def resize(self, *a):
        if len(a) == 1:
            a = (a[0].width(), a[0].height())
        self._kc_w, self._kc_h = int(a[0]), int(a[1])
        self._touch()

    def width(self):
        return self._kc_w

    def height(self):
        return self._kc_h

    def size(self):
        return QSize(self._kc_w, self._kc_h)

    def rect(self):
        return QRectF(0, 0, self._kc_w, self._kc_h)

    def geometry(self):
        return QRectF(0, 0, self._kc_w, self._kc_h)

    def setMinimumWidth(self, w):
        self._kc_min_w = int(w)
        self._touch()

    def setMinimumHeight(self, h):
        self._kc_min_h = int(h)
        self._touch()

    def setMinimumSize(self, *a):
        if len(a) == 1:
            a = (a[0].width(), a[0].height())
        self._kc_min_w, self._kc_min_h = int(a[0]), int(a[1])
        self._touch()

    def setMaximumWidth(self, w):
        self._kc_max_w = int(w)
        self._touch()

    def setMaximumHeight(self, h):
        self._kc_max_h = int(h)
        self._touch()

    def setMaximumSize(self, *a):
        if len(a) == 1:
            a = (a[0].width(), a[0].height())
        self._kc_max_w, self._kc_max_h = int(a[0]), int(a[1])

    def setFixedWidth(self, w):
        self._kc_fixed_w = int(w)
        self._touch()

    def setFixedHeight(self, h):
        self._kc_fixed_h = int(h)
        self._touch()

    def setFixedSize(self, *a):
        if len(a) == 1:
            a = (a[0].width(), a[0].height())
        self._kc_fixed_w, self._kc_fixed_h = int(a[0]), int(a[1])
        self._touch()

    def minimumWidth(self):
        return self._kc_min_w

    def minimumHeight(self):
        return self._kc_min_h

    def sizeHint(self):
        return QSize(self._kc_w, self._kc_h)

    def minimumSizeHint(self):
        return QSize(self._kc_min_w, self._kc_min_h)

    def adjustSize(self):
        pass

    def move(self, *a):
        pass

    def pos(self):
        return QPointF(0, 0)

    def x(self):
        return 0

    def y(self):
        return 0

    def mapToGlobal(self, p):
        return p

    def mapFromGlobal(self, p):
        return p

    def mapTo(self, _w, p):
        return p

    def mapFrom(self, _w, p):
        return p

    def update(self, *a):
        self._touch()

    def repaint(self, *a):
        self._touch()

    def setCursor(self, cursor):
        self._kc_cursor = int(cursor) if isinstance(cursor, int) else 0
        self._touch()

    def unsetCursor(self):
        self._kc_cursor = 0
        self._touch()

    def setFocus(self, *a):
        pass

    def hasFocus(self):
        return False

    def underMouse(self):
        return False

    def isActiveWindow(self):
        return True

    def winId(self):
        return self._kc_id

    def devicePixelRatioF(self):
        return 1.0

    def devicePixelRatio(self):
        return 1

    def logicalDpiX(self):
        return 96

    def grab(self, *a):
        return Inert()


# ----------------------------------------------------------------- layouts

class QLayoutItem(Inert):
    def __init__(self, kind, obj=None, stretch=0, align=0):
        self.kind, self.obj, self.stretch, self.align = kind, obj, stretch, \
            align

    def widget(self):
        return self.obj if self.kind == "w" else None

    def layout(self):
        return self.obj if self.kind == "l" else None

    def spacerItem(self):
        return self if self.kind in ("stretch", "spacing") else None


class QLayout(InertObject, KcBase):
    def __init__(self, *args, **kwargs):
        parent = args[0] if args else None
        QObject.__init__(self, parent if isinstance(parent, QObject)
                         else None)
        self._kc_init()
        self._kc_items = []
        self._kc_owner = None
        self._kc_margins = None
        self._kc_spacing = None
        if isinstance(parent, QWidget):
            parent.setLayout(self)

    def _kc_set_owner(self, widget):
        self._kc_owner = widget
        for item in self._kc_items:
            if item.kind == "w":
                widget._kc_add_child(item.obj)
            elif item.kind == "l":
                item.obj._kc_set_owner(widget)

    def _kc_adopt(self, obj):
        if self._kc_owner is None:
            return
        if isinstance(obj, QWidget):
            self._kc_owner._kc_add_child(obj)
        elif isinstance(obj, QLayout):
            obj._kc_set_owner(self._kc_owner)

    def _kc_dirty(self):
        self._touch()
        if self._kc_owner is not None:
            self._kc_owner._touch()

    def addWidget(self, w, stretch=0, alignment=0, *a):
        if w is None:
            return
        self._kc_items.append(QLayoutItem("w", w, stretch, alignment))
        self._kc_adopt(w)
        self._kc_dirty()

    def insertWidget(self, index, w, stretch=0, alignment=0):
        if index < 0:
            index = len(self._kc_items)
        self._kc_items.insert(index, QLayoutItem("w", w, stretch, alignment))
        self._kc_adopt(w)
        self._kc_dirty()

    def addLayout(self, layout, stretch=0, *a):
        self._kc_items.append(QLayoutItem("l", layout, stretch))
        self._kc_adopt(layout)
        self._kc_dirty()

    def insertLayout(self, index, layout, stretch=0):
        if index < 0:
            index = len(self._kc_items)
        self._kc_items.insert(index, QLayoutItem("l", layout, stretch))
        self._kc_adopt(layout)
        self._kc_dirty()

    def addStretch(self, stretch=0):
        self._kc_items.append(QLayoutItem("stretch", None, stretch or 1))
        self._kc_dirty()

    def insertStretch(self, index, stretch=0):
        self._kc_items.insert(index, QLayoutItem("stretch", None,
                                                 stretch or 1))
        self._kc_dirty()

    def addSpacing(self, size):
        self._kc_items.append(QLayoutItem("spacing", None, int(size)))
        self._kc_dirty()

    def insertSpacing(self, index, size):
        self._kc_items.insert(index, QLayoutItem("spacing", None, int(size)))
        self._kc_dirty()

    def addItem(self, item):
        self._kc_items.append(QLayoutItem("stretch", None, 1))
        self._kc_dirty()

    def addSpacerItem(self, item):
        self.addItem(item)

    def removeWidget(self, w):
        self._kc_items = [i for i in self._kc_items if i.obj is not w]
        self._kc_dirty()

    def count(self):
        return len(self._kc_items)

    def itemAt(self, index):
        if 0 <= index < len(self._kc_items):
            return self._kc_items[index]
        return None

    def takeAt(self, index):
        if 0 <= index < len(self._kc_items):
            item = self._kc_items.pop(index)
            self._kc_dirty()
            return item
        return None

    def indexOf(self, w):
        for i, item in enumerate(self._kc_items):
            if item.obj is w:
                return i
        return -1

    def setContentsMargins(self, *a):
        self._kc_margins = [int(x) for x in a] if len(a) == 4 else None

    def setSpacing(self, s):
        self._kc_spacing = int(s)

    def spacing(self):
        return self._kc_spacing or 6

    def setStretch(self, index, stretch):
        if 0 <= index < len(self._kc_items):
            self._kc_items[index].stretch = stretch

    def setStretchFactor(self, w, stretch):
        for item in self._kc_items:
            if item.obj is w:
                item.stretch = stretch

    def parentWidget(self):
        return self._kc_owner

    def setAlignment(self, *a):
        pass


class QBoxLayout(QLayout):
    TopToBottom = 2
    LeftToRight = 0
    _kc_dir = "v"

    def __init__(self, *args, **kwargs):
        if args and isinstance(args[0], int) and not isinstance(args[0],
                                                                bool):
            self._kc_dir = "h" if args[0] in (0, 1) else "v"
            args = args[1:]
        super().__init__(*args, **kwargs)

    def setDirection(self, d):
        self._kc_dir = "h" if d in (0, 1) else "v"


class QVBoxLayout(QBoxLayout):
    _kc_dir = "v"


class QHBoxLayout(QBoxLayout):
    _kc_dir = "h"


class QFormLayout(QLayout):
    """Rows of (label, field). A row with one item spans both columns."""
    AllNonFixedFieldsGrow = 2
    ExpandingFieldsGrow = 1
    LabelRole = 0
    FieldRole = 1
    SpanningRole = 2
    DontWrapRows = 0
    WrapAllRows = 2

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_rows = []            # [(label item | None, field item)]

    def _kc_item(self, obj):
        if obj is None:
            return None
        if isinstance(obj, QLayout):
            self._kc_adopt(obj)
            return QLayoutItem("l", obj)
        if isinstance(obj, QWidget):
            self._kc_adopt(obj)
            return QLayoutItem("w", obj)
        return QLayoutItem("text", str(obj))

    def addRow(self, a, b=None):
        if b is None:
            self._kc_rows.append((None, self._kc_item(a)))
        else:
            label = QLabel(str(a)) if isinstance(a, str) else a
            self._kc_rows.append((self._kc_item(label), self._kc_item(b)))
        self._kc_items = [i for row in self._kc_rows for i in row if i]
        self._kc_dirty()

    def insertRow(self, index, a, b=None):
        before = list(self._kc_rows)
        self._kc_rows = before[:index]
        self.addRow(a, b)
        self._kc_rows += before[index:]
        self._kc_items = [i for row in self._kc_rows for i in row if i]
        self._kc_dirty()

    def removeRow(self, index):
        if isinstance(index, (QWidget, QLayout)):
            index = next((i for i, (l, f) in enumerate(self._kc_rows)
                          if (f and f.obj is index) or (l and l.obj is index)),
                         -1)
        if 0 <= index < len(self._kc_rows):
            for item in self._kc_rows.pop(index):
                if item is not None and item.kind == "w":
                    item.obj.setParent(None)
            self._kc_items = [i for row in self._kc_rows for i in row if i]
            self._kc_dirty()

    def rowCount(self):
        return len(self._kc_rows)

    def setWidget(self, row, role, w):
        while len(self._kc_rows) <= row:
            self._kc_rows.append((None, None))
        label, field = self._kc_rows[row]
        item = self._kc_item(w)
        self._kc_rows[row] = (item, field) if role == 0 else (label, item)
        self._kc_items = [i for r in self._kc_rows for i in r if i]
        self._kc_dirty()

    def labelForField(self, field):
        for label, f in self._kc_rows:
            if f is not None and f.obj is field and label is not None:
                return label.obj if label.kind == "w" else None
        return None

    def setRowVisible(self, row, on):
        if isinstance(row, (QWidget, QLayout)):
            row = next((i for i, (l, f) in enumerate(self._kc_rows)
                        if f and f.obj is row), -1)
        if 0 <= row < len(self._kc_rows):
            for item in self._kc_rows[row]:
                if item is not None and item.kind == "w":
                    item.obj.setVisible(on)

    def setLabelAlignment(self, *a):
        pass

    def setFormAlignment(self, *a):
        pass

    def setFieldGrowthPolicy(self, *a):
        pass

    def setRowWrapPolicy(self, *a):
        pass

    def setHorizontalSpacing(self, *a):
        pass

    def setVerticalSpacing(self, *a):
        pass


class QGridLayout(QLayout):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_cells = []           # [(row, col, rspan, cspan, item)]
        self._kc_col_stretch = {}

    def addWidget(self, w, row=None, col=None, rspan=1, cspan=1, *a):
        if row is None:
            row, col = len(self._kc_cells), 0
        if not isinstance(rspan, int) or isinstance(rspan, bool):
            rspan, cspan = 1, 1
        item = QLayoutItem("w", w)
        self._kc_cells.append((int(row), int(col), int(rspan),
                               int(cspan) if isinstance(cspan, int) else 1,
                               item))
        self._kc_items.append(item)
        self._kc_adopt(w)
        self._kc_dirty()

    def addLayout(self, layout, row=0, col=0, rspan=1, cspan=1, *a):
        item = QLayoutItem("l", layout)
        self._kc_cells.append((int(row), int(col), int(rspan), int(cspan),
                               item))
        self._kc_items.append(item)
        self._kc_adopt(layout)
        self._kc_dirty()

    def setColumnStretch(self, col, stretch):
        self._kc_col_stretch[int(col)] = int(stretch)

    def setRowStretch(self, *a):
        pass

    def setColumnMinimumWidth(self, *a):
        pass

    def setHorizontalSpacing(self, *a):
        pass

    def setVerticalSpacing(self, *a):
        pass

    def rowCount(self):
        return max((r + rs for r, _c, rs, _cs, _i in self._kc_cells),
                   default=0)

    def columnCount(self):
        return max((c + cs for _r, c, _rs, cs, _i in self._kc_cells),
                   default=0)

    def itemAtPosition(self, row, col):
        for r, c, _rs, _cs, item in self._kc_cells:
            if r == row and c == col:
                return item
        return None


class QStackedLayout(QLayout):
    pass


class QSpacerItem(Inert):
    pass


# ----------------------------------------------------------------- actions

class QKeySequence(Inert):
    Copy, Cut, Paste, Delete, Undo, Redo, SelectAll, New, Open, Save, \
        Find, Quit, Close, Print, ZoomIn, ZoomOut, Refresh, HelpContents, \
        SaveAs, Preferences, Back, Forward = range(1, 23)
    NativeText = 1
    PortableText = 0
    _STD = {1: "Ctrl+C", 2: "Ctrl+X", 3: "Ctrl+V", 4: "Del", 5: "Ctrl+Z",
            6: "Ctrl+Y", 7: "Ctrl+A", 8: "Ctrl+N", 9: "Ctrl+O",
            10: "Ctrl+S", 11: "Ctrl+F", 12: "Ctrl+Q", 13: "Ctrl+W",
            14: "Ctrl+P", 15: "Ctrl++", 16: "Ctrl+-", 17: "F5", 18: "F1",
            19: "Ctrl+Shift+S"}

    def __init__(self, key=""):
        if isinstance(key, QKeySequence):
            key = key._kc_key
        elif isinstance(key, int):
            key = self._STD.get(key, "")
        self._kc_key = str(key or "")

    def toString(self, *_a):
        return self._kc_key

    def isEmpty(self):
        return not self._kc_key

    def __str__(self):
        return self._kc_key

    def __eq__(self, other):
        return str(other) == self._kc_key

    def __hash__(self):
        return hash(self._kc_key)

    def matches(self, other):
        return 2 if str(other) == self._kc_key else 0


def _keys(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [k for v in value for k in _keys(v)]
    s = str(value)
    return [s] if s else []


class QAction(InertObject, KcBase):
    triggered = pyqtSignal(bool)
    toggled = pyqtSignal(bool)
    changed = pyqtSignal()
    hovered = pyqtSignal()
    NoRole = 0
    TextHeuristicRole = 1

    def __init__(self, *args, **kwargs):
        icon, text, parent = None, "", None
        for a in args:
            if isinstance(a, QIcon):
                icon = a
            elif isinstance(a, str):
                text = a
            elif isinstance(a, QObject):
                parent = a
        QObject.__init__(self, parent)
        self._kc_init()
        self._kc_text = text
        self._kc_icon = icon
        self._kc_shortcuts = []
        self._kc_checkable = bool(kwargs.get("checkable", False))
        self._kc_checked = False
        self._kc_enabled = True
        self._kc_visible = True
        self._kc_data = None
        self._kc_tip = ""
        self._kc_status = ""
        self._kc_menu = None
        self._kc_sep = False
        self._kc_group = None
        self._kc_widget = None        # QWidgetAction / toolbar widget

    def _changed(self):
        self._touch()
        self.changed.emit()

    def text(self):
        return self._kc_text

    def setText(self, t):
        self._kc_text = str(t or "")
        self._changed()

    def iconText(self):
        return _plain(self._kc_text)

    def setIconText(self, *a):
        pass

    def icon(self):
        return self._kc_icon if self._kc_icon is not None else QIcon()

    def setIcon(self, icon):
        self._kc_icon = icon
        self._changed()

    def setShortcut(self, key):
        self._kc_shortcuts = _keys(key)[:1]
        self._changed()

    def setShortcuts(self, keys):
        if isinstance(keys, int):
            keys = [QKeySequence(keys)]
        self._kc_shortcuts = _keys(keys)
        self._changed()

    def shortcut(self):
        return QKeySequence(self._kc_shortcuts[0] if self._kc_shortcuts
                            else "")

    def shortcuts(self):
        return [QKeySequence(k) for k in self._kc_shortcuts]

    def setShortcutContext(self, *a):
        pass

    def setCheckable(self, on):
        self._kc_checkable = bool(on)
        self._changed()

    def isCheckable(self):
        return self._kc_checkable

    def setChecked(self, on):
        on = bool(on)
        if not self._kc_checkable or on == self._kc_checked:
            return
        self._kc_checked = on
        if on and self._kc_group is not None:
            self._kc_group._kc_exclusive_check(self)
        self._changed()
        self.toggled.emit(on)

    def isChecked(self):
        return self._kc_checked

    def setEnabled(self, on):
        self._kc_enabled = bool(on)
        self._changed()

    def setDisabled(self, off):
        self.setEnabled(not off)

    def isEnabled(self):
        if self._kc_group is not None and not self._kc_group._kc_enabled:
            return False
        return self._kc_enabled

    def setVisible(self, on):
        self._kc_visible = bool(on)
        self._changed()
        if self._kc_widget is not None:
            self._kc_widget.setVisible(on)

    def isVisible(self):
        return self._kc_visible

    def setData(self, value):
        self._kc_data = value

    def data(self):
        return self._kc_data

    def setToolTip(self, tip):
        self._kc_tip = str(tip or "")
        self._touch()

    def toolTip(self):
        return self._kc_tip or _plain(self._kc_text).split("\t")[0]

    def setStatusTip(self, tip):
        self._kc_status = str(tip or "")

    def statusTip(self):
        return self._kc_status

    def setWhatsThis(self, *a):
        pass

    def setMenu(self, menu):
        self._kc_menu = menu
        self._changed()

    def menu(self):
        return self._kc_menu

    def setSeparator(self, on):
        self._kc_sep = bool(on)

    def isSeparator(self):
        return self._kc_sep

    def setActionGroup(self, group):
        if group is not None:
            group.addAction(self)

    def actionGroup(self):
        return self._kc_group

    def setMenuRole(self, *a):
        pass

    def setPriority(self, *a):
        pass

    def setAutoRepeat(self, *a):
        pass

    def setFont(self, *a):
        pass

    def trigger(self):
        if not self.isEnabled():
            return
        if self._kc_checkable:
            if self._kc_group is not None and self._kc_group._kc_exclusive \
                    and self._kc_checked:
                pass                       # an exclusive group stays on
            else:
                self.setChecked(not self._kc_checked)
        self.triggered.emit(self._kc_checked)
        if self._kc_group is not None:
            self._kc_group.triggered.emit(self)

    def activate(self, *_a):
        self.trigger()

    def toggle(self):
        if self._kc_checkable:
            self.setChecked(not self._kc_checked)

    def defaultWidget(self):
        return self._kc_widget

    def setDefaultWidget(self, w):
        self._kc_widget = w

    def associatedWidgets(self):
        return []


class QWidgetAction(QAction):
    pass


class QActionGroup(InertObject, KcBase):
    triggered = pyqtSignal(object)
    hovered = pyqtSignal(object)

    def __init__(self, *a, **k):
        QObject.__init__(self, a[0] if a and isinstance(a[0], QObject)
                         else None)
        self._kc_init()
        self._kc_actions = []
        self._kc_exclusive = True
        self._kc_enabled = True

    def addAction(self, action, *a):
        if isinstance(action, str):
            action = QAction(action, self)
        action._kc_group = self
        if action not in self._kc_actions:
            self._kc_actions.append(action)
        return action

    def removeAction(self, action):
        if action in self._kc_actions:
            self._kc_actions.remove(action)
            action._kc_group = None

    def actions(self):
        return list(self._kc_actions)

    def setExclusive(self, on):
        self._kc_exclusive = bool(on)

    def isExclusive(self):
        return self._kc_exclusive

    def setExclusionPolicy(self, *a):
        pass

    def setEnabled(self, on):
        self._kc_enabled = bool(on)
        for a in self._kc_actions:
            a._touch()

    def setVisible(self, on):
        for a in self._kc_actions:
            a.setVisible(on)

    def checkedAction(self):
        return next((a for a in self._kc_actions if a.isChecked()), None)

    def _kc_exclusive_check(self, chosen):
        if not self._kc_exclusive:
            return
        for a in self._kc_actions:
            if a is not chosen and a._kc_checked:
                a._kc_checked = False
                a._changed()
                a.toggled.emit(False)


class _ActionContainer:
    """addAction / addSeparator / actions shared by menus and toolbars."""

    def _kc_actions_init(self):
        self._kc_actions = []

    def _kc_new_action(self, args, kwargs):
        if args and isinstance(args[0], QAction):
            return args[0]
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        strings = [a for a in args if isinstance(a, str)]
        text = strings[0] if strings else ""
        act = QAction(text, self)
        if icon is not None:
            act.setIcon(icon)
        slot = next((a for a in args if callable(a)
                     and not isinstance(a, (QObject, str, QIcon))), None)
        if slot is None:
            slot = next((a for a in args if hasattr(a, "emit")
                         and hasattr(a, "connect")), None)
        if slot is not None:
            act.triggered.connect(slot)
        keys = [a for a in args if isinstance(a, QKeySequence)] + \
            strings[1:2]
        if keys and keys[0]:
            act.setShortcut(keys[0])
        return act

    def addAction(self, *args, **kwargs):
        act = self._kc_new_action(args, kwargs)
        self._kc_actions.append(act)
        self._touch()
        return act

    def addActions(self, actions):
        for a in actions:
            self.addAction(a)

    def insertAction(self, before, action):
        if before in self._kc_actions:
            self._kc_actions.insert(self._kc_actions.index(before), action)
        else:
            self._kc_actions.append(action)
        self._touch()

    def insertSeparator(self, before):
        act = QAction(self)
        act.setSeparator(True)
        self.insertAction(before, act)
        return act

    def removeAction(self, action):
        if action in self._kc_actions:
            self._kc_actions.remove(action)
            self._touch()

    def addSeparator(self):
        act = QAction(self)
        act.setSeparator(True)
        self._kc_actions.append(act)
        self._touch()
        return act

    def actions(self):
        return list(self._kc_actions)

    def clear(self):
        self._kc_actions = []
        self._touch()


#: menus opened by the desktop code with exec_()/popup(), waiting for the
#: web side to show them: [(menu, (x, y) or None)]
POPUPS = []


class QMenu(QWidget, _ActionContainer):
    aboutToShow = pyqtSignal()
    aboutToHide = pyqtSignal()
    triggered = pyqtSignal(object)
    hovered = pyqtSignal(object)

    def __init__(self, *args, **kwargs):
        title = next((a for a in args if isinstance(a, str)), "")
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_actions_init()
        self._kc_title = title
        self._kc_icon = None
        self._kc_menu_action = None

    def title(self):
        return self._kc_title

    def setTitle(self, t):
        self._kc_title = str(t or "")
        if self._kc_menu_action is not None:
            self._kc_menu_action.setText(self._kc_title)
        self._touch()

    def icon(self):
        return self._kc_icon or QIcon()

    def setIcon(self, icon):
        self._kc_icon = icon
        if self._kc_menu_action is not None:
            self._kc_menu_action.setIcon(icon)

    def menuAction(self):
        if self._kc_menu_action is None:
            act = QAction(self._kc_title, self)
            act.setMenu(self)
            if self._kc_icon is not None:
                act.setIcon(self._kc_icon)
            self._kc_menu_action = act
        return self._kc_menu_action

    def addMenu(self, *args):
        if args and isinstance(args[0], QMenu):
            menu = args[0]
        else:
            icon = next((a for a in args if isinstance(a, QIcon)), None)
            title = next((a for a in args if isinstance(a, str)), "")
            menu = QMenu(title, self)
            if icon is not None:
                menu.setIcon(icon)
        self._kc_actions.append(menu.menuAction())
        self._touch()
        return menu

    def addSection(self, text=""):
        act = self.addSeparator()
        act.setText(text)
        return act

    def isEmpty(self):
        return not self._kc_actions

    def setToolTipsVisible(self, *a):
        pass

    def setSeparatorsCollapsible(self, *a):
        pass

    def exec_(self, *args):
        pos = args[0] if args else None
        POPUPS.append((self, (pos.x(), pos.y()) if isinstance(pos, QPointF)
                       else None))
        return None

    exec = exec_

    def popup(self, *args):
        self.exec_(*args)

    def setActiveAction(self, *a):
        pass

    def setDefaultAction(self, *a):
        pass


class QMenuBar(QWidget, _ActionContainer):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_actions_init()

    def addMenu(self, *args):
        if args and isinstance(args[0], QMenu):
            menu = args[0]
        else:
            icon = next((a for a in args if isinstance(a, QIcon)), None)
            title = next((a for a in args if isinstance(a, str)), "")
            menu = QMenu(title, self)
            if icon is not None:
                menu.setIcon(icon)
        self._kc_actions.append(menu.menuAction())
        self._touch()
        return menu

    def setNativeMenuBar(self, *a):
        pass


# ----------------------------------------------------------------- buttons

class QAbstractButton(QWidget):
    clicked = pyqtSignal(bool)
    toggled = pyqtSignal(bool)
    pressed = pyqtSignal()
    released = pyqtSignal()

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_text = next((a for a in args if isinstance(a, str)), "")
        self._kc_icon = next((a for a in args if isinstance(a, QIcon)), None)
        self._kc_checkable = False
        self._kc_checked = False
        self._kc_group = None
        self._kc_auto_exclusive = False
        self._kc_repeat = False
        self._kc_shortcut = ""

    def text(self):
        return self._kc_text

    def setText(self, t):
        self._kc_text = str(t or "")
        self._touch()

    def icon(self):
        return self._kc_icon or QIcon()

    def setIcon(self, icon):
        self._kc_icon = icon
        self._touch()

    def setIconSize(self, *a):
        pass

    def setCheckable(self, on):
        self._kc_checkable = bool(on)
        self._touch()

    def isCheckable(self):
        return self._kc_checkable

    def setChecked(self, on):
        on = bool(on)
        if not self._kc_checkable or on == self._kc_checked:
            return
        self._kc_checked = on
        if on:
            self._kc_exclusive_others()
        self._touch()
        self.toggled.emit(on)
        self._kc_state_changed()

    def _kc_state_changed(self):
        pass

    def _kc_exclusive_others(self):
        peers = []
        if self._kc_group is not None and self._kc_group._kc_exclusive:
            peers = self._kc_group._kc_buttons
        elif self._kc_auto_exclusive:
            p = self.parentWidget()
            peers = [c for c in (p._kc_children if p else [])
                     if isinstance(c, type(self)) and c._kc_auto_exclusive
                     and c._kc_group is None]
        for b in peers:
            if b is not self and b._kc_checked:
                b._kc_checked = False
                b._touch()
                b.toggled.emit(False)
                b._kc_state_changed()

    def isChecked(self):
        return self._kc_checked

    def toggle(self):
        self.setChecked(not self._kc_checked)

    def click(self):
        if not self.isEnabled():
            return
        if self._kc_checkable:
            if not (self._kc_checked and (self._kc_auto_exclusive or (
                    self._kc_group is not None
                    and self._kc_group._kc_exclusive))):
                self.setChecked(not self._kc_checked)
        self.pressed.emit()
        self.released.emit()
        self.clicked.emit(self._kc_checked)
        if self._kc_group is not None:
            self._kc_group._kc_clicked(self)

    animateClick = click

    def setAutoExclusive(self, on):
        self._kc_auto_exclusive = bool(on)

    def setAutoRepeat(self, on):
        self._kc_repeat = bool(on)

    def autoRepeat(self):
        return self._kc_repeat

    def setAutoRepeatDelay(self, *a):
        pass

    def setAutoRepeatInterval(self, *a):
        pass

    def setShortcut(self, key):
        self._kc_shortcut = str(key or "")

    def group(self):
        return self._kc_group


class QPushButton(QAbstractButton):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_default = False
        self._kc_menu = None
        self._kc_flat = False

    def setDefault(self, on):
        self._kc_default = bool(on)

    def isDefault(self):
        return self._kc_default

    def setAutoDefault(self, *a):
        pass

    def setFlat(self, on):
        self._kc_flat = bool(on)

    def setMenu(self, menu):
        self._kc_menu = menu
        self._touch()

    def menu(self):
        return self._kc_menu


class QToolButton(QAbstractButton):
    MenuButtonPopup = 1
    InstantPopup = 2
    DelayedPopup = 0
    triggered = pyqtSignal(object)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_default_action = None
        self._kc_menu = None
        self._kc_popup = 0
        self._kc_style_mode = 0
        self._kc_auto_raise = False

    def setDefaultAction(self, action):
        old = self._kc_default_action
        if old is not None:
            try:
                old.changed.disconnect(self._touch)
            except TypeError:
                pass
        self._kc_default_action = action
        if action is not None:
            action.changed.connect(self._touch)
        self._touch()

    def defaultAction(self):
        return self._kc_default_action

    def text(self):
        a = self._kc_default_action
        return a.text() if a is not None and not self._kc_text else \
            self._kc_text

    def icon(self):
        a = self._kc_default_action
        if a is not None and self._kc_icon is None:
            return a.icon()
        return self._kc_icon or QIcon()

    def isCheckable(self):
        a = self._kc_default_action
        return a.isCheckable() if a is not None else self._kc_checkable

    def isChecked(self):
        a = self._kc_default_action
        return a.isChecked() if a is not None else self._kc_checked

    def toolTip(self):
        if self._kc_tip:
            return self._kc_tip
        a = self._kc_default_action
        return a.toolTip() if a is not None else ""

    def isEnabled(self):
        a = self._kc_default_action
        if a is not None and not a.isEnabled():
            return False
        return super().isEnabled()

    def click(self):
        a = self._kc_default_action
        if a is not None:
            a.trigger()
            self.triggered.emit(a)
            self.clicked.emit(a.isChecked())
            return
        super().click()

    def setMenu(self, menu):
        self._kc_menu = menu
        self._touch()

    def menu(self):
        return self._kc_menu

    def setPopupMode(self, mode):
        self._kc_popup = int(mode)

    def popupMode(self):
        return self._kc_popup

    def setToolButtonStyle(self, style):
        self._kc_style_mode = int(style)
        self._touch()

    def toolButtonStyle(self):
        return self._kc_style_mode

    def setAutoRaise(self, on):
        self._kc_auto_raise = bool(on)

    def setArrowType(self, *a):
        pass

    def showMenu(self):
        if self._kc_menu is not None:
            self._kc_menu.exec_()


class QCheckBox(QAbstractButton):
    stateChanged = pyqtSignal(int)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_checkable = True

    def _kc_state_changed(self):
        self.stateChanged.emit(2 if self._kc_checked else 0)

    def checkState(self):
        return 2 if self._kc_checked else 0

    def setCheckState(self, state):
        self.setChecked(int(state) != 0)

    def setTristate(self, *a):
        pass


class QRadioButton(QAbstractButton):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_checkable = True
        self._kc_auto_exclusive = True


class QButtonGroup(InertObject, KcBase):
    buttonClicked = pyqtSignal(object)
    idClicked = pyqtSignal(int)
    buttonToggled = pyqtSignal(object, bool)

    def __init__(self, *a, **k):
        QObject.__init__(self, a[0] if a and isinstance(a[0], QObject)
                         else None)
        self._kc_init()
        self._kc_buttons = []
        self._kc_ids = {}
        self._kc_exclusive = True

    def addButton(self, button, bid=-1):
        button._kc_group = self
        self._kc_buttons.append(button)
        self._kc_ids[id(button)] = bid if bid != -1 else \
            -2 - len(self._kc_buttons)
        button.toggled.connect(lambda on, b=button:
                               self.buttonToggled.emit(b, on))

    def buttons(self):
        return list(self._kc_buttons)

    def button(self, bid):
        return next((b for b in self._kc_buttons
                     if self._kc_ids.get(id(b)) == bid), None)

    def id(self, button):
        return self._kc_ids.get(id(button), -1)

    def checkedButton(self):
        return next((b for b in self._kc_buttons if b.isChecked()), None)

    def checkedId(self):
        b = self.checkedButton()
        return self.id(b) if b is not None else -1

    def setExclusive(self, on):
        self._kc_exclusive = bool(on)

    def _kc_clicked(self, button):
        self.buttonClicked.emit(button)
        self.idClicked.emit(self.id(button))


# ------------------------------------------------------------------- labels

class QLabel(QWidget):
    linkActivated = pyqtSignal(str)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_text = next((a for a in args if isinstance(a, str)), "")
        self._kc_wrap = False
        self._kc_align = 0
        self._kc_pixmap = None

    def text(self):
        return self._kc_text

    def setText(self, t):
        t = str(t if t is not None else "")
        if t != self._kc_text:
            self._kc_text = t
            self._touch()

    def setNum(self, n):
        self.setText(f"{n:g}" if isinstance(n, float) else str(n))

    def clear(self):
        self.setText("")

    def setWordWrap(self, on):
        self._kc_wrap = bool(on)

    def wordWrap(self):
        return self._kc_wrap

    def setAlignment(self, a):
        self._kc_align = int(a) if isinstance(a, int) else 0

    def setPixmap(self, pm):
        self._kc_pixmap = pm
        self._touch()

    def setTextFormat(self, *a):
        pass

    def setOpenExternalLinks(self, *a):
        pass

    def setTextInteractionFlags(self, *a):
        pass

    def setBuddy(self, *a):
        pass

    def setMargin(self, *a):
        pass

    def setIndent(self, *a):
        pass


# ------------------------------------------------------------------ inputs

class QLineEdit(QWidget):
    textChanged = pyqtSignal(str)
    textEdited = pyqtSignal(str)
    editingFinished = pyqtSignal()
    returnPressed = pyqtSignal()
    Normal = 0
    Password = 2

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_text = next((a for a in args if isinstance(a, str)), "")
        self._kc_placeholder = ""
        self._kc_readonly = False
        self._kc_maxlen = 0
        self._kc_password = False

    def text(self):
        return self._kc_text

    def setText(self, t):
        t = str(t if t is not None else "")
        if t != self._kc_text:
            self._kc_text = t
            self._touch()
            self.textChanged.emit(t)

    def displayText(self):
        return self._kc_text

    def clear(self):
        self.setText("")

    def setPlaceholderText(self, t):
        self._kc_placeholder = str(t or "")
        self._touch()

    def placeholderText(self):
        return self._kc_placeholder

    def setReadOnly(self, on):
        self._kc_readonly = bool(on)
        self._touch()

    def isReadOnly(self):
        return self._kc_readonly

    def setMaxLength(self, n):
        self._kc_maxlen = int(n)

    def setEchoMode(self, mode):
        self._kc_password = int(mode) == 2
        self._touch()

    def selectAll(self):
        pass

    def setValidator(self, *a):
        pass

    def setCompleter(self, *a):
        pass

    def setClearButtonEnabled(self, *a):
        pass

    def setAlignment(self, *a):
        pass

    def setCursorPosition(self, *a):
        pass

    def insert(self, text):
        self.setText(self._kc_text + str(text))

    # the web side: a finished edit (Enter or leaving the field)
    def _kc_commit(self, text):
        if text != self._kc_text:
            self._kc_text = text
            self._touch()
            self.textEdited.emit(text)
            self.textChanged.emit(text)
        self.editingFinished.emit()


class QTextEdit(QWidget):
    textChanged = pyqtSignal()
    anchorClicked = pyqtSignal(object)
    NoWrap = 0
    WidgetWidth = 1

    class ExtraSelection(Inert):
        pass

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_text = next((a for a in args if isinstance(a, str)), "")
        self._kc_html = False
        self._kc_readonly = False
        self._kc_placeholder = ""
        self._kc_wrap = True
        self._kc_marks = []

    def toPlainText(self):
        if self._kc_html:
            return re.sub(r"<[^>]+>", "", self._kc_text)
        return self._kc_text

    def setPlainText(self, t):
        self._kc_text = str(t or "")
        self._kc_html = False
        self._touch()
        self.textChanged.emit()

    def setText(self, t):
        t = str(t or "")
        self._kc_html = bool(re.search(r"<[a-zA-Z][^>]*>", t))
        self._kc_text = t
        self._touch()
        self.textChanged.emit()

    def setHtml(self, t):
        self._kc_text = str(t or "")
        self._kc_html = True
        self._touch()
        self.textChanged.emit()

    def setMarkdown(self, t):
        self.setPlainText(t)

    def toHtml(self):
        return self._kc_text

    def append(self, t):
        sep = "<br>" if self._kc_html else "\n"
        self._kc_text = (self._kc_text + sep if self._kc_text else "") + \
            str(t)
        self._touch()
        self.textChanged.emit()

    appendPlainText = append
    appendHtml = append

    def insertPlainText(self, t):
        self._kc_text += str(t)
        self._touch()
        self.textChanged.emit()

    def clear(self):
        self.setPlainText("")

    def setReadOnly(self, on):
        self._kc_readonly = bool(on)
        self._touch()

    def isReadOnly(self):
        return self._kc_readonly

    def setPlaceholderText(self, t):
        self._kc_placeholder = str(t or "")

    def setLineWrapMode(self, mode):
        self._kc_wrap = int(mode) != 0
        self._touch()

    def lineWrapMode(self):
        return 1 if self._kc_wrap else 0

    def setExtraSelections(self, sels):
        self._kc_marks = list(sels)

    # editing commands the web editor performs itself (it is told through
    # _kc_command, the code tab's toolbar triggers these)
    def _kc_cmd(self, name):
        self._kc_command = (name, _next_rev())
        self._touch()

    def undo(self):
        self._kc_cmd("undo")

    def redo(self):
        self._kc_cmd("redo")

    def cut(self):
        self._kc_cmd("cut")

    def copy(self):
        self._kc_cmd("copy")

    def paste(self):
        self._kc_cmd("paste")

    def selectAll(self):
        self._kc_cmd("selectAll")

    def document(self):
        return Inert()

    def textCursor(self):
        return Inert()

    def setTextCursor(self, *a):
        pass

    def ensureCursorVisible(self):
        pass

    def moveCursor(self, *a):
        pass

    def setTabStopDistance(self, *a):
        pass

    def setWordWrapMode(self, *a):
        pass

    def setViewportMargins(self, *a):
        pass

    def contentsRect(self):
        return QRectF(0, 0, self._kc_w, self._kc_h)

    def firstVisibleBlock(self):
        return Inert()

    def createStandardContextMenu(self, *a):
        return QMenu(self)

    def setUndoRedoEnabled(self, *a):
        pass

    def setAcceptRichText(self, *a):
        pass

    def setTabChangesFocus(self, *a):
        pass

    def setCurrentFont(self, *a):
        pass

    def zoomIn(self, *a):
        pass

    def zoomOut(self, *a):
        pass

    def find(self, *a):
        return False

    def _kc_commit(self, text):
        if text != self._kc_text:
            self._kc_text = text
            self._kc_html = False
            self._touch()
            self.textChanged.emit()


class QPlainTextEdit(QTextEdit):
    blockCountChanged = pyqtSignal(int)
    updateRequest = pyqtSignal(object, int)

    def blockCount(self):
        return self._kc_text.count("\n") + 1


class QTextBrowser(QTextEdit):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_readonly = True
        self._kc_html = True

    def setSource(self, *a):
        pass

    def setOpenExternalLinks(self, *a):
        pass

    def setOpenLinks(self, *a):
        pass

    def setSearchPaths(self, paths):
        self._kc_search = [str(p) for p in paths or []]
        self._touch()


class QAbstractSpinBox(QWidget):
    editingFinished = pyqtSignal()
    AdaptiveDecimalStepType = 1
    DefaultStepType = 0
    NoButtons = 2
    UpDownArrows = 0

    def setKeyboardTracking(self, *a):
        pass

    def setStepType(self, *a):
        pass

    def setButtonSymbols(self, *a):
        pass

    def setAccelerated(self, *a):
        pass

    def setCorrectionMode(self, *a):
        pass

    def setAlignment(self, *a):
        pass

    def setReadOnly(self, on):
        self._kc_readonly = bool(on)

    def setWrapping(self, *a):
        pass

    def setSpecialValueText(self, t):
        self._kc_special = str(t or "")

    def lineEdit(self):
        return Inert()

    def selectAll(self):
        pass


class QDoubleSpinBox(QAbstractSpinBox):
    valueChanged = pyqtSignal(float)
    textChanged = pyqtSignal(str)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_min, self._kc_max = 0.0, 99.99
        self._kc_value = 0.0
        self._kc_step = 1.0
        self._kc_decimals = 2
        self._kc_suffix = ""
        self._kc_prefix = ""
        self._kc_special = ""

    def _kc_round(self, v):
        return round(float(v), self._kc_decimals)

    def setValue(self, v):
        try:
            v = self._kc_round(min(max(float(v), self._kc_min), self._kc_max))
        except (TypeError, ValueError):
            return
        if v != self._kc_value:
            self._kc_value = v
            self._touch()
            self.valueChanged.emit(v)
            self.textChanged.emit(self.text())

    def value(self):
        return self._kc_value

    def text(self):
        return f"{self._kc_prefix}{self._kc_value:.{self._kc_decimals}f}" \
            f"{self._kc_suffix}"

    def cleanText(self):
        return f"{self._kc_value:.{self._kc_decimals}f}"

    def setRange(self, lo, hi):
        self._kc_min, self._kc_max = float(lo), float(hi)
        self._touch()
        self.setValue(self._kc_value)

    def setMinimum(self, lo):
        self.setRange(lo, max(lo, self._kc_max))

    def setMaximum(self, hi):
        self.setRange(min(self._kc_min, hi), hi)

    def minimum(self):
        return self._kc_min

    def maximum(self):
        return self._kc_max

    def setSingleStep(self, s):
        self._kc_step = float(s)

    def singleStep(self):
        return self._kc_step

    def setDecimals(self, d):
        self._kc_decimals = int(d)
        self._touch()

    def decimals(self):
        return self._kc_decimals

    def setSuffix(self, s):
        self._kc_suffix = str(s or "")
        self._touch()

    def suffix(self):
        return self._kc_suffix

    def setPrefix(self, s):
        self._kc_prefix = str(s or "")
        self._touch()

    def prefix(self):
        return self._kc_prefix

    def stepBy(self, n):
        self.setValue(self._kc_value + n * self._kc_step)

    def textFromValue(self, v):
        return f"{v:.{self._kc_decimals}f}"

    def _kc_commit(self, value):
        self.setValue(value)
        self.editingFinished.emit()


class QSpinBox(QDoubleSpinBox):
    valueChanged = pyqtSignal(int)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_min, self._kc_max = 0, 99
        self._kc_value = 0
        self._kc_decimals = 0

    def _kc_round(self, v):
        return int(round(float(v)))

    def setRange(self, lo, hi):
        self._kc_min, self._kc_max = int(lo), int(hi)
        self._touch()
        self.setValue(self._kc_value)

    def text(self):
        return f"{self._kc_prefix}{self._kc_value}{self._kc_suffix}"

    def cleanText(self):
        return str(self._kc_value)

    def setSingleStep(self, s):
        self._kc_step = int(s) or 1

    def setDisplayIntegerBase(self, *a):
        pass


class QAbstractSlider(QWidget):
    valueChanged = pyqtSignal(int)
    sliderMoved = pyqtSignal(int)
    sliderPressed = pyqtSignal()
    sliderReleased = pyqtSignal()
    rangeChanged = pyqtSignal(int, int)
    actionTriggered = pyqtSignal(int)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        orient = next((a for a in args if isinstance(a, int)
                       and not isinstance(a, bool)), 1)
        self._kc_orient = orient
        self._kc_min, self._kc_max = 0, 99
        self._kc_value = 0
        self._kc_step, self._kc_page = 1, 10
        self._kc_down = False

    def setValue(self, v):
        v = int(min(max(int(round(float(v))), self._kc_min), self._kc_max))
        if v != self._kc_value:
            self._kc_value = v
            self._touch()
            self.valueChanged.emit(v)

    def value(self):
        return self._kc_value

    def setRange(self, lo, hi):
        self._kc_min, self._kc_max = int(lo), int(hi)
        self._touch()
        self.setValue(self._kc_value)

    def setMinimum(self, lo):
        self.setRange(lo, self._kc_max)

    def setMaximum(self, hi):
        self.setRange(self._kc_min, hi)

    def minimum(self):
        return self._kc_min

    def maximum(self):
        return self._kc_max

    def setSingleStep(self, s):
        self._kc_step = int(s)

    def singleStep(self):
        return self._kc_step

    def setPageStep(self, s):
        self._kc_page = int(s)

    def pageStep(self):
        return self._kc_page

    def setOrientation(self, o):
        self._kc_orient = int(o)

    def orientation(self):
        return self._kc_orient

    def setTickPosition(self, *a):
        pass

    def setTickInterval(self, *a):
        pass

    def setTracking(self, *a):
        pass

    def isSliderDown(self):
        return self._kc_down

    def setInvertedAppearance(self, *a):
        pass


class QSlider(QAbstractSlider):
    TicksBelow = 2
    TicksAbove = 1
    NoTicks = 0
    TicksBothSides = 3


class QScrollBar(QAbstractSlider):
    pass


class QDial(QAbstractSlider):
    pass


class QProgressBar(QWidget):
    valueChanged = pyqtSignal(int)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_min, self._kc_max, self._kc_value = 0, 100, 0
        self._kc_format = "%p%"
        self._kc_text_visible = True

    def setRange(self, lo, hi):
        self._kc_min, self._kc_max = int(lo), int(hi)
        self._touch()

    def setMinimum(self, lo):
        self._kc_min = int(lo)

    def setMaximum(self, hi):
        self._kc_max = int(hi)
        self._touch()

    def setValue(self, v):
        self._kc_value = int(v)
        self._touch()
        self.valueChanged.emit(self._kc_value)

    def value(self):
        return self._kc_value

    def maximum(self):
        return self._kc_max

    def minimum(self):
        return self._kc_min

    def setFormat(self, f):
        self._kc_format = str(f)

    def setTextVisible(self, on):
        self._kc_text_visible = bool(on)

    def reset(self):
        self.setValue(self._kc_min)


class _StandardItem(Inert):
    """QComboBox().model().item(i) — enough to disable a row."""

    def __init__(self, combo, index):
        self._combo, self._index = combo, index

    def flags(self):
        e = self._combo._kc_items[self._index].get("enabled", True)
        return 0x21 if e else 0

    def setFlags(self, flags):
        self._combo._kc_items[self._index]["enabled"] = bool(int(flags) & 0x20)
        self._combo._touch()

    def setEnabled(self, on):
        self._combo._kc_items[self._index]["enabled"] = bool(on)
        self._combo._touch()

    def isEnabled(self):
        return self._combo._kc_items[self._index].get("enabled", True)

    def setToolTip(self, tip):
        self._combo._kc_items[self._index]["tip"] = str(tip)

    def setSelectable(self, on):
        self.setEnabled(on)

    def text(self):
        return self._combo.itemText(self._index)

    def setForeground(self, *a):
        pass

    def setFont(self, *a):
        pass

    def setData(self, value, role=None):
        self._combo.setItemData(self._index, value, role)


class _ComboModel(Inert):
    def __init__(self, combo):
        self._combo = combo

    def item(self, row, *_a):
        if 0 <= row < len(self._combo._kc_items):
            return _StandardItem(self._combo, row)
        return None

    def rowCount(self, *_a):
        return self._combo.count()


class QComboBox(QWidget):
    currentIndexChanged = pyqtSignal(int)
    currentTextChanged = pyqtSignal(str)
    activated = pyqtSignal(int)
    textActivated = pyqtSignal(str)
    editTextChanged = pyqtSignal(str)
    highlighted = pyqtSignal(int)
    NoInsert = 0
    AdjustToContents = 0
    AdjustToMinimumContentsLengthWithIcon = 1
    InsertAtBottom = 3

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_items = []           # [{text, data, icon, enabled, sep}]
        self._kc_index = -1
        self._kc_editable = False
        self._kc_edit_text = ""
        self._kc_line = None

    # -- items
    def _kc_set_index(self, index, emit=True):
        if index == self._kc_index:
            return
        self._kc_index = index
        if self._kc_editable:
            self._kc_edit_text = self.itemText(index) if index >= 0 else ""
            if self._kc_line is not None:
                self._kc_line._kc_text = self._kc_edit_text
        self._touch()
        if emit:
            self.currentIndexChanged.emit(index)
            self.currentTextChanged.emit(self.currentText())

    def addItem(self, *args):
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        strings = [a for a in args if isinstance(a, str)]
        text = strings[0] if strings else ""
        rest = [a for a in args if not isinstance(a, QIcon)]
        data = rest[1] if len(rest) > 1 else None
        self._kc_items.append(dict(text=text, data=data,
                                   icon=_icon_name(icon), enabled=True))
        self._touch()
        if self._kc_index < 0:
            self._kc_set_index(0)

    def addItems(self, texts):
        for t in texts:
            self.addItem(str(t))

    def insertItem(self, index, *args):
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        rest = [a for a in args if not isinstance(a, QIcon)]
        text = rest[0] if rest else ""
        data = rest[1] if len(rest) > 1 else None
        index = max(0, min(int(index), len(self._kc_items)))
        self._kc_items.insert(index, dict(text=str(text), data=data,
                                          icon=_icon_name(icon),
                                          enabled=True))
        if self._kc_index >= index:
            self._kc_index += 1
        self._touch()
        if self._kc_index < 0:
            self._kc_set_index(0)

    def insertItems(self, index, texts):
        for i, t in enumerate(texts):
            self.insertItem(index + i, t)

    def insertSeparator(self, index):
        self._kc_items.insert(index, dict(text="", data=None, icon=None,
                                          enabled=False, sep=True))
        self._touch()

    def removeItem(self, index):
        if 0 <= index < len(self._kc_items):
            self._kc_items.pop(index)
            if self._kc_index >= len(self._kc_items):
                self._kc_set_index(len(self._kc_items) - 1)
            elif index < self._kc_index:
                self._kc_index -= 1
            elif index == self._kc_index:
                self._kc_index = -1
                self._kc_set_index(min(index, len(self._kc_items) - 1))
            self._touch()

    def clear(self):
        self._kc_items = []
        self._kc_set_index(-1)
        self._touch()

    def count(self):
        return len(self._kc_items)

    def itemText(self, i):
        return self._kc_items[i]["text"] if 0 <= i < len(self._kc_items) \
            else ""

    def setItemText(self, i, t):
        if 0 <= i < len(self._kc_items):
            self._kc_items[i]["text"] = str(t)
            self._touch()

    def itemData(self, i, role=None):
        if 0 <= i < len(self._kc_items):
            if role not in (None, 256, 0x100):
                return self._kc_items[i].get(("role", role))
            return self._kc_items[i]["data"]
        return None

    def setItemData(self, i, value, role=None):
        if 0 <= i < len(self._kc_items):
            if role not in (None, 256, 0x100):
                self._kc_items[i][("role", role)] = value
                if role == 3:
                    self._kc_items[i]["tip"] = str(value)
            else:
                self._kc_items[i]["data"] = value
            self._touch()

    def itemIcon(self, i):
        return QIcon(self._kc_items[i].get("icon")) \
            if 0 <= i < len(self._kc_items) else QIcon()

    def setItemIcon(self, i, icon):
        if 0 <= i < len(self._kc_items):
            self._kc_items[i]["icon"] = _icon_name(icon)
            self._touch()

    def findText(self, text, *_a):
        return next((i for i, it in enumerate(self._kc_items)
                     if it["text"] == text), -1)

    def findData(self, data, *_a):
        return next((i for i, it in enumerate(self._kc_items)
                     if it["data"] == data), -1)

    # -- current
    def currentIndex(self):
        return self._kc_index

    def setCurrentIndex(self, i):
        i = int(i)
        if i < -1 or i >= len(self._kc_items):
            return
        self._kc_set_index(i)

    def currentText(self):
        if self._kc_editable:
            return self._kc_edit_text
        return self.itemText(self._kc_index)

    def setCurrentText(self, text):
        i = self.findText(text)
        if self._kc_editable:
            self.setEditText(text)
            if i >= 0:
                self._kc_set_index(i)
        elif i >= 0:
            self._kc_set_index(i)

    def currentData(self, role=None):
        return self.itemData(self._kc_index, role)

    # -- editable
    def setEditable(self, on):
        self._kc_editable = bool(on)
        if on and self._kc_line is None:
            self._kc_line = _ComboLine(self)
        self._kc_edit_text = self.itemText(self._kc_index)
        self._touch()

    def isEditable(self):
        return self._kc_editable

    def lineEdit(self):
        if self._kc_line is None:
            self._kc_line = _ComboLine(self)
        return self._kc_line

    def setEditText(self, text):
        text = str(text if text is not None else "")
        if text != self._kc_edit_text:
            self._kc_edit_text = text
            if self._kc_line is not None:
                self._kc_line._kc_text = text
            self._touch()
            self.editTextChanged.emit(text)

    def clearEditText(self):
        self.setEditText("")

    def model(self):
        return _ComboModel(self)

    def view(self):
        return Inert()

    def setInsertPolicy(self, *a):
        pass

    def setMaxVisibleItems(self, *a):
        pass

    def setSizeAdjustPolicy(self, *a):
        pass

    def setMinimumContentsLength(self, *a):
        pass

    def setCompleter(self, *a):
        pass

    def setDuplicatesEnabled(self, *a):
        pass

    def setValidator(self, *a):
        pass

    def setPlaceholderText(self, t):
        if self._kc_line is not None:
            self._kc_line.setPlaceholderText(t)

    def showPopup(self):
        pass

    def hidePopup(self):
        pass

    # -- the web side
    def _kc_activate(self, index):
        self._kc_set_index(int(index))
        self.activated.emit(int(index))
        self.textActivated.emit(self.itemText(int(index)))

    def _kc_commit_text(self, text):
        self.setEditText(text)
        if self._kc_line is not None:
            self._kc_line.editingFinished.emit()


class _ComboLine(QLineEdit):
    """An editable combo's line edit (its text is the combo's edit
    text)."""

    def __init__(self, combo):
        super().__init__()
        self._combo = combo
        self._kc_text = combo._kc_edit_text

    def text(self):
        return self._combo._kc_edit_text

    def setText(self, t):
        self._combo.setEditText(t)


class QFontComboBox(QComboBox):
    pass


# ---------------------------------------------------------------- containers

class QFrame(QWidget):
    HLine = 4
    VLine = 5
    NoFrame = 0
    Box = 1
    Panel = 2
    StyledPanel = 6
    Sunken = 0x30
    Raised = 0x20
    Plain = 0x10

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_shape = 0

    def setFrameShape(self, shape):
        self._kc_shape = int(shape)
        self._touch()

    def frameShape(self):
        return self._kc_shape

    def setFrameShadow(self, *a):
        pass

    def setFrameStyle(self, style):
        self._kc_shape = int(style) & 0x0f

    def setLineWidth(self, *a):
        pass

    def setMidLineWidth(self, *a):
        pass


class QGroupBox(QWidget):
    toggled = pyqtSignal(bool)
    clicked = pyqtSignal(bool)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_title = next((a for a in args if isinstance(a, str)), "")
        self._kc_checkable = False
        self._kc_checked = True
        self._kc_flat = False

    def title(self):
        return self._kc_title

    def setTitle(self, t):
        self._kc_title = str(t or "")
        self._touch()

    def setCheckable(self, on):
        self._kc_checkable = bool(on)
        self._touch()

    def isCheckable(self):
        return self._kc_checkable

    def setChecked(self, on):
        if bool(on) != self._kc_checked:
            self._kc_checked = bool(on)
            self._touch()
            self.toggled.emit(self._kc_checked)

    def isChecked(self):
        return self._kc_checked

    def setFlat(self, on):
        self._kc_flat = bool(on)

    def setAlignment(self, *a):
        pass


class QScrollArea(QFrame):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_widget = None

    def setWidget(self, w):
        self._kc_widget = w
        if w is not None:
            self._kc_add_child(w)
        self._touch()

    def widget(self):
        return self._kc_widget

    def takeWidget(self):
        w, self._kc_widget = self._kc_widget, None
        return w

    def setWidgetResizable(self, *a):
        pass

    def setHorizontalScrollBarPolicy(self, *a):
        pass

    def setVerticalScrollBarPolicy(self, *a):
        pass

    def verticalScrollBar(self):
        return QScrollBar()

    def horizontalScrollBar(self):
        return QScrollBar()

    def ensureWidgetVisible(self, *a):
        pass

    def viewport(self):
        return self


class QAbstractScrollArea(QScrollArea):
    pass


class QTabBar(QWidget):
    currentChanged = pyqtSignal(int)
    tabCloseRequested = pyqtSignal(int)

    def __init__(self, tabs=None, *a):
        super().__init__(*a)
        self._kc_tabs = tabs

    def count(self):
        return self._kc_tabs.count() if self._kc_tabs else 0

    def tabText(self, i):
        return self._kc_tabs.tabText(i) if self._kc_tabs else ""

    def setTabTextColor(self, *a):
        pass

    def setExpanding(self, *a):
        pass

    def setElideMode(self, *a):
        pass

    def setUsesScrollButtons(self, *a):
        pass

    def tabRect(self, *a):
        return QRectF()

    def setTabButton(self, *a):
        pass

    def setDrawBase(self, *a):
        pass


class QTabWidget(QWidget):
    currentChanged = pyqtSignal(int)
    tabCloseRequested = pyqtSignal(int)
    tabBarClicked = pyqtSignal(int)
    North = 0
    South = 1
    West = 2
    East = 3

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_pages = []           # [{w, label, tip, icon, enabled, show}]
        self._kc_index = -1
        self._kc_bar = QTabBar(self)
        self._kc_corner = None

    def addTab(self, w, *args):
        return self.insertTab(len(self._kc_pages), w, *args)

    def insertTab(self, index, w, *args):
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        label = next((a for a in args if isinstance(a, str)), "")
        index = max(0, min(int(index), len(self._kc_pages)))
        self._kc_pages.insert(index, dict(w=w, label=label, tip="",
                                          icon=_icon_name(icon),
                                          enabled=True, show=True))
        self._kc_add_child(w)
        if self._kc_index < 0:
            self._kc_index = 0
            self._touch()
            self.currentChanged.emit(0)
        elif index <= self._kc_index:
            self._kc_index += 1
        self._touch()
        return index

    def removeTab(self, index):
        if 0 <= index < len(self._kc_pages):
            page = self._kc_pages.pop(index)
            if page["w"] in self._kc_children:
                self._kc_children.remove(page["w"])
            if self._kc_index >= len(self._kc_pages):
                self._kc_index = len(self._kc_pages) - 1
                self.currentChanged.emit(self._kc_index)
            elif index < self._kc_index:
                self._kc_index -= 1
            self._touch()

    def clear(self):
        while self._kc_pages:
            self.removeTab(0)

    def count(self):
        return len(self._kc_pages)

    def widget(self, i):
        return self._kc_pages[i]["w"] if 0 <= i < len(self._kc_pages) \
            else None

    def indexOf(self, w):
        return next((i for i, p in enumerate(self._kc_pages)
                     if p["w"] is w), -1)

    def currentIndex(self):
        return self._kc_index

    def setCurrentIndex(self, i):
        i = int(i)
        if 0 <= i < len(self._kc_pages) and i != self._kc_index:
            self._kc_index = i
            self._touch()
            self.currentChanged.emit(i)

    def currentWidget(self):
        return self.widget(self._kc_index)

    def setCurrentWidget(self, w):
        self.setCurrentIndex(self.indexOf(w))

    def tabText(self, i):
        return self._kc_pages[i]["label"] if 0 <= i < len(self._kc_pages) \
            else ""

    def setTabText(self, i, t):
        if 0 <= i < len(self._kc_pages):
            self._kc_pages[i]["label"] = str(t)
            self._touch()

    def setTabToolTip(self, i, tip):
        if 0 <= i < len(self._kc_pages):
            self._kc_pages[i]["tip"] = str(tip)
            self._touch()

    def tabToolTip(self, i):
        return self._kc_pages[i]["tip"] if 0 <= i < len(self._kc_pages) \
            else ""

    def setTabIcon(self, i, icon):
        if 0 <= i < len(self._kc_pages):
            self._kc_pages[i]["icon"] = _icon_name(icon)
            self._touch()

    def setTabEnabled(self, i, on):
        if 0 <= i < len(self._kc_pages):
            self._kc_pages[i]["enabled"] = bool(on)
            self._touch()

    def isTabEnabled(self, i):
        return self._kc_pages[i]["enabled"] if 0 <= i < len(self._kc_pages) \
            else False

    def setTabVisible(self, i, on):
        if 0 <= i < len(self._kc_pages):
            self._kc_pages[i]["show"] = bool(on)
            self._touch()

    def tabBar(self):
        return self._kc_bar

    def setCornerWidget(self, w, *a):
        self._kc_corner = w
        if w is not None:
            self._kc_add_child(w)

    def setDocumentMode(self, *a):
        pass

    def setTabsClosable(self, *a):
        pass

    def setMovable(self, *a):
        pass

    def setTabPosition(self, *a):
        pass

    def setUsesScrollButtons(self, *a):
        pass

    def setElideMode(self, *a):
        pass


class QStackedWidget(QFrame):
    currentChanged = pyqtSignal(int)
    widgetRemoved = pyqtSignal(int)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_pages = []
        self._kc_index = -1

    def addWidget(self, w):
        return self.insertWidget(len(self._kc_pages), w)

    def insertWidget(self, index, w):
        index = max(0, min(int(index), len(self._kc_pages)))
        self._kc_pages.insert(index, w)
        self._kc_add_child(w)
        if self._kc_index < 0:
            self._kc_index = 0
            self.currentChanged.emit(0)
        elif index <= self._kc_index:
            self._kc_index += 1
        self._touch()
        return index

    def removeWidget(self, w):
        if w in self._kc_pages:
            i = self._kc_pages.index(w)
            self._kc_pages.remove(w)
            if self._kc_index >= len(self._kc_pages):
                self._kc_index = len(self._kc_pages) - 1
            self._touch()
            self.widgetRemoved.emit(i)

    def count(self):
        return len(self._kc_pages)

    def widget(self, i):
        return self._kc_pages[i] if 0 <= i < len(self._kc_pages) else None

    def indexOf(self, w):
        return self._kc_pages.index(w) if w in self._kc_pages else -1

    def currentIndex(self):
        return self._kc_index

    def setCurrentIndex(self, i):
        i = int(i)
        if 0 <= i < len(self._kc_pages) and i != self._kc_index:
            self._kc_index = i
            self._touch()
            self.currentChanged.emit(i)

    def currentWidget(self):
        return self.widget(self._kc_index)

    def setCurrentWidget(self, w):
        self.setCurrentIndex(self.indexOf(w))


class QSplitter(QFrame):
    splitterMoved = pyqtSignal(int, int)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_orient = next((a for a in args if isinstance(a, int)
                                and not isinstance(a, bool)), 1)
        self._kc_sizes = []
        self._kc_stretch = {}
        self._kc_widgets = []

    def addWidget(self, w):
        self._kc_widgets.append(w)
        self._kc_add_child(w)
        self._touch()

    def insertWidget(self, index, w):
        self._kc_widgets.insert(index, w)
        self._kc_add_child(w)
        self._touch()

    def count(self):
        return len(self._kc_widgets)

    def widget(self, i):
        return self._kc_widgets[i] if 0 <= i < len(self._kc_widgets) \
            else None

    def indexOf(self, w):
        return self._kc_widgets.index(w) if w in self._kc_widgets else -1

    def setSizes(self, sizes):
        self._kc_sizes = [int(s) for s in sizes]
        self._touch()

    def sizes(self):
        return list(self._kc_sizes) or [100] * len(self._kc_widgets)

    def setStretchFactor(self, index, stretch):
        self._kc_stretch[int(index)] = int(stretch)

    def setOrientation(self, o):
        self._kc_orient = int(o)

    def orientation(self):
        return self._kc_orient

    def setChildrenCollapsible(self, *a):
        pass

    def setCollapsible(self, *a):
        pass

    def setHandleWidth(self, *a):
        pass

    def handle(self, *a):
        return Inert()

    def saveState(self):
        return b""

    def restoreState(self, *a):
        return True


class QDockWidget(QWidget):
    visibilityChanged = pyqtSignal(bool)
    topLevelChanged = pyqtSignal(bool)
    dockLocationChanged = pyqtSignal(int)
    DockWidgetClosable = 1
    DockWidgetMovable = 2
    DockWidgetFloatable = 4
    NoDockWidgetFeatures = 0

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_title = next((a for a in args if isinstance(a, str)), "")
        self._kc_widget = None
        self._kc_area = 2
        self._kc_toggle = None

    def setWidget(self, w):
        self._kc_widget = w
        if w is not None:
            self._kc_add_child(w)
        self._touch()

    def widget(self):
        return self._kc_widget

    def toggleViewAction(self):
        if self._kc_toggle is None:
            act = QAction(self._kc_title, self)
            act.setCheckable(True)
            act._kc_checked = not self._kc_hidden
            act.triggered.connect(lambda on: self.setVisible(on))
            self._kc_toggle = act
        return self._kc_toggle

    def _kc_visibility_changed(self, on):
        if self._kc_toggle is not None and self._kc_toggle._kc_checked != on:
            self._kc_toggle._kc_checked = on
            self._kc_toggle._changed()
        self.visibilityChanged.emit(on)

    def setFeatures(self, *a):
        pass

    def setAllowedAreas(self, *a):
        pass

    def setFloating(self, *a):
        pass

    def isFloating(self):
        return False

    def setTitleBarWidget(self, *a):
        pass


class QToolBar(QWidget, _ActionContainer):
    actionTriggered = pyqtSignal(object)
    visibilityChanged = pyqtSignal(bool)
    orientationChanged = pyqtSignal(int)

    def __init__(self, *args, **kwargs):
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_actions_init()
        self._kc_title = next((a for a in args if isinstance(a, str)), "")
        self._kc_widgets = {}         # action id -> widget
        self._kc_orient = 1
        self._kc_icon_size = 24
        self._kc_style_mode = 0
        self._kc_toggle = None

    def addAction(self, *args, **kwargs):
        act = super().addAction(*args, **kwargs)
        return act

    def addWidget(self, w):
        act = QWidgetAction(self)
        act._kc_widget = w
        self._kc_widgets[act._kc_id] = w
        self._kc_add_child(w)
        self._kc_actions.append(act)
        self._touch()
        return act

    def insertWidget(self, before, w):
        act = QWidgetAction(self)
        act._kc_widget = w
        self._kc_widgets[act._kc_id] = w
        self._kc_add_child(w)
        self.insertAction(before, act)
        return act

    def widgetForAction(self, action):
        w = self._kc_widgets.get(action._kc_id)
        if w is None and not action.isSeparator():
            w = QToolButton(self)
            w.setDefaultAction(action)
            self._kc_widgets[action._kc_id] = w
        return w

    def setIconSize(self, size):
        self._kc_icon_size = size.width() if hasattr(size, "width") \
            else int(size)

    def iconSize(self):
        return QSize(self._kc_icon_size, self._kc_icon_size)

    def setMovable(self, *a):
        pass

    def setFloatable(self, *a):
        pass

    def setOrientation(self, o):
        self._kc_orient = int(o)

    def orientation(self):
        return self._kc_orient

    def setToolButtonStyle(self, style):
        self._kc_style_mode = int(style)

    def toggleViewAction(self):
        if self._kc_toggle is None:
            act = QAction(self._kc_title, self)
            act.setCheckable(True)
            act._kc_checked = True
            act.triggered.connect(lambda on: self.setVisible(on))
            self._kc_toggle = act
        return self._kc_toggle

    def setAllowedAreas(self, *a):
        pass


class QStatusBar(QWidget):
    messageChanged = pyqtSignal(str)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_items = []           # [(widget, permanent, stretch)]
        self._kc_message = ""
        self._kc_timeout = 0

    def addWidget(self, w, stretch=0):
        self._kc_items.append((w, False, stretch))
        self._kc_add_child(w)

    def insertWidget(self, index, w, stretch=0):
        self._kc_items.insert(index, (w, False, stretch))
        self._kc_add_child(w)

    def addPermanentWidget(self, w, stretch=0):
        self._kc_items.append((w, True, stretch))
        self._kc_add_child(w)

    def removeWidget(self, w):
        self._kc_items = [i for i in self._kc_items if i[0] is not w]
        self._touch()

    def showMessage(self, text, timeout=0):
        self._kc_message = str(text or "")
        self._kc_timeout = int(timeout or 0)
        self._touch()
        self.messageChanged.emit(self._kc_message)

    def clearMessage(self):
        self.showMessage("")

    def currentMessage(self):
        return self._kc_message

    def setSizeGripEnabled(self, *a):
        pass


class QMainWindow(QWidget):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_window = True
        self._kc_central = None
        self._kc_menubar = None
        self._kc_statusbar = None
        self._kc_toolbars = []        # [(area, toolbar)]
        self._kc_docks = []           # [(area, dock)]

    def setCentralWidget(self, w):
        self._kc_central = w
        self._kc_add_child(w)

    def centralWidget(self):
        return self._kc_central

    def menuBar(self):
        if self._kc_menubar is None:
            self._kc_menubar = QMenuBar(self)
        return self._kc_menubar

    def setMenuBar(self, bar):
        self._kc_menubar = bar

    def statusBar(self):
        if self._kc_statusbar is None:
            self._kc_statusbar = QStatusBar(self)
        return self._kc_statusbar

    def setStatusBar(self, bar):
        self._kc_statusbar = bar

    def addToolBar(self, *args):
        area = next((a for a in args if isinstance(a, int)
                     and not isinstance(a, bool)), 4)
        bar = next((a for a in args if isinstance(a, QToolBar)), None)
        if bar is None:
            title = next((a for a in args if isinstance(a, str)), "")
            bar = QToolBar(title, self)
        self._kc_add_child(bar)
        if area in (1, 2):
            bar.setOrientation(2)
        self._kc_toolbars.append((area, bar))
        self._touch()
        return bar

    def insertToolBar(self, before, bar):
        self.addToolBar(bar)

    def addToolBarBreak(self, *a):
        pass

    def removeToolBar(self, bar):
        self._kc_toolbars = [t for t in self._kc_toolbars if t[1] is not bar]
        self._touch()

    def toolBarArea(self, bar):
        return next((a for a, b in self._kc_toolbars if b is bar), 0)

    def addDockWidget(self, area, dock, *a):
        self._kc_add_child(dock)
        dock._kc_area = int(area)
        self._kc_docks.append((int(area), dock))
        self._touch()

    def removeDockWidget(self, dock):
        self._kc_docks = [d for d in self._kc_docks if d[1] is not dock]
        self._touch()

    def dockWidgetArea(self, dock):
        return next((a for a, d in self._kc_docks if d is dock), 0)

    def tabifyDockWidget(self, *a):
        pass

    def splitDockWidget(self, *a):
        pass

    def setCorner(self, *a):
        pass

    def setDockOptions(self, *a):
        pass

    def setWindowIcon(self, *a):
        pass

    def setUnifiedTitleAndToolBarOnMac(self, *a):
        pass

    def saveState(self, *a):
        return b""

    def restoreState(self, *a):
        return True

    def saveGeometry(self):
        return b""

    def restoreGeometry(self, *a):
        return True

    def isMaximized(self):
        return False

    def showMaximized(self):
        self.show()
