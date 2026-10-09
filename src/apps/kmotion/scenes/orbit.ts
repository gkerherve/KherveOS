// Scene 5 — orbits and gravity: Kepler's two-body problem (conics, the three laws checked live), escape speed, a Hohmann
// transfer, a gravitational slingshot, the restricted three-body problem, the figure-eight solution, an N-body
// simulation (direct sum or Barnes–Hut) and the inner solar system from real orbital elements.

import { Ode2, type Method, type System2 } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import { COLORS, DEG, PALETTE, bool, clamp, defaultsFor, fmt, num, str, timePlot, xyPlot } from '../common.ts'
import {
  ARENSTORF, AUYR_KMS, FIGURE8, G_AU, PLANETS, circularSpeed, conicOf, conicPoints, cr3bpAcc, discGalaxy, escapeSpeed, gravitySystem, gravityTotals, hohmann,
  hyperbolaOf, hyperbolaStart, jacobi, lagrangePoints, plummerCluster, solveKepler, stateFromElements, toBarycentre, type GravityOptions,
} from '../gravity.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Preset } from '../types.ts'

const MODES = [
  { id: 'kepler', label: 'Kepler two-body', blurb: 'Conic sections about a star; the three laws verified live.' },
  { id: 'escape', label: 'Escape speed', blurb: 'Launch at a fraction of the escape speed: does it come back?' },
  { id: 'hohmann', label: 'Hohmann transfer', blurb: 'Earth to Mars with two burns.' },
  { id: 'slingshot', label: 'Gravity assist', blurb: 'A probe flies past a moving planet and steals some of its speed.' },
  { id: 'restricted3', label: 'Restricted 3-body', blurb: 'A test mass in the rotating frame of two primaries: Lagrange points and the Jacobi constant.' },
  { id: 'figure8', label: 'Figure-eight', blurb: 'Three equal masses chase each other along one eight-shaped orbit.' },
  { id: 'nbody', label: 'N-body', blurb: 'Up to 300 bodies: a disc galaxy or a star cluster; direct sum or Barnes–Hut.' },
  { id: 'solar', label: 'Inner solar system', blurb: 'Sun and planets from real orbital elements.' },
]

const PARAMS: ParamDef[] = [
  // kepler
  { kind: 'number', key: 'M', label: 'Central mass', unit: 'M☉', min: 0.1, max: 10, step: 0.05, scale: 'log', value: 1, modes: ['kepler', 'escape', 'hohmann'] },
  { kind: 'number', key: 'q', label: 'Mass ratio m/M', min: 0.0001, max: 1, step: 0.0001, scale: 'log', value: 0.001, modes: ['kepler'], hint: 'Near 1 you get a binary star: both bodies orbit their common centre.', digits: 4 },
  { kind: 'number', key: 'rp', label: 'Periapsis distance', unit: 'AU', min: 0.1, max: 5, step: 0.05, value: 1, modes: ['kepler'] },
  { kind: 'number', key: 'ecc', label: 'Eccentricity e', min: 0, max: 2.5, step: 0.01, value: 0.5, modes: ['kepler'], hint: '0 circle · <1 ellipse · 1 parabola · >1 hyperbola' },
  // escape
  { kind: 'number', key: 'r0', label: 'Launch distance', unit: 'AU', min: 0.2, max: 5, step: 0.05, value: 1, modes: ['escape'] },
  { kind: 'number', key: 'f', label: 'Speed / escape speed', min: 0.1, max: 1.6, step: 0.01, value: 0.9, modes: ['escape'], hint: 'Circular orbit: 0.707.' },
  { kind: 'number', key: 'launch', label: 'Direction (0° sideways, 90° straight up)', unit: '°', min: 0, max: 90, step: 1, value: 90, modes: ['escape'] },
  // hohmann
  { kind: 'number', key: 'r1', label: 'Departure orbit', unit: 'AU', min: 0.4, max: 3, step: 0.01, value: 1, modes: ['hohmann'] },
  { kind: 'number', key: 'r2', label: 'Arrival orbit', unit: 'AU', min: 0.4, max: 6, step: 0.01, value: 1.524, modes: ['hohmann'] },
  { kind: 'number', key: 'dv1', label: 'First burn, % of the ideal', unit: '%', min: 50, max: 150, step: 1, value: 100, modes: ['hohmann'] },
  { kind: 'bool', key: 'burn2', label: 'Second burn (circularise)', value: true, modes: ['hohmann'] },
  // slingshot
  { kind: 'number', key: 'pm', label: 'Planet mass', unit: 'M♃', min: 0.1, max: 10, step: 0.05, scale: 'log', value: 1, modes: ['slingshot'] },
  { kind: 'number', key: 'U', label: 'Planet speed', unit: 'AU/yr', min: 0.5, max: 6, step: 0.05, value: 2.76, modes: ['slingshot'], hint: 'Jupiter moves at 2.76 AU/yr (13.1 km/s).' },
  { kind: 'number', key: 'u', label: 'Probe speed (Sun frame)', unit: 'AU/yr', min: 0.2, max: 6, step: 0.05, value: 2, modes: ['slingshot'] },
  { kind: 'number', key: 'b', label: 'Impact parameter', unit: 'AU', min: 0.002, max: 0.1, step: 0.001, scale: 'log', value: 0.01, modes: ['slingshot'] },
  { kind: 'choice', key: 'side', label: 'Passes', value: 'behind', modes: ['slingshot'], options: [{ value: 'behind', label: 'behind the planet (gains speed)' }, { value: 'ahead', label: 'ahead of the planet (loses speed)' }] },
  { kind: 'choice', key: 'frame', label: 'View in the frame of', value: 'planet', modes: ['slingshot'], options: [{ value: 'planet', label: 'the planet' }, { value: 'sun', label: 'the Sun' }] },
  // restricted 3
  { kind: 'number', key: 'mu', label: 'Mass fraction μ of the smaller primary', min: 0.0001, max: 0.5, step: 0.0001, scale: 'log', value: 0.0121505856, modes: ['restricted3'], digits: 5, hint: 'Earth–Moon: 0.01215. Sun–Jupiter: 0.00095.' },
  {
    kind: 'choice', key: 'ic', label: 'Start', value: 'l4', modes: ['restricted3'],
    options: [{ value: 'arenstorf', label: 'Arenstorf periodic orbit' }, { value: 'l4', label: 'Near L4 (stable tadpole)' }, { value: 'l5', label: 'Near L5' }, { value: 'l1', label: 'Near L1 (unstable)' }, { value: 'l2', label: 'Near L2 (unstable)' }, { value: 'l3', label: 'Near L3' }, { value: 'custom', label: 'Custom' }],
  },
  { kind: 'number', key: 'off', label: 'Offset from the point', min: -0.2, max: 0.2, step: 0.005, value: -0.02, modes: ['restricted3'], when: (p) => String(p.ic).startsWith('l'), hint: 'L4 and L5: radial offset, as a fraction of the radius, on a circular orbit. L1–L3: displacement along the x axis.', digits: 3 },
  { kind: 'number', key: 'cx', label: 'x', min: -1.5, max: 1.5, step: 0.001, value: 0.5, modes: ['restricted3'], when: (p) => p.ic === 'custom' },
  { kind: 'number', key: 'cy', label: 'y', min: -1.5, max: 1.5, step: 0.001, value: 0.3, modes: ['restricted3'], when: (p) => p.ic === 'custom' },
  { kind: 'number', key: 'cvx', label: 'vx', min: -2, max: 2, step: 0.001, value: 0, modes: ['restricted3'], when: (p) => p.ic === 'custom' },
  { kind: 'number', key: 'cvy', label: 'vy', min: -2, max: 2, step: 0.001, value: 0.3, modes: ['restricted3'], when: (p) => p.ic === 'custom' },
  { kind: 'bool', key: 'inertial', label: 'Show the inertial frame', value: false, modes: ['restricted3'], live: true },
  // figure8
  { kind: 'number', key: 'perturb', label: 'Velocity perturbation', min: 0, max: 0.05, step: 0.0005, value: 0, modes: ['figure8'], hint: 'Scales the speeds by 1 + this: the orbit is unstable and slowly falls apart.', digits: 4 },
  // nbody
  { kind: 'choice', key: 'layout', label: 'System', value: 'disc', modes: ['nbody'], options: [{ value: 'disc', label: 'Disc galaxy' }, { value: 'cluster', label: 'Star cluster (Plummer)' }] },
  { kind: 'number', key: 'N', label: 'Bodies', min: 2, max: 300, step: 1, value: 120, modes: ['nbody'] },
  { kind: 'number', key: 'soft', label: 'Softening ε', min: 0.001, max: 0.2, step: 0.001, scale: 'log', value: 0.02, modes: ['nbody'], live: true, digits: 3 },
  { kind: 'bool', key: 'bh', label: 'Barnes–Hut tree', value: false, modes: ['nbody'], live: true },
  { kind: 'number', key: 'theta', label: 'Opening angle θ', min: 0.2, max: 1.2, step: 0.05, value: 0.5, modes: ['nbody'], live: true, when: (p) => p.bh === true },
  { kind: 'number', key: 'seed', label: 'Random seed', min: 1, max: 999, step: 1, value: 3, modes: ['nbody'] },
  // solar
  { kind: 'bool', key: 'outer', label: 'Add Jupiter and Saturn', value: false, modes: ['solar'] },
]

// ------------------------------------------------------------------------------------------ the common sim

interface BodyDef {
  name: string
  m: number
  color: string
  /** Drawn radius, world units. */
  size: number
  trail?: boolean
  /** Does not pull on the others (a spacecraft). */
  probe?: boolean
}

const BASE_CHANNELS: Channel[] = [
  { key: 't', label: 'time' },
  { key: 'ke', label: 'kinetic energy' }, { key: 'pe', label: 'potential energy' }, { key: 'e', label: 'total energy' },
  { key: 'px', label: 'px' }, { key: 'py', label: 'py' }, { key: 'pz', label: 'pz' }, { key: 'lz', label: 'angular momentum Lz' },
  { key: 'edrift', label: 'relative energy error' },
]

