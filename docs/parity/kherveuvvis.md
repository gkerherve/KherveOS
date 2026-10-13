# kUVVis: parity with the desktop KherveFitting-AI on a UV-Vis sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kUVVis is that app's UV-Vis technique as an app of
its own, in kTGA's design: sheets and analyses on the left, the spectrum in the middle, the UV-Vis Analysis docked on
the right (`src/apps/khervetech/AnalysisApp.tsx`, shared with kTGA, kDilatometer, kFTIR, kBET and kRaman). Not the
desktop's main-window look: only the analysis is the desktop's.

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`, copied by
`tools/export_khervetech.py`): `FileMenu/Optical_Import.py`, `ToolsMenu/UVVIS_Analysis.py`, `UVVIS_Plot.py`, and the
shared `TechniqueTool`, `KFitting_IO`, `Plot_Operations`, `Labels_Screen`. Engine entry: `py/ktech/techniques.py` →
`TECHS['UVVIS']`. So every label, default, message and number below is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kUVVis" (registry group Materials, Dock icon drawn by `tools/make_technique_icons.py`) | ✔ |
| File types: `.kfit` projects; `.csv` / `.txt` / `.dat` / `.asc` (Cary, Shimadzu, generic wavelength + ordinate) through File › Import / Open… | ✔ |
| Examples copied to `~/Documents/kUVVis Examples` on first launch: anatase TiO₂ absorbance, a Cary batch of two samples | ✔ synthetic |
| Sheets UVvis, UVvis1, … and `UVvis~Tauc` | ✔ |
| Import writes `<file>.kfit` next to the file | ✔ |
| `.xlsx` / `.json` projects | ✘ |

## 2. The window

| Item | Web |
|---|---|
| Sheets on the left (Spectrum, Tauc plot); the analyses (Data & Ordinate, Band Gap (Tauc), Band Maxima) open that tab of the docked window | ✔ |
| Toolbar: Open, Import, Examples, Save, Export (CSV / SVG / PNG / .kfit), Undo / Redo | ✔ |
| Plot: wavelength axis, ordinate from the sheet, zoom box, pan, fit, PNG / SVG export, cursor read-out | ✔ drawn in SVG from the recorded figure |

## 3. Analysis window (UVVISAnalysisWindow)

| Tab / control | Web |
|---|---|
| Data & Ordinate: sheet, what the data are (absorbance / transmittance % / reflectance %), "Create absorbance sheet" (−log₁₀ T, or Kubelka-Munk F(R)), sheet summary | ✔ |
| Band Gap (Tauc): transition (direct / indirect, allowed / forbidden), Create `UVvis~Tauc` sheet (nm → eV), Suggest window (steepest edge), Fit band gap (Eg, R², points), Insert Tauc inset / Remove inset | ✔ |
| Band Maxima: absorption maxima (nm, eV, value, prominence) | ✔ |

## 4. AI tools

`kherveuvvis_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions of
`src/apps/kherveuvvis/actions.ts`: `absorbance`, `tauc_sheet`, `suggest_window`, `fit_band_gap`, `insert_inset`,
`remove_inset`, `band_maxima`.

## 5. Tests

`src/apps/khervetech/tests/engine.test.mjs` (real Pyodide): import to `.kfit` without a question, the Tauc sheet, the
anatase band gap (Eg ≈ 3.2 eV), the inset on and off, band maxima. `logic.test.mjs`: the actions name the window's own
controls and handlers.

Last checked: 2026-10-09.
