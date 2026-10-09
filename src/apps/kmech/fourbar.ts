// Four-bar linkages in closed form (pure): Grashof classification, positions by circle intersection, transmission
// angle, the rocker's toggle positions and the slider-crank formulas. The general solver (linkage.ts) is checked
// against these in the tests, and the examples use them for their labels.
//
// Naming: ground link d joins the fixed pivots O2 (0, 0) and O4 (d, 0); the input crank a turns about O2 with
// angle θ2; the coupler b joins the crank pin A to the output pin B; the output link c turns about O4.

import { circleIntersections, deg, hypot, quadratic, TAU, wrapPi, type Pt } from './math.ts'

export interface FourBarLengths {
  /** input link (crank), O2 → A */
  a: number
  /** coupler, A → B */
  b: number
  /** output link, O4 → B */
  c: number
  /** ground link, O2 → O4 */
  d: number
}

export type FourBarKind = 'crank-rocker' | 'double-crank' | 'double-rocker' | 'change-point' | 'invalid'

export interface Grashof {
  kind: FourBarKind
  /** s + l compared with p + q: 'grashof' (<), 'change-point' (=) or 'non-grashof' (>) */
  condition: 'grashof' | 'change-point' | 'non-grashof'
  /** s + l − (p + q); negative for a Grashof linkage */
  margin: number
  shortest: 'input' | 'coupler' | 'output' | 'ground'
  /** The input link can make a full turn. */
  inputFullTurn: boolean
  /** The output link can make a full turn. */
  outputFullTurn: boolean
  /** The coupler can turn all the way round (relative to the frame). */
  couplerFullTurn: boolean
  /** A name for the table. */
  label: string
  /** Why it is invalid, if it is. */
  problem?: string
}

const LABELS: Record<FourBarKind, string> = {
  'crank-rocker': 'Grashof crank-rocker',
  'double-crank': 'Grashof double-crank (drag link)',
  'double-rocker': 'double-rocker',
  'change-point': 'change-point',
  invalid: 'not a closed linkage',
}

/** Grashof's criterion and the name of the type for given lengths (input a, coupler b, output c, ground d). */
export function classifyFourBar(g: FourBarLengths): Grashof {
  const { a, b, c, d } = g
  const all = [a, b, c, d]
  const none = (problem: string): Grashof => ({
    kind: 'invalid', condition: 'non-grashof', margin: NaN, shortest: 'input', inputFullTurn: false, outputFullTurn: false, couplerFullTurn: false, label: LABELS.invalid, problem,
  })
  if (all.some((v) => !(v > 0) || !Number.isFinite(v))) return none('All four lengths must be positive numbers.')
  const sorted = [...all].sort((x, y) => x - y)
  const [s, p, q, l] = sorted
  if (l > s + p + q + 1e-12 * l) return none('The longest link is longer than the other three together: the linkage cannot close.')
  const margin = s + l - (p + q)
  const eps = 1e-9 * Math.max(...all)
  const names: Array<[number, Grashof['shortest']]> = [[a, 'input'], [b, 'coupler'], [c, 'output'], [d, 'ground']]
  const shortest = names.find(([v]) => v === s)![1]
  if (Math.abs(margin) <= eps) {
    return { kind: 'change-point', condition: 'change-point', margin, shortest, inputFullTurn: true, outputFullTurn: true, couplerFullTurn: true, label: LABELS['change-point'] }
  }
  if (margin > 0) {
    return { kind: 'double-rocker', condition: 'non-grashof', margin, shortest, inputFullTurn: false, outputFullTurn: false, couplerFullTurn: false, label: 'non-Grashof double-rocker' }
  }
  // Grashof: the link next to the shortest one one the frame side decides which turns
  switch (shortest) {
    case 'input':
      return { kind: 'crank-rocker', condition: 'grashof', margin, shortest, inputFullTurn: true, outputFullTurn: false, couplerFullTurn: false, label: LABELS['crank-rocker'] }
    case 'output':
      return { kind: 'crank-rocker', condition: 'grashof', margin, shortest, inputFullTurn: false, outputFullTurn: true, couplerFullTurn: false, label: 'Grashof crank-rocker (rocker-driven)' }
    case 'ground':
      return { kind: 'double-crank', condition: 'grashof', margin, shortest, inputFullTurn: true, outputFullTurn: true, couplerFullTurn: false, label: LABELS['double-crank'] }
    default:
      return { kind: 'double-rocker', condition: 'grashof', margin, shortest, inputFullTurn: false, outputFullTurn: false, couplerFullTurn: true, label: 'Grashof double-rocker (coupler turns fully)' }
  }
}

export interface FourBarPose {
  O2: Pt
  O4: Pt
  A: Pt
  B: Pt
  /** crank angle θ2 */
  th2: number
  /** coupler angle θ3 (A → B) */
  th3: number
  /** output angle θ4 (O4 → B) */
  th4: number
  /** transmission angle: the angle at B between coupler and output link, 0…π */
  mu: number
}

