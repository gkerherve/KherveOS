# KherveCAD — parity with the desktop app

Reference: `../KherveCAD` **main @ 2994bd0** (v0.1.544), the committed tree
(`git archive HEAD`). Web edition: `src/apps/khervecad/` (React) and
`public/apps/khervecad/py/` (Python). Pass of 2026-10-08.

✔ same as the desktop · ~ partly / differently · ✘ missing

## How this port is built (why it is 1:1)

The desktop app is **run, not re-written**. Its own `MainWindow` (PyQt5,
`khervecad/mainwindow.py`) is built in the window's Pyodide worker on a
headless Qt (`kcweb/qtshim/PyQt5`: widgets with state and signals, item
views, dialogs, a QGraphicsScene, a recording QPainter) and the React side
draws whatever that window contains:

- every **menu, toolbar, panel, tab, dialog, tooltip, shortcut and slot** is
  the desktop's code — the web side has no list of its own;
- what can only exist in a browser is swapped: OpenSCAD runs as WebAssembly
  (`openscad-wasm`, OpenSCAD 2025 with the Manifold backend) in
  `openscad.worker.ts`; three.js draws the 3D view from the desktop
  `View3D`'s meshes and camera; a canvas draws the desktop `SketchScene`'s
  items and every custom-painted widget or graphics item from recorded
  QPainter commands;
