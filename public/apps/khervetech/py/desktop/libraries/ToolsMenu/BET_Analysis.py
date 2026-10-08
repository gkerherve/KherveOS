# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/BET_Analysis.py. Regenerate with tools/export_khervetech.py.
# libraries/ToolsMenu/BET_Analysis.py
"""
BET / physisorption analysis of nitrogen adsorption isotherms.

The engine functions at the top are pure numpy so they can be tested without
a GUI. All the standard constants are for N2 at 77 K:

- BET surface area: linear fit of 1/[Q(P0/P - 1)] against P/P0 (default
  window 0.05-0.30), monolayer capacity Qm = 1/(slope + intercept),
  C = 1 + slope/intercept, S_BET = 4.3527 x Qm m2/g (sigma = 0.162 nm2).
  The Rouquerol consistency limit - the P/P0 where Q(1 - P/P0) peaks, beyond
  which the BET window must not reach - is reported alongside.
- t-plot (Harkins-Jura thickness): Q against t on 3.5-5 A; the slope gives
  the external area S_ext = 15.47 x slope and the intercept the micropore
  volume V_micro = 0.001547 x intercept.
- BJH pore-size distribution from the desorption branch: Kelvin radius
  rk = 4.14 / (-log10 P/P0) A plus the film thickness, with the standard
  previous-layer thinning correction, reported as dV/dlog(D).

Liquid-nitrogen conversion throughout: 1 cm3 STP of gas = 0.001547 cm3 of
liquid. Results live in a JSON string under ``BET_Results`` (the .xlsx
round-trip rounds to two decimals, which would erase a 1e-3 transform), and
derived plots go to their own ``BET~Plot`` / ``BET~tPlot`` / ``BET~Pore``
sheets so each keeps a Sample Manager column of its own.
"""

import json

import numpy as np
import wx
import wx.grid


# N2 at 77 K
CM3STP_TO_CM3LIQ = 0.001547     # cm3 STP gas -> cm3 liquid N2
S_BET_FACTOR = 4.3527           # m2/g per cm3/g STP of monolayer
T_PLOT_SLOPE_FACTOR = 15.47     # m2/g per (cm3 STP g-1 A-1)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def _as_arrays(x, q):
    x = np.asarray(x, dtype=float)
    q = np.asarray(q, dtype=float)
    keep = np.isfinite(x) & np.isfinite(q)
    return x[keep], q[keep]

def adsorption_mask(x, branch=None):
    """Boolean mask of the adsorption branch (up to the maximum P/P0)."""
    x = np.asarray(x, dtype=float)
    if branch is not None:
        b = np.asarray(branch, dtype=float)
        if b.size == x.size and np.isfinite(b).any():
            return b <= 1.5
    if not x.size:
        return np.zeros(0, dtype=bool)
    turn = int(np.argmax(x))
    mask = np.zeros(x.size, dtype=bool)
    mask[:turn + 1] = True
    return mask


def bet_transform(x, q):
    """(P/P0, 1/[Q(P0/P - 1)]) over the points where it is defined."""
    x, q = _as_arrays(x, q)
    keep = (x > 1e-6) & (x < 0.999) & (q > 0)
    x, q = x[keep], q[keep]
    return x, x / (q * (1.0 - x))


def fit_bet(x, q, lo=0.05, hi=0.30, branch=None):
    """BET fit over the relative-pressure window [lo, hi].

    Returns {'qm', 'c', 's_bet', 'slope', 'intercept', 'r2', 'n_points',
    'window'} or None when the window holds fewer than three points or the
    fitted constants are unphysical (slope + intercept <= 0).
    """
    x = np.asarray(x, dtype=float)
    q = np.asarray(q, dtype=float)
    ads = adsorption_mask(x, branch)
    tx, ty = bet_transform(x[ads], q[ads])
    mask = (tx >= min(lo, hi)) & (tx <= max(lo, hi))
    if int(mask.sum()) < 3:
        return None
    px, py = tx[mask], ty[mask]
    slope, intercept = np.polyfit(px, py, 1)
    if slope + intercept <= 0:
        return None
    predicted = slope * px + intercept
    ss_res = float(np.sum((py - predicted) ** 2))
    ss_tot = float(np.sum((py - np.mean(py)) ** 2)) or 1.0
    qm = 1.0 / (slope + intercept)
    return {
        'qm': float(qm),
        'c': float(1.0 + slope / intercept) if intercept != 0 else float('inf'),
        's_bet': float(S_BET_FACTOR * qm),
        'slope': float(slope),
        'intercept': float(intercept),
        'r2': 1.0 - ss_res / ss_tot,
        'n_points': int(mask.sum()),
        'window': [float(min(lo, hi)), float(max(lo, hi))],
    }


