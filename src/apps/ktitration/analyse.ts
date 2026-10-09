// Analysis of measured titration data (pure): parsing pasted V/pH(/T) columns, local-quadratic smoothing with
// first and second derivatives, equivalence points (peak of the first derivative, zero of the second), and
// Gran plots with their linear regressions and standard errors.

import { pKw } from './equilibria.ts'

export interface TitrationData {
  /** Titrant volume (mL), increasing. */
  V: number[]
  pH: number[]
  /** Temperature per point (°C), when given. */
  T?: number[]
}

export interface ParsedData {
  data: TitrationData
  /** Lines that were not numbers (headers, comments) and were skipped. */
  skipped: number
  warnings: string[]
}

const num = (s: string): number => {
  const t = s.trim().replace(/^[+]/, '')
  return t === '' || !/^[-−]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? NaN : Number(t.replace('−', '-'))
}

/** Reads columns V, pH and optionally T from pasted text (tab, space, semicolon or comma separated; decimal comma allowed with ; or tab). */
export function parseData(text: string): ParsedData {
  const rows: Array<[number, number, number | null]> = []
  let skipped = 0
  const warnings: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    let cells: string[]
    if (line.includes(';')) cells = line.split(';').map((c) => c.replace(',', '.'))
    else if (line.includes('\t')) cells = line.split('\t').map((c) => c.replace(',', '.'))
    else cells = line.split(/[\s,]+/)
    const v = cells.map(num)
    if (v.length < 2 || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) { skipped++; continue }
    rows.push([v[0], v[1], Number.isFinite(v[2]) ? v[2] : null])
  }
  rows.sort((a, b) => a[0] - b[0])
  // merge repeated volumes (average)
  const merged: typeof rows = []
  for (const r of rows) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last[0] - r[0]) < 1e-12) {
      last[1] = (last[1] + r[1]) / 2
      warnings.push(`Volume ${r[0]} appears twice: the pH values were averaged.`)
    } else merged.push([...r])
  }
  const hasT = merged.length > 0 && merged.every((r) => r[2] !== null)
  const data: TitrationData = { V: merged.map((r) => r[0]), pH: merged.map((r) => r[1]), ...(hasT ? { T: merged.map((r) => r[2] as number) } : {}) }
  if (merged.length > 0 && merged.length < 6) warnings.push('Fewer than 6 points: the derivative and the fit will be rough.')
  if (merged.some((r) => r[1] < -2 || r[1] > 16)) warnings.push('Some pH values are outside −2…16: check the columns (volume first, then pH).')
  return { data, skipped, warnings }
}

export function dataToText(d: TitrationData): string {
  return d.V.map((v, i) => `${v}\t${d.pH[i]}${d.T ? `\t${d.T[i]}` : ''}`).join('\n')
}

// ---------------------------------------------------------------------------------------------- derivatives

export interface Smoothed {
  x: number[]
  y: number[]
  d1: number[]
  d2: number[]
}

/** Local quadratic fits over ±half neighbours: smoothed values and first and second derivatives at every point (non-uniform grids are fine). */
export function smoothDerivatives(x: readonly number[], y: readonly number[], half = 2): Smoothed {
  const n = x.length
  const out: Smoothed = { x: [...x], y: [], d1: [], d2: [] }
  for (let i = 0; i < n; i++) {
    let a = Math.max(0, i - half)
    let b = Math.min(n - 1, i + half)
    // keep the window size near the edges
    while (b - a < 2 * half && (a > 0 || b < n - 1)) {
      if (a > 0 && (b - a < 2 * half)) a--
      if (b < n - 1 && (b - a < 2 * half)) b++
    }
    if (b - a < 2) {
      out.y.push(y[i]); out.d1.push(0); out.d2.push(0)
      continue
    }
    // normal equations of y = c0 + c1 dx + c2 dx², dx = x − x_i (scaled)
    const sc = Math.max(x[b] - x[a], 1e-12)
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0
    for (let k = a; k <= b; k++) {
      const d = (x[k] - x[i]) / sc
      const d2 = d * d
      s0 += 1; s1 += d; s2 += d2; s3 += d2 * d; s4 += d2 * d2
      t0 += y[k]; t1 += y[k] * d; t2 += y[k] * d2
    }
    const c = solve3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2])
    if (!c) { out.y.push(y[i]); out.d1.push(0); out.d2.push(0); continue }
    out.y.push(c[0])
    out.d1.push(c[1] / sc)
    out.d2.push((2 * c[2]) / (sc * sc))
  }
  return out
}

