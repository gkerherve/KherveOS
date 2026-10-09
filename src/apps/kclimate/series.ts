// Time series of kClimate: the Series type, time helpers, annual means, anomalies against a baseline and the
// smoothers (running mean, LOWESS, annual, 11-year). Pure (no React, no OS), so Node can test it.
//
// Time is a decimal year. A monthly value sits in the middle of its month (year + (month − 0.5) / 12), an annual
// value in the middle of its year (year + 0.5). Missing values are NaN.

export type Step = 'monthly' | 'annual' | 'irregular'
/** "anomaly": already a difference from a baseline (temperature anomaly, ENSO index); "level": a quantity (CO2 in ppm). */
export type Kind = 'level' | 'anomaly'

export interface Series {
  /** Unique within a project: "gistemp.global", "user:mydata.col2". */
  id: string
  name: string
  unit: string
  t: number[]
  y: number[]
  step: Step
  kind: Kind
  /** The baseline period the provider used (anomaly series). */
  baseline?: [number, number] | null
  /** Made up for a demonstration: the UI says so. */
  synthetic?: boolean
  /** The dataset it comes from (a catalog id, or "user:…"). */
  dataset?: string
}

export const monthT = (year: number, month: number): number => year + (month - 0.5) / 12
export const yearOf = (t: number): number => Math.floor(t + 1e-9)
export const monthOf = (t: number): number => Math.min(12, Math.max(1, Math.floor((t - Math.floor(t + 1e-9)) * 12 + 1e-6) + 1))
/** Months since year 0 (a whole number for monthly times). */
export const monthIndex = (t: number): number => Math.round(t * 12 - 0.5)

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function median(v: number[]): number {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y)
  if (!a.length) return NaN
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

export const mean = (v: number[]): number => {
  let s = 0
  let n = 0
  for (const x of v) if (Number.isFinite(x)) { s += x; n++ }
  return n ? s / n : NaN
}

export function sd(v: number[]): number {
  const x = v.filter(Number.isFinite)
  if (x.length < 2) return NaN
  const m = mean(x)
  return Math.sqrt(x.reduce((s, a) => s + (a - m) ** 2, 0) / (x.length - 1))
}

/** Median spacing of the times. */
export const medianDt = (t: number[]): number => median(t.slice(1).map((x, i) => x - t[i]))

/** A series without its missing values. */
export function finite(s: { t: number[]; y: number[] }): { t: number[]; y: number[] } {
  const t: number[] = []
  const y: number[] = []
  for (let i = 0; i < s.t.length; i++) if (Number.isFinite(s.y[i]) && Number.isFinite(s.t[i])) { t.push(s.t[i]); y.push(s.y[i]) }
  return { t, y }
}

/** First and last time with a value, or null. */
export function extent(s: Series): [number, number] | null {
  const f = finite(s)
  return f.t.length ? [f.t[0], f.t[f.t.length - 1]] : null
}

/** First and last year with a value (the years a plot axis or a period picker should offer). */
export function yearSpan(s: Series): [number, number] | null {
  const e = extent(s)
  return e ? [yearOf(e[0]), yearOf(e[1])] : null
}

export function withData(s: Series, t: number[], y: number[], patch: Partial<Series> = {}): Series {
  return { ...s, ...patch, t, y }
}

/** The points from year y0 (its first day) to year y1 (its last day). Either end may be null for "no limit". */
export function sliceYears(s: Series, y0: number | null, y1: number | null): Series {
  const lo = y0 === null || !Number.isFinite(y0) ? -Infinity : y0
  const hi = y1 === null || !Number.isFinite(y1) ? Infinity : y1 + 1
  const t: number[] = []
  const y: number[] = []
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= lo && s.t[i] < hi) { t.push(s.t[i]); y.push(s.y[i]) }
  return withData(s, t, y)
}

/** How many values a series has per year (12, 1, or its sampling rate). */
export function perYear(s: Series): number {
  if (s.step === 'monthly') return 12
  if (s.step === 'annual') return 1
  const dt = medianDt(s.t)
  return Number.isFinite(dt) && dt > 0 ? Math.round(1 / dt) : 1
}

/**
 * Annual means. A year counts when at least `minFrac` of its values are there (10 of 12 months by default), so the
 * running year and years with holes do not give a misleading mean. An annual series comes back as it is.
 */
