# KherveFitting web: behaviour parity with the desktop KherveFitting-AI

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (v1.93). Web port: `src/apps/khervefitting/`
and its Python engine `public/apps/khervefitting/py/` (kfcore = the desktop's wx-free code, kfweb = the
bridge). This list covers what the user can **do** (mouse, keys, buttons, menus, panels, tables),
not the layout. ✔ = behaves as the desktop, ◐ = works with a stated difference, ✘ = not in the web
edition yet (greyed out or a "not in the web edition yet" message).

Sources read for this pass: `KherveFitting.py` (MyFrame), `libraries/On_Key_Defs.py`,
`libraries/On_Mouse_Defs.py`, `libraries/PeakManipulation.py`, `libraries/PlotConfig.py`,
`libraries/ToolsMenu/Fitting_Screen.py`, `libraries/PeakFittingGrid.py`, `libraries/Widgets_Toolbars.py`,
`libraries/Utilities.py`, `libraries/FileMenu/Save.py`, `libraries/HelpMenu/Help.py`.

Last checked: 2026-10-07 (this pass: background lines, keyboard, peak handling, table menus).

## 1. Keyboard (On_Key_Defs.KeyEventHandlers, menu accelerators)

Ctrl is ⌘ on a Mac, as wx does (`ControlDown()` is Cmd there). The keys also work while the Peak
Fitting window has the focus (its EVT_CHAR_HOOK reaches the main window); plain keys typed in a text
field belong to the field.

| Key | Desktop effect | Web |
|---|---|---|
| Ctrl+Z / Ctrl+Y | Undo / redo (50 steps) | ✔ (50 steps) |
| Ctrl+S | Quick save (Save Data .json) | ✔ |
| Ctrl+O | Open KFitting file | ✔ |
| Ctrl+N | New (menu accelerator) | ✔ (the browser may keep ⌘N for itself) |
| Ctrl+Q | Exit | ✔ (closes the window) |
| Ctrl+P | Open the Peak Fitting window (raise it if open) | ✔ |
| Ctrl+K | "Keyboard Shortcuts" popup | ✔ same text |
| Ctrl+H | User Guide | ◐ opens khervetools.com |
| Ctrl+M | Open Full Manual | ✘ |
| Ctrl+B | Show Kinetic Energy (Beta) | ✘ (message) |
| Ctrl+[ / Ctrl+9 | Previous core level (wraps round) | ✔ |
| Ctrl+] / Ctrl+0 | Next core level (wraps round) | ✔ (was: stopped at the ends) |
| Ctrl+= / Ctrl++ | Zoom in: both BE limits in by max(2 % span, 0.2 eV) | ✔ (was missing) |
| Ctrl+- | Zoom out by the same step | ✔ (was missing) |
| Ctrl+Left / Ctrl+Right | Both BE limits −/+ max(1 % span, 0.1 eV) | ✔ (was missing) |
| Ctrl+Up / Ctrl+Down | Ymax ± 5 % of the tallest point (never below Ymin) | ✔ (was missing) |
| Shift+Left / Shift+Right | High-BE edge (High BE + / High BE −) | ✔ (was missing) |
| Alt+Left / Alt+Right | Selected peak position +0.1 / −0.1 eV (linked peaks follow) | ✔ (was missing) |
| Alt+Up / Alt+Down | Selected peak height ±5 %, area recalculated | ✔ (was missing) |
| Alt+Shift+Right / Left | Selected peak FWHM ±0.05 (σ for the Voigt models, γ for ExpGauss, σ/γ for DS*G), linked widths follow | ✔ (was missing) |
| Tab (BKG tab) | Next background region (lines go to it) | ✔ |
| Tab / Q (Fitting tab) | Next / previous peak (wraps); Shift+Tab previous | ✔ |
| Tab / Q (no Fitting tab) | "Open the Peak Fitting Tab to move or select a peak" (Tab: at most every 10 s) | ✔ |
| Up / Down in Offset / Region fields | Step the digit right of the cursor and apply at once | ✔ (was missing) |
| Delete (Results grid) | Delete the selected results row | ✔ (also Backspace) |
| F1 | Overview (multi-plot grid) | ✘ |
| F2 / F3 / F4 (Ctrl+2/3/4) | Sample Manager overlays | ✘ |
| Delete / Escape on the plot | (none on the desktop) | ✔ removed (the web had Delete = remove peak) |

