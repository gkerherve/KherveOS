// Geometry: affine matrices, path commands (M/L/C, as .kpaint stores them),
// Qt-faithful path builders (rectangles, ellipses, rounded rectangles and
// arcs come out with the same Bézier segments QPainterPath makes, so SVG and
// "explode" match the desktop), item transforms, bounds and hit tests.
//
// An item maps local to parent coordinates the way QGraphicsItem does:
//   p ↦ pos + M(o + R·s·(p − o))
// with o the centre of the item's Qt bounding rect, R its rotation (degrees,
// clockwise on screen), s its scale and M a group's resize matrix. Images
// carry their whole transform in `matrix`.

import type { Item, LineItem, DimensionItem, Mat, PathCmd, Pt, Rect, TextItem } from './model'
import { isNoPen } from './model'
import { layoutText } from './text'

// --------------------------------------------------------------- matrices

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** a ∘ b: apply b first, then a. */
export function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
export const applyXY = (m: Mat, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
export const applyVec = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y })

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !isFinite(det)) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export const translateM = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
export const scaleM = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0]

/** Rotation by `deg` degrees, exact for quarter turns like QTransform::rotate. */
export function rotateM(deg: number): Mat {
  let s: number
  let c: number
  if (deg === 90 || deg === -270) [s, c] = [1, 0]
  else if (deg === 270 || deg === -90) [s, c] = [-1, 0]
  else if (deg === 180) [s, c] = [0, -1]
  else {
    const r = (deg * Math.PI) / 180
    s = Math.sin(r)
    c = Math.cos(r)
  }
  return [c, s, -s, c, 0, 0]
}

/** Average linear scale of a matrix (for tolerances and pen widths). */
export const matScale = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1


// ------------------------------------------------------------------ rects

export const rectOf = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

export function normRect(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  }
}

export const rectFromPts = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
})

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
export const expand = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d })

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function boundsOfPts(pts: Pt[]): Rect | null {
  if (!pts.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const rectCorners = (r: Rect): Pt[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
]

/** Axis-aligned bounds of a transformed rect (QTransform::mapRect). */
export const mapRect = (m: Mat, r: Rect): Rect => boundsOfPts(rectCorners(r).map((p) => apply(m, p)))!

export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
export const inRect = (r: Rect, p: Pt, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

// ---------------------------------------------------------------- Béziers

export function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3
}

/** Parameter values where a cubic coordinate has an extremum. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  const out: number[] = []
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const s = Math.sqrt(disc)
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a))
    }
  }
  return out.filter((t) => t > 0 && t < 1)
}

// ------------------------------------------------------------------ paths

/** Tight bounds of a path (curve extrema included), like QPainterPath::boundingRect. */
export function pathBounds(cmds: PathCmd[]): Rect | null {
  const pts: Pt[] = []
  let cur: Pt = { x: 0, y: 0 }
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') {
      cur = { x: c[1], y: c[2] }
      pts.push(cur)
    } else {
      const [, x1, y1, x2, y2, x, y] = c
      for (const t of cubicExtrema(cur.x, x1, x2, x)) pts.push({ x: cubicAt(cur.x, x1, x2, x, t), y: cubicAt(cur.y, y1, y2, y, t) })
      for (const t of cubicExtrema(cur.y, y1, y2, y)) pts.push({ x: cubicAt(cur.x, x1, x2, x, t), y: cubicAt(cur.y, y1, y2, y, t) })
      cur = { x, y }
      pts.push(cur)
    }
  }
  return boundsOfPts(pts)
}

/** Bounds of every point, control points included (QPainterPath::controlPointRect). */
export function controlRect(cmds: PathCmd[]): Rect | null {
  const pts: Pt[] = []
  for (const c of cmds) for (let i = 1; i < c.length; i += 2) pts.push({ x: c[i] as number, y: c[i + 1] as number })
  return boundsOfPts(pts)
}

export function mapCmds(m: Mat, cmds: PathCmd[]): PathCmd[] {
  return cmds.map((c) => {
    if (c[0] === 'C') {
      const a = applyXY(m, c[1], c[2])
      const b = applyXY(m, c[3], c[4])
      const e = applyXY(m, c[5], c[6])
      return ['C', a.x, a.y, b.x, b.y, e.x, e.y]
    }
    const p = applyXY(m, c[1], c[2])
    return [c[0], p.x, p.y]
  }) as PathCmd[]
}

