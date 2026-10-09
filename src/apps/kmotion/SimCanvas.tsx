// The picture: a HiDPI canvas that draws the scene every animation frame, steps the simulation while it runs
// (fixed steps, see runtime.ts), pans and zooms, and carries the measuring tools. The drawing itself is render.ts.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react'
import { DEFAULT_CANVAS_THEME, readCanvasTheme, useThemed } from './PlotlyChart'
import { drawScene, fitView, screenToWorld, type Camera3, type Measures, type Overlays, type Scales } from './render'
import type { Runtime } from './runtime'
import type { Shape, View } from './types'

export type CanvasTool = 'pan' | 'ruler' | 'protractor' | 'custom'

export interface CanvasHandle {
  fit(): void
  zoomBy(f: number): void
  snapshot(): Promise<Blob | null>
  size(): { w: number; h: number }
}

interface Props {
  rt: Runtime
  /** Changes when the runtime is replaced (a reset, a new scene). */
  epoch: number
  view: View | null
  onView(v: View, manual: boolean): void
  overlays: Overlays
  scales: Scales
  tool: CanvasTool
  measures: Measures
  onMeasures(m: Measures): void
  /** For the sandbox's own tools: return true to take the event. */
  onPointer?(kind: 'down' | 'move' | 'up', x: number, y: number, e: PointerEvent | React.PointerEvent): boolean
  onDoubleClick?(x: number, y: number): boolean
  ghost?: Shape[]
  selection?: Shape[]
  cam3: Camera3 | null
  onCam3(c: Camera3): void
  /** Called about 10 times a second while the scene runs (the panels refresh from it). */
  onTick(): void
  /** Called when the simulation reaches its end. */
  onFinished?(): void
  cursor?: string
  /** Notes drawn over the picture (a status line, an empty-state card). */
  children?: ReactNode
}

