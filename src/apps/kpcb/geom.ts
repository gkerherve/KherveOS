// kPCB geometry (pure TypeScript: no React, no "@/" imports, Node can test it).
// Millimetres, y down. Rotations are in degrees, positive = counter-clockwise on the screen (KiCad).
//
// Copper shapes are "a core plus a radius" (the Minkowski sum of a point, a segment or a convex
// polygon with a disc): a round pad is a point + r, an oval pad or a track a segment + r, a
// rectangle a 4-point polygon, a rounded rectangle a smaller polygon + the corner radius.
// The distance between two shapes is then the distance between the cores minus both radii.

export interface Pt {
  x: number
  y: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A point, a segment (2 points) or a convex polygon (3 or more points), grown by `r`. */
export interface Shape {
  core: Pt[]
  r: number
}

export const pt = (x: number, y: number): Pt => ({ x, y })
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
export const D2R = Math.PI / 180

/** Round to 1e-6 mm (noise from rotations). */
export const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function rot(p: Pt, deg: number): Pt {
  const q = ((deg % 360) + 360) % 360
  if (q === 0) return { x: p.x, y: p.y }
  if (q === 90) return { x: p.y, y: -p.x }
  if (q === 180) return { x: -p.x, y: -p.y }
  if (q === 270) return { x: -p.y, y: p.x }
  const c = Math.cos(deg * D2R)
  const s = Math.sin(deg * D2R)
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c }
}

// ------------------------------------------------------------ segments

export function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The closest point of a segment to a point. */
export function closestOnSeg(px: number, py: number, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { x: a.x + t * dx, y: a.y + t * dy }
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

export function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y)
  const d2 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y)
  const d3 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)
  const d4 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const onSeg = (p: Pt, q: Pt, r: Pt) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  if (d1 === 0 && onSeg(c, d, a)) return true
  if (d2 === 0 && onSeg(c, d, b)) return true
  if (d3 === 0 && onSeg(a, b, c)) return true
  if (d4 === 0 && onSeg(a, b, d)) return true
  return false
}

/** Distance between two segments (0 when they cross or touch). */
export function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segsIntersect(a, b, c, d)) return 0
  return Math.min(
    distPointSeg(a.x, a.y, c.x, c.y, d.x, d.y),
    distPointSeg(b.x, b.y, c.x, c.y, d.x, d.y),
    distPointSeg(c.x, c.y, a.x, a.y, b.x, b.y),
    distPointSeg(d.x, d.y, a.x, a.y, b.x, b.y),
  )
}

// ------------------------------------------------------------ polygons

/** Even-odd test. */
export function pointInPoly(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Signed area (shoelace). With y down, a clockwise ring on the screen is positive. */
export function polyArea(poly: readonly Pt[]): number {
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  return s / 2
}

export function polyBox(poly: readonly Pt[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of poly) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

export function polyCentroid(poly: readonly Pt[]): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y
    a += f
    cx += (poly[j].x + poly[i].x) * f
    cy += (poly[j].y + poly[i].y) * f
  }
  if (Math.abs(a) < 1e-12) {
    const b = polyBox(poly)
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

/** Distance from a point to the edges of a closed polygon. */
export function distPointPoly(x: number, y: number, poly: readonly Pt[]): number {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distPointSeg(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y))
  return d
}

/** Drop vertices that lie on the line between their neighbours (and repeated points). */
export function simplifyRing(ring: readonly Pt[]): Pt[] {
  let pts = ring.filter((p, i) => i === 0 || p.x !== ring[i - 1].x || p.y !== ring[i - 1].y)
  if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts = pts.slice(0, -1)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    const out: Pt[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      if (Math.abs(cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y)) < 1e-12) changed = true
      else out.push(b)
    }
    pts = out
  }
  return pts
}

export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + ((a1 - a0) * i) / steps) * D2R
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

/** A rectangle with rounded corners as a polygon (clockwise on the screen). `seg` = segments per corner. */
export function roundedRectPoly(x: number, y: number, w: number, h: number, r: number, seg = 8): Pt[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr <= 1e-9) return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  return [
    ...arcPoints(x + w - rr, y + rr, rr, -90, 0, seg),
    ...arcPoints(x + w - rr, y + h - rr, rr, 0, 90, seg),
    ...arcPoints(x + rr, y + h - rr, rr, 90, 180, seg),
    ...arcPoints(x + rr, y + rr, rr, 180, 270, seg),
  ].map((p) => ({ x: r6(p.x), y: r6(p.y) }))
}

