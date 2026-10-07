// Biology / life-science figure symbols (cells, molecules, lab).
// Ported from the desktop KhervePaint (biology.py).

import type { Spec } from '../spec'
import { deg, pmod } from '../spec'

export const OUTLINE = '#333333'
export const CELL = '#eaf3ea'
export const NUCLEUS = '#cfe0d6'
export const NUCLEUS2 = '#bcd0c4'
export const MEMBRANE = '#bcd8c4'
export const MOL_BLUE = '#cfe0f5'
export const MOL_RED = '#f3cccc'
export const LAB = '#dfe7ee'
export const WHITE = '#ffffff'
export const W_OUT = 2
export const W_DET = 1.2
function _circle(cx: number, cy: number, r: number, stroke = OUTLINE, fill = 'none', width = W_OUT): Spec {
  return { shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: stroke, fill: fill, width: width }
}

function _ellipse(cx: number, cy: number, rx: number, ry: number, stroke = OUTLINE, fill = 'none', width = W_OUT, rotation = 0): Spec {
  const d: Spec = { shape: 'ellipse', x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, stroke: stroke, fill: fill, width: width }
  if (rotation) {
    d.rotation = rotation
  }
  return d
}

function _line(x1: number, y1: number, x2: number, y2: number, stroke = OUTLINE, width = W_DET): Spec {
  return { shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, width: width }
}

// A sinusoidal polyline of short line segments between two points.
function _wavy(x1: number, y1: number, x2: number, y2: number, amp: number, cycles: number, stroke = OUTLINE, width = W_DET, steps = 24): Spec[] {
  let t, off, bx, by, a, b
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / length, dy / length]
  const [px, py] = [-uy, ux]
  const pts: number[][] = []
  for (let i = 0; i < steps + 1; i++) {
    t = i / steps
    off = amp * Math.sin(t * cycles * 2 * Math.PI)
    bx = x1 + dx * t + px * off
    by = y1 + dy * t + py * off
    pts.push([bx, by])
  }
  const segs: Spec[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    ;[a, b] = [pts[i], pts[i + 1]]
    segs.push(_line(a[0], a[1], b[0], b[1], stroke, width))
  }
  return segs
}

// Cells & microbes
export function build_cell(w: number, h: number): Spec[] {
  let ox, oy
  const [cx, cy] = [w * 0.5, h * 0.5]
  const r = Math.min(w, h) * 0.46
  const specs: Spec[] = [_circle(cx, cy, r, OUTLINE, CELL, W_OUT)]
  specs.push(_circle(cx, cy, r * 0.94, MEMBRANE, 'none', W_DET))
  const nr = r * 0.34
  specs.push(_circle(cx - r * 0.12, cy - r * 0.08, nr, OUTLINE, NUCLEUS, W_OUT))
  specs.push(_circle(cx - r * 0.12, cy - r * 0.08, nr * 0.32, OUTLINE, NUCLEUS2, W_DET))
  for (const [ang, dist] of [[0.6, 0.62], [2.1, 0.6], [-1.4, 0.6]]) {
    ox = cx + Math.cos(ang) * r * dist
    oy = cy + Math.sin(ang) * r * dist
    specs.push(_ellipse(ox, oy, r * 0.16, r * 0.08, OUTLINE, MEMBRANE, W_DET, deg(ang)))
  }
  return specs
}

export function build_bacterium(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  const [bw, bh] = [w * 0.5, h * 0.34]
  const [x, y] = [cx - bw / 2, cy - bh / 2]
  let specs: Spec[] = [{ shape: 'rounded_rect', x: x, y: y, w: bw, h: bh, radius: bh / 2, stroke: OUTLINE, fill: CELL, width: W_OUT }]
  for (const fx of [0.32, 0.5, 0.68]) {
    specs.push(_circle(x + bw * fx, cy, bh * 0.12, OUTLINE, NUCLEUS2, W_DET))
  }
  specs.push(..._wavy(x, cy, x - w * 0.22, cy - h * 0.05, h * 0.04, 2.5, OUTLINE, W_DET))
  specs.push(..._wavy(x + bw, cy, x + bw + w * 0.22, cy + h * 0.05, h * 0.04, 2.5, OUTLINE, W_DET))
  return specs
}

