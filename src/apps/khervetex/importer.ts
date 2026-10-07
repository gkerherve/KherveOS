// LaTeX → document model: a port of the desktop's .tex importer
// (khervedoc/importers.py, import_tex). It reads the subset KherveTeX writes
// (sections, lists, maths, links, citations, cross-references, figures,
// tables, the formatting marks) and keeps anything else as raw LaTeX, so
// nothing is lost. Used by File ▸ Import and by edits in the Code tab.

import {
  classSupportsChapter, defaultMeta,
  type Abstract, type Block, type DocMeta, type Document, type Figure, type Inline, type Keywords, type Mark, type Paragraph,
  type Table, type Text,
} from './model'
import { isJournalClass, pyRound2, pyStrip } from './serializer'

// ----------------------------------------------------------------- helpers

const isAlpha = (c: string) => /^\p{L}$/u.test(c)

/** Read a balanced {...} starting at s[i]: [content, index after], or [null, i]. */
export function consumeBraced(s: string, i: number): [string | null, number] {
  if (i >= s.length || s[i] !== '{') return [null, i]
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') {
      depth--
      if (depth === 0) return [s.slice(i + 1, j), j + 1]
    }
  }
  return [null, i]
}

/** Skip spaces and [..] option groups (with spaces between them). */
function skipOptions(src: string, p: number): number {
  while (p < src.length && ' \t\n'.includes(src[p])) p++
  while (p < src.length && src[p] === '[') {
    let depth = 1
    let j = p + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '[') depth++
      else if (src[j] === ']') depth--
      j++
    }
    p = j
    while (p < src.length && ' \t\n'.includes(src[p])) p++
  }
  return p
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Search `re` (global) from position `pos`. */
function searchFrom(re: RegExp, s: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos
  return re.exec(s)
}

/** Remove every \command[opt]{arg}, braces balanced. */
function stripBalancedCommand(src: string, command: string): string {
  const pattern = new RegExp(`\\\\${escapeRe(command)}\\b`, 'g')
  const out: string[] = []
  let pos = 0
  for (;;) {
    const m = searchFrom(pattern, src, pos)
    if (!m) {
      out.push(src.slice(pos))
      return out.join('')
    }
    out.push(src.slice(pos, m.index))
    let p = skipOptions(src, m.index + m[0].length)
    if (p < src.length && src[p] === '{') p = consumeBraced(src, p)[1]
    pos = p > m.index ? p : m.index + m[0].length
  }
}

/** Drop % comments (not \\%), keeping the KHERVETEX compile markers. */
export function stripTexComments(src: string): string {
  return src.replace(/(?<!\\)%[^\n]*/g, (m) => (m.includes('KHERVETEX') ? m : ''))
}

/** The balanced argument of the first \command[opts]{…}, or null. */
function extractBraced(src: string, command: string): string | null {
  const m = new RegExp(`\\\\${escapeRe(command)}\\b`).exec(src)
  if (!m) return null
  const pos = skipOptions(src, m.index + m[0].length)
  if (pos >= src.length || src[pos] !== '{') return null
  return consumeBraced(src, pos)[0]
}

/** The serializer wraps one long author line in \parbox{\textwidth}{\centering …}: take it off again. */
function unwrapAuthorParbox(author: string): string {
  const head = '\\parbox{\\textwidth}{'
  let a = pyStrip(author)
  while (a.startsWith(head)) {
    const [arg, end] = consumeBraced(a, head.length - 1)
    if (arg === null || end !== a.length || !arg.startsWith('\\centering')) break
    a = pyStrip(arg.slice('\\centering'.length))
  }
  return a
}

/** Split an \author argument on top-level \\ line breaks. */
function splitAuthorLines(author: string): string[] {
  const parts: string[] = []
  let buf = ''
  let depth = 0
  let i = 0
  const n = author.length
  while (i < n) {
    const c = author[i]
    if (c === '\\' && i + 1 < n) {
      const nxt = author[i + 1]
      if (nxt === '\\' && depth === 0) {
        parts.push(buf)
        buf = ''
        i += 2
        continue
      }
      if ('{}\\'.includes(nxt)) {
        buf += c + nxt
        i += 2
        continue
      }
    } else if (c === '{') depth++
    else if (c === '}') depth--
    buf += c
    i++
  }
  parts.push(buf)
  return parts.map(pyStrip).filter(Boolean)
}

// -------------------------------------------------------------- the preamble

