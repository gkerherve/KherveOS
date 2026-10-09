// Meshing of a plate (a polygon outline with holes) for plane stress / plane strain.
//
//   1. the boundary is split into segments of the local element size (graded near holes and refine points)
//   2. interior points are placed on a hexagonal lattice, thinned to the size function
//   3. Delaunay triangulation (delaunator) of all points; the boundary segments are recovered by splitting the
//      ones that are missing (a conforming Delaunay triangulation); triangles outside the plate or inside a hole go
//   4. triangles with a small angle are improved by inserting circumcentres, then Delaunay edge flips and
//      Laplacian smoothing (the boundary nodes stay where they are)
//   5. optionally every triangle is split into three quadrilaterals (an all-quad mesh, for the Q4 element), or a
//      four-sided region is meshed with a regular grid.
//
// Nodes of the polygon (loop, vertex) are always nodes of the mesh, and every boundary segment remembers the polygon
// edge it comes from, so that supports and loads can be put on edges.

import Delaunator from 'delaunator'
import { plateLoops, pointInPlate, signedArea, type MeshSettings, type Plate, type Pt, type Target } from './model.ts'
import { SolveError } from './linalg.ts'

export interface BSeg {
  a: number
  b: number
  /** 0 = the outline, k = hole k − 1 */
  loop: number
  edge: number
}

export interface Mesh {
  type: 'tri' | 'quad'
  stride: 3 | 4
  nNodes: number
  nElems: number
  /** x0, y0, x1, y1… */
  xy: Float64Array
  /** counter-clockwise node numbers, `stride` per element */
  conn: Int32Array
  /** boundary segments (the material is on the left of a → b) */
  bsegs: BSeg[]
  /** "loop:vertex" → node */
  vertexNodes: Record<string, number>
}

export interface MeshStats {
  nodes: number
  elements: number
  dofs: number
  type: 'tri' | 'quad'
  /** degrees */
  minAngle: number
  maxAngle: number
  /** 4√3·A / Σl² for triangles (1 = equilateral), the same on the sub-triangles for quads */
  meanQuality: number
  minQuality: number
  minArea: number
  maxArea: number
  /** how many elements in each tenth of quality, worst first */
  histogram: number[]
  worstElement: number
}

export const MAX_ELEMENTS = 60000

// ---------------------------------------------------------------------------- geometry helpers

const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export const triArea = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => 0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay))

export function triQuality(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const a = triArea(ax, ay, bx, by, cx, cy)
  const s = (bx - ax) ** 2 + (by - ay) ** 2 + (cx - bx) ** 2 + (cy - by) ** 2 + (ax - cx) ** 2 + (ay - cy) ** 2
  return s > 0 ? (4 * Math.sqrt(3) * a) / s : 0
}

function angles(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number, number] {
  const ang = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
    const ux = qx - px, uy = qy - py, vx = rx - px, vy = ry - py
    return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1))))
  }
  return [ang(ax, ay, bx, by, cx, cy), ang(bx, by, cx, cy, ax, ay), ang(cx, cy, ax, ay, bx, by)]
}

function circumcentre(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Pt | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-300) return null
  const a2 = ax * ax + ay * ay
  const b2 = bx * bx + by * by
  const c2 = cx * cx + cy * cy
  return { x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d }
}

