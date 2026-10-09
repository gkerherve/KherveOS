// Precipitation titrations (pure): silver nitrate against halides and other anions (mixtures too), thiocyanate
// against silver (Volhard), with the Mohr (chromate) and Volhard (iron(III)) end points. The free silver (or
// thiocyanate) concentration is solved from the exact mass balance with every solid in equilibrium, so the
// curve is correct before, at and after the equivalence point and for mixtures of precipitates.

import { precipitateById } from './data/metals.ts'
import { mixColors } from './format.ts'

export interface PrecipAnion {
  /** Id of the silver salt in data/metals.ts (agcl, agbr, agi, agscn, agcn…). */
  salt: string
  conc: number
  volume: number
}

export interface PrecipSpec {
  /** Silver nitrate added to anions, or thiocyanate added to silver (Volhard). */
  mode: 'silver-titrant' | 'thiocyanate-titrant'
  /** silver-titrant: the anions in the flask. */
  anions: PrecipAnion[]
  /** thiocyanate-titrant: the silver in the flask. */
  silver: { conc: number; volume: number }
  titrantConc: number
  water: number
  indicator: 'mohr' | 'volhard' | null
  /** Chromate in the flask (mol/L of the total volume at the start; Mohr). */
  chromate: number
  /** Iron(III) in the flask (mol/L; Volhard). */
  iron: number
  vmax: number | null
}

export const KSP_AG2CRO4 = precipitateById('ag2cro4')?.Ksp ?? 1.12e-12
export const KSP_AGSCN = precipitateById('agscn')?.Ksp ?? 1.03e-12
/** Formation constant of FeSCN²⁺ and the concentration at which its red colour is seen (Skoog). */
export const K_FESCN = 138
export const FESCN_VISIBLE = 6.4e-6

export interface Partner {
  /** Total concentration of the partner (mol/L). */
  c: number
  Ksp: number
  /** Free species consumed per formula unit of solid (Ag⁺ per Ag₂CrO₄: 2). */
  nf: number
}

/** Free concentration f of the added species given its total, with each partner precipitating when f^nf·[partner] reaches Ksp. */
export function solveFree(total: number, partners: readonly Partner[]): number {
  if (!(total > 0)) return 0
  const g = (logf: number) => {
    const f = Math.pow(10, logf)
    let t = f
    for (const p of partners) {
      if (!(p.c > 0)) continue
      const free = p.Ksp / Math.pow(f, p.nf)
      if (free < p.c) t += p.nf * (p.c - free)
    }
    return t - total
  }
  let lo = -60
  let hi = Math.log10(total)
  if (g(hi) < 0) hi += 1e-9 // the unprecipitated limit
  // g increases with f
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (g(mid) < 0) lo = mid
    else hi = mid
    if (hi - lo < 1e-14) break
  }
  return Math.pow(10, (lo + hi) / 2)
}

const kspOf = (salt: string) => precipitateById(salt)?.Ksp ?? NaN
const nCatOf = (salt: string) => precipitateById(salt)?.nCat ?? 1

export interface PrecipState {
  V0: number
  /** Equivalence volumes, in the order the solids form, with the salt. */
  eq: Array<{ V: number; salt: string; label: string }>
}

export function precipState(spec: PrecipSpec): PrecipState {
  const V0 = (spec.mode === 'silver-titrant' ? spec.anions.reduce((s, a) => s + a.volume, 0) : spec.silver.volume) + spec.water
  const eq: PrecipState['eq'] = []
  if (spec.mode === 'silver-titrant') {
    let cum = 0
    // the least soluble solid (smallest Ksp per mole of anion) forms first
    for (const a of [...spec.anions].sort((x, y) => kspOf(x.salt) - kspOf(y.salt))) {
      cum += (a.conc * a.volume * nCatOf(a.salt)) / spec.titrantConc
      eq.push({ V: cum, salt: a.salt, label: precipitateById(a.salt)?.formula ?? a.salt })
    }
  } else {
    eq.push({ V: (spec.silver.conc * spec.silver.volume) / spec.titrantConc, salt: 'agscn', label: 'AgSCN' })
  }
  return { V0, eq }
}

export interface PrecipSolution {
  /** Free [Ag⁺] and the pAg. */
  Ag: number
  pAg: number
  /** Free concentration of the titrant's partner species. */
  free: number
  /** Precipitated amount of each solid (mmol), AgX in the order of the spec; the Mohr chromate last. */
  precipitated: number[]
  chromatePpt: number
  fescn: number
}

export function precipAt(spec: PrecipSpec, V: number): PrecipSolution {
  const { V0 } = precipState(spec)
  const vt = V0 + Math.max(0, V)
  const total = (spec.titrantConc * Math.max(0, V)) / vt
  if (spec.mode === 'silver-titrant') {
    const partners: Partner[] = spec.anions.map((a) => ({ c: (a.conc * a.volume) / vt, Ksp: kspOf(a.salt), nf: nCatOf(a.salt) }))
    const cr = (spec.chromate * V0) / vt
    const withChromate = spec.indicator === 'mohr' && spec.chromate > 0 ? [...partners, { c: cr, Ksp: KSP_AG2CRO4, nf: 2 }] : partners
    const Ag = solveFree(total, withChromate)
    const precipitated = partners.map((p) => (Ag > 0 && p.Ksp / Math.pow(Ag, p.nf) < p.c ? (p.c - p.Ksp / Math.pow(Ag, p.nf)) * vt : 0))
    const chromatePpt = spec.indicator === 'mohr' && spec.chromate > 0 && Ag > 0 && KSP_AG2CRO4 / (Ag * Ag) < cr ? (cr - KSP_AG2CRO4 / (Ag * Ag)) * vt : 0
    return { Ag, pAg: Ag > 0 ? -Math.log10(Ag) : NaN, free: Ag, precipitated, chromatePpt, fescn: 0 }
  }
  const cAg = (spec.silver.conc * spec.silver.volume) / vt
  const scn = solveFree(total, [{ c: cAg, Ksp: KSP_AGSCN, nf: 1 }])
  const Ag = scn > 0 ? Math.min(cAg, KSP_AGSCN / scn) : cAg
  const ppt = scn > 0 && KSP_AGSCN / scn < cAg ? (cAg - KSP_AGSCN / scn) * vt : 0
  const fe = (spec.iron * V0) / vt
  return { Ag, pAg: -Math.log10(Ag), free: scn, precipitated: [ppt], chromatePpt: 0, fescn: spec.indicator === 'volhard' ? K_FESCN * fe * scn : 0 }
}

