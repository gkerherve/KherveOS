// Plane stress and plane strain: the constant-strain triangle (CST) and the bilinear quadrilateral Q4 with
// incompatible modes (Wilson–Taylor, "Q6": no shear locking in bending, passes the patch test on distorted
// quadrilaterals). Loads: point forces, edge tractions / pressure / total force, gravity, uniform temperature.
// Supports remove degrees of freedom (elimination), settlements are prescribed displacements.
//
// Stress results: per element (at the centroid) and nodal values (the average of the elements around a node; for the
// Q4 the Gauss-point stresses are extrapolated to the corners first).

import { SingularError, SolveError, solveSym, SparseSym, type SolveInfo } from './linalg.ts'
import { checkModel, materialOf, type Model } from './model.ts'
import { meshPlate, targetNodes, targetSegments, type BSeg, type Mesh } from './mesh.ts'

export interface PlaneProblem {
  mesh: Mesh
  E: number
  nu: number
  /** thickness, m */
  t: number
  planeStrain: boolean
  rho?: number
  /** gravity, m/s² (downward) */
  gravity?: number
  /** thermal expansion, 1/K, and the temperature rise */
  alpha?: number
  dT?: number
  /** held displacements: node → value */
  fixedX: Map<number, number>
  fixedY: Map<number, number>
  /** nodal forces (2 per node), N */
  forces?: Float64Array
  /** tractions on boundary segments, Pa (force per area of the plate edge) */
  tractions?: Array<{ seg: BSeg; tx: number; ty: number }>
  yield?: number
}

export interface StressSet {
  sx: Float64Array
  sy: Float64Array
  txy: Float64Array
  sz: Float64Array
}

export interface PlaneResult {
  kind: 'plane'
  analysis: 'plane-stress' | 'plane-strain'
  mesh: Mesh
  u: Float64Array
  reactions: Float64Array
  elem: StressSet
  nodal: StressSet
  /** elastic strain energy density of every element (Pa), at the centroid */
  elemEnergy: Float64Array
  /** the same averaged to the nodes */
  nodalEnergy: Float64Array
  /** ½ uᵀ K u, J */
  strainEnergy: number
  /** ½ F·u over the free dofs: the compliance work, J */
  work: number
  planeStrain: boolean
  yield: number
  maxDisp: number
  maxVm: number
  safety: number
  equilibrium: { loads: [number, number]; reactions: [number, number]; error: number }
  solve: SolveInfo
  warnings: string[]
}

// ---------------------------------------------------------------------------- constitutive

export function dMatrix(E: number, nu: number, planeStrain: boolean): number[] {
  if (planeStrain) {
    const c = E / ((1 + nu) * (1 - 2 * nu))
    return [c * (1 - nu), c * nu, 0, c * nu, c * (1 - nu), 0, 0, 0, (c * (1 - 2 * nu)) / 2]
  }
  const c = E / (1 - nu * nu)
  return [c, c * nu, 0, c * nu, c, 0, 0, 0, (c * (1 - nu)) / 2]
}

const mulVec3 = (D: number[], v: number[]): number[] => [
  D[0] * v[0] + D[1] * v[1] + D[2] * v[2], D[3] * v[0] + D[4] * v[1] + D[5] * v[2], D[6] * v[0] + D[7] * v[1] + D[8] * v[2],
]

function invSmall(a: number[], n: number): number[] {
  // Gauss–Jordan inverse of an n×n matrix (n ≤ 4)
  const m = a.slice()
  const inv = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n; i++) inv[i * n + i] = 1
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r * n + c]) > Math.abs(m[p * n + c])) p = r
    if (Math.abs(m[p * n + c]) < 1e-300) throw new SolveError('A quadrilateral element is degenerate (zero or negative area). Mesh again with a smaller size.')
    if (p !== c) for (let k = 0; k < n; k++) { [m[c * n + k], m[p * n + k]] = [m[p * n + k], m[c * n + k]]; [inv[c * n + k], inv[p * n + k]] = [inv[p * n + k], inv[c * n + k]] }
    const d = m[c * n + c]
    for (let k = 0; k < n; k++) { m[c * n + k] /= d; inv[c * n + k] /= d }
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r * n + c]
      if (!f) continue
      for (let k = 0; k < n; k++) { m[r * n + k] -= f * m[c * n + k]; inv[r * n + k] -= f * inv[c * n + k] }
    }
  }
  return inv
}

