// Scene 1 — projectile motion: launch speed, angle and height, gravity of several worlds, linear or quadratic air drag,
// wind and a target. The closed form of the vacuum flight is drawn and read out beside the simulation, and the
// angle of greatest range is searched numerically (it is 45 degrees only in vacuum from the ground).

import { Ode2, type Method, type System2 } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import {
  COLORS, DEG, G_EARTH, G_JUPITER, G_MARS, G_MOON, clamp, defaultsFor, energyPlot, fmt, num, str, timePlot, xyPlot,
} from '../common.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Preset } from '../types.ts'

export const GRAVITY_CHOICES = [
  { value: 'earth', label: 'Earth (9.81 m/s²)' },
  { value: 'moon', label: 'Moon (1.62 m/s²)' },
  { value: 'mars', label: 'Mars (3.71 m/s²)' },
  { value: 'jupiter', label: 'Jupiter (24.79 m/s²)' },
  { value: 'custom', label: 'Custom…' },
]

export function gravityOf(p: Params, key = 'gravity', customKey = 'gcustom'): number {
  switch (str(p, key, 'earth')) {
    case 'moon': return G_MOON
    case 'mars': return G_MARS
    case 'jupiter': return G_JUPITER
    case 'custom': return clamp(num(p, customKey, G_EARTH), 0.01, 500)
    default: return G_EARTH
  }
}

export interface VacuumFlight {
  range: number
  tof: number
  apex: number
  tApex: number
  vImpact: number
  /** Angle below the horizontal at impact, degrees. */
  impactAngle: number
}

/** The closed form of a flight in vacuum from height h0 (y up, ground at y = 0). */
export function projectileVacuum(v0: number, angleDeg: number, h0: number, g: number): VacuumFlight {
  const th = angleDeg * DEG
  const vx = v0 * Math.cos(th)
  const vy = v0 * Math.sin(th)
  const tof = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g
  const tApex = Math.max(0, vy / g)
  const vyEnd = vy - g * tof
  return {
    range: vx * tof,
    tof,
    apex: h0 + (vy > 0 ? (vy * vy) / (2 * g) : 0),
    tApex,
    vImpact: Math.hypot(vx, vyEnd),
    impactAngle: Math.atan2(-vyEnd, vx) / DEG,
  }
}

/** Launch angle of the greatest range in vacuum from height h0: atan(v / sqrt(v² + 2 g h)). */
export const vacuumOptimalAngle = (v0: number, h0: number, g: number) => Math.atan(v0 / Math.sqrt(v0 * v0 + 2 * g * h0)) / DEG

function system(p: Params, g: () => number): System2 {
  const drag = str(p, 'drag', 'none')
  return {
    n: 2,
    vdep: drag !== 'none',
    acc(_t, y, a) {
      const w = num(p, 'wind', 0)
      const rx = y[2] - w
      const ry = y[3]
      const s = Math.hypot(rx, ry)
      const d = str(p, 'drag', 'none')
      const k = d === 'linear' ? num(p, 'k', 0.3) : 0
      const kq = d === 'quadratic' ? num(p, 'kq', 0.005) : 0
      a[0] = -k * rx - kq * s * rx
      a[1] = -g() - k * ry - kq * s * ry
    },
  }
}

export interface FlightResult {
  range: number
  tof: number
  apex: number
  tApex: number
  vImpact: number
  impactAngle: number
  landed: boolean
}

/** Runs one flight to the ground without any drawing (the optimal-angle search, the AI tool, the tests). */
export function simulateFlight(p: Params, angleDeg: number, method: Method = 'rk4', dt = 1 / 500, maxT = 600): FlightResult {
  const g = gravityOf(p)
  const v0 = num(p, 'v0', 20)
  const h0 = num(p, 'h0', 0)
  const th = angleDeg * DEG
  const q = new Projectile(p, method, v0 * Math.cos(th), v0 * Math.sin(th), h0, g)
  while (!q.landed && q.o.t < maxT) q.advance(dt)
  return { range: q.o.y[0], tof: q.o.t, apex: q.apex, tApex: q.tApex, vImpact: Math.hypot(q.o.y[2], q.o.y[3]), impactAngle: Math.atan2(-q.o.y[3], q.o.y[2]) / DEG, landed: q.landed }
}

