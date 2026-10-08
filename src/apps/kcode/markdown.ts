// A tiny, safe markdown reader for kCode's lesson texts. It turns text into a tree of plain
// nodes; the view builds React elements from them, so nothing is ever treated as HTML.
// Supported: # ## ### headings, paragraphs, - and 1. lists, > quotes, ``` code blocks,
// `code`, **bold**, *italic*, [text](https://link), --- rules.

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'a'; href: string; c: Inline[] }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }

const LINK = /^https?:\/\/[^\s<>"']+$/i

/** Inline markup of one paragraph. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', s: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length && '\\`*[]()#_-'.includes(src[i + 1])) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ t: 'code', s: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'b', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (ch === '*' && src[i + 1] !== ' ' && src[i + 1] !== '*') {
      const end = src.indexOf('*', i + 1)
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush()
        out.push({ t: 'i', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[') {
      const close = src.indexOf('](', i + 1)
      const end = close > 0 ? src.indexOf(')', close + 2) : -1
      if (close > 0 && end > close) {
        const href = src.slice(close + 2, end)
        if (LINK.test(href)) {
          flush()
          out.push({ t: 'a', href, c: parseInline(src.slice(i + 1, close)) })
          i = end + 1
          continue
        }
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** Block structure of a lesson text. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      flushPara()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (!line.trim()) { flushPara(); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3, c: parseInline(h[2].trim()) })
      continue
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); blocks.push({ t: 'hr' }); continue }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushPara()
      const q = [quote[1]]
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) q.push(lines[++i].replace(/^>\s?/, ''))
      blocks.push({ t: 'quote', c: parseInline(q.join(' ')) })
      continue
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      flushPara()
      const ordered = /\d/.test(li[1])
      const items: string[] = [li[2]]
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        const more = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(next)
        if (more && /\d/.test(more[1]) === ordered) { items.push(more[2]); i++ }
        else if (/^\s{2,}\S/.test(next) && !more) { items[items.length - 1] += ' ' + next.trim(); i++ }
        else break
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items: items.map(parseInline) })
      continue
    }
    para.push(line.trim())
  }
  flushPara()
  return blocks
}

const inlineText = (nodes: Inline[]): string =>
  nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.s : inlineText(n.c))).join('')

/** The text without markup (for searching). */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'code': return b.text
        case 'hr': return ''
        case 'ul': case 'ol': return b.items.map(inlineText).join('\n')
        default: return inlineText(b.c)
      }
    })
    .join('\n')
}
