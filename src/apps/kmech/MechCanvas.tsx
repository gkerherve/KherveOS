// The drawing sheet shared by the three workbenches: paints a list of primitives (scene.ts) with pan and zoom,
// and reports the pointer in world coordinates (mm, y up).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { COLORS, gridPrims, type Prim } from './scene'
import { fitBox, niceStep, toScreen, toWorld, zoomAt, type View } from './view'
import type { Pt } from './math'

export interface CanvasHandle {
  fit(): void
  zoomBy(f: number): void
  getView(): View
  /** The sheet as a PNG (what is on screen). */
  png(): Promise<Uint8Array>
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

interface Props {
  prims: readonly Prim[]
  /** Fit to this box when `fitKey` changes (and on the first size). */
  fitTo: Box
  fitKey: unknown
  grid?: boolean
  cursor?: string
  label: string
  onDown?(p: Pt, e: React.PointerEvent, scale: number): boolean | void
  onMove?(p: Pt, e: React.PointerEvent, scale: number): void
  onUp?(p: Pt, e: React.PointerEvent, scale: number): void
  onDoubleClick?(p: Pt, e: React.MouseEvent, scale: number): void
  onContextMenu?(p: Pt, e: React.MouseEvent): void
  onLeave?(): void
  onKeyDown?(e: React.KeyboardEvent): void
  onViewChange?(v: View): void
  children?: React.ReactNode
}

function paint(ctx: CanvasRenderingContext2D, prims: readonly Prim[], v: View, w: number, h: number) {
  const S = (p: Pt): Pt => toScreen(v, w, h, p)
  const apply = (s: { stroke?: string; fill?: string; width?: number; dash?: number[]; cap?: 'round' | 'butt' }, fillRule?: CanvasFillRule) => {
    if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(fillRule) }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.width ?? 1
      ctx.setLineDash(s.dash ?? [])
      ctx.lineCap = s.cap === 'round' ? 'round' : 'butt'
      ctx.lineJoin = s.cap === 'round' ? 'round' : 'miter'
      ctx.stroke()
    }
  }
  for (const p of prims) {
    if (p.k === 'path') {
      if (p.pts.length < 2) continue
      ctx.beginPath()
      p.pts.forEach((q, i) => { const s = S(q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y) })
      if (p.closed) ctx.closePath()
      if (p.hole) { p.hole.forEach((q, i) => { const s = S(q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y) }); ctx.closePath() }
      apply(p.style, p.hole ? 'evenodd' : undefined)
    } else if (p.k === 'circle') {
      const s = S(p.c)
      const r = p.r !== undefined ? p.r * v.scale : p.rpx ?? 3
      if (s.x + r < 0 || s.y + r < 0 || s.x - r > w || s.y - r > h) continue
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.5, r), 0, Math.PI * 2)
      apply(p.style)
    } else if (p.k === 'text') {
      const s = S(p.at)
      ctx.font = `${p.px}px system-ui, sans-serif`
      ctx.fillStyle = p.color; ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor ?? 'start'; ctx.textBaseline = 'alphabetic'
      ctx.fillText(p.text, s.x + (p.dx ?? 0), s.y + (p.dy ?? 0))
    } else if (p.k === 'arrow') {
      const a = S(p.a); const b = S(p.b)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
      ctx.moveTo(b.x - 8 * Math.cos(ang - 0.4), b.y - 8 * Math.sin(ang - 0.4)); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - 8 * Math.cos(ang + 0.4), b.y - 8 * Math.sin(ang + 0.4))
      apply({ stroke: p.style.stroke, width: p.style.width, cap: 'round' })
    } else if (p.k === 'ground') {
      const s = S(p.at)
      const k = p.px
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - k * 0.8, s.y + k); ctx.lineTo(s.x + k * 0.8, s.y + k); ctx.closePath()
      for (let i = -1; i <= 1; i++) { ctx.moveTo(s.x + i * k * 0.5 - k * 0.15, s.y + k); ctx.lineTo(s.x + i * k * 0.5 - k * 0.45, s.y + k * 1.5) }
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke()
    } else {
      const s = S(p.at)
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-p.angle)
      ctx.beginPath(); ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
      // a path under a transform keeps the transform at stroke time in canvas 2D: draw again explicitly
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-p.angle); ctx.beginPath(); ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h)
      if (p.style.fill) { ctx.fillStyle = p.style.fill; ctx.fill() }
      if (p.style.stroke) { ctx.strokeStyle = p.style.stroke; ctx.lineWidth = p.style.width ?? 1; ctx.setLineDash([]); ctx.stroke() }
      ctx.restore()
    }
  }
}

