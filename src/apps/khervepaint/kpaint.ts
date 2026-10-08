// .kpaint: the desktop's JSON document (document.py). Items are read and
// written exactly as item_to_dict / item_from_dict do, key order included;
// keys we do not understand (3D models, solids, reactions) ride along.

import type { Brush, DashStyle, Doc, Gradient, Item, Label, Mat, PathCmd, Pen, Raster } from './model'
import { DEFAULT_FILL_COLOR, DEFAULT_FONT, DEFAULT_PEN_COLOR, FORMAT_VERSION, hasLabel, newId, newRasterKey, toArgb } from './model'
import { mul, rotateM, scaleM, translateM } from './geom'
import { pngSize } from './png'

type Dict = Record<string, unknown>

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(+v) ? +v : d)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v))
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : v == null ? d : !!v)
const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v)

const DASHES: DashStyle[] = ['solid', 'dash', 'dot', 'dashdot']

export function penFromDict(d: unknown): Pen {
  const p = isDict(d) ? d : {}
  const pen: Pen = { color: toArgb(str(p.color, DEFAULT_PEN_COLOR), DEFAULT_PEN_COLOR), width: num(p.width, 2) }
  if (typeof p.dash === 'string' && DASHES.includes(p.dash as DashStyle) && p.dash !== 'solid') pen.dash = p.dash as DashStyle
  return pen
}

export function penToDict(pen: Pen): Dict {
  const d: Dict = { color: pen.color, width: pen.width }
  if (pen.dash && pen.dash !== 'solid') d.dash = pen.dash
  return d
}

export function gradientFromSpec(s: Dict): Gradient {
  const kind = s.kind === 'radial' || s.kind === 'sun' ? s.kind : 'linear'
  return {
    kind,
    c1: toArgb(str(s.c1, DEFAULT_FILL_COLOR), DEFAULT_FILL_COLOR),
    c2: toArgb(str(s.c2, '#ffffffff'), '#ffffffff'),
    angle: num(s.angle, 90),
  }
}

/** The spec the desktop writes back for a gradient brush (gradient.brush_spec). */
export function gradientToSpec(g: Gradient): Dict {
  let angle = 90
  if (g.kind === 'linear') {
    // brush_spec re-derives the angle from the gradient's end points.
    const rad = (g.angle * Math.PI) / 180
    const dx = Math.cos(rad) / 2
    const dy = Math.sin(rad) / 2
    angle = dx || dy ? (((Math.round(((Math.atan2(2 * dy, 2 * dx) * 180) / Math.PI) * 100) / 100) % 360) + 360) % 360 : 90
  }
  return { c1: g.c1, c2: g.c2, angle, kind: g.kind }
}

export function brushFromDict(d: unknown): Brush {
  if (!isDict(d)) return null
  if (isDict(d.gradient)) return { gradient: gradientFromSpec(d.gradient) }
  return { color: toArgb(str(d.color, DEFAULT_FILL_COLOR), DEFAULT_FILL_COLOR) }
}

export function brushToDict(b: Brush): Dict | null {
  if (!b) return null
  if ('gradient' in b) return { gradient: gradientToSpec(b.gradient) }
  return { color: b.color }
}

function labelFromDict(d: Dict): Label {
  if (!d.label) return {}
  return {
    label: str(d.label),
    labelColor: toArgb(str(d.labelColor, '#ff1a1a1a'), '#ff1a1a1a'),
    labelFamily: str(d.labelFamily, DEFAULT_FONT),
    labelSize: Math.round(num(d.labelSize, 14)),
    labelBold: bool(d.labelBold),
    labelItalic: bool(d.labelItalic),
  }
}

function labelToDict(it: Item): Dict {
  if (!hasLabel(it) || !it.label) return {}
  return {
    label: it.label,
    labelColor: it.labelColor ?? '#ff1a1a1a',
    labelFamily: it.labelFamily ?? DEFAULT_FONT,
    labelSize: Math.round(it.labelSize ?? 14),
    labelBold: !!it.labelBold,
    labelItalic: !!it.labelItalic,
  }
}

function matFromList(v: unknown): Mat | null {
  if (!Array.isArray(v) || v.length < 6) return null
  const m = v.slice(0, 6).map((x) => num(x, NaN))
  return m.every((x) => isFinite(x)) ? (m as Mat) : null
}

