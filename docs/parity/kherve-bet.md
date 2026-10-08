# KherveBET: parity with the desktop KherveFitting-AI on a BET (physisorption) sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50, v1.93). KherveBET is that app's BET /
physisorption technique as an app of its own: the main window as the desktop shows it on a BET sheet, with the
technique fixed. Shared base `src/apps/khervetech/` (CLAUDE.md, "Technique apps"); app `src/apps/khervebet/`.

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`,
copied by `tools/export_khervetech.py`): `FileMenu/BET_Import.py`, `FileMenu/Optical_Import.py` (its column
parser), `ToolsMenu/BET_Analysis.py` (engine and window), `ViewMenu/TechniqueOverview.py` (`_bet_spec`,
`_curve_family_spec`, `render_curve`), `TechniqueToolbar.py`, `ToolsMenu/TechniqueTool.py`,
`FileMenu/KFitting_IO.py`, and functions cut unchanged from `KFitting_Import.py` (`build_generic_sheet`),
`Plot_Operations.py`, `PlotConfig.py` and the others listed in khervetga.md. Its windows are drawn from their
own wx sizers, its plots from what they draw, so every label, default, message and number is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition (greyed or a message).

Sources read: `BET_Import.py`, `BET_Analysis.py`, `Optical_Import.py`, `KFitting_Import.build_generic_sheet`,
`TechniqueOverview._bet_spec`, `TechniqueToolbar.SECTIONS_BET / SECTION_HELP`, `TechniqueTool` (BET entry),
`Widgets_Toolbars.create_menu` (Import › BET, Tools › BET / Physisorption), `Plot_Operations.clear_and_replot`
(the optical branch: forward axis, a line, plain y), `PlotConfig.update_plot_limits`, `Sheet_Operations`.

Last checked: 2026-10-08.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "KherveBET" (registry, group Science, Dock / KApps icon drawn from `Tech-BET-3.png` at 256 px) | ✔ |
| File types: `.kfit` projects; isotherm `.csv/.txt/.dat` through "Open with" or File › Import | ✔ |
| A `.kfit` holding TGA sheets goes to KherveTGA (asked; automatic when the window was opened for it); KherveTGA hands BET projects here | ✔ |
| Examples copied to `~/Documents/KherveBET Examples` on first launch | ✔ synthetic: the desktop ships no isotherms (`make_bet_examples`: SBA-15 type IV with H1 hysteresis in a Micromeritics-style export, activated-carbon type I CSV, non-porous alumina in kPa with a P0 header) |
| Column choice by value (P/P0 within 0–1.05, quantity = last other column), absolute pressures through a quoted P0, adsorption / desorption branches split at the turning point (`BET_Branch`) | ✔ |
| Import writes the `.kfit` next to the file(s) (`_import_bet_paths` → `_open_as_kfit_project`), sheets BET, BET1, …; skipped files listed | ✔ |
| Every analysis persists the `.kfit`; results in `BET_Results` (JSON, lossless) | ✔ |
| `.xlsx` + `.json` projects | ✘ |

## 2. Main toolbar in the BET mode

As KherveTGA §2 (same slim toolbar: the XPS tools off, separators kept), with the BET technique button
(Tech-BET-3, TechniqueTool's BET help, opens "BET / Physisorption Analysis") and four section tiles BET, t,
BJH, Rep (SECTION_HELP tooltips, each opens "BET <Section>"). Open .kfit ◐, Quick Save ✔, Excel exports ✘,
Undo / Redo ✔, Sort ◐, Sample Manager ✘, sheet selector ✔, Refresh ◐, Delete / Rename ✔, Crop ✘,
Preferences ✘.

## 3. Vertical plot toolbar

As KherveTGA §3: zoom, drag, limits, green line, edge arrows, font size ✔; legend / Y-axis toggles ✔; the
fit toggles ◐ (nothing to show); Labels Manager ✘.

## 4. The plot

| Item | Web |
|---|---|
| Isotherm as a black line (BET is an "optical" sheet: never scatter), forward P/P0 axis, labels `BET_X_Label` / `BET_Y_Label` with mathtext (P/P$_0$, cm$^3$/g STP), plain y numbers | ✔ |
| Limits: Ymin = min − 1.5 % of max, Ymax = 1.2 × max (the default rule) | ✔ |
| Derived sheets BET~Plot (1/[Q(P0/P − 1)] vs P/P0), BET~tPlot (Q vs t, Å), BET~Pore (dV/dlog D vs D, nm) with their labels | ✔ |
| Legend "Raw Data" upper left | ✔ |
| The fitted lines `BET_Fit_X/Y` | ✔ in the companion only — the desktop does not draw them on the main plot either |
| No red range lines (the BET window does not use them) | ✔ |

## 5. Mouse and keyboard

As KherveTGA §5 except the range lines (none): cursor readout "BE: x eV, I: y CPS" ✔, double-click Plot
Limits ✔, right-click ◐, Ctrl+Z/Y/S/O/N/Q/K ✔, Ctrl+[ ] ✔, zoom / pan / intensity keys ✔, Tab / Q hint ✔,
Ctrl+P / B / M, F1–F4 ✘.

## 6. Menus

| Item | Web |
|---|---|
| File › Import › BET › Isotherm file(s) (.csv/.txt/.dat), Multiple files (folder) — the desktop functions, their own dialogs | ✔ (one file per file dialog; the folder entry imports them all) |
| Tools › BET / Physisorption › Full Window (all tabs), BET Surface Area, t-Plot, Pore Size (BJH), Report | ✔ |
| File / Edit / View / AI / Help | as KherveTGA §6 |

## 7. Right frame: the BET overview (TechniqueOverview `_bet_spec`, run unchanged)

| Item | Web |
|---|---|
| Notebook "BET" + "Sample Manager" | ✔ (Sample Manager ✘) |
| Companion choice: the other BET sheets (first one by default); "No preview available." without | ✔ |
| ↻ refresh, companion canvas (`render_curve`, the fit line overlaid in dark red), double-click selects that sheet | ✔ |
| Chips: every BET sheet, current green / bold | ✔ |
| Quick actions BET Surface Area, t-Plot, Pore Size (BJH) | ✔ |
| Info: sheet, points, P/P0 range, S(BET) and C, BJH peak pore | ✔ |

## 8. The BET / Physisorption Analysis window (BET_Analysis.BETAnalysisWindow, unchanged)

Full window (660 × 700, four tabs) or one section (540 × 640). Floating over the app; ✕ = EVT_CLOSE → on_close.

| Tab | Controls and actions (all ✔: the desktop's handlers) |
|---|---|
| BET Surface Area | Isotherm sheet combo (selects the sheet on the main plot); BET window (P/P0) From 0.050 / To 0.300 spins (0.005 steps, 3 digits); Fit BET; Create BET~Plot sheet (tooltip); Result: S(BET), Qm, C, R², points, window, C < 0 warning, Rouquerol limit, total pore volume (0.95) |
| t-Plot | Thickness window (Harkins-Jura t, Å) From 3.5 / To 5.0; Fit t-plot; Create BET~tPlot sheet; Result: external area, micropore volume, R², micropore area (S_BET − S_ext) |
| Pore Size (BJH) | Branch: Desorption (standard) / Adsorption; Run BJH; Create BET~Pore sheet; table D (nm), V inc, dV/dlogD, Cum. V |
| Report | Refresh report; the plain-text report (monospace, no wrap); Copy to clipboard |

| Behaviour | Web |
|---|---|
| Messages (show_popup_message2 balloon: "No BET line in that window…", "Run 'Fit BET' first.", …) | ✔ |
| Fits run on the measured isotherm behind a derived sheet (`BET_Source_Sheet`) | ✔ |
| Results reloaded when the sheet changes (load_sheet_into_ui) | ✔ |
| Copy to clipboard → the computer's clipboard | ✔ |

## 9. Not in this pass

Overview (F1), Sample Manager, Labels Manager, Preferences, Excel / KherveSheet / PDF export, Recent Files.

## 10. AI tools (src/os/ai/manifests/khervebet.ts, code src/apps/khervetech/aiTools.ts + src/apps/khervebet/actions.ts)

`khervebet_open_file`, `_open_example`, `_list_sheets`, `_select_sheet`, `_run` (bet with the P/P0 window,
tplot with the thickness window, bjh with the branch, report, bet_plot_sheet, tplot_sheet, pore_sheet — the
window's own spins / choice and the buttons' handlers), `_get_results` (BET_Results: bet, tplot, bjh,
rouquerol, v_total), `_export` (kfit / csv / txt / dat). ≤ 6 arguments each.

## Tests

- `node --test src/apps/khervetech/tests/logic.test.mjs` — every BET AI action names a control / handler of
  `BET_Analysis.py`; registry, icons, examples.
- `KHERVEOS_PYODIDE=…/node_modules/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/engine.test.mjs` —
  in the real Pyodide 314.0.7: import, the isotherm drawn as a line, the BET section window and its Fit BET
  button (S(BET) ≈ 694 m²/g for the SBA-15 example), t-plot, BJH, report, BET~Plot sheet, the overview's
  companion canvas, the CSV and kPa + P0 imports (alumina S(BET) ≈ 10 m²/g).
