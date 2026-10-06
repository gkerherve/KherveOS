// The notebook behind one KherveBook window: its cells, the Python kernel
// that runs them and the file they are saved to. Plain TypeScript around a
// small zustand store, so the async run queue always sees the current cells
// (React components subscribe to the store).

import { createStore, type StoreApi } from 'zustand'
import { EditorView } from '@codemirror/view'
import { os, HOME, type FsEvent } from '@/os'
import { basename, dirname, extname, isInside, join, pretty } from '@/os/path'
import { PythonKernel, type KernelStatus, type RunHandlers } from '@/os/python/kernel'
import {
  FORMAT_VERSION, makeCell, newId, parseNotebook, serializeKbook, toIpynb,
  type Cell, type CellType, type NotebookDoc, type Output, type StreamName,
} from './format'
import { MAGIC_HINT, prepareCode } from './magics'

export type FocusMode = 'edit' | 'command'
/** What happens after running a cell: stay, select the next one, or insert a new one below. */
export type After = 'stay' | 'advance' | 'insert'
type Caret = 'start' | 'end' | 'keep'

export interface NbState {
  cells: Cell[]
  selectedId: string | null
  /** The .kbook this notebook saves to. Null until saved (new notebooks, imported .ipynb). */
  path: string | null
  /** The file it was opened from (for an imported .ipynb this differs from `path`). */
  origin: string | null
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
  canUndoDelete: boolean
}

type Job = { kind: 'cell'; id: string } | { kind: 'reset' } | { kind: 'boot' }

export const STARTING_NOTE = 'Starting Python… the first start downloads about 10 MB'
const MAX_STREAM = 200_000
const NOTEBOOKS = `${HOME}/Notebooks`

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function displayName(s: Pick<NbState, 'path' | 'origin'>): string {
  return basename(s.path ?? s.origin ?? 'Untitled.kbook')
}

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

/**
 * Run once per Python process, without touching the user's variables: work in
 * the notebook's folder, report the Python version, print line by line (so
 * output streams while a cell runs), and give Jupyter notebooks a plain
 * display() if Python has none.
 */
function setupCode(dir: string): string {
  const d = JSON.stringify(dir)
  return [
    `__import__('os').chdir(${d}) if __import__('os').path.isdir(${d}) else None`,
    `print(__import__('sys').version.split()[0], end='')`,
    `hasattr(__import__('builtins'), 'display') or setattr(__import__('builtins'), 'display', lambda *objs, **kw: None if [print(repr(o)) for o in objs] else None)`,
    `[getattr(f, 'reconfigure', lambda **kw: None)(line_buffering=True) for f in (__import__('sys').stdout, __import__('sys').stderr)] and None`,
  ].join('\n')
}

export class Notebook {
  readonly store: StoreApi<NbState>
  private readonly ns: string
  private kernel: PythonKernel | null = null
  private unsubs: (() => void)[] = []

  // run queue
  private jobs: Job[] = []
  private pumping = false
  /** Bumped by restart / close: work started before is stale and must not touch the cells. */
  private generation = 0
  private counter = 0
  private runningId: string | null = null
  /** Python has moved into the notebook folder and told us its version. */
  private booted = false

  // document
  private docExtra: Record<string, unknown> = {}
  private docVersion = FORMAT_VERSION
  /** Bumped on every change, so a save can tell whether edits happened meanwhile. */
  private edits = 0
  private trash: { cell: Cell; index: number }[] = []

  // DOM
  private editors = new Map<string, EditorView>()
  private cellEls = new Map<string, HTMLElement>()
  private pendingFocus: { id: string; mode: FocusMode; at: Caret } | null = null

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
      dirty: false,
      loading: opening,
      status: 'off',
      pyVersion: null,
      pyodideVersion: null,
      progress: null,
      flash: null,
      pending: 0,
      canUndoDelete: false,
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
    this.unsubs.push(
      k.onStatus((s) => {
        if (s !== 'idle' && s !== 'busy') this.booted = false
        this.set({ status: s })
      }),
      os.fs.watch((ev) => this.onFsEvent(ev)),
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
    if (this.streamTimer) clearTimeout(this.streamTimer)
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.streamTimer = this.flashTimer = null
    this.streams.clear()
  }

