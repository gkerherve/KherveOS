// Scene 2 — pendulums: simple (the exact nonlinear motion against the small-angle cosine and the elliptic-function
// solution), damped, driven (resonance curve, Poincaré section), the chaotic double pendulum (two almost identical
// starts, a Lyapunov exponent) and the physical (compound) pendulum.

import { linearOscillator, measureDriven, steadyResponse, dampingRegime } from '../closed.ts'
import { pendulumAngleExact, pendulumPeriodAmplitudeSeries, pendulumPeriodExact, pendulumPeriodSeries } from '../elliptic.ts'
import { Ode2, type Method, type System2 } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import {
  COLORS, DEG, clamp, crossT, defaultsFor, energyPlot, fmt, num, str, timePlot, wrapPi, bool,
} from '../common.ts'
import { GRAVITY_CHOICES, gravityOf } from './projectile.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Sweep, Preset } from '../types.ts'

// ------------------------------------------------------------------------------------------ physical pendulum

export type BodyShape = 'rod' | 'disc' | 'ring'

/** Moment of inertia of the body about its centre of mass, per unit mass: rod L²/12, disc R²/2, ring R². */
export function inertiaCm(shape: BodyShape, size: number): number {
  return shape === 'rod' ? (size * size) / 12 : shape === 'disc' ? (size * size) / 2 : size * size
}

export interface Compound {
  /** Pivot distance from the centre of mass. */
  d: number
  /** Moment of inertia about the pivot per unit mass. */
  ip: number
  /** Equivalent simple-pendulum length I_p / (m d). */
  leq: number
  /** Radius of gyration about the centre of mass. */
  k: number
}

export function compoundOf(shape: BodyShape, size: number, pivot: number): Compound {
  const dmax = shape === 'rod' ? size / 2 : size
  const d = clamp(pivot, 0.005, dmax)
  const icm = inertiaCm(shape, size)
  const ip = icm + d * d
  return { d, ip, leq: ip / d, k: Math.sqrt(icm) }
}

// ------------------------------------------------------------------------------------------ double pendulum

export interface DoubleParams { L1: number; L2: number; m1: number; m2: number; g: number }

export function doubleAcc(P: DoubleParams, th1: number, th2: number, w1: number, w2: number): [number, number] {
  const { L1, L2, m1, m2, g } = P
  const d = th1 - th2
  const den = 2 * m1 + m2 - m2 * Math.cos(2 * d)
  const a1 = (-g * (2 * m1 + m2) * Math.sin(th1) - m2 * g * Math.sin(th1 - 2 * th2) - 2 * Math.sin(d) * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d))) / (L1 * den)
  const a2 = (2 * Math.sin(d) * (w1 * w1 * L1 * (m1 + m2) + g * (m1 + m2) * Math.cos(th1) + w2 * w2 * L2 * m2 * Math.cos(d))) / (L2 * den)
  return [a1, a2]
}

export function doubleEnergy(P: DoubleParams, th1: number, th2: number, w1: number, w2: number): Energy {
  const { L1, L2, m1, m2, g } = P
  const ke = 0.5 * (m1 + m2) * L1 * L1 * w1 * w1 + 0.5 * m2 * L2 * L2 * w2 * w2 + m2 * L1 * L2 * w1 * w2 * Math.cos(th1 - th2)
  const pe = -(m1 + m2) * g * L1 * Math.cos(th1) - m2 * g * L2 * Math.cos(th2)
  return { ke, pe, total: ke + pe }
}

const doubleSystem = (P: () => DoubleParams, copies: number): System2 => ({
  n: 2 * copies,
  acc(_t, y, a) {
    const p = P()
    const n = 2 * copies
    for (let c = 0; c < copies; c++) {
      const [a1, a2] = doubleAcc(p, y[2 * c], y[2 * c + 1], y[n + 2 * c], y[n + 2 * c + 1])
      a[2 * c] = a1
      a[2 * c + 1] = a2
    }
  },
})

/** Largest Lyapunov exponent of the double pendulum by Benettin's method (1/s). */
export function lyapunovDouble(p: Params, T = 60, method: Method = 'rk4', dt = 0.002): number {
  const P = doublePars(p)
  const y0 = [num(p, 'th1', 120) * DEG, num(p, 'th2', -10) * DEG, num(p, 'w1', 0), num(p, 'w2', 0)]
  const d0 = 1e-8
  const o = new Ode2(doubleSystem(() => P, 2), [...y0.slice(0, 2), y0[0] + d0, y0[1], ...y0.slice(2), y0[2], y0[3]], method)
  let sum = 0
  const renorm = 25
  const steps = Math.round(T / dt)
  for (let i = 1; i <= steps; i++) {
    o.advance(dt)
    if (i % renorm === 0 || i === steps) {
      const y = o.y
      const dv = [y[2] - y[0], y[3] - y[1], y[6] - y[4], y[7] - y[5]]
      const d = Math.hypot(dv[0], dv[1], dv[2], dv[3])
      if (!(d > 0)) return 0
      sum += Math.log(d / d0)
      const s = d0 / d
      y[2] = y[0] + dv[0] * s
      y[3] = y[1] + dv[1] * s
      y[6] = y[4] + dv[2] * s
      y[7] = y[5] + dv[3] * s
      o.invalidate()
    }
  }
  return sum / (steps * dt)
}

function doublePars(p: Params): DoubleParams {
  return { L1: num(p, 'L1', 1), L2: num(p, 'L2', 1), m1: num(p, 'm1', 1), m2: num(p, 'm2', 1), g: gravityOf(p) }
}

