// Scene 4 — collisions: 1-D and 2-D collisions with a coefficient of restitution (event driven, so a hit happens at
// its exact time), momentum and kinetic-energy bookkeeping, a billiard rack, Newton's cradle (rigid bodies with
// planck) and the ballistic pendulum.

import { Ode2, type Method } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import { COLORS, DEG, defaultsFor, fmt, num, rng, str, timePlot, xyPlot, bool, wrapPi } from '../common.ts'
import { GRAVITY_CHOICES, gravityOf } from './projectile.ts'
import { cradleSim } from './sandbox.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, Shape, Preset } from '../types.ts'

// ------------------------------------------------------------------------------------------ closed forms

export interface Collision1D {
  v1: number
  v2: number
  /** Kinetic energy lost in the collision. */
  keLost: number
  keBefore: number
  keAfter: number
}

/** Head-on collision with coefficient of restitution e (1 elastic, 0 perfectly inelastic). */
export function collide1D(m1: number, m2: number, v1: number, v2: number, e: number): Collision1D {
  const M = m1 + m2
  const w1 = ((m1 - e * m2) * v1 + (1 + e) * m2 * v2) / M
  const w2 = ((m2 - e * m1) * v2 + (1 + e) * m1 * v1) / M
  const keBefore = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2
  const keAfter = 0.5 * m1 * w1 * w1 + 0.5 * m2 * w2 * w2
  return { v1: w1, v2: w2, keLost: keBefore - keAfter, keBefore, keAfter }
}

/** Ballistic pendulum: speed of the bullet from the height h the block rises to, and the other way round. */
export const ballisticSpeed = (m: number, M: number, h: number, g: number) => ((m + M) / m) * Math.sqrt(2 * g * h)
export const ballisticHeight = (m: number, M: number, v: number, g: number) => ((m * v) / (m + M)) ** 2 / (2 * g)

// ------------------------------------------------------------------------------------------ the circle world

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  m: number
  r: number
  color: string
  name: string
}

export interface HitRecord {
  t: number
  i: number
  j: number
  /** Totals just before and just after (the whole system). */
  pBefore: [number, number]
  pAfter: [number, number]
  keBefore: number
  keAfter: number
  /** Relative normal speed before and after. */
  unBefore: number
  unAfter: number
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Discs that move in straight lines between exact collisions. */
export class CircleWorld {
  balls: Ball[]
  box: Box
  eBall: number
  eWall: number
  /** Velocity decay rate (rolling resistance), 1/s. */
  decay = 0
  t = 0
  hits: HitRecord[] = []
  wallHits = 0
  keLost = 0

  constructor(balls: Ball[], box: Box, eBall: number, eWall: number) {
    this.balls = balls
    this.box = box
    this.eBall = eBall
    this.eWall = eWall
  }

  totals(): { p: [number, number]; ke: number } {
    let px = 0
    let py = 0
    let ke = 0
    for (const b of this.balls) {
      px += b.m * b.vx
      py += b.m * b.vy
      ke += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy)
    }
    return { p: [px, py], ke }
  }

