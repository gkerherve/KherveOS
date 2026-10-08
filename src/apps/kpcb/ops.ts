// Editing operations on a design (pure): every function takes a design and returns a new one.
// Selections, nets, outlines, parts, tracks and vias are edited here; the React side only calls them.

import type { Box, Pt } from './geom.ts'
import { distPointSeg, pointInPoly, polyBox, roundedRectPoly, unionBox } from './geom.ts'
import { addPinToNet, guessClass, netClassOf, netOfPad, nextRef, partBox, rectOutline, uid, worldPads } from './board.ts'
import { getFootprint } from './footprints.ts'
import { analyze } from './analysis.ts'
import type { CopperId, Design, Net, Part, Side, Track, Via, Zone } from './types.ts'

export type ItemKind = 'part' | 'track' | 'via' | 'zone' | 'hole' | 'outline'
export interface Item {
  kind: ItemKind
  id: string
}

export const itemKey = (i: Item) => `${i.kind}:${i.id}`
export const sameItem = (a: Item, b: Item) => a.kind === b.kind && a.id === b.id

const snap = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v)
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

// ------------------------------------------------------------ parts

const DEFAULT_VALUES: Record<string, string> = { R: '10k', C: '100n', L: '10u', D: '1N4148', Q: '2N3904', Y: '16MHz', RV: '10k', U: '', J: '', SW: '', BZ: '', H: '', TP: '', A: '', DS: '' }

export function defaultValue(fpName: string): string {
  const fp = getFootprint(fpName)
  if (!fp) return ''
  if (fp.cat === 'LEDs') return 'LED'
  if (fp.name.startsWith('CP_')) return '10u'
  return DEFAULT_VALUES[fp.prefix] ?? ''
}

export function addPart(d: Design, fpName: string, x: number, y: number, opts: { rot?: number; side?: Side; ref?: string; value?: string } = {}): { design: Design; part: Part } {
  const fp = getFootprint(fpName)
  if (!fp) throw new Error(`Unknown footprint "${fpName}".`)
  const part: Part = {
    id: uid('p'), ref: opts.ref ?? nextRef(d, fp.prefix), value: opts.value ?? defaultValue(fp.name), fp: fp.name,
    x: r4(x), y: r4(y), rot: opts.rot ?? 0, side: opts.side ?? 'F',
  }
  return { design: { ...d, parts: [...d.parts, part] }, part }
}

const mapParts = (d: Design, ids: ReadonlySet<string>, fn: (p: Part) => Part): Design => ({ ...d, parts: d.parts.map((p) => (ids.has(p.id) && !p.locked ? fn(p) : p)) })

export function moveParts(d: Design, ids: Iterable<string>, dx: number, dy: number): Design {
  return mapParts(d, new Set(ids), (p) => ({ ...p, x: r4(p.x + dx), y: r4(p.y + dy) }))
}

export function setPartPos(d: Design, id: string, x: number, y: number): Design {
  return mapParts(d, new Set([id]), (p) => ({ ...p, x: r4(x), y: r4(y) }))
}

/** Turn parts by `deg` (counter-clockwise): about their own origin, or about the middle of the group. */
export function rotateParts(d: Design, ids: Iterable<string>, deg: number, group = false): Design {
  const set = new Set(ids)
  let c: Pt | null = null
  const sel = d.parts.filter((p) => set.has(p.id) && !p.locked)
  if (group && sel.length > 1) {
    const b = sel.map((p) => ({ x: p.x, y: p.y }))
    const bb = polyBox(b)
    c = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }
  }
  const rad = (deg * Math.PI) / 180
  return mapParts(d, set, (p) => {
    let x = p.x
    let y = p.y
    if (c) {
      const dx = p.x - c.x
      const dy = p.y - c.y
      x = c.x + dx * Math.cos(rad) + dy * Math.sin(rad)
      y = c.y - dx * Math.sin(rad) + dy * Math.cos(rad)
    }
    return { ...p, x: r4(x), y: r4(y), rot: ((((p.rot + deg) % 360) + 360) % 360) }
  })
}

