// Drawing items the way the desktop paints them (QGraphicsItem.paint), as a
// small virtual SVG tree. The canvas turns it into React elements; exports
// (PNG, PDF, bucket fill, thumbnails) turn it into an SVG string.
//
// Unlike the file format, this is what you see: rotation about the item's
// centre, text in its Qt box (4 px margin, points at 96 dpi), arrowheads,
// dimension caps and labels, and shape labels.

import type { Brush, DimensionItem, Doc, Item, LineItem, Pen, ShapeItem, TextItem } from './model'
import { colorOf, hasLabel, isNoPen, PT, rgbHex } from './model'
import {
  arcPath, arrowHeads, DIM_HEAD, headPolygon, linePath, matrixOf, polygonPath, qtRect, rectOf, normRect, textFont,
} from './geom'
import { cssFamily, layoutText, measureLine, TEXT_MARGIN, wrapText } from './text'
import { anglePoints, dashArray, pathToD, SUN } from './svgio'
import { dimLabel } from './dims'

export interface VNode {
  tag: string
  attrs: Record<string, string>
  children?: VNode[]
  text?: string
}

const v = (tag: string, attrs: Record<string, string>, children?: VNode[], text?: string): VNode => ({ tag, attrs, children, text })

/** Plain decimal numbers for SVG attributes (6 significant digits is not enough on big pages). */
export const n = (x: number) => (Math.abs(x) < 1e-9 ? '0' : String(+x.toFixed(4)))

const colorAttrs = (value: string, prop: 'fill' | 'stroke'): Record<string, string> => {
  const c = colorOf(value)
  const out: Record<string, string> = { [prop]: rgbHex(c) }
  if (c.a < 255) out[`${prop}-opacity`] = n(c.a / 255)
  return out
}

function strokeAttrs(pen: Pen, cap = 'round', join = 'round'): Record<string, string> {
  if (isNoPen(pen)) return { stroke: 'none' }
  const out: Record<string, string> = { ...colorAttrs(pen.color, 'stroke'), 'stroke-linecap': cap, 'stroke-linejoin': join }
  if (pen.width > 0) out['stroke-width'] = n(pen.width)
  else {
    // Qt's zero-width pen is a one-pixel hairline at any zoom.
    out['stroke-width'] = '1'
    out['vector-effect'] = 'non-scaling-stroke'
  }
  const dash = dashArray(pen)
  if (dash) out['stroke-dasharray'] = dash
  return out
}

interface Ctx {
  prefix: string
  dpi: number
}

function brushAttrs(brush: Brush, id: string, defs: VNode[]): Record<string, string> {
  if (!brush) return { fill: 'none' }
  if (!('gradient' in brush)) return colorAttrs(brush.color, 'fill')
  const g = brush.gradient
  const stop = (offset: string, color: string) => {
    const c = colorOf(color)
    const a: Record<string, string> = { offset, 'stop-color': rgbHex(c) }
    if (c.a < 255) a['stop-opacity'] = n(c.a / 255)
    return v('stop', a)
  }
  if (g.kind === 'linear') {
    const [x1, y1, x2, y2] = anglePoints(g.angle)
    defs.push(v('linearGradient', { id, x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2) }, [stop('0', g.c1), stop('1', g.c2)]))
  } else if (g.kind === 'radial') {
    defs.push(v('radialGradient', { id, cx: '0.5', cy: '0.5', r: '0.7071', fx: '0.5', fy: '0.5' }, [stop('0', g.c1), stop('1', g.c2)]))
  } else {
    defs.push(v('radialGradient', { id, cx: n(SUN.cx), cy: n(SUN.cy), r: n(SUN.r), fx: n(SUN.fx), fy: n(SUN.fy) }, [stop('0', g.c2), stop('1', g.c1)]))
  }
  return { fill: `url(#${id})` }
}

const fontAttrs = (family: string, sizePt: number, bold?: boolean, italic?: boolean): Record<string, string> => {
  const a: Record<string, string> = { 'font-family': cssFamily(family), 'font-size': n(sizePt * PT) }
  if (bold) a['font-weight'] = 'bold'
  if (italic) a['font-style'] = 'italic'
  return a
}

const matrixStr = (m: number[]) => `matrix(${m.map(n).join(' ')})`

/** Lines of text as <text> elements with explicit baselines (every renderer agrees on those). */
function textLines(lines: string[], xs: number[], top: number, lineHeight: number, ascent: number, attrs: Record<string, string>): VNode[] {
  return lines.map((line, i) =>
    v('text', { ...attrs, x: n(xs[i]), y: n(top + i * lineHeight + ascent), 'xml:space': 'preserve' }, undefined, line),
  )
}

