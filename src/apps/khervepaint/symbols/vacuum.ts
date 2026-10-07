// Schematic vacuum / surface-science symbols (UHV systems: XPS/AES/SIMS).
// Ported from the desktop KhervePaint (vacuum.py).

import type { Spec } from '../spec'
import { pmod } from '../spec'

// Palette
const _OUT = '#333333'  // outline
const _BODY = '#e6e9ee'  // steel / body
const _STEEL = '#cfd6de'  // darker steel
const _ACC = '#333333'  // accent
const _NONE = 'none'
const _W = 2  // outline width
const _D = 1.2  // detail width
// Chamber & sources
// UHV chamber: octagon body with short flange stubs on its sides.
export function build_chamber(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  const [ow, oh] = [w * 0.62, h * 0.62]
  const [ox, oy] = [cx - ow * 0.5, cy - oh * 0.5]
  const specs: Spec[] = [{ shape: 'octagon', x: ox, y: oy, w: ow, h: oh, stroke: _OUT, fill: _BODY, width: _W }]
  // flange stubs: top, bottom, left, right + four diagonals approximated
  const [sw, sh] = [w * 0.1, h * 0.07]
  // top stub
  specs.push({ shape: 'rect', x: cx - sw * 0.5, y: oy - sh, w: sw, h: sh, stroke: _OUT, fill: _STEEL, width: _D })
  // bottom stub
  specs.push({ shape: 'rect', x: cx - sw * 0.5, y: oy + oh, w: sw, h: sh, stroke: _OUT, fill: _STEEL, width: _D })
  // left stub
  specs.push({ shape: 'rect', x: ox - sh, y: cy - sw * 0.5, w: sh, h: sw, stroke: _OUT, fill: _STEEL, width: _D })
  // right stub
  specs.push({ shape: 'rect', x: ox + ow, y: cy - sw * 0.5, w: sh, h: sw, stroke: _OUT, fill: _STEEL, width: _D })
  return specs
}

// Hemispherical electron analyser: halfcircle dome on a snout column.
export function build_analyser(w: number, h: number): Spec[] {
  const dome_w = w * 0.78
  const dome_h = h * 0.58
  const dome_x = (w - dome_w) * 0.5
  const dome_y = h * 0.06
  const specs: Spec[] = [{ shape: 'halfcircle', x: dome_x, y: dome_y, w: dome_w, h: dome_h, stroke: _OUT, fill: _BODY, width: _W, rotation: 0 }]
  // inner hemisphere hint
  const in_w = dome_w * 0.55
  const in_h = dome_h * 0.55
  specs.push({ shape: 'halfcircle', x: (w - in_w) * 0.5, y: dome_y + (dome_h - in_h), w: in_w, h: in_h, stroke: _OUT, fill: _STEEL, width: _D, rotation: 0 })
  // lens / snout column below
  const col_w = w * 0.2
  const col_h = h * 0.34
  const col_x = (w - col_w) * 0.5
  const col_y = dome_y + dome_h
  specs.push({ shape: 'rect', x: col_x, y: col_y, w: col_w, h: col_h, stroke: _OUT, fill: _STEEL, width: _W })
  return specs
}

// Rectangular source body with angled anode line + stub at the sample.
export function build_xray_source(w: number, h: number): Spec[] {
  const [bw, bh] = [w * 0.58, h * 0.62]
  const [bx, by] = [w * 0.06, (h - bh) * 0.5]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  // angled anode line inside
  specs.push({ shape: 'line', x1: bx + bw * 0.25, y1: by + bh * 0.25, x2: bx + bw * 0.75, y2: by + bh * 0.75, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: bx + bw * 0.25, y1: by + bh * 0.75, x2: bx + bw * 0.55, y2: by + bh * 0.45, stroke: _ACC, width: _D })
  // short stub pointing at the sample (right)
  const stub_y = by + bh * 0.5
  specs.push({ shape: 'rect', x: bx + bw, y: stub_y - h * 0.06, w: w * 0.14, h: h * 0.12, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'line', x1: bx + bw + w * 0.14, y1: stub_y, x2: w * 0.96, y2: stub_y, stroke: _ACC, width: _D })
  return specs
}

// Tapering nozzle: trapezoid (narrow end out) + barrel emitting an arrow.
export function build_ion_gun(w: number, h: number): Spec[] {
  const cy = h * 0.5
  // barrel (wide end, left)
  const [bw, bh] = [w * 0.3, h * 0.42]
  const [bx, by] = [w * 0.05, cy - bh * 0.5]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  // tapering trapezoid nozzle (narrow end out -> rotate so it points right)
  const [tw, th] = [w * 0.34, h * 0.5]
  const [tx, ty] = [bx + bw, cy - th * 0.5]
  specs.push({ shape: 'trapezoid', x: tx, y: ty, w: tw, h: th, stroke: _OUT, fill: _STEEL, width: _W, rotation: 90 })
  // emitted ion arrow
  specs.push({ shape: 'arrow', x1: tx + tw, y1: cy, x2: w * 0.97, y2: cy, stroke: _ACC, width: _W })
  return specs
}

// Tapering barrel with a filament hint (V) at the wide end.
export function build_electron_gun(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const [bw, bh] = [w * 0.3, h * 0.46]
  const [bx, by] = [w * 0.05, cy - bh * 0.5]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  // filament V hint at the wide (left) end
  const fx = bx + bw * 0.15
  specs.push({ shape: 'line', x1: fx, y1: cy - bh * 0.22, x2: bx + bw * 0.45, y2: cy, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: fx, y1: cy + bh * 0.22, x2: bx + bw * 0.45, y2: cy, stroke: _ACC, width: _D })
  // tapering trapezoid barrel
  const [tw, th] = [w * 0.34, h * 0.46]
  const [tx, ty] = [bx + bw, cy - th * 0.5]
  specs.push({ shape: 'trapezoid', x: tx, y: ty, w: tw, h: th, stroke: _OUT, fill: _STEEL, width: _W, rotation: 90 })
  // emitted electron arrow
  specs.push({ shape: 'arrow', x1: tx + tw, y1: cy, x2: w * 0.97, y2: cy, stroke: _ACC, width: _W })
  return specs
}

// Sample manipulator: long vertical rod with a sample stage at bottom.
export function build_manipulator(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const rod_w = w * 0.16
  const rod_h = h * 0.74
  const specs: Spec[] = [{ shape: 'rect', x: cx - rod_w * 0.5, y: h * 0.04, w: rod_w, h: rod_h, stroke: _OUT, fill: _STEEL, width: _W }]
  // top knob / drive
  const [kw, kh] = [w * 0.34, h * 0.1]
  specs.push({ shape: 'rect', x: cx - kw * 0.5, y: h * 0.02, w: kw, h: kh, stroke: _OUT, fill: _BODY, width: _D })
  // sample stage plate at bottom
  const [pw, ph] = [w * 0.56, h * 0.12]
  specs.push({ shape: 'rect', x: cx - pw * 0.5, y: h * 0.04 + rod_h, w: pw, h: ph, stroke: _OUT, fill: _BODY, width: _W })
  return specs
}

