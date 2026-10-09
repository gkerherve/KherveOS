// Trusses, beams and frames (2-D): Euler–Bernoulli beam-column elements with axial and bending stiffness,
// distributed / point / thermal loads, hinges (moment releases), supports (fixed, pinned, roller, spring, settlement).
//
// Sign conventions of the results
//   joints      ux, uy (m) in the global axes, rz (rad) counter-clockwise
//   reactions   the forces the supports exert on the structure (+x right, +y up, moment counter-clockwise)
//   members     N tension positive, V shear positive when the left face goes up, M sagging positive (tension at the
//               bottom, the local y side is "up"); x runs from the start node to the end node
// Constraints are eliminated (not penalised); the loads of the members are the consistent (fixed-end) loads, so a
// beam with a uniform load is exact with one element.

import { SolveError, SingularError, solveSym, SparseSym, type SolveInfo } from './linalg.ts'
import { checkModel, materialOf, sectionOf, type LoadDir, type Member, type Model } from './model.ts'

export const G_DEFAULT = 9.80665

// ---------------------------------------------------------------------------- small helpers

const GX = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
const GW = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]

/** Gauss–Legendre, 4 points: exact for polynomials up to degree 7. */
export function gauss(f: (t: number) => number, a: number, b: number): number {
  if (b <= a) return 0
  const h = (b - a) / 2
  const m = (b + a) / 2
  let s = 0
  for (let i = 0; i < 4; i++) s += GW[i] * f(m + h * GX[i])
  return s * h
}

function inv2(a: number[][]): number[][] {
  const d = a[0][0] * a[1][1] - a[0][1] * a[1][0]
  return [[a[1][1] / d, -a[0][1] / d], [-a[1][0] / d, a[0][0] / d]]
}

// ---------------------------------------------------------------------------- element geometry and loads

export interface Geo {
  mem: Member
  i: number
  j: number
  L: number
  c: number
  s: number
  E: number
  A: number
  I: number
  Z: number
  h: number
  alpha: number
  rho: number
  /** moment released at the start / end */
  rel1: boolean
  rel2: boolean
}

export interface LocalLoads {
  /** distributed load pieces, local axes, N/m, over [ta, tb] */
  dist: Array<{ qx1: number; qx2: number; qy1: number; qy2: number; ta: number; tb: number }>
  /** point loads, local axes, N, at a */
  point: Array<{ px: number; py: number; a: number }>
  /** uniform temperature rise, K, and gradient (top − bottom), K */
  dT: number
  dTg: number
}

export function localStiffness(E: number, A: number, I: number, L: number): number[] {
  const ea = (E * A) / L
  const a = (12 * E * I) / L ** 3
  const b = (6 * E * I) / L ** 2
  const c = (4 * E * I) / L
  const d = (2 * E * I) / L
  return [
    ea, 0, 0, -ea, 0, 0,
    0, a, b, 0, -a, b,
    0, b, c, 0, -b, d,
    -ea, 0, 0, ea, 0, 0,
    0, -a, -b, 0, a, -b,
    0, b, d, 0, -b, c,
  ]
}

/** Local consistent mass matrix (Euler–Bernoulli beam with axial rod). */
export function localMass(rho: number, A: number, L: number): number[] {
  const m = rho * A * L
  const ax = m / 6
  const k = m / 420
  const L2 = L * L
  return [
    2 * ax, 0, 0, ax, 0, 0,
    0, 156 * k, 22 * L * k, 0, 54 * k, -13 * L * k,
    0, 22 * L * k, 4 * L2 * k, 0, 13 * L * k, -3 * L2 * k,
    ax, 0, 0, 2 * ax, 0, 0,
    0, 54 * k, 13 * L * k, 0, 156 * k, -22 * L * k,
    0, -13 * L * k, -3 * L2 * k, 0, -22 * L * k, 4 * L2 * k,
  ]
}

/** Geometric stiffness for an axial force N (tension positive). */
export function localGeometric(N: number, L: number): number[] {
  const k = N / (30 * L)
  const L2 = L * L
  return [
    0, 0, 0, 0, 0, 0,
    0, 36 * k, 3 * L * k, 0, -36 * k, 3 * L * k,
    0, 3 * L * k, 4 * L2 * k, 0, -3 * L * k, -L2 * k,
    0, 0, 0, 0, 0, 0,
    0, -36 * k, -3 * L * k, 0, 36 * k, -3 * L * k,
    0, 3 * L * k, -L2 * k, 0, -3 * L * k, 4 * L2 * k,
  ]
}

