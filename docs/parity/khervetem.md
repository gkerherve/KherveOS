# kTEM: parity with the desktop KherveFitting-AI on a TEM sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kTEM is that app's TEM technique as an app of its own, in
kTGA's design: sheets on the left, the micrograph in the middle, the TEM Analysis docked on the right.

The desktop's code runs **unchanged** in the worker: `FileMenu/TEM_Import.py`, `EELS_Utilities.py` (the DM3 / DM4 / DM5
readers), `ToolsMenu/TEM_Engine.py`, `TEM_Plot.py`, `TEM_Filter.py`, `TEM_Denoise.py`, `TEM_DenoisePlots.py`,
`TEM_Analysis.py`, `SEM_Engine.py`, `SEM_Sheets.py`. Engine entry: `TECHS['TEM']` (`image_plot` = `TEM_Plot.plot_tem_image`).

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition yet.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kTEM" (registry group Materials) | ✔ |
| Files: Gatan `.dm3` / `.dm4` / `.dm5` (with their pixel size), `.tif` / `.tiff` / `.png` (uncalibrated); `.kfit` | ✔ (examples are PNG) |
| Examples in `~/Documents/kTEM Examples` (the desktop ships none): gold nanoparticles on carbon (bright field), gold lattice fringes (0.235 / 0.204 nm at 0.0235 nm per pixel) | ✔ synthetic PNG (`make_tem_examples`) |
| Sheet `TEM~Map`; derived `TEM~FFT`, `TEM~Plot`, `TEM~Count` / `TEM~Freq`, filtered and denoised images; import writes `<file>.kfit` next to the file | ✔ |

## 2. The micrograph

| Item | Web |
|---|---|
| Grey-scale image, equal aspect, scale bar on a dark backing, "uncalibrated" banner and the desktop's calibration notice | ✔ |
| Brightness / contrast, auto contrast | ✔ |
| Region, line and mask drawing with the mouse | ✔ the page forwards the mouse to the tools' matplotlib handlers |

## 3. Analysis window (TEMAnalysisWindow)

| Tab | Web |
|---|---|
| Calibrate: pixel size, brightness / contrast, acquisition metadata | ✔ |
| Particles: polarity, Otsu / top-hat / manual / blobs, sensitivity, size limits, fill holes, edge, split; results table, size distribution sheets, copy | ✔ |
| Profile: line with width, fringe peaks and mean spacing, profile sheet | ✔ |
| FFT: region (mouse, rotatable rectangle), FFT sheet with reciprocal scale | ✔ AI action gives the region in pixels |
| Measure: spot detection and d-spacing families, measure spot / angle, lattice indexing, identify, labels, inset | ✔ detection and families; dialogs through the page's dialogs |
| Filter: Bragg masks on the FFT, inverse FFT, local maps, GPA | ◐ mask regions are placed with the mouse; not exercised |
| Advanced | ◐ not exercised |
| Denoise: line-wise and patch-based PCA, component estimate | ✔ (the estimate's two plots open as a window) |

## 4. AI tools

`khervetem_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions of
`src/apps/khervetem/actions.ts`: `calibrate`, `particles`, `particle_sheet`, `profile_line` (image pixels), `fringe_spacing`,
`fft` (region in pixels, default the whole image), `fft_spots`, `denoise`. App guide: `src/os/ai/guides/techniques.ts`.

## 5. Tests

`engine.test.mjs` (real Pyodide): import, the "uncalibrated" banner, calibration, fringe spacing (0.235 nm), FFT d-spacings
(0.2346 / 0.2041 nm), nanoparticle detection. `logic.test.mjs`: the actions name the windows' controls.

Last checked: 2026-10-10.
