// A reaction as the builder holds it: species typed as names, SMILES or formulas, resolved to atoms and
// charge, checked for atom / mass / charge balance and balanced. Pure (RDKit can be plugged in through
// `hooks`, but nothing here needs it).

import { checkBalance, balanceSpecies, equationText, type BalanceResult, type CheckResult } from './balance.ts'
import { findCompound, nameOfSmiles } from './compounds.ts'
import { hillFormula, molarMass, parseFormula, chargeText, sameCounts, splitCharge, type Counts } from './formula.ts'
import { readSmiles } from './smiles.ts'

export type ArrowKind = 'forward' | 'equilibrium' | 'resonance' | 'reversible-forward'

export const ARROWS: Record<ArrowKind, { symbol: string; label: string }> = {
  forward: { symbol: '→', label: 'Forward (→)' },
  equilibrium: { symbol: '⇌', label: 'Equilibrium (⇌)' },
  'reversible-forward': { symbol: '⇀', label: 'Mostly forward (⇀)' },
  resonance: { symbol: '↔', label: 'Resonance (↔)' },
}

export interface Species {
  /** As typed (coefficient removed). */
  input: string
  kind: 'name' | 'smiles' | 'formula' | 'invalid'
  smiles: string | null
  /** A common name when known. */
  name: string | null
  /** Formula to show without its charge: Hill formula (structures) or as typed (formula species). */
  formula: string
  /** The formula with its charge appended, for plain text ("Fe3+", "C2H6O"). */
  label: string
  atoms: Counts
  charge: number
  mass: number
  error?: string
  /** A coefficient typed in front ("2 H2"), or null. */
  typedCoeff: number | null
}

/** Hooks to let RDKit have the last word on a SMILES. */
export interface ResolveHooks {
  /** false when RDKit cannot read this SMILES. */
  valid?(smiles: string): boolean
  /** Atoms and charge as RDKit sees them (null: unknown, use the built-in reader). */
  composition?(smiles: string): { atoms: Counts; charge: number } | null
}

