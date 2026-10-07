// Schematic lab glassware / apparatus symbols (front-elevation diagrams).
// Ported from the desktop KhervePaint (labware.py).

import type { Spec } from '../spec'

// Palette
export const OUTLINE = '#333333'
export const GLASS = '#eef4f8'
export const LIQUID = '#cfe3f2'
export const FLAME = '#f0a500'
export const METAL = '#cfd6de'
export const NONE = 'none'
export const W_OUT = 2  // outline width
export const W_DET = 1.2  // detail width
export const REFERENCE_MM = 1000
// Small helpers
function _line(x1: number, y1: number, x2: number, y2: number, stroke = OUTLINE, width = W_DET): Spec {
  return { shape: 'line', x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, width: width }
}

function _rect(x: number, y: number, w: number, h: number, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: 'rect', x: x, y: y, w: w, h: h, stroke: stroke, fill: fill, width: width }
}

function _rrect(x: number, y: number, w: number, h: number, radius: number, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: 'rounded_rect', x: x, y: y, w: w, h: h, radius: radius, stroke: stroke, fill: fill, width: width }
}

function _circle(x: number, y: number, w: number, h: number, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: 'circle', x: x, y: y, w: w, h: h, stroke: stroke, fill: fill, width: width }
}

function _ellipse(x: number, y: number, w: number, h: number, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: 'ellipse', x: x, y: y, w: w, h: h, stroke: stroke, fill: fill, width: width }
}

function _half(x: number, y: number, w: number, h: number, rotation = 0, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: 'halfcircle', x: x, y: y, w: w, h: h, rotation: rotation, stroke: stroke, fill: fill, width: width }
}

function _poly(shape: string, x: number, y: number, w: number, h: number, rotation = 0, stroke = OUTLINE, fill = GLASS, width = W_OUT): Spec {
  return { shape: shape, x: x, y: y, w: w, h: h, rotation: rotation, stroke: stroke, fill: fill, width: width }
}

// Liquid segment filling the lower *frac* of a round bulb.
//
// The bulb is the circle of diameter *d* whose top is at *top* (centre
// at ``top + d/2``). The liquid is a squashed half-circle whose flat
// side sits on the surface chord and whose curve tucks *inside* the
// bulb outline (so it never spills past the glass). Returns
// ``(fill_spec, surface_line)``.
function _bulb_liquid(cx: number, top: number, d: number, frac = 0.55, fill = LIQUID): [Spec, Spec] {
  const r = d / 2
  const cyc = top + r  // circle centre y
  const surf = top + d * (1 - frac)  // liquid surface height
  const dy = surf - cyc
  const half = Math.sqrt(Math.max(r * r - dy * dy, 0))  // chord half-width
  // dome bulging DOWN (flat side on the surface): rotate the half-disc
  const fill_spec = _half(cx - half, surf, 2 * half, top + d - surf, 180, NONE, fill, W_DET)
  const line = _line(cx - half, surf, cx + half, surf, OUTLINE, W_DET)
  return [fill_spec, line]
}

// Glassware
// Straight-walled cup: flared lip + pour spout, graduation ticks on
// the right, liquid filling the lower ~55%.
export function build_beaker(w: number, h: number): Spec[] {
  let yy
  const specs: Spec[] = []
  const [left, right] = [0.24 * w, 0.76 * w]  // vertical walls
  const [top, bot] = [0.16 * h, 0.9 * h]
  const body_h = bot - top
  // glass body + liquid
  specs.push(_rect(left, top, right - left, body_h, NONE, GLASS, W_DET))
  const liq_top = top + body_h * 0.45  // liquid surface (lower 55%)
  specs.push(_rect(left, liq_top, right - left, bot - liq_top, NONE, LIQUID, W_DET))
  specs.push(_line(left, liq_top, right, liq_top, OUTLINE, W_DET))
  // body outline: walls + flat bottom (open top)
  specs.push(_line(left, top, left, bot, OUTLINE, W_OUT))
  specs.push(_line(right, top, right, bot, OUTLINE, W_OUT))
  specs.push(_line(left, bot, right, bot, OUTLINE, W_OUT))
  // flared lip: a short bar slightly wider than the walls
  const [lipL, lipR] = [left - 0.05 * w, right + 0.05 * w]
  specs.push(_line(lipL, top, right, top, OUTLINE, W_OUT))
  specs.push(_line(lipL, top, left, top + 0.03 * h, OUTLINE, W_OUT))
  specs.push(_line(right, top, lipR, top + 0.02 * h, OUTLINE, W_OUT))
  specs.push(_line(lipR, top + 0.02 * h, right, top + 0.05 * h, OUTLINE, W_OUT))
  // pour spout beak on the left of the lip
  specs.push(_line(lipL, top, lipL - 0.05 * w, top - 0.03 * h, OUTLINE, W_OUT))
  specs.push(_line(lipL - 0.05 * w, top - 0.03 * h, left, top + 0.03 * h, OUTLINE, W_OUT))
  // graduation ticks (right, upper portion)
  for (const fr of [0.2, 0.32, 0.44]) {
    yy = top + body_h * fr
    specs.push(_line(right - 0.12 * w, yy, right, yy, OUTLINE, W_DET))
  }
  return specs
}

