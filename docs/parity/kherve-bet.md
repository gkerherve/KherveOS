# KherveBET: parity with the desktop KherveFitting-AI on a BET (physisorption) sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50, v1.93). kBET is that app's BET /
physisorption technique as an app of its own, in kTGA's design: sheets and analyses on the left, the isotherm
in the middle, the BET / Physisorption Analysis docked on the right (`src/apps/khervetech/AnalysisApp.tsx`,
shared with kTGA, kDilatometer, kFTIR and kRaman). Not the desktop's main-window look (toolbars, overview
frame, Sample Manager): only the analysis is the desktop's. App `src/apps/khervebet/`.

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

Last checked: 2026-10-09.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kBET" (registry group Materials, Dock icon drawn by `tools/make_technique_icons.py`) | ✔ |
| File types: `.kfit` projects; isotherm `.csv/.txt/.dat` through "Open with" or File › Import | ✔ |
| A `.kfit` holding TGA sheets goes to KherveTGA (asked; automatic when the window was opened for it); KherveTGA hands BET projects here | ✔ |
| Examples copied to `~/Documents/KherveBET Examples` on first launch | ✔ synthetic: the desktop ships no isotherms (`make_bet_examples`: SBA-15 type IV with H1 hysteresis in a Micromeritics-style export, activated-carbon type I CSV, non-porous alumina in kPa with a P0 header) |
| Column choice by value (P/P0 within 0–1.05, quantity = last other column), absolute pressures through a quoted P0, adsorption / desorption branches split at the turning point (`BET_Branch`) | ✔ |
| Import writes the `.kfit` next to the file(s) (`_import_bet_paths` → `_open_as_kfit_project`), sheets BET, BET1, …; skipped files listed | ✔ |
| Every analysis persists the `.kfit`; results in `BET_Results` (JSON, lossless) | ✔ |
| `.xlsx` + `.json` projects | ✘ |

## 2. The window

| Item | Web |
|---|---|
| Sheets on the left, each with what it is: Isotherm, BET transform (`BET~Plot`), t-plot (`BET~tPlot`), Pore-size distribution (`BET~Pore`); derived sheets are indented | ✔ web addition |
| The analyses (BET Surface Area, t-Plot, Pore Size (BJH), Report) listed on the left open that tab of the docked window | ✔ |
| Toolbar: Open, Import (the desktop's entries), Examples, Save, Export (CSV / SVG / PNG / .kfit), Undo / Redo | ✔ |
| Plot: zoom box, pan, fit, PNG / SVG export, cursor read-out; the left axis keeps room for long tick numbers (BET~Plot: 0.0005) | ✔ |
| The desktop's vertical plot toolbar, Sample Manager, overview frame, Labels Manager, Preferences, Excel / PDF export, Recent Files | ✘ |

## 3. The plot

| Item | Web |
|---|---|
| Isotherm as a black line (BET is an "optical" sheet: never scatter), forward P/P0 axis, labels `BET_X_Label` / `BET_Y_Label` with mathtext (P/P$_0$, cm$^3$/g STP), plain y numbers | ✔ |
| Limits: Ymin = min − 1.5 % of max, Ymax = 1.2 × max (the default rule) | ✔ |
| Derived sheets BET~Plot (1/[Q(P0/P − 1)] vs P/P0), BET~tPlot (Q vs t, Å), BET~Pore (dV/dlog D vs D, nm) with their labels | ✔ |
| Legend "Raw Data" upper left | ✔ |
| The fitted lines `BET_Fit_X/Y` | ✔ in the companion only — the desktop does not draw them on the main plot either |
| No red range lines (the BET window does not use them) | ✔ |

## 4. The BET / Physisorption Analysis window (BET_Analysis.BETAnalysisWindow, unchanged)

Docked on the right with its four tabs.

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

## 5. AI tools (src/os/ai/manifests/khervebet.ts, code src/apps/khervetech/aiTools.ts + src/apps/khervebet/actions.ts)

`khervebet_open_file`, `_open_example`, `_list_sheets`, `_select_sheet`, `_run` (bet with the P/P0 window,
tplot with the thickness window, bjh with the branch, report, bet_plot_sheet, tplot_sheet, pore_sheet — the
window's own spins / choice and the buttons' handlers), `_get_results` (BET_Results: bet, tplot, bjh,
rouquerol, v_total), `_export` (kfit / csv / txt / dat). ≤ 6 arguments each.

## Tests

- `node --test src/apps/khervetech/tests/logic.test.mjs` — every BET AI action names a control / handler of
  `BET_Analysis.py`; registry, icons, examples.
- `KHERVEOS_PYODIDE=…/node_modules/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/engine.test.mjs` —
  in the real Pyodide 314.0.7: import, the isotherm drawn as a line, the BET window and its Fit BET
  button (S(BET) ≈ 694 m²/g for the SBA-15 example), t-plot, BJH, report, BET~Plot sheet, the CSV and kPa + P0 imports (alumina S(BET) ≈ 10 m²/g).
