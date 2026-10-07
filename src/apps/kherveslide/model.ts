// KherveSlide's presentation model — a port of the desktop's
// kherveslide/model.py, the single source of truth: the canvas, the slide
// sorter and the LaTeX serializer all read and write through it.
//
// Geometry is normalised: x, y, w, h are fractions 0..1 of the slide (inside
// the deck's margin "gap"), (0, 0) top-left. Z-order is the order of
// Slide.objects (later = on top).
//
// Files are .kslide: the JSON the desktop writes (`json.dumps(asdict(deck),
// indent=2, ensure_ascii=False)`). fromJson() reads a file exactly as the
// desktop's deck_from_json() does (same defaults, the same migrations) and
// toJson() writes it byte for byte as deck_to_json() would, floats as "1.0"
// included, so files go back and forth between the two apps unchanged.
//
// No DOM here: the Node tests load this file directly.

// ------------------------------------------------------------------ types

export interface BoxFrame {
  fill: string
  fill2: string
  gradient: string
  border_color: string
  border_width: number
  corner: string
  border_style: string
  fill_opacity: number
  shadow: boolean
  corner_radius: number
}

export interface SlideText extends BoxFrame {
  type: 'SlideText'
  x: number
  y: number
  w: number
  h: number
  text: string
  font_pt: number
  font_family: string
  color: string
  align: string
  bold: boolean
  italic: boolean
  locked: boolean
  block: string
  block_title: string
  group: number
}

export interface PictureEffects {
  brightness: number
  contrast: number
  sharpness: number
  saturation: number
  temperature: number
  recolor: string
  recolor_color: string
  artistic: string
  artistic_amount: number
  fade: string
  fade_start: number
  fade_end: number
  soft_edge: number
  glow_color: string
  glow_size: number
  reflection: number
  mask: string
}

export interface SlidePicture extends BoxFrame, PictureEffects {
  type: 'SlidePicture'
  x: number
  y: number
  w: number
  h: number
  path: string
  keep_aspect: boolean
  opacity: number
  crop_l: number
  crop_t: number
  crop_r: number
  crop_b: number
  rotation: number
  locked: boolean
  group: number
}

export interface SlideTable extends BoxFrame {
  type: 'SlideTable'
  x: number
  y: number
  w: number
  h: number
  rows: string[][]
  font_pt: number
  color: string
  border: boolean
  header: boolean
  caption: string
  align: string
  grid: string
  rule_color: string
  rule_width: number
  header_bg: string
  header_fg: string
  striped: boolean
  stripe_color: string
  locked: boolean
  group: number
}

export interface SlideLine {
  type: 'SlideLine'
  x: number
  y: number
  w: number
  h: number
  color: string
  width_pt: number
  arrow_start: boolean
  arrow_end: boolean
  style: string
  opacity: number
  head_size: number
  curve: number[]
  locked: boolean
  group: number
}

export interface SlideShape {
  type: 'SlideShape'
  x: number
  y: number
  w: number
  h: number
  shape: string
  fill: string
  fill2: string
  gradient: string
  border_color: string
  border_width: number
  style: string
  corner: string
  opacity: number
  rotation: number
  locked: boolean
  group: number
}

export interface SlideVideo {
  type: 'SlideVideo'
  x: number
  y: number
  w: number
  h: number
  path: string
  poster: string
  locked: boolean
  group: number
}

export type SlideObject = SlideText | SlidePicture | SlideTable | SlideLine | SlideShape | SlideVideo
export type ObjectType = SlideObject['type']

export interface Slide {
  objects: SlideObject[]
  title: string
  bg: string
  bg_alpha: number
  free: boolean
  type: 'Slide'
  hidden: boolean
}

export interface ThemeSpec {
  enabled: boolean
  inner: string
  outer: string
  fonts: string
  font_family: string
  bullets: string
  structure: string
  text_fg: string
  canvas_bg: string
  canvas_bg2: string
  title_fg: string
  title_bg: string
  block_bg: string
  frametitle_size: string
  title_rule: boolean
  footline_rule: boolean
  rule_color: string
  rule_width: number
  footer_bar: boolean
  logo: string
  logo_corner: string
  logo_size: number
  type: 'ThemeSpec'
}

