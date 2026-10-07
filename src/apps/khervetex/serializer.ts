// Document model → LaTeX: a line-by-line port of khervedoc/serializer.py, so
// KherveOS produces exactly the LaTeX the desktop KherveTeX produces for the
// same document (checked against the Python serializer on every example).
// Pure functions, no I/O.

import {
  citedKeys, classSupportsChapter, HIGHLIGHT_COLORS, pyFloat,
  type Block, type DocMeta, type Document, type Figure, type Inline, type Keywords,
} from './model'
import { pageSizeByCode } from './pageSizes'

// ------------------------------------------------- Python string helpers

// Python's str.isspace() characters (JS's \\s differs on a few).
const PY_WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const RE_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g')
const RE_LSTRIP = new RegExp(`^[${PY_WS}]+`)

export const pyStrip = (s: string): string => s.replace(RE_STRIP, '')
export const pyLstrip = (s: string): string => s.replace(RE_LSTRIP, '')

/** str.strip(chars) */
function stripChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

/** str.rstrip(chars) */
function rstripChars(s: string, chars: string): string {
  let b = s.length
  while (b > 0 && chars.includes(s[b - 1])) b--
  return s.slice(0, b)
}

/** str.capitalize() */
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s
}

/** len() in code points. */
const pyLen = (s: string): number => [...s].length

/** Python's round(x, 2) (half to even on the exact value), as a float. */
export function pyRound2(x: number): number {
  const eighths = x * 8
  if (Number.isInteger(eighths) && eighths % 2 !== 0) {
    // x = m/8 with m odd: an exact tie in the third decimal.
    const lo = Math.floor(x * 100)
    return (lo % 2 === 0 ? lo : lo + 1) / 100
  }
  return Number(x.toFixed(2))
}

// ------------------------------------------------------------- escaping

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\u00a0': '~',
}

export function escapeText(s: string): string {
  let out = ''
  for (const ch of s) out += LATEX_ESCAPES[ch] ?? ch
  return out
}

/** Escape only unbalanced braces, leaving balanced groups (and \\x pairs) intact. */
function guardStrayBraces(p: string): string {
  const out: string[] = []
  const open: number[] = []
  let i = 0
  const n = p.length
  while (i < n) {
    const ch = p[i]
    if (ch === '\\' && i + 1 < n) {
      out.push(p.slice(i, i + 2))
      i += 2
      continue
    }
    if (ch === '{') {
      open.push(out.length)
      out.push('{')
    } else if (ch === '}') {
      if (open.length) {
        open.pop()
        out.push('}')
      } else out.push('\\}')
    } else out.push(ch)
    i += 1
  }
  for (const idx of open) out[idx] = '\\{'
  return out.join('')
}

const RE_AUTHOR_SPLIT = new RegExp(`[${PY_WS}]*\\\\\\\\[${PY_WS}]*|\\n`)

