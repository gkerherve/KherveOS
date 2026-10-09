// A zero-dimensional energy-balance model of the Earth (a teaching model, not a forecast). Pure.
//
//   C dT/dt = S/4 (1 − α(T)) − ε σ T⁴ + F(t) + f (T − T₀)         [− γ (T − T_d) with a deep ocean]
//
//   S      solar constant (W/m²)            α(T)  albedo; with the ice–albedo feedback it rises from the open-water
//   ε      effective emissivity: the              value at T_warm to the ice value at T_cold (linear in between)
//          greenhouse effect (ε = 1: none)  F     CO2 forcing 5.35 ln(C/C₀) (W/m²)
//   C      heat capacity of the ocean mixed layer
//   f      an extra "net feedback" (W/m²/K: water vapour, clouds…) chosen so that the response to doubling CO2 is the
//          chosen equilibrium climate sensitivity (ECS): f = 4εσT₀³ − F₂ₓ / ECS.
//
// Without feedbacks (f = 0, constant α) the response to 2×CO2 is F₂ₓ / (4εσT³) ≈ 1.1 K.

export const SIGMA = 5.670374419e-8
/** W/m² per e-fold of CO2 (Myhre et al. 1998). */
export const CO2_COEFF = 5.35
export const F2X = CO2_COEFF * Math.LN2
const SECONDS_PER_YEAR = 3.15576e7
/** Gt CO2 per ppm of atmospheric CO2 (2.13 GtC × 3.664). */
export const GTCO2_PER_PPM = 7.81

export interface EbmParams {
  /** Solar constant (W/m²). */
  solar: number
  /** Albedo of the ice-free Earth. */
  albedo: number
  /** Effective emissivity ε (1 = no greenhouse effect; 0.61 gives 288 K). */
  emissivity: number
  /** Equilibrium climate sensitivity: warming for doubled CO2 (K). */
  ecs: number
  /** Depth of the ocean mixed layer (m). */
  mixedDepth: number
  oceanFraction: number
  /** Two-layer ocean: a deep ocean takes up heat. */
  deepOcean: boolean
  deepDepth: number
  /** Heat exchange between the mixed layer and the deep ocean (W/m²/K). */
  exchange: number
  /** Pre-industrial CO2 (ppm). */
  c0: number
  /** Ice–albedo feedback on. */
  ice: boolean
  iceAlbedo: number
  /** Temperature (K) at and below which the Earth is fully ice-covered. */
  tCold: number
  /** Temperature (K) at and above which it is ice-free. */
  tWarm: number
}

export const DEFAULT_EBM: EbmParams = {
  solar: 1361, albedo: 0.3, emissivity: 0.61, ecs: 3, mixedDepth: 100, oceanFraction: 0.71, deepOcean: true, deepDepth: 1000, exchange: 0.7,
  c0: 280, ice: false, iceAlbedo: 0.62, tCold: 250, tWarm: 280,
}

/** Albedo at temperature T. */
export function albedoAt(p: EbmParams, T: number): number {
  if (!p.ice) return p.albedo
  if (T <= p.tCold) return p.iceAlbedo
  if (T >= p.tWarm) return p.albedo
  return p.iceAlbedo + ((p.albedo - p.iceAlbedo) * (T - p.tCold)) / (p.tWarm - p.tCold)
}

export const absorbed = (p: EbmParams, T: number, solar = p.solar): number => (solar / 4) * (1 - albedoAt(p, T))
export const outgoing = (p: EbmParams, T: number): number => p.emissivity * SIGMA * T ** 4
/** Planck response dOLR/dT (W/m²/K). */
export const planck = (p: EbmParams, T: number): number => 4 * p.emissivity * SIGMA * T ** 3

/** CO2 radiative forcing for concentration c against c0 (W/m²). */
export const co2Forcing = (c: number, c0: number): number => CO2_COEFF * Math.log(c / c0)

/** The equilibrium temperature of a planet with no greenhouse effect: [S(1 − α) / (4 ε σ)]^¼ (255 K for the Earth). */
export function blackbodyTemperature(solar: number, albedo: number, emissivity = 1): number {
  return Math.pow((solar * (1 - albedo)) / (4 * emissivity * SIGMA), 0.25)
}

export interface Equilibrium {
  T: number
  stable: boolean
}