// Pumps
// Circle with angled turbine blade lines inside, on a flange stub.
export function build_turbo_pump(w: number, h: number): Spec[] {
  let a, x1, y1, x2, y2
  const d = Math.min(w, h * 0.82)
  const cx = w * 0.5
  const cy = h * 0.42
  const cir_x = cx - d * 0.5
  const cir_y = cy - d * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: cir_x, y: cir_y, w: d, h: d, stroke: _OUT, fill: _BODY, width: _W }]
  // angled turbine blades
  const r = d * 0.5
  const n = 8
  for (let i = 0; i < n; i++) {
    a = 2 * Math.PI * i / n
    x1 = cx + Math.cos(a) * r * 0.35
    y1 = cy + Math.sin(a) * r * 0.35
    x2 = cx + Math.cos(a + 0.5) * r * 0.92
    y2 = cy + Math.sin(a + 0.5) * r * 0.92
    specs.push({ shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: _ACC, width: _D })
  }
  // hub
  const hd = d * 0.16
  specs.push({ shape: 'circle', x: cx - hd * 0.5, y: cy - hd * 0.5, w: hd, h: hd, stroke: _OUT, fill: _STEEL, width: _D })
  // flange stub
  const [sw, sh] = [w * 0.34, h * 0.12]
  specs.push({ shape: 'rect', x: cx - sw * 0.5, y: cir_y + d, w: sw, h: sh, stroke: _OUT, fill: _STEEL, width: _D })
  return specs
}

// Rectangular body with a magnet U hint and a flange stub.
export function build_ion_pump(w: number, h: number): Spec[] {
  const [bw, bh] = [w * 0.78, h * 0.62]
  const [bx, by] = [(w - bw) * 0.5, h * 0.08]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  // magnet "U" hint
  const ux = bx + bw * 0.22
  const uy = by + bh * 0.22
  const uw = bw * 0.56
  const uh = bh * 0.5
  specs.push({ shape: 'line', x1: ux, y1: uy, x2: ux, y2: uy + uh, stroke: _ACC, width: _W })
  specs.push({ shape: 'line', x1: ux, y1: uy + uh, x2: ux + uw, y2: uy + uh, stroke: _ACC, width: _W })
  specs.push({ shape: 'line', x1: ux + uw, y1: uy + uh, x2: ux + uw, y2: uy, stroke: _ACC, width: _W })
  // flange stub at bottom
  const [sw, sh] = [w * 0.3, h * 0.14]
  specs.push({ shape: 'rect', x: w * 0.5 - sw * 0.5, y: by + bh, w: sw, h: sh, stroke: _OUT, fill: _STEEL, width: _D })
  return specs
}

// Box with an internal spiral (coiled polyline of lines).
export function build_scroll_pump(w: number, h: number): Spec[] {
  let t, a, r
  const [bw, bh] = [w * 0.84, h * 0.84]
  const [bx, by] = [(w - bw) * 0.5, (h - bh) * 0.5]
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  // spiral: archimedean, approximated by a polyline
  const [cx, cy] = [w * 0.5, h * 0.5]
  const rmax = Math.min(bw, bh) * 0.4
  const turns = 2.5
  const steps = 48
  const pts: number[][] = []
  for (let i = 0; i < steps + 1; i++) {
    t = i / steps
    a = t * turns * 2 * Math.PI
    r = rmax * t
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: _ACC, width: _D })
  }
  return specs
}

// Circle with an off-centre smaller circle (eccentric rotor) on a base.
export function build_rotary_pump(w: number, h: number): Spec[] {
  const d = Math.min(w, h * 0.78)
  const cx = w * 0.5
  const cy = h * 0.4
  const cir_x = cx - d * 0.5
  const cir_y = cy - d * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: cir_x, y: cir_y, w: d, h: d, stroke: _OUT, fill: _BODY, width: _W }]
  // eccentric rotor circle
  const rd = d * 0.46
  const rx = cx - rd * 0.5 + d * 0.14
  const ry = cy - rd * 0.5 - d * 0.1
  specs.push({ shape: 'circle', x: rx, y: ry, w: rd, h: rd, stroke: _OUT, fill: _STEEL, width: _D })
  // base rect
  const [bw, bh] = [w * 0.74, h * 0.16]
  specs.push({ shape: 'rect', x: w * 0.5 - bw * 0.5, y: cir_y + d, w: bw, h: bh, stroke: _OUT, fill: _STEEL, width: _W })
  return specs
}

// Circle with concentric cold-baffle rings on a flange stub.
export function build_cryo_pump(w: number, h: number): Spec[] {
  let rd
  const d = Math.min(w, h * 0.82)
  const cx = w * 0.5
  const cy = h * 0.42
  const cir_x = cx - d * 0.5
  const cir_y = cy - d * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: cir_x, y: cir_y, w: d, h: d, stroke: _OUT, fill: _BODY, width: _W }]
  for (const f of [0.66, 0.34]) {
    rd = d * f
    specs.push({ shape: 'circle', x: cx - rd * 0.5, y: cy - rd * 0.5, w: rd, h: rd, stroke: _OUT, fill: _NONE, width: _D })
  }
  // flange stub
  const [sw, sh] = [w * 0.34, h * 0.12]
  specs.push({ shape: 'rect', x: cx - sw * 0.5, y: cir_y + d, w: sw, h: sh, stroke: _OUT, fill: _STEEL, width: _D })
  return specs
}

// Valves & fittings
// A filled triangle whose APEX is at (cx, cy), base `base` wide, reaching
// `length` away in `direction` ('l','r','u','d').  Built so the rotated
// bounding box keeps the intended proportions (no aspect distortion): a
// horizontal triangle uses a (base-tall x length-wide) footprint.
//
// A plain "triangle" polygon points up in its box, so we size the box as
// width=base / height=length when pointing up/down, and width=base /
// height=length with a 90/270 rotation when pointing left/right — placing
// the box centre so the apex lands exactly on (cx, cy).
function _tri_pointing(cx: number, cy: number, length: number, base: number, direction: string): Spec {
  let x, y, rot, cxb
  if (['u', 'd'].includes(direction)) {
    // up/down: no rotation distortion (box already base-wide, length-tall)
    if (direction === 'u') {  // apex at top of box -> put box top at apex
      ;[x, y, rot] = [cx - base * 0.5, cy, 0]
    } else {
      ;[x, y, rot] = [cx - base * 0.5, cy - length, 180]
    }
    return { shape: 'triangle', x: x, y: y, w: base, h: length, stroke: _OUT, fill: _BODY, width: _W, rotation: rot }
  }
  // left/right: box is base-wide x length-tall, rotated 90/270; the box
  // centre sits half a length toward `direction` so the apex meets (cx, cy).
  if (direction === 'r') {
    ;[cxb, rot] = [cx - length * 0.5, 90]
  } else {
    ;[cxb, rot] = [cx + length * 0.5, 270]
  }
  return { shape: 'triangle', x: cxb - base * 0.5, y: cy - length * 0.5, w: base, h: length, stroke: _OUT, fill: _BODY, width: _W, rotation: rot }
}

