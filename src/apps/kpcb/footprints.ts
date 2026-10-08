// The footprint library of kPCB: pure data built by a few generators (chips, axial and radial parts,
// pin headers, DIP / SOIC / TSSOP / QFP packages…). Millimetres, y down, the part's origin is where
// its name says (pin 1 for through-hole rows, the centre for surface-mount parts).
// Pitches and sizes follow the usual datasheet / IPC footprints (KiCad's libraries are the reference).

import type { Body3D, Footprint, PadDef, SilkItem } from './types.ts'

const r3 = (n: number) => Math.round(n * 10000) / 10000

// ------------------------------------------------------------ helpers

const smd = (n: string, x: number, y: number, w: number, h: number, shape: PadDef['shape'] = 'roundrect'): PadDef => ({ n, shape, x: r3(x), y: r3(y), w, h })
const thru = (n: string, x: number, y: number, d: number, drill: number, shape: PadDef['shape'] = 'round', h = d): PadDef => ({
  n, shape, x: r3(x), y: r3(y), w: d, h, drill,
})
const line = (x1: number, y1: number, x2: number, y2: number): SilkItem => ({ t: 'line', x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2) })
const circle = (cx: number, cy: number, r: number): SilkItem => ({ t: 'circle', cx: r3(cx), cy: r3(cy), r })
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): SilkItem => ({ t: 'arc', cx: r3(cx), cy: r3(cy), r, a0, a1 })
const box = (x0: number, y0: number, x1: number, y1: number): SilkItem[] => [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)]

interface Spec {
  name: string
  desc: string
  cat: string
  prefix: string
  pads: PadDef[]
  silk?: SilkItem[]
  /** Courtyard; default: around the pads. */
  court?: { x0: number; y0: number; x1: number; y1: number }
  bodies?: Body3D[]
  /** Label positions; default: above and below the courtyard. */
  ref?: { x: number; y: number }
  val?: { x: number; y: number }
}

function make(s: Spec): Footprint {
  let c = s.court
  if (!c) {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of s.pads) {
      x0 = Math.min(x0, p.x - p.w / 2)
      x1 = Math.max(x1, p.x + p.w / 2)
      y0 = Math.min(y0, p.y - p.h / 2)
      y1 = Math.max(y1, p.y + p.h / 2)
    }
    c = { x0: r3(x0 - 0.25), y0: r3(y0 - 0.25), x1: r3(x1 + 0.25), y1: r3(y1 + 0.25) }
  }
  const cx = r3((c.x0 + c.x1) / 2)
  return {
    name: s.name,
    desc: s.desc,
    cat: s.cat,
    prefix: s.prefix,
    pads: s.pads,
    silk: s.silk ?? [],
    court: c,
    ref: s.ref ?? { x: cx, y: r3(c.y0 - 0.8) },
    val: s.val ?? { x: cx, y: r3(c.y1 + 0.8) },
    bodies: s.bodies ?? [],
    smd: s.pads.every((p) => p.drill === undefined),
  }
}

// ------------------------------------------------------------ chips (R, C, LED, diodes)

interface ChipDims {
  px: number
  pw: number
  ph: number
  bw: number
  bh: number
  h: number
}
const CHIP: Record<string, ChipDims> = {
  '0402': { px: 0.51, pw: 0.54, ph: 0.64, bw: 1.0, bh: 0.5, h: 0.35 },
  '0603': { px: 0.825, pw: 0.8, ph: 0.95, bw: 1.6, bh: 0.8, h: 0.45 },
  '0805': { px: 0.9125, pw: 0.975, ph: 1.4, bw: 2.0, bh: 1.25, h: 0.6 },
  '1206': { px: 1.475, pw: 1.05, ph: 1.75, bw: 3.2, bh: 1.6, h: 0.7 },
}
const CAP: Record<string, ChipDims> = {
  '0603': { px: 0.775, pw: 0.9, ph: 0.95, bw: 1.6, bh: 0.8, h: 0.8 },
  '0805': { px: 0.95, pw: 1.0, ph: 1.45, bw: 2.0, bh: 1.25, h: 1.0 },
  '1206': { px: 1.475, pw: 1.05, ph: 1.75, bw: 3.2, bh: 1.6, h: 1.2 },
}

function chip(name: string, desc: string, cat: string, prefix: string, d: ChipDims, color: string, polar = false): Footprint {
  const inner = d.px - d.pw / 2
  const L = inner - 0.2
  const silk: SilkItem[] = []
  if (L > 0.12) {
    const y = d.ph / 2 + 0.2
    silk.push(line(-L, -y, L, -y), line(-L, y, L, y))
  }
  if (polar && L > 0.12) silk.push(line(L, -d.bh / 2, L, d.bh / 2))
  const cy = d.ph / 2 + 0.25
  return make({
    name, desc, cat, prefix,
    pads: [smd('1', -d.px, 0, d.pw, d.ph), smd('2', d.px, 0, d.pw, d.ph)],
    silk,
    court: { x0: r3(-(d.px + d.pw / 2 + 0.25)), y0: r3(-cy), x1: r3(d.px + d.pw / 2 + 0.25), y1: r3(cy) },
    bodies: [{ x0: -d.bw / 2, y0: -d.bh / 2, x1: d.bw / 2, y1: d.bh / 2, h: d.h, color }],
  })
}

