// Curve fitting for kStats: polynomials and other linear-in-parameters models by weighted
// least squares, the other models by Levenberg–Marquardt. Every fit reports the
// parameters with standard errors, 95 % confidence intervals and t-test p-values, R², adjusted
// R², RMSE and AIC, and can give a confidence band. Pure (no browser).

import { tCritical, tTwoSided } from './distributions.ts'
import { fmt } from './math.ts'

export interface ModelDef {
  id: string
  label: string
  params: string[]
  f(x: number, p: number[]): number
  /** ∂f/∂p at x (nonlinear models). */
  grad?(x: number, p: number[]): number[]
  /** Basis functions (linear-in-parameters models): f = Σ pₖ·basis(x)ₖ. */
  basis?(x: number): number[]
  /** Polynomial degree (the basis is then scaled internally for accuracy). */
  poly?: number
  /** Starting guesses for the iteration (nonlinear models). */
  starts?(x: number[], y: number[]): number[][]
  equation(p: number[]): string
  /** Why this model cannot be fitted to this data, or null. */
  check?(x: number[], y: number[]): string | null
}

export interface ParamEstimate {
  name: string
  value: number
  se: number
  lo: number
  hi: number
  t: number
  p: number
}

export interface FitResult {
  model: string
  label: string
  equation: string
  params: ParamEstimate[]
  /** The raw parameter values (same order as `params`). */
  p: number[]
  /** Covariance matrix of the parameters (already scaled by the residual variance). */
  cov: number[][]
  n: number
  k: number
  dof: number
  r2: number
  adjR2: number
  rmse: number
  /** sqrt(SSE / dof), in the units of y. */
  residualSd: number
  sse: number
  aic: number
  aicc: number
  /** Reduced chi-square when the fit was weighted by uncertainties, else null. */
  chi2red: number | null
  weighted: boolean
  converged: boolean
  iterations: number
  tcrit: number
  /** The residual variance used for prediction intervals (weighted units). */
  s2: number
  residuals: number[]
  fitted: number[]
}

// ------------------------------------------------------------------ models

const sgn = (v: number) => (v < 0 ? '−' : '+')
const num = (v: number) => fmt(v)
const term = (v: number, rest: string) => `${sgn(v)} ${fmt(Math.abs(v))}${rest}`
const SUP = ['', '', '²', '³', '⁴', '⁵', '⁶']

function polyModel(degree: number): ModelDef {
  return {
    id: `poly${degree}`,
    label: degree === 1 ? 'Straight line' : `Polynomial (degree ${degree})`,
    params: Array.from({ length: degree + 1 }, (_, k) => `a${k}`),
    poly: degree,
    f: (x, p) => p.reduce((s, c, k) => s + c * x ** k, 0),
    basis: (x) => Array.from({ length: degree + 1 }, (_, k) => x ** k),
    equation: (p) => `y = ${num(p[0])}` + p.slice(1).map((c, i) => ` ${term(c, `·x${SUP[i + 1]}`)}`).join(''),
  }
}

function span(v: number[]) {
  let lo = Infinity
  let hi = -Infinity
  for (const x of v) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  return { lo, hi, range: hi - lo || 1 }
}

/** Slope and intercept of the least-squares line (for starting guesses). */
function line(x: number[], y: number[]): [number, number] {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
  }
  const b = sxx > 0 ? sxy / sxx : 0
  return [my - b * mx, b]
}

const sameSign = (y: number[]) => y.every((v) => v > 0) || y.every((v) => v < 0)

/** Where the peak is, how high, and a width guess (σ-like: FWHM / 2.355). */
function peakGuess(x: number[], y: number[]) {
  let imax = 0
  for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[imax])) imax = i
  const amp = y[imax]
  const half = Math.abs(amp) / 2
  let lo = x[imax]
  let hi = x[imax]
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(y[i]) >= half) {
      lo = Math.min(lo, x[i])
      hi = Math.max(hi, x[i])
    }
  }
  const fwhm = hi - lo
  const { range } = span(x)
  return { amp, center: x[imax], fwhm: fwhm > 0 ? fwhm : range / 4, range }
}

