// Top-view room-layout elements: walls, doors, furniture, fittings.
// Ported from the desktop KhervePaint (floorplan.py).

import type { Spec } from '../spec'
import { rad } from '../spec'

// Quarter/any arc as a polyline of line specs (precise control over
// centre/radius/angles; angles in degrees, screen coords with y down).
function _arc(cx: number, cy: number, r: number, a0_deg: number, a1_deg: number, width = 1.5, n = 20): Spec[] {
  let a, pt
  const out: Spec[] = []
  let prev = null
  for (let i = 0; i < n + 1; i++) {
    a = rad(a0_deg + (a1_deg - a0_deg) * i / n)
    pt = [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    if (prev != null) {
      out.push({ shape: 'line', x1: prev[0], y1: prev[1], x2: pt[0], y2: pt[1], stroke: '#333333', width: width })
    }
    prev = pt
  }
  return out
}

// --------------------------------------------------------- walls & openings
export function build_wall(w: number, h: number): Spec[] {
  return [{ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: '#333333', width: 2, fill: '#444444' }]
}

export function build_door(w: number, h: number): Spec[] {
  // Single door hinged top-left: open leaf points down, quarter-circle
  // swing of radius = opening width back to the far jamb.
  const jamb = Math.min(w, h) * 0.1
  let specs: Spec[] = [
    { shape: 'rect', x: 0, y: 0, w: jamb, h: jamb, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'rect', x: w - jamb, y: 0, w: jamb, h: jamb, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'line', x1: 0, y1: 0, x2: 0, y2: h, stroke: '#333333', width: 2 },
  ]  // open leaf
  specs.push(..._arc(0, 0, w, 0, 90, 1.5))  // swing arc
  return specs
}

export function build_double_door(w: number, h: number): Spec[] {
  // Two leaves hinged at the outer top jambs; each quarter-circle swing
  // (radius = half the opening) meets the other in a cusp at the bottom
  // centre.  (SIZES keeps width = 2*height so the arcs reach the centre.)
  const jamb = Math.min(w, h) * 0.16
  const leaf = h * 0.34
  let specs: Spec[] = [
    { shape: 'line', x1: 0, y1: h, x2: w, y2: h, stroke: '#333333', width: 2 },
    { shape: 'rect', x: 0, y: 0, w: jamb, h: jamb, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'rect', x: w - jamb, y: 0, w: jamb, h: jamb, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'line', x1: 0, y1: 0, x2: 0, y2: leaf, stroke: '#333333', width: 2 },
    { shape: 'line', x1: w, y1: 0, x2: w, y2: leaf, stroke: '#333333', width: 2 },
  ]  // threshold; left leaf; right leaf
  specs.push(..._arc(0, h, h, -90, 0, 1.5))  // left swing
  specs.push(..._arc(w, h, h, -90, -180, 1.5))  // right swing
  return specs
}

export function build_window(w: number, h: number): Spec[] {
  const band = h * 0.3
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'rect', x: 0, y: (h - band) * 0.5, w: w, h: band, stroke: '#333333', width: 1.5, fill: '#cfe3f2' },
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: '#333333', width: 1.5 },
  ]
}

export function build_opening(w: number, h: number): Spec[] {
  const stub = w * 0.28
  return [
    { shape: 'rect', x: 0, y: 0, w: stub, h: h, stroke: '#333333', width: 2, fill: '#444444' },
    { shape: 'rect', x: w - stub, y: 0, w: stub, h: h, stroke: '#333333', width: 2, fill: '#444444' },
  ]
}

export function build_stairs(w: number, h: number): Spec[] {
  let x
  const n = 9
  let specs: Spec[] = [{ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: '#333333', width: 2, fill: 'none' }]
  for (let i = 1; i < n; i++) {
    x = w * i / n
    specs.push({ shape: 'line', x1: x, y1: 0, x2: x, y2: h, stroke: '#333333', width: 1.5 })
  }
  const [ax0, ax1, cy, head] = [w * 0.08, w * 0.92, h * 0.5, w * 0.05]
  specs.push({ shape: 'line', x1: ax0, y1: cy, x2: ax1, y2: cy, stroke: '#333333', width: 1.5 }, { shape: 'line', x1: ax1, y1: cy, x2: ax1 - head, y2: cy - head, stroke: '#333333', width: 1.5 }, { shape: 'line', x1: ax1, y1: cy, x2: ax1 - head, y2: cy + head, stroke: '#333333', width: 1.5 })
  return specs
}

