// Note model → LaTeX: the desktop KherveNote's khervenote/serializer.py and
// lists.py, line for line, so a note typesets the same in both apps.
//
// Two layouts come from the same body:
//   continuous — the whole note on one PDF page exactly as tall as its content.
//     Each section is typeset into a box (knotechunk); boxes are stacked and the
//     page height is set from the stack. PDF viewers cap a page near 5.08 m, so
//     past \knote@limit the note breaks into several tall pages, between
//     sections only. Inside a box TeX cannot float or place footnotes, so the
//     body uses neither (figures are \captionof in place).
//   paged — ordinary A4 pages for printing; knotechunk does nothing.
//
// The output is one self-contained .tex that only needs the note's assets/
// folder next to it. tectonic (the KherveOS server) compiles it.

import { formatTime, pyStrip, splitLines, timeLabel, type Block, type Layout, type Mark, type Note, type Section } from './model.ts'

/** geometry's paper height in continuous mode, below the PDF viewer cap. */
export const CONTINUOUS_PAPER_MM = 5000
export const MARGIN_MM = 20
/** Tallest stack of sections put on one page. */
export const CONTINUOUS_LIMIT_MM = CONTINUOUS_PAPER_MM - 2 * MARGIN_MM - 10

const SPECIALS: Record<string, string> = {
  '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}',
  '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\\': '\\textbackslash{}',
}
const SPECIALS_RE = /[&%$#_{}~^\\]/g
const TIGHT = '\\setlength{\\itemsep}{0pt}\\setlength{\\parskip}{0pt}'

/** Characters the text font has no glyph for, and the maths command that draws them. */
const SYMBOLS: Record<string, string> = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta', ι: '\\iota', κ: '\\kappa',
  λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', υ: '\\upsilon', φ: '\\phi', χ: '\\chi',
  ψ: '\\psi', ω: '\\omega', Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda', Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Φ: '\\Phi',
  Ψ: '\\Psi', Ω: '\\Omega', '∆': '\\Delta', '≈': '\\approx', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '→': '\\rightarrow', '←': '\\leftarrow',
  '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇌': '\\rightleftharpoons', '∞': '\\infty', '∝': '\\propto', '∂': '\\partial', '∇': '\\nabla',
  '∫': '\\int', '∑': '\\sum', '√': '\\surd', '·': '\\cdot', '∼': '\\sim', '≡': '\\equiv', '⊥': '\\perp', '∥': '\\parallel', ℏ: '\\hbar', '−': '-',
}
const SYMBOLS_RE = new RegExp(`[${Object.keys(SYMBOLS).join('')}]`, 'g')

const SUB: Record<string, string> = Object.fromEntries([...'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ'].map((c, i) => [c, '0123456789+-=()aeoxhklmnpst'[i]]))
const SUP: Record<string, string> = Object.fromEntries([...'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ'].map((c, i) => [c, '0123456789+-=()ni'[i]]))
const SUB_RE = new RegExp(`[${Object.keys(SUB).join('')}]+`, 'g')
const SUP_RE = new RegExp(`[${Object.keys(SUP).join('')}]+`, 'g')

/**
 * Make plain text safe to typeset. Unicode sub- and superscripts (H₂O, Al³⁺,
 * cm⁻¹) become real ones: the text font has no glyphs for most of them.
 */
export function escape(text: string): string {
  let out = text.replace(SPECIALS_RE, (c) => SPECIALS[c])
  out = out.replace(SUB_RE, (m) => '\\textsubscript{' + [...m].map((c) => SUB[c]).join('') + '}')
  out = out.replace(SUP_RE, (m) => '\\textsuperscript{' + [...m].map((c) => SUP[c]).join('') + '}')
  return out.replace(SYMBOLS_RE, (c) => '\\ensuremath{' + SYMBOLS[c] + '}')
}

/**
 * Maths as people type it in notes, LaTeX-style: $$…$$ and \[…\] on their own,
 * $…$ and \(…\) in a sentence. A $ only opens maths when followed by a
 * non-space and only closes it after a non-space and before a non-digit, so
 * "it costs $5 and $10" stays text. Groups: 1 $$, 2 \[, 3 \(, 4 $.
 */
export const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\d)/g

const MATH_ONLY: [string, string][] = [['°', '^{\\circ}'], ['×', '\\times '], ['±', '\\pm '], ['µ', '\\mu ']]