const SimCanvas = forwardRef<CanvasHandle, Props>(function SimCanvas(p, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 300, h: 200, dpr: 1 })
  const props = useRef(p)
  props.current = p
  const dirty = useRef(true)
  const theme = useThemed(readCanvasTheme, DEFAULT_CANVAS_THEME)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const drag = useRef<{ kind: 'pan' | 'rot' | 'ruler' | 'custom'; x: number; y: number; view: View; cam?: Camera3 } | null>(null)
  const lastFinished = useRef(false)

  // anything that changes the picture asks for a redraw
  useEffect(() => { dirty.current = true })

  const currentView = useCallback((): View => {
    const v = props.current.view
    if (v) return v
    return fitView(props.current.rt.sim.bounds(), size.current.w, size.current.h)
  }, [])

  const doFit = useCallback(() => {
    const { w, h } = size.current
    const rt = props.current.rt
    props.current.onView(fitView(rt.sim.bounds(), w, h), false)
    dirty.current = true
  }, [])

  useImperativeHandle(ref, () => ({
    fit: doFit,
    zoomBy: (f: number) => {
      const v = currentView()
      props.current.onView({ ...v, scale: Math.min(1e7, Math.max(1e-6, v.scale * f)) }, true)
    },
    snapshot: () => new Promise((resolve) => {
      const c = canvas.current
      if (!c) return resolve(null)
      dirty.current = true
      c.toBlob((b) => resolve(b), 'image/png')
    }),
    size: () => ({ w: size.current.w, h: size.current.h }),
  }), [doFit, currentView])

  // sizing: CSS pixels for the layout, device pixels for the bitmap (crisp on HiDPI, refit when the density changes)
  useLayoutEffect(() => {
    const el = wrap.current
    const c = canvas.current
    if (!el || !c) return
    let media: MediaQueryList | null = null
    const fit = () => {
      const r = el.getBoundingClientRect()
      const w = Math.max(1, Math.floor(r.width))
      const h = Math.max(1, Math.floor(r.height))
      const dpr = window.devicePixelRatio || 1
      if (r.width < 2 || r.height < 2) return
      const first = !props.current.view
      size.current = { w, h, dpr }
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      dirty.current = true
      if (first) props.current.onView(fitView(props.current.rt.sim.bounds(), w, h), false)
    }
    const onDensity = () => { fit(); watch() }
    const watch = () => {
      media?.removeEventListener('change', onDensity)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      media.addEventListener('change', onDensity)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    watch()
    return () => { ro.disconnect(); media?.removeEventListener('change', onDensity) }
  }, [])

  // the loop: step while running, draw when something changed
  useEffect(() => {
    let id = 0
    let last = performance.now()
    let lastTick = 0
    const frame = (now: number) => {
      id = requestAnimationFrame(frame)
      const pr = props.current
      const rt = pr.rt
      const dt = (now - last) / 1000
      last = now
      let stepped = 0
      if (rt.running) stepped = rt.advance(dt)
      if (rt.sim.finished && !lastFinished.current) { lastFinished.current = true; pr.onFinished?.() }
      if (!rt.sim.finished) lastFinished.current = false
      if (now - lastTick > 100 && (rt.running || stepped > 0)) { lastTick = now; pr.onTick() }
      if (!dirty.current && !rt.running) return
      dirty.current = false
      const c = canvas.current
      if (!c) return
      const ctx = c.getContext('2d')
      if (!ctx) return
      const { w, h, dpr } = size.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const view = pr.view ?? fitView(rt.sim.bounds(), w, h)
      rt.trailMin = 1.5 / view.scale
      const frameData = rt.sim.frame()
      let focus = view
      if (frameData.focus) focus = { ...view, cx: frameData.focus.x, cy: frameData.focus.y }
      drawScene(ctx, w, h, {
        view: focus, frame: frameData, overlays: pr.overlays, scales: pr.scales, theme: themeRef.current, trails: rt.trails, measures: pr.measures, lengthUnit: rt.sim.lengthUnit,
        energy: pr.overlays.energy ? rt.sim.energy() : null, e0: rt.e0, ghost: pr.ghost, selection: pr.selection, cam3: pr.cam3, ref: { v: rt.refV, a: rt.refA, f: rt.refF },
      })
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [])

  // ---------------------------------------------------------------------------------------- pointer

  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = wrap.current!.getBoundingClientRect()
    const v = currentView()
    return screenToWorld(v, size.current.w, size.current.h, e.clientX - r.left, e.clientY - r.top)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const pr = props.current
    wrap.current?.focus()
    const target = e.currentTarget as HTMLElement
    const [wx, wy] = toWorld(e)
    const v = currentView()
    if (e.button === 1 || e.button === 2) {
      // the middle and right buttons always pan, whatever the tool
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view: v }
      target.setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    if (pr.cam3 && e.button === 0) {
      drag.current = { kind: 'rot', x: e.clientX, y: e.clientY, view: v, cam: pr.cam3 }
      target.setPointerCapture(e.pointerId)
      return
    }
    // the scene's own tools (sandbox) first, with the left button
    if (e.button === 0 && pr.onPointer && pr.tool === 'custom') {
      if (pr.onPointer('down', wx, wy, e)) {
        drag.current = { kind: 'custom', x: e.clientX, y: e.clientY, view: v }
        target.setPointerCapture(e.pointerId)
        dirty.current = true
        return
      }
    }
    if (e.button === 0 && pr.tool === 'ruler') {
      drag.current = { kind: 'ruler', x: e.clientX, y: e.clientY, view: v }
      pr.onMeasures({ ...pr.measures, live: { x1: wx, y1: wy, x2: wx, y2: wy } })
      target.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 0 && pr.tool === 'protractor') {
      const m = pr.measures
      const cur = m.protractor
      if (!cur || (cur.a && cur.b)) pr.onMeasures({ ...m, protractor: { v: [wx, wy], a: null, b: null, hover: null } })
      else if (!cur.a) pr.onMeasures({ ...m, protractor: { ...cur, a: [wx, wy], hover: null } })
      else pr.onMeasures({ ...m, protractor: { ...cur, b: [wx, wy], hover: null } })
      dirty.current = true
      return
    }
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view: v }
    target.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pr = props.current
    const d = drag.current
    const [wx, wy] = toWorld(e)
    if (!d) {
      if (pr.tool === 'protractor' && pr.measures.protractor && !(pr.measures.protractor.a && pr.measures.protractor.b)) {
        // preview of the arm that is being placed
        pr.onMeasures({ ...pr.measures, protractor: { ...pr.measures.protractor, hover: [wx, wy] } })
      } else if (pr.tool === 'custom') pr.onPointer?.('move', wx, wy, e)
      return
    }
    if (d.kind === 'rot' && d.cam) {
      pr.onCam3({ yaw: d.cam.yaw + (e.clientX - d.x) * 0.01, pitch: Math.max(-1.6, Math.min(1.6, d.cam.pitch + (e.clientY - d.y) * 0.01)) })
      dirty.current = true
    } else if (d.kind === 'pan') {
      pr.onView({ ...d.view, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale }, true)
    } else if (d.kind === 'ruler' && pr.measures.live) {
      pr.onMeasures({ ...pr.measures, live: { ...pr.measures.live, x2: wx, y2: wy } })
    } else if (d.kind === 'custom') {
      pr.onPointer?.('move', wx, wy, e)
      dirty.current = true
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const pr = props.current
    const d = drag.current
    drag.current = null
    if (!d) return
    const [wx, wy] = toWorld(e)
    if (d.kind === 'ruler' && pr.measures.live) {
      const l = pr.measures.live
      const long = Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * currentView().scale > 4
      pr.onMeasures({ ...pr.measures, live: null, rulers: long ? [...pr.measures.rulers.slice(-4), l] : pr.measures.rulers })
    } else if (d.kind === 'custom') {
      pr.onPointer?.('up', wx, wy, e)
      dirty.current = true
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const pr = props.current
    const v = currentView()
    const r = wrap.current!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
    const scale = Math.min(1e7, Math.max(1e-6, v.scale * f))
    const [wx, wy] = screenToWorld(v, size.current.w, size.current.h, sx, sy)
    // keep the world point under the cursor where it is
    const cx = wx - (sx - size.current.w / 2) / scale
    const cy = wy + (sy - size.current.h / 2) / scale
    pr.onView({ cx, cy, scale }, true)
  }

  // React attaches wheel listeners as passive; a native non-passive one lets us keep the page from scrolling
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const stop = (e: WheelEvent) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])

  const cursor = p.cursor ?? (p.cam3 ? 'grab' : p.tool === 'ruler' || p.tool === 'protractor' ? 'crosshair' : p.tool === 'custom' ? 'crosshair' : 'grab')

  return (
    <div
      ref={wrap}
      className="mo-stage"
      tabIndex={0}
      aria-label="Simulation view. Drag to pan, scroll to zoom, double-click to fit."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        const [x, y] = toWorld(e)
        if (props.current.onDoubleClick?.(x, y)) return
        doFit()
      }}
      style={{ cursor }}
    >
      <canvas ref={canvas} className="mo-canvas" style={{ width: '100%', height: '100%' }} />
      {p.children}
    </div>
  )
})

export default SimCanvas
