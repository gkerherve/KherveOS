// Gravity (pure): the N-body force (direct sum or Barnes–Hut octree) as a second-order system, Kepler's equation
// and orbital elements, conic sections, Hohmann transfers, hyperbolic fly-bys and the planets of the solar system.
// Units of the solar-system scenes: AU, year, solar mass (G = 4π²).

import type { System2 } from './integrators.ts'
import { rng, gauss, DEG } from './common.ts'

export const G_AU = 4 * Math.PI * Math.PI
/** 1 AU/yr in km/s. */
export const AUYR_KMS = 4.740470464
export const AU_KM = 149597870.7
export const MU_SUN_SI = 1.32712440018e20
export const AU_M = 1.495978707e11
export const DAY_YR = 1 / 365.25

// ------------------------------------------------------------------------------------------ the force

export interface GravityOptions {
  G: number
  /** Plummer softening length. */
  eps: number
  /** Use a Barnes–Hut octree with this opening angle (0 or undefined: direct sum). */
  theta?: number
}

interface Node {
  cx: number
  cy: number
  cz: number
  half: number
  mass: number
  mx: number
  my: number
  mz: number
  body: number
  kids: (Node | null)[] | null
}

function newNode(cx: number, cy: number, cz: number, half: number): Node {
  return { cx, cy, cz, half, mass: 0, mx: 0, my: 0, mz: 0, body: -1, kids: null }
}

function octant(n: Node, x: number, y: number, z: number): number {
  return (x > n.cx ? 1 : 0) | (y > n.cy ? 2 : 0) | (z > n.cz ? 4 : 0)
}

function insert(n: Node, i: number, pos: ArrayLike<number>, m: ArrayLike<number>, depth = 0) {
  const x = pos[3 * i]
  const y = pos[3 * i + 1]
  const z = pos[3 * i + 2]
  if (n.mass === 0 && n.kids === null) {
    n.body = i
  } else {
    if (n.kids === null) {
      // split: push the resident body down (unless the depth limit says two bodies sit on top of each other)
      if (depth > 40) { n.body = -2; n.mass += m[i]; n.mx += m[i] * x; n.my += m[i] * y; n.mz += m[i] * z; return }
      n.kids = new Array<Node | null>(8).fill(null)
      const j = n.body
      n.body = -1
      if (j >= 0) place(n, j, pos, m, depth)
    }
    place(n, i, pos, m, depth)
    n.mass += 0
  }
  n.mass += m[i]
  n.mx += m[i] * x
  n.my += m[i] * y
  n.mz += m[i] * z
}

function place(n: Node, i: number, pos: ArrayLike<number>, m: ArrayLike<number>, depth: number) {
  const o = octant(n, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])
  let k = n.kids![o]
  if (!k) {
    const h = n.half / 2
    k = newNode(n.cx + (o & 1 ? h : -h), n.cy + (o & 2 ? h : -h), n.cz + (o & 4 ? h : -h), h)
    n.kids![o] = k
  }
  insert(k, i, pos, m, depth + 1)
}