// --------------------------------------------------------------------- palette
// Shared colours/weights for the furniture & fixture symbols, refined to
// match a professional top-view plan-symbol sheet (clean line-art).
export const OUTLINE = '#333333'  // outlines
const _INK = OUTLINE
export const WOOD = '#e8dcc8'  // wood / table tops
const _WOOD = WOOD
export const WOOD_DK = '#d9c2a3'  // darker wood
export const BEDDING = '#eef2f6'  // bedding / light upholstery / appliances
const _UPH2 = BEDDING
const _APP = BEDDING
export const PILLOW = '#dfe7ee'  // pillows / upholstery / metal
const _UPH = PILLOW
const _MET = PILLOW
const _WTR = 'white'  // water / porcelain
const _GRN = '#dfe9dc'  // plant green
const _NONE = 'none'
export const W_OUT = 2  // outline width
const _W_OUT = W_OUT
export const W_DET = 1.2  // detail width
const _W_DET = W_DET
// ------------------------------------------------------------------ bedroom
export function build_single_bed(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  // mattress
  specs.push({ shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.04, stroke: OUTLINE, fill: BEDDING, width: W_OUT })
  // turned-down duvet band across the head
  const band = h * 0.16
  specs.push({ shape: 'rect', x: w * 0.04, y: band, w: w * 0.92, h: h * 0.78, stroke: OUTLINE, fill: 'none', width: W_DET })
  // soft fold lines down the bed
  for (const fx of [0.34, 0.66]) {
    specs.push({ shape: 'line', x1: w * fx, y1: band + h * 0.04, x2: w * fx, y2: h * 0.92, stroke: OUTLINE, width: W_DET })
  }
  // plump pillow at the head
  specs.push({ shape: 'rounded_rect', x: w * 0.14, y: h * 0.03, w: w * 0.72, h: band * 0.78, radius: band * 0.32, stroke: OUTLINE, fill: PILLOW, width: W_DET })
  return specs
}

export function build_double_bed(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.04, stroke: OUTLINE, fill: BEDDING, width: W_OUT })
  const band = h * 0.15
  specs.push({ shape: 'rect', x: w * 0.04, y: band, w: w * 0.92, h: h * 0.8, stroke: OUTLINE, fill: 'none', width: W_DET })
  // centre fold line down the duvet
  specs.push({ shape: 'line', x1: w * 0.5, y1: band + h * 0.04, x2: w * 0.5, y2: h * 0.93, stroke: OUTLINE, width: W_DET })
  // two pillows side by side at the head
  const pw = w * 0.4
  const ph = band * 0.78
  specs.push({ shape: 'rounded_rect', x: w * 0.06, y: h * 0.03, w: pw, h: ph, radius: ph * 0.32, stroke: OUTLINE, fill: PILLOW, width: W_DET })
  specs.push({ shape: 'rounded_rect', x: w * 0.54, y: h * 0.03, w: pw, h: ph, radius: ph * 0.32, stroke: OUTLINE, fill: PILLOW, width: W_DET })
  return specs
}

export function build_nightstand(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: OUTLINE, fill: WOOD, width: W_OUT })
  // round table lamp on top: outer shade + inner base
  const [cx, cy] = [w * 0.5, h * 0.5]
  const r_out = Math.min(w, h) * 0.32
  const r_in = Math.min(w, h) * 0.13
  specs.push({ shape: 'circle', x: cx - r_out, y: cy - r_out, w: r_out * 2, h: r_out * 2, stroke: OUTLINE, fill: 'none', width: W_DET })
  specs.push({ shape: 'circle', x: cx - r_in, y: cy - r_in, w: r_in * 2, h: r_in * 2, stroke: OUTLINE, fill: 'none', width: W_DET })
  return specs
}

