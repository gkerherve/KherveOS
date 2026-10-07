// Editable SVG, the desktop's default format (svgio.py).
//
// Writing emits the same document the desktop writes: one element per item,
// geometry in local coordinates with a translate/rotate transform (or the
// whole matrix when scaled), the raster layer as an embedded <image>, and the
// KhervePaint bits (grid, polygon kind, labels, dimension style…) in the kp:
// namespace. Two additions other viewers need and the desktop ignores:
// arrowhead markers and dimension labels.
//
// Reading follows load_svg: <g> becomes a group, primitives become their
// items, scaled or sheared elements and <path>s become paths, <use> is
// resolved by id. Like the desktop, a plain translate+rotate is applied about
// the item's centre.

import type { Brush, DashStyle, Doc, GroupItem, Item, Mat, PathCmd, Pen, Pt, Raster, TextItem } from './model'
import { argbHex, blankRaster, DEFAULT_FONT, hasLabel, isNoPen, newId, newRasterKey, parseColor, rgbHex } from './model'
import type { RGBA } from './model'
import {
  IDENTITY, PathBuilder, arcPath, center, ellipsePath, mapCmds, mapRect, matrixOf, mul, qtRect, rectOf, rotateM, scaleM, translateM, union,
} from './geom'
import { base64ToBytes, jpegSize, pngSize } from './png'
import { el, iter, itertext, localName, parseXml, writeXml, type XmlEl } from './xml'
import { dimLabel } from './dims'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const XLINK_NS = 'http://www.w3.org/1999/xlink'
export const KP_NS = 'https://kerherve.app/khervepaint'

const PREFIXES: Record<string, string> = { [SVG_NS]: '', [XLINK_NS]: 'xlink', [KP_NS]: 'kp' }
const S = (tag: string) => `{${SVG_NS}}${tag}`
const K = (name: string) => `{${KP_NS}}${name}`
const XLINK_HREF = `{${XLINK_NS}}href`

const EPS = 1e-4

// ------------------------------------------------------------ number format

/** Python's format(x, "g"): six significant digits, trailing zeros removed. */
export function fmtG(x: number): string {
  if (!isFinite(x)) return isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  let mant: string
  let exp: number
  const em = /^(\d)\.?(\d*)e([+-]\d+)$/.exec(Math.abs(x).toExponential(21))
  const digits = em ? em[1] + em[2] : ''
  if (em && /^\d{6}50*$/.test(digits)) {
    // An exact tie at the 7th digit: Python rounds half to even.
    let keep = BigInt(digits.slice(0, 6))
    if (keep % 2n === 1n) keep += 1n
    let k = keep.toString()
    exp = parseInt(em[3], 10)
    if (k.length > 6) {
      k = k.slice(0, 6)
      exp += 1
    }
    mant = `${k[0]}.${k.slice(1)}`
    if (x < 0) mant = '-' + mant
  } else {
    const s = x.toExponential(5)
    const i = s.indexOf('e')
    mant = s.slice(0, i)
    exp = parseInt(s.slice(i + 1), 10)
  }
  if (exp < -4 || exp >= 6) {
    const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant
    const a = Math.abs(exp)
    return `${m}e${exp < 0 ? '-' : '+'}${a < 10 ? '0' + a : a}`
  }
  // Fixed notation from the rounded significand.
  const neg = mant.startsWith('-')
  const ds = mant.replace('-', '').replace('.', '')
  let f: string
  if (exp >= 0) {
    const intPart = ds.slice(0, exp + 1).padEnd(exp + 1, '0')
    const frac = ds.slice(exp + 1)
    f = frac ? `${intPart}.${frac}` : intPart
  } else f = `0.${'0'.repeat(-exp - 1)}${ds}`
  if (f.includes('.')) f = f.replace(/0+$/, '').replace(/\.$/, '')
  return (neg ? '-' : '') + f
}

/** Python's str() of a number that is an int on the desktop side. */
const fmtInt = (x: number) => String(Math.round(x))

/** json.dumps with Python's default separators (", " and ": "). */
export function pyJson(v: unknown, asciiOnly = true): string {
  const s = (x: unknown): string => {
    if (x === null || x === undefined) return 'null'
    if (typeof x === 'boolean') return x ? 'true' : 'false'
    if (typeof x === 'number') return isFinite(x) ? String(x) : x > 0 ? 'Infinity' : x < 0 ? '-Infinity' : 'NaN'
    if (typeof x === 'string') {
      const j = JSON.stringify(x)
      return asciiOnly ? j.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : j
    }
    if (Array.isArray(x)) return '[' + x.map(s).join(', ') + ']'
    if (typeof x === 'object') return '{' + Object.entries(x as Record<string, unknown>).map(([k, v]) => `${s(k)}: ${s(v)}`).join(', ') + '}'
    return 'null'
  }
  return s(v)
}

// ------------------------------------------------------------------ writing

interface Ctx {
  root: XmlEl
  defs: XmlEl | null
  n: number
  markers: Map<string, string>
  dpi: number
}

const qtName = (c: RGBA) => rgbHex(c)
const colorOf = (s: string): RGBA => parseColor(s) ?? { r: 0, g: 0, b: 0, a: 255 }

function ensureDefs(ctx: Ctx): XmlEl {
  if (!ctx.defs) {
    ctx.defs = el(S('defs'))
    ctx.root.children.unshift(ctx.defs)
  }
  return ctx.defs
}

/** Qt dash patterns, in pen widths. */
export const DASH_PATTERNS: Record<Exclude<DashStyle, 'solid'>, number[]> = {
  dash: [4, 2],
  dot: [1, 2],
  dashdot: [4, 2, 1, 2],
}

export function dashArray(pen: Pen): string | null {
  if (!pen.dash || pen.dash === 'solid') return null
  const w = Math.max(pen.width, 1)
  return DASH_PATTERNS[pen.dash].map((d) => fmtG(d * w)).join(',')
}

function setStroke(e: XmlEl, pen: Pen) {
  if (isNoPen(pen)) {
    e.attrs.stroke = 'none'
    return
  }
  const c = colorOf(pen.color)
  e.attrs.stroke = qtName(c)
  e.attrs['stroke-width'] = fmtG(pen.width)
  if (c.a < 255) e.attrs['stroke-opacity'] = fmtG(c.a / 255)
  e.attrs['stroke-linecap'] = 'round'
  e.attrs['stroke-linejoin'] = 'round'
  const dash = dashArray(pen)
  if (dash) e.attrs['stroke-dasharray'] = dash
}

/** (x1, y1, x2, y2) of a linear gradient at `angle` in the unit box (gradient.angle_points). */
export function anglePoints(angle: number): [number, number, number, number] {
  const r = (angle * Math.PI) / 180
  const dx = Math.cos(r) / 2
  const dy = Math.sin(r) / 2
  return [0.5 - dx, 0.5 - dy, 0.5 + dx, 0.5 + dy]
}

export const SUN = { cx: 0.35, cy: 0.35, fx: 0.25, fy: 0.25, r: 0.95 }

