// Kinematic analysis of a linkage over its input cycle (pure): positions, velocities, accelerations of an output,
// transmission angle, mechanical advantage, coupler curves and cusps, range of motion, quick-return ratio,
// dead centres and static torque by virtual work.

import { classifyFourBar, quickReturnFromAngles, type Grashof } from './fourbar.ts'
import {
  accelerations, inputRange, makeSolver, pointsAt, poseAt, singularity, stepTo, trace, velocities, velocityMap, type Frame, type InputRange, type Linkage, type LLink, type Solver,
} from './linkage.ts'
import { deg, hypot, linspace, rad, TAU, wrapPi, type Pt } from './math.ts'

// ------------------------------------------------------------------------------ outputs

export type OutputSpec =
  | { kind: 'link'; from: string; to: string }
  | { kind: 'slider'; point: string }
  | { kind: 'point'; point: string; axis: 'x' | 'y' }

export function describeOutput(m: Linkage, o: OutputSpec): string {
  const name = (id: string) => m.points.find((p) => p.id === id)?.label ?? id
  if (o.kind === 'link') return `angle of ${name(o.from)}→${name(o.to)}`
  if (o.kind === 'slider') return `slide of ${name(o.point)}`
  return `${o.axis} of ${name(o.point)}`
}

/** A sensible output: the first slider, else the rocker (a link with a ground pivot that is not the driver). */
export function defaultOutput(m: Linkage): OutputSpec | null {
  const slider = m.sliders.find((s) => s.line.kind === 'ground')
  if (slider) return { kind: 'slider', point: slider.point }
  const ground = new Set(m.points.filter((p) => p.ground).map((p) => p.id))
  const d = m.driver
  const isDriver = (l: LLink) => !!d && l.pts.includes(d.from) && l.pts.includes(d.to)
  const rockers = m.links.filter((l) => !isDriver(l) && l.pts.some((p) => ground.has(p)))
  const pick = rockers[rockers.length - 1]
  if (pick) {
    const g = pick.pts.find((p) => ground.has(p))!
    const other = pick.pts.find((p) => !ground.has(p))
    if (other) return { kind: 'link', from: g, to: other }
  }
  const last = m.links[m.links.length - 1]
  if (last && last.pts.length >= 2) return { kind: 'link', from: last.pts[0], to: last.pts[1] }
  return null
}

/** Values of the output and its derivatives with respect to the input angle (per rad, per rad²). */
function outputDerivs(solver: Solver, o: OutputSpec, X: number[], V: number[], A: number[], prevAngle?: number): { pos: number; d1: number; d2: number } {
  const sys = solver.sys
  const P = pointsAt(sys, X)
  const Vm = velocityMap(sys, V)
  const Am = velocityMap(sys, A)
  if (o.kind === 'link') {
    const p = P.get(o.from)!; const q = P.get(o.to)!
    const vp = Vm.get(o.from)!; const vq = Vm.get(o.to)!
    const ap = Am.get(o.from)!; const aq = Am.get(o.to)!
    const dx = q.x - p.x; const dy = q.y - p.y
    const dvx = vq.x - vp.x; const dvy = vq.y - vp.y
    const dax = aq.x - ap.x; const day = aq.y - ap.y
    const L2 = dx * dx + dy * dy
    const w = (dx * dvy - dy * dvx) / L2
    const al = (dx * day - dy * dax) / L2 - (2 * w * (dx * dvx + dy * dvy)) / L2
    let ang = Math.atan2(dy, dx)
    if (prevAngle !== undefined) ang = prevAngle + wrapPi(ang - prevAngle)
    return { pos: ang, d1: w, d2: al }
  }
  if (o.kind === 'slider') {
    const s = sys.model.sliders.find((x) => x.point === o.point)
    const p = P.get(o.point)!
    if (!s || s.line.kind !== 'ground') return { pos: p.x, d1: Vm.get(o.point)!.x, d2: Am.get(o.point)!.x }
    const t = { x: Math.cos(rad(s.line.angle)), y: Math.sin(rad(s.line.angle)) }
    const v = Vm.get(o.point)!; const a = Am.get(o.point)!
    return { pos: (p.x - s.line.x) * t.x + (p.y - s.line.y) * t.y, d1: v.x * t.x + v.y * t.y, d2: a.x * t.x + a.y * t.y }
  }
  const p = P.get(o.point)!; const v = Vm.get(o.point)!; const a = Am.get(o.point)!
  return o.axis === 'x' ? { pos: p.x, d1: v.x, d2: a.x } : { pos: p.y, d1: v.y, d2: a.y }
}

