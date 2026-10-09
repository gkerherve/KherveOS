// Scene 6 — the rigid-body sandbox, built on planck (the Box2D port): boxes, circles and convex polygons, static or
// dynamic, joints (revolute, prismatic, distance, rope, pulley, weld, wheel) with motors, gravity, friction and
// restitution, and grab-and-throw with the mouse. The scene is plain data ({ bodies, joints }) saved in the .kmotion
// file; the editing helpers at the bottom are pure so that they can be tested.

import {
  Box as BoxShape, Circle, DistanceJoint, MouseJoint, Polygon, PrismaticJoint, PulleyJoint, RevoluteJoint, RopeJoint, Vec2, WeldJoint, WheelJoint, World,
  type Body, type Joint,
} from 'planck'
import type { Method } from '../integrators.ts'
import { SimBase } from '../simbase.ts'
import { COLORS, DEG, PALETTE, clamp, defaultsFor, energyPlot, fmt, num, timePlot } from '../common.ts'
import { GRAVITY_CHOICES, gravityOf } from './projectile.ts'
import type { Bounds, Channel, Energy, Frame, ParamDef, Params, PlotSpec, Readout, SceneDef, SceneId, Shape } from '../types.ts'

// ------------------------------------------------------------------------------------------ the data

export type BodyKind = 'box' | 'circle' | 'poly'
export type JointKind = 'revolute' | 'prismatic' | 'distance' | 'rope' | 'pulley' | 'weld' | 'wheel'

export interface SBody {
  id: string
  kind: BodyKind
  x: number
  y: number
  /** Degrees. */
  angle: number
  /** Box width and height (full). */
  w?: number
  h?: number
  r?: number
  /** Polygon corners, local to (x, y), counter-clockwise, convex, at most 8. */
  pts?: number[][]
  type: 'static' | 'dynamic'
  density: number
  friction: number
  restitution: number
  color?: string
  fixedRotation?: boolean
  vx?: number
  vy?: number
  /** Angular velocity, rad/s. */
  spin?: number
  linearDamping?: number
  angularDamping?: number
}

export interface SJoint {
  id: string
  kind: JointKind
  /** Body ids; null is the ground (the fixed world). */
  a: string | null
  b: string
  /** World anchor on A (the shared anchor of revolute, prismatic, weld and wheel). */
  ax: number
  ay: number
  /** World anchor on B (distance, rope, pulley). */
  bx?: number
  by?: number
  /** Axis (prismatic, wheel). */
  axisX?: number
  axisY?: number
  motor?: boolean
  /** rad/s for revolute and wheel, m/s for prismatic. */
  speed?: number
  /** N·m or N. */
  maxForce?: number
  limit?: boolean
  lower?: number
  upper?: number
  /** Distance joint length (default: the initial one), rope maximum length. */
  length?: number
  /** Spring frequency in Hz (distance, wheel suspension, weld). */
  freq?: number
  damping?: number
  /** Pulley: ground anchors and the ratio. */
  gax?: number
  gay?: number
  gbx?: number
  gby?: number
  ratio?: number
}

export interface SandboxSpec {
  bodies: SBody[]
  joints: SJoint[]
}

export const JOINT_NAMES: Record<JointKind, string> = {
  revolute: 'Hinge (revolute)', prismatic: 'Slider (prismatic)', distance: 'Rod / spring (distance)', rope: 'Rope', pulley: 'Pulley', weld: 'Weld', wheel: 'Wheel (suspension)',
}

export function emptySpec(): SandboxSpec {
  return { bodies: [], joints: [] }
}

/** The data from `params.world`, repaired (anything unusable is dropped). */
export function readSpec(raw: unknown): SandboxSpec {
  const o = (raw ?? {}) as { bodies?: unknown; joints?: unknown }
  const bodies: SBody[] = []
  const ids = new Set<string>()
  if (Array.isArray(o.bodies)) {
    for (const b of o.bodies as Partial<SBody>[]) {
      if (!b || typeof b.id !== 'string' || ids.has(b.id)) continue
      const kind = b.kind === 'circle' || b.kind === 'poly' ? b.kind : 'box'
      if (kind === 'poly' && !(Array.isArray(b.pts) && b.pts.length >= 3)) continue
      const f = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
      bodies.push({
        id: b.id, kind, x: f(b.x, 0), y: f(b.y, 0), angle: f(b.angle, 0), w: clamp(f(b.w, 1), 0.02, 200), h: clamp(f(b.h, 1), 0.02, 200), r: clamp(f(b.r, 0.5), 0.01, 100),
        pts: kind === 'poly' ? (b.pts as number[][]).slice(0, 8).map((p) => [f(p[0], 0), f(p[1], 0)]) : undefined,
        type: b.type === 'static' ? 'static' : 'dynamic', density: clamp(f(b.density, 1), 0.01, 1000), friction: clamp(f(b.friction, 0.5), 0, 5), restitution: clamp(f(b.restitution, 0.1), 0, 1),
        color: typeof b.color === 'string' ? b.color : undefined, fixedRotation: b.fixedRotation === true || undefined,
        vx: typeof b.vx === 'number' ? b.vx : undefined, vy: typeof b.vy === 'number' ? b.vy : undefined, spin: typeof b.spin === 'number' ? b.spin : undefined,
        linearDamping: typeof b.linearDamping === 'number' ? b.linearDamping : undefined, angularDamping: typeof b.angularDamping === 'number' ? b.angularDamping : undefined,
      })
      ids.add(b.id)
    }
  }
  const kinds: JointKind[] = ['revolute', 'prismatic', 'distance', 'rope', 'pulley', 'weld', 'wheel']
  const joints: SJoint[] = []
  if (Array.isArray(o.joints)) {
    for (const j of o.joints as Partial<SJoint>[]) {
      if (!j || typeof j.id !== 'string' || !kinds.includes(j.kind as JointKind) || typeof j.b !== 'string' || !ids.has(j.b)) continue
      if (j.a !== null && j.a !== undefined && !ids.has(j.a)) continue
      if (typeof j.ax !== 'number' || typeof j.ay !== 'number') continue
      joints.push({ ...(j as SJoint), a: j.a ?? null })
    }
  }
  return { bodies, joints }
}