/** Accelerations by an octree: cells farther than size/theta are treated as one mass at their centre of mass. */
export function barnesHutAccel(pos: ArrayLike<number>, m: ArrayLike<number>, out: Float64Array, o: GravityOptions) {
  const N = m.length
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 3 * N; i++) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]) }
  const half = Math.max((hi - lo) / 2, 1e-9) * 1.0001
  const mid = (hi + lo) / 2
  const root = newNode(mid, mid, mid, half)
  // the cell centre must be the box centre in every axis
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
  for (let i = 0; i < N; i++) {
    minx = Math.min(minx, pos[3 * i]); maxx = Math.max(maxx, pos[3 * i])
    miny = Math.min(miny, pos[3 * i + 1]); maxy = Math.max(maxy, pos[3 * i + 1])
    minz = Math.min(minz, pos[3 * i + 2]); maxz = Math.max(maxz, pos[3 * i + 2])
  }
  root.cx = (minx + maxx) / 2
  root.cy = (miny + maxy) / 2
  root.cz = (minz + maxz) / 2
  root.half = Math.max(maxx - minx, maxy - miny, maxz - minz, 1e-9) / 2 * 1.0001
  for (let i = 0; i < N; i++) if (m[i] > 0) insert(root, i, pos, m)
  const th2 = (o.theta ?? 0.5) ** 2
  const e2 = o.eps * o.eps
  const stack: Node[] = []
  for (let i = 0; i < N; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]
    let ax = 0, ay = 0, az = 0
    stack.length = 0
    stack.push(root)
    while (stack.length) {
      const n = stack.pop()!
      if (n.mass === 0) continue
      if (n.kids === null && n.body === i) continue
      const cmx = n.mx / n.mass, cmy = n.my / n.mass, cmz = n.mz / n.mass
      const dx = cmx - x, dy = cmy - y, dz = cmz - z
      const r2 = dx * dx + dy * dy + dz * dz
      if (r2 + e2 === 0) continue
      const size = 2 * n.half
      if (n.kids === null || size * size < th2 * r2) {
        const s = r2 + e2
        const f = (o.G * n.mass) / (s * Math.sqrt(s))
        ax += f * dx; ay += f * dy; az += f * dz
      } else {
        for (const k of n.kids) if (k) stack.push(k)
      }
    }
    out[3 * i] = ax
    out[3 * i + 1] = ay
    out[3 * i + 2] = az
  }
}

export function directAccel(pos: ArrayLike<number>, m: ArrayLike<number>, out: Float64Array, o: GravityOptions) {
  const N = m.length
  const e2 = o.eps * o.eps
  out.fill(0, 0, 3 * N)
  for (let i = 0; i < N; i++) {
    const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2]
    for (let j = i + 1; j < N; j++) {
      const dx = pos[3 * j] - xi, dy = pos[3 * j + 1] - yi, dz = pos[3 * j + 2] - zi
      const s = dx * dx + dy * dy + dz * dz + e2
      if (s === 0 || (m[i] === 0 && m[j] === 0)) continue
      const inv = 1 / (s * Math.sqrt(s))
      const fi = o.G * m[j] * inv
      const fj = o.G * m[i] * inv
      out[3 * i] += fi * dx; out[3 * i + 1] += fi * dy; out[3 * i + 2] += fi * dz
      out[3 * j] -= fj * dx; out[3 * j + 1] -= fj * dy; out[3 * j + 2] -= fj * dz
    }
  }
}

/** The N-body system: state [x0 y0 z0 x1 …, vx0 vy0 vz0 …]. */
export function gravitySystem(m: ArrayLike<number>, opts: () => GravityOptions): System2 {
  const N = m.length
  return {
    n: 3 * N,
    acc(_t, y, a) {
      const o = opts()
      if (o.theta && o.theta > 0 && N > 8) barnesHutAccel(y, m, a, o)
      else directAccel(y, m, a, o)
    },
  }
}

export interface GravityTotals {
  ke: number
  pe: number
  px: number
  py: number
  pz: number
  lx: number
  ly: number
  lz: number
  mass: number
  cx: number
  cy: number
  cz: number
}