function math(src: string): string {
  // Greek letters and symbols typed straight into maths still need commands.
  for (const [ch, cmd] of MATH_ONLY) src = src.split(ch).join(cmd)
  return src.replace(SYMBOLS_RE, (c) => SYMBOLS[c] + ' ')
}

/** One piece of maths found in text: where it is, its LaTeX, and whether it is displayed. */
export interface MathSpan {
  from: number
  to: number
  latex: string
  display: boolean
}

/** The maths in a run of text, as tex() reads it (the editor draws the same spans). */
export function mathSpans(text: string): MathSpan[] {
  const out: MathSpan[] = []
  for (const m of text.matchAll(MATH_RE)) {
    const display = m[1] ?? m[2]
    out.push({
      from: m.index!,
      to: m.index! + m[0].length,
      latex: pyStrip(display ?? m[3] ?? m[4] ?? ''),
      display: display !== undefined,
    })
  }
  return out
}

/** Text with any maths in it kept as maths and the rest escaped. */
export function tex(text: string): string {
  const out: string[] = []
  let pos = 0
  for (const s of mathSpans(text)) {
    out.push(escape(text.slice(pos, s.from)))
    out.push(s.display ? '\\[' + math(s.latex) + '\\]' : '$' + math(s.latex) + '$')
    pos = s.to
  }
  out.push(escape(text.slice(pos)))
  return out.join('')
}

export { formatTime }

// ------------------------------------------------------------------- lists

const ITEM_RE = /^([ \t]*)([-*•]|\d{1,3}[.)])[ \t]+(.*)$/
/** LaTeX nests itemize/enumerate four deep. */
const MAX_DEPTH = 4

function expandWidth(indent: string): number {
  let col = 0
  for (const ch of indent) col = ch === '\t' ? col + 4 - (col % 4) : col + 1
  return col
}

interface Item {
  indent: number
  numbered: boolean
  text: string
}

export function parseItem(line: string): Item | null {
  const m = ITEM_RE.exec(line)
  if (!m) return null
  return { indent: expandWidth(m[1]), numbered: /^\d/.test(m[2]), text: m[3].replace(/[\s\x1c-\x1f\x85]+$/, '') }
}

function indentOf(line: string): number {
  return expandWidth(/^[ \t]*/.exec(line)![0])
}

/** One rendered line of a list: an item at `level`, or a continuation of the previous item's text. */
export interface ListLine {
  level: number
  numbered: boolean
  text: string
  item: boolean
}

/** Nesting levels for a run of list lines; an indented non-item line continues the last item. */
export function nest(lines: string[]): ListLine[] {
  const out: ListLine[] = []
  const widths: number[] = []
  for (const ln of lines) {
    const item = parseItem(ln)
    if (!item) {
      if (out.length) out.push({ level: out[out.length - 1].level, numbered: out[out.length - 1].numbered, text: pyStrip(ln), item: false })
      continue
    }
    while (widths.length && widths[widths.length - 1] > item.indent) widths.pop()
    if (!widths.length || widths[widths.length - 1] < item.indent) widths.push(item.indent)
    out.push({ level: Math.min(widths.length - 1, MAX_DEPTH - 1), numbered: item.numbered, text: item.text, item: true })
  }
  return out
}

/** Is `line` part of a list? Items always are; an indented plain line is when it follows an item. */
export function isListLine(line: string, inList: boolean): boolean {
  return parseItem(line) !== null || (inList && indentOf(line) > 0 && !!pyStrip(line))
}

/** Nested itemize/enumerate from lines whose text is already LaTeX. */
function renderList(lines: ListLine[]): string {
  const out: string[] = []
  const stack: string[] = []
  const end = () => {
    const indent = '  '.repeat(stack.length - 1)
    out.push(indent + `\\end{${stack.pop()}}`)
  }
  for (const ln of lines) {
    if (!ln.item) {
      out[out.length - 1] += '\\newline ' + ln.text
      continue
    }
    const env = ln.numbered ? 'enumerate' : 'itemize'
    const level = Math.min(ln.level, stack.length)
    while (stack.length && (stack.length > level + 1 || (stack.length === level + 1 && stack[stack.length - 1] !== env))) end()
    if (stack.length === level) {
      out.push('  '.repeat(level) + `\\begin{${env}}` + TIGHT)
      stack.push(env)
    }
    out.push('  '.repeat(stack.length) + '\\item ' + ln.text)
  }
  while (stack.length) end()
  return out.join('\n')
}

