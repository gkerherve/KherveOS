// Math, graph-axes, vector and symbol glyphs.
// Ported from the desktop KhervePaint (maths.py).

import type { Spec } from '../spec'

const _OUTLINE = '#333333'
const _CURVE = '#2b6cb0'
const _VECTOR = '#d9534f'
const _GRID = '#c8ced6'
export function build_axes_2d(w: number, h: number): Spec[] {
  const [ox, oy] = [w * 0.15, h * 0.85]
  const specs: Spec[] = [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
    { shape: 'text', text: 'x', x: w * 0.97, y: oy - h * 0.08, size: Math.min(w, h) * 0.12, color: _OUTLINE },
    { shape: 'text', text: 'y', x: ox + w * 0.07, y: h * 0.08, size: Math.min(w, h) * 0.12, color: _OUTLINE },
  ]
  return specs
}

export function build_axes_3d(w: number, h: number): Spec[] {
  const [ox, oy] = [w * 0.4, h * 0.5]
  const specs: Spec[] = [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.08, y2: h * 0.92, stroke: _OUTLINE, width: 2 },
    { shape: 'text', text: 'x', x: w * 0.97, y: oy - h * 0.07, size: Math.min(w, h) * 0.11, color: _OUTLINE },
    { shape: 'text', text: 'y', x: ox + w * 0.07, y: h * 0.08, size: Math.min(w, h) * 0.11, color: _OUTLINE },
    { shape: 'text', text: 'z', x: w * 0.05, y: h * 0.97, size: Math.min(w, h) * 0.11, color: _OUTLINE },
  ]
  return specs
}

export function build_number_line(w: number, h: number): Spec[] {
  let tx
  const cy = h * 0.5
  const ox = w * 0.08
  const specs: Spec[] = [{ shape: 'arrow', x1: ox, y1: cy, x2: w * 0.95, y2: cy, stroke: _OUTLINE, width: 2 }]
  const labels = ['-1', '0', '1', '2']
  const n = labels.length
  const span = w * 0.78
  const start = w * 0.12
  for (const [i, lab] of labels.entries()) {
    tx = start + span * (i / (n - 1))
    specs.push({ shape: 'line', x1: tx, y1: cy - h * 0.08, x2: tx, y2: cy + h * 0.08, stroke: _OUTLINE, width: 1.5 })
    specs.push({ shape: 'text', text: lab, x: tx, y: cy + h * 0.25, size: Math.min(w, h) * 0.16, color: _OUTLINE, anchor: 'center' })
  }
  return specs
}

export function build_grid_graph(w: number, h: number): Spec[] {
  let x, y
  const [ox, oy] = [w * 0.15, h * 0.85]
  const specs: Spec[] = []
  const n = 4
  const [gx0, gx1] = [ox, w * 0.92]
  const [gy0, gy1] = [h * 0.1, oy]
  for (let i = 1; i < n + 1; i++) {
    x = gx0 + (gx1 - gx0) * (i / n)
    specs.push({ shape: 'line', x1: x, y1: gy0, x2: x, y2: gy1, stroke: _GRID, width: 1.5 })
  }
  for (let i = 0; i < n; i++) {
    y = gy0 + (gy1 - gy0) * (i / n)
    specs.push({ shape: 'line', x1: gx0, y1: y, x2: gx1, y2: y, stroke: _GRID, width: 1.5 })
  }
  specs.push({ shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 })
  specs.push({ shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 })
  return specs
}

export function build_curve(w: number, h: number): Spec[] {
  let t, px, s, py, x1p, y1p, x2p, y2p
  const [ox, oy] = [w * 0.15, h * 0.85]
  const specs: Spec[] = [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
  ]
  const [x0, x1] = [w * 0.18, w * 0.92]
  const [ytop, ybot] = [h * 0.12, h * 0.82]
  const samples = 24
  const pts: number[][] = []
  for (let i = 0; i < samples + 1; i++) {
    t = i / samples
    px = x0 + (x1 - x0) * t
    s = 0.5 * (1 + Math.sin(Math.PI * (2 * t - 0.5)))
    py = ybot - (ybot - ytop) * s
    pts.push([px, py])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    ;[x1p, y1p] = pts[i]
    ;[x2p, y2p] = pts[i + 1]
    specs.push({ shape: 'line', x1: x1p, y1: y1p, x2: x2p, y2: y2p, stroke: _CURVE, width: 2 })
  }
  return specs
}

export function build_vector(w: number, h: number): Spec[] {
  const specs: Spec[] = [
    { shape: 'arrow', x1: w * 0.15, y1: h * 0.85, x2: w * 0.85, y2: h * 0.18, stroke: _VECTOR, width: 2 },
    { shape: 'text', text: 'v', x: w * 0.78, y: h * 0.32, size: Math.min(w, h) * 0.14, color: _VECTOR },
  ]
  return specs
}