abstract class OrbitBase extends SimBase {
  readonly scene = 'orbit' as const
  abstract readonly mode: string
  abstract channels: Channel[]
  abstract plots: PlotSpec[]
  defs: BodyDef[]
  o: Ode2
  readonly masses: Float64Array
  opts: GravityOptions
  e0 = 0
  l0 = 0
  protected readonly N: number
  lengthUnit = 'AU'
  timeUnit = 'yr'
  conservative = true
  threeD = false

  constructor(params: Params, method: Method, defs: BodyDef[], y0: Float64Array, opts: GravityOptions) {
    super(params, method)
    this.defs = defs
    this.N = defs.length
    this.masses = Float64Array.from(defs.map((d) => d.m))
    this.opts = opts
    const sys: System2 = gravitySystem(this.masses, () => this.opts)
    this.o = new Ode2(sys, y0, method)
    this.o.rtol = 1e-10
    this.o.atol = 1e-13
    const t = this.totals()
    this.e0 = t.ke + t.pe
    this.l0 = t.lz
  }

  totals() { return gravityTotals(this.o.y, this.masses, this.opts) }

  step(dt: number) {
    this.o.method = this.method
    this.advance(dt)
    this.t = this.o.t
  }

  /** Overridable so a scene can split a step at an event. */
  protected advance(dt: number) { this.o.advance(dt) }

  energy(): Energy {
    const t = this.totals()
    return { ke: t.ke, pe: t.pe, total: t.ke + t.pe }
  }

  pos(i: number): [number, number, number] { const y = this.o.y; return [y[3 * i], y[3 * i + 1], y[3 * i + 2]] }
  vel(i: number): [number, number, number] { const y = this.o.y; const N = this.N; return [y[3 * N + 3 * i], y[3 * N + 3 * i + 1], y[3 * N + 3 * i + 2]] }

  protected baseSample(): Record<string, number> {
    const t = this.totals()
    const e = t.ke + t.pe
    return { t: this.o.t, ke: t.ke, pe: t.pe, e, px: t.px, py: t.py, pz: t.pz, lz: t.lz, edrift: Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)) }
  }

  /** Bodies for the overlays (and the 3-D view), with accelerations. */
  protected bodyInfos(shift: (i: number) => [number, number, number, number, number, number] = (i) => [...this.pos(i), ...this.vel(i)] as [number, number, number, number, number, number]) {
    const a = new Float64Array(3 * this.N)
    this.o.accel(a)
    const trailOk = this.N <= 16
    return this.defs.map((d, i) => {
      const [x, y, z, vx, vy, vz] = shift(i)
      return { id: `o${i}`, name: d.name, x, y, z, vx, vy, vz, ax: a[3 * i], ay: a[3 * i + 1], m: d.m, r: d.size, color: d.color, trail: (d.trail ?? trailOk) && (trailOk || i === 0 ? true : false) }
    })
  }

  protected bodyShapes(infos: ReturnType<OrbitBase['bodyInfos']>, labels = true): Shape[] {
    const out: Shape[] = []
    infos.forEach((b, i) => {
      out.push({ t: 'circle', x: b.x, y: b.y, r: b.r ?? 0.02, fill: b.color, stroke: '#0b0b0b' })
      if (labels && this.N <= 12 && this.defs[i].name) out.push({ t: 'text', x: b.x + (b.r ?? 0.02) * 1.4, y: b.y + (b.r ?? 0.02) * 1.4, text: this.defs[i].name, color: b.color })
    })
    return out
  }

  frame(): Frame {
    const infos = this.bodyInfos()
    return { shapes: this.bodyShapes(infos), bodies: infos }
  }

  bounds(): Bounds {
    let R = 0
    for (let i = 0; i < this.N; i++) { const p = this.pos(i); R = Math.max(R, Math.hypot(p[0], p[1])) }
    R = Math.max(R, 0.5) * 1.25
    return { x0: -R, x1: R, y0: -R, y1: R }
  }

  readouts(): Readout[] {
    const e = this.energy().total
    return [{ label: 'Energy drift', value: fmt(Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)), 3), tone: Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)) < 1e-4 ? 'ok' : 'warn' }]
  }
}

const STAR = '#fbbf24'

// ------------------------------------------------------------------------------------------ Kepler

class KeplerSim extends OrbitBase {
  readonly mode = 'kepler'
  channels: Channel[] = [
    ...BASE_CHANNELS,
    { key: 'x', label: 'x (relative)', unit: 'AU' }, { key: 'y', label: 'y (relative)', unit: 'AU' }, { key: 'r', label: 'separation r', unit: 'AU' }, { key: 'speed', label: 'relative speed', unit: 'AU/yr' },
    { key: 'areal', label: 'areal velocity dA/dt', unit: 'AU²/yr' },
    { key: 'x_th', label: 'x (Kepler equation)', unit: 'AU', analytic: true }, { key: 'y_th', label: 'y (Kepler equation)', unit: 'AU', analytic: true }, { key: 'r_th', label: 'r (Kepler equation)', unit: 'AU', analytic: true },
    { key: 'areal_th', label: 'dA/dt = h/2', unit: 'AU²/yr', analytic: true },
  ]
  plots: PlotSpec[] = [
    xyPlot('orbit', 'Orbit (relative)', 'x', [{ key: 'y', label: 'simulation' }, { key: 'y_th', label: 'Kepler equation', dash: true, x: 'x_th' }], 'x (AU)', 'y (AU)', true),
    timePlot('r', 'Distance r(t)', [{ key: 'r' }, { key: 'r_th', label: 'closed form', dash: true }], 'r (AU)', 'yr'),
    timePlot('speed', 'Speed v(t)', [{ key: 'speed' }], 'speed (AU/yr)', 'yr'),
    timePlot('areal', 'Areal velocity (Kepler II)', [{ key: 'areal' }, { key: 'areal_th', label: 'h/2', dash: true }], 'dA/dt (AU²/yr)', 'yr'),
    timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (M☉ AU²/yr²)', 'yr'),
    timePlot('lz', 'Angular momentum', [{ key: 'lz' }], 'Lz', 'yr'),
    timePlot('drift', 'Relative energy error', [{ key: 'edrift' }], '|ΔE/E|', 'yr'),
  ]
  private readonly mu: number
  private readonly Msun: number
  private readonly mm: number
  private readonly e: number
  private readonly rp: number
  private readonly T: number
  private readonly a: number
  private hist: number[][] = []
  private cross: number[] = []
  private prevY = 0
  private prevT = 0
  private sumAreal = 0
  private nAreal = 0

  constructor(params: Params, method: Method) {
    const M = num(params, 'M', 1)
    const q = num(params, 'q', 0.001)
    const m = M * q
    const e = num(params, 'ecc', 0.5)
    const rp = num(params, 'rp', 1)
    const mu = G_AU * (M + m)
    const vp = Math.sqrt((mu * (1 + e)) / rp)
    // body 0 = star, body 1 = planet, in the centre-of-mass frame
    const y0 = new Float64Array(12)
    const f1 = m / (M + m)
    const f2 = M / (M + m)
    y0[0] = -f1 * rp; y0[3] = f2 * rp
    y0[6 + 1] = -f1 * vp; y0[6 + 4] = f2 * vp
    const rEff = e < 1 ? rp / (1 - e) : rp
    super(params, method, [
      { name: 'star', m: M, color: STAR, size: 0.05 * Math.max(1, rEff * 0.6) },
      { name: 'planet', m: m, color: COLORS.b, size: 0.03 * Math.max(1, rEff * 0.6) },
    ], y0, { G: G_AU, eps: 0 })
    this.mu = mu
    this.Msun = M
    this.mm = m
    this.e = e
    this.rp = rp
    const c = conicOf(mu, rp, e)
    this.a = c.a
    this.T = c.period
    const T = Number.isFinite(c.period) ? c.period : 2 * Math.PI * Math.sqrt(rp ** 3 / mu) * 2
    const tp = T * Math.min(1 / 8000, (1 - Math.min(e, 0.99)) ** 1.5 / 300)
    this.dt = e >= 1 ? Math.sqrt(rp ** 3 / mu) / 400 : tp
    this.realtime = T / 9
    this.sampleDt = T / 400
    this.hist = [[0, rp, 0]]
  }

  private rel(): { x: number; y: number; vx: number; vy: number } {
    const p0 = this.pos(0)
    const p1 = this.pos(1)
    const v0 = this.vel(0)
    const v1 = this.vel(1)
    return { x: p1[0] - p0[0], y: p1[1] - p0[1], vx: v1[0] - v0[0], vy: v1[1] - v0[1] }
  }

  protected advance(dt: number) {
    this.o.advance(dt)
    const r = this.rel()
    if (this.prevY < 0 && r.y >= 0 && r.x > 0) {
      const tc = this.prevT + (this.o.t - this.prevT) * (-this.prevY / (r.y - this.prevY))
      this.cross.push(tc)
      if (this.cross.length > 8) this.cross.shift()
    }
    this.prevY = r.y
    this.prevT = this.o.t
    const areal = 0.5 * (r.x * r.vy - r.y * r.vx)
    this.sumAreal += areal
    this.nAreal++
    if (this.e < 1) {
      this.hist.push([this.o.t, r.x, r.y])
      const keep = (3.3 * this.T) / 12
      while (this.hist.length > 2 && this.o.t - this.hist[0][0] > keep) this.hist.shift()
    }
  }

  private theory(t: number) {
    if (this.e >= 1) return { x: NaN, y: NaN, r: NaN }
    const n = Math.sqrt(this.mu / this.a ** 3)
    const E = solveKepler(n * t, this.e)
    return { x: this.a * (Math.cos(E) - this.e), y: this.a * Math.sqrt(1 - this.e * this.e) * Math.sin(E), r: this.a * (1 - this.e * Math.cos(E)) }
  }

