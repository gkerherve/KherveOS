// Nonlinear least-squares fit of the full titration model (pure): the pH curve of a (poly)protic acid or base
// titrated with a strong base or acid, computed from the exact charge balance with dilution, is fitted to
// measured V/pH data by Levenberg–Marquardt. Free parameters: the analyte concentration, the pKa values (any can
// be fixed), optionally the titrant concentration and a volume offset. Standard errors come from the covariance
// matrix s²(JᵀWJ)⁻¹.

import { prepare, equivalencePoints, type AcidBaseSpec } from './acidbase.ts'
import { detectEquivalence, midpointSlopes, type TitrationData } from './analyse.ts'
import type { ActivityModel } from './equilibria.ts'

export interface FitSetup {
  /** Number of pKa steps of the analyte (1–4). */
  npk: number
  /** Charge of the fully protonated form, and which form was weighed in (0 = fully protonated). */
  z0: number
  form: number
  titrant: 'base' | 'acid'
  /** Volume of the sample taken (mL) and the total volume of the flask before titrating (sample + water, mL). */
  aliquot: number
  V0: number
  /** Concentration of the titrant (mol/L). */
  Ct: number
  temperature: number
  activity: ActivityModel
  background: number
  /** Also fit the titrant concentration / a burette volume offset. */
  fitCt: boolean
  fitDV: boolean
  /** Starting values: the analyte concentration and the pKa list (null = take them from the data). */
  guessC: number | null
  pKa: Array<{ value: number; fit: boolean }>
  /** Uncertainty of the volume reading (mL): >0 weights points where the curve is steep less (effective variance). */
  sigmaV: number
}

export const DEFAULT_FIT_SETUP: FitSetup = {
  npk: 1, z0: 0, form: 0, titrant: 'base', aliquot: 25, V0: 25, Ct: 0.1, temperature: 25, activity: 'none', background: 0,
  fitCt: false, fitDV: false, guessC: null, pKa: [{ value: 5, fit: true }], sigmaV: 0,
}

/** The analyte kinds offered in the window: how z0 and form follow from them. */
export const ANALYTE_KINDS = [
  { id: 'acid', label: 'Acid HₙA, titrated with base', titrant: 'base' as const, z0: (n: number) => (void n, 0), form: (n: number) => (void n, 0) },
  { id: 'base', label: 'Base B (neutral), titrated with acid', titrant: 'acid' as const, z0: (n: number) => n, form: (n: number) => n },
  { id: 'anion', label: 'Anion salt (Na₂CO₃, Na₃PO₄), titrated with acid', titrant: 'acid' as const, z0: (n: number) => (void n, 0), form: (n: number) => n },
  { id: 'cation', label: 'Cationic acid (NH₄Cl), titrated with base', titrant: 'base' as const, z0: (n: number) => (void n, 1), form: (n: number) => (void n, 0) },
  { id: 'aminoacid', label: 'Amino acid hydrochloride (H₂A⁺), titrated with base', titrant: 'base' as const, z0: (n: number) => (void n, 1), form: (n: number) => (void n, 0) },
] as const

/** Setup values for an analyte kind and number of steps. */
export function setupForKind(kindId: string, npk: number, prev: FitSetup = DEFAULT_FIT_SETUP): FitSetup {
  const k = ANALYTE_KINDS.find((x) => x.id === kindId) ?? ANALYTE_KINDS[0]
  const pKa = Array.from({ length: npk }, (_, i) => prev.pKa[i] ?? { value: [3, 7, 11, 13][i] ?? 7, fit: true })
  return { ...prev, npk, z0: k.z0(npk), form: Math.min(k.form(npk), npk), titrant: k.titrant, pKa }
}

