// What kReaction's AI tools compute, as pure functions of plain arguments (no React, no window): the answers
// of set_reaction, load_example, simulate_kinetics, fit_order and equilibrium. aiTools.ts connects them to the
// window and to RDKit; tools/tests/kreaction.test.ts tests them.

import { equationText } from './balance.ts'
import { parseEquilibrium, solveIce, thermo } from './equilibrium.ts'
import { arrhenius, eyring, fitOrder, orderUnit, parseTable } from './fit.ts'
import { findReaction, LIBRARY } from './library.ts'
import { findPreset, parseNetwork, PRESETS, simulate, summarise } from './kinetics.ts'
import { ARROWS, analyseReaction, parseEquationText, reactionSmiles, resolveSpecies, type Analysis, type ArrowKind, type ReactionInput, type ResolveHooks } from './reaction.ts'
import { kcToKp } from './equilibrium.ts'
import type { OdeMethod } from './ode.ts'
import type { Prediction } from './rdengine.ts'

/** Rounds to `d` significant digits (a number, not a string). */
export const sig = (n: number, d = 6): number => (Number.isFinite(n) ? Number(n.toPrecision(d)) : n)

const num = (v: unknown, what: string): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) throw new Error(`${what} must be a number.`)
  return n
}
const optNum = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v))

// ------------------------------------------------------------------ set_reaction

export interface ReactionRequest {
  input: ReactionInput
  balance: boolean
}

/** A list of species from an array or a "A + B" string. */
export function speciesList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = parseEquationText(`${v} -> X`)
    return parsed.reactants
  }
  return []
}

/** The reaction asked for, or null when the call names none (it only reads the current one). */
export function reactionRequest(args: Record<string, unknown>): ReactionRequest | null {
  let reactants = speciesList(args.reactants)
  let products = speciesList(args.products)
  let arrow: ArrowKind = 'forward'
  // a whole equation in "reactants"
  if (typeof args.reactants === 'string' && /->|=>|→|⇌|<=>|⟶/.test(args.reactants) && products.length === 0) {
    const eq = parseEquationText(args.reactants)
    reactants = eq.reactants
    products = eq.products
    arrow = eq.arrow
  }
  if (reactants.length === 0 && products.length === 0) return null
  if (reactants.length === 0 || products.length === 0) throw new Error('Give both reactants and products (names, SMILES or formulas).')
  const a = String(args.arrow ?? '').toLowerCase()
  if (a === 'equilibrium' || a === '⇌' || a === '<=>') arrow = 'equilibrium'
  else if (a === 'forward' || a === '→' || a === '->') arrow = 'forward'
  else if (a === 'resonance' || a === '↔') arrow = 'resonance'
  else if (a === 'reversible-forward' || a === '⇀') arrow = 'reversible-forward'
  return {
    input: { reactants, products, arrow, above: String(args.above ?? ''), below: String(args.below ?? '') },
    balance: args.balance === undefined ? true : args.balance !== false,
  }
}

export interface ReactionAnswer {
  analysis: Analysis
  /** Coefficients now in use, reactants then products (non-empty species only). */
  coefficients: number[]
  result: Record<string, unknown>
}