  sample(): Record<string, number> {
    const r = this.rel()
    const th = this.theory(this.o.t)
    const h = Math.sqrt(this.mu * this.rp * (1 + this.e))
    return {
      ...this.baseSample(), x: r.x, y: r.y, r: Math.hypot(r.x, r.y), speed: Math.hypot(r.vx, r.vy), areal: 0.5 * (r.x * r.vy - r.y * r.vx),
      x_th: th.x, y_th: th.y, r_th: th.r, areal_th: h / 2,
    }
  }

  measuredPeriod(): number | null {
    const c = this.cross
    return c.length >= 1 ? (c[c.length - 1] - 0) / c.length : null
  }

  bounds(): Bounds {
    const R = (this.e < 1 ? this.a * (1 + this.e) : this.rp * 4) * 1.18
    const c = this.e < 1 ? -(this.a * this.e) * 0.0 : 0
    return { x0: -R * 1.05 + c, x1: R * 1.05 + c, y0: -R, y1: R }
  }

  frame(): Frame {
    const infos = this.bodyInfos()
    const shapes: Shape[] = []
    const f2 = this.Msun / (this.Msun + this.mm)
    const f1 = this.mm / (this.Msun + this.mm)
    const p = this.rp * (1 + this.e)
    const rMax = this.bounds().x1 * 2
    const pts = conicPoints(p, this.e, 200, rMax)
    // the planet's path about the centre of mass (and the star's, smaller)
    const com = this.totals()
    shapes.push({ t: 'path', pts: pts.map(([x, y]) => [com.cx + f2 * (x - this.rp) + f2 * this.rp - f1 * 0, com.cy + f2 * y]), color: COLORS.theory, dash: true, w: 1, alpha: 0.8 })
    if (this.mm / this.Msun > 0.02) shapes.push({ t: 'path', pts: pts.map(([x, y]) => [-f1 * x, -f1 * y]), color: COLORS.theory, dash: true, w: 1, alpha: 0.5 })
    // the empty focus and the swept wedges (Kepler I and II)
    if (this.e < 1 && this.e > 0.02) {
      const s0 = this.pos(0)
      const f2x = s0[0] - 2 * this.a * this.e
      shapes.push({ t: 'circle', x: f2x, y: s0[1], r: 0.012 * this.a, fill: COLORS.theory, alpha: 0.8 })
      shapes.push({ t: 'text', x: f2x, y: s0[1] - 0.05 * this.a, text: 'empty focus', color: COLORS.theory, align: 'center' })
      const p1 = this.pos(1)
      shapes.push({ t: 'line', x1: s0[0], y1: s0[1], x2: p1[0], y2: p1[1], color: COLORS.a, w: 1, alpha: 0.5 })
      shapes.push({ t: 'line', x1: f2x, y1: s0[1], x2: p1[0], y2: p1[1], color: COLORS.a, w: 1, alpha: 0.5 })
    }
    for (const w of this.wedges()) shapes.push({ t: 'poly', pts: w.pts, fill: w.k ? COLORS.d : COLORS.b, closed: true, alpha: 0.22 })
    shapes.push(...this.bodyShapes(infos, false))
    return { shapes, bodies: infos }
  }

  /** The areas swept by the planet in the last three intervals of T/12 each (for ellipses). */
  wedges(): { pts: number[][]; area: number; k: number }[] {
    if (this.e >= 1 || this.hist.length < 3) return []
    const step = this.T / 12
    const t1 = this.o.t
    const out: { pts: number[][]; area: number; k: number }[] = []
    const star = this.pos(0)
    for (let k = 0; k < 3; k++) {
      const ta = t1 - (k + 1) * step
      const tb = t1 - k * step
      if (ta < this.hist[0][0] - 1e-9) break
      const seg = this.hist.filter((h) => h[0] >= ta - 1e-9 && h[0] <= tb + 1e-9)
      if (seg.length < 2) continue
      const pts = [[star[0], star[1]], ...seg.map((h) => [star[0] + h[1], star[1] + h[2]])]
      let area = 0
      for (let i = 0; i < seg.length - 1; i++) area += 0.5 * (seg[i][1] * seg[i + 1][2] - seg[i + 1][1] * seg[i][2])
      out.push({ pts, area, k: k % 2 })
    }
    return out
  }

  readouts(): Readout[] {
    const c = conicOf(this.mu, this.rp, this.e)
    const r = this.rel()
    const rr = Math.hypot(r.x, r.y)
    const out: Readout[] = []
    const kind = { circle: 'circle', ellipse: 'ellipse', parabola: 'parabola (just escapes)', hyperbola: 'hyperbola (unbound)' }[c.kind]
    out.push({ label: 'Orbit', value: kind, tone: 'info' })
    out.push({ label: 'Speed at periapsis', value: `${fmt(Math.sqrt((this.mu * (1 + this.e)) / this.rp))} AU/yr`, theory: `${fmt(Math.sqrt((this.mu * (1 + this.e)) / this.rp) * AUYR_KMS)} km/s` })
    if (this.e < 1) {
      const T = this.T
      const meas = this.measuredPeriod()
      out.push({ label: 'I. Ellipse: r + r′ = 2a', value: this.e > 0.02 ? `${fmt(rr + Math.hypot(r.x + 2 * this.a * this.e, r.y), 6)} AU` : `${fmt(rr, 6)} AU`, theory: `2a = ${fmt(2 * this.a, 6)} AU` })
      const ws = this.wedges()
      if (ws.length >= 2) out.push({ label: 'II. Areas in equal times', value: ws.map((w) => fmt(w.area, 5)).join(' · ') + ' AU²', theory: `h T/24 = ${fmt((Math.sqrt(this.mu * this.rp * (1 + this.e)) * T) / 24, 5)}`, tone: 'ok' })
      out.push({ label: 'II. Areal velocity', value: `${fmt(0.5 * (r.x * r.vy - r.y * r.vx), 6)} AU²/yr`, theory: `mean ${fmt(this.nAreal ? this.sumAreal / this.nAreal : NaN, 6)}` })
      out.push({ label: 'Period', value: meas ? `${fmt(meas, 6)} yr` : 'measuring…', theory: `${fmt(T, 6)} yr` })
      out.push({ label: 'III. T²/a³', value: meas ? `${fmt((meas * meas) / this.a ** 3, 6)} yr²/AU³` : '…', theory: `1/(M+m) = ${fmt(1 / (this.Msun + this.mm), 6)}`, tone: 'ok' })
      out.push({ label: 'Semi-major axis a', value: `${fmt(this.a, 5)} AU`, theory: `b = ${fmt(this.a * Math.sqrt(1 - this.e ** 2), 5)} AU` })
    } else {
      out.push({ label: 'Asymptotic speed v∞', value: this.e > 1 ? `${fmt(Math.sqrt(-2 * c.energy))} AU/yr` : '0' })
      out.push({ label: 'Specific energy', value: `${fmt(c.energy, 5)} AU²/yr²`, theory: this.e === 1 ? 'zero: the parabola' : 'positive: unbound' })
    }
    out.push({ label: 'Escape speed here', value: `${fmt(escapeSpeed(this.mu, rr))} AU/yr`, theory: `now ${fmt(Math.hypot(r.vx, r.vy))}` })
    return out
  }
}

// ------------------------------------------------------------------------------------------ escape speed

