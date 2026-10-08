// Notes: the editor's document (TipTap / ProseMirror JSON) <-> Markdown.
//
// A note is stored as GitHub-flavoured Markdown so it reads well in Notepad,
// Files and any other editor. What the editor can hold and how it is written:
//
//   paragraph            text            heading 1-3   # / ## / ###
//   bold **b**  italic *i*  underline <u>u</u>  strike ~~s~~  code `c`  link [t](url)
//   bullet list  - item  numbered list  1. item  checklist  - [ ] / - [x] item
//   quote  > text        code block ```lang     rule  ---    line break  \ + newline
//   table (GFM pipes, first row = header, line breaks in cells as <br>)
//   picture  ![alt](Attachments/pic.png)        file  [name.pdf](Attachments/name.pdf)
//
// Plain TypeScript (no React, no "@/" imports): `node --test tools/tests/notes.test.ts`.

import { marked, type Token, type Tokens } from 'marked'

export interface JMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface JNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JNode[]
  text?: string
  marks?: JMark[]
}

/** The folder name, next to the notes, that holds their pictures and files. */
export const ATTACHMENTS = 'Attachments'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p.split(/[?#]/)[0])
}

/** A link to a file next to the note (not a web address, mail or anchor). */
export function isLocalHref(href: string): boolean {
  return !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('//') && !href.startsWith('/')
}

// ======================================================= document -> Markdown

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'code']

function sortMarks(marks: JMark[] | undefined): JMark[] {
  return [...(marks ?? [])].filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
}

const sameMark = (a: JMark, b: JMark) => a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href)

/** Encode a link target so it survives in (…): spaces and brackets. */
export function encodeHref(href: string): string {
  return href.replace(/[\s()<>]/g, (c) => encodeURIComponent(c))
}