/** Transmission angle in degrees: for a rocker the angle between coupler and rocker at their joint (0…180), for a slider 90° minus the coupler's slope to the slide. */
export function transmissionOf(m: Linkage, o: OutputSpec, P: ReadonlyMap<string, Pt>): number | null {
  const ground = new Set(m.points.filter((p) => p.ground).map((p) => p.id))
  if (o.kind === 'link') {
    const J = ground.has(o.to) ? o.from : o.to
    const G = J === o.to ? o.from : o.to
    if (!ground.has(G)) return null
    const outLink = m.links.find((l) => l.pts.includes(o.from) && l.pts.includes(o.to))
    const coupler = m.links.find((l) => l !== outLink && l.pts.includes(J))
    if (!coupler) return null
    const C = coupler.pts.find((id) => id !== J && !ground.has(id)) ?? coupler.pts.find((id) => id !== J)
    const pj = P.get(J); const pg = P.get(G); const pc = C ? P.get(C) : undefined
    if (!pj || !pg || !pc) return null
    const a1 = Math.atan2(pg.y - pj.y, pg.x - pj.x)
    const a2 = Math.atan2(pc.y - pj.y, pc.x - pj.x)
    return deg(Math.abs(wrapPi(a1 - a2)))
  }
  if (o.kind === 'slider') {
    const s = m.sliders.find((x) => x.point === o.point)
    if (!s) return null
    const coupler = m.links.find((l) => l.pts.includes(o.point))
    if (!coupler) return null
    const C = coupler.pts.find((id) => id !== o.point)
    const ps = P.get(o.point); const pc = C ? P.get(C) : undefined
    if (!ps || !pc) return null
    let slide: number
    if (s.line.kind === 'ground') slide = rad(s.line.angle)
    else { const a = P.get(s.line.a); const b = P.get(s.line.b); if (!a || !b) return null; slide = Math.atan2(b.y - a.y, b.x - a.x) }
    const rodAng = Math.atan2(pc.y - ps.y, pc.x - ps.x)
    let d = Math.abs(wrapPi(rodAng - slide))
    if (d > Math.PI / 2) d = Math.PI - d
    return 90 - deg(d)
  }
  return null
}

// ------------------------------------------------------------------------------ the cycle

export interface CycleOptions {
  /** Samples per turn (default 360). */
  steps?: number
  output?: OutputSpec | null
  /** Override the driver speed, rpm. */
  rpm?: number
}

export interface Cycle {
  ok: boolean
  message?: string
  solver: Solver
  /** degrees of freedom of the closed linkage with the driver fixed (0 = a proper one-input mechanism) */
  dof: number
  mobility: number
  range: InputRange
  /** absolute input angles, degrees */
  theta: number[]
  frames: Frame[]
  rpm: number
  /** rad/s */
  omega: number
  output: OutputSpec | null
  outputLabel: string
  outputUnit: 'deg' | 'mm' | ''
  /** output position, velocity and acceleration at the driver speed (deg, deg/s, deg/s² or mm, mm/s, mm/s²) */
  pos: number[]
  vel: number[]
  acc: number[]
  /** d(out)/d(input) in deg/deg or mm/rad … the kinematic coefficient */
  coef: number[]
  /** transmission angle, degrees (null when the mechanism has none) */
  mu: Array<number | null>
  /** mechanical advantage |T_out / T_in| (rotary) or |F_out / T_in| per metre (slider) */
  ma: number[]
  /** singularity measure per frame (σmin/σmax) */
  sing: number[]
  /** paths of the tracer points */
  tracers: Record<string, Pt[]>
  summary: CycleSummary
  grashof: Grashof | null
}