/** Energy (with the softened potential), momentum, angular momentum and the centre of mass of a state. */
export function gravityTotals(y: ArrayLike<number>, m: ArrayLike<number>, o: GravityOptions): GravityTotals {
  const N = m.length
  const t: GravityTotals = { ke: 0, pe: 0, px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, mass: 0, cx: 0, cy: 0, cz: 0 }
  const e2 = o.eps * o.eps
  for (let i = 0; i < N; i++) {
    const x = y[3 * i], yy = y[3 * i + 1], z = y[3 * i + 2]
    const vx = y[3 * N + 3 * i], vy = y[3 * N + 3 * i + 1], vz = y[3 * N + 3 * i + 2]
    t.ke += 0.5 * m[i] * (vx * vx + vy * vy + vz * vz)
    t.px += m[i] * vx; t.py += m[i] * vy; t.pz += m[i] * vz
    t.lx += m[i] * (yy * vz - z * vy)
    t.ly += m[i] * (z * vx - x * vz)
    t.lz += m[i] * (x * vy - yy * vx)
    t.mass += m[i]
    t.cx += m[i] * x; t.cy += m[i] * yy; t.cz += m[i] * z
    for (let j = i + 1; j < N; j++) {
      const dx = y[3 * j] - x, dy = y[3 * j + 1] - yy, dz = y[3 * j + 2] - z
      t.pe -= (o.G * m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + e2)
    }
  }
  if (t.mass > 0) { t.cx /= t.mass; t.cy /= t.mass; t.cz /= t.mass }
  return t
}

/** Moves the state so the centre of mass is at the origin and the total momentum is zero. */
export function toBarycentre(y: Float64Array, m: ArrayLike<number>) {
  const N = m.length
  let M = 0
  const c = [0, 0, 0]
  const p = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    M += m[i]
    for (let k = 0; k < 3; k++) { c[k] += m[i] * y[3 * i + k]; p[k] += m[i] * y[3 * N + 3 * i + k] }
  }
  if (M <= 0) return
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { y[3 * i + k] -= c[k] / M; y[3 * N + 3 * i + k] -= p[k] / M }
}

// ------------------------------------------------------------------------------------------ Kepler

/** Solves M = E - e sin E (elliptic). */
export function solveKepler(M: number, e: number): number {
  M = ((M + Math.PI) % (2 * Math.PI)) - Math.PI
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1)
  for (let i = 0; i < 60; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    E -= d
    if (Math.abs(d) < 1e-15) break
  }
  return E
}

export interface Elements {
  /** Semi-major axis, AU. */
  a: number
  e: number
  /** Degrees. */
  i: number
  /** Mean longitude, longitude of perihelion, longitude of the ascending node (degrees). */
  L: number
  varpi: number
  Omega: number
}

/** Position and velocity (AU, AU/yr) from elements about a mass with gravitational parameter mu. */
export function stateFromElements(el: Elements, mu: number): { r: number[]; v: number[] } {
  const omega = (el.varpi - el.Omega) * DEG
  const M = (el.L - el.varpi) * DEG
  const E = solveKepler(M, el.e)
  const xp = el.a * (Math.cos(E) - el.e)
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E)
  const n = Math.sqrt(mu / el.a ** 3)
  const rr = el.a * (1 - el.e * Math.cos(E))
  const vxp = (-el.a * el.a * n * Math.sin(E)) / rr
  const vyp = (el.a * el.a * n * Math.sqrt(1 - el.e * el.e) * Math.cos(E)) / rr
  const co = Math.cos(omega), so = Math.sin(omega)
  const cO = Math.cos(el.Omega * DEG), sO = Math.sin(el.Omega * DEG)
  const ci = Math.cos(el.i * DEG), si = Math.sin(el.i * DEG)
  const rot = (x: number, y: number) => [
    (co * cO - so * sO * ci) * x + (-so * cO - co * sO * ci) * y,
    (co * sO + so * cO * ci) * x + (-so * sO + co * cO * ci) * y,
    so * si * x + co * si * y,
  ]
  return { r: rot(xp, yp), v: rot(vxp, vyp) }
}

export interface PlanetData extends Elements {
  name: string
  /** Solar masses. */
  m: number
  color: string
  /** Display radius (a symbolic size, AU). */
  size: number
}

