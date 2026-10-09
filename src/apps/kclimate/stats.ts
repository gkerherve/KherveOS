// Statistics of kClimate: ordinary least squares, trends with confidence intervals corrected for AR(1)
// autocorrelation, a breakpoint (two-segment) trend, comparison of periods, correlation. Pure.

import { fSf, tCritical, tTwoSided } from './dist.ts'
import { mean, yearOf } from './series.ts'

// ------------------------------------------------------------------------------------------------------ OLS

export interface OlsResult {
  beta: number[]
  /** Standard errors of beta (from the ordinary residual variance). */
  se: number[]
  /** Covariance matrix of beta. */
  cov: number[][]
  fitted: number[]
  residuals: number[]
  n: number
  p: number
  df: number
  rss: number
  /** Residual standard deviation. */
  sigma: number
  r2: number
}

/** Solves A x = b for symmetric positive definite A (Cholesky). Returns null when A is singular. */
function cholSolve(A: number[][], B: number[][]): number[][] | null {
  const p = A.length
  const L = A.map((r) => r.map(() => 0))
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (!(s > 1e-13 * Math.max(1, A[i][i]))) return null
        L[i][i] = Math.sqrt(s)
      } else L[i][j] = s / L[j][j]
    }
  }
  // B has p rows and any number of columns
  const cols = B[0]?.length ?? 0
  const X = B.map((r) => r.slice())
  for (let c = 0; c < cols; c++) {
    for (let i = 0; i < p; i++) {
      let s = X[i][c]
      for (let k = 0; k < i; k++) s -= L[i][k] * X[k][c]
      X[i][c] = s / L[i][i]
    }
    for (let i = p - 1; i >= 0; i--) {
      let s = X[i][c]
      for (let k = i + 1; k < p; k++) s -= L[k][i] * X[k][c]
      X[i][c] = s / L[i][i]
    }
  }
  return X
}

/** Ordinary least squares y = X β. X has one row per observation (include a column of ones for an intercept). */
export function ols(X: number[][], y: number[]): OlsResult | null {
  const n = X.length
  const p = n ? X[0].length : 0
  if (p === 0 || n <= p) return null
  const scale = Array.from({ length: p }, (_, j) => {
    let s = 0
    for (let i = 0; i < n; i++) s += X[i][j] * X[i][j]
    return Math.sqrt(s / n) || 1
  })
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  const b = Array.from({ length: p }, () => [0])
  for (let i = 0; i < n; i++) {
    const row = X[i]
    for (let j = 0; j < p; j++) {
      const xj = row[j] / scale[j]
      b[j][0] += xj * y[i]
      for (let k = 0; k <= j; k++) A[j][k] += xj * (row[k] / scale[k])
    }
  }
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) A[j][k] = A[k][j]
  const I = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)))
  const sol = cholSolve(A, [...b.map((r, i) => [r[0], ...I[i]])])
  if (!sol) return null
  const beta = sol.map((r, j) => r[0] / scale[j])
  const inv = sol.map((r, j) => r.slice(1).map((v, k) => v / (scale[j] * scale[k])))
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0))
  const residuals = y.map((v, i) => v - fitted[i])
  const rss = residuals.reduce((s, e) => s + e * e, 0)
  const df = n - p
  const s2 = rss / df
  const my = mean(y)
  const tss = y.reduce((s, v) => s + (v - my) ** 2, 0)
  const cov = inv.map((r) => r.map((v) => v * s2))
  return { beta, se: cov.map((r, i) => Math.sqrt(Math.max(0, r[i]))), cov, fitted, residuals, n, p, df, rss, sigma: Math.sqrt(s2), r2: tss > 0 ? 1 - rss / tss : NaN }
}

// ---------------------------------------------------------------------------------------- autocorrelation

/** Lag-1 autocorrelation of a series (about its mean). */
export function autocorr1(e: number[]): number {
  const v = e.filter(Number.isFinite)
  if (v.length < 3) return 0
  const m = mean(v)
  let num = 0
  let den = 0
  for (let i = 0; i < v.length; i++) {
    den += (v[i] - m) ** 2
    if (i + 1 < v.length) num += (v[i] - m) * (v[i + 1] - m)
  }
  return den > 0 ? num / den : 0
}

/**
 * The effective number of independent values of n values with lag-1 autocorrelation r1 (Santer et al. 2000):
 * n (1 − r1) / (1 + r1). No correction for r1 ≤ 0 (that would only narrow the interval).
 */
