// Chemistry tools (chemistry.py and the chem parts of canvas.py): bonds
// drawn at a fixed length on 30° steps, rings, and atom labels that snap
// onto a bond's end. Everything comes out as ordinary editable items.

import type { Brush, Item, PathCmd, Pen, Pt } from './model'
import { base } from './model'
import { apply, matrixOf, PathBuilder } from './geom'
import { layoutText } from './text'

/** Labels offered by the atom tool. */
export const ATOMS = ['C', 'H', 'O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'OH', 'CH3', 'CH2', 'NH2', 'COOH', 'R']

export type BondKind = 'single' | 'double' | 'triple' | 'wedge' | 'hash' | 'hbond'
export type RingKind = 'benzene' | 'cyclohexane' | 'cyclopentane'

const perp = (p1: Pt, p2: Pt): Pt => {
  const a = Math.atan2(p2.y - p1.y, p2.x - p1.x)
  return { x: Math.sin(a), y: -Math.cos(a) }
}

/** A bond as path commands: one line, parallel lines, or a hashed wedge of ticks. */
export function bondPath(kind: BondKind, p1: Pt, p2: Pt, gap: number): PathCmd[] {
  const b = new PathBuilder()
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (len < 1) return b.cmds
  const n = perp(p1, p2)
  const seg = (a: Pt, c: Pt) => {
    b.moveTo(a.x, a.y)
    b.lineTo(c.x, c.y)
  }
  const off = (p: Pt, k: number): Pt => ({ x: p.x + n.x * k, y: p.y + n.y * k })
  if (kind === 'single') seg(p1, p2)
  else if (kind === 'double') for (const k of [gap * 0.5, -gap * 0.5]) seg(off(p1, k), off(p2, k))
  else if (kind === 'triple') for (const k of [gap, 0, -gap]) seg(off(p1, k), off(p2, k))
  else if (kind === 'hash') {
    const count = Math.max(3, Math.trunc(len / Math.max(gap * 1.6, 1)))
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1)
      const c = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t }
      const w = gap * 0.4 + gap * 1.4 * t // widens toward p2
      seg(off(c, -w), off(c, w))
    }
  } else if (kind === 'hbond') {
    // Dashes as geometry, so they survive SVG (no pen dash).
    const u = { x: (p2.x - p1.x) / len, y: (p2.y - p1.y) / len }
    const dash = Math.max(gap * 1.4, 4)
    const space = Math.max(gap, 3)
    for (let d = 0; d < len; d += dash + space) {
      const e = Math.min(d + dash, len)
      seg({ x: p1.x + u.x * d, y: p1.y + u.y * d }, { x: p1.x + u.x * e, y: p1.y + u.y * e })
    }
  }
  return b.cmds
}

/** A solid stereo bond: a triangle, narrow at p1 and wide at p2. */
export function wedgePolygon(p1: Pt, p2: Pt, gap: number): [number, number][] {
  const n = perp(p1, p2)
  return [[p1.x, p1.y], [p2.x + n.x * gap, p2.y + n.y * gap], [p2.x - n.x * gap, p2.y - n.y * gap]]
}

/** Spacing of multiple-bond lines (and a wedge's half-width), from the stroke width. */
export const chemGap = (penWidth: number) => Math.max(3, penWidth * 2 + 2)

/** ChemDraw-style: the bond end at the set length from `start`, toward the pointer, on 30° steps. */
export function chemConstrain(start: Pt, pos: Pt, bondLengthMm: number, dpi: number): Pt {
  const dx = pos.x - start.x
  const dy = pos.y - start.y
  if (!dx && !dy) return { ...start }
  const step = Math.PI / 6
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  const len = (bondLengthMm / 25.4) * dpi
  return { x: start.x + len * Math.cos(a), y: start.y + len * Math.sin(a) }
}

/** The item a bond tool draws between p1 and p2. */
export function bondItem(kind: BondKind, p1: Pt, p2: Pt, pen: Pen, id?: number): Item {
  const common = { ...base(), ...(id != null ? { _id: id } : {}) }
  const gap = chemGap(pen.width)
  if (kind === 'wedge') {
    return { ...common, type: 'polygon', kind: 'polygon', pen: { color: pen.color, width: 1 }, brush: { color: pen.color }, points: wedgePolygon(p1, p2, gap) }
  }
  return { ...common, type: 'path', pen: { ...pen }, brush: null, cmds: bondPath(kind, p1, p2, gap) }
}

/** A ring (regular polygon, vertex up) of about 6 mm radius; benzene gets its inner circle. */
export function ringItem(kind: RingKind, c: Pt, dpi: number, pen: Pen, brush: Brush): Item {
  const r = (6 / 25.4) * dpi
  const sides = kind === 'cyclopentane' ? 5 : 6
  const points: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    points.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)])
  }
  const ring: Item = { ...base(), type: 'polygon', kind: sides === 5 ? 'pentagon' : 'hexagon', pen: { ...pen }, brush, points }
  if (kind !== 'benzene') return ring
  const ir = r * 0.55
  const circle: Item = { ...base(), type: 'ellipse', pen: { ...pen }, brush: null, x: c.x - ir, y: c.y - ir, w: 2 * ir, h: 2 * ir, z: 1 }
  return { ...base(), type: 'group', children: [ring, circle] }
}

/** The nearest bond end (line or path point) within `tol` of p, for atom labels. */
export function nearestBondEnd(items: Item[], p: Pt, tol: number): Pt | null {
  let best: Pt | null = null
  let bestD = tol
  for (const it of items) {
    const m = matrixOf(it)
    let pts: Pt[] = []
    if (it.type === 'line' || it.type === 'arrow') pts = [{ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }]
    else if (it.type === 'path') pts = it.cmds.map((c) => (c[0] === 'C' ? { x: c[5], y: c[6] } : { x: c[1], y: c[2] }))
    for (const q of pts) {
      const s = apply(m, q)
      const d = Math.hypot(s.x - p.x, s.y - p.y)
      if (d < bestD) {
        best = s
        bestD = d
      }
    }
  }
  return best
}

/** An atom label centred on `c` (snapped to a bond end nearby). */
export function atomItem(text: string, c: Pt, items: Item[], bondLengthMm: number, dpi: number, color: string): Item {
  const anchor = nearestBondEnd(items, c, (bondLengthMm / 25.4) * dpi * 0.4) ?? c
  const it: Item = { ...base(), type: 'text', text: text || 'C', color, family: 'Segoe UI', size: 14, bold: false, italic: false }
  const l = layoutText(it.text, { family: it.family, size: it.size })
  return { ...it, pos: { x: anchor.x - l.boxW / 2, y: anchor.y - l.boxH / 2 } }
}