export interface Polyline {
  pts: Pt[]
}

/** The path as polylines, one per subpath (curves flattened). */
export function flatten(cmds: PathCmd[], segs = 0): Polyline[] {
  const out: Polyline[] = []
  let cur: Polyline | null = null
  let last: Pt = { x: 0, y: 0 }
  for (const c of cmds) {
    if (c[0] === 'M') {
      cur = { pts: [{ x: c[1], y: c[2] }] }
      out.push(cur)
      last = cur.pts[0]
    } else if (c[0] === 'L') {
      if (!cur) {
        cur = { pts: [last] }
        out.push(cur)
      }
      last = { x: c[1], y: c[2] }
      cur.pts.push(last)
    } else {
      if (!cur) {
        cur = { pts: [last] }
        out.push(cur)
      }
      const [, x1, y1, x2, y2, x, y] = c
      const len = Math.hypot(x1 - last.x, y1 - last.y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2)
      const n = segs || Math.max(4, Math.min(64, Math.ceil(len / 3)))
      const p0 = last
      for (let i = 1; i <= n; i++) {
        const t = i / n
        cur.pts.push({ x: cubicAt(p0.x, x1, x2, x, t), y: cubicAt(p0.y, y1, y2, y, t) })
      }
      last = { x, y }
    }
  }
  return out
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from p to the outline; `closed` adds each subpath's closing edge. */
export function distToPolylines(p: Pt, lines: Polyline[], closed = false): number {
  let best = Infinity
  for (const l of lines) {
    const pts = l.pts
    if (pts.length === 1) best = Math.min(best, Math.hypot(p.x - pts[0].x, p.y - pts[0].y))
    for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]))
    if (closed && pts.length > 2) best = Math.min(best, distToSegment(p, pts[pts.length - 1], pts[0]))
  }
  return best
}

/** Even-odd point-in-path over closed-up subpaths (Qt's default fill rule). */
export function insidePolylines(p: Pt, lines: Polyline[]): boolean {
  let inside = false
  for (const l of lines) {
    const pts = l.pts
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

// ------------------------------------------------- Qt-faithful path builder

const KAPPA = 0.5522847498

const fuzzyNull = (v: number) => Math.abs(v) <= 1e-12
const fuzzyEq = (a: number, b: number) => Math.abs(a - b) * 1e12 <= Math.min(Math.abs(a), Math.abs(b))

function tForArcAngle(angle: number): number {
  if (fuzzyNull(angle)) return 0
  if (fuzzyEq(angle, 90)) return 1
  const rad = (angle * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)
  const K = KAPPA
  let tc = angle / 90
  for (let i = 0; i < 2; i++) {
    tc -= ((((2 - 3 * K) * tc + 3 * (K - 1)) * tc) * tc + 1 - cosA) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc)
  }
  let ts = tc
  for (let i = 0; i < 2; i++) {
    ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinA) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K)
  }
  return 0.5 * (tc + ts)
}

type Bez = [Pt, Pt, Pt, Pt]

/** Split at t: returns [left, right]. */
function splitBez(b: Bez, t: number): [Bez, Bez] {
  const lerp = (a: Pt, c: Pt): Pt => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t })
  const p01 = lerp(b[0], b[1])
  const p12 = lerp(b[1], b[2])
  const p23 = lerp(b[2], b[3])
  const p012 = lerp(p01, p12)
  const p123 = lerp(p12, p23)
  const m = lerp(p012, p123)
  return [
    [b[0], p01, p012, m],
    [m, p123, p23, b[3]],
  ]
}

function bezSubRange(b: Bez, t0: number, t1: number): Bez {
  let r = fuzzyNull(t1 - 1) ? b : splitBez(b, t1)[0]
  if (!fuzzyNull(t0)) r = splitBez(r, t0 / t1)[1]
  return r
}

function bezOnInterval(b: Bez, t0: number, t1: number): Bez {
  if (t0 === 0 && t1 === 1) return b
  const right = splitBez(b, t0)[1]
  return splitBez(right, (t1 - t0) / (1 - t0))[0]
}