/** JPL "Keplerian elements for approximate positions of the major planets" (1800-2050), epoch J2000. */
export const PLANETS: PlanetData[] = [
  { name: 'Mercury', a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.2503235, varpi: 77.45779628, Omega: 48.33076593, m: 1.6601e-7, color: '#a8a29e', size: 0.012 },
  { name: 'Venus', a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.9790995, varpi: 131.60246718, Omega: 76.67984255, m: 2.4478e-6, color: '#fcd34d', size: 0.016 },
  { name: 'Earth', a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, varpi: 102.93768193, Omega: 0, m: 3.0404e-6, color: '#38bdf8', size: 0.016 },
  { name: 'Mars', a: 1.52371034, e: 0.0933941, i: 1.84969142, L: -4.55343205, varpi: -23.94362959, Omega: 49.55953891, m: 3.2272e-7, color: '#f87171', size: 0.013 },
  { name: 'Jupiter', a: 5.202887, e: 0.04838624, i: 1.30439695, L: 34.39644051, varpi: 14.72847983, Omega: 100.47390909, m: 9.5479e-4, color: '#fb923c', size: 0.05 },
  { name: 'Saturn', a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423, varpi: 92.59887831, Omega: 113.66242448, m: 2.8588e-4, color: '#facc15', size: 0.045 },
]

// ------------------------------------------------------------------------------------------ two-body helpers

export const circularSpeed = (mu: number, r: number) => Math.sqrt(mu / r)
export const escapeSpeed = (mu: number, r: number) => Math.sqrt((2 * mu) / r)

export interface Hohmann {
  dv1: number
  dv2: number
  total: number
  /** Time of flight (half the transfer ellipse's period). */
  time: number
  a: number
  /** Angle by which the target must lead the starting planet at departure, radians. */
  lead: number
}

/** Hohmann transfer between circular, coplanar orbits r1 -> r2 about a body with parameter mu. */
export function hohmann(mu: number, r1: number, r2: number): Hohmann {
  const a = (r1 + r2) / 2
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1)
  const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)))
  const time = Math.PI * Math.sqrt(a ** 3 / mu)
  const lead = Math.PI - Math.sqrt(mu / r2 ** 3) * time
  return { dv1, dv2, total: Math.abs(dv1) + Math.abs(dv2), time, a, lead }
}

export interface Conic {
  kind: 'circle' | 'ellipse' | 'parabola' | 'hyperbola'
  /** Semi-latus rectum. */
  p: number
  /** Semi-major axis (negative for a hyperbola, Infinity for a parabola). */
  a: number
  period: number
  /** Specific orbital energy. */
  energy: number
}

export function conicOf(mu: number, rp: number, e: number): Conic {
  const p = rp * (1 + e)
  if (e < 1e-9) return { kind: 'circle', p, a: rp, period: 2 * Math.PI * Math.sqrt(rp ** 3 / mu), energy: -mu / (2 * rp) }
  if (e < 1 - 1e-9) {
    const a = rp / (1 - e)
    return { kind: 'ellipse', p, a, period: 2 * Math.PI * Math.sqrt(a ** 3 / mu), energy: -mu / (2 * a) }
  }
  if (e < 1 + 1e-9) return { kind: 'parabola', p, a: Infinity, period: Infinity, energy: 0 }
  const a = rp / (1 - e)
  return { kind: 'hyperbola', p, a, period: Infinity, energy: -mu / (2 * a) }
}

/** Points of the conic r = p / (1 + e cos(theta)) about its focus, periapsis on +x. */
export function conicPoints(p: number, e: number, n = 160, rMax = Infinity): number[][] {
  const out: number[][] = []
  const thMax = e > 1 ? Math.min(Math.acos(-1 / e) * 0.995, Math.PI) : Math.PI
  for (let i = 0; i <= n; i++) {
    const th = -thMax + (2 * thMax * i) / n
    const r = p / (1 + e * Math.cos(th))
    if (r < 0 || r > rMax) continue
    out.push([r * Math.cos(th), r * Math.sin(th)])
  }
  return out
}

export interface Hyperbola {
  e: number
  rp: number
  /** Deflection angle, radians. */
  delta: number
  vinf: number
}