/** "2 H2" → { coeff: 2, rest: "H2" }. */
export function splitCoefficient(text: string): { coeff: number | null; rest: string } {
  // "2 H2", or "2H2" / "3[Na+]" (a species never starts with a digit followed by a letter or bracket)
  const m = /^(\d+(?:\.\d+)?)(?:\s+(\S.*)|(?=[A-Za-z[(])(.+))$/.exec(text.trim())
  if (m) return { coeff: Number(m[1]), rest: (m[2] ?? m[3]).trim() }
  return { coeff: null, rest: text.trim() }
}

const invalid = (input: string, error: string, typedCoeff: number | null): Species => ({
  input, kind: 'invalid', smiles: null, name: null, formula: input, label: input, atoms: {}, charge: 0, mass: 0, error, typedCoeff,
})

/** Resolves one species: a known name, then a SMILES, then a molecular formula. */
export function resolveSpecies(raw: string, hooks: ResolveHooks = {}): Species {
  const { coeff, rest: input } = splitCoefficient(raw)
  if (input === '') return invalid('', 'Empty: type a name, a SMILES or a formula.', coeff)
  const known = findCompound(input)
  const fromSmiles = (smiles: string, kind: 'name' | 'smiles'): Species => {
    let info
    try {
      info = readSmiles(smiles)
    } catch (e) {
      return invalid(input, e instanceof Error ? e.message : String(e), coeff)
    }
    if (hooks.valid && !hooks.valid(smiles)) return invalid(input, `RDKit could not read "${smiles}" as a molecule (check the valences and brackets).`, coeff)
    const rd = hooks.composition?.(smiles)
    const atoms = rd ? rd.atoms : info.atoms
    const charge = rd ? rd.charge : info.charge
    // a name typed as a formula (H2SO4, NaCl) keeps the way the user wrote it
    let formula = hillFormula(atoms)
    if (kind === 'name' && /^[A-Z][A-Za-z0-9()[\]^+\-·.]*$/.test(input)) {
      try {
        const f = parseFormula(input)
        if (f.charge === charge && sameCounts(f.atoms, atoms)) formula = splitCharge(input).body
      } catch {
        /* keep the Hill formula */
      }
    }
    return {
      input, kind, smiles, name: kind === 'name' ? (known?.name ?? null) : nameOfSmiles(smiles), formula, label: formula + chargeText(charge),
      atoms, charge, mass: molarMass(atoms), typedCoeff: coeff,
    }
  }
  if (known) return fromSmiles(known.smiles, 'name')
  let smilesError = ''
  try {
    readSmiles(input)
    return fromSmiles(input, 'smiles')
  } catch (e) {
    smilesError = e instanceof Error ? e.message : String(e)
  }
  try {
    const f = parseFormula(input)
    if (Object.keys(f.atoms).length === 0) throw new Error('No atoms.')
    const formula = splitCharge(input.replace(/\((?:s|l|g|aq)\)$/i, '')).body || hillFormula(f.atoms)
    return {
      input, kind: 'formula', smiles: null, name: null, formula, label: formula + chargeText(f.charge),
      atoms: f.atoms, charge: f.charge, mass: molarMass(f.atoms), typedCoeff: coeff,
    }
  } catch {
    return invalid(input, `"${input}" is not a known name, a valid SMILES (${smilesError}) or a formula.`, coeff)
  }
}

export interface ReactionInput {
  reactants: string[]
  products: string[]
  arrow: ArrowKind
  /** Text above / below the arrow: catalyst, solvent, temperature, hv. */
  above: string
  below: string
}

export const EMPTY_REACTION: ReactionInput = { reactants: [''], products: [''], arrow: 'forward', above: '', below: '' }

export interface Analysis {
  reactants: Species[]
  products: Species[]
  /** Messages for species that could not be read. */
  errors: string[]
  /** Coefficients used for the check: typed ones, else 1. */
  coefficients: number[]
  check: CheckResult | null
  balance: BalanceResult | null
  /** True when every species has a formula. */
  ready: boolean
}

/** Resolves and checks a reaction; empty species lines are ignored. */
export function analyseReaction(input: ReactionInput, hooks: ResolveHooks = {}, coeffs?: number[] | null): Analysis {
  const resolve = (list: string[]) => list.filter((x) => x.trim() !== '').map((x) => resolveSpecies(x, hooks))
  const reactants = resolve(input.reactants)
  const products = resolve(input.products)
  const errors = [...reactants, ...products].filter((s) => s.kind === 'invalid').map((s) => s.error ?? 'Invalid species.')
  const n = reactants.length + products.length
  const typed = [...reactants, ...products].map((s) => s.typedCoeff ?? 1)
  const used = coeffs && coeffs.length === n ? coeffs : typed
  const ready = reactants.length > 0 && products.length > 0 && errors.length === 0
  if (!ready) return { reactants, products, errors, coefficients: used, check: null, balance: null, ready }
  const bal = (s: Species) => ({ label: s.label, atoms: s.atoms, charge: s.charge })
  const R = reactants.map(bal)
  const P = products.map(bal)
  return { reactants, products, errors, coefficients: used, check: checkBalance(R, P, used), balance: balanceSpecies(R, P), ready }
}

/** The equation as text with the given coefficients: "4 Fe + 3 O2 → 2 Fe2O3". */
export function reactionText(a: Analysis, input: Pick<ReactionInput, 'arrow'>, coeffs: number[] | null): string {
  return equationText(
    { reactants: a.reactants.map((s) => s.label), products: a.products.map((s) => s.label) },
    coeffs,
    ARROWS[input.arrow].symbol,
  )
}

/** Reaction SMILES "A.B>>C.D" of the species that have a structure (coefficients ignored). */
export function reactionSmiles(a: Analysis): string {
  const side = (list: Species[]) => list.filter((s) => s.smiles).map((s) => s.smiles).join('.')
  return `${side(a.reactants)}>>${side(a.products)}`
}

/** Net charge and total mass of a list of species with coefficients. */
export function totals(list: Species[], coeffs: number[], offset = 0): { mass: number; charge: number } {
  let mass = 0
  let charge = 0
  list.forEach((s, i) => {
    const c = coeffs[offset + i] ?? 1
    mass += s.mass * c
    charge += s.charge * c
  })
  return { mass, charge }
}

export { chargeText }

/** Splits "CCO + O2 -> CO2 + H2O" (also →, ⇌, =, <=>) into the species of each side. */
export function parseEquationText(text: string): { reactants: string[]; products: string[]; arrow: ArrowKind } {
  let arrow: ArrowKind = 'forward'
  const m = /\s*(<=>|<->|<-->|⇌|⇄|↔|⇀|-->|->|=>|→|⟶|⇒|>>)\s*|\s=\s/.exec(text)
  if (!m) throw new Error('Put an arrow between the reactants and the products (->, <=> or =).')
  const tok = m[1] ?? '='
  if (/<=>|<->|⇌|⇄|<-->/.test(tok)) arrow = 'equilibrium'
  else if (tok === '↔') arrow = 'resonance'
  else if (tok === '⇀') arrow = 'reversible-forward'
  const left = text.slice(0, m.index)
  const right = text.slice(m.index + m[0].length)
  const split = (side: string): string[] => {
    const out: string[] = []
    let cur = ''
    let depth = 0
    for (let i = 0; i < side.length; i++) {
      const c = side[i]
      if (c === '[') depth++
      if (c === ']') depth = Math.max(0, depth - 1)
      // " + " separates species; a "+" glued to the species before it ("Fe2+ ") is a charge; "A+B" splits
      const before = side[i - 1] ?? ''
      const after = side[i + 1] ?? ''
      const sep = before === ' ' ? after === ' ' : after !== ' ' && /[A-Za-z0-9\[(]/.test(after) && !/[\^]/.test(before)
      if (c === '+' && depth === 0 && sep) {
        out.push(cur.trim())
        cur = ''
      } else cur += c
    }
    out.push(cur.trim())
    return out.filter(Boolean)
  }
  return { reactants: split(left), products: split(right), arrow }
}
