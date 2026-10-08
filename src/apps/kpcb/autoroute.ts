// The auto-router (pure): a grid-based A* (Lee) maze router on two copper layers.
//
// For every net, in order of increasing length, a map of cells that are blocked for the net's track
// (copper of other nets and the board edge grown by clearance + half the track width + a margin for
// the grid step) and for its vias (grown by clearance + the via radius, and by the hole-to-hole rule
// around every drill) is built from the design as it is. Then the net is grown like a tree: an A* with
// several sources (the pads and routes already in the tree, and the zone copper of its net) and
// several targets (the pads of the groups still apart) finds the cheapest way over the 8 neighbours
// on the layer (a dislike of bends and of the non-preferred direction of the layer) and through vias
// (a fixed cost). The path becomes tracks (merged into straight runs) and vias. Nets that fail go
// first in the next pass, which starts again from the original design; zones are filled again after
// each pass and what they disconnected is routed in a further round.

import type { CellGrid, Pt, Shape } from './geom.ts'
import { cellsNear, distPointPoly, pointInPoly, polyBox } from './geom.ts'
import { designBox, netClassOf, outlineBox, uid, worldPads } from './board.ts'
import { analyze, inFill, ratsnest } from './analysis.ts'
import type { Analysis, CNode } from './analysis.ts'
import { fillZones } from './zones.ts'
import type { CopperId, Design, Fills, Track, Via } from './types.ts'

export interface RouteOptions {
  /** Grid step in mm (default 0.1). */
  pitch?: number
  /** Cost of a via, in tenths of a millimetre of track (default 80). */
  viaCost?: number
  /** Only route these nets. */
  nets?: string[]
  /** How many passes (a failed net goes first in the next one). Default 3. */
  passes?: number
}

export interface RouteResult {
  design: Design
  /** Connections that were missing before. */
  total: number
  /** Connections still missing. */
  remaining: number
  /** Percent of the missing connections that now exist (100 when nothing was missing). */
  completion: number
  routedNets: string[]
  failedNets: string[]
  tracksAdded: number
  viasAdded: number
  ms: number
}

interface Router extends CellGrid {
  N: number
  pitch: number
  viaCost: number
  inside: Uint8Array | null
  // search scratch
  g: Int32Array
  parent: Int32Array
  seen: Uint32Array
  stamp: number
}

const MARGIN = 0.71

// ------------------------------------------------------------ the grid

function makeRouter(d: Design, pitch: number, viaCost: number): Router {
  let box = outlineBox(d)
  if (!box) {
    const b = designBox(d) ?? { x0: 0, y0: 0, x1: 50, y1: 50 }
    box = { x0: b.x0 - 5, y0: b.y0 - 5, x1: b.x1 + 5, y1: b.y1 + 5 }
  }
  let step = pitch
  while (((box.x1 - box.x0) / step + 2) * ((box.y1 - box.y0) / step + 2) > 2_000_000) step *= 1.25
  const W = Math.floor((box.x1 - box.x0) / step) + 1
  const H = Math.floor((box.y1 - box.y0) / step) + 1
  const N = W * H
  const r: Router = {
    W, H, N, res: step, pitch: step, viaCost,
    ox: box.x0 - step / 2, oy: box.y0 - step / 2,
    inside: null,
    g: new Int32Array(2 * N), parent: new Int32Array(2 * N), seen: new Uint32Array(2 * N), stamp: 0,
  }
  if (d.outline.pts.length >= 3) {
    const inside = new Uint8Array(N)
    const ring = d.outline.pts
    const xs: number[] = []
    for (let j = 0; j < H; j++) {
      const y = r.oy + (j + 0.5) * step
      xs.length = 0
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const a = ring[i]
        const b = ring[k]
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - r.ox) / step - 0.5))
        const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - r.ox) / step - 0.5))
        for (let i = i0; i <= i1; i++) inside[j * W + i] = 1
      }
    }
    r.inside = inside
  }
  return r
}