export interface Deck {
  slides: Slide[]
  title: string
  author: string
  theme: string
  color_theme: string
  aspect: string
  template: string
  plain_frames: boolean
  page_w_cm: number
  page_h_cm: number
  gap: number
  nav_symbols: boolean
  page_number: string
  header: string
  foot_left: string
  foot_center: string
  foot_right: string
  theme_spec: ThemeSpec
  master: Slide
  type: 'Deck'
}

// ------------------------------------------------------------------ schemas
// Every dataclass as [field, kind, dataclass default] in the desktop's field
// order (that order is the key order of the saved JSON).
//   f float · i int · b bool · s str · rows list[list[str]] · curve list[float]

type Kind = 'f' | 'i' | 'b' | 's' | 'rows' | 'curve'
type Field = readonly [string, Kind, unknown]

const FRAME: Field[] = [
  ['fill', 's', ''], ['fill2', 's', ''], ['gradient', 's', 'vertical'], ['border_color', 's', ''], ['border_width', 'f', 1.0],
  ['corner', 's', 'sharp'], ['border_style', 's', 'solid'], ['fill_opacity', 'f', 1.0], ['shadow', 'b', false], ['corner_radius', 'f', 4.0],
]

export const PICTURE_EFFECTS: Field[] = [
  ['brightness', 'f', 0.0], ['contrast', 'f', 0.0], ['sharpness', 'f', 0.0], ['saturation', 'f', 1.0], ['temperature', 'f', 0.0],
  ['recolor', 's', ''], ['recolor_color', 's', ''], ['artistic', 's', ''], ['artistic_amount', 'f', 0.5], ['fade', 's', ''],
  ['fade_start', 'f', 0.0], ['fade_end', 'f', 0.5], ['soft_edge', 'f', 0.0], ['glow_color', 's', ''], ['glow_size', 'f', 0.0],
  ['reflection', 'f', 0.0], ['mask', 's', ''],
]

export const TABLE_HEADER_BG = '#FCE4D6'
export const TABLE_HEADER_FG = '#C55A11'
export const TABLE_RULE = '#F4B183'
export const TABLE_CAPTION_FG = '#808080'

const SCHEMAS: Record<ObjectType, Field[]> = {
  SlideText: [
    ['x', 'f', 0.1], ['y', 'f', 0.1], ['w', 'f', 0.4], ['h', 'f', 0.15], ['text', 's', 'Text'], ['font_pt', 'i', 20], ['font_family', 's', ''],
    ['color', 's', '#000000'], ['fill', 's', ''], ['fill2', 's', ''], ['gradient', 's', 'vertical'], ['align', 's', 'left'], ['bold', 'b', false],
    ['italic', 'b', false], ['border_color', 's', ''], ['border_width', 'f', 1.0], ['corner', 's', 'sharp'], ['border_style', 's', 'solid'],
    ['fill_opacity', 'f', 1.0], ['shadow', 'b', false], ['corner_radius', 'f', 4.0], ['locked', 'b', false], ['block', 's', ''],
    ['block_title', 's', ''], ['group', 'i', 0],
  ],
  SlidePicture: [
    ['x', 'f', 0.1], ['y', 'f', 0.1], ['w', 'f', 0.3], ['h', 'f', 0.3], ['path', 's', ''], ['keep_aspect', 'b', true], ['opacity', 'f', 1.0],
    ['crop_l', 'f', 0.0], ['crop_t', 'f', 0.0], ['crop_r', 'f', 0.0], ['crop_b', 'f', 0.0], ['rotation', 'f', 0.0],
    ...FRAME,
    ...PICTURE_EFFECTS,
    ['locked', 'b', false], ['group', 'i', 0],
  ],
  SlideTable: [
    ['x', 'f', 0.1], ['y', 'f', 0.1], ['w', 'f', 0.5], ['h', 'f', 0.25], ['rows', 'rows', null], ['font_pt', 'i', 18], ['color', 's', '#000000'],
    ['border', 'b', true], ['header', 'b', true], ['caption', 's', ''], ['align', 's', 'left'], ['grid', 's', 'all'], ['rule_color', 's', TABLE_RULE],
    ['rule_width', 'f', 0.8], ['header_bg', 's', TABLE_HEADER_BG], ['header_fg', 's', TABLE_HEADER_FG], ['striped', 'b', false],
    ['stripe_color', 's', '#F5F5F5'],
    ...FRAME,
    ['locked', 'b', false], ['group', 'i', 0],
  ],
  SlideLine: [
    ['x', 'f', 0.3], ['y', 'f', 0.4], ['w', 'f', 0.4], ['h', 'f', 0.0], ['color', 's', '#000000'], ['width_pt', 'f', 1.5],
    ['arrow_start', 'b', false], ['arrow_end', 'b', false], ['style', 's', 'solid'], ['opacity', 'f', 1.0], ['head_size', 'f', 1.0],
    ['curve', 'curve', null], ['locked', 'b', false], ['group', 'i', 0],
  ],
  SlideShape: [
    ['x', 'f', 0.3], ['y', 'f', 0.3], ['w', 'f', 0.28], ['h', 'f', 0.22], ['shape', 's', 'rect'], ['fill', 's', ''], ['fill2', 's', ''],
    ['gradient', 's', 'vertical'], ['border_color', 's', '#000000'], ['border_width', 'f', 1.5], ['style', 's', 'solid'], ['corner', 's', 'sharp'],
    ['opacity', 'f', 1.0], ['rotation', 'f', 0.0], ['locked', 'b', false], ['group', 'i', 0],
  ],
  SlideVideo: [
    ['x', 'f', 0.25], ['y', 'f', 0.25], ['w', 'f', 0.5], ['h', 'f', 0.45], ['path', 's', ''], ['poster', 's', ''], ['locked', 'b', false],
    ['group', 'i', 0],
  ],
}

