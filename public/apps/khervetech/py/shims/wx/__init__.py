"""A headless wx for KherveOS: the desktop KherveFitting-AI tool windows run
unchanged in Pyodide, and React draws them.

Every widget the desktop code creates is a plain Python object here that
keeps its state (label, value, choices, selection, rows…), its event
bindings and its place in the sizer tree. ``ktech.bridge`` serialises the
open frames (``serialise_frame``) for the page and feeds the user's clicks
and typing back in (``apply_event``), which fires the same handlers wx would.

Modal dialogs cannot block in a browser, so ``ShowModal`` replays: the first
time it is reached it raises ``NeedModal`` with what to ask; the page asks,
then sends the same event again with the answer, and ``ShowModal`` returns it
(answers are consumed in order, so a handler may ask several things).

Only what the technique windows use is here; an unknown upper-case constant
resolves to a fresh integer (so ``wx.SOME_FLAG`` never stops a window from
opening), an unknown class raises AttributeError.

Copyright (C) 2026 Gwilherm Kerherve — GPL-3.0.
"""

from __future__ import annotations

import itertools

# ---------------------------------------------------------------- constants

TOP, BOTTOM, LEFT, RIGHT = 0x40, 0x80, 0x10, 0x20
UP, DOWN = TOP, BOTTOM
ALL = TOP | BOTTOM | LEFT | RIGHT
EXPAND = GROW = 0x2000
SHAPED = 0x4000
FIXED_MINSIZE = 0x8000
RESERVE_SPACE_EVEN_IF_HIDDEN = 0x0002
ALIGN_LEFT = ALIGN_TOP = ALIGN_NOT = 0
ALIGN_CENTER_HORIZONTAL = ALIGN_CENTRE_HORIZONTAL = 0x0100
ALIGN_RIGHT = 0x0200
ALIGN_BOTTOM = 0x0400
ALIGN_CENTER_VERTICAL = ALIGN_CENTRE_VERTICAL = 0x0800
ALIGN_CENTER = ALIGN_CENTRE = ALIGN_CENTER_HORIZONTAL | ALIGN_CENTER_VERTICAL
HORIZONTAL, VERTICAL, BOTH = 4, 8, 12

ID_ANY = -1
ID_OK, ID_CANCEL, ID_APPLY, ID_YES, ID_NO, ID_CLOSE, ID_HELP = 5100, 5101, 5102, 5103, 5104, 5108, 5009
ID_SAVE, ID_OPEN, ID_EXIT = 5003, 5000, 5006
OK, YES, NO, CANCEL, YES_NO, HELP = 0x4, 0x2, 0x8, 0x10, 0xA, 0x1000
YES_DEFAULT, NO_DEFAULT, OK_DEFAULT, CANCEL_DEFAULT = 0, 0x80, 0, 0x80000000
ICON_EXCLAMATION = ICON_WARNING = 0x100
ICON_ERROR = ICON_HAND = ICON_STOP = 0x200
ICON_QUESTION = 0x400
ICON_INFORMATION = ICON_ASTERISK = 0x800
ICON_NONE = 0x40000
STAY_ON_TOP = 0x8000
CENTRE = CENTER = 0x1

TE_MULTILINE, TE_READONLY, TE_PROCESS_ENTER, TE_DONTWRAP, TE_RICH, TE_RICH2, TE_PASSWORD = \
    0x20, 0x10, 0x400, 0x40000000, 0x8000, 0x10000000, 0x800
TE_LEFT, TE_CENTER, TE_CENTRE, TE_RIGHT, TE_WORDWRAP, TE_NO_VSCROLL = 0, 0x100, 0x100, 0x200, 0x1000, 0x80
CB_READONLY, CB_DROPDOWN, CB_SORT, CB_SIMPLE = 0x10, 0x20, 0x8, 0x4
RB_GROUP, RB_SINGLE = 0x4, 0x8
RA_SPECIFY_COLS, RA_SPECIFY_ROWS = 0x4, 0x8
BU_EXACTFIT, BU_LEFT, BU_RIGHT, BU_TOP, BU_BOTTOM, BU_NOTEXT = 0x1, 0x40, 0x100, 0x80, 0x200, 0x2
SP_ARROW_KEYS, SP_WRAP = 0x4000, 0x8000
SL_HORIZONTAL, SL_VERTICAL, SL_LABELS, SL_VALUE_LABEL, SL_AUTOTICKS = 0x4, 0x8, 0x20, 0x80, 0x10
GA_HORIZONTAL, GA_VERTICAL, GA_SMOOTH = 4, 8, 0x20
LB_SINGLE, LB_MULTIPLE, LB_EXTENDED, LB_SORT, LB_NEEDED_SB, LB_HSCROLL = 0, 0x40, 0x80, 0x10, 0x200, 0x40000000
LC_REPORT, LC_LIST, LC_ICON, LC_SINGLE_SEL, LC_HRULES, LC_VRULES, LC_NO_HEADER = 0x20, 0x10, 0x4, 0x2000, 0x800, 0x1000, 0x800000
LIST_FORMAT_LEFT, LIST_FORMAT_RIGHT, LIST_FORMAT_CENTRE = 0, 1, 2
LIST_AUTOSIZE, LIST_AUTOSIZE_USEHEADER = -1, -2
LIST_NEXT_ALL, LIST_STATE_SELECTED = 0, 2
NB_TOP, NB_LEFT, NB_RIGHT, NB_BOTTOM, NB_MULTILINE, NB_NOPAGETHEME = 0, 0x10, 0x20, 0x40, 0x100, 0x8
SP_3D, SP_LIVE_UPDATE, SP_BORDER, SP_3DSASH, SP_NOBORDER = 0x300, 0x80, 0x200, 0x100, 0
BORDER_NONE, BORDER_SIMPLE, BORDER_SUNKEN, BORDER_RAISED, BORDER_THEME, BORDER_STATIC, BORDER_DEFAULT = \
    0x200000, 0x2000000, 0x8000000, 0x4000000, 0x10000000, 0x1000000, 0
NO_BORDER, SIMPLE_BORDER, SUNKEN_BORDER, RAISED_BORDER, STATIC_BORDER = BORDER_NONE, BORDER_SIMPLE, BORDER_SUNKEN, BORDER_RAISED, BORDER_STATIC
TAB_TRAVERSAL, WANTS_CHARS, FULL_REPAINT_ON_RESIZE, CLIP_CHILDREN, VSCROLL, HSCROLL, ALWAYS_SHOW_SB = \
    0x80000, 0x40000, 0x10000, 0x400000, 0x80000000, 0x40000000, 0x800000
DEFAULT_FRAME_STYLE, FRAME_FLOAT_ON_PARENT, FRAME_TOOL_WINDOW, FRAME_NO_TASKBAR, RESIZE_BORDER, CAPTION, \
    CLOSE_BOX, MINIMIZE_BOX, MAXIMIZE_BOX, SYSTEM_MENU = \
    0x20400e40, 0x8, 0x4, 0x2, 0x40, 0x20000000, 0x1000, 0x400, 0x200, 0x800
DEFAULT_DIALOG_STYLE = 0x20001800
LI_HORIZONTAL, LI_VERTICAL = 4, 8
ST_NO_AUTORESIZE, ST_ELLIPSIZE_END, ALIGN_CENTRE_TEXT = 0x1, 0x10, 0x100
FD_OPEN, FD_SAVE, FD_OVERWRITE_PROMPT, FD_FILE_MUST_EXIST, FD_MULTIPLE, FD_CHANGE_DIR, FD_PREVIEW = \
    0x1, 0x2, 0x4, 0x10, 0x20, 0x80, 0x100
DD_DEFAULT_STYLE, DD_DIR_MUST_EXIST, DD_NEW_DIR_BUTTON = 0x20000c00, 0x200, 0
CHOICEDLG_STYLE = 0x2005
FONTFAMILY_DEFAULT, FONTFAMILY_DECORATIVE, FONTFAMILY_ROMAN, FONTFAMILY_SCRIPT, FONTFAMILY_SWISS, \
    FONTFAMILY_MODERN, FONTFAMILY_TELETYPE = 70, 71, 72, 73, 74, 75, 76
DEFAULT, DECORATIVE, ROMAN, SCRIPT, SWISS, MODERN, TELETYPE = 70, 71, 72, 73, 74, 75, 76
FONTSTYLE_NORMAL, FONTSTYLE_ITALIC, FONTSTYLE_SLANT = 90, 93, 94
NORMAL, ITALIC, SLANT = 90, 93, 94
FONTWEIGHT_NORMAL, FONTWEIGHT_LIGHT, FONTWEIGHT_BOLD, FONTWEIGHT_SEMIBOLD, FONTWEIGHT_MEDIUM = 400, 300, 700, 600, 500
BOLD, LIGHT = 700, 300
NOT_FOUND = -1
BITMAP_TYPE_PNG, BITMAP_TYPE_ANY, BITMAP_TYPE_ICO, BITMAP_TYPE_JPEG, BITMAP_TYPE_BMP = 15, 50, 3, 17, 1
CURSOR_ARROW, CURSOR_HAND, CURSOR_WAIT, CURSOR_CROSS, CURSOR_SIZEWE = 1, 6, 22, 5, 16
WXK_RETURN, WXK_ESCAPE, WXK_TAB, WXK_DELETE, WXK_BACK, WXK_SPACE = 13, 27, 9, 127, 8, 32
WXK_LEFT, WXK_UP, WXK_RIGHT, WXK_DOWN = 314, 315, 316, 317
WXK_NUMPAD_ENTER, WXK_SUBTRACT, WXK_NUMPAD_SUBTRACT, WXK_ADD, WXK_NUMPAD_ADD = 370, 393, 392, 388, 388
WXK_CONTROL, WXK_SHIFT, WXK_ALT, WXK_F1 = 308, 306, 307, 340
MOD_NONE, MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_CMD = 0, 1, 2, 4, 2
ACCEL_NORMAL, ACCEL_ALT, ACCEL_CTRL, ACCEL_SHIFT, ACCEL_CMD = 0, 1, 2, 4, 2
SYS_COLOUR_WINDOW, SYS_COLOUR_BTNFACE, SYS_COLOUR_WINDOWTEXT, SYS_COLOUR_3DFACE, SYS_COLOUR_GRAYTEXT, \
    SYS_COLOUR_HIGHLIGHT, SYS_COLOUR_LISTBOX = 5, 15, 8, 15, 17, 13, 25
SYS_DEFAULT_GUI_FONT = 17
ITEM_NORMAL, ITEM_CHECK, ITEM_RADIO, ITEM_SEPARATOR = 0, 1, 2, -1
TB_HORIZONTAL, TB_VERTICAL, TB_FLAT, TB_TEXT, TB_NODIVIDER = 4, 8, 0x40, 0x100, 0x200
ART_INFORMATION, ART_WARNING, ART_ERROR = 'wxART_INFORMATION', 'wxART_WARNING', 'wxART_ERROR'
NullBitmap = None
DefaultPosition = (-1, -1)
EmptyString = ''
Platform = '__WXWEB__'
PlatformInfo = ('__WXWEB__', 'wxWeb', 'KherveOS')
VERSION = (4, 2, 1, '')
VERSION_STRING = '4.2.1 (KherveOS headless)'


def __getattr__(name):  # pragma: no cover - only for constants the shim lacks
    if name.isupper() or name.startswith(('WXK_', 'ID_', 'SYS_')):
        value = 0x7F000000 + (hash(name) & 0xFFFF)
        globals()[name] = value
        return value
    raise AttributeError(f"module 'wx' (KherveOS headless) has no attribute '{name}'")


# ------------------------------------------------------------- small types

class Size(tuple):
    def __new__(cls, w=-1, h=-1):
        if isinstance(w, (tuple, list)):
            w, h = w
        return super().__new__(cls, (int(w), int(h)))

    width = property(lambda s: s[0])
    height = property(lambda s: s[1])
    GetWidth = lambda s: s[0]
    GetHeight = lambda s: s[1]
    Get = lambda s: (s[0], s[1])


DefaultSize = Size(-1, -1)


class Point(tuple):
    def __new__(cls, x=0, y=0):
        if isinstance(x, (tuple, list)):
            x, y = x
        return super().__new__(cls, (int(x), int(y)))

    x = property(lambda s: s[0])
    y = property(lambda s: s[1])
    Get = lambda s: (s[0], s[1])


class Rect:
    def __init__(self, x=0, y=0, w=0, h=0):
        self.x, self.y, self.width, self.height = x, y, w, h

    def GetWidth(self):
        return self.width

    def GetHeight(self):
        return self.height


