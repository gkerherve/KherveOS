// Standard flowchart node symbols (ANSI/ISO) for method & algorithm workflows.
// Ported from the desktop KhervePaint (flowchart.py).

import type { Spec } from '../spec'
import { range } from '../spec'

// Palette
const _OUTLINE = '#333333'
const _LIGHT = '#eef2f6'
const _DECISION = '#fdf0d5'
const _DATA = '#e6f0ff'
const _W_OUTLINE = 2
const _W_DETAIL = 1.2
// A centred caption naming the node, sized to fit the box.
function _label(text: string, w: number, h: number, size: number | null = null, color = _OUTLINE): Spec {
  if (size == null) {
    size = Math.max(8, Math.min(h * 0.22, w * 0.16))
  }
  return { shape: 'text', text: text, x: w / 2, y: h / 2, size: size, color: color, anchor: 'center' }
}

// A half-disc whose FINAL bounding box is (x, y, w, h), bulging towards
// `direction` ('u','d','l','r').  The half-circle primitive bulges up in
// its own box, so for left/right we swap the box dims before the 90/270
// rotation — keeping the disc round instead of squashing it.
function _hdisc(x: number, y: number, w: number, h: number, direction: string, fill = _LIGHT, width = _W_OUTLINE): Spec {
  let bx, by, bw, bh, rot
  const [cx, cy] = [x + w / 2, y + h / 2]
  if (direction === 'u') {
    ;[bx, by, bw, bh, rot] = [x, y, w, h, 0]
  } else if (direction === 'd') {
    ;[bx, by, bw, bh, rot] = [x, y, w, h, 180]
  } else {
    ;[bw, bh] = [h, w]
    ;[bx, by] = [cx - bw / 2, cy - bh / 2]
    rot = direction === 'r' ? 90 : 270
  }
  return { shape: 'halfcircle', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill: fill, width: width, rotation: rot }
}

// Nodes
export function build_process(w: number, h: number): Spec[] {
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Process', w, h),
  ]
}

export function build_decision(w: number, h: number): Spec[] {
  return [
    { shape: 'diamond', x: 0, y: 0, w: w, h: h, rotation: 0, stroke: _OUTLINE, fill: _DECISION, width: _W_OUTLINE },
    _label('Decision', w, h, Math.max(8, Math.min(h * 0.16, w * 0.13))),
  ]
}

export function build_terminator(w: number, h: number): Spec[] {
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: h, radius: h / 2, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Start / End', w, h, Math.max(8, Math.min(h * 0.2, w * 0.11))),
  ]
}

export function build_data(w: number, h: number): Spec[] {
  return [
    { shape: 'parallelogram', x: 0, y: 0, w: w, h: h, rotation: 0, stroke: _OUTLINE, fill: _DATA, width: _W_OUTLINE },
    _label('Data', w, h),
  ]
}

// Rectangle with a wavy bottom edge (the classic 'document' symbol).
export function build_document(w: number, h: number): Spec[] {
  const body_h = h * 0.82
  const amp = h * 0.1
  const specs: Spec[] = [
    // filled body (no border; edges drawn separately so the bottom waves)
    { shape: 'rect', x: 0, y: 0, w: w, h: body_h, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: 0, y1: 0, x2: w, y2: 0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: 0, y1: 0, x2: 0, y2: body_h, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: 0, x2: w, y2: body_h, stroke: _OUTLINE, width: _W_OUTLINE },
  ]
  // wavy bottom edge as a sine polyline
  const n = 24
  const pts = range(n + 1).map((i) => [w * (i / n), body_h + amp * Math.sin(i / n * 2 * Math.PI)])
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: _OUTLINE, width: _W_OUTLINE })
  }
  specs.push(_label('Document', w, h, Math.max(8, Math.min(h * 0.18, w * 0.12))))
  return specs
}

// Rectangle with double vertical bars near the left/right edges.
export function build_predefined_process(w: number, h: number): Spec[] {
  const bar = w * 0.12
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: bar, y1: 0, x2: bar, y2: h, stroke: _OUTLINE, width: _W_DETAIL },
    { shape: 'line', x1: w - bar, y1: 0, x2: w - bar, y2: h, stroke: _OUTLINE, width: _W_DETAIL },
    _label('Process', w, h),
  ]
}

