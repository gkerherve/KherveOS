// Dynamic mode (pure apart from the planck physics library): the same linkage built as rigid bodies in planck
// (Box2D) with revolute and prismatic joints, masses from the link geometry and density, a motor at the driver
// (constant speed or constant torque) and gravity on or off. It gives the motion with inertia, the motor torque
// and the joint reaction forces, to compare with the kinematic analysis.
//
// Units: the drawing is in mm; planck works in "world units" of 1 cm (so the mechanisms are not tiny for its
// tolerances): positions /10, g = 981, masses in kg. Forces come back in newtons and torques in N·m.

import * as planck from 'planck'
import { defaultOutput, type OutputSpec } from './analysis.ts'
import { DEFAULT_MATERIAL, makeSolver, pointsAt, velocities, velocityMap, type Linkage, type LLink } from './linkage.ts'
import { deg, rad, TAU, type Pt } from './math.ts'

const W = 0.1 // mm → world units (1 unit = 1 cm)
const G = 981 // cm/s²
const FORCE = 0.01 // world force unit (kg·cm/s²) → N
const TORQUE = 1e-4 // kg·cm²/s² → N·m

export interface DynamicsOptions {
  /** Revolutions of the driver to simulate. */
  revs?: number
  /** 'speed': the motor holds the driver's rpm; 'torque': a constant torque (N·m) is applied from the initial speed. */
  mode?: 'speed' | 'torque'
  /** rpm for 'speed' (default: the driver's), N·m for 'torque'. */
  value?: number
  /** Initial speed in rpm for 'torque' mode (default: the driver's rpm). */
  rpm0?: number
  gravity?: boolean
  /** Steps per degree of the driver at its speed (default 16; the solver dissipates a little energy that shrinks with the step). */
  stepsPerDeg?: number
  output?: OutputSpec | null
  /** Extra inertia on the driver shaft, kg·m² (a flywheel). */
  flywheel?: number
}

export interface DynJoint {
  name: string
  /** peak reaction force over the run, N */
  peak: number
  /** reaction force magnitude over the samples, N */
  force: number[]
}

export interface DynResult {
  ok: boolean
  message?: string
  /** samples */
  t: number[]
  /** driver angle (unwrapped), degrees */
  theta: number[]
  /** driver speed, rpm */
  rpm: number[]
  /** motor torque (N·m); the applied torque in 'torque' mode */
  motorTorque: number[]
  outLabel: string
  outUnit: 'deg' | 'mm' | ''
  outPos: number[]
  outVel: number[]
  joints: DynJoint[]
  totalMass: number
  linkMass: Array<{ id: string; mass: number }>
  /** kinetic + potential energy (J), to show conservation or the work of the motor */
  energy: number[]
  /** positions of the tracers (mm) */
  tracers: Record<string, Pt[]>
}

interface BodyRec {
  body: planck.Body
  /** local coordinates (world units) of every model point that sits on this body */
  local: Map<string, planck.Vec2>
}

function linkEdges(l: LLink): Array<[number, number]> {
  const n = l.pts.length
  const e: Array<[number, number]> = []
  if (l.shape === 'star') for (let i = 1; i < n; i++) e.push([0, i])
  else for (let i = 0; i + 1 < n; i++) e.push([i, i + 1])
  if (l.shape === 'plate' && n >= 3) e.push([n - 1, 0])
  return e
}

/** Mass of a link from its geometry (kg), the same as the dynamic model uses. */
export function linkMass(m: Linkage, l: LLink): number {
  const mat = m.material ?? DEFAULT_MATERIAL
  const P = new Map(m.points.map((p) => [p.id, p]))
  const area = (a: string, b: string) => {
    const p = P.get(a)!; const q = P.get(b)!
    return Math.hypot(q.x - p.x, q.y - p.y) * mat.width
  }
  let mm2 = 0
  if (l.shape === 'plate' && l.pts.length >= 3) {
    const p0 = P.get(l.pts[0])!
    for (let i = 1; i + 1 < l.pts.length; i++) {
      const p = P.get(l.pts[i])!; const q = P.get(l.pts[i + 1])!
      mm2 += Math.abs((p.x - p0.x) * (q.y - p0.y) - (q.x - p0.x) * (p.y - p0.y)) / 2
    }
  } else for (const [i, j] of linkEdges(l)) mm2 += area(l.pts[i], l.pts[j])
  return (mm2 * 1e-6) * (mat.thickness * 1e-3) * mat.density
}

