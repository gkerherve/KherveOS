"""wx.grid for the headless wx (see wx/__init__.py): a table of text cells
with column labels, a cursor, row selection and in-place editing."""

from __future__ import annotations

import wx
from wx import PyEventBinder as _B

EVT_GRID_SELECT_CELL = _B('EVT_GRID_SELECT_CELL')
EVT_GRID_CELL_CHANGED = _B('EVT_GRID_CELL_CHANGED')
EVT_GRID_CELL_CHANGING = _B('EVT_GRID_CELL_CHANGING')
EVT_GRID_CELL_LEFT_CLICK = _B('EVT_GRID_CELL_LEFT_CLICK')
EVT_GRID_CELL_LEFT_DCLICK = _B('EVT_GRID_CELL_LEFT_DCLICK')
EVT_GRID_CELL_RIGHT_CLICK = _B('EVT_GRID_CELL_RIGHT_CLICK')
EVT_GRID_LABEL_LEFT_CLICK = _B('EVT_GRID_LABEL_LEFT_CLICK')
EVT_GRID_LABEL_RIGHT_CLICK = _B('EVT_GRID_LABEL_RIGHT_CLICK')
EVT_GRID_RANGE_SELECT = _B('EVT_GRID_RANGE_SELECT')
EVT_GRID_RANGE_SELECTED = EVT_GRID_RANGE_SELECT
EVT_GRID_EDITOR_SHOWN = _B('EVT_GRID_EDITOR_SHOWN')
EVT_GRID_EDITOR_HIDDEN = _B('EVT_GRID_EDITOR_HIDDEN')
EVT_GRID_COL_SIZE = _B('EVT_GRID_COL_SIZE')

GridSelectCells, GridSelectRows, GridSelectColumns, GridSelectRowsOrColumns = 0, 1, 2, 3
GridEvent = wx.Event
GridRangeSelectEvent = wx.Event


class GridCellAttr:
    def __init__(self, *a, **kw):
        self.read_only = False
        self.bg = None

    def SetReadOnly(self, ro=True):
        self.read_only = ro

    def SetBackgroundColour(self, c):
        self.bg = wx.Colour(c)

    def SetTextColour(self, c):
        pass

    def SetFont(self, f):
        pass

    def SetEditor(self, e):
        pass

    def SetRenderer(self, r):
        pass

    def SetAlignment(self, h, v):
        pass

    def IncRef(self):
        pass

    def DecRef(self):
        pass


class GridCellChoiceEditor:
    def __init__(self, choices=(), allowOthers=False):
        self.choices = list(choices)


class GridCellBoolEditor(GridCellChoiceEditor):
    def __init__(self, *a):
        super().__init__(['', '1'])


class GridCellBoolRenderer:
    def __init__(self, *a):
        pass


GridCellTextEditor = GridCellNumberEditor = GridCellFloatEditor = GridCellAutoWrapStringRenderer = \
    GridCellFloatRenderer = GridCellNumberRenderer = GridCellStringRenderer = GridCellBoolRenderer


