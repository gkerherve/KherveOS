# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TGA_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/TGA_Analysis.py
"""
TGA / DSC Analysis tool.

The workflow runs left to right across the tabs, and every plot it produces is
the main frame's:

  1. *Range*  - the imported sheet is the temperature programme against time.
     A run heats, dwells, cools and heats again, so it passes the same
     temperature several times and a mass-vs-temperature plot of the whole
     thing is meaningless.  Bracket one ramp with the red dashed lines and
     generate a new sheet from that slice.  A blank (empty-crucible) run can
     be subtracted here.
  2. *Mass*   - normalisation basis, non-destructive smoothing, and mass-change
     regions.  Several regions can be measured and kept at once; each becomes
     a row of the event table and a 'step' annotation in the Label Manager.
  3. *DTG*    - the derivative, dm/dT or dm/dt, with automatic peak detection
     and manual editing.
  4. *DSC*    - six baseline constructions previewed on the plot before
     integration, then the full peak characterisation with a transparency
     block showing every input the enthalpy depends on.
  5. *Events* - the combined TGA-DTG-DSC event table, with tentative chemical
     readings.
  6. *Chemistry* - oxygen non-stoichiometry and theoretical mass change.
  7. *Cycles* - reversible / irreversible split over repeated cycles.
  8. *Isothermal* - kinetic fitting of a dwell.
  9. *Compare* - overlay several runs.

Results are stored on the sheet, so they are redrawn on every replot and saved
with the project.
"""

import numpy as np
import wx
import wx.grid

from libraries.FileMenu.TGA_Import import (
    next_tga_sheet_name, next_tga_view_sheet_name, parse_tga_file, VIEW_TIME,
    VIEW_TEMPERATURE, X_LABEL_TEMPERATURE, Y_LABEL_MASS_PCT)
from libraries.ToolsMenu.TGA_Engine import (
    window_indices, mass_step, dsc_area, format_mass_step, format_dsc_area,
    smooth_trace, SMOOTH_METHODS, BASELINE_METHODS, BASELINE_STRAIGHT,
    BASELINE_DESCRIPTIONS, BASELINE_BLANK, normalise_mass,
    NORMALISATION_MODES, NORM_PCT_INITIAL, NORM_RAW_MG, NORM_PCT_RANGE,
    NORM_DRY_BASIS, NORM_PER_MOLE, derivative_trace, DTG_PER_TEMPERATURE,
    DTG_PER_TIME, find_dtg_peaks, dtg_peak_bounds, detect_events,
    interpret_event, subtract_blank, blank_coverage_note, split_cycles,
    cycle_analysis, fit_isothermal, format_isothermal, KINETIC_MODELS,
    arrhenius_from_dwells, extrapolated_onset, glass_transition,
    format_glass_transition)
from libraries.ToolsMenu.TGA_Chem import (
    theoretical_mass_change, format_theoretical, oxygen_nonstoichiometry,
    format_nonstoichiometry, COMMON_SPECIES, FormulaError)
from libraries.ToolsMenu.TGA_Plot import is_tga_sheet

KHERVE_GREEN = wx.Colour(79, 190, 159)
GREY = wx.Colour(110, 110, 110)

# Traces indexed by the same rows as the mass, so a derived sheet is built by
# slicing all of them with one set of indices.
SLICED_TRACES = ('TGA_Temperature', 'TGA_DSC', 'TGA_Time_min',
                 'TGA_Sensitivity', 'TGA_Segment', 'TGA_Mass_mg',
                 'TGA_Mass_Pct', 'TGA_Blank')

CARRIED_META = ('TGA_DSC_Unit', 'TGA_Exo_Up', 'TGA_Source', 'TGA_Sample_Mass_mg')

(TAB_RANGE, TAB_MASS, TAB_DTG, TAB_DSC, TAB_HEATFLOW, TAB_EVENTS, TAB_CHEM,
 TAB_CYCLES, TAB_ISO, TAB_COMPARE) = range(10)

EVENT_COLUMNS = ('Name', 'T start', 'T end', 'Δm (mg)', 'Δm (%)', 'Onset',
                 'DTG peak', 'DSC peak', 'ΔH (J/g)')


def _parse_float(text_ctrl, name, allow_zero=False):
    """Read a positive float out of a text control, or raise ValueError."""
    raw = text_ctrl.GetValue().strip()
    if not raw:
        raise ValueError(f"{name} is empty.")
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name} is not a number: '{raw}'")
    if not allow_zero and value <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    return value


def _optional_float(text_ctrl):
    """Read a float from a control that is allowed to be blank."""
    raw = text_ctrl.GetValue().strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _ramp_direction(temperature):
    """'heating', 'cooling' or 'isothermal' for a slice of the programme."""
    if len(temperature) < 2:
        return 'isothermal'
    change = float(temperature[-1]) - float(temperature[0])
    span = float(max(temperature)) - float(min(temperature))
    if span < 1.0:
        return 'isothermal'
    return 'heating' if change > 0 else 'cooling'


def _grey(parent, text):
    label = wx.StaticText(parent, label=text)
    label.SetForegroundColour(GREY)
    return label


