// Electrical symbols: circuit components + building-installation markers.
// Ported from the desktop KhervePaint (electrical.py).

import type { Spec } from '../spec'
import { rad } from '../spec'

const _STK = '#222222'
// --------------------------------------------------------- circuit components
export function build_resistor(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'rect', x: w * 0.2, y: h * 0.32, w: w * 0.6, h: h * 0.36, stroke: _STK, width: 2, fill: 'none' },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_capacitor(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.42, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.42, y1: h * 0.25, x2: w * 0.42, y2: h * 0.75, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.25, x2: w * 0.58, y2: h * 0.75, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_polarized_capacitor(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.4, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.22, x2: w * 0.4, y2: h * 0.78, stroke: _STK, width: 2 },
    { shape: 'halfcircle', x: w * 0.5, y: h * 0.22, w: w * 0.12, h: h * 0.56, stroke: _STK, fill: 'none', width: 2, rotation: 90 },
    { shape: 'line', x1: w * 0.56, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.24, y1: h * 0.18, x2: w * 0.34, y2: h * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.29, y1: h * 0.1, x2: w * 0.29, y2: h * 0.26, stroke: _STK, width: 1.5 },
  ]
}

export function build_inductor(w: number, h: number): Spec[] {
  const out: Spec[] = [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
  const [n, span, bump_h] = [4, w * 0.6, h * 0.28]
  const d = span / n
  for (let i = 0; i < n; i++) {
    out.push({ shape: 'halfcircle', x: w * 0.2 + i * d, y: h * 0.5 - bump_h, w: d, h: bump_h * 2, stroke: _STK, fill: 'none', width: 2, rotation: 0 })
  }
  return out
}

export function build_diode(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.3, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'triangle', x: w * 0.3, y: h * 0.28, w: w * 0.32, h: h * 0.44, stroke: _STK, fill: _STK, width: 2, rotation: 90 },
    { shape: 'line', x1: w * 0.62, y1: h * 0.28, x2: w * 0.62, y2: h * 0.72, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.62, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_led(w: number, h: number): Spec[] {
  let ax, ay, bx, by
  const out = build_diode(w, h)
  for (const off of [0, 0.16]) {
    ;[ax, ay] = [w * 0.42 + off * w, h * 0.24 - off * h * 0.4]
    ;[bx, by] = [ax + w * 0.12, ay - h * 0.2]
    out.push({ shape: 'line', x1: ax, y1: ay, x2: bx, y2: by, stroke: _STK, width: 1.5 })
    out.push({ shape: 'triangle', x: bx - w * 0.045, y: by - h * 0.06, w: w * 0.09, h: h * 0.12, stroke: _STK, fill: _STK, width: 1.5, rotation: 45 })
  }
  return out
}

export function build_npn_transistor(w: number, h: number): Spec[] {
  return [
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.38, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.3, x2: w * 0.38, y2: h * 0.7, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.42, x2: w * 0.66, y2: h * 0.22, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.66, y1: h * 0.22, x2: w * 0.66, y2: 0, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.58, x2: w * 0.66, y2: h * 0.78, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.66, y1: h * 0.78, x2: w * 0.66, y2: h, stroke: _STK, width: 2 },
    { shape: 'triangle', x: w * 0.54, y: h * 0.62, w: w * 0.12, h: h * 0.16, stroke: _STK, fill: _STK, width: 1.5, rotation: 145 },
  ]
}

export function build_battery(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.28, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.28, y1: h * 0.2, x2: w * 0.28, y2: h * 0.8, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.34, x2: w * 0.4, y2: h * 0.66, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.56, y1: h * 0.2, x2: w * 0.56, y2: h * 0.8, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.34, x2: w * 0.68, y2: h * 0.66, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_dc_source(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.32, y1: h * 0.4, x2: w * 0.42, y2: h * 0.4, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.37, y1: h * 0.32, x2: w * 0.37, y2: h * 0.48, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.6, x2: w * 0.68, y2: h * 0.6, stroke: _STK, width: 1.5 },
  ]
}

