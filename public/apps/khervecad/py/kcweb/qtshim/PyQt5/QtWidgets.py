"""PyQt5.QtWidgets stand-in: headless widgets with state and signals
(_widgets, _views, _dialogs, _graphics); anything else is inert."""
from ._core import (Inert, InertObject, QUndoCommand,  # noqa: F401
                    QUndoStack, inert_class)
from ._widgets import *  # noqa: F401,F403
from ._widgets import (QAction, QActionGroup, QWidgetAction,  # noqa: F401
                       QKeySequence, QIcon, POPUPS, REGISTRY)
from ._views import (QAbstractItemView, QHeaderView,  # noqa: F401
                     QListView, QListWidget, QListWidgetItem, QTableView,
                     QTableWidget, QTableWidgetItem, QTreeView, QTreeWidget,
                     QTreeWidgetItem)
from ._dialogs import (QColorDialog, QDialog, QDialogButtonBox,  # noqa
                       QErrorMessage, QFileDialog, QFontDialog,
                       QInputDialog, QMessageBox, QProgressDialog,
                       QSplashScreen, QWizard, QWizardPage, MESSAGES)
from ._painter import QStyleOptionGraphicsItem  # noqa: F401
from ._graphics import (QGraphicsEllipseItem, QGraphicsItem,  # noqa: F401
                        QGraphicsItemGroup, QGraphicsLineItem,
                        QGraphicsObject, QGraphicsPathItem,
                        QGraphicsPixmapItem, QGraphicsPolygonItem,
                        QGraphicsRectItem, QGraphicsScene,
                        QGraphicsSimpleTextItem, QGraphicsTextItem,
                        QGraphicsView, QAbstractGraphicsShapeItem)


class _Clipboard:
    def __init__(self):
        self._text = ""

    def text(self, *_a):
        return self._text

    def setText(self, text, *_a):
        self._text = str(text)

    def mimeData(self, *_a):
        return Inert()

    def setMimeData(self, *_a):
        pass

    def image(self, *_a):
        return Inert()

    def setImage(self, *_a):
        pass

    def setPixmap(self, *_a):
        pass


CLIPBOARD = _Clipboard()


class QApplication(InertObject):
    @staticmethod
    def instance():
        return None

    @staticmethod
    def clipboard():
        return CLIPBOARD

    @staticmethod
    def processEvents(*_a):
        pass

    @staticmethod
    def activeWindow():
        return None

    @staticmethod
    def focusWidget():
        return None

    @staticmethod
    def keyboardModifiers():
        return 0

    @staticmethod
    def mouseButtons():
        return 0

    @staticmethod
    def setOverrideCursor(*_a):
        pass

    @staticmethod
    def restoreOverrideCursor(*_a):
        pass

    @staticmethod
    def beep():
        pass

    @staticmethod
    def topLevelWidgets():
        return []

    @staticmethod
    def allWidgets():
        return []

    @staticmethod
    def setStyle(*_a):
        pass

    @staticmethod
    def setPalette(*_a):
        pass

    @staticmethod
    def palette(*_a):
        return Inert()

    @staticmethod
    def font(*_a):
        from .QtGui import QFont
        return QFont()

    @staticmethod
    def desktop():
        return Inert()

    @staticmethod
    def primaryScreen():
        return Inert()

    @staticmethod
    def screens():
        return []

    @staticmethod
    def style():
        return Inert()


class QShortcut(InertObject):
    """A key bound to a slot: kept in SHORTCUTS for the web side."""
    from ._core import pyqtSignal as _sig
    activated = _sig()
    activatedAmbiguously = _sig()
    del _sig

    def __init__(self, key=None, parent=None, member=None, *a, **k):
        super().__init__(parent)
        self._kc_key = str(QKeySequence(key)) if key is not None else ""
        self._kc_parent = parent
        self._kc_enabled = True
        if callable(member):
            self.activated.connect(member)
        SHORTCUTS.append(self)

    def setKey(self, key):
        self._kc_key = str(QKeySequence(key))

    def key(self):
        return QKeySequence(self._kc_key)

    def setEnabled(self, on):
        self._kc_enabled = bool(on)

    def setContext(self, *a):
        pass

    def setAutoRepeat(self, *a):
        pass


SHORTCUTS = []


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return inert_class(name)