/** Net heat flux into the planet at temperature T (W/m²) for the given extra forcing and feedback about tRef. */
export function netFlux(p: EbmParams, T: number, extra: { forcing?: number; feedback?: number; tRef?: number; solar?: number } = {}): number {
  return absorbed(p, T, extra.solar ?? p.solar) - outgoing(p, T) + (extra.forcing ?? 0) + (extra.feedback ?? 0) * (T - (extra.tRef ?? 0))
}

/** All equilibrium temperatures between 120 K and 420 K, with their stability (a stable one has d(net)/dT < 0). */
export function equilibria(p: EbmParams, extra: { forcing?: number; feedback?: number; tRef?: number; solar?: number } = {}): Equilibrium[] {
  const out: Equilibrium[] = []
  const f = (T: number) => netFlux(p, T, extra)
  let prevT = 120
  let prev = f(prevT)
  for (let T = 120.25; T <= 420; T += 0.25) {
    const v = f(T)
    if (prev === 0 || (prev < 0 && v > 0) || (prev > 0 && v < 0)) {
      let a = prevT
      let b = T
      let fa = prev
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2
        const fm = f(m)
        if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) { a = m; fa = fm } else b = m
      }
      const root = (a + b) / 2
      out.push({ T: root, stable: f(root + 0.01) - f(root - 0.01) < 0 })
    }
    prevT = T
    prev = v
  }
  return out
}

/** The pre-industrial climate: the warmest stable equilibrium (the "warm branch") with c0 and no extra forcing. */
export function preindustrial(p: EbmParams): number {
  const stable = equilibria(p).filter((e) => e.stable)
  return stable.length ? stable[stable.length - 1].T : NaN
}

/**
 * The extra net feedback f (W/m²/K) that makes the equilibrium warming for doubled CO2 exactly the ECS: at T₁ = T₀ + ECS the
 * net flux must vanish, so f = [εσT₁⁴ − εσT₀⁴ − (absorbed(T₁) − absorbed(T₀)) − F₂ₓ] / ECS.
 */
export function feedbackForEcs(p: EbmParams, T0: number): number {
  const T1 = T0 + p.ecs
  return (outgoing(p, T1) - outgoing(p, T0) - (absorbed(p, T1) - absorbed(p, T0)) - F2X) / p.ecs
}

export interface DoublingResult {
  T0: number
  /** Planck response at T0 (W/m²/K) and warming for 2×CO2 with no other feedback. */
  planck: number
  noFeedback: number
  /** The net feedback parameter λ = F₂ₓ / ECS the model uses (W/m²/K) and the extra feedback f. */
  lambda: number
  extraFeedback: number
  /** Warming at equilibrium for doubled CO2 found by solving the model (K): close to the ECS. */
  equilibrium: number
  forcing: number
}

/** The response to doubling CO2: with no feedback (≈ 1.1 K) and with the chosen sensitivity (≈ 3 K). */
export function doublingResponse(p: EbmParams): DoublingResult {
  const T0 = preindustrial(p)
  const f = feedbackForEcs(p, T0)
  const eq = equilibriumAt(p, 2 * p.c0, T0, f)
  return { T0, planck: planck(p, T0), noFeedback: equilibriumAt(p, 2 * p.c0, T0, 0) - T0, lambda: F2X / p.ecs, extraFeedback: f, equilibrium: eq - T0, forcing: F2X }
}

/** The equilibrium temperature on the branch of T0 for CO2 at c ppm (NaN if there is none, e.g. the ice sheet melted away). */
export function equilibriumAt(p: EbmParams, c: number, T0: number, feedback: number): number {
  const F = co2Forcing(c, p.c0)
  const roots = equilibria(p, { forcing: F, feedback, tRef: T0 }).filter((e) => e.stable)
  if (!roots.length) return NaN
  return roots.reduce((best, r) => (Math.abs(r.T - T0) < Math.abs(best.T - T0) ? r : best)).T
}

// -------------------------------------------------------------------------------------------- hysteresis