// ------------------------------------------------------------ axial and radial through-hole parts

function axial(name: string, desc: string, cat: string, prefix: string, pitch: number, bodyL: number, bodyD: number, padD: number, drill: number, color: string, band = false): Footprint {
  const silkL = Math.min(bodyL, pitch - padD - 0.4)
  const x0 = pitch / 2 - silkL / 2
  const x1 = pitch / 2 + silkL / 2
  const hd = bodyD / 2
  const silk = [...box(x0, -hd, x1, hd)]
  if (band) silk.push(line(x1 - 0.8, -hd, x1 - 0.8, hd))
  const cy = Math.max(hd, padD / 2) + 0.3
  return make({
    name, desc, cat, prefix,
    pads: [thru('1', 0, 0, padD, drill, 'rect'), thru('2', pitch, 0, padD, drill)],
    silk,
    court: { x0: r3(-padD / 2 - 0.3), y0: r3(-cy), x1: r3(pitch + padD / 2 + 0.3), y1: r3(cy) },
    bodies: [{ x0: pitch / 2 - bodyL / 2, y0: -hd, x1: pitch / 2 + bodyL / 2, y1: hd, h: bodyD, color }],
  })
}

function radial(name: string, desc: string, cat: string, prefix: string, dia: number, pitch: number, height: number, polar: boolean, color: string): Footprint {
  const R = dia / 2 + 0.1
  const cx = pitch / 2
  const silk: SilkItem[] = [circle(cx, 0, R)]
  if (polar) {
    // a chord on the negative side
    const dx = pitch / 2 + 0.95 + 0.2
    const half = Math.sqrt(Math.max(0, R * R - dx * dx))
    if (half > 0.4) silk.push(line(cx + dx, -half * 0.8, cx + dx, half * 0.8))
  }
  const k = R + 0.25
  return make({
    name, desc, cat, prefix,
    pads: [thru('1', 0, 0, 1.6, 0.8, 'rect'), thru('2', pitch, 0, 1.6, 0.8)],
    silk,
    court: { x0: r3(cx - k), y0: r3(-k), x1: r3(cx + k), y1: r3(k) },
    bodies: [{ x0: cx - dia / 2, y0: -dia / 2, x1: cx + dia / 2, y1: dia / 2, h: height, round: true, color }],
  })
}

// ------------------------------------------------------------ pin headers, terminals

function header(rows: 1 | 2, n: number): Footprint {
  const pads: PadDef[] = []
  for (let i = 0; i < n; i++) {
    if (rows === 1) pads.push(thru(String(i + 1), 0, i * 2.54, 1.7, 1.0, i === 0 ? 'rect' : 'round'))
    else {
      pads.push(thru(String(2 * i + 1), 0, i * 2.54, 1.7, 1.0, i === 0 ? 'rect' : 'round'))
      pads.push(thru(String(2 * i + 2), 2.54, i * 2.54, 1.7, 1.0))
    }
  }
  const xr = rows === 1 ? 0 : 2.54
  const y1 = (n - 1) * 2.54
  return make({
    name: rows === 1 ? `PinHeader_1x${String(n).padStart(2, '0')}` : `PinHeader_2x${String(n).padStart(2, '0')}`,
    desc: `Pin header ${rows}x${n}, 2.54 mm`,
    cat: 'Connectors',
    prefix: 'J',
    pads,
    silk: [...box(-1.33, -1.33, xr + 1.33, y1 + 1.33)],
    court: { x0: -1.77, y0: -1.77, x1: xr + 1.77, y1: y1 + 1.77 },
    bodies: [{ x0: -1.27, y0: -1.27, x1: xr + 1.27, y1: y1 + 1.27, h: 2.5, color: '#1f1f1f' }],
    ref: { x: xr / 2, y: -2.6 },
    val: { x: xr / 2, y: y1 + 2.6 },
  })
}

function terminal(n: number): Footprint {
  const pads: PadDef[] = []
  for (let i = 0; i < n; i++) pads.push(thru(String(i + 1), i * 5.08, 0, 2.6, 1.3, i === 0 ? 'rect' : 'round'))
  const x1 = (n - 1) * 5.08 + 2.54
  return make({
    name: `TerminalBlock_${n}x5.08`,
    desc: `Screw terminal block, ${n} positions, 5.08 mm`,
    cat: 'Connectors',
    prefix: 'J',
    pads,
    silk: [...box(-2.54, -3.6, x1, 3.6)],
    court: { x0: -2.8, y0: -3.9, x1: x1 + 0.26, y1: 3.9 },
    bodies: [{ x0: -2.54, y0: -3.6, x1, y1: 3.6, h: 10, color: '#2e8b57' }],
    ref: { x: (n - 1) * 2.54, y: -4.8 },
    val: { x: (n - 1) * 2.54, y: 4.8 },
  })
}

// ------------------------------------------------------------ ICs

