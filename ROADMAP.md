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
user's "Ktools – Advanced Tech Lab" picture, the only one (2026-10-07). Message: "an OS for the people — free, open source".
Rejected: grunge or dark-glass icons, 3D window title bars, 3D dock shelf,
red/brown accents, communist imagery.

## Stages

### 1. The OS and the basics — done 2026-10-06
Shell, Files, Notepad, Terminal, Viewer, Settings, Browser, Messages, Email,
games launcher (PlanetCraft, SimAI, FaceCraft), Python in the browser, server.

Still open in stage 1:
- [x] **KherveBook parity** with the desktop app (`../KherveBook`, dev): layout,
      toolbars, Files + AI Chat panels, Examples menu (181 notebooks exported to
      `public/examples/khervebook/` by `tools/export_khervebook_examples.py`), sheet,
      SVG and JavaScript cells, live loops, np/plt/pd preloaded — done 2026-10-07.

### AI — KherveAI and the MCP server (requested 2026-10-07)
- [x] Assistant app (from the "AI chatbox and Claude integration" session): Claude
      through the server's ANTHROPIC_API_KEY (`server/kherveos_server/ai.py`,
      `/api/ai/status`, `/api/ai/chat`), or Ollama; client `src/os/ai/index.ts`.
      Folded into KherveAI on 2026-10-07: without a key of one's own, KherveAI's Claude
      goes through the server's relay `/api/ai/anthropic/messages` (tools included);
      the Assistant app is removed.
- [x] KherveOS tool registry (`src/os/ai/tools.ts`): files, apps, windows, Python,
      notebooks — shared by KherveAI and MCP; delete/overwrite and AI-run Python need
      the user's OK — done 2026-10-07
- [x] KherveAI app: chat with Ollama (local; installed here with qwen3.5:4b,
      granite4:micro-h, phi4-mini), Claude, ChatGPT; tool calling so models act in KherveOS
      — done 2026-10-07. Next: picture/PDF attachments; Claude extended thinking.