/** The corners of a w × h rectangle centred on (cx, cy), turned by `deg`. */
export function rectPoly(cx: number, cy: number, w: number, h: number, deg = 0): Pt[] {
  const hw = w / 2
  const hh = h / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const q = rot(p, deg)
    return { x: cx + q.x, y: cy + q.y }
  })
}

/** Do two convex polygons overlap by more than `tol`? (separating axis test). */
export function convexOverlap(a: readonly Pt[], b: readonly Pt[], tol = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      let nx = q.y - p.y
      let ny = p.x - q.x
      const l = Math.hypot(nx, ny)
      if (l < 1e-12) continue
      nx /= l
      ny /= l
      let aMin = Infinity
      let aMax = -Infinity
      let bMin = Infinity
      let bMax = -Infinity
      for (const v of a) {
        const d = v.x * nx + v.y * ny
        if (d < aMin) aMin = d
        if (d > aMax) aMax = d
      }
      for (const v of b) {
        const d = v.x * nx + v.y * ny
        if (d < bMin) bMin = d
        if (d > bMax) bMax = d
      }
      if (aMax <= bMin + tol || bMax <= aMin + tol) return false
    }
  }
  return true
}

// ------------------------------------------------------------ shapes

function segsOf(c: readonly Pt[]): Array<[Pt, Pt]> {
  if (c.length === 1) return [[c[0], c[0]]]
  if (c.length === 2) return [[c[0], c[1]]]
  const out: Array<[Pt, Pt]> = []
  for (let i = 0; i < c.length; i++) out.push([c[i], c[(i + 1) % c.length]])
  return out
}

/** Distance between two cores (0 when they overlap). */
export function coreDist(a: readonly Pt[], b: readonly Pt[]): number {
  if (a.length === 1 && b.length === 1) return Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y)
  if (a.length >= 3 && pointInPoly(b[0].x, b[0].y, a)) return 0
  if (b.length >= 3 && pointInPoly(a[0].x, a[0].y, b)) return 0
  if (a.length === 1) return b.length === 2 ? distPointSeg(a[0].x, a[0].y, b[0].x, b[0].y, b[1].x, b[1].y) : distPointPoly(a[0].x, a[0].y, b)
  if (b.length === 1) return a.length === 2 ? distPointSeg(b[0].x, b[0].y, a[0].x, a[0].y, a[1].x, a[1].y) : distPointPoly(b[0].x, b[0].y, a)
  let d = Infinity
  for (const [p, q] of segsOf(a)) for (const [s, t] of segsOf(b)) d = Math.min(d, segSegDist(p, q, s, t))
  return d
}

/** Gap between two shapes: negative when they overlap. */
export function shapeDist(a: Shape, b: Shape): number {
  return coreDist(a.core, b.core) - a.r - b.r
}

export function shapeBox(s: Shape, grow = 0): Box {
  const b = polyBox(s.core)
  const g = s.r + grow
  return { x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g }
}

export const boxesTouch = (a: Box, b: Box, grow = 0) => a.x0 <= b.x1 + grow && b.x0 <= a.x1 + grow && a.y0 <= b.y1 + grow && b.y0 <= a.y1 + grow

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b }
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

/** Distance from a point to a shape (negative inside). */
export function pointShapeDist(x: number, y: number, s: Shape): number {
  return coreDist([{ x, y }], s.core) - s.r
}

/** Distance from a shape to a closed polyline (the board edge): the gap to the nearest edge. */
export function shapeToRingDist(s: Shape, ring: readonly Pt[]): number {
  let d = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, coreDist(s.core, [ring[j], ring[i]]))
  return d - s.r
}