def rouquerol_limit(x, q, branch=None):
    """The P/P0 where Q(1 - P/P0) peaks on the adsorption branch.

    The BET window should not extend beyond it (Rouquerol consistency
    criterion). Returns the limit or None.
    """
    x = np.asarray(x, dtype=float)
    q = np.asarray(q, dtype=float)
    ads = adsorption_mask(x, branch)
    x, q = x[ads], q[ads]
    keep = np.isfinite(x) & np.isfinite(q) & (x > 0) & (x < 1)
    x, q = x[keep], q[keep]
    if x.size < 3:
        return None
    return float(x[int(np.argmax(q * (1.0 - x)))])


def t_harkins_jura(x):
    """Harkins-Jura statistical film thickness t(P/P0) in angstroms."""
    x = np.clip(np.asarray(x, dtype=float), 1e-6, 0.999)
    return np.sqrt(13.99 / (0.034 - np.log10(x)))


def fit_t_plot(x, q, t_lo=3.5, t_hi=5.0, branch=None):
    """t-plot on the adsorption branch: Q against t over [t_lo, t_hi] A.

    Returns {'s_ext', 'v_micro', 'slope', 'intercept', 'r2', 'n_points',
    'window'} or None. A negative intercept (no micropores, slight
    curvature) is reported as v_micro = 0.
    """
    x = np.asarray(x, dtype=float)
    q = np.asarray(q, dtype=float)
    ads = adsorption_mask(x, branch)
    x, q = x[ads], q[ads]
    keep = np.isfinite(x) & np.isfinite(q) & (x > 1e-6) & (x < 0.999)
    x, q = x[keep], q[keep]
    if x.size < 3:
        return None
    t = t_harkins_jura(x)
    mask = (t >= min(t_lo, t_hi)) & (t <= max(t_lo, t_hi))
    if int(mask.sum()) < 3:
        return None
    slope, intercept = np.polyfit(t[mask], q[mask], 1)
    predicted = slope * t[mask] + intercept
    ss_res = float(np.sum((q[mask] - predicted) ** 2))
    ss_tot = float(np.sum((q[mask] - np.mean(q[mask])) ** 2)) or 1.0
    return {
        's_ext': float(T_PLOT_SLOPE_FACTOR * slope),
        'v_micro': float(max(0.0, CM3STP_TO_CM3LIQ * intercept)),
        'slope': float(slope),
        'intercept': float(intercept),
        'r2': 1.0 - ss_res / ss_tot,
        'n_points': int(mask.sum()),
        'window': [float(min(t_lo, t_hi)), float(max(t_lo, t_hi))],
    }


def total_pore_volume(x, q, at_relp=0.95):
    """Gurvich total pore volume (cm3 liquid/g) at the given P/P0, or None."""
    x, q = _as_arrays(x, q)
    if x.size < 2 or float(np.max(x)) < at_relp - 0.05:
        return None
    order = np.argsort(x)
    return float(np.interp(at_relp, x[order], q[order]) * CM3STP_TO_CM3LIQ)


