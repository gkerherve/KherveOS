// Planar linkages: the model, its loop-closure constraints and the kinematic solver (pure).
//
// A mechanism is a set of points (joints), rigid links through them, sliders (a point on a line) and one rotary
// driver. The positions are drawn once (the "design pose"); the link lengths and coupler offsets follow from it.
// Every unknown is the x/y of a free (non-ground) point. The constraints are polynomials of degree two:
//   dist2   |b − a|² = L²                           (the base of a rigid link)
//   lin     q = p0 + a·u + b·R(u)  (u = p1 − p0)    (every other point of a rigid link: 2 equations, linear)
//   line    n·(p − o) = 0                           (point on a ground line)
//   cross   (b − a) × (p − a) = 0                   (point on the line through two points: a slot in a link)
//   drive   sin φ·(bx − ax) − cos φ·(by − ay) = 0   (the driver link has angle φ, the input)
// so the Jacobian is analytic, and so are the second-order terms of the acceleration analysis. Positions are found
// by damped Newton–Raphson, followed along the input angle with continuation (predictor from the velocity solve,
// step halving) so the assembly branch is kept; a failed step means lock-up and the limit angle is bisected.

import { clamp, hypot, rad, rng, solveLinear, solveLS, symEigenvalues, TAU, type Pt } from './math.ts'

// ------------------------------------------------------------------------------ model

export interface LPoint {
  id: string
  x: number
  y: number
  /** A fixed point of the frame (ground pin). */
  ground?: boolean
  label?: string
  /** Record the path of this point (coupler curve). */
  tracer?: boolean
}

export interface LLink {
  id: string
  /** Points of the rigid body; the first two define its base (length), the others are fixed to it. */
  pts: string[]
  label?: string
  /** bar: a stick through the points; plate: a filled polygon (ternary links); star: spokes from the first point. */
  shape?: 'bar' | 'plate' | 'star'
}

export type SliderLine =
  | { kind: 'ground'; x: number; y: number; /** degrees */ angle: number }
  | { kind: 'link'; a: string; b: string }

export interface LSlider {
  id: string
  /** The point that is forced onto the line. */
  point: string
  line: SliderLine
  label?: string
  /** Mass of the block for the dynamic model, kg (default 0.05). */
  mass?: number
}

export interface LDriver {
  /** The driver link goes from `from` to `to`; its angle (direction of from → to) is the input. */
  from: string
  to: string
  rpm: number
}

export interface Material {
  /** kg/m³ */
  density: number
  /** mm: width of a bar (the dynamic model) */
  width: number
  /** mm: thickness of the plates */
  thickness: number
}

export interface Linkage {
  name: string
  /** mm */
  points: LPoint[]
  links: LLink[]
  sliders: LSlider[]
  driver: LDriver | null
  /** Valid input range (degrees, absolute driver angle) for mechanisms that only work for part of a turn (Geneva). */
  limits?: { min: number; max: number }
  /** Outside `limits` the driven parts rest at the end pose while the driver keeps turning (an indexing drive). */
  dwell?: boolean
  material?: Material
  notes?: string
}

export const DEFAULT_MATERIAL: Material = { density: 7850, width: 12, thickness: 6 }

export function emptyLinkage(name = 'Untitled'): Linkage {
  return { name, points: [], links: [], sliders: [], driver: null }
}

export const cloneLinkage = (m: Linkage): Linkage => JSON.parse(JSON.stringify(m)) as Linkage

// ------------------------------------------------------------------------------ compiled system

type Ref = { i: number; x: number; y: number }

type Con =
  | { k: 'dist2'; a: Ref; b: Ref; L2: number }
  | { k: 'lin'; comp: 0 | 1; q: Ref; p0: Ref; p1: Ref; a: number; b: number }
  | { k: 'line'; p: Ref; o: Pt; n: Pt }
  | { k: 'cross'; p: Ref; a: Ref; b: Ref }
  | { k: 'drive'; a: Ref; b: Ref }

export interface System {
  model: Linkage
  /** ids of the unknown points, in the order of the state vector (x0, y0, x1, y1, …) */
  free: string[]
  index: Map<string, number>
  /** ground positions */
  fixed: Map<string, Pt>
  cons: Con[]
  /** index of the driver constraint in `cons` (−1 when there is no driver) */
  driveIndex: number
  /** problems that stop the solver (and warnings that do not) */
  errors: string[]
  warnings: string[]
  /** a characteristic length, mm */
  scale: number
  /** the design pose as state vector and driver angle */
  X0: number[]
  theta0: number
  /** unknown coordinates minus equations without the driver (the mechanism's mobility, generic count) */
  mobility: number
}