const hermite = (x: number, L: number): number[] => {
  const t = x / L
  return [1 - 3 * t * t + 2 * t ** 3, L * (t - 2 * t * t + t ** 3), 3 * t * t - 2 * t ** 3, L * (-t * t + t ** 3)]
}

export function geometry(model: Model): { geo: Geo[]; nodeIndex: Map<string, number> } {
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]))
  const truss = model.analysis === 'truss'
  const geo: Geo[] = []
  for (const mem of model.members) {
    const i = nodeIndex.get(mem.n1)
    const j = nodeIndex.get(mem.n2)
    const a = model.nodes[i ?? 0]
    const b = model.nodes[j ?? 0]
    const mat = materialOf(model, mem.material)
    const sec = sectionOf(model, mem.section)
    if (i === undefined || j === undefined || !mat || !sec) throw new SolveError(`Member ${mem.id} is incomplete (nodes, material or section missing).`, [mem.id])
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L < 1e-12) throw new SolveError(`Member ${mem.id} has zero length.`, [mem.id])
    geo.push({
      mem, i, j, L, c: (b.x - a.x) / L, s: (b.y - a.y) / L, E: mat.E, A: sec.A, I: sec.I > 0 ? sec.I : (sec.A * sec.A) / 12, Z: sec.Z, h: sec.h, alpha: mat.alpha, rho: mat.rho,
      rel1: truss || !!mem.releaseStart, rel2: truss || !!mem.releaseEnd,
    })
  }
  return { geo, nodeIndex }
}

const dirToLocal = (dir: LoadDir, v: number, c: number, s: number): [number, number] => {
  switch (dir) {
    case 'x': return [v * c, -v * s]
    case 'y': return [v * s, v * c]
    case 'lx': return [v, 0]
    default: return [0, v]
  }
}

export function localLoadsOf(model: Model, g: Geo): LocalLoads {
  const out: LocalLoads = { dist: [], point: [], dT: 0, dTg: 0 }
  for (const l of model.memberLoads) {
    if (l.member !== g.mem.id) continue
    if (l.type === 'dist') {
      const ta = Math.max(0, Math.min(g.L, l.a ?? 0))
      const tb = Math.max(ta, Math.min(g.L, l.b ?? g.L))
      if (tb <= ta) continue
      const [x1, y1] = dirToLocal(l.dir, l.w1, g.c, g.s)
      const [x2, y2] = dirToLocal(l.dir, l.w2, g.c, g.s)
      out.dist.push({ qx1: x1, qx2: x2, qy1: y1, qy2: y2, ta, tb })
    } else if (l.type === 'point') {
      const [px, py] = dirToLocal(l.dir, l.p, g.c, g.s)
      out.point.push({ px, py, a: Math.max(0, Math.min(g.L, l.a)) })
    } else {
      out.dT += l.dT
      out.dTg += l.dTg
    }
  }
  if (model.gravity > 0 && g.rho > 0) {
    const w = -g.rho * g.A * model.gravity
    const [qx, qy] = dirToLocal('y', w, g.c, g.s)
    out.dist.push({ qx1: qx, qx2: qx, qy1: qy, qy2: qy, ta: 0, tb: g.L })
  }
  return out
}

/** Consistent nodal loads (local, 6) of the member loads: the loads the nodes would have to carry. */
export function equivalentLoads(g: Geo, ll: LocalLoads): number[] {
  const f = [0, 0, 0, 0, 0, 0]
  const L = g.L
  for (const d of ll.dist) {
    const span = d.tb - d.ta
    const qx = (t: number) => d.qx1 + ((d.qx2 - d.qx1) * (t - d.ta)) / span
    const qy = (t: number) => d.qy1 + ((d.qy2 - d.qy1) * (t - d.ta)) / span
    f[0] += gauss((t) => qx(t) * (1 - t / L), d.ta, d.tb)
    f[3] += gauss((t) => (qx(t) * t) / L, d.ta, d.tb)
    for (let k = 0; k < 4; k++) {
      const idx = [1, 2, 4, 5][k]
      f[idx] += gauss((t) => qy(t) * hermite(t, L)[k], d.ta, d.tb)
    }
  }
  for (const p of ll.point) {
    f[0] += p.px * (1 - p.a / L)
    f[3] += (p.px * p.a) / L
    const n = hermite(p.a, L)
    f[1] += p.py * n[0]
    f[2] += p.py * n[1]
    f[4] += p.py * n[2]
    f[5] += p.py * n[3]
  }
  if (ll.dT) {
    const ea = g.E * g.A * g.alpha * ll.dT
    f[0] -= ea
    f[3] += ea
  }
  if (ll.dTg && g.h > 0) {
    const m = (g.E * g.I * g.alpha * ll.dTg) / g.h
    f[2] += m
    f[5] -= m
  }
  return f
}