function listLatex(lines: string[]): string {
  return renderList(nest(lines).map((ln) => ({ ...ln, text: tex(ln.text) })))
}

// -------------------------------------------------------------------- text

const MARK_MACROS: Record<string, string> = { b: '\\textbf{%s}', i: '\\textit{%s}', u: '\\underline{%s}' }

/** Text with inline bold / italic / underline spans; newlines inside the text are line breaks. */
export function richToLatex(text: string, marks: Mark[]): string {
  const plain = (seg: string) => seg.split('\n').map(tex).join('\\newline\n')
  if (!marks.length) return plain(text)
  const n = text.length
  const cutSet = new Set<number>([0, n])
  for (const m of marks) for (const c of [m[0], m[0] + m[1]]) cutSet.add(Math.max(0, Math.min(n, c)))
  const cuts = [...cutSet].sort((a, b) => a - b)
  const out: string[] = []
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k]
    const b = cuts[k + 1]
    let seg = plain(text.slice(a, b))
    const styles = [...new Set(marks.filter((m) => m[0] <= a && m[0] + m[1] >= b).map((m) => m[2]))].sort()
    for (const style of styles) seg = MARK_MACROS[style].replace('%s', () => seg)
    out.push(seg)
  }
  return out.join('')
}

/** Python's str.strip(chars) for newlines only. */
const stripNewlines = (s: string) => s.replace(/^\n+|\n+$/g, '')
const rstrip = (s: string) => s.replace(/[\s\x1c-\x1f\x85]+$/, '')

/**
 * Blank lines separate paragraphs, single newlines are kept as line breaks,
 * and bullet / numbered items become nested itemize / enumerate lists — the
 * way people type notes.
 */
export function textToLatex(text: string): string {
  const out: string[] = []
  for (const para of stripNewlines(text).split(/\n[\s\x1c-\x1f\x85]*\n/)) {
    const parts: string[] = []
    let lines: string[] = []
    let items: string[] = []
    const all = splitLines(para).filter((ln) => pyStrip(ln)).map(rstrip)
    for (const ln of [...all, '']) {
      const listed = !!ln && isListLine(ln, items.length > 0)
      if (lines.length && (listed || !ln)) {
        parts.push(lines.join('\\newline\n'))
        lines = []
      }
      if (items.length && !listed) {
        parts.push(listLatex(items))
        items = []
      }
      if (listed) items.push(ln)
      else if (ln) lines.push(tex(pyStrip(ln)))
    }
    if (parts.length) out.push(parts.join('\n'))
  }
  return out.join('\n\n')
}

// ---------------------------------------------------------------- document

