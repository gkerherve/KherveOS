# KherveOS

The Ktools desktop (Kherve Tools), running in your browser: a macOS-style menu bar and
Dock, windows, a file system, a terminal with Python, notebooks, a browser,
messages, email and games, all in one web page.

**An OS for the people: free, open source, made to help.** KherveOS is free
software under the GNU GPL v3, like the rest of Ktools.

One look for everyone: dark black and green ("Kherve Green"). The wallpaper is the
**Ktools – Advanced Tech Lab**: a lab of machines under the Ꝃ emblem (the Breton barred
K, "ker"), with a raised fist. App icons are the classic, bright Ktools ones ("KFiles",
"KTerm", "KBook"…).

## Start it

```bash
npm install                # once
npm run server:setup       # once: creates server/.venv for the KherveOS server
npm run dev:all            # starts the OS (http://localhost:5173) and the server
```

Then open <http://localhost:5173>.

`npm run dev` starts only the OS. Files, Notepad, Terminal, KherveBook, Browser,
Viewer and Settings work without the server. Messages, Email and the games need it.

## Make it feel like a real OS

- **Full screen:** click ⤢ in the menu bar (or Ꝃ › Enter Full Screen). Hold Esc to leave.
- **Install it as an app:** in Chrome or Edge use the install icon in the address bar
  (or ⋮ › Cast, save and share › Install page as app…); in Safari on macOS use File › Add to Dock.
  KherveOS then opens in its own window without browser tabs, and sits in your Dock and Launchpad.
- **Files from your computer:** drag them onto the KherveOS desktop or a Files window to copy them
  in, or onto an app's window to open them there. In Chrome/Edge you can drag a file from Files or the desktop
  out to your computer's desktop.

## What's inside

| App | What it does |
|---|---|
| **Files** | The drive: list/icon views, drag-and-drop, upload/download to your computer |
| **Notepad** | Text, Markdown, Python, JSON… with syntax colouring, find/replace |
| **Terminal** | A shell over the drive (`ls`, `cd`, `grep`, `python`, `pip install`…) |
| **KherveBook** | Notebooks with Python, Markdown and LaTeX cells — `.kbook` files shared with the desktop KherveBook |
| **Browser** | Tabs and an address bar. Pages are sandboxed iframes, so sites that forbid embedding (Google, GitHub…) open in a real tab instead |
| **Messages** | Real-time chat between people with accounts on the same KherveOS server |
| **Email** | Your own mailboxes (Gmail, iCloud, Fastmail… with app passwords, or any IMAP/SMTP server) through the server |
| **Viewer** | Pictures and PDFs |
| **Settings** | Wallpaper visibility, the Dock, storage, server and account, AI & MCP |
| **Games** | PlanetCraft, SimAI and FaceCraft, each run by its own server from the sibling folders |

Your files live in this browser (IndexedDB), on this computer. Nothing is
uploaded unless you use Messages or Email.

## How it works

```
src/
  os/            the "kernel": everything apps use — import { os } from '@/os'
    vfs.ts         virtual file system (IndexedDB, mirrored in memory, change events)
    windows.ts     window manager state
    registry.ts    the list of apps (lazy-loaded)
    overlays.tsx   dialogs (alert/confirm/choose/prompt/open/save), notifications, context menus
    python/        Pyodide (CPython 3.14 in WebAssembly) in a Web Worker, one per app window
    server.ts      talking to the KherveOS server: api(), sign-in, live events
    themes.ts      themes → CSS variables: KherveOS's own (themes.extra.ts) + the 24 Kherve
                   themes (themes.data.ts, generated from KherveTeX); per-window light override
    ui/            shared components: CodeEditor, MenuBar, FileDialog, ServerGate
  shell/         desktop, menu bar (TopBar), Dock, Launchpad, window frames
  apps/<app>/    one folder per app
server/          the KherveOS server (Python, FastAPI): accounts, Messages, Email bridge, game launcher
```

**Python** runs in the browser via [Pyodide](https://pyodide.org). The first
start downloads it (~10 MB) from cdn.jsdelivr.net; the browser caches it.
numpy, scipy, pandas, matplotlib, scikit-learn, sympy, h5py and more load on
import; pure-Python PyPI packages install with `pip install` / `%pip install`.
`/home/user` is kept in sync both ways between Python and the drive.

**The server** (`server/`, port 8787) is only needed for things that involve
other people or machines. Vite proxies `/api` to it, so the OS and the server
share one origin and the HttpOnly session cookie just works. Data lives in
`server/data/` (SQLite database; the key that encrypts stored email passwords).
Environment variables: `KHERVEOS_HOST`, `KHERVEOS_PORT`, `KHERVEOS_DATA`,
`KHERVEOS_GAMES_DIR`.

## AI and MCP: Claude controls KherveOS

Every AI in KherveOS uses one set of tools: KherveAI, and Claude Code, Claude
Desktop, ChatGPT… over MCP (`/mcp` on the server, relayed to your open KherveOS
tab; Settings › AI & MCP gives the one-line setup for each). The OS tools
(`src/os/ai/tools.ts`) handle files, Python, `list_apps`, `open_app`,
`list_windows`, `arrange_window`, `close_window` and `take_screenshot` for any
app. Each app also has its own tools, `<app>_<action>` (`khervesheet_set_cells`,
`email_send`, `terminal_run_command`, `tetris_get_state`…): their specs are in
`src/os/ai/appManifest.ts` and `src/os/ai/manifests/`, their code in the app
(`useAppTools(win, …)`). They are always listed; calling one opens the app if
needed. KherveOS asks you before files are deleted or replaced, mail or
messages are sent, Terminal commands run or AI-written Python runs.

## Adding an app

1. Create `src/apps/myapp/MyApp.tsx` with a default export taking `{ win, args }: AppProps`.
2. Add an entry to `APPS` in `src/os/registry.ts` (name, icon, colour, file types…).
3. Put its menus in the top menu bar with `win.setMenus([...])` (the OS adds Window and Help).
4. Give it AI tools: a tool set in `src/os/ai/manifests/` (or `appManifest.ts`) and
   `useAppTools(win, {...})` in the app; `tools/tests/mcp-tools.test.ts` fails until it has one.
5. Style it with the theme variables (`--k-bg`, `--k-text`, `--k-accent`…) and the shared
   `k-*` classes in `src/styles/global.css`, so it works with every theme.

The wallpaper lives in `public/wallpapers/`.

## Tests

```bash
npm run typecheck
node --test tools/tests/*.test.ts tools/tests/*.test.mjs
cd server && .venv/bin/python -m pytest -q
```

## Roadmap

1. ✅ The OS, Files, Notepad, Terminal, KherveBook, Browser, Messages, Email, Viewer, games
2. PDF and Git services → KhervePDF (MuPDF.js), KherveRef, KhervePY
3. A LaTeX service → KherveTeX, KherveNote, KherveSlide
4. KherveSheet, KhervePaint, KherveFitting
5. KherveLAB (on the server), the pygame mini-games from KherveFitting

## Licence

GNU General Public License v3 — see `LICENSE`. Free to use, study, share and improve.

## KherveOS as a Mac app

`tools/macos/build_app.sh` builds **KherveOS.app** (KherveOS in its own window, with
its icon) and installs it in `~/Applications`. Opening it starts the KherveOS server
and front end from this folder when they are not running, and quitting stops them.
Its drive (the files in KherveOS) is its own, separate from a browser's.