/** Static condensation of released degrees of freedom (indices into the 6 local ones). */
function condense(k: number[], f: number[], rel: number[]): { k: number[]; f: number[]; krrInv: number[][] } {
  if (!rel.length) return { k: k.slice(), f: f.slice(), krrInv: [] }
  const krr = rel.map((a) => rel.map((b) => k[a * 6 + b]))
  const inv = rel.length === 1 ? [[1 / krr[0][0]]] : inv2(krr)
  const kc = k.slice()
  const fc = f.slice()
  for (let a = 0; a < 6; a++) {
    if (rel.includes(a)) continue
    for (let b = 0; b < 6; b++) {
      if (rel.includes(b)) continue
      let s = 0
      for (let p = 0; p < rel.length; p++) for (let q = 0; q < rel.length; q++) s += k[a * 6 + rel[p]] * inv[p][q] * k[rel[q] * 6 + b]
      kc[a * 6 + b] -= s
    }
    let sf = 0
    for (let p = 0; p < rel.length; p++) for (let q = 0; q < rel.length; q++) sf += k[a * 6 + rel[p]] * inv[p][q] * f[rel[q]]
    fc[a] -= sf
  }
  for (const r of rel) {
    fc[r] = 0
    for (let b = 0; b < 6; b++) { kc[r * 6 + b] = 0; kc[b * 6 + r] = 0 }
  }
  return { k: kc, f: fc, krrInv: inv }
}

/** The guyan reduction matrix T (6×6): u = T u_a, with the released degrees of freedom expressed by the others. */
export function releaseMap(k: number[], rel: number[], inv: number[][]): number[] {
  const T = new Array<number>(36).fill(0)
  for (let a = 0; a < 6; a++) if (!rel.includes(a)) T[a * 6 + a] = 1
  rel.forEach((r, p) => {
    for (let b = 0; b < 6; b++) {
      if (rel.includes(b)) continue
      let s = 0
      for (let q = 0; q < rel.length; q++) s -= inv[p][q] * k[rel[q] * 6 + b]
      T[r * 6 + b] = s
    }
  })
  return T
}

// ---------------------------------------------------------------------------- the system

export interface Elem {
  g: Geo
  /** local stiffness / equivalent loads before condensation */
  k: number[]
  eq: number[]
  /** after condensation, local */
  kc: number[]
  eqc: number[]
  rel: number[]
  krrInv: number[][]
  /** the six global degrees of freedom */
  dofs: number[]
  ll: LocalLoads
  /** global condensed stiffness (6×6) and equivalent loads (6) */
  kg: number[]
  eqg: number[]
}

export interface FrameSystem {
  model: Model
  geo: Geo[]
  elems: Elem[]
  nodeIndex: Map<string, number>
  n: number
  /** 1 where the global dof (3 per node) is held */
  fixed: Uint8Array
  /** which of them the user's supports hold (the others are held by the model: beam axial, pin joints) */
  userFixed: Uint8Array
  ubar: Float64Array
  spring: Float64Array
  /** free dof numbering, -1 for held dofs */
  freeIndex: Int32Array
  nFree: number
  notes: string[]
}

function rotate(k: number[], c: number, s: number): number[] {
  // kg = Tᵀ k T with T = blockdiag(R, R), R = [[c, s, 0], [-s, c, 0], [0, 0, 1]]
  const R = [c, s, 0, -s, c, 0, 0, 0, 1]
  const T = new Array<number>(36).fill(0)
  for (let b = 0; b < 2; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[(b * 3 + i) * 6 + b * 3 + j] = R[i * 3 + j]
  const kt = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let sum = 0; for (let m = 0; m < 6; m++) sum += k[i * 6 + m] * T[m * 6 + j]; kt[i * 6 + j] = sum }
  const out = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let sum = 0; for (let m = 0; m < 6; m++) sum += T[m * 6 + i] * kt[m * 6 + j]; out[i * 6 + j] = sum }
  return out
}

