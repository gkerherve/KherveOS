// The 2D sketch view: the desktop SketchScene's items (shapes with their
// handles, part outlines in their own colours, the drawing tool's draft) and
// SketchView's grid, axes, origin gizmo, scale bar and dimensions, drawn on a
// canvas. Left / right mouse go to the desktop scene (select, move, resize,
// draw, measure); the middle button pans and the wheel zooms here (Y up).

import { useEffect, useRef } from 'react'
import { floatsFromBase64 } from './meshio'
import { qtKey } from './keys'
import { sketchBar } from './view3dmath'
import type { Node, SketchItem, SketchState, UiEvent } from './types'
import { QtNode } from './qt/QtNode'

export interface SketchView {
  sx: number
  sy: number
  cx: number
  cy: number
}

const AXIS = ['#d64545', '#3f9e4d', '#3a6fd8']
const PLANES: Record<string, [number, number]> = { 'Top (XY)': [0, 1], 'Front (XZ)': [0, 2], 'Side (YZ)': [1, 2] }
const HANDLE = 9
const MIN_ZOOM = 0.001
const MAX_ZOOM = 400

const CURSORS: Record<number, string> = {
  0: 'default', 2: 'crosshair', 5: 'ns-resize', 6: 'ew-resize', 7: 'nesw-resize', 8: 'nwse-resize', 9: 'move', 13: 'pointer', 17: 'grab', 18: 'grabbing',
}