// Two triangles tip-to-tip (apexes meeting cleanly at the centre).
function _bowtie(cx: number, cy: number, bw: number, bh: number): Spec[] {
  const half = bw * 0.5
  return [
    _tri_pointing(cx, cy, half, bh, 'r'),
    _tri_pointing(cx, cy, half, bh, 'l'),
  ]  // left half, points right; right half, points left
}

// Bow-tie with a handle stem on top.
export function build_gate_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.56]
  const [bw, bh] = [w * 0.72, h * 0.52]
  const specs = _bowtie(cx, cy, bw, bh)
  // handle stem
  specs.push({ shape: 'line', x1: cx, y1: cy - bh * 0.5, x2: cx, y2: h * 0.1, stroke: _ACC, width: _W })
  // handle top bar
  specs.push({ shape: 'line', x1: cx - w * 0.18, y1: h * 0.1, x2: cx + w * 0.18, y2: h * 0.1, stroke: _ACC, width: _W })
  return specs
}

// Right-angle valve: a horizontal port and a downward port meeting at
// the seat at 90°, with a bonnet/handle stem opposite.
export function build_angle_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.5]
  const port = h * 0.4  // port width (base of each triangle)
  const reach_h = w * 0.42  // horizontal reach to the left
  const reach_v = h * 0.42  // vertical reach downward
  const specs: Spec[] = [
    _tri_pointing(cx, cy, reach_h, port, 'r'),
    _tri_pointing(cx, cy, reach_v, port, 'u'),
  ]  // inlet from the left; outlet down -> apex up
  // bonnet stem + handwheel up-and-right (opposite the two ports)
  specs.push({ shape: 'line', x1: cx, y1: cy, x2: w * 0.86, y2: h * 0.14, stroke: _ACC, width: _W })
  const hw = w * 0.18
  specs.push({ shape: 'ellipse', x: w * 0.86 - hw * 0.5, y: h * 0.14 - h * 0.05, w: hw, h: h * 0.1, stroke: _OUT, fill: _BODY, width: _D })
  return specs
}

// Bow-tie body with a needle dropping onto the seat + a round adjuster
// knob (a fine/leak metering valve).
export function build_leak_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.62]
  const [bw, bh] = [w * 0.66, h * 0.46]
  const specs = _bowtie(cx, cy, bw, bh)
  // needle: thin triangle, tip exactly on the seat (centre)
  const nlen = cy - h * 0.22
  specs.push({ ..._tri_pointing(cx, cy, nlen, w * 0.1, 'd'), fill: _STEEL, width: _D })
  // adjust stem + round knob
  specs.push({ shape: 'line', x1: cx, y1: cy - nlen, x2: cx, y2: h * 0.14, stroke: _ACC, width: _D })
  const kd = w * 0.18
  specs.push({ shape: 'circle', x: cx - kd * 0.5, y: h * 0.05, w: kd, h: kd, stroke: _OUT, fill: _BODY, width: _D })
  return specs
}

// Circle with a needle line and a short stem (pressure gauge).
export function build_gauge(w: number, h: number): Spec[] {
  const d = Math.min(w, h * 0.74)
  const cx = w * 0.5
  const cy = h * 0.4
  const cir_x = cx - d * 0.5
  const cir_y = cy - d * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: cir_x, y: cir_y, w: d, h: d, stroke: _OUT, fill: _BODY, width: _W }]
  // needle
  specs.push({ shape: 'line', x1: cx, y1: cy, x2: cx + d * 0.32, y2: cy - d * 0.28, stroke: _ACC, width: _W })
  // short stem
  specs.push({ shape: 'line', x1: cx, y1: cir_y + d, x2: cx, y2: h * 0.96, stroke: _ACC, width: _W })
  return specs
}

// Conflat flange in section: two parallel plates with bolt circles.
export function build_flange(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const pw = w * 0.18
  const ph = h * 0.78
  const py = cy - ph * 0.5
  const lx = w * 0.3
  const rx = w * 0.52
  const specs: Spec[] = [
    { shape: 'rect', x: lx, y: py, w: pw, h: ph, stroke: _OUT, fill: _STEEL, width: _W },
    { shape: 'rect', x: rx, y: py, w: pw, h: ph, stroke: _OUT, fill: _STEEL, width: _W },
  ]
  // bolt circles between the plates
  const bd = h * 0.12
  const bx = (lx + pw + rx) * 0.5 - bd * 0.5
  for (const fy of [0.3, 0.7]) {
    specs.push({ shape: 'circle', x: bx, y: h * fy - bd * 0.5, w: bd, h: bd, stroke: _OUT, fill: _NONE, width: _D })
  }
  return specs
}

// Accordion: a row of zigzag lines forming flexible bellows + stubs.
export function build_bellows(w: number, h: number): Spec[] {
  let mx, ex, ey
  const cy = h * 0.5
  const bh = h * 0.46
  const x0 = w * 0.16
  const x1 = w * 0.84
  const n = 6
  const seg = (x1 - x0) / n
  const specs: Spec[] = []
  // end stubs
  specs.push({ shape: 'rect', x: w * 0.04, y: cy - bh * 0.35, w: x0 - w * 0.04, h: bh * 0.7, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'rect', x: x1, y: cy - bh * 0.35, w: w * 0.96 - x1, h: bh * 0.7, stroke: _OUT, fill: _STEEL, width: _D })
  // zigzag bellows
  const top = cy - bh * 0.5
  const bot = cy + bh * 0.5
  let [px, py] = [x0, cy]
  for (let i = 0; i < n; i++) {
    mx = x0 + seg * (i + 0.5)
    ex = x0 + seg * (i + 1)
    ey = pmod(i, 2) === 0 ? top : bot
    specs.push({ shape: 'line', x1: px, y1: py, x2: mx, y2: ey, stroke: _ACC, width: _W })
    specs.push({ shape: 'line', x1: mx, y1: ey, x2: ex, y2: cy, stroke: _ACC, width: _W })
    ;[px, py] = [ex, cy]
  }
  return specs
}

// Flange ring: two concentric circles (window / viewport).
export function build_viewport(w: number, h: number): Spec[] {
  const d = Math.min(w, h) * 0.86
  const [cx, cy] = [w * 0.5, h * 0.5]
  const specs: Spec[] = [{ shape: 'circle', x: cx - d * 0.5, y: cy - d * 0.5, w: d, h: d, stroke: _OUT, fill: _STEEL, width: _W }]
  const di = d * 0.64
  specs.push({ shape: 'circle', x: cx - di * 0.5, y: cy - di * 0.5, w: di, h: di, stroke: _OUT, fill: _BODY, width: _W })
  return specs
}