const toGlobalVec = (f: number[], c: number, s: number): number[] => [
  c * f[0] - s * f[1], s * f[0] + c * f[1], f[2], c * f[3] - s * f[4], s * f[3] + c * f[4], f[5],
]
export const toLocalVec = (f: ArrayLike<number>, c: number, s: number): number[] => [
  c * f[0] + s * f[1], -s * f[0] + c * f[1], f[2], c * f[3] + s * f[4], -s * f[3] + c * f[4], f[5],
]

export function buildSystem(model: Model): FrameSystem {
  const probs = checkModel(model).filter((p) => p.level === 'error')
  if (probs.length) throw new SolveError(probs[0].message, probs[0].ref ? [probs[0].ref] : [])
  const { geo, nodeIndex } = geometry(model)
  const n = model.nodes.length
  const fixed = new Uint8Array(3 * n)
  const userFixed = new Uint8Array(3 * n)
  const ubar = new Float64Array(3 * n)
  const spring = new Float64Array(3 * n)
  const notes: string[] = []
  for (const s of model.supports) {
    const i = nodeIndex.get(s.node)
    if (i === undefined) continue
    const set = (d: number, hold: boolean, k: number | undefined, pre: number | undefined) => {
      if (k && k > 0) { spring[3 * i + d] += k; return }
      if (hold) { fixed[3 * i + d] = 1; userFixed[3 * i + d] = 1; if (pre) ubar[3 * i + d] = pre }
    }
    set(0, s.ux, s.kx, s.dx)
    set(1, s.uy, s.ky, s.dy)
    set(2, s.rz, s.kr, s.drz)
  }
  if (model.analysis === 'beam') {
    for (const m of geo) if (Math.abs(m.s) > 1e-9) throw new SolveError(`Member ${m.mem.id} is not horizontal: a beam model must lie along the x axis (use the frame analysis for sloped members).`, [m.mem.id])
    for (let i = 0; i < n; i++) { if (!fixed[3 * i]) { fixed[3 * i] = 1 } }
  }
  // joints with no rotational stiffness (only bars / hinges meet there): the rotation is meaningless, hold it
  const hasRot = new Uint8Array(n)
  for (const g of geo) { if (!g.rel1) hasRot[g.i] = 1; if (!g.rel2) hasRot[g.j] = 1 }
  const used = new Uint8Array(n)
  for (const g of geo) { used[g.i] = 1; used[g.j] = 1 }
  for (let i = 0; i < n; i++) {
    if (!used[i]) { for (let d = 0; d < 3; d++) fixed[3 * i + d] = 1; continue }
    if (!hasRot[i] && !fixed[3 * i + 2] && !spring[3 * i + 2]) fixed[3 * i + 2] = 1
  }
  const freeIndex = new Int32Array(3 * n).fill(-1)
  let nFree = 0
  for (let d = 0; d < 3 * n; d++) if (!fixed[d]) freeIndex[d] = nFree++
  const elems: Elem[] = geo.map((g) => {
    const ll = localLoadsOf(model, g)
    const k = localStiffness(g.E, g.A, g.I, g.L)
    const eq = equivalentLoads(g, ll)
    const rel = [...(g.rel1 ? [2] : []), ...(g.rel2 ? [5] : [])]
    const cd = condense(k, eq, rel)
    return {
      g, k, eq, kc: cd.k, eqc: cd.f, rel, krrInv: cd.krrInv, ll,
      dofs: [3 * g.i, 3 * g.i + 1, 3 * g.i + 2, 3 * g.j, 3 * g.j + 1, 3 * g.j + 2],
      kg: rotate(cd.k, g.c, g.s), eqg: toGlobalVec(cd.f, g.c, g.s),
    }
  })
  return { model, geo, elems, nodeIndex, n, fixed, userFixed, ubar, spring, freeIndex, nFree, notes }
}

