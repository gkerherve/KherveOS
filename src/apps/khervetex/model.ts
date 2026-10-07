// The KherveTeX document model: a port of khervedoc/model.py (the desktop
// KherveTeX). document.json inside a .ktex is this tree, written exactly as
// the desktop writes it (same fields, same order, same JSON layout), so a
// document moves between the desktop and KherveOS without changes.

export type Mark =
  | 'bold' | 'italic' | 'underline' | 'code' | 'smallcaps' | 'subscript' | 'superscript' | 'strikethrough'

/** The order the desktop editor lists marks in when it saves. */
export const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline', 'strikethrough', 'smallcaps', 'code', 'subscript', 'superscript']

// ------------------------------------------------------------------ inlines

export interface Text { type: 'Text'; text: string; marks: Mark[] }
export interface MathInline { type: 'MathInline'; latex: string }
export interface Link { type: 'Link'; url: string; children: Inline[] }
export interface Footnote { type: 'Footnote'; children: Inline[] }
/** style: cite / citep / citet (imports may bring others, e.g. citealp). */
export interface Citation { type: 'Citation'; keys: string[]; style: string }
/** kind: ref / eqref / pageref. */
export interface CrossRef { type: 'CrossRef'; label: string; kind: string }
/** Verbatim LaTeX inside a line (unknown macros, \\Kstroke, a \\\\ break). */
export interface InlineRaw { type: 'InlineRaw'; latex: string }
export interface Highlight { type: 'Highlight'; children: Inline[]; color: string }
export interface Comment {
  type: 'Comment'; children: Inline[]; note: string; author: string; timestamp: string; resolved: boolean
}

export type Inline = Text | MathInline | Link | Footnote | Citation | CrossRef | InlineRaw | Highlight | Comment

/** Highlight colours (name → hex), as the desktop offers them. */
export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FFFF00',
  green: '#90EE90',
  blue: '#ADD8E6',
  pink: '#FFB6C1',
  orange: '#FFD700',
}

// ------------------------------------------------------------------- blocks

export type Alignment = 'left' | 'center' | 'right' | 'justify'

export interface Paragraph { type: 'Paragraph'; children: Inline[]; alignment: string }
/** level 0 = chapter, 1..5 = Heading 1..5 (section … subparagraph). */
export interface Section { type: 'Section'; level: number; children: Inline[]; numbered: boolean; label: string | null }
export interface MathBlock { type: 'MathBlock'; latex: string; numbered: boolean; label: string | null }
export interface ListItem { type: 'ListItem'; children: Inline[] }
export interface List { type: 'List'; ordered: boolean; items: ListItem[] }
/** source: "" (a picture), "drawing" or "flowchart" (a PNG preview with vector siblings). */
export interface Figure { type: 'Figure'; path: string; caption: string; label: string | null; width: string; source: string }
/** Cells are raw LaTeX. style: "" (\\hline rules) or "booktabs". */
export interface Table { type: 'Table'; rows: string[][]; caption: string; label: string | null; alignment: string; style: string }
export interface RawLatex { type: 'RawLatex'; text: string }
export interface Title { type: 'Title'; children: Inline[] }
export interface Author { type: 'Author'; children: Inline[] }
export interface Affiliation { type: 'Affiliation'; children: Inline[] }
export interface Correspondence { type: 'Correspondence'; children: Inline[] }
export interface Abstract { type: 'Abstract'; children: Inline[] }
export interface Keywords { type: 'Keywords'; children: Inline[] }
/** A beamer slide; the blocks after it, up to the next Frame, are its content. */
export interface Frame { type: 'Frame'; children: Inline[] }

export type Block =
  | Paragraph | Section | MathBlock | List | Figure | Table | RawLatex
  | Title | Author | Affiliation | Correspondence | Abstract | Keywords | Frame

/** The text-line styles that hold only inline content (no other fields). */
export type TextLineType = 'Title' | 'Author' | 'Affiliation' | 'Correspondence' | 'Abstract' | 'Keywords' | 'Frame'
export const TEXT_LINE_TYPES: TextLineType[] = ['Title', 'Author', 'Affiliation', 'Correspondence', 'Abstract', 'Keywords', 'Frame']