function extractPreambleExtras(src: string, stripAuthor: boolean): string {
  const doc = /\\documentclass\b/.exec(src)
  const body = /\\begin\{document\}/.exec(src)
  if (!doc || !body) return ''
  let pre = stripTexComments(src.slice(doc.index, body.index))
  pre = pre.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}/g, '')
  pre = pre.replace(/\\usepackage\{[^}]+\}/g, '')
  pre = pre.replace(/\\usepackage\[[^\]]*\]\{(?:geometry|setspace)\}/g, '')
  if (stripAuthor) {
    pre = stripBalancedCommand(pre, 'title')
    pre = stripBalancedCommand(pre, 'author')
    pre = stripBalancedCommand(pre, 'journal')
  }
  pre = pre.replace(/\\(?:provide|renew|new)command\{?\\Kstroke\}?.*/g, '')
  pre = pre.replace(/\n\s*\n+/g, '\n')
  return pyStrip(pre)
}

const BODY_FRONTMATTER_CMDS = [
  'author', 'address', 'authormark', 'titlemark', 'cortext', 'fntext', 'ead', 'journal', 'abstract', 'keywords',
  'corres', 'presentaddress', 'email',
]

/** Wiley-style classes put \author, \address… after \begin{document}: [commands, body without them]. */
function extractBodyFrontmatter(body: string): [string, string] {
  const boundary = /\\(?:maketitle|section|chapter)\b/.exec(body)
  if (!boundary) return ['', body]
  let cleaned = body.slice(0, boundary.index)
  const collected: string[] = []
  for (const cmd of [...BODY_FRONTMATTER_CMDS, 'title']) {
    const pat = new RegExp(`\\\\${escapeRe(cmd)}\\b`)
    for (;;) {
      const m = pat.exec(cleaned)
      if (!m) break
      const start = m.index
      let p = skipOptions(cleaned, m.index + m[0].length)
      if (p < cleaned.length && cleaned[p] === '{') p = consumeBraced(cleaned, p)[1]
      if (p <= start) p = m.index + m[0].length
      if (cmd !== 'title') collected.push(cleaned.slice(start, p))
      cleaned = cleaned.slice(0, start) + cleaned.slice(p)
    }
  }
  const rest = body.slice(boundary.index).replace(/\\maketitle\b\s*/, '')
  return [collected.join('\n'), pyStrip(cleaned) + '\n' + rest]
}

/** What lives in \begin{frontmatter} besides title, abstract and keywords (Elsevier). */
function extractFrontmatterExtras(src: string): string {
  const fm = /\\begin\{frontmatter\}([\s\S]*?)\\end\{frontmatter\}/.exec(src)
  if (!fm) return ''
  let body = stripBalancedCommand(fm[1], 'title')
  body = body.replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/g, '')
  body = body.replace(/\\begin\{keywords?\}[\s\S]*?\\end\{keywords?\}/g, '')
  body = body.replace(/\n\s*\n+/g, '\n')
  return pyStrip(body)
}

// ----------------------------------------------------------------- inlines

const MARK_MACROS: Record<string, Mark> = {
  textbf: 'bold', textit: 'italic', emph: 'italic', underline: 'underline', texttt: 'code', textsc: 'smallcaps',
  textsubscript: 'subscript', textsuperscript: 'superscript', sout: 'strikethrough',
}
const ESCAPED_SPECIAL = new Set(['%', '&', '$', '#', '_', '{', '}'])
const ACCENT_COMBINING: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
}

/** Reverse escapeText on a plain run. */
function unescapeText(s: string): string {
  return s
    .replaceAll('\\textbackslash{}', '\\')
    .replaceAll('\\textasciitilde{}', '~')
    .replaceAll('\\textasciicircum{}', '^')
    .replaceAll('\\{', '{').replaceAll('\\}', '}')
    .replaceAll('\\&', '&').replaceAll('\\%', '%')
    .replaceAll('\\$', '$').replaceAll('\\#', '#')
    .replaceAll('\\_', '_')
    .replaceAll('~', ' ')
}

const text = (t: string, marks: Mark[] = []): Text => ({ type: 'Text', text: t, marks })

