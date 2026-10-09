// Drawing of a kMotion frame on a 2-D canvas: shapes, grid, scale bar, trails, vectors, centre of mass, energy bars,
// the measuring tools and a simple perspective view for the 3-D scenes. Colours of the chrome come from the theme
// (passed in); the scenes' own colours are fixed and chosen to read on dark and light backgrounds.

import { fmt } from './common.ts'
import type { BodyInfo, Energy, Frame, Shape, View } from './types.ts'

export interface ThemeColors {
  bg: string
  text: string
  muted: string
  border: string
  accent: string
  surface: string
}

export interface Overlays {
  grid: boolean
  scaleBar: boolean
  trails: boolean
  velocity: boolean
  acceleration: boolean
  force: boolean
  com: boolean
  energy: boolean
  labels: boolean
}

export const DEFAULT_OVERLAYS: Overlays = { grid: true, scaleBar: true, trails: true, velocity: false, acceleration: false, force: false, com: false, energy: false, labels: true }

export interface Scales {
  velocity: number
  acceleration: number
  force: number
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }
export interface Protractor { v: [number, number]; a: [number, number] | null; b: [number, number] | null; /** The pointer, before the next arm is placed. */ hover: [number, number] | null }

export interface Measures {
  rulers: Segment[]
  live: Segment | null
  protractor: Protractor | null
}

export interface Camera3 {
  yaw: number
  pitch: number
}

/** Trails: world positions per body id. */
export class Trails {
  private map = new Map<string, number[]>()
  readonly max = 4000

  clear() { this.map.clear() }

  push(bodies: BodyInfo[], minDist: number) {
    for (const b of bodies) {
      if (b.trail === false) continue
      let a = this.map.get(b.id)
      if (!a) { a = []; this.map.set(b.id, a) }
      const n = a.length
      if (n >= 3 && Math.hypot(a[n - 3] - b.x, a[n - 2] - b.y, a[n - 1] - (b.z ?? 0)) < minDist) continue
      a.push(b.x, b.y, b.z ?? 0)
      if (a.length > 3 * this.max) a.splice(0, 3 * 200)
    }
  }

  get(id: string): number[] | undefined { return this.map.get(id) }
  ids(): string[] { return [...this.map.keys()] }
}

const SCREEN_MIN_R = 2.5

export const worldToScreen = (v: View, w: number, h: number, x: number, y: number): [number, number] => [w / 2 + (x - v.cx) * v.scale, h / 2 - (y - v.cy) * v.scale]
export const screenToWorld = (v: View, w: number, h: number, sx: number, sy: number): [number, number] => [v.cx + (sx - w / 2) / v.scale, v.cy - (sy - h / 2) / v.scale]

/** 1, 2, 5 × 10^n at least `min` large. */
export function niceStep(min: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(min)))
  for (const m of [1, 2, 5, 10]) if (m * e >= min) return m * e
  return 10 * e
}

export function fitView(b: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): View {
  const bw = Math.max(b.x1 - b.x0, 1e-9)
  const bh = Math.max(b.y1 - b.y0, 1e-9)
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.max(1e-6, Math.min(w / bw, h / bh)) }
}

