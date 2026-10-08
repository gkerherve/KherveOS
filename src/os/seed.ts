// The files a brand-new KherveOS drive starts with.

import { HOME } from './path'

export interface SeedItem {
  path: string
  dir?: boolean
  content?: string | Uint8Array
}

const WELCOME = `Welcome to KherveOS
===================

An OS for the people — free, open source, made to help.

KherveOS is the Ktools desktop, running entirely in your browser:
nothing to install, your files stay on your computer, and the code is free
software (GNU GPL v3) that anyone can use, study, share and improve.

  • Files        — your drive. Everything is saved in this browser.
                   Use Upload / Download to move files to and from your computer.
  • Notepad      — plain text, Markdown, Python, JSON…
  • Terminal     — a shell over your drive. Type "help". "python" starts Python.
  • kBook   — notebooks with Python, Markdown and LaTeX cells.
                   numpy, scipy, pandas and matplotlib load on demand.
  • Browser      — browse the web inside KherveOS.
  • Messages     — chat with other people on your KherveOS server.
  • Email        — your mailbox (IMAP/SMTP), through the KherveOS server.
  • Games        — PlanetCraft, SimAI and FaceCraft.

Tips
  • The Dock at the bottom opens apps; the grid icon (Launchpad) shows them all, with search.
  • The menu bar at the top shows the menus of the app in front. The Ꝃ menu has Settings.
  • Double-click a file to open it; right-click for more.
  • Drag a window to the screen edge to snap it; double-click its title bar to zoom.
  • Settings › Appearance: how strongly the wallpaper shows, and the Dock's magnification.
`

const HELLO_PY = `"""A small example — run it from the Terminal with:  python hello.py"""

import math
import sys

print(f"Hello from Python {sys.version.split()[0]} running in your browser!")
for n in range(1, 6):
    print(f"{n:>2}! = {math.factorial(n):>4}")
`

const NOTEBOOK = JSON.stringify(
  {
    format: 'kbook',
    version: 1,
    cells: [
      {
        type: 'markdown',
        source:
          '# Getting started with KherveBook\n\nRun a cell with **Shift+Enter**. Python runs in your browser — the first run downloads the Python runtime (a few seconds), then it is cached.',
      },
      { type: 'code', source: 'import numpy as np\n\nx = np.linspace(0, 4 * np.pi, 400)\nx.mean(), x.std()' },
      {
        type: 'code',
        source:
          'import matplotlib.pyplot as plt\n\nplt.figure(figsize=(6, 3))\nplt.plot(x, np.sin(x), label="sin x")\nplt.plot(x, np.exp(-x / 4) * np.cos(3 * x), label="damped cos")\nplt.legend(); plt.xlabel("x"); plt.tight_layout()',
      },
      { type: 'latex', source: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
      { type: 'code', source: 'print("Variables persist between cells:", len(x), "points")' },
    ],
  },
  null,
  1,
)

export function seedFiles(): SeedItem[] {
  return [
    { path: `${HOME}/Desktop`, dir: true },
    { path: `${HOME}/Documents`, dir: true },
    { path: `${HOME}/Downloads`, dir: true },
    { path: `${HOME}/Notebooks`, dir: true },
    { path: `${HOME}/Pictures`, dir: true },
    { path: `${HOME}/Desktop/Welcome.txt`, content: WELCOME },
    { path: `${HOME}/Documents/hello.py`, content: HELLO_PY },
    { path: `${HOME}/Notebooks/Getting started.kbook`, content: NOTEBOOK },
  ]
}