/** Move parts to the other side of the board (mirrored left to right about the middle of the group). */
export function flipParts(d: Design, ids: Iterable<string>): Design {
  const set = new Set(ids)
  const sel = d.parts.filter((p) => set.has(p.id) && !p.locked)
  let cx = 0
  if (sel.length > 1) {
    const bb = polyBox(sel.map((p) => ({ x: p.x, y: p.y })))
    cx = (bb.x0 + bb.x1) / 2
  }
  return mapParts(d, set, (p) => ({
    ...p, side: p.side === 'F' ? 'B' : 'F', x: sel.length > 1 ? r4(2 * cx - p.x) : p.x, rot: sel.length > 1 ? ((360 - p.rot) % 360) : p.rot,
  }))
}

export function setPartProps(d: Design, id: string, patch: Partial<Pick<Part, 'ref' | 'value' | 'fp' | 'side' | 'rot' | 'locked' | 'x' | 'y' | 'hideRef'>>): Design {
  const old = d.parts.find((p) => p.id === id)
  if (!old) return d
  let next = d
  if (patch.ref !== undefined && patch.ref !== old.ref) {
    const ref = patch.ref.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(ref)) throw new Error(`"${patch.ref}" is not a valid reference (letters, then letters or digits).`)
    if (d.parts.some((p) => p.ref === ref && p.id !== id)) throw new Error(`${ref} is already used.`)
    next = { ...next, nets: next.nets.map((n) => ({ ...n, pins: n.pins.map((p) => (p.ref === old.ref ? { ...p, ref } : p)) })) }
    patch = { ...patch, ref }
  }
  if (patch.fp !== undefined && !getFootprint(patch.fp)) throw new Error(`Unknown footprint "${patch.fp}".`)
  const fp = patch.fp !== undefined ? getFootprint(patch.fp)!.name : undefined
  return { ...next, parts: next.parts.map((p) => (p.id === id ? { ...p, ...patch, ...(fp ? { fp } : {}), ...(patch.rot !== undefined ? { rot: ((patch.rot % 360) + 360) % 360 } : {}) } : p)) }
}

export function alignParts(d: Design, ids: Iterable<string>, mode: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'): Design {
  const set = new Set(ids)
  const sel = d.parts.filter((p) => set.has(p.id) && !p.locked)
  if (sel.length < 2) return d
  const boxes = new Map(sel.map((p) => [p.id, partBox(p)]))
  const all = [...boxes.values()]
  const target = {
    left: Math.min(...all.map((b) => b.x0)),
    right: Math.max(...all.map((b) => b.x1)),
    top: Math.min(...all.map((b) => b.y0)),
    bottom: Math.max(...all.map((b) => b.y1)),
    hcenter: all.reduce((s, b) => s + (b.x0 + b.x1) / 2, 0) / all.length,
    vcenter: all.reduce((s, b) => s + (b.y0 + b.y1) / 2, 0) / all.length,
  }
  return mapParts(d, set, (p) => {
    const b = boxes.get(p.id)!
    switch (mode) {
      case 'left': return { ...p, x: r4(p.x + target.left - b.x0) }
      case 'right': return { ...p, x: r4(p.x + target.right - b.x1) }
      case 'top': return { ...p, y: r4(p.y + target.top - b.y0) }
      case 'bottom': return { ...p, y: r4(p.y + target.bottom - b.y1) }
      case 'hcenter': return { ...p, x: r4(p.x + target.hcenter - (b.x0 + b.x1) / 2) }
      case 'vcenter': return { ...p, y: r4(p.y + target.vcenter - (b.y0 + b.y1) / 2) }
    }
  })
}

/** Space parts evenly between the first and the last one (by their centres). */
export function distributeParts(d: Design, ids: Iterable<string>, axis: 'h' | 'v'): Design {
  const set = new Set(ids)
  const sel = d.parts.filter((p) => set.has(p.id) && !p.locked)
  if (sel.length < 3) return d
  const centre = (p: Part) => {
    const b = partBox(p)
    return axis === 'h' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2
  }
  const sorted = [...sel].sort((a, b) => centre(a) - centre(b))
  const first = centre(sorted[0])
  const last = centre(sorted[sorted.length - 1])
  const shift = new Map<string, number>()
  sorted.forEach((p, i) => shift.set(p.id, first + ((last - first) * i) / (sorted.length - 1) - centre(p)))
  return mapParts(d, set, (p) => (axis === 'h' ? { ...p, x: r4(p.x + (shift.get(p.id) ?? 0)) } : { ...p, y: r4(p.y + (shift.get(p.id) ?? 0)) }))
}

