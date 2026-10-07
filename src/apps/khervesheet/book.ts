// The workbook of one KherveSheet window: its sheets as the page mirrors
// them, the link to Python (where every formula is computed), selection and
// in-cell editing, undo/redo, and drawing charts. Plain TypeScript around a
// small zustand store the React components read.
//
// Editing operations live in ops.ts and file handling in files.ts; both
// work on a Book.

import { createStore, type StoreApi } from 'zustand'
import type { KernelStatus } from '@/os/python/kernel'
import { SheetBridge, type Answer } from './bridge'
import { Axis } from './geom'
import { allFunctions, type Catalog } from './formula'
import {
  DEFAULT_COL_W, DEFAULT_ROW_H, MAX_COLS, MAX_ROWS, cellSel, expandMerges, inRange, key, keyCol, keyRow, mergeAt, newSheet,
  normRange, parseRange, splitSheetRef, type Cell, type Chart, type Key, type PyOut, type Range, type Raw, type Selection,
  type Sheet,
} from './model'
import { loadView, saveView, type ViewPrefs } from './prefs'

/** An edit in progress (in the cell or in the formula bar). */
export interface Edit {
  sheet: string
  r: number
  c: number
  text: string
  /** The source before editing. */
  original: string
  /** 'enter': started by typing (arrows commit); 'edit': F2 or double-click (arrows move the caret). */
  mode: 'enter' | 'edit'
  where: 'cell' | 'bar'
  caret: number
  /** A reference inserted by clicking a cell (or with the arrows); the next one replaces it. */
  point: { start: number; end: number; r: number; c: number } | null
}

export type ObjectRef = { kind: 'chart' | 'image' | 'equation'; id: string } | null

export interface BookState {
  /** Bumped whenever cells, formats or layout change (the grid redraws). */
  version: number
  sheets: { id: string; name: string }[]
  active: string
  sel: Selection
  edit: Edit | null
  dirty: boolean
  path: string | null
  /** Shown when there is no path: "Untitled" or an example's title. */
  untitled: string
  status: KernelStatus
  busy: number
  progress: string | null
  flash: string | null
  loading: string | null
  canUndo: boolean
  canRedo: boolean
  /** =PY cells waiting for the user's trust, and =PY cells in all. */
  pyPending: number
  pyCells: number
  object: ObjectRef
  /** The copied range (marching ants). */
  ants: { sheet: string; range: Range } | null
  view: ViewPrefs
  ready: boolean
  loops: boolean
}

export interface Step {
  label: string
  sheet: string
  selBefore: Selection
  selAfter: Selection
  undo: () => Promise<void>
  redo: () => Promise<void>
}

export class PyError extends Error {
  trace?: string
  constructor(message: string, trace?: string) {
    super(message)
    this.trace = trace
  }
}

type CellChange = [string, number, number, string, number | null]
type SourceChange = [string, number, number, string]
type PyChange = [string, number, number, { fig: string | null; err: string | null; out: string | null } | null]

const MAX_UNDO = 200

export class Book {
  readonly store: StoreApi<BookState>
  readonly bridge: SheetBridge
  sheets: Sheet[] = []
  catalog: Catalog | null = null
  functions: string[] = []
  trendModels: string[] = []
  solverMethods: string[] = []
  scipyFunctions = new Set<string>()
  /** The desktop's Layout tab settings, kept unchanged. */
  layoutSettings: string | null = null
  /** What the open file is: Save writes .ksheet and .csv in place; other files Save As. */
  docKind: 'ksheet' | 'csv' | 'xlsx' | null = null
  /** The grid's text measurer (autofit), set by the grid. */
  measure: ((text: string, font: string) => number) | null = null
  /** Puts the keyboard focus back on the grid. */
  refocus: () => void = () => {}

