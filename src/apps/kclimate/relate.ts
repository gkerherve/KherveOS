// Relationships between series: alignment on a common time grid, correlation and lagged correlation (ENSO against
// temperature), and multiple regression on explanatory variables. Pure.

import { annualMeans, monthIndex, withData, yearOf, type Series } from './series.ts'
import { autocorr1, corrP, detrendLinear, effectiveNPair, ols, pearson, rCritical, spearman, type OlsResult } from './stats.ts'
import { tCritical, tTwoSided } from './dist.ts'

export type GridStep = 'monthly' | 'annual'

/** The grid index of a time: months since year 0, or the year. */
const gridIndex = (t: number, step: GridStep): number => (step === 'monthly' ? monthIndex(t) : yearOf(t))
const gridTime = (i: number, step: GridStep): number => (step === 'monthly' ? (i + 0.5) / 12 : i + 0.5)

/** A series on its grid: Map from grid index to value (finite values only). */
export function onGrid(s: Series, step: GridStep): Map<number, number> {
  const base = step === 'annual' ? annualMeans(s) : s
  if (step === 'monthly' && s.step !== 'monthly') throw new Error(`${s.name} is not monthly, so it cannot be matched month by month. Use annual means.`)
  const m = new Map<number, number>()
  for (let i = 0; i < base.t.length; i++) if (Number.isFinite(base.y[i])) m.set(gridIndex(base.t[i], step), base.y[i])
  return m
}

export interface Aligned {
  step: GridStep
  /** Grid indices (months since year 0, or years) of the rows. */
  index: number[]
  /** Decimal-year times of the rows. */
  t: number[]
  /** One array per input series. */
  cols: number[][]
}

/**
 * The times where all series have a value (series k shifted by lags[k] grid steps: row i uses series k at i − lag).
 * Monthly alignment needs monthly series; with `step: 'annual'` every series is first reduced to annual means.
 */
export function alignSeries(list: Series[], step: GridStep, lags: number[] = [], range?: [number | null, number | null]): Aligned {
  const maps = list.map((s) => onGrid(s, step))
  const lag = (k: number) => lags[k] ?? 0
  const lo = range?.[0] ?? -Infinity
  const hi = range?.[1] ?? Infinity
  const first = maps[0]
  const index: number[] = []
  for (const i of [...first.keys()].sort((a, b) => a - b)) {
    const t = gridTime(i, step)
    if (t < lo || t >= hi + 1) continue
    if (maps.every((m, k) => m.has(i - lag(k) + lag(0)))) index.push(i)
  }
  // row i is the time of series 0; series k contributes its value at i − (lag_k − lag_0)
  return {
    step, index, t: index.map((i) => gridTime(i, step)),
    cols: maps.map((m, k) => index.map((i) => m.get(i - lag(k) + lag(0))!)),
  }
}

// ------------------------------------------------------------------------------------------ correlation

export interface CorrelationResult {
  r: number
  rho: number
  n: number
  nEff: number
  p: number
  /** |r| above this is significant at 95 % given nEff. */
  rCrit: number
  detrended: boolean
}

/** Pearson and Spearman correlation of two series on their common times, with a significance that allows for autocorrelation. */
export function correlation(a: Series, b: Series, step: GridStep, opts: { detrend?: boolean; range?: [number | null, number | null] } = {}): CorrelationResult | null {
  const al = alignSeries([a, b], step, [], opts.range)
  if (al.index.length < 5) return null
  const x = opts.detrend ? detrendLinear(al.t, al.cols[0]) : al.cols[0]
  const y = opts.detrend ? detrendLinear(al.t, al.cols[1]) : al.cols[1]
  const pr = pearson(x, y)
  const nEff = effectiveNPair(pr.n, autocorr1(x), autocorr1(y))
  return { r: pr.r, rho: spearman(x, y).r, n: pr.n, nEff, p: corrP(pr.r, nEff), rCrit: rCritical(nEff), detrended: !!opts.detrend }
}

export interface LagResult {
  step: GridStep
  /** Lags in grid steps (months or years); positive: y follows x. */
  lags: number[]
  r: number[]
  n: number[]
  best: { lag: number; r: number; p: number; nEff: number }
  rCrit: number
  detrended: boolean
}

