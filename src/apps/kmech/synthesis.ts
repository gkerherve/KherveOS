// Dimensional synthesis of four-bars (pure): 2 and 3 prescribed coupler positions (graphical method as numbers,
// "Burmester-lite": pick the moving pivots on the coupler, the fixed pivots follow) and function generation for
// three precision points with Freudenstein's equation.

import { circumcircle, classifyFourBar, transmissionAngle, type FourBarLengths, type Grashof } from './fourbar.ts'
import { deg, hypot, solveLinear, type Pt } from './math.ts'

/** A coupler position: a reference point on the coupler and the angle of the coupler. */
export interface CouplerPos {
  x: number
  y: number
  /** radians */
  angle: number
}

/** A point given in the coupler's frame (reference point at the origin, x along the coupler angle) placed in a position. */
export function placeOn(pos: CouplerPos, local: Pt): Pt {
  const c = Math.cos(pos.angle); const s = Math.sin(pos.angle)
  return { x: pos.x + c * local.x - s * local.y, y: pos.y + s * local.x + c * local.y }
}

export interface FourBarDesign {
  /** fixed pivot of the input crank */
  O2: Pt
  /** fixed pivot of the output link */
  O4: Pt
  /** coupler pins in the first position */
  A: Pt
  B: Pt
  lengths: FourBarLengths
  grashof: Grashof
  /** transmission angle at each prescribed position, degrees */
  mu: number[]
  /** the three coupler positions are reached with the same closure of the loops (no branch defect) */
  sameBranch: boolean
  /** The coupler pins in each position. */
  pins: Array<{ A: Pt; B: Pt }>
}

/**
 * Two positions: the moving pivots A, B are chosen on the coupler (`aLocal`, `bLocal`), each fixed pivot lies on
 * the perpendicular bisector of the pivot's two positions at a signed distance `tA`, `tB` from their midpoint.
 */
export function twoPositionSynthesis(p1: CouplerPos, p2: CouplerPos, aLocal: Pt, bLocal: Pt, tA: number, tB: number): FourBarDesign | null {
  const pivot = (local: Pt, t: number): Pt | null => {
    const a1 = placeOn(p1, local); const a2 = placeOn(p2, local)
    const dx = a2.x - a1.x; const dy = a2.y - a1.y
    const L = hypot(dx, dy)
    if (L < 1e-12) return null
    const nx = -dy / L; const ny = dx / L
    return { x: (a1.x + a2.x) / 2 + t * nx, y: (a1.y + a2.y) / 2 + t * ny }
  }
  const O2 = pivot(aLocal, tA); const O4 = pivot(bLocal, tB)
  if (!O2 || !O4) return null
  return assemble([p1, p2], aLocal, bLocal, O2, O4)
}

/** Three positions: the fixed pivots are the centres of the circles through the three positions of each moving pivot. */
export function threePositionSynthesis(ps: [CouplerPos, CouplerPos, CouplerPos], aLocal: Pt, bLocal: Pt): FourBarDesign | null {
  const centre = (local: Pt): Pt | null => {
    const c = circumcircle(placeOn(ps[0], local), placeOn(ps[1], local), placeOn(ps[2], local))
    return c ? c.c : null
  }
  const O2 = centre(aLocal); const O4 = centre(bLocal)
  if (!O2 || !O4) return null
  return assemble(ps, aLocal, bLocal, O2, O4)
}

function assemble(ps: CouplerPos[], aLocal: Pt, bLocal: Pt, O2: Pt, O4: Pt): FourBarDesign | null {
  const pins = ps.map((p) => ({ A: placeOn(p, aLocal), B: placeOn(p, bLocal) }))
  const A = pins[0].A; const B = pins[0].B
  const lengths: FourBarLengths = { a: hypot(A.x - O2.x, A.y - O2.y), b: hypot(B.x - A.x, B.y - A.y), c: hypot(B.x - O4.x, B.y - O4.y), d: hypot(O4.x - O2.x, O4.y - O2.y) }
  if (Object.values(lengths).some((v) => !(v > 1e-9) || !Number.isFinite(v))) return null
  const mu = pins.map((q) => deg(transmissionAngle(lengths, q.A, O4)))
  const orient = pins.map((q) => Math.sign((q.B.x - q.A.x) * (O4.y - q.B.y) - (q.B.y - q.A.y) * (O4.x - q.B.x)))
  const sameBranch = orient.every((o) => o === orient[0] && o !== 0)
  return { O2, O4, A, B, lengths, grashof: classifyFourBar(lengths), mu, sameBranch, pins }
}

export interface CirclePoint {
  /** moving pivot in the coupler frame */
  local: Pt
  /** fixed pivot */
  centre: Pt
  radius: number
}

/** A sample of the circle-point curve (the moving pivots that have a circle through the three positions). */
export function circlePoints(ps: [CouplerPos, CouplerPos, CouplerPos], extent: number, n = 24, maxRadius = 5 * extent): CirclePoint[] {
  const out: CirclePoint[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const local = { x: (i / (n - 1) - 0.5) * 2 * extent, y: (j / (n - 1) - 0.5) * 2 * extent }
      const c = circumcircle(placeOn(ps[0], local), placeOn(ps[1], local), placeOn(ps[2], local))
      if (c && c.r <= maxRadius) out.push({ local, centre: c.c, radius: c.r })
    }
  }
  return out
}

