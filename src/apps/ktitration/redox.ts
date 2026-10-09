// Redox titrations (pure): the electrode potential against the added volume from the Nernst equation of both
// couples and the electron balance, solved exactly for every volume (no "before / at / after" shortcuts), with
// dilution, proton-dependent couples (MnO₄⁻, Cr₂O₇²⁻), couples with two reduced species (Cr₂O₇²⁻, I₂, S₄O₆²⁻)
// and the potential at the equivalence point (the weighted mean of the two formal potentials).

import { brent } from './equilibria.ts'
import { redoxIndicatorById, redoxIndicatorColor, type RedoxIndicator } from './data/indicators.ts'

export interface RedoxCouple {
  label: string
  ox: string
  red: string
  /** Standard or formal potential at pH 0 (V). */
  E0: number
  n: number
  /** Protons taken up per oxidised unit. */
  m: number
  /** Reduced species formed per oxidised unit. */
  b: number
}

export interface RedoxSpec {
  analyte: {
    couple: RedoxCouple
    /** The form that is in the flask: a reductant (Fe²⁺) or an oxidant (I₂). */
    start: 'red' | 'ox'
    /** Concentration of that species (mol/L) and the volume taken (mL). */
    conc: number
    volume: number
  }
  /** The titrant is the opposite kind; conc is that of the species as supplied. */
  titrant: { couple: RedoxCouple; conc: number }
  water: number
  /** pH of the solution (matters for couples that consume H⁺). */
  pH: number
  temperature: number
  indicator: string | null
  vmax: number | null
}

/** ln10·RT/F in volts per decade, per electron (0.05916 at 25 °C). */
export const nernstSlope = (T: number) => (Math.LN10 * 8.314462618 * (T + 273.15)) / 96485.33212

/** Formal potential at the working pH: E0 − (k·m/n)·pH. */
export const formalAt = (c: RedoxCouple, pH: number, T = 25) => c.E0 - ((nernstSlope(T) * c.m) / c.n) * pH

/** Fraction of the couple in the oxidised form at potential E when the total is C (mol/L of oxidised units). */
export function oxFraction(E: number, c: RedoxCouple, C: number, pH: number, T = 25): number {
  const logT = (c.n * (E - formalAt(c, pH, T))) / nernstSlope(T) // log10 of [Ox]/[Red]^b
  if (logT > 300) return 1
  if (logT < -300) return 0
  const t = Math.pow(10, logT)
  if (c.b === 1) return t / (1 + t)
  if (c.b === 2) {
    const u = 4 * t * C
    if (!(u > 1e-300)) return 0
    if (u > 1e300) return 1
    return (2 * u) / (2 * u + 1 + Math.sqrt(4 * u + 1))
  }
  // any other b: x C / (b (1−x) C)^b = t, bisect (monotonic in x)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200; i++) {
    const x = (lo + hi) / 2
    const r = (x * C) / Math.pow(c.b * (1 - x) * C, c.b)
    if (r < t) lo = x
    else hi = x
  }
  return (lo + hi) / 2
}

export interface RedoxState {
  /** Moles (mmol) of the analyte and the titrant as oxidised units. */
  Na: number
  rate: number
  V0: number
  Veq: number
}

export function redoxState(spec: RedoxSpec): RedoxState {
  const a = spec.analyte
  const t = spec.titrant
  const Na = (a.conc * a.volume) / (a.start === 'red' ? a.couple.b : 1)
  // the titrant is supplied in the opposite form
  const rate = t.conc / (a.start === 'red' ? 1 : t.couple.b) // mmol of oxidised units per mL
  const V0 = a.volume + spec.water
  const Veq = (a.couple.n * Na) / (t.couple.n * rate)
  return { Na, rate, V0, Veq }
}

/** Electrode potential (V vs SHE) after adding V mL of titrant; NaN before anything is added. */
export function potentialAt(spec: RedoxSpec, V: number): number {
  const { Na, rate, V0 } = redoxState(spec)
  const Nt = rate * V
  if (!(Nt > 0) || !(Na > 0)) return NaN
  const vt = V0 + V
  const a = spec.analyte
  const t = spec.titrant
  const Ca = Na / vt
  const Ct = Nt / vt
  const T = spec.temperature
  const g = (E: number) => {
    const xa = oxFraction(E, a.couple, Ca, spec.pH, T)
    const xt = oxFraction(E, t.couple, Ct, spec.pH, T)
    return a.start === 'red' ? a.couple.n * Na * xa - t.couple.n * Nt * (1 - xt) : a.couple.n * Na * (1 - xa) - t.couple.n * Nt * xt
  }
  return brent(g, -3, 4, 1e-13)
}

