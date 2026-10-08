// What the interface shares: tools, the editor state the canvas and panels work on, preferences, help text.

import type { Design, CopperId, Fills, Side } from './types.ts'
import type { Appearance } from './draw.ts'
import { DEFAULT_APPEARANCE } from './draw.ts'
import type { Item } from './ops.ts'
import type { RouteMode } from './route.ts'

export type Tool = 'select' | 'place' | 'route' | 'via' | 'zone' | 'outline' | 'outline-poly' | 'hole' | 'measure' | 'assign'

export interface UIState {
  tool: Tool
  placeFp: string
  placeRot: number
  placeSide: Side
  active: CopperId
  /** Grid step in mm. */
  grid: number
  unit: 'mm' | 'mil'
  /** 0: the track width of the net's class. */
  trackWidth: number
  /** -1: the via of the net's class. */
  viaIndex: number
  routeMode: RouteMode
  flipView: boolean
  view3d: boolean
  ap: Appearance
  assignNet: string
  liveDrc: boolean
}

export const DEFAULT_UI: UIState = {
  tool: 'select',
  placeFp: 'R_0805',
  placeRot: 0,
  placeSide: 'F',
  active: 'F.Cu',
  grid: 0.5,
  unit: 'mm',
  trackWidth: 0,
  viaIndex: -1,
  routeMode: '45',
  flipView: false,
  view3d: false,
  ap: DEFAULT_APPEARANCE,
  assignNet: '',
  liveDrc: false,
}

/** What the canvas needs from the app. */
export interface Editor {
  readonly design: Design
  readonly fills: Fills
  readonly ui: UIState
  readonly sel: readonly Item[]
  /** One change, one undo step. */
  commit(d: Design): void
  /** A gesture: begin, preview as often as needed, end (one undo step). */
  begin(): void
  preview(d: Design): void
  end(): void
  cancel(): void
  setSel(items: Item[]): void
  setHover(net: string): void
  patchUI(p: Partial<UIState>): void
  /** A short message in the status bar. */
  say(msg: string): void
  /** Refill the zones now. */
  refill(): void
  menu(e: { clientX: number; clientY: number }, items: import('@/os').MenuItem[]): void
  ask(message: string, defaultValue?: string): Promise<string | null>
  onCursor(p: { x: number; y: number } | null): void
  /** Run a command by name (rotate, flip, delete, copy, paste, fill…). */
  act(cmd: string): void
}

// ------------------------------------------------------------ preferences

const PREFS_KEY = 'kherveos.kpcb.prefs'

type Saved = Partial<Pick<UIState, 'grid' | 'unit' | 'trackWidth' | 'viaIndex' | 'routeMode' | 'liveDrc'>> & { ap?: Partial<Appearance> }

export function loadPrefs(): UIState {
  const ui: UIState = { ...DEFAULT_UI, ap: { ...DEFAULT_APPEARANCE, colors: { ...DEFAULT_APPEARANCE.colors }, visible: { ...DEFAULT_APPEARANCE.visible } } }
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Saved
    if (typeof s.grid === 'number' && s.grid > 0) ui.grid = s.grid
    if (s.unit === 'mil' || s.unit === 'mm') ui.unit = s.unit
    if (typeof s.trackWidth === 'number') ui.trackWidth = s.trackWidth
    if (typeof s.viaIndex === 'number') ui.viaIndex = s.viaIndex
    if (s.routeMode === '45' || s.routeMode === '90' || s.routeMode === 'free') ui.routeMode = s.routeMode
    if (typeof s.liveDrc === 'boolean') ui.liveDrc = s.liveDrc
    if (s.ap) {
      ui.ap = { ...ui.ap, ...s.ap, colors: { ...ui.ap.colors, ...(s.ap.colors ?? {}) }, visible: { ...ui.ap.visible, ...(s.ap.visible ?? {}) } }
    }
  } catch { /* storage blocked or damaged */ }
  return ui
}

export function savePrefs(ui: UIState) {
  try {
    const s: Saved = { grid: ui.grid, unit: ui.unit, trackWidth: ui.trackWidth, viaIndex: ui.viaIndex, routeMode: ui.routeMode, liveDrc: ui.liveDrc, ap: ui.ap }
    localStorage.setItem(PREFS_KEY, JSON.stringify(s))
  } catch { /* storage blocked */ }
}

const RECENT_KEY = 'kherveos.kpcb.recent'

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export function pushRecent(path: string): string[] {
  const list = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* storage blocked */ }
  return list
}