export interface HysteresisLoop {
  /** Solar constant as a fraction of S. */
  factor: number[]
  /** Temperature (K) following the sweep up from a frozen Earth, and the sweep down from a warm one. */
  up: number[]
  down: number[]
  /** All equilibria at each factor (the unstable middle branch included). */
  equilibria: Equilibrium[][]
  /** Factor at which the frozen Earth thaws on the way up, and the warm Earth freezes on the way down (NaN if it does not). */
  thawAt: number
  freezeAt: number
  /** Number of stable branches at factor 1. */
  stableAtOne: number
}

/** Moves T to the stable equilibrium whose basin it is in (a quasi-static slow relaxation). */
function relax(p: EbmParams, T: number, solar: number): number {
  let x = T
  for (let i = 0; i < 20000; i++) {
    const lam = Math.max(0.5, planck(p, x))
    const step = (0.5 * netFlux(p, x, { solar })) / lam
    x += Math.max(-5, Math.min(5, step))
    if (Math.abs(step) < 1e-9) break
  }
  return x
}

/** The hysteresis loop of the ice–albedo model: sweep the solar constant up from a frozen Earth and down from a warm one. */
export function hysteresis(p: EbmParams, lo = 0.6, hi = 1.6, n = 101): HysteresisLoop {
  const factor = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
  const eqs = factor.map((k) => equilibria(p, { solar: p.solar * k }))
  const up: number[] = []
  const down = new Array<number>(n).fill(NaN)
  let T = 180
  for (let i = 0; i < n; i++) { T = relax(p, T, p.solar * factor[i]); up.push(T) }
  T = 330
  for (let i = n - 1; i >= 0; i--) { T = relax(p, T, p.solar * factor[i]); down[i] = T }
  let thawAt = NaN
  let freezeAt = NaN
  for (let i = 1; i < n; i++) {
    if (up[i] - up[i - 1] > 10 && Number.isNaN(thawAt)) thawAt = (factor[i] + factor[i - 1]) / 2
  }
  for (let i = n - 1; i > 0; i--) {
    if (down[i] - down[i - 1] > 10 && Number.isNaN(freezeAt)) freezeAt = (factor[i] + factor[i - 1]) / 2
  }
  const one = equilibria(p).filter((e) => e.stable).length
  return { factor, up, down, equilibria: eqs, thawAt, freezeAt, stableAtOne: one }
}

// ------------------------------------------------------------------------------------------ scenarios

export type ScenarioMode = 'emissions' | 'concentration'
export type ScenarioPreset = 'constant' | 'growth' | 'peak' | 'netzero' | 'custom'

export const PRESET_LABELS: Record<ScenarioPreset, string> = {
  constant: 'Constant', growth: 'Growing', peak: 'Peak and decline', netzero: 'Net zero', custom: 'Custom path',
}

export interface Scenario {
  mode: ScenarioMode
  preset: ScenarioPreset
  /** The model follows the history until this year, the scenario after it. */
  startYear: number
  /** % per year: growth of emissions or of the CO2 concentration. */
  growthPct: number
  /** "peak": growth until this year, then a linear decline over `declineYears`. */
  peakYear: number
  declineYears: number
  /** "netzero": emissions fall linearly to zero in this year (concentration mode: concentration stops rising). */
  zeroYear: number
  /** "custom": [year, value] points after the start (Gt CO2 per year, or ppm), joined by straight lines. */
  points: Array<[number, number]>
}

export const DEFAULT_SCENARIO: Scenario = {
  mode: 'emissions', preset: 'netzero', startYear: 2025, growthPct: 1, peakYear: 2040, declineYears: 40, zeroYear: 2050, points: [[2025, 40], [2050, 20], [2100, 0]],
}

export const HISTORY_FIRST = 1850
export const MODEL_END = 2100

export interface CarbonHistory {
  /** [year, Gt CO2] emitted each year from HISTORY_FIRST on (fossil + land use). */
  emissions: Array<[number, number]>
}

/** An emission history of constant emissions, for demonstrations and tests (not data). */
export function constantHistory(gtPerYear: number, from = HISTORY_FIRST, to = 2024): CarbonHistory {
  const emissions: Array<[number, number]> = []
  for (let y = from; y <= to; y++) emissions.push([y, gtPerYear])
  return { emissions }
}

/** Concentration after one year: C₀ + (C − C₀) e^(−k) + E/7.81 (1 − e^(−k)) / k. */
function carbonStep(c: number, c0: number, e: number, k: number): number {
  const d = Math.exp(-k)
  const gain = k > 1e-9 ? (1 - d) / k : 1
  return c0 + (c - c0) * d + (e / GTCO2_PER_PPM) * gain
}