/** The author metadata for \\author{...}: LaTeX passes through, lines become \\\\. */
export function escapeAuthor(s: string): string {
  const parts = pyStrip(s).split(RE_AUTHOR_SPLIT)
  const lines: string[] = []
  for (let p of parts) {
    p = pyStrip(p)
    if (p) {
      p = p.replace(/(?<!\\)([&%#$])/g, '\\$1')
      lines.push(guardStrayBraces(p))
    }
  }
  return lines.join(' \\\\\n')
}

// --------------------------------------------------------------- inlines

const MARK_WRAPPERS: Record<string, [string, string]> = {
  bold: ['\\textbf{', '}'],
  italic: ['\\textit{', '}'],
  underline: ['\\underline{', '}'],
  code: ['\\texttt{', '}'],
  smallcaps: ['\\textsc{', '}'],
  subscript: ['\\textsubscript{', '}'],
  superscript: ['\\textsuperscript{', '}'],
  strikethrough: ['\\sout{', '}'],
}

// Outermost first; iteration reverses so the first mark here wraps last.
const SERIALIZE_MARK_ORDER = ['bold', 'italic', 'underline', 'smallcaps', 'subscript', 'superscript', 'strikethrough', 'code']

export function serializeInline(node: Inline): string {
  switch (node.type) {
    case 'Text': {
      let s = escapeText(node.text)
      for (const mark of [...SERIALIZE_MARK_ORDER].reverse()) {
        if ((node.marks as string[]).includes(mark)) {
          const [open, close] = MARK_WRAPPERS[mark]
          s = `${open}${s}${close}`
        }
      }
      return s
    }
    case 'MathInline':
      return `$${node.latex}$`
    case 'Link': {
      const body = serializeInlines(node.children)
      // A bare URL is emitted as \url{} so it can wrap (with xurl); custom text keeps \href.
      if (!body || body === escapeText(node.url)) return `\\url{${node.url}}`
      return `\\href{${node.url}}{${body}}`
    }
    case 'Footnote':
      return `\\footnote{${serializeInlines(node.children)}}`
    case 'Citation':
      return `\\${node.style}{${node.keys.join(',')}}`
    case 'CrossRef':
      return `\\${node.kind}{${node.label}}`
    case 'InlineRaw':
      return node.latex
    case 'Highlight':
      return `\\colorbox{hl${capitalize(node.color)}}{${serializeInlines(node.children)}}`
    case 'Comment': {
      const body = serializeInlines(node.children)
      const note = node.note.replaceAll('{', '\\{').replaceAll('}', '\\}')
      const authorOpt = node.author ? `, author={${node.author}}` : ''
      return `${body}\\todo[color=blue!20${authorOpt}]{${note}}`
    }
  }
}

export function serializeInlines(nodes: Inline[]): string {
  return nodes.map(serializeInline).join('')
}

// ---------------------------------------------------------------- blocks

const SECTION_COMMANDS: Record<number, string> = {
  0: 'chapter', 1: 'section', 2: 'subsection', 3: 'subsubsection', 4: 'paragraph', 5: 'subparagraph',
}

// Vector siblings each figure source keeps beside its PNG preview.
const VECTOR_SIBLINGS: Record<string, string[]> = { drawing: ['.pdf', '.svg'], flowchart: ['.pdf'] }

/** The path to emit for a figure: drawings and flowcharts give LaTeX their PDF sibling. */
export function figureOutputPath(node: Figure, vectorExt: string): string {
  let path = node.path.replaceAll('\\', '/')
  if ((VECTOR_SIBLINGS[node.source] ?? []).includes(vectorExt) && path.toLowerCase().endsWith('.png')) {
    path = path.slice(0, -4) + vectorExt
  }
  return path
}

const maybeLabel = (label: string | null): string => (label ? `\\label{${label}}\n` : '')

const ALIGN_ENVS: Record<string, string> = { left: 'flushleft', center: 'center', right: 'flushright' }

/** Column specs that fit on the page: bare l columns, or proportional p{} ones for wide tables. */
function autoTableAlignment(rows: string[][], cols: number): string {
  const maxLens = new Array<number>(cols).fill(0)
  for (const r of rows) {
    for (let j = 0; j < Math.min(r.length, cols); j++) maxLens[j] = Math.max(maxLens[j], pyLen(r[j]))
  }
  const total = maxLens.reduce((a, b) => a + b, 0) || 1
  if (total <= 80) return 'l'.repeat(cols)
  const usable = 0.95
  return maxLens
    .map((ml) => {
      const frac = Math.max(pyRound2((usable * ml) / total), 0.06)
      return `p{${frac.toFixed(2)}\\textwidth}`
    })
    .join('')
}

export function serializeBlock(node: Block, opts: { hasChapters?: boolean; floatH?: boolean } = {}): string {
  const hasChapters = opts.hasChapters ?? false
  const floatH = opts.floatH ?? true
  switch (node.type) {
    case 'Paragraph': {
      const body = serializeInlines(node.children)
      // LaTeX justifies by default; other alignments get an environment.
      const env = ALIGN_ENVS[node.alignment]
      if (env) return `\\begin{${env}}\n${body}\n\\end{${env}}\n`
      return body + '\n'
    }
    case 'Section': {
      // In report/book/memoir, Heading 1 is the class's top level: \chapter.
      const effective = hasChapters ? node.level - 1 : node.level
      const cmd = SECTION_COMMANDS[Math.max(0, Math.min(5, effective))] ?? 'section'
      const star = node.numbered ? '' : '*'
      return `\\${cmd}${star}{${serializeInlines(node.children)}}\n${maybeLabel(node.label)}`
    }
    case 'MathBlock': {
      // align*, gather… arrive as a complete \begin{env}…\end{env}: emit verbatim.
      if (pyLstrip(node.latex).startsWith('\\begin{')) return `${node.latex}\n`
      const env = node.numbered ? 'equation' : 'equation*'
      const lab = node.numbered ? maybeLabel(node.label) : ''
      return `\\begin{${env}}\n${lab}${node.latex}\n\\end{${env}}\n`
    }
    case 'List': {
      const env = node.ordered ? 'enumerate' : 'itemize'
      const items = node.items.map((it) => `  \\item ${serializeInlines(it.children)}\n`).join('')
      return `\\begin{${env}}\n${items}\\end{${env}}\n`
    }
    case 'Figure': {
      const path = figureOutputPath(node, '.pdf')
      // The caption is raw LaTeX: emitted verbatim.
      const lab = node.label ? maybeLabel(node.label) : ''
      const placement = floatH ? 'H' : 'htbp'
      return (
        `\\begin{figure}[${placement}]\n` +
        '  \\centering\n' +
        `  \\includegraphics[width=${node.width}]{${path}}\n` +
        `  \\caption{${node.caption}}\n` +
        `  ${lab}` +
        '\\end{figure}\n'
      )
    }
    case 'Table': {
      if (!node.rows.length) return ''
      const cols = Math.max(...node.rows.map((r) => r.length))
      const booktabs = node.style === 'booktabs'
      const topRule = booktabs ? '\\toprule' : '\\hline'
      const bottomRule = booktabs ? '\\bottomrule' : '\\hline'
      let align = pyStrip(node.alignment)
      if (!align) align = autoTableAlignment(node.rows, cols)
      const bodyRows = node.rows.map((r, i) => {
        // Cells are raw LaTeX: emitted verbatim; short rows are padded.
        const cells = [...r, ...new Array<string>(cols - r.length).fill('')]
        let row = cells.join(' & ') + ' \\\\'
        if (i === 0 && node.rows.length > 1) row += booktabs ? ' \\midrule' : ' \\hline'
        return row
      })
      const lab = node.label ? maybeLabel(node.label) : ''
      const placement = floatH ? 'H' : 'htbp'
      return (
        `\\begin{table}[${placement}]\n` +
        '  \\centering\n' +
        `  \\begin{tabular}{${align}}\n` +
        `    ${topRule}\n` +
        `    ${bodyRows.join('\n    ')}\n` +
        `    ${bottomRule}\n` +
        '  \\end{tabular}\n' +
        `  \\caption{${node.caption}}\n` +
        `  ${lab}` +
        '\\end{table}\n'
      )
    }
    case 'RawLatex':
      return node.text + (node.text.endsWith('\n') ? '' : '\n')
    case 'Title':
      // \title{} goes in the preamble (serializeDocument); here only \maketitle.
      return '\\maketitle\n'
    case 'Affiliation':
    case 'Correspondence':
    case 'Author':
      // Pulled into \author{} in the preamble; \maketitle prints them.
      return ''
    case 'Abstract':
      // Only for a lone Abstract: serializeDocument merges consecutive ones.
      return `\\begin{abstract}\n${serializeInlines(node.children)}\n\\end{abstract}\n`
    case 'Keywords':
      return `\\begin{keyword}\n${serializeInlines(node.children)}\n\\end{keyword}\n`
    case 'Frame':
      return serializeInlines(node.children)
  }
}

// -------------------------------------------------------------- preamble

/** \\usepackage{xurl} when the document has a URL, so long links can wrap. */
function withUrlBreaking(packages: string, ...scanned: string[]): string {
  const combined = scanned.join('')
  if ((combined.includes('\\url') || combined.includes('\\href')) && !packages.includes('xurl')) {
    return packages + '\n\\usepackage{xurl}'
  }
  return packages
}

/** (highlight colours used, has comments) — like the desktop, lists are not looked at. */
function collectReviewUsage(doc: Document): [Set<string>, boolean] {
  const colors = new Set<string>()
  let hasComments = false
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'Highlight') {
        colors.add(node.color)
        walk(node.children)
      } else if (node.type === 'Comment') {
        hasComments = true
        walk(node.children)
      } else if (node.type === 'Link' || node.type === 'Footnote') walk(node.children)
    }
  }
  for (const block of doc.children) {
    if ('children' in block) walk(block.children)
  }
  return [colors, hasComments]
}