function dip(n: number, wide = 7.62): Footprint {
  const half = n / 2
  const pads: PadDef[] = []
  for (let i = 0; i < half; i++) {
    pads.push(thru(String(i + 1), 0, i * 2.54, 1.6, 0.8, i === 0 ? 'rect' : 'round'))
    pads.push(thru(String(n - i), wide, i * 2.54, 1.6, 0.8))
  }
  const y1 = (half - 1) * 2.54
  const bx0 = 1.27
  const bx1 = wide - 1.27
  const mid = wide / 2
  return make({
    name: `DIP-${n}`,
    desc: `Dual in-line package, ${n} pins, ${wide} mm row spacing`,
    cat: 'ICs',
    prefix: 'U',
    pads,
    silk: [
      line(bx0, -1.33, mid - 1, -1.33), line(mid + 1, -1.33, bx1, -1.33),
      line(bx1, -1.33, bx1, y1 + 1.33), line(bx1, y1 + 1.33, bx0, y1 + 1.33), line(bx0, y1 + 1.33, bx0, -1.33),
      arc(mid, -1.33, 1, 0, 180),
    ],
    court: { x0: -1.5, y0: -1.8, x1: wide + 1.5, y1: y1 + 1.8 },
    bodies: [{ x0: bx0, y0: -1.3, x1: bx1, y1: y1 + 1.3, h: 3.3, color: '#262626' }],
    ref: { x: mid, y: -2.6 },
    val: { x: mid, y: y1 + 2.6 },
  })
}

function soic(n: number, bodyL: number): Footprint {
  const half = n / 2
  const pads: PadDef[] = []
  const y0 = -((half - 1) * 1.27) / 2
  for (let i = 0; i < half; i++) {
    pads.push(smd(String(i + 1), -2.7, y0 + i * 1.27, 1.5, 0.6))
    pads.push(smd(String(n - i), 2.7, y0 + i * 1.27, 1.5, 0.6))
  }
  const ys = bodyL / 2 + 0.1
  const cy = Math.max(bodyL / 2, -y0 + 0.3) + 0.25
  return make({
    name: `SOIC-${n}`,
    desc: `Small outline package, ${n} pins, 1.27 mm pitch, 3.9 mm body`,
    cat: 'ICs',
    prefix: 'U',
    pads,
    silk: [line(-1.95, -ys, 1.95, -ys), line(-1.95, ys, 1.95, ys), circle(-1.2, -bodyL / 2 + 0.5, 0.25)],
    court: { x0: -3.7, y0: -cy, x1: 3.7, y1: cy },
    bodies: [{ x0: -1.95, y0: -bodyL / 2, x1: 1.95, y1: bodyL / 2, h: 1.75, color: '#262626' }],
  })
}

function tssop(n: number, bodyL: number): Footprint {
  const half = n / 2
  const pads: PadDef[] = []
  const y0 = -((half - 1) * 0.65) / 2
  for (let i = 0; i < half; i++) {
    pads.push(smd(String(i + 1), -2.85, y0 + i * 0.65, 1.45, 0.4))
    pads.push(smd(String(n - i), 2.85, y0 + i * 0.65, 1.45, 0.4))
  }
  const ys = bodyL / 2 + 0.1
  const cy = Math.max(bodyL / 2, -y0 + 0.2) + 0.25
  return make({
    name: `TSSOP-${n}`,
    desc: `Thin shrink small outline package, ${n} pins, 0.65 mm pitch, 4.4 mm body`,
    cat: 'ICs',
    prefix: 'U',
    pads,
    silk: [line(-1.9, -ys, 1.9, -ys), line(-1.9, ys, 1.9, ys), circle(-1.4, -bodyL / 2 + 0.5, 0.2)],
    court: { x0: -3.8, y0: -cy, x1: 3.8, y1: cy },
    bodies: [{ x0: -2.2, y0: -bodyL / 2, x1: 2.2, y1: bodyL / 2, h: 1.1, color: '#262626' }],
  })
}

function qfp(n: number, side: number, pc: number): Footprint {
  const k = n / 4
  const pitch = 0.8
  const pads: PadDef[] = []
  const off = (i: number) => (i - (k - 1) / 2) * pitch
  for (let i = 0; i < k; i++) {
    pads.push(smd(String(i + 1), -pc, off(i), 1.6, 0.55)) // left, top to bottom
    pads.push(smd(String(k + i + 1), off(i), pc, 0.55, 1.6)) // bottom, left to right
    pads.push(smd(String(2 * k + i + 1), pc, -off(i), 1.6, 0.55)) // right, bottom to top
    pads.push(smd(String(3 * k + i + 1), -off(i), -pc, 0.55, 1.6)) // top, right to left
  }
  const h = side / 2 + 0.1
  const c = h - 0.4
  const mark: SilkItem[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) mark.push(line(sx * h, sy * h, sx * h, sy * c), line(sx * h, sy * h, sx * c, sy * h))
  }
  mark.push(circle(-(side / 2 - 0.9), -(side / 2 - 0.9), 0.3))
  const ext = pc + 0.8 + 0.25
  return make({
    name: `QFP-${n}`,
    desc: `Quad flat package, ${n} pins, 0.8 mm pitch, ${side} x ${side} mm body`,
    cat: 'ICs',
    prefix: 'U',
    pads,
    silk: mark,
    court: { x0: -ext, y0: -ext, x1: ext, y1: ext },
    bodies: [{ x0: -side / 2, y0: -side / 2, x1: side / 2, y1: side / 2, h: 1.6, color: '#262626' }],
  })
}

