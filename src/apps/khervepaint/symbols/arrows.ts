// Annotation arrows, callouts and banners.
// Ported from the desktop KhervePaint (arrows.py).

import type { Spec } from '../spec'
import { deg, pmod, rad, range } from '../spec'

export const OUTLINE = '#333333'
export const FILL = '#dfe7ee'
export const ACCENT = '#cfe0f5'
// Filled triangle, apex at (cx, cy), reaching `length` in `direction`
// ('l','r','u','d'); box dims swapped before 90/270 so it isn't squashed.
function _tri(cx: number, cy: number, length: number, base: number, direction: string, fill = FILL): Spec {
  let x, y, rot, cxb
  if (['u', 'd'].includes(direction)) {
    if (direction === 'u') {
      ;[x, y, rot] = [cx - base * 0.5, cy, 0]
    } else {
      ;[x, y, rot] = [cx - base * 0.5, cy - length, 180]
    }
    return { shape: 'triangle', x: x, y: y, w: base, h: length, stroke: OUTLINE, fill: fill, width: 2, rotation: rot }
  }
  if (direction === 'r') {
    ;[cxb, rot] = [cx - length * 0.5, 90]
  } else {
    ;[cxb, rot] = [cx + length * 0.5, 270]
  }
  return { shape: 'triangle', x: cxb - base * 0.5, y: cy - length * 0.5, w: base, h: length, stroke: OUTLINE, fill: fill, width: 2, rotation: rot }
}