// Conical flask: trapezoid cone + short neck, liquid in cone.
export function build_erlenmeyer(w: number, h: number): Spec[] {
  let yy, xr
  const specs: Spec[] = []
  const neck_top = 0.1 * h
  const neck_bot = 0.3 * h
  const cone_bot = 0.94 * h
  const [nl, nr] = [0.42 * w, 0.58 * w]
  const [bl, br] = [0.16 * w, 0.84 * w]
  // liquid in lower cone
  const liq_top = neck_bot + (cone_bot - neck_bot) * 0.45
  const f = (liq_top - neck_bot) / (cone_bot - neck_bot)
  const ll = nl + (bl - nl) * f
  const rl = nr + (br - nr) * f
  specs.push({ shape: 'trapezoid', x: bl, y: liq_top, w: br - bl, h: cone_bot - liq_top, rotation: 0, stroke: NONE, fill: LIQUID, width: W_DET })
  // neck
  specs.push(_rect(nl, neck_top, nr - nl, neck_bot - neck_top, OUTLINE, GLASS, W_OUT))
  // cone walls
  specs.push(_line(nl, neck_bot, bl, cone_bot, OUTLINE, W_OUT))
  specs.push(_line(nr, neck_bot, br, cone_bot, OUTLINE, W_OUT))
  specs.push(_line(bl, cone_bot, br, cone_bot, OUTLINE, W_OUT))
  // liquid surface
  specs.push(_line(ll, liq_top, rl, liq_top, OUTLINE, W_DET))
  // flared rim on the neck
  specs.push(_line(nl - 0.04 * w, neck_top, nr + 0.04 * w, neck_top, OUTLINE, W_OUT))
  specs.push(_line(nl - 0.04 * w, neck_top, nl, neck_top + 0.03 * h, OUTLINE, W_OUT))
  specs.push(_line(nr + 0.04 * w, neck_top, nr, neck_top + 0.03 * h, OUTLINE, W_OUT))
  // graduation ticks on the right of the cone
  for (const fr of [0.55, 0.7]) {
    yy = neck_bot + (cone_bot - neck_bot) * fr
    xr = nr + (br - nr) * fr
    specs.push(_line(xr - 0.11 * w, yy, xr - 0.02 * w, yy, OUTLINE, W_DET))
  }
  return specs
}

// Round bottom (circle) with tall thin neck rect.
export function build_round_bottom_flask(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const d = 0.56 * w
  const cx = 0.5 * w
  const bulb_y = 0.94 * h - d
  const neck_w = 0.18 * w
  const neck_top = 0.08 * h
  const neck_bot = bulb_y + 0.16 * d
  // neck (behind the bulb) + glass bulb
  specs.push(_rect(cx - neck_w / 2, neck_top, neck_w, neck_bot - neck_top, OUTLINE, GLASS, W_OUT))
  specs.push(_circle(cx - d / 2, bulb_y, d, d, OUTLINE, GLASS, W_OUT))
  // liquid contained inside the bulb
  const [fill, surf] = _bulb_liquid(cx, bulb_y, d, 0.52)
  specs.push(fill)
  specs.push(surf)
  // flared rim
  specs.push(_line(cx - neck_w / 2 - 0.04 * w, neck_top, cx + neck_w / 2 + 0.04 * w, neck_top, OUTLINE, W_OUT))
  specs.push(_line(cx - neck_w / 2 - 0.04 * w, neck_top, cx - neck_w / 2, neck_top + 0.03 * h, OUTLINE, W_OUT))
  specs.push(_line(cx + neck_w / 2 + 0.04 * w, neck_top, cx + neck_w / 2, neck_top + 0.03 * h, OUTLINE, W_OUT))
  return specs
}