// ------------------------------------------------------------ the library

const LIST: Footprint[] = []
const add = (f: Footprint) => LIST.push(f)

for (const s of ['0402', '0603', '0805', '1206']) add(chip(`R_${s}`, `Resistor, ${s} chip`, 'Resistors', 'R', CHIP[s], '#2a2a2a'))
add(axial('R_Axial_THT_P7.62', 'Resistor, axial 0207, 7.62 mm pitch', 'Resistors', 'R', 7.62, 6.3, 2.5, 1.6, 0.8, '#d8c9a3'))
add(axial('R_Axial_THT_P10.16', 'Resistor, axial 0207, 10.16 mm pitch', 'Resistors', 'R', 10.16, 6.3, 2.5, 1.6, 0.8, '#d8c9a3'))

for (const s of ['0603', '0805', '1206']) add(chip(`C_${s}`, `Capacitor, ${s} chip`, 'Capacitors', 'C', CAP[s], '#b08a4a'))
add(radial('C_Radial_D5.0mm_P2.50mm', 'Capacitor, radial, 5 mm, 2.5 mm pitch (film / ceramic)', 'Capacitors', 'C', 5, 2.5, 6, false, '#d9a441'))
add(radial('CP_Radial_D5.0mm_P2.00mm', 'Electrolytic capacitor, radial, 5 mm', 'Capacitors', 'C', 5, 2, 11, true, '#1b3a6b'))
add(radial('CP_Radial_D6.3mm_P2.50mm', 'Electrolytic capacitor, radial, 6.3 mm', 'Capacitors', 'C', 6.3, 2.5, 11, true, '#1b3a6b'))
add(radial('CP_Radial_D8.0mm_P3.50mm', 'Electrolytic capacitor, radial, 8 mm', 'Capacitors', 'C', 8, 3.5, 12, true, '#1b3a6b'))
add(make({
  name: 'C_Disc_D5.0mm_P5.00mm',
  desc: 'Ceramic disc capacitor, 5 mm, 5.08 mm pitch',
  cat: 'Capacitors',
  prefix: 'C',
  pads: [thru('1', 0, 0, 1.6, 0.8, 'rect'), thru('2', 5, 0, 1.6, 0.8)],
  silk: box(1.0, -1.25, 4.0, 1.25),
  court: { x0: -1.1, y0: -1.7, x1: 6.1, y1: 1.7 },
  bodies: [{ x0: 0, y0: -1.25, x1: 5, y1: 1.25, h: 6, color: '#d9a441' }],
}))

add(axial('L_Axial_THT_P10.16', 'Inductor, axial, 10.16 mm pitch', 'Inductors', 'L', 10.16, 6.5, 3, 1.6, 0.8, '#6b7d3a'))

add(make({
  name: 'D_SOD-123', desc: 'Diode, SOD-123 (pin 1 = anode, pin 2 = cathode)', cat: 'Diodes', prefix: 'D',
  pads: [smd('1', -1.65, 0, 0.9, 1.2), smd('2', 1.65, 0, 0.9, 1.2)],
  silk: [line(-0.8, -0.9, 0.8, -0.9), line(-0.8, 0.9, 0.8, 0.9), line(0.8, -0.8, 0.8, 0.8)],
  court: { x0: -2.4, y0: -1.1, x1: 2.4, y1: 1.1 },
  bodies: [{ x0: -1.35, y0: -0.8, x1: 1.35, y1: 0.8, h: 1.0, color: '#2a2a2a' }],
}))
add(make({
  name: 'D_SMA', desc: 'Diode, SMA / DO-214AC (pin 1 = anode, pin 2 = cathode)', cat: 'Diodes', prefix: 'D',
  pads: [smd('1', -2.0, 0, 1.5, 2.3), smd('2', 2.0, 0, 1.5, 2.3)],
  silk: [line(-1.0, -1.7, 1.0, -1.7), line(-1.0, 1.7, 1.0, 1.7), line(1.0, -1.5, 1.0, 1.5)],
  court: { x0: -3.0, y0: -1.5, x1: 3.0, y1: 1.5 },
  bodies: [{ x0: -2.15, y0: -1.3, x1: 2.15, y1: 1.3, h: 2.3, color: '#2a2a2a' }],
}))
add(axial('D_DO-35', 'Diode, DO-35 axial, 7.62 mm pitch (pin 1 = anode, pin 2 = cathode)', 'Diodes', 'D', 7.62, 3.5, 1.9, 1.6, 0.8, '#d98b3b', true))
add(axial('D_DO-41', 'Diode, DO-41 axial, 10.16 mm pitch (pin 1 = anode, pin 2 = cathode)', 'Diodes', 'D', 10.16, 5.2, 2.7, 2.0, 1.0, '#2a2a2a', true))

