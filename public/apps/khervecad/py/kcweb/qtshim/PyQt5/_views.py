"""Headless item views: QTreeWidget, QTableWidget, QListWidget.

Items keep text, icon, data roles, flags, colours, fonts, check state
and selection, and the views emit Qt's signals, so the desktop's object
tree, Variables sheet, Points table and library lists run unmodified.
See _widgets.py for the idea.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0-or-later.
"""

from ._core import Inert, QPointF, QRectF, pyqtSignal
from ._widgets import (QFrame, QIcon, QWidget, _icon_name)

# Qt item flags
ItemIsSelectable = 0x1
ItemIsEditable = 0x2
ItemIsDragEnabled = 0x4
ItemIsDropEnabled = 0x8
ItemIsUserCheckable = 0x10
ItemIsEnabled = 0x20
ItemNeverHasChildren = 0x80
DEFAULT_FLAGS = ItemIsSelectable | ItemIsEnabled | ItemIsDragEnabled | \
    ItemIsDropEnabled | ItemIsUserCheckable

DISPLAY, DECORATION, EDIT, TOOLTIP = 0, 1, 2, 3
FONT, BACKGROUND, FOREGROUND, CHECK = 6, 8, 9, 10
USER = 256


def _color_name(value):
    if value is None:
        return None
    color = getattr(value, "color", None)
    if callable(color):                 # a QBrush
        value = color()
    name = getattr(value, "name", None)
    if callable(name):
        try:
            return value.name()
        except Exception:
            return None
    return str(value) if isinstance(value, str) else None


def QBrush(*a):
    from .QtGui import QBrush as _Brush
    return _Brush(*a)


class _Item:
    """Shared item state (columns of roles)."""

    def _item_init(self):
        self._roles = {}              # (col, role) -> value
        self._flags = DEFAULT_FLAGS
        self._selected = False
        self._hidden = False
        self._view = None

    def _changed(self):
        view = self._view
        if view is not None:
            view._touch()
            if not view._kc_updating_items:
                view._kc_item_changed(self)

    def data(self, col, role=None):
        if role is None:                  # QListWidgetItem.data(role)
            col, role = 0, col
        if role == EDIT:
            role = DISPLAY
        return self._roles.get((col, role))

    def setData(self, col, role, value=None):
        if value is None and role is not None and not isinstance(col, int):
            col, role, value = 0, col, role
        if role == EDIT:
            role = DISPLAY
        self._roles[(col, role)] = value
        self._changed()

    def text(self, col=0):
        v = self._roles.get((col, DISPLAY))
        return "" if v is None else str(v)

    def setText(self, col, text=None):
        if text is None:
            col, text = 0, col
        if self._roles.get((col, DISPLAY)) != str(text):
            self._roles[(col, DISPLAY)] = str(text)
            self._changed()

    def icon(self, col=0):
        return QIcon(self._roles.get((col, DECORATION)))

    def setIcon(self, col, icon=None):
        if icon is None:
            col, icon = 0, col
        self._roles[(col, DECORATION)] = _icon_name(icon)
        self._changed()

    def toolTip(self, col=0):
        return self._roles.get((col, TOOLTIP)) or ""

    def setToolTip(self, col, tip=None):
        if tip is None:
            col, tip = 0, col
        self._roles[(col, TOOLTIP)] = str(tip or "")
        self._changed()

    def setStatusTip(self, *a):
        pass

    def setWhatsThis(self, *a):
        pass

    def setForeground(self, col, brush=None):
        if brush is None:
            col, brush = 0, col
        self._roles[(col, FOREGROUND)] = _color_name(brush)
        self._changed()

    def foreground(self, col=0):
        return QBrush(self._roles.get((col, FOREGROUND)) or "#000000")

    def setBackground(self, col, brush=None):
        if brush is None:
            col, brush = 0, col
        self._roles[(col, BACKGROUND)] = _color_name(brush)
        self._changed()

    def background(self, col=0):
        return QBrush(self._roles.get((col, BACKGROUND)) or "#ffffff")

    def font(self, col=0):
        from .QtGui import QFont
        f = self._roles.get((col, FONT))
        return QFont(f) if f is not None else QFont()

    def setFont(self, col, font=None):
        if font is None:
            col, font = 0, col
        from .QtGui import QFont
        self._roles[(col, FONT)] = QFont(font)
        self._changed()

    def setTextAlignment(self, *a):
        pass

    def setSizeHint(self, *a):
        pass

    def flags(self):
        return self._flags

    def setFlags(self, flags):
        self._flags = int(flags)
        self._changed()

    def checkState(self, col=0):
        return self._roles.get((col, CHECK), 0)

    def setCheckState(self, col, state=None):
        if state is None:
            col, state = 0, col
        self._roles[(col, CHECK)] = int(state)
        self._changed()

    def isSelected(self):
        return self._selected

    def setSelected(self, on):
        on = bool(on)
        if on != self._selected:
            self._selected = on
            view = self._view
            if view is not None:
                view._touch()
                view._kc_selection_changed()

    def isHidden(self):
        return self._hidden

    def setHidden(self, on):
        self._hidden = bool(on)
        self._changed()


