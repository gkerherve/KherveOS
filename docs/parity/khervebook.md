# KherveBook — parity with the desktop app

Reference: `../KherveBook` branch `origin/dev` (bd728ee, 2026-09-27: mainwindow.py, celltoolbar.py,
notebook.py, cells.py, notecell.py, filecell.py, kfitcell.py, kfitio.py, kfitmodels.py, ktexcell.py,
ktexdoc.py, molcell.py, svgcell.py, sheetcell.py, jscell.py, explorer.py, ai_chat.py, hltheme.py,
thesaurus.py, style.py, icons.py, ipynb.py, importers.py, git_backend.py, history_dialog.py,
remote_dialog.py, kernel.py) and `../khervefitting-web/public/screenshots/tools/khervebook/`.
Web edition: `src/apps/khervebook/` (+ `public/apps/khervebook/py/kbook_kfit/`). Pass of 2026-10-08.

✔ same as the desktop · ~ partly / differently · ✘ missing · + web extra

## Look

| | Item | Notes |
|---|---|---|
| ✔ | Toolbar icons | the desktop's own: qtawesome "mdi.*" names drawn from MDI 5.9.55 (`@mdi/js-5`, the release qtawesome's `mdi` prefix ships) — `mdi.tsx`; 24 px in 36 px flat buttons; run ▶ green `#27ae60`, stop ■ red `#c0392b` |
| ✔ | Buttons show their icon only, or their text when they have none (a⁄b, √, αβγ, ±≤∞, "Open in KhervePaint" — `mdi.draw-pen` is not in MDI 5.9, so the desktop shows text too); drop-down buttons have no arrow (QSS `menu-indicator: none`) | before: lucide icons, carets, "Snippets"/"Section" text |
| ✔ | Two toolbar rows: main row, then the row that follows the selected cell's type | |
| ✔ | Left docks: Files above, AI Chat below, splitter between them and to the cells | |
| ✔ | Cell cards: gutter (▶ green play-circle, ■ red stop-circle while looping, orange restart for code cells, chevron collapse, `In [n]:` / md / tex / sheet / svg / js / note / file / kfit / ktex / mol), title, summary, height grip, width grip | gutter icons are now the desktop's MDI glyphs and colours |
| ✔ | Selected cell: accent border + bar on the left; Page Mode: one continuous page, borders hidden | |
| ✔ | View ▸ Theme: the desktop's 8 themes (Light, Dark, Slate, Ocean, Forest, Sand, Graphite, High Contrast) from `style.THEMES`, applied to the KherveBook window (gutter label colour, cards, editor, chrome) | + "Kherve Green (KherveOS)", the default (KherveOS has one look) |
| ✔ | Python highlighting: the desktop's "Auto" palette (VS Code-like, light/dark) and the 7 named themes with their editor background (Monokai, Dracula, One Dark, Nord, Solarized Light/Dark, GitHub Light) | ~ colours only: the desktop's bold keywords / italic self are not drawn |
| ~ | Window title `*Untitled — KherveBook v0.1.N` | same text; "v" is the desktop release this edition follows |
| ~ | Status bar | desktop: one message line ("KherveBook v…", save / git messages). Web: the same messages + file location, Python kernel pill, "Cell n of N" (+) |

## Menus

