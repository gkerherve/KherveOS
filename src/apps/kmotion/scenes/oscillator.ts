// Scene 3 — oscillators: spring–mass in the three damping regimes, coupled oscillators and their normal modes,
// the driven oscillator (resonance, phase), the Atwood machine and a body on an inclined plane with static and
// kinetic friction (sliding blocks and rolling rings, cylinders and spheres).

import { dampingRegime, eigenSym, linearOscillator, measureDriven, steadyResponse } from '../closed.ts'
import { Ode2, type Method, type System2 } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import { COLORS, DEG, PALETTE, clamp, defaultsFor, energyPlot, fmt, num, str, timePlot, xyPlot } from '../common.ts'
import { GRAVITY_CHOICES, gravityOf } from './projectile.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Sweep, Preset } from '../types.ts'

const MODES = [
  { id: 'spring', label: 'Spring–mass', blurb: 'Free oscillation with damping: underdamped, critical or overdamped.' },
  { id: 'coupled', label: 'Coupled oscillators', blurb: 'Several masses or pendulums joined by springs; normal modes and beats.' },
  { id: 'driven', label: 'Driven oscillator', blurb: 'A periodic force: transient, steady state, resonance and phase.' },
  { id: 'atwood', label: 'Atwood machine', blurb: 'Two masses over a pulley, with or without the pulley\'s inertia.' },
  { id: 'incline', label: 'Inclined plane', blurb: 'Static and kinetic friction; blocks slide, rings, cylinders and spheres roll.' },
]

const PARAMS: ParamDef[] = [
  // spring / driven
  { kind: 'number', key: 'm', label: 'Mass', unit: 'kg', min: 0.1, max: 20, step: 0.1, scale: 'log', value: 1, modes: ['spring', 'driven', 'coupled'] },
  { kind: 'number', key: 'k', label: 'Spring constant', unit: 'N/m', min: 1, max: 400, step: 1, scale: 'log', value: 20, modes: ['spring', 'driven', 'coupled'], live: true },
  { kind: 'number', key: 'c', label: 'Damping c', unit: 'N·s/m', min: 0, max: 40, step: 0.05, value: 1, modes: ['spring', 'driven'], live: true, hint: 'Critical damping at c = 2√(k m).' },
  { kind: 'number', key: 'x0', label: 'Initial displacement', unit: 'm', min: -2, max: 2, step: 0.05, value: 1, modes: ['spring', 'driven'] },
  { kind: 'number', key: 'v0', label: 'Initial velocity', unit: 'm/s', min: -8, max: 8, step: 0.1, value: 0, modes: ['spring', 'driven'] },
  { kind: 'number', key: 'F0', label: 'Drive force F₀', unit: 'N', min: 0, max: 50, step: 0.1, value: 4, modes: ['driven'], live: true },
  { kind: 'number', key: 'Om', label: 'Drive frequency Ω', unit: 'rad/s', min: 0.2, max: 20, step: 0.01, value: 3, modes: ['driven'], live: true },
  // coupled
  { kind: 'number', key: 'N', label: 'Number of masses', min: 2, max: 6, step: 1, value: 2, modes: ['coupled'] },
  { kind: 'choice', key: 'form', label: 'Made of', options: [{ value: 'springs', label: 'Masses on springs' }, { value: 'pendulums', label: 'Coupled pendulums' }], value: 'springs', modes: ['coupled'] },
  { kind: 'number', key: 'L', label: 'Pendulum length', unit: 'm', min: 0.2, max: 3, step: 0.05, value: 1, modes: ['coupled'], when: (p) => p.form === 'pendulums' },
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth', modes: ['coupled', 'atwood', 'incline'], live: true },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0.1, max: 100, step: 0.1, value: 9.81, live: true, modes: ['coupled', 'atwood', 'incline'], when: (p) => p.gravity === 'custom' },
  { kind: 'number', key: 'kc', label: 'Coupling spring', unit: 'N/m', min: 0, max: 200, step: 0.5, value: 4, modes: ['coupled'], live: true },
  { kind: 'number', key: 'cc', label: 'Damping per mass', unit: '1/s', min: 0, max: 2, step: 0.01, value: 0, modes: ['coupled'], live: true },
  {
    kind: 'choice', key: 'init', label: 'Start', value: 'pluck', modes: ['coupled'],
    options: [{ value: 'pluck', label: 'Pull the first mass' }, { value: 'mode1', label: 'Normal mode 1 (in step)' }, { value: 'mode2', label: 'Normal mode 2' }, { value: 'mode3', label: 'Normal mode 3' }, { value: 'last', label: 'Highest mode (alternating)' }],
  },
  { kind: 'number', key: 'a0', label: 'Amplitude', unit: 'm', min: 0.05, max: 1, step: 0.05, value: 0.5, modes: ['coupled'] },
  // atwood
  { kind: 'number', key: 'm1', label: 'Mass 1 (left)', unit: 'kg', min: 0.1, max: 20, step: 0.05, value: 3, modes: ['atwood'] },
  { kind: 'number', key: 'm2', label: 'Mass 2 (right)', unit: 'kg', min: 0.1, max: 20, step: 0.05, value: 2, modes: ['atwood'] },
  { kind: 'number', key: 'M', label: 'Pulley mass (0 = ideal)', unit: 'kg', min: 0, max: 20, step: 0.1, value: 0, modes: ['atwood'], hint: 'A solid disc: I = ½ M R², which adds M/2 to the inertia.' },
  { kind: 'number', key: 'v0a', label: 'Initial speed of mass 1 (down)', unit: 'm/s', min: -3, max: 3, step: 0.05, value: 0, modes: ['atwood'] },
  // incline
  { kind: 'number', key: 'theta', label: 'Incline angle', unit: '°', min: 0, max: 80, step: 0.5, value: 30, modes: ['incline'], live: true },
  { kind: 'number', key: 'mus', label: 'Static friction μs', min: 0, max: 1.5, step: 0.01, value: 0.6, modes: ['incline'] },
  { kind: 'number', key: 'muk', label: 'Kinetic friction μk', min: 0, max: 1.5, step: 0.01, value: 0.4, modes: ['incline'] },
  { kind: 'number', key: 'slen', label: 'Length of the incline', unit: 'm', min: 1, max: 20, step: 0.5, value: 6, modes: ['incline'] },
  { kind: 'number', key: 'mi', label: 'Mass', unit: 'kg', min: 0.1, max: 50, step: 0.1, value: 2, modes: ['incline'] },
  { kind: 'number', key: 'v0i', label: 'Initial speed down the slope', unit: 'm/s', min: -6, max: 6, step: 0.1, value: 0, modes: ['incline'], when: (p) => p.object === 'block' },
  {
    kind: 'choice', key: 'object', label: 'Object', value: 'block', modes: ['incline'],
    options: [{ value: 'block', label: 'Block (slides)' }, { value: 'ring', label: 'Ring / hoop' }, { value: 'disc', label: 'Solid cylinder' }, { value: 'shell', label: 'Hollow sphere' }, { value: 'sphere', label: 'Solid sphere' }, { value: 'race', label: 'Race: all five' }],
  },
]