/** The stiffness of the free dofs (sparse) and the load vector (applied loads + member loads − prescribed displacements). */
export function assemble(sys: FrameSystem): { K: SparseSym; rhs: Float64Array; F: Float64Array } {
  const K = new SparseSym(sys.nFree)
  const rhs = new Float64Array(sys.nFree)
  const F = new Float64Array(3 * sys.n) // all applied loads, member loads included, in global dofs
  for (const l of sys.model.nodeLoads) {
    const i = sys.nodeIndex.get(l.node)
    if (i === undefined) continue
    F[3 * i] += l.fx; F[3 * i + 1] += l.fy; F[3 * i + 2] += l.mz
  }
  for (const e of sys.elems) for (let a = 0; a < 6; a++) F[e.dofs[a]] += e.eqg[a]
  for (const e of sys.elems) {
    for (let a = 0; a < 6; a++) {
      const fa = sys.freeIndex[e.dofs[a]]
      if (fa < 0) continue
      for (let b = 0; b < 6; b++) {
        const v = e.kg[a * 6 + b]
        if (v === 0) continue
        const fb = sys.freeIndex[e.dofs[b]]
        if (fb >= 0) K.add(fa, fb, v)
        else if (sys.ubar[e.dofs[b]]) rhs[fa] -= v * sys.ubar[e.dofs[b]]
      }
    }
  }
  for (let d = 0; d < 3 * sys.n; d++) {
    const f = sys.freeIndex[d]
    if (f < 0) continue
    if (sys.spring[d]) K.add(f, f, sys.spring[d])
    rhs[f] += F[d]
  }
  return { K, rhs, F }
}

// ---------------------------------------------------------------------------- results

export interface Station {
  x: number
  N: number
  V: number
  M: number
  /** local displacements along / across the member, m */
  u: number
  v: number
  /** the same in the global axes */
  dx: number
  dy: number
}

export interface MemberResult {
  id: string
  n1: string
  n2: string
  L: number
  /** direction of the member, rad from the global x axis */
  angle: number
  /** forces on the member from its nodes, local axes: [Fx1, Fy1, M1, Fx2, Fy2, M2] */
  ends: number[]
  N1: number
  N2: number
  V1: number
  V2: number
  M1: number
  M2: number
  maxN: number
  maxV: number
  maxM: number
  /** extreme fibre stress |N|/A + |M|/Z, Pa */
  maxStress: number
  /** yield strength of the material / that stress */
  safety: number
  stations: Station[]
}

export interface FrameResult {
  kind: 'frame'
  analysis: Model['analysis']
  /** 3 per node: ux, uy, rz */
  u: Float64Array
  nodeIds: string[]
  reactions: Array<{ node: string; rx: number; ry: number; mz: number }>
  members: MemberResult[]
  maxDisp: number
  maxDispAt: string
  maxStress: number
  maxStressMember: string
  safety: number
  equilibrium: { loads: [number, number, number]; reactions: [number, number, number]; error: number }
  solve: SolveInfo
  warnings: string[]
}

export function internalForcesAt(e: Elem, f: number[], x: number, right: boolean): { N: number; V: number; M: number } {
  let N = -f[0]
  let V = f[1]
  let M = -f[2] + f[1] * x
  for (const d of e.ll.dist) {
    const u = Math.min(x, d.tb)
    if (u <= d.ta) continue
    const span = d.tb - d.ta
    const qx = (t: number) => d.qx1 + ((d.qx2 - d.qx1) * (t - d.ta)) / span
    const qy = (t: number) => d.qy1 + ((d.qy2 - d.qy1) * (t - d.ta)) / span
    N -= gauss(qx, d.ta, u)
    V += gauss(qy, d.ta, u)
    M += gauss((t) => qy(t) * (x - t), d.ta, u)
  }
  for (const p of e.ll.point) {
    const on = right ? p.a <= x : p.a < x
    if (!on) continue
    N -= p.px
    V += p.py
    M += p.py * (x - p.a)
  }
  return { N, V, M }
}

