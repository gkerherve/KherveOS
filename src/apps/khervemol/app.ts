// One KherveMol window's state and logic: the desktop's MainWindow
// (mainwindow.py) and Viewer3D (viewer3d.py) without their widgets. The
// structure lives in the Python engine; this side keeps the view —
// orientation, selection, the reaction film, the 2D sketch — and asks the
// engine (bridge.ts) to change the chemistry. React components read the
// store and call these methods.

import { createStore, type StoreApi } from 'zustand/vanilla'
import { os, fs, path as vpath } from '@/os'
import type { WindowApi } from '@/os/types'
import { MolBridge, fromBase64, type Answer } from './bridge'
import { loadCatalog, type Catalog } from './catalog'
import { name as elName, valence, PALETTE } from './elements'
import { bondsAt, frame, groupOf, notesAt, pose, type FilmData } from './film'
import { hasPolyhedra, legendEntries } from './molcolor'
import { MODES, hillFormula, type Mode } from './molrepr'
import * as M from './model'
import { descriptorsFromStructure, loadRDKit, rdkitAvailable, sketchFromSmiles, smilesFromMolfile, smilesFromStructure } from './rdkit'
import { STYLES, type Style } from './scene'
import { emptyMol, molToDict, type Atom, type Atom2D, type Bond, type Mol, type Sketch } from './types'

export const MAX_CELLS = 12
const RECENT_KEY = 'khervemol.recent'
const PREF_KEY = 'khervemol.prefs'
export const MAX_RECENT = 8

export type Renderer = 'gl' | 'classic'
export type Tool = 'draw' | 'move' | 'atom' | 'erase'
export type DialogKind =
  | 'explorer' | 'crystal' | 'surface' | 'addmol' | 'nano' | 'polymer' | 'reaction' | 'properties' | 'stack' | 'mesh' | 'guide' | 'about' | 'aisettings'

export interface DialogRequest {
  kind: DialogKind
  props: Record<string, unknown>
  resolve: (value: unknown) => void
}

export interface ShelfItem {
  name: string
  formula: string
  token: string
}

export interface State {
  ready: boolean
  catalog: Catalog | null
  version: string
  progress: string | null
  busy: number

  // ---- the 3D viewer
  mol: Mol
  /** Bumped whenever a different structure is loaded (molecule_changed). */
  molSerial: number
  /** Bumped on every change of atoms/bonds (structure_changed). */
  structSerial: number
  selection: number[]
  order: 1 | 2 | 3
  activeElement: string
  style: Style
  renderer: Renderer
  glOk: boolean
  rendererNote: string
  labels: boolean
  lock: boolean
  legend: boolean
  zoom: number
  viewStatus: string
  picking: { anchor: number; order: number } | null
  hit: ['atom' | 'bond' | null, number]
  film: FilmData | null
  /** Film progress 0..1 while the film is shown, else null. */
  animP: number | null
  playing: boolean
  speed: number
  loop: boolean
  groupIndex: number
  groupMode: 'move' | 'turn'
  groupStep: number
  tiltShown: [number, number, number]

  // ---- the window
  central: 'welcome' | 'tabs'
  tab: 0 | 1
  statusBar: string
  path: string | null
  docks: { structure: boolean; library: boolean; shelf: boolean; ai: boolean }
  leftTab: 'library' | 'shelf'
  periodic: boolean
  shelf: ShelfItem[]
  shelfNext: string
  shelfSelected: string | null
  recent: string[]
  dialog: DialogRequest | null
  rdkit: boolean

  // ---- the 2D sketch
  sketch: Sketch
  tool: Tool
  element2d: string
  showLabels2d: boolean
  mode: Mode
  sketchStatus: string
  sketchSerial: number
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** "Ctrl+Shift+S" as the menus show it (⇧⌘S on a Mac, as Qt shows it there). */
export function sc(keys: string): string {
  if (!isMac) return keys
  const parts = keys.split('+')
  const key = parts.pop()!
  const mods = new Set(parts)
  return `${mods.has('Alt') ? '⌥' : ''}${mods.has('Shift') ? '⇧' : ''}${mods.has('Ctrl') ? '⌘' : ''}${key}`
}

function readPrefs(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), [key]: value }))
  } catch {
    /* private mode */
  }
}

// ------------------------------------------------------------- recent files
export function recentPaths(): string[] {
  let list: string[] = []
  try {
    list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    list = []
  }
  return list.filter((p) => typeof p === 'string' && fs.isFile(p))
}
function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
  } catch {
    /* ignore */
  }
}

export const STANDARD_VIEWS: [string, number, number][] = [
  ['Front', 0, 0],
  ['Back', Math.PI, 0],
  ['Left', -Math.PI / 2, 0],
  ['Right', Math.PI / 2, 0],
  ['Top', 0, Math.PI / 2],
  ['Bottom', 0, -Math.PI / 2],
  ['Isometric', M.DEFAULT_AZ, M.DEFAULT_EL],
]

const ORDER_DASH: Record<number, string> = { 1: '–', 2: '=', 3: '≡' }

function message(a: Answer, fallback = 'Something went wrong.'): string {
  return a.error ?? fallback
}

/** mainwindow._flatten_2d: project the 3D model into a flat graph (molecules drop explicit H). */
export function flatten2d(mol: Mol): Sketch {
  const dropH = !mol.crystal
  const keep: number[] = []
  mol.atoms.forEach((a, i) => !(dropH && a[0] === 'H') && keep.push(i))
  const remap = new Map(keep.map((old, n) => [old, n]))
  const atoms: Atom2D[] = keep.map((i) => {
    const a = mol.atoms[i]
    const [px, py] = M.proj(a[1], a[2], a[3], mol.az, mol.el)
    return [a[0], px * 46, py * 46]
  })
  const bonds: Bond[] = mol.bonds.filter(([i, j]) => remap.has(i) && remap.has(j)).map(([i, j, o]) => [remap.get(i)!, remap.get(j)!, o])
  return { atoms, bonds }
}

export class MolApp {
  readonly store: StoreApi<State>
  readonly bridge: MolBridge
  readonly win: WindowApi
  private syncing = false
  private sketchDirty = false
  private lastDrawn: Mol | null = null
  private filmTimer: number | null = null
  private restoreAtEnd = false
  private staticScene: Mol | null = null
  /** A drag in progress keeps the engine's atoms out of date until release. */
  dragging = false
  /** Repaint the 3D view (set by the view component). */
  onRepaint: () => void = () => {}
  /** Render the current 3D view to a canvas (set by the view component). */
  renderImage: ((w: number, h: number) => Promise<HTMLCanvasElement | null>) | null = null
  /** Render the 2D sketch to a canvas (set by the sketch component). */
  sketchImage: ((w: number, h: number) => HTMLCanvasElement) | null = null
  disposed = false

