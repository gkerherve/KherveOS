// A canvas plot: grid, axes with ticks, curves, implicit contours, points,
// bars, shaded areas, markers and a trace point. Wheel zooms at the cursor,
// dragging pans. Colours come from the window's theme variables, so the plot
// follows the app's Light/Dark choice.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { niceTicks, pan, runs, tickLabel, zoomAt, type View } from './plot'

export type PlotLayer =
  | { kind: 'line'; xs: (number | null)[]; ys: (number | null)[]; color: string; width?: number; dash?: number[] }
  | { kind: 'segments'; segs: [number, number, number, number][]; color: string; width?: number }
  | { kind: 'scatter'; xs: number[]; ys: number[]; color: string; r?: number }
  | { kind: 'bars'; edges: number[]; heights: number[]; color: string }
  | { kind: 'stems'; xs: number[]; ys: number[]; color: string; highlight?: (x: number) => boolean }
  | { kind: 'area'; xs: (number | null)[]; ys: (number | null)[]; color: string; from: number; to: number }

export interface Marker {
  x: number
  y: number
  label?: string
  color?: string
}

interface Props {
  view: View
  onView?: (v: View) => void
  layers: PlotLayer[]
  markers?: Marker[]
  trace?: { x: number; y: number; color: string; label?: string } | null
  /** The pointer in data coordinates (null when it leaves). */
  onPointer?: (p: { x: number; y: number } | null) => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  onSize?: (w: number, h: number) => void
  className?: string
}

