// Copper connectivity (pure): which pads, tracks, vias and zone fills touch each other, and the
// ratsnest (the lines still missing, a minimum spanning tree per net).

import type { Box, Pt, Shape } from './geom.ts'
import { boxesTouch, pointInPoly, shapeBox, shapeDist } from './geom.ts'
import { holeShape, netOfPad, padShape, trackShape, viaShape, worldPads } from './board.ts'
import type { WorldPad } from './board.ts'
import type { CopperId, Design, Fills, FillPoly } from './types.ts'

export type NodeKind = 'pad' | 'track' | 'via' | 'zone'

export interface CNode {
  id: number
  kind: NodeKind
  layers: CopperId[]
  shape: Shape | null
  poly?: FillPoly
  box: Box
  /** The net it is known to be on ('' if none). */
  net: string
  /** Index in the design's array (parts: pad world data in `pad`). */
  index: number
  pad?: WorldPad
  /** Reference points (centre, ends…) used to test zone contact. */
  pts: Pt[]
}

export interface Analysis {
  nodes: CNode[]
  /** Component id of each node (nodes of one component are electrically joined). */
  comp: number[]
  /** Pairs of nodes found touching (for the DRC and for debugging). */
  touching: Array<[number, number]>
}

class DSU {
  p: number[]
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i)
  }
  find(a: number): number {
    while (this.p[a] !== a) {
      this.p[a] = this.p[this.p[a]]
      a = this.p[a]
    }
    return a
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.p[ra] = rb
  }
}

export const inFill = (x: number, y: number, f: FillPoly): boolean => pointInPoly(x, y, f.outer) && !f.holes.some((h) => pointInPoly(x, y, h))

const TOUCH = 1e-6

let memo: { d: Design; fills: Fills | undefined; an: Analysis } | null = null

/** Build the copper nodes of a design and find which touch. Cached for the last design. */
export function analyze(d: Design, fills?: Fills): Analysis {
  if (memo && memo.d === d && memo.fills === fills) return memo.an
  const nodes: CNode[] = []
  const add = (n: Omit<CNode, 'id'>) => nodes.push({ ...n, id: nodes.length })
  d.parts.forEach((part, index) => {
    for (const pad of worldPads(part)) {
      const shape = padShape(pad)
      if (!shape || pad.layers.length === 0) continue
      add({ kind: 'pad', layers: pad.layers, shape, box: shapeBox(shape), net: netOfPad(d, part.ref, pad.n), index, pad, pts: [{ x: pad.x, y: pad.y }] })
    }
  })
  d.tracks.forEach((t, index) => {
    const shape = trackShape(t)
    add({ kind: 'track', layers: [t.layer], shape, box: shapeBox(shape), net: t.net, index, pts: [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }, { x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 }] })
  })
  d.vias.forEach((v, index) => {
    const shape = viaShape(v)
    add({ kind: 'via', layers: ['F.Cu', 'B.Cu'], shape, box: shapeBox(shape), net: v.net, index, pts: [{ x: v.x, y: v.y }] })
  })
  if (fills) {
    d.zones.forEach((z, index) => {
      for (const poly of fills[z.id] ?? []) {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const p of poly.outer) {
          if (p.x < x0) x0 = p.x
          if (p.x > x1) x1 = p.x
          if (p.y < y0) y0 = p.y
          if (p.y > y1) y1 = p.y
        }
        add({ kind: 'zone', layers: [z.layer], shape: null, poly, box: { x0, y0, x1, y1 }, net: z.net, index, pts: [] })
      }
    })
  }

  const dsu = new DSU(nodes.length)
  const touching: Array<[number, number]> = []
  const link = (a: number, b: number) => {
    dsu.union(a, b)
    touching.push([a, b])
  }

  // pads with the same number on a part are one pin
  const pins = new Map<string, number>()
  for (const n of nodes) {
    if (n.kind !== 'pad' || !n.pad || n.pad.n === '') continue
    const key = `${n.pad.part.ref}\u0000${n.pad.n}`
    const first = pins.get(key)
    if (first === undefined) pins.set(key, n.id)
    else dsu.union(first, n.id)
  }

  // spatial hash for the non-zone nodes
  const CELL = 2
  const grid = new Map<number, number[]>()
  const key = (cx: number, cy: number) => cx * 73856093 + cy * 19349663
  for (const n of nodes) {
    if (n.kind === 'zone') continue
    const cx0 = Math.floor(n.box.x0 / CELL)
    const cx1 = Math.floor(n.box.x1 / CELL)
    const cy0 = Math.floor(n.box.y0 / CELL)
    const cy1 = Math.floor(n.box.y1 / CELL)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy)
        const list = grid.get(k)
        if (list) list.push(n.id)
        else grid.set(k, [n.id])
      }
    }
  }
  const seen = new Set<number>()
  for (const a of nodes) {
    if (a.kind === 'zone') continue
    const cx0 = Math.floor(a.box.x0 / CELL)
    const cx1 = Math.floor(a.box.x1 / CELL)
    const cy0 = Math.floor(a.box.y0 / CELL)
    const cy1 = Math.floor(a.box.y1 / CELL)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (const bid of grid.get(key(cx, cy)) ?? []) {
          if (bid <= a.id) continue
          const pair = a.id * 1_000_003 + bid
          if (seen.has(pair)) continue
          seen.add(pair)
          const b = nodes[bid]
          if (!a.layers.some((l) => b.layers.includes(l))) continue
          if (!boxesTouch(a.box, b.box, TOUCH)) continue
          if (shapeDist(a.shape!, b.shape!) <= TOUCH) link(a.id, bid)
        }
      }
    }
  }
  // zone fills touch what lies inside them
  for (const z of nodes) {
    if (z.kind !== 'zone' || !z.poly) continue
    for (const o of nodes) {
      if (o.kind === 'zone' || !o.layers.some((l) => z.layers.includes(l)) || !boxesTouch(z.box, o.box)) continue
      if (o.pts.some((p) => inFill(p.x, p.y, z.poly!))) link(z.id, o.id)
    }
  }

  const comp = nodes.map((n) => dsu.find(n.id))
  const an: Analysis = { nodes, comp, touching }
  memo = { d, fills, an }
  return an
}

