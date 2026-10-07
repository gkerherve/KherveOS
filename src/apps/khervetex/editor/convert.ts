// The KherveTeX model (model.ts) to the editor's document and back.
//
// Loading and saving without any edit gives back the same model, so a
// document from the desktop keeps its LaTeX. Like the desktop editor, table
// cells are LaTeX shown as text (an unchanged cell keeps its exact source),
// and a footnote is edited as plain text.

import type { JSONContent } from '@tiptap/core'
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model'
import {
  MARK_ORDER, plainText,
  type Block, type DocMeta, type Document, type Inline, type Mark, type Table, type Text,
} from '../model'
import { cellDisplayText } from '../serializer'

// ------------------------------------------------------------ model → editor

const MARK_TO_PM: Record<Mark, string> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike', smallcaps: 'smallcaps',
  code: 'code', subscript: 'subscript', superscript: 'superscript',
}
const PM_TO_MARK: Record<string, Mark> = Object.fromEntries(Object.entries(MARK_TO_PM).map(([m, pm]) => [pm, m as Mark]))

type PMMarkJSON = { type: string; attrs?: Record<string, unknown> }

function inlineToPM(node: Inline, extra: PMMarkJSON[]): JSONContent[] {
  switch (node.type) {
    case 'Text': {
      if (!node.text) return []
      const marks = [...node.marks.filter((m) => MARK_TO_PM[m]).map((m) => ({ type: MARK_TO_PM[m] })), ...extra]
      return [{ type: 'text', text: node.text, ...(marks.length ? { marks } : {}) }]
    }
    case 'MathInline':
      return [withMarks({ type: 'mathInline', attrs: { latex: node.latex } }, extra)]
    case 'Link': {
      const link = { type: 'link', attrs: { href: node.url } }
      const kids = node.children.length ? node.children : [{ type: 'Text', text: node.url, marks: [] } as Text]
      return kids.flatMap((c) => inlineToPM(c, [...extra.filter((m) => m.type !== 'link'), link]))
    }
    case 'Footnote':
      return [withMarks({ type: 'footnote', attrs: { text: plainText(node.children), children: node.children } }, extra)]
    case 'Citation':
      return [withMarks({ type: 'citation', attrs: { keys: [...node.keys], style: node.style } }, extra)]
    case 'CrossRef':
      return [withMarks({ type: 'crossref', attrs: { label: node.label, kind: node.kind } }, extra)]
    case 'InlineRaw':
      return [withMarks({ type: 'inlineRaw', attrs: { latex: node.latex } }, extra)]
    case 'Highlight':
      return node.children.flatMap((c) => inlineToPM(c, [...extra, { type: 'highlight', attrs: { color: node.color } }]))
    case 'Comment':
      return node.children.flatMap((c) =>
        inlineToPM(c, [...extra, { type: 'comment', attrs: { note: node.note, author: node.author, timestamp: node.timestamp, resolved: node.resolved } }]),
      )
  }
}

function withMarks(node: JSONContent, marks: PMMarkJSON[]): JSONContent {
  return marks.length ? { ...node, marks } : node
}

function inlinesToPM(nodes: Inline[]): JSONContent[] {
  return nodes.flatMap((n) => inlineToPM(n, []))
}

function textBlock(type: string, children: Inline[], attrs?: Record<string, unknown>): JSONContent {
  const content = inlinesToPM(children)
  return { type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) }
}

const ALIGN_TO_PM: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'justify' }

function cellToPM(raw: string): JSONContent {
  const shown = cellDisplayText(raw)
  const marks: PMMarkJSON[] = []
  if (raw.includes('\\textbf{')) marks.push({ type: 'bold' })
  if (raw.includes('\\textit{') || raw.includes('\\emph{')) marks.push({ type: 'italic' })
  const para: JSONContent = shown ? { type: 'paragraph', content: [{ type: 'text', text: shown, ...(marks.length ? { marks } : {}) }] } : { type: 'paragraph' }
  return { type: 'tableCell', attrs: { raw }, content: [para] }
}