  /** Time to the next event within `limit`, or Infinity. */
  private next(limit: number): { tau: number; i: number; j: number; wall: 'x0' | 'x1' | 'y0' | 'y1' | null } {
    let best = { tau: limit, i: -1, j: -1, wall: null as 'x0' | 'x1' | 'y0' | 'y1' | null }
    const B = this.balls
    for (let i = 0; i < B.length; i++) {
      const a = B[i]
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const ux = b.vx - a.vx
        const uy = b.vy - a.vy
        const bb = dx * ux + dy * uy
        if (bb >= -1e-12) continue
        const R = a.r + b.r
        const aa = ux * ux + uy * uy
        const cc = dx * dx + dy * dy - R * R
        if (cc <= 1e-12) {
          // touching or overlapping and closing: hit now
          if (0 < best.tau) best = { tau: 0, i, j, wall: null }
          continue
        }
        const disc = bb * bb - aa * cc
        if (disc < 0) continue
        const tau = (-bb - Math.sqrt(disc)) / aa
        if (tau >= 0 && tau < best.tau) best = { tau, i, j, wall: null }
      }
      const bx = this.box
      const walls: ['x0' | 'x1' | 'y0' | 'y1', number][] = []
      if (a.vx < 0 && Number.isFinite(bx.x0)) walls.push(['x0', (bx.x0 + a.r - a.x) / a.vx])
      if (a.vx > 0 && Number.isFinite(bx.x1)) walls.push(['x1', (bx.x1 - a.r - a.x) / a.vx])
      if (a.vy < 0 && Number.isFinite(bx.y0)) walls.push(['y0', (bx.y0 + a.r - a.y) / a.vy])
      if (a.vy > 0 && Number.isFinite(bx.y1)) walls.push(['y1', (bx.y1 - a.r - a.y) / a.vy])
      for (const [w, tau0] of walls) {
        const tau = Math.max(0, tau0)
        if (tau < best.tau) best = { tau, i, j: -1, wall: w }
      }
    }
    return best
  }

  private move(tau: number) {
    for (const b of this.balls) {
      b.x += b.vx * tau
      b.y += b.vy * tau
    }
    this.t += tau
  }

  /** Advances by dt, resolving every collision at its exact time. */
  advance(dt: number) {
    let rem = dt
    let guard = 0
    while (rem > 0 && guard++ < 4000) {
      const ev = this.next(rem)
      if (ev.i < 0) {
        this.move(rem)
        rem = 0
        break
      }
      this.move(ev.tau)
      rem -= ev.tau
      if (ev.wall) this.hitWall(ev.i, ev.wall)
      else this.hitPair(ev.i, ev.j)
    }
    if (this.decay > 0) {
      const f = Math.exp(-this.decay * dt)
      for (const b of this.balls) { b.vx *= f; b.vy *= f }
    }
  }

  private hitWall(i: number, w: 'x0' | 'x1' | 'y0' | 'y1') {
    const b = this.balls[i]
    const before = 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy)
    if (w === 'x0' || w === 'x1') b.vx = -this.eWall * b.vx
    else b.vy = -this.eWall * b.vy
    this.keLost += before - 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy)
    this.wallHits++
  }

  private hitPair(i: number, j: number) {
    const a = this.balls[i]
    const b = this.balls[j]
    const tot0 = this.totals()
    let nx = b.x - a.x
    let ny = b.y - a.y
    const d = Math.hypot(nx, ny) || 1
    nx /= d
    ny /= d
    const un = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
    const imp = (-(1 + this.eBall) * un) / (1 / a.m + 1 / b.m)
    a.vx -= (imp * nx) / a.m
    a.vy -= (imp * ny) / a.m
    b.vx += (imp * nx) / b.m
    b.vy += (imp * ny) / b.m
    const tot1 = this.totals()
    this.keLost += tot0.ke - tot1.ke
    this.hits.push({
      t: this.t, i, j, pBefore: tot0.p, pAfter: tot1.p, keBefore: tot0.ke, keAfter: tot1.ke,
      unBefore: un, unAfter: (b.vx - a.vx) * nx + (b.vy - a.vy) * ny,
    })
    if (this.hits.length > 400) this.hits.shift()
  }

  /** Can anything still collide (some pair closing, or a wall ahead)? */
  hasFuture(horizon = 1e4): boolean {
    return this.next(horizon).i >= 0
  }
}

// ------------------------------------------------------------------------------------------ parameters

const MODES = [
  { id: 'oned', label: '1-D collision', blurb: 'Two carts on a rail: elastic, inelastic or partly elastic.' },
  { id: 'twod', label: '2-D collisions / billiards', blurb: 'Discs on a table: an oblique hit, a billiard rack, or a random gas.' },
  { id: 'cradle', label: "Newton's cradle", blurb: 'Rigid balls on strings (planck): momentum hops through the row.' },
  { id: 'ballistic', label: 'Ballistic pendulum', blurb: 'A bullet embeds in a hanging block: how fast was it?' },
]