function cmdsFromList(v: unknown): PathCmd[] {
  const out: PathCmd[] = []
  if (!Array.isArray(v)) return out
  for (const c of v) {
    if (!Array.isArray(c)) continue
    const n = c.slice(1).map((x) => num(x))
    if (c[0] === 'M' && n.length >= 2) out.push(['M', n[0], n[1]])
    else if (c[0] === 'L' && n.length >= 2) out.push(['L', n[0], n[1]])
    else if (c[0] === 'C' && n.length >= 6) out.push(['C', n[0], n[1], n[2], n[3], n[4], n[5]])
  }
  return out
}

// Keys each type reads; anything else on a dict is kept in `extra`.
const COMMON_KEYS = ['type', 'pos', 'opacity', 'rotation', 'z', 'scale', 'symbol']
const LABEL_KEYS = ['label', 'labelColor', 'labelFamily', 'labelSize', 'labelBold', 'labelItalic']
const TYPE_KEYS: Record<string, string[]> = {
  line: ['pen', 'x1', 'y1', 'x2', 'y2', 'bend', 'head1'],
  arrow: ['pen', 'x1', 'y1', 'x2', 'y2', 'bend', 'head1'],
  dimension: ['pen', 'x1', 'y1', 'x2', 'y2', 'capStyle', 'extension', 'dash', 'unit', 'decimals', 'prefix', 'suffix'],
  rect: ['pen', 'brush', 'x', 'y', 'w', 'h', ...LABEL_KEYS],
  ellipse: ['pen', 'brush', 'x', 'y', 'w', 'h', ...LABEL_KEYS],
  roundrect: ['pen', 'brush', 'radius', 'x', 'y', 'w', 'h', ...LABEL_KEYS],
  arc: ['kind', 'pen', 'brush', 'x', 'y', 'w', 'h', 'flipH', 'flipV', ...LABEL_KEYS],
  polygon: ['pen', 'brush', 'kind', 'points', ...LABEL_KEYS],
  path: ['pen', 'brush', 'cmds'],
  image: ['image', 'matrix'],
  text: ['text', 'color', 'family', 'size', 'bold', 'italic'],
  group: ['children', 'matrix'],
}

function extrasOf(d: Dict, type: string): Record<string, unknown> | undefined {
  const known = new Set([...COMMON_KEYS, ...(TYPE_KEYS[type] ?? [])])
  const extra: Record<string, unknown> = {}
  let any = false
  for (const k of Object.keys(d)) {
    if (!known.has(k)) {
      extra[k] = d[k]
      any = true
    }
  }
  return any ? extra : undefined
}

