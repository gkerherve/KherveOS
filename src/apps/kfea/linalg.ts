// Linear algebra for kFEA, no dependencies: a sparse symmetric matrix, reverse Cuthill–McKee ordering, a skyline
// (profile) Cholesky solver, Jacobi-preconditioned conjugate gradients, and dense helpers (Cholesky, Jacobi
// eigenvalues, the generalised symmetric eigenproblem) for modal analysis and buckling.
//
// A singular matrix (a mechanism) is reported with the mode that makes it singular, so that the solver can say in
// plain language which node can move.

/** Raised when the stiffness matrix is singular. `mode` is a vector K·mode ≈ 0 (in the original numbering). */
export class SingularError extends Error {
  index: number
  mode: Float64Array
  constructor(index: number, mode: Float64Array) {
    super('The stiffness matrix is singular.')
    this.name = 'SingularError'
    this.index = index
    this.mode = mode
  }
}

/** Symmetric sparse matrix under construction: both triangles are stored. */
export class SparseSym {
  n: number
  rows: Array<Map<number, number>>
  constructor(n: number) {
    this.n = n
    this.rows = Array.from({ length: n }, () => new Map<number, number>())
  }
  add(i: number, j: number, v: number): void {
    if (v === 0) return
    const r = this.rows[i]
    r.set(j, (r.get(j) ?? 0) + v)
  }
  get(i: number, j: number): number {
    return this.rows[i].get(j) ?? 0
  }
  toCsr(): Csr {
    const n = this.n
    const ptr = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) ptr[i + 1] = ptr[i] + this.rows[i].size
    const col = new Int32Array(ptr[n])
    const val = new Float64Array(ptr[n])
    for (let i = 0; i < n; i++) {
      const entries = [...this.rows[i]].sort((a, b) => a[0] - b[0])
      let p = ptr[i]
      for (const [c, v] of entries) { col[p] = c; val[p] = v; p++ }
    }
    return { n, ptr, col, val }
  }
}

export interface Csr {
  n: number
  ptr: Int32Array
  col: Int32Array
  val: Float64Array
}

export function csrMul(a: Csr, x: Float64Array, y = new Float64Array(a.n)): Float64Array {
  for (let i = 0; i < a.n; i++) {
    let s = 0
    for (let p = a.ptr[i]; p < a.ptr[i + 1]; p++) s += a.val[p] * x[a.col[p]]
    y[i] = s
  }
  return y
}

export function csrDiag(a: Csr): Float64Array {
  const d = new Float64Array(a.n)
  for (let i = 0; i < a.n; i++) for (let p = a.ptr[i]; p < a.ptr[i + 1]; p++) if (a.col[p] === i) d[i] = a.val[p]
  return d
}

// ------------------------------------------------------------------------------ ordering

/** Reverse Cuthill–McKee: perm[new] = old. Keeps the profile of the matrix small. */
export function rcmOrder(a: Csr): Int32Array {
  const n = a.n
  const deg = new Int32Array(n)
  for (let i = 0; i < n; i++) deg[i] = a.ptr[i + 1] - a.ptr[i]
  const seen = new Uint8Array(n)
  const order: number[] = []
  const byDeg = Array.from({ length: n }, (_, i) => i).sort((x, y) => deg[x] - deg[y])
  for (const start of byDeg) {
    if (seen[start]) continue
    seen[start] = 1
    const queue = [start]
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi]
      order.push(v)
      const nb: number[] = []
      for (let p = a.ptr[v]; p < a.ptr[v + 1]; p++) {
        const w = a.col[p]
        if (!seen[w]) { seen[w] = 1; nb.push(w) }
      }
      nb.sort((x, y) => deg[x] - deg[y])
      for (const w of nb) queue.push(w)
    }
  }
  order.reverse()
  return Int32Array.from(order)
}

// ------------------------------------------------------------------------------ skyline Cholesky

export interface Skyline {
  n: number
  first: Int32Array
  ptr: Int32Array
  L: Float64Array
  perm: Int32Array
  inv: Int32Array
}