export function effectiveN(n: number, r1: number): number {
  if (!(r1 > 0)) return n
  return Math.max(3, (n * (1 - r1)) / (1 + r1))
}

/** n_eff for two series (Bretherton et al. 1999): n (1 − r1x r1y) / (1 + r1x r1y). */
export function effectiveNPair(n: number, r1x: number, r1y: number): number {
  const q = r1x * r1y
  return q > 0 ? Math.max(3, (n * (1 - q)) / (1 + q)) : n
}

// ----------------------------------------------------------------------------------------------- trends

export type TrendModel = 'linear' | 'quadratic' | 'exponential'
export const TREND_LABELS: Record<TrendModel, string> = { linear: 'Linear (OLS)', quadratic: 'Quadratic', exponential: 'Exponential' }

export interface TrendResult {
  model: TrendModel
  n: number
  /** The times used (the input times with a value). */
  t: number[]
  fitted: number[]
  /** 95 % confidence limits of the fitted line (AR(1)-corrected when asked). */
  lo: number[]
  hi: number[]
  /** Slope in units per year (for the curved models: at the end of the period). */
  slopeYr: number
  /** Slope in units per decade and its 95 % confidence interval. */
  perDecade: number
  ciDecade: [number, number]
  /** The same interval without the AR(1) correction. */
  ciDecadeNaive: [number, number]
  /** Standard error of the slope per decade (corrected). */
  seDecade: number
  p: number
  r2: number
  rmse: number
  r1: number
  nEff: number
  /** Degrees of freedom used for the interval. */
  df: number
  ar1: boolean
  /** Coefficients in x = t − tc, in the order of the model (a, b[, c]); for exponential: ln y = a + b x. */
  coef: number[]
  tc: number
  /** Fitted change from the first to the last time. */
  total: number
  /** Exponential: growth in % per year. */
  growthPct?: number
  /** Quadratic: the curvature 2c per year². */
  acceleration?: number
  equation: string
}

const sig = (v: number, d = 3) => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : 'n/a')

/**
 * Fits a trend to (t, y) and reports the slope per decade with a 95 % confidence interval. With `ar1` (the default)
 * the interval allows for autocorrelated residuals: the standard error is multiplied by √((n − p) / (n_eff − p)),
 * n_eff = n (1 − r1) / (1 + r1), and Student's t has n_eff − p degrees of freedom. Needs at least p + 2 values.
 */
