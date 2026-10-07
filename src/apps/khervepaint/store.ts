// The window's document state: the drawing, the selection, undo/redo
// (whole-document snapshots, like the desktop's SnapshotCommand: documents
// are immutable, so a snapshot is just a reference), and the tool settings.

import { useSyncExternalStore } from 'react'
import type { DashStyle, DimCap, Doc, Item } from './model'
import { DEFAULT_FILL_COLOR, DEFAULT_FONT, DEFAULT_PEN_COLOR, newDoc } from './model'

export type ShapeTool =
  | 'rect' | 'roundrect' | 'circle' | 'ellipse' | 'halfcircle' | 'quartercircle'
  | 'triangle' | 'right_triangle' | 'diamond' | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon'
  | 'star' | 'star6' | 'plus' | 'chevron' | 'arrow_right' | 'lightning' | 'house'

export type ChemTool =
  | 'chem_single' | 'chem_double' | 'chem_triple' | 'chem_wedge' | 'chem_hash' | 'chem_hbond' | 'chem_chain'
  | 'chem_benzene' | 'chem_cyclohexane' | 'chem_cyclopentane' | 'chem_atom'

export type Tool =
  | 'pointer' | 'hand' | 'pencil' | 'brush' | 'eraser' | 'picker' | 'bucket' | 'line' | 'arrow' | 'dimension' | 'text' | 'place'
  | 'room' | 'protractor' | ShapeTool | ChemTool

export const RECT_TOOLS: ShapeTool[] = [
  'rect', 'roundrect', 'circle', 'ellipse', 'halfcircle', 'quartercircle', 'triangle', 'right_triangle', 'diamond', 'parallelogram',
  'trapezoid', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'star', 'star6', 'plus', 'chevron', 'arrow_right', 'lightning', 'house',
]

export const isRectTool = (t: Tool): t is ShapeTool => (RECT_TOOLS as string[]).includes(t)

export type FillStyle = 'solid' | 'linear' | 'radial' | 'sun'

export interface Settings {
  tool: Tool
  /** Stroke colour (#aarrggbb) and width of new items. */
  stroke: string
  width: number
  dash: DashStyle
  /** Fill of new shapes. */
  fillOn: boolean
  fill: string
  fill2: string
  fillStyle: FillStyle
  fillAngle: number
  /** Bucket output: an editable vector path (default) or paint in the raster layer. */
  bucketVector: boolean
  dimCap: DimCap
  dimOrient: 'aligned' | 'horizontal' | 'vertical'
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  /** The palette symbol the place tool drops: "palette:name". */
  place: string | null
  /** The last shape picked in each shape group (toolbar dropdowns). */
  lastShape: Record<string, ShapeTool>
  /** Chemistry: the label the atom tool places, and fixed-length bonds on 30° steps. */
  chemAtom: string
  chemFixed: boolean
  bondLengthMm: number
}

const SETTINGS_KEY = 'khervepaint.settings'

const DEFAULT_SETTINGS: Settings = {
  tool: 'pointer',
  stroke: DEFAULT_PEN_COLOR,
  width: 2,
  dash: 'solid',
  fillOn: false,
  fill: DEFAULT_FILL_COLOR,
  fill2: '#ffffffff',
  fillStyle: 'solid',
  fillAngle: 90,
  bucketVector: true,
  dimCap: 'arrows',
  dimOrient: 'aligned',
  fontFamily: DEFAULT_FONT,
  fontSize: 14,
  bold: false,
  italic: false,
  place: null,
  lastShape: {},
  chemAtom: 'C',
  chemFixed: true,
  bondLengthMm: 6,
}

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...raw, tool: 'pointer', place: null }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const UNDO_LIMIT = 80

export class PaintStore {
  doc: Doc = newDoc()
  /** Selected top-level item ids. */
  sel: number[] = []
  path: string | null = null
  /** The document as last saved (or opened): dirty when it is not the current one. */
  saved: Doc = this.doc
  settings: Settings = loadSettings()
  past: Doc[] = []
  future: Doc[] = []
  /** Something to show in the status bar. */
  message = ''
  /** Bumped when a document is loaded (the view fits the page). */
  loads = 0
  version = 0
  private base: Doc | null = null
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getVersion = () => this.version

  emit() {
    this.version++
    for (const l of [...this.listeners]) l()
  }

  get dirty() {
    return this.doc !== this.saved
  }

  get selected(): Item[] {
    const ids = new Set(this.sel)
    return this.doc.items.filter((it) => ids.has(it._id))
  }

  // ------------------------------------------------------------ history

  /** A finished change: one undo step. */
  commit(doc: Doc, sel?: number[]) {
    if (this.base) this.endGesture()
    if (doc === this.doc) {
      if (sel) this.select(sel)
      return
    }
    this.past.push(this.doc)
    if (this.past.length > UNDO_LIMIT) this.past.shift()
    this.future = []
    this.doc = doc
    this.sel = this.keep(sel ?? this.sel)
    this.emit()
  }

  /** A change in the middle of a drag: shown at once, recorded when the drag ends. */
  live(doc: Doc) {
    if (!this.base) this.base = this.doc
    this.doc = doc
    this.emit()
  }

  endGesture() {
    const base = this.base
    this.base = null
    if (base && base !== this.doc) {
      this.past.push(base)
      if (this.past.length > UNDO_LIMIT) this.past.shift()
      this.future = []
    }
    this.emit()
  }

  cancelGesture() {
    if (this.base) {
      this.doc = this.base
      this.base = null
      this.emit()
    }
  }

  get inGesture() {
    return !!this.base
  }

  undo() {
    if (this.base) this.cancelGesture()
    const prev = this.past.pop()
    if (!prev) return
    this.future.push(this.doc)
    this.doc = prev
    this.sel = this.keep(this.sel)
    this.emit()
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.doc)
    this.doc = next
    this.sel = this.keep(this.sel)
    this.emit()
  }

  /** Start over with a document (New, Open, an example): fresh history. */
  load(doc: Doc, path: string | null) {
    this.base = null
    this.doc = doc
    this.saved = doc
    this.path = path
    this.past = []
    this.future = []
    this.sel = []
    this.loads++
    this.emit()
  }

  markSaved(path: string, doc: Doc) {
    this.path = path
    this.saved = doc
    this.emit()
  }

  // ---------------------------------------------------------- selection

  private keep(ids: number[]) {
    const have = new Set(this.doc.items.map((it) => it._id))
    return ids.filter((id) => have.has(id))
  }

  select(ids: number[]) {
    const next = this.keep(ids)
    if (next.length === this.sel.length && next.every((id, i) => id === this.sel[i])) return
    this.sel = next
    this.emit()
  }

  // ----------------------------------------------------------- settings

  set(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    try {
      const { tool: _t, place: _p, ...keep } = this.settings
      void _t
      void _p
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(keep))
    } catch {
      // private mode
    }
    this.emit()
  }

  say(message: string) {
    this.message = message
    this.emit()
  }
}

/** Re-render when the store changes. */
export function useStore(store: PaintStore) {
  useSyncExternalStore(store.subscribe, store.getVersion)
  return store
}

/** A tiny value store for fast-changing readouts (cursor, zoom) that should not re-render the window. */
export class Live<T> {
  value: T
  private listeners = new Set<() => void>()
  constructor(value: T) {
    this.value = value
  }
  set(v: T) {
    if (v === this.value) return
    this.value = v
    for (const l of [...this.listeners]) l()
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  get = () => this.value
}

export function useLive<T>(live: Live<T>): T {
  return useSyncExternalStore(live.subscribe, live.get)
}