export interface FactorInfo {
  /** the smallest pivot relative to its diagonal: near 0 means close to a mechanism */
  minPivot: number
  /** a cheap estimate of the condition number (largest / smallest diagonal of L, squared) */
  cond: number
  profile: number
}

/** Size (number of stored values) of the skyline of the matrix after the ordering. */
export function profileSize(a: Csr, perm: Int32Array): number {
  const inv = new Int32Array(a.n)
  perm.forEach((o, nw) => { inv[o] = nw })
  const first = new Int32Array(a.n)
  for (let i = 0; i < a.n; i++) first[i] = i
  for (let r = 0; r < a.n; r++) {
    const pr = inv[r]
    for (let p = a.ptr[r]; p < a.ptr[r + 1]; p++) {
      const pc = inv[a.col[p]]
      if (pc < first[pr]) first[pr] = pc
    }
  }
  let s = 0
  for (let i = 0; i < a.n; i++) s += i - first[i] + 1
  return s
}

export function skylineFactor(a: Csr, perm: Int32Array, relTol = 1e-11): { sky: Skyline; info: FactorInfo } {
  const n = a.n
  const inv = new Int32Array(n)
  perm.forEach((o, nw) => { inv[o] = nw })
  const first = new Int32Array(n)
  for (let i = 0; i < n; i++) first[i] = i
  for (let r = 0; r < n; r++) {
    const pr = inv[r]
    for (let p = a.ptr[r]; p < a.ptr[r + 1]; p++) {
      const pc = inv[a.col[p]]
      if (pc < first[pr]) first[pr] = pc
    }
  }
  const ptr = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) ptr[i + 1] = ptr[i] + (i - first[i] + 1)
  const L = new Float64Array(ptr[n])
  const diag0 = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    const pr = inv[r]
    for (let p = a.ptr[r]; p < a.ptr[r + 1]; p++) {
      const pc = inv[a.col[p]]
      if (pc <= pr) L[ptr[pr] + pc - first[pr]] = a.val[p]
      if (pc === pr) diag0[pr] = a.val[p]
    }
  }
  const sky: Skyline = { n, first, ptr, L, perm, inv }
  let minPivot = Infinity
  let dmin = Infinity
  let dmax = 0
  for (let i = 0; i < n; i++) {
    const fi = first[i]
    const bi = ptr[i] - fi
    for (let j = fi; j <= i; j++) {
      let s = L[bi + j]
      const fj = first[j]
      const bj = ptr[j] - fj
      const k0 = fj > fi ? fj : fi
      for (let k = k0; k < j; k++) s -= L[bi + k] * L[bj + k]
      if (j < i) L[bi + j] = s / L[bj + j]
      else {
        const scale = Math.abs(diag0[i]) > 0 ? Math.abs(diag0[i]) : 1
        if (!(s > relTol * scale)) throw new SingularError(perm[i], mechanismMode(sky, i, a))
        L[bi + i] = Math.sqrt(s)
        const ratio = s / scale
        if (ratio < minPivot) minPivot = ratio
        const d = L[bi + i]
        if (d < dmin) dmin = d
        if (d > dmax) dmax = d
      }
    }
  }
  return { sky, info: { minPivot: n ? minPivot : 1, cond: n ? (dmax / dmin) ** 2 : 1, profile: ptr[n] } }
}

/** The vector with x[i] = 1 that the first `m` factored rows leave in the null space (original numbering). */
function mechanismMode(sky: Skyline, m: number, a: Csr): Float64Array {
  const { first, ptr, L, perm, inv } = sky
  const rhs = new Float64Array(m)
  const orig = perm[m]
  for (let p = a.ptr[orig]; p < a.ptr[orig + 1]; p++) {
    const pc = inv[a.col[p]]
    if (pc < m) rhs[pc] = -a.val[p]
  }
  // L y = rhs (rows 0..m-1), Lᵀ x = y
  for (let i = 0; i < m; i++) {
    let s = rhs[i]
    const fi = first[i]
    for (let k = fi; k < i; k++) s -= L[ptr[i] + k - fi] * rhs[k]
    rhs[i] = s / L[ptr[i] + i - fi]
  }
  for (let i = m - 1; i >= 0; i--) {
    const fi = first[i]
    rhs[i] /= L[ptr[i] + i - fi]
    const xi = rhs[i]
    for (let k = fi; k < i; k++) rhs[k] -= L[ptr[i] + k - fi] * xi
  }
  const mode = new Float64Array(a.n)
  for (let k = 0; k < m; k++) mode[perm[k]] = rhs[k]
  mode[perm[m]] = 1
  return mode
}