function reviewPreamble(colors: Set<string>, hasComments: boolean): string {
  const lines: string[] = []
  if (colors.size) {
    lines.push('\\usepackage{xcolor}')
    for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
      if (colors.has(name)) lines.push(`\\definecolor{hl${capitalize(name)}}{HTML}{${hex.replace(/^#+/, '')}}`)
    }
  }
  if (hasComments) lines.push('\\usepackage[colorinlistoftodos]{todonotes}')
  return lines.join('\n')
}

const FONT_FAMILY_PACKAGES: Record<string, string> = {
  default: '',
  times: '\\usepackage{times}',
  palatino: '\\usepackage{palatino}',
  helvetica: '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}',
  courier: '\\usepackage{courier}\n\\renewcommand{\\familydefault}{\\ttdefault}',
  charter: '\\usepackage[bitstream-charter]{mathdesign}',
  libertine: '\\usepackage{libertine}',
}

const STANDARD_CLASSES = new Set(['article', 'report', 'book', 'letter', 'memoir', 'beamer', 'scrartcl', 'scrreprt', 'scrbook', 'elsarticle'])

/** Is this a journal/custom class that sets its own layout (no geometry, fonts, spacing)? */
export function isJournalClass(documentclass: string): boolean {
  return !STANDARD_CLASSES.has((documentclass || '').toLowerCase())
}