function ellipsePoint(r: Rect, angle: number): Pt {
  const w2 = r.w / 2
  const h2 = r.h / 2
  const theta = angle - 360 * Math.floor(angle / 360)
  let t = theta / 90
  const quadrant = Math.trunc(t)
  t -= quadrant
  t = tForArcAngle(90 * t)
  if (quadrant & 1) t = 1 - t
  const m = 1 - t
  const a = m * m * m
  const b = 3 * t * m * m
  const c = 3 * t * t * m
  const d = t * t * t
  let px = a + b + c * KAPPA
  let py = d + c + b * KAPPA
  if (quadrant === 1 || quadrant === 2) px = -px
  if (quadrant === 0 || quadrant === 1) py = -py
  return { x: r.x + w2 + w2 * px, y: r.y + h2 + h2 * py }
}

/** qt_curves_for_arc: the start point and the cubic control triples of an arc. */
function curvesForArc(r: Rect, startAngle: number, sweep: number): { start: Pt; curves: Pt[] } {
  const { x, y, w, h } = r
  const w2 = w / 2
  const w2k = w2 * KAPPA
  const h2 = h / 2
  const h2k = h2 * KAPPA
  const P = (px: number, py: number): Pt => ({ x: px, y: py })
  const points = [
    P(x + w, y + h2),
    P(x + w, y + h2 + h2k),
    P(x + w2 + w2k, y + h),
    P(x + w2, y + h),
    P(x + w2 - w2k, y + h),
    P(x, y + h2 + h2k),
    P(x, y + h2),
    P(x, y + h2 - h2k),
    P(x + w2 - w2k, y),
    P(x + w2, y),
    P(x + w2 + w2k, y),
    P(x + w, y + h2 - h2k),
    P(x + w, y + h2),
  ]
  sweep = Math.max(-360, Math.min(360, sweep))
  const curves: Pt[] = []
  if (startAngle === 0) {
    if (sweep === 360) {
      for (let i = 11; i >= 0; i--) curves.push(points[i])
      return { start: points[12], curves }
    }
    if (sweep === -360) {
      for (let i = 1; i <= 12; i++) curves.push(points[i])
      return { start: points[0], curves }
    }
  }
  let startSegment = Math.floor(startAngle / 90)
  let endSegment = Math.floor((startAngle + sweep) / 90)
  let startT = (startAngle - startSegment * 90) / 90
  let endT = (startAngle + sweep - endSegment * 90) / 90
  const delta = sweep > 0 ? 1 : -1
  if (delta < 0) {
    startT = 1 - startT
    endT = 1 - endT
  }
  if (fuzzyNull(startT - 1)) {
    startT = 0
    startSegment += delta
  }
  if (fuzzyNull(endT)) {
    endT = 1
    endSegment -= delta
  }
  startT = tForArcAngle(startT * 90)
  endT = tForArcAngle(endT * 90)
  const splitAtStart = !fuzzyNull(startT)
  const splitAtEnd = !fuzzyNull(endT - 1)
  const end = endSegment + delta
  if (startSegment === end) {
    const quadrant = 3 - (((startSegment % 4) + 4) % 4)
    const j = 3 * quadrant
    const p = delta > 0 ? points[j + 3] : points[j]
    return { start: p, curves }
  }
  const startPoint = ellipsePoint(r, startAngle)
  const endPoint = ellipsePoint(r, startAngle + sweep)
  for (let i = startSegment; i !== end; i += delta) {
    const quadrant = 3 - (((i % 4) + 4) % 4)
    const j = 3 * quadrant
    let b: Bez = delta > 0 ? [points[j + 3], points[j + 2], points[j + 1], points[j]] : [points[j], points[j + 1], points[j + 2], points[j + 3]]
    if (startSegment === endSegment && fuzzyEq(startT, endT)) return { start: startPoint, curves: [] }
    if (i === startSegment) {
      if (i === endSegment && splitAtEnd) b = bezOnInterval(b, startT, endT)
      else if (splitAtStart) b = bezSubRange(b, startT, 1)
    } else if (i === endSegment && splitAtEnd) b = bezSubRange(b, 0, endT)
    curves.push(b[1], b[2], b[3])
  }
  if (curves.length) curves[curves.length - 1] = endPoint
  return { start: startPoint, curves }
}

