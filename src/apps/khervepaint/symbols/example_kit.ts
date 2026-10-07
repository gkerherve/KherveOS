// Drawing toolkit for the built-in example schematics.
// Ported from the desktop KhervePaint (example_kit.py).

import type { Spec } from '../spec'
import { zip } from '../spec'

// : A4 portrait at 150 dpi.
export const PAGE_W = 1240
export const PAGE_H = 1754
export const PAGE_DPI = 150
// ---- palette --------------------------------------------------------
export const INK = '#1f2933'
export const MUTE = '#6b7a88'
export const FAINT = '#aab6c0'
export const PAPER = '#ffffff'
export const BEAM = '#d24b3e'  // x-rays / primary beam / excitation
export const SIGNAL = '#1f9d57'  // emitted signal / electrons / detected path
export const OPTIC = '#2f6fb0'  // lenses / optics / fields
export const DETC = '#7a45b0'  // detectors / electronics
export const SAMP = '#e0a52e'  // sample / specimen
export const COOL = '#3aa0c0'  // gas / cryogen / fluid
// : Category accent colours (header band + rule).
export const CATEGORY_COLOR: Record<string, string> = { Spectroscopy: '#1f6fb2', 'Mass spectrometry': '#c0392b', Diffraction: '#138d8d', Microscopy: '#7a3fb0', 'Thermal & sorption': '#d98324', Electrochemistry: '#2e8b57', Chromatography: '#8a6d3b' }
// light tints for housings, keyed loosely by role
export const TINT_BEAM = '#fbe6e2'
export const TINT_OPTIC = '#e4eefa'
export const TINT_SIGNAL = '#e2f5ea'
export const TINT_DET = '#efe6f8'
export const TINT_SAMP = '#fbeecb'
export const TINT_COOL = '#e2f1f7'
export const TINT_BODY = '#f3f6f9'
// ---- primitives -----------------------------------------------------
export function _t(x: any, y: any, text: any, size = 20, color = INK, bold = false): Spec {
  const d: Spec = { shape: 'text', x: x, y: y, text: text, size: size, color: color }
  if (bold) {
    d.bold = true
  }
  return d
}

// Text roughly centred on cx (Segoe UI ~0.52*size per char).
export function _tc(cx: any, y: any, text: any, size = 18, color = INK): Spec {
  return _t(cx - 0.26 * size * text.length, y, text, size, color)
}

export function _box(x: any, y: any, w: any, h: any, label = '', fill: any | null = null, stroke = INK, width = 2, shape = 'rect'): Spec {
  const d: Spec = { shape: shape, x: x, y: y, w: w, h: h, stroke: stroke, width: width }
  if (fill) {
    d.fill = fill
  }
  if (label) {
    d.label = label
  }
  return d
}

export function _round(x: any, y: any, w: any, h: any, label = '', fill: any | null = null, stroke = INK, width = 2): Spec {
  return _box(x, y, w, h, label, fill, stroke, width, 'rounded_rect')
}

export function _circle(x: any, y: any, d: any, label = '', fill: any | null = null, stroke = INK, width = 2): Spec {
  return _box(x, y, d, d, label, fill, stroke, width, 'circle')
}

export function _ellipse(x: any, y: any, w: any, h: any, label = '', fill: any | null = null, stroke = INK, width = 2): Spec {
  return _box(x, y, w, h, label, fill, stroke, width, 'ellipse')
}

export function _poly(kind: any, x: any, y: any, w: any, h: any, label = '', fill: any | null = null, stroke = INK, width = 2, rotation = 0): Spec {
  const d = _box(x, y, w, h, label, fill, stroke, width, kind)
  if (rotation) {
    d.rotation = rotation
  }
  return d
}

export function _arrow(x1: any, y1: any, x2: any, y2: any, color = BEAM, width = 4): Spec {
  return { shape: 'arrow', x1: x1, y1: y1, x2: x2, y2: y2, stroke: color, width: width }
}

export function _line(x1: any, y1: any, x2: any, y2: any, color = FAINT, width = 2): Spec {
  return { shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: color, width: width }
}

// ---- composite helpers ---------------------------------------------
// Greedy word-wrap into lines of at most *width* chars.
export function _wrap(text: any, width: any) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur.length + w.length + 1 <= width) {
      cur = `${cur} ${w}`.trim()
    } else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) {
    lines.push(cur)
  }
  return lines
}

// A leader line from a component to a label off to one side.
export function _callout(comp_x: any, comp_y: any, text: any, side = 'right', size = 17, color = INK, length = 70): Spec[] {
  let lx
  if (side === 'right') {
    lx = comp_x + length
    return [
      _line(comp_x, comp_y, lx, comp_y, FAINT, 1),
      _circle(comp_x - 3, comp_y - 3, 6, undefined, color, color),
      _t(lx + 8, comp_y - size * 0.7, text, size, color),
    ]
  }
  lx = comp_x - length
  return [
    _line(lx, comp_y, comp_x, comp_y, FAINT, 1),
    _circle(comp_x - 3, comp_y - 3, 6, undefined, color, color),
    _t(lx - 8 - 0.52 * size * text.length, comp_y - size * 0.7, text, size, color),
  ]
}

// An electromagnetic / optical lens straddling a vertical beam.
export function _lens(cx: any, cy: any, w: any, color = OPTIC, fill = TINT_OPTIC, h = 26): Spec {
  return _ellipse(cx - w / 2, cy - h / 2, w, h, undefined, fill, color, 3)
}