/** '#rrggbbaa' → css rgba. */
function css(c: string | null | undefined, alpha = 1): string {
  if (!c) return 'transparent'
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(c)
  if (!m) return c
  const a = (m[4] ? parseInt(m[4], 16) / 255 : 1) * alpha
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a.toFixed(3)})`
}

/** A tidy length (units.length): no trailing zeros. */
function fmtLen(v: number, unit: string): string {
  const t = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)
  return `${t.replace(/\.?0+$/, '')} ${unit}`
}

/** Item geometry in scene coordinates, children with their parent's offset. */
function walk(items: SketchItem[], ox: number, oy: number, out: [SketchItem, number, number][]) {
  const sorted = [...items].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  for (const it of sorted) {
    if (it.hid) continue
    const x = ox + it.x
    const y = oy + it.y
    out.push([it, x, y])
    if (it.kids) walk(it.kids, x, y, out)
  }
  return out
}

/** The local rect (scene units) of a shape — for auto dimensions. */
function geometryRect(it: SketchItem): [number, number, number, number] | null {
  const g = it.g
  if ((it.k === 'rect' || it.k === 'ellipse') && g) return [g[0], g[1], g[0] + g[2], g[1] + g[3]]
  if (it.k === 'poly' && g && g.length >= 4) {
    const xs = g.filter((_, i) => i % 2 === 0)
    const ys = g.filter((_, i) => i % 2 === 1)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  if (it.k === 'path' && (it.path || it.faces)) {
    const pts = floatsFromBase64((it.path ?? it.faces)!.pts)
    if (!pts.length) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i])
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1])
    }
    return [x0, y0, x1, y1]
  }
  return null
}

interface Props {
  state: SketchState
  view: SketchView
  viewRev: number
  node: Node
  send: (ev: UiEvent) => void
}

export function Sketch({ state, view, viewRev, node, send }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const v = useRef<SketchView & { w: number; h: number }>({ ...view, w: 800, h: 400 })
  const stRef = useRef(state)
  stRef.current = state
  const sendRef = useRef(send)
  sendRef.current = send
  const frame = useRef(0)

  // Python moved the view (zoom to selection, fit, nav buttons)
  useEffect(() => {
    v.current = { ...v.current, ...view }
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRev])

  useEffect(() => {
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      v.current.w = Math.max(1, Math.round(r.width))
      v.current.h = Math.max(1, Math.round(r.height))
      const cv = canvas.current
      if (cv) {
        const dpr = window.devicePixelRatio || 1
        cv.width = v.current.w * dpr
        cv.height = v.current.h * dpr
      }
      report()
      redraw()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const report = () => {
    const c = v.current
    sendRef.current({ op: 'sk_view', sx: c.sx, sy: c.sy, cx: c.cx, cy: c.cy, w: c.w, h: c.h })
  }

  const toScreen = (x: number, y: number): [number, number] => {
    const c = v.current
    return [c.w / 2 + (x - c.cx) * c.sx, c.h / 2 + (y - c.cy) * c.sy]
  }

  const redraw = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(paint)
  }

  const paint = () => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const c = v.current
    const s = stRef.current
    const tok = s.tok ?? {}
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = tok.editor ?? '#23282e'
    ctx.fillRect(0, 0, c.w, c.h)
    const ppm = Math.abs(c.sx)
    const [ai, bi] = PLANES[s.plane ?? 'Top (XY)'] ?? [0, 1]
    // the scene rect on screen
    const left = c.cx - c.w / 2 / ppm
    const right = c.cx + c.w / 2 / ppm
    const bottom = c.cy - c.h / 2 / ppm
    const top = c.cy + c.h / 2 / ppm
    // grid: at least 6 px apart, every 5th line darker
    if (s.grid) {
      let g = s.gs ?? 0.5
      while (g * ppm < 6) g *= 5
      ctx.lineWidth = 1
      for (let i = Math.floor(left / g) - 1; i <= Math.ceil(right / g) + 1; i++) {
        const [x] = toScreen(i * g, 0)
        ctx.strokeStyle = i % 5 === 0 ? css(tok.border, 1) : css(tok.border, 0.55)
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, c.h)
        ctx.stroke()
      }
      for (let j = Math.floor(bottom / g) - 1; j <= Math.ceil(top / g) + 1; j++) {
        const [, y] = toScreen(0, j * g)
        ctx.strokeStyle = j % 5 === 0 ? css(tok.border, 1) : css(tok.border, 0.55)
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(c.w, Math.round(y) + 0.5)
        ctx.stroke()
      }
      // the two axis lines through the origin, in their axis colours
      const [ox, oy] = toScreen(0, 0)
      ctx.lineWidth = 1.4
      ctx.strokeStyle = css(AXIS[ai] + 'ff', 150 / 255)
      ctx.beginPath()
      ctx.moveTo(0, oy)
      ctx.lineTo(c.w, oy)
      ctx.stroke()
      ctx.strokeStyle = css(AXIS[bi] + 'ff', 150 / 255)
      ctx.beginPath()
      ctx.moveTo(ox, 0)
      ctx.lineTo(ox, c.h)
      ctx.stroke()
    }
    // items
    const flat = walk(s.items ?? [], 0, 0, [])
    for (const [it, x, y] of flat) drawItem(ctx, it, x, y, ppm)
    // rubber band
    if (s.band) {
      const [a, b] = [toScreen(s.band[0], s.band[1]), toScreen(s.band[2], s.band[3])]
      ctx.fillStyle = css(tok.select, 0.15)
      ctx.strokeStyle = css(tok.select)
      ctx.lineWidth = 1
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
      ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    }
    foreground(ctx, flat, ai, bi, ppm)
  }

  const path2d = (pts: Float32Array, lens: number[], ox: number, oy: number) => {
    const p = new Path2D()
    let k = 0
    for (const n of lens) {
      for (let i = 0; i < n; i++, k += 2) {
        const [sx, sy] = toScreen(ox + pts[k], oy + pts[k + 1])
        if (i === 0) p.moveTo(sx, sy)
        else p.lineTo(sx, sy)
      }
      p.closePath()
    }
    return p
  }

  const drawItem = (ctx: CanvasRenderingContext2D, it: SketchItem, x: number, y: number, ppm: number) => {
    ctx.save()
    if (it.op !== undefined) ctx.globalAlpha = it.op
    const pen = it.pen
    const strokeW = pen ? (pen[2] || pen[1] === 0 ? Math.max(pen[1], 1) : Math.max(pen[1] * ppm, 1)) : 0
    const stroke = () => {
      if (!pen) return
      ctx.strokeStyle = css(pen[0])
      ctx.lineWidth = strokeW
      ctx.lineCap = pen[4] === 0x20 ? 'round' : pen[4] === 0 ? 'butt' : 'square'
      ctx.setLineDash(pen[3] === 2 ? [6, 4] : pen[3] === 3 ? [2, 3] : [])
    }
    if (it.ign) {
      // a resize handle: constant size on screen
      const [sx, sy] = toScreen(x, y)
      ctx.fillStyle = css(it.br ?? '#ffffffff')
      ctx.fillRect(sx - HANDLE / 2, sy - HANDLE / 2, HANDLE, HANDLE)
      if (pen) {
        stroke()
        ctx.strokeRect(sx - HANDLE / 2 + 0.5, sy - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1)
      }
      ctx.restore()
      return
    }
    const g = it.g ?? []
    let outline: Path2D | null = null
    if (it.k === 'line' && g.length === 4) {
      const [a, b] = [toScreen(x + g[0], y + g[1]), toScreen(x + g[2], y + g[3])]
      stroke()
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    } else if (it.k === 'rect' && g.length === 4) {
      outline = new Path2D()
      const [a, b] = [toScreen(x + g[0], y + g[1]), toScreen(x + g[0] + g[2], y + g[1] + g[3])]
      outline.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    } else if (it.k === 'ellipse' && g.length >= 4) {
      const cx = x + g[0] + g[2] / 2
      const cy = y + g[1] + g[3] / 2
      const rx = Math.abs(g[2] / 2)
      const ry = Math.abs(g[3] / 2)
      const start = (g[4] ?? 0) / 16
      const span = (g[5] ?? 5760) / 16
      outline = new Path2D()
      if (Math.abs(span) >= 360) {
        const [sx, sy] = toScreen(cx, cy)
        outline.ellipse(sx, sy, rx * ppm, ry * ppm, 0, 0, Math.PI * 2)
      } else {
        // Qt's pie, in the item's y-down frame (which the view flips)
        const [c0, c1] = toScreen(cx, cy)
        outline.moveTo(c0, c1)
        const steps = Math.max(8, Math.ceil(Math.abs(span) / 4))
        for (let i = 0; i <= steps; i++) {
          const a = ((start + (span * i) / steps) * Math.PI) / 180
          const [px, py] = toScreen(cx + rx * Math.cos(a), cy - ry * Math.sin(a))
          outline.lineTo(px, py)
        }
        outline.closePath()
      }
    } else if (it.k === 'poly' && g.length >= 4) {
      outline = new Path2D()
      for (let i = 0; i < g.length; i += 2) {
        const [sx, sy] = toScreen(x + g[i], y + g[i + 1])
        if (i === 0) outline.moveTo(sx, sy)
        else outline.lineTo(sx, sy)
      }
      outline.closePath()
    } else if (it.k === 'path') {
      if (it.faces) {
        // the part in its own colours, far to near
        const pts = floatsFromBase64(it.faces.pts)
        const pal = it.faces.pal.map((c) => css(c))
        it.faces.idx.forEach((ci, t) => {
          const k = t * 6
          const p = new Path2D()
          const a = toScreen(x + pts[k], y + pts[k + 1])
          const b = toScreen(x + pts[k + 2], y + pts[k + 3])
          const c2 = toScreen(x + pts[k + 4], y + pts[k + 5])
          p.moveTo(a[0], a[1])
          p.lineTo(b[0], b[1])
          p.lineTo(c2[0], c2[1])
          p.closePath()
          ctx.fillStyle = pal[ci]
          ctx.fill(p)
          if (it.faces!.pal[ci].endsWith('ff')) {
            ctx.strokeStyle = pal[ci]
            ctx.lineWidth = 0.6
            ctx.stroke(p)
          }
        })
        if (it.sel && it.path) {
          const sel = path2d(floatsFromBase64(it.path.pts), it.path.lens, x, y)
          ctx.fillStyle = css(it.lc, 70 / 255)
          ctx.fill(sel, it.path.rule === 1 ? 'nonzero' : 'evenodd')
        }
      } else if (it.path) {
        outline = path2d(floatsFromBase64(it.path.pts), it.path.lens, x, y)
        if (it.br) {
          ctx.fillStyle = css(it.br)
          ctx.fill(outline, it.path.rule === 1 ? 'nonzero' : 'evenodd')
        }
        if (pen) {
          stroke()
          ctx.stroke(outline)
        }
        outline = null
      }
      if (it.label && it.lp) {
        const size = Math.max((it.lh ?? 0) * 0.09, 2.0)
        const [lx, ly] = toScreen(it.lp[0], it.lp[1])
        ctx.font = `${Math.max(1, size * ppm * (96 / 72))}px system-ui, sans-serif`
        ctx.fillStyle = css(it.lc)
        ctx.fillText(it.label, lx, ly - size * 0.4 * ppm)
      }
    }
    if (outline) {
      if (it.br) {
        ctx.fillStyle = css(it.br)
        ctx.fill(outline)
      }
      if (pen) {
        stroke()
        ctx.stroke(outline)
      }
    }
    // Qt draws a selected shape's bounding box dashed
    if (it.sel && it.cls !== 'PartItem' && it.cls !== 'HandleItem') {
      const r = it.k === 'line' && g.length === 4 ? [Math.min(g[0], g[2]), Math.min(g[1], g[3]), Math.max(g[0], g[2]), Math.max(g[1], g[3])] : geometryRect(it)
      if (r) {
        const [a, b] = [toScreen(x + r[0], y + r[1]), toScreen(x + r[2], y + r[3])]
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(128,128,128,0.9)'
        ctx.strokeRect(Math.min(a[0], b[0]) - 0.5, Math.min(a[1], b[1]) - 0.5, Math.abs(b[0] - a[0]) + 1, Math.abs(b[1] - a[1]) + 1)
      }
    }
    ctx.restore()
  }

  /** drawForeground: axis letters, gizmo, scale bar, dimensions, measure. */
  const foreground = (ctx: CanvasRenderingContext2D, flat: [SketchItem, number, number][], ai: number, bi: number, ppm: number) => {
    const c = v.current
    const s = stRef.current
    const tok = s.tok ?? {}
    const unit = s.unit ?? 'mm'
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.fillStyle = AXIS[ai]
    ctx.fillText(`${'XYZ'[ai]} →`, c.w - 46, c.h - 12)
    ctx.fillStyle = AXIS[bi]
    ctx.fillText('XYZ'[bi], 10, 34)
    ctx.fillText('↑', 8, 46)
    // origin gizmo
    const [ox, oy] = toScreen(0, 0)
    const G = 34
    if (ox > -G - 18 && ox < c.w + G + 18 && oy > -G - 18 && oy < c.h + G + 18) {
      for (const [index, dx, dy] of [[ai, 1, 0], [bi, 0, -1]] as [number, number, number][]) {
        const tx = ox + dx * G
        const ty = oy + dy * G
        ctx.strokeStyle = AXIS[index]
        ctx.fillStyle = AXIS[index]
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(tx - dx * 7 - dy * 3.5, ty - dy * 7 - dx * 3.5)
        ctx.lineTo(tx - dx * 7 + dy * 3.5, ty - dy * 7 + dx * 3.5)
        ctx.fill()
        ctx.fillText('XYZ'[index], tx + (dx ? 5 : 4), ty + (dy >= 0 ? 13 : -5))
      }
    }
    // scale bar
    const bar = sketchBar(ppm)
    if (bar) {
      const px = bar * ppm
      const x0 = 14
      const y0 = c.h - 16
      ctx.strokeStyle = tok.text ?? '#e6e9ec'
      ctx.fillStyle = tok.text ?? '#e6e9ec'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + px, y0)
      ctx.moveTo(x0, y0 - 5)
      ctx.lineTo(x0, y0 + 5)
      ctx.moveTo(x0 + px, y0 - 5)
      ctx.lineTo(x0 + px, y0 + 5)
      ctx.stroke()
      ctx.fillText(`${Number(bar.toPrecision(6))} ${unit}`, x0 + px / 2 - 20, y0 - 8)
    }
    const dim = (pa: [number, number], pb: [number, number], color: string, bg: string, text: string, offset = 0, dots = true) => {
      const vx = pb[0] - pa[0]
      const vy = pb[1] - pa[1]
      const len = Math.hypot(vx, vy)
      if (len < 1e-6) return
      const ux = vx / len, uy = vy / len, nx = -uy, ny = ux
      const oa = [pa[0] + nx * offset, pa[1] + ny * offset]
      const ob = [pb[0] + nx * offset, pb[1] + ny * offset]
      ctx.strokeStyle = color
      ctx.fillStyle = color
      if (Math.abs(offset) > 0.5) {
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const p of [pa, pb]) {
          ctx.moveTo(p[0] + nx * 3, p[1] + ny * 3)
          ctx.lineTo(p[0] + nx * (offset + 4), p[1] + ny * (offset + 4))
        }
        ctx.stroke()
      }
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(oa[0], oa[1])
      ctx.lineTo(ob[0], ob[1])
      ctx.stroke()
      for (const [tip, sgn] of [[oa, 1], [ob, -1]] as [number[], number][]) {
        const bx = tip[0] + sgn * ux * 9
        const by = tip[1] + sgn * uy * 9
        ctx.beginPath()
        ctx.moveTo(tip[0], tip[1])
        ctx.lineTo(bx + nx * 4, by + ny * 4)
        ctx.lineTo(bx - nx * 4, by - ny * 4)
        ctx.fill()
      }
      if (dots)
        for (const p of [pa, pb]) {
          ctx.beginPath()
          ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2)
          ctx.fill()
        }
      const mx = (oa[0] + ob[0]) / 2 + nx * 12
      const my = (oa[1] + ob[1]) / 2 + ny * 12
      ctx.font = 'bold 11px system-ui, sans-serif'
      const tw = ctx.measureText(text).width
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.roundRect(mx - tw / 2 - 5, my - 9, tw + 10, 18, 4)
      ctx.fill()
      ctx.fillStyle = color
      ctx.fillText(text, mx - tw / 2, my + 4)
    }
    const gutter = tok.gutter ?? '#6ab0f3'
    const card = tok.card ?? '#2b3138'
    for (const d of s.placed ?? []) {
      const pa = toScreen(d.a[0], d.a[1])
      const pb = toScreen(d.b[0], d.b[1])
      dim(pa, pb, gutter, card, fmtLen(Math.hypot(d.a[0] - d.b[0], d.a[1] - d.b[1]), unit))
    }
    // auto size on the selection (select tool only)
    if (s.dims && s.tool === 'select')
      for (const [it, x, y] of flat) {
        if (!it.sel || it.cls === 'HandleItem') continue
        const g = it.g ?? []
        if (it.cls === 'CircleShapeItem' && g.length >= 4) {
          const r = Math.abs(g[2]) / 2
          const cx = x + g[0] + g[2] / 2
          const cy = y + g[1] + g[3] / 2
          dim(toScreen(cx - r, cy), toScreen(cx + r, cy), gutter, card, `⌀ ${fmtLen(2 * r, unit)}`, 0, false)
          continue
        }
        if (it.cls === 'LineShapeItem' && g.length === 4) {
          dim(toScreen(x + g[0], y + g[1]), toScreen(x + g[2], y + g[3]), gutter, card, fmtLen(Math.hypot(g[2] - g[0], g[3] - g[1]), unit), 18, false)
          continue
        }
        const r = geometryRect(it)
        if (!r || r[2] - r[0] < 1e-6 || r[3] - r[1] < 1e-6) continue
        const pts = [toScreen(x + r[0], y + r[1]), toScreen(x + r[2], y + r[1]), toScreen(x + r[0], y + r[3]), toScreen(x + r[2], y + r[3])]
        const sl = Math.min(...pts.map((p) => p[0]))
        const sr = Math.max(...pts.map((p) => p[0]))
        const stp = Math.min(...pts.map((p) => p[1]))
        const sbt = Math.max(...pts.map((p) => p[1]))
        dim([sl, sbt], [sr, sbt], gutter, card, fmtLen(r[2] - r[0], unit), 22, false)
        dim([sr, sbt], [sr, stp], gutter, card, fmtLen(r[3] - r[1], unit), 22, false)
      }
    if (s.ma && s.mb) dim(toScreen(s.ma[0], s.ma[1]), toScreen(s.mb[0], s.mb[1]), tok.select ?? '#4aa3ff', card, fmtLen(Math.hypot(s.ma[0] - s.mb[0], s.ma[1] - s.mb[1]), unit))
  }

  // ------------------------------------------------------------- input
  const panning = useRef<{ x: number; y: number } | null>(null)
  const local = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const modsOf = (e: React.MouseEvent) => qtKey({ key: 'Shift', ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).mods
  const btn = (b: number) => (b === 0 ? 1 : b === 2 ? 2 : 4)
  const btns = (b: number) => (b & 1 ? 1 : 0) | (b & 2 ? 2 : 0) | (b & 4 ? 4 : 0)
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportSoon = () => {
    if (reportTimer.current) clearTimeout(reportTimer.current)
    reportTimer.current = setTimeout(report, 80)
  }

  return (
    <div
      ref={host}
      className="kc-sketch"
      tabIndex={0}
      style={{ cursor: CURSORS[state.cursor ?? 0] ?? 'default' }}
      onContextMenu={(e) => {
        e.preventDefault()
        const p = local(e)
        send({ op: 'sk_menu', x: p.x, y: p.y })
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.kc-overlay')) return
        ;(e.currentTarget as HTMLElement).focus()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        if (e.button === 1) {
          panning.current = { x: e.clientX, y: e.clientY }
          e.preventDefault()
          return
        }
        const p = local(e)
        send({ op: 'sk_press', x: p.x, y: p.y, button: btn(e.button), buttons: btns(e.buttons), mods: modsOf(e) })
      }}
      onPointerMove={(e) => {
        if (panning.current) {
          const c = v.current
          c.cx -= (e.clientX - panning.current.x) / c.sx
          c.cy -= (e.clientY - panning.current.y) / c.sy
          panning.current = { x: e.clientX, y: e.clientY }
          redraw()
          reportSoon()
          return
        }
        const p = local(e)
        send({ op: 'sk_move', x: p.x, y: p.y, buttons: btns(e.buttons), mods: modsOf(e) })
      }}
      onPointerUp={(e) => {
        if (panning.current) {
          panning.current = null
          report()
          return
        }
        const p = local(e)
        send({ op: 'sk_release', x: p.x, y: p.y, button: btn(e.button), buttons: btns(e.buttons), mods: modsOf(e) })
      }}
      onDoubleClick={(e) => {
        const p = local(e)
        send({ op: 'sk_dbl', x: p.x, y: p.y, button: 1, buttons: 1, mods: modsOf(e) })
      }}
      onWheel={(e) => {
        if ((e.target as HTMLElement).closest('.kc-overlay')) return
        const c = v.current
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        const cur = Math.abs(c.sx)
        if (!(MIN_ZOOM < cur * factor && cur * factor < MAX_ZOOM)) return
        // zoom about the point under the mouse (AnchorUnderMouse)
        const p = local(e)
        const before = [c.cx + (p.x - c.w / 2) / c.sx, c.cy + (p.y - c.h / 2) / c.sy]
        c.sx *= factor
        c.sy *= factor
        const after = [c.cx + (p.x - c.w / 2) / c.sx, c.cy + (p.y - c.h / 2) / c.sy]
        c.cx += before[0] - after[0]
        c.cy += before[1] - after[1]
        redraw()
        reportSoon()
      }}
      onKeyDown={(e) => {
        const k = qtKey(e.nativeEvent)
        if (!k.key) return
        const ctrl = (k.mods & 0x04000000) !== 0
        const own = [0x51, 0x41, 0x01000001, 0x01000002, 0x01000000, 0x01000004, 0x01000005, 0x01000007].includes(k.key) && !ctrl
        if (own || (ctrl && [0x43, 0x58, 0x56].includes(k.key))) {
          e.preventDefault()
          e.stopPropagation()
          send({ op: 'sk_key', key: k.key, mods: k.mods })
        }
      }}
    >
      <canvas ref={canvas} className="kc-sketch-canvas" />
      {(node.overlays ?? []).map((o) =>
        o.hid ? null : (
          <div key={o.id} className={`kc-overlay kc-overlay-${o.name ?? 'bar'}`}>
            <QtNode n={o} />
          </div>
        ),
      )}
    </div>
  )
}
