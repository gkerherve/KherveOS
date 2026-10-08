// kPCB data model (pure types, no imports). Millimetres, y down.

import type { Pt } from './geom.ts'

export type Side = 'F' | 'B'
export type CopperId = 'F.Cu' | 'B.Cu'
export type LayerId = 'F.Cu' | 'B.Cu' | 'F.Silk' | 'B.Silk' | 'F.Mask' | 'B.Mask' | 'F.Paste' | 'B.Paste' | 'Edge.Cuts' | 'Courtyard' | 'Drill'

export const LAYERS: readonly LayerId[] = ['F.Cu', 'B.Cu', 'F.Silk', 'B.Silk', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'Edge.Cuts', 'Courtyard', 'Drill']
export const COPPER: readonly CopperId[] = ['F.Cu', 'B.Cu']

// ------------------------------------------------------------ footprints

export type PadShape = 'rect' | 'round' | 'oval' | 'roundrect'

export interface PadDef {
  /** The pad (pin) number or name; pads with the same number are one electrical node. */
  n: string
  shape: PadShape
  x: number
  y: number
  w: number
  h: number
  /** Drill diameter: a through-hole pad. Without it the pad is surface mount on the part's side. */
  drill?: number
  /** false: a bare hole without copper (mounting hole). */
  plated?: boolean
  /** Corner radius ratio of a roundrect pad (default 0.25). */
  rr?: number
}

export type SilkItem =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }
  | { t: 'circle'; cx: number; cy: number; r: number }

export interface Body3D {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Height of the top above the board surface, and of the bottom. */
  h: number
  z0?: number
  /** A cylinder (radial capacitor, LED) instead of a box. */
  round?: boolean
  color?: string
}

export interface Footprint {
  name: string
  desc: string
  cat: string
  /** The reference designator prefix: R, C, U… */
  prefix: string
  pads: PadDef[]
  silk: SilkItem[]
  court: { x0: number; y0: number; x1: number; y1: number }
  ref: Pt
  val: Pt
  bodies: Body3D[]
  smd: boolean
}

// ------------------------------------------------------------ the design

export interface Part {
  id: string
  ref: string
  value: string
  fp: string
  x: number
  y: number
  rot: number
  side: Side
  locked?: boolean
  /** In the design but no longer in the netlist. */
  stale?: boolean
  hideRef?: boolean
  /** Where the reference designator is written, in the part's frame (default: the footprint's). */
  refAt?: { x: number; y: number }
}

export interface Net {
  name: string
  cls: string
  pins: Array<{ ref: string; pin: string }>
}

export interface NetClass {
  track: number
  via: number
  drill: number
  clearance: number
}

export interface Track {
  id: string
  net: string
  layer: CopperId
  w: number
  x1: number
  y1: number
  x2: number
  y2: number
  /** Made by the auto-router. */
  auto?: boolean
}

export interface Via {
  id: string
  net: string
  x: number
  y: number
  d: number
  drill: number
  auto?: boolean
}

export interface Zone {
  id: string
  net: string
  layer: CopperId
  pts: Pt[]
  clearance: number
  thermal?: boolean
  name?: string
}

export interface Hole {
  id: string
  x: number
  y: number
  d: number
}

export interface Outline {
  /** The closed board edge (no repeated first point). */
  pts: Pt[]
  /** Set while the outline is a (rounded) rectangle: lets you change its size and corner radius. */
  rect?: { x: number; y: number; w: number; h: number; r: number }
}

export interface Rules {
  clearance: number
  minTrack: number
  minViaDrill: number
  annular: number
  holeToHole: number
  edgeClearance: number
  minDrill: number
  silkPad: boolean
  courtyard: boolean
  unconnected: boolean
  shorts: boolean
  dangling: boolean
}

export interface Design {
  format: 'kpcb'
  version: 1
  name: string
  outline: Outline
  holes: Hole[]
  parts: Part[]
  nets: Net[]
  classes: Record<string, NetClass>
  tracks: Track[]
  vias: Via[]
  zones: Zone[]
  rules: Rules
}

export interface Violation {
  id: string
  severity: 'error' | 'warning'
  rule: string
  message: string
  x: number
  y: number
}

/** The filled copper of one zone: islands, each an outer ring with holes. */
export interface FillPoly {
  outer: Pt[]
  holes: Pt[][]
}
export type Fills = Record<string, FillPoly[]>

export const DEFAULT_RULES: Rules = {
  clearance: 0.2,
  minTrack: 0.2,
  minViaDrill: 0.3,
  annular: 0.13,
  holeToHole: 0.25,
  edgeClearance: 0.3,
  minDrill: 0.3,
  silkPad: true,
  courtyard: true,
  unconnected: true,
  shorts: true,
  dangling: true,
}

export const DEFAULT_CLASSES: Record<string, NetClass> = {
  Default: { track: 0.25, via: 0.8, drill: 0.4, clearance: 0.2 },
  Power: { track: 0.5, via: 1.0, drill: 0.5, clearance: 0.2 },
  Signal: { track: 0.25, via: 0.8, drill: 0.4, clearance: 0.2 },
}

export const TRACK_WIDTHS = [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2]
export const VIA_PRESETS: Array<{ d: number; drill: number }> = [
  { d: 0.6, drill: 0.3 },
  { d: 0.8, drill: 0.4 },
  { d: 1.0, drill: 0.5 },
  { d: 1.2, drill: 0.6 },
]
export const GRIDS_MM = [0.05, 0.1, 0.25, 0.5, 1]
export const GRIDS_MIL = [1, 5, 25, 50]
