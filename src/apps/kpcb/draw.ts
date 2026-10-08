// Drawing the board on a 2D canvas (no React): layers in KiCad-like colours, grid, ratsnest, DRC
// markers, selection, ghost part, route preview. Also renders the images of the PNG export and the
// textures of the 3D view.

import type { Box, Pt } from './geom.ts'
import { polyBox } from './geom.ts'
import type { RatLine } from './analysis.ts'
import { layerPrims, SCHEMES, viewItems } from './layers.ts'
import type { Prim, Scheme, ViewItem } from './layers.ts'
import { partCourtyard, partSilk, trackShape, worldPads } from './board.ts'
import type { WorldPad } from './board.ts'
import { LAYERS } from './types.ts'
import type { CopperId, Design, Fills, LayerId, Part, Violation } from './types.ts'

export const DEFAULT_COLORS: Record<LayerId, string> = {
  'F.Cu': '#c83434',
  'B.Cu': '#4d7fc4',
  'F.Silk': '#f2eda1',
  'B.Silk': '#e8b2a7',
  'F.Mask': '#d864d8',
  'B.Mask': '#02c202',
  'F.Paste': '#9a9a9a',
  'B.Paste': '#6aa0c0',
  'Edge.Cuts': '#d0d2cd',
  Courtyard: '#ff26e2',
  Drill: '#c2c200',
}

export const LAYER_LABELS: Record<LayerId, string> = {
  'F.Cu': 'F.Cu (top copper)',
  'B.Cu': 'B.Cu (bottom copper)',
  'F.Silk': 'F.Silk (top silkscreen)',
  'B.Silk': 'B.Silk (bottom silkscreen)',
  'F.Mask': 'F.Mask (top solder mask)',
  'B.Mask': 'B.Mask (bottom solder mask)',
  'F.Paste': 'F.Paste (top paste)',
  'B.Paste': 'B.Paste (bottom paste)',
  'Edge.Cuts': 'Edge.Cuts (board outline)',
  Courtyard: 'Courtyard',
  Drill: 'Drill holes',
}

export interface View {
  cx: number
  cy: number
  /** Pixels per mm. */
  scale: number
  /** Seen from the bottom: mirrored left to right. */
  flip: boolean
}

export interface Appearance {
  colors: Record<LayerId, string>
  visible: Record<LayerId, boolean>
  /** Dim every layer but the active one. */
  dim: boolean
  ratsnest: boolean
  markers: boolean
  padNumbers: boolean
  grid: boolean
}

export const DEFAULT_APPEARANCE: Appearance = {
  colors: { ...DEFAULT_COLORS },
  visible: Object.fromEntries(LAYERS.map((l) => [l, l !== 'F.Paste' && l !== 'B.Paste' && l !== 'Courtyard' && l !== 'F.Mask' && l !== 'B.Mask'])) as Record<LayerId, boolean>,
  dim: false,
  ratsnest: true,
  markers: true,
  padNumbers: true,
  grid: true,
}

export interface Scene {
  design: Design
  fills: Fills
  /** "kind:id" of the selected items. */
  sel: ReadonlySet<string>
  hoverNet: string
  ratsnest: readonly RatLine[]
  markers: readonly Violation[]
  active: CopperId
  grid: number
  unit: 'mm' | 'mil'
}

export interface Overlay {
  cursor: Pt | null
  ghost?: Part | null
  route?: { segs: Array<[Pt, Pt]>; layer: CopperId; width: number; bad: boolean; from: Pt } | null
  draft?: { pts: Pt[]; closed?: boolean; color: string } | null
  measure?: { a: Pt; b: Pt } | null
  box?: Box | null
  handles?: Pt[]
  selectedMarker?: string | null
}

export const ink = '#00e5ff'

// ------------------------------------------------------------ helpers

export function toScreen(v: View, w: number, h: number, p: Pt): Pt {
  const fx = v.flip ? -1 : 1
  return { x: w / 2 + fx * (p.x - v.cx) * v.scale, y: h / 2 + (p.y - v.cy) * v.scale }
}

export function toWorldPt(v: View, w: number, h: number, s: Pt): Pt {
  const fx = v.flip ? -1 : 1
  return { x: v.cx + ((s.x - w / 2) * fx) / v.scale, y: v.cy + (s.y - h / 2) / v.scale }
}

