// Natural frequencies and mode shapes (modal analysis) and linear buckling of frames and beams.
//
//   modal     K φ = ω² M φ with the consistent mass matrix of the beam elements (ρ A from the material)
//   buckling  K φ = λ (−Kg) φ, Kg the geometric stiffness of the axial forces of the static solution: λ multiplies the
//             applied loads to give the critical loads (Euler: P = π² E I / (K L)²)
//
// Members are divided into several elements first (the default is 8), so that the mode shapes are smooth and the
// frequencies / critical loads accurate. Dense generalised eigen solvers: limited to a few hundred free dofs.

import { assemble, buildSystem, localGeometric, localMass, releaseMap, solveFrame, type Elem, type FrameSystem } from './frame.ts'
import { generalisedEigen, SolveError } from './linalg.ts'
import { nodeById, type Member, type MemberLoad, type Model } from './model.ts'

export const MAX_EIGEN_DOFS = 300

/** The same structure with every member divided into n elements (nodes N.1, N.2…). Loads on members are divided too. */
export function subdivideModel(model: Model, n: number): Model {
  if (n <= 1) return structuredClone(model)
  const out: Model = { ...structuredClone(model), members: [], memberLoads: [] }
  for (const mem of model.members) {
    const a = nodeById(model, mem.n1)!
    const b = nodeById(model, mem.n2)!
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const ids = [mem.n1]
    for (let k = 1; k < n; k++) {
      const id = `${mem.id}.${k}`
      out.nodes.push({ id, x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
      ids.push(id)
    }
    ids.push(mem.n2)
    for (let k = 0; k < n; k++) {
      const sub: Member = { id: k === 0 ? mem.id : `${mem.id}.m${k}`, n1: ids[k], n2: ids[k + 1], section: mem.section, material: mem.material }
      if (k === 0 && mem.releaseStart) sub.releaseStart = true
      if (k === n - 1 && mem.releaseEnd) sub.releaseEnd = true
      out.members.push(sub)
    }
    const piece = (k: number) => (k === 0 ? mem.id : `${mem.id}.m${k}`)
    for (const l of model.memberLoads.filter((x) => x.member === mem.id)) {
      if (l.type === 'thermal') { for (let k = 0; k < n; k++) out.memberLoads.push({ ...l, id: `${l.id}.${k}`, member: piece(k) }); continue }
      if (l.type === 'point') {
        const k = Math.min(n - 1, Math.floor((l.a / L) * n))
        out.memberLoads.push({ ...l, id: `${l.id}.${k}`, member: piece(k), a: l.a - (k * L) / n })
        continue
      }
      const ta = l.a ?? 0
      const tb = l.b ?? L
      for (let k = 0; k < n; k++) {
        const s0 = (k * L) / n
        const s1 = ((k + 1) * L) / n
        const lo = Math.max(ta, s0)
        const hi = Math.min(tb, s1)
        if (hi <= lo + 1e-12 * L) continue
        const w = (t: number) => l.w1 + ((l.w2 - l.w1) * (t - ta)) / (tb - ta || 1)
        const piece1: MemberLoad = { id: `${l.id}.${k}`, member: piece(k), type: 'dist', dir: l.dir, w1: w(lo), w2: w(hi), a: lo - s0, b: hi - s0 }
        out.memberLoads.push(piece1)
      }
    }
  }
  return out
}

function denseFree(sys: FrameSystem, mat: (e: Elem) => number[]): Float64Array {
  const n = sys.nFree
  const M = new Float64Array(n * n)
  for (const e of sys.elems) {
    const m = mat(e)
    for (let a = 0; a < 6; a++) {
      const fa = sys.freeIndex[e.dofs[a]]
      if (fa < 0) continue
      for (let b = 0; b < 6; b++) {
        const fb = sys.freeIndex[e.dofs[b]]
        if (fb >= 0) M[fa * n + fb] += m[a * 6 + b]
      }
    }
  }
  return M
}

const matmul6 = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(36).fill(0)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let s = 0; for (let k = 0; k < 6; k++) s += a[i * 6 + k] * b[k * 6 + j]; o[i * 6 + j] = s }
  return o
}
const transpose6 = (a: number[]): number[] => {
  const o = new Array<number>(36)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) o[i * 6 + j] = a[j * 6 + i]
  return o
}

