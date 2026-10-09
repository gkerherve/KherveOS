// Acid–base titrations (pure): the flask (any mixture of strong and weak acids and bases), a strong or weak
// titrant, the exact pH at every added volume from the charge balance (with dilution, optional activities and
// temperature), the equivalence points from the stoichiometry, half-equivalence points and buffer regions,
// derivatives, and the error made by an indicator.

import {
  counterIons, kw, pKw, pKaAt, solve, brent,
  type ActivityModel, type Dissolved, type Ion, type Medium, type Solution, type System,
} from './equilibria.ts'

export interface WeakItem {
  kind: 'weak'
  label: string
  pKa: number[]
  z0: number
  /** Which species was weighed in (0 = fully protonated, pKa.length = fully deprotonated). */
  form: number
  /** Concentration (mol/L) of the solution taken, and its volume (mL): the amount is conc × volume. */
  conc: number
  volume: number
  dpKadT?: number[]
  /** Id of the pKa database entry, when it came from there. */
  lib?: string
}

export interface StrongItem {
  kind: 'strong-acid' | 'strong-base'
  label: string
  /** Equivalents per litre (mol H⁺ or OH⁻ per L). */
  conc: number
  volume: number
}

export type Item = WeakItem | StrongItem

export interface Titrant {
  kind: 'strong-base' | 'strong-acid' | 'weak-base' | 'weak-acid'
  label: string
  conc: number
  /** For a weak titrant: its constants and the form it is supplied as. */
  pKa?: number[]
  z0?: number
  form?: number
  dpKadT?: number[]
  /** Equivalents of acid or base per mole, for a weak titrant (default 1). */
  eq?: number
}

export interface AcidBaseSpec {
  items: Item[]
  /** Water added to the flask before the titration (mL). */
  water: number
  titrant: Titrant
  /** °C. */
  temperature: number
  activity: ActivityModel
  /** Inert 1:1 electrolyte kept at this concentration (mol/L), e.g. 0.1 M KCl. */
  background: number
  /** Last volume of the curve (mL); null = automatic. */
  vmax: number | null
  /** Id of the indicator (data/indicators.ts) or null. */
  indicator: string | null
}

export const isWeak = (i: Item): i is WeakItem => i.kind === 'weak'

export function weakSystem(i: { label: string; pKa: number[]; z0: number; dpKadT?: number[] }): System {
  return { label: i.label, pKa: i.pKa, z0: i.z0, ...(i.dpKadT ? { dpKadT: i.dpKadT } : {}) }
}

export const mediumOf = (spec: AcidBaseSpec): Medium => ({ T: spec.temperature, activity: spec.activity })

/** The titrant adds base (raises the pH) or acid. */
export const titrantAdds = (t: Titrant): 'base' | 'acid' => (t.kind === 'strong-base' || t.kind === 'weak-base' ? 'base' : 'acid')

/** Volume of the flask before titrant is added (mL). */
export const flaskVolume = (spec: AcidBaseSpec) => spec.items.reduce((s, i) => s + i.volume, 0) + spec.water

/** Amounts of the flask in mmol. */
export function amounts(spec: AcidBaseSpec) {
  let strongAcid = 0
  let strongBase = 0
  let protons = 0
  for (const i of spec.items) {
    const n = i.conc * i.volume
    if (i.kind === 'strong-acid') strongAcid += n
    else if (i.kind === 'strong-base') strongBase += n
    else if (i.kind === 'weak') protons += n * (i.pKa.length - i.form)
  }
  return { strongAcid, strongBase, weakProtons: protons, Q0: strongAcid - strongBase + protons }
}

// ---------------------------------------------------------------------------------------------- the pH at a volume

export interface Prepared {
  at(V: number): Solution
  ph(V: number): number
  V0: number
}