/** The angle of greatest range by golden-section search on the simulated flight (degrees, range). */
export function optimalAngle(p: Params, method: Method = 'rk4'): { angle: number; range: number } {
  const f = (a: number) => simulateFlight(p, a, method, 1 / 400).range
  let lo = 0.5
  let hi = 89.5
  const gr = (Math.sqrt(5) - 1) / 2
  let c = hi - gr * (hi - lo)
  let d = lo + gr * (hi - lo)
  let fc = f(c)
  let fd = f(d)
  for (let i = 0; i < 36 && hi - lo > 0.005; i++) {
    if (fc > fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = f(c) } else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = f(d) }
  }
  const angle = (lo + hi) / 2
  return { angle, range: f(angle) }
}

/** One body in flight: the state, the ground contact and the apex. */
class Projectile {
  o: Ode2
  landed = false
  apex: number
  tApex = 0
  private readonly gf: () => number
  constructor(p: Params, method: Method, vx: number, vy: number, h0: number, g: number | (() => number)) {
    this.gf = typeof g === 'function' ? g : () => g
    this.o = new Ode2(system(p, () => this.gf()), [0, h0, vx, vy], method)
    this.apex = h0
  }
  /** Moves dt; stops exactly on the ground (bisection on the step). */
  advance(dt: number) {
    if (this.landed) return
    const o = this.o
    const prev = Float64Array.from(o.y)
    const t0 = o.t
    o.advance(dt)
    if (o.y[1] < 0 && o.t > 0) {
      let lo = 0
      let hi = dt
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        o.y.set(prev)
        o.t = t0
        o.invalidate()
        o.advance(mid)
        if (o.y[1] < 0) hi = mid
        else lo = mid
      }
      o.y.set(prev)
      o.t = t0
      o.invalidate()
      o.advance(hi)
      o.y[1] = 0
      this.landed = true
    }
    if (o.y[1] > this.apex) {
      this.apex = o.y[1]
      this.tApex = o.t
    }
  }
}

const PARAMS: ParamDef[] = [
  { kind: 'number', key: 'v0', label: 'Launch speed', unit: 'm/s', min: 0.5, max: 200, step: 0.5, value: 20 },
  { kind: 'number', key: 'angle', label: 'Launch angle', unit: '°', min: 0, max: 90, step: 0.5, value: 45, modes: ['flight'] },
  { kind: 'number', key: 'h0', label: 'Launch height', unit: 'm', min: 0, max: 100, step: 0.5, value: 0 },
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth', live: true },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0.1, max: 100, step: 0.1, value: 9.81, live: true, when: (p) => p.gravity === 'custom' },
  {
    kind: 'choice', key: 'drag', label: 'Air drag', value: 'none', live: true,
    options: [{ value: 'none', label: 'None (vacuum)' }, { value: 'linear', label: 'Linear (−k v)' }, { value: 'quadratic', label: 'Quadratic (−c |v| v)' }],
  },
  { kind: 'number', key: 'k', label: 'Linear drag k', unit: '1/s', min: 0.01, max: 3, step: 0.01, scale: 'log', value: 0.3, live: true, when: (p) => p.drag === 'linear', hint: 'Drag acceleration = −k (v − wind). k = b/m.' },
  { kind: 'number', key: 'kq', label: 'Quadratic drag c', unit: '1/m', min: 0.0002, max: 0.1, step: 0.0001, scale: 'log', value: 0.005, live: true, when: (p) => p.drag === 'quadratic', hint: 'Drag acceleration = −c |v − w| (v − w), c = ½ρ·Cd·A / m (a baseball: about 0.006).', digits: 4 },
  { kind: 'number', key: 'wind', label: 'Wind (+ tailwind)', unit: 'm/s', min: -30, max: 30, step: 0.5, value: 0, live: true, when: (p) => p.drag !== 'none', hint: 'Horizontal air speed; it only matters with drag.' },
  { kind: 'number', key: 'mass', label: 'Mass', unit: 'kg', min: 0.01, max: 100, step: 0.01, scale: 'log', value: 1 },
  { kind: 'number', key: 'target', label: 'Target distance (0 = none)', unit: 'm', min: 0, max: 600, step: 1, value: 0 },
  { kind: 'number', key: 'targetR', label: 'Target radius', unit: 'm', min: 0.2, max: 20, step: 0.1, value: 2, when: (p) => num(p, 'target', 0) > 0 },
]

