// Cams (pure): follower motion programs (dwell / rise / return segments with standard laws), cam profile
// generation for knife-edge, roller and flat-face followers (translating, offset, or swing-arm), pressure angle
// and radius-of-curvature checks, base-circle optimisation.
//
// Conventions: θ is the cam rotation (degrees in the interface, radians inside). The cam turns counter-clockwise
// (clockwise is the mirror image). The drawing is y-up. The follower lift s is in mm (swing-arm: degrees of arm
// rotation); v = ds/dθ in mm/rad, a = d²s/dθ² and j = d³s/dθ³. For a cam turning at ω rad/s the follower's
// velocity is v·ω, its acceleration a·ω² and its jerk j·ω³.

import { deg, hypot, rad, TAU, type Pt } from './math.ts'

// ------------------------------------------------------------------------------ motion laws

export type LawId = 'uniform' | 'harmonic' | 'cycloidal' | 'trapezoid' | 'poly345' | 'poly4567'

export const LAWS: Array<{ id: LawId; name: string; note: string }> = [
  { id: 'uniform', name: 'Uniform (constant velocity)', note: 'Infinite acceleration at the ends: only for slow cams.' },
  { id: 'harmonic', name: 'Simple harmonic', note: 'Finite acceleration, but it jumps at the ends of a rise.' },
  { id: 'cycloidal', name: 'Cycloidal', note: 'Zero velocity and acceleration at the ends; smooth, higher peak acceleration.' },
  { id: 'trapezoid', name: 'Modified trapezoid', note: 'Lowest peak acceleration with a continuous acceleration curve.' },
  { id: 'poly345', name: 'Polynomial 3-4-5', note: 's = 10u³ − 15u⁴ + 6u⁵; zero velocity and acceleration at both ends.' },
  { id: 'poly4567', name: 'Polynomial 4-5-6-7', note: 'Also zero jerk at both ends; for high speeds.' },
]

export interface LawVals {
  s: number
  /** ds/du */
  v: number
  a: number
  j: number
}

// modified trapezoid, first half (the second is its mirror image), with unit peak acceleration
const MT_W = 1 / 8
function mtHalf(u: number): { s: number; v: number; a: number; j: number } {
  const w = MT_W
  const k = 4 * Math.PI
  // segment 1: a = sin(4πu)
  const v1 = (1 - Math.cos(k * w)) / k
  const s1 = w / k - Math.sin(k * w) / (k * k)
  if (u <= w) return { a: Math.sin(k * u), v: (1 - Math.cos(k * u)) / k, s: u / k - Math.sin(k * u) / (k * k), j: k * Math.cos(k * u) }
  // segment 2: a = 1 up to 3w
  if (u <= 3 * w) {
    const t = u - w
    return { a: 1, v: v1 + t, s: s1 + v1 * t + (t * t) / 2, j: 0 }
  }
  // segment 3: a = cos(4π(u − 3w)) down to 0 at 4w
  const v2 = v1 + 2 * w
  const s2 = s1 + v1 * 2 * w + (2 * w) ** 2 / 2
  const t = u - 3 * w
  return { a: Math.cos(k * t), v: v2 + Math.sin(k * t) / k, s: s2 + v2 * t + (1 - Math.cos(k * t)) / (k * k), j: -k * Math.sin(k * t) }
}
const MT_PEAK = (() => {
  // the area condition s(1/2) = 1/2 fixes the peak acceleration
  const h = mtHalf(0.5)
  return 0.5 / h.s
})()

