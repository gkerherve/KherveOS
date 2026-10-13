# kDilatometer: parity with the desktop KherveFitting-AI on a DIL sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kDilatometer is that app's dilatometry
technique as an app of its own, in kTGA's design: sheets and analyses on the left, the plot in the middle,
the Dilatometry Analysis docked on the right (`src/apps/khervetech/AnalysisApp.tsx`, shared with kTGA).
Not the desktop's main-window look: only the analysis is the desktop's.

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`,
copied by `tools/export_khervetech.py`): `FileMenu/DIL_Import.py` (with `TGA_Import.py`, whose NETZSCH CSV parser
it reuses), `ToolsMenu/DIL_Analysis.py`, and the shared `TechniqueOverview` / `TechniqueToolbar` / `TechniqueTool`,
`KFitting_IO`, `Plot_Operations` (DIL axes) and `Labels_Screen` (the sintering labels). Engine entry:
`py/ktech/techniques.py` → `TECHS['DIL']`. So every label, default, message and number below is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kDilatometer" (registry group Materials, Dock icon drawn by `tools/make_technique_icons.py`) | ✔ |
| File types: `.kfit` projects open in it; raw `.csv/.txt/.dat` through File › Import / Open… | ✔ |
| A `.kfit` holding another technique's sheets goes to that app (asked; automatic when opened for it) | ✔ |
| Examples copied to `~/Documents/kDilatometer Examples` on first launch | ✔ synthetic, the desktop ships no dilatometry data (`make_dil_examples`): alumina bar heat / dwell / cool (NETZSCH DIL 402), zirconia compact sintering to 1450 °C, steel ferrite→austenite with dL in µm + sample length (Linseis-style TXT), bare T / dL/L0 glass CSV |
| Import writes `DIL_Data.kfit` (or `<file>.kfit`) next to the file and opens it (`_import_dil_paths`) | ✔ |
| Every analysis step persists the `.kfit` (`persist_project`); `DIL_` arrays are lossless (dL/L0 ~ 1e-5) | ✔ |
| `.xlsx` / `.json` projects | ✘ |

## 2. Import (DIL_Import.parse_dil_file)

| Item | Web |
|---|---|
| NETZSCH `#KEY:,value` block + `##Temp./°C,Time/min,dL/Lo,Segment` table, any delimiter / decimal / cp1252 header | ✔ |
| Bare two-column temperature, dL/L0 | ✔ |
| dL/L0, % (÷100), dL in µm or mm (÷ sample length when the header has one; else the sheet stays in µm and the CTE refuses) | ✔ |
| Sheets DIL, DIL1, DIL2… (one per file); `Segment` and `Time` columns kept row for row | ✔ |

## 3. Analysis window (DILAnalysisWindow, drawn from its own wx sizers)

| Tab / control | Web |
|---|---|
| Data & Segments: sheet combo, sheet summary, programme-segment table (S1…: heating / cooling / isothermal), Sheet from selected segment, Sheets from all segments → `DIL~Heat` / `DIL~Cool` / `DIL~Iso` | ✔ |
| Segments from the instrument's Segment column, else from temperature reversals (> 2 % of the span, ≥ 5 °C) | ✔ |
| Expansion (CTE): T1 / T2 preset to the middle half of the range, mean (technical) CTE with ε(T1) → ε(T2), differential α(T) (Savitzky-Golay, chain rule, window box) → `DIL~Alpha` in 10⁻⁶ K⁻¹ | ✔ |
| Sintering: onset threshold (% dL/L0 below the maximum), report (max expansion, shrinkage onset, max shrinkage rate, final, total), Label plot (max / onset / max rate), Clear labels, Copy to clipboard | ✔ |
| Results stored per sheet in `DIL_Results` (JSON), shown in the sheet info lines | ✔ |
| The desktop's section tiles / one-tab windows (`open_dil_section`) | ◐ the analysis list on the left opens that tab of the docked window |
| Undo: the desktop pushes a step only for the label buttons and the sheet selection, not for the sheet writers | ✔ as the desktop |

## 4. The plot

| Item | Web |
|---|---|
| Forward temperature axis, dL/L0 ordinate, labels from `DIL_X_Label` / `DIL_Y_Label` per sheet, plain y numbers with ×10ⁿ | ✔ drawn in SVG from the recorded figure |
| A heat / cool run draws the loop (never sorted by T) | ✔ |
| Zoom box, pan, fit, export PNG / SVG, cursor read-out (T, y) | ✔ (kTGA's toolbar) |

## 5. AI tools

`khervedilatometer_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the
actions of `src/apps/khervedilatometer/actions.ts`: `segments`, `segment_sheet`, `all_segment_sheets`, `mean_cte`,
`alpha`, `sintering`, `label_plot`, `clear_labels` (the window's own controls and handlers; a test checks that
every name exists in `DIL_Analysis.py`). `get_results` returns `DIL_Results` with six significant digits.

## 6. Tests

- `node --test src/apps/khervetech/tests/logic.test.mjs` (app table, action names)
- `KHERVEOS_PYODIDE=public/pyodide/v314.0.7/full/pyodide.mjs node --test src/apps/khervetech/tests/engine.test.mjs`
  (import of the four example formats, segments, CTE 7.93×10⁻⁶ K⁻¹ for the alumina bar, α(T) 6.5 → 9.5, sintering
  onset / max rate / shrinkage of the zirconia compact, the steel contraction near 740 °C, labels, save + reopen)

Browser test list (checked 2026-10-09 in the dev server): open kDilatometer → example Zirconia → S1 → Sheet from
selected segment (DIL~Heat appears, plot shows the shrinkage) → Sintering tab → Analyse sintering (onset 945 °C,
max rate at 1255 °C, −18.7 %). Still to do by hand: Import › File… with a real instrument file, Label plot on the
plot, Expansion tab buttons, drag a file from Files onto the window, Examples menu, light and other themes.