export function pointById(m: Linkage, id: string): LPoint | undefined {
  return m.points.find((p) => p.id === id)
}

/** The design pose as a map. */
export function designPoints(m: Linkage): Map<string, Pt> {
  return new Map(m.points.map((p) => [p.id, { x: p.x, y: p.y }]))
}

export function compile(model: Linkage): System {
  const errors: string[] = []
  const warnings: string[] = []
  const byId = new Map(model.points.map((p) => [p.id, p]))
  const used = new Set<string>()
  for (const l of model.links) for (const id of l.pts) used.add(id)
  for (const s of model.sliders) {
    used.add(s.point)
    if (s.line.kind === 'link') { used.add(s.line.a); used.add(s.line.b) }
  }
  if (model.driver) { used.add(model.driver.from); used.add(model.driver.to) }

  const free: string[] = []
  const index = new Map<string, number>()
  const fixed = new Map<string, Pt>()
  for (const p of model.points) {
    if (p.ground) fixed.set(p.id, { x: p.x, y: p.y })
    else if (used.has(p.id)) { index.set(p.id, free.length); free.push(p.id) }
    else warnings.push(`Point ${p.label ?? p.id} is not attached to anything.`)
  }
  const ref = (id: string): Ref => {
    const p = byId.get(id)
    if (!p) { errors.push(`Unknown point “${id}”.`); return { i: -1, x: 0, y: 0 } }
    const i = index.get(id)
    return i === undefined ? { i: -1, x: p.x, y: p.y } : { i, x: p.x, y: p.y }
  }
  const name = (id: string) => byId.get(id)?.label ?? id

  const cons: Con[] = []
  for (const link of model.links) {
    if (link.pts.length < 2) { errors.push(`Link ${link.label ?? link.id} needs at least two points.`); continue }
    if (new Set(link.pts).size !== link.pts.length) { errors.push(`Link ${link.label ?? link.id} lists a point twice.`); continue }
    const refs = link.pts.map(ref)
    if (refs.every((r) => r.i < 0)) { errors.push(`Link ${link.label ?? link.id} lies entirely on the ground: it is part of the frame, remove it.`); continue }
    if (refs[0].i < 0 && refs[1].i < 0) {
      // two ground points as the base: the body is fixed, so all its points are fixed too (a ternary link on the frame)
      errors.push(`Link ${link.label ?? link.id}: its first two points ${name(link.pts[0])} and ${name(link.pts[1])} are both ground pins, so it cannot move. Put a moving point first.`)
      continue
    }
    const p0 = refs[0]
    const p1 = refs[1]
    const L2 = (p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2
    if (L2 < 1e-12) { errors.push(`Link ${link.label ?? link.id}: its first two points coincide.`); continue }
    cons.push({ k: 'dist2', a: p0, b: p1, L2 })
    const ux = p1.x - p0.x
    const uy = p1.y - p0.y
    for (let j = 2; j < refs.length; j++) {
      const q = refs[j]
      const dx = q.x - p0.x
      const dy = q.y - p0.y
      const a = (dx * ux + dy * uy) / L2
      const b = (ux * dy - uy * dx) / L2
      cons.push({ k: 'lin', comp: 0, q, p0, p1, a, b }, { k: 'lin', comp: 1, q, p0, p1, a, b })
    }
  }
  for (const s of model.sliders) {
    const p = ref(s.point)
    if (s.line.kind === 'ground') {
      const ang = rad(s.line.angle)
      const n = { x: -Math.sin(ang), y: Math.cos(ang) }
      cons.push({ k: 'line', p, o: { x: s.line.x, y: s.line.y }, n })
    } else {
      const a = ref(s.line.a)
      const b = ref(s.line.b)
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) errors.push(`Slider ${s.label ?? s.id}: its line has no direction.`)
      cons.push({ k: 'cross', p, a, b })
    }
  }
  let driveIndex = -1
  let theta0 = 0
  if (model.driver) {
    const a = ref(model.driver.from)
    const b = ref(model.driver.to)
    if (a.i < 0 && b.i < 0) errors.push('The driver link joins two ground pins; one end must move.')
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) errors.push('The driver link has zero length.')
    theta0 = Math.atan2(b.y - a.y, b.x - a.x)
    driveIndex = cons.length
    cons.push({ k: 'drive', a, b })
  }
  const X0 = new Array<number>(free.length * 2)
  free.forEach((id, i) => { const p = byId.get(id)!; X0[2 * i] = p.x; X0[2 * i + 1] = p.y })
  let scale = 1
  for (const l of model.links) for (let i = 1; i < l.pts.length; i++) {
    const a = byId.get(l.pts[0]); const b = byId.get(l.pts[i])
    if (a && b) scale = Math.max(scale, Math.hypot(b.x - a.x, b.y - a.y))
  }
  if (model.points.length) {
    const xs = model.points.map((p) => p.x); const ys = model.points.map((p) => p.y)
    scale = Math.max(scale, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  }
  const nEq = cons.length - (driveIndex >= 0 ? 1 : 0)
  return { model, free, index, fixed, cons, driveIndex, errors, warnings, scale, X0, theta0, mobility: free.length * 2 - nEq }
}