function gradientDef(ctx: Ctx, g: { kind: string; c1: string; c2: string; angle: number }): string {
  const defs = ensureDefs(ctx)
  ctx.n += 1
  const id = `kpgrad${ctx.n}`
  let stops: [string, string][] = [['0', g.c1], ['1', g.c2]]
  let e: XmlEl
  if (g.kind === 'radial') e = el(S('radialGradient'), { cx: '0.5', cy: '0.5', r: '0.7071' })
  else if (g.kind === 'sun') {
    e = el(S('radialGradient'), { cx: fmtG(SUN.cx), cy: fmtG(SUN.cy), r: fmtG(SUN.r), fx: fmtG(SUN.fx), fy: fmtG(SUN.fy) })
    stops = [['0', g.c2], ['1', g.c1]]
  } else {
    const [x1, y1, x2, y2] = anglePoints(g.angle)
    e = el(S('linearGradient'), { x1: fmtG(x1), y1: fmtG(y1), x2: fmtG(x2), y2: fmtG(y2) })
  }
  e.attrs.id = id
  e.attrs.gradientUnits = 'objectBoundingBox'
  for (const [offset, color] of stops) {
    const c = colorOf(color)
    const stop = el(S('stop'), { offset, 'stop-color': qtName(c) })
    if (c.a < 255) stop.attrs['stop-opacity'] = fmtG(c.a / 255)
    e.children.push(stop)
  }
  defs.children.push(e)
  return id
}

function setFill(e: XmlEl, brush: Brush, ctx: Ctx) {
  if (!brush) {
    e.attrs.fill = 'none'
    return
  }
  if ('gradient' in brush) {
    e.attrs.fill = `url(#${gradientDef(ctx, brush.gradient)})`
    return
  }
  const c = colorOf(brush.color)
  e.attrs.fill = qtName(c)
  if (c.a < 255) e.attrs['fill-opacity'] = fmtG(c.a / 255)
}

const matrixAttr = (m: Mat) => `matrix(${m.map(fmtG).join(',')})`

const simpleForm = (x: number, y: number, deg: number) => {
  const parts: string[] = []
  if (Math.abs(x) > EPS || Math.abs(y) > EPS) parts.push(`translate(${fmtG(x)},${fmtG(y)})`)
  if (Math.abs(deg) > EPS) parts.push(`rotate(${fmtG(deg)})`)
  return parts.join(' ')
}

/**
 * The transform attribute (svgio._transform_attr). `baked` is the transform of
 * rotated or resized groups above the item: the desktop reads a group's
 * rotation wrongly (it turns each child about its own centre), so such groups
 * are written untransformed and their transform goes into the items.
 */
function transformAttr(it: Item, baked: Mat | null): string {
  if (!baked) {
    if (Math.abs(it.scale - 1) > EPS || (it.type === 'group' && it.matrix && !isIdentityM(it.matrix))) return matrixAttr(matrixOf(it))
    return simpleForm(it.pos.x, it.pos.y, it.rotation)
  }
  const full = mul(baked, matrixOf(it))
  const { simple, deg } = decompose(full)
  if (!simple || it.type === 'image') return matrixAttr(full)
  // pos + o + R(p − o) = full(p)  ⇒  pos = full(o) − o
  const o = center(qtRect(it))
  return simpleForm(full[0] * o.x + full[2] * o.y + full[4] - o.x, full[1] * o.x + full[3] * o.y + full[5] - o.y, deg)
}

const isIdentityM = (m: Mat) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0

/** A group that only moves: written as-is; anything else is baked into its items. */
const movesOnly = (it: GroupItem) => Math.abs(it.rotation) <= EPS && Math.abs(it.scale - 1) <= EPS && (!it.matrix || isIdentityM(it.matrix))

function setCommon(e: XmlEl, it: Item, baked: Mat | null) {
  const tf = transformAttr(it, baked)
  if (tf) e.attrs.transform = tf
  if (it.opacity < 1 - EPS) e.attrs.opacity = fmtG(it.opacity)
}

export function pathToD(cmds: PathCmd[]): string {
  return cmds
    .map((c) =>
      c[0] === 'C' ? `C${fmtG(c[1])},${fmtG(c[2])} ${fmtG(c[3])},${fmtG(c[4])} ${fmtG(c[5])},${fmtG(c[6])}` : `${c[0]}${fmtG(c[1])},${fmtG(c[2])}`,
    )
    .join(' ')
}

/** A marker drawing an arrowhead (or a dimension cap) for viewers other than KhervePaint. */
function marker(ctx: Ctx, kind: 'head' | 'tick' | 'dot' | 'dimhead', pen: Pen, start: boolean): string {
  const c = colorOf(pen.color)
  const key = `${kind}|${qtName(c)}|${c.a}|${pen.width}|${start ? 1 : 0}`
  let id = ctx.markers.get(key)
  if (id) return id
  id = `kpmark${ctx.markers.size + 1}`
  ctx.markers.set(key, id)
  const m = el(S('marker'), {
    id, markerUnits: 'userSpaceOnUse', orient: start ? 'auto-start-reverse' : 'auto', overflow: 'visible',
    markerWidth: '1', markerHeight: '1', refX: '0', refY: '0',
  })
  const color = qtName(c)
  const shape = (e: XmlEl) => {
    if (c.a < 255) {
      e.attrs['fill-opacity'] = fmtG(c.a / 255)
      e.attrs['stroke-opacity'] = fmtG(c.a / 255)
    }
    m.children.push(e)
  }
  if (kind === 'head' || kind === 'dimhead') {
    const size = kind === 'head' ? 14 : 10
    const a = Math.PI / 7
    const pts = [[0, 0], [-Math.cos(a) * size, Math.sin(a) * size], [-Math.cos(a) * size, -Math.sin(a) * size]]
    shape(el(S('path'), { d: `M${pts.map((p) => `${fmtG(p[0])},${fmtG(p[1])}`).join(' L')} Z`, fill: color, stroke: color, 'stroke-width': fmtG(pen.width) }))
  } else if (kind === 'tick') {
    // A slash at 45° to the line, 7 px each way.
    const d = 7 * Math.SQRT1_2
    shape(el(S('path'), { d: `M${fmtG(-d)},${fmtG(-d)} L${fmtG(d)},${fmtG(d)}`, fill: 'none', stroke: color, 'stroke-width': fmtG(Math.max(pen.width, 1)) }))
  } else {
    shape(el(S('circle'), { cx: '0', cy: '0', r: '4', fill: color, stroke: color, 'stroke-width': fmtG(pen.width) }))
  }
  ensureDefs(ctx).children.push(m)
  return id
}

function lineElement(parent: XmlEl, it: Extract<Item, { type: 'line' | 'arrow' }>): XmlEl {
  let e: XmlEl
  if (!it.bend) {
    e = el(S('line'), { x1: fmtG(it.x1), y1: fmtG(it.y1), x2: fmtG(it.x2), y2: fmtG(it.y2) })
  } else {
    const [bx, by] = it.bend
    e = el(S('path'), {
      d: `M${fmtG(it.x1)},${fmtG(it.y1)} Q${fmtG(bx)},${fmtG(by)} ${fmtG(it.x2)},${fmtG(it.y2)}`,
      fill: 'none',
      [K('x1')]: fmtG(it.x1),
      [K('y1')]: fmtG(it.y1),
      [K('x2')]: fmtG(it.x2),
      [K('y2')]: fmtG(it.y2),
      [K('bend')]: `${fmtG(bx)} ${fmtG(by)}`,
    })
  }
  parent.children.push(e)
  return e
}

