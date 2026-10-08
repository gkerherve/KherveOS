# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/UVVIS_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/UVVIS_Analysis.py
"""
UV-Vis analysis: ordinate conversion, Tauc band-gap extraction and band maxima.

The engine functions at the top are pure numpy so they can be tested without a
GUI. The window follows the FTIR/SQUID single-or-all-tabs pattern: the same
frame serves as the full three-tab window and as each slim single-tab window
the technique toolbar opens.

Sheets: measured spectra are UVvis, UVvis1, ...; the Tauc transform is written
to a UVvis~Tauc sheet (its own Sample Manager column) whose x axis is photon
energy — the per-sheet UVVIS_X_Label/UVVIS_Y_Label keys carry that through the
shared axis-label table. Results live in a JSON string under UVVIS_Results so
the .xlsx round-trip's two-decimal rounding can never touch them.

Band-gap workflow: "Create UVvis~Tauc sheet" converts nm to eV as its own
sheet; the linear-fit window on it is the shared red vline1/vline2 pair,
draggable on the plot (Bkg Low/High of the Tauc sheet, kept in step with the
From/To boxes both ways); "Fit band gap" stores the dotted extrapolation line
and the Eg readout that UVVIS_Plot draws on the main frame; and the fitted
construction can be inserted into the measured sheet as a Label Manager inset
(an ordinary label entry with a `source` key naming the Tauc sheet), so its
position, size, axis ranges and label size are edited there like any other
label.
"""

import json

import numpy as np
import wx

EV_NM = 1239.84193          # eV * nm

MODE_ABS = 'absorbance'
MODE_T_PCT = 'transmittance'
MODE_R_PCT = 'reflectance'

MODE_LABELS = {
    MODE_ABS: 'Absorbance (a.u.)',
    MODE_T_PCT: 'Transmittance (%)',
    MODE_R_PCT: 'Reflectance (%)',
}

TRANSITIONS = (
    ('Direct allowed (n = 2)', 2.0),
    ('Indirect allowed (n = 1/2)', 0.5),
    ('Direct forbidden (n = 2/3)', 2.0 / 3.0),
    ('Indirect forbidden (n = 1/3)', 1.0 / 3.0),
)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def to_absorbance(y, mode):
    """Absorbance-like quantity from the stored ordinate.

    Transmittance uses Beer-Lambert (A = -log10 T); diffuse reflectance uses
    the Kubelka-Munk function F(R) = (1-R)^2 / 2R, the standard absorption
    proxy for powders. Values are clipped away from zero so a noisy baseline
    cannot produce infinities.
    """
    y = np.asarray(y, dtype=float)
    if mode == MODE_T_PCT:
        t = np.clip(y / 100.0, 1e-6, None)
        return -np.log10(t)
    if mode == MODE_R_PCT:
        r = np.clip(y / 100.0, 1e-6, None)
        return (1.0 - r) ** 2 / (2.0 * r)
    return y


def tauc_transform(wavelength_nm, y, mode, power):
    """(E, (alpha*E)^power) sorted by increasing photon energy.

    Absorbance stands in for the absorption coefficient - the film thickness
    is a constant scale factor that moves the Tauc line up and down without
    moving its energy intercept, which is the only number read off the plot.
    """
    x = np.asarray(wavelength_nm, dtype=float)
    alpha = to_absorbance(y, mode)
    keep = np.isfinite(x) & np.isfinite(alpha) & (x > 0)
    x, alpha = x[keep], alpha[keep]
    energy = EV_NM / x
    order = np.argsort(energy)
    energy, alpha = energy[order], alpha[order]
    tauc = np.power(np.clip(alpha, 0.0, None) * energy, power)
    return energy, tauc