function matchMacro(s: string, i: number): [Inline | Inline[], number] | null {
  // \%, \&, \$, \#, \_, \{, \}: literal text.
  if (i + 1 < s.length && ESCAPED_SPECIAL.has(s[i + 1])) return [text(s[i + 1]), i + 2]
  // Accents: \'e and \'{e} compose to é.
  if (i + 1 < s.length && ACCENT_COMBINING[s[i + 1]]) {
    const mark = ACCENT_COMBINING[s[i + 1]]
    const j = i + 2
    let base: string | null = null
    let end = j
    if (j < s.length && s[j] === '{') {
      const [arg, after] = consumeBraced(s, j)
      if (arg !== null && [...arg].length === 1 && isAlpha(arg)) {
        base = arg
        end = after
      }
    } else if (j < s.length && isAlpha(s[j])) {
      base = s[j]
      end = j + 1
    }
    if (base !== null) return [text((base + mark).normalize('NFC')), end]
  }
  const m = /^\\([A-Za-z@]+)\*?/.exec(s.slice(i))
  if (!m) {
    // A control symbol (\, \; \! \  \/ \@ …): keep it verbatim.
    if (i + 1 < s.length && /[,;:!/@ \-]/.test(s[i + 1])) return [{ type: 'InlineRaw', latex: s.slice(i, i + 2) }, i + 2]
    return null
  }
  const name = m[1]
  const after = i + m[0].length
  const mark = MARK_MACROS[name]
  if (mark) {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    const children = parseInlines(arg)
    for (const c of children) if (c.type === 'Text' && !c.marks.includes(mark)) c.marks.push(mark)
    return [children.length === 1 ? children[0] : children.length ? children : text(''), end]
  }
  if (name === 'href') {
    const [url, end] = consumeBraced(s, after)
    if (url === null) return null
    const [label, end2] = consumeBraced(s, end)
    if (label === null) return null
    return [{ type: 'Link', url, children: parseInlines(label) }, end2]
  }
  if (name === 'footnote') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [{ type: 'Footnote', children: parseInlines(arg) }, end]
  }
  if (name === 'cite' || name === 'citep' || name === 'citet') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [{ type: 'Citation', keys: arg.split(',').map(pyStrip).filter(Boolean), style: name }, end]
  }
  if (name === 'ref' || name === 'eqref' || name === 'pageref') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [{ type: 'CrossRef', label: arg, kind: name }, end]
  }
  if (name === 'label') {
    // Sections and figures attach their labels themselves.
    const [, end] = consumeBraced(s, after)
    return [text(''), end > after ? end : after]
  }
  if (name === 'url') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [{ type: 'Link', url: arg, children: [text(arg)] }, end]
  }
  if (name === 'sep') return [text(' · '), after]
  if (name === 'verb') {
    if (after >= s.length) return null
    const delim = s[after]
    const close = s.indexOf(delim, after + 1)
    if (close < 0) return null
    return [text(s.slice(after + 1, close), ['code']), close + 1]
  }
  // Unknown command: keep it, with its [..] and {..} arguments, as raw LaTeX.
  let pos = after
  while (pos < s.length && s[pos] === '[') {
    let depth = 1
    let j = pos + 1
    while (j < s.length && depth > 0) {
      if (s[j] === '[') depth++
      else if (s[j] === ']') depth--
      j++
    }
    pos = j
  }
  while (pos < s.length && s[pos] === '{') {
    const [, np] = consumeBraced(s, pos)
    if (np === pos) break
    pos = np
  }
  return [{ type: 'InlineRaw', latex: s.slice(i, pos) }, pos]
}