function displacementAt(e: Elem, f: number[], ul: number[], x: number): { u: number; v: number } {
  const g = e.g
  const EI = g.E * g.I
  const EA = g.E * g.A
  let uu = ul[0]
  let vv = ul[1] + ul[2] * x
  let aux = -f[0] * x
  let bend = (-f[2] * x * x) / 2 + (f[1] * x ** 3) / 6
  for (const d of e.ll.dist) {
    const u = Math.min(x, d.tb)
    if (u <= d.ta) continue
    const span = d.tb - d.ta
    const qx = (t: number) => d.qx1 + ((d.qx2 - d.qx1) * (t - d.ta)) / span
    const qy = (t: number) => d.qy1 + ((d.qy2 - d.qy1) * (t - d.ta)) / span
    aux -= gauss((t) => qx(t) * (x - t), d.ta, u)
    bend += gauss((t) => (qy(t) * (x - t) ** 3) / 6, d.ta, u)
  }
  for (const p of e.ll.point) {
    if (p.a >= x) continue
    aux -= p.px * (x - p.a)
    bend += (p.py * (x - p.a) ** 3) / 6
  }
  uu += aux / EA + g.alpha * e.ll.dT * x
  vv += bend / EI
  if (e.ll.dTg && g.h > 0) vv += (-g.alpha * e.ll.dTg * x * x) / (2 * g.h)
  return { u: uu, v: vv }
}

export interface DiagramOptions { divisions?: number }

/** Internal forces and displacements along a member from its local displacements. */
export function memberDiagram(e: Elem, ul: number[], opts: DiagramOptions = {}): { ends: number[]; stations: Station[] } {
  const g = e.g
  const f = new Array<number>(6)
  for (let a = 0; a < 6; a++) { let s = 0; for (let b = 0; b < 6; b++) s += e.k[a * 6 + b] * ul[b]; f[a] = s - e.eq[a] }
  const n = Math.max(2, (opts.divisions ?? 24) | 0)
  const xs: Array<{ x: number; right: boolean }> = []
  for (let i = 0; i <= n; i++) xs.push({ x: (g.L * i) / n, right: i < n ? true : false })
  for (const p of e.ll.point) { xs.push({ x: p.a, right: false }, { x: p.a, right: true }) }
  for (const d of e.ll.dist) { xs.push({ x: d.ta, right: true }, { x: d.tb, right: false }) }
  xs.sort((a, b) => a.x - b.x || Number(a.right) - Number(b.right))
  // x = 0 takes the right-hand limit, x = L the left-hand one
  const clean: typeof xs = []
  for (const p of xs) {
    const q = { x: p.x, right: p.x <= 0 ? true : p.x >= g.L ? false : p.right }
    const prev = clean[clean.length - 1]
    if (prev && prev.x === q.x && prev.right === q.right) continue
    clean.push(q)
  }
  // zero crossings of the shear: the extreme bending moments
  const extra: typeof xs = []
  for (let k = 0; k + 1 < clean.length; k++) {
    const a = clean[k]
    const b = clean[k + 1]
    if (b.x - a.x < 1e-12 * g.L) continue
    const va = internalForcesAt(e, f, a.x, a.right).V
    const vb = internalForcesAt(e, f, b.x, b.right).V
    if (va * vb < 0) {
      let lo = a.x
      let hi = b.x
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2
        const vm = internalForcesAt(e, f, mid, true).V
        if (vm * va > 0) lo = mid; else hi = mid
      }
      extra.push({ x: (lo + hi) / 2, right: true })
    }
  }
  const all = [...clean, ...extra].sort((a, b) => a.x - b.x || Number(a.right) - Number(b.right))
  const stations: Station[] = all.map(({ x, right }) => {
    const q = internalForcesAt(e, f, x, right)
    const d = displacementAt(e, f, ul, x)
    return { x, N: q.N, V: q.V, M: q.M, u: d.u, v: d.v, dx: g.c * d.u - g.s * d.v, dy: g.s * d.u + g.c * d.v }
  })
  return { ends: f, stations }
}