/** Searches pairs of circle points for the most useful four-bar: same branch, Grashof, transmission angles near 90°. */
export function bestThreePosition(ps: [CouplerPos, CouplerPos, CouplerPos], extent: number, n = 14): FourBarDesign | null {
  const cands = circlePoints(ps, extent, n)
  let best: { d: FourBarDesign; score: number } | null = null
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const d = threePositionSynthesis(ps, cands[i].local, cands[j].local)
      if (!d || !d.sameBranch) continue
      const worst = Math.max(...d.mu.map((m) => Math.abs(m - 90)))
      const size = Math.max(d.lengths.a, d.lengths.b, d.lengths.c, d.lengths.d)
      const score = worst + (d.grashof.condition === 'grashof' ? 0 : 25) + size / (extent * 20)
      if (!best || score < best.score) best = { d, score }
    }
  }
  return best ? best.d : null
}

// ------------------------------------------------------------------------------ Freudenstein

export interface PrecisionPoint {
  /** input (crank) angle from the ground link, radians */
  theta: number
  /** output angle from the ground link, radians */
  phi: number
}

/** Freudenstein's equation K1 cos φ − K2 cos θ + K3 = cos(θ − φ) for three precision points. */
export function freudenstein3(pts: [PrecisionPoint, PrecisionPoint, PrecisionPoint]): { K1: number; K2: number; K3: number } | null {
  const A = pts.map((p) => [Math.cos(p.phi), -Math.cos(p.theta), 1])
  const b = pts.map((p) => Math.cos(p.theta - p.phi))
  const k = solveLinear(A, b)
  return k ? { K1: k[0], K2: k[1], K3: k[2] } : null
}

/** Link lengths for Freudenstein's constants and a chosen ground link length d. */
export function lengthsFromK(K: { K1: number; K2: number; K3: number }, d = 1): FourBarLengths | null {
  if (!(K.K1 > 0) || !(K.K2 > 0)) return null
  const a = d / K.K1
  const c = d / K.K2
  const b2 = a * a + c * c + d * d - 2 * a * c * K.K3
  if (!(b2 > 0)) return null
  return { a, b: Math.sqrt(b2), c, d }
}

/** Chebyshev spacing of n precision points on [x0, xn]. */
export function chebyshevPoints(x0: number, xn: number, n = 3): number[] {
  return Array.from({ length: n }, (_, i) => (x0 + xn) / 2 - ((xn - x0) / 2) * Math.cos(((2 * (i + 1) - 1) * Math.PI) / (2 * n)))
}

export interface FunctionGenerator {
  lengths: FourBarLengths
  grashof: Grashof
  points: Array<{ x: number; y: number; theta: number; phi: number }>
  /** Structural error y_mechanism − y_function at 41 points over the range (in the units of y). */
  error: Array<{ x: number; y: number; yMech: number }>
  maxError: number
}

/**
 * A four-bar whose output angle follows y = f(x) for x in [x0, xn]: x maps linearly to the input angle over
 * `thetaSpan` degrees (starting at `theta0`), y to the output angle over `phiSpan` degrees (from `phi0`). Three Chebyshev
 * precision points; ground link d = 1 unit.
 */
export function functionGenerator(f: (x: number) => number, x0: number, xn: number, theta0: number, thetaSpan: number, phi0: number, phiSpan: number, d = 1): FunctionGenerator | null {
  const xs = chebyshevPoints(x0, xn, 3)
  const y0 = f(x0); const yn = f(xn)
  if (!(Math.abs(yn - y0) > 1e-12)) return null
  const th = (x: number) => ((theta0 + (thetaSpan * (x - x0)) / (xn - x0)) * Math.PI) / 180
  const ph = (y: number) => ((phi0 + (phiSpan * (y - y0)) / (yn - y0)) * Math.PI) / 180
  const pts = xs.map((x) => ({ x, y: f(x), theta: th(x), phi: ph(f(x)) }))
  const K = freudenstein3(pts.map((p) => ({ theta: p.theta, phi: p.phi })) as [PrecisionPoint, PrecisionPoint, PrecisionPoint])
  if (!K) return null
  const lengths = lengthsFromK(K, d)
  if (!lengths) return null
  // the mechanism's output for each input angle (Freudenstein solved for φ)
  const error: FunctionGenerator['error'] = []
  let maxError = 0
  for (let i = 0; i <= 40; i++) {
    const x = x0 + ((xn - x0) * i) / 40
    const theta = th(x)
    const phi = outputAngle(K, theta, ph(f(x)))
    if (phi === null) continue
    const yMech = y0 + ((deg(phi) - phi0) * (yn - y0)) / phiSpan
    error.push({ x, y: f(x), yMech })
    maxError = Math.max(maxError, Math.abs(yMech - f(x)))
  }
  return { lengths, grashof: classifyFourBar(lengths), points: pts, error, maxError }
}

/** Output angle φ for input θ from Freudenstein: A cos φ + B sin φ = C (picks the root nearest `guess`). */
export function outputAngle(K: { K1: number; K2: number; K3: number }, theta: number, guess: number): number | null {
  // K1 cosφ − K2 cosθ + K3 = cosθ cosφ + sinθ sinφ  ⇒  (K1 − cosθ) cosφ − sinθ sinφ = K2 cosθ − K3
  const A = K.K1 - Math.cos(theta)
  const B = -Math.sin(theta)
  const C = K.K2 * Math.cos(theta) - K.K3
  const R = hypot(A, B)
  if (R < 1e-12 || Math.abs(C) > R) return null
  const base = Math.atan2(B, A)
  const off = Math.acos(C / R)
  const r1 = base + off; const r2 = base - off
  const wrap = (a: number) => a - Math.round((a - guess) / (2 * Math.PI)) * 2 * Math.PI
  const a1 = wrap(r1); const a2 = wrap(r2)
  return Math.abs(a1 - guess) <= Math.abs(a2 - guess) ? a1 : a2
}
