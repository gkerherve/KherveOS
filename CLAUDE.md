# KherveOS — notes for Claude

KherveOS is free software (GPL-3.0, like the other Kherve apps): "an OS for the people".

A browser OS hosting the Kherve Tools as apps. React 19 + TypeScript 6 + Vite 8
+ zustand + lucide-react; Python in the browser via Pyodide; a small FastAPI
server in `server/`. See README.md for the layout.

## Commands

- `npm run dev` — OS on http://localhost:5173 (`npm run dev:all` also starts the server)
- `npm run server` — server on :8787 (`npm run server:setup` once to create server/.venv)
- `npm run typecheck` — must stay at zero errors
- `cd server && .venv/bin/python -m pytest -q` — server tests
- In dev, the browser console has `kherveos.os`, `kherveos.fs`, `kherveos.windows` for poking at the OS.

## Look

macOS-flavoured: thin menu bar (`src/shell/TopBar.tsx`) showing the focused app's menus
(`win.setMenus`), a Dock (`Dock.tsx`), Launchpad, traffic-light window buttons. One theme,
"Kherve Green" (dark black + green, `src/os/themes.extra.ts`): no theme or style choices.
One wallpaper, `public/wallpapers/ktools-tech-lab.webp`: the user's "Ktools – Advanced Tech Lab"
artwork, with a fading floor reflection added below so its caption clears the Dock; Settings
only sets how strongly it shows. Message to convey: an OS for the people —
free, open source, helping people. Avoid communist imagery (stars, hammer & sickle, propaganda styling). The logo (`src/shell/KLogo.tsx`, `public/kherveos.svg`) is the ringed Ꝃ from that image.

## Conventions

- Apps live in `src/apps/<app>/`, default-export a component taking `{ win, args }: AppProps`,
  and are registered in `src/os/registry.ts`. Apps only talk to the OS through `@/os`
  (`os.open`, `os.openFile`, `os.fs`, `os.dialog.*` incl. `choose`, `os.notify`, `os.contextMenu`…)
  and their `win` (`setTitle`, `setMenus`, `setCloseGuard`, `close`).
- Colours: only the theme CSS variables (`--k-bg`, `--k-surface`, `--k-chrome`, `--k-text`,
  `--k-muted`, `--k-accent`, `--k-accent-text`, `--k-border`, `--k-button(-hover)`, `--k-selection`,
  `--k-alt`, `--k-link`, `--k-danger/success/warning`). Every screen must work in the 24 themes.
  Shared classes `k-app`, `k-toolbar`, `k-statusbar`, `k-btn`, `k-icon-btn`, `k-input`… are in
  `src/styles/global.css`. App CSS uses an app prefix (`fm-`, `np-`, `nb-`, `term-`, `br-`, `msg-`, `mail-`, `st-`, `vw-`, `game-`).
- `src/os/themes.data.ts` is generated from `../KherveTeX/khervedoc/themes.py` — regenerate, don't hand-edit.
- tsconfig has `erasableSyntaxOnly` (no enums / parameter properties / namespaces) and `verbatimModuleSyntax` (`import type`).
- `.kbook` files must stay compatible with the desktop KherveBook (`{"format": "kbook", "version": 1, "cells": [{type, source}]}`).

## AI tools and MCP

- One tool list for every AI: core tools in `src/os/ai/tools.ts` (files, Python, `open_app`, `list_windows`,
  `arrange_window`, `close_window`…) + app tools `<app>_<action>` (specs in `src/os/ai/appManifest.ts` and
  `src/os/ai/manifests/*.ts`, code in the app via `useAppTools(win, …)`; a call opens the app if needed).
- MCP: `mcpBridge.ts` sends `toMcpTools(allTools())` (`mcpCore.ts`) over `/api/ws`; `server/kherveos_server/mcp_server.py`
  serves `/mcp` (per-user bearer token) and keeps the last list for when no tab is open. Limits there: `MAX_TOOLS`, `MAX_TOOLS_JSON`.