export function build_virus(w: number, h: number): Spec[] {
  let ang, x1, y1, x2, y2
  const [cx, cy] = [w * 0.5, h * 0.5]
  const r = Math.min(w, h) * 0.32
  const specs: Spec[] = [_circle(cx, cy, r, OUTLINE, MOL_RED, W_OUT)]
  specs.push(_circle(cx, cy, r * 0.5, MEMBRANE, 'none', W_DET))
  const n = 12
  const spike = Math.min(w, h) * 0.12
  const knob = spike * 0.4
  for (let i = 0; i < n; i++) {
    ang = i / n * 2 * Math.PI
    x1 = cx + Math.cos(ang) * r
    y1 = cy + Math.sin(ang) * r
    x2 = cx + Math.cos(ang) * (r + spike)
    y2 = cy + Math.sin(ang) * (r + spike)
    specs.push(_line(x1, y1, x2, y2, OUTLINE, W_DET))
    specs.push(_circle(x2, y2, knob, OUTLINE, MOL_RED, W_DET))
  }
  return specs
}

export function build_chromosome(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  const [bw, bh] = [w * 0.18, h * 0.62]
  const [x, y] = [cx - bw / 2, cy - bh / 2]
  const specs: Spec[] = []
  for (const rot of [28, -28]) {
    specs.push({ shape: 'rounded_rect', x: x, y: y, w: bw, h: bh, radius: bw / 2, stroke: OUTLINE, fill: MOL_BLUE, width: W_OUT, rotation: rot })
  }
  specs.push(_circle(cx, cy, Math.min(w, h) * 0.07, OUTLINE, WHITE, W_DET))
  return specs
}

export function build_neuron(w: number, h: number): Spec[] {
  let x2, y2, bx, by
  const [cx, cy] = [w * 0.42, h * 0.5]
  const r = Math.min(w, h) * 0.16
  const specs: Spec[] = [_circle(cx, cy, r, OUTLINE, CELL, W_OUT)]
  specs.push(_circle(cx, cy, r * 0.4, OUTLINE, NUCLEUS, W_DET))
  for (const ang of [Math.PI * 0.65, Math.PI * 0.9, Math.PI * 1.15, Math.PI * 1.4, Math.PI * 0.4]) {
    x2 = cx + Math.cos(ang) * r * 2.4
    y2 = cy + Math.sin(ang) * r * 2.4
    specs.push(_line(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, x2, y2, OUTLINE, W_DET))
    bx = cx + Math.cos(ang) * r * 3
    by = cy + Math.sin(ang) * r * 3
    specs.push(_line(x2, y2, bx, by, OUTLINE, W_DET))
  }
  const ax = cx + r
  const ex = w * 0.84
  specs.push(_line(ax, cy, ex, cy, OUTLINE, W_OUT))
  for (const dy of [-h * 0.12, 0, h * 0.12]) {
    specs.push(_line(ex, cy, w * 0.95, cy + dy, OUTLINE, W_DET))
  }
  return specs
}

// Molecules
export function build_dna(w: number, h: number): Spec[] {
  let t, y, ph, xa, xb, a, b, col, p, q
  const cx = w * 0.5
  const amp = w * 0.22
  const [top, bot] = [h * 0.06, h * 0.94]
  const steps = 40
  const cycles = 2
  const specs: Spec[] = []
  const strand_a: number[][] = []
  const strand_b: number[][] = []
  for (let i = 0; i < steps + 1; i++) {
    t = i / steps
    y = top + (bot - top) * t
    ph = t * cycles * 2 * Math.PI
    xa = cx + amp * Math.sin(ph)
    xb = cx + amp * Math.sin(ph + Math.PI)
    strand_a.push([xa, y])
    strand_b.push([xb, y])
  }
  for (let i = 0; i < steps + 1; i += 3) {
    ;[a, b] = [strand_a[i], strand_b[i]]
    col = pmod(Math.floor(i / 3), 2) === 0 ? MOL_BLUE : MOL_RED
    specs.push(_line(a[0], a[1], b[0], b[1], col, W_DET))
  }
  for (const strand of [strand_a, strand_b]) {
    for (let i = 0; i < strand.length - 1; i++) {
      ;[p, q] = [strand[i], strand[i + 1]]
      specs.push(_line(p[0], p[1], q[0], q[1], OUTLINE, W_OUT))
    }
  }
  return specs
}

