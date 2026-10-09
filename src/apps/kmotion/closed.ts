// Closed forms and measurements shared by several scenes (pure): the linear oscillator with damping and a drive,
// and the steady-state response measured on a simulated, driven system.

import { Ode2, type Method, type System2 } from './integrators.ts'

/**
 * Solution of x'' + c x' + w2 x = A cos(Om t) with x(0) = x0, x'(0) = v0 (w2 = k/m, c = b/m, A = F0/m):
 * every damping regime (under, critical, over), with a transient and a steady part.
 */
export function linearOscillator(w2: number, c: number, A: number, Om: number, x0: number, v0: number, t: number): { x: number; v: number } {
  // particular (steady) solution
  const D = (w2 - Om * Om) ** 2 + (c * Om) ** 2
  let xp: number, vp: number, xp0: number, vp0: number
  if (A === 0) {
    xp = vp = xp0 = vp0 = 0
  } else if (D < 1e-14) {
    // undamped resonance: the amplitude grows linearly
    xp = (A * t * Math.sin(Om * t)) / (2 * Om)
    vp = (A * (Math.sin(Om * t) + Om * t * Math.cos(Om * t))) / (2 * Om)
    xp0 = 0
    vp0 = 0
  } else {
    const P = (A * (w2 - Om * Om)) / D
    const Q = (A * c * Om) / D
    xp = P * Math.cos(Om * t) + Q * Math.sin(Om * t)
    vp = Om * (-P * Math.sin(Om * t) + Q * Math.cos(Om * t))
    xp0 = P
    vp0 = Om * Q
  }
  const h0 = x0 - xp0
  const hv0 = v0 - vp0
  const al = c / 2
  const disc = w2 - al * al
  let xh: number, vh: number
  if (Math.abs(disc) < 1e-10 * Math.max(1, w2)) {
    const C2 = hv0 + al * h0
    const e = Math.exp(-al * t)
    xh = (h0 + C2 * t) * e
    vh = (C2 - al * (h0 + C2 * t)) * e
  } else if (disc > 0) {
    const wd = Math.sqrt(disc)
    const C2 = (hv0 + al * h0) / wd
    const e = Math.exp(-al * t)
    const cs = Math.cos(wd * t)
    const sn = Math.sin(wd * t)
    xh = e * (h0 * cs + C2 * sn)
    vh = e * (-al * (h0 * cs + C2 * sn) + wd * (-h0 * sn + C2 * cs))
  } else {
    const s = Math.sqrt(-disc)
    const rp = -al + s
    const rm = -al - s
    const A1 = (hv0 - rm * h0) / (rp - rm)
    const A2 = h0 - A1
    xh = A1 * Math.exp(rp * t) + A2 * Math.exp(rm * t)
    vh = A1 * rp * Math.exp(rp * t) + A2 * rm * Math.exp(rm * t)
  }
  return { x: xh + xp, v: vh + vp }
}

/** Damping regime of x'' + c x' + w2 x = 0. */
export function dampingRegime(w2: number, c: number): 'undamped' | 'under' | 'critical' | 'over' {
  if (c <= 1e-12) return 'undamped'
  const zeta = c / (2 * Math.sqrt(w2))
  if (Math.abs(zeta - 1) < 1e-6) return 'critical'
  return zeta < 1 ? 'under' : 'over'
}

/** Steady-state amplitude and phase lag of the linear driven oscillator. */
export function steadyResponse(w2: number, c: number, A: number, Om: number): { amp: number; phase: number } {
  const D = Math.sqrt((w2 - Om * Om) ** 2 + (c * Om) ** 2)
  return { amp: D > 0 ? Math.abs(A) / D : Infinity, phase: Math.atan2(c * Om, w2 - Om * Om) }
}

export interface Measured {
  amp: number
  /** x ~ amp cos(Om t - phase). */
  phase: number
  yEnd: Float64Array
  tEnd: number
}

/**
 * Drives a one-coordinate system at frequency Om, lets `settle` periods pass and then measures the fundamental
 * (amplitude and phase) over `measure` periods. `y0` is the starting state [x, v] (the previous point of a sweep).
 */
export function measureDriven(sys: System2, Om: number, y0: ArrayLike<number>, t0: number, settle: number, measure: number, method: Method = 'rk4', stepsPerPeriod = 200): Measured {
  const T = (2 * Math.PI) / Om
  const dt = T / stepsPerPeriod
  const o = new Ode2(sys, y0, method)
  o.t = t0
  for (let i = 0; i < settle * stepsPerPeriod; i++) o.advance(dt)
  let a = 0
  let b = 0
  const n = measure * stepsPerPeriod
  for (let i = 0; i < n; i++) {
    const t = o.t
    const x = o.y[0]
    a += x * Math.cos(Om * t)
    b += x * Math.sin(Om * t)
    o.advance(dt)
  }
  a *= 2 / n
  b *= 2 / n
  return { amp: Math.hypot(a, b), phase: Math.atan2(b, a), yEnd: Float64Array.from(o.y), tEnd: o.t }
}

/** Real symmetric eigenproblem by cyclic Jacobi rotations: eigenvalues (ascending) and the matching unit eigenvectors. */
export function eigenSym(M: number[][]): { values: number[]; vectors: number[][] } {
  const n = M.length
  const A = M.map((r) => r.slice())
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]
    if (off < 1e-30) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p]
          const vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i][i] - A[j][j])
  return {
    values: order.map((i) => A[i][i]),
    vectors: order.map((i) => {
      const v = V.map((row) => row[i])
      // sign convention: the largest component is positive
      let big = 0
      for (const x of v) if (Math.abs(x) > Math.abs(big)) big = x
      return v.map((x) => (big < 0 ? -x : x))
    }),
  }
}
