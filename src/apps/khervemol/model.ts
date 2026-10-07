// The parts of the desktop's model.py the view needs at once (no round trip
// to Python): the isometric projection, distances and angles, valence
// checks for the menus, and the atom drag with locked bond lengths.
// Everything that changes the structure's chemistry stays in Python.

import { bondLength, valence } from './elements.ts'
import type { Atom, Bond, Vec3 } from './types.ts'

export const DEFAULT_AZ = (28 * Math.PI) / 180
export const DEFAULT_EL = (20 * Math.PI) / 180

/** model._proj: (screen x, screen y growing down, depth toward the viewer). */
export function proj(x: number, y: number, z: number, az = DEFAULT_AZ, el = DEFAULT_EL): Vec3 {
  const ca = Math.cos(az), sa = Math.sin(az)
  const ce = Math.cos(el), se = Math.sin(el)
  const xr = x * ca - y * sa
  const yr = x * sa + y * ca
  return [xr, yr * se - z * ce, yr * ce + z * se]
}

const norm = (v: Vec3) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
function unit(v: Vec3): Vec3 {
  const n = norm(v) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

export function centroid(atoms: readonly Atom[]): Vec3 {
  const n = atoms.length || 1
  let x = 0, y = 0, z = 0
  for (const a of atoms) {
    x += a[1]
    y += a[2]
    z += a[3]
  }
  return [x / n, y / n, z / n]
}

export function distance(atoms: readonly Atom[], i: number, j: number): number {
  return norm([atoms[j][1] - atoms[i][1], atoms[j][2] - atoms[i][2], atoms[j][3] - atoms[i][3]])
}

/** The i–j–k angle in degrees, at j. */
export function angle(atoms: readonly Atom[], i: number, j: number, k: number): number {
  const u = unit([atoms[i][1] - atoms[j][1], atoms[i][2] - atoms[j][2], atoms[i][3] - atoms[j][3]])
  const v = unit([atoms[k][1] - atoms[j][1], atoms[k][2] - atoms[j][2], atoms[k][3] - atoms[j][3]])
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))
  return (Math.acos(dot) * 180) / Math.PI
}

export function bondBetween(bonds: readonly Bond[], i: number, j: number): number | null {
  for (let b = 0; b < bonds.length; b++) {
    const [x, y] = bonds[b]
    if ((x === i && y === j) || (x === j && y === i)) return b
  }
  return null
}

export function usedValence(bonds: readonly Bond[], index: number): number {
  let n = 0
  for (const [i, j, o] of bonds) if (i === index || j === index) n += o
  return n
}

export function freeValence(atoms: readonly Atom[], bonds: readonly Bond[], index: number): number {
  return valence(atoms[index][0]) - usedValence(bonds, index)
}

export function canBond(atoms: readonly Atom[], bonds: readonly Bond[], i: number, j: number, order = 1): boolean {
  if (i === j || bondBetween(bonds, i, j) !== null) return false
  return freeValence(atoms, bonds, i) >= order && freeValence(atoms, bonds, j) >= order
}

export function canSetBondOrder(atoms: readonly Atom[], bonds: readonly Bond[], bondIndex: number, order: number): boolean {
  const [i, j, old] = bonds[bondIndex]
  const delta = order - old
  if (delta <= 0) return order >= 1
  return freeValence(atoms, bonds, i) >= delta && freeValence(atoms, bonds, j) >= delta
}

/** Atoms reachable from *start* without crossing bond *skip*. */
export function fragment(bonds: readonly Bond[], start: number, skip: number): Set<number> {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (let b = 0; b < bonds.length; b++) {
      if (b === skip) continue
      const [i, j] = bonds[b]
      const k = i === cur ? j : j === cur ? i : null
      if (k !== null && !seen.has(k)) {
        seen.add(k)
        stack.push(k)
      }
    }
  }
  return seen
}

export function movingFragment(bonds: readonly Bond[], atom: number, oldBond: number | null): Set<number> {
  return fragment(bonds, atom, oldBond === null ? -1 : oldBond)
}

export function canReattach(atoms: readonly Atom[], bonds: readonly Bond[], atom: number, oldBond: number | null, anchor: number, order = 1): boolean {
  if (atom === anchor || anchor < 0 || anchor >= atoms.length) return false
  if (oldBond !== null && (bonds[oldBond][0] === anchor || bonds[oldBond][1] === anchor)) return false
  if (movingFragment(bonds, atom, oldBond).has(anchor)) return false
  const freed = oldBond !== null ? bonds[oldBond][2] : 0
  return freeValence(atoms, bonds, atom) + freed >= order && freeValence(atoms, bonds, anchor) >= order
}

/** model.constrain_atom: pull atom *index* back onto every ideal bond length (only it moves). */
export function constrainAtom(atoms: Atom[], bonds: readonly Bond[], index: number, iterations = 24) {
  const links: [number, number][] = []
  for (const [i, j, o] of bonds) if (i === index || j === index) links.push([i === index ? j : i, o])
  if (!links.length) return
  const a = atoms[index]
  for (let it = 0; it < iterations; it++) {
    let worst = 0
    for (const [k, order] of links) {
      const target = bondLength(a[0], atoms[k][0], order)
      let v: Vec3 = [a[1] - atoms[k][1], a[2] - atoms[k][2], a[3] - atoms[k][3]]
      let d = norm(v)
      if (d < 1e-9) {
        v = [1, 0, 0]
        d = 1
      }
      const error = target - d
      worst = Math.max(worst, Math.abs(error))
      a[1] += (v[0] / d) * error
      a[2] += (v[1] / d) * error
      a[3] += (v[2] / d) * error
    }
    if (worst < 1e-6) break
  }
}

/** model.drag_atom: move atom *index* by a screen delta; with *bonds* its bond lengths stay chemical. */
export function dragAtom(atoms: Atom[], index: number, dsx: number, dsy: number, az: number, el: number, bond: number, scale: number, bonds: readonly Bond[] | null) {
  const ca = Math.cos(az), sa = Math.sin(az)
  const ce = Math.cos(el), se = Math.sin(el)
  const r: Vec3 = [ca, -sa, 0]
  const g: Vec3 = [sa * se, ca * se, -ce]
  const k = 1 / (scale * (bond || 1))
  const a = atoms[index]
  a[1] += (dsx * r[0] + dsy * g[0]) * k
  a[2] += (dsx * r[1] + dsy * g[1]) * k
  a[3] += (dsx * r[2] + dsy * g[2]) * k
  if (bonds) constrainAtom(atoms, bonds, index)
}

/** Molecule.formula: Hill order, counting the atoms drawn. */
export function formula(atoms: readonly Atom[]): string {
  const counts = new Map<string, number>()
  for (const a of atoms) counts.set(a[0], (counts.get(a[0]) ?? 0) + 1)
  const order: string[] = []
  if (counts.has('C')) order.push('C')
  if (counts.has('H')) order.push('H')
  order.push(...[...counts.keys()].filter((e) => e !== 'C' && e !== 'H').sort())
  return order.map((e) => e + (counts.get(e)! > 1 ? String(counts.get(e)) : '')).join('')
}

export function cloneAtoms(atoms: readonly Atom[]): Atom[] {
  return atoms.map((a) => [...a] as Atom)
}