/** A hash of points for "is there a point nearer than r?" */
class PointHash {
  cell: number
  map = new Map<number, number[]>()
  constructor(cell: number) { this.cell = cell }
  private key(ix: number, iy: number) { return ix * 73856093 + iy * 19349663 }
  add(i: number, x: number, y: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))
    const l = this.map.get(k)
    if (l) l.push(i); else this.map.set(k, [i])
  }
  nearer(x: number, y: number, r: number, xy: ArrayLike<number>): boolean {
    const ix = Math.floor(x / this.cell)
    const iy = Math.floor(y / this.cell)
    const span = Math.ceil(r / this.cell)
    for (let a = -span; a <= span; a++) {
      for (let b = -span; b <= span; b++) {
        const l = this.map.get(this.key(ix + a, iy + b))
        if (!l) continue
        for (const i of l) if (Math.hypot(xy[2 * i] - x, xy[2 * i + 1] - y) < r) return true
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------- the size function

export function sizeFunction(plate: Plate, settings: MeshSettings = plate.mesh): (x: number, y: number) => number {
  const h0 = settings.size
  const grade = 0.45
  const holeSegs: number[] = []
  if (settings.holeFactor < 1) {
    for (const hole of plate.holes) for (let i = 0; i < hole.length; i++) { const a = hole[i]; const b = hole[(i + 1) % hole.length]; holeSegs.push(a.x, a.y, b.x, b.y) }
  }
  const hh = h0 * settings.holeFactor
  const refine = settings.refine
  const floor = h0 / 40
  return (x, y) => {
    let h = h0
    if (holeSegs.length) {
      let d = Infinity
      for (let i = 0; i < holeSegs.length; i += 4) d = Math.min(d, distSeg(x, y, holeSegs[i], holeSegs[i + 1], holeSegs[i + 2], holeSegs[i + 3]))
      h = Math.min(h, hh + grade * d)
    }
    for (const r of refine) h = Math.min(h, r.size + grade * Math.hypot(x - r.x, y - r.y))
    return Math.max(floor, h)
  }
}

// ---------------------------------------------------------------------------- the unstructured mesher

interface Work {
  xy: number[]
  segs: BSeg[]
}

function triangulate(w: Work, maxPasses = 40): { tris: Int32Array; n: number } {
  for (let pass = 0; pass < maxPasses; pass++) {
    const d = new Delaunator(Float64Array.from(w.xy))
    const t = d.triangles
    const n = w.xy.length / 2
    const edges = new Set<number>()
    for (let i = 0; i < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = t[i + k]
        const b = t[i + ((k + 1) % 3)]
        edges.add(a < b ? a * n + b : b * n + a)
      }
    }
    const next: BSeg[] = []
    let split = 0
    for (const s of w.segs) {
      const key = s.a < s.b ? s.a * n + s.b : s.b * n + s.a
      if (edges.has(key)) { next.push(s); continue }
      const mx = (w.xy[2 * s.a] + w.xy[2 * s.b]) / 2
      const my = (w.xy[2 * s.a + 1] + w.xy[2 * s.b + 1]) / 2
      const m = w.xy.length / 2
      w.xy.push(mx, my)
      next.push({ a: s.a, b: m, loop: s.loop, edge: s.edge }, { a: m, b: s.b, loop: s.loop, edge: s.edge })
      split++
    }
    w.segs = next
    if (!split) return { tris: Int32Array.from(t), n }
  }
  throw new SolveError('The mesh could not follow the outline (a very sharp corner or a feature much smaller than the element size). Use a smaller mesh size or a smoother outline.')
}

/** Keeps the triangles inside the plate, counter-clockwise. */
function inside(w: Work, tris: Int32Array, plate: Plate): number[] {
  const keep: number[] = []
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2]
    const ax = w.xy[2 * a], ay = w.xy[2 * a + 1], bx = w.xy[2 * b], by = w.xy[2 * b + 1], cx = w.xy[2 * c], cy = w.xy[2 * c + 1]
    const area = triArea(ax, ay, bx, by, cx, cy)
    if (Math.abs(area) < 1e-14 * ((ax - bx) ** 2 + (ay - by) ** 2 + 1e-300)) continue
    if (!pointInPlate({ x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 }, plate)) continue
    if (area > 0) keep.push(a, b, c); else keep.push(a, c, b)
  }
  return keep
}