/** A function of the titrant volume (mL) with the spec's constants worked out once. */
export function prepare(spec: AcidBaseSpec): Prepared {
  const med = mediumOf(spec)
  const V0 = flaskVolume(spec)
  const t = spec.titrant
  const tSys: System | null = t.kind === 'weak-base' || t.kind === 'weak-acid' ? { label: t.label, pKa: t.pKa ?? [], z0: t.z0 ?? 0, ...(t.dpKadT ? { dpKadT: t.dpKadT } : {}) } : null
  const weak = spec.items.filter(isWeak).map((i) => ({ i, sys: weakSystem(i) }))
  const strongAcid = spec.items.filter((i) => i.kind === 'strong-acid').reduce((s, i) => s + i.conc * i.volume, 0)
  const strongBase = spec.items.filter((i) => i.kind === 'strong-base').reduce((s, i) => s + i.conc * i.volume, 0)
  const at = (V: number): Solution => {
    const vt = V0 + Math.max(0, V)
    const items: Dissolved[] = weak.map(({ i, sys }) => ({ sys, conc: (i.conc * i.volume) / vt, form: i.form }))
    const ions: Ion[] = []
    if (spec.background > 0) ions.push({ z: 1, conc: spec.background }, { z: -1, conc: spec.background })
    if (strongAcid > 0) ions.push({ z: -1, conc: strongAcid / vt })
    if (strongBase > 0) ions.push({ z: 1, conc: strongBase / vt })
    const amount = t.conc * Math.max(0, V)
    if (amount > 0) {
      if (t.kind === 'strong-base') ions.push({ z: 1, conc: amount / vt })
      else if (t.kind === 'strong-acid') ions.push({ z: -1, conc: amount / vt })
      else if (tSys) items.push({ sys: tSys, conc: amount / vt, form: t.form ?? 0 })
    }
    for (const d of items) ions.push(...counterIons(d))
    return solve(items, ions, med)
  }
  return { at, ph: (V) => at(V).pH, V0 }
}

export const phAt = (spec: AcidBaseSpec, V: number): number => prepare(spec).ph(V)
export const solutionAt = (spec: AcidBaseSpec, V: number): Solution => prepare(spec).at(V)

// ---------------------------------------------------------------------------------------------- stoichiometry

export interface Site {
  /** Strong acid/base excess have pKa ∓∞. */
  pKa: number
  /** mmol that are (base titrant) or can be (acid titrant) titrated at this site. */
  mmol: number
  label: string
  strong: boolean
  /** Index of the step in its system (weak sites). */
  step?: number
}

export interface EqPoint {
  /** 1, 2, … in order of increasing volume. */
  index: number
  /** Stoichiometric equivalence volume (mL of titrant). */
  V: number
  /** What is complete at this point. */
  label: string
  /** pKa of the step that is complete (weak sites), when it is one step. */
  pKa: number | null
  strong: boolean
}

/**
 * The proton sites of the flask in the order the titrant meets them. With a base as titrant that is the filled sites by
 * increasing pKa (strong acid first); with an acid, the empty sites by decreasing pKa (strong base first).
 * Protons are distributed over the sites of the weak systems from the highest pKa down, as they sit in the flask.
 */
export function titratedSites(spec: AcidBaseSpec): Site[] {
  const a = amounts(spec)
  const T = spec.temperature
  type W = { pKa: number; cap: number; label: string; step: number; filled: number }
  const sites: W[] = []
  for (const i of spec.items.filter(isWeak)) {
    const sys = weakSystem(i)
    const cap = i.conc * i.volume
    for (let s = 0; s < i.pKa.length; s++) sites.push({ pKa: pKaAt(sys, s, T), cap, label: `${i.label}, pKa ${trim(i.pKa[s])}`, step: s, filled: 0 })
  }
  let left = Math.max(0, a.Q0)
  for (const s of [...sites].sort((x, y) => y.pKa - x.pKa)) {
    const f = Math.min(left, s.cap)
    s.filled = f
    left -= f
  }
  const out: Site[] = []
  if (titrantAdds(spec.titrant) === 'base') {
    if (left > 1e-12) out.push({ pKa: -Infinity, mmol: left, label: 'strong acid', strong: true })
    for (const s of sites.sort((x, y) => x.pKa - y.pKa)) if (s.filled > 1e-12) out.push({ pKa: s.pKa, mmol: s.filled, label: s.label, strong: false, step: s.step })
  } else {
    if (a.Q0 < -1e-12) out.push({ pKa: Infinity, mmol: -a.Q0, label: 'strong base', strong: true })
    for (const s of sites.sort((x, y) => y.pKa - x.pKa)) {
      const holes = s.cap - s.filled
      if (holes > 1e-12) out.push({ pKa: s.pKa, mmol: holes, label: s.label, strong: false, step: s.step })
    }
  }
  // sites of the same pKa (several items of one system) are one step
  const merged: Site[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && !last.strong && !s.strong && Math.abs(last.pKa - s.pKa) < 1e-9) last.mmol += s.mmol
    else merged.push({ ...s })
  }
  return merged
}

const trim = (x: number) => String(Number(x.toFixed(3)))

const titrantEquivalents = (t: Titrant) => t.conc * (t.kind === 'weak-base' || t.kind === 'weak-acid' ? t.eq ?? 1 : 1)