function renderLabel(it: ShapeItem): VNode[] {
  if (!it.label) return []
  const font = { family: it.labelFamily ?? 'Segoe UI', size: it.labelSize ?? 14, bold: it.labelBold, italic: it.labelItalic }
  const box = qtRect(it)
  const lines = wrapText(it.label, font, Math.max(1, box.w))
  const m = measureLine('Hg', font)
  const lh = m.ascent + m.descent
  const top = box.y + (box.h - lines.length * lh) / 2
  const xs = lines.map(() => box.x + box.w / 2)
  return textLines(lines, xs, top, lh, m.ascent, {
    ...fontAttrs(font.family, font.size, font.bold, font.italic),
    ...colorAttrs(it.labelColor ?? '#ff1a1a1a', 'fill'),
    'text-anchor': 'middle',
  })
}

function renderLine(it: LineItem): VNode[] {
  const out = [v('path', { d: pathToD(linePath(it)), fill: 'none', ...strokeAttrs(it.pen) })]
  if (!isNoPen(it.pen)) {
    const head = { ...colorAttrs(it.pen.color, 'fill'), ...colorAttrs(it.pen.color, 'stroke'), 'stroke-width': n(Math.max(it.pen.width, 0.01)), 'stroke-linejoin': 'bevel' }
    for (const h of arrowHeads(it)) out.push(v('polygon', { points: h.map((p) => `${n(p.x)},${n(p.y)}`).join(' '), ...head }))
  }
  return out
}

function renderDimension(it: DimensionItem, ctx: Ctx): VNode[] {
  const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1)
  if (len < 1 || isNoPen(it.pen)) return []
  const out: VNode[] = []
  const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
  const perp = { x: Math.sin(a), y: -Math.cos(a) }
  const line = strokeAttrs({ ...it.pen, dash: it.dash ? 'dash' : undefined })
  out.push(v('path', { d: `M${n(it.x1)},${n(it.y1)} L${n(it.x2)},${n(it.y2)}`, fill: 'none', ...line }))
  if (it.extension) {
    const E = 14
    for (const [x, y] of [[it.x1, it.y1], [it.x2, it.y2]]) {
      out.push(v('path', { d: `M${n(x - perp.x * E)},${n(y - perp.y * E)} L${n(x + perp.x * E)},${n(y + perp.y * E)}`, fill: 'none', ...line }))
    }
  }
  const w = it.pen.width
  if (it.capStyle === 'arrows') {
    const head = { ...colorAttrs(it.pen.color, 'fill'), ...colorAttrs(it.pen.color, 'stroke'), 'stroke-width': n(Math.max(w, 0.01)), 'stroke-linejoin': 'bevel' }
    for (const h of [headPolygon(it.x2, it.y2, a, DIM_HEAD), headPolygon(it.x1, it.y1, a + Math.PI, DIM_HEAD)]) {
      out.push(v('polygon', { points: h.map((p) => `${n(p.x)},${n(p.y)}`).join(' '), ...head }))
    }
  } else if (it.capStyle === 'ticks') {
    const d = { x: Math.cos(a + Math.PI / 4) * 7, y: Math.sin(a + Math.PI / 4) * 7 }
    for (const [x, y] of [[it.x1, it.y1], [it.x2, it.y2]]) {
      out.push(v('path', { d: `M${n(x - d.x)},${n(y - d.y)} L${n(x + d.x)},${n(y + d.y)}`, fill: 'none', ...colorAttrs(it.pen.color, 'stroke'), 'stroke-width': n(Math.max(w, 1)), 'stroke-linecap': 'square' }))
    }
  } else if (it.capStyle === 'dots') {
    for (const [x, y] of [[it.x1, it.y1], [it.x2, it.y2]]) {
      out.push(v('circle', { cx: n(x), cy: n(y), r: '4', ...colorAttrs(it.pen.color, 'fill'), ...colorAttrs(it.pen.color, 'stroke'), 'stroke-width': n(w) }))
    }
  }
  const lab = dimLabel(it, ctx.dpi)
  const font = { family: 'Segoe UI', size: 10 }
  const m = measureLine(lab.text, font)
  out.push(v('text', {
    x: n(lab.x), y: n(lab.y + m.ascent / 2 - 1), 'text-anchor': 'middle', 'xml:space': 'preserve',
    ...fontAttrs('Segoe UI', 10), ...colorAttrs(it.pen.color, 'fill'),
  }, undefined, lab.text))
  return out
}

function renderText(it: TextItem): VNode[] {
  const l = layoutText(it.text, textFont(it))
  return textLines(l.lines, l.lines.map(() => TEXT_MARGIN), TEXT_MARGIN, l.lineHeight, l.ascent, {
    ...fontAttrs(it.family, it.size, it.bold, it.italic),
    ...colorAttrs(it.color, 'fill'),
  })
}