export const MechCanvas = forwardRef<CanvasHandle, Props>(function MechCanvas(props, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ cx: 0, cy: 0, scale: 2 })
  const size = useRef({ w: 300, h: 200, dpr: 1 })
  const raf = useRef(0)
  const latest = useRef(props)
  latest.current = props
  const gesture = useRef<{ kind: 'pan'; sx: number; sy: number; cx: number; cy: number } | { kind: 'tool' } | null>(null)
  const space = useRef(false)
  const fitted = useRef<unknown>(Symbol('none'))

  const draw = useCallback(() => {
    raf.current = 0
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const { w, h, dpr } = size.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)
    const v = view.current
    const p = latest.current
    if (p.grid !== false) {
      const a = toWorld(v, w, h, 0, h); const b = toWorld(v, w, h, w, 0)
      paint(ctx, gridPrims({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, niceStep(v.scale)), v, w, h)
    }
    paint(ctx, p.prims, v, w, h)
  }, [])

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw)
  }, [draw])

  const doFit = useCallback(() => {
    view.current = fitBox(latest.current.fitTo, size.current.w, size.current.h)
    latest.current.onViewChange?.(view.current)
    schedule()
  }, [schedule])

  useImperativeHandle(ref, () => ({
    fit: doFit,
    zoomBy: (f) => { view.current = zoomAt(view.current, size.current.w, size.current.h, size.current.w / 2, size.current.h / 2, f); latest.current.onViewChange?.(view.current); schedule() },
    getView: () => view.current,
    png: () => new Promise((resolve, reject) => {
      const c = canvas.current
      if (!c) return reject(new Error('The sheet is not on screen.'))
      draw()
      c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('The picture could not be made.'))), 'image/png')
    }),
  }), [doFit, draw, schedule])

  // size
  useEffect(() => {
    const el = wrap.current
    const c = canvas.current
    if (!el || !c) return
    const resize = () => {
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { w: Math.max(40, r.width), h: Math.max(40, r.height), dpr }
      c.width = Math.round(size.current.w * dpr); c.height = Math.round(size.current.h * dpr)
      c.style.width = `${size.current.w}px`; c.style.height = `${size.current.h}px`
      if (fitted.current !== latest.current.fitKey) { fitted.current = latest.current.fitKey; doFit() }
      schedule()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))
      view.current = zoomAt(view.current, size.current.w, size.current.h, e.clientX - r.left, e.clientY - r.top, f)
      latest.current.onViewChange?.(view.current)
      schedule()
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    const keyup = (e: KeyboardEvent) => { if (e.key === ' ') space.current = false }
    window.addEventListener('keyup', keyup)
    return () => {
      ro.disconnect(); c.removeEventListener('wheel', onWheel); window.removeEventListener('keyup', keyup)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [doFit, schedule])

  // fit again when the document changes
  useEffect(() => {
    if (fitted.current !== props.fitKey && size.current.w > 50) { fitted.current = props.fitKey; doFit() }
  }, [props.fitKey, doFit])

  useEffect(() => { schedule() })

  const pos = (e: { clientX: number; clientY: number }): { sx: number; sy: number; p: Pt } => {
    const r = canvas.current!.getBoundingClientRect()
    const sx = e.clientX - r.left; const sy = e.clientY - r.top
    return { sx, sy, p: toWorld(view.current, size.current.w, size.current.h, sx, sy) }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvas.current!
    c.setPointerCapture(e.pointerId)
    const { sx, sy, p } = pos(e)
    if (e.button === 1 || e.button === 2 || space.current) {
      gesture.current = { kind: 'pan', sx, sy, cx: view.current.cx, cy: view.current.cy }
      return
    }
    if (e.button !== 0) return
    c.focus()
    if (latest.current.onDown?.(p, e, view.current.scale)) gesture.current = { kind: 'tool' }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { sx, sy, p } = pos(e)
    const g = gesture.current
    if (g?.kind === 'pan') {
      view.current = { ...view.current, cx: g.cx - (sx - g.sx) / view.current.scale, cy: g.cy + (sy - g.sy) / view.current.scale }
      latest.current.onViewChange?.(view.current)
      schedule()
      return
    }
    latest.current.onMove?.(p, e, view.current.scale)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const { p } = pos(e)
    const g = gesture.current
    gesture.current = null
    if (g?.kind === 'tool') latest.current.onUp?.(p, e, view.current.scale)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && !(e.target as HTMLElement).closest('input, textarea, select')) { space.current = true; e.preventDefault() }
    latest.current.onKeyDown?.(e)
  }

  return (
    <div className="mc-sheet" ref={wrap}>
      <canvas
        ref={canvas} className="mc-canvas" tabIndex={0} role="img" aria-label={props.label} style={{ cursor: props.cursor ?? 'default' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => latest.current.onLeave?.()}
        onDoubleClick={(e) => { const { p } = pos(e); latest.current.onDoubleClick?.(p, e, view.current.scale) }}
        onContextMenu={(e) => { e.preventDefault(); const { p } = pos(e); latest.current.onContextMenu?.(p, e) }}
        onKeyDown={onKeyDown}
      />
      {props.children}
    </div>
  )
})
