// Numbers for kPlot: least-squares fits, descriptive statistics, histogram bins, box-plot
// statistics. Pure functions.

export const finite = (v: number): boolean => Number.isFinite(v)

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

/** Sample standard deviation (n − 1). */
export function sd(v: number[]): number {
  if (v.length < 2) return 0
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}

/** Quantile of sorted values, linear interpolation (the usual "type 7"). */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export interface BoxStats {
  n: number
  q1: number
  median: number
  q3: number
  /** The whisker ends: the most extreme values within 1.5 IQR of the box. */
  lo: number
  hi: number
  outliers: number[]
  mean: number
}

export function boxStats(values: number[]): BoxStats | null {
  const v = values.filter(finite).sort((a, b) => a - b)
  if (!v.length) return null
  const q1 = quantile(v, 0.25)
  const q3 = quantile(v, 0.75)
  const iqr = q3 - q1
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr)
  return {
    n: v.length,
    q1,
    median: quantile(v, 0.5),
    q3,
    lo: inside[0],
    hi: inside[inside.length - 1],
    outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
    mean: mean(v),
  }
}

export interface Histogram {
  /** bins + 1 edges. */
  edges: number[]
  counts: number[]
  /** Counts divided by (n × bin width): the area is 1. */
  density: number[]
}

/** Sturges' rule, kept between 5 and 60. */
export function autoBins(n: number): number {
  return Math.min(60, Math.max(5, Math.ceil(Math.log2(Math.max(1, n))) + 1))
}

/** Count `values` in `bins` equal bins over [lo, hi] (the last bin includes hi). */
export function histogram(values: number[], bins: number, lo?: number, hi?: number): Histogram {
  const v = values.filter(finite)
  const min = lo ?? (v.length ? Math.min(...v) : 0)
  let max = hi ?? (v.length ? Math.max(...v) : 1)
  if (max === min) max = min + 1
  const nb = Math.max(1, Math.round(bins))
  const w = (max - min) / nb
  const edges = Array.from({ length: nb + 1 }, (_, i) => (i === nb ? max : min + i * w))
  const counts = new Array<number>(nb).fill(0)
  for (const x of v) {
    if (x < min || x > max) continue
    counts[Math.min(nb - 1, Math.floor((x - min) / w))]++
  }
  const n = counts.reduce((a, b) => a + b, 0)
  return { edges, counts, density: counts.map((c) => (n ? c / (n * w) : 0)) }
}

export interface PolyFit {
  /** From the constant term up: y = c0 + c1 x + c2 x² … */
  coef: number[]
  r2: number
  n: number
}

/** Least-squares polynomial of `degree` (QR on the centred, scaled x). Null when there are too few points. */
export function polyFit(xs: number[], ys: number[], degree: number): PolyFit | null {
  const pts: [number, number][] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) if (finite(xs[i]) && finite(ys[i])) pts.push([xs[i], ys[i]])
  const d = Math.round(degree)
  const n = pts.length
  if (d < 1 || n < d + 1) return null
  const m = mean(pts.map((p) => p[0]))
  const s = Math.max(...pts.map((p) => Math.abs(p[0] - m))) || 1
  const cols = d + 1
  // Design matrix of the scaled x (Vandermonde), solved by modified Gram–Schmidt.
  const A = pts.map(([x]) => Array.from({ length: cols }, (_, k) => ((x - m) / s) ** k))
  const Q: number[][] = []
  const R: number[][] = Array.from({ length: cols }, () => new Array<number>(cols).fill(0))
  for (let k = 0; k < cols; k++) {
    const v = A.map((row) => row[k])
    for (let j = 0; j < k; j++) {
      R[j][k] = Q[j].reduce((a, q, i) => a + q * v[i], 0)
      for (let i = 0; i < n; i++) v[i] -= R[j][k] * Q[j][i]
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0))
    if (norm < 1e-12) return null
    R[k][k] = norm
    Q.push(v.map((b) => b / norm))
  }
  const rhs = Q.map((q) => q.reduce((a, b, i) => a + b * pts[i][1], 0))
  const c = new Array<number>(cols).fill(0)
  for (let k = cols - 1; k >= 0; k--) {
    let t = rhs[k]
    for (let j = k + 1; j < cols; j++) t -= R[k][j] * c[j]
    c[k] = t / R[k][k]
  }
  // y = Σ c_k ((x − m)/s)^k  →  coefficients of x^j.
  const coef = new Array<number>(cols).fill(0)
  for (let k = 0; k < cols; k++) {
    let binom = 1
    for (let j = 0; j <= k; j++) {
      coef[j] += (c[k] / s ** k) * binom * (-m) ** (k - j)
      binom = (binom * (k - j)) / (j + 1)
    }
  }
  const ybar = mean(pts.map((p) => p[1]))
  let ssRes = 0
  let ssTot = 0
  for (const [x, y] of pts) {
    ssRes += (y - evalPoly(coef, x)) ** 2
    ssTot += (y - ybar) ** 2
  }
  return { coef, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n }
}

export function evalPoly(coef: number[], x: number): number {
  let y = 0
  for (let k = coef.length - 1; k >= 0; k--) y = y * x + coef[k]
  return y
}

/** A number with `sig` significant digits, as label markup (1.2×10^{-4} for very small or large values). */
export function sigText(v: number, sig = 3): string {
  if (v === 0) return '0'
  if (!finite(v)) return String(v)
  const a = Math.abs(v)
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(sig - 1).split('e')
    return `${Number(m)}×10^{${Number(e)}}`
  }
  return String(Number(v.toPrecision(sig)))
}

/** `y = 2.01x + 0.98` (label markup), highest power first. */
export function equationText(coef: number[]): string {
  const parts: string[] = []
  for (let k = coef.length - 1; k >= 0; k--) {
    const c = coef[k]
    if (k < coef.length - 1 && c === 0) continue
    const mag = sigText(Math.abs(c))
    const v = k === 0 ? '' : k === 1 ? 'x' : `x^{${k}}`
    const body = k > 0 && Math.abs(c) === 1 ? v : `${mag}${v}`
    if (!parts.length) parts.push(`${c < 0 ? '−' : ''}${body}`)
    else parts.push(`${c < 0 ? '−' : '+'} ${body}`)
  }
  return `y = ${parts.join(' ')}`
}

export const r2Text = (r2: number): string => `R^{2} = ${r2.toFixed(4)}`
