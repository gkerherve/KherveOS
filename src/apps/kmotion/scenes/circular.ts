// Scene 7 — circular motion and rotating frames: centripetal force on a string, a car on a banked curve, the conical
// pendulum, the Coriolis force on a turntable (seen from both frames) and a spinning top (gyroscope).

import { Ode2, type Method } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import { COLORS, DEG, bool, clamp, defaultsFor, fmt, num, str, timePlot, xyPlot, wrapPi } from '../common.ts'
import { GRAVITY_CHOICES, gravityOf } from './projectile.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Preset } from '../types.ts'

// ------------------------------------------------------------------------------------------ closed forms

/** Banked curve of radius R, angle theta and friction coefficient mu. Speeds in m/s. */
export function bankedSpeeds(R: number, theta: number, mu: number, g: number) {
  const s = Math.sin(theta)
  const c = Math.cos(theta)
  const ideal = Math.sqrt(R * g * Math.tan(theta))
  const max = c - mu * s > 1e-12 ? Math.sqrt((R * g * (s + mu * c)) / (c - mu * s)) : Infinity
  const min = s - mu * c > 0 ? Math.sqrt((R * g * (s - mu * c)) / (c + mu * s)) : 0
  return { ideal, max, min }
}

/** Normal force and the friction needed (positive: pointing down the slope, towards the centre) for speed v. */
export function bankedForces(m: number, R: number, theta: number, g: number, v: number) {
  const ac = (v * v) / R
  const N = m * (g * Math.cos(theta) + ac * Math.sin(theta))
  const f = m * (ac * Math.cos(theta) - g * Math.sin(theta))
  return { N, f, ac }
}

/** Conical pendulum, steady motion at half-angle theta. */
export function conicalSteady(L: number, g: number, theta: number) {
  return { omega: Math.sqrt(g / (L * Math.cos(theta))), period: 2 * Math.PI * Math.sqrt((L * Math.cos(theta)) / g), tension: 1 / Math.cos(theta) }
}

/** Exact inertial straight line seen from the rotating frame: position at time t. */
export function rotatingFromInertial(Om: number, r0: number[], vRot0: number[], t: number): { x: number; y: number } {
  const vin = [vRot0[0] - Om * r0[1], vRot0[1] + Om * r0[0]] // v_in = v_rot + Ω × r
  const x = r0[0] + vin[0] * t
  const y = r0[1] + vin[1] * t
  const c = Math.cos(-Om * t)
  const s = Math.sin(-Om * t)
  return { x: x * c - y * s, y: x * s + y * c }
}

/** Slow precession rate of a fast top: m g d / (I3 w3). */
export const slowPrecession = (mgd: number, I3: number, w3: number) => mgd / (I3 * w3)

// ------------------------------------------------------------------------------------------ parameters

const MODES = [
  { id: 'centripetal', label: 'Centripetal force', blurb: 'A mass on a string: the force that bends the path. Cut the string and it flies off straight.' },
  { id: 'banked', label: 'Banked curve', blurb: 'A car on a banked road: normal force, friction and the speeds it can take.' },
  { id: 'conical', label: 'Conical pendulum', blurb: 'A bob circling at constant height; start it off-balance to see it wobble.' },
  { id: 'coriolis', label: 'Coriolis (turntable)', blurb: 'A ball crossing a rotating disc: straight from outside, curved from the disc.' },
  { id: 'gyro', label: 'Gyroscope (top)', blurb: 'A spinning top: precession and nutation.' },
]

const PARAMS: ParamDef[] = [
  // centripetal
  { kind: 'number', key: 'm', label: 'Mass', unit: 'kg', min: 0.1, max: 10, step: 0.1, value: 1, modes: ['centripetal', 'banked', 'conical', 'gyro'] },
  { kind: 'number', key: 'R', label: 'Radius', unit: 'm', min: 0.3, max: 5, step: 0.1, value: 2, modes: ['centripetal'] },
  { kind: 'number', key: 'v', label: 'Speed', unit: 'm/s', min: 0.5, max: 15, step: 0.1, value: 6, modes: ['centripetal'], hint: 'The string tension is m v²/R.' },
  { kind: 'bool', key: 'cut', label: 'Cut the string', value: false, modes: ['centripetal'], live: true },
  // banked
  { kind: 'number', key: 'Rb', label: 'Curve radius', unit: 'm', min: 10, max: 200, step: 1, value: 60, modes: ['banked'] },
  { kind: 'number', key: 'bank', label: 'Banking angle', unit: '°', min: 0, max: 45, step: 0.5, value: 15, modes: ['banked'] },
  { kind: 'number', key: 'mu', label: 'Tyre friction μ', min: 0, max: 1.2, step: 0.01, value: 0.3, modes: ['banked'] },
  { kind: 'number', key: 'vb', label: 'Car speed', unit: 'm/s', min: 1, max: 50, step: 0.5, value: 18, modes: ['banked'], live: true },
  // conical
  { kind: 'number', key: 'L', label: 'String length', unit: 'm', min: 0.3, max: 3, step: 0.05, value: 1.2, modes: ['conical'] },
  { kind: 'number', key: 'th0', label: 'Cone half-angle at the start', unit: '°', min: 3, max: 80, step: 1, value: 35, modes: ['conical'] },
  { kind: 'number', key: 'spin', label: 'Speed / steady speed', min: 0, max: 1.8, step: 0.01, value: 1, modes: ['conical'], hint: '1 = perfect cone; other values make the bob rise and fall.' },
  // coriolis
  { kind: 'number', key: 'Om', label: 'Rotation Ω', unit: 'rad/s', min: 0, max: 3, step: 0.01, value: 0.8, modes: ['coriolis'] },
  { kind: 'number', key: 'u', label: 'Launch speed (on the disc)', unit: 'm/s', min: 0.2, max: 8, step: 0.1, value: 3, modes: ['coriolis'] },
  { kind: 'number', key: 'Rd', label: 'Disc radius', unit: 'm', min: 1, max: 10, step: 0.5, value: 5, modes: ['coriolis'] },
  { kind: 'number', key: 'ang', label: 'Launch direction', unit: '°', min: -180, max: 180, step: 1, value: 0, modes: ['coriolis'] },
  { kind: 'number', key: 'r0', label: 'Launch point from the centre', unit: 'm', min: 0, max: 4.5, step: 0.1, value: 0, modes: ['coriolis'] },
  { kind: 'choice', key: 'view', label: 'View from', value: 'rotating', modes: ['coriolis'], live: true, options: [{ value: 'rotating', label: 'the disc (rotating frame)' }, { value: 'inertial', label: 'the ground (inertial frame)' }] },
  // gyro
  { kind: 'number', key: 'd', label: 'Pivot to centre of mass', unit: 'm', min: 0.01, max: 0.3, step: 0.005, value: 0.06, modes: ['gyro'] },
  { kind: 'number', key: 'I3', label: 'Moment about the axis I₃', unit: 'kg·m²', min: 0.0001, max: 0.01, step: 0.0001, scale: 'log', value: 0.0004, modes: ['gyro'], digits: 4 },
  { kind: 'number', key: 'I1', label: 'Moment about the pivot I₁', unit: 'kg·m²', min: 0.0001, max: 0.02, step: 0.0001, scale: 'log', value: 0.0006, modes: ['gyro'], digits: 4 },
  { kind: 'number', key: 'w3', label: 'Spin ω₃', unit: 'rad/s', min: 0, max: 400, step: 1, value: 150, modes: ['gyro'] },
  { kind: 'number', key: 'tilt', label: 'Tilt from vertical', unit: '°', min: 2, max: 150, step: 1, value: 30, modes: ['gyro'] },
  { kind: 'choice', key: 'start', label: 'Released', value: 'rest', modes: ['gyro'], options: [{ value: 'rest', label: 'from rest (nutates)' }, { value: 'steady', label: 'at the slow precession rate' }, { value: 'fast', label: 'at the fast precession rate' }] },
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth', modes: ['banked', 'conical', 'gyro'] },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0.1, max: 100, step: 0.1, value: 9.81, modes: ['banked', 'conical', 'gyro'], when: (p) => p.gravity === 'custom' },
]

