# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/FTIR_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/FTIR_Analysis.py
"""
FTIR Analysis tool.

Operates on FTIR sheets (sheet name starting with 'FTIR') shown in the main
plot.  Five tabs:

  Data & Metadata   ordinate detection/confirmation, unit conversion,
                    measurement metadata (mode, atmosphere, ATR crystal ...)
  Processing        the non-destructive pipeline: raw spectrum, spike
                    removal, atmospheric correction, ATR correction,
                    baseline, smoothing, normalisation, processed spectrum -
                    each independently switchable, with Auto Clean presets,
                    reset and a processing history
  Bands             band detection (intensity or 2nd derivative) with ranked
                    candidate assignments, confidences and artefact risk
  Band Library      the searchable IR correlation table
  Reference Spectra bundled JCAMP-DX library + NIST WebBook fetch

Nothing is destructive: the pristine spectrum lives in ``FTIR_Raw`` and what
the plot shows is always the pipeline output, recomputed from raw.  Every
state change also goes through save_state() so Ctrl+Z works.
"""

import os
import re
import sys

import wx
import wx.grid
import numpy as np

from libraries.ToolsMenu import FTIR_Engine as engine
from libraries.ToolsMenu import FTIR_Assign as assign
from libraries.ToolsMenu.FTIR_Library import FTIR_BANDS

# Kept for backward compatibility with saved sheets / older imports
Y_UNIT_TRANSMITTANCE = engine.U_T_PCT
Y_UNIT_ABSORBANCE = engine.U_ABSORBANCE

KHERVE_GREEN = wx.Colour(79, 190, 159)
GREY = wx.Colour(110, 110, 110)
WARN_RED = wx.Colour(180, 40, 40)


def is_ftir_sheet(sheet_name):
    return bool(sheet_name) and sheet_name.upper().startswith('FTIR')


# ---------------------------------------------------------------------------
# Ordinate confirmation
# ---------------------------------------------------------------------------

