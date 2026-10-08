// KherveBook: the web edition of the desktop KherveBook (Python in a
// Pyodide worker; Markdown, LaTeX, sheet, SVG and JavaScript cells). It
// reads and writes the same .kbook files, imports and exports Jupyter
// .ipynb, and has the desktop's layout: two toolbar rows, the Files and AI
// Chat panels on the left, the cell column, and a status bar.

import './khervebook.css'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { LoaderCircle, X } from 'lucide-react'
import { os, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { basename, dirname, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import type { KernelStatus } from '@/os/python/kernel'
import { CellView } from './CellView'
import { CELL_TYPES, type Cell, type CellType } from './format'
import { Notebook, STARTING_NOTE, displayName, type After } from './notebook'
import { Explorer } from './Explorer'
import { AiChat, createChatSession } from './AiChat'
import { ToolRow, cellRow, mainRow } from './Toolbar'
import { loadExampleIndex, type ExampleIndex } from './examples'
import { DESKTOP_THEMES, clearRecent, desktopThemeVars, loadUiPrefs, recentFiles, saveUiPrefs, type UiPrefs } from './prefs'
import { DROPS_INTO } from './RichCells'
import { Mdi } from './mdi'
import { downloadLatest, showHistory, snapshotAndUpload } from './gitops'
import { useAppTools } from '@/os/ai/appTools'
import { bookAiTools } from './aiTools'

/** The desktop KherveBook release this web edition follows. */
export const KHERVEBOOK_VERSION = '0.1.137'
const ISSUES_URL = 'https://github.com/gkerherve/KherveBook/issues'

// ---------------------------------------------------------------- shortcuts

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)

function keyLabel(k: string, m: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): string {
  const name = k === 'Enter' ? (MAC ? '↵' : 'Enter') : k === 'ArrowUp' ? '↑' : k === 'ArrowDown' ? '↓' : k
  if (MAC) return `${m.alt ? '⌥' : ''}${m.shift ? '⇧' : ''}${m.mod ? '⌘' : ''}${name}`
  return [m.mod && 'Ctrl', m.alt && 'Alt', m.shift && 'Shift', name].filter(Boolean).join('+')
}

const KEYS = {
  new: keyLabel('N', { mod: true }),
  newWindow: keyLabel('N', { mod: true, shift: true }),
  open: keyLabel('O', { mod: true }),
  save: keyLabel('S', { mod: true }),
  saveAs: keyLabel('S', { mod: true, shift: true }),
  undo: keyLabel('Z', { mod: true }),
  redo: keyLabel('Z', { mod: true, shift: true }),
  run: keyLabel('Enter', { mod: true }),
  runNext: keyLabel('Enter', { shift: true }),
  runInsert: keyLabel('Enter', { alt: true }),
  runAll: keyLabel('Enter', { mod: true, shift: true }),
  addCode: keyLabel('C', { mod: true, shift: true }),
  addMd: keyLabel('M', { mod: true, shift: true }),
  addNote: keyLabel('E', { mod: true, shift: true }),
  restart: keyLabel('R', { mod: true, shift: true }),
  exit: keyLabel('Q', { mod: true }),
  addTex: keyLabel('L', { mod: true, shift: true }),
  addSheet: keyLabel('T', { mod: true, shift: true }),
  cutCell: keyLabel('X', { mod: true, shift: true }),
  copyCell: keyLabel('O', { mod: true, shift: true }),
  pasteCell: keyLabel('V', { mod: true, shift: true }),
  moveUp: keyLabel('ArrowUp', { mod: true, shift: true }),
  moveDown: keyLabel('ArrowDown', { mod: true, shift: true }),
  deleteCell: keyLabel('D', { mod: true, shift: true }),
  explorer: keyLabel('B', { mod: true }),
  ai: keyLabel('A', { mod: true, shift: true }),
  pageMode: keyLabel('P', { mod: true, shift: true }),
  comment: keyLabel('/', { mod: true }),
  find: keyLabel('F', { mod: true }),
  guide: 'F1',
}

function Kbd({ k }: { k: string }) {
  return <kbd>{k}</kbd>
}

function Shortcuts() {
  const groups: [string, [string, string][]][] = [
    [
      'Running',
      [
        [KEYS.runNext, 'Run the cell and go to the next one'],
        [KEYS.run, 'Run the cell in place'],
        [KEYS.runInsert, 'Run the cell and add a new one below'],
        [KEYS.runAll, 'Restart and run all'],
      ],
    ],
    [
      'Cells',
      [
        [`${KEYS.addCode} / ${KEYS.addMd} / ${KEYS.addNote}`, 'Add a code / Markdown / Note cell'],
        [`${KEYS.addTex} / ${KEYS.addSheet}`, 'Add a LaTeX / sheet cell'],
        [`${KEYS.cutCell} / ${KEYS.copyCell} / ${KEYS.pasteCell}`, 'Cut / copy / paste the cell'],
        [`${KEYS.moveUp} / ${KEYS.moveDown}`, 'Move the cell'],
        [KEYS.deleteCell, 'Delete the cell'],
        [`${KEYS.undo} / ${KEYS.redo}`, 'Undo / redo (text in the editor first, then cells)'],
        [KEYS.comment, 'Toggle a comment'],
        [KEYS.find, 'Find in the cell'],
        [KEYS.restart, 'Restart the kernel'],
      ],
    ],
    [
      'Command mode (press Esc in a cell) — web edition only',
      [
        ['Enter', 'Edit the selected cell'],
        ['↑  ↓', 'Select the cell above / below'],
        ['A  B', 'Add a code cell above / below'],
        ['Y  M  L', 'Make the cell Code / Markdown / LaTeX'],
        ['X  C  V', 'Cut / copy / paste the cell'],
        ['D D', 'Delete the cell'],
        ['Z', 'Undo'],
      ],
    ],
    [
      'Window',
      [
        [`${KEYS.save} / ${KEYS.saveAs}`, 'Save / save as'],
        [KEYS.open, 'Open'],
        [KEYS.explorer, 'File explorer'],
        [KEYS.ai, 'AI assistant'],
        [KEYS.pageMode, 'Page mode'],
        [KEYS.guide, 'User guide'],
      ],
    ],
  ]
  return (
    <div className="nb-keys">
      {groups.map(([title, rows]) => (
        <div key={title}>
          <h4>{title}</h4>
          <table>
            <tbody>
              {rows.map(([k, what]) => (
                <tr key={k + what}>
                  <td>
                    <Kbd k={k} />
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="nb-keys-note">Some shortcuts are kept by the browser itself (a new browser window, for example); the menus always work.</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** Help > User Guide (desktop userguide.py, for the web edition). */
function UserGuide() {
  return (
    <div className="nb-guide">
      <p>
        kBook is a computational notebook: one scrolling document that mixes runnable <b>Python</b>, formatted <b>Markdown</b>, typeset{' '}
        <b>LaTeX</b>, live <b>spreadsheets</b>, <b>drawings</b> and <b>JavaScript</b> pages. This is its web edition: Python runs in your browser, and
        notebooks are <code>.kbook</code> files on your KherveOS drive, shared with the desktop app.
      </p>
      <Section title="1. Cells — the building blocks">
        <p>A notebook is a column of cells. Each cell has a type, shown in its left gutter:</p>
        <ul>
          <li>
            <b>Code</b> (<code>In [n]:</code>) — runs Python.
          </li>
          <li>
            <b>Markdown</b> (<code>md</code>) — formatted notes; renders on run.
          </li>
          <li>
            <b>LaTeX</b> (<code>tex</code>) — an equation or a whole document.
          </li>
          <li>
            <b>Sheet</b> — an embedded spreadsheet with Python formulas.
          </li>
          <li>
            <b>SVG</b> — a vector drawing. <b>JavaScript</b> — an interactive page (D3, Plotly, canvas…).
          </li>
        </ul>
        <p>
          Change a cell's type with the toolbar drop-down or right-click → <b>Convert To</b>. Double-click a rendered cell to edit its source again.
          <b>Note</b> cells are a word-processor page with a pen; <b>File</b> cells hold attached files (<code>kf("name")</code> gives a code cell their
          path); <b>KFit</b> cells show a KherveFitting project (<code>kfit("C1s")</code>); <b>kTeX Doc</b> and <b>Molecule</b> cells show a kTeX
          document and a kMol molecule, edited in their own apps.
        </p>
      </Section>
      <Section title="2. Running cells">
        <ul>
          <li>
            <Kbd k={KEYS.runNext} /> runs the cell and moves to the next (a new code cell is added at the end). <Kbd k={KEYS.run} /> runs it in place.
          </li>
          <li>The green ▶ in a cell's gutter, or the toolbar's Run button, runs it.</li>
          <li>
            <b>Run All</b> restarts the kernel and runs every cell. <b>Run Continuously</b> (the ⟳ button, or right-click) re-runs a cell for live
            animations and simulations; the red ■ stops it. The orange ↺ restarts just that cell.
          </li>
        </ul>
        <p>
          Code cells share one kernel with <code>numpy</code> (<code>np</code>), <code>matplotlib</code> (<code>plt</code>) and <code>pandas</code> (
          <code>pd</code>) preloaded; <code>scipy</code>, <code>sympy</code> and <code>lmfit</code> load the first time a cell uses them. The first start
          downloads Python (about 10 MB, then cached). Install pure-Python packages with <code>%pip install name</code>.
        </p>
      </Section>
      <Section title="3. Markdown & LaTeX">
        <p>
          Markdown cells take standard Markdown with <code>$math$</code>; the second toolbar row has formatting buttons. A LaTeX cell holding a formula
          renders it; a document (<code>\section</code>, <code>\textbf</code>, lists, equations…) is laid out by a built-in renderer — the browser has no
          TeX engine, so complex packages are not typeset.
        </p>
      </Section>
      <Section title="4. Sheet cells & the Python ↔ sheet bridge">
        <ul>
          <li>
            Type a value, or an <code>=</code> formula in Python with A1 references and <code>A1:B5</code> ranges, e.g. <code>=np.pi * A2**2</code> or{' '}
            <code>=sum(B2:B4)</code>. Formulas see everything the kernel knows.
          </li>
          <li>Each grid is published to code cells as sheet1, sheet2, … — a list of rows, header first.</li>
          <li>
            <code>ks("A1")</code> reads a cell or range; <code>ks("A1", value)</code> writes a value back into the live sheet.
          </li>
          <li>Right-click → Create Plot charts the selection; several sheets per cell with the View menu. Paste tab-separated data from a spreadsheet.</li>
        </ul>
      </Section>
      <Section title="5. Files & drag-and-drop">
        <p>
          Drag a file from the Files panel (or from your computer) onto the notebook: <code>.py</code>, <code>.md</code>, <code>.tex</code>,{' '}
          <code>.csv</code>/<code>.tsv</code>, <code>.svg</code> and pictures become cells, a <code>.ipynb</code> adds its cells, a <code>.kbook</code>{' '}
          opens.
        </p>
      </Section>
      <Section title="6. Layout">
        <p>
          Right-click a cell to set a <b>title</b>, <b>collapse</b> it, or place it <b>beside the cell above</b>. Drag the grip under a cell to cap its
          height, or its right edge to set its width (double-click to reset). <b>Page Mode</b> hides the cell borders.
        </p>
      </Section>
      <Section title="7. Examples & the AI assistant">
        <p>
          The <b>Examples</b> menu has the desktop app's notebooks — opening one makes an untitled copy and runs it. The <b>AI Assistant</b> chats with
          Claude, ChatGPT, Mistral, Ollama or a local model; set the provider and key with the gear icon (keys stay in this browser).
        </p>
      </Section>
      <Section title="8. Saving & undo">
        <p>
          Notebooks save as <b>.kbook</b> (plain JSON, compatible with the desktop app); File → Export writes Jupyter/Colab <b>.ipynb</b>. Undo covers
          cell structure (add, delete, move, convert, cut, paste, sheet edits, AI edits); while typing in a cell, Undo first undoes the text.
        </p>
      </Section>
      <Section title="9. Keyboard shortcuts">
        <Shortcuts />
      </Section>
    </div>
  )
}

function About() {
  return (
    <div className="nb-about">
      <img className="nb-about-icon" src="/icons/apps/khervebook.png" alt="" width={64} height={64} onError={(e) => (e.currentTarget.style.display = 'none')} />
      <h2>
        <span className="nb-brand-k">Kherve</span>
        <span className="nb-brand-b">Book</span>
      </h2>
      <p className="k-muted">Web edition for KherveOS · follows the desktop kBook v{KHERVEBOOK_VERSION}</p>
      <p>
        A Jupyter-inspired computational notebook — runnable Python, Markdown, LaTeX, live spreadsheets, drawings and JavaScript pages in one document.
      </p>
      <p>
        <b>Created by Gwilherm Kerherve</b>
        <br />
        Part of the Kherve family of scientific apps. Python runs in your browser with Pyodide.
      </p>
      <p className="k-muted">Licensed under the GNU GPL v3.0.</p>
    </div>
  )
}

// -------------------------------------------------------------- the kernel

const STATUS_LABEL: Record<KernelStatus, string> = { off: 'off', starting: 'starting…', idle: 'idle', busy: 'busy', dead: 'stopped' }

function KernelPill({ status, version, pyodide, onStart }: { status: KernelStatus; version: string | null; pyodide: string | null; onStart: () => void }) {
  const startable = status === 'off' || status === 'dead'
  const title =
    status === 'off'
      ? 'Python starts when you run a cell (the first start downloads about 10 MB). Click to start it now.'
      : status === 'starting'
        ? STARTING_NOTE
        : status === 'dead'
          ? 'Python stopped. Click to start it again.'
          : `Python ${version ?? ''}${pyodide ? ` (Pyodide ${pyodide})` : ''}, ${status}`
  return (
    <button className={`nb-kernel ${status}${startable ? ' startable' : ''}`} title={title} onClick={startable ? onStart : undefined}>
      <span className="nb-kernel-dot" />
      <span>Python{version ? ` ${version}` : ''}</span>
      <span className="nb-kernel-state">{STATUS_LABEL[status]}</span>
    </button>
  )
}

/** Toolbar and menu buttons must not take the focus away from the cell being edited. */
function keepFocus(e: { target: EventTarget; preventDefault: () => void }) {
  if ((e.target as HTMLElement).closest('button')) e.preventDefault()
}

/** Drag to resize: `apply` gets the start value plus the distance moved. */
function drag(e: PointerEvent<HTMLDivElement>, axis: 'x' | 'y', apply: (delta: number) => void) {
  if (e.button !== 0) return
  e.preventDefault()
  const el = e.currentTarget
  const p0 = axis === 'x' ? e.clientX : e.clientY
  el.setPointerCapture(e.pointerId)
  el.classList.add('dragging')
  document.body.classList.add('k-dragging')
  const move = (ev: globalThis.PointerEvent) => apply((axis === 'x' ? ev.clientX : ev.clientY) - p0)
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    el.classList.remove('dragging')
    document.body.classList.remove('k-dragging')
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

// --------------------------------------------------------------------- app

export default function KherveBook({ win, args }: AppProps) {
  const example = typeof args.example === 'string' ? args.example : null
  const [nb] = useState(() => new Notebook(`nb-${win.id}`, !!args.path || !!example || !args.blank))
  useAppTools(win, useMemo(() => bookAiTools(nb), [nb]))
  const [chat] = useState(createChatSession)
  const [ui, setUi] = useState<UiPrefs>(loadUiPrefs)
  const updateUi = (p: Partial<UiPrefs>) =>
    setUi((u) => {
      const next = { ...u, ...p }
      saveUiPrefs(next)
      return next
    })

  const cells = useStore(nb.store, (s) => s.cells)
  const selectedId = useStore(nb.store, (s) => s.selectedId)
  const loading = useStore(nb.store, (s) => s.loading)
  const dirty = useStore(nb.store, (s) => s.dirty)
  const path = useStore(nb.store, (s) => s.path)
  const origin = useStore(nb.store, (s) => s.origin)
  const untitled = useStore(nb.store, (s) => s.untitled)
  const status = useStore(nb.store, (s) => s.status)
  const pyVersion = useStore(nb.store, (s) => s.pyVersion)
  const pyodideVersion = useStore(nb.store, (s) => s.pyodideVersion)
  const progress = useStore(nb.store, (s) => s.progress)
  const flash = useStore(nb.store, (s) => s.flash)
  const pending = useStore(nb.store, (s) => s.pending)
  const loopId = useStore(nb.store, (s) => s.loopId)
  const svgTools = useStore(nb.svg)
  const noteTools = useStore(nb.note)

  const selIndex = cells.findIndex((c) => c.id === selectedId)
  const sel: Cell | undefined = selIndex >= 0 ? cells[selIndex] : undefined
  // What the menus depend on (not the cells themselves, which change with every keystroke).
  const selType = sel?.type ?? null
  const selEditing = !!sel?.editing
  const allCollapsed = cells.length > 0 && cells.every((c) => c.collapsed)
  const count = cells.length
  const busy = pending > 0
  const kernelOn = status === 'idle' || status === 'busy' || status === 'starting'
  const name = loading && args.path ? basename(args.path) : displayName({ path, origin, untitled })
  // Recomputed when the notebook moves (path / origin change).
  const baseDir = useMemo(() => nb.baseDir(), [nb, path, origin])

  // The explorer shows the notebook's folder (desktop show_file), or the one picked.
  const [explorerRoot, setExplorerRoot] = useState(() => (ui.explorerRoot && os.fs.isDir(ui.explorerRoot) ? ui.explorerRoot : nb.baseDir()))
  useEffect(() => {
    const f = path ?? origin
    if (f) setExplorerRoot(dirname(f))
  }, [path, origin])
  const chooseRoot = (dir: string) => {
    setExplorerRoot(dir)
    updateUi({ explorerRoot: dir })
  }

  // Python lives as long as the window.
  useEffect(() => {
    nb.mount()
    return () => nb.unmount()
  }, [nb])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (args.path) void nb.openPath(args.path, false)
    else if (example) void nb.openExample(example, typeof args.title === 'string' ? args.title : basename(example), false)
    else if (args.blank) nb.refocus()
    else void nb.openWelcome(false) // like the desktop: a new window opens on the pre-run welcome notebook
  }, [nb, args, example])

  useEffect(() => {
    win.setTitle(`${dirty ? '*' : ''}${name} — kBook v${KHERVEBOOK_VERSION}`)
  }, [win, dirty, name])
  // So opening this file again (e.g. after Save As) focuses this window.
  useEffect(() => win.setDocumentPath(path ?? origin), [win, path, origin])

  useEffect(() => {
    win.setCloseGuard(() => nb.confirmClose())
    return () => win.setCloseGuard(null)
  }, [win, nb])

  // The Examples menu, from public/examples/khervebook/index.json.
  const [examples, setExamples] = useState<ExampleIndex | 'loading' | 'error'>('loading')
  const loadExamples = () => {
    setExamples('loading')
    loadExampleIndex().then(setExamples, () => setExamples('error'))
  }
  useEffect(loadExamples, [])

  /** Run something that opens a dialog, then give the focus back to the notebook. */
  const withDialog = (fn: () => Promise<unknown>) => () => void fn().finally(() => nb.refocusSoon())
  const soon = (what: string) => nb.showFlash(`${what.replace(/\s*\(.*\)$/, '')} — coming to the web edition soon.`)
  const toggleExplorer = () => updateUi({ explorer: !ui.explorer })
  const toggleAi = () => updateUi({ ai: !ui.ai })
  const togglePageMode = () => updateUi({ pageMode: !ui.pageMode })
  const reload = () => nb.reload()
  const gitSnapshot = () => void snapshotAndUpload(nb.state.path, (m) => nb.saveSnapshot(m), () => nb.saveAs()).finally(() => nb.refocusSoon())
  const gitHistory = (branches = false) => void showHistory(nb.state.path, reload, branches).finally(() => nb.refocusSoon())
  const paintLibrary = (): [string, string][] => {
    const dir = `${HOME}/Documents/KhervePaint Library`
    if (!os.fs.isDir(dir)) return []
    return os.fs
      .walk(dir)
      .filter((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.svg'))
      .map((f): [string, string] => [f.path.slice(dir.length + 1).replace(/\.svg$/i, ''), f.path])
      .sort((a, b) => a[0].localeCompare(b[0]))
  }
  const addCell = (t: 'note' | 'file') => () => {
    const id = nb.insert(t)
    // desktop _add_file_cell: a new File cell asks for its file at once
    if (t === 'file') setTimeout(() => nb.callCell(id, 'chooseFile'), 0)
  }
  const showGuide = () => void os.dialog.alert(<UserGuide />, { title: 'kBook — User Guide' }).finally(() => nb.refocusSoon())

  // ------------------------------------------------------------ menus

  const menus = useMemo<MenuBarMenu[]>(() => {
    // Clicking the top bar takes the focus away from the notebook: hand it back afterwards.
    const act = (fn: () => void) => () => {
      fn()
      nb.refocusSoon()
    }
    const after = (fn: () => Promise<unknown>) => () => void fn().finally(() => nb.refocusSoon())
    const recent = recentFiles()
    const recentItems: MenuItem[] = recent.length
      ? [
          ...recent.map((p): MenuItem => ({
            label: `${basename(p)}   ${pretty(dirname(p))}`,
            disabled: !os.fs.isFile(p),
            onClick: after(() => nb.openPath(p)),
          })),
          '-',
          { label: 'Clear Recent Files', onClick: () => clearRecent() },
        ]
      : [{ label: '(no recent files)', disabled: true }]
    const typeItem = (t: CellType, label: string): MenuItem => ({ label, checked: selType === t, disabled: !selType, onClick: act(() => nb.setType(t)) })

    const exampleItems: MenuItem[] = [{ label: 'Welcome to kBook', onClick: after(() => nb.openWelcome()) }, '-']
    if (examples === 'loading') exampleItems.push({ label: 'Loading examples…', disabled: true })
    else if (examples === 'error') exampleItems.push({ label: 'The examples could not be loaded — try again', onClick: loadExamples })
    else
      for (const cat of examples.categories) {
        exampleItems.push({
          label: cat.name,
          submenu: cat.notebooks.length
            ? cat.notebooks.map((n) => ({ label: n.title, onClick: after(() => nb.openExample(n.file, n.title)) }))
            : [{ label: 'No examples installed yet', disabled: true }],
        })
      }

    return [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: KEYS.new, onClick: after(() => nb.newNotebook()) },
          { label: 'New Window', shortcut: KEYS.newWindow, onClick: () => os.open('khervebook') },
          { label: 'Open…', shortcut: KEYS.open, onClick: after(() => nb.open()) },
          { label: 'Save', shortcut: KEYS.save, onClick: after(() => nb.save()) },
          { label: 'Save As…', shortcut: KEYS.saveAs, onClick: after(() => nb.saveAs()) },
          { label: 'Open Recent', submenu: recentItems },
          '-',
          { label: 'Insert Image / PDF…', onClick: after(() => nb.insertFromDrive('image')) },
          { label: 'Import Spreadsheet (.xlsx)…', onClick: after(() => nb.insertFromDrive('sheet')) },
          { label: 'Import Jupyter/Colab (.ipynb)…', onClick: after(() => nb.importIpynb()) },
          { label: 'Export as Jupyter/Colab (.ipynb)…', onClick: after(() => nb.exportIpynb()) },
          '-',
          { label: 'Exit', shortcut: KEYS.exit, onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: KEYS.undo, image: <Mdi name="mdi.undo" size={16} />, onClick: () => nb.smartUndo() },
          { label: 'Redo', shortcut: KEYS.redo, image: <Mdi name="mdi.redo" size={16} />, onClick: () => nb.smartRedo() },
          '-',
          {
            label: 'Find in Cell…',
            shortcut: KEYS.find,
            disabled: !selType || !['code', 'js', 'markdown', 'latex', 'svg'].includes(selType),
            onClick: () => nb.state.selectedId && nb.callCell(nb.state.selectedId, 'find'),
          },
          '-',
          { label: 'Clear Output', disabled: selType !== 'code', onClick: act(() => nb.clearOutputs(nb.state.selectedId ?? undefined)) },
          { label: 'Clear All Outputs', onClick: act(() => nb.clearOutputs()) },
        ],
      },
      {
        label: 'Cell',
        items: [
          { label: 'Add Code Cell', shortcut: KEYS.addCode, onClick: act(() => nb.insert('code')) },
          { label: 'Add Markdown Cell', shortcut: KEYS.addMd, onClick: act(() => nb.insert('markdown')) },
          { label: 'Add Note Cell', shortcut: KEYS.addNote, onClick: act(addCell('note')) },
          { label: 'Add LaTeX Cell', shortcut: KEYS.addTex, onClick: act(() => nb.insert('latex')) },
          { label: 'Add Sheet Cell', shortcut: KEYS.addSheet, onClick: act(() => nb.insert('sheet')) },
          { label: 'Add SVG Cell', onClick: act(() => nb.insert('svg')) },
          { label: 'Add JavaScript Cell', onClick: act(() => nb.insert('js')) },
          { label: 'Attach File Cell…', onClick: addCell('file') },
          '-',
          { label: 'Run Cell', shortcut: KEYS.run, onClick: act(() => nb.run(undefined, 'stay')) },
          { label: 'Run All', shortcut: KEYS.runAll, onClick: act(() => nb.runAll()) },
          '-',
          { label: 'Cut Cell', shortcut: KEYS.cutCell, disabled: !selType, onClick: act(() => nb.cutCell()) },
          { label: 'Copy Cell', shortcut: KEYS.copyCell, disabled: !selType, onClick: act(() => nb.copyCell()) },
          { label: 'Paste Cell Below', shortcut: KEYS.pasteCell, onClick: act(() => nb.pasteCell('below')) },
          '-',
          { label: 'Move Cell Up', shortcut: KEYS.moveUp, disabled: selIndex <= 0, onClick: act(() => nb.move(-1)) },
          { label: 'Move Cell Down', shortcut: KEYS.moveDown, disabled: selIndex < 0 || selIndex >= count - 1, onClick: act(() => nb.move(1)) },
          { label: 'Delete Cell', shortcut: KEYS.deleteCell, disabled: !selType, onClick: act(() => nb.remove()) },
          '-',
          loopId
            ? { label: 'Stop Continuous Run', onClick: act(() => nb.stopLoop()) }
            : { label: 'Run Continuously', disabled: !selType, onClick: act(() => nb.startLoop()) },
          { label: 'Cell Type', submenu: CELL_TYPES.map((t) => typeItem(t.type, t.label)) },
        ],
      },
      {
        label: 'Kernel',
        items: [
          { label: 'Restart Kernel', shortcut: KEYS.restart, onClick: after(() => nb.restartKernel()) },
          { label: 'Restart Python (stops a running cell)', disabled: status === 'off', onClick: after(() => nb.restartPython()) },
          { label: 'Start Python', disabled: kernelOn, onClick: act(() => nb.startKernel()) },
          '-',
          {
            label: pyVersion ? `Python ${pyVersion}${pyodideVersion ? ` · Pyodide ${pyodideVersion}` : ''}` : 'Python not started',
            disabled: true,
          },
        ],
      },
      {
        label: 'Git',
        items: [
          { label: 'Save Snapshot & Upload', image: <Mdi name="mdi.cloud-upload-outline" size={16} />, onClick: gitSnapshot },
          {
            label: 'Download Latest from Cloud',
            image: <Mdi name="mdi.cloud-download-outline" size={16} />,
            onClick: after(() => downloadLatest(nb.state.path, reload, (t) => nb.showFlash(t))),
          },
          '-',
          // Creates a repository: not in the web edition (Git is secondary in KherveOS).
          { label: 'Connect to GitHub / GitLab… (not in the web edition)', image: <Mdi name="mdi.github" size={16} />, disabled: true },
          '-',
          { label: 'View Version History…', image: <Mdi name="mdi.history" size={16} />, onClick: () => gitHistory(false) },
          { label: 'Branches…', image: <Mdi name="mdi.source-branch" size={16} />, onClick: () => gitHistory(true) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'File Explorer', shortcut: KEYS.explorer, checked: ui.explorer, onClick: act(toggleExplorer) },
          { label: 'AI Assistant', shortcut: KEYS.ai, checked: ui.ai, onClick: act(toggleAi) },
          {
            label: 'File Explorer Position',
            submenu: [
              { label: 'Left', checked: ui.side === 'left', onClick: act(() => updateUi({ side: 'left', explorer: true })) },
              { label: 'Right', checked: ui.side === 'right', onClick: act(() => updateUi({ side: 'right', explorer: true })) },
              { label: 'Floating (not in the web edition)', disabled: true },
            ],
          },
          '-',
          { label: 'Page Mode (continuous)', shortcut: KEYS.pageMode, checked: ui.pageMode, onClick: act(togglePageMode) },
          { label: 'Interactive Plots (zoom/pan) — not in the web edition', checked: false, disabled: true },
          {
            label: 'Theme',
            submenu: [
              { label: 'Kherve Green (KherveOS)', checked: !ui.theme, onClick: act(() => updateUi({ theme: '' })) },
              '-',
              ...Object.keys(DESKTOP_THEMES).map((t): MenuItem => ({ label: t, checked: ui.theme === t, onClick: act(() => updateUi({ theme: t })) })),
            ],
          },
          '-',
          { label: 'Line Numbers', checked: ui.lineNumbers, onClick: act(() => updateUi({ lineNumbers: !ui.lineNumbers })) },
          { label: allCollapsed ? 'Expand All Cells' : 'Collapse All Cells', onClick: act(() => nb.toggleCollapseAll()) },
        ],
      },
      { label: 'Examples', items: exampleItems },
      {
        label: 'Help',
        items: [
          { label: 'User Guide', shortcut: KEYS.guide, onClick: showGuide },
          '-',
          {
            label: 'Check for Updates…',
            image: <Mdi name="mdi.cloud-download-outline" size={16} />,
            onClick: after(() =>
              os.dialog.alert('The web edition of kBook is part of KherveOS and is updated with it: you always have the latest version.', { title: 'Check for Updates' }),
            ),
          },
          { label: 'Check for Updates on Startup', checked: true, disabled: true },
          '-',
          { label: 'Report an Issue / Feedback…', image: <Mdi name="mdi.bug-outline" size={16} />, onClick: () => os.openUrl(ISSUES_URL) },
          { label: 'About', onClick: after(() => os.dialog.alert(<About />, { title: 'About kBook' })) },
          '-',
          { label: 'Keyboard Shortcuts', onClick: after(() => os.dialog.alert(<Shortcuts />, { title: 'kBook shortcuts' })) },
        ],
      },
    ]
    // `path` refreshes Open Recent after a save or an open.
  }, [nb, win, selType, selEditing, selIndex, count, allCollapsed, status, kernelOn, pyVersion, pyodideVersion, loopId, ui, examples, path])

  useEffect(() => {
    win.setMenus(menus)
  }, [win, menus])
  useEffect(() => () => win.setMenus(null), [win])

  // --------------------------------------------------------- keyboard

  const lastD = useRef(0)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return // an editor or the grid used it
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const run = (fn: () => void) => {
      e.preventDefault()
      fn()
    }
    if (k === 'F1') return run(showGuide)
    if (mod && !e.altKey) {
      if (e.shiftKey) {
        const shifted: Record<string, () => void> = {
          s: withDialog(() => nb.saveAs()),
          n: () => os.open('khervebook'),
          z: () => nb.smartRedo(),
          e: addCell('note'),
          r: () => void nb.restartKernel(),
          Enter: () => nb.runAll(),
          c: () => nb.insert('code'),
          m: () => nb.insert('markdown'),
          l: () => nb.insert('latex'),
          t: () => nb.insert('sheet'),
          x: () => nb.cutCell(),
          o: () => nb.copyCell(),
          v: () => nb.pasteCell('below'),
          ArrowUp: () => nb.move(-1),
          ArrowDown: () => nb.move(1),
          d: () => nb.remove(),
          a: toggleAi,
          p: togglePageMode,
        }
        if (shifted[k]) return run(shifted[k])
      } else {
        const plain: Record<string, () => void> = {
          s: withDialog(() => nb.save()),
          o: withDialog(() => nb.open()),
          n: withDialog(() => nb.newNotebook()),
          z: () => nb.undo(), // the editor undid its own text first, if it had any
          y: () => nb.redo(),
          b: toggleExplorer,
          q: () => win.close(),
          f: () => nb.state.selectedId && nb.callCell(nb.state.selectedId, 'find'),
        }
        if (plain[k]) return run(plain[k])
      }
    }
    // Command mode: a cell itself has the focus (not its editor or grid).
    const t = e.target as HTMLElement
    if (!t.classList.contains('nb-cell')) return
    const id = nb.state.selectedId
    if (!id) return
    let handled = true
    if (k === 'Enter') {
      const how: After = e.shiftKey ? 'advance' : e.altKey ? 'insert' : 'stay'
      if (e.shiftKey || mod || e.altKey) nb.run(id, how)
      else if (nb.cell(id)?.type === 'note') nb.focus(id, 'command')
      else nb.focus(id, 'edit')
    } else if (mod || e.altKey) handled = false
    else if (k === 'ArrowUp' || (k === 'k' && !e.shiftKey)) nb.focusSibling(id, -1, 'command')
    else if (k === 'ArrowDown' || (k === 'j' && !e.shiftKey)) nb.focusSibling(id, 1, 'command')
    else if (e.shiftKey) {
      if (k === 'z') nb.redo()
      else handled = false
    }
    else if (k === 'a') nb.insert('code', 'above', 'command')
    else if (k === 'b') nb.insert('code', 'below', 'command')
    else if (k === 'y') nb.setType('code')
    else if (k === 'm') nb.setType('markdown')
    else if (k === 'l') nb.setType('latex')
    else if (k === 'x') nb.cutCell(id)
    else if (k === 'c') nb.copyCell(id)
    else if (k === 'v') nb.pasteCell('below')
    else if (k === 'z') nb.undo()
    else if (k === 'd') {
      const now = Date.now()
      if (now - lastD.current < 700) {
        lastD.current = 0
        nb.remove(id)
      } else lastD.current = now
    } else handled = false
    if (handled) e.preventDefault()
  }

  // ---------------------------------------------------------- dropping

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files')
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!accepts(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!accepts(e)) return
    e.preventDefault()
    const onCell = (e.target as HTMLElement).closest<HTMLElement>('.nb-cell')?.dataset.cellId ?? null
    const target = onCell ?? nb.state.cells[nb.state.cells.length - 1]?.id ?? null
    const internal = e.dataTransfer.getData(DRAG_MIME)
    const importAll = async (paths: string[]) => {
      let ref: string | null = target
      for (const p of paths) {
        // desktop: a File cell takes any file; KFit / KherveTeX / Molecule cells take theirs.
        const into = onCell ? nb.cell(onCell) : undefined
        if (into && DROPS_INTO[into.type]?.(p)) {
          nb.select(into.id)
          if (await nb.callCell(into.id, 'attach', p)) continue
        }
        const ok = await nb.importFile(p, ref)
        if (ok) ref = nb.state.selectedId
      }
    }
    if (internal) {
      try {
        void importAll(JSON.parse(internal) as string[])
      } catch {
        /* not a list of paths */
      }
    } else if (e.dataTransfer.files.length) {
      void os.importFiles(nb.baseDir(), e.dataTransfer.files).then(importAll)
    }
  }

  // ------------------------------------------------------------- view

  const location = path ? pretty(path) : origin ? `${pretty(origin)} · Jupyter notebook, Save makes a .kbook copy` : untitled ? `${untitled} · example, not saved` : 'Not saved yet'
  const message =
    progress ?? (status === 'starting' ? STARTING_NOTE : null) ?? flash ?? (loopId ? 'Running continuously — the red ■ stops it' : null) ??
    (pending > 1 ? `Running · ${pending - 1} more waiting` : pending === 1 ? 'Running…' : null)
  const spinning = !!progress || status === 'starting' || (busy && message !== flash)

  // Cells marked "column" sit beside the previous one, in the same row.
  const rows = useMemo(() => {
    const out: Cell[][] = []
    for (const c of cells) {
      if (c.column && out.length) out[out.length - 1].push(c)
      else out.push([c])
    }
    return out
  }, [cells])

  const side = ui.explorer || ui.ai
  const themeStyle = useMemo(() => (ui.theme ? (desktopThemeVars(ui.theme) as CSSProperties | null) ?? undefined : undefined), [ui.theme])
  const sideRef = useRef<HTMLElement>(null)

  return (
    <div
      className={`k-app nb-app${ui.pageMode ? ' page-mode' : ''}${ui.side === 'right' ? ' side-right' : ''}${ui.theme ? ' desktop-theme' : ''}`}
      style={themeStyle}
      data-dark={ui.theme ? (DESKTOP_THEMES[ui.theme]?.dark ? '1' : '0') : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="nb-toolbars" onMouseDown={keepFocus}>
        <ToolRow
          items={mainRow(
            nb,
            { sel, selIndex, count, busy, looping: !!loopId, explorer: ui.explorer, ai: ui.ai, pageMode: ui.pageMode },
            { toggleExplorer, toggleAi, togglePageMode, snapshot: gitSnapshot, history: () => gitHistory(false) },
            KEYS,
          )}
          onSoon={soon}
        />
        <ToolRow items={cellRow(nb, sel, KEYS, { svg: svgTools, note: noteTools, paintLibrary })} className="nb-cellbar" onSoon={soon}>
          {sel?.type === 'other' && <span className="nb-cellbar-note">This {sel.rawType} cell comes from the desktop app and is kept as it is.</span>}
        </ToolRow>
      </div>

      <div className="nb-body">
        {side && (
          <aside className="nb-side" ref={sideRef} style={{ width: ui.sideWidth }}>
            {ui.explorer && (
              <section className="nb-side-section" style={ui.ai ? { flex: `0 0 ${Math.round(ui.split * 100)}%` } : { flex: 1 }}>
                <header className="nb-side-title">
                  <span>Files</span>
                  <button className="nb-side-btn" title={`Hide the file explorer (${KEYS.explorer})`} aria-label="Hide the file explorer" onClick={toggleExplorer}>
                    <X size={13} />
                  </button>
                </header>
                <Explorer nb={nb} root={explorerRoot} current={path} onRoot={chooseRoot} />
              </section>
            )}
            {ui.explorer && ui.ai && (
              <div
                className="nb-hsplit"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the file explorer and the AI chat"
                onPointerDown={(e) => {
                  const h = sideRef.current?.clientHeight ?? 600
                  const start = ui.split
                  drag(e, 'y', (d) => updateUi({ split: Math.min(0.85, Math.max(0.15, start + d / h)) }))
                }}
              />
            )}
            {ui.ai && (
              <section className="nb-side-section" style={{ flex: 1 }}>
                <header className="nb-side-title">
                  <span>AI Chat</span>
                  <button className="nb-side-btn" title={`Hide the AI assistant (${KEYS.ai})`} aria-label="Hide the AI assistant" onClick={toggleAi}>
                    <X size={13} />
                  </button>
                </header>
                <AiChat nb={nb} session={chat} />
              </section>
            )}
          </aside>
        )}
        {side && (
          <div
            className="nb-vsplit"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the side panel"
            onPointerDown={(e) => {
              const start = ui.sideWidth
              drag(e, 'x', (d) => updateUi({ sideWidth: Math.min(640, Math.max(180, start + (ui.side === 'right' ? -d : d))) }))
            }}
          />
        )}

        <div className="nb-scroll" onDragOver={onDragOver} onDrop={onDrop}>
          {loading ? (
            <div className="nb-loading">
              <LoaderCircle size={18} className="k-spin" />
              Opening {name}…
            </div>
          ) : (
            <div className="nb-page">
              {rows.map((row) => (
                <div key={row[0].id} className={`nb-cellrow${row.length === 1 && row[0].width ? ' fixed' : ''}`}>
                  {row.map((c) => (
                    <CellView
                      key={c.id}
                      cell={c}
                      selected={c.id === selectedId}
                      looping={c.id === loopId}
                      nb={nb}
                      baseDir={baseDir}
                      lineNumbers={ui.lineNumbers}
                      theme={ui.theme}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="k-statusbar nb-statusbar">
        <span className="nb-sb-app">kBook v{KHERVEBOOK_VERSION}</span>
        <span className="nb-sb-file" title={path ?? origin ?? undefined}>
          {location}
        </span>
        <span className="nb-sb-msg">
          {message && spinning && <LoaderCircle size={12} className="k-spin" />}
          {message}
        </span>
        <KernelPill status={status} version={pyVersion} pyodide={pyodideVersion} onStart={() => nb.startKernel()} />
        <span>{selIndex >= 0 ? `Cell ${selIndex + 1} of ${count}` : `${count} cells`}</span>
      </div>
    </div>
  )
}