// ------------------------------------------------------------ ratsnest

export interface RatLine {
  net: string
  a: { x: number; y: number; label: string }
  b: { x: number; y: number; label: string }
  len: number
}

/** Minimum spanning tree of the unconnected groups of pads of every net. */
export function ratsnest(_d: Design, an: Analysis): RatLine[] {
  const byNet = new Map<string, CNode[]>()
  for (const n of an.nodes) {
    if (n.kind !== 'pad' || !n.net) continue
    const list = byNet.get(n.net)
    if (list) list.push(n)
    else byNet.set(n.net, [n])
  }
  const out: RatLine[] = []
  for (const [net, pads] of byNet) {
    const groups = new Map<number, CNode[]>()
    for (const p of pads) {
      const c = an.comp[p.id]
      const g = groups.get(c)
      if (g) g.push(p)
      else groups.set(c, [p])
    }
    if (groups.size < 2) continue
    const list = [...groups.values()]
    // Prim's algorithm over the groups; the edge between two groups is the closest pair of pads.
    const inTree = new Set<number>([0])
    while (inTree.size < list.length) {
      let best: { gi: number; a: CNode; b: CNode; len: number } | null = null
      for (const i of inTree) {
        for (let j = 0; j < list.length; j++) {
          if (inTree.has(j)) continue
          for (const a of list[i]) {
            for (const b of list[j]) {
              const len = Math.hypot(a.pad!.x - b.pad!.x, a.pad!.y - b.pad!.y)
              if (!best || len < best.len) best = { gi: j, a, b, len }
            }
          }
        }
      }
      if (!best) break
      inTree.add(best.gi)
      out.push({
        net,
        a: { x: best.a.pad!.x, y: best.a.pad!.y, label: best.a.pad!.label },
        b: { x: best.b.pad!.x, y: best.b.pad!.y, label: best.b.pad!.label },
        len: best.len,
      })
    }
  }
  return out
}

/** How many connections a design needs in all (pads - 1 per net, counting pins once). */
export function requiredConnections(d: Design): number {
  let n = 0
  for (const net of d.nets) {
    const pins = new Set<string>()
    for (const p of net.pins) if (d.parts.some((q) => q.ref === p.ref)) pins.add(`${p.ref}\u0000${p.pin}`)
    if (pins.size > 1) n += pins.size - 1
  }
  return n
}

/** Free-standing holes are not copper, but the router and the DRC need their shapes. */
export const holeShapes = (d: Design) => d.holes.map((h) => holeShape(h))
