// Copper zones (pure): filling a zone polygon with copper that keeps its clearance to the copper of
// other nets.
//
// How it works. The zone's area is rasterised on a grid of 0.05 mm cells (coarser only when the board
// is so big that the grid would pass ~3 million cells). A cell is copper when its centre is inside the
// zone and the board outline, at least `edge clearance` away from the board edge, and no copper of
// another net (pads, tracks, vias, holes of other or no net) is closer than `clearance` + the half
// diagonal of a cell, so the whole cell square keeps the clearance. Pads of the zone's own net are
// left alone (the copper merges with them) or, with thermal reliefs on, a ring of clearance is cut
// around each through-hole pad except four spokes. Islands without a pad, via or track of the zone's
// net are removed. The boundary of the remaining cells is traced into polygons (outer rings and
// holes, clockwise outer rings), with collinear points removed. The result is correct for the DRC
// (the clearance is met, and exceeded by up to 0.035 mm at the grid's resolution) and for Gerber (the
// polygons are written as regions, the holes with clear polarity).

import type { CellGrid, Pt } from './geom.ts'
import { cellsNear, distToCore, pointInPoly, polyArea, polyBox, simplifyRing } from './geom.ts'
import { netOfPad, padShape, worldPads } from './board.ts'
import type { Design, Fills, FillPoly, Zone } from './types.ts'

export interface FillOptions {
  /** Cell size in mm (default 0.05). */
  res?: number
  /** Upper bound for the number of cells (default 3 million). */
  maxCells?: number
}

interface Grid extends CellGrid {
  mask: Uint8Array
}

/** Mark the cells inside a polygon (even-odd) into `out` (1 = inside). */
function rasterise(g: Grid, poly: readonly Pt[], out: Uint8Array) {
  const { W, H, ox, oy, res } = g
  const xs: number[] = []
  for (let j = 0; j < H; j++) {
    const y = oy + (j + 0.5) * res
    xs.length = 0
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const a = poly[i]
      const b = poly[k]
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - ox) / res - 0.5))
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - ox) / res - 0.5))
      for (let i = i0; i <= i1; i++) out[j * W + i] = 1
    }
  }
}

/** Clear the cells whose centre is closer than `r + R` to a shape (core + radius r), except where `keep` says so. */
function clearNear(g: Grid, core: readonly Pt[], r: number, R: number, keep?: (x: number, y: number) => boolean) {
  cellsNear(g, core, r + R, (o, x, y) => {
    if (g.mask[o] && (!keep || !keep(x, y))) g.mask[o] = 0
  })
}