class EscapeSim extends OrbitBase {
  readonly mode = 'escape'
  channels: Channel[] = [
    ...BASE_CHANNELS,
    { key: 'x', label: 'x', unit: 'AU' }, { key: 'y', label: 'y', unit: 'AU' }, { key: 'r', label: 'distance r', unit: 'AU' }, { key: 'speed', label: 'speed', unit: 'AU/yr' }, { key: 'vesc', label: 'escape speed here', unit: 'AU/yr' },
    { key: 'vesc_th', label: 'escape speed √(2GM/r)', unit: 'AU/yr', analytic: true },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path', 'x', [{ key: 'y' }], 'x (AU)', 'y (AU)', true),
    timePlot('r', 'Distance r(t)', [{ key: 'r' }], 'r (AU)', 'yr'),
    timePlot('v', 'Speed against the escape speed', [{ key: 'speed' }, { key: 'vesc_th', label: 'escape speed at r', dash: true }], 'speed (AU/yr)', 'yr'),
    timePlot('energy', 'Energies per unit mass', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (AU²/yr²)', 'yr'),
  ]
  private readonly mu: number
  private readonly r0: number
  private rmax = 0
  private readonly eps0: number
  private readonly h: number

  constructor(params: Params, method: Method) {
    const M = num(params, 'M', 1)
    const r0 = num(params, 'r0', 1)
    const mu = G_AU * M
    const v = num(params, 'f', 0.9) * escapeSpeed(mu, r0)
    const la = num(params, 'launch', 90) * DEG
    const y0 = new Float64Array(12)
    y0[3] = r0
    y0[6 + 3] = v * Math.sin(la)
    y0[6 + 4] = v * Math.cos(la)
    super(params, method, [
      { name: 'star', m: M, color: STAR, size: 0.06 * r0 },
      { name: 'probe', m: 1e-15, color: COLORS.b, size: 0.04 * r0, probe: true },
    ], y0, { G: G_AU, eps: 0 })
    this.mu = mu
    this.r0 = r0
    this.eps0 = 0.5 * v * v - mu / r0
    this.h = r0 * v * Math.cos(la)
    this.dt = Math.sqrt(r0 ** 3 / mu) / 300
    this.realtime = Math.sqrt(r0 ** 3 / mu) / 1.5
    this.sampleDt = this.dt * 20
  }

  protected advance(dt: number) {
    this.o.advance(dt)
    const p = this.pos(1)
    this.rmax = Math.max(this.rmax, Math.hypot(p[0], p[1]))
    // stop when the probe falls into the star (a radial drop)
    if (Math.hypot(p[0], p[1]) < this.r0 * 0.02) this.finished = true
  }

  sample(): Record<string, number> {
    const p = this.pos(1)
    const v = this.vel(1)
    const r = Math.hypot(p[0], p[1])
    return {
      ...this.baseSample(), x: p[0], y: p[1], r, speed: Math.hypot(v[0], v[1]), vesc: escapeSpeed(this.mu, r), vesc_th: escapeSpeed(this.mu, r),
    }
  }

  /** The farthest the probe gets (null if it escapes). */
  rmaxTheory(): number | null {
    if (this.eps0 >= 0) return null
    return (-this.mu - Math.sqrt(this.mu * this.mu + 2 * this.eps0 * this.h * this.h)) / (2 * this.eps0)
  }

  bounds(): Bounds {
    const rm = this.rmaxTheory()
    const R = (rm ?? this.r0 * 4) * 1.15
    return { x0: -R * 0.3, x1: R, y0: -R * 0.65, y1: R * 0.65 }
  }

  frame(): Frame {
    const infos = this.bodyInfos()
    const shapes: Shape[] = []
    const rm = this.rmaxTheory()
    const ring = (r: number) => Array.from({ length: 121 }, (_, i) => [r * Math.cos((i / 120) * 2 * Math.PI), r * Math.sin((i / 120) * 2 * Math.PI)])
    shapes.push({ t: 'path', pts: ring(this.r0), color: COLORS.rod, dash: true, w: 1, alpha: 0.6 })
    if (rm) shapes.push({ t: 'path', pts: ring(rm), color: COLORS.theory, dash: true, w: 1, alpha: 0.6 })
    shapes.push(...this.bodyShapes(infos, false))
    return { shapes, bodies: infos }
  }

  readouts(): Readout[] {
    const r = this.r0
    const vesc = escapeSpeed(this.mu, r)
    const vc = circularSpeed(this.mu, r)
    const f = num(this.params, 'f', 0.9)
    const rm = this.rmaxTheory()
    return [
      { label: 'Escape speed at the start', value: `${fmt(vesc)} AU/yr`, theory: `${fmt(vesc * AUYR_KMS)} km/s` },
      { label: 'Circular speed', value: `${fmt(vc)} AU/yr`, theory: `${fmt(vc * AUYR_KMS)} km/s (= v_esc/√2)` },
      { label: 'Launch speed', value: `${fmt(f * vesc)} AU/yr`, theory: `${fmt(f, 3)} v_esc` },
      { label: 'Specific energy', value: `${fmt(this.eps0, 4)} AU²/yr²`, theory: this.eps0 < 0 ? 'negative: bound' : 'zero or positive: escapes', tone: this.eps0 < 0 ? 'warn' : 'ok' },
      { label: 'Farthest distance', value: `${fmt(this.rmax)} AU`, theory: rm ? `${fmt(rm)} AU` : 'unbounded' },
      ...super.readouts(),
    ]
  }
}

// ------------------------------------------------------------------------------------------ Hohmann transfer

class HohmannSim extends OrbitBase {
  readonly mode = 'hohmann'
  channels: Channel[] = [
    ...BASE_CHANNELS,
    { key: 'r_ship', label: 'ship distance from the Sun', unit: 'AU' }, { key: 'r_p1', label: 'departure planet', unit: 'AU' }, { key: 'r_p2', label: 'arrival planet', unit: 'AU' },
    { key: 'd_target', label: 'ship – arrival planet', unit: 'AU' }, { key: 'v_ship', label: 'ship speed (Sun frame)', unit: 'AU/yr' },
    { key: 'x', label: 'x of the ship', unit: 'AU' }, { key: 'y', label: 'y of the ship', unit: 'AU' },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Paths', 'x', [{ key: 'y', label: 'ship' }], 'x (AU)', 'y (AU)', true),
    timePlot('r', 'Distances from the Sun', [{ key: 'r_ship', label: 'ship' }, { key: 'r_p1', label: 'departure planet' }, { key: 'r_p2', label: 'arrival planet' }], 'r (AU)', 'yr'),
    timePlot('d', 'Distance ship – arrival planet', [{ key: 'd_target' }], 'distance (AU)', 'yr'),
    timePlot('v', 'Ship speed', [{ key: 'v_ship' }], 'speed (AU/yr)', 'yr'),
    timePlot('energy', 'Ship energy per unit mass', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (AU²/yr²)', 'yr'),
  ]
  private readonly mu: number
  private readonly h: ReturnType<typeof hohmann>
  private readonly r1: number
  private readonly r2: number
  private burned = false
  private dv2Measured = NaN
  private dv1Applied = 0
  private maxR = 0
  private dTarget = Infinity
  private tClosest = NaN
  private readonly burn2: boolean

  constructor(params: Params, method: Method) {
    const M = num(params, 'M', 1)
    const r1 = num(params, 'r1', 1)
    const r2 = num(params, 'r2', 1.524)
    const mu = G_AU * M
    const h = hohmann(mu, r1, r2)
    const v1 = circularSpeed(mu, r1)
    const v2 = circularSpeed(mu, r2)
    const phi = h.lead
    const scale = num(params, 'dv1', 100) / 100
    const dv1 = h.dv1 * scale
    const y0 = new Float64Array(24)
    // star, departure planet, arrival planet, ship
    y0[3] = r1
    y0[6] = r2 * Math.cos(phi); y0[7] = r2 * Math.sin(phi)
    y0[9] = r1
    const o = 12
    y0[o + 4] = v1
    y0[o + 6] = -v2 * Math.sin(phi); y0[o + 7] = v2 * Math.cos(phi)
    y0[o + 10] = v1 + dv1
    super(params, method, [
      { name: 'Sun', m: M, color: STAR, size: 0.05 },
      { name: 'start planet', m: 0, color: COLORS.b, size: 0.03, probe: true },
      { name: 'target planet', m: 0, color: COLORS.f, size: 0.027, probe: true },
      { name: 'ship', m: 0, color: COLORS.d, size: 0.02, probe: true },
    ], y0, { G: G_AU, eps: 0 })
    this.mu = mu
    this.h = h
    this.r1 = r1
    this.r2 = r2
    this.burn2 = bool(params, 'burn2', true)
    this.dv1Applied = dv1
    this.dt = 0.0005
    this.realtime = 0.2
    this.sampleDt = 0.004
    this.conservative = false
  }

  /** Energy per unit mass of the ship. */
  energy(): Energy {
    const p = this.pos(3)
    const v = this.vel(3)
    const s = this.pos(0)
    const sv = this.vel(0)
    const r = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2])
    const vv = Math.hypot(v[0] - sv[0], v[1] - sv[1], v[2] - sv[2])
    const ke = 0.5 * vv * vv
    const pe = -this.mu / r
    return { ke, pe, total: ke + pe }
  }

  protected advance(dt: number) {
    const tBurn = this.h.time
    if (!this.burned && this.burn2 && this.o.t < tBurn && this.o.t + dt >= tBurn) {
      this.o.advance(tBurn - this.o.t)
      this.applyBurn2()
      const rest = this.o.t + dt - tBurn
      if (rest > 1e-12) this.o.advance(rest)
    } else this.o.advance(dt)
    const s = this.pos(0)
    const sh = this.pos(3)
    const m2 = this.pos(2)
    this.maxR = Math.max(this.maxR, Math.hypot(sh[0] - s[0], sh[1] - s[1]))
    const d = Math.hypot(sh[0] - m2[0], sh[1] - m2[1])
    if (d < this.dTarget) { this.dTarget = d; this.tClosest = this.o.t }
    if (this.o.t > this.h.time * 2.3) this.finished = true
  }

  private applyBurn2() {
    const N = this.N
    const y = this.o.y
    const s = this.pos(0)
    const sv = this.vel(0)
    const p = this.pos(3)
    const v = this.vel(3)
    const rx = p[0] - s[0]
    const ry = p[1] - s[1]
    const r = Math.hypot(rx, ry)
    const vc = Math.sqrt(this.mu / r)
    const tx = -ry / r
    const ty = rx / r
    const nvx = sv[0] + vc * tx
    const nvy = sv[1] + vc * ty
    this.dv2Measured = Math.hypot(nvx - v[0], nvy - v[1])
    y[3 * N + 9] = nvx
    y[3 * N + 10] = nvy
    this.burned = true
    this.o.invalidate()
  }

  sample(): Record<string, number> {
    const s = this.pos(0)
    const sh = this.pos(3)
    const a = this.pos(1)
    const b = this.pos(2)
    const v = this.vel(3)
    const sv = this.vel(0)
    const e = this.energy()
    return {
      ...this.baseSample(), ke: e.ke, pe: e.pe, e: e.total, r_ship: Math.hypot(sh[0] - s[0], sh[1] - s[1]), r_p1: Math.hypot(a[0] - s[0], a[1] - s[1]), r_p2: Math.hypot(b[0] - s[0], b[1] - s[1]),
      d_target: Math.hypot(sh[0] - b[0], sh[1] - b[1]), v_ship: Math.hypot(v[0] - sv[0], v[1] - sv[1]), x: sh[0] - s[0], y: sh[1] - s[1],
    }
  }

  bounds(): Bounds {
    const R = Math.max(this.r1, this.r2) * 1.3
    return { x0: -R, x1: R, y0: -R, y1: R }
  }

  frame(): Frame {
    const infos = this.bodyInfos()
    const shapes: Shape[] = []
    const s = this.pos(0)
    const ring = (r: number) => Array.from({ length: 121 }, (_, i) => [s[0] + r * Math.cos((i / 120) * 2 * Math.PI), s[1] + r * Math.sin((i / 120) * 2 * Math.PI)])
    shapes.push({ t: 'path', pts: ring(this.r1), color: COLORS.b, dash: true, w: 1, alpha: 0.5 })
    shapes.push({ t: 'path', pts: ring(this.r2), color: COLORS.f, dash: true, w: 1, alpha: 0.5 })
    // the ideal transfer ellipse: it touches the start orbit at the departure point (+x) and the target orbit on the far side
    const e = Math.abs(this.r2 - this.r1) / (this.r1 + this.r2)
    const inward = this.r2 < this.r1
    const tr = conicPoints(Math.min(this.r1, this.r2) * (1 + e), e, 160)
    shapes.push({ t: 'path', pts: tr.map(([x, y]) => (inward ? [s[0] - x, s[1] - y] : [s[0] + x, s[1] + y])), color: COLORS.theory, dash: true, w: 1.2, alpha: 0.9 })
    shapes.push(...this.bodyShapes(infos, true))
    return { shapes, bodies: infos, banner: this.burned && this.o.t - this.h.time < 0.03 ? 'second burn' : undefined }
  }