class Colour:
    def __init__(self, r=0, g=0, b=0, a=255):
        if isinstance(r, Colour):
            r, g, b, a = r.r, r.g, r.b, r.a
        elif isinstance(r, str):
            r, g, b, a = _parse_colour(r)
        elif isinstance(r, (tuple, list)):
            r, g, b, a = (list(r) + [255])[:4]
        self.r, self.g, self.b, self.a = int(r), int(g), int(b), int(a)

    Red = lambda s: s.r
    Green = lambda s: s.g
    Blue = lambda s: s.b
    Alpha = lambda s: s.a
    IsOk = lambda s: True

    def Get(self, includeAlpha=False):
        return (self.r, self.g, self.b, self.a) if includeAlpha else (self.r, self.g, self.b)

    def GetAsString(self, flags=0):
        return self.css()

    def css(self):
        if self.a >= 255:
            return f"#{self.r:02x}{self.g:02x}{self.b:02x}"
        return f"rgba({self.r},{self.g},{self.b},{self.a / 255:.3f})"

    def __eq__(self, other):
        try:
            return Colour(other).Get(True) == self.Get(True)
        except Exception:
            return False

    def __hash__(self):
        return hash(self.Get(True))


_NAMED = {'black': (0, 0, 0), 'white': (255, 255, 255), 'red': (255, 0, 0), 'green': (0, 255, 0),
          'blue': (0, 0, 255), 'grey': (128, 128, 128), 'gray': (128, 128, 128), 'light grey': (211, 211, 211),
          'yellow': (255, 255, 0), 'orange': (255, 165, 0), 'dark grey': (169, 169, 169)}


def _parse_colour(text):
    t = text.strip().lower()
    if t.startswith('#') and len(t) in (7, 9):
        r, g, b = int(t[1:3], 16), int(t[3:5], 16), int(t[5:7], 16)
        a = int(t[7:9], 16) if len(t) == 9 else 255
        return r, g, b, a
    r, g, b = _NAMED.get(t, (0, 0, 0))
    return r, g, b, 255


NamedColour = Colour
BLACK, WHITE, RED, GREEN, BLUE = Colour(0, 0, 0), Colour(255, 255, 255), Colour(255, 0, 0), Colour(0, 255, 0), Colour(0, 0, 255)
LIGHT_GREY, Colour.__module__ = Colour(192, 192, 192), 'wx'
NullColour = Colour(0, 0, 0, 0)


class FontInfo:
    def __init__(self, size=10):
        self.size, self.family, self.weight, self.style, self.face = size, FONTFAMILY_DEFAULT, FONTWEIGHT_NORMAL, FONTSTYLE_NORMAL, ''

    def Family(self, family):
        self.family = family
        return self

    def Bold(self, bold=True):
        self.weight = FONTWEIGHT_BOLD if bold else FONTWEIGHT_NORMAL
        return self

    def Italic(self, italic=True):
        self.style = FONTSTYLE_ITALIC if italic else FONTSTYLE_NORMAL
        return self

    def FaceName(self, face):
        self.face = face
        return self

    def Light(self, light=True):
        return self


class Font:
    def __init__(self, pointSize=10, family=FONTFAMILY_DEFAULT, style=FONTSTYLE_NORMAL, weight=FONTWEIGHT_NORMAL,
                 underline=False, faceName='', *a, **kw):
        if isinstance(pointSize, FontInfo):
            fi = pointSize
            pointSize, family, style, weight, faceName = fi.size, fi.family, fi.style, fi.weight, fi.face
        elif isinstance(pointSize, Font):
            f = pointSize
            pointSize, family, style, weight, faceName = f.size, f.family, f.style, f.weight, f.face
        elif isinstance(pointSize, (tuple, Size)):
            pointSize = pointSize[1] if len(pointSize) > 1 and pointSize[1] > 0 else 10
        self.size, self.family, self.style, self.weight, self.face = pointSize, family, style, weight, faceName
        self.underline = underline

    GetPointSize = lambda s: s.size
    GetFamily = lambda s: s.family
    GetWeight = lambda s: s.weight
    GetStyle = lambda s: s.style
    GetFaceName = lambda s: s.face
    IsOk = lambda s: True

    def SetPointSize(self, n):
        self.size = n

    def SetWeight(self, w):
        self.weight = w

    def SetStyle(self, s):
        self.style = s

    def SetFamily(self, f):
        self.family = f

    def SetFaceName(self, f):
        self.face = f
        return True

    def SetUnderlined(self, u):
        self.underline = u

    def MakeBold(self):
        self.weight = FONTWEIGHT_BOLD
        return self

    def Bold(self):
        return Font(self.size, self.family, self.style, FONTWEIGHT_BOLD, False, self.face)

    def MakeLarger(self):
        self.size = round(self.size * 1.2)
        return self

    def MakeSmaller(self):
        self.size = round(self.size / 1.2)
        return self

    def Scaled(self, k):
        return Font(round(self.size * k), self.family, self.style, self.weight, False, self.face)

    def css(self):
        out = {'size': self.size}
        if self.family in (FONTFAMILY_TELETYPE, FONTFAMILY_MODERN):
            out['mono'] = True
        if self.weight >= FONTWEIGHT_SEMIBOLD:
            out['bold'] = True
        if self.style == FONTSTYLE_ITALIC:
            out['italic'] = True
        return out


NORMAL_FONT = Font(10)
SMALL_FONT = Font(8)


class SystemSettings:
    @staticmethod
    def GetColour(index):
        return {SYS_COLOUR_WINDOW: Colour(255, 255, 255), SYS_COLOUR_WINDOWTEXT: Colour(0, 0, 0),
                SYS_COLOUR_GRAYTEXT: Colour(128, 128, 128), SYS_COLOUR_HIGHLIGHT: Colour(79, 190, 159)}.get(
            index, Colour(240, 240, 240))

    @staticmethod
    def GetFont(index):
        return Font(10)

    @staticmethod
    def GetAppearance():
        return _Appearance()

    @staticmethod
    def GetMetric(index, win=None):
        return 16


class _Appearance:
    IsDark = lambda s: False
    IsUsingDarkBackground = lambda s: False


class Bitmap:
    def __init__(self, name='', type=BITMAP_TYPE_ANY, *a, **kw):
        self.name = name if isinstance(name, str) else ''
        self.size = (25, 25)

    IsOk = lambda s: True
    GetWidth = lambda s: s.size[0]
    GetHeight = lambda s: s.size[1]
    GetSize = lambda s: Size(*s.size)

    def ConvertToImage(self):
        return Image(self.name)

    @staticmethod
    def FromRGBA(w, h, *a, **kw):
        b = Bitmap()
        b.size = (w, h)
        return b

    def css(self):
        import os
        return os.path.basename(self.name) if self.name else ''


class Image:
    def __init__(self, name='', *a, **kw):
        self.name = name if isinstance(name, str) else ''

    def Scale(self, w, h, *a):
        return self

    Rescale = Scale
    ConvertToBitmap = lambda s: Bitmap(s.name)
    IsOk = lambda s: True


BitmapBundle = Bitmap


class Icon(Bitmap):
    def CopyFromBitmap(self, b):
        pass


class ArtProvider:
    @staticmethod
    def GetBitmap(name, client=None, size=None):
        return Bitmap(str(name))


class Cursor:
    def __init__(self, *a, **kw):
        pass


StockCursor = Cursor


class MemoryDC:
    def __init__(self, *a, **kw):
        pass

    def __getattr__(self, name):
        return lambda *a, **kw: None


class GraphicsContext:
    @staticmethod
    def Create(*a, **kw):
        return MemoryDC()


# -------------------------------------------------------------------- events

class PyEventBinder:
    _ids = itertools.count(10000)

    def __init__(self, name, command=True):
        self.name = name
        self.typeId = next(PyEventBinder._ids)
        self.command = command

    def __call__(self, *a, **kw):  # old-style EVT_BUTTON(win, id, fn)
        pass

    def __repr__(self):
        return f"<wx.{self.name}>"


_B = PyEventBinder
EVT_BUTTON, EVT_TEXT, EVT_TEXT_ENTER, EVT_CHOICE, EVT_COMBOBOX, EVT_CHECKBOX, EVT_RADIOBUTTON, EVT_RADIOBOX = (
    _B('EVT_BUTTON'), _B('EVT_TEXT'), _B('EVT_TEXT_ENTER'), _B('EVT_CHOICE'), _B('EVT_COMBOBOX'), _B('EVT_CHECKBOX'),
    _B('EVT_RADIOBUTTON'), _B('EVT_RADIOBOX'))
EVT_SPINCTRL, EVT_SPINCTRLDOUBLE, EVT_SPIN, EVT_SLIDER, EVT_LISTBOX, EVT_LISTBOX_DCLICK, EVT_CHECKLISTBOX, \
    EVT_TOGGLEBUTTON = (_B('EVT_SPINCTRL'), _B('EVT_SPINCTRLDOUBLE'), _B('EVT_SPIN'), _B('EVT_SLIDER'),
                        _B('EVT_LISTBOX'), _B('EVT_LISTBOX_DCLICK'), _B('EVT_CHECKLISTBOX'), _B('EVT_TOGGLEBUTTON'))
EVT_NOTEBOOK_PAGE_CHANGED, EVT_NOTEBOOK_PAGE_CHANGING = _B('EVT_NOTEBOOK_PAGE_CHANGED'), _B('EVT_NOTEBOOK_PAGE_CHANGING')
EVT_MENU, EVT_TOOL, EVT_UPDATE_UI = _B('EVT_MENU'), _B('EVT_TOOL'), _B('EVT_UPDATE_UI')
EVT_CLOSE, EVT_SIZE, EVT_MOVE, EVT_PAINT, EVT_ERASE_BACKGROUND, EVT_SHOW, EVT_ACTIVATE, EVT_IDLE, EVT_TIMER, \
    EVT_WINDOW_DESTROY = (_B('EVT_CLOSE', False), _B('EVT_SIZE', False), _B('EVT_MOVE', False), _B('EVT_PAINT', False),
                          _B('EVT_ERASE_BACKGROUND', False), _B('EVT_SHOW', False), _B('EVT_ACTIVATE', False),
                          _B('EVT_IDLE', False), _B('EVT_TIMER', False), _B('EVT_WINDOW_DESTROY', False))
EVT_KILL_FOCUS, EVT_SET_FOCUS, EVT_CHAR, EVT_KEY_DOWN, EVT_KEY_UP, EVT_CHAR_HOOK = (
    _B('EVT_KILL_FOCUS', False), _B('EVT_SET_FOCUS', False), _B('EVT_CHAR', False), _B('EVT_KEY_DOWN', False),
    _B('EVT_KEY_UP', False), _B('EVT_CHAR_HOOK', False))
EVT_LEFT_DOWN, EVT_LEFT_UP, EVT_LEFT_DCLICK, EVT_RIGHT_DOWN, EVT_RIGHT_UP, EVT_MOTION, EVT_MOUSEWHEEL, \
    EVT_ENTER_WINDOW, EVT_LEAVE_WINDOW, EVT_CONTEXT_MENU = (
        _B('EVT_LEFT_DOWN', False), _B('EVT_LEFT_UP', False), _B('EVT_LEFT_DCLICK', False), _B('EVT_RIGHT_DOWN', False),
        _B('EVT_RIGHT_UP', False), _B('EVT_MOTION', False), _B('EVT_MOUSEWHEEL', False),
        _B('EVT_ENTER_WINDOW', False), _B('EVT_LEAVE_WINDOW', False), _B('EVT_CONTEXT_MENU'))
EVT_LIST_ITEM_SELECTED, EVT_LIST_ITEM_ACTIVATED, EVT_LIST_ITEM_DESELECTED, EVT_LIST_COL_CLICK, \
    EVT_LIST_ITEM_RIGHT_CLICK = (_B('EVT_LIST_ITEM_SELECTED'), _B('EVT_LIST_ITEM_ACTIVATED'),
                                 _B('EVT_LIST_ITEM_DESELECTED'), _B('EVT_LIST_COL_CLICK'),
                                 _B('EVT_LIST_ITEM_RIGHT_CLICK'))
EVT_SPLITTER_SASH_POS_CHANGED, EVT_SCROLLWIN, EVT_COLLAPSIBLEPANE_CHANGED, EVT_HYPERLINK, EVT_SEARCH = (
    _B('EVT_SPLITTER_SASH_POS_CHANGED'), _B('EVT_SCROLLWIN', False), _B('EVT_COLLAPSIBLEPANE_CHANGED'),
    _B('EVT_HYPERLINK'), _B('EVT_SEARCH'))
EVT_SEARCHCTRL_SEARCH_BTN = EVT_SEARCH


