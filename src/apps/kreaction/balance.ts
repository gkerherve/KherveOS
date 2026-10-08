// Balancing a chemical equation with exact arithmetic: the null space of the (element + charge) × species
// matrix is computed with BigInt fractions; the smallest whole-number coefficients come out of it. Explains
// the cases that cannot be balanced or that have several solutions. Pure functions.

import { hillFormula, molarMass, type Counts } from './formula.ts'

/** What the balancer needs to know about a species. */
export interface BalSpecies {
  label: string
  atoms: Counts
  charge: number
}

// ------------------------------------------------------------------ exact fractions

export interface Frac {
  n: bigint
  d: bigint
}

const babs = (a: bigint) => (a < 0n ? -a : a)
export function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a)
  b = babs(b)
  while (b) [a, b] = [b, a % b]
  return a
}
export const frac = (n: bigint | number, d: bigint | number = 1n): Frac => {
  let N = BigInt(n)
  let D = BigInt(d)
  if (D === 0n) throw new Error('Division by zero.')
  if (D < 0n) {
    N = -N
    D = -D
  }
  const g = bgcd(N, D) || 1n
  return { n: N / g, d: D / g }
}
const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d)
const div = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n)
const isZero = (a: Frac) => a.n === 0n

/** Basis of the null space of an integer matrix (rows × cols), as fraction vectors. */
export function nullSpace(matrix: number[][], cols: number): Frac[][] {
  const m: Frac[][] = matrix.map((row) => row.map((x) => frac(x)))
  const pivots: number[] = []
  let r = 0
  for (let c = 0; c < cols && r < m.length; c++) {
    let p = r
    while (p < m.length && isZero(m[p][c])) p++
    if (p === m.length) continue
    ;[m[r], m[p]] = [m[p], m[r]]
    const pv = m[r][c]
    m[r] = m[r].map((x) => div(x, pv))
    for (let i = 0; i < m.length; i++) {
      if (i === r || isZero(m[i][c])) continue
      const f = m[i][c]
      m[i] = m[i].map((x, j) => sub(x, mul(f, m[r][j])))
    }
    pivots.push(c)
    r++
  }
  const free: number[] = []
  for (let c = 0; c < cols; c++) if (!pivots.includes(c)) free.push(c)
  return free.map((f) => {
    const v: Frac[] = Array.from({ length: cols }, () => frac(0))
    v[f] = frac(1)
    pivots.forEach((pc, row) => {
      v[pc] = sub(frac(0), m[row][f])
    })
    return v
  })
}

/** Scales a fraction vector to the smallest integer vector with the same direction. */
export function toIntegers(v: Frac[]): bigint[] {
  let lcm = 1n
  for (const x of v) lcm = (lcm / bgcd(lcm, x.d)) * x.d
  const ints = v.map((x) => (x.n * lcm) / x.d)
  let g = 0n
  for (const x of ints) g = bgcd(g, x)
  return ints.map((x) => (g ? x / g : x))
}

// ------------------------------------------------------------------ the balancer

export type BalanceStatus = 'balanced' | 'ok' | 'impossible' | 'multiple' | 'invalid'

export interface BalanceResult {
  status: BalanceStatus
  /** Smallest positive integer coefficients, reactants then products; empty when none. */
  coefficients: number[]
  /** A sentence for the user. */
  message: string
  /** Independent solutions when there are several (reactants then products, signs already oriented). */
  basis?: number[][]
}

function matrixOf(reactants: BalSpecies[], products: BalSpecies[]): { rows: number[][]; names: string[] } {
  const all = [...reactants, ...products]
  const elements = [...new Set(all.flatMap((s) => Object.keys(s.atoms)))].sort()
  const hasCharge = all.some((s) => s.charge !== 0)
  const rows: number[][] = []
  const names: string[] = []
  const nr = reactants.length
  for (const el of elements) {
    rows.push(all.map((s, i) => (s.atoms[el] ?? 0) * (i < nr ? 1 : -1)))
    names.push(el)
  }
  if (hasCharge) {
    rows.push(all.map((s, i) => s.charge * (i < nr ? 1 : -1)))
    names.push('charge')
  }
  return { rows, names }
}