// ---------------------------------------------------------------------------- the elements

const G = 1 / Math.sqrt(3)
const GP: Array<[number, number]> = [[-G, -G], [G, -G], [G, G], [-G, G]]
const XI = [-1, 1, 1, -1]
const ETA = [-1, -1, 1, 1]

interface ElementOut {
  /** stiffness (6×6 or 8×8) */
  ke: number[]
  /** equivalent nodal loads (gravity, thermal) */
  fe: number[]
  area: number
  /** Q4: α = H u (4×8) */
  H?: number[]
}

function cstGeometry(x: number[], y: number[]) {
  const b = [y[1] - y[2], y[2] - y[0], y[0] - y[1]]
  const c = [x[2] - x[1], x[0] - x[2], x[1] - x[0]]
  const A = 0.5 * (x[0] * b[0] + x[1] * b[1] + x[2] * b[2])
  return { b, c, A }
}

export function cstElement(x: number[], y: number[], D: number[], t: number, bodyY: number, eth: number[]): ElementOut {
  const { b, c, A } = cstGeometry(x, y)
  if (!(A > 0)) throw new SolveError('A triangle has zero or negative area. Mesh again.')
  const B = new Array<number>(18).fill(0)
  for (let i = 0; i < 3; i++) {
    B[2 * i] = b[i] / (2 * A)
    B[6 + 2 * i + 1] = c[i] / (2 * A)
    B[12 + 2 * i] = c[i] / (2 * A)
    B[12 + 2 * i + 1] = b[i] / (2 * A)
  }
  const DB = new Array<number>(18).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) DB[i * 6 + j] = D[i * 3] * B[j] + D[i * 3 + 1] * B[6 + j] + D[i * 3 + 2] * B[12 + j]
  const ke = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) ke[i * 6 + j] = (B[i] * DB[j] + B[6 + i] * DB[6 + j] + B[12 + i] * DB[12 + j]) * t * A
  const fe = new Array<number>(6).fill(0)
  const s = mulVec3(D, eth)
  for (let i = 0; i < 6; i++) fe[i] = (B[i] * s[0] + B[6 + i] * s[1] + B[12 + i] * s[2]) * t * A
  for (let i = 0; i < 3; i++) fe[2 * i + 1] += (bodyY * t * A) / 3
  return { ke, fe, area: A }
}

function q4Matrices(x: number[], y: number[], xi: number, eta: number) {
  const dNxi = XI.map((s, i) => (s * (1 + ETA[i] * eta)) / 4)
  const dNeta = ETA.map((s, i) => (s * (1 + XI[i] * xi)) / 4)
  let xx = 0, yx = 0, xe = 0, ye = 0
  for (let i = 0; i < 4; i++) { xx += dNxi[i] * x[i]; yx += dNxi[i] * y[i]; xe += dNeta[i] * x[i]; ye += dNeta[i] * y[i] }
  const det = xx * ye - yx * xe
  return { dNxi, dNeta, xx, yx, xe, ye, det }
}