export function parseInlines(s: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  const n = s.length
  while (i < n) {
    const ch = s[i]
    if (ch === '$') {
      let j = s.indexOf('$', i + 1)
      if (j < 0) j = n
      out.push({ type: 'MathInline', latex: s.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (ch === '\\') {
      if (s[i + 1] === '\\') {
        out.push({ type: 'InlineRaw', latex: '\\\\' })
        i += 2
        continue
      }
      const m = matchMacro(s, i)
      if (m) {
        const [node, end] = m
        if (Array.isArray(node)) out.push(...node)
        else out.push(node)
        i = end
        continue
      }
    }
    const cands = [s.indexOf('$', i), s.indexOf('\\', i)].filter((c) => c >= 0)
    const end = cands.length ? Math.min(...cands) : n
    if (end === i) {
      out.push(text(unescapeText(s.slice(i, i + 1))))
      i += 1
    } else {
      out.push(text(unescapeText(s.slice(i, end))))
      i = end
    }
  }
  const merged: Inline[] = []
  for (const node of out) {
    if (node.type === 'Text' && node.text === '') continue
    const last = merged.at(-1)
    if (node.type === 'Text' && last?.type === 'Text' && [...last.marks].sort().join() === [...node.marks].sort().join()) {
      merged[merged.length - 1] = text(last.text + node.text, [...node.marks])
    } else merged.push(node)
  }
  return merged
}

// ------------------------------------------------------------------ blocks

const SECTION_LEVEL: Record<string, number> = {
  chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5,
}
const MATH_ENVS = [
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'eqnarray', 'eqnarray*', 'displaymath', 'split',
]

type BlockMatch = { index: number; end: number; groups: (string | undefined)[]; text: string }

const DISPATCH: [string, RegExp][] = [
  ['khervetex_marker', /% ===== KHERVETEX [A-Z ]+ =====/g],
  ['math_block_env', new RegExp(`\\\\begin\\{(${MATH_ENVS.map(escapeRe).join('|')})\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, 'g')],
  ['math_block_dd', /\$\$([\s\S]*?)\$\$/g],
  ['math_block_bs', /\\\[([\s\S]*?)\\\]/g],
  ['itemize', /\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g],
  ['enumerate', /\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g],
  ['figure', /\\begin\{figure\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{figure\}/g],
  ['figure_star', /\\begin\{figure\*\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{figure\*\}/g],
  ['table', /\\begin\{table\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{table\}/g],
  ['table_star', /\\begin\{table\*\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{table\*\}/g],
  ['standalone_tabular', /\\begin\{tabular\}(\{[\s\S]*?)\\end\{tabular\}/g],
  ['verbatim', /\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g],
  ['lstlisting', /\\begin\{lstlisting\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{lstlisting\}/g],
  ['abstract', /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g],
  ['keyword', /\\begin\{keywords?\}([\s\S]*?)\\end\{keywords?\}/g],
  ['bibliography', /\\begin\{thebibliography\}\{[^}]*\}([\s\S]*?)\\end\{thebibliography\}/g],
  ['flushleft', /\\begin\{flushleft\}([\s\S]*?)\\end\{flushleft\}/g],
  ['flushright', /\\begin\{flushright\}([\s\S]*?)\\end\{flushright\}/g],
  ['center', /\\begin\{center\}([\s\S]*?)\\end\{center\}/g],
  ['frame', /\\begin\{frame\}(?:\{([^}]*)\})?([\s\S]*?)\\end\{frame\}/g],
  ['maketitle', /\\maketitle\b/g],
  // Last resort: any other environment stays verbatim.
  ['unknown_env', /\\begin\{([A-Za-z@]+\*?)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g],
]

const SECTION_PREFIX_RE = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?=\{)/g

function scanSection(body: string, start: number): BlockMatch | null {
  const m = searchFrom(SECTION_PREFIX_RE, body, start)
  if (!m) return null
  let brace = m.index + m[0].length
  while (brace < body.length && ' \t\n'.includes(body[brace])) brace++
  if (brace >= body.length || body[brace] !== '{') return null
  const [content, end] = consumeBraced(body, brace)
  if (content === null) return null
  return { index: m.index, end, groups: [m[1], m[2], content], text: body.slice(m.index, end) }
}

/** \twocolumn[…] / \onecolumn[…] with their bracketed body, kept whole. */
function scanBracketArgMacro(body: string, start: number): BlockMatch | null {
  let best: BlockMatch | null = null
  for (const name of ['twocolumn', 'onecolumn']) {
    const m = searchFrom(new RegExp(`\\\\${name}(?![A-Za-z])\\s*\\[`, 'g'), body, start)
    if (!m) continue
    let j = m.index + m[0].length
    let depth = 1
    while (j < body.length && depth > 0) {
      if (body[j] === '[') depth++
      else if (body[j] === ']') depth--
      j++
    }
    if (depth !== 0) continue
    if (!best || m.index < best.index) best = { index: m.index, end: j, groups: [], text: body.slice(m.index, j) }
  }
  return best
}

const splitParagraphs = (chunk: string): string[] => chunk.split(/\n\s*\n/).map(pyStrip).filter(Boolean)

interface ParseContext {
  /** The \begin{frontmatter} title block is kept in frontmatter_extras (Elsevier). */
  frontmatterCaptured: boolean
  /** The class has \chapter, which the serializer writes for Heading 1. */
  chapters: boolean
}

export function parseBlocks(body: string, ctx: ParseContext = { frontmatterCaptured: false, chapters: false }): Block[] {
  const blocks: Block[] = []
  let i = 0
  const n = body.length
  while (i < n) {
    let bestKind: string | null = null
    let best: BlockMatch | null = null
    let bestStart = n
    const ba = scanBracketArgMacro(body, i)
    if (ba && ba.index < bestStart) {
      bestKind = 'bracket_arg_macro'
      best = ba
      bestStart = ba.index
    }
    const sec = scanSection(body, i)
    if (sec && sec.index < bestStart) {
      bestKind = 'section'
      best = sec
      bestStart = sec.index
    }
    for (const [kind, re] of DISPATCH) {
      const m = searchFrom(re, body, i)
      if (m && m.index < bestStart) {
        bestKind = kind
        best = { index: m.index, end: m.index + m[0].length, groups: m.slice(1), text: m[0] }
        bestStart = m.index
      }
    }
    if (bestStart > i) {
      for (const para of splitParagraphs(body.slice(i, bestStart))) {
        const children = parseInlines(para)
        if (children.length) blocks.push({ type: 'Paragraph', children, alignment: 'justify' })
      }
    }
    if (!best || !bestKind) break
    const node = dispatch(bestKind, best, ctx)
    if (Array.isArray(node)) blocks.push(...node)
    else if (node) blocks.push(node)
    i = Math.max(best.end, i + 1)
  }
  return blocks
}

function dispatch(kind: string, m: BlockMatch, ctx: ParseContext): Block | Block[] | null {
  const g = m.groups
  switch (kind) {
    case 'khervetex_marker':
    case 'bracket_arg_macro':
      return { type: 'RawLatex', text: m.text }
    case 'math_block_env': {
      const env = g[0] ?? 'equation'
      const body = pyStrip(g[1] ?? '')
      const latex = env === 'equation' || env === 'equation*' ? body : `\\begin{${env}}\n${body}\n\\end{${env}}`
      return { type: 'MathBlock', latex, numbered: !env.endsWith('*'), label: null }
    }
    case 'math_block_dd':
    case 'math_block_bs':
      return { type: 'MathBlock', latex: pyStrip(g[0] ?? ''), numbered: false, label: null }
    case 'section': {
      // In book-like classes Heading 1 is written \chapter, Heading 2 \section…: read it back the same way.
      const level = SECTION_LEVEL[g[0] ?? 'section'] ?? 1
      return { type: 'Section', level: ctx.chapters ? Math.min(5, level + 1) : level, numbered: (g[1] ?? '') === '', children: parseInlines(g[2] ?? ''), label: null }
    }
    case 'itemize':
      return parseList(g[0] ?? '', false)
    case 'enumerate':
      return parseList(g[0] ?? '', true)
    case 'figure':
      return parseFigure(g[0] ?? '')
    case 'figure_star':
    case 'table_star':
    case 'lstlisting':
    case 'bibliography':
      return { type: 'RawLatex', text: m.text }
    case 'table':
      return parseTableEnv(g[0] ?? '')
    case 'standalone_tabular': {
      const raw = g[0] ?? ''
      const [spec, end] = consumeBraced(raw, 0)
      return parseTabular(spec ?? '', raw.slice(end))
    }
    case 'verbatim':
      return { type: 'RawLatex', text: `\\begin{verbatim}${g[0] ?? ''}\\end{verbatim}` }
    case 'abstract':
      return splitParagraphs(g[0] ?? '').map((p): Abstract => ({ type: 'Abstract', children: parseInlines(p) }))
    case 'keyword': {
      const parts = (g[0] ?? '').split(/\\sep\b\s*/).map(pyStrip).filter(Boolean)
      if (!parts.length) return []
      const inlines: Inline[] = []
      parts.forEach((part, i) => {
        if (i > 0) inlines.push(text(' · '))
        inlines.push(...parseInlines(part))
      })
      return [{ type: 'Keywords', children: inlines } as Keywords]
    }
    case 'flushleft':
    case 'flushright':
    case 'center': {
      const align = { flushleft: 'left', flushright: 'right', center: 'center' }[kind]
      const sub = parseBlocks(g[0] ?? '', ctx)
      for (const b of sub) if (b.type === 'Paragraph') (b as Paragraph).alignment = align
      return sub
    }
    case 'unknown_env':
      if (g[0] === 'frontmatter') {
        const inner = g[1] ?? ''
        if (!ctx.frontmatterCaptured) return parseBlocks(inner, ctx)
        // The title, authors and addresses live in frontmatter_extras; parsing them here too
        // put a copy in the body (one more with every Code-tab edit). Keep abstract and keywords.
        const kept = [...inner.matchAll(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}|\\begin\{keywords?\}[\s\S]*?\\end\{keywords?\}/g)]
        return parseBlocks(kept.map((x) => x[0]).join('\n\n'), ctx)
      }
      return { type: 'RawLatex', text: m.text }
    case 'frame': {
      const title = pyStrip(g[0] ?? '')
      const body = pyStrip(g[1] ?? '')
      if (body.includes('\\titlepage')) return [{ type: 'Title', children: title ? [text(title)] : [] }]
      return [{ type: 'Frame', children: title ? parseInlines(title) : [] }, ...parseBlocks(body, ctx)]
    }
    case 'maketitle':
      return null
  }
  return null
}

function parseList(body: string, ordered: boolean): Block {
  const items = body
    .split(/\\item\b/)
    .slice(1)
    .map(pyStrip)
    .filter(Boolean)
    .map((t) => ({ type: 'ListItem' as const, children: parseInlines(t) }))
  return { type: 'List', ordered, items }
}

function parseFigure(body: string): Figure {
  const inc = /\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/.exec(body)
  const cap = /\\caption\{/.exec(body)
  let caption = ''
  if (cap) caption = pyStrip(consumeBraced(body, cap.index + cap[0].length - 1)[0] ?? '')
  const lab = /\\label\{([^}]*)\}/.exec(body)
  let width = '0.8\\textwidth'
  if (inc) {
    const opts = inc[1] ?? ''
    const wm = /width\s*=\s*([^,\]]+)/.exec(opts)
    if (wm) width = pyStrip(wm[1])
    else if (!pyStrip(opts)) width = '\\columnwidth'
  }
  return { type: 'Figure', path: inc ? inc[2] : '', caption, label: lab ? lab[1] : null, width, source: '' }
}

function parseTableEnv(body: string): Block {
  const start = /\\begin\{tabular\}\{/.exec(body)
  const end = /\\end\{tabular\}/.exec(body)
  const cap = /\\caption\{/.exec(body)
  let caption = ''
  if (cap) caption = pyStrip(consumeBraced(body, cap.index + cap[0].length - 1)[0] ?? '')
  const lab = /\\label\{([^}]*)\}/.exec(body)
  if (!start || !end) return { type: 'RawLatex', text: `\\begin{table}${body}\\end{table}` }
  const [spec, after] = consumeBraced(body, start.index + start[0].length - 1)
  const table = parseTabular(spec ?? '', body.slice(after, end.index))
  table.caption = caption
  table.label = lab ? lab[1] : null
  return table
}

function parseTabular(spec: string, body: string): Table {
  const style = /\\(toprule|midrule|bottomrule)\b/.test(body) ? 'booktabs' : ''
  body = body.replace(/\\hline\b/g, '').replace(/\\toprule|\\midrule|\\bottomrule|\\cline\{[^}]*\}/g, '')
  const rows: string[][] = []
  for (const raw of body.split(/\\\\\s*/)) {
    const line = pyStrip(raw)
    if (line) rows.push(line.split('&').map(pyStrip))
  }
  return { type: 'Table', rows, caption: '', label: null, alignment: pyStrip(spec), style }
}

// ---------------------------------------------------------------- includes

const INCLUDE_RE = /\\(input|include|subfile)\s*\{([^}]+)\}|\\(?:sub)?import\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g

/** Inline \input, \include, \subfile and \import targets, read with `read` (null when missing). */
export async function expandIncludes(
  src: string, baseDir: string, read: (path: string) => Promise<string | null>, seen = new Set<string>(), depth = 0,
): Promise<string> {
  src = stripTexComments(src)
  if (depth > 20) return src
  const parts: string[] = []
  let last = 0
  for (const m of src.matchAll(INCLUDE_RE)) {
    parts.push(src.slice(last, m.index))
    last = m.index! + m[0].length
    const kind = m[1] ?? 'import'
    const relDir = m[1] ? '' : pyStrip(m[3] ?? '')
    const name = pyStrip(m[1] ? m[2] : m[4] ?? '')
    let target = normalizePath([baseDir, relDir, name].filter(Boolean).join('/'))
    let child = seen.has(target) ? null : await read(target)
    if (child === null && !target.endsWith('.tex')) {
      target += '.tex'
      child = seen.has(target) ? null : await read(target)
    }
    if (child === null) {
      parts.push(m[0])
      continue
    }
    const body = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(child)
    if (body) child = body[1]
    const childBase = kind === 'import' ? target.slice(0, target.lastIndexOf('/')) || '/' : baseDir
    parts.push('\n' + (await expandIncludes(child, childBase, read, new Set([...seen, target]), depth + 1)) + '\n')
  }
  parts.push(src.slice(last))
  return parts.join('')
}

function normalizePath(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

// ---------------------------------------------------------------- import_tex

const STANDARD_CLASSES = new Set(['article', 'report', 'book', 'letter', 'memoir', 'beamer', 'scrartcl', 'scrreprt', 'scrbook'])

/**
 * Parse LaTeX into a document. Unknown commands and environments stay as raw
 * LaTeX. `unwrapColumns`: a body wrapped whole in multicols{N} (how KherveTeX
 * writes 3+ columns) becomes N columns instead of one raw block.
 */
export function importTex(source: string, opts: { unwrapColumns?: boolean } = {}): Document {
  source = stripTexComments(source)
  const docclass = /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/.exec(source)
  const titleText = extractBraced(source, 'title')
  const rawAuthor = extractBraced(source, 'author')
  const authorText = rawAuthor === null ? null : unwrapAuthorParbox(rawAuthor)
  const geom = /\\usepackage\[([^\]]*)\]\{geometry\}/.exec(source)
  const packages = [...source.matchAll(/\\usepackage\{([^}]+)\}/g)].map((m) => m[1]).filter((p) => p !== 'geometry' && p !== 'setspace')

  let pageSize = 'A4'
  const margins: Record<string, number> = { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 }
  if (geom) {
    const opts = geom[1].toLowerCase()
    if (opts.includes('letterpaper')) pageSize = 'Letter'
    else if (opts.includes('legalpaper')) pageSize = 'Legal'
    else if (opts.includes('a4paper')) pageSize = 'A4'
    for (const side of Object.keys(margins)) {
      const dm = new RegExp(`${side}\\s*=\\s*([\\d.]+)\\s*(in|cm|mm|pt)`).exec(opts)
      if (dm) {
        let val = Number(dm[1])
        if (dm[2] === 'in') val *= 2.54
        else if (dm[2] === 'mm') val /= 10
        else if (dm[2] === 'pt') val *= 0.03528
        if (Number.isFinite(val)) margins[side] = pyRound2(val)
      }
    }
  }

  const authorClean = authorText ? pyStrip(authorText.replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, '')) : ''
  const authorIsRich = !!authorText && /\\[A-Za-z@]+|\\\\/.test(authorText)
  const docClass = docclass ? docclass[1] : 'article'
  const isStandard = STANDARD_CLASSES.has(docClass.toLowerCase())

  const optsMatch = /\\documentclass\[([^\]]*)\]\{[^}]+\}/.exec(source)
  const rawOpts = optsMatch ? pyStrip(optsMatch[1]) : ''
  const classOpts = rawOpts ? rawOpts.split(',').map(pyStrip) : []
  let bodyPt = 12
  for (const o of classOpts) {
    const pt = /^(\d+)pt$/.exec(o)
    if (pt) {
      bodyPt = Number(pt[1])
      break
    }
  }
  const columns = classOpts.includes('twocolumn') ? 2 : 1
  // The serializer writes the size and twocolumn itself for these classes (elsarticle
  // too): keeping them here as well doubled them on every Code-tab edit.
  const rebuilt = isStandard || !isJournalClass(docClass)
  const classOptions = rebuilt
    ? classOpts.filter((o) => o && !/^\d+pt$/.test(o) && o !== 'twocolumn' && o !== 'onecolumn').join(',')
    : rawOpts

  const isElsarticle = docClass.toLowerCase().startsWith('elsarticle')
  let frontmatterExtras = isElsarticle ? extractFrontmatterExtras(source) : ''
  const preambleExtras = extractPreambleExtras(source, isStandard)
  const keepRawAuthor = isStandard && !isElsarticle && authorIsRich
  const meta: DocMeta = defaultMeta({
    title: pyStrip(titleText ?? ''),
    author: keepRawAuthor ? pyStrip(authorText ?? '') : authorClean,
    documentclass: docClass,
    class_options: classOptions,
    packages: packages.length ? packages : ['amsmath', 'graphicx'],
    page_size: pageSize,
    margin_top_cm: margins.top,
    margin_bottom_cm: margins.bottom,
    margin_left_cm: margins.left,
    margin_right_cm: margins.right,
    body_font_pt: bodyPt,
    column_count: columns,
    frontmatter_extras: frontmatterExtras,
    preamble_extras: preambleExtras,
  })

  const bodyMatch = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(source)
  let body = bodyMatch ? bodyMatch[1] : source
  if (opts.unwrapColumns && isStandard) {
    const mc = /^\s*\\begin\{multicols\}\{(\d+)\}([\s\S]*)\\end\{multicols\}(\s*(?:\\bibliographystyle\{[^}]*\}\s*\\bibliography\{[^}]*\}\s*)?)$/.exec(body)
    if (mc && Number(mc[1]) >= 3 && !mc[2].includes('\\begin{multicols}')) {
      body = mc[2] + mc[3]
      meta.column_count = Number(mc[1])
    }
  }

  let bodyAbstract = ''
  let bodyKeywords = ''
  if (!isStandard && !isElsarticle) {
    let fm: string
    ;[fm, body] = extractBodyFrontmatter(body)
    if (fm) {
      const abs = extractBraced(fm, 'abstract')
      if (abs !== null) {
        bodyAbstract = abs
        fm = stripBalancedCommand(fm, 'abstract')
      }
      const kw = extractBraced(fm, 'keywords')
      if (kw !== null) {
        bodyKeywords = kw
        fm = stripBalancedCommand(fm, 'keywords')
      }
      frontmatterExtras = pyStrip(fm)
      meta.frontmatter_extras = frontmatterExtras
    }
  }

  const children = parseBlocks(body, { frontmatterCaptured: isElsarticle && !!frontmatterExtras, chapters: classSupportsChapter(docClass) })

  // A beamer \titlepage frame gives an empty Title: it takes the \title.
  const emptyTitle = children.find((b) => b.type === 'Title' && !b.children.length)
  if (titleText && emptyTitle && emptyTitle.type === 'Title') {
    const inl = parseInlines(titleText)
    emptyTitle.children = inl.length ? inl : [text(titleText)]
    meta.title = ''
  }
  if (titleText && !children.some((b) => b.type === 'Title')) {
    const inl = parseInlines(titleText)
    children.unshift({ type: 'Title', children: inl.length ? inl : [text(titleText)] })
    meta.title = ''
  }
  if (authorText && !children.some((b) => b.type === 'Author')) {
    let at = children.findIndex((b) => b.type === 'Title') + 1
    for (const line of splitAuthorLines(authorText)) {
      const inl = parseInlines(line)
      if (inl.length) children.splice(at++, 0, { type: 'Author', children: inl })
    }
  }
  if (bodyAbstract && !children.some((b) => b.type === 'Abstract')) {
    const inl = parseInlines(bodyAbstract)
    let pos = 0
    children.forEach((b, idx) => {
      if (b.type === 'Title' || b.type === 'Author') pos = idx + 1
    })
    children.splice(pos, 0, { type: 'Abstract', children: inl.length ? inl : [text(bodyAbstract)] })
  }
  if (bodyKeywords && !children.some((b) => b.type === 'Keywords')) {
    const inl = parseInlines(bodyKeywords)
    let pos = 0
    children.forEach((b, idx) => {
      if (b.type === 'Title' || b.type === 'Author' || b.type === 'Abstract') pos = idx + 1
    })
    children.splice(pos, 0, { type: 'Keywords', children: inl.length ? inl : [text(bodyKeywords)] })
  }
  return { type: 'Document', children, meta }
}

// ----------------------------------------- reading back KherveTeX's own lines

const FONT_LINES: [string, string[], string[]][] = [
  // [family, option-less packages, other preamble lines]
  ['helvetica', ['helvet'], ['\\renewcommand{\\familydefault}{\\sfdefault}']],
  ['courier', ['courier'], ['\\renewcommand{\\familydefault}{\\ttdefault}']],
  ['charter', [], ['\\usepackage[bitstream-charter]{mathdesign}']],
  ['times', ['times'], []],
  ['palatino', ['palatino'], []],
  ['libertine', ['libertine'], []],
]

/**
 * After importing LaTeX (an edit in the Code tab, or a .tex file), put the
 * settings a standard class's preamble encodes the way KherveTeX writes
 * them — line spacing, paragraph indent, output font — back into the
 * document settings, where the Settings dialog shows them. The LaTeX that
 * comes out again is the same.
 */
export function adoptSerializerPreamble(doc: Document): Document {
  if (isJournalClass(doc.meta.documentclass)) return doc
  const m = { ...doc.meta, packages: [...doc.meta.packages] }
  let lines = m.preamble_extras.split('\n').map((l) => l.trim())
  const take = (pred: (l: string) => boolean): string | undefined => {
    const i = lines.findIndex(pred)
    if (i < 0) return undefined
    const [l] = lines.splice(i, 1)
    return l
  }
  if (take((l) => l === '\\onehalfspacing')) m.line_spacing = 1.5
  else if (take((l) => l === '\\doublespacing')) m.line_spacing = 2.0
  else {
    const st = lines.find((l) => /^\\setstretch\{[\d.]+\}$/.test(l))
    if (st) {
      take((l) => l === st)
      m.line_spacing = Number(/\{([\d.]+)\}/.exec(st)![1])
    }
  }
  if (lines.includes('\\setlength{\\parindent}{0pt}') && lines.includes('\\setlength{\\parskip}{0.8em}')) {
    take((l) => l === '\\setlength{\\parindent}{0pt}')
    take((l) => l === '\\setlength{\\parskip}{0.8em}')
    m.paragraph_indent = false
  }
  if (m.body_font_family === 'default') {
    for (const [family, pkgs, extras] of FONT_LINES) {
      if (pkgs.every((p) => m.packages.includes(p)) && extras.every((e) => lines.includes(e)) && (pkgs.length || extras.length)) {
        m.packages = m.packages.filter((p) => !pkgs.includes(p))
        lines = lines.filter((l) => !extras.includes(l))
        m.body_font_family = family
        break
      }
    }
  }
  m.preamble_extras = lines.filter(Boolean).join('\n')
  return { ...doc, meta: m }
}