// ------------------------------------------------------------ deleting, copying

export function deleteItems(d: Design, items: readonly Item[]): Design {
  const ids = (k: ItemKind) => new Set(items.filter((i) => i.kind === k).map((i) => i.id))
  const parts = ids('part')
  const gone = new Set(d.parts.filter((p) => parts.has(p.id)).map((p) => p.ref))
  const tracks = ids('track')
  const vias = ids('via')
  const zones = ids('zone')
  const holes = ids('hole')
  const nets = gone.size
    ? d.nets.map((n) => ({ ...n, pins: n.pins.filter((p) => !gone.has(p.ref)) })).filter((n) => n.pins.length > 0)
    : d.nets
  return {
    ...d,
    parts: d.parts.filter((p) => !parts.has(p.id)),
    nets,
    tracks: d.tracks.filter((t) => !tracks.has(t.id)),
    vias: d.vias.filter((v) => !vias.has(v.id)),
    zones: d.zones.filter((z) => !zones.has(z.id)),
    holes: d.holes.filter((h) => !holes.has(h.id)),
  }
}

export interface Clipboard {
  parts: Part[]
  tracks: Track[]
  vias: Via[]
  zones: Zone[]
  origin: Pt
}

export function copyItems(d: Design, items: readonly Item[]): Clipboard | null {
  const has = (k: ItemKind, id: string) => items.some((i) => i.kind === k && i.id === id)
  const parts = d.parts.filter((p) => has('part', p.id))
  const tracks = d.tracks.filter((t) => has('track', t.id))
  const vias = d.vias.filter((v) => has('via', v.id))
  const zones = d.zones.filter((z) => has('zone', z.id))
  if (!parts.length && !tracks.length && !vias.length && !zones.length) return null
  let box: Box | null = null
  for (const p of parts) box = unionBox(box, partBox(p))
  for (const t of tracks) box = unionBox(box, { x0: Math.min(t.x1, t.x2), y0: Math.min(t.y1, t.y2), x1: Math.max(t.x1, t.x2), y1: Math.max(t.y1, t.y2) })
  for (const v of vias) box = unionBox(box, { x0: v.x, y0: v.y, x1: v.x, y1: v.y })
  for (const z of zones) box = unionBox(box, polyBox(z.pts))
  return { parts, tracks, vias, zones, origin: { x: box!.x0, y: box!.y0 } }
}

/** Paste with the top left of the group at `at`; parts get new references, copper is not tied to nets. */
export function pasteClipboard(d: Design, c: Clipboard, at: Pt): { design: Design; items: Item[] } {
  const dx = at.x - c.origin.x
  const dy = at.y - c.origin.y
  let cur = d
  const items: Item[] = []
  for (const p of c.parts) {
    const fp = getFootprint(p.fp)
    const r = addPart(cur, p.fp, p.x + dx, p.y + dy, { rot: p.rot, side: p.side, value: p.value, ref: nextRef(cur, fp?.prefix ?? (p.ref.replace(/\d+$/, '') || 'U')) })
    cur = r.design
    items.push({ kind: 'part', id: r.part.id })
  }
  const tracks = c.tracks.map((t) => ({ ...t, id: uid('t'), net: '', x1: r4(t.x1 + dx), y1: r4(t.y1 + dy), x2: r4(t.x2 + dx), y2: r4(t.y2 + dy), auto: undefined }))
  const vias = c.vias.map((v) => ({ ...v, id: uid('v'), net: '', x: r4(v.x + dx), y: r4(v.y + dy), auto: undefined }))
  const zones = c.zones.map((z) => ({ ...z, id: uid('z'), net: '', pts: z.pts.map((p) => ({ x: r4(p.x + dx), y: r4(p.y + dy) })) }))
  for (const t of tracks) items.push({ kind: 'track', id: t.id })
  for (const v of vias) items.push({ kind: 'via', id: v.id })
  for (const z of zones) items.push({ kind: 'zone', id: z.id })
  return { design: { ...cur, tracks: [...cur.tracks, ...tracks], vias: [...cur.vias, ...vias], zones: [...cur.zones, ...zones] }, items }
}

// ------------------------------------------------------------ tracks and vias

const TOL = 1e-3
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < TOL && Math.abs(a.y - b.y) < TOL