const samePt = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y

/** Builds M/L/C commands the way QPainterPath records elements. */
export class PathBuilder {
  cmds: PathCmd[] = []
  private start: Pt = { x: 0, y: 0 }
  private cur: Pt = { x: 0, y: 0 }
  private needMove = true

  private maybeMove() {
    if (this.needMove) {
      this.cmds.push(['M', this.cur.x, this.cur.y])
      this.start = this.cur
      this.needMove = false
    }
  }

  moveTo(x: number, y: number) {
    // Two moveTos in a row: the second replaces the first.
    const last = this.cmds[this.cmds.length - 1]
    if (last && last[0] === 'M' && !this.needMove) this.cmds.pop()
    this.cmds.push(['M', x, y])
    this.start = this.cur = { x, y }
    this.needMove = false
  }

  lineTo(x: number, y: number) {
    this.maybeMove()
    if (this.cur.x === x && this.cur.y === y) return
    this.cmds.push(['L', x, y])
    this.cur = { x, y }
  }

  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.maybeMove()
    const c = this.cur
    if (c.x === x1 && c.y === y1 && x1 === x2 && y1 === y2 && x2 === x && y2 === y) return
    this.cmds.push(['C', x1, y1, x2, y2, x, y])
    this.cur = { x, y }
  }

  quadTo(cx: number, cy: number, x: number, y: number) {
    this.maybeMove()
    const p = this.cur
    if (p.x === cx && p.y === cy && cx === x && cy === y) return
    this.cubicTo((p.x + 2 * cx) / 3, (p.y + 2 * cy) / 3, (x + 2 * cx) / 3, (y + 2 * cy) / 3, x, y)
  }

  closeSubpath() {
    if (this.cmds.length > 1 && !this.needMove) {
      const s = this.start
      if (!samePt(this.cur, s)) {
        if (fuzzyEq(s.x, this.cur.x) && fuzzyEq(s.y, this.cur.y)) {
          const i = this.cmds.length - 1
          const last = this.cmds[i]
          this.cmds[i] = last[0] === 'C' ? ['C', last[1], last[2], last[3], last[4], s.x, s.y] : [last[0], s.x, s.y]
        } else this.cmds.push(['L', s.x, s.y])
        this.cur = s
      }
    }
    this.needMove = true
  }

  arcMoveTo(r: Rect, angle: number) {
    if (!r.w || !r.h) return
    const p = ellipsePoint(r, angle)
    this.moveTo(p.x, p.y)
  }

  arcTo(r: Rect, startAngle: number, sweep: number) {
    if (!r.w || !r.h) return
    const { start, curves } = curvesForArc(r, startAngle, sweep)
    this.lineTo(start.x, start.y)
    for (let i = 0; i + 2 < curves.length; i += 3) {
      this.cubicTo(curves[i].x, curves[i].y, curves[i + 1].x, curves[i + 1].y, curves[i + 2].x, curves[i + 2].y)
    }
  }

  addRect(r: Rect) {
    this.moveTo(r.x, r.y)
    this.cmds.push(['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['L', r.x, r.y])
    this.cur = { x: r.x, y: r.y }
    this.needMove = true
  }

  addEllipse(r: Rect) {
    const { start, curves } = curvesForArc(r, 0, -360)
    this.moveTo(start.x, start.y)
    for (let i = 0; i + 2 < curves.length; i += 3) {
      this.cmds.push(['C', curves[i].x, curves[i].y, curves[i + 1].x, curves[i + 1].y, curves[i + 2].x, curves[i + 2].y])
    }
    this.cur = curves[curves.length - 1]
    this.needMove = true
  }

  addRoundedRect(rect: Rect, xr: number, yr: number) {
    const r = normRect(rect)
    if (!r.w && !r.h) return
    const w2 = r.w / 2
    const h2 = r.h / 2
    const xp = w2 === 0 ? 0 : (100 * Math.min(xr, w2)) / w2
    const yp = h2 === 0 ? 0 : (100 * Math.min(yr, h2)) / h2
    if (xp <= 0 || yp <= 0) {
      this.addRect(r)
      return
    }
    const { x, y, w, h } = r
    const rxx2 = (w * xp) / 100
    const ryy2 = (h * yp) / 100
    this.arcMoveTo(rectOf(x, y, rxx2, ryy2), 180)
    this.arcTo(rectOf(x, y, rxx2, ryy2), 180, -90)
    this.arcTo(rectOf(x + w - rxx2, y, rxx2, ryy2), 90, -90)
    this.arcTo(rectOf(x + w - rxx2, y + h - ryy2, rxx2, ryy2), 0, -90)
    this.arcTo(rectOf(x, y + h - ryy2, rxx2, ryy2), 270, -90)
    this.closeSubpath()
  }

  addPolygon(pts: [number, number][] | Pt[]) {
    if (!pts.length) return
    const P = pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p))
    this.moveTo(P[0].x, P[0].y)
    for (let i = 1; i < P.length; i++) this.cmds.push(['L', P[i].x, P[i].y])
    this.cur = P[P.length - 1]
  }
}

