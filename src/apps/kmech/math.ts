// Small numeric helpers shared by the kMech engines (pure: no browser, no dependencies).

export interface Pt { x: number; y: number }

export const TAU = Math.PI * 2
export const deg = (r: number): number => (r * 180) / Math.PI
export const rad = (d: number): number => (d * Math.PI) / 180
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
export const hypot = (x: number, y: number): number => Math.hypot(x, y)
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Angle wrapped to (-π, π]. */
export function wrapPi(a: number): number {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  else if (r <= -Math.PI) r += TAU
  return r
}

/** Angle wrapped to [0, 2π). */
export function wrap2pi(a: number): number {
  const r = a % TAU
  return r < 0 ? r + TAU : r
}

/** A number as short text: round to `digits` significant digits, no trailing zeros. */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v)
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e')
  return String(Number(v.toPrecision(digits)))
}

export const round = (v: number, d = 6): number => {
  const k = 10 ** d
  return Math.round(v * k) / k
}

/** Solves A x = b by Gaussian elimination with partial pivoting; null when A is singular. A is not modified. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) return null
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t }
    const piv = M[c][c]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv
      if (f === 0) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x.every(Number.isFinite) ? x : null
}

/** Least-squares / minimum-norm style solve of J x = b for any shape (normal equations, optionally damped). */
export function solveLS(J: number[][], b: number[], lambda = 0): number[] | null {
  const m = J.length
  const n = m ? J[0].length : 0
  if (n === 0) return []
  const N: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const r = new Array<number>(n).fill(0)
  for (let i = 0; i < m; i++) {
    const row = J[i]
    for (let a = 0; a < n; a++) {
      const ra = row[a]
      if (ra === 0) continue
      r[a] += ra * b[i]
      for (let c = a; c < n; c++) N[a][c] += ra * row[c]
    }
  }
  for (let a = 0; a < n; a++) {
    for (let c = 0; c < a; c++) N[a][c] = N[c][a]
    N[a][a] += lambda
  }
  return solveLinear(N, r)
}

/** Eigenvalues of a symmetric matrix (cyclic Jacobi), ascending. */
export function symEigenvalues(S: number[][]): number[] {
  const n = S.length
  const A = S.map((r) => [...r])
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q]
    if (off < 1e-30) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
      }
    }
  }
  return A.map((r, i) => r[i]).sort((a, b) => a - b)
}

/** The two intersections of circles (c0, r0) and (c1, r1); [] when they do not meet. */
export function circleIntersections(c0: Pt, r0: number, c1: Pt, r1: number): Pt[] {
  const dx = c1.x - c0.x
  const dy = c1.y - c0.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-12 || d > r0 + r1 + 1e-12 || d < Math.abs(r0 - r1) - 1e-12) return []
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a))
  const mx = c0.x + (a * dx) / d
  const my = c0.y + (a * dy) / d
  return [
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
  ]
}

/** Roots of a x² + b x + c = 0 (real only). */
export function quadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b]
  const D = b * b - 4 * a * c
  if (D < 0) return []
  const s = Math.sqrt(D)
  const q = -0.5 * (b + Math.sign(b || 1) * s)
  const r = [q / a]
  if (Math.abs(q) > 1e-300) r.push(c / q)
  return r.sort((x, y) => x - y)
}

/** `n` values from a to b inclusive. */
export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** Seeded generator (mulberry32): same numbers every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Polygon area (shoelace); positive for counter-clockwise points. */
export function polygonArea(pts: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Centroid of a polygon. */
export function polygonCentroid(pts: readonly Pt[]): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  if (Math.abs(a) < 1e-300) return pts.length ? { ...pts[0] } : { x: 0, y: 0 }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

/** Escapes the five XML characters. */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