# -------------------------------------------------------------------- tree

class QTreeWidgetItem(_Item, Inert):
    def __init__(self, *args):
        self._item_init()
        self._children = []
        self._parent = None
        self._expanded = False
        self._spanned = False
        parent = next((a for a in args if isinstance(a, (QTreeWidgetItem,
                                                         QTreeWidget))),
                      None)
        strings = next((a for a in args if isinstance(a, (list, tuple))),
                       None)
        if strings:
            for col, text in enumerate(strings):
                self._roles[(col, DISPLAY)] = str(text)
        if isinstance(parent, QTreeWidget):
            parent.invisibleRootItem().addChild(self)
        elif isinstance(parent, QTreeWidgetItem):
            parent.addChild(self)

    def __bool__(self):
        return True

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)

    def _set_view(self, view):
        self._view = view
        for c in self._children:
            c._set_view(view)

    def parent(self):
        p = self._parent
        if p is not None and getattr(p, "_is_root", False):
            return None
        return p

    def treeWidget(self):
        return self._view

    def childCount(self):
        return len(self._children)

    def child(self, i):
        return self._children[i] if 0 <= i < len(self._children) else None

    def addChild(self, item):
        self.insertChild(len(self._children), item)

    def addChildren(self, items):
        for it in items:
            self.addChild(it)

    def insertChild(self, index, item):
        if item._parent is not None and item in item._parent._children:
            item._parent._children.remove(item)
        item._parent = self
        self._children.insert(max(0, min(index, len(self._children))), item)
        item._set_view(self._view)
        if self._view is not None:
            self._view._touch()

    def takeChild(self, index):
        if 0 <= index < len(self._children):
            item = self._children.pop(index)
            item._parent = None
            was_selected = any(i._selected for i in item._walk())
            item._set_view(None)
            if self._view is not None:
                self._view._touch()
                if was_selected:
                    self._view._kc_selection_changed()
            return item
        return None

    def removeChild(self, item):
        if item in self._children:
            self.takeChild(self._children.index(item))

    def takeChildren(self):
        out = []
        while self._children:
            out.append(self.takeChild(0))
        return out

    def indexOfChild(self, item):
        return self._children.index(item) if item in self._children else -1

    def setExpanded(self, on):
        on = bool(on)
        if on != self._expanded:
            self._expanded = on
            view = self._view
            if view is not None:
                view._touch()
                (view.itemExpanded if on else view.itemCollapsed).emit(self)

    def isExpanded(self):
        return self._expanded

    def setFirstColumnSpanned(self, on):
        self._spanned = bool(on)

    def setChildIndicatorPolicy(self, *a):
        pass

    def columnCount(self):
        return max([c for c, _r in self._roles] + [0]) + 1

    def _walk(self):
        yield self
        for c in self._children:
            yield from c._walk()

    def sortChildren(self, *a):
        pass

    def clone(self):
        it = QTreeWidgetItem()
        it._roles = dict(self._roles)
        it._flags = self._flags
        for c in self._children:
            it.addChild(c.clone())
        return it


class _RootItem(QTreeWidgetItem):
    _is_root = True