/** The copper polygons of one zone. */
export function fillZone(d: Design, z: Zone, opts: FillOptions = {}): FillPoly[] {
  if (z.pts.length < 3) return []
  let box = polyBox(z.pts)
  const outline = d.outline.pts
  if (outline.length >= 3) {
    const ob = polyBox(outline)
    box = { x0: Math.max(box.x0, ob.x0), y0: Math.max(box.y0, ob.y0), x1: Math.min(box.x1, ob.x1), y1: Math.min(box.y1, ob.y1) }
  }
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return []
  let res = opts.res ?? 0.05
  const maxCells = opts.maxCells ?? 3_000_000
  while (((box.x1 - box.x0) / res + 2) * ((box.y1 - box.y0) / res + 2) > maxCells) res *= 1.25
  const W = Math.ceil((box.x1 - box.x0) / res) + 1
  const H = Math.ceil((box.y1 - box.y0) / res) + 1
  const g: Grid = { W, H, ox: box.x0, oy: box.y0, res, mask: new Uint8Array(W * H) }
  const half = res * Math.SQRT1_2
  const clr = z.clearance

  rasterise(g, z.pts, g.mask)
  if (outline.length >= 3) {
    const inside = new Uint8Array(W * H)
    rasterise(g, outline, inside)
    for (let o = 0; o < g.mask.length; o++) g.mask[o] &= inside[o]
    for (let i = 0, k = outline.length - 1; i < outline.length; k = i++) clearNear(g, [outline[k], outline[i]], 0, d.rules.edgeClearance + half)
  }

  const sameNet = (net: string) => z.net !== '' && net === z.net
  for (const part of d.parts) {
    for (const pad of worldPads(part)) {
      const net = netOfPad(d, part.ref, pad.n)
      if (!pad.plated) {
        // a bare hole: keep copper away from it
        clearNear(g, [{ x: pad.x, y: pad.y }], pad.drill / 2, clr + half)
        continue
      }
      if (!pad.layers.includes(z.layer)) continue
      const shape = padShape(pad)
      if (!shape) continue
      if (sameNet(net)) {
        if (z.thermal && pad.drill > 0) {
          const gap = Math.max(0.25, clr)
          const spoke = 0.4
          const cx = pad.x
          const cy = pad.y
          const ring = gap + half
          // cut the ring around the pad, but not on the four spokes
          clearNear(g, shape.core, shape.r, ring, (x, y) => (Math.abs(x - cx) < spoke / 2 || Math.abs(y - cy) < spoke / 2 ? true : distToCore(x, y, shape.core) - shape.r <= 0))
        }
        continue
      }
      clearNear(g, shape.core, shape.r, clr + half)
    }
  }
  for (const t of d.tracks) {
    if (t.layer !== z.layer || sameNet(t.net)) continue
    clearNear(g, [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }], t.w / 2, clr + half)
  }
  for (const v of d.vias) {
    if (sameNet(v.net)) continue
    clearNear(g, [{ x: v.x, y: v.y }], v.d / 2, clr + half)
  }
  for (const h of d.holes) clearNear(g, [{ x: h.x, y: h.y }], h.d / 2, clr + half)

  // connected cells (4-neighbours); keep the islands that hold something of the zone's net
  const label = new Int32Array(W * H)
  const sizes: number[] = [0]
  const stack: number[] = []
  let count = 0
  for (let s = 0; s < g.mask.length; s++) {
    if (!g.mask[s] || label[s]) continue
    count++
    let n = 0
    label[s] = count
    stack.push(s)
    while (stack.length) {
      const o = stack.pop()!
      n++
      const i = o % W
      const j = (o - i) / W
      if (i > 0 && g.mask[o - 1] && !label[o - 1]) { label[o - 1] = count; stack.push(o - 1) }
      if (i < W - 1 && g.mask[o + 1] && !label[o + 1]) { label[o + 1] = count; stack.push(o + 1) }
      if (j > 0 && g.mask[o - W] && !label[o - W]) { label[o - W] = count; stack.push(o - W) }
      if (j < H - 1 && g.mask[o + W] && !label[o + W]) { label[o + W] = count; stack.push(o + W) }
    }
    sizes.push(n)
  }
  const keep = new Uint8Array(count + 1)
  if (z.net === '') keep.fill(1)
  else {
    const seed = (x: number, y: number) => {
      const ci = Math.round((x - g.ox) / res - 0.5)
      const cj = Math.round((y - g.oy) / res - 0.5)
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= W || j >= H) continue
          const l = label[j * W + i]
          if (l) keep[l] = 1
        }
      }
    }
    for (const part of d.parts) {
      for (const pad of worldPads(part)) if (pad.layers.includes(z.layer) && sameNet(netOfPad(d, part.ref, pad.n))) seed(pad.x, pad.y)
    }
    for (const v of d.vias) if (sameNet(v.net)) seed(v.x, v.y)
    for (const t of d.tracks) {
      if (t.layer !== z.layer || !sameNet(t.net)) continue
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
      const n = Math.max(1, Math.ceil(len / 0.5))
      for (let k = 0; k <= n; k++) seed(t.x1 + ((t.x2 - t.x1) * k) / n, t.y1 + ((t.y2 - t.y1) * k) / n)
    }
  }
  for (let o = 0; o < g.mask.length; o++) if (g.mask[o] && !keep[label[o]]) { g.mask[o] = 0; label[o] = 0 }

  return trace(g, label, count)
}

