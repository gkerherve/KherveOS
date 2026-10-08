// The statistics of kStats: descriptive statistics, least-squares polynomial fits
// (degree 1 is a straight line) and R². Plain numbers in, plain numbers out.

import { tCritical, tSf } from './distributions.ts'

export interface Describe {
  n: number
  mean: number
  /** Sample standard deviation (n − 1). */
  sd: number
  /** Standard error of the mean. */
  sem: number
  median: number
  min: number
  max: number
  sum: number
  /** First and third quartile (linear interpolation, as R's default and Excel's QUARTILE.INC). */
  q1: number
  q3: number
  iqr: number
  /** Sample skewness (adjusted Fisher–Pearson), NaN when n < 3. */
  skew: number
  /** Sample excess kurtosis, NaN when n < 4. */
  kurt: number
  /** 95 % confidence interval of the mean (Student t). */
  ciLo: number
  ciHi: number
}

export const sum = (v: number[]) => v.reduce((s, x) => s + x, 0)
export const mean = (v: number[]) => sum(v) / v.length

/** Sample standard deviation (n − 1); 0 for a single value. */
export function sd(v: number[]): number {
  const n = v.length
  if (n < 2) return 0
  const m = mean(v)
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1))
}

/** The p-quantile (0–1) of a sorted array, by linear interpolation between ranks. */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(n - 1, lo + 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

export function quantile(values: number[], p: number): number {
  return quantileSorted([...values].sort((a, b) => a - b), p)
}

export function median(values: number[]): number {
  return quantile(values, 0.5)
}

/** Skewness g1 and excess kurtosis g2 from the population moments (used by Jarque–Bera). */
export function moments(v: number[]): { g1: number; g2: number } {
  const n = v.length
  const m = mean(v)
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const x of v) {
    const d = x - m
    m2 += d * d
    m3 += d ** 3
    m4 += d ** 4
  }
  m2 /= n
  m3 /= n
  m4 /= n
  return { g1: m3 / m2 ** 1.5, g2: m4 / (m2 * m2) - 3 }
}

export function describe(values: number[]): Describe | null {
  const n = values.length
  if (n === 0) return null
  const total = sum(values)
  const m = total / n
  const s = sd(values)
  const sorted = [...values].sort((a, b) => a - b)
  const median = quantileSorted(sorted, 0.5)
  const q1 = quantileSorted(sorted, 0.25)
  const q3 = quantileSorted(sorted, 0.75)
  const sem = n > 1 ? s / Math.sqrt(n) : 0
  let skew = NaN
  let kurt = NaN
  if (n >= 3 && s > 0) {
    skew = (n / ((n - 1) * (n - 2))) * values.reduce((a, x) => a + ((x - m) / s) ** 3, 0)
  }
  if (n >= 4 && s > 0) {
    const k4 = values.reduce((a, x) => a + ((x - m) / s) ** 4, 0)
    kurt = (n * (n + 1) * k4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  }
  const half = n > 1 ? tCritical(0.05, n - 1) * sem : 0
  return {
    n, mean: m, sd: s, sem, median, min: sorted[0], max: sorted[n - 1], sum: total,
    q1, q3, iqr: q3 - q1, skew, kurt, ciLo: m - half, ciHi: m + half,
  }
}

export interface Outliers {
  /** Tukey fences (1.5 × IQR beyond the quartiles). */
  fenceLo: number
  fenceHi: number
  /** Indexes (into the given array) outside the fences. */
  iqr: number[]
  grubbs: { n: number; g: number; critical: number; p: number; index: number; value: number; outlier: boolean } | null
}

/** Outlier flags: 1.5×IQR fences, and Grubbs' test (two-sided, α = 0.05) for the most extreme value. */
export function outliers(values: number[]): Outliers {
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantileSorted(sorted, 0.25)
  const q3 = quantileSorted(sorted, 0.75)
  const fenceLo = q1 - 1.5 * (q3 - q1)
  const fenceHi = q3 + 1.5 * (q3 - q1)
  const iqr: number[] = []
  values.forEach((v, i) => {
    if (v < fenceLo || v > fenceHi) iqr.push(i)
  })
  const n = values.length
  let grubbs: Outliers['grubbs'] = null
  const s = sd(values)
  if (n >= 3 && s > 0) {
    const m = mean(values)
    let idx = 0
    values.forEach((v, i) => {
      if (Math.abs(v - m) > Math.abs(values[idx] - m)) idx = i
    })
    const g = Math.abs(values[idx] - m) / s
    const t = tCritical(0.05 / n, n - 2)
    const critical = ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t))
    const denom = (n - 1) ** 2 - n * g * g
    const tg = denom > 0 ? Math.sqrt((n * (n - 2) * g * g) / denom) : Infinity
    const p = Math.min(1, 2 * n * tSf(tg, n - 2))
    grubbs = { n, g, critical, p, index: idx, value: values[idx], outlier: g > critical }
  }
  return { fenceLo, fenceHi, iqr, grubbs }
}