// ------------------------------------------------------------------------------------------ primitives

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 2, head = 8) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const ux = dx / len
  const uy = dy / len
  const hs = Math.min(head, len * 0.6)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - ux * hs - uy * hs * 0.5, y2 - uy * hs + ux * hs * 0.5)
  ctx.lineTo(x2 - ux * hs + uy * hs * 0.5, y2 - uy * hs - ux * hs * 0.5)
  ctx.closePath()
  ctx.fill()
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 12, align: CanvasTextAlign = 'left') {
  ctx.font = `${size}px system-ui, sans-serif`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, v: View, w: number, h: number, th: ThemeColors, labels: boolean) {
  const P = (x: number, y: number) => worldToScreen(v, w, h, x, y)
  switch (s.t) {
    case 'circle': {
      const [x, y] = P(s.x, s.y)
      const r = Math.max(SCREEN_MIN_R, s.r * v.scale)
      if (x < -r || x > w + r || y < -r || y > h + r) return
      ctx.globalAlpha = s.alpha ?? 1
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (!s.ring) { ctx.fillStyle = s.fill; ctx.fill() } else { ctx.fillStyle = s.fill; ctx.globalAlpha = s.alpha ?? 0.15; ctx.fill(); ctx.globalAlpha = 1 }
      if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.ring ? 1.5 : 1; ctx.stroke() }
      ctx.globalAlpha = 1
      if (s.label && labels) label(ctx, s.label, x + r + 3, y, th.text)
      break
    }
    case 'line': {
      const [x1, y1] = P(s.x1, s.y1)
      const [x2, y2] = P(s.x2, s.y2)
      ctx.globalAlpha = s.alpha ?? 1
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.w ?? 1.5
      ctx.setLineDash(s.dash ? [5, 4] : [])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      break
    }
    case 'rect': {
      const [cx, cy] = P(s.x + s.w / 2, s.y + s.h / 2)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(-((s.angle ?? 0) * Math.PI) / 180)
      ctx.globalAlpha = s.alpha ?? 1
      const rw = s.w * v.scale
      const rh = s.h * v.scale
      if (s.fill) { ctx.fillStyle = s.fill; ctx.fillRect(-rw / 2, -rh / 2, rw, rh) }
      if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = 1; ctx.strokeRect(-rw / 2, -rh / 2, rw, rh) }
      ctx.restore()
      break
    }
    case 'poly': {
      if (s.pts.length < 2) return
      ctx.globalAlpha = s.alpha ?? 1
      ctx.beginPath()
      s.pts.forEach(([px, py], i) => { const [x, y] = P(px, py); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
      if (s.closed !== false && s.pts.length > 2) ctx.closePath()
      if (s.fill && s.closed !== false) { ctx.fillStyle = s.fill; ctx.fill() }
      if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.w ?? 1; ctx.lineJoin = 'round'; ctx.stroke() }
      ctx.globalAlpha = 1
      break
    }
    case 'path': {
      ctx.globalAlpha = s.alpha ?? 1
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.w ?? 1.5
      ctx.setLineDash(s.dash ? [5, 4] : [])
      ctx.beginPath()
      let pen = false
      for (const [px, py] of s.pts) {
        if (!Number.isFinite(px) || !Number.isFinite(py)) { pen = false; continue }
        const [x, y] = P(px, py)
        if (!pen) { ctx.moveTo(x, y); pen = true } else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      break
    }
    case 'spring': {
      const [x1, y1] = P(s.x1, s.y1)
      const [x2, y2] = P(s.x2, s.y2)
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy)
      if (len < 2) return
      const ux = dx / len
      const uy = dy / len
      const amp = s.amp * v.scale
      const lead = Math.min(len * 0.12, 14)
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 + ux * lead, y1 + uy * lead)
      const n = s.coils * 2
      const body = len - 2 * lead
      for (let i = 1; i <= n; i++) {
        const f = (i - 0.5) / n
        const sgn = i % 2 ? 1 : -1
        ctx.lineTo(x1 + ux * (lead + body * f) - uy * amp * sgn, y1 + uy * (lead + body * f) + ux * amp * sgn)
      }
      ctx.lineTo(x2 - ux * lead, y2 - uy * lead)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      break
    }
    case 'text': {
      const [x, y] = P(s.x, s.y)
      label(ctx, s.text, x, y, s.color ?? th.muted, 12 * (s.size ?? 1), s.align ?? 'left')
      break
    }
    case 'ground': {
      const [, y] = P(0, s.y)
      ctx.strokeStyle = th.muted
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1
      ctx.beginPath()
      const x0 = Math.max(P(s.x1, 0)[0], -20)
      const x1 = Math.min(P(s.x2, 0)[0], w + 20)
      for (let x = x0 - ((x0 % 14) + 14) % 14; x < x1; x += 14) { ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 8) }
      ctx.stroke()
      ctx.globalAlpha = 1
      break
    }
    case 'arrow': {
      const [x1, y1] = P(s.x1, s.y1)
      const [x2, y2] = P(s.x2, s.y2)
      arrow(ctx, x1, y1, x2, y2, s.color, s.w ?? 2, 9)
      if (s.label && labels) label(ctx, s.label, x2 + 4, y2, s.color)
      break
    }
  }
}

// ------------------------------------------------------------------------------------------ the whole picture