class Event:
    def __init__(self, binder=None, obj=None, **kw):
        self._binder = binder
        self._type = binder.typeId if isinstance(binder, PyEventBinder) else (binder or 0)
        self._obj = obj
        self._kw = kw
        self._skipped = False
        self._vetoed = False

    def GetEventObject(self):
        return self._obj

    def SetEventObject(self, obj):
        self._obj = obj

    def GetId(self):
        return self._obj.GetId() if self._obj is not None else ID_ANY

    def GetEventType(self):
        return self._type

    def Skip(self, skip=True):
        self._skipped = skip

    def GetSkipped(self):
        return self._skipped

    def Veto(self):
        self._vetoed = True

    def CanVeto(self):
        return True

    def Allow(self):
        self._vetoed = False

    def GetVeto(self):
        return self._vetoed

    def _from(self, key, getter):
        if key in self._kw:
            return self._kw[key]
        obj = self._obj
        fn = getattr(obj, getter, None) if obj is not None else None
        return fn() if fn else None

    def GetSelection(self):
        v = self._from('selection', 'GetSelection')
        return -1 if v is None else v

    def GetOldSelection(self):
        return self._kw.get('old', -1)

    def GetString(self):
        v = self._kw.get('string')
        if v is None and self._obj is not None:
            for getter in ('GetStringSelection', 'GetValue', 'GetLabel'):
                fn = getattr(self._obj, getter, None)
                if fn:
                    v = fn()
                    break
        return '' if v is None else str(v)

    def SetString(self, s):
        self._kw['string'] = s

    def GetInt(self):
        v = self._kw.get('int')
        if v is None:
            v = self.GetSelection()
        return v

    def SetInt(self, i):
        self._kw['int'] = i

    def IsChecked(self):
        v = self._from('checked', 'GetValue')
        return bool(v)

    def GetValue(self):
        return self._from('value', 'GetValue')

    def GetRow(self):
        return self._kw.get('row', -1)

    def GetCol(self):
        return self._kw.get('col', -1)

    def GetIndex(self):
        return self._kw.get('index', -1)

    def GetItem(self):
        return self._kw.get('index', -1)

    def GetKeyCode(self):
        return self._kw.get('key', 0)

    GetUnicodeKey = GetKeyCode

    def ControlDown(self):
        return bool(self._kw.get('ctrl'))

    CmdDown = ControlDown

    def ShiftDown(self):
        return bool(self._kw.get('shift'))

    def AltDown(self):
        return bool(self._kw.get('alt'))

    def GetPosition(self):
        return Point(*self._kw.get('pos', (0, 0)))

    def GetWheelRotation(self):
        return self._kw.get('wheel', 0)

    def GetClientData(self):
        return self._kw.get('data')


CommandEvent = Event
PyCommandEvent = Event
NotebookEvent = Event
CloseEvent = Event
KeyEvent = Event
MouseEvent = Event
SpinEvent = Event
ListEvent = Event


def NewEventType():
    return next(PyEventBinder._ids)


def PostEvent(target, event):
    CallAfter(lambda: target._dispatch(event))


# ---------------------------------------------------------- the event loop

class NeedModal(BaseException):
    """Raised by ShowModal when the page has not answered this dialog yet."""

    def __init__(self, spec):
        super().__init__(spec.get('kind', 'dialog'))
        self.spec = spec


class _Loop:
    after: list = []
    effects: list = []
    answers: list = []
    used = 0
    serial = itertools.count(1)


def CallAfter(fn, *args, **kw):
    _Loop.after.append((fn, args, kw))


class CallLater:
    def __init__(self, millis, fn, *args, **kw):
        self._fn, self._args, self._kw = fn, args, kw
        self._running = True
        CallAfter(self._run)

    def _run(self):
        if self._running:
            self._running = False
            self._fn(*self._args, **self._kw)

    def Stop(self):
        self._running = False

    def IsRunning(self):
        return self._running

    def Start(self, millis=-1, *a, **kw):
        self._running = True
        CallAfter(self._run)

    def Restart(self, millis=-1, *a, **kw):
        self.Start()


class Timer:
    def __init__(self, owner=None, id=-1):
        self._owner, self._running = owner, False

    def Start(self, millis=-1, oneShot=False):
        self._running = True
        return True

    def Stop(self):
        self._running = False

    IsRunning = lambda s: s._running


def run_after(limit=200):
    """Run the CallAfter queue (and what it queues in turn)."""
    n = 0
    while _Loop.after and n < limit:
        fn, args, kw = _Loop.after.pop(0)
        n += 1
        fn(*args, **kw)


def effect(kind, **data):
    """Something for the page to do: a message, the clipboard…"""
    _Loop.effects.append({'kind': kind, **data})


def take_effects():
    out, _Loop.effects = _Loop.effects, []
    return out


def set_answers(answers):
    _Loop.answers = list(answers or [])
    _Loop.used = 0


def _modal(spec):
    if _Loop.used < len(_Loop.answers):
        a = _Loop.answers[_Loop.used]
        _Loop.used += 1
        return a
    spec['index'] = _Loop.used
    raise NeedModal(spec)


def Yield(*a):
    return True


SafeYield = Yield


def BeginBusyCursor(*a):
    pass


def EndBusyCursor(*a):
    pass


class BusyCursor:
    def __init__(self, *a):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class WindowDisabler(BusyCursor):
    pass


class BusyInfo(BusyCursor):
    pass


def Bell():
    pass


def GetMousePosition():
    return Point(0, 0)


def GetDisplaySize():
    return Size(1920, 1080)


def GetKeyState(key):
    return False


class App:
    def __init__(self, *a, **kw):
        pass

    def MainLoop(self):
        pass


def GetApp():
    return App()


# ------------------------------------------------------------------- windows

_REG: dict = {}
_TOP: list = []           # frames shown (in order)


def find(widget_id):
    return _REG.get(int(widget_id))


def frames():
    return [f for f in _TOP if not f._dead and f._shown]


class Window:
    _kind = 'Window'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=0, name='', **kw):
        self._id = next(_Loop.serial) if (id is None or id == ID_ANY or id < 0) else id
        self._uid = next(_Loop.serial) + 1_000_000
        _REG[self._uid] = self
        self._parent = parent
        self._children = []
        if parent is not None and isinstance(parent, Window):
            parent._children.append(self)
        self._size = Size(*size) if size is not None else DefaultSize
        self._minsize = DefaultSize
        self._style = style or 0
        self._shown = True
        self._enabled = True
        self._dead = False
        self._tip = ''
        self._bg = None
        self._fg = None
        self._font = None
        self._sizer = None
        self._containing_sizer = None
        self._handlers = []
        self._name = name
        self._label = kw.get('label', '')
        self._client_data = None
        self.Dirty()

    # ----- identity and tree
    def GetId(self):
        return self._id

    def SetId(self, i):
        self._id = i

    def GetParent(self):
        return self._parent

    GetGrandParent = lambda s: s._parent._parent if s._parent else None

    def GetChildren(self):
        return list(self._children)

    def GetTopLevelParent(self):
        w = self
        while w._parent is not None and not isinstance(w, TopLevelWindow):
            w = w._parent
        return w

    def _top(self):
        w = self
        while w is not None and not isinstance(w, TopLevelWindow):
            w = w._parent
        return w

    def Dirty(self):
        top = self._top()
        if top is not None:
            top._dirty = True

    def __bool__(self):
        return not self._dead

    def _check(self):
        if self._dead:
            raise RuntimeError(f"wrapped C/C++ object of type {type(self).__name__} has been deleted")

    # ----- events
    def Bind(self, event, handler, source=None, id=ID_ANY, id2=ID_ANY):
        self._handlers.append((event, handler, source))

    def Unbind(self, event, source=None, id=ID_ANY, id2=ID_ANY, handler=None):
        self._handlers = [h for h in self._handlers
                          if not (h[0] is event and (handler is None or h[1] == handler)
                                  and (source is None or h[2] is source))]
        return True

    def _fire(self, binder, **kw):
        evt = Event(binder, self, **kw)
        return self._dispatch(evt)

    def _dispatch(self, evt):
        target = evt.GetEventObject() or self
        w = self
        while w is not None:
            ran = False
            for b, h, src in list(w._handlers):
                if not isinstance(b, PyEventBinder) or b.typeId != evt._type:
                    continue
                if src is not None and src is not target and not (isinstance(src, int) and src == target.GetId()):
                    continue
                evt._skipped = False
                h(evt)
                ran = True
                if not evt._skipped:
                    return True
            if ran and not evt._skipped:
                return True
            binder = evt._binder
            if not (isinstance(binder, PyEventBinder) and binder.command) or isinstance(w, TopLevelWindow):
                break
            w = w._parent
        return False

    def ProcessEvent(self, evt):
        return self._dispatch(evt)

    def GetEventHandler(self):
        return self

    def ProcessWindowEvent(self, evt):
        return self._dispatch(evt)

    def SafelyProcessEvent(self, evt):
        return self._dispatch(evt)

    def AddPendingEvent(self, evt):
        CallAfter(lambda: self._dispatch(evt))

    QueueEvent = AddPendingEvent

    # ----- look
    def Show(self, show=True):
        if self._shown != bool(show):
            self._shown = bool(show)
            self.Dirty()
        return True

    def Hide(self):
        return self.Show(False)

    def IsShown(self):
        return self._shown and not self._dead

    def IsShownOnScreen(self):
        w = self
        while w is not None:
            if not w._shown:
                return False
            w = w._parent
        return True

    def Enable(self, enable=True):
        if self._enabled != bool(enable):
            self._enabled = bool(enable)
            self.Dirty()
        return True

    def Disable(self):
        return self.Enable(False)

    def IsEnabled(self):
        return self._enabled

    IsThisEnabled = IsEnabled

    def SetToolTip(self, tip):
        self._tip = tip if isinstance(tip, str) else getattr(tip, 'tip', '')
        self.Dirty()

    SetToolTipString = SetToolTip

    def GetToolTipText(self):
        return self._tip

    def UnsetToolTip(self):
        self._tip = ''

    def SetBackgroundColour(self, c):
        self._bg = Colour(c) if c is not None else None
        self.Dirty()
        return True

    def SetOwnBackgroundColour(self, c):
        return self.SetBackgroundColour(c)

    def GetBackgroundColour(self):
        return self._bg or Colour(240, 240, 240)

    def SetForegroundColour(self, c):
        self._fg = Colour(c) if c is not None else None
        self.Dirty()
        return True

    SetOwnForegroundColour = SetForegroundColour

    def GetForegroundColour(self):
        return self._fg or Colour(0, 0, 0)

    def SetFont(self, f):
        self._font = Font(f) if f is not None else None
        self.Dirty()
        return True

    SetOwnFont = SetFont

    def GetFont(self):
        return Font(self._font) if self._font else Font(10)

    def SetCursor(self, c):
        return True

    def SetBackgroundStyle(self, s):
        return True

    def SetWindowStyle(self, s):
        self._style = s

    SetWindowStyleFlag = SetWindowStyle

    def GetWindowStyle(self):
        return self._style

    GetWindowStyleFlag = GetWindowStyle

    def HasFlag(self, flag):
        return bool(self._style & flag)

    def SetName(self, n):
        self._name = n

    def GetName(self):
        return self._name

    def SetLabel(self, label):
        label = '' if label is None else str(label)
        if label != self._label:
            self._label = label
            self.Dirty()

    def GetLabel(self):
        return self._label

    GetLabelText = GetLabel
    SetLabelText = SetLabel

    def SetClientData(self, d):
        self._client_data = d

    def GetClientData(self):
        return self._client_data

    # ----- size and layout
    def SetSize(self, *a):
        if len(a) == 1:
            a = a[0]
        if isinstance(a, (tuple, list)) and len(a) >= 2:
            self._size = Size(a[-2] if len(a) == 4 else a[0], a[-1] if len(a) == 4 else a[1])
            self.Dirty()

    def SetClientSize(self, *a):
        self.SetSize(*a)

    def GetSize(self):
        self._check()
        return self._size

    GetClientSize = GetSize
    GetBestSize = GetSize
    GetEffectiveMinSize = GetSize

    def GetClientRect(self):
        return Rect(0, 0, self._size[0], self._size[1])

    GetRect = GetClientRect

    def SetMinSize(self, s):
        self._minsize = Size(*s)
        self.Dirty()

    SetMinClientSize = SetMinSize

    def GetMinSize(self):
        return self._minsize

    def SetMaxSize(self, s):
        pass

    def SetInitialSize(self, s=DefaultSize):
        self.SetSize(s)

    def SetSizeHints(self, *a, **kw):
        pass

    def GetPosition(self):
        return Point(0, 0)

    GetScreenPosition = GetPosition

    def SetPosition(self, p):
        pass

    Move = SetPosition

    def ClientToScreen(self, p):
        return p

    ScreenToClient = ClientToScreen

    def GetTextExtent(self, text):
        return Size(int(len(str(text)) * 7), 15)

    def GetCharWidth(self):
        return 7

    def GetCharHeight(self):
        return 15

    def FromDIP(self, v):
        return v

    def ToDIP(self, v):
        return v

    def GetContentScaleFactor(self):
        return 1.0

    GetDPIScaleFactor = GetContentScaleFactor

    def SetSizer(self, sizer, deleteOld=True):
        self._sizer = sizer
        if sizer is not None:
            sizer._owner = self
        self.Dirty()

    def SetSizerAndFit(self, sizer, deleteOld=True):
        self.SetSizer(sizer)

    def SetAutoLayout(self, b):
        pass

    def GetSizer(self):
        return self._sizer

    def GetContainingSizer(self):
        return self._containing_sizer

    def Layout(self):
        self.Dirty()
        return True

    def Fit(self):
        pass

    FitInside = Fit
    SendSizeEvent = Fit
    PostSizeEvent = Fit
    InvalidateBestSize = Fit

    def Refresh(self, *a, **kw):
        self.Dirty()

    def Update(self):
        pass

    def Freeze(self):
        pass

    def Thaw(self):
        self.Dirty()

    def IsFrozen(self):
        return False

    def SetFocus(self):
        pass

    SetFocusIgnoringChildren = SetFocus

    def HasFocus(self):
        return False

    def SetScrollRate(self, x, y):
        self._scroll = True

    def SetupScrolling(self, *a, **kw):
        self._scroll = True

    def Scroll(self, *a):
        pass

    def SetVirtualSize(self, *a):
        pass

    def GetViewStart(self):
        return Point(0, 0)

    def CentreOnParent(self, direction=BOTH):
        pass

    CenterOnParent = Centre = Center = CentreOnScreen = CenterOnScreen = CentreOnParent

    def Raise(self):
        self._check()
        self.Dirty()

    def Lower(self):
        pass

    def SetDoubleBuffered(self, on):
        pass

    def SetDropTarget(self, target):
        pass

    def DragAcceptFiles(self, accept):
        pass

    def PopupMenu(self, menu, pos=None):
        effect('menu', items=[(i._label, i._id) for i in getattr(menu, '_items', [])])
        return True

    def CaptureMouse(self):
        pass

    def ReleaseMouse(self):
        pass

    def HasCapture(self):
        return False

    def SetHelpText(self, t):
        pass

    def Navigate(self, *a, **kw):
        return True

    def SetAcceleratorTable(self, t):
        pass

    def IsBeingDeleted(self):
        return self._dead

    def IsTopLevel(self):
        return isinstance(self, TopLevelWindow)

    def Close(self, force=False):
        evt = Event(EVT_CLOSE, self, force=force)
        if not self._dispatch(evt):
            self.Destroy()
        return not evt._vetoed

    def Destroy(self):
        if self._dead:
            return True
        for c in list(self._children):
            c.Destroy()
        self._dead = True
        self._shown = False
        _REG.pop(self._uid, None)
        if self._parent is not None and self in self._parent._children:
            self._parent._children.remove(self)
        top = self._top()
        if top is not None and top is not self:
            top._dirty = True
        return True

    def DestroyChildren(self):
        for c in list(self._children):
            c.Destroy()

    # ----- serialisation (ktech.bridge reads these)
    def _bound(self):
        names = {b.name for b, _h, src in self._handlers if isinstance(b, PyEventBinder) and (src is None or src is self)}
        w = self._parent
        while w is not None:
            names.update(b.name for b, _h, src in w._handlers if isinstance(b, PyEventBinder) and src is self)
            if isinstance(w, TopLevelWindow):
                break
            w = w._parent
        return sorted(names)

    def _common(self):
        d = {'t': self._kind, 'id': self._uid}
        ev = self._bound()
        if ev:
            d['ev'] = ev
        if not self._enabled:
            d['en'] = False
        if self._tip:
            d['tip'] = self._tip
        if self._bg is not None:
            d['bg'] = self._bg.css()
        if self._fg is not None:
            d['fg'] = self._fg.css()
        if self._font is not None:
            d['font'] = self._font.css()
        w, h = self._size
        if w > 0:
            d['w'] = w
        if h > 0:
            d['h'] = h
        if self._minsize[0] > 0:
            d['minw'] = self._minsize[0]
        if self._minsize[1] > 0:
            d['minh'] = self._minsize[1]
        return d

    def _serial(self):
        d = self._common()
        if self._sizer is not None:
            d['sizer'] = self._sizer._serial()
        if getattr(self, '_scroll', False):
            d['scroll'] = True
        return d


