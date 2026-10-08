// "Place all parts" (pure): lays components out in rows inside the board, in an order that keeps
// parts that share nets side by side (the strongest-connected part first, then always the part most
// connected to those already placed). Parts that do not fit go in rows below the board.

import type { Box } from './geom.ts'
import { designBox, outlineBox, partBox } from './board.ts'
import { getFootprint } from './footprints.ts'
import type { Design, Part } from './types.ts'

export interface ArrangeOptions {
  /** Which parts to place (default: all that are not locked). */
  refs?: string[]
  /** Gap between courtyards in mm (default 1.6: room for the reference text). */
  spacing?: number
  /** Grid for the part origins (default 0.5). */
  grid?: number
}

/** Pairwise connection strength of parts: nets with few pins count more than power rails. */
export function connectivity(d: Design): Map<string, Map<string, number>> {
  const w = new Map<string, Map<string, number>>()
  const bump = (a: string, b: string, v: number) => {
    const m = w.get(a) ?? new Map<string, number>()
    m.set(b, (m.get(b) ?? 0) + v)
    w.set(a, m)
  }
  for (const n of d.nets) {
    const refs = [...new Set(n.pins.map((p) => p.ref))]
    if (refs.length < 2) continue
    const v = 1 / (refs.length - 1)
    for (const a of refs) for (const b of refs) if (a !== b) bump(a, b, v)
  }
  return w
}

export function arrangeParts(d: Design, opts: ArrangeOptions = {}): Design {
  const spacing = opts.spacing ?? 1.6
  const grid = opts.grid ?? 0.5
  const wanted = new Set(opts.refs ?? d.parts.filter((p) => !p.locked).map((p) => p.ref))
  const moving = d.parts.filter((p) => wanted.has(p.ref) && !p.locked)
  if (!moving.length) return d
  const fixed = d.parts.filter((p) => !wanted.has(p.ref) || p.locked)

  // order: most connected first, then the part most tied to those placed
  const conn = connectivity(d)
  const strength = (p: Part) => [...(conn.get(p.ref)?.values() ?? [])].reduce((a, b) => a + b, 0)
  const size = (p: Part) => {
    const b = partBox(p)
    return (b.x1 - b.x0) * (b.y1 - b.y0)
  }
  const left = [...moving].sort((a, b) => strength(b) - strength(a) || size(b) - size(a) || (a.ref < b.ref ? -1 : 1))
  const order: Part[] = []
  while (left.length) {
    let bi = 0
    if (order.length) {
      let best = -1
      left.forEach((p, i) => {
        const s = order.reduce((acc, q) => acc + (conn.get(p.ref)?.get(q.ref) ?? 0), 0)
        if (s > best + 1e-9) {
          best = s
          bi = i
        }
      })
    }
    order.push(left.splice(bi, 1)[0])
  }

  const ob = outlineBox(d)
  const board: Box = ob ?? designBox(d) ?? { x0: 0, y0: 0, x1: 60, y1: 40 }
  const inset = d.rules.edgeClearance + 1.5
  const area: Box = { x0: board.x0 + inset, y0: board.y0 + inset, x1: board.x1 - inset, y1: board.y1 - inset }
  const placed: Box[] = fixed.map((p) => partBox(p))
  const snapUp = (v: number) => Math.ceil(v / grid - 1e-9) * grid
  const out = new Map<string, Part>()
  let cx = area.x0
  let cy = area.y0
  let rowH = 0
  let staging = false
  const hit = (b: Box): Box | undefined => placed.find((o) => b.x0 < o.x1 + spacing - 1e-6 && b.x1 > o.x0 - spacing + 1e-6 && b.y0 < o.y1 + spacing - 1e-6 && b.y1 > o.y0 - spacing + 1e-6)

  for (const p of order) {
    const b0 = partBox({ ...p, x: 0, y: 0 })
    const w = b0.x1 - b0.x0
    const h = b0.y1 - b0.y0
    for (let guard = 0; guard < 10_000; guard++) {
      const x0 = snapUp(cx + -b0.x0) + b0.x0
      const y0 = snapUp(cy + -b0.y0) + b0.y0
      const box: Box = { x0, y0, x1: x0 + w, y1: y0 + h }
      if (!staging && box.x1 > area.x1 + 1e-9 && cx > area.x0) {
        cx = area.x0
        cy += rowH + spacing
        rowH = 0
        continue
      }
      if (!staging && box.y1 > area.y1 + 1e-9) {
        staging = true
        cx = board.x0
        cy = board.y1 + 4
        rowH = 0
        continue
      }
      if (staging && box.x1 > board.x1 + 20 && cx > board.x0) {
        cx = board.x0
        cy += rowH + spacing
        rowH = 0
        continue
      }
      const o = hit(box)
      if (o) {
        cx = Math.max(cx + grid, o.x1 + spacing)
        continue
      }
      out.set(p.id, { ...p, x: Math.round((x0 - b0.x0) * 1000) / 1000, y: Math.round((y0 - b0.y0) * 1000) / 1000, rot: p.rot, stale: p.stale })
      placed.push(box)
      cx = box.x1 + spacing
      rowH = Math.max(rowH, h)
      break
    }
  }
  return { ...d, parts: d.parts.map((p) => out.get(p.id) ?? p) }
}

/** Parts in the design whose footprint is not in the library. */
export const unknownFootprints = (d: Design): string[] => [...new Set(d.parts.filter((p) => !getFootprint(p.fp)).map((p) => p.fp))]

/** A board size (mm, multiples of 5) that holds these parts with room to route: about 3 times their courtyards (rows waste space). */
export function suggestBoardSize(d: Design): { w: number; h: number } {
  let area = 0
  for (const p of d.parts) {
    const b = partBox({ ...p, x: 0, y: 0 })
    area += (b.x1 - b.x0 + 1.6) * (b.y1 - b.y0 + 1.6)
  }
  const want = Math.max(30 * 20, area * 3 + 150)
  const w = Math.max(30, Math.ceil(Math.sqrt(want * 1.4) / 5) * 5)
  const h = Math.max(20, Math.ceil(want / w / 5) * 5)
  return { w, h }
}