const MODEL_ATTRS: [string, string, 'g' | 'str' | 'json' | 'flag'][] = [
  ['model_az', 'model-az', 'g'],
  ['model_el', 'model-el', 'g'],
  ['model_bond', 'model-bond', 'g'],
  ['model_box', 'model-box', 'g'],
  ['model_repr', 'model-repr', 'str'],
  ['model_colors', 'model-colors', 'json'],
  ['model_tilts', 'model-tilts', 'json'],
  ['model_poly', 'model-poly', 'flag'],
  ['model_cells', 'model-cells', 'json'],
]

function groupTags(g: XmlEl, it: GroupItem) {
  const x = it.extra ?? {}
  if (x.model) {
    g.attrs[K('model')] = String(x.model)
    for (const [key, attr, kind] of MODEL_ATTRS) {
      const v = x[key]
      if (kind === 'g') {
        if (typeof v === 'number') g.attrs[K(attr)] = fmtG(v)
      } else if (kind === 'str') {
        if (v) g.attrs[K(attr)] = String(v)
      } else if (kind === 'flag') {
        if (v) g.attrs[K(attr)] = '1'
      } else if (v && (!(typeof v === 'object') || Object.keys(v as object).length)) g.attrs[K(attr)] = pyJson(v)
    }
    if (Array.isArray(x.model_atoms) && x.model_atoms.length) {
      g.attrs[K('model-atoms')] = pyJson(x.model_atoms)
      g.attrs[K('model-bonds')] = pyJson(x.model_bonds ?? [])
    }
  }
  if (it.symbol) g.attrs[K('symbol')] = it.symbol
  if (x.solid && typeof x.solid === 'object') g.attrs[K('solid')] = pyJson(x.solid)
  if (x.reaction && typeof x.reaction === 'object') g.attrs[K('reaction')] = pyJson(x.reaction, false)
}

function itemToElement(parent: XmlEl, it: Item, ctx: Ctx, baked: Mat | null = null): XmlEl | null {
  let e: XmlEl
  switch (it.type) {
    case 'group': {
      const g = el(S('g'))
      parent.children.push(g)
      if (!baked && movesOnly(it)) {
        setCommon(g, it, null)
        groupTags(g, it)
        for (const c of it.children) itemToElement(g, c, ctx)
      } else {
        if (it.opacity < 1 - EPS) g.attrs.opacity = fmtG(it.opacity)
        groupTags(g, it)
        const inner = mul(baked ?? IDENTITY, matrixOf(it))
        for (const c of it.children) itemToElement(g, c, ctx, inner)
      }
      return g
    }
    case 'dimension': {
      e = el(S('line'), {
        x1: fmtG(it.x1), y1: fmtG(it.y1), x2: fmtG(it.x2), y2: fmtG(it.y2),
        [K('kind')]: 'dimension',
        [K('dim-cap')]: it.capStyle,
        [K('dim-ext')]: it.extension ? '1' : '0',
        [K('dim-dash')]: it.dash ? '1' : '0',
        [K('dim-unit')]: it.unit,
        [K('dim-decimals')]: fmtInt(it.decimals),
      })
      if (it.prefix) e.attrs[K('dim-prefix')] = it.prefix
      if (it.suffix) e.attrs[K('dim-suffix')] = it.suffix
      parent.children.push(e)
      setStroke(e, it.pen)
      if (it.dash && !isNoPen(it.pen)) e.attrs['stroke-dasharray'] = dashArray({ ...it.pen, dash: 'dash' })!
      if (it.capStyle !== 'none' && !isNoPen(it.pen)) {
        const kind = it.capStyle === 'arrows' ? 'dimhead' : it.capStyle === 'ticks' ? 'tick' : 'dot'
        e.attrs['marker-start'] = `url(#${marker(ctx, kind, it.pen, true)})`
        e.attrs['marker-end'] = `url(#${marker(ctx, kind, it.pen, false)})`
      }
      break
    }
    case 'arrow':
    case 'line':
      e = lineElement(parent, it)
      if (it.type === 'arrow') e.attrs[K('kind')] = 'arrow'
      setStroke(e, it.pen)
      if (it.type === 'arrow' && !isNoPen(it.pen)) {
        e.attrs['marker-end'] = `url(#${marker(ctx, 'head', it.pen, false)})`
        if (it.head1) e.attrs['marker-start'] = `url(#${marker(ctx, 'head', it.pen, true)})`
      }
      break
    case 'roundrect':
      e = el(S('rect'), { x: fmtG(it.x), y: fmtG(it.y), width: fmtG(it.w), height: fmtG(it.h), rx: fmtG(it.radius), ry: fmtG(it.radius) })
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    case 'rect':
      e = el(S('rect'), { x: fmtG(it.x), y: fmtG(it.y), width: fmtG(it.w), height: fmtG(it.h) })
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    case 'ellipse':
      e = el(S('ellipse'), { cx: fmtG(it.x + it.w / 2), cy: fmtG(it.y + it.h / 2), rx: fmtG(it.w / 2), ry: fmtG(it.h / 2) })
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    case 'polygon':
      e = el(S('polygon'), { points: it.points.map((p) => `${fmtG(p[0])},${fmtG(p[1])}`).join(' ') })
      if (it.kind && it.kind !== 'polygon') e.attrs[K('kind')] = it.kind
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    case 'arc': {
      e = el(S('path'), { d: pathToD(arcPath(it.kind, rectOf(it.x, it.y, it.w, it.h), it.flipH, it.flipV)) })
      e.attrs[K('kind')] = it.kind
      e.attrs[K('ax')] = fmtG(it.x)
      e.attrs[K('ay')] = fmtG(it.y)
      e.attrs[K('aw')] = fmtG(it.w)
      e.attrs[K('ah')] = fmtG(it.h)
      if (it.flipH) e.attrs[K('flip-h')] = '1'
      if (it.flipV) e.attrs[K('flip-v')] = '1'
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    }
    case 'path':
      e = el(S('path'), { d: pathToD(it.cmds) })
      parent.children.push(e)
      setStroke(e, it.pen)
      setFill(e, it.brush, ctx)
      break
    case 'text': {
      e = el(S('text'), { x: '0', y: '0', 'dominant-baseline': 'text-before-edge', 'font-family': it.family, 'font-size': fmtInt(it.size) })
      if (it.bold) e.attrs['font-weight'] = 'bold'
      if (it.italic) e.attrs['font-style'] = 'italic'
      e.attrs.fill = qtName(colorOf(it.color))
      e.text = it.text
      parent.children.push(e)
      break
    }
    case 'image': {
      e = el(S('image'), { x: '0', y: '0', width: fmtInt(it.iw), height: fmtInt(it.ih), [XLINK_HREF]: `data:image/png;base64,${it.image}` })
      e.attrs.transform = matrixAttr(baked ? mul(baked, it.matrix) : it.matrix)
      if (it.opacity < 1 - EPS) e.attrs.opacity = fmtG(it.opacity)
      parent.children.push(e)
      return e
    }
  }
  setCommon(e, it, baked)
  if (hasLabel(it) && it.label) emitLabel(parent, e, it, baked)
  if (it.type === 'dimension') emitDimLabel(parent, it, ctx.dpi, baked)
  return e
}

