# kFTIR: parity with the desktop KherveFitting-AI on an FTIR sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kFTIR is that app's FTIR technique as an app of its
own, in kTGA's design: sheets and analyses on the left, the plot in the middle, the FTIR Analysis docked on the right
(`src/apps/khervetech/AnalysisApp.tsx`, shared with kTGA and kDilatometer). Not the desktop's main-window look: only the
analysis is the desktop's.

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`, copied by
`tools/export_khervetech.py`): `FileMenu/FTIR_Import.py`, `JCAMP_Import.py`, `NicoletLibrary_Import.py`,
`ToolsMenu/FTIR_Analysis.py`, `FTIR_Engine.py`, `FTIR_Assign.py`, `FTIR_Library.py`, the reference spectra of
`FTIR Library/*.jdx`, and the shared `TechniqueTool`, `KFitting_IO`, `Plot_Operations`, `Labels_Screen`. Engine entry:
`py/ktech/techniques.py` → `TECHS['FTIR']`. So every label, default, message and number below is the desktop's.

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition, ? = not checked yet.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kFTIR" (registry group Materials, Dock icon drawn by `tools/make_technique_icons.py`) | ✔ |
| File types: `.kfit` projects open in it; `.jdx` / `.dx`, `.txt` / `.csv` / `.dat`, Nicolet `.lbd` through File › Import / Open… | ✔ |
| A `.kfit` holding another technique's sheets goes to that app (asked; automatic when opened for it) | ✔ |
| Examples copied to `~/Documents/kFTIR Examples` on first launch: polystyrene, PMMA, ethanol, calcite (the desktop's synthetic JCAMP-DX references) | ✔ |
| Import writes `<file>.kfit` next to the file and opens it. The desktop writes a workbook and asks "Choose Project Format"; the web edition answers it in advance (`TECHS['FTIR']['project_format']`) | ◐ always `.kfit` |
| `.xlsx` / `.json` projects | ✘ |

## 2. The window

| Item | Web |
|---|---|
| Sheets listed on the left with what each is (engine note: "Measured, Transmittance (%)" / "Reference: PMMA…") | ✔ web addition |
| Analyses list opens that tab of the docked window | ✔ |
| Plot: wavenumber axis reversed, ordinate from the sheet's display unit, zoom box, pan, fit, PNG / SVG export, cursor read-out | ✔ drawn in SVG from the recorded figure |
| Wx widgets (grids, list boxes, group boxes, `&&` labels, scrolled tabs) drawn on the OS theme; grid cells the desktop paints stay readable in every theme | ✔ |

## 3. Analysis window (FTIRAnalysisWindow)

| Tab / control | Web |
|---|---|
| Data & Metadata: sheet, input and display ordinate unit, Auto-detect, unit note and warnings, measurement metadata | ✔ |
| Processing: Auto Clean (Gentle / Standard / Strong), Reset to raw, per-step toggles, Advanced settings, overlays, processing history; non-destructive | ✔ |
| Bands: method, prominence, minimum distance / tolerance, Find Bands, Re-assign, ranked candidates, accept and lock, Label Bands on Plot, Clear FTIR Labels | ✔ |
| Band Library: the IR correlation table with search | ✔ |
| Reference Spectra: the shipped `.jdx` library → Add to Project (a new FTIRn sheet of the open project) | ✔ |
| Reference Spectra: online (GitHub) library, NIST WebBook, Nicolet / OMNIC folders | ? needs network / a folder of the user's own libraries; not checked |
| Undo | ✔ as the desktop |

## 4. AI tools

`kherveftir_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions of
`src/apps/kherveftir/actions.ts`: `detect_unit`, `input_unit`, `display_unit`, `auto_clean`, `reset`, `find_bands`,
`reassign`, `label_bands`, `clear_labels`, `band_library`, `add_reference`.

## 5. Tests

`src/apps/khervetech/tests/engine.test.mjs` (real Pyodide): JCAMP-DX import to `.kfit` without a question, sheet notes,
Standard auto clean, band detection (polystyrene 1602 cm⁻¹), labels, adding a reference. `logic.test.mjs`: the actions
name the window's own controls and handlers.

Last checked: 2026-10-09.