function mechanismMessage(sys: FrameSystem, mode: Float64Array): SolveError {
  // the mode is in the numbering of the free dofs: find which node / direction moves most
  const lref = Math.max(1e-9, sys.geo.reduce((s, g) => s + g.L, 0) / Math.max(1, sys.geo.length))
  const scored: Array<{ node: number; dir: number; v: number }> = []
  for (let d = 0; d < 3 * sys.n; d++) {
    const f = sys.freeIndex[d]
    if (f < 0) continue
    const v = Math.abs(mode[f]) * (d % 3 === 2 ? lref : 1)
    scored.push({ node: Math.floor(d / 3), dir: d % 3, v })
  }
  scored.sort((a, b) => b.v - a.v)
  const top = scored[0]
  if (!top || top.v === 0) return new SolveError('The structure is a mechanism (it can move without deforming). Add supports or members.')
  const maxv = top.v
  const nodes: string[] = []
  const words: string[] = []
  const seen = new Set<number>()
  for (const s of scored) {
    if (s.v < 0.2 * maxv) break
    if (seen.has(s.node)) continue
    seen.add(s.node)
    nodes.push(sys.model.nodes[s.node].id)
    words.push(`node ${sys.model.nodes[s.node].id} can ${s.dir === 2 ? 'rotate' : `move in ${s.dir === 0 ? 'x' : 'y'}`}`)
    if (nodes.length >= 4) break
  }
  const hint = sys.model.analysis === 'truss'
    ? ' Add a bar (a triangle is rigid) or a support there.'
    : ' Add a member, a support, or fix the rotation there.'
  return new SolveError(`The structure is a mechanism: ${words.join('; ')}.${hint}`, nodes)
}

/** Parts of the structure that no support holds, in plain language (before solving). */
export function floatingParts(model: Model): string[][] {
  const parent = new Map<string, string>(model.nodes.map((n) => [n.id, n.id]))
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r }
  for (const m of model.members) if (parent.has(m.n1) && parent.has(m.n2)) parent.set(find(m.n1), find(m.n2))
  const held = new Set(model.supports.filter((s) => s.ux || s.uy || s.rz || s.kx || s.ky || s.kr).map((s) => find(s.node)))
  const groups = new Map<string, string[]>()
  for (const n of model.nodes) {
    const r = find(n.id)
    if (held.has(r)) continue
    groups.set(r, [...(groups.get(r) ?? []), n.id])
  }
  return [...groups.values()]
}