function preamble(note: Note, layout: Layout, limitPt: number | null): string {
  const m = note.meta
  let geometry: string
  let chunks: string
  if (layout === 'continuous') {
    geometry = `paperwidth=210mm,paperheight=${CONTINUOUS_PAPER_MM}mm,margin=${MARGIN_MM}mm`
    const limit = limitPt != null ? `${limitPt.toFixed(2)}pt` : `${CONTINUOUS_LIMIT_MM}mm`
    chunks = String.raw`\makeatletter
\newdimen\knote@limit \knote@limit=${limit}
\newbox\knote@page \newbox\knote@chunk
\def\knote@ht#1{\dimexpr\ht#1+\dp#1\relax}
\def\knote@setheight#1{\global\pdfpageheight=#1\relax
  \special{pdf:pagesize width \the\paperwidth\space height \the\pdfpageheight}}
\def\knote@flush{\ifvoid\knote@page\else
  \knote@setheight{\dimexpr\knote@ht\knote@page+${2 * MARGIN_MM}mm+2mm\relax}%
  \box\knote@page\par\clearpage\global\pdfpageheight=\paperheight\fi}
\newenvironment{knotechunk}
  {\par\setbox\knote@chunk=\vbox\bgroup\hsize=\textwidth\linewidth=\textwidth}
  {\par\egroup
   \ifdim\knote@ht\knote@chunk>\knote@limit
     \knote@flush\unvbox\knote@chunk\par\clearpage
   \else\ifvoid\knote@page
     \global\setbox\knote@page=\vbox{\unvbox\knote@chunk}%
   \else\ifdim\dimexpr\knote@ht\knote@page+\knote@ht\knote@chunk\relax>\knote@limit
     \knote@flush\global\setbox\knote@page=\vbox{\unvbox\knote@chunk}%
   \else
     \global\setbox\knote@page=\vbox{\unvbox\knote@page\unvbox\knote@chunk}%
   \fi\fi\fi}
\AtEndDocument{\knote@flush}
\makeatother
\pagestyle{empty}`
  } else {
    geometry = `a4paper,margin=${MARGIN_MM}mm`
    chunks = '\\newenvironment{knotechunk}{}{}\n\\pagestyle{plain}'
  }
  return String.raw`\documentclass[11pt]{article}
\usepackage[${geometry}]{geometry}
\usepackage{amsmath,amssymb,xcolor,graphicx}
\usepackage[hypcap=false]{caption}
\usepackage[hidelinks,bookmarksnumbered,bookmarksopen]{hyperref}
\hypersetup{pdftitle={${escape(m.title)}},pdfauthor={${escape(m.speaker)}},
  pdfcreator={KherveNote}}
\renewcommand\labelitemii{\textbullet}
\renewcommand\labelitemiii{\textbullet}
\renewcommand\labelitemiv{\textbullet}
\renewcommand\labelenumii{\arabic{enumi}.\arabic{enumii}.}
\renewcommand\labelenumiii{\arabic{enumi}.\arabic{enumii}.\arabic{enumiii}.}
\renewcommand\labelenumiv{\arabic{enumi}.\arabic{enumii}.\arabic{enumiii}.\arabic{enumiv}.}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.6em}
\definecolor{knoteaccent}{HTML}{1A6DD8}
\definecolor{knotemuted}{HTML}{6B6B6B}
\definecolor{knotekey}{HTML}{D96B00}
\newcommand\knotetime[1]{\leavevmode\llap{\color{knotemuted}\scriptsize #1\hspace{1em}}}
\newcommand\knotekey[2][]{\par\noindent#1\colorbox{knotekey!12}{\parbox{\dimexpr\linewidth-2\fboxsep}{%
  \textbf{\color{knotekey}$\star$ Key point.} #2}}\par}
\newcommand\knotequestion[2][]{\par\noindent#1{\color{knoteaccent}\textbf{?}}~\emph{#2}\par}
\newenvironment{knotetranscript}{\par\color{knotemuted}\small}{\par}
\newcommand\knotesummary[1]{\par\noindent\fcolorbox{knoteaccent}{knoteaccent!6}{%
  \parbox{\dimexpr\linewidth-2\fboxsep-2\fboxrule}{\textbf{Summary}\par #1}}\par}
${chunks}
`
}

function titleBand(note: Note): string {
  const m = note.meta
  const left = escape(m.speaker)
  const right = [m.date, m.place].filter((x) => x).map(escape).join(' \\textperiodcentered{} ')
  const parts = ['{\\color{knoteaccent}\\rule{\\linewidth}{1.5pt}}\\par', '{\\LARGE\\bfseries ' + (tex(m.title) || 'Notes') + '}\\par']
  if (left || right) parts.push('{\\large ' + left + '}\\hfill{\\color{knotemuted}' + right + '}\\par')
  parts.push('{\\color{knoteaccent}\\rule{\\linewidth}{0.6pt}}\\par')
  if (pyStrip(note.summary)) parts.push('\\knotesummary{' + textToLatex(note.summary) + '}')
  return parts.join('\n')
}

/** Is a note's asset there? (asset_dir on the desktop; undefined: don't check.) */
export type AssetCheck = ((path: string) => boolean) | undefined

function image(block: Block, hasAsset: AssetCheck): string {
  const body =
    hasAsset && !hasAsset(block.path)
      ? '\\fbox{\\texttt{\\small [missing image: ' + escape(block.path) + ']}}'
      : '\\includegraphics[width=0.85\\linewidth,height=110mm,keepaspectratio]{' + block.path + '}'
  const cap = pyStrip(block.text) ? '\\captionof{figure}{' + tex(pyStrip(block.text)) + '}' : ''
  return '\\begin{center}\n' + body + '\n' + cap + '\n\\end{center}'
}