def bjh_distribution(x, q, branch=None, use_desorption=True,
                     relp_min=0.30, relp_max=0.995):
    """BJH pore-size distribution.

    Works down the chosen branch from high to low P/P0. Each step empties
    the cores that lose their capillary condensate (Kelvin radius plus film)
    and thins the film left on every pore already emptied - the standard
    previous-layer correction. Returns [{'d_nm', 'v_inc', 'dv_dlogd',
    'cum_v', 'a_inc'}] from large pores to small.
    """
    x = np.asarray(x, dtype=float)
    q = np.asarray(q, dtype=float)
    ads = adsorption_mask(x, branch)
    branch_mask = ~ads if (use_desorption and int((~ads).sum()) >= 3) else ads
    bx, bq = _as_arrays(x[branch_mask], q[branch_mask])
    keep = (bx >= relp_min) & (bx <= relp_max)
    bx, bq = bx[keep], bq[keep]
    if bx.size < 3:
        return []
    order = np.argsort(bx)[::-1]                 # descending pressure
    bx, bq = bx[order], bq[order]

    t = t_harkins_jura(bx)                       # film thickness, A
    rk = 4.14 / (-np.log10(bx))                  # Kelvin radius, A
    rp = rk + t                                  # pore radius, A

    results = []
    sum_area = 0.0                               # m2/g of walls already open
    cum_v = 0.0
    for i in range(bx.size - 1):
        dv_liq = (bq[i] - bq[i + 1]) * CM3STP_TO_CM3LIQ
        if dv_liq <= 0:
            continue
        rp_bar = 0.5 * (rp[i] + rp[i + 1])
        rk_bar = 0.5 * (rk[i] + rk[i + 1])
        dt = t[i] - t[i + 1]
        # Volume desorbed from the film left in pores opened at higher P:
        # area (m2/g) x thinning (A) x 1e-4 = cm3/g.
        film = dt * sum_area * 1e-4
        ratio = (rp_bar / (rk_bar + 0.5 * dt)) ** 2
        v_p = ratio * (dv_liq - film)
        if v_p <= 0:
            continue
        a_p = 2.0 * v_p / rp_bar * 1e4           # cylinder walls, m2/g
        sum_area += a_p
        cum_v += v_p
        d_hi, d_lo = 2.0 * rp[i], 2.0 * rp[i + 1]
        dlogd = np.log10(d_hi / d_lo) or 1.0
        results.append({
            'd_nm': float(2.0 * rp_bar / 10.0),
            'v_inc': float(v_p),
            'dv_dlogd': float(v_p / dlogd),
            'cum_v': float(cum_v),
            'a_inc': float(a_p),
        })
    return results


def load_results(sheet):
    try:
        stored = json.loads(sheet.get('BET_Results') or '{}')
        return stored if isinstance(stored, dict) else {}
    except (TypeError, ValueError):
        return {}


def store_results(sheet, results):
    sheet['BET_Results'] = json.dumps(results)


def report_text(sheet_name, results, has_desorption):
    """The plain-text physisorption report."""
    lines = [f"Physisorption report: {sheet_name}"]
    bet = results.get('bet')
    if bet:
        lines.append(f"BET surface area:   {bet['s_bet']:.2f} m²/g")
        lines.append(f"  Monolayer Qm:     {bet['qm']:.3f} cm³/g STP")
        lines.append(f"  BET constant C:   {bet['c']:.1f}")
        lines.append(f"  Window P/P0:      {bet['window'][0]:.3f}–"
                     f"{bet['window'][1]:.3f} ({bet['n_points']} pts, "
                     f"R² = {bet['r2']:.5f})")
        if bet.get('c', 1) < 0:
            lines.append("  WARNING: negative C — shrink the window "
                         "(Rouquerol limit).")
        if 'rouquerol' in results:
            lines.append(f"  Rouquerol limit:  P/P0 = "
                         f"{results['rouquerol']:.3f}")
    tplot = results.get('tplot')
    if tplot:
        lines.append(f"t-plot ({tplot['window'][0]:.1f}–"
                     f"{tplot['window'][1]:.1f} Å, R² = {tplot['r2']:.4f}):")
        lines.append(f"  External area:    {tplot['s_ext']:.2f} m²/g")
        lines.append(f"  Micropore volume: {tplot['v_micro']:.4f} cm³/g")
        if bet:
            lines.append(f"  Micropore area:   "
                         f"{max(0.0, bet['s_bet'] - tplot['s_ext']):.2f} m²/g")
    if results.get('v_total') is not None:
        lines.append(f"Total pore volume:  {results['v_total']:.4f} cm³/g "
                     "(Gurvich, P/P0 = 0.95)")
    bjh = results.get('bjh')
    if bjh:
        peak = max(bjh, key=lambda p: p['dv_dlogd'])
        branch_name = ('desorption' if results.get('bjh_desorption')
                       else 'adsorption')
        lines.append(f"BJH ({branch_name} branch): "
                     f"{bjh[-1]['cum_v']:.4f} cm³/g in "
                     f"{bjh[-1]['d_nm']:.1f}–{bjh[0]['d_nm']:.1f} nm")
        lines.append(f"  Peak pore size:   {peak['d_nm']:.1f} nm "
                     "(dV/dlogD maximum)")
    lines.append("Isotherm branches:  "
                 + ("adsorption + desorption (hysteresis readable)"
                    if has_desorption else "adsorption only"))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------