/** Ranks (1 = smallest), ties get their average rank. */
export function ranks(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(v.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k][1]] = r
    i = j + 1
  }
  return out
}

export interface Histogram {
  /** Bin edges (length bins + 1). */
  edges: number[]
  counts: number[]
  width: number
}

/** Histogram with Freedman–Diaconis bins (Sturges when the IQR is 0), or a chosen number of bins. */
export function histogram(values: number[], bins?: number): Histogram {
  const n = values.length
  if (n === 0) return { edges: [0, 1], counts: [0], width: 1 }
  const sorted = [...values].sort((a, b) => a - b)
  const lo = sorted[0]
  const hi = sorted[n - 1]
  if (hi === lo) return { edges: [lo - 0.5, lo + 0.5], counts: [n], width: 1 }
  let k = bins
  if (!k) {
    const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25)
    const h = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0
    k = h > 0 ? Math.ceil((hi - lo) / h) : Math.ceil(Math.log2(n) + 1)
    k = Math.max(3, Math.min(40, k))
  }
  const width = (hi - lo) / k
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * width)
  const counts = new Array<number>(k).fill(0)
  for (const v of values) counts[Math.min(k - 1, Math.floor((v - lo) / width))]++
  return { edges, counts, width }
}

export interface Fit {
  /** Coefficients from the constant term up: y = c0 + c1·x + c2·x² …  */
  coefficients: number[]
  r2: number
  /** Residual standard deviation (what the points scatter by around the curve). */
  residualSd: number
  n: number
}

/** Solve A·x = b (A is n×n) by Gaussian elimination with partial pivoting. Null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Least-squares polynomial of the given degree (1–6) through (x, y). */
export function polyFit(x: number[], y: number[], degree: number): Fit | null {
  const n = x.length
  const m = Math.floor(degree)
  if (!(m >= 1 && m <= 6) || n <= m) return null
  const A: number[][] = Array.from({ length: m + 1 }, () => Array(m + 1).fill(0))
  const b: number[] = Array(m + 1).fill(0)
  for (let i = 0; i < n; i++) {
    const powers = Array.from({ length: m + 1 }, (_, k) => x[i] ** k)
    for (let r = 0; r <= m; r++) {
      b[r] += powers[r] * y[i]
      for (let c = 0; c <= m; c++) A[r][c] += powers[r] * powers[c]
    }
  }
  const coefficients = solve(A, b)
  if (!coefficients) return null
  const meanY = y.reduce((s, v) => s + v, 0) / n
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const pred = coefficients.reduce((s, c, k) => s + c * x[i] ** k, 0)
    ssRes += (y[i] - pred) ** 2
    ssTot += (y[i] - meanY) ** 2
  }
  return {
    coefficients,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    residualSd: n - m - 1 > 0 ? Math.sqrt(ssRes / (n - m - 1)) : 0,
    n,
  }
}

/** The fitted value at x. */
export function evaluate(fit: Fit, x: number): number {
  return fit.coefficients.reduce((s, c, k) => s + c * x ** k, 0)
}

/** A number for people: 4 significant figures, scientific notation when very large or small. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '–'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3)
  return Number(v.toPrecision(4)).toString()
}

/** A p-value for people: "< 0.0001" or 4 decimals, scientific below 1e-4 is avoided. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '–'
  if (p < 1e-4) return '< 0.0001'
  return p.toFixed(4)
}

/** Fixed decimals but never "-0.00". */
export function fixed(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '–'
  const s = v.toFixed(digits)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}
