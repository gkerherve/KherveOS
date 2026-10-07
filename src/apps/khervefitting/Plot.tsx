// The spectrum plot (the desktop's matplotlib canvas): data points, the
// background, each peak filled down to the background, the envelope and the
// residuals below, on a binding-energy axis that runs from high to low.
//
// Mouse: drag a peak's top to move it (position and height); drag the two
// dashed lines to set the background limits; double-click (or click in
// "add" mode) to add a peak there; drag on empty space to zoom into a box;
// the wheel zooms the energy axis (Shift+wheel: intensity); right-click for
// a menu.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { peaksOf, reversedAxis, xLabel, type View } from './model'
import {
  exponentFor, extent, fromPx, hitLine, hitTop, niceTicks, ordered, padded, scale, superscript, tickLabel, toPx, valueAt, zoomRange,
  type Range, type Scale,
} from './plotmath'

export interface Zoom {
  x: Range | null
  y: Range | null
}

export interface PlotProps {
  view: View
  selected: number | null
  /** Background limits being edited (binding energies), or null. */
  limits: [number, number] | null
  showResiduals: boolean
  addMode: boolean
  zoom: Zoom
  onZoom: (z: Zoom) => void
  onSelect: (peak: number | null) => void
  onLimits: (low: number, high: number, final: boolean) => void
  onPeakDrag: (peak: number, x: number, y: number, phase: 'start' | 'move' | 'end') => void
  onAdd: (x: number, y: number) => void
  onContextMenu: (e: ReactMouseEvent, at: { x: number; y: number; peak: number }) => void
}

/** Peak colours: the theme's own distinct hues. */
const PEAK_VARS = ['--k-syn-function', '--k-syn-def', '--k-syn-string', '--k-syn-type', '--k-syn-keyword', '--k-syn-property', '--k-syn-number', '--k-warning']

const M = { left: 66, right: 16, top: 12, bottom: 40 }
const RESID_H = 64

type Drag =
  | { kind: 'peak'; peak: number; x: number; y: number }
  | { kind: 'line'; line: number; other: number }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; moved: boolean }
  | null

interface Frame {
  sx: Scale
  sy: Scale
  sr: Scale | null
  plot: { x: number; y: number; w: number; h: number }
  resid: { x: number; y: number; w: number; h: number } | null
}