class Control(Window):
    _kind = 'Control'


class Panel(Window):
    _kind = 'Panel'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=TAB_TRAVERSAL,
                 name='panel', **kw):
        super().__init__(parent, id, pos, size, style, name)


class ScrolledWindow(Panel):
    _kind = 'Panel'

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._scroll = True


ScrolledPanel = ScrolledWindow
VScrolledWindow = ScrolledWindow


class StaticBox(Window):
    _kind = 'StaticBox'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, pos, size, style, name, label=label)


class StaticLine(Window):
    _kind = 'Line'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=LI_HORIZONTAL, name=''):
        super().__init__(parent, id, pos, size, style, name)

    def _serial(self):
        d = self._common()
        d['vertical'] = bool(self._style & LI_VERTICAL)
        return d


class StaticText(Window):
    _kind = 'Text'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, pos, size, style, name, label=label)
        self._wrap = -1

    def Wrap(self, width):
        self._wrap = width
        self.Dirty()

    def _serial(self):
        d = self._common()
        d['label'] = self._label
        if self._style & ALIGN_RIGHT:
            d['align'] = 'right'
        elif self._style & ALIGN_CENTER_HORIZONTAL:
            d['align'] = 'center'
        if self._wrap > 0:
            d['wrap'] = self._wrap
        return d


GenStaticText = StaticText


class HyperlinkCtrl(StaticText):
    _kind = 'Link'

    def __init__(self, parent=None, id=ID_ANY, label='', url='', pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, label, pos, size, style, name)
        self._url = url

    def _serial(self):
        d = super()._serial()
        d['url'] = self._url
        return d


class StaticBitmap(Window):
    _kind = 'Bitmap'

    def __init__(self, parent=None, id=ID_ANY, bitmap=None, pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, pos, size, style, name)
        self._bmp = bitmap

    def SetBitmap(self, b):
        self._bmp = b
        self.Dirty()

    def _serial(self):
        d = self._common()
        d['src'] = self._bmp.css() if isinstance(self._bmp, Bitmap) else ''
        return d


class Button(Window):
    _kind = 'Button'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name='button'):
        if not label and id in (ID_OK, ID_CANCEL, ID_YES, ID_NO, ID_APPLY, ID_CLOSE, ID_SAVE, ID_HELP):
            label = {ID_OK: 'OK', ID_CANCEL: 'Cancel', ID_YES: 'Yes', ID_NO: 'No', ID_APPLY: 'Apply',
                     ID_CLOSE: 'Close', ID_SAVE: 'Save', ID_HELP: 'Help'}[id]
        super().__init__(parent, id, pos, size, style, name, label=label)
        self._bmp = None

    def SetDefault(self):
        pass

    def SetBitmap(self, b, *a):
        self._bmp = b
        self.Dirty()

    SetBitmapLabel = SetBitmap

    def _serial(self):
        d = self._common()
        d['label'] = self._label
        if isinstance(self._bmp, Bitmap):
            d['icon'] = self._bmp.css()
        return d

    def _user(self, msg):
        self._fire(EVT_BUTTON)


class BitmapButton(Button):
    def __init__(self, parent=None, id=ID_ANY, bitmap=None, pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name='button'):
        super().__init__(parent, id, '', pos, size, style, validator, name)
        self._bmp = bitmap


class ToggleButton(Button):
    _kind = 'Toggle'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name=''):
        super().__init__(parent, id, label, pos, size, style, validator, name)
        self._value = False

    def GetValue(self):
        return self._value

    def SetValue(self, v):
        self._value = bool(v)
        self.Dirty()

    def _serial(self):
        d = super()._serial()
        d['value'] = self._value
        return d

    def _user(self, msg):
        self._value = bool(msg.get('value'))
        self._fire(EVT_TOGGLEBUTTON)


class TextCtrl(Window):
    _kind = 'TextCtrl'

    def __init__(self, parent=None, id=ID_ANY, value='', pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name='text'):
        super().__init__(parent, id, pos, size, style, name)
        self._value = '' if value is None else str(value)
        self._editable = not (style & TE_READONLY)
        self._hint = ''

    def GetValue(self):
        return self._value

    def SetValue(self, v):
        self.ChangeValue(v)
        self._fire(EVT_TEXT)

    def ChangeValue(self, v):
        v = '' if v is None else str(v)
        if v != self._value:
            self._value = v
            self.Dirty()

    def Clear(self):
        self.SetValue('')

    def AppendText(self, t):
        self.ChangeValue(self._value + str(t))

    WriteText = AppendText

    def GetLineText(self, n):
        lines = self._value.split('\n')
        return lines[n] if 0 <= n < len(lines) else ''

    def GetNumberOfLines(self):
        return self._value.count('\n') + 1

    def SetEditable(self, e):
        self._editable = bool(e)
        self.Dirty()

    def IsEditable(self):
        return self._editable

    def SetHint(self, h):
        self._hint = h
        self.Dirty()
        return True

    def GetLastPosition(self):
        return len(self._value)

    def ShowPosition(self, p):
        pass

    def SetInsertionPoint(self, p):
        pass

    SetInsertionPointEnd = lambda s: None
    SetSelection = lambda s, a=0, b=0: None
    SelectAll = lambda s: None
    SetMaxLength = lambda s, n: None
    GetInsertionPoint = lambda s: len(s._value)
    GetStringSelection = lambda s: ''
    SetDefaultStyle = lambda s, st: True
    SetStyle = lambda s, a, b, st: True
    IsModified = lambda s: False
    SetModified = lambda s, m: None
    DiscardEdits = lambda s: None

    def _serial(self):
        d = self._common()
        d['value'] = self._value
        if self._style & TE_MULTILINE:
            d['multi'] = True
        if not self._editable:
            d['ro'] = True
        if self._style & TE_DONTWRAP:
            d['nowrap'] = True
        if self._style & TE_PASSWORD:
            d['password'] = True
        if self._hint:
            d['hint'] = self._hint
        if self._style & TE_PROCESS_ENTER:
            d['enter'] = True
        return d

    def _sync(self, value):
        self._value = '' if value is None else str(value)

    def _user(self, msg):
        kind = msg.get('type')
        if 'value' in msg:
            self._sync(msg['value'])
        if kind == 'text':
            self._fire(EVT_TEXT)
        elif kind == 'enter':
            self._fire(EVT_TEXT_ENTER)
        elif kind == 'blur':
            self._fire(EVT_KILL_FOCUS)


class SearchCtrl(TextCtrl):
    def ShowCancelButton(self, show):
        pass

    def ShowSearchButton(self, show):
        pass

    def SetDescriptiveText(self, t):
        self.SetHint(t)


class SpinCtrl(Window):
    _kind = 'Spin'
    _float = False

    def __init__(self, parent=None, id=ID_ANY, value='', pos=DefaultPosition, size=DefaultSize, style=SP_ARROW_KEYS,
                 min=0, max=100, initial=0, name='spin', inc=1):
        super().__init__(parent, id, pos, size, style, name)
        self._min, self._max, self._inc, self._digits = min, max, inc, 0
        v = initial
        if value not in ('', None):
            try:
                v = float(value)
            except (TypeError, ValueError):
                pass
        self._value = self._clamp(v)

    def _clamp(self, v):
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = self._min
        v = max(self._min, min(self._max, v))
        return v if self._float else int(round(v))

    def GetValue(self):
        return self._value

    def SetValue(self, v):
        v = self._clamp(v)
        if v != self._value:
            self._value = v
            self.Dirty()

    def SetRange(self, lo, hi):
        self._min, self._max = lo, hi
        self._value = self._clamp(self._value)
        self.Dirty()

    def GetMin(self):
        return self._min

    def GetMax(self):
        return self._max

    def SetIncrement(self, inc):
        self._inc = inc
        self.Dirty()

    def GetIncrement(self):
        return self._inc

    def SetDigits(self, d):
        self._digits = d
        self.Dirty()

    def GetDigits(self):
        return self._digits

    def GetTextValue(self):
        return f"{self._value:.{self._digits}f}" if self._float else str(self._value)

    def _serial(self):
        d = self._common()
        d.update({'value': self._value, 'min': self._min, 'max': self._max, 'inc': self._inc})
        if self._float:
            d['float'] = True
            d['digits'] = self._digits
        return d

    def _sync(self, value):
        self._value = self._clamp(value)

    def _user(self, msg):
        if 'value' in msg:
            self._sync(msg['value'])
        if msg.get('type') == 'blur':
            self._fire(EVT_KILL_FOCUS)
            return
        self._fire(EVT_SPINCTRLDOUBLE if self._float else EVT_SPINCTRL)
        self._fire(EVT_TEXT)


class SpinCtrlDouble(SpinCtrl):
    _float = True

    def __init__(self, parent=None, id=ID_ANY, value='', pos=DefaultPosition, size=DefaultSize, style=SP_ARROW_KEYS,
                 min=0, max=100, initial=0, inc=1, name='spin'):
        super().__init__(parent, id, value, pos, size, style, min, max, initial, name, inc)
        text = repr(float(inc))
        self._digits = 0 if float(inc).is_integer() else len(text.split('.')[-1])


class SpinButton(SpinCtrl):
    pass