  readouts(): Readout[] {
    const km = AUYR_KMS
    const out: Readout[] = []
    out.push({ label: 'Δv₁ (departure)', value: `${fmt(this.dv1Applied * km, 4)} km/s`, theory: `${fmt(this.h.dv1 * km, 4)} km/s` })
    out.push({ label: 'Δv₂ (arrival)', value: Number.isFinite(this.dv2Measured) ? `${fmt(this.dv2Measured * km, 4)} km/s` : this.burn2 ? 'at apoapsis…' : 'off', theory: `${fmt(this.h.dv2 * km, 4)} km/s` })
    out.push({ label: 'Total Δv', value: `${fmt((this.dv1Applied + (Number.isFinite(this.dv2Measured) ? this.dv2Measured : this.h.dv2)) * km, 4)} km/s`, theory: `${fmt(this.h.total * km, 4)} km/s` })
    out.push({ label: 'Time since departure', value: `${fmt(this.o.t * 365.25, 4)} days`, theory: `transfer takes ${fmt(this.h.time * 365.25, 4)} days (π√(a³/μ))` })
    out.push({ label: 'Launch phase lead', value: `${fmt((this.h.lead / DEG), 4)}°`, theory: 'the target planet must be this far ahead' })
    out.push({ label: 'Apoapsis reached', value: `${fmt(this.maxR, 5)} AU`, theory: `${fmt(this.r2, 5)} AU` })
    out.push({ label: 'Closest approach to the target', value: `${fmt(this.dTarget, 4)} AU`, theory: Number.isFinite(this.tClosest) ? `at ${fmt(this.tClosest * 365.25, 4)} days` : undefined, tone: this.dTarget < 0.05 ? 'ok' : 'info' })
    return out
  }
}

// ------------------------------------------------------------------------------------------ gravity assist

class SlingshotSim extends OrbitBase {
  readonly mode = 'slingshot'
  channels: Channel[] = [
    ...BASE_CHANNELS,
    { key: 'd', label: 'distance from the planet', unit: 'AU' }, { key: 'v_sun', label: 'probe speed (Sun frame)', unit: 'AU/yr' }, { key: 'v_planet', label: 'probe speed (planet frame)', unit: 'AU/yr' },
    { key: 'x', label: 'x (view frame)', unit: 'AU' }, { key: 'y', label: 'y (view frame)', unit: 'AU' },
    { key: 'v_sun_th', label: 'final speed, Sun frame (closed form)', unit: 'AU/yr', analytic: true },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path of the probe', 'x', [{ key: 'y' }], 'x (AU)', 'y (AU)', true),
    timePlot('v', 'Probe speed', [{ key: 'v_sun', label: 'in the Sun frame' }, { key: 'v_planet', label: 'in the planet frame' }], 'speed (AU/yr)', 'yr'),
    timePlot('d', 'Distance from the planet', [{ key: 'd' }], 'distance (AU)', 'yr'),
    timePlot('energy', 'Probe energy per unit mass (Sun frame)', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (AU²/yr²)', 'yr'),
  ]
  private readonly mu: number
  private readonly V: [number, number]
  private readonly D = 0.3
  private readonly dEnd = 0.6
  private readonly win: [number, number]
  private readonly hyp: ReturnType<typeof hyperbolaOf>
  private readonly side: 1 | -1
  private dmin = Infinity
  private passed = false
  readonly vSunIn: number
  readonly vSunOutTheory: number
  private readonly view: string

  constructor(params: Params, method: Method) {
    const pm = num(params, 'pm', 1) * 9.5479e-4
    const mu = G_AU * pm
    const U = num(params, 'U', 2.76)
    const u = num(params, 'u', 2)
    const b = num(params, 'b', 0.01)
    const side: 1 | -1 = str(params, 'side', 'behind') === 'behind' ? 1 : -1
    const V: [number, number] = [0, -U]
    const win: [number, number] = [u - V[0], 0 - V[1]]
    const vinf = Math.hypot(win[0], win[1])
    const psi = Math.atan2(win[1], win[0])
    const st = hyperbolaStart(mu, vinf, b, 0.3, side)
    const c = Math.cos(psi)
    const s = Math.sin(psi)
    const y0 = new Float64Array(12)
    // planet at the origin at t = 0 minus its own motion so the pass happens near the middle of the picture
    y0[0] = 0; y0[1] = 0
    y0[3] = st.r[0] * c - st.r[1] * s
    y0[4] = st.r[0] * s + st.r[1] * c
    y0[6 + 1] = V[1]; y0[6] = V[0]
    y0[9] = V[0] + st.v[0] * c - st.v[1] * s
    y0[10] = V[1] + st.v[0] * s + st.v[1] * c
    super(params, method, [
      { name: 'planet', m: pm, color: COLORS.h, size: 0.01 },
      { name: 'probe', m: 1e-18, color: COLORS.d, size: 0.006, probe: true },
    ], y0, { G: G_AU, eps: 0 })
    this.mu = mu
    this.V = V
    this.win = win
    this.hyp = hyperbolaOf(mu, vinf, b)
    this.side = side
    this.view = str(params, 'frame', 'planet')
    this.vSunIn = Math.hypot(y0[9], y0[10])
    // closed form of the outgoing velocity: rotate the planet-frame velocity by the deflection towards the planet
    const dir = side === 1 ? -1 : 1 // passing above (side +1) bends the path downward: clockwise
    const cr = Math.cos(dir * this.hyp.delta)
    const sr = Math.sin(dir * this.hyp.delta)
    const wout = [win[0] * cr - win[1] * sr, win[0] * sr + win[1] * cr]
    // the probe's incoming velocity in the planet frame is win rotated into the frame of the picture: it starts as st.v rotated by psi, which is win itself
    this.vSunOutTheory = Math.hypot(V[0] + wout[0], V[1] + wout[1])
    this.dt = 4e-5
    this.realtime = 0.04
    this.sampleDt = 0.0008
    this.conservative = false
  }

  /** Energy per unit mass of the probe in the Sun frame (the planet's pull included; the planet's motion does the work). */
  energy(): Energy {
    const v = this.vel(1)
    const p = this.pos(1)
    const q = this.pos(0)
    const ke = 0.5 * (v[0] * v[0] + v[1] * v[1])
    const pe = -this.mu / Math.hypot(p[0] - q[0], p[1] - q[1])
    return { ke, pe, total: ke + pe }
  }

  protected advance(dt: number) {
    this.o.advance(dt)
    const p = this.pos(1)
    const q = this.pos(0)
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < this.dmin) this.dmin = d
    else if (d > this.dmin * 1.5) this.passed = true
    if (this.passed && d > this.dEnd) this.finished = true
  }

  sample(): Record<string, number> {
    const p = this.pos(1)
    const q = this.pos(0)
    const v = this.vel(1)
    const w = this.vel(0)
    const e = this.energy()
    const planetView = this.view === 'planet'
    return {
      ...this.baseSample(), ke: e.ke, pe: e.pe, e: e.total, d: Math.hypot(p[0] - q[0], p[1] - q[1]), v_sun: Math.hypot(v[0], v[1]), v_planet: Math.hypot(v[0] - w[0], v[1] - w[1]),
      x: planetView ? p[0] - q[0] : p[0], y: planetView ? p[1] - q[1] : p[1], v_sun_th: this.vSunOutTheory,
    }
  }

  bounds(): Bounds {
    if (this.view === 'planet') {
      const R = this.dEnd * 1.2
      return { x0: -R, x1: R, y0: -R, y1: R }
    }
    const T = (this.D + this.dEnd) / this.hyp.vinf
    const R = Math.max(this.D, Math.abs(this.V[1]) * T * 0.9, this.vSunIn * T * 0.6) * 1.1
    return { x0: -R, x1: R, y0: -R * 1.1, y1: R * 0.5 }
  }

  frame(): Frame {
    const q = this.pos(0)
    const planetView = this.view === 'planet'
    const off = planetView ? q : [0, 0, 0]
    const voff = planetView ? this.vel(0) : [0, 0, 0]
    const infos = this.bodyInfos((i) => {
      const p = this.pos(i)
      const v = this.vel(i)
      return [p[0] - off[0], p[1] - off[1], p[2] - off[2], v[0] - voff[0], v[1] - voff[1], v[2] - voff[2]]
    })
    const shapes: Shape[] = []
    if (planetView) {
      // the analytic hyperbola: periapsis direction from the incoming asymptote
      const h = this.hyp
      const p = h.rp * (1 + h.e)
      const pts = conicPoints(p, h.e, 200, this.D * 3)
      const psi = Math.atan2(this.win[1], this.win[0])
      const thInf = -Math.acos(-1 / h.e)
      const vin = [Math.sin(thInf) * -1, h.e + Math.cos(thInf)]
      const ang = Math.atan2(vin[1], vin[0])
      const c0 = Math.cos(-ang)
      const s0 = Math.sin(-ang)
      const c = Math.cos(psi)
      const s = Math.sin(psi)
      const mirror = this.side === 1
      shapes.push({
        t: 'path', color: COLORS.theory, dash: true, w: 1, alpha: 0.9,
        pts: pts.map(([x, y]) => {
          const x1 = x * c0 - y * s0
          const y1 = (x * s0 + y * c0) * (mirror ? -1 : 1)
          return [x1 * c - y1 * s, x1 * s + y1 * c]
        }),
      })
    }
    shapes.push({ t: 'circle', x: infos[0].x, y: infos[0].y, r: Math.max(0.006, this.D * 0.025), fill: COLORS.h, stroke: '#0b0b0b' })
    shapes.push({ t: 'text', x: infos[0].x + 0.012, y: infos[0].y + 0.012, text: 'planet', color: COLORS.h })
    shapes.push({ t: 'circle', x: infos[1].x, y: infos[1].y, r: Math.max(0.004, this.D * 0.014), fill: COLORS.d, stroke: '#0b0b0b' })
    return { shapes, bodies: infos, banner: undefined }
  }