const PARAMS: ParamDef[] = [
  { kind: 'number', key: 'm1', label: 'Mass 1', unit: 'kg', min: 0.1, max: 20, step: 0.1, value: 2, modes: ['oned'] },
  { kind: 'number', key: 'm2', label: 'Mass 2', unit: 'kg', min: 0.1, max: 20, step: 0.1, value: 1, modes: ['oned'] },
  { kind: 'number', key: 'v1', label: 'Velocity 1', unit: 'm/s', min: -10, max: 10, step: 0.1, value: 3, modes: ['oned'] },
  { kind: 'number', key: 'v2', label: 'Velocity 2', unit: 'm/s', min: -10, max: 10, step: 0.1, value: -1, modes: ['oned'] },
  { kind: 'number', key: 'e', label: 'Restitution e', min: 0, max: 1, step: 0.01, value: 1, modes: ['oned', 'twod'], hint: '1 = elastic, 0 = perfectly inelastic (they move together).' },
  { kind: 'bool', key: 'rail', label: 'Walls at both ends of the rail', value: false, modes: ['oned'] },
  // 2D
  { kind: 'choice', key: 'layout', label: 'Layout', value: 'oblique', modes: ['twod'], options: [{ value: 'oblique', label: 'Cue ball hits a ball at rest' }, { value: 'rack', label: 'Billiard rack (break)' }, { value: 'gas', label: 'Random discs' }] },
  { kind: 'number', key: 'speed', label: 'Cue speed', unit: 'm/s', min: 0.5, max: 12, step: 0.1, value: 4, modes: ['twod'] },
  { kind: 'number', key: 'offset', label: 'Aim offset (0 = head-on)', min: -0.95, max: 0.95, step: 0.01, value: 0.5, modes: ['twod'], when: (p) => p.layout === 'oblique', hint: 'Fraction of the contact distance by which the shot misses the centre of the target ball.' },
  { kind: 'number', key: 'mc', label: 'Cue ball mass', unit: 'kg', min: 0.1, max: 5, step: 0.05, value: 1, modes: ['twod'] },
  { kind: 'number', key: 'mt', label: 'Other balls mass', unit: 'kg', min: 0.1, max: 5, step: 0.05, value: 1, modes: ['twod'] },
  { kind: 'number', key: 'n', label: 'Number of discs', min: 3, max: 40, step: 1, value: 12, modes: ['twod'], when: (p) => p.layout === 'gas' },
  { kind: 'number', key: 'ew', label: 'Cushion restitution', min: 0, max: 1, step: 0.01, value: 1, modes: ['twod'] },
  { kind: 'number', key: 'decay', label: 'Rolling resistance', unit: '1/s', min: 0, max: 1, step: 0.01, value: 0, modes: ['twod'], live: true },
  { kind: 'number', key: 'seed', label: 'Random seed', min: 1, max: 999, step: 1, value: 7, modes: ['twod'], when: (p) => p.layout === 'gas' },
  // cradle
  { kind: 'number', key: 'balls', label: 'Balls', min: 3, max: 8, step: 1, value: 5, modes: ['cradle'] },
  { kind: 'number', key: 'lift', label: 'Balls lifted', min: 1, max: 4, step: 1, value: 1, modes: ['cradle'] },
  { kind: 'number', key: 'liftAngle', label: 'Lift angle', unit: '°', min: 5, max: 70, step: 1, value: 35, modes: ['cradle'] },
  { kind: 'number', key: 'restitution', label: 'Restitution', min: 0.5, max: 1, step: 0.005, value: 1, modes: ['cradle'] },
  { kind: 'number', key: 'length', label: 'String length', unit: 'm', min: 0.5, max: 2, step: 0.05, value: 1, modes: ['cradle'] },
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth', modes: ['cradle', 'ballistic'] },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0.1, max: 100, step: 0.1, value: 9.81, modes: ['cradle', 'ballistic'], when: (p) => p.gravity === 'custom' },
  // ballistic
  { kind: 'number', key: 'mb', label: 'Bullet mass', unit: 'g', min: 1, max: 100, step: 0.5, value: 10, modes: ['ballistic'] },
  { kind: 'number', key: 'MB', label: 'Block mass', unit: 'kg', min: 0.1, max: 10, step: 0.05, value: 1, modes: ['ballistic'] },
  { kind: 'number', key: 'vb', label: 'Bullet speed', unit: 'm/s', min: 20, max: 800, step: 5, value: 300, modes: ['ballistic'] },
  { kind: 'number', key: 'Lb', label: 'String length', unit: 'm', min: 0.3, max: 3, step: 0.05, value: 1.5, modes: ['ballistic'] },
]

// ------------------------------------------------------------------------------------------ ball sims

const BALL_COLORS = [COLORS.a, COLORS.b, COLORS.c, COLORS.d, COLORS.e, COLORS.f, COLORS.g, COLORS.h]

class BallsSim extends SimBase {
  readonly scene = 'collision' as const
  readonly mode: string
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' },
    { key: 'x1', label: 'x₁', unit: 'm' }, { key: 'y1', label: 'y₁', unit: 'm' }, { key: 'x2', label: 'x₂', unit: 'm' }, { key: 'y2', label: 'y₂', unit: 'm' },
    { key: 'v1', label: 'v₁ (speed)', unit: 'm/s' }, { key: 'v2', label: 'v₂ (speed)', unit: 'm/s' }, { key: 'vx1', label: 'vx₁', unit: 'm/s' }, { key: 'vx2', label: 'vx₂', unit: 'm/s' },
    { key: 'px', label: 'total px', unit: 'kg·m/s' }, { key: 'py', label: 'total py', unit: 'kg·m/s' }, { key: 'pmag', label: '|total p|', unit: 'kg·m/s' },
    { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' }, { key: 'ke_lost', label: 'energy lost', unit: 'J' },
    { key: 'hits', label: 'ball–ball collisions' },
    { key: 'v1_th', label: 'v₁ predicted', unit: 'm/s', analytic: true }, { key: 'v2_th', label: 'v₂ predicted', unit: 'm/s', analytic: true },
  ]
  plots: PlotSpec[]
  world: CircleWorld
  private readonly e: number
  private readonly box: Box
  private readonly oneD: boolean
  private tContact = NaN
  private after: Collision1D | null = null
  private idleSince = -1