const OVERRIDES: Record<string, Params> = {}

// ------------------------------------------------------------------------------------------ centripetal

class CentripetalSim extends SimBase {
  readonly scene = 'circular' as const
  readonly mode = 'centripetal'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm' }, { key: 'r', label: 'distance from the centre', unit: 'm' },
    { key: 'vx', label: 'vx', unit: 'm/s' }, { key: 'vy', label: 'vy', unit: 'm/s' }, { key: 'speed', label: 'speed', unit: 'm/s' }, { key: 'ax', label: 'ax', unit: 'm/s²' }, { key: 'ay', label: 'ay', unit: 'm/s²' },
    { key: 'tension', label: 'string tension', unit: 'N' }, { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
    { key: 'lz', label: 'angular momentum', unit: 'kg·m²/s' }, { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
    { key: 'x_th', label: 'x (closed form)', unit: 'm', analytic: true }, { key: 'y_th', label: 'y (closed form)', unit: 'm', analytic: true },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path', 'x', [{ key: 'y' }, { key: 'y_th', label: 'closed form', dash: true, x: 'x_th' }], 'x (m)', 'y (m)', true),
    timePlot('r', 'Distance from the centre', [{ key: 'r' }], 'r (m)'),
    timePlot('T', 'String tension', [{ key: 'tension' }], 'tension (N)'),
    timePlot('v', 'Speed', [{ key: 'speed' }], 'speed (m/s)'),
    timePlot('energy', 'Energy', [{ key: 'ke', label: 'kinetic' }, { key: 'e', label: 'total' }], 'energy (J)'),
    timePlot('lz', 'Angular momentum', [{ key: 'lz' }], 'L (kg·m²/s)'),
    timePlot('mom', 'Momentum', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
  ]
  o: Ode2
  private cutAt = NaN
  private cutState: number[] | null = null
  private readonly m: number
  private readonly R: number
  private readonly v: number

  constructor(params: Params, method: Method) {
    super(params, method)
    this.m = num(params, 'm', 1)
    this.R = num(params, 'R', 2)
    this.v = num(params, 'v', 6)
    this.conservative = true
    this.o = new Ode2(
      {
        n: 2,
        acc: (_t, y, a) => {
          if (bool(this.params, 'cut', false)) { a[0] = 0; a[1] = 0; return }
          const r2 = y[0] * y[0] + y[1] * y[1]
          const v2 = y[2] * y[2] + y[3] * y[3]
          a[0] = (-v2 / r2) * y[0]
          a[1] = (-v2 / r2) * y[1]
        },
      },
      [this.R, 0, 0, this.v],
      method,
    )
    this.dt = 1 / 240
    this.sampleDt = 0.02
  }

  step(dt: number) {
    this.o.method = this.method
    if (bool(this.params, 'cut', false) && Number.isNaN(this.cutAt)) {
      this.cutAt = this.o.t
      this.cutState = Array.from(this.o.y)
      this.o.invalidate()
    }
    this.o.advance(dt)
    this.t = this.o.t
    if (Math.hypot(this.o.y[0], this.o.y[1]) > this.R * 12) this.finished = true
  }

  energy(): Energy {
    const v2 = this.o.y[2] ** 2 + this.o.y[3] ** 2
    const ke = 0.5 * this.m * v2
    return { ke, pe: 0, total: ke }
  }

  sample(): Record<string, number> {
    const y = this.o.y
    const a = new Float64Array(2)
    this.o.accel(a)
    const th = (this.v / this.R) * this.o.t
    let xt = this.R * Math.cos(th)
    let yt = this.R * Math.sin(th)
    if (this.cutState) {
      const dt = this.o.t - this.cutAt
      xt = this.cutState[0] + this.cutState[2] * dt
      yt = this.cutState[1] + this.cutState[3] * dt
    }
    const e = this.energy()
    return {
      t: this.o.t, x: y[0], y: y[1], r: Math.hypot(y[0], y[1]), vx: y[2], vy: y[3], speed: Math.hypot(y[2], y[3]), ax: a[0], ay: a[1],
      tension: this.m * Math.hypot(a[0], a[1]), ke: e.ke, pe: 0, e: e.total, lz: this.m * (y[0] * y[3] - y[1] * y[2]), px: this.m * y[2], py: this.m * y[3], x_th: xt, y_th: yt,
    }
  }

  bounds(): Bounds {
    const R = this.R * 1.4
    return { x0: -R, x1: R, y0: -R, y1: R }
  }

  frame(): Frame {
    const y = this.o.y
    const a = new Float64Array(2)
    this.o.accel(a)
    const shapes: Shape[] = [
      { t: 'path', pts: Array.from({ length: 121 }, (_, i) => [this.R * Math.cos((i / 120) * 2 * Math.PI), this.R * Math.sin((i / 120) * 2 * Math.PI)]), color: COLORS.rod, dash: true, w: 1, alpha: 0.5 },
    ]
    if (!this.cutState) shapes.push({ t: 'line', x1: 0, y1: 0, x2: y[0], y2: y[1], color: COLORS.rod, w: 2 })
    shapes.push({ t: 'circle', x: 0, y: 0, r: this.R * 0.03, fill: COLORS.fixed })
    shapes.push({ t: 'circle', x: y[0], y: y[1], r: this.R * 0.07 * Math.cbrt(this.m), fill: COLORS.a, stroke: '#0b0b0b' })
    return { shapes, bodies: [{ id: 'mass', x: y[0], y: y[1], vx: y[2], vy: y[3], ax: a[0], ay: a[1], m: this.m, r: this.R * 0.07, color: COLORS.a }], banner: this.cutState ? 'string cut' : undefined }
  }

  readouts(): Readout[] {
    const y = this.o.y
    const r = Math.hypot(y[0], y[1])
    const v = Math.hypot(y[2], y[3])
    const ac = (this.v * this.v) / this.R
    return [
      { label: 'Centripetal acceleration v²/R', value: `${fmt(ac)} m/s²`, theory: `= ω² R = ${fmt((this.v / this.R) ** 2 * this.R)}` },
      { label: 'String tension m v²/R', value: `${fmt(this.m * ac)} N`, theory: `${fmt((this.m * ac) / (this.m * gravityOf({})), 4)} × weight` },
      { label: 'Angular speed ω', value: `${fmt(this.v / this.R)} rad/s`, theory: `period ${fmt((2 * Math.PI * this.R) / this.v)} s` },
      { label: 'Radius now', value: `${fmt(r, 5)} m`, theory: `drift ${fmt(Math.abs(r - this.R), 3)} m (Euler spirals out)`, tone: Math.abs(r - this.R) < 0.01 * this.R ? 'ok' : 'warn' },
      { label: 'Speed now', value: `${fmt(v, 5)} m/s`, theory: `start ${fmt(this.v)}` },
      { label: 'After cutting', value: this.cutState ? 'moves in a straight line (Newton I)' : 'tick “Cut the string”', tone: 'info' },
    ]
  }
}

// ------------------------------------------------------------------------------------------ banked curve

class BankedSim extends SimBase {
  readonly scene = 'circular' as const
  readonly mode = 'banked'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'phi', label: 'angle round the curve', unit: 'rad' }, { key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm' },
    { key: 'speed', label: 'speed', unit: 'm/s' }, { key: 'N', label: 'normal force', unit: 'N' }, { key: 'f', label: 'friction needed', unit: 'N' }, { key: 'fmax', label: 'friction available μN', unit: 'N' },
    { key: 'ac', label: 'centripetal acceleration', unit: 'm/s²' }, { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
    { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
  ]
  plots: PlotSpec[] = [
    xyPlot('path', 'Path (top view)', 'x', [{ key: 'y' }], 'x (m)', 'y (m)', true),
    timePlot('F', 'Forces', [{ key: 'N', label: 'normal' }, { key: 'f', label: 'friction needed' }, { key: 'fmax', label: 'friction available', dash: true }], 'force (N)'),
    timePlot('ac', 'Centripetal acceleration', [{ key: 'ac' }], 'a (m/s²)'),
    timePlot('mom', 'Momentum', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
  ]
  private phi = 0
  conservative = true

  constructor(params: Params, method: Method) {
    super(params, method)
    this.dt = 1 / 120
    this.sampleDt = 0.05
    this.methods = []
  }

  private R() { return num(this.params, 'Rb', 60) }
  private g() { return gravityOf(this.params) }
  private m() { return num(this.params, 'm', 1) }
  private v() { return num(this.params, 'vb', 18) }

  step(dt: number) {
    this.phi += (this.v() / this.R()) * dt
    this.t += dt
  }

  private forces() {
    const th = num(this.params, 'bank', 15) * DEG
    return { th, ...bankedForces(this.m(), this.R(), th, this.g(), this.v()) }
  }

  energy(): Energy {
    const ke = 0.5 * this.m() * this.v() ** 2
    return { ke, pe: 0, total: ke }
  }

  sample(): Record<string, number> {
    const F = this.forces()
    const R = this.R()
    const mu = num(this.params, 'mu', 0.3)
    return {
      t: this.t, phi: this.phi, x: R * Math.cos(this.phi), y: R * Math.sin(this.phi), speed: this.v(), N: F.N, f: F.f, fmax: mu * F.N, ac: F.ac,
      ke: this.energy().ke, pe: 0, e: this.energy().ke, px: -this.m() * this.v() * Math.sin(this.phi), py: this.m() * this.v() * Math.cos(this.phi),
    }
  }

  bounds(): Bounds {
    const R = this.R()
    return { x0: -R * 1.3, x1: R * 4.0, y0: -R * 1.3, y1: R * 1.3 }
  }

  frame(): Frame {
    const R = this.R()
    const F = this.forces()
    const mu = num(this.params, 'mu', 0.3)
    const th = F.th
    const shapes: Shape[] = []
    const ring = (r: number) => Array.from({ length: 121 }, (_, i) => [r * Math.cos((i / 120) * 2 * Math.PI), r * Math.sin((i / 120) * 2 * Math.PI)])
    shapes.push({ t: 'path', pts: ring(R * 0.9), color: COLORS.rod, w: 1, alpha: 0.6 })
    shapes.push({ t: 'path', pts: ring(R * 1.1), color: COLORS.rod, w: 1, alpha: 0.6 })
    const cx = R * Math.cos(this.phi)
    const cy = R * Math.sin(this.phi)
    shapes.push({ t: 'rect', x: cx - R * 0.045, y: cy - R * 0.025, w: R * 0.09, h: R * 0.05, angle: (this.phi + Math.PI / 2) / DEG, fill: COLORS.a, stroke: '#0b0b0b' })
    // cross-section, to the right: the centre of the curve is on the left
    const k = R / 6
    const ox = R * 2.7
    const oy = 0
    const half = 3 * k
    const ramp = [[ox - half, oy - half * Math.tan(th)], [ox + half, oy + half * Math.tan(th)], [ox + half, oy - half * 1.1], [ox - half, oy - half * 1.1]]
    shapes.push({ t: 'poly', pts: ramp, fill: COLORS.fixed, stroke: COLORS.rod, closed: true, alpha: 0.5 })
    const up = [Math.cos(th), Math.sin(th)]
    const nrm = [-Math.sin(th), Math.cos(th)]
    const carW = k * 1.5
    const carH = k * 0.7
    const cc = [ox + nrm[0] * carH / 2, oy + nrm[1] * carH / 2]
    const corners = [[-carW / 2, -carH / 2], [carW / 2, -carH / 2], [carW / 2, carH / 2], [-carW / 2, carH / 2]].map(([a, b]) => [cc[0] + a * up[0] + b * nrm[0], cc[1] + a * up[1] + b * nrm[1]])
    shapes.push({ t: 'poly', pts: corners, fill: COLORS.a, stroke: '#0b0b0b', closed: true })
    const mg = this.m() * this.g()
    const sc = (k * 2.2) / Math.max(mg, F.N, Math.abs(F.f), this.m() * F.ac)
    const cm = [cc[0] + nrm[0] * carH / 2, cc[1] + nrm[1] * carH / 2]
    const arrow = (vx: number, vy: number, color: string, label: string, from = cc) => shapes.push({ t: 'arrow', x1: from[0], y1: from[1], x2: from[0] + vx * sc, y2: from[1] + vy * sc, color, w: 3, label })
    arrow(F.N * nrm[0], F.N * nrm[1], COLORS.d, 'N')
    arrow(0, -mg, COLORS.f, 'mg')
    arrow(-F.f * up[0], -F.f * up[1], COLORS.b, 'f')
    arrow(-this.m() * F.ac, 0, COLORS.theory, 'net: m v²/R', [cm[0] + k * 0.1, cm[1] + k * 1.2])
    shapes.push({ t: 'text', x: ox - half, y: oy - half * 1.1 - k * 0.5, text: 'cross-section (centre of the curve on the left)', color: COLORS.rod, align: 'left' })
    const sp = bankedSpeeds(R, th, mu, this.g())
    const verdict = this.v() > sp.max * 1.0001 ? 'skids outward' : this.v() < sp.min * 0.9999 ? 'slides inward' : 'grips'
    return {
      shapes,
      bodies: [{ id: 'car', x: cx, y: cy, vx: -this.v() * Math.sin(this.phi), vy: this.v() * Math.cos(this.phi), ax: -F.ac * Math.cos(this.phi), ay: -F.ac * Math.sin(this.phi), m: this.m(), r: R * 0.03, color: COLORS.a }],
      banner: verdict,
    }
  }

  readouts(): Readout[] {
    const R = this.R()
    const g = this.g()
    const mu = num(this.params, 'mu', 0.3)
    const F = this.forces()
    const sp = bankedSpeeds(R, F.th, mu, g)
    const v = this.v()
    const verdict = v > sp.max * 1.0001 ? 'skids outward' : v < sp.min * 0.9999 ? 'slides inward' : 'grips the road'
    return [
      { label: 'Ideal speed (no friction needed)', value: `${fmt(sp.ideal)} m/s`, theory: `${fmt(sp.ideal * 3.6)} km/h = √(R g tanθ)` },
      { label: 'Fastest without skidding', value: Number.isFinite(sp.max) ? `${fmt(sp.max)} m/s` : '∞', theory: Number.isFinite(sp.max) ? `${fmt(sp.max * 3.6)} km/h` : 'the bank is steep enough that it never skids' },
      { label: 'Slowest without sliding in', value: `${fmt(sp.min)} m/s`, theory: `${fmt(sp.min * 3.6)} km/h` },
      { label: 'Car', value: verdict, tone: verdict.startsWith('grips') ? 'ok' : 'warn', theory: `now ${fmt(v)} m/s` },
      { label: 'Normal force N', value: `${fmt(F.N)} N`, theory: `weight ${fmt(this.m() * g)} N` },
      { label: 'Friction needed', value: `${fmt(F.f)} N ${F.f >= 0 ? '(down the slope)' : '(up the slope)'}`, theory: `available μN = ${fmt(mu * F.N)} N` },
      { label: 'Centripetal acceleration', value: `${fmt(F.ac)} m/s²`, theory: `${fmt(F.ac / g, 3)} g` },
    ]
  }
}

// ------------------------------------------------------------------------------------------ conical pendulum

class ConicalSim extends SimBase {
  readonly scene = 'circular' as const
  readonly mode = 'conical'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'theta', label: 'cone angle θ', unit: 'rad' }, { key: 'phi', label: 'azimuth φ', unit: 'rad' }, { key: 'wphi', label: 'azimuthal speed φ′', unit: 'rad/s' },
    { key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm' }, { key: 'z', label: 'z', unit: 'm' }, { key: 'tension', label: 'string tension', unit: 'N' },
    { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
    { key: 'lz', label: 'angular momentum Lz', unit: 'kg·m²/s' }, { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' }, { key: 'theta_th', label: 'θ steady', unit: 'rad', analytic: true },
  ]
  plots: PlotSpec[] = [
    timePlot('theta', 'Cone angle θ(t)', [{ key: 'theta' }, { key: 'theta_th', label: 'steady value', dash: true }], 'angle (rad)'),
    xyPlot('top', 'Top view', 'x', [{ key: 'y' }], 'x (m)', 'y (m)', true),
    timePlot('T', 'String tension', [{ key: 'tension' }], 'tension (N)'),
    timePlot('wphi', 'Azimuthal speed φ′', [{ key: 'wphi' }], 'rad/s'),
    timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (J)'),
    timePlot('lz', 'Angular momentum about the vertical', [{ key: 'lz' }], 'Lz'),
    timePlot('mom', 'Momentum', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
  ]
  o: Ode2
  private readonly th0: number
  private readonly w0: number
  private phiCross: number[] = []
  private thMin: number
  private thMax: number

  constructor(params: Params, method: Method) {
    super(params, method)
    this.conservative = true
    this.th0 = clamp(num(params, 'th0', 35), 3, 85) * DEG
    const g = gravityOf(params)
    const L = num(params, 'L', 1.2)
    this.w0 = Math.sqrt(g / (L * Math.cos(this.th0))) * num(params, 'spin', 1)
    this.o = new Ode2(
      {
        n: 2,
        vdep: true,
        acc: (_t, y, a) => {
          const th = Math.max(Math.abs(y[0]), 1e-3)
          const sg = Math.sin(th)
          a[0] = sg * Math.cos(th) * y[3] * y[3] - (this.g() / this.L()) * sg
          a[1] = (-2 * y[2] * y[3] * Math.cos(th)) / sg
        },
      },
      [this.th0, 0, 0, this.w0],
      method,
    )
    this.thMin = this.th0
    this.thMax = this.th0
    this.dt = 1 / 480
    this.sampleDt = 0.02
  }

  private g() { return gravityOf(this.params) }
  private L() { return num(this.params, 'L', 1.2) }
  private m() { return num(this.params, 'm', 1) }

  step(dt: number) {
    this.o.method = this.method
    const phi0 = this.o.y[1]
    this.o.advance(dt)
    this.t = this.o.t
    this.thMin = Math.min(this.thMin, this.o.y[0])
    this.thMax = Math.max(this.thMax, this.o.y[0])
    if (Math.floor(this.o.y[1] / (2 * Math.PI)) > Math.floor(phi0 / (2 * Math.PI))) {
      this.phiCross.push(this.o.t)
      if (this.phiCross.length > 6) this.phiCross.shift()
    }
  }

  energy(): Energy {
    const [th, , wth, wph] = Array.from(this.o.y)
    const L = this.L()
    const ke = 0.5 * this.m() * L * L * (wth * wth + Math.sin(th) ** 2 * wph * wph)
    const pe = -this.m() * this.g() * L * Math.cos(th)
    return { ke, pe, total: ke + pe }
  }

  private pos3() {
    const [th, ph] = [this.o.y[0], this.o.y[1]]
    const L = this.L()
    return [L * Math.sin(th) * Math.cos(ph), L * Math.sin(th) * Math.sin(ph), -L * Math.cos(th)]
  }

  private vel3() {
    const [th, ph, wth, wph] = Array.from(this.o.y)
    const L = this.L()
    return [
      L * (Math.cos(th) * Math.cos(ph) * wth - Math.sin(th) * Math.sin(ph) * wph),
      L * (Math.cos(th) * Math.sin(ph) * wth + Math.sin(th) * Math.cos(ph) * wph),
      L * Math.sin(th) * wth,
    ]
  }

  sample(): Record<string, number> {
    const [th, ph, wth, wph] = Array.from(this.o.y)
    const L = this.L()
    const p = this.pos3()
    const v = this.vel3()
    const e = this.energy()
    return {
      t: this.o.t, theta: th, phi: ph, wphi: wph, x: p[0], y: p[1], z: p[2], tension: this.m() * (this.g() * Math.cos(th) + L * (wth * wth + Math.sin(th) ** 2 * wph * wph)),
      ke: e.ke, pe: e.pe, e: e.total, lz: this.m() * L * L * Math.sin(th) ** 2 * wph, px: this.m() * v[0], py: this.m() * v[1], theta_th: this.th0,
    }
  }

  bounds(): Bounds {
    const L = this.L()
    return { x0: -L * 1.3, x1: L * 3.6, y0: -L * 1.25, y1: L * 1.25 }
  }

  frame(): Frame {
    const L = this.L()
    const p = this.pos3()
    const v = this.vel3()
    const ox = L * 2.2
    const th = this.o.y[0]
    const shapes: Shape[] = [
      { t: 'rect', x: -L * 0.2, y: 0.02, w: L * 0.4, h: L * 0.04, fill: COLORS.fixed },
      { t: 'line', x1: 0, y1: 0, x2: 0, y2: -L * 1.15, color: COLORS.fixed, dash: true, w: 1 },
      { t: 'line', x1: 0, y1: 0, x2: p[0], y2: p[2], color: COLORS.rod, w: 2 },
      { t: 'path', pts: [[-L * Math.sin(this.thMax), -L * Math.cos(this.thMax)], [L * Math.sin(this.thMax), -L * Math.cos(this.thMax)]], color: COLORS.theory, dash: true, w: 1, alpha: 0.6 },
      { t: 'circle', x: p[0], y: p[2], r: L * 0.06 * Math.cbrt(this.m()), fill: COLORS.a, stroke: '#0b0b0b' },
      { t: 'path', pts: Array.from({ length: 121 }, (_, i) => [ox + L * Math.sin(th) * Math.cos((i / 120) * 2 * Math.PI), L * Math.sin(th) * Math.sin((i / 120) * 2 * Math.PI)]), color: COLORS.rod, dash: true, w: 1, alpha: 0.5 },
      { t: 'line', x1: ox, y1: 0, x2: ox + p[0], y2: p[1], color: COLORS.rod, w: 1.5 },
      { t: 'circle', x: ox + p[0], y: p[1], r: L * 0.05 * Math.cbrt(this.m()), fill: COLORS.a, stroke: '#0b0b0b' },
      { t: 'text', x: -L * 0.3, y: -L * 1.2, text: 'side view', color: COLORS.rod },
      { t: 'text', x: ox - L * 0.3, y: -L * 1.2, text: 'top view', color: COLORS.rod },
    ]
    const acc = new Float64Array(2)
    this.o.accel(acc)
    const bodies = [
      { id: 'side', x: p[0], y: p[2], vx: v[0], vy: v[2], ax: 0, ay: 0, m: this.m(), r: L * 0.06, color: COLORS.a, trail: true },
      { id: 'top', x: ox + p[0], y: p[1], vx: v[0], vy: v[1], ax: -((v[0] ** 2 + v[1] ** 2) / Math.max(L * Math.sin(th), 1e-6)) * Math.cos(this.o.y[1]), ay: -((v[0] ** 2 + v[1] ** 2) / Math.max(L * Math.sin(th), 1e-6)) * Math.sin(this.o.y[1]), m: this.m(), r: L * 0.05, color: COLORS.b, trail: true },
    ]
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const L = this.L()
    const g = this.g()
    const st = conicalSteady(L, g, this.th0)
    const c = this.phiCross
    const meas = c.length >= 2 ? (c[c.length - 1] - c[0]) / (c.length - 1) : null
    const steady = Math.abs(num(this.params, 'spin', 1) - 1) < 1e-9
    return [
      { label: 'Steady period 2π√(L cosθ/g)', value: `${fmt(st.period)} s`, theory: `ω = ${fmt(st.omega)} rad/s` },
      { label: 'Measured period', value: meas ? `${fmt(meas)} s` : 'measuring…', theory: steady ? undefined : 'not a steady cone: the angle oscillates' },
      { label: 'Tension / weight', value: `${fmt(1 / Math.cos(this.th0), 4)}`, theory: `T = m g/cosθ = ${fmt(this.m() * g * st.tension)} N` },
      { label: 'Centripetal force m g tanθ', value: `${fmt(this.m() * g * Math.tan(this.th0))} N` },
      { label: 'Cone angle range', value: `${fmt(this.thMin / DEG, 4)}° – ${fmt(this.thMax / DEG, 4)}°`, tone: 'info' },
      { label: 'Higher speed', value: 'the bob rises: the cone opens as speed grows' },
    ]
  }
}

// ------------------------------------------------------------------------------------------ Coriolis

class CoriolisSim extends SimBase {
  readonly scene = 'circular' as const
  readonly mode = 'coriolis'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'x', label: 'x (disc frame)', unit: 'm' }, { key: 'y', label: 'y (disc frame)', unit: 'm' }, { key: 'xi', label: 'x (ground)', unit: 'm' }, { key: 'yi', label: 'y (ground)', unit: 'm' },
    { key: 'vx', label: 'vx (disc)', unit: 'm/s' }, { key: 'vy', label: 'vy (disc)', unit: 'm/s' }, { key: 'speed', label: 'speed (disc)', unit: 'm/s' }, { key: 'speed_in', label: 'speed (ground)', unit: 'm/s' },
    { key: 'acor', label: 'Coriolis acceleration', unit: 'm/s²' }, { key: 'acf', label: 'centrifugal acceleration', unit: 'm/s²' },
    { key: 'ke', label: '½v² (disc frame)', unit: 'J/kg' }, { key: 'pe', label: '−½Ω²r²', unit: 'J/kg' }, { key: 'e', label: 'sum (conserved)', unit: 'J/kg' }, { key: 'ke_in', label: '½v² (ground)', unit: 'J/kg' },
    { key: 'x_th', label: 'x (closed form)', unit: 'm', analytic: true }, { key: 'y_th', label: 'y (closed form)', unit: 'm', analytic: true }, { key: 'err', label: '|numerical − closed form|', unit: 'm', analytic: true },
  ]
  plots: PlotSpec[] = [
    xyPlot('rot', 'Path on the disc', 'x', [{ key: 'y' }, { key: 'y_th', label: 'closed form', dash: true, x: 'x_th' }], 'x (m)', 'y (m)', true),
    xyPlot('in', 'Path on the ground', 'xi', [{ key: 'yi' }], 'x (m)', 'y (m)', true),
    timePlot('a', 'Fictitious accelerations', [{ key: 'acor', label: 'Coriolis 2Ωv' }, { key: 'acf', label: 'centrifugal Ω²r' }], 'a (m/s²)'),
    timePlot('v', 'Speed seen from the disc and from the ground', [{ key: 'speed', label: 'on the disc' }, { key: 'speed_in', label: 'on the ground' }], 'speed (m/s)'),
    timePlot('energy', 'Energy in the rotating frame', [{ key: 'ke', label: '½v²' }, { key: 'pe', label: '−½Ω²r²' }, { key: 'e', label: 'sum' }], 'energy per kg (J/kg)'),
    timePlot('err', 'Error against the closed form', [{ key: 'err' }], 'error (m)'),
  ]
  o: Ode2
  private readonly r0: number[]
  private readonly v0: number[]
  private readonly Om: number
  private readonly Rd: number
  conservative = true

  constructor(params: Params, method: Method) {
    super(params, method)
    this.Om = num(params, 'Om', 0.8)
    this.Rd = num(params, 'Rd', 5)
    const a = num(params, 'ang', 0) * DEG
    const u = num(params, 'u', 3)
    const r0 = Math.min(num(params, 'r0', 0), this.Rd * 0.98)
    this.r0 = [r0, 0]
    this.v0 = [u * Math.cos(a), u * Math.sin(a)]
    const Om = this.Om
    this.o = new Ode2({ n: 2, vdep: true, acc: (_t, y, ac) => { ac[0] = 2 * Om * y[3] + Om * Om * y[0]; ac[1] = -2 * Om * y[2] + Om * Om * y[1] } }, [this.r0[0], this.r0[1], this.v0[0], this.v0[1]], method)
    this.dt = 1 / 480
    this.sampleDt = 0.02
  }

  step(dt: number) {
    this.o.method = this.method
    this.o.advance(dt)
    this.t = this.o.t
    if (Math.hypot(this.o.y[0], this.o.y[1]) > this.Rd) this.finished = true
  }

  energy(): Energy {
    const y = this.o.y
    const ke = 0.5 * (y[2] * y[2] + y[3] * y[3])
    const pe = -0.5 * this.Om * this.Om * (y[0] * y[0] + y[1] * y[1])
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const y = this.o.y
    const t = this.o.t
    const c = Math.cos(this.Om * t)
    const s = Math.sin(this.Om * t)
    const th = rotatingFromInertial(this.Om, this.r0, this.v0, t)
    const vin = [y[2] - this.Om * y[1], y[3] + this.Om * y[0]]
    const e = this.energy()
    return {
      t, x: y[0], y: y[1], xi: y[0] * c - y[1] * s, yi: y[0] * s + y[1] * c, vx: y[2], vy: y[3], speed: Math.hypot(y[2], y[3]), speed_in: Math.hypot(vin[0], vin[1]),
      acor: 2 * this.Om * Math.hypot(y[2], y[3]), acf: this.Om * this.Om * Math.hypot(y[0], y[1]), ke: e.ke, pe: e.pe, e: e.total, ke_in: 0.5 * (vin[0] ** 2 + vin[1] ** 2),
      x_th: th.x, y_th: th.y, err: Math.hypot(y[0] - th.x, y[1] - th.y),
    }
  }

  bounds(): Bounds {
    const R = this.Rd * 1.25
    return { x0: -R, x1: R, y0: -R, y1: R }
  }

  frame(): Frame {
    const inertial = str(this.params, 'view', 'rotating') === 'inertial'
    const y = this.o.y
    const t = this.o.t
    const Om = this.Om
    const th = inertial ? Om * t : 0
    const c = Math.cos(th)
    const s = Math.sin(th)
    const rot = (x: number, yy: number): [number, number] => [x * c - yy * s, x * s + yy * c]
    const shapes: Shape[] = []
    const R = this.Rd
    shapes.push({ t: 'path', pts: Array.from({ length: 121 }, (_, i) => rot(R * Math.cos((i / 120) * 2 * Math.PI), R * Math.sin((i / 120) * 2 * Math.PI))), color: COLORS.rod, w: 2 })
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI
      const p = rot(R * Math.cos(a), R * Math.sin(a))
      shapes.push({ t: 'line', x1: 0, y1: 0, x2: p[0], y2: p[1], color: k === 0 ? COLORS.f : COLORS.rod, w: k === 0 ? 2 : 1, alpha: k === 0 ? 0.9 : 0.35 })
    }
    // the closed-form straight line on the ground, drawn in the current view
    const vin = [this.v0[0] - Om * this.r0[1], this.v0[1] + Om * this.r0[0]]
    const tEnd = (R * 2.2) / Math.max(Math.hypot(vin[0], vin[1]), 0.1)
    if (inertial) {
      shapes.push({ t: 'line', x1: this.r0[0], y1: this.r0[1], x2: this.r0[0] + vin[0] * tEnd, y2: this.r0[1] + vin[1] * tEnd, color: COLORS.theory, dash: true, w: 1, alpha: 0.7 })
    } else {
      const pts: number[][] = []
      for (let i = 0; i <= 80; i++) { const tt = (tEnd * i) / 80; const q = rotatingFromInertial(Om, this.r0, this.v0, tt); if (Math.hypot(q.x, q.y) <= R * 1.3) pts.push([q.x, q.y]) }
      shapes.push({ t: 'path', pts, color: COLORS.theory, dash: true, w: 1, alpha: 0.7 })
    }
    const p = rot(y[0], y[1])
    shapes.push({ t: 'circle', x: p[0], y: p[1], r: R * 0.04, fill: COLORS.a, stroke: '#0b0b0b' })
    const acc = new Float64Array(2)
    this.o.accel(acc)
    const v = inertial ? rot(y[2] - Om * y[1], y[3] + Om * y[0]) : [y[2], y[3]]
    const a = inertial ? [0, 0] : [acc[0], acc[1]]
    // forces seen from the disc: Coriolis -2Ω×v and centrifugal Ω² r (per unit mass, scaled for the arrows)
    if (!inertial) {
      const k = 0.5
      shapes.push({ t: 'arrow', x1: p[0], y1: p[1], x2: p[0] + 2 * Om * y[3] * k, y2: p[1] - 2 * Om * y[2] * k, color: COLORS.b, w: 2, label: 'Coriolis' })
      shapes.push({ t: 'arrow', x1: p[0], y1: p[1], x2: p[0] + Om * Om * y[0] * k, y2: p[1] + Om * Om * y[1] * k, color: COLORS.c, w: 2, label: 'centrifugal' })
    }
    return { shapes, bodies: [{ id: 'ball', x: p[0], y: p[1], vx: v[0], vy: v[1], ax: a[0], ay: a[1], m: 1, r: R * 0.04, color: COLORS.a }], banner: this.finished ? 'left the disc' : undefined }
  }

  readouts(): Readout[] {
    const y = this.o.y
    const s = this.sample()
    const dev = Math.atan2(y[1], y[0]) - Math.atan2(this.v0[1], this.v0[0])
    return [
      { label: 'Coriolis acceleration 2Ωv', value: `${fmt(s.acor)} m/s²` },
      { label: 'Centrifugal acceleration Ω²r', value: `${fmt(s.acf)} m/s²` },
      { label: 'Ground frame', value: 'a straight line at constant speed', theory: `speed ${fmt(s.speed_in)} m/s`, tone: 'info' },
      { label: 'Deflection of the path on the disc', value: `${fmt(wrapPi(dev) / DEG, 3)}°` },
      { label: 'Numerical vs closed form', value: `${fmt(s.err, 3)} m`, tone: s.err < 1e-3 ? 'ok' : 'warn' },
      { label: 'Time to cross the disc', value: `≈ ${fmt(this.Rd / Math.max(Math.hypot(this.v0[0] - this.Om * this.r0[1], this.v0[1] + this.Om * this.r0[0]), 0.01), 3)} s` },
    ]
  }
}

// ------------------------------------------------------------------------------------------ gyroscope

class GyroSim extends SimBase {
  readonly scene = 'circular' as const
  readonly mode = 'gyro'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'theta', label: 'tilt θ', unit: 'rad' }, { key: 'phi', label: 'precession angle φ', unit: 'rad' }, { key: 'wphi', label: 'precession rate φ′', unit: 'rad/s' },
    { key: 'wtheta', label: 'nutation rate θ′', unit: 'rad/s' }, { key: 'x', label: 'x of the tip', unit: 'm' }, { key: 'y', label: 'y of the tip', unit: 'm' }, { key: 'z', label: 'z of the tip', unit: 'm' },
    { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' }, { key: 'lz', label: 'Lz', unit: 'kg·m²/s' },
    { key: 'px', label: 'px of the CM', unit: 'kg·m/s' }, { key: 'py', label: 'py of the CM', unit: 'kg·m/s' }, { key: 'wphi_slow', label: 'slow precession mgd/(I₃ω₃)', unit: 'rad/s', analytic: true },
  ]
  plots: PlotSpec[] = [
    timePlot('theta', 'Tilt θ(t) (nutation)', [{ key: 'theta' }], 'angle (rad)'),
    timePlot('wphi', 'Precession rate φ′(t)', [{ key: 'wphi' }, { key: 'wphi_slow', label: 'mgd/(I₃ω₃)', dash: true }], 'rad/s'),
    xyPlot('tip', 'Path of the axis tip (top view)', 'x', [{ key: 'y' }], 'x (m)', 'y (m)', true),
    timePlot('energy', 'Energies (spin energy excluded)', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], 'energy (J)'),
    timePlot('lz', 'Angular momentum about the vertical', [{ key: 'lz' }], 'Lz'),
  ]
  o: Ode2
  private readonly pphi: number
  private readonly ppsi: number
  private thMin: number
  private thMax: number
  conservative = true

  constructor(params: Params, method: Method) {
    super(params, method)
    const I1 = num(params, 'I1', 0.0006)
    const I3 = num(params, 'I3', 0.0004)
    const w3 = num(params, 'w3', 150)
    const th0 = num(params, 'tilt', 30) * DEG
    this.ppsi = I3 * w3
    const mgd = this.m() * this.g() * num(params, 'd', 0.06)
    const start = str(params, 'start', 'rest')
    let phi0 = 0
    if (start !== 'rest') {
      const disc = this.ppsi * this.ppsi - 4 * I1 * mgd * Math.cos(th0)
      if (disc >= 0 && Math.cos(th0) !== 0) {
        const root = Math.sqrt(disc)
        phi0 = (this.ppsi + (start === 'fast' ? 1 : -1) * root) / (2 * I1 * Math.cos(th0))
        if (start === 'steady' && Math.cos(th0) > 0 && disc >= 0) phi0 = (this.ppsi - root) / (2 * I1 * Math.cos(th0))
      } else phi0 = mgd / Math.max(this.ppsi, 1e-9)
    }
    this.pphi = I1 * Math.sin(th0) ** 2 * phi0 + this.ppsi * Math.cos(th0)
    this.o = new Ode2(
      {
        n: 2,
        vdep: true,
        acc: (_t, y, a) => {
          const th = clamp(y[0], 1e-3, Math.PI - 1e-3)
          const s = Math.sin(th)
          const c = Math.cos(th)
          const I1_ = num(this.params, 'I1', 0.0006)
          const mgd_ = this.m() * this.g() * num(this.params, 'd', 0.06)
          const wp = (this.pphi - this.ppsi * c) / (I1_ * s * s)
          a[0] = (I1_ * wp * wp * s * c - this.ppsi * wp * s + mgd_ * s) / I1_
          // d(φ′)/dt through the conserved momenta
          const dwp = (this.ppsi * s * s * I1_ * 1 - (this.pphi - this.ppsi * c) * 2 * I1_ * s * c) / (I1_ * I1_ * s * s * s * s)
          a[1] = dwp * y[2]
        },
      },
      [th0, 0, 0, phi0],
      method,
    )
    // theta' starts at 0 and phi' as set: the state is [θ, φ, θ′, φ′]
    this.thMin = th0
    this.thMax = th0
    this.dt = 1 / 2000
    this.realtime = 0.5
    this.sampleDt = 0.01
  }

  private g() { return gravityOf(this.params) }
  private m() { return num(this.params, 'm', 0.4) }

  step(dt: number) {
    this.o.method = this.method
    this.o.advance(dt)
    this.t = this.o.t
    // keep φ′ tied to the conserved momenta so that it cannot drift
    const th = clamp(this.o.y[0], 1e-3, Math.PI - 1e-3)
    this.o.y[3] = (this.pphi - this.ppsi * Math.cos(th)) / (num(this.params, 'I1', 0.0006) * Math.sin(th) ** 2)
    this.thMin = Math.min(this.thMin, this.o.y[0])
    this.thMax = Math.max(this.thMax, this.o.y[0])
  }

  energy(): Energy {
    const th = this.o.y[0]
    const wth = this.o.y[2]
    const wph = (this.pphi - this.ppsi * Math.cos(th)) / (num(this.params, 'I1', 0.0006) * Math.sin(th) ** 2)
    const ke = 0.5 * num(this.params, 'I1', 0.0006) * (wth * wth + wph * wph * Math.sin(th) ** 2)
    const pe = this.m() * this.g() * num(this.params, 'd', 0.06) * Math.cos(th)
    return { ke, pe, total: ke + pe }
  }

  private wphi() {
    const th = clamp(this.o.y[0], 1e-3, Math.PI - 1e-3)
    return (this.pphi - this.ppsi * Math.cos(th)) / (num(this.params, 'I1', 0.0006) * Math.sin(th) ** 2)
  }

  sample(): Record<string, number> {
    const th = this.o.y[0]
    const ph = this.o.y[1]
    const d = num(this.params, 'd', 0.06)
    const L = d * 2
    const e = this.energy()
    const wp = this.wphi()
    return {
      t: this.o.t, theta: th, phi: ph, wphi: wp, wtheta: this.o.y[2], x: L * Math.sin(th) * Math.cos(ph), y: L * Math.sin(th) * Math.sin(ph), z: L * Math.cos(th),
      ke: e.ke, pe: e.pe, e: e.total, lz: this.pphi, px: this.m() * d * (Math.cos(th) * Math.cos(ph) * this.o.y[2] - Math.sin(th) * Math.sin(ph) * wp),
      py: this.m() * d * (Math.cos(th) * Math.sin(ph) * this.o.y[2] + Math.sin(th) * Math.cos(ph) * wp),
      wphi_slow: slowPrecession(this.m() * this.g() * d, num(this.params, 'I3', 0.0004), num(this.params, 'w3', 150)),
    }
  }

  bounds(): Bounds {
    const L = num(this.params, 'd', 0.06) * 2
    return { x0: -L * 1.6, x1: L * 4.4, y0: -L * 1.5, y1: L * 1.5 }
  }

  frame(): Frame {
    const d = num(this.params, 'd', 0.06)
    const L = d * 2
    const th = this.o.y[0]
    const ph = this.o.y[1]
    const a = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]
    const ox = L * 3
    const shapes: Shape[] = [
      { t: 'line', x1: 0, y1: 0, x2: 0, y2: L * 1.2, color: COLORS.fixed, dash: true, w: 1 },
      { t: 'line', x1: 0, y1: 0, x2: a[0] * L, y2: a[2] * L, color: COLORS.rod, w: 3 },
      // the rotor: a disc seen edge-on in the side view, an ellipse in the top view
      { t: 'poly', pts: [[a[0] * d * 1.3 + Math.cos(th) * Math.cos(ph) * d * 0.9, a[2] * d * 1.3 - Math.sin(th) * d * 0.9], [a[0] * d * 1.3 - Math.cos(th) * Math.cos(ph) * d * 0.9, a[2] * d * 1.3 + Math.sin(th) * d * 0.9]], stroke: COLORS.a, w: 6, closed: false },
      { t: 'circle', x: a[0] * d, y: a[2] * d, r: d * 0.07, fill: COLORS.f },
      { t: 'circle', x: a[0] * L, y: a[2] * L, r: d * 0.08, fill: COLORS.a },
      { t: 'circle', x: 0, y: 0, r: d * 0.06, fill: COLORS.fixed },
      { t: 'circle', x: ox, y: 0, r: d * 0.06, fill: COLORS.fixed },
      { t: 'line', x1: ox, y1: 0, x2: ox + a[0] * L, y2: a[1] * L, color: COLORS.rod, w: 2 },
      { t: 'circle', x: ox + a[0] * L, y: a[1] * L, r: d * 0.08, fill: COLORS.a },
      { t: 'path', pts: Array.from({ length: 61 }, (_, i) => [ox + Math.sin(th) * L * Math.cos((i / 60) * 2 * Math.PI), Math.sin(th) * L * Math.sin((i / 60) * 2 * Math.PI)]), color: COLORS.rod, dash: true, w: 1, alpha: 0.4 },
      { t: 'text', x: -L * 0.9, y: -L * 1.4, text: 'side view', color: COLORS.rod },
      { t: 'text', x: ox - L * 0.9, y: -L * 1.4, text: 'top view (tip path)', color: COLORS.rod },
    ]
    return {
      shapes,
      bodies: [
        { id: 'tip', x: a[0] * L, y: a[2] * L, vx: 0, vy: 0, ax: 0, ay: 0, m: this.m(), r: d * 0.08, color: COLORS.a, trail: false },
        { id: 'tiptop', x: ox + a[0] * L, y: a[1] * L, vx: 0, vy: 0, ax: 0, ay: 0, m: 0, r: d * 0.08, color: COLORS.b, trail: true },
      ],
    }
  }