/** Equivalence potential by the weighted-mean formula (n₁E₁ + n₂E₂)/(n₁ + n₂), exact when both couples have b = 1. */
export function equivalencePotentialFormula(spec: RedoxSpec): number {
  const a = spec.analyte.couple
  const t = spec.titrant.couple
  return (a.n * formalAt(a, spec.pH, spec.temperature) + t.n * formalAt(t, spec.pH, spec.temperature)) / (a.n + t.n)
}

export function defaultVmaxRedox(spec: RedoxSpec): number {
  if (spec.vmax && spec.vmax > 0) return spec.vmax
  const { Veq } = redoxState(spec)
  return Number.isFinite(Veq) && Veq > 0 ? Veq * 1.6 : 50
}

export interface RedoxCurve {
  V: number[]
  E: number[]
}

export function redoxCurve(spec: RedoxSpec, opts: { n?: number; vmax?: number } = {}): RedoxCurve {
  const vmax = opts.vmax ?? defaultVmaxRedox(spec)
  const n = opts.n ?? 240
  const { Veq } = redoxState(spec)
  const vs = new Set<number>()
  for (let i = 1; i <= n; i++) vs.add((vmax * i) / n)
  if (Veq > 0 && Veq < vmax) {
    const w = Math.max(Veq * 0.05, vmax * 0.01)
    for (let k = -20; k <= 20; k++) {
      const v = Veq + Math.sign(k) * w * Math.pow(Math.abs(k) / 20, 2.2)
      if (v > 0 && v <= vmax) vs.add(v)
    }
    vs.add(Veq)
  }
  vs.add(vmax / 2000)
  const V = [...vs].sort((x, y) => x - y)
  return { V, E: V.map((v) => potentialAt(spec, v)) }
}

export interface RedoxMarks {
  Veq: number
  Eeq: number
  EeqFormula: number
  /** E at half the equivalence volume: the formal potential of the analyte couple when b = 1. */
  Ehalf: number
  /** E at twice the equivalence volume: the formal potential of the titrant couple when b = 1. */
  Edouble: number
  jump: number
}

export function redoxMarks(spec: RedoxSpec): RedoxMarks {
  const { Veq } = redoxState(spec)
  const E = (v: number) => potentialAt(spec, v)
  const lo = E(Veq * 0.999)
  const hi = E(Veq * 1.001)
  return {
    Veq, Eeq: E(Veq), EeqFormula: equivalencePotentialFormula(spec), Ehalf: E(Veq / 2), Edouble: E(Veq * 2),
    jump: Math.abs(hi - lo),
  }
}

/** The volume at which the electrode reaches potential E (V); null when it never does. */
export function volumeAtPotential(spec: RedoxSpec, E: number): number | null {
  const vmax = defaultVmaxRedox(spec) * 3
  const lo = vmax / 1e5
  const f = (v: number) => potentialAt(spec, v) - E
  const a = f(lo)
  const b = f(vmax)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a * b > 0) return null
  return brent(f, lo, vmax, 1e-10)
}

export interface RedoxEndpoint {
  indicator: RedoxIndicator | null
  /** Transition range in volts (E0 ± 3 × slope/n, where the colour mixes). */
  range: [number, number] | null
  V: number | null
  errorPercent: number | null
}

export function redoxEndpoint(spec: RedoxSpec, indicatorId: string | null = spec.indicator): RedoxEndpoint {
  const ind = redoxIndicatorById(indicatorId) ?? null
  if (!ind) return { indicator: null, range: null, V: null, errorPercent: null }
  const k = nernstSlope(spec.temperature)
  const width = (k * 1) / ind.n // ±1 decade of the ratio
  const V = volumeAtPotential(spec, ind.E0)
  const { Veq } = redoxState(spec)
  return { indicator: ind, range: [ind.E0 - width, ind.E0 + width], V, errorPercent: V === null ? null : (100 * (V - Veq)) / Veq }
}

/** Colour of the flask at volume V, from the indicator (or the water colour with none). */
export function redoxColor(spec: RedoxSpec, V: number): string {
  const ind = redoxIndicatorById(spec.indicator)
  if (!ind) return '#d9ecf5'
  const E = potentialAt(spec, Math.max(V, 1e-9))
  return redoxIndicatorColor(ind, Number.isFinite(E) ? E : ind.E0 - 1, spec.temperature)
}

/** Suitable indicators: those whose E0 lies within the steep part of the curve. Sorted by endpoint error. */
export function suitableRedoxIndicators(spec: RedoxSpec, list: readonly RedoxIndicator[]): Array<{ ind: RedoxIndicator; errorPercent: number | null }> {
  return list
    .map((ind) => ({ ind, errorPercent: redoxEndpoint(spec, ind.id).errorPercent }))
    .sort((a, b) => Math.abs(a.errorPercent ?? 1e9) - Math.abs(b.errorPercent ?? 1e9))
}