function emitLabel(parent: XmlEl, e: XmlEl, it: Extract<Item, { label?: string }>, baked: Mat | null) {
  const color = qtName(colorOf(it.labelColor ?? '#ff1a1a1a'))
  const family = it.labelFamily ?? DEFAULT_FONT
  const size = fmtInt(it.labelSize ?? 14)
  e.attrs[K('label')] = it.label!
  e.attrs[K('label-color')] = color
  e.attrs[K('label-family')] = family
  e.attrs[K('label-size')] = size
  if (it.labelBold) e.attrs[K('label-bold')] = '1'
  if (it.labelItalic) e.attrs[K('label-italic')] = '1'
  const c = center(qtRect(it as Item))
  const t = el(S('text'), { x: fmtG(c.x), y: fmtG(c.y), 'text-anchor': 'middle', 'dominant-baseline': 'central' })
  const tf = transformAttr(it as Item, baked)
  if (tf) t.attrs.transform = tf
  t.attrs['font-family'] = family
  t.attrs['font-size'] = size
  if (it.labelBold) t.attrs['font-weight'] = 'bold'
  if (it.labelItalic) t.attrs['font-style'] = 'italic'
  t.attrs.fill = color
  t.attrs[K('role')] = 'label'
  t.text = it.label!
  parent.children.push(t)
}

/** The measured length as a visible <text> (skipped on reading, like shape labels). */
function emitDimLabel(parent: XmlEl, it: Extract<Item, { type: 'dimension' }>, dpi: number, baked: Mat | null) {
  const lab = dimLabel(it, dpi)
  const t = el(S('text'), { x: fmtG(lab.x), y: fmtG(lab.y), 'text-anchor': 'middle', 'dominant-baseline': 'central' })
  const tf = transformAttr(it, baked)
  if (tf) t.attrs.transform = tf
  t.attrs['font-family'] = DEFAULT_FONT
  t.attrs['font-size'] = '10'
  t.attrs.fill = qtName(colorOf(it.pen.color))
  t.attrs[K('role')] = 'label'
  t.text = lab.text
  parent.children.push(t)
}

export interface SvgOptions {
  /** The raster layer as base64 PNG, or null for none (library objects). */
  raster: string | null
}

/** The document as the desktop's editable SVG. */
export function writeSvg(doc: Doc, opts: SvgOptions): string {
  const w = Math.trunc(doc.width)
  const h = Math.trunc(doc.height)
  const root = el(S('svg'), {
    width: `${fmtG(w / doc.dpi)}in`,
    height: `${fmtG(h / doc.dpi)}in`,
    viewBox: `0 0 ${w} ${h}`,
    [K('dpi')]: Number.isInteger(doc.dpi) ? String(doc.dpi) : fmtG(doc.dpi),
    [K('grid-mm')]: fmtG(doc.grid.mm),
    [K('grid-show')]: doc.grid.show ? '1' : '0',
    [K('grid-snap')]: doc.grid.snap ? '1' : '0',
    [K('infinite')]: doc.grid.infinite ? '1' : '0',
  })
  if (opts.raster) {
    root.children.push(
      el(S('image'), {
        x: '0', y: '0', width: String(doc.raster.w), height: String(doc.raster.h), [K('role')]: 'raster',
        [XLINK_HREF]: `data:image/png;base64,${opts.raster}`,
      }),
    )
  }
  const ctx: Ctx = { root, defs: null, n: 0, markers: new Map(), dpi: doc.dpi }
  for (const it of doc.items) itemToElement(root, it, ctx)
  return writeXml(root, PREFIXES)
}

// ------------------------------------------------------------------ reading

type Style = Record<string, string> & { _opacity?: string }
interface ReadCtx {
  /** Written by KhervePaint: translate/rotate turn about the item's centre and <g> keeps its transform. */
  kp: boolean
  ids: Map<string, XmlEl>
  gradients: Map<string, { kind: 'linear' | 'radial' | 'sun'; c1: string; c2: string; angle: number }>
  raster: Raster | null
}

function svgColor(value: string | undefined, fallback = '#000000'): RGBA {
  if (value == null) return parseColor(fallback)!
  const v = value.trim()
  if (v === 'none' || v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const m = /^rgba?\(([^)]+)\)/.exec(v)
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim())
    const nums = parts.slice(0, 3).map((p) => (p.endsWith('%') ? Math.round(parseFloat(p) * 2.55) : Math.round(parseFloat(p))))
    const c = { r: nums[0] || 0, g: nums[1] || 0, b: nums[2] || 0, a: 255 }
    if (parts.length === 4) c.a = Math.round(Math.max(0, Math.min(1, parseFloat(parts[3]))) * 255)
    return c
  }
  return parseColor(v) ?? parseColor(fallback)!
}

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'stroke-dasharray']

function resolveStyle(e: XmlEl, inherited: Style): Style {
  const s: Style = { ...inherited }
  const style = e.attrs.style
  if (style) {
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) s[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
  }
  for (const k of STYLE_KEYS) if (e.attrs[k] != null) s[k] = e.attrs[k]
  if (e.attrs.opacity != null) s._opacity = String(parseFloat(s._opacity ?? '1') * num(e.attrs.opacity, 1))
  return s
}

const num = (v: string | undefined, d = 0): number => {
  if (v == null) return d
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(v)
  return m ? parseFloat(m[1]) : d
}

function dashFrom(value: string | undefined, width: number): DashStyle | undefined {
  if (!value || value === 'none') return undefined
  const parts = value.split(/[\s,]+/).map(parseFloat).filter((x) => isFinite(x) && x >= 0)
  if (!parts.length || parts.every((x) => x === 0)) return undefined
  const w = Math.max(width, 1)
  if (parts.length >= 4) return 'dashdot'
  return parts[0] / w <= 1.5 ? 'dot' : 'dash'
}

function penFromStyle(s: Style): Pen {
  const stroke = s.stroke ?? 'none'
  if (stroke === 'none') return { color: '#00000000', width: 0 }
  const c = svgColor(stroke)
  if (s['stroke-opacity'] != null) c.a = Math.round(Math.max(0, Math.min(1, num(s['stroke-opacity'], 1))) * 255)
  const pen: Pen = { color: argbHex(c), width: num(s['stroke-width'], 1) }
  const dash = dashFrom(s['stroke-dasharray'], pen.width)
  if (dash) pen.dash = dash
  return pen
}