  readouts(): Readout[] {
    const I1 = num(this.params, 'I1', 0.0006)
    const I3 = num(this.params, 'I3', 0.0004)
    const w3 = num(this.params, 'w3', 150)
    const d = num(this.params, 'd', 0.06)
    const mgd = this.m() * this.g() * d
    const th0 = num(this.params, 'tilt', 30) * DEG
    const disc = this.ppsi * this.ppsi - 4 * I1 * mgd * Math.cos(th0)
    return [
      { label: 'Slow precession mgd/(I₃ω₃)', value: `${fmt(slowPrecession(mgd, I3, w3))} rad/s`, theory: `period ${fmt((2 * Math.PI) / slowPrecession(mgd, I3, w3))} s` },
      { label: 'Precession rate now', value: `${fmt(this.wphi())} rad/s` },
      { label: 'Nutation frequency ≈ I₃ω₃/I₁', value: `${fmt(this.ppsi / I1)} rad/s`, theory: `period ${fmt((2 * Math.PI * I1) / this.ppsi)} s` },
      { label: 'Fast-top condition', value: disc >= 0 ? 'satisfied' : 'violated: it falls', theory: '(I₃ω₃)² ≥ 4 I₁ m g d cosθ', tone: disc >= 0 ? 'ok' : 'warn' },
      { label: 'Tilt range', value: `${fmt(this.thMin / DEG, 4)}° – ${fmt(this.thMax / DEG, 4)}°`, tone: 'info' },
      { label: 'Torque from gravity', value: `${fmt(mgd * Math.sin(this.o.y[0]))} N·m` },
    ]
  }
}