const cellX = (r: Router, c: number) => r.ox + ((c % r.W) + 0.5) * r.res
const cellY = (r: Router, c: number) => r.oy + (Math.floor(c / r.W) + 0.5) * r.res

interface Blocks {
  /** [F.Cu cells | B.Cu cells]: 1 = a track of this net may not be here. */
  track: Uint8Array
  /** 1 = a via of this net may not be here. */
  via: Uint8Array
}

function buildBlocks(r: Router, d: Design, an: Analysis, net: string, w: number, viaD: number, viaDrill: number, clr: number): Blocks {
  const track = new Uint8Array(2 * r.N)
  const via = new Uint8Array(r.N)
  const m = r.pitch * MARGIN
  const rules = d.rules
  if (r.inside) {
    for (let c = 0; c < r.N; c++) {
      if (!r.inside[c]) {
        track[c] = 1
        track[r.N + c] = 1
        via[c] = 1
      }
    }
  }
  const ring = d.outline.pts
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const edge = [ring[k], ring[i]]
    cellsNear(r, edge, rules.edgeClearance + w / 2 + m, (c) => { track[c] = 1; track[r.N + c] = 1 })
    cellsNear(r, edge, rules.edgeClearance + viaD / 2 + m, (c) => { via[c] = 1 })
  }
  for (const n of an.nodes) {
    if (n.kind === 'zone') continue
    const s = n.shape!
    if (n.net !== '' && n.net === net) continue
    cellsNear(r, s.core, s.r + clr + w / 2 + m, (c) => { for (const l of n.layers) track[(l === 'F.Cu' ? 0 : r.N) + c] = 1 })
    cellsNear(r, s.core, s.r + clr + viaD / 2 + m, (c) => { via[c] = 1 })
  }
  const bare = (core: Pt[], rad: number) => {
    cellsNear(r, core, rad + clr + w / 2 + m, (c) => { track[c] = 1; track[r.N + c] = 1 })
    cellsNear(r, core, rad + clr + viaD / 2 + m, (c) => { via[c] = 1 })
  }
  for (const h of d.holes) bare([{ x: h.x, y: h.y }], h.d / 2)
  const drillReach = (rad: number) => rad + viaDrill / 2 + rules.holeToHole + m
  for (const part of d.parts) {
    for (const pad of worldPads(part)) {
      if (pad.drill <= 0) continue
      if (!pad.plated) bare([{ x: pad.x, y: pad.y }], pad.drill / 2)
      cellsNear(r, [{ x: pad.x, y: pad.y }], drillReach(pad.drill / 2), (c) => { via[c] = 1 })
    }
  }
  for (const v of d.vias) cellsNear(r, [{ x: v.x, y: v.y }], drillReach(v.drill / 2), (c) => { via[c] = 1 })
  for (const h of d.holes) cellsNear(r, [{ x: h.x, y: h.y }], drillReach(h.d / 2), (c) => { via[c] = 1 })
  return { track, via }
}

// ------------------------------------------------------------ pads as sources and targets

/** Signed distance from a point to a shape: negative inside. */
function signedDist(x: number, y: number, s: Shape): number {
  const c = s.core
  if (c.length === 1) return Math.hypot(x - c[0].x, y - c[0].y) - s.r
  if (c.length === 2) {
    const dx = c[1].x - c[0].x
    const dy = c[1].y - c[0].y
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - c[0].x) * dx + (y - c[0].y) * dy) / l2)) : 0
    return Math.hypot(x - (c[0].x + t * dx), y - (c[0].y + t * dy)) - s.r
  }
  const e = distPointPoly(x, y, c)
  return (pointInPoly(x, y, c) ? -e : e) - s.r
}