  private undoStack: Step[] = []
  private redoStack: Step[] = []
  private savedAt: Step | null = null
  private chartTimer: ReturnType<typeof setTimeout> | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  private loopTimers = new Map<string, ReturnType<typeof setInterval>>()
  private axes = new Map<string, { v: number; rows: number; cols: number; r: Axis; c: Axis }>()
  private unsubs: (() => void)[] = []

  constructor(ns: string) {
    this.bridge = new SheetBridge(ns)
    this.sheets = ['Sheet1', 'Sheet2', 'Sheet3'].map((n) => newSheet(n))
    this.store = createStore<BookState>(() => ({
      version: 0,
      sheets: this.sheets.map((s) => ({ id: s.id, name: s.name })),
      active: this.sheets[0].id,
      sel: cellSel(0, 0),
      edit: null,
      dirty: false,
      path: null,
      untitled: 'Untitled',
      status: 'off',
      busy: 0,
      progress: null,
      flash: null,
      loading: null,
      canUndo: false,
      canRedo: false,
      pyPending: 0,
      pyCells: 0,
      object: null,
      ants: null,
      view: loadView(),
      ready: false,
      loops: true,
    }))
    this.bridge.onBusy = (n) => this.set({ busy: n })
    this.bridge.onProgress = (t) => this.set({ progress: t })
    this.bridge.onRestart = () => this.rebuildRequests()
  }

  get state(): BookState {
    return this.store.getState()
  }

  set(p: Partial<BookState>) {
    this.store.setState(p)
  }

  /** The grid must redraw. */
  bump() {
    this.store.setState((s) => ({ version: s.version + 1 }))
  }

  // ------------------------------------------------------------ lifecycle

  mount() {
    this.unsubs.push(this.bridge.kernel.onStatus((s) => this.set({ status: s })))
    this.set({ status: this.bridge.status })
    void this.boot()
  }

  unmount() {
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.stopLoops()
    if (this.chartTimer) clearTimeout(this.chartTimer)
    if (this.flashTimer) clearTimeout(this.flashTimer)
    for (const sh of this.sheets) this.releaseUrls(sh)
    this.bridge.dispose()
  }

  private booting = false

  private async boot() {
    if (this.booting) return
    this.booting = true
    try {
      const a = await this.bridge.call('init', {}, ['numpy'])
      if (!a.ok) throw new PyError(a.error ?? 'Python could not start the spreadsheet engine.', a.trace)
      this.catalog = a.catalog as Catalog
      this.functions = allFunctions(this.catalog)
      this.trendModels = (a.trendModels as string[]) ?? []
      this.solverMethods = (a.solverMethods as string[]) ?? []
      this.scipyFunctions = new Set((a.scipyFunctions as string[]) ?? [])
      this.set({ ready: true })
    } catch (e) {
      this.showFlash(`Python could not start: ${errorText(e)}`, 12000)
    } finally {
      this.booting = false
    }
  }

  /** What rebuilds the workbook in a Python that had to start again. */
  private rebuildRequests(): { op: string; args: unknown }[] {
    const out: { op: string; args: unknown }[] = [{ op: 'new', args: { sheets: this.sheets.map((s) => s.name) } }]
    for (const sh of this.sheets) out.push({ op: 'replace', args: { sheet: sh.name, cells: this.pythonRaws(sh), numfmts: this.numfmts(sh) } })
    return out
  }

  /** Every cell of a sheet as raw records (snapshots, undo, rebuilding Python). */
  raws(sh: Sheet): Raw[] {
    const out: Raw[] = []
    for (const [k, cell] of sh.cells) if (cell.s || cell.t) out.push(this.raw(sh, keyRow(k), keyCol(k)))
    return out
  }

  /** The cells Python holds: typed cells not answered yet count as they were. */
  private pythonRaws(sh: Sheet): Raw[] {
    const out: Raw[] = []
    for (const [k, cell] of sh.cells) {
      const before = sh.pending.get(k)
      if (before) {
        if (before[2] || before[3]) out.push(before)
      } else if (cell.s || cell.t) out.push(this.raw(sh, keyRow(k), keyCol(k)))
    }
    return out
  }