// ------------------------------------------------------------------------------------------ parameters

const MODES = [
  { id: 'simple', label: 'Simple pendulum', blurb: 'Exact nonlinear motion against the small-angle cosine and the elliptic-function solution.' },
  { id: 'damped', label: 'Damped pendulum', blurb: 'Friction at the pivot: the amplitude decays; phase portrait spirals in.' },
  { id: 'driven', label: 'Driven pendulum', blurb: 'A periodic torque: resonance curve, phase lag and a Poincaré section.' },
  { id: 'double', label: 'Double pendulum', blurb: 'Chaos: two nearly identical starts separate exponentially.' },
  { id: 'compound', label: 'Physical pendulum', blurb: 'A rod, disc or ring swinging about a pivot away from its centre of mass.' },
]
const SINGLE = ['simple', 'damped', 'driven']

const PARAMS: ParamDef[] = [
  { kind: 'number', key: 'L', label: 'Length', unit: 'm', min: 0.1, max: 5, step: 0.05, value: 1, modes: SINGLE },
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth', live: true },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0.1, max: 100, step: 0.1, value: 9.81, live: true, when: (p) => p.gravity === 'custom' },
  { kind: 'number', key: 'theta0', label: 'Initial angle', unit: '°', min: -179, max: 179, step: 1, value: 60, modes: [...SINGLE, 'compound'] },
  { kind: 'number', key: 'omega0', label: 'Initial angular velocity', unit: 'rad/s', min: -10, max: 10, step: 0.1, value: 0, modes: [...SINGLE, 'compound'] },
  { kind: 'number', key: 'c', label: 'Damping c', unit: '1/s', min: 0, max: 4, step: 0.01, value: 0.3, live: true, modes: ['damped', 'driven', 'compound'], hint: 'Torque = −c·I·ω: the amplitude decays as e^(−c t/2).' },
  { kind: 'number', key: 'A', label: 'Drive amplitude', unit: 'rad/s²', min: 0, max: 30, step: 0.1, value: 1.2, live: true, modes: ['driven'], hint: 'Angular acceleration A·cos(Ω t).' },
  { kind: 'number', key: 'Om', label: 'Drive frequency Ω', unit: 'rad/s', min: 0.2, max: 12, step: 0.01, value: 2.5, live: true, modes: ['driven'] },
  { kind: 'number', key: 'mass', label: 'Mass', unit: 'kg', min: 0.01, max: 50, step: 0.01, scale: 'log', value: 1, modes: [...SINGLE, 'compound'] },
  // compound
  { kind: 'choice', key: 'shape', label: 'Body', options: [{ value: 'rod', label: 'Uniform rod' }, { value: 'disc', label: 'Disc' }, { value: 'ring', label: 'Ring / hoop' }], value: 'rod', modes: ['compound'] },
  { kind: 'number', key: 'size', label: 'Length / radius', unit: 'm', min: 0.1, max: 3, step: 0.05, value: 1, modes: ['compound'] },
  { kind: 'number', key: 'pivot', label: 'Pivot distance from CM', unit: 'm', min: 0.01, max: 3, step: 0.01, value: 0.5, modes: ['compound'] },
  // double
  { kind: 'number', key: 'L1', label: 'Length 1', unit: 'm', min: 0.2, max: 2, step: 0.05, value: 1, modes: ['double'] },
  { kind: 'number', key: 'L2', label: 'Length 2', unit: 'm', min: 0.2, max: 2, step: 0.05, value: 1, modes: ['double'] },
  { kind: 'number', key: 'm1', label: 'Mass 1', unit: 'kg', min: 0.1, max: 10, step: 0.1, value: 1, modes: ['double'] },
  { kind: 'number', key: 'm2', label: 'Mass 2', unit: 'kg', min: 0.1, max: 10, step: 0.1, value: 1, modes: ['double'] },
  { kind: 'number', key: 'th1', label: 'Angle 1', unit: '°', min: -180, max: 180, step: 1, value: 120, modes: ['double'] },
  { kind: 'number', key: 'th2', label: 'Angle 2', unit: '°', min: -180, max: 180, step: 1, value: -10, modes: ['double'] },
  { kind: 'number', key: 'w1', label: 'Angular velocity 1', unit: 'rad/s', min: -8, max: 8, step: 0.1, value: 0, modes: ['double'] },
  { kind: 'number', key: 'w2', label: 'Angular velocity 2', unit: 'rad/s', min: -8, max: 8, step: 0.1, value: 0, modes: ['double'] },
  { kind: 'bool', key: 'twin', label: 'Second, nearly identical pendulum', value: true, modes: ['double'] },
  { kind: 'number', key: 'eps', label: 'Offset of the twin', unit: '°', min: 0.00001, max: 5, step: 0.0001, scale: 'log', value: 0.01, modes: ['double'], when: (p) => p.twin === true, digits: 5 },
]

const OVERRIDES: Record<string, Params> = {
  simple: { c: 0, A: 0, theta0: 60 },
  damped: { c: 0.3, theta0: 50 },
  driven: { c: 0.5, A: 1.2, Om: 2.5, theta0: 0 },
  compound: { c: 0, theta0: 40 },
  double: {},
}

// ------------------------------------------------------------------------------------------ single pendulum