/** Cells (per layer) a track of width w can start from on a pad: inside the pad by half the width. */
function padAccess(r: Router, n: CNode, blocks: Blocks, w: number): Array<{ state: number; at: Pt }> {
  const s = n.shape!
  const centre = n.pad ? { x: n.pad.x, y: n.pad.y } : s.core[0]
  const pick = (limit: number): Array<{ state: number; at: Pt }> => {
    const out: Array<{ state: number; at: Pt }> = []
    cellsNear(r, s.core, s.r + r.pitch, (c, x, y) => {
      if (signedDist(x, y, s) > limit) return
      for (const l of n.layers) {
        const state = (l === 'F.Cu' ? 0 : r.N) + c
        if (!blocks.track[state]) out.push({ state, at: centre })
      }
    })
    return out
  }
  let list = pick(-w / 2 + 1e-9)
  if (!list.length) list = pick(0)
  if (!list.length) {
    // the cell nearest to the centre
    const i = Math.max(0, Math.min(r.W - 1, Math.round((centre.x - r.ox) / r.res - 0.5)))
    const j = Math.max(0, Math.min(r.H - 1, Math.round((centre.y - r.oy) / r.res - 0.5)))
    for (const l of n.layers) {
      const state = (l === 'F.Cu' ? 0 : r.N) + j * r.W + i
      if (!blocks.track[state]) list.push({ state, at: centre })
    }
  }
  return list
}

function zoneAccess(r: Router, n: CNode, blocks: Blocks): number[] {
  if (!n.poly) return []
  const b = polyBox(n.poly.outer)
  const l = n.layers[0] === 'F.Cu' ? 0 : r.N
  const out: number[] = []
  const i0 = Math.max(0, Math.floor((b.x0 - r.ox) / r.res))
  const i1 = Math.min(r.W - 1, Math.ceil((b.x1 - r.ox) / r.res))
  const j0 = Math.max(0, Math.floor((b.y0 - r.oy) / r.res))
  const j1 = Math.min(r.H - 1, Math.ceil((b.y1 - r.oy) / r.res))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = j * r.W + i
      if (blocks.track[l + c]) continue
      if (inFill(r.ox + (i + 0.5) * r.res, r.oy + (j + 0.5) * r.res, n.poly)) out.push(l + c)
    }
  }
  return out
}

// ------------------------------------------------------------ A*