  /** Follow the file when it (or a folder above it) is renamed or moved in Files. */
  private onFsEvent(ev: FsEvent) {
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

  setSource(id: string, source: string) {
    const c = this.cell(id)
    if (!c || c.source === source) return
    this.patch(id, { source })
    this.changed()
  }

  /** Add a cell next to `ref` (the selected cell by default) and focus it. */
  insert(type: CellType, where: 'above' | 'below' | 'end' = 'below', mode: FocusMode = 'edit', ref = this.state.selectedId): string {
    const cell = makeCell(type, '', true)
    const cells = this.state.cells.slice()
    const i = this.indexOf(ref)
    cells.splice(where === 'end' || i < 0 ? cells.length : where === 'above' ? i : i + 1, 0, cell)
    this.set({ cells, selectedId: cell.id })
    this.changed()
    this.focus(cell.id, mode)
    return cell.id
  }

  remove(id = this.state.selectedId) {
    const i = this.indexOf(id)
    if (i < 0) return
    const cells = this.state.cells
    const gone = cells[i]
    this.trash.push({ cell: { ...gone, state: 'idle', note: null }, index: i })
    if (this.trash.length > 30) this.trash.shift()
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && j.id === gone.id))
    let rest = cells.filter((c) => c.id !== gone.id)
    if (!rest.length) rest = [makeCell('code')]
    const next = rest[Math.min(i, rest.length - 1)]
    this.editors.delete(gone.id)
    this.set({ cells: rest, selectedId: next.id, canUndoDelete: true })
    this.changed()
    this.syncPending()
    this.focus(next.id, 'command')
  }

  undoDelete() {
    const t = this.trash.pop()
    if (!t) return
    const cell = this.cell(t.cell.id) ? { ...t.cell, id: newId() } : t.cell
    const cells = this.state.cells.slice()
    cells.splice(Math.min(t.index, cells.length), 0, cell)
    this.set({ cells, selectedId: cell.id, canUndoDelete: this.trash.length > 0 })
    this.changed()
    this.focus(cell.id, 'command')
  }

  move(delta: -1 | 1, id = this.state.selectedId) {
    const i = this.indexOf(id)
    const j = i + delta
    const cells = this.state.cells.slice()
    if (i < 0 || j < 0 || j >= cells.length) return
    const c = cells[i]
    const editing = this.editors.get(c.id)?.hasFocus ?? false
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
    this.set({ cells, selectedId: c.id })
    this.changed()
    // React re-inserts DOM nodes when reordering, which can drop focus: restore it once rendered.
    setTimeout(() => this.focus(c.id, editing ? 'edit' : 'command'), 0)
  }

  setType(type: CellType, id = this.state.selectedId) {
    const c = this.cell(id)
    if (!c || c.type === type) return
    const editing = this.editors.get(c.id)?.hasFocus ?? false
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && j.id === c.id))
    this.editors.delete(c.id) // the editor is recreated for the new language
    this.patch(c.id, {
      type,
      editing: type !== 'code',
      outputs: type === 'code' ? c.outputs : [],
      count: type === 'code' ? c.count : null,
      state: c.state === 'queued' ? 'idle' : c.state,
    })
    this.changed()
    this.syncPending()
    this.focus(c.id, editing ? 'edit' : 'command')
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

  // ---------------------------------------------------------------- focus
  //
  // Edit mode = the cell's editor has focus. Command mode = the cell element
  // itself has focus, and single keys act on cells (see KherveBook.tsx).

  registerEditor(id: string, view: EditorView) {
    this.editors.set(id, view)
    const p = this.pendingFocus
    if (p?.id === id && p.mode === 'edit') {
      this.pendingFocus = null
      this.focusEditor(view, p.at)
    }
  }

  unregisterEditor(id: string, view: EditorView) {
    if (this.editors.get(id) === view) this.editors.delete(id)
  }

  registerCellEl(id: string, el: HTMLElement | null) {
    if (!el) {
      this.cellEls.delete(id)
      return
    }
    this.cellEls.set(id, el)
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
    if (mode === 'edit' && c.type !== 'code' && !c.editing) this.patch(id, { editing: true })
    const view = mode === 'edit' ? this.editors.get(id) : undefined
    const el = mode === 'command' ? this.cellEls.get(id) : undefined
    if (view) this.focusEditor(view, at)
    else if (el) this.focusEl(el)
    else this.pendingFocus = { id, mode, at }
  }

  /** Focus the selected cell again (e.g. after a dialog took the focus away). */
  refocus() {
    const c = this.cell(this.state.selectedId)
    if (c) this.focus(c.id, c.type === 'code' || c.editing ? 'edit' : 'command')
  }

  /** After a dialog: give the focus back to the notebook unless something else has it now. */
  refocusSoon() {
    setTimeout(() => {
      const a = document.activeElement
      if (!a || a === document.body) this.refocus()
    }, 0)
  }

  /** Run an editor command (undo, redo, select all) in the selected cell's editor. */
  editorCommand(cmd: (view: EditorView) => boolean) {
    const view = this.editors.get(this.state.selectedId ?? '')
    if (!view) return
    view.focus()
    cmd(view)
  }

  /** Move to the cell above/below. 'auto' edits code cells and leaves rendered text selected. */
  focusSibling(id: string, delta: -1 | 1, mode: 'auto' | 'command'): boolean {
    const t = this.state.cells[this.indexOf(id) + delta]
    if (!t) return false
    if (mode === 'command') this.focus(t.id, 'command')
    else this.focus(t.id, t.type === 'code' || t.editing ? 'edit' : 'command', delta < 0 ? 'end' : 'start')
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

  // ------------------------------------------------------------------ run

  /** Run a code cell (queued behind running ones) or render a Markdown / LaTeX cell. */
  run(id = this.state.selectedId, after: After = 'stay') {
    const c = this.cell(id)
    if (!c) return
    if (c.type === 'code') {
      if (c.source.trim()) this.enqueue([{ kind: 'cell', id: c.id }])
    } else if (c.editing) {
      this.editors.delete(c.id)
      this.patch(c.id, { editing: false })
    }
    if (after === 'advance') {
      const next = this.state.cells[this.indexOf(c.id) + 1]
      if (next) this.focus(next.id, next.type === 'code' || next.editing ? 'edit' : 'command')
      else this.insert('code', 'end')
    } else if (after === 'insert') {
      this.insert('code', 'below', 'edit', c.id)
    } else if (c.type !== 'code') {
      this.focus(c.id, 'command')
    }
  }

  /** Like the desktop app: fresh variables first, then every cell top to bottom. */
  runAll(resetFirst = true) {
    if (this.state.cells.some((c) => c.type !== 'code' && c.editing)) {
      this.store.setState((s) => ({
        cells: s.cells.map((c) => {
          if (c.type === 'code' || !c.editing) return c
          this.editors.delete(c.id)
          return { ...c, editing: false }
        }),
      }))
    }
    this.cancelQueued()
    const jobs: Job[] = resetFirst ? [{ kind: 'reset' }] : []
    for (const c of this.state.cells) if (c.type === 'code' && c.source.trim()) jobs.push({ kind: 'cell', id: c.id })
    this.enqueue(jobs)
  }

  /** Start Python now instead of on the first run. */
  startKernel() {
    if (!this.jobs.some((j) => j.kind === 'boot')) this.enqueue([{ kind: 'boot' }])
  }

  /** Drop the cells waiting to run; a running cell can only be stopped by restarting Python. */
  async interrupt() {
    this.cancelQueued()
    if (!this.runningId) return
    const ok = await os.dialog.confirm(
      'Python running in the browser cannot be interrupted in the middle of a cell. Restart Python to stop it? Variables are lost; files on your drive are kept.',
      { title: 'Interrupt', okLabel: 'Restart Python', danger: true },
    )
    if (ok && this.runningId) await this.restart(false)
  }

  async restart(ask = true, runAllAfter = false) {
    const k = this.kernel
    if (!k) return
    if (
      ask &&
      k.status !== 'off' &&
      !(await os.dialog.confirm('Restart Python? All variables are lost; files on your drive are kept.', {
        title: runAllAfter ? 'Restart and run all' : 'Restart kernel',
        okLabel: 'Restart',
        danger: true,
      }))
    ) return
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
    if (runAllAfter) this.runAll(false)
  }

  private enqueue(jobs: Job[]) {
    if (!jobs.length) return
    const ids = new Set(jobs.flatMap((j) => (j.kind === 'cell' ? [j.id] : [])))
    this.jobs = this.jobs.filter((j) => !(j.kind === 'cell' && ids.has(j.id))).concat(jobs)
    if (ids.size) {
      this.store.setState((s) => ({ cells: s.cells.map((c) => (ids.has(c.id) && c.state === 'idle' ? { ...c, state: 'queued' } : c)) }))
    }
    this.syncPending()
    void this.pump()
  }

  private cancelQueued() {
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
          if (job.kind === 'cell') ok = await this.execute(job.id, gen)
          else if (job.kind === 'reset') await this.resetNamespace()
          else await this.boot(gen)
        } catch (e) {
          if (gen !== this.generation) break
          ok = false
          this.showFlash(errorText(e))
        }
        if (gen !== this.generation) break
        // Like Jupyter: an error cancels the cells queued after it.
        if (!ok) this.cancelQueued()
        this.syncPending()
      }
    } finally {
      if (gen === this.generation) {
        this.pumping = false
        this.syncPending()
      }
    }
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

  private async resetNamespace() {
    this.counter = 0
    this.store.setState((s) => ({
      cells: s.cells.map((c) => (c.type === 'code' && c.state !== 'running' && c.count !== null ? { ...c, count: null } : c)),
    }))
    const k = this.kernel
    if (k && (k.status === 'idle' || k.status === 'busy')) await k.resetNamespace()
  }

  private async execute(id: string, gen: number): Promise<boolean> {
    const k = this.kernel
    const c = this.cell(id)
    if (!k || !c || c.type !== 'code' || !c.source.trim()) {
      if (c?.state === 'queued') this.patch(id, { state: 'idle' })
      return true
    }
    const live = () => gen === this.generation
    const prep = prepareCode(c.source)
    const count = ++this.counter
    this.runningId = id
    this.patch(id, { state: 'running', outputs: [], count, note: null })
    this.syncPending()
    const handlers: RunHandlers = {
      onStdout: (t) => live() && this.stream(id, 'stdout', t),
      onStderr: (t) => live() && this.stream(id, 'stderr', t),
      onStatus: (t) => live() && this.progress(id, t),
    }
    let stage: 'start' | 'install' | 'run' = 'start'
    let ok = true
    try {
      await this.boot(gen, id)
      if (!live()) return false
      for (const n of prep.notes) this.stream(id, 'stderr', n + '\n')
      if (prep.packages.length) {
        stage = 'install'
        this.progress(id, `Installing ${prep.packages.join(', ')}…`)
        await k.install(prep.packages, handlers)
        if (!live()) return false
        this.patch(id, { note: null })
      }
      if (prep.code.trim()) {
        stage = 'run'
        const r = await k.runCell(prep.code, handlers)
        if (!live()) return false
        this.flushStreams()
        const outs: Output[] = []
        if (r.result !== null) outs.push({ kind: 'result', text: r.result, count })
        if (r.error) {
          const hint = r.error.type === 'SyntaxError' && prep.magicLines.length ? MAGIC_HINT : ''
          outs.push({ kind: 'error', ename: r.error.type, evalue: r.error.message, traceback: r.error.traceback + hint })
        }
        for (const f of r.figures) outs.push({ kind: 'image', mime: 'image/png', data: f })
        if (outs.length) this.patch(id, (cell) => ({ outputs: [...cell.outputs, ...outs] }))
        ok = r.ok
      }
    } catch (e) {
      if (!live()) return false
      this.flushStreams()
      const msg = errorText(e)
      const error: Output =
        stage === 'install'
          ? { kind: 'error', ename: '', evalue: `Could not install ${prep.packages.join(', ')}`, traceback: msg }
          : { kind: 'error', ename: '', evalue: msg, traceback: '' }
      this.patch(id, (cell) => ({ outputs: [...cell.outputs, error] }))
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
    }, 4000)
  }

  /** A notebook nobody has touched yet, which Open may replace in place. */
  isPristine(): boolean {
    const s = this.state
    return !s.dirty && !s.origin && !s.loading && s.cells.every((c) => !c.source.trim())
  }

  async openPath(path: string): Promise<boolean> {
    this.set({ loading: true })
    try {
      this.applyDoc(parseNotebook(await os.fs.readText(path)), path)
      return true
    } catch (e) {
      if (!this.state.cells.length) {
        const c = makeCell('code')
        this.set({ cells: [c], selectedId: c.id })
      }
      this.set({ loading: false })
      await os.dialog.alert(`Could not open "${basename(path)}".\n\n${errorText(e)}`, { title: 'KherveBook' })
      return false
    }
  }

  private applyDoc(doc: NotebookDoc, from: string) {
    this.cancelQueued()
    const cells: Cell[] = doc.cells.map((d) => ({
      ...makeCell(d.type, d.source, false),
      extra: d.extra,
      outputs: d.outputs ?? [],
      count: d.count ?? null,
    }))
    if (!cells.length) cells.push(makeCell('code'))
    this.docExtra = doc.extra
    this.docVersion = doc.version
    this.trash = []
    this.edits++
    this.editors.clear()
    this.set({
      cells,
      selectedId: cells[0].id,
      path: doc.kind === 'kbook' ? from : null, // an imported .ipynb is never overwritten with .kbook JSON
      origin: from,
      dirty: false,
      loading: false,
      canUndoDelete: false,
    })
    // Another notebook in this window: fresh variables, and Python moves to its folder.
    this.counter = 0
    this.booted = false
    const k = this.kernel
    if (k && (k.status === 'idle' || k.status === 'busy')) this.enqueue([{ kind: 'reset' }])
    this.focus(cells[0].id, 'command')
  }

  async open(): Promise<void> {
    const target = await os.dialog.openFile({ title: 'Open notebook', extensions: ['.kbook', '.ipynb'], startDir: this.baseDir() })
    if (!target) return
    if (this.isPristine()) await this.openPath(target)
    else os.open('khervebook', { path: target })
  }

  async save(): Promise<boolean> {
    const p = this.state.path
    return p ? this.writeTo(p) : this.saveAs()
  }

  async saveAs(): Promise<boolean> {
    const { path, origin } = this.state
    const dir = this.baseDir()
    const suggestion = path ?? (origin ? withExt(origin, '.kbook') : join(dir, os.fs.uniqueName(dir, 'Untitled.kbook')))
    const target = await os.dialog.saveFile({ title: 'Save notebook', extensions: ['.kbook'], startDir: NOTEBOOKS, defaultName: suggestion })
    if (!target) return false
    if (extname(target) === '.ipynb') {
      await os.dialog.alert('KherveBook saves notebooks as .kbook files. To write a Jupyter notebook, use File → Export as Jupyter notebook.', {
        title: 'KherveBook',
      })
      return false
    }
    return this.writeTo(target)
  }

  private async writeTo(target: string): Promise<boolean> {
    const at = this.edits
    try {
      await os.fs.writeText(target, serializeKbook(this.state.cells, this.docExtra, this.docVersion), { mkdirs: true })
    } catch (e) {
      await os.dialog.alert(`Could not save "${basename(target)}".\n\n${errorText(e)}`, { title: 'KherveBook' })
      return false
    }
    this.set({ path: target, origin: target, dirty: this.edits !== at })
    this.showFlash(`Saved to ${pretty(target)}`)
    return true
  }

  async exportIpynb(): Promise<void> {
    const { path, origin, cells, pyVersion } = this.state
    const dir = this.baseDir()
    const base = path ?? origin
    const suggestion = base ? withExt(base, '.ipynb') : join(dir, os.fs.uniqueName(dir, 'Untitled.ipynb'))
    const target = await os.dialog.saveFile({ title: 'Export as Jupyter notebook', extensions: ['.ipynb'], startDir: dir, defaultName: suggestion })
    if (!target) return
    try {
      await os.fs.writeText(target, toIpynb(cells, pyVersion), { mkdirs: true })
      this.showFlash(`Exported ${pretty(target)}`)
    } catch (e) {
      await os.dialog.alert(`Could not export "${basename(target)}".\n\n${errorText(e)}`, { title: 'KherveBook' })
    }
  }

  /** The window's close guard: Save / Don't save / Cancel when there are unsaved changes. */
  async confirmClose(): Promise<boolean> {
    if (!this.state.dirty) return true
    const choice = await os.dialog.choose(
      `Do you want to save the changes to "${displayName(this.state)}"?`,
      [
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
        { label: 'Save', value: 'save', primary: true },
      ],
      { title: 'KherveBook' },
    )
    const ok = choice === 'save' ? await this.save() : choice === 'discard'
    if (!ok) this.refocusSoon()
    return ok
  }
}