function cssVar(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

export function Plot(props: PlotProps) {
  const { view, selected, limits, showResiduals, addMode, zoom } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [drag, setDrag] = useState<Drag>(null)
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const [cursor, setCursor] = useState('crosshair')
  const frameRef = useRef<Frame | null>(null)

  // Follow the size of the panel.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(160, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const xs = view.x ?? []
  const ys = view.y ?? []
  const bkg = view.bkg ?? []
  const peaks = peaksOf(view.grid)
  const rev = reversedAxis(view.sheet)

  /** Scales for the current zoom and size. */
  const frame = (): Frame | null => {
    const dataX = extent(xs)
    const dataY = extent(ys, bkg, view.envelope)
    if (!dataX || !dataY) return null
    const hasResid = showResiduals && !!view.residuals && view.residuals.some((v) => v !== null)
    const plot = { x: M.left, y: M.top, w: size.w - M.left - M.right, h: size.h - M.top - M.bottom - (hasResid ? RESID_H + 8 : 0) }
    const xr = zoom.x ?? dataX
    const yr = zoom.y ?? padded({ min: Math.min(0, dataY.min), max: dataY.max }, 0.02, 0.08)
    const sx = scale(xr, plot.x, plot.x + plot.w, rev)
    const sy = scale(yr, plot.y + plot.h, plot.y)
    let sr: Scale | null = null
    let resid = null
    if (hasResid) {
      resid = { x: plot.x, y: plot.y + plot.h + 8, w: plot.w, h: RESID_H }
      const r = extent(view.residuals)
      const m = r ? Math.max(Math.abs(r.min), Math.abs(r.max)) || 1 : 1
      sr = scale({ min: -m * 1.1, max: m * 1.1 }, resid.y + resid.h, resid.y)
    }
    return { sx, sy, sr, plot, resid }
  }

  const peakTop = (f: Frame, i: number): { x: number; y: number } | null => {
    const p = peaks[i]
    if (!p || !Number.isFinite(p.position) || !Number.isFinite(p.height)) return null
    if (drag?.kind === 'peak' && drag.peak === i) return { x: toPx(f.sx, drag.x), y: toPx(f.sy, drag.y) }
    const b = valueAt(xs, bkg, p.position) ?? 0
    return { x: toPx(f.sx, p.position), y: toPx(f.sy, p.height + b) }
  }

  // ------------------------------------------------------------- drawing
  useEffect(() => {
    const canvas = canvasRef.current
    const root = wrapRef.current
    if (!canvas || !root) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const c = {
      bg: cssVar(root, '--k-bg', '#000'),
      surface: cssVar(root, '--k-surface', '#111'),
      text: cssVar(root, '--k-text', '#eee'),
      muted: cssVar(root, '--k-muted', '#999'),
      border: cssVar(root, '--k-border', '#333'),
      accent: cssVar(root, '--k-accent', '#3c3'),
      danger: cssVar(root, '--k-danger', '#e33'),
      warning: cssVar(root, '--k-warning', '#ec3'),
      link: cssVar(root, '--k-link', '#5af'),
      selection: cssVar(root, '--k-selection', '#264'),
      font: cssVar(root, '--k-font', 'sans-serif'),
      peaks: PEAK_VARS.map((v) => cssVar(root, v, '#888')),
    }
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, size.w, size.h)
    const f = frame()
    frameRef.current = f
    if (!f) {
      ctx.fillStyle = c.muted
      ctx.font = `13px ${c.font}`
      ctx.textAlign = 'center'
      ctx.fillText(view.sheet ? 'This core level has no data.' : '', size.w / 2, size.h / 2)
      return
    }
    const { sx, sy, plot } = f
    const X = (v: number) => toPx(sx, v)
    const Y = (v: number) => toPx(sy, v)

    // Axes and grid
    const xr = ordered(sx.d0, sx.d1)
    const yr = ordered(sy.d0, sy.d1)
    const xt = niceTicks(xr.min, xr.max, Math.max(3, Math.floor(plot.w / 80)))
    const yt = niceTicks(yr.min, yr.max, Math.max(3, Math.floor(plot.h / 50)))
    const exp = exponentFor(Math.max(Math.abs(yr.min), Math.abs(yr.max)))
    ctx.font = `11px ${c.font}`
    ctx.strokeStyle = c.border
    ctx.lineWidth = 1
    ctx.fillStyle = c.muted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const bottom = (f.resid ? f.resid.y + f.resid.h : plot.y + plot.h)
    for (const t of xt.ticks) {
      const px = Math.round(X(t)) + 0.5
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.moveTo(px, plot.y)
      ctx.lineTo(px, bottom)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillText(tickLabel(t, xt.step), px, bottom + 5)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const t of yt.ticks) {
      const py = Math.round(Y(t)) + 0.5
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.moveTo(plot.x, py)
      ctx.lineTo(plot.x + plot.w, py)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.fillText(tickLabel(t / 10 ** exp, yt.step / 10 ** exp), plot.x - 6, py)
    }
    ctx.fillStyle = c.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(xLabel(view.sheet), plot.x + plot.w / 2, size.h - 4)
    ctx.save()
    ctx.translate(13, plot.y + plot.h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'middle'
    ctx.fillText(`Intensity (CPS${exp ? ` ×10${superscript(exp)}` : ''})`, 0, 0)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.x, plot.y, plot.w, plot.h)
    ctx.clip()

    // Recorded background regions
    const regions = view.background?.ranges ?? []
    ctx.fillStyle = c.selection
    ctx.globalAlpha = 0.18
    for (const r of regions) {
      const a = X(r[2])
      const b = X(r[3])
      ctx.fillRect(Math.min(a, b), plot.y, Math.abs(b - a), plot.h)
    }
    ctx.globalAlpha = 1

    const line = (arr: readonly (number | null)[], close?: readonly (number | null)[]) => {
      ctx.beginPath()
      let on = false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = arr[i]
        if (x === null || y === null || y === undefined) {
          on = false
          continue
        }
        if (on) ctx.lineTo(X(x), Y(y))
        else ctx.moveTo(X(x), Y(y))
        on = true
      }
      if (close) {
        for (let i = xs.length - 1; i >= 0; i--) {
          const x = xs[i]
          const y = close[i]
          if (x === null || y === null || y === undefined || arr[i] === null) continue
          ctx.lineTo(X(x), Y(y))
        }
        ctx.closePath()
      }
    }

    // Peaks, filled down to the background
    ;(view.peaks ?? []).forEach((curve, i) => {
      if (!curve) return
      const col = c.peaks[i % c.peaks.length]
      ctx.fillStyle = col
      ctx.globalAlpha = selected === i ? 0.5 : 0.28
      line(curve, bkg)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = col
      ctx.lineWidth = selected === i ? 2 : 1.2
      line(curve)
      ctx.stroke()
    })

    // Background
    if (view.background?.type) {
      ctx.strokeStyle = c.warning
      ctx.lineWidth = 1.4
      ctx.setLineDash([6, 4])
      line(bkg)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Data
    ctx.fillStyle = c.text
    const r = xs.length > 1500 ? 1.1 : 1.8
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]
      const y = ys[i]
      if (x === null || y === null) continue
      ctx.beginPath()
      ctx.arc(X(x), Y(y), r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Envelope
    if (view.envelope) {
      ctx.strokeStyle = c.accent
      ctx.lineWidth = 1.8
      line(view.envelope)
      ctx.stroke()
    }

    // Background limits
    if (limits) {
      ctx.strokeStyle = c.link
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.fillStyle = c.link
      ctx.font = `11px ${c.font}`
      ctx.textBaseline = 'top'
      for (const v of limits) {
        const px = X(v)
        ctx.beginPath()
        ctx.moveTo(px, plot.y)
        ctx.lineTo(px, plot.y + plot.h)
        ctx.stroke()
        ctx.textAlign = 'center'
        ctx.fillText(v.toFixed(2), px, plot.y + 3)
      }
      ctx.setLineDash([])
    }

    // Peak tops (handles)
    ctx.font = `bold 11px ${c.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    peaks.forEach((p, i) => {
      const t = peakTop(f, i)
      if (!t || !(view.peaks ?? [])[i]) return
      const col = c.peaks[i % c.peaks.length]
      const s = selected === i ? 6 : 4
      ctx.strokeStyle = selected === i ? c.text : col
      ctx.lineWidth = selected === i ? 2 : 1.4
      ctx.beginPath()
      ctx.moveTo(t.x - s, t.y)
      ctx.lineTo(t.x + s, t.y)
      ctx.moveTo(t.x, t.y - s)
      ctx.lineTo(t.x, t.y + s)
      ctx.stroke()
      ctx.fillStyle = col
      ctx.fillText(p.letter, t.x, t.y - s - 2)
    })

    // Zoom box
    if (drag?.kind === 'box' && drag.moved) {
      ctx.strokeStyle = c.link
      ctx.fillStyle = c.selection
      ctx.globalAlpha = 0.25
      ctx.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      ctx.globalAlpha = 1
      ctx.strokeRect(Math.min(drag.x0, drag.x1) + 0.5, Math.min(drag.y0, drag.y1) + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
    }
    ctx.restore()

    // Frame
    ctx.strokeStyle = c.muted
    ctx.lineWidth = 1
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w, plot.h)

    // Residuals
    if (f.resid && f.sr && view.residuals) {
      const rr = f.resid
      const sr = f.sr
      ctx.strokeRect(rr.x + 0.5, rr.y + 0.5, rr.w, rr.h)
      ctx.save()
      ctx.beginPath()
      ctx.rect(rr.x, rr.y, rr.w, rr.h)
      ctx.clip()
      ctx.strokeStyle = c.border
      ctx.beginPath()
      ctx.moveTo(rr.x, toPx(sr, 0))
      ctx.lineTo(rr.x + rr.w, toPx(sr, 0))
      ctx.stroke()
      ctx.strokeStyle = c.danger
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let on = false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = view.residuals[i]
        if (x === null || y === null || y === undefined) {
          on = false
          continue
        }
        if (on) ctx.lineTo(X(x), toPx(sr, y))
        else ctx.moveTo(X(x), toPx(sr, y))
        on = true
      }
      ctx.stroke()
      ctx.restore()
      ctx.fillStyle = c.muted
      ctx.font = `11px ${c.font}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('Residuals', rr.x + 4, rr.y + 3)
    }

    // Legend
    const items = peaks.map((p, i) => ({ label: p.label || p.letter, color: c.peaks[i % c.peaks.length], shown: !!(view.peaks ?? [])[i] })).filter((x) => x.shown)
    if (items.length) {
      ctx.font = `11px ${c.font}`
      const wmax = Math.max(...items.map((x) => ctx.measureText(x.label).width)) + 26
      const lh = 15
      const lx = plot.x + 8
      const ly = plot.y + 8
      ctx.fillStyle = c.surface
      ctx.globalAlpha = 0.85
      ctx.fillRect(lx, ly, wmax, items.length * lh + 6)
      ctx.globalAlpha = 1
      items.forEach((it, i) => {
        ctx.fillStyle = it.color
        ctx.fillRect(lx + 5, ly + 6 + i * lh, 12, 9)
        ctx.fillStyle = c.text
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(it.label, lx + 22, ly + 4 + i * lh)
      })
    }

    // Read-out of the mouse position
    if (hover) {
      ctx.fillStyle = c.muted
      ctx.font = `11px ${c.font}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(`${hover.x.toFixed(2)} eV   ${Math.round(hover.y)} CPS`, plot.x + plot.w - 6, plot.y + 6)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, size, selected, limits, showResiduals, zoom, drag, hover])

  // ------------------------------------------------------------- mouse
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { px: e.clientX - r.left, py: e.clientY - r.top }
  }
  const toData = (f: Frame, px: number, py: number) => ({ x: fromPx(f.sx, px), y: fromPx(f.sy, py) })
  const inPlot = (f: Frame, px: number, py: number) =>
    px >= f.plot.x && px <= f.plot.x + f.plot.w && py >= f.plot.y && py <= f.plot.y + f.plot.h

  const what = (f: Frame, px: number, py: number) => {
    const lines = limits ? limits.map((v) => toPx(f.sx, v)) : []
    const line = inPlot(f, px, py) ? hitLine(lines, px) : -1
    const tops = peaks.map((_, i) => ((view.peaks ?? [])[i] ? peakTop(f, i) : null))
    const peak = hitTop(tops, px, py)
    return { line, peak }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const f = frameRef.current
    if (!f) return
    const { px, py } = local(e)
    if (!inPlot(f, px, py)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { line, peak } = what(f, px, py)
    const d = toData(f, px, py)
    if (peak >= 0) {
      props.onSelect(peak)
      setDrag({ kind: 'peak', peak, x: d.x, y: d.y })
      props.onPeakDrag(peak, d.x, d.y, 'start')
    } else if (line >= 0 && limits) {
      setDrag({ kind: 'line', line, other: limits[1 - line] })
    } else if (addMode) {
      props.onAdd(d.x, d.y)
    } else {
      setDrag({ kind: 'box', x0: px, y0: py, x1: px, y1: py, moved: false })
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const f = frameRef.current
    if (!f) return
    const { px, py } = local(e)
    const d = toData(f, px, py)
    if (inPlot(f, px, py)) setHover({ ...d, px, py })
    else setHover(null)
    if (!drag) {
      const { line, peak } = inPlot(f, px, py) ? what(f, px, py) : { line: -1, peak: -1 }
      setCursor(peak >= 0 ? 'grab' : line >= 0 ? 'ew-resize' : addMode ? 'copy' : 'crosshair')
      return
    }
    if (drag.kind === 'peak') {
      setDrag({ ...drag, x: d.x, y: d.y })
      props.onPeakDrag(drag.peak, d.x, d.y, 'move')
    } else if (drag.kind === 'line') {
      props.onLimits(Math.min(d.x, drag.other), Math.max(d.x, drag.other), false)
    } else if (drag.kind === 'box') {
      setDrag({ ...drag, x1: px, y1: py, moved: drag.moved || Math.abs(px - drag.x0) + Math.abs(py - drag.y0) > 5 })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const f = frameRef.current
    const cur = drag
    setDrag(null)
    if (!f || !cur) return
    const { px, py } = local(e)
    const d = toData(f, px, py)
    if (cur.kind === 'peak') props.onPeakDrag(cur.peak, d.x, d.y, 'end')
    else if (cur.kind === 'line') props.onLimits(Math.min(d.x, cur.other), Math.max(d.x, cur.other), true)
    else if (cur.kind === 'box') {
      if (!cur.moved) {
        props.onSelect(null)
        return
      }
      const a = toData(f, cur.x0, cur.y0)
      props.onZoom({ x: ordered(a.x, d.x), y: ordered(a.y, d.y) })
    }
  }

  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const f = frameRef.current
    if (!f) return
    const { px, py } = local(e)
    if (!inPlot(f, px, py)) return
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const d = toData(f, px, py)
    if (e.shiftKey) props.onZoom({ x: zoom.x, y: zoomRange(ordered(f.sy.d0, f.sy.d1), d.y, factor) })
    else props.onZoom({ x: zoomRange(ordered(f.sx.d0, f.sx.d1), d.x, factor), y: zoom.y })
  }

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const f = frameRef.current
    if (!f) return
    const { px, py } = local(e)
    if (!inPlot(f, px, py) || what(f, px, py).peak >= 0) return
    const d = toData(f, px, py)
    props.onAdd(d.x, d.y)
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const f = frameRef.current
    if (!f) return
    const { px, py } = local(e)
    const d = toData(f, px, py)
    props.onContextMenu(e, { ...d, peak: inPlot(f, px, py) ? what(f, px, py).peak : -1 })
  }

  return (
    <div className="kf-plot" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor: drag?.kind === 'peak' ? 'grabbing' : cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => !drag && setHover(null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </div>
  )
}