export interface CycleSummary {
  outMin: number
  outMax: number
  /** range of motion of the output (max − min) */
  span: number
  thetaAtMin: number
  thetaAtMax: number
  muMin: number | null
  muMax: number | null
  /** fraction of the cycle with the transmission angle within 40°…140° */
  muGoodShare: number | null
  deadCentres: number[]
  peakVel: number
  peakAcc: number
  quickReturn: { ratio: number; forwardDeg: number; returnDeg: number; betaDeg: number } | null
}

/** The four-bar lengths of a model made of exactly one crank, a coupler and a rocker on two ground pins (extra points on the links are fine). */
export function fourBarOf(m: Linkage): { a: number; b: number; c: number; d: number } | null {
  if (m.sliders.length || !m.driver || m.links.length !== 3) return null
  const ground = m.points.filter((p) => p.ground)
  if (ground.length !== 2) return null
  const P = (id: string) => m.points.find((p) => p.id === id)
  const dist = (a: string, b: string) => hypot(P(a)!.x - P(b)!.x, P(a)!.y - P(b)!.y)
  const O2 = m.driver.from
  const A = m.driver.to
  if (!P(O2)?.ground || !P(A) || P(A)!.ground) return null
  const crank = m.links.find((l) => l.pts.length === 2 && l.pts.includes(O2) && l.pts.includes(A))
  const O4 = ground.find((g) => g.id !== O2)?.id
  if (!crank || !O4) return null
  const rocker = m.links.find((l) => l !== crank && l.pts.includes(O4))
  const coupler = m.links.find((l) => l !== crank && l !== rocker)
  if (!rocker || !coupler || !coupler.pts.includes(A)) return null
  const B = rocker.pts.find((p) => p !== O4 && coupler.pts.includes(p) && p !== A)
  if (!B) return null
  return { a: dist(O2, A), b: dist(A, B), c: dist(O4, B), d: dist(O2, O4) }
}

