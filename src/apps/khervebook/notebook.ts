// The notebook behind one KherveBook window (the desktop's NotebookWidget):
// its cells, the structural undo stack, the cell clipboard, the Python
// kernel and its run queue (code cells, sheet formulas, continuous runs),
// and the file it is saved to. Plain TypeScript around a small zustand
// store, so the async run queue always sees the current cells (React
// components subscribe to the store).

import { createStore, type StoreApi } from 'zustand'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { redo as cmRedo, redoDepth, undo as cmUndo, undoDepth } from '@codemirror/commands'
import { os, HOME, type FsEvent } from '@/os'
import { basename, dirname, extname, isInside, join, pretty } from '@/os/path'
import { PythonKernel, type CellResult, type KernelStatus, type RunHandlers } from '@/os/python/kernel'
import {
  FORMAT_VERSION, cellData, cellFromData, isJsonCell, makeCell, parseNotebook, serializeKbook, toIpynb,
  type Cell, type CellData, type CellKind, type CellType, type NotebookDoc, type Output, type SheetResult, type StreamName,
} from './format'
import {
  NOTE_STARTER, b64ToBytes, bytesToB64, cellAttachments, kfCode, claimPath, filesSource, kfitSource, ktexSource, molSource, noteSource, parseFiles,
  parseKfit, parseKtex, parseMol, parseNote, withAttachments, type Attachment,
} from './cellfiles'
import { gitAfterSave } from './gitops'
import { MAGIC_HINT, prepareCode } from './magics'
import {
  PRELOAD_CODE, computeCode, drainCode, forgetCode, lazyImportCode, lazyNeeds, plotRangeCode, setupCode,
  type SheetPayloadCell,
} from './pyhelper'
import {
  addCol, addRow, addSheet, deleteCol, deleteRow, parseRef, parseWorkbook, serializeWorkbook, setCells, type Workbook,
} from './sheet'
import { WELCOME_FILE, exampleFileName, fetchExample } from './examples'
import { appendToSvg } from './edit'
import { fileToCells } from './importers'
import { addRecent } from './prefs'

export type FocusMode = 'edit' | 'command'
/** What happens after running a cell: stay, select the next one, or insert a new one below. */
export type After = 'stay' | 'advance' | 'insert'
type Caret = 'start' | 'end' | 'keep'

export interface NbState {
  cells: Cell[]
  selectedId: string | null
  /** The .kbook this notebook saves to. Null until saved (new notebooks, examples, imported .ipynb). */
  path: string | null
  /** The file it was opened from (for an imported .ipynb this differs from `path`). */
  origin: string | null
  /** The name shown while there is no file (an example's title). */
  untitled: string | null
  dirty: boolean
  loading: boolean
  status: KernelStatus
  /** "3.12.7" once Python has started. */
  pyVersion: string | null
  pyodideVersion: string | null
  /** Kernel progress for the status bar ("Loading numpy"…). */
  progress: string | null
  /** A short-lived status bar message ("Saved to …"). */
  flash: string | null
  /** Code cells running or waiting to run. */
  pending: number
  canUndo: boolean
  canRedo: boolean
  /** The cell running continuously (one at a time, like the desktop). */
  loopId: string | null
}

type Job =
  /** `keepGoing`: Run All and examples run every cell even when one fails (desktop run_all). */
  | { kind: 'cell'; id: string; keepGoing?: boolean }
  | { kind: 'sheets' }
  | { kind: 'reset' }
  | { kind: 'boot' }
  | { kind: 'forget'; names: string[] }
  | { kind: 'task'; run: (k: PythonKernel, gen: number) => Promise<void>; cancel?: () => void }

interface Snapshot {
  cells: Cell[]
  selectedId: string | null
}

/** What a sheet cell's grid tells the toolbar: the sheet shown and the current grid cell. */
export interface SheetHandle {
  sheetIndex: number
  row: number
  col: number
  addSheet: () => void
}

export type SheetOp = 'addRow' | 'addCol' | 'delRow' | 'delCol' | 'addSheet'

export type SvgTool = 'select' | 'pen' | 'line' | 'rect' | 'ellipse' | 'text'

/** The drawing tools of SVG cells (desktop svgcell.py: tool, colour, width, grid, snap). */
export interface SvgTools {
  tool: SvgTool
  color: string
  width: number
  grid: boolean
  snap: boolean
  gridSize: number
}

/** The Note cell tools of the second toolbar row (desktop celltoolbar._build_note). */
export interface NoteTools {
  /** The Note cell whose pen is on (one at a time), or null. */
  pen: string | null
  inkColor: string
  inkWidth: number
  font: string
  size: number
}

/** What a cell's own view offers to the toolbar and the notebook (desktop cell methods: choose_file, refresh…). */
export type CellHandle = Record<string, ((...args: never[]) => unknown) | undefined>

/** Where the web edition keeps files Python and the other apps need to see (home folder, hidden). */
export const CACHE_DIR = `${HOME}/.cache/khervebook`

export const STARTING_NOTE = 'Starting Python… the first start downloads about 10 MB'
const PRELOAD_NOTE = 'Loading numpy, matplotlib and pandas…'
const MAX_STREAM = 200_000
export const NOTEBOOKS = `${HOME}/Notebooks`
/** A code cell whose first line says so is started as a live loop (desktop examples.py). */
export const LIVE_RE = /runs continuously(?:\s*\((\d+)\s*ms\))?/
const LOOP_MS = 60
const UNDO_LIMIT = 100

/** Starter source of a new SVG cell (desktop svgcell.STARTER_SVG). */
export const STARTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180">\n' +
  '  <rect x="10" y="10" width="280" height="160" rx="12"\n' +
  '        fill="#eaf1fb" stroke="#2176c7" stroke-width="2"/>\n' +
  '  <circle cx="90" cy="90" r="45" fill="#50bea0"/>\n' +
  '  <text x="170" y="96" font-size="22" fill="#2e3440">Hello SVG</text>\n' +
  '</svg>'

/** A blank canvas for an empty SVG cell (desktop svgcell.BLANK_SVG). */
export const BLANK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">\n' +
  '  <rect x="0" y="0" width="800" height="500" fill="#ffffff"/>\n' +
  '</svg>'

/** Starter source of a new JavaScript cell (desktop jscell.JS_STARTER). */
export const JS_STARTER =
  '<canvas id="c" width="360" height="180" style="border:1px solid #ccc"></canvas>\n' +
  '<script>\n' +
  'const ctx = document.getElementById("c").getContext("2d");\n' +
  'ctx.fillStyle = "#3776ab";\n' +
  'for (let x = 0; x < 360; x++) {\n' +
  '    const y = 90 + 70 * Math.sin(x / 22);\n' +
  '    ctx.fillRect(x, y, 2, 2);\n' +
  '}\n' +
  'ctx.fillStyle = "#e07b39";\n' +
  'ctx.font = "16px sans-serif";\n' +
  'ctx.fillText("Hello from JavaScript", 80, 28);\n' +
  '</script>'

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function displayName(s: Pick<NbState, 'path' | 'origin' | 'untitled'>): string {
  return s.path || s.origin ? basename((s.path ?? s.origin) as string) : (s.untitled ?? 'Untitled')
}

/** Cells that always show their source editor. */
export const alwaysEdits = (t: CellKind) => t === 'code' || t === 'js'
/** Cells whose source editor shows while they are being edited. */
export const textEdits = (t: CellKind) => t === 'markdown' || t === 'latex' || t === 'svg'
export const hasEditor = (c: Pick<Cell, 'type' | 'editing'>) => alwaysEdits(c.type) || (textEdits(c.type) && c.editing)

function withExt(p: string, ext: string): string {
  const e = extname(p)
  return (e ? p.slice(0, -e.length) : p) + ext
}

function capStream(t: string): string {
  return t.length <= MAX_STREAM ? t : '… (earlier output trimmed)\n' + t.slice(-MAX_STREAM)
}

function appendStreams(outputs: Output[], add: { name: StreamName; text: string }[]): Output[] {
  const out = outputs.slice()
  for (const a of add) {
    const last = out[out.length - 1]
    if (last?.kind === 'stream' && last.name === a.name) out[out.length - 1] = { ...last, text: capStream(last.text + a.text) }
    else out.push({ kind: 'stream', name: a.name, text: capStream(a.text) })
  }
  return out
}

/** The cell clipboard, shared by every KherveBook window (desktop: Cut/Copy/Paste Cell). */
let clipboard: CellData | null = null

export class Notebook {
  readonly store: StoreApi<NbState>
  /** The SVG drawing tools (shared by the window's SVG cells, like the desktop's toolbar). */
  readonly svg: StoreApi<SvgTools> = createStore<SvgTools>(() => ({ tool: 'select', color: '#2176c7', width: 3, grid: false, snap: false, gridSize: 20 }))
  /** Elements drawn into each SVG cell, newest last (Undo shape). */
  private drawn = new Map<string, string[]>()
  /** Note cell tools: pen, ink colour and width, font (shared by the toolbar and the cells). */
  readonly note: StoreApi<NoteTools> = createStore<NoteTools>(() => ({ pen: null, inkColor: '#c0392b', inkWidth: 3, font: 'Arial', size: 11 }))
  private handles = new Map<string, CellHandle>()
  /** Files handed to another app (Open in KhervePY…): path → the cell and how to take the file back. */
  private bridges = new Map<string, { id: string; text: boolean; written: string; reload: (data: Uint8Array) => void }>()
  /** Embedded attachments written out for Python: path → the base64 written. */
  private exported = new Map<string, string>()
  /** The kf() / kfit() definitions Python has (null: send them again). */
  private filesSynced: string | null = null
  private kfitInstalled = false
  private readonly ns: string
  private kernel: PythonKernel | null = null
  private unsubs: (() => void)[] = []

  // run queue
  private jobs: Job[] = []
  private pumping = false
  /** Bumped by restart / load / close: work started before is stale and must not touch the cells. */
  private generation = 0
  private counter = 0
  private runningId: string | null = null
  /** Python has moved into the notebook folder and installed the helpers. */
  private booted = false
  /** The namespace has np / plt / pd / ks… (desktop _seed_namespace). */
  private seeded = false
  /** scipy / sympy / lmfit imported into the namespace on first use. */
  private lazyLoaded = new Set<string>()
  /** Globals each code cell created (for Restart This Cell). */
  private introduced = new Map<string, Set<string>>()
  /** Why the last code run failed: its own error, or Python itself. */
  private lastFailure: 'code' | 'kernel' = 'code'