export function hyperbolaOf(mu: number, vinf: number, b: number): Hyperbola {
  const e = Math.sqrt(1 + ((b * vinf * vinf) / mu) ** 2)
  return { e, rp: (mu / (vinf * vinf)) * (e - 1), delta: 2 * Math.asin(1 / e), vinf }
}

/**
 * Initial state, in the planet's frame, of a probe on the hyperbola with speed vinf at infinity and impact parameter b,
 * placed at distance D on the way in; it arrives along +x (from the left). side +1: it passes above the planet.
 */
export function hyperbolaStart(mu: number, vinf: number, b: number, D: number, side: 1 | -1): { r: number[]; v: number[] } {
  const h = hyperbolaOf(mu, vinf, b)
  const p = h.rp * (1 + h.e)
  const th0 = -Math.acos(Math.max(-1, Math.min(1, (p / D - 1) / h.e)))
  const r0 = p / (1 + h.e * Math.cos(th0))
  const hh = Math.sqrt(mu * p)
  // orbit frame: counter-clockwise, periapsis on +x'
  const pos = [r0 * Math.cos(th0), r0 * Math.sin(th0)]
  const vel = [(-mu / hh) * Math.sin(th0), (mu / hh) * (h.e + Math.cos(th0))]
  // incoming asymptote direction in the orbit frame
  const thInf = -Math.acos(-1 / h.e)
  const vin = [(-mu / hh) * Math.sin(thInf), (mu / hh) * (h.e + Math.cos(thInf))]
  const ang = Math.atan2(vin[1], vin[0])
  const c = Math.cos(-ang)
  const s = Math.sin(-ang)
  const rot = (q: number[]) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c]
  let r = rot(pos)
  let v = rot(vel)
  // counter-clockwise motion with the planet on the left: the probe passes below it (y < 0 side of the line); mirror for side +1
  if (side === 1) { r = [r[0], -r[1]]; v = [v[0], -v[1]] }
  return { r, v }
}

// ------------------------------------------------------------------------------------------ initial conditions

export interface Cloud {
  m: number[]
  y: Float64Array
}

/** A central mass M and n light bodies on near-circular orbits in a thin disc (G = 1). */
export function discGalaxy(n: number, seed: number, G = 1): Cloud {
  const rnd = rng(seed)
  const N = n
  const m: number[] = new Array(N).fill(0)
  const y = new Float64Array(6 * N)
  m[0] = 1
  const mp = 0.4 / Math.max(N - 1, 1)
  const radii: number[] = []
  for (let i = 1; i < N; i++) radii.push(0.25 + 1.75 * Math.sqrt(rnd()))
  radii.sort((a, b) => a - b)
  for (let i = 1; i < N; i++) {
    m[i] = mp
    const r = radii[i - 1]
    const th = rnd() * 2 * Math.PI
    const enclosed = 1 + mp * (i - 1)
    const vc = Math.sqrt((G * enclosed) / r) * (1 + 0.03 * gauss(rnd))
    y[3 * i] = r * Math.cos(th)
    y[3 * i + 1] = r * Math.sin(th)
    y[3 * i + 2] = 0.02 * r * gauss(rnd)
    y[3 * N + 3 * i] = -vc * Math.sin(th)
    y[3 * N + 3 * i + 1] = vc * Math.cos(th)
    y[3 * N + 3 * i + 2] = 0.01 * vc * gauss(rnd)
  }
  toBarycentre(y, m)
  return { m, y }
}