/** The normalised law on u ∈ [0, 1]: s from 0 to 1 and its derivatives with respect to u. */
export function lawEval(law: LawId, u0: number): LawVals {
  const u = Math.min(1, Math.max(0, u0))
  switch (law) {
    case 'uniform':
      return { s: u, v: 1, a: 0, j: 0 }
    case 'harmonic':
      return { s: (1 - Math.cos(Math.PI * u)) / 2, v: (Math.PI / 2) * Math.sin(Math.PI * u), a: (Math.PI ** 2 / 2) * Math.cos(Math.PI * u), j: -(Math.PI ** 3 / 2) * Math.sin(Math.PI * u) }
    case 'cycloidal':
      return { s: u - Math.sin(TAU * u) / TAU, v: 1 - Math.cos(TAU * u), a: TAU * Math.sin(TAU * u), j: TAU * TAU * Math.cos(TAU * u) }
    case 'poly345':
      return {
        s: 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5, v: 30 * u ** 2 - 60 * u ** 3 + 30 * u ** 4, a: 60 * u - 180 * u ** 2 + 120 * u ** 3, j: 60 - 360 * u + 360 * u ** 2,
      }
    case 'poly4567':
      return {
        s: 35 * u ** 4 - 84 * u ** 5 + 70 * u ** 6 - 20 * u ** 7, v: 140 * u ** 3 - 420 * u ** 4 + 420 * u ** 5 - 140 * u ** 6,
        a: 420 * u ** 2 - 1680 * u ** 3 + 2100 * u ** 4 - 840 * u ** 5, j: 840 * u - 5040 * u ** 2 + 8400 * u ** 3 - 4200 * u ** 4,
      }
    case 'trapezoid': {
      if (u <= 0.5) {
        const h = mtHalf(u)
        return { s: h.s * MT_PEAK, v: h.v * MT_PEAK, a: h.a * MT_PEAK, j: h.j * MT_PEAK }
      }
      const h = mtHalf(1 - u)
      return { s: 1 - h.s * MT_PEAK, v: h.v * MT_PEAK, a: -h.a * MT_PEAK, j: h.j * MT_PEAK }
    }
  }
}

/** Peak values of a law's normalised velocity, acceleration and jerk (|·| maximum on a fine grid). */
export function lawPeaks(law: LawId): { v: number; a: number; j: number } {
  let v = 0; let a = 0; let j = 0
  for (let i = 0; i <= 2000; i++) {
    const l = lawEval(law, i / 2000)
    v = Math.max(v, Math.abs(l.v)); a = Math.max(a, Math.abs(l.a)); j = Math.max(j, Math.abs(l.j))
  }
  return { v, a, j }
}

// ------------------------------------------------------------------------------ programs

export interface CamSegment {
  kind: 'dwell' | 'rise' | 'return'
  /** angle of the segment, degrees */
  beta: number
  /** mm (or degrees for a swing-arm follower); how much it rises or falls. Ignored for a dwell. */
  lift: number
  law: LawId
}

export interface MotionProgram {
  segments: CamSegment[]
}

export interface MotionSample {
  /** degrees */
  theta: number
  s: number
  v: number
  a: number
  j: number
  segment: number
}

/** Lift level at the start of each segment, and the total angle. */
export function programLevels(p: MotionProgram): { start: number[]; total: number; end: number } {
  let lvl = 0
  let total = 0
  const start: number[] = []
  for (const s of p.segments) {
    start.push(lvl)
    total += s.beta
    if (s.kind === 'rise') lvl += s.lift
    else if (s.kind === 'return') lvl -= s.lift
  }
  return { start, total, end: lvl }
}

/** Problems with a program: the angles must add up to 360° and the follower must end where it started. */
export function checkProgram(p: MotionProgram): string[] {
  const out: string[] = []
  if (p.segments.length === 0) return ['Add at least one segment.']
  const { total, end, start } = programLevels(p)
  if (Math.abs(total - 360) > 1e-6) out.push(`The segment angles add up to ${Number(total.toFixed(4))}°, not 360°.`)
  if (Math.abs(end) > 1e-6) out.push('The follower does not end where it started: the returns must add up to the rises.')
  p.segments.forEach((s, i) => {
    if (!(s.beta > 0)) out.push(`Segment ${i + 1} needs an angle above 0°.`)
    if (s.kind !== 'dwell' && !(s.lift > 0)) out.push(`Segment ${i + 1} needs a lift above 0.`)
    if (start[i] < -1e-9 || (s.kind === 'return' && start[i] - s.lift < -1e-6)) out.push(`Segment ${i + 1} returns below the base position.`)
  })
  return out
}

