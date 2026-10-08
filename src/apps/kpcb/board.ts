// Design helpers (pure): placing footprints in the world, pad shapes, nets of pads, outlines.
// A footprint is in the part's own frame; the world frame is   p' = part + R(rot) · M(side) · p
// (M mirrors x for a part on the bottom side, rot is counter-clockwise on the screen).

import type { Box, Pt, Shape } from './geom.ts'
import { arcPoints, polyBox, rectPoly, roundedRectPoly, rot, unionBox } from './geom.ts'
import { getFootprint } from './footprints.ts'
import type { CopperId, Design, Footprint, Hole, Net, NetClass, Outline, PadDef, Part, Track, Via } from './types.ts'
import { DEFAULT_CLASSES, DEFAULT_RULES } from './types.ts'

// ------------------------------------------------------------ ids and names

let counter = 0
export const uid = (prefix: string) => `${prefix}${(++counter).toString(36)}`

export function newDesign(name = 'untitled'): Design {
  return {
    format: 'kpcb',
    version: 1,
    name,
    outline: rectOutline(0, 0, 50, 50, 0),
    holes: [],
    parts: [],
    nets: [],
    classes: structuredClone(DEFAULT_CLASSES),
    tracks: [],
    vias: [],
    zones: [],
    rules: { ...DEFAULT_RULES },
  }
}