  constructor(win: WindowApi) {
    this.win = win
    const prefs = readPrefs()
    this.store = createStore<State>(() => ({
      ready: false, catalog: null, version: '', progress: null, busy: 0,
      mol: emptyMol(), molSerial: 0, structSerial: 0, selection: [], order: 1, activeElement: 'C',
      style: 'ball_and_stick', renderer: prefs.renderer === 'classic' ? 'classic' : 'gl', glOk: true, rendererNote: '',
      labels: false, lock: true, legend: false, zoom: 1, viewStatus: '', picking: null, hit: [null, -1],
      film: null, animP: null, playing: false, speed: 1, loop: false, groupIndex: 0, groupMode: 'move', groupStep: 0.5, tiltShown: [0, 0, 0],
      central: 'welcome', tab: 0, statusBar: 'Ready', path: null,
      docks: { structure: true, library: true, shelf: true, ai: false }, leftTab: 'library', periodic: false,
      shelf: [], shelfNext: 'Molecule 1', shelfSelected: null, recent: recentPaths(), dialog: null, rdkit: false,
      sketch: { atoms: [], bonds: [] }, tool: 'draw', element2d: 'C', showLabels2d: false, mode: 'skeletal',
      sketchStatus: 'Draw: drag from an atom to bond; click empty to place. Click a bond to cycle its order.', sketchSerial: 0,
    }))
    this.bridge = new MolBridge(`khervemol-${win.id}`)
    this.bridge.onProgress = (t) => this.set({ progress: t })
    this.bridge.onBusy = (n) => this.set({ busy: n })
    this.bridge.onLost = () => {
      // the engine restarted: give it the structure on screen again
      const mol = this.get().mol
      if (mol.atoms.length) void this.bridge.call('open_kmol', { text: JSON.stringify({ format: 'khervemol', version: 5, mol3d: molToDict(mol), sketch2d: this.get().sketch }) })
    }
    void loadCatalog().then((c) => this.set({ catalog: c, version: c.version })).catch((e: unknown) => this.status(`Could not load the library: ${String(e)}`))
    void this.bridge.call('boot').then((a) => {
      if (a.ok) this.set({ ready: true, version: String(a.version ?? this.get().version) })
      void this.refreshShelf()
    }).catch((e: unknown) => this.status(String(e instanceof Error ? e.message : e)))
    void loadRDKit().then((m) => this.set({ rdkit: !!m }))
    this.retitle()
  }

  get(): State {
    return this.store.getState()
  }
  set(p: Partial<State>) {
    if (!this.disposed) this.store.setState(p)
  }

  dispose() {
    this.stopTimer()
    this.disposed = true
    this.bridge.dispose()
  }

  /** The main window's status bar (statusBar().showMessage). */
  status(text: string) {
    this.set({ statusBar: text })
  }

  /** Every request carries the view, as the engine's Molecule holds az/el. */
  call(op: string, args: Record<string, unknown> = {}): Promise<Answer> {
    const m = this.get().mol
    return this.bridge.call(op, { ...args, view: { az: m.az, el: m.el } })
  }

  retitle() {
    const s = this.get()
    const name = s.path ? vpath.basename(s.path) : 'Untitled'
    const formula = s.mol.formula
    this.win.setTitle(`KherveMol v${s.version || ''} — ${name}${formula ? ` — ${formula}` : ''}`)
  }

  // =================================================================== VIEWER

  get editable(): boolean {
    return !this.get().mol.crystal
  }
  get selected(): number | null {
    const sel = this.get().selection
    return sel.length ? sel[sel.length - 1] : null
  }
  get isSurface(): boolean {
    return this.get().mol.name.startsWith('surface:')
  }
  get hasAnimation(): boolean {
    return !!this.get().mol.has_animation
  }
  get animating(): boolean {
    return this.get().animP !== null
  }

  /** Viewer3D.set_molecule: a different structure (from a load, a build, a file). */
  setMolecule(mol: Mol) {
    this.endAnimation(false)
    this.staticScene = null
    this.set({
      mol, selection: [], zoom: 1, picking: null, film: null, molSerial: this.get().molSerial + 1, structSerial: this.get().structSerial + 1,
      groupIndex: 0, tiltShown: (mol.can_stack ? mol.tilts['0,0,0'] : null) ?? [0, 0, 0],
    })
    this.updateStatus()
    this.showWorkspace()
    this.rememberDrawn()
    this.retitle()
    this.filmReady = mol.has_animation ? this.loadFilm() : Promise.resolve()
  }

  /** Resolves when the reaction film of the structure on screen is loaded. */
  filmReady: Promise<void> = Promise.resolve()

  /** structure_changed: the same structure, edited. */
  private changed(mol: Mol, selection?: number[]) {
    const p: Partial<State> = { mol, structSerial: this.get().structSerial + 1 }
    if (selection) p.selection = selection
    this.set(p)
    this.updateStatus()
    this.retitle()
    this.syncSketch(false)
    this.rememberDrawn()
  }

  private apply(a: Answer, selection?: number[]): boolean {
    if (a.superseded) return false
    if (a.ok && a.mol) {
      // keep the orientation and spread the browser holds
      const cur = this.get().mol
      this.changed({ ...a.mol, az: cur.az, el: cur.el, bond: cur.bond }, selection)
      return true
    }
    if (!a.ok && a.error) this.set({ viewStatus: a.error })
    return false
  }

  setView(az: number, el: number) {
    this.set({ mol: { ...this.get().mol, az, el } })
    this.retitle()
  }

  /** Orbit by a mouse delta (rotation is a uniform: nothing is rebuilt). */
  orbit(dx: number, dy: number) {
    const m = this.get().mol
    const az = (((m.az + dx * 0.012) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const el = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.el - dy * 0.012))
    this.set({ mol: { ...m, az, el } })
  }

  zoomBy(up: boolean) {
    const f = up ? 1.15 : 1 / 1.15
    this.set({ zoom: Math.max(0.2, Math.min(8, this.get().zoom * f)) })
  }
  resetZoom() {
    this.set({ zoom: 1 })
  }

  setBondSpread(value: number) {
    this.set({ mol: { ...this.get().mol, bond: value / 100 } })
    void this.bridge.latest('bond', 'set_bond_spread', { bond: value / 100 })
  }

  setStyle(style: Style) {
    if (!(STYLES as readonly string[]).includes(style)) return
    this.set({ style })
  }

  setRenderer(kind: Renderer) {
    const used: Renderer = kind === 'gl' && this.get().glOk ? 'gl' : 'classic'
    this.set({ renderer: used })
    writePref('renderer', used)
    if (used !== kind) this.status(this.get().rendererNote || 'OpenGL is not available here.')
  }

  /** WebGL could not start: the classic view takes over (Viewer3D._fall_back). */
  glFailed(message: string) {
    const note = `OpenGL is unavailable (${message}) — using the classic renderer.`
    this.set({ glOk: false, renderer: 'classic', rendererNote: note, viewStatus: note })
  }

  // ------------------------------------------------------------- selection

  onAtomClicked(index: number, toggle = false) {
    const s = this.get()
    if (index >= 0 && s.picking) {
      const { anchor, order } = s.picking
      this.cancelPick()
      void this.bondAtoms(anchor, index, order)
      return
    }
    let sel = [...s.selection]
    if (index < 0) {
      this.cancelPick()
      sel = []
    } else if (!toggle) sel = [index]
    else if (sel.includes(index)) sel = sel.filter((i) => i !== index)
    else sel.push(index)
    this.set({ selection: sel })
    const m = this.get().mol
    const primary = sel.length ? sel[sel.length - 1] : null
    if (m.can_stack && primary !== null) this.set({ tiltShown: m.tilts[this.cellOf(primary)] ?? [0, 0, 0] })
    this.updateStatus()
    const gi = this.groupAt(primary)
    if (gi !== null) {
      this.set({ groupIndex: gi })
      this.showGroupPose()
    }
  }

  selectAtom(index: number | null, toggle = false) {
    this.onAtomClicked(index === null ? -1 : index, toggle)
  }

  makePrimary(index: number) {
    const sel = this.get().selection
    if (!sel.includes(index)) return
    this.set({ selection: [...sel.filter((i) => i !== index), index] })
    this.updateStatus()
  }