export function skylineSolve(sky: Skyline, b: Float64Array): Float64Array {
  const { n, first, ptr, L, perm } = sky
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) y[i] = b[perm[i]]
  for (let i = 0; i < n; i++) {
    const fi = first[i]
    const bi = ptr[i] - fi
    let s = y[i]
    for (let k = fi; k < i; k++) s -= L[bi + k] * y[k]
    y[i] = s / L[bi + i]
  }
  for (let i = n - 1; i >= 0; i--) {
    const fi = first[i]
    const bi = ptr[i] - fi
    y[i] /= L[bi + i]
    const xi = y[i]
    for (let k = fi; k < i; k++) y[k] -= L[bi + k] * xi
  }
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[perm[i]] = y[i]
  return x
}

// ------------------------------------------------------------------------------ conjugate gradients

export interface PcgResult { x: Float64Array; iterations: number; residual: number; converged: boolean }

/** Conjugate gradients with a Jacobi (diagonal) preconditioner. */
export function pcg(a: Csr, b: Float64Array, tol = 1e-10, maxIter = 0): PcgResult {
  const n = a.n
  const max = maxIter || Math.max(200, 10 * n)
  const d = csrDiag(a)
  const minv = d.map((v) => (v > 0 ? 1 / v : 1))
  const x = new Float64Array(n)
  const r = Float64Array.from(b)
  const z = r.map((v, i) => v * minv[i])
  const p = Float64Array.from(z)
  const ap = new Float64Array(n)
  let rz = dot(r, z)
  const bn = Math.sqrt(dot(b, b)) || 1
  let it = 0
  let res = Math.sqrt(dot(r, r)) / bn
  while (res > tol && it < max) {
    csrMul(a, p, ap)
    const alpha = rz / dot(p, ap)
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; z[i] = r[i] * minv[i] }
    const rzNew = dot(r, z)
    const beta = rzNew / rz
    rz = rzNew
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
    res = Math.sqrt(dot(r, r)) / bn
    it++
  }
  return { x, iterations: it, residual: res, converged: res <= tol }
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// ------------------------------------------------------------------------------ the front door

export interface SolveInfo {
  method: 'cholesky' | 'pcg'
  n: number
  minPivot: number
  cond: number
  /** ‖K x − b‖ / ‖b‖ */
  residual: number
  iterations?: number
}

/** Largest skyline (values) the direct solver may use: 14 million doubles, about 110 MB. */
export const MAX_PROFILE = 14_000_000

/**
 * Solves K x = b for a symmetric positive definite K (skyline Cholesky after reverse Cuthill–McKee; conjugate
 * gradients when the profile would be too large). Throws SingularError for a mechanism.
 */
export function solveSym(m: SparseSym, b: Float64Array, method: 'auto' | 'cholesky' | 'pcg' = 'auto'): { x: Float64Array; info: SolveInfo } {
  const a = m.toCsr()
  if (a.n === 0) return { x: new Float64Array(0), info: { method: 'cholesky', n: 0, minPivot: 1, cond: 1, residual: 0 } }
  const perm = rcmOrder(a)
  const useDirect = method === 'cholesky' || (method === 'auto' && profileSize(a, perm) <= MAX_PROFILE)
  if (useDirect) {
    const { sky, info } = skylineFactor(a, perm)
    const x = skylineSolve(sky, b)
    return { x, info: { method: 'cholesky', n: a.n, minPivot: info.minPivot, cond: info.cond, residual: residualOf(a, x, b) } }
  }
  const r = pcg(a, b, 1e-12)
  if (!r.converged) throw new Error(`The iterative solver did not converge (residual ${r.residual.toExponential(1)}): the model is probably nearly a mechanism.`)
  return { x: r.x, info: { method: 'pcg', n: a.n, minPivot: NaN, cond: NaN, residual: r.residual, iterations: r.iterations } }
}