/** Add a polyline of tracks. Zero-length pieces are dropped. */
export function addTrackPath(d: Design, pts: readonly Pt[], layer: CopperId, w: number, net: string): { design: Design; ids: string[] } {
  const tracks: Track[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    if (same(pts[i], pts[i + 1])) continue
    tracks.push({ id: uid('t'), net, layer, w, x1: r4(pts[i].x), y1: r4(pts[i].y), x2: r4(pts[i + 1].x), y2: r4(pts[i + 1].y) })
  }
  return { design: tracks.length ? { ...d, tracks: [...d.tracks, ...tracks] } : d, ids: tracks.map((t) => t.id) }
}

export function addVia(d: Design, x: number, y: number, net: string, size?: { d: number; drill: number }): { design: Design; via: Via } {
  const cls = netClassOf(d, net)
  const via: Via = { id: uid('v'), net, x: r4(x), y: r4(y), d: size?.d ?? cls.via, drill: size?.drill ?? cls.drill }
  return { design: { ...d, vias: [...d.vias, via] }, via }
}

/**
 * Drag a track segment by (dx, dy). Ends it shares with other tracks of the net on its layer or with
 * a via move along; an end on a pad stays on the pad and a short piece of track keeps it joined.
 */
export function dragTrack(d: Design, id: string, dx: number, dy: number): Design {
  const t = d.tracks.find((x) => x.id === id)
  if (!t) return d
  const ends: Pt[] = [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }]
  const moved = ends.map((e) => ({ x: r4(e.x + dx), y: r4(e.y + dy) }))
  const pads = d.parts.flatMap((p) => worldPads(p)).filter((p) => p.layers.includes(t.layer))
  const extra: Track[] = []
  const tracks = d.tracks.map((o) => {
    if (o.id === id) return { ...o, x1: moved[0].x, y1: moved[0].y, x2: moved[1].x, y2: moved[1].y }
    if (o.layer !== t.layer || o.net !== t.net) return o
    const p = { ...o }
    ends.forEach((e, i) => {
      if (same({ x: o.x1, y: o.y1 }, e)) { p.x1 = moved[i].x; p.y1 = moved[i].y }
      if (same({ x: o.x2, y: o.y2 }, e)) { p.x2 = moved[i].x; p.y2 = moved[i].y }
    })
    return p
  })
  const vias = d.vias.map((v) => {
    for (let i = 0; i < 2; i++) if (same(v, ends[i])) return { ...v, x: moved[i].x, y: moved[i].y }
    return v
  })
  // vias that moved drag the track ends on the other layer
  const movedVias = d.vias.filter((v, i) => vias[i] !== v)
  const tracks2 = tracks.map((o) => {
    if (o.id === id || o.layer === t.layer) return o
    let p = o
    for (const v of movedVias) {
      const nv = vias[d.vias.indexOf(v)]
      if (same({ x: o.x1, y: o.y1 }, v)) p = { ...p, x1: nv.x, y1: nv.y }
      if (same({ x: o.x2, y: o.y2 }, v)) p = { ...p, x2: nv.x, y2: nv.y }
    }
    return p
  })
  ends.forEach((e, i) => {
    if (pads.some((p) => Math.hypot(p.x - e.x, p.y - e.y) < 0.05)) extra.push({ id: uid('t'), net: t.net, layer: t.layer, w: t.w, x1: e.x, y1: e.y, x2: moved[i].x, y2: moved[i].y })
  })
  return { ...d, tracks: [...tracks2, ...extra.filter((e) => Math.hypot(e.x2 - e.x1, e.y2 - e.y1) > TOL)], vias }
}

/** Move a via; the track ends on it come along. */
export function moveVia(d: Design, id: string, x: number, y: number): Design {
  const v = d.vias.find((q) => q.id === id)
  if (!v) return d
  const nx = r4(x)
  const ny = r4(y)
  return {
    ...d,
    vias: d.vias.map((q) => (q.id === id ? { ...q, x: nx, y: ny } : q)),
    tracks: d.tracks.map((o) => {
      let p = o
      if (same({ x: o.x1, y: o.y1 }, v)) p = { ...p, x1: nx, y1: ny }
      if (same({ x: o.x2, y: o.y2 }, v)) p = { ...p, x2: nx, y2: ny }
      return p
    }),
  }
}