const OVERRIDES: Record<string, Params> = {
  spring: {},
  driven: { c: 0.8, x0: 0, v0: 0 },
  coupled: {},
  atwood: {},
  incline: {},
}

// ------------------------------------------------------------------------------------------ spring-mass and driven

const SPRING_CHANNELS: Channel[] = [
  { key: 't', label: 'time', unit: 's' }, { key: 'x', label: 'x', unit: 'm' }, { key: 'v', label: 'v', unit: 'm/s' }, { key: 'a', label: 'a', unit: 'm/s²' },
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'spring energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' }, { key: 'p', label: 'momentum', unit: 'kg·m/s' },
  { key: 'fk', label: 'F(t)/k', unit: 'm' },
  { key: 'x_th', label: 'x (closed form)', unit: 'm', analytic: true }, { key: 'env', label: 'envelope', unit: 'm', analytic: true }, { key: 'env_neg', label: '−envelope', unit: 'm', analytic: true },
]

class SpringSim extends SimBase {
  readonly scene = 'oscillator' as const
  readonly mode: string
  channels = SPRING_CHANNELS
  plots: PlotSpec[]
  o: Ode2
  private heat = 0
  private readonly x0: number
  private readonly v0: number
  private peak = 0
  private peakWin = 0
  private peakNow = 0

  constructor(params: Params, method: Method) {
    super(params, method)
    this.mode = str(params, 'mode', 'spring')
    this.x0 = num(params, 'x0', 1)
    this.v0 = num(params, 'v0', 0)
    this.conservative = this.mode === 'spring' && num(params, 'c', 0) === 0
    this.o = new Ode2(
      {
        n: 1,
        vdep: true,
        acc: (t, y, a) => {
          a[0] = -(this.k() / this.m()) * y[0] - (this.c() / this.m()) * y[1] + this.force(t) / this.m()
        },
      },
      [this.x0, this.v0],
      method,
    )
    const driven = this.mode === 'driven'
    this.plots = [
      timePlot('x', 'x(t)', driven
        ? [{ key: 'x', label: 'simulation' }, { key: 'x_th', label: 'closed form', dash: true }, { key: 'fk', label: 'F(t)/k', dash: true }]
        : [{ key: 'x', label: 'simulation' }, { key: 'x_th', label: 'closed form', dash: true }, { key: 'env', label: 'envelope', dash: true }, { key: 'env_neg', label: '', dash: true }], 'x (m)'),
      timePlot('v', 'v(t)', [{ key: 'v' }], 'velocity (m/s)'),
      timePlot('a', 'a(t)', [{ key: 'a' }], 'acceleration (m/s²)'),
      xyPlot('phase', 'Phase portrait', 'x', [{ key: 'v' }], 'x (m)', 'v (m/s)'),
      energyPlot(),
      timePlot('p', 'Momentum', [{ key: 'p' }], 'momentum (kg·m/s)'),
    ]
    this.dt = 1 / 480
    this.sampleDt = 0.02
  }

  private m() { return num(this.params, 'm', 1) }
  private k() { return num(this.params, 'k', 20) }
  private c() { return num(this.params, 'c', 0) }
  private F0() { return this.mode === 'driven' ? num(this.params, 'F0', 0) : 0 }
  private Om() { return num(this.params, 'Om', 3) }
  private force(t: number) { return this.F0() * Math.cos(this.Om() * t) }

  step(dt: number) {
    this.o.method = this.method
    this.o.advance(dt)
    this.t = this.o.t
    // heat = the work done against the damping force, c v² dt
    this.heat += this.c() * this.o.y[1] * this.o.y[1] * dt
    this.peakNow = Math.max(this.peakNow, Math.abs(this.o.y[0]))
    const win = this.mode === 'driven' ? (2 * Math.PI) / this.Om() : (2 * Math.PI) / Math.sqrt(this.k() / this.m())
    if (this.t - this.peakWin >= win) {
      this.peak = this.peakNow
      this.peakNow = 0
      this.peakWin = this.t
    }
  }

  private theory(t: number) {
    return linearOscillator(this.k() / this.m(), this.c() / this.m(), this.F0() / this.m(), this.Om(), this.x0, this.v0, t)
  }

  private envelope(t: number): number {
    if (this.mode === 'driven') return NaN
    const w2 = this.k() / this.m()
    const al = this.c() / this.m() / 2
    if (al <= 0 || al * al >= w2) return al <= 0 ? Math.hypot(this.x0, this.v0 / Math.sqrt(w2)) : NaN
    const wd = Math.sqrt(w2 - al * al)
    return Math.hypot(this.x0, (this.v0 + al * this.x0) / wd) * Math.exp(-al * t)
  }

  energy(): Energy {
    const [x, v] = [this.o.y[0], this.o.y[1]]
    const ke = 0.5 * this.m() * v * v
    const pe = 0.5 * this.k() * x * x
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const [x, v] = [this.o.y[0], this.o.y[1]]
    const a = new Float64Array(1)
    this.o.accel(a)
    const e = this.energy()
    const env = this.envelope(this.o.t)
    return {
      t: this.o.t, x, v, a: a[0], ke: e.ke, pe: e.pe, e: e.total, p: this.m() * v, fk: this.force(this.o.t) / this.k(),
      x_th: this.theory(this.o.t).x, env, env_neg: -env,
    }
  }

  bounds(): Bounds {
    const A = Math.max(Math.abs(this.x0), 0.5, this.mode === 'driven' ? steadyResponse(this.k() / this.m(), this.c() / this.m(), this.F0() / this.m(), this.Om()).amp * 1.2 : 0)
    const span = Math.min(A, 6)
    return { x0: -(span + 2.2), x1: span + 1.6, y0: -1.1, y1: 1.1 }
  }