  constructor(params: Params, method: Method) {
    super(params, method)
    this.mode = str(params, 'mode', 'oned')
    this.oneD = this.mode === 'oned'
    this.e = num(params, 'e', 1)
    this.conservative = false
    this.dt = 1 / 240
    if (this.oneD) {
      const m1 = num(params, 'm1', 2)
      const m2 = num(params, 'm2', 1)
      const v1 = num(params, 'v1', 3)
      const v2 = num(params, 'v2', -1)
      const r1 = 0.22 * Math.cbrt(m1)
      const r2 = 0.22 * Math.cbrt(m2)
      const closing = v1 - v2
      const x2 = 1 + r2
      const gap = closing > 0 ? closing * 1.2 : 1.2
      const x1 = x2 - r1 - r2 - gap
      this.box = bool(params, 'rail', false) ? { x0: -6, x1: 6, y0: -Infinity, y1: Infinity } : { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity }
      this.world = new CircleWorld([
        { x: x1, y: 0, vx: v1, vy: 0, m: m1, r: r1, color: COLORS.a, name: 'cart 1' },
        { x: x2 + (closing > 0 ? 0 : 1.5), y: 0, vx: v2, vy: 0, m: m2, r: r2, color: COLORS.b, name: 'cart 2' },
      ], this.box, this.e, 1)
      if (closing > 0) {
        this.tContact = gap / closing
        this.after = collide1D(m1, m2, v1, v2, this.e)
      }
      this.plots = [
        timePlot('v', 'Velocities', [{ key: 'vx1', label: 'v₁' }, { key: 'vx2', label: 'v₂' }, { key: 'v1_th', label: 'v₁ predicted', dash: true }, { key: 'v2_th', label: 'v₂ predicted', dash: true }], 'velocity (m/s)'),
        timePlot('x', 'Positions', [{ key: 'x1' }, { key: 'x2' }], 'x (m)'),
        timePlot('p', 'Momentum', [{ key: 'px', label: 'total' }], 'momentum (kg·m/s)'),
        timePlot('ke', 'Kinetic energy', [{ key: 'ke' }, { key: 'ke_lost', label: 'lost' }], 'energy (J)'),
      ]
    } else {
      const layout = str(params, 'layout', 'oblique')
      const W = 4
      const H = 2
      this.box = { x0: 0, y0: 0, x1: W, y1: H }
      const mc = num(params, 'mc', 1)
      const mt = num(params, 'mt', 1)
      const R = 0.1
      const speed = num(params, 'speed', 4)
      const balls: Ball[] = []
      if (layout === 'oblique') {
        const off = num(params, 'offset', 0.5) * 2 * R
        balls.push({ x: 0.6, y: H / 2 - off, vx: speed, vy: 0, m: mc, r: R, color: COLORS.f, name: 'cue' })
        balls.push({ x: 2.2, y: H / 2, vx: 0, vy: 0, m: mt, r: R, color: COLORS.b, name: 'target' })
      } else if (layout === 'rack') {
        balls.push({ x: 0.8, y: H / 2 + 0.003, vx: speed * 1.8, vy: 0, m: mc, r: R, color: '#e5e7eb', name: 'cue' })
        let k = 0
        for (let row = 0; row < 5; row++) for (let c = 0; c <= row; c++) {
          balls.push({ x: 2.6 + row * R * 1.74 * 1.02, y: H / 2 + (c - row / 2) * R * 2.04, vx: 0, vy: 0, m: mt, r: R, color: BALL_COLORS[k % BALL_COLORS.length], name: `${k + 1}` })
          k++
        }
      } else {
        const rnd = rng(num(params, 'seed', 7))
        const n = Math.round(num(params, 'n', 12))
        for (let tries = 0; balls.length < n && tries < 5000; tries++) {
          const x = R + rnd() * (W - 2 * R)
          const y = R + rnd() * (H - 2 * R)
          if (balls.some((b) => Math.hypot(b.x - x, b.y - y) < 2.3 * R)) continue
          const a = rnd() * 2 * Math.PI
          const s = speed * (0.4 + 0.6 * rnd())
          balls.push({ x, y, vx: s * Math.cos(a), vy: s * Math.sin(a), m: mt, r: R, color: BALL_COLORS[balls.length % BALL_COLORS.length], name: `${balls.length + 1}` })
        }
      }
      this.world = new CircleWorld(balls, this.box, this.e, num(params, 'ew', 1))
      this.world.decay = num(params, 'decay', 0)
      this.plots = [
        timePlot('ke', 'Kinetic energy', [{ key: 'ke' }, { key: 'ke_lost', label: 'lost' }], 'energy (J)'),
        timePlot('p', 'Total momentum', [{ key: 'px', label: 'px' }, { key: 'py', label: 'py' }, { key: 'pmag', label: '|p|' }], 'momentum (kg·m/s)'),
        timePlot('speed', 'Speeds of the first two balls', [{ key: 'v1' }, { key: 'v2' }], 'speed (m/s)'),
        xyPlot('track', 'Paths of the first two balls', 'x1', [{ key: 'y1', label: 'ball 1' }, { key: 'y2', label: 'ball 2', x: 'x2' }], 'x (m)', 'y (m)', true),
      ]
    }
    this.sampleDt = 0.01
  }