export function annualMeans(s: Series, minFrac = 0.8): Series {
  if (s.step === 'annual') return { ...s }
  const need = Math.max(1, Math.ceil(perYear(s) * minFrac - 1e-9))
  const sum = new Map<number, { total: number; n: number }>()
  for (let i = 0; i < s.t.length; i++) {
    if (!Number.isFinite(s.y[i])) continue
    const yr = yearOf(s.t[i])
    const e = sum.get(yr) ?? { total: 0, n: 0 }
    e.total += s.y[i]
    e.n++
    sum.set(yr, e)
  }
  const years = [...sum.keys()].sort((a, b) => a - b).filter((yr) => sum.get(yr)!.n >= need)
  return withData(s, years.map((yr) => yr + 0.5), years.map((yr) => sum.get(yr)!.total / sum.get(yr)!.n), { step: 'annual' })
}

export interface BaselineResult {
  series: Series
  /** What was subtracted (a number, or null for a monthly climatology). */
  offset: number | null
  /** Fraction of the baseline period that has data. */
  coverage: number
  note: string
}

export interface BaselineFailure {
  error: string
}

export const BASELINES: Array<{ id: string; label: string; period: [number, number] }> = [
  { id: '1850-1900', label: '1850–1900 (pre-industrial)', period: [1850, 1900] },
  { id: '1951-1980', label: '1951–1980', period: [1951, 1980] },
  { id: '1961-1990', label: '1961–1990', period: [1961, 1990] },
  { id: '1981-2010', label: '1981–2010', period: [1981, 2010] },
  { id: '1991-2020', label: '1991–2020', period: [1991, 2020] },
]