class _Header(Inert):
    """QHeaderView stand-in: remembers labels and section sizes."""

    Stretch = 1
    ResizeToContents = 3
    Interactive = 0
    Fixed = 2

    def __init__(self, view=None, orient=1):
        self._view = view
        self._hidden = False

    def setStretchLastSection(self, *a):
        pass

    def setSectionResizeMode(self, *a):
        pass

    def setDefaultSectionSize(self, *a):
        pass

    def setMinimumSectionSize(self, *a):
        pass

    def resizeSection(self, *a):
        pass

    def setSectionsClickable(self, *a):
        pass

    def setHighlightSections(self, *a):
        pass

    def setDefaultAlignment(self, *a):
        pass

    def hide(self):
        self._hidden = True
        if self._view is not None:
            self._view._touch()

    def show(self):
        self._hidden = False

    def setVisible(self, on):
        self._hidden = not on
        if self._view is not None:
            self._view._touch()

    def isHidden(self):
        return self._hidden

    def sizeHint(self):
        from ._core import QSize
        return QSize(100, 22)

    def length(self):
        return 0

    def count(self):
        return 0

    def setSortIndicatorShown(self, *a):
        pass


QHeaderView = _Header


class QAbstractItemView(QFrame):
    NoSelection = 0
    SingleSelection = 1
    MultiSelection = 2
    ExtendedSelection = 3
    ContiguousSelection = 4
    SelectItems = 0
    SelectRows = 1
    SelectColumns = 2
    NoEditTriggers = 0
    CurrentChanged = 1
    DoubleClicked = 2
    SelectedClicked = 4
    EditKeyPressed = 8
    AnyKeyPressed = 16
    AllEditTriggers = 31
    NoDragDrop = 0
    DragOnly = 1
    DropOnly = 2
    DragDrop = 3
    InternalMove = 4
    OnItem = 0
    AboveItem = 1
    BelowItem = 2
    OnViewport = 3
    EnsureVisible = 0
    PositionAtCenter = 3
    ScrollPerPixel = 1

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_selmode = 1
        self._kc_updating_items = False
        self._kc_drop_pos = 2

    def setSelectionMode(self, mode):
        self._kc_selmode = int(mode)

    def selectionMode(self):
        return self._kc_selmode

    def setSelectionBehavior(self, *a):
        pass

    def setEditTriggers(self, *a):
        pass

    def setDragDropMode(self, *a):
        pass

    def setDragEnabled(self, *a):
        pass

    def setDefaultDropAction(self, *a):
        pass

    def setDropIndicatorShown(self, *a):
        pass

    def setAlternatingRowColors(self, *a):
        pass

    def setUniformRowHeights(self, *a):
        pass

    def setHorizontalScrollMode(self, *a):
        pass

    def setVerticalScrollMode(self, *a):
        pass

    def setIconSize(self, *a):
        pass

    def setTextElideMode(self, *a):
        pass

    def setWordWrap(self, *a):
        pass

    def setItemDelegate(self, *a):
        pass

    def setContextMenuPolicy(self, *a):
        pass

    def viewport(self):
        return self

    def dropIndicatorPosition(self):
        return self._kc_drop_pos

    def verticalScrollBar(self):
        from ._widgets import QScrollBar
        return QScrollBar()

    def horizontalScrollBar(self):
        from ._widgets import QScrollBar
        return QScrollBar()

    def _kc_item_changed(self, item):
        pass

    def _kc_selection_changed(self):
        pass


class QTreeView(QAbstractItemView):
    pass