  stepSelection(delta: number) {
    const n = this.get().mol.atoms.length
    if (!n) return
    const start = this.selected
    const next = start === null ? 0 : (((start + delta) % n) + n) % n
    this.set({ selection: [next] })
    this.updateStatus()
  }

  canBondSelected(order = this.get().order): boolean {
    const s = this.get()
    return this.editable && s.selection.length >= 2 && M.canBond(s.mol.atoms, s.mol.bonds, s.selection[s.selection.length - 2], s.selection[s.selection.length - 1], order)
  }

  bondSelected(order = this.get().order) {
    const sel = this.get().selection
    if (sel.length < 2) return
    void this.bondAtoms(sel[sel.length - 2], sel[sel.length - 1], order)
  }

  async bondAtoms(i: number, j: number, order = 1) {
    if (!this.editable) return
    const m = this.get().mol
    if (!M.canBond(m.atoms, m.bonds, i, j, order)) {
      this.set({ viewStatus: this.whyNot(i, j, order) })
      return
    }
    const a = await this.call('add_bond', { i, j, order })
    if (a.ok && a.done) this.apply(a, [j])
    else if (a.ok) this.set({ viewStatus: this.whyNot(i, j, order) })
    else this.apply(a)
  }

  async reattach(atom: number, parent: number | null, anchor: number, order = 1): Promise<boolean> {
    if (!this.editable) return false
    const m = this.get().mol
    const old = parent === null ? null : M.bondBetween(m.bonds, atom, parent)
    if (!M.canReattach(m.atoms, m.bonds, atom, old, anchor, order)) {
      this.set({ viewStatus: this.whyNotReattach(atom, old, anchor, order) })
      return false
    }
    const a = await this.call('reattach', { atom, parent, anchor, order })
    if (a.ok && a.done) {
      this.apply(a, [atom])
      return true
    }
    this.set({ viewStatus: this.whyNotReattach(atom, old, anchor, order) })
    return false
  }

  private whyNotReattach(atom: number, old: number | null, anchor: number, order: number): string {
    const m = this.get().mol
    const a = m.atoms[atom][0], b = m.atoms[anchor][0]
    if (M.movingFragment(m.bonds, atom, old).has(anchor)) return `${b}${anchor} hangs off ${a}${atom} — it would move with it. Drop onto an atom on the other side of the bond.`
    if (M.freeValence(m.atoms, m.bonds, anchor) < order) return `No free valence on ${b} (atom ${anchor}).`
    return `Cannot bond ${a}${atom} to ${b}${anchor}.`
  }

  whyNot(i: number, j: number, order: number): string {
    const m = this.get().mol
    if (i === j) return 'Pick two different atoms to bond.'
    if (M.bondBetween(m.bonds, i, j) !== null) return `${m.atoms[i][0]} and ${m.atoms[j][0]} are already bonded — right-click the bond to change its order.`
    const short = [i, j].filter((k) => M.freeValence(m.atoms, m.bonds, k) < order).map((k) => `${m.atoms[k][0]} (atom ${k})`)
    return `No free valence on ${short.join(' and ')} — delete an atom from it first.`
  }

  startPick(anchor: number, order = 1) {
    if (!this.editable) return
    this.set({ picking: { anchor, order } })
    const kind = ({ 1: 'bond', 2: 'double bond', 3: 'triple bond' } as Record<number, string>)[order]
    this.set({ viewStatus: `Click the atom to ${kind} to ${this.get().mol.atoms[anchor][0]} (atom ${anchor}) — Esc to cancel.` })
  }

  cancelPick() {
    if (!this.get().picking) return
    this.set({ picking: null })
    this.updateStatus()
  }

  /** The dragged atom's bond lengths, live (show_geometry). */
  showGeometry(index: number, atoms: readonly Atom[]) {
    const m = this.get().mol
    const parts: string[] = []
    for (const [i, j, order] of m.bonds) {
      if (i !== index && j !== index) continue
      const k = i === index ? j : i
      parts.push(`${atoms[index][0]}${ORDER_DASH[order]}${atoms[k][0]} ${M.distance(atoms, i, j).toFixed(2)} Å`)
    }
    if (!parts.length) return
    this.set({ viewStatus: parts.join('   ') + (this.get().lock ? ' (locked)' : '') })
  }

  /** A drag of an atom (or of a molecule on a surface) ended: the engine takes the new positions. */
  async commitDrag(atoms: Atom[], group: boolean) {
    this.dragging = false
    const m = this.get().mol
    this.set({ mol: { ...m, atoms } })
    const a = await this.call('set_atoms', { atoms })
    if (a.ok) {
      this.apply(a)
      if (group) this.showGroupPose()
    }
  }

  // ---------------------------------------------------------- bond edits

  bondLabel(bondIndex: number): string {
    const m = this.get().mol
    const [i, j, order] = m.bonds[bondIndex]
    return `${m.atoms[i][0]}${ORDER_DASH[order]}${m.atoms[j][0]} ${M.distance(m.atoms, i, j).toFixed(2)} Å`
  }

  canSetOrder(bondIndex: number, order: number): boolean {
    const m = this.get().mol
    return M.canSetBondOrder(m.atoms, m.bonds, bondIndex, order)
  }

  async setBondOrder(bondIndex: number, order: number) {
    if (!this.editable || bondIndex >= this.get().mol.bonds.length) return
    const a = await this.call('set_bond_order', { bond: bondIndex, order })
    if (a.ok && !a.done) this.set({ viewStatus: `Cannot make that bond ${['single', 'double', 'triple'][order - 1]} — one of its atoms has no free valence.` })
    else this.apply(a)
  }

  async deleteBond(bondIndex: number) {
    if (!this.editable || bondIndex >= this.get().mol.bonds.length) return
    this.apply(await this.call('delete_bond', { bond: bondIndex }))
  }

  async bondElement(anchor: number, element: string, order = 1) {
    this.set({ selection: [anchor] })
    await this.addElement(element, order)
  }

  bondable(anchor: number | null, order = 1): string[] {
    if (!this.editable || anchor === null) return []
    const m = this.get().mol
    if (M.freeValence(m.atoms, m.bonds, anchor) < order) return []
    return PALETTE.filter((el) => valence(el) >= order)
  }

  /** Viewer3D.add_element: bond a new atom on the selection (or place it free). */
  async addElement(element: string, order: number = this.get().order) {
    if (!this.editable) return
    const m = this.get().mol
    const anchor = this.selected !== null ? this.selected : m.atoms.length ? m.atoms.length - 1 : null
    if (anchor === null) {
      const a = await this.call('place_free', { element, first: true })
      this.apply(a, [0])
      return
    }
    const free = M.freeValence(m.atoms, m.bonds, anchor)
    if (free >= order && valence(element) >= order) {
      const a = await this.call('add_bonded', { anchor, element, order })
      if (a.ok) this.apply(a, [Number(a.index)])
      else this.apply(a)
      return
    }
    const a = await this.call('place_free', { element })
    if (this.apply(a, [Number(a.index)])) this.set({ viewStatus: `Placed a free ${element} atom (no room to bond it to the selection — drag it, or select another atom to bond).` })
  }

  addActive() {
    void this.addElement(this.get().activeElement)
  }

  async deleteSelected() {
    const sel = this.selected
    if (!this.editable || sel === null || this.get().mol.atoms.length <= 1) return
    const a = await this.call('delete_atom', { index: sel })
    this.apply(a, [])
  }