/** Trace the boundaries of the filled cells into polygons: outer rings clockwise (positive area). */
function trace(g: Grid, label: Int32Array, count: number): FillPoly[] {
  const { W, H, ox, oy, res, mask } = g
  const VW = W + 1
  // edges: start vertex, direction 0 = +x, 1 = +y, 2 = -x, 3 = -y (clockwise on the screen, fill on the right)
  const eStart: number[] = []
  const eDir: number[] = []
  const outA = new Int32Array(VW * (H + 1)).fill(-1)
  const outB = new Int32Array(VW * (H + 1)).fill(-1)
  const addEdge = (x: number, y: number, dir: number) => {
    const e = eStart.length
    const v = y * VW + x
    eStart.push(v)
    eDir.push(dir)
    if (outA[v] < 0) outA[v] = e
    else outB[v] = e
  }
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i] === 1
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!mask[j * W + i]) continue
      if (!filled(i, j - 1)) addEdge(i, j, 0)
      if (!filled(i + 1, j)) addEdge(i + 1, j, 1)
      if (!filled(i, j + 1)) addEdge(i + 1, j + 1, 2)
      if (!filled(i - 1, j)) addEdge(i, j + 1, 3)
    }
  }
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  const used = new Uint8Array(eStart.length)
  const outers: Array<{ ring: Pt[]; label: number }> = []
  const holes: Array<{ ring: Pt[]; label: number }> = []
  for (let e0 = 0; e0 < eStart.length; e0++) {
    if (used[e0]) continue
    const ring: Pt[] = []
    let e = e0
    const first = e0
    const x0 = eStart[e0] % VW
    const y0 = (eStart[e0] - x0) / VW
    // the filled cell to the right of the first edge
    const dir0 = eDir[e0]
    const ci = dir0 === 0 ? x0 : dir0 === 1 ? x0 - 1 : dir0 === 2 ? x0 - 1 : x0
    const cj = dir0 === 0 ? y0 : dir0 === 1 ? y0 : dir0 === 2 ? y0 - 1 : y0 - 1
    const lab = label[cj * W + ci]
    for (let guard = 0; guard < eStart.length + 2; guard++) {
      used[e] = 1
      const v = eStart[e]
      const x = v % VW
      const y = (v - x) / VW
      ring.push({ x: ox + x * res, y: oy + y * res })
      const d = eDir[e]
      const nx = x + DX[d]
      const ny = y + DY[d]
      const nv = ny * VW + nx
      let next = -1
      for (const turn of [1, 0, 3, 2]) {
        const want = (d + turn) % 4
        for (const cand of [outA[nv], outB[nv]]) {
          if (cand >= 0 && eDir[cand] === want) {
            next = cand
            break
          }
        }
        if (next >= 0) break
      }
      if (next < 0 || next === first) break
      e = next
    }
    const simple = simplifyRing(ring)
    if (simple.length < 3) continue
    if (polyArea(simple) > 0) outers.push({ ring: simple, label: lab })
    else holes.push({ ring: simple, label: lab })
  }
  const out: FillPoly[] = []
  const byLabel = new Map<number, FillPoly[]>()
  for (const o of outers) {
    const p: FillPoly = { outer: o.ring, holes: [] }
    out.push(p)
    const list = byLabel.get(o.label)
    if (list) list.push(p)
    else byLabel.set(o.label, [p])
  }
  void count
  for (const h of holes) {
    const cands = byLabel.get(h.label) ?? []
    const target = cands.length === 1 ? cands[0] : cands.find((c) => pointInPoly(h.ring[0].x, h.ring[0].y, c.outer))
    if (target) target.holes.push(h.ring)
  }
  return out
}

/** Fill every zone of a design. */
export function fillZones(d: Design, opts: FillOptions = {}): Fills {
  const out: Fills = {}
  for (const z of d.zones) out[z.id] = fillZone(d, z, opts)
  return out
}

export function fillArea(polys: readonly FillPoly[]): number {
  let a = 0
  for (const p of polys) a += polyArea(p.outer) + p.holes.reduce((s, h) => s + polyArea(h), 0)
  return a
}
