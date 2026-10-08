// KherveWord's document model, outside the editor: the ProseMirror JSON of the
// text (see editor/extensions.ts for the schema) and the settings around it —
// page setup, headers and footers, paragraph styles, comments. Plain
// TypeScript (no DOM, no "@/" imports): the .docx reader and writer and their
// Node tests use it.
//
// Lengths are in points (1/72 inch) unless named otherwise.

/** A ProseMirror node as JSON. */
export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: PMMark[]
  text?: string
}
export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PageSetup {
  /** A4, Letter, Legal, A5, Executive, or Custom. */
  size: string
  /** Portrait size in points (width < height); orientation swaps them. */
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number; header: number; footer: number }
}

/** A header or footer: three parts on one line. Tokens: {PAGE}, {PAGES}, {TITLE}, {DATE}. */
export interface HeaderFooter {
  left: string
  center: string
  right: string
}

export interface StyleDef {
  id: string
  /** As shown in the gallery. */
  name: string
  basedOn?: string
  /** The style of the paragraph after this one (Enter). */
  next?: string
  /** Shown in the Styles gallery. */
  quick?: boolean
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  allCaps?: boolean
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  spaceBefore?: number
  spaceAfter?: number
  /** Line spacing as a multiple of single (1, 1.15, 1.5, 2). */
  lineHeight?: number
  indentLeft?: number
  indentRight?: number
  indentFirst?: number
  /** Outline level 1–9 for headings (navigation pane, table of contents). */
  outline?: number
  borderBottom?: boolean
  shading?: string
}

export interface Comment {
  author: string
  date: string
  text: string
  done?: boolean
}

export interface DocSettings {
  page: PageSetup
  header: HeaderFooter
  footer: HeaderFooter
  /** Different header/footer on the first page: these (empty = none). */
  firstHeader?: HeaderFooter
  firstFooter?: HeaderFooter
  differentFirst: boolean
  styles: Record<string, StyleDef>
  comments: Record<string, Comment>
  title: string
  author: string
  /** Record insertions and deletions (Review › Track Changes). */
  trackChanges: boolean
  /** Spelling language, e.g. "en-GB". */
  lang: string
}

/** A whole document: the text plus its settings. */
export interface WordDoc {
  doc: PMNode
  settings: DocSettings
}

// ------------------------------------------------------------------ pages

export const PAGE_SIZES: Record<string, { width: number; height: number; label: string }> = {
  A4: { width: 595.3, height: 841.9, label: 'A4 (21 × 29.7 cm)' },
  Letter: { width: 612, height: 792, label: 'Letter (8.5 × 11 in)' },
  Legal: { width: 612, height: 1008, label: 'Legal (8.5 × 14 in)' },
  A5: { width: 419.5, height: 595.3, label: 'A5 (14.8 × 21 cm)' },
  A3: { width: 841.9, height: 1190.6, label: 'A3 (29.7 × 42 cm)' },
  Executive: { width: 522, height: 756, label: 'Executive (7.25 × 10.5 in)' },
}

export const MARGIN_PRESETS: Record<string, { top: number; right: number; bottom: number; left: number; label: string }> = {
  Normal: { top: 72, right: 72, bottom: 72, left: 72, label: 'Normal (2.54 cm)' },
  Narrow: { top: 36, right: 36, bottom: 36, left: 36, label: 'Narrow (1.27 cm)' },
  Moderate: { top: 72, right: 54, bottom: 72, left: 54, label: 'Moderate' },
  Wide: { top: 72, right: 144, bottom: 72, left: 144, label: 'Wide (5.08 cm)' },
}

export const PT_PER_CM = 72 / 2.54
export const PX_PER_PT = 96 / 72

export function defaultPage(size = 'A4'): PageSetup {
  const s = PAGE_SIZES[size] ?? PAGE_SIZES.A4
  return {
    size: PAGE_SIZES[size] ? size : 'A4',
    width: s.width,
    height: s.height,
    orientation: 'portrait',
    margins: { top: 72, right: 72, bottom: 72, left: 72, header: 35.4, footer: 35.4 },
  }
}

/** Page width and height as laid out (orientation applied). */
export function pageDims(p: PageSetup): { w: number; h: number } {
  return p.orientation === 'landscape' ? { w: p.height, h: p.width } : { w: p.width, h: p.height }
}

/** Width of the text between the left and right margins. */
export function contentWidth(p: PageSetup): number {
  return pageDims(p).w - p.margins.left - p.margins.right
}

