# kAFM: parity with the desktop KherveFitting-AI on an AFM sheet

Reference: `../KherveFittingPro`, branch `origin/dev-AI` (ca1fe50). kAFM is that app's AFM / SPM technique as an app of its
own, in kTGA's design: the channels on the left, the scan in the middle, the AFM Analysis docked on the right
(`src/apps/khervetech/AnalysisApp.tsx`).

The desktop's code runs **unchanged** in the window's Pyodide worker (`public/apps/khervetech/py/desktop/`, copied by
`tools/export_khervetech.py`): `FileMenu/AFM_Import.py`, `ToolsMenu/AFM_Engine.py`, `AFM_Plot.py`, `AFM_Analysis.py`,
`ViewMenu/HeatmapColours.py` and the shared grain engine `SEM_Engine.py`. Engine entry: `py/ktech/techniques.py` →
`TECHS['AFM']` (`image_plot` = `AFM_Plot.plot_afm_image`).

✔ = as the desktop, ◐ = works with the difference stated, ✘ = not in the web edition yet.

## 1. App, files, examples

| Item | Web |
|---|---|
| Own app "kAFM" (registry group Materials) | ✔ |
| Files: `.gsf` / `.gwy` (Gwyddion), `.ibw` and `.ardf` (Asylum), `.spm` / `.00x` (Bruker Nanoscope), Velox `.emd`; `.kfit` projects | ✔ the desktop's readers; only `.gsf` is exercised by the examples |
| Examples in `~/Documents/kAFM Examples` (the desktop ships none): nanoparticles on silicon (2 µm), gold terraces with three 2.4 nm steps (5 µm), a rough polymer film (1 µm) | ✔ synthetic `.gsf` (`make_afm_examples`) |
| Every channel is a sheet (`AFM`, `AFM~Phase`…), plus `AFM~3D`; import writes `<file>.kfit` next to the file; a second import starts a fresh project and closes the old tool windows | ✔ |

## 2. The map

| Item | Web |
|---|---|
| Height map in the channel's colour map (the exact matplotlib tables, `shims/matplotlib/cmdata.py`), equal aspect, scale bar with its label, colour key outside the map with the unit and decimals chosen from the range | ✔ drawn from a PNG the engine makes (`AxesImage`) |
| Scan in µm above 2 µm, nm below; "uncalibrated" banner when the file has no size | ✔ |
| Toolbar zoom / pan / fit, PNG / SVG export | ✔ |
| Line drawing, edit, delete on the map with the mouse | ✔ the page forwards the mouse to the tools' matplotlib handlers (`mpl_connect`) |
| 3D surface (`AFM~3D` sheet and the 3D tab's view) | ✘ the sheet says it is not drawn yet; the tab's controls work |

## 3. Analysis window (AFMAnalysisWindow)

| Tab | Web |
|---|---|
| Channels: channel list, colour map, scan size for every channel, acquisition information | ✔ |
| Level: plane / polynomial background, align rows (median, median of differences, modus, matching, facet, polynomial, trimmed means), scars, zero reference, "Apply all three", reset; the stored data is never changed | ✔ |
| Regions: include / exclude rectangles, circles, freehand; crop | ◐ drawn with the mouse handlers; not exercised |
| Roughness: Sq, Sa, Ssk, Sku, Sp, Sv, Sz, Sdr and the hybrid quantities, by region | ✔ |
| Profile: lines with averaging width, Ra / Rq / Rz, step height (half vs half), the profile as a sheet, critical-dimension measurements | ✔ (needs the line drawn: mouse or the AI action) |
| Grains: threshold (Otsu / top-hat / manual) or watershed, size limits, count and distribution statistics, distribution fit, grain sheet | ✔ (scikit-image) |
| Force Curves | ◐ the tab opens; `.ardf` force maps not exercised |
| 3D | ◐ controls only |

## 4. AI tools

`kherveafm_open_file / open_example / list_sheets / select_sheet / get_results / export` plus `run` with the actions of
`src/apps/kherveafm/actions.ts`: `scan_size`, `colour_map`, `level`, `level_default`, `level_reset`, `roughness`,
`profile_line` (end points in image pixels), `profile_sheet`, `grains` (measures the watershed settings first), `grain_sheet`,
`grain_fit`, `build_3d`. App guide: `src/os/ai/guides/techniques.ts`.

## 5. Tests

`engine.test.mjs` (real Pyodide): import to `.kfit`, the image / scale bar / colour key, level and roughness (a staircase
leaves Sq = step/√12), a profile across the steps, grains. `logic.test.mjs`: the actions name the window's controls.

Last checked: 2026-10-10.