function flipPass(xy: ArrayLike<number>, tris: number[], locked: Set<number>): number {
  // Delaunay flips on the edges that are not boundary segments
  const n = xy.length / 2
  const map = new Map<number, number[]>()
  const nt = tris.length / 3
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[3 * t + k]
      const b = tris[3 * t + ((k + 1) % 3)]
      const key = a < b ? a * n + b : b * n + a
      const l = map.get(key)
      if (l) l.push(t); else map.set(key, [t])
    }
  }
  const touched = new Uint8Array(nt)
  let flips = 0
  for (const [key, l] of map) {
    if (l.length !== 2 || locked.has(key)) continue
    const [t1, t2] = l
    if (touched[t1] || touched[t2]) continue
    const a = Math.floor(key / n)
    const b = key % n
    const opp = (t: number) => { for (let k = 0; k < 3; k++) { const v = tris[3 * t + k]; if (v !== a && v !== b) return v } return -1 }
    const c = opp(t1)
    const d = opp(t2)
    const px = (v: number) => xy[2 * v]
    const py = (v: number) => xy[2 * v + 1]
    // convex quad a c b d? the flip is valid when c and d are on opposite sides of ab and a, b on opposite sides of cd
    const s1 = triArea(px(a), py(a), px(b), py(b), px(c), py(c))
    const s2 = triArea(px(a), py(a), px(b), py(b), px(d), py(d))
    if (s1 * s2 >= 0) continue
    const u1 = triArea(px(c), py(c), px(d), py(d), px(a), py(a))
    const u2 = triArea(px(c), py(c), px(d), py(d), px(b), py(b))
    if (u1 * u2 >= 0) continue
    // in-circle: d inside the circle of (a, b, c)?  use the sum of the opposite angles
    const angC = angleAt(px(c), py(c), px(a), py(a), px(b), py(b))
    const angD = angleAt(px(d), py(d), px(a), py(a), px(b), py(b))
    if (angC + angD <= Math.PI + 1e-12) continue
    // new triangles (c, d, a) and (d, c, b), made counter-clockwise
    const t1n = triArea(px(c), py(c), px(d), py(d), px(a), py(a)) > 0 ? [c, d, a] : [d, c, a]
    const t2n = triArea(px(d), py(d), px(c), py(c), px(b), py(b)) > 0 ? [d, c, b] : [c, d, b]
    tris.splice(3 * t1, 3, ...t1n)
    tris.splice(3 * t2, 3, ...t2n)
    touched[t1] = 1
    touched[t2] = 1
    flips++
  }
  return flips
}

function angleAt(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  const ux = qx - px, uy = qy - py, vx = rx - px, vy = ry - py
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1))))
}

/** Laplacian smoothing that never makes a neighbouring triangle worse than the worst it had. */
function smooth(xy: Float64Array, tris: number[], fixed: Uint8Array, iterations: number): void {
  const n = xy.length / 2
  const nt = tris.length / 3
  const adjT: number[][] = Array.from({ length: n }, () => [])
  const adjN: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[3 * t + k]
      adjT[a].push(t)
      adjN[a].add(tris[3 * t + ((k + 1) % 3)])
      adjN[a].add(tris[3 * t + ((k + 2) % 3)])
    }
  }
  const q = (t: number): number => {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2]
    return triQuality(xy[2 * a], xy[2 * a + 1], xy[2 * b], xy[2 * b + 1], xy[2 * c], xy[2 * c + 1])
  }
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      if (fixed[v] || adjN[v].size === 0) continue
      let sx = 0, sy = 0
      for (const w of adjN[v]) { sx += xy[2 * w]; sy += xy[2 * w + 1] }
      const nx = sx / adjN[v].size
      const ny = sy / adjN[v].size
      const ox = xy[2 * v], oy = xy[2 * v + 1]
      let before = Infinity
      for (const t of adjT[v]) before = Math.min(before, q(t))
      xy[2 * v] = ox + 0.8 * (nx - ox)
      xy[2 * v + 1] = oy + 0.8 * (ny - oy)
      let after = Infinity
      for (const t of adjT[v]) after = Math.min(after, q(t))
      if (!(after > 0) || after < before - 1e-12) { xy[2 * v] = ox; xy[2 * v + 1] = oy }
    }
  }
}

export interface MeshOptions { maxElements?: number }

/** Meshes a plate with triangles (a regular grid when `structured` and the outline has four corners). */
export function meshPlate(plate: Plate, opts: MeshOptions = {}): Mesh {
  const st = plate.mesh
  if (plate.outline.length < 3) throw new SolveError('The plate has no outline yet.')
  if (!(st.size > 0)) throw new SolveError('The mesh size must be positive.')
  const maxEl = opts.maxElements ?? MAX_ELEMENTS
  let mesh: Mesh
  if (st.structured && plate.outline.length === 4 && plate.holes.length === 0) mesh = meshStructured(plate.outline, st.size, st.type, st.divisions)
  else {
    mesh = meshTriangles(plate, maxEl)
    if (st.type === 'quad') mesh = trisToQuads(mesh)
  }
  if (mesh.nElems > maxEl) throw new SolveError(`The mesh would have ${mesh.nElems} elements (the limit is ${maxEl}). Use a larger element size.`)
  return mesh
}