| | Menu | Items |
|---|---|---|
| ✔ | File | New (Ctrl+N), New Window (Ctrl+Shift+N), Open… (Ctrl+O), Save (Ctrl+S), Save As… (Ctrl+Shift+S), Open Recent ▸ (12, Clear Recent Files), Insert Image / PDF… (PDF: one SVG cell per page at 150 dpi, via mupdf), Import Spreadsheet (.xlsx)… (one multi-sheet sheet cell; .csv/.tsv too), Import Jupyter/Colab (.ipynb)…, Export as Jupyter/Colab (.ipynb)…, Exit (Ctrl+Q closes the window) |
| ~ | File ▸ Import Spreadsheet | an .xlsx formula without a saved value is kept as text (desktop translates it to Python with `_xl2py`) |
| ✔ | Edit | Undo (Ctrl+Z: editor text first, then cell structure), Redo (Ctrl+Shift+Z), with the desktop icons |
| + | Edit (web extras) | Find in Cell… (Ctrl+F), Clear Output, Clear All Outputs |
| ✔ | Cell | Add Code (Ctrl+Shift+C), Markdown (Ctrl+Shift+M), Note (Ctrl+Shift+E), LaTeX (Ctrl+Shift+L), Sheet (Ctrl+Shift+T), SVG, JavaScript Cell, Attach File Cell… (asks for the file at once), Run Cell (Ctrl+Enter), Run All (Ctrl+Shift+Enter), Cut / Copy / Paste Cell (Ctrl+Shift+X / O / V), Move Cell Up / Down (Ctrl+Shift+↑/↓), Delete Cell (Ctrl+Shift+D) |
| + | Cell (web extras) | Run Continuously / Stop, Cell Type ▸ |
| ✔ | Kernel | Restart Kernel (Ctrl+Shift+R) |
| + | Kernel (web extras) | Restart Python (stops a running cell), Start Python, the Python / Pyodide version |
| ~ | Git | all 5 items with their icons; they act only on an existing repository, Connect… is greyed out — see "Git" below |
| ✔ | View | File Explorer (Ctrl+B), AI Assistant (Ctrl+Shift+A), File Explorer Position ▸ Left / Right, Page Mode (continuous) (Ctrl+Shift+P), Theme ▸ |
| ✘ | View ▸ File Explorer Position ▸ Floating; View ▸ Interactive Plots (zoom/pan) | shown disabled ("not in the web edition"): figures are PNGs |
| + | View (web extras) | Line Numbers, Collapse / Expand All Cells |
| ✔ | Examples | the desktop's categories and notebooks (exported by `tools/export_khervebook_examples.py`) | + "Welcome to KherveBook" on top |
| ✔ | Help | User Guide (F1), Check for Updates…, Check for Updates on Startup, Report an Issue / Feedback…, About |
| ~ | Help ▸ Check for Updates… | says the web edition updates with KherveOS; "on Startup" is shown checked and disabled |
| + | Help (web extra) | Keyboard Shortcuts |

## Main toolbar (desktop `_build_toolbar`)

| | Button | Notes |
|---|---|---|
| ✔ | New (book-plus-outline), Open (folder-open-outline), Save (content-save) | |
| ~ | Snapshot (cloud-upload-outline), History (history) | work on an existing repository only (see Git) |
| ✔ | Undo, Redo | |
| ✔ | Add cell (plus), Cut, Copy, Paste | |
| ✔ | Up, Down | |
| ✔ | Run (green play), Run continuously (repeat), Stop (red stop), Restart (refresh), Run all (fast-forward) | Stop also cancels queued cells (+) |
| ✔ | File explorer (file-tree), AI assistant (robot-outline) — checkable, shared with the View menu | |
| ✔ | Page Mode (view-day), checkable | |
| ✔ | Cell-type selector: Code, Markdown, Note, LaTeX, Sheet, SVG, JavaScript, File, KFit, KherveTeX Doc, Molecule | was 6 types |

## Second toolbar row (desktop `celltoolbar.py`)