class _ItemContainer(Window):
    def __init__(self, parent, id, pos, size, choices, style, name):
        super().__init__(parent, id, pos, size, style, name)
        self._items = [str(c) for c in (choices or [])]
        self._sel = -1
        self._data = [None] * len(self._items)

    def Set(self, items):
        self._items = [str(c) for c in items]
        self._data = [None] * len(self._items)
        self._sel = -1
        self.Dirty()

    SetItems = Set

    def Append(self, item, clientData=None):
        if isinstance(item, (list, tuple)):
            for i in item:
                self.Append(i)
            return len(self._items) - 1
        self._items.append(str(item))
        self._data.append(clientData)
        self.Dirty()
        return len(self._items) - 1

    AppendItems = Append

    def Insert(self, item, pos, clientData=None):
        self._items.insert(pos, str(item))
        self._data.insert(pos, clientData)
        if self._sel >= pos:
            self._sel += 1
        self.Dirty()
        return pos

    def Delete(self, n):
        del self._items[n]
        del self._data[n]
        if self._sel == n:
            self._sel = -1
        elif self._sel > n:
            self._sel -= 1
        self.Dirty()

    def Clear(self):
        self.Set([])

    def GetCount(self):
        return len(self._items)

    def IsEmpty(self):
        return not self._items

    def GetString(self, n):
        return self._items[n] if 0 <= n < len(self._items) else ''

    def SetString(self, n, s):
        self._items[n] = str(s)
        self.Dirty()

    def GetStrings(self):
        return list(self._items)

    GetItems = GetStrings

    def FindString(self, s, caseSensitive=False):
        s = str(s)
        for i, it in enumerate(self._items):
            if it == s or (not caseSensitive and it.lower() == s.lower()):
                return i
        return NOT_FOUND

    def GetSelection(self):
        return self._sel

    GetCurrentSelection = GetSelection

    def SetSelection(self, n):
        n = int(n)
        if n != self._sel:
            self._sel = n if -1 <= n < len(self._items) else -1
            self.Dirty()

    def GetStringSelection(self):
        return self.GetString(self._sel)

    def SetStringSelection(self, s):
        i = self.FindString(s)
        if i == NOT_FOUND:
            return False
        self.SetSelection(i)
        return True

    def GetClientData(self, n=None):
        if n is None:
            return self._client_data
        return self._data[n] if 0 <= n < len(self._data) else None

    def SetClientData(self, n, data=None):
        if data is None and not isinstance(n, int):
            self._client_data = n
            return
        self._data[n] = data

    def Select(self, n):
        self.SetSelection(n)


class Choice(_ItemContainer):
    _kind = 'Choice'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, choices=(), style=0,
                 validator=None, name='choice'):
        super().__init__(parent, id, pos, size, choices, style, name)

    def _serial(self):
        d = self._common()
        d.update({'items': self._items, 'sel': self._sel})
        return d

    def _sync(self, value):
        self.SetSelection(int(value))

    def _user(self, msg):
        self.SetSelection(int(msg.get('sel', -1)))
        self._fire(EVT_CHOICE, selection=self._sel, string=self.GetStringSelection())


class ComboBox(_ItemContainer):
    _kind = 'Combo'

    def __init__(self, parent=None, id=ID_ANY, value='', pos=DefaultPosition, size=DefaultSize, choices=(),
                 style=0, validator=None, name='comboBox'):
        super().__init__(parent, id, pos, size, choices, style, name)
        self._value = str(value or '')
        if self._value in self._items:
            self._sel = self._items.index(self._value)

    def GetValue(self):
        return self._value

    def SetValue(self, v):
        v = '' if v is None else str(v)
        self._value = v
        self._sel = self._items.index(v) if v in self._items else -1
        self.Dirty()

    ChangeValue = SetValue

    def SetSelection(self, n, *a):
        super().SetSelection(n)
        self._value = self.GetString(self._sel) if self._sel >= 0 else self._value

    def Set(self, items):
        super().Set(items)
        if self._style & CB_READONLY:
            self._value = ''

    def Clear(self):
        super().Set([])
        self._value = ''

    def GetStringSelection(self):
        return self.GetString(self._sel) if self._sel >= 0 else self._value

    def SetEditable(self, e):
        pass

    def Popup(self):
        pass

    def SetHint(self, h):
        return True

    def _serial(self):
        d = self._common()
        d.update({'items': self._items, 'sel': self._sel, 'value': self._value})
        if not self._style & CB_READONLY:
            d['editable'] = True
        return d

    def _sync(self, value):
        self._value = '' if value is None else str(value)
        self._sel = self._items.index(self._value) if self._value in self._items else -1

    def _user(self, msg):
        if msg.get('type') == 'text':
            self._sync(msg.get('value'))
            self._fire(EVT_TEXT)
            return
        if msg.get('type') == 'enter':
            self._sync(msg.get('value'))
            self._fire(EVT_TEXT_ENTER)
            return
        self.SetSelection(int(msg.get('sel', -1)))
        self._fire(EVT_COMBOBOX, selection=self._sel, string=self._value)


BitmapComboBox = ComboBox
OwnerDrawnComboBox = ComboBox


class ListBox(_ItemContainer):
    _kind = 'List'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, choices=(), style=0,
                 validator=None, name='listBox'):
        super().__init__(parent, id, pos, size, choices, style, name)
        self._multi = set()

    def GetSelections(self):
        if self._style & (LB_MULTIPLE | LB_EXTENDED):
            return sorted(self._multi)
        return [self._sel] if self._sel >= 0 else []

    def IsSelected(self, n):
        return n in self.GetSelections()

    def Deselect(self, n):
        self._multi.discard(n)
        if self._sel == n:
            self._sel = -1
        self.Dirty()

    def SetSelection(self, n, select=True):
        if self._style & (LB_MULTIPLE | LB_EXTENDED):
            (self._multi.add if select else self._multi.discard)(n)
        super().SetSelection(n if select else -1)

    def _serial(self):
        d = self._common()
        d.update({'items': self._items, 'sel': self._sel, 'multi': sorted(self._multi)})
        return d

    def _sync(self, value):
        self.SetSelection(int(value))

    def _user(self, msg):
        if msg.get('type') == 'dclick':
            self._fire(EVT_LISTBOX_DCLICK, selection=self._sel)
            return
        self.SetSelection(int(msg.get('sel', -1)))
        self._fire(EVT_LISTBOX, selection=self._sel, string=self.GetStringSelection())


class CheckListBox(ListBox):
    _kind = 'CheckList'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, choices=(), style=0,
                 validator=None, name='listBox'):
        super().__init__(parent, id, pos, size, choices, style, validator, name)
        self._checked = set()

    def Set(self, items):
        super().Set(items)
        self._checked = set()

    def Check(self, n, check=True):
        (self._checked.add if check else self._checked.discard)(n)
        self.Dirty()

    def IsChecked(self, n):
        return n in self._checked

    def GetCheckedItems(self):
        return sorted(self._checked)

    def SetCheckedItems(self, items):
        self._checked = set(items)
        self.Dirty()

    def GetCheckedStrings(self):
        return [self._items[i] for i in self.GetCheckedItems()]

    def SetCheckedStrings(self, strings):
        self._checked = {i for i, s in enumerate(self._items) if s in strings}
        self.Dirty()

    def _serial(self):
        d = super()._serial()
        d['checked'] = sorted(self._checked)
        return d

    def _sync(self, value):
        if isinstance(value, dict):
            self._checked = {int(i) for i in value.get('checked', [])}
            if 'sel' in value:
                self._sel = int(value['sel'])
        else:
            self._checked = {int(i) for i in value}
        self.Dirty()

    def _user(self, msg):
        if msg.get('type') == 'check':
            n = int(msg.get('index', -1))
            self.Check(n, bool(msg.get('value')))
            self._fire(EVT_CHECKLISTBOX, selection=n, int=n)
            return
        super()._user(msg)


class CheckBox(Window):
    _kind = 'CheckBox'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name='check'):
        super().__init__(parent, id, pos, size, style, name, label=label)
        self._value = False

    def GetValue(self):
        return self._value

    IsChecked = GetValue

    def SetValue(self, v):
        if bool(v) != self._value:
            self._value = bool(v)
            self.Dirty()

    def Set3StateValue(self, v):
        self.SetValue(v == 1)

    def Get3StateValue(self):
        return 1 if self._value else 0

    def _serial(self):
        d = self._common()
        d.update({'label': self._label, 'value': self._value})
        return d

    def _sync(self, value):
        self.SetValue(bool(value))

    def _user(self, msg):
        self._value = bool(msg.get('value'))
        self.Dirty()
        self._fire(EVT_CHECKBOX, checked=self._value)


class RadioButton(Window):
    _kind = 'Radio'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0,
                 validator=None, name='radio'):
        super().__init__(parent, id, pos, size, style, name, label=label)
        siblings = [c for c in (parent._children if isinstance(parent, Window) else []) if isinstance(c, RadioButton)]
        prev = siblings[-2] if len(siblings) >= 2 else None
        self._group = self if (style & RB_GROUP or prev is None) else prev._group
        # wx: the first button of a new group starts selected
        self._value = self._group is self

    def _members(self):
        p = self._parent
        return [c for c in (p._children if p else []) if isinstance(c, RadioButton) and c._group is self._group]

    def GetValue(self):
        return self._value

    def SetValue(self, v):
        if v:
            for m in self._members():
                if m._value and m is not self:
                    m._value = False
            self._value = True
        else:
            self._value = False
        self.Dirty()

    def _serial(self):
        d = self._common()
        d.update({'label': self._label, 'value': self._value, 'group': self._group._uid})
        return d

    def _sync(self, value):
        self.SetValue(bool(value))

    def _user(self, msg):
        self.SetValue(True)
        self._fire(EVT_RADIOBUTTON)


class RadioBox(Window):
    _kind = 'RadioBox'

    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, choices=(),
                 majorDimension=0, style=RA_SPECIFY_COLS, validator=None, name='radioBox'):
        super().__init__(parent, id, pos, size, style, name, label=label)
        self._items = [str(c) for c in choices]
        self._sel = 0 if self._items else -1
        self._major = majorDimension

    GetSelection = lambda s: s._sel
    GetCount = lambda s: len(s._items)
    GetString = lambda s, n: s._items[n]
    GetStringSelection = lambda s: s._items[s._sel] if s._sel >= 0 else ''

    def SetSelection(self, n):
        self._sel = n
        self.Dirty()

    def SetStringSelection(self, s):
        if s in self._items:
            self.SetSelection(self._items.index(s))

    def EnableItem(self, n, e=True):
        pass

    def ShowItem(self, n, s=True):
        pass

    def _serial(self):
        d = self._common()
        d.update({'label': self._label, 'items': self._items, 'sel': self._sel,
                  'cols': (self._major or len(self._items)) if self._style & RA_SPECIFY_COLS else 1})
        return d

    def _sync(self, value):
        self.SetSelection(int(value))

    def _user(self, msg):
        self.SetSelection(int(msg.get('sel', 0)))
        self._fire(EVT_RADIOBOX, selection=self._sel)


class Slider(Window):
    _kind = 'Slider'

    def __init__(self, parent=None, id=ID_ANY, value=0, minValue=0, maxValue=100, pos=DefaultPosition,
                 size=DefaultSize, style=SL_HORIZONTAL, validator=None, name='slider'):
        super().__init__(parent, id, pos, size, style, name)
        self._value, self._min, self._max = value, minValue, maxValue

    GetValue = lambda s: s._value
    GetMin = lambda s: s._min
    GetMax = lambda s: s._max

    def SetValue(self, v):
        self._value = int(v)
        self.Dirty()

    def SetRange(self, lo, hi):
        self._min, self._max = lo, hi
        self.Dirty()

    def _serial(self):
        d = self._common()
        d.update({'value': self._value, 'min': self._min, 'max': self._max})
        return d

    def _user(self, msg):
        self.SetValue(msg.get('value', self._value))
        self._fire(EVT_SLIDER)


class Gauge(Window):
    _kind = 'Gauge'

    def __init__(self, parent=None, id=ID_ANY, range=100, pos=DefaultPosition, size=DefaultSize, style=GA_HORIZONTAL,
                 validator=None, name='gauge'):
        super().__init__(parent, id, pos, size, style, name)
        self._range, self._value = range, 0

    def SetValue(self, v):
        self._value = v
        self.Dirty()

    GetValue = lambda s: s._value

    def SetRange(self, r):
        self._range = r

    def Pulse(self):
        pass

    def _serial(self):
        d = self._common()
        d.update({'value': self._value, 'range': self._range})
        return d