// Small bulb + very long thin neck + calibration ring line.
export function build_volumetric_flask(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const d = 0.46 * w
  const cx = 0.5 * w
  const bulb_y = 0.94 * h - d
  const neck_w = 0.14 * w
  const neck_top = 0.05 * h
  const neck_bot = bulb_y + 0.1 * d
  specs.push(_rect(cx - neck_w / 2, neck_top, neck_w, neck_bot - neck_top, OUTLINE, GLASS, W_OUT))
  specs.push(_circle(cx - d / 2, bulb_y, d, d, OUTLINE, GLASS, W_OUT))
  const [fill, surf] = _bulb_liquid(cx, bulb_y, d, 0.48)
  specs.push(fill)
  specs.push(surf)
  // calibration ring on the visible neck (above the bulb)
  const ring_y = neck_top + (bulb_y - neck_top) * 0.55
  specs.push(_line(cx - neck_w / 2, ring_y, cx + neck_w / 2, ring_y, OUTLINE, W_DET))
  // rim
  specs.push(_line(cx - neck_w / 2 - 0.02 * w, neck_top, cx + neck_w / 2 + 0.02 * w, neck_top, OUTLINE, W_OUT))
  return specs
}

// Straight tube with a U-shaped (round) bottom, liquid lower part.
export function build_test_tube(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const tw = 0.36 * w
  const x = 0.5 * w - tw / 2
  const r = tw / 2
  const top = 0.06 * h
  const straight_bot = 0.94 * h - r  // where the round bottom starts
  const liq_top = 0.5 * h
  // liquid: straight column + filled round bottom (dome bulging down)
  specs.push(_rect(x, liq_top, tw, straight_bot - liq_top, NONE, LIQUID, W_DET))
  specs.push(_half(x, straight_bot, tw, r, 180, NONE, LIQUID, W_DET))
  // walls + round bottom outline
  specs.push(_line(x, top, x, straight_bot, OUTLINE, W_OUT))
  specs.push(_line(x + tw, top, x + tw, straight_bot, OUTLINE, W_OUT))
  specs.push(_half(x, straight_bot, tw, r, 180, OUTLINE, NONE, W_OUT))
  // liquid surface
  specs.push(_line(x, liq_top, x + tw, liq_top, OUTLINE, W_DET))
  // flared rim
  specs.push(_line(x - 0.04 * w, top, x + tw + 0.04 * w, top, OUTLINE, W_OUT))
  specs.push(_line(x - 0.04 * w, top, x, top + 0.03 * h, OUTLINE, W_OUT))
  specs.push(_line(x + tw + 0.04 * w, top, x + tw, top + 0.03 * h, OUTLINE, W_OUT))
  return specs
}

// Tall narrow tube on small base, graduation ticks, liquid.
export function build_graduated_cylinder(w: number, h: number) {
  let yy
  const specs: Spec[] = []
  const tw = 0.34 * w
  const x = 0.5 * w - tw / 2
  const top = 0.08 * h
  const bot = 0.86 * h
  // base
  const base_w = 0.6 * w
  _trap_or_rect_base(specs, w, h, base_w, bot)
  // liquid
  const liq_top = 0.4 * h
  specs.push(_rect(x, liq_top, tw, bot - liq_top, NONE, LIQUID, W_DET))
  // walls + bottom
  specs.push(_rect(x, top, tw, bot - top, OUTLINE, NONE, W_OUT))
  // liquid surface
  specs.push(_line(x, liq_top, x + tw, liq_top, OUTLINE, W_DET))
  // spout at top-left
  specs.push(_line(x, top, x - 0.05 * w, top - 0.04 * h, OUTLINE, W_OUT))
  // graduation ticks
  for (const fr of [0.3, 0.45, 0.6, 0.75]) {
    yy = top + (bot - top) * fr
    specs.push(_line(x + tw - 0.1 * w, yy, x + tw, yy, OUTLINE, W_DET))
  }
  return specs
}

// Append a splayed foot (flared pedestal) under a tube; helper.
function _trap_or_rect_base(specs: Spec[], w: number, h: number, base_w: number, bot: number) {
  const base_h = 0.1 * h
  // flared stem: trapezoid widening downward
  specs.push({ shape: 'trapezoid', x: 0.5 * w - base_w / 2, y: bot, w: base_w, h: base_h, rotation: 180, stroke: OUTLINE, fill: GLASS, width: W_OUT })
  // solid base pad
  specs.push(_rrect(0.5 * w - base_w / 2, bot + base_h, base_w, 0.04 * h, 0.02 * h, OUTLINE, GLASS, W_OUT))
  return null
}