export function build_wardrobe(w: number, h: number): Spec[] {
  let hx
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: OUTLINE, fill: WOOD, width: W_OUT })
  // hanging rail line near the back
  const rail_y = h * 0.3
  specs.push({ shape: 'line', x1: w * 0.06, y1: rail_y, x2: w * 0.94, y2: rail_y, stroke: OUTLINE, width: W_DET })
  // hanger ticks (clothes on the rail)
  const n = 6
  const tick = h * 0.16
  for (let i = 0; i < n; i++) {
    hx = w * (0.12 + 0.76 * i / (n - 1))
    specs.push({ shape: 'line', x1: hx, y1: rail_y, x2: hx, y2: rail_y + tick, stroke: OUTLINE, width: W_DET })
  }
  // centre division line
  specs.push({ shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h, stroke: OUTLINE, width: W_DET })
  return specs
}

export function build_chest_of_drawers(w: number, h: number): Spec[] {
  let dy, dh, kr, kx, ky
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: OUTLINE, fill: WOOD, width: W_OUT })
  const n = 3
  const inset = w * 0.05
  for (let i = 0; i < n; i++) {
    dy = h * (0.08 + 0.84 * i / n)
    dh = h * 0.84 / n
    specs.push({ shape: 'rect', x: inset, y: dy, w: w - 2 * inset, h: dh * 0.86, stroke: OUTLINE, fill: 'none', width: W_DET })
    kr = Math.min(dh, w) * 0.06
    ;[kx, ky] = [w * 0.5, dy + dh * 0.43]
    specs.push({ shape: 'circle', x: kx - kr, y: ky - kr, w: kr * 2, h: kr * 2, stroke: OUTLINE, fill: OUTLINE, width: W_DET })
  }
  return specs
}

export function build_desk(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: OUTLINE, fill: WOOD, width: W_OUT })
  // laptop: base rect + thin screen line (hinge at the back, small y)
  const [lw, lh, lx, ly] = [w * 0.22, h * 0.3, w * 0.2, h * 0.34]
  specs.push({ shape: 'rect', x: lx, y: ly, w: lw, h: lh, stroke: OUTLINE, fill: 'none', width: W_DET })
  specs.push({ shape: 'line', x1: lx, y1: ly, x2: lx + lw, y2: ly, stroke: OUTLINE, width: W_OUT })
  // pen tray line near the front
  specs.push({ shape: 'line', x1: w * 0.6, y1: h * 0.74, x2: w * 0.88, y2: h * 0.74, stroke: OUTLINE, width: W_DET })
  return specs
}

// ---------------------------------------------------------- living & dining
export function build_dining_table(w: number, h: number): Spec[] {
  const m = Math.min(w, h)
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: m * 0.08, stroke: '#333333', width: 2, fill: '#e8dcc8' },
    { shape: 'rounded_rect', x: w * 0.06, y: h * 0.08, w: w * 0.88, h: h * 0.84, radius: m * 0.05, stroke: '#333333', width: 1.5, fill: '#d9c2a3' },
  ]
}

// Armchair from above: U-shaped back+arms shell open at the bottom,
// square-ish seat cushion inside.
export function build_chair(w: number, h: number): Spec[] {
  const s: Spec[] = []
  s.push({ shape: 'rounded_rect', x: 0.06 * w, y: 0.04 * h, w: 0.88 * w, h: 0.92 * h, radius: 0.22 * w, stroke: _INK, fill: _UPH2, width: _W_OUT })
  s.push({ shape: 'rounded_rect', x: 0.24 * w, y: 0.3 * h, w: 0.52 * w, h: 0.74 * h, radius: 0.1 * w, stroke: _INK, fill: _NONE, width: _W_DET })
  s.push({ shape: 'rounded_rect', x: 0.27 * w, y: 0.4 * h, w: 0.46 * w, h: 0.5 * h, radius: 0.08 * w, stroke: _INK, fill: _UPH, width: _W_DET })
  return s
}