// ------------------------------------------------------------------------------ constraint evaluation

type Entry = [col: number, val: number]

const px = (r: Ref, X: ArrayLike<number>) => (r.i >= 0 ? X[2 * r.i] : r.x)
const py = (r: Ref, X: ArrayLike<number>) => (r.i >= 0 ? X[2 * r.i + 1] : r.y)
const vx = (r: Ref, V: ArrayLike<number>) => (r.i >= 0 ? V[2 * r.i] : 0)
const vy = (r: Ref, V: ArrayLike<number>) => (r.i >= 0 ? V[2 * r.i + 1] : 0)

function addX(d: Entry[], r: Ref, val: number) { if (r.i >= 0) d.push([2 * r.i, val]) }
function addY(d: Entry[], r: Ref, val: number) { if (r.i >= 0) d.push([2 * r.i + 1, val]) }

/** Value of a constraint, its non-zero partials ∂/∂x, and ∂/∂θ. */
function evalCon(c: Con, X: ArrayLike<number>, th: number, d: Entry[]): { f: number; ft: number } {
  switch (c.k) {
    case 'dist2': {
      const dx = px(c.b, X) - px(c.a, X)
      const dy = py(c.b, X) - py(c.a, X)
      addX(d, c.b, 2 * dx); addY(d, c.b, 2 * dy); addX(d, c.a, -2 * dx); addY(d, c.a, -2 * dy)
      return { f: dx * dx + dy * dy - c.L2, ft: 0 }
    }
    case 'lin': {
      const { q, p0, p1, a, b } = c
      if (c.comp === 0) {
        addX(d, q, 1); addX(d, p0, a - 1); addX(d, p1, -a); addY(d, p1, b); addY(d, p0, -b)
        return { f: px(q, X) - px(p0, X) - a * (px(p1, X) - px(p0, X)) + b * (py(p1, X) - py(p0, X)), ft: 0 }
      }
      addY(d, q, 1); addY(d, p0, a - 1); addY(d, p1, -a); addX(d, p1, -b); addX(d, p0, b)
      return { f: py(q, X) - py(p0, X) - a * (py(p1, X) - py(p0, X)) - b * (px(p1, X) - px(p0, X)), ft: 0 }
    }
    case 'line': {
      addX(d, c.p, c.n.x); addY(d, c.p, c.n.y)
      return { f: c.n.x * (px(c.p, X) - c.o.x) + c.n.y * (py(c.p, X) - c.o.y), ft: 0 }
    }
    case 'cross': {
      const { p, a, b } = c
      const ex = px(b, X) - px(a, X); const ey = py(b, X) - py(a, X)
      const fx = px(p, X) - px(a, X); const fy = py(p, X) - py(a, X)
      addX(d, b, fy); addY(d, b, -fx)
      addX(d, p, -ey); addY(d, p, ex)
      addX(d, a, -fy + ey); addY(d, a, -ex + fx)
      return { f: ex * fy - ey * fx, ft: 0 }
    }
    case 'drive': {
      const s = Math.sin(th); const co = Math.cos(th)
      const dx = px(c.b, X) - px(c.a, X); const dy = py(c.b, X) - py(c.a, X)
      addX(d, c.b, s); addY(d, c.b, -co); addX(d, c.a, -s); addY(d, c.a, co)
      return { f: s * dx - co * dy, ft: co * dx + s * dy }
    }
  }
}