export function runDynamics(model: Linkage, opts: DynamicsOptions = {}): DynResult {
  const solver = makeSolver(model)
  const empty: DynResult = {
    ok: false, t: [], theta: [], rpm: [], motorTorque: [], outLabel: '', outUnit: '', outPos: [], outVel: [], joints: [], totalMass: 0, linkMass: [], energy: [], tracers: {},
  }
  if (solver.sys.errors.length) return { ...empty, message: solver.sys.errors[0] }
  if (!solver.ok || !model.driver) return { ...empty, message: model.driver ? 'The drawn pose cannot be assembled.' : 'Add a driver to run the dynamics.' }
  const drv = model.driver
  const dpt = model.points.find((p) => p.id === drv.from)
  if (!dpt?.ground) return { ...empty, message: 'The dynamic model needs the driver to turn about a ground pin.' }
  const sys = solver.sys
  const mat = model.material ?? DEFAULT_MATERIAL
  const X0 = solver.X0
  const th0 = solver.theta0
  const P = pointsAt(sys, X0)
  const rpm = opts.mode === 'torque' ? opts.rpm0 ?? drv.rpm : opts.value ?? drv.rpm
  const om = (rpm * TAU) / 60
  const V1 = velocities(sys, X0, th0, 1)
  const Vm = V1 ? velocityMap(sys, V1.map((v) => v * om)) : velocityMap(sys, new Array(sys.free.length * 2).fill(0))

  const world = new planck.World({ gravity: { x: 0, y: opts.gravity ? -G : 0 }, allowSleep: false, warmStarting: true, continuousPhysics: false })
  const ground = world.createBody({ type: 'static', position: { x: 0, y: 0 } })
  const wp = (p: Pt) => planck.Vec2(p.x * W, p.y * W)
  const density = mat.density * (mat.thickness * 1e-3) * 1e-4 // kg/m² → kg per cm² of the world
  const bodies = new Map<string, BodyRec>()
  const pointBodies = new Map<string, string[]>() // point id → body keys
  const addPoint = (id: string, key: string) => { const a = pointBodies.get(id) ?? []; if (!a.includes(key)) a.push(key); pointBodies.set(id, a) }
  const linkMasses: Array<{ id: string; mass: number }> = []

  const slideIds = new Set(model.sliders.map((s) => s.point))
  const makeBody = (key: string, origin: Pt, angle: number, pointIds: string[]): BodyRec => {
    const body = world.createBody({ type: 'dynamic', position: wp(origin), angle })
    const local = new Map<string, planck.Vec2>()
    for (const id of pointIds) local.set(id, body.getLocalPoint(wp(P.get(id)!)))
    const rec = { body, local }
    bodies.set(key, rec)
    return rec
  }

  // links
  for (const l of model.links) {
    const p0 = P.get(l.pts[0])!; const p1 = P.get(l.pts[1])!
    const rec = makeBody(`L:${l.id}`, p0, Math.atan2(p1.y - p0.y, p1.x - p0.x), l.pts)
    const fd = { density, filterGroupIndex: -1 }
    if (l.shape === 'plate' && l.pts.length >= 3) {
      for (let i = 1; i + 1 < l.pts.length; i++) {
        const tri = [l.pts[0], l.pts[i], l.pts[i + 1]].map((id) => rec.local.get(id)!)
        const area = Math.abs((tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y))
        if (area < 1e-9) continue
        const ccw = (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[2].x - tri[0].x) * (tri[1].y - tri[0].y) > 0
        rec.body.createFixture({ shape: new planck.Polygon(ccw ? tri : [tri[0], tri[2], tri[1]]), ...fd })
      }
    } else {
      for (const [i, j] of linkEdges(l)) {
        const a = rec.local.get(l.pts[i])!; const b = rec.local.get(l.pts[j])!
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 1e-6) continue
        const ang = Math.atan2(b.y - a.y, b.x - a.x)
        rec.body.createFixture({ shape: new planck.Box(len / 2, (mat.width * W) / 2, planck.Vec2((a.x + b.x) / 2, (a.y + b.y) / 2), ang), ...fd })
      }
    }
    linkMasses.push({ id: l.id, mass: rec.body.getMass() * 1 })
    for (const id of l.pts) if (!slideIds.has(id)) addPoint(id, `L:${l.id}`)
  }

  // sliders: a block at the point
  const slideAxes = new Map<string, { axis: planck.Vec2; host: string | null }>()
  for (const s of model.sliders) {
    const p = P.get(s.point)!
    const rec = makeBody(`S:${s.id}`, p, 0, [s.point])
    const m = Math.max(0.005, s.mass ?? 0.05)
    rec.body.createFixture({ shape: new planck.Box(0.8, 0.5), density: 1, filterGroupIndex: -1 })
    // fix the mass to what was asked
    rec.body.setMassData({ mass: m, center: planck.Vec2(0, 0), I: (m * (1.6 * 1.6 + 1)) / 12 })
    for (const l of model.links) if (l.pts.includes(s.point)) addPoint(s.point, `L:${l.id}`)
    addPoint(s.point, `S:${s.id}`)
    if (s.line.kind === 'ground') slideAxes.set(s.id, { axis: planck.Vec2(Math.cos(rad(s.line.angle)), Math.sin(rad(s.line.angle))), host: null })
    else {
      const a = P.get(s.line.a)!; const b = P.get(s.line.b)!
      const host = model.links.find((l) => l.pts.includes((s.line as { a: string }).a) && l.pts.includes((s.line as { b: string }).b))
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      slideAxes.set(s.id, { axis: planck.Vec2(Math.cos(ang), Math.sin(ang)), host: host ? `L:${host.id}` : null })
    }
  }

  // initial velocities from the kinematic solution
  const setVelocities = () => {
    for (const [key, rec] of bodies) {
      let a: string; let b: string | undefined
      if (key.startsWith('L:')) { const l = model.links.find((x) => `L:${x.id}` === key)!; a = l.pts[0]; b = l.pts[1] } else { a = [...rec.local.keys()][0] }
      const va = Vm.get(a) ?? { x: 0, y: 0 }
      let w = 0
      if (b) {
        const pa = P.get(a)!; const pb = P.get(b)!; const vb = Vm.get(b) ?? { x: 0, y: 0 }
        const dx = pb.x - pa.x; const dy = pb.y - pa.y
        w = (dx * (vb.y - va.y) - dy * (vb.x - va.x)) / (dx * dx + dy * dy)
      }
      rec.body.setAngularVelocity(w)
      const c = rec.body.getWorldCenter()
      const o = rec.body.getPosition()
      const rx = c.x - o.x; const ry = c.y - o.y
      rec.body.setLinearVelocity({ x: va.x * W - w * ry, y: va.y * W + w * rx })
    }
  }
  setVelocities()

  // joints
  const joints: Array<{ name: string; joint: planck.Joint }> = []
  let motor: planck.RevoluteJoint | null = null
  const crank = model.links.find((l) => l.pts.includes(drv.from) && l.pts.includes(drv.to))
  const crankKey = crank ? `L:${crank.id}` : null
  const bodyOf = (key: string) => (key === 'ground' ? ground : bodies.get(key)!.body)
  const nameOf = (id: string) => model.points.find((p) => p.id === id)?.label ?? id
  const speedMode = opts.mode !== 'torque'
  for (const pt of model.points) {
    const keys = [...(pointBodies.get(pt.id) ?? [])]
    if (pt.ground) keys.unshift('ground')
    if (keys.length < 2) continue
    const anchor = wp(P.get(pt.id)!)
    for (let i = 1; i < keys.length; i++) {
      const j = new planck.RevoluteJoint({ enableMotor: false }, bodyOf(keys[0]), bodyOf(keys[i]), anchor)
      if (pt.id === drv.from && keys[0] === 'ground' && keys[i] === crankKey) {
        j.enableMotor(speedMode)
        if (speedMode) { j.setMotorSpeed(om); j.setMaxMotorTorque(1e9) }
        motor = j
      }
      const created = world.createJoint(j)
      if (created) joints.push({ name: `${nameOf(pt.id)}${keys.length > 2 ? `(${i})` : ''}`, joint: created })
    }
  }
  for (const s of model.sliders) {
    const ax = slideAxes.get(s.id)!
    const blk = bodies.get(`S:${s.id}`)!.body
    const anchor = wp(P.get(s.point)!)
    const host = ax.host ? bodies.get(ax.host)!.body : ground
    if (s.line.kind === 'link' && !ax.host) continue
    const j = world.createJoint(new planck.PrismaticJoint({ enableMotor: false }, host, blk, anchor, ax.axis))
    if (j) joints.push({ name: `slide ${s.label ?? s.id}`, joint: j })
  }
  if (!motor) return { ...empty, message: 'The driver link must be a link pinned to the ground at the driver’s first point.' }
  const crankBody = bodyOf(crankKey!)
  const flyI = (opts.flywheel ?? 0) * 1e4 // kg·m² → kg·cm²
  if (flyI > 0) {
    const mass = crankBody.getMass()
    const c = crankBody.getLocalCenter()
    const I = crankBody.getInertia()
    crankBody.setMassData({ mass, center: c, I: I + flyI })
  }

  let totalMass = 0
  for (const rec of bodies.values()) totalMass += rec.body.getMass()

  // output spec
  const out = opts.output === undefined ? defaultOutput(model) : opts.output
  const outRead = (): { pos: number; vel: number } => {
    if (!out) return { pos: NaN, vel: NaN }
    const worldPoint = (id: string): planck.Vec2 => {
      const keys = pointBodies.get(id) ?? []
      const key = keys.find((k) => k.startsWith('S:')) ?? keys[0]
      const rec = key ? bodies.get(key) : undefined
      return rec ? rec.body.getWorldPoint(rec.local.get(id)!) : ground.getWorldPoint(wp(P.get(id)!))
    }
    const velOf = (id: string): planck.Vec2 => {
      const keys = pointBodies.get(id) ?? []
      const key = keys.find((k) => k.startsWith('S:')) ?? keys[0]
      const rec = key ? bodies.get(key) : undefined
      return rec ? rec.body.getLinearVelocityFromWorldPoint(worldPoint(id)) : planck.Vec2(0, 0)
    }
    if (out.kind === 'link') {
      const a = worldPoint(out.from); const b = worldPoint(out.to)
      const host = model.links.find((l) => l.pts.includes(out.from) && l.pts.includes(out.to))
      const w = host ? bodies.get(`L:${host.id}`)!.body.getAngularVelocity() : 0
      return { pos: Math.atan2(b.y - a.y, b.x - a.x), vel: deg(w) }
    }
    if (out.kind === 'slider') {
      const s = model.sliders.find((x) => x.point === out.point)
      const p = worldPoint(out.point); const v = velOf(out.point)
      const t = s && s.line.kind === 'ground' ? { x: Math.cos(rad(s.line.angle)), y: Math.sin(rad(s.line.angle)) } : { x: 1, y: 0 }
      const o = s && s.line.kind === 'ground' ? { x: s.line.x * W, y: s.line.y * W } : { x: 0, y: 0 }
      return { pos: ((p.x - o.x) * t.x + (p.y - o.y) * t.y) / W, vel: (v.x * t.x + v.y * t.y) / W }
    }
    const p = worldPoint(out.point); const v = velOf(out.point)
    return out.axis === 'x' ? { pos: p.x / W, vel: v.x / W } : { pos: p.y / W, vel: v.y / W }
  }

  const stepsPerDeg = opts.stepsPerDeg ?? 16
  const dt = Math.abs(1 / (stepsPerDeg * Math.max(1e-6, Math.abs(om) * 180 / Math.PI)))
  const revs = opts.revs ?? 1
  const total = Math.max(10, Math.round(revs * 360 * stepsPerDeg))
  const sampleEvery = Math.max(1, Math.round(stepsPerDeg))
  const torqueApplied = opts.mode === 'torque' ? (opts.value ?? 0) / TORQUE : 0
  const result: DynResult = {
    ...empty, ok: true, outLabel: out ? (out.kind === 'link' ? 'output angular velocity' : 'output velocity') : '', outUnit: out ? (out.kind === 'link' ? 'deg' : 'mm') : '',
    totalMass, linkMass: linkMasses, joints: joints.map((j) => ({ name: j.name, peak: 0, force: [] })),
  }
  const tracerIds = model.points.filter((p) => p.tracer).map((p) => p.id)
  for (const id of tracerIds) result.tracers[id] = []
  let thetaUnwrapped = rad(deg(th0))
  let lastAngle = Math.atan2(
    crankBody.getWorldPoint(bodies.get(crankKey!)!.local.get(drv.to)!).y - crankBody.getWorldPoint(bodies.get(crankKey!)!.local.get(drv.from)!).y,
    crankBody.getWorldPoint(bodies.get(crankKey!)!.local.get(drv.to)!).x - crankBody.getWorldPoint(bodies.get(crankKey!)!.local.get(drv.from)!).x,
  )
  const crankRec = bodies.get(crankKey!)!
  const energy = () => {
    let e = 0
    for (const rec of bodies.values()) {
      const m = rec.body.getMass()
      const v = rec.body.getLinearVelocity()
      const c = rec.body.getWorldCenter()
      const lc = rec.body.getLocalCenter()
      const Ic = rec.body.getInertia() - m * (lc.x * lc.x + lc.y * lc.y)
      e += 0.5 * m * (v.x * v.x + v.y * v.y) + 0.5 * Ic * rec.body.getAngularVelocity() ** 2 + (opts.gravity ? m * G * c.y : 0)
    }
    return e * 1e-4 // kg·cm²/s² → J
  }
  const record = (k: number) => {
    const a = crankRec.body.getWorldPoint(crankRec.local.get(drv.from)!)
    const b = crankRec.body.getWorldPoint(crankRec.local.get(drv.to)!)
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    thetaUnwrapped += Math.atan2(Math.sin(ang - lastAngle), Math.cos(ang - lastAngle))
    lastAngle = ang
    result.t.push(k * dt)
    result.energy.push(energy())
    result.theta.push(deg(thetaUnwrapped))
    result.rpm.push((crankBody.getAngularVelocity() * 60) / TAU)
    const inv = 1 / dt
    result.motorTorque.push(speedMode ? motor!.getMotorTorque(inv) * TORQUE : (opts.value ?? 0))
    const o = outRead()
    result.outPos.push(out?.kind === 'link' ? deg(o.pos) : o.pos)
    result.outVel.push(o.vel)
    joints.forEach((j, i) => {
      const f = j.joint.getReactionForce(inv)
      const mag = Math.hypot(f.x, f.y) * FORCE
      result.joints[i].force.push(mag)
      if (mag > result.joints[i].peak) result.joints[i].peak = mag
    })
    for (const id of tracerIds) {
      const keys = pointBodies.get(id) ?? []
      const rec = keys.length ? bodies.get(keys.find((kk) => kk.startsWith('S:')) ?? keys[0]) : undefined
      const p = rec ? rec.body.getWorldPoint(rec.local.get(id)!) : null
      if (p) result.tracers[id].push({ x: p.x / W, y: p.y / W })
    }
  }
  record(0)
  try {
    for (let k = 1; k <= total; k++) {
      if (!speedMode) crankBody.applyTorque(torqueApplied)
      world.step(dt, 30, 12)
      if (k % sampleEvery === 0) record(k)
    }
  } catch (e) {
    return { ...result, ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  if (result.rpm.some((v) => !Number.isFinite(v))) return { ...result, ok: false, message: 'The simulation became unstable (check masses and speed).' }
  return result
}