class Notebook(Window):
    _kind = 'Notebook'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=0, name='notebook', **kw):
        super().__init__(parent, id, pos, size, style, name)
        self._pages = []   # [window, title]
        self._sel = -1

    def AddPage(self, page, text, select=False, imageId=-1):
        self._pages.append([page, str(text)])
        if select or self._sel < 0:
            self._sel = len(self._pages) - 1
        self.Dirty()
        return True

    def InsertPage(self, index, page, text, select=False, imageId=-1):
        self._pages.insert(index, [page, str(text)])
        if select or self._sel < 0:
            self._sel = index
        elif self._sel >= index:
            self._sel += 1
        self.Dirty()
        return True

    def RemovePage(self, index):
        if 0 <= index < len(self._pages):
            del self._pages[index]
            if self._sel >= len(self._pages):
                self._sel = len(self._pages) - 1
            elif self._sel > index:
                self._sel -= 1
            self.Dirty()
            return True
        return False

    def DeletePage(self, index):
        page = self._pages[index][0] if 0 <= index < len(self._pages) else None
        ok = self.RemovePage(index)
        if page is not None:
            page.Destroy()
        return ok

    def DeleteAllPages(self):
        for p, _t in self._pages:
            p.Destroy()
        self._pages = []
        self._sel = -1
        self.Dirty()

    def GetPageCount(self):
        return len(self._pages)

    def GetPage(self, i):
        return self._pages[i][0] if 0 <= i < len(self._pages) else None

    def GetCurrentPage(self):
        return self.GetPage(self._sel)

    def GetPageText(self, i):
        return self._pages[i][1] if 0 <= i < len(self._pages) else ''

    def SetPageText(self, i, t):
        self._pages[i][1] = str(t)
        self.Dirty()

    def FindPage(self, page):
        for i, (p, _t) in enumerate(self._pages):
            if p is page:
                return i
        return NOT_FOUND

    def GetSelection(self):
        return self._sel

    def ChangeSelection(self, i):
        old = self._sel
        self._sel = i
        self.Dirty()
        return old

    def SetSelection(self, i):
        old = self.ChangeSelection(i)
        if old != i:
            self._fire(EVT_NOTEBOOK_PAGE_CHANGED, selection=i, old=old)
        return old

    def AdvanceSelection(self, forward=True):
        if self._pages:
            self.SetSelection((self._sel + (1 if forward else -1)) % len(self._pages))

    def SetPadding(self, p):
        pass

    def SetImageList(self, il):
        pass

    def AssignImageList(self, il):
        pass

    def SetPageImage(self, i, img):
        pass

    def _serial(self):
        d = self._common()
        d['pages'] = [{'title': t, 'n': p._serial() if p is not None and not p._dead else None} for p, t in self._pages]
        d['sel'] = self._sel
        return d

    def _user(self, msg):
        i = int(msg.get('sel', 0))
        if i == self._sel:
            return
        old = self._sel
        changing = Event(EVT_NOTEBOOK_PAGE_CHANGING, self, selection=i, old=old)
        self._dispatch(changing)
        if changing._vetoed:
            return
        self._sel = i
        self.Dirty()
        self._fire(EVT_NOTEBOOK_PAGE_CHANGED, selection=i, old=old)


Choicebook = Listbook = Treebook = Toolbook = Simplebook = Notebook


class SplitterWindow(Window):
    _kind = 'Splitter'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=SP_3D, name='splitter'):
        super().__init__(parent, id, pos, size, style, name)
        self._w1 = self._w2 = None
        self._vertical = True
        self._pos = 0

    def SplitVertically(self, w1, w2, pos=0):
        self._w1, self._w2, self._vertical, self._pos = w1, w2, True, pos
        self.Dirty()
        return True

    def SplitHorizontally(self, w1, w2, pos=0):
        self._w1, self._w2, self._vertical, self._pos = w1, w2, False, pos
        self.Dirty()
        return True

    def Initialize(self, w):
        self._w1, self._w2 = w, None

    def SetSashGravity(self, g):
        pass

    def SetMinimumPaneSize(self, n):
        pass

    def SetSashPosition(self, p, redraw=True):
        self._pos = p

    GetSashPosition = lambda s: s._pos
    IsSplit = lambda s: s._w2 is not None

    def Unsplit(self, toRemove=None):
        self._w2 = None
        self.Dirty()

    def _serial(self):
        d = self._common()
        d.update({'vertical': self._vertical, 'pos': self._pos,
                  'a': self._w1._serial() if self._w1 else None, 'b': self._w2._serial() if self._w2 else None})
        return d


class CollapsiblePane(Panel):
    def __init__(self, parent=None, id=ID_ANY, label='', pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, pos, size, style, name)
        self._label = label
        self._pane = Panel(self)

    def GetPane(self):
        return self._pane

    def Collapse(self, c=True):
        pass

    def Expand(self):
        pass

    IsCollapsed = lambda s: False


class ListCtrl(Window):
    _kind = 'ListCtrl'

    def __init__(self, parent=None, id=ID_ANY, pos=DefaultPosition, size=DefaultSize, style=LC_ICON,
                 validator=None, name='listCtrl'):
        super().__init__(parent, id, pos, size, style, name)
        self._cols = []
        self._rows = []
        self._sel = -1
        self._data = []

    def InsertColumn(self, col, heading, format=LIST_FORMAT_LEFT, width=-1):
        self._cols.insert(col, [str(heading), width])
        for r in self._rows:
            r.insert(col, '')
        self.Dirty()
        return col

    AppendColumn = lambda s, heading, format=0, width=-1: s.InsertColumn(len(s._cols), heading, format, width)

    def SetColumnWidth(self, col, w):
        if 0 <= col < len(self._cols):
            self._cols[col][1] = w

    def GetColumnCount(self):
        return len(self._cols)

    def DeleteAllColumns(self):
        self._cols = []

    def InsertItem(self, index, label, imageIndex=-1):
        if not isinstance(index, int):
            index = len(self._rows)
        self._rows.insert(index, [str(label)] + [''] * max(0, len(self._cols) - 1))
        self._data.insert(index, None)
        self.Dirty()
        return index

    InsertStringItem = InsertItem

    def Append(self, entry):
        i = self.InsertItem(len(self._rows), entry[0] if entry else '')
        for c, v in enumerate(entry[1:], start=1):
            self.SetItem(i, c, v)
        return i

    def SetItem(self, index, col, label='', imageId=-1):
        while len(self._rows[index]) <= col:
            self._rows[index].append('')
        self._rows[index][col] = str(label)
        self.Dirty()
        return True

    SetStringItem = SetItem

    def GetItemText(self, index, col=0):
        try:
            return self._rows[index][col]
        except IndexError:
            return ''

    def GetItemCount(self):
        return len(self._rows)

    def DeleteItem(self, index):
        del self._rows[index]
        del self._data[index]
        self.Dirty()
        return True

    def DeleteAllItems(self):
        self._rows, self._data, self._sel = [], [], -1
        self.Dirty()
        return True

    ClearAll = DeleteAllItems

    def SetItemData(self, index, data):
        self._data[index] = data

    def GetItemData(self, index):
        return self._data[index]

    def GetFirstSelected(self, *a):
        return self._sel

    GetFocusedItem = GetFirstSelected

    def GetNextSelected(self, item):
        return -1

    def GetNextItem(self, item, geometry=LIST_NEXT_ALL, state=0):
        return self._sel if state == LIST_STATE_SELECTED and item < self._sel else -1

    def GetSelectedItemCount(self):
        return 1 if self._sel >= 0 else 0

    def Select(self, index, on=True):
        self._sel = index if on else -1
        self.Dirty()

    def Focus(self, index):
        pass

    def EnsureVisible(self, index):
        pass

    def SetItemBackgroundColour(self, i, c):
        pass

    SetItemTextColour = SetItemBackgroundColour

    def _serial(self):
        d = self._common()
        d.update({'cols': [c[0] for c in self._cols], 'widths': [c[1] for c in self._cols], 'rows': self._rows,
                  'sel': self._sel})
        return d

    def _user(self, msg):
        i = int(msg.get('index', -1))
        self._sel = i
        self.Dirty()
        if msg.get('type') == 'activate':
            self._fire(EVT_LIST_ITEM_ACTIVATED, index=i)
        else:
            self._fire(EVT_LIST_ITEM_SELECTED, index=i)


# ------------------------------------------------------------------- frames

class TopLevelWindow(Window):
    _kind = 'Frame'

    def __init__(self, parent=None, id=ID_ANY, title='', pos=DefaultPosition, size=DefaultSize, style=0, name=''):
        super().__init__(parent, id, pos, size, style, name)
        self._title = title
        self._shown = False
        self._dirty = True
        self._icon = None

    def SetTitle(self, t):
        self._title = str(t)
        self._dirty = True

    def GetTitle(self):
        return self._title

    def Show(self, show=True):
        self._check()
        self._shown = bool(show)
        self._dirty = True
        if show and self not in _TOP:
            _TOP.append(self)
        return True

    def Raise(self):
        self._check()
        if self in _TOP:
            _TOP.remove(self)
        _TOP.append(self)
        self._dirty = True
        effect('raise', frame=self._uid)

    def Iconize(self, iconize=True):
        pass

    def IsIconized(self):
        return False

    def Maximize(self, m=True):
        pass

    def IsMaximized(self):
        return False

    def SetIcon(self, icon):
        self._icon = icon

    def SetStatusText(self, text, field=0):
        pass

    def CreateStatusBar(self, *a, **kw):
        return StatusBar(self)

    def SetMenuBar(self, mb):
        pass

    def SetTransparent(self, a):
        pass

    def RequestUserAttention(self, flags=0):
        pass

    def Destroy(self):
        if self in _TOP:
            _TOP.remove(self)
        effect('closed', frame=self._uid)
        return super().Destroy()

    def _serial(self):
        d = super()._serial()
        d.update({'title': self._title, 'shown': self._shown})
        return d


class Frame(TopLevelWindow):
    pass


MiniFrame = Frame


class StatusBar(Window):
    def SetStatusText(self, text, i=0):
        pass

    def SetFieldsCount(self, n, widths=None):
        pass

    SetStatusWidths = SetFieldsCount


class Dialog(TopLevelWindow):
    _kind = 'Dialog'

    def __init__(self, parent=None, id=ID_ANY, title='', pos=DefaultPosition, size=DefaultSize,
                 style=DEFAULT_DIALOG_STYLE, name='dialog'):
        super().__init__(parent, id, title, pos, size, style, name)
        self._return = ID_CANCEL
        self._affirm = ID_OK
        self._escape = ID_CANCEL
        self._modal = False

    def _descendants(self):
        out, stack = [], list(self._children)
        while stack:
            w = stack.pop(0)
            out.append(w)
            stack[0:0] = list(w._children)
        return out

    def ShowModal(self):
        """Ask the page, keyed on the order the widgets were created in."""
        widgets = self._descendants()
        spec = {'kind': 'dialog', 'frame': self._serial(), 'ids': [w._uid for w in widgets]}
        answer = _modal(spec)
        values = answer.get('values') or {}
        for pos, value in values.items():
            pos = int(pos)
            if 0 <= pos < len(widgets) and hasattr(widgets[pos], '_sync'):
                widgets[pos]._sync(value)
            elif 0 <= pos < len(widgets) and isinstance(widgets[pos], (CheckBox, RadioButton, ToggleButton)):
                widgets[pos].SetValue(value)
            elif 0 <= pos < len(widgets) and isinstance(widgets[pos], (Choice, ListBox, RadioBox)):
                widgets[pos].SetSelection(int(value))
        self._return = int(answer.get('id', ID_CANCEL))
        return self._return

    def EndModal(self, code):
        self._return = code
        effect('endmodal', frame=self._uid, code=code)

    def IsModal(self):
        return False

    def GetReturnCode(self):
        return self._return

    def SetReturnCode(self, c):
        self._return = c

    def SetAffirmativeId(self, i):
        self._affirm = i

    def SetEscapeId(self, i):
        self._escape = i

    def CreateButtonSizer(self, flags):
        return self.CreateStdDialogButtonSizer(flags)

    def CreateStdDialogButtonSizer(self, flags):
        s = StdDialogButtonSizer()
        if flags & OK:
            s.AddButton(Button(self, ID_OK))
        if flags & YES:
            s.AddButton(Button(self, ID_YES))
        if flags & NO:
            s.AddButton(Button(self, ID_NO))
        if flags & CANCEL:
            s.AddButton(Button(self, ID_CANCEL))
        s.Realize()
        return s

    def CreateSeparatedButtonSizer(self, flags):
        return self.CreateStdDialogButtonSizer(flags)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.Destroy()
        return False


class MessageDialog(Dialog):
    def __init__(self, parent=None, message='', caption='Message box', style=OK | CENTRE, pos=DefaultPosition):
        super().__init__(parent, ID_ANY, caption)
        self._message, self._caption, self._mstyle = str(message), str(caption), style
        self._labels = {}

    def SetYesNoLabels(self, yes, no):
        self._labels.update(yes=str(yes), no=str(no))
        return True

    def SetOKCancelLabels(self, ok, cancel):
        self._labels.update(ok=str(ok), cancel=str(cancel))
        return True

    def SetYesNoCancelLabels(self, yes, no, cancel):
        self._labels.update(yes=str(yes), no=str(no), cancel=str(cancel))
        return True

    def SetExtendedMessage(self, m):
        self._message += '\n\n' + str(m)

    def ShowModal(self):
        buttons = []
        st = self._mstyle
        if st & YES:
            buttons += [('yes', ID_YES), ('no', ID_NO)]
        if st & OK or not buttons:
            buttons.append(('ok', ID_OK))
        if st & CANCEL:
            buttons.append(('cancel', ID_CANCEL))
        a = _modal({'kind': 'message', 'title': self._caption, 'message': self._message,
                    'buttons': [[self._labels.get(k, k.capitalize() if k != 'ok' else 'OK'), i] for k, i in buttons],
                    'icon': 'error' if st & ICON_ERROR else 'warning' if st & ICON_WARNING
                    else 'question' if st & ICON_QUESTION else 'info'})
        self._return = int(a.get('id', ID_CANCEL))
        return self._return