  readouts(): Readout[] {
    const km = AUYR_KMS
    const h = this.hyp
    const v = this.vel(1)
    const w = this.vel(0)
    const vSun = Math.hypot(v[0], v[1])
    const vPl = Math.hypot(v[0] - w[0], v[1] - w[1])
    const finalPhase = this.passed
    return [
      { label: 'Speed at infinity (planet frame)', value: `${fmt(h.vinf)} AU/yr`, theory: `${fmt(h.vinf * km)} km/s` },
      { label: 'Eccentricity of the fly-by', value: fmt(h.e, 4), theory: `closest approach ${fmt(h.rp, 4)} AU` },
      { label: 'Deflection angle', value: `${fmt(h.delta / DEG, 4)}°`, theory: '2·asin(1/e)' },
      { label: 'Speed in the planet frame', value: `${fmt(vPl)} AU/yr`, theory: 'unchanged by the pass' },
      { label: 'Speed in the Sun frame', value: `${fmt(vSun)} AU/yr`, theory: finalPhase ? `closed form after the pass: ${fmt(this.vSunOutTheory)}` : `before: ${fmt(this.vSunIn)}; after (closed form): ${fmt(this.vSunOutTheory)}`, tone: 'info' },
      { label: 'Gain in the Sun frame', value: `${fmt((vSun - this.vSunIn) * km, 4)} km/s`, theory: `${fmt((this.vSunOutTheory - this.vSunIn) * km, 4)} km/s predicted` },
      { label: 'Closest approach so far', value: Number.isFinite(this.dmin) ? `${fmt(this.dmin, 4)} AU` : '…' },
    ]
  }
}

// ------------------------------------------------------------------------------------------ restricted three-body

function zeroVelocityCurve(mu: number, C: number, half: number, n = 130): number[][][] {
  // 2U(x,y) = C along the curve, U = (x²+y²)/2 + (1-mu)/r1 + mu/r2
  const f = (x: number, y: number) => x * x + y * y + (2 * (1 - mu)) / Math.hypot(x + mu, y) + (2 * mu) / Math.hypot(x - 1 + mu, y) - C
  const segs: number[][][] = []
  const h = (2 * half) / n
  const val: number[][] = []
  for (let i = 0; i <= n; i++) { val.push([]); for (let j = 0; j <= n; j++) val[i].push(f(-half + i * h, -half + j * h)) }
  const lerp = (a: number, b: number, fa: number, fb: number) => a + ((b - a) * fa) / (fa - fb)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -half + i * h
      const y0 = -half + j * h
      const f00 = val[i][j], f10 = val[i + 1][j], f11 = val[i + 1][j + 1], f01 = val[i][j + 1]
      const pts: number[][] = []
      if (f00 * f10 < 0) pts.push([lerp(x0, x0 + h, f00, f10), y0])
      if (f10 * f11 < 0) pts.push([x0 + h, lerp(y0, y0 + h, f10, f11)])
      if (f01 * f11 < 0) pts.push([lerp(x0, x0 + h, f01, f11), y0 + h])
      if (f00 * f01 < 0) pts.push([x0, lerp(y0, y0 + h, f00, f01)])
      if (pts.length >= 2) segs.push([pts[0], pts[1]])
      if (pts.length === 4) segs.push([pts[2], pts[3]])
    }
  }
  return segs
}

class Restricted3Sim extends SimBase {
  readonly scene = 'orbit' as const
  readonly mode = 'restricted3'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 'TU' }, { key: 'x', label: 'x (rotating frame)' }, { key: 'y', label: 'y (rotating frame)' }, { key: 'vx', label: 'vx' }, { key: 'vy', label: 'vy' },
    { key: 'ke', label: '½v²' }, { key: 'pe', label: '−Ueff' }, { key: 'e', label: 'Jacobi energy −C/2' }, { key: 'C', label: 'Jacobi constant C' },
    { key: 'r1', label: 'distance to the large primary' }, { key: 'r2', label: 'distance to the small primary' }, { key: 'xi', label: 'x (inertial)' }, { key: 'yi', label: 'y (inertial)' },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path in the rotating frame', 'x', [{ key: 'y' }], 'x', 'y', true),
    timePlot('C', 'Jacobi constant', [{ key: 'C' }], 'C', 'TU'),
    timePlot('r', 'Distances to the primaries', [{ key: 'r1', label: 'large' }, { key: 'r2', label: 'small' }], 'distance', 'TU'),
    timePlot('energy', 'Jacobi energy', [{ key: 'ke', label: '½v²' }, { key: 'pe', label: '−Ueff' }, { key: 'e', label: 'sum' }], 'energy', 'TU'),
  ]
  o: Ode2
  private readonly mu: number
  private readonly C0: number
  private zv: number[][][] | null = null
  private readonly L: { name: string; x: number; y: number }[]
  private readonly ic: string
  private approach = Infinity
  lengthUnit = 'a'
  timeUnit = 'TU'
  conservative = true

  constructor(params: Params, method: Method) {
    super(params, method)
    let mu = num(params, 'mu', 0.0121505856)
    const ic = str(params, 'ic', 'l4')
    this.ic = ic
    let s: number[]
    if (ic === 'arenstorf') {
      mu = ARENSTORF.mu
      s = [ARENSTORF.x, ARENSTORF.y, ARENSTORF.vx, ARENSTORF.vy]
    } else if (ic === 'custom') s = [num(params, 'cx', 0.5), num(params, 'cy', 0.3), num(params, 'cvx', 0), num(params, 'cvy', 0.3)]
    else {
      const L = lagrangePoints(mu)
      const pt = L.find((l) => l.name === ic.toUpperCase()) ?? L[3]
      const off = num(params, 'off', -0.02)
      if (pt.y !== 0) {
        // L4, L5: a body on a circular orbit about the centre of mass whose radius differs a little from the point's
        const r = Math.hypot(pt.x, pt.y) * (1 + off)
        const ang = Math.atan2(pt.y, pt.x)
        const x = r * Math.cos(ang)
        const y = r * Math.sin(ang)
        const k = Math.pow(r, -1.5) - 1
        s = [x, y, -y * k, x * k]
      } else s = [pt.x + off, pt.y, 0, 0]
    }
    this.mu = mu
    this.L = lagrangePoints(mu)
    this.o = new Ode2({ n: 2, vdep: true, acc: (_t, y, a) => { const r = cr3bpAcc(this.mu, y[0], y[1], y[2], y[3]); a[0] = r[0]; a[1] = r[1] } }, [s[0], s[1], s[2], s[3]], method)
    this.o.rtol = 1e-11
    this.o.atol = 1e-13
    this.C0 = jacobi(mu, s[0], s[1], s[2], s[3])
    this.dt = 0.004
    this.realtime = 1.2
    this.sampleDt = 0.04
  }

  step(dt: number) {
    this.o.method = this.method
    this.o.advance(dt)
    this.t = this.o.t
    const y = this.o.y
    this.approach = Math.min(this.approach, Math.hypot(y[0] - 1 + this.mu, y[1]), Math.hypot(y[0] + this.mu, y[1]))
  }

  energy(): Energy {
    const y = this.o.y
    const C = jacobi(this.mu, y[0], y[1], y[2], y[3])
    const ke = 0.5 * (y[2] * y[2] + y[3] * y[3])
    const pe = -(C + (y[2] * y[2] + y[3] * y[3])) / 2
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const y = this.o.y
    const e = this.energy()
    const c = Math.cos(this.o.t)
    const s = Math.sin(this.o.t)
    return {
      t: this.o.t, x: y[0], y: y[1], vx: y[2], vy: y[3], ke: e.ke, pe: e.pe, e: e.total, C: jacobi(this.mu, y[0], y[1], y[2], y[3]),
      r1: Math.hypot(y[0] + this.mu, y[1]), r2: Math.hypot(y[0] - 1 + this.mu, y[1]), xi: y[0] * c - y[1] * s, yi: y[0] * s + y[1] * c,
    }
  }

  bounds(): Bounds { return { x0: -1.6, x1: 1.6, y0: -1.3, y1: 1.3 } }

  frame(): Frame {
    const inertial = bool(this.params, 'inertial', false)
    const th = inertial ? this.o.t : 0
    const c = Math.cos(th)
    const s = Math.sin(th)
    const rot = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c]
    const y = this.o.y
    const shapes: Shape[] = []
    const mu = this.mu
    if (!this.zv) this.zv = zeroVelocityCurve(mu, this.C0, 1.6)
    if (!inertial) for (const seg of this.zv) shapes.push({ t: 'line', x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1], color: COLORS.f, w: 1, alpha: 0.55 })
    else shapes.push({ t: 'path', pts: Array.from({ length: 121 }, (_, i) => [Math.cos((i / 120) * 2 * Math.PI), Math.sin((i / 120) * 2 * Math.PI)]), color: COLORS.rod, dash: true, w: 1, alpha: 0.5 })
    for (const L of this.L) {
      const [lx, ly] = rot(L.x, L.y)
      shapes.push({ t: 'circle', x: lx, y: ly, r: 0.012, fill: COLORS.theory, alpha: 0.9 })
      shapes.push({ t: 'text', x: lx + 0.03, y: ly + 0.03, text: L.name, color: COLORS.theory })
    }
    const [p1x, p1y] = rot(-mu, 0)
    const [p2x, p2y] = rot(1 - mu, 0)
    shapes.push({ t: 'circle', x: p1x, y: p1y, r: 0.06, fill: STAR, stroke: '#0b0b0b' })
    shapes.push({ t: 'circle', x: p2x, y: p2y, r: 0.03, fill: COLORS.b, stroke: '#0b0b0b' })
    const [px, py] = rot(y[0], y[1])
    shapes.push({ t: 'circle', x: px, y: py, r: 0.014, fill: COLORS.d, stroke: '#0b0b0b' })
    const a = new Float64Array(2)
    this.o.accel(a)
    const [vx, vy] = rot(y[2] - (inertial ? -y[1] : 0), y[3] + (inertial ? y[0] : 0))
    const [ax, ay] = rot(a[0], a[1])
    const bodies = [{ id: 'probe', x: px, y: py, vx, vy, ax, ay, m: 1, r: 0.014, color: COLORS.d, name: 'test mass' }]
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const y = this.o.y
    const C = jacobi(this.mu, y[0], y[1], y[2], y[3])
    const out: Readout[] = [
      { label: 'Jacobi constant C', value: fmt(C, 9), theory: `start ${fmt(this.C0, 9)}: conserved`, tone: Math.abs(C - this.C0) < 1e-6 * Math.max(1, Math.abs(this.C0)) ? 'ok' : 'warn' },
      { label: 'Drift of C', value: fmt(Math.abs(C - this.C0), 3) },
      { label: 'Closest approach to a primary', value: fmt(this.approach, 4) },
      { label: 'Lagrange points', value: this.L.slice(0, 3).map((l) => `${l.name} ${fmt(l.x, 5)}`).join(' · '), theory: 'L4, L5 at (½ − μ, ±√3/2)' },
      { label: 'L4/L5 stable if', value: `μ < 0.0385`, theory: `here μ = ${fmt(this.mu, 5)}: ${this.mu < 0.0385 ? 'stable' : 'unstable'}`, tone: 'info' },
    ]
    if (this.ic === 'arenstorf') out.push({ label: 'Arenstorf period', value: `${fmt(ARENSTORF.period, 8)} TU`, theory: `${fmt(this.o.t / ARENSTORF.period, 4)} periods so far` })
    return out
  }
}