/** Checks (and by default balances) a reaction; the answer lists what each species was understood as. */
export function describeReaction(input: ReactionInput, balance: boolean, hooks: ResolveHooks = {}, given: number[] | null = null): ReactionAnswer {
  let a = analyseReaction(input, hooks, given)
  let coefficients = a.coefficients
  if (a.ready && balance && a.balance && a.balance.coefficients.length && !a.check?.balanced) {
    coefficients = a.balance.coefficients
    a = analyseReaction(input, hooks, coefficients)
  }
  const species = [...a.reactants.map((s) => ({ role: 'reactant', s })), ...a.products.map((s) => ({ role: 'product', s }))].map(({ role, s }, i) => ({
    role,
    input: s.input,
    understood_as: s.kind,
    ...(s.name ? { name: s.name } : {}),
    ...(s.smiles ? { smiles: s.smiles } : {}),
    formula: s.label,
    molar_mass_g_per_mol: sig(s.mass, 6),
    charge: s.charge,
    coefficient: coefficients[i],
    ...(s.error ? { error: s.error } : {}),
  }))
  const result: Record<string, unknown> = { species }
  if (a.errors.length) result.errors = a.errors
  if (a.ready && a.check) {
    const arrow = ARROWS[input.arrow].symbol
    result.equation = equationText({ reactants: a.reactants.map((s) => s.label), products: a.products.map((s) => s.label) }, coefficients, arrow)
    result.balanced = a.check.balanced
    result.atoms_balanced = a.check.atomsOk
    result.mass_balanced = a.check.massOk
    result.charge_balanced = a.check.chargeOk
    result.element_counts = a.check.rows.map((r) => ({ element: r.what, reactants: r.left, products: r.right }))
    result.mass_g_per_mol = { reactants: sig(a.check.massLeft), products: sig(a.check.massRight) }
    if (a.balance) {
      result.balancer = { status: a.balance.status, message: a.balance.message, ...(a.balance.coefficients.length ? { coefficients: a.balance.coefficients } : {}) }
    }
    const smi = reactionSmiles(a)
    if (smi !== '>>') result.reaction_smiles = smi
  }
  return { analysis: a, coefficients, result }
}

// ------------------------------------------------------------------ load_example

export function listExamples(): Record<string, unknown>[] {
  return LIBRARY.map((r) => ({ id: r.id, name: r.name, class: r.cls, has_mechanism: !!r.mechanism, arrow: r.arrow === 'equilibrium' ? '⇌' : '→' }))
}

export function exampleDetails(id: string): Record<string, unknown> {
  const r = findReaction(id)
  if (!r) {
    const close = LIBRARY.filter((x) => x.id.includes(id.toLowerCase()) || x.name.toLowerCase().includes(id.toLowerCase())).slice(0, 5).map((x) => x.id)
    throw new Error(`No example "${id}".${close.length ? ` Did you mean: ${close.join(', ')}?` : ''} Call load_example without id to list them.`)
  }
  const names = (list: string[]) => list.map((s) => resolveSpecies(s).name ?? resolveSpecies(s).label)
  return {
    id: r.id,
    name: r.name,
    class: r.cls,
    equation: equationText({ reactants: names(r.reactants), products: names(r.products) }, r.coeffs, ARROWS[r.arrow].symbol),
    reactants_smiles: r.reactants,
    products_smiles: r.products,
    coefficients: r.coeffs,
    reagents: r.above,
    conditions: r.below,
    explanation: r.explanation,
    ...(r.dH !== undefined ? { delta_H_kJ: r.dH } : {}),
    ...(r.ea !== undefined ? { activation_energy_kJ_per_mol: r.ea } : {}),
    ...(r.mechanism
      ? {
        mechanism: r.mechanism.map((m, i) => ({ step: i, label: m.label, species_smiles: m.species, description: m.text, energy_kJ_per_mol: m.energy, ...(m.ts !== undefined ? { transition_state_kJ_per_mol: m.ts } : {}) })),
      }
      : {}),
  }
}

// ------------------------------------------------------------------ simulate_kinetics

export interface KineticsRequest {
  text: string
  tEnd: number
  samples: number
  logTime: boolean
  method: OdeMethod
  presetId: string
}

export function kineticsRequest(args: Record<string, unknown>, fallback: { text: string; tEnd: string; logTime: boolean; method: OdeMethod }): KineticsRequest {
  let text = String(args.network ?? '').trim()
  let presetId = ''
  let tEnd = optNum(args.t_end)
  let logTime = args.log_time === undefined ? fallback.logTime : args.log_time === true
  if (text === '') {
    text = fallback.text
  } else {
    const p = findPreset(text) ?? PRESETS.find((x) => x.name.toLowerCase() === text.toLowerCase())
    if (p) {
      presetId = p.id
      text = p.text
      if (tEnd === null) tEnd = p.tEnd
      if (args.log_time === undefined) logTime = p.logTime
    }
  }
  if (tEnd === null) tEnd = Number(fallback.tEnd)
  if (!(tEnd > 0)) throw new Error('t_end must be a number above zero.')
  const m = String(args.method ?? fallback.method)
  const method: OdeMethod = m === 'rk4' || m === 'rk45' || m === 'stiff' || m === 'auto' ? m : 'auto'
  const samples = Math.min(60, Math.max(2, Math.round(optNum(args.samples) ?? 10)))
  return { text, tEnd, samples, logTime, method, presetId }
}

