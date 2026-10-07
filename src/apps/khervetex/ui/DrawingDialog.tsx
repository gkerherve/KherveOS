// Drawing (Insert ▸ Drawing…, drawing_dialog.py): a small vector editor — the
// tool palette on the left (the desktop's own tool icons), stroke / fill /
// line options on top, the selection's properties on the right, the canvas in
// the middle. On Insert the drawing becomes three files beside each other, as
// on the desktop: drawing_NNN.svg (its editable source), drawing_NNN.pdf (the
// vector picture LaTeX includes, drawn with TikZ) and drawing_NNN.png (the
// preview the Visual tab shows).

import { useEffect, useMemo, useRef, useState } from 'react'
import { os } from '@/os'
import { escapeText } from '../serializer'
import { iconUrl } from './actions'
import { compileStandalone } from './standalone'
import type { Done } from './dialogs'

type Kind = 'path' | 'line' | 'arrow' | 'rect' | 'roundrect' | 'circle' | 'ellipse' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'text'
type Tool = 'pointer' | 'pencil' | 'eraser' | 'bucket' | 'picker' | Kind

interface Shape {
  id: number
  kind: Kind
  /** Box shapes and text: the corner and size (mm). Lines: from (x, y) to (x + w, y + h). */
  x: number
  y: number
  w: number
  h: number
  /** Freehand: points in mm. */
  pts?: [number, number][]
  stroke: string
  /** '' = no fill. */
  fill: string
  /** Line width in points. */
  width: number
  dash: 'solid' | 'dash' | 'dot' | 'dashdot'
  text?: string
  /** Text size in points. */
  size?: number
}

export interface DrawingResult {
  svg: string
  pdf: Uint8Array | null
  png: Uint8Array
  widthMm: number
}

const PALETTE = ['#000000', '#ffffff', '#7a7a7a', '#1a6dd8', '#d8000c', '#0a8f3c', '#d96b00', '#8e44ad', '#f2c500', '#17a2b8']
const LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]
const DASHES: [Shape['dash'], string][] = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot']]
const TOOLS: [Tool, string, string][] = [
  ['pointer', 'pointer', 'Select / move / resize (V)'],
  ['pencil', 'pencil', 'Pencil (freehand) (P)'],
  ['eraser', 'eraser', 'Eraser (removes shapes) (X)'],
  ['bucket', 'bucket', 'Bucket fill (B)'],
  ['picker', 'picker', 'Colour picker (Shift+click: fill colour) (K)'],
  ['text', 'text', 'Text (T)'],
  ['line', 'line', 'Line (L)'],
  ['arrow', 'arrow', 'Arrow (A)'],
  ['rect', 'rect', 'Rectangle (R)'],
  ['roundrect', 'roundrect', 'Rounded rectangle'],
  ['circle', 'circle', 'Circle (C)'],
  ['ellipse', 'ellipse', 'Ellipse (E)'],
  ['triangle', 'triangle', 'Triangle'],
  ['diamond', 'diamond', 'Diamond'],
  ['pentagon', 'pentagon', 'Pentagon'],
  ['hexagon', 'hexagon', 'Hexagon'],
  ['star', 'star', 'Star (5-point)'],
]
const KEYS: Record<string, Tool> = { v: 'pointer', p: 'pencil', x: 'eraser', b: 'bucket', k: 'picker', t: 'text', l: 'line', a: 'arrow', r: 'rect', c: 'circle', e: 'ellipse' }

/** px per mm on the canvas at 100 %. */
const PX = 4
const PAGE: [number, number] = [160, 100]
const PT = 0.3528 // mm per point

function polygon(kind: Kind, x: number, y: number, w: number, h: number): [number, number][] {
  const cx = x + w / 2
  const cy = y + h / 2
  const reg = (n: number, rot = -Math.PI / 2): [number, number][] =>
    Array.from({ length: n }, (_, i) => [cx + (w / 2) * Math.cos(rot + (i * 2 * Math.PI) / n), cy + (h / 2) * Math.sin(rot + (i * 2 * Math.PI) / n)])
  switch (kind) {
    case 'triangle': return [[cx, y], [x + w, y + h], [x, y + h]]
    case 'diamond': return [[cx, y], [x + w, cy], [cx, y + h], [x, cy]]
    case 'pentagon': return reg(5)
    case 'hexagon': return reg(6, 0)
    case 'star': return Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 0.4 : 1
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      return [cx + (w / 2) * r * Math.cos(a), cy + (h / 2) * r * Math.sin(a)] as [number, number]
    })
    default: return []
  }
}