export interface DrawArgs {
  view: View
  frame: Frame
  overlays: Overlays
  scales: Scales
  theme: ThemeColors
  trails: Trails
  measures: Measures
  lengthUnit: string
  energy: Energy | null
  e0: number
  /** Extra shapes drawn on top (the sandbox's ghost while drawing). */
  ghost?: Shape[]
  selection?: Shape[]
  cam3?: Camera3 | null
  /** Largest speed, acceleration and force seen so far: the arrows are scaled from them. */
  ref: { v: number; a: number; f: number }
}

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const { view, frame, overlays, theme } = a
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, w, h)
  if (a.cam3) {
    draw3d(ctx, w, h, a)
    drawEnergy(ctx, w, a)
    return
  }
  if (overlays.grid) drawGrid(ctx, w, h, a)
  if (overlays.trails) drawTrails(ctx, w, h, a)
  for (const s of frame.shapes) drawShape(ctx, s, view, w, h, theme, overlays.labels)
  for (const s of a.selection ?? []) drawShape(ctx, s, view, w, h, theme, false)
  for (const s of a.ghost ?? []) drawShape(ctx, s, view, w, h, theme, false)
  drawVectors(ctx, w, h, a)
  if (overlays.com) drawCom(ctx, w, h, a)
  drawMeasures(ctx, w, h, a)
  if (overlays.scaleBar) drawScaleBar(ctx, h, a)
  drawEnergy(ctx, w, a)
  if (frame.banner) {
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(frame.banner).width
    ctx.fillStyle = theme.surface
    ctx.globalAlpha = 0.9
    ctx.fillRect(w / 2 - tw / 2 - 10, 10, tw + 20, 26)
    ctx.globalAlpha = 1
    ctx.fillStyle = theme.accent
    ctx.fillText(frame.banner, w / 2, 23)
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const { view, theme } = a
  const step = niceStep(70 / view.scale)
  const [x0, y1] = screenToWorld(view, w, h, 0, 0)
  const [x1, y0] = screenToWorld(view, w, h, w, h)
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.border
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const [sx] = worldToScreen(view, w, h, x, 0); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, h) }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const [, sy] = worldToScreen(view, w, h, 0, y); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(w, Math.round(sy) + 0.5) }
  ctx.stroke()
  ctx.globalAlpha = 0.9
  // the axes through the origin
  ctx.strokeStyle = theme.muted
  ctx.beginPath()
  const [ox, oy] = worldToScreen(view, w, h, 0, 0)
  if (ox > 0 && ox < w) { ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, h) }
  if (oy > 0 && oy < h) { ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(w, Math.round(oy) + 0.5) }
  ctx.globalAlpha = 0.35
  ctx.stroke()
  ctx.globalAlpha = 1
  // tick labels along the bottom and left edges
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillStyle = theme.muted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const lab = step * (view.scale * step < 90 ? 1 : 1)
  for (let x = Math.ceil(x0 / lab) * lab; x <= x1; x += lab) { const [sx] = worldToScreen(view, w, h, x, 0); ctx.fillText(fmt(x, 3), sx, h - 3) }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(y0 / lab) * lab; y <= y1; y += lab) { const [, sy] = worldToScreen(view, w, h, 0, y); ctx.fillText(fmt(y, 3), 4, sy - 7) }
}

function drawScaleBar(ctx: CanvasRenderingContext2D, h: number, a: DrawArgs) {
  const { view, theme } = a
  const len = niceStep(90 / view.scale)
  const px = len * view.scale
  const x = 14
  const y = h - 26
  ctx.strokeStyle = theme.text
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4)
  ctx.stroke()
  label(ctx, `${fmt(len, 3)} ${a.lengthUnit}`, x + px / 2, y - 10, theme.text, 11, 'center')
}