function meshTriangles(plate: Plate, maxEl: number): Mesh {
  const st = plate.mesh
  const loops = plateLoops(plate)
  const h = sizeFunction(plate)
  const w: Work = { xy: [], segs: [] }
  const vertexNodes: Record<string, number> = {}
  let area = 0
  for (const [k, lp] of loops.entries()) area += k === 0 ? Math.abs(signedArea(lp)) : -Math.abs(signedArea(lp))
  const hmin = Math.min(st.size, st.size * st.holeFactor, ...st.refine.map((r) => r.size), st.size)
  const estimate = (area / (hmin * hmin)) * 1.2
  if (estimate > maxEl * 1.5 && !st.refine.length) throw new SolveError(`The mesh would have about ${Math.round(estimate)} elements (the limit is ${maxEl}). Use a larger element size.`)
  // 1. the boundary
  for (const [li, lp] of loops.entries()) {
    const first = w.xy.length / 2
    for (let i = 0; i < lp.length; i++) { vertexNodes[`${li}:${i}`] = first + i; w.xy.push(lp[i].x, lp[i].y) }
    for (let i = 0; i < lp.length; i++) {
      const a = lp[i]
      const b = lp[(i + 1) % lp.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-14) continue
      const hm = (h(a.x, a.y) + 2 * h((a.x + b.x) / 2, (a.y + b.y) / 2) + h(b.x, b.y)) / 4
      const pieces: Array<[number, number]> = []
      const n0 = Math.max(1, Math.round(len / hm))
      for (let k = 0; k < n0; k++) pieces.push([k / n0, (k + 1) / n0])
      // bisect pieces that are still too long for the size there
      const out: Array<[number, number]> = []
      const stack = [...pieces].reverse()
      while (stack.length) {
        const [t0, t1] = stack.pop()!
        const tm = (t0 + t1) / 2
        const hl = h(a.x + (b.x - a.x) * tm, a.y + (b.y - a.y) * tm)
        if ((t1 - t0) * len > 1.5 * hl && (t1 - t0) * len > hmin * 0.3) { stack.push([tm, t1], [t0, tm]); continue }
        out.push([t0, t1])
      }
      let prev = first + i
      for (let k = 0; k < out.length; k++) {
        const t = out[k][1]
        let node: number
        if (k === out.length - 1) node = first + ((i + 1) % lp.length)
        else { node = w.xy.length / 2; w.xy.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) }
        w.segs.push({ a: prev, b: node, loop: li, edge: i })
        prev = node
      }
    }
  }
  const nBoundary = w.xy.length / 2
  // 2. interior points on a hexagonal lattice, thinned to the size function
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of loops[0]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  const hash = new PointHash(hmin)
  for (let i = 0; i < nBoundary; i++) hash.add(i, w.xy[2 * i], w.xy[2 * i + 1])
  const dy = (hmin * Math.sqrt(3)) / 2
  const nRows = Math.ceil((y1 - y0) / dy)
  if (nRows * ((x1 - x0) / hmin) > maxEl * 6) throw new SolveError(`The mesh would be far too fine (limit ${maxEl} elements). Use a larger element size.`)
  for (let j = 1; j < nRows; j++) {
    const y = y0 + j * dy
    const off = j % 2 ? 0.5 * hmin : 0
    for (let x = x0 + off; x < x1; x += hmin) {
      if (x <= x0 || !pointInPlate({ x, y }, plate)) continue
      const hl = h(x, y)
      if (hash.nearer(x, y, 0.75 * hl, w.xy)) continue
      const id = w.xy.length / 2
      w.xy.push(x, y)
      hash.add(id, x, y)
    }
  }
  // 3. + 4. triangulate, improve
  let t = triangulate(w)
  let tris = inside(w, t.tris, plate)
  const minAngle = (22 * Math.PI) / 180
  for (let pass = 0; pass < 3; pass++) {
    const hash2 = new PointHash(hmin)
    for (let i = 0; i < w.xy.length / 2; i++) hash2.add(i, w.xy[2 * i], w.xy[2 * i + 1])
    const bad: Array<{ q: number; p: Pt }> = []
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2]
      const ax = w.xy[2 * a], ay = w.xy[2 * a + 1], bx = w.xy[2 * b], by = w.xy[2 * b + 1], cx = w.xy[2 * c], cy = w.xy[2 * c + 1]
      const an = angles(ax, ay, bx, by, cx, cy)
      const mn = Math.min(...an)
      if (mn >= minAngle) continue
      const cc = circumcentre(ax, ay, bx, by, cx, cy)
      const cen = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 }
      const p = cc && pointInPlate(cc, plate) && Math.hypot(cc.x - cen.x, cc.y - cen.y) < 2 * h(cen.x, cen.y) ? cc : cen
      bad.push({ q: mn, p })
    }
    if (!bad.length) break
    bad.sort((a, b) => a.q - b.q)
    let added = 0
    for (const { p } of bad) {
      if (!pointInPlate(p, plate)) continue
      const hl = h(p.x, p.y)
      if (hash2.nearer(p.x, p.y, 0.45 * hl, w.xy)) continue
      const id = w.xy.length / 2
      w.xy.push(p.x, p.y)
      hash2.add(id, p.x, p.y)
      added++
    }
    if (!added) break
    t = triangulate(w)
    tris = inside(w, t.tris, plate)
  }
  // flips, smoothing
  const xy = Float64Array.from(w.xy)
  const nAll = xy.length / 2
  const locked = new Set<number>(w.segs.map((s) => (s.a < s.b ? s.a * nAll + s.b : s.b * nAll + s.a)))
  const fixed = new Uint8Array(nAll)
  for (const s of w.segs) { fixed[s.a] = 1; fixed[s.b] = 1 }
  for (let k = 0; k < 8 && flipPass(xy, tris, locked); k++) { /* until no more flips */ }
  smooth(xy, tris, fixed, st.smooth)
  for (let k = 0; k < 8 && flipPass(xy, tris, locked); k++) { /* until no more flips */ }
  if (st.smooth > 0) smooth(xy, tris, fixed, Math.ceil(st.smooth / 2))
  // compact
  const used = new Int32Array(nAll).fill(-1)
  let count = 0
  const order: number[] = []
  for (const v of tris) if (used[v] < 0) { used[v] = count++; order.push(v) }
  for (const s of w.segs) for (const v of [s.a, s.b]) if (used[v] < 0) { used[v] = count++; order.push(v) }
  const nxy = new Float64Array(2 * count)
  for (const v of order) { nxy[2 * used[v]] = xy[2 * v]; nxy[2 * used[v] + 1] = xy[2 * v + 1] }
  const conn = new Int32Array(tris.length)
  for (let i = 0; i < tris.length; i++) conn[i] = used[tris[i]]
  const vn: Record<string, number> = {}
  for (const [k, v] of Object.entries(vertexNodes)) if (used[v] >= 0) vn[k] = used[v]
  return {
    type: 'tri', stride: 3, nNodes: count, nElems: tris.length / 3, xy: nxy, conn,
    bsegs: w.segs.map((s) => ({ a: used[s.a], b: used[s.b], loop: s.loop, edge: s.edge })), vertexNodes: vn,
  }
}