// Gauges & pressure
// Pirani gauge: circle body with a heated-filament zigzag + stem + tag.
export function build_pirani_gauge(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [bw, bh] = [w * 0.6, w * 0.6]
  const [bx, by] = [cx - bw * 0.5, h * 0.06]
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  const fy = by + bh * 0.5
  const x0 = bx + bw * 0.24
  const seg = bw * 0.52 / 4
  const amp = bh * 0.12
  const pts = [[x0, fy]]
  for (let i = 1; i < 5; i++) {
    pts.push([x0 + seg * i, fy + (pmod(i, 2) ? amp : -amp)])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: _ACC, width: _D })
  }
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  specs.push({ shape: 'text', text: 'Pi', x: cx, y: by + bh * 0.78, size: h * 0.085, color: _ACC, anchor: 'center' })
  return specs
}

// Penning cold-cathode gauge: circle with crossed-field hint + stem.
export function build_penning_gauge(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [bw, bh] = [w * 0.6, w * 0.6]
  const [bx, by] = [cx - bw * 0.5, h * 0.06]
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  const r = bw * 0.22
  specs.push({ shape: 'line', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: bx + bw * 0.18, y1: cy - r * 1.4, x2: bx + bw * 0.82, y2: cy - r * 1.4, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: bx + bw * 0.18, y1: cy + r * 1.4, x2: bx + bw * 0.82, y2: cy + r * 1.4, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  specs.push({ shape: 'text', text: 'Pen', x: cx, y: by + bh * 0.8, size: h * 0.075, color: _ACC, anchor: 'center' })
  return specs
}

// Bayard-Alpert hot-cathode ion gauge: grid arcs + collector + stem.
export function build_ion_gauge(w: number, h: number): Spec[] {
  let gw, gh
  const cx = w * 0.5
  const [bw, bh] = [w * 0.6, w * 0.6]
  const [bx, by] = [cx - bw * 0.5, h * 0.06]
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  for (const [f, rot] of [[0.46, 0], [0.3, 180]]) {
    gw = bw * f
    gh = bh * f
    specs.push({ shape: 'halfcircle', x: cx - gw * 0.5, y: cy - gh * 0.5, w: gw, h: gh, stroke: _ACC, fill: _NONE, width: _D, rotation: rot })
  }
  specs.push({ shape: 'line', x1: cx, y1: cy - bh * 0.3, x2: cx, y2: cy + bh * 0.3, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  specs.push({ shape: 'text', text: 'IG', x: bx + bw * 0.8, y: by + bh * 0.2, size: h * 0.075, color: _ACC, anchor: 'center' })
  return specs
}

// Baratron capacitance manometer: capsule with a diaphragm + stem.
export function build_capacitance_manometer(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [bw, bh] = [w * 0.62, w * 0.62]
  const [bx, by] = [cx - bw * 0.5, h * 0.06]
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  const gap = bh * 0.045
  const x1 = bx + bw * 0.18
  const x2 = bx + bw * 0.82
  specs.push({ shape: 'line', x1: x1, y1: cy - gap, x2: x2, y2: cy - gap, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: x1, y1: cy + gap, x2: x2, y2: cy + gap, stroke: _ACC, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  specs.push({ shape: 'text', text: 'CDG', x: cx, y: by + bh * 0.8, size: h * 0.07, color: _ACC, anchor: 'center' })
  return specs
}

// Bourdon dial gauge: white face, C-shaped tube, needle + short stem.
export function build_bourdon_gauge(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [bw, bh] = [w * 0.62, w * 0.62]
  const [bx, by] = [cx - bw * 0.5, h * 0.06]
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: '#ffffff', width: _W }]
  const [tw, th] = [bw * 0.5, bh * 0.5]
  const [tx, ty] = [cx - tw * 0.5, cy - th * 0.5]
  for (const rot of [0, 90, 270]) {
    specs.push({ shape: 'quartercircle', x: tx, y: ty, w: tw, h: th, stroke: _ACC, fill: _NONE, width: _D, rotation: rot })
  }
  specs.push({ shape: 'line', x1: cx, y1: cy, x2: cx + bw * 0.26, y2: cy - bh * 0.2, stroke: _OUT, width: _W })
  const hd = bw * 0.06
  specs.push({ shape: 'circle', x: cx - hd * 0.5, y: cy - hd * 0.5, w: hd, h: hd, stroke: _OUT, fill: _OUT, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  return specs
}

// U-tube manometer: two vertical tubes + curved bottom + liquid.
export function build_manometer(w: number, h: number): Spec[] {
  const lx = w * 0.34
  const rx = w * 0.66
  const top = h * 0.06
  const bot = h * 0.82
  const specs: Spec[] = [
    { shape: 'line', x1: lx - w * 0.05, y1: top, x2: lx - w * 0.05, y2: bot, stroke: _OUT, width: _W },
    { shape: 'line', x1: lx + w * 0.05, y1: top, x2: lx + w * 0.05, y2: bot, stroke: _OUT, width: _W },
    { shape: 'line', x1: rx - w * 0.05, y1: top, x2: rx - w * 0.05, y2: bot, stroke: _OUT, width: _W },
    { shape: 'line', x1: rx + w * 0.05, y1: top, x2: rx + w * 0.05, y2: bot, stroke: _OUT, width: _W },
  ]
  const arc_w = rx + w * 0.05 - (lx - w * 0.05)
  const arc_h = h * 0.18
  specs.push({ shape: 'halfcircle', x: lx - w * 0.05, y: bot - arc_h * 0.5, w: arc_w, h: arc_h, stroke: _OUT, fill: _NONE, width: _W, rotation: 180 })
  const l_top = h * 0.3
  const r_top = h * 0.52
  specs.push({ shape: 'rect', x: lx - w * 0.05, y: l_top, w: w * 0.1, h: bot - l_top, stroke: _NONE, fill: _STEEL, width: _D })
  specs.push({ shape: 'rect', x: rx - w * 0.05, y: r_top, w: w * 0.1, h: bot - r_top, stroke: _NONE, fill: _STEEL, width: _D })
  return specs
}

// ISA transmitter: circle 'PT' with a ticked signal line + stem.
export function build_pressure_transducer(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [bw, bh] = [w * 0.6, w * 0.6]
  const [bx, by] = [cx - bw * 0.5, h * 0.16]
  const specs: Spec[] = [
    { shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'text', text: 'PT', x: cx, y: by + bh * 0.5, size: h * 0.09, color: _ACC, anchor: 'center' },
  ]
  const sig_top = h * 0.02
  specs.push({ shape: 'line', x1: cx, y1: by, x2: cx, y2: sig_top, stroke: _ACC, width: _D })
  for (const ty of [by * 0.55, by * 0.4]) {
    specs.push({ shape: 'line', x1: cx - w * 0.06, y1: ty + h * 0.02, x2: cx + w * 0.06, y2: ty - h * 0.02, stroke: _ACC, width: _D })
  }
  specs.push({ shape: 'line', x1: cx, y1: by + bh, x2: cx, y2: h * 0.98, stroke: _OUT, width: _W })
  return specs
}

// More pumps
// Diaphragm pump: box body, curved diaphragm + two check-valve tris.
export function build_diaphragm_pump(w: number, h: number): Spec[] {
  const [bw, bh] = [w * 0.7, h * 0.56]
  const [bx, by] = [(w - bw) * 0.5, h * 0.1]
  const cx = w * 0.5
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'rect', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _BODY, width: _W }]
  const dw = bw * 0.74
  const dh = bh * 0.34
  specs.push({ shape: 'halfcircle', x: cx - dw * 0.5, y: cy - dh * 0.5, w: dw, h: dh, stroke: _ACC, fill: _NONE, width: _D, rotation: 0 })
  const [tw, th] = [bw * 0.16, bh * 0.22]
  specs.push({ shape: 'triangle', x: bx + bw * 0.16, y: by + bh * 0.18, w: tw, h: th, stroke: _OUT, fill: _STEEL, width: _D, rotation: 0 })
  specs.push({ shape: 'triangle', x: bx + bw * 0.68, y: by + bh * 0.18, w: tw, h: th, stroke: _OUT, fill: _STEEL, width: _D, rotation: 0 })
  const [fw, fh] = [w * 0.16, h * 0.1]
  specs.push({ shape: 'rect', x: cx - fw * 0.5, y: by + bh, w: fw, h: fh, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh + fh, x2: cx, y2: h * 0.99, stroke: _OUT, width: _W })
  return specs
}

// Roots blower: rounded casing with two interlocking figure-8 lobes.
export function build_roots_pump(w: number, h: number): Spec[] {
  const [bw, bh] = [w * 0.74, h * 0.5]
  const [bx, by] = [(w - bw) * 0.5, h * 0.1]
  const cx = w * 0.5
  const cy = by + bh * 0.5
  const specs: Spec[] = [{ shape: 'rounded_rect', x: bx, y: by, w: bw, h: bh, radius: bh * 0.3, stroke: _OUT, fill: _BODY, width: _W }]
  const lobe_d = bh * 0.4
  const off = lobe_d * 0.4
  const lcx = cx - bw * 0.18
  specs.push({ shape: 'circle', x: lcx - lobe_d * 0.5, y: cy - off - lobe_d * 0.5, w: lobe_d, h: lobe_d, stroke: _ACC, fill: _NONE, width: _D })
  specs.push({ shape: 'circle', x: lcx - lobe_d * 0.5, y: cy + off - lobe_d * 0.5, w: lobe_d, h: lobe_d, stroke: _ACC, fill: _NONE, width: _D })
  const rcx = cx + bw * 0.18
  specs.push({ shape: 'circle', x: rcx - off - lobe_d * 0.5, y: cy - lobe_d * 0.5, w: lobe_d, h: lobe_d, stroke: _ACC, fill: _NONE, width: _D })
  specs.push({ shape: 'circle', x: rcx + off - lobe_d * 0.5, y: cy - lobe_d * 0.5, w: lobe_d, h: lobe_d, stroke: _ACC, fill: _NONE, width: _D })
  const [fw, fh] = [w * 0.16, h * 0.1]
  specs.push({ shape: 'rect', x: cx - fw * 0.5, y: by + bh, w: fw, h: fh, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh + fh, x2: cx, y2: h * 0.99, stroke: _OUT, width: _W })
  return specs
}

// NEG getter pump: steel-filled circle with diagonal hatch + stub.
export function build_getter_pump(w: number, h: number): Spec[] {
  let f
  const cx = w * 0.5
  const [bw, bh] = [w * 0.62, w * 0.62]
  const [bx, by] = [cx - bw * 0.5, h * 0.1]
  const specs: Spec[] = [{ shape: 'circle', x: bx, y: by, w: bw, h: bh, stroke: _OUT, fill: _STEEL, width: _W }]
  const n = 5
  for (let i = 1; i < n; i++) {
    f = i / n
    specs.push({ shape: 'line', x1: bx + bw * f, y1: by + bh * 0.1, x2: bx + bw * 0.1, y2: by + bh * f, stroke: _ACC, width: _D })
    specs.push({ shape: 'line', x1: bx + bw, y1: by + bh * f, x2: bx + bw * f, y2: by + bh, stroke: _ACC, width: _D })
  }
  specs.push({ shape: 'text', text: 'NEG', x: cx, y: by + bh * 0.5, size: h * 0.075, color: _OUT, anchor: 'center' })
  const [fw, fh] = [w * 0.16, h * 0.1]
  specs.push({ shape: 'rect', x: cx - fw * 0.5, y: by + bh, w: fw, h: fh, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh + fh, x2: cx, y2: h * 0.99, stroke: _OUT, width: _W })
  return specs
}

// Titanium sublimation pump: chamber with a filament coil + stub.
export function build_sublimation_pump(w: number, h: number): Spec[] {
  const [bw, bh] = [w * 0.66, h * 0.52]
  const [bx, by] = [(w - bw) * 0.5, h * 0.1]
  const cx = w * 0.5
  const cy = by + bh * 0.45
  const specs: Spec[] = [{ shape: 'rounded_rect', x: bx, y: by, w: bw, h: bh, radius: bh * 0.14, stroke: _OUT, fill: _BODY, width: _W }]
  const x0 = bx + bw * 0.18
  const seg = bw * 0.64 / 5
  const amp = bh * 0.16
  const pts = [[x0, cy]]
  for (let i = 1; i < 6; i++) {
    pts.push([x0 + seg * i, cy + (pmod(i, 2) ? amp : -amp)])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({ shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], stroke: _ACC, width: _D })
  }
  specs.push({ shape: 'text', text: 'TSP', x: cx, y: by + bh * 0.82, size: h * 0.07, color: _ACC, anchor: 'center' })
  const [fw, fh] = [w * 0.16, h * 0.1]
  specs.push({ shape: 'rect', x: cx - fw * 0.5, y: by + bh, w: fw, h: fh, stroke: _OUT, fill: _STEEL, width: _D })
  specs.push({ shape: 'line', x1: cx, y1: by + bh + fh, x2: cx, y2: h * 0.99, stroke: _OUT, width: _W })
  return specs
}

// More valves
export function build_butterfly_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.55]
  const r = w * 0.34
  return [
    { shape: 'circle', x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'line', x1: cx - r * 0.72, y1: cy + r * 0.72, x2: cx + r * 0.72, y2: cy - r * 0.72, stroke: _OUT, width: _W },
    { shape: 'line', x1: cx, y1: cy - r, x2: cx, y2: h * 0.08, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx - w * 0.12, y1: h * 0.08, x2: cx + w * 0.12, y2: h * 0.08, stroke: _OUT, width: _W },
  ]
}

export function build_ball_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.55]
  const [bw, bh] = [w * 0.72, h * 0.42]
  let parts = _bowtie(cx, cy, bw, bh)
  const r = bh * 0.34
  parts.push({ shape: 'circle', x: cx - r, y: cy - r, w: r * 2, h: r * 2, stroke: _OUT, fill: _STEEL, width: _W }, { shape: 'line', x1: cx, y1: cy - r, x2: cx, y2: h * 0.16, stroke: _OUT, width: _D }, { shape: 'line', x1: cx, y1: h * 0.16, x2: cx + w * 0.3, y2: h * 0.16, stroke: _OUT, width: _W })
  return parts
}