  setActiveElement(el: string) {
    this.set({ activeElement: el })
  }

  // --------------------------------------------------- colours / cells

  async pickColor(color: string | null) {
    const idx = this.selected
    const m = this.get().mol
    if (idx === null || idx >= m.atoms.length) {
      this.set({ viewStatus: 'Click an atom first, then pick its colour.' })
      return
    }
    if (!color) return
    this.apply(await this.call('set_color', { index: idx, color }))
  }

  async resetColors() {
    this.apply(await this.call('reset_colors'))
  }

  async setCellVisible(on: boolean) {
    this.set({ mol: { ...this.get().mol, cell_visible: on } })
    this.apply(await this.call('set_cell_visible', { on }))
  }

  async setPoly(on: boolean) {
    this.set({ mol: { ...this.get().mol, poly: on } })
    this.apply(await this.call('set_poly', { on }))
  }

  setLegend(on: boolean) {
    this.set({ legend: on })
  }

  cellOf(index: number | null): string {
    const owners = this.get().mol.owners
    if (index !== null && owners && index >= 0 && index < owners.length) return owners[index]
    return '0,0,0'
  }

  cellMembers(key: string): number[] {
    return [...(this.get().mol.members?.[key] ?? [])]
  }

  tiltCell(): string | null {
    if (this.selected === null || !this.get().mol.can_stack) return null
    return this.cellOf(this.selected)
  }

  tiltCellAtoms(): number[] {
    const key = this.tiltCell()
    return key && this.get().mol.stacked ? this.cellMembers(key) : []
  }

  async setCells(nx: number, ny: number, nz: number) {
    const cells = [nx, ny, nz].map((n) => Math.max(1, Math.min(MAX_CELLS, Math.trunc(n))))
    const a = await this.call('set_cells', { cells })
    if (this.apply(a, [])) {
      this.set({ zoom: 1, tiltShown: this.get().mol.tilts['0,0,0'] ?? [0, 0, 0] })
      this.updateStatus()
    }
  }

  async setTilt(cell: string, angles: [number, number, number]) {
    const a = await this.call('set_tilt', { cell, angles })
    if (!a.ok || !a.mol) return this.apply(a)
    let sel = this.get().selection
    const m = a.mol
    const owners = m.owners ?? []
    if (this.selected === null || (owners[this.selected] ?? '0,0,0') !== cell) {
      const mem = m.members?.[cell] ?? []
      sel = mem.filter((i) => (owners[i] ?? '0,0,0') === cell).slice(0, 1)
    }
    this.apply(a, sel)
    this.set({ tiltShown: this.get().mol.tilts[cell] ?? [0, 0, 0] })
  }

  onTilt(values: [number, number, number]) {
    const idx = this.selected
    const owners = this.get().mol.owners ?? []
    if (idx === null || idx >= owners.length) {
      this.set({ viewStatus: 'Click an atom of the cell you want to tilt first.', tiltShown: [0, 0, 0] })
      return
    }
    this.set({ tiltShown: values })
    void this.setTilt(this.cellOf(idx), values)
  }

  async resetTilts() {
    const a = await this.call('reset_tilts')
    if (this.apply(a)) this.set({ tiltShown: [0, 0, 0] })
  }

  // ------------------------------------------------ molecules on a surface

  groupAt(atom: number | null): number | null {
    return this.isSurface ? groupOf(this.get().mol.groups, atom) : null
  }

  currentGroup(): number | null {
    const gi = this.get().groupIndex
    return gi >= 0 && gi < this.get().mol.groups.length ? gi : null
  }

  selectGroup(gi: number) {
    if (gi >= 0 && gi < this.get().mol.groups.length) {
      this.set({ groupIndex: gi })
      this.showGroupPose()
    }
  }

  showGroupPose(atoms?: readonly Atom[]) {
    const gi = this.currentGroup()
    if (gi === null) return
    const m = this.get().mol
    const p = pose(atoms ?? m.atoms, m.groups, gi)
    this.set({
      viewStatus: `${m.groups[gi].name} — centre at x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)} Å, lowest atom ${p.height.toFixed(2)} Å above the surface. Drag it to slide it, Shift+drag to lift it.`,
    })
  }

  setGroupMode(mode: 'move' | 'turn') {
    this.set({ groupMode: mode, groupStep: mode === 'turn' ? 15 : 0.5 })
  }

  async nudgeGroup(axis: number, sign: number) {
    const gi = this.currentGroup()
    if (gi === null) return
    const s = this.get()
    const a = await this.call('nudge_group', { gi, mode: s.groupMode, axis, step: sign * s.groupStep })
    if (this.apply(a)) this.showGroupPose()
  }

  async removeCurrentGroup() {
    const gi = this.currentGroup()
    if (gi === null) return
    const a = await this.call('remove_group', { gi })
    if (this.apply(a, [])) {
      this.set({ groupIndex: Math.max(0, gi - 1), viewStatus: 'Molecule removed from the surface.' })
    }
  }

  // ------------------------------------------------------- reaction film

  private async loadFilm() {
    const a = await this.call('animation')
    if (a.ok && a.film) this.set({ film: a.film as FilmData })
  }

  private stopTimer() {
    if (this.filmTimer !== null) {
      clearInterval(this.filmTimer)
      this.filmTimer = null
    }
  }

  private endAnimation(restore = true) {
    this.stopTimer()
    if (this.get().animP !== null && restore && this.staticScene) this.set({ mol: { ...this.staticScene, az: this.get().mol.az, el: this.get().mol.el, bond: this.get().mol.bond } })
    this.set({ animP: null, playing: false })
  }

  setProgress(p: number, scrub = false) {
    const film = this.get().film
    if (!film || !this.hasAnimation) return
    const first = this.get().animP === null
    if (first) this.staticScene = this.get().mol
    if (scrub && this.get().playing) {
      this.stopTimer()
      this.set({ playing: false })
    }
    p = Math.max(0, Math.min(1, p))
    const base = this.staticScene ?? this.get().mol
    const cur = this.get().mol
    const f = frame(base, film, p)
    this.set({
      animP: p, selection: [],
      mol: { ...f, az: cur.az, el: cur.el, bond: cur.bond, formula: M.formula(f.atoms) },
      structSerial: this.get().structSerial + 1, ...(first ? { molSerial: this.get().molSerial + 1 } : {}),
    })
    this.set({ viewStatus: `${film.title} — ${stageText(film, p)}` })
  }

  play(restoreAtEnd = false) {
    if (!this.hasAnimation || !this.get().film) return
    this.restoreAtEnd = restoreAtEnd
    const p = this.get().animP
    if (p === null || p >= 1) this.setProgress(0)
    this.stopTimer()
    this.filmTimer = window.setInterval(() => this.tick(), 33)
    this.set({ playing: true })
  }

  pause() {
    this.stopTimer()
    this.set({ playing: false })
  }

  toggleAnimation() {
    if (this.get().playing) this.pause()
    else this.play()
  }

  stopAnimation() {
    if (this.get().animP === null) return
    this.endAnimation()
    this.set({ molSerial: this.get().molSerial + 1, structSerial: this.get().structSerial + 1 })
    this.updateStatus()
  }

  private tick() {
    const s = this.get()
    const film = s.film
    if (!film || s.animP === null) return
    let p = s.animP + (0.033 * s.speed) / film.duration
    if (p >= 1) {
      if (s.loop) p = 0
      else {
        this.setProgress(1)
        this.pause()
        if (this.restoreAtEnd) this.stopAnimation()
        return
      }
    }
    this.setProgress(p)
  }

