// Multi-species stoichiometry: from the amounts of the reactants (mass, moles, or a solution's
// molarity × volume) to the limiting reagent, the theoretical yield of every product, the excess
// left over, and the percent yield. Pure functions.

import { checkBalance, equationCoefficients, parseEquation, type Equation } from './balance.ts'
import { countsMass } from './chem.ts'

export type AmountKind = 'mass' | 'moles' | 'solution' | 'gas'

export interface Amount {
  kind: AmountKind
  /** mass: the value in `unit` (mg, g, kg); moles: mmol, mol; solution: volume in `unit` (mL, L) with `conc`; gas: litres at `molarVolume`. */
  value: number
  unit: string
  /** Molarity (mol/L) for a solution. */
  conc?: number
  /** Molar volume in L/mol for a gas (22.414 at STP, 24.465 at 25 °C). */
  molarVolume?: number
  /** Purity in percent (mass only; default 100). */
  purity?: number
}

const MASS_UNIT: Record<string, number> = { mg: 1e-3, g: 1, kg: 1e3 }
const MOLE_UNIT: Record<string, number> = { mmol: 1e-3, mol: 1, µmol: 1e-6 }
const VOL_UNIT: Record<string, number> = { mL: 1e-3, L: 1, µL: 1e-6 }

export const AMOUNT_UNITS: Record<AmountKind, string[]> = {
  mass: Object.keys(MASS_UNIT),
  moles: Object.keys(MOLE_UNIT),
  solution: Object.keys(VOL_UNIT),
  gas: ['L', 'mL'],
}

/** Moles of a species from an amount. */
export function molesOf(amount: Amount, molarMass: number): number {
  const v = amount.value
  if (!Number.isFinite(v) || v < 0) throw new Error('Amounts must be zero or more.')
  switch (amount.kind) {
    case 'mass': {
      const f = MASS_UNIT[amount.unit]
      if (f === undefined) throw new Error(`Unknown mass unit ${amount.unit}.`)
      return (v * f * (amount.purity === undefined ? 1 : amount.purity / 100)) / molarMass
    }
    case 'moles': {
      const f = MOLE_UNIT[amount.unit]
      if (f === undefined) throw new Error(`Unknown unit ${amount.unit}.`)
      return v * f
    }
    case 'solution': {
      const f = VOL_UNIT[amount.unit]
      if (f === undefined) throw new Error(`Unknown volume unit ${amount.unit}.`)
      if (amount.conc === undefined || !(amount.conc >= 0)) throw new Error('A solution needs its concentration (mol/L).')
      return v * f * amount.conc
    }
    case 'gas': {
      const f = amount.unit === 'mL' ? 1e-3 : 1
      return (v * f) / (amount.molarVolume ?? 22.414)
    }
  }
}

export interface StoichRow {
  formula: string
  coeff: number
  molarMass: number
  /** Reactants: the moles given (null = not given, assumed in excess). */
  molesGiven: number | null
  /** Moles used (reactants) or made (products). */
  molesReacted: number
  /** Reactants: moles left over. */
  molesLeft: number | null
  massReacted: number
  massLeft: number | null
  /** Mass available at the start (reactants). */
  massGiven: number | null
  limiting: boolean
  /** Extent of reaction this reactant allows (moles / coefficient). */
  extentAllowed: number | null
}

export interface StoichResult {
  reactants: StoichRow[]
  products: StoichRow[]
  /** Moles of "reaction" (the extent) that actually happens. */
  extent: number
  limiting: string[]
  /** Percent yield for the product asked about, when an actual yield is given. */
  percentYield: { formula: string; theoretical: number; actual: number; percent: number } | null
}

export interface StoichInput {
  /** The balanced equation text, with a coefficient on every species. */
  equation: string
  /** One amount per reactant, in order (null = not given: in excess). */
  amounts: (Amount | null)[]
  /** Actual yield of one product, in grams, for the percent yield. */
  actual?: { product: number; grams: number } | null
}

/** Parses an equation that carries its coefficients and checks that it balances. */
export function parseBalanced(text: string): { eq: Equation; coeffs: number[] } {
  const eq = parseEquation(text)
  const coeffs = equationCoefficients(eq)
  if (coeffs.some((c) => !(c > 0))) throw new Error('Coefficients must be above zero.')
  const chk = checkBalance(eq, coeffs)
  if (!chk.balanced) throw new Error(`The equation is not balanced (${chk.problems.join('; ')}). Use "Balance" to fix it.`)
  return { eq, coeffs }
}

/** Limiting reagent, theoretical yields, excess left, percent yield. */
export function stoichiometry(input: StoichInput): StoichResult {
  const { eq, coeffs } = parseBalanced(input.equation)
  const nr = eq.reactants.length
  if (input.amounts.length !== nr) throw new Error(`Give an amount for each of the ${nr} reactants (or leave it out).`)
  const mm = [...eq.reactants, ...eq.products].map((s) => {
    if (s.electron) throw new Error('Half-reactions with electrons cannot be used here.')
    return countsMass(s.atoms)
  })
  const given: (number | null)[] = input.amounts.map((a, i) => (a === null ? null : molesOf(a, mm[i])))
  const extents = given.map((n, i) => (n === null ? null : n / coeffs[i]))
  const known = extents.filter((x): x is number => x !== null)
  if (known.length === 0) throw new Error('Enter the amount of at least one reactant.')
  const extent = Math.min(...known)
  const EPS = 1e-9
  const reactants: StoichRow[] = eq.reactants.map((s, i) => {
    const used = coeffs[i] * extent
    const left = given[i] === null ? null : Math.max(0, (given[i] as number) - used)
    return {
      formula: s.formula, coeff: coeffs[i], molarMass: mm[i], molesGiven: given[i], molesReacted: used,
      molesLeft: left, massReacted: used * mm[i], massLeft: left === null ? null : left * mm[i],
      massGiven: given[i] === null ? null : (given[i] as number) * mm[i],
      limiting: extents[i] !== null && Math.abs((extents[i] as number) - extent) <= EPS * Math.max(1, extent),
      extentAllowed: extents[i],
    }
  })
  const products: StoichRow[] = eq.products.map((s, j) => {
    const i = nr + j
    const made = coeffs[i] * extent
    return {
      formula: s.formula, coeff: coeffs[i], molarMass: mm[i], molesGiven: null, molesReacted: made, molesLeft: null,
      massReacted: made * mm[i], massLeft: null, massGiven: null, limiting: false, extentAllowed: null,
    }
  })
  let percentYield: StoichResult['percentYield'] = null
  if (input.actual && Number.isFinite(input.actual.grams)) {
    const p = products[input.actual.product]
    if (!p) throw new Error('Choose which product the actual yield is for.')
    percentYield = { formula: p.formula, theoretical: p.massReacted, actual: input.actual.grams, percent: (100 * input.actual.grams) / p.massReacted }
  }
  return { reactants, products, extent, limiting: reactants.filter((r) => r.limiting).map((r) => r.formula), percentYield }
}