const FAN = [15, 30, 45, 60, 75]
const mkChannels = (): Channel[] => [
  { key: 't', label: 'time', unit: 's' },
  { key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm' },
  { key: 'vx', label: 'vx', unit: 'm/s' }, { key: 'vy', label: 'vy', unit: 'm/s' }, { key: 'speed', label: 'speed', unit: 'm/s' },
  { key: 'ax', label: 'ax', unit: 'm/s²' }, { key: 'ay', label: 'ay', unit: 'm/s²' },
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
  { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
  { key: 'xv', label: 'x (vacuum)', unit: 'm', analytic: true }, { key: 'yv', label: 'y (vacuum)', unit: 'm', analytic: true }, { key: 'vyv', label: 'vy (vacuum)', unit: 'm/s', analytic: true },
]

const PLOTS: PlotSpec[] = [
  xyPlot('traj', 'Trajectory', 'x', [{ key: 'y', label: 'with drag / wind' }, { key: 'yv', label: 'vacuum', dash: true, x: 'xv' }], 'x (m)', 'y (m)', true),
  timePlot('xt', 'x(t)', [{ key: 'x' }, { key: 'xv', label: 'vacuum', dash: true }], 'x (m)'),
  timePlot('yt', 'y(t)', [{ key: 'y' }, { key: 'yv', label: 'vacuum', dash: true }], 'y (m)'),
  timePlot('vt', 'v(t)', [{ key: 'vx' }, { key: 'vy' }, { key: 'vyv', label: 'vy (vacuum)', dash: true }, { key: 'speed' }], 'velocity (m/s)'),
  timePlot('at', 'a(t)', [{ key: 'ax' }, { key: 'ay' }], 'acceleration (m/s²)'),
  energyPlot(),
  timePlot('mom', 'Momentum', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
]

class ProjectileSim extends SimBase {
  readonly scene = 'projectile' as const
  readonly mode: string
  channels = mkChannels()
  plots = PLOTS
  readonly bodies: Projectile[]
  readonly angles: number[]
  private readonly v0: number
  private readonly h0: number
  private readonly m: number
  private opt: { key: string; angle: number; range: number } | null = null
  private hit: boolean | null = null

  constructor(params: Params, method: Method) {
    super(params, method)
    this.mode = str(params, 'mode', 'flight')
    this.v0 = num(params, 'v0', 20)
    this.h0 = num(params, 'h0', 0)
    this.m = num(params, 'mass', 1)
    this.angles = this.mode === 'fan' ? FAN : [num(params, 'angle', 45)]
    this.bodies = this.angles.map((a) => new Projectile(this.params, method, this.v0 * Math.cos(a * DEG), this.v0 * Math.sin(a * DEG), this.h0, () => this.g()))
    this.sampleDt = 0.02
    this.timeUnit = 's'
  }

  private g() { return gravityOf(this.params) }
  private get main() { return this.bodies[this.mode === 'fan' ? 2 : 0] }
  private get mainAngle() { return this.angles[this.mode === 'fan' ? 2 : 0] }

  step(dt: number) {
    let any = false
    for (const b of this.bodies) {
      b.o.method = this.method
      b.advance(dt)
      if (!b.landed) any = true
    }
    this.t = this.main.o.t
    if (!any) this.finished = true
    if (this.main.landed && this.hit === null) {
      const D = num(this.params, 'target', 0)
      this.hit = D > 0 ? Math.abs(this.main.o.y[0] - D) <= num(this.params, 'targetR', 2) : null
    }
  }

  private vacuum(t: number, angle = this.mainAngle) {
    const g = this.g()
    const th = angle * DEG
    const vx = this.v0 * Math.cos(th)
    const vy = this.v0 * Math.sin(th)
    const tof = projectileVacuum(this.v0, angle, this.h0, g).tof
    const tt = Math.min(t, tof)
    return { x: vx * tt, y: this.h0 + vy * tt - 0.5 * g * tt * tt, vy: t > tof ? NaN : vy - g * t }
  }

  sample(): Record<string, number> {
    const [x, y, vx, vy] = this.main.o.y
    const acc = new Float64Array(2)
    if (!this.main.landed) this.main.o.accel(acc)
    const vac = this.vacuum(this.main.o.t)
    const e = this.energy()!
    return {
      t: this.main.o.t, x, y, vx, vy, speed: Math.hypot(vx, vy), ax: acc[0], ay: acc[1],
      ke: e.ke, pe: e.pe, e: e.total, px: this.m * vx, py: this.m * vy, xv: vac.x, yv: vac.y, vyv: vac.vy,
    }
  }

  energy(): Energy {
    const [, y, vx, vy] = this.main.o.y
    const ke = 0.5 * this.m * (vx * vx + vy * vy)
    const pe = this.m * this.g() * y
    return { ke, pe, total: ke + pe }
  }

  private fanRange() { return projectileVacuum(this.v0, 45, this.h0, this.g()).range }

  bounds(): Bounds {
    const g = this.g()
    const v = projectileVacuum(this.v0, this.mainAngle, this.h0, g)
    const R = Math.max(v.range, this.mode === 'fan' ? this.fanRange() : 0, num(this.params, 'target', 0) * 1.05, this.v0 * 0.2, 2)
    const H = Math.max(v.apex, this.mode === 'fan' ? projectileVacuum(this.v0, 75, this.h0, g).apex : 0, R * 0.08)
    return { x0: -R * 0.06, x1: R * 1.06, y0: -H * 0.14, y1: H * 1.2 }
  }

  frame(): Frame {
    const g = this.g()
    const b = this.bounds()
    const r = Math.max(0.2, (b.x1 - b.x0) * 0.008)
    const shapes: Shape[] = [{ t: 'ground', y: 0, x1: b.x0 - 1e3, x2: b.x1 + 1e3 }]
    // the vacuum curve, dashed, for each launch angle
    for (const a of this.angles) {
      const v = projectileVacuum(this.v0, a, this.h0, g)
      const pts: number[][] = []
      const n = 80
      for (let i = 0; i <= n; i++) {
        const q = this.vacuum((v.tof * i) / n, a)
        pts.push([q.x, q.y])
      }
      shapes.push({ t: 'path', pts, color: COLORS.theory, dash: true, w: 1, alpha: 0.7 })
    }
    const D = num(this.params, 'target', 0)
    if (D > 0) {
      const R = num(this.params, 'targetR', 2)
      shapes.push({ t: 'rect', x: D - R, y: 0, w: 2 * R, h: Math.max(R * 0.15, r * 0.6), fill: COLORS.f, alpha: 0.8 })
      shapes.push({ t: 'circle', x: D, y: 0, r: R, fill: COLORS.f, stroke: COLORS.f, alpha: 0.12, ring: true })
      shapes.push({ t: 'text', x: D, y: -R * 1.4, text: 'target', color: COLORS.f, align: 'center' })
    }
    // launch pad
    if (this.h0 > 0) shapes.push({ t: 'rect', x: -r * 3, y: 0, w: r * 3, h: this.h0, fill: COLORS.fixed, alpha: 0.7 })
    this.bodies.forEach((p, i) => {
      shapes.push({ t: 'circle', x: p.o.y[0], y: p.o.y[1], r, fill: i === (this.mode === 'fan' ? 2 : 0) ? COLORS.a : [COLORS.b, COLORS.d, COLORS.a, COLORS.c, COLORS.e][i % 5] })
    })
    const bodies = this.bodies.map((p, i) => {
      const acc = new Float64Array(2)
      if (!p.landed) p.o.accel(acc)
      return {
        id: `p${i}`, x: p.o.y[0], y: p.o.y[1], vx: p.o.y[2], vy: p.o.y[3], ax: acc[0], ay: acc[1], m: this.m, r,
        color: [COLORS.b, COLORS.d, COLORS.a, COLORS.c, COLORS.e][i % 5], name: this.mode === 'fan' ? `${this.angles[i]}°` : undefined,
      }
    })
    const banner = this.hit === true ? 'Target hit!' : this.hit === false ? `Missed the target by ${fmt(Math.abs(this.main.o.y[0] - D), 3)} m` : undefined
    return { shapes, bodies, banner }
  }

  readouts(): Readout[] {
    const g = this.g()
    const v = projectileVacuum(this.v0, this.mainAngle, this.h0, g)
    const m = this.main
    const out: Readout[] = []
    const done = m.landed
    out.push({ label: 'Range', value: done ? `${fmt(m.o.y[0])} m` : `${fmt(m.o.y[0])} m …`, theory: `${fmt(v.range)} m (vacuum)` })
    out.push({ label: 'Time of flight', value: done ? `${fmt(m.o.t)} s` : `${fmt(m.o.t)} s …`, theory: `${fmt(v.tof)} s` })
    out.push({ label: 'Apex height', value: `${fmt(m.apex)} m`, theory: `${fmt(v.apex)} m` })
    out.push({ label: 'Time of apex', value: `${fmt(m.tApex)} s`, theory: `${fmt(v.tApex)} s` })
    if (done) out.push({ label: 'Impact speed', value: `${fmt(Math.hypot(m.o.y[2], m.o.y[3]))} m/s`, theory: `${fmt(v.vImpact)} m/s` })
    if (done) out.push({ label: 'Impact angle', value: `${fmt(Math.atan2(-m.o.y[3], m.o.y[2]) / DEG, 3)}° below horizontal`, theory: `${fmt(v.impactAngle, 3)}°` })
    if (this.mode === 'flight') {
      const key = JSON.stringify([this.params.v0, this.params.h0, this.params.gravity, this.params.gcustom, this.params.drag, this.params.k, this.params.kq, this.params.wind])
      if (!this.opt || this.opt.key !== key) {
        const o = optimalAngle(this.params)
        this.opt = { key, ...o }
      }
      out.push({ label: 'Best angle for range', value: `${fmt(this.opt.angle, 3)}° → ${fmt(this.opt.range)} m`, theory: `${fmt(vacuumOptimalAngle(this.v0, this.h0, g), 3)}° (vacuum)`, tone: 'info' })
    } else {
      this.angles.forEach((a, i) => out.push({ label: `Range at ${a}°`, value: `${fmt(this.bodies[i].o.y[0])} m${this.bodies[i].landed ? '' : ' …'}` }))
    }
    if (this.hit !== null) out.push({ label: 'Target', value: this.hit ? 'hit' : 'missed', tone: this.hit ? 'ok' : 'warn' })
    return out
  }

  status() { return `g = ${fmt(this.g(), 4)} m/s²` }
}

export const PROJECTILE: SceneDef = {
  id: 'projectile',
  name: 'Projectile',
  blurb: 'Launch speed, angle and height; gravity of other worlds; air drag and wind; a target.',
  modes: [
    { id: 'flight', label: 'One launch', blurb: 'A single projectile against its vacuum parabola.' },
    { id: 'fan', label: 'Angle fan', blurb: 'Five angles at once: which one goes farthest?' },
  ],
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, mode === 'fan' ? 'fan' : 'flight'),
  presets: (): Preset[] => [
    { name: 'Vacuum, 45°', params: { drag: 'none', angle: 45, v0: 20, h0: 0, gravity: 'earth' } },
    { name: 'Baseball with drag', params: { drag: 'quadratic', kq: 0.006, v0: 40, angle: 35, h0: 1, gravity: 'earth' } },
    { name: 'Moon golf shot', params: { drag: 'none', v0: 40, angle: 45, gravity: 'moon', h0: 0 } },
    { name: 'Cannon from a cliff', params: { drag: 'none', v0: 30, angle: 20, h0: 60, gravity: 'earth' } },
    { name: 'Heavy wind', params: { drag: 'linear', k: 0.4, wind: -10, v0: 30, angle: 50, h0: 0 } },
  ],
  create: (params, method = 'rk4') => new ProjectileSim(params, method),
}

