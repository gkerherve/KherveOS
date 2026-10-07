# KherveMol — parity checklist (desktop → KherveOS)

Desktop source: `../KherveMol`, **origin/dev** `d6815d6` (2026-09-28, newer than origin/master
`a5628a7`), version **0.1.71+d6815d6**. Port: `src/apps/khervemol/`, engine in
`public/apps/khervemol/py/`, data and examples from `tools/export_khervemol.py`.

Legend: `[x]` same as the desktop · `[~]` adapted (reason given) · `[ ]` not ported.

## Engine

- [x] The desktop's own chemistry modules run unchanged in the window's Pyodide worker (37 modules:
      model, chem, smiles, compounds ×3, catalog, crystal(+_library), lattices, supercell, surface, nano,
      polymers, reactions, rxanim, adsorbates, molcolor, molrepr, entries, document, chemexport,
      meshexport, svgexport, properties, mcp_library, glview.Scene…). `_version.py` is replaced by the
      exported version string.
- [x] PyQt5 stand-in (`py/PyQt5`): a real `QColor` (parse, channels, `name`, `lighter`/`darker`,
      lightness — Qt's arithmetic); every other Qt name is an inert class, so imports work unchanged.
- [x] `kmweb/bridge.py`: one live `Molecule` per window; every op answers with the whole structure.
- [~] RDKit: not in Pyodide 314. As on a desktop without RDKit, 3D structures come from the built-in
      SMILES embedder. RDKit **MinimalLib** (npm `@rdkit/rdkit`, WebAssembly) stands in for what it
      can do: canonical SMILES of a structure (Copy SMILES, Build 3D from 2D sketch), the 2D depiction
      mirrored into the sketch, and the Properties descriptors (exact mass, logP, TPSA, HBD/HBA,
      rotatable bonds, rings, aromatic rings, heteroatoms, Fsp³, SMILES, InChI, InChIKey).
- [~] MOL / SDF / PDB import (desktop: RDKit): `kmweb/readers.py` reads the file's own 3D
      coordinates and bond orders (aromatic → Kekulé via `chem.kekulize`), centred, `name="import"`,
      `bond=1.35`, `rscale=0.9`, explicit atoms only — as `rdkit_io.molecule_from_file`. A flat (2D)
      molfile goes through MinimalLib's SMILES and the built-in embedder (the desktop embeds with RDKit).
      `.xyz` is also read (bonds from covalent radii).
- [x] CIF import through ASE, as the desktop (`symmetry.read_cif`): ase 3.29.0 wheel (PyPI) served
      with KherveOS, numpy/scipy loaded from Pyodide on the first CIF.
- [x] `.kmol` format 5 read/written by the desktop's `document.py` (round-trips with the desktop).
- [x] Exports by the desktop's writers: XYZ, MOL, SDF, PDB, CIF; STL (binary/ASCII), 3MF, OBJ+MTL,
      PLY, GLB; KhervePaint SVG (3D and 2D, with the 2D representation).
- [x] "My molecules" shelf: the desktop's `shelf.py`, file `~/.khervemol/shelf.json` on the drive.

## Window (mainwindow.py)

- [x] Start screen until something is loaded; File ▸ Start Screen returns to it.
- [x] Central tabs **3D View | 2D Sketch**.
- [x] Left docks: **Structure** on top, **Library** and **My molecules** tabbed below (tabs at the
      bottom), resizable splitters, each closable and re-opened from View.
- [x] Right dock **AI Chat**, hidden until opened (toolbar robot, AI menu, Ctrl+/).
- [x] Status bar with the main window's messages (Loaded…, Exported…, Claude: <tool>…).
- [x] Title `KherveMol v<version> — <file> — <formula>`.
- [~] Periodic table window: non-modal tool window inside the KherveOS window (movable, closable).

## Toolbars (maintools.py) — icons from MDI (`@mdi/js`, the set qtawesome draws)

Top row:
- [x] New · Open · Save · PNG · SVG · 3D print · Chem file
- [x] Explorer · SMILES
- [x] Library buttons that open the menus: Molecules · Polymers · Crystals · Surfaces · Carbon · Reactions
- [x] Keep · My molecules
- [x] Properties · AI Chat (checkable) · Guide
Second row:
- [x] " 2D " Draw · Move · Atom · Erase (exclusive, synced with the sketch) · Clear
- [x] " Element " combo (palette; a table pick is added) · Table
- [x] " 3D " Add atom · Single · Double · Triple (exclusive, synced with the Bond combo) · Bond · Delete ·
      Labels (checkable) · Lock (checkable)
- [x] 3D → 2D · 2D → 3D
- [x] Animate (Pause while playing) · Equation
- [x] Tooltips with the shortcuts; edit tools greyed on lattices/scenes, film buttons only for reactions.
- [~] The element combo shows the colour chip beside the list (an HTML list cannot hold icons).

## Menus (every item)

- [x] **File**: New ⌃N · Open… ⌃O · Open Recent ▸ (files, Clear Recent Files / "(No recent files)") ·
      Start Screen · Save ⌃S · Save As… ⇧⌃S · Export PNG… ⌃E · Export SVG (KhervePaint)… ⇧⌃E ·
      Export 3D model (STL, 3MF, OBJ, PLY, GLB)… ⇧⌃3 · Export chemistry file (XYZ, MOL, SDF, PDB, CIF)… ⇧⌃X · Exit ⌃Q
- [x] **Molecule**: Explorer… ⌃L · From SMILES… ⇧⌃M · Import structure file (MOL/SDF/PDB/CIF)… ·
      Copy SMILES of structure ("(needs RDKit)" until MinimalLib has loaded) · Properties… ⌃I ·
      the 40 molecule families (696 molecules) · Classic 3D models ▸ 4 families
- [x] **Crystal**: Crystal builder… ⇧⌃C · Surface builder… ⇧⌃F · Graphene, nanotubes & fullerenes… ⇧⌃G ·
      Add molecule to surface… ⇧⌃A · 6 crystal families (122) · Surfaces ▸ (builder + 4 groups, 60) ·
      Graphene, nanotubes & fullerenes ▸ (builder + 3 groups, 30) · Classic crystal models ▸ ·
      Stack unit cells… ⌃U · Coordination polyhedra ✓ · Colour legend ✓ · Unit cell outline ✓ ·
      Reset cell tilts · Reset colours
- [x] **Polymer**: Polymer builder… ⇧⌃P · 5 families (40)
- [x] **Reaction**: Reaction builder… ⌃R · Classic reactions (36)
- [x] **Structure**: Flatten 3D → 2D sketch · Build 3D from 2D sketch ⌃B · Clear 2D sketch ·
      2D representation ▸ Skeletal / Structural formula / Lewis structure / Condensed formula
- [~] **View**: Theme ▸ — KherveOS has one theme (Kherve Green), shown checked and disabled ·
      3D renderer ▸ OpenGL (shaded spheres, smooth edges) / Classic (vector drawing) · 3D style ▸
      Ball & stick / Space filling / Sticks · Unit cell outline ✓ · Show 3D View · Show 2D Sketch ·
      Structure ✓ · Library ✓ · My molecules ✓ · Periodic table… ⌃T
- [~] **AI**: Connect to Claude (MCP)… — the KherveOS MCP server instead of the desktop's local bridge
      (dialog → KherveAI or Settings › AI & MCP) · AI Chat (needs an API key) ⌃/ ✓
- [~] **Help**: User Guide F1 (the desktop's guide text) · Check for Updates… (explains that KherveOS
      updates it) · Update Automatically (checked, disabled) · About KherveMol
- [x] Long submenus scroll (the desktop's `menu-scrollable`).

## 3D View (viewer3d.py, glview.py, glshaders.py)

- [x] View row: "View:" Front · Back · Left · Right · Top · Bottom · Isometric (view-cube icons with
      the face shaded) · Reset zoom
- [x] OpenGL renderer on WebGL 2 with the desktop's shaders ported line by line (impostor spheres and
      cylinders, key+fill light, specular, fresnel rim, fog, alpha-to-coverage MSAA, gradient
      background, selection halos, dashed orange tilt-cell rings, translucent polyhedra, cell edges and
      dashed diagonals); overlay labels, reaction notes (text + arrows) and the colour legend strip.
      The scene layout is `glview.Scene` ported and checked against the desktop (tests).
- [x] Classic renderer: `model._model` specs ported (checked against the desktop), painted like
      `render.py`; selection rings; frozen layout while dragging. Automatic fall-back when WebGL fails.
- [x] Status line under the view (selection, valence, why a bond is refused, live bond lengths,
      lattice parameters, film stage, adsorbate pose…), the desktop's wording.
- [x] Bond row: "Bond length:" / "Atom spacing:" slider (80–300 / 0–300) · Style combo (GL only) ·
      Labels · Lock lengths
- [x] Palette row: "Add atom:" H C N O F P S Cl Br I (CPK buttons) · Table · <el> · Bond: single/double/triple ·
      Bond selected · Delete atom
- [x] Colour row: Atom colour… (colour picker) · Reset colours · Legend · Polyhedra · Cell outline
- [x] Crystal row (stackable crystals): Supercell a×b×c (1–12) · Tilt cell x/y/z (±180°, step 5) · Reset tilts
- [x] Film row (reactions): ▶ Animate/⏸ Pause · ■ Equation · scrub slider · 0.5×/1×/2× · Loop;
      a library reaction plays once on load.
- [x] Surface row: On the surface: molecule combo · Move (Å)/Turn (°) · step · X−X+Y−Y+Z−Z+
      (Roll/Tilt/Turn ±) · Add molecule… · Remove
Mouse and keys:
- [x] drag background = orbit · wheel = zoom (0.2–8×) · click atom = select · Ctrl/⌘+click = add to
      the selection · click empty = clear · drag atom = move it (bond lengths held when locked) ·
      drag a surface molecule = slide (Shift = lift) · Tab / Shift+Tab step the selection · Esc cancels
      "Select an atom on screen…" · Delete/Backspace deletes the selected atom
- [x] Right-click: bond menu (Single/Double/Triple valence-gated, Delete bond), atom menu (Bond on /
      Double- / Triple-bond on ▸ elements, the table element, Select an atom on screen…; Bond Xn–Ym;
      Delete atom), View from ▸, Reset zoom, Toggle labels, crystal section (Stack unit cells…, Atom
      colour…, Tilt cell ▸ 15° about x/y/z / Straighten, polyhedra, legend, reset colours/tilts), Lock bond
      lengths, Add X atom, Delete selected atom, Properties…, Copy SMILES, Flatten to 2D sketch,
      Export PNG…, Export SVG…
- [x] Drop a Library / My molecules row on the view: merged as a second fragment (or replaces).

## 2D Sketch (editor2d.py, molrepr.py)

- [x] Row: Draw · Move · Atom · Erase · Element combo · All labels · Show as: (4 modes) · Clear
- [x] Skeletal drawing: line bonds, double/triple parallels, implicit C, CPK heteroatom labels with a
      white halo, implicit H; structural, Lewis (lone-pair dots, desktop placement — tested), condensed.
- [x] Tools: Draw (atom→atom bond / atom→empty new atom at 46 px snapped to 30° / click empty = lone atom /
      click bond = cycle order, valence-capped), Move (whole fragment), Atom (re-label), Erase (atom or
      bond); valence refusals reported; Lewis/condensed are read-only.
- [x] ±2000 sheet with scroll bars, wheel zoom, centred on content on load.
- [x] Status line "n atoms, m bonds [formula]" (implicit H counted).
- [x] Right-click: Build 3D from this sketch · Refresh 2D from 3D model · Tool ▸ · Show as ▸ ·
      Toggle all labels · Clear sketch · Export PNG… · Export SVG…
- [x] Drop a library row: placed where dropped (2D depiction).
- [x] The sketch mirrors the 3D structure until edited by hand (`_sketch_dirty`).

## Docks

- [x] Structure: Atom / Bond / Length / Angle columns, molecule root row, nested by the desktop's
      walk (diameter root, backbone at one indent, ring closures as "↻ closes ring to…" leaves — tested
      against the desktop), CPK chips, tooltips (Z, weight, valence, coordinates, ideal length),
      two-way selection, drag a row onto another to re-bond it (impossible drops refused).
- [x] Library: the 7 sections (first six expanded), bold families, CPK/kind chips, SMILES tooltips,
      double-click/Enter loads, rows drag onto both views.
- [x] My molecules: hint, list "name    formula", Keep current molecule, Load, Rename, ↑, ↓, Delete,
      Use in a reaction…, double-click loads, rows drag onto the views.
- [x] Periodic table: all 118 (f-block below, 57-71 / 89-103 markers), CPK cells, active element
      header "X — Name  Z = n, valence v"; sets the active element of both views.
- [~] AI Chat: provider · model line, ⚙ settings, Clear, log, Enter to send / Shift+Enter newline,
      SMILES replies built in 3D + 2D. Calls go straight from the browser to the provider (keys in this
      browser only), like KherveBook's port.

## Dialogs

- [x] Crystal builder (crystal, cells a b c, faces in every cell, doping host→dopant fraction seed, live summary)
- [x] Surface builder (crystal, plane (hkl), automatic size, surface cells u v, layers, termination,
      whole polyhedra, doping, Add on top / kept / SMILES / orientation / placement / first free spot)
- [x] Add a molecule to the surface
- [x] Graphene, nanotubes & fullerenes (7 structures, rows shown per structure, nanotube summary)
- [x] Polymer builder (40 presets + custom unit, end caps, n, live check)
- [x] Reaction builder (examples, equation, My molecules + Reactant / + Product / New, balance, report)
- [x] Molecule Explorer (search, tree, preview, info, Build in 3D)
- [x] Molecule properties (table)
- [x] Stack unit cells
- [x] Export 3D model (format, style, size mm/Å with dimensions, quality, thinnest bond, cell, ASCII STL)
- [x] User Guide (the desktop's text) · About KherveMol (KMol mark)
- [x] AI Chat Settings (provider, model + refresh, key, base URL, how to get a key)
- [~] File dialogs are the KherveOS ones (the drive), Build from SMILES / Keep / Rename use the
      KherveOS prompt.

## Shortcuts

- [x] ⌃N ⌃O ⌃S ⇧⌃S ⌃E ⇧⌃E ⇧⌃3 ⇧⌃X ⌃Q ⌃L ⇧⌃M ⌃I ⇧⌃C ⇧⌃F ⇧⌃G ⇧⌃A ⌃U ⇧⌃P ⌃R ⌃B ⌃T ⌃/ F1
      (⌘ on a Mac). Some are taken by the browser itself (⌘N, ⌘T, ⌘W, ⌘Q); the menu items always work.

## KherveOS

- [x] Registered (Science), official icon, file types `.kmol .mol .sdf .pdb .xyz .cif` (Files opens them).
- [x] Examples (11 `.kmol` + caffeine .xyz/.mol/.sdf/.pdb + rutile .cif) copied once to
      `~/Documents/KherveMol Examples`.
- [x] AI tools `khervemol_*` (15, ≤ 6 arguments) for KherveAI and MCP, as the desktop's MCP tools.

## Not ported

- [ ] The desktop's own MCP bridge/server and its host-config writer (KherveOS has its MCP server).
- [ ] The git auto-updater (KherveOS updates the app).
- [ ] Theme choice (one KherveOS theme).
- [ ] RDKit's 3D embedding (ETKDG + MMFF) — the built-in embedder is used, as on a desktop without RDKit.