function body(block: Block): string {
  // Marks come from the editor; unmarked text may still use the typed list syntax.
  return block.marks.length ? richToLatex(block.text, block.marks) : textToLatex(block.text)
}

function blockLatex(block: Block, showTimes: boolean, hasAsset: AssetCheck): string {
  const stamp = formatTime(block.t)
  const lead = stamp && (showTimes || block.kind === 'transcript') ? '\\knotetime{' + stamp + '}' : ''
  if (block.kind === 'image') return block.path ? image(block, hasAsset) : ''
  if (block.kind === 'attachment') return '{\\color{knotemuted}\\textbf{Attached document:} ' + escape(block.text) + '}'
  if (block.kind === 'heading') {
    const title = tex(pyStrip(block.text))
    if (!title) return ''
    return (block.level >= 3 ? '\\subsubsection{' : '\\subsection{') + title + '}'
  }
  const b = body(block)
  if (!b) return ''
  // The time goes in the optional argument, before the box / the "?".
  if (block.kind === 'important') return (lead ? '\\knotekey[' + lead + ']{' : '\\knotekey{') + b + '}'
  if (block.kind === 'question') return (lead ? '\\knotequestion[' + lead + ']{' : '\\knotequestion{') + b + '}'
  if (block.kind === 'transcript') return '\\begin{knotetranscript}\n' + lead + b + '\n\\end{knotetranscript}'
  return lead + b
}

/** Each block's LaTeX, with runs of list items merged into one list. */
function blocksLatex(blocks: Block[], showTimes: boolean, hasAsset: AssetCheck): string[] {
  const out: string[] = []
  let run: ListLine[] = []
  for (const blk of [...blocks, null]) {
    if (blk && blk.kind === 'item') {
      if (pyStrip(blk.text)) run.push({ level: blk.level, numbered: blk.numbered, text: richToLatex(blk.text, blk.marks), item: true })
      continue
    }
    if (run.length) {
      out.push(renderList(run))
      run = []
    }
    if (blk) {
      const t = blockLatex(blk, showTimes, hasAsset)
      if (t) out.push(t)
    }
  }
  return out
}

function sectionLatex(sec: Section, first: boolean, showTimes: boolean, hasAsset: AssetCheck): string {
  const blocks = blocksLatex(sec.blocks, showTimes, hasAsset)
  if (!blocks.length && !pyStrip(sec.title)) return ''
  const parts: string[] = []
  if (pyStrip(sec.title) || !first) parts.push('\\section{' + (tex(pyStrip(sec.title)) || 'Untitled section') + '}')
  return [...parts, ...blocks].join('\n\n')
}

/** The speech transcript as a last section, each stretch with the time it was said in the margin. */
function transcriptLatex(note: Note): string {
  const rows = note.transcript.filter((g) => pyStrip(g.text)).map((g) => '\\knotetime{' + timeLabel(note, g.t) + '}' + tex(pyStrip(g.text)))
  if (!rows.length) return ''
  return '\\section{What was said}\n\\begin{knotetranscript}\n' + rows.join('\n\n') + '\n\\end{knotetranscript}'
}

export interface LatexOptions {
  layout?: Layout
  /** Each paragraph's time in the margin. */
  showTimes?: boolean
  /** Add the speech transcript as a last section. */
  transcript?: boolean
  /** Missing images become a visible placeholder instead of a failed compile. */
  hasAsset?: AssetCheck
  /** Override the continuous-page height cap (in pt). */
  limitPt?: number | null
}

/** The complete .tex for `note` (serializer.to_latex). */
export function toLatex(note: Note, opts: LatexOptions = {}): string {
  const layout = opts.layout ?? note.meta.layout
  const showTimes = !!opts.showTimes
  const chunks: string[] = []
  note.sections.forEach((sec, i) => {
    let b = sectionLatex(sec, i === 0, showTimes, opts.hasAsset)
    if (i === 0) b = titleBand(note) + (b ? '\n\n' + b : '')
    if (b) chunks.push('\\begin{knotechunk}\n' + b + '\n\\end{knotechunk}')
  })
  if (opts.transcript) {
    const t = transcriptLatex(note)
    if (t) chunks.push('\\begin{knotechunk}\n' + t + '\n\\end{knotechunk}')
  }
  return preamble(note, layout, opts.limitPt ?? null) + '\\begin{document}\n' + chunks.join('\n\n') + '\n\\end{document}\n'
}