  numfmts(sh: Sheet): [number, number, string][] {
    const out: [number, number, string][] = []
    for (const [k, f] of sh.formats) if (f.number_format) out.push([keyRow(k), keyCol(k), f.number_format])
    return out
  }

  // ---------------------------------------------------------------- sheets

  sheet(id?: string): Sheet {
    const want = id ?? this.state.active
    return this.sheets.find((s) => s.id === want) ?? this.sheets[0]
  }

  get active(): Sheet {
    return this.sheet()
  }

  byName(name: string): Sheet | undefined {
    const n = name.toLowerCase()
    return this.sheets.find((s) => s.name.toLowerCase() === n)
  }

  publishSheets() {
    this.set({ sheets: this.sheets.map((s) => ({ id: s.id, name: s.name })) })
  }

  activate(id: string) {
    const sh = this.sheets.find((s) => s.id === id)
    if (!sh) return
    // A formula being typed may point at another sheet; anything else ends.
    const e = this.state.edit
    if (e && !e.text.startsWith('=')) this.commitEdit()
    this.set({ active: id, sel: sh.sel, object: null })
    if (this.state.edit && this.state.edit.sheet !== id && this.state.edit.where !== 'bar') this.setEdit({ where: 'bar' })
    this.bump()
    this.scheduleCharts(0)
  }

  /** Row and column positions of a sheet (cached until sizes change). */
  geometry(sh: Sheet): { rows: Axis; cols: Axis } {
    const cached = this.axes.get(sh.id)
    if (cached && cached.v === sh.geomV && cached.rows === sh.rows && cached.cols === sh.cols) return { rows: cached.r, cols: cached.c }
    const r = new Axis(sh.rows, DEFAULT_ROW_H, sh.rowH, sh.hidden)
    const c = new Axis(sh.cols, DEFAULT_COL_W, sh.colW)
    this.axes.set(sh.id, { v: sh.geomV, rows: sh.rows, cols: sh.cols, r, c })
    return { rows: r, cols: c }
  }

  // ----------------------------------------------------------------- cells

  cell(sh: Sheet, r: number, c: number): Cell | undefined {
    return sh.cells.get(key(r, c))
  }

  raw(sh: Sheet, r: number, c: number): Raw {
    const k = key(r, c)
    const cell = sh.cells.get(k)
    return [r, c, cell?.s ?? '', sh.pending.has(k) ? null : (cell?.t ?? ''), cell?.n ?? null]
  }

  rawsIn(sh: Sheet, g: Range): Raw[] {
    const out: Raw[] = []
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push(this.raw(sh, r, c))
    return out
  }

  /** Send a request to Python and apply what it changed. */
  async py<T extends Answer = Answer>(op: string, args: object, hints: string[] = []): Promise<T> {
    const a = await this.bridge.call<T>(op, args, hints)
    if (!a.ok) throw new PyError(a.error ?? 'Python could not do that.', a.trace)
    this.apply(a)
    // Python came back after failing to start: fetch the catalogue now.
    if (!this.state.ready) void this.boot()
    return a
  }