export function baselineById(id: string): [number, number] | null {
  const b = BASELINES.find((x) => x.id === id)
  if (b) return b.period
  const m = /^(\d{4})-(\d{4})$/.exec(id)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/**
 * The series as anomalies against the mean of a baseline period (years b0 to b1, inclusive). `mode` "constant"
 * subtracts one number (right for temperature anomalies, which have no seasonal cycle left); "climatology" subtracts the
 * mean of each calendar month (right for a monthly quantity with a seasonal cycle: CO2, sea-ice extent). With less
 * than 40 % of the baseline covered the result is an error; below 90 % it carries a warning note.
 */
export function anomalyVsBaseline(s: Series, baseline: [number, number], mode: 'constant' | 'climatology' | 'auto' = 'auto'): BaselineResult | BaselineFailure {
  const [b0, b1] = baseline
  if (!(b1 >= b0)) return { error: 'The baseline must end after it begins.' }
  const useClim = mode === 'climatology' || (mode === 'auto' && s.step === 'monthly' && s.kind === 'level')
  const years = b1 - b0 + 1
  const inBase: number[] = []
  const baseMonth: number[][] = Array.from({ length: 12 }, () => [])
  const baseYears = new Set<number>()
  for (let i = 0; i < s.t.length; i++) {
    if (!Number.isFinite(s.y[i]) || s.t[i] < b0 || s.t[i] >= b1 + 1) continue
    inBase.push(s.y[i])
    baseYears.add(yearOf(s.t[i]))
    if (s.step === 'monthly') baseMonth[monthOf(s.t[i]) - 1].push(s.y[i])
  }
  const expected = s.step === 'monthly' ? years * 12 : s.step === 'annual' ? years : years * Math.max(1, perYear(s))
  // for irregular data the years with any value are what counts
  const coverage = s.step === 'irregular' ? baseYears.size / years : inBase.length / expected
  const label = `${b0}–${b1}`
  if (!inBase.length || coverage < 0.4) {
    const e = extent(s)
    return { error: `This series has ${inBase.length ? `only ${Math.round(coverage * 100)} % of` : 'no data in'} the baseline ${label}${e ? ` (it covers ${yearOf(e[0])}–${yearOf(e[1])})` : ''}. Pick another baseline.` }
  }
  const note = coverage < 0.9 ? `Only ${Math.round(coverage * 100)} % of ${label} has data for this series, so its baseline is partial.` : ''
  if (useClim && s.step === 'monthly') {
    const clim = baseMonth.map((v) => (v.length >= Math.max(1, years * 0.4) ? mean(v) : NaN))
    if (clim.some((c) => !Number.isFinite(c))) return { error: `Some calendar months have too few values in ${label} for a monthly baseline.` }
    return { series: withData(s, s.t.slice(), s.y.map((v, i) => v - clim[monthOf(s.t[i]) - 1]), { kind: 'anomaly', baseline, unit: s.unit }), offset: null, coverage, note }
  }
  // the mean of annual means, so that a month-heavy baseline year does not weigh more
  const off = mean(inBase)
  return { series: withData(s, s.t.slice(), s.y.map((v) => v - off), { kind: 'anomaly', baseline }), offset: off, coverage, note }
}

// ------------------------------------------------------------------------------------------------ smoothing

/**
 * Centred running mean over `windowYears` (time-based, so it suits monthly, annual and irregular data). Values at
 * exactly half a window away count half, so 1 year of monthly data is the usual 2×12-month filter. Where fewer
 * than `minFrac` of the expected values are in the window (the ends, or a gap) the result is NaN.
 */
export function runningMean(s: Series, windowYears: number, minFrac = 0.75): Series {
  const n = s.t.length
  const out = new Array<number>(n).fill(NaN)
  if (!(windowYears > 0) || n === 0) return withData(s, s.t.slice(), out)
  const dt = medianDt(s.t) || 1
  const expected = Math.max(1, windowYears / dt)
  const half = windowYears / 2
  const eps = Math.min(1e-6, dt * 1e-3)
  let lo = 0
  for (let i = 0; i < n; i++) {
    while (lo < n && s.t[lo] < s.t[i] - half - eps) lo++
    let sum = 0
    let w = 0
    let cnt = 0
    for (let j = lo; j < n && s.t[j] <= s.t[i] + half + eps; j++) {
      if (!Number.isFinite(s.y[j])) continue
      const edge = Math.abs(Math.abs(s.t[j] - s.t[i]) - half) <= eps
      const wt = edge ? 0.5 : 1
      sum += wt * s.y[j]
      w += wt
      cnt += wt
    }
    if (w > 0 && cnt >= minFrac * expected && Number.isFinite(s.y[i])) out[i] = sum / w
  }
  return withData(s, s.t.slice(), out)
}

/**
 * LOWESS (Cleveland 1979): locally weighted linear regression with tricube weights on the nearest `frac` of the
 * points, `iters` robustness iterations (bisquare weights) that damp outliers. Returns the smoothed y at every x.
 */
export function lowess(x: number[], y: number[], frac = 0.3, iters = 2): number[] {
  const n = x.length
  const out = new Array<number>(n).fill(NaN)
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) idx.push(i)
  const m = idx.length
  if (m < 3) return out
  const X = idx.map((i) => x[i])
  const Y = idx.map((i) => y[i])
  const q = Math.min(m, Math.max(3, Math.ceil(frac * m)))
  const robust = new Array<number>(m).fill(1)
  let fit = new Array<number>(m).fill(NaN)
  for (let it = 0; it <= iters; it++) {
    let left = 0
    for (let i = 0; i < m; i++) {
      // the q nearest points form a window [left, left + q)
      while (left + q < m && X[i] - X[left] > X[left + q] - X[i]) left++
      const right = left + q
      const h = Math.max(X[i] - X[left], X[right - 1] - X[i]) || 1e-12
      let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0
      for (let j = left; j < right; j++) {
        const u = Math.abs(X[j] - X[i]) / h
        const w = (u < 1 ? (1 - u ** 3) ** 3 : 0) * robust[j]
        sw += w; swx += w * X[j]; swy += w * Y[j]; swxx += w * X[j] * X[j]; swxy += w * X[j] * Y[j]
      }
      if (sw <= 0) { fit[i] = Y[i]; continue }
      const mx = swx / sw
      const my = swy / sw
      const vxx = swxx / sw - mx * mx
      const slope = vxx > 1e-18 ? (swxy / sw - mx * my) / vxx : 0
      fit[i] = my + slope * (X[i] - mx)
    }
    if (it === iters) break
    const res = fit.map((f, i) => Math.abs(Y[i] - f))
    const s6 = 6 * median(res)
    if (!(s6 > 0)) break
    for (let i = 0; i < m; i++) {
      const u = res[i] / s6
      robust[i] = u < 1 ? (1 - u * u) ** 2 : 0
    }
  }
  idx.forEach((i, k) => { out[i] = fit[k] })
  return out
}

export type SmoothSpec =
  | { kind: 'none' }
  | { kind: 'running'; years: number }
  | { kind: 'lowess'; years: number }
  | { kind: 'annual' }
  | { kind: 'decadal'; years?: number }

export const SMOOTH_LABELS: Record<SmoothSpec['kind'], string> = {
  none: 'None', running: 'Running mean', lowess: 'LOWESS', annual: 'Annual means', decadal: '11-year mean of annual means',
}

/** Smoothing as the plot controls offer it. `annual` and `decadal` first average to years (years with at least 80 % of the values). */
export function smooth(s: Series, spec: SmoothSpec): Series {
  switch (spec.kind) {
    case 'none': return s
    case 'annual': return annualMeans(s)
    case 'running': return runningMean(s, Math.max(spec.years, 0.001))
    case 'decadal': return runningMean(annualMeans(s), spec.years ?? 11)
    case 'lowess': {
      const e = extent(s)
      const span = e ? e[1] - e[0] : 1
      const frac = Math.min(1, Math.max(0.02, spec.years / Math.max(span, 1e-9)))
      return withData(s, s.t.slice(), lowess(s.t, s.y, frac, 2))
    }
  }
}

