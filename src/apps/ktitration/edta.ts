// Complexometric (EDTA) titrations (pure): the conditional formation constant K′ = K·α(Y⁴⁻)/α(M), the pM curve
// from the exact mass balance with dilution, metal indicators (Eriochrome Black T) and the titration error.

import { alphas, brent, pKw } from './equilibria.ts'
import { EDTA_PKA } from './data/metals.ts'
import { logConditionalIndicator, metalIndicatorById } from './data/indicators.ts'
import { mixColors } from './format.ts'

export interface EdtaMetal {
  symbol: string
  ion: string
  logKMY: number
  hydroxo: number[]
  ammine: number[]
}

export interface EdtaSpec {
  metal: EdtaMetal
  /** Metal ion concentration (mol/L) and sample volume (mL). */
  conc: number
  volume: number
  water: number
  titrantConc: number
  /** Buffered pH. */
  pH: number
  /** Total ammonia + ammonium of the buffer (mol/L): complexes Cu, Ni, Zn, Cd, Co. 0 = none. */
  ammonia: number
  /** Indicator id (data/indicators.ts) or 'custom' (then customLogK) or null. */
  indicator: string | null
  /** log K′ of the M–In complex for a custom indicator (it changes colour at pM = this). */
  customLogK: number
  vmax: number | null
}

const EDTA_SYSTEM = { label: 'EDTA', pKa: EDTA_PKA, z0: 2 }

/** Fraction of EDTA present as Y⁴⁻ at a pH. */
export const alphaY = (pH: number) => {
  const a = alphas(EDTA_SYSTEM, pH, 0)
  return a[a.length - 1]
}

/** Side-reaction coefficient of the metal: 1 + Σβ[OH⁻]ⁿ + Σβ[NH₃]ⁿ. */
export function alphaM(metal: EdtaMetal, pH: number, ammonia: number): number {
  const oh = Math.pow(10, pH - pKw(25))
  let a = 1
  metal.hydroxo.forEach((lb, i) => { a += Math.pow(10, lb) * Math.pow(oh, i + 1) })
  const nh3 = ammonia / (1 + Math.pow(10, 9.25 - pH))
  metal.ammine.forEach((lb, i) => { a += Math.pow(10, lb) * Math.pow(nh3, i + 1) })
  return a
}

/** log K′ of the metal–EDTA complex at the pH. */
export function logConditional(spec: EdtaSpec): number {
  return spec.metal.logKMY + Math.log10(alphaY(spec.pH)) - Math.log10(alphaM(spec.metal, spec.pH, spec.ammonia))
}

export const equivalenceVolumeEdta = (spec: EdtaSpec) => (spec.conc * spec.volume) / spec.titrantConc

/** pM = −log[M] (free metal ion) after adding V mL of EDTA. */
export function pMAt(spec: EdtaSpec, V: number): number {
  const vt = spec.volume + spec.water + Math.max(0, V)
  const cM = (spec.conc * spec.volume) / vt
  const cY = (spec.titrantConc * Math.max(0, V)) / vt
  const aM = alphaM(spec.metal, spec.pH, spec.ammonia)
  const K = Math.pow(10, logConditional(spec))
  // K′ m′² + (K′(cY − cM) + 1) m′ − cM = 0, m′ = the metal not bound to EDTA (all its forms)
  const bq = K * (cY - cM) + 1
  const mPrime = (2 * cM) / (bq + Math.sqrt(bq * bq + 4 * K * cM))
  return -Math.log10(mPrime / aM)
}

export function defaultVmaxEdta(spec: EdtaSpec): number {
  if (spec.vmax && spec.vmax > 0) return spec.vmax
  const v = equivalenceVolumeEdta(spec)
  return Number.isFinite(v) && v > 0 ? v * 1.6 : 50
}

export interface EdtaCurve {
  V: number[]
  pM: number[]
}

export function edtaCurve(spec: EdtaSpec, opts: { n?: number; vmax?: number } = {}): EdtaCurve {
  const vmax = opts.vmax ?? defaultVmaxEdta(spec)
  const n = opts.n ?? 240
  const Veq = equivalenceVolumeEdta(spec)
  const vs = new Set<number>()
  for (let i = 0; i <= n; i++) vs.add((vmax * i) / n)
  if (Veq > 0 && Veq < vmax) {
    const w = Math.max(Veq * 0.05, vmax * 0.01)
    for (let k = -20; k <= 20; k++) {
      const v = Veq + Math.sign(k) * w * Math.pow(Math.abs(k) / 20, 2.2)
      if (v >= 0 && v <= vmax) vs.add(v)
    }
    vs.add(Veq)
  }
  const V = [...vs].sort((x, y) => x - y)
  return { V, pM: V.map((v) => pMAt(spec, v)) }
}

export interface EdtaMarks {
  Veq: number
  logKcond: number
  alphaY: number
  alphaM: number
  pM0: number
  pMeq: number
  /** ½(log K′ + pC_M) + log α_M, with C_M the metal concentration at the equivalence point. */
  pMeqFormula: number
  jump: number
}

export function edtaMarks(spec: EdtaSpec): EdtaMarks {
  const Veq = equivalenceVolumeEdta(spec)
  const aM = alphaM(spec.metal, spec.pH, spec.ammonia)
  const cEq = (spec.conc * spec.volume) / (spec.volume + spec.water + Veq)
  const lk = logConditional(spec)
  return {
    Veq, logKcond: lk, alphaY: alphaY(spec.pH), alphaM: aM, pM0: pMAt(spec, 0), pMeq: pMAt(spec, Veq),
    pMeqFormula: 0.5 * (lk - Math.log10(cEq)) + Math.log10(aM), jump: pMAt(spec, Veq * 1.001) - pMAt(spec, Veq * 0.999),
  }
}

/** The pM at which the indicator changes colour (log K′ of the M–In complex), or null. */
export function indicatorPM(spec: EdtaSpec): number | null {
  if (spec.indicator === 'custom') return spec.customLogK
  const ind = metalIndicatorById(spec.indicator)
  return ind ? logConditionalIndicator(ind, spec.metal.symbol, spec.pH) : null
}

export function volumeAtPM(spec: EdtaSpec, pM: number): number | null {
  const vmax = defaultVmaxEdta(spec) * 2
  const f = (v: number) => pMAt(spec, v) - pM
  if (f(0) > 0) return 0
  const b = f(vmax)
  if (!(b >= 0)) return null
  return brent(f, 0, vmax, 1e-10)
}

export interface EdtaEndpoint {
  pM: number | null
  V: number | null
  errorPercent: number | null
}

export function edtaEndpoint(spec: EdtaSpec): EdtaEndpoint {
  const pM = indicatorPM(spec)
  if (pM === null) return { pM: null, V: null, errorPercent: null }
  const V = volumeAtPM(spec, pM)
  const Veq = equivalenceVolumeEdta(spec)
  return { pM, V, errorPercent: V === null ? null : (100 * (V - Veq)) / Veq }
}

/** Colour of the flask: the indicator's metal complex colour while free metal remains, the free colour after. */
export function edtaColor(spec: EdtaSpec, V: number): string {
  const ind = metalIndicatorById(spec.indicator === 'custom' ? 'ebt' : spec.indicator)
  if (!ind || indicatorPM(spec) === null) return '#d9ecf5'
  const logK = indicatorPM(spec) as number
  const bound = 1 / (1 + Math.pow(10, pMAt(spec, V) - logK)) // fraction of the indicator on the metal
  return mixColors(ind.free, ind.bound, bound)
}
