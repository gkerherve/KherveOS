// The 2D board: a canvas with pan / zoom, the tools (select, place, route, via, zone, outline, hole,
// measure, assign nets) and their previews. The pure work is in ops.ts / route.ts; this file turns
// pointer and keys into those calls.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { MenuItem } from '@/os'
import type { Pt } from './geom.ts'
import { polyBox } from './geom.ts'
import type { RatLine } from './analysis.ts'
import { addPart, addHole, addTrackPath, addVia, adoptNets, addZone, dragTrack, itemKey, moveVia, pickAt, pickInBox, setOutlinePoly, setOutlineRect, snapPt } from './ops.ts'
import type { Item } from './ops.ts'
import { assignPad } from './ops.ts'
import { drawScene, toWorldPt } from './draw.ts'
import type { Overlay, View } from './draw.ts'
import { copperAt, nextPoints, previewSegments, routeClash } from './route.ts'
import type { RouteState } from './route.ts'
import { frameBox } from './layers.ts'
import { netClassOf, otherSide, padNets, worldPads } from './board.ts'
import { VIA_PRESETS } from './types.ts'
import type { CopperId, Design, Fills, Part, Violation } from './types.ts'
import type { Editor, UIState } from './ui.ts'

export interface BoardViewHandle {
  fit(): void
  zoomTo(p: Pt, scale?: number): void
  zoomBy(factor: number): void
  /** The snapped world position of the pointer, if it is over the board. */
  cursor(): Pt | null
  /** Keys that depend on what the tool is doing. True when handled. */
  key(e: KeyboardEvent): boolean
  /** Is a route or a polygon being drawn? */
  busy(): boolean
}

interface Props {
  ed: Editor
  design: Design
  fills: Fills
  ratsnest: readonly RatLine[]
  markers: readonly Violation[]
  sel: readonly Item[]
  hoverNet: string
  ui: UIState
  selectedMarker: string | null
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean; button: number }
  | { kind: 'box'; a: Pt; b: Pt; shift: boolean }
  | { kind: 'drag'; start: Pt; origin: Pt; base: Design; items: Item[]; moved: boolean; sx: number; sy: number }
  | { kind: 'vertex'; target: 'outline' | 'zone'; index: number; zone?: string; base: Design; moved: boolean }
  | { kind: 'rect'; a: Pt; base: Design; moved: boolean }
  | { kind: 'measure'; moved: boolean; sx: number; sy: number }

interface Measure {
  a: Pt
  b: Pt
  fixed: boolean
}

const PX_PICK = 7