export function runKinetics(req: KineticsRequest): Record<string, unknown> {
  const parsed = parseNetwork(req.text)
  if (!parsed.network) throw new Error(`The network has errors: ${parsed.errors.join(' ')}`)
  const sim = simulate(parsed.network, { tEnd: req.tEnd, points: 300, logTime: req.logTime, method: req.method })
  if (!sim.ok) throw new Error(sim.message ?? 'The simulation failed.')
  // evenly spread sample points, always including the first and last
  const idx = Array.from({ length: req.samples }, (_, k) => Math.round((k * (sim.t.length - 1)) / (req.samples - 1)))
  const conc: Record<string, number[]> = {}
  sim.species.forEach((s, i) => {
    conc[s] = idx.map((j) => sig(sim.c[j][i], 5))
  })
  return {
    t_end: req.tEnd,
    species: sim.species,
    times: idx.map((j) => sig(sim.t[j], 5)),
    concentrations: conc,
    summary: summarise(sim).map((s) => ({
      species: s.name, initial: sig(s.initial, 5), final: sig(s.final, 5), maximum: sig(s.max, 5), time_of_maximum: sig(s.tMax, 5), ...(s.tHalf !== null ? { half_life: sig(s.tHalf, 5) } : {}),
    })),
    solver: { method: sim.method, steps: sim.steps },
    steps: parsed.network.steps.map((s) => `${s.text} ; ${s.how}`),
    ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
  }
}

// ------------------------------------------------------------------ fit_order

export function fitRequest(args: Record<string, unknown>): { x: number[]; y: number[]; mode: 'order' | 'arrhenius' | 'eyring' } {
  const mode = String(args.mode ?? 'order').toLowerCase()
  if (mode !== 'order' && mode !== 'arrhenius' && mode !== 'eyring') throw new Error('mode must be "order", "arrhenius" or "eyring".')
  let x: number[] = []
  let y: number[] = []
  if (Array.isArray(args.x) && Array.isArray(args.y)) {
    x = args.x.map(Number)
    y = args.y.map(Number)
    if (x.length !== y.length) throw new Error('x and y must have the same number of values.')
  } else if (typeof args.data === 'string') {
    const t = parseTable(args.data)
    x = t.x
    y = t.y
  } else if (Array.isArray(args.data)) {
    for (const row of args.data) {
      if (Array.isArray(row) && row.length >= 2) {
        x.push(Number(row[0]))
        y.push(Number(row[1]))
      }
    }
  }
  if (x.length < 3 || ![...x, ...y].every(Number.isFinite)) throw new Error('Give at least three (x, y) pairs as numbers: data = "0 1.0\\n10 0.6\\n…" or arrays x and y.')
  return { x, y, mode }
}