class Heap {
  keys: number[] = []
  vals: number[] = []
  get size() {
    return this.keys.length
  }
  push(k: number, v: number) {
    const ks = this.keys
    const vs = this.vals
    let i = ks.length
    ks.push(k)
    vs.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (ks[p] <= k) break
      ks[i] = ks[p]
      vs[i] = vs[p]
      i = p
    }
    ks[i] = k
    vs[i] = v
  }
  pop(): number {
    const ks = this.keys
    const vs = this.vals
    const top = vs[0]
    const k = ks.pop()!
    const v = vs.pop()!
    const n = ks.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && ks[c + 1] < ks[c]) c++
        if (ks[c] >= k) break
        ks[i] = ks[c]
        vs[i] = vs[c]
        i = c
      }
      ks[i] = k
      vs[i] = v
    }
    return top
  }
}

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/** The cheapest path from any source state to any target state; null when there is none. */
function search(r: Router, blocks: Blocks, sources: Iterable<number>, targets: Map<number, number>, maxExpand = 3_000_000): number[] | null {
  r.stamp++
  const { N, W, H, g, parent, seen, stamp } = r
  let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity
  for (const t of targets.keys()) {
    const c = t >= N ? t - N : t
    const x = c % W
    const y = (c - x) / W
    if (x < tx0) tx0 = x
    if (x > tx1) tx1 = x
    if (y < ty0) ty0 = y
    if (y > ty1) ty1 = y
  }
  const hOf = (x: number, y: number) => {
    const dx = Math.max(tx0 - x, 0, x - tx1)
    const dy = Math.max(ty0 - y, 0, y - ty1)
    return 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy)
  }
  const heap = new Heap()
  for (const s of sources) {
    if (blocks.track[s]) continue
    g[s] = 0
    seen[s] = stamp
    parent[s] = -1
    const c = s >= N ? s - N : s
    heap.push(hOf(c % W, Math.floor(c / W)), s)
  }
  const closed = new Uint8Array(2 * N)
  let expanded = 0
  while (heap.size) {
    const s = heap.pop()
    if (closed[s]) continue
    closed[s] = 1
    if (targets.has(s)) {
      const path: number[] = []
      for (let p = s; p !== -1; p = parent[p]) path.push(p)
      return path.reverse()
    }
    if (++expanded > maxExpand) return null
    const layer = s >= N ? 1 : 0
    const base = layer * N
    const c = s - base
    const x = c % W
    const y = (c - x) / W
    const gs = g[s]
    const pp = parent[s]
    let pdx = 0
    let pdy = 0
    if (pp >= 0 && (pp >= N ? 1 : 0) === layer) {
      const pc = pp - base
      pdx = x - (pc % W)
      pdy = y - Math.floor(pc / W)
    }
    for (let k = 0; k < 8; k++) {
      const dx = DIRS[k][0]
      const dy = DIRS[k][1]
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ns = base + ny * W + nx
      if (closed[ns] || blocks.track[ns]) continue
      let cost: number
      if (dx !== 0 && dy !== 0) {
        if (blocks.track[base + y * W + nx] || blocks.track[base + ny * W + x]) continue
        cost = 14
      } else {
        cost = 10
        // a layer prefers one direction: F.Cu horizontal, B.Cu vertical
        if (layer === 0 ? dy !== 0 : dx !== 0) cost += 2
      }
      if ((pdx !== 0 || pdy !== 0) && (pdx !== dx || pdy !== dy)) cost += 4
      const ng = gs + cost
      if (seen[ns] !== stamp || ng < g[ns]) {
        seen[ns] = stamp
        g[ns] = ng
        parent[ns] = s
        heap.push(ng + hOf(nx, ny), ns)
      }
    }
    // a via
    const other = layer === 0 ? N + c : c
    if (!closed[other] && !blocks.via[c] && !blocks.track[other] && (pp < 0 || (pp >= N ? 1 : 0) === layer)) {
      const ng = gs + r.viaCost
      if (seen[other] !== stamp || ng < g[other]) {
        seen[other] = stamp
        g[other] = ng
        parent[other] = s
        heap.push(ng + hOf(x, y), other)
      }
    }
  }
  return null
}

// ------------------------------------------------------------ path to copper

function pathCopper(r: Router, path: number[], net: string, w: number, viaD: number, viaDrill: number, startStub: Pt | null, endStub: Pt | null): { tracks: Track[]; vias: Via[] } {
  const tracks: Track[] = []
  const vias: Via[] = []
  const layerOf = (s: number): CopperId => (s >= r.N ? 'B.Cu' : 'F.Cu')
  const pos = (s: number): Pt => {
    const c = s >= r.N ? s - r.N : s
    return { x: cellX(r, c), y: cellY(r, c) }
  }
  const addTrack = (a: Pt, b: Pt, layer: CopperId) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return
    tracks.push({ id: uid('t'), net, layer, w, x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y), auto: true })
  }
  if (startStub) addTrack(startStub, pos(path[0]), layerOf(path[0]))
  let runStart = 0
  let dir: [number, number] | null = null
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (layerOf(a) !== layerOf(b)) {
      addTrack(pos(path[runStart]), pos(a), layerOf(a))
      const p = pos(a)
      vias.push({ id: uid('v'), net, x: round(p.x), y: round(p.y), d: viaD, drill: viaDrill, auto: true })
      runStart = i
      dir = null
      continue
    }
    const pa = pos(a)
    const pb = pos(b)
    const d: [number, number] = [Math.sign(Math.round((pb.x - pa.x) / r.res)), Math.sign(Math.round((pb.y - pa.y) / r.res))]
    if (dir && (d[0] !== dir[0] || d[1] !== dir[1])) {
      addTrack(pos(path[runStart]), pa, layerOf(a))
      runStart = i - 1
    }
    dir = d
  }
  const last = path[path.length - 1]
  addTrack(pos(path[runStart]), pos(last), layerOf(last))
  if (endStub) addTrack(pos(last), endStub, layerOf(last))
  return { tracks, vias }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4