export function solveFrame(model: Model, opts: { divisions?: number; method?: 'auto' | 'cholesky' | 'pcg' } = {}): FrameResult {
  const sys = buildSystem(model)
  const floating = floatingParts(model).filter((g) => g.some((id) => model.members.some((m) => m.n1 === id || m.n2 === id)))
  if (floating.length) {
    throw new SolveError(`Part of the structure is not connected to any support (nodes ${floating[0].slice(0, 6).join(', ')}${floating[0].length > 6 ? '…' : ''}). Join it to a support or add one.`, floating[0])
  }
  const { K, rhs, F } = assemble(sys)
  let x: Float64Array
  let info: SolveInfo
  try {
    const r = solveSym(K, rhs, opts.method ?? 'auto')
    x = r.x
    info = r.info
  } catch (e) {
    if (e instanceof SingularError) throw mechanismMessage(sys, e.mode)
    throw e
  }
  const warnings: string[] = []
  if (info.method === 'cholesky' && info.cond > 1e14) warnings.push(`The model is badly conditioned (about ${info.cond.toExponential(0)}): very stiff and very flexible parts together. Check the units and the members that are almost mechanisms.`)
  if (info.residual > 1e-8) warnings.push(`The equilibrium residual is ${info.residual.toExponential(1)}: the result may be inaccurate.`)
  const u = new Float64Array(3 * sys.n)
  for (let d = 0; d < 3 * sys.n; d++) u[d] = sys.freeIndex[d] >= 0 ? x[sys.freeIndex[d]] : sys.ubar[d]
  // members
  const members: MemberResult[] = []
  const nodal = new Float64Array(3 * sys.n) // forces the members exert on the nodes, summed
  let maxStress = 0
  let maxStressMember = ''
  let maxDisp = 0
  let maxDispAt = ''
  for (let i = 0; i < sys.n; i++) {
    const d = Math.hypot(u[3 * i], u[3 * i + 1])
    if (d > maxDisp) { maxDisp = d; maxDispAt = `node ${model.nodes[i].id}` }
  }
  for (const e of sys.elems) {
    const g = e.g
    const ug = e.dofs.map((d) => u[d])
    const ul = toLocalVec(ug, g.c, g.s)
    // released rotations from the condensed equations
    if (e.rel.length) {
      const rhsR = e.rel.map((r) => {
        let s = e.eq[r]
        for (let b = 0; b < 6; b++) if (!e.rel.includes(b)) s -= e.k[r * 6 + b] * ul[b]
        return s
      })
      e.rel.forEach((r, p) => {
        let s = 0
        for (let q = 0; q < e.rel.length; q++) s += e.krrInv[p][q] * rhsR[q]
        ul[r] = s
      })
    }
    const dg = memberDiagram(e, ul, { divisions: opts.divisions })
    // nodal forces of this member (global): kg·u − eq
    const fg = toGlobalVec(dg.ends, g.c, g.s)
    for (let a = 0; a < 6; a++) nodal[e.dofs[a]] += fg[a] + e.eqg[a]
    const st = dg.stations
    const A = g.A
    let maxN = 0, maxV = 0, maxM = 0, sig = 0
    for (const s of st) {
      maxN = Math.max(maxN, Math.abs(s.N)); maxV = Math.max(maxV, Math.abs(s.V)); maxM = Math.max(maxM, Math.abs(s.M))
      const sg = Math.abs(s.N) / A + (g.Z > 0 ? Math.abs(s.M) / g.Z : 0)
      if (sg > sig) sig = sg
      const total = Math.hypot(s.dx, s.dy)
      if (total > maxDisp) { maxDisp = total; maxDispAt = `member ${g.mem.id}, ${(s.x / g.L * 100).toFixed(0)} % along` }
    }
    const sy = materialOf(model, g.mem.material)?.sy ?? Infinity
    if (sig > maxStress) { maxStress = sig; maxStressMember = g.mem.id }
    members.push({
      id: g.mem.id, n1: g.mem.n1, n2: g.mem.n2, L: g.L, angle: Math.atan2(g.s, g.c), ends: dg.ends,
      N1: -dg.ends[0], N2: dg.ends[3], V1: dg.ends[1], V2: -dg.ends[4], M1: -dg.ends[2], M2: dg.ends[5],
      maxN, maxV, maxM, maxStress: sig, safety: sig > 0 ? sy / sig : Infinity, stations: st,
    })
  }
  // reactions: R = member forces on the nodes − applied loads, at the held dofs (and the springs)
  const reactions: FrameResult['reactions'] = []
  const sumR: [number, number, number] = [0, 0, 0]
  const R = new Float64Array(3 * sys.n)
  for (let d = 0; d < 3 * sys.n; d++) {
    if (sys.fixed[d]) {
      // the members push the node with k·u; the loads F (nodal + equivalent member loads) and the reaction balance it
      R[d] = nodal[d] - F[d]
    } else if (sys.spring[d]) R[d] = -sys.spring[d] * u[d]
  }
  for (let i = 0; i < sys.n; i++) {
    const hasSupport = model.supports.some((s) => s.node === model.nodes[i].id)
    if (!hasSupport && !R[3 * i] && !R[3 * i + 1] && !R[3 * i + 2]) continue
    const node = model.nodes[i]
    const r = { node: node.id, rx: R[3 * i], ry: R[3 * i + 1], mz: R[3 * i + 2] }
    if (!hasSupport && Math.abs(r.rx) + Math.abs(r.ry) + Math.abs(r.mz) < 1e-9) continue
    reactions.push(r)
    sumR[0] += r.rx; sumR[1] += r.ry; sumR[2] += r.mz + node.x * r.ry - node.y * r.rx
  }
  const sumL: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < sys.n; i++) {
    const node = model.nodes[i]
    sumL[0] += F[3 * i]; sumL[1] += F[3 * i + 1]; sumL[2] += F[3 * i + 2] + node.x * F[3 * i + 1] - node.y * F[3 * i]
  }
  const scale = Math.max(1e-300, Math.abs(sumL[0]), Math.abs(sumL[1]), Math.abs(sumL[2]) / Math.max(1e-9, sys.geo.reduce((s, g) => s + g.L, 0)), ...F.map(Math.abs))
  const error = Math.max(Math.abs(sumL[0] + sumR[0]), Math.abs(sumL[1] + sumR[1]), Math.abs(sumL[2] + sumR[2]) / Math.max(1e-9, sys.geo.reduce((s, g) => s + g.L, 0))) / scale
  if (error > 1e-6) warnings.push(`The reactions do not balance the loads (relative error ${error.toExponential(1)}).`)
  let safety = Infinity
  for (const m of members) safety = Math.min(safety, m.safety)
  return {
    kind: 'frame', analysis: model.analysis, u, nodeIds: model.nodes.map((n) => n.id), reactions, members, maxDisp, maxDispAt, maxStress, maxStressMember, safety,
    equilibrium: { loads: sumL, reactions: sumR, error }, solve: info, warnings,
  }
}