## 2. Plot mouse (On_Mouse_Defs, PeakManipulation, PlotConfig)

| Action | Desktop | Web |
|---|---|---|
| Move over the plot | Status bar "BE: x eV, I: y CPS" | ✔ |
| Double-click in the axes | Plot Limits window | ✔ |
| Double-click outside the axes | Overview (multi-plot grid) | ✘ |
| Right-click | Context menu (§6) | ✔ |
| Wheel | Only with a peak selected on the Fitting tab: its width ±0.05 per notch (σ for Voigt, area for SingleEntity); otherwise nothing | ✔ (the web zoomed the axis instead) |
| **BKG tab**: press near a red line (≤ max(0.1 eV, 2 % of the data range)) | Drag that line | ✔ |
| BKG tab: press elsewhere | The nearer line jumps there and is dragged | ✔ (was missing) |
| BKG tab: release after a drag | Active region takes the new range (update_active_region_positions), every region is redrawn (redraw_all_regions_background), Bkg Low/High/Type and the peaks' background columns updated | ✔ (**was missing: the background never changed**) |
| BKG tab: Ctrl+drag | Both lines move, gap kept; region redrawn on release | ✔ (was missing) |
| BKG tab: Shift+press / Shift+drag | Offset of the nearer line = mouse height − data there (≤ 0): low-BE line → Offset (Right), high-BE → Offset (Left); background redrawn while dragging | ✔ (was missing) |
| BKG tab: no region yet | Lines move, only Bkg Low/High kept (Shift+press draws an unrecorded background) | ✔ |
| BKG tab: averaging marks | Two red + one grey dashed marks at each line over the Averaging Points | ✔ (was missing) |
| Red line labels | Value in a white box, high BE at 90 %, low BE at 80 % of the height | ✔ |
| Lines hidden while Zoom In / Drag is active | yes | ✔ |
| **Fitting tab**: press within 100 px of the selected peak's top (blue ×) | Drag it: the top follows the mouse (height above the background), linked peaks follow; one undo step | ✔ (the web picked any peak within 14 px) |
| Fitting tab: Shift+drag on the selected peak | Width follows the mouse from the press point (FWHM, σ for Voigt, γ for ExpGauss…) | ✔ (was missing) |
| Fitting tab: press elsewhere | Deselect | ✔ |
| Click a peak that is not selected | Nothing (peaks are selected from the table or with Tab / Q) | ✔ (the web selected it) |
| Selected peak note | "Model / Position / FWHM meas. / Area / ¿ Change width ? / Scroll the wheel" | ✔ |
| No Fitting window | Clicks deselect, no peak can be selected or dragged | ✔ |
| Green line tool | Line at the centre, drag anywhere within the threshold, label at 95 % | ✔ |
| Zoom In tool | One green rectangle (min 5 px), then the tool turns itself off | ✔ (the web stayed in zoom mode, black dashed box) |
| Drag tool | One pan, then off; hand cursor | ✔ (the web stayed in pan mode) |
| Zoom Out tool | Original limits | ✔ |
| Core-level title: drag / double-click to rename; legend drag | PlotLabelEdit | ✘ |
| Kinetic-energy axis | Ctrl+B | ✘ |

## 3. Vertical plot toolbar (Widgets_Toolbars.create_vertical_toolbar)

| Tool | Web |
|---|---|
| Toggles pop-up (fit, legend, fit results, residuals, peak fill, Y axis) | ✔ |
| Zoom In / Zoom Out / Drag / Plot Limits / Green line | ✔ (see §2) |
| High BE + / − (red arrows), Low BE + / − (blue), High Int + / −, Low Int + / − | ✔ steps of PlotConfig.adjust_plot_limits (**Low BE + / − moved the wrong way**: fixed) |
| A+ / A− (font size) | ✔ |
| Labels Manager | ✘ |