  frame(): Frame {
    const x = this.o.y[0]
    const A = Math.max(Math.abs(this.x0), 0.5)
    const wall = -(Math.min(A, 6) + 1.8)
    const w = 0.5
    const shapes: Shape[] = [
      { t: 'rect', x: wall - 0.15, y: -0.6, w: 0.15, h: 1.2, fill: COLORS.fixed },
      { t: 'ground', y: -0.25, x1: wall - 0.15, x2: -wall + 1 },
      { t: 'line', x1: 0, y1: -0.6, x2: 0, y2: 0.6, color: COLORS.rod, dash: true, w: 1 },
      { t: 'spring', x1: wall, y1: 0.0, x2: x - w / 2, y2: 0.0, coils: 12, amp: 0.16, color: COLORS.b },
      { t: 'rect', x: x - w / 2, y: -0.25, w, h: 0.5, fill: COLORS.a, stroke: COLORS.a },
    ]
    if (this.mode === 'driven') {
      const fx = this.force(this.o.t) / Math.max(this.k(), 1e-9)
      shapes.push({ t: 'arrow', x1: x + w / 2, y1: 0, x2: x + w / 2 + fx * 1.2, y2: 0, color: COLORS.f, w: 3, label: 'F' })
    }
    const a = new Float64Array(1)
    this.o.accel(a)
    return { shapes, bodies: [{ id: 'block', x, y: 0, vx: this.o.y[1], vy: 0, ax: a[0], ay: 0, m: this.m(), color: COLORS.a, r: 0.25, trail: false }] }
  }

  readouts(): Readout[] {
    const m = this.m()
    const k = this.k()
    const c = this.c()
    const w2 = k / m
    const w0 = Math.sqrt(w2)
    const out: Readout[] = []
    const reg = dampingRegime(w2, c / m)
    const zeta = c / (2 * Math.sqrt(k * m))
    out.push({ label: 'ω₀ = √(k/m)', value: `${fmt(w0)} rad/s`, theory: `f = ${fmt(w0 / (2 * Math.PI))} Hz, T = ${fmt((2 * Math.PI) / w0)} s` })
    out.push({ label: 'Damping ratio ζ', value: fmt(zeta, 4), theory: `critical c = ${fmt(2 * Math.sqrt(k * m), 4)} N·s/m` })
    out.push({ label: 'Regime', value: reg === 'under' ? 'underdamped (oscillates)' : reg === 'over' ? 'overdamped (creeps back)' : reg === 'critical' ? 'critically damped (fastest return)' : 'undamped', tone: 'info' })
    if (reg === 'under') {
      const wd = Math.sqrt(w2 - (c / m / 2) ** 2)
      out.push({ label: 'Damped frequency ω_d', value: `${fmt(wd)} rad/s` })
      out.push({ label: 'Envelope decay time 2m/c', value: `${fmt((2 * m) / c)} s`, theory: `Q = ${fmt(w0 / (c / m))}` })
      out.push({ label: 'Log decrement δ', value: fmt((2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta), 4) })
    }
    if (this.mode === 'driven') {
      const r = steadyResponse(w2, c / m, this.F0() / m, this.Om())
      out.push({ label: 'Steady amplitude', value: `${fmt(this.peak)} m`, theory: `${fmt(r.amp)} m` })
      out.push({ label: 'Phase lag (x behind F)', value: `${fmt(r.phase / DEG, 3)}°`, theory: `Ω/ω₀ = ${fmt(this.Om() / w0)}` })
      const wr2 = w2 - 2 * (c / m / 2) ** 2
      out.push({ label: 'Amplitude resonance at', value: wr2 > 0 ? `${fmt(Math.sqrt(wr2))} rad/s` : 'none (overdamped)' })
    }
    const e = this.energy().total
    out.push({ label: 'Energy', value: `${fmt(e)} J`, theory: this.mode === 'spring' ? `lost to damping: ${fmt(this.heat)} J` : undefined })
    return out
  }
}

/** Measured resonance curve of the driven linear oscillator, started in the steady state (so the integrator is what is tested). */
export function oscillatorSweep(p: Params, method: Method = 'rk4'): Sweep | null {
  if (str(p, 'mode', 'driven') !== 'driven') return null
  const m = num(p, 'm', 1)
  const k = num(p, 'k', 20)
  const c = num(p, 'c', 0.8)
  const F0 = num(p, 'F0', 4)
  const w2 = k / m
  const w0 = Math.sqrt(w2)
  const n = 40
  const x: number[] = []
  const measured: number[] = []
  const theory: number[] = []
  const phase: number[] = []
  const phaseTheory: number[] = []
  for (let i = 0; i < n; i++) {
    const Om = w0 * (0.2 + (1.8 * i) / (n - 1))
    const A = F0 / m
    const r = steadyResponse(w2, c / m, A, Om)
    // start on the steady-state orbit: x(t) = amp cos(Om t - phase)
    const y0 = [r.amp * Math.cos(-r.phase), -r.amp * Om * Math.sin(-r.phase)]
    const sys: System2 = { n: 1, vdep: true, acc: (t, y, a) => { a[0] = -w2 * y[0] - (c / m) * y[1] + A * Math.cos(Om * t) } }
    const ms = measureDriven(sys, Om, y0, 0, 2, 6, method, 240)
    x.push(Om)
    measured.push(ms.amp)
    theory.push(r.amp)
    phase.push(ms.phase / DEG)
    phaseTheory.push(r.phase / DEG)
  }
  return { title: 'Resonance curve', xLabel: 'drive frequency Ω (rad/s)', yLabel: 'amplitude (m)', x, measured, theory, phase, phaseTheory, mark: num(p, 'Om', 3) }
}

// ------------------------------------------------------------------------------------------ coupled oscillators

export interface CoupledModes {
  /** Angular frequencies of the normal modes, ascending. */
  omegas: number[]
  /** Unit mode shapes (one array per mode). */
  shapes: number[][]
  K: number[][]
}

/** Stiffness matrix of the ladder: each mass k_self to its anchor, kc to each neighbour; and its normal modes (per mass m). */
export function coupledModes(N: number, m: number, kSelf: number, kc: number): CoupledModes {
  const K: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0))
  for (let i = 0; i < N; i++) {
    const nb = (i > 0 ? 1 : 0) + (i < N - 1 ? 1 : 0)
    K[i][i] = kSelf + nb * kc
    if (i > 0) K[i][i - 1] = -kc
    if (i < N - 1) K[i][i + 1] = -kc
  }
  const e = eigenSym(K)
  return { omegas: e.values.map((l) => Math.sqrt(Math.max(l, 0) / m)), shapes: e.vectors, K }
}