export function build_rna(w: number, h: number): Spec[] {
  let t, y, ph, x, p, nxt, dx, dy, ln, px, py, tl, col, q
  const cx = w * 0.5
  const amp = w * 0.2
  const [top, bot] = [h * 0.06, h * 0.94]
  const steps = 40
  const cycles = 2.5
  const specs: Spec[] = []
  const strand: number[][] = []
  for (let i = 0; i < steps + 1; i++) {
    t = i / steps
    y = top + (bot - top) * t
    ph = t * cycles * 2 * Math.PI
    x = cx + amp * Math.sin(ph)
    strand.push([x, y])
  }
  for (let i = 2; i < steps; i += 4) {
    p = strand[i]
    nxt = strand[i + 1]
    ;[dx, dy] = [nxt[0] - p[0], nxt[1] - p[1]]
    ln = Math.hypot(dx, dy) || 1
    ;[px, py] = [-dy / ln, dx / ln]
    tl = w * 0.08
    col = pmod(Math.floor(i / 4), 2) === 0 ? MOL_BLUE : MOL_RED
    specs.push(_line(p[0], p[1], p[0] + px * tl, p[1] + py * tl, col, W_DET))
  }
  for (let i = 0; i < strand.length - 1; i++) {
    ;[p, q] = [strand[i], strand[i + 1]]
    specs.push(_line(p[0], p[1], q[0], q[1], OUTLINE, W_OUT))
  }
  return specs
}

export function build_protein(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  let specs: Spec[] = []
  const blobs = [[cx - w * 0.12, cy - h * 0.1, w * 0.24, h * 0.2, 20], [cx + w * 0.14, cy - h * 0.04, w * 0.2, h * 0.16, -25], [cx + w * 0.02, cy + h * 0.16, w * 0.22, h * 0.18, 10], [cx - w * 0.16, cy + h * 0.12, w * 0.16, h * 0.14, -10]]
  for (const [bx, by, bwr, bhr, rot] of blobs) {
    specs.push(_ellipse(bx, by, bwr, bhr, OUTLINE, MOL_BLUE, W_OUT, rot))
  }
  specs.push(..._wavy(cx - w * 0.18, cy + h * 0.02, cx + w * 0.2, cy - h * 0.02, h * 0.06, 2, OUTLINE, W_DET))
  return specs
}

export function build_antibody(w: number, h: number): Spec[] {
  let ax, ay
  const cx = w * 0.5
  const hinge_y = h * 0.55
  const arm_w = w * 0.1
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: cx - arm_w / 2, y: hinge_y, w: arm_w, h: h * 0.4, radius: arm_w / 2, stroke: OUTLINE, fill: MOL_BLUE, width: W_OUT })
  const arm_h = h * 0.5
  for (const [sgn, rot] of [[-1, 35], [1, -35]]) {
    ax = cx + sgn * w * 0.13
    ay = hinge_y - arm_h * 0.42
    specs.push({ shape: 'rounded_rect', x: ax - arm_w / 2, y: ay - arm_h / 2, w: arm_w, h: arm_h, radius: arm_w / 2, stroke: OUTLINE, fill: MOL_BLUE, width: W_OUT, rotation: rot })
  }
  specs.push(_circle(cx, hinge_y, arm_w * 0.5, OUTLINE, WHITE, W_DET))
  return specs
}