// Bow-tie body with a long thin needle seating at the centre + a
// handwheel (precise metering valve).
export function build_needle_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.62]
  const [bw, bh] = [w * 0.72, h * 0.42]
  const parts = _bowtie(cx, cy, bw, bh)
  // long thin needle, tip exactly on the seat
  const nlen = cy - h * 0.2
  parts.push({ ..._tri_pointing(cx, cy, nlen, w * 0.07, 'd'), fill: _STEEL, width: _D })
  // stem + handwheel (wide flat ellipse)
  parts.push({ shape: 'line', x1: cx, y1: cy - nlen, x2: cx, y2: h * 0.16, stroke: _OUT, width: _D })
  const hw = w * 0.4
  parts.push({ shape: 'ellipse', x: cx - hw * 0.5, y: h * 0.09, w: hw, h: h * 0.1, stroke: _OUT, fill: _BODY, width: _W })
  return parts
}

export function build_solenoid_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.55]
  const [bw, bh] = [w * 0.72, h * 0.42]
  let parts = _bowtie(cx, cy, bw, bh)
  parts.push({ shape: 'line', x1: cx, y1: cy - bh * 0.5, x2: cx, y2: h * 0.28, stroke: _OUT, width: _D })
  const [boxw, boxh] = [w * 0.38, h * 0.2]
  const [bx, by] = [cx - boxw * 0.5, h * 0.08]
  parts.push({ shape: 'rect', x: bx, y: by, w: boxw, h: boxh, stroke: _OUT, fill: _BODY, width: _W }, { shape: 'line', x1: bx, y1: by + boxh, x2: bx + boxw, y2: by, stroke: _OUT, width: _D })
  return parts
}