  // ----------------------------------------------------------- the status

  private fixedKind(): string {
    const m = this.get().mol
    if (m.name.startsWith('crystal:') || m.name.startsWith('surface:')) return 'fixed lattice'
    if (m.notes && m.notes.length) return 'read-only scene'
    return m.edges ? 'fixed lattice' : 'fixed structure'
  }

  private crystalStatus(): string {
    const m = this.get().mol
    const bits: string[] = []
    if (m.params) bits.push(m.params)
    if (m.stacked) bits.push(`supercell ${m.cells[0]}×${m.cells[1]}×${m.cells[2]} (${m.atoms.length} atoms)`)
    const idx = this.selected
    if (idx !== null && idx < m.atoms.length) {
      const atom = m.atoms[idx]
      const SITE: Record<string, string> = { '#2f6fed': 'body centre', '#e0705a': 'face centre', '#8e63d6': 'interior site', '#43a047': 'middle layer' }
      const site = atom.length > 4 ? SITE[atom[4] as string] : undefined
      const where = site ? ` (${site})` : ''
      const cell = m.stacked ? ` in cell (${this.cellOf(idx).replace(/,/g, ', ')})` : ''
      bits.push(`selected ${atom[0]}${where}${cell} — Atom colour… recolours every ${atom[0]} on this site` + (cell ? ', Tilt cell rotates the outlined cell' : ''))
    } else bits.push('drag to rotate, wheel to zoom; click an atom to recolour it or pick its cell')
    return bits.join('.  ') + '.'
  }

  /** Viewer3D._update_status: the line under the 3D view. */
  updateStatus() {
    const s = this.get()
    const m = s.mol
    const head = m.formula ? `${m.label}   [${m.formula}]` : m.label
    if (!this.editable) {
      if (m.notes && m.notes.length) this.set({ viewStatus: `${head} — drag to rotate, wheel to zoom (${this.fixedKind()}).` })
      else this.set({ viewStatus: `${head} — ${this.crystalStatus()}` })
      return
    }
    const sel = s.selection
    if (sel.length >= 2) {
      const i = sel[sel.length - 2], j = sel[sel.length - 1]
      const a = m.atoms[i][0], b = m.atoms[j][0]
      const extra = sel.length > 2 ? ` (${sel.length} atoms selected)` : ''
      if (this.canBondSelected(s.order)) {
        this.set({ viewStatus: `${head} — ${a} (atom ${i}) + ${b} (atom ${j})${extra}: ${M.distance(m.atoms, i, j).toFixed(2)} Å apart. Bond selected to join them.` })
      } else this.set({ viewStatus: `${head} — ${this.whyNot(i, j, s.order)}` })
      return
    }
    const p = this.selected
    if (p !== null && p < m.atoms.length) {
      const el = m.atoms[p][0]
      const free = M.freeValence(m.atoms, m.bonds, p)
      const total = valence(el)
      const avail = free > 0 ? `${free} of ${total} bonds free — click an element to add` : `full (${total} bonds)`
      this.set({ viewStatus: `${head} — selected ${el} (atom ${p}): ${avail}. Ctrl+click another atom to bond the two.` })
    } else this.set({ viewStatus: `${head} — click an atom to select (Tab steps through them), drag it to bend, drag background to rotate.` })
  }

  polyEnabled(): boolean {
    return hasPolyhedra(this.get().mol.bonds)
  }

  legendRows() {
    const m = this.get().mol
    return legendEntries(m.atoms, m.colors)
  }

  // =============================================================== WINDOW

  showWorkspace() {
    if (this.get().central !== 'tabs') this.set({ central: 'tabs' })
  }

  showWelcome() {
    this.set({ central: 'welcome', recent: recentPaths() })
  }

  setTab(tab: 0 | 1) {
    this.set({ tab })
  }

  /** What was drawn last that is an editable molecule (mainwindow.drawn_molecule). */
  drawnMolecule(): Mol | null {
    const s = this.get()
    if (this.editable && s.mol.atoms.length && !(s.mol.notes && s.mol.notes.length)) return s.mol
    return this.lastDrawn
  }

  private rememberDrawn() {
    const s = this.get()
    if (this.editable && s.mol.atoms.length && !(s.mol.notes && s.mol.notes.length) && s.animP === null) this.lastDrawn = s.mol
  }

  /** MainWindow.load_entry. */
  async loadEntry(kind: string, value: string, label?: string): Promise<boolean> {
    const a = await this.call('load_entry', { kind, value, label })
    if (!a.ok || !a.mol) {
      await os.dialog.alert(message(a), { title: 'Cannot build' })
      return false
    }
    this.setMolecule(a.mol)
    this.syncSketch(true)
    this.set({ tab: 0 })
    const m = a.mol
    const note = m.formula && !(m.notes && m.notes.length) ? ` (${m.formula})` : ''
    this.status(`Loaded ${label || m.label}${note}`)
    if (kind === 'reaction') {
      // play the film once, then back to the equation (Animate replays it)
      const shown = this.get().molSerial
      void this.filmReady.then(() =>
        window.setTimeout(() => {
          if (this.get().film && this.get().tab === 0 && this.get().molSerial === shown) this.play(true)
        }, 250),
      )
    }
    return true
  }

  loadModel(key: string, label?: string) {
    void this.loadEntry('model', key, label)
  }

  /** MainWindow.build_smiles: the built-in builder (RDKit's 3D embedding is not in the browser). */
  async buildSmiles(smiles: string, label?: string): Promise<boolean> {
    if (!(await this.loadEntry('smiles', smiles, label))) return false
    this.status(`Built ${label || smiles} with the built-in builder (${this.get().mol.formula})`)
    return true
  }

  // ------------------------------------------------------------ 2D sketch

  /** MainWindow._sync_sketch: mirror the 3D molecule into the sketch (unless edited by hand). */
  syncSketch(force = false) {
    if (this.sketchDirty && !force) return
    this.syncing = true
    try {
      const m = this.get().mol
      if (!m.atoms.length || (m.notes && m.notes.length) || m.atoms.length > 400) this.setSketch({ atoms: [], bonds: [] }, true)
      else {
        let done = false
        if (!m.crystal && rdkitAvailable()) {
          const smi = smilesFromStructure(m.atoms, m.bonds)
          const sk = smi ? sketchFromSmiles(smi) : null
          if (sk && sk.atoms.length) {
            this.setSketch(sk, true)
            done = true
          }
        }
        if (!done) this.setSketch(flatten2d(m), true)
      }
    } finally {
      this.syncing = false
      this.sketchDirty = false
    }
  }

  /** Editor2D.set_structure (center = request_center). */
  setSketch(sk: Sketch, center = false) {
    this.set({ sketch: { atoms: sk.atoms.map((a) => [...a] as Atom2D), bonds: sk.bonds.map((b) => [...b] as Bond) }, sketchSerial: this.get().sketchSerial + (center ? 1 : 0) })
    this.onSketchChanged()
  }

  /** Editor2D._on_changed + MainWindow._on_sketch_changed. */
  onSketchChanged() {
    const sk = this.get().sketch
    this.set({ sketchStatus: `${sk.atoms.length} atoms, ${sk.bonds.length} bonds   [${hillFormula(sk.atoms, sk.bonds)}]` })
    if (!this.syncing) this.sketchDirty = true
    this.retitle()
  }

  /** The sketch was edited by a tool. */
  editSketch(sk: Sketch) {
    this.set({ sketch: sk })
    this.onSketchChanged()
  }