// Lab
export function build_petri_dish(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  const [rx, ry] = [w * 0.46, h * 0.4]
  const specs: Spec[] = [_ellipse(cx, cy, rx, ry, OUTLINE, LAB, W_OUT)]
  specs.push(_ellipse(cx, cy, rx * 0.86, ry * 0.86, MEMBRANE, 'none', W_DET))
  const spots = [[-0.3, -0.2, 0.07], [0.2, -0.25, 0.05], [0.35, 0.1, 0.06], [-0.1, 0.25, 0.08], [0.05, -0.05, 0.04], [-0.35, 0.15, 0.05]]
  for (const [fx, fy, fr] of spots) {
    specs.push(_circle(cx + rx * fx, cy + ry * fy, Math.min(w, h) * fr, OUTLINE, NUCLEUS2, W_DET))
  }
  return specs
}

export function build_well_plate(w: number, h: number): Spec[] {
  let cx, cy
  const specs: Spec[] = [{ shape: 'rounded_rect', x: w * 0.04, y: h * 0.1, w: w * 0.92, h: h * 0.8, radius: Math.min(w, h) * 0.05, stroke: OUTLINE, fill: LAB, width: W_OUT }]
  const [cols, rows] = [6, 4]
  const [x0, y0] = [w * 0.12, h * 0.22]
  const [x1, y1] = [w * 0.88, h * 0.78]
  const r = Math.min((x1 - x0) / cols, (y1 - y0) / rows) * 0.32
  for (let c = 0; c < cols; c++) {
    for (let rw = 0; rw < rows; rw++) {
      cx = x0 + (x1 - x0) * (c + 0.5) / cols
      cy = y0 + (y1 - y0) * (rw + 0.5) / rows
      specs.push(_circle(cx, cy, r, OUTLINE, WHITE, W_DET))
    }
  }
  return specs
}

export function build_microscope(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: w * 0.18, y: h * 0.82, w: w * 0.6, h: h * 0.12, radius: Math.min(w, h) * 0.03, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'rounded_rect', x: w * 0.58, y: h * 0.3, w: w * 0.1, h: h * 0.54, radius: Math.min(w, h) * 0.03, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'rounded_rect', x: w * 0.4, y: h * 0.12, w: w * 0.16, h: h * 0.4, radius: Math.min(w, h) * 0.03, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'rounded_rect', x: w * 0.43, y: h * 0.04, w: w * 0.1, h: h * 0.1, radius: Math.min(w, h) * 0.02, stroke: OUTLINE, fill: LAB, width: W_DET })
  specs.push({ shape: 'trapezoid', x: w * 0.42, y: h * 0.52, w: w * 0.12, h: h * 0.08, rotation: 180, stroke: OUTLINE, fill: LAB, width: W_DET })
  specs.push({ shape: 'rect', x: w * 0.28, y: h * 0.62, w: w * 0.32, h: h * 0.05, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'rect', x: w * 0.34, y: h * 0.6, w: w * 0.16, h: h * 0.02, stroke: OUTLINE, fill: MOL_BLUE, width: W_DET })
  return specs
}