/**
 * Closed-form position: B is an intersection of the circles (A, b) and (O4, c). `branch` 0 or 1 picks one of the
 * two assembly configurations (0: B on the right of A → O4... see the tests); null when the linkage cannot reach θ2.
 */
export function fourBarPose(g: FourBarLengths, th2: number, branch: 0 | 1 = 0): FourBarPose | null {
  const O2 = { x: 0, y: 0 }
  const O4 = { x: g.d, y: 0 }
  const A = { x: g.a * Math.cos(th2), y: g.a * Math.sin(th2) }
  const hits = circleIntersections(A, g.b, O4, g.c)
  if (hits.length === 0) return null
  const B = hits[Math.min(branch, hits.length - 1)]
  const th3 = Math.atan2(B.y - A.y, B.x - A.x)
  const th4 = Math.atan2(B.y - O4.y, B.x - O4.x)
  return { O2, O4, A, B, th2, th3, th4, mu: transmissionAngle(g, A, O4) }
}

/** The transmission angle (0…π) from the distance between the crank pin A and the output pivot O4. */
export function transmissionAngle(g: FourBarLengths, A: Pt, O4: Pt): number {
  const e2 = (A.x - O4.x) ** 2 + (A.y - O4.y) ** 2
  const cos = (g.b * g.b + g.c * g.c - e2) / (2 * g.b * g.c)
  return Math.acos(Math.max(-1, Math.min(1, cos)))
}

/**
 * The crank angles at which the coupler and the output link are in line (the toggle positions), from the law of
 * cosines: |A − O4| = b + c (rocker at one limit) or |b − c| (the other). Angles in (−π, π], at most four.
 */
export function fourBarToggles(g: FourBarLengths): Array<{ th2: number; kind: 'extended' | 'folded' }> {
  const out: Array<{ th2: number; kind: 'extended' | 'folded' }> = []
  const { a, b, c, d } = g
  const tries: Array<[number, 'extended' | 'folded']> = [[b + c, 'extended'], [Math.abs(b - c), 'folded']]
  for (const [r, kind] of tries) {
    // |A − O4|² = a² + d² − 2 a d cos θ2 = r²
    const cos = (a * a + d * d - r * r) / (2 * a * d)
    if (cos < -1 - 1e-12 || cos > 1 + 1e-12) continue
    const t = Math.acos(Math.max(-1, Math.min(1, cos)))
    out.push({ th2: t, kind })
    if (t > 1e-12 && Math.PI - t > 1e-12) out.push({ th2: -t, kind })
    else if (Math.abs(t) <= 1e-12 || Math.abs(Math.PI - t) <= 1e-12) { /* the two coincide */ }
  }
  return out.map((o) => ({ ...o, th2: wrapPi(o.th2) }))
}

/**
 * The two extreme positions of the rocker of a crank-rocker (crank and coupler in line): output angles θ4 (radians,
 * from the frame line O2→O4) and the crank angles θ2 at which they occur. `up` picks the assembly with B above the frame line.
 */
export function fourBarRockerLimits(g: FourBarLengths, up = true): { extended: { th4: number; th2: number }; folded: { th4: number; th2: number } } | null {
  const { a, b, c, d } = g
  const phi = (e: number) => { const v = (c * c + d * d - e * e) / (2 * c * d); return v < -1 - 1e-12 || v > 1 + 1e-12 ? null : Math.acos(Math.max(-1, Math.min(1, v))) }
  const pe = phi(a + b); const pf = phi(Math.abs(b - a))
  if (pe === null || pf === null) return null
  const s = up ? 1 : -1
  const at = (p: number, folded: boolean) => {
    const th4 = Math.PI - s * p
    const Bx = d + c * Math.cos(th4); const By = c * Math.sin(th4)
    return { th4, th2: Math.atan2(By, Bx) + (folded ? Math.PI : 0) }
  }
  return { extended: at(pe, false), folded: at(pf, true) }
}

/** Min and max of the transmission angle of a crank-rocker: at θ2 = 0 and θ2 = π (closed form). */
export function crankRockerTransmission(g: FourBarLengths): { min: number; max: number } {
  const at = (e: number) => Math.acos(Math.max(-1, Math.min(1, (g.b * g.b + g.c * g.c - e * e) / (2 * g.b * g.c))))
  const m1 = at(Math.abs(g.d - g.a))
  const m2 = at(g.d + g.a)
  return { min: Math.min(m1, m2), max: Math.max(m1, m2) }
}

/**
 * Crank angles θ2 (relative to the frame, radians) the input can reach: the whole turn, or the intervals where
 * |A − O4| lies between |b − c| and b + c.
 */
