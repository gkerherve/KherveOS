// Numerical integrators of kMotion (pure). A system is written in second-order form, x'' = a(t, x, x'), the way
// mechanics gives it; the state is y = [x_0..x_{n-1}, v_0..v_{n-1}]. Five methods are offered so that their
// differences can be seen (explicit Euler spirals out of a circular orbit, velocity-Verlet does not):
//   euler  explicit Euler            order 1, drifts in energy (grows)
//   semi   semi-implicit (symplectic) Euler, order 1, energy error stays bounded
//   verlet velocity-Verlet           order 2, symplectic for forces that depend on position only
//   rk4    classical Runge-Kutta     order 4
//   rk45   Dormand-Prince, adaptive  order 5(4), step size chosen from a tolerance

export type Method = 'euler' | 'semi' | 'verlet' | 'rk4' | 'rk45'

export interface MethodInfo {
  id: Method
  label: string
  order: number
  symplectic: boolean
  note: string
}

export const METHODS: readonly MethodInfo[] = [
  { id: 'euler', label: 'Explicit Euler', order: 1, symplectic: false, note: 'Simplest; the energy of an oscillation grows steadily. Shown here to see it fail.' },
  { id: 'semi', label: 'Semi-implicit Euler', order: 1, symplectic: true, note: 'Updates the velocity first; the energy error oscillates but does not grow.' },
  { id: 'verlet', label: 'Velocity-Verlet', order: 2, symplectic: true, note: 'The workhorse of molecular dynamics and orbits; excellent long-term energy behaviour.' },
  { id: 'rk4', label: 'Runge-Kutta 4', order: 4, symplectic: false, note: 'Accurate per step; a very slow, steady energy drift over thousands of orbits.' },
  { id: 'rk45', label: 'Dormand-Prince RK45 (adaptive)', order: 5, symplectic: false, note: 'Picks its own step to meet a tolerance; the most accurate here.' },
]

export const METHOD_IDS: Method[] = METHODS.map((m) => m.id)
export const isMethod = (s: unknown): s is Method => typeof s === 'string' && (METHOD_IDS as string[]).includes(s)

export interface System2 {
  /** Number of coordinates (the state has 2n numbers). */
  n: number
  /** Writes the accelerations a[0..n-1] for the state y at time t. */
  acc(t: number, y: ArrayLike<number>, a: Float64Array): void
  /** True when the acceleration depends on the velocity (damping, magnetic-like, Coriolis). */
  vdep?: boolean
}

// Dormand-Prince coefficients
const A21 = 1 / 5
const A31 = 3 / 40, A32 = 9 / 40
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84
const E1 = B1 - 5179 / 57600, E3 = B3 - 7571 / 16695, E4 = B4 - 393 / 640, E5 = B5 + 92097 / 339200, E6 = B6 - 187 / 2100, E7 = -1 / 40

export class Ode2 {
  y: Float64Array
  t = 0
  method: Method
  /** Relative and absolute tolerance of the adaptive method. */
  rtol = 1e-9
  atol = 1e-12
  /** Evaluations of the acceleration so far (a cost measure for the integrator comparison). */
  evals = 0
  /** Steps taken and the last step size of the adaptive method. */
  steps = 0
  hLast = 0
  private readonly sys: System2
  private readonly n: number
  private readonly m: number
  private hNext = 0
  private a0: Float64Array
  private a1: Float64Array
  private aValid = false
  private tmp: Float64Array
  private k: Float64Array[]

  constructor(sys: System2, y0: ArrayLike<number>, method: Method = 'verlet') {
    this.sys = sys
    this.n = sys.n
    this.m = 2 * sys.n
    this.y = Float64Array.from(y0)
    this.method = method
    this.a0 = new Float64Array(this.n)
    this.a1 = new Float64Array(this.n)
    this.tmp = new Float64Array(this.m)
    this.k = Array.from({ length: 7 }, () => new Float64Array(this.m))
  }

  /** Call after changing the state from outside (a collision, a burn): cached accelerations are dropped. */
  invalidate() {
    this.aValid = false
  }

  /** Accelerations at the current state (not cached). */
  accel(out: Float64Array = new Float64Array(this.n)): Float64Array {
    this.sys.acc(this.t, this.y, out)
    this.evals++
    return out
  }

  private f(t: number, y: ArrayLike<number>, dy: Float64Array) {
    const n = this.n
    for (let i = 0; i < n; i++) dy[i] = y[n + i]
    const a = this.a1
    this.sys.acc(t, y, a)
    this.evals++
    for (let i = 0; i < n; i++) dy[n + i] = a[i]
  }