export function analyseCycle(model: Linkage & { output?: OutputSpec | null }, opts: CycleOptions = {}): Cycle {
  const solver = makeSolver(model)
  const sys = solver.sys
  const rpm = opts.rpm ?? model.driver?.rpm ?? 60
  const omega = (rpm * TAU) / 60
  const out0: OutputSpec | null = opts.output !== undefined ? opts.output : model.output !== undefined ? model.output : defaultOutput(model)
  const base: Cycle = {
    ok: false, solver, dof: 0, mobility: sys.mobility, range: { full: true, min: 0, max: 0 }, theta: [], frames: [], rpm, omega, output: out0, outputLabel: '', outputUnit: '',
    pos: [], vel: [], acc: [], coef: [], mu: [], ma: [], sing: [], tracers: {}, grashof: null,
    summary: { outMin: 0, outMax: 0, span: 0, thetaAtMin: 0, thetaAtMax: 0, muMin: null, muMax: null, muGoodShare: null, deadCentres: [], peakVel: 0, peakAcc: 0, quickReturn: null },
  }
  if (sys.errors.length) return { ...base, message: sys.errors[0] }
  if (!model.driver) return { ...base, message: 'Add a driver (a crank) to analyse the motion.' }
  if (!solver.ok) return { ...base, message: 'The drawn pose cannot be assembled: a link is too short to close a loop.' }
  base.dof = sys.free.length * 2 - sys.cons.length
  if (base.dof > 0) return { ...base, message: `The mechanism has ${base.dof} degree${base.dof > 1 ? 's' : ''} of freedom more than the driver controls: add links or sliders so one input fixes the pose.` }

  const steps = Math.max(8, Math.min(2880, Math.round(opts.steps ?? 360)))
  let range = inputRange(sys, solver.X0, solver.theta0)
  const lim = model.limits
  let lo: number
  let hi: number
  if (lim) {
    lo = rad(lim.min); hi = rad(lim.max)
    // the allowed window must contain the drawn pose
    if (solver.theta0 < lo - 1e-9 || solver.theta0 > hi + 1e-9) { lo = Math.min(lo, solver.theta0); hi = Math.max(hi, solver.theta0) }
    if (!range.full) { lo = Math.max(lo, range.min); hi = Math.min(hi, range.max) }
  } else if (range.full) {
    lo = solver.theta0; hi = solver.theta0 + TAU
  } else {
    lo = range.min; hi = range.max
  }
  range = lim ? { full: false, min: lo, max: hi } : range
  const eps = range.full ? 0 : (hi - lo) * 5e-4
  let thetas: number[]
  let frames: Frame[]
  if (range.full) {
    thetas = linspace(lo, hi, steps + 1)
    frames = trace(sys, solver.X0, thetas)
  } else {
    const all = linspace(lo + eps, hi - eps, steps + 1)
    const up = all.filter((t) => t >= solver.theta0)
    const down = all.filter((t) => t < solver.theta0).reverse()
    const fu = up.length ? trace(sys, solver.X0, [solver.theta0, ...up]).slice(1) : []
    const fd = down.length ? trace(sys, solver.X0, [solver.theta0, ...down]).slice(1).reverse() : []
    frames = [...fd, ...fu]
    thetas = frames.map((f) => f.theta)
  }
  const bad = frames.findIndex((f) => !f.ok)
  if (bad >= 0) frames = frames.slice(0, bad), thetas = thetas.slice(0, bad)
  if (frames.length < 2) return { ...base, range, message: 'The mechanism cannot move from the drawn pose (lock-up).' }

  const cycle: Cycle = { ...base, ok: true, range, theta: thetas.map(deg), frames, mobility: sys.mobility, dof: 0 }
  const o = out0
  cycle.outputLabel = o ? describeOutput(model, o) : ''
  cycle.outputUnit = o ? (o.kind === 'link' ? 'deg' : 'mm') : ''
  const tracerIds = model.points.filter((p) => p.tracer).map((p) => p.id)
  for (const id of tracerIds) cycle.tracers[id] = []
  let prevAng: number | undefined
  const unit = o?.kind === 'link' ? 180 / Math.PI : 1
  for (const f of frames) {
    const V = velocities(sys, f.X, f.theta, 1)
    const P = pointsAt(sys, f.X)
    for (const id of tracerIds) cycle.tracers[id].push({ ...P.get(id)! })
    const sg = singularity(sys, f.X, f.theta)
    cycle.sing.push(sg.ratio)
    if (!V) {
      cycle.pos.push(NaN); cycle.vel.push(NaN); cycle.acc.push(NaN); cycle.coef.push(NaN); cycle.mu.push(null); cycle.ma.push(NaN)
      continue
    }
    const A = accelerations(sys, f.X, V, f.theta, 1, 0) ?? V.map(() => NaN)
    if (o) {
      const d = outputDerivs(solver, o, f.X, V, A, prevAng)
      if (o.kind === 'link') prevAng = d.pos
      cycle.pos.push(d.pos * unit)
      cycle.coef.push(d.d1 * (o.kind === 'link' ? 1 : 1))
      cycle.vel.push(d.d1 * omega * unit)
      cycle.acc.push(d.d2 * omega * omega * unit)
      cycle.mu.push(transmissionOf(model, o, P))
      cycle.ma.push(Math.abs(d.d1) > 1e-12 ? (o.kind === 'link' ? 1 / Math.abs(d.d1) : 1000 / Math.abs(d.d1)) : Infinity)
    } else {
      cycle.pos.push(NaN); cycle.vel.push(NaN); cycle.acc.push(NaN); cycle.coef.push(NaN); cycle.mu.push(null); cycle.ma.push(NaN)
    }
  }
  cycle.grashof = (() => { const g = fourBarOf(model); return g ? classifyFourBar(g) : null })()
  cycle.summary = summarize(cycle)
  refineStrokeEnds(cycle)
  return cycle
}

