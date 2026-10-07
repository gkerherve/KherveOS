// The KhervePaint document: a raster layer at the bottom and vector items on
// top. Items mirror the desktop's .kpaint item dicts (document.py) field for
// field, so files round-trip: positions, geometry, pen/brush, opacity,
// rotation, scale, z, and groups nesting their children. Items are immutable;
// every edit makes new objects and keeps the `_id` (selection, undo).
//
// Colours are Qt "HexArgb" strings, #aarrggbb, as the desktop writes them.

export type Mat = [number, number, number, number, number, number] // a b c d e f (SVG and Qt order)

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number]

/** Dashes are a web addition: the desktop ignores them. */
export type DashStyle = 'solid' | 'dash' | 'dot' | 'dashdot'

export interface Pen {
  color: string
  width: number
  dash?: DashStyle
}

export interface Gradient {
  kind: 'linear' | 'radial' | 'sun'
  c1: string
  c2: string
  angle: number
}

export type Brush = { color: string } | { gradient: Gradient } | null

export interface Label {
  label?: string
  labelColor?: string
  labelFamily?: string
  labelSize?: number
  labelBold?: boolean
  labelItalic?: boolean
}

interface Base {
  /** Runtime identity, never saved. */
  _id: number
  pos: Pt
  opacity: number
  rotation: number
  z: number
  scale: number
  /** Palette symbol identity, e.g. "flowchart:process". */
  symbol?: string
  /** Keys this port does not know (molecule models, solids…), kept for the desktop. */
  extra?: Record<string, unknown>
}

export interface LineItem extends Base {
  type: 'line' | 'arrow'
  pen: Pen
  x1: number
  y1: number
  x2: number
  y2: number
  /** Quadratic control point when the line is bent. */
  bend?: [number, number]
  /** Web addition: an arrowhead at the start as well. */
  head1?: boolean
}

export type DimCap = 'arrows' | 'ticks' | 'dots' | 'none'
export type DimUnit = 'mm' | 'cm' | 'in'

export interface DimensionItem extends Base {
  type: 'dimension'
  pen: Pen
  x1: number
  y1: number
  x2: number
  y2: number
  capStyle: DimCap
  extension: boolean
  dash: boolean
  unit: DimUnit
  decimals: number
  prefix: string
  suffix: string
}

export interface BoxItem extends Base, Label {
  type: 'rect' | 'ellipse'
  pen: Pen
  brush: Brush
  x: number
  y: number
  w: number
  h: number
}

export interface RoundRectItem extends Base, Label {
  type: 'roundrect'
  pen: Pen
  brush: Brush
  radius: number
  x: number
  y: number
  w: number
  h: number
}

export type ArcKind = 'halfcircle' | 'quartercircle'

export interface ArcItem extends Base, Label {
  type: 'arc'
  kind: ArcKind
  pen: Pen
  brush: Brush
  x: number
  y: number
  w: number
  h: number
  flipH: boolean
  flipV: boolean
}

export interface PolygonItem extends Base, Label {
  type: 'polygon'
  pen: Pen
  brush: Brush
  kind: string
  points: [number, number][]
}

export interface PathItem extends Base {
  type: 'path'
  pen: Pen
  brush: Brush
  cmds: PathCmd[]
}

export interface TextItem extends Base {
  type: 'text'
  text: string
  color: string
  family: string
  size: number
  bold: boolean
  italic: boolean
}

export interface ImageItem extends Base {
  type: 'image'
  /** Base64 PNG. */
  image: string
  /** Pixel size, read from the PNG header. */
  iw: number
  ih: number
  /** Local pixels to parent: the whole transform (the desktop ignores pos/rotation/scale for images). */
  matrix: Mat
  /** Set while `image` holds another format than PNG (converted after loading). */
  mime?: string
}

export interface GroupItem extends Base {
  type: 'group'
  children: Item[]
  /** Non-uniform resize folded into the group (Qt's transform()). */
  matrix?: Mat
}

export type Item = LineItem | DimensionItem | BoxItem | RoundRectItem | ArcItem | PolygonItem | PathItem | TextItem | ImageItem | GroupItem
export type ShapeItem = BoxItem | RoundRectItem | ArcItem | PolygonItem
export type FilledItem = ShapeItem | PathItem

