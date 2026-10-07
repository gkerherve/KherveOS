// What the desktop's GLView paints with QPainter over the GL picture
// (glview._paint_overlay): element labels, the scene notes (a reaction's
// coefficients, plus signs and arrow) and the colour legend.

import { darker, lighter, luma } from './molrepr'
import type { LegendEntry } from './molcolor'
import { BG_TOP, rgb, type Scene } from './scene'
import type { Note } from './types'

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export interface LegendLayout {
  entries: LegendEntry[]
  r: number
  fpx: number
  width: number
}

/** GLView._legend: the colour key's layout for a (w, h) view, or null when off. */
export function legendLayout(ctx: CanvasRenderingContext2D, entries: LegendEntry[], on: boolean, w: number, h: number): LegendLayout | null {
  if (!on || !entries.length) return null
  const r = Math.max(7, Math.min(18, Math.min(w, h) * 0.028))
  const fpx = Math.max(9, Math.trunc(r * 1.3))
  ctx.font = `${fpx}px ${FONT}`
  const tw = Math.max(...entries.map((e) => ctx.measureText(e.label).width))
  return { entries, r, fpx, width: Math.min(r * 2.6 + tw + 24, w * 0.45) }
}

export function paintLegend(ctx: CanvasRenderingContext2D, lg: LegendLayout | null, w: number, h: number, top = BG_TOP) {
  if (!lg) return
  const { entries, r, fpx, width } = lg
  const x0 = w - width + 6
  const y0 = h * 0.06
  const t = rgb(top)
  const darkBg = (t[0] + t[1] + t[2]) / 3 < 0.45
  ctx.font = `${fpx}px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  entries.forEach((e, i) => {
    const cy = y0 + r + i * r * 2.8
    if (cy + r > h) return
    const cx = x0 + r
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 1.25)
    g.addColorStop(0, lighter(e.color, 190))
    g.addColorStop(0.45, e.color)
    g.addColorStop(1, darker(e.color, 190))
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = Math.max(0.8, r * 0.08)
    ctx.strokeStyle = darker(e.color, 230)
    ctx.stroke()
    ctx.fillStyle = darkBg ? '#e8edf2' : '#1a1a1a'
    ctx.fillText(e.label, x0 + r * 2.6, cy + fpx * 0.35)
  })
}

function paintArrow(ctx: CanvasRenderingContext2D, p1: [number, number], p2: [number, number], color: string, scale: number, double: boolean) {
  const [x1, y1] = p1, [x2, y2] = p2
  const dx = x2 - x1, dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const px = -dy / length, py = dx / length
  const w = Math.max(2, scale * 0.1)
  const head = Math.min(length * 0.35, w * 5)
  const offsets = double ? [-w * 1.3, w * 1.3] : [0]
  ctx.strokeStyle = color
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  offsets.forEach((off, k) => {
    let a: [number, number] = [x1 + px * off, y1 + py * off]
    let b: [number, number] = [x2 + px * off, y2 + py * off]
    if (k === 1) [a, b] = [b, a]
    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    for (const sgn of [-1, 1]) {
      ctx.moveTo(b[0], b[1])
      ctx.lineTo(b[0] - ux * head - sgn * uy * head * 0.55, b[1] - uy * head + sgn * ux * head * 0.55)
    }
    ctx.stroke()
  })
}

function paintTextNote(ctx: CanvasRenderingContext2D, sc: Scene, n: Note, az: number, el: number, ppa: number, w: number, h: number) {
  const text = String(n.text ?? '')
  if (!text) return
  const px = Math.max(6, Number(n.size ?? 1) * ppa)
  const [x, y] = sc.screenPoint(n.pos!, az, el, ppa, w, h)
  const color = n.color ?? '#22303c'
  ctx.font = `${n.bold === false ? '' : 'bold '}${Math.max(7, Math.round(px * 0.9))}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const c = rgb(color)
  const lightness = ((Math.max(...c) + Math.min(...c)) / 2) * 255
  if (lightness >= 150) {
    ctx.lineWidth = Math.max(1.6, px * 0.07)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.47)'
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.textAlign = 'left'
}

function paintLabels(ctx: CanvasRenderingContext2D, sc: Scene, az: number, el: number, ppa: number, w: number, h: number) {
  const n = sc.pos.length
  if (n === 0 || n > 400) return
  const pts = sc.screen(az, el, ppa, w, h)
  const order = [...pts.keys()].sort((a, b) => pts[a][2] - pts[b][2])
  ctx.textBaseline = 'alphabetic'
  for (const i of order) {
    const [sx, sy] = pts[i]
    const rp = sc.radii[i] * ppa
    if (rp < 5) continue
    const hit = sc.pickAtom(sx, sy, az, el, ppa, w, h)
    if (hit !== null && hit !== i) continue
    const size = Math.trunc(Math.max(8, Math.min(rp * 0.95, 26)))
    ctx.font = `bold ${size}px ${FONT}`
    const label = sc.elems[i]
    const ink = luma(sc.hex[i]) > 0.6 ? '#161616' : '#ffffff'
    const halo = ink === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.43)'
    const tw = ctx.measureText(label).width
    const x0 = sx - tw / 2
    const y0 = sy + (size * 0.72) / 2
    ctx.fillStyle = halo
    ctx.fillText(label, x0 + 1, y0 + 1)
    ctx.fillStyle = ink
    ctx.fillText(label, x0, y0)
  }
}

/** Everything painted over the GL image for a (w, h) target with the model at *ppa* px/Å. */
export function paintOverlay(ctx: CanvasRenderingContext2D, sc: Scene, o: { az: number; el: number; ppa: number; w: number; h: number; labels: boolean; legend: LegendLayout | null }) {
  const bw = o.legend ? o.w - o.legend.width : o.w
  if (o.labels) paintLabels(ctx, sc, o.az, o.el, o.ppa, bw, o.h)
  for (const n of sc.notes) {
    if (n.kind === 'text') paintTextNote(ctx, sc, n, o.az, o.el, o.ppa, bw, o.h)
    else {
      const p1 = sc.screenPoint(n.p1!, o.az, o.el, o.ppa, bw, o.h)
      const p2 = sc.screenPoint(n.p2!, o.az, o.el, o.ppa, bw, o.h)
      paintArrow(ctx, p1, p2, n.color ?? '#22303c', Number(n.size ?? 1) * o.ppa, !!n.double)
    }
  }
  paintLegend(ctx, o.legend, o.w, o.h)
}