/** Where deck_from_json's own default differs from the dataclass default. */
const LOAD_DEFAULTS: Partial<Record<ObjectType, Record<string, unknown>>> = {
  SlideText: { text: '', locked: true },
  SlidePicture: { locked: true },
  SlideTable: { locked: true },
  SlideLine: { locked: true },
}

const SLIDE: Field[] = [['title', 's', ''], ['bg', 's', ''], ['bg_alpha', 'f', 1.0], ['free', 'b', true]]

const THEME_SPEC: Field[] = [
  ['enabled', 'b', false], ['inner', 's', ''], ['outer', 's', ''], ['fonts', 's', ''], ['font_family', 's', ''], ['bullets', 's', ''],
  ['structure', 's', ''], ['text_fg', 's', ''], ['canvas_bg', 's', ''], ['canvas_bg2', 's', ''], ['title_fg', 's', ''], ['title_bg', 's', ''],
  ['block_bg', 's', ''], ['frametitle_size', 's', ''], ['title_rule', 'b', false], ['footline_rule', 'b', false], ['rule_color', 's', ''],
  ['rule_width', 'f', 1.5], ['footer_bar', 'b', false], ['logo', 's', ''], ['logo_corner', 's', 'tr'], ['logo_size', 'f', 0.12],
]

const DECK: Field[] = [
  ['title', 's', 'Presentation'], ['author', 's', ''], ['theme', 's', 'default'], ['color_theme', 's', ''], ['aspect', 's', '169'],
  ['template', 's', 'Blank'], ['plain_frames', 'b', false], ['page_w_cm', 'f', 0.0], ['page_h_cm', 'f', 0.0], ['gap', 'f', 0.0],
  ['nav_symbols', 'b', true], ['page_number', 's', 'none'], ['header', 's', ''], ['foot_left', 's', ''], ['foot_center', 's', ''],
  ['foot_right', 's', ''],
]

const FIELD_KIND: Record<string, Record<string, Kind>> = Object.fromEntries(
  Object.entries(SCHEMAS).map(([t, fields]) => [t, Object.fromEntries(fields.map(([n, k]) => [n, k]))]),
)

/** The kind of an object's field ('f' float, 'i' int, 'b' bool, 's' text…), or undefined. */
export function fieldKind(type: ObjectType, field: string): Kind | undefined {
  return FIELD_KIND[type]?.[field]
}

// ------------------------------------------------------------------ Python's conversions

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Python's bool(v). */
function pyBool(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (isObj(v)) return Object.keys(v).length > 0
  return !!v
}