class UnitConfirmDialog(wx.Dialog):
    """Ask the user what the imported ordinate actually is.

    Shown whenever automatic detection is not confident.  Guessing silently
    is what produced absorbances of -4.5 from single-beam intensity data.
    """

    def __init__(self, parent, sheet_name, guess, confidence, reason,
                 y_values):
        super().__init__(parent, title="Confirm the FTIR ordinate",
                         size=(520, 400))
        vbox = wx.BoxSizer(wx.VERTICAL)

        head = wx.StaticText(self, label=f"Sheet '{sheet_name}'")
        font = head.GetFont()
        font.SetWeight(wx.FONTWEIGHT_BOLD)
        head.SetFont(font)
        vbox.Add(head, 0, wx.ALL, 10)

        y = np.asarray(y_values, dtype=float)
        y = y[np.isfinite(y)]
        stats = (f"{y.size} points, values from {np.min(y):.4g} to "
                 f"{np.max(y):.4g} (median {np.median(y):.4g})"
                 if y.size else "no finite values")
        vbox.Add(wx.StaticText(self, label=stats), 0, wx.LEFT | wx.RIGHT, 10)

        info = wx.StaticText(self, label=f"Best guess: {guess}\n"
                                         f"Confidence: {confidence:.0%}\n"
                                         f"{reason}")
        info.Wrap(480)
        info.SetForegroundColour(GREY)
        vbox.Add(info, 0, wx.ALL, 10)

        vbox.Add(wx.StaticText(self, label="The data in this sheet are:"),
                 0, wx.LEFT | wx.TOP, 10)
        self.choice = wx.Choice(self, choices=list(engine.ALL_UNITS))
        self.choice.SetStringSelection(guess)
        self.choice.Bind(wx.EVT_CHOICE, self.on_choice)
        vbox.Add(self.choice, 0, wx.EXPAND | wx.ALL, 10)

        self.desc = wx.StaticText(self, label=engine.UNIT_DESCRIPTIONS[guess])
        self.desc.Wrap(480)
        self.desc.SetForegroundColour(GREY)
        vbox.Add(self.desc, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        vbox.AddStretchSpacer()
        btns = self.CreateStdDialogButtonSizer(wx.OK | wx.CANCEL)
        vbox.Add(btns, 0, wx.ALIGN_RIGHT | wx.ALL, 10)
        self.SetSizer(vbox)

    def on_choice(self, event):
        unit = self.choice.GetStringSelection()
        self.desc.SetLabel(engine.UNIT_DESCRIPTIONS.get(unit, ""))
        self.desc.Wrap(480)
        self.Layout()

    def unit(self):
        return self.choice.GetStringSelection()


class StepSettingsDialog(wx.Dialog):
    """Advanced settings for one pipeline step (ALS lambda, S-G window ...)."""

    _FIELDS = {
        engine.STEP_DESPIKE: (
            ("threshold", "Spike threshold (sigma)", "float"),
            ("width", "Median filter width (points)", "int")),
        engine.STEP_ATMOSPHERIC: (
            ("h2o", "Correct water vapour", "bool"),
            ("co2", "Correct CO2", "bool")),
        engine.STEP_ATR: (
            ("crystal", "ATR crystal", list(engine.ATR_CRYSTALS)),
            ("angle", "Incident angle (deg)", "float"),
            ("n_sample", "Sample refractive index", "float")),
        engine.STEP_BASELINE: (
            ("method", "Method", list(engine.BASELINE_METHODS)),
            ("lam", "ALS lambda (smoothness)", "float"),
            ("p", "ALS asymmetry p", "float"),
            ("order", "Polynomial order", "int")),
        engine.STEP_SMOOTH: (
            ("window", "Savitzky-Golay window (points, odd)", "int"),
            ("order", "Polynomial order", "int")),
        engine.STEP_NORMALISE: (
            ("mode", "Mode", list(engine.NORMALISE_MODES)),),
    }

    def __init__(self, parent, step_id, params):
        super().__init__(parent,
                         title=f"{engine.STEP_LABELS[step_id]} - settings",
                         size=(420, 300))
        self.step_id = step_id
        self.params = dict(params)
        self.controls = {}

        grid = wx.FlexGridSizer(0, 2, 8, 10)
        grid.AddGrowableCol(1, 1)
        for key, label, kind in self._FIELDS.get(step_id, ()):
            grid.Add(wx.StaticText(self, label=label), 0,
                     wx.ALIGN_CENTER_VERTICAL)
            value = self.params.get(key)
            if kind == "bool":
                ctrl = wx.CheckBox(self)
                ctrl.SetValue(bool(value))
            elif isinstance(kind, list):
                ctrl = wx.Choice(self, choices=kind)
                ctrl.SetStringSelection(str(value) if str(value) in kind
                                        else kind[0])
            else:
                ctrl = wx.TextCtrl(self, value=f"{value}")
            self.controls[key] = (ctrl, kind)
            grid.Add(ctrl, 1, wx.EXPAND)

        vbox = wx.BoxSizer(wx.VERTICAL)
        vbox.Add(grid, 1, wx.EXPAND | wx.ALL, 12)
        vbox.Add(self.CreateStdDialogButtonSizer(wx.OK | wx.CANCEL), 0,
                 wx.ALIGN_RIGHT | wx.ALL, 10)
        self.SetSizer(vbox)

    def values(self):
        out = dict(self.params)
        for key, (ctrl, kind) in self.controls.items():
            if kind == "bool":
                out[key] = ctrl.GetValue()
            elif isinstance(kind, list):
                out[key] = ctrl.GetStringSelection()
            elif kind == "int":
                try:
                    out[key] = int(float(ctrl.GetValue()))
                except ValueError:
                    pass
            else:
                try:
                    out[key] = float(ctrl.GetValue())
                except ValueError:
                    pass
        return out


# ---------------------------------------------------------------------------
# Tool window
# ---------------------------------------------------------------------------

class FTIRAnalysisWindow(wx.Frame):
    # (section key, tab title, builder-method name), in notebook order.
    SECTIONS = (
        ('data', "Data & Metadata", '_build_data_tab'),
        ('processing', "Processing", '_build_processing_tab'),
        ('bands', "Bands", '_build_bands_tab'),
        ('library', "Band Library", '_build_library_tab'),
        ('reference', "Reference Spectra", '_build_reference_tab'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            title = f"FTIR {self.SECTION_TITLES[self._section_keys[0]]}"
            size = (480, 680)
        else:
            title = "FTIR Analysis"
            size = (720, 760)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent

        self.detected_peaks = []
        self._loading = False

        self.notebook = wx.Notebook(self)
        # Build EVERY tab whatever this window shows: the tabs share the sheet
        # selector, the metadata controls and the detected-peaks list, so a
        # single-tab pop-out must still create all panels — only the requested
        # pages are added, the rest hidden (the SQUID approach).
        builders = {k: b for k, _t, b in self.SECTIONS}
        self._panels = {k: getattr(self, builders[k])(self.notebook) for k in keys}
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

        if single:
            self.Fit()
            w, h = self.GetSize()
            w, h = max(w, 360), max(h, 460)
            self.SetSize((w, h))
            self.SetMinSize((w, 400))
        else:
            self.SetMinSize((660, 620))
        self.CentreOnParent()

        if not hasattr(parent, '_ftir_windows'):
            parent._ftir_windows = []
        parent._ftir_windows.append(self)
        parent.ftir_analysis_window = self

    # =====================================================================
    # Tab 1 - Data & Metadata
    # =====================================================================
    def _build_data_tab(self, notebook):
        panel = wx.ScrolledWindow(notebook)
        panel.SetScrollRate(0, 10)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "FTIR Sheet")
        self.sheet_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.sheet_combo.Bind(wx.EVT_COMBOBOX, self.on_sheet_selected)
        refresh_btn = wx.Button(panel, label="Refresh")
        refresh_btn.Bind(wx.EVT_BUTTON, lambda evt: (self.refresh_sheet_list(),
                                                     self.load_sheet_into_ui()))
        sheet_box.Add(self.sheet_combo, 1, wx.ALL | wx.EXPAND, 5)
        sheet_box.Add(refresh_btn, 0, wx.ALL, 5)
        vbox.Add(sheet_box, 0, wx.EXPAND | wx.ALL, 5)

        # --- ordinate -------------------------------------------------------
        unit_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Ordinate (Y axis)")
        grid = wx.FlexGridSizer(0, 3, 6, 8)
        grid.AddGrowableCol(1, 1)

        grid.Add(wx.StaticText(panel, label="Data in the file are:"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.input_unit_choice = wx.Choice(panel, choices=list(engine.ALL_UNITS))
        self.input_unit_choice.Bind(wx.EVT_CHOICE, self.on_input_unit_changed)
        self.input_unit_choice.SetToolTip(
            "The physical meaning of the numbers as they were imported. "
            "Everything else is derived from this - get it right first.")
        grid.Add(self.input_unit_choice, 1, wx.EXPAND)
        detect_btn = wx.Button(panel, label="Auto-detect")
        detect_btn.Bind(wx.EVT_BUTTON, self.on_detect_unit)
        grid.Add(detect_btn, 0)

        grid.Add(wx.StaticText(panel, label="Display as:"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.display_unit_choice = wx.Choice(panel, choices=list(engine.ALL_UNITS))
        self.display_unit_choice.Bind(wx.EVT_CHOICE,
                                      self.on_display_unit_changed)
        grid.Add(self.display_unit_choice, 1, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label=""), 0)
        unit_box.Add(grid, 0, wx.EXPAND | wx.ALL, 5)

        self.unit_note = wx.StaticText(panel, label="")
        self.unit_note.SetForegroundColour(GREY)
        unit_box.Add(self.unit_note, 0, wx.ALL, 5)

        self.warning_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_NO_VSCROLL,
            size=(-1, 78))
        self.warning_text.SetForegroundColour(WARN_RED)
        unit_box.Add(self.warning_text, 0, wx.EXPAND | wx.ALL, 5)
        vbox.Add(unit_box, 0, wx.EXPAND | wx.ALL, 5)

        # --- metadata -------------------------------------------------------
        meta_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Measurement metadata")
        mgrid = wx.FlexGridSizer(0, 4, 6, 8)
        mgrid.AddGrowableCol(1, 1)
        mgrid.AddGrowableCol(3, 1)
        self.meta_ctrls = {}

        def add_choice(label, key, choices):
            mgrid.Add(wx.StaticText(panel, label=label), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
            ctrl = wx.Choice(panel, choices=list(choices))
            ctrl.SetSelection(0)
            ctrl.Bind(wx.EVT_CHOICE, self.on_metadata_changed)
            self.meta_ctrls[key] = ctrl
            mgrid.Add(ctrl, 1, wx.EXPAND)

        def add_text(label, key, hint=""):
            mgrid.Add(wx.StaticText(panel, label=label), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
            ctrl = wx.TextCtrl(panel)
            if hint:
                ctrl.SetHint(hint)
            ctrl.Bind(wx.EVT_KILL_FOCUS, self.on_metadata_changed)
            self.meta_ctrls[key] = ctrl
            mgrid.Add(ctrl, 1, wx.EXPAND)

        add_choice("Material type:", 'material_type', assign.MATERIAL_TYPES)
        add_text("Expected elements:", 'elements', "e.g. Ba, Co, Fe, Y, O")
        add_choice("Measurement mode:", 'mode', assign.MEASUREMENT_MODES)
        add_choice("Physical state:", 'state', assign.PHYSICAL_STATES)
        add_choice("Atmosphere:", 'atmosphere', assign.ATMOSPHERES)
        add_text("Resolution (cm-1):", 'resolution', "e.g. 4")
        add_choice("ATR crystal:", 'atr_crystal', assign.ATR_CRYSTAL_CHOICES)
        add_text("Incident angle (deg):", 'atr_angle', "45")
        add_text("Temperature:", 'temperature', "e.g. 450 C")
        add_text("Time / step:", 'time', "e.g. 16 h")
        add_text("Spectral range:", 'range', "auto")
        add_text("Notes:", 'notes', "")

        meta_box.Add(mgrid, 0, wx.EXPAND | wx.ALL, 5)
        meta_note = wx.StaticText(panel, label=(
            "Metadata drive the band assignment filter, the ATR correction "
            "and the reference-matching compatibility check."))
        meta_note.SetForegroundColour(GREY)
        meta_box.Add(meta_note, 0, wx.ALL, 5)
        vbox.Add(meta_box, 0, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # =====================================================================
    # Tab 2 - Processing
    # =====================================================================
    def _build_processing_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        auto_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Auto Clean")
        for preset in ("Gentle", "Standard", "Strong"):
            btn = wx.Button(panel, label=preset)
            btn.SetToolTip(self._preset_tip(preset))
            if preset == "Standard":
                btn.SetBackgroundColour(KHERVE_GREEN)
            btn.Bind(wx.EVT_BUTTON, lambda evt, p=preset: self.on_auto_clean(p))
            auto_box.Add(btn, 1, wx.ALL | wx.EXPAND, 5)
        reset_btn = wx.Button(panel, label="Reset to raw")
        reset_btn.Bind(wx.EVT_BUTTON, self.on_reset)
        auto_box.Add(reset_btn, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(auto_box, 0, wx.EXPAND | wx.ALL, 5)

        step_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "Processing steps (applied in this order)")
        self.step_list = wx.CheckListBox(
            panel, choices=[engine.STEP_LABELS[s] for s in engine.STEP_ORDER])
        self.step_list.Bind(wx.EVT_CHECKLISTBOX, self.on_step_toggled)
        self.step_list.Bind(wx.EVT_LISTBOX_DCLICK,
                            lambda evt: self.on_step_settings(None))
        step_box.Add(self.step_list, 1, wx.EXPAND | wx.ALL, 5)

        step_btns = wx.BoxSizer(wx.HORIZONTAL)
        adv_btn = wx.Button(panel, label="Advanced settings...")
        adv_btn.Bind(wx.EVT_BUTTON, self.on_step_settings)
        step_btns.Add(adv_btn, 0, wx.ALL, 5)
        self.show_raw_cb = wx.CheckBox(panel, label="Overlay the raw spectrum")
        self.show_raw_cb.Bind(wx.EVT_CHECKBOX, lambda evt: self.apply_pipeline())
        step_btns.Add(self.show_raw_cb, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 15)
        self.show_curves_cb = wx.CheckBox(
            panel, label="Overlay baseline / atmospheric curves")
        self.show_curves_cb.Bind(wx.EVT_CHECKBOX,
                                 lambda evt: self.apply_pipeline())
        step_btns.Add(self.show_curves_cb, 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 15)
        step_box.Add(step_btns, 0)
        vbox.Add(step_box, 1, wx.EXPAND | wx.ALL, 5)

        hist_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Processing history")
        self.history_text = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY)
        hist_box.Add(self.history_text, 1, wx.EXPAND | wx.ALL, 5)
        hist_note = wx.StaticText(panel, label=(
            "The raw spectrum is never modified. Every step is stored with "
            "the project and can be switched off at any time; Ctrl+Z undoes "
            "the last change."))
        hist_note.SetForegroundColour(GREY)
        hist_box.Add(hist_note, 0, wx.ALL, 5)
        vbox.Add(hist_box, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    @staticmethod
    def _preset_tip(preset):
        steps = engine.AUTO_CLEAN_PRESETS.get(preset, [])
        names = ", ".join(engine.STEP_LABELS[sid] for sid, _ in steps)
        return f"{preset}: {names}"

    # =====================================================================
    # Tab 3 - Bands
    # =====================================================================
    def _build_bands_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        param_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "Band Detection && Assignment")
        row1 = wx.BoxSizer(wx.HORIZONTAL)
        row1.Add(wx.StaticText(panel, label="Method:"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.method_choice = wx.Choice(panel,
                                       choices=list(engine.DETECTION_METHODS))
        self.method_choice.SetSelection(0)
        row1.Add(self.method_choice, 0, wx.ALL, 5)
        row1.Add(wx.StaticText(panel, label="Prominence (%):"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 10)
        self.prominence_ctrl = wx.SpinCtrlDouble(panel, min=0.1, max=100.0,
                                                 initial=5.0, inc=0.5,
                                                 size=(80, -1))
        row1.Add(self.prominence_ctrl, 0, wx.ALL, 5)
        row1.Add(wx.StaticText(panel, label="Min distance (cm-1):"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 10)
        self.distance_ctrl = wx.SpinCtrlDouble(panel, min=1, max=500,
                                               initial=25, inc=5, size=(80, -1))
        row1.Add(self.distance_ctrl, 0, wx.ALL, 5)
        param_box.Add(row1, 0, wx.EXPAND)

        row2 = wx.BoxSizer(wx.HORIZONTAL)
        row2.Add(wx.StaticText(panel, label="Assignment tolerance (cm-1):"), 0,
                 wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.tolerance_ctrl = wx.SpinCtrlDouble(panel, min=0, max=100,
                                                initial=15, inc=5, size=(80, -1))
        row2.Add(self.tolerance_ctrl, 0, wx.ALL, 5)
        find_btn = wx.Button(panel, label="Find Bands")
        find_btn.SetBackgroundColour(KHERVE_GREEN)
        find_btn.Bind(wx.EVT_BUTTON, self.on_find_peaks)
        reassign_btn = wx.Button(panel, label="Re-assign")
        reassign_btn.SetToolTip("Re-run the assignment with the current "
                                "metadata. Locked rows are kept.")
        reassign_btn.Bind(wx.EVT_BUTTON, self.on_reassign)
        row2.AddStretchSpacer()
        row2.Add(reassign_btn, 0, wx.ALL, 5)
        row2.Add(find_btn, 0, wx.ALL, 5)
        param_box.Add(row2, 0, wx.EXPAND)
        vbox.Add(param_box, 0, wx.EXPAND | wx.ALL, 5)

        self.peaks_grid = wx.grid.Grid(panel)
        self.peaks_grid.CreateGrid(0, 10)
        for col, (label, width) in enumerate((
                ("Peak (cm-1)", 85), ("Height", 70), ("Rel. %", 55),
                ("FWHM", 60), ("Candidate assignment", 250),
                ("Confidence", 80), ("d(nu)", 55), ("Expected shape", 140),
                ("Artifact risk", 85), ("Lock", 45))):
            self.peaks_grid.SetColLabelValue(col, label)
            self.peaks_grid.SetColSize(col, width)
        self.peaks_grid.EnableEditing(True)
        self.peaks_grid.SetRowLabelSize(30)
        self.peaks_grid.Bind(wx.grid.EVT_GRID_SELECT_CELL, self.on_peak_row)
        self.peaks_grid.Bind(wx.grid.EVT_GRID_CELL_CHANGED, self.on_peak_edited)
        vbox.Add(self.peaks_grid, 1, wx.EXPAND | wx.ALL, 5)

        cand_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "Candidates for the selected band "
                                     "(double-click to accept and lock)")
        self.cand_list = wx.ListBox(panel)
        self.cand_list.Bind(wx.EVT_LISTBOX_DCLICK, self.on_accept_candidate)
        self.cand_list.Bind(wx.EVT_LISTBOX, self.on_candidate_selected)
        cand_box.Add(self.cand_list, 1, wx.EXPAND | wx.ALL, 5)
        self.cand_detail = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY, size=(-1, 62))
        cand_box.Add(self.cand_detail, 0, wx.EXPAND | wx.ALL, 5)
        vbox.Add(cand_box, 1, wx.EXPAND | wx.ALL, 5)

        btn_sizer = wx.BoxSizer(wx.HORIZONTAL)
        label_btn = wx.Button(panel, label="Label Bands on Plot")
        label_btn.Bind(wx.EVT_BUTTON, self.on_label_peaks)
        clear_btn = wx.Button(panel, label="Clear FTIR Labels")
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_labels)
        btn_sizer.Add(label_btn, 0, wx.ALL, 5)
        btn_sizer.Add(clear_btn, 0, wx.ALL, 5)
        vbox.Add(btn_sizer, 0)

        panel.SetSizer(vbox)
        return panel

    # =====================================================================
    # Tab 4 - Band library
    # =====================================================================
    def _build_library_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        search_sizer = wx.BoxSizer(wx.HORIZONTAL)
        search_sizer.Add(wx.StaticText(panel, label="Search:"), 0,
                         wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.search_ctrl = wx.TextCtrl(panel)
        self.search_ctrl.Bind(wx.EVT_TEXT, self.on_search_library)
        search_sizer.Add(self.search_ctrl, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(search_sizer, 0, wx.EXPAND)

        self.library_grid = wx.grid.Grid(panel)
        self.library_grid.CreateGrid(0, 5)
        for col, (label, width) in enumerate((
                ("Range (cm-1)", 100), ("Vibration", 150),
                ("Intensity / Shape", 130), ("Assignment", 260),
                ("Source", 220))):
            self.library_grid.SetColLabelValue(col, label)
            self.library_grid.SetColSize(col, width)
        self.library_grid.EnableEditing(False)
        self.library_grid.SetRowLabelSize(30)
        vbox.Add(self.library_grid, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        self.populate_library_grid()
        return panel

    # =====================================================================
    # Tab 5 - Reference spectra
    # =====================================================================
    def _build_reference_tab(self, notebook):
        """Reference-spectra sources, each appended as FTIRn sheets so they can
        be overlaid on measured data:

          * the user's JCAMP-DX (.jdx) folder,
          * Nicolet / Thermo OMNIC (.lbd) search libraries browsed in place
            (they are shipped with the instrument and far too large to copy),
          * the NIST Chemistry WebBook.
        """
        panel = wx.ScrolledWindow(notebook)
        panel.SetScrollRate(0, 12)
        vbox = wx.BoxSizer(wx.VERTICAL)

        lib_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                    "FTIR Library (.jdx files)")
        self.ref_listbox = wx.ListBox(panel, style=wx.LB_SINGLE,
                                      size=(-1, 110))
        self.ref_listbox.Bind(wx.EVT_LISTBOX_DCLICK,
                              lambda evt: self.on_load_reference())
        lib_box.Add(self.ref_listbox, 1, wx.EXPAND | wx.ALL, 5)

        lib_btns = wx.BoxSizer(wx.HORIZONTAL)
        load_ref_btn = wx.Button(panel, label="Add to Project")
        load_ref_btn.SetBackgroundColour(KHERVE_GREEN)
        load_ref_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_load_reference())
        refresh_ref_btn = wx.Button(panel, label="Refresh")
        refresh_ref_btn.Bind(wx.EVT_BUTTON,
                             lambda evt: self.refresh_reference_list())
        open_folder_btn = wx.Button(panel, label="Open Folder")
        open_folder_btn.Bind(wx.EVT_BUTTON, self.on_open_library_folder)
        lib_btns.Add(load_ref_btn, 0, wx.ALL, 5)
        lib_btns.Add(refresh_ref_btn, 0, wx.ALL, 5)
        lib_btns.Add(open_folder_btn, 0, wx.ALL, 5)
        lib_box.Add(lib_btns, 0)
        vbox.Add(lib_box, 1, wx.EXPAND | wx.ALL, 5)

        vbox.Add(self._build_online_box(panel), 2, wx.EXPAND | wx.ALL, 5)
        vbox.Add(self._build_nicolet_box(panel), 2, wx.EXPAND | wx.ALL, 5)

        nist_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "NIST Chemistry WebBook")
        fetch_sizer = wx.BoxSizer(wx.HORIZONTAL)
        fetch_sizer.Add(wx.StaticText(panel, label="Name or CAS:"), 0,
                        wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.nist_query = wx.TextCtrl(panel, style=wx.TE_PROCESS_ENTER)
        self.nist_query.Bind(wx.EVT_TEXT_ENTER, self.on_fetch_nist)
        fetch_sizer.Add(self.nist_query, 1, wx.ALL | wx.EXPAND, 5)
        fetch_btn = wx.Button(panel, label="Fetch from NIST")
        fetch_btn.Bind(wx.EVT_BUTTON, self.on_fetch_nist)
        fetch_sizer.Add(fetch_btn, 0, wx.ALL, 5)
        nist_box.Add(fetch_sizer, 0, wx.EXPAND)

        self.nist_save_copy = wx.CheckBox(
            panel, label="Save a copy to my FTIR Library folder")
        self.nist_save_copy.SetValue(True)
        nist_box.Add(self.nist_save_copy, 0, wx.LEFT | wx.BOTTOM, 8)

        note = wx.StaticText(panel, label=(
            "NIST spectra are mostly gas-phase; band positions match ATR data "
            "but exact positions/intensities may differ. Check the "
            "measurement-mode compatibility warning before comparing.\n"
            "NIST WebBook data (c) U.S. Secretary of Commerce - fetched for "
            "your own use, not redistributed."))
        note.SetForegroundColour(GREY)
        font = note.GetFont()
        font.SetPointSize(max(7, font.GetPointSize() - 1))
        note.SetFont(font)
        nist_box.Add(note, 0, wx.ALL, 5)
        vbox.Add(nist_box, 0, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        self.refresh_reference_list()
        self.refresh_nicolet_libraries()
        self.load_online_index_cached()
        return panel

    def _build_online_box(self, panel):
        """Online (GitHub) public-domain reference library: fetch a name index,
        filter, and pull individual spectra on demand."""
        box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                "Online Reference Library (public domain, GitHub)")

        src_row = wx.BoxSizer(wx.HORIZONTAL)
        src_row.Add(wx.StaticText(panel, label="Source:"), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.online_src_lbl = wx.StaticText(panel, label="",
                                            style=wx.ST_ELLIPSIZE_MIDDLE)
        self.online_src_lbl.SetForegroundColour(GREY)
        src_row.Add(self.online_src_lbl, 1,
                    wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 6)
        src_btn = wx.Button(panel, label="Source…")
        src_btn.Bind(wx.EVT_BUTTON, self.on_change_online_source)
        src_row.Add(src_btn, 0, wx.RIGHT, 5)
        update_btn = wx.Button(panel, label="Fetch / Update")
        update_btn.Bind(wx.EVT_BUTTON, self.on_refresh_online)
        src_row.Add(update_btn, 0, wx.RIGHT, 5)
        box.Add(src_row, 0, wx.EXPAND | wx.TOP | wx.BOTTOM, 4)

        filt_row = wx.BoxSizer(wx.HORIZONTAL)
        filt_row.Add(wx.StaticText(panel, label="Filter:"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.online_filter = wx.TextCtrl(panel)
        self.online_filter.Bind(wx.EVT_TEXT, self.on_online_filter)
        filt_row.Add(self.online_filter, 1,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 6)
        box.Add(filt_row, 0, wx.EXPAND | wx.BOTTOM, 4)

        self.online_listbox = wx.ListBox(panel, style=wx.LB_EXTENDED,
                                         size=(-1, 150))
        self.online_listbox.Bind(wx.EVT_LISTBOX_DCLICK,
                                 lambda evt: self.on_add_online_reference())
        box.Add(self.online_listbox, 1, wx.EXPAND | wx.ALL, 5)

        add_row = wx.BoxSizer(wx.HORIZONTAL)
        add_btn = wx.Button(panel, label="Add Selected to Project")
        add_btn.SetBackgroundColour(KHERVE_GREEN)
        add_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_add_online_reference())
        add_row.Add(add_btn, 0, wx.ALL, 5)
        self.online_count_lbl = wx.StaticText(panel, label="")
        self.online_count_lbl.SetForegroundColour(GREY)
        add_row.Add(self.online_count_lbl, 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        box.Add(add_row, 0)

        self._online_index = []      # list of manifest dicts
        self._online_visible = []    # listbox row -> index into _online_index
        return box

    def _build_nicolet_box(self, panel):
        """The Nicolet / OMNIC library browser: pick a folder, pick a library,
        filter by compound name, add the chosen spectra as references."""
        box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                "Nicolet / OMNIC Libraries (.lbd, browsed in place)")

        folder_row = wx.BoxSizer(wx.HORIZONTAL)
        folder_row.Add(wx.StaticText(panel, label="Folder:"), 0,
                       wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.nic_folder_lbl = wx.StaticText(panel, label="(none chosen)",
                                            style=wx.ST_ELLIPSIZE_MIDDLE)
        self.nic_folder_lbl.SetForegroundColour(GREY)
        folder_row.Add(self.nic_folder_lbl, 1,
                       wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 6)
        choose_btn = wx.Button(panel, label="Choose…")
        choose_btn.Bind(wx.EVT_BUTTON, self.on_choose_nicolet_folder)
        folder_row.Add(choose_btn, 0, wx.RIGHT, 5)
        box.Add(folder_row, 0, wx.EXPAND | wx.TOP | wx.BOTTOM, 4)

        lib_row = wx.BoxSizer(wx.HORIZONTAL)
        lib_row.Add(wx.StaticText(panel, label="Library:"), 0,
                    wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.nic_lib_choice = wx.Choice(panel)
        self.nic_lib_choice.Bind(wx.EVT_CHOICE, self.on_nicolet_library_selected)
        lib_row.Add(self.nic_lib_choice, 1,
                    wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 6)
        box.Add(lib_row, 0, wx.EXPAND | wx.BOTTOM, 4)

        filt_row = wx.BoxSizer(wx.HORIZONTAL)
        filt_row.Add(wx.StaticText(panel, label="Filter:"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.nic_filter = wx.TextCtrl(panel)
        self.nic_filter.Bind(wx.EVT_TEXT, self.on_nicolet_filter)
        filt_row.Add(self.nic_filter, 1,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT | wx.RIGHT, 6)
        box.Add(filt_row, 0, wx.EXPAND | wx.BOTTOM, 4)

        self.nic_listbox = wx.ListBox(panel, style=wx.LB_EXTENDED,
                                      size=(-1, 150))
        self.nic_listbox.Bind(wx.EVT_LISTBOX_DCLICK,
                              lambda evt: self.on_add_nicolet_reference())
        box.Add(self.nic_listbox, 1, wx.EXPAND | wx.ALL, 5)

        add_row = wx.BoxSizer(wx.HORIZONTAL)
        add_btn = wx.Button(panel, label="Add Selected to Project")
        add_btn.SetBackgroundColour(KHERVE_GREEN)
        add_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_add_nicolet_reference())
        add_row.Add(add_btn, 0, wx.ALL, 5)
        self.nic_count_lbl = wx.StaticText(panel, label="")
        self.nic_count_lbl.SetForegroundColour(GREY)
        add_row.Add(self.nic_count_lbl, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        box.Add(add_row, 0)

        # State for the browser
        self._nicolet_libs = []       # list of header-info dicts (per library)
        self._nicolet_lib = None      # the fully-parsed, currently-selected lib
        self._nicolet_lib_path = None
        self._nicolet_labels = []     # [(spectrum_idx, label str)] for that lib
        self._nic_visible = []        # listbox row -> spectrum idx
        return box

    # =====================================================================
    # Sheet plumbing
    # =====================================================================
    def refresh_sheet_list(self):
        core_levels = self.parent.Data.get('Core levels', {})
        ftir_sheets = [name for name in core_levels if is_ftir_sheet(name)]
        current = self.sheet_combo.GetValue()
        self.sheet_combo.Set(ftir_sheets)
        active = self.parent.sheet_combobox.GetValue()
        if current in ftir_sheets:
            self.sheet_combo.SetValue(current)
        elif is_ftir_sheet(active):
            self.sheet_combo.SetValue(active)
        elif ftir_sheets:
            self.sheet_combo.SetValue(ftir_sheets[0])

    def get_sheet_data(self, complain=True):
        sheet_name = self.sheet_combo.GetValue()
        core_levels = self.parent.Data.get('Core levels', {})
        if not sheet_name or sheet_name not in core_levels:
            if complain:
                self.parent.show_popup_message2(
                    "Error", "No FTIR sheet selected.\n"
                             "Import FTIR data first (File > Import > FTIR).")
            return None, None
        return sheet_name, core_levels[sheet_name]

    def _select_sheet_on_main(self, sheet_name, reset_limits=True):
        if self.parent.sheet_combobox.GetValue() != sheet_name:
            self.parent.sheet_combobox.SetValue(sheet_name)
        if reset_limits:
            self.parent.plot_config.plot_limits.pop(sheet_name, None)
            if hasattr(self.parent.plot_config, 'original_limits'):
                self.parent.plot_config.original_limits.pop(sheet_name, None)
        self.parent.plot_config.update_plot_limits(self.parent, sheet_name)
        self.parent.clear_and_replot()

    def on_sheet_selected(self, event):
        sheet_name = self.sheet_combo.GetValue()
        if sheet_name and sheet_name in self.parent.Data.get('Core levels', {}):
            from libraries.Sheet_Operations import on_sheet_selected
            self.parent.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(self.parent, sheet_name)
        self.load_sheet_into_ui()

    # --------------------------------------------------------- UI <-> sheet --
    def load_sheet_into_ui(self):
        """Pull unit, metadata and step state out of the sheet into the UI."""
        sheet_name, sheet_data = self.get_sheet_data(complain=False)
        if sheet_data is None:
            return
        self._loading = True
        try:
            raw = engine.ensure_raw(sheet_data)
            meta = self._metadata(sheet_data)

            self.input_unit_choice.SetStringSelection(raw['unit'])
            display = sheet_data.get('FTIR_Y_Unit') or raw['unit']
            if display not in engine.ALL_UNITS:
                display = raw['unit']
            self.display_unit_choice.SetStringSelection(display)

            for key, ctrl in self.meta_ctrls.items():
                value = meta.get(key, "")
                if isinstance(ctrl, wx.Choice):
                    if value in ctrl.GetStrings():
                        ctrl.SetStringSelection(value)
                    else:
                        ctrl.SetSelection(0)
                else:
                    ctrl.SetValue(str(value))

            steps = engine.get_steps(sheet_data)
            for i, step in enumerate(steps):
                self.step_list.Check(i, bool(step['enabled']))

            self.show_raw_cb.SetValue(bool(sheet_data.get('FTIR_Show_Raw')))
            self.show_curves_cb.SetValue(bool(sheet_data.get('FTIR_Show_Curves')))

            self.detected_peaks = list(sheet_data.get('FTIR_Bands') or [])
            self.populate_peaks_grid()
            self._update_unit_note(sheet_data)
            self._update_history(sheet_data)
        finally:
            self._loading = False

    def _metadata(self, sheet_data):
        meta = sheet_data.get('FTIR_Meta')
        if not isinstance(meta, dict):
            meta = assign.default_metadata()
            # Seed what we can from the imported spectrum
            x = np.asarray(sheet_data.get('B.E.', []), dtype=float)
            if x.size:
                meta['range'] = f"{np.min(x):.0f}-{np.max(x):.0f} cm-1"
            sheet_data['FTIR_Meta'] = meta
        for key, value in assign.default_metadata().items():
            meta.setdefault(key, value)
        return meta

    def _update_unit_note(self, sheet_data):
        raw = engine.ensure_raw(sheet_data)
        unit = raw['unit']
        self.unit_note.SetLabel(engine.UNIT_DESCRIPTIONS.get(unit, ""))
        warnings = list(engine.validate_values(raw['y'], unit))
        warnings.extend(sheet_data.get('FTIR_Warnings') or [])
        mode = self._metadata(sheet_data).get('mode', 'Unknown')
        allowed = engine.MODE_UNITS.get(mode, engine.ALL_UNITS)
        display = sheet_data.get('FTIR_Y_Unit')
        if display and display not in allowed:
            warnings.append(
                f"{display} is not a conversion normally defined for {mode} "
                f"data (allowed: {', '.join(allowed)}).")
        seen, unique = set(), []
        for w in warnings:
            if w not in seen:
                seen.add(w)
                unique.append(w)
        self.warning_text.SetValue("\n".join(f"- {w}" for w in unique))

    def _update_history(self, sheet_data):
        lines = []
        raw = engine.ensure_raw(sheet_data)
        lines.append(f"Raw spectrum: {len(raw['y'])} points, {raw['unit']}")
        for note in sheet_data.get('FTIR_History') or []:
            lines.append(f"  {note}")
        display = sheet_data.get('FTIR_Y_Unit')
        lines.append(f"Processed spectrum: {display}")
        self.history_text.SetValue("\n".join(lines))

    # =====================================================================
    # Ordinate handling
    # =====================================================================
    def on_detect_unit(self, event):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        raw = engine.ensure_raw(sheet_data)
        guess, confidence, reason = engine.detect_y_unit(raw['y'])

        if confidence >= 0.8:
            msg = (f"Detected: {guess} (confidence {confidence:.0%})\n\n"
                   f"{reason}\n\nApply this?")
            if wx.MessageBox(msg, "Ordinate detection",
                             wx.YES_NO | wx.ICON_QUESTION, self) != wx.YES:
                return
            chosen = guess
        else:
            dlg = UnitConfirmDialog(self, sheet_name, guess, confidence,
                                    reason, raw['y'])
            try:
                if dlg.ShowModal() != wx.ID_OK:
                    return
                chosen = dlg.unit()
            finally:
                dlg.Destroy()

        self._set_input_unit(sheet_name, sheet_data, chosen)

    def on_input_unit_changed(self, event):
        if self._loading:
            return
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        self._set_input_unit(sheet_name, sheet_data,
                             self.input_unit_choice.GetStringSelection())

    def _set_input_unit(self, sheet_name, sheet_data, unit):
        """Re-declare what the raw numbers mean, and rebuild everything."""
        from libraries.FileMenu.Save import save_state
        save_state(self.parent)
        raw = engine.ensure_raw(sheet_data)
        raw['unit'] = unit
        sheet_data['FTIR_Input_Unit'] = unit
        # A display unit that is no longer reachable falls back to the input
        display = sheet_data.get('FTIR_Y_Unit')
        if unit == engine.U_ARB or display not in engine.ALL_UNITS:
            sheet_data['FTIR_Y_Unit'] = unit
        self._loading = True
        self.input_unit_choice.SetStringSelection(unit)
        self.display_unit_choice.SetStringSelection(
            sheet_data.get('FTIR_Y_Unit', unit))
        self._loading = False
        self.apply_pipeline(save=False)

    def on_display_unit_changed(self, event):
        if self._loading:
            return
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        target = self.display_unit_choice.GetStringSelection()
        raw = engine.ensure_raw(sheet_data)

        if raw['unit'] == engine.U_ARB and target != engine.U_ARB:
            self.parent.show_popup_message2(
                "Conversion not possible",
                "The data are uncalibrated intensities, so there is no "
                "physical conversion to " + target + ".\n\n"
                "Set the correct input ordinate first (Auto-detect, or the "
                "'Data in the file are' list), or ratio the spectrum against "
                "its background outside KherveFitting.")
            self._loading = True
            self.display_unit_choice.SetStringSelection(raw['unit'])
            self._loading = False
            return

        mode = self._metadata(sheet_data).get('mode', 'Unknown')
        allowed = engine.MODE_UNITS.get(mode, engine.ALL_UNITS)
        if target not in allowed:
            msg = (f"{target} is not a conversion normally defined for {mode} "
                   f"measurements.\n\nAllowed for this mode: "
                   f"{', '.join(allowed)}.\n\nConvert anyway?")
            if wx.MessageBox(msg, "Unusual conversion",
                             wx.YES_NO | wx.ICON_WARNING, self) != wx.YES:
                self._loading = True
                self.display_unit_choice.SetStringSelection(
                    sheet_data.get('FTIR_Y_Unit', raw['unit']))
                self._loading = False
                return

        from libraries.FileMenu.Save import save_state
        save_state(self.parent)
        sheet_data['FTIR_Y_Unit'] = target
        # Band labels were positioned in the old ordinate
        labels = sheet_data.get('Labels')
        if labels:
            sheet_data['Labels'] = [ld for ld in labels
                                    if not ld.get('ftir_label')]
        self.apply_pipeline(save=False)

    # =====================================================================
    # Metadata
    # =====================================================================
    def on_metadata_changed(self, event):
        if isinstance(event, wx.FocusEvent):
            event.Skip()
        if self._loading:
            return
        sheet_name, sheet_data = self.get_sheet_data(complain=False)
        if sheet_data is None:
            return
        meta = self._metadata(sheet_data)
        changed = False
        for key, ctrl in self.meta_ctrls.items():
            value = (ctrl.GetStringSelection() if isinstance(ctrl, wx.Choice)
                     else ctrl.GetValue())
            if meta.get(key) != value:
                meta[key] = value
                changed = True
        if not changed:
            return
        sheet_data['FTIR_Meta'] = meta
        # The ATR step reads the crystal and angle from metadata
        for step in engine.get_steps(sheet_data):
            if step['id'] == engine.STEP_ATR:
                if meta.get('atr_crystal') in engine.ATR_CRYSTALS:
                    step['params']['crystal'] = meta['atr_crystal']
                try:
                    step['params']['angle'] = float(meta.get('atr_angle', 45))
                except (TypeError, ValueError):
                    pass
        self._update_unit_note(sheet_data)

    # =====================================================================
    # Processing
    # =====================================================================
    def on_step_toggled(self, event):
        if self._loading:
            return
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        steps = engine.get_steps(sheet_data)
        for i, step in enumerate(steps):
            step['enabled'] = self.step_list.IsChecked(i)
        self.apply_pipeline()

    def on_step_settings(self, event):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        index = self.step_list.GetSelection()
        if index == wx.NOT_FOUND:
            self.parent.show_popup_message2(
                "Information", "Select a processing step in the list first.")
            return
        step_id = engine.STEP_ORDER[index]
        steps = engine.get_steps(sheet_data)
        dlg = StepSettingsDialog(self, step_id, steps[index]['params'])
        try:
            if dlg.ShowModal() != wx.ID_OK:
                return
            steps[index]['params'] = dlg.values()
        finally:
            dlg.Destroy()
        if steps[index]['enabled']:
            self.apply_pipeline()

    def on_auto_clean(self, preset):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        raw = engine.ensure_raw(sheet_data)
        if raw['unit'] == engine.U_ARB:
            self.parent.show_popup_message2(
                "Set the ordinate first",
                "Auto Clean needs a calibrated ordinate. Use Auto-detect on "
                "the Data & Metadata tab, or set the input unit by hand.")
            return
        from libraries.FileMenu.Save import save_state
        save_state(self.parent)
        sheet_data['FTIR_Steps'] = engine.preset_steps(preset)
        meta = self._metadata(sheet_data)
        # Only add ATR correction when we know it is an ATR measurement
        if meta.get('mode') == 'ATR' and preset == 'Strong':
            for step in sheet_data['FTIR_Steps']:
                if step['id'] == engine.STEP_ATR:
                    step['enabled'] = True
                    if meta.get('atr_crystal') in engine.ATR_CRYSTALS:
                        step['params']['crystal'] = meta['atr_crystal']
        self._loading = True
        for i, step in enumerate(engine.get_steps(sheet_data)):
            self.step_list.Check(i, bool(step['enabled']))
        self._loading = False
        self.apply_pipeline(save=False)

    def on_reset(self, event):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        from libraries.FileMenu.Save import save_state
        save_state(self.parent)
        engine.reset_processing(sheet_data)
        sheet_data['FTIR_Overlays'] = []
        self._loading = True
        for i in range(self.step_list.GetCount()):
            self.step_list.Check(i, False)
        self._loading = False
        self.load_sheet_into_ui()
        self._select_sheet_on_main(sheet_name)

    def apply_pipeline(self, save=True):
        """Recompute the sheet from raw and redraw."""
        sheet_name, sheet_data = self.get_sheet_data(complain=False)
        if sheet_data is None:
            return None
        if save:
            from libraries.FileMenu.Save import save_state
            save_state(self.parent)

        sheet_data['FTIR_Show_Raw'] = bool(self.show_raw_cb.GetValue())
        sheet_data['FTIR_Show_Curves'] = bool(self.show_curves_cb.GetValue())

        result = engine.recompute(sheet_data)
        sheet_data['FTIR_Warnings'] = list(result['warnings'])
        self._build_overlays(sheet_data, result)

        self._update_unit_note(sheet_data)
        self._update_history(sheet_data)
        self._select_sheet_on_main(sheet_name)
        return result

    def _build_overlays(self, sheet_data, result):
        """Raw spectrum and diagnostic curves as separate plot layers."""
        overlays = []
        raw = engine.ensure_raw(sheet_data)
        display = sheet_data.get('FTIR_Y_Unit')

        if sheet_data.get('FTIR_Show_Raw'):
            try:
                raw_shown, _ = engine.convert(raw['y'], raw['unit'], display)
            except engine.ConversionError:
                raw_shown = np.asarray(raw['y'], dtype=float)
            overlays.append({'label': 'Raw spectrum', 'x': list(raw['x']),
                             'y': np.asarray(raw_shown, dtype=float).tolist(),
                             'color': '#9a9a9a', 'style': '-', 'width': 0.7,
                             'alpha': 0.8})

        if sheet_data.get('FTIR_Show_Curves'):
            if display == engine.U_ABSORBANCE:
                curve_styles = {'baseline': ('#c05c2a', '--', 'Baseline'),
                                'atmospheric': ('#2a6cc0', ':',
                                                'Atmospheric H2O / CO2')}
                for key, values in (sheet_data.get('FTIR_Curves') or {}).items():
                    color, style, label = curve_styles.get(
                        key, ('#777777', '--', key))
                    overlays.append({'label': label, 'x': list(raw['x']),
                                     'y': list(values), 'color': color,
                                     'style': style, 'width': 0.8,
                                     'alpha': 0.9})
            elif sheet_data.get('FTIR_Curves'):
                result['warnings'].append(
                    "Baseline / atmospheric curves are absorbance quantities "
                    "and are only drawn while the display unit is Absorbance.")

        sheet_data['FTIR_Overlays'] = overlays

    # =====================================================================
    # Band detection and assignment
    # =====================================================================
    def on_find_peaks(self, event):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return

        x = np.asarray(sheet_data['B.E.'], dtype=float)
        y = np.asarray(sheet_data['Raw Data'], dtype=float)
        unit = sheet_data.get('FTIR_Y_Unit', engine.U_T_PCT)

        bands = engine.detect_bands(
            x, y, unit, method=self.method_choice.GetStringSelection(),
            prominence_pct=self.prominence_ctrl.GetValue(),
            min_distance_cm=self.distance_ctrl.GetValue())

        if not bands:
            self.parent.show_popup_message2(
                "Information",
                "No bands found - try lowering the prominence, or the "
                "2nd-derivative method for overlapping bands.")
            self.detected_peaks = []
            self.populate_peaks_grid()
            return

        # Keep manual, locked assignments across a re-detection
        locked = {round(p['wavenumber'], 1): p
                  for p in self.detected_peaks if p.get('locked')}
        for band in bands:
            keep = locked.get(round(band['wavenumber'], 1))
            if keep:
                band.update({'locked': True,
                             'assignment': keep.get('assignment', ''),
                             'confidence': keep.get('confidence', 1.0),
                             'candidates': keep.get('candidates', [])})

        meta = self._metadata(sheet_data)
        assign.assign_bands(bands, meta, tolerance=self.tolerance_ctrl.GetValue())
        self.detected_peaks = bands
        sheet_data['FTIR_Bands'] = bands
        self.populate_peaks_grid()

    def on_reassign(self, event):
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None or not self.detected_peaks:
            return
        self._read_locks_from_grid()
        meta = self._metadata(sheet_data)
        assign.assign_bands(self.detected_peaks, meta,
                            tolerance=self.tolerance_ctrl.GetValue())
        sheet_data['FTIR_Bands'] = self.detected_peaks
        self.populate_peaks_grid()

    def _read_locks_from_grid(self):
        grid = self.peaks_grid
        for i, band in enumerate(self.detected_peaks):
            if i >= grid.GetNumberRows():
                break
            band['locked'] = grid.GetCellValue(i, 9) in ('1', 'yes', 'Yes')
            band['assignment'] = grid.GetCellValue(i, 4) or band.get(
                'assignment', '')

    def populate_peaks_grid(self):
        grid = self.peaks_grid
        if grid.GetNumberRows() > 0:
            grid.DeleteRows(0, grid.GetNumberRows())
        if not self.detected_peaks:
            self.cand_list.Clear()
            self.cand_detail.SetValue("")
            return
        grid.AppendRows(len(self.detected_peaks))
        for i, band in enumerate(self.detected_peaks):
            fwhm = band.get('fwhm')
            grid.SetCellValue(i, 0, f"{band['wavenumber']:.1f}")
            grid.SetCellValue(i, 1, f"{band.get('height', 0.0):.3g}")
            grid.SetCellValue(i, 2,
                              f"{100 * band.get('relative_height', 0):.0f}")
            grid.SetCellValue(i, 3, f"{fwhm:.1f}" if fwhm else "-")
            grid.SetCellValue(i, 4, band.get('assignment', assign.UNASSIGNED))
            grid.SetCellValue(i, 5, f"{band.get('confidence', 0):.0%}")
            grid.SetCellValue(i, 6, f"{band.get('delta', 0):.0f}")
            grid.SetCellValue(i, 7, band.get('expected_shape', ""))
            risk = band.get('artifact_risk', 0.0)
            grid.SetCellValue(i, 8, f"{risk:.0%}" if risk else "-")
            grid.SetCellRenderer(i, 9, wx.grid.GridCellBoolRenderer())
            grid.SetCellEditor(i, 9, wx.grid.GridCellBoolEditor())
            grid.SetCellValue(i, 9, '1' if band.get('locked') else '')

            for col in (0, 1, 2, 3, 5, 6, 8):
                grid.SetReadOnly(i, col)
            # Colour-code the confidence so a weak assignment cannot be
            # mistaken for a firm one
            conf = band.get('confidence', 0.0)
            if band.get('assignment') == assign.UNASSIGNED:
                colour = wx.Colour(245, 245, 245)
            elif conf >= 0.7:
                colour = wx.Colour(226, 245, 238)
            elif conf >= 0.45:
                colour = wx.Colour(253, 246, 220)
            else:
                colour = wx.Colour(253, 231, 226)
            for col in range(grid.GetNumberCols()):
                grid.SetCellBackgroundColour(i, col, colour)
            if risk >= 0.5:
                grid.SetCellBackgroundColour(i, 8, wx.Colour(250, 214, 205))
        grid.ForceRefresh()
        self.on_peak_row(None)

    def on_peak_row(self, event):
        if event is not None:
            event.Skip()
            row = event.GetRow()
        else:
            row = self.peaks_grid.GetGridCursorRow()
        self.cand_list.Clear()
        self.cand_detail.SetValue("")
        if not (0 <= row < len(self.detected_peaks)):
            return
        band = self.detected_peaks[row]
        self._candidate_row = row
        for cand in band.get('candidates', []):
            self.cand_list.Append(
                f"{cand['confidence']:>5.0%}  {assign.summarise(cand)}"
                f"   [{cand['range_text']} cm-1"
                + (f", {cand['delta']:.0f} cm-1 off" if cand['delta'] else "")
                + "]")

    def on_candidate_selected(self, event):
        row = getattr(self, '_candidate_row', -1)
        index = self.cand_list.GetSelection()
        if not (0 <= row < len(self.detected_peaks)) or index == wx.NOT_FOUND:
            return
        cands = self.detected_peaks[row].get('candidates', [])
        if index >= len(cands):
            return
        cand = cands[index]
        lines = [f"Expected shape / intensity: {cand['expected_shape'] or '-'}",
                 f"Library range: {cand['range_text']} cm-1"
                 f"   Difference: {cand['delta']:.0f} cm-1"
                 f"   Artifact risk: {cand['artifact_risk']:.0%}"]
        if cand['reasons']:
            lines.append("Why this confidence: " + "; ".join(cand['reasons']))
        if cand['source']:
            lines.append(f"Source: {cand['source']}")
        self.cand_detail.SetValue("\n".join(lines))

    def on_accept_candidate(self, event):
        row = getattr(self, '_candidate_row', -1)
        index = self.cand_list.GetSelection()
        if not (0 <= row < len(self.detected_peaks)) or index == wx.NOT_FOUND:
            return
        band = self.detected_peaks[row]
        cands = band.get('candidates', [])
        if index >= len(cands):
            return
        cand = cands[index]
        band.update({'assignment': assign.summarise(cand),
                     'confidence': cand['confidence'],
                     'delta': cand['delta'],
                     'expected_shape': cand['expected_shape'],
                     'artifact_risk': cand['artifact_risk'],
                     'source': cand['source'],
                     'locked': True})
        self.populate_peaks_grid()
        self.peaks_grid.SetGridCursor(row, 4)

    def on_peak_edited(self, event):
        event.Skip()
        row, col = event.GetRow(), event.GetCol()
        if not (0 <= row < len(self.detected_peaks)):
            return
        if col == 4:
            self.detected_peaks[row]['assignment'] = \
                self.peaks_grid.GetCellValue(row, 4)
            self.detected_peaks[row]['locked'] = True
            self.peaks_grid.SetCellValue(row, 9, '1')
        elif col == 9:
            self.detected_peaks[row]['locked'] = \
                self.peaks_grid.GetCellValue(row, 9) == '1'

    # -------------------------------------------------------------- labels --
    def on_label_peaks(self, event):
        from libraries.FileMenu.Save import save_state
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        if not self.detected_peaks:
            self.parent.show_popup_message2("Information",
                                            "Run 'Find Bands' first.")
            return

        save_state(self.parent)
        labels = sheet_data.setdefault('Labels', [])
        labels[:] = [ld for ld in labels if not ld.get('ftir_label')]

        y_all = np.asarray(sheet_data['Raw Data'], dtype=float)
        x_all = np.asarray(sheet_data['B.E.'], dtype=float)
        span = float(np.max(y_all) - np.min(y_all)) or 1.0
        x_span = float(np.max(x_all) - np.min(x_all)) or 1.0
        points_down = engine.bands_point_down(
            sheet_data.get('FTIR_Y_Unit', engine.U_T_PCT))
        gap = 0.03 * span

        selected_rows = set(self.peaks_grid.GetSelectedRows())
        chosen = [(i, pk) for i, pk in enumerate(self.detected_peaks)
                  if not selected_rows or i in selected_rows]
        chosen.sort(key=lambda item: item[1]['wavenumber'])

        # Vertical label strips collide sideways, so spread the anchors along
        # x; the printed wavenumber keeps each label tied to its band.
        min_sep = 0.030 * x_span
        label_xs = []
        for _, pk in chosen:
            xpos = pk['wavenumber']
            if label_xs and xpos - label_xs[-1] < min_sep:
                xpos = label_xs[-1] + min_sep
            label_xs.append(xpos)
        if label_xs:
            drift = 0.5 * ((label_xs[-1] - chosen[-1][1]['wavenumber'])
                           + (label_xs[0] - chosen[0][1]['wavenumber']))
            label_xs = [xv - drift for xv in label_xs]

        for (i, pk), xpos in zip(chosen, label_xs):
            text = self.peaks_grid.GetCellValue(i, 4) or pk.get('assignment', '')
            short_text = f"{pk['wavenumber']:.0f}"
            if text and text != assign.UNASSIGNED:
                short_text += f"  {text.split(';')[0].split('(')[0].strip()}"
            # A weak or artefact-risk assignment is flagged in the label
            if pk.get('assignment') == assign.ARTIFACT:
                short_text += " [?]"
            elif pk.get('confidence', 0) < 0.45 and text != assign.UNASSIGNED:
                short_text += " (?)"
            labels.append({
                'type': 'text',
                'text': short_text,
                'x': xpos,
                'y': (pk['y'] - gap) if points_down else (pk['y'] + gap),
                'rotation': 90,
                'va': 'top' if points_down else 'bottom',
                'ha': 'center',
                'ftir_label': True,
            })

        self._select_sheet_on_main(sheet_name, reset_limits=True)

    def on_clear_labels(self, event):
        from libraries.FileMenu.Save import save_state
        sheet_name, sheet_data = self.get_sheet_data()
        if sheet_data is None:
            return
        labels = sheet_data.get('Labels', [])
        if not any(ld.get('ftir_label') for ld in labels):
            return
        save_state(self.parent)
        sheet_data['Labels'] = [ld for ld in labels if not ld.get('ftir_label')]
        self._select_sheet_on_main(sheet_name, reset_limits=False)

    # =====================================================================
    # Band library tab
    # =====================================================================
    def populate_library_grid(self, search_text=""):
        search = search_text.lower().strip()
        rows = []
        for row in FTIR_BANDS:
            wn_a, wn_b, vibration, intensity, assignment = row[:5]
            wn_hi, wn_lo = max(wn_a, wn_b), min(wn_a, wn_b)
            range_txt = (f"{wn_hi:.0f}" if wn_hi == wn_lo
                         else f"{wn_hi:.0f}-{wn_lo:.0f}")
            source = assign.band_source(vibration, assignment)
            if search:
                haystack = (f"{range_txt} {vibration} {intensity} "
                            f"{assignment}").lower()
                if search not in haystack:
                    try:
                        wn = float(search)
                        if not (wn_lo <= wn <= wn_hi):
                            continue
                    except ValueError:
                        continue
            rows.append((range_txt, vibration, intensity, assignment, source))

        grid = self.library_grid
        if grid.GetNumberRows() > 0:
            grid.DeleteRows(0, grid.GetNumberRows())
        grid.AppendRows(len(rows))
        for i, values in enumerate(rows):
            for col, value in enumerate(values):
                grid.SetCellValue(i, col, value)

    def on_search_library(self, event):
        self.populate_library_grid(self.search_ctrl.GetValue())

    # =====================================================================
    # Reference spectra tab
    # =====================================================================
    def _library_dir(self):
        from libraries.ConfigFile import get_ftir_library_dir
        return get_ftir_library_dir()

    def refresh_reference_list(self):
        try:
            folder = self._library_dir()
            files = sorted(f for f in os.listdir(folder)
                           if f.lower().endswith(('.jdx', '.dx', '.jcm')))
        except OSError:
            files = []
        self.ref_listbox.Set(files)

    def on_open_library_folder(self, event):
        import subprocess
        folder = self._library_dir()
        try:
            os.startfile(folder)  # Windows
        except AttributeError:
            subprocess.Popen(['open' if sys.platform == 'darwin'
                              else 'xdg-open', folder])

    def _warn_mode_mismatch(self, ref_state):
        """An ATR solid compared with a gas-phase transmission spectrum is a
        common and misleading mistake - say so before it happens."""
        sheet_name, sheet_data = self.get_sheet_data(complain=False)
        if sheet_data is None:
            return
        meta = self._metadata(sheet_data)
        mode = meta.get('mode', 'Unknown')
        state = meta.get('state', 'Unknown')
        if not ref_state:
            return
        ref = str(ref_state).lower()
        if 'gas' in ref and mode == 'ATR' and state.startswith('Solid'):
            self.parent.show_popup_message2(
                "Measurement-mode mismatch",
                "The reference is a gas-phase spectrum and your sample is a "
                "solid measured in ATR.\n\n"
                "Band positions will be shifted (typically 10-30 cm-1 to "
                "lower wavenumber for hydrogen-bonded modes) and relative "
                "intensities differ because ATR penetration depth grows with "
                "wavelength.\n\n"
                "Apply the ATR correction (Processing tab) before comparing "
                "band shapes.")

    def on_load_reference(self):
        sel = self.ref_listbox.GetStringSelection()
        if not sel:
            self.parent.show_popup_message2(
                "Information", "Select a spectrum in the list first.")
            return
        from libraries.FileMenu.JCAMP_Import import (parse_jcamp,
                                                     add_ftir_reference_to_project)
        path = os.path.join(self._library_dir(), sel)
        try:
            spec = parse_jcamp(path)
        except Exception as e:
            self.parent.show_popup_message2("Error",
                                            f"Could not read {sel}: {e}")
            return
        self._warn_mode_mismatch(spec.get('state'))
        sheet = add_ftir_reference_to_project(self.parent, spec['x'], spec['y'],
                                              spec['title'], spec['y_unit'],
                                              source=sel)
        if sheet:
            self.refresh_sheet_list()

    def on_fetch_nist(self, event):
        from libraries.FileMenu.JCAMP_Import import (nist_search_cas,
                                                     nist_fetch_ir, parse_jcamp,
                                                     add_ftir_reference_to_project)
        query = self.nist_query.GetValue().strip()
        if not query:
            return

        busy = wx.BusyCursor()
        try:
            species_id, name = nist_search_cas(query)
            if species_id is None:
                self.parent.show_popup_message2("NIST lookup", name)
                return

            data = nist_fetch_ir(species_id, index=0)
            if data is None:
                data = nist_fetch_ir(species_id, index=1)
            if data is None:
                self.parent.show_popup_message2(
                    "NIST lookup",
                    f"'{name}' was found ({species_id}) but has no IR spectrum "
                    f"on the NIST WebBook.")
                return

            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.jdx', delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            try:
                spec = parse_jcamp(tmp_path)
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

            self._warn_mode_mismatch(spec.get('state'))
            state = f", {spec['state']}" if spec['state'] else ""
            sheet = add_ftir_reference_to_project(
                self.parent, spec['x'], spec['y'], spec['title'],
                spec['y_unit'], source=f"NIST WebBook{state}")

            if self.nist_save_copy.GetValue():
                safe = re.sub(r'[^\w\-. ]', '_', spec['title'])[:60] or species_id
                dest = os.path.join(self._library_dir(), f"{safe}_NIST.jdx")
                try:
                    with open(dest, 'wb') as f:
                        f.write(data)
                    self.refresh_reference_list()
                except OSError as e:
                    print(f"Could not save library copy: {e}")

            if sheet:
                self.refresh_sheet_list()
        finally:
            del busy

    # ---------------------------------------------- Online (GitHub) library --
    ONLINE_MAX_ROWS = 4000

    def _update_online_source_label(self):
        from libraries.ConfigFile import get_ftir_online_base
        base = get_ftir_online_base()
        self.online_src_lbl.SetLabel(base)
        self.online_src_lbl.SetToolTip(base)

    def load_online_index_cached(self):
        """Populate the online list from the local cache (no network)."""
        self._update_online_source_label()
        try:
            # network fetch skipped: only read cache if it matches the base URL
            import json
            from libraries.ConfigFile import (get_ftir_online_base,
                                              get_ftir_online_cache_path)
            cache = get_ftir_online_cache_path()
            with open(cache, 'r', encoding='utf-8') as f:
                cached = json.load(f)
            if cached.get('base') == get_ftir_online_base():
                self._online_index = cached.get('spectra', [])
            else:
                self._online_index = []
        except (OSError, ValueError):
            self._online_index = []
        if self._online_index:
            self._online_populate_list("")
        else:
            self.online_count_lbl.SetLabel(
                "Click 'Fetch / Update' to download the name index.")

    def on_refresh_online(self, event):
        from libraries.FileMenu.JCAMP_Import import fetch_online_index
        busy = wx.BusyCursor()
        try:
            self._online_index = fetch_online_index()
        except Exception as e:
            del busy
            self.parent.show_popup_message2(
                "Online library", f"Could not fetch the index:\n{e}")
            return
        finally:
            try:
                del busy
            except NameError:
                pass
        self.online_filter.ChangeValue("")
        self._online_populate_list("")

    def on_change_online_source(self, event):
        from libraries.ConfigFile import (get_ftir_online_base,
                                          set_ftir_online_base,
                                          FTIR_ONLINE_DEFAULT_BASE)
        dlg = wx.TextEntryDialog(
            self, "Base URL of the online reference library "
                  "(the folder that holds index.json):\n\n"
                  f"Default:\n{FTIR_ONLINE_DEFAULT_BASE}",
            "Online library source", get_ftir_online_base())
        try:
            if dlg.ShowModal() != wx.ID_OK:
                return
            base = dlg.GetValue().strip()
        finally:
            dlg.Destroy()
        set_ftir_online_base(base or FTIR_ONLINE_DEFAULT_BASE)
        self._update_online_source_label()
        self.online_count_lbl.SetLabel(
            "Source changed - click 'Fetch / Update' to reload.")

    def on_online_filter(self, event):
        self._online_populate_list(self.online_filter.GetValue())

    def _online_label(self, entry):
        lib = entry.get('library', '')
        return f"{entry.get('name', '?')}   —   {lib}" if lib \
            else entry.get('name', '?')

    def _online_populate_list(self, filter_text):
        q = filter_text.lower().strip()
        matches = [(i, e) for i, e in enumerate(self._online_index)
                   if not q or q in self._online_label(e).lower()]
        total = len(matches)
        shown = matches[:self.ONLINE_MAX_ROWS]
        self._online_visible = [i for i, _ in shown]
        self.online_listbox.Set([self._online_label(e) for _, e in shown])
        if total > len(shown):
            self.online_count_lbl.SetLabel(
                f"Showing {len(shown)} of {total} - narrow the filter.")
        else:
            self.online_count_lbl.SetLabel(f"{total} spectra")

    def on_add_online_reference(self):
        if not self._online_index:
            self.parent.show_popup_message2(
                "Online library",
                "Click 'Fetch / Update' to download the name index first.")
            return
        rows = self.online_listbox.GetSelections()
        if not rows:
            self.parent.show_popup_message2(
                "Information", "Select one or more spectra in the list first.")
            return
        entries = [self._online_index[self._online_visible[r]] for r in rows
                   if 0 <= r < len(self._online_visible)]
        file_path = self.parent.Data.get('FilePath')
        if not file_path or not os.path.exists(file_path):
            self.parent.show_popup_message2(
                "No project open",
                "Open or import a project first - each reference spectrum is "
                "added as a new FTIR sheet of the current file.")
            return

        from libraries.FileMenu.JCAMP_Import import (fetch_online_spectrum,
                                                     add_ftir_reference_to_project)
        added, failed = 0, []
        busy = wx.BusyCursor()
        try:
            for e in entries:
                try:
                    spec = fetch_online_spectrum(e['file'])
                except Exception as ex:
                    failed.append(f"{e.get('name', '?')}: {ex}")
                    continue
                sheet = add_ftir_reference_to_project(
                    self.parent, spec['x'].tolist(), spec['y'].tolist(),
                    e.get('name', spec['title']), spec['y_unit'],
                    source=e.get('library', 'Online library'))
                if sheet:
                    added += 1
        finally:
            del busy
        if added:
            self.refresh_sheet_list()
        msg = f"Added {added} reference{'s' if added != 1 else ''}."
        if failed:
            msg += f"  {len(failed)} failed."
        self.online_count_lbl.SetLabel(msg)
        if failed and not added:
            self.parent.show_popup_message2(
                "Online library", "Could not fetch:\n" + "\n".join(failed[:5]))

    # ------------------------------------------------ Nicolet / OMNIC browser --
    NIC_MAX_ROWS = 4000   # keep the listbox responsive on 18k-spectrum libraries

    def refresh_nicolet_libraries(self):
        """Scan the remembered Nicolet folder and fill the library dropdown."""
        from libraries.ConfigFile import get_ftir_nicolet_dir
        from libraries.FileMenu.NicoletLibrary_Import import scan_nicolet_folder
        folder = get_ftir_nicolet_dir()
        if folder:
            self.nic_folder_lbl.SetLabel(folder)
            self.nic_folder_lbl.SetToolTip(folder)
        else:
            self.nic_folder_lbl.SetLabel("(choose a folder of .lbd libraries)")
            self.nic_folder_lbl.SetToolTip(None)

        busy = wx.BusyCursor() if folder else None
        try:
            self._nicolet_libs = scan_nicolet_folder(folder) if folder else []
        finally:
            del busy

        choices = [f"{lib['title']}  ({lib['nspec']} spectra)"
                   for lib in self._nicolet_libs]
        self.nic_lib_choice.Set(choices)
        # Reset the spectrum list; the user picks a library to populate it.
        self._nicolet_lib = None
        self._nicolet_lib_path = None
        self._nicolet_labels = []
        self._nic_visible = []
        self.nic_listbox.Clear()
        if not folder:
            self.nic_count_lbl.SetLabel("No folder chosen.")
        elif not self._nicolet_libs:
            self.nic_count_lbl.SetLabel("No .lbd libraries found in this folder.")
        else:
            self.nic_count_lbl.SetLabel(
                f"{len(self._nicolet_libs)} libraries - select one above.")

    def on_choose_nicolet_folder(self, event):
        from libraries.ConfigFile import (get_ftir_nicolet_dir,
                                          set_ftir_nicolet_dir)
        with wx.DirDialog(self, "Choose a folder of Nicolet/OMNIC .lbd libraries",
                          defaultPath=get_ftir_nicolet_dir() or "",
                          style=wx.DD_DEFAULT_STYLE) as dlg:
            if dlg.ShowModal() != wx.ID_OK:
                return
            set_ftir_nicolet_dir(dlg.GetPath())
        self.nic_filter.ChangeValue("")
        self.refresh_nicolet_libraries()

    def on_nicolet_library_selected(self, event):
        """Fully parse the chosen library (with compound names) and list it."""
        from libraries.FileMenu.NicoletLibrary_Import import parse_nicolet_library
        sel = self.nic_lib_choice.GetSelection()
        if sel == wx.NOT_FOUND or sel >= len(self._nicolet_libs):
            return
        path = self._nicolet_libs[sel]['lbd_path']
        if path == self._nicolet_lib_path and self._nicolet_lib is not None:
            return
        busy = wx.BusyCursor()
        try:
            lib = parse_nicolet_library(path)
        except Exception as e:
            self.parent.show_popup_message2(
                "Error", f"Could not read this library:\n{e}")
            return
        finally:
            del busy
        self._nicolet_lib = lib
        self._nicolet_lib_path = path
        self._nicolet_labels = [
            (i, lib['names'][i].strip() or f"(spectrum {i + 1})")
            for i in range(lib['nspec'])]
        self.nic_filter.ChangeValue("")
        self._nicolet_populate_list("")

    def on_nicolet_filter(self, event):
        if self._nicolet_lib is not None:
            self._nicolet_populate_list(self.nic_filter.GetValue())

    def _nicolet_populate_list(self, filter_text):
        q = filter_text.lower().strip()
        matches = [(idx, label) for idx, label in self._nicolet_labels
                   if not q or q in label.lower()]
        total = len(matches)
        shown = matches[:self.NIC_MAX_ROWS]
        self._nic_visible = [idx for idx, _ in shown]
        self.nic_listbox.Set([label for _, label in shown])
        if total > len(shown):
            self.nic_count_lbl.SetLabel(
                f"Showing {len(shown)} of {total} - narrow the filter.")
        else:
            self.nic_count_lbl.SetLabel(f"{total} spectra")

    def on_add_nicolet_reference(self):
        if self._nicolet_lib is None:
            self.parent.show_popup_message2(
                "Information", "Select a library, then a spectrum.")
            return
        rows = self.nic_listbox.GetSelections()
        if not rows:
            self.parent.show_popup_message2(
                "Information", "Select one or more spectra in the list first.")
            return
        indices = [self._nic_visible[r] for r in rows
                   if 0 <= r < len(self._nic_visible)]
        # add_ftir_reference_to_project needs an open project; check once here so
        # a multi-select add does not pop the same warning for every spectrum.
        file_path = self.parent.Data.get('FilePath')
        if not file_path or not os.path.exists(file_path):
            self.parent.show_popup_message2(
                "No project open",
                "Open or import a project first - each reference spectrum is "
                "added as a new FTIR sheet of the current file.")
            return
        if len(indices) > 25:
            proceed = wx.MessageBox(
                f"Add {len(indices)} reference spectra? Each is saved into the "
                f"project, so many at once can be slow.\n\nContinue?",
                "Add many references", wx.YES_NO | wx.ICON_QUESTION, self)
            if proceed != wx.YES:
                return

        from libraries.FileMenu.JCAMP_Import import add_ftir_reference_to_project
        lib = self._nicolet_lib
        x = lib['x'].tolist()
        title = lib['title']
        added = 0
        busy = wx.BusyCursor()
        try:
            for idx in indices:
                y = np.asarray(lib['get_y'](idx), dtype=float)
                good = np.isfinite(y)
                if not good.any():
                    continue
                if not good.all():
                    xs = [xi for xi, g in zip(x, good) if g]
                    ys = y[good].tolist()
                else:
                    xs, ys = x, y.tolist()
                name = lib['names'][idx].strip() or f"Spectrum {idx + 1}"
                sheet = add_ftir_reference_to_project(
                    self.parent, xs, ys, name,
                    engine.U_ABSORBANCE, source=title)
                if sheet:
                    added += 1
        finally:
            del busy
        if added:
            self.refresh_sheet_list()
            self.nic_count_lbl.SetLabel(
                f"Added {added} reference{'s' if added != 1 else ''}.")

    # --------------------------------------------------------------- close --
    def on_close(self, event):
        windows = getattr(self.parent, '_ftir_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'ftir_analysis_window', None) is self:
            self.parent.ftir_analysis_window = remaining[-1] if remaining else None
        self.Destroy()


def open_ftir_window(window):
    """Open (or raise) the full FTIR Analysis window."""
    for existing in list(getattr(window, '_ftir_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    FTIRAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = FTIRAnalysisWindow(window)
    frame.Show()
    return frame


def open_ftir_section(window, key):
    """Open one FTIR tab (a single section) as its own narrow window."""
    for existing in list(getattr(window, '_ftir_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = FTIRAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