export const BoardView = forwardRef<BoardViewHandle, Props>(function BoardView(props, ref) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 800, h: 600, dpr: 1 })
  const view = useRef<View>({ cx: 25, cy: 25, scale: 8, flip: false })
  const raw = useRef<Pt | null>(null)
  const cur = useRef<Pt | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const route = useRef<(RouteState & { base: Design; start: Pt; snaps: Array<{ design: Design; pts: Pt[]; layer: CopperId }> }) | null>(null)
  const draft = useRef<{ tool: 'zone' | 'outline-poly'; pts: Pt[] } | null>(null)
  const measure = useRef<Measure | null>(null)
  const space = useRef(false)
  const raf = useRef(0)
  const fitted = useRef(false)
  const clash = useRef<{ bad: boolean; msg: string }>({ bad: false, msg: '' })
  const latest = useRef(props)
  latest.current = props

  const schedule = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      paint()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ coordinates

  const toWorld = (sx: number, sy: number): Pt => toWorldPt(view.current, size.current.w, size.current.h, { x: sx, y: sy })
  const evPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const visibleLayers = (): Set<string> => {
    const v = latest.current.ui.ap.visible
    return new Set(Object.keys(v).filter((k) => v[k as keyof typeof v]))
  }
  const tol = () => PX_PICK / view.current.scale

  /** Snap to copper first (pad centres, vias, track ends of a net), then to the grid. */
  const snapped = (p: Pt, layer?: CopperId): Pt => {
    const { design, ui } = latest.current
    if (layer) {
      const c = copperAt(design, p, tol(), layer)
      if (c) return c.p
    }
    return snapPt(p, ui.grid)
  }

  // ------------------------------------------------------------ handle

  const fit = () => {
    const { design } = latest.current
    const b = frameBox(design)
    const { w, h } = size.current
    const bw = Math.max(1, b.x1 - b.x0)
    const bh = Math.max(1, b.y1 - b.y0)
    view.current = { ...view.current, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.max(1, Math.min(w / (bw * 1.12), h / (bh * 1.12))) }
    schedule()
  }

  const finishRoute = () => {
    const rs = route.current
    if (!rs) return
    const { ed } = latest.current
    route.current = null
    clash.current = { bad: false, msg: '' }
    ed.preview(adoptNets(ed.design))
    ed.end()
    ed.refill()
    schedule()
  }

  const closeDraft = () => {
    const dr = draft.current
    if (!dr) return
    const { ed, design, ui } = latest.current
    draft.current = null
    if (dr.pts.length < 3) {
      ed.say('A polygon needs at least three corners.')
      schedule()
      return
    }
    if (dr.tool === 'zone') {
      const gnd = design.nets.find((n) => /^GND/i.test(n.name))?.name ?? ''
      const r = addZone(design, dr.pts, gnd, ui.active)
      ed.commit(r.design)
      ed.setSel([{ kind: 'zone', id: r.id }])
      ed.refill()
      ed.say(gnd ? `Zone on ${ui.active} connected to ${gnd}. Change its net in the Properties.` : 'Zone added: choose its net in the Properties.')
    } else {
      ed.commit(setOutlinePoly(design, dr.pts))
      ed.setSel([{ kind: 'outline', id: 'outline' }])
    }
    schedule()
  }

  const cancelAll = (): boolean => {
    let did = false
    if (route.current) {
      finishRoute()
      did = true
    }
    if (draft.current) {
      draft.current = null
      did = true
    }
    if (gesture.current && gesture.current.kind !== 'pan') {
      const g = gesture.current
      gesture.current = null
      if ('moved' in g && g.moved) latest.current.ed.cancel()
      did = true
    }
    if (measure.current) {
      measure.current = null
      did = true
    }
    schedule()
    return did
  }

  const routeVia = () => {
    const rs = route.current
    const { ed, ui } = latest.current
    if (!rs || !cur.current) return
    const last = rs.pts[rs.pts.length - 1]
    const pts = nextPoints(last, cur.current, rs.mode, rs.flip)
    const end = pts[pts.length - 1]
    let d = addTrackPath(ed.design, [last, ...pts], rs.layer, rs.width, rs.net).design
    const cls = netClassOf(d, rs.net)
    const size2 = ui.viaIndex >= 0 ? VIA_PRESETS[ui.viaIndex] : { d: cls.via, drill: cls.drill }
    d = addVia(d, end.x, end.y, rs.net, size2).design
    const next = otherSide(rs.layer)
    rs.snaps.push({ design: ed.design, pts: [...rs.pts], layer: rs.layer })
    rs.pts = [end]
    rs.layer = next
    ed.preview(d)
    ed.patchUI({ active: next })
    schedule()
  }

  useImperativeHandle(ref, () => ({
    fit,
    zoomTo: (p, scale) => {
      view.current = { ...view.current, cx: p.x, cy: p.y, scale: scale ?? Math.max(view.current.scale, 20) }
      schedule()
    },
    zoomBy: (f) => {
      view.current = { ...view.current, scale: Math.max(0.5, Math.min(600, view.current.scale * f)) }
      schedule()
    },
    cursor: () => cur.current,
    busy: () => !!(route.current || draft.current),
    key: (e) => {
      const { ed } = latest.current
      if (e.key === 'Escape') return cancelAll()
      if (e.key === 'Enter') {
        if (route.current) { finishRoute(); return true }
        if (draft.current) { closeDraft(); return true }
        return false
      }
      if (route.current) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          const rs = route.current
          const snap = rs.snaps.pop()
          if (snap) {
            ed.preview(snap.design)
            rs.pts = snap.pts
            rs.layer = snap.layer
            ed.patchUI({ active: snap.layer })
          } else cancelAll()
          schedule()
          return true
        }
        if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey) { routeVia(); return true }
        if (e.key === ' ') { route.current.flip = !route.current.flip; schedule(); return true }
        if (e.key === 'Shift' && !e.repeat) {
          const m = latest.current.ui.routeMode === '45' ? '90' : '45'
          ed.patchUI({ routeMode: m })
          route.current.mode = m
          ed.say(m === '45' ? 'Corners: 45°' : 'Corners: 90°')
          return true
        }
      }
      if (draft.current && (e.key === 'Backspace' || e.key === 'Delete')) {
        draft.current.pts.pop()
        if (!draft.current.pts.length) draft.current = null
        schedule()
        return true
      }
      if (e.key === ' ' && !e.repeat) {
        space.current = true
        return false
      }
      return false
    },
  }))

  // ------------------------------------------------------------ painting

  function paint() {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const { design, fills, ratsnest, markers, sel, hoverNet, ui, selectedMarker } = latest.current
    const { w, h, dpr } = size.current
    view.current.flip = ui.flipView
    const ov: Overlay = { cursor: cur.current, selectedMarker }
    if (ui.tool === 'place' && cur.current) {
      const part: Part = { id: 'ghost', ref: '', value: '', fp: ui.placeFp, x: cur.current.x, y: cur.current.y, rot: ui.placeRot, side: ui.placeSide }
      ov.ghost = part
    }
    const rs = route.current
    if (rs && cur.current) {
      const snapPt2 = routePoint(rs, cur.current)
      const segs = previewSegments(rs, snapPt2)
      const c2 = routeClash(rs.base, segs, rs.layer, rs.width, rs.net, rs.start)
      clash.current = { bad: !!c2, msg: c2 ? `Clearance: too close to ${c2.what}` : '' }
      ov.route = { segs, layer: rs.layer, width: rs.width, bad: !!c2, from: rs.pts[rs.pts.length - 1] }
    }
    if (draft.current) {
      const dr = draft.current
      ov.draft = { pts: cur.current ? [...dr.pts, cur.current] : dr.pts, color: dr.tool === 'zone' ? ui.ap.colors[ui.active] : ui.ap.colors['Edge.Cuts'] }
    }
    if (measure.current) ov.measure = measure.current
    const gs = gesture.current
    if (gs?.kind === 'box') ov.box = { x0: Math.min(gs.a.x, gs.b.x), y0: Math.min(gs.a.y, gs.b.y), x1: Math.max(gs.a.x, gs.b.x), y1: Math.max(gs.a.y, gs.b.y) }
    if (gs?.kind === 'rect' && cur.current) ov.box = { x0: Math.min(gs.a.x, cur.current.x), y0: Math.min(gs.a.y, cur.current.y), x1: Math.max(gs.a.x, cur.current.x), y1: Math.max(gs.a.y, cur.current.y) }
    if (sel.length === 1 && sel[0].kind === 'outline') ov.handles = design.outline.pts
    if (sel.length === 1 && sel[0].kind === 'zone') ov.handles = design.zones.find((z) => z.id === sel[0].id)?.pts
    drawScene(
      g, w, h, dpr, view.current,
      { design, fills, sel: new Set(sel.map(itemKey)), hoverNet, ratsnest, markers, active: ui.active, grid: ui.grid, unit: ui.unit },
      ui.ap, ov,
    )
  }

  /** Where the next click of a route would land: on copper of the net, or on the grid. */
  const routePoint = (rs: { net: string; layer: CopperId; base: Design }, p: Pt): Pt => {
    const c = copperAt(rs.base, p, tol(), rs.layer)
    if (c && (!rs.net || !c.net || c.net === rs.net)) return c.p
    return snapPt(p, latest.current.ui.grid)
  }

  // redraw when anything the picture depends on changes
  useEffect(() => {
    schedule()
  })

  // ------------------------------------------------------------ size, wheel

  useEffect(() => {
    const el = wrap.current
    const c = canvas.current
    if (!el || !c) return
    const resize = () => {
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { w: Math.max(50, r.width), h: Math.max(50, r.height), dpr }
      c.width = Math.round(size.current.w * dpr)
      c.height = Math.round(size.current.h * dpr)
      c.style.width = `${size.current.w}px`
      c.style.height = `${size.current.h}px`
      if (!fitted.current) {
        fitted.current = true
        fit()
      }
      schedule()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = evPoint(e)
      const before = toWorld(p.x, p.y)
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))
      const scale = Math.max(0.5, Math.min(600, view.current.scale * f))
      view.current = { ...view.current, scale }
      const after = toWorld(p.x, p.y)
      view.current = { ...view.current, cx: view.current.cx + before.x - after.x, cy: view.current.cy + before.y - after.y }
      schedule()
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false
    }
    window.addEventListener('keyup', up)
    return () => {
      ro.disconnect()
      c.removeEventListener('wheel', onWheel)
      window.removeEventListener('keyup', up)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ pointer

  const netAt = (p: Pt): string => {
    const { design } = latest.current
    const hit = pickAt(design, p, { tol: tol(), visible: visibleLayers(), active: latest.current.ui.active, kinds: new Set(['via', 'part', 'track']) })
    if (!hit) return ''
    if (hit.kind === 'track') return design.tracks.find((t) => t.id === hit.id)?.net ?? ''
    if (hit.kind === 'via') return design.vias.find((v) => v.id === hit.id)?.net ?? ''
    const part = design.parts.find((q) => q.id === hit.id)
    if (!part) return ''
    const pad = worldPads(part).find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= Math.max(q.w, q.h) / 2 + tol() * 0.3)
    return pad ? (padNets(design).get(`${part.ref}\u0000${pad.n}`) ?? '') : ''
  }

  const startRoute = (p: Pt) => {
    const { ed, design, ui } = latest.current
    let layer = ui.active
    let c = copperAt(design, p, tol(), layer)
    if (!c) {
      const other = otherSide(layer)
      const c2 = copperAt(design, p, tol(), other)
      if (c2 && c2.kind === 'pad') {
        layer = other
        c = c2
        ed.patchUI({ active: other })
      }
    }
    const start = c ? c.p : snapPt(p, ui.grid)
    const net = c?.net ?? ''
    const width = ui.trackWidth || netClassOf(design, net).track
    ed.begin()
    route.current = { net, layer, width, pts: [start], mode: ui.routeMode, flip: false, base: design, start, snaps: [] }
    ed.say(net ? `Routing ${net}` : 'Routing: click to place corners; click on a pad to finish')
  }

  const routeClick = (p: Pt) => {
    const rs = route.current!
    const { ed } = latest.current
    const target = copperAt(rs.base, p, tol(), rs.layer)
    const compatible = !!target && (!rs.net || !target.net || target.net === rs.net)
    const pt = compatible ? target.p : snapPt(p, latest.current.ui.grid)
    const last = rs.pts[rs.pts.length - 1]
    const pts = nextPoints(last, pt, rs.mode, rs.flip)
    if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1e-6) {
      if (compatible) finishRoute()
      return
    }
    const segs = previewSegments(rs, pt)
    const c = routeClash(rs.base, segs, rs.layer, rs.width, rs.net, rs.start)
    if (c) {
      ed.say(`Cannot place the track: too close to ${c.what}.`)
      return
    }
    rs.snaps.push({ design: ed.design, pts: [...rs.pts], layer: rs.layer })
    ed.preview(addTrackPath(ed.design, [last, ...pts], rs.layer, rs.width, rs.net).design)
    rs.pts.push(...pts)
    if (compatible && target.kind !== 'track') finishRoute()
    else if (compatible && target.kind === 'track' && target.net && target.net === rs.net) finishRoute()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvas.current!
    c.setPointerCapture(e.pointerId)
    const sp = evPoint(e)
    const p = toWorld(sp.x, sp.y)
    raw.current = p
    const { ed, design, ui, sel } = latest.current
    if (e.button === 1 || e.button === 2 || space.current) {
      gesture.current = { kind: 'pan', sx: sp.x, sy: sp.y, cx: view.current.cx, cy: view.current.cy, moved: false, button: e.button }
      return
    }
    if (e.button !== 0) return
    c.focus?.()
    switch (ui.tool) {
      case 'select': {
        const handled = pickVertex(p)
        if (handled) return
        const hit = pickAt(design, p, { tol: tol(), visible: visibleLayers(), active: ui.active })
        if (hit) {
          const key = itemKey(hit)
          let items = [...sel]
          const has = items.some((i) => itemKey(i) === key)
          if (e.shiftKey) items = has ? items.filter((i) => itemKey(i) !== key) : [...items, hit]
          else if (!has) items = [hit]
          ed.setSel(items)
          if (!e.shiftKey || !has) {
            const origin = itemOrigin(design, hit)
            gesture.current = { kind: 'drag', start: p, origin, base: design, items, moved: false, sx: sp.x, sy: sp.y }
          }
        } else {
          if (!e.shiftKey) ed.setSel([])
          gesture.current = { kind: 'box', a: p, b: p, shift: e.shiftKey }
        }
        break
      }
      case 'place': {
        const at = snapPt(p, ui.grid)
        const r = addPart(design, ui.placeFp, at.x, at.y, { rot: ui.placeRot, side: ui.placeSide })
        ed.commit(r.design)
        ed.say(`Placed ${r.part.ref}. Click to place another, R rotates, Esc stops.`)
        break
      }
      case 'route': {
        if (!route.current) startRoute(p)
        else routeClick(p)
        break
      }
      case 'via': {
        const c2 = copperAt(design, p, tol(), ui.active)
        const at = c2 ? c2.p : snapPt(p, ui.grid)
        const net = c2?.net ?? ''
        const cls = netClassOf(design, net)
        const size2 = ui.viaIndex >= 0 ? VIA_PRESETS[ui.viaIndex] : { d: cls.via, drill: cls.drill }
        ed.commit(adoptNets(addVia(design, at.x, at.y, net, size2).design))
        break
      }
      case 'zone':
      case 'outline-poly': {
        const at = snapPt(p, ui.grid)
        if (!draft.current) draft.current = { tool: ui.tool, pts: [] }
        const last = draft.current.pts[draft.current.pts.length - 1]
        if (!last || Math.hypot(last.x - at.x, last.y - at.y) > 1e-9) draft.current.pts.push(at)
        ed.say('Click the corners; double-click or press Enter to close the shape; Backspace removes the last corner.')
        break
      }
      case 'outline': {
        gesture.current = { kind: 'rect', a: snapPt(p, ui.grid), base: design, moved: false }
        ed.begin()
        break
      }
      case 'hole': {
        const at = snapPt(p, ui.grid)
        ed.commit(addHole(design, at.x, at.y).design)
        break
      }
      case 'measure': {
        const at = snapped(p, ui.active)
        const m = measure.current
        if (!m || m.fixed) {
          measure.current = { a: at, b: at, fixed: false }
          gesture.current = { kind: 'measure', moved: false, sx: sp.x, sy: sp.y }
        } else {
          measure.current = { ...m, b: at, fixed: true }
          reportMeasure(measure.current)
        }
        break
      }
      case 'assign': {
        const hit = pickAt(design, p, { tol: tol(), visible: visibleLayers(), kinds: new Set(['part']) })
        const part = hit ? design.parts.find((q) => q.id === hit.id) : undefined
        const pad = part ? worldPads(part).filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= Math.max(q.w, q.h) / 2 + tol() * 0.3).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] : undefined
        if (!part || !pad) { ed.say('Click a pad.'); break }
        if (e.shiftKey) { ed.commit(assignPad(design, '', part.ref, pad.n)); ed.say(`${pad.label} removed from its net.`) }
        else if (!ui.assignNet) ed.say('Choose or create a net in the Nets panel first.')
        else { ed.commit(assignPad(design, ui.assignNet, part.ref, pad.n)); ed.say(`${pad.label} is on ${ui.assignNet}.`) }
        break
      }
    }
    schedule()
  }

  /** Handles of a selected outline or zone. True if one was grabbed. */
  const pickVertex = (p: Pt): boolean => {
    const { ed, design, sel } = latest.current
    if (sel.length !== 1) return false
    const t = tol() * 1.2
    if (sel[0].kind === 'outline') {
      const i = design.outline.pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= t)
      if (i >= 0) {
        ed.begin()
        gesture.current = { kind: 'vertex', target: 'outline', index: i, base: design, moved: false }
        return true
      }
    }
    if (sel[0].kind === 'zone') {
      const z = design.zones.find((q) => q.id === sel[0].id)
      const i = z ? z.pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= t) : -1
      if (z && i >= 0) {
        ed.begin()
        gesture.current = { kind: 'vertex', target: 'zone', index: i, zone: z.id, base: design, moved: false }
        return true
      }
    }
    return false
  }

  const reportMeasure = (m: Measure) => {
    const dx = m.b.x - m.a.x
    const dy = m.b.y - m.a.y
    const u = latest.current.ui.unit
    const f = (mm: number) => (u === 'mil' ? `${(mm / 0.0254).toFixed(1)} mil` : `${mm.toFixed(3)} mm`)
    latest.current.ed.say(`Distance ${f(Math.hypot(dx, dy))} (dx ${f(dx)}, dy ${f(dy)})`)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const sp = evPoint(e)
    const p = toWorld(sp.x, sp.y)
    raw.current = p
    const { ed, ui, design } = latest.current
    const g = gesture.current
    // the cursor snaps to copper while routing or measuring, to the grid otherwise
    const layer = ui.tool === 'route' || ui.tool === 'measure' || ui.tool === 'via' ? (route.current?.layer ?? ui.active) : undefined
    cur.current = route.current ? routePoint(route.current, p) : snapped(p, layer)
    ed.onCursor(cur.current)
    if (!g) {
      // highlight the net under the pointer
      if (ui.tool === 'select' || ui.tool === 'route' || ui.tool === 'assign') {
        const n = netAt(p)
        if (n !== latest.current.hoverNet) ed.setHover(n)
      }
      if (measure.current && !measure.current.fixed) measure.current = { ...measure.current, b: cur.current }
      if (route.current && clash.current.bad) ed.say(clash.current.msg)
      schedule()
      return
    }
    switch (g.kind) {
      case 'pan': {
        const dx = sp.x - g.sx
        const dy = sp.y - g.sy
        if (Math.hypot(dx, dy) > 3) g.moved = true
        const fx = view.current.flip ? -1 : 1
        view.current = { ...view.current, cx: g.cx - (fx * dx) / view.current.scale, cy: g.cy - dy / view.current.scale }
        break
      }
      case 'box':
        g.b = p
        break
      case 'rect':
        g.moved = true
        ed.preview(rectFrom(g.base, g.a, cur.current))
        break
      case 'measure':
        if (measure.current) measure.current = { ...measure.current, b: cur.current }
        if (Math.hypot(sp.x - g.sx, sp.y - g.sy) > 4) g.moved = true
        break
      case 'drag': {
        if (!g.moved) {
          if (Math.hypot(sp.x - g.sx, sp.y - g.sy) < 4) break
          g.moved = true
          ed.begin()
        }
        if (g.items.some((i) => i.kind === 'part' && design.parts.find((q) => q.id === i.id)?.locked) && g.items.length === 1) {
          ed.say('This part is locked.')
          break
        }
        const target = snapPt({ x: g.origin.x + (p.x - g.start.x), y: g.origin.y + (p.y - g.start.y) }, ui.grid)
        ed.preview(applyMove(g.base, g.items, target.x - g.origin.x, target.y - g.origin.y))
        break
      }
      case 'vertex': {
        g.moved = true
        const at = snapPt(p, ui.grid)
        const base = g.base
        if (g.target === 'outline') ed.preview({ ...base, outline: { pts: base.outline.pts.map((q, i) => (i === g.index ? at : q)) } })
        else ed.preview({ ...base, zones: base.zones.map((z) => (z.id === g.zone ? { ...z, pts: z.pts.map((q, i) => (i === g.index ? at : q)) } : z)) })
        break
      }
    }
    schedule()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    const c = canvas.current
    if (c?.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId)
    if (!g) return
    const { ed, design, sel } = latest.current
    switch (g.kind) {
      case 'pan':
        if (!g.moved && g.button === 2) openMenu(e)
        break
      case 'box': {
        const b = { x0: Math.min(g.a.x, g.b.x), y0: Math.min(g.a.y, g.b.y), x1: Math.max(g.a.x, g.b.x), y1: Math.max(g.a.y, g.b.y) }
        if (b.x1 - b.x0 > 2 / view.current.scale || b.y1 - b.y0 > 2 / view.current.scale) {
          const inside = pickInBox(design, b, visibleLayers())
          if (g.shift) {
            const keys = new Set(sel.map(itemKey))
            ed.setSel([...sel, ...inside.filter((i) => !keys.has(itemKey(i)))])
          } else ed.setSel(inside)
        }
        break
      }
      case 'drag':
        if (g.moved) {
          ed.end()
          ed.refill()
        }
        break
      case 'vertex':
        ed.end()
        ed.refill()
        break
      case 'rect':
        if (g.moved && cur.current && Math.abs(cur.current.x - g.a.x) > 0.5 && Math.abs(cur.current.y - g.a.y) > 0.5) {
          ed.end()
          ed.setSel([{ kind: 'outline', id: 'outline' }])
          ed.patchUI({ tool: 'select' })
        } else ed.cancel()
        break
      case 'measure':
        if (g.moved && measure.current) {
          measure.current = { ...measure.current, fixed: true }
          reportMeasure(measure.current)
        }
        break
    }
    schedule()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const { ed, design, ui } = latest.current
    if (route.current) {
      finishRoute()
      return
    }
    if (draft.current) {
      // the double-click's first click already added the last corner
      closeDraft()
      return
    }
    if (ui.tool === 'select') {
      const sp = evPoint(e)
      const hit = pickAt(design, toWorld(sp.x, sp.y), { tol: tol(), visible: visibleLayers(), active: ui.active })
      if (hit?.kind === 'track') ed.act('select-run')
    }
  }

  const openMenu = (e: { clientX: number; clientY: number }) => {
    const { ed, design, ui, sel } = latest.current
    const sp = evPoint(e)
    const p = toWorld(sp.x, sp.y)
    const hit = pickAt(design, p, { tol: tol(), visible: visibleLayers(), active: ui.active })
    if (hit && !sel.some((i) => itemKey(i) === itemKey(hit))) ed.setSel([hit])
    const items: MenuItem[] = []
    const a = (label: string, cmd: string, shortcut?: string): MenuItem => ({ label, shortcut, onClick: () => ed.act(cmd) })
    if (route.current) {
      items.push({ label: 'Finish route', shortcut: 'Enter', onClick: finishRoute }, { label: 'Add via', shortcut: 'V', onClick: routeVia })
    } else if (!hit) {
      items.push(
        { label: 'Place a part…', shortcut: 'P', onClick: () => ed.act('library') },
        { label: 'Route here', shortcut: 'X', onClick: () => ed.patchUI({ tool: 'route' }) },
        { label: 'Add via here', onClick: () => { const at = snapPt(p, ui.grid); ed.commit(addVia(design, at.x, at.y, '').design) } },
        { label: 'Add mounting hole here', onClick: () => { const at = snapPt(p, ui.grid); ed.commit(addHole(design, at.x, at.y).design) } },
        '-',
        a('Paste', 'paste', '⌘V'),
        a('Zoom to fit', 'fit', '⌘0'),
      )
    } else if (hit.kind === 'part') {
      const part = design.parts.find((q) => q.id === hit.id)
      items.push(
        a('Rotate 90° left', 'rotate', 'R'), a('Rotate 90° right', 'rotate-cw', '⇧R'), a('Flip to the other side', 'flip', 'F'),
        a(part?.locked ? 'Unlock' : 'Lock', 'toggle-lock'), '-',
        a('Copy', 'copy', '⌘C'), a('Duplicate', 'duplicate', '⌘D'), a('Delete', 'delete', '⌫'),
      )
    } else if (hit.kind === 'track') {
      items.push(
        a('Select the whole run', 'select-run'), a('Delete segment', 'delete', '⌫'), a('Delete the run', 'delete-run'), a('Delete all tracks of this net', 'delete-net-copper'),
        a('Route this net with the auto-router', 'route-net'), a('Rip up this net and route it again', 'reroute-net'),
      )
    } else if (hit.kind === 'via') items.push(a('Delete via', 'delete', '⌫'))
    else if (hit.kind === 'zone') items.push(a('Fill zones', 'fill', 'B'), a('Delete zone', 'delete', '⌫'))
    else if (hit.kind === 'hole') items.push(a('Delete hole', 'delete', '⌫'))
    else items.push(a('Delete the outline', 'delete', '⌫'))
    ed.menu(e, items)
  }

  const cursorStyle = props.ui.tool === 'select' ? 'default' : props.ui.tool === 'measure' ? 'crosshair' : 'crosshair'

  return (
    <div ref={wrap} className="kb-canvas-wrap">
      <canvas
        ref={canvas}
        className="kb-canvas"
        tabIndex={0}
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { cur.current = null; latest.current.ed.onCursor(null); schedule() }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
})