export function build_manual_valve(w: number, h: number): Spec[] {
  const [cx, cy] = [w * 0.5, h * 0.55]
  const [bw, bh] = [w * 0.72, h * 0.42]
  const parts = _bowtie(cx, cy, bw, bh)
  parts.push({ shape: 'line', x1: cx, y1: cy - bh * 0.5, x2: cx, y2: h * 0.22, stroke: _OUT, width: _D })
  const [hw, hh] = [w * 0.42, h * 0.12]
  parts.push({ shape: 'ellipse', x: cx - hw * 0.5, y: h * 0.16, w: hw, h: hh, stroke: _OUT, fill: _BODY, width: _W })
  return parts
}

export function build_relief_valve(w: number, h: number): Spec[] {
  const [inx, iny] = [w * 0.08, h * 0.7]
  const cx = w * 0.42
  const parts: Spec[] = [
    { shape: 'line', x1: inx, y1: iny, x2: cx, y2: iny, stroke: _OUT, width: _W },
    { shape: 'line', x1: inx, y1: iny - h * 0.07, x2: inx, y2: iny + h * 0.07, stroke: _OUT, width: _W },
    { shape: 'triangle', x: cx - w * 0.16, y: iny - h * 0.18, w: w * 0.32, h: h * 0.18, rotation: 0, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'triangle', x: cx - w * 0.16, y: iny - h * 0.36, w: w * 0.32, h: h * 0.18, rotation: 180, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'line', x1: cx, y1: iny - h * 0.36, x2: cx, y2: h * 0.34, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx, y1: h * 0.34, x2: cx + w * 0.1, y2: h * 0.3, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx + w * 0.1, y1: h * 0.3, x2: cx - w * 0.1, y2: h * 0.25, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx - w * 0.1, y1: h * 0.25, x2: cx + w * 0.1, y2: h * 0.2, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx + w * 0.1, y1: h * 0.2, x2: cx, y2: h * 0.16, stroke: _OUT, width: _D },
    { shape: 'rect', x: cx - w * 0.1, y: h * 0.08, w: w * 0.2, h: h * 0.08, stroke: _OUT, fill: _STEEL, width: _W },
  ]
  return parts
}

// Lines & fittings
export function build_pipe(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const ph = h * 0.32
  return [
    { shape: 'rect', x: w * 0.06, y: cy - ph * 0.5, w: w * 0.88, h: ph, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'line', x1: w * 0.06, y1: cy - ph * 0.9, x2: w * 0.06, y2: cy + ph * 0.9, stroke: _OUT, width: _W },
    { shape: 'line', x1: w * 0.94, y1: cy - ph * 0.9, x2: w * 0.94, y2: cy + ph * 0.9, stroke: _OUT, width: _W },
  ]
}

export function build_tee(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const cy = h * 0.62
  const ph = h * 0.26
  return [
    { shape: 'rect', x: w * 0.06, y: cy - ph * 0.5, w: w * 0.88, h: ph, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'rect', x: cx - ph * 0.5, y: h * 0.1, w: ph, h: cy - ph * 0.5 - h * 0.1, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'line', x1: w * 0.06, y1: cy - ph * 0.85, x2: w * 0.06, y2: cy + ph * 0.85, stroke: _OUT, width: _W },
    { shape: 'line', x1: w * 0.94, y1: cy - ph * 0.85, x2: w * 0.94, y2: cy + ph * 0.85, stroke: _OUT, width: _W },
    { shape: 'line', x1: cx - ph * 0.85, y1: h * 0.1, x2: cx + ph * 0.85, y2: h * 0.1, stroke: _OUT, width: _W },
  ]
}

// 90° pipe elbow: a horizontal run meeting a vertical run at the corner.
export function build_elbow(w: number, h: number): Spec[] {
  const t = h * 0.26  // pipe width
  const x0 = w * 0.1  // left open end
  const yb = h * 0.74  // horizontal centreline (low)
  const cxv = w * 0.7  // vertical run centreline
  const yt = h * 0.12  // top open end
  return [
    // horizontal run (left -> corner, includes the corner square)
    { shape: 'rect', x: x0, y: yb - t * 0.5, w: cxv + t * 0.5 - x0, h: t, stroke: _OUT, fill: _BODY, width: _W },
    // vertical run (corner -> top), butt-joined onto the horizontal top
    { shape: 'rect', x: cxv - t * 0.5, y: yt, w: t, h: yb - t * 0.5 - yt, stroke: _OUT, fill: _BODY, width: _W },
    // flange tick at the left open end
    { shape: 'line', x1: x0, y1: yb - t * 0.85, x2: x0, y2: yb + t * 0.85, stroke: _OUT, width: _W },
    // flange tick at the top open end
    { shape: 'line', x1: cxv - t * 0.85, y1: yt, x2: cxv + t * 0.85, y2: yt, stroke: _OUT, width: _W },
  ]
}