/** The second-order term of a constraint: ẋᵀ C_xx ẋ + 2 C_xθ ẋ θ̇ + C_θθ θ̇². */
function bracket(c: Con, X: ArrayLike<number>, V: ArrayLike<number>, th: number, om: number): number {
  switch (c.k) {
    case 'dist2': {
      const dvx = vx(c.b, V) - vx(c.a, V); const dvy = vy(c.b, V) - vy(c.a, V)
      return 2 * (dvx * dvx + dvy * dvy)
    }
    case 'cross': {
      const { p, a, b } = c
      const ex = vx(b, V) - vx(a, V); const ey = vy(b, V) - vy(a, V)
      const fx = vx(p, V) - vx(a, V); const fy = vy(p, V) - vy(a, V)
      return 2 * (ex * fy - ey * fx)
    }
    case 'drive': {
      const s = Math.sin(th); const co = Math.cos(th)
      const dx = px(c.b, X) - px(c.a, X); const dy = py(c.b, X) - py(c.a, X)
      const dvx = vx(c.b, V) - vx(c.a, V); const dvy = vy(c.b, V) - vy(c.a, V)
      return om * om * (-s * dx + co * dy) + 2 * om * (co * dvx + s * dvy)
    }
    default:
      return 0
  }
}

/** Residuals and the dense Jacobian (rows scaled to unit length so the residual is a length). */
function system(sys: System, X: ArrayLike<number>, th: number): { F: number[]; J: number[][]; Ft: number[] } {
  const n = sys.free.length * 2
  const F: number[] = []
  const J: number[][] = []
  const Ft: number[] = []
  const d: Entry[] = []
  for (const c of sys.cons) {
    d.length = 0
    const { f, ft } = evalCon(c, X, th, d)
    const row = new Array<number>(n).fill(0)
    let norm = 0
    for (const [col, val] of d) row[col] += val
    for (const v of row) norm += v * v
    // the scale of the row: its gradient, or (for rows that vanish at a singular pose) the unscaled value
    const s = norm > 1e-18 ? 1 / Math.sqrt(norm) : 1
    for (let i = 0; i < n; i++) row[i] *= s
    F.push(f * s)
    J.push(row)
    Ft.push(ft * s)
  }
  return { F, J, Ft }
}

const maxAbs = (v: ArrayLike<number>) => { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m }
const norm2 = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) }

// ------------------------------------------------------------------------------ positions

export interface NewtonResult { X: number[]; ok: boolean; iters: number; res: number }

/** Residual size of a pose (a length in mm). */
export function residual(sys: System, X: ArrayLike<number>, th: number): number {
  return maxAbs(system(sys, X, th).F)
}

/** Solves the loop-closure equations at input angle `th` starting from `X0` (damped Newton–Raphson). */
export function newton(sys: System, X0: ArrayLike<number>, th: number, maxIter = 60): NewtonResult {
  const n = sys.free.length * 2
  let X = Array.from(X0)
  if (n === 0) return { X, ok: true, iters: 0, res: 0 }
  const tol = 4e-15 * Math.max(1, sys.scale)
  let { F, J } = system(sys, X, th)
  let res = norm2(F)
  let lambda = 0
  let it = 0
  for (; it < maxIter; it++) {
    if (maxAbs(F) < tol) break
    let dx: number[] | null = null
    if (J.length === n && lambda === 0) dx = solveLinear(J, F.map((v) => -v))
    if (!dx) dx = solveLS(J, F.map((v) => -v), lambda || 1e-10)
    if (!dx || !dx.every(Number.isFinite)) { lambda = Math.max(lambda * 10, 1e-6); if (lambda > 1e3) break; continue }
    // cap the step to a fraction of the mechanism size (keeps Newton from jumping branches)
    const big = maxAbs(dx)
    const cap = 0.5 * sys.scale
    if (big > cap) for (let i = 0; i < n; i++) dx[i] *= cap / big
    let alpha = 1
    let accepted = false
    for (let k = 0; k < 14; k++) {
      const Xn = X.map((v, i) => v + alpha * dx![i])
      const s = system(sys, Xn, th)
      const r = norm2(s.F)
      if (r < res * (1 - 1e-4 * alpha) || r < tol * 1e-3) { X = Xn; F = s.F; J = s.J; res = r; accepted = true; break }
      alpha *= 0.5
    }
    if (!accepted) {
      // no further progress: fine when we are already at the floor of double precision
      if (maxAbs(F) < 1e-10 * Math.max(1, sys.scale)) break
      lambda = Math.max(lambda * 10, 1e-8)
      if (lambda > 1e3) break
    } else lambda = lambda > 0 ? lambda / 10 : 0
  }
  const fin = maxAbs(F)
  return { X, ok: fin < 1e-8 * Math.max(1, sys.scale) && X.every(Number.isFinite), iters: it, res: fin }
}

