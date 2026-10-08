// Ordinary differential equations for the kinetics simulator: classical RK4, the adaptive Dormand–Prince
// pair (RK45) and a stiff-capable solver (implicit Euler with Richardson extrapolation and Newton iterations
// on the Jacobian). `method: 'auto'` starts with RK45 and switches to the stiff solver when the system turns
// out to be stiff. Pure functions.

export interface OdeSystem {
  n: number
  /** dy/dt → out */
  f(t: number, y: Float64Array | number[], out: Float64Array | number[]): void
  /** Jacobian ∂f/∂y → J[i][j]; finite differences are used when absent. */
  jac?(t: number, y: Float64Array | number[], J: number[][]): void
}

export type OdeMethod = 'auto' | 'rk4' | 'rk45' | 'stiff'

export interface SolveOptions {
  /** Times to report, increasing, the first one is the start time. */
  times: number[]
  method?: OdeMethod
  rtol?: number
  atol?: number
  /** Steps per output interval for rk4. */
  rk4Steps?: number
  maxSteps?: number
}

export interface Solution {
  t: number[]
  /** y[k][i]: component i at times[k]. */
  y: number[][]
  /** The method that produced the result. */
  method: Exclude<OdeMethod, 'auto'>
  steps: number
  rejected: number
  ok: boolean
  message?: string
}

// ------------------------------------------------------------------ dense linear algebra (small systems)

/** Solves A x = b in place by Gaussian elimination with partial pivoting; false when singular. */
export function solveLinear(A: number[][], b: number[]): boolean {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-300) return false
    if (p !== c) {
      ;[A[p], A[c]] = [A[c], A[p]]
      ;[b[p], b[c]] = [b[c], b[p]]
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * b[k]
    b[r] = s / A[r][r]
  }
  return true
}

function numericJacobian(sys: OdeSystem, t: number, y: ArrayLike<number>, J: number[][]): void {
  const n = sys.n
  const f0 = new Float64Array(n)
  const f1 = new Float64Array(n)
  const yy = Float64Array.from(y)
  sys.f(t, yy, f0)
  for (let j = 0; j < n; j++) {
    const h = 1e-7 * Math.max(Math.abs(yy[j]), 1e-6)
    const save = yy[j]
    yy[j] = save + h
    sys.f(t, yy, f1)
    yy[j] = save
    for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / h
  }
}

const zeros = (n: number) => new Float64Array(n)

// ------------------------------------------------------------------ RK4

function rk4Step(sys: OdeSystem, t: number, y: Float64Array, h: number): Float64Array {
  const n = sys.n
  const k1 = zeros(n), k2 = zeros(n), k3 = zeros(n), k4 = zeros(n)
  const tmp = zeros(n)
  sys.f(t, y, k1)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i]
  sys.f(t + 0.5 * h, tmp, k2)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i]
  sys.f(t + 0.5 * h, tmp, k3)
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i]
  sys.f(t + h, tmp, k4)
  const out = zeros(n)
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  return out
}

// ------------------------------------------------------------------ Dormand–Prince RK45

const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]
const DP_A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
]
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]

function wrms(err: Float64Array, y0: Float64Array, y1: Float64Array, rtol: number, atol: number): number {
  let s = 0
  for (let i = 0; i < err.length; i++) {
    const sc = atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(y1[i]))
    s += (err[i] / sc) ** 2
  }
  return Math.sqrt(s / err.length)
}

interface StepState {
  h: number
  steps: number
  rejected: number
}

/** Integrates from t0 to t1 with RK45; returns null when the step budget is exhausted (stiffness). */
function integrateRk45(sys: OdeSystem, y: Float64Array, t0: number, t1: number, st: StepState, rtol: number, atol: number, budget: number): Float64Array | null {
  const n = sys.n
  const k: Float64Array[] = Array.from({ length: 7 }, () => zeros(n))
  const tmp = zeros(n)
  let t = t0
  let h = Math.min(st.h || (t1 - t0) / 100, t1 - t0)
  sys.f(t, y, k[0])
  while (t1 - t > 1e-13 * Math.max(1, Math.abs(t1))) {
    if (st.steps >= budget) return null
    if (t + h > t1) h = t1 - t
    for (let s = 1; s < 7; s++) {
      for (let i = 0; i < n; i++) {
        let acc = y[i]
        for (let j = 0; j < s; j++) acc += h * DP_A[s][j] * k[j][i]
        tmp[i] = acc
      }
      sys.f(t + DP_C[s] * h, tmp, k[s])
    }
    // tmp is now the 5th-order solution (stage 7 uses the same weights)
    const err = zeros(n)
    for (let i = 0; i < n; i++) {
      let e = 0
      for (let s = 0; s < 7; s++) e += DP_E[s] * k[s][i]
      err[i] = h * e
    }
    const en = wrms(err, y, tmp, rtol, atol)
    if (!Number.isFinite(en)) return null
    if (en <= 1) {
      t += h
      y.set(tmp)
      k[0].set(k[6])
      st.steps++
    } else st.rejected++
    const fac = Math.min(5, Math.max(0.2, 0.9 * Math.pow(en || 1e-10, -0.2)))
    h *= fac
    st.h = h
    if (h < 1e-14 * Math.max(1, Math.abs(t))) return null
  }
  return y
}

