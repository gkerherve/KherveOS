# KherveTGA: parity with the desktop KherveFitting-AI on a TGA / DSC sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50, v1.93). KherveTGA is that app's TGA / DSC
technique as an app of its own: the main window as the desktop shows it on a TGA sheet, with the technique
fixed. Shared base `src/apps/khervetech/` (CLAUDE.md, "Technique apps"); app `src/apps/khervetga/`.

The desktop's TGA code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`,
copied by `tools/export_khervetech.py`): `FileMenu/TGA_Import.py`, `FileMenu/TRI_Import.py`,
`ToolsMenu/TGA_Analysis.py`, `TGA_Engine.py`, `TGA_Chem.py`, `TGA_Plot.py`, `ViewMenu/TechniqueOverview.py`,
`TechniqueToolbar.py`, `ToolsMenu/TechniqueTool.py`, `FileMenu/KFitting_IO.py`, and functions cut unchanged from
`Plot_Operations.py`, `PlotConfig.py`, `Labels_Screen.py`, `KFitting_Import.py`, `Save.py`, `ConfigFile.py`,
`PlotLabelEdit.py`, `Widgets_Toolbars.py`. Its windows are drawn from their own wx sizers (headless wx,
`py/shims/wx`), its plots from what they draw (recording matplotlib, `py/shims/matplotlib`). So every
label, default value, tooltip, message, check and number below is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition (greyed or a message).

Sources read: `KherveFitting.py` (MyFrame: show_hide_vlines, show_popup_message2, defaults),
`Sheet_Operations.on_sheet_selected`, `Widgets_Toolbars.py` (create_menu: Import > TGA, Tools > TGA / DSC;
create_horizontal_toolbar; register_toolbar_tools), `ViewMenu/TechniqueToolbar.py`, `ViewMenu/TechniqueOverview.py`,
`ToolsMenu/TechniqueTool.py`, `On_Mouse_Defs.py` (press / motion / release of the range lines, right-click),
`On_Key_Defs.py`, `Plot_Operations.clear_and_replot`, `PlotConfig.update_plot_limits`, the TGA modules above.

Last checked: 2026-10-08.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "KherveTGA" (registry, group Science, Dock / KApps icon drawn from `Tech-TGA-3.png` at 256 px) | ✔ |
| File types: `.kfit` projects, `.tri` (TA TRIOS) open in KherveTGA; `.csv/.txt/.dat` through "Open with" or File › Import | ✔ (`.csv/.txt` stay KherveSheet's / Notepad's) |
| A `.kfit` holding another technique's sheets (BET…) goes to that app (asked; automatic when the window was opened for it) | ✔ |
| Examples copied to `~/Documents/KherveTGA Examples` on first launch | ✔ synthetic: the desktop ships no TGA data (`make_tga_examples`: NETZSCH STA 3-step CaC2O4·H2O with DSC + dwell + cooling, redox cycles, bare T/mass CSV, stepped-isothermal Ni oxidation) |
| Import writes the `.kfit` project next to the file and opens it (`_import_tga_paths` → `write_kfitting` / `open_kfitting_file`) | ✔ |
| Every analysis step persists the `.kfit` (`persist_project`) | ✔ |
| Project format `.kfit` (HDF5 via h5py, lossless `TGA_` arrays) | ✔ |
| `.xlsx` + `.json` projects | ✘ |

## 2. Main toolbar in the TGA mode (apply_technique_toolbar)