export function build_eppendorf(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const tw = w * 0.3
  const x = cx - tw / 2
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: x - tw * 0.05, y: h * 0.04, w: tw * 1.1, h: h * 0.12, radius: Math.min(w, h) * 0.02, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'rect', x: x + tw, y: h * 0.07, w: tw * 0.12, h: h * 0.06, stroke: OUTLINE, fill: LAB, width: W_DET })
  specs.push({ shape: 'rect', x: x, y: h * 0.16, w: tw, h: h * 0.46, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push({ shape: 'triangle', x: x, y: h * 0.62, w: tw, h: h * 0.3, rotation: 180, stroke: OUTLINE, fill: LAB, width: W_OUT })
  specs.push(_line(x, h * 0.5, x + tw, h * 0.5, MOL_BLUE, W_DET))
  return specs
}

export function build_syringe(w: number, h: number): Spec[] {
  let gy
  const cx = w * 0.5
  const bw = w * 0.26
  const x = cx - bw / 2
  const specs: Spec[] = []
  specs.push(_line(cx, h * 0.02, cx, h * 0.2, OUTLINE, W_OUT))
  specs.push(_line(cx - bw * 0.5, h * 0.02, cx + bw * 0.5, h * 0.02, OUTLINE, W_OUT))
  specs.push({ shape: 'rect', x: x, y: h * 0.2, w: bw, h: h * 0.5, stroke: OUTLINE, fill: LAB, width: W_OUT })
  for (let i = 1; i < 5; i++) {
    gy = h * 0.2 + h * 0.5 * i / 5
    specs.push(_line(x, gy, x + bw * 0.4, gy, OUTLINE, W_DET))
  }
  specs.push({ shape: 'trapezoid', x: cx - bw * 0.18, y: h * 0.7, w: bw * 0.36, h: h * 0.06, rotation: 180, stroke: OUTLINE, fill: LAB, width: W_DET })
  specs.push(_line(cx, h * 0.76, cx, h * 0.98, OUTLINE, W_OUT))
  return specs
}

export function build_mouse(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.42, h * 0.5]
  const [brx, bry] = [w * 0.3, h * 0.22]
  let specs: Spec[] = [_ellipse(cx, cy, brx, bry, OUTLINE, MOL_RED, W_OUT)]
  const hx = cx - brx * 0.9
  specs.push(_ellipse(hx, cy, brx * 0.4, bry * 0.7, OUTLINE, MOL_RED, W_OUT))
  specs.push(_circle(hx - brx * 0.1, cy - bry * 0.5, Math.min(w, h) * 0.06, OUTLINE, MOL_RED, W_DET))
  specs.push(_circle(hx - brx * 0.1, cy + bry * 0.5, Math.min(w, h) * 0.06, OUTLINE, MOL_RED, W_DET))
  specs.push(_circle(hx - brx * 0.25, cy - bry * 0.15, Math.min(w, h) * 0.02, OUTLINE, OUTLINE, W_DET))
  const tx = cx + brx
  specs.push(..._wavy(tx, cy, tx + w * 0.24, cy + h * 0.06, h * 0.04, 1.5, OUTLINE, W_DET))
  return specs
}

export const REFERENCE_MM = 1000
export const SIZES: Record<string, [number, number]> = { cell: [150, 150], bacterium: [180, 100], virus: [150, 150], chromosome: [110, 160], neuron: [200, 130], dna: [110, 200], rna: [100, 200], protein: [150, 150], antibody: [140, 160], petri_dish: [170, 150], well_plate: [200, 140], microscope: [140, 180], eppendorf: [100, 180], syringe: [110, 200], mouse: [190, 110] }
export const LABELS: Record<string, string> = { cell: 'Animal cell', bacterium: 'Bacterium', virus: 'Virus', chromosome: 'Chromosome', neuron: 'Neuron', dna: 'DNA double helix', rna: 'RNA strand', protein: 'Protein', antibody: 'Antibody', petri_dish: 'Petri dish', well_plate: 'Well plate', microscope: 'Microscope', eppendorf: 'Eppendorf tube', syringe: 'Syringe', mouse: 'Lab mouse' }
export const CATEGORIES: [string, string[]][] = [['Cells & microbes', ['cell', 'bacterium', 'virus', 'chromosome', 'neuron']], ['Molecules', ['dna', 'rna', 'protein', 'antibody']], ['Lab', ['petri_dish', 'well_plate', 'microscope', 'eppendorf', 'syringe', 'mouse']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  cell: build_cell,
  bacterium: build_bacterium,
  virus: build_virus,
  chromosome: build_chromosome,
  neuron: build_neuron,
  dna: build_dna,
  rna: build_rna,
  protein: build_protein,
  antibody: build_antibody,
  petri_dish: build_petri_dish,
  well_plate: build_well_plate,
  microscope: build_microscope,
  eppendorf: build_eppendorf,
  syringe: build_syringe,
  mouse: build_mouse,
}
