// Editing operations on a schematic (pure): hit testing, moving with rubber-banded wires, rotating,
// mirroring, wire splitting at pins, junction dots, copy / paste, undo history, part search.

import { GRID, PART_LIST, defOf, newId, newPart, nextRef, onSegment, partBounds, pinPositions, snap, type Doc, type NetLabel, type Note, type Part, type PartDef, type Rot, type Wire } from './model.ts'

export type Ids = ReadonlySet<string>

export const cloneDoc = (d: Doc): Doc => ({
  parts: d.parts.map((p) => ({ ...p, props: { ...p.props } })),
  wires: d.wires.map((w) => ({ ...w })),
  labels: d.labels.map((l) => ({ ...l })),
  notes: d.notes.map((n) => ({ ...n })),
})

// ------------------------------------------------------------------------------ hit testing

export function hitPin(doc: Doc, x: number, y: number, tol = 6): { part: Part; pin: string; x: number; y: number } | null {
  let best: { part: Part; pin: string; x: number; y: number } | null = null
  let bd = tol * tol
  for (const part of doc.parts) {
    for (const pp of pinPositions(part)) {
      const d = (pp.x - x) ** 2 + (pp.y - y) ** 2
      if (d <= bd) { bd = d; best = { part, pin: pp.name, x: pp.x, y: pp.y } }
    }
  }
  return best
}

export function hitPart(doc: Doc, x: number, y: number, pad = 2): Part | null {
  let best: Part | null = null
  let ba = Infinity
  for (const part of doc.parts) {
    const b = partBounds(part)
    if (x >= b.x1 - pad && x <= b.x2 + pad && y >= b.y1 - pad && y <= b.y2 + pad) {
      const area = (b.x2 - b.x1) * (b.y2 - b.y1)
      if (area <= ba) { ba = area; best = part }
    }
  }
  return best
}

export function distToSegment(px: number, py: number, w: Wire): number {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / l2))
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))
}

export function hitWire(doc: Doc, x: number, y: number, tol = 4): Wire | null {
  let best: Wire | null = null
  let bd = tol
  for (const w of doc.wires) {
    const d = distToSegment(x, y, w)
    if (d <= bd) { bd = d; best = w }
  }
  return best
}

export function hitLabel(doc: Doc, x: number, y: number): NetLabel | null {
  for (const l of doc.labels) {
    const w = 10 + l.name.length * 6.5
    const x1 = l.flip ? l.x - w : l.x - 4
    const x2 = l.flip ? l.x + 4 : l.x + w
    if (x >= x1 && x <= x2 && y >= l.y - 9 && y <= l.y + 9) return l
  }
  return null
}

export function hitNote(doc: Doc, x: number, y: number): Note | null {
  for (const n of doc.notes) {
    const lines = n.text.split('\n')
    const w = Math.max(...lines.map((s) => s.length)) * 6.6 + 8
    if (x >= n.x - 2 && x <= n.x + w && y >= n.y - 12 && y <= n.y + lines.length * 15 - 2) return n
  }
  return null
}

/** Everything (touching) inside a rectangle. */
export function itemsInBox(doc: Doc, x1: number, y1: number, x2: number, y2: number, contained = false): Set<string> {
  const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2)
  const out = new Set<string>()
  const inside = (x: number, y: number) => x >= lx && x <= hx && y >= ly && y <= hy
  for (const p of doc.parts) {
    const b = partBounds(p)
    const hit = contained ? b.x1 >= lx && b.x2 <= hx && b.y1 >= ly && b.y2 <= hy : !(b.x2 < lx || b.x1 > hx || b.y2 < ly || b.y1 > hy)
    if (hit) out.add(p.id)
  }
  for (const w of doc.wires) {
    const hit = contained ? inside(w.x1, w.y1) && inside(w.x2, w.y2) : inside(w.x1, w.y1) || inside(w.x2, w.y2) || segmentCrossesBox(w, lx, ly, hx, hy)
    if (hit) out.add(w.id)
  }
  for (const l of doc.labels) if (inside(l.x, l.y)) out.add(l.id)
  for (const n of doc.notes) if (inside(n.x, n.y)) out.add(n.id)
  return out
}

