// Thermodynamics and chemical equilibrium: ΔG = ΔH − TΔS, K = exp(−ΔG/RT), the van 't Hoff equation, Kp ⇄ Kc,
// and an ICE-table solver that finds the exact equilibrium (root of ln Q − ln K) for any stoichiometry, with
// the Q-versus-K direction and Le Chatelier disturbances. Pure functions.

import { R_J, R_L_ATM, R_L_BAR } from './constants.ts'

// ------------------------------------------------------------------ thermodynamics

export interface Thermo {
  dH: number
  dS: number
  T: number
  /** kJ/mol */
  dG: number
  K: number
  lnK: number
  /** Temperature at which ΔG = 0 (K), or null when ΔH and ΔS have the same sign only... see `crossover`. */
  crossover: number | null
  verdict: string
}

/** ΔG° = ΔH° − TΔS° (kJ/mol; ΔS in J/(mol K)) and K = exp(−ΔG°/RT). */
export function thermo(dH: number, dS: number, T: number): Thermo {
  const dG = dH - (T * dS) / 1000
  const lnK = (-dG * 1000) / (R_J * T)
  const crossover = dS !== 0 && dH / (dS / 1000) > 0 ? dH / (dS / 1000) : null
  let verdict: string
  if (dH < 0 && dS > 0) verdict = 'Spontaneous at every temperature (exothermic, entropy increases).'
  else if (dH > 0 && dS < 0) verdict = 'Not spontaneous at any temperature (endothermic, entropy decreases).'
  else if (dH < 0 && dS < 0) verdict = `Spontaneous below ${crossover === null ? '—' : `${crossover.toFixed(0)} K`} (enthalpy driven); the −TΔS term wins above it.`
  else if (dH > 0 && dS > 0) verdict = `Spontaneous above ${crossover === null ? '—' : `${crossover.toFixed(0)} K`} (entropy driven).`
  else verdict = dG < 0 ? 'Spontaneous.' : 'Not spontaneous.'
  return { dH, dS, T, dG, K: Math.exp(lnK), lnK, crossover, verdict }
}

/** ΔG° (kJ/mol) from K at temperature T. */
export function dGFromK(K: number, T: number): number {
  return (-R_J * T * Math.log(K)) / 1000
}

/** van 't Hoff: K at T2 from K at T1 and ΔH (kJ/mol, taken constant). */
export function vantHoffK2(K1: number, T1: number, T2: number, dH: number): number {
  return K1 * Math.exp(((-dH * 1000) / R_J) * (1 / T2 - 1 / T1))
}

/** ΔH (kJ/mol) from the equilibrium constants at two temperatures. */
export function vantHoffDH(K1: number, T1: number, K2: number, T2: number): number {
  return (-R_J * Math.log(K2 / K1)) / (1 / T2 - 1 / T1) / 1000
}

export type PressureUnit = 'atm' | 'bar'

/** Kp = Kc (RT)^Δn with concentrations in mol/L and pressures in atm or bar. */
export function kcToKp(Kc: number, T: number, dn: number, unit: PressureUnit = 'atm'): number {
  return Kc * Math.pow((unit === 'atm' ? R_L_ATM : R_L_BAR) * T, dn)
}

export function kpToKc(Kp: number, T: number, dn: number, unit: PressureUnit = 'atm'): number {
  return Kp / Math.pow((unit === 'atm' ? R_L_ATM : R_L_BAR) * T, dn)
}

// ------------------------------------------------------------------ ICE table

export interface EqSpecies {
  name: string
  /** Signed stoichiometric coefficient: negative for reactants, positive for products. */
  nu: number
  /** Initial concentration or partial pressure. */
  initial: number
  /** Pure solids and liquids do not appear in Q. */
  active: boolean
  /** Gas (for Δn and the volume disturbance). */
  gas: boolean
}

export interface IceRow {
  name: string
  nu: number
  initial: number
  change: number
  equilibrium: number
  active: boolean
}

export interface IceResult {
  ok: boolean
  message: string
  /** Extent ξ (concentration units). */
  extent: number
  rows: IceRow[]
  K: number
  Q0: number
  Q: number
  /** Direction the mixture moves from its initial state. */
  direction: 'forward' | 'reverse' | 'equilibrium'
  /** Fraction of the limiting reactant converted (0..1), when there is one. */
  conversion: number | null
}

/** Reaction quotient of the active species at extent ξ (Infinity / 0 at the edges). */
export function quotient(sp: EqSpecies[], xi: number): number {
  let lnQ = 0
  for (const s of sp) {
    if (!s.active) continue
    const c = s.initial + s.nu * xi
    if (c <= 0) return s.nu > 0 ? 0 : Infinity
    lnQ += s.nu * Math.log(c)
  }
  return Math.exp(lnQ)
}