// ---------------------------------------------------------------- the document

/** amssymb: the equation templates use \\square as a placeholder. */
export const DEFAULT_PACKAGES = ['amsmath', 'amssymb', 'graphicx', 'multicol', 'float']

export interface DocMeta {
  title: string
  author: string
  documentclass: string
  /** Raw \\documentclass options; for standard classes the serializer adds size and columns itself. */
  class_options: string
  packages: string[]
  page_size: string
  margin_top_cm: number
  margin_bottom_cm: number
  margin_left_cm: number
  margin_right_cm: number
  body_font_pt: number
  /** "default" (Computer Modern), times, palatino, helvetica, courier, charter, libertine. */
  body_font_family: string
  /** The editor's font only; not in the LaTeX. */
  visual_font_family: string
  line_spacing: number
  paragraph_indent: boolean
  /** 1, 2 (twocolumn) or 3 (multicols). */
  column_count: number
  /** Verbatim LaTeX inside \\begin{frontmatter} (Elsevier) or before \\maketitle. */
  frontmatter_extras: string
  /** Verbatim LaTeX at the end of the preamble (\\lstset, \\newcommand…). */
  preamble_extras: string
  /** The KherveRef library the citations come from (a desktop folder). */
  ref_library: string
  bib_style: string
}

export interface Document { type: 'Document'; children: Block[]; meta: DocMeta }

export const FLOAT_META_FIELDS = new Set(['margin_top_cm', 'margin_bottom_cm', 'margin_left_cm', 'margin_right_cm', 'line_spacing'])

export function defaultMeta(overrides: Partial<DocMeta> = {}): DocMeta {
  return {
    title: 'Untitled',
    author: '',
    documentclass: 'article',
    class_options: '',
    packages: [...DEFAULT_PACKAGES],
    page_size: 'A4',
    margin_top_cm: 2.5,
    margin_bottom_cm: 2.5,
    margin_left_cm: 2.5,
    margin_right_cm: 2.5,
    body_font_pt: 12,
    body_font_family: 'default',
    visual_font_family: 'Georgia',
    line_spacing: 1.0,
    paragraph_indent: true,
    column_count: 1,
    frontmatter_extras: '',
    preamble_extras: '',
    ref_library: '',
    bib_style: 'plainnat',
    ...overrides,
  }
}

// ------------------------------------------------------------- constructors

export const text = (t: string, marks: Mark[] = []): Text => ({ type: 'Text', text: t, marks })
export const paragraph = (children: Inline[] = [], alignment: string = 'justify'): Paragraph => ({ type: 'Paragraph', children, alignment })
export const section = (level: number, children: Inline[], numbered = true, label: string | null = null): Section =>
  ({ type: 'Section', level, children, numbered, label })

/** File ▸ New: the desktop's blank document (examples.blank). */
export function blankDocument(): Document {
  return {
    type: 'Document',
    children: [
      { type: 'Title', children: [text('Untitled')] },
      { type: 'Author', children: [] },
      paragraph([text('Start writing here.')], 'justify'),
    ],
    meta: defaultMeta({ title: '', author: '', body_font_pt: 11, line_spacing: 1.15, paragraph_indent: false }),
  }
}

// ------------------------------------------------------- reading document.json
// Mirrors model.from_json, including its defaults (a Paragraph without an
// alignment is "left", a missing column_count falls back to the old
// two_column flag…).

type Dict = Record<string, unknown>

/** Python's str() for the odd non-string value. */
function pyStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

/** Python's bool(). */
function pyBool(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === 'object') return Object.keys(v).length > 0
  return !!v
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function int(v: unknown, fallback: number): number {
  return Math.trunc(num(v, fallback))
}

function get<T>(d: Dict, key: string, fallback: T): unknown {
  return key in d && d[key] !== undefined ? d[key] : fallback
}