  // sheets
  /** The sheet grids changed since Python last computed them. */
  private sheetsStale = true
  /** sheet1, sheet2… → their cell and sheet, from the last compute. */
  private sheetVars = new Map<string, { id: string; index: number }>()
  private recalcTimer: ReturnType<typeof setTimeout> | null = null
  private sheetUi = new Map<string, SheetHandle>()

  // continuous run
  private loopMs = LOOP_MS
  private loopTimer: ReturnType<typeof setTimeout> | null = null
  private loopStarted = 0
  private offscreen = new Set<string>()
  private observer: IntersectionObserver | null = null

  // document
  private docExtra: Record<string, unknown> = {}
  private docVersion = FORMAT_VERSION
  /** Bumped on every change, so a save can tell whether edits happened meanwhile. */
  private edits = 0
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []

  // DOM
  private editors = new Map<string, EditorView>()
  private cellEls = new Map<string, HTMLElement>()
  private pendingFocus: { id: string; mode: FocusMode; at: Caret } | null = null
  /** Something to do with a cell's editor once it exists (toolbar actions on a rendered cell). */
  private pendingEditorAction: { id: string; fn: (v: EditorView) => void } | null = null

  // batching of streamed output
  private streams = new Map<string, { name: StreamName; text: string }[]>()
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ns: string, opening: boolean) {
    this.ns = ns
    const first = makeCell('code')
    this.store = createStore<NbState>(() => ({
      cells: opening ? [] : [first],
      selectedId: opening ? null : first.id,
      path: null,
      origin: null,
      untitled: null,
      dirty: false,
      loading: opening,
      status: 'off',
      pyVersion: null,
      pyodideVersion: null,
      progress: null,
      flash: null,
      pending: 0,
      canUndo: false,
      canRedo: false,
      loopId: null,
    }))
  }

  get state(): NbState {
    return this.store.getState()
  }

  private set(p: Partial<NbState>) {
    this.store.setState(p)
  }

  // ------------------------------------------------------------ lifecycle

  mount() {
    if (this.kernel) return
    const k = new PythonKernel(this.ns)
    this.kernel = k
    this.booted = false
    this.seeded = false
    const onVisibility = () => {
      if (!document.hidden) this.scheduleFrame(0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.unsubs.push(
      k.onStatus((s) => {
        if (s !== 'idle' && s !== 'busy') {
          // A new Python process: everything it knew is gone.
          this.booted = false
          this.seeded = false
          this.lazyLoaded.clear()
          this.introduced.clear()
          this.filesSynced = null
          this.kfitInstalled = false
          this.sheetsStale = true
        }
        this.set({ status: s })
      }),
      os.fs.watch((ev) => this.onFsEvent(ev)),
      () => document.removeEventListener('visibilitychange', onVisibility),
    )
    this.set({ status: k.status })
  }

  unmount() {
    this.generation++
    this.jobs = []
    this.pumping = false
    this.runningId = null
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.kernel?.dispose()
    this.kernel = null
    this.observer?.disconnect()
    this.observer = null
    for (const t of [this.streamTimer, this.flashTimer, this.loopTimer, this.recalcTimer]) if (t) clearTimeout(t)
    this.streamTimer = this.flashTimer = this.loopTimer = this.recalcTimer = null
    this.streams.clear()
  }

  /** Follow the file when it (or a folder above it) is renamed or moved in Files. */
  private onFsEvent(ev: FsEvent) {
    if ((ev.type === 'change' || ev.type === 'create') && this.bridges.has(ev.path)) {
      void this.bridgeChanged(ev.path)
      return
    }
    if (ev.type !== 'rename') return
    const move = (p: string | null) => (p && isInside(p, ev.oldPath) ? ev.path + p.slice(ev.oldPath.length) : p)
    const { path, origin } = this.state
    const np = move(path)
    const no = move(origin)
    if (np !== path || no !== origin) this.set({ path: np, origin: no })
  }

  // ---------------------------------------------------------------- cells

  cell(id: string | null | undefined): Cell | undefined {
    return id ? this.state.cells.find((c) => c.id === id) : undefined
  }

  private indexOf(id: string | null | undefined): number {
    return id ? this.state.cells.findIndex((c) => c.id === id) : -1
  }

  private patch(id: string, p: Partial<Cell> | ((c: Cell) => Partial<Cell>)) {
    this.store.setState((s) => {
      const i = s.cells.findIndex((c) => c.id === id)
      if (i < 0) return s
      const cells = s.cells.slice()
      cells[i] = { ...cells[i], ...(typeof p === 'function' ? p(cells[i]) : p) }
      return { cells }
    })
  }

  private changed() {
    this.edits++
    if (!this.state.dirty) this.set({ dirty: true })
  }

  select(id: string) {
    if (this.state.selectedId !== id) this.set({ selectedId: id })
  }

  /** Typing in a cell's editor (its own undo history covers it). */
  setSource(id: string, source: string) {
    const c = this.cell(id)
    if (!c || c.source === source) return
    this.patch(id, { source })
    if (c.type === 'sheet') this.sheetsStale = true
    this.changed()
  }

  /** A new cell's content: the desktop's starters for drawings and JavaScript. */
  private starter(type: CellKind): string {
    switch (type) {
      case 'svg':
        return STARTER_SVG
      case 'js':
        return JS_STARTER
      case 'note':
        return NOTE_STARTER
      default:
        return isJsonCell(type) ? normalJson(type, '') : ''
    }
  }

  /** Add a cell next to `ref` (the selected cell by default) and focus it. Undoable. */
  insert(type: CellType, where: 'above' | 'below' | 'end' = 'below', mode?: FocusMode, ref = this.state.selectedId, source?: string): string {
    this.record()
    const cell = makeCell(type, source ?? this.starter(type), textEdits(type) && type !== 'svg')
    this.place([cell], where, ref)
    this.focus(cell.id, mode ?? (hasEditor(cell) ? 'edit' : 'command'))
    return cell.id
  }

  private place(cells: Cell[], where: 'above' | 'below' | 'end', ref: string | null) {
    const all = this.state.cells.slice()
    const i = this.indexOf(ref)
    all.splice(where === 'end' || i < 0 ? all.length : where === 'above' ? i : i + 1, 0, ...cells)
    this.set({ cells: all, selectedId: cells[cells.length - 1].id })
    if (cells.some((c) => c.type === 'sheet')) this.sheetsStale = true
    this.changed()
  }

  remove(id = this.state.selectedId) {
    const i = this.indexOf(id)
    if (i < 0) return
    this.record()
    const cells = this.state.cells
    const gone = cells[i]
    if (this.state.loopId === gone.id) this.stopLoop()
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && j.id === gone.id))
    let rest = cells.filter((c) => c.id !== gone.id)
    if (!rest.length) rest = [makeCell('code')] // cutting the only cell leaves a fresh one
    const next = rest[Math.min(i, rest.length - 1)]
    this.editors.delete(gone.id)
    this.set({ cells: rest, selectedId: next.id })
    if (gone.type === 'sheet') this.sheetsStale = true
    this.changed()
    this.syncPending()
    this.focus(next.id, 'command')
  }

  move(delta: -1 | 1, id = this.state.selectedId) {
    const i = this.indexOf(id)
    const j = i + delta
    const cells = this.state.cells.slice()
    if (i < 0 || j < 0 || j >= cells.length) return
    this.record()
    const c = cells[i]
    const editing = this.editors.get(c.id)?.hasFocus ?? false
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
    this.set({ cells, selectedId: c.id })
    if (c.type === 'sheet' || cells[i].type === 'sheet') this.sheetsStale = true
    this.changed()
    // React re-inserts DOM nodes when reordering, which can drop focus: restore it once rendered.
    setTimeout(() => this.focus(c.id, editing ? 'edit' : 'command'), 0)
  }

  /** Convert To: the same source as another type (desktop convert_current). Undoable. */
  setType(type: CellType, id = this.state.selectedId) {
    const c = this.cell(id)
    if (!c || c.type === type) return
    this.record()
    const editing = this.editors.get(c.id)?.hasFocus ?? false
    if (this.state.loopId === c.id) this.stopLoop()
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && j.id === c.id))
    this.editors.delete(c.id) // the editor is recreated for the new language
    this.patch(c.id, {
      type,
      rawType: undefined,
      // Like the desktop's new widget reading the old text: JSON cells keep what they understand.
      ...(isJsonCell(type) ? { source: normalJson(type, c.source) } : {}),
      editing: type === 'markdown' || type === 'latex',
      outputs: type === 'code' ? c.outputs : [],
      count: type === 'code' ? c.count : null,
      state: c.state === 'queued' ? 'idle' : c.state,
      sheet: null,
      runs: 0,
    })
    if (type === 'sheet' || c.type === 'sheet') this.sheetsStale = true
    this.changed()
    this.syncPending()
    const now = this.cell(c.id)
    if (now) this.focus(c.id, editing && hasEditor(now) ? 'edit' : 'command')
  }

  /** Replace a cell's source as one undo step (toolbar tools on a rendered drawing, AI edits). */
  replaceSource(id: string, source: string) {
    const c = this.cell(id)
    if (!c || c.source === source) return
    this.record()
    this.setEditorText(id, source)
    this.patch(id, { source })
    if (c.type === 'sheet') this.sheetsStale = true
    this.changed()
  }

  /** A shape drawn on an SVG cell: appended to its source (an undo step). */
  drawShape(id: string, element: string) {
    const c = this.cell(id)
    if (!c || c.type !== 'svg') return
    this.replaceSource(id, appendToSvg(c.source.trim() ? c.source : BLANK_SVG, element))
    const list = this.drawn.get(id) ?? []
    list.push(element)
    this.drawn.set(id, list)
  }

  /** Desktop "Undo the last drawn shape". */
  undoShape(id = this.state.selectedId) {
    const c = this.cell(id)
    const list = c ? this.drawn.get(c.id) : undefined
    const element = list?.pop()
    if (!c || !element) return
    const at = c.source.lastIndexOf(`  ${element}\n`)
    if (at >= 0) this.replaceSource(c.id, c.source.slice(0, at) + c.source.slice(at + element.length + 3))
  }

  /** Put text in a cell's live editor without it becoming a step of the editor's own undo. */
  private setEditorText(id: string, text: string) {
    const v = this.editors.get(id)
    if (v && v.state.doc.toString() !== text) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) })
    }
  }

  setTitle(id: string, title: string) {
    const c = this.cell(id)
    if (!c || c.title === title.trim()) return
    this.record()
    this.patch(id, { title: title.trim() })
    this.changed()
  }

  /** Place the cell beside the one above (same row), or on its own row. */
  setColumn(id: string, on: boolean) {
    const i = this.indexOf(id)
    if (i < 0 || (on && i === 0) || this.state.cells[i].column === on) return
    this.record()
    this.patch(id, { column: on })
    this.changed()
  }

  setCollapsed(id: string, collapsed: boolean) {
    const c = this.cell(id)
    if (!c || c.collapsed === collapsed) return
    this.patch(id, { collapsed })
    this.changed()
  }

  /** Collapse every cell, or expand them all when all are collapsed already. */
  toggleCollapseAll() {
    const all = this.state.cells.every((c) => c.collapsed)
    this.store.setState((s) => ({ cells: s.cells.map((c) => (c.collapsed === !all ? c : { ...c, collapsed: !all })) }))
    this.changed()
  }

  /** From the resize grips: a height cap (the body scrolls) or a fixed width; null = auto. */
  setSize(id: string, size: { height?: number | null; width?: number | null }) {
    const c = this.cell(id)
    if (!c) return
    const p: Partial<Cell> = {}
    if (size.height !== undefined) p.height = size.height === null ? null : Math.max(60, Math.round(size.height))
    if (size.width !== undefined) p.width = size.width === null ? null : Math.max(220, Math.round(size.width))
    if (p.height === c.height && p.width === c.width) return
    this.patch(id, p)
    this.changed()
  }

  clearOutputs(id?: string) {
    this.store.setState((s) => ({
      cells: s.cells.map((c) =>
        (id === undefined || c.id === id) && c.type === 'code' && c.state === 'idle' && (c.outputs.length || c.count !== null)
          ? { ...c, outputs: [], count: null }
          : c,
      ),
    }))
  }

  // ------------------------------------------------------- cell clipboard

  copyCell(id = this.state.selectedId) {
    const c = this.cell(id)
    if (c) clipboard = cellData(c)
  }

  cutCell(id = this.state.selectedId) {
    if (!this.cell(id)) return
    this.copyCell(id)
    this.remove(id)
  }

  get canPaste(): boolean {
    return clipboard !== null
  }

  pasteCell(where: 'above' | 'below' = 'below') {
    if (!clipboard) return
    this.record()
    const cell = { ...cellFromData(clipboard), editing: clipboard.type === 'markdown' || clipboard.type === 'latex' }
    this.place([cell], where, this.state.selectedId)
    this.focus(cell.id, 'command')
  }

  // ---------------------------------------------------------- undo / redo
  //
  // Structural undo (add, delete, move, convert, cut, paste, titles, sheet
  // edits, AI edits), like the desktop's QUndoStack. Text typed in a cell is
  // undone by its own editor first (see smartUndo).

  private snapshot(): Snapshot {
    return { cells: this.state.cells, selectedId: this.state.selectedId }
  }

  private record() {
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
    this.set({ canUndo: true, canRedo: false })
  }

  undo() {
    const s = this.undoStack.pop()
    if (!s) return
    this.redoStack.push(this.snapshot())
    this.restore(s)
  }

  redo() {
    const s = this.redoStack.pop()
    if (!s) return
    this.undoStack.push(this.snapshot())
    this.restore(s)
  }

  /** Undo text in the focused editor first, else a cell-structure step (desktop _smart_undo). */
  smartUndo() {
    const v = this.focusedEditor()
    if (v && undoDepth(v.state) > 0) cmUndo(v)
    else this.undo()
  }

  smartRedo() {
    const v = this.focusedEditor()
    if (v && redoDepth(v.state) > 0) cmRedo(v)
    else this.redo()
  }

  private focusedEditor(): EditorView | undefined {
    for (const v of this.editors.values()) if (v.hasFocus) return v
    return undefined
  }

  private restore(s: Snapshot) {
    this.stopLoop()
    const now = new Map(this.state.cells.map((c) => [c.id, c]))
    const cells = s.cells.map((c): Cell => {
      const cur = now.get(c.id)
      if (!cur) return { ...c, state: 'idle', note: null }
      if (cur.type !== c.type) {
        this.editors.delete(c.id)
        return { ...c, state: 'idle', note: null }
      }
      // A live editor gets its old text back without it becoming an editor undo step.
      this.setEditorText(c.id, c.source)
      return { ...c, state: cur.state, note: cur.note, outputs: cur.outputs, count: cur.count, editing: cur.editing, runs: cur.runs, sheet: cur.sheet }
    })
    const ids = new Set(cells.map((c) => c.id))
    this.jobs = this.jobs.filter((j) => j.kind !== 'cell' || (ids.has(j.id) && cells.find((c) => c.id === j.id)?.type === 'code'))
    const selectedId = s.selectedId && ids.has(s.selectedId) ? s.selectedId : (cells[0]?.id ?? null)
    this.set({ cells, selectedId, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 })
    this.sheetsStale = true
    this.changed()
    this.syncPending()
    if (cells.some((c) => c.type === 'sheet')) this.recalcSoon()
    if (selectedId) this.focus(selectedId, 'command')
  }

  private clearHistory() {
    this.undoStack = []
    this.redoStack = []
    this.set({ canUndo: false, canRedo: false })
  }

  // ---------------------------------------------------------------- focus
  //
  // Edit mode = the cell's editor has focus. Command mode = the cell element
  // itself has focus, and single keys act on cells (see KherveBook.tsx).

  registerEditor(id: string, view: EditorView) {
    this.editors.set(id, view)
    const a = this.pendingEditorAction
    if (a?.id === id) {
      this.pendingEditorAction = null
      view.focus()
      a.fn(view)
    }
    const p = this.pendingFocus
    if (p?.id === id && p.mode === 'edit') {
      this.pendingFocus = null
      this.focusEditor(view, p.at)
    }
  }

  /** The live source editor of a cell, if it shows one. */
  editorView(id: string): EditorView | undefined {
    return this.editors.get(id)
  }

  unregisterEditor(id: string, view: EditorView) {
    if (this.editors.get(id) === view) this.editors.delete(id)
  }

  registerCellEl(id: string, el: HTMLElement | null) {
    const old = this.cellEls.get(id)
    if (old && old !== el) this.observer?.unobserve(old)
    if (!el) {
      this.cellEls.delete(id)
      this.offscreen.delete(id)
      return
    }
    this.cellEls.set(id, el)
    el.dataset.cellId = id
    this.observer ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        const cid = (e.target as HTMLElement).dataset.cellId
        if (cid) this.setOnScreen(cid, e.isIntersecting)
      }
    })
    this.observer.observe(el)
    const p = this.pendingFocus
    if (p?.id === id && p.mode === 'command') {
      this.pendingFocus = null
      this.focusEl(el)
    }
  }

  focus(id: string, mode: FocusMode, at: Caret = 'keep') {
    const c = this.cell(id)
    if (!c) return
    this.select(id)
    if (mode === 'edit' && !alwaysEdits(c.type)) {
      if (!textEdits(c.type)) mode = 'command'
      else if (!c.editing) this.patch(id, { editing: true })
    }
    const view = mode === 'edit' ? this.editors.get(id) : undefined
    const el = mode === 'command' ? this.cellEls.get(id) : undefined
    if (view) this.focusEditor(view, at)
    else if (el) this.focusEl(el)
    else this.pendingFocus = { id, mode, at }
  }

  /** Focus the selected cell again (e.g. after a dialog took the focus away). */
  refocus() {
    const c = this.cell(this.state.selectedId)
    if (c) this.focus(c.id, hasEditor(c) ? 'edit' : 'command')
  }

  /** After a dialog: give the focus back to the notebook unless something else has it now. */
  refocusSoon() {
    setTimeout(() => {
      const a = document.activeElement
      if (!a || a === document.body) this.refocus()
    }, 0)
  }

  /** Run something on the selected cell's editor (toolbar tools), opening the editor if needed. */
  editorCommand(fn: (view: EditorView) => unknown, id = this.state.selectedId) {
    const c = this.cell(id)
    if (!c) return
    const view = this.editors.get(c.id)
    if (view) {
      view.focus()
      fn(view)
      return
    }
    if (!textEdits(c.type)) return
    this.pendingEditorAction = { id: c.id, fn }
    this.focus(c.id, 'edit')
  }

  /** Move to the cell above/below. 'auto' edits code cells and leaves rendered cells selected. */
  focusSibling(id: string, delta: -1 | 1, mode: 'auto' | 'command'): boolean {
    const t = this.state.cells[this.indexOf(id) + delta]
    if (!t) return false
    if (mode === 'command') this.focus(t.id, 'command')
    else this.focus(t.id, hasEditor(t) ? 'edit' : 'command', delta < 0 ? 'end' : 'start')
    return true
  }

  private focusEditor(view: EditorView, at: Caret) {
    view.focus()
    const cell = view.dom.closest<HTMLElement>('.nb-cell')
    if (cell) this.reveal(cell)
    if (at === 'keep') view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) })
    else view.dispatch({ selection: { anchor: at === 'start' ? 0 : view.state.doc.length }, scrollIntoView: true })
  }

  private focusEl(el: HTMLElement) {
    el.focus({ preventScroll: true })
    this.reveal(el)
  }

  /**
   * Scroll the notebook (only the notebook: Element.scrollIntoView would also
   * scroll the desktop when the window hangs off the screen) to show a cell.
   */
  private reveal(el: HTMLElement) {
    const scroller = el.closest<HTMLElement>('.nb-scroll')
    if (!scroller) return
    const r = el.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    const m = 18
    if (r.top < s.top + m) scroller.scrollTop -= s.top + m - r.top
    else if (r.bottom > s.bottom - m) scroller.scrollTop += Math.min(r.bottom - (s.bottom - m), r.top - (s.top + m))
  }

  /** Cells report whether they are on screen: continuous runs pause while theirs is not. */
  setOnScreen(id: string, visible: boolean) {
    if (visible) {
      const was = this.offscreen.delete(id)
      if (was && this.state.loopId === id) this.scheduleFrame(0)
    } else this.offscreen.add(id)
  }

  // ------------------------------------------------------------------ run

  /** Run a cell: code runs, text renders, a sheet recomputes, JavaScript reloads. */
  run(id = this.state.selectedId, after: After = 'stay') {
    const c = this.cell(id)
    if (!c) return
    this.execute(c)
    if (after === 'advance') {
      const next = this.state.cells[this.indexOf(c.id) + 1]
      if (next) this.focus(next.id, hasEditor(next) ? 'edit' : 'command')
      else {
        // Like the desktop: a trailing code cell (not an undo step).
        const cell = makeCell('code')
        this.set({ cells: [...this.state.cells, cell], selectedId: cell.id })
        this.changed()
        this.focus(cell.id, 'edit')
      }
    } else if (after === 'insert') {
      this.insert('code', 'below', 'edit', c.id)
    } else if (!alwaysEdits(c.type)) {
      this.focus(c.id, 'command')
    }
  }

  /** Do what running means for this cell type (queued for Python where needed). */
  private execute(c: Cell, keepGoing = false) {
    switch (c.type) {
      case 'code':
        if (c.source.trim()) this.enqueue([{ kind: 'cell', id: c.id, keepGoing }])
        break
      case 'sheet':
        this.sheetsStale = true
        this.enqueue([{ kind: 'sheets' }])
        break
      case 'js':
        this.patch(c.id, { runs: c.runs + 1 })
        break
      case 'markdown':
      case 'latex':
      case 'svg':
        if (c.editing) {
          this.editors.delete(c.id)
          this.patch(c.id, { editing: false, source: c.type === 'svg' && !c.source.trim() ? BLANK_SVG : c.source })
        }
        break
      case 'note':
      case 'file':
      case 'kfit':
      case 'mol':
        break
      case 'ktex':
        this.handles.get(c.id)?.refresh?.() // desktop KTexCell.execute: show the pages again
        break
      case 'other':
        break
    }
  }

  /** Desktop Run All: restart the kernel, then run every cell top to bottom. */
  runAll() {
    this.stopLoop()
    this.cancelQueued()
    this.counter = 0
    this.store.setState((s) => ({ cells: s.cells.map((c) => (c.type === 'code' && c.state === 'idle' ? { ...c, count: null } : c)) }))
    this.enqueue([{ kind: 'reset' }])
    for (const c of this.state.cells) this.execute(c, true)
  }

  /** Every cell of a freshly loaded example, like the desktop's load_example. */
  private runLoaded() {
    let liveId: string | null = null
    let liveMs = LOOP_MS
    for (const c of this.state.cells) {
      if (c.type === 'code' && !liveId) {
        const m = LIVE_RE.exec(c.source.trim() ? c.source.split('\n')[0] : '')
        if (m) {
          liveId = c.id
          liveMs = Number(m[1] ?? LOOP_MS)
          continue
        }
      }
      if (c.source.trim() || c.type === 'svg') this.execute(c, true)
    }
    if (liveId) this.startLoop(liveId, liveMs)
  }

  /** Start Python now instead of on the first run. */
  startKernel() {
    if (!this.jobs.some((j) => j.kind === 'boot')) this.enqueue([{ kind: 'boot' }])
  }

  /** Re-run a code cell every `ms` until stopped (simulations, animations). One cell at a time. */
  startLoop(id = this.state.selectedId, ms = LOOP_MS) {
    const c = this.cell(id)
    if (!c || c.type !== 'code' || !c.source.trim()) return
    this.stopLoop()
    this.loopMs = Math.max(0, ms)
    this.set({ loopId: c.id })
    this.loopStarted = Date.now()
    this.enqueue([{ kind: 'cell', id: c.id }])
  }

  stopLoop() {
    if (this.loopTimer) clearTimeout(this.loopTimer)
    this.loopTimer = null
    if (this.state.loopId) this.set({ loopId: null })
  }

  /** The next frame of the continuous run, after `delay` ms (waits while the cell is off screen). */
  private scheduleFrame(delay: number) {
    const id = this.state.loopId
    if (!id) return
    if (this.loopTimer) clearTimeout(this.loopTimer)
    this.loopTimer = setTimeout(() => {
      this.loopTimer = null
      if (this.state.loopId !== id) return
      const c = this.cell(id)
      if (!c || c.type !== 'code') return this.stopLoop()
      if (c.state !== 'idle' || this.jobs.some((j) => j.kind === 'cell' && j.id === id)) return
      if (document.hidden || this.offscreen.has(id)) return // resumed by visibility / on-screen events
      this.loopStarted = Date.now()
      this.enqueue([{ kind: 'cell', id }])
    }, delay)
  }

  /** Desktop "Restart This Cell": forget the globals it created, then run it again. */
  restartCell(id = this.state.selectedId) {
    const c = this.cell(id)
    if (!c || c.type !== 'code') return
    const names = [...(this.introduced.get(c.id) ?? [])]
    this.introduced.delete(c.id)
    this.enqueue([{ kind: 'forget', names }, { kind: 'cell', id: c.id }])
  }

  /** The red stop button: end the continuous run; else cancel the queue (and offer to stop a running cell). */
  async stop() {
    if (this.state.loopId) {
      this.stopLoop()
      this.cancelQueued()
      return
    }
    this.cancelQueued()
    if (!this.runningId) return
    const ok = await os.dialog.confirm(
      'Python running in the browser cannot be interrupted in the middle of a cell. Restart Python to stop it? Variables are lost; files on your drive are kept.',
      { title: 'Stop', okLabel: 'Restart Python', danger: true },
    )
    if (ok && this.runningId) await this.restartPython()
  }

  /** Desktop Kernel > Restart: fresh variables and In [ ] counters. A running cell needs a new Python. */
  async restartKernel() {
    this.stopLoop()
    this.cancelQueued()
    if (this.runningId) return this.restartPython()
    this.counter = 0
    this.store.setState((s) => ({ cells: s.cells.map((c) => (c.type === 'code' && c.count !== null ? { ...c, count: null } : c)) }))
    this.enqueue([{ kind: 'reset' }])
    this.showFlash('Kernel restarted: all variables cleared')
  }

  /** Stop the Python process and start a new one (the only way to stop a running cell). */
  async restartPython() {
    const k = this.kernel
    if (!k) return
    this.stopLoop()
    this.generation++
    this.jobs = []
    this.pumping = false
    this.flushStreams()
    const interrupted = this.runningId
    this.runningId = null
    this.counter = 0
    this.store.setState((s) => ({
      progress: null,
      pending: 0,
      cells: s.cells.map((c) =>
        c.type !== 'code'
          ? c
          : {
              ...c,
              count: null,
              state: 'idle',
              note: null,
              outputs: c.id === interrupted ? appendStreams(c.outputs, [{ name: 'stderr', text: 'Stopped: Python was restarted.\n' }]) : c.outputs,
            },
      ),
    }))
    if (k.status !== 'off') {
      // Restarting while Python is still starting would race with its start-up.
      if (k.status === 'starting') await k.start().catch(() => {})
      try {
        await k.restart()
      } catch (e) {
        this.showFlash(errorText(e))
      }
    }
  }

  private enqueue(jobs: Job[]) {
    if (!jobs.length) return
    const ids = new Set(jobs.flatMap((j) => (j.kind === 'cell' ? [j.id] : [])))
    // A cell queued again moves to the end; a sheets job right after another is not needed.
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && ids.has(j.id)))
    for (const j of jobs) if (!(j.kind === 'sheets' && this.jobs[this.jobs.length - 1]?.kind === 'sheets')) this.jobs.push(j)
    if (ids.size) {
      this.store.setState((s) => ({ cells: s.cells.map((c) => (ids.has(c.id) && c.state === 'idle' ? { ...c, state: 'queued' } : c)) }))
    }
    this.syncPending()
    void this.pump()
  }

  private cancelQueued() {
    for (const j of this.jobs) if (j.kind === 'task') j.cancel?.()
    const ids = new Set(this.jobs.flatMap((j) => (j.kind === 'cell' ? [j.id] : [])))
    this.jobs = []
    if (ids.size) {
      this.store.setState((s) => ({ cells: s.cells.map((c) => (ids.has(c.id) && c.state === 'queued' ? { ...c, state: 'idle' } : c)) }))
    }
    this.syncPending()
  }

  private syncPending() {
    const n = this.jobs.filter((j) => j.kind === 'cell').length + (this.runningId ? 1 : 0)
    if (this.state.pending !== n) this.set({ pending: n })
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    const gen = this.generation
    try {
      while (gen === this.generation) {
        const job = this.jobs.shift()
        if (!job) break
        let ok = true
        try {
          if (job.kind === 'cell') ok = await this.runCode(job.id, gen)
          else if (job.kind === 'sheets') await this.computeSheets(gen)
          else if (job.kind === 'reset') await this.resetNamespace()
          else if (job.kind === 'forget') await this.forget(job.names, gen)
          else if (job.kind === 'boot') await this.prepare(gen)
          else await this.withKernel(gen, job.run)
        } catch (e) {
          if (gen !== this.generation) break
          ok = false
          this.showFlash(errorText(e))
        }
        if (gen !== this.generation) break
        if (job.kind === 'cell' && job.id === this.state.loopId) {
          if (ok) this.scheduleFrame(Math.max(0, this.loopMs - (Date.now() - this.loopStarted)))
          else this.stopLoop() // an error stops the continuous run
        } else if (!ok && !(job.kind === 'cell' && job.keepGoing && this.lastFailure === 'code')) {
          // Like Jupyter: an error cancels the cells queued after it (not during Run All, like the desktop).
          this.cancelQueued()
        }
        this.syncPending()
      }
    } finally {
      if (gen === this.generation) {
        this.pumping = false
        this.syncPending()
      }
    }
  }

  private async withKernel(gen: number, run: (k: PythonKernel, gen: number) => Promise<void>) {
    await this.prepare(gen)
    const k = this.kernel
    if (k && gen === this.generation) await run(k, gen)
  }

  /** Start Python if needed, then (once per Python process) move into the notebook folder. */
  private async boot(gen: number, cellId?: string) {
    const k = this.kernel
    if (!k) throw new Error('Python is not available.')
    if (cellId && k.status !== 'idle' && k.status !== 'busy') this.patch(cellId, { note: STARTING_NOTE })
    await k.start()
    if (gen !== this.generation || this.booted) return
    let out = ''
    const r = await k.runCell(setupCode(this.workDir()), { onStdout: (t) => (out += t) })
    if (gen !== this.generation) return
    this.booted = true
    if (!r.ok) console.warn('[KherveBook] notebook setup:', r.error?.message)
    this.set({ pyodideVersion: k.version, ...(out.trim() ? { pyVersion: out.trim() } : {}) })
    if (cellId) this.patch(cellId, { note: null })
  }

  /** Python started, and the namespace seeded like the desktop kernel (np, plt, pd, math, ks…). */
  private async prepare(gen: number, cellId?: string) {
    await this.boot(gen, cellId)
    const k = this.kernel
    if (!k || gen !== this.generation || this.seeded) return
    if (cellId) this.patch(cellId, { note: PRELOAD_NOTE })
    this.set({ progress: PRELOAD_NOTE })
    const r = await k.runCell(PRELOAD_CODE, { onStatus: (t) => gen === this.generation && cellId && this.progress(cellId, t) })
    if (gen !== this.generation) return
    this.seeded = true // even when a library failed to load: don't retry before every cell
    if (!r.ok) console.warn('[KherveBook] preload:', r.error?.message)
    if (cellId) this.patch(cellId, { note: null })
    this.set({ progress: null })
  }

  private async resetNamespace() {
    this.filesSynced = null
    this.counter = 0
    this.seeded = false
    this.lazyLoaded.clear()
    this.introduced.clear()
    this.sheetsStale = true
    this.store.setState((s) => ({
      cells: s.cells.map((c) => (c.type === 'code' && c.state !== 'running' && c.count !== null ? { ...c, count: null } : c)),
    }))
    const k = this.kernel
    if (k && (k.status === 'idle' || k.status === 'busy')) await k.resetNamespace()
  }

  private async forget(names: string[], gen: number) {
    const k = this.kernel
    if (!names.length || !k || (k.status !== 'idle' && k.status !== 'busy')) return
    await this.prepare(gen)
    if (gen === this.generation) await k.runCell(forgetCode(names))
  }

  private async runCode(id: string, gen: number): Promise<boolean> {
    const k = this.kernel
    const c = this.cell(id)
    if (!k || !c || c.type !== 'code' || !c.source.trim()) {
      if (c?.state === 'queued') this.patch(id, { state: 'idle' })
      return true
    }
    const live = () => gen === this.generation
    // A frame of a continuous run replaces its outputs at the end: no flicker.
    const frame = this.state.loopId === id
    const buffer: { name: StreamName; text: string }[] = []
    const prep = prepareCode(c.source)
    const count = ++this.counter
    this.runningId = id
    this.patch(id, frame ? { state: 'running', count } : { state: 'running', outputs: [], count, note: null })
    this.syncPending()
    const out = (name: StreamName) => (t: string) => {
      if (!live() || !t) return
      if (!frame) return this.stream(id, name, t)
      const last = buffer[buffer.length - 1]
      if (last?.name === name) last.text = capStream(last.text + t)
      else buffer.push({ name, text: t })
    }
    const handlers: RunHandlers = {
      onStdout: out('stdout'),
      onStderr: out('stderr'),
      onStatus: (t) => live() && this.progress(id, t),
    }
    let stage: 'start' | 'install' | 'run' = 'start'
    let ok = true
    this.lastFailure = 'code'
    try {
      await this.prepare(gen, id)
      if (!live()) return false
      // kf("name") and kfit(): the File and KFit cells' files, where Python can read them.
      await this.syncFiles(gen)
      if (!live()) return false
      // Code reads sheet1, sheet2…: make sure they are current.
      if (this.sheetsStale && this.hasSheets()) {
        await this.computeSheets(gen)
        if (!live()) return false
      }
      const lazy = lazyNeeds(prep.code).filter((n) => !this.lazyLoaded.has(n))
      if (lazy.length) {
        await k.runCell(lazyImportCode(lazy), { onStatus: (t) => live() && this.progress(id, t) })
        if (!live()) return false
        lazy.forEach((n) => this.lazyLoaded.add(n))
      }
      for (const n of prep.notes) out('stderr')(n + '\n')
      if (prep.packages.length) {
        stage = 'install'
        this.progress(id, `Installing ${prep.packages.join(', ')}…`)
        await k.install(prep.packages, handlers)
        if (!live()) return false
        this.patch(id, { note: null })
      }
      if (prep.code.trim()) {
        stage = 'run'
        const r = (await k.runCell(prep.code, handlers)) as CellResult & { new_names?: unknown }
        if (!live()) return false
        this.flushStreams()
        const outs: Output[] = frame ? buffer.map((b) => ({ kind: 'stream', ...b }) as Output) : []
        if (r.result !== null) outs.push({ kind: 'result', text: r.result, count })
        if (r.error) {
          const hint = r.error.type === 'SyntaxError' && prep.magicLines.length ? MAGIC_HINT : ''
          outs.push({ kind: 'error', ename: r.error.type, evalue: r.error.message, traceback: r.error.traceback + hint })
        }
        for (const f of r.figures) outs.push({ kind: 'image', mime: 'image/png', data: f })
        if (frame) this.patch(id, { outputs: outs })
        else if (outs.length) this.patch(id, (cell) => ({ outputs: [...cell.outputs, ...outs] }))
        if (Array.isArray(r.new_names) && r.new_names.length) {
          const set = this.introduced.get(id) ?? new Set<string>()
          for (const n of r.new_names) if (typeof n === 'string') set.add(n)
          this.introduced.set(id, set)
        }
        ok = r.ok
      }
      if (this.hasSheets()) await this.drainSheetWrites(gen)
    } catch (e) {
      if (!live()) return false
      this.flushStreams()
      if (stage === 'start') this.lastFailure = 'kernel'
      const msg = errorText(e)
      const error: Output =
        stage === 'install'
          ? { kind: 'error', ename: '', evalue: `Could not install ${prep.packages.join(', ')}`, traceback: msg }
          : { kind: 'error', ename: '', evalue: msg, traceback: '' }
      this.patch(id, (cell) => ({ outputs: [...(frame ? [] : cell.outputs), error] }))
      ok = false
    } finally {
      if (live()) {
        this.flushStreams()
        if (this.runningId === id) this.runningId = null
        this.patch(id, { state: 'idle', note: null })
        this.set({ progress: null })
        this.syncPending()
      }
    }
    return ok
  }

  private stream(id: string, name: StreamName, text: string) {
    if (!text) return
    let list = this.streams.get(id)
    if (!list) this.streams.set(id, (list = []))
    const last = list[list.length - 1]
    if (last && last.name === name) last.text += text
    else list.push({ name, text })
    // Many small writes (a print in a loop) become one update per frame or so.
    this.streamTimer ??= setTimeout(() => this.flushStreams(), 40)
  }

  private flushStreams() {
    if (this.streamTimer) clearTimeout(this.streamTimer)
    this.streamTimer = null
    if (!this.streams.size) return
    const batch = this.streams
    this.streams = new Map()
    this.store.setState((s) => ({
      cells: s.cells.map((c) => {
        const add = batch.get(c.id)
        return add ? { ...c, outputs: appendStreams(c.outputs, add) } : c
      }),
    }))
  }

  private progress(id: string, text: string) {
    const t = text.trim()
    if (!t) return
    this.patch(id, { note: t })
    this.set({ progress: t })
  }

  // --------------------------------------------------------------- sheets
  //
  // Sheet cells hold their grids as raw text; Python computes the =formulas
  // (with the kernel's namespace) and publishes each grid as sheet1, sheet2…
  // in document order, like the desktop's SheetCell.execute.

  hasSheets(): boolean {
    return this.state.cells.some((c) => c.type === 'sheet')
  }

  /** Edit a sheet cell's workbook (an undo step unless `record` is false). */
  editSheet(id: string, fn: (b: Workbook) => Workbook, record = true) {
    const c = this.cell(id)
    if (!c || c.type !== 'sheet') return
    const next = fn(parseWorkbook(c.source))
    const source = serializeWorkbook(next)
    if (source === c.source) return
    if (record) this.record()
    this.patch(id, { source })
    this.sheetsStale = true
    this.changed()
    this.recalcSoon()
  }

  registerSheet(id: string, h: SheetHandle | null) {
    if (h) this.sheetUi.set(id, h)
    else this.sheetUi.delete(id)
  }

  /** The sheet toolbar: rows, columns and sheets of the selected sheet cell. */
  sheetOp(op: SheetOp, id = this.state.selectedId) {
    const c = this.cell(id)
    if (!c || c.type !== 'sheet') return
    const h = this.sheetUi.get(c.id)
    const i = h?.sheetIndex ?? 0
    if (op === 'addSheet') {
      if (h) h.addSheet()
      else this.editSheet(c.id, addSheet)
      return
    }
    this.editSheet(c.id, (b) =>
      op === 'addRow' ? addRow(b, i) : op === 'addCol' ? addCol(b, i) : op === 'delRow' ? deleteRow(b, i, h?.row ?? -1) : deleteCol(b, i, h?.col ?? -1),
    )
  }

  /** Recompute the formulas shortly after an edit (desktop: 300 ms), when Python is running. */
  private recalcSoon() {
    if (this.recalcTimer) clearTimeout(this.recalcTimer)
    this.recalcTimer = setTimeout(() => {
      this.recalcTimer = null
      const s = this.kernel?.status
      if ((s === 'idle' || s === 'busy') && this.sheetsStale && this.hasSheets()) this.enqueue([{ kind: 'sheets' }])
    }, 300)
  }

  private async computeSheets(gen: number) {
    const k = this.kernel
    if (!k) return
    await this.prepare(gen)
    if (gen !== this.generation) return
    const cells = this.state.cells.filter((c) => c.type === 'sheet')
    if (!cells.length) return
    this.sheetsStale = false // an edit during the compute marks it stale again
    const vars = new Map<string, { id: string; index: number }>()
    const payload: SheetPayloadCell[] = cells.map((c) => {
      const b = parseWorkbook(c.source)
      b.sheets.forEach((_s, index) => vars.set(`sheet${vars.size + 1}`, { id: c.id, index }))
      return { id: c.id, sheets: b.sheets }
    })
    let out = ''
    const r = await k.runCell(computeCode(payload), { onStdout: (t) => (out += t) })
    if (gen !== this.generation) return
    if (!r.ok) {
      console.warn('[KherveBook] sheet formulas:', r.error?.message)
      return
    }
    this.sheetVars = vars
    let results: { id: string; display: Record<string, string>[]; plots: string[] }[] = []
    try {
      results = JSON.parse(out)
    } catch {
      return
    }
    const byId = new Map(results.map((x) => [x.id, x]))
    this.store.setState((s) => ({
      cells: s.cells.map((c) => {
        const x = byId.get(c.id)
        if (!x || c.type !== 'sheet') return c
        const sheet: SheetResult = { display: x.display ?? [], plots: x.plots ?? [] }
        return { ...c, sheet }
      }),
    }))
  }

  /** ks("A1", value) writes from a code cell go back into the live grid. */
  private async drainSheetWrites(gen: number) {
    const k = this.kernel
    if (!k) return
    let out = ''
    await k.runCell(drainCode(), { onStdout: (t) => (out += t) })
    if (!out.trim() || gen !== this.generation) return
    let writes: [string, string, string][] = []
    try {
      writes = JSON.parse(out)
    } catch {
      return
    }
    const edits = new Map<string, Map<number, { r: number; c: number; raw: string }[]>>()
    for (const [name, ref, raw] of writes) {
      const target = this.sheetVars.get(name)
      const p = parseRef(ref)
      if (!target || !p) continue
      let perCell = edits.get(target.id)
      if (!perCell) edits.set(target.id, (perCell = new Map()))
      const list = perCell.get(target.index) ?? []
      list.push({ ...p, raw })
      perCell.set(target.index, list)
    }
    for (const [id, perSheet] of edits) {
      this.editSheet(id, (b) => [...perSheet].reduce((acc, [index, list]) => setCells(acc, index, list), b), false)
    }
    if (edits.size) this.enqueue([{ kind: 'sheets' }])
  }

  /** Right-click > Create Plot: chart a block of a sheet as a saved plot view. */
  createPlot(id: string, sheetIndex: number, range: { r1: number; c1: number; r2: number; c2: number }, kind: 'line' | 'bar' | 'scatter') {
    const c = this.cell(id)
    if (!c || c.type !== 'sheet') return
    this.sheetsStale = true
    this.enqueue([
      { kind: 'sheets' },
      {
        kind: 'task',
        run: async (k, gen) => {
          let varName = ''
          for (const [name, t] of this.sheetVars) if (t.id === id && t.index === sheetIndex) varName = name
          if (!varName) return
          const b = parseWorkbook(this.cell(id)?.source ?? '')
          const title = `Chart ${b.plots.length + 1}`
          let png = ''
          await k.runCell(plotRangeCode({ var: varName, ...range, kind, title }), { onStdout: (t) => (png += t) })
          if (gen !== this.generation || !png.trim()) {
            if (!png.trim()) this.showFlash('Nothing numeric to plot in the selection')
            return
          }
          this.editSheet(id, (wb) => ({ ...wb, plots: [...wb.plots, { title, png: png.trim() }] }))
        },
      },
    ])
  }

  // ------------------------------------------------------------------- AI

  /** Add a cell at `index` without moving the keyboard focus (KherveOS AI tools). Undoable. */
  addCell(type: CellType, source: string, index: number): string {
    this.record()
    const cell = makeCell(type, source, false)
    const cells = this.state.cells.slice()
    cells.splice(Math.max(0, Math.min(index, cells.length)), 0, cell)
    this.set({ cells, selectedId: cell.id })
    if (type === 'sheet') this.sheetsStale = true
    this.changed()
    return cell.id
  }

  /** Run cells without moving the keyboard focus (KherveOS AI tools). */
  runCells(ids: string[]) {
    for (const id of ids) {
      const c = this.cell(id)
      if (c) this.execute(c, true)
    }
  }

  /** Apply an assistant's cells as one undo step, then run them (desktop _insert_cells). */
  applyCells(items: { type: CellType; source: string; target: number | null }[]): { added: number; replaced: number } {
    if (!items.length) return { added: 0, replaced: 0 }
    this.record()
    const protectedTypes: CellKind[] = ['svg', 'other']
    const cells = this.state.cells.slice()
    const ran: string[] = []
    let replaced = 0
    const appends: Cell[] = []
    for (const it of items) {
      const t = it.target
      if (t !== null && t >= 0 && t < cells.length && !protectedTypes.includes(cells[t].type)) {
        const old = cells[t]
        const sameType = old.type === it.type
        if (!sameType) this.editors.delete(old.id) // its editor is recreated for the new type
        else this.setEditorText(old.id, it.source)
        cells[t] = {
          ...old,
          type: it.type,
          rawType: undefined,
          source: it.source,
          editing: false,
          outputs: sameType ? old.outputs : [],
          count: sameType ? old.count : null,
          sheet: null,
          runs: 0,
        }
        ran.push(old.id)
        replaced++
      } else {
        const cell = makeCell(it.type, it.source, false)
        appends.push(cell)
        ran.push(cell.id)
      }
    }
    const at = this.indexOf(this.state.selectedId)
    cells.splice(at < 0 ? cells.length : at + 1, 0, ...appends)
    this.set({ cells, selectedId: ran[ran.length - 1] ?? this.state.selectedId })
    if (items.some((i) => i.type === 'sheet')) this.sheetsStale = true
    this.changed()
    for (const id of ran) {
      const c = this.cell(id)
      if (c) this.execute(c, true)
    }
    return { added: appends.length, replaced }
  }

  // -------------------------------------------- the cells' own views

  /** A cell view registers what it can do (choose_file, refresh, toggle_bold…). */
  registerHandle(id: string, h: CellHandle): () => void {
    this.handles.set(id, h)
    return () => {
      if (this.handles.get(id) === h) this.handles.delete(id)
    }
  }

  /** The toolbar's tools for a cell (desktop CellToolBar calling the focused cell's methods). */
  callCell(id: string, method: string, ...args: unknown[]) {
    const fn = this.handles.get(id)?.[method] as ((...a: unknown[]) => unknown) | undefined
    if (fn) return fn(...args)
    if (method === 'openInApp' && typeof args[0] === 'string') return this.openInApp(id, args[0])
  }

  /** The Note tools changed: font and size apply to the selection of the Note cell `id`. */
  setNoteTools(p: Partial<NoteTools>, id?: string | null, apply?: 'fontFamily' | 'fontSize') {
    this.note.setState(p)
    if (id && apply === 'fontFamily' && p.font) this.callCell(id, 'setFontFamily', p.font)
    if (id && apply === 'fontSize' && p.size) this.callCell(id, 'setFontSize', p.size)
  }

  /** A view changed its cell's JSON document (typing in a note, a new attachment…). */
  updateCell(id: string, source: string, undoable = false) {
    const c = this.cell(id)
    if (!c || c.source === source) return
    if (undoable) this.record()
    this.patch(id, { source })
    this.changed()
  }

  /** The folder of the notebook's file and its name without extension (the sidecar is "<stem>_files"). */
  docPlace(): { dir: string | null; stem: string } {
    const p = this.state.path
    if (!p) return { dir: null, stem: 'notebook' }
    const name = basename(p)
    const e = extname(name)
    return { dir: dirname(p), stem: e ? name.slice(0, -e.length) : name }
  }

  /** The bytes of an attachment: embedded, or from the sidecar folder. Null when missing. */
  async attachmentBytes(a: Attachment): Promise<Uint8Array | null> {
    if (a.path) {
      const { dir } = this.docPlace()
      const full = dir ? join(dir, a.path) : null
      if (full && os.fs.isFile(full)) return os.fs.readBytes(full)
    }
    if (a.embed !== undefined) {
      try {
        return b64ToBytes(a.embed)
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * An attachment as a file on the drive (desktop _Attachment.resolved_path): its sidecar file,
   * or — before the notebook is saved — a copy in the hidden cache folder. Null when missing.
   */
  async attachmentPath(id: string, a: Attachment): Promise<string | null> {
    if (a.path) {
      const { dir } = this.docPlace()
      const full = dir ? join(dir, a.path) : null
      if (full && os.fs.isFile(full)) return full
    }
    if (a.embed === undefined) return null
    const target = join(CACHE_DIR, this.ns, id, a.name)
    if (this.exported.get(target) !== a.embed || !os.fs.isFile(target)) {
      const bytes = await this.attachmentBytes(a)
      if (!bytes) return null
      await os.fs.writeBytes(target, bytes, { mkdirs: true })
      this.exported.set(target, a.embed)
    }
    return target
  }

  /** On save: every attachment goes to "<stem>_files/" beside the notebook, the .kbook keeps its path (desktop prepare_save). */
  private async materialize(target: string) {
    const dir = dirname(target)
    const name = basename(target)
    const stem = extname(name) ? name.slice(0, -extname(name).length) : name
    const claimed = new Set<string>()
    for (const c of this.state.cells) {
      const files = cellAttachments(c.type, c.source)
      if (!files.length) continue
      let moved = false
      const out: Attachment[] = []
      for (const a of files) {
        const rel = claimPath(stem, a.name, claimed)
        const full = join(dir, rel)
        if (a.embed === undefined && a.path === rel && os.fs.isFile(full)) {
          out.push(a)
          continue
        }
        const bytes = await this.attachmentBytes(a)
        if (!bytes) {
          out.push(a) // missing: keep the reference as it was
          continue
        }
        await os.fs.writeBytes(full, bytes, { mkdirs: true })
        out.push({ name: a.name, size: bytes.length, path: rel })
        moved = true
      }
      if (moved) this.patch(c.id, { source: withAttachments(c.type, c.source, out) })
    }
  }

  /** Before code runs: kf("name") and kfit(…) know the notebook's attached files (desktop Kernel._make_kf / _make_kfit). */
  private async syncFiles(gen: number) {
    const k = this.kernel
    if (!k) return
    const files: Record<string, string> = {}
    const kfits: { path: string | null; name: string; title: string }[] = []
    for (const c of this.state.cells) {
      if (c.type === 'file') {
        for (const a of parseFiles(c.source)) {
          if (files[a.name]) continue
          const p = await this.attachmentPath(c.id, a)
          if (p) files[a.name] = p
        }
      } else if (c.type === 'kfit') {
        const f = parseKfit(c.source).file
        kfits.push({ path: f ? await this.attachmentPath(c.id, f) : null, name: f?.name ?? '', title: c.title })
      }
    }
    const { dir } = this.docPlace()
    const nbDir = dir && isInside(dir, HOME) ? dir : null
    if (kfits.length) await this.installKfit(k)
    const code = kfCode(files, nbDir, kfits)
    if (code === this.filesSynced || gen !== this.generation) return
    const r = await k.runCell(code)
    if (gen === this.generation && r.ok) this.filesSynced = code
  }

  /** The desktop's kfitio / kfitmodels (unchanged) and the cell's view, installed in Python once. */
  private async installKfit(k: PythonKernel) {
    if (this.kfitInstalled) return
    const base = `${import.meta.env.BASE_URL}apps/khervebook/py/kbook_kfit/`
    const files: Record<string, string> = {}
    for (const f of ['__init__.py', 'kfitio.py', 'kfitmodels.py', 'view.py']) {
      const res = await fetch(base + f)
      if (!res.ok) throw new Error(`Could not load ${f} for the KFit cell.`)
      files[f] = await res.text()
    }
    const r = await k.runCell(
      'def _kb_install(files):\n' +
        '    import importlib, os, sys\n' +
        "    os.makedirs('/kherveos/kbook_kfit', exist_ok=True)\n" +
        '    for n, t in files.items():\n' +
        "        open('/kherveos/kbook_kfit/' + n, 'w', encoding='utf-8').write(t)\n" +
        "    '/kherveos' in sys.path or sys.path.insert(0, '/kherveos')\n" +
        "    [sys.modules.pop(m) for m in list(sys.modules) if m.split('.')[0] == 'kbook_kfit']\n" +
        '    importlib.invalidate_caches()\n' +
        `_kb_install(${JSON.stringify(files)})\n` +
        'del _kb_install',
    )
    if (!r.ok) throw new Error(r.error?.message ?? 'The KFit cell could not start.')
    this.kfitInstalled = true
  }

  /** Run something in this notebook's Python, after the cells queued before it. */
  pythonTask<T>(fn: (k: PythonKernel) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.enqueue([
        {
          kind: 'task',
          run: async (k) => {
            try {
              resolve(await fn(k))
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)))
            }
          },
          cancel: () => reject(new Error('Cancelled')),
        },
      ])
    })
  }

  /** The KFit cell's plot or table, drawn by the desktop's code in Python (JSON from kbook_kfit.view.render). */
  async kfitView(path: string, sheet: string, view: 'plot' | 'data', fileName: string): Promise<Record<string, unknown>> {
    return this.pythonTask(async (k) => {
      await this.installKfit(k)
      let out = ''
      const START = '\x02KB-JSON\x03'
      const r = await k.runCell(
        `print(${JSON.stringify(START)} + __import__('kbook_kfit.view', fromlist=['view']).render(${JSON.stringify(path)}, ${JSON.stringify(sheet)}, ${JSON.stringify(view)}, ${JSON.stringify(fileName)}))`,
        { onStdout: (t) => (out += t) },
      )
      if (!r.ok) throw new Error(r.error?.message ?? 'The project could not be read.')
      const at = out.lastIndexOf(START)
      return JSON.parse(out.slice(at + START.length)) as Record<string, unknown>
    })
  }

  // ---------------------------------------------- Open in another app

  /**
   * Hand a cell to another Kherve app on a file, and take it back when that app saves it
   * (desktop appbridge.AppBridge: KhervePY, KherveSheet, KhervePaint, KherveFitting, KherveTeX, KherveMol).
   */
  async openInApp(id: string, app: string) {
    const c = this.cell(id)
    if (!c) return
    const spec = await this.bridgeSpec(c, app)
    if (!spec) return
    const dir = join(CACHE_DIR, 'open', this.ns)
    const target = join(dir, spec.name)
    try {
      if (typeof spec.data === 'string') await os.fs.writeText(target, spec.data, { mkdirs: true })
      else await os.fs.writeBytes(target, spec.data, { mkdirs: true })
    } catch (e) {
      await os.dialog.alert(`Could not hand the cell to ${spec.label}.\n\n${errorText(e)}`, { title: 'kBook' })
      return
    }
    const written = typeof spec.data === 'string' ? spec.data : bytesToB64(spec.data)
    this.bridges.set(target, { id, text: typeof spec.data === 'string', written, reload: spec.reload })
    os.open(app, { path: target })
    this.showFlash(`Opened in ${spec.label} — saving there updates this cell`)
  }

  private async bridgeChanged(path: string) {
    const b = this.bridges.get(path)
    if (!b || !this.cell(b.id)) return
    try {
      const bytes = await os.fs.readBytes(path)
      const now = b.text ? new TextDecoder().decode(bytes) : bytesToB64(bytes)
      if (now === b.written) return
      b.written = now
      b.reload(bytes)
    } catch {
      /* the other app is still writing: the next change event brings it */
    }
  }

  private async bridgeSpec(
    c: Cell,
    app: string,
  ): Promise<{ label: string; name: string; data: string | Uint8Array; reload: (data: Uint8Array) => void } | null> {
    const n = this.indexOf(c.id) + 1
    const stem = `${this.docPlace().stem === 'notebook' ? 'Untitled' : this.docPlace().stem}-cell${n}`
    const text = (data: Uint8Array) => new TextDecoder().decode(data)
    const id = c.id
    switch (app) {
      case 'khervepy':
        return { label: 'kPY', name: `${stem}.py`, data: c.source, reload: (d) => this.replaceSource(id, text(d)) }
      case 'khervepaint':
        return { label: 'kPaint', name: `${stem}.svg`, data: c.source.trim() ? c.source : BLANK_SVG, reload: (d) => this.replaceSource(id, text(d)) }
      case 'khervesheet': {
        // The web KherveSheet reads CSV: the sheet shown goes over as values (formulas stay here).
        const book = parseWorkbook(c.source)
        const i = Math.max(0, book.sheets.findIndex((s) => s.name === book.active))
        return {
          label: 'kSheet',
          name: `${stem}.csv`,
          data: sheetCsv(book, i),
          reload: (d) => this.editSheet(id, (b) => csvIntoSheet(b, i, text(d))),
        }
      }
      case 'khervemol': {
        const m = parseMol(c.source)
        const kmol = Object.keys(m.kmol).length ? m.kmol : { format: 'khervemol', version: 5 }
        return {
          label: 'kMol',
          name: `${stem}.kmol`,
          data: JSON.stringify(kmol, null, 1),
          reload: (d) => {
            try {
              const doc = JSON.parse(text(d)) as Record<string, unknown>
              const cur = this.cell(id)
              if (cur) this.replaceSource(id, molSource({ ...parseMol(cur.source), kmol: doc as never }))
            } catch {
              /* not JSON yet */
            }
          },
        }
      }
      case 'khervefitting':
      case 'khervetex': {
        const f = c.type === 'kfit' ? parseKfit(c.source).file : c.type === 'ktex' ? parseKtex(c.source).file : null
        if (!f) {
          this.showFlash('This cell holds no document yet.')
          return null
        }
        const bytes = await this.attachmentBytes(f)
        if (!bytes) {
          this.showFlash(`${f.name} is missing.`)
          return null
        }
        return {
          label: app === 'khervefitting' ? 'KherveFitting' : 'kTeX',
          name: f.name,
          data: bytes,
          reload: (d) => {
            const cur = this.cell(id)
            if (!cur) return
            const att: Attachment = { name: f.name, size: d.length, embed: bytesToB64(d) }
            this.replaceSource(id, withAttachments(cur.type, cur.source, [att]))
          },
        }
      }
    }
    return null
  }

  /** Insert a KhervePaint library object into an SVG cell (desktop SvgCell.insert_object). */
  async insertSvgObject(id: string, path: string) {
    try {
      const text = await os.fs.readText(path)
      const inner = /<svg\b[^>]*>([\s\S]*)<\/svg>/i.exec(text)?.[1]?.trim()
      if (!inner) throw new Error('The object has no drawing.')
      this.drawShape(id, `<g transform="translate(40,40)">${inner.replace(/\s*\n\s*/g, ' ')}</g>`)
    } catch (e) {
      this.showFlash(`Could not insert ${basename(path)}: ${errorText(e)}`)
    }
  }

  // ---------------------------------------------------------------- files

  /** The folder dialogs start in, and relative links / images resolve against. */
  baseDir(): string {
    const f = this.state.path ?? this.state.origin
    const d = f ? dirname(f) : NOTEBOOKS
    return os.fs.isDir(d) ? d : HOME
  }

  /** Python's working directory: the notebook's folder (Python only sees the home folder). */
  private workDir(): string {
    const d = this.baseDir()
    return isInside(d, HOME) ? d : HOME
  }

  showFlash(text: string) {
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.set({ flash: text })
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null
      this.set({ flash: null })
    }, 5000)
  }

  /** Desktop _confirm_discard: Save / Don't save / Cancel when there are unsaved changes. */
  async confirmDiscard(): Promise<boolean> {
    if (!this.state.dirty) return true
    const choice = await os.dialog.choose(
      `Do you want to save the changes to "${displayName(this.state)}"?`,
      [
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
        { label: 'Save', value: 'save', primary: true },
      ],
      { title: 'kBook' },
    )
    const ok = choice === 'save' ? await this.save() : choice === 'discard'
    if (!ok) this.refocusSoon()
    return ok
  }

  /** The window's close guard. */
  confirmClose(): Promise<boolean> {
    return this.confirmDiscard()
  }

  /** File > New: an empty notebook in this window. */
  async newNotebook() {
    if (!(await this.confirmDiscard())) return
    this.applyDoc({ kind: 'kbook', cells: [{ type: 'code', source: '' }], extra: {}, version: FORMAT_VERSION }, { path: null, origin: null, untitled: null })
    this.focus(this.state.cells[0].id, 'edit')
  }

  async open(): Promise<void> {
    const target = await os.dialog.openFile({ title: 'Open notebook', extensions: ['.kbook', '.ipynb'], startDir: this.baseDir() })
    if (target) await this.openPath(target)
  }

  /** Open a notebook file in this window (asking to save the current one first). */
  async openPath(path: string, ask = true): Promise<boolean> {
    if (ask && !(await this.confirmDiscard())) return false
    this.set({ loading: true })
    try {
      const doc = parseNotebook(await os.fs.readText(path))
      // An imported .ipynb is never overwritten with .kbook JSON: Save asks where.
      this.applyDoc(doc, { path: doc.kind === 'kbook' ? path : null, origin: path, untitled: null })
      addRecent(path)
      return true
    } catch (e) {
      if (!this.state.cells.length) {
        const c = makeCell('code')
        this.set({ cells: [c], selectedId: c.id })
      }
      this.set({ loading: false })
      await os.dialog.alert(`Could not open "${basename(path)}".\n\n${errorText(e)}`, { title: 'kBook' })
      return false
    }
  }

  /** File > Import Jupyter/Colab: its cells as a new, unsaved notebook. */
  async importIpynb(): Promise<void> {
    const target = await os.dialog.openFile({ title: 'Import Jupyter/Colab notebook', extensions: ['.ipynb'], startDir: this.baseDir() })
    if (!target || !(await this.confirmDiscard())) return
    try {
      const doc = parseNotebook(await os.fs.readText(target))
      this.applyDoc(doc, { path: null, origin: null, untitled: basename(withExt(target, '')) })
      this.changed()
    } catch (e) {
      await os.dialog.alert(`Could not import "${basename(target)}".\n\n${errorText(e)}`, { title: 'kBook' })
    }
  }

  /** An example (or the welcome notebook): a copy, untitled, fully run like the desktop. */
  async openExample(file: string, title: string, ask = true): Promise<boolean> {
    if (ask && !(await this.confirmDiscard())) return false
    this.set({ loading: true })
    try {
      const doc = parseNotebook(await fetchExample(file))
      this.applyDoc(doc, { path: null, origin: null, untitled: file === WELCOME_FILE ? null : title })
      this.runLoaded()
      return true
    } catch (e) {
      if (!this.state.cells.length) {
        const c = makeCell('code')
        this.set({ cells: [c], selectedId: c.id })
      }
      this.set({ loading: false })
      if (file !== WELCOME_FILE) await os.dialog.alert(`Could not open the example "${title}".\n\n${errorText(e)}`, { title: 'kBook' })
      return false
    }
  }

  openWelcome(ask = true) {
    return this.openExample(WELCOME_FILE, 'Welcome to kBook', ask)
  }

  private applyDoc(doc: NotebookDoc, at: { path: string | null; origin: string | null; untitled: string | null }) {
    this.stopLoop()
    this.cancelQueued()
    const cells: Cell[] = doc.cells.map((d) => cellFromData(d))
    if (!cells.length) cells.push(makeCell('code'))
    this.docExtra = doc.extra
    this.docVersion = doc.version
    this.clearHistory()
    this.edits++
    this.editors.clear()
    this.offscreen.clear()
    this.set({ cells, selectedId: cells[0].id, ...at, dirty: false, loading: false })
    // Another notebook in this window: fresh variables, and Python moves to its folder.
    this.counter = 0
    this.booted = false
    this.sheetsStale = true
    const k = this.kernel
    if (k && (k.status === 'idle' || k.status === 'busy')) this.enqueue([{ kind: 'reset' }])
    this.focus(cells[0].id, 'command')
  }

  async save(): Promise<boolean> {
    const p = this.state.path
    return p ? this.writeTo(p) : this.saveAs()
  }

  async saveAs(): Promise<boolean> {
    const { path, origin, untitled } = this.state
    const dir = this.baseDir()
    const suggestion =
      path ?? (origin ? withExt(origin, '.kbook') : join(NOTEBOOKS, os.fs.uniqueName(NOTEBOOKS, untitled ? exampleFileName(untitled) : 'Untitled.kbook')))
    const target = await os.dialog.saveFile({ title: 'Save notebook', extensions: ['.kbook'], startDir: path || origin ? dir : NOTEBOOKS, defaultName: suggestion })
    if (!target) return false
    if (extname(target) === '.ipynb') {
      await os.dialog.alert('kBook saves notebooks as .kbook files. To write a Jupyter notebook, use File → Export as Jupyter/Colab.', {
        title: 'kBook',
      })
      return false
    }
    return this.writeTo(target)
  }

  private async writeTo(target: string, commitMessage?: string): Promise<boolean> {
    const at = this.edits
    try {
      await this.materialize(target)
      await os.fs.writeText(target, serializeKbook(this.state.cells.map(cellData), this.docExtra, this.docVersion), { mkdirs: true })
    } catch (e) {
      await os.dialog.alert(`Could not save "${basename(target)}".\n\n${errorText(e)}`, { title: 'kBook' })
      return false
    }
    this.set({ path: target, origin: target, untitled: null, dirty: this.edits !== at })
    addRecent(target)
    this.showFlash(`Saved to ${pretty(target)}`)
    // Desktop _git_after_save: every save is a snapshot in the notebook folder's Git repository.
    void gitAfterSave(target, commitMessage).then((msg) => msg && this.showFlash(msg))
    return true
  }

  /** Git → Save Snapshot & Upload: save with a message of the user's (desktop _commit_and_maybe_push). */
  async saveSnapshot(message: string): Promise<boolean> {
    const p = this.state.path
    return p ? this.writeTo(p, message) : this.saveAs()
  }

  /** Re-read the notebook from its file (after a download from the cloud or a restored version). */
  async reload(): Promise<void> {
    const p = this.state.path
    if (!p || !os.fs.isFile(p)) return
    try {
      const doc = parseNotebook(await os.fs.readText(p))
      this.applyDoc(doc, { path: p, origin: p, untitled: null })
    } catch (e) {
      this.showFlash(`Reload failed: ${errorText(e)}`)
    }
  }

  async exportIpynb(): Promise<void> {
    const { path, origin, cells, pyVersion, untitled } = this.state
    const dir = this.baseDir()
    const base = path ?? origin
    const suggestion = base ? withExt(base, '.ipynb') : join(dir, os.fs.uniqueName(dir, withExt(untitled ? exampleFileName(untitled) : 'Untitled.kbook', '.ipynb')))
    const target = await os.dialog.saveFile({ title: 'Export as Jupyter/Colab notebook', extensions: ['.ipynb'], startDir: dir, defaultName: suggestion })
    if (!target) return
    try {
      await os.fs.writeText(target, toIpynb(cells, pyVersion), { mkdirs: true })
      this.showFlash(`Exported ${pretty(target)}`)
    } catch (e) {
      await os.dialog.alert(`Could not export "${basename(target)}".\n\n${errorText(e)}`, { title: 'kBook' })
    }
  }

  /** A drive file dropped on (or inserted into) the notebook becomes cells below `ref`. */
  async importFile(path: string, ref: string | null = this.state.selectedId): Promise<boolean> {
    try {
      const cells = await fileToCells(path)
      if (cells === 'kbook') return this.openPath(path)
      if (!cells?.length) return false
      this.record()
      const made = cells.map((d) => cellFromData(d))
      this.place(made, 'below', ref)
      for (const c of made) if (c.type !== 'code' && c.type !== 'sheet') this.execute(c)
      if (made.some((c) => c.type === 'sheet')) this.recalcSoon()
      this.focus(made[made.length - 1].id, 'command')
      return true
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'kBook' })
      return false
    }
  }

  /** File > Insert Image… / Import Spreadsheet…: pick a drive file and import it. */
  async insertFromDrive(kind: 'image' | 'sheet') {
    const extensions = kind === 'image' ? ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.pdf'] : ['.xlsx', '.xlsm', '.csv', '.tsv']
    const target = await os.dialog.openFile({ title: kind === 'image' ? 'Insert image or PDF' : 'Import spreadsheet', extensions, startDir: this.baseDir() })
    if (target) await this.importFile(target)
  }
}

