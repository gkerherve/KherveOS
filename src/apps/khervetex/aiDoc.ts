// KherveTeX documents as the AI tools see them (khervetex_* in
// src/os/ai/appManifest.ts; the tools themselves are aiTools.ts). Plain
// functions on the document model — no editor, no React — so Node can test
// them:  node --test tools/tests/khervetex-ai.test.ts
//
// As in the desktop KherveTeX's MCP tools (khervedoc/mcp_tools.py), the
// document is a flat list of top-level blocks (headings, paragraphs,
// equations, lists, figures, tables, raw LaTeX…) addressed by index, and new
// content goes in as LaTeX that is parsed into real, editable blocks — the
// way File › Import LaTeX and the Code tab read LaTeX.

import {
  classSupportsChapter, plainText, text, type Block, type DocMeta, type Document, type Inline,
} from './model'
import { serializeBlock, serializeDocument, serializeInlines } from './serializer'
import { adoptSerializerPreamble, consumeBraced, importTex, parseInlines } from './importer'

export interface OutlineEntry {
  index: number
  type: string
  /** Headings: 1 = top level. */
  level?: number
  text: string
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** A short text of a block, for the outline. */
export function blockPreview(b: Block, n = 90): string {
  switch (b.type) {
    case 'List':
      return clip(b.items.map((it) => `• ${plainText(it.children)}`).join(' '), n)
    case 'MathBlock':
      return clip(b.latex, n)
    case 'Figure':
      return clip(`${b.path}${b.caption ? ` — ${b.caption}` : ''}`, n)
    case 'Table':
      return clip(`${b.rows.length}×${Math.max(0, ...b.rows.map((r) => r.length))} table${b.caption ? ` — ${b.caption}` : ''}`, n)
    case 'RawLatex':
      return clip(b.text, n)
    default:
      return clip(plainText(b.children), n)
  }
}

/** Every top-level block with its index, type and a short preview. */
export function outline(doc: Document): OutlineEntry[] {
  return doc.children.map((b, index) => ({
    index,
    type: b.type,
    ...(b.type === 'Section' && { level: b.level }),
    text: blockPreview(b),
  }))
}

/** The LaTeX of one block, as the model can write it back (title and author lines as \title / \author). */
export function blockLatex(b: Block, meta: DocMeta): string {
  if (b.type === 'Title') return `\\title{${serializeInlines(b.children)}}\n`
  if (b.type === 'Author') return `\\author{${serializeInlines(b.children)}}\n`
  if (b.type === 'Affiliation' || b.type === 'Correspondence') return `% ${b.type}: ${serializeInlines(b.children)}\n`
  return serializeBlock(b, { hasChapters: classSupportsChapter(meta.documentclass) })
}

/** start..end inclusive, checked against the document. */
export function checkRange(doc: Document, start: unknown, end: unknown, allowEmptyDoc = false): [number, number] {
  const n = doc.children.length
  const s = typeof start === 'number' && Number.isFinite(start) ? Math.round(start) : NaN
  const e = end === undefined || end === null ? s : typeof end === 'number' && Number.isFinite(end) ? Math.round(end) : NaN
  if (Number.isNaN(s) || Number.isNaN(e)) throw new Error('"start" and "end" must be block numbers from khervetex_get_document.')
  if (!n && allowEmptyDoc) return [0, -1]
  if (s < 0 || e >= n || s > e) throw new Error(`Blocks ${s}..${e} are not in the document: it has blocks 0..${n - 1}.`)
  return [s, e]
}

/** The LaTeX of blocks start..end. */
export function blocksLatex(doc: Document, start: number, end: number): { index: number; type: string; latex: string }[] {
  const out = []
  for (let i = start; i <= end; i++) out.push({ index: i, type: doc.children[i].type, latex: blockLatex(doc.children[i], doc.meta) })
  return out
}

/** Does this LaTeX have its own preamble (a whole document) rather than being body text? */
export const isWholeDocument = (latex: string) => /\\documentclass\b|\\begin\{document\}/.test(latex)

/** Take `\cmd{…}` out of `src`: [what is left, the argument or null]. */
function pullCommand(src: string, cmd: string): [string, string | null] {
  const re = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\]\\s*)?(?=\\{)`)
  const m = re.exec(src)
  if (!m) return [src, null]
  const [arg, end] = consumeBraced(src, m.index + m[0].length)
  if (arg === null) return [src, null]
  return [src.slice(0, m.index) + src.slice(end), arg]
}

/**
 * LaTeX body source → blocks, the way the Code tab reads it. \title{…} and
 * \author{…} become the title and author lines.
 */
export function parseBody(latex: string, meta: DocMeta): Block[] {
  let rest = latex.replace(/\r\n?/g, '\n')
  if (isWholeDocument(rest)) {
    const m = /\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/.exec(rest)
    rest = m ? m[1] : rest.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/, '')
  }
  let title: string | null
  let author: string | null
  ;[rest, title] = pullCommand(rest, 'title')
  ;[rest, author] = pullCommand(rest, 'author')
  const pre = `${title !== null ? `\\title{${title}}\n` : ''}${author !== null ? `\\author{${author}}\n` : ''}`
  const source = `\\documentclass{${meta.documentclass || 'article'}}\n${pre}\\begin{document}\n${rest}\n\\end{document}\n`
  return importTex(source).children
}

/**
 * The whole document from LaTeX. A complete .tex file (with \documentclass)
 * also sets the class, packages, page and fonts, as the Code tab does; body
 * text alone keeps the current settings.
 */
export function documentFromLatex(latex: string, current: DocMeta): Document {
  if (!latex.trim()) throw new Error('The LaTeX is empty.')
  if (!isWholeDocument(latex)) return { type: 'Document', meta: { ...current }, children: parseBody(latex, current) }
  const doc = adoptSerializerPreamble(importTex(latex, { unwrapColumns: true }))
  // What LaTeX does not carry stays as it was (KherveTeX.applyCode).
  const meta: DocMeta = { ...doc.meta, visual_font_family: current.visual_font_family, ref_library: current.ref_library, bib_style: current.bib_style }
  return { ...doc, meta }
}

/** Blocks start..end replaced by `blocks` (a new document). */
export function spliceBlocks(doc: Document, start: number, deleteCount: number, blocks: Block[]): Document {
  const children = doc.children.slice()
  children.splice(start, deleteCount, ...blocks)
  return { ...doc, children }
}

/** Where "after" puts new blocks: after that block, -1 = at the very start, missing = at the end. */
export function insertIndex(doc: Document, after: unknown): number {
  if (after === undefined || after === null) return doc.children.length
  const a = typeof after === 'number' && Number.isFinite(after) ? Math.round(after) : NaN
  if (Number.isNaN(a) || a < -1 || a >= doc.children.length) throw new Error(`"after" must be -1..${doc.children.length - 1} (a block number, -1 = at the start).`)
  return a + 1
}

// ----------------------------------------------------------- find / replace

function replaceIn(s: string, find: string, by: string, caseSensitive: boolean, budget: { left: number; count: number }): string {
  if (!budget.left) return s
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
  return s.replace(re, (m) => {
    if (!budget.left) return m
    budget.left--
    budget.count++
    return by
  })
}

function replaceInlines(nodes: Inline[], f: (s: string) => string): Inline[] {
  return nodes.map((n) => {
    if (n.type === 'Text') {
      const t = f(n.text)
      return t === n.text ? n : { ...n, text: t }
    }
    if (n.type === 'Link' || n.type === 'Footnote' || n.type === 'Highlight' || n.type === 'Comment') return { ...n, children: replaceInlines(n.children, f) }
    return n
  })
}

/**
 * Find and replace plain text in the document's text (each text run on its
 * own, so formatting stays), table cells and captions. Returns the new
 * document and how many were replaced.
 */
export function replaceText(doc: Document, find: string, by: string, opts: { all?: boolean; caseSensitive?: boolean } = {}): { doc: Document; count: number } {
  if (!find) throw new Error('"find" is empty.')
  const budget = { left: opts.all === false ? 1 : Infinity, count: 0 }
  const f = (s: string) => replaceIn(s, find, by, !!opts.caseSensitive, budget)
  const children = doc.children.map((b): Block => {
    switch (b.type) {
      case 'List':
        return { ...b, items: b.items.map((it) => ({ ...it, children: replaceInlines(it.children, f) })) }
      case 'Table':
        return { ...b, caption: f(b.caption), rows: b.rows.map((r) => r.map(f)) }
      case 'Figure':
        return { ...b, caption: f(b.caption) }
      case 'MathBlock':
      case 'RawLatex':
        return b
      default:
        return { ...b, children: replaceInlines(b.children, f) }
    }
  })
  return { doc: { ...doc, children }, count: budget.count }
}

// ----------------------------------------------------------- settings

export interface MetaPatch {
  title?: string
  author?: string
  documentclass?: string
  body_font_pt?: number
  page_size?: string
  add_packages?: string[]
}

const inlinesOf = (s: string): Inline[] => {
  const inl = parseInlines(s)
  return inl.length ? inl : s ? [text(s)] : []
}

/** Title, author and document settings. The title and author are the document's title / author lines. */
export function setMetadata(doc: Document, patch: MetaPatch): { doc: Document; changed: string[] } {
  const changed: string[] = []
  let children = doc.children.slice()
  const meta = { ...doc.meta, packages: [...doc.meta.packages] }
  if (typeof patch.title === 'string') {
    const at = children.findIndex((b) => b.type === 'Title')
    const block: Block = { type: 'Title', children: inlinesOf(patch.title.trim()) }
    if (at >= 0) children[at] = block
    else children = [block, ...children]
    meta.title = ''
    changed.push('title')
  }
  if (typeof patch.author === 'string') {
    const lines = patch.author.split(/\s*\\\\\s*|\n/).map((l) => l.trim()).filter(Boolean)
    const blocks: Block[] = (lines.length ? lines : ['']).map((l) => ({ type: 'Author', children: inlinesOf(l) }))
    const first = children.findIndex((b) => b.type === 'Author')
    children = children.filter((b) => b.type !== 'Author')
    const at = first >= 0 ? first : children.findIndex((b) => b.type === 'Title') + 1
    children.splice(at, 0, ...blocks)
    meta.author = ''
    changed.push('author')
  }
  if (typeof patch.documentclass === 'string' && patch.documentclass.trim()) {
    meta.documentclass = patch.documentclass.trim()
    changed.push('documentclass')
  }
  if (typeof patch.body_font_pt === 'number') {
    if (![10, 11, 12].includes(patch.body_font_pt)) throw new Error('body_font_pt must be 10, 11 or 12.')
    meta.body_font_pt = patch.body_font_pt
    changed.push('body_font_pt')
  }
  if (typeof patch.page_size === 'string' && patch.page_size.trim()) {
    const p = patch.page_size.trim()
    meta.page_size = /^[a-z]\d$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    changed.push('page_size')
  }
  if (Array.isArray(patch.add_packages)) {
    for (const p of patch.add_packages) {
      const name = String(p).trim()
      if (name && !meta.packages.includes(name)) meta.packages.push(name)
    }
    changed.push('packages')
  }
  return { doc: { ...doc, meta, children }, changed }
}

// ----------------------------------------------------------- reading

/** What khervetex_get_document returns about the document itself. */
export function describeDocument(doc: Document, opts: { maxChars?: number; latex?: boolean } = {}) {
  const title = doc.children.find((b) => b.type === 'Title')
  const authors = doc.children.filter((b) => b.type === 'Author')
  const words = doc.children.reduce((n, b) => n + (blockPreview(b, 1e9).match(/\S+/g)?.length ?? 0), 0)
  const out: Record<string, unknown> = {
    title: title && 'children' in title ? plainText(title.children) : doc.meta.title,
    author: authors.length ? authors.map((a) => ('children' in a ? plainText(a.children) : '')).join('; ') : doc.meta.author,
    documentclass: doc.meta.documentclass,
    page_size: doc.meta.page_size,
    body_font_pt: doc.meta.body_font_pt,
    packages: doc.meta.packages,
    blocks: doc.children.length,
    words,
    outline: outline(doc),
  }
  if (opts.latex !== false) {
    const tex = serializeDocument(doc)
    const max = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : 30_000
    out.latex = tex.length > max ? `${tex.slice(0, max)}\n% … (${tex.length - max} more characters: read them with khervetex_read_blocks)` : tex
  }
  return out
}

/**
 * LaTeX as a model sent it. Small models (Ollama) often escape it twice, so
 * every command arrives as `\\section` and newlines as a literal `\n`; read that
 * way, the preamble ends up printed in the document. When no command has a
 * single backslash, the doubling is undone (a real `\\` line break then arrives
 * as `\\\\` and comes back as `\\`).
 */
export function modelLatex(v: unknown): string {
  let s = String(v ?? '')
  const doubled = (s.match(/(?<!\\)\\\\[a-zA-Z]/g) ?? []).length
  // Single-backslash commands, leaving out \n \t \r (escaped line breaks and tabs).
  const single = (s.match(/(?<!\\)\\[a-mo-qsu-zA-Z]/g) ?? []).length
  if (doubled > 0 && single === 0) {
    const un: Record<string, string> = { '\\': '\\', n: '\n', t: '\t', r: '', '"': '"' }
    s = s.replace(/\\(\\|n|t|r|")/g, (_, c: string) => un[c])
  } else if (!s.includes('\n') && /\\n(?![a-zA-Z])/.test(s)) {
    // Literal "\n" between commands, when the text has no real line breaks at all.
    s = s.replace(/\\n(?![a-zA-Z])/g, '\n')
  }
  return s
}