/** Remove every track and via of a net (the pads keep their net). */
export function deleteNetCopper(d: Design, net: string): Design {
  return { ...d, tracks: d.tracks.filter((t) => t.net !== net), vias: d.vias.filter((v) => v.net !== net) }
}

/** The track segments joined end to end with this one on the same layer (and vias between layers). */
export function connectedTrack(d: Design, id: string): string[] {
  const start = d.tracks.find((t) => t.id === id)
  if (!start) return []
  const seen = new Set<string>([id])
  const queue = [start]
  while (queue.length) {
    const t = queue.pop()!
    for (const o of d.tracks) {
      if (seen.has(o.id) || o.layer !== t.layer || o.net !== t.net) continue
      const touch = [[t.x1, t.y1], [t.x2, t.y2]].some(([x, y]) => same({ x, y }, { x: o.x1, y: o.y1 }) || same({ x, y }, { x: o.x2, y: o.y2 }))
      if (touch) {
        seen.add(o.id)
        queue.push(o)
      }
    }
  }
  return [...seen]
}

/** Give tracks, vias and zones without a net the net of the pads they connect to. */
export function adoptNets(d: Design): Design {
  const an = analyze(d)
  const compNet = new Map<number, Set<string>>()
  for (const n of an.nodes) {
    if (n.kind === 'pad' && n.net) {
      const c = an.comp[n.id]
      const s = compNet.get(c) ?? new Set<string>()
      s.add(n.net)
      compNet.set(c, s)
    }
  }
  const trackNet = new Map<string, string>()
  const viaNet = new Map<string, string>()
  for (const n of an.nodes) {
    const s = compNet.get(an.comp[n.id])
    if (!s || s.size !== 1) continue
    const net = [...s][0]
    if (n.kind === 'track' && !d.tracks[n.index].net) trackNet.set(d.tracks[n.index].id, net)
    if (n.kind === 'via' && !d.vias[n.index].net) viaNet.set(d.vias[n.index].id, net)
  }
  if (!trackNet.size && !viaNet.size) return d
  return {
    ...d,
    tracks: d.tracks.map((t) => (trackNet.has(t.id) ? { ...t, net: trackNet.get(t.id)! } : t)),
    vias: d.vias.map((v) => (viaNet.has(v.id) ? { ...v, net: viaNet.get(v.id)! } : v)),
  }
}

// ------------------------------------------------------------ outline, holes, zones

export interface OutlinePreset {
  id: string
  name: string
  w: number
  h: number
  r: number
  holes: Array<[number, number, number]>
}

export const OUTLINE_PRESETS: readonly OutlinePreset[] = [
  { id: 'uno', name: 'Arduino Uno shield, 68.6 x 53.3 mm', w: 68.58, h: 53.34, r: 1, holes: [[13.97, 50.8, 3.2], [15.24, 2.54, 3.2], [66.04, 45.72, 3.2], [66.04, 17.78, 3.2]] },
  { id: 'nano', name: 'Arduino Nano, 43.2 x 17.8 mm', w: 43.18, h: 17.78, r: 1, holes: [] },
  { id: '50x50', name: 'Square, 50 x 50 mm', w: 50, h: 50, r: 0, holes: [] },
  { id: 'rpi-hat', name: 'Raspberry Pi HAT, 65 x 56 mm', w: 65, h: 56.5, r: 3, holes: [[3.5, 3.5, 2.75], [61.5, 3.5, 2.75], [3.5, 52.5, 2.75], [61.5, 52.5, 2.75]] },
]

export function setOutlineRect(d: Design, x: number, y: number, w: number, h: number, r = 0): Design {
  return { ...d, outline: rectOutline(r4(x), r4(y), r4(w), r4(h), r4(Math.max(0, Math.min(r, w / 2, h / 2)))) }
}

export function setOutlinePoly(d: Design, pts: readonly Pt[]): Design {
  return { ...d, outline: { pts: pts.map((p) => ({ x: r4(p.x), y: r4(p.y) })) } }
}

export function moveOutlineVertex(d: Design, i: number, p: Pt): Design {
  const pts = d.outline.pts.map((q, k) => (k === i ? { x: r4(p.x), y: r4(p.y) } : q))
  return { ...d, outline: { pts } }
}