export function build_preparation(w: number, h: number): Spec[] {
  return [
    { shape: 'hexagon', x: 0, y: 0, w: w, h: h, rotation: 0, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Prepare', w, h),
  ]
}

// Quadrilateral with a slanted top edge (trapezoid rotated 180°).
export function build_manual_input(w: number, h: number): Spec[] {
  return [
    { shape: 'trapezoid', x: 0, y: 0, w: w, h: h, rotation: 180, stroke: _OUTLINE, fill: _DATA, width: _W_OUTLINE },
    _label('Input', w, h),
  ]
}

// Cylinder: rect body + ellipse top rim + curved (halfcircle) bottom.
export function build_database(w: number, h: number): Spec[] {
  const rim = h * 0.22
  const body_top = rim / 2
  const body_bot = h - rim / 2
  const specs: Spec[] = [
    // body fill (between the rims) + side lines
    { shape: 'rect', x: 0, y: body_top, w: w, h: body_bot - body_top, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: 0, y1: body_top, x2: 0, y2: body_bot, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: body_top, x2: w, y2: body_bot, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved bottom (front of the cylinder, bulging down)
    _hdisc(0, body_bot - rim / 2, w, rim, 'd', _LIGHT),
    // top rim ellipse
    { shape: 'ellipse', x: 0, y: 0, w: w, h: rim, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
  ]
  specs.push(_label('Database', w, h, Math.max(8, Math.min(h * 0.16, w * 0.13))))
  return specs
}

// Rectangle with a curved left side (stored-data symbol).
export function build_stored_data(w: number, h: number): Spec[] {
  const bulge = w * 0.16
  return [
    // body fill + top/bottom/right edges
    { shape: 'rect', x: bulge, y: 0, w: w - bulge, h: h, stroke: 'none', fill: _DATA, width: _W_OUTLINE },
    { shape: 'line', x1: bulge, y1: 0, x2: w, y2: 0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: bulge, y1: h, x2: w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: 0, x2: w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved left side bulging left (flat edge meets the body at x=bulge)
    _hdisc(0, 0, bulge, h, 'l', _DATA),
    _label('Data', w + bulge, h),
  ]  // nudge label right of the curve
}

export function build_connector(w: number, h: number): Spec[] {
  return [
    { shape: 'circle', x: 0, y: 0, w: w, h: h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('A', w, h, Math.max(8, Math.min(h * 0.42, w * 0.42))),
  ]
}

// Display symbol: a curved (rounded) left end and a rounded right end.
export function build_display(w: number, h: number): Spec[] {
  const cap = h * 0.5  // left half-disc radius worth of width
  const bump = w * 0.18  // right rounded snout
  const body_x = cap
  const body_w = w - cap - bump
  return [
    // straight body fill between the two curved ends
    { shape: 'rect', x: body_x, y: 0, w: body_w, h: h, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: body_x, y1: 0, x2: body_x + body_w, y2: 0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: body_x, y1: h, x2: body_x + body_w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved left end (bulging left)
    _hdisc(0, 0, cap, h, 'l', _LIGHT),
    // rounded right snout (bulging right)
    _hdisc(body_x + body_w, 0, bump, h, 'r', _LIGHT),
    _label('Display', w, h, Math.max(8, Math.min(h * 0.2, w * 0.13))),
  ]
}

// Connectors
export function build_flow_arrow(w: number, h: number): Spec[] {
  return [{ shape: 'arrow', x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: _OUTLINE, width: _W_OUTLINE }]
}

export function build_flow_line(w: number, h: number): Spec[] {
  return [{ shape: 'line', x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: _OUTLINE, width: _W_OUTLINE }]
}

// Sizes (mm), labels, categories
export const REFERENCE_MM = 1400
export const SIZES: Record<string, [number, number]> = { process: [200, 100], decision: [160, 140], terminator: [200, 90], data: [200, 100], document: [200, 110], predefined_process: [200, 100], preparation: [200, 110], manual_input: [200, 100], database: [140, 150], stored_data: [160, 110], connector: [70, 70], display: [200, 110], flow_arrow: [180, 30], flow_line: [180, 20] }
export const LABELS: Record<string, string> = { process: 'Process', decision: 'Decision', terminator: 'Terminator (Start/End)', data: 'Data (I/O)', document: 'Document', predefined_process: 'Predefined process', preparation: 'Preparation', manual_input: 'Manual input', database: 'Database', stored_data: 'Stored data', connector: 'Connector', display: 'Display', flow_arrow: 'Flow arrow', flow_line: 'Flow line' }
export const CATEGORIES: [string, string[]][] = [['Nodes', ['process', 'decision', 'terminator', 'data', 'document', 'predefined_process', 'preparation', 'manual_input']], ['Data & storage', ['database', 'stored_data', 'connector', 'display']], ['Connectors', ['flow_arrow', 'flow_line']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  process: build_process,
  decision: build_decision,
  terminator: build_terminator,
  data: build_data,
  document: build_document,
  predefined_process: build_predefined_process,
  preparation: build_preparation,
  manual_input: build_manual_input,
  database: build_database,
  stored_data: build_stored_data,
  connector: build_connector,
  display: build_display,
  flow_arrow: build_flow_arrow,
  flow_line: build_flow_line,
}