/** Python's float(v) (strings are parsed; anything unreadable is an error, as there). */
function pyFloat(v: unknown, field: string): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    if (!Number.isNaN(n)) return n
  }
  throw new Error(`"${field}" should be a number, not ${JSON.stringify(v)}`)
}

/** Python's int(v): truncates floats. */
function pyInt(v: unknown, field: string): number {
  if (typeof v === 'string' && !/^\s*[-+]?\d+\s*$/.test(v)) throw new Error(`"${field}" should be a whole number, not ${JSON.stringify(v)}`)
  return Math.trunc(pyFloat(v, field))
}

/** Python's str(v). */
function pyStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v)
  return JSON.stringify(v)
}

function convert(kind: Kind, v: unknown, field: string): unknown {
  switch (kind) {
    case 'f':
      return pyFloat(v, field)
    case 'i':
      return pyInt(v, field)
    case 'b':
      return pyBool(v)
    case 's':
      return pyStr(v)
    default:
      return v
  }
}

/** A file imported from PowerPoint by desktop v0.141–0.143 stored empty lines as \mbox{}. */
function plainBlankLines(text: string): string {
  if (!text.includes('\\mbox{}')) return text
  return text
    .split('\n')
    .map((ln) => (ln.trim() === '\\mbox{}' ? '' : ln))
    .join('\n')
}

const get = (d: Obj, key: string, dflt: unknown) => (key in d ? d[key] : dflt)

/** One slide object from its JSON (the desktop's _build_object). */
export function buildObject(d: unknown): SlideObject {
  if (!isObj(d)) throw new Error('A slide object is not a JSON object')
  const t = d.type as ObjectType
  const schema = SCHEMAS[t]
  if (!schema) throw new Error(`Unknown slide object type: ${JSON.stringify(d.type ?? null)}`)
  const over = LOAD_DEFAULTS[t] ?? {}
  const out: Obj = {}
  for (const [name, kind, dflt] of schema) {
    const fallback = name in over ? over[name] : dflt
    if (kind === 'rows') {
      const rows = pyBool(d.rows) ? d.rows : [['', ''], ['', '']]
      out.rows = (Array.isArray(rows) ? rows : []).map((row) => (Array.isArray(row) ? row : [row]).map(pyStr))
    } else if (kind === 'curve') {
      const c = Array.isArray(d.curve) ? d.curve : []
      out.curve = c.map((v) => pyFloat(v, 'curve')).slice(0, Math.floor(c.length / 6) * 6)
    } else out[name] = convert(kind, get(d, name, fallback), name)
  }
  if (t === 'SlideText') out.text = plainBlankLines(out.text as string)
  if (t === 'SlideTable') {
    // The legacy on/off "border" flag becomes the richer "grid".
    const border = pyBool(get(d, 'border', true))
    out.border = border
    out.grid = pyStr(get(d, 'grid', '')) || (border ? 'all' : 'none')
  }
  out.type = t
  return out as unknown as SlideObject
}

function buildSlide(d: unknown): Slide {
  const s = isObj(d) ? d : {}
  // Locking moved from the slide ("free") to each object ("locked"): an old
  // free slide had freely placed objects, an old standard slide beamer-placed ones.
  const slideFree = pyBool(get(s, 'free', true))
  const objects: SlideObject[] = []
  for (const od of Array.isArray(s.objects) ? s.objects : []) {
    const obj = buildObject(od)
    if (!isObj(od) || !('locked' in od)) obj.locked = !slideFree
    objects.push(obj)
  }
  return {
    objects,
    title: pyStr(get(s, 'title', '')),
    bg: pyStr(get(s, 'bg', '')),
    bg_alpha: pyFloat(get(s, 'bg_alpha', 1.0), 'bg_alpha'),
    free: slideFree,
    type: 'Slide',
    hidden: pyBool(get(s, 'hidden', false)),
  }
}

function buildThemeSpec(d: unknown): ThemeSpec {
  const s = isObj(d) ? d : {}
  const out: Obj = {}
  for (const [name, kind, dflt] of THEME_SPEC) out[name] = convert(kind, get(s, name, dflt), name)
  out.type = 'ThemeSpec'
  return out as unknown as ThemeSpec
}