| Tool | Web |
|---|---|
| XPS tools taken off (BE spin, Auto BE, background, fitting, mini fitting, Monte Carlo, D-parameter, plot mods, thickogram, VB, PCA, denoise, profile / plot creator, Auto ID, ID, KherveDB, KherveAI, peak libraries, column toggle, right-panel toggle); their separators stay | ✔ |
| Open File | ◐ opens `.kfit` projects (not `.xlsx`) |
| Quick Save (Ctrl+S) | ✔ writes the `.kfit` (Save As when there is none) |
| Export this / all core levels (Excel, KherveSheet) | ✘ |
| Undo / Redo (50 steps, `save_state`) | ✔ |
| Sort sheets | ◐ natural name order |
| Sample Manager | ✘ |
| Sheet selector (an undo step, technique button, right frame, replot) | ✔ |
| Refresh | ◐ reopens the project from the drive |
| Delete / Rename sheet | ✔ (confirmation / single-word check) |
| Crop | ✘ |
| Technique button (Tech-TGA-3 icon, TechniqueTool help, opens the full TGA / DSC Analysis window) | ✔ |
| Ten section tiles Rng, Mass, DTG, DSC, Flow, Evt, Chem, Cyc, Iso, Cmp (green / grey alternating, SECTION_HELP tooltips, each opens its section in its own window) | ✔ |
| Preferences | ✘ |

## 3. Vertical plot toolbar

| Tool | Web |
|---|---|
| Zoom In (one box, then off), Zoom Out (original limits), Drag (one pan), Plot Limits, green line | ✔ |
| High / low X ± and high / low intensity ± (forward axis) | ✔ |
| A+ / A− | ✔ |
| Toggles pop-up: legend, Y axis (values / hidden / a.u.) | ✔ |
| Toggles pop-up: fit, peak fill, fit results, residuals (nothing to show on a TGA sheet, as the desktop) | ◐ |
| Labels Manager | ✘ |

## 4. The plot (clear_and_replot on a TGA sheet + TGA_Plot.draw_tga_extras)