function classOptions(m: DocMeta): string {
  const raw = m.class_options ?? ''
  if (isJournalClass(m.documentclass)) return raw
  const opts = [`${m.body_font_pt}pt`]
  if (m.column_count === 2) opts.push('twocolumn')
  if (raw) for (const o of raw.split(',')) if (pyStrip(o)) opts.push(pyStrip(o))
  return opts.join(',')
}

function documentclassLine(m: DocMeta): string {
  const opts = classOptions(m)
  return opts ? `\\documentclass[${opts}]{${m.documentclass}}` : `\\documentclass{${m.documentclass}}`
}

const wrapMulticols = (body: string, n: number): string => `\\begin{multicols}{${n}}\n${body}\\end{multicols}\n`

// KherveTeX's \Kstroke (a K with a stroke). \providecommand, after the user's
// preamble, so a document defining its own keeps it.
const KSTROKE_PROVIDE = '\\providecommand{\\Kstroke}{K\\hspace{-0.55em}\\raisebox{-0.5ex}{\\rotatebox{40}{--}}\\hspace{-0.1em}}'

/** Keyword terms from Keywords blocks (the importer joins them with " · "). */
function splitKeywordInlines(blocks: Keywords[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    const line = pyStrip(serializeInlines(block.children))
    if (!line) continue
    for (let term of line.split(' · ')) {
      term = stripChars(term, ' \t\n')
      if (term) out.push(term)
    }
  }
  return out
}

/** \\bibliography{kherveref} — the name of the cited KherveRef entries' .bib. */
export const BIB_NAME = 'kherveref'
const NATBIB_STYLES = new Set(['plainnat', 'abbrvnat', 'unsrtnat'])

function withKherverefBibliography(doc: Document, body: string): [string, boolean] {
  const m = doc.meta
  if (!m.ref_library || !citedKeys(doc).length) return [body, false]
  const existing = /\\bibliography\{([^}]*)\}/.exec(body)
  if (existing) {
    const names = existing[1].split(',').map(pyStrip)
    if (!names.includes(BIB_NAME)) {
      body = body.slice(0, existing.index) + '\\bibliography{' + [...names, BIB_NAME].join(',') + '}' +
        body.slice(existing.index + existing[0].length)
    }
    return [body, false]
  }
  if (body.includes('\\printbibliography') || body.includes('{thebibliography}')) return [body, false]
  const style = m.bib_style || 'plainnat'
  body = rstripChars(body, '\n') + `\n\n\\bibliographystyle{${style}}\n\\bibliography{${BIB_NAME}}\n`
  return [body, NATBIB_STYLES.has(style)]
}

function withNatbib(packages: string, m: DocMeta): string {
  if (packages.includes('{natbib}') || (m.preamble_extras || '').includes('{natbib}') ||
      (m.class_options || '').includes('usenatbib') || (m.documentclass || '').toLowerCase().startsWith('elsarticle')) {
    return packages
  }
  return packages + '\n\\usepackage{natbib}'
}

function usesBooktabs(doc: Document): boolean {
  return doc.children.some((b) => b.type === 'Table' && b.style === 'booktabs')
}