for (const s of ['0603', '0805', '1206']) add(chip(`LED_${s}`, `LED, ${s} chip (pin 1 = anode, pin 2 = cathode)`, 'LEDs', 'D', CHIP[s], '#e8e0a0', true))
add(make({
  name: 'LED_3mm', desc: 'LED, 3 mm round (pin 1 = anode, long lead)', cat: 'LEDs', prefix: 'D',
  pads: [thru('1', 0, 0, 1.8, 0.9, 'rect'), thru('2', 2.54, 0, 1.8, 0.9)],
  silk: [arc(1.27, 0, 2.0, 35, 145), arc(1.27, 0, 2.0, 215, 325)],
  court: { x0: -1.2, y0: -2.3, x1: 3.74, y1: 2.3 },
  bodies: [{ x0: -0.23, y0: -1.5, x1: 2.77, y1: 1.5, h: 5, round: true, color: '#ff5050' }],
}))
add(make({
  name: 'LED_5mm', desc: 'LED, 5 mm round (pin 1 = anode, long lead)', cat: 'LEDs', prefix: 'D',
  pads: [thru('1', 0, 0, 1.8, 0.9, 'rect'), thru('2', 2.54, 0, 1.8, 0.9)],
  silk: [circle(1.27, 0, 3.0)],
  court: { x0: -2.0, y0: -3.3, x1: 4.54 + 0.5, y1: 3.3 },
  bodies: [{ x0: -1.23, y0: -2.5, x1: 3.77, y1: 2.5, h: 8.6, round: true, color: '#ff5050' }],
}))

add(make({
  name: 'SOT-23', desc: 'SOT-23, 3 pins (pins 1, 2 on one side, 3 on the other)', cat: 'Transistors', prefix: 'Q',
  pads: [smd('1', -1.1, -0.95, 1.0, 0.7), smd('2', -1.1, 0.95, 1.0, 0.7), smd('3', 1.1, 0, 1.0, 0.7)],
  silk: [line(-0.45, -1.5, 0.45, -1.5), line(-0.45, 1.5, 0.45, 1.5)],
  court: { x0: -1.9, y0: -1.75, x1: 1.9, y1: 1.75 },
  bodies: [{ x0: -0.65, y0: -1.45, x1: 0.65, y1: 1.45, h: 1.1, color: '#262626' }],
}))
add(make({
  name: 'SOT-223', desc: 'SOT-223, 3 pins and tab (pad 4)', cat: 'Transistors', prefix: 'U',
  pads: [smd('1', -3.15, -2.3, 2.0, 1.5), smd('2', -3.15, 0, 2.0, 1.5), smd('3', -3.15, 2.3, 2.0, 1.5), smd('4', 3.15, 0, 2.0, 3.8)],
  silk: [line(-1.75, -3.3, 1.75, -3.3), line(-1.75, 3.3, 1.75, 3.3), line(-1.75, -3.3, -1.75, -3.0), line(-1.75, 3.3, -1.75, 3.0)],
  court: { x0: -4.5, y0: -3.9, x1: 4.5, y1: 3.9 },
  bodies: [{ x0: -1.75, y0: -3.25, x1: 1.75, y1: 3.25, h: 1.8, color: '#262626' }],
}))
add(make({
  name: 'TO-92', desc: 'TO-92 inline, 1.27 mm pitch (flat side toward you: pins 1, 2, 3 left to right)', cat: 'Transistors', prefix: 'Q',
  pads: [thru('1', -1.27, 0, 1.05, 0.75, 'oval', 1.5), thru('2', 0, 0, 1.05, 0.75, 'oval', 1.5), thru('3', 1.27, 0, 1.05, 0.75, 'oval', 1.5)],
  silk: [line(-2.9, 1.3, 2.9, 1.3), arc(0, 1.3, 2.9, 180, 360)],
  court: { x0: -3.2, y0: -1.9, x1: 3.2, y1: 1.7 },
  bodies: [{ x0: -2.0, y0: -1.2, x1: 2.0, y1: 2.0, h: 4.5, round: true, color: '#262626' }],
}))
add(make({
  name: 'TO-220_Vertical', desc: 'TO-220-3 vertical, 2.54 mm pitch', cat: 'Transistors', prefix: 'Q',
  pads: [thru('1', 0, 0, 1.9, 1.1, 'rect'), thru('2', 2.54, 0, 1.9, 1.1, 'oval'), thru('3', 5.08, 0, 1.9, 1.1, 'oval')],
  silk: box(-2.6, -3.5, 7.7, 2.0),
  court: { x0: -2.85, y0: -3.75, x1: 7.95, y1: 2.25 },
  bodies: [{ x0: -2.6, y0: -3.5, x1: 7.7, y1: 1.1, h: 14, color: '#262626' }],
  ref: { x: 2.54, y: -4.6 },
  val: { x: 2.54, y: 3.3 },
}))

for (const n of [8, 14, 16, 28]) add(dip(n))
add(soic(8, 4.9))
add(soic(14, 8.65))
add(soic(16, 9.9))
add(tssop(14, 5.0))
add(tssop(20, 6.5))
add(qfp(32, 7, 4.2))
add(qfp(44, 10, 5.675))

for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]) add(header(1, n))
add(header(2, 5))
add(header(2, 10))
add(terminal(2))
add(terminal(3))

