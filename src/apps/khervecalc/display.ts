// How an answer is shown: the main line (exact, decimal or fraction, in the
// chosen number format) and the "≈" line under it. Pure, so tools/tests can
// check it without a browser.

import { formatNumber, type FormatOpts } from './format.ts'
import type { Answer, CalcSettings } from './session.ts'

export interface Shown {
  /** LaTeX of the main line (null: show `text` as plain monospace, e.g. 2,000-digit integers). */
  latex: string | null
  text: string
  /** The decimal value under an exact one. */
  approxLatex?: string
  approxText?: string
  /** A mixed number under a fraction (2 ⅓). */
  mixedLatex?: string
  error?: string
}

/** Above this, LaTeX is not worth typesetting: the text is shown instead. */
export const MAX_LATEX = 6000

export function fmtOpts(s: CalcSettings): FormatOpts {
  return { format: s.format, fix: s.fix, digits: s.digits }
}

export function shown(a: Answer, s: CalcSettings): Shown {
  if (!a.ok) return { latex: null, text: '', error: a.error ?? 'Error' }
  const o = fmtOpts(s)
  const text = a.text ?? ''
  const tex = a.latex ?? ''
  const big = (t: string) => (t.length > MAX_LATEX ? null : t)
  const num = a.num ?? null
  const kind = a.kind === 'def' ? undefined : a.kind
  if (num && (kind === 'value' || kind === undefined)) {
    const f = formatNumber(num, o, s.complex, s.angle)
    const isDef = a.kind === 'def'
    const head = isDef && a.name ? `${a.name} := ` : ''
    const headTex = isDef && a.name ? `${texName(a.name)} := ` : ''
    if (s.number === 'decimal' || a.exact === false) {
      return { latex: headTex + f.latex, text: head + f.text }
    }
    if (s.number === 'fraction') {
      return { latex: big(tex), text, mixedLatex: a.mixed_latex, ...(a.show_approx || /\\frac/.test(tex) ? { approxLatex: f.latex, approxText: f.text } : {}) }
    }
    // exact: the exact form, and its value when that says more
    const exactInteger = /^-?\d+$/.test(text.replace(/^[A-Za-z_]\w* := /, ''))
    if (a.long && exactInteger) return { latex: null, text, approxLatex: f.latex, approxText: f.text }
    const approx = !exactInteger && (a.show_approx || num.im !== null || /\\frac|\\sqrt|\\pi|e\^|\\log|\\operatorname|\\Gamma|\\zeta|\\sin|\\cos|\\tan|\\ln/.test(tex))
    const polar = s.complex === 'polar' && num.im !== null
    return { latex: big(tex), text, ...(approx || polar ? { approxLatex: f.latex, approxText: f.text } : {}) }
  }
  if (kind === 'quantity' && num) {
    const f = formatNumber(num, o, s.complex, s.angle)
    const unit = a.unit_latex ?? ''
    const unitText = a.unit_text ?? ''
    const val = { latex: `${f.latex}\\,${unit}`, text: `${f.text}*${unitText}` }
    if (s.number === 'decimal' || a.exact === false) return { latex: val.latex, text: val.text }
    const simple = /^-?\d+$/.test(f.text) && !/\\frac\{\d/.test(tex.split('\\,')[0] ?? '')
    return { latex: big(tex), text, ...(simple ? {} : { approxLatex: val.latex, approxText: val.text }) }
  }
  return { latex: big(tex), text, approxLatex: a.approx_latex, approxText: a.approx_text }
}

/** A variable name as LaTeX (x_1 -> x_{1}, alpha -> \alpha). */
export function texName(n: string): string {
  const greek = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega'.split(' ')
  const [head, ...sub] = n.split('_')
  const h = greek.includes(head) ? `\\${head}` : head.length > 1 ? `\\mathrm{${head}}` : head
  return sub.length ? `${h}_{${sub.join('\\_')}}` : h
}
