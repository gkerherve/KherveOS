// Shape specs: the dict format the desktop's symbol palettes, examples and AI
// assistant produce ({"shape": "rect", "x": …}). `specToItem` is the port of
// ai_assistant._spec_to_item and `placeSymbol` of PaintScene._place_symbol.
// The small numeric helpers below keep the ported palettes' Python semantics.

import type { Brush, GroupItem, Item, Pen, Pt } from './model'
import { base, DEFAULT_FONT, NO_PEN_COLOR, toArgb } from './model'
import { POLYGON_KINDS, polygonForKind, rectOf } from './geom'
import { gradientFromSpec } from './kpaint'
import { layoutText } from './text'

export interface Spec {
  shape: string
  x?: number
  y?: number
  w?: number
  h?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  stroke?: string | null
  fill?: string | Record<string, unknown> | null
  width?: number
  radius?: number
  rotation?: number
  opacity?: number
  text?: string
  size?: number
  color?: string
  anchor?: string
  label?: string
  points?: number[][]
  [key: string]: unknown
}

// ------------------------------------------------- Python-like helpers

/** Python's a % b (the sign of b). */
export const pmod = (a: number, b: number) => a - b * Math.floor(a / b)
export const rad = (d: number) => d * (Math.PI / 180)
export const deg = (r: number) => r * (180 / Math.PI)
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export function range(a: number, b?: number, step = 1): number[] {
  const [start, stop] = b === undefined ? [0, a] : [a, b]
  const out: number[] = []
  if (step > 0) for (let i = start; i < stop; i += step) out.push(i)
  else for (let i = start; i > stop; i += step) out.push(i)
  return out
}

export function zip<A = any, B = any>(a: A[], b: B[]): [A, B][] {
  const n = Math.min(a.length, b.length)
  const out: [A, B][] = []
  for (let i = 0; i < n; i++) out.push([a[i], b[i]])
  return out
}

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number, digits?: number): number {
  const f = digits ? 10 ** digits : 1
  const y = x * f
  const r = Math.round(y)
  const out = Math.abs(y % 1) === 0.5 ? 2 * Math.round(y / 2) : r
  return digits ? out / f : out
}

// ------------------------------------------------------- spec → item

const ALIASES: Record<string, string> = {
  rectangle: 'rect', rounded_rectangle: 'rounded_rect', block_arrow: 'arrow_right', half_circle: 'halfcircle', quarter_circle: 'quartercircle',
}

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && isFinite(+v) && v.trim() ? +v : d)

function specPen(s: Spec): Pen {
  const stroke = s.stroke ?? '#1a1a1a'
  if (!stroke || String(stroke).toLowerCase() === 'none') return { color: NO_PEN_COLOR, width: 0 }
  return { color: toArgb(String(stroke), '#ff000000'), width: num(s.width, 2) }
}

function specBrush(s: Spec): Brush {
  const fill = s.fill
  const grad = (s.gradient ?? (fill && typeof fill === 'object' ? fill : null)) as Record<string, unknown> | null
  if (grad && typeof grad === 'object') return { gradient: gradientFromSpec(grad) }
  if (!fill || String(fill).toLowerCase() === 'none') return null
  return { color: toArgb(String(fill), '#ff000000') }
}