export function defaultVmaxPrecip(spec: PrecipSpec): number {
  if (spec.vmax && spec.vmax > 0) return spec.vmax
  const eq = precipState(spec).eq
  const last = eq[eq.length - 1]?.V ?? 0
  return last > 0 ? last * 1.5 : 50
}

export interface PrecipCurve {
  V: number[]
  pAg: number[]
}

export function precipCurve(spec: PrecipSpec, opts: { n?: number; vmax?: number } = {}): PrecipCurve {
  const vmax = opts.vmax ?? defaultVmaxPrecip(spec)
  const n = opts.n ?? 240
  const vs = new Set<number>()
  for (let i = 1; i <= n; i++) vs.add((vmax * i) / n)
  for (const e of precipState(spec).eq) {
    if (e.V <= 0 || e.V > vmax) continue
    const w = Math.max(e.V * 0.05, vmax * 0.01)
    for (let k = -20; k <= 20; k++) {
      const v = e.V + Math.sign(k) * w * Math.pow(Math.abs(k) / 20, 2.2)
      if (v > 0 && v <= vmax) vs.add(v)
    }
    vs.add(e.V)
  }
  vs.add(vmax / 3000)
  const V = [...vs].sort((x, y) => x - y)
  return { V, pAg: V.map((v) => precipAt(spec, v).pAg) }
}

export interface PrecipEndpoint {
  indicator: 'mohr' | 'volhard' | null
  /** Volume at which the end point colour appears. */
  V: number | null
  /** Judged against the last equivalence point. */
  Veq: number
  errorPercent: number | null
  /** [Ag⁺] (Mohr) or [SCN⁻] (Volhard) at the end point. */
  atEnd: number | null
}

/** Where the Mohr (Ag₂CrO₄) or Volhard (FeSCN²⁺) end point shows. */
export function precipEndpoint(spec: PrecipSpec): PrecipEndpoint {
  const { V0, eq } = precipState(spec)
  const Veq = eq[eq.length - 1]?.V ?? NaN
  if (!spec.indicator) return { indicator: null, V: null, Veq, errorPercent: null, atEnd: null }
  const vmax = defaultVmaxPrecip(spec) * 2
  let h: (v: number) => number
  if (spec.indicator === 'mohr' && spec.mode === 'silver-titrant') {
    // free [Ag⁺] of the titration without chromate against the [Ag⁺] that makes Ag₂CrO₄ precipitate
    const plain: PrecipSpec = { ...spec, indicator: null }
    h = (v) => {
      const vt = V0 + v
      const need = Math.sqrt(KSP_AG2CRO4 / ((spec.chromate * V0) / vt))
      return Math.log10(Math.max(precipAt(plain, v).Ag, 1e-300)) - Math.log10(need)
    }
  } else if (spec.indicator === 'volhard' && spec.mode === 'thiocyanate-titrant') {
    h = (v) => {
      const vt = V0 + v
      const fe = (spec.iron * V0) / vt
      const need = FESCN_VISIBLE / (K_FESCN * fe)
      return Math.log10(Math.max(precipAt(spec, v).free, 1e-300)) - Math.log10(need)
    }
  } else return { indicator: spec.indicator, V: null, Veq, errorPercent: null, atEnd: null }
  let lo = vmax / 1e6
  let hi = vmax
  if (!(h(lo) < 0 && h(hi) > 0)) return { indicator: spec.indicator, V: null, Veq, errorPercent: null, atEnd: null }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (h(mid) < 0) lo = mid
    else hi = mid
  }
  const V = (lo + hi) / 2
  const sol = precipAt(spec.indicator === 'mohr' ? { ...spec, indicator: null } : spec, V)
  return { indicator: spec.indicator, V, Veq, errorPercent: (100 * (V - Veq)) / Veq, atEnd: spec.indicator === 'mohr' ? sol.Ag : sol.free }
}

/** Look of the flask: colour (yellow chromate → brick red; Fe³⁺ pale → blood red) and how cloudy it is (0–1). */
export function precipLook(spec: PrecipSpec, V: number): { color: string; cloud: number } {
  const sol = precipAt(spec, V)
  const totalPossible = spec.mode === 'silver-titrant' ? spec.anions.reduce((s, a) => s + a.conc * a.volume, 0) : spec.silver.conc * spec.silver.volume
  const ppt = sol.precipitated.reduce((s, x) => s + x, 0)
  const cloud = totalPossible > 0 ? Math.min(1, ppt / totalPossible) : 0
  if (spec.indicator === 'mohr') {
    const red = Math.min(1, sol.chromatePpt / Math.max(1e-9, spec.chromate * precipState(spec).V0 * 0.02))
    return { color: mixColors('#e9dc5a', '#b8452f', red), cloud }
  }
  if (spec.indicator === 'volhard') return { color: mixColors('#efe6b8', '#b3262a', Math.min(1, sol.fescn / FESCN_VISIBLE)), cloud }
  return { color: '#d9ecf5', cloud }
}