const MAXN = 6
const COUPLED_CHANNELS: Channel[] = [
  { key: 't', label: 'time', unit: 's' },
  ...Array.from({ length: MAXN }, (_, i) => ({ key: `x${i + 1}`, label: `x${i + 1}`, unit: 'm' })),
  ...Array.from({ length: MAXN }, (_, i) => ({ key: `q${i + 1}`, label: `mode ${i + 1} amplitude`, unit: 'm' })),
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
  { key: 'p', label: 'total momentum', unit: 'kg·m/s' },
  { key: 'x1_th', label: 'x1 (modes)', unit: 'm', analytic: true }, { key: 'x2_th', label: 'x2 (modes)', unit: 'm', analytic: true },
]

class CoupledSim extends SimBase {
  readonly scene = 'oscillator' as const
  readonly mode = 'coupled'
  channels = COUPLED_CHANNELS
  plots: PlotSpec[]
  o: Ode2
  readonly N: number
  readonly modes: CoupledModes
  private readonly x0: number[]
  private readonly pendulum: boolean
  private readonly mm: number

  constructor(params: Params, method: Method) {
    super(params, method)
    this.N = Math.round(clamp(num(params, 'N', 2), 2, MAXN))
    this.pendulum = str(params, 'form', 'springs') === 'pendulums'
    this.mm = num(params, 'm', 1)
    const kSelf = this.pendulum ? (this.mm * gravityOf(params)) / num(params, 'L', 1) : num(params, 'k', 20)
    this.modes = coupledModes(this.N, this.mm, kSelf, num(params, 'kc', 4))
    const a0 = num(params, 'a0', 0.5)
    const init = str(params, 'init', 'pluck')
    let x0: number[]
    if (init === 'pluck') x0 = Array.from({ length: this.N }, (_, i) => (i === 0 ? a0 : 0))
    else {
      const idx = init === 'last' ? this.N - 1 : clamp(Number(init.slice(4)) - 1, 0, this.N - 1)
      x0 = this.modes.shapes[idx].map((s) => s * a0 * Math.sqrt(this.N / 2))
    }
    this.x0 = x0
    this.conservative = num(params, 'cc', 0) === 0
    const N = this.N
    this.o = new Ode2(
      {
        n: N,
        vdep: true,
        acc: (_t, y, a) => {
          const K = this.stiffness()
          const cc = num(this.params, 'cc', 0)
          for (let i = 0; i < N; i++) {
            let f = 0
            for (let j = 0; j < N; j++) f += K[i][j] * y[j]
            a[i] = -f / this.mm - cc * y[N + i]
          }
        },
      },
      [...x0, ...new Array<number>(N).fill(0)],
      method,
    )
    this.plots = [
      timePlot('x', 'Displacements', [...Array.from({ length: N }, (_, i) => ({ key: `x${i + 1}`, label: `mass ${i + 1}` })), { key: 'x1_th', label: 'mass 1, normal-mode sum', dash: true }], 'x (m)'),
      timePlot('q', 'Normal-mode amplitudes', Array.from({ length: N }, (_, i) => ({ key: `q${i + 1}`, label: `mode ${i + 1}  ω = ${fmt(this.modes.omegas[i], 3)} rad/s` })), 'q (m)'),
      energyPlot(),
      timePlot('p', 'Total momentum', [{ key: 'p' }], 'momentum (kg·m/s)'),
    ]
    this.dt = 1 / 400
    this.sampleDt = 0.02
  }

  private stiffness(): number[][] {
    const kSelf = this.pendulum ? (this.mm * gravityOf(this.params)) / num(this.params, 'L', 1) : num(this.params, 'k', 20)
    return coupledModes(this.N, this.mm, kSelf, num(this.params, 'kc', 4)).K
  }

  step(dt: number) {
    this.o.method = this.method
    this.o.advance(dt)
    this.t = this.o.t
  }

  energy(): Energy {
    const N = this.N
    const K = this.stiffness()
    let ke = 0
    let pe = 0
    for (let i = 0; i < N; i++) {
      ke += 0.5 * this.mm * this.o.y[N + i] ** 2
      for (let j = 0; j < N; j++) pe += 0.5 * K[i][j] * this.o.y[i] * this.o.y[j]
    }
    return { ke, pe, total: ke + pe }
  }

  private theory(t: number): number[] {
    const N = this.N
    const out = new Array<number>(N).fill(0)
    const cc = num(this.params, 'cc', 0)
    for (let n = 0; n < N; n++) {
      const sh = this.modes.shapes[n]
      const q0 = sh.reduce((s, v, i) => s + v * this.x0[i], 0)
      const w2 = this.modes.omegas[n] ** 2
      const q = linearOscillator(w2, cc, 0, 0, q0, 0, t).x
      for (let i = 0; i < N; i++) out[i] += sh[i] * q
    }
    return out
  }

  sample(): Record<string, number> {
    const N = this.N
    const e = this.energy()
    const s: Record<string, number> = { t: this.o.t }
    for (let i = 0; i < MAXN; i++) s[`x${i + 1}`] = i < N ? this.o.y[i] : NaN
    for (let n = 0; n < MAXN; n++) s[`q${n + 1}`] = n < N ? this.modes.shapes[n].reduce((acc, v, i) => acc + v * this.o.y[i], 0) : NaN
    const th = this.theory(this.o.t)
    s.x1_th = th[0]
    s.x2_th = th[1]
    s.ke = e.ke
    s.pe = e.pe
    s.e = e.total
    let p = 0
    for (let i = 0; i < N; i++) p += this.mm * this.o.y[N + i]
    s.p = p
    return s
  }

  bounds(): Bounds {
    const N = this.N
    const a = Math.max(num(this.params, 'a0', 0.5) * 1.5, 0.5)
    return { x0: -a - 0.8, x1: (N - 1) * 1.6 + a + 0.8, y0: -1.7, y1: 1.2 }
  }