/** The raster layer: a PNG (base64 string or Blob), or plain white. */
export interface Raster {
  w: number
  h: number
  /** null: white. A frozen canvas is turned into a PNG Blob in the background. */
  src: string | Blob | HTMLCanvasElement | null
  key: number
}

export interface Grid {
  mm: number
  show: boolean
  snap: boolean
  infinite: boolean
}

export interface Doc {
  width: number
  height: number
  dpi: number
  grid: Grid
  raster: Raster
  /** Bottom to top. */
  items: Item[]
}

export const FORMAT_VERSION = 13

export const DEFAULT_PEN_COLOR = '#ff1a1a1a'
export const DEFAULT_FILL_COLOR = '#ff4aa3ff'
export const DEFAULT_FONT = 'Segoe UI'

/** Qt points to CSS pixels: the desktop lays text out at 96 dpi. */
export const PT = 96 / 72

/** ACS single column (82.55 × 63.5 mm) at 300 dpi, the desktop's new-document size. */
export const DEFAULT_SIZE = { width: 975, height: 750, dpi: 300 }

// ------------------------------------------------------------------ ids

let nextId = 1
let nextRasterKey = 1

export const newId = () => nextId++
export const newRasterKey = () => nextRasterKey++

/** A copy of `item` (and its children) with fresh ids. */
export function cloneItem<T extends Item>(item: T): T {
  if (item.type === 'group') return { ...item, _id: newId(), children: item.children.map(cloneItem) } as T
  return { ...item, _id: newId() }
}

export function blankRaster(w: number, h: number): Raster {
  return { w, h, src: null, key: newRasterKey() }
}

export function newDoc(width = DEFAULT_SIZE.width, height = DEFAULT_SIZE.height, dpi = DEFAULT_SIZE.dpi): Doc {
  return {
    width,
    height,
    dpi,
    grid: { mm: 1, show: false, snap: true, infinite: true },
    raster: blankRaster(width, height),
    items: [],
  }
}

/** The common fields of a fresh item. */
export function base(): Base {
  return { _id: newId(), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 }
}

/** Walk every item, children first-to-last, depth first. */
export function* walk(items: Item[]): Generator<Item> {
  for (const it of items) {
    yield it
    if (it.type === 'group') yield* walk(it.children)
  }
}

export function findItem(items: Item[], id: number): Item | null {
  for (const it of walk(items)) if (it._id === id) return it
  return null
}

/** The chain of items from the top level down to `id` (inclusive), or null. */
export function itemPath(items: Item[], id: number): Item[] | null {
  for (const it of items) {
    if (it._id === id) return [it]
    if (it.type === 'group') {
      const sub = itemPath(it.children, id)
      if (sub) return [it, ...sub]
    }
  }
  return null
}

/** Replace the item with id `id` anywhere in the tree. */
export function replaceItem(items: Item[], id: number, fn: (it: Item) => Item): Item[] {
  let changed = false
  const out = items.map((it) => {
    if (it._id === id) {
      changed = true
      return fn(it)
    }
    if (it.type === 'group') {
      const children = replaceItem(it.children, id, fn)
      if (children !== it.children) {
        changed = true
        return { ...it, children }
      }
    }
    return it
  })
  return changed ? out : items
}

export const hasPen = (it: Item): it is Exclude<Item, TextItem | ImageItem | GroupItem> =>
  it.type !== 'text' && it.type !== 'image' && it.type !== 'group'

export const hasBrush = (it: Item): it is FilledItem =>
  it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc' || it.type === 'polygon' || it.type === 'path'

export const hasLabel = (it: Item): it is ShapeItem =>
  it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc' || it.type === 'polygon'

/** Human name of an item, for the status bar and menus. */
export function describe(it: Item): string {
  if (it.symbol) {
    const name = it.symbol.split(':').pop() ?? it.symbol
    return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  }
  switch (it.type) {
    case 'line': return 'Line'
    case 'arrow': return 'Arrow'
    case 'dimension': return 'Dimension'
    case 'rect': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'roundrect': return 'Rounded rectangle'
    case 'arc': return it.kind === 'halfcircle' ? 'Half circle' : 'Quarter circle'
    case 'polygon': return it.kind && it.kind !== 'polygon' ? it.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Polygon'
    case 'path': return 'Path'
    case 'text': return 'Text'
    case 'image': return 'Image'
    case 'group': return 'Group'
  }
}

