// Seasonal-cycle analysis: harmonic regression plus a polynomial trend (the classic decomposition of the Keeling
// curve), the seasonal amplitude over time, and the mean seasonal cycle. Pure.

import { ols, fitTrend, type TrendResult } from './stats.ts'
import { mean, monthT, type Series, withData, yearOf } from './series.ts'

export interface HarmonicFit {
  harmonics: number
  degree: number
  /** Time origin of the polynomial (x = t − t0). */
  t0: number
  /** [a0 … a_degree, then (cos k, sin k) for k = 1…harmonics]. */
  beta: number[]
  t: number[]
  /** The values that were fitted. */
  y: number[]
  /** The polynomial part: the long-term trend. */
  trend: number[]
  /** The harmonic part: the seasonal cycle. */
  seasonal: number[]
  fitted: number[]
  residual: number[]
  /** y minus the seasonal cycle. */
  deseasonalized: number[]
  rmse: number
  r2: number
  /** Peak-to-peak size of the fitted seasonal cycle (same unit as y). */
  amplitude: number
  /** Fractional month (1 = start of January) of the maximum and the minimum of the cycle. */
  peakMonth: number
  troughMonth: number
  /** The cycle at the middle of each calendar month (12 values). */
  cycle: number[]
  /** Growth rate of the trend per year at every time. */
  rate: number[]
}

/** Value of the harmonic part at fraction f of the year (0 ≤ f < 1). */
export function seasonalAt(beta: number[], degree: number, harmonics: number, f: number): number {
  let s = 0
  for (let k = 1; k <= harmonics; k++) {
    const a = beta[degree + 1 + 2 * (k - 1)]
    const b = beta[degree + 2 + 2 * (k - 1)]
    s += a * Math.cos(2 * Math.PI * k * f) + b * Math.sin(2 * Math.PI * k * f)
  }
  return s
}

const frac = (t: number) => t - Math.floor(t + 1e-9)

function designRow(x: number, f: number, degree: number, harmonics: number): number[] {
  const row: number[] = []
  for (let d = 0; d <= degree; d++) row.push(x ** d)
  for (let k = 1; k <= harmonics; k++) row.push(Math.cos(2 * Math.PI * k * f), Math.sin(2 * Math.PI * k * f))
  return row
}

/**
 * Fits y(t) = polynomial(t − t0) + Σ_k [a_k cos 2πkt + b_k sin 2πkt] by least squares. The NOAA/Scripps analysis of the
 * Mauna Loa record uses a quadratic and four harmonics (the defaults).
 */
export function harmonicFit(t: number[], y: number[], opts: { harmonics?: number; degree?: number } = {}): HarmonicFit | null {
  const harmonics = opts.harmonics ?? 4
  const degree = opts.degree ?? 2
  const tt: number[] = []
  const yy: number[] = []
  for (let i = 0; i < t.length; i++) if (Number.isFinite(t[i]) && Number.isFinite(y[i])) { tt.push(t[i]); yy.push(y[i]) }
  const p = degree + 1 + 2 * harmonics
  if (tt.length < p + 6) return null
  const t0 = mean(tt)
  // scale x to about ±1 for the polynomial's conditioning, undone below
  const span = Math.max(1e-9, (tt[tt.length - 1] - tt[0]) / 2)
  const X = tt.map((v) => designRow((v - t0) / span, frac(v), degree, harmonics))
  const fit = ols(X, yy)
  if (!fit) return null
  // beta of the polynomial in years
  const beta = fit.beta.slice()
  for (let d = 0; d <= degree; d++) beta[d] = fit.beta[d] / span ** d
  const trend = tt.map((v) => { let s = 0; for (let d = 0; d <= degree; d++) s += beta[d] * (v - t0) ** d; return s })
  const seasonal = tt.map((v) => seasonalAt(beta, degree, harmonics, frac(v)))
  const rate = tt.map((v) => { let s = 0; for (let d = 1; d <= degree; d++) s += d * beta[d] * (v - t0) ** (d - 1); return s })
  let lo = Infinity, hi = -Infinity, fLo = 0, fHi = 0
  for (let i = 0; i < 480; i++) {
    const f = i / 480
    const v = seasonalAt(beta, degree, harmonics, f)
    if (v > hi) { hi = v; fHi = f }
    if (v < lo) { lo = v; fLo = f }
  }
  return {
    harmonics, degree, t0, beta, t: tt, y: yy, trend, seasonal, fitted: fit.fitted, residual: fit.residuals,
    deseasonalized: yy.map((v, i) => v - seasonal[i]), rmse: fit.sigma, r2: fit.r2,
    amplitude: hi - lo, peakMonth: fHi * 12 + 1, troughMonth: fLo * 12 + 1,
    cycle: Array.from({ length: 12 }, (_, m) => seasonalAt(beta, degree, harmonics, (m + 0.5) / 12)),
    rate,
  }
}

export interface Decomposition {
  fit: HarmonicFit
  trend: Series
  seasonal: Series
  residual: Series
  deseasonalized: Series
}