export function fitTrend(t: number[], y: number[], opts: { model?: TrendModel; ar1?: boolean } = {}): TrendResult | null {
  const model = opts.model ?? 'linear'
  const ar1 = opts.ar1 ?? true
  const tt: number[] = []
  const yy: number[] = []
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(t[i]) || !Number.isFinite(y[i])) continue
    if (model === 'exponential' && !(y[i] > 0)) continue
    tt.push(t[i])
    yy.push(model === 'exponential' ? Math.log(y[i]) : y[i])
  }
  const p = model === 'quadratic' ? 3 : 2
  const n = tt.length
  if (n < p + 2) return null
  const tc = mean(tt)
  const xs = tt.map((v) => v - tc)
  const X = xs.map((x) => (p === 3 ? [1, x, x * x] : [1, x]))
  const fit = ols(X, yy)
  if (!fit) return null
  const r1 = autocorr1(fit.residuals)
  const nEff = ar1 ? effectiveN(n, r1) : n
  const dfNaive = n - p
  const df = Math.max(1, nEff - p)
  const infl = ar1 && nEff < n ? Math.sqrt(dfNaive / df) : 1
  const tNaive = tCritical(0.05, dfNaive)
  const tAdj = tCritical(0.05, df)
  // the slope (derivative at the end of the period for the quadratic)
  const xEnd = xs[n - 1]
  const c = p === 3 ? [0, 1, 2 * xEnd] : [0, 1]
  const slope = c.reduce((s, v, j) => s + v * fit.beta[j], 0)
  let varSlope = 0
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) varSlope += c[i] * c[j] * fit.cov[i][j]
  const seSlope = Math.sqrt(Math.max(0, varSlope))
  const seAdj = seSlope * infl
  // fitted line and its confidence band for the mean (on the fitted scale)
  const fitted: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  for (let i = 0; i < n; i++) {
    const row = X[i]
    let v = 0
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) v += row[a] * row[b] * fit.cov[a][b]
    const half = tAdj * Math.sqrt(Math.max(0, v)) * infl
    const f = fit.fitted[i]
    if (model === 'exponential') { fitted.push(Math.exp(f)); lo.push(Math.exp(f - half)); hi.push(Math.exp(f + half)) } else { fitted.push(f); lo.push(f - half); hi.push(f + half) }
  }
  // exponential: y' = y b, evaluated at the end of the period
  const scaleEnd = model === 'exponential' ? fitted[n - 1] : 1
  const perYear = slope * scaleEnd
  const toDecade = (v: number) => v * scaleEnd * 10
  const ci: [number, number] = [toDecade(slope - tAdj * seAdj), toDecade(slope + tAdj * seAdj)]
  const ciNaive: [number, number] = [toDecade(slope - tNaive * seSlope), toDecade(slope + tNaive * seSlope)]
  const pval = tTwoSided(slope / (seAdj || 1e-300), df)
  const b = fit.beta
  const equation =
    model === 'linear' ? `y = ${sig(b[0])} ${b[1] < 0 ? '−' : '+'} ${sig(Math.abs(b[1]))} (t − ${sig(tc, 5)})`
      : model === 'quadratic' ? `y = ${sig(b[0])} ${b[1] < 0 ? '−' : '+'} ${sig(Math.abs(b[1]))} x ${b[2] < 0 ? '−' : '+'} ${sig(Math.abs(b[2]))} x², x = t − ${sig(tc, 5)}`
        : `y = ${sig(Math.exp(b[0]))} e^(${sig(b[1])} (t − ${sig(tc, 5)}))`
  return {
    model, n, t: tt, fitted, lo, hi,
    slopeYr: perYear, perDecade: perYear * 10, ciDecade: ci, ciDecadeNaive: ciNaive, seDecade: toDecade(seAdj), p: pval,
    r2: fit.r2, rmse: fit.sigma, r1, nEff, df, ar1, coef: b, tc,
    total: fitted[n - 1] - fitted[0],
    ...(model === 'exponential' ? { growthPct: (Math.exp(b[1]) - 1) * 100 } : {}),
    ...(model === 'quadratic' ? { acceleration: 2 * b[2] } : {}),
    equation,
  }
}

/** Evaluates a fitted trend at any time. */
export function trendAt(r: TrendResult, t: number): number {
  const x = t - r.tc
  if (r.model === 'linear') return r.coef[0] + r.coef[1] * x
  if (r.model === 'quadratic') return r.coef[0] + r.coef[1] * x + r.coef[2] * x * x
  return Math.exp(r.coef[0] + r.coef[1] * x)
}

// ------------------------------------------------------------------------------------------ breakpoint

export interface BreakpointResult {
  n: number
  /** The time of the break (decimal year) and its year. */
  breakT: number
  breakYear: number
  /** Slopes per decade before and after the break, with 95 % intervals. */
  slope1: number
  slope2: number
  ci1: [number, number]
  ci2: [number, number]
  t: number[]
  fitted: number[]
  /** A straight line through the same data, for comparison. */
  linear: TrendResult
  rss: number
  rssLinear: number
  /** F-test of the break against one line (approximate: the break was chosen to fit the data). */
  p: number
  r1: number
  nEff: number
  /** AIC of both models (lower is better). */
  aic: number
  aicLinear: number
}

/**
 * A continuous two-segment ("hinge") trend y = a + b1 x + b2 max(0, x − c): the break time c is searched over the
 * data (each segment keeps at least `minFrac` of the points), the slope before is b1, after b1 + b2.
 */
