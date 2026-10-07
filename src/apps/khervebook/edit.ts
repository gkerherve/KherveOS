// Editor tools for the second toolbar row (the desktop's celltoolbar.py):
// wrap the selection, rewrite the selected lines, insert snippets ("|" marks
// where the cursor lands), and comment lines in the cell's own syntax.

import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Wrap the selection (or `placeholder`) in before/after, leaving the wrapped text selected. */
export function wrap(view: EditorView, before: string, after: string, placeholder = 'text') {
  const tr = view.state.changeByRange((range) => {
    const sel = view.state.sliceDoc(range.from, range.to) || placeholder
    return {
      changes: { from: range.from, to: range.to, insert: before + sel + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + sel.length),
    }
  })
  view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
  view.focus()
}

/** Insert `snippet` at the cursor; a "|" in it marks where the cursor lands. */
export function insertSnippet(view: EditorView, snippet: string) {
  const at = snippet.indexOf('|')
  const text = at >= 0 ? snippet.slice(0, at) + snippet.slice(at + 1) : snippet
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + (at >= 0 ? at : text.length) },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

function selectedLineNumbers(state: EditorState): number[] {
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    // A selection ending at the start of a line doesn't take that line.
    const end = r.to > r.from && state.doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to
    const last = state.doc.lineAt(end).number
    for (let n = first; n <= last; n++) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/** Rewrite each selected line through `fn` (one undo step). */
export function perLine(view: EditorView, fn: (line: string) => string) {
  const { state } = view
  const changes: ChangeSpec[] = []
  for (const n of selectedLineNumbers(state)) {
    const line = state.doc.line(n)
    const next = fn(line.text)
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input' })
  view.focus()
}

export function dedentLine(ln: string): string {
  for (const pre of ['    ', '\t', '   ', '  ', ' ']) if (ln.startsWith(pre)) return ln.slice(pre.length)
  return ln
}

/** Each cell type's comment syntax (prefix, suffix). */
const COMMENT: Record<string, [string, string]> = {
  code: ['# ', ''],
  markdown: ['<!-- ', ' -->'],
  latex: ['% ', ''],
  js: ['// ', ''],
  svg: ['<!-- ', ' -->'],
}

/** Comment / uncomment the selected lines (desktop toggle_comment). */
export function toggleComment(view: EditorView, cellType: string) {
  const [prefix, suffix] = COMMENT[cellType] ?? COMMENT.code
  const p = prefix.trim()
  const sfx = suffix.trim()
  const { state } = view
  const lines = selectedLineNumbers(state).map((n) => state.doc.line(n))
  const commented = (t: string) => {
    const s = t.trim()
    return s.startsWith(p) && (!sfx || s.endsWith(sfx))
  }
  const nonEmpty = lines.filter((l) => l.text.trim())
  const remove = nonEmpty.length > 0 && nonEmpty.every((l) => commented(l.text))
  const changes: ChangeSpec[] = []
  for (const line of nonEmpty) {
    const text = line.text
    const indent = text.slice(0, text.length - text.trimStart().length)
    let body = text.slice(indent.length)
    if (remove) {
      if (body.startsWith(prefix)) body = body.slice(prefix.length)
      else if (body.startsWith(p)) body = body.slice(p.length).replace(/^ /, '')
      if (suffix && body.endsWith(suffix)) body = body.slice(0, -suffix.length)
      else if (sfx && body.trimEnd().endsWith(sfx)) body = body.slice(0, body.trimEnd().lastIndexOf(sfx)).trimEnd()
    } else body = prefix + body + suffix
    changes.push({ from: line.from, to: line.to, insert: indent + body })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input' })
  view.focus()
}

/** Python snippets for code cells (desktop PY_SNIPPETS). */
export const PY_SNIPPETS: [string, string][] = [
  ['Imports (numpy, matplotlib)', 'import numpy as np\nimport matplotlib.pyplot as plt\n'],
  ['Line plot', "x = np.linspace(0, 2 * np.pi, 200)\nplt.plot(x, np.sin(x))\nplt.xlabel('x'); plt.ylabel('sin(x)')\nplt.gcf()"],
  ['Histogram', 'data = np.random.normal(size=1000)\nplt.hist(data, bins=30)\nplt.gcf()'],
  ['Define a function', 'def my_func(x):\n    return x * 2\n'],
  ['DataFrame preview', "df = pd.DataFrame({'x': range(5), 'y': range(5)})\ndf"],
]

/** LaTeX building blocks: (button, tooltip, snippet). */
export const LATEX_SNIPPETS: [string, string, string][] = [
  ['a⁄b', 'Fraction', '\\frac{|}{}'],
  ['√', 'Square root', '\\sqrt{|}'],
  ['xⁿ', 'Superscript', '^{|}'],
  ['xₙ', 'Subscript', '_{|}'],
  ['Σ', 'Sum', '\\sum_{i=1}^{n} |'],
  ['∫', 'Integral', '\\int_{a}^{b} | \\, dx'],
  ['lim', 'Limit', '\\lim_{x \\to \\infty} |'],
]

export const LATEX_SECTIONS: [string, string][] = [
  ['Document skeleton', '\\documentclass[12pt]{article}\n\\usepackage{amsmath, amssymb}\n\\begin{document}\n|\n\\end{document}'],
  ['Title block + \\maketitle', '\\title{\\textbf{|}}\n\\author{}\n\\date{}\n\\maketitle'],
  ['Section', '\\section{|}'],
  ['Section* (unnumbered)', '\\section*{|}'],
  ['Subsection', '\\subsection{|}'],
  ['Subsection* (unnumbered)', '\\subsection*{|}'],
  ['Subsubsection', '\\subsubsection{|}'],
]

export const LATEX_FORMATS: [string, string][] = [
  ['Bold', '\\textbf{'],
  ['Italic', '\\textit{'],
  ['Underline', '\\underline{'],
  ['Strikethrough', '\\sout{'],
  ['Monospace', '\\texttt{'],
  ['Small caps', '\\textsc{'],
  ['Emphasis', '\\emph{'],
]

export const LATEX_ENVS: [string, string][] = [
  ['Bullet list (itemize)', '\\begin{itemize}\n  \\item |\n  \\item \n\\end{itemize}'],
  ['Numbered list (enumerate)', '\\begin{enumerate}\n  \\item |\n  \\item \n\\end{enumerate}'],
  ['List item', '\\item |'],
  ['Equation (numbered)', '\\begin{equation}\n|\n\\end{equation}'],
  ['Equation* (unnumbered)', '\\begin{equation*}\n|\n\\end{equation*}'],
  ['Aligned equations', '\\begin{align}\n| &= \\\\\n  &= \n\\end{align}'],
  ['Table', '\\begin{tabular}{l l}\n\\hline\n| & \\\\\n\\hline\n & \\\\\n\\hline\n\\end{tabular}'],
  ['Figure', '\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.6\\textwidth]{|}\n\\caption{}\n\\end{figure}'],
]

export const GREEK = 'alpha beta gamma delta epsilon theta lambda mu pi rho sigma tau phi chi psi omega Gamma Delta Theta Lambda Pi Sigma Phi Psi Omega'.split(' ')

export const OPERATORS: [string, string][] = [
  ['±', '\\pm'],
  ['×', '\\times'],
  ['·', '\\cdot'],
  ['÷', '\\div'],
  ['≤', '\\leq'],
  ['≥', '\\geq'],
  ['≠', '\\neq'],
  ['≈', '\\approx'],
  ['→', '\\rightarrow'],
  ['∂', '\\partial'],
  ['∇', '\\nabla'],
  ['∞', '\\infty'],
]

/** Ready-made SVG shapes (desktop Shape menu). */
export const SVG_SHAPES: [string, string][] = [
  ['Rectangle', '<rect x="60" y="60" width="160" height="110" rx="8" fill="#50bea0"/>'],
  ['Circle', '<circle cx="140" cy="120" r="60" fill="#2176c7"/>'],
  ['Line', '<line x1="40" y1="40" x2="260" y2="180" stroke="#333" stroke-width="3"/>'],
  ['Text', '<text x="60" y="90" font-size="24" fill="#333">label</text>'],
  ['Curve (path)', '<path d="M40,160 Q160,20 280,160" stroke="#c0392b" fill="none" stroke-width="3"/>'],
]

/** Append an element before </svg> (desktop _commit). */
export function appendToSvg(src: string, element: string): string {
  const idx = src.lastIndexOf('</svg>')
  return idx < 0 ? `${src}\n${element}` : `${src.slice(0, idx)}  ${element}\n${src.slice(idx)}`
}

/** The drawing's viewBox (x, y, w, h), from viewBox or width/height. */
export function svgViewBox(src: string): [number, number, number, number] {
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/.exec(src)
  if (vb) {
    const v = vb.slice(1, 5).map(Number) as [number, number, number, number]
    if (v[2] > 0 && v[3] > 0) return v
  }
  const tag = /<svg\b[^>]*>/i.exec(src)?.[0] ?? ''
  const w = Number(/\bwidth\s*=\s*["']?\s*([\d.]+)/.exec(tag)?.[1] ?? NaN)
  const h = Number(/\bheight\s*=\s*["']?\s*([\d.]+)/.exec(tag)?.[1] ?? NaN)
  return [0, 0, w > 0 ? w : 400, h > 0 ? h : 300]
}

/** Resize the drawing area: rewrite the viewBox and a full-canvas background rect (desktop set_canvas_size). */
export function setSvgCanvas(src: string, width: number | null, height: number | null): string {
  const [, , cw, ch] = svgViewBox(src)
  const nw = width ?? cw
  const nh = height ?? ch
  if (!(nw > 0 && nh > 0)) return src
  const vb = `viewBox="0 0 ${nw} ${nh}"`
  let out = /viewBox="[^"]*"/.test(src) ? src.replace(/viewBox="[^"]*"/, vb) : src.replace(/<svg\b/, `<svg ${vb}`)
  out = out.replace(/(<rect\b[^>]*\bx="0"[^>]*\by="0"[^>]*\bwidth=")[^"]*("[^>]*\bheight=")[^"]*(")/, `$1${nw}$2${nh}$3`)
  return out
}