/** Linear interpolation in a list of [x, y] (held constant outside). */
export function interpolatePoints(points: Array<[number, number]>, x: number): number {
  if (!points.length) return NaN
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return points[points.length - 1][1]
}

/** Emissions of the scenario in `year` (Gt CO2/yr), given the emissions at its start. */
export function scenarioEmissions(sc: Scenario, year: number, e0: number): number {
  const dy = year - sc.startYear
  const g = 1 + sc.growthPct / 100
  switch (sc.preset) {
    case 'constant': return e0
    case 'growth': return e0 * g ** dy
    case 'peak': {
      const ePeak = e0 * g ** Math.max(0, sc.peakYear - sc.startYear)
      if (year <= sc.peakYear) return e0 * g ** dy
      return Math.max(0, ePeak * (1 - (year - sc.peakYear) / Math.max(1, sc.declineYears)))
    }
    case 'netzero': {
      if (year >= sc.zeroYear) return 0
      return e0 * (1 - dy / Math.max(1, sc.zeroYear - sc.startYear))
    }
    case 'custom': return Math.max(0, interpolatePoints([[sc.startYear, e0], ...sc.points.filter((q) => q[0] > sc.startYear)], year))
  }
}

/** Concentration of the scenario in `year` (ppm) when it is given directly, from the value at its start. */
export function scenarioConcentration(sc: Scenario, year: number, c0: number): number {
  const dy = year - sc.startYear
  const g = 1 + sc.growthPct / 100
  switch (sc.preset) {
    case 'constant': return c0
    case 'growth': return c0 * g ** dy
    case 'peak': {
      const cPeak = c0 * g ** Math.max(0, sc.peakYear - sc.startYear)
      if (year <= sc.peakYear) return c0 * g ** dy
      return Math.max(c0, cPeak - ((cPeak - c0) * (year - sc.peakYear)) / Math.max(1, sc.declineYears))
    }
    case 'netzero': return c0 * g ** Math.min(dy, Math.max(0, sc.zeroYear - sc.startYear))
    case 'custom': return interpolatePoints([[sc.startYear, c0], ...sc.points.filter((q) => q[0] > sc.startYear)], year)
  }
}

export interface CarbonParams {
  /** Fraction of each year's emissions that stays in the air. */
  airborne: number
  /** Extra uptake of the excess CO2 over c0 (1/yr; 0 = none). */
  sink: number
}

export const DEFAULT_CARBON: CarbonParams = { airborne: 0.45, sink: 0 }

/** The airborne fraction (best, by golden-section search) that carries the observed concentration of `y0` forward to the later annual means. */
export function calibrateAirborne(history: CarbonHistory, c0: number, observed: Array<[number, number]>, sink = 0): { airborne: number; rmse: number; early: number } | null {
  const obs = new Map(observed)
  const years = [...obs.keys()].sort((a, b) => a - b)
  if (years.length < 10) return null
  const y0 = years[0]
  const em = new Map(history.emissions)
  const lastEm = Math.max(...history.emissions.map((e) => e[0]))
  const emAt = (y: number) => em.get(Math.min(y, lastEm)) ?? 0
  const s0 = obs.get(y0)! - 0.5 * (obs.get(y0 + 1)! - obs.get(y0)!)
  const rmse = (a: number) => {
    let c = s0
    let se = 0
    let n = 0
    for (const y of years) {
      const next = carbonStep(c, c0, a * emAt(y), sink)
      se += ((c + next) / 2 - obs.get(y)!) ** 2
      n++
      c = next
      if (!obs.has(y + 1) && y !== years[years.length - 1]) break
    }
    return Math.sqrt(se / n)
  }
  let lo = 0.05
  let hi = 1.5
  const gr = (Math.sqrt(5) - 1) / 2
  let x1 = hi - gr * (hi - lo)
  let x2 = lo + gr * (hi - lo)
  let f1 = rmse(x1)
  let f2 = rmse(x2)
  for (let i = 0; i < 60; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = rmse(x1) } else { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = rmse(x2) }
  }
  const airborne = (lo + hi) / 2
  // the fraction that matches the observed value at y0 when run from c0 in 1850
  let c = c0
  let x = 0
  for (let y = HISTORY_FIRST; y < y0; y++) { const next = carbonStep(c, c0, emAt(y), sink); c = next }
  x = c - c0
  const early = x > 0 ? (s0 - c0) / x : NaN
  return { airborne, rmse: rmse(airborne), early }
}