export function build_angle_arc(w: number, h: number): Spec[] {
  let a, x1p, y1p, x2p, y2p
  const [vx, vy] = [w * 0.15, h * 0.85]
  const specs: Spec[] = [
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.92, y2: vy, stroke: _OUTLINE, width: 2 },
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.85, y2: h * 0.2, stroke: _OUTLINE, width: 2 },
  ]
  const r = Math.min(w, h) * 0.32
  const a0 = 0
  const a1 = Math.atan2(vy - h * 0.2, w * 0.85 - vx)
  const samples = 12
  const arc: number[][] = []
  for (let i = 0; i < samples + 1; i++) {
    a = a0 + (a1 - a0) * (i / samples)
    arc.push([vx + r * Math.cos(a), vy - r * Math.sin(a)])
  }
  for (let i = 0; i < arc.length - 1; i++) {
    ;[x1p, y1p] = arc[i]
    ;[x2p, y2p] = arc[i + 1]
    specs.push({ shape: 'line', x1: x1p, y1: y1p, x2: x2p, y2: y2p, stroke: _OUTLINE, width: 1.5 })
  }
  const mid = (a0 + a1) * 0.5
  const tr = r * 1.4
  specs.push({ shape: 'text', text: 'θ', x: vx + tr * Math.cos(mid), y: vy - tr * Math.sin(mid), size: Math.min(w, h) * 0.16, color: _OUTLINE })
  return specs
}

export function build_right_angle(w: number, h: number): Spec[] {
  const [vx, vy] = [w * 0.18, h * 0.82]
  const specs: Spec[] = [
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.92, y2: vy, stroke: _OUTLINE, width: 2 },
    { shape: 'line', x1: vx, y1: vy, x2: vx, y2: h * 0.1, stroke: _OUTLINE, width: 2 },
  ]
  const s = Math.min(w, h) * 0.18
  specs.push({ shape: 'line', x1: vx + s, y1: vy, x2: vx + s, y2: vy - s, stroke: _OUTLINE, width: 1.5 })
  specs.push({ shape: 'line', x1: vx, y1: vy - s, x2: vx + s, y2: vy - s, stroke: _OUTLINE, width: 1.5 })
  return specs
}

export function build_brace(w: number, h: number): Spec[] {
  const specs: Spec[] = [{ shape: 'text', text: '{', x: w * 0.5, y: h * 0.5, size: h * 0.95, color: _OUTLINE, anchor: 'center' }]
  return specs
}

function _glyph(w: number, h: number, glyph: string, color = _OUTLINE): Spec[] {
  return [{ shape: 'text', text: glyph, x: w * 0.5, y: h * 0.5, size: Math.min(w, h) * 0.7, color: color, anchor: 'center' }]
}

export function build_sum(w: number, h: number): Spec[] {
  return _glyph(w, h, 'Σ')
}

export function build_integral(w: number, h: number): Spec[] {
  return _glyph(w, h, '∫')
}

export function build_pi(w: number, h: number): Spec[] {
  return _glyph(w, h, 'π')
}

export function build_infinity(w: number, h: number): Spec[] {
  return _glyph(w, h, '∞')
}

export function build_delta(w: number, h: number): Spec[] {
  return _glyph(w, h, 'Δ')
}

export function build_theta(w: number, h: number): Spec[] {
  return _glyph(w, h, 'θ')
}

export const REFERENCE_MM = 1000
export const SIZES: Record<string, [number, number]> = { axes_2d: [220, 200], axes_3d: [220, 200], number_line: [220, 200], grid_graph: [220, 200], curve: [220, 200], vector: [200, 200], angle_arc: [200, 200], right_angle: [200, 200], brace: [120, 120], sum: [120, 120], integral: [120, 120], pi: [120, 120], infinity: [120, 120], delta: [120, 120], theta: [120, 120] }
export const LABELS: Record<string, string> = { axes_2d: '2D axes', axes_3d: '3D axes', number_line: 'Number line', grid_graph: 'Grid graph', curve: 'Curve plot', vector: 'Vector', angle_arc: 'Angle', right_angle: 'Right angle', brace: 'Brace {', sum: 'Sum Σ', integral: 'Integral ∫', pi: 'Pi π', infinity: 'Infinity ∞', delta: 'Delta Δ', theta: 'Theta θ' }
export const CATEGORIES: [string, string[]][] = [['Axes & graphs', ['axes_2d', 'axes_3d', 'number_line', 'grid_graph', 'curve']], ['Vectors & angles', ['vector', 'angle_arc', 'right_angle', 'brace']], ['Symbols', ['sum', 'integral', 'pi', 'infinity', 'delta', 'theta']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  axes_2d: build_axes_2d,
  axes_3d: build_axes_3d,
  number_line: build_number_line,
  grid_graph: build_grid_graph,
  curve: build_curve,
  vector: build_vector,
  angle_arc: build_angle_arc,
  right_angle: build_right_angle,
  brace: build_brace,
  sum: build_sum,
  integral: build_integral,
  pi: build_pi,
  infinity: build_infinity,
  delta: build_delta,
  theta: build_theta,
}