  step(dt: number) {
    this.world.decay = num(this.params, 'decay', 0)
    this.world.advance(dt)
    this.t = this.world.t
    // finished: nothing can collide any more and the balls have left (or all stopped)
    const future = this.world.hasFuture(30)
    if (!future) {
      if (this.idleSince < 0) this.idleSince = this.t
      if (this.t - this.idleSince > (this.oneD ? 2.5 : 1)) this.finished = true
    } else this.idleSince = -1
  }

  energy(): Energy {
    const ke = this.world.totals().ke
    return { ke, pe: 0, total: ke }
  }

  private predicted(i: 0 | 1): number {
    const b = this.world.balls[i]
    if (!this.after || !this.oneD) return b.vx
    const v0 = num(this.params, i === 0 ? 'v1' : 'v2', 0)
    if (bool(this.params, 'rail', false)) return NaN
    return this.t < this.tContact ? v0 : i === 0 ? this.after.v1 : this.after.v2
  }

  sample(): Record<string, number> {
    const B = this.world.balls
    const tot = this.world.totals()
    const b1 = B[0]
    const b2 = B[1]
    return {
      t: this.world.t, x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y, v1: Math.hypot(b1.vx, b1.vy), v2: Math.hypot(b2.vx, b2.vy), vx1: b1.vx, vx2: b2.vx,
      px: tot.p[0], py: tot.p[1], pmag: Math.hypot(tot.p[0], tot.p[1]), ke: tot.ke, pe: 0, e: tot.ke, ke_lost: this.world.keLost, hits: this.world.hits.length,
      v1_th: this.predicted(0), v2_th: this.predicted(1),
    }
  }

  bounds(): Bounds {
    if (!this.oneD) return { x0: -0.15, x1: 4.15, y0: -0.15, y1: 2.15 }
    const B = this.world.balls
    const T = 3
    const xs = B.flatMap((b) => [b.x - 1, b.x + b.vx * T + 1])
    const x0 = Math.min(...xs, -1)
    const x1 = Math.max(...xs, 3)
    return bool(this.params, 'rail', false) ? { x0: -6.6, x1: 6.6, y0: -2, y1: 2 } : { x0, x1, y0: -(x1 - x0) * 0.12, y1: (x1 - x0) * 0.12 }
  }

