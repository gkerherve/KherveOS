# kRaman: parity with the desktop KherveFitting-AI on a Raman sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kRaman is that app's Raman technique as an app of
its own, in kTGA's design: sheets and analyses on the left, the plot in the middle, the Raman Analysis docked on the
right (`src/apps/khervetech/AnalysisApp.tsx`, shared with kTGA, kDilatometer, kFTIR and kBET). Not the desktop's
main-window look: only the analysis is the desktop's.

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`, copied by
`tools/export_khervetech.py`): `FileMenu/Kal_Import.py`, `ToolsMenu/Raman_Analysis.py`, `Raman_Assign.py`,
`Raman_Library.py`, and the shared `TechniqueTool`, `KFitting_IO`, `Plot_Operations`, `Labels_Screen`. Engine entry:
`py/ktech/techniques.py` → `TECHS['RAMAN']`. So every label, default, message and number below is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kRaman" (registry group Materials, Dock icon drawn by `tools/make_technique_icons.py`) | ✔ |
| File types: `.kfit` projects; Raman `.txt` (shift, intensity; `#` comment lines skipped) through File › Import / Open… | ✔ |
| A `.kfit` holding another technique's sheets goes to that app (asked; automatic when opened for it) | ✔ |
| Examples copied to `~/Documents/kRaman Examples` on first launch: anatase TiO₂ (synthetic) | ✔ |
| Sheets are named `Raman_<file>` (the desktop's rule) | ✔ |
| Import writes `<file>.kfit` next to the file. The desktop writes a workbook and asks "Choose Project Format"; the web edition answers it in advance (`'project_format': 'kfitting'`) | ◐ always `.kfit` |
| `.xlsx` / `.json` projects | ✘ |

## 2. The window

| Item | Web |
|---|---|
| Sheets on the left, analyses (Peaks & Assignment, Band Library) open that tab of the docked window | ✔ |
| Toolbar: Open, Import, Examples, Save, Export (CSV / SVG / PNG / .kfit), Undo / Redo | ✔ |
| Plot: Raman shift axis low → high, "Intensity (a.u.)" with ×10ⁿ, zoom box, pan, fit, PNG / SVG export, cursor read-out | ✔ drawn in SVG from the recorded figure |
| The raw spectrum is drawn as a **line**. The desktop draws every non-"optical" sheet as dots (its plot style is a preference the web edition has no control for) and a Raman spectrum reads better as a line (`'raw_as_line'`) | ◐ |

## 3. Analysis window (RamanAnalysisWindow)

| Tab / control | Web |
|---|---|
| Peaks & Assignment: sheet, sample metadata (material, substrate, elements, laser nm, in air) | ✔ |
| Find peaks, Use fitted peaks, Re-assign, Label plot, Clear labels; the peaks grid (shift, height %, FWHM, confidence, assignment); candidates for the selected peak with Accept selected candidate | ✔ |
| Band Library: the Raman band table with search | ✔ |
| Results stored per sheet (`Raman_Peaks`, `Raman_Meta`) | ✔ |

## 4. AI tools

`kherveraman_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions
of `src/apps/kherveraman/actions.ts`: `metadata`, `find_peaks`, `use_fitted`, `reassign`, `label_plot`,
`clear_labels`, `band_library`.

## 5. Tests

`src/apps/khervetech/tests/engine.test.mjs` (real Pyodide): import to `.kfit` without a question, the spectrum drawn as
a line, peak detection (anatase Eg at 144 cm⁻¹), labels drawn and cleared. `logic.test.mjs`: the actions name the
window's own controls and handlers.

Last checked: 2026-10-09.