export const MODELS: ModelDef[] = [
  ...[1, 2, 3, 4, 5, 6].map(polyModel),
  {
    id: 'exp',
    label: 'Exponential',
    params: ['a', 'b'],
    f: (x, [a, b]) => a * Math.exp(b * x),
    grad: (x, [a, b]) => [Math.exp(b * x), a * x * Math.exp(b * x)],
    starts: (x, y) => {
      const out: number[][] = []
      const { range } = span(x)
      if (sameSign(y)) {
        const s = y[0] < 0 ? -1 : 1
        const [c, b] = line(x, y.map((v) => Math.log(Math.abs(v))))
        out.push([s * Math.exp(c), b])
      }
      const m = y.reduce((a, b) => a + b, 0) / y.length || 1
      out.push([m, 1 / range], [m, -1 / range], [m, 0.1 / range])
      return out
    },
    equation: ([a, b]) => `y = ${num(a)}·exp(${num(b)}·x)`,
  },
  {
    id: 'power',
    label: 'Power law',
    params: ['a', 'b'],
    f: (x, [a, b]) => a * x ** b,
    grad: (x, [a, b]) => [x ** b, a * x ** b * Math.log(x)],
    check: (x) => (x.some((v) => v <= 0) ? 'needs x > 0' : null),
    starts: (x, y) => {
      const out: number[][] = []
      if (sameSign(y) && x.every((v) => v > 0)) {
        const s = y[0] < 0 ? -1 : 1
        const [c, b] = line(x.map(Math.log), y.map((v) => Math.log(Math.abs(v))))
        out.push([s * Math.exp(c), b])
      }
      out.push([1, 1], [1, 2], [1, 0.5], [1, -1])
      return out
    },
    equation: ([a, b]) => `y = ${num(a)}·x^${num(b)}`,
  },
  {
    id: 'log',
    label: 'Logarithmic',
    params: ['a', 'b'],
    f: (x, [a, b]) => a + b * Math.log(x),
    basis: (x) => [1, Math.log(x)],
    check: (x) => (x.some((v) => v <= 0) ? 'needs x > 0' : null),
    equation: ([a, b]) => `y = ${num(a)} ${term(b, '·ln(x)')}`,
  },
  {
    id: 'mm',
    label: 'Saturating (Michaelis–Menten)',
    params: ['Vmax', 'Km'],
    f: (x, [v, k]) => (v * x) / (k + x),
    grad: (x, [v, k]) => [x / (k + x), (-v * x) / (k + x) ** 2],
    starts: (x, y) => {
      const ymax = Math.max(...y.map(Math.abs)) * (y.some((v) => v < 0) && !y.some((v) => v > 0) ? -1 : 1)
      const xs = [...x].sort((a, b) => a - b)
      const med = xs[Math.floor(xs.length / 2)] || 1
      return [[ymax * 1.1, med], [ymax * 2, med * 2], [ymax, Math.abs(med) / 4 + 1e-3], [ymax * 1.5, Math.max(...x)]]
    },
    equation: ([v, k]) => `y = ${num(v)}·x / (${num(k)} + x)`,
  },
  {
    id: 'gauss',
    label: 'Gaussian',
    params: ['A', 'μ', 'σ'],
    f: (x, [a, m, s]) => a * Math.exp(-((x - m) ** 2) / (2 * s * s)),
    grad: (x, [a, m, s]) => {
      const e = Math.exp(-((x - m) ** 2) / (2 * s * s))
      return [e, (a * e * (x - m)) / (s * s), (a * e * (x - m) ** 2) / s ** 3]
    },
    starts: (x, y) => {
      const g = peakGuess(x, y)
      const s0 = g.fwhm / 2.355
      return [[g.amp, g.center, s0], [g.amp, g.center, s0 / 3], [g.amp, g.center, s0 * 3], [g.amp, g.center, g.range / 6]]
    },
    equation: ([a, m, s]) => `y = ${num(a)}·exp(−(x − ${num(m)})² / (2·${num(Math.abs(s))}²))`,
  },
  {
    id: 'lorentz',
    label: 'Lorentzian',
    params: ['A', 'x0', 'γ'],
    f: (x, [a, x0, g]) => a / (1 + ((x - x0) / g) ** 2),
    grad: (x, [a, x0, g]) => {
      const u = (x - x0) / g
      const d = 1 + u * u
      return [1 / d, (a * 2 * u) / (g * d * d), (2 * a * u * u) / (g * d * d)]
    },
    starts: (x, y) => {
      const p = peakGuess(x, y)
      const g0 = p.fwhm / 2
      return [[p.amp, p.center, g0], [p.amp, p.center, g0 / 3], [p.amp, p.center, g0 * 3], [p.amp, p.center, p.range / 6]]
    },
    equation: ([a, x0, g]) => `y = ${num(a)} / (1 + ((x − ${num(x0)}) / ${num(Math.abs(g))})²)`,
  },
  {
    id: 'logistic',
    label: 'Logistic (sigmoid)',
    params: ['L', 'k', 'x0'],
    f: (x, [l, k, x0]) => l / (1 + Math.exp(-k * (x - x0))),
    grad: (x, [l, k, x0]) => {
      const e = Math.exp(-k * (x - x0))
      const d = (1 + e) ** 2
      return [1 / (1 + e), (l * (x - x0) * e) / d, (-l * k * e) / d]
    },
    starts: (x, y) => {
      const { range, lo, hi } = span(x)
      const ymax = Math.max(...y)
      const ymin = Math.min(...y)
      const target = (ymax + ymin) / 2
      // x where y is closest to the middle of its range
      let best = 0
      for (let i = 1; i < y.length; i++) if (Math.abs(y[i] - target) < Math.abs(y[best] - target)) best = i
      const x0 = x[best] ?? (lo + hi) / 2
      const l = Math.abs(ymax) >= Math.abs(ymin) ? ymax : ymin
      const k0 = 4 / range
      return [[l, k0, x0], [l, -k0, x0], [l, 3 * k0, x0], [l, -3 * k0, x0], [l * 1.1, 8 / range, x0]]
    },
    equation: ([l, k, x0]) => `y = ${num(l)} / (1 + exp(−${num(k)}·(x − ${num(x0)})))`,
  },
]

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Model ids by a friendly name or number: "linear", "poly 3", "gaussian", "exp"… */
export function modelFromName(name: string): string | null {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!s) return null
  if (getModel(s)) return s
  const alias: Record<string, string> = {
    linear: 'poly1', line: 'poly1', straightline: 'poly1', exponential: 'exp', powerlaw: 'power', logarithmic: 'log', ln: 'log',
    saturating: 'mm', michaelismenten: 'mm', michaelis: 'mm', gaussian: 'gauss', normal: 'gauss', lorentzian: 'lorentz',
    sigmoid: 'logistic', quadratic: 'poly2', cubic: 'poly3',
  }
  if (alias[s]) return alias[s]
  const m = /^(?:poly|polynomial|degree)(\d)$/.exec(s)
  return m && getModel(`poly${m[1]}`) ? `poly${m[1]}` : null
}