export function fourBarInputRange(g: FourBarLengths): { full: boolean; intervals: Array<[number, number]> } {
  const k = classifyFourBar(g)
  if (k.kind === 'invalid') return { full: false, intervals: [] }
  if (k.inputFullTurn) return { full: true, intervals: [[-Math.PI, Math.PI]] }
  const { a, b, c, d } = g
  // cos θ2 must lie in [lo, hi]
  const lo = (a * a + d * d - (b + c) ** 2) / (2 * a * d)
  const hi = (a * a + d * d - (b - c) ** 2) / (2 * a * d)
  const cMin = Math.max(lo, -1)
  const cMax = Math.min(hi, 1)
  if (cMin > cMax) return { full: false, intervals: [] }
  const t0 = Math.acos(cMax)
  const t1 = Math.acos(cMin)
  if (t0 < 1e-12) return { full: false, intervals: [[-t1, t1]] }
  if (Math.PI - t1 < 1e-12) return { full: false, intervals: [[-Math.PI, -t0], [t0, Math.PI]] }
  return { full: false, intervals: [[-t1, -t0], [t0, t1]] }
}

// ------------------------------------------------------------------------------ slider-crank

export interface SliderCrank {
  /** crank radius */
  r: number
  /** connecting rod length */
  l: number
  /** offset of the slide line from the crank axis (0 for an in-line engine) */
  e?: number
}

/** x = r cos θ + √(l² − (r sin θ − e)²): position of the wrist pin along the slide. */
export function sliderX(s: SliderCrank, th: number): number {
  const u = s.r * Math.sin(th) - (s.e ?? 0)
  return s.r * Math.cos(th) + Math.sqrt(s.l * s.l - u * u)
}

/** dx/dθ */
export function sliderV(s: SliderCrank, th: number): number {
  const u = s.r * Math.sin(th) - (s.e ?? 0)
  const q = Math.sqrt(s.l * s.l - u * u)
  return -s.r * Math.sin(th) - (u * s.r * Math.cos(th)) / q
}

/** d²x/dθ² */
export function sliderA(s: SliderCrank, th: number): number {
  const u = s.r * Math.sin(th) - (s.e ?? 0)
  const q = Math.sqrt(s.l * s.l - u * u)
  const c = Math.cos(th)
  return -s.r * c - (s.r * s.r * c * c - s.r * u * Math.sin(th)) / q - (u * u * s.r * s.r * c * c) / (q * q * q)
}

/** The approximate inertia-force harmonics: x ≈ r cosθ + (r²/4l) cos 2θ (+ const), the usual textbook form. */
export function sliderApprox(s: SliderCrank, th: number): number {
  return s.r * Math.cos(th) + (s.r * s.r) / (4 * s.l) * Math.cos(2 * th) + s.l - (s.r * s.r) / (4 * s.l)
}

export const sliderStroke = (s: SliderCrank): number => sliderX(s, 0) - sliderX(s, Math.PI)

// ------------------------------------------------------------------------------ quick return and Watt

/**
 * The time ratio of a quick-return mechanism from the crank angles of the two stroke ends:
 * forward = angle from θ1 to θ2 (in the sense of rotation), the rest is the return. Q ≥ 1, β the "advance angle".
 */
export function quickReturnFromAngles(th1: number, th2: number): { ratio: number; forwardDeg: number; returnDeg: number; betaDeg: number } {
  const fwd = ((th2 - th1) % TAU + TAU) % TAU
  const ret = TAU - fwd
  const slow = Math.max(fwd, ret)
  const fast = Math.min(fwd, ret)
  return { ratio: slow / fast, forwardDeg: deg(slow), returnDeg: deg(fast), betaDeg: deg(slow - Math.PI) }
}

/** Closed form for the Whitworth drive: Q = (π + 2 asin(d/R)) / (π − 2 asin(d/R)), d < R the distance between the pivots. */
export function whitworthRatio(d: number, R: number): number {
  const a = Math.asin(d / R)
  return (Math.PI + 2 * a) / (Math.PI - 2 * a)
}

/** The crank-and-slotted-lever (shaper) ratio, d > R: the lever's extremes are tangent to the crank circle. */
export function slottedLeverRatio(d: number, R: number): number {
  const phi = Math.acos(R / d)
  return (TAU - 2 * phi) / (2 * phi)
}

/** Peaucellier–Lipkin: the straight line x = (L² − s²)/(2 d) traced by P (O the fixed pivot, d the crank radius = OQ). */
export function peaucellierLineX(L: number, s: number, d: number): number {
  return (L * L - s * s) / (2 * d)
}

/** The Geneva wheel: output angle of an n-slot wheel for crank angle θ (from the line of centres), engaged for |θ| < π/2 − π/n. */
export function genevaAngle(n: number, th: number): number {
  const rho = Math.sin(Math.PI / n)
  return Math.atan2(rho * Math.sin(th), 1 - rho * Math.cos(th))
}

/** Roots of the Freudenstein equation are in synthesis.ts; here: the circle through three points (centre and radius). */
export function circumcircle(p: Pt, q: Pt, r: Pt): { c: Pt; r: number } | null {
  const ax = p.x; const ay = p.y; const bx = q.x; const by = q.y; const cx = r.x; const cy = r.y
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(D) < 1e-12) return null
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D
  return { c: { x: ux, y: uy }, r: hypot(ax - ux, ay - uy) }
}

export { quadratic }
