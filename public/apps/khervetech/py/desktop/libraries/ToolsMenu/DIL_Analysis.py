# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/DIL_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/DIL_Analysis.py
"""
Dilatometry analysis: segment isolation, thermal-expansion coefficients and
sintering metrics.

A dilatometer run heats, dwells and cools in one file, so it passes the same
temperature several times and the whole-run dL/L0 vs T curve is a loop. The
Data tab therefore splits the run into its programme segments - from the
instrument's Segment column when the file has one, otherwise by detecting
the temperature reversals - and writes any of them out as its own
``DIL~Heat`` / ``DIL~Cool`` / ``DIL~Iso`` sheet, on which the expansion
analysis is meaningful.

The CTE tab gives both numbers a dilatometry report quotes:

- the *mean (technical) CTE* between two temperatures,
  alpha = (dL/L0(T2) - dL/L0(T1)) / (T2 - T1); and
- the *differential (physical) CTE* alpha(T) = d(dL/L0)/dT as a curve,
  published as a ``DIL~Alpha`` sheet.

The derivative uses the Savitzky-Golay analytic derivative with the chain
rule d(eps)/dT = (d(eps)/di) / (dT/di) - the same treatment as the TGA DTG
trace, where smooth-then-``np.gradient`` was shown to amplify noise into
spurious extrema larger than the real signal.

The Sintering tab reports the classic densification metrics: maximum
expansion, shrinkage onset (a set dL/L0 drop below the maximum), the
temperature of the maximum shrinkage rate and the total shrinkage.

Results are stored per sheet in a JSON string under ``DIL_Results`` so the
two-decimal rounding of the .xlsx/.json project format can never touch them.
"""

import json

import numpy as np
import wx
import wx.grid


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def detect_segments(temperature, segment=None):
    """Split a run into programme segments.

    Returns [{'label', 'kind', 'start', 'end', 't_start', 't_end', 'n'}]
    with ``end`` inclusive. Uses the instrument's segment numbers when given
    (NaNs tolerated); otherwise splits at temperature reversals larger than
    2 % of the run's span (at least 5 °C).
    """
    t = np.asarray(temperature, dtype=float)
    if t.size < 3:
        return []

    bounds = []
    if segment is not None:
        seg = np.asarray(segment, dtype=float)
        if seg.size == t.size and np.isfinite(seg).any():
            filled = seg.copy()
            # Carry the last seen number over NaN gaps.
            last = filled[np.isfinite(filled)][0]
            for i in range(filled.size):
                if np.isfinite(filled[i]):
                    last = filled[i]
                else:
                    filled[i] = last
            start = 0
            for i in range(1, filled.size):
                if filled[i] != filled[start]:
                    bounds.append((start, i - 1))
                    start = i
            bounds.append((start, filled.size - 1))

    if not bounds:
        bounds = _split_on_reversals(t)

    segments = []
    for k, (i0, i1) in enumerate(bounds):
        if i1 <= i0:
            continue
        delta = float(t[i1] - t[i0])
        span = float(np.max(t[i0:i1 + 1]) - np.min(t[i0:i1 + 1]))
        if abs(delta) < max(3.0, 0.1 * span) and span < 10.0:
            kind = 'isothermal'
        elif delta >= 0:
            kind = 'heating'
        else:
            kind = 'cooling'
        segments.append({
            'label': f"S{k + 1}",
            'kind': kind,
            'start': int(i0),
            'end': int(i1),
            't_start': float(t[i0]),
            't_end': float(t[i1]),
            'n': int(i1 - i0 + 1),
        })
    return segments


def _split_on_reversals(t):
    """(start, end) index pairs between temperature turning points.

    Tracks the running maximum AND minimum since the last turn - with a
    single running extremum an undecided initial direction follows the trace
    both ways and no reversal ever exceeds the hysteresis swing.
    """
    swing = max(5.0, 0.02 * float(np.max(t) - np.min(t)))
    bounds = []
    start = 0
    direction = 0                     # +1 rising, -1 falling, 0 undecided
    hi = lo = t[0]
    hi_i = lo_i = 0
    for i in range(1, t.size):
        v = t[i]
        if v > hi:
            hi, hi_i = v, i
        if v < lo:
            lo, lo_i = v, i
        if direction >= 0 and hi - v > swing:
            # Was rising (or undecided): the ramp ended at its maximum.
            if hi_i > start:
                bounds.append((start, hi_i))
                start = hi_i
            direction = -1
            lo, lo_i = v, i
        elif direction <= 0 and v - lo > swing:
            if lo_i > start:
                bounds.append((start, lo_i))
                start = lo_i
            direction = 1
            hi, hi_i = v, i
    if t.size - 1 > start:
        bounds.append((start, t.size - 1))
    return bounds