/**
 * Cross-correlation of x[t] with y[t + lag] for lags −maxLag … +maxLag: a positive lag means y follows x (global temperature
 * lags ENSO by a few months). Both are detrended first when `detrend` is set, so that a shared warming trend does not
 * dominate. The best lag has the largest |r|.
 */
export function lagCorrelation(x: Series, y: Series, step: GridStep, maxLag: number, opts: { detrend?: boolean; range?: [number | null, number | null] } = {}): LagResult | null {
  const mx = onGrid(x, step)
  const my = onGrid(y, step)
  const lo = opts.range?.[0] ?? -Infinity
  const hi = opts.range?.[1] ?? Infinity
  const xi = [...mx.keys()].sort((a, b) => a - b).filter((i) => gridTime(i, step) >= lo && gridTime(i, step) < hi + 1)
  if (xi.length < 8) return null
  // detrend each series over its own part of the range
  const detr = (m: Map<number, number>, keys: number[]) => {
    if (!opts.detrend) return m
    const vals = detrendLinear(keys.map((i) => gridTime(i, step)), keys.map((i) => m.get(i)!))
    return new Map(keys.map((i, k) => [i, vals[k]] as const))
  }
  const dx = detr(mx, xi)
  const yi = [...my.keys()].sort((a, b) => a - b).filter((i) => gridTime(i, step) >= lo - Math.abs(maxLag) && gridTime(i, step) < hi + 1 + Math.abs(maxLag) * 2)
  const dy = detr(my, yi)
  const lags: number[] = []
  const rs: number[] = []
  const ns: number[] = []
  for (let k = -maxLag; k <= maxLag; k++) {
    const xv: number[] = []
    const yv: number[] = []
    for (const i of xi) {
      const a = dx.get(i)
      const b = dy.get(i + k)
      if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) { xv.push(a); yv.push(b) }
    }
    const pr = pearson(xv, yv)
    lags.push(k)
    rs.push(pr.r)
    ns.push(pr.n)
  }
  let bi = -1
  for (let i = 0; i < rs.length; i++) if (Number.isFinite(rs[i]) && (bi < 0 || Math.abs(rs[i]) > Math.abs(rs[bi]))) bi = i
  if (bi < 0) return null
  // significance of the best lag: autocorrelations of the two series where they overlap
  const xv: number[] = []
  const yv: number[] = []
  for (const i of xi) {
    const a = dx.get(i)
    const b = dy.get(i + lags[bi])
    if (a !== undefined && b !== undefined) { xv.push(a); yv.push(b) }
  }
  const nEff = effectiveNPair(ns[bi], autocorr1(xv), autocorr1(yv))
  return { step, lags, r: rs, n: ns, best: { lag: lags[bi], r: rs[bi], p: corrP(rs[bi], nEff), nEff }, rCrit: rCritical(nEff), detrended: !!opts.detrend }
}

// ----------------------------------------------------------------------------------- multiple regression

export type PredictorTransform = 'none' | 'log2' | 'ln'

export interface Predictor {
  series: Series
  /** Applied to the values first: "log2" gives a coefficient per doubling (CO2). */
  transform: PredictorTransform
  /** The predictor at time t − lag explains the target at t (grid steps; 3 months for ENSO). */
  lag: number
  /** Label in the table; defaults to the series name. */
  label?: string
}

export interface RegressionTerm {
  name: string
  unit: string
  coef: number
  /** Standard error allowing for AR(1) residuals. */
  se: number
  seNaive: number
  t: number
  p: number
  ci: [number, number]
  lag: number
}

export interface RegressionResult {
  step: GridStep
  n: number
  nEff: number
  r1: number
  r2: number
  adjR2: number
  rmse: number
  terms: RegressionTerm[]
  intercept: RegressionTerm
  trend: RegressionTerm | null
  t: number[]
  y: number[]
  fitted: number[]
  residual: number[]
  /** What each term contributes (coefficient × the deviation of the predictor from its mean). */
  contributions: Array<{ name: string; values: number[] }>
  /** The target with the "natural" terms removed (ENSO, volcanic, solar: every term not flagged as forced) and the trend kept. */
  adjusted: number[]
  df: number
}

const transformed = (v: number, tr: PredictorTransform) => (tr === 'log2' ? Math.log2(v) : tr === 'ln' ? Math.log(v) : v)

