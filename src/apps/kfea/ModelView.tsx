// The drawing: a canvas that pans and zooms, draws the scene (scene.ts) and turns the pointer into editing actions
// (KFEA.tsx applies them). The contour of a plate is rasterised under the primitives (post.ts).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { moveNodes, moveVertex, pickFrame, pickInBox, pickPlate, snapTo, type PlatePick } from './editor'
import { rasterize } from './post'
import { buildScene, fitView, toScreen, toWorld, LIGHT_PALETTE, type Palette, type Prim, type Scene, type SceneOptions, type View } from './scene'
import { drawPrims } from './draw'
import { modelBox, type Model, type Pt, type Target } from './model'
import type { Mesh } from './mesh'
import type { AnyResult } from './scene'
import type { SupportKind } from './editor'

export type Tool =
  | { kind: 'select' }
  | { kind: 'node' }
  | { kind: 'member' }
  | { kind: 'support'; support: SupportKind }
  | { kind: 'load' }
  | { kind: 'outline' }
  | { kind: 'hole' }
  | { kind: 'circle' }
  | { kind: 'psupport'; ux: boolean; uy: boolean }
  | { kind: 'pload'; load: 'pressure' | 'tx' | 'ty' | 'force' }
  | { kind: 'refine' }
  | { kind: 'probe' }

export type NodeRef = string | Pt

export type CanvasAction =
  | { type: 'select'; ids: string[]; additive: boolean }
  | { type: 'addNode'; at: Pt; onMember?: string }
  | { type: 'addMember'; from: NodeRef; to: NodeRef }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'moveVertex'; loop: number; index: number; to: Pt }
  | { type: 'moveLoop'; loop: number; dx: number; dy: number }
  | { type: 'support'; node: string }
  | { type: 'load'; node?: string; member?: string; at?: number }
  | { type: 'outline'; pts: Pt[] }
  | { type: 'hole'; pts: Pt[] }
  | { type: 'circle'; center: Pt; r: number }
  | { type: 'insertVertex'; loop: number; edge: number; at: Pt }
  | { type: 'plateTarget'; target: Target; kind: 'support' | 'load' }
  | { type: 'refine'; at: Pt }
  | { type: 'probe'; at: Pt }
  | { type: 'context'; x: number; y: number; target: { kind: 'node' | 'member' | 'vertex' | 'edge' | 'none'; id?: string; loop?: number; index?: number } }

export interface ModelViewHandle {
  fit(): void
  zoomBy(f: number): void
  cancel(): boolean
  finish(): boolean
  /** The picture as PNG bytes. */
  png(): Promise<Uint8Array>
  size(): { w: number; h: number }
}

interface Props {
  model: Model
  result: AnyResult | null
  mesh: Mesh | null
  scene: SceneOptions
  tool: Tool
  selection: ReadonlySet<string>
  grid: number
  snap: boolean
  /** a mark in the model (the probe) */
  marker: Pt | null
  onAction(a: CanvasAction): void
  onCursor(p: Pt | null): void
  fitKey: number
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'box'; a: Pt; b: Pt; shift: boolean }
  | { kind: 'nodes'; ids: string[]; start: Pt; moved: boolean }
  | { kind: 'vertex'; loop: number; index: number; start: Pt; moved: boolean }
  | { kind: 'circle'; center: Pt }

const PICK_PX = 9

export function paletteOf(el: Element): Palette {
  const cs = getComputedStyle(el)
  const v = (name: string, d: string) => cs.getPropertyValue(name).trim() || d
  const bg = v('--k-bg', LIGHT_PALETTE.bg)
  return {
    fg: v('--k-text', LIGHT_PALETTE.fg), muted: v('--k-muted', LIGHT_PALETTE.muted), accent: v('--k-accent', LIGHT_PALETTE.accent), danger: v('--k-danger', LIGHT_PALETTE.danger),
    success: v('--k-success', LIGHT_PALETTE.success), warning: v('--k-warning', LIGHT_PALETTE.warning), link: v('--k-link', LIGHT_PALETTE.link), bg, bgmix: bg,
    grid: `color-mix(in srgb, ${v('--k-muted', '#888')} 60%, transparent)`, plate: v('--k-surface', LIGHT_PALETTE.plate), meshline: `color-mix(in srgb, ${v('--k-text', '#000')} 30%, transparent)`,
  }
}