  frame(): Frame {
    const N = this.N
    const sp = 1.6
    const shapes: Shape[] = []
    const bodies: Frame['bodies'] = []
    const acc = new Float64Array(N)
    this.o.accel(acc)
    shapes.push({ t: 'rect', x: -1.2, y: 0.95, w: (N - 1) * sp + 2.4, h: 0.1, fill: COLORS.fixed })
    for (let i = 0; i < N; i++) {
      const x = i * sp + this.o.y[i]
      const col = PALETTE[i % PALETTE.length]
      if (this.pendulum) shapes.push({ t: 'line', x1: i * sp, y1: 0.95, x2: x, y2: -0.5, color: COLORS.rod, w: 1.5 })
      else shapes.push({ t: 'spring', x1: i * sp, y1: 0.95, x2: x, y2: 0.0, coils: 6, amp: 0.1, color: COLORS.rod })
      if (i < N - 1) {
        const xn = (i + 1) * sp + this.o.y[i + 1]
        shapes.push({ t: 'spring', x1: x + 0.18, y1: -0.5, x2: xn - 0.18, y2: -0.5, coils: 8, amp: 0.13, color: COLORS.b })
      }
      shapes.push({ t: 'circle', x, y: this.pendulum ? -0.5 : -0.2, r: 0.2, fill: col })
      shapes.push({ t: 'line', x1: i * sp, y1: -1.0, x2: i * sp, y2: -0.75, color: COLORS.fixed, dash: true, w: 1 })
      bodies.push({ id: `m${i}`, x, y: this.pendulum ? -0.5 : -0.2, vx: this.o.y[N + i], vy: 0, ax: acc[i], ay: 0, m: this.mm, color: col, r: 0.2, trail: false })
    }
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const out: Readout[] = []
    this.modes.omegas.forEach((w, i) => out.push({ label: `Mode ${i + 1}`, value: `ω = ${fmt(w, 4)} rad/s`, theory: `f = ${fmt(w / (2 * Math.PI), 4)} Hz, shape ${this.modes.shapes[i].map((v) => fmt(v, 2)).join(', ')}` }))
    if (this.N === 2) {
      const [w1, w2] = this.modes.omegas
      out.push({ label: 'Beat period 4π/(ω₂−ω₁)', value: `${fmt((4 * Math.PI) / (w2 - w1 || 1e-9))} s`, theory: 'when the first mass is pulled: energy swaps back and forth', tone: 'info' })
    }
    const e = this.energy().total
    out.push({ label: 'Total energy', value: `${fmt(e)} J` })
    return out
  }
}

// ------------------------------------------------------------------------------------------ Atwood machine

class AtwoodSim extends SimBase {
  readonly scene = 'oscillator' as const
  readonly mode = 'atwood'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'z1', label: 'height of mass 1', unit: 'm' }, { key: 'z2', label: 'height of mass 2', unit: 'm' },
    { key: 'v', label: 'speed of mass 1 (down)', unit: 'm/s' }, { key: 'a', label: 'acceleration', unit: 'm/s²' },
    { key: 'T1', label: 'tension left', unit: 'N' }, { key: 'T2', label: 'tension right', unit: 'N' }, { key: 'omega', label: 'pulley ω', unit: 'rad/s' },
    { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
    { key: 'p', label: 'momentum of the masses', unit: 'kg·m/s' },
    { key: 'z1_th', label: 'height 1 (closed form)', unit: 'm', analytic: true }, { key: 'v_th', label: 'speed (closed form)', unit: 'm/s', analytic: true },
  ]
  plots: PlotSpec[] = [
    timePlot('z', 'Heights', [{ key: 'z1', label: 'mass 1' }, { key: 'z2', label: 'mass 2' }, { key: 'z1_th', label: 'mass 1, closed form', dash: true }], 'height (m)'),
    timePlot('v', 'Speed', [{ key: 'v' }, { key: 'v_th', label: 'closed form', dash: true }], 'speed (m/s)'),
    timePlot('T', 'Tensions', [{ key: 'T1', label: 'left rope' }, { key: 'T2', label: 'right rope' }], 'tension (N)'),
    energyPlot(),
    timePlot('p', 'Momentum', [{ key: 'p' }], 'momentum (kg·m/s)'),
  ]
  o: Ode2
  private readonly z0 = 2.0
  private readonly top = 3.4
  private readonly floor = 0.15
  private readonly R = 0.25
  private stopped = false
  private phi = 0

  constructor(params: Params, method: Method) {
    super(params, method)
    this.conservative = true
    this.o = new Ode2({ n: 1, acc: (_t, _y, a) => { a[0] = this.accel() } }, [0, num(params, 'v0a', 0)], method)
    this.dt = 1 / 480
  }

  private g() { return gravityOf(this.params) }
  private m1() { return num(this.params, 'm1', 3) }
  private m2() { return num(this.params, 'm2', 2) }
  private M() { return num(this.params, 'M', 0) }
  accel() { return ((this.m1() - this.m2()) * this.g()) / (this.m1() + this.m2() + this.M() / 2) }

  step(dt: number) {
    if (this.stopped) return
    this.o.method = this.method
    this.o.advance(dt)
    // the lowest mass meets the floor, or the highest the pulley
    const lo = Math.min(this.z0 - this.o.y[0], this.z0 + this.o.y[0])
    const hi = Math.max(this.z0 - this.o.y[0], this.z0 + this.o.y[0])
    if (lo < this.floor || hi > this.top) {
      this.o.y[0] = clamp(this.o.y[0], -(this.top - this.z0), this.top - this.z0)
      this.o.y[0] = clamp(this.o.y[0], -(this.z0 - this.floor), this.z0 - this.floor)
      this.o.y[1] = 0
      this.stopped = true
      this.finished = true
      this.o.invalidate()
    }
    this.phi += (this.o.y[1] / this.R) * dt
    this.t = this.o.t
  }

  energy(): Energy {
    const v = this.o.y[1]
    const y = this.o.y[0]
    const ke = 0.5 * (this.m1() + this.m2() + this.M() / 2) * v * v
    const pe = this.g() * (this.m1() * (this.z0 - y) + this.m2() * (this.z0 + y))
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const a = this.stopped ? 0 : this.accel()
    const g = this.g()
    const e = this.energy()
    const y = this.o.y[0]
    const v = this.o.y[1]
    const aa = this.accel()
    return {
      t: this.o.t, z1: this.z0 - y, z2: this.z0 + y, v, a, T1: this.m1() * (g - a), T2: this.m2() * (g + a), omega: v / this.R,
      ke: e.ke, pe: e.pe, e: e.total, p: (this.m1() - this.m2()) * v,
      z1_th: this.stopped ? NaN : this.z0 - (num(this.params, 'v0a', 0) * this.o.t + 0.5 * aa * this.o.t ** 2), v_th: this.stopped ? NaN : num(this.params, 'v0a', 0) + aa * this.o.t,
    }
  }

  bounds(): Bounds { return { x0: -2.4, x1: 2.4, y0: -0.3, y1: 4.5 } }

  frame(): Frame {
    const y = this.o.y[0]
    const z1 = this.z0 - y
    const z2 = this.z0 + y
    const R = this.R
    const cx = 0
    const cy = 3.9
    const xL = -R - 0.0
    const xR = R
    const shapes: Shape[] = [
      { t: 'ground', y: 0, x1: -2.4, x2: 2.4 },
      { t: 'rect', x: -0.1, y: cy + R, w: 0.2, h: 0.5, fill: COLORS.fixed },
      { t: 'circle', x: cx, y: cy, r: R, fill: COLORS.rod, stroke: COLORS.rod, alpha: 0.35 },
      { t: 'line', x1: cx, y1: cy, x2: cx + R * Math.cos(this.phi), y2: cy - R * Math.sin(this.phi), color: COLORS.rod, w: 2 },
      { t: 'line', x1: xL, y1: cy, x2: xL, y2: z1 + 0.28, color: COLORS.rod, w: 1.5 },
      { t: 'line', x1: xR, y1: cy, x2: xR, y2: z2 + 0.28, color: COLORS.rod, w: 1.5 },
    ]
    const half = (m: number) => 0.18 + 0.05 * Math.cbrt(m)
    const h1 = half(this.m1())
    const h2 = half(this.m2())
    shapes.push({ t: 'rect', x: xL - h1, y: z1 - 0.28, w: 2 * h1, h: 0.56, fill: COLORS.a, stroke: COLORS.a })
    shapes.push({ t: 'text', x: xL, y: z1, text: `${fmt(this.m1(), 3)} kg`, color: '#0b0b0b', align: 'center' })
    shapes.push({ t: 'rect', x: xR - h2, y: z2 - 0.28, w: 2 * h2, h: 0.56, fill: COLORS.b, stroke: COLORS.b })
    shapes.push({ t: 'text', x: xR, y: z2, text: `${fmt(this.m2(), 3)} kg`, color: '#0b0b0b', align: 'center' })
    const a = this.stopped ? 0 : this.accel()
    const bodies = [
      { id: 'm1', x: xL, y: z1, vx: 0, vy: -this.o.y[1], ax: 0, ay: -a, m: this.m1(), color: COLORS.a, r: 0.2, trail: false },
      { id: 'm2', x: xR, y: z2, vx: 0, vy: this.o.y[1], ax: 0, ay: a, m: this.m2(), color: COLORS.b, r: 0.2, trail: false },
    ]
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const g = this.g()
    const a = this.accel()
    const ideal = ((this.m1() - this.m2()) * g) / (this.m1() + this.m2())
    return [
      { label: 'Acceleration', value: `${fmt(a)} m/s²`, theory: `ideal pulley: ${fmt(ideal)} m/s²` },
      { label: 'Tension in the left rope', value: `${fmt(this.m1() * (g - a))} N` },
      { label: 'Tension in the right rope', value: `${fmt(this.m2() * (g + a))} N`, theory: this.M() > 0 ? 'ropes differ: the pulley accelerates' : 'equal tensions for a massless pulley' },
      { label: 'Fraction of g', value: fmt(a / g), tone: 'info' },
      { label: 'Time to travel 1 m from rest', value: a !== 0 ? `${fmt(Math.sqrt(2 / Math.abs(a)))} s` : '∞' },
    ]
  }
}

