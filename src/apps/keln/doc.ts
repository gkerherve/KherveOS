// The text of an entry is a ProseMirror document in JSON (what the Tiptap editor reads and writes). This module is
// the pure side of it: builders (templates, examples), plain text for search, HTML (well-formed XHTML), Markdown out,
// and Markdown in (marked's lexer → this document).

import { marked, type Token, type Tokens } from 'marked'
import { blockText, blockToHtml, blockToMarkdown, esc, isBlock, plainCtx, type Block, type RenderCtx } from './blocks.ts'

export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: PMMark[]
  text?: string
}

export const emptyDoc = (): PMNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })

// ------------------------------------------------------------------ builders

export type Inline = string | PMNode

const inline = (x: Inline | Inline[]): PMNode[] =>
  (Array.isArray(x) ? x : [x]).flatMap((i): PMNode[] => (typeof i === 'string' ? (i ? [{ type: 'text', text: i }] : []) : [i]))

export const text = (t: string, ...marks: string[]): PMNode => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) })
export const bold = (t: string): PMNode => text(t, 'bold')
export const italic = (t: string): PMNode => text(t, 'italic')
export const code = (t: string): PMNode => text(t, 'code')
export const link = (t: string, href: string): PMNode => ({ type: 'text', text: t, marks: [{ type: 'link', attrs: { href } }] })
export const math = (latex: string): PMNode => ({ type: 'mathInline', attrs: { latex } })
export const mention = (id: string, label = id): PMNode => ({ type: 'sampleMention', attrs: { id, label } })
export const p = (...x: Inline[]): PMNode => ({ type: 'paragraph', ...(x.length ? { content: inline(x) } : {}) })
export const h = (level: number, ...x: Inline[]): PMNode => ({ type: 'heading', attrs: { level }, content: inline(x) })
export const li = (...x: Inline[]): PMNode => ({ type: 'listItem', content: [p(...x)] })
export const ul = (...items: Inline[][]): PMNode => ({ type: 'bulletList', content: items.map((i) => li(...i)) })
export const ol = (...items: Inline[][]): PMNode => ({ type: 'orderedList', content: items.map((i) => li(...i)) })
export const tasks = (...items: Array<[string, boolean?]>): PMNode => ({
  type: 'taskList', content: items.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked: !!checked }, content: [p(t)] })),
})
export const quote = (...x: Inline[]): PMNode => ({ type: 'blockquote', content: [p(...x)] })
export const codeBlock = (t: string, language = ''): PMNode => ({ type: 'codeBlock', attrs: { language }, content: t ? [{ type: 'text', text: t }] : [] })
export const mathBlock = (latex: string): PMNode => ({ type: 'mathBlock', attrs: { latex } })
export const hr = (): PMNode => ({ type: 'horizontalRule' })
export const block = (b: Block): PMNode => ({ type: 'elnBlock', attrs: { block: b } })
export const table = (head: string[], rows: string[][]): PMNode => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => ({ type: 'tableCell', content: [p(c)] })) })),
  ],
})
export const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] })

// ------------------------------------------------------------------ walking

export function walk(n: PMNode | null | undefined, fn: (n: PMNode) => void): void {
  if (!n) return
  fn(n)
  n.content?.forEach((c) => walk(c, fn))
}

/** The structured blocks of a document, in order. */
export function docBlocks(d: PMNode): Block[] {
  const out: Block[] = []
  walk(d, (n) => {
    if (n.type === 'elnBlock' && isBlock(n.attrs?.block)) out.push(n.attrs!.block)
  })
  return out
}

/** The sample ids mentioned with @ in the text, without repeats. */
export function docMentions(d: PMNode): string[] {
  const out = new Set<string>()
  walk(d, (n) => {
    if (n.type === 'sampleMention' && typeof n.attrs?.id === 'string') out.add(n.attrs.id)
  })
  return [...out]
}

/** The instrument names used in Instrument run blocks. */
export function docInstruments(d: PMNode): string[] {
  return [...new Set(docBlocks(d).flatMap((b) => (b.kind === 'instrument' && b.data.instrument.trim() ? [b.data.instrument.trim()] : [])))]
}

/** The attachment ids a document uses (images, files, instrument runs). */
export function docAttachmentIds(d: PMNode): string[] {
  return [...new Set(docBlocks(d).flatMap((b) => (b.kind === 'image' || b.kind === 'file' ? [b.data.att] : b.kind === 'instrument' ? [b.data.file] : [])).filter(Boolean))]
}