// ------------------------------------------------------------------------------------------ figure eight

class Figure8Sim extends OrbitBase {
  readonly mode = 'figure8'
  channels: Channel[] = [...BASE_CHANNELS, { key: 'x1', label: 'x of body 1' }, { key: 'y1', label: 'y of body 1' }, { key: 'dist', label: 'distance of body 1 from its start' }, { key: 'sep12', label: 'separation 1–2' }]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path of body 1', 'x1', [{ key: 'y1' }], 'x', 'y', true),
    timePlot('dist', 'Distance of body 1 from its starting point', [{ key: 'dist' }], 'distance', 'T'),
    timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy', 'T'),
    timePlot('drift', 'Relative energy error', [{ key: 'edrift' }], '|ΔE/E|', 'T'),
    timePlot('lz', 'Angular momentum', [{ key: 'lz' }], 'Lz', 'T'),
  ]
  private readonly start: [number, number]
  private minAfter = Infinity
  private periods = 0

  constructor(params: Params, method: Method) {
    const y0 = new Float64Array(18)
    const k = 1 + num(params, 'perturb', 0)
    for (let i = 0; i < 3; i++) {
      y0[3 * i] = FIGURE8.pos[i][0]
      y0[3 * i + 1] = FIGURE8.pos[i][1]
      y0[9 + 3 * i] = FIGURE8.vel[i][0] * k
      y0[9 + 3 * i + 1] = FIGURE8.vel[i][1] * k
    }
    super(params, method, [
      { name: '1', m: 1, color: COLORS.a, size: 0.05 },
      { name: '2', m: 1, color: COLORS.b, size: 0.05 },
      { name: '3', m: 1, color: COLORS.c, size: 0.05 },
    ], y0, { G: 1, eps: 0 })
    this.start = [FIGURE8.pos[0][0], FIGURE8.pos[0][1]]
    this.lengthUnit = 'L'
    this.timeUnit = 'T'
    this.dt = FIGURE8.period / 3000
    this.realtime = FIGURE8.period / 10
    this.sampleDt = FIGURE8.period / 400
  }

  protected advance(dt: number) {
    this.o.advance(dt)
    const T = FIGURE8.period
    const ph = this.o.t / T
    const k = Math.floor(ph + 0.5)
    if (k > this.periods) { this.periods = k; this.minAfter = Math.hypot(this.pos(0)[0] - this.start[0], this.pos(0)[1] - this.start[1]) }
  }

  sample(): Record<string, number> {
    const p = this.pos(0)
    const q = this.pos(1)
    return { ...this.baseSample(), x1: p[0], y1: p[1], dist: Math.hypot(p[0] - this.start[0], p[1] - this.start[1]), sep12: Math.hypot(p[0] - q[0], p[1] - q[1]) }
  }

  bounds(): Bounds { return { x0: -1.5, x1: 1.5, y0: -1.0, y1: 1.0 } }

  readouts(): Readout[] {
    const p = this.pos(0)
    const T = FIGURE8.period
    return [
      { label: 'Period', value: `${fmt(T, 8)} T`, theory: 'one lap of the eight for each body' },
      { label: 'Elapsed periods', value: fmt(this.o.t / T, 4) },
      { label: 'Body 1 from its start', value: fmt(Math.hypot(p[0] - this.start[0], p[1] - this.start[1]), 4), theory: this.periods > 0 ? `after ${this.periods} full periods: ${fmt(this.minAfter, 3)}` : undefined, tone: 'info' },
      ...super.readouts(),
      { label: 'Stability', value: num(this.params, 'perturb', 0) === 0 ? 'stable only to rounding: it will drift off after many periods' : 'perturbed: watch it break apart', tone: 'info' },
    ]
  }
}

// ------------------------------------------------------------------------------------------ N-body

class NBodySim extends OrbitBase {
  readonly mode = 'nbody'
  channels: Channel[] = [...BASE_CHANNELS, { key: 'rhalf', label: 'half-mass radius' }, { key: 'pdrift', label: 'momentum drift' }, { key: 'ldrift', label: 'angular momentum drift' }, { key: 'vir', label: 'virial ratio 2K/|W|' }]
  plots: PlotSpec[] = [
    timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy', 'T'),
    timePlot('drift', 'Relative energy error', [{ key: 'edrift' }], '|ΔE/E|', 'T'),
    timePlot('mom', 'Momentum drift and angular momentum drift', [{ key: 'pdrift' }, { key: 'ldrift' }], 'drift', 'T'),
    timePlot('rhalf', 'Half-mass radius', [{ key: 'rhalf' }], 'radius', 'T'),
    timePlot('vir', 'Virial ratio', [{ key: 'vir' }], '2K/|W|', 'T'),
  ]
  private p0 = 0
  private spread: number
  threeD = true

  constructor(params: Params, method: Method) {
    const N = Math.round(clamp(num(params, 'N', 120), 2, 300))
    const seed = num(params, 'seed', 3)
    const layout = str(params, 'layout', 'disc')
    const cl = layout === 'cluster' ? plummerCluster(N, seed) : discGalaxy(N, seed)
    const defs: BodyDef[] = cl.m.map((m, i) => ({ name: '', m, color: layout === 'disc' && i === 0 ? STAR : PALETTE[i % PALETTE.length], size: layout === 'disc' && i === 0 ? 0.06 : 0.018, trail: false }))
    super(params, method, defs, cl.y, { G: 1, eps: num(params, 'soft', 0.02), theta: bool(params, 'bh', false) ? num(params, 'theta', 0.5) : 0 })
    this.lengthUnit = 'L'
    this.timeUnit = 'T'
    this.spread = layout === 'disc' ? 2.2 : 1.8
    this.dt = layout === 'disc' ? 0.003 : 0.002
    this.realtime = 0.5
    this.sampleDt = 0.05
    const t = this.totals()
    this.p0 = Math.hypot(t.px, t.py, t.pz)
  }

  step(dt: number) {
    this.opts = { G: 1, eps: num(this.params, 'soft', 0.02), theta: bool(this.params, 'bh', false) ? num(this.params, 'theta', 0.5) : 0 }
    super.step(dt)
  }

  private halfMassRadius(): number {
    const t = this.totals()
    const r: number[] = []
    for (let i = 0; i < this.N; i++) { const p = this.pos(i); r.push(Math.hypot(p[0] - t.cx, p[1] - t.cy, p[2] - t.cz)) }
    r.sort((a, b) => a - b)
    return r[Math.floor(this.N / 2)] ?? 0
  }

  sample(): Record<string, number> {
    const t = this.totals()
    return {
      ...this.baseSample(), rhalf: this.halfMassRadius(), pdrift: Math.hypot(t.px, t.py, t.pz) - this.p0,
      ldrift: Math.abs(t.lz - this.l0) / (Math.abs(this.l0) || 1), vir: t.pe !== 0 ? (2 * t.ke) / Math.abs(t.pe) : 0,
    }
  }

  bounds(): Bounds { const R = this.spread; return { x0: -R, x1: R, y0: -R, y1: R } }

  frame(): Frame {
    const infos = this.bodyInfos()
    return { shapes: this.bodyShapes(infos, false), bodies: infos }
  }

  readouts(): Readout[] {
    const t = this.totals()
    const e = t.ke + t.pe
    const direct = !bool(this.params, 'bh', false)
    return [
      { label: 'Bodies', value: String(this.N), theory: direct ? 'direct sum, N² pairs' : `Barnes–Hut θ = ${fmt(num(this.params, 'theta', 0.5), 2)}` },
      { label: 'Energy drift |ΔE/E|', value: fmt(Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)), 3), tone: Math.abs((e - this.e0) / (Math.abs(this.e0) || 1)) < 1e-3 ? 'ok' : 'warn' },
      { label: 'Momentum |P|', value: fmt(Math.hypot(t.px, t.py, t.pz), 3), theory: `at start ${fmt(this.p0, 3)}` },
      { label: 'Angular momentum Lz', value: fmt(t.lz, 5), theory: `at start ${fmt(this.l0, 5)}` },
      { label: 'Virial ratio 2K/|W|', value: fmt(t.pe !== 0 ? (2 * t.ke) / Math.abs(t.pe) : 0, 3), theory: '1 for a system in equilibrium' },
      { label: 'Half-mass radius', value: fmt(this.halfMassRadius(), 4) },
    ]
  }
}