// Wide inverted trapezoid cone narrowing into a thin stem tube.
export function build_funnel(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const top = 0.12 * h
  const cone_bot = 0.5 * h
  const stem_bot = 0.92 * h
  const [tl, tr] = [0.1 * w, 0.9 * w]
  const sw = 0.14 * w
  const [sl, sr] = [0.5 * w - sw / 2, 0.5 * w + sw / 2]
  // cone walls
  specs.push(_line(tl, top, sl, cone_bot, OUTLINE, W_OUT))
  specs.push(_line(tr, top, sr, cone_bot, OUTLINE, W_OUT))
  // top rim
  specs.push(_line(tl, top, tr, top, OUTLINE, W_OUT))
  // stem
  specs.push(_rect(sl, cone_bot, sw, stem_bot - cone_bot, OUTLINE, GLASS, W_OUT))
  return specs
}

// Pear shape + stopcock valve at bottom + stopper on top.
export function build_separating_funnel(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  // stopper (top)
  const sp_w = 0.2 * w
  specs.push({ shape: 'trapezoid', x: cx - sp_w / 2, y: 0.04 * h, w: sp_w, h: 0.1 * h, rotation: 180, stroke: OUTLINE, fill: METAL, width: W_OUT })
  // neck
  const nw = 0.14 * w
  specs.push(_rect(cx - nw / 2, 0.14 * h, nw, 0.1 * h, OUTLINE, GLASS, W_OUT))
  // pear bulb: circle bottom + tapered shoulders to neck
  const d = 0.56 * w
  const bulb_bot = 0.74 * h
  specs.push(_circle(cx - d / 2, bulb_bot - d, d, d, OUTLINE, GLASS, W_OUT))
  // shoulders (taper from neck width to bulb)
  specs.push(_line(cx - nw / 2, 0.24 * h, cx - d / 2 + 0.06 * d, bulb_bot - d + 0.18 * d, OUTLINE, W_OUT))
  specs.push(_line(cx + nw / 2, 0.24 * h, cx + d / 2 - 0.06 * d, bulb_bot - d + 0.18 * d, OUTLINE, W_OUT))
  // liquid contained in the lower bulb
  const [fill, surf] = _bulb_liquid(cx, bulb_bot - d, d, 0.46)
  specs.push(fill)
  specs.push(surf)
  // stopcock stem
  specs.push(_rect(cx - 0.05 * w, bulb_bot, 0.1 * w, 0.06 * h, OUTLINE, GLASS, W_OUT))
  // valve (small cross / diamond)
  const vy = bulb_bot + 0.08 * h
  specs.push(_poly('diamond', cx - 0.1 * w, vy - 0.05 * h, 0.2 * w, 0.1 * h, 0, OUTLINE, METAL, W_DET))
  specs.push(_line(cx - 0.14 * w, vy, cx + 0.14 * w, vy, OUTLINE, W_DET))
  // tip
  specs.push(_rect(cx - 0.04 * w, vy + 0.05 * h, 0.08 * w, 0.1 * h, OUTLINE, GLASS, W_OUT))
  return specs
}

// Liebig condenser: vertical double-tube + side water stubs.
export function build_condenser(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const top = 0.08 * h
  const bot = 0.92 * h
  const cx = 0.5 * w
  const inner_w = 0.16 * w
  const outer_w = 0.4 * w
  // outer jacket
  specs.push(_rect(cx - outer_w / 2, top + 0.06 * h, outer_w, bot - top - 0.12 * h, OUTLINE, GLASS, W_OUT))
  // inner tube (full length)
  specs.push(_rect(cx - inner_w / 2, top, inner_w, bot - top, OUTLINE, GLASS, W_OUT))
  // liquid in inner tube
  specs.push(_rect(cx - inner_w / 2 + 0.01 * w, 0.45 * h, inner_w - 0.02 * w, bot - 0.45 * h, NONE, LIQUID, W_DET))
  // water stubs
  const sl = cx - outer_w / 2
  const sr = cx + outer_w / 2
  specs.push(_rect(sl - 0.12 * w, 0.22 * h, 0.12 * w, 0.08 * h, OUTLINE, GLASS, W_OUT))
  specs.push(_rect(sr, 0.7 * h, 0.12 * w, 0.08 * h, OUTLINE, GLASS, W_OUT))
  return specs
}