- Every registry app must have a tool set (`tools/tests/mcp-tools.test.ts`); ≤ 6 args per tool. Sending mail/messages,
  Terminal commands and anything destructive call `ctx.confirm(…)` first.
- Tests: `node --test tools/tests/*.test.ts tools/tests/*.test.mjs`.

## Gotchas

- Windows are rendered in creation order and stacked with z-index; never re-order them in the DOM
  (moving an iframe reloads it). While dragging, `body.k-dragging` disables iframe pointer events.
- React StrictMode is deliberately off: it double-starts Python workers and websockets in dev.
- Python: one Pyodide worker per app window (`new PythonKernel(name)`); dispose it on unmount.
  The VFS home folder is mirrored into the worker before each run and changes come back after.
  `input()` is not supported (no SharedArrayBuffer: cross-origin isolation would break the Browser's iframes).
- The server's `/api/ws` websocket carries live events (`hub.publish(user_ids, event)` on the server,
  `realtime.on(type, fn)` in the browser). Feature modules register their tables with `db.register_schema`.
- Games run their own servers (PlanetCraft 8123, SimAI 8137, FaceCraft 8140) because their pages use
  absolute `/api/...` paths; `server/kherveos_server/games.py` whitelists and starts them (system `python3`).

## Technique apps (KherveTGA, KherveBET, … from KherveFitting-AI)

Each technique of the desktop KherveFitting-AI (`../KherveFittingPro`, dev-AI) is an app of its own
on one base, `src/apps/khervetech/`: the desktop main window in that technique's mode (slim toolbar +
technique button + section tiles, vertical plot toolbar, plot, TechniqueOverview right frame, menus
from `khervefitting/menus.ts`). The desktop's Python runs **unchanged** in Pyodide:
`public/apps/khervetech/py/desktop/` (copied by `tools/export_khervetech.py`; never hand-edit),
under a headless wx (`py/shims/wx`, serialised widget trees drawn by `WxUI.tsx`) and a recording
matplotlib (`py/shims/matplotlib`, figures drawn by `FigurePlot.tsx`); `py/ktech/` is the stand-in
MyFrame (`frame.py`), the request bridge (`bridge.py`, KherveFitting's `FitBridge` with a config)
and the AI driver (`project.py drive`). Modal wx dialogs replay: `ShowModal` raises `NeedModal`,
the page asks, the request is sent again with `answers`.

To add a technique (FTIR, Raman, UV-Vis, XRD, XAS, EELS…):
1. `tools/export_khervetech.py` → `TECHNIQUES`: its modules (Import + ToolsMenu files), icon, example
   folder (or a `make_<tech>_examples` generator); run it (copies the code, makes
   `public/icons/apps/kherve<tech>.png`, `public/examples/kherve<tech>/`, `py/files.json`).
2. `py/ktech/techniques.py` → `TECHS`: the File > Import entries (desktop functions), `open_paths`,
   the analysis window's openers, `window_attr` / `windows`, `extras` (its `draw_<tech>_extras`).
   If its code needs a wx widget, a matplotlib call or a desktop module the shims lack, add it there
   (the error names it), not in the desktop copy; NumPy-2 gaps go in `ktech/compat.py`.
3. `src/apps/khervetech/spec.ts` → `TECH_APPS`; `src/apps/kherve<tech>/Kherve<Tech>.tsx` (3 lines, see
   khervetga) and `actions.ts` (AI `run` actions: the window's control attributes and handlers).
4. Registry entry (group Science, `image: '/icons/apps/kherve<tech>.png'`, `fileTypes: ['.kfit', …]`),
   `src/os/ai/manifests/kherve<tech>.ts` via `techniqueToolSet`, pushed in `appManifest.ts`.
5. Tests: add the technique to `src/apps/khervetech/tests/engine.test.mjs` (real Pyodide:
   `KHERVEOS_PYODIDE=…/pyodide/pyodide.mjs node --test src/apps/khervetech/tests/*.mjs`) and its
   actions to `logic.test.mjs`; checklist `docs/parity/kherve<tech>.md`.