  /** Apply an answer's cell changes to the mirror. */
  apply(a: Answer) {
    const touched: { sheet: string; r: number; c: number }[] = []
    const snap = a.snapshot as Record<string, Raw[]> | undefined
    if (snap)
      for (const [name, cells] of Object.entries(snap)) {
        const sh = this.byName(name)
        if (!sh) continue
        sh.cells = new Map()
        sh.pending.clear()
        for (const [r, c, s, t, n] of cells) if (s || t) sh.cells.set(key(r, c), { s, t: t ?? '', n })
        for (const other of this.sheets) for (const ch of other.charts) ch.stale = true
        this.scheduleCharts()
      }
    for (const [name, r, c, src] of (a.sources as SourceChange[] | undefined) ?? []) {
      const sh = this.byName(name)
      if (!sh) continue
      const k = key(r, c)
      const cell = sh.cells.get(k)
      if (cell) {
        cell.s = src
        if (!cell.s && !cell.t) sh.cells.delete(k)
      } else if (src) sh.cells.set(k, { s: src, t: '', n: null })
      touched.push({ sheet: name, r, c })
    }
    for (const [name, r, c, text, num] of (a.cells as CellChange[] | undefined) ?? []) {
      const sh = this.byName(name)
      if (!sh) continue
      const k = key(r, c)
      const cell = sh.cells.get(k)
      if (cell) {
        cell.t = text
        cell.n = num
        if (!cell.s && !cell.t) sh.cells.delete(k)
      } else if (text) sh.cells.set(k, { s: '', t: text, n: num })
      sh.pending.delete(k)
      touched.push({ sheet: name, r, c })
    }
    for (const [name, r, c, info] of (a.py as PyChange[] | undefined) ?? []) {
      const sh = this.byName(name)
      if (!sh) continue
      const k = key(r, c)
      const old = sh.py.get(k)
      if (old?.url) URL.revokeObjectURL(old.url)
      if (!info) sh.py.delete(k)
      else {
        const out: PyOut = { fig: info.fig, err: info.err, out: info.out, url: null }
        if (info.fig) out.url = URL.createObjectURL(new Blob([info.fig], { type: 'image/svg+xml' }))
        sh.py.set(k, out)
      }
    }
    if (typeof a.pyPending === 'number') this.set({ pyPending: a.pyPending })
    if (typeof a.pythonCells === 'number') this.set({ pyCells: a.pythonCells })
    if (touched.length) this.staleCharts(touched)
    this.bump()
  }

  // -------------------------------------------------------------- charts

  /** The cell ranges a chart reads: [sheet name (lower case), range]. */
  chartRanges(sh: Sheet, ch: Chart): { sheet: string; range: Range }[] {
    const out: { sheet: string; range: Range }[] = []
    for (const ref of [ch.spec.x, ...ch.spec.series.map((s) => s.ref)]) {
      if (!ref || ref.startsWith('@')) continue
      const { sheet, cells } = splitSheetRef(ref)
      const g = parseRange(cells, MAX_ROWS, MAX_COLS)
      if (g) out.push({ sheet: (sheet ?? sh.name).toLowerCase(), range: g })
    }
    return out
  }

  private staleCharts(changes: { sheet: string; r: number; c: number }[]) {
    let any = false
    for (const sh of this.sheets)
      for (const ch of sh.charts) {
        if (ch.stale) continue
        const ranges = this.chartRanges(sh, ch)
        if (changes.some((x) => ranges.some((g) => g.sheet === x.sheet.toLowerCase() && inRange(g.range, x.r, x.c)))) {
          ch.stale = true
          any = true
        }
      }
    if (any) this.scheduleCharts()
  }

  scheduleCharts(delay = 150) {
    if (this.chartTimer) clearTimeout(this.chartTimer)
    this.chartTimer = setTimeout(() => {
      this.chartTimer = null
      void this.renderCharts()
    }, delay)
  }

  /** Draw the active sheet's charts whose data changed. */
  async renderCharts() {
    const sh = this.active
    const todo = sh.charts.filter((c) => c.stale)
    if (!todo.length) return
    for (const c of todo) c.stale = false
    const hints = ['matplotlib', ...(todo.some((c) => c.spec.trendlines?.length) ? ['scipy'] : [])]
    try {
      const a = await this.bridge.call('charts', { charts: todo.map((c) => ({ id: c.id, sheet: sh.name, spec: c.spec })) }, hints)
      if (!a.ok) throw new PyError(a.error ?? 'The charts could not be drawn.')
      for (const r of a.charts as { id: string; svg?: string; fits?: Chart['fits']; error?: string }[]) {
        const ch = sh.charts.find((c) => c.id === r.id)
        if (!ch) continue
        if (ch.url) URL.revokeObjectURL(ch.url)
        ch.url = r.svg ? URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' })) : null
        ch.error = r.error ?? null
        ch.fits = r.fits ?? []
      }
    } catch (e) {
      for (const c of todo) c.error = errorText(e)
    }
    this.bump()
  }