const dashArray = (d: Shape['dash'], w: number) =>
  d === 'dash' ? `${4 * w} ${3 * w}` : d === 'dot' ? `${w} ${2 * w}` : d === 'dashdot' ? `${4 * w} ${2 * w} ${w} ${2 * w}` : undefined

/** One shape as SVG (in mm). */
function ShapeSvg({ s, sel, onDown }: { s: Shape; sel?: boolean; onDown?: (e: React.PointerEvent) => void }) {
  const sw = s.width * PT
  const common = {
    stroke: s.stroke, strokeWidth: sw, fill: s.fill || 'none', strokeDasharray: dashArray(s.dash, sw),
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, onPointerDown: onDown,
    style: sel ? { filter: 'drop-shadow(0 0 0.6px #22b357) drop-shadow(0 0 0.6px #22b357)' } : undefined,
  }
  const box = { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) }
  switch (s.kind) {
    case 'path':
      return <polyline points={(s.pts ?? []).map((p) => p.join(',')).join(' ')} {...common} fill="none" />
    case 'line':
    case 'arrow':
      return <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} {...common} markerEnd={s.kind === 'arrow' ? `url(#ktx-dr-head-${s.id})` : undefined} />
    case 'rect':
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} {...common} />
    case 'roundrect':
      return <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={Math.min(2.5, box.w / 4)} {...common} />
    case 'circle':
    case 'ellipse':
      return <ellipse cx={box.x + box.w / 2} cy={box.y + box.h / 2} rx={box.w / 2} ry={box.h / 2} {...common} />
    case 'text':
      return (
        <text x={s.x} y={s.y} fontSize={(s.size ?? 12) * PT} fill={s.stroke} dominantBaseline="hanging" fontFamily="'Latin Modern Roman', 'Times New Roman', serif" onPointerDown={onDown} style={common.style}>
          {s.text}
        </text>
      )
    default:
      return <polygon points={polygon(s.kind, box.x, box.y, box.w, box.h).map((p) => p.join(',')).join(' ')} {...common} />
  }
}