const SINGLE_CHANNELS: Channel[] = [
  { key: 't', label: 'time', unit: 's' },
  { key: 'theta', label: 'angle θ', unit: 'rad' }, { key: 'omega', label: 'angular velocity ω', unit: 'rad/s' }, { key: 'alpha', label: 'angular acceleration α', unit: 'rad/s²' },
  { key: 'x', label: 'x (bob)', unit: 'm' }, { key: 'y', label: 'y (bob)', unit: 'm' },
  { key: 'vx', label: 'vx', unit: 'm/s' }, { key: 'vy', label: 'vy', unit: 'm/s' }, { key: 'ax', label: 'ax', unit: 'm/s²' }, { key: 'ay', label: 'ay', unit: 'm/s²' },
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
  { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
  { key: 'theta_small', label: 'θ small-angle / linear', unit: 'rad', analytic: true },
  { key: 'theta_exact', label: 'θ exact (elliptic)', unit: 'rad', analytic: true },
]

const singlePlots = (mode: string): PlotSpec[] => [
  timePlot('theta', 'θ(t)', mode === 'simple'
    ? [{ key: 'theta', label: 'simulation' }, { key: 'theta_exact', label: 'exact (elliptic functions)', dash: true }, { key: 'theta_small', label: 'small-angle cosine', dash: true }]
    : [{ key: 'theta', label: 'simulation' }, { key: 'theta_small', label: 'linear theory', dash: true }], 'angle (rad)'),
  timePlot('omega', 'ω(t)', [{ key: 'omega' }], 'angular velocity (rad/s)'),
  timePlot('alpha', 'α(t)', [{ key: 'alpha' }], 'angular acceleration (rad/s²)'),
  {
    id: 'phase', title: 'Phase portrait', kind: 'xy', x: 'theta', series: [{ key: 'omega', label: 'trajectory' }], xLabel: 'θ (rad)', yLabel: 'ω (rad/s)',
    clouds: mode === 'driven' || mode === 'damped' ? [] : [{ key: 'phase_bg', label: 'energy contours', dash: true }],
  },
  energyPlot(),
  timePlot('mom', 'Momentum of the bob', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
  ...(mode === 'driven' ? [{ id: 'poincare', title: 'Poincaré section (once per drive period)', kind: 'extra' as const, series: [], xLabel: 'θ (rad)', yLabel: 'ω (rad/s)', clouds: [{ key: 'poincare', label: 'stroboscopic points', markers: true }] }] : []),
]

class SinglePendulumSim extends SimBase {
  readonly scene = 'pendulum' as const
  readonly mode: string
  channels = SINGLE_CHANNELS
  plots: PlotSpec[]
  o: Ode2
  private readonly m: number
  private readonly theta0: number
  private readonly omega0: number
  private readonly shape: BodyShape
  private readonly size: number
  private readonly comp: Compound | null
  private upCross: number[] = []
  private amp = 0
  private ampMax = 0
  private ampWin = 0
  private pts: number[][] = []

  constructor(params: Params, method: Method) {
    super(params, method)
    this.mode = str(params, 'mode', 'simple')
    this.m = num(params, 'mass', 1)
    this.theta0 = num(params, 'theta0', 60) * DEG
    this.omega0 = num(params, 'omega0', 0)
    this.shape = str(params, 'shape', 'rod') as BodyShape
    this.size = num(params, 'size', 1)
    this.comp = this.mode === 'compound' ? compoundOf(this.shape, this.size, num(params, 'pivot', 0.5)) : null
    this.plots = singlePlots(this.mode)
    this.conservative = this.mode === 'simple' || (this.mode === 'compound' && num(params, 'c', 0) === 0)
    this.o = new Ode2(
      {
        n: 1,
        vdep: true,
        acc: (t, y, a) => {
          a[0] = -this.w2() * Math.sin(y[0]) - this.cdamp() * y[1] + this.drive(t)
        },
      },
      [this.theta0, this.omega0],
      method,
    )
    this.dt = 1 / 480
    this.sampleDt = 0.02
  }

  private g() { return gravityOf(this.params) }
  private L() { return this.comp ? this.comp.leq : num(this.params, 'L', 1) }
  private w2() { return this.comp ? (this.g() * this.comp.d) / this.comp.ip : this.g() / num(this.params, 'L', 1) }
  private cdamp() { return this.mode === 'simple' ? 0 : num(this.params, 'c', 0) }
  private A() { return this.mode === 'driven' ? num(this.params, 'A', 0) : 0 }
  private Om() { return num(this.params, 'Om', 2.5) }
  private drive(t: number) { return this.A() * Math.cos(this.Om() * t) }
  /** Moment of inertia and weight lever for the energy bookkeeping. */
  private inertia() { return this.comp ? this.m * this.comp.ip : this.m * this.L() ** 2 }
  private lever() { return this.comp ? this.comp.d : this.L() }

  step(dt: number) {
    this.o.method = this.method
    const prevT = this.o.t
    const prev = this.o.y[0]
    const pw = this.o.y[1]
    this.o.advance(dt)
    this.t = this.o.t
    const th = this.o.y[0]
    if (prev < 0 && th >= 0) this.upCross.push(crossT(prevT, prev, this.t, th))
    if (this.upCross.length > 12) this.upCross.shift()
    // amplitude over the last drive period (or free period)
    this.ampMax = Math.max(this.ampMax, Math.abs(th))
    const win = this.mode === 'driven' ? (2 * Math.PI) / this.Om() : (2 * Math.PI) / Math.sqrt(this.w2())
    if (this.t - this.ampWin >= win) {
      this.amp = this.ampMax
      this.ampMax = 0
      this.ampWin = this.t
    }
    if (this.mode === 'driven') {
      const T = (2 * Math.PI) / this.Om()
      const k0 = Math.floor(prevT / T)
      const k1 = Math.floor(this.t / T)
      if (k1 > k0) {
        const tn = k1 * T
        const s = (tn - prevT) / (this.t - prevT)
        const x = prev + s * (th - prev)
        const w = pw + s * (this.o.y[1] - pw)
        this.pts.push([wrapPi(x), w])
        if (this.pts.length > 4000) this.pts.shift()
      }
    }
  }

  private linear(t: number) {
    const w2 = this.w2()
    return linearOscillator(w2, this.cdamp(), this.A(), this.Om(), this.theta0, this.omega0, t).x
  }

  private exact(t: number): number {
    if (this.mode === 'driven' || this.omega0 !== 0 || this.cdamp() !== 0) return NaN
    const w2 = this.w2()
    return pendulumAngleExact(this.g() / w2, this.g(), this.theta0, t)
  }

  sample(): Record<string, number> {
    const [th, w] = [this.o.y[0], this.o.y[1]]
    const acc = new Float64Array(1)
    this.o.accel(acc)
    const L = this.L()
    const alpha = acc[0]
    const e = this.energy()
    const vx = L * w * Math.cos(th)
    const vy = L * w * Math.sin(th)
    const ax = L * alpha * Math.cos(th) - L * w * w * Math.sin(th)
    const ay = L * alpha * Math.sin(th) + L * w * w * Math.cos(th)
    return {
      t: this.o.t, theta: th, omega: w, alpha, x: L * Math.sin(th), y: -L * Math.cos(th), vx, vy, ax, ay,
      ke: e.ke, pe: e.pe, e: e.total, px: this.m * vx, py: this.m * vy,
      theta_small: this.linear(this.o.t), theta_exact: this.exact(this.o.t),
    }
  }

  energy(): Energy {
    const th = this.o.y[0]
    const w = this.o.y[1]
    const ke = 0.5 * this.inertia() * w * w
    const pe = this.m * this.g() * this.lever() * (1 - Math.cos(th))
    return { ke, pe, total: ke + pe }
  }

  bounds(): Bounds {
    const R = this.comp ? this.comp.d + (this.shape === 'rod' ? this.size / 2 : this.size) : this.L()
    return { x0: -R * 1.25, x1: R * 1.25, y0: -R * 1.2, y1: R * 0.35 }
  }

  frame(): Frame {
    const th = this.o.y[0]
    const L = this.L()
    const shapes: Shape[] = []
    const px = 0
    const py = 0
    const R = this.comp ? this.comp.d + (this.shape === 'rod' ? this.size / 2 : this.size) : L
    // support
    shapes.push({ t: 'rect', x: -R * 0.3, y: R * 0.02, w: R * 0.6, h: R * 0.05, fill: COLORS.fixed })
    // reference arc and the vertical
    shapes.push({ t: 'line', x1: 0, y1: 0, x2: 0, y2: -R * 1.1, color: COLORS.fixed, dash: true, w: 1 })
    const pts: number[][] = []
    const a0 = Math.min(0, th)
    const a1 = Math.max(0, th)
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((a1 - a0) * i) / 24
      pts.push([R * 0.35 * Math.sin(a), -R * 0.35 * Math.cos(a)])
    }
    shapes.push({ t: 'path', pts, color: COLORS.rod, w: 1, alpha: 0.7 })
    const dir = [Math.sin(th), -Math.cos(th)]
    const bodies = []
    const sm = this.linear(this.o.t)
    if (this.comp) {
      const cmx = this.comp.d * dir[0]
      const cmy = this.comp.d * dir[1]
      if (this.shape === 'rod') {
        const s0 = this.comp.d - this.size / 2
        const s1 = this.comp.d + this.size / 2
        const hw = Math.max(this.size * 0.025, 0.01)
        const nx = Math.cos(th)
        const ny = Math.sin(th)
        shapes.push({ t: 'poly', pts: [[s0 * dir[0] + hw * nx, s0 * dir[1] + hw * ny], [s1 * dir[0] + hw * nx, s1 * dir[1] + hw * ny], [s1 * dir[0] - hw * nx, s1 * dir[1] - hw * ny], [s0 * dir[0] - hw * nx, s0 * dir[1] - hw * ny]], fill: COLORS.a, stroke: COLORS.a, closed: true, alpha: 0.9 })
      } else {
        shapes.push({ t: 'circle', x: cmx, y: cmy, r: this.size, fill: COLORS.a, stroke: COLORS.a, alpha: this.shape === 'ring' ? 0.12 : 0.45, ring: this.shape === 'ring' })
        shapes.push({ t: 'line', x1: cmx, y1: cmy, x2: cmx + this.size * Math.cos(th), y2: cmy + this.size * Math.sin(th), color: COLORS.a, w: 1.5 })
      }
      shapes.push({ t: 'line', x1: 0, y1: 0, x2: cmx, y2: cmy, color: COLORS.rod, w: 1, dash: true })
      shapes.push({ t: 'circle', x: cmx, y: cmy, r: R * 0.025, fill: COLORS.f })
      shapes.push({ t: 'text', x: cmx + R * 0.06, y: cmy, text: 'CM', color: COLORS.f })
      // the equivalent simple pendulum's bob: the centre of oscillation
      shapes.push({ t: 'circle', x: this.comp.leq * dir[0], y: this.comp.leq * dir[1], r: R * 0.025, fill: COLORS.d, alpha: 0.9 })
      shapes.push({ t: 'text', x: this.comp.leq * dir[0] + R * 0.06, y: this.comp.leq * dir[1], text: 'centre of oscillation', color: COLORS.d })
      const w = this.o.y[1]
      const al = new Float64Array(1)
      this.o.accel(al)
      bodies.push({ id: 'cm', x: cmx, y: cmy, vx: this.comp.d * w * Math.cos(th), vy: this.comp.d * w * Math.sin(th), ax: this.comp.d * al[0] * Math.cos(th) - this.comp.d * w * w * Math.sin(th), ay: this.comp.d * al[0] * Math.sin(th) + this.comp.d * w * w * Math.cos(th), m: this.m, color: COLORS.a, name: 'CM' })
    } else {
      const bx = L * dir[0]
      const by = L * dir[1]
      const r = L * 0.06 * Math.cbrt(this.m)
      shapes.push({ t: 'line', x1: px, y1: py, x2: bx, y2: by, color: COLORS.rod, w: 2 })
      {
        const gx = L * Math.sin(sm)
        const gy = -L * Math.cos(sm)
        if (Number.isFinite(sm) && Math.abs(sm) < 3.1) {
          shapes.push({ t: 'line', x1: 0, y1: 0, x2: gx, y2: gy, color: COLORS.theory, w: 1, dash: true })
          shapes.push({ t: 'circle', x: gx, y: gy, r: r * 0.8, fill: COLORS.theory, alpha: 0.35 })
        }
        if (this.mode === 'simple') {
          const ex = this.exact(this.o.t)
          if (Number.isFinite(ex)) shapes.push({ t: 'circle', x: L * Math.sin(ex), y: -L * Math.cos(ex), r: r * 0.7, fill: COLORS.d, alpha: 0.35 })
        }
      }
      shapes.push({ t: 'circle', x: bx, y: by, r, fill: COLORS.a })
      const w = this.o.y[1]
      const al = new Float64Array(1)
      this.o.accel(al)
      bodies.push({ id: 'bob', x: bx, y: by, vx: L * w * Math.cos(th), vy: L * w * Math.sin(th), ax: L * al[0] * Math.cos(th) - L * w * w * Math.sin(th), ay: L * al[0] * Math.sin(th) + L * w * w * Math.cos(th), m: this.m, r, color: COLORS.a })
    }
    shapes.push({ t: 'circle', x: 0, y: 0, r: R * 0.018, fill: COLORS.rod })
    return { shapes, bodies: bodies.map((b) => ({ ...b, color: b.color })) }
  }

  measuredPeriod(): number | null {
    const c = this.upCross
    return c.length >= 2 ? (c[c.length - 1] - c[0]) / (c.length - 1) : null
  }

  extra(): Record<string, number[][]> {
    const out: Record<string, number[][]> = { poincare: this.pts }
    if (this.mode === 'simple' || (this.mode === 'compound' && this.cdamp() === 0)) {
      const w2 = this.w2()
      const curves: number[][] = []
      const levels = [0.2, 0.5, 0.8, 1.0, 1.4].map((f) => -w2 + f * 2 * w2)
      for (const E of levels) {
        const up: number[][] = []
        const lo: number[][] = []
        for (let i = -90; i <= 90; i++) {
          const th = (i / 90) * Math.PI
          const arg = 2 * (E + w2 * Math.cos(th))
          if (arg >= 0) { up.push([th, Math.sqrt(arg)]); lo.push([th, -Math.sqrt(arg)]) }
        }
        const closed = E < w2 - 1e-9
        if (closed) curves.push(...up, ...lo.reverse(), up[0], [NaN, NaN])
        else curves.push(...up, [NaN, NaN], ...lo, [NaN, NaN])
      }
      out.phase_bg = curves
    }
    return out
  }

  readouts(): Readout[] {
    const w2 = this.w2()
    const w0 = Math.sqrt(w2)
    const out: Readout[] = []
    const T0 = (2 * Math.PI) / w0
    const th0 = Math.abs(this.theta0)
    const Tm = this.measuredPeriod()
    if (this.mode === 'simple' || this.mode === 'compound') {
      const L = this.L()
      const Te = this.omega0 === 0 ? pendulumPeriodExact(L, this.g(), th0) : NaN
      out.push({ label: this.comp ? 'Small-angle period 2π√(I/mgd)' : 'Small-angle period 2π√(L/g)', value: `${fmt(T0, 5)} s` })
      if (this.omega0 === 0 && this.cdamp() === 0) {
        out.push({ label: 'Exact period (elliptic K)', value: `${fmt(Te, 5)} s`, theory: `series: ${fmt(pendulumPeriodSeries(L, this.g(), th0, 8), 5)} s` })
        out.push({ label: 'Amplitude series 1+θ²/16+…', value: `${fmt(pendulumPeriodAmplitudeSeries(L, this.g(), th0), 5)} s` })
      }
      out.push({ label: 'Measured period', value: Tm ? `${fmt(Tm, 5)} s` : 'waiting for two swings…', tone: 'info' })
      if (Tm && Number.isFinite(Te)) out.push({ label: 'Measured / small-angle', value: fmt(Tm / T0, 5), theory: `${fmt(Te / T0, 5)} exact` })
      if (this.comp) {
        out.push({ label: 'Equivalent length I/(m d)', value: `${fmt(this.comp.leq)} m` })
        out.push({ label: 'Radius of gyration (CM)', value: `${fmt(this.comp.k)} m` })
        out.push({ label: 'Best pivot (shortest period)', value: `${fmt(this.comp.k)} m from CM`, tone: 'info' })
      }
    } else if (this.mode === 'damped') {
      const c = this.cdamp()
      out.push({ label: 'Natural frequency ω₀', value: `${fmt(w0)} rad/s`, theory: `T₀ = ${fmt(T0)} s` })
      out.push({ label: 'Regime', value: dampingRegime(w2, c) })
      out.push({ label: 'Quality factor Q', value: c > 0 ? fmt(w0 / c) : '∞' })
      out.push({ label: 'Amplitude decay time 2/c', value: c > 0 ? `${fmt(2 / c)} s` : '∞' })
      out.push({ label: 'Measured period', value: Tm ? `${fmt(Tm, 5)} s` : '…', theory: c < 2 * w0 ? `${fmt((2 * Math.PI) / Math.sqrt(w2 - (c / 2) ** 2), 5)} s (linear)` : undefined })
    } else {
      const c = this.cdamp()
      const r = steadyResponse(w2, c, this.A(), this.Om())
      out.push({ label: 'Natural frequency ω₀', value: `${fmt(w0)} rad/s`, theory: `Ω/ω₀ = ${fmt(this.Om() / w0)}` })
      out.push({ label: 'Steady amplitude', value: `${fmt(this.amp)} rad`, theory: `${fmt(r.amp)} rad (linear)` })
      out.push({ label: 'Phase lag', value: `${fmt((r.phase / DEG), 3)}° (linear)` })
      out.push({ label: 'Peak amplitude near ω₀', value: c > 0 ? `${fmt(this.A() / (c * w0))} rad` : '∞', tone: 'info' })
      out.push({ label: 'Quality factor Q', value: c > 0 ? fmt(w0 / c) : '∞' })
    }
    return out
  }
}

export function pendulumSweep(p: Params, method: Method = 'rk4'): Sweep | null {
  const mode = str(p, 'mode', 'driven')
  if (mode !== 'driven') return null
  const g = gravityOf(p)
  const w2 = g / num(p, 'L', 1)
  const w0 = Math.sqrt(w2)
  const c = num(p, 'c', 0.5)
  const A = num(p, 'A', 1.2)
  const n = 36
  const x: number[] = []
  const measured: number[] = []
  const theory: number[] = []
  const phase: number[] = []
  const phaseTheory: number[] = []
  let y: ArrayLike<number> = [0, 0]
  let t = 0
  for (let i = 0; i < n; i++) {
    const Om = w0 * (0.3 + (1.6 * i) / (n - 1))
    const sys: System2 = { n: 1, vdep: true, acc: (tt, yy, a) => { a[0] = -w2 * Math.sin(yy[0]) - c * yy[1] + A * Math.cos(Om * tt) } }
    const m = measureDriven(sys, Om, y, t, 40, 8, method, 160)
    y = m.yEnd
    t = m.tEnd
    x.push(Om)
    measured.push(m.amp)
    phase.push(m.phase / DEG)
    const th = steadyResponse(w2, c, A, Om)
    theory.push(th.amp)
    phaseTheory.push(th.phase / DEG)
  }
  return { title: 'Resonance curve', xLabel: 'drive frequency Ω (rad/s)', yLabel: 'amplitude (rad)', x, measured, theory, phase, phaseTheory, mark: num(p, 'Om', 2.5) }
}

// ------------------------------------------------------------------------------------------ double pendulum sim

const DOUBLE_CHANNELS: Channel[] = [
  { key: 't', label: 'time', unit: 's' },
  { key: 'theta1', label: 'θ₁', unit: 'rad' }, { key: 'theta2', label: 'θ₂', unit: 'rad' }, { key: 'omega1', label: 'ω₁', unit: 'rad/s' }, { key: 'omega2', label: 'ω₂', unit: 'rad/s' },
  { key: 'x1', label: 'x₁', unit: 'm' }, { key: 'y1', label: 'y₁', unit: 'm' }, { key: 'x', label: 'x₂', unit: 'm' }, { key: 'y', label: 'y₂', unit: 'm' },
  { key: 'vx', label: 'vx₂', unit: 'm/s' }, { key: 'vy', label: 'vy₂', unit: 'm/s' },
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
  { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
  { key: 'twin_theta1', label: 'twin θ₁', unit: 'rad' }, { key: 'sep', label: 'separation of the twins', unit: 'rad' },
]

const DOUBLE_PLOTS: PlotSpec[] = [
  timePlot('angles', 'Angles', [{ key: 'theta1', label: 'θ₁' }, { key: 'theta2', label: 'θ₂' }, { key: 'twin_theta1', label: 'θ₁ twin', dash: true }], 'angle (rad)'),
  { ...timePlot('diverge', 'Divergence of the two starts', [{ key: 'sep', label: 'phase-space distance' }], 'separation'), logY: true },
  { id: 'phase1', title: 'Phase portrait (pendulum 1)', kind: 'xy', x: 'theta1w', series: [{ key: 'omega1' }], xLabel: 'θ₁ (rad, wrapped)', yLabel: 'ω₁ (rad/s)' },
  { id: 'path', title: 'Path of the lower bob', kind: 'xy', x: 'x', series: [{ key: 'y' }], xLabel: 'x (m)', yLabel: 'y (m)', equal: true },
  { id: 'poincare', title: 'Poincaré section (θ₁ = 0, going up)', kind: 'extra', series: [], xLabel: 'θ₂ (rad)', yLabel: 'ω₂ (rad/s)', clouds: [{ key: 'poincare', label: 'section points', markers: true }] },
  energyPlot(),
  timePlot('mom', 'Momentum of the lower bob', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
]

class DoublePendulumSim extends SimBase {
  readonly scene = 'pendulum' as const
  readonly mode = 'double'
  channels = [...DOUBLE_CHANNELS, { key: 'theta1w', label: 'θ₁ wrapped', unit: 'rad' }]
  plots = DOUBLE_PLOTS
  o: Ode2
  readonly twin: boolean
  private e0: number
  private pts: number[][] = []
  private lyap: { key: string; value: number } | null = null

  constructor(params: Params, method: Method) {
    super(params, method)
    this.twin = bool(params, 'twin', true)
    this.conservative = true
    const eps = num(params, 'eps', 0.01) * DEG
    const th1 = num(params, 'th1', 120) * DEG
    const th2 = num(params, 'th2', -10) * DEG
    const w1 = num(params, 'w1', 0)
    const w2 = num(params, 'w2', 0)
    const P = () => doublePars(this.params)
    this.o = this.twin
      ? new Ode2(doubleSystem(P, 2), [th1, th2, th1 + eps, th2, w1, w2, w1, w2], method)
      : new Ode2(doubleSystem(P, 1), [th1, th2, w1, w2], method)
    this.e0 = this.energy().total
    this.dt = 1 / 500
    this.sampleDt = 0.02
  }

  private get n() { return this.twin ? 4 : 2 }
  private P() { return doublePars(this.params) }
  private st(c: number) { const y = this.o.y; const n = this.n; return { th1: y[2 * c], th2: y[2 * c + 1], w1: y[n + 2 * c], w2: y[n + 2 * c + 1] } }

  step(dt: number) {
    this.o.method = this.method
    const before = this.st(0)
    this.o.advance(dt)
    this.t = this.o.t
    const now = this.st(0)
    const a = wrapPi(before.th1)
    const b = wrapPi(now.th1)
    // a crossing of θ1 = 0 going up (not the wrap at ±π)
    if (a < 0 && b >= 0 && Math.abs(a) < 1 && Math.abs(b) < 1) {
      const s = a / (a - b)
      this.pts.push([wrapPi(before.th2 + s * (now.th2 - before.th2)), before.w2 + s * (now.w2 - before.w2)])
      if (this.pts.length > 4000) this.pts.shift()
    }
  }

  energy(): Energy {
    const s = this.st(0)
    return doubleEnergy(this.P(), s.th1, s.th2, s.w1, s.w2)
  }

  sample(): Record<string, number> {
    const P = this.P()
    const s = this.st(0)
    const e = this.energy()
    const x1 = P.L1 * Math.sin(s.th1)
    const y1 = -P.L1 * Math.cos(s.th1)
    const x2 = x1 + P.L2 * Math.sin(s.th2)
    const y2 = y1 - P.L2 * Math.cos(s.th2)
    const vx1 = P.L1 * s.w1 * Math.cos(s.th1)
    const vy1 = P.L1 * s.w1 * Math.sin(s.th1)
    const vx = vx1 + P.L2 * s.w2 * Math.cos(s.th2)
    const vy = vy1 + P.L2 * s.w2 * Math.sin(s.th2)
    let sep = NaN
    let tw1 = NaN
    if (this.twin) {
      const q = this.st(1)
      tw1 = q.th1
      sep = Math.hypot(q.th1 - s.th1, q.th2 - s.th2, q.w1 - s.w1, q.w2 - s.w2)
    }
    return {
      t: this.o.t, theta1: s.th1, theta2: s.th2, omega1: s.w1, omega2: s.w2, theta1w: wrapPi(s.th1), x1, y1, x: x2, y: y2, vx, vy,
      ke: e.ke, pe: e.pe, e: e.total, px: P.m1 * vx1 + P.m2 * vx, py: P.m1 * vy1 + P.m2 * vy, twin_theta1: tw1, sep,
    }
  }

  bounds(): Bounds {
    const P = this.P()
    const R = P.L1 + P.L2
    return { x0: -R * 1.15, x1: R * 1.15, y0: -R * 1.15, y1: R * 1.15 }
  }

  frame(): Frame {
    const P = this.P()
    const shapes: Shape[] = []
    const bodies: Frame['bodies'] = []
    const R = P.L1 + P.L2
    shapes.push({ t: 'circle', x: 0, y: 0, r: R * 0.012, fill: COLORS.rod })
    const draw = (c: number, alpha: number, c1: string, c2: string, id: string) => {
      const s = this.st(c)
      const x1 = P.L1 * Math.sin(s.th1)
      const y1 = -P.L1 * Math.cos(s.th1)
      const x2 = x1 + P.L2 * Math.sin(s.th2)
      const y2 = y1 - P.L2 * Math.cos(s.th2)
      shapes.push({ t: 'line', x1: 0, y1: 0, x2: x1, y2: y1, color: c1, w: 2, dash: false })
      shapes.push({ t: 'line', x1, y1, x2, y2, color: c1, w: 2 })
      const r1 = R * 0.035 * Math.cbrt(P.m1)
      const r2 = R * 0.035 * Math.cbrt(P.m2)
      shapes.push({ t: 'circle', x: x1, y: y1, r: r1, fill: c1, alpha })
      shapes.push({ t: 'circle', x: x2, y: y2, r: r2, fill: c2, alpha })
      const [a1, a2] = doubleAcc(P, s.th1, s.th2, s.w1, s.w2)
      const vx1 = P.L1 * s.w1 * Math.cos(s.th1)
      const vy1 = P.L1 * s.w1 * Math.sin(s.th1)
      const ax1 = P.L1 * a1 * Math.cos(s.th1) - P.L1 * s.w1 * s.w1 * Math.sin(s.th1)
      const ay1 = P.L1 * a1 * Math.sin(s.th1) + P.L1 * s.w1 * s.w1 * Math.cos(s.th1)
      bodies.push({ id: `${id}1`, x: x1, y: y1, vx: vx1, vy: vy1, ax: ax1, ay: ay1, m: P.m1, r: r1, color: c1, trail: false })
      bodies.push({
        id: `${id}2`, x: x2, y: y2, vx: vx1 + P.L2 * s.w2 * Math.cos(s.th2), vy: vy1 + P.L2 * s.w2 * Math.sin(s.th2),
        ax: ax1 + P.L2 * a2 * Math.cos(s.th2) - P.L2 * s.w2 * s.w2 * Math.sin(s.th2), ay: ay1 + P.L2 * a2 * Math.sin(s.th2) + P.L2 * s.w2 * s.w2 * Math.cos(s.th2),
        m: P.m2, r: r2, color: c2,
      })
    }
    draw(0, 1, COLORS.a, COLORS.h, 'a')
    if (this.twin) draw(1, 0.55, COLORS.b, COLORS.g, 'b')
    return { shapes, bodies }
  }

  extra(): Record<string, number[][]> { return { poincare: this.pts } }

  private lambda(): number {
    const key = JSON.stringify([this.params.L1, this.params.L2, this.params.m1, this.params.m2, this.params.th1, this.params.th2, this.params.w1, this.params.w2, this.params.gravity, this.params.gcustom])
    if (!this.lyap || this.lyap.key !== key) this.lyap = { key, value: lyapunovDouble(this.params, 50) }
    return this.lyap.value
  }

  readouts(): Readout[] {
    const e = this.energy().total
    const s = this.sample()
    const lam = this.lambda()
    const out: Readout[] = [
      { label: 'Energy drift', value: `${fmt(Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)), 3)} (relative)`, tone: Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)) < 1e-3 ? 'ok' : 'warn' },
      { label: 'Lyapunov exponent λ', value: `${fmt(lam, 3)} 1/s`, theory: lam > 0.1 ? `e-folding ${fmt(1 / lam, 3)} s: chaotic` : 'regular motion', tone: 'info' },
    ]
    if (this.twin) {
      out.push({ label: 'Separation of the twins', value: fmt(s.sep, 4) })
      const eps = num(this.params, 'eps', 0.01) * DEG
      if (lam > 0.05) out.push({ label: 'Time to separate by 1 rad', value: `≈ ${fmt(Math.log(1 / eps) / lam, 3)} s` })
    }
    out.push({ label: 'Poincaré points', value: String(this.pts.length) })
    return out
  }
}

// ------------------------------------------------------------------------------------------ definition

export const PENDULUM: SceneDef = {
  id: 'pendulum',
  name: 'Pendulums',
  blurb: 'Simple, damped, driven, double and physical pendulums.',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, MODES.some((m) => m.id === mode) ? mode : 'simple', OVERRIDES[mode] ?? {}),
  presets: (mode): Preset[] => {
    switch (mode) {
      case 'simple': return [
        { name: 'Small swing (5°)', params: { theta0: 5 } }, { name: 'Large swing (90°)', params: { theta0: 90 } },
        { name: 'Almost upside down (170°)', params: { theta0: 170 } }, { name: 'On the Moon', params: { gravity: 'moon', theta0: 30 } },
      ]
      case 'damped': return [{ name: 'Light damping', params: { c: 0.2 } }, { name: 'Heavy damping', params: { c: 3 } }, { name: 'Critical (small angle)', params: { c: 6.26, theta0: 20 } }]
      case 'driven': return [
        { name: 'Below resonance', params: { Om: 1.5 } }, { name: 'At resonance', params: { Om: 3.13, c: 0.3, A: 0.5 } }, { name: 'Above resonance', params: { Om: 5 } },
        { name: 'Chaotic drive', params: { c: 0.5, A: 9.0, Om: 2.1, theta0: 0 } },
      ]
      case 'double': return [
        { name: 'Chaotic start', params: { th1: 120, th2: -10 } }, { name: 'Small angles (regular)', params: { th1: 8, th2: 5 } },
        { name: 'Both horizontal', params: { th1: 90, th2: 90 } }, { name: 'Light upper bob', params: { m1: 0.2, m2: 2, th1: 100, th2: 100 } },
      ]
      default: return [{ name: 'Rod about its end', params: { shape: 'rod', pivot: 0.5 } }, { name: 'Rod at the best pivot', params: { shape: 'rod', pivot: 0.2887 } }, { name: 'Ring on a nail', params: { shape: 'ring', size: 0.5, pivot: 0.5 } }]
    }
  },
  create: (params, method = 'rk4') => (str(params, 'mode', 'simple') === 'double' ? new DoublePendulumSim(params, method) : new SinglePendulumSim(params, method)),
  sweep: (params, method = 'rk4') => pendulumSweep(params, method),
}