  clearSketch() {
    this.setSketch({ atoms: [], bonds: [] })
  }

  setMode(mode: Mode) {
    if (!(MODES as readonly string[]).includes(mode)) return
    const was = this.get().mode
    this.set({ mode })
    if (mode === 'condensed' || was === 'condensed') this.set({ sketchSerial: this.get().sketchSerial + 1 })
    this.onSketchChanged()
  }

  get sketchEditable(): boolean {
    const m = this.get().mode
    return m === 'skeletal' || m === 'structural'
  }

  useSketchTool(tool: Tool) {
    this.set({ tool, tab: 1 })
  }

  flattenTo2d() {
    if (!this.get().mol.atoms.length) return
    this.syncSketch(true)
    this.set({ tab: 1 })
    this.status('Flattened 3D model into the 2D sketch (re-run to match the current rotation)')
  }

  async needRdkit(): Promise<boolean> {
    if (rdkitAvailable()) return true
    const m = await loadRDKit()
    if (m) {
      this.set({ rdkit: true })
      return true
    }
    await os.dialog.alert('This feature uses RDKit for SMILES. RDKit (MinimalLib, WebAssembly) could not be loaded in this browser.', { title: 'RDKit required' })
    return false
  }

  async build3dFromSketch() {
    const sk = this.get().sketch
    if (!sk.atoms.length) {
      this.status('The 2D sketch is empty.')
      return
    }
    if (!(await this.needRdkit())) return
    const smiles = smilesFromStructure(sk.atoms, sk.bonds)
    if (!smiles) {
      await os.dialog.alert('Could not read the 2D sketch as a valid molecule. Check that the atoms and bonds make chemical sense.', { title: 'Build 3D' })
      return
    }
    await this.buildSmiles(smiles)
  }

  async copySmiles() {
    if (!(await this.needRdkit())) return
    const m = this.get().mol
    const smiles = smilesFromStructure(m.atoms, m.bonds)
    if (!smiles) {
      await os.dialog.alert('RDKit could not derive a valid SMILES from this structure (it may be a crystal lattice or chemically incomplete).', { title: 'No SMILES' })
      return
    }
    try {
      await navigator.clipboard.writeText(smiles)
    } catch {
      /* clipboard refused: still show it */
    }
    this.status(`Copied SMILES: ${smiles}`)
  }

  onElementPicked(el: string) {
    this.set({ activeElement: el, element2d: el })
  }

  // ------------------------------------------------------- drag and drop

  async dropCompound3d(kind: string, value: string) {
    const merging = !!this.get().mol.atoms.length && !this.get().mol.crystal
    const a = await this.call('merge_entry', { kind, value })
    if (!a.ok || !a.mol) {
      this.status(message(a))
      return
    }
    if (a.replaced) this.setMolecule(a.mol)
    else this.apply(a, [Number(a.base)])
    this.status(a.merged && merging ? `Added ${a.label} as a second fragment — Ctrl+click an atom in each and press Bond selected to join them.` : `Loaded ${a.label}.`)
  }

  /** MainWindow._compound_2d: the flat graph of a library entry, or null. */
  async compound2d(kind: string, value: string): Promise<Sketch | null> {
    if (!['model', 'compound', 'smiles'].includes(kind)) return null
    const sm = await this.call('smiles_of', { kind, value })
    const smi = sm.ok ? (sm.smiles as string | null) : null
    if (smi && rdkitAvailable()) {
      const sk = sketchFromSmiles(smi)
      if (sk && sk.atoms.length) return sk
    }
    const b = await this.call('build_detached', { kind, value })
    if (!b.ok || !b.built) return null
    const mol = b.built as Mol
    if (mol.crystal) return null
    if (kind === 'model' && rdkitAvailable()) {
      const s2 = smilesFromStructure(mol.atoms, mol.bonds)
      const sk = s2 ? sketchFromSmiles(s2) : null
      if (sk && sk.atoms.length) return sk
    }
    return flatten2d(mol)
  }

  async dropMolecule2d(kind: string, value: string, x: number, y: number) {
    const result = await this.compound2d(kind, value)
    if (!result) {
      this.status("Can't place that in 2D (crystals, surfaces and reactions have no skeletal form).")
      return
    }
    this.addFragment(result, x, y)
    this.set({ tab: 1 })
    this.status('Dropped a molecule — Move it, or use Draw to bond it to another; Erase a bond to split them.')
  }

  /** Editor2D.add_fragment. */
  addFragment(frag: Sketch, cx: number, cy: number) {
    if (!frag.atoms.length) return
    const xs = frag.atoms.map((a) => a[1]), ys = frag.atoms.map((a) => a[2])
    const ox = cx - (Math.min(...xs) + Math.max(...xs)) / 2, oy = cy - (Math.min(...ys) + Math.max(...ys)) / 2
    const sk = this.get().sketch
    const base = sk.atoms.length
    this.editSketch({
      atoms: [...sk.atoms, ...frag.atoms.map(([el, x, y]) => [el, x + ox, y + oy] as Atom2D)],
      bonds: [...sk.bonds, ...frag.bonds.map(([i, j, o]) => [base + i, base + j, o] as Bond)],
    })
  }

  /** A row dragged onto another in the structure tree. */
  async onReattach(atom: number, parent: number | null, anchor: number) {
    if (await this.reattach(atom, parent, anchor)) {
      const m = this.get().mol
      this.status(`Re-bonded ${m.atoms[atom][0]}${atom} onto ${m.atoms[anchor][0]}${anchor}.`)
    } else this.status(this.get().viewStatus)
  }

  // =============================================================== FILES

  async newDocument() {
    const a = await this.call('new')
    if (!a.ok || !a.mol) return
    this.set({ path: null })
    this.setMolecule(a.mol)
    this.syncSketch(true)
    this.retitle()
  }

  async openDialog() {
    const p = await os.dialog.openFile({ title: 'Open molecule', extensions: ['.kmol'] })
    if (p) await this.openPath(p)
  }

  /** Open any file KherveMol reads: .kmol, or a structure file (imported). */
  async openAny(p: string) {
    if (/\.kmol$/i.test(p)) return this.openPath(p)
    return this.importPath(p)
  }

  async openPath(p: string) {
    let text: string
    try {
      text = await fs.readText(p)
    } catch (e) {
      await os.dialog.alert(String(e instanceof Error ? e.message : e), { title: 'Open failed' })
      return
    }
    const a = await this.call('open_kmol', { text })
    if (!a.ok || !a.mol) {
      await os.dialog.alert(message(a), { title: 'Open failed' })
      return
    }
    this.setMolecule(a.mol)
    const sk = (a.sketch as Sketch | undefined) ?? { atoms: [], bonds: [] }
    this.syncing = true
    try {
      this.setSketch(sk, true)
    } finally {
      this.syncing = false
      this.sketchDirty = false
    }
    this.set({ path: p })
    this.win.setDocumentPath(p)
    this.retitle()
    this.addRecent(p)
    this.status(`Opened ${vpath.basename(p)}`)
  }

  async save() {
    const p = this.get().path
    if (p) await this.write(p)
    else await this.saveAs()
  }

  async saveAs() {
    let p = await os.dialog.saveFile({ title: 'Save molecule', defaultName: 'molecule.kmol', extensions: ['.kmol'] })
    if (!p) return
    if (!p.toLowerCase().endsWith('.kmol')) p += '.kmol'
    if (await this.write(p)) {
      this.set({ path: p })
      this.win.setDocumentPath(p)
      this.retitle()
    }
  }