/** Stoichiometric equivalence points (cumulative), in increasing volume. */
export function equivalencePoints(spec: AcidBaseSpec): EqPoint[] {
  const c = titrantEquivalents(spec.titrant)
  if (!(c > 0)) return []
  let cum = 0
  const out: EqPoint[] = []
  titratedSites(spec).forEach((s, i) => {
    cum += s.mmol
    out.push({ index: i + 1, V: cum / c, label: s.label, pKa: s.strong ? null : s.pKa, strong: s.strong })
  })
  return out
}

/** The volume of the first equivalence point (mL) or null. */
export const firstEquivalence = (spec: AcidBaseSpec): number | null => equivalencePoints(spec)[0]?.V ?? null

// ---------------------------------------------------------------------------------------------- the curve

export interface Curve {
  V: number[]
  pH: number[]
  /** Ionic strength at each point (0 without activities). */
  I: number[]
}

/** Sensible last volume (mL) for the curve. */
export function defaultVmax(spec: AcidBaseSpec): number {
  if (spec.vmax && spec.vmax > 0) return spec.vmax
  const eq = equivalencePoints(spec)
  if (!eq.length) return Math.max(10, flaskVolume(spec))
  const last = eq[eq.length - 1].V
  return Math.max(last * 1.3, last + 5)
}

/** pH against titrant volume: a uniform grid, denser around every equivalence point. */
export function curve(spec: AcidBaseSpec, opts: { vmax?: number; n?: number } = {}): Curve {
  const vmax = opts.vmax ?? defaultVmax(spec)
  const n = opts.n ?? 300
  const vs = new Set<number>()
  for (let i = 0; i <= n; i++) vs.add((vmax * i) / n)
  for (const e of equivalencePoints(spec)) {
    if (e.V <= 0 || e.V > vmax) continue
    const w = Math.max(e.V * 0.06, vmax * 0.01)
    for (let k = -20; k <= 20; k++) {
      const d = Math.sign(k) * w * Math.pow(Math.abs(k) / 20, 2.2)
      const v = e.V + d
      if (v >= 0 && v <= vmax) vs.add(v)
    }
    vs.add(e.V)
  }
  const V = [...vs].sort((a, b) => a - b)
  const p = prepare(spec)
  const sol = V.map((v) => p.at(v))
  return { V, pH: sol.map((s) => s.pH), I: sol.map((s) => s.I) }
}

/** First derivative of y(x) on a non-uniform grid (central differences, one-sided at the ends). */
export function derivative(x: readonly number[], y: readonly number[]): number[] {
  const n = x.length
  return x.map((_, i) => {
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i + 1)
    return b > a ? (y[b] - y[a]) / (x[b] - x[a]) : 0
  })
}

/** Volume (mL) where the curve reaches a pH, found by bisection between vlo and vhi; null when it does not cross there. */
export function volumeAtPH(spec: AcidBaseSpec, target: number, vlo: number, vhi: number): number | null {
  const p = prepare(spec)
  const f = (v: number) => p.ph(v) - target
  const a = f(vlo)
  const b = f(vhi)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a * b > 0) return null
  return brent(f, vlo, vhi, 1e-10)
}

/** The volume near `guess` where |dpH/dV| is largest (the inflection point of the curve), by golden-section search. */
export function steepestVolume(spec: AcidBaseSpec, guess: number, halfWidth: number): number {
  const p = prepare(spec)
  const h = Math.max(guess * 1e-5, 1e-7)
  const slope = (v: number) => (p.ph(v + h) - p.ph(v - h)) / (2 * h)
  let a = Math.max(h * 2, guess - halfWidth)
  let b = guess + halfWidth
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = Math.abs(slope(c))
  let fd = Math.abs(slope(d))
  for (let i = 0; i < 80 && b - a > 1e-9; i++) {
    if (fc > fd) {
      b = d; d = c; fd = fc
      c = b - g * (b - a)
      fc = Math.abs(slope(c))
    } else {
      a = c; c = d; fc = fd
      d = a + g * (b - a)
      fd = Math.abs(slope(d))
    }
  }
  return (a + b) / 2
}

// ---------------------------------------------------------------------------------------------- marks

export interface Marks {
  start: { V: number; pH: number }
  eq: Array<EqPoint & { pH: number; /** the volume of steepest slope near it */ inflection: number; /** pH change across ±1 % of the volume */ jump: number; resolved: boolean }>
  /** Half-equivalence points of the weak steps: there pH ≈ pKa. */
  half: Array<{ V: number; pH: number; pKa: number; label: string }>
  /** Volume ranges where pH is within pKa ± 1 (the buffer regions). */
  buffer: Array<{ from: number; to: number; pKa: number; label: string; pHfrom: number; pHto: number }>
}