export interface PathOptions {
  carbon?: CarbonParams
  /** Annual means of the observed concentration [year, ppm] (Mauna Loa): used for the years they cover. */
  observed?: Array<[number, number]>
  /** Concentration at the start year when there is no history at all. */
  startPpm?: number
}

export interface Path {
  /** Annual nodes at t = year (the value at the start of the year), first to last. */
  years: number[]
  conc: number[]
  /** Emissions during the year starting at the node (Gt CO2/yr). */
  emissions: number[]
  /** How the part before startYear was made. */
  history: 'observed' | 'emissions' | 'idealised'
  carbon: CarbonParams
  /** Airborne fraction that fits 1959 onward and the one that fits 1850–1958 (NaN without observations). */
  fitted: { airborne: number; early: number; rmse: number } | null
}

/**
 * The CO2 path 1850–2100. The years the observations cover are the observations; before them the concentration comes from the
 * emission history with an airborne fraction chosen to meet the first observation; after the start year the scenario gives
 * either emissions (a fraction `airborne` stays in the air, the excess decays at rate `sink`) or the concentration directly.
 * With no emission history the part before the start is an idealised exponential rise to `startPpm`, which is not data.
 */
export function buildPath(sc: Scenario, c0: number, history: CarbonHistory | null, opts: PathOptions = {}): Path {
  const carbon0 = opts.carbon ?? DEFAULT_CARBON
  const em = new Map(history?.emissions ?? [])
  const lastEm = history && history.emissions.length ? Math.max(...history.emissions.map((e) => e[0])) : HISTORY_FIRST
  const emAt = (y: number) => em.get(Math.min(y, lastEm)) ?? 0
  const obs = new Map(opts.observed ?? [])
  const obsYears = [...obs.keys()].sort((a, b) => a - b)
  const fit = history && obsYears.length >= 10 ? calibrateAirborne(history, c0, [...obs], carbon0.sink) : null
  const carbon: CarbonParams = { airborne: fit ? fit.airborne : carbon0.airborne, sink: carbon0.sink }
  const k = carbon.sink
  const y0 = obsYears[0]
  const yEnd = obsYears[obsYears.length - 1]
  const s0 = fit ? obs.get(y0)! - 0.5 * (obs.get(y0 + 1)! - obs.get(y0)!) : NaN
  const e0 = history ? emAt(sc.startYear) : 40
  const eYear = (y: number) => (y <= sc.startYear ? (history ? emAt(y) : NaN) : sc.mode === 'emissions' ? scenarioEmissions(sc, y, e0) : NaN)
  const years: number[] = []
  const node: number[] = []
  let cStart = opts.startPpm ?? 425
  for (let y = HISTORY_FIRST; y <= MODEL_END; y++) {
    years.push(y)
    const prev = node.length ? node[node.length - 1] : c0
    let v: number
    if (y === HISTORY_FIRST) v = c0
    else if (y <= sc.startYear) {
      if (fit && y < y0) v = carbonStep(prev, c0, fit.early * emAt(y - 1), k)
      else if (fit && y === y0) v = s0
      else if (fit && y <= yEnd && obs.has(y - 1) && obs.has(y)) v = (obs.get(y - 1)! + obs.get(y)!) / 2
      else if (history) v = carbonStep(prev, c0, carbon.airborne * emAt(y - 1), k)
      else {
        // idealised: the excess over c0 grows exponentially (e-folding 40 years) to startPpm in the start year
        const span = sc.startYear - HISTORY_FIRST
        const r = 1 / 40
        v = c0 + (cStart - c0) * ((Math.exp(r * (y - HISTORY_FIRST)) - 1) / (Math.exp(r * span) - 1))
      }
    } else if (sc.mode === 'emissions') {
      v = carbonStep(prev, c0, carbon.airborne * (eYear(y - 1) || 0), k)
    } else {
      v = scenarioConcentration(sc, y, cStart)
    }
    node.push(v)
    if (y === sc.startYear) cStart = v
  }
  return {
    years, conc: node, emissions: years.map(eYear), carbon,
    history: fit ? 'observed' : history ? 'emissions' : 'idealised',
    fitted: fit ? { airborne: fit.airborne, early: fit.early, rmse: fit.rmse } : null,
  }
}