  frame(): Frame {
    const shapes: Shape[] = []
    const bodies: Frame['bodies'] = []
    if (!this.oneD) {
      const b = this.box
      shapes.push({ t: 'rect', x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, fill: '#166534', stroke: '#92400e', alpha: 0.35 })
      shapes.push({ t: 'poly', pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], stroke: '#b45309', closed: true, w: 4 })
    } else {
      shapes.push({ t: 'ground', y: -0.25, x1: -1e3, x2: 1e3 })
      if (bool(this.params, 'rail', false)) {
        shapes.push({ t: 'rect', x: -6.3, y: -0.5, w: 0.3, h: 1.6, fill: COLORS.fixed })
        shapes.push({ t: 'rect', x: 6, y: -0.5, w: 0.3, h: 1.6, fill: COLORS.fixed })
      }
    }
    this.world.balls.forEach((b, i) => {
      shapes.push({ t: 'circle', x: b.x, y: b.y + (this.oneD ? b.r - 0.25 : 0), r: b.r, fill: b.color, stroke: '#0b0b0b' })
      if (this.oneD) shapes.push({ t: 'text', x: b.x, y: b.y + b.r - 0.25, text: `${fmt(b.m, 3)} kg`, color: '#0b0b0b', align: 'center' })
      else if (this.world.balls.length <= 16) shapes.push({ t: 'text', x: b.x, y: b.y, text: b.name, color: '#0b0b0b', align: 'center', size: 0.8 })
      bodies.push({ id: `b${i}`, x: b.x, y: b.y + (this.oneD ? b.r - 0.25 : 0), vx: b.vx, vy: b.vy, ax: 0, ay: 0, m: b.m, r: b.r, color: b.color, name: b.name, trail: i < 3 })
    })
    const last = this.world.hits[this.world.hits.length - 1]
    return { shapes, bodies, banner: last && this.t - last.t < 0.6 ? 'collision!' : undefined }
  }

  readouts(): Readout[] {
    const out: Readout[] = []
    const tot = this.world.totals()
    const hits = this.world.hits
    const first = hits[0]
    if (this.oneD) {
      const m1 = num(this.params, 'm1', 2)
      const m2 = num(this.params, 'm2', 1)
      const v1 = num(this.params, 'v1', 3)
      const v2 = num(this.params, 'v2', -1)
      const c = collide1D(m1, m2, v1, v2, this.e)
      if (!this.after) out.push({ label: 'No collision', value: 'cart 1 is not catching up with cart 2', tone: 'warn' })
      out.push({ label: 'Total momentum', value: `${fmt(tot.p[0])} kg·m/s`, theory: `${fmt(m1 * v1 + m2 * v2)} (conserved)` })
      out.push({ label: 'Centre-of-mass velocity', value: `${fmt((m1 * v1 + m2 * v2) / (m1 + m2))} m/s` })
      out.push({ label: 'After: v₁', value: first ? `${fmt(this.world.balls[0].vx)} m/s` : '…', theory: `${fmt(c.v1)} m/s` })
      out.push({ label: 'After: v₂', value: first ? `${fmt(this.world.balls[1].vx)} m/s` : '…', theory: `${fmt(c.v2)} m/s` })
      out.push({ label: 'Kinetic energy before', value: `${fmt(c.keBefore)} J` })
      out.push({ label: 'Kinetic energy lost', value: first ? `${fmt(this.world.keLost)} J` : '…', theory: `${fmt(c.keLost)} J = ${fmt(c.keBefore > 0 ? (100 * c.keLost) / c.keBefore : 0, 3)}%` })
      out.push({ label: 'Relative speed', value: first ? `${fmt(-first.unAfter, 4)} / ${fmt(-first.unBefore, 4)} = e` : '…', theory: `e = ${fmt(this.e, 3)}`, tone: 'info' })
    } else {
      out.push({ label: 'Total momentum', value: `(${fmt(tot.p[0], 4)}, ${fmt(tot.p[1], 4)}) kg·m/s`, theory: this.world.wallHits === 0 ? 'conserved until a cushion is hit' : 'cushions change it' })
      out.push({ label: 'Kinetic energy', value: `${fmt(tot.ke)} J`, theory: `lost so far ${fmt(this.world.keLost)} J` })
      out.push({ label: 'Ball–ball collisions', value: String(hits.length) })
      out.push({ label: 'Cushion hits', value: String(this.world.wallHits) })
      if (str(this.params, 'layout', 'oblique') === 'oblique' && this.world.balls.length === 2) {
        const [a, b] = this.world.balls
        if (first) {
          const ang = Math.abs(wrapPi(Math.atan2(a.vy, a.vx) - Math.atan2(b.vy, b.vx))) / DEG
          const mc = a.m
          const mt = b.m
          out.push({ label: 'Angle between the two paths', value: `${fmt(ang, 4)}°`, theory: mc === mt && this.e === 1 ? '90° for equal masses, elastic' : undefined, tone: 'info' })
        }
      }
    }
    return out
  }
}

// ------------------------------------------------------------------------------------------ ballistic pendulum