const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'tableRow', 'mathBlock', 'elnBlock', 'horizontalRule'])

/** Plain text of a document, one line per block; blocks contribute their words (reagents, observations…). */
export function docText(d: PMNode, ctx: RenderCtx = plainCtx): string {
  const out: string[] = []
  const go = (n: PMNode) => {
    if (n.type === 'text') { out.push(n.text ?? ''); return }
    if (n.type === 'hardBreak') { out.push('\n'); return }
    if (n.type === 'mathInline' || n.type === 'mathBlock') { out.push(String(n.attrs?.latex ?? '')); return }
    if (n.type === 'sampleMention') { out.push(`@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`); return }
    if (n.type === 'elnBlock') {
      if (isBlock(n.attrs?.block)) out.push(blockText(n.attrs!.block, ctx))
      out.push('\n')
      return
    }
    if (n.type === 'tableCell' || n.type === 'tableHeader') { n.content?.forEach(go); out.push('\t'); return }
    n.content?.forEach(go)
    if (BLOCK_NODES.has(n.type)) out.push('\n')
  }
  go(d)
  return out.join('').replace(/\t\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ------------------------------------------------------------------ HTML

const safeUrl = (u: unknown): string => {
  const s = String(u ?? '').trim()
  return /^(https?:|mailto:|data:image\/(png|jpeg|gif|webp);base64,|#|keln-att:)/i.test(s) ? s : ''
}

function markedText(n: PMNode, ctx: RenderCtx): string {
  let s = esc(n.text ?? '')
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case 'bold': s = `<b>${s}</b>`; break
      case 'italic': s = `<i>${s}</i>`; break
      case 'underline': s = `<u>${s}</u>`; break
      case 'strike': s = `<s>${s}</s>`; break
      case 'code': s = `<code>${s}</code>`; break
      case 'highlight': s = `<mark>${s}</mark>`; break
      case 'subscript': s = `<sub>${s}</sub>`; break
      case 'superscript': s = `<sup>${s}</sup>`; break
      case 'link': { const href = safeUrl(m.attrs?.href); if (href) s = `<a href="${esc(href)}">${s}</a>`; break }
    }
  }
  void ctx
  return s
}

export function nodeToHtml(n: PMNode, ctx: RenderCtx): string {
  const kids = (): string => (n.content ?? []).map((c) => nodeToHtml(c, ctx)).join('')
  switch (n.type) {
    case 'doc': return kids()
    case 'text': return markedText(n, ctx)
    case 'paragraph': return `<p>${kids()}</p>`
    case 'heading': return `<h${Math.min(6, Math.max(1, Number(n.attrs?.level) || 1))}>${kids()}</h${Math.min(6, Math.max(1, Number(n.attrs?.level) || 1))}>`
    case 'bulletList': return `<ul>${kids()}</ul>`
    case 'orderedList': return `<ol>${kids()}</ol>`
    case 'listItem': return `<li>${kids()}</li>`
    case 'taskList': return `<ul class="eln-tasks">${kids()}</ul>`
    case 'taskItem': return `<li>${n.attrs?.checked ? '[x] ' : '[ ] '}${kids()}</li>`
    case 'blockquote': return `<blockquote>${kids()}</blockquote>`
    case 'codeBlock': return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`
    case 'horizontalRule': return '<hr/>'
    case 'hardBreak': return '<br/>'
    case 'table': return `<table class="eln-table"><tbody>${kids()}</tbody></table>`
    case 'tableRow': return `<tr>${kids()}</tr>`
    case 'tableHeader': return `<th>${kids()}</th>`
    case 'tableCell': return `<td>${kids()}</td>`
    case 'image': { const src = safeUrl(n.attrs?.src); return src ? `<img alt="${esc(n.attrs?.alt ?? '')}" src="${esc(src)}"/>` : '' }
    case 'mathInline': return ctx.math ? ctx.math(String(n.attrs?.latex ?? ''), false) : `<i>${esc(n.attrs?.latex)}</i>`
    case 'mathBlock': return `<p class="eln-math">${ctx.math ? ctx.math(String(n.attrs?.latex ?? ''), true) : `<i>${esc(n.attrs?.latex)}</i>`}</p>`
    case 'sampleMention': return `<span class="eln-mention">${esc(ctx.sampleLabel(String(n.attrs?.id ?? '')) || n.attrs?.label || n.attrs?.id)}</span>`
    case 'elnBlock': return isBlock(n.attrs?.block) ? blockToHtml(n.attrs!.block, ctx) : ''
    default: return kids()
  }
}

export const docToHtml = (d: PMNode, ctx: RenderCtx = plainCtx): string => nodeToHtml(d, ctx)

// ------------------------------------------------------------------ Markdown (out)

function mdInline(n: PMNode, ctx: RenderCtx): string {
  if (n.type === 'text') {
    let s = (n.text ?? '').replace(/([*_`[\]\\])/g, '\\$1')
    for (const m of n.marks ?? []) {
      if (m.type === 'code') s = `\`${n.text ?? ''}\``
      else if (m.type === 'bold') s = `**${s}**`
      else if (m.type === 'italic') s = `*${s}*`
      else if (m.type === 'strike') s = `~~${s}~~`
      else if (m.type === 'link') s = `[${s}](${safeUrl(m.attrs?.href)})`
    }
    return s
  }
  if (n.type === 'hardBreak') return '  \n'
  if (n.type === 'mathInline') return `$${String(n.attrs?.latex ?? '')}$`
  if (n.type === 'sampleMention') return `@${String(n.attrs?.id ?? '')}`
  if (n.type === 'image') return `![${String(n.attrs?.alt ?? '')}](${safeUrl(n.attrs?.src)})`
  return (n.content ?? []).map((c) => mdInline(c, ctx)).join('')
}

