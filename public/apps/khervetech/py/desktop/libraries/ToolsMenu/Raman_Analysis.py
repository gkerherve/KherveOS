# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/Raman_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/Raman_Analysis.py
"""
Raman analysis window: peak detection / import of fitted peaks, database
assignment with ranked candidates, plot labelling and a searchable band
library.

The peaks can come from two places: 'Find peaks' detects maxima on the raw
trace, while 'Use fitted peaks' reads the positions, heights and widths of the
peaks already fitted in the Peak Parameters grid - Raman sheets use the normal
peak-fitting machinery, so the natural workflow is fit-then-assign.

Detected peaks and their accepted assignments are stored on the sheet under
``Raman_Peaks`` (a JSON string, immune to the .xlsx two-decimal rounding).
"""

import json

import numpy as np
import wx
import wx.grid

from libraries.ToolsMenu import Raman_Assign as assign
from libraries.ToolsMenu.Raman_Library import RAMAN_BANDS


def is_raman_sheet(sheet_name):
    name = str(sheet_name or '')
    return (name.startswith('RA') or 'RAMAN' in name.upper()
            or name.startswith('Ra_'))


def _raman_sheet_names(window):
    return sorted(n for n, s in window.Data.get('Core levels', {}).items()
                  if isinstance(s, dict) and is_raman_sheet(n))


# ---------------------------------------------------------------------------
# Peak detection
# ---------------------------------------------------------------------------

def detect_peaks(x, y, prominence_fraction=0.03, max_peaks=25):
    """Maxima of a Raman trace: [{'shift','y','relative_height','fwhm'}]."""
    from scipy.signal import find_peaks, peak_widths
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if x.size < 7:
        return []
    order = np.argsort(x)
    x, y = x[order], y[order]
    span = float(np.nanmax(y) - np.nanmin(y)) or 1.0
    idx, _props = find_peaks(y, prominence=prominence_fraction * span)
    if idx.size == 0:
        return []
    widths, _h, lo_ips, hi_ips = peak_widths(y, idx, rel_height=0.5)
    step = float(np.median(np.diff(x))) if x.size > 1 else 1.0
    top = float(np.nanmax(y - np.nanmin(y))) or 1.0
    peaks = []
    for i, w in zip(idx, widths):
        peaks.append({
            'shift': float(x[i]),
            'y': float(y[i]),
            'relative_height': float((y[i] - np.nanmin(y)) / top),
            'fwhm': float(w * abs(step)),
        })
    peaks.sort(key=lambda p: -p['relative_height'])
    return peaks[:max_peaks]


def fitted_peaks(sheet):
    """Peaks from the sheet's normal fit, shaped like detect_peaks output."""
    fitting = sheet.get('Fitting')
    if not isinstance(fitting, dict):
        return []
    y = np.asarray(sheet.get('Raw Data', []), dtype=float)
    top = float(np.nanmax(y) - np.nanmin(y)) if y.size else 1.0
    top = top or 1.0
    skip = {'Unfitted', 'D-parameter', 'Fermi', 'VBM', 'Cut-Off', 'SurveyID',
            'Curie-Weiss', 'Equivalent Circuit'}
    peaks = []
    for label, pk in (fitting.get('Peaks') or {}).items():
        if not isinstance(pk, dict) or pk.get('Fitting Model') in skip:
            continue
        try:
            position = float(pk.get('Position'))
        except (TypeError, ValueError):
            continue
        try:
            height = float(pk.get('Height'))
        except (TypeError, ValueError):
            height = 0.0
        entry = {'shift': position, 'y': height,
                 'relative_height': min(1.0, height / top),
                 'label': str(label)}
        try:
            entry['fwhm'] = float(pk.get('FWHM'))
        except (TypeError, ValueError):
            pass
        peaks.append(entry)
    peaks.sort(key=lambda p: p['shift'])
    return peaks


def load_peaks(sheet):
    try:
        stored = json.loads(sheet.get('Raman_Peaks') or '[]')
        return stored if isinstance(stored, list) else []
    except (TypeError, ValueError):
        return []


def store_peaks(sheet, peaks):
    # Candidates are rebuilt on demand; storing them would bloat the project.
    slim = [{k: v for k, v in pk.items() if k != 'candidates'}
            for pk in peaks]
    sheet['Raman_Peaks'] = json.dumps(slim)


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------