  /** Advances exactly dt (one step of the fixed-step methods; the adaptive one takes as many as it needs). */
  advance(dt: number) {
    if (!(dt > 0)) return
    switch (this.method) {
      case 'euler': this.stepEuler(dt); break
      case 'semi': this.stepSemi(dt); break
      case 'verlet': this.stepVerlet(dt); break
      case 'rk4': this.stepRk4(dt); break
      case 'rk45': this.advanceAdaptive(dt); break
    }
  }

  private stepEuler(dt: number) {
    const { n, y } = this
    const a = this.a0
    this.sys.acc(this.t, y, a)
    this.evals++
    for (let i = 0; i < n; i++) {
      const v = y[n + i]
      y[i] += v * dt
      y[n + i] = v + a[i] * dt
    }
    this.t += dt
    this.aValid = false
  }

  private stepSemi(dt: number) {
    const { n, y } = this
    const a = this.a0
    this.sys.acc(this.t, y, a)
    this.evals++
    for (let i = 0; i < n; i++) {
      y[n + i] += a[i] * dt
      y[i] += y[n + i] * dt
    }
    this.t += dt
    this.aValid = false
  }

  private stepVerlet(dt: number) {
    const { n, y, sys } = this
    const a0 = this.a0
    const a1 = this.a1
    const cache = !sys.vdep
    if (!(cache && this.aValid)) {
      sys.acc(this.t, y, a0)
      this.evals++
    }
    const tmp = this.tmp
    for (let i = 0; i < n; i++) {
      tmp[i] = y[i] + y[n + i] * dt + 0.5 * a0[i] * dt * dt
      tmp[n + i] = y[n + i] + a0[i] * dt // predicted velocity (exact for velocity-independent forces)
    }
    sys.acc(this.t + dt, tmp, a1)
    this.evals++
    for (let i = 0; i < n; i++) {
      y[i] = tmp[i]
      y[n + i] += 0.5 * (a0[i] + a1[i]) * dt
    }
    this.t += dt
    if (cache) {
      a0.set(a1)
      this.aValid = true
    }
  }

  private stepRk4(dt: number) {
    const { m, y, tmp } = this
    const [k1, k2, k3, k4] = this.k
    const t = this.t
    this.f(t, y, k1)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + 0.5 * dt * k1[i]
    this.f(t + 0.5 * dt, tmp, k2)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + 0.5 * dt * k2[i]
    this.f(t + 0.5 * dt, tmp, k3)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + dt * k3[i]
    this.f(t + dt, tmp, k4)
    for (let i = 0; i < m; i++) y[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    this.t += dt
    this.aValid = false
  }

  /** One Dormand-Prince step of size h from the current state into `out`; returns the scaled error norm. */
  private dp(h: number, out: Float64Array): number {
    const { m, y, tmp } = this
    const [k1, k2, k3, k4, k5, k6, k7] = this.k
    const t = this.t
    this.f(t, y, k1)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + h * A21 * k1[i]
    this.f(t + h / 5, tmp, k2)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i])
    this.f(t + 0.3 * h, tmp, k3)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i])
    this.f(t + 0.8 * h, tmp, k4)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i])
    this.f(t + (8 / 9) * h, tmp, k5)
    for (let i = 0; i < m; i++) tmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i])
    this.f(t + h, tmp, k6)
    for (let i = 0; i < m; i++) out[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i])
    this.f(t + h, out, k7)
    let err = 0
    for (let i = 0; i < m; i++) {
      const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i])
      const sc = this.atol + this.rtol * Math.max(Math.abs(y[i]), Math.abs(out[i]))
      err = Math.max(err, Math.abs(e) / sc)
    }
    return err
  }

  private advanceAdaptive(dt: number) {
    const target = this.t + dt
    const out = new Float64Array(this.m)
    let h = this.hNext > 0 ? Math.min(this.hNext, dt) : dt / 4
    let guard = 0
    while (this.t < target - 1e-15 * Math.max(1, Math.abs(target))) {
      if (guard++ > 200000) break
      h = Math.min(h, target - this.t)
      const err = this.dp(h, out)
      if (err <= 1 || h < dt * 1e-9) {
        this.t = this.t + h >= target - 1e-15 * Math.max(1, Math.abs(target)) ? target : this.t + h
        this.y.set(out)
        this.steps++
        this.hLast = h
      }
      const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2)))
      h *= fac
      this.hNext = h
    }
    this.aValid = false
  }
}

/** Runs a system for `duration` with a fixed step and returns the maximum relative energy error, for tests and charts. */
export function energyError(energy: (y: ArrayLike<number>, t: number) => number, o: Ode2, duration: number, dt: number): number {
  const e0 = energy(o.y, o.t)
  const scale = Math.max(Math.abs(e0), 1e-300)
  let worst = 0
  const n = Math.round(duration / dt)
  for (let i = 0; i < n; i++) {
    o.advance(dt)
    worst = Math.max(worst, Math.abs(energy(o.y, o.t) - e0) / scale)
  }
  return worst
}