// Dishes & tubes
// Shallow wide dish (side view) with lid line.
export function build_petri_dish(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const dy = 0.55 * h
  const dh = 0.28 * h
  const dx = 0.08 * w
  const dw = 0.84 * w
  // base dish
  specs.push(_rrect(dx, dy, dw, dh, dh * 0.45, OUTLINE, GLASS, W_OUT))
  // lid (slightly wider, on top)
  const ly = 0.4 * h
  const lh = 0.2 * h
  specs.push(_rrect(dx - 0.03 * w, ly, dw + 0.06 * w, lh, lh * 0.45, OUTLINE, GLASS, W_OUT))
  return specs
}

// Very shallow concave arc (flat watch glass).
export function build_watch_glass(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const gw = 0.84 * w
  // shallow concave: halfcircle, flat, thin
  specs.push(_half(cx - gw / 2, 0.42 * h, gw, 0.36 * h, 0, OUTLINE, GLASS, W_OUT))
  // top rim line (the open mouth)
  specs.push(_line(cx - gw / 2, 0.42 * h + 0.18 * h, cx + gw / 2, 0.42 * h + 0.18 * h, OUTLINE, W_OUT))
  return specs
}

// Very long thin graduated tube + stopcock near bottom + fine tip.
export function build_burette(w: number, h: number): Spec[] {
  let yy
  const specs: Spec[] = []
  const tw = 0.3 * w
  const x = 0.5 * w - tw / 2
  const top = 0.04 * h
  const stop_y = 0.82 * h
  // liquid
  specs.push(_rect(x, 0.3 * h, tw, stop_y - 0.3 * h, NONE, LIQUID, W_DET))
  // tube
  specs.push(_rect(x, top, tw, stop_y - top, OUTLINE, NONE, W_OUT))
  // liquid surface
  specs.push(_line(x, 0.3 * h, x + tw, 0.3 * h, OUTLINE, W_DET))
  // graduations
  for (let i = 1; i < 8; i++) {
    yy = top + (stop_y - top) * i / 8
    specs.push(_line(x + tw - 0.08 * w, yy, x + tw, yy, OUTLINE, W_DET))
  }
  // stopcock
  const cx = 0.5 * w
  specs.push(_poly('diamond', cx - 0.12 * w, stop_y, 0.24 * w, 0.08 * h, 0, OUTLINE, METAL, W_DET))
  specs.push(_line(cx - 0.16 * w, stop_y + 0.04 * h, cx + 0.16 * w, stop_y + 0.04 * h, OUTLINE, W_DET))
  // short stem below the stopcock, then the fine tapered tip
  specs.push(_rect(cx - 0.04 * w, stop_y + 0.08 * h, 0.08 * w, 0.04 * h, OUTLINE, GLASS, W_OUT))
  specs.push({ shape: 'triangle', x: cx - 0.04 * w, y: stop_y + 0.12 * h, w: 0.08 * w, h: 0.06 * h, rotation: 180, stroke: OUTLINE, fill: GLASS, width: W_OUT })
  return specs
}

// Long thin tube with a central bulb and tapered tip.
export function build_pipette(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const tw = 0.16 * w
  const top = 0.04 * h
  const bot = 0.9 * h
  // tube top half
  specs.push(_rect(cx - tw / 2, top, tw, 0.34 * h, OUTLINE, GLASS, W_OUT))
  // central bulb
  const bw = 0.46 * w
  specs.push(_ellipse(cx - bw / 2, 0.34 * h, bw, 0.24 * h, OUTLINE, GLASS, W_OUT))
  // liquid: lower half of the bulb (dome bulging down)
  specs.push(_half(cx - bw / 2, 0.46 * h, bw, 0.12 * h, 180, NONE, LIQUID, W_DET))
  specs.push(_line(cx - bw / 2, 0.46 * h, cx + bw / 2, 0.46 * h, OUTLINE, W_DET))
  // tube lower half
  specs.push(_rect(cx - tw / 2, 0.58 * h, tw, 0.2 * h, OUTLINE, GLASS, W_OUT))
  // tapered tip
  specs.push({ shape: 'triangle', x: cx - tw / 2, y: 0.78 * h, w: tw, h: bot - 0.78 * h, rotation: 180, stroke: OUTLINE, fill: GLASS, width: W_OUT })
  return specs
}