| Item | Web |
|---|---|
| Time view: temperature programme (black) on the main axis, mass (%) and DSC on right-hand axes, outward spines 52 px apart, coloured ticks and labels, "exo ↑/↓" | ✔ |
| Temperature view: mass on the main axis, DSC right; DTG layer on its own axis; raw-mass layer; stored fit curve (TGA~Kinetics, TGA~Arrhenius) | ✔ |
| Raw data as black scatter (plot_style), plain y numbers, labels from `TGA_X_Label` / `TGA_Y_Label`, limits ±10 % of the span (`update_plot_limits`) | ✔ |
| One legend for all axes, upper left, legend_frame_kwargs; renamed trace (`TGA_Raw_Legend`) | ✔ |
| Mass-step labels (Label Manager 'step': dashed guides, double arrow, "name: −12.27 %") | ✔ |
| Integrated DSC peaks (green fill to the baseline, ΔH label), Tg lines and label, baseline preview | ✔ |
| Compare overlay (tab10 colours, the shown sheet dotted, difference curves) | ✔ |
| A drag of the red lines sets `Bkg Type` (desktop quirk), so the next replot draws the grey 'Background' copy | ✔ (as the desktop) |
| Ticks, ×10ⁿ, mathtext (`$^{-1}$`), fonts 11 pt | ◐ drawn in SVG from the recorded figure (KherveFitting's tick code), not by matplotlib |

## 5. Mouse and keyboard on the plot

| Action | Desktop | Web |
|---|---|---|
| Move | Status "BE: x eV, I: y CPS" (also on TGA sheets) | ✔ |
| Press with a TGA window open | The nearer red line is grabbed (Multi-Regions branch), follows the mouse, `Bkg Low/High` sorted, every TGA window's range boxes follow (update_range_controls) | ✔ |
| Release | `save_state` (undo step), `Bkg Type` | ✔ |
| Ctrl+drag both lines | | ✘ |
| Double-click | Plot Limits | ✔ |
| Right-click | Zoom In/Out, Overview, Copy/Paste/Crop Sheet, peak table items, Export ›, Rename, Edit Data, Info | ◐ Zoom, Copy Sheet, Export SVG / PNG / CSV, Rename ✔; the rest greyed |
| Ctrl+Z / Ctrl+Y, Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+Q, Ctrl+K | | ✔ |
| Ctrl+[ / Ctrl+] (Ctrl+9 / 0) | Previous / next sheet, wrapping | ✔ |
| Ctrl+= / Ctrl+−, Ctrl+arrows, Shift+Left/Right | Zoom, pan, intensity, high edge (forward axis) | ✔ |
| Tab / Q | "Open the Peak Fitting Tab…" hint (at most every 10 s) | ✔ |
| Ctrl+P (peak fitting), Ctrl+B, Ctrl+M, F1–F4 | | ✘ |
| Ctrl+H | User Guide | ◐ khervetools.com |

## 6. Menus

| Item | Web |
|---|---|
| File: New, New Instance, Open › Open KherveFitting HDF5 (.kfit), Open from This Computer…, Save As, Open File Location, Exit | ✔ |
| File › Open Examples | ◐ opens the examples folder in Files; a "KherveTGA Examples" submenu opens each |
| File › Save › Save Data, Export/Save to .kfit | ◐ both write the `.kfit` |
| File › Import › TGA › File(s) (.csv/.txt/.dat), Multiple files (folder), TA TRIOS DSC file(s) (.tri), Multiple .tri files (folder) — the desktop functions, their own file / folder dialogs | ✔ (the file dialog takes one file at a time) |
| File › Import › other techniques, XPS, Generic Excel | ✘ greyed |
| File › Export › plot SVG / PNG, data TXT / CSV / DAT (the sheet's columns), .kfit | ✔ |
| File › Export › PDF, Python Plot, VAMAS, KherveSheet, Report; Recent Files, Switch Format, Backup | ✘ |
| Edit › Undo / Redo; Sheet › Copy (as a new sheet), Delete, Rename | ✔ |
| Edit › Results-grid items, Paste / Join / Crop Sheets, Preferences | ✘ greyed |
| View › Toggle Legend | ✔ (other toggles: see §3) |
| View › Overview, Sample Manager, Labels Manager, Theme / Style, Kinetic energy | ✘ |
| Tools › TGA / DSC › Full Window (all tabs) + Range, Mass, DTG, DSC, Heat Flow, Events, Chemistry, Cycles, Isothermal, Compare | ✔ |
| Tools › XPS and the other techniques | ✘ greyed |
| AI › KherveAI | ◐ opens KherveOS's KherveAI (the AI tools of §10) |
| Help: website, paper, videos, shortcuts, About | ✔ |

## 7. Right frame: the TGA overview (TechniqueOverview, run unchanged)

| Item | Web |
|---|---|
| Notebook "TGA" + "Sample Manager" (the grids are taken out) | ✔ |
| Companion choice: Cycle table, Mass step table, Mass + DSC, then the other sheets of the run's family; adaptive default | ✔ |
| ↻ refresh; the companion follows main-plot zooms (xlim_changed, debounced) | ✔ |
| Companion canvas (twin axes, tables), double-click on a sheet companion selects it | ✔ |
| Sheet chips of the family (current one green, bold) | ✔ |
| Quick actions Range, DTG, DSC, Cycles (open those sections) | ✔ |
| Info box (sheet, label, points, range, initial mass, DSC, source) | ✔ |
| Sample Manager tab | ✘ |

## 8. The TGA / DSC Analysis window (TGA_Analysis.TGAAnalysisWindow, unchanged) and its section windows

Full window "TGA / DSC Analysis" (760 × 800, ten tabs) or one section "TGA <Section>" (480 × 640). Every tab is
built in both, as the desktop does. The window floats over the app (drag by its title, ✕ = EVT_CLOSE → on_close).
Changing tab shows that tab's sheet (on_tab_changed).

| Tab | Controls and actions (all ✔: the desktop's handlers) |
|---|---|
| Range | Measured Run combo + Refresh; run info; Blank / Baseline Run: Import blank run… (its FileDialog), Subtract from this run (disabled until loaded / after), Restore uncorrected, blank info + coverage note, "Show the correction curve as its own sheet"; Time Range t min / t max + Apply + Full range (with the red lines); selection info (temperatures, ramp, points, segments); Initial mass (mg), Normalise choice (6 bases), Generate mass vs temperature (+ DSC) sheet (green) → TGA~Mass, goes to the Mass tab; status line |
| Mass | Derived Sheet combo; info; Mass Basis choice + Dry mass + M + Apply; Smoothing (Savitzky-Golay / Moving average / Gaussian, width, Smooth, Restore raw), Layers raw / DTG; Legend name + Apply; Temperature Range boxes; Mass Change Region: Name, Edges over, Font, Add mass-change region (green), Delete selected, Clear all; regions table (9 columns) |
| DTG | dm/dT · dm/dt, Smoothing width, Calculate DTG (green), info, Add DTG as sheet (TGA~DTG); Sensitivity %, Detect peaks, Add at range centre, Delete selected; peaks table (Onset, Peak T, End T, height, Δm, direction) |
| DSC | info; Sign Convention (Exothermic up / down radios); Baseline choice (6) + Poly order + Anchors + description; Preview baseline on the plot; Add DSC as sheet (TGA~DSC); Temperature Range; Integrate peak (green), Clear peaks; Results text (full characterisation and transparency block) |
| Heat Flow | DSC Sheet combo + Refresh; info; Sample mass + Exo up / down; Ramp / segment choice (snaps the lines to the ramp); Baseline + Poly + Anchors + Preview; Temperature Range; ΔH° (100 % cryst.), Integrate peak (ΔH), Clear peaks; Measure Tg (step), Clear Tg; Results | 
| Events | Detect events (green), Delete selected, Clear all; events table (name editable, selecting a row shows the readings); Possible readings box |
| Chemistry | Formula, Initial δ, O sites, Mass change (%), Use selected region, Calculate δ (green); Host formula, Species (9 + Custom…), Formula, Number per f.u., Compare with the measured region (green); Results |
| Cycles | Stabilisation tolerance %, Analyse cycles (green); cycles table (9 columns); summary |
| Isothermal | Time Range boxes; Model choice (5), Fit (green), Try all models; Add fit as sheet (TGA~Kinetics); Arrhenius from all dwells (TGA~Arrhenius); Results |
| Compare | Run check list; Show (Mass / DTG / DSC / Difference from first), Align on temperature; Overlay selected (green), Clear overlay; Add difference as sheet (TGA~Diff); summary |

| Behaviour | Web |
|---|---|
| Messages (show_popup_message2: a balloon on the main window, at most one per 5 s on macOS) | ✔ |
| Text typed in a box is read by the next action (wx keeps it in the control) | ✔ |
| Choices, check boxes, radios, spins, combos, grids (cursor, row select, in-place edit of the event name), check list | ✔ |
| Tooltips | ✔ |
| Heat Flow tab with a `.tri` sheet | ◐ code unchanged; not exercised (no `.tri` file to test with) |
| Several file selection in one dialog (FD_MULTIPLE) | ◐ one file per dialog (the folder entries take several) |

## 9. Not in this pass

Labels Manager (moving / restyling the step labels), Overview (F1), Sample Manager, Preferences (styles of the
Other Plots tab), Excel / KherveSheet / PDF export, Recent Files, Ctrl+drag of both range lines, the peak
fitting window on a TGA sheet.

## 10. AI tools (src/os/ai/manifests/khervetga.ts, code src/apps/khervetech/aiTools.ts + src/apps/khervetga/actions.ts)

`khervetga_open_file`, `_open_example`, `_list_sheets`, `_select_sheet`, `_run` (generate, mass_step, smooth,
normalise, dtg, dtg_peaks, dsc_area, events, cycles, isothermal (one model or "all"), arrhenius, heatflow_peak,
glass_transition, oxygen, theoretical — each sets the window's own controls and runs the button's handler),
`_get_results`, `_export` (kfit / csv / txt / dat). ≤ 6 arguments each.

## Tests

- `node --test src/apps/khervetech/tests/logic.test.mjs` — geometry, mathtext, app table, slim toolbar, every
  AI action names a control / handler of `TGA_Analysis.py`.
- `KHERVEOS_PYODIDE=…/node_modules/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/engine.test.mjs` —
  in the real Pyodide 314.0.7: File › Import (its FileDialog replayed), the time view's three axes, the
  overview, the full window, red-line drags filling the Range boxes, Generate, a mass step (−12.3 %), DTG peaks
  at 175 / 485 / 745 °C, a DSC integration, undo / redo, save and reopen, cycles, the bare CSV, Edit › Sheet.