class Grid(wx.Window):
    _kind = 'Grid'

    def __init__(self, parent=None, id=wx.ID_ANY, pos=wx.DefaultPosition, size=wx.DefaultSize, style=wx.WANTS_CHARS,
                 name='grid'):
        super().__init__(parent, id, pos, size, style, name)
        self._cells = []           # rows of str
        self._col_labels = []
        self._row_labels = {}
        self._col_sizes = []
        self._row_label_size = 30
        self._col_label_size = 24
        self._editable = True
        self._read_only = set()
        self._cell_bg = {}
        self._cell_fg = {}
        self._cell_editor = {}
        self._cursor = (-1, -1)
        self._sel_rows = []
        self._sel_mode = GridSelectCells

    # ----- shape
    def CreateGrid(self, rows, cols, selmode=GridSelectCells):
        self._cells = [[''] * cols for _ in range(rows)]
        self._col_labels = [self._default_col_label(i) for i in range(cols)]
        self._col_sizes = [80] * cols
        self._sel_mode = selmode
        self.Dirty()
        return True

    @staticmethod
    def _default_col_label(i):
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s

    def GetNumberRows(self):
        return len(self._cells)

    def GetNumberCols(self):
        return len(self._col_labels)

    def AppendRows(self, n=1, updateLabels=True):
        cols = self.GetNumberCols()
        self._cells += [[''] * cols for _ in range(n)]
        self.Dirty()
        return True

    def InsertRows(self, pos=0, n=1, updateLabels=True):
        cols = self.GetNumberCols()
        self._cells[pos:pos] = [[''] * cols for _ in range(n)]
        self.Dirty()
        return True

    def DeleteRows(self, pos=0, n=1, updateLabels=True):
        del self._cells[pos:pos + n]
        self._sel_rows = [r for r in self._sel_rows if r < len(self._cells)]
        if self._cursor[0] >= len(self._cells):
            self._cursor = (-1, -1)
        self.Dirty()
        return True

    def AppendCols(self, n=1, updateLabels=True):
        start = self.GetNumberCols()
        for i in range(n):
            self._col_labels.append(self._default_col_label(start + i))
            self._col_sizes.append(80)
        for r in self._cells:
            r += [''] * n
        self.Dirty()
        return True

    def InsertCols(self, pos=0, n=1, updateLabels=True):
        for i in range(n):
            self._col_labels.insert(pos, '')
            self._col_sizes.insert(pos, 80)
        for r in self._cells:
            r[pos:pos] = [''] * n
        self.Dirty()
        return True

    def DeleteCols(self, pos=0, n=1, updateLabels=True):
        del self._col_labels[pos:pos + n]
        del self._col_sizes[pos:pos + n]
        for r in self._cells:
            del r[pos:pos + n]
        self.Dirty()
        return True

    def ClearGrid(self):
        for r in self._cells:
            for c in range(len(r)):
                r[c] = ''
        self.Dirty()

    # ----- cells
    def SetCellValue(self, row, col, value):
        if 0 <= row < len(self._cells) and 0 <= col < self.GetNumberCols():
            self._cells[row][col] = '' if value is None else str(value)
            self.Dirty()

    def GetCellValue(self, row, col):
        try:
            return self._cells[row][col]
        except IndexError:
            return ''

    def SetColLabelValue(self, col, label):
        if 0 <= col < len(self._col_labels):
            self._col_labels[col] = str(label)
            self.Dirty()

    def GetColLabelValue(self, col):
        return self._col_labels[col] if 0 <= col < len(self._col_labels) else ''

    def SetRowLabelValue(self, row, label):
        self._row_labels[row] = str(label)
        self.Dirty()

    def GetRowLabelValue(self, row):
        return self._row_labels.get(row, str(row + 1))

    def SetColSize(self, col, w):
        if 0 <= col < len(self._col_sizes):
            self._col_sizes[col] = int(w)
            self.Dirty()

    def GetColSize(self, col):
        return self._col_sizes[col] if 0 <= col < len(self._col_sizes) else 0

    def SetRowSize(self, row, h):
        pass

    def SetDefaultRowSize(self, h, resizeExisting=False):
        pass

    def SetDefaultColSize(self, w, resizeExisting=False):
        self._col_sizes = [w] * len(self._col_sizes) if resizeExisting else self._col_sizes

    def SetRowLabelSize(self, w):
        self._row_label_size = w
        self.Dirty()

    def SetColLabelSize(self, h):
        self._col_label_size = h
        self.Dirty()

    GetRowLabelSize = lambda s: s._row_label_size
    GetColLabelSize = lambda s: s._col_label_size

    def AutoSizeColumns(self, setAsMin=True):
        pass

    AutoSizeColumn = AutoSizeRows = AutoSize = AutoSizeColLabelSize = lambda s, *a, **kw: None

    def EnableEditing(self, edit):
        self._editable = bool(edit)
        self.Dirty()

    def IsEditable(self):
        return self._editable

    def SetReadOnly(self, row, col, isReadOnly=True):
        (self._read_only.add if isReadOnly else self._read_only.discard)((row, col))
        self.Dirty()

    def IsReadOnly(self, row, col):
        return (row, col) in self._read_only

    def SetCellBackgroundColour(self, row, col, c):
        self._cell_bg[(row, col)] = wx.Colour(c).css()
        self.Dirty()

    def SetCellTextColour(self, row, col, c):
        self._cell_fg[(row, col)] = wx.Colour(c).css()
        self.Dirty()

    def SetCellFont(self, row, col, f):
        pass

    def SetCellAlignment(self, row, col, h, v):
        pass

    def SetCellEditor(self, row, col, editor):
        self._cell_editor[(row, col)] = getattr(editor, 'choices', None)

    def SetCellRenderer(self, row, col, r):
        pass

    def SetColAttr(self, col, attr):
        if getattr(attr, 'read_only', False):
            for r in range(self.GetNumberRows()):
                self._read_only.add((r, col))

    SetRowAttr = SetAttr = lambda s, *a: None

    def SetDefaultCellFont(self, f):
        self._font = wx.Font(f)
        self.Dirty()

    SetLabelFont = SetDefaultCellAlignment = SetDefaultCellBackgroundColour = SetDefaultCellTextColour = \
        SetLabelBackgroundColour = SetLabelTextColour = SetGridLineColour = SetDefaultRenderer = \
        SetDefaultEditor = SetColLabelAlignment = SetRowLabelAlignment = SetSelectionBackground = \
        SetSelectionForeground = SetMargins = EnableGridLines = EnableDragRowSize = EnableDragColSize = \
        EnableDragGridSize = DisableDragRowSize = DisableDragColSize = SetCellHighlightPenWidth = \
        SetCellHighlightColour = HideRowLabels = ShowScrollbars = SetTable = lambda s, *a, **kw: None

    def HideCol(self, col):
        pass

    def ShowCol(self, col):
        pass

    def BeginBatch(self):
        pass

    def EndBatch(self):
        self.Dirty()

    def ForceRefresh(self):
        self.Dirty()

    def SetSelectionMode(self, m):
        self._sel_mode = m

    # ----- cursor and selection
    def GetGridCursorRow(self):
        return self._cursor[0]

    def GetGridCursorCol(self):
        return self._cursor[1]

    def GetGridCursorCoords(self):
        return self._cursor

    def SetGridCursor(self, row, col):
        self._cursor = (row, col)
        self.Dirty()

    GoToCell = SetGridCursor

    def MakeCellVisible(self, row, col):
        pass

    def GetSelectedRows(self):
        return list(self._sel_rows)

    def GetSelectedCells(self):
        return []

    def GetSelectionBlockTopLeft(self):
        return [(r, 0) for r in self._sel_rows]

    def GetSelectionBlockBottomRight(self):
        return [(r, self.GetNumberCols() - 1) for r in self._sel_rows]

    def GetSelectedCols(self):
        return []

    def SelectRow(self, row, addToSelected=False):
        self._sel_rows = (self._sel_rows + [row]) if addToSelected else [row]
        self.Dirty()

    def SelectBlock(self, top, left, bottom, right, addToSelected=False):
        self._sel_rows = list(range(top, bottom + 1))
        self.Dirty()

    def ClearSelection(self):
        self._sel_rows = []
        self.Dirty()

    def IsSelection(self):
        return bool(self._sel_rows)

    def IsInSelection(self, row, col):
        return row in self._sel_rows

    def IsCellEditControlEnabled(self):
        return False

    def DisableCellEditControl(self):
        pass

    def EnableCellEditControl(self, e=True):
        pass

    def SaveEditControlValue(self):
        pass

    def GetGridWindow(self):
        return self

    GetGridColLabelWindow = GetGridRowLabelWindow = GetGridCornerLabelWindow = GetGridWindow

    def XYToCell(self, *a):
        return (-1, -1)

    def _serial(self):
        d = self._common()
        d.update({'cols': self._col_labels, 'widths': self._col_sizes, 'rows': self._cells,
                  'rowLabelW': self._row_label_size, 'colLabelH': self._col_label_size, 'editable': self._editable,
                  'cursor': list(self._cursor), 'selRows': self._sel_rows})
        if self._row_labels:
            d['rowLabels'] = {str(k): v for k, v in self._row_labels.items()}
        if self._read_only:
            d['ro'] = [list(rc) for rc in sorted(self._read_only)]
        if self._cell_bg:
            d['bgs'] = [[r, c, v] for (r, c), v in self._cell_bg.items()]
        if self._cell_fg:
            d['fgs'] = [[r, c, v] for (r, c), v in self._cell_fg.items()]
        if self._cell_editor:
            d['editors'] = [[r, c, v] for (r, c), v in self._cell_editor.items() if v]
        if self._font is not None:
            d['font'] = self._font.css()
        return d

    def _sync(self, value):
        row, col = (list(value) + [-1, -1])[:2]
        self._cursor = (int(row), int(col))
        self._sel_rows = []

    def _user(self, msg):
        kind = msg.get('type')
        row, col = int(msg.get('row', -1)), int(msg.get('col', -1))
        if kind == 'select':
            self._cursor = (row, col)
            self._sel_rows = []
            self.Dirty()
            self._fire(EVT_GRID_SELECT_CELL, row=row, col=col)
            self._fire(EVT_GRID_CELL_LEFT_CLICK, row=row, col=col)
        elif kind == 'label':
            if row >= 0:
                self._sel_rows = [row]
                self._cursor = (row, 0)
                self.Dirty()
            self._fire(EVT_GRID_LABEL_LEFT_CLICK, row=row, col=col)
        elif kind == 'dclick':
            self._fire(EVT_GRID_CELL_LEFT_DCLICK, row=row, col=col)
        elif kind == 'right':
            self._fire(EVT_GRID_CELL_RIGHT_CLICK, row=row, col=col)
        elif kind == 'edit':
            if not self._editable or (row, col) in self._read_only:
                return
            old = self.GetCellValue(row, col)
            changing = wx.Event(EVT_GRID_CELL_CHANGING, self, row=row, col=col, string=str(msg.get('value', '')))
            self._dispatch(changing)
            if changing._vetoed:
                return
            self.SetCellValue(row, col, msg.get('value', ''))
            self._fire(EVT_GRID_CELL_CHANGED, row=row, col=col, string=old)


class GridTableBase:
    def __init__(self, *a, **kw):
        pass


class GridSizeEvent(wx.Event):
    pass
