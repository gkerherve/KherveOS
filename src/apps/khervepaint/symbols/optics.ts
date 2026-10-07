// Schematic optics / photonics symbols for beam-path diagrams.
// Ported from the desktop KhervePaint (optics.py).

import type { Spec } from '../spec'
import { rad } from '../spec'

// --- palette ---------------------------------------------------------
const _OUTLINE = '#333333'
const _METAL = '#dfe7ee'
const _GLASS = '#e8f0f5'
const _BEAM = '#d9534f'
const _DETECTOR = '#cfd6de'
const _LIGHT = '#fde7b0'  // soft light-cone / glow fill
const _RAY = '#e8a317'  // warm light ray
const _W2 = 2  // outline width
const _W1 = 1.2  // detail width
export const REFERENCE_MM = 600
// --- Sources & detectors --------------------------------------------
export function build_laser(w: number, h: number): Spec[] {
  const [bx, by] = [0.04 * w, 0.22 * h]
  const [bw, bh] = [0.62 * w, 0.56 * h]
  const cy = by + bh / 2
  return [
    { shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'rect', x: bx + bw, y: cy - 0.06 * h, w: 0.04 * w, h: 0.12 * h, stroke: _OUTLINE, fill: _METAL, width: _W1 },
    { shape: 'arrow', x1: bx + bw + 0.04 * w, y1: cy, x2: 0.98 * w, y2: cy, stroke: _BEAM, width: _W2 },
  ]
}

export function build_lamp(w: number, h: number): Spec[] {
  let a, x1, y1, x2, y2
  const [cx, cy] = [0.5 * w, 0.5 * h]
  const r = 0.26 * Math.min(w, h)
  const specs: Spec[] = [{ shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: _OUTLINE, fill: _GLASS, width: _W2 }]
  for (let i = 0; i < 8; i++) {
    a = i * Math.PI / 4
    x1 = cx + Math.cos(a) * r * 1.25
    y1 = cy + Math.sin(a) * r * 1.25
    x2 = cx + Math.cos(a) * r * 1.75
    y2 = cy + Math.sin(a) * r * 1.75
    specs.push({ shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: _BEAM, width: _W1 })
  }
  return specs
}

export function build_detector(w: number, h: number): Spec[] {
  const [bx, by] = [0.18 * w, 0.12 * h]
  const [bw, bh] = [0.7 * w, 0.76 * h]
  const cy = by + bh / 2
  const notch = 0.3 * h
  return [
    { shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _DETECTOR, width: _W2 },
    // concave face (shallow halfcircle notch) facing left
    { shape: 'halfcircle', x: bx - notch / 2, y: cy - notch / 2, w: notch, h: notch, stroke: _OUTLINE, fill: _GLASS, width: _W1, rotation: 90 },
  ]
}

export function build_photodiode(w: number, h: number): Spec[] {
  const [bx, by] = [0.2 * w, 0.18 * h]
  const s = 0.6 * Math.min(w, h)
  const [cx, cy] = [bx + s / 2, by + s / 2]
  return [
    { shape: 'rect', x: bx, y: by, w: s, h: s, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    // diagonal interface line
    { shape: 'line', x1: bx, y1: by + s, x2: bx + s, y2: by, stroke: _OUTLINE, width: _W1 },
    // two small in-pointing arrows (incident light)
    { shape: 'arrow', x1: bx - 0.18 * s, y1: by - 0.12 * s, x2: cx - 0.12 * s, y2: cy - 0.06 * s, stroke: _BEAM, width: _W1 },
    { shape: 'arrow', x1: bx - 0.06 * s, y1: by - 0.24 * s, x2: cx, y2: cy - 0.18 * s, stroke: _BEAM, width: _W1 },
  ]
}

export function build_camera(w: number, h: number): Spec[] {
  const [bx, by] = [0.06 * w, 0.18 * h]
  const [bw, bh] = [0.7 * w, 0.64 * h]
  const cy = by + bh / 2
  const lr = 0.16 * h
  const lcx = bx + bw
  return [
    { shape: 'rounded_rect', x: bx, y: by, w: bw, h: bh, radius: 0.08 * bw, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'circle', x: lcx - lr, y: cy - lr, w: 2 * lr, h: 2 * lr, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    { shape: 'circle', x: lcx - lr * 0.5, y: cy - lr * 0.5, w: lr, h: lr, stroke: _OUTLINE, fill: 'none', width: _W1 },
  ]
}

// --- Mirrors & beams -------------------------------------------------
export function build_mirror_flat(w: number, h: number): Spec[] {
  let y
  const bx = 0.34 * w
  const bw = 0.32 * w
  const [by, bh] = [0.06 * h, 0.88 * h]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _METAL, width: _W2 }]
  // hatch ticks down the back (right) side
  const n = 9
  for (let i = 0; i < n; i++) {
    y = by + bh * (i + 0.5) / n
    specs.push({ shape: 'line', x1: bx + bw, y1: y, x2: bx + bw + 0.22 * w, y2: y + 0.05 * h, stroke: _OUTLINE, width: _W1 })
  }
  return specs
}

