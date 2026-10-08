// A desktop QGraphicsView inside a dialog (the House Builder's floor plan,
// the City Builder's map) and a widget that paints itself (the Lego plan,
// the chamber's port map): replayed paint commands on a canvas, the mouse,
// wheel and keys sent back to the desktop code.

import { memo, useEffect, useRef } from 'react'
import { qtKey } from '../keys'
import type { Node } from '../types'
import { useQt } from './context'
import { IDENTITY, multiply, replay, type Matrix, type Op } from './paint'

interface GItem {
  i: number
  x: number
  y: number
  z?: number
  ign?: 1
  op?: number
  ops: Op[]
  kids?: GItem[]
}

const CURSORS: Record<number, string> = { 0: 'default', 2: 'crosshair', 5: 'ns-resize', 6: 'ew-resize', 7: 'nesw-resize', 8: 'nwse-resize', 9: 'move', 13: 'pointer', 17: 'grab', 18: 'grabbing' }

function useCanvasSize(host: React.RefObject<HTMLDivElement | null>, canvas: React.RefObject<HTMLCanvasElement | null>, onSize: (w: number, h: number) => void, draw: () => void) {
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = Math.max(1, Math.round(r.width))
      const h = Math.max(1, Math.round(r.height))
      const cv = canvas.current
      if (cv) {
        const dpr = window.devicePixelRatio || 1
        cv.width = w * dpr
        cv.height = h * dpr
      }
      onSize(w, h)
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function mouseProps(prefix: 'gv' | 'pw', id: number, send: (ev: { op: string; [k: string]: unknown }) => void) {
  const local = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const mods = (e: React.MouseEvent) => qtKey({ key: 'Shift', ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).mods
  const btn = (b: number) => (b === 0 ? 1 : b === 2 ? 2 : 4)
  const btns = (b: number) => (b & 1 ? 1 : 0) | (b & 2 ? 2 : 0) | (b & 4 ? 4 : 0)
  return {
    tabIndex: 0,
    onPointerDown: (e: React.PointerEvent) => {
      ;(e.currentTarget as HTMLElement).focus()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      send({ op: `${prefix}_press`, id, ...local(e), button: btn(e.button), buttons: btns(e.buttons), mods: mods(e) })
    },
    onPointerMove: (e: React.PointerEvent) => send({ op: `${prefix}_move`, id, ...local(e), buttons: btns(e.buttons), mods: mods(e) }),
    onPointerUp: (e: React.PointerEvent) => send({ op: `${prefix}_release`, id, ...local(e), button: btn(e.button), buttons: btns(e.buttons), mods: mods(e) }),
    onDoubleClick: (e: React.MouseEvent) => send({ op: `${prefix}_dbl`, id, ...local(e), button: 1, buttons: 1, mods: mods(e) }),
    onWheel: (e: React.WheelEvent) => send({ op: `${prefix}_wheel`, id, ...local(e), dy: -e.deltaY, mods: mods(e) }),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      send({ op: `${prefix}_menu`, id, ...local(e), button: 2, buttons: 2, mods: mods(e) })
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const k = qtKey(e.nativeEvent)
      if (!k.key || k.mods & 0x04000000) return
      e.preventDefault()
      e.stopPropagation()
      send({ op: `${prefix}_key`, id, key: k.key, mods: k.mods })
    },
  }
}

export const GView = memo(function GView({ n }: { n: Node }) {
  const { send } = useQt()
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 300, h: 200 })
  const data = n as unknown as { view: [number, number, number, number, number]; bgc: string | null; back: Op[]; fore: Op[]; items: GItem[]; cursor: number; band?: number[] }
  const nRef = useRef(data)
  nRef.current = data

  const draw = () => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const d = nRef.current
    const { w, h } = size.current
    const [sx, sy, cx, cy] = d.view
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (d.bgc) {
      ctx.fillStyle = d.bgc.length === 9 ? `#${d.bgc.slice(1, 7)}` : d.bgc
      ctx.fillRect(0, 0, w, h)
    }
    // scene → canvas: x' = w/2 + (x - cx)·sx
    const sceneTf: Matrix = [sx, 0, 0, sy, w / 2 - cx * sx, h / 2 - cy * sy]
    replay(ctx, d.back, sceneTf)
    const walk = (items: GItem[], ox: number, oy: number) => {
      for (const it of [...items].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
        const x = ox + it.x
        const y = oy + it.y
        if (it.ign) {
          const px = w / 2 + (x - cx) * sx
          const py = h / 2 + (y - cy) * sy
          replay(ctx, it.ops, [1, 0, 0, 1, px, py])
        } else {
          if (it.op !== undefined) ctx.globalAlpha = it.op
          replay(ctx, it.ops, multiply([1, 0, 0, 1, x, y], sceneTf))
          ctx.globalAlpha = 1
        }
        if (it.kids) walk(it.kids, x, y)
      }
    }
    walk(d.items, 0, 0)
    replay(ctx, d.fore, sceneTf)
    if (d.band) {
      const a = [w / 2 + (d.band[0] - cx) * sx, h / 2 + (d.band[1] - cy) * sy]
      const b = [w / 2 + (d.band[2] - cx) * sx, h / 2 + (d.band[3] - cy) * sy]
      ctx.strokeStyle = 'rgba(74,163,255,0.9)'
      ctx.fillStyle = 'rgba(74,163,255,0.15)'
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    }
  }

  useCanvasSize(host, canvas, (w, h) => {
    size.current = { w, h }
    send({ op: 'gv_view', id: n.id, w, h })
  }, draw)
  useEffect(draw)

  return (
    <div ref={host} className="kc-gview" style={{ cursor: CURSORS[data.cursor] ?? 'default' }} {...mouseProps('gv', n.id, send)}>
      <canvas ref={canvas} />
    </div>
  )
})

export const PaintWidget = memo(function PaintWidget({ n }: { n: Node }) {
  const { send } = useQt()
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 300, h: 200 })
  const data = n as unknown as { ops: Op[]; pw: number; ph: number }
  const opsRef = useRef(data.ops)
  opsRef.current = data.ops
  const draw = () => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.w, size.current.h)
    replay(ctx, opsRef.current, IDENTITY)
  }
  useCanvasSize(host, canvas, (w, h) => {
    size.current = { w, h }
    if (w !== data.pw || h !== data.ph) send({ op: 'pw_size', id: n.id, w, h })
  }, draw)
  useEffect(draw)
  return (
    <div ref={host} className="kc-paintw" {...mouseProps('pw', n.id, send)}>
      <canvas ref={canvas} />
    </div>
  )
})
