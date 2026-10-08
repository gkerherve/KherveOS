// Fitting for the kinetics tools: straight-line regression with standard errors, the order of a reaction from
// concentration–time data (integrated rate laws for zero, first and second order), and Arrhenius / Eyring
// analysis of rate constants against temperature. Pure functions.

import { H_PLANCK as H, KB, R_J } from './constants.ts'

export interface LineFit {
  slope: number
  intercept: number
  seSlope: number
  seIntercept: number
  r2: number
  n: number
  /** Residual standard deviation. */
  s: number
}

/** Ordinary least squares of y on x. */
export function linreg(x: number[], y: number[]): LineFit {
  const n = x.length
  if (n < 2) return { slope: NaN, intercept: NaN, seSlope: NaN, seIntercept: NaN, r2: NaN, n, s: NaN }
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2
    sxy += (x[i] - mx) * (y[i] - my)
    syy += (y[i] - my) ** 2
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let sse = 0
  for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * x[i])) ** 2
  const dof = n - 2
  const s = dof > 0 ? Math.sqrt(sse / dof) : NaN
  const seSlope = s / Math.sqrt(sxx)
  const seIntercept = s * Math.sqrt(1 / n + (mx * mx) / sxx)
  const r2 = syy === 0 ? 1 : 1 - sse / syy
  return { slope, intercept, seSlope, seIntercept, r2, n, s }
}

// ------------------------------------------------------------------ pasted data

export interface Table {
  x: number[]
  y: number[]
  /** Lines that were skipped. */
  skipped: number
}

/** Two numbers per line (space, tab, comma or semicolon separated); header lines and blanks are skipped. */
export function parseTable(text: string): Table {
  const x: number[] = []
  const y: number[] = []
  let skipped = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    const parts = line.split(/[\s;,\t]+/).filter(Boolean).map((p) => p.replace(',', '.'))
    const a = Number(parts[0])
    const b = Number(parts[1])
    if (parts.length >= 2 && Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a)
      y.push(b)
    } else skipped++
  }
  return { x, y, skipped }
}

// ------------------------------------------------------------------ reaction order

export interface OrderFit {
  order: 0 | 1 | 2
  /** Linearised data: c, ln c or 1/c. */
  yLabel: string
  fit: LineFit
  /** Rate constant (units depend on the order) and its standard error. */
  k: number
  kSE: number
  /** Initial concentration from the intercept, and the half-life from it. */
  c0: number
  halfLife: number
  /** Root-mean-square error in concentration of the back-transformed line. */
  rmse: number
  /** false when the transform does not exist (c ≤ 0). */
  valid: boolean
  yData: number[]
}

export interface OrderResult {
  fits: OrderFit[]
  best: OrderFit | null
  /** True when the two best fits are nearly equally good. */
  ambiguous: boolean
  message: string
}

const ORDER_UNITS = ['mol L⁻¹ s⁻¹', 's⁻¹', 'L mol⁻¹ s⁻¹']
export const orderUnit = (order: number) => ORDER_UNITS[order] ?? ''