// ------------------------------------------------------------------------------ velocity, acceleration

/** dX/dθ·ω: the velocities of all free points for input speed `om` (rad/s). Null at a singular pose. */
export function velocities(sys: System, X: ArrayLike<number>, th: number, om = 1): number[] | null {
  const n = sys.free.length * 2
  if (n === 0) return []
  const { J, Ft } = system(sys, X, th)
  const rhs = Ft.map((v) => -v * om)
  const v = J.length === n ? solveLinear(J, rhs) : solveLS(J, rhs, 1e-14)
  return v && v.every(Number.isFinite) ? v : null
}

/** Accelerations for input speed `om` and input acceleration `alpha`. */
export function accelerations(sys: System, X: ArrayLike<number>, V: ArrayLike<number>, th: number, om = 1, alpha = 0): number[] | null {
  const n = sys.free.length * 2
  if (n === 0) return []
  const { J, Ft } = system(sys, X, th)
  // the rows of J and Ft are scaled; scale the bracket the same way
  const d: Entry[] = []
  const rhs = sys.cons.map((c, r) => {
    d.length = 0
    evalCon(c, X, th, d)
    const row = new Array<number>(n).fill(0)
    for (const [col, val] of d) row[col] += val
    const nr = norm2(row)
    const s = nr * nr > 1e-18 ? 1 / nr : 1
    return -(bracket(c, X, V, th, om) * s + Ft[r] * alpha)
  })
  const a = J.length === n ? solveLinear(J, rhs) : solveLS(J, rhs, 1e-14)
  return a && a.every(Number.isFinite) ? a : null
}

/**
 * How close the loop-closure Jacobian is to losing rank: the ratio of its smallest to largest singular value
 * (rows scaled), and the number of near-zero singular values.
 */
export function singularity(sys: System, X: ArrayLike<number>, th: number): { ratio: number; nullity: number } {
  const n = sys.free.length * 2
  if (n === 0) return { ratio: 1, nullity: 0 }
  const { J } = system(sys, X, th)
  const G: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const row of J) for (let a = 0; a < n; a++) { if (row[a] === 0) continue; for (let b = a; b < n; b++) G[a][b] += row[a] * row[b] }
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) G[a][b] = G[b][a]
  const ev = symEigenvalues(G)
  const top = Math.max(ev[ev.length - 1], 1e-300)
  const nullity = ev.filter((e) => e < 1e-12 * top).length
  return { ratio: Math.sqrt(Math.max(ev[0], 0) / top), nullity }
}

// ------------------------------------------------------------------------------ continuation

export interface StepResult { X: number[]; ok: boolean; reached: number }

/** Moves from `th0` to `th1` keeping the branch: halves the step when Newton fails or the pose jumps. */
export function stepTo(sys: System, X: number[], th0: number, th1: number, depth = 0): StepResult {
  const h = th1 - th0
  const V = velocities(sys, X, th0, 1)
  const pred = V ? X.map((v, i) => v + V[i] * h) : X
  const r = newton(sys, pred, th1)
  if (r.ok) {
    const jump = maxAbs(r.X.map((v, i) => v - X[i]))
    const expect = V ? maxAbs(V) * Math.abs(h) : 0.2 * sys.scale
    const allowed = V ? 3 * expect + 1e-6 * sys.scale : 0.2 * sys.scale
    if (jump <= allowed) return { X: r.X, ok: true, reached: th1 }
  }
  if (depth >= 14) return { X, ok: false, reached: th0 }
  const mid = th0 + h / 2
  const a = stepTo(sys, X, th0, mid, depth + 1)
  if (!a.ok) return { X: a.X, ok: false, reached: a.reached }
  const b = stepTo(sys, a.X, mid, th1, depth + 1)
  return b
}

export interface Frame {
  theta: number
  X: number[]
  ok: boolean
}