// ---------------------------------------------------------------------------- structured and quad meshes

/** A regular grid in a four-sided region (corners counter-clockwise). Quads, or two triangles per cell. */
export function meshStructured(corners: readonly Pt[], size: number, type: 'tri' | 'quad', divisions?: [number, number]): Mesh {
  const pts = signedArea(corners) < 0 ? [...corners].reverse() : [...corners]
  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
  const nx = divisions?.[0] ?? Math.max(1, Math.round(Math.max(len(pts[0], pts[1]), len(pts[2], pts[3])) / size))
  const ny = divisions?.[1] ?? Math.max(1, Math.round(Math.max(len(pts[1], pts[2]), len(pts[3], pts[0])) / size))
  return gridMesh(pts, nx, ny, type, corners.length > 0 && signedArea(corners) < 0)
}

/** nx × ny cells; `reversed` when the corners had to be re-ordered (edge numbers then follow the original order). */
export function gridMesh(p: readonly Pt[], nx: number, ny: number, type: 'tri' | 'quad', reversed = false): Mesh {
  const id = (i: number, j: number) => j * (nx + 1) + i
  const nNodes = (nx + 1) * (ny + 1)
  const xy = new Float64Array(2 * nNodes)
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const s = i / nx
      const t = j / ny
      const k = id(i, j)
      xy[2 * k] = (1 - s) * (1 - t) * p[0].x + s * (1 - t) * p[1].x + s * t * p[2].x + (1 - s) * t * p[3].x
      xy[2 * k + 1] = (1 - s) * (1 - t) * p[0].y + s * (1 - t) * p[1].y + s * t * p[2].y + (1 - s) * t * p[3].y
    }
  }
  const conn: number[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1)
      if (type === 'quad') conn.push(a, b, c, d)
      else conn.push(a, b, c, a, c, d)
    }
  }
  const bsegs: BSeg[] = []
  const edgeOf = (e: number) => (reversed ? (4 - e) % 4 : e)
  for (let i = 0; i < nx; i++) bsegs.push({ a: id(i, 0), b: id(i + 1, 0), loop: 0, edge: edgeOf(0) })
  for (let j = 0; j < ny; j++) bsegs.push({ a: id(nx, j), b: id(nx, j + 1), loop: 0, edge: edgeOf(1) })
  for (let i = nx; i > 0; i--) bsegs.push({ a: id(i, ny), b: id(i - 1, ny), loop: 0, edge: edgeOf(2) })
  for (let j = ny; j > 0; j--) bsegs.push({ a: id(0, j), b: id(0, j - 1), loop: 0, edge: edgeOf(3) })
  const corners = [id(0, 0), id(nx, 0), id(nx, ny), id(0, ny)]
  const vertexNodes: Record<string, number> = {}
  corners.forEach((c, k) => { vertexNodes[`0:${reversed ? (4 - k) % 4 : k}`] = c })
  const stride = type === 'quad' ? 4 : 3
  return { type, stride, nNodes, nElems: conn.length / stride, xy, conn: Int32Array.from(conn), bsegs, vertexNodes }
}

