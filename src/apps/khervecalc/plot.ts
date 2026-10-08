// Geometry behind KherveCalc's graphs: the view window, axis ticks, zoom and
// pan, contour lines of implicit curves (marching squares), breaking curves at
// poles, and tracing. Pure, so tools/tests can check it.

export interface View {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

export const STANDARD_VIEW: View = { xmin: -10, xmax: 10, ymin: -7, ymax: 7 }

/** "Nice" tick positions (1, 2, 5 × 10ⁿ) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, approx = 8): { step: number; ticks: number[] } {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return { step: 1, ticks: [] }
  const raw = (hi - lo) / Math.max(1, approx)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const first = Math.ceil(lo / step) * step
  const ticks: number[] = []
  for (let v = first; v <= hi + step * 1e-9 && ticks.length < 1000; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { step, ticks }
}

/** A tick label without floating-point noise (0.30000000000000004 -> 0.3). */
export function tickLabel(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + Math.floor(Math.log10(a))))).replace(/\.?0+e/, 'e')
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)))
  return v.toFixed(decimals)
}

/** Zoom about a point (factor < 1 zooms in). */
export function zoomAt(v: View, cx: number, cy: number, fx: number, fy = fx): View {
  return {
    xmin: cx - (cx - v.xmin) * fx,
    xmax: cx + (v.xmax - cx) * fx,
    ymin: cy - (cy - v.ymin) * fy,
    ymax: cy + (v.ymax - cy) * fy,
  }
}

export function pan(v: View, dx: number, dy: number): View {
  return { xmin: v.xmin + dx, xmax: v.xmax + dx, ymin: v.ymin + dy, ymax: v.ymax + dy }
}

/** Make one x unit as long as one y unit on screen (keeps the centre). */
export function squareView(v: View, widthPx: number, heightPx: number): View {
  const cx = (v.xmin + v.xmax) / 2
  const cy = (v.ymin + v.ymax) / 2
  const perPx = Math.max((v.xmax - v.xmin) / widthPx, (v.ymax - v.ymin) / heightPx)
  return { xmin: cx - (perPx * widthPx) / 2, xmax: cx + (perPx * widthPx) / 2, ymin: cy - (perPx * heightPx) / 2, ymax: cy + (perPx * heightPx) / 2 }
}

/** The y range of the visible samples, with a margin (Zoom › Fit). */
export function fitY(ys: (number | null)[][], fallback: View): { ymin: number; ymax: number } {
  const all = ys.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  if (!all.length) return { ymin: fallback.ymin, ymax: fallback.ymax }
  all.sort((a, b) => a - b)
  // ignore the extreme 2% (poles)
  const lo = all[Math.floor(all.length * 0.02)]
  const hi = all[Math.ceil(all.length * 0.98) - 1]
  if (hi - lo < 1e-12) return { ymin: lo - 1, ymax: hi + 1 }
  const m = (hi - lo) * 0.08
  return { ymin: lo - m, ymax: hi + m }
}

/**
 * Split a sampled curve into drawable runs: gaps (null) end a run, and so do
 * jumps across the whole screen (poles, e.g. tan x at π/2).
 */
export function runs(xs: (number | null)[], ys: (number | null)[], view: View): [number, number][][] {
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  const span = view.ymax - view.ymin
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      if (cur.length) out.push(cur)
      cur = []
      continue
    }
    const prev = cur[cur.length - 1]
    if (prev) {
      const jump = Math.abs(y - prev[1])
      const crossesView = (prev[1] > view.ymax && y < view.ymin) || (prev[1] < view.ymin && y > view.ymax)
      if (crossesView || jump > span * 4) {
        out.push(cur)
        cur = []
      }
    }
    cur.push([x, y])
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * Contour of z = 0 on a grid (marching squares): line segments in data
 * coordinates. z[j][i] is the value at (xs[i], ys[j]).
 */
export function contour(z: (number | null)[][], xs: number[], ys: number[]): [number, number, number, number][] {
  const segs: [number, number, number, number][] = []
  const lerp = (a: number, b: number, va: number, vb: number) => a + ((b - a) * va) / (va - vb)
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const v0 = z[j]?.[i]
      const v1 = z[j]?.[i + 1]
      const v2 = z[j + 1]?.[i + 1]
      const v3 = z[j + 1]?.[i]
      if (v0 == null || v1 == null || v2 == null || v3 == null) continue
      const x0 = xs[i]
      const x1 = xs[i + 1]
      const y0 = ys[j]
      const y1 = ys[j + 1]
      // edge crossings: bottom (v0-v1), right (v1-v2), top (v3-v2), left (v0-v3)
      const pts: [number, number][] = []
      if (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 0) continue
      if ((v0 < 0) !== (v1 < 0)) pts.push([lerp(x0, x1, v0, v1), y0])
      if ((v1 < 0) !== (v2 < 0)) pts.push([x1, lerp(y0, y1, v1, v2)])
      if ((v3 < 0) !== (v2 < 0)) pts.push([lerp(x0, x1, v3, v2), y1])
      if ((v0 < 0) !== (v3 < 0)) pts.push([x0, lerp(y0, y1, v0, v3)])
      // a sign flip that is a pole (huge values both sides) is not a curve
      const big = Math.max(Math.abs(v0), Math.abs(v1), Math.abs(v2), Math.abs(v3))
      const small = Math.min(Math.abs(v0), Math.abs(v1), Math.abs(v2), Math.abs(v3))
      if (big > 1e6 && small > 1e3) continue
      if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
      else if (pts.length === 4) {
        // saddle: decide by the centre value
        const c = (v0 + v1 + v2 + v3) / 4
        if ((c < 0) === (v0 < 0)) {
          segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]], [pts[2][0], pts[2][1], pts[3][0], pts[3][1]])
        } else {
          segs.push([pts[0][0], pts[0][1], pts[3][0], pts[3][1]], [pts[1][0], pts[1][1], pts[2][0], pts[2][1]])
        }
      }
    }
  }
  return segs
}

export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** Trace: the sample of a y = f(x) curve closest in x (linear interpolation between samples). */
export function traceAt(xs: (number | null)[], ys: (number | null)[], x: number): { x: number; y: number } | null {
  let best = -1
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    if (a === null || b === null) continue
    if ((a <= x && x <= b) || (b <= x && x <= a)) {
      best = i
      break
    }
  }
  if (best < 0) return null
  const x0 = xs[best]!
  const x1 = xs[best + 1]!
  const y0 = ys[best]
  const y1 = ys[best + 1]
  if (y0 === null || y1 === null) {
    const y = y0 ?? y1
    return y === null ? null : { x, y }
  }
  const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
  return { x, y: y0 + (y1 - y0) * t }
}

/** The point of a parametric/polar curve closest to (x, y) in screen units. */
export function nearestPoint(xs: (number | null)[], ys: (number | null)[], x: number, y: number, sx = 1, sy = 1): { x: number; y: number; i: number } | null {
  let best: { x: number; y: number; i: number } | null = null
  let bd = Infinity
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]
    const b = ys[i]
    if (a === null || b === null) continue
    const d = ((a - x) * sx) ** 2 + ((b - y) * sy) ** 2
    if (d < bd) {
      bd = d
      best = { x: a, y: b, i }
    }
  }
  return best
}

/** Colours of the graphs, readable on dark and light backgrounds. */
export const GRAPH_COLORS = ['#22b357', '#3b82f6', '#e8590c', '#d6336c', '#7c3aed', '#0ea5a4', '#ca8a04', '#64748b']
