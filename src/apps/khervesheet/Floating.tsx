// What floats over the cells: charts (SVG drawn by core/charts), the
// desktop's pictures and equations (KaTeX), and the figures =PY cells
// draw. Charts, pictures and equations can be selected, moved and resized.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Book, ObjectRef } from './book'
import type { Axis } from './geom'
import { keyCol, keyRow, type Sheet } from './model'
import { moveObject, objectRect } from './objects'

export interface FloatActions {
  editChart: (id: string) => void
  editEquation: (id: string) => void
  objectMenu: (ref: NonNullable<ObjectRef>, at: { clientX: number; clientY: number }) => void
}

type Rect = { left: number; top: number; width: number; height: number }
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** SVG size from its width/height attributes (matplotlib writes points). */
function svgSize(svg: string | null): { w: number; h: number } {
  const m = svg ? /<svg[^>]*\swidth="([\d.]+)(pt|px)?"[^>]*\sheight="([\d.]+)(pt|px)?"/.exec(svg.slice(0, 2000)) : null
  if (!m) return { w: 480, h: 360 }
  const k = (u: string | undefined) => (u === 'pt' ? 4 / 3 : 1)
  return { w: Number(m[1]) * k(m[2]), h: Number(m[3]) * k(m[4]) }
}

function Equation({ latex, d }: { latex: string; d: Record<string, unknown> }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { throwOnError: false, displayMode: false, output: 'html' })
    } catch {
      return null
    }
  }, [latex])
  const size = typeof d.fontsize === 'number' ? d.fontsize : 16
  return html ? (
    <div className="ks-eq-body" style={{ fontSize: `${size}px`, color: String(d.color ?? '#1a1a1a') }} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="ks-eq-body ks-eq-bad">{latex}</div>
  )
}

export function Floating({
  book, sheet, rows, cols, zoom, selected, actions,
}: {
  book: Book
  sheet: Sheet
  rows: Axis
  cols: Axis
  zoom: number
  selected: ObjectRef
  actions: FloatActions
}) {
  const [live, setLive] = useState<{ ref: NonNullable<ObjectRef>; rect: Rect } | null>(null)
  const drag = useRef<{ ref: NonNullable<ObjectRef>; handle: Handle; x0: number; y0: number; start: Rect; moved: boolean } | null>(null)

  const begin = (e: ReactPointerEvent<HTMLElement>, ref: NonNullable<ObjectRef>, handle: Handle) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    if (book.state.edit) book.commitEdit()
    book.set({ object: ref })
    book.refocus()
    const start = objectRect(sheet, ref)
    if (!start) return
    drag.current = { ref, handle, x0: e.clientX, y0: e.clientY, start, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('k-dragging')
  }

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x0) / zoom
    const dy = (e.clientY - d.y0) / zoom
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    d.moved = true
    const r = { ...d.start }
    const h = d.handle
    if (h === 'move') {
      r.left += dx
      r.top += dy
    } else {
      if (h.includes('e')) r.width = Math.max(40, d.start.width + dx)
      if (h.includes('s')) r.height = Math.max(30, d.start.height + dy)
      if (h.includes('w')) {
        r.width = Math.max(40, d.start.width - dx)
        r.left = d.start.left + d.start.width - r.width
      }
      if (h.includes('n')) {
        r.height = Math.max(30, d.start.height - dy)
        r.top = d.start.top + d.start.height - r.height
      }
    }
    r.left = Math.max(0, r.left)
    r.top = Math.max(0, r.top)
    setLive({ ref: d.ref, rect: r })
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    document.body.classList.remove('k-dragging')
    if (d?.moved && live && live.ref.id === d.ref.id) moveObject(book, d.ref, live.rect)
    setLive(null)
  }

  const rectOf = (ref: NonNullable<ObjectRef>, base: Rect): Rect => (live && live.ref.kind === ref.kind && live.ref.id === ref.id ? live.rect : base)

  const frame = (ref: NonNullable<ObjectRef>, base: Rect, cls: string, body: ReactNode, title: string) => {
    const r = rectOf(ref, base)
    const on = selected?.kind === ref.kind && selected.id === ref.id
    return (
      <div
        key={`${ref.kind}-${ref.id}`}
        className={`ks-float ${cls}${on ? ' on' : ''}`}
        style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        title={title}
        onPointerDown={(e) => begin(e, ref, 'move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (ref.kind === 'chart') actions.editChart(ref.id)
          else if (ref.kind === 'equation') actions.editEquation(ref.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          book.set({ object: ref })
          actions.objectMenu(ref, e)
        }}
      >
        {body}
        {on &&
          (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Handle[]).map((h) => (
            <span key={h} className={`ks-handle ks-handle-${h}`} onPointerDown={(e) => begin(e, ref, h)} onPointerMove={onMove} onPointerUp={onUp} />
          ))}
      </div>
    )
  }

  // Figures drawn by =PY cells sit right of their cell, at their own size (the desktop's _place_py_embed).
  const figures = [...sheet.py].filter(([, p]) => p.url)
  return (
    <>
      {sheet.images.map((o) => {
        const ref = { kind: 'image' as const, id: o.id }
        const base = objectRect(sheet, ref)!
        const src = typeof o.d.data === 'string' ? `data:image/png;base64,${o.d.data}` : ''
        return frame(ref, base, 'ks-image', src ? <img src={src} alt="" draggable={false} /> : null, 'Picture')
      })}
      {figures.map(([k, p]) => {
        const r = keyRow(k)
        const c = keyCol(k)
        const size = svgSize(p.fig)
        const w = Math.min(size.w, 1100)
        const h = Math.min(size.h, 850)
        return (
          <div key={`py-${k}`} className="ks-float ks-pyfig" style={{ left: cols.pos(c + 1) + 4, top: rows.pos(r), width: w, height: h }} title="Figure drawn by the =PY cell">
            <img src={p.url!} alt="" draggable={false} />
          </div>
        )
      })}
      {sheet.charts.map((ch) => {
        const ref = { kind: 'chart' as const, id: ch.id }
        const base = { left: ch.spec.left, top: ch.spec.top, width: ch.spec.width, height: ch.spec.height }
        const body = ch.url ? (
          <img src={ch.url} alt={ch.spec.title || 'Chart'} draggable={false} />
        ) : ch.error ? (
          <div className="ks-chart-msg">
            <b>This chart could not be drawn</b>
            <span>{ch.error}</span>
          </div>
        ) : (
          <div className="ks-chart-msg">
            <LoaderCircle size={16} className="k-spin" />
            <span>Drawing the chart…</span>
          </div>
        )
        return frame(ref, base, 'ks-chart', body, ch.spec.title || 'Chart (double-click to edit)')
      })}
      {sheet.equations.map((o) => {
        const ref = { kind: 'equation' as const, id: o.id }
        const base = objectRect(sheet, ref)!
        const d = o.d
        const style = {
          background: String(d.bg_color ?? '#ffffff'),
          borderColor: String(d.border_color ?? 'transparent'),
          borderWidth: typeof d.border_width === 'number' ? d.border_width : 0,
        }
        return frame(
          ref,
          base,
          'ks-equation',
          <div className="ks-eq" style={style}>
            <Equation latex={String(d.latex ?? '')} d={d} />
          </div>,
          'Equation (double-click to edit)',
        )
      })}
    </>
  )
}