// Concentric reducer: a wide pipe (left) tapering to a narrow pipe
// (right) through a cone.
export function build_reducer(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const bigh = h * 0.52  // wide-end height
  const smallh = bigh * 0.5  // narrow-end height (trapezoid narrow = 0.5*wide)
  const [x0, x1] = [w * 0.3, w * 0.7]  // cone span
  const cone_len = x1 - x0
  return [
    // wide pipe stub (left)
    { shape: 'rect', x: w * 0.06, y: cy - bigh * 0.5, w: x0 - w * 0.06, h: bigh, stroke: _OUT, fill: _BODY, width: _W },
    // narrow pipe stub (right)
    { shape: 'rect', x: x1, y: cy - smallh * 0.5, w: w * 0.94 - x1, h: smallh, stroke: _OUT, fill: _BODY, width: _W },
    // cone: trapezoid rotated 90 with a box sized so the footprint is
    // cone_len wide x bigh tall (wide-left, narrow-right)
    { shape: 'trapezoid', x: (x0 + x1) * 0.5 - bigh * 0.5, y: cy - cone_len * 0.5, w: bigh, h: cone_len, rotation: 90, stroke: _OUT, fill: _STEEL, width: _W },
    // end flange ticks
    { shape: 'line', x1: w * 0.06, y1: cy - bigh * 0.7, x2: w * 0.06, y2: cy + bigh * 0.7, stroke: _OUT, width: _W },
    { shape: 'line', x1: w * 0.94, y1: cy - smallh * 0.7, x2: w * 0.94, y2: cy + smallh * 0.7, stroke: _OUT, width: _W },
  ]
}

export function build_blank_flange(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const ph = h * 0.3
  const capx = w * 0.66
  const capw = w * 0.16
  const caph = h * 0.62
  return [
    { shape: 'rect', x: w * 0.08, y: cy - ph * 0.5, w: capx - w * 0.08, h: ph, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'rect', x: capx, y: cy - caph * 0.5, w: capw, h: caph, stroke: _OUT, fill: _STEEL, width: _W },
    { shape: 'circle', x: capx + capw * 0.3, y: cy - caph * 0.32, w: w * 0.045, h: w * 0.045, stroke: _OUT, fill: _OUT, width: _D },
    { shape: 'circle', x: capx + capw * 0.3, y: cy + caph * 0.26, w: w * 0.045, h: w * 0.045, stroke: _OUT, fill: _OUT, width: _D },
    { shape: 'line', x1: w * 0.08, y1: cy - ph * 0.85, x2: w * 0.08, y2: cy + ph * 0.85, stroke: _OUT, width: _W },
  ]
}

export function build_cold_trap(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const [vw, vh] = [w * 0.46, h * 0.62]
  const [vx, vy] = [cx - vw * 0.5, h * 0.2]
  return [
    { shape: 'rounded_rect', x: vx, y: vy, w: vw, h: vh, radius: w * 0.1, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'line', x1: cx - vw * 0.2, y1: vy, x2: cx - vw * 0.2, y2: h * 0.06, stroke: _OUT, width: _W },
    { shape: 'line', x1: cx + vw * 0.2, y1: vy, x2: cx + vw * 0.2, y2: h * 0.06, stroke: _OUT, width: _W },
    { shape: 'line', x1: vx + vw * 0.18, y1: vy + vh * 0.4, x2: vx + vw * 0.82, y2: vy + vh * 0.4, stroke: _ACC, width: _D },
    { shape: 'line', x1: vx + vw * 0.18, y1: vy + vh * 0.6, x2: vx + vw * 0.82, y2: vy + vh * 0.6, stroke: _ACC, width: _D },
    { shape: 'line', x1: vx + vw * 0.18, y1: vy + vh * 0.8, x2: vx + vw * 0.82, y2: vy + vh * 0.8, stroke: _ACC, width: _D },
    { shape: 'text', text: 'LN2', x: cx, y: vy + vh * 0.18, size: h * 0.07, color: _OUT, anchor: 'center' },
  ]
}

export function build_mass_flow_controller(w: number, h: number): Spec[] {
  const cy = h * 0.5
  const ph = h * 0.2
  const [boxw, boxh] = [w * 0.5, h * 0.5]
  const [bx, by] = [w * 0.5 - boxw * 0.5, cy - boxh * 0.5]
  let parts: Spec[] = [
    { shape: 'line', x1: w * 0.04, y1: cy, x2: bx, y2: cy, stroke: _OUT, width: _W },
    { shape: 'line', x1: bx + boxw, y1: cy, x2: w * 0.96, y2: cy, stroke: _OUT, width: _W },
    { shape: 'rect', x: bx, y: by, w: boxw, h: boxh, stroke: _OUT, fill: _BODY, width: _W },
  ]
  parts.push(..._bowtie(w * 0.5, by + boxh * 0.62, boxw * 0.4, boxh * 0.3))
  parts.push({ shape: 'line', x1: w * 0.5, y1: by + boxh * 0.47, x2: w * 0.5, y2: by + boxh * 0.2, stroke: _OUT, width: _D }, { shape: 'text', text: 'MFC', x: bx + boxw * 0.5, y: by + boxh * 0.12, size: h * 0.13, color: _OUT, anchor: 'center' }, { shape: 'line', x1: w * 0.04, y1: cy - ph * 0.7, x2: w * 0.04, y2: cy + ph * 0.7, stroke: _OUT, width: _W }, { shape: 'line', x1: w * 0.96, y1: cy - ph * 0.7, x2: w * 0.96, y2: cy + ph * 0.7, stroke: _OUT, width: _W })
  return parts
}

export function build_regulator(w: number, h: number): Spec[] {
  const cx = w * 0.42
  const [bodyw, bodyh] = [w * 0.4, h * 0.34]
  const by = h * 0.42
  const domew = bodyw * 1.05
  return [
    { shape: 'rect', x: cx - bodyw * 0.5, y: by, w: bodyw, h: bodyh, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'halfcircle', x: cx - domew * 0.5, y: by - domew * 0.5, w: domew, h: domew, stroke: _OUT, fill: _STEEL, width: _W, rotation: 0 },
    { shape: 'line', x1: cx, y1: by - domew * 0.5, x2: cx, y2: h * 0.08, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx - w * 0.08, y1: h * 0.08, x2: cx + w * 0.08, y2: h * 0.08, stroke: _OUT, width: _W },
    { shape: 'line', x1: w * 0.04, y1: by + bodyh * 0.5, x2: cx - bodyw * 0.5, y2: by + bodyh * 0.5, stroke: _OUT, width: _W },
    { shape: 'line', x1: cx + bodyw * 0.5, y1: by + bodyh * 0.5, x2: w * 0.7, y2: by + bodyh * 0.5, stroke: _OUT, width: _W },
    { shape: 'circle', x: w * 0.72, y: by - h * 0.02, w: w * 0.2, h: w * 0.2, stroke: _OUT, fill: '#ffffff', width: _W },
    { shape: 'line', x1: w * 0.82, y1: by + h * 0.08, x2: w * 0.87, y2: by + h * 0.03, stroke: _OUT, width: _D },
  ]
}