add(make({
  name: 'USB_Micro-B', desc: 'USB Micro-B receptacle, surface mount (1 VBUS, 2 D-, 3 D+, 4 ID, 5 GND, 6 shield)', cat: 'Connectors', prefix: 'J',
  pads: [
    smd('1', -1.3, 0, 0.4, 1.35, 'rect'), smd('2', -0.65, 0, 0.4, 1.35, 'rect'), smd('3', 0, 0, 0.4, 1.35, 'rect'),
    smd('4', 0.65, 0, 0.4, 1.35, 'rect'), smd('5', 1.3, 0, 0.4, 1.35, 'rect'),
    smd('6', -3.1, -0.2, 1.9, 1.9, 'rect'), smd('6', 3.1, -0.2, 1.9, 1.9, 'rect'),
    smd('6', -1.2, 2.5, 1.2, 1.9, 'rect'), smd('6', 1.2, 2.5, 1.2, 1.9, 'rect'),
  ],
  silk: [line(-4.3, -1.6, -4.3, 4.6), line(4.3, -1.6, 4.3, 4.6), line(-4.3, 4.6, 4.3, 4.6)],
  court: { x0: -4.6, y0: -1.9, x1: 4.6, y1: 4.9 },
  bodies: [{ x0: -3.75, y0: 0.4, x1: 3.75, y1: 4.6, h: 2.6, color: '#b8b8b8' }],
  ref: { x: 0, y: -2.7 },
  val: { x: 0, y: 5.7 },
}))
{
  // 16-pin USB-C (power and data): 12 contacts at 0.5 mm (GND, VBUS wide) and 4 shield pads
  const c = (n: string, x: number, w: number) => smd(n, x, 0, w, 1.15, 'rect')
  add(make({
    name: 'USB_C_Receptacle_16P', desc: 'USB Type-C receptacle, 16 pins (1 GND, 2 VBUS, 3 CC1, 4 CC2, 5 D+, 6 D-, 7 SBU1, 8 SBU2, S shield)', cat: 'Connectors', prefix: 'J',
    pads: [
      c('1', -3.2, 0.6), c('2', -2.4, 0.6), c('8', -1.75, 0.3), c('3', -1.25, 0.3), c('6', -0.75, 0.3), c('5', -0.25, 0.3),
      c('6', 0.25, 0.3), c('5', 0.75, 0.3), c('7', 1.25, 0.3), c('4', 1.75, 0.3), c('2', 2.4, 0.6), c('1', 3.2, 0.6),
      thru('S', -4.32, 1.5, 1.0, 0.6, 'oval', 2.1), thru('S', 4.32, 1.5, 1.0, 0.6, 'oval', 2.1),
      thru('S', -4.32, 5.7, 1.0, 0.6, 'oval', 1.6), thru('S', 4.32, 5.7, 1.0, 0.6, 'oval', 1.6),
    ],
    silk: [line(-4.7, 3.1, -4.7, 4.1), line(4.7, 3.1, 4.7, 4.1)],
    court: { x0: -5.2, y0: -0.9, x1: 5.2, y1: 6.9 },
    bodies: [{ x0: -4.47, y0: 0.9, x1: 4.47, y1: 7.3, h: 3.2, color: '#b8b8b8' }],
    ref: { x: 0, y: -1.8 },
    val: { x: 0, y: 7.9 },
  }))
}
add(make({
  name: 'BarrelJack_DC-005', desc: 'DC barrel jack 2.1 mm, through hole (1 centre, 2 sleeve, 3 switch)', cat: 'Connectors', prefix: 'J',
  pads: [thru('1', 0, 0, 1.8, 1.0, 'oval', 3.4), thru('2', 0, 6, 1.8, 1.0, 'oval', 3.4), thru('3', -4.7, 3, 3.4, 1.0, 'oval', 1.8)],
  silk: box(-6.5, -2.9, 8.0, 8.9),
  court: { x0: -6.8, y0: -3.2, x1: 8.3, y1: 9.2 },
  bodies: [{ x0: -6.5, y0: -2.9, x1: 8, y1: 8.9, h: 11, color: '#222222' }],
  ref: { x: 0.8, y: -4.2 },
  val: { x: 0.8, y: 10.4 },
}))

add(make({
  name: 'Crystal_HC49-U', desc: 'Crystal HC-49/U, through hole, 4.88 mm pitch', cat: 'Crystals', prefix: 'Y',
  pads: [thru('1', 0, 0, 1.5, 0.8), thru('2', 4.88, 0, 1.5, 0.8)],
  silk: [...box(-1.0, -2.4, 5.9, 2.4)],
  court: { x0: -1.3, y0: -2.7, x1: 6.2, y1: 2.7 },
  bodies: [{ x0: -3.0, y0: -2.3, x1: 7.9, y1: 2.3, h: 13.5, color: '#c9c9c9' }],
}))
add(make({
  name: 'Crystal_SMD_3225-4Pin', desc: 'Crystal 3.2 x 2.5 mm, 4 pins (1 and 3 = crystal, 2 and 4 = ground)', cat: 'Crystals', prefix: 'Y',
  pads: [smd('1', -1.1, 0.85, 1.4, 1.15, 'rect'), smd('2', 1.1, 0.85, 1.4, 1.15, 'rect'), smd('3', 1.1, -0.85, 1.4, 1.15, 'rect'), smd('4', -1.1, -0.85, 1.4, 1.15, 'rect')],
  silk: [line(-2.1, -1.8, 2.1, -1.8), line(-2.1, 1.8, 2.1, 1.8)],
  court: { x0: -2.2, y0: -1.95, x1: 2.2, y1: 1.95 },
  bodies: [{ x0: -1.6, y0: -1.25, x1: 1.6, y1: 1.25, h: 0.8, color: '#c9c9c9' }],
}))