/**
 * y = c + (trend) + Σ b_j f(x_j(t − lag_j)) by least squares, with standard errors corrected for AR(1) residuals
 * (inflated by √((1 + r1) / (1 − r1)), Foster and Rahmstorf 2011) and Student's t on n_eff − p degrees of freedom.
 * `trend` adds a straight line in time (use it for ENSO + volcanic + solar regressions without CO2).
 * `natural` names the predictors to take out for the "adjusted" series (their contributions are subtracted from y).
 */
export function regress(target: Series, predictors: Predictor[], step: GridStep, opts: { trend?: boolean; range?: [number | null, number | null]; natural?: string[] } = {}): RegressionResult | { error: string } {
  const lags = [0, ...predictors.map((p) => p.lag)]
  let al: Aligned
  try {
    al = alignSeries([target, ...predictors.map((p) => p.series)], step, lags, opts.range)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  const n = al.index.length
  const names = predictors.map((p) => p.label ?? p.series.name)
  const cols = predictors.map((p, k) => al.cols[k + 1].map((v) => transformed(v, p.transform)))
  if (cols.some((c) => c.some((v) => !Number.isFinite(v)))) return { error: 'A predictor has values the transformation cannot take (zero or negative for a logarithm).' }
  const k = predictors.length + 1 + (opts.trend ? 1 : 0)
  if (n < k + 8) return { error: `Only ${n} times have values in all of the series (at least ${k + 8} are needed). Shorten the list of explanatory variables or widen the period.` }
  const t0 = al.t.reduce((a, b) => a + b, 0) / n
  const X = al.t.map((tt, i) => [1, ...(opts.trend ? [tt - t0] : []), ...cols.map((c) => c[i])])
  const fit: OlsResult | null = ols(X, al.cols[0])
  if (!fit) return { error: 'The explanatory variables are (nearly) collinear, so the regression cannot separate them. Remove one.' }
  const r1 = autocorr1(fit.residuals)
  const nEff = Math.max(k + 1, r1 > 0 ? (n * (1 - r1)) / (1 + r1) : n)
  const df = Math.max(1, nEff - k)
  const infl = nEff < n ? Math.sqrt((n - k) / df) : 1
  const tc = tCritical(0.05, df)
  const term = (j: number, name: string, unit: string, lag: number): RegressionTerm => {
    const se = fit.se[j] * infl
    return { name, unit, coef: fit.beta[j], se, seNaive: fit.se[j], t: fit.beta[j] / se, p: tTwoSided(fit.beta[j] / se, df), ci: [fit.beta[j] - tc * se, fit.beta[j] + tc * se], lag }
  }
  const unitOf = (p: Predictor) => `${target.unit}${p.transform === 'log2' ? ' per doubling' : p.transform === 'ln' ? ' per e-fold' : p.series.unit ? ` per ${p.series.unit}` : ''}`
  const off = 1 + (opts.trend ? 1 : 0)
  const terms = predictors.map((p, j) => term(off + j, names[j], unitOf(p), p.lag))
  const contributions = predictors.map((_, j) => {
    const m = cols[j].reduce((a, b) => a + b, 0) / n
    return { name: names[j], values: cols[j].map((v) => fit.beta[off + j] * (v - m)) }
  })
  if (opts.trend) contributions.unshift({ name: 'trend', values: al.t.map((tt) => fit.beta[1] * (tt - t0)) })
  const nat = new Set(opts.natural ?? [])
  const adjusted = al.cols[0].map((v, i) => v - contributions.filter((c) => nat.has(c.name)).reduce((s, c) => s + c.values[i], 0))
  return {
    step, n, nEff, r1, r2: fit.r2, adjR2: 1 - (1 - fit.r2) * (n - 1) / (n - k), rmse: fit.sigma,
    terms, intercept: term(0, 'intercept', target.unit, 0), trend: opts.trend ? term(1, 'trend', `${target.unit} per year`, 0) : null,
    t: al.t, y: al.cols[0], fitted: fit.fitted, residual: fit.residuals, contributions, adjusted, df,
  }
}

/** A series made of regression output on the aligned times. */
export function regressionSeries(base: Series, r: RegressionResult, key: 'fitted' | 'residual' | 'adjusted' | 'y', label: string): Series {
  return withData(base, r.t.slice(), r[key].slice(), { id: `${base.id}~${key}`, name: label, step: r.step === 'monthly' ? 'monthly' : 'annual', kind: key === 'residual' ? 'anomaly' : base.kind })
}
