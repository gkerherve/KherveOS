// The Visual editor: the slide at the canvas size, with boxes you select,
// drag, resize from eight handles and edit in place (double-click a text box
// to type its LaTeX, a table cell to change it, a picture to swap it), as the
// desktop's canvas does. Lines and arrows are dragged by their two ends.
// Locked (beamer-placed) objects stay where beamer puts them: they can be
// selected but not dragged.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Lock } from 'lucide-react'
import type { Deck, Slide, SlideObject, SlideText } from './model'
import type { Look } from './look'
import type { Media } from './media'
import { SlideView, boxPx, geometry, ptPx, type Geometry } from './SlideView'

export interface CanvasProps {
  deck: Deck
  slide: Slide
  look: Look
  media: Media
  backdrop: string | null
  master: boolean
  /** Display width of the page in px. */
  width: number
  selection: number[]
  setSelection: (sel: number[]) => void
  /** Change the shown slide. `record` false: part of a gesture already recorded with begin(). */
  edit: (fn: (s: Slide) => void, record?: boolean) => void
  /** Record an undo step before a gesture's live changes. */
  begin: () => void
  editingText: number | null
  setEditingText: (i: number | null) => void
  onPickPicture: (i: number) => void
  onProperties: (i: number) => void
  onContextMenu: (e: React.MouseEvent, index: number | null) => void
  onDropFiles: (paths: string[], at: { x: number; y: number }) => void
  /** View ▸ Snap to grid (divisions across the slide width; 0 = off) and ▸ Snap to objects. */
  snapGrid?: number
  snapObjects?: boolean
  /** View ▸ Check spelling, and the language of the in-place editor. */
  spellcheck?: boolean
  lang?: string
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p0' | 'p1'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface Drag {
  kind: 'move' | 'resize' | 'marquee'
  handle?: Handle
  index?: number
  start: [number, number] // page px
  orig: Map<number, { x: number; y: number; w: number; h: number }>
  moved: boolean
  marquee?: [number, number, number, number]
}

/** The selection grown to whole groups. */
export function withGroups(slide: Slide, sel: number[]): number[] {
  const groups = new Set(sel.map((i) => slide.objects[i]?.group).filter((g): g is number => !!g))
  const out = new Set(sel)
  slide.objects.forEach((o, i) => {
    if (o.group && groups.has(o.group)) out.add(i)
  })
  return [...out].sort((a, b) => a - b)
}

/** The box of an object in page px (lines: their end points' box). */
function boundsPx(g: Geometry, o: SlideObject) {
  if (o.type === 'SlideLine') {
    const [x0, y0] = ptPx(g, o.x, o.y)
    const [x1, y1] = ptPx(g, o.x + o.w, o.y + o.h)
    return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
  }
  return boxPx(g, o)
}