// ------------------------------------------------------------ linear algebra

/** Inverse by Gauss–Jordan with partial pivoting; null when singular. */
export function invert(A: number[][]): number[][] | null {
  const n = A.length
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (!(Math.abs(M[p][c]) > 1e-300)) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c]
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c]
      if (f === 0) continue
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const out = M.map((row) => row.slice(n))
  return out.every((r) => r.every(Number.isFinite)) ? out : null
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
}

// ------------------------------------------------------------ Levenberg–Marquardt

export interface LmResult {
  p: number[]
  sse: number
  iterations: number
  converged: boolean
}

type F = (x: number, p: number[]) => number
type G = (x: number, p: number[]) => number[]

/** Central-difference gradient, for models without an analytic one. */
export function numericGrad(f: F): G {
  return (x, p) =>
    p.map((v, j) => {
      const h = 1e-6 * Math.max(Math.abs(v), 1e-3)
      const a = p.slice()
      const b = p.slice()
      a[j] = v + h
      b[j] = v - h
      return (f(x, a) - f(x, b)) / (2 * h)
    })
}

/** Weighted sum of squares Σ wᵢ (yᵢ − f(xᵢ, p))²  (Infinity if anything is not finite). */
export function sumSquares(f: F, p: number[], x: number[], y: number[], w: number[]): number {
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const r = y[i] - f(x[i], p)
    s += w[i] * r * r
  }
  return Number.isFinite(s) ? s : Infinity
}