// ------------------------------------------------------------ nets

interface NetPlan {
  net: string
  length: number
}

/** Groups of pads of a net that are still apart, with the zone fills that join them. */
function groupsOf(an: Analysis, net: string): Array<{ pads: CNode[]; zones: CNode[] }> {
  const byComp = new Map<number, { pads: CNode[]; zones: CNode[] }>()
  for (const n of an.nodes) {
    const c = an.comp[n.id]
    if (n.kind === 'pad' && n.net === net) {
      const e = byComp.get(c) ?? { pads: [], zones: [] }
      e.pads.push(n)
      byComp.set(c, e)
    }
  }
  for (const n of an.nodes) {
    if (n.kind !== 'zone') continue
    const e = byComp.get(an.comp[n.id])
    if (e) e.zones.push(n)
  }
  return [...byComp.values()]
}

function routeNet(r: Router, cur: Design, fills: Fills, net: string): { tracks: Track[]; vias: Via[]; done: boolean } {
  const an = analyze(cur, fills)
  const groups = groupsOf(an, net)
  if (groups.length < 2) return { tracks: [], vias: [], done: true }
  const cls = netClassOf(cur, net)
  const w = Math.max(cls.track, cur.rules.minTrack)
  const viaD = cls.via
  const viaDrill = cls.drill
  const clr = Math.max(cur.rules.clearance, cls.clearance)
  const blocks = buildBlocks(r, cur, an, net, w, viaD, viaDrill, clr)

  const access = groups.map((gr) => {
    const map = new Map<number, Pt | null>()
    for (const p of gr.pads) for (const a of padAccess(r, p, blocks, w)) if (!map.has(a.state)) map.set(a.state, a.at)
    for (const z of gr.zones) for (const s of zoneAccess(r, z, blocks)) if (!map.has(s)) map.set(s, null)
    return map
  })
  const inTree = new Set<number>([0])
  const tree = new Map<number, Pt | null>(access[0])
  const tracks: Track[] = []
  const vias: Via[] = []
  let ok = true
  while (inTree.size < groups.length) {
    const targets = new Map<number, number>()
    access.forEach((map, gi) => {
      if (inTree.has(gi)) return
      for (const s of map.keys()) targets.set(s, gi)
    })
    if (!targets.size || !tree.size) { ok = false; break }
    const path = search(r, blocks, tree.keys(), targets)
    if (!path) { ok = false; break }
    const hit = targets.get(path[path.length - 1])!
    const first = path[0]
    const last = path[path.length - 1]
    const copper = pathCopper(r, path, net, w, viaD, viaDrill, tree.get(first) ?? null, access[hit].get(last) ?? null)
    tracks.push(...copper.tracks)
    vias.push(...copper.vias)
    inTree.add(hit)
    for (const [s, at] of access[hit]) if (!tree.has(s)) tree.set(s, at)
    for (const s of path) if (!tree.has(s)) tree.set(s, null)
    // the new copper can be left from at any cell of the path (both layers at a via)
    for (const v of copper.vias) {
      const i = Math.max(0, Math.min(r.W - 1, Math.round((v.x - r.ox) / r.res - 0.5)))
      const j = Math.max(0, Math.min(r.H - 1, Math.round((v.y - r.oy) / r.res - 0.5)))
      for (const l of [0, r.N]) if (!tree.has(l + j * r.W + i)) tree.set(l + j * r.W + i, null)
    }
  }
  return { tracks, vias, done: ok }
}