  async write(p: string): Promise<boolean> {
    const a = await this.call('save_kmol', { sketch: this.get().sketch })
    if (!a.ok) {
      await os.dialog.alert(message(a), { title: 'Save failed' })
      return false
    }
    try {
      await fs.writeText(p, String(a.text), { mkdirs: true })
    } catch (e) {
      await os.dialog.alert(String(e instanceof Error ? e.message : e), { title: 'Save failed' })
      return false
    }
    this.addRecent(p)
    this.status(`Saved ${vpath.basename(p)}`)
    return true
  }

  /** The document as the engine writes it (for the AI tools). */
  async documentText(): Promise<string | null> {
    const a = await this.call('save_kmol', { sketch: this.get().sketch })
    return a.ok ? String(a.text) : null
  }

  addRecent(p: string) {
    const list = [p, ...recentPaths().filter((x) => x !== p)].slice(0, MAX_RECENT)
    saveRecent(list)
    this.set({ recent: recentPaths() })
  }

  removeRecent(p: string) {
    saveRecent(recentPaths().filter((x) => x !== p))
    this.set({ recent: recentPaths() })
  }

  clearRecent() {
    saveRecent([])
    this.set({ recent: [] })
  }

  async importFile() {
    const p = await os.dialog.openFile({ title: 'Import structure', extensions: ['.mol', '.sdf', '.pdb', '.cif', '.xyz'] })
    if (p) await this.importPath(p)
  }

  /** Molecule ▸ Import structure file (MOL/SDF/PDB/CIF), and .xyz. */
  async importPath(p: string) {
    let text: string
    try {
      text = await fs.readText(p)
    } catch (e) {
      await os.dialog.alert(String(e instanceof Error ? e.message : e), { title: 'Import failed' })
      return
    }
    const name = vpath.basename(p)
    if (/\.cif$/i.test(name)) {
      this.status('Loading ASE for the CIF file…')
      try {
        await this.bridge.ensureAse()
      } catch (e) {
        await os.dialog.alert(String(e instanceof Error ? e.message : e), { title: 'Import failed' })
        return
      }
    }
    const a = await this.call('import', { name, text })
    if (a.ok && a.embed) {
      // a flat (2D) molfile: RDKit makes its SMILES and the built-in builder gives it 3D
      if (!(await this.needRdkit())) return
      const smi = smilesFromMolfile(text)
      if (!smi) {
        await os.dialog.alert(`RDKit could not read a molecule from ${name}`, { title: 'Import failed' })
        return
      }
      if (await this.loadEntry('smiles', smi, name)) this.status(`Imported ${name} (${this.get().mol.formula})`)
      return
    }
    if (!a.ok || !a.mol) {
      await os.dialog.alert(message(a), { title: 'Import failed' })
      return
    }
    this.setMolecule(a.mol)
    this.set({ tab: 0 })
    this.retitle()
    this.status(`Imported ${name} (${a.mol.formula})`)
  }

  private async saveBytes(p: string, data: Uint8Array) {
    await fs.writeBytes(p, data, { mkdirs: true })
  }

  async exportPng() {
    let p = await os.dialog.saveFile({ title: 'Export PNG', defaultName: 'molecule.png', extensions: ['.png'] })
    if (!p) return
    if (!p.toLowerCase().endsWith('.png')) p += '.png'
    await this.exportPngTo(p)
  }