/**
 * Levenberg–Marquardt least squares (Marquardt's diagonal scaling): minimises Σ wᵢ (yᵢ − f(xᵢ, p))²
 * from the starting values p0. With no `grad`, the gradient is taken numerically.
 */
export function levenbergMarquardt(
  f: F, grad: G | null, p0: number[], x: number[], y: number[], w: number[], maxIter = 400,
): LmResult {
  const g = grad ?? numericGrad(f)
  const m = p0.length
  let p = p0.slice()
  let sse = sumSquares(f, p, x, y, w)
  if (!Number.isFinite(sse)) return { p, sse, iterations: 0, converged: false }
  let lambda = 1e-3
  let converged = false
  let it = 0
  for (; it < maxIter; it++) {
    const JtJ: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
    const Jtr = new Array<number>(m).fill(0)
    for (let i = 0; i < x.length; i++) {
      const gi = g(x[i], p)
      const r = y[i] - f(x[i], p)
      for (let a = 0; a < m; a++) {
        Jtr[a] += w[i] * gi[a] * r
        for (let b = 0; b <= a; b++) JtJ[a][b] += w[i] * gi[a] * gi[b]
      }
    }
    for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) JtJ[a][b] = JtJ[b][a]
    let accepted = false
    while (lambda < 1e14) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)))
      const inv = invert(A)
      if (inv) {
        const delta = matVec(inv, Jtr)
        const pn = p.map((v, j) => v + delta[j])
        const sn = sumSquares(f, pn, x, y, w)
        if (Number.isFinite(sn) && sn <= sse) {
          const rel = sse > 0 ? (sse - sn) / sse : 0
          const step = Math.max(...delta.map((d, j) => Math.abs(d) / (Math.abs(p[j]) + 1e-12)))
          p = pn
          sse = sn
          lambda = Math.max(lambda / 10, 1e-12)
          accepted = true
          if (rel < 1e-14 || step < 1e-10) converged = true
          break
        }
      }
      lambda *= 10
    }
    if (!accepted) {
      converged = true // no downhill step is left: a minimum (or as close as double precision gets)
      break
    }
    if (converged) break
  }
  return { p, sse, iterations: it, converged }
}

// ----------------------------------------------------------------- fitting

export interface FitOptions {
  /** Weights wᵢ = 1/σᵢ² (relative: the covariance is scaled by the residual variance). */
  sigma?: number[]
  /** Confidence level of the intervals (default 0.95). */
  level?: number
}

function binom(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/** Weighted linear least squares on the model's basis; returns p and (XᵀWX)⁻¹. */
function solveLinear(basis: (x: number) => number[], x: number[], y: number[], w: number[], m: number) {
  const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0))
  const b = new Array<number>(m).fill(0)
  for (let i = 0; i < x.length; i++) {
    const phi = basis(x[i])
    for (let r = 0; r < m; r++) {
      b[r] += w[i] * phi[r] * y[i]
      for (let c = 0; c < m; c++) A[r][c] += w[i] * phi[r] * phi[c]
    }
  }
  const inv = invert(A)
  if (!inv) return null
  return { p: matVec(inv, b), inv }
}

