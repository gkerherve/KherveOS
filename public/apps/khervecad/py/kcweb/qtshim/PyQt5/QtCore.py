"""PyQt5.QtCore stand-in (see _core.py)."""
from ._core import (Inert, InertObject, QByteArray, QBuffer,  # noqa: F401
                    QCoreApplication, QObject, QPoint, QPointF, QRect,
                    QRectF, QSettings, QSize, QSizeF, QStandardPaths,
                    QTimer, inert_class, process_events, pyqtProperty,
                    pyqtSignal, pyqtSlot)
from ._core import _InertMeta, Lenient
from ._graphics import QLineF  # noqa: F401

PYQT_VERSION_STR = "5.15.10 (KherveOS shim)"
QT_VERSION_STR = "5.15.2"


class Qt(metaclass=_InertMeta):
    """Qt's namespace: the real values where the desktop code compares
    or combines them (buttons, modifiers, keys, roles, flags), a stable
    int for the rest."""
    # roles
    DisplayRole, DecorationRole, EditRole, ToolTipRole = 0, 1, 2, 3
    StatusTipRole, WhatsThisRole, FontRole, TextAlignmentRole = 4, 5, 6, 7
    BackgroundRole, ForegroundRole, CheckStateRole = 8, 9, 10
    UserRole = 256
    # check states
    Unchecked, PartiallyChecked, Checked = 0, 1, 2
    # item flags
    NoItemFlags = 0
    ItemIsSelectable, ItemIsEditable, ItemIsDragEnabled = 1, 2, 4
    ItemIsDropEnabled, ItemIsUserCheckable, ItemIsEnabled = 8, 16, 32
    ItemIsAutoTristate, ItemNeverHasChildren = 64, 128
    # orientation
    Horizontal, Vertical = 1, 2
    # mouse buttons
    NoButton, LeftButton, RightButton, MiddleButton = 0, 1, 2, 4
    MidButton = 4
    # modifiers
    NoModifier = 0
    ShiftModifier = 0x02000000
    ControlModifier = 0x04000000
    AltModifier = 0x08000000
    MetaModifier = 0x10000000
    KeypadModifier = 0x20000000
    # alignment
    AlignLeft, AlignRight, AlignHCenter, AlignJustify = 1, 2, 4, 8
    AlignTop, AlignBottom, AlignVCenter = 0x20, 0x40, 0x80
    AlignCenter = 0x84
    AlignLeading, AlignTrailing = 1, 2
    # pens and brushes
    NoPen, SolidLine, DashLine, DotLine, DashDotLine = 0, 1, 2, 3, 4
    NoBrush, SolidPattern = 0, 1
    FlatCap, SquareCap, RoundCap = 0x00, 0x10, 0x20
    MiterJoin, BevelJoin, RoundJoin = 0x00, 0x40, 0x80
    OddEvenFill, WindingFill = 0, 1
    # colours
    transparent = "transparent"
    black, white, red, green, blue = "black", "white", "red", "green", "blue"
    gray, darkGray, lightGray = "gray", "darkgray", "lightgray"
    yellow, cyan, magenta = "yellow", "cyan", "magenta"
    # cursors
    ArrowCursor, UpArrowCursor, CrossCursor, WaitCursor = 0, 1, 2, 3
    IBeamCursor, SizeVerCursor, SizeHorCursor = 4, 5, 6
    SizeBDiagCursor, SizeFDiagCursor, SizeAllCursor = 7, 8, 9
    BlankCursor, SplitVCursor, SplitHCursor = 10, 11, 12
    PointingHandCursor, ForbiddenCursor = 13, 14
    OpenHandCursor, ClosedHandCursor = 17, 18
    WhatsThisCursor, BusyCursor, DragMoveCursor = 15, 16, 20
    # docks / toolbars
    LeftDockWidgetArea, RightDockWidgetArea = 1, 2
    TopDockWidgetArea, BottomDockWidgetArea = 4, 8
    AllDockWidgetAreas = 15
    LeftToolBarArea, RightToolBarArea = 1, 2
    TopToolBarArea, BottomToolBarArea = 4, 8
    # tool button styles
    ToolButtonIconOnly, ToolButtonTextOnly = 0, 1
    ToolButtonTextBesideIcon, ToolButtonTextUnderIcon = 2, 3
    ToolButtonFollowStyle = 4
    # misc
    CustomContextMenu, DefaultContextMenu, NoContextMenu = 3, 1, 0
    ActionsContextMenu, PreventContextMenu = 2, 4
    ScrollBarAlwaysOff, ScrollBarAlwaysOn, ScrollBarAsNeeded = 1, 2, 0
    WindowModal, ApplicationModal, NonModal = 1, 2, 0
    MoveAction, CopyAction, LinkAction, IgnoreAction = 2, 1, 4, 0
    RichText, PlainText, AutoText, MarkdownText = 1, 0, 2, 3
    KeepAspectRatio, IgnoreAspectRatio = 1, 0
    SmoothTransformation, FastTransformation = 1, 0
    TextSelectableByMouse, LinksAccessibleByMouse = 1, 4
    TextBrowserInteraction = 13
    ClickFocus, StrongFocus, NoFocus, TabFocus, WheelFocus = 2, 11, 0, 1, 15
    ElideRight, ElideLeft, ElideMiddle, ElideNone = 1, 0, 2, 3
    WA_DeleteOnClose, WA_StyledBackground = 55, 93
    WA_TransparentForMouseEvents, WA_TranslucentBackground = 51, 120
    Window, Dialog, Tool, Popup = 1, 3, 11, 9
    FramelessWindowHint, WindowStaysOnTopHint = 0x800, 0x40000
    MatchExactly, MatchContains, MatchFixedString = 0, 1, 8
    CaseInsensitive, CaseSensitive = 0, 1
    AscendingOrder, DescendingOrder = 0, 1
    UniqueConnection, QueuedConnection, DirectConnection = 0x80, 2, 1
    # keys
    Key_Escape, Key_Tab, Key_Backtab, Key_Backspace = (0x01000000,
                                                       0x01000001,
                                                       0x01000002,
                                                       0x01000003)
    Key_Return, Key_Enter, Key_Insert, Key_Delete = (0x01000004, 0x01000005,
                                                     0x01000006, 0x01000007)
    Key_Pause, Key_Print, Key_Home, Key_End = (0x01000008, 0x01000009,
                                               0x01000010, 0x01000011)
    Key_Left, Key_Up, Key_Right, Key_Down = (0x01000012, 0x01000013,
                                             0x01000014, 0x01000015)
    Key_PageUp, Key_PageDown = 0x01000016, 0x01000017
    Key_Shift, Key_Control, Key_Meta, Key_Alt = (0x01000020, 0x01000021,
                                                 0x01000022, 0x01000023)
    Key_Space, Key_Plus, Key_Minus, Key_Equal = 0x20, 0x2b, 0x2d, 0x3d
    Key_Comma, Key_Period, Key_Slash, Key_Asterisk = 0x2c, 0x2e, 0x2f, 0x2a
    Key_BracketLeft, Key_BracketRight = 0x5b, 0x5d
    Key_Apostrophe, Key_QuoteLeft = 0x27, 0x60