// ------------------------------------------------------------------ styles

export const BODY_FONT = 'Calibri'
export const HEADING_FONT = 'Calibri Light'

/** Word's built-in styles (2013+ look), as KherveWord shows them. */
export function defaultStyles(): Record<string, StyleDef> {
  const list: StyleDef[] = [
    { id: 'Normal', name: 'Normal', quick: true, font: BODY_FONT, size: 11, spaceAfter: 8, lineHeight: 1.08, color: '#000000' },
    { id: 'NoSpacing', name: 'No Spacing', basedOn: 'Normal', quick: true, spaceAfter: 0, lineHeight: 1 },
    { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quick: true, font: HEADING_FONT, size: 28, spaceAfter: 0, lineHeight: 1 },
    { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quick: true, size: 11, color: '#5a5a5a', spaceAfter: 8 },
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quick: true, font: HEADING_FONT, size: 16, color: '#2f5496', spaceBefore: 12, spaceAfter: 0, outline: 1 },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quick: true, font: HEADING_FONT, size: 13, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, outline: 2 },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quick: true, font: HEADING_FONT, size: 12, color: '#1f3763', spaceBefore: 2, spaceAfter: 0, outline: 3 },
    { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quick: true, font: HEADING_FONT, italic: true, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, outline: 4 },
    { id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quick: false, font: HEADING_FONT, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, outline: 5 },
    { id: 'Heading6', name: 'Heading 6', basedOn: 'Normal', next: 'Normal', quick: false, font: HEADING_FONT, color: '#1f3763', spaceBefore: 2, spaceAfter: 0, outline: 6 },
    { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quick: true, italic: true, color: '#404040', align: 'center', spaceBefore: 10, indentLeft: 43.2, indentRight: 43.2 },
    { id: 'IntenseQuote', name: 'Intense Quote', basedOn: 'Normal', next: 'Normal', quick: true, italic: true, color: '#4472c4', align: 'center', spaceBefore: 18, spaceAfter: 18, indentLeft: 43.2, indentRight: 43.2, borderBottom: true },
    { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quick: false, italic: true, size: 9, color: '#44546a', spaceAfter: 10, lineHeight: 1 },
    { id: 'Code', name: 'Code', basedOn: 'Normal', quick: true, font: 'Consolas', size: 10, spaceAfter: 0, lineHeight: 1, shading: '#f2f2f2' },
    { id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quick: false, indentLeft: 36 },
  ]
  return Object.fromEntries(list.map((s) => [s.id, s]))
}

/** A style with what it inherits (basedOn chain) filled in. */
export function resolveStyle(styles: Record<string, StyleDef>, id: string): StyleDef {
  const chain: StyleDef[] = []
  const seen = new Set<string>()
  let cur: StyleDef | undefined = styles[id] ?? styles.Normal
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = cur.basedOn ? styles[cur.basedOn] : undefined
  }
  const out: StyleDef = { id, name: styles[id]?.name ?? id }
  for (const s of chain) {
    for (const [k, v] of Object.entries(s)) if (v !== undefined && k !== 'id' && k !== 'name' && k !== 'quick' && k !== 'next' && k !== 'basedOn') (out as unknown as Record<string, unknown>)[k] = v
  }
  return out
}

/** Heading level (1–9) of a paragraph style, or 0. */
export function outlineLevel(styles: Record<string, StyleDef>, id: string): number {
  if (id === 'Title') return 0
  return resolveStyle(styles, id).outline ?? 0
}

// ------------------------------------------------------------------ settings

export function emptyHF(): HeaderFooter {
  return { left: '', center: '', right: '' }
}

export function hfIsEmpty(h: HeaderFooter | undefined): boolean {
  return !h || (!h.left.trim() && !h.center.trim() && !h.right.trim())
}

export function defaultSettings(pageSize = 'A4'): DocSettings {
  return {
    page: defaultPage(pageSize),
    header: emptyHF(),
    footer: emptyHF(),
    differentFirst: false,
    styles: defaultStyles(),
    comments: {},
    title: '',
    author: '',
    trackChanges: false,
    lang: 'en-GB',
  }
}

export function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'Normal' } }] }
}

// ------------------------------------------------------------------ walking

/** Every node, depth first, with its parent. Return false to skip a node's content. */
export function walk(node: PMNode, fn: (n: PMNode, parent: PMNode | null) => boolean | void, parent: PMNode | null = null) {
  if (fn(node, parent) === false) return
  for (const c of node.content ?? []) walk(c, fn, node)
}