function tableToPM(t: Table): JSONContent {
  const rows = t.rows.length ? t.rows : [['']]
  const cols = Math.max(1, ...rows.map((r) => r.length))
  return {
    type: 'table',
    attrs: { caption: t.caption, label: t.label, alignment: t.alignment, ruleStyle: t.style, wasEmpty: !t.rows.length },
    content: rows.map((r) => ({ type: 'tableRow', content: Array.from({ length: cols }, (_, i) => cellToPM(r[i] ?? '')) })),
  }
}

export function blockToPM(b: Block): JSONContent {
  switch (b.type) {
    case 'Paragraph':
      return textBlock('paragraph', b.children, { textAlign: ALIGN_TO_PM[b.alignment] ?? null })
    case 'Section':
      return textBlock('section', b.children, { level: b.level, numbered: b.numbered, label: b.label })
    case 'MathBlock':
      return { type: 'mathBlock', attrs: { latex: b.latex, numbered: b.numbered, label: b.label } }
    case 'List': {
      const items = b.items.length ? b.items : [{ type: 'ListItem' as const, children: [] }]
      return {
        type: b.ordered ? 'orderedList' : 'bulletList',
        content: items.map((it) => ({ type: 'listItem', content: [textBlock('paragraph', it.children)] })),
      }
    }
    case 'Figure':
      return { type: 'figure', attrs: { path: b.path, caption: b.caption, label: b.label, width: b.width, source: b.source } }
    case 'Table':
      return tableToPM(b)
    case 'RawLatex':
      return { type: 'rawLatex', ...(b.text ? { content: [{ type: 'text', text: b.text }] } : {}) }
    case 'Title': return textBlock('title', b.children)
    case 'Author': return textBlock('author', b.children)
    case 'Affiliation': return textBlock('affiliation', b.children)
    case 'Correspondence': return textBlock('correspondence', b.children)
    case 'Abstract': return textBlock('abstract', b.children)
    case 'Keywords': return textBlock('keywords', b.children)
    case 'Frame': return textBlock('frame', b.children)
  }
}

/** The editor content for a document (meta is kept by the window, not the editor). */
export function docToEditor(doc: Document): JSONContent {
  const content = doc.children.map(blockToPM)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// ------------------------------------------------------------ editor → model

function formatMarks(marks: readonly PMMark[]): Mark[] {
  const names = new Set(marks.map((m) => PM_TO_MARK[m.type.name]).filter(Boolean))
  return MARK_ORDER.filter((m) => names.has(m))
}

function leafInline(node: PMNode): Inline | null {
  const a = node.attrs
  if (node.isText) return { type: 'Text', text: node.text ?? '', marks: formatMarks(node.marks) }
  switch (node.type.name) {
    case 'mathInline':
      return { type: 'MathInline', latex: String(a.latex ?? '') }
    case 'footnote': {
      const kids = a.children as Inline[] | null
      const text = String(a.text ?? '')
      // A footnote edited in KherveOS is its plain text; an untouched one keeps its inlines.
      if (Array.isArray(kids) && plainText(kids) === text) return { type: 'Footnote', children: kids }
      return { type: 'Footnote', children: text ? [{ type: 'Text', text, marks: [] }] : [] }
    }
    case 'citation':
      return { type: 'Citation', keys: [...((a.keys as string[]) ?? [])], style: String(a.style ?? 'cite') }
    case 'crossref':
      return { type: 'CrossRef', label: String(a.label ?? ''), kind: String(a.kind ?? 'ref') }
    case 'inlineRaw':
      return { type: 'InlineRaw', latex: String(a.latex ?? '') }
    case 'hardBreak':
      return { type: 'InlineRaw', latex: '\\\\' }
  }
  return null
}

/** The inline content of a text block. Links, highlights and comments become wrapper nodes. */
export function inlinesOf(block: PMNode): Inline[] {
  const out: Inline[] = []
  let key: string | null = null
  let make: ((children: Inline[]) => Inline) | null = null
  let children: Inline[] = []
  const flush = () => {
    if (make) out.push(make(children))
    key = null
    make = null
    children = []
  }
  block.forEach((child) => {
    const leaf = leafInline(child)
    if (!leaf) return
    const link = child.marks.find((m) => m.type.name === 'link')
    const hl = child.marks.find((m) => m.type.name === 'highlight')
    const cm = child.marks.find((m) => m.type.name === 'comment')
    let k: string | null = null
    let mk: ((c: Inline[]) => Inline) | null = null
    if (link) {
      const url = String(link.attrs.href ?? '')
      k = `link\0${url}`
      mk = (c) => ({ type: 'Link', url, children: c })
    } else if (hl) {
      const color = String(hl.attrs.color ?? 'yellow')
      k = `hl\0${color}`
      mk = (c) => ({ type: 'Highlight', children: c, color })
    } else if (cm) {
      const { note, author, timestamp, resolved } = cm.attrs
      k = `cm\0${JSON.stringify([note, author, timestamp, resolved])}`
      mk = (c) => ({ type: 'Comment', children: c, note: String(note ?? ''), author: String(author ?? ''), timestamp: String(timestamp ?? ''), resolved: !!resolved })
    }
    if (k === null || mk === null) {
      flush()
      out.push(leaf)
      return
    }
    if (k !== key) {
      flush()
      key = k
      make = mk
    }
    children.push(leaf)
  })
  flush()
  return out
}

function alignmentOf(node: PMNode): string {
  const a = node.attrs.textAlign as string | null
  return a === 'left' || a === 'center' || a === 'right' ? a : 'justify'
}

function cellText(cell: PMNode): string {
  const parts: string[] = []
  cell.forEach((p) => parts.push(p.textContent))
  return parts.join(' ')
}

function tableOf(node: PMNode): Table {
  const rows: string[][] = []
  node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => {
      const shown = cellText(cell)
      const raw = cell.attrs.raw as string | null
      // An unchanged cell keeps its LaTeX (\textbf, maths…); an edited one is its text.
      cells.push(raw !== null && raw !== undefined && cellDisplayText(raw) === shown.trim() ? raw : shown)
      for (let i = 1; i < (Number(cell.attrs.colspan) || 1); i++) cells.push('')
    })
    rows.push(cells)
  })
  const a = node.attrs
  const untouched = a.wasEmpty && rows.length === 1 && rows[0].length === 1 && rows[0][0] === ''
  return {
    type: 'Table', rows: untouched ? [] : rows, caption: String(a.caption ?? ''), label: a.label ?? null,
    alignment: String(a.alignment ?? ''), style: String(a.ruleStyle ?? ''),
  }
}