// Plumper armchair: rounded shell (half-circle back) with arms and a
// soft seat cushion.
export function build_armchair(w: number, h: number): Spec[] {
  const s: Spec[] = []
  s.push({ shape: 'rounded_rect', x: 0.04 * w, y: 0.03 * h, w: 0.92 * w, h: 0.94 * h, radius: 0.3 * w, stroke: _INK, fill: _UPH2, width: _W_OUT })
  s.push({ shape: 'halfcircle', x: 0.12 * w, y: 0.06 * h, w: 0.76 * w, h: 0.46 * h, stroke: _INK, fill: _UPH2, width: _W_DET, rotation: 0 })
  s.push({ shape: 'rounded_rect', x: 0.05 * w, y: 0.3 * h, w: 0.17 * w, h: 0.58 * h, radius: 0.07 * w, stroke: _INK, fill: _UPH2, width: _W_DET })
  s.push({ shape: 'rounded_rect', x: 0.78 * w, y: 0.3 * h, w: 0.17 * w, h: 0.58 * h, radius: 0.07 * w, stroke: _INK, fill: _UPH2, width: _W_DET })
  s.push({ shape: 'rounded_rect', x: 0.25 * w, y: 0.42 * h, w: 0.5 * w, h: 0.5 * h, radius: 0.14 * w, stroke: _INK, fill: _UPH, width: _W_DET })
  return s
}

// Wide 3-seater: rounded back, two arm bolsters at the ends, three seat
// cushions in a row, three back cushions behind them.
export function build_sofa(w: number, h: number): Spec[] {
  const s: Spec[] = []
  s.push({ shape: 'rounded_rect', x: 0.01 * w, y: 0.04 * h, w: 0.98 * w, h: 0.92 * h, radius: 0.1 * h, stroke: _INK, fill: _UPH2, width: _W_OUT })
  s.push({ shape: 'rounded_rect', x: 0.015 * w, y: 0.12 * h, w: 0.085 * w, h: 0.8 * h, radius: 0.04 * w, stroke: _INK, fill: _UPH2, width: _W_DET })
  s.push({ shape: 'rounded_rect', x: 0.9 * w, y: 0.12 * h, w: 0.085 * w, h: 0.8 * h, radius: 0.04 * w, stroke: _INK, fill: _UPH2, width: _W_DET })
  const seat_x0 = 0.115 * w
  const seat_w = 0.77 * w
  const cw = seat_w / 3
  for (let i = 0; i < 3; i++) {
    s.push({ shape: 'rounded_rect', x: seat_x0 + i * cw + 0.01 * w, y: 0.1 * h, w: cw - 0.02 * w, h: 0.3 * h, radius: 0.05 * w / 3 + 0.01 * w, stroke: _INK, fill: _UPH2, width: _W_DET })
  }
  for (let i = 0; i < 3; i++) {
    s.push({ shape: 'rounded_rect', x: seat_x0 + i * cw + 0.01 * w, y: 0.42 * h, w: cw - 0.02 * w, h: 0.5 * h, radius: 0.05 * w / 3 + 0.01 * w, stroke: _INK, fill: _UPH, width: _W_DET })
  }
  return s
}

// Rounded-rect table with a thin inner outline.
export function build_coffee_table(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0.02 * w, y: 0.04 * h, w: 0.96 * w, h: 0.92 * h, radius: 0.1 * h, stroke: _INK, fill: _WOOD, width: _W_OUT },
    { shape: 'rounded_rect', x: 0.07 * w, y: 0.12 * h, w: 0.86 * w, h: 0.76 * h, radius: 0.08 * h, stroke: _INK, fill: _NONE, width: _W_DET },
  ]
}

// Long shallow cabinet with door divisions and a small TV slab line.
export function build_tv_unit(w: number, h: number): Spec[] {
  let x, cx
  const s: Spec[] = [{ shape: 'rect', x: 0.01 * w, y: 0.3 * h, w: 0.98 * w, h: 0.66 * h, stroke: _INK, fill: _WOOD, width: _W_OUT }]
  for (const i of [1, 2]) {
    x = 0.01 * w + i * (0.98 * w) / 3
    s.push({ shape: 'line', x1: x, y1: 0.3 * h, x2: x, y2: 0.96 * h, stroke: _INK, width: _W_DET })
  }
  for (let i = 0; i < 3; i++) {
    cx = 0.01 * w + (i + 0.5) * (0.98 * w) / 3
    s.push({ shape: 'line', x1: cx - 0.03 * w, y1: 0.88 * h, x2: cx + 0.03 * w, y2: 0.88 * h, stroke: _INK, width: _W_DET })
  }
  s.push({ shape: 'rect', x: 0.28 * w, y: 0.1 * h, w: 0.44 * w, h: 0.1 * h, stroke: _INK, fill: _UPH2, width: _W_DET })
  return s
}

