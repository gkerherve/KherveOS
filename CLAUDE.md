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
(`win.setMenus`), a Dock (`Dock.tsx`), Launchpad, traffic-light window buttons. Default theme
"Kherve Red" (dark) with "Kherve Paper" as its light companion (`src/os/themes.extra.ts`).
Apps listed in Settings › "Light apps in dark mode" get light theme variables scoped to their
window (`useWindowTheme`, `data-dark="0"` on the window). Wallpapers: `public/wallpapers/ktool-fist.webp`
(the user's own image), its green twin `ktool-fist-green.webp` (the default; `tools/recolor_wallpaper.py`), and "Together" — people
holding hands around the emblem (`tools/make_wallpaper.py`). Message to convey: an OS for the people —
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