export function blockOf(node: PMNode): Block | null {
  const a = node.attrs
  switch (node.type.name) {
    case 'paragraph':
      return { type: 'Paragraph', children: inlinesOf(node), alignment: alignmentOf(node) }
    case 'section':
      return { type: 'Section', level: Number(a.level) || 0, children: inlinesOf(node), numbered: !!a.numbered, label: a.label || null }
    case 'title': return { type: 'Title', children: inlinesOf(node) }
    case 'author': return { type: 'Author', children: inlinesOf(node) }
    case 'affiliation': return { type: 'Affiliation', children: inlinesOf(node) }
    case 'correspondence': return { type: 'Correspondence', children: inlinesOf(node) }
    case 'abstract': return { type: 'Abstract', children: inlinesOf(node) }
    case 'keywords': return { type: 'Keywords', children: inlinesOf(node) }
    case 'frame': return { type: 'Frame', children: inlinesOf(node) }
    case 'mathBlock':
      return { type: 'MathBlock', latex: String(a.latex ?? ''), numbered: !!a.numbered, label: a.label || null }
    case 'bulletList':
    case 'orderedList': {
      const items: { type: 'ListItem'; children: Inline[] }[] = []
      node.forEach((item) => {
        const children: Inline[] = []
        item.forEach((p) => children.push(...(p.isTextblock ? inlinesOf(p) : [])))
        items.push({ type: 'ListItem', children })
      })
      return { type: 'List', ordered: node.type.name === 'orderedList', items }
    }
    case 'figure':
      return { type: 'Figure', path: String(a.path ?? ''), caption: String(a.caption ?? ''), label: a.label || null, width: String(a.width || '0.8\\textwidth'), source: String(a.source ?? '') }
    case 'table':
      return tableOf(node)
    case 'rawLatex':
      return { type: 'RawLatex', text: node.textContent }
  }
  return null
}

/** The model of the editor's document, with the window's metadata. */
export function editorToModel(doc: PMNode, meta: DocMeta): Document {
  const children: Block[] = []
  doc.forEach((node) => {
    const b = blockOf(node)
    if (b) children.push(b)
  })
  return { type: 'Document', children, meta }
}