function brushFromStyle(s: Style, ctx: ReadCtx): Brush {
  const fill = s.fill ?? '#000000'
  if (fill === 'none') return null
  const m = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(fill)
  if (m) {
    const g = ctx.gradients.get(m[1])
    return g ? { gradient: { ...g } } : null
  }
  const c = svgColor(fill)
  if (s['fill-opacity'] != null) c.a = Math.round(Math.max(0, Math.min(1, num(s['fill-opacity'], 1))) * 255)
  return { color: argbHex(c) }
}

const hrefOf = (e: XmlEl) => e.attrs[XLINK_HREF] ?? e.attrs.href

function scanGradients(root: XmlEl): ReadCtx['gradients'] {
  const els = new Map<string, XmlEl>()
  for (const e of iter(root)) {
    const t = localName(e.tag)
    if ((t === 'linearGradient' || t === 'radialGradient') && e.attrs.id) els.set(e.attrs.id, e)
  }
  const stopsOf = (e: XmlEl, depth = 0): XmlEl[] => {
    const stops = e.children.filter((c) => localName(c.tag) === 'stop')
    if (stops.length || depth > 4) return stops
    const href = hrefOf(e)
    if (href?.startsWith('#') && els.has(href.slice(1))) return stopsOf(els.get(href.slice(1))!, depth + 1)
    return []
  }
  const stopColor = (stop: XmlEl) => {
    const style: Record<string, string> = {}
    for (const decl of (stop.attrs.style ?? '').split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
    const c = svgColor(stop.attrs['stop-color'] || style['stop-color'], '#000000')
    const op = stop.attrs['stop-opacity'] ?? style['stop-opacity']
    if (op != null) c.a = Math.round(Math.max(0, Math.min(1, num(op, 1))) * 255)
    return c
  }
  const frac = (e: XmlEl, key: string, d: number) => {
    const v = e.attrs[key]
    if (v == null) return d
    const t = v.trim()
    return t.endsWith('%') ? num(t) / 100 : num(t, d)
  }
  const out: ReadCtx['gradients'] = new Map()
  for (const [id, e] of els) {
    const stops = stopsOf(e)
    if (!stops.length) continue
    let c1 = argbHex(stopColor(stops[0]))
    let c2 = argbHex(stopColor(stops[stops.length - 1]))
    let kind: 'linear' | 'radial' | 'sun' = 'linear'
    let angle = 90
    if (localName(e.tag) === 'radialGradient') {
      const cx = frac(e, 'cx', 0.5)
      const cy = frac(e, 'cy', 0.5)
      if (Math.abs(cx - 0.5) > 0.01 || Math.abs(cy - 0.5) > 0.01) {
        kind = 'sun'
        ;[c1, c2] = [c2, c1]
      } else kind = 'radial'
    } else {
      const dx = frac(e, 'x2', 1) - frac(e, 'x1', 0)
      const dy = frac(e, 'y2', 0) - frac(e, 'y1', 0)
      angle = dx || dy ? ((((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360 : 0
    }
    out.set(id, { kind, c1, c2, angle })
  }
  return out
}

/** An SVG transform attribute as a matrix (rightmost operation applied first). */
export function parseTransform(text: string | undefined): Mat {
  let t = IDENTITY
  if (!text) return t
  for (const m of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (n.some((x) => !isFinite(x))) continue
    let op: Mat | null = null
    switch (m[1]) {
      case 'translate':
        if (n.length) op = translateM(n[0], n[1] ?? 0)
        break
      case 'scale':
        if (n.length) op = scaleM(n[0], n[1] ?? n[0])
        break
      case 'rotate':
        if (n.length === 3) op = mul(translateM(n[1], n[2]), mul(rotateM(n[0]), translateM(-n[1], -n[2])))
        else if (n.length) op = rotateM(n[0])
        break
      case 'matrix':
        if (n.length === 6) op = n as Mat
        break
      case 'skewX':
        if (n.length) op = [1, 0, Math.tan((n[0] * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        if (n.length) op = [1, Math.tan((n[0] * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    if (op) t = mul(t, op)
  }
  return t
}

/** (dx, dy, degrees, simple): simple means translation + rotation only. */
export function decompose(m: Mat): { dx: number; dy: number; deg: number; simple: boolean } {
  const [a, b, c, d, e, f] = m
  const simple = Math.abs(a * a + b * b - 1) < 1e-3 && Math.abs(a - d) < 1e-3 && Math.abs(b + c) < 1e-3 && a * d - b * c > 0
  return { dx: e, dy: f, deg: (Math.atan2(b, a) * 180) / Math.PI, simple }
}

function base() {
  return { _id: newId(), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 }
}

/**
 * Place a freshly built item. KhervePaint writes translate+rotate meaning a
 * turn about the item's centre (finalise in svgio.py); any other transform is
 * taken exactly: pos + o + R(p − o) = total(p) gives pos = total(o) − o.
 */
function placeItem<T extends Item>(it: T, total: Mat, style: Style, exact: boolean): T {
  const { dx, dy, deg } = decompose(total)
  if (Math.abs(deg) > EPS) it.rotation = deg
  if (exact) {
    const o = center(qtRect({ ...it, rotation: 0 }))
    it.pos = { x: total[0] * o.x + total[2] * o.y + total[4] - o.x, y: total[1] * o.x + total[3] * o.y + total[5] - o.y }
  } else it.pos = { x: dx, y: dy }
  if (style._opacity != null) it.opacity = parseFloat(style._opacity)
  return it
}

function bakedPath(local: PathCmd[], total: Mat, style: Style, ctx: ReadCtx): Item {
  const it: Item = { ...base(), type: 'path', pen: penFromStyle(style), brush: brushFromStyle(style, ctx), cmds: mapCmds(total, local) }
  if (style._opacity != null) it.opacity = parseFloat(style._opacity)
  return it
}

function parsePoints(text: string): [number, number][] {
  const nums = text.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

function buildLeaf(e: XmlEl, total: Mat, style: Style, ctx: ReadCtx, exact: boolean): Item | null {
  const tag = localName(e.tag)
  const { simple } = decompose(total)
  const place = <T extends Item>(it: T, m: Mat, st: Style) => placeItem(it, m, st, exact)
  const a = e.attrs
  const shape = () => ({ pen: penFromStyle(style), brush: brushFromStyle(style, ctx) })
  switch (tag) {
    case 'line': {
      const x1 = num(a.x1)
      const y1 = num(a.y1)
      const x2 = num(a.x2)
      const y2 = num(a.y2)
      const kind = a[K('kind')]
      if (simple) {
        if (kind === 'dimension') {
          const cap = a[K('dim-cap')] ?? 'arrows'
          const unit = a[K('dim-unit')] ?? 'mm'
          const dpen = penFromStyle(style)
          delete dpen.dash
          return place({
            ...base(), type: 'dimension', pen: dpen, x1, y1, x2, y2,
            capStyle: (['arrows', 'ticks', 'dots', 'none'].includes(cap) ? cap : 'arrows') as 'arrows',
            extension: a[K('dim-ext')] === '1',
            dash: a[K('dim-dash')] === '1',
            unit: (['mm', 'cm', 'in'].includes(unit) ? unit : 'mm') as 'mm',
            decimals: Math.trunc(num(a[K('dim-decimals')], 1)),
            prefix: a[K('dim-prefix')] ?? '',
            suffix: a[K('dim-suffix')] ?? '',
          }, total, style)
        }
        const pen = penFromStyle(style)
        // A plain line ending in a marker is an arrow (other editors' arrows).
        let type: 'line' | 'arrow' = kind === 'arrow' ? 'arrow' : 'line'
        let [p1x, p1y, p2x, p2y] = [x1, y1, x2, y2]
        let head1 = false
        const mEnd = !!a['marker-end'] && a['marker-end'] !== 'none'
        const mStart = !!a['marker-start'] && a['marker-start'] !== 'none'
        if (type === 'arrow') head1 = mStart
        else if (!kind && (mEnd || mStart)) {
          type = 'arrow'
          if (!mEnd) [p1x, p1y, p2x, p2y] = [x2, y2, x1, y1]
          else head1 = mStart
        }
        const it: Item = { ...base(), type, pen, x1: p1x, y1: p1y, x2: p2x, y2: p2y }
        if (head1 && type === 'arrow') it.head1 = true
        return place(it, total, style)
      }
      const b = new PathBuilder()
      b.moveTo(x1, y1)
      b.lineTo(x2, y2)
      return bakedPath(b.cmds, total, style, ctx)
    }
    case 'rect': {
      const r = rectOf(num(a.x), num(a.y), num(a.width), num(a.height))
      const rx = num(a.rx || undefined, 0)
      if (simple && rx > 0) return place({ ...base(), type: 'roundrect', ...shape(), radius: rx, x: r.x, y: r.y, w: r.w, h: r.h }, total, style)
      if (simple) return place({ ...base(), type: 'rect', ...shape(), x: r.x, y: r.y, w: r.w, h: r.h }, total, style)
      const b = new PathBuilder()
      if (rx) b.addRoundedRect(r, rx, rx)
      else b.addRect(r)
      return bakedPath(b.cmds, total, style, ctx)
    }
    case 'circle':
    case 'ellipse': {
      const rx = tag === 'circle' ? num(a.r) : num(a.rx)
      const ry = tag === 'circle' ? num(a.r) : num(a.ry)
      const r = rectOf(num(a.cx) - rx, num(a.cy) - ry, 2 * rx, 2 * ry)
      if (simple) return place({ ...base(), type: 'ellipse', ...shape(), x: r.x, y: r.y, w: r.w, h: r.h }, total, style)
      return bakedPath(ellipsePath(r), total, style, ctx)
    }
    case 'polygon':
    case 'polyline': {
      const pts = parsePoints(a.points ?? '')
      if (simple) return place({ ...base(), type: 'polygon', ...shape(), kind: a[K('kind')] ?? 'polygon', points: pts }, total, style)
      const b = new PathBuilder()
      b.addPolygon(pts)
      if (tag === 'polygon') b.closeSubpath()
      return bakedPath(b.cmds, total, style, ctx)
    }
    case 'path': {
      const kind = a[K('kind')]
      if (a[K('bend')] != null && simple) {
        const [bx, by] = a[K('bend')].trim().split(/[\s,]+/).map(Number)
        const it: Item = {
          ...base(), type: kind === 'arrow' ? 'arrow' : 'line', pen: penFromStyle(style),
          x1: num(a[K('x1')]), y1: num(a[K('y1')]), x2: num(a[K('x2')]), y2: num(a[K('y2')]), bend: [bx || 0, by || 0],
        }
        if (it.type === 'arrow' && a['marker-start'] && a['marker-start'] !== 'none') it.head1 = true
        return place(it, total, style)
      }
      if ((kind === 'halfcircle' || kind === 'quartercircle') && simple) {
        return place({
          ...base(), type: 'arc', kind, ...shape(), x: num(a[K('ax')]), y: num(a[K('ay')]), w: num(a[K('aw')]), h: num(a[K('ah')]),
          flipH: a[K('flip-h')] === '1', flipV: a[K('flip-v')] === '1',
        }, total, style)
      }
      const local = pathFromD(a.d ?? '')
      if (simple) return place({ ...base(), type: 'path', ...shape(), cmds: local }, total, style)
      return bakedPath(local, total, style, ctx)
    }
    case 'text':
      return buildText(e, total, style, exact)
    case 'image':
      return buildImage(e, total, style)
  }
  return null
}


function buildText(e: XmlEl, total: Mat, style: Style, exact: boolean): TextItem {
  const text = itertext(e).trim()
  const size = Math.trunc(parseFloat((style['font-size'] ?? '14').replace(/[^\d.]/g, '')) || 14) || 14
  const weight = String(style['font-weight'] ?? '')
  const bold = weight.includes('bold') || (/^\d+$/.test(weight) && +weight >= 600)
  const family = (style['font-family'] ?? DEFAULT_FONT).split(',')[0].trim().replace(/^['"]|['"]$/g, '') || DEFAULT_FONT
  const it: TextItem = {
    ...base(), type: 'text', text, color: argbHex(svgColor(style.fill ?? '#000000')), family, size, bold, italic: style['font-style'] === 'italic',
  }
  const x = num(e.attrs.x)
  let y = num(e.attrs.y)
  if (e.attrs['dominant-baseline'] !== 'text-before-edge') y -= size * 0.8
  const p = { x: total[0] * x + total[2] * y + total[4], y: total[1] * x + total[3] * y + total[5] }
  it.pos = p
  const { deg } = decompose(total)
  if (Math.abs(deg) > EPS) {
    it.rotation = deg
    if (exact) {
      // The box's top-left lands on the anchor: pos = anchor − o + R·o.
      const o = center(qtRect({ ...it, rotation: 0 }))
      const r = rotateM(deg)
      it.pos = { x: p.x - o.x + r[0] * o.x + r[2] * o.y, y: p.y - o.y + r[1] * o.x + r[3] * o.y }
    }
  }
  if (style._opacity != null) it.opacity = parseFloat(style._opacity)
  return it
}

function buildImage(e: XmlEl, total: Mat, style: Style): Item | null {
  const href = hrefOf(e) ?? ''
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(href.trim())
  if (!m) return null
  let b64 = m[3].replace(/\s+/g, '')
  if (!m[2]) {
    try {
      b64 = btoa(unescape(b64))
    } catch {
      return null
    }
  }
  let size: { w: number; h: number } | null = null
  let mime = m[1] || 'image/png'
  try {
    const head = base64ToBytes(b64.slice(0, 40000))
    size = pngSize(head) ?? jpegSize(head)
    if (pngSize(head)) mime = 'image/png'
  } catch {
    return null
  }
  const natw = size?.w || 1
  const nath = size?.h || 1
  const x = num(e.attrs.x)
  const y = num(e.attrs.y)
  const w = num(e.attrs.width, natw)
  const h = num(e.attrs.height, nath)
  const content: Mat = [w / natw, 0, 0, h / nath, x, y]
  const full = mul(total, content)
  const it: Item = { ...base(), type: 'image', image: b64, iw: natw, ih: nath, matrix: full, pos: { x: full[4], y: full[5] } }
  // Not a PNG (or of unknown size): the app converts it once loaded.
  if (mime !== 'image/png' || !size) it.mime = mime
  if (style._opacity != null) it.opacity = parseFloat(style._opacity)
  return it
}

function readLabel(e: XmlEl, it: Item) {
  const label = e.attrs[K('label')]
  if (!label || !hasLabel(it)) return
  it.label = label
  it.labelSize = Math.trunc(num(e.attrs[K('label-size')], 14))
  it.labelFamily = e.attrs[K('label-family')] ?? DEFAULT_FONT
  it.labelBold = e.attrs[K('label-bold')] === '1'
  it.labelItalic = e.attrs[K('label-italic')] === '1'
  it.labelColor = argbHex(svgColor(e.attrs[K('label-color')] ?? '#1a1a1a'))
}

function readGroupTags(e: XmlEl, g: GroupItem) {
  const a = e.attrs
  const extra: Record<string, unknown> = {}
  const json = (v: string | undefined) => {
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  const fl = (v: string | undefined) => (v == null || !isFinite(+v) ? null : +v)
  if (a[K('model')]) {
    extra.model = a[K('model')]
    extra.model_az = fl(a[K('model-az')])
    extra.model_el = fl(a[K('model-el')])
    extra.model_bond = fl(a[K('model-bond')])
    extra.model_box = fl(a[K('model-box')])
    extra.model_repr = a[K('model-repr')] || '3d'
    const cells = json(a[K('model-cells')])
    if (cells) extra.model_cells = cells
    const colors = json(a[K('model-colors')])
    if (colors) extra.model_colors = colors
    const tilts = json(a[K('model-tilts')])
    if (tilts) extra.model_tilts = tilts
    if (a[K('model-poly')] === '1') extra.model_poly = true
    const atoms = json(a[K('model-atoms')])
    if (atoms) {
      extra.model_atoms = atoms
      extra.model_bonds = json(a[K('model-bonds')])
    }
  }
  if (a[K('symbol')]) g.symbol = a[K('symbol')]
  const solid = json(a[K('solid')])
  if (solid && typeof solid === 'object' && !Array.isArray(solid)) extra.solid = solid
  const rxn = json(a[K('reaction')])
  if (rxn && typeof rxn === 'object' && !Array.isArray(rxn)) extra.reaction = rxn
  if (Object.keys(extra).length) g.extra = extra
}

function parseElement(e: XmlEl, parentTf: Mat, inherited: Style, ctx: ReadCtx, depth = 0): Item | null {
  if (depth > 50) return null
  const tag = localName(e.tag)
  const style = resolveStyle(e, inherited)
  const total = mul(parentTf, parseTransform(e.attrs.transform))
  if (tag === 'use') {
    const href = hrefOf(e)
    if (!href?.startsWith('#')) return null
    const target = ctx.ids.get(href.slice(1))
    if (!target) return null
    const x = num(e.attrs.x || undefined)
    const y = num(e.attrs.y || undefined)
    return parseElement(target, x || y ? mul(total, translateM(x, y)) : total, style, ctx, depth + 1)
  }
  if (tag === 'g' || tag === 'symbol' || tag === 'a' || tag === 'svg') {
    const g: GroupItem = { ...base(), type: 'group', children: [] }
    // A KhervePaint group keeps its own transform (the desktop's reader
    // pushes it into the children, which misplaces rotated groups).
    const own = ctx.kp && tag === 'g' && isIdentityM(parentTf) && !!e.attrs.transform
    for (const c of e.children) {
      const sub = parseElement(c, own ? IDENTITY : total, style, ctx, depth + 1)
      if (sub) g.children.push(sub)
    }
    readGroupTags(e, g)
    if (!g.children.length) return null
    if (own) {
      const local = parseTransform(e.attrs.transform)
      const d = decompose(local)
      if (/^\s*(translate|rotate)\b/.test(e.attrs.transform!) && !/matrix|scale|skew/.test(e.attrs.transform!) && d.simple) {
        g.pos = { x: d.dx, y: d.dy }
        if (Math.abs(d.deg) > EPS) g.rotation = d.deg
      } else g.matrix = local
    }
    return g
  }
  if (tag === 'image' && e.attrs[K('role')] === 'raster') {
    const href = hrefOf(e) ?? ''
    const m = /^data:[^;,]*;base64,(.*)$/s.exec(href.trim())
    if (m) {
      const b64 = m[1].replace(/\s+/g, '')
      const size = pngSize(b64)
      if (size) ctx.raster = { w: size.w, h: size.h, src: b64, key: newRasterKey() }
    }
    return null
  }
  if (tag === 'text' && e.attrs[K('role')] === 'label') return null
  if (['defs', 'title', 'desc', 'metadata', 'style'].includes(tag)) return null
  const exact = !ctx.kp || !isIdentityM(parentTf) || /matrix|scale|skew/.test(e.attrs.transform ?? '')
  const it = buildLeaf(e, total, style, ctx, exact)
  if (it) readLabel(e, it)
  return it
}

/** Parse SVG text into a document (load_svg). */
export function parseSvg(text: string): Doc {
  const root = parseXml(text)
  const [width, height] = rootSize(root)
  const a = root.attrs
  const dpi = a[K('dpi')] != null ? Math.trunc(num(a[K('dpi')], 96)) || 96 : 96
  const grid = { mm: 1, show: false, snap: true, infinite: true }
  const gridMm = a[K('grid-mm')]
  const divisions = a[K('grid-divisions')]
  const legacy = a[K('grid-size')]
  if (gridMm != null) grid.mm = num(gridMm, 1)
  else if (divisions != null) grid.mm = (width / Math.max(Math.trunc(num(divisions, 1)), 1) / dpi) * 25.4
  else if (legacy != null) grid.mm = (num(legacy, 10) / dpi) * 25.4
  if (gridMm != null || divisions != null || legacy != null) {
    grid.show = (a[K('grid-show')] ?? '1') === '1'
    grid.snap = (a[K('grid-snap')] ?? '1') === '1'
    grid.infinite = (a[K('infinite')] ?? '0') === '1'
  }
  const ids = new Map<string, XmlEl>()
  for (const e of iter(root)) if (e.attrs.id && !ids.has(e.attrs.id)) ids.set(e.attrs.id, e)
  const kp = Object.keys(a).some((k) => k.startsWith(`{${KP_NS}}`))
  const ctx: ReadCtx = { kp, ids, gradients: scanGradients(root), raster: null }
  const baseStyle: Style = { fill: '#000000', stroke: 'none' }
  const items: Item[] = []
  for (const c of root.children) {
    const it = parseElement(c, IDENTITY, baseStyle, ctx)
    if (it) {
      it.z = items.length
      items.push(it)
    }
  }
  const raster = ctx.raster ?? blankRaster(width, height)
  return { width: raster.w, height: raster.h, dpi, grid, raster, items }
}

function rootSize(root: XmlEl): [number, number] {
  const vb = root.attrs.viewBox
  if (vb) {
    const nums = vb.trim().split(/[\s,]+/).map(Number)
    if (nums.length === 4 && nums.every(isFinite)) return [Math.max(1, Math.trunc(nums[2])), Math.max(1, Math.trunc(nums[3]))]
  }
  const dim = (v: string | undefined, d: string) => Math.max(1, Math.trunc(parseFloat((v ?? d).replace(/[^\d.]/g, '') || d) || +d))
  return [dim(root.attrs.width, '800'), dim(root.attrs.height, '600')]
}

// ---------------------------------------------------------------- path data

/** SVG path data as M/L/C commands (svgio._path_from_d, arcs as cubics). */
export function pathFromD(d: string): PathCmd[] {
  const b = new PathBuilder()
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  const n = tokens.length
  let cur: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  let prevCmd = ''
  let prevCtrl: Pt | null = null
  const numTok = () => {
    if (i >= n) throw new Error('path ended early')
    const v = parseFloat(tokens[i++])
    if (!isFinite(v)) throw new Error('bad number')
    return v
  }
  const pt = (x: number, y: number, rel: boolean): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y })
  const reflect = (c: Pt | null): Pt => (c ? { x: 2 * cur.x - c.x, y: 2 * cur.y - c.y } : { ...cur })
  try {
    while (i < n) {
      const tok = tokens[i]
      let cmd: string
      if (/^[A-Za-z]/.test(tok)) {
        cmd = tok
        i++
      } else cmd = prevCmd !== 'Z' && prevCmd !== 'z' ? prevCmd : 'L'
      const rel = cmd === cmd.toLowerCase()
      const C = cmd.toUpperCase()
      if (C === 'M') {
        cur = pt(numTok(), numTok(), rel)
        b.moveTo(cur.x, cur.y)
        start = { ...cur }
        prevCmd = rel ? 'l' : 'L'
      } else if (C === 'L') {
        cur = pt(numTok(), numTok(), rel)
        b.lineTo(cur.x, cur.y)
        prevCmd = cmd
      } else if (C === 'H') {
        const x = numTok()
        cur = { x: rel ? cur.x + x : x, y: cur.y }
        b.lineTo(cur.x, cur.y)
        prevCmd = cmd
      } else if (C === 'V') {
        const y = numTok()
        cur = { x: cur.x, y: rel ? cur.y + y : y }
        b.lineTo(cur.x, cur.y)
        prevCmd = cmd
      } else if (C === 'C') {
        const c1 = pt(numTok(), numTok(), rel)
        const c2 = pt(numTok(), numTok(), rel)
        const end = pt(numTok(), numTok(), rel)
        b.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
        prevCtrl = c2
        cur = end
        prevCmd = cmd
      } else if (C === 'S') {
        const c1: Pt = 'CS'.includes(prevCmd.toUpperCase()) && prevCmd ? reflect(prevCtrl) : { ...cur }
        const c2 = pt(numTok(), numTok(), rel)
        const end = pt(numTok(), numTok(), rel)
        b.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
        prevCtrl = c2
        cur = end
        prevCmd = cmd
      } else if (C === 'Q') {
        const c = pt(numTok(), numTok(), rel)
        const end = pt(numTok(), numTok(), rel)
        b.quadTo(c.x, c.y, end.x, end.y)
        prevCtrl = c
        cur = end
        prevCmd = cmd
      } else if (C === 'T') {
        const c: Pt = 'QT'.includes(prevCmd.toUpperCase()) && prevCmd ? reflect(prevCtrl) : { ...cur }
        const end = pt(numTok(), numTok(), rel)
        b.quadTo(c.x, c.y, end.x, end.y)
        prevCtrl = c
        cur = end
        prevCmd = cmd
      } else if (C === 'A') {
        const rx = numTok()
        const ry = numTok()
        const rot = numTok()
        const large = numTok()
        const sweep = numTok()
        const end = pt(numTok(), numTok(), rel)
        arcTo(b, cur, rx, ry, rot, large, sweep, end)
        cur = end
        prevCmd = cmd
      } else if (C === 'Z') {
        b.closeSubpath()
        cur = { ...start }
        prevCmd = cmd
      } else break
    }
  } catch {
    // Like the desktop, keep what was read before the bad token.
  }
  return b.cmds
}

/** An SVG elliptical arc appended as cubic segments (svgio._arc_to). */
function arcTo(b: PathBuilder, p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Pt) {
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    b.lineTo(p1.x, p1.y)
    return
  }
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (phiDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  if (denom === 0) {
    b.lineTo(p1.x, p1.y)
    return
  }
  const lam = (rx * rx * ry * ry) / denom
  if (lam < 1) {
    const s = Math.sqrt(lam)
    rx /= s
    ry /= s
  }
  const sign = large === sweep ? -1 : 1
  const numr = Math.max(rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, 0)
  const co = denom ? sign * Math.sqrt(numr / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)) : 0
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI
  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)))
  const delta = dtheta / segments
  const t = (4 / 3) * Math.tan(delta / 4)
  const elpt = (ox: number, oy: number, ct: number, st: number): Pt => {
    const x = rx * ct
    const y = ry * st
    return { x: ox + cosP * x - sinP * y, y: oy + sinP * x + cosP * y }
  }
  let theta = theta1
  for (let k = 0; k < segments; k++) {
    const c1 = Math.cos(theta)
    const s1 = Math.sin(theta)
    const c2 = Math.cos(theta + delta)
    const s2 = Math.sin(theta + delta)
    const e1 = elpt(cx, cy, c1, s1)
    const e2 = elpt(cx, cy, c2, s2)
    const d1 = elpt(0, 0, -s1, c1)
    const d2 = elpt(0, 0, -s2, c2)
    b.cubicTo(e1.x + t * d1.x, e1.y + t * d1.y, e2.x - t * d2.x, e2.y - t * d2.y, e2.x, e2.y)
    theta += delta
  }
}

// ------------------------------------------------------------ object files

/** Items saved as a standalone object SVG (library.save_object): moved to the origin, no raster. */
export function objectSvg(items: Item[], dpi: number): string {
  let r = null as ReturnType<typeof union>
  for (const it of items) r = union(r, mapRect(matrixOf(it), qtRect(it)))
  let moved = items
  let w = 1
  let h = 1
  if (r && (r.w > 0 || r.h > 0)) {
    moved = items.map((it) => shiftItem(it, -r!.x, -r!.y))
    w = Math.max(1, Math.ceil(r.w))
    h = Math.max(1, Math.ceil(r.h))
  }
  const doc: Doc = { width: w, height: h, dpi, grid: { mm: 1, show: false, snap: true, infinite: true }, raster: blankRaster(w, h), items: moved }
  return writeSvg(doc, { raster: null })
}

/** The item moved by (dx, dy) in its parent's coordinates. */
export function shiftItem<T extends Item>(it: T, dx: number, dy: number): T {
  if (it.type === 'image') {
    const m = it.matrix
    return { ...it, matrix: [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy], pos: { x: m[4] + dx, y: m[5] + dy } }
  }
  return { ...it, pos: { x: it.pos.x + dx, y: it.pos.y + dy } }
}