export function rectPath(r: Rect): PathCmd[] {
  const b = new PathBuilder()
  b.addRect(r)
  return b.cmds
}

export function ellipsePath(r: Rect): PathCmd[] {
  const b = new PathBuilder()
  b.addEllipse(r)
  return b.cmds
}

export function roundRectPath(r: Rect, radius: number): PathCmd[] {
  const b = new PathBuilder()
  const rr = Math.min(radius, r.w / 2, r.h / 2)
  b.addRoundedRect(r, rr, rr)
  return b.cmds
}

/** A closed polygon outline (addPolygon + closeSubpath). */
export function polygonPath(pts: [number, number][]): PathCmd[] {
  const b = new PathBuilder()
  b.addPolygon(pts)
  b.closeSubpath()
  return b.cmds
}

/** A half- or quarter-disc filling `rect` (canvas.arc_path). */
export function arcPath(kind: string, rect: Rect, flipH = false, flipV = false): PathCmd[] {
  const r = rect
  if (r.w <= 0 || r.h <= 0) return []
  const b = new PathBuilder()
  if (kind === 'halfcircle') {
    const ell = rectOf(r.x, r.y, r.w, r.h * 2)
    b.arcMoveTo(ell, 0)
    b.arcTo(ell, 0, 180)
    b.closeSubpath()
  } else {
    const ell = rectOf(r.x - r.w, r.y, r.w * 2, r.h * 2)
    b.moveTo(r.x, r.y + r.h)
    b.arcTo(ell, 0, 90)
    b.closeSubpath()
  }
  let cmds = b.cmds
  if (flipH || flipV) {
    const c = center(r)
    const m = mul(translateM(c.x, c.y), mul(scaleM(flipH ? -1 : 1, flipV ? -1 : 1), translateM(-c.x, -c.y)))
    cmds = mapCmds(m, cmds)
  }
  return cmds
}

// ------------------------------------------------------ parametric shapes

const POLY_FRACTIONS: Record<string, [number, number][]> = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  right_triangle: [[0, 0], [0, 1], [1, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  trapezoid: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  plus: [[0.34, 0], [0.66, 0], [0.66, 0.34], [1, 0.34], [1, 0.66], [0.66, 0.66], [0.66, 1], [0.34, 1], [0.34, 0.66], [0, 0.66], [0, 0.34], [0.34, 0.34]],
  chevron: [[0, 0], [0.6, 0], [1, 0.5], [0.6, 1], [0, 1], [0.4, 0.5]],
  arrow_right: [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]],
  lightning: [[0.6, 0], [0, 0.6], [0.35, 0.6], [0.15, 1], [1, 0.35], [0.55, 0.35], [0.75, 0]],
  house: [[0.5, 0], [1, 0.45], [1, 1], [0, 1], [0, 0.45]],
}

const POLY_SIDES: Record<string, number> = { pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 }

export const POLYGON_KINDS = [
  'triangle', 'right_triangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'heptagon', 'octagon',
  'star', 'star6', 'plus', 'chevron', 'arrow_right', 'lightning', 'house',
]

