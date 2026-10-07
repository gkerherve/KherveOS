// 2D representations of a molecular graph — the desktop's molrepr.py:
// skeletal / structural / Lewis / condensed, implicit hydrogens, Hill
// formula, lone-pair dots.

import { color as cpk, knownValence, valenceElectrons } from './elements.ts'
import type { Atom2D, Bond } from './types.ts'

export const MODES = ['skeletal', 'structural', 'lewis', 'condensed'] as const
export type Mode = (typeof MODES)[number]
export const MODE_LABELS: Record<Mode, string> = {
  skeletal: 'Skeletal',
  structural: 'Structural formula',
  lewis: 'Lewis structure',
  condensed: 'Condensed formula',
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'

/** *n* as Unicode subscript digits (1 renders as nothing). */
export function subscript(n: number): string {
  return n === 1 ? '' : String(n).replace(/\d/g, (d) => SUB[Number(d)])
}

type G = readonly (readonly [string, ...unknown[]])[]

export function bondOrders(atoms: G, bonds: readonly Bond[]): number[] {
  const total = atoms.map(() => 0)
  for (const [i, j, o] of bonds) {
    total[i] += o
    total[j] += o
  }
  return total
}

/** How many hydrogens each atom implies (its free valence, for elements with a known valence). */
export function implicitHydrogens(atoms: G, bonds: readonly Bond[]): number[] {
  const used = bondOrders(atoms, bonds)
  return atoms.map((a, i) => {
    const v = knownValence(a[0])
    return v ? Math.max(0, v - used[i]) : 0
  })
}

export function hillFormula(atoms: G, bonds: readonly Bond[] | null = null, implicit = true, unicode = true): string {
  const counts = new Map<string, number>()
  for (const a of atoms) counts.set(a[0], (counts.get(a[0]) ?? 0) + 1)
  if (implicit && bonds) {
    const extra = implicitHydrogens(atoms, bonds).reduce((s, n) => s + n, 0)
    if (extra) counts.set('H', (counts.get('H') ?? 0) + extra)
  }
  const order: string[] = []
  if (counts.has('C')) order.push('C')
  if (counts.has('H')) order.push('H')
  order.push(...[...counts.keys()].filter((e) => e !== 'C' && e !== 'H').sort())
  const sub = unicode ? subscript : (n: number) => (n === 1 ? '' : String(n))
  return order.map((e) => e + sub(counts.get(e)!)).join('')
}

export function lonePairs(element: string, usedOrder: number, implicitH = 0): number {
  const ve = valenceElectrons(element)
  if (ve === undefined) return 0
  return Math.max(0, Math.floor((ve - usedOrder - implicitH) / 2))
}

function bondAngles(idx: number, atoms: readonly Atom2D[], bonds: readonly Bond[]): number[] {
  const cx = atoms[idx][1], cy = atoms[idx][2]
  const out: number[] = []
  for (const [i, j] of bonds) {
    const k = i === idx ? j : j === idx ? i : null
    if (k !== null) out.push(Math.atan2(atoms[k][2] - cy, atoms[k][1] - cx))
  }
  return out
}

const wrap = (a: number) => {
  const t = (a + Math.PI) % (2 * Math.PI)
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI
}

/** Where atom *idx*'s lone-pair dots go: two per pair, farthest from any bond. */
export function dotPositions(idx: number, atoms: readonly Atom2D[], bonds: readonly Bond[], radius: number, spacing: number, pairs?: number): [number, number][] {
  if (pairs === undefined) {
    const used = bondOrders(atoms, bonds)[idx]
    const h = implicitHydrogens(atoms, bonds)[idx]
    pairs = lonePairs(atoms[idx][0], used, h)
  }
  if (pairs <= 0) return []
  const cx = atoms[idx][1], cy = atoms[idx][2]
  const used = bondAngles(idx, atoms, bonds)
  const clearance = (a: number) => (used.length ? Math.min(...used.map((u) => Math.abs(wrap(a - u)))) : Math.PI)
  const base: number[] = []
  for (let d = 0; d < 360; d += 30) base.push((d * Math.PI) / 180)
  // Python's sorted(…, reverse=True) is stable: equal clearances keep their order
  const cands = base.map((a, i) => ({ a, i, c: clearance(a) })).sort((p, q) => q.c - p.c || p.i - q.i).map((x) => x.a)
  const chosen: number[] = []
  for (const a of cands) {
    if (chosen.every((b) => Math.abs(wrap(a - b)) > (50 * Math.PI) / 180)) chosen.push(a)
    if (chosen.length === pairs) break
  }
  for (const a of cands) {
    if (chosen.length >= pairs) break
    if (!chosen.includes(a)) chosen.push(a)
  }
  const out: [number, number][] = []
  for (const a of chosen.slice(0, pairs)) {
    const bx = cx + Math.cos(a) * radius, by = cy + Math.sin(a) * radius
    const tx = -Math.sin(a), ty = Math.cos(a)
    for (const sign of [-1, 1]) out.push([bx + tx * spacing * sign, by + ty * spacing * sign])
  }
  return out
}

export function showsAllLabels(mode: string): boolean {
  return mode === 'structural' || mode === 'lewis'
}

// ------------------------------------------------------------ colours

export function hexRgb(color: string): [number, number, number] {
  let h = color.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(2)
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** model._mix: blend hex colour *a* toward *b* by *t*. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexRgb(a), cb = hexRgb(b)
  const c = [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** QColor.lightnessF. */
export function lightnessF(color: string): number {
  const c = hexRgb(color)
  return (Math.max(...c) + Math.min(...c)) / 2 / 255
}

/** Perceived brightness 0..1 (elements.text_color / atom_specs). */
export function luma(color: string): number {
  const [r, g, b] = hexRgb(color)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** QColor.darker(factor): HSV value divided by factor/100. */
export function darker(color: string, factor = 200): string {
  const [r, g, b] = hexRgb(color).map((v) => v / 255)
  const k = 100 / factor
  return '#' + [r, g, b].map((v) => Math.round(Math.min(1, v * k) * 255).toString(16).padStart(2, '0')).join('')
}

/** QColor.lighter(factor): HSV value times factor/100; past white the saturation drops. */
export function lighter(color: string, factor = 150): string {
  let [r, g, b] = hexRgb(color).map((v) => v / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  let v = mx
  let s = mx > 0 ? (mx - mn) / mx : 0
  // hue from rgb
  let h = 0
  if (mx !== mn) {
    const d = mx - mn
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (mx === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  v = (v * factor) / 100
  if (v > 1) {
    s = Math.max(0, s - (v - 1))
    v = 1
  }
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  ;[r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6]
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

/** molrepr.label_color: C and H black; pale heteroatoms darkened. */
export function labelColor(element: string): string {
  if (element === 'C' || element === 'H') return '#1a1a1a'
  const c = cpk(element)
  return lightnessF(c) > 0.5 ? mix(c, '#000000', 0.45) : c
}