// ------------------------------------------------------------------------------------------ solar system

class SolarSim extends OrbitBase {
  readonly mode = 'solar'
  channels: Channel[] = [
    ...BASE_CHANNELS,
    { key: 'r_mercury', label: 'Mercury distance', unit: 'AU' }, { key: 'r_venus', label: 'Venus distance', unit: 'AU' }, { key: 'r_earth', label: 'Earth distance', unit: 'AU' }, { key: 'r_mars', label: 'Mars distance', unit: 'AU' },
    { key: 'x_earth', label: 'Earth x', unit: 'AU' }, { key: 'y_earth', label: 'Earth y', unit: 'AU' },
  ]
  plots: PlotSpec[] = [
    timePlot('r', 'Distance from the Sun', [{ key: 'r_mercury', label: 'Mercury' }, { key: 'r_venus', label: 'Venus' }, { key: 'r_earth', label: 'Earth' }, { key: 'r_mars', label: 'Mars' }], 'r (AU)', 'yr'),
    xyPlot('earth', 'Earth\'s orbit', 'x_earth', [{ key: 'y_earth' }], 'x (AU)', 'y (AU)', true),
    timePlot('energy', 'Energies (M☉ AU²/yr²)', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy', 'yr'),
    timePlot('drift', 'Relative energy error', [{ key: 'edrift' }], '|ΔE/E|', 'yr'),
    timePlot('lz', 'Angular momentum', [{ key: 'lz' }], 'Lz', 'yr'),
  ]
  readonly planets = PLANETS
  threeD = true
  private readonly outer: boolean
  private cross = new Map<number, number[]>()
  private prevPhase = new Map<number, number>()

  constructor(params: Params, method: Method) {
    const outer = bool(params, 'outer', false)
    const ps = PLANETS.filter((p) => outer || p.a < 3)
    const N = ps.length + 1
    const m = [1, ...ps.map((p) => p.m)]
    const y = new Float64Array(6 * N)
    ps.forEach((p, i) => {
      const st = stateFromElements(p, G_AU * (1 + p.m))
      for (let k = 0; k < 3; k++) { y[3 * (i + 1) + k] = st.r[k]; y[3 * N + 3 * (i + 1) + k] = st.v[k] }
    })
    toBarycentre(y, m)
    super(params, method, [
      { name: 'Sun', m: 1, color: STAR, size: 0.06, trail: false },
      ...ps.map((p) => ({ name: p.name, m: p.m, color: p.color, size: p.size * (outer ? 3 : 1), trail: true })),
    ], y, { G: G_AU, eps: 0 })
    this.outer = outer
    this.dt = 0.0005
    this.realtime = outer ? 1.2 : 0.5
    this.sampleDt = 0.004
    ps.forEach((_, i) => this.prevPhase.set(i + 1, NaN))
  }

  protected advance(dt: number) {
    this.o.advance(dt)
    // sidereal period of each planet: time between crossings of its starting heliocentric longitude is awkward; use the x-axis crossing going up
    const s = this.pos(0)
    for (let i = 1; i < this.N; i++) {
      const p = this.pos(i)
      const y = p[1] - s[1]
      const x = p[0] - s[0]
      const prev = this.prevPhase.get(i)
      if (prev !== undefined && Number.isFinite(prev) && prev < 0 && y >= 0 && x > 0) {
        const list = this.cross.get(i) ?? []
        list.push(this.o.t - dt * (y / (y - prev)))
        if (list.length > 6) list.shift()
        this.cross.set(i, list)
      }
      this.prevPhase.set(i, y)
    }
  }

  private heliocentric(i: number): number { const p = this.pos(i); const s = this.pos(0); return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) }

  sample(): Record<string, number> {
    const e = this.pos(3)
    const s = this.pos(0)
    return {
      ...this.baseSample(), r_mercury: this.heliocentric(1), r_venus: this.heliocentric(2), r_earth: this.heliocentric(3), r_mars: this.heliocentric(4),
      x_earth: e[0] - s[0], y_earth: e[1] - s[1],
    }
  }

  bounds(): Bounds { const R = this.outer ? 11 : 1.75; return { x0: -R, x1: R, y0: -R, y1: R } }

  frame(): Frame {
    const infos = this.bodyInfos()
    const shapes: Shape[] = []
    const s = this.pos(0)
    // orbits of the planets as the ellipses they started on (dotted)
    for (let i = 1; i < this.N; i++) {
      const p = PLANETS[i - 1]
      const pts: number[][] = []
      for (let k = 0; k <= 120; k++) {
        const E = (k / 120) * 2 * Math.PI
        const xp = p.a * (Math.cos(E) - p.e)
        const yp = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E)
        const om = (p.varpi - p.Omega) * DEG
        const x1 = xp * Math.cos(om) - yp * Math.sin(om)
        const y1 = xp * Math.sin(om) + yp * Math.cos(om)
        const ci = Math.cos(p.i * DEG)
        const co = Math.cos(p.Omega * DEG)
        const so = Math.sin(p.Omega * DEG)
        pts.push([s[0] + x1 * co - y1 * ci * so, s[1] + x1 * so + y1 * ci * co])
      }
      shapes.push({ t: 'path', pts, color: p.color, dash: true, w: 1, alpha: 0.35 })
    }
    shapes.push(...this.bodyShapes(infos, true))
    return { shapes, bodies: infos }
  }

  period(i: number): number | null {
    const c = this.cross.get(i)
    if (!c || c.length < 2) return null
    return (c[c.length - 1] - c[0]) / (c.length - 1)
  }

  readouts(): Readout[] {
    const out: Readout[] = []
    for (let i = 1; i < this.N; i++) {
      const p = PLANETS[i - 1]
      const T = Math.sqrt(p.a ** 3 / (1 + p.m))
      const meas = this.period(i)
      out.push({ label: `${p.name} period`, value: meas ? `${fmt(meas, 5)} yr` : 'measuring…', theory: `Kepler: ${fmt(T, 5)} yr = ${fmt(T * 365.25, 5)} d` })
    }
    out.push(...super.readouts())
    return out
  }
}

// ------------------------------------------------------------------------------------------ definition

export const ORBIT: SceneDef = {
  id: 'orbit',
  name: 'Orbits & gravity',
  blurb: 'Kepler, escape speed, Hohmann transfers, slingshots, three bodies, N bodies and the solar system.',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, MODES.some((m) => m.id === mode) ? mode : 'kepler'),
  presets: (mode): Preset[] => {
    switch (mode) {
      case 'kepler': return [
        { name: 'Circle', params: { ecc: 0, q: 0.001 } }, { name: 'Ellipse (e = 0.6)', params: { ecc: 0.6 } }, { name: 'Halley-like (e = 0.9)', params: { ecc: 0.9, rp: 0.6 } },
        { name: 'Parabola', params: { ecc: 1 } }, { name: 'Hyperbola', params: { ecc: 1.6 } }, { name: 'Binary star (equal masses)', params: { q: 1, ecc: 0.3 } },
      ]
      case 'escape': return [{ name: 'Falls back (0.9)', params: { f: 0.9, launch: 90 } }, { name: 'Just escapes (1.0)', params: { f: 1.0, launch: 90 } }, { name: 'Escapes (1.2)', params: { f: 1.2, launch: 90 } }, { name: 'Circular orbit (0.707)', params: { f: 0.7071, launch: 0 } }]
      case 'hohmann': return [{ name: 'Earth → Mars', params: { r1: 1, r2: 1.524 } }, { name: 'Earth → Venus', params: { r1: 1, r2: 0.723 } }, { name: 'Earth → Jupiter', params: { r1: 1, r2: 5.203 } }, { name: 'Too little first burn', params: { dv1: 85 } }]
      case 'slingshot': return [{ name: 'Gain speed', params: { side: 'behind', b: 0.006 } }, { name: 'Lose speed', params: { side: 'ahead', b: 0.006 } }, { name: 'Distant pass', params: { b: 0.05 } }, { name: 'Heavy planet', params: { pm: 5, b: 0.01 } }]
      case 'restricted3': return [{ name: 'Arenstorf orbit', params: { ic: 'arenstorf' } }, { name: 'Tadpole around L4', params: { ic: 'l4', off: -0.02 } }, { name: 'Wide tadpole', params: { ic: 'l4', off: 0.02 } }, { name: 'Unstable L1', params: { ic: 'l1', off: -0.01 } }, { name: 'Sun–Jupiter Trojans', params: { ic: 'l4', mu: 0.000954, off: 0.02 } }]
      case 'nbody': return [{ name: 'Disc galaxy, 120 bodies', params: { layout: 'disc', N: 120 } }, { name: 'Cluster, 200 bodies', params: { layout: 'cluster', N: 200 } }, { name: '300 bodies with Barnes–Hut', params: { layout: 'cluster', N: 300, bh: true } }]
      default: return [{ name: 'Inner planets', params: { outer: false } }, { name: 'With Jupiter and Saturn', params: { outer: true } }]
    }
  },
  create: (params, method = 'rk4') => {
    switch (str(params, 'mode', 'kepler')) {
      case 'escape': return new EscapeSim(params, method)
      case 'hohmann': return new HohmannSim(params, method)
      case 'slingshot': return new SlingshotSim(params, method)
      case 'restricted3': return new Restricted3Sim(params, method)
      case 'figure8': return new Figure8Sim(params, method)
      case 'nbody': return new NBodySim(params, method)
      case 'solar': return new SolarSim(params, method)
      default: return new KeplerSim(params, method)
    }
  },
}