/** Why no balancing exists: elements that are only on one side, or the rows that cannot all be met. */
function explainImpossible(reactants: BalSpecies[], products: BalSpecies[]): string {
  const left = new Set(reactants.flatMap((s) => Object.keys(s.atoms)))
  const right = new Set(products.flatMap((s) => Object.keys(s.atoms)))
  const onlyLeft = [...left].filter((e) => !right.has(e))
  const onlyRight = [...right].filter((e) => !left.has(e))
  const parts: string[] = []
  if (onlyLeft.length) parts.push(`${onlyLeft.join(', ')} ${onlyLeft.length > 1 ? 'are' : 'is'} only on the reactant side`)
  if (onlyRight.length) parts.push(`${onlyRight.join(', ')} ${onlyRight.length > 1 ? 'are' : 'is'} only on the product side`)
  if (parts.length) return `Cannot be balanced: ${parts.join(' and ')}. Atoms cannot appear from nowhere: add the missing species.`
  return 'Cannot be balanced with positive coefficients: the element counts (and charge) of these species are inconsistent. A species may be missing, or one may be on the wrong side.'
}

/** Positive integer combination of a null-space basis with the smallest total, searched by small weights. */
function positiveCombination(basis: bigint[][], n: number): bigint[] | null {
  const dim = basis.length
  if (dim === 0) return null
  let best: bigint[] | null = null
  let bestSum = 0n
  const range = dim <= 2 ? 12 : dim === 3 ? 6 : 3
  const w = new Array<number>(dim).fill(-range)
  const rec = (k: number) => {
    if (k === dim) {
      const v: bigint[] = new Array(n).fill(0n)
      for (let d = 0; d < dim; d++) for (let j = 0; j < n; j++) v[j] += BigInt(w[d]) * basis[d][j]
      if (v.every((x) => x > 0n)) {
        let g = 0n
        for (const x of v) g = bgcd(g, x)
        const u = v.map((x) => x / g)
        const sum = u.reduce((a, b) => a + b, 0n)
        if (best === null || sum < bestSum) {
          best = u
          bestSum = sum
        }
      }
      return
    }
    for (let x = -range; x <= range; x++) {
      w[k] = x
      rec(k + 1)
    }
  }
  rec(0)
  return best
}

/** Is it already balanced with these coefficients (default 1)? */
export function isBalanced(reactants: BalSpecies[], products: BalSpecies[], coeffs?: number[]): boolean {
  const c = coeffs ?? new Array(reactants.length + products.length).fill(1)
  const { rows } = matrixOf(reactants, products)
  return rows.every((row) => row.reduce((s, x, j) => s + x * c[j], 0) === 0)
}

/**
 * The smallest whole-number coefficients that balance reactants → products. When the equation has no solution
 * or several independent ones the result says so and explains.
 */
function balanceCore(reactants: BalSpecies[], products: BalSpecies[]): BalanceResult {
  if (reactants.length === 0 || products.length === 0) {
    return { status: 'invalid', coefficients: [], message: 'An equation needs at least one species on each side.' }
  }
  const n = reactants.length + products.length
  const { rows } = matrixOf(reactants, products)
  const basis = nullSpace(rows, n)
  if (basis.length === 0) return { status: 'impossible', coefficients: [], message: explainImpossible(reactants, products) }
  const ints = basis.map(toIntegers)
  if (basis.length === 1) {
    let v = ints[0]
    if (v.every((x) => x <= 0n)) v = v.map((x) => -x)
    if (!v.every((x) => x > 0n)) {
      const all = [...reactants, ...products]
      const unused = all.filter((_, i) => v[i] === 0n).map((s) => s.label)
      const message =
        v.some((x) => x < 0n)
          ? 'The only balancing needs a negative coefficient: some species is on the wrong side. Move it to the other side of the arrow.'
          : `${unused.join(', ')} cannot take part: ${explainImpossible(reactants, products)}`
      return { status: 'impossible', coefficients: [], message }
    }
    const coefficients = v.map(Number)
    const already = coefficients.every((c) => c === coefficients[0]) && coefficients[0] === 1
    return { status: already ? 'balanced' : 'ok', coefficients, message: already ? 'Already balanced.' : 'Balanced with the smallest whole numbers.' }
  }
  const pos = positiveCombination(ints, n)
  const basisNums = ints.map((v) => v.map(Number))
  if (!pos) {
    return {
      status: 'impossible',
      coefficients: [],
      basis: basisNums,
      message: `The atom counts allow ${basis.length} independent solutions but none of them has all coefficients above zero.`,
    }
  }
  return {
    status: 'multiple',
    coefficients: pos.map(Number),
    basis: basisNums,
    message: `Not unique: ${basis.length} independent ways to balance this exist (several reactions are hidden in it, e.g. when a species can react in more than one way). Showing the smallest positive one; split the reaction into separate equations to get a meaningful answer.`,
  }
}