/** A deck from parsed JSON (the desktop's _build_deck). Throws when it isn't a presentation. */
export function buildDeck(d: unknown): Deck {
  if (!isObj(d) || d.type !== 'Deck') throw new Error('Not a KherveSlide presentation (no "type": "Deck").')
  const out: Obj = { slides: (Array.isArray(d.slides) ? d.slides : []).map(buildSlide) }
  for (const [name, kind, dflt] of DECK) out[name] = convert(kind, get(d, name, dflt), name)
  out.theme_spec = buildThemeSpec(get(d, 'theme_spec', {}))
  out.master = buildSlide(get(d, 'master', {}))
  out.type = 'Deck'
  return out as unknown as Deck
}

/** Read a .kslide file's text. */
export function fromJson(text: string): Deck {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return buildDeck(raw)
}

// ------------------------------------------------------------------ writing (json.dumps, indent=2)

/** A value written as a Python float ("1.0", "1e-05"). */
class PyFloat {
  readonly v: number
  constructor(v: number) {
    this.v = v
  }
}

/** Python's repr() of a float. */
export function pyFloatRepr(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity'
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0'
  const [mant, expStr] = v.toExponential().split('e')
  const exp = Number(expStr)
  if (exp < -4 || exp >= 16) return `${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  const s = String(v) // fixed notation in this range
  return s.includes('.') ? s : `${s}.0`
}

function typed(fields: readonly Field[], src: Obj, out: Obj) {
  for (const [name, kind] of fields) {
    const v = src[name]
    if (kind === 'f') out[name] = new PyFloat(Number(v))
    else if (kind === 'curve') out[name] = (Array.isArray(v) ? v : []).map((x) => new PyFloat(Number(x)))
    else if (kind === 'rows') out[name] = (Array.isArray(v) ? v : []).map((r) => (Array.isArray(r) ? r.map(String) : []))
    else if (kind === 'i') out[name] = Math.trunc(Number(v) || 0)
    else if (kind === 'b') out[name] = !!v
    else out[name] = String(v ?? '')
  }
}

function objectOut(o: SlideObject): Obj {
  const out: Obj = {}
  typed(SCHEMAS[o.type], o as unknown as Obj, out)
  out.type = o.type
  return out
}

function slideOut(s: Slide): Obj {
  const out: Obj = { objects: s.objects.map(objectOut) }
  typed(SLIDE, s as unknown as Obj, out)
  out.type = 'Slide'
  out.hidden = !!s.hidden
  return out
}

function deckOut(deck: Deck): Obj {
  const out: Obj = { slides: deck.slides.map(slideOut) }
  typed(DECK, deck as unknown as Obj, out)
  const spec: Obj = {}
  typed(THEME_SPEC, deck.theme_spec as unknown as Obj, spec)
  spec.type = 'ThemeSpec'
  out.theme_spec = spec
  out.master = slideOut(deck.master)
  out.type = 'Deck'
  return out
}

/** Python's json.dumps(value, indent=2, ensure_ascii=False). */
function pyDumps(v: unknown, level = 0): string {
  const pad = (n: number) => '  '.repeat(n)
  if (v instanceof PyFloat) return pyFloatRepr(v.v)
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloatRepr(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return `[\n${v.map((x) => pad(level + 1) + pyDumps(x, level + 1)).join(',\n')}\n${pad(level)}]`
  }
  const entries = Object.entries(v as Obj)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([k, x]) => `${pad(level + 1)}${JSON.stringify(k)}: ${pyDumps(x, level + 1)}`).join(',\n')}\n${pad(level)}}`
}

/** The .kslide text, exactly as the desktop's deck_to_json writes it. */
export function toJson(deck: Deck): string {
  return pyDumps(deckOut(deck))
}

/** One object as JSON-ready data (clipboard copy). */
export function objectToData(o: SlideObject): Obj {
  return JSON.parse(JSON.stringify(o)) as Obj
}

// ------------------------------------------------------------------ constructors

/** A new object of `type` with the desktop's defaults, then `fields`. */
export function makeObject<T extends ObjectType>(type: T, fields: Partial<Extract<SlideObject, { type: T }>> = {}): Extract<SlideObject, { type: T }> {
  const out: Obj = {}
  for (const [name, kind, dflt] of SCHEMAS[type]) {
    if (kind === 'rows') out[name] = [['', ''], ['', '']]
    else if (kind === 'curve') out[name] = []
    else out[name] = dflt
  }
  out.type = type
  return { ...out, ...fields } as unknown as Extract<SlideObject, { type: T }>
}