- [x] MCP server (`server/kherveos_server/mcp_server.py`, `mcp` SDK) at
      http://localhost:8787/mcp with per-user tokens; tool calls relayed to the user's
      KherveOS tab over the websocket; Settings › AI & MCP shows how to connect Claude
      Code, Claude Desktop (mcp-remote) and ChatGPT (public tunnel + /mcp/t/<token>) —
      done 2026-10-07, tested with the official MCP client end to end. The local test
      server has a test account `kostest` (password only in that browser's localStorage).

### 2. PDF and Git services → KhervePDF, KherveRef, KhervePY

In progress (2026-10-07 00:00): sub-agents were building the PDF service +
KhervePDF, and the Git service + git CORS proxy + KhervePY. Libraries installed:
`mupdf`, `isomorphic-git`, `buffer`. App entries and server stubs exist
(`gitproxy.py`, `refs.py`). If their work is uncommitted, check it (typecheck,
tests, browser), finish it and commit. KherveRef comes after the PDF service.
- [x] PDF service: MuPDF.js (npm `mupdf`, AGPL like the PyMuPDF the desktop apps
      use) in a worker — render, text, search, annotations, page operations, forms —
      done 2026-10-07 (`src/os/services/pdf.ts`).
- [x] Git service: isomorphic-git over the virtual drive; GitHub through a small
      CORS proxy on the KherveOS server (`gitproxy.py`) — done 2026-10-07.
- [x] KhervePDF (`../KhervePDF`) — done 2026-10-07. Not ported: editing existing
      PDF text (no MuPDF.js equivalent of the PyMuPDF call), OCR, AI panel, KherveRef
      link, Git history, digital signatures.
- [ ] KherveRef (`../KherveRef`) — metadata from Crossref/arXiv/OpenLibrary (proxy
      through the server where CORS blocks), BibLaTeX export
- [x] KhervePY (`../khervePY`) — CodeMirror editor, Pyodide run, Git panel — done
      2026-10-07. Not ported: debugger, AI chat, the compact "cockpit" view, merge
      conflict resolution, cancelling a clone.

- [x] **KherveDB** (requested 2026-10-07; done 2026-10-07) — the
      NIST XPS binding-energy database with a periodic table. Port the React version
      `github.com/gkerherve/KherveDB-React` (Vite + React + TS; data
      `public/data/elements.json` + `nist.bin`; `platform.ts` picks Tauri or web: use the
      web path, links open in the KherveOS Browser or a new tab). Scope its CSS under the
      app's root class (global selectors clash, as `.nb-body` did in KherveBook). Icon
      `public/icons/apps/khervedb.png` is already there; group Science. The Python
      original is `github.com/gkerherve/KherveDB` (`Main.py`, wx).

### 3. LaTeX service → KherveTeX, KherveNote, KherveSlide

In progress (2026-10-07 00:00): a sub-agent was building the LaTeX service
(`server/kherveos_server/latex.py` with tectonic from Homebrew, client
`src/os/services/latex.ts`) and KherveTeX (TipTap + fflate installed).
- [x] LaTeX compile on the KherveOS server (`tectonic`, as the desktop apps use),
      endpoint `/api/latex/compile`, sandboxed (sandbox-exec / bubblewrap) — done
      2026-10-07; WASM engine later for offline
- [x] KherveTeX (`../KherveTeX`, package `khervedoc`) — done 2026-10-07. Not ported:
      drawing/flowchart/chemistry/equation-builder editors, Typst, Git history,
      .docx/.pdf/.md import, the KherveRef picker
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
- [x] **Little games** (requested 2026-10-07; Tetris, Breakout, Pinball done 2026-10-07) — each a
      small window (fixed size, like a classic Mac game), TypeScript + canvas, keyboard
      controls, high scores kept, the Ktools green look; group Games. Also the
      KherveFitting mini-games (`libraries/Games`: TetrisGame, Asteroid, Flappybird,
      Solitaire, MiniGame, ChemistryLab) as TypeScript ports in the same style.

### Requested 2026-10-07 (to do next)
- [ ] **Copy and paste of files**: Copy / Cut / Paste in Files and on the Desktop (menus,
      right-click, ⌘C/⌘X/⌘V). On this computer by default; when signed in, Copy also puts
      the files on the KherveOS server (per-user clipboard, size limit) so another computer
      signed in to the same account can Paste them. Plus a small card at the top right of
      the desktop explaining this (files stay on this computer; sign in to copy between
      computers), dismissible.
- [ ] **Gmail breaks the Email app** (user's own account, added 09:21; the server listed
      folders and INBOX fine). App crashes now reach the server log as `[crash]` lines
      (`server/kherveos_server/crashes.py`): read them, fix the cause.
- [x] Minimise like macOS (window flies into a Dock tile showing its picture), Applications
      in the Ꝃ menu, frosted see-through KApps menu — done 2026-10-07.
- [x] Wallpaper: the user's Tech Lab picture only, AI-upscaled 3× (Real-ESRGAN) — done.

### Later
- Email bridge: block private addresses and rate-limit account tests before sharing
  a server. Messages: unread badge on the Dock icon. Deployment.

## Log
- 2026-10-07 05:45 — Git service + KhervePY committed. Usage near the 5-hour limit
  (resets 07:10). Still running, UNCOMMITTED if interrupted: PDF service + KhervePDF
  (`src/os/services/pdf*.ts`, `src/apps/khervepdf/`), LaTeX + KherveTeX
  (`src/os/services/latex.ts`, `server/kherveos_server/latex.py`, `tests/test_latex.py`,
  `src/apps/khervetex/`), MCP + tool registry (`src/os/ai/tools.ts`, `mcpBridge.ts`,
  `server/kherveos_server/mcp_server.py`, `tests/test_mcp.py`; then app.py must mount it
  and Shell.tsx call `startMcpBridge()`), KherveAI (`src/apps/kherveai/`). Next: Stage 4
  (KherveSheet — reuse its Qt-free `khervesheet/core` in Pyodide, .ksheet is HDF5 via
  h5py; KhervePaint — .kpaint JSON + SVG; KherveFitting — wx-free core first).
- 2026-10-07 05:35 — KherveBook committed and checked in the browser (welcome notebook,
  plots, Examples menu, an XPS example); fixed its panel layout. Assistant committed.
  Agents still running: PDF+KhervePDF, Git+KhervePY, LaTeX+KherveTeX, MCP+tool
  registry, KherveAI.
- 2026-10-07 00:10 — Usage limit reached. Applications menu (Dock, bottom-left: Office /
  Science / Development / Internet / Tools / Games submenus) committed; its submenu fix
  (portal) is type-checked but not yet seen in the browser — check it first. The four
  sub-agents (KherveBook parity, PDF+KhervePDF, Git+KhervePY, LaTeX+KherveTeX) were
  stopped mid-work: their partial, UNCOMMITTED changes are in src/apps/khervebook,
  src/apps/khervepdf, src/apps/khervepy, src/apps/khervetex, src/os/services, and the
  server modules latex.py/gitproxy.py. Review, finish (or restart) and commit each.
- 2026-10-06 — Stage 1 built and pushed; KherveBook examples exported; theme
  settled (black + green).