// ------------------------------------------------------------------ implicit Euler + extrapolation (stiff)

function implicitEuler(sys: OdeSystem, t: number, y: Float64Array, h: number, J: number[][], out: Float64Array): boolean {
  const n = sys.n
  const z = Float64Array.from(y)
  const fz = zeros(n)
  for (let it = 0; it < 12; it++) {
    sys.f(t + h, z, fz)
    const rhs = new Array<number>(n)
    for (let i = 0; i < n; i++) rhs[i] = -(z[i] - y[i] - h * fz[i])
    const M: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - h * J[i][j]))
    if (!solveLinear(M, rhs)) return false
    let dn = 0
    let zn = 0
    for (let i = 0; i < n; i++) {
      z[i] += rhs[i]
      dn = Math.max(dn, Math.abs(rhs[i]))
      zn = Math.max(zn, Math.abs(z[i]))
    }
    if (!Number.isFinite(dn)) return false
    if (dn <= 1e-13 + 1e-11 * zn) {
      out.set(z)
      return true
    }
  }
  out.set(z)
  return true
}

function integrateStiff(sys: OdeSystem, y: Float64Array, t0: number, t1: number, st: StepState, rtol: number, atol: number, budget: number): Float64Array | null {
  const n = sys.n
  const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  let t = t0
  let h = Math.min(st.h || (t1 - t0) / 1000, t1 - t0)
  const full = zeros(n), half = zeros(n), two = zeros(n)
  while (t1 - t > 1e-13 * Math.max(1, Math.abs(t1))) {
    if (st.steps >= budget) return null
    if (t + h > t1) h = t1 - t
    if (sys.jac) sys.jac(t, y, J)
    else numericJacobian(sys, t, y, J)
    const ok1 = implicitEuler(sys, t, y, h, J, full)
    const ok2 = ok1 && implicitEuler(sys, t, y, h / 2, J, half) && implicitEuler(sys, t + h / 2, half, h / 2, J, two)
    if (!ok1 || !ok2) {
      h /= 4
      st.rejected++
      if (h < 1e-300) return null
      continue
    }
    const err = zeros(n)
    for (let i = 0; i < n; i++) err[i] = two[i] - full[i]
    const en = wrms(err, y, two, rtol, atol)
    if (en <= 1 || h < 1e-12 * Math.max(1, t1)) {
      t += h
      for (let i = 0; i < n; i++) y[i] = 2 * two[i] - full[i] // Richardson: second order
      st.steps++
    } else st.rejected++
    const fac = Math.min(4, Math.max(0.2, 0.9 * Math.pow(en || 1e-10, -1 / 3)))
    h *= fac
    st.h = h
  }
  return y
}

// ------------------------------------------------------------------ driver

/** Solves dy/dt = f(t, y) from y0 and reports the state at each of `times`. */
export function solveOde(sys: OdeSystem, y0: ArrayLike<number>, opts: SolveOptions): Solution {
  const times = opts.times
  const rtol = opts.rtol ?? 1e-8
  const atol = opts.atol ?? 1e-12
  const maxSteps = opts.maxSteps ?? 400_000
  const result = (method: Exclude<OdeMethod, 'auto'>, ys: number[][], st: StepState, ok: boolean, message?: string): Solution => ({
    t: times.slice(0, ys.length), y: ys, method, steps: st.steps, rejected: st.rejected, ok, message,
  })

  const run = (method: Exclude<OdeMethod, 'auto'>, budget: number): Solution | null => {
    const y = Float64Array.from(y0)
    const st: StepState = { h: 0, steps: 0, rejected: 0 }
    const ys: number[][] = [Array.from(y)]
    for (let k = 1; k < times.length; k++) {
      const a = times[k - 1], b = times[k]
      if (b <= a) {
        ys.push(Array.from(y))
        continue
      }
      let ok: Float64Array | null
      if (method === 'rk4') {
        const m = opts.rk4Steps ?? 20
        const h = (b - a) / m
        let tt = a
        for (let s = 0; s < m; s++) {
          y.set(rk4Step(sys, tt, y, h))
          tt += h
        }
        st.steps += m
        ok = y
      } else if (method === 'rk45') ok = integrateRk45(sys, y, a, b, st, rtol, atol, budget)
      else ok = integrateStiff(sys, y, a, b, st, Math.max(rtol, 1e-6), atol, budget)
      if (!ok) return null
      ys.push(Array.from(y))
    }
    return result(method, ys, st, true)
  }

  const method = opts.method ?? 'auto'
  if (method === 'auto') {
    const first = run('rk45', Math.min(maxSteps, 30_000))
    if (first) return first
    const second = run('stiff', maxSteps)
    if (second) return second
    return { t: [times[0]], y: [Array.from(y0)], method: 'stiff', steps: 0, rejected: 0, ok: false, message: 'The solver could not finish: the system is too stiff or the values blew up.' }
  }
  const r = run(method, maxSteps)
  if (r) return r
  return { t: [times[0]], y: [Array.from(y0)], method, steps: 0, rejected: 0, ok: false, message: `${method.toUpperCase()} did not finish (try the stiff solver or Auto).` }
}