/** The poses for `thetas` (in order); after a failure the remaining frames are marked not ok. */
export function trace(sys: System, X0: number[], thetas: readonly number[]): Frame[] {
  const out: Frame[] = []
  let X = X0
  let prev = thetas[0]
  let alive = true
  for (let k = 0; k < thetas.length; k++) {
    const th = thetas[k]
    if (alive) {
      const r = k === 0 ? (() => { const n = newton(sys, X, th); return { X: n.X, ok: n.ok, reached: th } })() : stepTo(sys, X, prev, th)
      if (r.ok) { X = r.X; prev = th } else alive = false
    }
    out.push({ theta: th, X: alive ? X : X, ok: alive })
  }
  return out
}

export interface InputRange {
  /** The driver can turn all the way round. */
  full: boolean
  /** Reachable angles (radians, absolute), min ≤ θ0 ≤ max; for a full turn θ0 − π … θ0 + π. */
  min: number
  max: number
}

/** Follows the mechanism from the design pose in both directions up to a full turn; finds the lock-up angles. */
export function inputRange(sys: System, X0: number[], th0: number): InputRange {
  const walk = (dir: 1 | -1): { limit: number; blocked: boolean } => {
    const steps = 360
    let X = X0
    let th = th0
    const dth = (dir * TAU) / steps
    for (let k = 0; k < steps; k++) {
      const next = th + dth
      const r = stepTo(sys, X, th, next)
      if (r.ok) { X = r.X; th = next; continue }
      // bisect the boundary between the last good angle and the failing one
      let lo = th
      let hi = next
      let Xlo = X
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        const t = stepTo(sys, Xlo, lo, mid)
        if (t.ok) { lo = mid; Xlo = t.X } else hi = mid
        if (Math.abs(hi - lo) < 1e-11) break
      }
      return { limit: lo, blocked: true }
    }
    return { limit: th0 + dir * TAU, blocked: false }
  }
  const up = walk(1)
  const down = walk(-1)
  if (!up.blocked && !down.blocked) return { full: true, min: th0 - Math.PI, max: th0 + Math.PI }
  return { full: false, min: down.limit, max: up.limit }
}

/** Different closures of the same loops at input angle `th` (the assembly configurations), nearest to X first. */
export function findAssemblies(sys: System, X: number[], th: number, attempts = 80): number[][] {
  const found: number[][] = []
  const tolD = 1e-6 * Math.max(1, sys.scale)
  const add = (x: number[]) => { if (!found.some((f) => maxAbs(f.map((v, i) => v - x[i])) < tolD)) found.push(x) }
  // the drive row only fixes the driver's angle modulo π: keep the closures where the driver points the right way
  const drive = sys.driveIndex >= 0 ? (sys.cons[sys.driveIndex] as Extract<Con, { k: 'drive' }>) : null
  const forward = (x: number[]) => !drive || (px(drive.b, x) - px(drive.a, x)) * Math.cos(th) + (py(drive.b, x) - py(drive.a, x)) * Math.sin(th) > 0
  const home = newton(sys, X, th)
  if (home.ok && forward(home.X)) add(home.X)
  // the mirror image about the line through the first two ground pins
  const g = [...sys.fixed.values()]
  if (g.length >= 2) {
    const a = g[0]; const b = g[g.length - 1]
    const dx = b.x - a.x; const dy = b.y - a.y; const L2 = dx * dx + dy * dy
    if (L2 > 1e-12) {
      const refl = X.map((v, i) => {
        const x = i % 2 === 0 ? v : X[i - 1]; const y = i % 2 === 0 ? X[i + 1] : v
        const t = ((x - a.x) * dx + (y - a.y) * dy) / L2
        const fx = a.x + t * dx; const fy = a.y + t * dy
        return i % 2 === 0 ? 2 * fx - x : 2 * fy - y
      })
      const r = newton(sys, refl, th)
      if (r.ok && forward(r.X)) add(r.X)
    }
  }
  const rand = rng(7)
  for (let k = 0; k < attempts; k++) {
    const amp = (0.3 + 1.2 * rand()) * sys.scale
    const seed = X.map((v) => v + (rand() - 0.5) * amp)
    const r = newton(sys, seed, th, 80)
    if (r.ok && forward(r.X)) add(r.X)
  }
  const dist = (x: number[]) => maxAbs(x.map((v, i) => v - X[i]))
  return found.sort((a, b) => dist(a) - dist(b))
}