export function q4Element(x: number[], y: number[], D: number[], t: number, bodyY: number, eth: number[]): ElementOut {
  const c0 = q4Matrices(x, y, 0, 0)
  if (!(c0.det > 0)) throw new SolveError('A quadrilateral has zero or negative area (it is inverted or too distorted). Mesh again.')
  const Kuu = new Array<number>(64).fill(0)
  const Kua = new Array<number>(32).fill(0)
  const Kaa = new Array<number>(16).fill(0)
  const fu = new Array<number>(8).fill(0)
  const fa = new Array<number>(4).fill(0)
  let area = 0
  const s = mulVec3(D, eth)
  for (const [xi, eta] of GP) {
    const m = q4Matrices(x, y, xi, eta)
    if (!(m.det > 0)) throw new SolveError('A quadrilateral is inverted or too distorted. Mesh again with a smaller size.')
    const B = new Array<number>(24).fill(0)
    for (let i = 0; i < 4; i++) {
      const nx = (m.ye * m.dNxi[i] - m.yx * m.dNeta[i]) / m.det
      const ny = (-m.xe * m.dNxi[i] + m.xx * m.dNeta[i]) / m.det
      B[2 * i] = nx; B[8 + 2 * i + 1] = ny; B[16 + 2 * i] = ny; B[16 + 2 * i + 1] = nx
    }
    // incompatible modes: gradients at the centre, scaled by det0 / det
    const gx1 = (c0.ye * -2 * xi) / c0.det
    const gy1 = (-c0.xe * -2 * xi) / c0.det
    const gx2 = (-c0.yx * -2 * eta) / c0.det
    const gy2 = (c0.xx * -2 * eta) / c0.det
    const sc = c0.det / m.det
    const Gm = [
      gx1 * sc, gx2 * sc, 0, 0,
      0, 0, gy1 * sc, gy2 * sc,
      gy1 * sc, gy2 * sc, gx1 * sc, gx2 * sc,
    ]
    const w = m.det * t // the Gauss weights are 1
    area += m.det
    const DB = new Array<number>(24).fill(0)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) DB[i * 8 + j] = D[i * 3] * B[j] + D[i * 3 + 1] * B[8 + j] + D[i * 3 + 2] * B[16 + j]
    const DG = new Array<number>(12).fill(0)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) DG[i * 4 + j] = D[i * 3] * Gm[j] + D[i * 3 + 1] * Gm[4 + j] + D[i * 3 + 2] * Gm[8 + j]
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) Kuu[i * 8 + j] += (B[i] * DB[j] + B[8 + i] * DB[8 + j] + B[16 + i] * DB[16 + j]) * w
      for (let j = 0; j < 4; j++) Kua[i * 4 + j] += (B[i] * DG[j] + B[8 + i] * DG[4 + j] + B[16 + i] * DG[8 + j]) * w
      fu[i] += (B[i] * s[0] + B[8 + i] * s[1] + B[16 + i] * s[2]) * w
    }
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) Kaa[i * 4 + j] += (Gm[i] * DG[j] + Gm[4 + i] * DG[4 + j] + Gm[8 + i] * DG[8 + j]) * w
      fa[i] += (Gm[i] * s[0] + Gm[4 + i] * s[1] + Gm[8 + i] * s[2]) * w
    }
    const Nv = XI.map((a, i) => ((1 + a * xi) * (1 + ETA[i] * eta)) / 4)
    for (let i = 0; i < 4; i++) fu[2 * i + 1] += Nv[i] * bodyY * w
  }
  const Kaai = invSmall(Kaa, 4)
  // H = −Kaa⁻¹ Kauᵀ  (4×8); ke = Kuu − Kua Kaa⁻¹ Kau = Kuu + Kua H
  const H = new Array<number>(32).fill(0)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) { let sum = 0; for (let k = 0; k < 4; k++) sum += Kaai[i * 4 + k] * Kua[j * 4 + k]; H[i * 8 + j] = -sum }
  const ke = Kuu.slice()
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { let sum = 0; for (let k = 0; k < 4; k++) sum += Kua[i * 4 + k] * H[k * 8 + j]; ke[i * 8 + j] += sum }
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const m = 0.5 * (ke[i * 8 + j] + ke[j * 8 + i]); ke[i * 8 + j] = m; ke[j * 8 + i] = m }
  // load condensation: fu − Kua Kaa⁻¹ fa
  const fe = fu.slice()
  for (let i = 0; i < 8; i++) { let sum = 0; for (let k = 0; k < 4; k++) { let kf = 0; for (let l = 0; l < 4; l++) kf += Kaai[k * 4 + l] * fa[l]; sum += Kua[i * 4 + k] * kf } fe[i] -= sum }
  return { ke, fe, area, H }
}