/** The plain text of a node (tabs and line breaks kept; deleted text left out). */
export function nodeText(n: PMNode): string {
  if (n.type === 'text') return n.marks?.some((m) => m.type === 'deletion') ? '' : (n.text ?? '')
  if (n.type === 'hardBreak') return '\n'
  if (n.type === 'equation') return String(n.attrs?.latex ?? '')
  if (n.type === 'footnote') return ''
  // Paragraphs, list items and cells are separate lines.
  return (n.content ?? []).map(nodeText).join(n.type === 'paragraph' ? '' : '\n')
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-_.]*/gu)
  return m ? m.length : 0
}

/** Headings (outline level ≥ 1) in document order: text, level. */
export function headingsOf(doc: PMNode, styles: Record<string, StyleDef>): { text: string; level: number }[] {
  const out: { text: string; level: number }[] = []
  walk(doc, (n) => {
    if (n.type === 'paragraph') {
      const level = outlineLevel(styles, String(n.attrs?.style ?? 'Normal'))
      if (level >= 1) out.push({ text: nodeText(n).trim(), level })
      return false
    }
    if (n.type === 'table') return false
  })
  return out.filter((h) => h.text)
}

/** Expand the tokens of a header/footer part. */
export function expandTokens(s: string, page: number, pages: number, title: string, date = new Date()): string {
  return s
    .replace(/\{PAGE\}/gi, String(page))
    .replace(/\{PAGES\}|\{NUMPAGES\}/gi, String(pages))
    .replace(/\{TITLE\}/gi, title)
    .replace(/\{DATE\}/gi, date.toLocaleDateString())
}

// ------------------------------------------------------------------ fonts

/** Fonts offered in the font box. Each maps to a CSS stack with metric-compatible fallbacks. */
export const FONTS = [
  'Calibri', 'Calibri Light', 'Aptos', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Cambria', 'Verdana', 'Tahoma',
  'Trebuchet MS', 'Segoe UI', 'Courier New', 'Consolas', 'Comic Sans MS', 'Palatino', 'Book Antiqua', 'Century Gothic', 'Liberation Serif',
  'Liberation Sans', 'Liberation Mono',
]

const SERIF = new Set(['Times New Roman', 'Georgia', 'Garamond', 'Cambria', 'Palatino', 'Book Antiqua', 'Liberation Serif'])
const MONO = new Set(['Courier New', 'Consolas', 'Liberation Mono'])

/** A CSS font-family value for a document font. */
export function fontStack(font: string): string {
  const q = (f: string) => (/[^a-zA-Z0-9-]/.test(f) ? `'${f.replace(/'/g, '')}'` : f)
  // The TypoPRO Liberation fonts ship with KherveOS: same widths as Arial, Times and Courier.
  if (MONO.has(font)) return `${q(font)}, 'Liberation Mono', 'TypoPRO Liberation Mono', 'Courier New', monospace`
  if (SERIF.has(font)) return `${q(font)}, 'Liberation Serif', 'TypoPRO Liberation Serif', 'Times New Roman', serif`
  if (font === 'Calibri' || font === 'Calibri Light' || font === 'Aptos') return `${q(font)}, Carlito, 'Liberation Sans', 'TypoPRO Liberation Sans', Arial, sans-serif`
  return `${q(font)}, 'Liberation Sans', 'TypoPRO Liberation Sans', Arial, sans-serif`
}

export function isSerif(font: string): boolean {
  return SERIF.has(font)
}

export function isMono(font: string): boolean {
  return MONO.has(font)
}

// ------------------------------------------------------------------ colours

/** Word's highlight colours (w:highlight names) and their RGB. */
export const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080',
  darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080',
  lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
}

export function normColor(c: unknown): string | null {
  if (typeof c !== 'string' || !c) return null
  const s = c.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`
  const m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`
  const named = HIGHLIGHTS[c] ?? NAMED[s]
  return named ?? null
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080',
  orange: '#ffa500', purple: '#800080', navy: '#000080', teal: '#008080', maroon: '#800000', silver: '#c0c0c0', lime: '#00ff00', aqua: '#00ffff',
  fuchsia: '#ff00ff', olive: '#808000',
}

/** The nearest Word highlight name for a colour (exact matches only), else null. */
export function highlightName(color: string): string | null {
  const c = normColor(color)
  for (const [name, hex] of Object.entries(HIGHLIGHTS)) if (hex === c) return name
  return null
}

/** A unique id for comments and tracked changes. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}