/** The next assembly configuration (the one closest to a different shape), or null when there is only one. */
export function flipAssembly(sys: System, X: number[], th: number): number[] | null {
  const all = findAssemblies(sys, X, th)
  if (all.length < 2) return null
  // the first element is the current closure; the most different one is the branch the mechanism cannot reach by continuation
  return all[1]
}

// ------------------------------------------------------------------------------ poses and queries

/** Positions of all points for a state vector. */
export function pointsAt(sys: System, X: ArrayLike<number>): Map<string, Pt> {
  const out = new Map<string, Pt>()
  for (const [id, p] of sys.fixed) out.set(id, p)
  sys.free.forEach((id, i) => out.set(id, { x: X[2 * i], y: X[2 * i + 1] }))
  return out
}

/** Velocity vectors (mm per rad of input times ω) for all points; ground points are zero. */
export function velocityMap(sys: System, V: ArrayLike<number>): Map<string, Pt> {
  const out = new Map<string, Pt>()
  for (const id of sys.fixed.keys()) out.set(id, { x: 0, y: 0 })
  sys.free.forEach((id, i) => out.set(id, { x: V[2 * i], y: V[2 * i + 1] }))
  return out
}

/** Absolute angle of the vector from point `a` to `b`. */
export function angleBetween(pts: ReadonlyMap<string, Pt>, a: string, b: string): number {
  const p = pts.get(a); const q = pts.get(b)
  return p && q ? Math.atan2(q.y - p.y, q.x - p.x) : 0
}

/** The solver context for a model: compile and the design pose, ready to trace. */
export interface Solver {
  sys: System
  X0: number[]
  theta0: number
  /** pose solved at theta0 (the drawn pose may be a hair off) */
  ok: boolean
}

export function makeSolver(model: Linkage): Solver {
  const sys = compile(model)
  if (sys.errors.length) return { sys, X0: sys.X0, theta0: sys.theta0, ok: false }
  const r = newton(sys, sys.X0, sys.theta0)
  // a pose that was drawn a little out of true: Newton pulls it in; far off means the drawing cannot be assembled
  const moved = maxAbs(r.X.map((v, i) => v - sys.X0[i]))
  return { sys, X0: r.ok ? r.X : sys.X0, theta0: sys.theta0, ok: r.ok && moved < 0.25 * sys.scale }
}

export interface Pose {
  points: Map<string, Pt>
  ok: boolean
  X: number[]
}

/**
 * The pose at absolute input angle `th`: continuation from the design pose by the shortest way (so the same
 * branch as the drawing). With `dwell`, outside the valid range the driven parts rest at the nearest end pose.
 */
export function poseAt(s: Solver, th: number, range?: InputRange): Pose {
  const { sys } = s
  if (sys.errors.length) return { points: designPoints(sys.model), ok: false, X: sys.X0 }
  const lim = sys.model.limits
  let target = th
  let dwelling = false
  if (lim && sys.model.dwell) {
    const lo = rad(lim.min); const hi = rad(lim.max)
    let t = th
    // bring th into [lo, lo + 2π)
    t = lo + (((t - lo) % TAU) + TAU) % TAU
    if (t > hi) { dwelling = true; target = Math.abs(t - hi) < Math.abs(lo + TAU - t) ? hi : lo }
    else target = t
  }
  void range
  const steps = Math.max(1, Math.ceil(Math.abs(target - s.theta0) / 0.05))
  let X = s.X0
  let prev = s.theta0
  let ok = true
  for (let k = 1; k <= steps; k++) {
    const t = s.theta0 + ((target - s.theta0) * k) / steps
    const r = stepTo(sys, X, prev, t)
    if (!r.ok) { ok = false; break }
    X = r.X; prev = t
  }
  const points = pointsAt(sys, X)
  if (dwelling && sys.model.driver) {
    // the driver link turns on; the rest stays
    const d = sys.model.driver
    const a = points.get(d.from)!; const b = points.get(d.to)!
    const L = hypot(b.x - a.x, b.y - a.y)
    points.set(d.to, { x: a.x + L * Math.cos(th), y: a.y + L * Math.sin(th) })
  }
  return { points, ok, X }
}

/** Wrap an angle so that it is the representative nearest to `ref` (radians). */
export function nearestAngle(a: number, ref: number): number {
  return a - Math.round((a - ref) / TAU) * TAU
}

export function clampRange(v: number, r: InputRange): number {
  return r.full ? v : clamp(v, r.min, r.max)
}