function summarize(c: Cycle): CycleSummary {
  const finite = c.pos.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v))
  let outMin = 0; let outMax = 0; let iMin = 0; let iMax = 0
  if (finite.length) {
    iMin = finite.reduce((a, b) => (b[0] < a[0] ? b : a))[1]
    iMax = finite.reduce((a, b) => (b[0] > a[0] ? b : a))[1]
    outMin = c.pos[iMin]; outMax = c.pos[iMax]
  }
  const mus = c.mu.filter((v): v is number => v !== null && Number.isFinite(v))
  const good = mus.filter((m) => m >= 40 && m <= 140).length
  const dead: number[] = []
  c.mu.forEach((m, i) => {
    if (m === null) return
    const lo = m < 0.5 || m > 179.5
    const prev = c.mu[i - 1]; const next = c.mu[i + 1]
    if (lo) dead.push(c.theta[i])
    else if (prev != null && next != null && m <= prev && m <= next && m < 3) dead.push(c.theta[i])
  })
  let qr: CycleSummary['quickReturn'] = null
  const winds = Math.abs((c.pos[c.pos.length - 1] ?? 0) - (c.pos[0] ?? 0)) > (c.output?.kind === 'link' ? 180 : Infinity)
  if (c.range.full && c.output && finite.length > 3 && !winds) {
    const t1 = rad(c.theta[iMin]); const t2 = rad(c.theta[iMax])
    // the ends of the stroke are the extremes of the output; the forward direction is the sense of rotation
    qr = quickReturnFromAngles(t1, t2)
  }
  return {
    outMin, outMax, span: outMax - outMin, thetaAtMin: c.theta[iMin] ?? 0, thetaAtMax: c.theta[iMax] ?? 0,
    muMin: mus.length ? Math.min(...mus) : null, muMax: mus.length ? Math.max(...mus) : null, muGoodShare: mus.length ? good / mus.length : null,
    deadCentres: dead, peakVel: Math.max(0, ...c.vel.filter(Number.isFinite).map(Math.abs)), peakAcc: Math.max(0, ...c.acc.filter(Number.isFinite).map(Math.abs)), quickReturn: qr,
  }
}

// ------------------------------------------------------------------------------ coupler curves

/** Cusps of a traced path: places where the speed falls close to zero (local minima below 3 % of the peak). */
export function findCusps(c: Cycle, pointId: string): Array<{ index: number; theta: number; at: Pt; speedRatio: number }> {
  const path = c.tracers[pointId]
  if (!path) return []
  const sys = c.solver.sys
  const speeds = c.frames.slice(0, path.length).map((f) => {
    const V = velocities(sys, f.X, f.theta, 1)
    if (!V) return NaN
    const i = sys.index.get(pointId)
    return i === undefined ? 0 : hypot(V[2 * i], V[2 * i + 1])
  })
  const peak = Math.max(...speeds.filter(Number.isFinite), 1e-12)
  const out: Array<{ index: number; theta: number; at: Pt; speedRatio: number }> = []
  const n = c.range.full ? speeds.length - 1 : speeds.length
  for (let i = 0; i < n; i++) {
    const s = speeds[i]
    const p = speeds[(i - 1 + n) % n]
    const q = speeds[(i + 1) % n]
    if (Number.isFinite(s) && s / peak < 0.03 && s <= p && s <= q && (c.range.full || (i > 0 && i < n - 1))) out.push({ index: i, theta: c.theta[i], at: path[i], speedRatio: s / peak })
  }
  return out
}

export interface AtlasCurve {
  /** coordinates of the coupler point in the link's frame (a along p0→p1 in units of its length, b perpendicular) */
  a: number
  b: number
  path: Pt[]
  cusps: number
  closed: boolean
}