function plan(d: Design, an: Analysis, only: string[] | undefined, priority: Set<string>): NetPlan[] {
  const len = new Map<string, number>()
  for (const rl of ratsnest(d, an)) len.set(rl.net, (len.get(rl.net) ?? 0) + rl.len)
  return [...len.entries()]
    .filter(([n]) => !only || only.includes(n))
    .map(([net, length]) => ({ net, length }))
    .sort((a, b) => Number(priority.has(b.net)) - Number(priority.has(a.net)) || a.length - b.length || (a.net < b.net ? -1 : 1))
}

function routeNets(r: Router, d: Design, nets: NetPlan[], failed: Set<string>, fills: Fills): Design {
  let cur = d
  for (const { net } of nets) {
    const res = routeNet(r, cur, fills, net)
    if (!res.done) failed.add(net)
    else failed.delete(net)
    if (res.tracks.length || res.vias.length) cur = { ...cur, tracks: [...cur.tracks, ...res.tracks], vias: [...cur.vias, ...res.vias] }
  }
  return cur
}

/** Route what is missing (the whole ratsnest, or the listed nets). */
export function autoroute(d0: Design, opts: RouteOptions = {}): RouteResult {
  const t0 = Date.now()
  const r = makeRouter(d0, opts.pitch ?? 0.1, opts.viaCost ?? 80)
  let fills0 = fillZones(d0)
  const an0 = analyze(d0, fills0)
  const total = ratsnest(d0, an0).filter((x) => !opts.nets || opts.nets.includes(x.net)).length
  let best: { design: Design; remaining: number; failed: Set<string> } | null = null
  let priority = new Set<string>()
  const passes = opts.passes ?? 3
  for (let pass = 0; pass < passes; pass++) {
    const failed = new Set<string>()
    let d = d0
    fills0 = fillZones(d)
    d = routeNets(r, d, plan(d, analyze(d, fills0), opts.nets, priority), failed, fills0)
    for (let round = 0; round < 2; round++) {
      const fills = fillZones(d)
      const left = ratsnest(d, analyze(d, fills)).filter((x) => !opts.nets || opts.nets.includes(x.net))
      if (!left.length) break
      d = routeNets(r, d, plan(d, analyze(d, fills), opts.nets, new Set(left.map((x) => x.net))), failed, fills)
    }
    const fills = fillZones(d)
    const left = ratsnest(d, analyze(d, fills)).filter((x) => !opts.nets || opts.nets.includes(x.net))
    const remainingNets = new Set(left.map((x) => x.net))
    if (!best || left.length < best.remaining) best = { design: d, remaining: left.length, failed: remainingNets }
    if (left.length === 0) break
    priority = new Set([...priority, ...remainingNets])
  }
  const final = best!
  const completion = total === 0 ? 100 : Math.round(((total - final.remaining) / total) * 1000) / 10
  const added = {
    tracks: final.design.tracks.length - d0.tracks.length,
    vias: final.design.vias.length - d0.vias.length,
  }
  const failedNets = [...final.failed]
  const touched = new Set<string>()
  for (const t of final.design.tracks) if (t.auto && !d0.tracks.some((o) => o.id === t.id)) touched.add(t.net)
  return {
    design: final.design,
    total,
    remaining: final.remaining,
    completion,
    routedNets: [...touched].filter((n) => !failedNets.includes(n)),
    failedNets,
    tracksAdded: added.tracks,
    viasAdded: added.vias,
    ms: Date.now() - t0,
  }
}

/** Remove what the auto-router made (or, with `all`, every track and via). */
export function unroute(d: Design, all = false): Design {
  return { ...d, tracks: d.tracks.filter((t) => !all && !t.auto), vias: d.vias.filter((v) => !all && !v.auto) }
}
