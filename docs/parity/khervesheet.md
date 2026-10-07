# KherveSheet — parity with the desktop app

Reference: `../KherveSheet` branch `origin/dev` (mainwindow.py, sheet.py, workbook.py,
python_engine.py, graph.py, insert_ops.py, science.py, table_styles.py, icons.py, app.py)
and `../khervefitting-web/public/screenshots/tools/khervesheet/`.
Web edition: `src/apps/khervesheet/`. Pass of 2026-10-07.

✔ same as the desktop · ~ partly / differently · ✘ missing

## Look

| | Item | Notes |
|---|---|---|
| ✔ | Toolbar icons | The desktop's own icons, rendered from `icons.py` by the desktop code (`tools/render_khervesheet_icons.py` → `public/apps/khervesheet/icons/{light,dark}`), 32 px |
| ✔ | Light theme | View ▸ Theme ▸ Light (Emerald) = Settings › Appearance light for KherveSheet; the light icon set is the desktop's default Emerald look |
| ~ | Dark theme | KherveOS's Kherve Green (the desktop has no such theme; its "Dark" is blue-grey) |
| ✔ | Toolbars side by side, flat buttons, wrap when narrow | the desktop shows a » overflow instead of wrapping |
| ✔ | Formula bar `Cell: [A1] fx [formula]` + 4 px grip (drag to resize, double-click: one line) | the cell box is editable on the web (Name Box: type B12 / A1:C5 / Sheet2!A1) — web extra |
| ✔ | Sheet tabs at the bottom: ◀ ▶ + ∨, closable tabs (×, asks "Delete 'Sheet1'?"), selected tab bold with accent border | |
| ✘ | "Layout" tab (publication layout, plot_layout.py) | not ported |
| ✔ | Status bar: "Ready" / messages · Average Count Sum · − [zoom slider] 100% + | zoom 25–200 % (desktop 1–200 %) |
| ✔ | =PY cell look: faint Python-blue tint + two-tone raised "PY" badge down the right edge (paint_py_badge), loop period on the badge | |
| ~ | Grid colours | theme colours (white grid in Light); desktop cell fills are kept in the file |

## Menus