// ------------------------------------------------------------------------------------------ geometry helpers

export function bodyCorners(b: SBody): number[][] {
  const c = Math.cos(b.angle * DEG)
  const s = Math.sin(b.angle * DEG)
  const local: number[][] = b.kind === 'box' ? [[-(b.w ?? 1) / 2, -(b.h ?? 1) / 2], [(b.w ?? 1) / 2, -(b.h ?? 1) / 2], [(b.w ?? 1) / 2, (b.h ?? 1) / 2], [-(b.w ?? 1) / 2, (b.h ?? 1) / 2]] : (b.pts ?? [])
  return local.map(([px, py]) => [b.x + px * c - py * s, b.y + px * s + py * c])
}

export function pointInBody(b: SBody, x: number, y: number): boolean {
  if (b.kind === 'circle') return Math.hypot(x - b.x, y - b.y) <= (b.r ?? 0.5)
  const P = bodyCorners(b)
  let inside = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (P[i][1] > y !== P[j][1] > y && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside
  }
  return inside
}

/** The topmost (last drawn) body at a point; dynamic bodies win over static ones. */
export function hitBody(spec: SandboxSpec, x: number, y: number): SBody | null {
  let best: SBody | null = null
  for (const b of spec.bodies) {
    if (!pointInBody(b, x, y)) continue
    if (!best || b.type === 'dynamic' || best.type === 'static') best = b
  }
  return best
}

