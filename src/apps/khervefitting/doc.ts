// One KherveFitting window's document: the Python bridge and what the page
// shows (the last `view` Python sent, the file it came from, unsaved changes).

import { createStore, type StoreApi } from 'zustand'
import { os } from '@/os'
import { FitBridge, type Answer } from './bridge'
import type { View } from './model'

export interface DocState {
  view: View | null
  /** The workbook on the drive, or null (new file, example, import). */
  path: string | null
  untitled: string
  dirty: boolean
  /** Python is working (requests queued or running). */
  busy: number
  /** Package loading text ("Loading scipy…"). */
  progress: string | null
  /** A one-line message in the status bar (errors, refused edits). */
  message: { text: string; error: boolean } | null
  loading: string | null
  canUndo: boolean
  canRedo: boolean
  /** The peak selected in the table or on the plot. */
  selected: number | null
  /** The iterations of the last fit. */
  fitLog: { i: number; r2: number; redChi2: number; nfev: number }[]
}

/** Requests that change the document (mark it unsaved). */
const CHANGES = new Set([
  'settings', 'background', 'clear_background', 'add_peak', 'remove_peak', 'set_cell', 'drag_peak', 'fit', 'export',
  'results_set', 'results_delete', 'undo', 'redo',
])

export class PyError extends Error {
  readonly trace?: string
  constructor(message: string, trace?: string) {
    super(message)
    this.trace = trace
  }
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class Doc {
  readonly bridge: FitBridge
  readonly store: StoreApi<DocState>
  /** The workbook bytes as last opened or saved (kept by Python too). */
  private flashTimer = 0

  constructor(ns: string) {
    this.bridge = new FitBridge(ns)
    this.store = createStore<DocState>(() => ({
      view: null,
      path: null,
      untitled: 'Untitled',
      dirty: false,
      busy: 0,
      progress: null,
      message: null,
      loading: null,
      canUndo: false,
      canRedo: false,
      selected: null,
      fitLog: [],
    }))
    this.bridge.onBusy = (n) => this.set({ busy: n })
    this.bridge.onProgress = (t) => this.set({ progress: t })
    this.bridge.onLost = () => {
      this.set({ view: null, path: null, dirty: false })
      this.flash('Python stopped and started again: open the file again.', true)
    }
  }

  get state(): DocState {
    return this.store.getState()
  }

  set(p: Partial<DocState>) {
    this.store.setState(p)
  }

  flash(text: string, error = false) {
    this.set({ message: { text, error } })
    window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => this.set({ message: null }), error ? 8000 : 4000)
  }

  /** Send a request; adopt the view it returns; errors become messages (or throw with `strict`). */
  async call(op: string, args: unknown = {}, opts: { strict?: boolean } = {}): Promise<Answer> {
    let a: Answer
    try {
      a = await this.bridge.call(op, args)
    } catch (e) {
      if (opts.strict) throw e
      this.flash(errorText(e), true)
      return { ok: false, error: errorText(e) }
    }
    const patch: Partial<DocState> = {}
    if (a.view) {
      // Some answers leave the curves out (nothing on the plot changed): keep the ones shown.
      const prev = this.state.view
      const v = a.view
      patch.view =
        v.x === undefined && prev && prev.sheet === v.sheet && prev.file === v.file
          ? { ...v, x: prev.x, y: prev.y, bkg: prev.bkg, peaks: prev.peaks, envelope: prev.envelope, residuals: prev.residuals }
          : v
      const n = a.view.grid.length / 2
      if (this.state.selected !== null && this.state.selected >= n) patch.selected = n ? n - 1 : null
    }
    if (typeof a.canUndo === 'boolean') patch.canUndo = a.canUndo
    if (typeof a.canRedo === 'boolean') patch.canRedo = a.canRedo
    if (a.ok && CHANGES.has(op) && !a.nothing) patch.dirty = true
    this.set(patch)
    if (!a.ok) {
      if (opts.strict) throw new PyError(a.error ?? 'Python failed.', a.trace)
      if (a.trace) console.warn(`[KherveFitting] ${op}:`, a.trace)
      this.flash(a.error ?? 'Python failed.', true)
    }
    return a
  }

  dispose() {
    window.clearTimeout(this.flashTimer)
    this.bridge.dispose()
  }
}

/** Ask before losing changes. True when it is fine to go on. */
export async function confirmDiscard(doc: Doc, save: () => Promise<boolean>, action = 'closing'): Promise<boolean> {
  if (!doc.state.dirty) return true
  const choice = await os.dialog.choose(
    `Do you want to save the changes to "${doc.state.path?.split('/').pop() ?? doc.state.untitled}" before ${action}?`,
    [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't Save", value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true },
    ],
    { title: 'KherveFitting' },
  )
  if (choice === 'save') return save()
  return choice === 'discard'
}