/** Series values at the given times by linear interpolation (NaN outside the data). */
export function interp(t: number[], y: number[], at: number): number {
  const n = t.length
  if (!n || at < t[0] || at > t[n - 1]) return NaN
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= at) lo = mid
    else hi = mid
  }
  if (t[hi] === t[lo]) return y[lo]
  const f = (at - t[lo]) / (t[hi] - t[lo])
  return y[lo] + f * (y[hi] - y[lo])
}

// ------------------------------------------------------------------------------------------------- statistics

export interface Stat {
  n: number
  mean: number
  min: number
  max: number
  tMin: number
  tMax: number
  sd: number
}

export function describe(s: { t: number[]; y: number[] }): Stat | null {
  const f = finite(s)
  if (!f.y.length) return null
  let imin = 0
  let imax = 0
  for (let i = 1; i < f.y.length; i++) {
    if (f.y[i] < f.y[imin]) imin = i
    if (f.y[i] > f.y[imax]) imax = i
  }
  return { n: f.y.length, mean: mean(f.y), min: f.y[imin], max: f.y[imax], tMin: f.t[imin], tMax: f.t[imax], sd: sd(f.y) }
}

export function quantile(values: number[], p: number): number {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y)
  if (!a.length) return NaN
  const pos = (a.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return a[lo] + (a[hi] - a[lo]) * (pos - lo)
}

export interface Histogram {
  edges: number[]
  counts: number[]
  width: number
}

/** Equal-width histogram (Freedman–Diaconis number of bins unless given). */
export function histogram(values: number[], bins?: number, range?: [number, number]): Histogram {
  const v = values.filter(Number.isFinite)
  if (!v.length) return { edges: [0, 1], counts: [0], width: 1 }
  let lo = range ? range[0] : Math.min(...v)
  let hi = range ? range[1] : Math.max(...v)
  if (hi <= lo) { lo -= 0.5; hi += 0.5 }
  let k = bins
  if (!k) {
    const iqr = quantile(v, 0.75) - quantile(v, 0.25)
    const h = iqr > 0 ? (2 * iqr) / Math.cbrt(v.length) : (hi - lo) / Math.max(5, Math.sqrt(v.length))
    k = Math.min(60, Math.max(5, Math.ceil((hi - lo) / h)))
  }
  const width = (hi - lo) / k
  const counts = new Array<number>(k).fill(0)
  for (const x of v) {
    if (x < lo || x > hi) continue
    counts[Math.min(k - 1, Math.floor((x - lo) / width))]++
  }
  return { edges: Array.from({ length: k + 1 }, (_, i) => lo + i * width), counts, width }
}

/** The mean of annual values per decade ("1980s" = 1980–1989) with the number of years that had a value. */
export function decadalMeans(annual: Series): Array<{ decade: number; mean: number; n: number }> {
  const by = new Map<number, number[]>()
  for (let i = 0; i < annual.t.length; i++) {
    if (!Number.isFinite(annual.y[i])) continue
    const d = Math.floor(yearOf(annual.t[i]) / 10) * 10
    by.set(d, [...(by.get(d) ?? []), annual.y[i]])
  }
  return [...by.keys()].sort((a, b) => a - b).map((decade) => ({ decade, mean: mean(by.get(decade)!), n: by.get(decade)!.length }))
}

/** The years with the highest (or lowest) annual value, best first. */
export function records(annual: Series, count = 10, order: 'warmest' | 'coldest' = 'warmest'): Array<{ year: number; value: number; rank: number }> {
  const rows: Array<{ year: number; value: number }> = []
  for (let i = 0; i < annual.t.length; i++) if (Number.isFinite(annual.y[i])) rows.push({ year: yearOf(annual.t[i]), value: annual.y[i] })
  rows.sort((a, b) => (order === 'warmest' ? b.value - a.value : a.value - b.value))
  return rows.slice(0, count).map((r, i) => ({ ...r, rank: i + 1 }))
}

/** Seasonal climatology: the mean of each calendar month. */
export function monthlyClimatology(s: Series, y0: number | null = null, y1: number | null = null): number[] {
  const sub = sliceYears(s, y0, y1)
  const buckets: number[][] = Array.from({ length: 12 }, () => [])
  for (let i = 0; i < sub.t.length; i++) if (Number.isFinite(sub.y[i])) buckets[monthOf(sub.t[i]) - 1].push(sub.y[i])
  return buckets.map((b) => mean(b))
}