/** (title, author lines, affiliations, correspondence) from the title-block blocks. */
function titleBlockParts(children: Block[], isElsarticle = false): [string | null, string[], string[], string[]] {
  let inlineTitle: string | null = null
  const authorParts: string[] = []
  const affiliationParts: string[] = []
  const correspondenceParts: string[] = []
  for (const block of children) {
    if (block.type === 'Title' && inlineTitle === null) {
      inlineTitle = serializeInlines(block.children)
    } else if (block.type === 'Author') {
      const part = serializeInlines(block.children)
      if (part) authorParts.push(part)
    } else if (block.type === 'Affiliation') {
      const part = serializeInlines(block.children)
      if (part) {
        affiliationParts.push(part)
        // Elsevier classes take affiliations as \address{}; elsewhere they sit under the names.
        if (!isElsarticle) authorParts.push(`{\\small\\itshape ${part}}`)
      }
    } else if (block.type === 'Correspondence') {
      const part = serializeInlines(block.children)
      if (part) correspondenceParts.push(part)
    }
  }
  if (correspondenceParts.length) {
    const note = correspondenceParts.join(' ')
    const mark = isElsarticle ? '\\corref{cor1}' : `\\thanks{${note}}`
    if (authorParts.length) authorParts[0] += mark
    else if (!isElsarticle) authorParts.push(mark)
  }
  return [inlineTitle, authorParts, affiliationParts, correspondenceParts]
}

// ---------------------------------------------------------------- document