function segmentCrossesBox(w: Wire, lx: number, ly: number, hx: number, hy: number): boolean {
  // axis-aligned wires only need an interval test
  if (w.y1 === w.y2) return w.y1 >= ly && w.y1 <= hy && Math.max(w.x1, w.x2) >= lx && Math.min(w.x1, w.x2) <= hx
  if (w.x1 === w.x2) return w.x1 >= lx && w.x1 <= hx && Math.max(w.y1, w.y2) >= ly && Math.min(w.y1, w.y2) <= hy
  return false
}

// ------------------------------------------------------------------------------ wires

const key = (x: number, y: number) => `${x},${y}`

/** Splits wires at pins and at other wires' ends, drops zero-length and duplicate wires. */
export function splitWires(doc: Doc): Doc {
  const specials = new Map<string, { x: number; y: number }>()
  for (const p of doc.parts) for (const pp of pinPositions(p)) specials.set(key(pp.x, pp.y), { x: pp.x, y: pp.y })
  for (const w of doc.wires) {
    specials.set(key(w.x1, w.y1), { x: w.x1, y: w.y1 })
    specials.set(key(w.x2, w.y2), { x: w.x2, y: w.y2 })
  }
  for (const l of doc.labels) specials.set(key(l.x, l.y), { x: l.x, y: l.y })
  const pts = [...specials.values()]
  const out: Wire[] = []
  const seen = new Set<string>()
  for (const w of doc.wires) {
    if (w.x1 === w.x2 && w.y1 === w.y2) continue
    const inner = pts.filter((s) => !(s.x === w.x1 && s.y === w.y1) && !(s.x === w.x2 && s.y === w.y2) && onSegment(s.x, s.y, w.x1, w.y1, w.x2, w.y2))
    const along = (s: { x: number; y: number }) => (s.x - w.x1) * (w.x2 - w.x1) + (s.y - w.y1) * (w.y2 - w.y1)
    inner.sort((a, b) => along(a) - along(b))
    const chain = [{ x: w.x1, y: w.y1 }, ...inner, { x: w.x2, y: w.y2 }]
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const b = chain[i + 1]
      const k1 = key(a.x, a.y)
      const k2 = key(b.x, b.y)
      const kk = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
      if (seen.has(kk)) continue
      seen.add(kk)
      out.push(i === 0 && inner.length === 0 ? w : { id: i === 0 ? w.id : newId('w'), x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  }
  return { ...doc, wires: out }
}

/** An orthogonal route between two points: horizontal first (or vertical first). */
export function route(ax: number, ay: number, bx: number, by: number, horizontalFirst: boolean): [number, number][] {
  if (ax === bx || ay === by) return [[ax, ay], [bx, by]]
  return horizontalFirst ? [[ax, ay], [bx, ay], [bx, by]] : [[ax, ay], [ax, by], [bx, by]]
}

export function addPath(doc: Doc, pts: [number, number][]): Doc {
  const wires = [...doc.wires]
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    if (x1 === x2 && y1 === y2) continue
    wires.push({ id: newId('w'), x1, y1, x2, y2 })
  }
  return splitWires({ ...doc, wires })
}

/** Points where wires and pins meet three or more ways (drawn as junction dots). */
export function junctions(doc: Doc): { x: number; y: number }[] {
  const deg = new Map<string, number>()
  const at = new Map<string, { x: number; y: number }>()
  const bump = (x: number, y: number, n: number) => { const k = key(x, y); deg.set(k, (deg.get(k) ?? 0) + n); at.set(k, { x, y }) }
  for (const w of doc.wires) { bump(w.x1, w.y1, 1); bump(w.x2, w.y2, 1) }
  for (const p of doc.parts) for (const pp of pinPositions(p)) bump(pp.x, pp.y, 1)
  for (const l of doc.labels) bump(l.x, l.y, 1)
  // a wire passing straight through a point counts two
  const keys = [...at.entries()]
  for (const w of doc.wires) {
    for (const [k, pt] of keys) {
      if ((pt.x === w.x1 && pt.y === w.y1) || (pt.x === w.x2 && pt.y === w.y2)) continue
      if (onSegment(pt.x, pt.y, w.x1, w.y1, w.x2, w.y2)) deg.set(k, (deg.get(k) ?? 0) + 2)
    }
  }
  const out: { x: number; y: number }[] = []
  for (const [k, d] of deg) if (d >= 3) out.push(at.get(k)!)
  return out
}

// ------------------------------------------------------------------------------ transforming

type PointFn = (x: number, y: number) => { x: number; y: number }

/**
 * Applies a geometric change to the selected items; wires that touch them but are not selected
 * stretch (rubber-banding) and stay orthogonal.
 */
export function transformItems(doc: Doc, ids: Ids, mapPoint: PointFn, mapPart: (p: Part) => Part): Doc {
  const moved = new Map<string, { x: number; y: number }>() // old point → new point
  const next: Doc = cloneDoc(doc)
  next.parts = doc.parts.map((p) => {
    if (!ids.has(p.id)) return { ...p, props: { ...p.props } }
    const np = mapPart(p)
    const olds = pinPositions(p)
    const news = pinPositions(np)
    olds.forEach((o, i) => moved.set(key(o.x, o.y), { x: news[i].x, y: news[i].y }))
    return np
  })
  next.labels = doc.labels.map((l) => {
    if (!ids.has(l.id)) return { ...l }
    const n = mapPoint(l.x, l.y)
    moved.set(key(l.x, l.y), n)
    return { ...l, x: n.x, y: n.y }
  })
  next.notes = doc.notes.map((n) => (ids.has(n.id) ? { ...n, ...mapPoint(n.x, n.y) } : { ...n }))
  const wires: Wire[] = []
  for (const w of doc.wires) if (ids.has(w.id)) {
    moved.set(key(w.x1, w.y1), mapPoint(w.x1, w.y1))
    moved.set(key(w.x2, w.y2), mapPoint(w.x2, w.y2))
  }
  for (const w of doc.wires) {
    if (ids.has(w.id)) {
      const a = mapPoint(w.x1, w.y1)
      const b = mapPoint(w.x2, w.y2)
      wires.push({ ...w, x1: a.x, y1: a.y, x2: b.x, y2: b.y })
      continue
    }
    const na = moved.get(key(w.x1, w.y1))
    const nb = moved.get(key(w.x2, w.y2))
    if (!na && !nb) { wires.push({ ...w }); continue }
    if (na && nb) { wires.push({ ...w, x1: na.x, y1: na.y, x2: nb.x, y2: nb.y }); continue }
    // one end follows, the other stays
    const horizontal = w.y1 === w.y2
    const vertical = w.x1 === w.x2
    const [fx, fy] = na ? [w.x2, w.y2] : [w.x1, w.y1]
    const e = (na ?? nb)!
    if (e.x === fx || e.y === fy || (!horizontal && !vertical)) {
      wires.push(na ? { ...w, x1: e.x, y1: e.y } : { ...w, x2: e.x, y2: e.y })
    } else {
      // keep it orthogonal with an elbow
      const mid: [number, number] = horizontal ? [e.x, fy] : [fx, e.y]
      const pts: [number, number][] = na ? [[e.x, e.y], mid, [fx, fy]] : [[fx, fy], mid, [e.x, e.y]]
      wires.push({ ...w, x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] })
      wires.push({ id: newId('w'), x1: pts[1][0], y1: pts[1][1], x2: pts[2][0], y2: pts[2][1] })
    }
  }
  next.wires = wires
  return splitWires(next)
}