/** The follower motion at cam angle θ (degrees; any value, wrapped into 0…360). */
export function programEval(p: MotionProgram, thetaDeg: number): MotionSample {
  const { start, total } = programLevels(p)
  const t = total > 0 ? ((thetaDeg % total) + total) % total : 0
  let a0 = 0
  for (let i = 0; i < p.segments.length; i++) {
    const seg = p.segments[i]
    const a1 = a0 + seg.beta
    if (t < a1 || i === p.segments.length - 1) {
      const beta = rad(seg.beta)
      const u = Math.min(1, Math.max(0, (t - a0) / seg.beta))
      if (seg.kind === 'dwell') return { theta: t, s: start[i], v: 0, a: 0, j: 0, segment: i }
      const l = lawEval(seg.law, u)
      const sign = seg.kind === 'rise' ? 1 : -1
      return {
        theta: t, s: start[i] + sign * seg.lift * l.s, v: (sign * seg.lift * l.v) / beta, a: (sign * seg.lift * l.a) / beta ** 2, j: (sign * seg.lift * l.j) / beta ** 3, segment: i,
      }
    }
    a0 = a1
  }
  return { theta: t, s: 0, v: 0, a: 0, j: 0, segment: 0 }
}

export interface ProgramTable {
  theta: number[]
  s: number[]
  v: number[]
  a: number[]
  j: number[]
  peakS: number
  peakV: number
  peakA: number
  peakJ: number
}

/** Samples over 0…360° (n + 1 points). */
export function programTable(p: MotionProgram, n = 720): ProgramTable {
  const total = programLevels(p).total || 360
  const out: ProgramTable = { theta: [], s: [], v: [], a: [], j: [], peakS: 0, peakV: 0, peakA: 0, peakJ: 0 }
  for (let i = 0; i <= n; i++) {
    // the last sample belongs to the end of the final segment
    const th = (total * i) / n
    const m = i === n ? programEval(p, total - 1e-9) : programEval(p, th)
    out.theta.push(th); out.s.push(m.s); out.v.push(m.v); out.a.push(m.a); out.j.push(m.j)
  }
  out.peakS = Math.max(...out.s)
  out.peakV = Math.max(...out.v.map(Math.abs))
  out.peakA = Math.max(...out.a.map(Math.abs))
  out.peakJ = Math.max(...out.j.map(Math.abs))
  return out
}

/** A common rise-dwell-return-dwell program. */
export function riseDwellReturn(lift: number, rise: number, dwellHi: number, ret: number, law: LawId = 'cycloidal', returnLaw: LawId = law): MotionProgram {
  const lo = 360 - rise - dwellHi - ret
  return {
    segments: [
      { kind: 'rise', beta: rise, lift, law },
      ...(dwellHi > 0 ? [{ kind: 'dwell' as const, beta: dwellHi, lift: 0, law }] : []),
      { kind: 'return', beta: ret, lift, law: returnLaw },
      ...(lo > 1e-9 ? [{ kind: 'dwell' as const, beta: lo, lift: 0, law }] : []),
    ],
  }
}

// ------------------------------------------------------------------------------ cam profile

export type FollowerKind = 'knife' | 'roller' | 'flat'
export type FollowerMotion = 'translating' | 'swing'

export interface CamSpec {
  program: MotionProgram
  follower: FollowerKind
  motion: FollowerMotion
  /** base circle radius, mm (smallest radius of the cam) */
  baseRadius: number
  /** roller radius, mm (roller followers) */
  rollerRadius: number
  /** offset of the follower axis from the cam centre, mm (translating knife/roller; positive = to the right) */
  offset: number
  /** swing arm: distance from the cam centre to the arm pivot, mm */
  pivotDistance: number
  /** swing arm: length of the arm, mm (the program's lift is then in degrees of arm rotation) */
  armLength: number
  direction: 'ccw' | 'cw'
  /** bore diameter for the export, mm */
  bore: number
  /** limit for the pressure angle, degrees (30 translating, 45 swing arms are the usual) */
  maxPressure: number
}

export const DEFAULT_CAM: CamSpec = {
  program: riseDwellReturn(20, 120, 40, 120, 'cycloidal'),
  follower: 'roller', motion: 'translating', baseRadius: 30, rollerRadius: 8, offset: 0, pivotDistance: 90, armLength: 70, direction: 'ccw', bore: 10, maxPressure: 30,
}

export interface CamWarning {
  level: 'error' | 'warning'
  code: 'pressure' | 'undercut' | 'curvature' | 'face' | 'program' | 'geometry'
  message: string
  /** cam angle, degrees */
  at?: number
}