export function fitBreakpoint(t: number[], y: number[], opts: { minFrac?: number; ar1?: boolean } = {}): BreakpointResult | null {
  const ar1 = opts.ar1 ?? true
  const tt: number[] = []
  const yy: number[] = []
  for (let i = 0; i < t.length; i++) if (Number.isFinite(t[i]) && Number.isFinite(y[i])) { tt.push(t[i]); yy.push(y[i]) }
  const n = tt.length
  const m = Math.max(5, Math.floor((opts.minFrac ?? 0.15) * n))
  if (n < 2 * m + 2) return null
  const linear = fitTrend(tt, yy, { model: 'linear', ar1 })
  if (!linear) return null
  const tc = mean(tt)
  const xs = tt.map((v) => v - tc)
  const step = Math.max(1, Math.floor((n - 2 * m) / 400))
  let best: { rss: number; c: number; fit: OlsResult } | null = null
  for (let k = m; k < n - m; k += step) {
    const c = xs[k]
    const fit = ols(xs.map((x) => [1, x, Math.max(0, x - c)]), yy)
    if (fit && (!best || fit.rss < best.rss)) best = { rss: fit.rss, c, fit }
  }
  if (!best) return null
  const { fit, c } = best
  const r1 = autocorr1(fit.residuals)
  const nEff = ar1 ? effectiveN(n, r1) : n
  const df = Math.max(1, nEff - 3)
  const infl = ar1 && nEff < n ? Math.sqrt((n - 3) / df) : 1
  const tc95 = tCritical(0.05, df)
  const b = fit.beta
  const s1 = b[1]
  const s2 = b[1] + b[2]
  const se1 = fit.se[1] * infl
  const se2 = Math.sqrt(Math.max(0, fit.cov[1][1] + fit.cov[2][2] + 2 * fit.cov[1][2])) * infl
  const rssLin = linear.rmse ** 2 * (n - 2)
  const F = ((rssLin - fit.rss) / 2) / (fit.rss / (n - 3))
  const aic = (rss: number, k: number) => n * Math.log(rss / n) + 2 * k
  return {
    n, breakT: c + tc, breakYear: yearOf(c + tc),
    slope1: s1 * 10, slope2: s2 * 10,
    ci1: [(s1 - tc95 * se1) * 10, (s1 + tc95 * se1) * 10], ci2: [(s2 - tc95 * se2) * 10, (s2 + tc95 * se2) * 10],
    t: tt, fitted: fit.fitted, linear, rss: fit.rss, rssLinear: rssLin,
    p: Number.isFinite(F) ? fSf(F, 2, n - 3) : NaN, r1, nEff,
    aic: aic(fit.rss, 4), aicLinear: aic(rssLin, 2),
  }
}

export interface PeriodTrend {
  from: number
  to: number
  trend: TrendResult | null
}

/** Linear trends of several periods (years, inclusive) of one series, side by side. */
export function comparePeriods(t: number[], y: number[], periods: Array<[number, number]>, ar1 = true): PeriodTrend[] {
  return periods.map(([from, to]) => {
    const tt: number[] = []
    const yy: number[] = []
    for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] < to + 1) { tt.push(t[i]); yy.push(y[i]) }
    return { from, to, trend: fitTrend(tt, yy, { model: 'linear', ar1 }) }
  })
}

// ----------------------------------------------------------------------------------------- correlation

export function pearson(x: number[], y: number[]): { r: number; n: number } {
  let n = 0, sx = 0, sy = 0
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { n++; sx += x[i]; sy += y[i] }
  if (n < 3) return { r: NaN, n }
  const mx = sx / n
  const my = sy / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return { r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, n }
}

function ranksOf(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(v.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[idx[k][1]] = r
    i = j + 1
  }
  return out
}

export function spearman(x: number[], y: number[]): { r: number; n: number } {
  const ok = x.map((_, i) => Number.isFinite(x[i]) && Number.isFinite(y[i]))
  const xs = x.filter((_, i) => ok[i])
  const ys = y.filter((_, i) => ok[i])
  return pearson(ranksOf(xs), ranksOf(ys))
}

/** Two-sided p-value of a correlation r from n_eff independent values. */
export function corrP(r: number, nEff: number): number {
  if (!Number.isFinite(r) || nEff <= 2) return NaN
  if (Math.abs(r) >= 1) return 0
  return tTwoSided((r * Math.sqrt(nEff - 2)) / Math.sqrt(1 - r * r), nEff - 2)
}

/** The r above which a correlation of n_eff independent values is significant at 95 % (two-sided). */
export function rCritical(nEff: number): number {
  if (nEff <= 2) return 1
  const tc = tCritical(0.05, nEff - 2)
  return tc / Math.sqrt(nEff - 2 + tc * tc)
}

/** Removes the straight-line trend (fitted in x) from y. */
export function detrendLinear(x: number[], y: number[]): number[] {
  const f = fitTrend(x, y, { model: 'linear', ar1: false })
  if (!f) return y.slice()
  return y.map((v, i) => (Number.isFinite(v) && Number.isFinite(x[i]) ? v - (f.coef[0] + f.coef[1] * (x[i] - f.tc)) : NaN))
}