export function serializeDocument(doc: Document): string {
  const m = doc.meta
  const page = pageSizeByCode(m.page_size)
  const klass = (m.documentclass || '').toLowerCase()
  const isElsarticle = klass.startsWith('elsarticle')
  const isBeamer = klass === 'beamer'
  const hasChapters = classSupportsChapter(m.documentclass || '')
  // Journal classes carry their own layout: no geometry, setspace or fonts.
  const isJournal = isJournalClass(m.documentclass)

  const geometry = isJournal
    ? ''
    : `\\usepackage[${page.geometryOption},` +
      `top=${pyFloat(m.margin_top_cm)}cm,bottom=${pyFloat(m.margin_bottom_cm)}cm,` +
      `left=${pyFloat(m.margin_left_cm)}cm,right=${pyFloat(m.margin_right_cm)}cm]{geometry}`
  const fontPkg = isJournal ? '' : FONT_FAMILY_PACKAGES[m.body_font_family] ?? ''
  let spacingPkg = ''
  let spacingCmd = ''
  if (!isJournal) {
    spacingPkg = '\\usepackage{setspace}'
    if (Math.abs(m.line_spacing - 1.0) > 0.01) {
      if (Math.abs(m.line_spacing - 1.5) < 0.01) spacingCmd = '\\onehalfspacing'
      else if (Math.abs(m.line_spacing - 2.0) < 0.01) spacingCmd = '\\doublespacing'
      else spacingCmd = `\\setstretch{${pyFloat(m.line_spacing)}}`
    }
  }
  const parindent = m.paragraph_indent || isJournal ? '' : '\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{0.8em}'

  const preambleExtras = [fontPkg, spacingPkg, spacingCmd, parindent].filter(Boolean).join('\n')
  const pkgList = [...m.packages]
  if (!pkgList.includes('float') && !isJournal) pkgList.push('float')
  if (usesBooktabs(doc) && !pkgList.includes('booktabs') && !m.preamble_extras.includes('{booktabs}')) pkgList.push('booktabs')
  const pkgLines = pkgList.map((p) => `\\usepackage{${p}}`).join('\n')
  let packages = geometry ? pyStrip(geometry + '\n' + pkgLines) : pkgLines
  if (preambleExtras) packages += '\n' + preambleExtras
  // The user's own preamble (\lstset, \definecolor, \newcommand…), verbatim.
  if (m.preamble_extras && pyStrip(m.preamble_extras)) packages += '\n' + pyStrip(m.preamble_extras)
  packages += '\n' + KSTROKE_PROVIDE

  const [hlColors, hasComments] = collectReviewUsage(doc)
  const review = reviewPreamble(hlColors, hasComments)
  if (review) packages += '\n' + review

  const [inlineTitle, authorParts, affiliationParts, correspondenceParts] = titleBlockParts(doc.children, isElsarticle)
  const hasTitleBlock = inlineTitle !== null
  const titleText = inlineTitle !== null ? inlineTitle : escapeText(pyStrip(m.title || ''))
  const inlineAuthor = authorParts.length ? authorParts.join(' \\\\\n') : null
  let authorText = inlineAuthor !== null ? inlineAuthor : escapeAuthor(m.author || '')
  // \maketitle sets \@author in a non-wrapping tabular: wrap one long line in a \parbox.
  if (authorText && !authorText.includes('\\\\') && pyLen(authorText) > 80) {
    authorText = `\\parbox{\\textwidth}{\\centering ${authorText}}`
  }
  const hasMetadata = !!(titleText || authorText)

  if (isElsarticle) {
    // Elsevier classes want title, authors, abstract and keywords inside \begin{frontmatter}.
    const abstractBlocks: Block[] = []
    const keywordsBlocks: Keywords[] = []
    const bodyBlocks: Block[] = []
    for (const block of doc.children) {
      if (block.type === 'Title' || block.type === 'Author' || block.type === 'Affiliation' || block.type === 'Correspondence') continue
      if (block.type === 'Abstract') { abstractBlocks.push(block); continue }
      if (block.type === 'Keywords') { keywordsBlocks.push(block); continue }
      bodyBlocks.push(block)
    }
    const frontParts: string[] = []
    if (titleText) frontParts.push(`\\title{${titleText}}`)
    const extras = pyStrip(m.frontmatter_extras || '')
    const extrasHasAuthor = /\\author\b/.test(extras)
    if (authorText && !extrasHasAuthor) frontParts.push(`\\author{${authorText}}`)
    for (const part of affiliationParts) frontParts.push(`\\address{${part}}`)
    if (correspondenceParts.length && authorParts.length) frontParts.push(`\\cortext[cor1]{${correspondenceParts.join(' ')}}`)
    if (extras) frontParts.push(extras)
    if (abstractBlocks.length) {
      const paras = abstractBlocks.map((b) => serializeInlines((b as { children: Inline[] }).children))
      frontParts.push(`\\begin{abstract}\n${paras.filter(Boolean).join('\n\n')}\n\\end{abstract}`)
    }
    if (keywordsBlocks.length) {
      const terms = splitKeywordInlines(keywordsBlocks)
      if (terms.length) frontParts.push(`\\begin{keyword}\n${terms.join(' \\sep ')}\n\\end{keyword}`)
    }
    const frontmatter = frontParts.length ? '\\begin{frontmatter}\n' + frontParts.join('\n\n') + '\n\\end{frontmatter}\n' : ''

    const bodyParts: string[] = []
    bodyBlocks.forEach((b, i) => {
      bodyParts.push(serializeBlock(b, { hasChapters, floatH: !isJournal }))
      if (i < bodyBlocks.length - 1) bodyParts.push('\n')
    })
    let body = bodyParts.join('')
    if (m.column_count >= 3) body = wrapMulticols(body, m.column_count)
    let natbib: boolean
    ;[body, natbib] = withKherverefBibliography(doc, body)
    if (natbib) packages = withNatbib(packages, m)
    packages = withUrlBreaking(packages, packages, frontmatter, body)
    return `${documentclassLine(m)}\n${packages}\n\\begin{document}\n${frontmatter}${body}\\end{document}\n`
  }

  // Standard classes: title and author in the preamble, abstract/keywords in the body.
  // Journal classes whose extras already set \title / \author get no duplicates.
  const fmExtras = pyStrip(m.frontmatter_extras || '')
  const allExtras = (m.preamble_extras || '') + '\n' + fmExtras
  let preambleMeta = ''
  if (hasMetadata) {
    if (!/\\title\b/.test(allExtras)) preambleMeta += `\\title{${titleText || '~'}}\n`
    if (authorText && !/\\author\b/.test(allExtras)) preambleMeta += `\\author{${authorText}}\n`
  }

  const parts: string[] = []
  let emittedMaketitle = false
  // Wiley-style classes: body-level front matter, then \maketitle.
  if (fmExtras) {
    parts.push(fmExtras + '\n')
    for (const blk of doc.children) {
      if (blk.type === 'Abstract') parts.push(`\\abstract{${serializeInlines(blk.children)}}\n`)
      else if (blk.type === 'Keywords') parts.push(`\\keywords{${splitKeywordInlines([blk]).join(', ')}}\n`)
    }
    parts.push('\\maketitle\n')
    emittedMaketitle = true
  }
  const children = doc.children
  const n = children.length
  let i = 0
  // A RawLatex block with its own \maketitle (e.g. in \twocolumn[…]) replaces ours.
  const rawHasMaketitle = children.some((b) => b.type === 'RawLatex' && b.text.includes('\\maketitle'))

  if (isBeamer) {
    while (i < n) {
      const block = children[i]
      if (block.type === 'Title') {
        parts.push('\\begin{frame}\n\\titlepage\n\\end{frame}\n')
        emittedMaketitle = true
        i += 1
        if (i < n) parts.push('\n')
        continue
      }
      if (block.type === 'Author' || block.type === 'Affiliation' || block.type === 'Correspondence' ||
          block.type === 'Abstract' || block.type === 'Keywords') {
        i += 1
        continue
      }
      if (block.type === 'Frame') {
        const frameTitle = serializeInlines(block.children)
        i += 1
        const contentParts: string[] = []
        while (i < n && !['Frame', 'Section', 'Title'].includes(children[i].type)) {
          contentParts.push(serializeBlock(children[i]))
          i += 1
        }
        const content = contentParts.filter(Boolean).join('\n')
        if (frameTitle) parts.push(`\\begin{frame}{${frameTitle}}\n${content}\n\\end{frame}\n`)
        else parts.push('\\begin{frame}\n\\titlepage\n\\end{frame}\n')
        if (i < n) parts.push('\n')
        continue
      }
      parts.push(serializeBlock(block, { hasChapters }))
      i += 1
      if (i < n) parts.push('\n')
    }
  } else {
    while (i < n) {
      const block = children[i]
      if (fmExtras && ['Title', 'Author', 'Affiliation', 'Correspondence', 'Abstract', 'Keywords'].includes(block.type)) {
        i += 1
        continue
      }
      if (rawHasMaketitle && block.type === 'Title') {
        emittedMaketitle = true
        i += 1
        continue
      }
      if (block.type === 'Abstract') {
        const paras: string[] = []
        while (i < n && children[i].type === 'Abstract') {
          paras.push(serializeInlines((children[i] as { children: Inline[] }).children))
          i += 1
        }
        parts.push(`\\begin{abstract}\n${paras.filter(Boolean).join('\n\n')}\n\\end{abstract}\n`)
        if (i < n) parts.push('\n')
        continue
      }
      if (block.type === 'Keywords') {
        const group: Keywords[] = []
        while (i < n && children[i].type === 'Keywords') {
          group.push(children[i] as Keywords)
          i += 1
        }
        parts.push(`\\begin{keyword}\n${splitKeywordInlines(group).join(' \\sep ')}\n\\end{keyword}\n`)
        if (i < n) parts.push('\n')
        continue
      }
      const rendered = serializeBlock(block, { hasChapters, floatH: !isJournal })
      if (block.type === 'Title') emittedMaketitle = true
      else if (block.type === 'RawLatex' && block.text.includes('\\maketitle')) emittedMaketitle = true
      parts.push(rendered)
      i += 1
      if (i < n) parts.push('\n')
    }
  }

  if (hasMetadata && !hasTitleBlock && !emittedMaketitle) parts.unshift('\\maketitle\n')
  let body = parts.join('')
  if (m.column_count >= 3) body = wrapMulticols(body, m.column_count)
  let natbib: boolean
  ;[body, natbib] = withKherverefBibliography(doc, body)
  if (natbib) packages = withNatbib(packages, m)
  packages = withUrlBreaking(packages, packages, preambleMeta, body)
  return `${documentclassLine(m)}\n${packages}\n${preambleMeta}\\begin{document}\n${body}\\end{document}\n`
}

// ----------------------------------------------------------- display helpers

/** Raw LaTeX simplified for on-screen captions and table cells (editor._latex_to_display). */
export function latexToDisplay(s: string): string {
  return s
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textsc\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replaceAll('$', '')
    .replaceAll('\\_', '_')
    .replaceAll('\\&', '&')
}

/** A table cell's text as shown in the editor (editor._cell_display_text). */
export function cellDisplayText(raw: string): string {
  return pyStrip(raw.replace(/\\(?:textbf|textit|emph|texttt)\{([^}]*)\}/g, '$1'))
}