function drawTrails(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const { view, frame } = a
  for (const b of frame.bodies) {
    const t = a.trails.get(b.id)
    if (!t || t.length < 6 || b.trail === false) continue
    const n = t.length / 3
    const segs = 4
    ctx.lineWidth = 1.5
    ctx.strokeStyle = b.color
    for (let k = 0; k < segs; k++) {
      const i0 = Math.floor((n * k) / segs)
      const i1 = Math.min(n - 1, Math.floor((n * (k + 1)) / segs))
      ctx.globalAlpha = 0.18 + (0.7 * (k + 1)) / segs
      ctx.beginPath()
      for (let i = i0; i <= i1; i++) {
        const [sx, sy] = worldToScreen(view, w, h, t[3 * i], t[3 * i + 1])
        if (i === i0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

function drawVectors(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const { view, frame, overlays, scales, ref } = a
  if (!overlays.velocity && !overlays.acceleration && !overlays.force) return
  const target = 70
  for (const b of frame.bodies) {
    const [x, y] = worldToScreen(view, w, h, b.x, b.y)
    if (x < -50 || x > w + 50 || y < -50 || y > h + 50) continue
    if (overlays.velocity) {
      const k = (target / Math.max(ref.v, 1e-12)) * scales.velocity
      arrow(ctx, x, y, x + b.vx * k, y - b.vy * k, '#22c55e', 2)
    }
    if (overlays.acceleration) {
      const k = (target / Math.max(ref.a, 1e-12)) * scales.acceleration
      arrow(ctx, x, y, x + b.ax * k, y - b.ay * k, '#f43f5e', 2)
    }
    if (overlays.force && b.m > 0) {
      const k = (target / Math.max(ref.f, 1e-12)) * scales.force
      arrow(ctx, x, y, x + b.m * b.ax * k, y - b.m * b.ay * k, '#a855f7', 2.5)
    }
  }
  // legend
  let ly = 14
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const [on, col, name] of [[overlays.velocity, '#22c55e', 'velocity'], [overlays.acceleration, '#f43f5e', 'acceleration'], [overlays.force, '#a855f7', 'net force']] as const) {
    if (!on) continue
    ctx.fillStyle = col
    ctx.fillRect(12, ly - 4, 14, 3)
    ctx.fillStyle = a.theme.muted
    ctx.fillText(name, 32, ly)
    ly += 15
  }
}

function drawCom(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  let M = 0, cx = 0, cy = 0
  for (const b of a.frame.bodies) { M += b.m; cx += b.m * b.x; cy += b.m * b.y }
  if (M <= 0) return
  const [x, y] = worldToScreen(a.view, w, h, cx / M, cy / M)
  ctx.strokeStyle = a.theme.text
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, 6, 0, Math.PI * 2)
  ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10)
  ctx.stroke()
  label(ctx, 'CM', x + 10, y - 10, a.theme.text, 11)
}

function drawEnergy(ctx: CanvasRenderingContext2D, w: number, a: DrawArgs) {
  const e = a.energy
  if (!a.overlays.energy || !e) return
  const W = 150
  const H = 96
  const x0 = w - W - 10
  const y0 = 10
  ctx.globalAlpha = 0.9
  ctx.fillStyle = a.theme.surface
  ctx.fillRect(x0, y0, W, H)
  ctx.globalAlpha = 1
  ctx.strokeStyle = a.theme.border
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, W, H)
  const scale = Math.max(Math.abs(a.e0), Math.abs(e.ke), Math.abs(e.pe), Math.abs(e.total), 1e-12)
  const base = y0 + H * 0.62
  const barH = H * 0.42
  const items: [string, number, string][] = [['KE', e.ke, '#22c55e'], ['PE', e.pe, '#38bdf8'], ['Total', e.total, '#f59e0b']]
  ctx.strokeStyle = a.theme.muted
  ctx.beginPath(); ctx.moveTo(x0 + 6, base); ctx.lineTo(x0 + W - 6, base); ctx.stroke()
  items.forEach(([name, val, col], i) => {
    const bx = x0 + 14 + i * 46
    const bh = (val / scale) * barH
    ctx.fillStyle = col
    ctx.fillRect(bx, bh >= 0 ? base - bh : base, 30, Math.abs(bh))
    label(ctx, name, bx + 15, y0 + H - 8, a.theme.muted, 10, 'center')
    label(ctx, fmt(val, 3), bx + 15, bh >= 0 ? base - bh - 8 : base - bh + 9, a.theme.text, 10, 'center')
  })
}

function drawMeasures(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const { view, measures: m, theme } = a
  const seg = (s: Segment, live: boolean) => {
    const [x1, y1] = worldToScreen(view, w, h, s.x1, s.y1)
    const [x2, y2] = worldToScreen(view, w, h, s.x2, s.y2)
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    ctx.setLineDash(live ? [4, 3] : [])
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    ctx.setLineDash([])
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len > 20) {
      // ticks every nice step
      const dist = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
      const step = niceStep(12 / view.scale)
      const n = Math.min(200, Math.floor(dist / step))
      const nx = (y2 - y1) / len
      const ny = -(x2 - x1) / len
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= n; i++) { const f = (i * step) / dist; const px = x1 + (x2 - x1) * f; const py = y1 + (y2 - y1) * f; ctx.moveTo(px - nx * 4, py - ny * 4); ctx.lineTo(px + nx * 4, py + ny * 4) }
      ctx.stroke()
    }
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const text = `${fmt(Math.hypot(dx, dy), 4)} ${a.lengthUnit}   Δx ${fmt(dx, 3)}   Δy ${fmt(dy, 3)}   ${fmt((Math.atan2(dy, dx) * 180) / Math.PI, 4)}°`
    ctx.font = '11px system-ui, sans-serif'
    const tw = ctx.measureText(text).width
    const tx = (x1 + x2) / 2
    const ty = (y1 + y2) / 2 - 14
    ctx.fillStyle = theme.surface
    ctx.globalAlpha = 0.9
    ctx.fillRect(tx - tw / 2 - 4, ty - 8, tw + 8, 16)
    ctx.globalAlpha = 1
    label(ctx, text, tx, ty, theme.text, 11, 'center')
  }
  for (const s of m.rulers) seg(s, false)
  if (m.live) seg(m.live, true)
  const p = m.protractor
  if (p) {
    const [vx, vy] = worldToScreen(view, w, h, p.v[0], p.v[1])
    ctx.fillStyle = '#f59e0b'
    ctx.beginPath(); ctx.arc(vx, vy, 3.5, 0, Math.PI * 2); ctx.fill()
    const arm = (q: [number, number] | null) => {
      if (!q) return
      const [x, y] = worldToScreen(view, w, h, q[0], q[1])
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(x, y); ctx.stroke()
    }
    const second = p.b ?? (p.a ? p.hover : null)
    const first = p.a ?? p.hover
    arm(first)
    if (p.a) arm(second)
    if (first && second && p.a) {
      const a1 = Math.atan2(first[1] - p.v[1], first[0] - p.v[0])
      const a2 = Math.atan2(second[1] - p.v[1], second[0] - p.v[0])
      let d = a2 - a1
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      ctx.strokeStyle = '#f59e0b'
      ctx.beginPath(); ctx.arc(vx, vy, 28, -a1, -a2, d > 0); ctx.stroke()
      const mid = a1 + d / 2
      label(ctx, `${fmt(Math.abs(d) * 180 / Math.PI, 4)}°`, vx + Math.cos(mid) * 46, vy - Math.sin(mid) * 46, theme.text, 12, 'center')
    }
  }
}