export const ModelView = forwardRef<ModelViewHandle, Props>(function ModelView(props, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const off = useRef<HTMLCanvasElement | null>(null)
  const pixels = useRef<Uint8ClampedArray | null>(null)
  const size = useRef({ w: 800, h: 600, dpr: 1 })
  const view = useRef<View>({ cx: 0, cy: 0, scale: 100, w: 800, h: 600 })
  const gesture = useRef<Gesture | null>(null)
  const cursor = useRef<Pt | null>(null)
  const draft = useRef<{ kind: 'member'; from: NodeRef } | { kind: 'poly'; pts: Pt[] } | null>(null)
  const drag = useRef<{ model: Model } | null>(null)
  const space = useRef(false)
  const raf = useRef(0)
  const latest = useRef(props)
  latest.current = props

  const schedule = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => { raf.current = 0; paint() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toW = (sx: number, sy: number): Pt => toWorld(view.current, sx, sy)
  const evPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const tol = () => PICK_PX / view.current.scale
  const snapped = (p: Pt): Pt => {
    const { snap, grid } = latest.current
    return snap && grid > 0 ? { x: snapTo(p.x, grid), y: snapTo(p.y, grid) } : p
  }

  const fit = useCallback(() => {
    const { model, result } = latest.current
    let box = modelBox(model)
    if (result?.kind === 'modal' || result?.kind === 'buckling') box = modelBox(model)
    const pad = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1e-9) * 0.04
    const v = fitView({ x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad }, size.current.w, size.current.h, 70)
    view.current = v
    schedule()
  }, [schedule])

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (f) => { view.current = { ...view.current, scale: Math.min(1e9, Math.max(1e-6, view.current.scale * f)) }; schedule() },
    cancel: () => {
      if (draft.current || gesture.current) { draft.current = null; gesture.current = null; drag.current = null; schedule(); return true }
      return false
    },
    finish: () => {
      const d = draft.current
      if (d?.kind === 'poly' && d.pts.length >= 3) { closeDraft(); return true }
      return false
    },
    size: () => ({ w: size.current.w, h: size.current.h }),
    png: () => new Promise((resolve, reject) => {
      paint()
      canvas.current?.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('The picture could not be made.'))), 'image/png')
    }),
  }))

  function closeDraft() {
    const d = draft.current
    if (!d || d.kind !== 'poly') return
    const { tool, onAction } = latest.current
    draft.current = null
    if (d.pts.length >= 3) onAction({ type: tool.kind === 'hole' ? 'hole' : 'outline', pts: d.pts })
    schedule()
  }

  // ------------------------------------------------------------ painting

  function paint() {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const { w, h, dpr } = size.current
    const { model, result, mesh, scene, selection, marker, tool } = latest.current
    const v = { ...view.current, w, h }
    view.current = v
    const pal = paletteOf(cv)
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, cv.width, cv.height)
    const shown = drag.current?.model ?? model
    const sc: Scene = buildScene(shown, result, v, { ...scene, selected: selection }, mesh)
    if (sc.plate) {
      const W = Math.max(1, Math.floor(w * dpr))
      const H = Math.max(1, Math.floor(h * dpr))
      if (!pixels.current || pixels.current.length !== W * H * 4) pixels.current = new Uint8ClampedArray(W * H * 4)
      else pixels.current.fill(0)
      const buf = pixels.current
      const pts = new Float64Array(sc.plate.pts.length)
      for (let i = 0; i < pts.length; i++) pts[i] = sc.plate.pts[i] * dpr
      const r = result as Extract<AnyResult, { kind: 'plane' }>
      const ro = scene.result!
      rasterize(buf, W, H, pts, r.mesh, sc.plate.values, ro.nodalMode, sc.plate.range, ro.cmap, ro.bands)
      if (!off.current) off.current = document.createElement('canvas')
      off.current.width = W
      off.current.height = H
      off.current.getContext('2d')!.putImageData(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0)
      ctx.drawImage(off.current, 0, 0)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawPrims(ctx, sc.prims, pal, family)
    // overlays
    const overlay: Prim[] = []
    const d = draft.current
    const c = cursor.current
    if (d?.kind === 'member' && c) {
      const a = typeof d.from === 'string' ? model.nodes.find((n) => n.id === d.from) : d.from
      if (a) { const [x1, y1] = toScreen(v, a.x, a.y); const [x2, y2] = toScreen(v, c.x, c.y); overlay.push({ t: 'line', x1, y1, x2, y2, c: 'accent', w: 2, dash: [6, 4] }) }
    }
    if (d?.kind === 'poly') {
      const pts: number[] = []
      for (const p of d.pts) pts.push(...toScreen(v, p.x, p.y))
      if (c) pts.push(...toScreen(v, c.x, c.y))
      overlay.push({ t: 'poly', pts, closed: false, stroke: 'accent', w: 2, dash: [6, 4] })
      for (const p of d.pts) { const [x, y] = toScreen(v, p.x, p.y); overlay.push({ t: 'circle', x, y, r: 3.5, fill: 'accent', w: 1 }) }
    }
    const g = gesture.current
    if (g?.kind === 'box') {
      const [x1, y1] = toScreen(v, g.a.x, g.a.y)
      const [x2, y2] = toScreen(v, g.b.x, g.b.y)
      overlay.push({ t: 'poly', pts: [x1, y1, x2, y1, x2, y2, x1, y2], closed: true, stroke: 'link', w: 1, dash: [4, 3], fill: 'link', alpha: 0.08 })
    }
    if (g?.kind === 'circle' && c) {
      const [cx, cy] = toScreen(v, g.center.x, g.center.y)
      overlay.push({ t: 'circle', x: cx, y: cy, r: Math.hypot(c.x - g.center.x, c.y - g.center.y) * v.scale, stroke: 'accent', w: 2 })
    }
    if (marker) {
      const [x, y] = toScreen(v, marker.x, marker.y)
      overlay.push({ t: 'circle', x, y, r: 7, stroke: 'warning', w: 2 }, { t: 'line', x1: x - 12, y1: y, x2: x + 12, y2: y, c: 'warning', w: 1 }, { t: 'line', x1: x, y1: y - 12, x2: x, y2: y + 12, c: 'warning', w: 1 })
    }
    if (c && (tool.kind === 'node' || tool.kind === 'member' || tool.kind === 'outline' || tool.kind === 'hole' || tool.kind === 'circle' || tool.kind === 'refine')) {
      const [x, y] = toScreen(v, c.x, c.y)
      overlay.push({ t: 'line', x1: x - 6, y1: y, x2: x + 6, y2: y, c: 'accent', w: 1 }, { t: 'line', x1: x, y1: y - 6, x2: x, y2: y + 6, c: 'accent', w: 1 })
    }
    drawPrims(ctx, overlay, pal, family)
  }

  // ------------------------------------------------------------ size, wheel

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { w: Math.max(50, r.width), h: Math.max(50, r.height), dpr }
      if (canvas.current) { canvas.current.width = Math.floor(r.width * dpr); canvas.current.height = Math.floor(r.height * dpr) }
      if (first) { first = false; fit() } else schedule()
    })
    ro.observe(el)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = evPoint(e)
      const before = toW(p.x, p.y)
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const v = view.current
      const scale = Math.min(1e9, Math.max(1e-6, v.scale * f))
      // keep the point under the cursor fixed
      view.current = { ...v, scale, cx: before.x - (p.x - v.w / 2) / scale, cy: before.y + (p.y - v.h / 2) / scale }
      schedule()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fit() }, [props.fitKey, fit])
  useEffect(() => { schedule() })
  useEffect(() => {
    // a tool change ends a half-drawn shape
    draft.current = null
    gesture.current = null
    schedule()
  }, [props.tool.kind, schedule])
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input, textarea, select')) space.current = true }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // ------------------------------------------------------------ pointer

  const onPointerDown = (e: React.PointerEvent) => {
    wrap.current?.focus()
    const sp = evPoint(e)
    const raw = toW(sp.x, sp.y)
    const { model, tool, onAction, selection } = latest.current
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space.current)) {
      if (e.button === 2) {
        // a right click without a drag opens the context menu: decided on pointer up
        gesture.current = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.current.cx, cy: view.current.cy }
        ;(gesture.current as Gesture & { right?: boolean }).right = true
      } else gesture.current = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.current.cx, cy: view.current.cy }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = tol()
    const plate = !!model.plate
    const pt = snapped(raw)
    switch (tool.kind) {
      case 'select': {
        if (plate) {
          const pk = pickPlate(model, raw.x, raw.y, t)
          if (pk?.kind === 'vertex') {
            const id = `plate:v:${pk.loop}:${pk.index}`
            onAction({ type: 'select', ids: [id], additive: e.shiftKey })
            gesture.current = { kind: 'vertex', loop: pk.loop, index: pk.index, start: raw, moved: false }
          } else if (pk) onAction({ type: 'select', ids: [`plate:e:${pk.loop}:${pk.index}`], additive: e.shiftKey })
          else { onAction({ type: 'select', ids: [], additive: false }) }
          break
        }
        const pk = pickFrame(model, raw.x, raw.y, t)
        if (pk?.kind === 'node') {
          const ids = selection.has(pk.id) && !e.shiftKey ? [...selection].filter((i) => model.nodes.some((n) => n.id === i)) : [pk.id]
          if (!selection.has(pk.id) || e.shiftKey) onAction({ type: 'select', ids: [pk.id], additive: e.shiftKey })
          gesture.current = { kind: 'nodes', ids, start: raw, moved: false }
        } else if (pk) onAction({ type: 'select', ids: [pk.id], additive: e.shiftKey })
        else gesture.current = { kind: 'box', a: raw, b: raw, shift: e.shiftKey }
        break
      }
      case 'probe': onAction({ type: 'probe', at: raw }); break
      case 'node': {
        const pk = pickFrame(model, raw.x, raw.y, t)
        if (pk?.kind === 'member') {
          const m = model.members.find((x) => x.id === pk.id)!
          const a = model.nodes.find((n) => n.id === m.n1)!
          const b = model.nodes.find((n) => n.id === m.n2)!
          const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
          const s = Math.max(0, Math.min(1, ((raw.x - a.x) * (b.x - a.x) + (raw.y - a.y) * (b.y - a.y)) / L2))
          onAction({ type: 'addNode', at: { x: a.x + s * (b.x - a.x), y: a.y + s * (b.y - a.y) }, onMember: pk.id })
        } else if (pk?.kind !== 'node') onAction({ type: 'addNode', at: pt })
        break
      }
      case 'member': {
        const pk = pickFrame(model, raw.x, raw.y, t)
        const ref: NodeRef = pk?.kind === 'node' ? pk.id : pt
        const d = draft.current
        if (d?.kind === 'member') {
          onAction({ type: 'addMember', from: d.from, to: ref })
          draft.current = { kind: 'member', from: typeof ref === 'string' ? ref : ref }
          // the new node got its id in the app; continue from the position (it is found again by place)
        } else draft.current = { kind: 'member', from: ref }
        break
      }
      case 'support': {
        const pk = pickFrame(model, raw.x, raw.y, t)
        if (pk?.kind === 'node') onAction({ type: 'support', node: pk.id })
        break
      }
      case 'load': {
        const pk = pickFrame(model, raw.x, raw.y, t)
        if (pk?.kind === 'node') onAction({ type: 'load', node: pk.id })
        else if (pk?.kind === 'member') onAction({ type: 'load', member: pk.id })
        break
      }
      case 'outline': case 'hole': {
        const d = draft.current
        if (d?.kind === 'poly') {
          const first = d.pts[0]
          if (d.pts.length >= 3 && Math.hypot(first.x - raw.x, first.y - raw.y) < t * 1.2) { closeDraft(); break }
          d.pts.push(pt)
        } else draft.current = { kind: 'poly', pts: [pt] }
        break
      }
      case 'circle': {
        const g = gesture.current
        if (g?.kind === 'circle') {
          gesture.current = null
          const r = Math.hypot(pt.x - g.center.x, pt.y - g.center.y)
          if (r > 0) onAction({ type: 'circle', center: g.center, r })
        } else gesture.current = { kind: 'circle', center: pt }
        break
      }
      case 'refine': onAction({ type: 'refine', at: pt }); break
      case 'psupport': case 'pload': {
        const pk: PlatePick | null = pickPlate(model, raw.x, raw.y, t)
        if (!pk) break
        const target: Target = pk.kind === 'vertex' ? { kind: 'vertex', loop: pk.loop, vertex: pk.index } : { kind: 'edge', loop: pk.loop, edge: pk.index }
        if (tool.kind === 'pload' && pk.kind === 'vertex') onAction({ type: 'plateTarget', target, kind: 'load' })
        else onAction({ type: 'plateTarget', target, kind: tool.kind === 'psupport' ? 'support' : 'load' })
        break
      }
    }
    schedule()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = evPoint(e)
    const raw = toW(sp.x, sp.y)
    const { model, onCursor } = latest.current
    const p = snapped(raw)
    cursor.current = p
    onCursor(p)
    const g = gesture.current
    if (g?.kind === 'pan') {
      const v = view.current
      view.current = { ...v, cx: g.cx - (sp.x - g.sx) / v.scale, cy: g.cy + (sp.y - g.sy) / v.scale }
      if (Math.hypot(sp.x - g.sx, sp.y - g.sy) > 3) (g as Gesture & { right?: boolean }).right = false
    } else if (g?.kind === 'box') g.b = raw
    else if (g?.kind === 'nodes') {
      const dx = snapped(raw).x - snapped(g.start).x
      const dy = snapped(raw).y - snapped(g.start).y
      if (Math.hypot(raw.x - g.start.x, raw.y - g.start.y) * view.current.scale > 3) g.moved = true
      if (g.moved) drag.current = { model: moveNodes(model, new Set(g.ids), dx, dy) }
    } else if (g?.kind === 'vertex') {
      if (Math.hypot(raw.x - g.start.x, raw.y - g.start.y) * view.current.scale > 3) g.moved = true
      if (g.moved) drag.current = { model: moveVertex(model, g.loop, g.index, p.x, p.y) }
    }
    schedule()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const sp = evPoint(e)
    const raw = toW(sp.x, sp.y)
    const { model, onAction, selection } = latest.current
    const g = gesture.current as (Gesture & { right?: boolean }) | null
    if (g?.kind === 'pan') {
      gesture.current = null
      if (g.right) {
        const t = tol()
        let target: Extract<CanvasAction, { type: 'context' }>['target'] = { kind: 'none' }
        if (model.plate) {
          const pk = pickPlate(model, raw.x, raw.y, t)
          if (pk) target = { kind: pk.kind, loop: pk.loop, index: pk.index }
        } else {
          const pk = pickFrame(model, raw.x, raw.y, t)
          if (pk) target = { kind: pk.kind, id: pk.id }
        }
        onAction({ type: 'context', x: e.clientX, y: e.clientY, target })
      }
    } else if (g?.kind === 'box') {
      gesture.current = null
      if (Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) * view.current.scale > 4) onAction({ type: 'select', ids: pickInBox(model, g.a.x, g.a.y, g.b.x, g.b.y), additive: g.shift })
      else if (selection.size) onAction({ type: 'select', ids: [], additive: false })
    } else if (g?.kind === 'nodes') {
      gesture.current = null
      const moved = drag.current
      drag.current = null
      if (g.moved && moved) {
        const a = snapped(g.start)
        const b = snapped(raw)
        onAction({ type: 'move', ids: g.ids, dx: b.x - a.x, dy: b.y - a.y })
      }
    } else if (g?.kind === 'vertex') {
      gesture.current = null
      drag.current = null
      if (g.moved) onAction({ type: 'moveVertex', loop: g.loop, index: g.index, to: snapped(raw) })
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    schedule()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const sp = evPoint(e)
    const raw = toW(sp.x, sp.y)
    const { model, tool, onAction } = latest.current
    if (tool.kind === 'outline' || tool.kind === 'hole') {
      const d = draft.current
      if (d?.kind === 'poly') {
        // the double click added the same point twice: drop the duplicate
        if (d.pts.length >= 2 && Math.hypot(d.pts[d.pts.length - 1].x - d.pts[d.pts.length - 2].x, d.pts[d.pts.length - 1].y - d.pts[d.pts.length - 2].y) < 1e-12) d.pts.pop()
        closeDraft()
      }
      return
    }
    if (tool.kind === 'select' && model.plate) {
      const pk = pickPlate(model, raw.x, raw.y, tol())
      if (pk?.kind === 'edge') onAction({ type: 'insertVertex', loop: pk.loop, edge: pk.index, at: pk.at })
    }
  }

  const onPointerLeave = () => { cursor.current = null; latest.current.onCursor(null); schedule() }

  return (
    <div ref={wrap} className="fe-canvas" tabIndex={-1} role="application" aria-label="Drawing of the structure: click to edit, wheel to zoom, right button to pan" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvas} className="fe-canvas-el" />
    </div>
  )
})
