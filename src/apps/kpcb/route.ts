// Interactive routing helpers (pure): the corners between two clicks (45°, 90° or free), snapping to
// copper of the same net, and the live clearance check of the track being drawn.

import type { Pt, Shape } from './geom.ts'
import { shapeBox, shapeDist, shapeToRingDist, pointInPoly } from './geom.ts'
import { analyze } from './analysis.ts'
import { netClassOf, netOfPad, padShape, worldPads } from './board.ts'
import type { CopperId, Design } from './types.ts'

export type RouteMode = '45' | '90' | 'free'

export interface RouteState {
  net: string
  layer: CopperId
  width: number
  /** The committed corner points; the first is where the route started. */
  pts: Pt[]
  mode: RouteMode
  /** Which of the two ways to bend (toggled with the space bar). */
  flip: boolean
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** The points to add after `last` to reach `cursor`: one (straight) or two (a corner first). */
export function nextPoints(last: Pt, cursor: Pt, mode: RouteMode, flip: boolean): Pt[] {
  const dx = cursor.x - last.x
  const dy = cursor.y - last.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (mode === 'free' || near(ax, 0) || near(ay, 0)) return [cursor]
  if (mode === '90') return flip ? [{ x: last.x, y: cursor.y }, cursor] : [{ x: cursor.x, y: last.y }, cursor]
  if (near(ax, ay)) return [cursor]
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  if (ax > ay) {
    // along x, then diagonal (or diagonal first)
    return flip ? [{ x: last.x + sx * ay, y: cursor.y }, cursor] : [{ x: cursor.x - sx * ay, y: last.y }, cursor]
  }
  return flip ? [{ x: cursor.x, y: last.y + sy * ax }, cursor] : [{ x: last.x, y: cursor.y - sy * ax }, cursor]
}

export interface Snap {
  p: Pt
  net: string
  kind: 'pad' | 'via' | 'track'
  label: string
}

/** The copper under or next to a point that a route may start on or end at: pads, vias, track ends. */
export function copperAt(d: Design, p: Pt, tol: number, layer: CopperId): Snap | null {
  let best: (Snap & { score: number }) | null = null
  const consider = (s: Snap, dist: number) => {
    if (!best || dist < best.score) best = { ...s, score: dist }
  }
  for (const part of d.parts) {
    for (const pad of worldPads(part)) {
      if (!pad.layers.includes(layer)) continue
      const shape = padShape(pad)
      if (!shape) continue
      const dist = shapeDist({ core: [p], r: 0 }, shape)
      if (dist <= tol * 0.4) {
        const net = netOfPad(d, part.ref, pad.n)
        consider({ p: { x: pad.x, y: pad.y }, net, kind: 'pad', label: pad.label }, dist + 1)
      }
    }
  }
  for (const v of d.vias) {
    const dist = Math.hypot(v.x - p.x, v.y - p.y) - v.d / 2
    if (dist <= tol * 0.4) consider({ p: { x: v.x, y: v.y }, net: v.net, kind: 'via', label: 'via' }, dist)
  }
  for (const t of d.tracks) {
    if (t.layer !== layer) continue
    for (const e of [{ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }]) {
      const dist = Math.hypot(e.x - p.x, e.y - p.y)
      if (dist <= tol) consider({ p: e, net: t.net, kind: 'track', label: 'track end' }, dist - 0.5)
    }
  }
  if (!best) return null
  const { p: bp, net, kind, label } = best as Snap
  return { p: bp, net, kind, label }
}

export interface Clash {
  /** Where the clearance is not met. */
  at: Pt
  /** The gap that is there (negative: touching). */
  gap: number
  what: string
}

/**
 * Check segments of a track (a net, a layer, a width) against the copper of other nets, bare holes
 * and the board edge. Returns the first clash, or null when the track is fine.
 */
export function routeClash(d: Design, segs: ReadonlyArray<[Pt, Pt]>, layer: CopperId, width: number, net: string, ignore?: Pt): Clash | null {
  const clr = Math.max(d.rules.clearance, net ? netClassOf(d, net).clearance : 0)
  const an = analyze(d)
  const shapes: Shape[] = segs.map(([a, b]) => ({ core: [a, b], r: width / 2 }))
  for (const s of shapes) {
    const box = shapeBox(s, clr)
    for (const n of an.nodes) {
      if (n.kind === 'zone' || !n.layers.includes(layer)) continue
      if (net && n.net === net) continue
      if (n.box.x1 < box.x0 || n.box.x0 > box.x1 || n.box.y1 < box.y0 || n.box.y0 > box.y1) continue
      const gap = shapeDist(s, n.shape!)
      if (gap < clr - 1e-6) {
        // the copper the route starts on is not a clash
        if (ignore && shapeDist({ core: [ignore], r: 0 }, n.shape!) <= 1e-6) continue
        return { at: s.core[0], gap, what: n.kind === 'pad' ? `pad ${n.pad!.label}` : n.kind === 'via' ? 'a via' : `a track${n.net ? ` of ${n.net}` : ''}` }
      }
    }
    for (const h of bareHoles(d)) {
      const gap = shapeDist(s, h)
      if (gap < clr - 1e-6) return { at: s.core[0], gap, what: 'a hole' }
    }
    const ring = d.outline.pts
    if (ring.length >= 3) {
      if (!pointInPoly(s.core[0].x, s.core[0].y, ring) || !pointInPoly(s.core[s.core.length - 1].x, s.core[s.core.length - 1].y, ring)) return { at: s.core[0], gap: -1, what: 'the board edge' }
      const gap = shapeToRingDist(s, ring)
      if (gap < d.rules.edgeClearance - 1e-6) return { at: s.core[0], gap, what: 'the board edge' }
    }
  }
  return null
}

function bareHoles(d: Design): Shape[] {
  const out: Shape[] = d.holes.map((h) => ({ core: [{ x: h.x, y: h.y }], r: h.d / 2 }))
  for (const part of d.parts) for (const p of worldPads(part)) if (!p.plated && p.drill > 0) out.push({ core: [{ x: p.x, y: p.y }], r: p.drill / 2 })
  return out
}

/** The segments a route state would make with the next click at `cursor`. */
export function previewSegments(rs: RouteState, cursor: Pt): Array<[Pt, Pt]> {
  const last = rs.pts[rs.pts.length - 1]
  const pts = [last, ...nextPoints(last, cursor, rs.mode, rs.flip)]
  const out: Array<[Pt, Pt]> = []
  for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > 1e-9) out.push([pts[i], pts[i + 1]])
  return out
}