export function runFit(req: ReturnType<typeof fitRequest>): Record<string, unknown> {
  if (req.mode === 'order') {
    const r = fitOrder(req.x, req.y)
    return {
      mode: 'order',
      conclusion: r.message,
      ...(r.best ? { order: r.best.order, rate_constant: sig(r.best.k, 5), rate_constant_se: sig(r.best.kSE, 3), rate_constant_unit: orderUnit(r.best.order), half_life: sig(r.best.halfLife, 5), initial_concentration_fit: sig(r.best.c0, 5), r_squared: sig(r.best.fit.r2, 6) } : {}),
      ambiguous: r.ambiguous,
      fits: r.fits.map((f) => ({ order: f.order, r_squared: sig(f.fit.r2, 6), rate_constant: sig(f.k, 5), rate_constant_se: sig(f.kSE, 3), half_life: sig(f.halfLife, 5) })),
    }
  }
  if (!req.x.every((v) => v > 0) || !req.y.every((v) => v > 0)) throw new Error('T (kelvin) and k must be above zero.')
  if (req.mode === 'arrhenius') {
    const r = arrhenius(req.x, req.y)
    return { mode: 'arrhenius', activation_energy_kJ_per_mol: sig(r.Ea, 5), activation_energy_se: sig(r.EaSE, 3), pre_exponential_factor: sig(r.A, 5), ln_A: sig(r.lnA, 5), ln_A_se: sig(r.lnASE, 3), k_at_298K: sig(r.k298, 5), r_squared: sig(r.fit.r2, 6) }
  }
  const e = eyring(req.x, req.y)
  return { mode: 'eyring', delta_H_activation_kJ_per_mol: sig(e.dH, 5), delta_H_se: sig(e.dHSE, 3), delta_S_activation_J_per_mol_K: sig(e.dS, 5), delta_S_se: sig(e.dSSE, 3), delta_G_activation_298K_kJ_per_mol: sig(e.dG298, 5), r_squared: sig(e.fit.r2, 6) }
}

// ------------------------------------------------------------------ equilibrium

export function runEquilibrium(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const T = optNum(args.T)
  const dH = optNum(args.dH)
  const dS = optNum(args.dS)
  if (dH !== null && dS !== null && T !== null) {
    const t = thermo(dH, dS, T)
    out.thermodynamics = { delta_G_kJ_per_mol: sig(t.dG, 6), K: sig(t.K, 6), ln_K: sig(t.lnK, 6), verdict: t.verdict, ...(t.crossover !== null ? { crossover_temperature_K: sig(t.crossover, 5) } : {}) }
  }
  const equation = String(args.equation ?? '').trim()
  if (equation !== '') {
    const K = num(args.K, 'K')
    const parsed = parseEquilibrium(equation, String(args.initial ?? ''))
    const r = solveIce(parsed.species, K)
    if (!r.ok) throw new Error(r.message)
    out.reaction = parsed.text
    out.ice_table = r.rows.map((x) => ({ species: x.name, initial: sig(x.initial, 6), change: sig(x.change, 6), equilibrium: sig(x.equilibrium, 6), ...(x.active ? {} : { note: 'pure solid or liquid, not in Q' }) }))
    out.K = K
    out.Q_initial = sig(r.Q0, 6)
    out.direction = r.direction === 'equilibrium' ? 'already at equilibrium' : r.direction === 'forward' ? 'proceeds forward (Q < K)' : 'proceeds in reverse (Q > K)'
    out.extent = sig(r.extent, 6)
    if (r.conversion !== null) out.conversion_of_limiting_species_percent = sig(r.conversion * 100, 5)
    if (T !== null && T > 0 && parsed.dnGas !== 0) out.Kp_from_Kc = sig(kcToKp(K, T, parsed.dnGas), 5)
  }
  if (Object.keys(out).length === 0) throw new Error('Give an equation with initial amounts and K (ICE table), or dH, dS and T (thermodynamics).')
  return out
}

// ------------------------------------------------------------------ predict_products

export function predictionAnswer(preds: Prediction[], reactants: string[]): Record<string, unknown> {
  return {
    reactants,
    outcome_count: preds.length,
    outcomes: preds.map((p) => ({
      reaction_type: p.template.name,
      reactants_smiles: p.reactants,
      products_smiles: p.products,
      also_formed: p.template.byproducts,
      conditions: p.template.conditions,
      note: p.template.rule,
    })),
    ...(preds.length === 0 ? { message: 'No reaction template matches these reactants. Check the functional groups, add the reagent the reaction needs (HBr, BrBr, [OH-], C[Mg]Br…), or look in the library with load_example.' } : {}),
  }
}
