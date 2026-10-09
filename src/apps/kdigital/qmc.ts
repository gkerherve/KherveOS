// Quine–McCluskey minimisation with don't-cares: prime implicants, the prime-implicant chart, essential
// primes, a minimal cover (Petrick's method) for the sum of products and for the product of sums. Pure.

import { C0, C1, and, not, or, v as varNode, type Node } from './expr.ts'

/** A product term: `mask` bits are the variables that are left out (don't-care), `value` the others. Bit 0 is the last variable. */
export interface Implicant {
  value: number
  mask: number
  /** The on-set and don't-care minterms it contains. */
  minterms: number[]
}

export const implicantKey = (i: Implicant): string => `${i.mask}:${i.value}`

/** "1-01": MSB (the first variable) first, - for a variable that is left out. */
export function implicantBits(i: Implicant, n: number): string {
  let s = ''
  for (let b = n - 1; b >= 0; b--) s += (i.mask >> b) & 1 ? '-' : (i.value >> b) & 1 ? '1' : '0'
  return s
}

export const literalCount = (i: Implicant, n: number): number => n - popcount(i.mask)

function popcount(x: number): number {
  let c = 0
  while (x) { c += x & 1; x >>= 1 }
  return c
}

function expand(value: number, mask: number): number[] {
  let list = [value]
  for (let b = 0; (1 << b) <= mask; b++) {
    if (!((mask >> b) & 1)) continue
    list = list.concat(list.map((x) => x | (1 << b)))
  }
  return list.sort((a, b) => a - b)
}

export interface MinResult {
  n: number
  on: number[]
  dc: number[]
  /** Combination rounds: round 0 are the minterms, the last round holds only primes that could not combine further (the final column). */
  rounds: Implicant[][]
  primes: Implicant[]
  /** Primes that are the only cover of some minterm. */
  essential: Implicant[]
  /** The chosen cover (a minimal sum of products). */
  cover: Implicant[]
  /** chart[p][m] — does prime p cover on-set minterm on[m]? */
  chart: boolean[][]
  /** Columns (indices into `on`) that have exactly one prime. */
  essentialColumns: number[]
  /** True when every minterm was covered by essential primes alone. */
  coveredByEssentials: boolean
  /** True when Petrick's method was cut short and the cover is a good, not proven minimal, one. */
  heuristic: boolean
}

export function primeImplicants(n: number, terms: number[]): { primes: Implicant[]; rounds: Implicant[][] } {
  let current = new Map<string, Implicant>()
  for (const m of terms) current.set(`0:${m}`, { value: m, mask: 0, minterms: [m] })
  const primes: Implicant[] = []
  const rounds: Implicant[][] = [[...current.values()]]
  while (current.size > 0) {
    const used = new Set<string>()
    const next = new Map<string, Implicant>()
    const list = [...current.values()]
    // group by mask, then by the number of ones: only neighbouring groups can combine
    const byMask = new Map<number, Implicant[]>()
    for (const i of list) { const g = byMask.get(i.mask); if (g) g.push(i); else byMask.set(i.mask, [i]) }
    for (const [mask, group] of byMask) {
      const index = new Map(group.map((i) => [i.value, i]))
      for (const i of group) {
        for (let b = 0; b < n; b++) {
          if ((mask >> b) & 1 || (i.value >> b) & 1) continue
          const j = index.get(i.value | (1 << b))
          if (!j) continue
          used.add(implicantKey(i))
          used.add(implicantKey(j))
          const merged: Implicant = { value: i.value, mask: mask | (1 << b), minterms: [] }
          const key = implicantKey(merged)
          if (!next.has(key)) { merged.minterms = expand(merged.value, merged.mask); next.set(key, merged) }
        }
      }
    }
    for (const i of list) if (!used.has(implicantKey(i))) primes.push(i)
    if (next.size > 0) rounds.push([...next.values()])
    current = next
  }
  primes.sort((a, b) => a.mask - b.mask || a.value - b.value)
  return { primes, rounds }
}

/**
 * The cheapest set of primes (fewest terms, then fewest literals) that covers every column: columns that are
 * implied by others are dropped, then a branch-and-bound search runs with a node budget (after which the best
 * cover found is returned and `heuristic` is set).
 */