// ------------------------------------------------------------------------------------------ inclined plane

export type RollKind = 'block' | 'ring' | 'disc' | 'shell' | 'sphere'
/** I / (m r²) of the rolling shapes. */
export const ROLL_KAPPA: Record<RollKind, number> = { block: NaN, ring: 1, disc: 1 / 2, shell: 2 / 3, sphere: 2 / 5 }
const RACE: RollKind[] = ['block', 'ring', 'disc', 'shell', 'sphere']
const ROLL_NAMES: Record<RollKind, string> = { block: 'block', ring: 'ring', disc: 'cylinder', shell: 'hollow sphere', sphere: 'solid sphere' }

export interface InclineLaw {
  /** Acceleration down the slope. */
  a: number
  /** True if the contact point does not slip (rolling) or the block holds (statics). */
  grips: boolean
  /** Friction force magnitude (up the slope). */
  friction: number
  /** Angular acceleration (rolling bodies), rad/s per radius... in units of a/r. */
  alphaR: number
}

/** The constant acceleration of an object released from rest on an incline, with the friction regime. */
export function inclineLaw(kind: RollKind, theta: number, mus: number, muk: number, g: number, m = 1): InclineLaw {
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  if (kind === 'block') {
    if (Math.tan(theta) <= mus + 1e-12) return { a: 0, grips: true, friction: m * g * s, alphaR: 0 }
    return { a: Math.max(0, g * (s - muk * c)), grips: false, friction: muk * m * g * c, alphaR: 0 }
  }
  const kap = ROLL_KAPPA[kind]
  const need = (m * g * s * kap) / (1 + kap)
  if (need <= mus * m * g * c + 1e-12) return { a: (g * s) / (1 + kap), grips: true, friction: need, alphaR: (g * s) / (1 + kap) }
  const a = g * (s - muk * c)
  return { a, grips: false, friction: muk * m * g * c, alphaR: (muk * g * c) / kap }
}

class Lane {
  s = 0
  v = 0
  phi = 0
  /** spin of a rolling body, rad/s */
  w = 0
  t = 0
  done = false
  tDone = NaN
  heat = 0
  readonly kind: RollKind
  constructor(kind: RollKind, v0: number) { this.kind = kind; this.v = kind === 'block' ? v0 : 0 }
}