  async exportPngTo(p: string, tab = this.get().tab): Promise<boolean> {
    const canvas = tab === 0 ? await this.renderImage?.(1600, 1200) : this.sketchImage?.(1200, 1000)
    if (!canvas) return false
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) return false
    await this.saveBytes(p, new Uint8Array(await blob.arrayBuffer()))
    this.status(`Exported ${vpath.basename(p)}`)
    return true
  }

  async exportSvg() {
    let p = await os.dialog.saveFile({ title: 'Export SVG (opens in KhervePaint)', defaultName: 'molecule.svg', extensions: ['.svg'] })
    if (!p) return
    if (!p.toLowerCase().endsWith('.svg')) p += '.svg'
    const err = await this.exportSvgTo(p)
    if (err) await os.dialog.alert(err, { title: 'Export failed' })
  }

  /** Writes the SVG; returns an error message or null. */
  async exportSvgTo(p: string, tab = this.get().tab): Promise<string | null> {
    const s = this.get()
    const a =
      tab === 0
        ? await this.call('svg', { labels: s.labels, legend: s.legend })
        : await this.call('svg', { sketch: s.sketch, labels: s.showLabels2d, mode: s.mode })
    if (!a.ok) return message(a)
    await fs.writeText(p, String(a.text), { mkdirs: true })
    this.status(`Exported ${vpath.basename(p)} — open it in KhervePaint`)
    return null
  }

  /** exports_ui.export_chemistry: the format follows the extension. */
  async exportChemistry() {
    const m = this.get().mol
    if (!m.atoms.length) {
      this.status('Nothing to export.')
      return
    }
    const fmts = (this.get().catalog?.chemFormats ?? []).map((f) => f[0])
    let p = await os.dialog.saveFile({ title: 'Export chemistry file', defaultName: m.edges ? 'crystal.cif' : 'molecule.xyz', extensions: fmts.map((f) => `.${f}`) })
    if (!p) return
    let ext = vpath.extname(p).replace('.', '').toLowerCase()
    if (!fmts.includes(ext)) {
      ext = m.edges ? 'cif' : 'xyz'
      p += `.${ext}`
    }
    const err = await this.exportChemTo(p, ext)
    if (err) await os.dialog.alert(err, { title: 'Export failed' })
  }

  async exportChemTo(p: string, fmt: string): Promise<string | null> {
    const a = await this.call('chem_export', { fmt })
    if (!a.ok) return message(a)
    await fs.writeText(p, String(a.text), { mkdirs: true })
    this.status(`Exported ${vpath.basename(p)} (${a.atoms} atoms)`)
    return null
  }

  /** exports_ui.export_mesh, after the Export 3D model dialog. */
  async exportMesh(fmt: string, options: Record<string, unknown>) {
    const names = this.get().catalog?.meshFormats ?? []
    const name = names.find((f) => f[0] === fmt)?.[1] ?? fmt.toUpperCase()
    let p = await os.dialog.saveFile({ title: `Export ${name}`, defaultName: `molecule.${fmt}`, extensions: [`.${fmt}`] })
    if (!p) return
    if (!p.toLowerCase().endsWith(`.${fmt}`)) p += `.${fmt}`
    const err = await this.exportMeshTo(p, fmt, options)
    if (err) await os.dialog.alert(err, { title: 'Export failed' })
  }

  async exportMeshTo(p: string, fmt: string, options: Record<string, unknown>): Promise<string | null> {
    const names = this.get().catalog?.meshFormats ?? []
    const name = names.find((f) => f[0] === fmt)?.[1] ?? fmt.toUpperCase()
    this.status(`Exporting ${name}…`)
    const a = await this.call('mesh_export', { fmt, options })
    if (!a.ok) return message(a)
    const files = a.files as Record<string, string>
    const dir = vpath.dirname(p)
    const stem = vpath.basename(p).replace(/\.[^.]+$/, '')
    for (const [fname, b64] of Object.entries(files)) {
      const isMain = fname.endsWith(`.${fmt}`)
      let data = fromBase64(b64)
      if (fmt === 'obj' && isMain) data = new TextEncoder().encode(new TextDecoder().decode(data).replace(/^mtllib .*$/m, `mtllib ${stem}.mtl`))
      const target = isMain ? p : vpath.join(dir, `${stem}${fname.slice(fname.lastIndexOf('.'))}`)
      await this.saveBytes(target, data)
    }
    const extra = fmt === 'obj' ? ' (+ .mtl)' : ''
    this.status(`Exported ${vpath.basename(p)}${extra} — ${Number(a.triangles).toLocaleString('en-US')} triangles, ${a.colours} colours`)
    return null
  }

  // ------------------------------------------------------------- dialogs

  ask<T>(kind: DialogKind, props: Record<string, unknown> = {}): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      this.set({ dialog: { kind, props, resolve: (v) => resolve(v as T | null) } })
    })
  }

  closeDialog(value: unknown) {
    const d = this.get().dialog
    this.set({ dialog: null })
    d?.resolve(value)
  }

  async openExplorer() {
    const r = await this.ask<{ kind: string; value: string; name: string }>('explorer')
    if (r) await this.loadEntry(r.kind, r.value, r.name)
  }

  async fromSmiles() {
    const text = await os.dialog.prompt('Enter a SMILES string (e.g. CCO, c1ccccc1, CC(=O)O):', { title: 'Build from SMILES' })
    if (text && text.trim()) await this.buildSmiles(text.trim())
  }

  private async runBuilder(kind: DialogKind, props: Record<string, unknown> = {}) {
    const r = await this.ask<{ kind: string; value: string; label: string }>(kind, props)
    if (r) await this.loadEntry(r.kind, r.value, r.label)
  }

  openCrystalBuilder() {
    void this.runBuilder('crystal')
  }
  openNanoBuilder() {
    void this.runBuilder('nano')
  }
  openPolymerBuilder() {
    void this.runBuilder('polymer')
  }
  async openReactionBuilder() {
    await this.refreshShelf()
    await this.runBuilder('reaction')
  }

  async openSurfaceBuilder() {
    await this.refreshShelf()
    const drawn = this.drawnMolecule()
    const r = await this.ask<{ kind: string; value: string; label: string; source: string; kept: string; smiles: string; placement: Record<string, unknown> }>('surface', { drawn })
    if (!r) return
    const a = await this.call('surface_build', { value: r.value, label: r.label, source: r.source, kept: r.kept, smiles: r.smiles, placement: r.placement, drawn: drawn ? molToDict(drawn) : null })
    if (!a.ok || !a.mol) {
      await os.dialog.alert(message(a), { title: 'Cannot build' })
      return
    }
    this.setMolecule(a.mol)
    this.syncSketch(true)
    this.set({ tab: 0 })
    this.retitle()
    this.status(a.placed ? `${a.placed} placed on ${r.label}` : `Loaded ${r.label}${a.mol.formula ? ` (${a.mol.formula})` : ''}`)
  }

  async addMoleculeToSurface() {
    if (!this.isSurface) {
      await os.dialog.alert('Build a surface first (Crystal ▸ Surface builder…), then add molecules to it.', { title: 'Add a molecule to the surface' })
      return
    }
    await this.refreshShelf()
    const drawn = this.drawnMolecule()
    const r = await this.ask<{ source: string; kept: string; smiles: string; placement: Record<string, unknown> }>('addmol', { drawn, crowded: this.get().mol.groups.length > 0 })
    if (!r) return
    const a = await this.call('add_group', { source: r.source, kept: r.kept, smiles: r.smiles, placement: r.placement, drawn: drawn ? molToDict(drawn) : null })
    if (!a.ok || !a.mol) {
      await os.dialog.alert(message(a), { title: 'Cannot add' })
      return
    }
    this.apply(a)
    this.set({ groupIndex: Number(a.index) })
    this.showGroupPose()
    this.status(`${a.label} added to the surface — drag it to move it.`)
  }

  async stackCells() {
    const m = this.get().mol
    if (!m.can_stack) {
      await os.dialog.alert(
        "Load a stackable crystal first — the cubic family and the six non-cubic lattice systems tile into a supercell.\n\n(The HCP model is already drawn as a full hexagonal prism, so it doesn't repeat on its own cell.)",
        { title: 'Stack unit cells' },
      )
      return
    }
    const r = await this.ask<[number, number, number]>('stack', { label: m.label, cells: m.cells })
    if (r) await this.setCells(...r)
  }

  async showProperties() {
    const m = this.get().mol
    const desc = !m.crystal && rdkitAvailable() ? descriptorsFromStructure(m.atoms, m.bonds) : undefined
    const a = await this.call('properties', desc === undefined ? {} : { descriptors: desc ?? {} })
    if (!a.ok) {
      await os.dialog.alert(message(a), { title: 'Molecule properties' })
      return
    }
    await this.ask('properties', { label: m.label, rows: a.rows })
  }

  async exportMeshDialog() {
    const m = this.get().mol
    if (!m.atoms.length) {
      this.status('Nothing to export.')
      return
    }
    const r = await this.ask<{ fmt: string; options: Record<string, unknown> }>('mesh', { style: this.get().style })
    if (r) await this.exportMesh(r.fmt, r.options)
  }

  // ------------------------------------------------------------- the shelf

  async refreshShelf(select?: string) {
    const a = await this.bridge.call('shelf_list')
    if (!a.ok) return
    const items = a.items as ShelfItem[]
    const keep = select ?? this.get().shelfSelected
    this.set({ shelf: items, shelfNext: String(a.next ?? 'Molecule 1'), shelfSelected: items.some((i) => i.name === keep) ? keep : null })
  }

  showShelf() {
    this.set({ docks: { ...this.get().docks, shelf: true }, leftTab: 'shelf' })
  }

  async keepMolecule() {
    const mol = this.drawnMolecule()
    if (!mol) {
      this.status('Nothing to keep: build or load a molecule in the 3D view first.')
      return
    }
    await this.refreshShelf()
    const name = await os.dialog.prompt(`Name for this molecule (${mol.formula}):`, { title: 'Keep molecule', defaultValue: this.get().shelfNext })
    if (name === null) return
    const a = await this.bridge.call('shelf_add', { mol: molToDict(mol), name })
    if (!a.ok) {
      await os.dialog.alert(message(a), { title: 'Cannot keep' })
      return
    }
    await this.refreshShelf(String(a.name))
    this.showShelf()
    this.status(`Kept ${a.name} — use it in a reaction as ${a.token}.`)
  }

  loadKept(name: string) {
    void this.loadEntry('mine', name, name)
  }

  async renameKept(name: string) {
    const next = await os.dialog.prompt('New name:', { title: 'Rename', defaultValue: name })
    if (next === null) return
    const a = await this.bridge.call('shelf_rename', { old: name, new: next })
    if (!a.ok) {
      await os.dialog.alert(message(a), { title: 'Cannot rename' })
      return
    }
    await this.refreshShelf(next.trim())
  }

  async deleteKept(name: string) {
    await this.bridge.call('shelf_remove', { name })
    await this.refreshShelf()
  }

  async moveKept(name: string, delta: number) {
    await this.bridge.call('shelf_move', { name, delta })
    await this.refreshShelf(name)
  }

  // -------------------------------------------------------------- docks

  toggleDock(which: keyof State['docks']) {
    const d = this.get().docks
    this.set({ docks: { ...d, [which]: !d[which] } })
  }

  showPeriodicTable() {
    this.set({ periodic: true })
  }

  elementName(el: string) {
    return elName(el)
  }
}

function stageText(f: FilmData, p: number): string {
  return notesAt(f, p)[1].text ?? ''
}

export { bondsAt }