class QTreeWidget(QTreeView):
    itemSelectionChanged = pyqtSignal()
    itemChanged = pyqtSignal(object, int)
    itemClicked = pyqtSignal(object, int)
    itemDoubleClicked = pyqtSignal(object, int)
    itemPressed = pyqtSignal(object, int)
    itemActivated = pyqtSignal(object, int)
    itemExpanded = pyqtSignal(object)
    itemCollapsed = pyqtSignal(object)
    currentItemChanged = pyqtSignal(object, object)
    customContextMenuRequested = pyqtSignal(object)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_root = _RootItem()
        self._kc_root._view = self
        self._kc_headers = []
        self._kc_header = _Header(self)
        self._kc_current = None
        self._kc_sel_pending = False
        self._kc_edit = None          # (item, col) the web side should edit
        self._kc_columns = 1
        self._kc_indent = 20

    # -- structure
    def invisibleRootItem(self):
        return self._kc_root

    def addTopLevelItem(self, item):
        self._kc_root.addChild(item)

    def addTopLevelItems(self, items):
        for it in items:
            self._kc_root.addChild(it)

    def insertTopLevelItem(self, index, item):
        self._kc_root.insertChild(index, item)

    def topLevelItem(self, i):
        return self._kc_root.child(i)

    def topLevelItemCount(self):
        return self._kc_root.childCount()

    def takeTopLevelItem(self, i):
        return self._kc_root.takeChild(i)

    def indexOfTopLevelItem(self, item):
        return self._kc_root.indexOfChild(item)

    def clear(self):
        had = any(i._selected for i in self._kc_root._walk())
        for c in self._kc_root._children:
            c._set_view(None)
            c._parent = None
        self._kc_root._children = []
        self._kc_current = None
        self._touch()
        if had:
            self._kc_selection_changed()

    def _kc_all(self):
        for c in self._kc_root._children:
            yield from c._walk()

    # -- header
    def setHeaderLabels(self, labels):
        self._kc_headers = [str(x) for x in labels]
        self._kc_columns = max(1, len(labels))
        self._touch()

    def setHeaderLabel(self, label):
        self.setHeaderLabels([label])

    def setHeaderHidden(self, on):
        self._kc_header._hidden = bool(on)
        self._touch()

    def isHeaderHidden(self):
        return self._kc_header._hidden

    def header(self):
        return self._kc_header

    def headerItem(self):
        it = QTreeWidgetItem(self._kc_headers)
        return it

    def setColumnCount(self, n):
        self._kc_columns = int(n)

    def columnCount(self):
        return self._kc_columns

    def setColumnWidth(self, *a):
        pass

    def resizeColumnToContents(self, *a):
        pass

    def setIndentation(self, n):
        self._kc_indent = int(n)

    def indentation(self):
        return self._kc_indent

    def setRootIsDecorated(self, *a):
        pass

    def setExpandsOnDoubleClick(self, *a):
        pass

    def setSortingEnabled(self, *a):
        pass

    def sortItems(self, *a):
        pass

    def setAnimated(self, *a):
        pass

    def setItemsExpandable(self, *a):
        pass

    def setAllColumnsShowFocus(self, *a):
        pass

    def setFirstItemColumnSpanned(self, *a):
        pass

    # -- selection
    def selectedItems(self):
        return [i for i in self._kc_all() if i._selected]

    def clearSelection(self):
        changed = False
        for i in self._kc_all():
            if i._selected:
                i._selected = False
                changed = True
        if changed:
            self._touch()
            self._kc_selection_changed()

    def selectAll(self):
        for i in self._kc_all():
            i._selected = True
        self._touch()
        self._kc_selection_changed()

    def _kc_selection_changed(self):
        if self.signalsBlocked():
            return
        self.itemSelectionChanged.emit()

    def currentItem(self):
        return self._kc_current

    def setCurrentItem(self, item, *a):
        old = self._kc_current
        self._kc_current = item
        if item is not None and self._kc_selmode in (1, 3, 4) \
                and not item._selected:
            if self._kc_selmode == 1:
                for i in self._kc_all():
                    i._selected = False
            item._selected = True
            self._kc_selection_changed()
        self._touch()
        if old is not item:
            self.currentItemChanged.emit(item, old)

    def scrollToItem(self, item, *a):
        self._kc_scroll_to = item

    def scrollToTop(self):
        pass

    def scrollToBottom(self):
        pass

    def expandItem(self, item):
        item.setExpanded(True)

    def collapseItem(self, item):
        item.setExpanded(False)

    def expandAll(self):
        for i in self._kc_all():
            i._expanded = True
        self._touch()

    def collapseAll(self):
        for i in self._kc_all():
            i._expanded = False
        self._touch()

    def expandToDepth(self, depth):
        def walk(item, d):
            for c in item._children:
                c._expanded = d < depth
                walk(c, d + 1)
        walk(self._kc_root, 0)
        self._touch()

    def editItem(self, item, col=0):
        self._kc_edit = (item, col)
        self._touch()

    def openPersistentEditor(self, *a):
        pass

    def closePersistentEditor(self, *a):
        pass

    def setItemWidget(self, *a):
        pass

    def itemAt(self, *a):
        return getattr(self, "_kc_hover", None)

    def itemFromIndex(self, index):
        return index if isinstance(index, QTreeWidgetItem) else None

    def indexFromItem(self, item, *a):
        return item

    def visualItemRect(self, *a):
        return QRectF()

    def findItems(self, text, *a):
        return [i for i in self._kc_all() if i.text(0) == text]

    def _kc_item_changed(self, item):
        if not self.signalsBlocked():
            self.itemChanged.emit(item, 0)

    # -- the web side
    def _kc_select(self, items, current=None):
        """The user clicked rows (the web side did the shift/ctrl logic)."""
        wanted = set(id(i) for i in items)
        changed = False
        for i in self._kc_all():
            on = id(i) in wanted
            if i._selected != on:
                i._selected = on
                changed = True
        old = self._kc_current
        self._kc_current = current if current is not None else \
            (items[-1] if items else None)
        self._touch()
        if old is not self._kc_current:
            self.currentItemChanged.emit(self._kc_current, old)
        if changed:
            self._kc_selection_changed()


