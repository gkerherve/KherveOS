// Network / IT architecture diagram symbols.
// Ported from the desktop KhervePaint (network.py).

import type { Spec } from '../spec'
import { pmod } from '../spec'

export const OUTLINE = '#333333'
export const DEVICE = '#eef2f6'
export const ACCENT = '#cfe0f5'
export const DARK = '#5b6b7b'
export const W_OUT = 2
export const W_DET = 1.2
// Endpoints
// A monitor (rounded_rect screen) on a small stand.
export function build_desktop(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.08 * w, y: 0.06 * h, w: 0.84 * w, h: 0.58 * h, radius: 0.05 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'rounded_rect', x: 0.15 * w, y: 0.13 * h, w: 0.7 * w, h: 0.44 * h, radius: 0.03 * w, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'rect', x: 0.44 * w, y: 0.64 * h, w: 0.12 * w, h: 0.16 * h, stroke: OUTLINE, fill: DEVICE, width: W_DET })
  specs.push({ shape: 'trapezoid', x: 0.26 * w, y: 0.8 * h, w: 0.48 * w, h: 0.14 * h, rotation: 0, stroke: OUTLINE, fill: DARK, width: W_OUT })
  return specs
}

// A screen rect + a wider keyboard trapezoid base.
export function build_laptop(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.16 * w, y: 0.08 * h, w: 0.68 * w, h: 0.52 * h, radius: 0.03 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'rect', x: 0.21 * w, y: 0.13 * h, w: 0.58 * w, h: 0.42 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'trapezoid', x: 0.04 * w, y: 0.62 * h, w: 0.92 * w, h: 0.26 * h, rotation: 180, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'line', x1: 0.3 * w, y1: 0.7 * h, x2: 0.7 * w, y2: 0.7 * h, stroke: DARK, width: W_DET })
  return specs
}

// A tall rounded_rect phone with a small speaker line and home dot.
export function build_mobile(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.26 * w, y: 0.04 * h, w: 0.48 * w, h: 0.92 * h, radius: 0.1 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'rect', x: 0.32 * w, y: 0.16 * h, w: 0.36 * w, h: 0.64 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'line', x1: 0.44 * w, y1: 0.1 * h, x2: 0.56 * w, y2: 0.1 * h, stroke: DARK, width: W_DET })
  specs.push({ shape: 'circle', x: 0.47 * w, y: 0.85 * h, w: 0.06 * w, h: 0.06 * w, stroke: OUTLINE, fill: DARK, width: W_DET })
  return specs
}

// A person glyph — head circle above a trapezoid torso.
export function build_user(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'circle', x: 0.33 * w, y: 0.06 * h, w: 0.34 * w, h: 0.34 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'trapezoid', x: 0.12 * w, y: 0.52 * h, w: 0.76 * w, h: 0.44 * h, rotation: 180, stroke: OUTLINE, fill: ACCENT, width: W_OUT })
  return specs
}

// A printer body rect with a paper-out slot and a sheet on top.
export function build_printer(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0.26 * w, y: 0.04 * h, w: 0.48 * w, h: 0.26 * h, stroke: OUTLINE, fill: '#ffffff', width: W_DET })
  specs.push({ shape: 'line', x1: 0.33 * w, y1: 0.13 * h, x2: 0.67 * w, y2: 0.13 * h, stroke: DARK, width: W_DET })
  specs.push({ shape: 'line', x1: 0.33 * w, y1: 0.21 * h, x2: 0.67 * w, y2: 0.21 * h, stroke: DARK, width: W_DET })
  specs.push({ shape: 'rounded_rect', x: 0.08 * w, y: 0.3 * h, w: 0.84 * w, h: 0.5 * h, radius: 0.04 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'rect', x: 0.2 * w, y: 0.56 * h, w: 0.6 * w, h: 0.08 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'circle', x: 0.74 * w, y: 0.37 * h, w: 0.06 * w, h: 0.06 * w, stroke: OUTLINE, fill: DARK, width: W_DET })
  specs.push({ shape: 'rect', x: 0.14 * w, y: 0.8 * h, w: 0.72 * w, h: 0.1 * h, stroke: OUTLINE, fill: DARK, width: W_DET })
  return specs
}