/** A grid of coupler points on a link, each with its curve (from the frames of a cycle). */
export function couplerAtlas(c: Cycle, link: LLink, as: number[] = [-0.5, 0, 0.5, 1, 1.5], bs: number[] = [-1, -0.5, 0.5, 1]): AtlasCurve[] {
  if (!c.ok || link.pts.length < 2) return []
  const sys = c.solver.sys
  const out: AtlasCurve[] = []
  const frames = c.frames
  const P = frames.map((f) => pointsAt(sys, f.X))
  for (const b of bs) {
    for (const a of as) {
      const path: Pt[] = []
      for (const pts of P) {
        const p0 = pts.get(link.pts[0])!; const p1 = pts.get(link.pts[1])!
        const ux = p1.x - p0.x; const uy = p1.y - p0.y
        path.push({ x: p0.x + a * ux - b * uy, y: p0.y + a * uy + b * ux })
      }
      // cusps: local minima of the speed (a closed curve repeats its first point at the end: drop it)
      const closedPath = path.length > 2 && hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y) < 1e-9
      const loop = closedPath ? path.slice(0, -1) : path
      const sp = loop.map((p, i) => { const q = loop[(i + 1) % loop.length]; return hypot(q.x - p.x, q.y - p.y) })
      const peak = Math.max(...sp, 1e-12)
      let cusps = 0
      for (let i = 0; i < sp.length; i++) {
        const prev = sp[(i - 1 + sp.length) % sp.length]; const next = sp[(i + 1) % sp.length]
        if (sp[i] / peak < 0.03 && sp[i] <= prev && sp[i] < next) cusps++
      }
      out.push({ a, b, path, cusps, closed: c.range.full })
    }
  }
  return out
}

// ------------------------------------------------------------------------------ statics (virtual work)

export interface PointLoad {
  point: string
  /** N, in the drawing's x/y */
  fx: number
  fy: number
}

/**
 * The input torque (N·mm) that balances external point loads in a pose, by the principle of virtual work:
 * T·δθ + Σ F·δp = 0 with δp = (dp/dθ)·δθ. Also the force the mechanism can develop at a slider for a given input torque.
 */
export function staticInputTorque(solver: Solver, f: Frame, loads: readonly PointLoad[]): number | null {
  const V = velocities(solver.sys, f.X, f.theta, 1)
  if (!V) return null
  let w = 0
  for (const l of loads) {
    const i = solver.sys.index.get(l.point)
    if (i === undefined) continue
    w += l.fx * V[2 * i] + l.fy * V[2 * i + 1]
  }
  return -w
}

/** Torque (N·mm) over the cycle for constant loads. */
export function staticTorqueCurve(c: Cycle, loads: readonly PointLoad[]): Array<number | null> {
  return c.frames.map((f) => staticInputTorque(c.solver, f, loads))
}

/** Output value at input angle `th`, continuing from frame `k` (golden-section helper). */
function outputAtFrom(c: Cycle, k: number, th: number): number {
  const f = c.frames[k]
  const o = c.output
  if (!o) return NaN
  const r = stepTo(c.solver.sys, f.X, f.theta, th)
  if (!r.ok) return NaN
  const zero = r.X.map(() => 0)
  const ref = o.kind === 'link' ? rad(c.pos[k]) : undefined
  const d = outputDerivs(c.solver, o, r.X, zero, zero, ref)
  return o.kind === 'link' ? deg(d.pos) : d.pos
}