function chooseCover(cols: number[][], costs: number[], budget = 150000): { picked: number[]; heuristic: boolean } {
  if (cols.length === 0) return { picked: [], heuristic: false }
  // a column whose primes include all the primes of another column is covered whenever that one is
  const sorted = cols.map((c) => [...new Set(c)].sort((a, b) => a - b)).sort((a, b) => a.length - b.length)
  const kept: number[][] = []
  for (const c of sorted) if (!kept.some((k) => k.every((p) => c.includes(p)))) kept.push(c)
  const nCols = kept.length
  const primeCols = new Map<number, number[]>()
  kept.forEach((c, ci) => c.forEach((p) => { const l = primeCols.get(p); if (l) l.push(ci); else primeCols.set(p, [ci]) }))
  const maxCover = Math.max(...[...primeCols.values()].map((l) => l.length))
  const covered = new Array<number>(nCols).fill(0)
  let best: number[] | null = null
  let bestCount = Infinity
  let bestCost = Infinity
  let nodes = 0
  let cut = false
  const chosen: number[] = []

  // a greedy cover gives the first upper bound
  {
    const have = new Array<boolean>(nCols).fill(false)
    let left = nCols
    const pick: number[] = []
    while (left > 0) {
      let bp = -1, bg = -1, bc = Infinity
      for (const [p, l] of primeCols) {
        const gain = l.filter((ci) => !have[ci]).length
        if (gain > bg || (gain === bg && costs[p] < bc)) { bp = p; bg = gain; bc = costs[p] }
      }
      pick.push(bp)
      for (const ci of primeCols.get(bp)!) if (!have[ci]) { have[ci] = true; left-- }
    }
    best = pick; bestCount = pick.length; bestCost = pick.reduce((s, p) => s + costs[p], 0)
  }

  const search = (uncovered: number, cost: number) => {
    if (nodes++ > budget) { cut = true; return }
    if (uncovered === 0) {
      if (chosen.length < bestCount || (chosen.length === bestCount && cost < bestCost)) { best = [...chosen]; bestCount = chosen.length; bestCost = cost }
      return
    }
    if (chosen.length + Math.ceil(uncovered / maxCover) > bestCount) return
    if (chosen.length + 1 > bestCount) return
    // the uncovered column with the fewest candidates
    let ci = -1, fewest = Infinity
    for (let c = 0; c < nCols; c++) if (!covered[c] && kept[c].length < fewest) { fewest = kept[c].length; ci = c }
    const cands = [...kept[ci]].sort((a, b) => primeCols.get(b)!.filter((x) => !covered[x]).length - primeCols.get(a)!.filter((x) => !covered[x]).length || costs[a] - costs[b])
    for (const p of cands) {
      const l = primeCols.get(p)!
      let newly = 0
      for (const c of l) { if (!covered[c]) newly++; covered[c]++ }
      chosen.push(p)
      search(uncovered - newly, cost + costs[p])
      chosen.pop()
      for (const c of l) covered[c]--
      if (cut) return
    }
  }
  search(nCols, 0)
  return { picked: best ?? [], heuristic: cut }
}

export function minimize(n: number, on: readonly number[], dc: readonly number[] = []): MinResult {
  if (n < 0 || n > 12) throw new Error('Quine–McCluskey handles 0 to 12 variables.')
  const size = 1 << n
  const onSet = [...new Set(on)].filter((m) => m >= 0 && m < size).sort((a, b) => a - b)
  const dcSet = [...new Set(dc)].filter((m) => m >= 0 && m < size && !onSet.includes(m)).sort((a, b) => a - b)
  const base: MinResult = { n, on: onSet, dc: dcSet, rounds: [], primes: [], essential: [], cover: [], chart: [], essentialColumns: [], coveredByEssentials: true, heuristic: false }
  if (onSet.length === 0) return base
  const { primes, rounds } = primeImplicants(n, [...onSet, ...dcSet])
  const chart = primes.map((p) => onSet.map((m) => (m & ~p.mask) === p.value))
  const cols = onSet.map((_, c) => primes.map((_p, pi) => pi).filter((pi) => chart[pi][c]))
  const essentialIdx = new Set<number>()
  const essentialColumns: number[] = []
  cols.forEach((list, c) => { if (list.length === 1) { essentialIdx.add(list[0]); essentialColumns.push(c) } })
  const remaining = cols.map((_list, c) => c).filter((c) => !cols[c].some((pi) => essentialIdx.has(pi)))
  const costs = primes.map((p) => literalCount(p, n))
  const { picked, heuristic } = chooseCover(remaining.map((c) => cols[c]), costs)
  const chosen = new Set<number>([...essentialIdx, ...picked])
  const cover = [...chosen].sort((a, b) => a - b).map((i) => primes[i])
  return {
    ...base, rounds, primes, essential: [...essentialIdx].sort((a, b) => a - b).map((i) => primes[i]), cover, chart, essentialColumns,
    coveredByEssentials: remaining.length === 0, heuristic,
  }
}