function lnQ(sp: EqSpecies[], xi: number): number {
  let l = 0
  for (const s of sp) {
    if (!s.active) continue
    const c = s.initial + s.nu * xi
    if (c <= 0) return s.nu > 0 ? -Infinity : Infinity
    l += s.nu * Math.log(c)
  }
  return l
}

/** Solves the equilibrium composition: the unique ξ with Q(ξ) = K inside the physical range. */
export function solveIce(sp: EqSpecies[], K: number): IceResult {
  const fail = (message: string): IceResult => ({
    ok: false, message, extent: 0, rows: sp.map((s) => ({ name: s.name, nu: s.nu, initial: s.initial, change: 0, equilibrium: s.initial, active: s.active })),
    K, Q0: NaN, Q: NaN, direction: 'equilibrium', conversion: null,
  })
  if (sp.length < 2) return fail('Give at least two species.')
  if (sp.some((s) => s.nu === 0 || !Number.isFinite(s.nu))) return fail('Every species needs a non-zero coefficient.')
  if (sp.some((s) => s.initial < 0 || !Number.isFinite(s.initial))) return fail('Initial amounts cannot be negative.')
  if (!(K > 0) || !Number.isFinite(K)) return fail('K must be a positive number.')
  const active = sp.filter((s) => s.active)
  if (!active.some((s) => s.nu < 0) || !active.some((s) => s.nu > 0)) {
    return fail('Q needs at least one reactant and one product that are gases or dissolved (pure solids and liquids do not count).')
  }
  // physical range of the extent: every species stays ≥ 0
  let lo = -Infinity
  let hi = Infinity
  for (const s of sp) {
    const bound = -s.initial / s.nu
    if (s.nu > 0) lo = Math.max(lo, bound)
    else hi = Math.min(hi, bound)
  }
  if (!(lo < hi)) return fail('Nothing can react: the amounts leave no room for the reaction to move in either direction.')
  const Q0 = quotient(sp, 0)
  const target = Math.log(K)
  // f(ξ) = ln Q − ln K is strictly increasing on (lo, hi): bisection (a product at zero gives −∞, a reactant at zero +∞)
  const f = (x: number) => lnQ(sp, x) - target
  let a = lo
  let b = hi
  for (let it = 0; it < 600; it++) {
    const m = 0.5 * (a + b)
    if (m === a || m === b) break
    if (f(m) < 0) a = m
    else b = m
    if (b - a <= 1e-16 * Math.max(Math.abs(a), Math.abs(b))) break
  }
  const xi = 0.5 * (a + b)
  const rows: IceRow[] = sp.map((s) => ({ name: s.name, nu: s.nu, initial: s.initial, change: s.nu * xi, equilibrium: Math.max(0, s.initial + s.nu * xi), active: s.active }))
  const Q = quotient(sp, xi)
  const direction = Math.abs(Math.log(Q0) - target) < 1e-9 ? 'equilibrium' : Q0 < K ? 'forward' : 'reverse'
  // conversion of the species consumed in the direction of travel
  let conversion: number | null = null
  const consumed = sp.filter((s) => s.initial > 0 && s.nu * xi < 0)
  if (consumed.length) conversion = Math.max(...consumed.map((s) => Math.min(1, (-s.nu * xi) / s.initial)))
  return { ok: true, message: '', extent: xi, rows, K, Q0, Q, direction, conversion }
}

export interface ParsedEquilibrium {
  species: EqSpecies[]
  /** Δn of the gases (products − reactants). */
  dnGas: number
  /** Text of the reaction with the arrow normalised. */
  text: string
}