/** Sharpens the extremes of the output (the stroke ends) and the quick-return ratio from the sampled cycle. */
function refineStrokeEnds(c: Cycle) {
  const s = c.summary
  if (!c.output || !c.range.full || c.frames.length < 5 || !c.summary.quickReturn) return
  const refine = (idx: number, sign: 1 | -1) => {
    const n = c.frames.length
    const i = Math.max(1, Math.min(n - 2, idx))
    let a = c.frames[i - 1].theta
    let b = c.frames[i + 1].theta
    const g = (t: number) => sign * outputAtFrom(c, i, t)
    const phi = (Math.sqrt(5) - 1) / 2
    let x1 = b - phi * (b - a)
    let x2 = a + phi * (b - a)
    let f1 = g(x1)
    let f2 = g(x2)
    for (let it = 0; it < 70 && Math.abs(b - a) > 1e-12; it++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - phi * (b - a); f1 = g(x1) } else { a = x1; x1 = x2; f1 = f2; x2 = a + phi * (b - a); f2 = g(x2) }
    }
    const t = (a + b) / 2
    return { theta: t, value: sign * g(t) }
  }
  const iMin = c.theta.findIndex((t) => Math.abs(t - s.thetaAtMin) < 1e-9)
  const iMax = c.theta.findIndex((t) => Math.abs(t - s.thetaAtMax) < 1e-9)
  if (iMin < 0 || iMax < 0) return
  const lo = refine(iMin, 1)
  const hi = refine(iMax, -1)
  if (lo && hi && Number.isFinite(lo.value) && Number.isFinite(hi.value)) {
    s.outMin = Math.min(s.outMin, lo.value)
    s.outMax = Math.max(s.outMax, hi.value)
    s.span = s.outMax - s.outMin
    s.thetaAtMin = deg(lo.theta)
    s.thetaAtMax = deg(hi.theta)
    s.quickReturn = quickReturnFromAngles(lo.theta, hi.theta)
  }
}

// ------------------------------------------------------------------------------ playing back a cycle

export interface CyclePose {
  points: Map<string, Pt>
  X: number[]
  /** the input angle actually shown, radians (clamped to the range of a limited mechanism) */
  theta: number
}

/** The pose at input angle `thetaDeg` by interpolating the frames of the cycle (the whole turn repeats). */
export function cyclePose(c: Cycle, thetaDeg: number): CyclePose | null {
  if (!c.ok || c.frames.length < 2) return null
  const sys = c.solver.sys
  const t0 = c.frames[0].theta
  const tN = c.frames[c.frames.length - 1].theta
  let t = rad(thetaDeg)
  if (c.range.full) t = t0 + ((((t - t0) % TAU) + TAU) % TAU)
  else if (c.solver.sys.model.dwell) {
    const p = poseAt(c.solver, t)
    return p.ok ? { points: p.points, X: p.X, theta: t } : null
  } else t = Math.min(tN, Math.max(t0, t))
  const span = tN - t0
  const f = span > 0 ? ((t - t0) / span) * (c.frames.length - 1) : 0
  const i = Math.min(c.frames.length - 2, Math.max(0, Math.floor(f)))
  const u = f - i
  const A = c.frames[i].X; const B = c.frames[i + 1].X
  const X = A.map((v, k) => v + (B[k] - v) * u)
  return { points: pointsAt(sys, X), X, theta: t }
}

const speedCache = new WeakMap<Cycle, number>()

/** The largest point speed (mm per radian of input) over the cycle: the scale for velocity arrows. */
export function maxPointSpeed(c: Cycle): number {
  const hit = speedCache.get(c)
  if (hit !== undefined) return hit
  let m = 1e-9
  const step = Math.max(1, Math.floor(c.frames.length / 48))
  for (let i = 0; i < c.frames.length; i += step) {
    const V = velocities(c.solver.sys, c.frames[i].X, c.frames[i].theta, 1)
    if (!V) continue
    for (let k = 0; k < V.length; k += 2) m = Math.max(m, hypot(V[k], V[k + 1]))
  }
  speedCache.set(c, m)
  return m
}

/** Velocity arrows (world vectors, longest = `length` mm) for every moving point at a pose. */
export function cycleArrows(c: Cycle, pose: CyclePose, length: number): Map<string, Pt> {
  const out = new Map<string, Pt>()
  const V = velocities(c.solver.sys, pose.X, pose.theta, 1)
  if (!V) return out
  const k = length / maxPointSpeed(c)
  c.solver.sys.free.forEach((id, i) => out.set(id, { x: V[2 * i] * k, y: V[2 * i + 1] * k }))
  return out
}