class InclineSim extends SimBase {
  readonly scene = 'oscillator' as const
  readonly mode = 'incline'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 's', label: 'distance down the slope', unit: 'm' }, { key: 'v', label: 'speed', unit: 'm/s' }, { key: 'a', label: 'acceleration', unit: 'm/s²' },
    { key: 'omega', label: 'spin ω', unit: 'rad/s' }, { key: 'f', label: 'friction force', unit: 'N' }, { key: 'N', label: 'normal force', unit: 'N' },
    { key: 'ke', label: 'kinetic energy (total)', unit: 'J' }, { key: 'ke_rot', label: 'rotational KE', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
    { key: 'p', label: 'momentum along the slope', unit: 'kg·m/s' },
    { key: 's_th', label: 's (closed form)', unit: 'm', analytic: true }, { key: 's_free', label: 's (no friction)', unit: 'm', analytic: true },
  ]
  plots: PlotSpec[] = [
    timePlot('s', 's(t)', [{ key: 's' }, { key: 's_th', label: 'closed form', dash: true }, { key: 's_free', label: 'frictionless slide', dash: true }], 'distance (m)'),
    timePlot('v', 'v(t)', [{ key: 'v' }, { key: 'omega', label: 'ω (rad/s)' }], 'speed (m/s)'),
    timePlot('f', 'Forces', [{ key: 'f', label: 'friction' }, { key: 'N', label: 'normal' }], 'force (N)'),
    energyPlot(),
    timePlot('p', 'Momentum', [{ key: 'p' }], 'momentum (kg·m/s)'),
  ]
  readonly lanes: Lane[]
  private readonly r = 0.2

  constructor(params: Params, method: Method) {
    super(params, method)
    const obj = str(params, 'object', 'block')
    const v0 = num(params, 'v0i', 0)
    this.lanes = (obj === 'race' ? RACE : [obj as RollKind]).map((k) => new Lane(k, v0))
    this.methods = []
    this.dt = 1 / 480
  }

  private g() { return gravityOf(this.params) }
  private th() { return num(this.params, 'theta', 30) * DEG }
  private m() { return num(this.params, 'mi', 2) }
  private slen() { return num(this.params, 'slen', 6) }

  /** Moves a lane by dt with exact piecewise-constant accelerations (static / kinetic switching). */
  private advanceLane(l: Lane, dt: number) {
    if (l.done) return
    const th = this.th()
    const g = this.g()
    const mus = num(this.params, 'mus', 0.6)
    const muk = num(this.params, 'muk', 0.4)
    let rem = dt
    let guard = 0
    while (rem > 1e-15 && guard++ < 8) {
      let a: number
      if (l.kind === 'block') {
        if (Math.abs(l.v) < 1e-12) {
          l.v = 0
          a = Math.tan(th) <= mus ? 0 : Math.max(0, g * (Math.sin(th) - muk * Math.cos(th)))
          if (a === 0) break
        } else a = g * Math.sin(th) - Math.sign(l.v) * muk * g * Math.cos(th)
        if (l.v !== 0 && a * l.v < 0) {
          const tau = -l.v / a
          if (tau < rem) {
            l.s += l.v * tau + 0.5 * a * tau * tau
            l.heat += muk * this.m() * g * Math.cos(th) * Math.abs(l.v * tau + 0.5 * a * tau * tau)
            l.v = 0
            rem -= tau
            continue
          }
        }
        const ds = l.v * rem + 0.5 * a * rem * rem
        l.heat += muk * this.m() * g * Math.cos(th) * Math.abs(ds)
        l.s += ds
        l.v += a * rem
      } else {
        const law = inclineLaw(l.kind, th, mus, muk, g, this.m())
        a = law.a
        const ds = l.v * rem + 0.5 * a * rem * rem
        const wOld = l.w
        l.s += ds
        l.v += a * rem
        l.w = law.grips ? l.v / this.r : l.w + (law.alphaR / this.r) * rem
        l.phi += 0.5 * (wOld + l.w) * rem
      }
      rem = 0
    }
    l.t += dt
    if (l.s >= this.slen()) {
      l.tDone = l.v > 0 ? l.t - (l.s - this.slen()) / l.v : l.t
      l.s = this.slen()
      l.done = true
    }
  }

  step(dt: number) {
    for (const l of this.lanes) this.advanceLane(l, dt)
    this.t += dt
    // done when everything has reached the bottom or is a block that holds on the slope
    const holds = (l: Lane) => l.kind === 'block' && l.v === 0 && Math.tan(this.th()) <= num(this.params, 'mus', 0.6)
    if (this.lanes.every((l) => l.done || holds(l)) && (this.lanes.some((l) => l.done) || this.t > 6)) this.finished = true
  }

  private laneState(l: Lane) {
    const th = this.th()
    const g = this.g()
    const m = this.m()
    const mus = num(this.params, 'mus', 0.6)
    const muk = num(this.params, 'muk', 0.4)
    let a = 0
    let f = 0
    if (l.kind === 'block') {
      if (l.v === 0) {
        const holds = Math.tan(th) <= mus
        a = holds ? 0 : Math.max(0, g * (Math.sin(th) - muk * Math.cos(th)))
        f = holds ? m * g * Math.sin(th) : muk * m * g * Math.cos(th)
      } else {
        a = g * Math.sin(th) - Math.sign(l.v) * muk * g * Math.cos(th)
        f = muk * m * g * Math.cos(th)
      }
    } else {
      const law = inclineLaw(l.kind, th, mus, muk, g, m)
      a = l.done ? 0 : law.a
      f = law.friction
    }
    if (l.done) a = 0
    const kap = l.kind === 'block' ? 0 : ROLL_KAPPA[l.kind]
    const omega = l.kind === 'block' ? 0 : l.w
    const keTrans = 0.5 * m * l.v * l.v
    const keRot = l.kind === 'block' ? 0 : 0.5 * kap * m * this.r * this.r * omega * omega
    return { a, f, omega, keTrans, keRot, N: m * g * Math.cos(th) }
  }

  energy(): Energy {
    const l = this.lanes[0]
    const st = this.laneState(l)
    const pe = this.m() * this.g() * (this.slen() - l.s) * Math.sin(this.th())
    const ke = st.keTrans + st.keRot
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const l = this.lanes[0]
    const st = this.laneState(l)
    const e = this.energy()
    const th = this.th()
    const g = this.g()
    const law = l.kind === 'block' ? null : inclineLaw(l.kind, th, num(this.params, 'mus', 0.6), num(this.params, 'muk', 0.4), g, this.m())
    const aTh = l.kind === 'block' ? (Math.tan(th) <= num(this.params, 'mus', 0.6) ? 0 : g * (Math.sin(th) - num(this.params, 'muk', 0.4) * Math.cos(th))) : law!.a
    const v0 = l.kind === 'block' ? num(this.params, 'v0i', 0) : 0
    return {
      t: this.t, s: l.s, v: l.v, a: st.a, omega: st.omega, f: st.f, N: st.N, ke: e.ke, ke_rot: st.keRot, pe: e.pe, e: e.total, p: this.m() * l.v,
      s_th: Math.min(v0 * this.t + 0.5 * aTh * this.t * this.t, this.slen()), s_free: Math.min(0.5 * g * Math.sin(th) * this.t * this.t, this.slen()),
    }
  }

  bounds(): Bounds {
    const th = this.th()
    const L = this.slen()
    const n = this.lanes.length
    return { x0: -0.8, x1: L * Math.cos(th) + 1, y0: -0.4, y1: L * Math.sin(th) + 0.8 + (n - 1) * 1.4 }
  }

  frame(): Frame {
    const th = this.th()
    const L = this.slen()
    const shapes: Shape[] = []
    const bodies: Frame['bodies'] = []
    const dir = [Math.cos(th), -Math.sin(th)]
    const nrm = [Math.sin(th), Math.cos(th)]
    const n = this.lanes.length
    this.lanes.forEach((l, i) => {
      const oy = (n - 1 - i) * 1.4
      const top = [0, L * Math.sin(th) + oy]
      const bottom = [L * Math.cos(th), oy]
      shapes.push({ t: 'poly', pts: [top, bottom, [0, oy]], fill: COLORS.fixed, stroke: COLORS.rod, closed: true, alpha: 0.35 })
      shapes.push({ t: 'line', x1: top[0], y1: top[1], x2: bottom[0], y2: bottom[1], color: COLORS.rod, w: 2 })
      const r = this.r
      const st = this.laneState(l)
      const cx = top[0] + dir[0] * l.s + nrm[0] * r
      const cy = top[1] + dir[1] * l.s + nrm[1] * r
      const col = PALETTE[i % PALETTE.length]
      if (l.kind === 'block') {
        const hw = 0.28
        const hh = 0.18
        const c = [cx - nrm[0] * r + nrm[0] * hh, cy - nrm[1] * r + nrm[1] * hh]
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [c[0] + a * dir[0] + b * nrm[0], c[1] + a * dir[1] + b * nrm[1]])
        shapes.push({ t: 'poly', pts, fill: col, stroke: col, closed: true, alpha: 0.95 })
      } else {
        const filled = l.kind === 'disc' || l.kind === 'sphere'
        shapes.push({ t: 'circle', x: cx, y: cy, r, fill: col, stroke: col, alpha: filled ? 0.85 : 0.15, ring: !filled })
        const ang = -(l.phi)
        shapes.push({ t: 'line', x1: cx, y1: cy, x2: cx + r * Math.cos(ang + Math.atan2(dir[1], dir[0]) * 0), y2: cy + r * Math.sin(ang), color: filled ? '#0b0b0b' : col, w: 2 })
      }
      if (n > 1) shapes.push({ t: 'text', x: top[0] - 0.2, y: top[1] + 0.35, text: ROLL_NAMES[l.kind], color: col, align: 'left' })
      bodies.push({ id: `l${i}`, x: cx, y: cy, vx: dir[0] * l.v, vy: dir[1] * l.v, ax: dir[0] * st.a, ay: dir[1] * st.a, m: this.m(), color: col, r, trail: false })
    })
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const th = this.th()
    const g = this.g()
    const mus = num(this.params, 'mus', 0.6)
    const muk = num(this.params, 'muk', 0.4)
    const out: Readout[] = []
    out.push({ label: 'Angle of repose arctan μs', value: `${fmt(Math.atan(mus) / DEG, 3)}°`, theory: `slope ${fmt(th / DEG, 3)}°`, tone: th <= Math.atan(mus) ? 'ok' : 'warn' })
    const sl = this.slen()
    for (const l of this.lanes) {
      const law = inclineLaw(l.kind, th, mus, muk, g, this.m())
      const tTheory = l.kind === 'block' && num(this.params, 'v0i', 0) !== 0 ? NaN : law.a > 0 ? Math.sqrt((2 * sl) / law.a) : Infinity
      const name = ROLL_NAMES[l.kind]
      if (l.kind === 'block') {
        out.push({ label: 'Block', value: law.a === 0 && l.v === 0 ? (Math.tan(th) <= mus ? 'stays at rest (static friction holds)' : 'will not start') : `a = ${fmt(law.a)} m/s²  (g(sinθ − μk cosθ))`, theory: Number.isFinite(tTheory) ? `reaches the bottom at ${fmt(tTheory)} s` : undefined })
      } else {
        out.push({ label: `${name[0].toUpperCase()}${name.slice(1)}`, value: `a = ${fmt(law.a)} m/s² ${law.grips ? 'rolls without slipping' : 'slips while rolling'}`, theory: `closed form ${fmt(tTheory)} s${l.done ? ` · simulated ${fmt(l.tDone)} s` : ''}` })
      }
    }
    if (this.lanes.length === 1 && this.lanes[0].kind !== 'block') {
      const kap = ROLL_KAPPA[this.lanes[0].kind]
      out.push({ label: 'Needed μs to roll', value: fmt(Math.tan(th) * kap / (1 + kap), 4), theory: `a = g sinθ/(1+${fmt(kap, 3)})` })
    }
    return out
  }
}