add(make({
  name: 'SW_Push_6mm', desc: 'Tactile switch 6 x 6 mm (pins 1 are joined, pins 2 are joined)', cat: 'Switches', prefix: 'SW',
  pads: [thru('1', 0, 0, 2.0, 1.1), thru('2', 6.25, 0, 2.0, 1.1), thru('1', 0, 4.5, 2.0, 1.1), thru('2', 6.25, 4.5, 2.0, 1.1)],
  silk: [...box(1.2, -0.9, 5.05, 5.4), circle(3.125, 2.25, 1.6)],
  court: { x0: -1.4, y0: -1.4, x1: 7.65, y1: 5.9 },
  bodies: [{ x0: 0.1, y0: -0.9, x1: 6.15, y1: 5.4, h: 3.6, color: '#3a3a3a' }, { x0: 1.9, y0: 0.9, x1: 4.35, y1: 3.6, h: 5.2, round: true, color: '#e8e8e8' }],
  ref: { x: 3.125, y: -2.3 },
  val: { x: 3.125, y: 6.8 },
}))
add(make({
  name: 'Buzzer_12mm', desc: 'Piezo buzzer 12 mm, 7.6 mm pitch (pin 1 = +)', cat: 'Misc', prefix: 'BZ',
  pads: [thru('1', 0, 0, 2.0, 1.0, 'rect'), thru('2', 7.6, 0, 2.0, 1.0)],
  silk: [circle(3.8, 0, 6.1)],
  court: { x0: -2.5, y0: -6.4, x1: 10.1, y1: 6.4 },
  bodies: [{ x0: -2.2, y0: -6, x1: 9.8, y1: 6, h: 9.5, round: true, color: '#262626' }],
}))
add(make({
  name: 'Potentiometer_3296W', desc: 'Trim potentiometer 3296W (1 and 3 = ends, 2 = wiper)', cat: 'Misc', prefix: 'RV',
  pads: [thru('1', 0, 0, 1.8, 1.0, 'rect'), thru('2', 2.54, -2.54, 1.8, 1.0), thru('3', 5.08, 0, 1.8, 1.0)],
  silk: box(-1.6, -4.4, 6.7, 1.8),
  court: { x0: -1.9, y0: -4.7, x1: 7.0, y1: 2.1 },
  bodies: [{ x0: -1.6, y0: -4.4, x1: 6.7, y1: 1.8, h: 5, color: '#2255aa' }],
}))
add(make({
  name: 'TestPoint_Pad_D1.5mm', desc: 'Test point, round pad 1.5 mm', cat: 'Misc', prefix: 'TP',
  pads: [smd('1', 0, 0, 1.5, 1.5, 'round')],
  court: { x0: -1.0, y0: -1.0, x1: 1.0, y1: 1.0 },
}))
add(make({
  name: 'MountingHole_M3', desc: 'Mounting hole for an M3 screw (3.2 mm, no copper)', cat: 'Misc', prefix: 'H',
  pads: [{ n: '', shape: 'round', x: 0, y: 0, w: 3.2, h: 3.2, drill: 3.2, plated: false }],
  court: { x0: -3.45, y0: -3.45, x1: 3.45, y1: 3.45 },
  ref: { x: 0, y: -4.3 },
  val: { x: 0, y: 4.3 },
}))