export function applyOutlinePreset(d: Design, id: string): Design {
  const pr = OUTLINE_PRESETS.find((p) => p.id === id)
  if (!pr) throw new Error(`No outline preset "${id}".`)
  // a preset is a whole board template: its holes replace the old ones
  return { ...setOutlineRect(d, 0, 0, pr.w, pr.h, pr.r), holes: pr.holes.map(([x, y, dia]) => ({ id: uid('h'), x, y, d: dia })) }
}

export function addHole(d: Design, x: number, y: number, dia = 3.2): { design: Design; id: string } {
  const id = uid('h')
  return { design: { ...d, holes: [...d.holes, { id, x: r4(x), y: r4(y), d: dia }] }, id }
}

export function addZone(d: Design, pts: readonly Pt[], net: string, layer: CopperId, clearance?: number): { design: Design; id: string } {
  const id = uid('z')
  const z: Zone = { id, net, layer, clearance: clearance ?? d.rules.clearance, pts: pts.map((p) => ({ x: r4(p.x), y: r4(p.y) })) }
  return { design: { ...d, zones: [...d.zones, z] }, id }
}

/** A zone covering the board inside the outline (inset by a margin). */
export function boardZone(d: Design, net: string, layer: CopperId, inset = 0.5): Design {
  const b = d.outline.pts.length >= 3 ? polyBox(d.outline.pts) : { x0: 0, y0: 0, x1: 50, y1: 50 }
  const rr = d.outline.rect
  const pts = rr ? roundedRectPoly(rr.x + inset, rr.y + inset, rr.w - 2 * inset, rr.h - 2 * inset, Math.max(0, rr.r - inset), 6) : [
    { x: b.x0 + inset, y: b.y0 + inset }, { x: b.x1 - inset, y: b.y0 + inset }, { x: b.x1 - inset, y: b.y1 - inset }, { x: b.x0 + inset, y: b.y1 - inset },
  ]
  return addZone(d, pts, net, layer).design
}

// ------------------------------------------------------------ nets

export function createNet(d: Design, name: string): Design {
  const n = name.trim()
  if (!n) throw new Error('A net needs a name.')
  if (d.nets.some((x) => x.name === n)) throw new Error(`The net ${n} exists already.`)
  return { ...d, nets: [...d.nets, { name: n, cls: guessClass(n), pins: [] }] }
}

export function deleteNet(d: Design, name: string): Design {
  return { ...d, nets: d.nets.filter((n) => n.name !== name), tracks: d.tracks.map((t) => (t.net === name ? { ...t, net: '' } : t)), vias: d.vias.map((v) => (v.net === name ? { ...v, net: '' } : v)), zones: d.zones.map((z) => (z.net === name ? { ...z, net: '' } : z)) }
}

export function renameNet(d: Design, from: string, to: string): Design {
  const n = to.trim()
  if (!n) throw new Error('A net needs a name.')
  if (d.nets.some((x) => x.name === n)) throw new Error(`The net ${n} exists already.`)
  return {
    ...d,
    nets: d.nets.map((x) => (x.name === from ? { ...x, name: n } : x)),
    tracks: d.tracks.map((t) => (t.net === from ? { ...t, net: n } : t)),
    vias: d.vias.map((v) => (v.net === from ? { ...v, net: n } : v)),
    zones: d.zones.map((z) => (z.net === from ? { ...z, net: n } : z)),
  }
}

/** Put a pad on a net (or take it off all nets with an empty name). Keeps the net, even empty. */
export function assignPad(d: Design, net: string, ref: string, pin: string): Design {
  if (net && !d.nets.some((n) => n.name === net)) d = createNet(d, net)
  const out = addPinToNet(d, net, ref, pin)
  return net ? { ...out, nets: out.nets.some((n) => n.name === net) ? out.nets : [...out.nets, { name: net, cls: guessClass(net), pins: [] } as Net] } : out
}

export function setNetClass(d: Design, net: string, cls: string): Design {
  return { ...d, nets: d.nets.map((n) => (n.name === net ? { ...n, cls } : n)) }
}

// ------------------------------------------------------------ picking

export interface PickOptions {
  /** Radius of the pick in mm. */
  tol: number
  /** Copper layers that can be picked. */
  visible?: ReadonlySet<string>
  /** Prefer items on this layer. */
  active?: CopperId
  /** Only these kinds. */
  kinds?: ReadonlySet<ItemKind>
}