/** "N2O4(g) <=> 2 NO2(g)" and "N2O4 = 0.1, NO2 = 0" → species with coefficients and initial amounts. */
export function parseEquilibrium(equation: string, initial: string): ParsedEquilibrium {
  const m = /^(.*?)\s*(<=>|<->|⇌|⇄|=|->|→)\s*(.*)$/.exec(equation.trim())
  if (!m) throw new Error('Write the reaction with an arrow, e.g.  N2O4 <=> 2 NO2')
  const parseSide = (side: string, sign: number): EqSpecies[] =>
    side.split(/\s+\+\s+|\s*\+\s*(?=\d*[A-Za-z(\[])/).map((raw) => raw.trim()).filter(Boolean).map((raw) => {
      const t = /^(\d+(?:\.\d+)?)?\s*(.+?)$/.exec(raw)
      if (!t) throw new Error(`"${raw}" is not a species.`)
      const nu = (t[1] ? Number(t[1]) : 1) * sign
      let name = t[2].trim()
      const ph = /\((s|l|g|aq)\)$/i.exec(name)
      const phase = ph ? ph[1].toLowerCase() : ''
      name = name.replace(/\((s|l|g|aq)\)$/i, '')
      return { name, nu, initial: 0, active: phase !== 's' && phase !== 'l', gas: phase === 'g' || phase === '' }
    })
  const species = [...parseSide(m[1], -1), ...parseSide(m[3], 1)]
  if (species.length < 2) throw new Error('A reaction needs species on both sides.')
  const names = new Set<string>()
  for (const s of species) {
    if (names.has(s.name)) throw new Error(`${s.name} appears twice: write it once with its coefficient.`)
    names.add(s.name)
  }
  for (const part of initial.split(/[,;\n]+/)) {
    const t = part.trim()
    if (!t) continue
    const kv = /^(.+?)\s*[=:]\s*(.+)$/.exec(t)
    if (!kv) throw new Error(`"${t}" is not an initial amount (write  N2O4 = 0.1 ).`)
    const sp = species.find((s) => s.name === kv[1].replace(/\((s|l|g|aq)\)$/i, '').trim() || s.name === kv[1].trim())
    if (!sp) throw new Error(`${kv[1].trim()} is not in the reaction.`)
    const v = Number(kv[2].replace(',', '.'))
    if (!Number.isFinite(v) || v < 0) throw new Error(`"${kv[2]}" is not a valid amount.`)
    sp.initial = v
  }
  const dnGas = species.filter((s) => s.gas && s.active).reduce((a, s) => a + s.nu, 0)
  return { species, dnGas, text: `${species.filter((s) => s.nu < 0).map((s) => `${-s.nu === 1 ? '' : -s.nu + ' '}${s.name}`).join(' + ')} ⇌ ${species.filter((s) => s.nu > 0).map((s) => `${s.nu === 1 ? '' : s.nu + ' '}${s.name}`).join(' + ')}` }
}

// ------------------------------------------------------------------ Le Chatelier

export type Disturbance =
  | { kind: 'add'; species: string; amount: number }
  | { kind: 'volume'; factor: number }
  | { kind: 'temperature'; T1: number; T2: number; dH: number }

export interface Shift {
  /** Direction the equilibrium moves after the disturbance. */
  direction: 'forward' | 'reverse' | 'none'
  explanation: string
  /** New equilibrium. */
  result: IceResult
  K2: number
}

/** Applies a disturbance to an equilibrium mixture and solves the new equilibrium. */
export function leChatelier(sp: EqSpecies[], K: number, eq: IceResult, d: Disturbance): Shift {
  const at = sp.map((s, i) => ({ ...s, initial: eq.rows[i].equilibrium }))
  let K2 = K
  let msg = ''
  if (d.kind === 'add') {
    const s = at.find((x) => x.name === d.species)
    if (!s) throw new Error(`${d.species} is not in the reaction.`)
    s.initial = Math.max(0, s.initial + d.amount)
    msg = `${d.amount >= 0 ? 'Adding' : 'Removing'} ${Math.abs(d.amount)} of ${d.species}`
  } else if (d.kind === 'volume') {
    if (!(d.factor > 0)) throw new Error('The volume factor must be above zero.')
    for (const s of at) if (s.gas) s.initial /= d.factor
    msg = `${d.factor < 1 ? 'Compressing' : 'Expanding'} the gas mixture to ${d.factor}× its volume`
  } else {
    K2 = vantHoffK2(K, d.T1, d.T2, d.dH)
    msg = `Changing the temperature from ${d.T1} K to ${d.T2} K (ΔH = ${d.dH} kJ/mol) changes K from ${K.toPrecision(4)} to ${K2.toPrecision(4)}`
  }
  const result = solveIce(at, K2)
  const q = quotient(at, 0)
  let direction: Shift['direction'] = 'none'
  if (Math.abs(Math.log(q / K2)) > 1e-9) direction = q < K2 ? 'forward' : 'reverse'
  const why =
    direction === 'none' ? 'Q stays equal to K, so nothing shifts.'
      : `Q = ${q.toPrecision(4)} is ${q < K2 ? 'smaller' : 'larger'} than K = ${K2.toPrecision(4)}, so the reaction moves ${direction === 'forward' ? 'forward (towards the products)' : 'in reverse (towards the reactants)'}.`
  return { direction, explanation: `${msg}. ${why}`, result, K2 }
}