// ------------------------------------------------------------------------------------------ definition

export const OSCILLATOR: SceneDef = {
  id: 'oscillator',
  name: 'Oscillators & friction',
  blurb: 'Spring–mass, coupled modes, driven resonance, Atwood machine and the inclined plane.',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, MODES.some((m) => m.id === mode) ? mode : 'spring', OVERRIDES[mode] ?? {}),
  presets: (mode): Preset[] => {
    switch (mode) {
      case 'spring': return [
        { name: 'Underdamped', params: { c: 1, k: 20, m: 1 } }, { name: 'Critically damped', params: { c: 8.944, k: 20, m: 1 } }, { name: 'Overdamped', params: { c: 20, k: 20, m: 1 } }, { name: 'No damping', params: { c: 0 } },
      ]
      case 'driven': return [
        { name: 'On resonance', params: { Om: 4.47, c: 0.8, F0: 4 } }, { name: 'Below resonance', params: { Om: 1.5 } }, { name: 'Above resonance', params: { Om: 8 } }, { name: 'Light damping (high Q)', params: { c: 0.2, Om: 4.4 } },
      ]
      case 'coupled': return [
        { name: 'Beats (pull one)', params: { init: 'pluck', kc: 2, N: 2 } }, { name: 'In-step mode', params: { init: 'mode1', N: 2 } }, { name: 'Opposite mode', params: { init: 'mode2', N: 2 } }, { name: 'Chain of five', params: { N: 5, init: 'mode2', kc: 10 } },
      ]
      case 'atwood': return [{ name: 'Light difference', params: { m1: 2.2, m2: 2, M: 0 } }, { name: 'With a heavy pulley', params: { m1: 3, m2: 2, M: 4 } }, { name: 'Equal masses', params: { m1: 2, m2: 2 } }]
      default: return [
        { name: 'Block, rough', params: { object: 'block', theta: 30, mus: 0.6, muk: 0.4 } }, { name: 'Block, sliding', params: { object: 'block', theta: 40, mus: 0.5, muk: 0.3 } },
        { name: 'Rolling race', params: { object: 'race', theta: 25, mus: 0.9, muk: 0.6 } }, { name: 'Icy slope (rolling slips)', params: { object: 'disc', theta: 40, mus: 0.1, muk: 0.05 } },
      ]
    }
  },
  create: (params, method = 'rk4') => {
    switch (str(params, 'mode', 'spring')) {
      case 'coupled': return new CoupledSim(params, method)
      case 'atwood': return new AtwoodSim(params, method)
      case 'incline': return new InclineSim(params, method)
      default: return new SpringSim(params, method)
    }
  },
  sweep: (params, method = 'rk4') => oscillatorSweep(params, method),
}