// Long shallow rect with vertical shelf divisions.
export function build_bookshelf(w: number, h: number): Spec[] {
  let x
  const s: Spec[] = [{ shape: 'rect', x: 0.01 * w, y: 0.1 * h, w: 0.98 * w, h: 0.8 * h, stroke: _INK, fill: _WOOD, width: _W_OUT }]
  const n = 5
  for (let i = 1; i < n; i++) {
    x = 0.01 * w + i * (0.98 * w) / n
    s.push({ shape: 'line', x1: x, y1: 0.1 * h, x2: x, y2: 0.9 * h, stroke: _INK, width: _W_DET })
  }
  return s
}

// Round dining table (circle + inner ring) with 4 U-shaped chairs around
// it (top/bottom/left/right), each facing the table.
export function build_round_table(w: number, h: number): Spec[] {
  let s: Spec[] = []
  const t = 0.2  // margin around the table for the chairs
  s.push({ shape: 'circle', x: t * w, y: t * h, w: (1 - 2 * t) * w, h: (1 - 2 * t) * h, stroke: _INK, fill: _WOOD, width: _W_OUT })
  s.push({ shape: 'circle', x: (t + 0.05) * w, y: (t + 0.05) * h, w: (1 - 2 * t - 0.1) * w, h: (1 - 2 * t - 0.1) * h, stroke: _INK, fill: _NONE, width: _W_DET })
  const cw = 0.26 * w
  const ch = 0.16 * h
  const rad = 0.06 * w
  function _chair(cx: number, cy: number, side: string): Spec[] {
    let sw, sh
    const out: Spec[] = []
    if (['t', 'b'].includes(side)) {
      ;[sw, sh] = [cw, ch]
    } else {
      ;[sw, sh] = [ch, cw]
    }
    const [x0, y0] = [cx - sw / 2, cy - sh / 2]
    out.push({ shape: 'rounded_rect', x: x0, y: y0, w: sw, h: sh, radius: rad, stroke: _INK, fill: _UPH2, width: _W_DET })
    const m = 0.22
    if (side === 't') {
      out.push({ shape: 'rounded_rect', x: x0 + m * sw, y: y0 + 0.45 * sh, w: (1 - 2 * m) * sw, h: 0.5 * sh, radius: rad * 0.6, stroke: _INK, fill: _UPH, width: _W_DET })
    } else if (side === 'b') {
      out.push({ shape: 'rounded_rect', x: x0 + m * sw, y: y0 + 0.05 * sh, w: (1 - 2 * m) * sw, h: 0.5 * sh, radius: rad * 0.6, stroke: _INK, fill: _UPH, width: _W_DET })
    } else if (side === 'l') {
      out.push({ shape: 'rounded_rect', x: x0 + 0.45 * sw, y: y0 + m * sh, w: 0.5 * sw, h: (1 - 2 * m) * sh, radius: rad * 0.6, stroke: _INK, fill: _UPH, width: _W_DET })
    } else {
      out.push({ shape: 'rounded_rect', x: x0 + 0.05 * sw, y: y0 + m * sh, w: 0.5 * sw, h: (1 - 2 * m) * sh, radius: rad * 0.6, stroke: _INK, fill: _UPH, width: _W_DET })
    }
    return out
  }
  s.push(..._chair(0.5 * w, 0.085 * h, 't'))
  s.push(..._chair(0.5 * w, 0.915 * h, 'b'))
  s.push(..._chair(0.085 * w, 0.5 * h, 'l'))
  s.push(..._chair(0.915 * w, 0.5 * h, 'r'))
  return s
}

// ------------------------------------------------------------------ kitchen
export function build_kitchen_counter(w: number, h: number): Spec[] {
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.85, x2: w, y2: h * 0.85, stroke: _INK, width: 1.2 },
  ]
}