## 4. Peak Fitting window (Fitting_Screen.FittingWindow)

| Control | Desktop | Web |
|---|---|---|
| Opening | Centred on the main window, BKG tab, peaks deselected; an open window is only raised | ✔ (was a fixed place, and re-opening reset the tab) |
| Entering the BKG tab | Active region (or region 1) activated, lines go to it | ✔ (**was missing: no region was active, so nothing followed the lines**) |
| Leaving the Fitting tab / closing | Peak deselected | ✔ |
| Method | Sets the method used by the next region / redraw (no immediate redraw, as the desktop); separators → Smart; mini mode: Smart, U2-Tougaard, Active Shirley, Active Tougaard | ✔ |
| Offset (Left) / (Right) + Enter | offset = −|value|; active region updated, every region redrawn, peaks' Bkg Offset columns | ✔ (was: replaced all regions by one) |
| Region (Left) / (Right) + Enter | Moves the high / low line (swapped if crossed), active region + redraw | ✔ (was: only moved the lines) |
| Up / Down in those four fields | Digit stepping (§1) | ✔ |
| Averaging Points | Applied as typed (≥ 1), marks updated | ✔ |
| Smooth noisy data | Gaussian smoothing (σ = 5) for Create Region | ✔ (was ignored) |
| Tougaard1: B,C,D,T0 | Stored as typed; enabled only for U4/U2/Spline Tougaard, Power-EELS | ✔ |
| Region boxes 1…n | Activate the region, lines go to it | ✔ |
| Switch Region (TAB key) | Next region | ✔ |
| Create Region | Background at the lines (with the offsets), recorded, becomes active | ✔ |
| Remove Regions and Peaks | Confirmation "Are you sure you want to clear all background data?" | ✔ (no confirmation before) |
| Remove All Regions | Confirmation | ✔ (no confirmation before) |
| Remove Current Region | "No active region selected to remove." / confirmation; region 1 becomes active | ✔ |
| Tougaard / Raman / XAS Model | Enabled for U4-Tougaard, ALS-Raman, Arctan-XAS; opens the model fit window | ◐ enabled state ✔, window ✘ |
| Fitting tab: model, method, convergence, stable for, weights, R², Red. χ², current fit, χ history | ✔ |
| Add 1 Peak Singlet | At the largest residual, **not selected**; "Please create a background first." | ✔ (the web selected the new peak and greyed the button) |
| Add 2 Peaks Doublet / Add Doublet with Name… / Remove Last Peak | ✔ |
| Fit One Time / Fit Until Stable / Report ± | ✔ |
| Adv. Fitting (continuous fit) | ✘ (shown disabled) |
| Batch: Select / Unselect All, Propagate fit / constraints / row, Fit selected | ✔ |
| Batch list right-click (select by core type) | ✘ |
| "?" User Guide | ✘ |

## 5. Peak Fitting Parameters table

| Action | Desktop | Web |
|---|---|---|
| Edit a value / constraint, Enter | on_peak_params_cell_changed: checks, linked peaks, area, then redraw | ✔ |
| "f" in a constraint | fixed | ✔ |
| Fitting Model column | Choice editor | ✔ |
| Select a cell (click, arrows) | Selects the peak only on the Fitting tab (blue × on the plot); constraint row deselects | ✔ (the web selected on any tab) |
| Right-click › Copy Peak Table / Paste Peak Table | Save.copy/paste_all_peak_parameters (works across core levels) | ✔ (was missing) |
| Right-click › Export to Results Grid | ✔ (was missing) |
| Right-click › Delete Peak X | Constraint letters renumbered | ✔ (was missing) |
| Right-click › Add Peak › 22 models | Peak of that model at the largest residual, inserted at the clicked peak | ✔ (was missing) |
| Right-click › "Constraint all … to X" / "…: X*1" | Utilities.propagate_constraint | ✔ (was missing) |
| Right-click › "Constraint all Current FWHMs to X" (FWHM constraint row) | Utilities.propagate_fwhm_difference | ✔ (was missing) |
| Right-click › Constraint to Other Core Levels › level › peak | insert_cross_core_constraint (position difference / area ratio / *1) | ✔ (was missing) |
| Hover a fitted value | value ± 1σ | ✔ |
| Show / hide extra columns | ✔ |