export function build_gas_cylinder(w: number, h: number): Spec[] {
  const cx = w * 0.5
  const bw = w * 0.62
  const bx = cx - bw * 0.5
  const by = h * 0.16
  const bh = h * 0.74
  return [
    { shape: 'rounded_rect', x: bx, y: by, w: bw, h: bh, radius: bw * 0.45, stroke: _OUT, fill: _BODY, width: _W },
    { shape: 'rect', x: cx - bw * 0.16, y: h * 0.06, w: bw * 0.32, h: h * 0.1, stroke: _OUT, fill: _STEEL, width: _W },
    { shape: 'line', x1: cx, y1: h * 0.06, x2: cx, y2: h * 0.02, stroke: _OUT, width: _D },
    { shape: 'line', x1: cx + bw * 0.16, y1: h * 0.1, x2: cx + bw * 0.34, y2: h * 0.1, stroke: _OUT, width: _W },
  ]
}

// Sizes / labels / categories
export const REFERENCE_MM = 2000
export const SIZES: Record<string, [number, number]> = { chamber: [450, 450], analyser: [440, 500], xray_source: [320, 220], ion_gun: [300, 160], electron_gun: [300, 160], manipulator: [220, 460], turbo_pump: [250, 280], ion_pump: [260, 240], scroll_pump: [250, 250], rotary_pump: [260, 270], cryo_pump: [250, 280], gate_valve: [160, 180], angle_valve: [160, 170], leak_valve: [160, 180], gauge: [140, 170], flange: [140, 160], bellows: [220, 140], viewport: [150, 150], pirani_gauge: [150, 170], penning_gauge: [150, 170], ion_gauge: [150, 170], capacitance_manometer: [150, 170], bourdon_gauge: [150, 170], manometer: [160, 260], pressure_transducer: [150, 170], diaphragm_pump: [250, 280], roots_pump: [250, 280], getter_pump: [250, 280], sublimation_pump: [250, 280], butterfly_valve: [180, 190], ball_valve: [190, 190], needle_valve: [180, 200], solenoid_valve: [190, 200], manual_valve: [190, 190], relief_valve: [190, 200], pipe: [240, 80], tee: [200, 180], elbow: [180, 180], reducer: [220, 120], blank_flange: [200, 140], cold_trap: [200, 300], mass_flow_controller: [240, 160], regulator: [240, 220], gas_cylinder: [180, 420] }
// gauges & pressure
// more pumps
// more valves
// lines & fittings
export const LABELS: Record<string, string> = { chamber: 'UHV chamber', analyser: 'Hemispherical analyser', xray_source: 'X-ray source', ion_gun: 'Ion gun', electron_gun: 'Electron gun', manipulator: 'Manipulator', turbo_pump: 'Turbo pump', ion_pump: 'Ion pump', scroll_pump: 'Scroll pump', rotary_pump: 'Rotary pump', cryo_pump: 'Cryo pump', gate_valve: 'Gate valve', angle_valve: 'Angle valve', leak_valve: 'Leak valve', gauge: 'Pressure gauge', flange: 'Flange (CF)', bellows: 'Bellows', viewport: 'Viewport', pirani_gauge: 'Pirani gauge', penning_gauge: 'Penning gauge', ion_gauge: 'Ion gauge (Bayard-Alpert)', capacitance_manometer: 'Capacitance manometer (Baratron)', bourdon_gauge: 'Bourdon gauge', manometer: 'U-tube manometer', pressure_transducer: 'Pressure transducer', diaphragm_pump: 'Diaphragm pump', roots_pump: 'Roots pump (blower)', getter_pump: 'Getter pump (NEG)', sublimation_pump: 'Titanium sublimation pump', butterfly_valve: 'Butterfly valve', ball_valve: 'Ball valve', needle_valve: 'Needle valve', solenoid_valve: 'Solenoid valve', manual_valve: 'Manual valve', relief_valve: 'Relief valve', pipe: 'Pipe', tee: 'Tee junction', elbow: 'Elbow (90°)', reducer: 'Reducer', blank_flange: 'Blank flange', cold_trap: 'Cold trap (LN2)', mass_flow_controller: 'Mass flow controller', regulator: 'Pressure regulator', gas_cylinder: 'Gas cylinder' }
export const CATEGORIES: [string, string[]][] = [['Chamber & sources', ['chamber', 'analyser', 'xray_source', 'ion_gun', 'electron_gun', 'manipulator']], ['Pumps', ['turbo_pump', 'ion_pump', 'scroll_pump', 'rotary_pump', 'cryo_pump', 'diaphragm_pump', 'roots_pump', 'getter_pump', 'sublimation_pump']], ['Gauges & pressure', ['bourdon_gauge', 'pirani_gauge', 'penning_gauge', 'ion_gauge', 'capacitance_manometer', 'manometer', 'pressure_transducer', 'gauge']], ['Valves', ['gate_valve', 'angle_valve', 'leak_valve', 'butterfly_valve', 'ball_valve', 'needle_valve', 'solenoid_valve', 'manual_valve', 'relief_valve']], ['Lines & fittings', ['pipe', 'tee', 'elbow', 'reducer', 'flange', 'blank_flange', 'bellows', 'viewport', 'cold_trap', 'mass_flow_controller', 'regulator', 'gas_cylinder']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  chamber: build_chamber,
  analyser: build_analyser,
  xray_source: build_xray_source,
  ion_gun: build_ion_gun,
  electron_gun: build_electron_gun,
  manipulator: build_manipulator,
  turbo_pump: build_turbo_pump,
  ion_pump: build_ion_pump,
  scroll_pump: build_scroll_pump,
  rotary_pump: build_rotary_pump,
  cryo_pump: build_cryo_pump,
  gate_valve: build_gate_valve,
  angle_valve: build_angle_valve,
  leak_valve: build_leak_valve,
  gauge: build_gauge,
  flange: build_flange,
  bellows: build_bellows,
  viewport: build_viewport,
  pirani_gauge: build_pirani_gauge,
  penning_gauge: build_penning_gauge,
  ion_gauge: build_ion_gauge,
  capacitance_manometer: build_capacitance_manometer,
  bourdon_gauge: build_bourdon_gauge,
  manometer: build_manometer,
  pressure_transducer: build_pressure_transducer,
  diaphragm_pump: build_diaphragm_pump,
  roots_pump: build_roots_pump,
  getter_pump: build_getter_pump,
  sublimation_pump: build_sublimation_pump,
  butterfly_valve: build_butterfly_valve,
  ball_valve: build_ball_valve,
  needle_valve: build_needle_valve,
  solenoid_valve: build_solenoid_valve,
  manual_valve: build_manual_valve,
  relief_valve: build_relief_valve,
  pipe: build_pipe,
  tee: build_tee,
  elbow: build_elbow,
  reducer: build_reducer,
  blank_flange: build_blank_flange,
  cold_trap: build_cold_trap,
  mass_flow_controller: build_mass_flow_controller,
  regulator: build_regulator,
  gas_cylinder: build_gas_cylinder,
}