  releaseUrls(sh: Sheet) {
    for (const ch of sh.charts) if (ch.url) URL.revokeObjectURL(ch.url)
    for (const p of sh.py.values()) if (p.url) URL.revokeObjectURL(p.url)
  }

  // ------------------------------------------------------------- selection

  select(sel: Selection, sh = this.active) {
    sh.sel = sel
    if (sh.id === this.state.active) this.set({ sel, object: null })
  }

  selectCell(r: number, c: number, extend = false) {
    const sh = this.active
    const { anchor } = sh.sel
    if (extend) {
      const g = expandMerges(normRange(anchor.r, anchor.c, r, c), sh.merges)
      const ranges = [...sh.sel.ranges.slice(0, -1), g]
      this.select({ ranges, active: sh.sel.active, anchor })
    } else {
      const m = mergeAt(sh.merges, r, c)
      const g = m ? { r1: m[0], c1: m[1], r2: m[0] + m[2] - 1, c2: m[1] + m[3] - 1 } : { r1: r, c1: c, r2: r, c2: c }
      const at = m ? { r: m[0], c: m[1] } : { r, c }
      this.select({ ranges: [g], active: at, anchor: at })
    }
  }

  /** Move the active cell (arrows, Enter, Tab); `extend` grows the selection (Shift). */
  move(dr: number, dc: number, extend = false) {
    const sh = this.active
    const { rows, cols } = this.geometry(sh)
    if (extend) {
      const g = sh.sel.ranges[sh.sel.ranges.length - 1]
      const { anchor } = sh.sel
      // The moving edge is the one away from the anchor.
      let er = anchor.r === g.r1 ? g.r2 : g.r1
      let ec = anchor.c === g.c1 ? g.c2 : g.c1
      er = Math.max(0, Math.min(sh.rows - 1, rows.step(er, dr)))
      ec = Math.max(0, Math.min(sh.cols - 1, cols.step(ec, dc)))
      const ng = expandMerges(normRange(anchor.r, anchor.c, er, ec), sh.merges)
      this.select({ ranges: [...sh.sel.ranges.slice(0, -1), ng], active: sh.sel.active, anchor })
      return
    }
    let { r, c } = sh.sel.active
    const m = mergeAt(sh.merges, r, c)
    if (m) {
      if (dr > 0) r = m[0] + m[2] - 1
      if (dc > 0) c = m[1] + m[3] - 1
    }
    r = Math.max(0, Math.min(sh.rows - 1, rows.step(r, dr)))
    c = Math.max(0, Math.min(sh.cols - 1, cols.step(c, dc)))
    this.selectCell(r, c)
  }

  /** Ctrl+Arrow: to the edge of the data, like Excel. */
  jump(dr: number, dc: number, extend = false) {
    const sh = this.active
    const { rows, cols } = this.geometry(sh)
    const g = sh.sel.ranges[sh.sel.ranges.length - 1]
    const { anchor } = sh.sel
    let r = extend ? (anchor.r === g.r1 ? g.r2 : g.r1) : sh.sel.active.r
    let c = extend ? (anchor.c === g.c1 ? g.c2 : g.c1) : sh.sel.active.c
    const filled = (rr: number, cc: number) => {
      const cell = sh.cells.get(key(rr, cc))
      return !!cell && (!!cell.s || !!cell.t)
    }
    const next = (rr: number, cc: number) => [dr ? rows.step(rr, dr) : rr, dc ? cols.step(cc, dc) : cc] as const
    const atEdge = (rr: number, cc: number) => {
      const [nr, nc] = next(rr, cc)
      return nr === rr && nc === cc
    }
    if (!atEdge(r, c)) {
      let [nr, nc] = next(r, c)
      if (filled(r, c) && filled(nr, nc)) {
        // Run to the last filled cell of this block.
        while (!atEdge(nr, nc)) {
          const [ar, ac] = next(nr, nc)
          if (!filled(ar, ac)) break
          ;[nr, nc] = [ar, ac]
        }
      } else {
        // Run to the next filled cell (or the sheet's edge).
        while (!filled(nr, nc) && !atEdge(nr, nc)) [nr, nc] = next(nr, nc)
      }
      ;[r, c] = [nr, nc]
    }
    if (extend) {
      const ng = expandMerges(normRange(anchor.r, anchor.c, r, c), sh.merges)
      this.select({ ranges: [...sh.sel.ranges.slice(0, -1), ng], active: sh.sel.active, anchor })
    } else this.selectCell(r, c)
  }