export function build_kitchen_sink(w: number, h: number): Spec[] {
  const bw = w * 0.38
  const bx0 = w * 0.07
  const bx1 = w - bx0 - bw
  const by = h * 0.3
  const bh = h * 0.56
  const r = Math.min(w, h) * 0.04
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'rounded_rect', x: bx0, y: by, w: bw, h: bh, radius: r, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'rounded_rect', x: bx1, y: by, w: bw, h: bh, radius: r, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'line', x1: w * 0.5, y1: h * 0.1, x2: w * 0.5, y2: h * 0.24, stroke: _INK, width: 1.2 },
    { shape: 'circle', x: w * 0.46, y: h * 0.06, w: w * 0.08, h: w * 0.08, stroke: _INK, fill: _MET, width: 1.2 },
  ]
}

export function build_stove(w: number, h: number): Spec[] {
  let ox, oy, inset
  const specs: Spec[] = [{ shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 }]
  const od = w * 0.3
  for (const [cx, cy] of [[0.14, 0.28], [0.56, 0.28], [0.14, 0.6], [0.56, 0.6]]) {
    ;[ox, oy] = [w * cx, h * cy]
    specs.push({ shape: 'circle', x: ox, y: oy, w: od, h: od, stroke: _INK, fill: _WTR, width: 1.2 })
    inset = od * 0.28
    specs.push({ shape: 'circle', x: ox + inset, y: oy + inset, w: od - 2 * inset, h: od - 2 * inset, stroke: _INK, fill: _WTR, width: 1.2 })
  }
  const kd = w * 0.07
  for (const kx of [0.18, 0.4, 0.6, 0.82]) {
    specs.push({ shape: 'circle', x: w * kx - kd * 0.5, y: h * 0.1 - kd * 0.5, w: kd, h: kd, stroke: _INK, fill: _MET, width: 1.2 })
  }
  return specs
}

export function build_fridge(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.05, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h, stroke: _INK, width: 1.2 },
    { shape: 'line', x1: w * 0.42, y1: h * 0.38, x2: w * 0.42, y2: h * 0.62, stroke: _INK, width: 1.2 },
  ]
}

export function build_kitchen_island(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.05, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: w * 0.05, y1: h * 0.78, x2: w * 0.95, y2: h * 0.78, stroke: _INK, width: 1.2 },
    { shape: 'rounded_rect', x: w * 0.62, y: h * 0.18, w: w * 0.26, h: h * 0.4, radius: Math.min(w, h) * 0.04, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'circle', x: w * 0.735, y: h * 0.05, w: w * 0.03, h: w * 0.03, stroke: _INK, fill: _MET, width: 1.2 },
  ]
}

export function build_dishwasher(w: number, h: number): Spec[] {
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.18, x2: w, y2: h * 0.18, stroke: _INK, width: 1.2 },
    { shape: 'line', x1: w * 0.3, y1: h * 0.42, x2: w * 0.7, y2: h * 0.42, stroke: _INK, width: 1.2 },
  ]
}

// --------------------------------------------------------- bathroom & utility
export function build_toilet(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: w * 0.2, y: 0, w: w * 0.6, h: h * 0.24, radius: w * 0.05, stroke: _INK, fill: _WTR, width: 2 },
    { shape: 'ellipse', x: w * 0.22, y: h * 0.22, w: w * 0.56, h: h * 0.74, stroke: _INK, fill: _WTR, width: 2 },
    { shape: 'ellipse', x: w * 0.3, y: h * 0.32, w: w * 0.4, h: h * 0.54, stroke: _INK, fill: _WTR, width: 1.2 },
  ]
}

export function build_bathroom_sink(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.05, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: w * 0.5, y1: h * 0.08, x2: w * 0.5, y2: h * 0.2, stroke: _INK, width: 1.2 },
    { shape: 'circle', x: w * 0.46, y: h * 0.04, w: w * 0.08, h: w * 0.08, stroke: _INK, fill: _MET, width: 1.2 },
    { shape: 'ellipse', x: w * 0.18, y: h * 0.26, w: w * 0.64, h: h * 0.62, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'circle', x: w * 0.475, y: h * 0.52, w: w * 0.05, h: w * 0.05, stroke: _INK, fill: _WTR, width: 1.2 },
  ]
}