def fit_tauc(energy, tauc, e_lo, e_hi):
    """Straight line through the Tauc curve on [e_lo, e_hi].

    Returns {'eg', 'slope', 'intercept', 'r2', 'n_points'} or None when the
    window holds fewer than three points or the line does not rise.
    """
    energy = np.asarray(energy, dtype=float)
    tauc = np.asarray(tauc, dtype=float)
    mask = (energy >= min(e_lo, e_hi)) & (energy <= max(e_lo, e_hi))
    if int(mask.sum()) < 3:
        return None
    e, t = energy[mask], tauc[mask]
    slope, intercept = np.polyfit(e, t, 1)
    if slope <= 0:
        return None
    predicted = slope * e + intercept
    ss_res = float(np.sum((t - predicted) ** 2))
    ss_tot = float(np.sum((t - np.mean(t)) ** 2)) or 1.0
    return {
        'eg': float(-intercept / slope),
        'slope': float(slope),
        'intercept': float(intercept),
        'r2': 1.0 - ss_res / ss_tot,
        'n_points': int(mask.sum()),
    }


def suggest_tauc_window(energy, tauc):
    """The steepest-rise region of the Tauc curve - the linear absorption edge.

    Takes the contiguous stretch around the maximum slope where the slope
    stays above 40 % of that maximum. Returns (e_lo, e_hi).
    """
    energy = np.asarray(energy, dtype=float)
    tauc = np.asarray(tauc, dtype=float)
    if energy.size < 5:
        return float(energy.min()), float(energy.max())
    slope = np.gradient(tauc, energy)
    peak = int(np.argmax(slope))
    threshold = 0.4 * slope[peak]
    lo = peak
    while lo > 0 and slope[lo - 1] >= threshold:
        lo -= 1
    hi = peak
    while hi < slope.size - 1 and slope[hi + 1] >= threshold:
        hi += 1
    return float(energy[lo]), float(energy[hi])


def find_band_maxima(x, y, prominence_fraction=0.02):
    """Local maxima of a spectrum: [{'x', 'y', 'prominence'}], strongest first."""
    from scipy.signal import find_peaks
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if y.size < 5:
        return []
    span = float(np.nanmax(y) - np.nanmin(y)) or 1.0
    idx, props = find_peaks(y, prominence=prominence_fraction * span)
    peaks = [{'x': float(x[i]), 'y': float(y[i]),
              'prominence': float(p)}
             for i, p in zip(idx, props['prominences'])]
    peaks.sort(key=lambda pk: -pk['prominence'])
    return peaks


def load_results(sheet):
    try:
        return json.loads(sheet.get('UVVIS_Results') or '{}')
    except (TypeError, ValueError):
        return {}


def store_results(sheet, results):
    sheet['UVVIS_Results'] = json.dumps(results)


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------

def is_tauc_sheet(sheet_name):
    name = str(sheet_name or '').upper()
    return name.startswith('UVVIS') and '~TAUC' in name


def uvvis_range_active(window):
    """True while a UV-Vis window is open and the main plot shows a Tauc
    sheet — the shared red vline pair then selects the linear-fit window."""
    if getattr(window, 'uvvis_analysis_window', None) is None:
        return False
    try:
        return is_tauc_sheet(window.sheet_combobox.GetValue())
    except Exception:
        return False


def _uvvis_sheet_names(window, include_derived=True):
    names = [n for n, s in window.Data.get('Core levels', {}).items()
             if isinstance(s, dict) and str(n).upper().startswith('UVVIS')]
    if not include_derived:
        names = [n for n in names if '~' not in n]
    return sorted(names)