/** A Plummer sphere of n equal masses (total mass 1, scale radius a), in rough virial equilibrium (G = 1). */
export function plummerCluster(n: number, seed: number, a = 0.5): Cloud {
  const rnd = rng(seed)
  const m = new Array<number>(n).fill(1 / n)
  const y = new Float64Array(6 * n)
  for (let i = 0; i < n; i++) {
    const X = Math.max(rnd(), 1e-4)
    const r = a / Math.sqrt(X ** (-2 / 3) - 1)
    const ct = 2 * rnd() - 1
    const st = Math.sqrt(1 - ct * ct)
    const ph = 2 * Math.PI * rnd()
    y[3 * i] = r * st * Math.cos(ph); y[3 * i + 1] = r * st * Math.sin(ph); y[3 * i + 2] = r * ct
    // speed: von Neumann rejection on the Plummer distribution function
    let q = rnd()
    for (let k = 0; k < 500 && 0.1 * rnd() > q * q * (1 - q * q) ** 3.5; k++) q = rnd()
    const ve = Math.sqrt(2) * (1 + (r / a) ** 2) ** -0.25 * Math.sqrt(1 / a)
    const v = q * ve
    const c2 = 2 * rnd() - 1
    const s2 = Math.sqrt(1 - c2 * c2)
    const p2 = 2 * Math.PI * rnd()
    y[3 * n + 3 * i] = v * s2 * Math.cos(p2); y[3 * n + 3 * i + 1] = v * s2 * Math.sin(p2); y[3 * n + 3 * i + 2] = v * c2
  }
  toBarycentre(y, m)
  return { m, y }
}

/** The figure-eight solution (Chenciner–Montgomery, G = m = 1): period 6.32591398. */
export const FIGURE8 = {
  period: 6.32591398,
  pos: [[-0.97000436, 0.24308753], [0.97000436, -0.24308753], [0, 0]],
  vel: [[0.4662036850, 0.4323657300], [0.4662036850, 0.4323657300], [-0.93240737, -0.86473146]],
}

// ------------------------------------------------------------------------------------------ restricted three-body

export interface Cr3bp {
  mu: number
}

/** Accelerations in the rotating frame (primaries at (-mu, 0) and (1-mu, 0), unit separation and angular speed). */
export function cr3bpAcc(mu: number, x: number, y: number, vx: number, vy: number): [number, number] {
  const r1 = Math.hypot(x + mu, y)
  const r2 = Math.hypot(x - 1 + mu, y)
  const r13 = r1 ** 3
  const r23 = r2 ** 3
  return [x + 2 * vy - ((1 - mu) * (x + mu)) / r13 - (mu * (x - 1 + mu)) / r23, y - 2 * vx - ((1 - mu) * y) / r13 - (mu * y) / r23]
}

export function jacobi(mu: number, x: number, y: number, vx: number, vy: number): number {
  const r1 = Math.hypot(x + mu, y)
  const r2 = Math.hypot(x - 1 + mu, y)
  return x * x + y * y + (2 * (1 - mu)) / r1 + (2 * mu) / r2 - (vx * vx + vy * vy)
}

/** The five Lagrange points of the rotating frame. */
export function lagrangePoints(mu: number): { name: string; x: number; y: number }[] {
  const fx = (x: number) => x - ((1 - mu) * (x + mu)) / Math.abs(x + mu) ** 3 - (mu * (x - 1 + mu)) / Math.abs(x - 1 + mu) ** 3
  const root = (lo: number, hi: number) => {
    let a = lo
    let b = hi
    let fa = fx(a)
    for (let i = 0; i < 200; i++) {
      const c = (a + b) / 2
      const fc = fx(c)
      if (fa * fc <= 0) b = c
      else { a = c; fa = fc }
    }
    return (a + b) / 2
  }
  const eps = 1e-6
  return [
    { name: 'L1', x: root(-mu + eps, 1 - mu - eps), y: 0 },
    { name: 'L2', x: root(1 - mu + eps, 2), y: 0 },
    { name: 'L3', x: root(-2, -mu - eps), y: 0 },
    { name: 'L4', x: 0.5 - mu, y: Math.sqrt(3) / 2 },
    { name: 'L5', x: 0.5 - mu, y: -Math.sqrt(3) / 2 },
  ]
}

/** Arenstorf's periodic orbit (mu = 0.012277471): initial state and period. */
export const ARENSTORF = { mu: 0.012277471, x: 0.994, y: 0, vx: 0, vy: -2.00158510637908252240537862224, period: 17.0652165601579625588917206249 }