function inlinesFromJson(items: unknown): Inline[] {
  return Array.isArray(items) ? items.map((i) => inlineFromJson(i as Dict)) : []
}

export function inlineFromJson(d: Dict): Inline {
  const t = d.type
  switch (t) {
    case 'Text':
      return { type: 'Text', text: pyStr(d.text), marks: Array.isArray(d.marks) ? (d.marks as Mark[]).slice() : [] }
    case 'MathInline':
      return { type: 'MathInline', latex: pyStr(d.latex) }
    case 'Link':
      return { type: 'Link', url: pyStr(get(d, 'url', '')), children: inlinesFromJson(d.children) }
    case 'Footnote':
      return { type: 'Footnote', children: inlinesFromJson(d.children) }
    case 'Citation':
      return { type: 'Citation', keys: Array.isArray(d.keys) ? d.keys.map(pyStr) : [], style: pyStr(get(d, 'style', 'cite')) }
    case 'CrossRef':
      return { type: 'CrossRef', label: pyStr(get(d, 'label', '')), kind: pyStr(get(d, 'kind', 'ref')) }
    case 'InlineRaw':
      return { type: 'InlineRaw', latex: pyStr(get(d, 'latex', '')) }
    case 'Highlight':
      return { type: 'Highlight', children: inlinesFromJson(d.children), color: pyStr(get(d, 'color', 'yellow')) }
    case 'Comment':
      return {
        type: 'Comment', children: inlinesFromJson(d.children), note: pyStr(get(d, 'note', '')),
        author: pyStr(get(d, 'author', '')), timestamp: pyStr(get(d, 'timestamp', '')), resolved: pyBool(get(d, 'resolved', false)),
      }
  }
  throw new Error(`Unknown inline node type: ${JSON.stringify(t)}`)
}

function optLabel(v: unknown): string | null {
  return v === undefined || v === null ? null : pyStr(v)
}

export function blockFromJson(d: Dict): Block {
  const t = d.type
  switch (t) {
    case 'Paragraph':
      return { type: 'Paragraph', children: inlinesFromJson(d.children), alignment: pyStr(get(d, 'alignment', 'left')) }
    case 'Section':
      return {
        type: 'Section', level: int(get(d, 'level', 1), 1), children: inlinesFromJson(d.children),
        numbered: pyBool(get(d, 'numbered', true)), label: optLabel(d.label),
      }
    case 'MathBlock':
      return { type: 'MathBlock', latex: pyStr(d.latex ?? ''), numbered: pyBool(get(d, 'numbered', false)), label: optLabel(d.label) }
    case 'List':
      return {
        type: 'List', ordered: pyBool(get(d, 'ordered', false)),
        items: (Array.isArray(d.items) ? d.items : []).map((it) => ({ type: 'ListItem', children: inlinesFromJson((it as Dict).children) })),
      }
    case 'Figure':
      return {
        type: 'Figure', path: pyStr(get(d, 'path', '')), caption: pyStr(get(d, 'caption', '')), label: optLabel(d.label),
        width: pyStr(get(d, 'width', '0.8\\textwidth')), source: pyStr(get(d, 'source', '')),
      }
    case 'Table':
      return {
        type: 'Table', rows: (Array.isArray(d.rows) ? d.rows : []).map((r) => (Array.isArray(r) ? r.map(pyStr) : [])),
        caption: pyStr(get(d, 'caption', '')), label: optLabel(d.label), alignment: pyStr(get(d, 'alignment', '')),
        style: pyStr(get(d, 'style', '')),
      }
    case 'RawLatex':
      return { type: 'RawLatex', text: pyStr(d.text ?? '') }
    case 'Title': case 'Author': case 'Affiliation': case 'Correspondence': case 'Abstract': case 'Keywords': case 'Frame':
      return { type: t, children: inlinesFromJson(d.children) }
  }
  throw new Error(`Unknown block node type: ${JSON.stringify(t)}`)
}

