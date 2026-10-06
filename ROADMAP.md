# KherveOS roadmap

The plan for bringing every Ktools desktop app into KherveOS, and where it
stands. **Any session continuing the work starts here** (then CLAUDE.md).

## How to work

- Repo: `~/Documents/PycharmProjects/KherveOS`, branch **`dev`** (push to `origin dev`;
  `main` only gets releases). Commit per finished piece; end messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The desktop apps live next to KherveOS in `~/Documents/PycharmProjects/<App>`.
  **Always use their `dev` branch** (KherveFitting: `develop`; khervePY has no `dev`:
  use its default branch). Do **not** switch or modify the user's checkouts: read
  the dev branch with `git -C ../<App> fetch` then
  `git -C ../<App> archive origin/dev | tar -x -C <scratch dir>`.
- Each app's own `CLAUDE.md`/`README.md` describes it. Port the behaviour and the
  look; keep its file formats compatible with the desktop app.
- Big ports: hand one app per sub-agent with the app's dev source as reference, only
  its own folder `src/apps/<app>/` (+ a server module if needed), then test it
  yourself in the browser and commit.
- Verify every piece: `npm run typecheck`, `cd server && .venv/bin/python -m pytest -q`,
  and in the built-in browser (launch configs "KherveOS" and "KherveOS server").
- Register each new app in `src/os/registry.ts` with its official Ktools icon
  (`image: '/icons/apps/<app>.png'` — already copied for 15 apps — and a `brand`).

### The look the user chose (do not change)

One theme only: dark, black + green ("Kherve Green") — no theme/style choices.
White classic Mac OS X menu bar (white, darker only at the very bottom, green
highlight); modern macOS frosted Dock with full fisheye magnification; flat window
title bars; translucent Terminal; classic bright Ktools icons. Wallpaper: the
user's green Ktools fist. Message: "an OS for the people — free, open source".
Rejected: grunge or dark-glass icons, 3D window title bars, 3D dock shelf,
red/brown accents, communist imagery.

## Stages

### 1. The OS and the basics — done 2026-10-06
Shell, Files, Notepad, Terminal, Viewer, Settings, Browser, Messages, Email,
games launcher (PlanetCraft, SimAI, FaceCraft), Python in the browser, server.

Still open in stage 1:
- [ ] **KherveBook parity** with the desktop app (`../KherveBook`, dev): layout,
      toolbars, Files + AI Chat panels, Examples menu (181 notebooks already exported
      to `public/examples/khervebook/` by `tools/export_khervebook_examples.py`),
      sheet, SVG and JavaScript cells, live loops ("runs continuously"), np/plt/pd
      preloaded. A sub-agent was working on it on 2026-10-06 — check
      `src/apps/khervebook/` and finish/test it.

### 2. PDF and Git services → KhervePDF, KherveRef, KhervePY
- [ ] PDF service: MuPDF.js (npm `mupdf`, AGPL like the PyMuPDF the desktop apps
      use) in a worker — render, text, search, annotations, page operations, forms.
- [ ] Git service: isomorphic-git over the virtual drive; GitHub through a small
      CORS proxy on the KherveOS server.
- [ ] KhervePDF (`../KhervePDF`)
- [ ] KherveRef (`../KherveRef`) — metadata from Crossref/arXiv/OpenLibrary (proxy
      through the server where CORS blocks), BibLaTeX export
- [ ] KhervePY (`../khervePY`) — CodeMirror editor, Pyodide run, Git panel

### 3. LaTeX service → KherveTeX, KherveNote, KherveSlide
- [ ] LaTeX compile on the KherveOS server (`tectonic`, as the desktop apps use),
      endpoint `/api/latex/compile`; WASM engine later for offline
- [ ] KherveTeX (`../KherveTeX`, package `khervedoc`)
- [ ] KherveNote (`../KherveNote`) — transcription later (Whisper on WebGPU)
- [ ] KherveSlide (`../KherveSlide`)

### 4. KherveSheet, KhervePaint, KherveFitting
- [ ] KherveSheet (`../KherveSheet`, dev) — grid, `=PY` cells in Pyodide, charts
- [ ] KhervePaint (`../KhervePaint`) — raster + vector canvas
- [ ] KherveFitting (`../KherveFitting`, develop) — first extract a wx-free fitting
      core (`Peak_Functions.py`, backgrounds, file readers) to run in Pyodide, then the
      web UI (spectrum plot, peak table, fit)

### 5. KherveLAB and the mini-games
- [ ] KherveLAB (`../KherveLAB`) — instrument booking as a KherveOS server module
- [ ] The pygame mini-games in `KherveFitting/libraries/Games` (pygame-ce runs in
      Pyodide, needs an async main loop) or TypeScript ports

### Later
- Email bridge: block private addresses and rate-limit account tests before sharing
  a server. Messages: unread badge on the Dock icon. Deployment.

## Log
- 2026-10-06 — Stage 1 built and pushed; KherveBook examples exported; theme
  settled (black + green).
