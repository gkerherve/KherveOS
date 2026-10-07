// The drawing canvas: the page (raster layer under the vector items), the
// grid, selection outlines and handles, pan/zoom, and every tool's pointer
// handling (PaintScene's mouse events and handles.py in the desktop).

import { createElement, forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { Doc, GroupItem, ImageItem, Item, LineItem, Mat, Pt, Rect } from './model'
import { base, findItem, hasLabel, newId, newRasterKey, replaceItem, toArgb } from './model'
import {
  apply, boundsIn, center, chainMatrix, deepItemAt, frameRect, gridPx, hullPoints, invert, itemAt, matrixOf, mul, originOf,
  polygonForKind, qtRect, rectCorners, rectFromPts, rectOf, rectsIntersect, snapPt,
} from './geom'
import {
  BOX_ROLES, angleMeasure, bendHandle, boxAnchor, dragLine, dragVertex, posOf, resizeBox, resizeGroup, resizeImage, roomWalls, scaleAbout, setPos,
  setRotation, type BoxRole,
} from './ops'
import { renderItem, type VNode } from './render'
import { TEXT_MARGIN, cssFamily } from './text'
import { PT } from './model'
import { buildSymbol } from './spec'
import { atomItem, bondItem, chemConstrain, ringItem, type BondKind, type RingKind } from './chemistry'
import { paletteById } from './palettes'
import type { PaintStore, Tool } from './store'
import { isRectTool } from './store'
import { floodRuns, freezeRaster, newCanvas, paintRuns, pngToCanvas, rasterSource, renderPage, runsToPath, strokeLine, canvasToBlob, blobToBase64 } from './raster'
import { pictureSvg } from './render'

export interface CanvasApi {
  zoomBy(f: number, at?: Pt): void
  setZoom(z: number): void
  fit(): void
  zoom(): number
  /** The page point at the centre of the view. */
  viewCenter(): Pt
  /** Edit the text of an item (or a text inside a group) in place. */
  editText(id: number): void
  /** Drop a half-made protractor measurement or bond chain (before saving). */
  finishPending(): void
}

interface Props {
  store: PaintStore
  /** Right click: the top-level item under the pointer (or null) and the page point. */
  onContextMenu(e: React.MouseEvent, item: Item | null, at: Pt): void
  onCursor(p: Pt | null): void
  onZoom(z: number): void
  /** Something dropped on the page: a library symbol, files from the drive or from the computer. */
  onDropData(dt: DataTransfer, at: Pt, snapped: Pt): void
  onPicked(color: string, fill: boolean): void
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 16
const HANDLE = 9
let canvasCount = 0

// ------------------------------------------------------- items as React

const PROPS: Record<string, string> = { 'xml:space': 'xmlSpace', class: 'className' }

function toReact(v: VNode, key?: number): ReactElement {
  const props: Record<string, unknown> = { key }
  for (const [k, val] of Object.entries(v.attrs)) props[PROPS[k] ?? k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = val
  return createElement(v.tag, props, v.text ?? v.children?.map((c, i) => toReact(c, i)))
}

export const ItemView = memo(function ItemView({ item, prefix, dpi }: { item: Item; prefix: string; dpi: number }) {
  return toReact(renderItem(item, { prefix, dpi }))
})

// ------------------------------------------------------------ handles

type HandleKind =
  | { kind: 'box'; role: BoxRole }
  | { kind: 'line'; role: 'p1' | 'p2' | 'mid' }
  | { kind: 'vertex'; index: number }
  | { kind: 'scale'; role: 'nw' | 'ne' | 'se' | 'sw' }
  | { kind: 'rotate' }

interface Handle {
  h: HandleKind
  /** Screen position. */
  s: Pt
  round?: boolean
}

/** The local point a handle sits on. */
function handleLocal(it: Item, h: HandleKind): Pt {
  switch (h.kind) {
    case 'line': {
      const l = it as LineItem
      return h.role === 'p1' ? { x: l.x1, y: l.y1 } : h.role === 'p2' ? { x: l.x2, y: l.y2 } : bendHandle(l)
    }
    case 'vertex': {
      const p = (it as Extract<Item, { type: 'polygon' }>).points[h.index]
      return { x: p[0], y: p[1] }
    }
    case 'box':
    case 'scale':
      return boxAnchor(handleFrame(it), h.role)
    default:
      return center(frameRect(it))
  }
}

/** The rectangle box/scale handles sit on. */
function handleFrame(it: Item): Rect {
  return it.type === 'text' || it.type === 'path' ? qtRect(it) : frameRect(it)
}

function handlesFor(it: Item, toScreen: (p: Pt) => Pt, m: Mat): Handle[] {
  const S = (p: Pt) => toScreen(apply(m, p))
  const out: Handle[] = []
  if (it.type === 'line' || it.type === 'arrow' || it.type === 'dimension') {
    for (const role of ['p1', 'p2'] as const) out.push({ h: { kind: 'line', role }, s: S(handleLocal(it, { kind: 'line', role })) })
    if (it.type !== 'dimension') out.push({ h: { kind: 'line', role: 'mid' }, s: S(bendHandle(it)), round: true })
  } else if (it.type === 'polygon') {
    it.points.forEach((_, index) => out.push({ h: { kind: 'vertex', index }, s: S(handleLocal(it, { kind: 'vertex', index })) }))
  } else if (it.type === 'path' || it.type === 'text') {
    for (const role of ['nw', 'ne', 'se', 'sw'] as const) out.push({ h: { kind: 'scale', role }, s: S(handleLocal(it, { kind: 'scale', role })) })
  } else {
    for (const role of BOX_ROLES) out.push({ h: { kind: 'box', role }, s: S(handleLocal(it, { kind: 'box', role })) })
  }
  // The rotate knob: above the top edge, along the item's own up direction.
  if (it.type !== 'line' && it.type !== 'arrow' && it.type !== 'dimension') {
    const r = handleFrame(it)
    const top = S({ x: r.x + r.w / 2, y: r.y })
    const mid = S(center(r))
    let dx = top.x - mid.x
    let dy = top.y - mid.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    if (Math.hypot(top.x - mid.x, top.y - mid.y) < 1e-6) [dx, dy] = [0, -1]
    out.push({ h: { kind: 'rotate' }, s: { x: top.x + dx * 26, y: top.y + dy * 26 }, round: true })
  }
  return out
}

// ------------------------------------------------------------- drags

type Drag =
  | { kind: 'pan'; start: Pt; pan: Pt }
  | { kind: 'rubber'; start: Pt; cur: Pt; add: boolean; before: number[] }
  | { kind: 'move'; start: Pt; base: Doc; ids: number[]; moved: boolean }
  | { kind: 'handle'; id: number; h: HandleKind; it0: Item; inv: Mat; m0: Mat; frame: Rect; anchorLocal?: Pt; anchorScene?: Pt; dist0?: number; centerScene?: Pt }
  | { kind: 'create'; tool: Tool; start: Pt; id: number }
  | { kind: 'bond'; bond: BondKind; start: Pt; id: number }
  | { kind: 'pencil'; id: number; pts: Pt[] }
  | { kind: 'paint'; erase: boolean; last: Pt; target: 'raster' | number; canvas: HTMLCanvasElement }

export const Canvas = forwardRef<CanvasApi, Props>(function Canvas({ store, onContextMenu, onCursor, onZoom, onDropData, onPicked }, ref) {
  const doc = store.doc
  const settings = store.settings
  const viewportRef = useRef<HTMLDivElement>(null)
  const rasterRef = useRef<HTMLCanvasElement>(null)
  const [prefix] = useState(() => `kpc${++canvasCount}-`)
  const [view, setView] = useState({ zoom: 1, x: 40, y: 40 })
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [rubber, setRubber] = useState<Rect | null>(null)
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [spaceDown, setSpaceDown] = useState(false)
  const drag = useRef<Drag | null>(null)
  /** The protractor's clicked points and its preview arms. */
  const angle = useRef<{ pts: Pt[]; ids: number[] } | null>(null)
  /** The bond chain being clicked out: its vertices and the preview segment. */
  const chain = useRef<{ pts: Pt[]; preview: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => onZoom(view.zoom), [view.zoom, onZoom])
  /** The raster layer pixels currently shown (and painted on). */
  const rasterShown = useRef<{ key: number; ready: boolean }>({ key: -1, ready: false })

  const toScreen = (p: Pt): Pt => ({ x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y })
  const toPage = (sx: number, sy: number): Pt => {
    const v = viewRef.current
    return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom }
  }
  const eventPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = viewportRef.current!.getBoundingClientRect()
    return toPage(e.clientX - r.left, e.clientY - r.top)
  }
  const grid = gridPx(doc.grid.mm, doc.dpi)
  const snap = (p: Pt) => (store.doc.grid.snap ? snapPt(p, gridPx(store.doc.grid.mm, store.doc.dpi)) : p)

  // --------------------------------------------------------------- view

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fitView = () => {
    const el = viewportRef.current
    if (!el) return
    const d = store.doc
    const w = el.clientWidth
    const h = el.clientHeight
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - 48) / d.width, (h - 48) / d.height)))
    setView({ zoom: z, x: (w - d.width * z) / 2, y: (h - d.height * z) / 2 })
  }

  // Fit the page when the window opens and whenever a document is loaded.
  const ready = size.w > 50
  useEffect(() => {
    if (ready) fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loads, ready])

  const zoomBy = (f: number, at?: Pt) => {
    setView((v) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f))
      const sx = at ? at.x : size.w / 2
      const sy = at ? at.y : size.h / 2
      const px = (sx - v.x) / v.zoom
      const py = (sy - v.y) / v.zoom
      return { zoom: z, x: sx - px * z, y: sy - py * z }
    })
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (f, at) => zoomBy(f, at),
    setZoom: (z) => zoomBy(z / viewRef.current.zoom),
    fit: fitView,
    zoom: () => viewRef.current.zoom,
    viewCenter: () => toPage(size.w / 2, size.h / 2),
    editText: (id) => startEdit(id),
    finishPending: () => endMulti(),
  }))

  // Wheel: scroll pans, Ctrl/⌘ (and pinch) zooms about the pointer.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))
        zoomBy(f, { x: e.clientX - r.left, y: e.clientY - r.top })
      } else {
        const k = e.deltaMode === 1 ? 16 : 1
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        setView((v) => ({ ...v, x: v.x - dx * k, y: v.y - dy * k }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h])

  // Space held: the hand tool for a moment.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !editing && !(e.target as HTMLElement)?.closest?.('input, textarea, select')) {
        if (viewportRef.current?.closest('.kp-paint')?.contains(document.activeElement)) setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [editing])

  // Changing tool drops a half-made angle measurement or bond chain.
  const endMulti = () => {
    if (angle.current || chain.current) {
      angle.current = null
      chain.current = null
      store.cancelGesture()
    }
  }
  useEffect(endMulti, [settings.tool, store])

  // ------------------------------------------------------------ raster

  // Draw the raster layer into the canvas whenever it changes (not while painting on it).
  useEffect(() => {
    const r = doc.raster
    const c = rasterRef.current
    if (!c || rasterShown.current.key === r.key) return
    rasterShown.current = { key: r.key, ready: false }
    let gone = false
    void rasterSource(r).then((src) => {
      if (gone || rasterShown.current.key !== r.key) return
      c.width = r.w
      c.height = r.h
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, r.w, r.h)
      if (src) ctx.drawImage(src, 0, 0)
      rasterShown.current.ready = true
    })
    return () => {
      gone = true
    }
  }, [doc.raster])

  // ------------------------------------------------------------ editing

  // The edited item went away (undo, delete): stop editing.
  useEffect(() => {
    if (editing && !findItem(doc.items, editing.id)) setEditing(null)
  }, [doc, editing])

  const startEdit = (id: number) => {
    const it = findItem(store.doc.items, id)
    if (!it) return
    if (it.type === 'text') setEditing({ id, value: it.text })
    else if (hasLabel(it)) setEditing({ id, value: it.label ?? '' })
  }

  const finishEdit = (save: boolean) => {
    // Once only: a late blur after Escape must not save.
    const ed = editingRef.current
    editingRef.current = null
    setEditing(null)
    viewportRef.current?.focus()
    if (!ed || !save) return
    const it = findItem(store.doc.items, ed.id)
    if (!it) return
    if (it.type === 'text') {
      if (!ed.value.trim()) {
        // An emptied text goes away (only a top-level one).
        if (store.doc.items.some((t) => t._id === it._id)) store.commit({ ...store.doc, items: store.doc.items.filter((t) => t._id !== it._id) }, [])
        return
      }
      if (ed.value !== it.text) store.commit({ ...store.doc, items: replaceItem(store.doc.items, it._id, (t) => ({ ...t, text: ed.value })) })
    } else if (hasLabel(it) && ed.value !== (it.label ?? '')) {
      store.commit({ ...store.doc, items: replaceItem(store.doc.items, it._id, (t) => ({ ...t, label: ed.value } as Item)) })
    }
  }

  // ------------------------------------------------------------- tools

  const tol = () => 5 / viewRef.current.zoom
  const selected = store.selected
  const single = selected.length === 1 ? selected[0] : null
  const handles = single && settings.tool === 'pointer' && !editing ? handlesFor(single, toScreen, matrixOf(single)) : []

  const newPen = () => ({ color: settings.stroke, width: settings.width, ...(settings.dash !== 'solid' ? { dash: settings.dash } : {}) })
  const newBrush = () => {
    if (!settings.fillOn) return null
    if (settings.fillStyle === 'solid') return { color: settings.fill }
    return { gradient: { kind: settings.fillStyle, c1: settings.fill, c2: settings.fill2, angle: settings.fillAngle } }
  }

  /** A fresh rect-defined item for a shape tool. */
  const newShape = (tool: Tool, r: Rect): Item => {
    const pen = newPen()
    const brush = newBrush()
    const common = { ...base(), pen, brush }
    if (tool === 'rect') return { ...common, type: 'rect', ...r }
    if (tool === 'roundrect') return { ...common, type: 'roundrect', radius: 12, ...r }
    if (tool === 'circle' || tool === 'ellipse') return { ...common, type: 'ellipse', ...r }
    if (tool === 'halfcircle' || tool === 'quartercircle') return { ...common, type: 'arc', kind: tool, ...r, flipH: false, flipV: false }
    return { ...common, type: 'polygon', kind: tool, points: polygonForKind(tool, r) }
  }

  const shapeRect = (tool: Tool, a: Pt, b: Pt): Rect => {
    let dx = b.x - a.x
    let dy = b.y - a.y
    if (tool === 'circle') {
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      dx = dx >= 0 ? side : -side
      dy = dy >= 0 ? side : -side
    }
    return rectFromPts(a, { x: a.x + dx, y: a.y + dy })
  }

  const withItem = (d: Doc, id: number, fn: (it: Item) => Item): Doc => ({ ...d, items: replaceItem(d.items, id, fn) })

  /** The picture under p (for painting on its pixels), or null. */
  const imageAt = (p: Pt): ImageItem | null => {
    for (let i = store.doc.items.length - 1; i >= 0; i--) {
      const it = store.doc.items[i]
      if (it.type === 'image') {
        const inv = invert(matrixOf(it))
        const q = inv && apply(inv, p)
        if (q && q.x >= 0 && q.y >= 0 && q.x <= it.iw && q.y <= it.ih) return it
      }
    }
    return null
  }

  const pickColor = async (p: Pt, fill: boolean) => {
    const d = store.doc
    const c = newCanvas(1, 1)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 1, 1)
    const src = await rasterSource(d.raster)
    if (src) ctx.drawImage(src, Math.floor(p.x), Math.floor(p.y), 1, 1, 0, 0, 1, 1)
    const svg = pictureSvg(d, d.items, { white: false, area: { x: Math.floor(p.x), y: Math.floor(p.y), w: 1, h: 1 }, width: '1', height: '1' })
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      ctx.drawImage(img, 0, 0, 1, 1)
    } catch {
      // nothing drawn there
    } finally {
      URL.revokeObjectURL(url)
    }
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const hex = toArgb(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    onPicked(hex, fill)
  }

  const bucket = async (p: Pt) => {
    const d = store.doc
    const x = Math.floor(p.x)
    const y = Math.floor(p.y)
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return
    store.say('Filling…')
    const page = await renderPage(d, 1)
    const img = page.getContext('2d')!.getImageData(0, 0, page.width, page.height)
    const runs = floodRuns(img.data, page.width, page.height, x, y)
    if (!runs.length) return store.say('')
    if (store.settings.bucketVector) {
      const cmds = runsToPath(runs, page.width, page.height)
      const fill: Item = { ...base(), type: 'path', pen: { color: '#00000000', width: 0 }, brush: { color: store.settings.fill }, cmds }
      // Behind the shapes that bound it.
      store.commit({ ...store.doc, items: [fill, ...store.doc.items] }, [fill._id])
    } else {
      const c = rasterRef.current!
      paintRuns(c.getContext('2d')!, runs, store.settings.fill)
      const key = newRasterKey()
      rasterShown.current = { key, ready: true }
      store.commit({ ...store.doc, raster: freezeRaster(c, key) })
    }
    store.say('')
  }

  // ------------------------------------------------------- pointer down

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return
    viewportRef.current?.focus()
    const p = eventPage(e)
    const tool = settings.tool
    if (e.button === 1 || (e.button === 0 && (tool === 'hand' || spaceDown))) {
      drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, pan: { x: view.x, y: view.y } }
      ;(e.target as Element).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) {
      endMulti()
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)

    if (tool === 'pointer') {
      const hid = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle')
      if (hid != null && single) {
        startHandle(single, handles[+hid].h, p)
        return
      }
      const hit = itemAt(store.doc.items, p, tol())
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey
      if (toggle) {
        if (hit) {
          const on = store.sel.includes(hit._id)
          store.select(on ? store.sel.filter((id) => id !== hit._id) : [...store.sel, hit._id])
        }
        // A modifier click on empty canvas keeps the selection (it may be a miss).
        if (!hit) drag.current = { kind: 'rubber', start: p, cur: p, add: true, before: store.sel }
        return
      }
      if (hit) {
        if (!store.sel.includes(hit._id)) store.select([hit._id])
        drag.current = { kind: 'move', start: p, base: store.doc, ids: store.sel.includes(hit._id) ? store.sel : [hit._id], moved: false }
      } else {
        store.select([])
        drag.current = { kind: 'rubber', start: p, cur: p, add: false, before: [] }
      }
      return
    }
    if (tool === 'picker') return void pickColor(p, e.shiftKey)
    if (tool === 'bucket') return void bucket(p)
    if (tool === 'pencil' || tool === 'brush' || tool === 'eraser') {
      const img = tool === 'brush' ? null : imageAt(p)
      if (tool === 'pencil' && !img) {
        const id = newId()
        const it: Item = { ...base(), _id: id, type: 'path', pen: newPen(), brush: null, cmds: [['M', p.x, p.y]] }
        store.live({ ...store.doc, items: [...store.doc.items, it] })
        drag.current = { kind: 'pencil', id, pts: [p] }
        return
      }
      const erase = tool === 'eraser'
      if (img) {
        // Paint straight onto the picture's own pixels (desktop: like MS Paint).
        void pngToCanvas(img.image).then((c) => {
          drag.current = { kind: 'paint', erase, last: p, target: img._id, canvas: c }
          paintAt(p, p)
        })
        return
      }
      const c = rasterRef.current
      if (!c || !rasterShown.current.ready) return
      drag.current = { kind: 'paint', erase, last: p, target: 'raster', canvas: c }
      paintAt(p, p)
      return
    }
    const sp = snap(p)
    if (tool === 'text') {
      const it: Item = {
        ...base(), type: 'text', text: 'Text', color: settings.stroke, family: settings.fontFamily, size: settings.fontSize,
        bold: settings.bold, italic: settings.italic, pos: sp,
      }
      store.commit({ ...store.doc, items: [...store.doc.items, it] }, [it._id])
      // Open the editor once the click is over: the browser moves focus on mousedown.
      setTimeout(() => setEditing({ id: it._id, value: '' }), 0)
      return
    }
    if (tool === 'place') {
      const [pid, name] = (settings.place ?? ':').split(':')
      const pal = paletteById(pid)
      const it = pal && buildSymbol(pal, name, sp, store.doc.width)
      if (it) store.commit({ ...store.doc, items: [...store.doc.items, it] }, [it._id])
      return
    }
    if (tool === 'line' || tool === 'arrow' || tool === 'dimension') {
      const id = newId()
      const it: Item =
        tool === 'dimension'
          ? {
            ...base(), _id: id, type: 'dimension', pen: { color: settings.stroke, width: settings.width }, x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y,
            capStyle: settings.dimCap, extension: false, dash: false, unit: 'mm', decimals: 1, prefix: '', suffix: '',
          }
          : { ...base(), _id: id, type: tool, pen: newPen(), x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y }
      store.live({ ...store.doc, items: [...store.doc.items, it] })
      drag.current = { kind: 'create', tool, start: sp, id }
      return
    }
    if (tool === 'protractor') {
      // Three clicks: the vertex, then the end of each arm.
      const a = angle.current
      const arm = (from: Pt, to: Pt): Item => ({ ...base(), type: 'line', pen: newPen(), x1: from.x, y1: from.y, x2: to.x, y2: to.y })
      if (!a) {
        const it = arm(p, p)
        store.live({ ...store.doc, items: [...store.doc.items, it] })
        angle.current = { pts: [p], ids: [it._id] }
      } else if (a.pts.length === 1) {
        const it = arm(a.pts[0], p)
        const d1 = withItem(store.doc, a.ids[0], (x) => ({ ...(x as LineItem), x2: p.x, y2: p.y }))
        store.live({ ...d1, items: [...d1.items, it] })
        angle.current = { pts: [...a.pts, p], ids: [...a.ids, it._id] }
      } else {
        angle.current = null
        store.cancelGesture()
        const g = angleMeasure(a.pts[0], a.pts[1], p, { color: settings.stroke, width: settings.width })
        if (g) store.commit({ ...store.doc, items: [...store.doc.items, g] }, [g._id])
      }
      return
    }
    if (tool.startsWith('chem_')) {
      chemDown(tool, p, sp)
      return
    }
    if (tool === 'room') {
      const it: Item = { ...base(), type: 'rect', pen: { color: '#ff333333', width: Math.max(settings.width * 2, 4) }, brush: null, x: sp.x, y: sp.y, w: 0, h: 0 }
      store.live({ ...store.doc, items: [...store.doc.items, it] })
      drag.current = { kind: 'create', tool, start: sp, id: it._id }
      return
    }
    if (isRectTool(tool)) {
      const it = newShape(tool, rectOf(sp.x, sp.y, 0, 0))
      store.live({ ...store.doc, items: [...store.doc.items, it] })
      drag.current = { kind: 'create', tool, start: sp, id: it._id }
    }
  }

  const chemDown = (tool: Tool, raw: Pt, sp: Pt) => {
    const s = store.settings
    const d0 = store.doc
    if (tool === 'chem_benzene' || tool === 'chem_cyclohexane' || tool === 'chem_cyclopentane') {
      const it = ringItem(tool.slice(5) as RingKind, sp, d0.dpi, newPen(), newBrush() as { color: string } | null)
      store.commit({ ...d0, items: [...d0.items, it] }, [it._id])
      return
    }
    if (tool === 'chem_atom') {
      const it = atomItem(s.chemAtom, sp, d0.items, s.bondLengthMm, d0.dpi, s.stroke)
      store.commit({ ...d0, items: [...d0.items, it] }, [it._id])
      return
    }
    const end = (from: Pt, to: Pt) => (s.chemFixed ? chemConstrain(from, to, s.bondLengthMm, d0.dpi) : snap(to))
    if (tool === 'chem_chain') {
      // Click to click; clicking the last vertex again ends the chain.
      const c = chain.current
      const preview = (from: Pt): Item => ({ ...base(), type: 'line', pen: newPen(), x1: from.x, y1: from.y, x2: from.x, y2: from.y })
      if (!c) {
        const pv = preview(sp)
        store.live({ ...d0, items: [...d0.items, pv] })
        chain.current = { pts: [sp], preview: pv._id }
        return
      }
      const last = c.pts[c.pts.length - 1]
      if (Math.hypot(raw.x - last.x, raw.y - last.y) < Math.max(grid, 6)) return endMulti()
      const q = end(last, raw)
      store.cancelGesture()
      const bond: Item = { ...base(), type: 'line', pen: newPen(), x1: last.x, y1: last.y, x2: q.x, y2: q.y }
      store.commit({ ...store.doc, items: [...store.doc.items, bond] }, [])
      const pv = preview(q)
      store.live({ ...store.doc, items: [...store.doc.items, pv] })
      chain.current = { pts: [...c.pts, q], preview: pv._id }
      return
    }
    const bond = tool.slice(5) as BondKind
    const it = bondItem(bond, sp, sp, newPen())
    store.live({ ...d0, items: [...d0.items, it] })
    drag.current = { kind: 'bond', bond, start: sp, id: it._id }
  }

  const paintAt = (a: Pt, b: Pt) => {
    const d = drag.current
    if (!d || d.kind !== 'paint') return
    const s = store.settings
    if (d.target === 'raster') {
      const ctx = d.canvas.getContext('2d')!
      if (d.erase) strokeLine(ctx, a, b, '#ffffff', Math.max(s.width * 4, 12))
      else strokeLine(ctx, a, b, toCss(s.stroke), Math.max(s.width, 1))
      return
    }
    const it = findItem(store.doc.items, d.target) as ImageItem | null
    const inv = it && invert(matrixOf(it))
    if (!it || !inv) return
    const ctx = d.canvas.getContext('2d')!
    const la = apply(inv, a)
    const lb = apply(inv, b)
    if (d.erase) strokeLine(ctx, la, lb, '#000', Math.max(s.width * 4, 12), true)
    else strokeLine(ctx, la, lb, toCss(s.stroke), Math.max(s.width, 1))
    // Show the stroke at once: swap in the canvas as the picture (encoded at the end).
    const url = d.canvas.toDataURL('image/png')
    store.live(withItem(store.doc, it._id, (x) => ({ ...(x as ImageItem), image: url.slice(url.indexOf(',') + 1) })))
  }

  const startHandle = (it: Item, h: HandleKind, p: Pt) => {
    const m0 = matrixOf(it)
    const inv = invert(m0) ?? [1, 0, 0, 1, 0, 0]
    const d: Drag = { kind: 'handle', id: it._id, h, it0: it, inv, m0, frame: handleFrame(it) }
    if (h.kind === 'scale') {
      const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const
      d.anchorLocal = boxAnchor(handleFrame(it), opp[h.role])
      d.anchorScene = apply(m0, d.anchorLocal)
      d.dist0 = Math.max(Math.hypot(p.x - d.anchorScene.x, p.y - d.anchorScene.y), 1)
    }
    if (h.kind === 'rotate') d.centerScene = apply(m0, it.type === 'image' ? { x: it.iw / 2, y: it.ih / 2 } : originOf(it))
    drag.current = d
  }

  // ------------------------------------------------------- pointer move

  const onPointerMove = (e: React.PointerEvent) => {
    const p = eventPage(e)
    onCursor(p)
    const a = angle.current
    if (a) {
      const id = a.ids[a.ids.length - 1]
      store.live(withItem(store.doc, id, (x) => ({ ...(x as LineItem), x2: p.x, y2: p.y })))
      return
    }
    const ch = chain.current
    if (ch) {
      const last = ch.pts[ch.pts.length - 1]
      const s = store.settings
      const q = s.chemFixed ? chemConstrain(last, p, s.bondLengthMm, store.doc.dpi) : snap(p)
      store.live(withItem(store.doc, ch.preview, (x) => ({ ...(x as LineItem), x2: q.x, y2: q.y })))
      return
    }
    const d = drag.current
    if (!d) return
    switch (d.kind) {
      case 'pan':
        setView((v) => ({ ...v, x: d.pan.x + e.clientX - d.start.x, y: d.pan.y + e.clientY - d.start.y }))
        return
      case 'rubber': {
        d.cur = p
        const r = rectFromPts(d.start, p)
        setRubber(r)
        const hits = store.doc.items.filter((it) => {
          const b = boundsIn(it)
          return b && rectsIntersect(b, r)
        })
        const ids = hits.map((it) => it._id)
        store.select(d.add ? [...new Set([...d.before, ...ids])] : ids)
        return
      }
      case 'move': {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return
        d.moved = true
        const ids = new Set(d.ids)
        const items = d.base.items.map((it) => {
          if (!ids.has(it._id)) return it
          // Like SnapMixin: the item's position snaps, not its outline.
          const p0 = posOf(it)
          return setPos(it, snap({ x: p0.x + dx, y: p0.y + dy }))
        })
        store.live({ ...store.doc, items })
        return
      }
      case 'handle':
        store.live(withItem(store.doc, d.id, () => dragHandle(d, p, e.shiftKey)))
        return
      case 'create': {
        let q = snap(p)
        const it = findItem(store.doc.items, d.id)
        if (!it) return
        if (d.tool === 'line' || d.tool === 'arrow' || d.tool === 'dimension') {
          if (d.tool === 'dimension') {
            if (settings.dimOrient === 'horizontal') q = { x: q.x, y: d.start.y }
            if (settings.dimOrient === 'vertical') q = { x: d.start.x, y: q.y }
          } else if (e.shiftKey) {
            // Shift: steps of 15°.
            const a = Math.round(Math.atan2(q.y - d.start.y, q.x - d.start.x) / (Math.PI / 12)) * (Math.PI / 12)
            const len = Math.hypot(q.x - d.start.x, q.y - d.start.y)
            q = { x: d.start.x + Math.cos(a) * len, y: d.start.y + Math.sin(a) * len }
          }
          store.live(withItem(store.doc, d.id, (x) => ({ ...(x as LineItem), x2: q.x, y2: q.y })))
        } else {
          const r = shapeRect(e.shiftKey && d.tool !== 'circle' ? 'circle' : d.tool, d.start, q)
          store.live(withItem(store.doc, d.id, (x) => {
            if (x.type === 'polygon') return { ...x, points: polygonForKind(x.kind, r) }
            return { ...(x as Extract<Item, { w: number }>), ...r }
          }))
        }
        return
      }
      case 'bond': {
        const s = store.settings
        const q = s.chemFixed ? chemConstrain(d.start, p, s.bondLengthMm, store.doc.dpi) : snap(p)
        store.live(withItem(store.doc, d.id, (x) => bondItem(d.bond, d.start, q, x.type === 'polygon' ? newPen() : (x as Extract<Item, { pen: unknown }>).pen, x._id)))
        return
      }
      case 'pencil': {
        const last = d.pts[d.pts.length - 1]
        if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 2 / Math.max(viewRef.current.zoom, 0.25)) return
        d.pts.push(p)
        store.live(withItem(store.doc, d.id, (x) => ({ ...(x as Extract<Item, { type: 'path' }>), cmds: [['M', d.pts[0].x, d.pts[0].y], ...d.pts.slice(1).map((q) => ['L', q.x, q.y] as ['L', number, number])] })))
        return
      }
      case 'paint':
        paintAt(d.last, p)
        d.last = p
        return
    }
  }

  const dragHandle = (d: Extract<Drag, { kind: 'handle' }>, p: Pt, shift: boolean): Item => {
    const sp = snap(p)
    const q = apply(d.inv, sp)
    const it0 = d.it0
    switch (d.h.kind) {
      case 'line':
        return dragLine(it0 as LineItem, d.h.role, q)
      case 'vertex':
        return dragVertex(it0 as Extract<Item, { type: 'polygon' }>, d.h.index, q)
      case 'box':
        if (it0.type === 'image') return resizeImage(it0, d.h.role, q)
        if (it0.type === 'group') return resizeGroup(it0 as GroupItem, d.h.role, q, d.frame)
        return resizeBox(it0 as Extract<Item, { w: number; x: number }>, d.h.role, q)
      case 'scale': {
        const f = Math.hypot(sp.x - d.anchorScene!.x, sp.y - d.anchorScene!.y) / d.dist0!
        return scaleAbout(it0, d.anchorLocal!, f)
      }
      case 'rotate': {
        const c = d.centerScene!
        let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90
        if (store.doc.grid.snap || shift) a = Math.round(a / 15) * 15
        a = ((a % 360) + 360) % 360
        if (a > 180) a -= 360
        return setRotation(it0, a)
      }
    }
  }

  // --------------------------------------------------------- pointer up

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    switch (d.kind) {
      case 'rubber':
        setRubber(null)
        return
      case 'move':
        if (d.moved) store.endGesture()
        else if (!e.shiftKey) {
          // A plain click on one of several selected items selects just it.
          const hit = itemAt(store.doc.items, eventPage(e), tol())
          if (hit && store.sel.length > 1) store.select([hit._id])
        }
        return
      case 'handle':
        store.endGesture()
        return
      case 'create': {
        const it = findItem(store.doc.items, d.id)
        let degenerate = !it
        if (it && (it.type === 'line' || it.type === 'arrow' || it.type === 'dimension')) degenerate = Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1
        else if (it) {
          const r = frameRect(it)
          degenerate = r.w < 1 && r.h < 1
        }
        if (degenerate) store.cancelGesture()
        else if (d.tool === 'room' && it) {
          // The dragged box becomes the room's walls.
          const room = roomWalls(frameRect(it))
          const items = store.doc.items.filter((x) => x._id !== d.id)
          if (room) {
            store.live({ ...store.doc, items: [...items, room] })
            store.endGesture()
            store.select([room._id])
          } else store.cancelGesture()
        } else {
          store.endGesture()
          store.select([d.id])
        }
        return
      }
      case 'bond': {
        const it = findItem(store.doc.items, d.id)
        const r = it && frameRect(it)
        if (!r || (r.w < 1 && r.h < 1)) store.cancelGesture()
        else {
          store.endGesture()
          store.select([d.id])
        }
        return
      }
      case 'pencil': {
        if (d.pts.length < 2) store.cancelGesture()
        else {
          store.endGesture()
          store.select([d.id])
        }
        return
      }
      case 'paint': {
        if (d.target === 'raster') {
          const key = newRasterKey()
          rasterShown.current = { key, ready: true }
          store.commit({ ...store.doc, raster: freezeRaster(d.canvas, key) })
        } else {
          const id = d.target
          void canvasToBlob(d.canvas).then(blobToBase64).then((b64) => {
            store.live(withItem(store.doc, id, (x) => ({ ...(x as ImageItem), image: b64 })))
            store.endGesture()
          })
        }
        return
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (settings.tool !== 'pointer') return
    const chain = deepItemAt(store.doc.items, eventPage(e), tol())
    if (!chain) return
    const leaf = chain[chain.length - 1]
    if (leaf.type === 'text') startEdit(leaf._id)
    else if (hasLabel(chain[0])) startEdit(chain[0]._id)
    else if (hasLabel(leaf)) startEdit(leaf._id)
  }

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault()
    const p = eventPage(e)
    const hit = itemAt(store.doc.items, p, tol())
    if (hit && !store.sel.includes(hit._id)) store.select([hit._id])
    onContextMenu(e, hit, p)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const p = eventPage(e)
    onDropData(e.dataTransfer, p, snap(p))
  }

  // ------------------------------------------------------------ drawing

  const zoom = view.zoom
  const pageScreen = { x: view.x, y: view.y, w: doc.width * zoom, h: doc.height * zoom }

  // Grid lines (skip lines that would sit closer than 6 px on screen).
  let gridPath = ''
  if (doc.grid.show) {
    let step = grid
    while (step * zoom < 6) step *= 2
    const area = doc.grid.infinite
      ? { x0: (0 - view.x) / zoom, y0: (0 - view.y) / zoom, x1: (size.w - view.x) / zoom, y1: (size.h - view.y) / zoom }
      : { x0: 0, y0: 0, x1: doc.width, y1: doc.height }
    const sx0 = Math.max(area.x0, doc.grid.infinite ? -Infinity : 0)
    const parts: string[] = []
    for (let x = Math.ceil(sx0 / step) * step; x <= area.x1; x += step) {
      const s = x * zoom + view.x
      parts.push(`M${s.toFixed(1)},${(area.y0 * zoom + view.y).toFixed(1)}V${(area.y1 * zoom + view.y).toFixed(1)}`)
    }
    for (let y = Math.ceil(area.y0 / step) * step; y <= area.y1; y += step) {
      const s = y * zoom + view.y
      parts.push(`M${(area.x0 * zoom + view.x).toFixed(1)},${s.toFixed(1)}H${(area.x1 * zoom + view.x).toFixed(1)}`)
    }
    gridPath = parts.length < 4000 ? parts.join('') : ''
  }

  // Selection outlines: lines follow their own geometry, the rest their (turned) frame.
  const outlines = selected.map((it) => {
    const m = matrixOf(it)
    if (it.type === 'line' || it.type === 'arrow' || it.type === 'dimension') {
      const pts = hullPoints({ ...it, type: it.type === 'arrow' ? 'line' : it.type } as Item).slice(0, it.type === 'dimension' ? 2 : undefined)
      const sp = pts.map((q) => toScreen(apply(m, q)))
      return <polyline key={it._id} points={sp.map((q) => `${q.x},${q.y}`).join(' ')} className="kp-sel-line" />
    }
    const r = it.type === 'group' ? frameRect(it) : handleFrame(it)
    const sp = rectCorners(r).map((q) => toScreen(apply(m, q)))
    return <polygon key={it._id} points={sp.map((q) => `${q.x},${q.y}`).join(' ')} className="kp-selframe" />
  })

  const cursor =
    spaceDown || settings.tool === 'hand' ? 'grab'
      : settings.tool === 'pointer' ? 'default'
        : settings.tool === 'text' ? 'text'
          : 'crosshair'

  // The text being edited, placed over its item.
  let editor: ReactElement | null = null
  if (editing) {
    const chain = (() => {
      for (const top of doc.items) {
        const c = top._id === editing.id ? [top] : top.type === 'group' ? findChain(top, editing.id) : null
        if (c) return c
      }
      return null
    })()
    const it = chain?.[chain.length - 1]
    if (it && chain) {
      const m = mul([zoom, 0, 0, zoom, view.x, view.y], chainMatrix(chain))
      const isText = it.type === 'text'
      const r = isText ? qtRect(it) : qtRect(it)
      const font = isText ? { family: it.family, size: it.size, bold: it.bold, italic: it.italic } : {
        family: (it as Extract<Item, { labelFamily?: string }>).labelFamily ?? 'Segoe UI',
        size: (it as Extract<Item, { labelSize?: number }>).labelSize ?? 14,
        bold: (it as Extract<Item, { labelBold?: boolean }>).labelBold,
        italic: (it as Extract<Item, { labelItalic?: boolean }>).labelItalic,
      }
      editor = (
        <textarea
          className="kp-text-edit"
          autoFocus
          spellCheck={false}
          value={editing.value}
          placeholder={isText ? 'Text' : 'Label'}
          style={{
            left: 0,
            top: 0,
            width: Math.max(r.w, 60),
            height: Math.max(r.h, 24),
            transform: `matrix(${m.join(',')}) translate(${r.x}px, ${r.y}px)`,
            transformOrigin: '0 0',
            font: `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${font.size * PT}px ${cssFamily(font.family)}`,
            padding: isText ? TEXT_MARGIN : 2,
            textAlign: isText ? 'left' : 'center',
            color: isText ? toCss(it.color) : undefined,
          }}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => finishEdit(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') finishEdit(false)
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !isText)) {
              e.preventDefault()
              finishEdit(true)
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      )
    }
  }

  return (
    <div
      ref={viewportRef}
      className={`kp-viewport${doc.grid.infinite ? ' kp-infinite' : ''}`}
      tabIndex={-1}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => onCursor(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContext}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {!doc.grid.infinite && <div className="kp-page-shadow" style={{ left: pageScreen.x, top: pageScreen.y, width: pageScreen.w, height: pageScreen.h }} />}
      <canvas
        ref={rasterRef}
        className="kp-raster"
        style={{
          left: view.x,
          top: view.y,
          width: doc.raster.w * zoom,
          height: doc.raster.h * zoom,
          imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
        }}
      />
      <svg className="kp-items" width={size.w} height={size.h}>
        <g transform={`translate(${view.x} ${view.y}) scale(${zoom})`}>
          {doc.items.map((it) => (
            <ItemView key={it._id} item={it} prefix={prefix} dpi={doc.dpi} />
          ))}
        </g>
      </svg>
      <svg className="kp-overlay" width={size.w} height={size.h}>
        {gridPath && <path d={gridPath} className="kp-grid" />}
        {doc.grid.infinite && <rect x={pageScreen.x} y={pageScreen.y} width={pageScreen.w} height={pageScreen.h} className="kp-page-edge" />}
        {outlines}
        {handles.map((hd, i) =>
          hd.round ? (
            <circle key={i} data-handle={i} cx={hd.s.x} cy={hd.s.y} r={hd.h.kind === 'rotate' ? 6 : HANDLE / 2} className={hd.h.kind === 'rotate' ? 'kp-knob' : 'kp-handle'} />
          ) : (
            <rect key={i} data-handle={i} x={hd.s.x - HANDLE / 2} y={hd.s.y - HANDLE / 2} width={HANDLE} height={HANDLE} className="kp-handle" />
          ),
        )}
        {single && handles.some((h) => h.h.kind === 'rotate') && (() => {
          const knob = handles.find((h) => h.h.kind === 'rotate')!
          const r = handleFrame(single)
          const top = toScreen(apply(matrixOf(single), { x: r.x + r.w / 2, y: r.y }))
          return <line x1={top.x} y1={top.y} x2={knob.s.x} y2={knob.s.y} className="kp-knob-line" />
        })()}
        {rubber && (() => {
          const a = toScreen({ x: rubber.x, y: rubber.y })
          return <rect x={a.x} y={a.y} width={rubber.w * zoom} height={rubber.h * zoom} className="kp-rubber" />
        })()}
      </svg>
      {editor}
    </div>
  )
})

function findChain(g: GroupItem, id: number): Item[] | null {
  for (const c of g.children) {
    if (c._id === id) return [g, c]
    if (c.type === 'group') {
      const sub = findChain(c, id)
      if (sub) return [g, ...sub]
    }
  }
  return null
}

function toCss(argb: string): string {
  const h = argb.replace('#', '')
  if (h.length !== 8) return argb
  const a = parseInt(h.slice(0, 2), 16) / 255
  return `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${a})`
}