function mdBlock(n: PMNode, ctx: RenderCtx, indent = ''): string {
  const inl = () => (n.content ?? []).map((c) => mdInline(c, ctx)).join('')
  const blocks = (list: PMNode[] | undefined, ind = indent) => (list ?? []).map((c) => mdBlock(c, ctx, ind)).filter((s) => s !== '').join('\n\n')
  switch (n.type) {
    case 'doc': return blocks(n.content)
    case 'paragraph': return indent + inl()
    case 'heading': return `${'#'.repeat(Math.min(6, Math.max(1, Number(n.attrs?.level) || 1)))} ${inl()}`
    case 'bulletList': case 'taskList': case 'orderedList': {
      const ordered = n.type === 'orderedList'
      return (n.content ?? []).map((item, i) => {
        const marker = n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : ordered ? `${i + 1}. ` : '- '
        const [first, ...rest] = item.content ?? []
        const head = first ? mdBlock(first, ctx, '').replace(/^/, '') : ''
        const tail = rest.map((r) => mdBlock(r, ctx, '  ')).filter(Boolean).join('\n')
        return indent + marker + head + (tail ? `\n${tail}` : '')
      }).join('\n')
    }
    case 'blockquote': return blocks(n.content, '').split('\n').map((l) => `> ${l}`).join('\n')
    case 'codeBlock': return '```' + String(n.attrs?.language ?? '') + '\n' + (n.content ?? []).map((c) => c.text ?? '').join('') + '\n```'
    case 'horizontalRule': return '---'
    case 'table': {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((b) => mdBlock(b, ctx, '')).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')))
      if (!rows.length) return ''
      const w = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [pad(rows[0]), `| ${Array.from({ length: w }, () => '---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n')
    }
    case 'image': return `![${String(n.attrs?.alt ?? '')}](${safeUrl(n.attrs?.src)})`
    case 'mathBlock': return `$$\n${String(n.attrs?.latex ?? '')}\n$$`
    case 'elnBlock': return isBlock(n.attrs?.block) ? blockToMarkdown(n.attrs!.block, ctx) : ''
    default: return inl()
  }
}

export const docToMarkdown = (d: PMNode, ctx: RenderCtx = plainCtx): string => mdBlock(d, ctx).replace(/\n{3,}/g, '\n\n').trim() + '\n'

// ------------------------------------------------------------------ Markdown (in)

type Mark = PMMark

function splitMath(t: string, marks: Mark[]): PMNode[] {
  const out: PMNode[] = []
  const re = /\$([^$\n]+)\$/g
  let last = 0
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m.index > last) out.push({ type: 'text', text: t.slice(last, m.index), ...(marks.length ? { marks } : {}) })
    out.push(math(m[1]))
    last = m.index + m[0].length
  }
  if (last < t.length) out.push({ type: 'text', text: t.slice(last), ...(marks.length ? { marks } : {}) })
  return out
}

function mdInlineTokens(tokens: Token[] | undefined, marks: Mark[] = []): PMNode[] {
  const out: PMNode[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text': case 'escape': {
        const tk = t as Tokens.Text
        if (tk.tokens?.length) out.push(...mdInlineTokens(tk.tokens, marks))
        else out.push(...splitMath(tk.text, marks))
        break
      }
      case 'strong': out.push(...mdInlineTokens((t as Tokens.Strong).tokens, [...marks, { type: 'bold' }])); break
      case 'em': out.push(...mdInlineTokens((t as Tokens.Em).tokens, [...marks, { type: 'italic' }])); break
      case 'del': out.push(...mdInlineTokens((t as Tokens.Del).tokens, [...marks, { type: 'strike' }])); break
      case 'codespan': out.push({ type: 'text', text: (t as Tokens.Codespan).text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), marks: [...marks, { type: 'code' }] }); break
      case 'link': out.push(...mdInlineTokens((t as Tokens.Link).tokens, [...marks, { type: 'link', attrs: { href: (t as Tokens.Link).href } }])); break
      case 'image': out.push({ type: 'image', attrs: { src: (t as Tokens.Image).href, alt: (t as Tokens.Image).text } }); break
      case 'br': out.push({ type: 'hardBreak' }); break
      case 'html': break
      default: if ('raw' in t && typeof t.raw === 'string') out.push(...splitMath(t.raw, marks))
    }
  }
  return out
}

function mdBlockTokens(tokens: Token[]): PMNode[] {
  const out: PMNode[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': out.push({ type: 'heading', attrs: { level: Math.min(6, (t as Tokens.Heading).depth) }, content: mdInlineTokens((t as Tokens.Heading).tokens) }); break
      case 'paragraph': {
        const content = mdInlineTokens((t as Tokens.Paragraph).tokens)
        // a lone image becomes a block image, a "$$ … $$" paragraph a display equation
        const raw = (t as Tokens.Paragraph).text.trim()
        const m = /^\$\$([\s\S]+)\$\$$/.exec(raw)
        if (m) out.push(mathBlock(m[1].trim()))
        else out.push({ type: 'paragraph', ...(content.length ? { content } : {}) })
        break
      }
      case 'list': {
        const l = t as Tokens.List
        const isTask = l.items.some((i) => i.task)
        const items = l.items.map((it): PMNode => {
          const body: PMNode[] = []
          for (const sub of it.tokens) {
            if (sub.type === 'text') body.push({ type: 'paragraph', content: mdInlineTokens((sub as Tokens.Text).tokens ?? [sub]) })
            else body.push(...mdBlockTokens([sub]))
          }
          if (!body.length || body[0].type !== 'paragraph') body.unshift({ type: 'paragraph' })
          return isTask ? { type: 'taskItem', attrs: { checked: !!it.checked }, content: body } : { type: 'listItem', content: body }
        })
        out.push({ type: isTask ? 'taskList' : l.ordered ? 'orderedList' : 'bulletList', content: items })
        break
      }
      case 'code': out.push(codeBlock((t as Tokens.Code).text, (t as Tokens.Code).lang ?? '')); break
      case 'blockquote': out.push({ type: 'blockquote', content: mdBlockTokens((t as Tokens.Blockquote).tokens) }); break
      case 'hr': out.push(hr()); break
      case 'table': {
        const tb = t as Tokens.Table
        const cell = (type: string, c: Tokens.TableCell): PMNode => ({ type, content: [{ type: 'paragraph', ...(c.tokens.length ? { content: mdInlineTokens(c.tokens) } : {}) }] })
        out.push({ type: 'table', content: [{ type: 'tableRow', content: tb.header.map((c) => cell('tableHeader', c)) }, ...tb.rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) }))] })
        break
      }
      default: break // space, html
    }
  }
  return out
}

/** Markdown (or plain text) to an entry document. */
export function markdownToDoc(md: string): PMNode {
  const content = mdBlockTokens(marked.lexer(md.replace(/\r\n?/g, '\n')))
  return doc(...content)
}

/** The first heading or line of a Markdown text: a title suggestion. */
export function titleOfMarkdown(md: string, fallback = 'Imported note'): string {
  const m = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/m.exec(md)
  if (m) return m[1].trim()
  const line = md.split('\n').find((l) => l.trim())
  return line ? line.trim().slice(0, 80) : fallback
}
