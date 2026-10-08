// The continuous page view: every page stacked in one scrolling column (only
// the pages near the viewport are rendered), the annotations drawn over them,
// and all the tools' mouse handling.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { os } from '@/os'
import type { MenuItem } from '@/os'
import type { PdfAnnot, PdfDocument, PdfLink, PdfPageInfo, PdfRect, PdfWidget, PdfWord } from '@/os/services/pdf'
import { AnnotShape, AnnotSvg } from './AnnotSvg'
import {
  annotBBox, fitTextRect, fontFamilyFor, hitAnnot, inRect, inflate, layoutText, moveAnnot, noteRect, normRect, rectsIntersect,
  TEXT_LEADING, textWidth, type Pt,
} from './geometry'
import { Icon, type Glyph } from './icons'
import { fontStyleOf, paragraphAt, type Paragraph } from './logic'
import { newAnnotId, useTab, type PdfTab, type WordRef } from './model'
import { SignaturePad } from './SignaturePad'
import { TEXT_TOOLS, TOOL_BY_ID, type ToolId, type ToolSettings } from './tools'

const PAD = 16
const GAP = 12
/** Largest page bitmap (pixels); beyond that a page is rendered a bit softer. */
const MAX_BITMAP_PX = 12_000_000

interface Box {
  top: number
  left: number
  w: number
  h: number
}

interface Loc {
  page: number
  x: number
  y: number
}

type Drag =
  | { kind: 'pan'; x: number; y: number; top: number; left: number; moved: boolean; link: PdfLink | null }
  | { kind: 'text'; anchor: WordRef; moved: boolean; x: number; y: number }
  | { kind: 'ink'; page: number; points: Pt[] }
  | { kind: 'shape'; tool: ToolId; page: number; start: Pt; end: Pt }
  | { kind: 'move'; page: number; start: Pt; dx: number; dy: number; ids: Set<string> }
  | { kind: 'marquee'; page: number; start: Pt; end: Pt; base: Set<string> }
  | { kind: 'erase'; hits: Set<string>; trail: { page: number; pts: Pt[] } }
  | { kind: 'movetext'; par: Paragraph; start: Pt; dx: number; dy: number }

type Editor =
  | { kind: 'text'; page: number; x: number; y: number; id: string | null; value: string; size: number; color: string; font?: string; boxWidth?: number }
  | { kind: 'note'; page: number; x: number; y: number; id: string | null; value: string; color: string }
  | { kind: 'field'; widget: PdfWidget; value: string }
  | { kind: 'replace'; page: number; rects: PdfRect[]; value: string; size: number; font: string; bold: boolean; italic: boolean; color: string }

// ------------------------------------------------------------------ helpers

function wordAt(words: PdfWord[], x: number, y: number): number | null {
  for (let i = 0; i < words.length; i++) {
    const r = words[i].rect
    if (inRect(r, x, y, (r[3] - r[1]) * 0.15)) return i
  }
  return null
}

function nearestWord(words: PdfWord[], x: number, y: number): number | null {
  let best: number | null = null
  let bestScore = Infinity
  words.forEach((w, i) => {
    const [x0, y0, x1, y1] = w.rect
    const dv = y >= y0 && y <= y1 ? 0 : Math.min(Math.abs(y - y0), Math.abs(y - y1))
    const dh = x >= x0 && x <= x1 ? 0 : Math.min(Math.abs(x - x0), Math.abs(x - x1))
    const score = dv * 1000 + dh
    if (score < bestScore) [best, bestScore] = [i, score]
  })
  return best
}

/** Merge words into one rectangle per line. */
function lineRects(words: PdfWord[], pad = 0): PdfRect[] {
  const out: PdfRect[] = []
  let cur: PdfRect | null = null
  let line = -1
  for (const w of words) {
    if (cur && w.line === line) {
      cur = [Math.min(cur[0], w.rect[0]), Math.min(cur[1], w.rect[1]), Math.max(cur[2], w.rect[2]), Math.max(cur[3], w.rect[3])]
    } else {
      if (cur) out.push(cur)
      cur = [...w.rect]
      line = w.line
    }
  }
  if (cur) out.push(cur)
  return out.map((r) => {
    const p = (r[3] - r[1]) * pad
    return [r[0], r[1] - p, r[2], r[3] + p] as PdfRect
  })
}

/** What a highlight/underline/strike-out swipe covers: the text between its ends, one box per line. */
function markRects(words: PdfWord[], start: Pt, end: Pt, tool: ToolId): PdfRect[] {
  const drag = normRect(start, end)
  const touched = words.some((w) => rectsIntersect(w.rect, inflate(drag, 0.5)))
  if (!touched) {
    const big = drag[2] - drag[0] > 2 && drag[3] - drag[1] > 2
    return tool === 'highlight' && big ? [drag] : []
  }
  let a = nearestWord(words, start[0], start[1])
  let b = nearestWord(words, end[0], end[1])
  if (a === null || b === null) return []
  if (a > b) [a, b] = [b, a]
  return lineRects(words.slice(a, b + 1), tool === 'highlight' ? 0.08 : 0)
}

const NAMED_COLOURS: [string, string][] = [
  ['Black', '#000000'], ['Red', '#e53935'], ['Orange', '#fb8c00'], ['Yellow', '#fbc02d'], ['Green', '#43a047'],
  ['Blue', '#1976d2'], ['Purple', '#7b1fa2'], ['Grey', '#757575'],
]

const clampTo = (info: PdfPageInfo, [x, y]: Pt): Pt => [
  Math.max(info.x, Math.min(info.x + info.width, x)),
  Math.max(info.y, Math.min(info.y + info.height, y)),
]

// ------------------------------------------------------------- page bitmap