function solve3(A: number[][], b: number[]): [number, number, number] | null {
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-14) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
}

/** Divided differences: dy/dx at the midpoints of consecutive points. */
export function midpointSlopes(x: readonly number[], y: readonly number[]): { x: number[]; d: number[] } {
  const xs: number[] = []
  const d: number[] = []
  for (let i = 0; i + 1 < x.length; i++) {
    const dx = x[i + 1] - x[i]
    if (dx <= 0) continue
    xs.push((x[i] + x[i + 1]) / 2)
    d.push((y[i + 1] - y[i]) / dx)
  }
  return { x: xs, d }
}

// ---------------------------------------------------------------------------------------------- equivalence points

export interface DetectedEquivalence {
  /** Best estimate (mL): the zero of the second derivative when found, else the peak of the first. */
  V: number
  /** Vertex of the parabola through the three largest slopes. */
  V1: number
  /** Zero of the second derivative between the two slopes around the peak (null when not found). */
  V2: number | null
  /** pH at V (interpolated). */
  pH: number
  /** |dpH/dV| at the peak. */
  slope: number
}

function interp(x: readonly number[], y: readonly number[], v: number): number {
  if (v <= x[0]) return y[0]
  for (let i = 1; i < x.length; i++) {
    if (v <= x[i]) return y[i - 1] + ((y[i] - y[i - 1]) * (v - x[i - 1])) / (x[i] - x[i - 1])
  }
  return y[y.length - 1]
}

/** Equivalence points of measured data: peaks of |dpH/dV| above `prominence` of the largest, at least 3 slopes apart. */
export function detectEquivalence(d: TitrationData, opts: { prominence?: number; max?: number } = {}): DetectedEquivalence[] {
  const prominence = opts.prominence ?? 0.2
  const { x: xm, d: dm } = midpointSlopes(d.V, d.pH)
  if (dm.length < 3) return []
  const a = dm.map(Math.abs)
  const top = Math.max(...a)
  if (!(top > 0)) return []
  const peaks: number[] = []
  for (let i = 0; i < a.length; i++) {
    const l = a[i - 1] ?? -1
    const r = a[i + 1] ?? -1
    if (a[i] >= l && a[i] > r && a[i] >= prominence * top) peaks.push(i)
  }
  // keep the larger of peaks that are too close
  const kept: number[] = []
  for (const p of peaks.sort((u, v) => a[v] - a[u])) if (kept.every((k) => Math.abs(k - p) >= 3)) kept.push(p)
  kept.sort((u, v) => u - v)
  const s2x: number[] = []
  const s2: number[] = []
  for (let i = 0; i + 1 < dm.length; i++) {
    s2x.push((xm[i] + xm[i + 1]) / 2)
    s2.push((dm[i + 1] - dm[i]) / (xm[i + 1] - xm[i]))
  }
  const out: DetectedEquivalence[] = []
  for (const i of kept.slice(0, opts.max ?? 6)) {
    let V1 = xm[i]
    if (i > 0 && i < a.length - 1) {
      // parabola through (xm, |dm|) of the three points
      const [x0, x1, x2] = [xm[i - 1], xm[i], xm[i + 1]]
      const [y0, y1, y2] = [a[i - 1], a[i], a[i + 1]]
      const den = (x0 - x1) * (x0 - x2) * (x1 - x2)
      const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den
      const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den
      if (A < 0) V1 = -B / (2 * A)
    }
    // zero of the second derivative between slope i−1/i and i/i+1
    let V2: number | null = null
    for (const j of [i - 1, i]) {
      if (j >= 0 && j + 1 < s2.length && s2[j] * s2[j + 1] < 0) {
        V2 = s2x[j] + ((0 - s2[j]) * (s2x[j + 1] - s2x[j])) / (s2[j + 1] - s2[j])
        break
      }
    }
    if (V2 === null && i >= 1 && i < s2.length && s2[i - 1] * s2[i] < 0) V2 = s2x[i - 1] + ((0 - s2[i - 1]) * (s2x[i] - s2x[i - 1])) / (s2[i] - s2[i - 1])
    const V = V2 !== null && Math.abs(V2 - V1) < 2 * (xm[Math.min(i + 1, xm.length - 1)] - xm[Math.max(i - 1, 0)]) ? V2 : V1
    out.push({ V, V1, V2, pH: interp(d.V, d.pH, V), slope: a[i] })
  }
  return out
}

// ---------------------------------------------------------------------------------------------- regression and Gran