{
  // ESP32-WROOM-32: 18 x 25.5 mm, 38 castellated pads at 1.27 mm and a ground pad
  const pads: PadDef[] = []
  for (let i = 0; i < 15; i++) pads.push(smd(String(i + 1), -8.75, -5.26 + i * 1.27, 1.5, 0.9, 'rect'))
  for (let i = 0; i < 9; i++) pads.push(smd(String(16 + i), -5.08 + i * 1.27, 12.0, 0.9, 1.5, 'rect'))
  for (let i = 0; i < 14; i++) pads.push(smd(String(38 - i), 8.75, -5.26 + i * 1.27, 1.5, 0.9, 'rect'))
  pads.push(smd('39', 0, 3.0, 4.0, 4.0, 'rect'))
  add(make({
    name: 'ESP32-WROOM-32', desc: 'Espressif ESP32-WROOM-32 module, 38 pads + ground pad 39', cat: 'Modules', prefix: 'U',
    pads,
    silk: [
      line(-9.0, -12.75, 9.0, -12.75), line(-9.0, -12.75, -9.0, -5.9), line(9.0, -12.75, 9.0, -5.9),
      line(-9.0, -6.5, 9.0, -6.5),
    ],
    court: { x0: -9.75, y0: -13.0, x1: 9.75, y1: 13.0 },
    bodies: [{ x0: -9, y0: -12.75, x1: 9, y1: 12.75, h: 3.2, color: '#c0c0c0' }],
    ref: { x: 0, y: -14.0 },
    val: { x: 0, y: 14.0 },
  }))
}
{
  // Arduino Nano: 2 x 15 pins, 15.24 mm between the rows, board 18 x 43.2 mm
  const pads: PadDef[] = []
  for (let i = 0; i < 15; i++) {
    pads.push(thru(String(i + 1), 0, i * 2.54, 1.7, 1.0, i === 0 ? 'rect' : 'round'))
    pads.push(thru(String(30 - i), 15.24, i * 2.54, 1.7, 1.0))
  }
  add(make({
    name: 'Arduino_Nano', desc: 'Arduino Nano module on two 15-pin rows (DIP-30 numbering)', cat: 'Modules', prefix: 'A',
    pads,
    silk: [...box(-1.38, -1.4, 16.62, 39.0), ...box(4.6, -1.4, 11.6, 5.5)],
    court: { x0: -1.8, y0: -1.8, x1: 17.04, y1: 39.4 },
    bodies: [{ x0: -1.38, y0: -1.4, x1: 16.62, y1: 41.8, h: 6, color: '#1c5a8a' }],
    ref: { x: 7.62, y: -3 },
    val: { x: 7.62, y: 40.5 },
  }))
}
add(make({
  name: 'OLED_SSD1306_I2C', desc: 'SSD1306 0.96" OLED module, 4-pin I2C header (1 GND, 2 VCC, 3 SCL, 4 SDA)', cat: 'Modules', prefix: 'DS',
  pads: [thru('1', 0, 0, 1.7, 1.0, 'rect'), thru('2', 2.54, 0, 1.7, 1.0), thru('3', 5.08, 0, 1.7, 1.0), thru('4', 7.62, 0, 1.7, 1.0)],
  silk: [...box(-9.59, -2.5, 17.21, 25.3)],
  court: { x0: -9.9, y0: -2.8, x1: 17.5, y1: 25.6 },
  bodies: [{ x0: -9.59, y0: -2.5, x1: 17.21, y1: 25.3, h: 4, color: '#101830' }],
  ref: { x: 3.81, y: -3.8 },
  val: { x: 3.81, y: 26.8 },
}))

export const FOOTPRINTS: readonly Footprint[] = LIST

/** Names used by other apps (kElec's netlist) for the footprints above. */
export const FOOTPRINT_ALIASES: Readonly<Record<string, string>> = {
  R_Axial_THT: 'R_Axial_THT_P10.16',
  C_Radial_THT: 'C_Radial_D5.0mm_P2.50mm',
  CP_Radial_THT: 'CP_Radial_D6.3mm_P2.50mm',
  C_Disc_THT: 'C_Disc_D5.0mm_P5.00mm',
  L_Axial_THT: 'L_Axial_THT_P10.16',
  'TO-220': 'TO-220_Vertical',
  'C_Radial_D5.0mm': 'C_Radial_D5.0mm_P2.50mm',
  'CP_Radial_D5.0mm': 'CP_Radial_D5.0mm_P2.00mm',
  'CP_Radial_D6.3mm': 'CP_Radial_D6.3mm_P2.50mm',
  'CP_Radial_D8.0mm': 'CP_Radial_D8.0mm_P3.50mm',
  'CP_Radial_D8': 'CP_Radial_D8.0mm_P3.50mm',
  'CP_Radial_D5': 'CP_Radial_D5.0mm_P2.00mm',
  'USB_C': 'USB_C_Receptacle_16P',
  'USB_Micro-B_SMD': 'USB_Micro-B',
  'SW_Push': 'SW_Push_6mm',
  'Crystal_HC49': 'Crystal_HC49-U',
  'Crystal_3225': 'Crystal_SMD_3225-4Pin',
  'BarrelJack': 'BarrelJack_DC-005',
  'Potentiometer': 'Potentiometer_3296W',
  'TestPoint': 'TestPoint_Pad_D1.5mm',
  'MountingHole': 'MountingHole_M3',
  'ESP32-WROOM': 'ESP32-WROOM-32',
  'SSD1306': 'OLED_SSD1306_I2C',
  'Buzzer': 'Buzzer_12mm',
  'TerminalBlock_2': 'TerminalBlock_2x5.08',
  'TerminalBlock_3': 'TerminalBlock_3x5.08',
}

const BY_NAME = new Map<string, Footprint>(LIST.map((f) => [f.name.toLowerCase(), f]))

/** A footprint by its name or by an alias (case does not matter). */
export function getFootprint(name: string): Footprint | undefined {
  const k = name.trim().toLowerCase()
  const direct = BY_NAME.get(k)
  if (direct) return direct
  for (const [alias, target] of Object.entries(FOOTPRINT_ALIASES)) if (alias.toLowerCase() === k) return BY_NAME.get(target.toLowerCase())
  return undefined
}

/** Words in the name, description and category that start with every word of the query. */
export function searchFootprints(query: string): Footprint[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...LIST]
  return LIST.filter((f) => {
    const hay = `${f.name} ${f.desc} ${f.cat}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export const FOOTPRINT_CATEGORIES: string[] = [...new Set(LIST.map((f) => f.cat))]

/** The reference designator prefix of a footprint's usual part. */
export function prefixOf(fp: string): string {
  return getFootprint(fp)?.prefix ?? 'U'
}
