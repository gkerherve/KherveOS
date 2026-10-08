// The schematic canvas: an SVG that pans and zooms, with a snapping grid, parts, wires, net labels, notes
// and result annotations; selection (click, shift-click, box), dragging with rubber-banded wires,
// click-to-route orthogonal wiring and placing parts from the palette.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { PartGlyph } from './Glyph'
import {
  addPath, docBounds, hitLabel, hitNote, hitPart, hitPin, hitWire, itemsInBox, junctions, moveItems, route, type Ids,
} from './editor'
import { GRID, defOf, labelPosition, newPart, partBounds, partLabel, pinPositions, snap, type Doc, type PartKind, type Rot } from './model'
import type { Annot } from './annotate'

export type Tool =
  | { kind: 'select' }
  | { kind: 'wire' }
  | { kind: 'place'; part: PartKind; rot: Rot; mirror: boolean; value?: string }
  | { kind: 'label' }
  | { kind: 'note' }

export interface View { x: number; y: number; zoom: number }

export interface Hit {
  type: 'pin' | 'part' | 'wire' | 'label' | 'note' | 'none'
  id?: string
  pin?: string
  ref?: string
  x: number
  y: number
}

export interface CanvasHandle {
  fit(doc: Doc): void
  zoomBy(f: number): void
  cancel(): boolean
  view(): View
  centerOn(x: number, y: number): void
  /** world position of the viewport centre (to place pasted parts and AI additions in view) */
  center(): { x: number; y: number }
}

interface Props {
  doc: Doc
  selection: Ids
  tool: Tool
  annotations: Annot[]
  highlight: ReadonlySet<string>
  dangling: ReadonlySet<string>
  showGrid: boolean
  wheelZooms: boolean
  onSelect(ids: Set<string>): void
  onChange(next: Doc, what: string): void
  onTool(t: Tool): void
  onHover(h: Hit | null): void
  onEdit(hit: Hit): void
  onContext(e: React.MouseEvent, hit: Hit): void
  onText(kind: 'label' | 'note', x: number, y: number): void
  onDropPart(kind: PartKind, x: number, y: number): void
  onViewChange?(v: View): void
}

type Pt = [number, number]

interface Drag { ids: Set<string>; ox: number; oy: number; base: Doc; moved: boolean; clicked: string | null; shift: boolean }
interface Wiring { pts: Pt[]; cur: Pt; fromDrag: boolean; startClient: Pt; flip: boolean }