/** The titration model for the setup and parameters (Ca, pKa list, Ct). */
export function modelSpec(s: FitSetup, Ca: number, pKa: number[], Ct: number): AcidBaseSpec {
  return {
    items: [{ kind: 'weak', label: 'Analyte', pKa, z0: s.z0, form: s.form, conc: Math.abs(Ca), volume: s.aliquot }],
    water: Math.max(0, s.V0 - s.aliquot),
    titrant: { kind: s.titrant === 'base' ? 'strong-base' : 'strong-acid', label: s.titrant === 'base' ? 'Base' : 'Acid', conc: Math.abs(Ct) },
    temperature: s.temperature, activity: s.activity, background: s.background, vmax: null, indicator: null,
  }
}

export interface FitParam {
  name: string
  value: number
  /** Standard error (NaN when it cannot be estimated). */
  se: number
  /** 95 % confidence interval half-width. */
  ci95: number
  fixed: boolean
}

export interface FitResult {
  ok: boolean
  message: string
  params: FitParam[]
  /** Fitted values of the parameters, in the structure of the model. */
  Ca: number
  pKa: number[]
  Ct: number
  dV: number
  /** Temperature used (°C): the mean of the data's temperature column, else the set-up's. */
  temperature: number
  fitted: number[]
  residuals: number[]
  rmse: number
  r2: number
  dof: number
  iterations: number
  converged: boolean
  /** Equivalence volumes of the fitted model (mL). */
  eq: number[]
  /** Correlation between the free parameters. */
  correlation: number[][]
}

// ---------------------------------------------------------------------------------------------- linear algebra and LM

function invert(A: number[][]): number[][] | null {
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

type Model = (p: number[]) => number[]

function jacobian(model: Model, p: number[]): number[][] {
  const cols = p.map((v, j) => {
    const h = 1e-6 * Math.max(Math.abs(v), 1e-3)
    const a = p.slice()
    const b = p.slice()
    a[j] = v + h
    b[j] = v - h
    const fa = model(a)
    const fb = model(b)
    return fa.map((x, i) => (x - fb[i]) / (2 * h))
  })
  return cols[0].map((_, i) => cols.map((c) => c[i])) // rows = data, columns = parameters
}

export interface LmOutput {
  p: number[]
  sse: number
  iterations: number
  converged: boolean
  J: number[][]
}

/** Levenberg–Marquardt on weighted residuals w_i (y_i − f_i(p))². */
export function levenbergMarquardt(model: Model, y: number[], w: number[], p0: number[], maxIter = 200): LmOutput {
  const sumSq = (p: number[]) => {
    const f = model(p)
    let s = 0
    for (let i = 0; i < y.length; i++) s += w[i] * (y[i] - f[i]) ** 2
    return Number.isFinite(s) ? s : Infinity
  }
  let p = p0.slice()
  let sse = sumSq(p)
  if (!Number.isFinite(sse)) return { p, sse, iterations: 0, converged: false, J: [] }
  let lambda = 1e-3
  let converged = false
  let it = 0
  for (; it < maxIter; it++) {
    const f = model(p)
    const J = jacobian(model, p)
    const m = p.length
    const JtJ = Array.from({ length: m }, () => new Array<number>(m).fill(0))
    const Jtr = new Array<number>(m).fill(0)
    for (let i = 0; i < y.length; i++) {
      const r = y[i] - f[i]
      for (let a = 0; a < m; a++) {
        Jtr[a] += w[i] * J[i][a] * r
        for (let b = 0; b <= a; b++) JtJ[a][b] += w[i] * J[i][a] * J[i][b]
      }
    }
    for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) JtJ[a][b] = JtJ[b][a]
    let accepted = false
    while (lambda < 1e14) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)))
      const inv = invert(A)
      if (inv) {
        const delta = inv.map((row) => row.reduce((s, v, j) => s + v * Jtr[j], 0))
        const pn = p.map((v, j) => v + delta[j])
        const sn = sumSq(pn)
        if (Number.isFinite(sn) && sn <= sse) {
          const rel = sse > 0 ? (sse - sn) / sse : 0
          const step = Math.max(...delta.map((d, j) => Math.abs(d) / (Math.abs(p[j]) + 1e-9)))
          p = pn
          sse = sn
          lambda = Math.max(lambda / 10, 1e-12)
          accepted = true
          if (rel < 1e-13 || step < 1e-9) converged = true
          break
        }
      }
      lambda *= 10
    }
    if (!accepted) { converged = true; break }
    if (converged) break
  }
  return { p, sse, iterations: it, converged, J: jacobian(model, p) }
}

