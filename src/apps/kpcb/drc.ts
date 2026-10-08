// Design-rule check (pure). Copper shapes are exact for round, oval and rectangular pads, tracks
// (capsules) and vias; only the outline of a rounded board is approximated by its polygon.

import type { Pt, Shape } from './geom.ts'
import { BoxGrid, convexOverlap, gapMidpoint, pointInPoly, shapeBox, shapeDist, shapeToRingDist } from './geom.ts'
import { partCourtyard, partSilk, refTextPos, REF_TEXT_H, worldPads } from './board.ts'
import { strokeWidth, textStrokes } from './font.ts'
import { analyze, inFill, ratsnest } from './analysis.ts'
import type { CNode } from './analysis.ts'
import type { Design, Fills, Violation } from './types.ts'

export interface DrcOptions {
  /** Skip the slower and softer checks (silkscreen, courtyards, dangling track ends): for live checking. */
  light?: boolean
}

const EPS = 1e-6
const SILK_W = 0.12

export function runDrc(d: Design, fills?: Fills, opts: DrcOptions = {}): Violation[] {
  const out: Violation[] = []
  const rules = d.rules
  let seq = 0
  const report = (severity: 'error' | 'warning', rule: string, message: string, p: Pt) => {
    out.push({ id: `drc${++seq}`, severity, rule, message, x: p.x, y: p.y })
  }
  const an = analyze(d, fills)
  const nodes = an.nodes.filter((n) => n.kind !== 'zone')
  const label = (n: CNode) =>
    n.kind === 'pad' ? `pad ${n.pad!.label}` : n.kind === 'track' ? `track${n.net ? ` of ${n.net}` : ''}` : `via${n.net ? ` of ${n.net}` : ''}`
  const centre = (n: CNode): Pt => {
    const s = n.shape!
    return s.core.length === 1 ? s.core[0] : { x: s.core.reduce((a, p) => a + p.x, 0) / s.core.length, y: s.core.reduce((a, p) => a + p.y, 0) / s.core.length }
  }

  // ---- clearance and short circuits between copper
  const grid = new BoxGrid(2)
  for (const n of nodes) grid.add(n.id, n.box)
  const shorted = new Set<number>()
  {
    for (const a of nodes) {
      for (const bid of grid.query(a.box, rules.clearance)) {
        if (bid <= a.id) continue
        const b = an.nodes[bid]
        if (!a.layers.some((l) => b.layers.includes(l))) continue
        const sameComp = an.comp[a.id] === an.comp[b.id]
        if (sameComp) {
          if (rules.shorts && a.net && b.net && a.net !== b.net && shapeDist(a.shape!, b.shape!) <= EPS) {
            report('error', 'short', `Short circuit between ${[a.net, b.net].sort().join(' and ')} (${label(a)} touches ${label(b)})`, gapMidpoint(a.shape!.core, b.shape!.core))
            shorted.add(an.comp[a.id])
          }
          continue
        }
        if (a.net && a.net === b.net) continue
        const gap = shapeDist(a.shape!, b.shape!)
        if (gap < rules.clearance - EPS) {
          report('error', 'clearance', `Clearance ${Math.max(0, gap).toFixed(3)} mm < ${rules.clearance} mm between ${label(a)} and ${label(b)}`, gapMidpoint(a.shape!.core, b.shape!.core))
        }
      }
    }
  }
  if (rules.shorts) {
    // a component joining pads of several nets without a track of its own net in the way
    const padNets = new Map<number, Set<string>>()
    for (const n of an.nodes) {
      if (n.kind !== 'pad' || !n.net) continue
      const c = an.comp[n.id]
      const s = padNets.get(c)
      if (s) s.add(n.net)
      else padNets.set(c, new Set([n.net]))
    }
    for (const [c, set] of padNets) {
      if (set.size < 2 || shorted.has(c)) continue
      const at = an.nodes.find((n) => an.comp[n.id] === c && n.kind !== 'pad' && n.kind !== 'zone') ?? an.nodes.find((n) => an.comp[n.id] === c)!
      report('error', 'short', `Short circuit between ${[...set].join(' and ')}`, at.shape ? centre(at) : { x: 0, y: 0 })
    }
  }

  // ---- track widths, vias, drills
  for (const t of d.tracks) {
    if (t.w < rules.minTrack - EPS) report('error', 'track-width', `Track width ${t.w} mm < ${rules.minTrack} mm${t.net ? ` (${t.net})` : ''}`, { x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 })
  }
  interface Drill { x: number; y: number; r: number; key: string; what: string }
  const drills: Drill[] = []
  for (const v of d.vias) {
    if (v.drill < rules.minViaDrill - EPS) report('error', 'via-drill', `Via drill ${v.drill} mm < ${rules.minViaDrill} mm`, v)
    else if (v.drill < rules.minDrill - EPS) report('error', 'drill', `Drill ${v.drill} mm < ${rules.minDrill} mm`, v)
    const ring = (v.d - v.drill) / 2
    if (ring < rules.annular - EPS) report('error', 'annular', `Via annular ring ${ring.toFixed(3)} mm < ${rules.annular} mm`, v)
    drills.push({ x: v.x, y: v.y, r: v.drill / 2, key: `v:${v.id}`, what: 'via' })
  }
  for (const part of d.parts) {
    for (const pad of worldPads(part)) {
      if (pad.drill <= 0) continue
      drills.push({ x: pad.x, y: pad.y, r: pad.drill / 2, key: `p:${part.id}:${pad.index}`, what: `pad ${pad.label}` })
      if (pad.drill < rules.minDrill - EPS) report('error', 'drill', `Drill ${pad.drill} mm < ${rules.minDrill} mm at ${pad.label}`, pad)
      if (pad.plated) {
        const ring = (Math.min(pad.w, pad.h) - pad.drill) / 2
        if (ring < rules.annular - EPS) report('error', 'annular', `Annular ring ${ring.toFixed(3)} mm < ${rules.annular} mm at ${pad.label}`, pad)
      }
    }
  }
  for (const h of d.holes) {
    drills.push({ x: h.x, y: h.y, r: h.d / 2, key: `h:${h.id}`, what: 'hole' })
    if (h.d < rules.minDrill - EPS) report('error', 'drill', `Hole ${h.d} mm < ${rules.minDrill} mm`, h)
  }
  const dg = new BoxGrid(4)
  drills.forEach((k, i) => dg.add(i, { x0: k.x - k.r, y0: k.y - k.r, x1: k.x + k.r, y1: k.y + k.r }))
  drills.forEach((a, i) => {
    for (const j of dg.query({ x0: a.x - a.r, y0: a.y - a.r, x1: a.x + a.r, y1: a.y + a.r }, rules.holeToHole)) {
      if (j <= i) continue
      const b = drills[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r
      if (gap < rules.holeToHole - EPS) report('error', 'hole-to-hole', `Hole to hole ${Math.max(0, gap).toFixed(3)} mm < ${rules.holeToHole} mm (${a.what} and ${b.what})`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
  })

  // ---- copper (and drills) to the board edge
  const ring = d.outline.pts
  if (ring.length >= 3) {
    const checkEdge = (s: Shape, what: string, grow = 0) => {
      const c = s.core[0]
      if (!pointInPoly(c.x, c.y, ring)) {
        report('error', 'edge', `${what} is outside the board outline`, c)
        return
      }
      const gap = shapeToRingDist({ core: s.core, r: s.r + grow }, ring)
      if (gap < rules.edgeClearance - EPS) report('error', 'edge', `${what} is ${Math.max(0, gap).toFixed(3)} mm from the board edge (< ${rules.edgeClearance} mm)`, c)
    }
    for (const n of nodes) checkEdge(n.shape!, label(n))
    for (const k of drills) if (k.key.startsWith('h:')) checkEdge({ core: [{ x: k.x, y: k.y }], r: k.r }, 'Hole')
    for (const part of d.parts) {
      for (const pad of worldPads(part)) if (!pad.plated && pad.drill > 0) checkEdge({ core: [{ x: pad.x, y: pad.y }], r: pad.drill / 2 }, `Hole ${pad.label || part.ref}`)
    }
  } else if (d.parts.length || d.tracks.length) {
    report('warning', 'outline', 'The board has no outline (draw one on Edge.Cuts)', { x: 0, y: 0 })
  }

  // ---- copper to bare holes
  const bare: Array<{ s: Shape; what: string }> = d.holes.map((h) => ({ s: { core: [{ x: h.x, y: h.y }], r: h.d / 2 }, what: 'hole' }))
  for (const part of d.parts) {
    for (const pad of worldPads(part)) if (!pad.plated && pad.drill > 0) bare.push({ s: { core: [{ x: pad.x, y: pad.y }], r: pad.drill / 2 }, what: `hole ${pad.label || part.ref}` })
  }
  for (const h of bare) {
    for (const bid of grid.query(shapeBox(h.s), rules.clearance)) {
      const n = an.nodes[bid]
      const gap = shapeDist(h.s, n.shape!)
      if (gap < rules.clearance - EPS) report('error', 'clearance', `Copper ${Math.max(0, gap).toFixed(3)} mm from a ${h.what} (${label(n)}), < ${rules.clearance} mm`, gapMidpoint(h.s.core, n.shape!.core))
    }
  }

  // ---- unconnected pads
  if (rules.unconnected) {
    for (const r of ratsnest(d, an)) {
      report('error', 'unconnected', `Unconnected: ${r.a.label} to ${r.b.label} (net ${r.net}), ${r.len.toFixed(2)} mm apart`, { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 })
    }
  }
  if (fills) {
    for (const z of d.zones) {
      if (z.net && (fills[z.id]?.length ?? 0) === 0) report('warning', 'zone', `The ${z.layer} zone of ${z.net} has no copper (nothing of the net is inside it)`, z.pts[0] ?? { x: 0, y: 0 })
    }
  }

  if (!opts.light) {
    // ---- track ends going nowhere
    if (rules.dangling) {
      for (const n of nodes) {
        if (n.kind !== 'track') continue
        const t = d.tracks[n.index]
        if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) < EPS) continue
        for (const p of [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }]) {
          const pb = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
          let ok = false
          for (const bid of grid.query(pb)) {
            if (bid === n.id) continue
            const o = an.nodes[bid]
            if (!o.layers.includes(t.layer)) continue
            if (shapeDist({ core: [p], r: 0 }, o.shape!) <= EPS) { ok = true; break }
          }
          if (!ok && fills) {
            for (const z of an.nodes) if (z.kind === 'zone' && z.layers.includes(t.layer) && z.poly && inFill(p.x, p.y, z.poly)) { ok = true; break }
          }
          if (!ok) report('warning', 'dangling', `Track end of ${t.net || 'a track'} on ${t.layer} is not connected to anything`, p)
        }
      }
    }

    // ---- silkscreen over exposed pads
    if (rules.silkPad) {
      const pads: Array<{ n: CNode; box: ReturnType<typeof shapeBox> }> = nodes.filter((n) => n.kind === 'pad').map((n) => ({ n, box: n.box }))
      const pg = new BoxGrid(2)
      pads.forEach((p, i) => pg.add(i, p.box))
      const seen = new Set<string>()
      for (const part of d.parts) {
        const copper = part.side === 'F' ? 'F.Cu' : 'B.Cu'
        const strokes: Array<[Pt, Pt]> = [...partSilk(part)]
        let w = SILK_W
        const label2: Array<[Pt, Pt]> = []
        if (!part.hideRef) {
          const tp = refTextPos(part)
          label2.push(...textStrokes(part.ref, tp.x, tp.y, REF_TEXT_H, part.side === 'B'))
        }
        for (const set of [strokes, label2]) {
          w = set === strokes ? SILK_W : strokeWidth(REF_TEXT_H)
          for (const [a, b] of set) {
            const s: Shape = { core: [a, b], r: w / 2 }
            for (const i of pg.query(shapeBox(s))) {
              const pad = pads[i].n
              if (!pad.layers.includes(copper)) continue
              const k = `${part.id}|${pad.id}`
              if (seen.has(k)) continue
              if (shapeDist(s, pad.shape!) < -EPS) {
                seen.add(k)
                report('warning', 'silk', `Silkscreen of ${part.ref} overlaps ${label(pad)}`, centre(pad))
              }
            }
          }
        }
      }
    }

    // ---- courtyards
    if (rules.courtyard) {
      const cg = new BoxGrid(5)
      const polys = d.parts.map((p) => partCourtyard(p))
      polys.forEach((poly, i) => {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
        cg.add(i, { x0, y0, x1, y1 })
      })
      polys.forEach((poly, i) => {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
        for (const j of cg.query({ x0, y0, x1, y1 })) {
          if (j <= i) continue
          if (d.parts[i].side !== d.parts[j].side) continue
          if (convexOverlap(poly, polys[j], 1e-3)) {
            const a = d.parts[i]
            const b = d.parts[j]
            report('error', 'courtyard', `Courtyards of ${a.ref} and ${b.ref} overlap`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
          }
        }
      })
    }
  }

  // parts not in the netlist any more
  for (const p of d.parts) if (p.stale) report('warning', 'netlist', `${p.ref} is no longer in the netlist`, p)
  return out
}

export function drcSummary(v: readonly Violation[]): { errors: number; warnings: number } {
  let errors = 0
  for (const x of v) if (x.severity === 'error') errors++
  return { errors, warnings: v.length - errors }
}