for _i in range(10):
    setattr(Qt, f"Key_{_i}", 0x30 + _i)
for _i, _c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    setattr(Qt, f"Key_{_c}", 0x41 + _i)
for _i in range(1, 36):
    setattr(Qt, f"Key_F{_i}", 0x01000030 + _i - 1)


class QEvent(Inert):
    None_ = 0
    MouseButtonPress = 2
    MouseButtonRelease = 3
    MouseButtonDblClick = 4
    MouseMove = 5
    KeyPress = 6
    KeyRelease = 7
    FocusIn = 8
    FocusOut = 9
    Enter = 10
    Leave = 11
    Paint = 12
    Move = 13
    Resize = 14
    Show = 17
    Hide = 18
    Close = 19
    Wheel = 31
    ContextMenu = 82
    ShortcutOverride = 51
    LanguageChange = 89
    ToolTip = 110
    HoverEnter = 127
    HoverLeave = 128
    HoverMove = 129

    def __init__(self, kind=0, *a):
        self._kind = kind
        self._accepted = True

    def type(self):
        return self._kind

    def accept(self):
        self._accepted = True

    def ignore(self):
        self._accepted = False

    def isAccepted(self):
        return self._accepted


class QUrl(Lenient):
    def __init__(self, url=""):
        self._url = url._url if isinstance(url, QUrl) else str(url or "")

    @staticmethod
    def fromLocalFile(path):
        return QUrl("file://" + str(path))

    def toString(self, *a):
        return self._url

    def toLocalFile(self):
        return self._url[7:] if self._url.startswith("file://") else ""

    def isLocalFile(self):
        return self._url.startswith("file://")

    def isValid(self):
        return bool(self._url)

    def scheme(self):
        return self._url.split(":", 1)[0] if ":" in self._url else ""

    def __str__(self):
        return self._url


class QThread(QObject):
    started = pyqtSignal()
    finished = pyqtSignal()

    def start(self, *a):
        self.started.emit()
        try:
            self.run()
        finally:
            self.finished.emit()

    def run(self):
        pass

    def wait(self, *a):
        return True

    def isRunning(self):
        return False

    def quit(self):
        pass

    def requestInterruption(self):
        pass

    def isInterruptionRequested(self):
        return False

    @staticmethod
    def currentThread():
        return None

    @staticmethod
    def msleep(*a):
        pass


def qVersion():
    return QT_VERSION_STR


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return inert_class(name)