/** Fits zero, first and second order to c(t) and chooses by R² of the linearised plot. */
export function fitOrder(t: number[], c: number[]): OrderResult {
  const fits: OrderFit[] = []
  for (const order of [0, 1, 2] as const) {
    const keep = c.map((_, i) => i).filter((i) => (order === 0 ? true : c[i] > 0))
    const valid = keep.length >= 3 && keep.length === c.length
    const xs = keep.map((i) => t[i])
    const ys = keep.map((i) => (order === 0 ? c[i] : order === 1 ? Math.log(c[i]) : 1 / c[i]))
    const fit = linreg(xs, ys)
    const k = order === 2 ? fit.slope : -fit.slope
    const c0 = order === 0 ? fit.intercept : order === 1 ? Math.exp(fit.intercept) : 1 / fit.intercept
    const halfLife = order === 0 ? c0 / (2 * k) : order === 1 ? Math.LN2 / k : 1 / (k * c0)
    // error in concentration of the fitted model
    let sse = 0
    for (let i = 0; i < t.length; i++) {
      const lin = fit.intercept + fit.slope * t[i]
      const model = order === 0 ? lin : order === 1 ? Math.exp(lin) : 1 / lin
      sse += (c[i] - model) ** 2
    }
    fits.push({ order, yLabel: order === 0 ? '[A]' : order === 1 ? 'ln [A]' : '1/[A]', fit, k, kSE: fit.seSlope, c0, halfLife, rmse: Math.sqrt(sse / t.length), valid, yData: ys })
  }
  const usable = fits.filter((f) => f.valid && Number.isFinite(f.fit.r2) && f.k > 0)
  if (t.length < 3) return { fits, best: null, ambiguous: false, message: 'At least three (t, concentration) points are needed.' }
  if (usable.length === 0) return { fits, best: null, ambiguous: false, message: 'No order gives a decaying straight line: check that the concentration falls with time.' }
  usable.sort((a, b) => b.fit.r2 - a.fit.r2)
  const best = usable[0]
  const second = usable[1]
  const ambiguous = !!second && best.fit.r2 - second.fit.r2 < 0.002
  const names = ['zero', 'first', 'second']
  const message = ambiguous
    ? `${names[best.order]} order fits best (R² = ${best.fit.r2.toFixed(4)}), but ${names[second.order]} order is almost as good (R² = ${second.fit.r2.toFixed(4)}): the data do not decide. Follow the reaction further (to more than one half-life) or vary the initial concentration.`
    : `${names[best.order][0].toUpperCase()}${names[best.order].slice(1)} order: R² = ${best.fit.r2.toFixed(4)}.`
  return { fits, best, ambiguous, message }
}

// ------------------------------------------------------------------ Arrhenius and Eyring

export interface ArrheniusResult {
  fit: LineFit
  /** Activation energy in kJ/mol and its standard error. */
  Ea: number
  EaSE: number
  /** Pre-exponential factor (units of k) and its one-standard-error range. */
  A: number
  ASE: number
  lnA: number
  lnASE: number
  /** k predicted at 298.15 K. */
  k298: number
  x: number[]
  y: number[]
}

/** ln k = ln A − Ea/(R T): the slope of ln k against 1/T is −Ea/R. */
export function arrhenius(T: number[], k: number[]): ArrheniusResult {
  const x = T.map((v) => 1 / v)
  const y = k.map((v) => Math.log(v))
  const fit = linreg(x, y)
  const Ea = (-fit.slope * R_J) / 1000
  const lnA = fit.intercept
  const A = Math.exp(lnA)
  return {
    fit, Ea, EaSE: (fit.seSlope * R_J) / 1000, A, ASE: A * fit.seIntercept, lnA, lnASE: fit.seIntercept,
    k298: Math.exp(fit.intercept + fit.slope / 298.15), x, y,
  }
}

export interface EyringResult {
  fit: LineFit
  /** Enthalpy of activation, kJ/mol. */
  dH: number
  dHSE: number
  /** Entropy of activation, J/(mol K). */
  dS: number
  dSSE: number
  /** Free energy of activation at 298.15 K, kJ/mol. */
  dG298: number
}

/** ln(k/T) = −ΔH‡/(R T) + ln(kB/h) + ΔS‡/R. */
export function eyring(T: number[], k: number[]): EyringResult {
  const x = T.map((v) => 1 / v)
  const y = k.map((v, i) => Math.log(v / T[i]))
  const fit = linreg(x, y)
  const dH = (-fit.slope * R_J) / 1000
  const dS = (fit.intercept - Math.log(KB / H)) * R_J
  return {
    fit, dH, dHSE: (fit.seSlope * R_J) / 1000, dS, dSSE: fit.seIntercept * R_J, dG298: dH - (298.15 * dS) / 1000,
  }
}