function arrowDefs(shapes: Shape[]) {
  return (
    <defs>
      {shapes.filter((s) => s.kind === 'arrow').map((s) => (
        <marker key={s.id} id={`ktx-dr-head-${s.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth={6} markerHeight={6} orient="auto">
          <path d="M0,0L10,5L0,10z" fill={s.stroke} />
        </marker>
      ))}
    </defs>
  )
}

function bounds(shapes: Shape[]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of shapes) {
    const pts: [number, number][] = s.pts ?? [[s.x, s.y], [s.x + s.w, s.y + s.h]]
    if (s.kind === 'text') pts.push([s.x + ((s.text ?? '').length * (s.size ?? 12) * PT) * 0.5, s.y + (s.size ?? 12) * PT * 1.2])
    const m = s.width * PT
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x - m)
      y0 = Math.min(y0, y - m)
      x1 = Math.max(x1, x + m)
      y1 = Math.max(y1, y + m)
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 10, 10]
  return [x0 - 2, y0 - 2, x1 + 2, y1 + 2]
}

/** The drawing as an SVG file: mm units, cropped to the content, with its shapes as JSON to reopen it. */
export function drawingSvg(shapes: Shape[]): { svg: string; w: number; h: number } {
  const [x0, y0, x1, y1] = bounds(shapes)
  const w = x1 - x0
  const h = y1 - y0
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const body = shapes.map((s) => {
    const sw = s.width * PT
    const dash = dashArray(s.dash, sw)
    const st = `stroke="${s.stroke}" stroke-width="${sw.toFixed(3)}" fill="${s.fill || 'none'}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"`
    const bx = Math.min(s.x, s.x + s.w)
    const by = Math.min(s.y, s.y + s.h)
    const bw = Math.abs(s.w)
    const bh = Math.abs(s.h)
    switch (s.kind) {
      case 'path': return `<polyline points="${(s.pts ?? []).map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" ${st.replace(/fill="[^"]*"/, 'fill="none"')}/>`
      case 'line': return `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" ${st}/>`
      case 'arrow': return `<line x1="${s.x}" y1="${s.y}" x2="${s.x + s.w}" y2="${s.y + s.h}" ${st} marker-end="url(#h${s.id})"/><marker id="h${s.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="${s.stroke}"/></marker>`
      case 'rect': return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" ${st}/>`
      case 'roundrect': return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.min(2.5, bw / 4)}" ${st}/>`
      case 'circle': case 'ellipse': return `<ellipse cx="${bx + bw / 2}" cy="${by + bh / 2}" rx="${bw / 2}" ry="${bh / 2}" ${st}/>`
      case 'text': return `<text x="${s.x}" y="${s.y}" font-size="${((s.size ?? 12) * PT).toFixed(3)}" fill="${s.stroke}" dominant-baseline="hanging" font-family="Latin Modern Roman, Times New Roman, serif">${esc(s.text ?? '')}</text>`
      default: return `<polygon points="${polygon(s.kind, bx, by, bw, bh).map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" ${st}/>`
    }
  })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm" viewBox="${x0.toFixed(2)} ${y0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}">\n` +
    `<metadata id="kherveos-drawing">${esc(JSON.stringify({ format: 'kherveos-drawing', version: 1, shapes }))}</metadata>\n` +
    body.join('\n') +
    '\n</svg>\n'
  return { svg, w, h }
}

export function shapesFromSvg(svg: string): Shape[] | null {
  const m = /<metadata id="kherveos-drawing">([\s\S]*?)<\/metadata>/.exec(svg)
  if (!m) return null
  try {
    const txt = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    const d = JSON.parse(txt) as { shapes?: Shape[] }
    return Array.isArray(d.shapes) ? d.shapes : null
  } catch {
    return null
  }
}

/** The drawing as TikZ, for the vector PDF LaTeX includes (y down, in mm, as on the canvas). */
export function drawingTikz(shapes: Shape[]): string {
  const colours = new Map<string, string>()
  const col = (c: string) => {
    const key = c.replace('#', '').toUpperCase()
    if (!colours.has(key)) colours.set(key, `dc${colours.size + 1}`)
    return colours.get(key)!
  }
  const n = (v: number) => (Math.round(v * 100) / 100).toString()
  const lines: string[] = []
  for (const s of shapes) {
    const opts = [`draw=${col(s.stroke)}`, `line width=${n(s.width)}pt`, 'line cap=round', 'line join=round']
    if (s.fill && s.kind !== 'path' && s.kind !== 'line' && s.kind !== 'arrow') opts.push(`fill=${col(s.fill)}`)
    if (s.dash === 'dash') opts.push('dashed')
    else if (s.dash === 'dot') opts.push('dotted')
    else if (s.dash === 'dashdot') opts.push('dash dot')
    const bx = Math.min(s.x, s.x + s.w)
    const by = Math.min(s.y, s.y + s.h)
    const bw = Math.abs(s.w)
    const bh = Math.abs(s.h)
    switch (s.kind) {
      case 'path': if ((s.pts ?? []).length > 1) lines.push(`\\draw[${opts.join(', ')}] ${s.pts!.map(([x, y]) => `(${n(x)},${n(y)})`).join(' -- ')};`); break
      case 'line': lines.push(`\\draw[${opts.join(', ')}] (${n(s.x)},${n(s.y)}) -- (${n(s.x + s.w)},${n(s.y + s.h)});`); break
      case 'arrow': lines.push(`\\draw[${opts.join(', ')}, -{Stealth[length=${n(Math.max(2, s.width * 1.6))}mm]}] (${n(s.x)},${n(s.y)}) -- (${n(s.x + s.w)},${n(s.y + s.h)});`); break
      case 'rect': lines.push(`\\draw[${opts.join(', ')}] (${n(bx)},${n(by)}) rectangle (${n(bx + bw)},${n(by + bh)});`); break
      case 'roundrect': lines.push(`\\draw[${opts.join(', ')}, rounded corners=${n(Math.min(2.5, bw / 4))}mm] (${n(bx)},${n(by)}) rectangle (${n(bx + bw)},${n(by + bh)});`); break
      case 'circle': case 'ellipse': lines.push(`\\draw[${opts.join(', ')}] (${n(bx + bw / 2)},${n(by + bh / 2)}) ellipse [x radius=${n(bw / 2)}, y radius=${n(bh / 2)}];`); break
      case 'text': lines.push(`\\node[anchor=north west, inner sep=0, text=${col(s.stroke)}, font=\\fontsize{${n(s.size ?? 12)}}{${n((s.size ?? 12) * 1.2)}}\\selectfont] at (${n(s.x)},${n(s.y)}) {${escapeText(s.text ?? '')}};`); break
      default: lines.push(`\\draw[${opts.join(', ')}] ${polygon(s.kind, bx, by, bw, bh).map(([x, y]) => `(${n(x)},${n(y)})`).join(' -- ')} -- cycle;`)
    }
  }
  const defs = [...colours].map(([hex, name]) => `\\definecolor{${name}}{HTML}{${hex}}`)
  return [
    '\\documentclass[border=2pt]{standalone}', '\\usepackage{lmodern}', '\\usepackage{tikz}', '\\usetikzlibrary{arrows.meta}',
    '\\begin{document}', ...defs, '\\begin{tikzpicture}[x=1mm, y=-1mm]', ...lines, '\\end{tikzpicture}', '\\end{document}', '',
  ].join('\n')
}

async function svgToPng(svg: string, wMm: number, hMm: number, dpi = 200): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round((wMm / 25.4) * dpi))
    c.height = Math.max(1, Math.round((hMm / 25.4) * dpi))
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
    return new Uint8Array(await blob!.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function DrawingDialog({ initialSvg, done }: { initialSvg: string | null; done: Done<DrawingResult> }) {
  const [shapes, setShapes] = useState<Shape[]>(() => (initialSvg ? shapesFromSvg(initialSvg) ?? [] : []))
  const [hist, setHist] = useState<{ list: Shape[][]; i: number }>(() => ({ list: [shapes], i: 0 }))
  const [tool, setTool] = useState<Tool>('pointer')
  const [stroke, setStroke] = useState('#000000')
  const [fill, setFill] = useState('')
  const [width, setWidth] = useState(1.5)
  const [dash, setDash] = useState<Shape['dash']>('solid')
  const [fontPt, setFontPt] = useState(12)
  const [sel, setSel] = useState<number | null>(null)
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const svg = useRef<SVGSVGElement>(null)
  const act = useRef<{ kind: 'draw' | 'move'; id: number; x0: number; y0: number; orig?: Shape } | null>(null)
  const nextId = useRef(Math.max(0, ...shapes.map((s) => s.id)) + 1)

  const commit = (next: Shape[]) => {
    setShapes(next)
    setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), next], i: h.i + 1 }))
  }
  const undo = (d: number) => {
    const i = hist.i + d
    if (i < 0 || i >= hist.list.length) return
    setHist({ ...hist, i })
    setShapes(hist.list[i])
    setSel(null)
  }
  const selected = shapes.find((s) => s.id === sel) ?? null
  const update = (patch: Partial<Shape>) => selected && commit(shapes.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))

  const at = (e: { clientX: number; clientY: number }, snapIt = snap): [number, number] => {
    const el = svg.current!
    const p = el.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const q = p.matrixTransform(el.getScreenCTM()!.inverse())
    const g = (v: number) => (snapIt ? Math.round(v) : Math.round(v * 10) / 10)
    return [g(q.x), g(q.y)]
  }

  const downOnCanvas = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const [x, y] = at(e, tool !== 'pencil' && snap)
    if (tool === 'pointer') {
      setSel(null)
      return
    }
    if (tool === 'text') {
      void os.dialog.prompt('Text:', { title: 'Text' }).then((t) => {
        if (!t?.trim()) return
        const s: Shape = { id: nextId.current++, kind: 'text', x, y, w: 0, h: 0, stroke, fill: '', width: 1, dash: 'solid', text: t.trim(), size: fontPt }
        commit([...shapes, s])
        setSel(s.id)
      })
      return
    }
    if (['eraser', 'bucket', 'picker'].includes(tool)) return
    const s: Shape = {
      id: nextId.current++, kind: tool as Kind, x, y, w: 0, h: 0, stroke, fill: tool === 'line' || tool === 'arrow' || tool === 'pencil' ? '' : fill, width, dash,
      ...(tool === 'pencil' ? { kind: 'path' as Kind, pts: [[x, y]] as [number, number][] } : {}),
    }
    setShapes([...shapes, s])
    act.current = { kind: 'draw', id: s.id, x0: x, y0: y }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const downOnShape = (e: React.PointerEvent, s: Shape) => {
    if (tool === 'pointer') {
      e.stopPropagation()
      setSel(s.id)
      const [x, y] = at(e)
      act.current = { kind: 'move', id: s.id, x0: x, y0: y, orig: s }
      svg.current?.setPointerCapture(e.pointerId)
    } else if (tool === 'eraser') {
      e.stopPropagation()
      commit(shapes.filter((x) => x.id !== s.id))
    } else if (tool === 'bucket') {
      e.stopPropagation()
      commit(shapes.map((x) => (x.id === s.id ? (x.kind === 'text' ? { ...x, stroke } : { ...x, fill: fill || stroke }) : x)))
    } else if (tool === 'picker') {
      e.stopPropagation()
      if (e.shiftKey) setFill(s.fill)
      else setStroke(s.stroke)
    }
  }

  const move = (e: React.PointerEvent) => {
    const a = act.current
    if (!a) return
    const [x, y] = at(e, a.kind === 'move' ? snap : tool !== 'pencil' && snap)
    setShapes((list) =>
      list.map((s) => {
        if (s.id !== a.id) return s
        if (a.kind === 'move' && a.orig) {
          const dx = x - a.x0
          const dy = y - a.y0
          return { ...a.orig, x: a.orig.x + dx, y: a.orig.y + dy, pts: a.orig.pts?.map(([px, py]) => [px + dx, py + dy] as [number, number]) }
        }
        if (s.kind === 'path') return { ...s, pts: [...(s.pts ?? []), [x, y] as [number, number]] }
        let w = x - a.x0
        let h = y - a.y0
        if (s.kind === 'circle' || (e.shiftKey && s.kind !== 'line' && s.kind !== 'arrow')) {
          const m = Math.max(Math.abs(w), Math.abs(h))
          w = Math.sign(w || 1) * m
          h = Math.sign(h || 1) * m
        }
        return { ...s, w, h }
      }),
    )
  }

  const up = () => {
    const a = act.current
    act.current = null
    if (!a) return
    const s = shapes.find((x) => x.id === a.id)
    if (!s) return
    const tiny = s.kind === 'path' ? (s.pts ?? []).length < 2 : Math.abs(s.w) < 0.5 && Math.abs(s.h) < 0.5
    if (a.kind === 'draw' && tiny) {
      setShapes(shapes.filter((x) => x.id !== a.id))
      return
    }
    commit(shapes)
    if (a.kind === 'draw') setSel(s.id)
  }

  const order = (front: boolean) => {
    if (!selected) return
    const rest = shapes.filter((s) => s.id !== selected.id)
    commit(front ? [...rest, selected] : [selected, ...rest])
  }

  const insert = async () => {
    if (!shapes.length) return
    setBusy(true)
    setStatus('Compiling the vector picture…')
    const { svg: svgText, w, h } = drawingSvg(shapes)
    let pdf: Uint8Array | null = null
    try {
      const pic = await compileStandalone(drawingTikz(shapes), 72)
      URL.revokeObjectURL(pic.url)
      pdf = pic.pdf
    } catch {
      pdf = null // LaTeX then includes the PNG preview
    }
    try {
      const png = await svgToPng(svgText, w, h)
      done({ svg: svgText, pdf, png, widthMm: w })
    } catch (e) {
      setStatus(`The drawing could not be saved: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo(e.shiftKey ? 1 : -1)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        commit(shapes.filter((s) => s.id !== selected.id))
        setSel(null)
      } else if (!e.metaKey && !e.ctrlKey && KEYS[e.key.toLowerCase()]) setTool(KEYS[e.key.toLowerCase()])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const [pw, ph] = PAGE
  const view = useMemo(() => {
    const [x0, y0, x1, y1] = bounds(shapes)
    return [Math.min(0, x0), Math.min(0, y0), Math.max(pw, x1), Math.max(ph, y1)]
  }, [shapes, pw, ph])

  const swatches = (value: string, set: (c: string) => void, allowNone: boolean) => (
    <span className="ktx-swatches">
      {allowNone && <button className={`ktx-swatch none${value === '' ? ' on' : ''}`} title="No fill" onClick={() => set('')} />}
      {PALETTE.map((c) => <button key={c} className={`ktx-swatch${value.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => set(c)} />)}
      <input type="color" value={value || '#ffffff'} onChange={(e) => set(e.target.value)} title="Other colour" />
    </span>
  )

  return (
    <div className="ktx-modal" onPointerDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="k-dialog ktx-dialog ktx-drawing" role="dialog" aria-label="Drawing" onKeyDown={(e) => e.key === 'Escape' && done(null)}>
        <div className="k-dialog-title">Drawing</div>
        <div className="k-dialog-body">
          <div className="ktx-row center ktx-draw-options">
            <span>Stroke</span>
            {swatches(stroke, (c) => {
              setStroke(c)
              if (selected) update(selected.kind === 'text' ? { stroke: c } : { stroke: c })
            }, false)}
            <span>Fill</span>
            {swatches(fill, (c) => {
              setFill(c)
              if (selected && selected.kind !== 'text') update({ fill: c })
            }, true)}
            <span>Width</span>
            <select className="ktx-combo" value={width} onChange={(e) => {
              const v = Number(e.target.value)
              setWidth(v)
              if (selected) update({ width: v })
            }}>
              {LINE_WIDTHS.map((w) => <option key={w} value={w}>{w} pt</option>)}
            </select>
            <select className="ktx-combo" value={dash} onChange={(e) => {
              const v = e.target.value as Shape['dash']
              setDash(v)
              if (selected) update({ dash: v })
            }}>
              {DASHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span>Text</span>
            <input className="ktx-combo" type="number" style={{ width: 58 }} min={5} max={72} value={fontPt} onChange={(e) => {
              const v = Math.max(5, Math.min(72, Number(e.target.value) || 12))
              setFontPt(v)
              if (selected?.kind === 'text') update({ size: v })
            }} />
            <span style={{ flex: 1 }} />
            <button className="ktx-pbtn" title="Undo (⌘Z)" disabled={hist.i === 0} onClick={() => undo(-1)}>↶</button>
            <button className="ktx-pbtn" title="Redo (⇧⌘Z)" disabled={hist.i >= hist.list.length - 1} onClick={() => undo(1)}>↷</button>
          </div>
          <div className="ktx-draw-main">
            <div className="ktx-draw-tools">
              {TOOLS.map(([t, icon, tip]) => (
                <button key={t} className={`ktx-tb-btn${tool === t ? ' on' : ''}`} title={tip} onClick={() => setTool(t)}>
                  <img src={iconUrl(`paint-${icon}`)} alt="" />
                </button>
              ))}
              <span className="ktx-tb-sep" />
              <button className={`ktx-tb-btn${grid ? ' on' : ''}`} title="Show the grid" onClick={() => setGrid((v) => !v)}><img src={iconUrl('paint-grid')} alt="" /></button>
              <button className={`ktx-tb-btn${snap ? ' on' : ''}`} title="Snap to the grid (1 mm)" onClick={() => setSnap((v) => !v)}><img src={iconUrl('paint-snap')} alt="" /></button>
              <button className="ktx-tb-btn" title="Zoom to drawing" onClick={() => setZoom(1)}><img src={iconUrl('paint-fit')} alt="" /></button>
            </div>
            <div className="ktx-draw-canvas">
              <svg
                ref={svg}
                width={(view[2] - view[0]) * PX * zoom}
                height={(view[3] - view[1]) * PX * zoom}
                viewBox={`${view[0]} ${view[1]} ${view[2] - view[0]} ${view[3] - view[1]}`}
                onPointerDown={downOnCanvas}
                onPointerMove={move}
                onPointerUp={up}
                onWheel={(e) => {
                  if (!e.ctrlKey && !e.metaKey) return
                  setZoom((z) => Math.max(0.4, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))))
                }}
                style={{ cursor: tool === 'pointer' ? 'default' : 'crosshair' }}
              >
                {arrowDefs(shapes)}
                <defs>
                  <pattern id="ktx-dr-grid" width="5" height="5" patternUnits="userSpaceOnUse">
                    <path d="M5,0H0V5" fill="none" stroke="#e3e6ea" strokeWidth="0.15" />
                  </pattern>
                </defs>
                <rect x={view[0]} y={view[1]} width={view[2] - view[0]} height={view[3] - view[1]} fill="#fff" />
                {grid && <rect x={view[0]} y={view[1]} width={view[2] - view[0]} height={view[3] - view[1]} fill="url(#ktx-dr-grid)" />}
                {shapes.map((s) => <ShapeSvg key={s.id} s={s} sel={s.id === sel} onDown={(e) => downOnShape(e, s)} />)}
              </svg>
            </div>
            <div className="ktx-draw-props">
              {selected ? (
                <div className="ktx-form">
                  <b style={{ gridColumn: '1 / -1' }}>{selected.kind === 'path' ? 'Path' : selected.kind[0].toUpperCase() + selected.kind.slice(1)}</b>
                  <label>X (mm)</label>
                  <input className="k-input" type="number" value={Math.round(selected.x * 10) / 10} onChange={(e) => update({ x: Number(e.target.value) })} />
                  <label>Y (mm)</label>
                  <input className="k-input" type="number" value={Math.round(selected.y * 10) / 10} onChange={(e) => update({ y: Number(e.target.value) })} />
                  {selected.kind !== 'text' && selected.kind !== 'path' && (
                    <>
                      <label>Width (mm)</label>
                      <input className="k-input" type="number" value={Math.round(selected.w * 10) / 10} onChange={(e) => update({ w: Number(e.target.value) })} />
                      <label>Height (mm)</label>
                      <input className="k-input" type="number" value={Math.round(selected.h * 10) / 10} onChange={(e) => update({ h: Number(e.target.value) })} />
                    </>
                  )}
                  {selected.kind === 'text' && (
                    <>
                      <label>Text</label>
                      <input className="k-input" value={selected.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
                    </>
                  )}
                  <span />
                  <span className="ktx-row">
                    <button className="ktx-tb-btn" title="Bring to front" onClick={() => order(true)}><img src={iconUrl('paint-front')} alt="" /></button>
                    <button className="ktx-tb-btn" title="Send to back" onClick={() => order(false)}><img src={iconUrl('paint-back')} alt="" /></button>
                    <button className="ktx-tb-btn" title="Duplicate" onClick={() => {
                      const copy = { ...selected, id: nextId.current++, x: selected.x + 4, y: selected.y + 4, pts: selected.pts?.map(([x, y]) => [x + 4, y + 4] as [number, number]) }
                      commit([...shapes, copy])
                      setSel(copy.id)
                    }}><img src={iconUrl('paint-duplicate')} alt="" /></button>
                    <button className="ktx-tb-btn" title="Delete" onClick={() => {
                      commit(shapes.filter((s) => s.id !== selected.id))
                      setSel(null)
                    }}><img src={iconUrl('paint-delete')} alt="" /></button>
                  </span>
                </div>
              ) : (
                <div className="ktx-dim">Pick a tool on the left and draw on the page. Select a shape to change it here.</div>
              )}
            </div>
          </div>
          <div className="k-dialog-buttons">
            <span className="ktx-dim" style={{ flex: 1 }}>{status || 'The drawing is cropped to its content; LaTeX includes it as a vector PDF.'}</span>
            <button className="k-btn" onClick={() => done(null)}>Cancel</button>
            <button className="k-btn primary" disabled={busy || !shapes.length} onClick={() => void insert()}>{busy ? 'Saving…' : 'OK'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