class UVVisAnalysisWindow(wx.Frame):
    SECTIONS = (
        ('data', "Data & Ordinate", '_build_data_tab'),
        ('tauc', "Band Gap (Tauc)", '_build_tauc_tab'),
        ('peaks', "Band Maxima", '_build_peaks_tab'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        if single:
            title = f"UV-Vis {self.SECTION_TITLES[self._section_keys[0]]}"
            size = (460, 620)
        else:
            title = "UV-Vis Analysis"
            size = (640, 700)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent
        self._loading = False

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
        self.show_range_vlines()
        self.Bind(wx.EVT_CLOSE, self.on_close)
        self.SetMinSize((430, 480))
        self.CentreOnParent()

        if not hasattr(parent, '_uvvis_windows'):
            parent._uvvis_windows = []
        parent._uvvis_windows.append(self)
        parent.uvvis_analysis_window = self

    # ------------------------------------------------------------- tabs ----
    def _build_data_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "UV-Vis Sheet")
        self.sheet_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.sheet_combo.Bind(wx.EVT_COMBOBOX, self.on_sheet_selected)
        sheet_box.Add(self.sheet_combo, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(sheet_box, 0, wx.ALL | wx.EXPAND, 8)

        mode_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Ordinate")
        self.mode_radio = wx.RadioBox(
            panel, choices=["Absorbance", "Transmittance (%)",
                            "Reflectance (%)"],
            majorDimension=1, style=wx.RA_SPECIFY_COLS)
        self.mode_radio.Bind(wx.EVT_RADIOBOX, self.on_mode_changed)
        mode_box.Add(self.mode_radio, 0, wx.ALL | wx.EXPAND, 5)
        convert_btn = wx.Button(panel, label="Create absorbance sheet")
        convert_btn.SetToolTip("New UVvis sheet holding -log10(T) — or the "
                               "Kubelka-Munk F(R) for reflectance data")
        convert_btn.Bind(wx.EVT_BUTTON, self.on_convert)
        mode_box.Add(convert_btn, 0, wx.ALL, 5)
        vbox.Add(mode_box, 0, wx.ALL | wx.EXPAND, 8)

        info_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Sheet")
        self.info_text = wx.StaticText(panel, label="—")
        info_box.Add(self.info_text, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(info_box, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_tauc_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        trans_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Transition")
        self.transition_choice = wx.Choice(
            panel, choices=[label for label, _p in TRANSITIONS])
        self.transition_choice.SetSelection(0)
        trans_box.Add(self.transition_choice, 0, wx.ALL | wx.EXPAND, 5)
        convert_btn = wx.Button(panel,
                                label="Create UVvis~Tauc sheet (nm → eV)")
        convert_btn.SetToolTip("Transform the spectrum to photon energy: "
                               "(αhν)ⁿ against hν on its own sheet. Re-run "
                               "after changing the transition.")
        convert_btn.Bind(wx.EVT_BUTTON, self.on_make_tauc)
        trans_box.Add(convert_btn, 0, wx.ALL, 5)
        vbox.Add(trans_box, 0, wx.ALL | wx.EXPAND, 8)

        range_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "Linear-fit window (photon energy, eV)")
        hint = wx.StaticText(panel, label="Drag the red lines on the plot, "
                                          "or type the bounds here.")
        hint.SetForegroundColour(wx.Colour(90, 90, 90))
        range_box.Add(hint, 0, wx.ALL, 5)
        grid = wx.FlexGridSizer(2, 2, 5, 5)
        grid.AddGrowableCol(1)
        grid.Add(wx.StaticText(panel, label="From:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.e_lo_ctrl = wx.SpinCtrlDouble(panel, min=0.3, max=6.5,
                                           initial=2.8, inc=0.01)
        self.e_lo_ctrl.SetDigits(2)
        self.e_lo_ctrl.Bind(wx.EVT_SPINCTRLDOUBLE, self.on_range_spin)
        grid.Add(self.e_lo_ctrl, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="To:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.e_hi_ctrl = wx.SpinCtrlDouble(panel, min=0.3, max=6.5,
                                           initial=3.4, inc=0.01)
        self.e_hi_ctrl.SetDigits(2)
        self.e_hi_ctrl.Bind(wx.EVT_SPINCTRLDOUBLE, self.on_range_spin)
        grid.Add(self.e_hi_ctrl, 0, wx.EXPAND)
        range_box.Add(grid, 0, wx.ALL | wx.EXPAND, 5)
        auto_btn = wx.Button(panel, label="Suggest window (steepest edge)")
        auto_btn.Bind(wx.EVT_BUTTON, self.on_suggest_window)
        range_box.Add(auto_btn, 0, wx.ALL, 5)
        vbox.Add(range_box, 0, wx.ALL | wx.EXPAND, 8)

        fit_btn = wx.Button(panel, label="Fit band gap")
        fit_btn.SetToolTip("Straight line through the window, extrapolated "
                           "to the energy axis — the intercept is Eg. Drawn "
                           "dotted on the plot with the result.")
        fit_btn.Bind(wx.EVT_BUTTON, self.on_fit_tauc)
        vbox.Add(fit_btn, 0, wx.ALL, 8)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Result")
        self.tauc_result = wx.StaticText(panel, label="—")
        result_box.Add(self.tauc_result, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(result_box, 1, wx.ALL | wx.EXPAND, 8)

        inset_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "Inset on the measured sheet")
        inset_row = wx.BoxSizer(wx.HORIZONTAL)
        insert_btn = wx.Button(panel, label="Insert Tauc inset")
        insert_btn.SetToolTip("Add the fitted Tauc plot to the measured UVvis "
                              "sheet as a Label Manager inset — drag, resize "
                              "and set its axis ranges there.")
        insert_btn.Bind(wx.EVT_BUTTON, self.on_insert_inset)
        inset_row.Add(insert_btn, 0, wx.RIGHT, 5)
        remove_btn = wx.Button(panel, label="Remove inset")
        remove_btn.Bind(wx.EVT_BUTTON, self.on_remove_inset)
        inset_row.Add(remove_btn, 0)
        inset_box.Add(inset_row, 0, wx.ALL, 5)
        size_row = wx.BoxSizer(wx.HORIZONTAL)
        size_row.Add(wx.StaticText(panel, label="Label size:"), 0,
                     wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.inset_size_ctrl = wx.SpinCtrl(panel, min=5, max=24, initial=8,
                                           size=(70, -1))
        self.inset_size_ctrl.Bind(wx.EVT_SPINCTRL, self.on_inset_fontsize)
        size_row.Add(self.inset_size_ctrl, 0)
        inset_box.Add(size_row, 0, wx.ALL, 5)
        inset_hint = wx.StaticText(
            panel, label="Appears in the Label Manager as \"Tauc plot\";\n"
                         "its Properties set the X and Y ranges.")
        inset_hint.SetForegroundColour(wx.Colour(90, 90, 90))
        inset_box.Add(inset_hint, 0, wx.ALL, 5)
        vbox.Add(inset_box, 0, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_peaks_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        find_btn = wx.Button(panel, label="Find band maxima")
        find_btn.Bind(wx.EVT_BUTTON, self.on_find_peaks)
        vbox.Add(find_btn, 0, wx.ALL, 8)

        self.peaks_list = wx.ListCtrl(panel, style=wx.LC_REPORT)
        for i, (title, width) in enumerate((("λ (nm)", 90), ("E (eV)", 90),
                                            ("Value", 110),
                                            ("Prominence", 110))):
            self.peaks_list.InsertColumn(i, title, width=width)
        vbox.Add(self.peaks_list, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------ helpers --
    def refresh_sheet_list(self):
        current = self.sheet_combo.GetValue()
        names = _uvvis_sheet_names(self.parent)
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
                                            "No UV-Vis sheet selected.")
        return name, sheet

    def _select_sheet_on_main(self, sheet_name):
        from libraries.Sheet_Operations import on_sheet_selected
        if sheet_name in self.parent.Data.get('Core levels', {}):
            self.parent.sheet_combobox.SetValue(sheet_name)
            on_sheet_selected(self.parent, sheet_name)

    def on_sheet_selected(self, event):
        self.load_sheet_into_ui()
        name = self.sheet_combo.GetValue()
        self._select_sheet_on_main(name)

    def load_sheet_into_ui(self):
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is None:
            self.info_text.SetLabel("No UVvis sheets in this project.")
            return
        self._loading = True
        try:
            mode = sheet.get('UVVIS_Y_Mode', MODE_ABS)
            self.mode_radio.SetSelection(
                {MODE_ABS: 0, MODE_T_PCT: 1, MODE_R_PCT: 2}.get(mode, 0))
            x = sheet.get('B.E.', [])
            lines = [f"Sheet: {name}"]
            if x and is_tauc_sheet(name):
                lines.append(f"{len(x)} points, "
                             f"{min(x):.2f}–{max(x):.2f} eV")
            elif x:
                lines.append(f"{len(x)} points, "
                             f"{min(x):.0f}–{max(x):.0f} nm")
            results = load_results(sheet)
            if 'tauc' in results:
                lines.append(f"Eg = {results['tauc']['eg']:.3f} eV "
                             f"({results['tauc']['transition']})")
            self.info_text.SetLabel("\n".join(lines))

            if is_tauc_sheet(name):
                # The Tauc sheet carries its transition and fit window.
                stored = sheet.get('UVVIS_Tauc_Transition')
                for index, (label, _p) in enumerate(TRANSITIONS):
                    if label == stored:
                        self.transition_choice.SetSelection(index)
                        break
                background = sheet.get('Background', {})
                for value, ctrl in ((background.get('Bkg Low'), self.e_lo_ctrl),
                                    (background.get('Bkg High'),
                                     self.e_hi_ctrl)):
                    if isinstance(value, (int, float)):
                        ctrl.SetValue(float(value))
        finally:
            self._loading = False

    # ------------------------------------------------------------ actions --
    def on_mode_changed(self, event):
        if self._loading:
            return
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        mode = (MODE_ABS, MODE_T_PCT, MODE_R_PCT)[self.mode_radio.GetSelection()]
        sheet['UVVIS_Y_Mode'] = mode
        sheet['UVVIS_Y_Label'] = MODE_LABELS[mode]
        self._persist()
        self._select_sheet_on_main(name)

    def on_convert(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        mode = sheet.get('UVVIS_Y_Mode', MODE_ABS)
        if mode == MODE_ABS:
            self.parent.show_popup_message2(
                "Information", "This sheet is already absorbance.")
            return
        x = list(sheet.get('B.E.', []))
        absorbance = to_absorbance(sheet.get('Raw Data', []), mode).tolist()
        new_name = self._new_sheet(name + '~Abs')
        y_label = ('Kubelka-Munk F(R)' if mode == MODE_R_PCT
                   else 'Absorbance (a.u.)')
        self._write_sheet(new_name, x, absorbance, {
            'UVVIS_X_Label': 'Wavelength (nm)',
            'UVVIS_Y_Label': y_label,
            'UVVIS_Y_Mode': MODE_ABS,
            'UVVIS_Source': name,
        })
        self._select_sheet_on_main(new_name)

    def on_make_tauc(self, event):
        """Create (or refresh) the UVvis~Tauc sheet for the selected spectrum."""
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        if is_tauc_sheet(name):
            # Re-run from the measured sheet, so a new transition choice
            # rebuilds the transform rather than transforming a transform.
            source_name = sheet.get('UVVIS_Source', '')
            source = self.parent.Data.get('Core levels', {}).get(source_name)
            if source is None:
                self.parent.show_popup_message2(
                    "Information", "Select the measured UVvis sheet first.")
                return
            name, sheet = source_name, source
        self._make_tauc_sheet(name, sheet)

    def _make_tauc_sheet(self, name, sheet):
        """Write name~Tauc (photon energy vs (αhν)^n), overwriting a previous
        one, with the fit window preset to the steepest edge. Returns the
        sheet name, or None when the spectrum is too short."""
        label, power = TRANSITIONS[self.transition_choice.GetSelection()]
        energy, tauc = tauc_transform(sheet.get('B.E.', []),
                                      sheet.get('Raw Data', []),
                                      sheet.get('UVVIS_Y_Mode', MODE_ABS),
                                      power)
        if energy.size < 5:
            self.parent.show_popup_message2("Information", "Not enough data.")
            return None

        tauc_name = name.split('~')[0] + '~Tauc'
        exponent = ('2' if power == 2.0 else
                    '1/2' if power == 0.5 else
                    '2/3' if abs(power - 2.0 / 3.0) < 1e-9 else '1/3')
        self._write_sheet(tauc_name, energy.tolist(), tauc.tolist(), {
            'UVVIS_X_Label': 'Photon Energy (eV)',
            'UVVIS_Y_Label': f'(αhν)$^{{{exponent}}}$ (a.u.)',
            'UVVIS_Y_Mode': MODE_ABS,
            'UVVIS_Source': name,
            'UVVIS_Tauc_Power': power,
            'UVVIS_Tauc_Transition': label,
        })

        e_lo, e_hi = suggest_tauc_window(energy, tauc)
        new_sheet = self.parent.Data['Core levels'][tauc_name]
        background = new_sheet.setdefault('Background', {})
        background['Bkg Low'] = float(e_lo)
        background['Bkg High'] = float(e_hi)
        self._persist()

        self.sheet_combo.SetValue(tauc_name)
        self._select_sheet_on_main(tauc_name)
        self.load_sheet_into_ui()
        self.show_range_vlines()
        return tauc_name

    def _current_tauc_sheet(self, complain=True):
        """The selected Tauc sheet, transforming the measured one first if
        that is what is selected. Returns (name, sheet) or (None, None)."""
        name, sheet = self.get_sheet_data(complain=complain)
        if sheet is None:
            return None, None
        if not is_tauc_sheet(name):
            name = self._make_tauc_sheet(name, sheet)
            if name is None:
                return None, None
            sheet = self.parent.Data['Core levels'][name]
        return name, sheet

    def on_suggest_window(self, event):
        name, sheet = self._current_tauc_sheet()
        if sheet is None:
            return
        energy = np.asarray(sheet.get('B.E.', []), dtype=float)
        tauc = np.asarray(sheet.get('Raw Data', []), dtype=float)
        if energy.size < 5:
            self.parent.show_popup_message2("Information", "Not enough data.")
            return
        e_lo, e_hi = suggest_tauc_window(energy, tauc)
        self._set_range(e_lo, e_hi)

    def on_range_spin(self, event):
        if self._loading:
            return
        self._set_range(self.e_lo_ctrl.GetValue(), self.e_hi_ctrl.GetValue())

    def _set_range(self, low, high):
        """Store the fit window on the Tauc sheet and move the red lines."""
        low, high = float(min(low, high)), float(max(low, high))
        self._loading = True
        try:
            self.e_lo_ctrl.SetValue(low)
            self.e_hi_ctrl.SetValue(high)
        finally:
            self._loading = False
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is None or not is_tauc_sheet(name):
            return
        background = sheet.setdefault('Background', {})
        background['Bkg Low'], background['Bkg High'] = low, high
        if getattr(self.parent, 'vline1', None) is not None:
            self.parent.vline1.set_xdata([low])
        if getattr(self.parent, 'vline2', None) is not None:
            self.parent.vline2.set_xdata([high])
        try:
            self.parent.canvas.draw_idle()
        except RuntimeError:
            pass

    def show_range_vlines(self):
        """Put the red fit-window lines on the plot (Tauc sheet only)."""
        from libraries.ToolsMenu.UVVIS_Plot import restore_range_vlines
        restore_range_vlines(self.parent)

    def update_range_controls(self):
        """Refresh every UV-Vis window's From/To boxes from the stored range.

        Called by the mouse handler while a red line is being dragged; the
        range lives on the Tauc sheet, so fan the refresh out."""
        sheet_name = self.parent.sheet_combobox.GetValue()
        sheet = self.parent.Data.get('Core levels', {}).get(sheet_name)
        if not isinstance(sheet, dict) or not is_tauc_sheet(sheet_name):
            return
        background = sheet.get('Background', {})
        low, high = background.get('Bkg Low'), background.get('Bkg High')
        for win in list(getattr(self.parent, '_uvvis_windows', None) or [self]):
            try:
                win._loading = True
                try:
                    if isinstance(low, (int, float)):
                        win.e_lo_ctrl.SetValue(float(low))
                    if isinstance(high, (int, float)):
                        win.e_hi_ctrl.SetValue(float(high))
                finally:
                    win._loading = False
            except RuntimeError:
                pass

    def on_fit_tauc(self, event):
        name, sheet = self._current_tauc_sheet()
        if sheet is None:
            return
        energy = np.asarray(sheet.get('B.E.', []), dtype=float)
        tauc = np.asarray(sheet.get('Raw Data', []), dtype=float)
        label = sheet.get('UVVIS_Tauc_Transition',
                          TRANSITIONS[self.transition_choice.GetSelection()][0])
        e_lo = self.e_lo_ctrl.GetValue()
        e_hi = self.e_hi_ctrl.GetValue()
        fit = fit_tauc(energy, tauc, e_lo, e_hi)
        if fit is None:
            self.parent.show_popup_message2(
                "Information",
                "No rising straight line in that window — widen it or use "
                "'Suggest window'.")
            return

        fit['transition'] = label
        fit['window'] = [float(min(e_lo, e_hi)), float(max(e_lo, e_hi))]

        # The dotted extrapolation, from the intercept up through the window
        # and a little beyond - not across the whole plot.
        e_end = fit['window'][1] + 0.2 * (fit['window'][1] - fit['window'][0])
        line_e = np.array([fit['eg'], min(e_end, float(np.max(energy)))])
        sheet['UVVIS_Fit_X'] = line_e.tolist()
        sheet['UVVIS_Fit_Y'] = (fit['slope'] * line_e
                                + fit['intercept']).tolist()
        results = load_results(sheet)
        results['tauc'] = fit
        store_results(sheet, results)
        self._persist()

        self.tauc_result.SetLabel(
            f"Eg = {fit['eg']:.3f} eV   ({label})\n"
            f"R² = {fit['r2']:.4f} over {fit['n_points']} points\n"
            f"Window {fit['window'][0]:.2f}–{fit['window'][1]:.2f} eV")
        self.load_sheet_into_ui()
        self._select_sheet_on_main(name)
        self.show_range_vlines()

    # ------------------------------------------------------------ inset ----
    def _inset_sheets(self):
        """(tauc_name, tauc_sheet, source_name, source_sheet) for whichever
        of the pair is selected. Missing sheets come back as None."""
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return None, None, None, None
        core_levels = self.parent.Data.get('Core levels', {})
        if is_tauc_sheet(name):
            source_name = sheet.get('UVVIS_Source') or name.split('~')[0]
            return name, sheet, source_name, core_levels.get(source_name)
        tauc_name = name.split('~')[0] + '~Tauc'
        return tauc_name, core_levels.get(tauc_name), name, sheet

    def _tauc_insets(self, source, tauc_name):
        """The measured sheet's Label Manager insets showing this Tauc sheet."""
        return [lb for lb in source.get('Labels', []) or []
                if isinstance(lb, dict) and lb.get('type') == 'inset'
                and lb.get('source') == tauc_name]

    def on_insert_inset(self, event):
        """Put the Tauc plot on the measured spectrum as a Label Manager inset.

        A normal label entry rather than a private one, so it can be dragged,
        resized, renamed, ranged and deleted alongside every other label.
        """
        tauc_name, tauc_sheet, source_name, source = self._inset_sheets()
        if tauc_sheet is None or 'tauc' not in load_results(tauc_sheet):
            self.parent.show_popup_message2(
                "Information", "Fit the band gap first — the inset shows the "
                               "fitted Tauc construction.")
            return
        if source is None:
            self.parent.show_popup_message2(
                "Information", f"Measured sheet '{source_name}' not found.")
            return

        fit = load_results(tauc_sheet)['tauc']
        fontsize = int(self.inset_size_ctrl.GetValue())
        entry = {
            'type': 'inset', 'text': 'Tauc plot',
            'x': 0.55, 'y': 0.50, 'w': 0.40, 'h': 0.42,
            'source': tauc_name,
            # Blank ranges mean the whole curve; set them in the Label
            # Manager's Inset Properties to crop it.
            'be_min': None, 'be_max': None,
            'int_min': None, 'int_max': None,
            'xlabel': tauc_sheet.get('UVVIS_X_Label', 'Photon Energy (eV)'),
            'ylabel': tauc_sheet.get('UVVIS_Y_Label', '(αhν)$^{2}$ (a.u.)'),
            'annotation': f"Eg = {fit['eg']:.2f} eV",
            'fontsize': fontsize, 'show_border': True, 'auto_be': False,
        }
        labels = source.setdefault('Labels', [])
        existing = self._tauc_insets(source, tauc_name)
        if existing:
            # Refresh the one that is already there rather than stacking a
            # second copy on top of it, keeping wherever the user put it.
            for key in ('annotation', 'xlabel', 'ylabel', 'fontsize'):
                existing[0][key] = entry[key]
        else:
            labels.append(entry)
        self._persist()
        self.sheet_combo.SetValue(source_name)
        self._select_sheet_on_main(source_name)
        self.load_sheet_into_ui()
        self._refresh_label_manager()

    def on_remove_inset(self, event):
        tauc_name, _tauc_sheet, source_name, source = self._inset_sheets()
        if source is None:
            return
        insets = self._tauc_insets(source, tauc_name)
        if not insets:
            return
        source['Labels'] = [lb for lb in source.get('Labels', [])
                            if lb not in insets]
        self._persist()
        if self.parent.sheet_combobox.GetValue() == source_name:
            self.parent.clear_and_replot()
        self._refresh_label_manager()

    def on_inset_fontsize(self, event):
        """Resize the inset labels live, so the small plot stays readable."""
        tauc_name, _tauc_sheet, source_name, source = self._inset_sheets()
        if source is None:
            return
        insets = self._tauc_insets(source, tauc_name)
        if not insets:
            return
        for inset in insets:
            inset['fontsize'] = int(self.inset_size_ctrl.GetValue())
        self._persist()
        if self.parent.sheet_combobox.GetValue() == source_name:
            self.parent.clear_and_replot()
        self._refresh_label_manager()

    def _refresh_label_manager(self):
        """Keep an open Label Manager's list in step with what we changed."""
        try:
            manager = getattr(self.parent, 'labels_window', None)
            if manager is not None and not manager.IsBeingDeleted():
                manager.update_list()
        except (RuntimeError, AttributeError):
            pass

    def on_find_peaks(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x = sheet.get('B.E.', [])
        peaks = find_band_maxima(x, sheet.get('Raw Data', []))
        self.peaks_list.DeleteAllItems()
        for pk in peaks:
            row = self.peaks_list.GetItemCount()
            self.peaks_list.InsertItem(row, f"{pk['x']:.1f}")
            self.peaks_list.SetItem(row, 1, f"{EV_NM / pk['x']:.3f}"
                                    if pk['x'] > 0 else "—")
            self.peaks_list.SetItem(row, 2, f"{pk['y']:.4g}")
            self.peaks_list.SetItem(row, 3, f"{pk['prominence']:.3g}")
        if not peaks:
            self.parent.show_popup_message2("Information", "No maxima found.")

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
        from libraries.FileMenu.KFitting_Import import (TECH_UVVIS,
                                                        build_generic_sheet)
        sheet = build_generic_sheet(TECH_UVVIS, name, list(x), list(y),
                                    source_name=extra.get('UVVIS_Source', ''))
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
            print(f"UV-Vis persist skipped: {e}")

    # --------------------------------------------------------------- close --
    def _remove_range_vlines(self):
        """Take the fit-window lines off the plot when the tool goes away.

        Left alone if the fitting or area screen is open: those own the same
        vline1/vline2 pair and would lose their own range selection.
        """
        window = self.parent
        if (getattr(window, 'background_tab_selected', False) or
                getattr(window, 'area_tab_selected', False)):
            return
        for attr in ('vline1', 'vline2', 'vline1_text', 'vline2_text'):
            artist = getattr(window, attr, None)
            if artist is not None:
                try:
                    artist.remove()
                except (ValueError, NotImplementedError, AttributeError):
                    pass
            setattr(window, attr, None)

    def on_close(self, event):
        windows = getattr(self.parent, '_uvvis_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'uvvis_analysis_window', None) is self:
            self.parent.uvvis_analysis_window = (remaining[-1] if remaining
                                                 else None)
        # The lines are only torn down once the LAST UV-Vis window closes —
        # another may still be driving them.
        if not remaining:
            self._remove_range_vlines()
            try:
                self.parent.canvas.draw_idle()
            except RuntimeError:
                pass
        self.Destroy()


def open_uvvis_window(window):
    """Open (or raise) the full UV-Vis Analysis window."""
    for existing in list(getattr(window, '_uvvis_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    UVVisAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = UVVisAnalysisWindow(window)
    frame.Show()
    return frame


def open_uvvis_section(window, key):
    """Open one UV-Vis tab as its own narrow window."""
    for existing in list(getattr(window, '_uvvis_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = UVVisAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