GenericMessageDialog = MessageDialog
RichMessageDialog = MessageDialog


def MessageBox(message, caption='Message', style=OK | CENTRE, parent=None, x=-1, y=-1):
    if not style & (YES | CANCEL):
        effect('message', title=str(caption), message=str(message),
               icon='error' if style & ICON_ERROR else 'warning' if style & ICON_WARNING else 'info')
        return OK
    code = MessageDialog(parent, message, caption, style).ShowModal()
    return {ID_YES: YES, ID_NO: NO, ID_OK: OK, ID_CANCEL: CANCEL}.get(code, CANCEL)


class TextEntryDialog(Dialog):
    def __init__(self, parent=None, message='', caption='Please enter text', value='', style=OK | CANCEL | CENTRE,
                 pos=DefaultPosition):
        super().__init__(parent, ID_ANY, caption)
        self._message, self._value, self._mstyle = str(message), str(value), style

    def ShowModal(self):
        a = _modal({'kind': 'text', 'title': self._title, 'message': self._message, 'value': self._value,
                    'multiline': bool(self._mstyle & TE_MULTILINE)})
        if a.get('id') == ID_OK:
            self._value = str(a.get('value', ''))
        self._return = int(a.get('id', ID_CANCEL))
        return self._return

    GetValue = lambda s: s._value

    def SetValue(self, v):
        self._value = str(v)


PasswordEntryDialog = TextEntryDialog


class NumberEntryDialog(Dialog):
    def __init__(self, parent=None, message='', prompt='', caption='', value=0, min=0, max=100, pos=DefaultPosition):
        super().__init__(parent, ID_ANY, caption)
        self._message, self._value, self._minv, self._maxv = f"{message}\n{prompt}".strip(), value, min, max

    def ShowModal(self):
        a = _modal({'kind': 'text', 'title': self._title, 'message': self._message, 'value': str(self._value)})
        if a.get('id') == ID_OK:
            try:
                self._value = max(self._minv, min(self._maxv, int(float(a.get('value', self._value)))))
            except ValueError:
                pass
        self._return = int(a.get('id', ID_CANCEL))
        return self._return

    GetValue = lambda s: s._value


class SingleChoiceDialog(Dialog):
    def __init__(self, parent=None, message='', caption='', choices=(), style=CHOICEDLG_STYLE, pos=DefaultPosition):
        super().__init__(parent, ID_ANY, caption)
        self._message, self._choices, self._sel = str(message), [str(c) for c in choices], 0

    def SetSelection(self, n):
        self._sel = n

    def ShowModal(self):
        a = _modal({'kind': 'choice', 'title': self._title, 'message': self._message, 'choices': self._choices,
                    'sel': self._sel})
        if a.get('id') == ID_OK:
            self._sel = int(a.get('sel', self._sel))
        self._return = int(a.get('id', ID_CANCEL))
        return self._return

    GetSelection = lambda s: s._sel
    GetStringSelection = lambda s: s._choices[s._sel] if 0 <= s._sel < len(s._choices) else ''


class MultiChoiceDialog(SingleChoiceDialog):
    def __init__(self, parent=None, message='', caption='', choices=(), style=CHOICEDLG_STYLE, pos=DefaultPosition):
        super().__init__(parent, message, caption, choices, style, pos)
        self._sels = []

    def SetSelections(self, s):
        self._sels = list(s)

    def ShowModal(self):
        a = _modal({'kind': 'multichoice', 'title': self._title, 'message': self._message, 'choices': self._choices,
                    'sels': self._sels})
        if a.get('id') == ID_OK:
            self._sels = [int(i) for i in a.get('sels', [])]
        self._return = int(a.get('id', ID_CANCEL))
        return self._return

    GetSelections = lambda s: list(s._sels)


class FileDialog(Dialog):
    def __init__(self, parent=None, message='Choose a file', defaultDir='', defaultFile='', wildcard='*.*',
                 style=FD_OPEN, pos=DefaultPosition, size=DefaultSize, name='filedlg'):
        super().__init__(parent, ID_ANY, message)
        self._message, self._dir, self._file, self._wildcard, self._fstyle = message, defaultDir, defaultFile, wildcard, style
        self._paths = []

    def ShowModal(self):
        a = _modal({'kind': 'file', 'title': self._message, 'save': bool(self._fstyle & FD_SAVE),
                    'multiple': bool(self._fstyle & FD_MULTIPLE), 'dir': self._dir, 'file': self._file,
                    'wildcard': self._wildcard})
        if a.get('id') == ID_OK:
            self._paths = [str(p) for p in a.get('paths', [])]
        self._return = int(a.get('id', ID_CANCEL))
        return self._return

    GetPath = lambda s: s._paths[0] if s._paths else ''
    GetPaths = lambda s: list(s._paths)

    def GetFilename(self):
        import os
        return os.path.basename(self.GetPath())

    def GetFilenames(self):
        import os
        return [os.path.basename(p) for p in self._paths]

    def GetDirectory(self):
        import os
        return os.path.dirname(self.GetPath())

    def SetDirectory(self, d):
        self._dir = d

    def SetFilename(self, f):
        self._file = f

    def SetWildcard(self, w):
        self._wildcard = w

    def GetFilterIndex(self):
        return 0

    def SetFilterIndex(self, i):
        pass


class DirDialog(FileDialog):
    def __init__(self, parent=None, message='Choose a directory', defaultPath='', style=DD_DEFAULT_STYLE,
                 pos=DefaultPosition, size=DefaultSize, name='dirdlg'):
        super().__init__(parent, message, defaultPath, '', '', 0)

    def ShowModal(self):
        a = _modal({'kind': 'dir', 'title': self._message, 'dir': self._dir})
        if a.get('id') == ID_OK:
            self._paths = [str(a.get('path', ''))]
        self._return = int(a.get('id', ID_CANCEL))
        return self._return


def FileSelector(message='', default_path='', default_filename='', default_extension='', wildcard='*.*', flags=0,
                 parent=None, x=-1, y=-1):
    d = FileDialog(parent, message, default_path, default_filename, wildcard, flags)
    return d.GetPath() if d.ShowModal() == ID_OK else ''


def GetTextFromUser(message, caption='Input text', default_value='', parent=None, *a, **kw):
    d = TextEntryDialog(parent, message, caption, default_value)
    return d.GetValue() if d.ShowModal() == ID_OK else ''


class ProgressDialog(Dialog):
    def __init__(self, title='', message='', maximum=100, parent=None, style=0):
        super().__init__(parent, ID_ANY, title)

    def Update(self, value, newmsg=''):
        return (True, False)

    Pulse = Update

    def WasCancelled(self):
        return False


# --------------------------------------------------------------- clipboard

class TextDataObject:
    def __init__(self, text=''):
        self._text = str(text)

    def GetText(self):
        return self._text

    def SetText(self, t):
        self._text = str(t)


class FileDataObject(TextDataObject):
    pass


class _Clipboard:
    _text = ''

    def Open(self):
        return True

    def Close(self):
        pass

    def IsOpened(self):
        return True

    def SetData(self, data):
        _Clipboard._text = data.GetText() if hasattr(data, 'GetText') else str(data)
        effect('clipboard', text=_Clipboard._text)
        return True

    AddData = SetData

    def GetData(self, data):
        if hasattr(data, 'SetText'):
            data.SetText(_Clipboard._text)
        return True

    def IsSupported(self, fmt):
        return True

    def Flush(self):
        return True

    def Clear(self):
        _Clipboard._text = ''


TheClipboard = _Clipboard()
DF_TEXT, DF_UNICODETEXT, DF_FILENAME = 1, 13, 15


class DataFormat:
    def __init__(self, f):
        self.f = f


# -------------------------------------------------------------------- sizers

class SizerItem:
    def __init__(self, item, proportion=0, flag=0, border=0, userData=None):
        self.item, self.proportion, self.flag, self.border = item, proportion, flag, border
        self.pos = self.span = None
        self.shown = True

    def GetWindow(self):
        return self.item if isinstance(self.item, Window) else None

    def GetSizer(self):
        return self.item if isinstance(self.item, Sizer) else None

    def IsWindow(self):
        return isinstance(self.item, Window)

    def IsSizer(self):
        return isinstance(self.item, Sizer)

    def IsSpacer(self):
        return not (self.IsWindow() or self.IsSizer())

    def Show(self, s=True):
        self.shown = bool(s)

    def IsShown(self):
        if isinstance(self.item, Window):
            return self.item.IsShown()
        return self.shown

    def SetProportion(self, p):
        self.proportion = p

    def SetFlag(self, f):
        self.flag = f

    def SetBorder(self, b):
        self.border = b

    def GetProportion(self):
        return self.proportion

    def GetFlag(self):
        return self.flag

    def GetBorder(self):
        return self.border

    def DeleteWindows(self):
        if isinstance(self.item, Window):
            self.item.Destroy()
        elif isinstance(self.item, Sizer):
            self.item.Clear(True)


class SizerFlags:
    def __init__(self, proportion=0):
        self.proportion, self.flag, self.border = proportion, 0, 0

    def Expand(self):
        self.flag |= EXPAND
        return self

    def Proportion(self, p):
        self.proportion = p
        return self

    def Border(self, direction=ALL, borderInPixels=5):
        self.flag |= direction
        self.border = borderInPixels
        return self

    def Align(self, a):
        self.flag |= a
        return self

    def Centre(self):
        self.flag |= ALIGN_CENTER
        return self

    Center = Centre

    def CentreVertical(self):
        self.flag |= ALIGN_CENTER_VERTICAL
        return self

    CenterVertical = CentreVertical

    def Left(self):
        return self

    def Right(self):
        self.flag |= ALIGN_RIGHT
        return self

    def Top(self):
        return self

    def Bottom(self):
        self.flag |= ALIGN_BOTTOM
        return self

    def DoubleBorder(self, direction=ALL):
        return self.Border(direction, 10)

    def TripleBorder(self, direction=ALL):
        return self.Border(direction, 15)

    def HorzBorder(self):
        return self.Border(LEFT | RIGHT, 5)

    def Shaped(self):
        return self

    def FixedMinSize(self):
        return self

    def ReserveSpaceEvenIfHidden(self):
        return self