/** Two-sided 95 % Student-t quantile (accurate to ~1e-3 for df ≥ 1). */
export function t95(df: number): number {
  if (df < 1) return NaN
  const table: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228 }
  if (table[df]) return table[df]
  const z = 1.959964
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df)
}

// ---------------------------------------------------------------------------------------------- the fit

/** Starting values from the data: the concentration from the first equivalence point and pKa values from the half-equivalence pH. */
export function guessParameters(d: TitrationData, s: FitSetup): { Ca: number; pKa: number[] } {
  const eq = detectEquivalence(d)
  const titratedSteps = s.titrant === 'base' ? Array.from({ length: s.npk - s.form }, (_, i) => s.form + i) : Array.from({ length: s.form }, (_, i) => s.form - 1 - i)
  const pKa = s.pKa.map((p) => p.value)
  let Ca = s.guessC ?? 0
  if (eq.length) {
    if (!s.guessC) Ca = (s.Ct * eq[0].V) / s.aliquot
    // half-equivalence pH for each detected step
    let prev = 0
    eq.forEach((e, k) => {
      const step = titratedSteps[k]
      if (step !== undefined && s.pKa[step]?.fit) {
        const half = prev + (e.V - prev) / 2
        let pH = d.pH[0]
        for (let i = 1; i < d.V.length; i++) if (d.V[i] >= half) { pH = d.pH[i - 1] + ((d.pH[i] - d.pH[i - 1]) * (half - d.V[i - 1])) / (d.V[i] - d.V[i - 1]); break }
        pKa[step] = Math.round(pH * 100) / 100
      }
      prev = e.V
    })
  }
  if (!(Ca > 0)) Ca = 0.05
  return { Ca, pKa }
}

/** The set-up with the temperature of the data when the file has a temperature column (its mean). */
export function effectiveSetup(d: TitrationData, s: FitSetup): FitSetup {
  const t = d.T?.filter((x) => Number.isFinite(x))
  return t && t.length ? { ...s, temperature: Math.max(0, Math.min(100, t.reduce((a, b) => a + b, 0) / t.length)) } : s
}