class RamanAnalysisWindow(wx.Frame):
    SECTIONS = (
        ('peaks', "Peaks & Assignment", '_build_peaks_tab'),
        ('library', "Band Library", '_build_library_tab'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            title = f"Raman {self.SECTION_TITLES[self._section_keys[0]]}"
            size = (560, 720)
        else:
            title = "Raman Analysis"
            size = (700, 760)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent
        self.detected_peaks = []

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
        self.populate_library_grid()
        self.Bind(wx.EVT_CLOSE, self.on_close)
        self.SetMinSize((520, 560))
        self.CentreOnParent()

        if not hasattr(parent, '_raman_windows'):
            parent._raman_windows = []
        parent._raman_windows.append(self)
        parent.raman_analysis_window = self

    # ------------------------------------------------------------- tabs ----
    def _build_peaks_tab(self, notebook):
        panel = wx.ScrolledWindow(notebook)
        panel.SetScrollRate(0, 10)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Raman sheet")
        self.sheet_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.sheet_combo.Bind(wx.EVT_COMBOBOX, self.on_sheet_selected)
        sheet_box.Add(self.sheet_combo, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(sheet_box, 0, wx.ALL | wx.EXPAND, 6)

        meta_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Sample metadata")
        grid = wx.FlexGridSizer(3, 4, 4, 6)
        grid.AddGrowableCol(1)
        grid.AddGrowableCol(3)
        grid.Add(wx.StaticText(panel, label="Material:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.material_choice = wx.Choice(panel,
                                         choices=list(assign.MATERIAL_TYPES))
        self.material_choice.SetSelection(0)
        self.material_choice.Bind(wx.EVT_CHOICE, self.on_meta_changed)
        grid.Add(self.material_choice, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="Substrate:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.substrate_choice = wx.Choice(panel,
                                          choices=list(assign.SUBSTRATES))
        self.substrate_choice.SetSelection(0)
        self.substrate_choice.Bind(wx.EVT_CHOICE, self.on_meta_changed)
        grid.Add(self.substrate_choice, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="Elements:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.elements_ctrl = wx.TextCtrl(panel)
        self.elements_ctrl.SetToolTip("Expected elements, e.g. Ti O C")
        self.elements_ctrl.Bind(wx.EVT_KILL_FOCUS, self.on_meta_changed)
        grid.Add(self.elements_ctrl, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="Laser (nm):"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.excitation_combo = wx.ComboBox(
            panel, choices=list(assign.DEFAULT_EXCITATIONS))
        self.excitation_combo.SetValue("532")
        grid.Add(self.excitation_combo, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="In air:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.in_air_check = wx.CheckBox(panel)
        self.in_air_check.SetValue(True)
        self.in_air_check.Bind(wx.EVT_CHECKBOX, self.on_meta_changed)
        grid.Add(self.in_air_check, 0)
        meta_box.Add(grid, 0, wx.ALL | wx.EXPAND, 5)
        vbox.Add(meta_box, 0, wx.ALL | wx.EXPAND, 6)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        find_btn = wx.Button(panel, label="Find peaks")
        find_btn.Bind(wx.EVT_BUTTON, self.on_find_peaks)
        buttons.Add(find_btn, 0, wx.RIGHT, 5)
        fitted_btn = wx.Button(panel, label="Use fitted peaks")
        fitted_btn.SetToolTip("Assign the peaks already fitted in the Peak "
                              "Parameters grid")
        fitted_btn.Bind(wx.EVT_BUTTON, self.on_use_fitted)
        buttons.Add(fitted_btn, 0, wx.RIGHT, 5)
        reassign_btn = wx.Button(panel, label="Re-assign")
        reassign_btn.Bind(wx.EVT_BUTTON, self.on_reassign)
        buttons.Add(reassign_btn, 0, wx.RIGHT, 5)
        label_btn = wx.Button(panel, label="Label plot")
        label_btn.Bind(wx.EVT_BUTTON, self.on_label_peaks)
        buttons.Add(label_btn, 0, wx.RIGHT, 5)
        clear_btn = wx.Button(panel, label="Clear labels")
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_labels)
        buttons.Add(clear_btn, 0)
        vbox.Add(buttons, 0, wx.ALL, 6)

        self.peaks_grid = wx.grid.Grid(panel)
        self.peaks_grid.CreateGrid(0, 5)
        for col, (title, width) in enumerate((
                ("Shift (cm⁻¹)", 90), ("Height %", 70), ("FWHM", 65),
                ("Conf.", 60), ("Assignment", 260))):
            self.peaks_grid.SetColLabelValue(col, title)
            self.peaks_grid.SetColSize(col, width)
        self.peaks_grid.SetRowLabelSize(28)
        self.peaks_grid.EnableEditing(False)
        self.peaks_grid.Bind(wx.grid.EVT_GRID_SELECT_CELL, self.on_peak_row)
        vbox.Add(self.peaks_grid, 1, wx.ALL | wx.EXPAND, 6)

        cand_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "Candidates for the selected peak")
        self.cand_list = wx.ListCtrl(panel, style=wx.LC_REPORT,
                                     size=(-1, 130))
        for i, (title, width) in enumerate((
                ("Conf.", 55), ("Range", 85), ("Mode", 190),
                ("Assignment", 240))):
            self.cand_list.InsertColumn(i, title, width=width)
        cand_box.Add(self.cand_list, 1, wx.ALL | wx.EXPAND, 4)
        cand_row = wx.BoxSizer(wx.HORIZONTAL)
        accept_btn = wx.Button(panel, label="Accept selected candidate")
        accept_btn.Bind(wx.EVT_BUTTON, self.on_accept_candidate)
        cand_row.Add(accept_btn, 0, wx.RIGHT, 8)
        self.reason_text = wx.StaticText(panel, label="")
        cand_row.Add(self.reason_text, 1, wx.ALIGN_CENTER_VERTICAL)
        cand_box.Add(cand_row, 0, wx.ALL | wx.EXPAND, 4)
        vbox.Add(cand_box, 0, wx.ALL | wx.EXPAND, 6)

        panel.SetSizer(vbox)
        return panel

    def _build_library_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        search_row = wx.BoxSizer(wx.HORIZONTAL)
        search_row.Add(wx.StaticText(panel, label="Search:"), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.search_ctrl = wx.TextCtrl(panel)
        self.search_ctrl.SetToolTip(
            "Filter by text (anatase, D band, sulfate…) or by a shift "
            "value in cm-1 (e.g. 520)")
        self.search_ctrl.Bind(wx.EVT_TEXT, self.on_search_library)
        search_row.Add(self.search_ctrl, 1)
        vbox.Add(search_row, 0, wx.ALL | wx.EXPAND, 8)

        self.library_grid = wx.grid.Grid(panel)
        self.library_grid.CreateGrid(0, 4)
        for col, (title, width) in enumerate((
                ("Shift (cm⁻¹)", 95), ("Mode", 200),
                ("Intensity / shape", 180), ("Assignment", 280))):
            self.library_grid.SetColLabelValue(col, title)
            self.library_grid.SetColSize(col, width)
        self.library_grid.SetRowLabelSize(28)
        self.library_grid.EnableEditing(False)
        vbox.Add(self.library_grid, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------ helpers --
    def refresh_sheet_list(self):
        current = self.sheet_combo.GetValue()
        names = _raman_sheet_names(self.parent)
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
                                            "No Raman sheet selected.")
        return name, sheet

    def _select_sheet_on_main(self, sheet_name):
        from libraries.Sheet_Operations import on_sheet_selected
        if sheet_name in self.parent.Data.get('Core levels', {}):
            self.parent.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(self.parent, sheet_name)

    def on_sheet_selected(self, event):
        self.load_sheet_into_ui()
        self._select_sheet_on_main(self.sheet_combo.GetValue())

    def load_sheet_into_ui(self):
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is None:
            return
        meta = sheet.get('Raman_Meta')
        if isinstance(meta, dict):
            if meta.get('material_type') in assign.MATERIAL_TYPES:
                self.material_choice.SetStringSelection(meta['material_type'])
            if meta.get('substrate') in assign.SUBSTRATES:
                self.substrate_choice.SetStringSelection(meta['substrate'])
            self.elements_ctrl.SetValue(meta.get('elements', ''))
            self.excitation_combo.SetValue(str(meta.get('excitation_nm',
                                                        '532')))
            self.in_air_check.SetValue(bool(meta.get('in_air', True)))
        self.detected_peaks = load_peaks(sheet)
        if self.detected_peaks:
            assign.assign_peaks(self.detected_peaks, self._metadata())
        self.populate_peaks_grid()

    def _metadata(self):
        return {
            'material_type': self.material_choice.GetStringSelection(),
            'elements': self.elements_ctrl.GetValue(),
            'substrate': self.substrate_choice.GetStringSelection(),
            'excitation_nm': self.excitation_combo.GetValue(),
            'in_air': self.in_air_check.GetValue(),
        }

    def on_meta_changed(self, event):
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is not None:
            sheet['Raman_Meta'] = self._metadata()
            self._persist()
        if isinstance(event, wx.FocusEvent):
            event.Skip()

    # ------------------------------------------------------------ actions --
    def on_find_peaks(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        peaks = detect_peaks(sheet.get('B.E.', []), sheet.get('Raw Data', []))
        if not peaks:
            self.parent.show_popup_message2("Information", "No peaks found.")
            return
        self.detected_peaks = assign.assign_peaks(peaks, self._metadata())
        store_peaks(sheet, self.detected_peaks)
        sheet['Raman_Meta'] = self._metadata()
        self._persist()
        self.populate_peaks_grid()

    def on_use_fitted(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        peaks = fitted_peaks(sheet)
        if not peaks:
            self.parent.show_popup_message2(
                "Information",
                "No fitted peaks on this sheet — fit peaks in the main "
                "window first, or use 'Find peaks'.")
            return
        self.detected_peaks = assign.assign_peaks(peaks, self._metadata())
        store_peaks(sheet, self.detected_peaks)
        sheet['Raman_Meta'] = self._metadata()
        self._persist()
        self.populate_peaks_grid()

    def on_reassign(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None or not self.detected_peaks:
            return
        for pk in self.detected_peaks:
            pk.pop('locked', None)
        assign.assign_peaks(self.detected_peaks, self._metadata())
        store_peaks(sheet, self.detected_peaks)
        self._persist()
        self.populate_peaks_grid()

    def populate_peaks_grid(self):
        grid = self.peaks_grid
        current = grid.GetNumberRows()
        if current:
            grid.DeleteRows(0, current)
        if not self.detected_peaks:
            self.cand_list.DeleteAllItems()
            return
        grid.AppendRows(len(self.detected_peaks))
        for row, pk in enumerate(self.detected_peaks):
            grid.SetCellValue(row, 0, f"{pk['shift']:.1f}")
            grid.SetCellValue(row, 1,
                              f"{100 * pk.get('relative_height', 0):.0f}")
            fwhm = pk.get('fwhm')
            grid.SetCellValue(row, 2, f"{fwhm:.1f}" if fwhm else "")
            grid.SetCellValue(row, 3, f"{pk.get('confidence', 0):.2f}")
            grid.SetCellValue(row, 4, pk.get('assignment', ''))
            if pk.get('artifact_risk', 0) >= 0.4:
                for col in range(5):
                    grid.SetCellBackgroundColour(row, col,
                                                 wx.Colour(255, 235, 205))
        grid.ForceRefresh()
        self._show_candidates(0)

    def on_peak_row(self, event):
        self._show_candidates(event.GetRow())
        event.Skip()

    def _show_candidates(self, row):
        self.cand_list.DeleteAllItems()
        self.reason_text.SetLabel("")
        if not (0 <= row < len(self.detected_peaks)):
            return
        pk = self.detected_peaks[row]
        cands = pk.get('candidates')
        if cands is None:
            cands = assign.candidates(pk['shift'], self._metadata(),
                                      observed_intensity=pk.get(
                                          'relative_height'),
                                      fwhm=pk.get('fwhm'))
            pk['candidates'] = cands
        for cand in cands:
            i = self.cand_list.GetItemCount()
            self.cand_list.InsertItem(i, f"{cand['confidence']:.2f}")
            self.cand_list.SetItem(i, 1, cand['range_text'])
            self.cand_list.SetItem(i, 2, cand['mode'])
            self.cand_list.SetItem(i, 3, cand['assignment'])
        if cands and cands[0].get('reasons'):
            self.reason_text.SetLabel("; ".join(cands[0]['reasons'])[:120])

    def on_accept_candidate(self, event):
        row = self.peaks_grid.GetGridCursorRow()
        cand_idx = self.cand_list.GetFirstSelected()
        if not (0 <= row < len(self.detected_peaks)) or cand_idx < 0:
            return
        pk = self.detected_peaks[row]
        cands = pk.get('candidates') or []
        if cand_idx >= len(cands):
            return
        chosen = cands[cand_idx]
        pk['assignment'] = assign.summarise(chosen)
        pk['confidence'] = chosen['confidence']
        pk['locked'] = True
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is not None:
            store_peaks(sheet, self.detected_peaks)
            self._persist()
        self.populate_peaks_grid()
        self.peaks_grid.SetGridCursor(row, 4)

    def on_label_peaks(self, event):
        from libraries.FileMenu.Save import save_state
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        if not self.detected_peaks:
            self.parent.show_popup_message2(
                "Information", "Run 'Find peaks' or 'Use fitted peaks' first.")
            return
        save_state(self.parent)
        labels = sheet.setdefault('Labels', [])
        labels[:] = [ld for ld in labels if not ld.get('raman_label')]

        y_all = np.asarray(sheet.get('Raw Data', []), dtype=float)
        span = float(np.max(y_all) - np.min(y_all)) if y_all.size else 1.0
        gap = 0.03 * (span or 1.0)

        selected = set(self.peaks_grid.GetSelectedRows())
        chosen = [(i, pk) for i, pk in enumerate(self.detected_peaks)
                  if not selected or i in selected]
        for _i, pk in chosen:
            text = f"{pk['shift']:.0f}"
            assignment = pk.get('assignment', '')
            if assignment and assignment != assign.UNASSIGNED:
                text += f"  {assignment.split(';')[0].split('(')[0].strip()}"
            if assignment == assign.ARTIFACT:
                text += " [?]"
            elif (pk.get('confidence', 0) < 0.45
                  and assignment != assign.UNASSIGNED):
                text += " (?)"
            labels.append({
                'type': 'text',
                'text': text,
                'x': pk['shift'],
                'y': pk.get('y', 0.0) + gap,
                'rotation': 90,
                'va': 'bottom',
                'ha': 'center',
                'raman_label': True,
            })
        self._persist()
        self._select_sheet_on_main(name)

    def on_clear_labels(self, event):
        from libraries.FileMenu.Save import save_state
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        labels = sheet.get('Labels', [])
        if not any(ld.get('raman_label') for ld in labels):
            return
        save_state(self.parent)
        sheet['Labels'] = [ld for ld in labels if not ld.get('raman_label')]
        self._persist()
        self._select_sheet_on_main(name)

    # ------------------------------------------------------------ library --
    def populate_library_grid(self, search_text=""):
        grid = self.library_grid
        current = grid.GetNumberRows()
        if current:
            grid.DeleteRows(0, current)
        needle = search_text.strip().lower()
        shift_query = None
        try:
            shift_query = float(needle)
        except ValueError:
            pass

        rows = []
        for wn_a, wn_b, mode, intensity, assignment in RAMAN_BANDS:
            hi, lo = max(wn_a, wn_b), min(wn_a, wn_b)
            if shift_query is not None:
                if not (lo - 15 <= shift_query <= hi + 15):
                    continue
            elif needle:
                haystack = f"{mode} {intensity} {assignment}".lower()
                if needle not in haystack:
                    continue
            rows.append((lo, hi, mode, intensity, assignment))
        rows.sort(key=lambda r: r[0])

        grid.AppendRows(max(len(rows), 0))
        for row, (lo, hi, mode, intensity, assignment) in enumerate(rows):
            grid.SetCellValue(row, 0,
                              f"{lo:.0f}" if lo == hi else f"{lo:.0f}-{hi:.0f}")
            grid.SetCellValue(row, 1, mode)
            grid.SetCellValue(row, 2, intensity)
            grid.SetCellValue(row, 3, assignment)
        grid.ForceRefresh()

    def on_search_library(self, event):
        self.populate_library_grid(self.search_ctrl.GetValue())

    # ------------------------------------------------------------ persist --
    def _persist(self):
        from libraries.FileMenu.KFitting_IO import persist_project
        try:
            persist_project(self.parent)
        except Exception as e:
            print(f"Raman persist skipped: {e}")

    # --------------------------------------------------------------- close --
    def on_close(self, event):
        windows = getattr(self.parent, '_raman_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'raman_analysis_window', None) is self:
            self.parent.raman_analysis_window = (remaining[-1] if remaining
                                                 else None)
        self.Destroy()


def open_raman_window(window):
    """Open (or raise) the full Raman Analysis window."""
    for existing in list(getattr(window, '_raman_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    RamanAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = RamanAnalysisWindow(window)
    frame.Show()
    return frame


def open_raman_section(window, key):
    """Open one Raman tab as its own window."""
    for existing in list(getattr(window, '_raman_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = RamanAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