/** A JSON cell's document as the desktop writes it, from whatever text the cell had (desktop set_source + source()). */
function normalJson(type: CellKind, src: string): string {
  switch (type) {
    case 'note':
      return src.trim() ? noteSource(parseNote(src)) : NOTE_STARTER
    case 'file':
      return filesSource(parseFiles(src))
    case 'kfit':
      return kfitSource(parseKfit(src))
    case 'ktex':
      return ktexSource(parseKtex(src))
    case 'mol':
      return molSource(parseMol(src))
    default:
      return src
  }
}

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** One sheet of a workbook cell as CSV (raw values; formulas as their text). */
function sheetCsv(b: Workbook, i: number): string {
  const sh = b.sheets[i]
  if (!sh) return ''
  const out: string[] = []
  for (let r = 0; r < sh.rows; r++) {
    const row: string[] = []
    for (let c = 0; c < sh.cols; c++) row.push(csvField(sh.data[`${colName(c)}${r + 1}`] ?? ''))
    out.push(row.join(','))
  }
  return out.join('\n') + '\n'
}

function colName(c: number): string {
  let s = ''
  let n = c + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** A CSV saved by KherveSheet, back into sheet `i` (cells not in the CSV are cleared). */
function csvIntoSheet(b: Workbook, i: number, csv: string): Workbook {
  const rows = parseWorkbook(csv).sheets[0]
  if (!rows) return b
  const sheets = b.sheets.slice()
  const old = sheets[i]
  sheets[i] = { ...old, rows: Math.max(rows.rows, 1), cols: Math.max(rows.cols, 1), data: rows.data }
  return { ...b, sheets }
}