const PageCanvas = memo(function PageCanvas({ pdf, index, info, zoom, renderKey }: {
  pdf: PdfDocument
  index: number
  info: PdfPageInfo
  zoom: number
  renderKey: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawn = useRef(false)
  useEffect(() => {
    const ac = new AbortController()
    const timer = setTimeout(() => {
      const dpr = window.devicePixelRatio || 1
      let scale = zoom * dpr
      const px = info.width * info.height * scale * scale
      if (px > MAX_BITMAP_PX) scale *= Math.sqrt(MAX_BITMAP_PX / px)
      pdf
        .renderPage(index, scale, { signal: ac.signal, priority: 'high' })
        .then((bmp) => {
          const c = ref.current
          if (!c || ac.signal.aborted) return bmp.close()
          c.width = bmp.width
          c.height = bmp.height
          c.getContext('2d')?.drawImage(bmp, 0, 0)
          bmp.close()
          drawn.current = true
        })
        .catch(() => {})
    }, drawn.current ? 140 : 0)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [pdf, index, info, zoom, renderKey])
  return <canvas ref={ref} className="kp-page-canvas" />
})

// ------------------------------------------------------------------ editors

const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]
const PDF_FONTS: [string, string][] = [['Helv', 'Helvetica'], ['TiRo', 'Times'], ['Cour', 'Courier']]
const NOT_YET = 'Not in the web edition yet (PDF text boxes keep one font and size)'

/** pdftab._TextFormatBar: the floating bar beside the on-page text editor. */
function TextFormatBar({ font, size, onFont, onSize }: { font?: string; size: number; onFont: (f: string) => void; onSize: (s: number) => void }) {
  const toggle = (g: Glyph) => (
    <button key={g} className="kp-fmt-btn" disabled title={NOT_YET} onMouseDown={(e) => e.preventDefault()}>
      <Icon name={g} size={16} />
    </button>
  )
  return (
    <div className="kp-fmt-bar" onPointerDown={(e) => e.stopPropagation()}>
      <select className="kp-fmt-font" value={font ?? 'Helv'} onChange={(e) => onFont(e.target.value)} title="Font">
        {PDF_FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input
        className="kp-fmt-size"
        list="kp-font-sizes"
        value={String(size)}
        title="Size"
        onChange={(e) => {
          const v = Number(e.target.value)
          if (v >= 4 && v <= 200) onSize(v)
        }}
      />
      <datalist id="kp-font-sizes">{FONT_SIZES.map((n) => <option key={n} value={n} />)}</datalist>
      {(['bold', 'italic', 'underline', 'superscript', 'subscript', 'align_left', 'align_center', 'align_right', 'align_justify'] as Glyph[]).map(toggle)}
      <span className="kp-fmt-label">Rot:</span>
      <select disabled title={NOT_YET} className="kp-fmt-rot"><option>0°</option></select>
    </div>
  )
}

function TextEditor({ ed, info, zoom, onChange, onDone }: {
  ed: Extract<Editor, { kind: 'text' }>
  info: PdfPageInfo
  zoom: number
  onChange: (patch: Partial<Extract<Editor, { kind: 'text' }>>) => void
  onDone: (commit: boolean) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    // After the click that opened it has finished (its mousedown would take the focus back).
    const timer = setTimeout(() => {
      const t = ref.current
      if (!t) return
      t.focus()
      if (ed.id) t.select()
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const lines = ed.boxWidth ? layoutText(ed.value, ed.size, ed.font, ed.boxWidth) : ed.value.split('\n')
  const widest = Math.max(ed.boxWidth ?? 0, ...lines.map((l) => textWidth(l, ed.size, ed.font)))
  const left = (ed.x - info.x) * zoom
  const top = (ed.y - info.y) * zoom
  return (
    <div
      className="kp-editor kp-text-wrap"
      style={{ left, top }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone(true)
      }}
    >
      <TextFormatBar font={ed.font} size={ed.size} onFont={(font) => onChange({ font })} onSize={(size) => onChange({ size })} />
      <textarea
        ref={ref}
        className="kp-text-editor"
        value={ed.value}
        spellCheck={false}
        style={{
          width: (widest + ed.size * 2) * zoom + 8,
          height: (Math.max(1, lines.length) * TEXT_LEADING + 0.4) * ed.size * zoom + 6,
          fontSize: ed.size * zoom,
          fontFamily: fontFamilyFor(ed.font),
          color: ed.color,
        }}
        onChange={(e) => onChange({ value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onDone(false)
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.stopPropagation()
            onDone(true)
          }
        }}
      />
    </div>
  )
}

/** pdftab._InlineReplaceItem: "Edit Selected Text" on the page, over the selected words. */
function ReplaceEditor({ ed, info, zoom, onChange, onDone }: {
  ed: Extract<Editor, { kind: 'replace' }>
  info: PdfPageInfo
  zoom: number
  onChange: (value: string) => void
  onDone: (commit: boolean) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  const r = ed.rects.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] as PdfRect)
  const rows = Math.max(1, ed.value.split('\n').length)
  return (
    <textarea
      ref={ref}
      className="kp-editor kp-replace-editor"
      value={ed.value}
      spellCheck={false}
      style={{
        left: (r[0] - info.x) * zoom - 2,
        top: (r[1] - info.y) * zoom - 2,
        minWidth: (r[2] - r[0]) * zoom + 8,
        width: Math.max((r[2] - r[0]) * zoom + 8, textWidth(ed.value.split('\n').reduce((a, b) => (a.length > b.length ? a : b), ''), ed.size, ed.font) * zoom + 12),
        height: rows * ed.size * 1.25 * zoom + 6,
        fontSize: ed.size * zoom,
        fontFamily: fontFamilyFor(ed.font),
        fontWeight: ed.bold ? 700 : 400,
        fontStyle: ed.italic ? 'italic' : 'normal',
        color: ed.color,
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onDone(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onDone(false)
        else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onDone(true)
        }
      }}
    />
  )
}

/** pdftab._StickyNotePopup: the yellow Post-it that edits a note. */
function NoteEditor({ ed, info, zoom, onChange, onDone }: {
  ed: Extract<Editor, { kind: 'note' }>
  info: PdfPageInfo
  zoom: number
  onChange: (value: string) => void
  onDone: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.querySelector('textarea')?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div
      ref={ref}
      className="kp-editor kp-note-editor"
      style={{ left: (ed.x - info.x + 22) * zoom, top: (ed.y - info.y) * zoom }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone()
        }
      }}
    >
      <div className="kp-note-head">Sticky note</div>
      <textarea value={ed.value} spellCheck onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** The "New sticky note" dialog (QInputDialog.getMultiLineText). */
function NewNoteDialog({ onDone }: { onDone: (text: string | null) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="kp-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form
        className="kp-modal kp-form"
        onSubmit={(e) => {
          e.preventDefault()
          onDone(value)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onDone(null)
        }}
      >
        <div className="kp-modal-title">New sticky note</div>
        <label className="kp-form-col">
          <span>Note text:</span>
          <textarea className="k-input kp-note-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="kp-modal-buttons">
          <span className="k-spacer" />
          <button type="submit" className="k-btn primary">OK</button>
          <button type="button" className="k-btn" onClick={() => onDone(null)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

function FieldEditor({ ed, info, zoom, onChange, onDone }: {
  ed: Extract<Editor, { kind: 'field' }>
  info: PdfPageInfo
  zoom: number
  onChange: (value: string) => void
  onDone: (commit: boolean) => void
}) {
  const w = ed.widget
  const [x0, y0, x1, y1] = w.rect
  const size = (w.fontSize || Math.min(12, (y1 - y0) * 0.7)) * zoom
  const style = { left: (x0 - info.x) * zoom, top: (y0 - info.y) * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom, fontSize: size }
  const common = {
    className: 'kp-editor kp-field-editor',
    style,
    value: ed.value,
    autoFocus: true,
    maxLength: w.maxLen > 0 ? w.maxLen : undefined,
    onBlur: () => onDone(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDone(false)
      } else if (e.key === 'Enter' && (!w.multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        onDone(true)
      }
    },
  }
  return w.multiline ? (
    <textarea {...common} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input {...common} type={w.password ? 'password' : 'text'} onChange={(e) => onChange(e.target.value)} />
  )
}

// ------------------------------------------------------------------- view

/** What the page view asks the window to do (actions shared with the menus). */
export interface PageActions {
  copyText: () => void
  copyImage: () => void
  deleteSelection: () => void
  pasteTextAt: (page: number, x: number, y: number) => void
  /** Edit Text tool: a click on a paragraph. */
  editParagraph: (p: Paragraph) => void
  /** Move Text tool: a paragraph dragged by (dx, dy) points. */
  moveParagraph: (p: Paragraph, dx: number, dy: number) => void
  /** Edit Selected Text: replace the words under `rects` by `text`. */
  replaceText: (page: number, rects: PdfRect[], text: string, style: { size: number; font: string; bold: boolean; italic: boolean; color: string }) => void
}

export interface PageViewProps {
  tab: PdfTab
  tool: ToolId
  settings: ToolSettings
  /** Show a short message in the status bar. */
  onStatus: (msg: string) => void
  actions: PageActions
  /** A dashed box over a paragraph being edited (Edit Text). */
  marker?: { page: number; rect: PdfRect } | null
}

export function PageView({ tab, tool, settings, onStatus, actions, marker }: PageViewProps) {
  useTab(tab)
  const pdf = tab.pdf
  const pages = pdf.pages
  const zoom = tab.view.zoom
  const scrollRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState({ top: tab.view.scrollTop, left: tab.view.scrollLeft, width: 0, height: 0 })
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [editor, setEditorState] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const [sigBox, setSigBox] = useState<{ page: number; rect: PdfRect } | null>(null)
  const [newNote, setNewNote] = useState<{ page: number; x: number; y: number } | null>(null)
  const anchorRef = useRef<{ x: number; y: number } | null>(null)

  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const setEditor = (e: Editor | null) => {
    editorRef.current = e
    setEditorState(e)
  }

  // ---- layout: page boxes in the scrolling sheet
  const layout = useMemo(() => {
    const maxW = Math.max(1, ...pages.map((p) => p.width)) * zoom
    const width = Math.max(vp.width, maxW + 2 * PAD)
    let y = PAD
    const boxes: Box[] = pages.map((p) => {
      const w = p.width * zoom
      const h = p.height * zoom
      const b = { top: y, left: Math.max(PAD, (width - w) / 2), w, h }
      y += h + GAP
      return b
    })
    return { boxes, width, height: y - GAP + PAD }
  }, [pages, zoom, vp.width])

  const live = useRef({ tab, tool, settings, layout, pages, zoom, actions })
  live.current = { tab, tool, settings, layout, pages, zoom, actions }

  // Edit ▸ Edit Selected Text… opens the on-page editor over the selection.
  useEffect(() => {
    tab.ui.editSelection = () => startReplace()
    return () => {
      tab.ui.editSelection = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  /** First page whose bottom is below `y` (sheet coordinates). */
  const pageAtY = (y: number, boxes = layout.boxes) => {
    let lo = 0
    let hi = boxes.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (boxes[mid].top + boxes[mid].h + GAP / 2 < y) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo)
  }

  const visible = useMemo(() => {
    if (!layout.boxes.length || !vp.height) return []
    const first = pageAtY(vp.top - vp.height * 0.5)
    const last = pageAtY(vp.top + vp.height * 1.5)
    const out: number[] = []
    for (let i = first; i <= last; i++) out.push(i)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, vp.top, vp.height])

  // ---- viewport tracking
  useLayoutEffect(() => {
    const el = scrollRef.current!
    let frame = 0
    const measure = () => {
      frame = 0
      setVp({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight })
    }
    const onScroll = () => {
      tab.view.scrollTop = el.scrollTop
      tab.view.scrollLeft = el.scrollLeft
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure)
    })
    ro.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [tab])

  // ---- fit width / fit page
  useEffect(() => {
    const fit = tab.view.fit
    if (!fit || !vp.width || !pages.length) return
    const maxW = Math.max(...pages.map((p) => p.width))
    let z = (vp.width - 2 * PAD) / maxW
    if (fit === 'page') {
      const p = pages[Math.min(tab.view.page, pages.length - 1)]
      z = Math.min((vp.width - 2 * PAD) / p.width, (vp.height - 2 * PAD) / p.height)
    }
    if (z > 0 && Math.abs(z - tab.view.zoom) > 0.002) tab.setZoom(z, fit)
  }, [tab, vp.width, vp.height, pages, tab.view.fit])

  // ---- keep the point under the mouse (or the middle) in place when zooming; restore scroll on mount
  const prev = useRef<{ zoom: number; boxes: Box[]; top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current!
    const p = prev.current
    if (!p) {
      if (vp.width) {
        el.scrollTop = tab.view.scrollTop
        el.scrollLeft = tab.view.scrollLeft
        prev.current = { zoom, boxes: layout.boxes, top: el.scrollTop, left: el.scrollLeft }
      }
      return
    }
    if (p.zoom !== zoom && p.boxes.length) {
      // Zoom around the pointer, else the middle — or the top while the view is at the top.
      const ax = anchorRef.current?.x ?? el.clientWidth / 2
      const ay = anchorRef.current?.y ?? (p.top <= 1 ? 0 : el.clientHeight / 3)
      anchorRef.current = null
      const sy = p.top + ay
      const sx = p.left + ax
      const i = Math.min(pageAtY(sy, p.boxes), layout.boxes.length - 1)
      const ob = p.boxes[i]
      const nb = layout.boxes[i]
      if (ob && nb) {
        const fy = (sy - ob.top) / p.zoom
        const fx = (sx - ob.left) / p.zoom
        el.scrollTop = nb.top + fy * zoom - ay
        el.scrollLeft = nb.left + fx * zoom - ax
      }
    }
    prev.current = { zoom, boxes: layout.boxes, top: el.scrollTop, left: el.scrollLeft }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, vp.width])
  useEffect(() => {
    if (prev.current) {
      prev.current.top = vp.top
      prev.current.left = vp.left
    }
  }, [vp.top, vp.left])

  // ---- the page in view
  useEffect(() => {
    if (!layout.boxes.length || !vp.height) return
    tab.setCurrentPage(Math.min(pageAtY(vp.top + vp.height * 0.3), pages.length - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp.top, vp.height, layout])

  // ---- scroll requests (go to page, search hits, outline)
  useEffect(() => {
    const req = tab.scrollRequest
    const el = scrollRef.current
    if (!req || !el || !vp.height) return
    tab.scrollRequest = null
    const b = layout.boxes[req.page]
    const info = pages[req.page]
    if (!b || !info) return
    if (req.rect) {
      const y0 = b.top + (req.rect[1] - info.y) * zoom
      const y1 = b.top + (req.rect[3] - info.y) * zoom
      const x0 = b.left + (req.rect[0] - info.x) * zoom
      const x1 = b.left + (req.rect[2] - info.x) * zoom
      const inView = y0 >= el.scrollTop + 20 && y1 <= el.scrollTop + el.clientHeight - 20
      if (req.center || !inView) el.scrollTop = (y0 + y1) / 2 - el.clientHeight / 2
      if (x0 < el.scrollLeft || x1 > el.scrollLeft + el.clientWidth) el.scrollLeft = (x0 + x1) / 2 - el.clientWidth / 2
    } else {
      el.scrollTop = b.top - PAD / 2
    }
  })

  // ---- fetch words, links and form fields of the pages in view
  useEffect(() => {
    for (const i of visible) {
      tab.wordsOf(i)
      tab.linksOf(i)
      tab.widgetsOf(i)
    }
  }, [tab, visible, tab.docVersion])

  // ---- Ctrl/⌘ + wheel zooms in or out one step (×1.25, pdftab.wheelEvent), around the pointer.
  // Trackpads send many small deltas: they add up to one notch before a step.
  useEffect(() => {
    const el = scrollRef.current!
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      acc += e.deltaY * (e.deltaMode === 1 ? 33 : 1)
      if (Math.abs(acc) < 40) return
      const r = el.getBoundingClientRect()
      anchorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
      tab.setZoom(acc < 0 ? tab.view.zoom * 1.25 : tab.view.zoom / 1.25, null)
      acc = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tab])

  // Close the editors when the tool changes.
  useEffect(() => {
    if (editorRef.current) finishEditor(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // ------------------------------------------------------------ geometry

  function sheetPoint(clientX: number, clientY: number) {
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    return { sx: clientX - r.left + el.scrollLeft, sy: clientY - r.top + el.scrollTop }
  }

  /** The page point under the pointer, or null between pages. */
  function locate(clientX: number, clientY: number): Loc | null {
    const { layout: L, pages: P, zoom: z } = live.current
    if (!L.boxes.length) return null
    const { sx, sy } = sheetPoint(clientX, clientY)
    const i = pageAtY(sy, L.boxes)
    const b = L.boxes[i]
    if (!b || sy < b.top || sy > b.top + b.h || sx < b.left || sx > b.left + b.w) return null
    return { page: i, x: P[i].x + (sx - b.left) / z, y: P[i].y + (sy - b.top) / z }
  }

  /** The pointer in the coordinates of a given page (may be outside it). */
  function pagePoint(page: number, clientX: number, clientY: number): Pt {
    const { layout: L, pages: P, zoom: z } = live.current
    const b = L.boxes[page]
    const { sx, sy } = sheetPoint(clientX, clientY)
    return [P[page].x + (sx - b.left) / z, P[page].y + (sy - b.top) / z]
  }

  /** The page under the pointer, or the nearest one. */
  function nearestPage(clientY: number): number {
    const { sy } = sheetPoint(0, clientY)
    return Math.min(pageAtY(sy), pages.length - 1)
  }

  const tol = () => Math.max(2, 4 / live.current.zoom)

  // ------------------------------------------------------------- actions

  const S = (t: ToolId) => live.current.settings[t]

  function addAnnots(list: Omit<PdfAnnot, 'id'>[], label: string) {
    if (!list.length) return
    const t = live.current.tab
    const added = list.map((a) => ({ ...a, id: newAnnotId() }))
    t.setAnnots([...t.annots, ...added], label)
  }

  function followLink(link: PdfLink) {
    if (link.page !== undefined) tab.goto(link.page)
    else if (/^(https?|mailto):/i.test(link.uri)) os.openUrl(link.uri)
  }

  function openNote(a: PdfAnnot) {
    const [x, y] = noteRect(a)
    setEditor({ kind: 'note', page: a.page, x, y, id: a.id, value: a.text ?? '', color: a.color })
  }

  function openTextEditor(a: PdfAnnot) {
    const [x0, y0, x1] = a.rect!
    setEditor({
      kind: 'text', page: a.page, x: x0, y: y0, id: a.id, value: a.text ?? '', size: a.fontSize || 12, color: a.color, font: a.font,
      boxWidth: x1 - x0,
    })
  }

  async function onWidget(w: PdfWidget, e: React.MouseEvent) {
    if (w.readOnly) return onStatus(`“${w.label || w.name}” is read-only`)
    try {
      if (w.type === 'text') setEditor({ kind: 'field', widget: w, value: w.value })
      else if (w.type === 'checkbox') await tab.setField(w, w.value === 'Off' || w.value === '')
      else if (w.type === 'radiobutton') await tab.setField(w, true)
      else if (w.type === 'combobox' || w.type === 'listbox') {
        os.contextMenu(
          e,
          w.options.map((o) => ({ label: o || '—', checked: o === w.value, onClick: () => void tab.setField(w, o).catch(fail) })),
        )
      }
    } catch (err) {
      fail(err)
    }
  }

  function fail(err: unknown) {
    void os.dialog.alert(err instanceof Error ? err.message : String(err), { title: 'KhervePDF' })
  }

  function finishEditor(commit: boolean) {
    const ed = editorRef.current
    if (!ed) return
    setEditor(null)
    const t = live.current.tab
    if (ed.kind === 'text') {
      const text = ed.value.replace(/\s+$/, '')
      const existing = ed.id ? t.annots.find((a) => a.id === ed.id) : undefined
      if (!commit) return
      if (existing) {
        if (!text.trim()) return t.setAnnots(t.annots.filter((a) => a.id !== ed.id), 'Delete text')
        if (text === existing.text) return
        let rect = fitTextRect(ed.x, ed.y, text, ed.size, ed.font)
        if (ed.boxWidth && ed.boxWidth >= rect[2] - rect[0]) {
          const lines = layoutText(text, ed.size, ed.font, ed.boxWidth).length
          rect = [ed.x, ed.y, ed.x + ed.boxWidth, ed.y + lines * ed.size * TEXT_LEADING + ed.size * 0.3]
        }
        t.setAnnots(t.annots.map((a) => (a.id === ed.id ? { ...a, text, rect } : a)), 'Edit text')
      } else if (text.trim()) {
        const s = S('text')
        addAnnots([{
          kind: 'text', page: ed.page, color: ed.color, opacity: s.opacity / 100, width: 0, fontSize: ed.size, font: ed.font ?? 'Helv',
          text, rect: fitTextRect(ed.x, ed.y, text, ed.size, ed.font),
        }], 'Add text')
      }
    } else if (ed.kind === 'note') {
      const text = ed.value
      if (ed.id) {
        const a = t.annots.find((x) => x.id === ed.id)
        if (a && a.text !== text) t.setAnnots(t.annots.map((x) => (x.id === ed.id ? { ...x, text } : x)), 'Edit note')
      } else if (text.trim()) {
        addAnnots([{ kind: 'note', page: ed.page, color: ed.color, opacity: 1, width: 1, rect: [ed.x, ed.y, ed.x + 20, ed.y + 20], text }], 'Add note')
      }
    } else if (ed.kind === 'field') {
      if (commit && ed.value !== ed.widget.value) void t.setField(ed.widget, ed.value).catch(fail)
    } else if (ed.kind === 'replace') {
      if (commit) live.current.actions.replaceText(ed.page, ed.rects, ed.value, { size: ed.size, font: ed.font, bold: ed.bold, italic: ed.italic, color: ed.color })
    }
  }

  /** Open the Edit Selected Text editor (single-page selections, as on the desktop). */
  function startReplace() {
    const t = live.current.tab
    const spans = t.selSpans()
    if (spans.length !== 1) {
      onStatus(spans.length ? 'Select text on one page to edit it' : 'Select some text first')
      return
    }
    const [page, from, to] = spans[0]
    const words = (t.wordsOf(page) ?? []).slice(from, to + 1)
    if (!words.length) return
    const st = fontStyleOf(words[0].font)
    const rects = t.selLineRects(page)
    void t.selectedText().then((value) => {
      setEditor({
        kind: 'replace', page, rects, value, size: words[0].size ?? (words[0].rect[3] - words[0].rect[1]) / 1.2,
        font: st.font, bold: st.bold, italic: st.italic, color: words[0].color ?? '#000000',
      })
    })
  }

  async function snapshot(page: number, rect: PdfRect) {
    try {
      const [png] = await tab.pdf.exportImages([page], { dpi: 200, clip: rect, annotations: tab.annots })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])
      onStatus('Copied the area to the clipboard as a picture')
    } catch (err) {
      fail(new Error(`Could not copy the picture: ${err instanceof Error ? err.message : err}`))
    }
  }

  function commitDrag(d: Drag, e: React.PointerEvent) {
    const t = live.current.tab
    switch (d.kind) {
      case 'pan':
        if (!d.moved && d.link) followLink(d.link)
        return
      case 'text':
        if (!d.moved) t.setTextSel(null)
        return
      case 'ink': {
        if (d.points.length < 2) return
        const s = S('pen')
        addAnnots([{ kind: 'ink', page: d.page, color: s.color, width: s.width, opacity: s.opacity / 100, strokes: [d.points] }], 'Draw')
        return
      }
      case 'move': {
        if (Math.abs(d.dx) < 0.5 && Math.abs(d.dy) < 0.5) return
        t.setAnnots(t.annots.map((a) => (d.ids.has(a.id) ? moveAnnot(a, d.dx, d.dy) : a)), 'Move')
        return
      }
      case 'marquee': {
        const r = normRect(d.start, d.end)
        if (r[2] - r[0] < 1 && r[3] - r[1] < 1) {
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) t.select([])
          return
        }
        const hits = t.annots.filter((a) => a.page === d.page && rectsIntersect(annotBBox(a) ?? [0, 0, -1, -1], r)).map((a) => a.id)
        t.select(new Set([...d.base, ...hits]))
        return
      }
      case 'erase': {
        if (!d.hits.size) return
        t.setAnnots(t.annots.filter((a) => !d.hits.has(a.id)), 'Erase')
        return
      }
      case 'movetext':
        // Under a point in both directions is a stray click, not a move.
        if (Math.abs(d.dx) < 1 && Math.abs(d.dy) < 1) return
        live.current.actions.moveParagraph(d.par, d.dx, d.dy)
        return
      case 'shape': {
        const s = S(d.tool)
        const r = normRect(d.start, d.end)
        const w = r[2] - r[0]
        const h = r[3] - r[1]
        const base = { page: d.page, color: s.color, width: s.width, opacity: s.opacity / 100 }
        switch (d.tool) {
          case 'line':
          case 'arrow':
            if (Math.hypot(w, h) < 1) return
            return addAnnots([{ ...base, kind: d.tool, line: [d.start, d.end] }], d.tool === 'line' ? 'Line' : 'Arrow')
          case 'rect':
          case 'ellipse':
            if (w < 1 && h < 1) return
            return addAnnots([{ ...base, kind: d.tool, rect: r, fill: s.filled ? (s.fill ?? s.color) : null }], d.tool === 'rect' ? 'Rectangle' : 'Ellipse')
          case 'highlight':
          case 'underline':
          case 'strikeout': {
            const rects = markRects(t.wordsOf(d.page) ?? [], d.start, d.end, d.tool)
            const label = TOOL_BY_ID[d.tool].label
            return addAnnots(rects.map((rect) => ({ ...base, kind: d.tool as 'highlight', width: 1, rects: [rect] })), label)
          }
          case 'redact':
            if (w < 2 || h < 2) return
            return addAnnots([{ ...base, kind: 'redact', color: '#000000', opacity: 1, rect: r }], 'Mark for redaction')
          case 'signature':
            if (w < 5 || h < 5) return onStatus('Drag a box where the signature should go')
            return setSigBox({ page: d.page, rect: r })
          case 'snapshot':
            if (w < 2 || h < 2) return
            return void snapshot(d.page, r)
        }
      }
    }
  }

  // --------------------------------------------------------------- pointer

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('.kp-editor, .kp-field')) return
    // A click outside an open editor just closes it.
    if (editorRef.current) {
      finishEditor(true)
      return
    }
    if (e.button !== 0) return
    const el = scrollRef.current!
    el.focus({ preventScroll: true })
    const { tab: t, tool: tl } = live.current
    const loc = locate(e.clientX, e.clientY)
    if (loc) t.lastClick = loc
    const words = loc ? t.wordsOf(loc.page) ?? [] : []
    const startText = (anyWhere: boolean) => {
      if (!loc) return false
      const i = anyWhere ? nearestWord(words, loc.x, loc.y) : wordAt(words, loc.x, loc.y)
      if (i === null) return false
      const anchor = { page: loc.page, index: i }
      t.setTextSel(null)
      setDrag({ kind: 'text', anchor, moved: false, x: e.clientX, y: e.clientY })
      return true
    }
    const capture = () => el.setPointerCapture(e.pointerId)

    if (tl === 'hand' || tl === 'select') {
      if (loc) {
        const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
        // A click on a sticky-note marker opens it, in Hand and Select alike.
        if (hit?.kind === 'note') {
          openNote(hit)
          return
        }
        // Hand: a click on a link follows it (a drag still pans).
        const link = tl === 'hand' && !hit ? (t.linksOf(loc.page) ?? []).find((l) => inRect(l.rect, loc.x, loc.y)) : undefined
        if (link) {
          if (t.textSel) t.setTextSel(null)
          setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft, moved: false, link })
          capture()
          return
        }
        if (tl === 'select' && hit) {
          const additive = e.shiftKey || e.metaKey || e.ctrlKey
          let sel = new Set(t.selected)
          if (additive) {
            if (sel.has(hit.id)) sel.delete(hit.id)
            else sel.add(hit.id)
            t.select(sel)
            return
          }
          if (!sel.has(hit.id)) t.select((sel = new Set([hit.id])))
          t.setTextSel(null)
          setDrag({ kind: 'move', page: loc.page, start: [loc.x, loc.y], dx: 0, dy: 0, ids: sel })
          capture()
          return
        }
        if (startText(false)) {
          if (t.selected.size) t.select([])
          capture()
          return
        }
      }
      if (t.textSel) t.setTextSel(null)
      if (tl === 'select') {
        if (!loc) return t.select([])
        const base = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(t.selected) : new Set<string>()
        setDrag({ kind: 'marquee', page: loc.page, start: [loc.x, loc.y], end: [loc.x, loc.y], base })
        capture()
        return
      }
      if (e.pointerType === 'touch') return // native scrolling
      setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft, moved: false, link: null })
      capture()
      return
    }
    if (!loc) return
    if (tl === 'select_text') {
      if (startText(true)) capture()
      return
    }
    if (tl === 'text') {
      const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
      if (hit?.kind === 'text') return openTextEditor(hit)
      const s = S('text')
      e.preventDefault()
      setEditor({ kind: 'text', page: loc.page, x: loc.x, y: loc.y, id: null, value: '', size: s.width, color: s.color, font: 'Helv' })
      return
    }
    if (tl === 'note') {
      const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
      if (hit?.kind === 'note') return openNote(hit)
      e.preventDefault()
      setNewNote({ page: loc.page, x: loc.x, y: loc.y })
      return
    }
    if (tl === 'edit_text' || tl === 'move_text') {
      const words = t.wordsOf(loc.page)
      const par = words ? paragraphAt(words, loc.page, loc.x, loc.y) : null
      if (!par) return onStatus(words ? 'No text there — click a paragraph' : 'Reading the page text…')
      e.preventDefault()
      if (tl === 'edit_text') return live.current.actions.editParagraph(par)
      setDrag({ kind: 'movetext', par, start: [loc.x, loc.y], dx: 0, dy: 0 })
      capture()
      return
    }
    if (tl === 'erase') {
      const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
      setDrag({ kind: 'erase', hits: new Set(hit ? [hit.id] : []), trail: { page: loc.page, pts: [[loc.x, loc.y]] } })
      capture()
      return
    }
    if (tl === 'pen') {
      setDrag({ kind: 'ink', page: loc.page, points: [[loc.x, loc.y]] })
      capture()
      return
    }
    setDrag({ kind: 'shape', tool: tl, page: loc.page, start: [loc.x, loc.y], end: [loc.x, loc.y] })
    capture()
  }

  function hoverCursor(e: React.PointerEvent) {
    const el = scrollRef.current!
    const { tab: t, tool: tl } = live.current
    const loc = locate(e.clientX, e.clientY)
    let cursor = 'default'
    if (tl === 'hand' || tl === 'select') {
      cursor = tl === 'hand' ? 'grab' : 'default'
      if (loc) {
        const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
        if (hit && (tl === 'select' || hit.kind === 'note')) cursor = tl === 'select' && t.selected.has(hit.id) ? 'move' : 'pointer'
        else if ((t.linksOf(loc.page) ?? []).some((l) => inRect(l.rect, loc.x, loc.y))) cursor = 'pointer'
        else if (wordAt(t.wordsOf(loc.page) ?? [], loc.x, loc.y) !== null) cursor = 'text'
      }
    } else if (tl === 'move_text') cursor = 'move'
    else if (TEXT_TOOLS.has(tl)) cursor = 'text'
    else cursor = 'crosshair'
    if (el.style.cursor !== cursor) el.style.cursor = cursor
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return hoverCursor(e)
    const el = scrollRef.current!
    const t = live.current.tab
    // Scroll when dragging past the top or bottom edge.
    if (d.kind !== 'pan') {
      const r = el.getBoundingClientRect()
      if (e.clientY > r.bottom - 24) el.scrollTop += Math.min(30, (e.clientY - (r.bottom - 24)) / 2 + 2)
      else if (e.clientY < r.top + 24) el.scrollTop -= Math.min(30, (r.top + 24 - e.clientY) / 2 + 2)
    }
    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
        el.scrollLeft = d.left - dx
        el.scrollTop = d.top - dy
        el.style.cursor = 'grabbing'
        return
      }
      case 'text': {
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return
        const page = nearestPage(e.clientY)
        const words = t.wordsOf(page)
        if (!words?.length) return
        const [x, y] = pagePoint(page, e.clientX, e.clientY)
        const i = nearestWord(words, x, y)
        if (i === null) return
        d.moved = true
        const f = t.textSel?.focus
        if (!f || f.page !== page || f.index !== i || t.textSel?.anchor !== d.anchor) t.setTextSel({ anchor: d.anchor, focus: { page, index: i } })
        return
      }
      case 'ink': {
        const p = clampTo(pages[d.page], pagePoint(d.page, e.clientX, e.clientY))
        const last = d.points[d.points.length - 1]
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.4 / zoom) return
        setDrag({ ...d, points: [...d.points, p] })
        return
      }
      case 'shape':
        setDrag({ ...d, end: clampTo(pages[d.page], pagePoint(d.page, e.clientX, e.clientY)) })
        return
      case 'marquee':
        setDrag({ ...d, end: clampTo(pages[d.page], pagePoint(d.page, e.clientX, e.clientY)) })
        return
      case 'move': {
        const [x, y] = pagePoint(d.page, e.clientX, e.clientY)
        setDrag({ ...d, dx: x - d.start[0], dy: y - d.start[1] })
        return
      }
      case 'movetext': {
        const [x, y] = pagePoint(d.par.page, e.clientX, e.clientY)
        setDrag({ ...d, dx: x - d.start[0], dy: y - d.start[1] })
        return
      }
      case 'erase': {
        const loc = locate(e.clientX, e.clientY)
        if (!loc) return
        const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
        const hits = hit && !d.hits.has(hit.id) ? new Set([...d.hits, hit.id]) : d.hits
        const trail = loc.page === d.trail.page ? { page: d.trail.page, pts: [...d.trail.pts, [loc.x, loc.y] as Pt] } : { page: loc.page, pts: [[loc.x, loc.y] as Pt] }
        setDrag({ ...d, hits, trail })
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    setDrag(null)
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    commitDrag(d, e)
    hoverCursor(e)
  }

  function onDoubleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.kp-editor, .kp-field')) return
    const { tab: t, tool: tl } = live.current
    const loc = locate(e.clientX, e.clientY)
    if (!loc) return
    const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
    if (hit && (tl === 'select' || tl === 'hand')) {
      if (hit.kind === 'text') return openTextEditor(hit)
      if (hit.kind === 'note') return openNote(hit)
    }
    if (tl === 'hand' || tl === 'select' || tl === 'select_text') {
      const i = wordAt(t.wordsOf(loc.page) ?? [], loc.x, loc.y)
      if (i !== null) t.setTextSel({ anchor: { page: loc.page, index: i }, focus: { page: loc.page, index: i } })
    }
  }

  /** pdftab.contextMenuEvent (+ the web edition's annotation items). */
  function onContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.kp-editor')) return
    e.preventDefault()
    const { tab: t, actions: act } = live.current
    const loc = locate(e.clientX, e.clientY)
    const items: MenuItem[] = []
    const icon = (g: Glyph) => <Icon name={g} size={15} />
    if (t.textSel) {
      const single = t.selSpans().length === 1
      items.push(
        { label: 'Copy', image: icon('copy'), shortcut: '⌘C', onClick: act.copyText },
        { label: 'Copy as Image', disabled: !single, onClick: act.copyImage },
        '-',
        { label: 'Edit Selected Text…', image: icon('edit_text'), disabled: !single, onClick: startReplace },
        { label: 'Delete Selected Text', shortcut: 'Del', disabled: !single, onClick: act.deleteSelection },
        { label: 'Highlight', image: icon('highlight'), onClick: () => markSelection(t, 'highlight', live.current.settings) },
        { label: 'Underline', image: icon('underline'), onClick: () => markSelection(t, 'underline', live.current.settings) },
        { label: 'Strike Out', onClick: () => markSelection(t, 'strikeout', live.current.settings) },
        '-',
      )
    }
    if (loc) {
      const s = live.current.settings
      items.push(
        { label: 'Paste Text Here', image: icon('paste'), onClick: () => act.pasteTextAt(loc.page, loc.x, loc.y) },
        { label: 'Add Text Here', image: icon('text'), onClick: () => setEditor({ kind: 'text', page: loc.page, x: loc.x, y: loc.y, id: null, value: '', size: s.text.width, color: s.text.color, font: 'Helv' }) },
        { label: 'Select All Text on Page', shortcut: '⌘A', onClick: () => selectAllOnPage(t, loc.page) },
      )
      // Web edition: the annotation under the pointer.
      const hit = hitAnnot(t.annots, loc.page, loc.x, loc.y, tol())
      if (hit) {
        const ids = t.selected.has(hit.id) ? new Set(t.selected) : new Set([hit.id])
        if (!t.selected.has(hit.id)) t.select(ids)
        items.push('-')
        if (hit.kind === 'text') items.push({ label: 'Edit Text Box', onClick: () => openTextEditor(hit) })
        if (hit.kind === 'note') items.push({ label: 'Open Note', onClick: () => openNote(hit) })
        if (hit.kind !== 'image' && hit.kind !== 'redact') {
          items.push({
            label: 'Colour',
            submenu: NAMED_COLOURS.map(([name, color]) => ({
              label: name,
              checked: hit.color.toLowerCase() === color,
              onClick: () => t.setAnnots(t.annots.map((a) => (ids.has(a.id) && a.kind !== 'image' && a.kind !== 'redact' ? { ...a, color } : a)), 'Change colour'),
            })),
          })
        }
        items.push({
          label: ids.size > 1 ? `Delete ${ids.size} Annotations` : 'Delete Annotation', danger: true,
          onClick: () => t.setAnnots(t.annots.filter((a) => !ids.has(a.id)), ids.size > 1 ? 'Delete annotations' : 'Delete annotation'),
        })
      }
    }
    if (items.length) os.contextMenu(e, items)
  }

  // ------------------------------------------------------------- render

  const byPage = useMemo(() => {
    const m = new Map<number, PdfAnnot[]>()
    for (const a of tab.annots) {
      const list = m.get(a.page)
      if (list) list.push(a)
      else m.set(a.page, [a])
    }
    return m
  }, [tab.annots])

  const search = tab.search
  const hitsByPage = useMemo(() => {
    const m = new Map<number, { rects: PdfRect[]; current: boolean }[]>()
    if (!search) return m
    search.hits.forEach((h, i) => {
      const list = m.get(h.page) ?? []
      list.push({ rects: h.rects.map((r) => [r.x, r.y, r.x + r.w, r.y + r.h] as PdfRect), current: i === search.index })
      m.set(h.page, list)
    })
    return m
  }, [search])

  const hiddenId = editor && (editor.kind === 'text' || editor.kind === 'note') ? (editor.id ?? null) : null
  const showFields = pdf.hasForms && (tool === 'hand' || tool === 'select')
  const sw = 1.5 / zoom

  function previewFor(i: number): ReactNode {
    const d = drag
    if (!d) return null
    if (d.kind === 'ink' && d.page === i) {
      const s = S('pen')
      return <AnnotShape a={{ id: '~', kind: 'ink', page: i, color: s.color, width: s.width, opacity: s.opacity / 100, strokes: [d.points] }} />
    }
    if (d.kind === 'marquee' && d.page === i) {
      const r = normRect(d.start, d.end)
      return <rect className="kp-marquee" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} strokeWidth={sw} />
    }
    if (d.kind === 'movetext' && d.par.page === i) {
      const r = d.par.rect
      return <rect className="kp-block-marker" x={r[0] + d.dx - 2} y={r[1] + d.dy - 2} width={r[2] - r[0] + 4} height={r[3] - r[1] + 4} strokeWidth={sw} />
    }
    if (d.kind === 'erase' && d.trail.page === i) {
      return <polyline className="kp-erase-trail" points={d.trail.pts.map((p) => p.join(',')).join(' ')} strokeWidth={4 / zoom} />
    }
    if (d.kind !== 'shape' || d.page !== i) return null
    const s = S(d.tool)
    const base = { id: '~', page: i, color: s.color, width: s.width, opacity: s.opacity / 100 }
    const r = normRect(d.start, d.end)
    switch (d.tool) {
      case 'line':
      case 'arrow':
        return <AnnotShape a={{ ...base, kind: d.tool, line: [d.start, d.end] }} />
      case 'rect':
      case 'ellipse':
        return <AnnotShape a={{ ...base, kind: d.tool, rect: r, fill: s.filled ? (s.fill ?? s.color) : null }} />
      case 'highlight':
      case 'underline':
      case 'strikeout': {
        const rects = markRects(tab.wordsOf(i) ?? [], d.start, d.end, d.tool)
        return <AnnotShape a={{ ...base, kind: d.tool, rects }} />
      }
      case 'redact':
        return <rect className="kp-redact-mark" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
      default:
        return <rect className="kp-marquee" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} strokeWidth={sw} />
    }
  }

  return (
    <>
    <div
      ref={scrollRef}
      className={`kp-scroll${tool === 'hand' ? ' hand' : ''}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="kp-sheet" style={{ width: layout.width, height: layout.height }}>
        {visible.map((i) => {
          const info = pages[i]
          const b = layout.boxes[i]
          if (!info || !b) return null
          const annots = byPage.get(i) ?? []
          const moving = drag?.kind === 'move' && drag.page === i ? drag.ids : undefined
          const selBoxes = annots
            .filter((a) => tab.selected.has(a.id))
            .map((a) => {
              const bb = annotBBox(a)
              if (!bb) return null
              const off = moving?.has(a.id) && drag?.kind === 'move' ? [drag.dx, drag.dy] : [0, 0]
              const r = inflate(bb, 3 / zoom)
              return <rect key={a.id} className="kp-sel-box" x={r[0] + off[0]} y={r[1] + off[1]} width={r[2] - r[0]} height={r[3] - r[1]} strokeWidth={sw} />
            })
          const widgets = showFields ? tab.widgetsOf(i) : undefined
          return (
            <div key={i} className="kp-page" style={{ top: b.top, left: b.left, width: b.w, height: b.h }} data-page={i}>
              <PageCanvas pdf={pdf} index={i} info={info} zoom={zoom} renderKey={tab.docVersion} />
              <AnnotSvg
                page={info}
                annots={annots}
                hidden={hiddenId}
                moving={moving}
                offset={drag?.kind === 'move' ? [drag.dx, drag.dy] : undefined}
                faded={drag?.kind === 'erase' ? drag.hits : undefined}
              >
                {tab.selLineRects(i).map((r, k) => (
                  <rect key={`s${k}`} className="kp-text-sel" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
                ))}
                {(hitsByPage.get(i) ?? []).map((h, k) =>
                  h.rects.map((r, j) => (
                    <rect key={`h${k}.${j}`} className={`kp-hit${h.current ? ' current' : ''}`} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} strokeWidth={sw} />
                  )),
                )}
                {selBoxes}
                {previewFor(i)}
                {marker && marker.page === i && (
                  <rect className="kp-block-marker" x={marker.rect[0] - 2} y={marker.rect[1] - 2} width={marker.rect[2] - marker.rect[0] + 4} height={marker.rect[3] - marker.rect[1] + 4} strokeWidth={sw} />
                )}
                {editor?.kind === 'replace' && editor.page === i && editor.rects.map((r, k) => (
                  <rect key={`r${k}`} fill="#ffffff" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />
                ))}
              </AnnotSvg>
              {widgets?.map((w) => (
                <button
                  key={w.id}
                  className={`kp-field ${w.type}${w.readOnly ? ' readonly' : ''}`}
                  title={w.label || w.name}
                  style={{
                    left: (w.rect[0] - info.x) * zoom, top: (w.rect[1] - info.y) * zoom,
                    width: (w.rect[2] - w.rect[0]) * zoom, height: (w.rect[3] - w.rect[1]) * zoom,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => void onWidget(w, e)}
                />
              ))}
              {editor?.kind === 'text' && editor.page === i && (
                <TextEditor ed={editor} info={info} zoom={zoom} onChange={(patch) => setEditor({ ...editor, ...patch })} onDone={finishEditor} />
              )}
              {editor?.kind === 'replace' && editor.page === i && (
                <ReplaceEditor ed={editor} info={info} zoom={zoom} onChange={(value) => setEditor({ ...editor, value })} onDone={finishEditor} />
              )}
              {editor?.kind === 'note' && editor.page === i && (
                <>
                  {!editor.id && (
                    <svg className="kp-annots" viewBox={`${info.x} ${info.y} ${info.width} ${info.height}`} preserveAspectRatio="none">
                      <AnnotShape a={{ id: '~', kind: 'note', page: i, color: editor.color, opacity: 1, width: 1, rect: [editor.x, editor.y, editor.x + 20, editor.y + 20] }} />
                    </svg>
                  )}
                  <NoteEditor
                    ed={editor}
                    info={info}
                    zoom={zoom}
                    onChange={(value) => setEditor({ ...editor, value })}
                    onDone={() => finishEditor(true)}
                  />
                </>
              )}
              {editor?.kind === 'field' && editor.widget.page === i && (
                <FieldEditor ed={editor} info={info} zoom={zoom} onChange={(value) => setEditor({ ...editor, value })} onDone={finishEditor} />
              )}
            </div>
          )
        })}
      </div>
    </div>
      {newNote && (
        <NewNoteDialog
          onDone={(text) => {
            const at = newNote
            setNewNote(null)
            if (text && text.trim()) {
              addAnnots([{ kind: 'note', page: at.page, color: '#fff59d', opacity: 1, width: 1, rect: [at.x, at.y, at.x + 20, at.y + 20], text }], 'Add note')
            }
            scrollRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {sigBox && (
        <SignaturePad
          aspect={(sigBox.rect[2] - sigBox.rect[0]) / (sigBox.rect[3] - sigBox.rect[1])}
          color="#1a1a1a"
          onCancel={() => setSigBox(null)}
          onDone={(png) => {
            const box = sigBox
            setSigBox(null)
            addAnnots([{ kind: 'image', page: box.page, color: '#000000', opacity: 1, width: 1, rect: box.rect, image: png }], 'Signature')
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------- selection-based actions

/** Turn the text selection into highlight / underline / strike-out marks (one per line). */
export function markSelection(tab: PdfTab, kind: 'highlight' | 'underline' | 'strikeout', settings: ToolSettings) {
  const s = settings[kind]
  const list: PdfAnnot[] = []
  for (const [page, from, to] of tab.selSpans()) {
    const words = tab.wordsOf(page)?.slice(from, to + 1) ?? []
    for (const rect of lineRects(words, kind === 'highlight' ? 0.08 : 0)) {
      list.push({ id: newAnnotId(), kind, page, color: s.color, opacity: s.opacity / 100, width: 1, rects: [rect] })
    }
  }
  if (!list.length) return
  tab.setAnnots([...tab.annots, ...list], TOOL_BY_ID[kind].label)
  tab.setTextSel(null)
}

export function selectAllOnPage(tab: PdfTab, page: number) {
  void tab.wordsAsync(page).then((words) => {
    if (words.length) tab.setTextSel({ anchor: { page, index: 0 }, focus: { page, index: words.length - 1 } })
  })
}