export function build_ac_source(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'halfcircle', x: w * 0.33, y: h * 0.42, w: w * 0.17, h: h * 0.16, stroke: _STK, fill: 'none', width: 1.5, rotation: 0 },
    { shape: 'halfcircle', x: w * 0.5, y: h * 0.42, w: w * 0.17, h: h * 0.16, stroke: _STK, fill: 'none', width: 1.5, rotation: 180 },
  ]
}

export function build_ground(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h * 0.45, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.2, y1: h * 0.45, x2: w * 0.8, y2: h * 0.45, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.3, y1: h * 0.65, x2: w * 0.7, y2: h * 0.65, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.85, x2: w * 0.6, y2: h * 0.85, stroke: _STK, width: 2 },
  ]
}

export function build_switch(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.25, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.22, y: h * 0.46, w: w * 0.06, h: w * 0.06, stroke: _STK, fill: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.25, y1: h * 0.5, x2: w * 0.7, y2: h * 0.22, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.72, y: h * 0.46, w: w * 0.06, h: w * 0.06, stroke: _STK, fill: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.75, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_lamp(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.32, y1: h * 0.27, x2: w * 0.68, y2: h * 0.73, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.27, x2: w * 0.32, y2: h * 0.73, stroke: _STK, width: 1.5 },
  ]
}

