// The .kpcb file (pure): JSON {"format": "kpcb", "version": 1, …} of the whole design.

import { roundedRectPoly } from './geom.ts'
import { newDesign, reid } from './board.ts'
import type { Design, Hole, NetClass, Outline, Part, Rules, Track, Via, Zone } from './types.ts'
import { DEFAULT_CLASSES, DEFAULT_RULES } from './types.ts'

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const rnd = (n: number) => Math.round(n * 1e6) / 1e6

export function serializeDesign(d: Design): string {
  const o = {
    format: 'kpcb',
    version: 1,
    name: d.name,
    outline: { pts: d.outline.pts.map((p) => [rnd(p.x), rnd(p.y)]), ...(d.outline.rect ? { rect: d.outline.rect } : {}) },
    holes: d.holes.map((h) => ({ x: rnd(h.x), y: rnd(h.y), d: h.d })),
    parts: d.parts.map((p) => ({
      ref: p.ref, value: p.value, fp: p.fp, x: rnd(p.x), y: rnd(p.y), rot: p.rot, side: p.side,
      ...(p.locked ? { locked: true } : {}), ...(p.stale ? { stale: true } : {}), ...(p.hideRef ? { hideRef: true } : {}),
      ...(p.refAt ? { refAt: [rnd(p.refAt.x), rnd(p.refAt.y)] } : {}),
    })),
    nets: d.nets.map((n) => ({ name: n.name, class: n.cls, pins: n.pins.map((p) => `${p.ref}.${p.pin}`) })),
    classes: d.classes,
    tracks: d.tracks.map((t) => ({ net: t.net, layer: t.layer, w: t.w, a: [rnd(t.x1), rnd(t.y1)], b: [rnd(t.x2), rnd(t.y2)], ...(t.auto ? { auto: true } : {}) })),
    vias: d.vias.map((v) => ({ net: v.net, x: rnd(v.x), y: rnd(v.y), d: v.d, drill: v.drill, ...(v.auto ? { auto: true } : {}) })),
    zones: d.zones.map((z) => ({
      net: z.net, layer: z.layer, clearance: z.clearance, ...(z.thermal ? { thermal: true } : {}), ...(z.name ? { name: z.name } : {}),
      pts: z.pts.map((p) => [rnd(p.x), rnd(p.y)]),
    })),
    rules: d.rules,
  }
  return JSON.stringify(o, null, 1) + '\n'
}

const pt = (v: unknown): { x: number; y: number } | null => (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? { x: v[0], y: v[1] } : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const layer = (v: unknown): 'F.Cu' | 'B.Cu' => (v === 'B.Cu' ? 'B.Cu' : 'F.Cu')

/** Read a .kpcb file: throws an Error with a readable message when it is not one. */
export function parseDesign(text: string): Design {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a kPCB file (it is not valid JSON).')
  }
  const o = obj(raw)
  if (o.format !== 'kpcb') throw new Error('This is not a kPCB file (the "format" is not "kpcb").')
  if (num(o.version, 1) > 1) throw new Error('This file was made by a newer kPCB.')
  const base = newDesign(str(o.name, 'untitled'))
  const ol = obj(o.outline)
  let outline: Outline = { pts: [] }
  const rect = obj(ol.rect)
  const pts = arr(ol.pts).map(pt).filter((p): p is { x: number; y: number } => !!p)
  if (pts.length >= 3) {
    outline = { pts }
    if (typeof rect.w === 'number' && typeof rect.h === 'number') outline.rect = { x: num(rect.x), y: num(rect.y), w: rect.w, h: rect.h, r: num(rect.r) }
  } else if (typeof rect.w === 'number' && typeof rect.h === 'number') {
    outline = { pts: roundedRectPoly(num(rect.x), num(rect.y), rect.w, rect.h, num(rect.r), 8), rect: { x: num(rect.x), y: num(rect.y), w: rect.w, h: rect.h, r: num(rect.r) } }
  }
  const parts: Part[] = arr(o.parts).map((p) => {
    const q = obj(p)
    return {
      id: '', ref: str(q.ref, '?'), value: str(q.value), fp: str(q.fp), x: num(q.x), y: num(q.y), rot: num(q.rot), side: q.side === 'B' ? 'B' : 'F',
      ...(q.locked ? { locked: true } : {}), ...(q.stale ? { stale: true } : {}), ...(q.hideRef ? { hideRef: true } : {}),
      ...(pt(q.refAt) ? { refAt: pt(q.refAt)! } : {}),
    } as Part
  })
  const nets = arr(o.nets).map((n) => {
    const q = obj(n)
    const pins = arr(q.pins).flatMap((s) => {
      if (typeof s !== 'string') return []
      const i = s.lastIndexOf('.')
      return i > 0 ? [{ ref: s.slice(0, i), pin: s.slice(i + 1) }] : []
    })
    return { name: str(q.name), cls: str(q.class, 'Default'), pins }
  }).filter((n) => n.name)
  const classes: Record<string, NetClass> = { ...structuredClone(DEFAULT_CLASSES) }
  for (const [k, v] of Object.entries(obj(o.classes))) {
    const c = obj(v)
    classes[k] = { track: num(c.track, 0.25), via: num(c.via, 0.8), drill: num(c.drill, 0.4), clearance: num(c.clearance, 0.2) }
  }
  const tracks: Track[] = arr(o.tracks).flatMap((t) => {
    const q = obj(t)
    const a = pt(q.a)
    const b = pt(q.b)
    return a && b ? [{ id: '', net: str(q.net), layer: layer(q.layer), w: num(q.w, 0.25), x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(q.auto ? { auto: true } : {}) }] : []
  })
  const vias: Via[] = arr(o.vias).map((v) => {
    const q = obj(v)
    return { id: '', net: str(q.net), x: num(q.x), y: num(q.y), d: num(q.d, 0.8), drill: num(q.drill, 0.4), ...(q.auto ? { auto: true } : {}) }
  })
  const zones: Zone[] = arr(o.zones).map((z) => {
    const q = obj(z)
    return {
      id: '', net: str(q.net), layer: layer(q.layer), clearance: num(q.clearance, 0.2), ...(q.thermal ? { thermal: true } : {}), ...(q.name ? { name: str(q.name) } : {}),
      pts: arr(q.pts).map(pt).filter((p): p is { x: number; y: number } => !!p),
    }
  }).filter((z) => z.pts.length >= 3)
  const holes: Hole[] = arr(o.holes).map((h) => {
    const q = obj(h)
    return { id: '', x: num(q.x), y: num(q.y), d: num(q.d, 3.2) }
  })
  const r = obj(o.rules)
  const rules: Rules = { ...DEFAULT_RULES }
  for (const k of Object.keys(DEFAULT_RULES) as Array<keyof Rules>) {
    const dv = DEFAULT_RULES[k]
    if (typeof dv === 'number') (rules[k] as number) = num(r[k], dv)
    else (rules[k] as boolean) = typeof r[k] === 'boolean' ? (r[k] as boolean) : dv
  }
  return reid({ ...base, name: str(o.name, 'untitled'), outline, holes, parts, nets, classes, tracks, vias, zones, rules })
}

/** Round-trip helper used by tests: equal designs serialise to the same text. */
export const sameDesign = (a: Design, b: Design) => serializeDesign(a) === serializeDesign(b)