function rotate6(k: number[], c: number, s: number): number[] {
  const R = [c, s, 0, -s, c, 0, 0, 0, 1]
  const T = new Array<number>(36).fill(0)
  for (let b = 0; b < 2; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[(b * 3 + i) * 6 + b * 3 + j] = R[i * 3 + j]
  return matmul6(transpose6(T), matmul6(k, T))
}

/** Reduces a local matrix (mass or geometric stiffness) with the same release map as the stiffness. */
function releaseReduce(e: Elem, m: number[]): number[] {
  if (!e.rel.length) return m
  const T = releaseMap(e.k, e.rel, e.krrInv)
  return matmul6(transpose6(T), matmul6(m, T))
}

export interface Mode {
  /** rad/s */
  omega: number
  /** Hz */
  frequency: number
  period: number
  /** 3 per node of `model`, scaled so that the largest displacement is 1 */
  shape: Float64Array
}

export interface ModalResult {
  kind: 'modal'
  model: Model
  modes: Mode[]
}

function expand(sys: FrameSystem, phi: Float64Array, k: number, n: number): Float64Array {
  const out = new Float64Array(3 * sys.n)
  for (let d = 0; d < 3 * sys.n; d++) if (sys.freeIndex[d] >= 0) out[d] = phi[sys.freeIndex[d] * n + k]
  let mx = 0
  for (let i = 0; i < sys.n; i++) mx = Math.max(mx, Math.hypot(out[3 * i], out[3 * i + 1]))
  if (mx > 0) for (let d = 0; d < out.length; d++) out[d] /= mx
  return out
}

export function modalAnalysis(model: Model, opts: { modes?: number; divisions?: number } = {}): ModalResult {
  const fine = subdivideModel(model, opts.divisions ?? 8)
  fine.memberLoads = []
  fine.nodeLoads = []
  fine.gravity = 0
  const sys = buildSystem(fine)
  if (sys.nFree === 0) throw new SolveError('Every degree of freedom is held: nothing can vibrate.')
  if (sys.nFree > MAX_EIGEN_DOFS) throw new SolveError(`Modal analysis is limited to ${MAX_EIGEN_DOFS} free degrees of freedom (this model has ${sys.nFree}): use fewer divisions or fewer members.`)
  if (sys.geo.some((g) => !(g.rho > 0))) throw new SolveError('Modal analysis needs the density of every material (ρ > 0).')
  const n = sys.nFree
  const { K } = assemble(sys)
  const Kd = new Float64Array(n * n)
  for (let i = 0; i < n; i++) for (const [j, v] of K.rows[i]) Kd[i * n + j] = v
  const Md = denseFree(sys, (e) => rotate6(releaseReduce(e, localMass(e.g.rho, e.g.A, e.g.L)), e.g.c, e.g.s))
  const eig = generalisedEigen(Kd, Md, n)
  if (!eig) throw new SolveError('The mass matrix is not positive definite: some part of the structure has no mass.')
  const modes: Mode[] = []
  const want = Math.max(1, Math.min(opts.modes ?? 6, n))
  for (let k = 0; k < n && modes.length < want; k++) {
    const l = eig.values[k]
    if (!(l > 1e-9)) continue // a rigid-body mode
    const omega = Math.sqrt(l)
    modes.push({ omega, frequency: omega / (2 * Math.PI), period: (2 * Math.PI) / omega, shape: expand(sys, eig.vectors, k, n) })
  }
  if (!modes.length) throw new SolveError('No vibration mode found: the structure may be a mechanism.')
  return { kind: 'modal', model: fine, modes }
}

export interface BucklingMode {
  /** load factor: the critical load is factor × the applied loads */
  factor: number
  shape: Float64Array
}

export interface BucklingResult {
  kind: 'buckling'
  model: Model
  modes: BucklingMode[]
  /** largest compressive force in the static solution, N */
  maxCompression: number
}

export function bucklingAnalysis(model: Model, opts: { modes?: number; divisions?: number } = {}): BucklingResult {
  const fine = subdivideModel(model, opts.divisions ?? 8)
  const stat = solveFrame(fine)
  const sys = buildSystem(fine)
  if (sys.nFree === 0) throw new SolveError('Every degree of freedom is held.')
  if (sys.nFree > MAX_EIGEN_DOFS) throw new SolveError(`Buckling analysis is limited to ${MAX_EIGEN_DOFS} free degrees of freedom (this model has ${sys.nFree}).`)
  const n = sys.nFree
  const { K } = assemble(sys)
  const Kd = new Float64Array(n * n)
  for (let i = 0; i < n; i++) for (const [j, v] of K.rows[i]) Kd[i * n + j] = v
  const axial = new Map(stat.members.map((m) => [m.id, (m.N1 + m.N2) / 2]))
  let maxCompression = 0
  for (const v of axial.values()) maxCompression = Math.max(maxCompression, -v)
  if (maxCompression <= 0) throw new SolveError('No member is in compression under these loads, so nothing can buckle. Apply compressive loads.')
  // −Kg: positive where the members are compressed
  const Gd = denseFree(sys, (e) => rotate6(releaseReduce(e, localGeometric(-(axial.get(e.g.mem.id) ?? 0), e.g.L)), e.g.c, e.g.s))
  const eig = generalisedEigen(Gd, Kd, n) // Gd φ = μ Kd φ, λ = 1/μ
  if (!eig) throw new SolveError('The structure is unstable even without the loads (the stiffness is not positive definite).')
  const list: Array<{ f: number; k: number }> = []
  for (let k = 0; k < n; k++) if (eig.values[k] > 1e-12) list.push({ f: 1 / eig.values[k], k })
  list.sort((a, b) => a.f - b.f)
  const want = Math.max(1, opts.modes ?? 4)
  return {
    kind: 'buckling', model: fine, maxCompression,
    modes: list.slice(0, want).map(({ f, k }) => ({ factor: f, shape: expand(sys, eig.vectors, k, n) })),
  }
}