// ------------------------------------------------------------ helpers

function rectFrom(base: Design, a: Pt, b: Pt): Design {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return setOutlineRect(base, x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y), base.outline.rect?.r ?? 0)
}

/** A reference point of an item for snapping a drag. */
function itemOrigin(d: Design, i: Item): Pt {
  if (i.kind === 'part') {
    const p = d.parts.find((q) => q.id === i.id)
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }
  }
  if (i.kind === 'via') {
    const v = d.vias.find((q) => q.id === i.id)
    return v ? { x: v.x, y: v.y } : { x: 0, y: 0 }
  }
  if (i.kind === 'hole') {
    const h = d.holes.find((q) => q.id === i.id)
    return h ? { x: h.x, y: h.y } : { x: 0, y: 0 }
  }
  if (i.kind === 'track') {
    const t = d.tracks.find((q) => q.id === i.id)
    return t ? { x: t.x1, y: t.y1 } : { x: 0, y: 0 }
  }
  if (i.kind === 'zone') {
    const z = d.zones.find((q) => q.id === i.id)
    return z ? { x: z.pts[0].x, y: z.pts[0].y } : { x: 0, y: 0 }
  }
  const b = polyBox(d.outline.pts)
  return { x: b.x0, y: b.y0 }
}

/** Move the selected items by (dx, dy). */
function applyMove(base: Design, items: readonly Item[], dx: number, dy: number): Design {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return base
  const ids = (k: Item['kind']) => new Set(items.filter((i) => i.kind === k).map((i) => i.id))
  const parts = ids('part')
  const tracks = ids('track')
  const vias = ids('via')
  const holes = ids('hole')
  const zones = ids('zone')
  let d = base
  if (tracks.size === 1 && !vias.size && !parts.size && !holes.size && !zones.size) return dragTrack(base, [...tracks][0], dx, dy)
  if (vias.size === 1 && !tracks.size && !parts.size && !holes.size && !zones.size) {
    const v = base.vias.find((q) => q.id === [...vias][0])
    return v ? moveVia(base, v.id, v.x + dx, v.y + dy) : base
  }
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  d = {
    ...d,
    parts: d.parts.map((p) => (parts.has(p.id) && !p.locked ? { ...p, x: r(p.x + dx), y: r(p.y + dy) } : p)),
    tracks: d.tracks.map((t) => (tracks.has(t.id) ? { ...t, x1: r(t.x1 + dx), y1: r(t.y1 + dy), x2: r(t.x2 + dx), y2: r(t.y2 + dy) } : t)),
    vias: d.vias.map((v) => (vias.has(v.id) ? { ...v, x: r(v.x + dx), y: r(v.y + dy) } : v)),
    holes: d.holes.map((h) => (holes.has(h.id) ? { ...h, x: r(h.x + dx), y: r(h.y + dy) } : h)),
    zones: d.zones.map((z) => (zones.has(z.id) ? { ...z, pts: z.pts.map((q) => ({ x: r(q.x + dx), y: r(q.y + dy) })) } : z)),
  }
  if (items.some((i) => i.kind === 'outline')) {
    const o = d.outline
    d = { ...d, outline: { pts: o.pts.map((q) => ({ x: r(q.x + dx), y: r(q.y + dy) })), ...(o.rect ? { rect: { ...o.rect, x: r(o.rect.x + dx), y: r(o.rect.y + dy) } } : {}) } }
  }
  return d
}