/** Vertices of a parametric polygon inscribed in `rect` (canvas.polygon_for_kind). */
export function polygonForKind(kind: string, rect: Rect): [number, number][] {
  const { x: left, y: top, w, h } = rect
  const cx = left + w / 2
  const cy = top + h / 2
  const rx = w / 2
  const ry = h / 2
  if (POLY_FRACTIONS[kind]) return POLY_FRACTIONS[kind].map(([fx, fy]) => [left + fx * w, top + fy * h])
  const out: [number, number][] = []
  if (kind === 'star' || kind === 'star6') {
    const points = kind === 'star' ? 5 : 6
    for (let i = 0; i < points * 2; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / points
      const s = i % 2 === 0 ? 1 : 0.4
      out.push([cx + rx * s * Math.cos(ang), cy + ry * s * Math.sin(ang)])
    }
    return out
  }
  const sides = POLY_SIDES[kind] ?? 6
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    out.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)])
  }
  return out
}

// ------------------------------------------------------------ item shapes

export const ARROW_HEAD = 14
export const DIM_HEAD = 10

export function linePath(it: LineItem | DimensionItem): PathCmd[] {
  const b = new PathBuilder()
  b.moveTo(it.x1, it.y1)
  if (it.type !== 'dimension' && it.bend) b.quadTo(it.bend[0], it.bend[1], it.x2, it.y2)
  else b.lineTo(it.x2, it.y2)
  return b.cmds
}

/** Direction (radians) the line arrives at p2: the curve's end tangent when bent. */
export function endAngle(it: LineItem): number {
  if (it.bend) {
    const vx = it.x2 - it.bend[0]
    const vy = it.y2 - it.bend[1]
    if (Math.abs(vx) > 1e-9 || Math.abs(vy) > 1e-9) return Math.atan2(vy, vx)
  }
  return Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
}

/** Direction pointing out of the line at p1 (for a head at the start). */
export function startAngle(it: LineItem): number {
  if (it.bend) {
    const vx = it.x1 - it.bend[0]
    const vy = it.y1 - it.bend[1]
    if (Math.abs(vx) > 1e-9 || Math.abs(vy) > 1e-9) return Math.atan2(vy, vx)
  }
  return Math.atan2(it.y1 - it.y2, it.x1 - it.x2)
}

/** The filled triangle of an arrowhead with its tip at (x, y). */
export function headPolygon(x: number, y: number, angle: number, size = ARROW_HEAD): Pt[] {
  return [
    { x, y },
    { x: x - Math.cos(angle - Math.PI / 7) * size, y: y - Math.sin(angle - Math.PI / 7) * size },
    { x: x - Math.cos(angle + Math.PI / 7) * size, y: y - Math.sin(angle + Math.PI / 7) * size },
  ]
}

export function arrowHeads(it: LineItem): Pt[][] {
  if (it.type !== 'arrow' || Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1) return []
  const heads = [headPolygon(it.x2, it.y2, endAngle(it))]
  if (it.head1) heads.push(headPolygon(it.x1, it.y1, startAngle(it)))
  return heads
}

/** The outline of a shape in local coordinates (null for text, images, groups). */
export function outlineOf(it: Item): PathCmd[] | null {
  switch (it.type) {
    case 'line':
    case 'arrow':
    case 'dimension':
      return linePath(it)
    case 'rect':
      return rectPath(rectOf(it.x, it.y, it.w, it.h))
    case 'ellipse':
      return ellipsePath(rectOf(it.x, it.y, it.w, it.h))
    case 'roundrect':
      return roundRectPath(rectOf(it.x, it.y, it.w, it.h), it.radius)
    case 'arc':
      return arcPath(it.kind, rectOf(it.x, it.y, it.w, it.h), it.flipH, it.flipV)
    case 'polygon':
      return polygonPath(it.points)
    case 'path':
      return it.cmds
    default:
      return null
  }
}

export const textFont = (it: TextItem) => ({ family: it.family, size: it.size, bold: it.bold, italic: it.italic })

// --------------------------------------------------- bounds and transforms

const qtRects = new WeakMap<Item, Rect>()
const matrices = new WeakMap<Item, Mat>()

const halfPen = (it: Item) => ('pen' in it ? Math.max(0, it.pen.width) / 2 : 0)