function lighten(hex: string, amt = 0.35): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amt)
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`
}

const primCache = new WeakMap<Design, { fills: Fills; map: Map<LayerId, Prim[]> }>()

function primsOf(d: Design, fills: Fills, layer: LayerId): Prim[] {
  let e = primCache.get(d)
  if (!e || e.fills !== fills) {
    e = { fills, map: new Map() }
    primCache.set(d, e)
  }
  let p = e.map.get(layer)
  if (!p) {
    p = layerPrims(d, layer, fills)
    e.map.set(layer, p)
  }
  return p
}

function flashPath(g: CanvasRenderingContext2D, p: Extract<Prim, { k: 'flash' }>) {
  if (p.shape === 'circle') {
    g.moveTo(p.x + p.w / 2, p.y)
    g.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2)
    return
  }
  g.save()
  g.translate(p.x, p.y)
  g.rotate((-p.rot * Math.PI) / 180)
  const rr = p.shape === 'oval' ? Math.min(p.w, p.h) / 2 : p.shape === 'roundrect' ? Math.min(p.w, p.h) * p.rr : 0
  if (rr > 0) g.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, rr)
  else g.rect(-p.w / 2, -p.h / 2, p.w, p.h)
  g.restore()
}

/** Paint primitives in one colour; with a net to highlight the others fade. */
export function paintPrims(g: CanvasRenderingContext2D, prims: readonly Prim[], color: string, alpha: number, hoverNet = '') {
  g.fillStyle = color
  g.strokeStyle = color
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const layerAlpha = (net: string | undefined) => (hoverNet ? (net === hoverNet ? 1 : alpha * 0.3) : alpha)
  const hot = hoverNet ? lighten(color) : color
  // regions
  for (const p of prims) {
    if (p.k !== 'region') continue
    g.globalAlpha = layerAlpha(p.net) * 0.85
    g.fillStyle = hoverNet && p.net === hoverNet ? hot : color
    g.beginPath()
    for (const r of [p.outer, ...p.holes]) {
      g.moveTo(r[0].x, r[0].y)
      for (let i = 1; i < r.length; i++) g.lineTo(r[i].x, r[i].y)
      g.closePath()
    }
    g.fill('evenodd')
  }
  // strokes grouped by width and highlight state
  const groups = new Map<string, Array<Extract<Prim, { k: 'seg' }>>>()
  for (const p of prims) {
    if (p.k !== 'seg') continue
    const key = `${p.w}|${hoverNet && p.net === hoverNet ? 1 : 0}|${hoverNet && p.net !== hoverNet ? 1 : 0}`
    const l = groups.get(key)
    if (l) l.push(p)
    else groups.set(key, [p])
  }
  for (const [key, list] of groups) {
    const [w, isHot, isDim] = key.split('|')
    g.globalAlpha = isDim === '1' ? alpha * 0.3 : alpha
    g.strokeStyle = isHot === '1' ? hot : color
    g.lineWidth = Number(w)
    g.beginPath()
    for (const p of list) {
      g.moveTo(p.a.x, p.a.y)
      g.lineTo(p.b.x, p.b.y)
    }
    g.stroke()
  }
  // flashes
  const fl = { hot: [] as Prim[], norm: [] as Prim[], dim: [] as Prim[] }
  for (const p of prims) {
    if (p.k !== 'flash') continue
    if (hoverNet && p.net === hoverNet) fl.hot.push(p)
    else if (hoverNet) fl.dim.push(p)
    else fl.norm.push(p)
  }
  for (const [list, a, c] of [[fl.norm, alpha, color], [fl.dim, alpha * 0.3, color], [fl.hot, 1, hot]] as const) {
    if (!list.length) continue
    g.globalAlpha = a
    g.fillStyle = c
    g.beginPath()
    for (const p of list) if (p.k === 'flash') flashPath(g, p)
    g.fill()
  }
  g.globalAlpha = 1
}

function polyPath(g: CanvasRenderingContext2D, pts: readonly Pt[], close = true) {
  g.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
  if (close) g.closePath()
}

/** Which grid spacing to draw so dots are at least `minPx` apart. */
export function gridStep(grid: number, scale: number, minPx = 7): number {
  let s = grid
  while (s * scale < minPx) s *= s * 5 * scale < minPx * 5 ? 10 : 5
  return s
}

// ------------------------------------------------------------ the scene

export function drawScene(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, v: View, sc: Scene, ap: Appearance, ov: Overlay) {
  const d = sc.design
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = '#0b0f14'
  g.fillRect(0, 0, w, h)
  const fx = v.flip ? -1 : 1
  const s = v.scale
  g.setTransform(dpr * s * fx, 0, 0, dpr * s, dpr * (w / 2 - fx * v.cx * s), dpr * (h / 2 - v.cy * s))
  const px = 1 / s // one screen pixel in mm

  // board
  if (d.outline.pts.length >= 3) {
    g.beginPath()
    polyPath(g, d.outline.pts)
    g.fillStyle = '#10171f'
    g.fill()
  }

  // grid
  if (ap.grid) {
    const step = gridStep(sc.grid, s)
    const tl = toWorldPt(v, w, h, { x: 0, y: 0 })
    const br = toWorldPt(v, w, h, { x: w, y: h })
    const x0 = Math.floor(Math.min(tl.x, br.x) / step) * step
    const x1 = Math.max(tl.x, br.x)
    const y0 = Math.floor(Math.min(tl.y, br.y) / step) * step
    const y1 = Math.max(tl.y, br.y)
    g.fillStyle = 'rgba(160,190,220,0.35)'
    g.beginPath()
    const r = Math.max(px * 0.7, 0)
    if ((x1 - x0) / step * ((y1 - y0) / step) < 40000) {
      for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) g.rect(x - r, y - r, 2 * r, 2 * r)
      g.fill()
    }
    // origin
    g.strokeStyle = 'rgba(255,255,255,0.3)'
    g.lineWidth = px
    g.beginPath()
    g.moveTo(-6 * px, 0)
    g.lineTo(6 * px, 0)
    g.moveTo(0, -6 * px)
    g.lineTo(0, 6 * px)
    g.stroke()
  }

  const vis = (l: LayerId) => ap.visible[l]
  const dimA = (l: LayerId) => (!ap.dim || l === sc.active || l === 'Edge.Cuts' ? 1 : l === 'F.Cu' || l === 'B.Cu' ? 0.22 : 0.35)
  const copperOrder: CopperId[] = sc.active === 'F.Cu' ? ['B.Cu', 'F.Cu'] : ['F.Cu', 'B.Cu']

  // zones' outlines (below copper)
  for (const z of d.zones) {
    if (!vis(z.layer)) continue
    g.beginPath()
    polyPath(g, z.pts)
    g.strokeStyle = ap.colors[z.layer]
    g.globalAlpha = 0.5 * dimA(z.layer)
    g.lineWidth = px * 1.2
    g.setLineDash([px * 5, px * 4])
    g.stroke()
    g.setLineDash([])
    g.globalAlpha = 1
  }

  for (const l of copperOrder) {
    if (!vis(l)) continue
    paintPrims(g, primsOf(d, sc.fills, l), ap.colors[l], dimA(l), sc.hoverNet)
  }
  for (const l of ['B.Mask', 'F.Mask', 'B.Paste', 'F.Paste'] as const) {
    if (!vis(l)) continue
    paintPrims(g, primsOf(d, sc.fills, l), ap.colors[l], 0.45 * dimA(l))
  }
  for (const l of ['B.Silk', 'F.Silk'] as const) {
    if (vis(l)) paintPrims(g, primsOf(d, sc.fills, l), ap.colors[l], dimA(l))
  }
  if (vis('Courtyard')) paintPrims(g, primsOf(d, sc.fills, 'Courtyard'), ap.colors.Courtyard, 0.8)

  // drill holes
  if (vis('Drill')) {
    const dr = primsOf(d, sc.fills, 'Drill')
    paintPrims(g, dr, '#0b0f14', 1)
    g.strokeStyle = ap.colors.Drill
    g.lineWidth = px * 0.8
    g.beginPath()
    for (const p of dr) {
      if (p.k !== 'flash') continue
      g.moveTo(p.x + p.w / 2, p.y)
      g.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2)
    }
    g.stroke()
  }

  // ratsnest
  if (ap.ratsnest && sc.ratsnest.length) {
    g.lineWidth = px * 1.1
    for (const r of sc.ratsnest) {
      g.strokeStyle = sc.hoverNet && r.net === sc.hoverNet ? '#ffffff' : 'rgba(225,235,245,0.55)'
      g.beginPath()
      g.moveTo(r.a.x, r.a.y)
      g.lineTo(r.b.x, r.b.y)
      g.stroke()
    }
  }

  // board edge on top
  if (vis('Edge.Cuts')) paintPrims(g, primsOf(d, sc.fills, 'Edge.Cuts'), ap.colors['Edge.Cuts'], 1)

  // ghost part
  if (ov.ghost) drawPartGhost(g, ov.ghost, ap, px)

  // selection
  drawSelection(g, d, sc.sel, px)
  if (ov.handles) {
    g.fillStyle = ink
    for (const p of ov.handles) g.fillRect(p.x - 4 * px, p.y - 4 * px, 8 * px, 8 * px)
  }

  // route preview
  if (ov.route) {
    const r = ov.route
    g.strokeStyle = r.bad ? '#ff3b3b' : ap.colors[r.layer]
    g.globalAlpha = 0.9
    g.lineCap = 'round'
    g.lineWidth = r.width
    g.beginPath()
    for (const [a, b] of r.segs) {
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
    }
    g.stroke()
    if (r.bad) {
      g.strokeStyle = 'rgba(255,60,60,0.45)'
      g.lineWidth = r.width + 2 * d.rules.clearance
      g.beginPath()
      for (const [a, b] of r.segs) {
        g.moveTo(a.x, a.y)
        g.lineTo(b.x, b.y)
      }
      g.stroke()
    }
    g.globalAlpha = 1
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(r.from.x, r.from.y, 3 * px, 0, Math.PI * 2)
    g.fill()
  }

  // polygon being drawn
  if (ov.draft && ov.draft.pts.length) {
    g.strokeStyle = ov.draft.color
    g.lineWidth = px * 1.5
    g.setLineDash([px * 6, px * 4])
    g.beginPath()
    polyPath(g, ov.draft.pts, !!ov.draft.closed)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = ov.draft.color
    for (const p of ov.draft.pts) g.fillRect(p.x - 3 * px, p.y - 3 * px, 6 * px, 6 * px)
  }

  // rubber band
  if (ov.box) {
    g.fillStyle = 'rgba(0,229,255,0.1)'
    g.strokeStyle = ink
    g.lineWidth = px
    g.fillRect(ov.box.x0, ov.box.y0, ov.box.x1 - ov.box.x0, ov.box.y1 - ov.box.y0)
    g.strokeRect(ov.box.x0, ov.box.y0, ov.box.x1 - ov.box.x0, ov.box.y1 - ov.box.y0)
  }

  // measure
  if (ov.measure) {
    const { a, b } = ov.measure
    g.strokeStyle = '#ffd24a'
    g.lineWidth = px * 1.5
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, a.y)
    g.lineTo(b.x, b.y)
    g.setLineDash([px * 4, px * 4])
    g.stroke()
    g.setLineDash([])
  }

  // crosshair
  if (ov.cursor) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = px
    g.beginPath()
    g.moveTo(ov.cursor.x, ov.cursor.y - 10000)
    g.lineTo(ov.cursor.x, ov.cursor.y + 10000)
    g.moveTo(ov.cursor.x - 10000, ov.cursor.y)
    g.lineTo(ov.cursor.x + 10000, ov.cursor.y)
    g.stroke()
  }

  // screen-space labels and markers
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (ap.padNumbers && s >= 22) drawPadLabels(g, d, v, w, h, s)
  if (ap.markers) {
    for (const m of sc.markers) {
      const p = toScreen(v, w, h, m)
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue
      const color = m.severity === 'error' ? '#ff4040' : '#ffc233'
      const sel = ov.selectedMarker === m.id
      g.strokeStyle = color
      g.lineWidth = sel ? 3 : 2
      const rad = sel ? 14 : 9
      g.beginPath()
      g.arc(p.x, p.y, rad, 0, Math.PI * 2)
      g.moveTo(p.x - rad * 0.55, p.y - rad * 0.55)
      g.lineTo(p.x + rad * 0.55, p.y + rad * 0.55)
      g.moveTo(p.x + rad * 0.55, p.y - rad * 0.55)
      g.lineTo(p.x - rad * 0.55, p.y + rad * 0.55)
      g.stroke()
    }
  }
  if (ov.measure) {
    const { a, b } = ov.measure
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    const m = toScreen(v, w, h, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    const f = (mm: number) => (sc.unit === 'mil' ? `${(mm / 0.0254).toFixed(1)} mil` : `${mm.toFixed(3)} mm`)
    const label = `${f(dist)}   dx ${f(dx)}   dy ${f(dy)}   ${((Math.atan2(-dy, dx) * 180) / Math.PI).toFixed(1)}°`
    g.font = '12px ui-monospace, Menlo, monospace'
    const tw = g.measureText(label).width
    g.fillStyle = 'rgba(0,0,0,0.75)'
    g.fillRect(m.x - tw / 2 - 5, m.y - 22, tw + 10, 20)
    g.fillStyle = '#ffd24a'
    g.fillText(label, m.x - tw / 2, m.y - 8)
  }
}

function drawPartGhost(g: CanvasRenderingContext2D, part: Part, ap: Appearance, px: number) {
  g.globalAlpha = 0.65
  const cu: CopperId = part.side === 'F' ? 'F.Cu' : 'B.Cu'
  for (const pad of worldPads(part)) {
    g.fillStyle = ap.colors[pad.layers.includes('F.Cu') ? 'F.Cu' : cu]
    g.beginPath()
    flashPath(g, { k: 'flash', x: pad.x, y: pad.y, shape: pad.def.shape === 'round' ? (Math.abs(pad.w - pad.h) < 1e-9 ? 'circle' : 'oval') : pad.def.shape, w: pad.w, h: pad.h, rot: pad.rot, rr: pad.def.rr ?? 0.25 })
    g.fill()
  }
  g.strokeStyle = ap.colors[part.side === 'F' ? 'F.Silk' : 'B.Silk']
  g.lineWidth = 0.12
  g.beginPath()
  for (const [a, b] of partSilk(part)) {
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
  }
  g.stroke()
  g.strokeStyle = ap.colors.Courtyard
  g.lineWidth = px
  g.beginPath()
  polyPath(g, partCourtyard(part))
  g.stroke()
  g.globalAlpha = 1
}

function drawSelection(g: CanvasRenderingContext2D, d: Design, sel: ReadonlySet<string>, px: number) {
  if (!sel.size) return
  g.strokeStyle = ink
  g.lineWidth = 2 * px
  g.lineJoin = 'round'
  g.beginPath()
  for (const p of d.parts) {
    if (!sel.has(`part:${p.id}`)) continue
    polyPath(g, partCourtyard(p))
  }
  g.stroke()
  g.lineWidth = px
  for (const t of d.tracks) {
    if (!sel.has(`track:${t.id}`)) continue
    const s = trackShape(t)
    // an outline around the capsule
    const dx = t.x2 - t.x1
    const dy = t.y2 - t.y1
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * s.r
    const ny = (dx / len) * s.r
    g.beginPath()
    const a = Math.atan2(dy, dx)
    g.arc(t.x2, t.y2, s.r, a - Math.PI / 2, a + Math.PI / 2)
    g.lineTo(t.x1 - nx, t.y1 - ny)
    g.arc(t.x1, t.y1, s.r, a + Math.PI / 2, a + Math.PI * 1.5)
    g.lineTo(t.x2 + nx, t.y2 + ny)
    g.closePath()
    g.lineWidth = 1.5 * px
    g.stroke()
  }
  g.beginPath()
  for (const v of d.vias) {
    if (!sel.has(`via:${v.id}`)) continue
    g.moveTo(v.x + v.d / 2 + px * 2, v.y)
    g.arc(v.x, v.y, v.d / 2 + px * 2, 0, Math.PI * 2)
  }
  for (const h of d.holes) {
    if (!sel.has(`hole:${h.id}`)) continue
    g.moveTo(h.x + h.d / 2 + px * 2, h.y)
    g.arc(h.x, h.y, h.d / 2 + px * 2, 0, Math.PI * 2)
  }
  g.lineWidth = 1.5 * px
  g.stroke()
  for (const z of d.zones) {
    if (!sel.has(`zone:${z.id}`)) continue
    g.beginPath()
    polyPath(g, z.pts)
    g.lineWidth = 2 * px
    g.stroke()
  }
  if (sel.has('outline:outline') && d.outline.pts.length >= 3) {
    g.beginPath()
    polyPath(g, d.outline.pts)
    g.lineWidth = 2 * px
    g.stroke()
  }
}

function drawPadLabels(g: CanvasRenderingContext2D, d: Design, v: View, w: number, h: number, s: number) {
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const size = Math.max(8, Math.min(13, s * 0.45))
  g.font = `${size}px system-ui, sans-serif`
  const nets = new Map<string, string>()
  for (const n of d.nets) for (const p of n.pins) nets.set(`${p.ref}.${p.pin}`, n.name)
  for (const part of d.parts) {
    for (const pad of worldPads(part) as WorldPad[]) {
      if (pad.w * s < 9 || pad.h * s < 9) continue
      const p = toScreen(v, w, h, pad)
      if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue
      const net = nets.get(pad.label)
      g.fillStyle = 'rgba(255,255,255,0.92)'
      if (net && pad.w * s > 22 && s >= 40) {
        g.fillText(pad.n, p.x, p.y - size * 0.55)
        g.fillStyle = 'rgba(255,230,120,0.95)'
        g.font = `${Math.max(7, size - 2)}px system-ui, sans-serif`
        g.fillText(net.length > 6 ? net.slice(0, 6) : net, p.x, p.y + size * 0.6)
        g.font = `${size}px system-ui, sans-serif`
      } else g.fillText(pad.n, p.x, p.y)
    }
  }
  g.textAlign = 'start'
  g.textBaseline = 'alphabetic'
}

// ------------------------------------------------------------ images

/** Draw a top or bottom view (the items of viewItems) so `box` fills the canvas. */
export function drawView(g: CanvasRenderingContext2D, items: readonly ViewItem[], box: Box, width: number, height: number, flip: boolean, bg: string) {
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.fillStyle = bg
  g.fillRect(0, 0, width, height)
  const sx = width / (box.x1 - box.x0)
  const sy = height / (box.y1 - box.y0)
  g.setTransform(flip ? -sx : sx, 0, 0, sy, flip ? width + box.x0 * sx : -box.x0 * sx, -box.y0 * sy)
  for (const it of items) {
    if (it.kind === 'board') {
      g.fillStyle = it.color
      g.beginPath()
      for (const p of it.prims) if (p.k === 'region') polyPath(g, p.outer)
      g.fill()
    } else paintPrims(g, it.prims, it.color, 1)
  }
}

/** A PNG-ready canvas of the top or bottom. `ppmm` pixels per millimetre. */
export function renderBoardCanvas(d: Design, fills: Fills | undefined, side: 'F' | 'B', scheme: Scheme, ppmm: number, margin = 1.5): HTMLCanvasElement {
  const pts = d.outline.pts.length >= 3 ? d.outline.pts : [{ x: 0, y: 0 }, { x: 50, y: 50 }]
  const b = polyBox(pts)
  const box: Box = { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin }
  const w = Math.max(16, Math.round((box.x1 - box.x0) * ppmm))
  const h = Math.max(16, Math.round((box.y1 - box.y0) * ppmm))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  drawView(g, viewItems(d, fills, side, scheme), box, w, h, side === 'B', SCHEMES[scheme].bg)
  return canvas
}

/** The texture of one side of the board for the 3D view (not mirrored: seen from outside it reads right). */
export function renderTexture(d: Design, fills: Fills | undefined, side: 'F' | 'B', box: Box, ppmm: number): HTMLCanvasElement {
  const w = Math.max(16, Math.round((box.x1 - box.x0) * ppmm))
  const h = Math.max(16, Math.round((box.y1 - box.y0) * ppmm))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  drawView(canvas.getContext('2d')!, viewItems(d, fills, side, 'board'), box, w, h, false, SCHEMES.board.board)
  return canvas
}