| | Menu | Items |
|---|---|---|
| ✔ | File | New, New Window, Open…, Recent Files ▸, Open File Location (Files app), Save, Save As…, Import ▸ Text/CSV…, Excel…, Export ▸ CSV…, Excel…, Print… (browser print of the used range / selection), Exit |
| ✘ | File ▸ Version Control ▸ (History, Push, Pull, Configure Remote), Live Sharing | shown disabled / not present |
| ✔ | Edit | Undo, Redo, Cut, Copy, Paste, Paste Values Only, Clear, Preferences… (opens KherveOS Settings) |
| + | Edit (web extras) | Find…, Replace…, Fill Down, Fill Right, Select All |
| ✔ | View | Normal, Gridlines, Headings, Zoom In/Out (±10 %), Reset Zoom, Theme ▸ |
| ✘ | View ▸ Page Layout | disabled |
| + | View (web extras) | Formulas (Ctrl+\`), Freeze Panes ▸ |
| ✔ | Insert | Row Above, Row Below, Column, Sheet, Chart ▸ (13 types with icons), Image…, Equation ▸ (9 presets + Insert New Equation…), Sparkline ▸ (from Selection…, Single…, Remove), Function ▸, Python Cell, Link (Ctrl+K), Comment (Ctrl+Alt+M), Note (Shift+F2), Checkbox, Dropdown…, Pivot / Transpose |
| ✘ | Insert ▸ Shapes, Chart ▸ From Template…, Button… | disabled |
| ✔ | Format | Format Cells… (Ctrl+1), Number Format ▸ (desktop's 12), Fill Color…, Font Color…, Borders ▸ (desktop's 13 presets with icons), Column Width…, Row Height…, Merge, Unmerge, Wrap Text, Table Design (99 styles, Header Row / Banded Rows), Bring Forward, Send Backward |
| ✔ | Formulas | AutoSum (Alt+Shift+=), categories ▸ functions, Insert Function… (Shift+F3) |
| ✔ | Data | Sort A→Z, Sort Z→A, Set Column As ▸ X / Y |
| + | Data (web extras) | Sort…, Filter, Calculate Now (F9), Run Python Cells, Python Loops |
| ~ | Science | all 17 items; Normalisation, Integration, Derivative, Smooth, FFT, Interpolation, Find Peaks work (desktop dialog + its `_compute` code in Python); ✘ the 10 "wave 2" tools (Baseline Subtraction … Deconvolution) say "not in the web edition yet" |
| ~ | Tools | Statistics on Selection ✔, Solver… ✔, Curve Fitting… → the trendline fit of the selected chart (✘ the desktop's lmfit peak-fitting dialog), Spelling / Check Spelling ✘ (disabled) |
| ~ | AI | Connect to Claude… and ChatBox open KherveAI (KherveOS has its own MCP server) |
| ✔ | Examples | Worked Examples, Python Examples, Exercises, Templates (exported from the desktop) |
| ✔ | Help | User Guide, Python in KherveSheet (the desktop's help text), About, GitHub Repository; Check for Updates disabled |

## Toolbars

| | Button | Notes |
|---|---|---|
| ✔ | New, Open, Save, Print | |
| ✔ | Undo, Redo | disabled when nothing to undo |
| ✔ | Solver | |
| ~ | Curve Fitting | trendline of the selected chart |
| ~ | Science ▾ | menu as the desktop; 7 of 17 tools |
| ~ | AI chat | opens KherveAI (the desktop docks a chat) |
| ✔ | Font, size (9 by default), Bold, Italic, Underline, Align Left / Center / Right (checked state follows the cell) | font list is the web's |
| ✔ | Fill Color, Font Color (split buttons, last colour on the bar, palette) | |
| ✔ | Borders ▾ (presets with the desktop icons), Merge / Unmerge | |
| ✔ | Insert Chart (split: last type's icon, 13 types with their icons) | |
| ✔ | Table Design ▾ (gallery of 99 styles) | |
| ✔ | Insert Image | |
| ✘ | Insert Shape ▾ | menu says not ported |
| ✔ | Insert Sparklines (split) | target row asked with a prompt (desktop dialog has type + colour too) |
| ✔ | Insert Equation ▾ (presets, new) | presets listed by name (desktop shows rendered previews) |
| ✔ | Insert Symbol ▾ (Greek, maths, arrows grid) | |
| ✔ | Insert ▾: Checkbox, Dropdown…, Emoji (picker), Comment, Note | ✘ Button… |

## Formula bar and Python

| | Item | Notes |
|---|---|---|
| ✔ | Typing "=" (or text starting "=") moves the entry to the formula bar (`_redirect_to_formula_bar`); values are typed in the cell | |
| ✔ | Enter applies, Alt+Enter new line, Esc cancels, Tab / Shift+Tab | |
| ✔ | Arrows point at cells while the formula expects a reference; click / drag on the grid inserts a reference | |
| ✔ | F4 cycles A1 → $A$1 → A$1 → $A1 | new |
| ✔ | Function autocomplete + syntax help | |
| ✔ | fx button / Shift+F3: Insert Function dialog (search + Go, category incl. Most Recently Used, list, syntax, description, OK → `=NAME()`) | new |
| ✔ | Python mode: a =PY cell, or a bare "=PY" + Enter, or Insert ▸ Python Cell; "=PY 1+1" + Enter runs at once | |
| ✔ | Python mode look: monospace, desktop highlighter colours (keywords bold blue, numbers green, strings red, comments grey italic), blue tint, 72–96 px high | |
| ✔ | Python mode keys: Enter new line, Ctrl+Enter (⌘Enter) runs, Tab indents | |
| ✔ | PY badge strip on the right; loop period button (presets 0.1 s…15 min + Custom…), Play / Stop, pop-out button | |
| ✔ | **Pop-out Python editor** (PythonCellDialog): non-modal window "Python — A1", drag, resize, **maximise** (button or double-click the title) | |
| ✔ | its toolbar: Run (Ctrl+Enter), ks(), Pick (click a grid cell → `ks("B2")`), Snippets ▾ (the desktop's 11), Comment (Ctrl+/), Period, Play/Stop, Help | |
| ✔ | its editor: line numbers, current line, error line in red after a failed run, Tab / Shift+Tab (in)dent, Ctrl+/ comments, Ctrl+Space and typing autocomplete (keywords, hints, the workbook's Python names, words in the code) | |
| ✔ | hint line, output pane ("Output appears here after you Run.", printed output, "Result: …", "→ plot embedded in the grid", traceback in red), Close | |
| ✔ | Cell tooltip: a =PY cell's error (last line) and printed output | |
| ✔ | Python loops per cell (cell menu ▸ Python loop (auto-refresh), Custom…), badge shows ⟳ + period, saved in .ksheet | |
| ✔ | Results: values, spill, objects, matplotlib figures beside the cell, ks()/ks_set()/ks_image(), UDFs, 30 s limit | core/python.py in Pyodide |
| ✔ | Trust: Python cells of an opened file wait for "Run Python Cells" (banner) | |

## Grid

| | Item | Notes |
|---|---|---|
| ✔ | Arrows, Ctrl+Arrow (data edge), Shift+Arrow / Shift+Ctrl+Arrow, Home, Ctrl+Home/End, PgUp/PgDn | |
| ✔ | Enter / Tab move, F2 edit, Delete clears, Ctrl+Enter fills the selection | |
| ✔ | Ctrl+C / X / V (tab-separated, other apps), Paste Values Only, marching ants | |
| ✔ | Fill handle (drag, double-click), Ctrl+D / Ctrl+R | |
| ✔ | Ctrl+B / I / U, Ctrl+1, Ctrl+A, Ctrl+Space / Shift+Space | |
| ✔ | Column/row resize, header selection, merged cells | |
| ✔ | Cell menu: [Python loop ▸] Plot ▸, Cut, Copy, Paste, Paste Values Only, Clear, Insert Cells, Delete Cells, Format Cells…, Add Comment… / Add Note… (or Edit / Delete) | |
| ✔ | Column header menu: Plot ▸, Set As ▸ X/Y/None, Insert Column Left/Right, Delete Column, Column Width…, Sort A→Z / Z→A, Statistics on Column | + AutoFit (web extra) |
| ✔ | Row header menu: Insert Rows, Delete Rows | + Row Height… (web extra) |
| ✔ | Sheet tab menu: New Sheet, Rename Sheet…, Delete Sheet, Duplicate Sheet, Move Left/Right; double-click renames; drag reorders | |
| ✘ | Spell checking (red underlines, suggestions) | |
| ✘ | Cell buttons (Insert ▸ Button…) | |

## Charts, objects, dialogs

| | Item | Notes |
|---|---|---|
| ✔ | Charts of the 13 types from the selection, drawn by core/charts, follow their data, move/resize | |
| ✔ | Chart menu: Update Plot, X/Y Axis ▸ Linear / Log₁₀ / Axis Properties…, Add Trendline…, Size ▸ (screen + journal presets), Export Image ▸ PNG / SVG, General / Series / Axis Properties…, Edit Legend… (→ the web chart dialog), Bring Forward, Send Backward, Delete | |
| ✘ | Invert Axis, Pan Axes, Annotations, Export PDF, Plot Templates | disabled |
| ~ | Chart properties | one web dialog instead of the desktop's General / Series (Data, Line, Symbol, Fill, Bar, Pie…) / Axis (Scale, Title, Tick Labels, Line & Ticks, Grids, Top Axis) dialogs |
| ✔ | Trendline dialog (fits, equation, GOF), Solver dialog | |
| ✔ | Format Cells (Number, Alignment, Font, Border, Fill) | |
| ✔ | Images, equations (KaTeX), notes/comments, links, checkboxes, dropdowns, sparklines | |
| ✘ | Shapes, fitting (lmfit peaks), text import dialog, printing dialog (page setup) | |

## Files

| | Item | Notes |
|---|---|---|
| ✔ | .ksheet (HDF5, desktop-compatible incl. formats, charts, py_loops), .csv, .xlsx open/save/export | |

## Browser test list (for the user)

1. Toolbars: the desktop icons in three groups; hover tooltips (New, Open, Save, Print (Ctrl+P), Undo…); switch View ▸ Theme ▸ Light (Emerald) and back.
2. Type `=` in a cell: the entry goes to the formula bar; press ↑ to point at a cell, F4 to cycle `$A$1`; Enter.
3. Type `=PY` and Enter: the bar turns into the Python editor (tint, PY badge, 3 buttons). Type `x = 2` Enter `x * 21`, then Ctrl+Enter (⌘Enter): the cell shows 42.
4. Type `=PY 1+1` and Enter in another cell: it runs at once (2).
5. Click the pop-out button (↗ next to the badge): "Python — A1" opens with the code; maximise it (button or double-click the title), restore, drag it, resize from the corner.
6. In the pop-out: Ctrl+Space after `np.` / `ks`, Ctrl+/ on a line, Tab / Shift+Tab, Snippets ▸ Histogram, ks(), Pick then click a cell (inserts `ks("B3")`), Run: output pane shows printed text and "Result: …"; break the code (`undefined_name`) and Run: red traceback and the line highlighted.
7. Period (⏱) ▸ 1 s, Play: the cell's badge shows ⟳ 1s and the value refreshes (try the "Live clock" snippet); Stop. Right-click the =PY cell ▸ Python loop ▸ Off / 5 seconds.
8. Hover a =PY cell with an error: the tooltip shows the error's last line.
9. Right-click a cell, a column header, a row header, a sheet tab, a chart: compare the menus with the desktop.
10. Sheet tabs: ◀ ▶ + ∨, × on a tab (asks), double-click to rename, drag to move.
11. Status bar: select numbers → Average / Count / Sum; zoom slider, − and +; Ctrl+= / Ctrl+- / Ctrl+0.
12. fx (or Shift+F3): search "average", Go, pick AVERAGE, OK → `=AVERAGE()` in the bar.
13. Science ▸ Derivative… with a Y column selected, "Add results to:" a cell, Compute & Write. Tools ▸ Statistics on Selection.
14. Table Design ▾ on a range (with/without Header Row, Banded Rows); Borders ▾ presets; Fill / Font colour split buttons; Merge.
15. Insert ▾ ▸ Emoji…, Insert Symbol ▾, Insert Equation ▾ ▸ Quadratic Formula, Sparklines from Selection…, Insert ▸ Pivot / Transpose.
16. File ▸ Print… (browser print preview of the used range); chart ▸ Export Image ▸ Save as PNG….