  selectAll() {
    const sh = this.active
    this.select({ ranges: [{ r1: 0, c1: 0, r2: sh.rows - 1, c2: sh.cols - 1 }], active: sh.sel.active, anchor: { r: 0, c: 0 } })
  }

  selectRows(r1: number, r2: number, add = false) {
    const sh = this.active
    const g = normRange(r1, 0, r2, sh.cols - 1)
    const at = { r: Math.min(r1, r2), c: 0 }
    this.select({ ranges: add ? [...sh.sel.ranges, g] : [g], active: at, anchor: { r: r1, c: 0 } })
  }

  selectCols(c1: number, c2: number, add = false) {
    const sh = this.active
    const g = normRange(0, c1, sh.rows - 1, c2)
    const at = { r: 0, c: Math.min(c1, c2) }
    this.select({ ranges: add ? [...sh.sel.ranges, g] : [g], active: at, anchor: { r: 0, c: c1 } })
  }

  // --------------------------------------------------------------- editing

  /** Start editing the active cell: with `text` (typing replaced it) or its source. */
  startEdit(text?: string, where: 'cell' | 'bar' = 'cell') {
    const sh = this.active
    const { r, c } = sh.sel.active
    const original = this.cell(sh, r, c)?.s ?? ''
    const t = text ?? original
    this.set({
      edit: { sheet: sh.id, r, c, text: t, original, mode: text === undefined ? 'edit' : 'enter', where, caret: t.length, point: null },
      object: null,
    })
  }

  setEdit(p: Partial<Edit>) {
    const e = this.state.edit
    if (e) this.set({ edit: { ...e, ...p } })
  }

  cancelEdit() {
    if (this.state.edit) this.set({ edit: null })
    this.refocus()
  }