def _bet_sheet_names(window):
    return sorted(n for n, s in window.Data.get('Core levels', {}).items()
                  if isinstance(s, dict) and str(n).upper().startswith('BET'))


class BETAnalysisWindow(wx.Frame):
    SECTIONS = (
        ('bet', "BET Surface Area", '_build_bet_tab'),
        ('tplot', "t-Plot", '_build_tplot_tab'),
        ('bjh', "Pore Size (BJH)", '_build_bjh_tab'),
        ('report', "Report", '_build_report_tab'),
    )
    SECTION_TITLES = {k: t for k, t, _b in SECTIONS}

    def __init__(self, parent, sections=None):
        keys = [k for k, _t, _b in self.SECTIONS]
        self._section_keys = ([s for s in (sections or keys) if s in keys]
                              or keys)
        single = len(self._section_keys) == 1
        title = (f"BET {self.SECTION_TITLES[self._section_keys[0]]}" if single
                 else "BET / Physisorption Analysis")
        size = (540, 640) if single else (660, 700)
        super().__init__(parent, title=title, size=size,
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        self.parent = parent

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
        self.SetMinSize((500, 500))
        self.CentreOnParent()

        if not hasattr(parent, '_bet_windows'):
            parent._bet_windows = []
        parent._bet_windows.append(self)
        parent.bet_analysis_window = self

    # ------------------------------------------------------------- tabs ----
    def _build_bet_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        sheet_box = wx.StaticBoxSizer(wx.HORIZONTAL, panel, "Isotherm sheet")
        self.sheet_combo = wx.ComboBox(panel, style=wx.CB_READONLY)
        self.sheet_combo.Bind(wx.EVT_COMBOBOX, self.on_sheet_selected)
        sheet_box.Add(self.sheet_combo, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(sheet_box, 0, wx.ALL | wx.EXPAND, 8)

        range_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "BET window (P/P0)")
        grid = wx.FlexGridSizer(2, 2, 5, 5)
        grid.AddGrowableCol(1)
        grid.Add(wx.StaticText(panel, label="From:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.relp_lo_ctrl = wx.SpinCtrlDouble(panel, min=0.001, max=0.99,
                                              initial=0.05, inc=0.005)
        self.relp_lo_ctrl.SetDigits(3)
        grid.Add(self.relp_lo_ctrl, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="To:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.relp_hi_ctrl = wx.SpinCtrlDouble(panel, min=0.001, max=0.99,
                                              initial=0.30, inc=0.005)
        self.relp_hi_ctrl.SetDigits(3)
        grid.Add(self.relp_hi_ctrl, 0, wx.EXPAND)
        range_box.Add(grid, 0, wx.ALL | wx.EXPAND, 5)
        vbox.Add(range_box, 0, wx.ALL | wx.EXPAND, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        fit_btn = wx.Button(panel, label="Fit BET")
        fit_btn.Bind(wx.EVT_BUTTON, self.on_fit_bet)
        buttons.Add(fit_btn, 0, wx.RIGHT, 5)
        plot_btn = wx.Button(panel, label="Create BET~Plot sheet")
        plot_btn.SetToolTip("The BET transform 1/[Q(P0/P − 1)] against P/P0 "
                            "with the fitted line, as its own sheet")
        plot_btn.Bind(wx.EVT_BUTTON, self.on_bet_plot_sheet)
        buttons.Add(plot_btn, 0)
        vbox.Add(buttons, 0, wx.ALL, 8)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Result")
        self.bet_result = wx.StaticText(panel, label="—")
        result_box.Add(self.bet_result, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(result_box, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_tplot_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        range_box = wx.StaticBoxSizer(wx.VERTICAL, panel,
                                      "Thickness window (Harkins-Jura t, Å)")
        grid = wx.FlexGridSizer(2, 2, 5, 5)
        grid.AddGrowableCol(1)
        grid.Add(wx.StaticText(panel, label="From:"), 0,
                 wx.ALIGN_CENTER_VERTICAL)
        self.t_lo_ctrl = wx.SpinCtrlDouble(panel, min=1.0, max=15.0,
                                           initial=3.5, inc=0.1)
        self.t_lo_ctrl.SetDigits(1)
        grid.Add(self.t_lo_ctrl, 0, wx.EXPAND)
        grid.Add(wx.StaticText(panel, label="To:"), 0, wx.ALIGN_CENTER_VERTICAL)
        self.t_hi_ctrl = wx.SpinCtrlDouble(panel, min=1.0, max=15.0,
                                           initial=5.0, inc=0.1)
        self.t_hi_ctrl.SetDigits(1)
        grid.Add(self.t_hi_ctrl, 0, wx.EXPAND)
        range_box.Add(grid, 0, wx.ALL | wx.EXPAND, 5)
        vbox.Add(range_box, 0, wx.ALL | wx.EXPAND, 8)

        buttons = wx.BoxSizer(wx.HORIZONTAL)
        fit_btn = wx.Button(panel, label="Fit t-plot")
        fit_btn.Bind(wx.EVT_BUTTON, self.on_fit_tplot)
        buttons.Add(fit_btn, 0, wx.RIGHT, 5)
        sheet_btn = wx.Button(panel, label="Create BET~tPlot sheet")
        sheet_btn.SetToolTip("Q against film thickness t with the fitted "
                             "line, as its own sheet")
        sheet_btn.Bind(wx.EVT_BUTTON, self.on_tplot_sheet)
        buttons.Add(sheet_btn, 0)
        vbox.Add(buttons, 0, wx.ALL, 8)

        result_box = wx.StaticBoxSizer(wx.VERTICAL, panel, "Result")
        self.tplot_result = wx.StaticText(panel, label="—")
        result_box.Add(self.tplot_result, 1, wx.ALL | wx.EXPAND, 5)
        vbox.Add(result_box, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_bjh_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        row = wx.BoxSizer(wx.HORIZONTAL)
        row.Add(wx.StaticText(panel, label="Branch:"), 0,
                wx.ALIGN_CENTER_VERTICAL | wx.RIGHT, 5)
        self.branch_choice = wx.Choice(
            panel, choices=["Desorption (standard)", "Adsorption"])
        self.branch_choice.SetSelection(0)
        row.Add(self.branch_choice, 0, wx.RIGHT, 10)
        run_btn = wx.Button(panel, label="Run BJH")
        run_btn.Bind(wx.EVT_BUTTON, self.on_run_bjh)
        row.Add(run_btn, 0, wx.RIGHT, 5)
        sheet_btn = wx.Button(panel, label="Create BET~Pore sheet")
        sheet_btn.SetToolTip("dV/dlog(D) against pore diameter, as its own "
                             "sheet")
        sheet_btn.Bind(wx.EVT_BUTTON, self.on_pore_sheet)
        row.Add(sheet_btn, 0)
        vbox.Add(row, 0, wx.ALL, 8)

        self.bjh_grid = wx.grid.Grid(panel)
        self.bjh_grid.CreateGrid(0, 4)
        for col, (title, width) in enumerate((("D (nm)", 85),
                                              ("V inc (cm³/g)", 105),
                                              ("dV/dlogD", 105),
                                              ("Cum. V (cm³/g)", 110))):
            self.bjh_grid.SetColLabelValue(col, title)
            self.bjh_grid.SetColSize(col, width)
        self.bjh_grid.SetRowLabelSize(28)
        self.bjh_grid.EnableEditing(False)
        vbox.Add(self.bjh_grid, 1, wx.ALL | wx.EXPAND, 8)

        panel.SetSizer(vbox)
        return panel

    def _build_report_tab(self, notebook):
        panel = wx.Panel(notebook)
        vbox = wx.BoxSizer(wx.VERTICAL)

        refresh_btn = wx.Button(panel, label="Refresh report")
        refresh_btn.Bind(wx.EVT_BUTTON, lambda e: self._update_report())
        vbox.Add(refresh_btn, 0, wx.ALL, 8)

        self.report_ctrl = wx.TextCtrl(
            panel, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.TE_DONTWRAP)
        self.report_ctrl.SetFont(wx.Font(9, wx.FONTFAMILY_TELETYPE,
                                         wx.FONTSTYLE_NORMAL,
                                         wx.FONTWEIGHT_NORMAL))
        vbox.Add(self.report_ctrl, 1, wx.ALL | wx.EXPAND, 8)

        copy_btn = wx.Button(panel, label="Copy to clipboard")
        copy_btn.Bind(wx.EVT_BUTTON, self.on_copy_report)
        vbox.Add(copy_btn, 0, wx.ALL, 8)

        panel.SetSizer(vbox)
        return panel

    # ------------------------------------------------------------ helpers --
    def refresh_sheet_list(self):
        current = self.sheet_combo.GetValue()
        names = _bet_sheet_names(self.parent)
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
                                            "No isotherm sheet selected.")
        return name, sheet

    def _isotherm_of(self, sheet):
        """(x, q, branch) of the measured isotherm behind the selection.

        A derived BET~... sheet points back at its source, so the fits always
        run on the measurement rather than on a transform of a transform.
        """
        source_name = sheet.get('BET_Source_Sheet')
        if source_name:
            source = self.parent.Data.get('Core levels', {}).get(source_name)
            if isinstance(source, dict):
                sheet = source
        return (sheet.get('B.E.', []), sheet.get('Raw Data', []),
                sheet.get('BET_Branch'))

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
            self.bet_result.SetLabel("No BET sheets in this project.")
            return
        results = load_results(sheet)
        bet = results.get('bet')
        if bet:
            self.bet_result.SetLabel(self._bet_text(bet, results))
            self.relp_lo_ctrl.SetValue(bet['window'][0])
            self.relp_hi_ctrl.SetValue(bet['window'][1])
        tplot = results.get('tplot')
        if tplot:
            self.tplot_result.SetLabel(self._tplot_text(tplot, results))
        self._populate_bjh(results.get('bjh') or [])
        self._update_report()

    # ------------------------------------------------------------ actions --
    def _bet_text(self, bet, results):
        lines = [f"S(BET) = {bet['s_bet']:.2f} m²/g",
                 f"Qm = {bet['qm']:.3f} cm³/g STP,  C = {bet['c']:.1f}",
                 f"R² = {bet['r2']:.5f} over {bet['n_points']} points "
                 f"({bet['window'][0]:.3f}–{bet['window'][1]:.3f})"]
        if bet['c'] < 0:
            lines.append("C < 0: window reaches past the Rouquerol limit — "
                         "lower the upper bound.")
        if results.get('rouquerol') is not None:
            lines.append(f"Rouquerol limit: P/P0 = {results['rouquerol']:.3f}")
        if results.get('v_total') is not None:
            lines.append(f"Total pore volume (0.95): "
                         f"{results['v_total']:.4f} cm³/g")
        return "\n".join(lines)

    def on_fit_bet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x, q, branch = self._isotherm_of(sheet)
        fit = fit_bet(x, q, self.relp_lo_ctrl.GetValue(),
                      self.relp_hi_ctrl.GetValue(), branch)
        if fit is None:
            self.parent.show_popup_message2(
                "Information",
                "No BET line in that window — it needs at least three points "
                "with 0 < P/P0 < 1.")
            return
        results = load_results(sheet)
        results['bet'] = fit
        results['rouquerol'] = rouquerol_limit(x, q, branch)
        results['v_total'] = total_pore_volume(x, q)
        store_results(sheet, results)
        self._persist()
        self.bet_result.SetLabel(self._bet_text(fit, results))
        self._update_report()

    def on_bet_plot_sheet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x, q, branch = self._isotherm_of(sheet)
        fit = load_results(sheet).get('bet')
        if fit is None:
            self.parent.show_popup_message2("Information",
                                            "Run 'Fit BET' first.")
            return
        ads = adsorption_mask(np.asarray(x, dtype=float), branch)
        tx, ty = bet_transform(np.asarray(x, dtype=float)[ads],
                               np.asarray(q, dtype=float)[ads])
        show = tx <= min(0.5, 1.5 * fit['window'][1])
        line_x = np.array(fit['window'])
        new_name = self._new_sheet('BET~Plot')
        self._write_sheet(new_name, tx[show].tolist(), ty[show].tolist(), {
            'BET_X_Label': 'Relative pressure (P/P$_0$)',
            'BET_Y_Label': '1/[Q(P$_0$/P − 1)] (g/cm$^3$ STP)',
            'BET_Source_Sheet': name.split('~')[0],
            'BET_Fit_X': line_x.tolist(),
            'BET_Fit_Y': (fit['slope'] * line_x + fit['intercept']).tolist(),
        })
        self._select_sheet_on_main(new_name)

    def _tplot_text(self, tplot, results):
        lines = [f"External area S(ext) = {tplot['s_ext']:.2f} m²/g",
                 f"Micropore volume = {tplot['v_micro']:.4f} cm³/g",
                 f"R² = {tplot['r2']:.4f} over {tplot['n_points']} points "
                 f"({tplot['window'][0]:.1f}–{tplot['window'][1]:.1f} Å)"]
        bet = results.get('bet')
        if bet:
            lines.append(f"Micropore area = "
                         f"{max(0.0, bet['s_bet'] - tplot['s_ext']):.2f} m²/g "
                         "(S_BET − S_ext)")
        return "\n".join(lines)

    def on_fit_tplot(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x, q, branch = self._isotherm_of(sheet)
        fit = fit_t_plot(x, q, self.t_lo_ctrl.GetValue(),
                         self.t_hi_ctrl.GetValue(), branch)
        if fit is None:
            self.parent.show_popup_message2(
                "Information", "Fewer than three points in that thickness "
                               "window — widen it.")
            return
        results = load_results(sheet)
        results['tplot'] = fit
        store_results(sheet, results)
        self._persist()
        self.tplot_result.SetLabel(self._tplot_text(fit, results))
        self._update_report()

    def on_tplot_sheet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x, q, branch = self._isotherm_of(sheet)
        fit = load_results(sheet).get('tplot')
        if fit is None:
            self.parent.show_popup_message2("Information",
                                            "Run 'Fit t-plot' first.")
            return
        xa = np.asarray(x, dtype=float)
        qa = np.asarray(q, dtype=float)
        ads = adsorption_mask(xa, branch)
        keep = ads & (xa > 1e-6) & (xa < 0.999)
        t = t_harkins_jura(xa[keep])
        order = np.argsort(t)
        line_t = np.array([0.0, float(np.max(t))])
        new_name = self._new_sheet('BET~tPlot')
        self._write_sheet(new_name, t[order].tolist(),
                          qa[keep][order].tolist(), {
                              'BET_X_Label': 'Statistical thickness t (Å)',
                              'BET_Y_Label':
                                  'Quantity adsorbed (cm$^3$/g STP)',
                              'BET_Source_Sheet': name.split('~')[0],
                              'BET_Fit_X': line_t.tolist(),
                              'BET_Fit_Y': (fit['slope'] * line_t
                                            + fit['intercept']).tolist(),
                          })
        self._select_sheet_on_main(new_name)

    def on_run_bjh(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        x, q, branch = self._isotherm_of(sheet)
        use_desorption = self.branch_choice.GetSelection() == 0
        pores = bjh_distribution(x, q, branch, use_desorption)
        if not pores:
            self.parent.show_popup_message2(
                "Information",
                "No BJH steps found — the chosen branch needs points with "
                "P/P0 above 0.30.")
            return
        results = load_results(sheet)
        results['bjh'] = pores
        results['bjh_desorption'] = use_desorption
        store_results(sheet, results)
        self._persist()
        self._populate_bjh(pores)
        self._update_report()

    def _populate_bjh(self, pores):
        grid = self.bjh_grid
        current = grid.GetNumberRows()
        if current:
            grid.DeleteRows(0, current)
        if not pores:
            return
        grid.AppendRows(len(pores))
        for row, p in enumerate(pores):
            grid.SetCellValue(row, 0, f"{p['d_nm']:.2f}")
            grid.SetCellValue(row, 1, f"{p['v_inc']:.5f}")
            grid.SetCellValue(row, 2, f"{p['dv_dlogd']:.5f}")
            grid.SetCellValue(row, 3, f"{p['cum_v']:.5f}")
        grid.ForceRefresh()

    def on_pore_sheet(self, event):
        name, sheet = self.get_sheet_data()
        if sheet is None:
            return
        pores = load_results(sheet).get('bjh')
        if not pores:
            self.parent.show_popup_message2("Information",
                                            "Run 'Run BJH' first.")
            return
        ordered = sorted(pores, key=lambda p: p['d_nm'])
        new_name = self._new_sheet('BET~Pore')
        self._write_sheet(new_name, [p['d_nm'] for p in ordered],
                          [p['dv_dlogd'] for p in ordered], {
                              'BET_X_Label': 'Pore diameter (nm)',
                              'BET_Y_Label': 'dV/dlog(D) (cm$^3$/g)',
                              'BET_Source_Sheet': name.split('~')[0],
                          })
        self._select_sheet_on_main(new_name)

    def _update_report(self):
        if not hasattr(self, 'report_ctrl'):
            return
        name, sheet = self.get_sheet_data(complain=False)
        if sheet is None:
            self.report_ctrl.SetValue("No isotherm selected.")
            return
        x, q, branch = self._isotherm_of(sheet)
        has_desorption = int((~adsorption_mask(
            np.asarray(x, dtype=float), branch)).sum()) >= 3
        results = load_results(sheet)
        if not results:
            self.report_ctrl.SetValue("No results yet — run the BET fit.")
            return
        self.report_ctrl.SetValue(report_text(name, results, has_desorption))

    def on_copy_report(self, event):
        if wx.TheClipboard.Open():
            wx.TheClipboard.SetData(
                wx.TextDataObject(self.report_ctrl.GetValue()))
            wx.TheClipboard.Close()

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
        from libraries.FileMenu.KFitting_Import import (TECH_BET,
                                                        build_generic_sheet)
        sheet = build_generic_sheet(TECH_BET, name, list(x), list(y),
                                    source_name=extra.get('BET_Source_Sheet',
                                                          ''))
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
            print(f"BET persist skipped: {e}")

    # --------------------------------------------------------------- close --
    def on_close(self, event):
        windows = getattr(self.parent, '_bet_windows', None)
        if windows and self in windows:
            windows.remove(self)
        remaining = windows or []
        if getattr(self.parent, 'bet_analysis_window', None) is self:
            self.parent.bet_analysis_window = (remaining[-1] if remaining
                                               else None)
        self.Destroy()


def open_bet_window(window):
    """Open (or raise) the full BET / Physisorption Analysis window."""
    for existing in list(getattr(window, '_bet_windows', [])):
        try:
            if len(getattr(existing, '_section_keys', [])) == len(
                    BETAnalysisWindow.SECTIONS):
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = BETAnalysisWindow(window)
    frame.Show()
    return frame


def open_bet_section(window, key):
    """Open one BET tab as its own window."""
    for existing in list(getattr(window, '_bet_windows', [])):
        try:
            if getattr(existing, '_section_keys', None) == [key]:
                existing.Raise()
                return existing
        except RuntimeError:
            pass
    frame = BETAnalysisWindow(window, sections=[key])
    frame.Show()
    return frame