def mean_cte(temperature, strain, t1, t2):
    """Mean (technical) CTE between two temperatures on one ramp.

    Returns {'t1', 't2', 'eps1', 'eps2', 'alpha_per_K'} or None when the
    temperatures fall outside the data or on top of each other. The slice is
    interpolated on a sorted copy - callers hand in a single monotonic
    segment, never a whole heat/cool loop.
    """
    t = np.asarray(temperature, dtype=float)
    e = np.asarray(strain, dtype=float)
    keep = np.isfinite(t) & np.isfinite(e)
    t, e = t[keep], e[keep]
    if t.size < 3 or abs(t2 - t1) < 1e-9:
        return None
    lo, hi = float(np.min(t)), float(np.max(t))
    if not (lo <= t1 <= hi and lo <= t2 <= hi):
        return None
    order = np.argsort(t)
    eps1 = float(np.interp(t1, t[order], e[order]))
    eps2 = float(np.interp(t2, t[order], e[order]))
    return {
        't1': float(t1), 't2': float(t2),
        'eps1': eps1, 'eps2': eps2,
        'alpha_per_K': (eps2 - eps1) / (t2 - t1),
    }


def alpha_curve(temperature, strain, window_pts=51):
    """Differential CTE alpha(T) = d(dL/L0)/dT along one segment.

    Savitzky-Golay analytic derivative with the chain rule - NOT
    smooth-then-gradient, which amplifies point noise into extrema larger
    than the real features (the lesson from the TGA DTG trace). Returns
    ``(T, alpha)`` arrays (alpha in 1/K).
    """
    from scipy.signal import savgol_filter
    t = np.asarray(temperature, dtype=float)
    e = np.asarray(strain, dtype=float)
    keep = np.isfinite(t) & np.isfinite(e)
    t, e = t[keep], e[keep]
    if t.size < 7:
        return np.array([]), np.array([])
    window = int(window_pts) | 1                      # odd
    window = max(5, min(window, t.size - 1 if t.size % 2 == 0 else t.size))
    if window % 2 == 0:
        window -= 1
    de_di = savgol_filter(e, window, 2, deriv=1)
    dt_di = savgol_filter(t, window, 2, deriv=1)
    mask = np.abs(dt_di) > 1e-4                       # skip dwells
    return t[mask], de_di[mask] / dt_di[mask]


def sintering_analysis(temperature, strain, onset_drop=0.001, window_pts=51):
    """Densification metrics of one heating segment.

    ``onset_drop`` is the dL/L0 fall below the maximum expansion that defines
    the shrinkage onset (default 0.1 %). Returns a dict or None when the
    segment never shrinks by that much.
    """
    t = np.asarray(temperature, dtype=float)
    e = np.asarray(strain, dtype=float)
    keep = np.isfinite(t) & np.isfinite(e)
    t, e = t[keep], e[keep]
    if t.size < 7:
        return None

    i_max = int(np.argmax(e))
    result = {
        't_max_expansion': float(t[i_max]),
        'eps_max': float(e[i_max]),
        'eps_final': float(e[-1]),
        'total_shrinkage': float(e[-1] - e[i_max]),
    }

    onset = next((i for i in range(i_max, t.size)
                  if e[i] <= e[i_max] - onset_drop), None)
    if onset is None:
        return result
    result['t_onset'] = float(t[onset])
    result['onset_drop'] = float(onset_drop)

    t_a, alpha = alpha_curve(t[i_max:], e[i_max:], window_pts)
    if alpha.size:
        i_rate = int(np.argmin(alpha))
        result['t_max_rate'] = float(t_a[i_rate])
        result['max_rate_per_K'] = float(alpha[i_rate])
    return result


def load_results(sheet):
    try:
        stored = json.loads(sheet.get('DIL_Results') or '{}')
        return stored if isinstance(stored, dict) else {}
    except (TypeError, ValueError):
        return {}