function cssVar(el: Element, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

export function Plot({ view, onView, layers, markers, trace, onPointer, onKeyDown, onSize, className }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [themeTick, setThemeTick] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)
  const latest = useRef({ view, onView, onSize })
  latest.current = { view, onView, onSize }

  // size
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = Math.max(10, Math.floor(r.width))
      const h = Math.max(10, Math.floor(r.height))
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
      latest.current.onSize?.(w, h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // theme changes (the window's Light/Dark variables)
  useEffect(() => {
    const win = host.current?.closest('.k-window') ?? document.documentElement
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1))
    mo.observe(win, { attributes: true, attributeFilter: ['style', 'data-dark'] })
    if (win !== document.documentElement) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-dark'] })
    return () => mo.disconnect()
  }, [])

  // wheel zoom (non-passive, so the page does not scroll)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { view: v, onView: set } = latest.current
      if (!set) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = v.xmin + ((e.clientX - r.left) / r.width) * (v.xmax - v.xmin)
      const cy = v.ymax - ((e.clientY - r.top) / r.height) * (v.ymax - v.ymin)
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(0.5, Math.abs(e.deltaY) / 300))
      set(e.shiftKey ? zoomAt(v, cx, cy, f, 1) : e.altKey ? zoomAt(v, cx, cy, 1, f) : zoomAt(v, cx, cy, f))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // draw
  useEffect(() => {
    const c = canvas.current
    const el = host.current
    if (!c || !el || !size.w) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = cssVar(el, '--k-bg', '#0d0f0e')
    const text = cssVar(el, '--k-text', '#e9f1ec')
    const muted = cssVar(el, '--k-muted', '#8b998f')
    const border = cssVar(el, '--k-border', '#252b28')
    const font = cssVar(el, '--k-font', 'sans-serif')
    const mono = cssVar(el, '--k-mono', 'monospace')
    const W = size.w
    const H = size.h
    const { xmin, xmax, ymin, ymax } = view
    const X = (x: number) => ((x - xmin) / (xmax - xmin)) * W
    const Y = (y: number) => H - ((y - ymin) / (ymax - ymin)) * H
    g.fillStyle = bg
    g.fillRect(0, 0, W, H)
    g.font = `11px ${font}`

    // grid
    const tx = niceTicks(xmin, xmax, Math.max(2, Math.round(W / 90)))
    const ty = niceTicks(ymin, ymax, Math.max(2, Math.round(H / 70)))
    g.strokeStyle = border
    g.lineWidth = 1
    g.beginPath()
    for (const t of tx.ticks) {
      const px = Math.round(X(t)) + 0.5
      g.moveTo(px, 0)
      g.lineTo(px, H)
    }
    for (const t of ty.ticks) {
      const py = Math.round(Y(t)) + 0.5
      g.moveTo(0, py)
      g.lineTo(W, py)
    }
    g.stroke()

    // axes
    const ax = Math.min(Math.max(Y(0), 0), H - 1)
    const ay = Math.min(Math.max(X(0), 0), W - 1)
    g.strokeStyle = muted
    g.lineWidth = 1.2
    g.beginPath()
    g.moveTo(0, Math.round(ax) + 0.5)
    g.lineTo(W, Math.round(ax) + 0.5)
    g.moveTo(Math.round(ay) + 0.5, 0)
    g.lineTo(Math.round(ay) + 0.5, H)
    g.stroke()
    g.fillStyle = muted
    g.textAlign = 'center'
    g.textBaseline = 'top'
    for (const t of tx.ticks) {
      if (t === 0) continue
      const px = X(t)
      const py = ax + 4 > H - 14 ? ax - 16 : ax + 4
      g.fillText(tickLabel(t, tx.step), px, py)
    }
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    for (const t of ty.ticks) {
      if (t === 0) continue
      const py = Y(t)
      const px = ay - 4 < 30 ? ay + 34 : ay - 4
      g.fillText(tickLabel(t, ty.step), px, py)
    }

    // layers
    for (const L of layers) {
      g.strokeStyle = L.color
      g.fillStyle = L.color
      if (L.kind === 'line') {
        g.lineWidth = L.width ?? 2
        g.setLineDash(L.dash ?? [])
        for (const run of runs(L.xs, L.ys, view)) {
          g.beginPath()
          run.forEach(([x, y], i) => {
            const py = Math.max(-1e5, Math.min(1e5, Y(y)))
            if (i) g.lineTo(X(x), py)
            else g.moveTo(X(x), py)
          })
          if (run.length === 1) g.arc(X(run[0][0]), Y(run[0][1]), 1.5, 0, 2 * Math.PI)
          g.stroke()
        }
        g.setLineDash([])
      } else if (L.kind === 'segments') {
        g.lineWidth = L.width ?? 2
        g.beginPath()
        for (const [x0, y0, x1, y1] of L.segs) {
          g.moveTo(X(x0), Y(y0))
          g.lineTo(X(x1), Y(y1))
        }
        g.stroke()
      } else if (L.kind === 'scatter') {
        const r = L.r ?? 3.5
        for (let i = 0; i < L.xs.length; i++) {
          g.beginPath()
          g.arc(X(L.xs[i]), Y(L.ys[i]), r, 0, 2 * Math.PI)
          g.fill()
        }
      } else if (L.kind === 'bars') {
        g.globalAlpha = 0.55
        for (let i = 0; i < L.heights.length; i++) {
          const x0 = X(L.edges[i])
          const x1 = X(L.edges[i + 1])
          const y0 = Y(0)
          const y1 = Y(L.heights[i])
          g.fillRect(x0 + 1, Math.min(y0, y1), Math.max(1, x1 - x0 - 2), Math.abs(y1 - y0))
        }
        g.globalAlpha = 1
      } else if (L.kind === 'stems') {
        g.lineWidth = 3
        for (let i = 0; i < L.xs.length; i++) {
          g.globalAlpha = L.highlight && !L.highlight(L.xs[i]) ? 0.35 : 1
          g.beginPath()
          g.moveTo(X(L.xs[i]), Y(0))
          g.lineTo(X(L.xs[i]), Y(L.ys[i]))
          g.stroke()
        }
        g.globalAlpha = 1
      } else if (L.kind === 'area') {
        g.globalAlpha = 0.28
        g.beginPath()
        let started = false
        let lastX = L.from
        for (let i = 0; i < L.xs.length; i++) {
          const x = L.xs[i]
          const y = L.ys[i]
          if (x === null || y === null || x < L.from || x > L.to) continue
          if (!started) {
            g.moveTo(X(x), Y(0))
            started = true
          }
          g.lineTo(X(x), Y(y))
          lastX = x
        }
        if (started) {
          g.lineTo(X(lastX), Y(0))
          g.closePath()
          g.fill()
        }
        g.globalAlpha = 1
      }
    }

    // markers
    for (const m of markers ?? []) {
      const px = X(m.x)
      const py = Y(m.y)
      g.fillStyle = m.color ?? text
      g.strokeStyle = bg
      g.lineWidth = 2
      g.beginPath()
      g.arc(px, py, 4.5, 0, 2 * Math.PI)
      g.fill()
      g.stroke()
      if (m.label) {
        g.fillStyle = text
        g.textAlign = 'left'
        g.textBaseline = 'bottom'
        g.fillText(m.label, px + 7, py - 4)
      }
    }

    // trace
    if (trace && Number.isFinite(trace.x) && Number.isFinite(trace.y)) {
      const px = X(trace.x)
      const py = Y(trace.y)
      g.strokeStyle = trace.color
      g.setLineDash([4, 4])
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(px, 0)
      g.lineTo(px, H)
      g.moveTo(0, py)
      g.lineTo(W, py)
      g.stroke()
      g.setLineDash([])
      g.fillStyle = trace.color
      g.beginPath()
      g.arc(px, py, 5, 0, 2 * Math.PI)
      g.fill()
      const label = trace.label ?? `(${trace.x.toPrecision(6)}, ${trace.y.toPrecision(6)})`
      g.font = `12px ${mono}`
      const w = g.measureText(label).width + 12
      const lx = Math.min(W - w - 4, px + 10)
      const ly = Math.max(4, py - 28)
      g.fillStyle = bg
      g.globalAlpha = 0.85
      g.fillRect(lx, ly, w, 20)
      g.globalAlpha = 1
      g.strokeStyle = trace.color
      g.strokeRect(lx + 0.5, ly + 0.5, w - 1, 19)
      g.fillStyle = text
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      g.fillText(label, lx + 6, ly + 10)
    }
  }, [view, layers, markers, trace, size, themeTick])

  const toData = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect()
    return {
      x: view.xmin + ((e.clientX - r.left) / r.width) * (view.xmax - view.xmin),
      y: view.ymax - ((e.clientY - r.top) / r.height) * (view.ymax - view.ymin),
    }
  }

  return (
    <div
      ref={host}
      className={`kc-plot ${className ?? ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (!onView || e.button !== 0) return
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        drag.current = { px: e.clientX, py: e.clientY, view }
      }}
      onPointerMove={(e) => {
        const p = toData(e)
        setHover(p)
        onPointer?.(p)
        const d = drag.current
        if (d && onView) {
          const r = host.current!.getBoundingClientRect()
          const dx = ((e.clientX - d.px) / r.width) * (d.view.xmax - d.view.xmin)
          const dy = ((e.clientY - d.py) / r.height) * (d.view.ymax - d.view.ymin)
          onView(pan(d.view, -dx, dy))
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => {
        setHover(null)
        onPointer?.(null)
      }}
    >
      <canvas ref={canvas} style={{ width: size.w || '100%', height: size.h || '100%' }} />
      {hover && <div className="kc-plot-coords">x = {hover.x.toPrecision(5)} · y = {hover.y.toPrecision(5)}</div>}
    </div>
  )
}