/** The item's boundingRect() as Qt computes it (pen margins included): its centre is the rotation origin. */
export function qtRect(it: Item): Rect {
  let r = qtRects.get(it)
  if (r) return r
  r = computeQtRect(it)
  qtRects.set(it, r)
  return r
}

function computeQtRect(it: Item): Rect {
  switch (it.type) {
    case 'line':
    case 'arrow':
    case 'dimension': {
      const base = pathBounds(linePath(it)) ?? rectOf(it.x1, it.y1, 0, 0)
      let d = it.pen.width / 2 + 1
      if (it.type === 'arrow') d += ARROW_HEAD + it.pen.width
      if (it.type === 'dimension') d += DIM_HEAD + it.pen.width + 60
      return expand(base, d)
    }
    case 'rect':
    case 'ellipse':
    case 'roundrect':
    case 'arc':
      return expand(normRect(rectOf(it.x, it.y, it.w, it.h)), halfPen(it))
    case 'polygon':
      return expand(boundsOfPts(it.points.map(([x, y]) => ({ x, y }))) ?? rectOf(0, 0, 0, 0), halfPen(it))
    case 'path': {
      const tight = pathBounds(it.cmds) ?? rectOf(0, 0, 0, 0)
      const hw = halfPen(it)
      if (!hw) return it.brush ? controlRect(it.cmds) ?? tight : tight
      const stroke = expand(tight, hw)
      return it.brush ? union(controlRect(it.cmds), stroke)! : stroke
    }
    case 'text': {
      const l = layoutText(it.text, textFont(it))
      return rectOf(0, 0, l.boxW, l.boxH)
    }
    case 'image':
      return rectOf(-0.5, -0.5, it.iw + 1, it.ih + 1)
    case 'group': {
      let u: Rect | null = null
      for (const c of it.children) u = union(u, mapRect(matrixOf(c), qtRect(c)))
      return u ?? rectOf(0, 0, 0, 0)
    }
  }
}

/** Rotation/scale origin: the centre of the Qt bounding rect. */
export const originOf = (it: Item): Pt => center(qtRect(it))

/** Local to parent transform. */
export function matrixOf(it: Item): Mat {
  let m = matrices.get(it)
  if (m) return m
  if (it.type === 'image') m = it.matrix
  else {
    m = translateM(it.pos.x, it.pos.y)
    if (it.type === 'group' && it.matrix) m = mul(m, it.matrix)
    if (it.rotation || it.scale !== 1) {
      const o = originOf(it)
      m = mul(m, translateM(o.x, o.y))
      m = mul(m, rotateM(it.rotation))
      m = mul(m, scaleM(it.scale))
      m = mul(m, translateM(-o.x, -o.y))
    }
  }
  matrices.set(it, m)
  return m
}

/** Local points whose hull covers the item's visible geometry (pen excluded). */
export function hullPoints(it: Item): Pt[] {
  switch (it.type) {
    case 'text': {
      const r = qtRect(it)
      return rectCorners(r)
    }
    case 'image':
      return rectCorners(rectOf(0, 0, it.iw, it.ih))
    case 'group':
      return []
    case 'line':
    case 'arrow': {
      const pts = flatten(linePath(it), 16).flatMap((l) => l.pts)
      for (const h of arrowHeads(it)) pts.push(...h)
      return pts
    }
    case 'dimension': {
      const pts = [{ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }]
      const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
      const perp = { x: Math.sin(a), y: -Math.cos(a) }
      const mid = { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 }
      const ext = it.extension ? 14 : DIM_HEAD * 0.45
      for (const p of [pts[0], pts[1]]) pts.push({ x: p.x + perp.x * ext, y: p.y + perp.y * ext }, { x: p.x - perp.x * ext, y: p.y - perp.y * ext })
      pts.push({ x: mid.x + perp.x * 22, y: mid.y + perp.y * 22 })
      return pts
    }
    default: {
      const cmds = outlineOf(it)
      return cmds ? flatten(cmds, 12).flatMap((l) => l.pts) : []
    }
  }
}