/** Every triangle becomes three quadrilaterals (centroid and edge midpoints are new nodes): an all-quad mesh. */
export function trisToQuads(m: Mesh): Mesh {
  if (m.type === 'quad') return m
  const xy: number[] = Array.from(m.xy)
  const mid = new Map<number, number>()
  const n0 = m.nNodes
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * n0 + b : b * n0 + a
    let id = mid.get(key)
    if (id === undefined) {
      id = xy.length / 2
      xy.push((m.xy[2 * a] + m.xy[2 * b]) / 2, (m.xy[2 * a + 1] + m.xy[2 * b + 1]) / 2)
      mid.set(key, id)
    }
    return id
  }
  const conn: number[] = []
  for (let e = 0; e < m.nElems; e++) {
    const a = m.conn[3 * e], b = m.conn[3 * e + 1], c = m.conn[3 * e + 2]
    const g = xy.length / 2
    xy.push((m.xy[2 * a] + m.xy[2 * b] + m.xy[2 * c]) / 3, (m.xy[2 * a + 1] + m.xy[2 * b + 1] + m.xy[2 * c + 1]) / 3)
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a)
    conn.push(a, ab, g, ca, b, bc, g, ab, c, ca, g, bc)
  }
  const bsegs: BSeg[] = []
  for (const s of m.bsegs) {
    const k = midpoint(s.a, s.b)
    bsegs.push({ a: s.a, b: k, loop: s.loop, edge: s.edge }, { a: k, b: s.b, loop: s.loop, edge: s.edge })
  }
  return { type: 'quad', stride: 4, nNodes: xy.length / 2, nElems: conn.length / 4, xy: Float64Array.from(xy), conn: Int32Array.from(conn), bsegs, vertexNodes: { ...m.vertexNodes } }
}

// ---------------------------------------------------------------------------- quality

/** Quality of one element: triangles 4√3A/Σl²; quads the worst of the four corner triangles. */
export function elementQuality(m: Mesh, e: number): number {
  const c = m.conn
  const xy = m.xy
  const q = (a: number, b: number, d: number) => triQuality(xy[2 * a], xy[2 * a + 1], xy[2 * b], xy[2 * b + 1], xy[2 * d], xy[2 * d + 1])
  if (m.stride === 3) return q(c[3 * e], c[3 * e + 1], c[3 * e + 2])
  const [a, b, d, f] = [c[4 * e], c[4 * e + 1], c[4 * e + 2], c[4 * e + 3]]
  return Math.min(q(a, b, d), q(b, d, f), q(d, f, a), q(f, a, b))
}