export function residualOf(a: Csr, x: Float64Array, b: Float64Array): number {
  const ax = csrMul(a, x)
  let num = 0
  let den = 0
  for (let i = 0; i < a.n; i++) { num += (ax[i] - b[i]) ** 2; den += b[i] ** 2 }
  return den > 0 ? Math.sqrt(num / den) : Math.sqrt(num)
}

// ------------------------------------------------------------------------------ dense helpers

/** Dense Cholesky factor (lower, row-major n×n) of a symmetric positive definite matrix; null when it is not. */
export function choleskyDense(a: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j]
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]
      if (i === j) {
        if (!(s > 0)) return null
        L[i * n + i] = Math.sqrt(s)
      } else L[i * n + j] = s / L[j * n + j]
    }
  }
  return L
}

export interface Eigen {
  /** ascending */
  values: Float64Array
  /** column k (vectors[i * n + k]) belongs to values[k] */
  vectors: Float64Array
}

/** Eigenvalues and eigenvectors of a dense symmetric matrix (cyclic Jacobi rotations). `a` is not changed. */
export function jacobiEigen(a0: Float64Array, n: number, maxSweeps = 80): Eigen {
  const a = Float64Array.from(a0)
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0
    let diag = 0
    for (let i = 0; i < n; i++) {
      diag += a[i * n + i] ** 2
      for (let j = i + 1; j < n; j++) off += a[i * n + j] ** 2
    }
    if (off <= 1e-26 * (diag + off) || off === 0) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-300) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]
          const vkq = v[k * n + q]
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x * n + x] - a[y * n + y])
  const values = new Float64Array(n)
  const vectors = new Float64Array(n * n)
  idx.forEach((src, k) => {
    values[k] = a[src * n + src]
    for (let i = 0; i < n; i++) vectors[i * n + k] = v[i * n + src]
  })
  return { values, vectors }
}

/**
 * K φ = λ B φ with K symmetric and B symmetric positive definite (dense, row-major). Returns λ ascending and the
 * vectors normalised so that φᵀ B φ = 1; null when B is not positive definite.
 */
export function generalisedEigen(K: Float64Array, B: Float64Array, n: number): Eigen | null {
  const L = choleskyDense(B, n)
  if (!L) return null
  // C = L⁻¹ K L⁻ᵀ: first Y = L⁻¹ K (forward substitution on columns), then C = Y L⁻ᵀ
  const Y = new Float64Array(n * n)
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < n; i++) {
      let s = K[i * n + c]
      for (let k = 0; k < i; k++) s -= L[i * n + k] * Y[k * n + c]
      Y[i * n + c] = s / L[i * n + i]
    }
  }
  const C = new Float64Array(n * n)
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n; i++) {
      let s = Y[r * n + i]
      for (let k = 0; k < i; k++) s -= L[i * n + k] * C[r * n + k]
      C[r * n + i] = s / L[i * n + i]
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const m = 0.5 * (C[i * n + j] + C[j * n + i]); C[i * n + j] = m; C[j * n + i] = m }
  const e = jacobiEigen(C, n)
  // φ = L⁻ᵀ y
  const vectors = new Float64Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = n - 1; i >= 0; i--) {
      let s = e.vectors[i * n + k]
      for (let j = i + 1; j < n; j++) s -= L[j * n + i] * vectors[j * n + k]
      vectors[i * n + k] = s / L[i * n + i]
    }
  }
  return { values: e.values, vectors }
}

/** An error with a message meant for the user (a mechanism, a bad model…). */
export class SolveError extends Error {
  /** model items the message is about (node or member ids) */
  refs: string[]
  constructor(message: string, refs: string[] = []) {
    super(message)
    this.name = 'SolveError'
    this.refs = refs
  }
}