// Small tube with a rubber bulb on top.
export function build_dropper(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const tw = 0.18 * w
  // rubber bulb (ellipse)
  const bw = 0.4 * w
  specs.push(_ellipse(cx - bw / 2, 0.06 * h, bw, 0.28 * h, OUTLINE, METAL, W_OUT))
  // tube
  specs.push(_rect(cx - tw / 2, 0.34 * h, tw, 0.44 * h, OUTLINE, GLASS, W_OUT))
  // liquid
  specs.push(_rect(cx - tw / 2 + 0.01 * w, 0.55 * h, tw - 0.02 * w, 0.23 * h, NONE, LIQUID, W_DET))
  // tapered tip
  specs.push({ shape: 'triangle', x: cx - tw / 2, y: 0.78 * h, w: tw, h: 0.16 * h, rotation: 180, stroke: OUTLINE, fill: GLASS, width: W_OUT })
  return specs
}

// Heat & support
// Base + vertical barrel + orange flame triangle on top.
export function build_bunsen_burner(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  // base
  const base_w = 0.6 * w
  specs.push({ shape: 'trapezoid', x: cx - base_w / 2, y: 0.84 * h, w: base_w, h: 0.1 * h, rotation: 180, stroke: OUTLINE, fill: METAL, width: W_OUT })
  // barrel
  const bw = 0.18 * w
  specs.push(_rect(cx - bw / 2, 0.4 * h, bw, 0.44 * h, OUTLINE, METAL, W_OUT))
  // air-hole collar
  specs.push(_rect(cx - bw / 2 - 0.03 * w, 0.66 * h, bw + 0.06 * w, 0.06 * h, OUTLINE, METAL, W_DET))
  // flame (orange triangle)
  const fw = 0.3 * w
  specs.push({ shape: 'triangle', x: cx - fw / 2, y: 0.1 * h, w: fw, h: 0.3 * h, rotation: 0, stroke: FLAME, fill: FLAME, width: W_DET })
  // inner blue cone
  specs.push({ shape: 'triangle', x: cx - fw * 0.25, y: 0.26 * h, w: fw * 0.5, h: 0.14 * h, rotation: 0, stroke: LIQUID, fill: LIQUID, width: W_DET })
  return specs
}

// Appliance box + round heating plate on top + control knob.
export function build_hotplate(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  // body
  const by = 0.45 * h
  specs.push(_rrect(0.08 * w, by, 0.84 * w, 0.45 * h, 0.04 * w, OUTLINE, METAL, W_OUT))
  // heating plate on top
  const pd = 0.46 * w
  const cx = 0.5 * w
  specs.push(_circle(cx - pd / 2, by - 0.14 * h, pd, 0.2 * h, OUTLINE, '#bcc4cc', W_OUT))
  // plate as ellipse top surface
  specs.push(_ellipse(cx - pd / 2, by - 0.18 * h, pd, 0.14 * h, OUTLINE, '#d8dee5', W_OUT))
  // control knob
  specs.push(_circle(0.74 * w, by + 0.14 * h, 0.1 * w, 0.1 * w, OUTLINE, '#9aa3ad', W_DET))
  // display
  specs.push(_rect(0.16 * w, by + 0.12 * h, 0.22 * w, 0.1 * h, OUTLINE, '#1d2a36', W_DET))
  // feet
  specs.push(_rect(0.14 * w, 0.9 * h, 0.06 * w, 0.05 * h, OUTLINE, METAL, W_DET))
  specs.push(_rect(0.8 * w, 0.9 * h, 0.06 * w, 0.05 * h, OUTLINE, METAL, W_DET))
  return specs
}

// Heavy base + tall vertical rod + one horizontal clamp arm.
export function build_retort_stand(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  // base
  specs.push(_rect(0.1 * w, 0.88 * h, 0.7 * w, 0.08 * h, OUTLINE, METAL, W_OUT))
  // rod
  const rod_x = 0.2 * w
  specs.push(_rect(rod_x, 0.06 * h, 0.06 * w, 0.82 * h, OUTLINE, METAL, W_OUT))
  // boss head (clamp mount)
  specs.push(_rect(rod_x - 0.02 * w, 0.3 * h, 0.12 * w, 0.1 * h, OUTLINE, '#9aa3ad', W_DET))
  // clamp arm
  specs.push(_rect(rod_x + 0.08 * w, 0.33 * h, 0.5 * w, 0.04 * h, OUTLINE, METAL, W_OUT))
  // clamp jaws at arm end
  specs.push(_poly('triangle', 0.7 * w, 0.28 * h, 0.14 * w, 0.07 * h, 180, OUTLINE, METAL, W_DET))
  specs.push(_poly('triangle', 0.7 * w, 0.36 * h, 0.14 * w, 0.07 * h, 0, OUTLINE, METAL, W_DET))
  return specs
}