// Infrastructure
// A tall rack box with horizontal unit divisions and status LEDs.
export function build_server(w: number, h: number): Spec[] {
  let uy
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.18 * w, y: 0.04 * h, w: 0.64 * w, h: 0.92 * h, radius: 0.04 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const units = 4
  const top = 0.08 * h
  const bot = 0.92 * h
  const uh = (bot - top) / units
  for (let i = 0; i < units; i++) {
    uy = top + i * uh
    specs.push({ shape: 'rect', x: 0.24 * w, y: uy + 0.02 * h, w: 0.52 * w, h: uh - 0.04 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
    specs.push({ shape: 'circle', x: 0.66 * w, y: uy + 0.06 * h, w: 0.05 * w, h: 0.05 * w, stroke: OUTLINE, fill: DARK, width: W_DET })
    specs.push({ shape: 'line', x1: 0.28 * w, y1: uy + 0.07 * h, x2: 0.5 * w, y2: uy + 0.07 * h, stroke: DARK, width: W_DET })
  }
  return specs
}

// A cylinder — full ellipse top rim, body, front-half bottom curve,
// plus a couple of platter divider lines.
export function build_database(w: number, h: number): Spec[] {
  const [bx, bw] = [0.16 * w, 0.68 * w]
  const rim = 0.2 * h
  const [top, bot] = [0.08 * h, 0.92 * h]
  const [body_top, body_bot] = [top + rim / 2, bot - rim / 2]
  const specs: Spec[] = [
    // body fill + side lines
    { shape: 'rect', x: bx, y: body_top, w: bw, h: body_bot - body_top, stroke: 'none', fill: DEVICE, width: W_DET },
    { shape: 'line', x1: bx, y1: body_top, x2: bx, y2: body_bot, stroke: OUTLINE, width: W_OUT },
    { shape: 'line', x1: bx + bw, y1: body_top, x2: bx + bw, y2: body_bot, stroke: OUTLINE, width: W_OUT },
    // bottom front-half curve (bulging DOWN): rot180 keeps it round
    { shape: 'halfcircle', x: bx, y: body_bot - rim / 2, w: bw, h: rim, stroke: OUTLINE, fill: DEVICE, width: W_OUT, rotation: 180 },
    // top rim ellipse
    { shape: 'ellipse', x: bx, y: top, w: bw, h: rim, stroke: OUTLINE, fill: ACCENT, width: W_OUT },
  ]
  // platter divider (one faint ellipse arc near the top third)
  specs.push({ shape: 'ellipse', x: bx, y: top + (body_bot - top) * 0.34, w: bw, h: rim, stroke: DARK, fill: 'none', width: W_DET })
  return specs
}

// A NAS/disk array — a box with several drive-bay slots.
export function build_storage(w: number, h: number): Spec[] {
  let by
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.1 * w, y: 0.12 * h, w: 0.8 * w, h: 0.76 * h, radius: 0.03 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const bays = 4
  const top = 0.18 * h
  const bot = 0.82 * h
  const bh = (bot - top) / bays
  for (let i = 0; i < bays; i++) {
    by = top + i * bh
    specs.push({ shape: 'rect', x: 0.18 * w, y: by + 0.015 * h, w: 0.64 * w, h: bh - 0.03 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
    specs.push({ shape: 'circle', x: 0.72 * w, y: by + bh / 2 - 0.025 * w, w: 0.05 * w, h: 0.05 * w, stroke: OUTLINE, fill: DARK, width: W_DET })
  }
  return specs
}

// A box with one inbound arrow splitting to two outbound arrows.
export function build_load_balancer(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.22 * w, y: 0.34 * h, w: 0.56 * w, h: 0.32 * h, radius: 0.05 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'arrow', x1: 0.02 * w, y1: 0.5 * h, x2: 0.22 * w, y2: 0.5 * h, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'arrow', x1: 0.78 * w, y1: 0.5 * h, x2: 0.98 * w, y2: 0.18 * h, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'arrow', x1: 0.78 * w, y1: 0.5 * h, x2: 0.98 * w, y2: 0.82 * h, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'diamond', x: 0.42 * w, y: 0.42 * h, w: 0.16 * w, h: 0.16 * h, rotation: 0, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  return specs
}

// Network
// A flat box with 4 directional arrows on top (classic router icon).
export function build_router(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.14 * w, y: 0.4 * h, w: 0.72 * w, h: 0.46 * h, radius: 0.05 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const [cx, cy] = [0.5 * w, 0.2 * h]
  const r = 0.16 * w
  const rv = 0.16 * h
  specs.push({ shape: 'arrow', x1: cx, y1: cy, x2: cx, y2: cy - rv, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'arrow', x1: cx, y1: cy, x2: cx, y2: cy + rv, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'arrow', x1: cx, y1: cy, x2: cx - r, y2: cy, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'arrow', x1: cx, y1: cy, x2: cx + r, y2: cy, stroke: DARK, width: W_OUT })
  specs.push({ shape: 'circle', x: 0.22 * w, y: 0.5 * h, w: 0.05 * w, h: 0.05 * w, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'circle', x: 0.32 * w, y: 0.5 * h, w: 0.05 * w, h: 0.05 * w, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  return specs
}

// A flat box with several bidirectional arrow pairs across the top.
export function build_switch(w: number, h: number): Spec[] {
  let x, ox
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.08 * w, y: 0.46 * h, w: 0.84 * w, h: 0.42 * h, radius: 0.05 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const ys_up = 0.06 * h
  const ys_dn = 0.36 * h
  for (const fx of [0.22, 0.4, 0.58, 0.76]) {
    x = fx * w
    ox = 0.04 * w
    specs.push({ shape: 'arrow', x1: x - ox, y1: ys_dn, x2: x - ox, y2: ys_up, stroke: DARK, width: W_OUT })
    specs.push({ shape: 'arrow', x1: x + ox, y1: ys_up, x2: x + ox, y2: ys_dn, stroke: DARK, width: W_OUT })
  }
  for (const fx of [0.18, 0.34, 0.5, 0.66, 0.82]) {
    specs.push({ shape: 'rect', x: fx * w - 0.03 * w, y: 0.64 * h, w: 0.06 * w, h: 0.1 * h, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  }
  return specs
}

// A brick-wall pattern with a small flame.
export function build_firewall(w: number, h: number): Spec[] {
  let y, y0, y1, offset, x, step
  const specs: Spec[] = []
  specs.push({ shape: 'rect', x: 0.1 * w, y: 0.3 * h, w: 0.8 * w, h: 0.62 * h, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const left = 0.1 * w
  const right = 0.9 * w
  const top = 0.3 * h
  const bot = 0.92 * h
  const rows = 4
  const rh = (bot - top) / rows
  for (let i = 1; i < rows; i++) {
    y = top + i * rh
    specs.push({ shape: 'line', x1: left, y1: y, x2: right, y2: y, stroke: DARK, width: W_DET })
  }
  for (let i = 0; i < rows; i++) {
    y0 = top + i * rh
    y1 = y0 + rh
    offset = pmod(i, 2) ? 0.2 * (right - left) : 0
    x = left + offset
    step = 0.4 * (right - left)
    while (x < right) {
      if (x > left) {
        specs.push({ shape: 'line', x1: x, y1: y0, x2: x, y2: y1, stroke: DARK, width: W_DET })
      }
      x += step
    }
  }
  specs.push({ shape: 'triangle', x: 0.42 * w, y: 0.04 * h, w: 0.16 * w, h: 0.26 * h, rotation: 0, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  return specs
}

// A small box with an antenna line and a couple of signal arcs.
export function build_modem(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  specs.push({ shape: 'rounded_rect', x: 0.16 * w, y: 0.5 * h, w: 0.68 * w, h: 0.4 * h, radius: 0.05 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  const ax = 0.72 * w
  specs.push({ shape: 'line', x1: ax, y1: 0.5 * h, x2: ax, y2: 0.1 * h, stroke: OUTLINE, width: W_OUT })
  specs.push({ shape: 'circle', x: ax - 0.04 * w, y: 0.04 * h, w: 0.08 * w, h: 0.08 * w, stroke: OUTLINE, fill: DARK, width: W_DET })
  specs.push({ shape: 'halfcircle', x: 0.2 * w, y: 0.18 * h, w: 0.28 * w, h: 0.2 * h, rotation: 0, stroke: DARK, fill: 'none', width: W_DET })
  specs.push({ shape: 'halfcircle', x: 0.26 * w, y: 0.26 * h, w: 0.16 * w, h: 0.14 * h, rotation: 0, stroke: DARK, fill: 'none', width: W_DET })
  specs.push({ shape: 'circle', x: 0.24 * w, y: 0.64 * h, w: 0.06 * w, h: 0.06 * w, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  specs.push({ shape: 'circle', x: 0.36 * w, y: 0.64 * h, w: 0.06 * w, h: 0.06 * w, stroke: OUTLINE, fill: ACCENT, width: W_DET })
  return specs
}

// A base dot with 3 concentric expanding arcs — wifi waves.
export function build_wifi_ap(w: number, h: number): Spec[] {
  let rw, rh
  const specs: Spec[] = []
  const cx = 0.5 * w
  const by = 0.86 * h
  specs.push({ shape: 'circle', x: cx - 0.07 * w, y: by - 0.07 * w, w: 0.14 * w, h: 0.14 * w, stroke: OUTLINE, fill: DARK, width: W_OUT })
  for (const [i, rad] of [0.24, 0.4, 0.56].entries()) {
    rw = rad * w
    rh = rad * h * 0.9
    specs.push({ shape: 'halfcircle', x: cx - rw, y: by - rh, w: 2 * rw, h: rh, rotation: 0, stroke: i === 0 ? ACCENT : DARK, fill: 'none', width: W_OUT })
  }
  return specs
}

// A cloud outline made of overlapping circles/ellipses, flat bottom.
export function build_cloud(w: number, h: number): Spec[] {
  const specs: Spec[] = []
  const base_y = 0.66 * h
  specs.push({ shape: 'ellipse', x: 0.1 * w, y: 0.44 * h, w: 0.8 * w, h: 0.4 * h, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'circle', x: 0.08 * w, y: 0.4 * h, w: 0.34 * w, h: 0.34 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'circle', x: 0.34 * w, y: 0.22 * h, w: 0.4 * w, h: 0.4 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'circle', x: 0.6 * w, y: 0.38 * h, w: 0.32 * w, h: 0.32 * w, stroke: OUTLINE, fill: DEVICE, width: W_OUT })
  specs.push({ shape: 'rect', x: 0.12 * w, y: base_y, w: 0.76 * w, h: 0.16 * h, stroke: 'none', fill: DEVICE, width: W_DET })
  specs.push({ shape: 'line', x1: 0.12 * w, y1: base_y + 0.16 * h, x2: 0.88 * w, y2: base_y + 0.16 * h, stroke: OUTLINE, width: W_OUT })
  return specs
}

// Tables
export const REFERENCE_MM = 1600
export const SIZES: Record<string, [number, number]> = { desktop: [160, 150], laptop: [180, 130], mobile: [110, 200], user: [140, 160], printer: [160, 160], server: [150, 220], database: [160, 180], storage: [170, 170], load_balancer: [200, 150], router: [170, 150], switch: [190, 150], firewall: [170, 170], modem: [150, 170], wifi_ap: [180, 150], cloud: [220, 160] }
export const LABELS: Record<string, string> = { desktop: 'Desktop', laptop: 'Laptop', mobile: 'Mobile', user: 'User', printer: 'Printer', server: 'Server', database: 'Database', storage: 'Storage', load_balancer: 'Load balancer', router: 'Router', switch: 'Switch', firewall: 'Firewall', modem: 'Modem', wifi_ap: 'Wi-Fi AP', cloud: 'Cloud' }
export const CATEGORIES: [string, string[]][] = [['Endpoints', ['desktop', 'laptop', 'mobile', 'user', 'printer']], ['Infrastructure', ['server', 'database', 'storage', 'load_balancer']], ['Network', ['router', 'switch', 'firewall', 'modem', 'wifi_ap', 'cloud']]]
export const BUILDERS: Record<string, (w: number, h: number) => Spec[]> = {
  desktop: build_desktop,
  laptop: build_laptop,
  mobile: build_mobile,
  user: build_user,
  printer: build_printer,
  server: build_server,
  database: build_database,
  storage: build_storage,
  load_balancer: build_load_balancer,
  router: build_router,
  switch: build_switch,
  firewall: build_firewall,
  modem: build_modem,
  wifi_ap: build_wifi_ap,
  cloud: build_cloud,
}