export function elementArea(m: Mesh, e: number): number {
  const c = m.conn
  const xy = m.xy
  const s = m.stride
  let a = 0
  for (let k = 0; k < s; k++) {
    const p = c[s * e + k]
    const q = c[s * e + ((k + 1) % s)]
    a += xy[2 * p] * xy[2 * q + 1] - xy[2 * q] * xy[2 * p + 1]
  }
  return a / 2
}

export function meshStats(m: Mesh): MeshStats {
  const hist = new Array<number>(10).fill(0)
  let minQ = Infinity, sumQ = 0, minA = Infinity, maxA = 0, worst = 0
  let minAng = Infinity, maxAng = 0
  for (let e = 0; e < m.nElems; e++) {
    const q = elementQuality(m, e)
    sumQ += q
    if (q < minQ) { minQ = q; worst = e }
    hist[Math.max(0, Math.min(9, Math.floor(q * 10)))]++
    const a = Math.abs(elementArea(m, e))
    minA = Math.min(minA, a); maxA = Math.max(maxA, a)
    const s = m.stride
    for (let k = 0; k < s; k++) {
      const p = m.conn[s * e + ((k + s - 1) % s)], c = m.conn[s * e + k], n = m.conn[s * e + ((k + 1) % s)]
      const ang = angleAt(m.xy[2 * c], m.xy[2 * c + 1], m.xy[2 * p], m.xy[2 * p + 1], m.xy[2 * n], m.xy[2 * n + 1])
      minAng = Math.min(minAng, ang); maxAng = Math.max(maxAng, ang)
    }
  }
  const deg = 180 / Math.PI
  return {
    nodes: m.nNodes, elements: m.nElems, dofs: 2 * m.nNodes, type: m.type,
    minAngle: m.nElems ? minAng * deg : 0, maxAngle: m.nElems ? maxAng * deg : 0, meanQuality: m.nElems ? sumQ / m.nElems : 0, minQuality: m.nElems ? minQ : 0,
    minArea: m.nElems ? minA : 0, maxArea: maxA, histogram: hist, worstElement: worst,
  }
}

/** Total area of the mesh. */
export function meshArea(m: Mesh): number {
  let s = 0
  for (let e = 0; e < m.nElems; e++) s += elementArea(m, e)
  return s
}

// ---------------------------------------------------------------------------- targets (supports and loads on the boundary)

const near = (v: number, tol: number) => Math.abs(v) <= tol

/** The boundary segments a target selects. */
export function targetSegments(m: Mesh, t: Target, tol: number): BSeg[] {
  switch (t.kind) {
    case 'edge': return m.bsegs.filter((s) => s.loop === t.loop && s.edge === t.edge)
    case 'loop': return m.bsegs.filter((s) => s.loop === t.loop)
    case 'line': {
      const dx = t.x2 - t.x1
      const dy = t.y2 - t.y1
      const L = Math.hypot(dx, dy) || 1
      const on = (n: number) => {
        const px = m.xy[2 * n] - t.x1
        const py = m.xy[2 * n + 1] - t.y1
        const along = (px * dx + py * dy) / L
        return near((px * dy - py * dx) / L, tol) && along >= -tol && along <= L + tol
      }
      return m.bsegs.filter((s) => on(s.a) && on(s.b))
    }
    case 'circle': {
      const on = (n: number) => near(Math.hypot(m.xy[2 * n] - t.cx, m.xy[2 * n + 1] - t.cy) - t.r, tol)
      return m.bsegs.filter((s) => on(s.a) && on(s.b))
    }
    default: return []
  }
}

/** The nodes a target selects (the nodes of its segments; a vertex or a point: one node). */
export function targetNodes(m: Mesh, t: Target, tol: number): number[] {
  if (t.kind === 'vertex') {
    const n = m.vertexNodes[`${t.loop}:${t.vertex}`]
    return n === undefined ? [] : [n]
  }
  if (t.kind === 'point') {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < m.nNodes; i++) {
      const d = Math.hypot(m.xy[2 * i] - t.x, m.xy[2 * i + 1] - t.y)
      if (d < bd) { bd = d; best = i }
    }
    return best >= 0 ? [best] : []
  }
  const set = new Set<number>()
  for (const s of targetSegments(m, t, tol)) { set.add(s.a); set.add(s.b) }
  return [...set].sort((a, b) => a - b)
}