/** The item under a point: vias, then pads (their part), tracks, holes, zones and the outline. */
export function pickAt(d: Design, p: Pt, o: PickOptions): Item | null {
  const ok = (k: ItemKind) => !o.kinds || o.kinds.has(k)
  const vis = (l: string) => !o.visible || o.visible.has(l)
  const tol = o.tol
  if (ok('via')) {
    for (let i = d.vias.length - 1; i >= 0; i--) {
      const v = d.vias[i]
      if (Math.hypot(v.x - p.x, v.y - p.y) <= v.d / 2 + tol * 0.5) return { kind: 'via', id: v.id }
    }
  }
  if (ok('part')) {
    for (let i = d.parts.length - 1; i >= 0; i--) {
      const part = d.parts[i]
      for (const pad of worldPads(part)) {
        if (!pad.layers.some(vis) && pad.layers.length) continue
        if (Math.hypot(pad.x - p.x, pad.y - p.y) <= Math.max(pad.w, pad.h) / 2 + tol * 0.3) return { kind: 'part', id: part.id }
      }
    }
  }
  if (ok('track')) {
    let best: { id: string; score: number } | null = null
    for (const t of d.tracks) {
      if (!vis(t.layer)) continue
      const dist = distPointSeg(p.x, p.y, t.x1, t.y1, t.x2, t.y2)
      if (dist <= t.w / 2 + tol * 0.5) {
        const score = dist - (t.layer === o.active ? 1 : 0)
        if (!best || score < best.score) best = { id: t.id, score }
      }
    }
    if (best) return { kind: 'track', id: best.id }
  }
  if (ok('hole')) {
    for (const h of d.holes) if (Math.hypot(h.x - p.x, h.y - p.y) <= h.d / 2 + tol * 0.5) return { kind: 'hole', id: h.id }
  }
  if (ok('part')) {
    for (let i = d.parts.length - 1; i >= 0; i--) {
      const b = partBox(d.parts[i])
      if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return { kind: 'part', id: d.parts[i].id }
    }
  }
  if (ok('zone')) {
    for (let i = d.zones.length - 1; i >= 0; i--) {
      const z = d.zones[i]
      if (!vis(z.layer)) continue
      if (pointInPoly(p.x, p.y, z.pts)) return { kind: 'zone', id: z.id }
    }
  }
  if (ok('outline') && d.outline.pts.length >= 3) {
    const r = d.outline.pts
    for (let i = 0; i < r.length; i++) {
      const a = r[i]
      const b = r[(i + 1) % r.length]
      if (distPointSeg(p.x, p.y, a.x, a.y, b.x, b.y) <= tol) return { kind: 'outline', id: 'outline' }
    }
  }
  return null
}

/** Items inside (or touching) a rectangle. */
export function pickInBox(d: Design, b: Box, visible?: ReadonlySet<string>): Item[] {
  const out: Item[] = []
  const inside = (x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  const vis = (l: string) => !visible || visible.has(l)
  for (const part of d.parts) {
    const pb = partBox(part)
    if (pb.x0 >= b.x0 && pb.x1 <= b.x1 && pb.y0 >= b.y0 && pb.y1 <= b.y1) out.push({ kind: 'part', id: part.id })
    else if (inside(part.x, part.y)) out.push({ kind: 'part', id: part.id })
  }
  for (const t of d.tracks) if (vis(t.layer) && inside(t.x1, t.y1) && inside(t.x2, t.y2)) out.push({ kind: 'track', id: t.id })
  for (const v of d.vias) if (inside(v.x, v.y)) out.push({ kind: 'via', id: v.id })
  for (const h of d.holes) if (inside(h.x, h.y)) out.push({ kind: 'hole', id: h.id })
  for (const z of d.zones) if (vis(z.layer) && z.pts.every((q) => inside(q.x, q.y))) out.push({ kind: 'zone', id: z.id })
  return out
}

/** The parts and nets of a selection, for the properties panel. */
export function selectedParts(d: Design, sel: readonly Item[]): Part[] {
  const ids = new Set(sel.filter((i) => i.kind === 'part').map((i) => i.id))
  return d.parts.filter((p) => ids.has(p.id))
}

export const padNetName = (d: Design, ref: string, pin: string) => netOfPad(d, ref, pin)

/** Snap a point to the grid. */
export const snapPt = (p: Pt, grid: number): Pt => ({ x: snap(p.x, grid), y: snap(p.y, grid) })