class QListView(QAbstractItemView):
    IconMode = 1
    ListMode = 0
    LeftToRight = 0
    TopToBottom = 1
    Adjust = 1

    def setViewMode(self, *a):
        pass

    def setFlow(self, *a):
        pass

    def setResizeMode(self, *a):
        pass

    def setGridSize(self, *a):
        pass

    def setSpacing(self, *a):
        pass

    def setMovement(self, *a):
        pass

    def setWrapping(self, *a):
        pass


class QListWidgetItem(_Item, Inert):
    def __init__(self, *args):
        self._item_init()
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        text = next((a for a in args if isinstance(a, str)), "")
        self._roles[(0, DISPLAY)] = text
        if icon is not None:
            self._roles[(0, DECORATION)] = _icon_name(icon)
        lst = next((a for a in args if isinstance(a, QListWidget)), None)
        if lst is not None:
            lst.addItem(self)

    def __bool__(self):
        return True

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)

    def listWidget(self):
        return self._view

    def text(self):
        return _Item.text(self, 0)

    def setText(self, text):
        _Item.setText(self, 0, text)

    def setIcon(self, icon):
        _Item.setIcon(self, 0, icon)

    def setToolTip(self, tip):
        _Item.setToolTip(self, 0, tip)

    def toolTip(self):
        return _Item.toolTip(self, 0)

    def setForeground(self, brush):
        _Item.setForeground(self, 0, brush)

    def setBackground(self, brush):
        _Item.setBackground(self, 0, brush)

    def setFont(self, font):
        _Item.setFont(self, 0, font)

    def font(self):
        return _Item.font(self, 0)

    def data(self, role):
        return _Item.data(self, 0, role)

    def setData(self, role, value):
        _Item.setData(self, 0, role, value)

    def checkState(self):
        return _Item.checkState(self, 0)

    def setCheckState(self, state):
        _Item.setCheckState(self, 0, state)