- a modal Qt call (QFileDialog, QMessageBox, QInputDialog, QColorDialog, a
  dialog's `exec_()`, an OpenSCAD export) is shown by the web side and the
  action is run again with the answer (`_dialogs.py`).

`tools/export_khervecad.py` exports the package (`khervecad.zip`, 2.1 MB),
its data (491 files, 40.9 MB, fetched one by one on first use), the
Liberation fonts, the icons (`mdi.ts`: the same Material Design Icons 5.9.55
qtawesome draws) and the sample `Chair.kcad`; with `--qt-python` it also
builds the real desktop window offscreen and writes
`docs/parity/khervecad-ui.json` (every menu item, toolbar button, tooltip and
shortcut) and `docs/parity/khervecad-desktop.png`.

Tests: `src/apps/khervecad/tests/logic.test.mjs` (16, web logic) and
`python.test.mjs` → `headless_test.py` (15: the desktop window driven the
web way — tools, questions, undo, sketch drawing, tree rename, properties,
MCP tools, shortcuts, library, Save As). A sweep of every menu item ran
headless with no Python error (see the end).

## Look

| | Item | Notes |
|---|---|---|
| ✔ | Window layout | Top tool bar; vertical tool bar on the left; left column = Main / Object / Collections / Variables / Code tabs over Properties; right column = 2D sketch over 3D view (QSplitters, the desktop's 430 / 970 and 360 / 500 proportions, draggable) |
| ✔ | Docks | Customizer (opens by itself for an annotated document, View ▸ Customizer) and Assistant (AI ▸ ChatBox) on the right, with title and close |
| ✔ | Status bar | `x: … mm  y: … mm` · measure · selection size · `File: …` · `1 mm = 4.00 px` · `Engine: OpenSCAD (ready / rendering…)`; messages replace the left part for their timeout |
| ✔ | Icons | the desktop's own (qtawesome `mdi.*` names → Material Design Icons 5.9.55 paths, 248 icons); 4 names the desktop asks for do not exist in MDI 5.9.55 and are blank there too |
| ✔ | Tooltips | the desktop's rich how-to cards (tooltips.py) on every tool, group button, tab and field |
| ~ | Colours | KherveOS's one theme (Kherve Green) for the chrome; inside, the desktop "Dark" tokens (tree's red errors / purple variables / grey hidden rows, the 3D view's model colour). View ▸ Theme switches those tokens (KherveOS has no other chrome theme) |
| ✔ | App icon | `public/icons/apps/khervecad.png` = `packaging/khervecad.png` (same file) |
| ✔ | Window title | `*Untitled — KherveCAD v0.1.544+2994bd0` (the desktop's VERSION) |

## Menus (the desktop's menu bar, in the KherveOS menu bar)

All ten menus with every item, separator, sub-menu, check mark, shortcut and
enabled state, live from the desktop window (`khervecad-ui.json` counts in
brackets).

| | Menu | Items |
|---|---|---|
| ✔ | File (22) | New, New Window (opens another KherveCAD window), Open… (KherveOS file dialog: .kcad .scad .csg .stl .obj .off .3mf …), Open Recent ▸ (live), Save, Save As…, Show in File Explorer (shows it in Files), Import OpenSCAD…, Import Mesh…, Import 2D Drawing (SVG/DXF)…, Import Height Map…, Export OpenSCAD…, Export STL… (OpenSCAD wasm, binary STL, the desktop's unit question), Export PNG… (dialog), Export Turntable Movie… (dialog), Blueprint (2D Drawing)… (the Blueprint window), Make 2D Drawing…, Exit (closes the window, asking about unsaved changes) |
| ✘ | File ▸ Import CAD File / Export for Other CAD (STEP/IGES/Rhino) | the dialog opens; OpenCascade (OCP) and rhino3dm do not exist for Pyodide — the desktop's "not installed" message |
| ✘ | File ▸ Render Photo (Blender) | needs Blender: the desktop's message |
| ~ | File ▸ Publish to Printables…, Send to PlanetCraft… | the dialogs open; the upload / send need network access the Pyodide worker does not have |
| ✔ | Edit (20) | Undo / Redo (QUndoStack, one step per action as on the desktop), Cut / Copy / Paste (also between KherveCAD windows; the system clipboard gets the text), Move Up / Down, Delete, Duplicate, Group, Ungroup, Document Units…, Document Scale (1 : N)…, Language ▸ (6, next start, as the desktop) |
| ~ | Edit ▸ Locate OpenSCAD… | asks for a file as the desktop does; the engine is always the built-in OpenSCAD wasm |
| ✔ | Insert (42) | New Object, Part Library…, 2D Shapes ▸ 5, 3D Solids ▸ 8, SubD Box, Draw 3D Curve, Repeat & logic ▸ 7, Code & files ▸ 6, Mechanical features ▸ 5, Shapes & patterns ▸ 7 |
| ✔ | Tools (54) | Extrude ▸ 4, Move & transform ▸ 6, Combine ▸ 4, Finish ▸ 6, Deform & sculpt ▸ 13, Character ▸ 10, Edit Vertices (Edit Mode), Convert to SubD, Surface from Curves ▸ 6, Snap objects, Measure & annotate ▸ 2 |
| ✔ | Library (2,013 + My Library) | Part Library (customise)…, OpenSCAD Libraries…, My Library ▸ (live: the user's library in `~/Documents/KherveCAD Library` on the KherveOS drive), ENGINEERING / BUILDINGS & PLACES / SCIENCE / TOYS & MODELS / EVERYDAY THINGS / LEARN with every part and example, and every builder: House, City (+ New layout ▸ Village / Town / City), Lego (+ Convert / Fuse), Crystal, Surface, Compound, Human, Car, Chamber Designer |
| ~ | Library ▸ OpenSCAD Libraries… | the dialog opens; installing BOSL2 / MCAD downloads from GitHub, which the worker cannot |
| ✔ | View (83) | Customizer, Animate ($t)…, Grid, Snap, Vibe Model, Dimensions on selection, Clear Dimensions, Add / Clear Reference Image, Zoom In / Out / Reset 2D Zoom / Fit Sketch / Zoom to Selection / Fit 3D View, 3D Camera ▸ 7, 3D Projection ▸ 2, 3D Render Style ▸ 9, 3D Background ▸ 6, Platform and Shadow, Cavity Shading, Edge Lines, Scale Bar, Ground Grid, Smooth Shading, Compare to Reference Image, Hardware Rendering, Gumball, Exploded View ▸ 10, Cut Through ▸ 16, Theme ▸ 8 |
| ✔ | Analyse (9) | Mass properties…, Check for 3D printing…, Check interference… (the desktop dialogs), Heat Map ▸ 6 |
| ✔ | AI (3) | Connect to Claude (Simple)… (the desktop's MCP dialog), ChatBox (the dock), Mesh from Photo… (the dialog) |
| ~ | AI | the desktop's MCP bridge (localhost TCP) and the ChatBox's / Mesh from Photo's web APIs cannot run in the worker; KherveCAD's MCP tools are offered to KherveAI and KherveOS's MCP server instead (see AI below) |
| ✘ | Git (4) | Commit, Push, Pull, Connect — the desktop needs pygit2 (no Pyodide build) and says so |
| ✔ | Help (4) | User Guide (the desktop's manual with its screenshots, 6 languages), About; Check for Updates explains KherveCAD is updated with KherveOS; Check Automatically (setting kept) |

## Tool bars

| | Bar | Buttons |
|---|---|---|
| ✔ | Vertical (19) | Select V, Line L, Rectangle R, Circle C, Polygon P, Text T │ Measure distance M, Add dimension D │ Cube, Sphere, Cylinder, Capsule, Ellipsoid, Rounded box, Loft, Skin │ Human figure, House Builder, City Builder — exclusive tool group, checked tool shown |
| ✔ | Horizontal (26) | New, Open, Save │ Undo, Redo │ 7 family split-buttons (Extrude, Move & transform, Combine, Finish, Deform & sculpt, Character, Repeat & logic: a click runs the tool used last — remembered — the arrow lists the family) │ Snap objects J │ Grid, Snap, Grid [0.50 mm], Plane [Top (XY) / Front (XZ) / Side (YZ)], Fit sketch │ Render F5, Fit 3D, Blueprint, Cut through, Edit vertices │ Vibe Model (text beside the icon) |
| ✔ | Vibe Model | folds the left column, the sketch, the vertical bar and all but file / undo / Vibe, as the desktop |
| ✔ | Code tab bar | Undo, Redo, Cut, Copy, Paste, Indent, Dedent, Wrap long lines (act on the editor) |

## Panels

| | Panel | Notes |
|---|---|---|
| ✔ | Main tab | Common segments ($fn) check + spin; the assembly tree (Objects as one row, their Position / Rotation / Color rows, "(hidden)" and debug-modifier tags, guide lines, red errors with the message as tooltip) |
| ✔ | Tree interaction | click / Ctrl / Shift selection, expand arrows, double-click (opens an Object, else renames in place), F2 rename, right-click → the desktop's context menu (built by the desktop for the selection: Show/Hide, Debug modifier, Split, Imported mesh, Apply ▸ 14, Round edges, Color…, Group, Ungroup, Cut/Copy/Paste, Rename, Duplicate, Analyse, Linked copy, Make Object, Save to My Library, Move to Collection, Insert Object, Delete, Anchors, Snap, Attach / Detach…), drag & drop onto / above / below rows, keys Space Del Q A Tab Ctrl+↑↓ Ctrl+C/X/V, ↑↓ |
| ✔ | Object tab | Object chooser, New / Rename / Delete / To Main buttons, the Object's own tree; the views isolate to it |
| ✔ | Collections tab | the desktop panel |
| ✔ | Variables tab | Scope chooser, the sheet (name, value / expression, Customizer control: slider, drop-down, checkbox, text), + Variable / − Remove |
| ✔ | Code tab | the program with line numbers and the desktop's colours (ScadHighlighter families), the selected object's lines tinted and scrolled to, broken lines red, Whole program / Active object, Apply code |
| ✔ | Properties | the selected node's schema form: Name, value-or-expression fields with the variables drop-down, spin boxes, check boxes, colour buttons (colour dialog), choices, points table (+ − ↑ ↓), rows editors, multi-line code |
| ✔ | Customizer dock | the desktop's sliders / drop-downs / check boxes per annotated variable |

## 2D sketch

| | Item | Notes |
|---|---|---|
| ✔ | Scene | the desktop SketchScene: editable 2D shapes in Top (XY), every part's outline in its own colours (planview faces, painter-ordered) in any plane, the selection's silhouette, profile-edit mode, House floors cut as plans |
| ✔ | Select tool | click / Ctrl-click / rubber band, drag to move (grid snap, anchor snap for Objects, commits as the desktop does), resize handles (rect corners, circle radius, polygon vertices, line ends, primitive dimension handles) |
| ✔ | Drawing tools | Line, Rectangle, Circle (drag), Polygon (click points, double-click or Enter), Text (click); live length / size readout in the status bar |
| ✔ | Measure / dimension | feature snapping (corners, centres, midpoints), distance readout, placed dimensions (right-click: delete / clear all) |
| ✔ | Drawing | grid (minor/major, never closer than 6 px), axis lines in axis colours, origin gizmo, axis letters, scale bar, auto dimensions of the selection, dashed selection frame |
| ✔ | Navigation | middle-drag pans, wheel zooms about the cursor (0.001–400 px/mm), the floating bar (◀ ▲ ▼ ▶ hold-to-repeat, zoom ±, Focus, Fit all), Zoom menu items, Esc cancels a tool, Q/A/Tab walk objects |
| ~ | Reference images | listed and placed by the desktop; not drawn under the sketch yet |

## 3D view

| | Item | Notes |
|---|---|---|
| ✔ | Camera | the desktop's: yaw / pitch / distance / target, focal 1.2 × the shorter side, perspective / orthographic, presets (Isometric, Top, Bottom, Front, Back, Right, Left) |
| ✔ | Mouse | left-drag orbits (½° per px, over the poles), right- / middle-drag pans, wheel zooms (0.87 / 1.15, 2 mm … 1000 m), double-click fits; in a pick (anchors, snap, fillet edges…) or Edit Mode the mouse goes to the desktop code |
| ✔ | Keys | Tab = Edit Mode, Esc cancels a pick |
| ✔ | Floating bars | navigation (turn ↺↻, pan, zoom, Focus, Fit, Platform & shadow, Exploded view ▸, Cut through ▸, Display ▸), lighting (Bright, Contrast, Light ↻, Height, reset, Redraw), cut bar (axis, position, side, close) |
| ✔ | Model | built-in preview meshes with per-face colours (the desktop tessellator), exact OpenSCAD renders swapped in per part ("n/m parts exact") and for the whole document (F5) |
| ✔ | Selection | tinted red once per pixel over the render (the desktop's `#`-modifier look) |
| ~ | Render styles | Shaded, Matte, Clay, Toon, Brushed metal, Gold, Copper, Wireframe, X-ray and the per-colour materials — three.js materials close to, not identical with, the desktop painter's shading |
| ~ | Looks | backgrounds (6, gradients), platform & shadow (three.js shadow map), edge lines (40° creases), smooth shading (40° creased normals), ground grid, scale bar (true at the orbit centre, real-thing units for 1 : N), axes, source badge, banner / flash text, anchors, pick hover; cavity shading and reference-image drawing are not reproduced |

## Dialogs (the desktop's own, drawn from their widgets)

House Builder (with its floor-plan canvas), City Builder (map canvas), Lego
Builder (plan), Crystal / Surface / Compound / Human / Car Builders, Chamber
Designer (port map), Part Library, OpenSCAD Libraries, Manage My Library,
Animate ($t), Mass properties, Check for 3D printing, Check interference,
Sculpt, Vertex paint, Edit Mode tools, Export PNG / Turntable Movie / Make
2D Drawing (modal), Publish to Printables, Send to PlanetCraft, Connect to
Claude, Mesh from Photo, User Guide, About, Blueprint window (its own menus,
tool bars, sheet and properties dock), every QMessageBox / QInputDialog /
QColorDialog / file dialog.

| | Item | Notes |
|---|---|---|
| ✔ | Widgets | labels (rich text), buttons, tool buttons with menus, check / radio, line edits, spin boxes, sliders, combo boxes (editable too), group boxes, tabs, stacks, scroll areas, splitters, trees, tables (cell widgets), lists, progress bars, button boxes |
| ✔ | Canvases | QGraphicsViews and self-painted widgets are drawn from the desktop's own paint code (recorded QPainter) and get the mouse, wheel and keys |
| ~ | Pictures | images inside dialogs (QPixmap / QImage drawings) are not shown |

## Keyboard shortcuts

Every QAction shortcut of the window, as Qt resolves it (menus first, then
tool bars; Cmd plays Ctrl on a Mac): Ctrl+N, Ctrl+Shift+N, Ctrl+O, Ctrl+S,
Ctrl+Shift+S, Ctrl+I, Ctrl+Shift+I, Ctrl+E, Ctrl+Shift+E, Ctrl+Alt+S,
Ctrl+Alt+E, Ctrl+Shift+D, Ctrl+Shift+P, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z,
Ctrl+X/C/V, Ctrl+↑/↓, Del, Ctrl+D, Ctrl+G, Ctrl+Shift+G, Ctrl+Alt+N, Ctrl+L,
Ctrl+Alt+C, Ctrl+', Ctrl+Shift+', Ctrl+Shift+M, Ctrl++ / Ctrl+-, Ctrl+0,
Ctrl+Shift+F, Ctrl+F, Ctrl+Alt+G, Ctrl+Shift+X, Ctrl+Alt+X, Ctrl+Alt+↑/↓,
Ctrl+/, Ctrl+K, F1, F5, and the tools V L R C P T M D J.

## Files

| | Item | Notes |
|---|---|---|
| ✔ | .kcad | opened from Files (double-click, drag onto the window) and File ▸ Open; saved back by the desktop's document.py (the same JSON, format version 13) |
| ✔ | Imports | .scad / .csg (scadparse, raw-block fallback), .stl / .obj / .off / .3mf / .amf / .glb, .svg / .dxf, height maps — registered: .kcad .scad .csg .stl .obj .off .3mf .amf |
| ✔ | Exports | .scad (generated program), .stl (OpenSCAD wasm), files land on the KherveOS drive |
| ✔ | Sample | `Chair.kcad` (3 KB, the repository's only committed sample) is put in `~/Documents/KherveCAD Examples/` the first time; the library's own 216 .kcad parts are in the Library menu. The large untracked samples in the desktop folder (Dorden Drive, 24 MB) are not in the committed tree and were left out |

## AI

| | Item | Notes |
|---|---|---|
| ✔ | KherveAI / MCP tools | `khervecad_list_tree`, `_get_code`, `_apply_code`, `_insert_part`, `_list_parts`, `_tool` (any of the desktop's 89 MCP tools by name: add_node, set_params, wrap_nodes, set_color, mass_properties, build_house, build_crystal, load_example, save_document…) and `_list_tools` — run by the desktop's McpToolExecutor in the window, one undo step each |
| ✘ | render_view (a PNG of the 3D view) | the desktop renders it with Qt; not available headless |

## Not in this edition

- STEP / IGES / BREP / .3dm exchange and exact B-rep fillets (OpenCascade,
  rhino3dm), Blender photo renders, Git (pygit2), the movie's ffmpeg
  encoding, OpenSCAD libraries download, Printables / PlanetCraft / image-to-3D
  / ChatBox network calls, the desktop's own MCP server — each shows the
  desktop's own "not available" message or its dialog without the network
  step.
- manifold3d is not built for Pyodide: the preview's booleans are
  approximated as the desktop does without it, and the exact OpenSCAD
  render (Manifold inside OpenSCAD wasm) cuts them.
- Reference images and cavity shading are not drawn; pictures inside dialogs
  are not shown.

## Headless sweep (every menu item)

Run with the desktop's code and the web protocol under CPython: every
File / Edit / Insert / Tools / View / Analyse / AI / Git / Help item and
every Library builder / layout triggers without a Python error; the items
that ask (file dialogs, units, scale, About, Discard?) stop at the question
and finish with the answer; the dialogs open with their widgets.