export function build_bathtub(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: h * 0.2, stroke: _INK, fill: _WTR, width: 2 },
    { shape: 'rounded_rect', x: w * 0.05, y: h * 0.12, w: w * 0.8, h: h * 0.76, radius: h * 0.16, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'circle', x: w * 0.89, y: h * 0.46, w: h * 0.08, h: h * 0.08, stroke: _INK, fill: _MET, width: 1.2 },
  ]
}

export function build_shower(w: number, h: number): Spec[] {
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'quartercircle', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: 'none', width: 1.2, rotation: 0 },
    { shape: 'circle', x: w * 0.44, y: h * 0.44, w: w * 0.12, h: w * 0.12, stroke: _INK, fill: _WTR, width: 1.2 },
    { shape: 'circle', x: w * 0.47, y: h * 0.47, w: w * 0.06, h: w * 0.06, stroke: _INK, fill: _WTR, width: 1.2 },
  ]
}

export function build_washing_machine(w: number, h: number): Spec[] {
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _APP, width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.18, x2: w, y2: h * 0.18, stroke: _INK, width: 1.2 },
    { shape: 'rect', x: w * 0.1, y: h * 0.07, w: w * 0.18, h: h * 0.06, stroke: _INK, fill: _MET, width: 1.2 },
    { shape: 'circle', x: w * 0.22, y: h * 0.3, w: w * 0.56, h: w * 0.56, stroke: _INK, fill: _WTR, width: 2 },
    { shape: 'circle', x: w * 0.31, y: h * 0.39, w: w * 0.38, h: w * 0.38, stroke: _INK, fill: _MET, width: 1.2 },
  ]
}

// -------------------------------------------------------------------- decor
export function build_plant(w: number, h: number): Spec[] {
  let a, ca, sa
  const specs: Spec[] = [
    { shape: 'circle', x: 0, y: 0, w: w, h: h, stroke: _INK, fill: _GRN, width: 2 },
    { shape: 'circle', x: w * 0.3, y: h * 0.3, w: w * 0.4, h: h * 0.4, stroke: _INK, fill: _GRN, width: 1.2 },
  ]
  const [cx, cy] = [w * 0.5, h * 0.5]
  const r0 = Math.min(w, h) * 0.2
  const r1 = Math.min(w, h) * 0.42
  for (let i = 0; i < 10; i++) {
    a = rad(i * 36)
    ;[ca, sa] = [Math.cos(a), Math.sin(a)]
    specs.push({ shape: 'line', x1: cx + r0 * ca, y1: cy + r0 * sa, x2: cx + r1 * ca, y2: cy + r1 * sa, stroke: _INK, width: 1.2 })
  }
  const lw = Math.min(w, h) * 0.16
  for (let i = 0; i < 5; i++) {
    a = i * 72
    specs.push({ shape: 'triangle', x: cx - lw * 0.5, y: cy - lw * 0.9, w: lw, h: lw * 0.9, stroke: _INK, fill: _GRN, width: 1.2, rotation: a })
  }
  return specs
}

export function build_rug(w: number, h: number): Spec[] {
  let y
  const specs: Spec[] = [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: Math.min(w, h) * 0.06, stroke: _INK, fill: 'none', width: 2 },
    { shape: 'rounded_rect', x: w * 0.06, y: h * 0.06, w: w * 0.88, h: h * 0.88, radius: Math.min(w, h) * 0.04, stroke: _INK, fill: 'none', width: 1.2 },
  ]
  const n = 9
  const fr = w * 0.03
  for (let i = 0; i < n; i++) {
    y = h * (i + 0.5) / n
    specs.push({ shape: 'line', x1: -fr, y1: y, x2: 0, y2: y, stroke: _INK, width: 1.2 })
    specs.push({ shape: 'line', x1: w, y1: y, x2: w + fr, y2: y, stroke: _INK, width: 1.2 })
  }
  return specs
}