const MIN_ZOOM = 0.15
const MAX_ZOOM = 5

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(p, ref) {
  const { doc, selection, tool } = p
  const root = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [view, setViewState] = useState<View>({ x: 120, y: 60, zoom: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [drag, setDrag] = useState<(Drag & { preview: Doc | null }) | null>(null)
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [wiring, setWiring] = useState<Wiring | null>(null)
  const [ghost, setGhost] = useState<Pt | null>(null)
  const [hoverPin, setHoverPin] = useState<Pt | null>(null)
  const panning = useRef<{ cx: number; cy: number; vx: number; vy: number } | null>(null)
  const space = useRef(false)
  const lastHover = useRef('')
  const props = useRef(p)
  props.current = p

  const setView = useCallback((v: View) => {
    viewRef.current = v
    setViewState(v)
    props.current.onViewChange?.(v)
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const toWorld = useCallback((cx: number, cy: number): Pt => {
    const r = svg.current!.getBoundingClientRect()
    const v = viewRef.current
    return [(cx - r.left - v.x) / v.zoom, (cy - r.top - v.y) / v.zoom]
  }, [])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    if (!Number.isFinite(factor) || !Number.isFinite(cx) || !Number.isFinite(cy)) return
    const v = viewRef.current
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
    const k = zoom / v.zoom
    setView({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
  }, [setView])

  useImperativeHandle(ref, () => ({
    fit(d: Doc) {
      const b = docBounds(d)
      const el = root.current
      if (!b || !el) { setView({ x: 120, y: 60, zoom: 1 }); return }
      const w = el.clientWidth
      const h = el.clientHeight
      const zoom = Math.min(1.6, Math.max(MIN_ZOOM, Math.min(w / (b.x2 - b.x1), h / (b.y2 - b.y1))))
      setView({ zoom, x: (w - (b.x2 - b.x1) * zoom) / 2 - b.x1 * zoom, y: (h - (b.y2 - b.y1) * zoom) / 2 - b.y1 * zoom })
    },
    zoomBy(f: number) { zoomAt(f, size.w / 2, size.h / 2) },
    cancel() {
      if (wiring) { setWiring(null); return true }
      if (drag) { setDrag(null); return true }
      if (box) { setBox(null); return true }
      return false
    },
    view: () => viewRef.current,
    centerOn(x: number, y: number) { const v = viewRef.current; setView({ ...v, x: size.w / 2 - x * v.zoom, y: size.h / 2 - y * v.zoom }) },
    center() { const v = viewRef.current; return { x: snap((size.w / 2 - v.x) / v.zoom), y: snap((size.h / 2 - v.y) / v.zoom) } },
  }), [wiring, drag, box, size, setView, zoomAt])

  // wheel: zoom (or pan), not passive so the page never scrolls
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      if (e.ctrlKey || e.metaKey || props.current.wheelZooms) {
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
        zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), cx, cy)
      } else {
        const v = viewRef.current
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, setView])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && root.current?.contains(document.activeElement)) { space.current = true; if (root.current) root.current.style.cursor = 'grab' } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; if (root.current) root.current.style.cursor = '' } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // leaving the wire / place tools drops what was in progress
  useEffect(() => {
    if (tool.kind !== 'wire') setWiring((w) => (w && !w.fromDrag ? null : w))
    if (tool.kind !== 'place') setGhost(null)
  }, [tool])

  const hitAt = useCallback((x: number, y: number): Hit => {
    const d = props.current.doc
    const tol = 6 / viewRef.current.zoom
    const pin = hitPin(d, x, y, tol)
    if (pin) return { type: 'pin', id: pin.part.id, pin: pin.pin, ref: pin.part.ref, x: pin.x, y: pin.y }
    const lab = hitLabel(d, x, y)
    if (lab) return { type: 'label', id: lab.id, x, y }
    const note = hitNote(d, x, y)
    if (note) return { type: 'note', id: note.id, x, y }
    const part = hitPart(d, x, y)
    const wire = hitWire(d, x, y, 5 / viewRef.current.zoom)
    if (part && !(wire && !pointInside(part, x, y))) return { type: 'part', id: part.id, ref: part.ref, x, y }
    if (wire) return { type: 'wire', id: wire.id, x, y }
    return { type: 'none', x, y }
  }, [])

  // ---------------------------------------------------------------- wiring helpers

  /** Does the point touch an existing pin, wire or label (so a wire ends there)? */
  const touches = (d: Doc, x: number, y: number, ignore: Set<string>): boolean => {
    for (const part of d.parts) for (const pp of pinPositions(part)) if (pp.x === x && pp.y === y) return true
    for (const l of d.labels) if (l.x === x && l.y === y) return true
    for (const w of d.wires) {
      if (ignore.has(w.id)) continue
      if (w.x1 === w.x2 && x === w.x1 && y >= Math.min(w.y1, w.y2) && y <= Math.max(w.y1, w.y2)) return true
      if (w.y1 === w.y2 && y === w.y1 && x >= Math.min(w.x1, w.x2) && x <= Math.max(w.x1, w.x2)) return true
    }
    return false
  }

  const wirePath = (w: Wiring): Pt[] => {
    const last = w.pts[w.pts.length - 1]
    const dx = Math.abs(w.cur[0] - last[0])
    const dy = Math.abs(w.cur[1] - last[1])
    const horizontalFirst = (dx >= dy) !== w.flip
    return route(last[0], last[1], w.cur[0], w.cur[1], horizontalFirst) as Pt[]
  }

  /** Adds the segment from the last point to the cursor; returns true when the wire is finished. */
  const commitWire = (w: Wiring, forceEnd = false): boolean => {
    const path = wirePath(w)
    const before = props.current.doc
    if (path.length < 2 || (path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1])) return true
    const doc2 = addPath(before, path)
    props.current.onChange(doc2, 'Wire')
    const end = path[path.length - 1]
    const ids = new Set(doc2.wires.filter((x) => !before.wires.some((y) => y.id === x.id)).map((x) => x.id))
    const finish = forceEnd || touches(before, end[0], end[1], ids)
    if (finish) { setWiring(null); return true }
    setWiring({ ...w, pts: [...w.pts, end], cur: end, fromDrag: false })
    return false
  }

  // ---------------------------------------------------------------- pointer events

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    root.current?.focus()
    const t = props.current.tool
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      svg.current!.setPointerCapture(e.pointerId)
      panning.current = { cx: e.clientX, cy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y }
      return
    }
    if (e.button !== 0) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const sx = snap(wx)
    const sy = snap(wy)
    const d = props.current.doc
    svg.current!.setPointerCapture(e.pointerId)

    if (t.kind === 'place') {
      const part = newPart(d, t.part, sx, sy, { rot: t.rot, mirror: t.mirror })
      if (t.value !== undefined) part.value = t.value
      props.current.onChange({ ...d, parts: [...d.parts, part] }, `Place ${defOf(part).name}`)
      props.current.onSelect(new Set([part.id]))
      return
    }
    if (t.kind === 'label' || t.kind === 'note') { props.current.onText(t.kind, sx, sy); return }
    if (t.kind === 'wire' || wiring || (t.kind === 'select' && hitPin(d, wx, wy, 6 / viewRef.current.zoom))) {
      const pin = hitPin(d, wx, wy, 6 / viewRef.current.zoom)
      const start: Pt = pin ? [pin.x, pin.y] : [sx, sy]
      if (!wiring) {
        setWiring({ pts: [start], cur: start, fromDrag: t.kind === 'select', startClient: [e.clientX, e.clientY], flip: false })
        props.current.onSelect(new Set())
        return
      }
      const next = { ...wiring, cur: pin ? ([pin.x, pin.y] as Pt) : ([sx, sy] as Pt) }
      const done = commitWire(next)
      if (done) setWiring(null)
      return
    }

    // select tool
    const hit = hitAt(wx, wy)
    const shift = e.shiftKey || e.metaKey || e.ctrlKey
    if (hit.type === 'none') {
      if (!shift) props.current.onSelect(new Set())
      setBox({ x1: wx, y1: wy, x2: wx, y2: wy })
      return
    }
    const id = hit.id!
    let sel = new Set(props.current.selection)
    if (shift) {
      if (sel.has(id)) sel.delete(id); else sel.add(id)
      props.current.onSelect(sel)
      return
    }
    if (!sel.has(id)) { sel = new Set([id]); props.current.onSelect(sel) }
    setDrag({ ids: sel, ox: sx, oy: sy, base: d, moved: false, clicked: id, shift, preview: null })
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (panning.current) {
      const pn = panning.current
      setView({ ...viewRef.current, x: pn.vx + (e.clientX - pn.cx), y: pn.vy + (e.clientY - pn.cy) })
      return
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const sx = snap(wx)
    const sy = snap(wy)
    const t = props.current.tool
    if (t.kind === 'place') setGhost([sx, sy])
    if (drag) {
      const dx = sx - drag.ox
      const dy = sy - drag.oy
      if (dx !== 0 || dy !== 0 || drag.moved) {
        const preview = moveItems(drag.base, drag.ids, dx, dy)
        setDrag({ ...drag, moved: true, preview })
      }
      return
    }
    if (box) { setBox({ ...box, x2: wx, y2: wy }); return }
    if (wiring) {
      const pin = hitPin(props.current.doc, wx, wy, 6 / viewRef.current.zoom)
      const cur: Pt = pin ? [pin.x, pin.y] : [sx, sy]
      setWiring({ ...wiring, cur })
      return
    }
    const hit = hitAt(wx, wy)
    // tell the window only when something changed (a new item or grid square), not on every pixel
    const key = `${hit.type}:${hit.id ?? ''}:${hit.pin ?? ''}:${sx}:${sy}`
    if (key !== lastHover.current) {
      lastHover.current = key
      props.current.onHover({ ...hit, x: wx, y: wy })
    }
    setHoverPin((old) => {
      const next: Pt | null = hit.type === 'pin' ? [hit.x, hit.y] : null
      return old && next && old[0] === next[0] && old[1] === next[1] ? old : !old && !next ? old : next
    })
  }

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId)
    if (panning.current) { panning.current = null; return }
    if (drag) {
      if (drag.moved && drag.preview) props.current.onChange(drag.preview, 'Move')
      else if (!drag.shift && drag.ids.size > 1 && drag.clicked) props.current.onSelect(new Set([drag.clicked]))
      setDrag(null)
      return
    }
    if (box) {
      const hits = itemsInBox(props.current.doc, box.x1, box.y1, box.x2, box.y2)
      const base = e.shiftKey ? new Set(props.current.selection) : new Set<string>()
      for (const h of hits) base.add(h)
      props.current.onSelect(base)
      setBox(null)
      return
    }
    if (wiring && wiring.fromDrag && wiring.pts.length === 1) {
      const moved = Math.hypot(e.clientX - wiring.startClient[0], e.clientY - wiring.startClient[1])
      if (moved > 8 && (wiring.cur[0] !== wiring.pts[0][0] || wiring.cur[1] !== wiring.pts[0][1])) {
        const done = commitWire(wiring)
        if (done) setWiring(null)
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (wiring) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const hit = hitAt(wx, wy)
    if (hit.type !== 'none' && hit.type !== 'pin' && hit.type !== 'wire') props.current.onEdit(hit)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (wiring || drag || box) { setWiring(null); setDrag(null); setBox(null); e.stopPropagation(); return }
    }
    if (e.key === 'Enter' && wiring) { commitWire(wiring, true); setWiring(null); e.stopPropagation(); return }
    if (wiring && e.key === 'Shift') setWiring({ ...wiring, flip: !wiring.flip })
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (wiring) { setWiring(null); return }
    if (props.current.tool.kind !== 'select') { props.current.onTool({ kind: 'select' }); return }
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const hit = hitAt(wx, wy)
    if (hit.id && !props.current.selection.has(hit.id)) props.current.onSelect(new Set([hit.id]))
    props.current.onContext(e, hit)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData('text/x-kelec-part') as PartKind
    if (!kind) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    props.current.onDropPart(kind, snap(wx), snap(wy))
  }

  // ---------------------------------------------------------------- drawing

  const shown = drag?.preview ?? doc
  const dots = useMemo(() => junctions(shown), [shown])
  const grid = view.zoom >= 0.55 ? GRID : GRID * 5
  const gx = -view.x / view.zoom
  const gy = -view.y / view.zoom
  const gw = size.w / view.zoom
  const gh = size.h / view.zoom
  const wiringPath = wiring ? wirePath(wiring) : null
  const ghostPart = useMemo(() => {
    if (tool.kind !== 'place' || !ghost) return null
    const part = newPart(doc, tool.part, ghost[0], ghost[1], { rot: tool.rot, mirror: tool.mirror })
    if (tool.value !== undefined) part.value = tool.value
    return part
  }, [tool, ghost, doc])

  const cursor: CSSProperties['cursor'] = tool.kind === 'select' ? undefined : 'crosshair'

  return (
    <div ref={root} className="ke-canvas" tabIndex={0} onKeyDown={onKeyDown} style={{ cursor }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svg} className="ke-svg" width="100%" height="100%"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
        onPointerLeave={() => { lastHover.current = ''; props.current.onHover(null); setGhost(null); setHoverPin(null) }}
      >
        <defs>
          <pattern id="ke-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.9 / Math.max(view.zoom, 0.6)} className="ke-grid-dot" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {p.showGrid && <rect x={gx - grid} y={gy - grid} width={gw + 2 * grid} height={gh + 2 * grid} fill="url(#ke-grid)" pointerEvents="none" />}
          <g className="ke-wires">
            {shown.wires.map((w) => (
              <g key={w.id} className={selection.has(w.id) ? 'ke-sel' : undefined}>
                <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} className="ke-wire" />
                {selection.has(w.id) && <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} className="ke-wire-halo" />}
              </g>
            ))}
            {dots.map((j) => <circle key={`${j.x},${j.y}`} cx={j.x} cy={j.y} r={3.2} className="ke-junction" />)}
          </g>
          <g className="ke-parts">
            {shown.parts.map((part) => {
              const isSel = selection.has(part.id)
              const b = partBounds(part)
              const t = partLabel(part)
              const lp = labelPosition(part)
              return (
                <g key={part.id} className={`ke-part${isSel ? ' ke-sel' : ''}${p.highlight.has(part.id) ? ' ke-warn' : ''}`}>
                  {(isSel || p.highlight.has(part.id)) && <rect x={b.x1 - 4} y={b.y1 - 4} width={b.x2 - b.x1 + 8} height={b.y2 - b.y1 + 8} rx={4} className="ke-selbox" />}
                  <g className="ke-glyph"><PartGlyph part={part} /></g>
                  {(t.ref || t.value) && (
                    <g className="ke-tag-group">
                      <text x={lp.x} y={lp.y} textAnchor={lp.anchor} className="ke-tag ke-ref">{t.ref}</text>
                      {t.value && <text x={lp.x} y={lp.vy} textAnchor={lp.anchor} className="ke-tag ke-val">{t.value}</text>}
                    </g>
                  )}
                </g>
              )
            })}
          </g>
          <g className="ke-pins" pointerEvents="none">
            {shown.parts.flatMap((part) => pinPositions(part).map((pp) => {
              const k = `${pp.x},${pp.y}`
              const dangle = p.dangling.has(k)
              const showAll = tool.kind === 'wire' || wiring !== null
              if (!dangle && !showAll && !(hoverPin && hoverPin[0] === pp.x && hoverPin[1] === pp.y)) return null
              return <circle key={`${part.id}:${pp.name}`} cx={pp.x} cy={pp.y} r={hoverPin && hoverPin[0] === pp.x && hoverPin[1] === pp.y ? 4.5 : dangle ? 3 : 2.6} className={dangle ? 'ke-pin-open' : 'ke-pin'} />
            }))}
          </g>
          <g className="ke-labels">
            {shown.labels.map((l) => {
              const w = 10 + l.name.length * 6.5
              const d = l.flip ? -1 : 1
              const isSel = selection.has(l.id)
              return (
                <g key={l.id} className={`ke-label${isSel ? ' ke-sel' : ''}`}>
                  <path d={`M${l.x} ${l.y} L${l.x + d * 6} ${l.y - 7} L${l.x + d * w} ${l.y - 7} L${l.x + d * w} ${l.y + 7} L${l.x + d * 6} ${l.y + 7} Z`} className="ke-flag" />
                  <text x={l.flip ? l.x - 9 : l.x + 9} y={l.y + 4} textAnchor={l.flip ? 'end' : 'start'} className="ke-flag-text">{l.name}</text>
                </g>
              )
            })}
            {shown.notes.map((n) => (
              <text key={n.id} x={n.x} y={n.y} className={`ke-note${selection.has(n.id) ? ' ke-sel' : ''}`}>
                {n.text.split('\n').map((line, i) => <tspan key={i} x={n.x} dy={i === 0 ? 0 : 15}>{line}</tspan>)}
              </text>
            ))}
          </g>
          {p.annotations.length > 0 && (
            <g className="ke-annots" pointerEvents="none">
              {p.annotations.map((a, i) => {
                const w = a.text.length * 6.4 + 8
                return (
                  <g key={`${a.of}:${i}`} className={`ke-annot ke-annot-${a.kind}`}>
                    <rect x={a.x - w / 2} y={a.y - 10} width={w} height={14} rx={3} />
                    <text x={a.x} y={a.y + 1} textAnchor="middle">{a.text}</text>
                  </g>
                )
              })}
            </g>
          )}
          {ghostPart && <g className="ke-ghost" pointerEvents="none"><PartGlyph part={ghostPart} /></g>}
          {wiringPath && (
            <g className="ke-wiring" pointerEvents="none">
              {wiring!.pts.length > 1 && <polyline points={wiring!.pts.map((q) => q.join(',')).join(' ')} className="ke-wire-prev" />}
              <polyline points={wiringPath.map((q) => q.join(',')).join(' ')} className="ke-wire-prev" />
              <circle cx={wiring!.cur[0]} cy={wiring!.cur[1]} r={3.5} className="ke-pin" />
            </g>
          )}
          {box && <rect x={Math.min(box.x1, box.x2)} y={Math.min(box.y1, box.y2)} width={Math.abs(box.x2 - box.x1)} height={Math.abs(box.y2 - box.y1)} className="ke-box" pointerEvents="none" />}
        </g>
      </svg>
      {doc.parts.length === 0 && doc.wires.length === 0 && doc.labels.length === 0 && doc.notes.length === 0 && (
        <div className="ke-empty">
          <div className="ke-empty-card">
            <b>An empty sheet</b>
            <p>Pick a part in the palette and click here to place it, then draw wires between the pin dots. Or start from an example, or type a SPICE netlist.</p>
            <p className="k-muted">Tips: R rotates, F mirrors, W draws a wire, G places a ground, Del deletes, ⌘Z undoes.</p>
          </div>
        </div>
      )}
    </div>
  )
})

function pointInside(part: ReturnType<typeof hitPart> & object, x: number, y: number): boolean {
  const b = partBounds(part)
  const mx = Math.min(4, (b.x2 - b.x1) / 4)
  return x >= b.x1 + mx && x <= b.x2 - mx && y >= b.y1 && y <= b.y2
}