export function metaFromJson(m: Dict): DocMeta {
  return {
    title: pyStr(get(m, 'title', 'Untitled')),
    author: pyStr(get(m, 'author', '')),
    documentclass: pyStr(get(m, 'documentclass', 'article')),
    class_options: pyStr(get(m, 'class_options', '')),
    packages: Array.isArray(m.packages) ? m.packages.map(pyStr) : [...DEFAULT_PACKAGES],
    page_size: pyStr(get(m, 'page_size', 'A4')),
    margin_top_cm: num(get(m, 'margin_top_cm', 2.5), 2.5),
    margin_bottom_cm: num(get(m, 'margin_bottom_cm', 2.5), 2.5),
    margin_left_cm: num(get(m, 'margin_left_cm', 2.5), 2.5),
    margin_right_cm: num(get(m, 'margin_right_cm', 2.5), 2.5),
    body_font_pt: int(get(m, 'body_font_pt', 12), 12),
    body_font_family: pyStr(get(m, 'body_font_family', 'default')),
    visual_font_family: typeof m.visual_font_family === 'string' ? m.visual_font_family : 'Georgia',
    line_spacing: num(get(m, 'line_spacing', 1.0), 1.0),
    paragraph_indent: pyBool(get(m, 'paragraph_indent', true)),
    // v0.17 stored a boolean two_column; v0.18+ stores column_count.
    column_count: int(get(m, 'column_count', pyBool(get(m, 'two_column', false)) ? 2 : 1), 1),
    frontmatter_extras: pyStr(get(m, 'frontmatter_extras', '')),
    preamble_extras: pyStr(get(m, 'preamble_extras', '')),
    ref_library: pyStr(get(m, 'ref_library', '')),
    bib_style: pyStr(get(m, 'bib_style', 'plainnat')),
  }
}

export function documentFromJson(d: Dict): Document {
  const meta = d.meta && typeof d.meta === 'object' ? (d.meta as Dict) : {}
  return {
    type: 'Document',
    children: (Array.isArray(d.children) ? d.children : []).map((b) => blockFromJson(b as Dict)),
    meta: metaFromJson(meta),
  }
}

export function fromJson(s: string): Document {
  const d = JSON.parse(s) as unknown
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Not a KherveTeX document')
  return documentFromJson(d as Dict)
}

// ------------------------------------------------------- writing document.json
// json.dumps(asdict(doc), indent=2, ensure_ascii=False): fields in dataclass
// order, floats written the Python way ("2.0", "1e-05").

class PyFloat {
  value: number
  constructor(value: number) {
    this.value = value
  }
}