// Flat top ring/line on three splayed legs.
export function build_tripod(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const top_y = 0.3 * h
  // top ring (ellipse seen edge-on) + line
  specs.push(_ellipse(0.16 * w, top_y - 0.03 * h, 0.68 * w, 0.08 * h, OUTLINE, NONE, W_OUT))
  specs.push(_line(0.16 * w, top_y, 0.84 * w, top_y, OUTLINE, W_OUT))
  // three legs
  specs.push(_line(0.24 * w, top_y, 0.16 * w, 0.92 * h, OUTLINE, W_OUT))
  specs.push(_line(cx, top_y, cx, 0.92 * h, OUTLINE, W_OUT))
  specs.push(_line(0.76 * w, top_y, 0.84 * w, 0.92 * h, OUTLINE, W_OUT))
  return specs
}

// Small square of wire gauze with cross-hatch grid.
export function build_gauze(w: number, h: number): Spec[] {
  let vx, hy
  const specs: Spec[] = []
  const [x, y] = [0.14 * w, 0.3 * h]
  const [gw, gh] = [0.72 * w, 0.4 * h]
  specs.push(_rect(x, y, gw, gh, OUTLINE, '#e7ebef', W_OUT))
  // grid
  const n = 5
  for (let i = 1; i < n; i++) {
    vx = x + gw * i / n
    specs.push(_line(vx, y, vx, y + gh, OUTLINE, W_DET))
    hy = y + gh * i / n
    specs.push(_line(x, hy, x + gw, hy, OUTLINE, W_DET))
  }
  // support frame legs
  specs.push(_line(x + 0.06 * w, y + gh, x + 0.06 * w, 0.9 * h, OUTLINE, W_DET))
  specs.push(_line(x + gw - 0.06 * w, y + gh, x + gw - 0.06 * w, 0.9 * h, OUTLINE, W_DET))
  return specs
}

// Other
// Tall rounded-top cylinder + valve/regulator on top.
export function build_gas_cylinder(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const bw = 0.56 * w
  const bx = cx - bw / 2
  const body_top = 0.2 * h
  const body_bot = 0.94 * h
  // rounded-top body
  specs.push(_rrect(bx, body_top, bw, body_bot - body_top, bw * 0.35, OUTLINE, '#b04a3a', W_OUT))
  // shoulder highlight band
  specs.push(_rect(bx, 0.3 * h, bw, 0.04 * h, NONE, '#c95b4a', W_DET))
  // valve neck
  const vw = 0.16 * w
  specs.push(_rect(cx - vw / 2, 0.1 * h, vw, 0.12 * h, OUTLINE, METAL, W_OUT))
  // regulator / handwheel
  specs.push(_circle(cx - 0.12 * w, 0.02 * h, 0.18 * w, 0.1 * h, OUTLINE, METAL, W_DET))
  specs.push(_line(cx - 0.12 * w, 0.07 * h, cx + 0.06 * w, 0.07 * h, OUTLINE, W_DET))
  return specs
}

// Benchtop balance: base box + flat pan on top + small display.
export function build_balance(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  // base
  const by = 0.55 * h
  specs.push(_rrect(0.1 * w, by, 0.8 * w, 0.38 * h, 0.04 * w, OUTLINE, METAL, W_OUT))
  // display
  specs.push(_rect(0.18 * w, by + 0.1 * h, 0.3 * w, 0.14 * h, OUTLINE, '#1d2a36', W_DET))
  // buttons
  specs.push(_circle(0.62 * w, by + 0.12 * h, 0.06 * w, 0.06 * w, OUTLINE, '#9aa3ad', W_DET))
  specs.push(_circle(0.74 * w, by + 0.12 * h, 0.06 * w, 0.06 * w, OUTLINE, '#9aa3ad', W_DET))
  // pan support
  const cx = 0.5 * w
  specs.push(_rect(cx - 0.03 * w, 0.42 * h, 0.06 * w, 0.14 * h, OUTLINE, METAL, W_DET))
  // flat pan (ellipse)
  specs.push(_ellipse(0.24 * w, 0.34 * h, 0.52 * w, 0.12 * h, OUTLINE, '#d8dee5', W_OUT))
  return specs
}