export function build_arrow_right(w: number, h: number): Spec[] {
  return [{ shape: 'arrow_right', x: 0, y: 0, w: w, h: h, rotation: 0, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function build_arrow_left(w: number, h: number): Spec[] {
  return [{ shape: 'arrow_right', x: 0, y: 0, w: w, h: h, rotation: 180, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function build_arrow_up(w: number, h: number): Spec[] {
  return [{ shape: 'arrow_right', x: 0, y: 0, w: w, h: h, rotation: 270, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function build_arrow_down(w: number, h: number): Spec[] {
  return [{ shape: 'arrow_right', x: 0, y: 0, w: w, h: h, rotation: 90, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function build_double_arrow(w: number, h: number): Spec[] {
  const head = w * 0.26
  const cy = h * 0.5
  const shaft_h = h * 0.42
  return [
    { shape: 'rect', x: head, y: cy - shaft_h * 0.5, w: w - 2 * head, h: shaft_h, stroke: OUTLINE, fill: FILL, width: 2 },
    _tri(0, cy, head, h, 'l'),
    _tri(w, cy, head, h, 'r'),
  ]  // left head, apex at far left; right head, apex at far right
}

// Filled arrowhead, apex at (tipx, tipy), pointing along `ang` (rad).
// A square box keeps it undistorted under arbitrary rotation.
function _head(tipx: number, tipy: number, ang: number, size: number, fill = FILL): Spec {
  const cx = tipx - size * 0.5 * Math.cos(ang)
  const cy = tipy - size * 0.5 * Math.sin(ang)
  return { shape: 'triangle', x: cx - size * 0.5, y: cy - size * 0.5, w: size, h: size, rotation: deg(ang) + 90, stroke: OUTLINE, fill: fill, width: 2 }
}

// A smooth ~110° arc with a filled arrowhead tangent at its tip.
export function build_curved_arrow(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.18, h * 0.82]
  const [rx, ry] = [w * 0.66, h * 0.66]
  const a0 = rad(-100)
  const a1 = rad(8)
  const n = 24
  const pts = range(n + 1).map((i) => [cx + rx * Math.cos(a0 + (a1 - a0) * i / n), cy + ry * Math.sin(a0 + (a1 - a0) * i / n)])
  const specs: Spec[] = range(pts.length - 1).map((i) => ({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: OUTLINE, width: 2 }))
  const [ex, ey] = pts.at(-1)!
  const [px, py] = pts.at(-2)!
  specs.push(_head(ex, ey, Math.atan2(ey - py, ex - px), Math.min(w, h) * 0.28))
  return specs
}

export function build_bent_arrow(w: number, h: number): Spec[] {
  const sw = Math.min(w, h) * 0.16
  const head = Math.min(w, h) * 0.3
  const vx = w - sw - head * 0.5
  return [
    { shape: 'rect', x: 0, y: h - sw, w: vx + sw, h: sw, stroke: OUTLINE, fill: FILL, width: 2 },
    { shape: 'rect', x: vx, y: head, w: sw, h: h - head - sw, stroke: OUTLINE, fill: FILL, width: 2 },
    { shape: 'triangle', x: vx + sw / 2 - head / 2, y: 0, w: head, h: head, rotation: 0, stroke: OUTLINE, fill: FILL, width: 2 },
  ]
}

// A cycle/refresh arrow: a ~300° ring drawn as a polyline + a V head.
export function build_circular_arrow(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.52]
  const [rx, ry] = [w * 0.36, h * 0.36]
  const a0 = rad(70)
  const a1 = rad(70 + 300)
  const n = 28
  const pts = range(n + 1).map((i) => [cx + rx * Math.cos(a0 + (a1 - a0) * i / n), cy + ry * Math.sin(a0 + (a1 - a0) * i / n)])
  const specs: Spec[] = range(pts.length - 1).map((i) => ({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: OUTLINE, width: 2 }))
  // V arrowhead at the end, along the tangent
  const [end, prev] = [pts.at(-1)!, pts.at(-2)!]
  const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0])
  const hd = Math.min(w, h) * 0.18
  for (const da of [rad(150), rad(-150)]) {
    specs.push({ shape: 'line', x1: end[0], y1: end[1], x2: end[0] + hd * Math.cos(ang + da), y2: end[1] + hd * Math.sin(ang + da), stroke: OUTLINE, width: 2 })
  }
  return specs
}

export function build_callout_rect(w: number, h: number): Spec[] {
  const body_h = h * 0.78
  const tail_w = w * 0.18
  const tail_x = w * 0.15
  return [
    { shape: 'rect', x: 0, y: 0, w: w, h: body_h, stroke: OUTLINE, fill: FILL, width: 2 },
    { shape: 'triangle', x: tail_x, y: body_h, w: tail_w, h: h - body_h, rotation: 180, stroke: OUTLINE, fill: FILL, width: 2 },
  ]
}

export function build_callout_round(w: number, h: number): Spec[] {
  const body_h = h * 0.78
  const tail_w = w * 0.18
  const tail_x = w * 0.15
  return [
    { shape: 'rounded_rect', x: 0, y: 0, w: w, h: body_h, radius: Math.min(w, body_h) * 0.18, stroke: OUTLINE, fill: FILL, width: 2 },
    { shape: 'triangle', x: tail_x, y: body_h, w: tail_w, h: h - body_h, rotation: 180, stroke: OUTLINE, fill: FILL, width: 2 },
  ]
}

// A ribbon banner: a rectangle with a fishtail (V-notch) cut into each
// short end.
export function build_banner(w: number, h: number): Spec[] {
  let x1, y1, x2, y2
  const notch = w * 0.1
  const cy = h * 0.5
  const specs: Spec[] = [
    // body fill (border drawn separately so the ends can be notched)
    { shape: 'rect', x: 0, y: 0, w: w, h: h, stroke: 'none', fill: FILL, width: 2 },
    // carve the two fishtail notches with background-coloured triangles
    { ..._tri(notch, cy, notch, h, 'r'), stroke: 'none', fill: '#ffffff' },
    { ..._tri(w - notch, cy, notch, h, 'l'), stroke: 'none', fill: '#ffffff' },
  ]
  // outline of the resulting banner (6 segments)
  const pts = [[0, 0], [w, 0], [w - notch, cy], [w, h], [0, h], [notch, cy]]
  for (let i = 0; i < pts.length; i++) {
    ;[x1, y1] = pts[i]
    ;[x2, y2] = pts[pmod(i + 1, pts.length)]
    specs.push({ shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: OUTLINE, width: 2 })
  }
  return specs
}

export function build_burst(w: number, h: number): Spec[] {
  return [
    { shape: 'star', x: 0, y: 0, w: w, h: h, rotation: 0, stroke: OUTLINE, fill: ACCENT, width: 2 },
    { shape: 'text', text: 'NEW!', x: w * 0.5, y: h * 0.5, size: h * 0.18, color: OUTLINE, anchor: 'center' },
  ]
}

// Thin line connectors (same look as the straight arrow tool, but curved /
// bent).  Drawn as a thin polyline + a small solid arrowhead at the tip.
function _seg(x1: number, y1: number, x2: number, y2: number): Spec {
  return { shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: OUTLINE, width: 2 }
}

// Line specs through `pts` plus a solid arrowhead on the last segment.
function _polyline_head(pts: number[][], hsize: number): Spec[] {
  const specs: Spec[] = range(pts.length - 1).map((i) => _seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  const [ex, ey] = pts.at(-1)!
  const [px, py] = pts.at(-2)!
  specs.push(_head(ex, ey, Math.atan2(ey - py, ex - px), hsize, OUTLINE))
  return specs
}

// A gently curved thin arrow (quadratic bezier) — tail bottom-left,
// head top-right.
export function build_connector_curve(w: number, h: number): Spec[] {
  let t, mt
  const [x0, y0] = [w * 0.05, h * 0.8]
  const [x1, y1] = [w * 0.93, h * 0.3]
  const [cxp, cyp] = [w * 0.45, h * 0.02]  // control point bows the curve up
  const n = 22
  const pts: number[][] = []
  for (let i = 0; i < n + 1; i++) {
    t = i / n
    mt = 1 - t
    pts.push([mt * mt * x0 + 2 * mt * t * cxp + t * t * x1, mt * mt * y0 + 2 * mt * t * cyp + t * t * y1])
  }
  return _polyline_head(pts, Math.min(w, h) * 0.18)
}

// A right-angle (elbow) thin arrow: across, then down to the head.
export function build_connector_elbow(w: number, h: number): Spec[] {
  const [x0, y0] = [w * 0.06, h * 0.18]
  const xc = w * 0.85
  const y1 = h * 0.92
  return _polyline_head([[x0, y0], [xc, y0], [xc, y1]], Math.min(w, h) * 0.16)
}

// A stepped (Z) thin arrow: across, down, across to the head.
export function build_connector_zigzag(w: number, h: number): Spec[] {
  const [x0, y0] = [w * 0.06, h * 0.22]
  const xm = w * 0.52
  const [x1, y1] = [w * 0.94, h * 0.78]
  return _polyline_head([[x0, y0], [xm, y0], [xm, y1], [x1, y1]], Math.min(w, h) * 0.16)
}

// A U-turn thin arrow: up, across, back down to the head.
export function build_connector_u(w: number, h: number): Spec[] {
  const [x0, y0] = [w * 0.22, h * 0.94]
  const yt = h * 0.1
  const x1 = w * 0.78
  return _polyline_head([[x0, y0], [x0, yt], [x1, yt], [x1, y0]], Math.min(w, h) * 0.16)
}

export const REFERENCE_MM = 1200
export const SIZES: Record<string, [number, number]> = { arrow_right: [200, 100], arrow_left: [200, 100], arrow_up: [100, 200], arrow_down: [100, 200], double_arrow: [200, 100], curved_arrow: [160, 160], bent_arrow: [160, 160], circular_arrow: [160, 160], callout_rect: [220, 150], callout_round: [220, 150], banner: [260, 90], burst: [160, 160], connector_curve: [220, 130], connector_elbow: [180, 160], connector_zigzag: [200, 150], connector_u: [160, 170] }
export const LABELS: Record<string, string> = { arrow_right: 'Arrow right', arrow_left: 'Arrow left', arrow_up: 'Arrow up', arrow_down: 'Arrow down', double_arrow: 'Double arrow', curved_arrow: 'Curved arrow', bent_arrow: 'Bent arrow', circular_arrow: 'Circular arrow', callout_rect: 'Rectangular callout', callout_round: 'Rounded callout', banner: 'Ribbon banner', burst: 'Starburst badge', connector_curve: 'Curved connector', connector_elbow: 'Elbow connector', connector_zigzag: 'Z-bend connector', connector_u: 'U-turn connector' }
export const CATEGORIES: [string, string[]][] = [['Block arrows', ['arrow_right', 'arrow_left', 'arrow_up', 'arrow_down', 'double_arrow']], ['Special arrows', ['curved_arrow', 'bent_arrow', 'circular_arrow']], ['Callouts & banners', ['callout_rect', 'callout_round', 'banner', 'burst']], ['Connectors', ['connector_curve', 'connector_elbow', 'connector_zigzag', 'connector_u']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  arrow_right: build_arrow_right,
  arrow_left: build_arrow_left,
  arrow_up: build_arrow_up,
  arrow_down: build_arrow_down,
  double_arrow: build_double_arrow,
  curved_arrow: build_curved_arrow,
  bent_arrow: build_bent_arrow,
  circular_arrow: build_circular_arrow,
  callout_rect: build_callout_rect,
  callout_round: build_callout_round,
  banner: build_banner,
  burst: build_burst,
  connector_curve: build_connector_curve,
  connector_elbow: build_connector_elbow,
  connector_zigzag: build_connector_zigzag,
  connector_u: build_connector_u,
}
