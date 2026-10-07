"""A headless stand-in for the desktop's wx.grid.Grid peak table.

The desktop keeps the peak parameters in a 19-column grid of strings, two
rows per peak (values, then constraints), and its fitting code reads and
writes that grid. This class has the same methods, so that code runs here
unchanged.
"""

PEAK_COLUMNS = [
    "ID", "Peak\nLabel", "Position\n(eV)", "Height\n(CPS)", "FWHM\n(eV)", "σ/γ (%)\nL/G \n",
    "Area\n(CPS.eV)", "σ\nW_g", "γ\nW_l", "W_g\nSkew",
    "Conc.\n(%)", "A/Aᴀ", "Split\n(eV)", "Fitting Model", "Bkg Type", "Bkg Low\n(eV)",
    "Bkg High\n(eV)", "Bkg Offset Low\n(CPS)", "Bkg Offset High\n(CPS)",
]


class Grid:
    """Rows of strings, like wx.grid.Grid with the calls KherveFitting uses."""

    def __init__(self, cols=len(PEAK_COLUMNS), labels=None):
        self.cols = cols
        self.labels = list(labels or PEAK_COLUMNS)
        self.rows = []

    # Size
    def GetNumberRows(self):
        return len(self.rows)

    def GetNumberCols(self):
        return self.cols

    def AppendRows(self, n=1):
        for _ in range(n):
            self.rows.append([""] * self.cols)

    def DeleteRows(self, pos=0, num=1):
        del self.rows[pos:pos + num]

    def ClearGrid(self):
        for r in self.rows:
            for c in range(self.cols):
                r[c] = ""

    # Cells
    def GetCellValue(self, row, col):
        if 0 <= row < len(self.rows) and 0 <= col < self.cols:
            return self.rows[row][col]
        return ""

    def SetCellValue(self, row, col, value):
        if 0 <= row < len(self.rows) and 0 <= col < self.cols:
            self.rows[row][col] = str(value)

    def GetColLabelValue(self, col):
        return self.labels[col] if 0 <= col < len(self.labels) else ""

    # Display-only calls the desktop makes: nothing to do here.
    def ForceRefresh(self):
        pass

    def SetReadOnly(self, *a, **k):
        pass

    def SetCellTextColour(self, *a, **k):
        pass

    def SetCellBackgroundColour(self, *a, **k):
        pass

    def snapshot(self):
        return [list(r) for r in self.rows]


class SheetBox:
    """The sheet (core level) combo box: just the current name."""

    def __init__(self, value=""):
        self.value = value

    def GetValue(self):
        return self.value

    def SetValue(self, value):
        self.value = value


#: The fitting window's model list (Fitting_Screen, KherveFitting-AI dev-AI
#: v1.93), in the desktop's order, without its "-----" group headers.
#: The group a model sits under: Best, Asymmetric, Voigt, LA, Others.
FITTING_MODEL_GROUPS = [
    ("Best Models", ["SGL (Area)", "GL (Area)", "LA (Area, σ/γ, γ)", "Voigt (Area, L/G, σ)"]),
    ("Asymmetric", ["LA (Area, σ, γ)", "DL (A, σ, γ, aDL)", "TLA (A, μ, α, Wg)", "DS*G (A, σ, γ, S)",
                    "DS (A, σ, γ)", "ExpGauss.(Area, σ, γ)"]),
    ("Voigt", ["Voigt (Area)", "Voigt (Area, L/G, S)", "Voigt (Area, L/G, σ)", "Voigt (Area, σ, γ)",
               "Voigt (Area, L/G, σ, S)"]),
    ("LA", ["LA (Area, σ/γ, γ)", "LA (Area, σ, γ)", "LA*G (Area, σ/γ, γ)", "LF (Area, σ, γ, w)"]),
    ("Others", ["Pseudo-Voigt (Area)", "GL (Height)", "SGL (Height)", "A*GL (Area, a, b)",
                "A*SGL (Area, a, b)", "SB (Height)"]),
]
# (The desktop combo box writes TLA as "TLA (A, μ, Wg, α)", a name its fit
# does not know; the peaks and fit_peaks use "TLA (A, μ, α, Wg)", listed here.)
FITTING_MODELS = list(dict.fromkeys(m for _g, ms in FITTING_MODEL_GROUPS for m in ms))