// Squeeze bottle body + angled delivery tube from the cap.
export function build_wash_bottle(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const cx = 0.5 * w
  const bw = 0.5 * w
  const bx = cx - bw / 2
  const body_top = 0.34 * h
  specs.push(_rrect(bx, body_top, bw, 0.94 * h - body_top, bw * 0.18, OUTLINE, '#dfeaf2', W_OUT))
  // liquid
  specs.push(_rect(bx + 0.02 * w, 0.6 * h, bw - 0.04 * w, 0.34 * h - 0.06 * h, NONE, LIQUID, W_DET))
  specs.push(_line(bx + 0.02 * w, 0.6 * h, bx + bw - 0.02 * w, 0.6 * h, OUTLINE, W_DET))
  // neck + cap
  const nw = 0.22 * w
  specs.push(_rect(cx - nw / 2, 0.22 * h, nw, 0.12 * h, OUTLINE, METAL, W_OUT))
  // angled delivery tube
  specs.push(_line(cx, 0.22 * h, cx - 0.02 * w, 0.1 * h, OUTLINE, W_OUT))
  specs.push(_line(cx - 0.02 * w, 0.1 * h, 0.78 * w, 0.16 * h, OUTLINE, W_OUT))
  return specs
}

// Sizes (mm), labels, categories
export const SIZES: Record<string, [number, number]> = { beaker: [100, 120], erlenmeyer: [120, 160], round_bottom_flask: [120, 180], volumetric_flask: [90, 220], test_tube: [40, 160], graduated_cylinder: [70, 240], funnel: [120, 150], separating_funnel: [120, 280], condenser: [110, 320], petri_dish: [120, 40], watch_glass: [100, 30], burette: [50, 400], pipette: [60, 320], dropper: [40, 120], bunsen_burner: [120, 200], hotplate: [220, 160], retort_stand: [300, 600], tripod: [180, 160], gauze: [140, 120], gas_cylinder: [180, 520], balance: [220, 180], wash_bottle: [110, 220] }
// Glassware
// Dishes & tubes
// Heat & support
// Other
export const LABELS: Record<string, string> = { beaker: 'Beaker', erlenmeyer: 'Erlenmeyer flask', round_bottom_flask: 'Round-bottom flask', volumetric_flask: 'Volumetric flask', test_tube: 'Test tube', graduated_cylinder: 'Graduated cylinder', funnel: 'Funnel', separating_funnel: 'Separating funnel', condenser: 'Condenser', petri_dish: 'Petri dish', watch_glass: 'Watch glass', burette: 'Burette', pipette: 'Pipette', dropper: 'Dropper', bunsen_burner: 'Bunsen burner', hotplate: 'Hotplate', retort_stand: 'Retort stand', tripod: 'Tripod', gauze: 'Wire gauze', gas_cylinder: 'Gas cylinder', balance: 'Balance', wash_bottle: 'Wash bottle' }
export const CATEGORIES: [string, string[]][] = [['Glassware', ['beaker', 'erlenmeyer', 'round_bottom_flask', 'volumetric_flask', 'test_tube', 'graduated_cylinder', 'funnel', 'separating_funnel', 'condenser']], ['Dishes & tubes', ['petri_dish', 'watch_glass', 'burette', 'pipette', 'dropper']], ['Heat & support', ['bunsen_burner', 'hotplate', 'retort_stand', 'tripod', 'gauze']], ['Other', ['gas_cylinder', 'balance', 'wash_bottle']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  beaker: build_beaker,
  erlenmeyer: build_erlenmeyer,
  round_bottom_flask: build_round_bottom_flask,
  volumetric_flask: build_volumetric_flask,
  test_tube: build_test_tube,
  graduated_cylinder: build_graduated_cylinder,
  funnel: build_funnel,
  separating_funnel: build_separating_funnel,
  condenser: build_condenser,
  petri_dish: build_petri_dish,
  watch_glass: build_watch_glass,
  burette: build_burette,
  pipette: build_pipette,
  dropper: build_dropper,
  bunsen_burner: build_bunsen_burner,
  hotplate: build_hotplate,
  retort_stand: build_retort_stand,
  tripod: build_tripod,
  gauze: build_gauze,
  gas_cylinder: build_gas_cylinder,
  balance: build_balance,
  wash_bottle: build_wash_bottle,
}
