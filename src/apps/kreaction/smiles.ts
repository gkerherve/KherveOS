// A small SMILES reader that only counts: atoms (with implicit hydrogens), charge and fragments of a SMILES
// string, so that a reaction can be checked for balance without RDKit. Organic subset, bracket atoms with
// hydrogens and charges, aromatic atoms, branches, rings and "." fragments. Pure functions.

import { isElement, type Counts } from './formula.ts'

export interface SmilesInfo {
  atoms: Counts
  charge: number
  /** Number of "."-separated fragments. */
  fragments: number
  /** Heavy atoms (no hydrogens). */
  heavy: number
}

const ORGANIC = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I'])
const AROMATIC = new Set(['b', 'c', 'n', 'o', 'p', 's', 'se', 'as'])
const VALENCES: Record<string, number[]> = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1],
}

interface PAtom {
  el: string
  aromatic: boolean
  bracket: boolean
  h: number
  charge: number
  bonds: number
  /** Number of neighbours. */
  deg: number
  /** Number of aromatic bonds (counted 1 each in `bonds`). */
  arom: number
}

/** Reads a SMILES string. Throws an Error with a readable message when it is not valid SMILES. */
export function readSmiles(input: string): SmilesInfo {
  const s = input.trim()
  if (s === '') throw new Error('Empty SMILES.')
  const atoms: PAtom[] = []
  const ring = new Map<number, { atom: number; order: number }>()
  const stack: number[] = []
  let prev = -1
  let bond: string | null = null
  let fragments = 1
  let i = 0

  const link = (a: number, b: number, sym: string | null) => {
    const A = atoms[a], B = atoms[b]
    let order: number
    let aromatic = false
    if (sym === '=') order = 2
    else if (sym === '#') order = 3
    else if (sym === '$') order = 4
    else if (sym === ':') { order = 1; aromatic = true }
    else if (sym === null && A.aromatic && B.aromatic) { order = 1; aromatic = true }
    else order = 1
    A.bonds += order
    B.bonds += order
    A.deg++
    B.deg++
    if (aromatic) { A.arom++; B.arom++ }
  }

  const addAtom = (a: PAtom) => {
    atoms.push(a)
    const idx = atoms.length - 1
    if (prev >= 0) link(prev, idx, bond)
    else if (bond !== null && bond !== '-' && bond !== '/' && bond !== '\\') throw new Error('A bond symbol cannot start a SMILES.')
    bond = null
    prev = idx
  }

  while (i < s.length) {
    const ch = s[i]
    if (ch === '[') {
      const end = s.indexOf(']', i)
      if (end < 0) throw new Error('Unclosed "[" in the SMILES.')
      const m = /^(\d+)?([A-Za-z][a-z]?)(@{1,2}(?:TH|AL|SP|TB|OH)?\d*)?(?:H(\d*))?([+-]{1,2}\d*|[+-]+)?(?::\d+)?$/.exec(s.slice(i + 1, end))
      if (!m) throw new Error(`"[${s.slice(i + 1, end)}]" is not a valid atom.`)
      let sym = m[2]
      let aromatic = false
      if (AROMATIC.has(sym.toLowerCase()) && sym[0] === sym[0].toLowerCase()) {
        aromatic = true
        sym = sym[0].toUpperCase() + sym.slice(1)
      }
      if (sym === 'D' || sym === 'T') sym = 'H'
      if (!isElement(sym)) throw new Error(`"${sym}" is not an element.`)
      let charge = 0
      if (m[5]) {
        const c = /^([+-])(\d+)?$/.exec(m[5])
        if (c) charge = (c[1] === '+' ? 1 : -1) * (c[2] ? Number(c[2]) : 1)
        else charge = (m[5][0] === '+' ? 1 : -1) * m[5].length
      }
      addAtom({ el: sym, aromatic, bracket: true, h: m[4] === undefined ? 0 : m[4] === '' ? 1 : Number(m[4]), charge, bonds: 0, deg: 0, arom: 0 })
      i = end + 1
      continue
    }
    if (ch === '(') {
      if (prev < 0) throw new Error('A branch needs an atom before it.')
      stack.push(prev)
      i++
      continue
    }
    if (ch === ')') {
      const p = stack.pop()
      if (p === undefined) throw new Error('Unmatched ")" in the SMILES.')
      prev = p
      bond = null
      i++
      continue
    }
    if (ch === '.') {
      prev = -1
      bond = null
      fragments++
      i++
      continue
    }
    if ('-=#$:/\\'.includes(ch)) {
      bond = ch
      i++
      continue
    }
    if (/\d/.test(ch) || ch === '%') {
      let n: number
      if (ch === '%') {
        const m = /^%(\d\d)/.exec(s.slice(i))
        if (!m) throw new Error('"%" must be followed by two digits.')
        n = Number(m[1])
        i += 3
      } else {
        n = Number(ch)
        i++
      }
      if (prev < 0) throw new Error('A ring number needs an atom before it.')
      const open = ring.get(n)
      if (open) {
        ring.delete(n)
        if (open.atom === prev) throw new Error('A ring cannot close on its own atom.')
        const sym = bond ?? (open.order === 2 ? '=' : open.order === 3 ? '#' : null)
        link(open.atom, prev, sym)
      } else {
        ring.set(n, { atom: prev, order: bond === '=' ? 2 : bond === '#' ? 3 : 1 })
        // the bond order given at the opening is applied when the ring closes
      }
      bond = null
      continue
    }
    // organic subset atoms
    const two = s.slice(i, i + 2)
    if (two === 'Cl' || two === 'Br') {
      addAtom({ el: two, aromatic: false, bracket: false, h: 0, charge: 0, bonds: 0, deg: 0, arom: 0 })
      i += 2
    } else if (ORGANIC.has(ch)) {
      addAtom({ el: ch, aromatic: false, bracket: false, h: 0, charge: 0, bonds: 0, deg: 0, arom: 0 })
      i++
    } else if (AROMATIC.has(ch)) {
      addAtom({ el: ch.toUpperCase(), aromatic: true, bracket: false, h: 0, charge: 0, bonds: 0, deg: 0, arom: 0 })
      i++
    } else {
      throw new Error(`Unexpected "${ch}" in the SMILES (put atoms like H, Na or Fe in brackets: [Na+]).`)
    }
  }
  if (stack.length) throw new Error('Unclosed "(" in the SMILES.')
  if (ring.size) throw new Error('A ring bond was opened but never closed.')
  if (bond !== null) throw new Error('The SMILES ends with a bond symbol.')

  const total: Counts = {}
  const bump = (el: string, n: number) => {
    if (n) total[el] = (total[el] ?? 0) + n
  }
  let charge = 0
  for (const a of atoms) {
    bump(a.el, 1)
    charge += a.charge
    if (a.bracket) {
      bump('H', a.h)
    } else {
      // implicit hydrogens: fill up to the lowest normal valence
      let used = a.bonds
      // a ring atom gives one π electron, except a three-connected N / P (pyrrole type) whose lone pair is in the ring
      if (a.aromatic && (a.el === 'C' || a.el === 'B' || ((a.el === 'N' || a.el === 'P') && a.deg < 3))) used += 1
      const vals = VALENCES[a.el] ?? []
      let target = vals.find((v) => v >= used)
      if (target === undefined) target = used
      bump('H', Math.max(0, target - used))
    }
  }
  return { atoms: total, charge, fragments, heavy: atoms.filter((a) => !(a.el === 'H' && a.bracket)).length }
}

/** True when `text` reads as SMILES (no RDKit involved). */
export function isSmiles(text: string): boolean {
  try {
    readSmiles(text)
    return true
  } catch {
    return false
  }
}