export function makeSlide(fields: Partial<Slide> = {}): Slide {
  return { objects: [], title: '', bg: '', bg_alpha: 1.0, free: true, type: 'Slide', hidden: false, ...fields }
}

export function makeThemeSpec(fields: Partial<ThemeSpec> = {}): ThemeSpec {
  const out: Obj = {}
  for (const [name, , dflt] of THEME_SPEC) out[name] = dflt
  return { ...(out as unknown as ThemeSpec), type: 'ThemeSpec', ...fields }
}

export function makeDeck(fields: Partial<Deck> = {}): Deck {
  const out: Obj = {}
  for (const [name, , dflt] of DECK) out[name] = dflt
  return {
    ...(out as unknown as Deck),
    slides: [],
    theme_spec: makeThemeSpec(),
    master: makeSlide(),
    type: 'Deck',
    ...fields,
  }
}

/** A deep copy (objects are plain data). */
export function cloneDeck(deck: Deck): Deck {
  return structuredClone(deck)
}

// ------------------------------------------------------------------ helpers

/** A line's points in slide fractions: end 1, then each Bézier segment's two controls and end (just the two ends if straight). */
export function linePath(line: SlideLine): [number, number][] {
  const x0 = line.x
  const y0 = line.y
  const pts: [number, number][] = [[x0, y0]]
  const c = line.curve ?? []
  if (c.length < 6) return [...pts, [x0 + line.w, y0 + line.h]]
  for (let i = 0; i < c.length - (c.length % 6); i += 2) pts.push([x0 + c[i] * line.w, y0 + c[i + 1] * line.h])
  return pts
}

/** `hex` at `alpha` over white, as a solid #RRGGBB (the slide page is white). */
export function blendOverWhite(hex: string, alpha: number): string {
  const h = (hex || '').replace(/^#/, '')
  if (h.length !== 6) return hex
  const a = Math.max(0, Math.min(1, alpha))
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  if (n.some(Number.isNaN)) return hex
  // Python's round() rounds halves to even.
  const r = (v: number) => {
    const f = Math.floor(v)
    const d = v - f
    return d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f
  }
  return '#' + n.map((c) => r(c * a + 255 * (1 - a)).toString(16).toUpperCase().padStart(2, '0')).join('')
}

// Z-order (later = on top). Each returns the object's new index.
export function raiseObject(slide: Slide, i: number): number {
  if (i >= 0 && i < slide.objects.length - 1) {
    ;[slide.objects[i], slide.objects[i + 1]] = [slide.objects[i + 1], slide.objects[i]]
    return i + 1
  }
  return i
}
export function lowerObject(slide: Slide, i: number): number {
  if (i > 0 && i < slide.objects.length) {
    ;[slide.objects[i], slide.objects[i - 1]] = [slide.objects[i - 1], slide.objects[i]]
    return i - 1
  }
  return i
}
export function toFront(slide: Slide, i: number): number {
  if (i < 0 || i >= slide.objects.length) return i
  slide.objects.push(...slide.objects.splice(i, 1))
  return slide.objects.length - 1
}
export function toBack(slide: Slide, i: number): number {
  if (i < 0 || i >= slide.objects.length) return i
  slide.objects.unshift(...slide.objects.splice(i, 1))
  return 0
}

/** What the user calls an object. */
export const OBJECT_LABEL: Record<ObjectType, string> = {
  SlideText: 'text box',
  SlidePicture: 'picture',
  SlideTable: 'table',
  SlideLine: 'line / arrow',
  SlideShape: 'shape',
  SlideVideo: 'video',
}

/** The slide's text for lists and AI tools: frame title or first text box. */
export function slideHeading(s: Slide): string {
  if (s.title.trim()) return s.title.trim()
  const t = s.objects.find((o): o is SlideText => o.type === 'SlideText' && !!o.text.trim() && !o.text.trim().startsWith('\\begin'))
  return t ? t.text.trim().split('\n')[0] : ''
}