def store_results(sheet, results):
    sheet['DIL_Results'] = json.dumps(results)


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------

_SEGMENT_BASES = {'heating': 'DIL~Heat', 'cooling': 'DIL~Cool',
                  'isothermal': 'DIL~Iso'}


def _dil_sheet_names(window):
    return sorted(n for n, s in window.Data.get('Core levels', {}).items()
                  if isinstance(s, dict) and str(n).upper().startswith('DIL'))


class DILAnalysisWindow(wx.Frame):
    SECTIONS = (
        ('data', "Data & Segments", '_build_data_tab'),
        ('cte', "Expansion (CTE)", '_build_cte_tab'),
        ('sinter', "Sintering", '_build_sinter_tab'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        title = (f"Dilatometry {self.SECTION_TITLES[self._section_keys[0]]}"
                 if single else "Dilatometry Analysis")
        size = (520, 620) if single else (640, 680)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent
        self.segments = []

        self.notebook = wx.Notebook(self)
        builders = {k: b for k, _t, b in self.SECTIONS}
        self._panels = {k: getattr(self, builders[k])(self.notebook)
                        for k in keys}
        for key in self._section_keys:
            self.notebook.AddPage(self._panels[key], self.SECTION_TITLES[key])
        for key, panel in self._panels.items():
            if key not in self._section_keys:
                panel.Hide()

        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(self.notebook, 1, wx.EXPAND)
        self.SetSizer(sizer)

        self.refresh_sheet_list()
        self.load_sheet_into_ui()
        self.Bind(wx.EVT_CLOSE, self.on_close)
        self.SetMinSize((480, 480))
        self.CentreOnParent()

        if not hasattr(parent, '_dil_windows'):
            parent._dil_windows = []
        parent._dil_windows.append(self)
        parent.dil_analysis_window = self

    # ------------------------------------------------------------- tabs ----
    def _build_data_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Dilatometry sheet")
        self.sheet_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.sheet_combo.Bind(wx.EVT_COMBOBOX, self.on_sheet_selected)
        sheet_box.Add(self.sheet_combo, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(sheet_box, 0, wx.ALL | wx.EXPAND, 8)

        info_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Sheet")
        self.info_text = wx.StaticText(panel, label="—")
        info_box.Add(self.info_text, 0, wx.ALL | wx.EXPAND, 5)
        vbox.Add(info_box, 0, wx.ALL | wx.EXPAND, 8)

        seg_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Programme segments")
        self.seg_grid = wx.grid.Grid(panel)
        self.seg_grid.CreateGrid(0, 4)
        for col, (title, width) in enumerate((("Kind", 90),
                                              ("T start (°C)", 95),
                                              ("T end (°C)", 95),
                                              ("Points", 70))):
            self.seg_grid.SetColLabelValue(col, title)
            self.seg_grid.SetColSize(col, width)
        self.seg_grid.SetRowLabelSize(40)
        self.seg_grid.EnableEditing(False)
        self.seg_grid.SetSelectionMode(wx.grid.Grid.SelectRows)
        seg_box.Add(self.seg_grid, 1, wx.ALL | wx.EXPAND, 5)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        one_btn = wx.Button(panel, label="Sheet from selected segment")
        one_btn.SetToolTip("Write the highlighted segment out as its own "
                           "DIL~Heat / DIL~Cool / DIL~Iso sheet")
        one_btn.Bind(wx.EVT_BUTTON, self.on_segment_sheet)
        buttons.Add(one_btn, 0, wx.RIGHT, 5)
        all_btn = wx.Button(panel, label="Sheets from all segments")
        all_btn.Bind(wx.EVT_BUTTON, self.on_all_segment_sheets)
        buttons.Add(all_btn, 0)
        seg_box.Add(buttons, 0, wx.ALL, 5)
        vbox.Add(seg_box, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_cte_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        hint = wx.StaticText(
            panel, label="Run this on a single ramp — use 'Sheet from "
                         "selected segment' on the Data tab first.")
        hint.SetForegroundColour(wx.Colour(90, 90, 90))
        vbox.Add(hint, 0, wx.ALL, 8)

        mean_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "Mean (technical) CTE")
        grid = wx.FlexGridSizer(2, 2, 5, 5)
        grid.AddGrowableCol(1)
        grid.Add(wx.StaticText(panel, label="T1 (°C):"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.t1_ctrl = wx.SpinCtrlDouble(panel, min=-200.0, max=2500.0,
                                         initial=100.0, inc=1.0)
        self.t1_ctrl.SetDigits(1)
        grid.Add(self.t1_ctrl, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="T2 (°C):"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.t2_ctrl = wx.SpinCtrlDouble(panel, min=-200.0, max=2500.0,
                                         initial=500.0, inc=1.0)
        self.t2_ctrl.SetDigits(1)
        grid.Add(self.t2_ctrl, 0, wx.EXPAND)
        mean_box.Add(grid, 0, wx.ALL | wx.EXPAND, 5)
        mean_btn = wx.Button(panel, label="Compute mean CTE")
        mean_btn.Bind(wx.EVT_BUTTON, self.on_mean_cte)
        mean_box.Add(mean_btn, 0, wx.ALL, 5)
        vbox.Add(mean_box, 0, wx.ALL | wx.EXPAND, 8)

        alpha_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "Differential CTE α(T)")
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Smoothing window (points):"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.alpha_window_ctrl = wx.SpinCtrl(panel, min=5, max=501, initial=51)
        row.Add(self.alpha_window_ctrl, 0)
        alpha_box.Add(row, 0, wx.ALL, 5)
        alpha_btn = wx.Button(panel, label="Create DIL~Alpha sheet")
        alpha_btn.SetToolTip("α(T) = d(dL/L0)/dT in 10⁻⁶ K⁻¹, as its own "
                             "sheet (Savitzky-Golay derivative)")
        alpha_btn.Bind(wx.EVT_BUTTON, self.on_alpha_sheet)
        alpha_box.Add(alpha_btn, 0, wx.ALL, 5)
        vbox.Add(alpha_box, 0, wx.ALL | wx.EXPAND, 8)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Result")
        self.cte_result = wx.StaticText(panel, label="—")
        result_box.Add(self.cte_result, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(result_box, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_sinter_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Onset threshold (% dL/L0 below "
                                           "maximum):"),
                0, wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.onset_ctrl = wx.SpinCtrlDouble(panel, min=0.01, max=5.0,
                                            initial=0.1, inc=0.01)
        self.onset_ctrl.SetDigits(2)
        row.Add(self.onset_ctrl, 0)
        vbox.Add(row, 0, wx.ALL, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        run_btn = wx.Button(panel, label="Analyse sintering")
        run_btn.Bind(wx.EVT_BUTTON, self.on_sinter)
        buttons.Add(run_btn, 0, wx.RIGHT, 5)
        label_btn = wx.Button(panel, label="Label plot")
        label_btn.Bind(wx.EVT_BUTTON, self.on_label_plot)
        buttons.Add(label_btn, 0, wx.RIGHT, 5)
        clear_btn = wx.Button(panel, label="Clear labels")
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_labels)
        buttons.Add(clear_btn, 0)
        vbox.Add(buttons, 0, wx.ALL, 8)

        self.sinter_report = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_DONTWRAP)
        self.sinter_report.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                           wx.FONTSTYLE_NORMAL,
                                           wx.FONTWEIGHT_NORMAL))
        vbox.Add(self.sinter_report, 1, wx.ALL | wx.EXPAND, 8)

        copy_btn = wx.Button(panel, label="Copy to clipboard")
        copy_btn.Bind(wx.EVT_BUTTON, self.on_copy_report)
        vbox.Add(copy_btn, 0, wx.ALL, 8)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------ helpers --
    def refresh_sheet_list(self):
        current = self.sheet_combo.GetValue()
        names = _dil_sheet_names(self.parent)
        self.sheet_combo.Set(names)
        if current in names:
            self.sheet_combo.SetValue(current)
        elif names:
            on_main = self.parent.sheet_combobox.GetValue()
            self.sheet_combo.SetValue(on_main if on_main in names else names[0])

    def get_sheet_data(self, complain=True):
        name = self.sheet_combo.GetValue()
        sheet = self.parent.Data.get('Core levels', {}).get(name)
        if sheet is None and complain:
            self.parent.show_popup_message2("Information",
                                            "No dilatometry sheet selected.")
        return name, sheet

    def _select_sheet_on_main(self, sheet_name):
        from libraries.Sheet_Operations import on_sheet_selected
        if sheet_name in self.parent.Data.get('Core levels', {}):
            self.parent.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(self.parent, sheet_name)

    def on_sheet_selected(self, event):
        self.load_sheet_into_ui()
        self._select_sheet_on_main(self.sheet_combo.GetValue())

    def _strain_of(self, sheet, complain=True):
        """(temperature, dL/L0) arrays for a sheet, or (None, None).

        A sheet holding absolute microns is converted through the sample
        length when it has one.
        """
        t = np.asarray(sheet.get('B.E.', []), dtype=float)
        y = np.asarray(sheet.get('Raw Data', []), dtype=float)
        if sheet.get('DIL_Y_Unit', 'rel') == 'rel':
            return t, y
        length_mm = sheet.get('DIL_Sample_Length_mm')
        if length_mm:
            return t, y / (float(length_mm) * 1000.0)
        if complain:
            self.parent.show_popup_message2(
                "Information",
                "This sheet holds dL in µm and no sample length is recorded, "
                "so dL/L0 cannot be formed.")
        return None, None

    def load_sheet_into_ui(self):
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is None:
            self.info_text.SetLabel("No DIL sheets in this project.")
            self._populate_segments([])
            return

        t = sheet.get('B.E.', [])
        lines = [f"Sheet: {name}"]
        if t:
            lines.append(f"{len(t)} points, {min(t):.0f}–{max(t):.0f} °C")
        if sheet.get('DIL_Sample_Length_mm'):
            lines.append(f"Sample length L0 = "
                         f"{sheet['DIL_Sample_Length_mm']:g} mm")
        results = load_results(sheet)
        if 'cte' in results:
            cte = results['cte']
            lines.append(f"Mean CTE {cte['t1']:.0f}–{cte['t2']:.0f} °C: "
                         f"{cte['alpha_per_K'] * 1e6:.2f} ×10⁻⁶ K⁻¹")
        self.info_text.SetLabel("\n".join(lines))

        self.segments = detect_segments(sheet.get('B.E.', []),
                                        sheet.get('DIL_Segment'))
        self._populate_segments(self.segments)

        # Preset the CTE window to the middle half of the sheet's range.
        if t:
            lo, hi = min(t), max(t)
            self.t1_ctrl.SetValue(lo + 0.25 * (hi - lo))
            self.t2_ctrl.SetValue(lo + 0.75 * (hi - lo))

    def _populate_segments(self, segments):
        grid = self.seg_grid
        current = grid.GetNumberRows()
        if current:
            grid.DeleteRows(0, current)
        if not segments:
            return
        grid.AppendRows(len(segments))
        for row, seg in enumerate(segments):
            grid.SetRowLabelValue(row, seg['label'])
            grid.SetCellValue(row, 0, seg['kind'])
            grid.SetCellValue(row, 1, f"{seg['t_start']:.1f}")
            grid.SetCellValue(row, 2, f"{seg['t_end']:.1f}")
            grid.SetCellValue(row, 3, str(seg['n']))
        grid.ForceRefresh()

    # ------------------------------------------------------------ actions --
    def _publish_segment(self, name, sheet, seg):
        """Write one segment slice out as its own DIL~... sheet."""
        i0, i1 = seg['start'], seg['end'] + 1
        x = list(sheet.get('B.E.', [])[i0:i1])
        y = list(sheet.get('Raw Data', [])[i0:i1])
        extra = {
            'DIL_X_Label': sheet.get('DIL_X_Label', 'Temperature (°C)'),
            'DIL_Y_Label': sheet.get('DIL_Y_Label', 'dL/L$_0$'),
            'DIL_Y_Unit': sheet.get('DIL_Y_Unit', 'rel'),
            'DIL_Sample_Length_mm': sheet.get('DIL_Sample_Length_mm'),
            'DIL_Label': f"{sheet.get('DIL_Label', name)} {seg['label']} "
                         f"({seg['kind']})",
            'DIL_Source': name,
            'DIL_Segment_Kind': seg['kind'],
        }
        for key in ('DIL_Time_min', 'DIL_Segment', 'DIL_Temperature',
                    'DIL_Strain', 'DIL_dL_um'):
            values = sheet.get(key)
            if isinstance(values, list) and len(values) >= i1:
                extra[key] = values[i0:i1]
        base = _SEGMENT_BASES.get(seg['kind'], 'DIL~Seg')
        new_name = self._new_sheet(base)
        self._write_sheet(new_name, x, y, extra)
        return new_name

    def on_segment_sheet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        if not self.segments:
            self.parent.show_popup_message2("Information",
                                            "No segments detected.")
            return
        rows = self.seg_grid.GetSelectedRows()
        row = rows[0] if rows else self.seg_grid.GetGridCursorRow()
        if not 0 <= row < len(self.segments):
            row = 0
        new_name = self._publish_segment(name, sheet, self.segments[row])
        self.sheet_combo.SetValue(new_name)
        self._select_sheet_on_main(new_name)
        self.load_sheet_into_ui()

    def on_all_segment_sheets(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        if not self.segments:
            self.parent.show_popup_message2("Information",
                                            "No segments detected.")
            return
        last = None
        for seg in self.segments:
            last = self._publish_segment(name, sheet, seg)
        if last:
            self._select_sheet_on_main(last)
        self.load_sheet_into_ui()

    def on_mean_cte(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        t, eps = self._strain_of(sheet)
        if t is None:
            return
        result = mean_cte(t, eps, self.t1_ctrl.GetValue(),
                          self.t2_ctrl.GetValue())
        if result is None:
            self.parent.show_popup_message2(
                "Information",
                "T1 and T2 must lie inside the sheet's temperature range.")
            return
        results = load_results(sheet)
        results['cte'] = result
        store_results(sheet, results)
        self._persist()
        self.cte_result.SetLabel(
            f"Mean CTE {result['t1']:.1f}–{result['t2']:.1f} °C:\n"
            f"α = {result['alpha_per_K'] * 1e6:.3f} ×10⁻⁶ K⁻¹\n"
            f"dL/L0: {result['eps1']:.3e} → {result['eps2']:.3e}")
        self.load_sheet_into_ui()

    def on_alpha_sheet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        t, eps = self._strain_of(sheet)
        if t is None:
            return
        t_a, alpha = alpha_curve(t, eps, self.alpha_window_ctrl.GetValue())
        if not alpha.size:
            self.parent.show_popup_message2(
                "Information", "Not enough points on a ramp — α(T) needs a "
                               "heating or cooling segment.")
            return
        new_name = self._new_sheet('DIL~Alpha')
        self._write_sheet(new_name, t_a.tolist(),
                          (alpha * 1e6).tolist(), {
                              'DIL_X_Label': 'Temperature (°C)',
                              'DIL_Y_Label': 'α (10$^{-6}$ K$^{-1}$)',
                              'DIL_Y_Unit': 'alpha',
                              'DIL_Sample_Length_mm':
                                  sheet.get('DIL_Sample_Length_mm'),
                              'DIL_Label': f"α(T) of {name}",
                              'DIL_Source': name,
                          })
        self.cte_result.SetLabel(
            f"α(T) written to {new_name} "
            f"({alpha.size} points, window "
            f"{self.alpha_window_ctrl.GetValue()} pts)")
        self._select_sheet_on_main(new_name)

    def on_sinter(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        t, eps = self._strain_of(sheet)
        if t is None:
            return
        result = sintering_analysis(t, eps,
                                    self.onset_ctrl.GetValue() / 100.0,
                                    self.alpha_window_ctrl.GetValue())
        if result is None:
            self.parent.show_popup_message2("Information", "Not enough data.")
            return
        results = load_results(sheet)
        results['sinter'] = result
        store_results(sheet, results)
        self._persist()
        self.sinter_report.SetValue(self._sinter_text(name, result))

    def _sinter_text(self, name, r):
        lines = [f"Sintering analysis: {name}",
                 f"Maximum expansion: dL/L0 = {r['eps_max']:.4e} at "
                 f"{r['t_max_expansion']:.1f} °C"]
        if 't_onset' in r:
            lines.append(f"Shrinkage onset ({r['onset_drop'] * 100:.2f}% "
                         f"below maximum): {r['t_onset']:.1f} °C")
            if 't_max_rate' in r:
                lines.append(f"Maximum shrinkage rate: "
                             f"{r['max_rate_per_K'] * 1e6:.1f} ×10⁻⁶ K⁻¹ at "
                             f"{r['t_max_rate']:.1f} °C")
        else:
            lines.append("No shrinkage beyond the onset threshold — the "
                         "segment never sinters.")
        lines.append(f"Final dL/L0: {r['eps_final']:.4e}")
        lines.append(f"Total shrinkage from maximum: "
                     f"{r['total_shrinkage']:.4e} "
                     f"({r['total_shrinkage'] * 100:.3f} %)")
        return "\n".join(lines)

    def on_copy_report(self, event):
        if wx.TheClipboard.Open():
            wx.TheClipboard.SetData(
                wx.TextDataObject(self.sinter_report.GetValue()))
            wx.TheClipboard.Close()

    def on_label_plot(self, event):
        from libraries.FileMenu.Save import save_state
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        result = load_results(sheet).get('sinter')
        if not result:
            self.parent.show_popup_message2("Information",
                                            "Run 'Analyse sintering' first.")
            return
        save_state(self.parent)
        labels = sheet.setdefault('Labels', [])
        labels[:] = [ld for ld in labels if not ld.get('dil_label')]
        x_all = np.asarray(sheet.get('B.E.', []), dtype=float)
        y_all = np.asarray(sheet.get('Raw Data', []), dtype=float)
        gap = 0.04 * (float(np.max(y_all) - np.min(y_all)) or 1.0)

        marks = [(result['t_max_expansion'],
                  f"max\n{result['t_max_expansion']:.0f}°C")]
        if 't_onset' in result:
            marks.append((result['t_onset'],
                          f"onset\n{result['t_onset']:.0f}°C"))
        if 't_max_rate' in result:
            marks.append((result['t_max_rate'],
                          f"max rate\n{result['t_max_rate']:.0f}°C"))
        order = np.argsort(x_all)
        for t_mark, text in marks:
            y_mark = (float(np.interp(t_mark, x_all[order], y_all[order]))
                      if x_all.size else 0.0)
            labels.append({
                'type': 'text',
                'text': text,
                'x': float(t_mark),
                'y': y_mark + gap,
                'rotation': 0, 'va': 'bottom', 'ha': 'center',
                'dil_label': True,
            })
        self._persist()
        self._select_sheet_on_main(name)

    def on_clear_labels(self, event):
        from libraries.FileMenu.Save import save_state
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        labels = sheet.get('Labels', [])
        if not any(ld.get('dil_label') for ld in labels):
            return
        save_state(self.parent)
        sheet['Labels'] = [ld for ld in labels if not ld.get('dil_label')]
        self._persist()
        self._select_sheet_on_main(name)

    # ------------------------------------------------------- sheet writing --
    def _new_sheet(self, base):
        existing = {n.upper() for n in self.parent.Data.get('Core levels', {})}
        if base.upper() not in existing:
            return base
        idx = 1
        while f"{base}{idx}".upper() in existing:
            idx += 1
        return f"{base}{idx}"

    def _write_sheet(self, name, x, y, extra):
        from libraries.FileMenu.KFitting_Import import (TECH_DIL,
                                                        build_generic_sheet)
        sheet = build_generic_sheet(TECH_DIL, name, list(x), list(y),
                                    source_name=extra.get('DIL_Source', ''))
        sheet.update(extra)
        self.parent.Data['Core levels'][name] = sheet
        self.parent.Data['Number of Core levels'] = len(
            self.parent.Data['Core levels'])
        if hasattr(self.parent, 'sheet_combobox'):
            existing = [self.parent.sheet_combobox.GetString(i)
                        for i in range(self.parent.sheet_combobox.GetCount())]
            if name not in existing:
                self.parent.sheet_combobox.Append(name)
        self._persist()
        self.refresh_sheet_list()

    def _persist(self):
        from libraries.FileMenu.KFitting_IO import persist_project
        try:
            persist_project(self.parent)
        except Exception as e:
            print(f"Dilatometry persist skipped: {e}")

    # --------------------------------------------------------------- close --
    def on_close(self, event):
        windows = getattr(self.parent, '_dil_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'dil_analysis_window', None) is self:
            self.parent.dil_analysis_window = (remaining[-1] if remaining
                                               else None)
        self.Destroy()


def open_dil_window(window):
    """Open (or raise) the full Dilatometry Analysis window."""
    for existing in list(getattr(window, '_dil_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    DILAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = DILAnalysisWindow(window)
    frame.Show()
    return frame


def open_dil_section(window, key):
    """Open one dilatometry tab as its own window."""
    for existing in list(getattr(window, '_dil_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = DILAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