class BallisticSim extends SimBase {
  readonly scene = 'collision' as const
  readonly mode = 'ballistic'
  channels: Channel[] = [
    { key: 't', label: 'time', unit: 's' }, { key: 'xb', label: 'x of the bullet / block', unit: 'm' }, { key: 'yb', label: 'y of the bullet / block', unit: 'm' },
    { key: 'theta', label: 'angle of the string', unit: 'rad' }, { key: 'omega', label: 'angular velocity', unit: 'rad/s' }, { key: 'v', label: 'speed', unit: 'm/s' },
    { key: 'px', label: 'horizontal momentum', unit: 'kg·m/s' }, { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'mechanical energy', unit: 'J' },
    { key: 'heat', label: 'energy turned to heat', unit: 'J' }, { key: 'theta_max', label: 'θ max (closed form)', unit: 'rad', analytic: true },
  ]
  plots: PlotSpec[] = [
    timePlot('theta', 'Swing angle', [{ key: 'theta' }, { key: 'theta_max', label: 'θ max, closed form', dash: true }], 'angle (rad)'),
    timePlot('px', 'Horizontal momentum', [{ key: 'px' }], 'momentum (kg·m/s)'),
    timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'mechanical' }, { key: 'heat', label: 'heat' }], 'energy (J)'),
  ]
  private phase: 'flight' | 'swing' = 'flight'
  private xb: number
  private o: Ode2
  private heat = 0
  private maxTheta = 0
  private readonly mb: number
  private readonly MB: number
  private readonly vb: number
  private readonly L: number
  private readonly x0 = -0.5
  private readonly w = 0.16

  constructor(params: Params, method: Method) {
    super(params, method)
    this.mb = num(params, 'mb', 10) / 1000
    this.MB = num(params, 'MB', 1)
    this.vb = num(params, 'vb', 300)
    this.L = num(params, 'Lb', 1.5)
    this.xb = this.x0
    this.dt = 1 / 480
    this.o = new Ode2({ n: 1, acc: (_t, y, a) => { a[0] = -(this.g() / this.L) * Math.sin(y[0]) } }, [0, 0], method)
  }

  private g() { return gravityOf(this.params) }
  private V() { return (this.mb * this.vb) / (this.mb + this.MB) }

  step(dt: number) {
    let rem = dt
    if (this.phase === 'flight') {
      const dist = -this.w - this.xb
      const tau = dist / this.vb
      if (tau > rem) {
        this.xb += this.vb * rem
        this.t += rem
        return
      }
      this.xb += this.vb * tau
      this.t += tau
      rem -= tau
      this.phase = 'swing'
      this.heat = 0.5 * this.mb * this.vb ** 2 - 0.5 * (this.mb + this.MB) * this.V() ** 2
      this.o.y[1] = this.V() / this.L
      this.o.invalidate()
    }
    this.o.method = this.method
    if (rem > 0) {
      this.o.advance(rem)
      this.t += rem
    }
    this.maxTheta = Math.max(this.maxTheta, Math.abs(this.o.y[0]))
  }

  private pos() {
    if (this.phase === 'flight') return { x: this.xb, y: -this.L, v: this.vb }
    const th = this.o.y[0]
    return { x: this.L * Math.sin(th), y: -this.L * Math.cos(th), v: this.L * this.o.y[1] }
  }

  private thetaMax(): number {
    const c = 1 - this.V() ** 2 / (2 * this.g() * this.L)
    return c <= -1 ? Math.PI : Math.acos(c)
  }

  energy(): Energy {
    if (this.phase === 'flight') return { ke: 0.5 * this.mb * this.vb ** 2, pe: 0, total: 0.5 * this.mb * this.vb ** 2 }
    const M = this.mb + this.MB
    const ke = 0.5 * M * (this.L * this.o.y[1]) ** 2
    const pe = M * this.g() * this.L * (1 - Math.cos(this.o.y[0]))
    return { ke, pe, total: ke + pe }
  }

  sample(): Record<string, number> {
    const p = this.pos()
    const e = this.energy()
    const M = this.mb + this.MB
    return {
      t: this.t, xb: p.x, yb: p.y, theta: this.phase === 'swing' ? this.o.y[0] : 0, omega: this.phase === 'swing' ? this.o.y[1] : 0, v: Math.abs(p.v),
      px: this.phase === 'flight' ? this.mb * this.vb : M * this.L * this.o.y[1] * Math.cos(this.o.y[0]), ke: e.ke, pe: e.pe, e: e.total, heat: this.heat, theta_max: this.thetaMax(),
    }
  }

  bounds(): Bounds { return { x0: -this.L * 1.1, x1: this.L * 1.1, y0: -this.L * 1.25, y1: this.L * 0.25 } }

  frame(): Frame {
    const L = this.L
    const th = this.phase === 'swing' ? this.o.y[0] : 0
    const bx = L * Math.sin(th)
    const by = -L * Math.cos(th)
    const shapes: Shape[] = [
      { t: 'rect', x: -L * 0.3, y: 0.02, w: L * 0.6, h: 0.05, fill: COLORS.fixed },
      { t: 'line', x1: 0, y1: 0, x2: bx, y2: by, color: COLORS.rod, w: 1.5 },
      { t: 'line', x1: 0, y1: 0, x2: 0, y2: -L * 1.05, color: COLORS.fixed, dash: true, w: 1 },
    ]
    const hw = 0.16 + 0.04 * Math.cbrt(this.MB)
    const c = Math.cos(th)
    const s = Math.sin(th)
    const corners = [[-hw, -0.1], [hw, -0.1], [hw, 0.1], [-hw, 0.1]].map(([a, b]) => [bx + a * c - b * s, by + a * s + b * c])
    shapes.push({ t: 'poly', pts: corners, fill: COLORS.b, stroke: COLORS.b, closed: true })
    if (this.phase === 'flight') shapes.push({ t: 'circle', x: this.xb, y: -L, r: 0.03, fill: COLORS.f })
    else if (this.maxTheta > 0.01) {
      const tm = this.thetaMax()
      shapes.push({ t: 'line', x1: 0, y1: 0, x2: L * Math.sin(tm), y2: -L * Math.cos(tm), color: COLORS.theory, dash: true, w: 1 })
      shapes.push({ t: 'text', x: L * Math.sin(tm) * 1.04, y: -L * Math.cos(tm), text: `θmax ${fmt(tm / DEG, 3)}°`, color: COLORS.theory })
    }
    const M = this.mb + this.MB
    const w = this.phase === 'swing' ? this.o.y[1] : 0
    const bodies: Frame['bodies'] = this.phase === 'flight'
      ? [{ id: 'bullet', x: this.xb, y: -L, vx: this.vb, vy: 0, ax: 0, ay: 0, m: this.mb, color: COLORS.f, r: 0.03 }, { id: 'block', x: 0, y: -L, vx: 0, vy: 0, ax: 0, ay: 0, m: this.MB, color: COLORS.b, r: 0.15, trail: false }]
      : [{ id: 'block', x: bx, y: by, vx: L * w * c, vy: L * w * s, ax: 0, ay: 0, m: M, color: COLORS.b, r: 0.15 }]
    return { shapes, bodies }
  }

  readouts(): Readout[] {
    const g = this.g()
    const V = this.V()
    const h = V * V / (2 * g)
    const out: Readout[] = []
    const tm = this.thetaMax()
    out.push({ label: 'Speed just after impact', value: `${fmt(V)} m/s`, theory: 'm v /(m + M)' })
    out.push({ label: 'Block rises', value: `${fmt(this.L * (1 - Math.cos(this.maxTheta)))} m`, theory: `${fmt(h)} m = V²/2g` })
    out.push({ label: 'Maximum angle', value: `${fmt(this.maxTheta / DEG, 4)}°`, theory: `${fmt(tm / DEG, 4)}° (closed form)` })
    const hMeasured = this.L * (1 - Math.cos(this.maxTheta))
    if (this.maxTheta > 0.01) out.push({ label: 'Bullet speed from the swing', value: `${fmt(ballisticSpeed(this.mb, this.MB, hMeasured, g))} m/s`, theory: `actual ${fmt(this.vb)} m/s`, tone: 'info' })
    out.push({ label: 'Kinetic energy kept', value: `${fmt((100 * this.mb) / (this.mb + this.MB), 3)}%`, theory: 'm/(m+M): the rest is heat' })
    out.push({ label: 'Heat in the impact', value: this.phase === 'swing' ? `${fmt(this.heat)} J` : '…' })
    return out
  }
}