class QListWidget(QListView):
    itemSelectionChanged = pyqtSignal()
    currentRowChanged = pyqtSignal(int)
    currentItemChanged = pyqtSignal(object, object)
    currentTextChanged = pyqtSignal(str)
    itemClicked = pyqtSignal(object)
    itemDoubleClicked = pyqtSignal(object)
    itemActivated = pyqtSignal(object)
    itemChanged = pyqtSignal(object)
    itemPressed = pyqtSignal(object)
    itemEntered = pyqtSignal(object)
    customContextMenuRequested = pyqtSignal(object)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._kc_list = []
        self._kc_row = -1

    def addItem(self, item):
        if isinstance(item, str):
            item = QListWidgetItem(item)
        self.insertItem(len(self._kc_list), item)

    def addItems(self, texts):
        for t in texts:
            self.addItem(str(t))

    def insertItem(self, row, item):
        if isinstance(item, str):
            item = QListWidgetItem(item)
        item._view = self
        self._kc_list.insert(max(0, min(row, len(self._kc_list))), item)
        self._touch()

    def insertItems(self, row, texts):
        for i, t in enumerate(texts):
            self.insertItem(row + i, t)

    def item(self, row):
        return self._kc_list[row] if 0 <= row < len(self._kc_list) else None

    def count(self):
        return len(self._kc_list)

    def row(self, item):
        return self._kc_list.index(item) if item in self._kc_list else -1

    def takeItem(self, row):
        if 0 <= row < len(self._kc_list):
            item = self._kc_list.pop(row)
            item._view = None
            if self._kc_row >= len(self._kc_list):
                self._kc_set_row(len(self._kc_list) - 1)
            self._touch()
            return item
        return None

    def clear(self):
        for it in self._kc_list:
            it._view = None
        self._kc_list = []
        self._kc_set_row(-1)
        self._touch()

    def items(self):
        return list(self._kc_list)

    def findItems(self, text, *a):
        return [i for i in self._kc_list if i.text() == text]

    def selectedItems(self):
        return [i for i in self._kc_list if i._selected]

    def clearSelection(self):
        for i in self._kc_list:
            i._selected = False
        self._touch()
        self._kc_selection_changed()

    def _kc_selection_changed(self):
        if not self.signalsBlocked():
            self.itemSelectionChanged.emit()

    def _kc_item_changed(self, item):
        if not self.signalsBlocked():
            self.itemChanged.emit(item)

    def _kc_set_row(self, row):
        if row == self._kc_row:
            return
        old = self.item(self._kc_row)
        self._kc_row = row
        self._touch()
        if self.signalsBlocked():
            return
        self.currentRowChanged.emit(row)
        cur = self.item(row)
        self.currentItemChanged.emit(cur, old)
        self.currentTextChanged.emit(cur.text() if cur else "")

    def currentRow(self):
        return self._kc_row

    def setCurrentRow(self, row, *a):
        row = int(row)
        if self._kc_selmode in (1, 3, 4):
            for i, it in enumerate(self._kc_list):
                it._selected = i == row
            self._kc_selection_changed()
        self._kc_set_row(row)

    def currentItem(self):
        return self.item(self._kc_row)

    def setCurrentItem(self, item, *a):
        self.setCurrentRow(self.row(item))

    def scrollToItem(self, *a):
        pass

    def editItem(self, *a):
        pass

    def setItemWidget(self, *a):
        pass

    def setSortingEnabled(self, *a):
        pass

    def sortItems(self, *a):
        pass

    def _kc_select(self, rows):
        rows = set(rows)
        for i, it in enumerate(self._kc_list):
            it._selected = i in rows
        self._touch()
        self._kc_selection_changed()
        if rows:
            self._kc_set_row(max(rows) if len(rows) > 1 else next(iter(rows)))


class QTableWidgetItem(_Item, Inert):
    def __init__(self, *args):
        self._item_init()
        icon = next((a for a in args if isinstance(a, QIcon)), None)
        text = next((a for a in args if isinstance(a, str)), "")
        self._roles[(0, DISPLAY)] = text
        if icon is not None:
            self._roles[(0, DECORATION)] = _icon_name(icon)
        self._row = self._col = -1
        self._flags = ItemIsSelectable | ItemIsEnabled | ItemIsEditable | \
            ItemIsDragEnabled | ItemIsDropEnabled | ItemIsUserCheckable

    def __bool__(self):
        return True

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return id(self)

    def row(self):
        return self._row

    def column(self):
        return self._col

    def tableWidget(self):
        return self._view

    def text(self):
        return _Item.text(self, 0)

    def setText(self, text):
        _Item.setText(self, 0, text)

    def setIcon(self, icon):
        _Item.setIcon(self, 0, icon)

    def setToolTip(self, tip):
        _Item.setToolTip(self, 0, tip)

    def toolTip(self):
        return _Item.toolTip(self, 0)

    def setForeground(self, brush):
        _Item.setForeground(self, 0, brush)

    def setBackground(self, brush):
        _Item.setBackground(self, 0, brush)

    def setFont(self, font):
        _Item.setFont(self, 0, font)

    def font(self):
        return _Item.font(self, 0)

    def data(self, role):
        return _Item.data(self, 0, role)

    def setData(self, role, value):
        _Item.setData(self, 0, role, value)

    def checkState(self):
        return _Item.checkState(self, 0)

    def setCheckState(self, state):
        _Item.setCheckState(self, 0, state)