/** The item's own drawing in local coordinates (no transform). */
export function renderContent(it: Item, ctx: Ctx): VNode[] {
  const defs: VNode[] = []
  let body: VNode[]
  const gid = `${ctx.prefix}g${it._id}`
  switch (it.type) {
    case 'line':
    case 'arrow':
      body = renderLine(it)
      break
    case 'dimension':
      body = renderDimension(it, ctx)
      break
    case 'rect': {
      const r = normRect(rectOf(it.x, it.y, it.w, it.h))
      body = [v('rect', { x: n(r.x), y: n(r.y), width: n(r.w), height: n(r.h), ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    }
    case 'ellipse': {
      const r = normRect(rectOf(it.x, it.y, it.w, it.h))
      body = [v('ellipse', { cx: n(r.x + r.w / 2), cy: n(r.y + r.h / 2), rx: n(r.w / 2), ry: n(r.h / 2), ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    }
    case 'roundrect': {
      const r = normRect(rectOf(it.x, it.y, it.w, it.h))
      const rr = Math.max(0, Math.min(it.radius, r.w / 2, r.h / 2))
      body = [v('rect', { x: n(r.x), y: n(r.y), width: n(r.w), height: n(r.h), rx: n(rr), ry: n(rr), ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    }
    case 'arc':
      body = [v('path', { d: pathToD(arcPath(it.kind, rectOf(it.x, it.y, it.w, it.h), it.flipH, it.flipV)), ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    case 'polygon':
      body = [v('path', { d: pathToD(polygonPath(it.points)), 'fill-rule': 'evenodd', ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    case 'path':
      body = [v('path', { d: pathToD(it.cmds), 'fill-rule': 'evenodd', ...brushAttrs(it.brush, gid, defs), ...strokeAttrs(it.pen) })]
      break
    case 'text':
      body = renderText(it)
      break
    case 'image':
      body = [v('image', { href: `data:${it.mime ?? 'image/png'};base64,${it.image}`, x: '0', y: '0', width: n(it.iw), height: n(it.ih), preserveAspectRatio: 'none' })]
      break
    case 'group':
      body = it.children.map((c) => renderItem(c, ctx))
      break
  }
  if (hasLabel(it)) body.push(...renderLabel(it))
  return defs.length ? [v('defs', {}, defs), ...body] : body
}

/** An item with its transform and opacity. */
export function renderItem(it: Item, ctx: Ctx): VNode {
  const attrs: Record<string, string> = { transform: matrixStr(matrixOf(it)) }
  if (it.opacity < 1) attrs.opacity = n(Math.max(0, it.opacity))
  return v('g', attrs, renderContent(it, ctx))
}

// ---------------------------------------------------------------- strings

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;')

export function vnodeToString(node: VNode): string {
  let attrs = Object.entries(node.attrs).map(([k, val]) => ` ${k}="${escAttr(val)}"`).join('')
  // Older SVG readers (MuPDF among them) look for xlink:href on images.
  if (node.tag === 'image' && node.attrs.href) attrs += ` xlink:href="${escAttr(node.attrs.href)}"`
  const inner = (node.text != null ? escText(node.text) : '') + (node.children ?? []).map(vnodeToString).join('')
  return inner ? `<${node.tag}${attrs}>${inner}</${node.tag}>` : `<${node.tag}${attrs}/>`
}

export interface PictureOptions {
  /** The raster layer as an image URL (data: or blob:), drawn under the items. */
  raster?: string | null
  /** The area to show, in page pixels (default: the page). */
  area?: { x: number; y: number; w: number; h: number }
  /** Output size in pixels or with units (default: the area's size). */
  width?: string
  height?: string
  /** Paint the area white first (exports do, like the desktop). */
  white?: boolean
  prefix?: string
}

/** The drawing as a standalone SVG string, as it appears on the canvas. */
export function pictureSvg(doc: Doc, items: Item[], opts: PictureOptions = {}): string {
  const area = opts.area ?? { x: 0, y: 0, w: doc.width, h: doc.height }
  const ctx: Ctx = { prefix: opts.prefix ?? 'kpx', dpi: doc.dpi }
  const parts: string[] = []
  if (opts.white !== false) parts.push(`<rect x="${n(area.x)}" y="${n(area.y)}" width="${n(area.w)}" height="${n(area.h)}" fill="#ffffff"/>`)
  if (opts.raster) parts.push(`<image href="${escAttr(opts.raster)}" xlink:href="${escAttr(opts.raster)}" x="0" y="0" width="${doc.raster.w}" height="${doc.raster.h}" preserveAspectRatio="none"/>`)
  for (const it of items) parts.push(vnodeToString(renderItem(it, ctx)))
  const w = opts.width ?? n(area.w)
  const h = opts.height ?? n(area.h)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" ` +
    `viewBox="${n(area.x)} ${n(area.y)} ${n(area.w)} ${n(area.h)}">${parts.join('')}</svg>`
  )
}