class Sizer:
    _orient = VERTICAL

    def __init__(self):
        self._items = []
        self._owner = None
        self._box = None
        self._min = (-1, -1)

    def _touch(self):
        if self._owner is not None:
            self._owner.Dirty()

    def _item(self, item, proportion=0, flag=0, border=0, userData=None, **kw):
        if isinstance(proportion, SizerFlags):
            proportion, flag, border = proportion.proportion, proportion.flag, proportion.border
        proportion = kw.get('proportion', proportion)
        flag = kw.get('flag', flag)
        border = kw.get('border', border)
        if isinstance(item, (tuple, Size)) and len(item) == 2 and all(isinstance(v, int) for v in item):
            item = Size(*item)
        it = SizerItem(item, proportion, flag, border)
        if isinstance(item, Window):
            item._containing_sizer = self
        return it

    def Add(self, item, proportion=0, flag=0, border=0, userData=None, **kw):
        if isinstance(item, int) and isinstance(proportion, int) and not isinstance(item, bool) and 'height' not in kw \
                and not isinstance(item, Window):
            # Add(width, height, proportion, flag, border)
            item, proportion, flag, border = Size(item, proportion), flag, border, kw.get('border', 0)
            if userData is not None and isinstance(userData, int):
                border = userData
        it = self._item(item, proportion, flag, border, userData, **kw)
        self._items.append(it)
        self._touch()
        return it

    def Insert(self, index, item, proportion=0, flag=0, border=0, userData=None, **kw):
        it = self._item(item, proportion, flag, border, userData, **kw)
        self._items.insert(index, it)
        self._touch()
        return it

    def Prepend(self, item, proportion=0, flag=0, border=0, userData=None, **kw):
        return self.Insert(0, item, proportion, flag, border, userData, **kw)

    def AddSpacer(self, size):
        return self.Add(Size(size, size))

    def AddStretchSpacer(self, prop=1):
        return self.Add(Size(0, 0), prop)

    PrependSpacer = AddSpacer
    PrependStretchSpacer = AddStretchSpacer

    def InsertSpacer(self, index, size):
        return self.Insert(index, Size(size, size))

    def InsertStretchSpacer(self, index, prop=1):
        return self.Insert(index, Size(0, 0), prop)

    def AddMany(self, items):
        for it in items:
            if isinstance(it, (tuple, list)):
                self.Add(*it)
            else:
                self.Add(it)

    def GetChildren(self):
        return list(self._items)

    def GetItemCount(self):
        return len(self._items)

    def GetItem(self, index_or_window, recursive=False):
        if isinstance(index_or_window, int):
            return self._items[index_or_window] if 0 <= index_or_window < len(self._items) else None
        for it in self._items:
            if it.item is index_or_window:
                return it
        return None

    def Clear(self, delete_windows=False):
        if delete_windows:
            for it in self._items:
                it.DeleteWindows()
        self._items = []
        self._touch()

    def Remove(self, index_or_item):
        if isinstance(index_or_item, int):
            if 0 <= index_or_item < len(self._items):
                del self._items[index_or_item]
        else:
            self._items = [it for it in self._items if it.item is not index_or_item]
        self._touch()
        return True

    Detach = Remove

    def Replace(self, old, new, recursive=False):
        for it in self._items:
            if it.item is old:
                it.item = new
                self._touch()
                return True
        return False

    def Show(self, item, show=True, recursive=False):
        if isinstance(item, int):
            item = self._items[item].item
        if isinstance(item, Window):
            item.Show(show)
        for it in self._items:
            if it.item is item:
                it.shown = bool(show)
                if isinstance(item, Sizer):
                    item.ShowItems(show)
        self._touch()
        return True

    def Hide(self, item, recursive=False):
        return self.Show(item, False, recursive)

    def ShowItems(self, show):
        for it in self._items:
            it.shown = bool(show)
            if isinstance(it.item, Window):
                it.item.Show(show)
            elif isinstance(it.item, Sizer):
                it.item.ShowItems(show)
        self._touch()

    def IsShown(self, item):
        it = self.GetItem(item)
        return it.IsShown() if it else False

    def Layout(self):
        self._touch()

    def Fit(self, window):
        return Size(-1, -1)

    def FitInside(self, window):
        pass

    def SetSizeHints(self, window):
        pass

    def SetMinSize(self, *s):
        self._min = s[0] if len(s) == 1 else s

    def GetMinSize(self):
        return Size(*self._min)

    def GetSize(self):
        return Size(-1, -1)

    def GetOrientation(self):
        return self._orient

    def GetStaticBox(self):
        return self._box

    def SetDimension(self, *a):
        pass

    def RecalcSizes(self):
        pass

    def _items_serial(self):
        out = []
        for it in self._items:
            if not it.shown:
                continue
            node = None
            if isinstance(it.item, Window):
                if it.item._dead or not it.item._shown:
                    continue
                node = it.item._serial()
            elif isinstance(it.item, Sizer):
                node = it.item._serial()
            entry = {'n': node}
            if node is None:
                entry['sw'], entry['sh'] = it.item[0], it.item[1]
            if it.proportion:
                entry['p'] = it.proportion
            if it.flag:
                entry['f'] = it.flag
            if it.border:
                entry['b'] = it.border
            if it.pos is not None:
                entry['pos'] = list(it.pos)
                entry['span'] = list(it.span or (1, 1))
            out.append(entry)
        return out

    def _serial(self):
        d = {'t': 'Sizer', 'o': 'h' if self._orient == HORIZONTAL else 'v', 'items': self._items_serial()}
        if self._box is not None:
            d['box'] = self._box._label
            if not self._box._enabled:
                d['en'] = False
        return d


class BoxSizer(Sizer):
    def __init__(self, orient=HORIZONTAL):
        super().__init__()
        self._orient = orient

    def SetOrientation(self, o):
        self._orient = o


class StaticBoxSizer(BoxSizer):
    def __init__(self, box_or_orient=VERTICAL, parent_or_orient=None, label=''):
        if isinstance(box_or_orient, StaticBox):
            box = box_or_orient
            orient = parent_or_orient if parent_or_orient is not None else HORIZONTAL
        else:
            orient = box_or_orient
            box = StaticBox(parent_or_orient, label=label)
        super().__init__(orient)
        self._box = box


class WrapSizer(BoxSizer):
    def __init__(self, orient=HORIZONTAL, flags=0):
        super().__init__(orient)

    def _serial(self):
        d = super()._serial()
        d['wrap'] = True
        return d


class StdDialogButtonSizer(BoxSizer):
    def __init__(self):
        super().__init__(HORIZONTAL)
        self._buttons = []

    def AddButton(self, b):
        self._buttons.append(b)

    def SetAffirmativeButton(self, b):
        self.AddButton(b)

    SetNegativeButton = SetCancelButton = SetAffirmativeButton

    def Realize(self):
        self._items = []
        self.AddStretchSpacer()
        order = {ID_HELP: 0, ID_NO: 1, ID_CANCEL: 2, ID_YES: 3, ID_OK: 4, ID_APPLY: 5}
        for b in sorted(self._buttons, key=lambda b: order.get(b.GetId(), 3)):
            self.Add(b, 0, LEFT, 6)


class GridSizer(Sizer):
    def __init__(self, *args, **kw):
        super().__init__()
        ints = [a for a in args if isinstance(a, int)]
        gaps = [a for a in args if isinstance(a, (Size, tuple)) and not isinstance(a, int)]
        rows = kw.get('rows', 0)
        cols = kw.get('cols', 0)
        vgap = kw.get('vgap', 0)
        hgap = kw.get('hgap', 0)
        if len(ints) >= 4:
            rows, cols, vgap, hgap = ints[:4]
        elif len(ints) == 3:
            if gaps:
                rows, cols = ints[0], ints[1]
            else:
                cols, vgap, hgap = ints
        elif len(ints) == 2:
            if gaps:
                cols = ints[0]
            else:
                rows, cols = ints
        elif len(ints) == 1:
            cols = ints[0]
        if gaps:
            vgap, hgap = gaps[0][1], gaps[0][0]
        self._rows, self._cols, self._vgap, self._hgap = rows, cols, vgap, hgap
        self._grow_cols, self._grow_rows = {}, {}

    def SetCols(self, c):
        self._cols = c

    def SetRows(self, r):
        self._rows = r

    def SetVGap(self, g):
        self._vgap = g

    def SetHGap(self, g):
        self._hgap = g

    GetCols = lambda s: s._cols
    GetRows = lambda s: s._rows

    def _serial(self):
        cols = self._cols or max(1, -(-len(self._items) // max(1, self._rows or 1)))
        return {'t': 'Sizer', 'o': 'g', 'items': self._items_serial(), 'cols': cols, 'vgap': self._vgap,
                'hgap': self._hgap, 'growCols': self._grow_cols, 'growRows': self._grow_rows,
                'uniform': type(self) is GridSizer}


class FlexGridSizer(GridSizer):
    def AddGrowableCol(self, idx, proportion=1):
        self._grow_cols[idx] = proportion or 1
        self._touch()

    def AddGrowableRow(self, idx, proportion=1):
        self._grow_rows[idx] = proportion or 1
        self._touch()

    def RemoveGrowableCol(self, idx):
        self._grow_cols.pop(idx, None)

    def RemoveGrowableRow(self, idx):
        self._grow_rows.pop(idx, None)

    def IsColGrowable(self, idx):
        return idx in self._grow_cols

    def IsRowGrowable(self, idx):
        return idx in self._grow_rows

    def SetFlexibleDirection(self, d):
        pass

    def SetNonFlexibleGrowMode(self, m):
        pass


class GBPosition(tuple):
    def __new__(cls, r=0, c=0):
        return super().__new__(cls, (r, c))


class GBSpan(GBPosition):
    def __new__(cls, r=1, c=1):
        return super().__new__(cls, (r, c))


class GridBagSizer(FlexGridSizer):
    def __init__(self, vgap=0, hgap=0):
        super().__init__(0, 0, vgap, hgap)

    def Add(self, item, pos=(0, 0), span=(1, 1), flag=0, border=0, userData=None, **kw):
        if isinstance(item, int) and isinstance(pos, int):
            item, pos, span = Size(item, pos), span, kw.get('span', (1, 1))
        it = self._item(item, 0, flag, border)
        it.pos, it.span = tuple(pos), tuple(span)
        self._items.append(it)
        self._cols = max(self._cols, it.pos[1] + it.span[1])
        self._rows = max(self._rows, it.pos[0] + it.span[0])
        self._touch()
        return it


# ------------------------------------------------------------ menus, tools

class MenuItem:
    def __init__(self, parentMenu=None, id=ID_ANY, text='', helpString='', kind=ITEM_NORMAL, subMenu=None):
        self._id = next(_Loop.serial) if id in (None, ID_ANY) else id
        self._label, self._help, self._kind, self._sub = text, helpString, kind, subMenu
        self._enabled, self._checked = True, False

    GetId = lambda s: s._id
    GetItemLabel = GetLabel = GetText = lambda s: s._label
    GetItemLabelText = GetItemLabel
    IsChecked = lambda s: s._checked
    IsEnabled = lambda s: s._enabled
    IsSeparator = lambda s: s._kind == ITEM_SEPARATOR
    GetSubMenu = lambda s: s._sub

    def SetItemLabel(self, t):
        self._label = t

    SetText = SetItemLabel

    def Check(self, c=True):
        self._checked = c

    def Enable(self, e=True):
        self._enabled = e

    def SetBitmap(self, b):
        pass


class Menu:
    def __init__(self, title='', style=0):
        self._items = []

    def Append(self, id=ID_ANY, item='', helpString='', kind=ITEM_NORMAL, *a):
        if isinstance(id, MenuItem):
            self._items.append(id)
            return id
        it = MenuItem(self, id, item, helpString if isinstance(helpString, str) else '', kind,
                      helpString if isinstance(helpString, Menu) else None)
        self._items.append(it)
        return it

    AppendItem = Append

    def AppendSubMenu(self, submenu, text, help=''):
        it = MenuItem(self, ID_ANY, text, help, ITEM_NORMAL, submenu)
        self._items.append(it)
        return it

    def AppendSeparator(self):
        return self.Append(MenuItem(self, ID_ANY, '', '', ITEM_SEPARATOR))

    def AppendCheckItem(self, id, item, help=''):
        return self.Append(id, item, help, ITEM_CHECK)

    def AppendRadioItem(self, id, item, help=''):
        return self.Append(id, item, help, ITEM_RADIO)

    def GetMenuItems(self):
        return list(self._items)

    def GetMenuItemCount(self):
        return len(self._items)

    def FindItemById(self, i):
        return next((it for it in self._items if it._id == i), None)

    def Enable(self, i, e=True):
        it = self.FindItemById(i)
        if it:
            it.Enable(e)

    def Check(self, i, c=True):
        it = self.FindItemById(i)
        if it:
            it.Check(c)

    def Destroy(self):
        pass

    def DestroyItem(self, it):
        self._items = [i for i in self._items if i is not it]

    Delete = Remove = DestroyItem

    def Bind(self, *a, **kw):
        pass


class MenuBar(Menu):
    pass


class ToolTip:
    def __init__(self, tip=''):
        self.tip = tip

    def SetDelay(self, ms):
        pass

    @staticmethod
    def Enable(flag):
        pass

    @staticmethod
    def SetAutoPop(ms):
        pass

    @staticmethod
    def SetMaxWidth(w):
        pass


class AcceleratorEntry:
    def __init__(self, *a, **kw):
        pass


class AcceleratorTable:
    def __init__(self, *a, **kw):
        pass


class ImageList:
    def __init__(self, *a, **kw):
        pass

    def Add(self, *a):
        return 0


class Validator:
    def __init__(self, *a, **kw):
        pass


DefaultValidator = Validator()


class ToolBar(Window):
    def AddTool(self, *a, **kw):
        return MenuItem()

    def Realize(self):
        pass


# ------------------------------------------------------------- serialising

def serialise_frame(frame):
    d = frame._serial()
    d['size'] = list(frame._size)
    d['min'] = list(frame._minsize)
    d['modalKind'] = frame._kind
    frame._dirty = False
    return d


def apply_event(msg):
    """Apply one user action from the page: ``{id, type, …}``; sync typed values first."""
    for wid, value in (msg.get('sync') or {}).items():
        w = find(wid)
        if w is not None and hasattr(w, '_sync'):
            w._sync(value)
    kind = msg.get('type')
    if kind == 'close':
        f = find(msg['id'])
        if f is not None:
            f.Close()
        return
    w = find(msg['id'])
    if w is None:
        raise ValueError('That window was closed.')
    if not w.IsEnabled():
        return
    w._user(msg)


def _user_default(self, msg):
    kind = msg.get('type')
    if kind == 'dclick':
        self._fire(EVT_LEFT_DCLICK)
    elif kind == 'blur':
        self._fire(EVT_KILL_FOCUS)


Window._user = _user_default


class StandardPaths:
    """The per-user folders, under the worker's HOME (the KherveOS home, mirrored)."""

    @staticmethod
    def Get():
        return StandardPaths()

    def _home(self):
        import os
        return os.path.expanduser('~')

    def GetUserConfigDir(self):
        import os
        return os.path.join(self._home(), '.config')

    def GetUserDataDir(self):
        import os
        return os.path.join(self._home(), '.config', 'KherveFitting')

    GetUserLocalDataDir = GetUserDataDir

    def GetDocumentsDir(self):
        import os
        return os.path.join(self._home(), 'Documents')

    def GetTempDir(self):
        return '/tmp'

    def GetExecutablePath(self):
        return '/kherveos/khervetech/KherveFitting'