export function Canvas(props: CanvasProps) {
  const { deck, slide, look, media, backdrop, master, width, selection, setSelection, edit, begin, editingText, setEditingText } = props
  const g = useMemo(() => geometry(deck), [deck])
  const scale = width / g.W
  const pageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [marquee, setMarquee] = useState<[number, number, number, number] | null>(null)
  const [cell, setCell] = useState<{ index: number; r: number; c: number; rect: { left: number; top: number; width: number; height: number } } | null>(null)

  useEffect(() => {
    setCell(null)
  }, [slide])

  /** Page px from a pointer event. */
  const toPage = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = pageRef.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]
  }
  const fracDX = (px: number) => px / (g.W * g.span)
  const fracDY = (px: number) => px / (g.H * g.span)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.ks2-editor, .ks2-celleditor')) return
    pageRef.current?.focus({ preventScroll: true })
    const start = toPage(e)
    const handleEl = target.closest<HTMLElement>('[data-ks2-handle]')
    if (handleEl) {
      const idx = Number(handleEl.dataset.ks2Index)
      const o = slide.objects[idx]
      drag.current = { kind: 'resize', handle: handleEl.dataset.ks2Handle as Handle, index: idx, start, orig: new Map([[idx, { x: o.x, y: o.y, w: o.w, h: o.h }]]), moved: false }
      pageRef.current!.setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    const hit = target.closest<HTMLElement>('[data-ks2-index]')
    const idx = hit ? Number(hit.dataset.ks2Index) : -1
    if (idx < 0 || Number.isNaN(idx)) {
      if (!e.shiftKey) setSelection([])
      if (editingText !== null) setEditingText(null)
      drag.current = { kind: 'marquee', start, orig: new Map(), moved: false }
      pageRef.current!.setPointerCapture(e.pointerId)
      return
    }
    let sel = selection
    if (e.shiftKey || e.metaKey) sel = selection.includes(idx) ? selection.filter((i) => i !== idx) : [...selection, idx]
    else if (!selection.includes(idx)) sel = [idx]
    sel = withGroups(slide, sel)
    setSelection(sel)
    if (editingText !== null && editingText !== idx) setEditingText(null)
    const movable = sel.filter((i) => slide.objects[i] && !slide.objects[i].locked)
    if (!movable.length || editingText === idx) return
    drag.current = { kind: 'move', start, orig: new Map(movable.map((i) => [i, { ...slide.objects[i] }])), moved: false }
    pageRef.current!.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [px, py] = toPage(e)
    const dx = px - d.start[0]
    const dy = py - d.start[1]
    if (!d.moved && Math.hypot(dx, dy) * scale < 3) return
    if (!d.moved && d.kind !== 'marquee') begin()
    d.moved = true
    if (d.kind === 'marquee') {
      const r: [number, number, number, number] = [Math.min(d.start[0], px), Math.min(d.start[1], py), Math.abs(dx), Math.abs(dy)]
      d.marquee = r
      setMarquee(r)
      return
    }
    const fx = fracDX(dx)
    const fy = fracDY(dy)
    if (d.kind === 'move') {
      let sx = fx
      let sy = fy
      const first = [...d.orig.entries()][0]
      if (first && (props.snapGrid || props.snapObjects)) {
        const [, o] = first
        if (props.snapGrid) {
          // Square cells: 1/div of the width across, the same length down.
          const stepX = 1 / props.snapGrid
          const stepY = stepX * (g.W / g.H)
          sx = Math.round((o.x + fx) / stepX) * stepX - o.x
          sy = Math.round((o.y + fy) / stepY) * stepY - o.y
        }
        if (props.snapObjects) {
          const near = 0.008
          const others = slide.objects.filter((_, i) => !d.orig.has(i) && slide.objects[i].type !== 'SlideLine')
          const xs = others.flatMap((t) => [t.x, t.x + t.w / 2, t.x + t.w])
          const ys = others.flatMap((t) => [t.y, t.y + t.h / 2, t.y + t.h])
          const best = (edges: number[], targets: number[]) => {
            let shift = 0
            let dist = near
            for (const e of edges) for (const t of targets) if (Math.abs(t - e) < dist) [dist, shift] = [Math.abs(t - e), t - e]
            return shift
          }
          sx += best([o.x + sx, o.x + sx + o.w / 2, o.x + sx + o.w], xs)
          sy += best([o.y + sy, o.y + sy + o.h / 2, o.y + sy + o.h], ys)
        }
      }
      edit((s) => {
        for (const [i, o] of d.orig) {
          const t = s.objects[i]
          if (!t) continue
          t.x = round(o.x + sx)
          t.y = round(o.y + sy)
        }
      }, false)
      return
    }
    // resize
    const i = d.index!
    const o = d.orig.get(i)!
    const obj = slide.objects[i]
    edit((s) => {
      const t = s.objects[i]
      if (!t) return
      if (d.handle === 'p0') {
        t.x = round(o.x + fx)
        t.y = round(o.y + fy)
        t.w = round(o.x + o.w - t.x)
        t.h = round(o.y + o.h - t.y)
        return
      }
      if (d.handle === 'p1') {
        t.w = round(o.w + fx)
        t.h = round(o.h + fy)
        return
      }
      const hnd = d.handle!
      let l = o.x
      let tp = o.y
      let r = o.x + o.w
      let b = o.y + o.h
      if (hnd.includes('w')) l = Math.min(r - 0.02, o.x + fx)
      if (hnd.includes('e')) r = Math.max(l + 0.02, o.x + o.w + fx)
      if (hnd.includes('n')) tp = Math.min(b - 0.02, o.y + fy)
      if (hnd.includes('s')) b = Math.max(tp + 0.02, o.y + o.h + fy)
      const keep = (obj?.type === 'SlidePicture' && obj.keep_aspect && hnd.length === 2) || (e.shiftKey && hnd.length === 2)
      if (keep && o.w > 0 && o.h > 0) {
        const ratio = o.w / o.h
        const w = r - l
        const h = b - tp
        if (w / h > ratio) {
          const nh = w / ratio
          if (hnd.includes('n')) tp = b - nh
          else b = tp + nh
        } else {
          const nw = h * ratio
          if (hnd.includes('w')) l = r - nw
          else r = l + nw
        }
      }
      t.x = round(l)
      t.y = round(tp)
      t.w = round(r - l)
      t.h = round(b - tp)
    }, false)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (pageRef.current?.hasPointerCapture(e.pointerId)) pageRef.current.releasePointerCapture(e.pointerId)
    if (d?.kind === 'marquee') {
      setMarquee(null)
      if (d.moved && d.marquee) {
        const [mx, my, mw, mh] = d.marquee
        const hits = slide.objects
          .map((o, i) => ({ b: boundsPx(g, o), i }))
          .filter(({ b }) => b.left < mx + mw && b.left + b.width > mx && b.top < my + mh && b.top + b.height > my)
          .map(({ i }) => i)
        setSelection(withGroups(slide, e.shiftKey ? [...new Set([...selection, ...hits])] : hits))
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.ks2-editor, .ks2-celleditor')) return
    const hit = target.closest<HTMLElement>('[data-ks2-index]')
    if (!hit) return
    const i = Number(hit.dataset.ks2Index)
    const o = slide.objects[i]
    if (!o) return
    setSelection([i])
    if (o.type === 'SlideText') setEditingText(i)
    else if (o.type === 'SlidePicture') props.onPickPicture(i)
    else if (o.type === 'SlideTable') {
      const td = target.closest<HTMLElement>('[data-ks2-cell]')
      if (!td || !pageRef.current) return
      const [r, c] = td.dataset.ks2Cell!.split(',').map(Number)
      const pr = pageRef.current.getBoundingClientRect()
      const tr = td.getBoundingClientRect()
      setCell({ index: i, r, c, rect: { left: (tr.left - pr.left) / scale, top: (tr.top - pr.top) / scale, width: tr.width / scale, height: tr.height / scale } })
    } else props.onProperties(i)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-ks2-index]')
    const i = hit ? Number(hit.dataset.ks2Index) : null
    if (i !== null && !selection.includes(i)) setSelection(withGroups(slide, [i]))
    props.onContextMenu(e, i)
  }

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-kherveos-paths')
    if (!raw) return
    e.preventDefault()
    let paths: string[] = []
    try {
      paths = JSON.parse(raw) as string[]
    } catch {
      return
    }
    const [px, py] = toPage(e)
    props.onDropFiles(paths, { x: (px / g.W - g.gap) / g.span, y: (py / g.H - g.gap) / g.span })
  }

  // ---- overlay: selection frames, handles, the in-place editors
  const hs = 9 / scale
  const single = selection.length === 1 ? slide.objects[selection[0]] : undefined
  const overlay = (
    <>
      {selection.map((i) => {
        const o = slide.objects[i]
        if (!o) return null
        if (o.type === 'SlideLine') {
          const ends = [ptPx(g, o.x, o.y), ptPx(g, o.x + o.w, o.y + o.h)]
          return ends.map(([x, y], k) => (
            <div
              key={`${i}-${k}`}
              className="ks2-handle end"
              data-ks2-handle={o.locked || selection.length > 1 ? undefined : k ? 'p1' : 'p0'}
              data-ks2-index={i}
              style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs }}
            />
          ))
        }
        const b = boxPx(g, o)
        const rot = o.type === 'SlideShape' || o.type === 'SlidePicture' ? o.rotation : 0
        const style: CSSProperties = { ...b, borderWidth: 1.5 / scale, transform: rot ? `rotate(${rot}deg)` : undefined }
        return (
          <div key={i} className={`ks2-sel${o.locked ? ' locked' : ''}`} style={style}>
            {o.locked && (
              <span className="ks2-lockbadge" style={{ transform: `scale(${1 / scale})` }} title="Locked: beamer places it (unlock from the right-click menu)">
                <Lock size={11} />
              </span>
            )}
            {single === o &&
              !o.locked &&
              HANDLES.map((h) => (
                <div key={h} className={`ks2-handle ${h}`} data-ks2-handle={h} data-ks2-index={i} style={{ width: hs, height: hs, margin: -hs / 2 }} />
              ))}
          </div>
        )
      })}
      {marquee && <div className="ks2-marquee" style={{ left: marquee[0], top: marquee[1], width: marquee[2], height: marquee[3], borderWidth: 1 / scale }} />}
      {editingText !== null && slide.objects[editingText]?.type === 'SlideText' && (
        <TextEditor
          key={editingText}
          o={slide.objects[editingText] as SlideText}
          g={g}
          spell={props.spellcheck !== false}
          lang={props.lang}
          onDone={(text) => {
            const i = editingText
            setEditingText(null)
            if (text !== null && text !== (slide.objects[i] as SlideText).text) edit((s) => ((s.objects[i] as SlideText).text = text))
            pageRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {cell && slide.objects[cell.index]?.type === 'SlideTable' && (
        <CellEditor
          key={`${cell.index}-${cell.r}-${cell.c}`}
          value={(slide.objects[cell.index] as { rows: string[][] }).rows[cell.r]?.[cell.c] ?? ''}
          rect={cell.rect}
          fontPx={(slide.objects[cell.index] as { font_pt: number }).font_pt * g.pt}
          onDone={(v) => {
            const c = cell
            setCell(null)
            if (v === null) return
            edit((s) => {
              const t = s.objects[c.index]
              if (t?.type !== 'SlideTable') return
              while (t.rows.length <= c.r) t.rows.push([])
              const row = t.rows[c.r]
              while (row.length <= c.c) row.push('')
              row[c.c] = v
            })
            pageRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </>
  )

  return (
    <div
      className="ks2-canvas-page"
      ref={pageRef}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-kherveos-paths')) e.preventDefault()
      }}
      onDrop={onDrop}
      style={{ width, height: g.H * scale }}
    >
      <SlideView deck={deck} slide={slide} look={look} media={media} width={width} backdrop={backdrop} master={master} interactive hiddenText={editingText ?? undefined}>
        {overlay}
      </SlideView>
    </div>
  )
}

const round = (v: number) => Math.round(v * 1e6) / 1e6

/** The in-place text editor: the box's LaTeX source in the box's own font. Commits on focus-out or Escape, like the desktop. */
function TextEditor({ o, g, spell, lang, onDone }: { o: SlideText; g: Geometry; spell: boolean; lang?: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(o.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const b = boxPx(g, o)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <textarea
      ref={ref}
      className="ks2-editor"
      value={text}
      spellCheck={spell}
      lang={lang}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          finish(text)
        }
      }}
      style={{
        left: b.left,
        top: b.top,
        width: Math.max(b.width, 60),
        minHeight: Math.max(b.height, o.font_pt * g.pt * 1.6),
        height: Math.max(b.height, (text.split('\n').length + 1) * Math.round(o.font_pt * 1.2) * g.pt),
        fontSize: o.font_pt * g.pt,
        lineHeight: `${Math.round(o.font_pt * 1.2) * g.pt}px`,
        color: o.color || '#000',
        textAlign: (o.align as CSSProperties['textAlign']) || 'left',
        fontWeight: o.bold ? 'bold' : undefined,
        fontStyle: o.italic ? 'italic' : undefined,
      }}
    />
  )
}

function CellEditor({ value, rect, fontPx, onDone }: { value: string; rect: { left: number; top: number; width: number; height: number }; fontPx: number; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (x: string | null) => {
    if (done.current) return
    done.current = true
    onDone(x)
  }
  return (
    <input
      autoFocus
      className="ks2-celleditor"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          finish(v)
        } else if (e.key === 'Escape') finish(null)
      }}
      style={{ ...rect, fontSize: fontPx }}
    />
  )
}
