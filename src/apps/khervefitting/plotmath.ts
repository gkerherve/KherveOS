// The arithmetic of the spectrum plot: scales, tick marks, zooming and
// finding what is under the mouse. Plain functions (no DOM), tested in Node.

export interface Range {
  min: number
  max: number
}

/** A linear map from data values to pixels (the binding-energy axis runs backwards). */
export interface Scale {
  d0: number
  d1: number
  p0: number
  p1: number
}

export function scale(d: Range, p0: number, p1: number, reversed = false): Scale {
  return reversed ? { d0: d.max, d1: d.min, p0, p1 } : { d0: d.min, d1: d.max, p0, p1 }
}

export function toPx(s: Scale, v: number): number {
  const span = s.d1 - s.d0 || 1
  return s.p0 + ((v - s.d0) / span) * (s.p1 - s.p0)
}

export function fromPx(s: Scale, px: number): number {
  const span = s.p1 - s.p0 || 1
  return s.d0 + ((px - s.p0) / span) * (s.d1 - s.d0)
}

/** Smallest and largest finite values of some arrays. */
export function extent(...arrays: (readonly (number | null)[] | null | undefined)[]): Range | null {
  let min = Infinity
  let max = -Infinity
  for (const a of arrays) {
    if (!a) continue
    for (const v of a) {
      if (v === null || !Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return min <= max ? { min, max } : null
}

/** Round tick values (1, 2, 5 × 10ⁿ) covering a range with about `count` ticks. */
export function niceTicks(min: number, max: number, count = 6): { ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { ticks: [min], step: 1 }
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  const first = Math.ceil(min / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { ticks, step }
}

/** A tick label with as many decimals as the step needs. */
export function tickLabel(v: number, step: number): string {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)))
  return v.toFixed(decimals)
}

/** The power of ten for an intensity axis ("×10⁴"), 0 for small numbers. */
export function exponentFor(max: number): number {
  const a = Math.abs(max)
  if (!Number.isFinite(a) || a < 1e4) return 0
  return Math.floor(Math.log10(a))
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
export const superscript = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('')

/** Index of the x value nearest to `x` (x need not be sorted). */
export function nearestIndex(xs: readonly (number | null)[], x: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]
    if (v === null) continue
    const d = Math.abs(v - x)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** A range zoomed by `factor` (<1 zooms in) around `center`. */
export function zoomRange(r: Range, center: number, factor: number): Range {
  const min = center - (center - r.min) * factor
  const max = center + (r.max - center) * factor
  return min < max ? { min, max } : r
}

/** The data range padded by a fraction on each side (the desktop leaves a margin above the peaks). */
export function padded(r: Range, below: number, above: number): Range {
  const span = r.max - r.min || Math.abs(r.max) || 1
  return { min: r.min - span * below, max: r.max + span * above }
}

/** The two values in order. */
export const ordered = (a: number, b: number): Range => (a <= b ? { min: a, max: b } : { min: b, max: a })

/**
 * The peak whose top (position, height above the background) is within
 * `tol` pixels of the mouse, or -1. `tops` are pixel positions.
 */
export function hitTop(tops: readonly ({ x: number; y: number } | null)[], px: number, py: number, tol = 9): number {
  let best = -1
  let bestD = tol * tol
  tops.forEach((t, i) => {
    if (!t) return
    const d = (t.x - px) ** 2 + (t.y - py) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Which of two vertical lines (pixels) is within `tol` of px: 0, 1 or -1. */
export function hitLine(lines: readonly (number | null)[], px: number, tol = 6): number {
  let best = -1
  let bestD = tol
  lines.forEach((l, i) => {
    if (l === null) return
    const d = Math.abs(l - px)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** The intensity of a curve at x, by linear interpolation between neighbours. */
export function valueAt(xs: readonly (number | null)[], ys: readonly (number | null)[], x: number): number | null {
  const i = nearestIndex(xs, x)
  if (i < 0) return null
  const xi = xs[i]
  const yi = ys[i]
  if (xi === null || yi === null || xi === x) return yi ?? null
  const j = (xs[i + 1] !== null && xs[i + 1] !== undefined && (xs[i + 1]! - x) * (xi - x) < 0) ? i + 1 : i - 1
  const xj = xs[j]
  const yj = ys[j]
  if (xj === null || xj === undefined || yj === null || yj === undefined || xj === xi) return yi
  return yi + ((x - xi) * (yj - yi)) / (xj - xi)
}