/** One spec as an item, or null for shapes this port does not draw (molecules, solids…). */
export function specToItem(spec: Spec): Item | null {
  let shape = String(spec.shape ?? '').toLowerCase().replace(/-/g, '_')
  shape = ALIASES[shape] ?? shape
  const x = num(spec.x, 0)
  const y = num(spec.y, 0)
  const w = num(spec.w ?? spec.width_px, 80)
  const h = num(spec.h ?? spec.height_px, 60)
  let it: Item
  if (shape === 'line' || shape === 'arrow') {
    it = {
      ...base(), type: shape, pen: specPen(spec),
      x1: num(spec.x1, x), y1: num(spec.y1, y), x2: num(spec.x2, x + w), y2: num(spec.y2, y),
    }
  } else if (shape === 'text') {
    const t: Item = {
      ...base(), type: 'text', text: String(spec.text ?? 'Text'), color: toArgb(String(spec.color ?? spec.stroke ?? '#1a1a1a'), '#ff1a1a1a'),
      family: DEFAULT_FONT, size: Math.trunc(num(spec.size, 14)), bold: false, italic: false,
    }
    if (String(spec.anchor ?? '').toLowerCase() === 'center') {
      // (x, y) is the text's centre rather than its top-left corner.
      const l = layoutText(t.text, { family: t.family, size: t.size })
      t.pos = { x: x - l.boxW / 2, y: y - l.boxH / 2 }
    } else t.pos = { x, y }
    if (spec.rotation) t.rotation = num(spec.rotation, 0)
    return t
  } else if (shape === 'rect' || shape === 'circle' || shape === 'ellipse') {
    it = { ...base(), type: shape === 'rect' ? 'rect' : 'ellipse', pen: specPen(spec), brush: specBrush(spec), x, y, w, h }
  } else if (shape === 'rounded_rect') {
    it = { ...base(), type: 'roundrect', pen: specPen(spec), brush: specBrush(spec), radius: num(spec.radius, 12), x, y, w, h }
  } else if (shape === 'halfcircle' || shape === 'quartercircle') {
    it = { ...base(), type: 'arc', kind: shape, pen: specPen(spec), brush: specBrush(spec), x, y, w, h, flipH: false, flipV: false }
  } else if (shape === 'polygon' && Array.isArray(spec.points) && spec.points.length) {
    it = {
      ...base(), type: 'polygon', kind: 'polygon', pen: specPen(spec), brush: specBrush(spec),
      points: spec.points.map((p) => [num(p[0], 0), num(p[1], 0)] as [number, number]),
    }
  } else if (POLYGON_KINDS.includes(shape)) {
    it = { ...base(), type: 'polygon', kind: shape, pen: specPen(spec), brush: specBrush(spec), points: polygonForKind(shape, rectOf(x, y, w, h)) }
  } else return null
  if (spec.label && (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc' || it.type === 'polygon')) {
    it.label = String(spec.label)
  }
  if (spec.rotation) it.rotation = num(spec.rotation, 0)
  if (spec.opacity != null) it.opacity = Math.max(0, Math.min(1, num(spec.opacity, 1)))
  return it
}

export function specsToItems(specs: Spec[]): Item[] {
  const out: Item[] = []
  for (const s of specs) {
    try {
      const it = specToItem(s)
      if (it) out.push(it)
    } catch {
      // A bad spec is skipped, as in apply_specs.
    }
  }
  return out
}

// ------------------------------------------------------------ palettes

/** A symbol palette module (floorplan, electrical, flowchart…): the same interface on both sides. */
export interface Palette {
  id: string
  title: string
  /** The page width represents this many millimetres of real space. */
  reference: number
  sizes: Record<string, [number, number]>
  labels: Record<string, string>
  categories: [string, string[]][]
  builders: Record<string, (w: number, h: number) => Spec[]>
}

/**
 * Build a palette symbol centred on `center`, grouped when it has several
 * parts (PaintScene._place_symbol). Symbols are sized as a fraction of the
 * page: its width stands for `reference` mm, so a whole room or circuit fits.
 */
export function buildSymbol(p: Palette, name: string, center: Pt, pageWidth: number): Item | null {
  const size = p.sizes[name]
  const build = p.builders[name]
  if (!size || !build) return null
  const scale = (pageWidth || 1) / (p.reference || 4800)
  const w = size[0] * scale
  const h = size[1] * scale
  const items = specsToItems(build(w, h))
  if (!items.length) return null
  const dx = center.x - w / 2
  const dy = center.y - h / 2
  const moved = items.map((it) => ({ ...it, pos: { x: it.pos.x + dx, y: it.pos.y + dy } }))
  let top: Item
  if (moved.length === 1) top = moved[0]
  else {
    const g: GroupItem = { ...base(), type: 'group', children: moved.map((c, i) => ({ ...c, z: i })) }
    top = g
  }
  top.symbol = `${p.id}:${name}`
  return top
}