// ------------------------------------------------------------------------------------------ definition

export const CIRCULAR: SceneDef = {
  id: 'circular',
  name: 'Circular motion & rotating frames',
  blurb: 'Centripetal force, banked curves, the conical pendulum, the Coriolis force and a spinning top.',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, MODES.some((m) => m.id === mode) ? mode : 'centripetal', OVERRIDES[mode] ?? (mode === 'gyro' ? { m: 0.4 } : {})),
  presets: (mode): Preset[] => {
    switch (mode) {
      case 'centripetal': return [{ name: 'Fast and tight', params: { R: 1, v: 9 } }, { name: 'Slow and wide', params: { R: 4, v: 3 } }, { name: 'Cut at the start', params: { cut: true } }]
      case 'banked': return [{ name: 'Ideal speed', params: { vb: 12.6, bank: 15, mu: 0 } }, { name: 'Too fast', params: { vb: 24 } }, { name: 'Icy road', params: { mu: 0.05, bank: 10, vb: 25 } }, { name: 'Flat road', params: { bank: 0, mu: 0.7, vb: 18 } }]
      case 'conical': return [{ name: 'Steady cone', params: { spin: 1 } }, { name: 'Too slow: dips', params: { spin: 0.5 } }, { name: 'Too fast: rises', params: { spin: 1.4 } }, { name: 'Becomes a plane pendulum', params: { spin: 0, th0: 40 } }]
      case 'coriolis': return [{ name: 'Slow turntable', params: { Om: 0.4 } }, { name: 'Fast turntable', params: { Om: 1.5, u: 4 } }, { name: 'Aim at the target', params: { Om: 0.8, ang: 30 } }, { name: 'Ground view', params: { view: 'inertial' } }]
      default: return [{ name: 'Fast top: slow precession', params: { start: 'steady', w3: 200 } }, { name: 'Released from rest: nutation', params: { start: 'rest', w3: 150 } }, { name: 'Slow spin', params: { w3: 40, start: 'rest' } }]
    }
  },
  create: (params, method = 'rk4') => {
    switch (str(params, 'mode', 'centripetal')) {
      case 'banked': return new BankedSim(params, method)
      case 'conical': return new ConicalSim(params, method)
      case 'coriolis': return new CoriolisSim(params, method)
      case 'gyro': return new GyroSim(params, method)
      default: return new CentripetalSim(params, method)
    }
  },
}