class TGAAnalysisWindow(wx.Frame):
    # (section key, tab title, builder-method name, TAB_* constant), in order.
    SECTIONS = (
        ('range', "Range", '_build_range_tab', TAB_RANGE),
        ('mass', "Mass", '_build_mass_tab', TAB_MASS),
        ('dtg', "DTG", '_build_dtg_tab', TAB_DTG),
        ('dsc', "DSC", '_build_dsc_tab', TAB_DSC),
        ('heatflow', "Heat Flow", '_build_heatflow_tab', TAB_HEATFLOW),
        ('events', "Events", '_build_events_tab', TAB_EVENTS),
        ('chemistry', "Chemistry", '_build_chem_tab', TAB_CHEM),
        ('cycles', "Cycles", '_build_cycles_tab', TAB_CYCLES),
        ('isothermal', "Isothermal", '_build_isothermal_tab', TAB_ISO),
        ('compare', "Compare", '_build_compare_tab', TAB_COMPARE),
    )
    SECTION_TITLES = {k: t for k, t, _b, _c in SECTIONS}
    SECTION_TAB = {k: c for k, _t, _b, c in SECTIONS}
    # Tabs whose work is the red range lines on the main plot.
    RANGE_SECTIONS = frozenset({'range', 'mass', 'dsc', 'heatflow', 'isothermal'})

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b, _c in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            title = f"TGA {self.SECTION_TITLES[self._section_keys[0]]}"
            size = (480, 640)
        else:
            title = "TGA / DSC Analysis"
            size = (760, 800)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent

        # tab index -> (min box, max box); filled in by _build_range_box
        self._range_controls = {}

        self.notebook = wx.Notebook(self)
        # Build EVERY tab whatever this window shows: handlers reach across tabs
        # (Range's generate reads the Mass tab's mass boxes, the range controls
        # are refreshed as a set). Only the requested pages are added; the rest
        # are hidden so a single-tab pop-out still resolves every reference.
        builders = {k: b for k, _t, b, _c in self.SECTIONS}
        self._panels = {k: getattr(self, builders[k])(self.notebook) for k in keys}
        for key in self._section_keys:
            self.notebook.AddPage(self._panels[key], self.SECTION_TITLES[key])
        for key, panel in self._panels.items():
            if key not in self._section_keys:
                panel.Hide()
        self.notebook.Bind(wx.EVT_NOTEBOOK_PAGE_CHANGED, self.on_tab_changed)

        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(self.notebook, 1, wx.EXPAND)
        self.SetSizer(sizer)

        self.refresh_sheet_lists()
        self.Bind(wx.EVT_CLOSE, self.on_close)

        if single:
            self.Fit()
            w, h = self.GetSize()
            w, h = max(w, 340), max(h, 460)
            self.SetSize((w, h))
            self.SetMinSize((w, 400))
        else:
            self.SetMinSize((700, 660))
        self.CentreOnParent()

        # Register so the shared vline handler treats a TGA sheet as
        # range-selectable (see show_hide_vlines in KherveFitting.py) and a drag
        # fans out to every open TGA window.
        if not hasattr(parent, '_tga_windows'):
            parent._tga_windows = []
        parent._tga_windows.append(self)
        parent.tga_analysis_window = self
        if self.RANGE_SECTIONS & set(self._section_keys):
            self.show_range_vlines()

    # ------------------------------------------------------------ Range tab --

    def _build_range_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Measured Run (vs time)")
        self.run_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.run_combo.Bind(wx.EVT_COMBOBOX, self.on_run_selected)
        refresh_btn = wx.Button(panel, label="Refresh")
        refresh_btn.Bind(wx.EVT_BUTTON, lambda evt: self.refresh_sheet_lists())
        sheet_box.Add(self.run_combo, 1, wx.ALL | wx.EXPAND, 5)
        sheet_box.Add(refresh_btn, 0, wx.ALL, 5)
        vbox.Add(sheet_box, 0, wx.EXPAND | wx.ALL, 5)

        self.run_info = wx.StaticText(panel, label="")
        vbox.Add(self.run_info, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        vbox.Add(_grey(panel,
                       "The imported sheet is the temperature programme against time. "
                       "Bracket one\nramp with the red dashed lines - that slice "
                       "becomes the mass vs temperature\nplot the other tabs work on."),
                 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        # Blank-run correction
        blank_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Blank / Baseline Run")
        blank_box.Add(_grey(panel,
                            "A blank run measured with the same crucible, atmosphere, flow "
                            "rate and\nprogramme carries the buoyancy drift and the "
                            "instrument's own DSC baseline.\nSubtracting it leaves only the "
                            "sample's response."),
                      0, wx.ALL, 6)
        row = wx.BoxSizer(wx.HORIZONTAL)
        import_blank_btn = wx.Button(panel, label="Import blank run…")
        import_blank_btn.Bind(wx.EVT_BUTTON, self.on_import_blank)
        row.Add(import_blank_btn, 0, wx.ALL, 5)
        self.blank_apply_btn = wx.Button(panel, label="Subtract from this run")
        self.blank_apply_btn.Bind(wx.EVT_BUTTON, self.on_subtract_blank)
        row.Add(self.blank_apply_btn, 0, wx.ALL, 5)
        clear_blank_btn = wx.Button(panel, label="Restore uncorrected")
        clear_blank_btn.Bind(wx.EVT_BUTTON, self.on_clear_blank)
        row.Add(clear_blank_btn, 0, wx.ALL, 5)
        blank_box.Add(row, 0, wx.EXPAND)
        self.blank_info = wx.StaticText(panel, label="No blank run loaded.")
        blank_box.Add(self.blank_info, 0, wx.ALL, 6)
        self.blank_show_check = wx.CheckBox(
            panel, label="Show the correction curve as its own sheet")
        self.blank_show_check.SetValue(True)
        blank_box.Add(self.blank_show_check, 0, wx.ALL, 6)
        vbox.Add(blank_box, 0, wx.EXPAND | wx.ALL, 5)

        vbox.Add(self._build_range_box(panel, TAB_RANGE, "Time Range", "t"),
                 0, wx.EXPAND | wx.ALL, 5)

        self.selection_info = wx.StaticText(panel, label="")
        vbox.Add(self.selection_info, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        gen_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Mass vs Temperature Sheet")
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Initial mass:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.initial_mass_ctrl = wx.TextCtrl(panel, size=(90, -1))
        row.Add(self.initial_mass_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="mg"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 10)
        row.Add(wx.StaticText(panel, label="Normalise:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 10)
        self.norm_choice = wx.Choice(panel, choices=list(NORMALISATION_MODES),
                                     size=(190, -1))
        self.norm_choice.SetSelection(NORMALISATION_MODES.index(NORM_PCT_RANGE))
        row.Add(self.norm_choice, 0, wx.ALL, 5)
        gen_box.Add(row, 0, wx.EXPAND)

        gen_btn = wx.Button(panel, label="Generate mass vs temperature (+ DSC) sheet")
        gen_btn.SetBackgroundColour(KHERVE_GREEN)
        gen_btn.Bind(wx.EVT_BUTTON, self.on_generate)
        gen_box.Add(gen_btn, 0, wx.ALL | wx.EXPAND, 6)
        vbox.Add(gen_box, 0, wx.EXPAND | wx.ALL, 5)

        self.gen_status = wx.StaticText(panel, label="")
        vbox.Add(self.gen_status, 0, wx.ALL, 10)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------- Mass tab --

    def _build_mass_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel,
                                      "Derived Sheet (mass vs temperature)")
        self.mass_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.mass_combo.Bind(wx.EVT_COMBOBOX, self.on_derived_selected)
        sheet_box.Add(self.mass_combo, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(sheet_box, 0, wx.EXPAND | wx.ALL, 5)

        self.mass_info = wx.StaticText(panel, label="")
        vbox.Add(self.mass_info, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        # Normalisation of an existing derived sheet
        norm_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Mass Basis")
        self.mass_norm_choice = wx.Choice(panel, choices=list(NORMALISATION_MODES),
                                          size=(200, -1))
        self.mass_norm_choice.SetSelection(1)
        norm_box.Add(self.mass_norm_choice, 0, wx.ALL, 5)
        norm_box.Add(wx.StaticText(panel, label="Dry mass:"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.dry_mass_ctrl = wx.TextCtrl(panel, size=(70, -1))
        self.dry_mass_ctrl.SetToolTip("Needed for the dry-mass basis: the mass "
                                      "once the moisture step has finished.")
        norm_box.Add(self.dry_mass_ctrl, 0, wx.ALL, 5)
        norm_box.Add(wx.StaticText(panel, label="M:"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.molar_mass_ctrl = wx.TextCtrl(panel, size=(70, -1))
        self.molar_mass_ctrl.SetToolTip("Molar mass, needed for the per-mole basis.")
        norm_box.Add(self.molar_mass_ctrl, 0, wx.ALL, 5)
        apply_norm = wx.Button(panel, label="Apply")
        apply_norm.Bind(wx.EVT_BUTTON, self.on_apply_normalisation)
        norm_box.Add(apply_norm, 0, wx.ALL, 5)
        vbox.Add(norm_box, 0, wx.EXPAND | wx.ALL, 5)

        # Smoothing - non-destructive, with layers
        smooth_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Smoothing (non-destructive)")
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Method:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.smooth_choice = wx.Choice(panel, choices=list(SMOOTH_METHODS),
                                       size=(130, -1))
        self.smooth_choice.SetSelection(0)
        self.smooth_choice.SetToolTip(
            "Savitzky-Golay keeps the height and position of a step, which is "
            "what is being measured; a moving average rounds it off.")
        row.Add(self.smooth_choice, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Width:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.smooth_width_ctrl = wx.SpinCtrl(panel, min=3, max=999, initial=15,
                                             size=(65, -1))
        row.Add(self.smooth_width_ctrl, 0, wx.ALL, 5)
        smooth_btn = wx.Button(panel, label="Smooth")
        smooth_btn.Bind(wx.EVT_BUTTON, self.on_smooth)
        row.Add(smooth_btn, 0, wx.ALL, 5)
        restore_btn = wx.Button(panel, label="Restore raw")
        restore_btn.Bind(wx.EVT_BUTTON, self.on_restore_raw)
        row.Add(restore_btn, 0, wx.ALL, 5)
        smooth_box.Add(row, 0, wx.EXPAND)

        layer_row = wx.BoxSizer(wx.HORIZONTAL)
        layer_row.Add(wx.StaticText(panel, label="Layers:"), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.layer_raw_check = wx.CheckBox(panel, label="raw")
        self.layer_raw_check.SetValue(True)
        self.layer_raw_check.Bind(wx.EVT_CHECKBOX, self.on_layers_changed)
        layer_row.Add(self.layer_raw_check, 0, wx.ALL, 5)
        self.layer_dtg_check = wx.CheckBox(panel, label="DTG")
        self.layer_dtg_check.Bind(wx.EVT_CHECKBOX, self.on_layers_changed)
        layer_row.Add(self.layer_dtg_check, 0, wx.ALL, 5)
        smooth_box.Add(layer_row, 0, wx.EXPAND)
        self.smooth_info = wx.StaticText(panel, label="")
        smooth_box.Add(self.smooth_info, 0, wx.ALL, 6)
        vbox.Add(smooth_box, 0, wx.EXPAND | wx.ALL, 5)

        legend_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Legend")
        legend_box.Add(wx.StaticText(panel, label="Name of the measured trace:"),
                       0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.legend_ctrl = wx.TextCtrl(panel, size=(200, -1))
        self.legend_ctrl.SetToolTip(
            "Replaces 'Raw Data' in the legend. Leave empty to keep the default.")
        legend_box.Add(self.legend_ctrl, 1, wx.ALL, 5)
        legend_btn = wx.Button(panel, label="Apply")
        legend_btn.Bind(wx.EVT_BUTTON, self.on_apply_legend)
        legend_box.Add(legend_btn, 0, wx.ALL, 5)
        vbox.Add(legend_box, 0, wx.EXPAND | wx.ALL, 5)

        vbox.Add(self._build_range_box(panel, TAB_MASS, "Temperature Range", "T"),
                 0, wx.EXPAND | wx.ALL, 5)

        step_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Mass Change Region")
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Name:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.region_name_ctrl = wx.TextCtrl(panel, size=(140, -1))
        self.region_name_ctrl.SetToolTip("Optional name for this event, shown "
                                         "in the event table.")
        row.Add(self.region_name_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Edges over:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.average_ctrl = wx.SpinCtrl(panel, min=1, max=200, initial=5,
                                        size=(60, -1))
        row.Add(self.average_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Font:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.label_font_ctrl = wx.SpinCtrl(
            panel, min=4, max=48,
            initial=int(getattr(self.parent, 'label_font_size', 10)), size=(55, -1))
        self.label_font_ctrl.SetToolTip("Font size of the label drawn on the plot.")
        row.Add(self.label_font_ctrl, 0, wx.ALL, 5)
        step_box.Add(row, 0, wx.EXPAND)

        btn_row = wx.BoxSizer(wx.HORIZONTAL)
        step_btn = wx.Button(panel, label="Add mass-change region")
        step_btn.SetBackgroundColour(KHERVE_GREEN)
        step_btn.Bind(wx.EVT_BUTTON, self.on_mass_step)
        btn_row.Add(step_btn, 1, wx.ALL, 5)
        del_btn = wx.Button(panel, label="Delete selected")
        del_btn.Bind(wx.EVT_BUTTON, self.on_delete_region)
        btn_row.Add(del_btn, 0, wx.ALL, 5)
        clear_btn = wx.Button(panel, label="Clear all")
        clear_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_clear_regions())
        btn_row.Add(clear_btn, 0, wx.ALL, 5)
        step_box.Add(btn_row, 0, wx.EXPAND)
        step_box.Add(_grey(panel,
                           "Regions accumulate - each is kept, listed below and drawn as a "
                           "Label Manager\nentry that can be moved, restyled or deleted there."),
                     0, wx.ALL, 6)
        vbox.Add(step_box, 0, wx.EXPAND | wx.ALL, 5)

        self.mass_grid = self._make_grid(panel, EVENT_COLUMNS)
        vbox.Add(self.mass_grid, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # -------------------------------------------------------------- DTG tab --

    def _build_dtg_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        vbox.Add(_grey(panel,
                       "The DTG curve is the rate of mass change. Its peaks are what "
                       "actually define\nthe temperature of a decomposition step - far "
                       "better than eyeballing the\ninflection of the mass trace."),
                 0, wx.ALL, 10)

        calc_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Derivative")
        row = wx.BoxSizer(wx.HORIZONTAL)
        self.dtg_mode_choice = wx.Choice(panel,
                                         choices=[DTG_PER_TEMPERATURE, DTG_PER_TIME],
                                         size=(110, -1))
        self.dtg_mode_choice.SetSelection(0)
        row.Add(self.dtg_mode_choice, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Smoothing width:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.dtg_width_ctrl = wx.SpinCtrl(panel, min=5, max=999, initial=51,
                                          size=(70, -1))
        self.dtg_width_ctrl.SetToolTip(
            "Differentiation amplifies noise, so the derivative is taken from a "
            "polynomial fitted over this many points.")
        row.Add(self.dtg_width_ctrl, 0, wx.ALL, 5)
        calc_btn = wx.Button(panel, label="Calculate DTG")
        calc_btn.SetBackgroundColour(KHERVE_GREEN)
        calc_btn.Bind(wx.EVT_BUTTON, self.on_calculate_dtg)
        row.Add(calc_btn, 0, wx.ALL, 5)
        calc_box.Add(row, 0, wx.EXPAND)
        self.dtg_info = wx.StaticText(panel, label="")
        calc_box.Add(self.dtg_info, 0, wx.ALL, 6)

        add_dtg_btn = wx.Button(panel, label="Add DTG as sheet (TGA~DTG)")
        add_dtg_btn.SetToolTip("Publish the derivative curve as its own sheet, "
                               "so it saves, exports and plots like any other.")
        add_dtg_btn.Bind(wx.EVT_BUTTON, self.on_add_dtg_sheet)
        calc_box.Add(add_dtg_btn, 0, wx.EXPAND | wx.ALL, 5)
        vbox.Add(calc_box, 0, wx.EXPAND | wx.ALL, 5)

        peak_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "DTG Peaks")
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Sensitivity:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.dtg_prominence_ctrl = wx.SpinCtrlDouble(
            panel, min=0.5, max=50.0, initial=5.0, inc=0.5, size=(80, -1))
        self.dtg_prominence_ctrl.SetDigits(1)
        self.dtg_prominence_ctrl.SetToolTip(
            "Minimum peak size as a percentage of the largest. Lower finds more.")
        row.Add(self.dtg_prominence_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="%"), 0, wx.ALIGN_CENTER_VERTICAL, 0)
        detect_btn = wx.Button(panel, label="Detect peaks")
        detect_btn.Bind(wx.EVT_BUTTON, self.on_detect_dtg_peaks)
        row.Add(detect_btn, 0, wx.ALL, 5)
        add_btn = wx.Button(panel, label="Add at range centre")
        add_btn.SetToolTip("Add a peak by hand at the centre of the selected range")
        add_btn.Bind(wx.EVT_BUTTON, self.on_add_dtg_peak)
        row.Add(add_btn, 0, wx.ALL, 5)
        del_btn = wx.Button(panel, label="Delete selected")
        del_btn.Bind(wx.EVT_BUTTON, self.on_delete_dtg_peak)
        row.Add(del_btn, 0, wx.ALL, 5)
        peak_box.Add(row, 0, wx.EXPAND)
        vbox.Add(peak_box, 0, wx.EXPAND | wx.ALL, 5)

        self.dtg_grid = self._make_grid(
            panel, ('Onset', 'Peak T', 'End T', 'Peak height', 'Δm', 'Direction'))
        vbox.Add(self.dtg_grid, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # -------------------------------------------------------------- DSC tab --

    def _build_dsc_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        self.dsc_info = wx.StaticText(panel, label="")
        vbox.Add(self.dsc_info, 0, wx.ALL, 10)

        conv_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Sign Convention")
        self.exo_up_radio = wx.RadioButton(panel, label="Exothermic up",
                                           style=wx.RB_GROUP)
        self.exo_down_radio = wx.RadioButton(panel, label="Exothermic down")
        for radio in (self.exo_up_radio, self.exo_down_radio):
            radio.Bind(wx.EVT_RADIOBUTTON, self.on_exo_changed)
            conv_box.Add(radio, 0, wx.ALL, 6)
        conv_box.Add(_grey(panel, "(read from the file's EXO flag where present)"),
                     0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 10)
        vbox.Add(conv_box, 0, wx.EXPAND | wx.ALL, 5)

        base_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Baseline")
        row = wx.BoxSizer(wx.HORIZONTAL)
        self.baseline_choice = wx.Choice(panel, choices=list(BASELINE_METHODS),
                                         size=(160, -1))
        self.baseline_choice.SetSelection(0)
        self.baseline_choice.Bind(wx.EVT_CHOICE, self.on_baseline_changed)
        row.Add(self.baseline_choice, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Poly order:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.poly_order_ctrl = wx.SpinCtrl(panel, min=1, max=6, initial=2,
                                           size=(55, -1))
        row.Add(self.poly_order_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Anchors:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        self.anchors_ctrl = wx.TextCtrl(panel, size=(120, -1))
        self.anchors_ctrl.SetToolTip("Comma-separated temperatures for the "
                                     "manual-anchor baseline, e.g. 310, 480")
        row.Add(self.anchors_ctrl, 0, wx.ALL, 5)
        base_box.Add(row, 0, wx.EXPAND)

        self.baseline_desc = wx.StaticText(panel, label="")
        self.baseline_desc.SetForegroundColour(GREY)
        base_box.Add(self.baseline_desc, 0, wx.ALL, 6)

        preview_btn = wx.Button(panel, label="Preview baseline on the plot")
        preview_btn.Bind(wx.EVT_BUTTON, self.on_preview_baseline)
        base_box.Add(preview_btn, 0, wx.ALL | wx.EXPAND, 6)
        vbox.Add(base_box, 0, wx.EXPAND | wx.ALL, 5)

        add_dsc_btn = wx.Button(panel, label="Add DSC as sheet (TGA~DSC)")
        add_dsc_btn.SetToolTip("Publish the heat-flow trace as its own sheet, "
                               "so it saves, exports and plots like any other.")
        add_dsc_btn.Bind(wx.EVT_BUTTON, self.on_add_dsc_sheet)
        vbox.Add(add_dsc_btn, 0, wx.EXPAND | wx.ALL, 5)

        vbox.Add(self._build_range_box(panel, TAB_DSC, "Temperature Range", "T"),
                 0, wx.EXPAND | wx.ALL, 5)

        area_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Peak")
        btn_row = wx.BoxSizer(wx.HORIZONTAL)
        area_btn = wx.Button(panel, label="Integrate peak")
        area_btn.SetBackgroundColour(KHERVE_GREEN)
        area_btn.Bind(wx.EVT_BUTTON, self.on_dsc_area)
        btn_row.Add(area_btn, 1, wx.ALL, 5)
        clear_btn = wx.Button(panel, label="Clear peaks")
        clear_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_clear('TGA_DSC_Peaks'))
        btn_row.Add(clear_btn, 0, wx.ALL, 5)
        area_box.Add(btn_row, 0, wx.EXPAND)
        vbox.Add(area_box, 0, wx.EXPAND | wx.ALL, 5)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Results")
        self.dsc_results = self._make_readout(panel)
        result_box.Add(self.dsc_results, 1, wx.EXPAND | wx.ALL, 5)
        vbox.Add(result_box, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # -------------------------------------------------------- Heat Flow tab --

    def _build_heatflow_tab(self, notebook):
        """DSC-primary analysis: heat flow against temperature.

        Works on a sheet imported from a TA TRIOS .tri (or any heat-flow sheet):
        peak integration for melting / crystallisation enthalpies and the glass
        transition step, both read straight off the heat-flow trace rather than
        off a mass-vs-temperature derived sheet.
        """
        panel = wx.ScrolledWindow(notebook)
        panel.SetScrollRate(0, 10)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel,
                                      "DSC Sheet (heat flow vs temperature)")
        self.heatflow_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.heatflow_combo.Bind(wx.EVT_COMBOBOX, self.on_heatflow_selected)
        refresh_btn = wx.Button(panel, label="Refresh")
        refresh_btn.Bind(wx.EVT_BUTTON, lambda evt: self.refresh_sheet_lists())
        sheet_box.Add(self.heatflow_combo, 1, wx.ALL | wx.EXPAND, 5)
        sheet_box.Add(refresh_btn, 0, wx.ALL, 5)
        vbox.Add(sheet_box, 0, wx.EXPAND | wx.ALL, 5)

        self.heatflow_info = wx.StaticText(panel, label="")
        vbox.Add(self.heatflow_info, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 10)

        vbox.Add(_grey(panel,
                       "Bracket one event with the red dashed lines, then measure it. "
                       "A peak\ngives a melting / crystallisation enthalpy; the step "
                       "measurement gives the\nglass transition. Enter the sample mass "
                       "for J/g and ΔCp."),
                 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        # Sample mass + sign convention
        setup_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Sample")
        setup_box.Add(wx.StaticText(panel, label="Mass:"), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.hf_mass_ctrl = wx.TextCtrl(panel, size=(80, -1))
        self.hf_mass_ctrl.SetToolTip("Sample mass in mg. Needed to turn the "
                                     "integrated area into J/g and the step into "
                                     "ΔCp.")
        self.hf_mass_ctrl.Bind(wx.EVT_KILL_FOCUS, self.on_heatflow_mass_edited)
        setup_box.Add(self.hf_mass_ctrl, 0, wx.ALL, 5)
        setup_box.Add(wx.StaticText(panel, label="mg"), 0,
                      wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 12)
        self.hf_exo_up_radio = wx.RadioButton(panel, label="Exo up",
                                              style=wx.RB_GROUP)
        self.hf_exo_down_radio = wx.RadioButton(panel, label="Exo down")
        for radio in (self.hf_exo_up_radio, self.hf_exo_down_radio):
            radio.Bind(wx.EVT_RADIOBUTTON, self.on_heatflow_exo_changed)
            setup_box.Add(radio, 0, wx.ALL, 6)
        vbox.Add(setup_box, 0, wx.EXPAND | wx.ALL, 5)

        # Ramp / segment picker - a DSC run passes each temperature several
        # times (heat, cool, reheat), so one ramp has to be chosen before a peak
        # or a step means anything.
        ramp_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Ramp / segment")
        self.hf_segment_choice = wx.Choice(panel, size=(340, -1))
        self.hf_segment_choice.Bind(wx.EVT_CHOICE, self.on_heatflow_segment)
        ramp_box.Add(self.hf_segment_choice, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(ramp_box, 0, wx.EXPAND | wx.ALL, 5)

        # Baseline
        base_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Baseline")
        row = wx.BoxSizer(wx.HORIZONTAL)
        self.hf_baseline_choice = wx.Choice(panel, choices=list(BASELINE_METHODS),
                                            size=(150, -1))
        self.hf_baseline_choice.SetSelection(0)
        row.Add(self.hf_baseline_choice, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Poly:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 6)
        self.hf_poly_order_ctrl = wx.SpinCtrl(panel, min=1, max=6, initial=2,
                                              size=(50, -1))
        row.Add(self.hf_poly_order_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="Anchors:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 6)
        self.hf_anchors_ctrl = wx.TextCtrl(panel, size=(110, -1))
        row.Add(self.hf_anchors_ctrl, 0, wx.ALL, 5)
        base_box.Add(row, 0, wx.EXPAND)
        preview_btn = wx.Button(panel, label="Preview baseline on the plot")
        preview_btn.Bind(wx.EVT_BUTTON, self.on_heatflow_preview_baseline)
        base_box.Add(preview_btn, 0, wx.ALL | wx.EXPAND, 6)
        vbox.Add(base_box, 0, wx.EXPAND | wx.ALL, 5)

        vbox.Add(self._build_range_box(panel, TAB_HEATFLOW, "Temperature Range", "T"),
                 0, wx.EXPAND | wx.ALL, 5)

        # Peak integration
        peak_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                     "Peak (melting / crystallisation)")
        crys_row = wx.BoxSizer(wx.HORIZONTAL)
        crys_row.Add(wx.StaticText(panel, label="ΔH° (100 % cryst.):"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.hf_dh_ref_ctrl = wx.TextCtrl(panel, size=(70, -1))
        self.hf_dh_ref_ctrl.SetToolTip("Enthalpy of the fully crystalline "
                                       "polymer in J/g. Enter it to report a "
                                       "crystallinity %.")
        crys_row.Add(self.hf_dh_ref_ctrl, 0, wx.ALL, 5)
        crys_row.Add(wx.StaticText(panel, label="J/g"), 0,
                     wx.ALIGN_CENTER_VERTICAL, 0)
        peak_box.Add(crys_row, 0, wx.EXPAND)
        btn_row = wx.BoxSizer(wx.HORIZONTAL)
        area_btn = wx.Button(panel, label="Integrate peak (ΔH)")
        area_btn.SetBackgroundColour(KHERVE_GREEN)
        area_btn.Bind(wx.EVT_BUTTON, self.on_heatflow_area)
        btn_row.Add(area_btn, 1, wx.ALL, 5)
        clear_peak_btn = wx.Button(panel, label="Clear peaks")
        clear_peak_btn.Bind(wx.EVT_BUTTON,
                            lambda evt: self.on_clear('TGA_DSC_Peaks'))
        btn_row.Add(clear_peak_btn, 0, wx.ALL, 5)
        peak_box.Add(btn_row, 0, wx.EXPAND)
        vbox.Add(peak_box, 0, wx.EXPAND | wx.ALL, 5)

        # Glass transition
        tg_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Glass transition")
        tg_btn = wx.Button(panel, label="Measure Tg (step)")
        tg_btn.SetBackgroundColour(KHERVE_GREEN)
        tg_btn.Bind(wx.EVT_BUTTON, self.on_glass_transition)
        tg_box.Add(tg_btn, 1, wx.ALL, 5)
        clear_tg_btn = wx.Button(panel, label="Clear Tg")
        clear_tg_btn.Bind(wx.EVT_BUTTON,
                          lambda evt: self.on_clear('TGA_Glass_Transitions'))
        tg_box.Add(clear_tg_btn, 0, wx.ALL, 5)
        vbox.Add(tg_box, 0, wx.EXPAND | wx.ALL, 5)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Results")
        self.heatflow_results = self._make_readout(panel, height=170)
        result_box.Add(self.heatflow_results, 1, wx.EXPAND | wx.ALL, 5)
        vbox.Add(result_box, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # -------------------------------------------------- Heat Flow handlers --

    def _active_heatflow_sheet(self):
        """The heat-flow sheet the main plot is showing, or None (with a popup)."""
        sheet = self._active_sheet()
        if sheet is None:
            return None
        if sheet.get('TGA_Signal_Kind') != 'heatflow':
            self.parent.show_popup_message2(
                "Error", "Show a heat-flow DSC sheet (imported from a .tri) in "
                         "the main plot first.")
            return None
        return sheet

    def on_heatflow_selected(self, event):
        sheet_name = self._sheet_from_display(self.heatflow_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            self.heatflow_info.SetLabel(
                "No heat-flow DSC sheet. Import a .tri via "
                "File > Import > TGA / DSC.")
            return

        if event is not None:
            self._show_sheet(sheet_name)

        temperature = sheet.get('B.E.', [])
        info = (f"{len(temperature)} points, {min(temperature):.1f} - "
                f"{max(temperature):.1f} °C" if temperature else "empty sheet")
        source = sheet.get('TGA_Source', '')
        if source:
            info += f"   [{source}]"
        self.heatflow_info.SetLabel(info)

        mass = sheet.get('TGA_Sample_Mass_mg')
        self.hf_mass_ctrl.SetValue(f"{float(mass):g}" if mass else "")
        exo_up = bool(sheet.get('TGA_Exo_Up', True))
        self.hf_exo_up_radio.SetValue(exo_up)
        self.hf_exo_down_radio.SetValue(not exo_up)
        self._populate_segments(sheet)
        # Apply a ramp by default so the first measurement is unambiguous, but
        # only once - a stored choice (and any range the user set on it) stays.
        if event is not None and sheet.get('TGA_HeatFlow_Segment') is None \
                and self._selected_segment() is not None:
            self.on_heatflow_segment(None)
        self.update_range_controls()

    def _segment_options(self, sheet):
        """(segment_value, label) for each programme segment, plus a whole-run
        entry.  Label reads e.g. '2: heating -90 → 210 °C'."""
        options = [(None, "Whole run (all ramps overlaid)")]
        segment = sheet.get('TGA_Segment')
        temperature = sheet.get('B.E.')
        if not segment or not temperature:
            return options
        seg = np.asarray(segment, dtype=float)
        temp = np.asarray(temperature, dtype=float)
        for value in sorted({int(v) for v in seg}):
            mask = seg == value
            t = temp[mask]
            if t.size < 2:
                continue
            direction = _ramp_direction(t)
            if direction == 'isothermal':
                desc = f"isothermal ~{np.mean(t):.0f} °C"
            else:
                desc = f"{direction} {t[0]:.0f} → {t[-1]:.0f} °C"
            options.append((value, f"{value}: {desc}"))
        return options

    def _populate_segments(self, sheet):
        options = self._segment_options(sheet)
        self._hf_segment_values = [value for value, _ in options]
        self.hf_segment_choice.Set([label for _, label in options])
        # 'Whole run' is stored as None too, so distinguish never-chosen (key
        # absent) from an explicit whole-run pick before falling back.
        if 'TGA_HeatFlow_Segment' in sheet \
                and sheet['TGA_HeatFlow_Segment'] in self._hf_segment_values:
            index = self._hf_segment_values.index(sheet['TGA_HeatFlow_Segment'])
        elif len(options) > 1:
            index = 1  # default to the first real ramp, not the overlaid run
        else:
            index = 0
        self.hf_segment_choice.SetSelection(index)

    def _selected_segment(self):
        values = getattr(self, '_hf_segment_values', [None])
        index = self.hf_segment_choice.GetSelection()
        if index < 0 or index >= len(values):
            return None
        return values[index]

    def on_heatflow_segment(self, event):
        """Pick a ramp: store it and snap the range lines onto its span."""
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet or sheet.get('TGA_Signal_Kind') != 'heatflow':
            return
        value = self._selected_segment()
        sheet['TGA_HeatFlow_Segment'] = value
        segment = sheet.get('TGA_Segment')
        temperature = sheet.get('B.E.')
        if value is not None and segment and temperature:
            seg = np.asarray(segment, dtype=float)
            temp = np.asarray(temperature, dtype=float)[seg == value]
            if temp.size >= 2:
                self._set_range(float(np.min(temp)), float(np.max(temp)))
        self._persist()

    def _heatflow_indices(self, sheet):
        """Points inside the range lines, restricted to the chosen ramp so a
        temperature the run visits several times is not double-counted."""
        background = sheet.get('Background', {})
        low = background.get('Bkg Low')
        high = background.get('Bkg High')
        if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
            raise ValueError("Select a range on the main plot first.")
        return window_indices(sheet['B.E.'], low, high,
                              segment=sheet.get('TGA_Segment'),
                              segment_value=sheet.get('TGA_HeatFlow_Segment'))

    def on_heatflow_mass_edited(self, event):
        event.Skip()
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet or sheet.get('TGA_Signal_Kind') != 'heatflow':
            return
        mass = _optional_float(self.hf_mass_ctrl)
        sheet['TGA_Sample_Mass_mg'] = mass
        self._persist()

    def on_heatflow_exo_changed(self, event):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        sheet['TGA_Exo_Up'] = bool(self.hf_exo_up_radio.GetValue())
        self._persist()
        self._replot()

    def _heatflow_baseline_settings(self):
        anchors = []
        for token in self.hf_anchors_ctrl.GetValue().replace(';', ',').split(','):
            token = token.strip()
            if token:
                try:
                    anchors.append(float(token))
                except ValueError:
                    continue
        return {
            'baseline_method': self.hf_baseline_choice.GetStringSelection()
            or BASELINE_STRAIGHT,
            'anchors': anchors,
            'poly_order': self.hf_poly_order_ctrl.GetValue(),
        }

    def on_heatflow_preview_baseline(self, event):
        from libraries.ToolsMenu.TGA_Engine import dsc_baseline

        sheet = self._active_heatflow_sheet()
        if sheet is None:
            return
        try:
            indices = self._heatflow_indices(sheet)
            if indices.size < 3:
                raise ValueError("Select a wider range.")
            settings = self._heatflow_baseline_settings()
            t_sel = np.asarray(sheet['B.E.'], dtype=float)[indices]
            y_sel = np.asarray(sheet['Raw Data'], dtype=float)[indices]
            baseline = dsc_baseline(t_sel, y_sel,
                                    method=settings['baseline_method'],
                                    anchors=settings['anchors'],
                                    poly_order=settings['poly_order'])
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        sheet['TGA_Baseline_Preview'] = {
            'x': [float(v) for v in t_sel],
            'y': [float(v) for v in baseline],
            'method': settings['baseline_method'],
        }
        self._replot()
        self.heatflow_results.SetValue(
            f"Previewing the {settings['baseline_method'].lower()} baseline over "
            f"{t_sel[0]:.1f} - {t_sel[-1]:.1f} °C.")

    def on_heatflow_area(self, event):
        """Integrate a melting / crystallisation peak on the heat-flow trace."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_heatflow_sheet()
        if sheet is None:
            return

        settings = self._heatflow_baseline_settings()
        mass = _optional_float(self.hf_mass_ctrl)
        try:
            indices = self._heatflow_indices(sheet)
            result = dsc_area(sheet['B.E.'], sheet['Raw Data'], indices,
                              time_min=sheet.get('TGA_Time_min'),
                              dsc_label='Heat Flow (mW)',
                              exo_up=bool(self.hf_exo_up_radio.GetValue()),
                              sample_mass_mg=mass,
                              **settings)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        # The engine's mW branch returns the time integral in mW·s = mJ; the
        # enthalpy per gram is that over the sample mass (mJ/mg = J/g). It is
        # computed here rather than trusted from the engine, whose mW branch
        # assumes a per-mass signal.
        area_mj = result.get('area_time')
        enthalpy = area_mj / mass if (area_mj is not None and mass) else None

        save_state(self.parent)
        stored = dict(result)
        for key in ('baseline', 't_selected', 'y_selected'):
            stored[key] = [float(v) for v in result[key]]
        stored['enthalpy_j_per_g'] = enthalpy
        sheet.setdefault('TGA_DSC_Peaks', []).append(stored)
        sheet.pop('TGA_Baseline_Preview', None)

        self._append_result(self.heatflow_results,
                            self._format_heatflow_peak(result, enthalpy, mass))
        self._persist()
        self._replot()

    def _format_heatflow_peak(self, result, enthalpy, mass):
        def _t(v):
            return f"{v:.2f} °C" if isinstance(v, (int, float)) else "-"
        lines = [
            f"{result['nature'].capitalize()} peak, "
            f"{result['t_start']:.1f} - {result['t_end']:.1f} °C "
            f"({result['baseline_method']} baseline)",
            f"  Peak temperature : {_t(result.get('peak_temperature'))}",
            f"  Onset            : {_t(result.get('onset_temperature'))}",
            f"  Endset           : {_t(result.get('endset_temperature'))}",
            f"  Peak height      : {result.get('peak_height', 0):.4g} mW",
        ]
        if result.get('fwhm') is not None:
            lines.append(f"  FWHM             : {result['fwhm']:.2f} °C")
        if enthalpy is not None:
            lines.append(f"  ΔH               : {abs(enthalpy):.4g} J/g")
            ref = _optional_float(self.hf_dh_ref_ctrl)
            if ref:
                lines.append(f"  Crystallinity    : "
                             f"{abs(enthalpy) / ref * 100:.1f} %  (ΔH° = {ref:g} J/g)")
        else:
            lines.append("  ΔH               : enter the sample mass for J/g")
        rate = result.get('heating_rate')
        if rate:
            lines.append(f"  Heating rate     : {rate:.2f} K/min")
        return "\n".join(lines)

    def on_glass_transition(self, event):
        """Measure the glass-transition step on the heat-flow trace."""
        from libraries.FileMenu.Save import save_state
        from libraries.ToolsMenu.TGA_Engine import _heating_rate

        sheet = self._active_heatflow_sheet()
        if sheet is None:
            return

        mass = _optional_float(self.hf_mass_ctrl)
        try:
            indices = self._heatflow_indices(sheet)
            time_min = sheet.get('TGA_Time_min')
            t_sel = np.asarray(sheet['B.E.'], dtype=float)[indices]
            rate = (_heating_rate(t_sel, time_min, indices)
                    if time_min is not None else None)
            result = glass_transition(sheet['B.E.'], sheet['Raw Data'], indices,
                                      exo_up=bool(self.hf_exo_up_radio.GetValue()),
                                      heating_rate=rate, sample_mass_mg=mass)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        save_state(self.parent)
        stored = {
            'onset_temperature': result.get('onset_temperature'),
            'midpoint_temperature': result.get('midpoint_temperature'),
            'inflection_temperature': result.get('inflection_temperature'),
            'endset_temperature': result.get('endset_temperature'),
            'step_signal_mw': result.get('step_signal_mw'),
            'delta_cp': result.get('delta_cp'),
            't_selected': [float(v) for v in result['t_selected']],
            'pre_line': [float(v) for v in result['pre_line']],
            'post_line': [float(v) for v in result['post_line']],
        }
        sheet.setdefault('TGA_Glass_Transitions', []).append(stored)
        sheet.pop('TGA_Baseline_Preview', None)

        self._append_result(self.heatflow_results, format_glass_transition(result))
        self._persist()
        self._replot()

    # ----------------------------------------------------------- Events tab --

    def _build_events_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        vbox.Add(_grey(panel,
                       "Mass, DTG and DSC together suggest where the events are. "
                       "Everything below is\na suggestion to be reviewed and adjusted - "
                       "boundaries are only as good as the\nsmoothing, and a shoulder can "
                       "be read as one event or two."),
                 0, wx.ALL, 10)

        row = wx.BoxSizer(wx.HORIZONTAL)
        detect_btn = wx.Button(panel, label="Detect events")
        detect_btn.SetBackgroundColour(KHERVE_GREEN)
        detect_btn.Bind(wx.EVT_BUTTON, self.on_detect_events)
        row.Add(detect_btn, 1, wx.ALL, 5)
        del_btn = wx.Button(panel, label="Delete selected")
        del_btn.Bind(wx.EVT_BUTTON, self.on_delete_event)
        row.Add(del_btn, 0, wx.ALL, 5)
        clear_btn = wx.Button(panel, label="Clear all")
        clear_btn.Bind(wx.EVT_BUTTON, lambda evt: self.on_clear_events())
        row.Add(clear_btn, 0, wx.ALL, 5)
        vbox.Add(row, 0, wx.EXPAND | wx.ALL, 5)

        self.events_grid = self._make_grid(panel, EVENT_COLUMNS, editable_name=True)
        self.events_grid.Bind(wx.grid.EVT_GRID_SELECT_CELL, self.on_event_selected)
        vbox.Add(self.events_grid, 1, wx.EXPAND | wx.ALL, 5)

        interp_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                       "Possible readings (not conclusions)")
        self.interpretation = self._make_readout(panel, height=110)
        interp_box.Add(self.interpretation, 1, wx.EXPAND | wx.ALL, 5)
        vbox.Add(interp_box, 0, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # -------------------------------------------------------- Chemistry tab --

    def _build_chem_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        # Oxygen non-stoichiometry
        oxy_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Oxygen Non-Stoichiometry")
        grid = wx.FlexGridSizer(2, 4, 6, 6)
        grid.AddGrowableCol(1)
        grid.AddGrowableCol(3)

        self.oxide_formula_ctrl = wx.TextCtrl(panel, size=(150, -1))
        self.oxide_formula_ctrl.SetToolTip(
            "The oxide as it stands at the start of the step, "
            "e.g. BaCo0.4Fe0.4Zr0.1Y0.1O2.9")
        self.delta_initial_ctrl = wx.TextCtrl(panel, value="0", size=(80, -1))
        self.oxygen_sites_ctrl = wx.TextCtrl(panel, value="3", size=(80, -1))
        self.oxy_mass_ctrl = wx.TextCtrl(panel, size=(80, -1))
        self.oxy_mass_ctrl.SetToolTip(
            "Mass change in %. Filled from the selected region, or type one.")

        for label, ctrl in (("Formula:", self.oxide_formula_ctrl),
                            ("Initial δ:", self.delta_initial_ctrl),
                            ("O sites (3 for ABO3):", self.oxygen_sites_ctrl),
                            ("Mass change (%):", self.oxy_mass_ctrl)):
            grid.Add(wx.StaticText(panel, label=label), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
            grid.Add(ctrl, 1, wx.EXPAND)
        oxy_box.Add(grid, 0, wx.EXPAND | wx.ALL, 5)

        row = wx.BoxSizer(wx.HORIZONTAL)
        use_region = wx.Button(panel, label="Use selected region")
        use_region.Bind(wx.EVT_BUTTON, self.on_use_region_for_chem)
        row.Add(use_region, 0, wx.ALL, 5)
        oxy_btn = wx.Button(panel, label="Calculate δ")
        oxy_btn.SetBackgroundColour(KHERVE_GREEN)
        oxy_btn.Bind(wx.EVT_BUTTON, self.on_oxygen_calc)
        row.Add(oxy_btn, 1, wx.ALL, 5)
        oxy_box.Add(row, 0, wx.EXPAND)
        vbox.Add(oxy_box, 0, wx.EXPAND | wx.ALL, 5)

        # Theoretical mass change
        theo_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Theoretical Mass Change")
        grid = wx.FlexGridSizer(2, 4, 6, 6)
        grid.AddGrowableCol(1)
        grid.AddGrowableCol(3)
        self.host_formula_ctrl = wx.TextCtrl(panel, size=(150, -1))
        self.host_formula_ctrl.SetToolTip("Formula unit the species leaves, e.g. CaCO3")
        self.species_combo = wx.ComboBox(
            panel, choices=[label for label, _f in COMMON_SPECIES] + ['Custom…'],
            style=wx.CB_READONLY, size=(150, -1))
        self.species_combo.SetSelection(0)
        self.species_combo.Bind(wx.EVT_COMBOBOX, self.on_species_selected)
        self.species_formula_ctrl = wx.TextCtrl(panel, value="H2O", size=(80, -1))
        self.n_species_ctrl = wx.TextCtrl(panel, value="1", size=(80, -1))

        for label, ctrl in (("Host formula:", self.host_formula_ctrl),
                            ("Species:", self.species_combo),
                            ("Formula:", self.species_formula_ctrl),
                            ("Number per f.u.:", self.n_species_ctrl)):
            grid.Add(wx.StaticText(panel, label=label), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
            grid.Add(ctrl, 1, wx.EXPAND)
        theo_box.Add(grid, 0, wx.EXPAND | wx.ALL, 5)

        theo_btn = wx.Button(panel, label="Compare with the measured region")
        theo_btn.SetBackgroundColour(KHERVE_GREEN)
        theo_btn.Bind(wx.EVT_BUTTON, self.on_theoretical_calc)
        theo_box.Add(theo_btn, 0, wx.ALL | wx.EXPAND, 5)
        vbox.Add(theo_box, 0, wx.EXPAND | wx.ALL, 5)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Results")
        self.chem_results = self._make_readout(panel)
        result_box.Add(self.chem_results, 1, wx.EXPAND | wx.ALL, 5)
        vbox.Add(result_box, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # ----------------------------------------------------------- Cycles tab --

    def _build_cycles_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        vbox.Add(_grey(panel,
                       "For repeated heating, cooling, oxidation, reduction, "
                       "humidification or drying\ncycles: what the sample gives up and "
                       "takes back is reversible, what it does not\nis drift. Run this on "
                       "the time-view sheet, which holds the whole programme."),
                 0, wx.ALL, 10)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Stabilisation tolerance:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.cycle_tol_ctrl = wx.SpinCtrlDouble(panel, min=0.1, max=50.0,
                                                initial=5.0, inc=0.5, size=(75, -1))
        self.cycle_tol_ctrl.SetDigits(1)
        row.Add(self.cycle_tol_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label="% of amplitude"), 0,
                wx.ALIGN_CENTER_VERTICAL, 0)
        cycle_btn = wx.Button(panel, label="Analyse cycles")
        cycle_btn.SetBackgroundColour(KHERVE_GREEN)
        cycle_btn.Bind(wx.EVT_BUTTON, self.on_cycle_analysis)
        row.Add(cycle_btn, 1, wx.ALL, 5)
        vbox.Add(row, 0, wx.EXPAND | wx.ALL, 5)

        self.cycles_grid = self._make_grid(
            panel, ('Cycle', 'T range', 'Start', 'End', 'Reversible',
                    'Irreversible', 'Recovery %', 'Drift', 'Hysteresis'))
        vbox.Add(self.cycles_grid, 1, wx.EXPAND | wx.ALL, 5)

        self.cycles_summary = self._make_readout(panel, height=90)
        vbox.Add(self.cycles_summary, 0, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------- Isothermal tab --

    def _build_isothermal_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        vbox.Add(_grey(panel,
                       "On a dwell the temperature is constant, so the mass relaxes "
                       "towards a new\nequilibrium and the shape of that relaxation says "
                       "how the process is limited.\nSuits oxygen uptake and release, "
                       "moisture, and redox recovery."),
                 0, wx.ALL, 10)

        vbox.Add(self._build_range_box(panel, TAB_ISO, "Time Range (min)", "t"),
                 0, wx.EXPAND | wx.ALL, 5)

        model_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Model")
        row = wx.BoxSizer(wx.HORIZONTAL)
        self.kinetic_choice = wx.Choice(panel, choices=list(KINETIC_MODELS),
                                        size=(180, -1))
        self.kinetic_choice.SetSelection(0)
        row.Add(self.kinetic_choice, 0, wx.ALL, 5)
        fit_btn = wx.Button(panel, label="Fit")
        fit_btn.SetBackgroundColour(KHERVE_GREEN)
        fit_btn.Bind(wx.EVT_BUTTON, self.on_fit_isothermal)
        row.Add(fit_btn, 1, wx.ALL, 5)
        all_btn = wx.Button(panel, label="Try all models")
        all_btn.SetToolTip("Fit every model and rank them by R²")
        all_btn.Bind(wx.EVT_BUTTON, self.on_fit_all_isothermal)
        row.Add(all_btn, 0, wx.ALL, 5)
        model_box.Add(row, 0, wx.EXPAND)

        add_kin_btn = wx.Button(panel, label="Add fit as sheet (TGA~Kinetics)")
        add_kin_btn.SetToolTip("Publish the measured dwell and the fitted "
                               "relaxation curve as their own sheet.")
        add_kin_btn.Bind(wx.EVT_BUTTON, self.on_add_kinetics_sheet)
        model_box.Add(add_kin_btn, 0, wx.EXPAND | wx.ALL, 5)

        arr_btn = wx.Button(panel,
                            label="Arrhenius from all dwells (TGA~Arrhenius)")
        arr_btn.SetToolTip("Fit every isothermal hold of a stepped-isothermal "
                           "run, then fit ln k vs 1/T for the activation energy. "
                           "Run this on the time-view run, not a single ramp.")
        arr_btn.Bind(wx.EVT_BUTTON, self.on_arrhenius)
        model_box.Add(arr_btn, 0, wx.EXPAND | wx.ALL, 5)
        vbox.Add(model_box, 0, wx.EXPAND | wx.ALL, 5)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Results")
        self.iso_results = self._make_readout(panel)
        result_box.Add(self.iso_results, 1, wx.EXPAND | wx.ALL, 5)
        vbox.Add(result_box, 1, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # ---------------------------------------------------------- Compare tab --

    def _build_compare_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        vbox.Add(_grey(panel,
                       "Overlay several runs on one pair of axes. Every sheet keeps its "
                       "own data; the\noverlay is a view, so nothing is resampled or "
                       "modified."),
                 0, wx.ALL, 10)

        self.compare_list = wx.CheckListBox(panel, choices=[])
        vbox.Add(self.compare_list, 1, wx.EXPAND | wx.ALL, 5)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Show:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        self.compare_signal = wx.Choice(
            panel, choices=['Mass', 'DTG', 'DSC', 'Difference from first'],
            size=(160, -1))
        self.compare_signal.SetSelection(0)
        row.Add(self.compare_signal, 0, wx.ALL, 5)
        self.compare_align = wx.CheckBox(panel, label="Align on temperature")
        self.compare_align.SetValue(True)
        self.compare_align.SetToolTip(
            "Interpolate every run onto a shared temperature grid, so the "
            "curves can be compared point for point.")
        row.Add(self.compare_align, 0, wx.ALL | wx.ALIGN_CENTER_VERTICAL, 5)
        vbox.Add(row, 0, wx.EXPAND)

        btn_row = wx.BoxSizer(wx.HORIZONTAL)
        overlay_btn = wx.Button(panel, label="Overlay selected")
        overlay_btn.SetBackgroundColour(KHERVE_GREEN)
        overlay_btn.Bind(wx.EVT_BUTTON, self.on_overlay)
        btn_row.Add(overlay_btn, 1, wx.ALL, 5)
        clear_btn = wx.Button(panel, label="Clear overlay")
        clear_btn.Bind(wx.EVT_BUTTON, self.on_clear_overlay)
        btn_row.Add(clear_btn, 0, wx.ALL, 5)
        vbox.Add(btn_row, 0, wx.EXPAND)

        diff_btn = wx.Button(panel, label="Add difference as sheet (TGA~Diff)")
        diff_btn.SetToolTip("Publish the difference of the two ticked runs "
                            "(second − first) as its own sheet.")
        diff_btn.Bind(wx.EVT_BUTTON, self.on_add_diff_sheet)
        vbox.Add(diff_btn, 0, wx.EXPAND | wx.ALL, 5)

        self.compare_results = self._make_readout(panel, height=120)
        vbox.Add(self.compare_results, 0, wx.EXPAND | wx.ALL, 5)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------- helpers --

    def _make_readout(self, panel, height=-1):
        ctrl = wx.TextCtrl(panel, size=(-1, height),
                           style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_DONTWRAP)
        ctrl.SetFont(wx.Font(wx.FontInfo(9).Family(wx.FONTFAMILY_TELETYPE)))
        return ctrl

    def _make_grid(self, panel, columns, editable_name=False):
        grid = wx.grid.Grid(panel)
        grid.CreateGrid(0, len(columns))
        for i, name in enumerate(columns):
            grid.SetColLabelValue(i, name)
            grid.SetColSize(i, 78 if i else 130)
        grid.SetRowLabelSize(30)
        grid.SetColLabelSize(24)
        grid.EnableEditing(bool(editable_name))
        grid.SetDefaultCellFont(wx.Font(wx.FontInfo(9)))
        if editable_name:
            grid.Bind(wx.grid.EVT_GRID_CELL_CHANGED, self.on_event_name_edited)
        return grid

    def _build_range_box(self, panel, tab, title, symbol):
        """The min / max controls of one tab.

        Every tab drives the same two vlines, so each keeps its own pair of
        boxes and they are refreshed together.
        """
        box = wx.StaticBoxSizer(wx.VERTICAL, panel, title)
        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label=f"{symbol} min:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 5)
        low_ctrl = wx.TextCtrl(panel, size=(75, -1))
        row.Add(low_ctrl, 0, wx.ALL, 5)
        row.Add(wx.StaticText(panel, label=f"{symbol} max:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 8)
        high_ctrl = wx.TextCtrl(panel, size=(75, -1))
        row.Add(high_ctrl, 0, wx.ALL, 5)

        apply_btn = wx.Button(panel, label="Apply")
        apply_btn.SetToolTip("Move the red range lines to the values typed here")
        apply_btn.Bind(wx.EVT_BUTTON, self.on_apply_range)
        row.Add(apply_btn, 0, wx.ALL, 5)

        full_btn = wx.Button(panel, label="Full range")
        full_btn.Bind(wx.EVT_BUTTON, self.on_full_range)
        row.Add(full_btn, 0, wx.ALL, 5)
        box.Add(row, 0, wx.EXPAND)

        box.Add(_grey(panel, "Drag the red dashed lines on the main plot to "
                             "adjust the range."), 0, wx.ALL, 6)

        self._range_controls[tab] = (low_ctrl, high_ctrl)
        return box

    # --------------------------------------------------------------- data --

    def _core_levels(self):
        return self.parent.Data.get('Core levels', {})

    def _tga_sheets(self, view=None):
        out = []
        for name, sheet in self._core_levels().items():
            if not is_tga_sheet(name) or not isinstance(sheet, dict):
                continue
            if view is not None and sheet.get('TGA_View', VIEW_TEMPERATURE) != view:
                continue
            out.append(name)
        return out

    def _heatflow_sheets(self):
        """Imported DSC sheets whose main trace is heat flow, not mass."""
        out = []
        for name, sheet in self._core_levels().items():
            if not is_tga_sheet(name) or not isinstance(sheet, dict):
                continue
            if sheet.get('TGA_Signal_Kind') == 'heatflow':
                out.append(name)
        return out

    def _display_name(self, sheet_name):
        sheet = self._core_levels().get(sheet_name, {})
        label = sheet.get('TGA_Label', '')
        return f"{sheet_name}  -  {label}" if label else sheet_name

    @staticmethod
    def _sheet_from_display(combo):
        value = combo.GetValue()
        return value.split('  -  ')[0].strip() if value else ''

    def refresh_sheet_lists(self):
        active = self.parent.sheet_combobox.GetValue()

        runs = self._tga_sheets(VIEW_TIME)
        self.run_combo.Set([self._display_name(n) for n in runs])
        if active in runs:
            self.run_combo.SetValue(self._display_name(active))
        elif runs:
            self.run_combo.SetValue(self._display_name(runs[0]))

        derived = self._tga_sheets(VIEW_TEMPERATURE)
        self.mass_combo.Set([self._display_name(n) for n in derived])
        if active in derived:
            self.mass_combo.SetValue(self._display_name(active))
        elif derived:
            self.mass_combo.SetValue(self._display_name(derived[-1]))

        heatflow = self._heatflow_sheets()
        self.heatflow_combo.Set([self._display_name(n) for n in heatflow])
        if active in heatflow:
            self.heatflow_combo.SetValue(self._display_name(active))
        elif heatflow:
            self.heatflow_combo.SetValue(self._display_name(heatflow[0]))

        self.compare_list.Set([self._display_name(n)
                               for n in self._tga_sheets()])

        self.on_run_selected(None)
        self.on_derived_selected(None)
        self.on_heatflow_selected(None)
        self.update_range_controls()
        self._refresh_all_grids()

    def on_tab_changed(self, event):
        """Show the sheet the newly selected tab operates on."""
        event.Skip()
        page = event.GetSelection()
        key = (self._section_keys[page]
               if 0 <= page < len(self._section_keys) else None)
        # The Range and Cycles tabs work on the whole programme, the Heat Flow
        # tab on an imported DSC sheet; everything else on the derived
        # temperature sheet.
        if key == 'heatflow':
            combo = self.heatflow_combo
        elif key in ('range', 'cycles', 'isothermal'):
            combo = self.run_combo
        else:
            combo = self.mass_combo
        sheet_name = self._sheet_from_display(combo)
        if sheet_name and sheet_name in self._core_levels():
            self._show_sheet(sheet_name)

    def on_run_selected(self, event):
        sheet_name = self._sheet_from_display(self.run_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            self.run_info.SetLabel(
                "No time-based TGA run available. Import one via "
                "File > Import > TGA / DSC.")
            return

        if event is not None:
            self._show_sheet(sheet_name)

        x_values = sheet.get('B.E.', [])
        temperature = sheet.get('TGA_Temperature', sheet.get('Raw Data', []))
        info = (f"{len(x_values)} points, {min(x_values):.1f} - "
                f"{max(x_values):.1f} min, {min(temperature):.0f} - "
                f"{max(temperature):.0f} °C")
        source = sheet.get('TGA_Source', '')
        if source:
            info += f"   [{source}]"
        self.run_info.SetLabel(info)

        initial = sheet.get('TGA_Sample_Mass_mg')
        self.initial_mass_ctrl.SetValue(f"{float(initial):g}" if initial else "")
        self._update_blank_info(sheet)
        self.update_range_controls()

    def on_derived_selected(self, event):
        sheet_name = self._sheet_from_display(self.mass_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            self.mass_info.SetLabel(
                "No mass vs temperature sheet yet - generate one on the Range tab.")
            self.dsc_info.SetLabel("")
            return

        if event is not None:
            self._show_sheet(sheet_name)

        x_values = sheet.get('B.E.', [])
        smoothing = sheet.get('TGA_Smoothing')
        self.mass_info.SetLabel(
            f"{len(x_values)} points, {min(x_values):.1f} - {max(x_values):.1f} °C, "
            f"mass in {sheet.get('TGA_Y_Unit', '%')}"
            + (f"   [smoothed: {smoothing}]" if smoothing else ""))

        if sheet.get('TGA_DSC'):
            self.dsc_info.SetLabel(
                f"{sheet_name}: DSC signal in {sheet.get('TGA_DSC_Unit', '')}.")
        else:
            self.dsc_info.SetLabel(f"{sheet_name} carries no DSC signal.")

        exo_up = bool(sheet.get('TGA_Exo_Up', True))
        self.exo_up_radio.SetValue(exo_up)
        self.exo_down_radio.SetValue(not exo_up)

        layers = sheet.get('TGA_Layers') or {}
        self.layer_raw_check.SetValue(bool(layers.get('raw', True)))
        self.layer_dtg_check.SetValue(bool(layers.get('dtg')))
        self.legend_ctrl.SetValue(sheet.get('TGA_Raw_Legend', '') or '')

        self.on_baseline_changed(None)
        self.update_range_controls()
        self._refresh_all_grids()

    def _show_sheet(self, sheet_name):
        from libraries.Sheet_Operations import on_sheet_selected
        if self.parent.sheet_combobox.GetValue() != sheet_name:
            self.parent.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(self.parent, sheet_name)
        self.show_range_vlines()
        self.update_range_controls()

    def _active_sheet(self):
        """The sheet the main plot is showing, if it is a TGA one."""
        sheet_name = self.parent.sheet_combobox.GetValue()
        sheet = self._core_levels().get(sheet_name)
        if not sheet or not is_tga_sheet(sheet_name):
            self.parent.show_popup_message2(
                "Error", "Show a TGA sheet in the main plot first.")
            return None
        return sheet

    def _active_derived_sheet(self):
        """The temperature-view sheet the main plot is showing, or None."""
        sheet = self._active_sheet()
        if sheet is None:
            return None
        if sheet.get('TGA_View') == VIEW_TIME:
            self.parent.show_popup_message2(
                "Error", "This is the run against time. Generate a mass vs "
                         "temperature sheet from it on the Range tab first.")
            return None
        return sheet

    # ---------------------------------------------------------- blank runs --

    def on_import_blank(self, event):
        """Load a blank (empty-crucible) run and keep it against this sheet."""
        import os

        sheet_name = self._sheet_from_display(self.run_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            self.parent.show_popup_message2("Error", "Select a TGA run first.")
            return

        with wx.FileDialog(self, "Open the blank run",
                           wildcard="TGA files (*.csv;*.txt;*.dat)|"
                                    "*.csv;*.CSV;*.txt;*.TXT;*.dat;*.DAT|"
                                    "All files (*.*)|*.*",
                           style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as dlg:
            if dlg.ShowModal() == wx.ID_CANCEL:
                return
            path = dlg.GetPath()

        try:
            parsed = parse_tga_file(path)
        except Exception as e:
            self.parent.show_popup_message2("Error",
                                            f"Could not read the blank run: {e}")
            return

        sheet['TGA_Blank_Source'] = os.path.basename(path)
        sheet['TGA_Blank_Temperature'] = [float(v) for v in parsed['temperature']]
        if parsed['mass_mg'] is not None:
            sheet['TGA_Blank_Mass'] = [float(v) for v in parsed['mass_mg']]
        elif parsed['mass_pct'] is not None:
            sheet['TGA_Blank_Mass'] = [float(v) for v in parsed['mass_pct']]
        if parsed['dsc'] is not None:
            sheet['TGA_Blank_DSC'] = [float(v) for v in parsed['dsc']]

        self._update_blank_info(sheet)
        self._persist()

    def _update_blank_info(self, sheet):
        source = sheet.get('TGA_Blank_Source')
        if not source:
            self.blank_info.SetLabel("No blank run loaded.")
            self.blank_apply_btn.Enable(False)
            return

        note = ''
        if sheet.get('TGA_Blank_Temperature') and sheet.get('TGA_Temperature'):
            note = blank_coverage_note(sheet['TGA_Temperature'],
                                       sheet['TGA_Blank_Temperature'])
        applied = ' (subtracted)' if sheet.get('TGA_Blank_Applied') else ''
        self.blank_info.SetLabel(f"Blank: {source}{applied}"
                                 + (f"\n{note}" if note else ""))
        self.blank_apply_btn.Enable(not sheet.get('TGA_Blank_Applied'))

    def on_subtract_blank(self, event):
        """Subtract the loaded blank from the mass and DSC of this run."""
        from libraries.FileMenu.Save import save_state

        sheet_name = self._sheet_from_display(self.run_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet or not sheet.get('TGA_Blank_Source'):
            self.parent.show_popup_message2("Error", "Import a blank run first.")
            return
        if sheet.get('TGA_Blank_Applied'):
            self.parent.show_popup_message2(
                "Information", "The blank has already been subtracted.")
            return

        temperature = sheet.get('TGA_Temperature')
        blank_t = sheet.get('TGA_Blank_Temperature')
        if not temperature or not blank_t:
            self.parent.show_popup_message2(
                "Error", "This run or the blank has no temperature column.")
            return

        save_state(self.parent)
        corrected_any = []

        blank_mass = sheet.get('TGA_Blank_Mass')
        if blank_mass and sheet.get('TGA_Mass_mg'):
            try:
                corrected, interpolated, _ov = subtract_blank(
                    temperature, sheet['TGA_Mass_mg'], blank_t, blank_mass)
            except ValueError as e:
                self.parent.show_popup_message2("Error", str(e))
                return
            # A blank carries drift, not mass: adding its own starting value
            # back removes the drift while leaving the sample's mass intact.
            corrected = np.asarray(corrected) + float(np.asarray(interpolated)[0])
            sheet['TGA_Mass_mg_Uncorrected'] = list(sheet['TGA_Mass_mg'])
            sheet['TGA_Mass_mg'] = [float(v) for v in corrected]
            sheet['TGA_Blank_Interpolated'] = [float(v) for v in interpolated]
            corrected_any.append('mass')

        blank_dsc = sheet.get('TGA_Blank_DSC')
        if blank_dsc and sheet.get('TGA_DSC'):
            try:
                corrected, interpolated, _ov = subtract_blank(
                    temperature, sheet['TGA_DSC'], blank_t, blank_dsc)
            except ValueError as e:
                self.parent.show_popup_message2("Error", str(e))
                return
            sheet['TGA_DSC_Uncorrected'] = list(sheet['TGA_DSC'])
            sheet['TGA_DSC'] = [float(v) for v in corrected]
            sheet['TGA_Blank_DSC_Interpolated'] = [float(v) for v in interpolated]
            corrected_any.append('DSC')

        if not corrected_any:
            self.parent.show_popup_message2(
                "Error", "The blank has no trace in common with this run.")
            return

        sheet['TGA_Blank_Applied'] = True
        self._rebuild_percent(sheet)

        if self.blank_show_check.GetValue():
            self._create_correction_sheet(sheet, sheet_name)

        self._update_blank_info(sheet)
        self._persist()
        self._replot()
        self.gen_status.SetLabel(
            f"Blank subtracted from the {' and '.join(corrected_any)} of {sheet_name}.")

    @staticmethod
    def _rebuild_percent(sheet):
        """Keep the percentage trace in step with the milligrams."""
        mass = sheet.get('TGA_Mass_mg')
        if not mass:
            return
        reference = sheet.get('TGA_Sample_Mass_mg') or mass[0]
        if reference:
            sheet['TGA_Mass_Pct'] = [v * 100.0 / float(reference) for v in mass]

    def _create_correction_sheet(self, sheet, source_name):
        """Put the interpolated blank on its own sheet, so it can be inspected.

        The correction is as much a measurement as the sample run - a blank
        with a step in it means the crucible or the atmosphere is contributing
        something, and that has to be visible rather than silently removed.
        """
        interpolated = sheet.get('TGA_Blank_Interpolated')
        if not interpolated:
            return

        core_levels = self._core_levels()
        new_name = next_tga_sheet_name(core_levels.keys())
        x_values = list(sheet['B.E.'])
        entry = {
            'Name': new_name,
            'B.E.': x_values,
            'Raw Data': [float(v) for v in interpolated],
            'TGA_View': sheet.get('TGA_View', VIEW_TIME),
            'TGA_X_Label': sheet.get('TGA_X_Label', 'Time (min)'),
            'TGA_Y_Label': 'Blank mass (mg)',
            'TGA_Y_Unit': 'mg',
            'TGA_Label': f"blank correction for {source_name}",
            'TGA_Parent': source_name,
            'TGA_Temperature': list(sheet.get('TGA_Temperature', [])),
            'TGA_Time_min': list(sheet.get('TGA_Time_min', [])),
            'ExperimentalInfo': {'Technique': 'TGA blank correction',
                                 'Source File': sheet.get('TGA_Blank_Source', '')},
            'Background': {
                'Bkg Y': [float(v) for v in interpolated],
                'Bkg Type': '', 'Bkg Low': min(x_values), 'Bkg High': max(x_values),
                'Bkg Offset Low': 0, 'Bkg Offset High': 0,
            },
        }
        blank_dsc = sheet.get('TGA_Blank_DSC_Interpolated')
        if blank_dsc:
            entry['TGA_DSC'] = list(blank_dsc)
            entry['TGA_DSC_Unit'] = sheet.get('TGA_DSC_Unit', '')

        core_levels[new_name] = entry
        self.parent.Data['Number of Core levels'] = len(core_levels)
        if self.parent.sheet_combobox.FindString(new_name) == -1:
            self.parent.sheet_combobox.Append(new_name)

    def on_clear_blank(self, event):
        """Undo the blank subtraction, restoring the measured traces."""
        from libraries.FileMenu.Save import save_state

        sheet_name = self._sheet_from_display(self.run_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet or not sheet.get('TGA_Blank_Applied'):
            self.parent.show_popup_message2(
                "Information", "No blank subtraction to undo on this run.")
            return

        save_state(self.parent)
        if sheet.get('TGA_Mass_mg_Uncorrected'):
            sheet['TGA_Mass_mg'] = list(sheet.pop('TGA_Mass_mg_Uncorrected'))
        if sheet.get('TGA_DSC_Uncorrected'):
            sheet['TGA_DSC'] = list(sheet.pop('TGA_DSC_Uncorrected'))
        sheet['TGA_Blank_Applied'] = False
        self._rebuild_percent(sheet)

        self._update_blank_info(sheet)
        self._persist()
        self._replot()

    # ------------------------------------------------- derived temperature --

    def on_generate(self, event):
        """Build a mass vs temperature sheet from the selected time slice."""
        from libraries.FileMenu.Save import save_state

        sheet_name = self._sheet_from_display(self.run_combo)
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            self.parent.show_popup_message2("Error", "Select a TGA run first.")
            return
        if self.parent.sheet_combobox.GetValue() != sheet_name:
            self._show_sheet(sheet_name)

        initial_mass = _optional_float(self.initial_mass_ctrl)

        try:
            indices = self._range_indices(sheet)
            if indices.size < 2:
                raise ValueError("Select a wider time range - fewer than two "
                                 "points fall inside it.")
            new_sheet = self._build_derived_sheet(sheet, sheet_name, indices,
                                                  initial_mass)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        save_state(self.parent)

        core_levels = self._core_levels()
        # Mass-vs-temperature is the 'Mass' view; name it TGA~Mass so it takes
        # its own Sample Manager column, the same '~' convention EIS uses.
        new_name = next_tga_view_sheet_name(core_levels.keys(), 'Mass')
        new_sheet['Name'] = new_name
        core_levels[new_name] = new_sheet
        self.parent.Data['Number of Core levels'] = len(core_levels)

        self._persist()

        if self.parent.sheet_combobox.FindString(new_name) == -1:
            self.parent.sheet_combobox.Append(new_name)

        self.refresh_sheet_lists()
        self.mass_combo.SetValue(self._display_name(new_name))
        self._show_sheet(new_name)
        self._select_section('mass')
        self.gen_status.SetLabel(f"Created {new_name}: {new_sheet['TGA_Label']}")

    def _select_section(self, key):
        """Show the tab for ``key`` if this window has it (a single-section
        pop-out may not), addressing it by live page index — not the fixed
        TAB_* constant, which is out of range once only some tabs are shown."""
        if key in self._section_keys:
            self.notebook.SetSelection(self._section_keys.index(key))

    def _build_derived_sheet(self, source_sheet, source_name, indices,
                             initial_mass):
        """Slice every trace of the run and assemble the temperature-view sheet."""
        temperature = np.asarray(source_sheet['TGA_Temperature'],
                                 dtype=float)[indices]

        mass_key = 'TGA_Mass_mg' if source_sheet.get('TGA_Mass_mg') else 'TGA_Mass_Pct'
        if not source_sheet.get(mass_key):
            raise ValueError("This run carries no mass trace.")
        mass = np.asarray(source_sheet[mass_key], dtype=float)[indices]

        # Everything downstream is defined against milligrams, so convert a
        # percentage-only file once, here, rather than in every calculation.
        if mass_key == 'TGA_Mass_Pct':
            reference = initial_mass or source_sheet.get('TGA_Sample_Mass_mg')
            if not reference:
                raise ValueError("This run holds only a mass percentage. Enter "
                                 "the initial mass in mg so it can be converted.")
            mass_mg = mass * float(reference) / 100.0
        else:
            mass_mg = mass

        mode = NORMALISATION_MODES[self.norm_choice.GetSelection()]
        try:
            y_values, y_unit, y_label = normalise_mass(
                mass_mg, mode,
                initial_mass=initial_mass or source_sheet.get('TGA_Sample_Mass_mg'),
                range_start_mass=float(mass_mg[0]),
                dry_mass=_optional_float(self.dry_mass_ctrl),
                molar_mass=_optional_float(self.molar_mass_ctrl))
        except ValueError as e:
            raise ValueError(str(e))

        time_min = np.asarray(source_sheet['B.E.'], dtype=float)[indices]
        direction = _ramp_direction(temperature)
        label = (f"{source_sheet.get('TGA_Label', source_name)} - "
                 f"{direction} {temperature[0]:.0f}-{temperature[-1]:.0f} °C "
                 f"({time_min[0]:.0f}-{time_min[-1]:.0f} min)")

        x_values = [float(v) for v in temperature]
        y_list = [float(v) for v in y_values]
        x_lo, x_hi = min(x_values), max(x_values)
        span = x_hi - x_lo

        sheet = {
            'B.E.': x_values,
            'Raw Data': y_list,
            'TGA_View': VIEW_TEMPERATURE,
            'TGA_X_Label': X_LABEL_TEMPERATURE,
            'TGA_Y_Label': y_label,
            'TGA_Y_Unit': y_unit,
            'TGA_Mass_Label': y_label,
            'TGA_Mass_Unit': y_unit,
            'TGA_Norm_Mode': mode,
            'TGA_Normalised': mode != NORM_RAW_MG,
            'TGA_Label': label,
            'TGA_Parent': source_name,
            'TGA_Ramp': direction,
            'TGA_Range_Time': [float(time_min[0]), float(time_min[-1])],
            'TGA_Layers': {'raw': True, 'dtg': False},
            'ExperimentalInfo': dict(source_sheet.get('ExperimentalInfo', {})),
            'Background': {
                'Bkg Y': list(y_list),
                'Bkg Type': '',
                'Bkg Low': float(x_lo + 0.25 * span),
                'Bkg High': float(x_lo + 0.75 * span),
                'Bkg Offset Low': 0,
                'Bkg Offset High': 0,
            },
        }

        for key in CARRIED_META:
            if key in source_sheet:
                sheet[key] = source_sheet[key]
        if initial_mass:
            sheet['TGA_Sample_Mass_mg'] = float(initial_mass)

        for key in SLICED_TRACES:
            values = source_sheet.get(key)
            if values is not None and len(values) == len(source_sheet['B.E.']):
                sheet[key] = [float(v) for v in
                              np.asarray(values, dtype=float)[indices]]
        # The milligram trace is the reference every basis is derived from, so
        # it must survive even when the file only had percentages.
        sheet['TGA_Mass_mg'] = [float(v) for v in mass_mg]
        if sheet.get('TGA_Blank_Applied'):
            sheet['TGA_Blank_Applied'] = True
        return sheet

    def on_apply_normalisation(self, event):
        """Put an existing derived sheet onto a different mass basis."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_Mass_mg'):
            self.parent.show_popup_message2(
                "Error", "This sheet has no milligram trace to re-reference.")
            return

        mode = NORMALISATION_MODES[self.mass_norm_choice.GetSelection()]
        try:
            values, unit, label = normalise_mass(
                sheet['TGA_Mass_mg'], mode,
                initial_mass=sheet.get('TGA_Sample_Mass_mg'),
                range_start_mass=float(sheet['TGA_Mass_mg'][0]),
                dry_mass=_optional_float(self.dry_mass_ctrl),
                molar_mass=_optional_float(self.molar_mass_ctrl))
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        save_state(self.parent)
        sheet['Raw Data'] = [float(v) for v in values]
        sheet['TGA_Y_Label'] = label
        sheet['TGA_Y_Unit'] = unit
        sheet['TGA_Mass_Label'] = label
        sheet['TGA_Mass_Unit'] = unit
        sheet['TGA_Norm_Mode'] = mode
        sheet['Background']['Bkg Y'] = list(sheet['Raw Data'])
        if unit == '%':
            sheet['TGA_Mass_Pct'] = list(sheet['Raw Data'])
        # A re-referenced trace invalidates the smoothing snapshot
        sheet.pop('TGA_Mass_Raw', None)
        sheet.pop('TGA_Smoothing', None)

        self._persist()
        self._replot()
        self.on_derived_selected(None)
        self.smooth_info.SetLabel(f"Mass basis: {mode}")

    # ----------------------------------------------------------- smoothing --

    def on_smooth(self, event):
        """Smooth the mass trace of the derived sheet, non-destructively."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return

        # The measurement is kept, so smoothing is always reversible and every
        # pass starts from the data rather than from the last result.
        raw = sheet.get('TGA_Mass_Raw') or list(sheet['Raw Data'])
        method = self.smooth_choice.GetStringSelection()
        width = self.smooth_width_ctrl.GetValue()

        try:
            smoothed = smooth_trace(raw, method=method, width=width)
        except Exception as e:
            self.parent.show_popup_message2("Error", f"Smoothing failed: {e}")
            return

        save_state(self.parent)
        sheet['TGA_Mass_Raw'] = [float(v) for v in raw]
        sheet['Raw Data'] = [float(v) for v in smoothed]
        sheet['TGA_Smoothing'] = f"{method}, {width} points"
        sheet['TGA_Smoothing_Params'] = {'method': method, 'width': int(width)}
        if sheet.get('TGA_Y_Unit') == '%':
            sheet['TGA_Mass_Pct'] = list(sheet['Raw Data'])
        sheet.setdefault('Background', {})['Bkg Y'] = list(sheet['Raw Data'])

        self._persist()
        self._replot()
        self.smooth_info.SetLabel(
            f"Smoothed: {sheet['TGA_Smoothing']}. The raw trace is kept and "
            f"shown as its own layer.")
        self.on_derived_selected(None)

    def on_restore_raw(self, event):
        """Undo the smoothing, putting the measured trace back."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_Mass_Raw'):
            self.parent.show_popup_message2(
                "Information", "This trace has not been smoothed.")
            return

        save_state(self.parent)
        sheet['Raw Data'] = list(sheet['TGA_Mass_Raw'])
        if sheet.get('TGA_Y_Unit') == '%':
            sheet['TGA_Mass_Pct'] = list(sheet['Raw Data'])
        sheet.setdefault('Background', {})['Bkg Y'] = list(sheet['Raw Data'])
        sheet.pop('TGA_Mass_Raw', None)
        sheet.pop('TGA_Smoothing', None)
        sheet.pop('TGA_Smoothing_Params', None)

        self._persist()
        self._replot()
        self.smooth_info.SetLabel("Raw mass trace restored.")

    def on_apply_legend(self, event):
        """Rename the measured trace in the legend.

        'Raw Data' is the internal name of the trace, and rarely what the
        figure should say next to it.
        """
        sheet = self._active_sheet()
        if sheet is None:
            return
        sheet['TGA_Raw_Legend'] = self.legend_ctrl.GetValue().strip()
        self._persist()
        self._replot()

    def on_layers_changed(self, event):
        """Show or hide the raw / DTG layers."""
        sheet = self._active_sheet()
        if sheet is None:
            return
        sheet['TGA_Layers'] = {'raw': self.layer_raw_check.GetValue(),
                               'dtg': self.layer_dtg_check.GetValue()}
        if sheet['TGA_Layers']['dtg'] and not sheet.get('TGA_DTG'):
            self._compute_dtg(sheet, quiet=True)
        self._persist()
        self._replot()

    # ----------------------------------------------------------------- DTG --

    def _compute_dtg(self, sheet, quiet=False):
        """Calculate and store the DTG trace for a sheet."""
        mode = self.dtg_mode_choice.GetStringSelection() or DTG_PER_TEMPERATURE
        width = self.dtg_width_ctrl.GetValue()
        try:
            values, unit = derivative_trace(
                sheet['Raw Data'],
                temperature=sheet.get('B.E.') if sheet.get('TGA_View') !=
                VIEW_TIME else sheet.get('TGA_Temperature'),
                time_min=sheet.get('TGA_Time_min'),
                mode=mode, smooth_width=width)
        except ValueError as e:
            if not quiet:
                self.parent.show_popup_message2("Error", str(e))
            return False

        sheet['TGA_DTG'] = [float(v) for v in values]
        sheet['TGA_DTG_Mode'] = mode
        sheet['TGA_DTG_Label'] = f"{mode} ({sheet.get('TGA_Y_Unit', '%')}{unit})"
        sheet['TGA_DTG_Params'] = {'mode': mode, 'width': int(width)}
        return True

    def on_calculate_dtg(self, event):
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        save_state(self.parent)
        if not self._compute_dtg(sheet):
            return

        layers = sheet.setdefault('TGA_Layers', {})
        layers['dtg'] = True
        self.layer_dtg_check.SetValue(True)

        finite = [v for v in sheet['TGA_DTG'] if np.isfinite(v)]
        self.dtg_info.SetLabel(
            f"{sheet['TGA_DTG_Label']}: range {min(finite):.4g} to "
            f"{max(finite):.4g}")
        self._persist()
        self._replot()

    def on_add_dtg_sheet(self, event):
        """Publish the derivative curve as its own TGA~DTG sheet."""
        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DTG') and not self._compute_dtg(sheet):
            return
        name = self._publish_view_sheet(
            sheet, 'DTG', sheet['TGA_DTG'],
            sheet.get('TGA_DTG_Label', 'DTG'))
        if name:
            self.dtg_info.SetLabel(f"Added {name}.")

    def on_add_dsc_sheet(self, event):
        """Publish the heat-flow trace as its own TGA~DSC sheet."""
        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        dsc = sheet.get('TGA_DSC')
        if not dsc:
            self.parent.show_popup_message2(
                "Information", "This sheet carries no DSC / heat-flow channel.")
            return
        self._publish_view_sheet(
            sheet, 'DSC', dsc, sheet.get('TGA_DSC_Unit', 'DSC (µV/mg)'))

    def _publish_view_sheet(self, source_sheet, suffix, y_values, y_label,
                            x_values=None, x_label=None, extra=None):
        """Create a TGA~<suffix> sheet from a trace of the active derived sheet.

        The new sheet groups with the same run (shares its TGA_Parent root) and
        plots as an ordinary temperature-view curve — no right-hand axes, since
        it carries only the one signal. ``x_values`` / ``x_label`` override the
        abscissa (a kinetics sheet is against time); ``extra`` merges in extra
        sheet keys (e.g. a stored fit curve), overriding the defaults.
        """
        from libraries.FileMenu.Save import save_state

        x = source_sheet.get('B.E.', []) if x_values is None else x_values
        if not x or y_values is None or len(y_values) != len(x):
            self.parent.show_popup_message2(
                "Error", f"No {suffix} data of the right length to publish.")
            return None

        save_state(self.parent)
        core_levels = self._core_levels()
        new_name = next_tga_view_sheet_name(core_levels.keys(), suffix)
        # Share the run root so every view sits in one family (and one Sample
        # Manager column group).
        root = (source_sheet.get('TGA_Parent')
                or self.parent.sheet_combobox.GetValue())
        x_list = [float(v) for v in x]
        y_list = [float(v) for v in y_values]
        x_lo, x_hi = min(x_list), max(x_list)
        span = x_hi - x_lo or 1.0

        new_sheet = {
            'Name': new_name,
            'B.E.': x_list,
            'Raw Data': y_list,
            'TGA_View': VIEW_TEMPERATURE,
            'TGA_X_Label': (x_label if x_label is not None
                            else source_sheet.get('TGA_X_Label',
                                                  X_LABEL_TEMPERATURE)),
            'TGA_Y_Label': y_label,
            'TGA_Y_Unit': y_label,
            'TGA_Label': f"{source_sheet.get('TGA_Label', '')} - {suffix}".strip(
                ' -'),
            'TGA_Parent': root,
            'ExperimentalInfo': dict(source_sheet.get('ExperimentalInfo', {})),
            'Background': {
                'Bkg Y': list(y_list), 'Bkg Type': '',
                'Bkg Low': float(x_lo + 0.25 * span),
                'Bkg High': float(x_lo + 0.75 * span),
                'Bkg Offset Low': 0, 'Bkg Offset High': 0,
            },
        }
        if extra:
            new_sheet.update(extra)
        core_levels[new_name] = new_sheet
        self.parent.Data['Number of Core levels'] = len(core_levels)
        self._persist()

        if self.parent.sheet_combobox.FindString(new_name) == -1:
            self.parent.sheet_combobox.Append(new_name)
        self.refresh_sheet_lists()
        self._show_sheet(new_name)
        return new_name

    def on_detect_dtg_peaks(self, event):
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DTG') and not self._compute_dtg(sheet):
            return

        save_state(self.parent)
        temperature = np.asarray(sheet['B.E.'], dtype=float)
        dtg = np.asarray(sheet['TGA_DTG'], dtype=float)
        fraction = self.dtg_prominence_ctrl.GetValue() / 100.0

        peaks = []
        for peak in find_dtg_peaks(temperature, dtg, prominence_fraction=fraction):
            peaks.append(self._describe_dtg_peak(sheet, temperature, dtg, peak))

        sheet['TGA_DTG_Peaks'] = peaks
        self._persist()
        self._refresh_dtg_grid()
        if not peaks:
            self.dtg_info.SetLabel("No DTG peaks found at this sensitivity.")

    def _describe_dtg_peak(self, sheet, temperature, dtg, peak):
        """Turn a raw peak index into a full row: bounds, onset, mass change."""
        t_start, t_end, i_start, i_end = dtg_peak_bounds(temperature, dtg,
                                                         peak['index'])
        mass = np.asarray(sheet['Raw Data'], dtype=float)
        # The onset is the ISO construction on the DTG peak itself, which is
        # what makes it comparable with the DSC onset.
        segment = slice(i_start, max(i_end + 1, i_start + 3))
        onset = extrapolated_onset(temperature[segment], dtg[segment],
                                   max(peak['index'] - i_start, 1))
        return {
            'index': int(peak['index']),
            'peak_temperature': float(peak['peak_temperature']),
            'peak_height': float(peak['peak_height']),
            'direction': peak['direction'],
            't_start': float(t_start),
            't_end': float(t_end),
            'onset_temperature': onset,
            'mass_change': float(mass[i_end] - mass[i_start]),
        }

    def on_add_dtg_peak(self, event):
        """Add a DTG peak by hand at the centre of the selected range."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DTG') and not self._compute_dtg(sheet):
            return

        try:
            indices = self._range_indices(sheet)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return
        if indices.size < 3:
            self.parent.show_popup_message2("Error", "Select a wider range.")
            return

        temperature = np.asarray(sheet['B.E.'], dtype=float)
        dtg = np.asarray(sheet['TGA_DTG'], dtype=float)
        # Take the extremum inside the range, which is what the user means by
        # 'the peak here' even when the centre of the range is not on it.
        window = dtg[indices]
        local = int(np.nanargmax(np.abs(window)))
        index = int(indices[local])

        save_state(self.parent)
        peak = {'index': index,
                'peak_temperature': float(temperature[index]),
                'peak_height': float(dtg[index]),
                'direction': 'loss' if dtg[index] < 0 else 'gain'}
        row = self._describe_dtg_peak(sheet, temperature, dtg, peak)
        row['manual'] = True
        sheet.setdefault('TGA_DTG_Peaks', []).append(row)
        sheet['TGA_DTG_Peaks'].sort(key=lambda p: p['peak_temperature'])

        self._persist()
        self._refresh_dtg_grid()

    def on_delete_dtg_peak(self, event):
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        row = self._selected_row(self.dtg_grid)
        peaks = sheet.get('TGA_DTG_Peaks', [])
        if row is None or row >= len(peaks):
            self.parent.show_popup_message2(
                "Information", "Select a peak in the table first.")
            return
        save_state(self.parent)
        peaks.pop(row)
        self._persist()
        self._refresh_dtg_grid()

    def _refresh_dtg_grid(self):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue(), {})
        peaks = sheet.get('TGA_DTG_Peaks', []) or []
        unit = sheet.get('TGA_Y_Unit', '%')
        rows = []
        for peak in peaks:
            rows.append([
                f"{peak['onset_temperature']:.1f}" if peak.get('onset_temperature')
                else '-',
                f"{peak['peak_temperature']:.1f}",
                f"{peak['t_end']:.1f}",
                f"{peak['peak_height']:.4g}",
                f"{peak['mass_change']:+.3f} {unit}",
                peak['direction'] + (' (manual)' if peak.get('manual') else ''),
            ])
        self._fill_grid(self.dtg_grid, rows)

    # ------------------------------------------------------- range vlines --

    def show_range_vlines(self):
        """Create/restore the red dashed range lines on the current sheet."""
        window = self.parent
        sheet_name = window.sheet_combobox.GetValue()
        sheet = self._core_levels().get(sheet_name)
        if not sheet or not is_tga_sheet(sheet_name):
            return

        background = sheet.setdefault('Background', {})
        x_values = sheet.get('B.E.', [])
        if not x_values:
            return

        x_lo, x_hi = min(x_values), max(x_values)
        span = x_hi - x_lo
        low = background.get('Bkg Low')
        high = background.get('Bkg High')
        if not isinstance(low, (int, float)) or not (x_lo <= low <= x_hi):
            low = x_lo + 0.25 * span
        if not isinstance(high, (int, float)) or not (x_lo <= high <= x_hi):
            high = x_lo + 0.75 * span
        background['Bkg Low'] = float(min(low, high))
        background['Bkg High'] = float(max(low, high))

        for attr in ('vline1', 'vline2'):
            line = getattr(window, attr, None)
            if line is not None:
                try:
                    line.remove()
                except (ValueError, NotImplementedError):
                    pass
            setattr(window, attr, None)

        window.vline1 = window.ax.axvline(background['Bkg Low'], color='r',
                                          linestyle='--', alpha=0.7)
        window.vline2 = window.ax.axvline(background['Bkg High'], color='r',
                                          linestyle='--', alpha=0.7)
        window.canvas.draw_idle()

    def update_range_controls(self):
        """Refresh every open TGA window's range boxes from the stored range.

        Also called by the mouse handler while a range line is being dragged;
        the range lives on the sheet, so fan the refresh out to each window.
        """
        for win in list(getattr(self.parent, '_tga_windows', None) or [self]):
            try:
                win._refresh_range_controls()
            except RuntimeError:
                pass

    def _refresh_range_controls(self):
        """Copy the stored range into this window's tab min / max boxes."""
        sheet_name = self.parent.sheet_combobox.GetValue()
        sheet = self._core_levels().get(sheet_name)
        if not sheet or not is_tga_sheet(sheet_name):
            return
        background = sheet.get('Background', {})
        low, high = background.get('Bkg Low'), background.get('Bkg High')
        for value, index in ((low, 0), (high, 1)):
            if isinstance(value, (int, float)):
                for controls in self._range_controls.values():
                    controls[index].SetValue(f"{float(value):.1f}")

        self._describe_selection(sheet, low, high)

    def _describe_selection(self, sheet, low, high):
        """Say what the time selection covers, in temperature terms."""
        if sheet.get('TGA_View') != VIEW_TIME:
            return
        if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
            return
        try:
            indices = self._range_indices(sheet)
        except ValueError:
            return
        if indices.size < 2:
            self.selection_info.SetLabel("Selected: fewer than two points.")
            return

        temperature = np.asarray(sheet['TGA_Temperature'], dtype=float)[indices]
        text = (f"Selected: {low:.1f} - {high:.1f} min, "
                f"{temperature[0]:.0f} → {temperature[-1]:.0f} °C "
                f"({_ramp_direction(temperature)}, {indices.size} points)")

        segments = sheet.get('TGA_Segment')
        if segments:
            covered = sorted({int(v) for v in
                              np.asarray(segments, dtype=float)[indices]})
            text += f", segment{'s' if len(covered) > 1 else ''} " \
                    f"{', '.join(str(s) for s in covered)}"
        self.selection_info.SetLabel(text)

    def _set_range(self, low, high):
        """Store a range and move the plot's range lines onto it."""
        sheet_name = self.parent.sheet_combobox.GetValue()
        sheet = self._core_levels().get(sheet_name)
        if not sheet:
            return
        low, high = float(min(low, high)), float(max(low, high))
        background = sheet.setdefault('Background', {})
        background['Bkg Low'], background['Bkg High'] = low, high

        if getattr(self.parent, 'vline1', None) is not None:
            self.parent.vline1.set_xdata([low])
        if getattr(self.parent, 'vline2', None) is not None:
            self.parent.vline2.set_xdata([high])
        self.parent.canvas.draw_idle()
        self.update_range_controls()

    def _current_range_tab(self):
        """TAB_* constant of the tab currently shown (maps a pop-out's page 0
        back to its real section)."""
        page = self.notebook.GetSelection()
        key = (self._section_keys[page]
               if 0 <= page < len(self._section_keys) else None)
        return self.SECTION_TAB.get(key, page)

    def on_apply_range(self, event):
        controls = self._range_controls.get(self._current_range_tab())
        if controls is None:
            return
        low_ctrl, high_ctrl = controls
        try:
            low = _parse_float(low_ctrl, "Range minimum", allow_zero=True)
            high = _parse_float(high_ctrl, "Range maximum", allow_zero=True)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return
        self._set_range(low, high)

    def on_full_range(self, event):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if sheet and sheet.get('B.E.'):
            self._set_range(min(sheet['B.E.']), max(sheet['B.E.']))

    def _range_indices(self, sheet):
        """Points of the sheet inside the selected range, in acquisition order."""
        background = sheet.get('Background', {})
        low = background.get('Bkg Low')
        high = background.get('Bkg High')
        if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
            raise ValueError("Select a range on the main plot first.")
        return window_indices(sheet['B.E.'], low, high)

    # --------------------------------------------------------- mass change --

    def on_mass_step(self, event):
        """Measure a mass-change region and keep it alongside the others."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return

        try:
            indices = self._range_indices(sheet)
            result = mass_step(sheet['B.E.'], sheet['Raw Data'], indices,
                               initial_mass=sheet.get('TGA_Sample_Mass_mg'),
                               n_average=self.average_ctrl.GetValue(),
                               unit=sheet.get('TGA_Y_Unit', '%'))
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        save_state(self.parent)
        name = self.region_name_ctrl.GetValue().strip()
        result['name'] = name
        # A stable id ties the stored region to its Label Manager entry, so the
        # right annotation is replaced or removed when the region is.
        result['region_id'] = self._next_region_id(sheet)

        # Regions accumulate: several steps in one thermogram is the normal
        # case, and each is a separate event.
        sheet.setdefault('TGA_Steps', []).append(result)
        self._write_step_label(sheet, result)
        self._sync_events_from_steps(sheet)

        self._persist()
        self._replot()
        self._refresh_all_grids()
        self._update_label_manager_if_open()
        self.region_name_ctrl.SetValue('')

    @staticmethod
    def _next_region_id(sheet):
        used = {step.get('region_id', 0) for step in sheet.get('TGA_Steps', [])}
        candidate = 1
        while candidate in used:
            candidate += 1
        return candidate

    def _write_step_label(self, sheet, result):
        """Draw the region as a Label Manager 'step' entry.

        Going through Labels rather than drawing our own artist means the user
        can drag, restyle or delete it from the Label Manager like any other
        annotation, and it is saved with the project for free.
        """
        labels = sheet.setdefault('Labels', [])

        if result.get('delta_pct') is not None:
            text = f"{float(result['delta_pct']):+.2f} %"
        else:
            text = f"{float(result['delta']):+.4g} {result.get('unit', '')}"
        if result.get('name'):
            text = f"{result['name']}: {text}"

        entry = {
            'type': 'step',
            'text': text,
            'tga_step_label': True,
            'tga_region_id': result['region_id'],
            # The two levels span the selected range, and the arrow between
            # them sits at its warm end.
            'x': float(result['t_start']),
            'y': float(result['mass_start']),
            'x2': float(result['t_end']),
            'y2': float(result['mass_end']),
            'x_arrow': float(result['t_end']),
            'x_left': float(result['t_start']),
            'x_left2': float(result['t_start']),
            'color': '#4FBE9F',
            'linewidth': 1.5,
            'mutation_scale': 14,
            'fontsize': int(self.label_font_ctrl.GetValue()),
        }

        existing = next((i for i, lb in enumerate(labels)
                         if lb.get('tga_step_label') and
                         lb.get('tga_region_id') == result['region_id']), None)
        if existing is None:
            labels.append(entry)
        else:
            labels[existing] = entry

    def _update_label_manager_if_open(self):
        """Refresh the Label Manager list so new entries show up in it."""
        try:
            labels_window = getattr(self.parent, 'labels_window', None)
            if labels_window is not None and not labels_window.IsBeingDeleted():
                labels_window.update_list()
        except Exception as e:
            print(f"Error updating Label Manager: {e}")

    def on_delete_region(self, event):
        """Remove one region and the annotation that belongs to it."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        row = self._selected_row(self.mass_grid)
        steps = sheet.get('TGA_Steps', [])
        if row is None or row >= len(steps):
            self.parent.show_popup_message2(
                "Information", "Select a region in the table first.")
            return

        save_state(self.parent)
        region_id = steps[row].get('region_id')
        steps.pop(row)
        sheet['Labels'] = [lb for lb in sheet.get('Labels', [])
                           if not (lb.get('tga_step_label') and
                                   lb.get('tga_region_id') == region_id)]
        self._sync_events_from_steps(sheet)
        self._persist()
        self._replot()
        self._refresh_all_grids()
        self._update_label_manager_if_open()

    def on_clear_regions(self):
        from libraries.FileMenu.Save import save_state

        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        save_state(self.parent)
        sheet['TGA_Steps'] = []
        sheet['Labels'] = [lb for lb in sheet.get('Labels', [])
                           if not lb.get('tga_step_label')]
        self._sync_events_from_steps(sheet)
        self._persist()
        self._replot()
        self._refresh_all_grids()
        self._update_label_manager_if_open()

    def _sync_events_from_steps(self, sheet):
        """Mirror the measured regions into the shared event table.

        The event table is the joined view: a region measured on the Mass tab
        and a peak integrated on the DSC tab describe the same event, so they
        are matched on temperature rather than kept in two unrelated lists.
        """
        events = []
        for step in sheet.get('TGA_Steps', []) or []:
            events.append({
                'name': step.get('name', ''),
                'region_id': step.get('region_id'),
                't_start': step['t_start'],
                't_end': step['t_end'],
                'mass_change_mg': step.get('delta_mg'),
                'mass_change_pct': step.get('delta_pct'),
                'onset_temperature': None,
                'dtg_peak_temperature': None,
                'dsc_peak_temperature': None,
                'enthalpy_j_per_g': None,
                'kind': 'mass',
            })

        # Attach the DTG peak and the DSC peak that fall inside each region
        for peak in sheet.get('TGA_DTG_Peaks', []) or []:
            for event in events:
                if event['t_start'] <= peak['peak_temperature'] <= event['t_end']:
                    event['dtg_peak_temperature'] = peak['peak_temperature']
                    event['onset_temperature'] = peak.get('onset_temperature')
                    break

        for peak in sheet.get('TGA_DSC_Peaks', []) or []:
            placed = False
            for event in events:
                if event['t_start'] <= peak['peak_temperature'] <= event['t_end']:
                    event['dsc_peak_temperature'] = peak['peak_temperature']
                    event['enthalpy_j_per_g'] = peak.get('enthalpy_j_per_g')
                    if event['onset_temperature'] is None:
                        event['onset_temperature'] = peak.get('onset_temperature')
                    placed = True
                    break
            if not placed:
                # A thermal event with no mass step is still an event
                events.append({
                    'name': '', 'region_id': None,
                    't_start': peak['t_start'], 't_end': peak['t_end'],
                    'mass_change_mg': None, 'mass_change_pct': None,
                    'onset_temperature': peak.get('onset_temperature'),
                    'dtg_peak_temperature': None,
                    'dsc_peak_temperature': peak.get('peak_temperature'),
                    'enthalpy_j_per_g': peak.get('enthalpy_j_per_g'),
                    'kind': 'thermal',
                })

        events.sort(key=lambda e: e['t_start'])
        # Names the user typed into the event table are kept across a rebuild
        previous = {(e.get('region_id'), round(e['t_start'], 2)): e.get('name', '')
                    for e in sheet.get('TGA_Events', []) or []}
        for event in events:
            if not event['name']:
                event['name'] = previous.get(
                    (event.get('region_id'), round(event['t_start'], 2)), '')
        sheet['TGA_Events'] = events

    # ----------------------------------------------------------------- DSC --

    def on_exo_changed(self, event):
        """Record the sign convention on the sheet."""
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        sheet['TGA_Exo_Up'] = bool(self.exo_up_radio.GetValue())
        self._persist()
        self._replot()

    def on_baseline_changed(self, event):
        method = self.baseline_choice.GetStringSelection() or BASELINE_STRAIGHT
        self.baseline_desc.SetLabel(BASELINE_DESCRIPTIONS.get(method, ''))
        self.baseline_desc.Wrap(600)

    def _baseline_settings(self):
        """The baseline method and its parameters, as the engine wants them."""
        anchors = []
        for token in self.anchors_ctrl.GetValue().replace(';', ',').split(','):
            token = token.strip()
            if token:
                try:
                    anchors.append(float(token))
                except ValueError:
                    continue
        return {
            'baseline_method': self.baseline_choice.GetStringSelection()
            or BASELINE_STRAIGHT,
            'anchors': anchors,
            'poly_order': self.poly_order_ctrl.GetValue(),
        }

    def on_preview_baseline(self, event):
        """Draw the baseline that would be used, without integrating anything."""
        from libraries.ToolsMenu.TGA_Engine import dsc_baseline

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DSC'):
            self.parent.show_popup_message2("Error", "This sheet has no DSC signal.")
            return

        try:
            indices = self._range_indices(sheet)
            if indices.size < 3:
                raise ValueError("Select a wider range.")
            settings = self._baseline_settings()
            t_sel = np.asarray(sheet['B.E.'], dtype=float)[indices]
            y_sel = np.asarray(sheet['TGA_DSC'], dtype=float)[indices]
            baseline = dsc_baseline(t_sel, y_sel,
                                    method=settings['baseline_method'],
                                    anchors=settings['anchors'],
                                    poly_order=settings['poly_order'])
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        sheet['TGA_Baseline_Preview'] = {
            'x': [float(v) for v in t_sel],
            'y': [float(v) for v in baseline],
            'method': settings['baseline_method'],
        }
        self._replot()
        self.dsc_results.SetValue(
            f"Previewing the {settings['baseline_method'].lower()} baseline over "
            f"{t_sel[0]:.1f} - {t_sel[-1]:.1f} °C.\n"
            f"{BASELINE_DESCRIPTIONS.get(settings['baseline_method'], '')}")

    def on_dsc_area(self, event):
        """Integrate the DSC peak inside the selected temperature range."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DSC'):
            self.parent.show_popup_message2(
                "Error", f"{sheet.get('Name', 'This sheet')} carries no DSC signal.")
            return

        settings = self._baseline_settings()
        if settings['baseline_method'] == BASELINE_BLANK and \
                not sheet.get('TGA_Blank_Applied'):
            self.parent.show_popup_message2(
                "Error", "The blank-subtracted baseline needs a blank run "
                         "subtracted first, on the Range tab.")
            return

        try:
            indices = self._range_indices(sheet)
            result = dsc_area(sheet['B.E.'], sheet['TGA_DSC'], indices,
                              time_min=sheet.get('TGA_Time_min'),
                              sensitivity=sheet.get('TGA_Sensitivity'),
                              dsc_label=sheet.get('TGA_DSC_Unit', 'DSC (µV/mg)'),
                              exo_up=bool(self.exo_up_radio.GetValue()),
                              sample_mass_mg=sheet.get('TGA_Sample_Mass_mg'),
                              **settings)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        save_state(self.parent)
        # The arrays are kept so the shaded area can be redrawn after a replot.
        stored = dict(result)
        for key in ('baseline', 't_selected', 'y_selected'):
            stored[key] = [float(v) for v in result[key]]

        sheet.setdefault('TGA_DSC_Peaks', []).append(stored)
        sheet.pop('TGA_Baseline_Preview', None)
        self._sync_events_from_steps(sheet)

        self._append_result(self.dsc_results, format_dsc_area(result))
        self._persist()
        self._replot()
        self._refresh_all_grids()

    def on_clear(self, key):
        """Drop every stored measurement of one kind from the current sheet."""
        from libraries.FileMenu.Save import save_state

        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        save_state(self.parent)
        sheet[key] = []
        sheet.pop('TGA_Baseline_Preview', None)
        # The heat-flow tab shares TGA_DSC_Peaks with the DSC tab but keeps its
        # own readout; clear whichever readout matches the sheet on screen.
        if key == 'TGA_Glass_Transitions' or sheet.get('TGA_Signal_Kind') == 'heatflow':
            self.heatflow_results.SetValue("")
        if key == 'TGA_DSC_Peaks' and sheet.get('TGA_Signal_Kind') != 'heatflow':
            self.dsc_results.SetValue("")
        self._sync_events_from_steps(sheet)
        self._persist()
        self._replot()
        self._refresh_all_grids()

    # -------------------------------------------------------------- events --

    def on_detect_events(self, event):
        """Suggest events from the mass, DTG and DSC signals together."""
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        if not sheet.get('TGA_DTG'):
            self._compute_dtg(sheet, quiet=True)

        save_state(self.parent)
        fraction = self.dtg_prominence_ctrl.GetValue() / 100.0
        found = detect_events(sheet['B.E.'], sheet['Raw Data'],
                              dtg=sheet.get('TGA_DTG'),
                              dsc=sheet.get('TGA_DSC'),
                              time_min=sheet.get('TGA_Time_min'),
                              prominence_fraction=fraction)

        unit = sheet.get('TGA_Y_Unit', '%')
        events = []
        for item in found:
            events.append({
                'name': item.get('name', ''),
                'region_id': None,
                't_start': item['t_start'],
                't_end': item['t_end'],
                'mass_change_mg': (item['mass_change'] if unit == 'mg' else None),
                'mass_change_pct': (item['mass_change'] if unit == '%' else None),
                'onset_temperature': item.get('onset_temperature'),
                'dtg_peak_temperature': item.get('dtg_peak_temperature'),
                'dsc_peak_temperature': item.get('dsc_peak_temperature'),
                'enthalpy_j_per_g': item.get('enthalpy_j_per_g'),
                'kind': item.get('kind', 'mass'),
            })

        sheet['TGA_Events'] = events
        sheet['TGA_Events_Detected'] = True
        self._persist()
        self._refresh_events_grid()
        self.interpretation.SetValue(
            f"{len(events)} event(s) suggested. Select a row to see the "
            f"possible readings.\nAdjust the boundaries on the Mass tab before "
            f"quoting any number from this table.")

    def on_delete_event(self, event):
        from libraries.FileMenu.Save import save_state

        sheet = self._active_derived_sheet()
        if sheet is None:
            return
        row = self._selected_row(self.events_grid)
        events = sheet.get('TGA_Events', [])
        if row is None or row >= len(events):
            self.parent.show_popup_message2(
                "Information", "Select an event in the table first.")
            return
        save_state(self.parent)
        events.pop(row)
        self._persist()
        self._refresh_events_grid()

    def on_clear_events(self):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        sheet['TGA_Events'] = []
        sheet['TGA_Events_Detected'] = False
        self._persist()
        self._refresh_events_grid()
        self.interpretation.SetValue("")

    def on_event_selected(self, event):
        """Show the possible readings of the selected event."""
        event.Skip()
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        events = sheet.get('TGA_Events', []) or []
        row = event.GetRow()
        if row >= len(events):
            return

        item = events[row]
        change = item.get('mass_change_pct')
        if change is None:
            change = item.get('mass_change_mg') or 0.0
        readings = interpret_event({
            'kind': item.get('kind', 'mass'),
            'dtg_peak_temperature': item.get('dtg_peak_temperature')
            or item.get('t_start'),
            'mass_change': change,
        })
        header = (f"{item['t_start']:.0f} - {item['t_end']:.0f} °C"
                  + (f"  ({item['name']})" if item.get('name') else ''))
        self.interpretation.SetValue(
            header + "\n\nPossible readings - none of these is established by "
                     "the thermogram alone;\nonly an evolved-gas measurement "
                     "can identify a species:\n"
            + "\n".join(f"  - {line}" for line in readings))

    def on_event_name_edited(self, event):
        """Write a name typed in the event table back onto the event."""
        event.Skip()
        if event.GetCol() != 0:
            return
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return
        events = sheet.get('TGA_Events', []) or []
        row = event.GetRow()
        if row >= len(events):
            return
        name = self.events_grid.GetCellValue(row, 0)
        events[row]['name'] = name

        # Keep the region and its annotation in step with the renamed event
        region_id = events[row].get('region_id')
        if region_id is not None:
            for step in sheet.get('TGA_Steps', []) or []:
                if step.get('region_id') == region_id:
                    step['name'] = name
                    self._write_step_label(sheet, step)
                    break
            self._replot()
            self._update_label_manager_if_open()
        self._persist()

    # ----------------------------------------------------------- chemistry --

    def _selected_region_change(self):
        """The mass change of the selected region, as a percentage."""
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if not sheet:
            return None
        steps = sheet.get('TGA_Steps', []) or []
        row = self._selected_row(self.mass_grid)
        if row is None or row >= len(steps):
            # Fall back to the event table, which the Chemistry tab may be
            # driven from directly
            events = sheet.get('TGA_Events', []) or []
            row = self._selected_row(self.events_grid)
            if row is not None and row < len(events):
                return events[row].get('mass_change_pct')
            return None
        return steps[row].get('delta_pct')

    def on_use_region_for_chem(self, event):
        change = self._selected_region_change()
        if change is None:
            self.parent.show_popup_message2(
                "Information", "Select a mass-change region on the Mass tab first.")
            return
        self.oxy_mass_ctrl.SetValue(f"{change:.4f}")

    def on_species_selected(self, event):
        index = self.species_combo.GetSelection()
        if 0 <= index < len(COMMON_SPECIES):
            self.species_formula_ctrl.SetValue(COMMON_SPECIES[index][1])

    def on_oxygen_calc(self, event):
        """Oxygen non-stoichiometry from the selected mass change."""
        formula = self.oxide_formula_ctrl.GetValue().strip()
        if not formula:
            self.parent.show_popup_message2(
                "Error", "Enter the oxide formula, e.g. BaCo0.4Fe0.4Zr0.1Y0.1O2.9")
            return

        change = _optional_float(self.oxy_mass_ctrl)
        if change is None:
            change = self._selected_region_change()
        if change is None:
            self.parent.show_popup_message2(
                "Error", "Enter a mass change, or select a region on the Mass tab.")
            return

        try:
            result = oxygen_nonstoichiometry(
                formula,
                delta_initial=_optional_float(self.delta_initial_ctrl) or 0.0,
                mass_change_pct=change,
                reference_mass_mg=self._current_sample_mass(),
                oxygen_site_total=_optional_float(self.oxygen_sites_ctrl) or 3.0)
        except (FormulaError, ValueError) as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        self.chem_results.SetValue(format_nonstoichiometry(result))
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue())
        if sheet is not None:
            sheet['TGA_Oxygen_Result'] = {
                k: v for k, v in result.items() if k != 'assumptions'}
            self._persist()

    def _current_sample_mass(self):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue(), {})
        return sheet.get('TGA_Sample_Mass_mg')

    def on_theoretical_calc(self, event):
        """Expected mass change for a candidate species, against the measured one."""
        host = self.host_formula_ctrl.GetValue().strip()
        species = self.species_formula_ctrl.GetValue().strip()
        if not host or not species:
            self.parent.show_popup_message2(
                "Error", "Enter both the host formula and the species formula.")
            return

        try:
            result = theoretical_mass_change(
                host, species,
                n_species=_optional_float(self.n_species_ctrl) or 1.0,
                measured_pct=self._selected_region_change())
        except (FormulaError, ValueError) as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        text = format_theoretical(result)
        if result['measured_pct'] is None:
            text += ("\n  (No region selected on the Mass tab, so there is "
                     "nothing to compare with.)")
        self.chem_results.SetValue(text)

    # -------------------------------------------------------------- cycles --

    def on_cycle_analysis(self, event):
        """Split the run into cycles and quantify what comes back each time."""
        sheet = self._active_sheet()
        if sheet is None:
            return

        temperature = (sheet.get('TGA_Temperature')
                       if sheet.get('TGA_View') == VIEW_TIME else sheet.get('B.E.'))
        mass = (sheet.get('TGA_Mass_Pct') or sheet.get('TGA_Mass_mg')
                if sheet.get('TGA_View') == VIEW_TIME else sheet.get('Raw Data'))
        if not temperature or not mass:
            self.parent.show_popup_message2(
                "Error", "This sheet has no temperature or mass trace.")
            return

        try:
            cycles = split_cycles(temperature, segment=sheet.get('TGA_Segment'))
            result = cycle_analysis(temperature, mass, cycles,
                                    tolerance_fraction=
                                    self.cycle_tol_ctrl.GetValue() / 100.0)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        unit = (sheet.get('TGA_Mass_Unit')
                or ('%' if sheet.get('TGA_Mass_Pct') else 'mg'))
        rows = []
        for row in result['cycles']:
            rows.append([
                str(row['cycle']),
                f"{row['t_min']:.0f}-{row['t_max']:.0f}",
                f"{row['mass_start']:.4f}",
                f"{row['mass_end']:.4f}",
                f"{row['reversible']:.4f}",
                f"{row['irreversible']:+.4f}",
                f"{row['recovery_pct']:.1f}" if row['recovery_pct'] is not None else '-',
                f"{row['drift']:+.4f}",
                f"{row['hysteresis']:.4f}" if row['hysteresis'] is not None else '-',
            ])
        self._fill_grid(self.cycles_grid, rows)

        summary = [
            f"{result['n_cycles']} cycles, mass in {unit}",
            f"  Mean reversible change   = {result['mean_reversible']:.4f} {unit}",
            f"  Total irreversible drift = {result['total_irreversible']:+.4f} {unit}",
        ]
        if result['stabilised_at']:
            summary.append(f"  Stabilised from cycle {result['stabilised_at']} onwards")
        else:
            summary.append("  The mass had not stabilised by the last cycle - "
                           "the drift never fell inside the tolerance.")
        self.cycles_summary.SetValue("\n".join(summary))

        sheet['TGA_Cycles'] = result['cycles']
        self._persist()

    # ---------------------------------------------------------- isothermal --

    def on_fit_isothermal(self, event):
        result = self._fit_isothermal_model(
            self.kinetic_choice.GetStringSelection())
        if result is not None:
            self.iso_results.SetValue(format_isothermal(result))

    def on_fit_all_isothermal(self, event):
        """Fit every model and rank them, so the shape picks the mechanism."""
        lines = []
        best = None
        for model in KINETIC_MODELS:
            result = self._fit_isothermal_model(model, quiet=True)
            if result is None:
                lines.append((None, f"{model:24s} did not converge"))
                continue
            lines.append((result['r_squared'],
                          f"{model:24s} R² = {result['r_squared']:.6f}  "
                          f"RMSE = {result['rmse']:.4g}"))
            if best is None or result['r_squared'] > best['r_squared']:
                best = result

        if best is None:
            self.iso_results.SetValue("No model converged on this selection.")
            return

        ranked = sorted(lines, key=lambda row: (row[0] is None, -(row[0] or 0)))
        text = ["Model comparison (best first):"]
        text += [f"  {line}" for _score, line in ranked]
        text.append("")
        text.append("Best fit:")
        text.append(format_isothermal(best))
        text.append("")
        text.append("A higher R² does not by itself establish the mechanism - "
                    "a model with more\nparameters will almost always fit better.")
        self.iso_results.SetValue("\n".join(text))

    def on_add_kinetics_sheet(self, event):
        """Publish the fitted isothermal relaxation as a TGA~Kinetics sheet."""
        model = self.kinetic_choice.GetStringSelection()
        result = self._fit_isothermal_model(model)
        if result is None:
            return
        sheet = self._active_sheet()
        if sheet is None:
            return
        try:
            indices = self._range_indices(sheet)
        except ValueError as e:
            self.parent.show_popup_message2("Error", str(e))
            return

        time_all = sheet.get('TGA_Time_min') or sheet.get('B.E.')
        mass_all = ((sheet.get('TGA_Mass_Pct') or sheet.get('TGA_Mass_mg'))
                    if sheet.get('TGA_View') == VIEW_TIME else sheet.get('Raw Data'))
        t_sel = np.asarray(time_all, dtype=float)[indices]
        m_sel = np.asarray(mass_all, dtype=float)[indices]
        # result['t_relative'] starts at 0; put the fit back on the same
        # absolute time axis as the measured points.
        fit_x = (np.asarray(result['t_relative'], dtype=float) + t_sel[0]).tolist()
        fit_y = [float(v) for v in result['fitted']]
        unit = sheet.get('TGA_Y_Unit', '%')

        name = self._publish_view_sheet(
            sheet, 'Kinetics', [float(v) for v in m_sel], f"Mass ({unit})",
            x_values=[float(v) for v in t_sel], x_label="Time (min)",
            extra={'TGA_Fit_X': fit_x, 'TGA_Fit_Y': fit_y,
                   'TGA_Fit_Label': f"{model} fit",
                   'TGA_Kinetic_Model': model,
                   'TGA_Kinetic_R2': float(result['r_squared'])})
        if name:
            self.iso_results.SetValue(
                f"Added {name} ({model}, R² = {result['r_squared']:.5f}).\n\n"
                + format_isothermal(result))

    def on_arrhenius(self, event):
        """Fit every isothermal dwell of a stepped run and Arrhenius-fit them."""
        name = self.parent.sheet_combobox.GetValue()
        sheet = self._core_levels().get(name)
        if not sheet:
            self.parent.show_popup_message2("Error", "Select a TGA sheet first.")
            return

        # Arrhenius needs the WHOLE stepped programme (many dwells), which lives
        # on the time-view run — not a single derived ramp. Hop to the parent
        # run when a derived sheet is selected.
        if sheet.get('TGA_View') != VIEW_TIME:
            run_name = sheet.get('TGA_Parent')
            run = self._core_levels().get(run_name) if run_name else None
            if not run or run.get('TGA_View') != VIEW_TIME:
                self.parent.show_popup_message2(
                    "Error", "Run this on the time-view run (the full stepped "
                             "programme), not a single derived ramp.")
                return
            sheet, name = run, run_name

        time_min = sheet.get('TGA_Time_min') or sheet.get('B.E.')
        temperature = sheet.get('TGA_Temperature')
        mass = sheet.get('TGA_Mass_Pct') or sheet.get('TGA_Mass_mg')
        if not time_min or not temperature or not mass:
            self.parent.show_popup_message2(
                "Error", "This run needs time, temperature and mass traces for "
                         "a stepped-isothermal Arrhenius fit.")
            return

        model = self.kinetic_choice.GetStringSelection()
        try:
            result = arrhenius_from_dwells(
                time_min, temperature, mass,
                segment=sheet.get('TGA_Segment'), model=model)
        except ValueError as e:
            self.iso_results.SetValue(str(e))
            return

        # Publish ln k vs 1000/T with the straight-line fit overlaid.
        t_k = np.asarray(result['temperature_k'], dtype=float)
        ln_k = np.asarray(result['ln_k'], dtype=float)
        x_plot = 1000.0 / t_k
        order = np.argsort(x_plot)
        xs = np.linspace(float(x_plot.min()), float(x_plot.max()), 50)
        # ln k = intercept + slope*(1/T); 1/T = (x_plot/1000)
        fit_y = result['intercept'] + result['slope'] * (xs / 1000.0)
        ea = result['activation_energy_kj']

        new_name = self._publish_view_sheet(
            sheet, 'Arrhenius', [float(v) for v in ln_k[order]],
            'ln k  (k in min$^{-1}$)',
            x_values=[float(v) for v in x_plot[order]],
            x_label='1000/T  (K$^{-1}$)',
            extra={'TGA_Parent': name,
                   'TGA_Fit_X': [float(v) for v in xs],
                   'TGA_Fit_Y': [float(v) for v in fit_y],
                   'TGA_Fit_Label': f"Ea = {ea:.1f} kJ/mol",
                   'TGA_Label': f"Arrhenius ({model}) - "
                                f"Ea = {ea:.1f} kJ/mol",
                   'TGA_Arrhenius_Ea_kJ': ea,
                   'TGA_Arrhenius_A': result['pre_exponential'],
                   'TGA_Arrhenius_R2': result['r_squared']})

        lines = [f"Stepped-isothermal Arrhenius ({model})",
                 f"  {len(result['dwells'])} dwells",
                 f"  Ea = {ea:.2f} kJ/mol",
                 f"  ln A = {result['intercept']:.3f}  (A = "
                 f"{result['pre_exponential']:.4g} min⁻¹)",
                 f"  R² = {result['r_squared']:.5f}", "",
                 "  T (°C)     k (min⁻¹)     fit R²"]
        for r in result['dwells']:
            lines.append(f"  {r['t_c']:7.1f}   {r['k']:.5g}    "
                         f"{r['r_squared']:.4f}")
        if new_name:
            lines += ["", f"Published as {new_name}."]
        self.iso_results.SetValue("\n".join(lines))

    def _fit_isothermal_model(self, model, quiet=False):
        sheet = self._active_sheet()
        if sheet is None:
            return None

        time_min = sheet.get('TGA_Time_min')
        if not time_min:
            if not quiet:
                self.parent.show_popup_message2(
                    "Error", "This sheet has no time column, so an isothermal "
                             "relaxation cannot be fitted.")
            return None

        # The range lines are on the sheet's own x-axis, which is time on a
        # time-view sheet and temperature on a derived one.
        try:
            if sheet.get('TGA_View') == VIEW_TIME:
                indices = self._range_indices(sheet)
            else:
                indices = self._range_indices(sheet)
        except ValueError as e:
            if not quiet:
                self.parent.show_popup_message2("Error", str(e))
            return None

        mass = (sheet.get('TGA_Mass_Pct') or sheet.get('TGA_Mass_mg')
                if sheet.get('TGA_View') == VIEW_TIME else sheet.get('Raw Data'))
        try:
            return fit_isothermal(time_min, mass, indices, model=model)
        except ValueError as e:
            if not quiet:
                self.parent.show_popup_message2("Error", str(e))
            return None

    # --------------------------------------------------------- comparison --

    def on_overlay(self, event):
        """Overlay the checked sheets on the main plot."""
        names = [self._sheet_from_display_string(self.compare_list.GetString(i))
                 for i in self.compare_list.GetCheckedItems()]
        if len(names) < 1:
            self.parent.show_popup_message2(
                "Information", "Tick at least one sheet to overlay.")
            return

        signal = self.compare_signal.GetStringSelection()
        core_levels = self._core_levels()

        # Sheets of different views have different abscissas - minutes and
        # degrees - so overlaying them would put two incompatible quantities on
        # one axis and every comparison read off it would be meaningless.
        views = {core_levels.get(n, {}).get('TGA_View', VIEW_TEMPERATURE)
                 for n in names}
        if len(views) > 1:
            self.parent.show_popup_message2(
                "Error",
                "The selected sheets are not all the same kind: some are the "
                "run against time and some are mass against temperature. "
                "Overlaying them would put minutes and degrees on one axis.\n\n"
                "Tick only sheets of the same kind.")
            return

        if signal == 'Difference from first' and len(names) < 2:
            self.parent.show_popup_message2(
                "Error", "A difference curve needs at least two sheets: the "
                         "first is the reference.")
            return

        self.parent.Data['TGA_Overlay'] = {
            'sheets': names,
            'signal': signal,
            'align': bool(self.compare_align.GetValue()),
        }

        # Land on the first sheet so the axes are labelled for the overlay
        self._show_sheet(names[0])
        self._replot()

        summary = [f"Overlaying {len(names)} sheet(s) - {signal}:"]
        for name in names:
            sheet = core_levels.get(name, {})
            x = sheet.get('B.E.') or []
            summary.append(f"  {name:10s} {len(x):6d} points, "
                           f"{min(x):.0f}-{max(x):.0f} {sheet.get('TGA_X_Label', '')}"
                           if x else f"  {name:10s} (empty)")
        if signal == 'Difference from first':
            summary.append("")
            summary.append(f"Differences are taken against {names[0]}, "
                           f"interpolated onto its temperature grid.")
        self.compare_results.SetValue("\n".join(summary))

    @staticmethod
    def _sheet_from_display_string(value):
        return value.split('  -  ')[0].strip() if value else ''

    def on_add_diff_sheet(self, event):
        """Publish the difference of the two ticked runs as a TGA~Diff sheet.

        A raw overlay is a view (many traces on one axis), which no single sheet
        can hold — but the difference of the reference and a second run is one
        trace, so that is what is published.
        """
        names = [self._sheet_from_display_string(self.compare_list.GetString(i))
                 for i in self.compare_list.GetCheckedItems()]
        if len(names) < 2:
            self.parent.show_popup_message2(
                "Information", "Tick at least two sheets — the first is the "
                               "reference the others are subtracted from.")
            return
        core_levels = self._core_levels()
        reference = core_levels.get(names[0], {})
        other = core_levels.get(names[1], {})
        ref_x = np.asarray(reference.get('B.E.', []), dtype=float)
        ref_y = np.asarray(reference.get('Raw Data', []), dtype=float)
        other_x = np.asarray(other.get('B.E.', []), dtype=float)
        other_y = np.asarray(other.get('Raw Data', []), dtype=float)
        if ref_x.size == 0 or other_x.size == 0:
            self.parent.show_popup_message2("Error", "One of the sheets is empty.")
            return

        order = np.argsort(other_x)
        difference = np.interp(ref_x, other_x[order], other_y[order]) - ref_y
        unit = reference.get('TGA_Y_Unit', '%')
        name = self._publish_view_sheet(
            reference, 'Diff', [float(v) for v in difference],
            f"Δ Mass ({unit})",
            x_values=[float(v) for v in ref_x],
            x_label=reference.get('TGA_X_Label', X_LABEL_TEMPERATURE),
            extra={'TGA_Label': f"{names[1]} − {names[0]}"})
        if name:
            self.compare_results.SetValue(
                f"Added {name}: {names[1]} − {names[0]}, "
                f"interpolated onto {names[0]}'s grid.")

    def on_clear_overlay(self, event):
        self.parent.Data.pop('TGA_Overlay', None)
        self.compare_results.SetValue("")
        self._replot()

    # -------------------------------------------------------------- grids --

    @staticmethod
    def _selected_row(grid):
        rows = grid.GetSelectedRows()
        if rows:
            return rows[0]
        cursor = grid.GetGridCursorRow()
        return cursor if cursor >= 0 else None

    @staticmethod
    def _fill_grid(grid, rows):
        if grid.GetNumberRows():
            grid.DeleteRows(0, grid.GetNumberRows())
        if not rows:
            return
        grid.AppendRows(len(rows))
        for r, row in enumerate(rows):
            for c, value in enumerate(row):
                grid.SetCellValue(r, c, str(value))

    def _refresh_all_grids(self):
        self._refresh_mass_grid()
        self._refresh_events_grid()
        self._refresh_dtg_grid()

    def _event_row(self, item, unit):
        def _fmt(value, spec='{:.1f}'):
            return spec.format(value) if isinstance(value, (int, float)) else '-'
        return [
            item.get('name', ''),
            _fmt(item.get('t_start')),
            _fmt(item.get('t_end')),
            _fmt(item.get('mass_change_mg'), '{:+.4f}'),
            _fmt(item.get('mass_change_pct'), '{:+.3f}'),
            _fmt(item.get('onset_temperature')),
            _fmt(item.get('dtg_peak_temperature')),
            _fmt(item.get('dsc_peak_temperature')),
            _fmt(item.get('enthalpy_j_per_g'), '{:+.4g}'),
        ]

    def _refresh_mass_grid(self):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue(), {})
        unit = sheet.get('TGA_Y_Unit', '%')
        rows = []
        for step in sheet.get('TGA_Steps', []) or []:
            rows.append([
                step.get('name', ''),
                f"{step['t_start']:.1f}",
                f"{step['t_end']:.1f}",
                f"{step['delta_mg']:+.4f}" if step.get('delta_mg') is not None else '-',
                f"{step['delta_pct']:+.3f}" if step.get('delta_pct') is not None else '-',
                '-', '-', '-', '-',
            ])
        self._fill_grid(self.mass_grid, rows)

    def _refresh_events_grid(self):
        sheet = self._core_levels().get(self.parent.sheet_combobox.GetValue(), {})
        unit = sheet.get('TGA_Y_Unit', '%')
        rows = [self._event_row(item, unit)
                for item in sheet.get('TGA_Events', []) or []]
        self._fill_grid(self.events_grid, rows)

    # ------------------------------------------------------------- shared --

    @staticmethod
    def _append_result(text_ctrl, text):
        existing = text_ctrl.GetValue()
        text_ctrl.SetValue(f"{existing}\n\n{text}" if existing else text)
        text_ctrl.ShowPosition(text_ctrl.GetLastPosition())

    def _persist(self):
        """Write the sheet changes back to the project file."""
        from libraries.FileMenu.KFitting_IO import persist_project
        try:
            persist_project(self.parent)
        except Exception as e:
            print(f"TGA: could not update the project file ({e})")

    def _replot(self):
        """Redraw the main plot, then put the range lines back on top."""
        self.parent.clear_and_replot()
        self.show_range_vlines()
        self.update_range_controls()

    # -------------------------------------------------------------- close --

    def on_close(self, event):
        windows = getattr(self.parent, '_tga_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'tga_analysis_window', None) is self:
            self.parent.tga_analysis_window = remaining[-1] if remaining else None
        try:
            self.parent.canvas.draw_idle()
        except RuntimeError:
            pass
        self.Destroy()


def open_tga_window(window):
    """Open (or raise) the full TGA / DSC Analysis window."""
    for existing in list(getattr(window, '_tga_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    TGAAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = TGAAnalysisWindow(window)
    frame.Show()
    return frame


def open_tga_section(window, key):
    """Open one TGA tab (a single section) as its own narrow window."""
    for existing in list(getattr(window, '_tga_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = TGAAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