/** The harmonic fit as four series (trend, seasonal cycle, residual, deseasonalized data). */
export function decompose(s: Series, opts: { harmonics?: number; degree?: number } = {}): Decomposition | null {
  const fit = harmonicFit(s.t, s.y, opts)
  if (!fit) return null
  const mk = (suffix: string, y: number[], kind: Series['kind'] = s.kind): Series => withData(s, fit.t, y, { id: `${s.id}~${suffix}`, name: `${s.name}: ${suffix}`, step: s.step, kind })
  return {
    fit,
    trend: mk('trend', fit.trend),
    seasonal: mk('seasonal cycle', fit.seasonal, 'anomaly'),
    residual: mk('residual', fit.residual, 'anomaly'),
    deseasonalized: mk('deseasonalized', fit.deseasonalized),
  }
}

export interface AmplitudeResult {
  /** Peak-to-peak seasonal amplitude of each year (placed on mid-year). */
  series: Series
  trend: TrendResult | null
  /** Years that could not be fitted (not enough data). */
  skipped: number
}

/**
 * How the size of the seasonal cycle changes: for every year, a harmonic fit with a straight-line trend to the
 * `windowYears` (odd, 5 by default) centred on it, and the peak-to-peak size of its cycle. A straight line is trend
 * enough inside such a short window, and the harmonics follow the slowly changing cycle.
 */
export function seasonalAmplitude(s: Series, opts: { windowYears?: number; harmonics?: number } = {}): AmplitudeResult {
  const w = Math.max(3, opts.windowYears ?? 5)
  const half = Math.floor(w / 2)
  const harmonics = opts.harmonics ?? 3
  const ys = s.t.filter((_, i) => Number.isFinite(s.y[i])).map(yearOf)
  if (!ys.length) return { series: withData(s, [], [], { id: `${s.id}~amplitude`, name: `${s.name}: seasonal amplitude`, step: 'annual', kind: 'level' }), trend: null, skipped: 0 }
  const first = Math.min(...ys)
  const last = Math.max(...ys)
  const t: number[] = []
  const y: number[] = []
  let skipped = 0
  for (let year = first; year <= last; year++) {
    // a window that stays inside the record: it slides in at the ends
    let a = year - half
    let b = year + half
    if (a < first) { b += first - a; a = first }
    if (b > last) { a -= b - last; b = last }
    a = Math.max(a, first)
    const tt: number[] = []
    const yy: number[] = []
    for (let i = 0; i < s.t.length; i++) if (Number.isFinite(s.y[i]) && s.t[i] >= a && s.t[i] < b + 1) { tt.push(s.t[i]); yy.push(s.y[i]) }
    const years = new Set(tt.map(yearOf)).size
    if (years < Math.min(w, 3) || tt.length < years * 8) { skipped++; continue }
    const f = harmonicFit(tt, yy, { harmonics, degree: 1 })
    if (!f) { skipped++; continue }
    t.push(year + 0.5)
    y.push(f.amplitude)
  }
  const series: Series = { id: `${s.id}~amplitude`, name: `${s.name}: seasonal amplitude`, unit: s.unit, t, y, step: 'annual', kind: 'level', dataset: s.dataset, ...(s.synthetic ? { synthetic: true } : {}) }
  return { series, trend: fitTrend(t, y, { model: 'linear', ar1: true }), skipped }
}

/** The mean seasonal cycle (departure of each calendar month from its year's mean) over the years given. */
export function meanSeasonalCycle(s: Series, y0: number | null = null, y1: number | null = null): { month: number; mean: number; sd: number; n: number }[] {
  const by = new Map<number, number[]>()
  for (let i = 0; i < s.t.length; i++) {
    if (!Number.isFinite(s.y[i])) continue
    const yr = yearOf(s.t[i])
    if ((y0 !== null && yr < y0) || (y1 !== null && yr > y1)) continue
    by.set(yr, [...(by.get(yr) ?? []), i])
  }
  const out = Array.from({ length: 12 }, () => [] as number[])
  for (const idx of by.values()) {
    if (idx.length < 10) continue
    const m = mean(idx.map((i) => s.y[i]))
    for (const i of idx) out[Math.min(11, Math.floor((s.t[i] - Math.floor(s.t[i] + 1e-9)) * 12))].push(s.y[i] - m)
  }
  return out.map((v, k) => ({
    month: k + 1, mean: mean(v), n: v.length,
    sd: v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean(v)) ** 2, 0) / (v.length - 1)) : NaN,
  }))
}

/** A synthetic seasonal series for tests and demonstrations: trend + seasonal cycle + (optional) noise from `noise`. */
export function syntheticSeasonal(opts: {
  year0: number
  years: number
  base: number
  slopePerYear: number
  curvature?: number
  amplitude: number
  amplitudeGrowthPerYear?: number
  phase?: number
  noise?: (i: number) => number
}): Series {
  const t: number[] = []
  const y: number[] = []
  const n = opts.years * 12
  for (let i = 0; i < n; i++) {
    const yr = opts.year0 + Math.floor(i / 12)
    const m = (i % 12) + 1
    const tm = monthT(yr, m)
    const x = tm - opts.year0
    const amp = opts.amplitude + (opts.amplitudeGrowthPerYear ?? 0) * x
    t.push(tm)
    y.push(opts.base + opts.slopePerYear * x + (opts.curvature ?? 0) * x * x + (amp / 2) * Math.cos(2 * Math.PI * (frac(tm) - (opts.phase ?? 0))) + (opts.noise ? opts.noise(i) : 0))
  }
  return { id: 'synthetic.seasonal', name: 'Synthetic seasonal series', unit: '', t, y, step: 'monthly', kind: 'level', synthetic: true }
}