/** The smallest unused reference designator with this prefix: R1, R2… */
export function nextRef(d: Design, prefix: string): string {
  const used = new Set(d.parts.map((p) => p.ref))
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`
}

export const partByRef = (d: Design, ref: string): Part | undefined => d.parts.find((p) => p.ref === ref)

// ------------------------------------------------------------ outline

export function rectOutline(x: number, y: number, w: number, h: number, r: number): Outline {
  return { pts: roundedRectPoly(x, y, w, h, r, 8), rect: { x, y, w, h, r } }
}

export function outlineBox(d: Design): Box | null {
  return d.outline.pts.length >= 3 ? polyBox(d.outline.pts) : null
}

/** The bounding box of everything on the board (outline, parts, tracks). */
export function designBox(d: Design): Box | null {
  let b: Box | null = outlineBox(d)
  for (const p of d.parts) b = unionBox(b, partBox(p))
  for (const t of d.tracks) b = unionBox(b, { x0: Math.min(t.x1, t.x2) - t.w / 2, y0: Math.min(t.y1, t.y2) - t.w / 2, x1: Math.max(t.x1, t.x2) + t.w / 2, y1: Math.max(t.y1, t.y2) + t.w / 2 })
  for (const v of d.vias) b = unionBox(b, { x0: v.x - v.d / 2, y0: v.y - v.d / 2, x1: v.x + v.d / 2, y1: v.y + v.d / 2 })
  for (const h of d.holes) b = unionBox(b, { x0: h.x - h.d / 2, y0: h.y - h.d / 2, x1: h.x + h.d / 2, y1: h.y + h.d / 2 })
  return b
}

// ------------------------------------------------------------ footprints in the world

export interface WorldPad {
  part: Part
  fp: Footprint
  index: number
  def: PadDef
  n: string
  x: number
  y: number
  w: number
  h: number
  /** Rotation of the pad in the world (the part's rotation). */
  rot: number
  /** Copper layers it is on (none for a bare hole). */
  layers: CopperId[]
  drill: number
  plated: boolean
  /** "R1.2" */
  label: string
}

export function toWorld(part: Part, p: Pt): Pt {
  const q = rot(part.side === 'B' ? { x: -p.x, y: p.y } : p, part.rot)
  return { x: part.x + q.x, y: part.y + q.y }
}

/** The inverse: a world point in the part's frame. */
export function toLocal(part: Part, p: Pt): Pt {
  const q = rot({ x: p.x - part.x, y: p.y - part.y }, -part.rot)
  return part.side === 'B' ? { x: -q.x, y: q.y } : q
}

const padCache = new WeakMap<Part, WorldPad[]>()

export function worldPads(part: Part): WorldPad[] {
  const hit = padCache.get(part)
  if (hit) return hit
  const fp = getFootprint(part.fp)
  const out: WorldPad[] = []
  if (fp) {
    fp.pads.forEach((def, index) => {
      const c = toWorld(part, def)
      const plated = def.plated !== false
      const layers: CopperId[] = !plated ? [] : def.drill !== undefined ? ['F.Cu', 'B.Cu'] : [part.side === 'F' ? 'F.Cu' : 'B.Cu']
      out.push({
        part, fp, index, def, n: def.n, x: c.x, y: c.y, w: def.w, h: def.h, rot: part.rot, layers,
        drill: def.drill ?? 0, plated, label: `${part.ref}.${def.n}`,
      })
    })
  }
  padCache.set(part, out)
  return out
}

/** The copper shape of a pad (null for a bare hole). */
export function padShape(p: WorldPad): Shape | null {
  if (!p.plated && p.layers.length === 0) return null
  return shapeOfRect(p.x, p.y, p.w, p.h, p.rot, p.def.shape, p.def.rr)
}

/** A pad outline as "core + radius". */
export function shapeOfRect(x: number, y: number, w: number, h: number, deg: number, shape: PadDef['shape'], rr = 0.25): Shape {
  if (shape === 'round' && Math.abs(w - h) < 1e-9) return { core: [{ x, y }], r: w / 2 }
  if (shape === 'round' || shape === 'oval') {
    const long = Math.max(w, h)
    const short = Math.min(w, h)
    if (long - short < 1e-9) return { core: [{ x, y }], r: short / 2 }
    const half = (long - short) / 2
    const a = rot(w >= h ? { x: -half, y: 0 } : { x: 0, y: -half }, deg)
    const b = rot(w >= h ? { x: half, y: 0 } : { x: 0, y: half }, deg)
    return { core: [{ x: x + a.x, y: y + a.y }, { x: x + b.x, y: y + b.y }], r: short / 2 }
  }
  if (shape === 'roundrect') {
    const r = Math.min(w, h) * rr
    const iw = w - 2 * r
    const ih = h - 2 * r
    if (iw < 1e-9 && ih < 1e-9) return { core: [{ x, y }], r }
    if (iw < 1e-9 || ih < 1e-9) return shapeOfRect(x, y, w, h, deg, 'oval')
    return { core: rectPoly(x, y, iw, ih, deg), r }
  }
  return { core: rectPoly(x, y, w, h, deg), r: 0 }
}

export const trackShape = (t: Track): Shape => ({ core: [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }], r: t.w / 2 })
export const viaShape = (v: Via): Shape => ({ core: [{ x: v.x, y: v.y }], r: v.d / 2 })
export const holeShape = (h: Hole): Shape => ({ core: [{ x: h.x, y: h.y }], r: h.d / 2 })

/** The courtyard of a part as a 4-point polygon in the world. */
export function partCourtyard(part: Part): Pt[] {
  const fp = getFootprint(part.fp)
  if (!fp) return rectPoly(part.x, part.y, 1, 1)
  const c = fp.court
  return [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y0 }, { x: c.x1, y: c.y1 }, { x: c.x0, y: c.y1 }].map((p) => toWorld(part, p))
}

export function partBox(part: Part): Box {
  return polyBox(partCourtyard(part))
}

/** Where the reference designator text of a part is written (upright). */
export function refTextPos(part: Part): Pt {
  const fp = getFootprint(part.fp)
  if (part.refAt) return toWorld(part, part.refAt)
  return fp ? toWorld(part, fp.ref) : { x: part.x, y: part.y }
}

export const REF_TEXT_H = 1.0

/** The silkscreen drawing of a footprint in the world, as segments (arcs and circles approximated). */
export function partSilk(part: Part): Array<[Pt, Pt]> {
  const fp = getFootprint(part.fp)
  if (!fp) return []
  const out: Array<[Pt, Pt]> = []
  for (const s of fp.silk) {
    if (s.t === 'line') out.push([toWorld(part, { x: s.x1, y: s.y1 }), toWorld(part, { x: s.x2, y: s.y2 })])
    else {
      const full = s.t === 'circle'
      const pts = (full ? arcPoints(s.cx, s.cy, s.r, 0, 360, 24) : arcPoints(s.cx, s.cy, s.r, s.a0, s.a1, Math.max(6, Math.ceil(Math.abs(s.a1 - s.a0) / 15)))).map((p) => toWorld(part, p))
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]])
    }
  }
  return out
}

// ------------------------------------------------------------ nets

const netCache = new WeakMap<Net[], Map<string, string>>()
const padKey = (ref: string, n: string) => `${ref}\u0000${n}`

/** "ref pin" → net name. */
export function padNets(d: Design): Map<string, string> {
  const hit = netCache.get(d.nets)
  if (hit) return hit
  const m = new Map<string, string>()
  for (const net of d.nets) for (const p of net.pins) m.set(padKey(p.ref, p.pin), net.name)
  netCache.set(d.nets, m)
  return m
}

export const netOfPad = (d: Design, ref: string, n: string): string => padNets(d).get(padKey(ref, n)) ?? ''

export const netClassOf = (d: Design, netName: string): NetClass => {
  const n = d.nets.find((x) => x.name === netName)
  return d.classes[n?.cls ?? 'Default'] ?? d.classes.Default ?? DEFAULT_CLASSES.Default
}

/** The class a net called this gets by default: power rails are Power. */
export function guessClass(name: string): string {
  return /^(\+?\d+V\d*|\+?V(CC|DD|BUS|IN|BAT)\w*|GND\w*|AGND|DGND|VSS\w*|PWR\w*|\+\d+(\.\d+)?V?|V\+|V-|VEE|VCC\w*|5V|3V3|3\.3V)$/i.test(name.trim()) ? 'Power' : 'Default'
}

export function addPinToNet(d: Design, netName: string, ref: string, pin: string): Design {
  const nets = d.nets.map((n) => ({ ...n, pins: n.pins.filter((p) => !(p.ref === ref && p.pin === pin)) }))
  const i = nets.findIndex((n) => n.name === netName)
  if (netName) {
    if (i >= 0) nets[i] = { ...nets[i], pins: [...nets[i].pins, { ref, pin }] }
    else nets.push({ name: netName, cls: guessClass(netName), pins: [{ ref, pin }] })
  }
  return { ...d, nets: nets.filter((n) => n.pins.length > 0 || n.name === netName) }
}

/** The 3D / drawing height of a part's tallest body. */
export function partHeight(part: Part): number {
  const fp = getFootprint(part.fp)
  return fp ? Math.max(0, ...fp.bodies.map((b) => b.h)) : 0
}

/** Pad-only: is this part surface mount? */
export const isSmdPart = (part: Part): boolean => getFootprint(part.fp)?.smd ?? false

export function trackLength(d: Design): number {
  let s = 0
  for (const t of d.tracks) s += Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
  return s
}

/** Re-number the ids of everything (after loading a file). */
export function reid(d: Design): Design {
  return {
    ...d,
    parts: d.parts.map((p) => ({ ...p, id: uid('p') })),
    tracks: d.tracks.map((t) => ({ ...t, id: uid('t') })),
    vias: d.vias.map((v) => ({ ...v, id: uid('v') })),
    zones: d.zones.map((z) => ({ ...z, id: uid('z') })),
    holes: d.holes.map((h) => ({ ...h, id: uid('h') })),
  }
}

/** The copper layers a pad is on. */
export const padLayers = (p: WorldPad): CopperId[] => p.layers

export const otherSide = (l: CopperId): CopperId => (l === 'F.Cu' ? 'B.Cu' : 'F.Cu')