// ------------------------------------------------------------------------------------------ 3-D view

export function project3(cam: Camera3, x: number, y: number, z: number): [number, number, number] {
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const x1 = x * cy - y * sy
  const y1 = x * sy + y * cy
  // tilt about the x axis: pitch 0 looks along the y axis (side view), pi/2 looks down the z axis (top view)
  const yy = y1 * sp + z * cp
  const depth = y1 * cp - z * sp
  return [x1, yy, depth]
}

function draw3d(ctx: CanvasRenderingContext2D, w: number, h: number, a: DrawArgs) {
  const cam = a.cam3!
  const { view, frame, theme } = a
  const P = (x: number, y: number, z: number): [number, number, number] => {
    const [px, py, d] = project3(cam, x, y, z)
    const [sx, sy] = worldToScreen(view, w, h, px, py)
    return [sx, sy, d]
  }
  // ground circle and axes
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.border
  for (let r = 1; r <= 4; r++) {
    const step = niceStep(70 / view.scale) * r
    ctx.beginPath()
    for (let i = 0; i <= 64; i++) { const [sx, sy] = P(step * Math.cos((i / 64) * 2 * Math.PI), step * Math.sin((i / 64) * 2 * Math.PI), 0); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy) }
    ctx.globalAlpha = 0.4
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const axis = niceStep(110 / view.scale)
  for (const [vec, name, col] of [[[axis, 0, 0], 'x', '#f87171'], [[0, axis, 0], 'y', '#4ade80'], [[0, 0, axis], 'z', '#60a5fa']] as const) {
    const [o1, o2] = P(0, 0, 0)
    const [e1, e2] = P(vec[0], vec[1], vec[2])
    ctx.strokeStyle = col; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(o1, o2); ctx.lineTo(e1, e2); ctx.stroke()
    label(ctx, name, e1 + 4, e2, col, 11)
  }
  if (a.overlays.trails) {
    for (const b of frame.bodies) {
      const t = a.trails.get(b.id)
      if (!t || t.length < 6 || b.trail === false) continue
      ctx.strokeStyle = b.color
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1.2
      ctx.beginPath()
      for (let i = 0; i < t.length / 3; i++) { const [sx, sy] = P(t[3 * i], t[3 * i + 1], t[3 * i + 2]); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy) }
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  const pts = frame.bodies.map((b) => ({ b, p: P(b.x, b.y, b.z ?? 0) })).sort((u, v) => v.p[2] - u.p[2])
  for (const { b, p } of pts) {
    const r = Math.max(SCREEN_MIN_R, (b.r ?? 0.02) * view.scale)
    ctx.fillStyle = b.color
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill()
    if (a.overlays.labels && b.name) label(ctx, b.name, p[0] + r + 3, p[1], theme.text, 11)
  }
  label(ctx, 'drag to rotate · wheel to zoom', 12, 14, theme.muted, 11)
}