const AUTOSAVE_KEY = 'kherveos.kpcb.autosave'

export interface Autosave {
  text: string
  savedAt: number
  name: string
}

export function saveAutosave(a: Autosave | null) {
  try {
    if (a) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a))
    else localStorage.removeItem(AUTOSAVE_KEY)
  } catch { /* storage full or blocked */ }
}

export function loadAutosave(): Autosave | null {
  try {
    const v = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? 'null') as Autosave | null
    return v && typeof v.text === 'string' && typeof v.savedAt === 'number' ? v : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------ units

export const mmToUnit = (mm: number, unit: 'mm' | 'mil') => (unit === 'mil' ? mm / 0.0254 : mm)
export const fmtLen = (mm: number, unit: 'mm' | 'mil') => (unit === 'mil' ? `${(mm / 0.0254).toFixed(1)} mil` : `${(Math.round(mm * 1000) / 1000).toString()} mm`)
export const gridLabel = (mm: number, unit: 'mm' | 'mil') => (unit === 'mil' ? `${Math.round(mm / 0.0254)} mil` : `${mm} mm`)

// ------------------------------------------------------------ help

export const SHORTCUTS: Array<[string, string]> = [
  ['Esc', 'Cancel what you are doing; back to the Select tool'],
  ['Wheel / pinch', 'Zoom at the pointer'],
  ['Middle or right drag, Space + drag', 'Pan'],
  ['Click, ⇧ click, drag a box', 'Select, add to the selection, select what is inside'],
  ['R / ⇧R', 'Rotate the part (or the part being placed) 90° left / right'],
  ['F', 'Flip the part to the other side of the board'],
  ['⇧F', 'View the board from the bottom (and back)'],
  ['Delete / Backspace', 'Delete the selection (while routing: the last corner)'],
  ['⌘Z / ⇧⌘Z (⌘Y)', 'Undo / redo'],
  ['⌘C, ⌘V, ⌘D', 'Copy, paste, duplicate'],
  ['⌘A', 'Select everything'],
  ['X', 'Route tracks: click a pad or track end, click to place corners, click on a pad of the same net (or double-click, Enter) to finish'],
  ['⇧ (while routing)', 'Switch between 45° and 90° corners'],
  ['Space (while routing)', 'Bend the other way'],
  ['V', 'Route: add a via here and continue on the other layer. Otherwise: the Via tool'],
  ['W', 'Next track width'],
  ['1 / 2, PageUp / PageDown', 'Active copper layer: F.Cu / B.Cu'],
  ['Z', 'Draw a copper zone (click corners, double-click or Enter to close)'],
  ['B', 'Fill all zones'],
  ['M', 'Measure'],
  ['G', 'Next grid'],
  ['P', 'Place a part (the Library)'],
  ['H', 'Add a mounting hole'],
  ['3', 'Switch between the 2D board and the 3D view'],
  ['⌘0 / Home', 'Zoom to fit'],
  ['⇧⌘D', 'Run the design-rule check'],
  ['⇧⌘R', 'Auto-route everything missing'],
]

export const NETLIST_HELP = `One part per line:  REF  VALUE  FOOTPRINT  |  NET:PIN  NET:PIN …

  # a 555 blinker
  title: blinker
  U1 NE555 DIP-8 | GND:1 TRIG:2 OUT:3 VCC:4 VCC:8
  R1 10k R_0805  | VCC:1 TRIG:2
  C1 - C_0805    | TRIG:1 GND:2

VALUE and FOOTPRINT are optional ("-" is an empty value): without a footprint the letters of the reference choose one (R: R_0805, C: C_0805, U: a DIP, J: a pin header…).
PIN is the pad number of the footprint. A line starting with # is a comment.

KiCad netlists work too: an (export (components (comp (ref R1) (value 10k) (footprint Resistor_SMD:R_0805_2012Metric)) …) (nets (net (code 1) (name "VCC") (node (ref R1) (pin 1)) …))) file.

From kElec: choose Send to kPCB; resistors, capacitors and diodes use pins 1 and 2 (a diode: A = 1, K = 2); a transistor B, C, E = pads 1, 2, 3 of a TO-92 or TO-220 (a SOT-23 follows its datasheet: 1 = B, 2 = E, 3 = C; a MOSFET G, D, S likewise), an op-amp IN-, IN+, V-, OUT, V+ = pads 2, 3, 4, 6, 7 of a DIP-8.`