export function moveItems(doc: Doc, ids: Ids, dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc
  return transformItems(doc, ids, (x, y) => ({ x: x + dx, y: y + dy }), (p) => ({ ...p, props: { ...p.props }, x: p.x + dx, y: p.y + dy }))
}

/** The point the selection turns about: the part's own origin, or the snapped centre of the selection. */
export function pivotOf(doc: Doc, ids: Ids): { x: number; y: number } {
  const ps = doc.parts.filter((p) => ids.has(p.id))
  if (ps.length === 1 && doc.wires.every((w) => !ids.has(w.id))) return { x: ps[0].x, y: ps[0].y }
  const xs: number[] = []
  const ys: number[] = []
  for (const p of ps) { const b = partBounds(p); xs.push(b.x1, b.x2); ys.push(b.y1, b.y2) }
  for (const w of doc.wires) if (ids.has(w.id)) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2) }
  for (const l of doc.labels) if (ids.has(l.id)) { xs.push(l.x); ys.push(l.y) }
  for (const n of doc.notes) if (ids.has(n.id)) { xs.push(n.x); ys.push(n.y) }
  if (xs.length === 0) return { x: 0, y: 0 }
  return { x: snap((Math.min(...xs) + Math.max(...xs)) / 2), y: snap((Math.min(...ys) + Math.max(...ys)) / 2) }
}