export function build_fuse(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'rect', x: w * 0.2, y: h * 0.34, w: w * 0.6, h: h * 0.32, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.2, y1: h * 0.5, x2: w * 0.8, y2: h * 0.5, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function build_junction(w: number, h: number): Spec[] {
  return [
    { shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h, stroke: _STK, width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.42, y: h * 0.42, w: w * 0.16, h: w * 0.16, stroke: _STK, fill: _STK, width: 1.5 },
  ]
}

// ----------------------------------------------------- building installation
export function build_socket_outlet(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const [cx, base_y, r] = [w / 2, h / 2 + m * 0.18, m * 0.32]
  return [
    { shape: 'line', x1: cx - r * 1.4, y1: base_y, x2: cx + r * 1.4, y2: base_y, stroke: _STK, width: 2 },
    { shape: 'halfcircle', x: cx - r, y: base_y - r * 2, w: r * 2, h: r * 2, stroke: _STK, fill: 'none', width: 2, rotation: 0 },
    { shape: 'line', x1: cx, y1: base_y, x2: cx, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx - r * 0.5, y1: base_y, x2: cx - r * 0.5, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.5, y1: base_y, x2: cx + r * 0.5, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
  ]
}

export function build_double_socket(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const [cx, base_y, r] = [w / 2, h / 2 + m * 0.18, m * 0.32]
  return [
    { shape: 'line', x1: cx - r * 1.4, y1: base_y, x2: cx + r * 1.4, y2: base_y, stroke: _STK, width: 2 },
    { shape: 'halfcircle', x: cx - r, y: base_y - r * 2, w: r * 2, h: r * 2, stroke: _STK, fill: 'none', width: 2, rotation: 0 },
    { shape: 'line', x1: cx - r * 0.35, y1: base_y, x2: cx - r * 0.35, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.35, y1: base_y, x2: cx + r * 0.35, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx - r * 0.85, y1: base_y, x2: cx - r * 0.85, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.85, y1: base_y, x2: cx + r * 0.85, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
  ]
}

export function build_light_switch(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const [cx, cy, r] = [w / 2, h / 2, m * 0.16]
  const [x0, y0] = [cx - m * 0.34, cy + m * 0.34]
  return [
    { shape: 'circle', x: x0 - r, y: y0 - r, w: r * 2, h: r * 2, stroke: _STK, fill: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.3, y2: cy - m * 0.3, stroke: _STK, width: 2 },
    { shape: 'text', text: 'S', x: cx + m * 0.1, y: cy + m * 0.1, size: Math.max(Math.trunc(m * 0.3), 6), color: _STK },
  ]
}

export function build_two_way_switch(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const [cx, cy, r] = [w / 2, h / 2, m * 0.16]
  const [x0, y0] = [cx - m * 0.34, cy + m * 0.34]
  return [
    { shape: 'circle', x: x0 - r, y: y0 - r, w: r * 2, h: r * 2, stroke: _STK, fill: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.3, y2: cy - m * 0.3, stroke: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.36, y2: cy - m * 0.06, stroke: _STK, width: 1.5 },
    { shape: 'text', text: '2', x: cx - m * 0.05, y: cy + m * 0.12, size: Math.max(Math.trunc(m * 0.28), 6), color: _STK },
  ]
}

export function build_ceiling_light(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const d = m * 0.66
  const [x, y, r] = [(w - d) / 2, (h - d) / 2, d / 2]
  const [cx, cy] = [w / 2, h / 2]
  const off = r * Math.sin(Math.PI / 4)
  return [
    { shape: 'circle', x: x, y: y, w: d, h: d, stroke: _STK, width: 2, fill: 'none' },
    { shape: 'line', x1: cx - off, y1: cy - off, x2: cx + off, y2: cy + off, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + off, y1: cy - off, x2: cx - off, y2: cy + off, stroke: _STK, width: 1.5 },
  ]
}

export function build_wall_light(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const [cx, wall_y] = [w / 2, h / 2 + m * 0.22]
  const d = m * 0.5
  const r = d / 2
  const off = r * Math.sin(Math.PI / 4)
  return [
    { shape: 'line', x1: cx - m * 0.42, y1: wall_y, x2: cx + m * 0.42, y2: wall_y, stroke: _STK, width: 2 },
    { shape: 'halfcircle', x: cx - r, y: wall_y - d, w: d, h: d, stroke: _STK, fill: 'none', width: 2, rotation: 0 },
    { shape: 'line', x1: cx - off, y1: wall_y - off, x2: cx + off, y2: wall_y - off, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx, y1: wall_y - r * 1.05, x2: cx, y2: wall_y, stroke: _STK, width: 1.5 },
  ]
}

export function build_consumer_unit(w: number, h: number): Spec[] {
  let vx
  const [bw, bh] = [w * 0.74, h * 0.42]
  const [x, y] = [(w - bw) / 2, (h - bh) / 2]
  const specs: Spec[] = [{ shape: 'rect', x: x, y: y, w: bw, h: bh, stroke: _STK, fill: 'none', width: 2 }]
  for (let i = 1; i < 4; i++) {
    vx = x + bw * i / 4
    specs.push({ shape: 'line', x1: vx, y1: y, x2: vx, y2: y + bh, stroke: _STK, width: 1.5 })
  }
  return specs
}

export function build_junction_box(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const d = m * 0.5
  const [x, y] = [(w - d) / 2, (h - d) / 2]
  const [cx, cy, s] = [w / 2, h / 2, m * 0.16]
  return [
    { shape: 'circle', x: x, y: y, w: d, h: d, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: cx, y1: y - s, x2: cx, y2: y, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx, y1: y + d, x2: cx, y2: y + d + s, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: x - s, y1: cy, x2: x, y2: cy, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: x + d, y1: cy, x2: x + d + s, y2: cy, stroke: _STK, width: 1.5 },
  ]
}

export function build_ceiling_fan(w: number, h: number): Spec[] {
  let ang, ex, ey
  const m = Math.min(w, h)
  const [cx, cy] = [w / 2, h / 2]
  const [hub, bl, bw] = [m * 0.16, m * 0.36, m * 0.16]
  const specs: Spec[] = [{ shape: 'circle', x: cx - hub, y: cy - hub, w: hub * 2, h: hub * 2, stroke: _STK, fill: _STK, width: 2 }]
  for (let k = 0; k < 4; k++) {
    ang = rad(45 + 90 * k)
    ;[ex, ey] = [cx + Math.cos(ang) * bl, cy + Math.sin(ang) * bl]
    specs.push({ shape: 'ellipse', x: ex - bw, y: ey - bw * 0.4, w: bw * 2, h: bw * 0.8, stroke: _STK, fill: 'none', width: 1.5 })
    specs.push({ shape: 'line', x1: cx, y1: cy, x2: ex, y2: ey, stroke: _STK, width: 1.5 })
  }
  return specs
}

export function build_smoke_detector(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  const d = m * 0.66
  const [x, y] = [(w - d) / 2, (h - d) / 2]
  const [cx, cy] = [w / 2, h / 2]
  const di = d * 0.55
  const [xi, yi] = [(w - di) / 2, (h - di) / 2]
  return [
    { shape: 'circle', x: x, y: y, w: d, h: d, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'circle', x: xi, y: yi, w: di, h: di, stroke: _STK, fill: 'none', width: 1.5 },
    { shape: 'text', text: 'SD', x: cx - m * 0.14, y: cy + m * 0.1, size: Math.max(Math.trunc(m * 0.26), 6), color: _STK },
  ]
}

// : The page width represents this much real space (mm); symbols are sized
// : as a fraction of the page so components/installation markers fit on it.
export const REFERENCE_MM = 600
export const SIZES: Record<string, [number, number]> = { resistor: [24, 10], capacitor: [20, 14], polarized_capacitor: [20, 14], inductor: [28, 10], diode: [22, 12], led: [22, 16], npn_transistor: [18, 18], battery: [24, 14], dc_source: [18, 18], ac_source: [18, 18], ground: [12, 12], switch: [22, 12], lamp: [18, 18], fuse: [24, 10], junction: [8, 8], socket_outlet: [120, 120], double_socket: [140, 120], light_switch: [120, 120], two_way_switch: [120, 120], ceiling_light: [150, 150], wall_light: [140, 120], consumer_unit: [180, 120], junction_box: [120, 120], ceiling_fan: [160, 160], smoke_detector: [150, 150] }
export const LABELS: Record<string, string> = { resistor: 'Resistor', capacitor: 'Capacitor', polarized_capacitor: 'Polarised capacitor', inductor: 'Inductor', diode: 'Diode', led: 'LED', npn_transistor: 'NPN transistor', battery: 'Battery', dc_source: 'DC source', ac_source: 'AC source', ground: 'Ground', switch: 'Switch', lamp: 'Lamp', fuse: 'Fuse', junction: 'Junction', socket_outlet: 'Socket', double_socket: 'Double socket', light_switch: 'Light switch', two_way_switch: 'Two-way switch', ceiling_light: 'Ceiling light', wall_light: 'Wall light', consumer_unit: 'Consumer unit', junction_box: 'Junction box', ceiling_fan: 'Ceiling fan', smoke_detector: 'Smoke detector' }
export const CATEGORIES: [string, string[]][] = [['Components', ['resistor', 'capacitor', 'polarized_capacitor', 'inductor', 'diode', 'led', 'npn_transistor', 'fuse', 'switch', 'lamp']], ['Sources & ground', ['battery', 'dc_source', 'ac_source', 'ground', 'junction']], ['Installation (plan)', ['socket_outlet', 'double_socket', 'light_switch', 'two_way_switch', 'ceiling_light', 'wall_light', 'consumer_unit', 'junction_box', 'ceiling_fan', 'smoke_detector']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  resistor: build_resistor,
  capacitor: build_capacitor,
  polarized_capacitor: build_polarized_capacitor,
  inductor: build_inductor,
  diode: build_diode,
  led: build_led,
  npn_transistor: build_npn_transistor,
  battery: build_battery,
  dc_source: build_dc_source,
  ac_source: build_ac_source,
  ground: build_ground,
  switch: build_switch,
  lamp: build_lamp,
  fuse: build_fuse,
  junction: build_junction,
  socket_outlet: build_socket_outlet,
  double_socket: build_double_socket,
  light_switch: build_light_switch,
  two_way_switch: build_two_way_switch,
  ceiling_light: build_ceiling_light,
  wall_light: build_wall_light,
  consumer_unit: build_consumer_unit,
  junction_box: build_junction_box,
  ceiling_fan: build_ceiling_fan,
  smoke_detector: build_smoke_detector,
}