export interface LineFit {
  slope: number
  intercept: number
  /** Standard errors. */
  seSlope: number
  seIntercept: number
  r2: number
  n: number
  /** x where the line crosses zero, and its standard error. */
  xIntercept: number
  seXIntercept: number
}

export function linearFit(x: readonly number[], y: readonly number[]): LineFit | null {
  const n = x.length
  if (n < 3) return null
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2
    sxy += (x[i] - mx) * (y[i] - my)
    syy += (y[i] - my) ** 2
  }
  if (!(sxx > 0)) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let sse = 0
  for (let i = 0; i < n; i++) sse += (y[i] - intercept - slope * x[i]) ** 2
  const s2 = sse / (n - 2)
  const varSlope = s2 / sxx
  const varInt = s2 * (1 / n + (mx * mx) / sxx)
  const cov = (-s2 * mx) / sxx
  const xi = -intercept / slope
  const varX = (varInt + xi * xi * varSlope + 2 * xi * cov) / (slope * slope)
  return {
    slope, intercept, seSlope: Math.sqrt(varSlope), seIntercept: Math.sqrt(varInt), r2: syy > 0 ? 1 - sse / syy : 1, n,
    xIntercept: xi, seXIntercept: Math.sqrt(Math.max(varX, 0)),
  }
}

export interface GranOptions {
  /** Initial volume of the flask (mL). */
  V0: number
  /** Concentration of the titrant (mol/L); with it the analyte concentration is reported. */
  Ct?: number
  /** Volume of the sample (mL) that the concentration refers to (default V0). */
  aliquot?: number
  /** 'base' titrant raises the pH. */
  titrant: 'base' | 'acid'
  /** Weak analyte (V·[H⁺] vs V gives Ka) or strong ((V0+V)[H⁺] vs V). */
  kind: 'strong' | 'weak'
  /** Approximate equivalence volume (mL), usually from the derivative. */
  Veq: number
  /** Fractions of Veq used before the equivalence point, and after: defaults 0.3–0.9 and 1.1–1.6. */
  before?: [number, number]
  after?: [number, number]
  temperature?: number
}

export interface GranBranch {
  /** The points of the whole curve for this function (x = V). */
  x: number[]
  y: number[]
  /** Indices used in the regression. */
  used: number[]
  fit: LineFit | null
  /** Equivalence volume from the line. */
  Ve: number | null
}

export interface GranResult {
  before: GranBranch
  after: GranBranch
  /** Mean of the equivalence volumes found (those that exist). */
  Ve: number | null
  /** Analyte concentration from the mean volume, when Ct is known. */
  conc: number | null
  /** pKa from the slope before the equivalence point (weak analytes), uncorrected for activities. */
  pKa: number | null
}

export function granAnalysis(d: TitrationData, o: GranOptions): GranResult {
  const kwv = Math.pow(10, -pKw(o.temperature ?? 25))
  const [b1, b2] = o.before ?? [0.3, 0.9]
  const [a1, a2] = o.after ?? [1.1, 1.6]
  // before the equivalence point the species in excess is the analyte; the function G1 follows [H⁺] (base titrant) or [OH⁻] (acid titrant)
  const gBefore = (V: number, pH: number) => {
    const free = o.titrant === 'base' ? Math.pow(10, -pH) : Math.pow(10, pH) * kwv
    return (o.kind === 'weak' ? V : o.V0 + V) * free
  }
  const gAfter = (V: number, pH: number) => (o.V0 + V) * (o.titrant === 'base' ? Math.pow(10, pH) * kwv : Math.pow(10, -pH))
  const branch = (g: (V: number, pH: number) => number, lo: number, hi: number): GranBranch => {
    const y = d.V.map((v, i) => g(v, d.pH[i]))
    const used = d.V.map((_, i) => i).filter((i) => d.V[i] >= lo * o.Veq && d.V[i] <= hi * o.Veq && d.V[i] > 0)
    const fit = linearFit(used.map((i) => d.V[i]), used.map((i) => y[i]))
    return { x: [...d.V], y, used, fit, Ve: fit && fit.slope !== 0 ? fit.xIntercept : null }
  }
  const before = branch(gBefore, b1, b2)
  const after = branch(gAfter, a1, a2)
  const found = [before.Ve, after.Ve].filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)
  const Ve = found.length ? found.reduce((s, v) => s + v, 0) / found.length : null
  const conc = Ve !== null && o.Ct ? (Ve * o.Ct) / (o.aliquot ?? o.V0) : null
  const pKa = o.kind === 'weak' && before.fit && before.fit.slope < 0 ? -Math.log10(-before.fit.slope) : null
  return { before, after, Ve, conc, pKa }
}