// A pair of bars with a central gap (an aperture / slit).
export function _aperture(cx: any, cy: any, half_gap = 10, arm = 34, color = INK): Spec[] {
  return [
    _box(cx - half_gap - arm, cy - 4, arm, 8, undefined, color, color, 0),
    _box(cx + half_gap, cy - 4, arm, 8, undefined, color, color, 0),
  ]
}

// Two outline rays through (y, half-width) control points — a
// converging/diverging beam envelope down a column.
export function _beam(cx: any, pts: any, color = SIGNAL, width = 2): Spec[] {
  const segs: Spec[] = []
  for (const [[y0, h0], [y1, h1]] of zip(pts, pts.slice(1))) {
    segs.push(_line(cx - h0, y0, cx - h1, y1, color, width))
    segs.push(_line(cx + h0, y0, cx + h1, y1, color, width))
  }
  return segs
}

// ---- panels ---------------------------------------------------------
// A framed plot: border, light gridlines, ticked axes, a trace and
// optional labelled peaks. *curve* is a list of (x_frac, y_frac) with
// y measured up from the bottom axis (0..1).
export function _plot(x: any, y: any, w: any, h: any, xlabel: any, ylabel: any, curve: any, peaks: any | null = null, color = DETC, _fill_to_axes = true): Spec[] {
  let gy, gx, tx, ty, lx
  const specs: Spec[] = [_box(x, y, w, h, undefined, PAPER, INK, 2)]
  for (let i = 1; i < 4; i++) {  // horizontal gridlines
    gy = y + h * i / 4
    specs.push(_line(x + 1, gy, x + w - 1, gy, '#eef2f5', 1))
  }
  for (let i = 1; i < 6; i++) {  // vertical gridlines
    gx = x + w * i / 6
    specs.push(_line(gx, y + 1, gx, y + h - 1, '#f1f4f7', 1))
  }
  specs.push(_line(x, y + h, x + w, y + h, INK, 2))  // x axis
  specs.push(_line(x, y, x, y + h, INK, 2))  // y axis
  for (let i = 0; i < 7; i++) {  // x ticks
    tx = x + w * i / 6
    specs.push(_line(tx, y + h, tx, y + h + 6, INK, 1))
  }
  for (let i = 0; i < 5; i++) {  // y ticks
    ty = y + h * i / 4
    specs.push(_line(x - 6, ty, x, ty, INK, 1))
  }
  for (const [a, b] of zip(curve, curve.slice(1))) {  // trace
    specs.push(_line(x + a[0] * w, y + h - a[1] * h, x + b[0] * w, y + h - b[1] * h, color, 3))
  }
  for (const [px, label] of peaks || []) {  // peak labels
    lx = x + px * w
    specs.push(_line(lx, y + 8, lx, y + 22, MUTE, 1))
    specs.push(_tc(lx, y + 24, label, 13, MUTE))
  }
  specs.push(_tc(x + w / 2, y + h + 16, xlabel, 15, MUTE))
  specs.push(_t(x + 6, y - 24, ylabel, 15, MUTE))
  return specs
}

// A dark image panel with bright blobs, a scale bar and a title.
export function _micrograph(x: any, y: any, w: any, h: any, blobs: any, title = '', scale_label = '', dark = '#0d1014'): Spec[] {
  const specs: Spec[] = [_box(x, y, w, h, undefined, dark, INK, 2)]
  for (const [bx, by, bd] of blobs) {
    specs.push(_circle(x + bx, y + by, bd, undefined, '#dce8fb', '#c4d6f3', 1))
  }
  if (scale_label) {
    specs.push(_box(x + 24, y + h - 28, 90, 7, undefined, '#ffffff', '#ffffff', 0))
    specs.push(_t(x + 24, y + h - 24, scale_label, 13, '#e8eef5'))
  }
  if (title) {
    specs.push(_tc(x + w / 2, y + h + 10, title, 15, MUTE))
  }
  return specs
}

// A small key: coloured swatch + label per row.
export function _legend(x: any, y: any, items: any, title = ''): Spec[] {
  const specs: Spec[] = []
  let yy = y
  if (title) {
    specs.push(_t(x, yy, title, 15, MUTE))
    yy += 26
  }
  for (const [color, label] of items) {
    specs.push(_box(x, yy, 22, 14, undefined, color, color, 0))
    specs.push(_t(x + 32, yy - 3, label, 15, INK))
    yy += 26
  }
  return specs
}

// A sample sitting on a small stage/holder.
export function _stage(cx: any, cy: any, w = 150, label = 'sample'): Spec[] {
  return [
    _box(cx - w / 2, cy, w, 16, undefined, '#cdd6de', MUTE, 1),
    _box(cx - w / 4, cy - 22, w / 2, 24, label, SAMP, '#9a7b1f', 2),
  ]
}

// ---- page frame -----------------------------------------------------
export function _page(title: any, subtitle: any, accent: any, body: any, caption = ''): Spec[] {
  let lines, cy
  let specs: Spec[] = [
    _box(36, 36, PAGE_W - 72, PAGE_H - 72, undefined, undefined, '#d7dee5', 2),
    _box(36, 36, 14, PAGE_H - 72, undefined, accent, accent, 0),
    _t(74, 70, title, 34, INK),
    _t(76, 132, subtitle, 20, MUTE),
    _line(74, 176, PAGE_W - 60, 176, accent, 3),
  ]
  specs.push(...body)
  if (caption) {
    lines = _wrap(caption, 72)
    cy = PAGE_H - 66 - 24 * lines.length
    for (const [i, ln] of lines.entries()) {
      specs.push(_t(76, cy + 24 * i, ln, 16, MUTE))
    }
  }
  return specs
}