/** Concentration at any time (linear between the annual nodes). */
export function concAt(path: Path, t: number): number {
  const i = Math.max(0, Math.min(path.years.length - 2, Math.floor(t - path.years[0])))
  const f = Math.max(0, Math.min(1, t - path.years[i]))
  return path.conc[i] + f * (path.conc[i + 1] - path.conc[i])
}

// ----------------------------------------------------------------------------------------------- run

export interface EbmRun {
  /** Output times (decimal years, mid-year) */
  t: number[]
  conc: number[]
  forcing: number[]
  /** Temperature (K) and its change from the pre-industrial equilibrium. */
  T: number[]
  dT: number[]
  deep: number[] | null
  /** The equilibrium warming for the concentration of each year: where the climate would end up if the concentration stopped rising. */
  equilibrium: number[]
  T0: number
  tau: number
  /** Heat capacity (W yr/m²/K). */
  heatCapacity: number
}

/** Heat capacity of the mixed layer in W yr m⁻² K⁻¹. */
export function heatCapacity(p: EbmParams, depth = p.mixedDepth): number {
  return (1025 * 3990 * depth * p.oceanFraction) / SECONDS_PER_YEAR
}

/** Integrates the model along a CO2 path (Runge–Kutta 4, 0.05-year steps) and returns the mid-year values. */
export function simulate(p: EbmParams, path: Path, opts: { dt?: number } = {}): EbmRun {
  const dt = opts.dt ?? 0.05
  const T0 = preindustrial(p)
  const f = feedbackForEcs(p, T0)
  const C = heatCapacity(p)
  const Cd = heatCapacity(p, p.deepDepth)
  const deep = p.deepOcean
  const rates = (T: number, Td: number, t: number): [number, number] => {
    const F = co2Forcing(concAt(path, t), p.c0)
    const flux = netFlux(p, T, { forcing: F, feedback: f, tRef: T0 })
    const toDeep = deep ? p.exchange * (T - Td) : 0
    return [(flux - toDeep) / C, deep ? toDeep / Cd : 0]
  }
  let T = T0
  let Td = T0
  const start = path.years[0]
  const end = path.years[path.years.length - 1]
  const out: EbmRun = { t: [], conc: [], forcing: [], T: [], dT: [], deep: deep ? [] : null, equilibrium: [], T0, tau: C / Math.max(1e-6, F2X / p.ecs), heatCapacity: C }
  const steps = Math.round(1 / dt)
  for (let y = start; y < end; y++) {
    for (let s = 0; s < steps; s++) {
      const t = y + s * dt
      if (s === Math.round(steps / 2)) {
        out.t.push(t)
        const c = concAt(path, t)
        out.conc.push(c)
        out.forcing.push(co2Forcing(c, p.c0))
        out.T.push(T)
        out.dT.push(T - T0)
        out.deep?.push(Td - T0)
        out.equilibrium.push(equilibriumAt(p, c, T0, f) - T0)
      }
      const [k1, d1] = rates(T, Td, t)
      const [k2, d2] = rates(T + (dt / 2) * k1, Td + (dt / 2) * d1, t + dt / 2)
      const [k3, d3] = rates(T + (dt / 2) * k2, Td + (dt / 2) * d2, t + dt / 2)
      const [k4, d4] = rates(T + dt * k3, Td + dt * d3, t + dt)
      T += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
      Td += (dt / 6) * (d1 + 2 * d2 + 2 * d3 + d4)
    }
  }
  return out
}

/** A path with the concentration held at `conc` ppm from the first year (a step in forcing), for testing the response time. */
export function stepPath(conc: number, firstYear = HISTORY_FIRST, lastYear = MODEL_END): Path {
  const years: number[] = []
  for (let y = firstYear; y <= lastYear; y++) years.push(y)
  return { years, conc: years.map(() => conc), emissions: years.map(() => NaN), history: 'idealised', carbon: { airborne: 0, sink: 0 }, fitted: null }
}