/** Fit one model; null with a reason when it cannot be fitted. */
export function fitModel(
  modelId: string, x: number[], y: number[], opts: FitOptions = {},
): FitResult | { error: string } {
  const def = getModel(modelId)
  if (!def) return { error: `Unknown model "${modelId}".` }
  const n = x.length
  const k = def.params.length
  if (n !== y.length) return { error: 'x and y have different lengths.' }
  if (n <= k) return { error: `Needs more than ${k} points (has ${n}).` }
  const why = def.check?.(x, y)
  if (why) return { error: why }
  const weighted = !!opts.sigma
  let w: number[] = new Array<number>(n).fill(1)
  if (opts.sigma) {
    if (opts.sigma.length !== n || opts.sigma.some((s) => !(s > 0) || !Number.isFinite(s))) {
      return { error: 'The uncertainties must be positive numbers.' }
    }
    w = opts.sigma.map((s) => 1 / (s * s))
  }

  let p: number[]
  let unscaledCov: number[][]
  let converged = true
  let iterations = 0

  if (def.basis) {
    let basis = def.basis
    let T: number[][] | null = null
    if (def.poly) {
      const { lo, hi } = span(x)
      const mid = (lo + hi) / 2
      const half = (hi - lo) / 2 || 1
      const deg = def.poly
      basis = (xv) => {
        const u = (xv - mid) / half
        return Array.from({ length: deg + 1 }, (_, j) => u ** j)
      }
      // raw coefficient j = Σ_k T[j][k]·(scaled coefficient k)
      T = Array.from({ length: deg + 1 }, (_, j) =>
        Array.from({ length: deg + 1 }, (_, kk) => (kk < j ? 0 : (binom(kk, j) * (-mid) ** (kk - j)) / half ** kk)))
    }
    const sol = solveLinear(basis, x, y, w, k)
    if (!sol) return { error: 'The data does not determine this model (singular matrix).' }
    if (T) {
      const TT = T
      p = matVec(TT, sol.p)
      const TC = TT.map((row) => sol.inv.map((_, c) => row.reduce((s, tv, j) => s + tv * sol.inv[j][c], 0)))
      unscaledCov = TC.map((row) => TT.map((trow) => row.reduce((s, v, j) => s + v * trow[j], 0)))
    } else {
      p = sol.p
      unscaledCov = sol.inv
    }
  } else {
    const starts = (def.starts?.(x, y) ?? []).filter((s) => s.every(Number.isFinite))
    let best: LmResult | null = null
    for (const s of starts) {
      const r = levenbergMarquardt(def.f, def.grad ?? null, s, x, y, w)
      if (Number.isFinite(r.sse) && (!best || r.sse < best.sse)) best = r
    }
    if (!best) return { error: 'The fit did not start (no usable starting values for this data).' }
    p = best.p
    converged = best.converged
    iterations = best.iterations
    const g = def.grad ?? numericGrad(def.f)
    const JtJ: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0))
    for (let i = 0; i < n; i++) {
      const gi = g(x[i], p)
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) JtJ[a][b] += w[i] * gi[a] * gi[b]
    }
    const inv = invert(JtJ)
    if (!inv) return { error: 'The parameters are not independent for this data (singular matrix).' }
    unscaledCov = inv
  }

  const fitted = x.map((xv) => def.f(xv, p))
  if (!fitted.every(Number.isFinite) || !p.every(Number.isFinite)) return { error: 'The fit diverged.' }
  const residuals = y.map((yv, i) => yv - fitted[i])
  const sse = residuals.reduce((s, r) => s + r * r, 0)
  const sseW = residuals.reduce((s, r, i) => s + w[i] * r * r, 0)
  const sumW = w.reduce((s, v) => s + v, 0)
  const ybarW = y.reduce((s, v, i) => s + w[i] * v, 0) / sumW
  const sst = y.reduce((s, v, i) => s + w[i] * (v - ybarW) ** 2, 0)
  const dof = n - k
  const r2 = sst > 0 ? 1 - sseW / sst : 1
  const adjR2 = dof > 0 && sst > 0 ? 1 - ((1 - r2) * (n - 1)) / dof : r2
  const s2 = sseW / dof
  const level = opts.level ?? 0.95
  const tcrit = tCritical(1 - level, dof)
  const cov = unscaledCov.map((row) => row.map((v) => v * s2))
  const params: ParamEstimate[] = def.params.map((name, j) => {
    const se = Math.sqrt(Math.max(cov[j][j], 0))
    const t = se > 0 ? p[j] / se : Infinity
    return { name, value: p[j], se, lo: p[j] - tcrit * se, hi: p[j] + tcrit * se, t, p: se > 0 ? tTwoSided(t, dof) : 0 }
  })
  const aic = n * Math.log(Math.max(sseW, 1e-300) / n) + 2 * (k + 1)
  const aicc = n - k - 2 > 0 ? aic + (2 * (k + 1) * (k + 2)) / (n - k - 2) : Infinity
  return {
    model: def.id, label: def.label, equation: def.equation(p), params, p, cov, n, k, dof, r2, adjR2,
    rmse: Math.sqrt(sse / n), residualSd: Math.sqrt(sse / dof), sse, aic, aicc,
    chi2red: weighted ? s2 : null, weighted, converged, iterations, tcrit, s2, residuals, fitted,
  }
}