## 6. Plot right-click menu (XPS sheet)

| Item | Web |
|---|---|
| Zoom In / Zoom Out | ✔ |
| Overview | ✘ |
| Copy Core Level / Paste Core Level | ✔ (the web duplicated the sheet for both) |
| Crop Core Level | ✔ |
| Copy Peak Table / Paste Peak Table | ✔ |
| Fit Uncertainties ±… | ✔ |
| (no Style entry for a single spectrum) | ✔ (the web showed an invented Style menu and a "Delete Peak" entry: removed) |
| Export › SVG / PNG / CSV, About SVG & Inkscape… | ✔ |
| Export › PDF / XLSX / KherveSheet | ✘ |
| Rename '<sheet>' | ✔ |
| Edit Data / Info | ✘ |

## 7. Results grid

| Action | Web |
|---|---|
| Tick box (column 7): atomic % recalculated, plot redrawn | ✔ |
| Edit label / RSF / TXFN | ✔ |
| Delete key: delete the selected row | ✔ (was missing) |
| Right-click › Export Fitting Grid / Remove All / First / Last Lines | ✔ (was missing) |
| Toolbar: Export, Export several core levels, Remove all / first / last / selected | ✔ except "Export several core levels" ✘ |

## 8. Main toolbar and menus

| Item | Web |
|---|---|
| Open, Quick Save, Export (Excel, all), Undo, Redo, Sort, Sample Manager, sheet selector, BE correction, Refresh, Delete / Rename sheet, Crop, Auto BE, Measure Area, Peak Fitting, Mini Fitting, Monte Carlo, D-parameter, PCA, Auto ID, ID, KherveDB, KherveAI, Peak library open / save, Preferences, columns, right panel | ✔ |
| Plot Modifications, Thickness, VB / Fermi, Denoising, Profile Creator, Plot Creator, Labels Manager | ✘ (message) |
| Menus: every desktop item is listed; those without a web feature are greyed out (imports other than VAMAS / CSV, .kfit, KE, techniques other than XPS, MCP…) | ◐ |
| Sheet switching (selector, Ctrl+[ ]) | ✔ selection cleared, region re-activated on the BKG tab |
| Undo / Redo of every change above (drag, keys, wheel, offsets, table menus) | ✔ one step per action, as save_state |

## 9. Tool windows (not part of this pass)

Measure Area (its centre line, wheel = range, Tab = next peak), Crop, Join, BE correction, D-parameter,
ID / Auto ID, PCA, Sample Manager: the windows are there; the Measure Area window's own mouse and
key bindings (centre line, wheel, Tab/Q) are ✘.

## Tests

- `node --test src/apps/khervefitting/tests/*.test.mjs` — the key / limit rules (interaction.test.mjs).
- Engine: every new request (`lines`, `range_fields`, `offsets`, `region_select`, `peak_key`,
  `peak_wheel`, `peak_width`, `add_peak_model`, `propagate_constraint`, `propagate_fwhm_diff`,
  `cross_constraint`, `peaks_copy` / `peaks_paste`, undo) run in Pyodide 314.0.7 the page's way.
- End to end: the KherveFitting window in jsdom with the real engine in Pyodide: Ctrl+P, Create
  Region, line drag / click / Ctrl+drag / Shift+click with the background recalculated, Up-arrow digit
  stepping, Region field + Enter, Tab between regions, Remove Current Region, Add 1 Peak drawn, Tab / Q,
  Alt / Alt+Shift arrows, wheel, Ctrl+Z / Ctrl+Y, peak drag and Shift+drag, Ctrl+Up / Ctrl+Left /
  Ctrl+= / Shift+Right, Ctrl+] / Ctrl+[, Ctrl+K, the table's Add Peak menu, the Tab hint — 42 checks.