export function convexHull(points: number[][]): number[][] {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: number[][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  const up: number[][] = []
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  lo.pop()
  up.pop()
  return lo.concat(up)
}

export function polygonArea(pts: number[][]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return a / 2
}

/** Shape-wise area (for density -> mass in the inspector). */
export function bodyArea(b: SBody): number {
  return b.kind === 'circle' ? Math.PI * (b.r ?? 0.5) ** 2 : b.kind === 'box' ? (b.w ?? 1) * (b.h ?? 1) : Math.abs(polygonArea(b.pts ?? []))
}

export function nextId(spec: SandboxSpec, prefix: string): string {
  const used = new Set<string>([...spec.bodies.map((b) => b.id), ...spec.joints.map((j) => j.id)])
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`
}

const DEFAULTS = { density: 1, friction: 0.5, restitution: 0.1 }

export function addBox(spec: SandboxSpec, x: number, y: number, w: number, h: number, o: Partial<SBody> = {}): SandboxSpec {
  const b: SBody = { id: nextId(spec, 'b'), kind: 'box', x, y, angle: 0, w: Math.abs(w), h: Math.abs(h), type: 'dynamic', ...DEFAULTS, ...o }
  return { ...spec, bodies: [...spec.bodies, b] }
}
export function addCircle(spec: SandboxSpec, x: number, y: number, r: number, o: Partial<SBody> = {}): SandboxSpec {
  const b: SBody = { id: nextId(spec, 'b'), kind: 'circle', x, y, angle: 0, r: Math.abs(r), type: 'dynamic', ...DEFAULTS, ...o }
  return { ...spec, bodies: [...spec.bodies, b] }
}
/** A convex polygon from clicked points (the hull, at most 8 corners, recentred on its centroid). Null if degenerate. */
export function addPolygon(spec: SandboxSpec, points: number[][], o: Partial<SBody> = {}): SandboxSpec | null {
  let hull = convexHull(points)
  if (hull.length > 8) hull = hull.filter((_, i) => i % Math.ceil(hull.length / 8) === 0).slice(0, 8)
  if (hull.length < 3 || Math.abs(polygonArea(hull)) < 1e-4) return null
  if (polygonArea(hull) < 0) hull.reverse()
  let cx = 0
  let cy = 0
  for (const p of hull) { cx += p[0]; cy += p[1] }
  cx /= hull.length
  cy /= hull.length
  const b: SBody = { id: nextId(spec, 'b'), kind: 'poly', x: cx, y: cy, angle: 0, pts: hull.map((p) => [p[0] - cx, p[1] - cy]), type: 'dynamic', ...DEFAULTS, ...o }
  return { ...spec, bodies: [...spec.bodies, b] }
}

export function updateBody(spec: SandboxSpec, id: string, patch: Partial<SBody>): SandboxSpec {
  return { ...spec, bodies: spec.bodies.map((b) => (b.id === id ? { ...b, ...patch } : b)) }
}

/** Moves a body and the joint anchors attached to it. */
export function moveBody(spec: SandboxSpec, id: string, dx: number, dy: number): SandboxSpec {
  return {
    bodies: spec.bodies.map((b) => (b.id === id ? { ...b, x: b.x + dx, y: b.y + dy } : b)),
    joints: spec.joints.map((j) => {
      let k = j
      if (j.a === id) k = { ...k, ax: k.ax + dx, ay: k.ay + dy }
      if (j.b === id && (j.kind === 'distance' || j.kind === 'rope' || j.kind === 'pulley')) k = { ...k, bx: (k.bx ?? 0) + dx, by: (k.by ?? 0) + dy }
      if (j.b === id && j.a === null && j.kind !== 'distance' && j.kind !== 'rope' && j.kind !== 'pulley') k = { ...k, ax: k.ax + dx, ay: k.ay + dy }
      return k
    }),
  }
}

export function removeBody(spec: SandboxSpec, id: string): SandboxSpec {
  return { bodies: spec.bodies.filter((b) => b.id !== id), joints: spec.joints.filter((j) => j.a !== id && j.b !== id) }
}

export function removeJoint(spec: SandboxSpec, id: string): SandboxSpec {
  return { ...spec, joints: spec.joints.filter((j) => j.id !== id) }
}

export function addJoint(spec: SandboxSpec, j: Omit<SJoint, 'id'>): SandboxSpec {
  return { ...spec, joints: [...spec.joints, { ...j, id: nextId(spec, 'j') }] }
}

export function updateJoint(spec: SandboxSpec, id: string, patch: Partial<SJoint>): SandboxSpec {
  return { ...spec, joints: spec.joints.map((j) => (j.id === id ? { ...j, ...patch } : j)) }
}

/** The joint whose anchor (or line) is closest to a point, within `tol`. */
export function hitJoint(spec: SandboxSpec, x: number, y: number, tol: number): SJoint | null {
  let best: SJoint | null = null
  let bd = tol
  for (const j of spec.joints) {
    const pts: number[][] = [[j.ax, j.ay]]
    if (j.bx !== undefined && j.by !== undefined) pts.push([j.bx, j.by])
    for (const p of pts) {
      const d = Math.hypot(p[0] - x, p[1] - y)
      if (d < bd) { bd = d; best = j }
    }
  }
  return best
}

// ------------------------------------------------------------------------------------------ the world

interface Live {
  body: Body
  spec: SBody
}

export class SandboxWorld {
  readonly world: World
  readonly ground: Body
  readonly live = new Map<string, Live>()
  readonly joints: { spec: SJoint; joint: Joint }[] = []
  private mouse: MouseJoint | null = null
  private mouseBody: string | null = null
  gravity: [number, number]

  constructor(spec: SandboxSpec, gravity: [number, number]) {
    this.gravity = gravity
    this.world = new World({ gravity: new Vec2(gravity[0], gravity[1]) })
    this.ground = this.world.createBody({ type: 'static', position: new Vec2(0, 0) })
    for (const b of spec.bodies) this.addBody(b)
    for (const j of spec.joints) this.addJoint(j)
  }

  private addBody(s: SBody) {
    const body = this.world.createBody({
      type: s.type,
      position: new Vec2(s.x, s.y),
      angle: s.angle * DEG,
      linearVelocity: new Vec2(s.vx ?? 0, s.vy ?? 0),
      angularVelocity: s.spin ?? 0,
      fixedRotation: s.fixedRotation,
      linearDamping: s.linearDamping ?? 0,
      angularDamping: s.angularDamping ?? 0,
      allowSleep: false,
      userData: s.id,
    })
    const opt = { density: s.type === 'static' ? 0 : s.density, friction: s.friction, restitution: s.restitution }
    if (s.kind === 'circle') body.createFixture({ shape: new Circle(s.r ?? 0.5), ...opt })
    else if (s.kind === 'box') body.createFixture({ shape: new BoxShape((s.w ?? 1) / 2, (s.h ?? 1) / 2), ...opt })
    else body.createFixture({ shape: new Polygon((s.pts ?? []).map((p) => new Vec2(p[0], p[1]))), ...opt })
    this.live.set(s.id, { body, spec: s })
  }

  private addJoint(j: SJoint) {
    const A = j.a === null ? this.ground : this.live.get(j.a)?.body
    const B = this.live.get(j.b)?.body
    if (!A || !B) return
    const anchor = new Vec2(j.ax, j.ay)
    const second = new Vec2(j.bx ?? j.ax, j.by ?? j.ay)
    const axis = new Vec2(j.axisX ?? 0, j.axisY ?? 1)
    if (axis.length() === 0) axis.set(0, 1)
    axis.normalize()
    let joint: Joint | null = null
    switch (j.kind) {
      case 'revolute':
        joint = new RevoluteJoint({ enableMotor: j.motor === true, motorSpeed: j.speed ?? 0, maxMotorTorque: j.maxForce ?? 100, enableLimit: j.limit === true, lowerAngle: (j.lower ?? -90) * DEG, upperAngle: (j.upper ?? 90) * DEG }, A, B, anchor)
        break
      case 'prismatic':
        joint = new PrismaticJoint({ enableMotor: j.motor === true, motorSpeed: j.speed ?? 0, maxMotorForce: j.maxForce ?? 100, enableLimit: j.limit === true, lowerTranslation: j.lower ?? -2, upperTranslation: j.upper ?? 2 }, A, B, anchor, axis)
        break
      case 'distance': {
        const len = j.length ?? Math.hypot(second.x - anchor.x, second.y - anchor.y)
        joint = new DistanceJoint({ length: Math.max(len, 0.05), frequencyHz: j.freq ?? 0, dampingRatio: j.damping ?? 0.3 }, A, B, anchor, second)
        break
      }
      case 'rope':
        joint = new RopeJoint({ maxLength: Math.max(j.length ?? Math.hypot(second.x - anchor.x, second.y - anchor.y), 0.05), localAnchorA: A.getLocalPoint(anchor), localAnchorB: B.getLocalPoint(second), bodyA: A, bodyB: B } as never)
        break
      case 'pulley':
        joint = new PulleyJoint({}, A, B, new Vec2(j.gax ?? j.ax, j.gay ?? j.ay + 2), new Vec2(j.gbx ?? j.ax + 2, j.gby ?? j.ay + 2), anchor, second, j.ratio ?? 1)
        break
      case 'weld':
        joint = new WeldJoint({ frequencyHz: j.freq ?? 0, dampingRatio: j.damping ?? 0.3 }, A, B, anchor)
        break
      case 'wheel':
        joint = new WheelJoint({ enableMotor: j.motor === true, motorSpeed: j.speed ?? 0, maxMotorTorque: j.maxForce ?? 40, frequencyHz: j.freq ?? 4, dampingRatio: j.damping ?? 0.7 }, A, B, anchor, axis)
        break
    }
    if (joint) {
      this.world.createJoint(joint)
      this.joints.push({ spec: j, joint })
    }
  }

  step(dt: number) {
    this.world.step(dt, 10, 4)
  }

  /** Starts dragging the dynamic body under (x, y); true if one was grabbed. */
  grab(x: number, y: number): boolean {
    this.release()
    const p = new Vec2(x, y)
    for (const [id, l] of this.live) {
      if (l.body.getType() !== 'dynamic') continue
      for (let f = l.body.getFixtureList(); f; f = f.getNext()) {
        if (f.testPoint(p)) {
          const m = l.body.getMass()
          this.mouse = new MouseJoint({ maxForce: 2000 * m, frequencyHz: 5, dampingRatio: 0.7 }, this.ground, l.body, p)
          this.world.createJoint(this.mouse)
          this.mouseBody = id
          l.body.setAwake(true)
          return true
        }
      }
    }
    return false
  }

  drag(x: number, y: number) {
    this.mouse?.setTarget(new Vec2(x, y))
  }

  release() {
    if (this.mouse) {
      this.world.destroyJoint(this.mouse)
      this.mouse = null
      this.mouseBody = null
    }
  }

  get grabbed(): string | null { return this.mouseBody }
  get grabTarget(): { x: number; y: number } | null { const t = this.mouse?.getTarget(); return t ? { x: t.x, y: t.y } : null }

  totals() {
    let ke = 0
    let pe = 0
    let px = 0
    let py = 0
    let mass = 0
    let cx = 0
    let cy = 0
    const [gx, gy] = this.gravity
    for (const l of this.live.values()) {
      const b = l.body
      if (b.getType() !== 'dynamic') continue
      const m = b.getMass()
      const v = b.getLinearVelocity()
      const c = b.getWorldCenter()
      const icm = b.getInertia() - m * b.getLocalCenter().lengthSquared()
      const w = b.getAngularVelocity()
      ke += 0.5 * m * (v.x * v.x + v.y * v.y) + 0.5 * icm * w * w
      pe -= m * (gx * c.x + gy * c.y)
      px += m * v.x
      py += m * v.y
      mass += m
      cx += m * c.x
      cy += m * c.y
    }
    return { ke, pe, px, py, mass, cx: mass ? cx / mass : 0, cy: mass ? cy / mass : 0 }
  }
}

// ------------------------------------------------------------------------------------------ the simulation

const CHANNELS: Channel[] = [
  { key: 't', label: 'time', unit: 's' },
  { key: 'x', label: 'x of the first body', unit: 'm' }, { key: 'y', label: 'y of the first body', unit: 'm' }, { key: 'vx', label: 'vx', unit: 'm/s' }, { key: 'vy', label: 'vy', unit: 'm/s' }, { key: 'speed', label: 'speed', unit: 'm/s' },
  { key: 'angle', label: 'angle of the first body', unit: '°' },
  { key: 'comx', label: 'centre of mass x', unit: 'm' }, { key: 'comy', label: 'centre of mass y', unit: 'm' },
  { key: 'ke', label: 'kinetic energy', unit: 'J' }, { key: 'pe', label: 'potential energy', unit: 'J' }, { key: 'e', label: 'total energy', unit: 'J' },
  { key: 'px', label: 'px', unit: 'kg·m/s' }, { key: 'py', label: 'py', unit: 'kg·m/s' },
]

const PLOTS: PlotSpec[] = [
  timePlot('xy', 'First dynamic body', [{ key: 'x' }, { key: 'y' }, { key: 'angle', label: 'angle (°)' }], 'position (m)'),
  timePlot('v', 'Its velocity', [{ key: 'vx' }, { key: 'vy' }, { key: 'speed' }], 'velocity (m/s)'),
  energyPlot(),
  timePlot('mom', 'Total momentum', [{ key: 'px' }, { key: 'py' }], 'momentum (kg·m/s)'),
  timePlot('com', 'Centre of mass', [{ key: 'comx' }, { key: 'comy' }], 'position (m)'),
]

export class SandboxSim extends SimBase {
  readonly scene: SceneId
  readonly mode: string
  channels = CHANNELS
  plots = PLOTS
  readonly world: SandboxWorld
  readonly spec: SandboxSpec
  private prevV = new Map<string, [number, number]>()
  private acc = new Map<string, [number, number]>()
  private e0 = NaN
  private note: string | null = null
  private extraReadouts: (sim: SandboxSim) => Readout[]

  constructor(spec: SandboxSpec, gravity: [number, number], params: Params, method: Method, scene: SceneId = 'sandbox', mode = 'world', extra: (sim: SandboxSim) => Readout[] = () => []) {
    super(params, method)
    this.scene = scene
    this.mode = mode
    this.spec = spec
    this.world = new SandboxWorld(spec, gravity)
    this.dt = 1 / 120
    this.sampleDt = 0.02
    this.methods = []
    this.conservative = false
    this.extraReadouts = extra
    this.e0 = this.energy().total
  }

  step(dt: number) {
    for (const [id, l] of this.world.live) {
      if (l.body.getType() !== 'dynamic') continue
      const v = l.body.getLinearVelocity()
      const p = this.prevV.get(id)
      this.acc.set(id, p ? [(v.x - p[0]) / dt, (v.y - p[1]) / dt] : [0, 0])
      this.prevV.set(id, [v.x, v.y])
    }
    this.world.step(dt)
    this.t += dt
  }

  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): boolean {
    if (kind === 'down') return this.world.grab(x, y)
    if (kind === 'move') { this.world.drag(x, y); return this.world.grabbed !== null }
    const was = this.world.grabbed !== null
    this.world.release()
    return was
  }

  energy(): Energy {
    const t = this.world.totals()
    return { ke: t.ke, pe: t.pe, total: t.ke + t.pe }
  }

  private firstDynamic(): Live | null {
    for (const l of this.world.live.values()) if (l.body.getType() === 'dynamic') return l
    return null
  }

  sample(): Record<string, number> {
    const T = this.world.totals()
    const f = this.firstDynamic()
    const p = f?.body.getPosition()
    const v = f?.body.getLinearVelocity()
    return {
      t: this.t, x: p?.x ?? NaN, y: p?.y ?? NaN, vx: v?.x ?? NaN, vy: v?.y ?? NaN, speed: v ? Math.hypot(v.x, v.y) : NaN, angle: f ? f.body.getAngle() / DEG : NaN,
      comx: T.cx, comy: T.cy, ke: T.ke, pe: T.pe, e: T.ke + T.pe, px: T.px, py: T.py,
    }
  }

  bounds(): Bounds {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const b of this.spec.bodies) {
      const r = b.kind === 'circle' ? (b.r ?? 0.5) : Math.hypot(b.w ?? 1, b.h ?? 1) / 2
      x0 = Math.min(x0, b.x - r); x1 = Math.max(x1, b.x + r)
      y0 = Math.min(y0, b.y - r); y1 = Math.max(y1, b.y + r)
    }
    if (!Number.isFinite(x0)) return { x0: -8, y0: -1, x1: 8, y1: 8 }
    const w = Math.max(x1 - x0, 4)
    const h = Math.max(y1 - y0, 3)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    return { x0: cx - w * 0.6, x1: cx + w * 0.6, y0: cy - h * 0.6, y1: cy + h * 0.6 }
  }

  frame(): Frame {
    const shapes: Shape[] = []
    const bodies: Frame['bodies'] = []
    let k = 0
    for (const [id, l] of this.world.live) {
      const s = l.spec
      const p = l.body.getPosition()
      const ang = l.body.getAngle()
      const isStatic = s.type === 'static'
      const col = s.color ?? (isStatic ? COLORS.fixed : PALETTE[k++ % PALETTE.length])
      const c = Math.cos(ang)
      const sn = Math.sin(ang)
      if (s.kind === 'circle') {
        const r = s.r ?? 0.5
        shapes.push({ t: 'circle', x: p.x, y: p.y, r, fill: col, stroke: '#0b0b0b', alpha: isStatic ? 0.7 : 0.9 })
        shapes.push({ t: 'line', x1: p.x, y1: p.y, x2: p.x + r * c, y2: p.y + r * sn, color: '#0b0b0b', w: 1.5 })
      } else {
        const local: number[][] = s.kind === 'box' ? [[-(s.w ?? 1) / 2, -(s.h ?? 1) / 2], [(s.w ?? 1) / 2, -(s.h ?? 1) / 2], [(s.w ?? 1) / 2, (s.h ?? 1) / 2], [-(s.w ?? 1) / 2, (s.h ?? 1) / 2]] : (s.pts ?? [])
        shapes.push({ t: 'poly', pts: local.map(([a, b]) => [p.x + a * c - b * sn, p.y + a * sn + b * c]), fill: col, stroke: '#0b0b0b', closed: true, alpha: isStatic ? 0.7 : 0.9 })
      }
      if (!isStatic) {
        const v = l.body.getLinearVelocity()
        const a = this.acc.get(id) ?? [0, 0]
        const wc = l.body.getWorldCenter()
        bodies.push({ id, x: wc.x, y: wc.y, vx: v.x, vy: v.y, ax: a[0], ay: a[1], m: l.body.getMass(), color: col, r: s.kind === 'circle' ? s.r : Math.hypot(s.w ?? 0.5, s.h ?? 0.5) / 2, trail: bodies.length < 8 })
      }
    }
    for (const { spec: j, joint } of this.world.joints) {
      const a = joint.getAnchorA()
      const b = joint.getAnchorB()
      const col = j.kind === 'rope' || j.kind === 'distance' ? COLORS.rod : COLORS.d
      if (j.kind === 'distance' || j.kind === 'rope') shapes.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: col, w: 2, dash: j.kind === 'rope' })
      if (j.kind === 'pulley') {
        const pj = joint as PulleyJoint
        const ga = pj.getGroundAnchorA()
        const gb = pj.getGroundAnchorB()
        shapes.push({ t: 'path', pts: [[a.x, a.y], [ga.x, ga.y], [gb.x, gb.y], [b.x, b.y]], color: COLORS.rod, w: 2 })
        shapes.push({ t: 'circle', x: ga.x, y: ga.y, r: 0.12, fill: COLORS.fixed })
        shapes.push({ t: 'circle', x: gb.x, y: gb.y, r: 0.12, fill: COLORS.fixed })
      } else if (j.kind === 'prismatic' || j.kind === 'wheel') {
        const ax = j.axisX ?? 0
        const ay = j.axisY ?? 1
        const A = j.a === null ? { c: 1, s: 0 } : { c: Math.cos(this.world.live.get(j.a)!.body.getAngle()), s: Math.sin(this.world.live.get(j.a)!.body.getAngle()) }
        const wx = ax * A.c - ay * A.s
        const wy = ax * A.s + ay * A.c
        shapes.push({ t: 'line', x1: a.x - wx * 0.5, y1: a.y - wy * 0.5, x2: a.x + wx * 0.5, y2: a.y + wy * 0.5, color: COLORS.d, w: 1, dash: true })
        shapes.push({ t: 'circle', x: b.x, y: b.y, r: 0.05, fill: COLORS.d })
      } else if (j.kind !== 'distance' && j.kind !== 'rope') {
        shapes.push({ t: 'circle', x: a.x, y: a.y, r: 0.06, fill: j.kind === 'weld' ? COLORS.f : COLORS.d, stroke: '#0b0b0b' })
      }
    }
    const tgt = this.world.grabTarget
    if (tgt && this.world.grabbed) {
      const l = this.world.live.get(this.world.grabbed)
      if (l) {
        const c = l.body.getWorldCenter()
        shapes.push({ t: 'line', x1: c.x, y1: c.y, x2: tgt.x, y2: tgt.y, color: COLORS.theory, w: 1.5, dash: true })
      }
    }
    return { shapes, bodies, banner: this.note ?? undefined }
  }

  readouts(): Readout[] {
    const T = this.world.totals()
    const out: Readout[] = [
      { label: 'Bodies', value: `${this.spec.bodies.length} (${this.spec.bodies.filter((b) => b.type === 'dynamic').length} dynamic), ${this.spec.joints.length} joints` },
      { label: 'Total mass', value: `${fmt(T.mass)} kg` },
      { label: 'Kinetic energy', value: `${fmt(T.ke)} J` },
      { label: 'Mechanical energy', value: `${fmt(T.ke + T.pe)} J`, theory: Number.isFinite(this.e0) ? `at start ${fmt(this.e0)} J (friction and impacts take it)` : undefined },
      { label: 'Momentum', value: `(${fmt(T.px, 4)}, ${fmt(T.py, 4)}) kg·m/s` },
    ]
    return [...out, ...this.extraReadouts(this)]
  }

  status() { return 'Drag a body with the mouse to throw it' }
}

// ------------------------------------------------------------------------------------------ Newton's cradle

export function cradleSpec(p: Params): SandboxSpec {
  const N = Math.round(clamp(num(p, 'balls', 5), 3, 8))
  const lift = Math.round(clamp(num(p, 'lift', 1), 1, N - 1))
  const L = num(p, 'length', 1)
  const r = 0.1
  const alpha = num(p, 'liftAngle', 35) * DEG
  const e = num(p, 'restitution', 1)
  const top = L + 0.35
  const gap = 0.0005
  const spec = emptySpec()
  const x0 = -((N - 1) * (2 * r + gap)) / 2
  spec.bodies.push({ id: 'frame', kind: 'box', x: 0, y: top + 0.05, angle: 0, w: N * 2 * r + 0.8, h: 0.1, type: 'static', density: 1, friction: 0, restitution: 0, color: COLORS.fixed })
  for (let i = 0; i < N; i++) {
    const ax = x0 + i * (2 * r + gap)
    const lifted = i < lift
    const bx = lifted ? ax - L * Math.sin(alpha) : ax
    const by = lifted ? top - L * Math.cos(alpha) : top - L
    spec.bodies.push({ id: `ball${i + 1}`, kind: 'circle', x: bx, y: by, angle: 0, r, type: 'dynamic', density: 8, friction: 0, restitution: e, color: lifted ? COLORS.a : COLORS.b, linearDamping: 0, angularDamping: 0 })
    spec.joints.push({ id: `j${i + 1}`, kind: 'distance', a: 'frame', b: `ball${i + 1}`, ax, ay: top, bx, by, length: L, freq: 0 })
  }
  return spec
}

export function cradleSim(p: Params, method: Method): SandboxSim {
  const spec = cradleSpec(p)
  const g = gravityOf(p)
  const N = spec.bodies.length - 1
  const lift = Math.round(clamp(num(p, 'lift', 1), 1, N - 1))
  const alpha = num(p, 'liftAngle', 35) * DEG
  const L = num(p, 'length', 1)
  const v0 = Math.sqrt(2 * g * L * (1 - Math.cos(alpha)))
  return new SandboxSim(spec, [0, -g], p, method, 'collision', 'cradle', (sim) => {
    const balls = [...sim.world.live.values()].filter((l) => l.spec.id.startsWith('ball'))
    const speeds = balls.map((l) => l.body.getLinearVelocity().x)
    return [
      { label: 'Speed of the lifted balls at impact', value: `${fmt(v0)} m/s`, theory: '√(2 g L (1 − cos α))' },
      { label: 'Balls lifted', value: String(lift), theory: 'the same number leaves the other end', tone: 'info' },
      { label: 'Horizontal speeds', value: speeds.map((v) => fmt(v, 2)).join('  '), theory: 'left to right' },
    ]
  })
}

// ------------------------------------------------------------------------------------------ the scene

const PARAMS: ParamDef[] = [
  { kind: 'choice', key: 'gravity', label: 'Gravity', options: GRAVITY_CHOICES, value: 'earth' },
  { kind: 'number', key: 'gcustom', label: 'Custom g', unit: 'm/s²', min: 0, max: 100, step: 0.1, value: 9.81, when: (p) => p.gravity === 'custom' },
  { kind: 'number', key: 'friction', label: 'Friction (all bodies)', min: 0, max: 2, step: 0.01, value: 0.5, hint: 'Sets every body at once and is used for new ones; the inspector changes a single body.' },
  { kind: 'number', key: 'restitution', label: 'Restitution (all bodies)', min: 0, max: 1, step: 0.01, value: 0.1, hint: '0 = no bounce, 1 = perfectly elastic.' },
  { kind: 'bool', key: 'snap', label: 'Snap to grid (0.25 m)', value: true },
]

const MODES = [{ id: 'world', label: 'Rigid bodies', blurb: 'Draw boxes, circles and polygons, join them, add motors, and throw them around.' }]

function ground(spec: SandboxSpec, w = 24): SandboxSpec {
  return addBox(spec, 0, -0.25, w, 0.5, { type: 'static', friction: 0.8, restitution: 0.1, color: COLORS.fixed })
}

/** Ready-made worlds (also used by the examples). */
export const SANDBOX_WORLDS: Record<string, { name: string; spec: SandboxSpec; gravity?: string }> = (() => {
  const w: Record<string, { name: string; spec: SandboxSpec }> = {}
  // pile of boxes and a ramp
  {
    let s = ground(emptySpec())
    s = addBox(s, -4, 1.4, 6, 0.3, { type: 'static', angle: -20, friction: 0.5 })
    for (let i = 0; i < 4; i++) s = addBox(s, -5.4 + i * 0.1, 3.0 + i * 0.7, 0.6, 0.6, { angle: 0 })
    s = addCircle(s, -6.0, 3.3, 0.35, { restitution: 0.5, friction: 0.3 })
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5 - i; j++) s = addBox(s, 3 + i * 0.3 + j * 0.62, 0.3 + i * 0.6, 0.6, 0.6)
    w.pile = { name: 'Ramp and a pile of boxes', spec: s }
  }
  // a car with wheel joints
  {
    let s = ground(emptySpec(), 60)
    s = addBox(s, 12, 0.3, 6, 0.5, { type: 'static', angle: 12, friction: 0.9 })
    s = addBox(s, 0, 0.9, 2.2, 0.5, { density: 1, friction: 0.5, id: 'chassis' })
    s = addCircle(s, -0.8, 0.5, 0.4, { density: 1.5, friction: 1, id: 'rear' })
    s = addCircle(s, 0.8, 0.5, 0.4, { density: 1.5, friction: 1, id: 'front' })
    s = addJoint(s, { kind: 'wheel', a: 'chassis', b: 'rear', ax: -0.8, ay: 0.5, axisX: 0, axisY: 1, motor: true, speed: -14, maxForce: 25, freq: 4, damping: 0.7 })
    s = addJoint(s, { kind: 'wheel', a: 'chassis', b: 'front', ax: 0.8, ay: 0.5, axisX: 0, axisY: 1, motor: false, freq: 4, damping: 0.7 })
    w.car = { name: 'Car with a motor and suspension', spec: s }
  }
  // pulley
  {
    let s = ground(emptySpec(), 12)
    s = addBox(s, -1.5, 1.2, 1, 0.8, { id: 'heavy', density: 1.5 })
    s = addBox(s, 1.5, 1.2, 1, 0.8, { id: 'light', density: 0.8 })
    s = addJoint(s, { kind: 'pulley', a: 'heavy', b: 'light', ax: -1.5, ay: 1.6, bx: 1.5, by: 1.6, gax: -1.5, gay: 5, gbx: 1.5, gby: 5, ratio: 1 })
    w.pulley = { name: 'Pulley (Atwood machine)', spec: s }
  }
  // chain of pendulums
  {
    let s = ground(emptySpec(), 14)
    s = addBox(s, 0, 6, 1, 0.3, { type: 'static', id: 'pivot' })
    let prev = 'pivot'
    let y = 6
    for (let i = 0; i < 5; i++) {
      y -= 0.8
      s = addBox(s, 0.7 * (i + 1) * 0.0 + 0, y + 0.4, 0.2, 0.8, { id: `link${i + 1}`, density: 1 })
      s = addJoint(s, { kind: 'revolute', a: prev, b: `link${i + 1}`, ax: 0, ay: y + 0.8 })
      prev = `link${i + 1}`
    }
    s = updateBody(s, 'link1', { angle: 80, x: 0.4, y: 5.6 })
    w.chain = { name: 'Chain of hinged links', spec: s }
  }
  // seesaw
  {
    let s = ground(emptySpec(), 14)
    s = addBox(s, 0, 0.55, 0.3, 1.1, { type: 'static', id: 'post' })
    s = addBox(s, 0, 1.2, 6, 0.2, { id: 'plank', density: 1 })
    s = addJoint(s, { kind: 'revolute', a: 'post', b: 'plank', ax: 0, ay: 1.2 })
    s = addBox(s, -2.5, 2.2, 0.8, 0.8, { density: 2, id: 'weight' })
    s = addCircle(s, 2.5, 4.5, 0.3, { density: 1, id: 'ball', restitution: 0.3 })
    w.seesaw = { name: 'Seesaw and a dropped ball', spec: s }
  }
  // slider with motor and a weld
  {
    let s = ground(emptySpec(), 14)
    s = addBox(s, 0, 3, 5, 0.2, { type: 'static', id: 'rail' })
    s = addBox(s, -1.5, 2.6, 0.8, 0.6, { id: 'slider', density: 2 })
    s = addJoint(s, { kind: 'prismatic', a: 'rail', b: 'slider', ax: -1.5, ay: 2.6, axisX: 1, axisY: 0, motor: true, speed: 1.5, maxForce: 60, limit: true, lower: -2, upper: 2 })
    s = addBox(s, 2.5, 0.6, 0.6, 1.2, { id: 'mast', density: 1 })
    s = addBox(s, 2.5, 1.5, 1.6, 0.2, { id: 'arm', density: 1 })
    s = addJoint(s, { kind: 'weld', a: 'mast', b: 'arm', ax: 2.5, ay: 1.2 })
    w.slider = { name: 'Motorised slider and a welded T', spec: s }
  }
  return w
})()

export const SANDBOX: SceneDef = {
  id: 'sandbox',
  name: 'Rigid-body sandbox',
  blurb: 'Boxes, circles and polygons with joints and motors, simulated with planck (Box2D).',
  modes: MODES,
  params: PARAMS,
  defaults: (mode) => ({ ...defaultsFor(PARAMS, mode === 'world' ? 'world' : 'world'), world: SANDBOX_WORLDS.pile.spec as unknown as Record<string, unknown> }),
  presets: () => Object.entries(SANDBOX_WORLDS).map(([, v]) => ({ name: v.name, params: { world: v.spec as unknown as Record<string, unknown> } })),
  create: (params, method = 'rk4') => {
    const spec = readSpec(params.world)
    const g = gravityOf(params)
    return new SandboxSim(spec, [0, -g], params, method)
  },
}