export interface CamProfile {
  /** cam angles of the samples, degrees */
  theta: number[]
  /** follower lift (mm or degrees) */
  s: number[]
  /** the pitch curve: locus of the follower reference point in the cam's frame */
  pitch: Pt[]
  /** the cam outline */
  profile: Pt[]
  /** pressure angle, degrees (signed) */
  phi: number[]
  /** radius of curvature of the pitch curve (convex positive); for a flat-face follower the cam's radius of curvature */
  rho: number[]
  /** the follower reference point (roller centre) in the fixed frame, for the animation */
  follower: Pt[]
  stats: {
    maxPressure: number
    maxPressureAt: number
    minRho: number
    minRhoAt: number
    /** largest radius of the profile */
    outerRadius: number
    /** half-width a flat face needs to keep contact, mm */
    faceHalfWidth: number
    /** the prime circle radius */
    primeRadius: number
  }
  warnings: CamWarning[]
}

const Rot = (a: number, v: Pt): Pt => ({ x: Math.cos(a) * v.x + Math.sin(a) * v.y, y: -Math.sin(a) * v.x + Math.cos(a) * v.y }) // R(−a) v

/** Cam profile and checks at n angles (default 720 = every half degree). */
export function camProfile(spec: CamSpec, n = 720): CamProfile {
  const warnings: CamWarning[] = []
  for (const p of checkProgram(spec.program)) warnings.push({ level: 'error', code: 'program', message: p })
  const Rb = spec.baseRadius
  const Rr = spec.follower === 'roller' ? spec.rollerRadius : 0
  const Rp = Rb + Rr
  const e = spec.motion === 'translating' && spec.follower !== 'flat' ? spec.offset : 0
  if (!(Rb > 0)) warnings.push({ level: 'error', code: 'geometry', message: 'The base circle radius must be positive.' })
  if (spec.motion === 'translating' && Math.abs(e) >= Rp) warnings.push({ level: 'error', code: 'geometry', message: 'The offset must be smaller than the prime circle radius.' })
  const s0 = Math.sqrt(Math.max(0, Rp * Rp - e * e))
  const swing = spec.motion === 'swing' && spec.follower !== 'flat'
  const D = spec.pivotDistance; const La = spec.armLength
  let gamma0 = 0
  if (swing) {
    const c = (Rp * Rp - D * D - La * La) / (2 * D * La)
    if (!(Math.abs(c) <= 1)) { warnings.push({ level: 'error', code: 'geometry', message: 'The arm cannot reach the prime circle: change the arm length or the pivot distance.' }); gamma0 = c > 1 ? 0 : Math.PI } else gamma0 = Math.acos(c)
  }
  const total = programLevels(spec.program).total || 360
  const out: CamProfile = {
    theta: [], s: [], pitch: [], profile: [], phi: [], rho: [], follower: [],
    stats: { maxPressure: 0, maxPressureAt: 0, minRho: Infinity, minRhoAt: 0, outerRadius: 0, faceHalfWidth: 0, primeRadius: Rp }, warnings,
  }
  let maxP = 0; let maxPAt = 0; let minRho = Infinity; let minRhoAt = 0; let outer = 0; let face = 0
  const mirror = spec.direction === 'cw' ? -1 : 1
  for (let i = 0; i <= n; i++) {
    const thDeg = (total * i) / n
    const m = i === n ? programEval(spec.program, total - 1e-9) : programEval(spec.program, thDeg)
    const th = rad(thDeg)
    let pitch: Pt; let P1: Pt; let P2: Pt; let fol: Pt
    let dirF: Pt
    if (spec.follower === 'flat') {
      // contact point: R(−θ)(s', Rb + s); the follower face stays horizontal
      const y = Rb + m.s
      const q = { x: m.v, y }; const q1 = { x: m.a, y: m.v }; const q2 = { x: m.j, y: m.a }
      pitch = Rot(th, q)
      P1 = Rot(th, { x: q1.x + q.y, y: q1.y - q.x })
      P2 = Rot(th, { x: q2.x + 2 * q1.y - q.x, y: q2.y - 2 * q1.x - q.y })
      fol = { x: 0, y }
      dirF = { x: 0, y: 1 }
      face = Math.max(face, Math.abs(m.v))
    } else if (!swing) {
      const y = s0 + m.s
      const q = { x: e, y }; const q1 = { x: 0, y: m.v }; const q2 = { x: 0, y: m.a }
      pitch = Rot(th, q)
      P1 = Rot(th, { x: q1.x + q.y, y: q1.y - q.x })
      P2 = Rot(th, { x: q2.x + 2 * q1.y - q.x, y: q2.y - 2 * q1.x - q.y })
      fol = q
      dirF = { x: 0, y: 1 }
    } else {
      const psi = rad(m.s); const psi1 = rad(m.v); const psi2 = rad(m.a)
      const g = gamma0 - psi; const g1 = -psi1; const g2 = -psi2
      const q = { x: D + La * Math.cos(g), y: La * Math.sin(g) }
      const q1 = { x: -La * g1 * Math.sin(g), y: La * g1 * Math.cos(g) }
      const q2 = { x: -La * g2 * Math.sin(g) - La * g1 * g1 * Math.cos(g), y: La * g2 * Math.cos(g) - La * g1 * g1 * Math.sin(g) }
      pitch = Rot(th, q)
      P1 = Rot(th, { x: q1.x + q.y, y: q1.y - q.x })
      P2 = Rot(th, { x: q2.x + 2 * q1.y - q.x, y: q2.y - 2 * q1.x - q.y })
      fol = q
      dirF = { x: -Math.sin(g), y: Math.cos(g) }
    }
    const T = hypot(P1.x, P1.y) || 1e-12
    const nrm = { x: -P1.y / T, y: P1.x / T } // outward normal (the pitch curve is run clockwise)
    // pressure angle between the normal (in the fixed frame) and the direction the follower is guided along
    const cosT = Math.cos(th); const sinT = Math.sin(th)
    const Nf = { x: cosT * nrm.x - sinT * nrm.y, y: sinT * nrm.x + cosT * nrm.y }
    let dot = Nf.x * dirF.x + Nf.y * dirF.y
    const cross = dirF.x * Nf.y - dirF.y * Nf.x
    let phi = Math.atan2(cross, dot)
    if (dot < 0) { dot = -dot; phi = Math.atan2(-cross, dot) }
    // radius of curvature (convex positive)
    const kappa = (P1.x * P2.y - P1.y * P2.x) / (T * T * T)
    // (the flat-face cam’s radius is Rb + s + s″ exactly, and keeps its sign where the profile turns concave)
    const rho = spec.follower === 'flat' ? Rb + m.s + m.a : Math.abs(kappa) < 1e-12 ? Infinity : -1 / kappa
    const prof = spec.follower === 'roller' ? { x: pitch.x - Rr * nrm.x, y: pitch.y - Rr * nrm.y } : pitch
    out.theta.push(thDeg); out.s.push(m.s)
    out.pitch.push({ x: mirror * pitch.x, y: pitch.y })
    out.profile.push({ x: mirror * prof.x, y: prof.y })
    out.follower.push({ x: mirror * fol.x, y: fol.y })
    out.phi.push(deg(phi) * mirror)
    out.rho.push(rho)
    if (Math.abs(deg(phi)) > maxP) { maxP = Math.abs(deg(phi)); maxPAt = thDeg }
    if (spec.follower === 'flat' ? rho < minRho : rho > 0 && rho < minRho) { minRho = rho; minRhoAt = thDeg }
    outer = Math.max(outer, hypot(prof.x, prof.y))
  }
  out.stats = { maxPressure: maxP, maxPressureAt: maxPAt, minRho, minRhoAt, outerRadius: outer, faceHalfWidth: face, primeRadius: Rp }
  if (spec.follower !== 'flat' && maxP > spec.maxPressure) {
    warnings.push({ level: 'warning', code: 'pressure', at: maxPAt, message: `Pressure angle reaches ${maxP.toFixed(1)}° at ${maxPAt.toFixed(0)}° (limit ${spec.maxPressure}°): increase the base circle, reduce the lift or lengthen the rise.` })
  }
  if (spec.follower === 'roller' && minRho < Rr) {
    warnings.push({ level: 'error', code: 'undercut', at: minRhoAt, message: `Undercutting: the pitch curve's radius of curvature (${minRho.toFixed(1)} mm at ${minRhoAt.toFixed(0)}°) is smaller than the roller radius ${Rr} mm. Use a smaller roller or a bigger base circle.` })
  } else if (spec.follower === 'roller' && minRho < 1.5 * Rr) {
    warnings.push({ level: 'warning', code: 'curvature', at: minRhoAt, message: `The profile is nearly pointed at ${minRhoAt.toFixed(0)}° (curvature radius ${(minRho - Rr).toFixed(1)} mm on the cam).` })
  }
  if (spec.follower === 'flat' && minRho <= 0.5) {
    warnings.push({ level: 'error', code: 'undercut', at: minRhoAt, message: `The flat-face cam is concave or pointed at ${minRhoAt.toFixed(0)}° (Rb + s + s'' ≤ 0): the base circle is too small for this motion.` })
  }
  if (spec.follower === 'knife' && minRho < 1) {
    warnings.push({ level: 'warning', code: 'curvature', at: minRhoAt, message: `The profile has a very sharp convex corner at ${minRhoAt.toFixed(0)}° (radius ${minRho.toFixed(2)} mm).` })
  }
  return out
}

