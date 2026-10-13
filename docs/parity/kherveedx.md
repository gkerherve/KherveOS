# kEDX: parity with the desktop KherveFitting-AI on an EDX map

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kEDX is that app's SEM-EDX technique as an app of its own:
the sum spectrum with its elements on the plot (what the desktop's main window shows), the **EDX HeatMap** window docked on
the right (its toolbar and the intensity map, as the desktop shows them).

The desktop's code runs **unchanged**: `ToolsMenu/EDX_SEM_Analysis.py` (the window, 7,700 lines), `EDX_Utilities.py`,
`BCF_Reader.py`, `EMD_Reader.py`, `ThemeColours.py`, and `Plot_Operations.PlotManager.plot_edx_data` /
`apply_edx_plot_style` / `plot_profile` for the spectrum on the main plot. Engine entry: `TECHS['EDX']`
(`sheet_plot` for `EDX~` sheets; `ktech/openers.py` opens the window and builds the sheets as `import_edx_map_file` does).

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition yet.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kEDX" (registry group Materials) | ✔ |
| Files: HDF5 (`.hdf5` / `.h5`), Bruker `.bcf`, Velox `.emd`; `.kfit` | ✔ HDF5 exercised; BCF / EMD readers are the desktop's, not exercised |
| Example in `~/Documents/kEDX Examples` (the desktop ships none): a synthetic steel (Fe, Cr, Ni) with Cr-rich carbides and Si-O inclusions, 48 × 48 pixels, 0–10 keV | ✔ (`make_edx_examples`) |
| Sheets `EDX~Plot` (sum spectrum), `EDX~Map`, `EDX~Plot1…` (saved selections); the raw file is copied to `<name>_EDX.<ext>` and the project is `<name>_EDX.kfit` (the desktop writes a workbook) | ◐ `.kfit` instead of `.xlsx` + `.json` |

## 2. The window and the plot

| Item | Web |
|---|---|
| Sum spectrum with peak labels (element and line), the desktop's detection and identification, plot styles | ✔ |
| EDX HeatMap window: toolbar (zoom, pan, point / area / line selection, clear, element maps, intensity map, set elements, settings), map with scale bar and colour key | ✔ the tool buttons are drawn from the desktop's own icon code |
| Point, area and line selection with the mouse on the map; the spectrum goes to the main plot | ✔ the page forwards the mouse to the window's handlers (`mpl_connect`); area uses `RectangleSelector` |
| Element maps (RGB composite), periodic table for the elements | ✔ the periodic table is a dialog |
| Quantification window and settings | ◐ results are shown by the desktop's dialog; the AI action returns them as data |
| Data browser, info window, exports (Excel, CSV, HDF5, image) | ◐ the windows open; file exports not exercised |

## 3. AI tools

`kherveedx_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions of
`src/apps/kherveedx/actions.ts` (they call `ktech/edx_tools.py`): `select` (point, area or line in map pixels; `save` makes it
a sheet), `element_maps`, `quantify`, `peaks`. App guide: `src/os/ai/guides/techniques.ts`.

## 4. Tests

`engine.test.mjs` (real Pyodide): import (sheets, `.kfit`, raw copy), the labelled spectrum (Fe, Cr, Ni Kα), the window's map image,
an area on a carbide (Cr Kα strongest, saved as `EDX~Plot1`), quantification (Fe the main element, 100 % total), element maps.

Last checked: 2026-10-10.