export const isFit = (r: FitResult | { error: string }): r is FitResult => !('error' in r)

// -------------------------------------------------------------- prediction

function gradAt(def: ModelDef, x: number, p: number[]): number[] {
  if (def.basis) return def.basis(x)
  return (def.grad ?? numericGrad(def.f))(x, p)
}

export interface Prediction {
  x: number
  y: number
  /** Standard error of the fitted curve at x. */
  se: number
  /** Confidence interval of the curve (where the true mean y lies). */
  lo: number
  hi: number
  /** Prediction interval of a new single measurement. */
  plo: number
  phi: number
}

/** The fitted value at x with its confidence and prediction intervals. */
export function predict(fit: FitResult, x: number): Prediction {
  const def = getModel(fit.model)!
  const y = def.f(x, fit.p)
  const g = gradAt(def, x, fit.p)
  let v = 0
  for (let a = 0; a < g.length; a++) for (let b = 0; b < g.length; b++) v += g[a] * fit.cov[a][b] * g[b]
  const se = Math.sqrt(Math.max(v, 0))
  const sePred = Math.sqrt(Math.max(v, 0) + fit.s2)
  const h = fit.tcrit * se
  const hp = fit.tcrit * sePred
  return { x, y, se, lo: y - h, hi: y + h, plo: y - hp, phi: y + hp }
}

/** The curve, with its band, sampled over [x0, x1]. */
export function curve(fit: FitResult, x0: number, x1: number, points = 200): Prediction[] {
  const out: Prediction[] = []
  for (let i = 0; i < points; i++) out.push(predict(fit, x0 + ((x1 - x0) * i) / (points - 1)))
  return out.filter((q) => Number.isFinite(q.y))
}

// -------------------------------------------------------------- comparison

export interface CompareRow {
  model: string
  label: string
  fit: FitResult | null
  error: string | null
  deltaAic: number
  weight: number
}

/** Fit several models (all by default) and rank them by AIC, best first. */
export function compareModels(
  x: number[], y: number[], opts: FitOptions = {}, ids: string[] = ['poly1', 'poly2', 'poly3', 'exp', 'power', 'log', 'mm', 'gauss', 'lorentz', 'logistic'],
): CompareRow[] {
  const rows: CompareRow[] = ids.map((id) => {
    const def = getModel(id)
    const r = fitModel(id, x, y, opts)
    return isFit(r)
      ? { model: id, label: def?.label ?? id, fit: r, error: null, deltaAic: 0, weight: 0 }
      : { model: id, label: def?.label ?? id, fit: null, error: r.error, deltaAic: NaN, weight: 0 }
  })
  const ok = rows.filter((r) => r.fit)
  // small samples: use the corrected AIC where it exists
  const score = (r: CompareRow) => (r.fit!.aicc !== Infinity && ok.every((o) => o.fit!.aicc !== Infinity) ? r.fit!.aicc : r.fit!.aic)
  const best = Math.min(...ok.map(score))
  let total = 0
  for (const r of ok) {
    r.deltaAic = score(r) - best
    r.weight = Math.exp(-r.deltaAic / 2)
    total += r.weight
  }
  for (const r of ok) r.weight /= total
  return [...ok.sort((a, b) => a.deltaAic - b.deltaAic), ...rows.filter((r) => !r.fit)]
}
