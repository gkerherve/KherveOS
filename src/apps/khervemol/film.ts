// The reaction film — the desktop's rxanim.Animation playback (the atom
// mapping is worked out once by the engine; kmweb/bridge.py op_animation),
// and the moves of molecules lying on a surface (adsorbates.py).

import type { Atom, Bond, Group, Mol, Note, Vec3 } from './types.ts'

export interface FilmData {
  title: string
  elements: string[]
  reac_spread: Vec3[]
  reac_packed: Vec3[]
  prod_spread: Vec3[]
  prod_packed: Vec3[]
  prod_mols: number[]
  pi: number[]
  rbonds: Bond[]
  pbonds: Bond[]
  top: number
  bottom: number
  left: number
  right: number
  phases: [number, number]
  break: number
  form: number
  arc: number
  duration: number
}

const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t))
  return t * t * (3 - 2 * t)
}
const lerp = (p: Vec3, q: Vec3, s: number): Vec3 => [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s]

export function stage(f: FilmData, p: number): string {
  if (p < f.phases[0]) return 'Reactants approach'
  if (p < f.break) return 'Bonds break'
  if (p < f.form) return 'Atoms rearrange'
  if (p < f.phases[1]) return 'New bonds form'
  return 'Products separate'
}

/** Where reactant atom *i* is at progress *p*. */
export function position(f: FilmData, i: number, p: number): Vec3 {
  const a = f.reac_spread[i], b = f.reac_packed[i]
  const pj = f.pi[i]
  const c = f.prod_packed[pj], d = f.prod_spread[pj]
  const [t1, t2] = f.phases
  if (p <= t1) return lerp(a, b, smooth(p / t1))
  if (p <= t2) {
    const s = (p - t1) / (t2 - t1)
    const [x, y, z] = lerp(b, c, smooth(s))
    const side = f.prod_mols[pj] % 2 ? 1 : -1
    return [x, y, z + side * f.arc * Math.sin(Math.PI * s)]
  }
  return lerp(c, d, smooth((p - t2) / (1 - t2)))
}

export function bondsAt(f: FilmData, p: number): Bond[] {
  if (p < f.break) return f.rbonds.map((b) => [...b] as Bond)
  if (p >= f.form) return f.pbonds.map((b) => [...b] as Bond)
  const key = (b: Bond) => (b[0] < b[1] ? `${b[0]},${b[1]}` : `${b[1]},${b[0]}`)
  const keep = new Set(f.pbonds.map(key))
  return f.rbonds.filter((b) => keep.has(key(b))).map((b) => [...b] as Bond)
}

export function notesAt(f: FilmData, p: number): Note[] {
  const mid = (f.left + f.right) / 2
  return [
    { kind: 'text', text: f.title, pos: [mid, 0, f.top], size: 1.5, color: '#22303c', bold: true },
    { kind: 'text', text: stage(f, p), pos: [mid, 0, f.bottom], size: 1.1, color: '#159c74', bold: true },
    { kind: 'text', text: '', pos: [f.left, 0, f.top] },
    { kind: 'text', text: '', pos: [f.right, 0, f.top] },
    { kind: 'text', text: '', pos: [mid, 0, f.bottom - 0.5] },
  ]
}

/** Animation.apply: the scene at progress *p* (reactant atoms only). */
export function frame(mol: Mol, f: FilmData, p: number): Mol {
  p = Math.max(0, Math.min(1, p))
  const atoms: Atom[] = f.elements.map((el, i) => [el, ...position(f, i, p)] as Atom)
  return { ...mol, atoms, bonds: bondsAt(f, p), notes: notesAt(f, p), formula: mol.formula }
}

// ------------------------------------------------------------- adsorbates

export function groupOf(groups: readonly Group[], atom: number | null): number | null {
  if (atom === null) return null
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (g.start <= atom && atom < g.start + g.count) return gi
  }
  return null
}

function members(g: Group): number[] {
  return Array.from({ length: g.count }, (_x, k) => g.start + k)
}

export function groupCentroid(atoms: readonly Atom[], g: Group): Vec3 {
  const idx = members(g)
  return [1, 2, 3].map((d) => idx.reduce((s, i) => s + (atoms[i][d] as number), 0) / idx.length) as Vec3
}

/** adsorbates.pose: centre x, y and the lowest atom's height above the top slab layer. */
export function pose(atoms: readonly Atom[], groups: readonly Group[], gi: number): { x: number; y: number; height: number } {
  const grouped = new Set(groups.flatMap(members))
  let top = -Infinity
  atoms.forEach((a, i) => !grouped.has(i) && (top = Math.max(top, a[3])))
  const g = groups[gi]
  const [cx, cy] = groupCentroid(atoms, g)
  return { x: cx, y: cy, height: Math.min(...members(g).map((i) => atoms[i][3])) - top }
}

function translate(atoms: Atom[], g: Group, dx: number, dy: number, dz: number) {
  for (const i of members(g)) {
    atoms[i][1] += dx
    atoms[i][2] += dy
    atoms[i][3] += dz
  }
}

/** adsorbates.drag: slide a group over the surface by a screen drag (or lift it). */
export function dragGroup(atoms: Atom[], g: Group, dsx: number, dsy: number, az: number, el: number, bond: number, scale: number, vertical = false) {
  const ca = Math.cos(az), sa = Math.sin(az)
  const ce = Math.cos(el), se = Math.sin(el)
  const k = 1 / (scale * (bond || 1))
  const a = dsx * k, b = dsy * k
  if (vertical || Math.abs(se) < 0.15) {
    const dz = Math.abs(ce) > 1e-6 ? -b / ce : 0
    translate(atoms, g, vertical ? 0 : a * ca, vertical ? 0 : -a * sa, dz)
    return
  }
  const u = b / se
  translate(atoms, g, ca * a + sa * u, -sa * a + ca * u, 0)
}