/** Tight bounds of the item in the coordinates `m` maps its parent to (pen included). */
export function boundsIn(it: Item, m: Mat = IDENTITY): Rect | null {
  const full = mul(m, matrixOf(it))
  if (it.type === 'group') {
    let u: Rect | null = null
    for (const c of it.children) u = union(u, boundsIn(c, full))
    return u
  }
  const r = boundsOfPts(hullPoints(it).map((p) => apply(full, p)))
  if (!r) return null
  const hw = 'pen' in it && !isNoPen(it.pen) ? halfPen(it) * matScale(full) : 0
  return expand(r, hw)
}

/** The local rectangle a selection outline and the box handles follow. */
export function frameRect(it: Item): Rect {
  switch (it.type) {
    case 'rect':
    case 'ellipse':
    case 'roundrect':
    case 'arc':
      return normRect(rectOf(it.x, it.y, it.w, it.h))
    case 'image':
      return rectOf(0, 0, it.iw, it.ih)
    case 'text':
      return qtRect(it)
    case 'group': {
      let u: Rect | null = null
      for (const c of it.children) u = union(u, boundsIn(c))
      return u ?? rectOf(0, 0, 0, 0)
    }
    default:
      return boundsOfPts(hullPoints(it)) ?? rectOf(0, 0, 0, 0)
  }
}

// ----------------------------------------------------------- hit testing

/** Does the point `p` (in the item's parent coordinates) touch the item? `tol` in parent units. */
export function hitItem(it: Item, p: Pt, tol: number): boolean {
  const m = matrixOf(it)
  const inv = invert(m)
  if (!inv) return false
  const q = apply(inv, p)
  const t = tol / matScale(m)
  switch (it.type) {
    case 'group':
      for (let i = it.children.length - 1; i >= 0; i--) if (hitItem(it.children[i], q, t)) return true
      return false
    case 'text':
    case 'image':
      return inRect(it.type === 'text' ? qtRect(it) : rectOf(0, 0, it.iw, it.ih), q, t)
    case 'line':
    case 'arrow': {
      if (distToPolylines(q, flatten(linePath(it))) <= Math.max(halfPen(it), t)) return true
      return arrowHeads(it).some((h) => insidePolylines(q, [{ pts: h }]) || distToPolylines(q, [{ pts: h }], true) <= t)
    }
    case 'dimension': {
      if (distToPolylines(q, flatten(linePath(it))) <= Math.max(halfPen(it), t)) return true
      const r = boundsOfPts(hullPoints(it))
      return !!r && inRect(r, q, 0) && distToPolylines(q, flatten(linePath(it))) <= 24
    }
    default: {
      const cmds = outlineOf(it)
      if (!cmds) return false
      const lines = flatten(cmds)
      const closed = it.type !== 'path'
      const filled = !!it.brush || (it.type !== 'path' && !!it.label)
      if (filled && insidePolylines(q, lines)) return true
      const near = isNoPen(it.pen) ? 0 : halfPen(it)
      return distToPolylines(q, lines, closed) <= Math.max(near, t)
    }
  }
}

/** The topmost top-level item under `p`, or null. */
export function itemAt(items: Item[], p: Pt, tol: number): Item | null {
  for (let i = items.length - 1; i >= 0; i--) if (hitItem(items[i], p, tol)) return items[i]
  return null
}

/** The chain from the top-level item down to the deepest leaf under `p`. */
export function deepItemAt(items: Item[], p: Pt, tol: number): Item[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (!hitItem(it, p, tol)) continue
    if (it.type !== 'group') return [it]
    const inv = invert(matrixOf(it))
    if (!inv) return [it]
    const sub = deepItemAt(it.children, apply(inv, p), tol / matScale(matrixOf(it)))
    return sub ? [it, ...sub] : [it]
  }
  return null
}

/** The full local-to-scene matrix of the last item in a chain. */
export function chainMatrix(chain: Item[]): Mat {
  let m = IDENTITY
  for (const it of chain) m = mul(m, matrixOf(it))
  return m
}

// ------------------------------------------------------------- snapping

/** Grid spacing in pixels: the grid is set in millimetres at the document's dpi. */
export const gridPx = (mm: number, dpi: number) => Math.max(1e-6, (mm / 25.4) * dpi)

export function snapPt(p: Pt, g: number): Pt {
  // floor(x/g + 0.5): half-up, as the desktop does.
  return { x: Math.floor(p.x / g + 0.5) * g, y: Math.floor(p.y / g + 0.5) * g }
}