/** Stress (σx, σy, τxy) and elastic strain at a point of a Q4 from its nodal displacements and incompatible modes. */
function q4Strain(x: number[], y: number[], ue: number[], alpha: number[], xi: number, eta: number): number[] {
  const m = q4Matrices(x, y, xi, eta)
  const c0 = q4Matrices(x, y, 0, 0)
  let ex = 0, ey = 0, g = 0
  for (let i = 0; i < 4; i++) {
    const nx = (m.ye * m.dNxi[i] - m.yx * m.dNeta[i]) / m.det
    const ny = (-m.xe * m.dNxi[i] + m.xx * m.dNeta[i]) / m.det
    ex += nx * ue[2 * i]; ey += ny * ue[2 * i + 1]; g += ny * ue[2 * i] + nx * ue[2 * i + 1]
  }
  const sc = c0.det / m.det
  const gx1 = ((c0.ye * -2 * xi) / c0.det) * sc
  const gy1 = ((-c0.xe * -2 * xi) / c0.det) * sc
  const gx2 = ((-c0.yx * -2 * eta) / c0.det) * sc
  const gy2 = ((c0.xx * -2 * eta) / c0.det) * sc
  ex += gx1 * alpha[0] + gx2 * alpha[1]
  ey += gy1 * alpha[2] + gy2 * alpha[3]
  g += gy1 * alpha[0] + gy2 * alpha[1] + gx1 * alpha[2] + gx2 * alpha[3]
  return [ex, ey, g]
}

// ---------------------------------------------------------------------------- derived stress quantities

export interface Derived { vm: number; p1: number; p2: number; angle: number; tmax: number }

export function derivedStress(sx: number, sy: number, txy: number, sz: number): Derived {
  const c = (sx + sy) / 2
  const r = Math.hypot((sx - sy) / 2, txy)
  const vm = Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * txy * txy)
  return { vm, p1: c + r, p2: c - r, angle: 0.5 * Math.atan2(2 * txy, sx - sy), tmax: r }
}

// ---------------------------------------------------------------------------- solving