/** Parse "1.27", "0.5mm", "20mil" into millimetres (null when it is not a length). */
export function parseLength(text: string, defaultUnit: 'mm' | 'mil' = 'mm'): number | null {
  const m = /^\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(mm|mil|in|")?\s*$/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  const u = (m[2] ?? defaultUnit).toLowerCase()
  return u === 'mil' ? n * 0.0254 : u === 'in' || u === '"' ? n * 25.4 : n
}

export const MIL = 0.0254

/** A uniform-grid index of boxes: add items, then ask which boxes touch a box. */
export class BoxGrid {
  private cells = new Map<number, number[]>()
  private boxes: Box[] = []
  private cell: number
  constructor(cell = 2) {
    this.cell = cell
  }
  private key(cx: number, cy: number) {
    return cx * 73856093 + cy * 19349663
  }
  add(id: number, b: Box) {
    this.boxes[id] = b
    const c = this.cell
    for (let cx = Math.floor(b.x0 / c); cx <= Math.floor(b.x1 / c); cx++) {
      for (let cy = Math.floor(b.y0 / c); cy <= Math.floor(b.y1 / c); cy++) {
        const k = this.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(id)
        else this.cells.set(k, [id])
      }
    }
  }
  /** Ids whose box touches `b` (grown by `grow`), each once. */
  query(b: Box, grow = 0): number[] {
    const c = this.cell
    const out = new Set<number>()
    for (let cx = Math.floor((b.x0 - grow) / c); cx <= Math.floor((b.x1 + grow) / c); cx++) {
      for (let cy = Math.floor((b.y0 - grow) / c); cy <= Math.floor((b.y1 + grow) / c); cy++) {
        for (const id of this.cells.get(this.key(cx, cy)) ?? []) if (!out.has(id) && boxesTouch(this.boxes[id], b, grow)) out.add(id)
      }
    }
    return [...out]
  }
}

/** The middle of the gap between two cores: the point halfway between their closest points. */
export function gapMidpoint(a: readonly Pt[], b: readonly Pt[]): Pt {
  let best = Infinity
  let mid: Pt = { x: a[0].x, y: a[0].y }
  const consider = (p: Pt, q: Pt) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < best) {
      best = d
      mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    }
  }
  const edges = (c: readonly Pt[]): Array<[Pt, Pt]> => (c.length === 1 ? [[c[0], c[0]]] : c.length === 2 ? [[c[0], c[1]]] : c.map((p, i): [Pt, Pt] => [p, c[(i + 1) % c.length]]))
  for (const p of a) for (const [s, t] of edges(b)) consider(p, closestOnSeg(p.x, p.y, s, t))
  for (const p of b) for (const [s, t] of edges(a)) consider(closestOnSeg(p.x, p.y, s, t), p)
  return mid
}

/** Distance from a point to a core (a point, a segment or a convex polygon; 0 inside the polygon). */
export function distToCore(x: number, y: number, core: readonly Pt[]): number {
  if (core.length === 1) return Math.hypot(x - core[0].x, y - core[0].y)
  if (core.length === 2) return distPointSeg(x, y, core[0].x, core[0].y, core[1].x, core[1].y)
  return pointInPoly(x, y, core) ? 0 : distPointPoly(x, y, core)
}

/** A raster of square cells; cell (i, j) has its centre at (ox + (i + 0.5) res, oy + (j + 0.5) res). */
export interface CellGrid {
  W: number
  H: number
  ox: number
  oy: number
  res: number
}

/** Call `fn` for every cell whose centre is closer than `reach` to the core. */
export function cellsNear(g: CellGrid, core: readonly Pt[], reach: number, fn: (index: number, x: number, y: number) => void): void {
  if (core.length === 2) {
    const len = Math.hypot(core[1].x - core[0].x, core[1].y - core[0].y)
    if (len > 2) {
      const n = Math.ceil(len / 2)
      for (let k = 0; k < n; k++) {
        const a = { x: core[0].x + ((core[1].x - core[0].x) * k) / n, y: core[0].y + ((core[1].y - core[0].y) * k) / n }
        const b = { x: core[0].x + ((core[1].x - core[0].x) * (k + 1)) / n, y: core[0].y + ((core[1].y - core[0].y) * (k + 1)) / n }
        cellsNear(g, [a, b], reach, fn)
      }
      return
    }
  }
  const b = polyBox(core)
  const { W, H, ox, oy, res } = g
  const i0 = Math.max(0, Math.floor((b.x0 - reach - ox) / res))
  const i1 = Math.min(W - 1, Math.ceil((b.x1 + reach - ox) / res))
  const j0 = Math.max(0, Math.floor((b.y0 - reach - oy) / res))
  const j1 = Math.min(H - 1, Math.ceil((b.y1 + reach - oy) / res))
  for (let j = j0; j <= j1; j++) {
    const y = oy + (j + 0.5) * res
    for (let i = i0; i <= i1; i++) {
      const x = ox + (i + 0.5) * res
      if (distToCore(x, y, core) < reach) fn(j * W + i, x, y)
    }
  }
}