export function rotateItems(doc: Doc, ids: Ids, clockwise = true): Doc {
  const c = pivotOf(doc, ids)
  const f: PointFn = (x, y) => {
    const dx = x - c.x
    const dy = y - c.y
    return clockwise ? { x: c.x - dy, y: c.y + dx } : { x: c.x + dy, y: c.y - dx }
  }
  return transformItems(doc, ids, f, (p) => {
    const q = f(p.x, p.y)
    return { ...p, props: { ...p.props }, x: q.x, y: q.y, rot: ((p.rot + (clockwise ? 90 : 270)) % 360) as Rot }
  })
}

export function mirrorItems(doc: Doc, ids: Ids): Doc {
  const c = pivotOf(doc, ids)
  const f: PointFn = (x, y) => ({ x: 2 * c.x - x, y })
  const out = transformItems(doc, ids, f, (p) => ({ ...p, props: { ...p.props }, x: 2 * c.x - p.x, rot: ((360 - p.rot) % 360) as Rot, mirror: !p.mirror }))
  return { ...out, labels: out.labels.map((l) => (ids.has(l.id) ? { ...l, flip: !l.flip } : l)) }
}

export function deleteItems(doc: Doc, ids: Ids): Doc {
  return {
    parts: doc.parts.filter((p) => !ids.has(p.id)),
    wires: doc.wires.filter((w) => !ids.has(w.id)),
    labels: doc.labels.filter((l) => !ids.has(l.id)),
    notes: doc.notes.filter((n) => !ids.has(n.id)),
  }
}

// ------------------------------------------------------------------------------ clipboard

export interface Clip { parts: Part[]; wires: Wire[]; labels: NetLabel[]; notes: Note[] }

export function copyItems(doc: Doc, ids: Ids): Clip {
  const c = cloneDoc(doc)
  return {
    parts: c.parts.filter((p) => ids.has(p.id)), wires: c.wires.filter((w) => ids.has(w.id)),
    labels: c.labels.filter((l) => ids.has(l.id)), notes: c.notes.filter((n) => ids.has(n.id)),
  }
}

export const clipIsEmpty = (c: Clip | null): boolean => !c || c.parts.length + c.wires.length + c.labels.length + c.notes.length === 0

/** Pastes a clip offset by (dx, dy); parts get fresh references. Returns the new document and the pasted ids. */
export function pasteClip(doc: Doc, clip: Clip, dx: number, dy: number): { doc: Doc; ids: Set<string> } {
  const next = cloneDoc(doc)
  const ids = new Set<string>()
  for (const p of clip.parts) {
    const id = newId('p')
    ids.add(id)
    const def = defOf(p)
    next.parts.push({ ...p, props: { ...p.props }, id, x: p.x + dx, y: p.y + dy, ref: p.kind === 'ground' ? '' : nextRef(next, def.prefix) })
  }
  for (const w of clip.wires) { const id = newId('w'); ids.add(id); next.wires.push({ id, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }) }
  for (const l of clip.labels) { const id = newId('l'); ids.add(id); next.labels.push({ id, name: l.name, x: l.x + dx, y: l.y + dy }) }
  for (const n of clip.notes) { const id = newId('n'); ids.add(id); next.notes.push({ id, text: n.text, x: n.x + dx, y: n.y + dy }) }
  return { doc: splitWires(next), ids }
}