// : The page width represents this much real space (mm), so a whole room
// : fits the drawing — a 480 mm chair is then ~1/10 of the page.
export const REFERENCE_MM = 4800
// : Real-world plan size (width_mm, depth_mm) for each element.
export const SIZES: Record<string, [number, number]> = { wall: [2000, 150], door: [900, 900], double_door: [1800, 900], window: [1200, 150], opening: [900, 150], stairs: [2400, 1000], single_bed: [900, 1900], double_bed: [1500, 2000], wardrobe: [1000, 600], nightstand: [450, 400], chest_of_drawers: [800, 450], desk: [1200, 600], dining_table: [1600, 900], round_table: [1400, 1400], chair: [550, 550], sofa: [2100, 950], armchair: [900, 850], coffee_table: [1100, 600], tv_unit: [1800, 450], bookshelf: [900, 300], kitchen_counter: [600, 600], kitchen_sink: [800, 600], stove: [600, 600], fridge: [700, 700], kitchen_island: [1800, 900], dishwasher: [600, 600], toilet: [400, 700], bathroom_sink: [600, 450], bathtub: [1700, 750], shower: [900, 900], washing_machine: [600, 600], plant: [500, 500], rug: [2000, 1400] }
// : Display name per element.
export const LABELS: Record<string, string> = { wall: 'Wall', door: 'Door', double_door: 'Double door', window: 'Window', opening: 'Opening', stairs: 'Stairs', single_bed: 'Single bed', double_bed: 'Double bed', wardrobe: 'Wardrobe', nightstand: 'Nightstand', chest_of_drawers: 'Chest of drawers', desk: 'Desk', dining_table: 'Dining table', round_table: 'Round table', chair: 'Chair', sofa: 'Sofa', armchair: 'Armchair', coffee_table: 'Coffee table', tv_unit: 'TV unit', bookshelf: 'Bookshelf', kitchen_counter: 'Counter', kitchen_sink: 'Sink', stove: 'Stove / hob', fridge: 'Fridge', kitchen_island: 'Island', dishwasher: 'Dishwasher', toilet: 'Toilet', bathroom_sink: 'Basin', bathtub: 'Bathtub', shower: 'Shower', washing_machine: 'Washing machine', plant: 'Plant', rug: 'Rug' }
// : Menu sections: (section title, [element names]).
export const CATEGORIES: [string, string[]][] = [['Walls & openings', ['wall', 'door', 'double_door', 'window', 'opening', 'stairs']], ['Bedroom', ['single_bed', 'double_bed', 'wardrobe', 'nightstand', 'chest_of_drawers', 'desk']], ['Living & dining', ['dining_table', 'round_table', 'chair', 'sofa', 'armchair', 'coffee_table', 'tv_unit', 'bookshelf']], ['Kitchen', ['kitchen_counter', 'kitchen_sink', 'stove', 'fridge', 'kitchen_island', 'dishwasher']], ['Bathroom & utility', ['toilet', 'bathroom_sink', 'bathtub', 'shower', 'washing_machine']], ['Decor', ['plant', 'rug']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  wall: build_wall,
  door: build_door,
  double_door: build_double_door,
  window: build_window,
  opening: build_opening,
  stairs: build_stairs,
  single_bed: build_single_bed,
  double_bed: build_double_bed,
  wardrobe: build_wardrobe,
  nightstand: build_nightstand,
  chest_of_drawers: build_chest_of_drawers,
  desk: build_desk,
  dining_table: build_dining_table,
  round_table: build_round_table,
  chair: build_chair,
  sofa: build_sofa,
  armchair: build_armchair,
  coffee_table: build_coffee_table,
  tv_unit: build_tv_unit,
  bookshelf: build_bookshelf,
  kitchen_counter: build_kitchen_counter,
  kitchen_sink: build_kitchen_sink,
  stove: build_stove,
  fridge: build_fridge,
  kitchen_island: build_kitchen_island,
  dishwasher: build_dishwasher,
  toilet: build_toilet,
  bathroom_sink: build_bathroom_sink,
  bathtub: build_bathtub,
  shower: build_shower,
  washing_machine: build_washing_machine,
  plant: build_plant,
  rug: build_rug,
}