export function build_mirror_curved(w: number, h: number): Spec[] {
  let t, ex, ey
  const [ax, ay] = [0.1 * w, 0.06 * h]
  const [aw, ah] = [0.5 * w, 0.88 * h]
  const specs: Spec[] = [{ shape: 'halfcircle', x: ax, y: ay, w: aw, h: ah, stroke: _OUTLINE, fill: 'none', width: _W2, rotation: 0 }]
  // hatch ticks on the convex back (right) side
  const n = 8
  const cx = ax + aw / 2
  const cy = ay + ah / 2
  const rx = aw / 2
  const ry = ah / 2
  for (let i = 0; i < n; i++) {
    t = -Math.PI / 2 + Math.PI * (i + 0.5) / n
    ex = cx + Math.cos(t) * rx
    ey = cy + Math.sin(t) * ry
    specs.push({ shape: 'line', x1: ex, y1: ey, x2: ex + 0.2 * w, y2: ey + 0.04 * h, stroke: _OUTLINE, width: _W1 })
  }
  return specs
}

export function build_beam_splitter(w: number, h: number): Spec[] {
  const [bx, by] = [0.18 * w, 0.12 * h]
  const s = 0.64 * Math.min(w, h)
  return [
    { shape: 'rect', x: bx, y: by, w: s, h: s, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    { shape: 'line', x1: bx, y1: by + s, x2: bx + s, y2: by, stroke: _OUTLINE, width: _W2 },
  ]
}

export function build_beam(w: number, h: number): Spec[] {
  const cy = 0.5 * h
  return [{ shape: 'arrow', x1: 0.02 * w, y1: cy, x2: 0.98 * w, y2: cy, stroke: _BEAM, width: _W2 }]
}

// --- Lenses & elements ----------------------------------------------
export function build_lens_convex(w: number, h: number): Spec[] {
  const cx = 0.5 * w
  const ew = 0.5 * w
  const [ey, eh] = [0.06 * h, 0.88 * h]
  return [
    { shape: 'ellipse', x: cx - ew / 2, y: ey, w: ew, h: eh, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    { shape: 'line', x1: cx, y1: ey, x2: cx, y2: ey + eh, stroke: _OUTLINE, width: _W1 },
    { shape: 'arrow', x1: cx, y1: ey + eh * 0.2, x2: cx, y2: ey - 0.04 * h, stroke: _OUTLINE, width: _W1 },
    { shape: 'arrow', x1: cx, y1: ey + eh * 0.8, x2: cx, y2: ey + eh + 0.04 * h, stroke: _OUTLINE, width: _W1 },
  ]
}

export function build_lens_concave(w: number, h: number): Spec[] {
  const cx = 0.5 * w
  const bw = 0.34 * w
  const bx = cx - bw / 2
  const [by, bh] = [0.08 * h, 0.84 * h]
  const bite = 0.26 * w
  return [
    { shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    // left bite (concave side) — halfcircle facing right
    { shape: 'halfcircle', x: bx - bite / 2, y: by + bh / 2 - bite, w: bite, h: 2 * bite, stroke: _OUTLINE, fill: '#ffffff', width: _W1, rotation: 90 },
    // right bite — halfcircle facing left
    { shape: 'halfcircle', x: bx + bw - bite / 2, y: by + bh / 2 - bite, w: bite, h: 2 * bite, stroke: _OUTLINE, fill: '#ffffff', width: _W1, rotation: 270 },
    // in-pointing tips top and bottom
    { shape: 'arrow', x1: cx, y1: by - 0.06 * h, x2: cx, y2: by + 0.14 * h, stroke: _OUTLINE, width: _W1 },
    { shape: 'arrow', x1: cx, y1: by + bh + 0.06 * h, x2: cx, y2: by + bh - 0.14 * h, stroke: _OUTLINE, width: _W1 },
  ]
}

export function build_prism(w: number, h: number): Spec[] {
  return [{ shape: 'triangle', x: 0.08 * w, y: 0.1 * h, w: 0.84 * w, h: 0.8 * h, rotation: 0, stroke: _OUTLINE, fill: _GLASS, width: _W2 }]
}

export function build_grating(w: number, h: number): Spec[] {
  let x
  const [bx, by] = [0.22 * w, 0.06 * h]
  const [bw, bh] = [0.56 * w, 0.88 * h]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _GLASS, width: _W2 }]
  const n = 12
  for (let i = 1; i < n; i++) {
    x = bx + bw * i / n
    specs.push({ shape: 'line', x1: x, y1: by, x2: x, y2: by + bh, stroke: _OUTLINE, width: _W1 })
  }
  return specs
}

export function build_polarizer(w: number, h: number): Spec[] {
  let ox, oy
  const [cx, cy] = [0.5 * w, 0.5 * h]
  const r = 0.38 * Math.min(w, h)
  const d = r / Math.sqrt(2)
  const specs: Spec[] = [
    { shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    // transmission axis (main diagonal)
    { shape: 'line', x1: cx - d, y1: cy + d, x2: cx + d, y2: cy - d, stroke: _OUTLINE, width: _W2 },
  ]
  // a couple of short parallel lines
  for (const off of [-0.5 * r, 0.5 * r]) {
    ox = off / Math.sqrt(2)
    oy = off / Math.sqrt(2)
    specs.push({ shape: 'line', x1: cx - 0.4 * d + ox, y1: cy + 0.4 * d + oy, x2: cx + 0.4 * d + ox, y2: cy - 0.4 * d + oy, stroke: _OUTLINE, width: _W1 })
  }
  return specs
}

export function build_aperture(w: number, h: number): Spec[] {
  const [cx, cy] = [0.5 * w, 0.5 * h]
  const r = 0.42 * Math.min(w, h)
  const rin = 0.16 * Math.min(w, h)
  return [
    { shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'circle', x: cx - rin, y: cy - rin, w: 2 * rin, h: 2 * rin, stroke: _OUTLINE, fill: '#ffffff', width: _W1 },
  ]
}

export function build_filter(w: number, h: number): Spec[] {
  const [bx, by] = [0.1 * w, 0.14 * h]
  const [bw, bh] = [0.8 * w, 0.72 * h]
  const tab = 0.16 * w
  return [
    { shape: 'rounded_rect', x: bx, y: by, w: bw, h: bh, radius: 0.06 * bw, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
    // small corner label tab
    { shape: 'rect', x: bx + bw - tab, y: by, w: tab, h: 0.18 * h, stroke: _OUTLINE, fill: _METAL, width: _W1 },
  ]
}

// --- Components ------------------------------------------------------
export function build_sample(w: number, h: number): Spec[] {
  const [fx, fy] = [0.16 * w, 0.16 * h]
  const [fw, fh] = [0.68 * w, 0.68 * h]
  const s = 0.3 * Math.min(w, h)
  const [cx, cy] = [0.5 * w, 0.5 * h]
  return [
    // thin holder frame
    { shape: 'rect', x: fx, y: fy, w: fw, h: fh, stroke: _OUTLINE, fill: 'none', width: _W1 },
    // sample square centred
    { shape: 'rect', x: cx - s / 2, y: cy - s / 2, w: s, h: s, stroke: _OUTLINE, fill: _GLASS, width: _W2 },
  ]
}

export function build_monochromator(w: number, h: number): Spec[] {
  const [bx, by] = [0.06 * w, 0.1 * h]
  const [bw, bh] = [0.88 * w, 0.8 * h]
  const cy = by + bh / 2
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: _METAL, width: _W2 }]
  // slit ticks on opposite sides
  const slit = 0.18 * h
  specs.push({ shape: 'rect', x: bx - 0.02 * w, y: cy - slit / 2, w: 0.04 * w, h: slit, stroke: _OUTLINE, fill: '#ffffff', width: _W1 })
  specs.push({ shape: 'rect', x: bx + bw - 0.02 * w, y: cy - slit / 2, w: 0.04 * w, h: slit, stroke: _OUTLINE, fill: '#ffffff', width: _W1 })
  // internal grating line
  const gx = bx + bw * 0.6
  specs.push({ shape: 'line', x1: gx, y1: by + bh * 0.25, x2: gx, y2: by + bh * 0.75, stroke: _OUTLINE, width: _W2 })
  return specs
}

// --- Lighting / illumination ----------------------------------------
// A cone of light to shine down onto an object: a source dot at the
// top widening into a pale beam with edge rays.
export function build_light_cone(w: number, h: number): Spec[] {
  const cx = 0.5 * w
  return [
    { shape: 'triangle', x: 0.12 * w, y: 0.14 * h, w: 0.76 * w, h: 0.8 * h, rotation: 0, stroke: _RAY, fill: _LIGHT, width: _W1 },
    { shape: 'line', x1: cx, y1: 0.16 * h, x2: 0.33 * w, y2: 0.9 * h, stroke: _RAY, width: _W1 },
    { shape: 'line', x1: cx, y1: 0.16 * h, x2: 0.67 * w, y2: 0.9 * h, stroke: _RAY, width: _W1 },
    { shape: 'circle', x: cx - 0.06 * w, y: 0.04 * h, w: 0.12 * w, h: 0.12 * w, stroke: _OUTLINE, fill: _RAY, width: _W1 },
  ]
}

// A focused spotlight: lamp head casting a narrow cone onto a hotspot.
export function build_spotlight(w: number, h: number): Spec[] {
  const cx = 0.5 * w
  return [
    { shape: 'trapezoid', x: 0.1 * w, y: 0.28 * h, w: 0.8 * w, h: 0.52 * h, rotation: 0, stroke: _RAY, fill: _LIGHT, width: _W1 },
    { shape: 'trapezoid', x: 0.3 * w, y: 0.04 * h, w: 0.4 * w, h: 0.24 * h, rotation: 0, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'circle', x: cx - 0.06 * w, y: 0.15 * h, w: 0.12 * w, h: 0.12 * w, stroke: _OUTLINE, fill: _RAY, width: _W1 },
    { shape: 'ellipse', x: 0.2 * w, y: 0.82 * h, w: 0.6 * w, h: 0.13 * h, stroke: _RAY, fill: _LIGHT, width: _W1 },
  ]
}

// A broad floodlight: rectangular fixture with a wide light spread.
export function build_floodlight(w: number, h: number): Spec[] {
  return [
    { shape: 'trapezoid', x: 0.02 * w, y: 0.32 * h, w: 0.96 * w, h: 0.6 * h, rotation: 0, stroke: _RAY, fill: _LIGHT, width: _W1 },
    { shape: 'rect', x: 0.24 * w, y: 0.06 * h, w: 0.52 * w, h: 0.24 * h, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'line', x1: 0.42 * w, y1: 0.06 * h, x2: 0.42 * w, y2: 0.3 * h, stroke: _OUTLINE, width: _W1 },
    { shape: 'line', x1: 0.58 * w, y1: 0.06 * h, x2: 0.58 * w, y2: 0.3 * h, stroke: _OUTLINE, width: _W1 },
    { shape: 'line', x1: 0.24 * w, y1: 0.18 * h, x2: 0.12 * w, y2: 0.18 * h, stroke: _OUTLINE, width: _W2 },
    { shape: 'line', x1: 0.76 * w, y1: 0.18 * h, x2: 0.88 * w, y2: 0.18 * h, stroke: _OUTLINE, width: _W2 },
  ]
}

// An adjustable desk lamp shining a cone of light onto the bench.
export function build_desk_lamp(w: number, h: number): Spec[] {
  return [
    { shape: 'ellipse', x: 0.08 * w, y: 0.9 * h, w: 0.44 * w, h: 0.08 * h, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'line', x1: 0.3 * w, y1: 0.9 * h, x2: 0.34 * w, y2: 0.4 * h, stroke: _OUTLINE, width: _W2 },
    { shape: 'line', x1: 0.34 * w, y1: 0.4 * h, x2: 0.6 * w, y2: 0.22 * h, stroke: _OUTLINE, width: _W2 },
    { shape: 'trapezoid', x: 0.48 * w, y: 0.12 * h, w: 0.34 * w, h: 0.2 * h, rotation: 0, stroke: _OUTLINE, fill: _METAL, width: _W2 },
    { shape: 'triangle', x: 0.44 * w, y: 0.3 * h, w: 0.5 * w, h: 0.52 * h, rotation: 0, stroke: _RAY, fill: _LIGHT, width: _W1 },
  ]
}

// An incandescent light bulb (glass + filament + screw base) with
// emitted rays.
export function build_bulb(w: number, h: number): Spec[] {
  let y, ang, r0, r1
  const cx = 0.5 * w
  const d = 0.52 * w
  const [gx, gy] = [cx - d / 2, 0.1 * h]
  const ccy = gy + d / 2
  const specs: Spec[] = [
    { shape: 'circle', x: gx, y: gy, w: d, h: d, stroke: _OUTLINE, fill: _LIGHT, width: _W2 },
    { shape: 'line', x1: cx - 0.09 * w, y1: gy + d * 0.72, x2: cx - 0.03 * w, y2: gy + d * 0.45, stroke: _RAY, width: _W1 },
    { shape: 'line', x1: cx - 0.03 * w, y1: gy + d * 0.45, x2: cx + 0.03 * w, y2: gy + d * 0.55, stroke: _RAY, width: _W1 },
    { shape: 'line', x1: cx + 0.03 * w, y1: gy + d * 0.55, x2: cx + 0.09 * w, y2: gy + d * 0.3, stroke: _RAY, width: _W1 },
    { shape: 'rect', x: cx - 0.12 * w, y: gy + d - 0.005 * h, w: 0.24 * w, h: 0.16 * h, stroke: _OUTLINE, fill: _METAL, width: _W1 },
  ]
  for (const i of [1, 2]) {
    y = gy + d + 0.05 * h * i
    specs.push({ shape: 'line', x1: cx - 0.12 * w, y1: y, x2: cx + 0.12 * w, y2: y, stroke: _OUTLINE, width: _W1 })
  }
  for (const a of [-70, -35, 0, 35, 70]) {
    ang = rad(a - 90)
    ;[r0, r1] = [d * 0.6, d * 0.85]
    specs.push({ shape: 'line', x1: cx + r0 * Math.cos(ang), y1: ccy + r0 * Math.sin(ang), x2: cx + r1 * Math.cos(ang), y2: ccy + r1 * Math.sin(ang), stroke: _RAY, width: _W1 })
  }
  return specs
}

// An LED (domed emitter on two leads) with the two emitted-light arrows.
export function build_led(w: number, h: number): Spec[] {
  const cx = 0.5 * w
  const [dw, dh] = [0.5 * w, 0.42 * h]
  const [dx, dy] = [cx - dw / 2, 0.28 * h]
  return [
    { shape: 'halfcircle', x: dx, y: dy, w: dw, h: dh, rotation: 0, stroke: _OUTLINE, fill: _LIGHT, width: _W2 },
    { shape: 'line', x1: dx, y1: dy + dh, x2: dx + dw, y2: dy + dh, stroke: _OUTLINE, width: _W2 },
    { shape: 'line', x1: cx - 0.1 * w, y1: dy + dh, x2: cx - 0.1 * w, y2: 0.94 * h, stroke: _OUTLINE, width: _W2 },
    { shape: 'line', x1: cx + 0.1 * w, y1: dy + dh, x2: cx + 0.1 * w, y2: 0.94 * h, stroke: _OUTLINE, width: _W2 },
    { shape: 'arrow', x1: dx + 0.2 * dw, y1: dy + 0.05 * dh, x2: dx - 0.1 * dw, y2: dy - 0.28 * dh, stroke: _RAY, width: _W1 },
    { shape: 'arrow', x1: dx + 0.42 * dw, y1: dy - 0.05 * dh, x2: dx + 0.14 * dw, y2: dy - 0.36 * dh, stroke: _RAY, width: _W1 },
  ]
}

// A ring illuminator: an annulus of LEDs shining inward on a sample.
export function build_ring_light(w: number, h: number): Spec[] {
  let a, dx, dy
  const [cx, cy] = [0.5 * w, 0.5 * h]
  const m = Math.min(w, h)
  const [r, ri] = [0.44 * m, 0.24 * m]
  const specs: Spec[] = [
    { shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: _OUTLINE, fill: _LIGHT, width: _W2 },
    { shape: 'circle', x: cx - ri, y: cy - ri, w: 2 * ri, h: 2 * ri, stroke: _OUTLINE, fill: '#ffffff', width: _W1 },
  ]
  const [rm, dd] = [(r + ri) / 2, 0.035 * m]
  for (let i = 0; i < 12; i++) {
    a = rad(i * 30)
    ;[dx, dy] = [cx + rm * Math.cos(a), cy + rm * Math.sin(a)]
    specs.push({ shape: 'circle', x: dx - dd, y: dy - dd, w: 2 * dd, h: 2 * dd, stroke: _OUTLINE, fill: _RAY, width: _W1 })
  }
  for (let i = 0; i < 4; i++) {
    a = rad(i * 90 + 45)
    specs.push({ shape: 'line', x1: cx + ri * 0.95 * Math.cos(a), y1: cy + ri * 0.95 * Math.sin(a), x2: cx + ri * 0.3 * Math.cos(a), y2: cy + ri * 0.3 * Math.sin(a), stroke: _RAY, width: _W1 })
  }
  return specs
}

// A sparkle / glint to drop on an object to show it is lit or shiny.
export function build_shine(w: number, h: number): Spec[] {
  let ang
  const [cx, cy] = [0.5 * w, 0.5 * h]
  const m = Math.min(w, h)
  const specs: Spec[] = []
  for (const a of [0, 90, 180, 270]) {
    ang = rad(a)
    specs.push({ shape: 'line', x1: cx, y1: cy, x2: cx + 0.46 * m * Math.cos(ang), y2: cy + 0.46 * m * Math.sin(ang), stroke: _RAY, width: _W2 })
  }
  for (const a of [45, 135, 225, 315]) {
    ang = rad(a)
    specs.push({ shape: 'line', x1: cx, y1: cy, x2: cx + 0.26 * m * Math.cos(ang), y2: cy + 0.26 * m * Math.sin(ang), stroke: _RAY, width: _W1 })
  }
  const dd = 0.12 * m
  specs.push({ shape: 'circle', x: cx - dd, y: cy - dd, w: 2 * dd, h: 2 * dd, stroke: _RAY, fill: _LIGHT, width: _W1 })
  return specs
}

// --- registry / metadata --------------------------------------------
export const SIZES: Record<string, [number, number]> = { laser: [140, 60], lamp: [80, 80], detector: [90, 90], photodiode: [80, 80], camera: [110, 80], mirror_flat: [40, 120], mirror_curved: [50, 120], beam_splitter: [80, 80], beam: [160, 20], lens_convex: [40, 120], lens_concave: [40, 120], prism: [90, 80], grating: [40, 110], polarizer: [80, 80], aperture: [80, 80], filter: [90, 70], sample: [70, 70], monochromator: [160, 120], light_cone: [120, 140], spotlight: [120, 140], floodlight: [140, 120], desk_lamp: [130, 150], bulb: [90, 130], led: [80, 120], ring_light: [110, 110], shine: [90, 90] }
export const LABELS: Record<string, string> = { laser: 'Laser', lamp: 'Lamp / source', detector: 'Detector', photodiode: 'Photodiode', camera: 'Camera', mirror_flat: 'Flat mirror', mirror_curved: 'Curved mirror', beam_splitter: 'Beam splitter', beam: 'Beam path', lens_convex: 'Convex lens', lens_concave: 'Concave lens', prism: 'Prism', grating: 'Grating', polarizer: 'Polarizer', aperture: 'Aperture / iris', filter: 'Filter', sample: 'Sample', monochromator: 'Monochromator', light_cone: 'Light cone', spotlight: 'Spotlight', floodlight: 'Floodlight', desk_lamp: 'Desk lamp', bulb: 'Light bulb', led: 'LED', ring_light: 'Ring light', shine: 'Shine / glint' }
export const CATEGORIES: [string, string[]][] = [['Sources & detectors', ['laser', 'lamp', 'detector', 'photodiode', 'camera']], ['Mirrors & beams', ['mirror_flat', 'mirror_curved', 'beam_splitter', 'beam']], ['Lenses & elements', ['lens_convex', 'lens_concave', 'prism', 'grating', 'polarizer', 'aperture', 'filter']], ['Components', ['sample', 'monochromator']], ['Lighting', ['light_cone', 'spotlight', 'floodlight', 'desk_lamp', 'bulb', 'led', 'ring_light', 'shine']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  laser: build_laser,
  lamp: build_lamp,
  detector: build_detector,
  photodiode: build_photodiode,
  camera: build_camera,
  mirror_flat: build_mirror_flat,
  mirror_curved: build_mirror_curved,
  beam_splitter: build_beam_splitter,
  beam: build_beam,
  lens_convex: build_lens_convex,
  lens_concave: build_lens_concave,
  prism: build_prism,
  grating: build_grating,
  polarizer: build_polarizer,
  aperture: build_aperture,
  filter: build_filter,
  sample: build_sample,
  monochromator: build_monochromator,
  light_cone: build_light_cone,
  spotlight: build_spotlight,
  floodlight: build_floodlight,
  desk_lamp: build_desk_lamp,
  bulb: build_bulb,
  led: build_led,
  ring_light: build_ring_light,
  shine: build_shine,
}
