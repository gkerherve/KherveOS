// Colours, coordination polyhedra and the colour legend — the desktop's
// molcolor.py (and lattices.coordination_faces).

import { color as cpk, name as elementName } from './elements.ts'
import type { Atom, Bond, Vec3 } from './types.ts'

export const SITE_COLORS = { body: '#2f6fed', face: '#e0705a', inner: '#8e63d6', mid: '#43a047' }
export const SITE_LABELS: Record<string, string> = {
  [SITE_COLORS.body]: 'body centre',
  [SITE_COLORS.face]: 'face centre',
  [SITE_COLORS.inner]: 'interior site',
  [SITE_COLORS.mid]: 'middle layer',
}

export function tint(atom: Atom): string | null {
  return atom.length > 4 && atom[4] ? (atom[4] as string) : null
}

/** The colour-map key: element + site tint ("Fe" vs "Fe@#2f6fed"). */
export function colorKey(atom: Atom): string {
  const t = tint(atom)
  return t ? `${atom[0]}@${t}` : String(atom[0])
}

/** The colour an atom is drawn in: override > tint > CPK. */
export function atomColor(atom: Atom, colors?: Record<string, string> | null): string {
  const over = colors?.[colorKey(atom)]
  if (over) return over
  return tint(atom) || cpk(atom[0])
}

export function applyColors(atoms: readonly Atom[], colors: Record<string, string> | null | undefined): Atom[] {
  if (!colors || !Object.keys(colors).length) return atoms as Atom[]
  return atoms.map((a) => {
    const over = colors[colorKey(a)]
    return over ? ([a[0], a[1], a[2], a[3], over] as Atom) : ([...a] as Atom)
  })
}

/** lattices.coordination_faces: the convex-hull faces of a small point set, each an ordered vertex list. */
export function coordinationFaces(pts: readonly Vec3[], eps = 1e-6): Vec3[][] {
  const n = pts.length
  if (n < 3) return []
  const faces: Vec3[][] = []
  const seen = new Set<string>()
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const a = pts[i], b = pts[j], c = pts[k]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        let nrm: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const ln = Math.hypot(nrm[0], nrm[1], nrm[2])
        if (ln < eps) continue
        nrm = [nrm[0] / ln, nrm[1] / ln, nrm[2] / ln]
        const d0 = nrm[0] * a[0] + nrm[1] * a[1] + nrm[2] * a[2]
        const sides = pts.map((p) => nrm[0] * p[0] + nrm[1] * p[1] + nrm[2] * p[2] - d0)
        if (Math.max(...sides) > eps && Math.min(...sides) < -eps) continue
        const on: number[] = []
        sides.forEach((s, m) => Math.abs(s) <= eps && on.push(m))
        const key = on.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        const fpts = on.map((m) => pts[m])
        const fc: Vec3 = [0, 1, 2].map((d) => fpts.reduce((s, p) => s + p[d], 0) / fpts.length) as Vec3
        let ref: Vec3 = [fpts[0][0] - fc[0], fpts[0][1] - fc[1], fpts[0][2] - fc[2]]
        const rl = Math.hypot(ref[0], ref[1], ref[2]) || 1
        ref = [ref[0] / rl, ref[1] / rl, ref[2] / rl]
        const side: Vec3 = [nrm[1] * ref[2] - nrm[2] * ref[1], nrm[2] * ref[0] - nrm[0] * ref[2], nrm[0] * ref[1] - nrm[1] * ref[0]]
        const ang = (p: Vec3) => {
          const w = [p[0] - fc[0], p[1] - fc[1], p[2] - fc[2]]
          return Math.atan2(w[0] * side[0] + w[1] * side[1] + w[2] * side[2], w[0] * ref[0] + w[1] * ref[1] + w[2] * ref[2])
        }
        faces.push([...fpts].sort((p, q) => ang(p) - ang(q)))
      }
  return faces
}

/** For every atom with ≥4 bonded neighbours, the hull faces of its shell, in the centre's colour. */
export function coordinationPolyhedra(atoms: readonly Atom[], bonds: readonly Bond[], colors?: Record<string, string> | null): [Vec3[], string][] {
  const neigh = new Map<number, Set<number>>()
  for (const b of bonds) {
    const [i, j] = b
    if (!neigh.has(i)) neigh.set(i, new Set())
    if (!neigh.has(j)) neigh.set(j, new Set())
    neigh.get(i)!.add(j)
    neigh.get(j)!.add(i)
  }
  const out: [Vec3[], string][] = []
  for (const [centre, ns] of neigh) {
    if (ns.size < 4) continue
    const pts = [...ns].sort((x, y) => x - y).map((k) => [atoms[k][1], atoms[k][2], atoms[k][3]] as Vec3)
    const col = atomColor(atoms[centre], colors)
    for (const face of coordinationFaces(pts)) out.push([face, col])
  }
  return out
}

export function hasPolyhedra(bonds: readonly Bond[]): boolean {
  const count = new Map<number, number>()
  for (const b of bonds) for (const k of [b[0], b[1]]) count.set(k, (count.get(k) ?? 0) + 1)
  for (const v of count.values()) if (v >= 4) return true
  return false
}

export interface LegendEntry {
  element: string
  label: string
  color: string
}

/** One row per distinct colour drawn. */
export function legendEntries(atoms: readonly Atom[], colors?: Record<string, string> | null): LegendEntry[] {
  const out: LegendEntry[] = []
  const seen = new Set<string>()
  for (const a of atoms) {
    const over = colors?.[colorKey(a)]
    const col = atomColor(a, colors)
    const key = `${a[0]}|${col}`
    if (seen.has(key)) continue
    seen.add(key)
    let label = `${a[0]} — ${elementName(a[0])}`
    const t = tint(a)
    const site = !over && t ? SITE_LABELS[t] : undefined
    if (site) label += ` (${site})`
    out.push({ element: a[0], label, color: col })
  }
  return out
}