// ------------------------------------------------------------------------------------------ definition

export const COLLISION: SceneDef = {
  id: 'collision',
  name: 'Collisions',
  blurb: '1-D and 2-D collisions, billiards, Newton\'s cradle and the ballistic pendulum.',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => defaultsFor(PARAMS, MODES.some((m) => m.id === mode) ? mode : 'oned'),
  presets: (mode): Preset[] => {
    switch (mode) {
      case 'oned': return [
        { name: 'Elastic, equal masses', params: { m1: 1, m2: 1, v1: 3, v2: 0, e: 1 } }, { name: 'Elastic, heavy hits light', params: { m1: 5, m2: 1, v1: 2, v2: 0, e: 1 } },
        { name: 'Perfectly inelastic', params: { m1: 2, m2: 1, v1: 3, v2: -1, e: 0 } }, { name: 'Partly elastic (e = 0.5)', params: { e: 0.5 } },
      ]
      case 'twod': return [{ name: 'Glancing hit', params: { layout: 'oblique', offset: 0.7 } }, { name: 'Head-on stop', params: { layout: 'oblique', offset: 0 } }, { name: 'Break the rack', params: { layout: 'rack' } }, { name: 'A gas of discs', params: { layout: 'gas', n: 20, speed: 3 } }]
      case 'cradle': return [{ name: 'One ball', params: { lift: 1 } }, { name: 'Two balls', params: { lift: 2 } }, { name: 'Three balls', params: { lift: 3, balls: 6 } }, { name: 'Sticky (e = 0.9)', params: { restitution: 0.9 } }]
      default: return [{ name: 'Rifle bullet', params: { mb: 10, MB: 1, vb: 300 } }, { name: 'Slow pellet', params: { mb: 2, MB: 0.4, vb: 120 } }, { name: 'Heavy bullet, big swing', params: { mb: 50, MB: 1, vb: 400 } }]
    }
  },
  create: (params, method = 'rk4') => {
    switch (str(params, 'mode', 'oned')) {
      case 'cradle': return cradleSim(params, method)
      case 'ballistic': return new BallisticSim(params, method)
      default: return new BallsSim(params, method)
    }
  },
}