/**
 * Balances reactants → products. Species with the same formula and charge on one side (the same compound listed
 * twice, or isomers such as glucose and fructose) are balanced as one and share their total evenly.
 */
export function balanceSpecies(reactants: BalSpecies[], products: BalSpecies[]): BalanceResult {
  const key = (s: BalSpecies) => `${hillFormula(s.atoms)}/${s.charge}`
  const group = (list: BalSpecies[]) => {
    const keys: string[] = []
    const members: number[][] = []
    list.forEach((s, i) => {
      const k = key(s)
      const at = keys.indexOf(k)
      if (at < 0) {
        keys.push(k)
        members.push([i])
      } else members[at].push(i)
    })
    return { reps: members.map((m) => list[m[0]]), members }
  }
  const R = group(reactants)
  const P = group(products)
  if (R.reps.length === reactants.length && P.reps.length === products.length) return balanceCore(reactants, products)
  const res = balanceCore(R.reps, P.reps)
  if (res.coefficients.length === 0) return res
  const sizes = [...R.members, ...P.members].map((m) => m.length)
  const totals = res.coefficients
  let scale = 1
  totals.forEach((t, i) => {
    const k = sizes[i]
    scale = lcmNum(scale, k / gcdNum(t, k))
  })
  const out: number[] = new Array(reactants.length + products.length).fill(0)
  ;[...R.members.map((m) => m.map((i) => i)), ...P.members.map((m) => m.map((i) => i + reactants.length))].forEach((m, g) => {
    for (const i of m) out[i] = (totals[g] * scale) / m.length
  })
  return { ...res, coefficients: out, basis: undefined }
}

const gcdNum = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcdNum(b, a % b))
const lcmNum = (a: number, b: number): number => (a / gcdNum(a, b)) * b

// ------------------------------------------------------------------ checking given coefficients

export interface CheckRow {
  /** An element symbol or "charge". */
  what: string
  left: number
  right: number
  ok: boolean
}

export interface CheckResult {
  rows: CheckRow[]
  /** Element counts only. */
  atomsOk: boolean
  chargeOk: boolean
  massLeft: number
  massRight: number
  /** |left − right| / left relative to the mass. */
  massOk: boolean
  balanced: boolean
}

/** Atom, charge and mass balance of reactants → products with the given coefficients. */
export function checkBalance(reactants: BalSpecies[], products: BalSpecies[], coeffs: number[]): CheckResult {
  const side = (list: BalSpecies[], offset: number) => {
    const atoms: Counts = {}
    let charge = 0
    let mass = 0
    list.forEach((s, i) => {
      const c = coeffs[offset + i] ?? 1
      for (const [k, v] of Object.entries(s.atoms)) atoms[k] = (atoms[k] ?? 0) + v * c
      charge += s.charge * c
      mass += molarMass(s.atoms) * c
    })
    return { atoms, charge, mass }
  }
  const L = side(reactants, 0)
  const R = side(products, reactants.length)
  const elements = [...new Set([...Object.keys(L.atoms), ...Object.keys(R.atoms)])]
  // Hill order for the rows
  const order = hillFormula(Object.fromEntries(elements.map((e) => [e, 1]))).match(/[A-Z][a-z]?/g) ?? elements
  const rows: CheckRow[] = order.map((e) => ({ what: e, left: L.atoms[e] ?? 0, right: R.atoms[e] ?? 0, ok: (L.atoms[e] ?? 0) === (R.atoms[e] ?? 0) }))
  const chargeOk = L.charge === R.charge
  if ([...reactants, ...products].some((s) => s.charge !== 0)) rows.push({ what: 'charge', left: L.charge, right: R.charge, ok: chargeOk })
  const atomsOk = rows.filter((r) => r.what !== 'charge').every((r) => r.ok)
  const massOk = Math.abs(L.mass - R.mass) <= 1e-9 * Math.max(1, L.mass)
  return { rows, atomsOk, chargeOk, massLeft: L.mass, massRight: R.mass, massOk, balanced: atomsOk && chargeOk && massOk }
}

/** The balanced equation as plain text: "4 Fe + 3 O2 → 2 Fe2O3". */
export function equationText(labels: { reactants: string[]; products: string[] }, coeffs: number[] | null, arrow = '→'): string {
  const term = (l: string, i: number) => {
    const c = coeffs?.[i]
    return c === undefined || c === 1 ? l : `${c} ${l}`
  }
  const left = labels.reactants.map((l, i) => term(l, i)).join(' + ')
  const right = labels.products.map((l, i) => term(l, labels.reactants.length + i)).join(' + ')
  return `${left} ${arrow} ${right}`
}