/** Pressure angle (degrees) of a translating follower: tan φ = (ds/dθ − e)/(s + √(Rp² − e²)). */
export function pressureAngleFormula(v: number, s: number, e: number, Rp: number): number {
  return deg(Math.atan2(v - e, s + Math.sqrt(Rp * Rp - e * e)))
}

export interface BaseOptimum {
  /** smallest base circle radius meeting the limits, mm */
  baseRadius: number
  limitedBy: 'pressure' | 'curvature' | 'none'
  maxPressure: number
  minRho: number
}

/** The smallest base circle for which the pressure angle stays below the limit and the profile is not undercut. */
export function optimiseBaseRadius(spec: CamSpec, margin = 2): BaseOptimum {
  const ok = (Rb: number): { good: boolean; by: 'pressure' | 'curvature' | 'none'; prof: CamProfile } => {
    const prof = camProfile({ ...spec, baseRadius: Rb }, 360)
    const bad = prof.warnings.filter((w) => w.level === 'error' && w.code !== 'program')
    const press = spec.follower !== 'flat' && prof.stats.maxPressure > spec.maxPressure + 1e-9
    const curv = bad.length > 0 || (spec.follower === 'roller' && prof.stats.minRho < spec.rollerRadius + margin) || (spec.follower === 'flat' && prof.stats.minRho < margin)
    return { good: !press && !curv, by: press ? 'pressure' : curv ? 'curvature' : 'none', prof }
  }
  let lo = 1
  let hi = 4000
  let r = ok(hi)
  if (!r.good) return { baseRadius: hi, limitedBy: r.by, maxPressure: r.prof.stats.maxPressure, minRho: r.prof.stats.minRho }
  // monotone enough in practice: bisect
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid).good) hi = mid
    else lo = mid
  }
  r = ok(hi)
  const below = ok(hi * 0.97)
  return { baseRadius: hi, limitedBy: below.by, maxPressure: r.prof.stats.maxPressure, minRho: r.prof.stats.minRho }
}

/** Follower reference point position and flat-face line for the animation at cam angle θ. */
export function followerAt(spec: CamSpec, thetaDeg: number): { tip: Pt; s: number } {
  const m = programEval(spec.program, thetaDeg)
  const Rb = spec.baseRadius
  const Rp = Rb + (spec.follower === 'roller' ? spec.rollerRadius : 0)
  if (spec.follower === 'flat') return { tip: { x: 0, y: Rb + m.s }, s: m.s }
  if (spec.motion === 'swing') {
    const D = spec.pivotDistance; const La = spec.armLength
    const c = (Rp * Rp - D * D - La * La) / (2 * D * La)
    const g = (Math.abs(c) <= 1 ? Math.acos(c) : 0) - rad(m.s)
    return { tip: { x: D + La * Math.cos(g), y: La * Math.sin(g) }, s: m.s }
  }
  return { tip: { x: spec.offset, y: Math.sqrt(Math.max(0, Rp * Rp - spec.offset ** 2)) + m.s }, s: m.s }
}