// ------------------------------------------------------------------------------ expressions from covers

/** The product term of an implicant: A'BC. */
export function termNode(i: Implicant, vars: readonly string[]): Node {
  const n = vars.length
  const lits: Node[] = []
  for (let k = 0; k < n; k++) {
    const bit = n - 1 - k
    if ((i.mask >> bit) & 1) continue
    lits.push((i.value >> bit) & 1 ? varNode(vars[k]) : not(varNode(vars[k])))
  }
  if (lits.length === 0) return C1
  return lits.length === 1 ? lits[0] : and(...lits)
}

/** The sum term used by a product of sums: the implicant of the complement, with each literal inverted. */
export function sumNode(i: Implicant, vars: readonly string[]): Node {
  const n = vars.length
  const lits: Node[] = []
  for (let k = 0; k < n; k++) {
    const bit = n - 1 - k
    if ((i.mask >> bit) & 1) continue
    lits.push((i.value >> bit) & 1 ? not(varNode(vars[k])) : varNode(vars[k]))
  }
  if (lits.length === 0) return C0
  return lits.length === 1 ? lits[0] : or(...lits)
}

export function sopNode(cover: readonly Implicant[], vars: readonly string[]): Node {
  if (cover.length === 0) return C0
  const terms = cover.map((i) => termNode(i, vars))
  return terms.length === 1 ? terms[0] : or(...terms)
}

export function posNode(coverOfComplement: readonly Implicant[], vars: readonly string[]): Node {
  if (coverOfComplement.length === 0) return C1
  const sums = coverOfComplement.map((i) => sumNode(i, vars))
  return sums.length === 1 ? sums[0] : and(...sums)
}

export interface Minimised {
  vars: string[]
  sop: MinResult
  pos: MinResult
  sopNode: Node
  posNode: Node
}

/** Minimal SOP and POS of a function given by its on-set and don't-cares. */
export function minimizeBoth(vars: readonly string[], on: readonly number[], dc: readonly number[] = []): Minimised {
  const n = vars.length
  const size = 1 << n
  const onSet = new Set(on)
  const dcSet = new Set(dc)
  const off: number[] = []
  for (let m = 0; m < size; m++) if (!onSet.has(m) && !dcSet.has(m)) off.push(m)
  const sop = minimize(n, [...onSet], [...dcSet])
  const pos = minimize(n, off, [...dcSet].filter((m) => !onSet.has(m)))
  return { vars: [...vars], sop, pos, sopNode: sopNode(sop.cover, vars), posNode: posNode(pos.cover, vars) }
}

// ------------------------------------------------------------------------------ canonical forms

export function canonicalSop(vars: readonly string[], on: readonly number[]): Node {
  if (on.length === 0) return C0
  const n = vars.length
  const terms = [...on].sort((a, b) => a - b).map((m) => termNode({ value: m, mask: 0, minterms: [m] }, vars))
  void n
  return terms.length === 1 ? terms[0] : or(...terms)
}

export function canonicalPos(vars: readonly string[], off: readonly number[]): Node {
  if (off.length === 0) return C1
  const sums = [...off].sort((a, b) => a - b).map((m) => sumNode({ value: m, mask: 0, minterms: [m] }, vars))
  return sums.length === 1 ? sums[0] : and(...sums)
}

export const sigmaText = (on: readonly number[], dc: readonly number[] = []): string =>
  `Σm(${[...on].sort((a, b) => a - b).join(', ')})${dc.length ? ` + d(${[...dc].sort((a, b) => a - b).join(', ')})` : ''}`

export const piText = (off: readonly number[], dc: readonly number[] = []): string =>
  `ΠM(${[...off].sort((a, b) => a - b).join(', ')})${dc.length ? ` · d(${[...dc].sort((a, b) => a - b).join(', ')})` : ''}`
