// Chemical equations: parsing text like "Fe + O2 -> Fe2O3" (also →, =, charges, hydrates, brackets,
// phases) and balancing it with exact rational arithmetic (BigInt fractions): the null space of the
// element-by-species matrix gives the smallest whole-number coefficients. Pure functions.

import { parseSpecies, type Counts } from './chem.ts'

export interface EqSpecies {
  /** The species as typed, without coefficient and phase: "Fe^3+", "CuSO4·5H2O". */
  formula: string
  phase: string
  atoms: Counts
  charge: number
  /** The coefficient typed in front of it, or null. */
  coeff: number | null
  /** True for the electron e- of a half-reaction. */
  electron: boolean
}

export interface Equation {
  reactants: EqSpecies[]
  products: EqSpecies[]
  /** The arrow as typed ("→", "⇌"…). */
  arrow: string
}

/** The arrows and equal signs that separate the sides. */
const ARROW = /<?[=-]{1,3}>|<[=-]{1,3}>?|[→⟶⇒⇌⇄↔⟷]|=/

/** Splits one side at its "+" signs, keeping the "+" that are charges (Fe^3+, Na+ followed by a space or the end). */
function splitSide(side: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < side.length; i++) {
    const c = side[i]
    if (c !== '+') {
      cur += c
      continue
    }
    const next = side[i + 1]
    if (/\^\s*\{?\s*\d*[+-]*$/.test(cur)) cur += c // Fe^3+, H^+
    else if (cur.trim() === '') cur += c
    else if (/\s$/.test(cur)) {
      parts.push(cur) // "Fe + O2"
      cur = ''
    } else if (next === undefined || /[\s+-]/.test(next)) cur += c // Na+, Fe++ (a charge)
    else {
      parts.push(cur) // Fe+O2
      cur = ''
    }
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

function parseTerm(term: string): EqSpecies {
  let t = term.trim()
  let coeff: number | null = null
  const m = /^(\d+\/\d+|\d+(?:\.\d+)?)\s*(.+)$/.exec(t)
  if (m && /^([A-Z([{]|e(?![a-z]))/.test(m[2])) {
    coeff = m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : Number(m[1])
    t = m[2]
  }
  const sp = parseSpecies(t)
  const formula = sp.electron ? 'e^-' : sp.body + (sp.charge ? '^' + chargeText(sp.charge) : '')
  return { formula, phase: sp.phase, atoms: sp.atoms, charge: sp.charge, coeff, electron: sp.electron }
}

/** "2-", "+", "3+" the way it is written after a caret. */
export function chargeText(q: number): string {
  const n = Math.abs(q)
  return (n === 1 ? '' : String(n)) + (q > 0 ? '+' : '-')
}

/** Parses "A + B -> C + D" into species with their atoms and charges. Throws a friendly message. */
export function parseEquation(text: string): Equation {
  const src = text.replace(/ /g, ' ').trim()
  if (!src) throw new Error('Type an equation, e.g. Fe + O2 -> Fe2O3.')
  const m = ARROW.exec(src)
  if (!m) throw new Error('Put an arrow between the reactants and the products: Fe + O2 -> Fe2O3 (-> , → or = all work).')
  const left = src.slice(0, m.index)
  const right = src.slice(m.index + m[0].length)
  if (ARROW.test(right)) throw new Error('Only one arrow is allowed (write multi-step mechanisms as separate equations).')
  const side = (s: string, what: string): EqSpecies[] => {
    const parts = splitSide(s)
    if (parts.length === 0) throw new Error(`The ${what} are missing.`)
    return parts.map((p) => {
      try {
        return parseTerm(p)
      } catch (e) {
        throw new Error(`"${p}": ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }
  return { reactants: side(left, 'reactants'), products: side(right, 'products'), arrow: m[0] }
}

// ------------------------------------------------------------ exact fractions

type Frac = { n: bigint; d: bigint }

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b) [a, b] = [b, a % b]
  return a
}
const frac = (n: bigint, d: bigint = 1n): Frac => {
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n, d) || 1n
  return { n: n / g, d: d / g }
}
const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d)
const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n)
const isZero = (a: Frac) => a.n === 0n

/**
 * The null space of an integer matrix (rows × cols), as vectors of whole numbers with no common factor
 * (sign as they come out of the elimination).
 */
export function nullSpace(matrix: number[][], cols: number): bigint[][] {
  const A: Frac[][] = matrix.map((r) => r.map((x) => frac(BigInt(x))))
  const pivots: number[] = []
  let row = 0
  for (let c = 0; c < cols && row < A.length; c++) {
    let p = -1
    for (let r = row; r < A.length; r++) if (!isZero(A[r][c])) { p = r; break }
    if (p < 0) continue
    ;[A[row], A[p]] = [A[p], A[row]]
    const pv = A[row][c]
    A[row] = A[row].map((x) => div(x, pv))
    for (let r = 0; r < A.length; r++) {
      if (r !== row && !isZero(A[r][c])) {
        const f = A[r][c]
        A[r] = A[r].map((x, j) => sub(x, mul(f, A[row][j])))
      }
    }
    pivots.push(c)
    row++
  }
  const free = Array.from({ length: cols }, (_, i) => i).filter((c) => !pivots.includes(c))
  return free.map((f) => {
    const v: Frac[] = Array.from({ length: cols }, () => frac(0n))
    v[f] = frac(1n)
    pivots.forEach((pc, i) => {
      v[pc] = frac(-A[i][f].n, A[i][f].d)
    })
    let l = 1n
    for (const x of v) l = (l * x.d) / gcd(l, x.d)
    const ints = v.map((x) => (x.n * l) / x.d)
    let g = 0n
    for (const x of ints) g = gcd(g, x)
    return ints.map((x) => (g ? x / g : x))
  })
}

export type BalanceResult =
  | {
      ok: true
      equation: Equation
      /** One coefficient per species, reactants first. */
      coefficients: number[]
      /** The balanced equation as text, e.g. "4 Fe + 3 O2 → 2 Fe2O3". */
      text: string
      /** True when the coefficients typed already balanced it. */
      alreadyBalanced: boolean
    }
  | { ok: false; message: string; nullity?: number; hint?: string }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Renders species with coefficients: "4 Fe + 3 O2 → 2 Fe2O3" (a coefficient of 1 is left out). */
export function formatEquation(eq: Equation, coeffs: (number | null)[], arrow = '→'): string {
  const side = (list: EqSpecies[], offset: number) =>
    list
      .map((s, i) => {
        const c = coeffs[offset + i]
        return `${c === null || c === 1 ? '' : fmtCoeff(c) + ' '}${s.formula}${s.phase ? `(${s.phase})` : ''}`
      })
      .join(' + ')
  return `${side(eq.reactants, 0)} ${arrow} ${side(eq.products, eq.reactants.length)}`
}

const fmtCoeff = (c: number) => (Number.isInteger(c) ? String(c) : String(Number(c.toFixed(4))))

/** Atoms and charge of each side with the given coefficients (to check a balance). */
export function sideTotals(list: EqSpecies[], coeffs: number[]): { atoms: Counts; charge: number } {
  const atoms: Counts = {}
  let charge = 0
  list.forEach((s, i) => {
    for (const [el, n] of Object.entries(s.atoms)) atoms[el] = (atoms[el] ?? 0) + n * coeffs[i]
    charge += s.charge * coeffs[i]
  })
  return { atoms, charge }
}

/** Does the equation balance with these coefficients (reactants first)? Lists what is out of balance. */
export function checkBalance(eq: Equation, coeffs: number[]): { balanced: boolean; problems: string[] } {
  const L = sideTotals(eq.reactants, coeffs.slice(0, eq.reactants.length))
  const R = sideTotals(eq.products, coeffs.slice(eq.reactants.length))
  const problems: string[] = []
  const els = new Set([...Object.keys(L.atoms), ...Object.keys(R.atoms)])
  for (const el of els) {
    const a = L.atoms[el] ?? 0
    const b = R.atoms[el] ?? 0
    if (Math.abs(a - b) > 1e-9) problems.push(`${el}: ${fmtCoeff(a)} on the left, ${fmtCoeff(b)} on the right`)
  }
  if (L.charge !== R.charge) problems.push(`charge: ${L.charge} on the left, ${R.charge} on the right`)
  return { balanced: problems.length === 0, problems }
}

/** Balances an equation given as text (or already parsed). */
export function balance(input: string | Equation): BalanceResult {
  let eq: Equation
  try {
    eq = typeof input === 'string' ? parseEquation(input) : input
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  const all = [...eq.reactants, ...eq.products]
  const nr = eq.reactants.length
  const elements = [...new Set(all.flatMap((s) => Object.keys(s.atoms)))]
  // an element on one side only can never balance
  for (const el of elements) {
    const inL = eq.reactants.some((s) => s.atoms[el])
    const inR = eq.products.some((s) => s.atoms[el])
    if (!inL || !inR) {
      return { ok: false, message: `${el} appears only on the ${inL ? 'left' : 'right'} side: add a species with ${el} on the other side (or check the formula).` }
    }
  }
  const rows: number[][] = elements.map((el) => all.map((s, j) => (s.atoms[el] ?? 0) * (j < nr ? 1 : -1)))
  if (all.some((s) => s.charge !== 0)) rows.push(all.map((s, j) => s.charge * (j < nr ? 1 : -1)))
  if (rows.some((r) => r.some((x) => !Number.isInteger(x)))) {
    return { ok: false, message: 'Fractional atom counts (like ·½H2O) cannot be balanced: write the formula with whole numbers.' }
  }
  const basis = nullSpace(rows, all.length)
  if (basis.length === 0) {
    return {
      ok: false,
      nullity: 0,
      message: 'This equation cannot be balanced: no set of coefficients makes the atoms (and charges) equal on both sides. Check the formulas and the charges.',
    }
  }
  if (basis.length > 1) {
    const n = basis.length
    return {
      ok: false,
      nullity: n,
      message:
        `Not unique: this can be balanced in infinitely many ways (${plural(n, 'independent reaction')} are mixed together, so the coefficients are not fixed). ` +
        'Split it into separate equations, or remove a species that does not take part.',
      hint: n === 2 ? 'Typical cause: a species that can be made two ways, e.g. H2O and H2O2 from H2 + O2.' : undefined,
    }
  }
  let v = basis[0]
  if (v.every((x) => x <= 0n)) v = v.map((x) => -x)
  if (v.some((x) => x <= 0n)) {
    const bad = all.filter((_, i) => v[i] <= 0n).map((s) => s.formula)
    return {
      ok: false,
      nullity: 1,
      message: `No balanced equation has all-positive coefficients: ${bad.join(', ')} would need to be ${v.every((x) => x === 0n) ? 'left out' : 'on the other side or left out'}. Check which species really take part.`,
    }
  }
  const coefficients = v.map((x) => Number(x))
  if (coefficients.some((c) => !Number.isSafeInteger(c))) return { ok: false, message: 'The coefficients are too large to show.' }
  const typed = all.map((s) => s.coeff)
  const alreadyBalanced = typed.every((c) => c !== null) && typed.every((c, i) => c === coefficients[i])
  return { ok: true, equation: eq, coefficients, text: formatEquation(eq, coefficients), alreadyBalanced }
}

/** The coefficients typed in an equation (a missing one counts as 1). */
export function equationCoefficients(eq: Equation): number[] {
  return [...eq.reactants, ...eq.products].map((s) => s.coeff ?? 1)
}