/** Python's repr() of a float. */
export function pyFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const [mant, expStr] = x.toExponential().split('e')
  const e = Number(expStr)
  const sign = mant.startsWith('-') ? '-' : ''
  const digits = mant.replace('-', '').replace('.', '')
  if (e < -4 || e >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
    return `${sign}${m}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }
  if (e >= 0) {
    const intPart = digits.slice(0, e + 1).padEnd(e + 1, '0')
    return `${sign}${intPart}.${digits.slice(e + 1) || '0'}`
  }
  return `${sign}0.${'0'.repeat(-e - 1)}${digits}`
}

function dumps(v: unknown, indent: string): string {
  if (v instanceof PyFloat) return pyFloat(v.value)
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v)
  if (typeof v === 'string') return JSON.stringify(v)
  const inner = indent + '  '
  if (Array.isArray(v)) {
    if (!v.length) return '[]'
    return '[\n' + v.map((x) => inner + dumps(x, inner)).join(',\n') + '\n' + indent + ']'
  }
  const entries = Object.entries(v as Dict)
  if (!entries.length) return '{}'
  return '{\n' + entries.map(([k, x]) => inner + JSON.stringify(k) + ': ' + dumps(x, inner)).join(',\n') + '\n' + indent + '}'
}

/** json.dumps(..., indent=2, ensure_ascii=False) for plain values. */
export function pyJson(v: unknown): string {
  return dumps(v, '')
}

function inlineToJson(n: Inline): Dict {
  switch (n.type) {
    case 'Text': return { text: n.text, marks: [...n.marks], type: 'Text' }
    case 'MathInline': return { latex: n.latex, type: 'MathInline' }
    case 'Link': return { url: n.url, children: n.children.map(inlineToJson), type: 'Link' }
    case 'Footnote': return { children: n.children.map(inlineToJson), type: 'Footnote' }
    case 'Citation': return { keys: [...n.keys], style: n.style, type: 'Citation' }
    case 'CrossRef': return { label: n.label, kind: n.kind, type: 'CrossRef' }
    case 'InlineRaw': return { latex: n.latex, type: 'InlineRaw' }
    case 'Highlight': return { children: n.children.map(inlineToJson), color: n.color, type: 'Highlight' }
    case 'Comment':
      return {
        children: n.children.map(inlineToJson), note: n.note, author: n.author, timestamp: n.timestamp,
        resolved: n.resolved, type: 'Comment',
      }
  }
}

function blockToJson(b: Block): Dict {
  switch (b.type) {
    case 'Paragraph': return { children: b.children.map(inlineToJson), alignment: b.alignment, type: 'Paragraph' }
    case 'Section': return { level: b.level, children: b.children.map(inlineToJson), numbered: b.numbered, label: b.label, type: 'Section' }
    case 'MathBlock': return { latex: b.latex, numbered: b.numbered, label: b.label, type: 'MathBlock' }
    case 'List':
      return { ordered: b.ordered, items: b.items.map((it) => ({ children: it.children.map(inlineToJson), type: 'ListItem' })), type: 'List' }
    case 'Figure': return { path: b.path, caption: b.caption, label: b.label, width: b.width, source: b.source, type: 'Figure' }
    case 'Table': return { rows: b.rows.map((r) => [...r]), caption: b.caption, label: b.label, alignment: b.alignment, style: b.style, type: 'Table' }
    case 'RawLatex': return { text: b.text, type: 'RawLatex' }
    default: return { children: b.children.map(inlineToJson), type: b.type }
  }
}

export function metaToJson(m: DocMeta): Dict {
  return {
    title: m.title,
    author: m.author,
    documentclass: m.documentclass,
    class_options: m.class_options,
    packages: [...m.packages],
    page_size: m.page_size,
    margin_top_cm: new PyFloat(m.margin_top_cm),
    margin_bottom_cm: new PyFloat(m.margin_bottom_cm),
    margin_left_cm: new PyFloat(m.margin_left_cm),
    margin_right_cm: new PyFloat(m.margin_right_cm),
    body_font_pt: Math.trunc(m.body_font_pt),
    body_font_family: m.body_font_family,
    visual_font_family: m.visual_font_family,
    line_spacing: new PyFloat(m.line_spacing),
    paragraph_indent: m.paragraph_indent,
    column_count: Math.trunc(m.column_count),
    frontmatter_extras: m.frontmatter_extras,
    preamble_extras: m.preamble_extras,
    ref_library: m.ref_library,
    bib_style: m.bib_style,
  }
}

export function toJson(doc: Document): string {
  return pyJson({ children: doc.children.map(blockToJson), meta: metaToJson(doc.meta), type: 'Document' })
}

// --------------------------------------------------------------- walking

/** Every inline below `nodes`, depth first. */
export function* walkInlines(nodes: Inline[]): Generator<Inline> {
  for (const n of nodes) {
    yield n
    if (n.type === 'Link' || n.type === 'Footnote' || n.type === 'Highlight' || n.type === 'Comment') yield* walkInlines(n.children)
  }
}

/** Every inline of the document, in reading order (like references._walk). */
export function* documentInlines(doc: Document): Generator<Inline> {
  for (const b of doc.children) {
    if (b.type === 'List') for (const it of b.items) yield* walkInlines(it.children)
    else if ('children' in b) yield* walkInlines(b.children)
  }
}

/** Every cited key, in order of first citation (kherveref_link.cited_keys). */
export function citedKeys(doc: Document): string[] {
  const keys: string[] = []
  for (const n of documentInlines(doc)) {
    if (n.type === 'Citation') for (const k of n.keys) if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

/** Plain text of some inlines (for display and search). */
export function plainText(nodes: Inline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'Text': out += n.text; break
      case 'MathInline': out += `$${n.latex}$`; break
      case 'InlineRaw': out += n.latex; break
      case 'Citation': out += `[${n.keys.join(',')}]`; break
      case 'CrossRef': out += `<${n.kind}:${n.label}>`; break
      case 'Footnote': break
      default: out += plainText(n.children)
    }
  }
  return out
}

// ------------------------------------------------- chapter-capable classes

const CHAPTER_CLASSES = [
  'report', 'book', 'memoir', 'scrreprt', 'scrbook', 'mimosis', 'hepthesis', 'suftesi', 'toptesi', 'disser', 'amsbook', 'elegantbook',
]

/** True when the document class defines \\chapter (model.class_supports_chapter). */
export function classSupportsChapter(className: string): boolean {
  if (!className) return false
  const head = className.toLowerCase().split(',')[0].trim()
  return CHAPTER_CLASSES.some((c) => head.startsWith(c))
}

// ------------------------------------------------------------- projects
// A multi-document project (model.Project): its main .ktex holds project.json,
// which lists the documents (.ktex files in the same folder).

export interface ChapterEntry {
  path: string
  label: string
  enabled: boolean
  start_page: number | null
  last_known_pages: number
  numbering: 'arabic' | 'roman'
  chapter_type: string
  chapter_number: number | null
}

export interface Project {
  meta: DocMeta
  chapters: ChapterEntry[]
  bibliography: string
  bib_style: string
  auto_page_numbers: boolean
}

export function chapterEntry(over: Partial<ChapterEntry> = {}): ChapterEntry {
  return {
    path: '', label: '', enabled: true, start_page: null, last_known_pages: 0, numbering: 'arabic', chapter_type: 'chapter',
    chapter_number: null, ...over,
  }
}

/** model.project_to_json. */
export function projectToJson(p: Project): string {
  return pyJson({
    type: 'Project',
    meta: metaToJson(p.meta),
    chapters: p.chapters.map((c) => ({
      path: c.path, label: c.label, enabled: c.enabled, start_page: c.start_page, last_known_pages: Math.trunc(c.last_known_pages),
      numbering: c.numbering, chapter_type: c.chapter_type, chapter_number: c.chapter_number,
    })),
    bibliography: p.bibliography,
    bib_style: p.bib_style,
    auto_page_numbers: p.auto_page_numbers,
  })
}

/** model.project_from_json. */
export function projectFromJson(s: string): Project {
  const d = JSON.parse(s) as Dict
  if (!d || d.type !== 'Project') throw new Error('Not a project manifest')
  const md = d.meta && typeof d.meta === 'object' ? (d.meta as Dict) : {}
  const meta = metaFromJson({ documentclass: 'book', ...md })
  const chapters = (Array.isArray(d.chapters) ? d.chapters : []).map((x) => {
    const c = x as Dict
    const sp = c.start_page
    const cn = c.chapter_number
    return chapterEntry({
      path: pyStr(get(c, 'path', '')),
      label: pyStr(get(c, 'label', '')),
      enabled: pyBool(get(c, 'enabled', true)),
      start_page: typeof sp === 'number' ? sp : null,
      last_known_pages: int(get(c, 'last_known_pages', 0), 0),
      numbering: c.numbering === 'roman' ? 'roman' : 'arabic',
      chapter_type: pyStr(get(c, 'chapter_type', 'chapter')),
      chapter_number: typeof cn === 'number' ? cn : null,
    })
  })
  return {
    meta, chapters,
    bibliography: pyStr(get(d, 'bibliography', '')),
    bib_style: pyStr(get(d, 'bib_style', '')),
    auto_page_numbers: pyBool(get(d, 'auto_page_numbers', true)),
  }
}