/** A desktop item dict as an item (null for unknown types). */
export function itemFromDict(d: unknown): Item | null {
  if (!isDict(d)) return null
  const type = str(d.type)
  const pos = isDict(d.pos) ? { x: num(d.pos.x), y: num(d.pos.y) } : { x: 0, y: 0 }
  const common = {
    _id: newId(),
    pos,
    opacity: num(d.opacity, 1),
    rotation: num(d.rotation),
    z: num(d.z),
    scale: num(d.scale, 1),
    ...(d.symbol ? { symbol: str(d.symbol) } : {}),
    ...(extrasOf(d, type) ? { extra: extrasOf(d, type) } : {}),
  }
  let it: Item
  switch (type) {
    case 'line':
    case 'arrow': {
      it = { ...common, type, pen: penFromDict(d.pen), x1: num(d.x1), y1: num(d.y1), x2: num(d.x2), y2: num(d.y2) }
      if (Array.isArray(d.bend) && d.bend.length >= 2) it.bend = [num(d.bend[0]), num(d.bend[1])]
      if (type === 'arrow' && d.head1) it.head1 = true
      break
    }
    case 'dimension': {
      const cap = str(d.capStyle, 'arrows')
      const unit = str(d.unit, 'mm')
      it = {
        ...common,
        type,
        pen: penFromDict(d.pen),
        x1: num(d.x1),
        y1: num(d.y1),
        x2: num(d.x2),
        y2: num(d.y2),
        capStyle: (['arrows', 'ticks', 'dots', 'none'].includes(cap) ? cap : 'arrows') as 'arrows',
        extension: bool(d.extension),
        dash: bool(d.dash),
        unit: (['mm', 'cm', 'in'].includes(unit) ? unit : 'mm') as 'mm',
        decimals: Math.max(0, Math.round(num(d.decimals, 1))),
        prefix: str(d.prefix),
        suffix: str(d.suffix),
      }
      break
    }
    case 'rect':
    case 'ellipse':
      it = { ...common, type, pen: penFromDict(d.pen), brush: brushFromDict(d.brush), x: num(d.x), y: num(d.y), w: num(d.w), h: num(d.h), ...labelFromDict(d) }
      break
    case 'roundrect':
      it = {
        ...common, type, pen: penFromDict(d.pen), brush: brushFromDict(d.brush), radius: num(d.radius, 12),
        x: num(d.x), y: num(d.y), w: num(d.w), h: num(d.h), ...labelFromDict(d),
      }
      break
    case 'arc':
      it = {
        ...common, type, kind: d.kind === 'quartercircle' ? 'quartercircle' : 'halfcircle', pen: penFromDict(d.pen),
        brush: brushFromDict(d.brush), x: num(d.x), y: num(d.y), w: num(d.w), h: num(d.h),
        flipH: bool(d.flipH), flipV: bool(d.flipV), ...labelFromDict(d),
      }
      break
    case 'polygon': {
      const pts = Array.isArray(d.points) ? d.points.filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2) : []
      it = {
        ...common, type, pen: penFromDict(d.pen), brush: brushFromDict(d.brush), kind: str(d.kind, 'polygon'),
        points: pts.map((p) => [num(p[0]), num(p[1])] as [number, number]), ...labelFromDict(d),
      }
      break
    }
    case 'path':
      it = { ...common, type, pen: penFromDict(d.pen), brush: brushFromDict(d.brush), cmds: cmdsFromList(d.cmds) }
      break
    case 'text':
      it = {
        ...common, type, text: str(d.text), color: toArgb(str(d.color, '#ff1a1a1a'), '#ff1a1a1a'),
        family: str(d.family, DEFAULT_FONT), size: Math.round(num(d.size, 14)) || 14, bold: bool(d.bold), italic: bool(d.italic),
      }
      break
    case 'image': {
      const image = str(d.image)
      const size = pngSize(image) ?? { w: 1, h: 1 }
      let matrix = matFromList(d.matrix)
      if (!matrix) {
        // No matrix: pos, then rotation and scale about the picture's centre.
        const o = { x: size.w / 2, y: size.h / 2 }
        matrix = mul(translateM(pos.x + o.x, pos.y + o.y), mul(rotateM(common.rotation), mul(scaleM(common.scale), translateM(-o.x, -o.y))))
      }
      it = { ...common, type, image, iw: size.w, ih: size.h, matrix, pos: { x: matrix[4], y: matrix[5] }, rotation: 0, scale: 1 }
      break
    }
    case 'group': {
      const kids = Array.isArray(d.children) ? d.children.map(itemFromDict).filter((c): c is Item => !!c) : []
      it = { ...common, type, children: sortByZ(kids) }
      const m = matFromList(d.matrix)
      if (m) it.matrix = m
      break
    }
    default:
      return null
  }
  return it
}

/** Paint order: stable sort by z, as QGraphicsScene stacks items. */
export function sortByZ(items: Item[]): Item[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.z - b.it.z || a.i - b.i)
    .map((e) => e.it)
}

function commonDict(it: Item, z: number): Dict {
  const d: Dict = { pos: { x: it.pos.x, y: it.pos.y }, opacity: it.opacity, rotation: it.rotation, z, scale: it.scale }
  if (it.symbol) d.symbol = it.symbol
  return d
}

