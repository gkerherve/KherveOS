// Dense linear solvers for the circuit matrices (real and complex), LU with partial pivoting.
// Circuits here have tens of unknowns, so dense is both simplest and fast enough.

/** Solves A·x = b in place (A is n×n row-major, b length n). Returns false when the matrix is singular. */
export function solveReal(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let p = k
    let big = Math.abs(A[k * n + k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k])
      if (v > big) { big = v; p = i }
    }
    if (!(big > 1e-300)) return false
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t
      }
      const t = b[k]; b[k] = b[p]; b[p] = t
    }
    const piv = A[k * n + k]
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / piv
      if (f === 0) continue
      A[i * n + k] = 0
      for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j]
      b[i] -= f * b[k]
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j]
    b[i] = s / A[i * n + i]
  }
  return true
}

/** Complex A·x = b in place; Ar/Ai and br/bi are the real and imaginary parts. */
export function solveComplex(Ar: Float64Array, Ai: Float64Array, br: Float64Array, bi: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let p = k
    let big = Math.hypot(Ar[k * n + k], Ai[k * n + k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.hypot(Ar[i * n + k], Ai[i * n + k])
      if (v > big) { big = v; p = i }
    }
    if (!(big > 1e-300)) return false
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        let t = Ar[k * n + j]; Ar[k * n + j] = Ar[p * n + j]; Ar[p * n + j] = t
        t = Ai[k * n + j]; Ai[k * n + j] = Ai[p * n + j]; Ai[p * n + j] = t
      }
      let t = br[k]; br[k] = br[p]; br[p] = t
      t = bi[k]; bi[k] = bi[p]; bi[p] = t
    }
    const pr = Ar[k * n + k]
    const pi = Ai[k * n + k]
    const d = pr * pr + pi * pi
    for (let i = k + 1; i < n; i++) {
      const ar = Ar[i * n + k]
      const ai = Ai[i * n + k]
      if (ar === 0 && ai === 0) continue
      // f = a / piv
      const fr = (ar * pr + ai * pi) / d
      const fi = (ai * pr - ar * pi) / d
      Ar[i * n + k] = 0
      Ai[i * n + k] = 0
      for (let j = k + 1; j < n; j++) {
        const xr = Ar[k * n + j]
        const xi = Ai[k * n + j]
        Ar[i * n + j] -= fr * xr - fi * xi
        Ai[i * n + j] -= fr * xi + fi * xr
      }
      br[i] -= fr * br[k] - fi * bi[k]
      bi[i] -= fr * bi[k] + fi * br[k]
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i]
    let si = bi[i]
    for (let j = i + 1; j < n; j++) {
      const xr = br[j]
      const xi = bi[j]
      const mr = Ar[i * n + j]
      const mi = Ai[i * n + j]
      sr -= mr * xr - mi * xi
      si -= mr * xi + mi * xr
    }
    const pr = Ar[i * n + i]
    const pi = Ai[i * n + i]
    const d = pr * pr + pi * pi
    br[i] = (sr * pr + si * pi) / d
    bi[i] = (si * pr - sr * pi) / d
  }
  return true
}