// --------------------------------------------------------------- colours

export interface RGBA {
  r: number
  g: number
  b: number
  /** 0..255 */
  a: number
}

// The SVG colour keywords Qt understands (the common ones).
const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', cyan: '00ffff',
  magenta: 'ff00ff', gray: '808080', grey: '808080', darkgray: 'a9a9a9', darkgrey: 'a9a9a9', lightgray: 'd3d3d3',
  lightgrey: 'd3d3d3', silver: 'c0c0c0', maroon: '800000', olive: '808000', lime: '00ff00', aqua: '00ffff', teal: '008080',
  navy: '000080', fuchsia: 'ff00ff', purple: '800080', orange: 'ffa500', brown: 'a52a2a', pink: 'ffc0cb', gold: 'ffd700',
  indigo: '4b0082', violet: 'ee82ee', crimson: 'dc143c', coral: 'ff7f50', salmon: 'fa8072', tomato: 'ff6347',
  orchid: 'da70d6', khaki: 'f0e68c', beige: 'f5f5dc', ivory: 'fffff0', tan: 'd2b48c', chocolate: 'd2691e',
  steelblue: '4682b4', skyblue: '87ceeb', royalblue: '4169e1', darkblue: '00008b', darkred: '8b0000',
  darkgreen: '006400', lightblue: 'add8e6', lightgreen: '90ee90', forestgreen: '228b22', seagreen: '2e8b57',
  dimgray: '696969', dimgrey: '696969', slategray: '708090', whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc',
}

/** Parse a colour as Qt's QColor(str) would: #rgb, #rrggbb, #aarrggbb, names. Null if invalid. */
export function parseColor(value: string | null | undefined): RGBA | null {
  if (!value) return null
  let s = value.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (!s.startsWith('#')) {
    const hex = NAMED[s]
    if (!hex) return null
    s = '#' + hex
  }
  const h = s.slice(1)
  if (!/^[0-9a-f]+$/.test(h)) return null
  const n = (i: number, len: number) => parseInt(h.slice(i, i + len), 16)
  if (h.length === 3) return { r: n(0, 1) * 17, g: n(1, 1) * 17, b: n(2, 1) * 17, a: 255 }
  if (h.length === 6) return { r: n(0, 2), g: n(2, 2), b: n(4, 2), a: 255 }
  if (h.length === 8) return { a: n(0, 2), r: n(2, 2), g: n(4, 2), b: n(6, 2) }
  if (h.length === 9) return { r: n(0, 3) >> 4, g: n(3, 3) >> 4, b: n(6, 3) >> 4, a: 255 }
  if (h.length === 12) return { r: n(0, 4) >> 8, g: n(4, 4) >> 8, b: n(8, 4) >> 8, a: 255 }
  return null
}

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')

/** #aarrggbb, as Qt's name(QColor.HexArgb). */
export const argbHex = (c: RGBA) => `#${hex2(c.a)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

/** #rrggbb, as Qt's name(). */
export const rgbHex = (c: RGBA) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

/** Any colour string as #aarrggbb (invalid strings give the fallback). */
export function toArgb(value: string | null | undefined, fallback = '#ff000000'): string {
  const c = parseColor(value)
  return c ? argbHex(c) : fallback
}

export function colorOf(value: string): RGBA {
  return parseColor(value) ?? { r: 0, g: 0, b: 0, a: 255 }
}

export const alphaOf = (value: string) => colorOf(value).a / 255

/** A colour with its alpha replaced (0..1). */
export function withAlpha(value: string, alpha: number): string {
  return argbHex({ ...colorOf(value), a: alpha * 255 })
}

/** No stroke: a fully transparent pen (the desktop has no "no pen" in .kpaint). */
export const isNoPen = (pen: Pen) => alphaOf(pen.color) === 0

export const NO_PEN_COLOR = '#00000000'