| | Cell type | Tools |
|---|---|---|
| ✔ | Code (also JavaScript) | Run, Comment, Indent, Dedent, Snippets ▾ (the desktop's 5), Open in KhervePY (language-python) |
| ✔ | Markdown | H ▾ (H1–H3), Bold, Italic, Strike, Code, Bullets, Numbers, Quote, Link, Align left / center / right, Text colour…, Highlight…, Comment, Render |
| ✔ | LaTeX | a⁄b √ xⁿ xₙ Σ ∫ lim, Section ▾ (7), Format ▾ (7), List / Env ▾ (8), αβγ ▾ (24), ±≤∞ ▾ (12), Comment, Render |
| ✔ | Sheet | Run, Add row, Add column, Delete row, Delete column, Add sheet, Open in KherveSheet |
| ~ | Sheet ▸ Open in KherveSheet | the shown sheet goes over as CSV (values; formulas stay in the cell); saving there reloads it. Desktop sends the whole workbook as .ksheet |
| ✔ | SVG | Select, Pen, Line, Rectangle, Ellipse, Text; Colour, width; Undo shape; Grid, Snap, grid px; W, H; Shape ▾; Library ▾ (KhervePaint's objects from `~/Documents/KhervePaint Library`); Edit source; Render; Open in KhervePaint |
| ✔ | Note | Font family, size (6–96), paragraph style (Body / Heading 1–3), Bold, Italic, Underline, Strike, Bullets, Numbers, Align ×3, Text colour, Highlight, Pen (checkable), Pen colour, Pen width, Undo stroke, Clear ink |
| ~ | Note ▸ Font family | a list of 13 common fonts (desktop QFontComboBox lists the system's) |
| ✔ | File | Attach / Replace, Open, Save a copy, Copy reference |
| ✔ | KFit | Load .kfit, Refresh, Plot, Data, Open in KherveFitting |
| ✔ | KherveTeX Doc | New Document, Insert .ktexz / .tex…, Refresh, Edit in KherveTeX |
| ✘ | KherveTeX Doc ▸ Locate KherveTeX… | not needed on KherveOS (shown muted) |
| ✔ | Molecule | 3D, 2D Sketch, Open in KherveMol |
| ✘ | Molecule ▸ Build 3D from Sketch | needs KherveMol's engine (shown muted) |

## Cells

| | Item | Notes |
|---|---|---|
| ✔ | Code: Python in the shared kernel (np, plt, pd preloaded; scipy, sympy, lmfit on first use), `In [n]:`, stdout/stderr, last-expression result, errors in red, figures | Pyodide in a worker |
| ✔ | Run continuously (60 ms), per-cell restart (forget its globals, re-run), stop | ~ only code cells loop (desktop: any cell) |
| ✔ | Markdown: render on run, double-click to edit; `$math$` | |
| ✔ | LaTeX: equations (KaTeX) and documents (built-in renderer) | ~ the desktop typesets whole documents with tectonic |
| ✔ | Sheet: workbook, `=` Python formulas with A1 refs/ranges, sheet1…, `ks()`, View ▸ / Create Plot ▸ menu | |
| ✔ | SVG: drawing tools, source editing | |
| ✔ | JavaScript: sandboxed page | |
| ✔ | **Note** (new): white Word-style page you type and format in place, pen/ink overlay (strokes in `ref_w` space, rescaled with the width), `{"kbook_note":1,"html","ink"}` written like Python's `json.dumps`; Qt's `<html><body style>` shell is kept on save | ~ execCommand formatting: no-selection = typing format (desktop: the word under the cursor, for font/size it is the word) |
| ✔ | **File** (new): "N attached files", Add files…, a card per file (icon by type, name, size · "stored in <stem>_files" / "kept in memory until the notebook is saved", Open / Save a copy… / Copy kf() reference / Remove), image thumbnail (220×140), 6-line text snippet, "binary file — kept as-is" | |
| ✔ | Attachments live beside the notebook: Save writes them to `<stem>_files/` (data.csv, data-2.csv… when two cells hold the same name) and the .kbook keeps only the path; unsaved = base64 in the JSON (desktop `materialize`) | Save As to another folder copies them |
| ✔ | `kf("name")` → the attachment's path (unsaved ones are written to `~/.cache/khervebook/`), `kf()` → the notebook's folder; errors as the desktop | |
| ✘ | File ▸ structured previews of .xlsx / .ksheet / .kfit attachments (sheet / core-level selector) | shown as "binary file" |
| ~ | File ▸ Add files… picks one file at a time (KherveOS's file dialog has no multi-select); drop several at once works | |
| ✔ | **KFit** (new): sheet selector, "name · points · range · peaks · sample", Refresh, Open in KherveFitting, Load .kfit…, Plot / Data tabs, coverage hint — drawn by the desktop's own `kfitio.py` + `kfitmodels.py` (copied unchanged) and kfitcell's plot code in Python (KherveFitting look: black points, dashed grey background, shaded peaks, blue envelope, green residuals lifted above) | Data table: first 20 000 rows |
| ✔ | `kfit()`, `kfit("C1s")`, `kfit("C1s", cell=2)` / `cell="name"` | |
| ✔ | **KherveTeX Doc** (new): title bar (document title from document.json / `\title`), file · where, ▲ Page n / N ▼, new / insert / refresh, Edit in KherveTeX (reloads when KherveTeX saves), grey desk with shadowed pages | |
| ~ | KherveTeX pages | from a PDF beside the document, or its .tex typeset by the KherveOS server (tectonic). A bare .ktexz without either shows a hint (desktop translates the model to LaTeX itself) |
| ✔ | **Molecule** (new): header (molecule icon, name, formula with subscripts), 3D / 2D toggle, Open in KherveMol (round trip on a .kmol), the stored .kmol kept verbatim | |
| ~ | Molecule views | 3D: ball-and-stick drawn in the cell (drag to rotate, wheel to zoom), not KherveMol's Viewer3D; 2D: the stored sketch, read-only |
| ✘ | Molecule ▸ Build from a name / SMILES / formula, Tools (3D building tools) | the entry is there; Build points to KherveMol |
| ✔ | Convert To / the type selector keeps the text the new type understands (desktop `set_source` of the new widget) | |
| ✔ | Drops: a File cell takes any file, KFit takes .kfit, KherveTeX .ktexz/.kdocz/.tex, Molecule .kmol; elsewhere files become cells (.py .md .tex .csv/.tsv/.txt/.dat .svg images .pdf .xlsx .kfit .ktexz .kmol .ipynb; .kbook opens) | |
| ✘ | Drops of .ksheet, .kdocz-as-markdown, .ktex (KherveTeX JSON → LaTeX) | |

## Editor (desktop `_GrowingEdit`)

| | Item | Notes |
|---|---|---|
| ✔ | Shift+Enter run and advance (a code cell is added at the end), Ctrl+Enter run in place | + Alt+Enter run and insert |
| ✔ | Ctrl+/ comment in the cell's syntax (# / % / `<!-- -->` / //) | |
| ✔ | Ctrl+F: the desktop's find bar under the editor — "Find in cell…", ▲ ▼ ✕, incremental, case-insensitive, wraps, red when not found, Esc closes | was CodeMirror's search panel |
| ✔ | Right-click in an editor: Run Cell, Undo, Redo, Cut, Copy, Paste, Delete, Select All, Find… (Ctrl+F), **Synonyms for "word" ▸** (Markdown / LaTeX, Datamuse like thesaurus.py), **Highlight Theme ▸** (code) | was the browser's menu |
| ✔ | Up on the first line / Down on the last line moves to the neighbouring cell | + |
| + | Command mode (Esc): ↑ ↓ / J K, A / B add above / below, Y M L type, X C V, D D, Z, Enter edit | Jupyter keys, not in the desktop |

## Right-click menus

| | Menu | Items |
|---|---|---|
| ✔ | Cell | Run Cell, Run Continuously / Stop Continuous Run, Restart This Cell (code), Collapse / Expand Cell, Set / Edit Title…, [sheet: View ▸, Create Plot ▸], Cut Cell, Copy Cell, Paste Cell Below, Convert To ▸ (10 others, desktop labels incl. "KherveTeX Document"), Move Up, Move Down, Place Beside Cell Above / Move to Own Row, Delete Cell |
| ✔ | Editor | see Editor |
| ✔ | Sheet grid | desktop sheetcell menu (View ▸, Create Plot ▸ Line / Bar / Scatter) |

## Panels

| | Item | Notes |
|---|---|---|
| ✔ | Files: folder button (folder-open-outline), root label, tree, double-click opens .kbook, other types greyed, drag files onto cells | + parent-folder button |
| ✔ | AI Chat: "AI Assistant provider · model", A− A+ Auto, ? (help-circle-outline), ⚙ (cog), 🗑 (delete-sweep), Apply & run, image paste, Send (green send icon) | icons now the desktop's |
| ✔ | View ▸ File Explorer Position ▸ Left / Right moves the side panels | |

## Git (desktop git_backend.py, history_dialog.py, remote_dialog.py)

Git is secondary in KherveOS (user, 2026-10-08): the web edition **never creates a repository** by itself.

| | Item | Notes |
|---|---|---|
| ~ | Snapshot on save | only for a notebook already inside a repository (made or cloned in KhervePY): its own files (`<stem>.kbook`, `<stem>_files/`) are committed "Save X at <time>", and uploaded if the repository has a remote. Desktop: every save initialises the folder's repository on `dev` |
| ~ | Save Snapshot & Upload | asks "Describe what you changed:" when the notebook is in a repository; otherwise says there is none |
| ~ | Download Latest from Cloud | pulls when the repository has a remote; otherwise a message (no "set it up now") |
| ✘ | Connect to GitHub / GitLab… | greyed out ("not in the web edition"): it would create a repository |
| ~ | View Version History… / Branches… | read the existing repository: commits touching the notebook, per-commit diff, Restore this version, Switch / + New branch / Delete; a commit list with dots, not the painted DAG |

## Files

| | Item | Notes |
|---|---|---|
| ✔ | .kbook v7 read/write, every cell type round-trips (unknown types and keys kept) | Note / File / KFit / KherveTeX / Molecule sources written in Python `json.dumps` form |
| ✔ | .ipynb import/export, KherveBook metadata for a lossless round trip; Jupyter display of note / file / ktex / mol cells as the desktop writes it | |

## Tests

- `node --test tools/tests/khervebook-cells.test.ts`: json.dumps parity (against python3), NOTE_STARTER,
  note / file / kfit / ktex / mol documents, sidecar names, previews, `kf()` / `kfit()` in Python, and the
  KFit view (desktop kfitio + kfitmodels) on a real .kfit (KherveFittingPro's Fe2O3.kfit, skipped if absent).
- `npx tsc -b`: no errors in `src/apps/khervebook`.

## Browser test list (for the user)

1. Toolbars: compare both rows with the desktop screenshot (icons, order, separators, no arrows on Snippets / H / Section / Format / List-Env / αβγ / ±≤∞). Hover tooltips. Toggle the file-tree / robot / page-mode buttons: they stay in step with the View menu.
2. The type selector lists 11 types. Pick each type on a fresh cell: the second row changes (Note: font, size, style, B I U S, lists, align, colours, pen…; File; KFit; KherveTeX Doc; Molecule).
3. View ▸ Theme ▸ Slate, Light, Dark, Graphite, High Contrast: cards, toolbars, gutter label colour and code colours follow; back to Kherve Green. View ▸ File Explorer Position ▸ Right / Left.
4. Code cell: Shift+Enter (runs, moves on, adds a cell at the end), Ctrl+Enter, Ctrl+/, Ctrl+F (find bar: type, Enter / Shift+Enter, ▲ ▼, red when missing, Esc). Right-click in the code: the desktop menu; Highlight Theme ▸ Monokai (all code cells restyle; persists after reload), back to Auto.
5. Markdown cell: right-click a word in the source → Synonyms for “word” ▸ → pick one (needs internet).
6. Cell ▸ Add Note Cell (Ctrl+Shift+E): type, select text, B / I / U / S, Heading 1, bullets, align centre, colours, font and size. Pen on: draw strokes; resize the window: strokes stay on their words; Undo stroke, Clear ink. Save, reopen: text and ink come back. Open the file in the desktop app if you can.
7. Cell ▸ Attach File Cell…: pick a .csv; the card shows its size, "kept in memory…", a 6-line preview. Copy kf() reference, paste into a code cell: `import pandas as pd; pd.read_csv(kf("x.csv"))` runs. Save the notebook: the card says "stored in <name>_files" and the file is in that folder in Files. Attach an image: thumbnail. Remove.
8. Drag a .kfit (e.g. copy one into the drive) onto the notebook: a KFit cell; choose sheets; Plot / Data tabs; in a code cell `kfit()` and `kfit("C1s").frame()`. Open in KherveFitting, change and save there: the cell updates.
9. KherveTeX Doc: New Document → title and file shown, hint about pages; Edit in KherveTeX opens it. Insert a .tex: pages typeset (needs the server); ▲ ▼ and the page counter.
10. Molecule: Open in KherveMol, build something there and save: the cell shows it in 3D (drag to rotate, wheel to zoom) and 2D.
11. File ▸ Insert Image / PDF… with a PDF: one SVG cell per page. File ▸ Import Spreadsheet with an .xlsx: one sheet cell with a View ▸ entry per sheet.
12. Code cell → Open in KhervePY; SVG cell → Open in KhervePaint; Sheet cell → Open in KherveSheet: edit and save there, the cell updates. SVG ▸ Library ▾ lists objects saved in KhervePaint.
13. Git (optional): for a notebook inside a repository made in KhervePY, saving makes a snapshot; Git ▸ View Version History… lists it (diff, Restore); Branches…. For a notebook outside a repository, saving creates no .git folder and the Git items explain why. Connect… is greyed out.
14. Help: Check for Updates…, Report an Issue (opens GitHub), About (icon), User Guide (F1). Kernel ▸ Restart Kernel (Ctrl+Shift+R — the browser may keep it for reload; the menu always works). File ▸ Exit (Ctrl+Q).