  /** Enter / Tab: keep the edit and move. `all` (Ctrl+Enter) fills every selected cell. */
  commitEdit(dr = 0, dc = 0, all = false) {
    const e = this.state.edit
    if (!e) return
    this.set({ edit: null })
    const sh = this.sheet(e.sheet)
    // Back to the formula's own sheet after pointing at another one.
    if (sh.id !== this.state.active) this.set({ active: sh.id, sel: sh.sel })
    const text = e.text
    if (all && sh.sel.ranges.some((g) => g.r1 !== g.r2 || g.c1 !== g.c2)) {
      const cells: [number, number, string][] = []
      for (const g of sh.sel.ranges) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) cells.push([r, c, text])
      void this.setCells(sh, cells, 'Typing', true)
    } else if (text !== e.original) void this.setCells(sh, [[e.r, e.c, text]], 'Typing', true)
    if (sh.id === this.state.active && (dr || dc)) {
      if (!all) {
        this.selectCell(e.r, e.c)
        this.move(dr, dc)
      }
    }
    this.refocus()
  }

  /**
   * Type sources into cells (like pressing Enter in each): shown at once,
   * computed by Python, undoable. `trust`: the user typed them (=PY runs).
   */
  async setCells(sh: Sheet, cells: [number, number, string][], label: string, trust = false) {
    if (!cells.length) return
    const selBefore = sh.sel
    const before = cells.map(([r, c]) => this.raw(sh, r, c))
    for (const [r, c, src] of cells) {
      const k = key(r, c)
      const cell = sh.cells.get(k)
      if (!sh.pending.has(k)) sh.pending.set(k, this.raw(sh, r, c))
      if (cell) {
        cell.s = src
        cell.t = src
      } else if (src) sh.cells.set(k, { s: src, t: src, n: null })
    }
    this.bump()
    this.markDirty()
    try {
      const a = await this.bridge.call('type', { sheet: sh.name, cells, trust }, this.hintsFor(cells.map((x) => x[2])))
      const reported = new Set(((a.cells as CellChange[] | undefined) ?? []).filter((x) => x[0] === sh.name).map((x) => key(x[1], x[2])))
      for (const [r, c] of cells) {
        const k = key(r, c)
        const prev = sh.pending.get(k)
        if (prev === undefined) continue
        if (!reported.has(k)) {
          // Python shows what it showed before.
          const cell = sh.cells.get(k)
          if (cell) {
            cell.t = prev[3] ?? ''
            cell.n = prev[4]
          }
        }
        sh.pending.delete(k)
      }
      if (!a.ok) throw new PyError(a.error ?? 'Python could not compute that.', a.trace)
      this.apply(a)
      const after = cells.map(([r, c]) => this.raw(sh, r, c))
      // Undo and redo both show the cells that changed.
      const g = cells.reduce((b, [r, c]) => ({ r1: Math.min(b.r1, r), c1: Math.min(b.c1, c), r2: Math.max(b.r2, r), c2: Math.max(b.c2, c) }), {
        r1: cells[0][0], c1: cells[0][1], r2: cells[0][0], c2: cells[0][1],
      })
      const first = { r: cells[0][0], c: cells[0][1] }
      this.record({
        label,
        sheet: sh.id,
        selBefore,
        selAfter: { ranges: [g], active: first, anchor: first },
        undo: () => this.putRaw(sh, before),
        redo: () => this.putRaw(sh, after),
      })
    } catch (e) {
      // Python did not take it: show the cells as they were.
      for (const [r, c, s, t, n] of before) {
        const k = key(r, c)
        sh.pending.delete(k)
        if (s || t) sh.cells.set(k, { s, t: t ?? '', n })
        else sh.cells.delete(k)
      }
      this.bump()
      this.showFlash(errorText(e))
    }
  }

  /** Put cells back exactly as they were (undo / redo). */
  async putRaw(sh: Sheet, cells: Raw[]) {
    if (!cells.length) return
    await this.py('put', { sheet: sh.name, cells }, this.hintsFor(cells.map((x) => x[2])))
  }

  /** Packages a set of sources will need (loaded with progress shown). */
  hintsFor(sources: string[]): string[] {
    const out = new Set<string>()
    for (const s of sources) {
      if (!s || !s.startsWith('=')) continue
      if (/^\s*=PY(\s|$)/i.test(s)) {
        out.add('matplotlib')
        out.add('pandas')
        if (/\bscipy\b/.test(s)) out.add('scipy')
        continue
      }
      const names = s.toUpperCase().match(/[A-Z_][A-Z0-9_.]*(?=\s*\()/g) ?? []
      if (names.some((n) => this.scipyFunctions.has(n.replace(/\./g, '_')))) out.add('scipy')
    }
    return [...out]
  }

  // ------------------------------------------------------------- undo/redo

  record(step: Step) {
    this.undoStack.push(step)
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
    this.markDirty()
    this.set({ canUndo: true, canRedo: false })
  }

  /** Wait until every edit sent to Python has come back and been recorded. */
  async settle() {
    do {
      await this.bridge.idle()
      await new Promise((r) => setTimeout(r, 0))
    } while (this.bridge.pending > 0)
  }

  async undo() {
    if (this.state.edit) return
    await this.settle()
    const step = this.undoStack.pop()
    if (!step) return
    try {
      await step.undo()
      this.redoStack.push(step)
      this.restoreSel(step.sheet, step.selBefore)
      this.showFlash(`Undo ${step.label}`, 1800)
    } catch (e) {
      this.showFlash(errorText(e))
    }
    this.afterHistory()
  }

  async redo() {
    if (this.state.edit) return
    await this.settle()
    const step = this.redoStack.pop()
    if (!step) return
    try {
      await step.redo()
      this.undoStack.push(step)
      this.restoreSel(step.sheet, step.selAfter)
      this.showFlash(`Redo ${step.label}`, 1800)
    } catch (e) {
      this.showFlash(errorText(e))
    }
    this.afterHistory()
  }

  private restoreSel(sheetId: string, sel: Selection) {
    const sh = this.sheets.find((s) => s.id === sheetId)
    if (!sh) return
    if (this.state.active !== sh.id) this.activate(sh.id)
    this.select(sel, sh)
  }

  private afterHistory() {
    const top = this.undoStack[this.undoStack.length - 1] ?? null
    this.set({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, dirty: top !== this.savedAt })
    this.bump()
  }

  clearHistory() {
    this.undoStack = []
    this.redoStack = []
    this.savedAt = null
    this.set({ canUndo: false, canRedo: false })
  }

  markDirty() {
    if (!this.state.dirty) this.set({ dirty: true })
  }

  markSaved() {
    this.savedAt = this.undoStack[this.undoStack.length - 1] ?? null
    this.set({ dirty: false })
  }

  // ------------------------------------------------------------- messages

  showFlash(text: string, ms = 5000) {
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.set({ flash: text })
    this.flashTimer = setTimeout(() => this.set({ flash: null }), ms)
  }

  setView(p: Partial<ViewPrefs>) {
    const view = { ...this.state.view, ...p }
    saveView(view)
    this.set({ view })
    this.bump()
  }

  // ----------------------------------------------------------------- python

  /** Run the workbook's =PY cells (the user trusts the file). */
  async trustPython() {
    this.set({ progress: 'Running the Python cells…' })
    try {
      await this.py('trust', {}, ['matplotlib', 'pandas', 'scipy'])
      this.startLoops()
    } catch (e) {
      this.showFlash(errorText(e))
    } finally {
      this.set({ progress: null })
    }
  }

  /** F9: compute every formula again (random numbers, =PY cells…). */
  async recalc(python: boolean | [string, number, number] = false) {
    try {
      await this.py('recalc', { python }, python ? ['matplotlib', 'pandas'] : [])
    } catch (e) {
      this.showFlash(errorText(e))
    }
  }

  /** =PY cells that re-run on a timer (the desktop's Python loops). */
  startLoops() {
    this.stopLoops()
    if (!this.state.loops || this.state.pyPending > 0) return
    for (const sh of this.sheets)
      for (const [rc, secs] of Object.entries(sh.pyLoops)) {
        const [r, c] = rc.split(',').map(Number)
        const s = Number(secs)
        if (!Number.isFinite(r) || !Number.isFinite(c) || !(s > 0)) continue
        const id = `${sh.id}:${rc}`
        this.loopTimers.set(
          id,
          setInterval(() => {
            if (this.bridge.pending > 0 || this.state.edit) return
            void this.recalc([sh.name, r, c])
          }, Math.max(1, s) * 1000),
        )
      }
  }

  stopLoops() {
    for (const t of this.loopTimers.values()) clearInterval(t)
    this.loopTimers.clear()
  }

  hasLoops(): boolean {
    return this.sheets.some((s) => Object.keys(s.pyLoops).length > 0)
  }

  setLoops(on: boolean) {
    this.set({ loops: on })
    if (on) this.startLoops()
    else this.stopLoops()
  }
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^(\w+Error): /, (_m, t: string) => (t === 'ValueError' || t === 'KeyError' ? '' : `${t}: `))
}

/** Keys of a range, row by row. */
export function rangeKeys(g: Range): Key[] {
  const out: Key[] = []
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push(key(r, c))
  return out
}