export function solveProblem(p: PlaneProblem): PlaneResult {
  const { mesh } = p
  const n = mesh.nNodes
  const D = dMatrix(p.E, p.nu, p.planeStrain)
  const body = -(p.rho ?? 0) * (p.gravity ?? 0)
  const dT = p.dT ?? 0
  const a = (p.alpha ?? 0) * dT
  const eth = p.planeStrain ? [(1 + p.nu) * a, (1 + p.nu) * a, 0] : [a, a, 0]
  const s = mesh.stride
  const ne = mesh.nElems
  const fixed = new Uint8Array(2 * n)
  const ubar = new Float64Array(2 * n)
  for (const [node, v] of p.fixedX) { fixed[2 * node] = 1; ubar[2 * node] = v }
  for (const [node, v] of p.fixedY) { fixed[2 * node + 1] = 1; ubar[2 * node + 1] = v }
  const freeIndex = new Int32Array(2 * n).fill(-1)
  let nFree = 0
  for (let d = 0; d < 2 * n; d++) if (!fixed[d]) freeIndex[d] = nFree++
  if (nFree === 0) throw new SolveError('Every degree of freedom of the plate is held: there is nothing to solve.')
  const F = new Float64Array(2 * n)
  if (p.forces) for (let i = 0; i < 2 * n; i++) F[i] += p.forces[i]
  for (const tr of p.tractions ?? []) {
    const { a: na, b: nb } = tr.seg
    const l = Math.hypot(mesh.xy[2 * nb] - mesh.xy[2 * na], mesh.xy[2 * nb + 1] - mesh.xy[2 * na + 1])
    const f = 0.5 * l * p.t
    F[2 * na] += f * tr.tx; F[2 * na + 1] += f * tr.ty
    F[2 * nb] += f * tr.tx; F[2 * nb + 1] += f * tr.ty
  }
  const K = new SparseSym(nFree)
  const rhs = new Float64Array(nFree)
  const kes: Float64Array = new Float64Array(ne * (2 * s) * (2 * s))
  const Hs: Float64Array | null = s === 4 ? new Float64Array(ne * 32) : null
  const dofsOf = (e: number): number[] => {
    const d: number[] = []
    for (let k = 0; k < s; k++) { const nd = mesh.conn[s * e + k]; d.push(2 * nd, 2 * nd + 1) }
    return d
  }
  const FE = new Float64Array(2 * n) // equivalent loads of the elements
  for (let e = 0; e < ne; e++) {
    const xs: number[] = [], ys: number[] = []
    for (let k = 0; k < s; k++) { const nd = mesh.conn[s * e + k]; xs.push(mesh.xy[2 * nd]); ys.push(mesh.xy[2 * nd + 1]) }
    const el = s === 3 ? cstElement(xs, ys, D, p.t, body, eth) : q4Element(xs, ys, D, p.t, body, eth)
    kes.set(el.ke, e * (2 * s) * (2 * s))
    if (Hs && el.H) Hs.set(el.H, e * 32)
    const dofs = dofsOf(e)
    const m = 2 * s
    for (let i = 0; i < m; i++) {
      FE[dofs[i]] += el.fe[i]
      const fi = freeIndex[dofs[i]]
      if (fi < 0) continue
      for (let j = 0; j < m; j++) {
        const v = el.ke[i * m + j]
        const fj = freeIndex[dofs[j]]
        if (fj >= 0) K.add(fi, fj, v)
        else if (ubar[dofs[j]]) rhs[fi] -= v * ubar[dofs[j]]
      }
    }
  }
  for (let d = 0; d < 2 * n; d++) {
    F[d] += FE[d]
    if (freeIndex[d] >= 0) rhs[freeIndex[d]] += F[d]
  }
  let x: Float64Array
  let info: SolveInfo
  try {
    const r = solveSym(K, rhs)
    x = r.x
    info = r.info
  } catch (err) {
    if (err instanceof SingularError) {
      let best = 0, bi = 0
      for (let d = 0; d < 2 * n; d++) if (freeIndex[d] >= 0 && Math.abs(err.mode[freeIndex[d]]) > best) { best = Math.abs(err.mode[freeIndex[d]]); bi = d }
      const node = Math.floor(bi / 2)
      throw new SolveError(`The plate is not held enough: it can move or rotate freely (for example near the point (${mesh.xy[2 * node].toPrecision(3)}, ${mesh.xy[2 * node + 1].toPrecision(3)}) in ${bi % 2 ? 'y' : 'x'}). Add supports so that it cannot slide or turn (two supports along different directions, or a fixed edge).`)
    }
    throw err
  }
  const warnings: string[] = []
  if (info.method === 'cholesky' && info.cond > 1e14) warnings.push('The model is badly conditioned: check the units and the supports.')
  const u = new Float64Array(2 * n)
  for (let d = 0; d < 2 * n; d++) u[d] = freeIndex[d] >= 0 ? x[freeIndex[d]] : ubar[d]
  // element forces → reactions, stresses
  const KU = new Float64Array(2 * n)
  const elem: StressSet = { sx: new Float64Array(ne), sy: new Float64Array(ne), txy: new Float64Array(ne), sz: new Float64Array(ne) }
  const energy = new Float64Array(ne)
  const nodal: StressSet = { sx: new Float64Array(n), sy: new Float64Array(n), txy: new Float64Array(n), sz: new Float64Array(n) }
  const weight = new Float64Array(n)
  const nodalEnergy = new Float64Array(n)
  let U = 0
  const stress = (eps: number[]): number[] => {
    const el = [eps[0] - eth[0], eps[1] - eth[1], eps[2]]
    const sg = mulVec3(D, el)
    const sz = p.planeStrain ? p.nu * (sg[0] + sg[1]) - p.E * (p.alpha ?? 0) * dT : 0
    return [sg[0], sg[1], sg[2], sz, 0.5 * (sg[0] * el[0] + sg[1] * el[1] + sg[2] * el[2])]
  }
  for (let e = 0; e < ne; e++) {
    const dofs = dofsOf(e)
    const m = 2 * s
    const ue = dofs.map((d) => u[d])
    const ke = kes.subarray(e * m * m, (e + 1) * m * m)
    let ee = 0
    for (let i = 0; i < m; i++) {
      let f = 0
      for (let j = 0; j < m; j++) f += ke[i * m + j] * ue[j]
      KU[dofs[i]] += f
      ee += f * ue[i]
    }
    U += 0.5 * ee
    const xs: number[] = [], ys: number[] = []
    for (let k = 0; k < s; k++) { const nd = mesh.conn[s * e + k]; xs.push(mesh.xy[2 * nd]); ys.push(mesh.xy[2 * nd + 1]) }
    if (s === 3) {
      const { b, c, A } = cstGeometry(xs, ys)
      let ex = 0, ey = 0, g = 0
      for (let i = 0; i < 3; i++) { ex += (b[i] * ue[2 * i]) / (2 * A); ey += (c[i] * ue[2 * i + 1]) / (2 * A); g += (c[i] * ue[2 * i] + b[i] * ue[2 * i + 1]) / (2 * A) }
      const st = stress([ex, ey, g])
      elem.sx[e] = st[0]; elem.sy[e] = st[1]; elem.txy[e] = st[2]; elem.sz[e] = st[3]; energy[e] = st[4]
      for (let k = 0; k < 3; k++) {
        const nd = mesh.conn[3 * e + k]
        nodal.sx[nd] += st[0] * A; nodal.sy[nd] += st[1] * A; nodal.txy[nd] += st[2] * A; nodal.sz[nd] += st[3] * A; nodalEnergy[nd] += st[4] * A; weight[nd] += A
      }
    } else {
      const H = Hs!.subarray(e * 32, (e + 1) * 32)
      const alpha = [0, 0, 0, 0]
      for (let i = 0; i < 4; i++) { let sum = 0; for (let j = 0; j < 8; j++) sum += H[i * 8 + j] * ue[j]; alpha[i] = sum }
      const centre = stress(q4Strain(xs, ys, ue, alpha, 0, 0))
      elem.sx[e] = centre[0]; elem.sy[e] = centre[1]; elem.txy[e] = centre[2]; elem.sz[e] = centre[3]; energy[e] = centre[4]
      // Gauss-point stresses extrapolated to the corners (bilinear in the Gauss points)
      const gs = GP.map(([xi, eta]) => stress(q4Strain(xs, ys, ue, alpha, xi, eta)))
      const area = Math.abs(q4Matrices(xs, ys, 0, 0).det) * 4
      for (let k = 0; k < 4; k++) {
        // the corner (XI[k], ETA[k]) seen from the Gauss grid: local coordinates XI/G, ETA/G
        const r = XI[k] / G
        const t2 = ETA[k] / G
        const val = [0, 0, 0, 0]
        for (let q = 0; q < 4; q++) {
          const w = ((1 + XI[q] * r) * (1 + ETA[q] * t2)) / 4
          for (let c = 0; c < 4; c++) val[c] += w * gs[q][c]
        }
        const nd = mesh.conn[4 * e + k]
        nodal.sx[nd] += val[0] * area; nodal.sy[nd] += val[1] * area; nodal.txy[nd] += val[2] * area; nodal.sz[nd] += val[3] * area; nodalEnergy[nd] += centre[4] * area; weight[nd] += area
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!weight[i]) continue
    nodal.sx[i] /= weight[i]; nodal.sy[i] /= weight[i]; nodal.txy[i] /= weight[i]; nodal.sz[i] /= weight[i]; nodalEnergy[i] /= weight[i]
  }
  const reactions = new Float64Array(2 * n)
  const sumR: [number, number] = [0, 0]
  const sumL: [number, number] = [0, 0]
  let work = 0
  for (let d = 0; d < 2 * n; d++) {
    if (fixed[d]) { reactions[d] = KU[d] - F[d]; sumR[d % 2] += reactions[d] } else work += 0.5 * F[d] * u[d]
    sumL[d % 2] += F[d]
  }
  const scale = Math.max(1e-300, ...Array.from(F, Math.abs))
  const error = Math.max(Math.abs(sumL[0] + sumR[0]), Math.abs(sumL[1] + sumR[1])) / scale
  if (error > 1e-6) warnings.push(`The reactions do not balance the loads (relative error ${error.toExponential(1)}).`)
  let maxDisp = 0
  let maxVm = 0
  for (let i = 0; i < n; i++) {
    maxDisp = Math.max(maxDisp, Math.hypot(u[2 * i], u[2 * i + 1]))
    maxVm = Math.max(maxVm, derivedStress(nodal.sx[i], nodal.sy[i], nodal.txy[i], nodal.sz[i]).vm)
  }
  const sy = p.yield ?? Infinity
  return {
    kind: 'plane', analysis: p.planeStrain ? 'plane-strain' : 'plane-stress', mesh, u, reactions, elem, nodal, elemEnergy: energy, nodalEnergy, strainEnergy: U, work, planeStrain: p.planeStrain,
    yield: sy, maxDisp, maxVm, safety: maxVm > 0 ? sy / maxVm : Infinity, equilibrium: { loads: sumL, reactions: sumR, error }, solve: info, warnings,
  }
}

// ---------------------------------------------------------------------------- from a model

/** The mesh tolerance used to find the nodes of a target: a small fraction of the element size. */
export const targetTolerance = (size: number): number => Math.max(1e-9, size * 1e-3)

export function planeProblem(model: Model, mesh: Mesh): PlaneProblem {
  const plate = model.plate
  if (!plate) throw new SolveError('This model has no plate.')
  const mat = materialOf(model, plate.material)
  if (!mat) throw new SolveError(`The plate uses a material “${plate.material}” that does not exist.`)
  const tol = targetTolerance(plate.mesh.size)
  const fixedX = new Map<number, number>()
  const fixedY = new Map<number, number>()
  for (const s of plate.supports) {
    const nodes = targetNodes(mesh, s.target, tol)
    if (!nodes.length) throw new SolveError(`A support does not touch the plate (it is not on an edge or a corner of the outline). Check its position.`)
    for (const nd of nodes) {
      if (s.ux) fixedX.set(nd, s.dx ?? fixedX.get(nd) ?? 0)
      if (s.uy) fixedY.set(nd, s.dy ?? fixedY.get(nd) ?? 0)
    }
  }
  const forces = new Float64Array(2 * mesh.nNodes)
  const tractions: Array<{ seg: BSeg; tx: number; ty: number }> = []
  let dT = 0
  for (const l of plate.loads) {
    if (l.type === 'thermal') { dT += l.dT; continue }
    if (l.type === 'point') {
      const nodes = targetNodes(mesh, l.target, tol)
      if (!nodes.length) throw new SolveError('A point load is not on the plate.')
      for (const nd of nodes) { forces[2 * nd] += l.fx / nodes.length; forces[2 * nd + 1] += l.fy / nodes.length }
      continue
    }
    const segs = targetSegments(mesh, l.target, tol)
    if (!segs.length) throw new SolveError('A load is on an edge that the mesh does not have (check the edge it is applied to).')
    const len = (sg: BSeg) => Math.hypot(mesh.xy[2 * sg.b] - mesh.xy[2 * sg.a], mesh.xy[2 * sg.b + 1] - mesh.xy[2 * sg.a + 1])
    const total = segs.reduce((acc, sg) => acc + len(sg), 0)
    for (const sg of segs) {
      const dx = mesh.xy[2 * sg.b] - mesh.xy[2 * sg.a]
      const dy = mesh.xy[2 * sg.b + 1] - mesh.xy[2 * sg.a + 1]
      const ln = Math.hypot(dx, dy) || 1
      if (l.type === 'traction') tractions.push({ seg: sg, tx: l.tx, ty: l.ty })
      else if (l.type === 'pressure') tractions.push({ seg: sg, tx: (-l.p * dy) / ln, ty: (l.p * dx) / ln }) // −p · outward normal (dy, −dx)/l
      else tractions.push({ seg: sg, tx: l.fx / (total * plate.thickness), ty: l.fy / (total * plate.thickness) })
    }
  }
  return {
    mesh, E: mat.E, nu: mat.nu, t: plate.thickness, planeStrain: model.analysis === 'plane-strain', rho: mat.rho, gravity: model.gravity, alpha: mat.alpha, dT,
    fixedX, fixedY, forces, tractions, yield: mat.sy,
  }
}

/** Meshes (unless a mesh is given) and solves a plate model. */
export function solvePlate(model: Model, mesh?: Mesh): PlaneResult {
  const probs = checkModel(model).filter((p) => p.level === 'error')
  if (probs.length) throw new SolveError(probs[0].message)
  const m = mesh ?? meshPlate(model.plate!)
  return solveProblem(planeProblem(model, m))
}

// ---------------------------------------------------------------------------- convergence study

export type StudyQuantity = 'maxDisp' | 'maxVm' | 'maxSx' | 'maxSy' | 'energy'

export interface StudyPoint { size: number; elements: number; dofs: number; value: number }

export function studyValue(r: PlaneResult, q: StudyQuantity): number {
  switch (q) {
    case 'maxDisp': return r.maxDisp
    case 'maxVm': return r.maxVm
    case 'energy': return r.strainEnergy
    case 'maxSx': return Math.max(...r.nodal.sx)
    default: return Math.max(...r.nodal.sy)
  }
}

/**
 * Solves the plate again and again with smaller elements (h-refinement): the size, the refinement points and the
 * divisions of a regular grid are all scaled. Sizes that would give more than `maxElements` elements are skipped.
 */
export function convergenceStudy(model: Model, sizes: number[], q: StudyQuantity, maxElements = 20000): StudyPoint[] {
  const out: StudyPoint[] = []
  const base = model.plate!.mesh.size
  const baseElems = meshPlate(model.plate!).nElems
  for (const size of sizes) {
    const ratio = base / size
    if (baseElems * ratio * ratio > maxElements && out.length >= 2) continue
    const m = structuredClone(model)
    m.plate!.mesh.size = size
    m.plate!.mesh.refine = m.plate!.mesh.refine.map((r) => ({ ...r, size: r.size / ratio }))
    const dv = m.plate!.mesh.divisions
    if (dv) m.plate!.mesh.divisions = [Math.max(1, Math.round(dv[0] * ratio)), Math.max(1, Math.round(dv[1] * ratio))]
    const mesh = meshPlate(m.plate!)
    const r = solveProblem(planeProblem(m, mesh))
    out.push({ size, elements: mesh.nElems, dofs: 2 * mesh.nNodes, value: studyValue(r, q) })
  }
  return out
}