/** An item as the desktop's dict; `z` is its stacking index. */
export function itemToDict(it: Item, z = it.z): Dict {
  const common = commonDict(it, z)
  let d: Dict
  switch (it.type) {
    case 'dimension':
      d = {
        type: 'dimension', pen: penToDict(it.pen), x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2,
        capStyle: it.capStyle, extension: it.extension, dash: it.dash, unit: it.unit, decimals: Math.round(it.decimals),
        prefix: it.prefix, suffix: it.suffix, ...common,
      }
      break
    case 'line':
    case 'arrow':
      d = { type: it.type, pen: penToDict(it.pen), x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...common }
      if (it.bend) d.bend = [it.bend[0], it.bend[1]]
      if (it.type === 'arrow' && it.head1) d.head1 = true
      break
    case 'roundrect':
      d = { type: 'roundrect', pen: penToDict(it.pen), brush: brushToDict(it.brush), radius: it.radius, x: it.x, y: it.y, w: it.w, h: it.h, ...labelToDict(it), ...common }
      break
    case 'arc':
      d = {
        type: 'arc', kind: it.kind, pen: penToDict(it.pen), brush: brushToDict(it.brush), x: it.x, y: it.y, w: it.w, h: it.h,
        flipH: it.flipH, flipV: it.flipV, ...labelToDict(it), ...common,
      }
      break
    case 'polygon':
      d = { type: 'polygon', pen: penToDict(it.pen), brush: brushToDict(it.brush), kind: it.kind, points: it.points.map((p) => [p[0], p[1]]), ...labelToDict(it), ...common }
      break
    case 'path':
      d = { type: 'path', pen: penToDict(it.pen), brush: brushToDict(it.brush), cmds: it.cmds.map((c) => [...c]), ...common }
      break
    case 'image':
      d = { type: 'image', image: it.image, matrix: [...it.matrix], ...common, pos: { x: it.matrix[4], y: it.matrix[5] }, rotation: 0, scale: 1 }
      break
    case 'rect':
    case 'ellipse':
      d = { type: it.type, pen: penToDict(it.pen), brush: brushToDict(it.brush), x: it.x, y: it.y, w: it.w, h: it.h, ...labelToDict(it), ...common }
      break
    case 'text':
      d = { type: 'text', text: it.text, color: it.color, family: it.family, size: Math.round(it.size), bold: it.bold, italic: it.italic, ...common }
      break
    case 'group':
      d = { type: 'group', children: it.children.map((c, i) => itemToDict(c, i)), ...common }
      if (it.matrix) d.matrix = [...it.matrix]
      break
  }
  if (it.extra) for (const [k, v] of Object.entries(it.extra)) if (!(k in d)) d[k] = v
  return d
}

// ------------------------------------------------------------- documents

/** Parse .kpaint text. Throws on files that are not KhervePaint documents. */
export function parseKpaint(text: string): Doc {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isDict(data) || data.format !== 'kpaint') throw new Error('Not a kPaint document.')
  let width = Math.max(1, Math.round(num(data.width, 800)))
  let height = Math.max(1, Math.round(num(data.height, 600)))
  const dpi = num(data.dpi, 96) || 96
  const grid = isDict(data.grid) ? data.grid : {}
  let mm = 1
  if ('mm' in grid) mm = num(grid.mm, 1)
  else if ('divisions' in grid) mm = ((width || 1) / Math.max(num(grid.divisions, 1), 1) / dpi) * 25.4
  else if ('size' in grid) mm = (num(grid.size, 10) / dpi) * 25.4
  let raster: Raster = { w: width, h: height, src: null, key: newRasterKey() }
  if (typeof data.raster === 'string' && data.raster) {
    // The raster layer sets the canvas size (set_raster_pixmap).
    const size = pngSize(data.raster)
    if (size) {
      width = size.w
      height = size.h
      raster = { w: width, h: height, src: data.raster, key: newRasterKey() }
    }
  }
  const items = Array.isArray(data.items) ? data.items.map(itemFromDict).filter((i): i is Item => !!i) : []
  return {
    width,
    height,
    dpi,
    grid: { mm: mm > 0 ? mm : 1, show: bool(grid.show, true), snap: bool(grid.snap, true), infinite: bool(grid.infinite, false) },
    raster,
    items: sortByZ(items),
  }
}

/** The document as .kpaint JSON; `rasterB64` is the raster layer as a base64 PNG. */
export function serializeKpaint(doc: Doc, rasterB64: string): string {
  const data = {
    format: 'kpaint',
    version: FORMAT_VERSION,
    width: Math.round(doc.width),
    height: Math.round(doc.height),
    dpi: Number.isInteger(doc.dpi) ? doc.dpi : Math.round(doc.dpi),
    grid: { mm: doc.grid.mm, show: doc.grid.show, snap: doc.grid.snap, infinite: doc.grid.infinite },
    raster: rasterB64,
    items: doc.items.map((it, i) => itemToDict(it, i)),
  }
  return JSON.stringify(data, null, 1)
}