function fitTitrationUnsafe(d: TitrationData, s0: FitSetup): FitResult {
  const s = effectiveSetup(d, s0)
  const fail = (message: string): FitResult => ({
    ok: false, message, params: [], Ca: NaN, pKa: [], Ct: s.Ct, dV: 0, temperature: s.temperature, fitted: [], residuals: [], rmse: NaN, r2: NaN, dof: 0, iterations: 0, converged: false, eq: [], correlation: [],
  })
  if (d.V.length < 5) return fail('At least 5 points are needed.')
  if (!(s.aliquot > 0) || !(s.V0 >= s.aliquot) || !(s.Ct > 0)) return fail('Give the sample volume, the total flask volume (≥ sample) and the titrant concentration.')
  if (s.pKa.length !== s.npk) return fail('The number of pKa values does not match the number of steps.')
  const guess = guessParameters(d, s)
  // parameter vector: Ca, free pKa…, [Ct], [dV]
  const names: string[] = ['Ca']
  const start: number[] = [guess.Ca]
  const freeIdx: number[] = []
  s.pKa.forEach((p, i) => {
    if (p.fit) {
      freeIdx.push(i)
      names.push(`pKa${s.npk > 1 ? i + 1 : ''}`)
      start.push(guess.pKa[i])
    }
  })
  if (s.fitCt) { names.push('Ct'); start.push(s.Ct) }
  if (s.fitDV) { names.push('ΔV'); start.push(0) }
  const unpack = (p: number[]) => {
    const pKa = s.pKa.map((x) => x.value)
    let k = 1
    for (const i of freeIdx) pKa[i] = p[k++]
    const Ct = s.fitCt ? Math.abs(p[k++]) : s.Ct
    const dV = s.fitDV ? p[k++] : 0
    return { Ca: Math.abs(p[0]), pKa, Ct, dV }
  }
  const model: Model = (p) => {
    const u = unpack(p)
    const pr = prepare(modelSpec(s, u.Ca, u.pKa, u.Ct))
    return d.V.map((v) => pr.ph(Math.max(0, v - u.dV)))
  }
  // weights: equal in pH, or effective variance with the slope of the data
  let w = d.V.map(() => 1)
  if (s.sigmaV > 0) {
    const { x, d: dm } = midpointSlopes(d.V, d.pH)
    w = d.V.map((v) => {
      let best = 0
      let bd = Infinity
      x.forEach((xx, i) => { if (Math.abs(xx - v) < bd) { bd = Math.abs(xx - v); best = i } })
      const slope = dm[best] ?? 0
      return 1 / (0.01 ** 2 + (slope * s.sigmaV) ** 2)
    })
    const mean = w.reduce((a, b) => a + b, 0) / w.length
    w = w.map((x) => x / mean)
  }
  let lm: LmOutput
  try {
    lm = levenbergMarquardt(model, d.pH, w, start)
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  if (!Number.isFinite(lm.sse)) return fail('The model could not be evaluated at the starting values: check the analyte type and the volumes.')
  const u = unpack(lm.p)
  const fitted = model(lm.p)
  const residuals = d.pH.map((y, i) => y - fitted[i])
  const n = d.V.length
  const m = lm.p.length
  const dof = Math.max(n - m, 1)
  const wsse = lm.sse
  const s2 = wsse / dof
  const JtJ = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => lm.J.reduce((sum, row, i) => sum + w[i] * row[a] * row[b], 0)))
  const cov = invert(JtJ)
  const se = lm.p.map((_, j) => (cov ? Math.sqrt(Math.max(cov[j][j] * s2, 0)) : NaN))
  const t = t95(dof)
  const params: FitParam[] = names.map((name, j) => ({ name, value: name === 'Ca' ? u.Ca : name === 'Ct' ? u.Ct : lm.p[j], se: se[j], ci95: se[j] * t, fixed: false }))
  const fixed: FitParam[] = s.pKa.flatMap((p, i) => (p.fit ? [] : [{ name: `pKa${s.npk > 1 ? i + 1 : ''}`, value: p.value, se: 0, ci95: 0, fixed: true }]))
  const mean = d.pH.reduce((a, b) => a + b, 0) / n
  const sst = d.pH.reduce((a, y) => a + (y - mean) ** 2, 0)
  const sse = residuals.reduce((a, r) => a + r * r, 0)
  const eq = equivalencePoints(modelSpec(s, u.Ca, u.pKa, u.Ct)).map((e) => e.V + u.dV)
  const correlation = cov ? cov.map((row, a) => row.map((v, b) => v / Math.sqrt(cov[a][a] * cov[b][b]))) : []
  return {
    ok: true, message: lm.converged ? 'Converged.' : 'Stopped before converging: try other starting values.', params: [...params, ...fixed],
    Ca: u.Ca, pKa: u.pKa, Ct: u.Ct, dV: u.dV, temperature: s.temperature, fitted, residuals, rmse: Math.sqrt(sse / dof), r2: sst > 0 ? 1 - sse / sst : 1, dof,
    iterations: lm.iterations, converged: lm.converged, eq, correlation,
  }
}

/** Fits the model; `ok: false` with a message instead of an exception when the data or the set-up make no sense. */
export function fitTitration(d: TitrationData, s: FitSetup): FitResult {
  try {
    return fitTitrationUnsafe(d, s)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return {
      ok: false, message: /bracketed/i.test(m) ? 'The model could not be evaluated for these values: check the analyte type, the volumes and the pKa starting values.' : m, params: [], Ca: NaN, pKa: [], Ct: s.Ct, dV: 0, temperature: s.temperature,
      fitted: [], residuals: [], rmse: NaN, r2: NaN, dof: 0, iterations: 0, converged: false, eq: [], correlation: [],
    }
  }
}