function decodeHref(href: string): string {
  if (!isLocalHref(href)) return href
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function escapeText(text: string, inTable: boolean): string {
  let s = text
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]<~])/g, '\\$1')
    .replace(/&(?=#?\w+;)/g, '&amp;')
    // "_" only where it could start or end emphasis: snake_case stays readable.
    .replace(/(^|\W)_|_(?=\W|$)/g, (m) => m.replace('_', '\\_'))
  if (inTable) s = s.replace(/\|/g, '\\|')
  return s
}

/** Escapes needed when the text starts a line (it would read as a heading, list or quote). */
function escapeLineStart(s: string): string {
  return s
    .replace(/^(\s*)(#{1,6})(?=\s|$)/, (_m, sp: string, h: string) => `${sp}\\${h}`)
    .replace(/^(\s*)([-+>])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)(=+|-{3,})\s*$/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2')
}

function codeSpan(text: string): string {
  let n = 1
  while (text.includes('`'.repeat(n))) n++
  const fence = '`'.repeat(n)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function inline(nodes: JNode[] | undefined, inTable = false): string {
  let out = ''
  let active: JMark[] = []
  const open = (m: JMark) => {
    if (m.type === 'link') return '['
    if (m.type === 'bold') return '**'
    if (m.type === 'italic') return '*'
    if (m.type === 'strike') return '~~'
    if (m.type === 'underline') return '<u>'
    return ''
  }
  const close = (m: JMark) => {
    if (m.type === 'link') return `](${encodeHref(String(m.attrs?.href ?? ''))})`
    if (m.type === 'bold') return '**'
    if (m.type === 'italic') return '*'
    if (m.type === 'strike') return '~~'
    if (m.type === 'underline') return '</u>'
    return ''
  }
  // Delimiters must hug the text: spaces move outside them.
  const closeTo = (keep: number) => {
    const trail = /[ \t]*$/.exec(out)![0]
    out = out.slice(0, out.length - trail.length)
    for (let i = active.length - 1; i >= keep; i--) out += close(active[i])
    out += trail
    active = active.slice(0, keep)
  }
  for (const node of nodes ?? []) {
    const marks = sortMarks(node.marks)
    let keep = 0
    while (keep < active.length && keep < marks.length && sameMark(active[keep], marks[keep])) keep++
    if (keep < active.length) closeTo(keep)
    if (node.type === 'hardBreak') {
      closeTo(0)
      out += inTable ? '<br>' : '\\\n'
      continue
    }
    if (node.type !== 'text') continue
    let text = node.text ?? ''
    const isCode = marks.some((m) => m.type === 'code')
    if (keep < marks.length) {
      const lead = isCode ? '' : /^[ \t]*/.exec(text)![0]
      out += lead
      text = text.slice(lead.length)
      for (const m of marks.slice(keep)) out += open(m)
      active = marks
    }
    if (isCode) {
      out += codeSpan(inTable ? text.replace(/\|/g, '\\|') : text)
      // A code span is closed at once: the next node starts afresh.
      active = active.filter((m) => m.type !== 'code')
    } else {
      out += escapeText(text, inTable)
    }
  }
  closeTo(0)
  return out
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((l) => (l ? by + l : l))
    .join('\n')
}

function listItem(item: JNode, marker: string, ctx: Ctx, padWidth = marker.length): string {
  const kids = item.content ?? []
  const pad = ' '.repeat(padWidth)
  const parts: string[] = []
  kids.forEach((k, i) => {
    const text = block(k, ctx)
    if (i === 0 && k.type === 'paragraph') parts.push(marker + text)
    else if (i === 0) parts.push(marker.trimEnd() + '\n' + indent(text, pad))
    else {
      const sep = k.type === 'bulletList' || k.type === 'orderedList' || k.type === 'taskList' ? '\n' : '\n\n'
      parts.push(sep + indent(text, pad))
    }
  })
  if (!kids.length) parts.push(marker.trimEnd())
  return parts.join('')
}

interface Ctx {
  inTable: boolean
  /** List markers: two lists in a row need different ones, or Markdown joins them. */
  bullet?: '-' | '*'
  delim?: '.' | ')'
}

function cellText(cell: JNode): string {
  return (cell.content ?? [])
    .map((p) => (p.type === 'paragraph' || p.type === 'heading' ? inline(p.content, true) : plainOf(p).replace(/\n/g, ' ')))
    .filter((s, _i, a) => s || a.length === 1)
    .join('<br>')
    .replace(/\n/g, ' ')
}

function block(node: JNode, ctx: Ctx): string {
  switch (node.type) {
    case 'paragraph':
      // Every line (after a line break too) must not read as Markdown syntax.
      return inline(node.content)
        .split('\\\n')
        .map((l) => escapeLineStart(l).replace(/^ /, '&#32;'))
        .join('\\\n')
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      return `${'#'.repeat(level)} ${inline(node.content).replace(/\\\n/g, ' ')}`
    }
    case 'blockquote': {
      const inner = blocks(node.content, ctx)
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const text = (node.content ?? []).map((t) => t.text ?? '').join('')
      let fence = '```'
      while (text.includes(fence)) fence += '`'
      const lang = node.attrs?.language ? String(node.attrs.language) : ''
      return `${fence}${lang}\n${text}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'bulletList': {
      const b = ctx.bullet ?? '-'
      return (node.content ?? []).map((it) => listItem(it, `${b} `, inner(ctx))).join('\n')
    }
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1) || 1
      const d = ctx.delim ?? '.'
      return (node.content ?? []).map((it, i) => listItem(it, `${start + i}${d} `, inner(ctx))).join('\n')
    }
    case 'taskList': {
      const b = ctx.bullet ?? '-'
      return (node.content ?? []).map((it) => listItem(it, it.attrs?.checked ? `${b} [x] ` : `${b} [ ] `, inner(ctx), 2)).join('\n')
    }
    case 'image': {
      const alt = String(node.attrs?.alt ?? '').replace(/[[\]\\]/g, '\\$&')
      const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''
      return `![${alt}](${encodeHref(String(node.attrs?.src ?? ''))}${title})`
    }
    case 'attachment': {
      const src = String(node.attrs?.src ?? '')
      const name = String(node.attrs?.name ?? '') || src.split('/').pop() || 'file'
      return `[${escapeText(name, false)}](${encodeHref(src)})`
    }
    case 'table': {
      const rows = node.content ?? []
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => (r.content ?? []).length), 1)
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
      const out = [line((rows[0].content ?? []).map(cellText)), `|${' --- |'.repeat(width)}`]
      for (const r of rows.slice(1)) out.push(line((r.content ?? []).map(cellText)))
      return out.join('\n')
    }
    default:
      // Anything unknown keeps its text.
      if (node.content) return blocks(node.content, ctx)
      return escapeText(node.text ?? '', false)
  }
}

const inner = (ctx: Ctx): Ctx => ({ inTable: ctx.inTable })

const BULLETED = new Set(['bulletList', 'taskList'])

function blocks(nodes: JNode[] | undefined, ctx: Ctx): string {
  let bullet: '-' | '*' = '-'
  let delim: '.' | ')' = '.'
  return (nodes ?? [])
    .map((n, i) => {
      const prev = i > 0 ? nodes![i - 1].type : ''
      if (BULLETED.has(n.type)) bullet = BULLETED.has(prev) ? (bullet === '-' ? '*' : '-') : '-'
      if (n.type === 'orderedList') delim = prev === 'orderedList' ? (delim === '.' ? ')' : '.') : '.'
      return block(n, { ...ctx, bullet, delim })
    })
    .join('\n\n')
}

/** The editor's document as Markdown (ends with a newline, empty for an empty note). */
export function docToMarkdown(doc: JNode): string {
  const kids = [...(doc.content ?? [])]
  // Trailing empty paragraphs are only the cursor's room.
  while (kids.length && kids[kids.length - 1].type === 'paragraph' && !(kids[kids.length - 1].content ?? []).length) kids.pop()
  const md = blocks(kids, { inTable: false })
  return md.trim() ? md.replace(/\s+$/, '') + '\n' : ''
}

// ======================================================= Markdown -> document

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

interface InlineOut {
  nodes: JNode[]
  /** Pictures found inside the text: they become blocks after it. */
  images: JNode[]
}

function pushText(out: JNode[], text: string, marks: JMark[]) {
  if (!text) return
  const last = out[out.length - 1]
  const same = (a: JMark[] | undefined, b: JMark[]) =>
    (a?.length ?? 0) === b.length && b.every((m) => a!.some((x) => sameMark(x, m)))
  if (last && last.type === 'text' && same(last.marks, marks)) {
    last.text += text
    return
  }
  out.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text })
}

function inlineTokens(tokens: Token[] | undefined, marks: JMark[], out: InlineOut) {
  let local = [...marks]
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text': {
        const tt = t as Tokens.Text
        if (tt.tokens?.length) inlineTokens(tt.tokens, local, out)
        else pushText(out.nodes, decodeEntities(tt.text), local)
        break
      }
      case 'escape':
        pushText(out.nodes, (t as Tokens.Escape).text, local)
        break
      case 'strong':
        inlineTokens((t as Tokens.Strong).tokens, [...local, { type: 'bold' }], out)
        break
      case 'em':
        inlineTokens((t as Tokens.Em).tokens, [...local, { type: 'italic' }], out)
        break
      case 'del':
        inlineTokens((t as Tokens.Del).tokens, [...local, { type: 'strike' }], out)
        break
      case 'codespan':
        pushText(out.nodes, decodeEntities((t as Tokens.Codespan).text), [...local.filter((m) => m.type === 'link'), { type: 'code' }])
        break
      case 'br':
        out.nodes.push({ type: 'hardBreak' })
        break
      case 'link': {
        const lt = t as Tokens.Link
        inlineTokens(lt.tokens, [...local.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: decodeHref(lt.href) } }], out)
        break
      }
      case 'image': {
        const it = t as Tokens.Image
        out.images.push({ type: 'image', attrs: { src: decodeHref(it.href), alt: decodeEntities(it.text || ''), title: it.title || null } })
        break
      }
      case 'html': {
        const raw = (t as Tokens.HTML).text.trim().toLowerCase()
        if (raw === '<u>' || raw === '<ins>') local = [...local, { type: 'underline' }]
        else if (raw === '</u>' || raw === '</ins>') {
          const i = local.map((m) => m.type).lastIndexOf('underline')
          if (i >= 0) local = [...local.slice(0, i), ...local.slice(i + 1)]
        } else if (/^<br\s*\/?>$/.test(raw)) out.nodes.push({ type: 'hardBreak' })
        else pushText(out.nodes, (t as Tokens.HTML).text, local)
        break
      }
      case 'checkbox':
        break
      default: {
        const anyT = t as { text?: string; raw?: string; tokens?: Token[] }
        if (anyT.tokens?.length) inlineTokens(anyT.tokens, local, out)
        else pushText(out.nodes, decodeEntities(anyT.text ?? anyT.raw ?? ''), local)
      }
    }
  }
}

function paragraphBlocks(tokens: Token[] | undefined): JNode[] {
  const out: InlineOut = { nodes: [], images: [] }
  inlineTokens(tokens, [], out)
  // Drop break / blank text that only separated pictures.
  const meaningful = out.nodes.filter((n) => n.type !== 'hardBreak' && (n.type !== 'text' || (n.text ?? '').trim()))
  // A paragraph that is only a link to a file next to the note: an attachment.
  if (!out.images.length && meaningful.length === 1 && meaningful[0].type === 'text') {
    const link = meaningful[0].marks?.find((m) => m.type === 'link')
    const href = String(link?.attrs?.href ?? '')
    if (link && meaningful[0].marks!.length === 1 && isLocalHref(href)) {
      return [{ type: 'attachment', attrs: { src: href, name: meaningful[0].text ?? '' } }]
    }
  }
  const blocks: JNode[] = []
  if (meaningful.length) {
    while (out.nodes.length && out.nodes[out.nodes.length - 1].type === 'hardBreak') out.nodes.pop()
    while (out.nodes.length && out.nodes[0].type === 'hardBreak') out.nodes.shift()
    blocks.push({ type: 'paragraph', content: out.nodes })
  }
  blocks.push(...out.images)
  return blocks
}

function cellContent(tokens: Token[] | undefined): JNode[] {
  const out: InlineOut = { nodes: [], images: [] }
  inlineTokens(tokens, [], out)
  const paras: JNode[] = []
  let cur: JNode[] = []
  for (const n of out.nodes) {
    if (n.type === 'hardBreak') {
      paras.push(cur.length ? { type: 'paragraph', content: cur } : { type: 'paragraph' })
      cur = []
    } else cur.push(n)
  }
  paras.push(cur.length ? { type: 'paragraph', content: cur } : { type: 'paragraph' })
  for (const img of out.images) {
    const alt = String(img.attrs?.alt ?? '') || String(img.attrs?.src ?? '')
    paras.push({ type: 'paragraph', content: [{ type: 'text', text: alt, marks: [{ type: 'link', attrs: { href: img.attrs?.src } }] }] })
  }
  return paras
}

function listItemNodes(item: Tokens.ListItem): JNode[] {
  const kids: JNode[] = []
  for (const t of item.tokens ?? []) {
    if (t.type === 'checkbox') continue
    if (t.type === 'text') kids.push(...paragraphBlocks((t as Tokens.Text).tokens ?? [{ type: 'text', raw: t.raw, text: (t as Tokens.Text).text } as Token]))
    else kids.push(...blockTokens([t]))
  }
  if (!kids.length || kids[0].type !== 'paragraph') kids.unshift({ type: 'paragraph' })
  return kids
}

function blockTokens(tokens: Token[]): JNode[] {
  const out: JNode[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
      case 'def':
        break
      case 'heading': {
        const h = t as Tokens.Heading
        const inl: InlineOut = { nodes: [], images: [] }
        inlineTokens(h.tokens, [], inl)
        out.push(inl.nodes.length ? { type: 'heading', attrs: { level: Math.min(3, h.depth) }, content: inl.nodes } : { type: 'heading', attrs: { level: Math.min(3, h.depth) } })
        out.push(...inl.images)
        break
      }
      case 'paragraph':
        out.push(...paragraphBlocks((t as Tokens.Paragraph).tokens))
        break
      case 'text': {
        const tt = t as Tokens.Text
        out.push(...paragraphBlocks(tt.tokens ?? [{ type: 'text', raw: tt.raw, text: tt.text } as Token]))
        break
      }
      case 'blockquote': {
        const inner = blockTokens((t as Tokens.Blockquote).tokens)
        out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] })
        break
      }
      case 'code': {
        const c = t as Tokens.Code
        const lang = (c.lang ?? '').trim().split(/\s/)[0]
        out.push({ type: 'codeBlock', attrs: { language: lang || null }, ...(c.text ? { content: [{ type: 'text', text: c.text }] } : {}) })
        break
      }
      case 'hr':
        out.push({ type: 'horizontalRule' })
        break
      case 'list': {
        const l = t as Tokens.List
        const task = l.items.some((i) => i.task)
        if (task) {
          out.push({ type: 'taskList', content: l.items.map((i) => ({ type: 'taskItem', attrs: { checked: !!i.checked }, content: listItemNodes(i) })) })
        } else {
          const items = l.items.map((i) => ({ type: 'listItem', content: listItemNodes(i) }))
          const start = l.ordered ? Number(l.start) || 1 : 1
          out.push(l.ordered ? { type: 'orderedList', attrs: { start }, content: items } : { type: 'bulletList', content: items })
        }
        break
      }
      case 'table': {
        const tb = t as Tokens.Table
        const row = (cells: Tokens.TableCell[], header: boolean): JNode => ({
          type: 'tableRow',
          content: cells.map((c) => ({ type: header ? 'tableHeader' : 'tableCell', content: cellContent(c.tokens) })),
        })
        out.push({ type: 'table', content: [row(tb.header, true), ...tb.rows.map((r) => row(r, false))] })
        break
      }
      case 'html': {
        const raw = (t as Tokens.HTML).text.replace(/\n+$/, '')
        if (raw.trim()) out.push({ type: 'paragraph', content: [{ type: 'text', text: raw }] })
        break
      }
      default: {
        const anyT = t as { text?: string; raw?: string }
        const text = (anyT.text ?? anyT.raw ?? '').trim()
        if (text) out.push({ type: 'paragraph', content: [{ type: 'text', text }] })
      }
    }
  }
  return out
}

/** Markdown (without front matter) as the editor's document. */
export function markdownToDoc(md: string): JNode {
  const tokens = marked.lexer(md.replace(/\r\n?/g, '\n'), { gfm: true })
  const content = blockTokens(tokens)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// ======================================================= plain text

/** The text of a node: for search, titles, plain-text export. */
export function plainOf(node: JNode, opts: { markers?: boolean } = {}): string {
  const markers = opts.markers ?? true
  const inl = (n: JNode): string =>
    (n.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : c.type === 'hardBreak' ? '\n' : inl(c))).join('')
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'paragraph':
    case 'heading':
      return inl(node)
    case 'codeBlock':
      return (node.content ?? []).map((t) => t.text ?? '').join('')
    case 'horizontalRule':
      return markers ? '———' : ''
    case 'image':
      return String(node.attrs?.alt || '')
    case 'attachment':
      return String(node.attrs?.name || '')
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const start = Number(node.attrs?.start ?? 1) || 1
      return (node.content ?? [])
        .map((item, i) => {
          const mark = !markers ? '' : node.type === 'taskList' ? (item.attrs?.checked ? '☑ ' : '☐ ') : node.type === 'orderedList' ? `${start + i}. ` : '• '
          const inner = (item.content ?? []).map((k) => plainOf(k, opts)).filter(Boolean)
          return mark + inner.map((s, j) => (j ? s.replace(/^/gm, '  ') : s)).join('\n')
        })
        .join('\n')
    }
    case 'table':
      return (node.content ?? [])
        .map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => plainOf(p, opts)).join(' ')).join('\t'))
        .join('\n')
    default:
      return (node.content ?? []).map((k) => plainOf(k, opts)).filter(Boolean).join('\n')
  }
}

/** The whole document as plain text, one block per line. */
export function docToPlain(doc: JNode, opts: { markers?: boolean } = {}): string {
  return (doc.content ?? []).map((n) => plainOf(n, opts)).join('\n')
}

// ======================================================= checklists

export interface ChecklistItem {
  /** 1-based, in reading order (nested items included). */
  index: number
  text: string
  checked: boolean
}

function eachTask(node: JNode, fn: (item: JNode) => void) {
  for (const k of node.content ?? []) {
    if (k.type === 'taskItem') fn(k)
    eachTask(k, fn)
  }
}

/** The checklist items of a document. */
export function checklistItems(doc: JNode): ChecklistItem[] {
  const out: ChecklistItem[] = []
  eachTask(doc, (item) => {
    const first = (item.content ?? [])[0]
    out.push({ index: out.length + 1, text: first ? plainOf(first).trim() : '', checked: !!item.attrs?.checked })
  })
  return out
}

/** Tick (or untick) checklist item `index` (1-based); returns a new document. */
export function setChecklistItem(doc: JNode, index: number, checked: boolean): JNode {
  const copy = JSON.parse(JSON.stringify(doc)) as JNode
  let n = 0
  eachTask(copy, (item) => {
    if (++n === index) item.attrs = { ...item.attrs, checked }
  })
  if (index < 1 || index > n) throw new Error(`There is no checklist item ${index} (the note has ${n}).`)
  return copy
}