export function marks(spec: AcidBaseSpec): Marks {
  const p = prepare(spec)
  const eq = equivalencePoints(spec)
  const sites = titratedSites(spec)
  const c = titrantEquivalents(spec.titrant)
  const vmax = defaultVmax(spec)
  const out: Marks = { start: { V: 0, pH: p.ph(0) }, eq: [], half: [], buffer: [] }
  let prev = 0
  const sign = titrantAdds(spec.titrant) === 'base' ? 1 : -1
  eq.forEach((e, i) => {
    const w = Math.max(e.V * 0.02, 1e-6)
    const inflection = steepestVolume(spec, e.V, Math.max(w, 0.01 * e.V))
    const lo = p.ph(Math.max(0, e.V * 0.99))
    const hi = p.ph(e.V * 1.01)
    const jump = (hi - lo) * sign
    out.eq.push({ ...e, pH: p.ph(e.V), inflection, jump, resolved: jump > 1 })
    const s = sites[i]
    if (!s.strong) {
      const mid = prev + (e.V - prev) / 2
      out.half.push({ V: mid, pH: p.ph(mid), pKa: s.pKa, label: s.label })
      // buffer region: pH within pKa ± 1 inside this step
      const pHa = s.pKa - 1 * sign
      const pHb = s.pKa + 1 * sign
      const va = volumeAtPH(spec, pHa, prev, e.V) ?? prev
      const vb = volumeAtPH(spec, pHb, prev, Math.min(vmax, e.V + (e.V - prev))) ?? e.V
      out.buffer.push({ from: Math.min(va, vb), to: Math.max(va, vb), pKa: s.pKa, label: s.label, pHfrom: pHa, pHto: pHb })
    }
    prev = e.V
  })
  void c
  return out
}

// ---------------------------------------------------------------------------------------------- indicators

export interface EndpointError {
  /** Volume at which the indicator changes colour (pH = pKin), or null when the curve never gets there. */
  V: number | null
  /** Equivalence point it is judged against. */
  eqIndex: number
  Veq: number
  /** (V − Veq)/Veq in percent (positive = titrated too far). */
  errorPercent: number | null
}

/** Where an indicator with colour midpoint pKin changes, and the error against the given equivalence point (1-based). */
export function endpointError(spec: AcidBaseSpec, pKin: number, eqIndex = 1): EndpointError {
  const eq = equivalencePoints(spec)
  const e = eq[eqIndex - 1]
  if (!e) return { V: null, eqIndex, Veq: NaN, errorPercent: null }
  const p = prepare(spec)
  const f = (v: number) => p.ph(v) - pKin
  // the pH is monotonic in V, so the indicator changes at exactly one volume
  const a = 0
  let b = Math.max(defaultVmax(spec), e.V * 1.5)
  let fb = f(b)
  for (let k = 0; k < 6 && f(a) * fb > 0; k++) {
    b *= 1.8
    fb = f(b)
  }
  if (!(f(a) * fb <= 0)) return { V: null, eqIndex, Veq: e.V, errorPercent: null }
  const V = brent(f, a, b, 1e-10)
  return { V, eqIndex, Veq: e.V, errorPercent: (100 * (V - e.V)) / e.V }
}

export type Suitability = 'excellent' | 'good' | 'poor' | 'unsuitable'

/** Excellent ≤ 0.1 %, good ≤ 0.5 %, poor ≤ 2 % titration error. */
export function suitability(errorPercent: number | null): Suitability {
  if (errorPercent === null) return 'unsuitable'
  const a = Math.abs(errorPercent)
  return a <= 0.1 ? 'excellent' : a <= 0.5 ? 'good' : a <= 2 ? 'poor' : 'unsuitable'
}

// ---------------------------------------------------------------------------------------------- helpers

/** Net result for the report: what the titration says about the first analyte, from a measured equivalence volume. */
export function analyteFromVolume(Veq: number, titrantConc: number, aliquot: number, equivalentsPerMole = 1): number {
  return (Veq * titrantConc) / (aliquot * equivalentsPerMole)
}

/** Back titration: mmol of acid used up by the sample = mmol acid added − mmol of base needed for the excess. */
export function backTitration(acidMmol: number, baseConc: number, baseVolume: number): number {
  return acidMmol - baseConc * baseVolume
}

export { kw, pKw }