class QTableView(QAbstractItemView):
    pass


class QTableWidget(QTableView):
    itemChanged = pyqtSignal(object)
    cellChanged = pyqtSignal(int, int)
    itemSelectionChanged = pyqtSignal()
    currentCellChanged = pyqtSignal(int, int, int, int)
    currentItemChanged = pyqtSignal(object, object)
    cellClicked = pyqtSignal(int, int)
    cellDoubleClicked = pyqtSignal(int, int)
    itemClicked = pyqtSignal(object)
    itemDoubleClicked = pyqtSignal(object)
    customContextMenuRequested = pyqtSignal(object)

    def __init__(self, *args, **kwargs):
        ints = [a for a in args if isinstance(a, int)
                and not isinstance(a, bool)]
        parent = next((a for a in args if isinstance(a, QWidget)), None)
        super().__init__(parent)
        self._kc_rows = ints[0] if ints else 0
        self._kc_cols = ints[1] if len(ints) > 1 else 0
        self._kc_cells = {}           # (r, c) -> item
        self._kc_widgets = {}         # (r, c) -> widget
        self._kc_hlabels = []
        self._kc_vlabels = []
        self._kc_cur = (-1, -1)
        self._kc_hheader = _Header(self)
        self._kc_vheader = _Header(self)
        self._kc_selmode = 3
        self._kc_colw = {}

    def rowCount(self):
        return self._kc_rows

    def columnCount(self):
        return self._kc_cols

    def setRowCount(self, n):
        n = int(n)
        for key in [k for k in self._kc_cells if k[0] >= n]:
            self._kc_cells.pop(key)._view = None
        for key in [k for k in self._kc_widgets if k[0] >= n]:
            self._kc_widgets.pop(key).setParent(None)
        self._kc_rows = n
        self._touch()

    def setColumnCount(self, n):
        n = int(n)
        for key in [k for k in self._kc_cells if k[1] >= n]:
            self._kc_cells.pop(key)._view = None
        self._kc_cols = n
        self._touch()

    def insertRow(self, row):
        row = int(row)
        self._kc_cells = {((r + 1 if r >= row else r), c): it
                          for (r, c), it in self._kc_cells.items()}
        self._kc_widgets = {((r + 1 if r >= row else r), c): w
                            for (r, c), w in self._kc_widgets.items()}
        for (r, c), it in self._kc_cells.items():
            it._row, it._col = r, c
        self._kc_rows += 1
        self._touch()

    def removeRow(self, row):
        row = int(row)
        if not 0 <= row < self._kc_rows:
            return
        for key in [k for k in self._kc_cells if k[0] == row]:
            self._kc_cells.pop(key)._view = None
        for key in [k for k in self._kc_widgets if k[0] == row]:
            self._kc_widgets.pop(key).setParent(None)
        self._kc_cells = {((r - 1 if r > row else r), c): it
                          for (r, c), it in self._kc_cells.items()}
        self._kc_widgets = {((r - 1 if r > row else r), c): w
                            for (r, c), w in self._kc_widgets.items()}
        for (r, c), it in self._kc_cells.items():
            it._row, it._col = r, c
        self._kc_rows -= 1
        if self._kc_cur[0] >= self._kc_rows:
            self._kc_cur = (self._kc_rows - 1, self._kc_cur[1])
        self._touch()

    def insertColumn(self, col):
        self._kc_cols += 1
        self._touch()

    def removeColumn(self, col):
        self._kc_cols = max(0, self._kc_cols - 1)
        self._touch()

    def setItem(self, row, col, item):
        old = self._kc_cells.get((row, col))
        if old is not None:
            old._view = None
        if item is None:
            self._kc_cells.pop((row, col), None)
        else:
            item._row, item._col = row, col
            item._view = self
            self._kc_cells[(row, col)] = item
        self._touch()

    def item(self, row, col):
        return self._kc_cells.get((row, col))

    def takeItem(self, row, col):
        item = self._kc_cells.pop((row, col), None)
        if item is not None:
            item._view = None
        self._touch()
        return item

    def setCellWidget(self, row, col, w):
        old = self._kc_widgets.pop((row, col), None)
        if old is not None and old is not w:
            old.setParent(None)
        if w is not None:
            self._kc_widgets[(row, col)] = w
            self._kc_add_child(w)
        self._touch()

    def cellWidget(self, row, col):
        return self._kc_widgets.get((row, col))

    def removeCellWidget(self, row, col):
        self.setCellWidget(row, col, None)

    def setHorizontalHeaderLabels(self, labels):
        self._kc_hlabels = [str(x) for x in labels]
        self._kc_cols = max(self._kc_cols, len(labels))
        self._touch()

    def setVerticalHeaderLabels(self, labels):
        self._kc_vlabels = [str(x) for x in labels]
        self._touch()

    def setHorizontalHeaderItem(self, col, item):
        while len(self._kc_hlabels) <= col:
            self._kc_hlabels.append("")
        self._kc_hlabels[col] = item.text() if item else ""
        self._touch()

    def horizontalHeaderItem(self, col):
        if 0 <= col < len(self._kc_hlabels):
            return QTableWidgetItem(self._kc_hlabels[col])
        return None

    def horizontalHeader(self):
        return self._kc_hheader

    def verticalHeader(self):
        return self._kc_vheader

    def setColumnWidth(self, col, w):
        self._kc_colw[int(col)] = int(w)

    def columnWidth(self, col):
        return self._kc_colw.get(col, 100)

    def setRowHeight(self, *a):
        pass

    def resizeColumnsToContents(self):
        pass

    def resizeRowsToContents(self):
        pass

    def resizeColumnToContents(self, *a):
        pass

    def setShowGrid(self, *a):
        pass

    def setSortingEnabled(self, *a):
        pass

    def setWordWrap(self, *a):
        pass

    def setCornerButtonEnabled(self, *a):
        pass

    def clear(self):
        for it in self._kc_cells.values():
            it._view = None
        self._kc_cells = {}
        for w in self._kc_widgets.values():
            w.setParent(None)
        self._kc_widgets = {}
        self._kc_hlabels = []
        self._touch()

    def clearContents(self):
        for it in self._kc_cells.values():
            it._view = None
        self._kc_cells = {}
        for w in self._kc_widgets.values():
            w.setParent(None)
        self._kc_widgets = {}
        self._touch()

    def currentRow(self):
        return self._kc_cur[0]

    def currentColumn(self):
        return self._kc_cur[1]

    def currentItem(self):
        return self._kc_cells.get(self._kc_cur)

    def setCurrentCell(self, row, col, *a):
        old = self._kc_cur
        self._kc_cur = (int(row), int(col))
        for it in self._kc_cells.values():
            it._selected = (it._row, it._col) == self._kc_cur
        self._touch()
        if old != self._kc_cur and not self.signalsBlocked():
            self.currentCellChanged.emit(row, col, old[0], old[1])
            self._kc_selection_changed()

    def setCurrentItem(self, item, *a):
        if item is not None:
            self.setCurrentCell(item._row, item._col)

    def selectRow(self, row):
        self.setCurrentCell(row, max(self._kc_cur[1], 0))

    def selectedItems(self):
        return [it for it in self._kc_cells.values() if it._selected]

    def selectedRanges(self):
        return []

    def clearSelection(self):
        for it in self._kc_cells.values():
            it._selected = False
        self._touch()

    def scrollToItem(self, *a):
        pass

    def scrollToBottom(self):
        pass

    def editItem(self, *a):
        pass

    def row(self, item):
        return item._row

    def column(self, item):
        return item._col

    def _kc_selection_changed(self):
        if not self.signalsBlocked():
            self.itemSelectionChanged.emit()

    def _kc_item_changed(self, item):
        if not self.signalsBlocked():
            self.itemChanged.emit(item)
            self.cellChanged.emit(item._row, item._col)

    # -- the web side
    def _kc_edit(self, row, col, text):
        item = self._kc_cells.get((row, col))
        if item is None:
            item = QTableWidgetItem("")
            self.blockSignals(True)
            self.setItem(row, col, item)
            self.blockSignals(False)
        item.setText(text)