// ------------------------------------------------------------------------------ history

export class History {
  private past: Doc[] = []
  private future: Doc[] = []
  private limit = 200
  /** Remember `before` as the state to return to. */
  push(before: Doc) {
    this.past.push(before)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }
  undo(current: Doc): Doc | null {
    const d = this.past.pop()
    if (!d) return null
    this.future.push(current)
    return d
  }
  redo(current: Doc): Doc | null {
    const d = this.future.pop()
    if (!d) return null
    this.past.push(current)
    return d
  }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  clear() { this.past = []; this.future = [] }
}

// ------------------------------------------------------------------------------ joining by name

/**
 * Joins a pin to a net by name: a short wire stub from the pin carrying a net label, or a ground
 * symbol for "0" / "GND". Edits `doc` in place. Returns the point where the stub ends.
 */
export function stubToNet(doc: Doc, part: Part, pinName: string, net: string): { x: number; y: number } | null {
  const pp = pinPositions(part).find((q) => q.name === pinName)
  if (!pp) return null
  const dx = pp.x - part.x
  const dy = pp.y - part.y
  const horiz = Math.abs(dx) > Math.abs(dy)
  const ex = horiz ? pp.x + Math.sign(dx || 1) * 2 * GRID : pp.x
  const ey = horiz ? pp.y : pp.y + Math.sign(dy || 1) * 2 * GRID
  doc.wires.push({ id: newId('w'), x1: pp.x, y1: pp.y, x2: ex, y2: ey })
  if (net === '0' || net.toLowerCase() === 'gnd') {
    const g = newPart(doc, 'ground', ex, ey)
    if (horiz) g.rot = dx > 0 ? 270 : 90
    else if (dy < 0) g.rot = 180
    doc.parts.push(g)
  } else doc.labels.push({ id: newId('l'), name: net, x: ex, y: ey, flip: horiz && dx < 0 })
  return { x: ex, y: ey }
}

/** The first free place for a new part at or after (x, y): scanning right, then down. */
export function freeSpot(doc: Doc, x: number, y: number, w = 140, h = 110): { x: number; y: number } {
  const taken = doc.parts.map((p) => partBounds(p))
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = snap(x + col * w)
      const cy = snap(y + row * h)
      const box = { x1: cx - 50, y1: cy - 40, x2: cx + 50, y2: cy + 40 }
      if (!taken.some((b) => !(b.x2 < box.x1 || b.x1 > box.x2 || b.y2 < box.y1 || b.y1 > box.y2))) return { x: cx, y: cy }
    }
  }
  return { x: snap(x), y: snap(y) }
}

// ------------------------------------------------------------------------------ search, bounds

export function searchParts(query: string): PartDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return PART_LIST
  const words = q.split(/\s+/)
  return PART_LIST.filter((d) => {
    const hay = `${d.name} ${d.kind} ${d.category} ${d.prefix} ${d.keywords.join(' ')}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export function docBounds(doc: Doc): { x1: number; y1: number; x2: number; y2: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const p of doc.parts) { const b = partBounds(p); xs.push(b.x1 - 20, b.x2 + 40); ys.push(b.y1 - 20, b.y2 + 10) }
  for (const w of doc.wires) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2) }
  for (const l of doc.labels) { xs.push(l.x, l.x + (l.flip ? -1 : 1) * (10 + l.name.length * 7)); ys.push(l.y - 10, l.y + 10) }
  for (const n of doc.notes) { xs.push(n.x, n.x + 120); ys.push(n.y - 12, n.y + 20) }
  if (xs.length === 0) return null
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

export { GRID }
