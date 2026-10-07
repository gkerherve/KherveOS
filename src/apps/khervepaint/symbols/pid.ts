// Process & instrumentation (P&ID) / process-flow diagram symbols.
// Ported from the desktop KhervePaint (pid.py).

import type { Spec } from '../spec'
import { pmod, rad } from '../spec'

export const OUTLINE = '#333333'
export const EQUIP = '#eef2f6'
export const METAL = '#dfe7ee'
export const WHITE = '#ffffff'
export const NONE = 'none'
export const W_OUT = 2
export const W_DET = 1.2
// ---------------------------------------------------------------- Vessels
// Vertical storage tank: rect body, domed top, short legs.
export function build_tank(w: number, h: number): Spec[] {
  const bx = w * 0.18
  const bw = w * 0.64
  const top = h * 0.12
  const body_top = h * 0.2
  const body_bot = h * 0.86
  const bh = body_bot - body_top
  const specs: Spec[] = []
  specs.push({ shape: 'halfcircle', x: bx, y: top, w: bw, h: body_top - top, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 0 })
  specs.push({ shape: 'rect', x: bx, y: body_top, w: bw, h: bh, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  specs.push({ shape: 'line', x1: bx + bw * 0.18, y1: body_bot, x2: bx + bw * 0.18, y2: h * 0.98, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: bx + bw * 0.82, y1: body_bot, x2: bx + bw * 0.82, y2: h * 0.98, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Horizontal drum: rect body, domed ends, two saddles.
export function build_vessel(w: number, h: number): Spec[] {
  const left = w * 0.12
  const right = w * 0.88
  const body_top = h * 0.3
  const body_bot = h * 0.7
  const bh = body_bot - body_top
  const cap_w = w * 0.12
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: left, y: body_top, w: right - left, h: bh, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  specs.push({ shape: 'halfcircle', x: left - cap_w, y: body_top, w: cap_w * 2, h: bh, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 270 })
  specs.push({ shape: 'halfcircle', x: right - cap_w, y: body_top, w: cap_w * 2, h: bh, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 90 })
  for (const cx of [left + (right - left) * 0.25, left + (right - left) * 0.75]) {
    specs.push({ shape: 'trapezoid', x: cx - w * 0.07, y: body_bot, w: w * 0.14, h: h * 0.18, stroke: OUTLINE, fill: METAL, width: W_OUT, rotation: 180 })
  }
  return specs
}

// Tall distillation column with internal tray lines.
export function build_column(w: number, h: number): Spec[] {
  let ty
  const bx = w * 0.28
  const bw = w * 0.44
  const top = h * 0.05
  const bh = h * 0.9
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: bx, y: top, w: bw, h: bh, radius: bw * 0.45, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  const n = 6
  for (let i = 1; i < n + 1; i++) {
    ty = top + bh * (i / (n + 1))
    specs.push({ shape: 'line', x1: bx + bw * 0.1, y1: ty, x2: bx + bw * 0.9, y2: ty, stroke: OUTLINE, width: W_DET })
  }
  return specs
}

// Stirred reactor: jacketed vessel with stirrer shaft + impeller.
export function build_reactor(w: number, h: number): Spec[] {
  const jx = w * 0.16
  const jw = w * 0.68
  const jtop = h * 0.12
  const jh = h * 0.78
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: jx, y: jtop, w: jw, h: jh, radius: jw * 0.2, stroke: OUTLINE, fill: METAL, width: W_OUT })
  const ix = w * 0.24
  const iw = w * 0.52
  const itop = h * 0.18
  const ih = h * 0.66
  specs.push({ shape: 'rounded_rect', x: ix, y: itop, w: iw, h: ih, radius: iw * 0.3, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  const cx = w * 0.5
  specs.push({ shape: 'line', x1: cx, y1: h * 0.02, x2: cx, y2: h * 0.66, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: cx - iw * 0.22, y1: h * 0.66, x2: cx + iw * 0.22, y2: h * 0.66, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Shell-and-tube exchanger: shell, zigzag tube, two nozzles.
export function build_heat_exchanger(w: number, h: number): Spec[] {
  let nx, ny
  const left = w * 0.1
  const right = w * 0.9
  const top = h * 0.3
  const bot = h * 0.7
  const sh = bot - top
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: left, y: top, w: right - left, h: sh, radius: sh * 0.45, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  const n = 5
  const x0 = left + (right - left) * 0.1
  const x1 = right - (right - left) * 0.1
  const span = x1 - x0
  const hi = top + sh * 0.28
  const lo = bot - sh * 0.28
  let px = x0
  let py = (hi + lo) / 2
  for (let i = 0; i < n + 1; i++) {
    nx = x0 + span * (i / n)
    ny = pmod(i, 2) === 0 ? hi : lo
    specs.push({ shape: 'line', x1: px, y1: py, x2: nx, y2: ny, stroke: OUTLINE, width: W_DET })
    ;[px, py] = [nx, ny]
  }
  specs.push({ shape: 'line', x1: left + (right - left) * 0.2, y1: top, x2: left + (right - left) * 0.2, y2: h * 0.12, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: left + (right - left) * 0.8, y1: bot, x2: left + (right - left) * 0.8, y2: h * 0.88, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Inverted trapezoid (wide top, narrow bottom) with outlet stub.
export function build_hopper(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'trapezoid', x: w * 0.12, y: h * 0.12, w: w * 0.76, h: h * 0.66, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 180 })
  specs.push({ shape: 'rect', x: w * 0.44, y: h * 0.78, w: w * 0.12, h: h * 0.14, stroke: OUTLINE, fill: METAL, width: W_OUT })
  return specs
}

// ------------------------------------------------------- Rotating equipment
// Centrifugal pump: circle, impeller triangle, tangential discharge.
export function build_pump(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const cy = h * 0.62
  const d = Math.min(w, h) * 0.6
  const r = d / 2
  const specs: Spec[] = []
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: d, h: d, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  specs.push({ shape: 'triangle', x: cx - r * 0.45, y: cy - r * 0.45, w: r * 0.9, h: r * 0.9, stroke: OUTLINE, fill: METAL, width: W_DET, rotation: 90 })
  specs.push({ shape: 'line', x1: cx + r * 0.55, y1: cy - r * 0.84, x2: cx + r * 0.55, y2: h * 0.06, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: cx + r * 0.55, y1: h * 0.06, x2: cx + r * 1.05, y2: h * 0.06, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: cx - r, y1: cy, x2: w * 0.04, y2: cy, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Converging trapezoid body with inlet/outlet stubs.
export function build_compressor(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'trapezoid', x: w * 0.18, y: h * 0.22, w: w * 0.64, h: h * 0.56, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 90 })
  const cy = h * 0.5
  specs.push({ shape: 'line', x1: w * 0.18, y1: cy, x2: w * 0.04, y2: cy, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: w * 0.82, y1: cy, x2: w * 0.96, y2: cy, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Blower: circle (volute scroll) with curved fan blades.
export function build_blower(w: number, h: number): Spec[] {
  let a
  const cx = w * 0.46
  const cy = h * 0.54
  const d = Math.min(w, h) * 0.62
  const r = d / 2
  const specs: Spec[] = []
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: d, h: d, stroke: OUTLINE, fill: EQUIP, width: W_OUT })
  specs.push({ shape: 'circle', x: cx - r * 0.18, y: cy - r * 0.18, w: r * 0.36, h: r * 0.36, stroke: OUTLINE, fill: METAL, width: W_DET })
  for (let k = 0; k < 6; k++) {
    a = rad(k * 60)
    specs.push({ shape: 'line', x1: cx + r * 0.2 * Math.cos(a), y1: cy + r * 0.2 * Math.sin(a), x2: cx + r * 0.8 * Math.cos(a), y2: cy + r * 0.8 * Math.sin(a), stroke: OUTLINE, width: W_DET })
  }
  specs.push({ shape: 'line', x1: cx + r * 0.7, y1: cy - r * 0.7, x2: w * 0.94, y2: h * 0.1, stroke: OUTLINE, width: W_OUT })
  return specs
}

// ----------------------------------------------------------------- Valves
// Filled triangle whose APEX is at (cx, cy), `base` wide, reaching
// `length` in `direction` ('l','r','u','d'), built so the rotated bounding
// box keeps the intended proportions (no aspect distortion).
function _tri_pointing(cx: number, cy: number, length: number, base: number, direction: string): Spec {
  let x, y, rot, cxb
  if (['u', 'd'].includes(direction)) {
    if (direction === 'u') {  // triangle below the seat, apex up
      ;[x, y, rot] = [cx - base * 0.5, cy, 0]
    } else {
      ;[x, y, rot] = [cx - base * 0.5, cy - length, 180]
    }
    return { shape: 'triangle', x: x, y: y, w: base, h: length, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: rot }
  }
  if (direction === 'r') {
    ;[cxb, rot] = [cx - length * 0.5, 90]
  } else {
    ;[cxb, rot] = [cx + length * 0.5, 270]
  }
  return { shape: 'triangle', x: cxb - base * 0.5, y: cy - length * 0.5, w: base, h: length, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: rot }
}

// Two triangles tip-to-tip, apexes meeting cleanly at the centre.
function _bowtie(w: number, h: number, cy: number | null = null): [Spec[], number, number, number] {
  if (cy == null) {
    cy = h * 0.5
  }
  const cx = w * 0.5
  const half = w * 0.4
  const th = h * 0.4
  const specs: Spec[] = [
    _tri_pointing(cx, cy, half, th, 'r'),
    _tri_pointing(cx, cy, half, th, 'l'),
  ]
  return [specs, cx, cy, th]
}

// Bow-tie with a short stem.
export function build_gate_valve(w: number, h: number): Spec[] {
  const [specs, cx, cy, th] = _bowtie(w, h)
  specs.push({ shape: 'line', x1: cx, y1: cy - th * 0.05, x2: cx, y2: h * 0.14, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Bow-tie with a filled centre circle (the globe).
export function build_globe_valve(w: number, h: number): Spec[] {
  const [specs, cx, cy, th] = _bowtie(w, h)
  const r = th * 0.3
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: OUTLINE, fill: METAL, width: W_DET })
  specs.push({ shape: 'line', x1: cx, y1: cy - r, x2: cx, y2: h * 0.14, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Bow-tie with a centre circle outline + small handle line.
export function build_ball_valve(w: number, h: number): Spec[] {
  const [specs, cx, cy, th] = _bowtie(w, h)
  const r = th * 0.32
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: OUTLINE, fill: WHITE, width: W_DET })
  specs.push({ shape: 'line', x1: cx, y1: cy - r, x2: cx, y2: h * 0.12, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: cx - w * 0.1, y1: h * 0.12, x2: cx + w * 0.1, y2: h * 0.12, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Bow-tie with a ball near one seat (one-way) + flow arrow.
export function build_check_valve(w: number, h: number): Spec[] {
  const [specs, cx, cy, th] = _bowtie(w, h)
  const r = th * 0.22
  const bx = cx + (w * 0.9 - cx) * 0.3
  specs.push({ shape: 'circle', x: bx - r, y: cy - r, w: r * 2, h: r * 2, stroke: OUTLINE, fill: METAL, width: W_DET })
  specs.push({ shape: 'arrow', x1: w * 0.2, y1: h * 0.16, x2: w * 0.8, y2: h * 0.16, stroke: OUTLINE, width: W_DET })
  return specs
}

// Bow-tie with a diaphragm actuator (dome on a stem) on top.
export function build_control_valve(w: number, h: number): Spec[] {
  const [specs, cx, cy, th] = _bowtie(w, h, h * 0.66)
  specs.push({ shape: 'line', x1: cx, y1: cy - th * 0.05, x2: cx, y2: h * 0.3, stroke: OUTLINE, width: W_OUT })
  const dw = w * 0.4
  specs.push({ shape: 'halfcircle', x: cx - dw / 2, y: h * 0.12, w: dw, h: h * 0.18, stroke: OUTLINE, fill: EQUIP, width: W_OUT, rotation: 0 })
  specs.push({ shape: 'line', x1: cx - dw / 2, y1: h * 0.3, x2: cx + dw / 2, y2: h * 0.3, stroke: OUTLINE, width: W_DET })
  return specs
}

// Three triangles meeting at the centre seat (left, right + bottom).
export function build_three_way_valve(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const cy = h * 0.45
  const th = h * 0.34
  const half = w * 0.42
  return [
    _tri_pointing(cx, cy, half, th, 'r'),
    _tri_pointing(cx, cy, half, th, 'l'),
    _tri_pointing(cx, cy, h * 0.45, w * 0.3, 'u'),
  ]  // left port; right port; bottom port
}

// ------------------------------------------------------------- Instruments
// Field instrument bubble: plain circle with a faint tag.
export function build_instrument(w: number, h: number): Spec[] {
  const d = Math.min(w, h) * 0.8
  const cx = w * 0.5
  const cy = h * 0.5
  const r = d / 2
  const specs: Spec[] = []
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: d, h: d, stroke: OUTLINE, fill: WHITE, width: W_OUT })
  specs.push({ shape: 'text', text: 'TIC', x: cx, y: cy, size: h * 0.2, color: OUTLINE, anchor: 'center' })
  return specs
}

// Circle on a pipe segment with an FE tag and flow arrow.
export function build_flow_meter(w: number, h: number): Spec[] {
  const d = Math.min(w, h) * 0.7
  const cx = w * 0.5
  const cy = h * 0.5
  const r = d / 2
  const specs: Spec[] = []
  specs.push({ shape: 'line', x1: w * 0.02, y1: cy, x2: w * 0.98, y2: cy, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: d, h: d, stroke: OUTLINE, fill: WHITE, width: W_OUT })
  specs.push({ shape: 'arrow', x1: cx - r * 0.55, y1: cy, x2: cx + r * 0.55, y2: cy, stroke: OUTLINE, width: W_DET })
  specs.push({ shape: 'text', text: 'FE', x: cx, y: cy - r * 0.45, size: h * 0.16, color: OUTLINE, anchor: 'center' })
  return specs
}

// Pressure gauge: circle with a needle and a short stem.
export function build_gauge(w: number, h: number): Spec[] {
  const d = Math.min(w, h) * 0.7
  const cx = w * 0.5
  const cy = h * 0.46
  const r = d / 2
  const specs: Spec[] = []
  specs.push({ shape: 'circle', x: cx - r, y: cy - r, w: d, h: d, stroke: OUTLINE, fill: WHITE, width: W_OUT })
  const a = rad(-55)
  specs.push({ shape: 'line', x1: cx, y1: cy, x2: cx + r * 0.75 * Math.cos(a), y2: cy + r * 0.75 * Math.sin(a), stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'circle', x: cx - r * 0.1, y: cy - r * 0.1, w: r * 0.2, h: r * 0.2, stroke: OUTLINE, fill: OUTLINE, width: W_DET })
  specs.push({ shape: 'line', x1: cx, y1: cy + r, x2: cx, y2: h * 0.94, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'line', x1: cx - w * 0.1, y1: h * 0.94, x2: cx + w * 0.1, y2: h * 0.94, stroke: OUTLINE, width: W_OUT })
  return specs
}

// -------------------------------------------------------------- Metadata
export const REFERENCE_MM = 2400
export const SIZES: Record<string, [number, number]> = { tank: [400, 500], vessel: [600, 320], column: [300, 900], reactor: [420, 520], heat_exchanger: [640, 300], hopper: [360, 380], pump: [240, 240], compressor: [300, 240], blower: [260, 260], gate_valve: [200, 160], globe_valve: [200, 160], ball_valve: [200, 180], check_valve: [200, 160], control_valve: [200, 200], three_way_valve: [200, 180], instrument: [160, 160], flow_meter: [200, 160], gauge: [160, 180] }
export const LABELS: Record<string, string> = { tank: 'Tank', vessel: 'Drum / vessel', column: 'Column', reactor: 'Reactor', heat_exchanger: 'Heat exchanger', hopper: 'Hopper', pump: 'Pump', compressor: 'Compressor', blower: 'Blower / fan', gate_valve: 'Gate valve', globe_valve: 'Globe valve', ball_valve: 'Ball valve', check_valve: 'Check valve', control_valve: 'Control valve', three_way_valve: '3-way valve', instrument: 'Instrument', flow_meter: 'Flow meter', gauge: 'Gauge' }
export const CATEGORIES: [string, string[]][] = [['Vessels', ['tank', 'vessel', 'column', 'reactor', 'heat_exchanger', 'hopper']], ['Rotating equipment', ['pump', 'compressor', 'blower']], ['Valves', ['gate_valve', 'globe_valve', 'ball_valve', 'check_valve', 'control_valve', 'three_way_valve']], ['Instruments', ['instrument', 'flow_meter', 'gauge']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  tank: build_tank,
  vessel: build_vessel,
  column: build_column,
  reactor: build_reactor,
  heat_exchanger: build_heat_exchanger,
  hopper: build_hopper,
  pump: build_pump,
  compressor: build_compressor,
  blower: build_blower,
  gate_valve: build_gate_valve,
  globe_valve: build_globe_valve,
  ball_valve: build_ball_valve,
  check_valve: build_check_valve,
  control_valve: build_control_valve,
  three_way_valve: build_three_way_valve,
  instrument: build_instrument,
  flow_meter: build_flow_meter,
  gauge: build_gauge,
}
