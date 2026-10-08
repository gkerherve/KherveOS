// Label markup: H_2O, m^2, x_{max}, 10^{-3}, \alpha, \AA… → runs of text with a position
// (normal, subscript, superscript), drawn as SVG tspans (or HTML <sub>/<sup> for Plotly).
// Pure TypeScript.

export interface Span {
  text: string
  /** 0 normal, 1 superscript, -1 subscript. */
  pos: 0 | 1 | -1
}

export const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  deg: '°', circ: '°', degC: '°C', degF: '°F', pm: '±', mp: '∓', times: '×', cdot: '·', AA: 'Å', angstrom: 'Å', infty: '∞', inf: '∞',
  rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', approx: '≈', neq: '≠', leq: '≤', geq: '≥', sim: '∼', propto: '∝', partial: '∂',
  nabla: '∇', sqrt: '√', permil: '‰', hbar: 'ħ', ell: 'ℓ', perp: '⊥', parallel: '∥', degree: '°', micro: 'µ', ohm: 'Ω', sum: '∑', int: '∫',
}

/** The text of a `\name` at s[i] (s[i] is the backslash): the symbol and how far it reaches. */
function symbolAt(s: string, i: number): { text: string; end: number } | null {
  const next = s[i + 1]
  if (next && '_^\\{}'.includes(next)) return { text: next, end: i + 2 }
  const m = /^[A-Za-z]+/.exec(s.slice(i + 1))
  if (!m) return null
  const sym = SYMBOLS[m[0]]
  return sym ? { text: sym, end: i + 1 + m[0].length } : null
}

/** The text of a group `{…}` starting at s[i] === '{' (symbols inside are replaced, nested markup is flattened). */
function groupAt(s: string, i: number): { text: string; end: number } {
  let depth = 0
  let j = i
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) break
  }
  const inner = s.slice(i + 1, Math.min(j, s.length))
  return { text: parseMarkup(inner).map((p) => p.text).join(''), end: Math.min(j + 1, s.length) }
}

function minus(t: string): string {
  return t.replace(/^-/, '−')
}

export function parseMarkup(src: string): Span[] {
  const out: Span[] = []
  const push = (text: string, pos: Span['pos']) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.pos === pos) last.text += text
    else out.push({ text, pos })
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const sym = symbolAt(src, i)
      if (sym) { push(sym.text, 0); i = sym.end } else { push('\\', 0); i++ }
    } else if (c === '_' || c === '^') {
      const pos: Span['pos'] = c === '^' ? 1 : -1
      const rest = src.slice(i + 1)
      if (rest[0] === '{') {
        const g = groupAt(src, i + 1)
        push(pos === 1 ? minus(g.text) : g.text, pos)
        i = g.end
      } else if (rest[0] === '\\') {
        const sym = symbolAt(src, i + 1)
        if (sym) { push(sym.text, pos); i = sym.end } else { push(c, 0); i++ }
      } else {
        const m = pos === 1 ? /^[+\-−]?\d+|^[+\-−]/.exec(rest) : /^\d+/.exec(rest)
        const tok = m ? m[0] : (Array.from(rest)[0] ?? '')
        if (tok) { push(pos === 1 ? minus(tok) : tok, pos); i += 1 + tok.length } else { push(c, 0); i++ }
      }
    } else if (c === '{' || c === '}') {
      i++ // grouping braces that do nothing: "{}" separates "\alpha{}beta"
    } else {
      push(c, 0)
      i++
    }
  }
  return out
}

/** The label as plain text (sub- and superscripts inline). */
export function plainText(src: string): string {
  return parseMarkup(src).map((p) => p.text).join('')
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)
}

/** The label as HTML for Plotly (<sub>, <sup>). */
export function markupHtml(src: string): string {
  return parseMarkup(src)
    .map((p) => {
      const t = escapeXml(p.text)
      return p.pos === 1 ? `<sup>${t}</sup>` : p.pos === -1 ? `<sub>${t}</sub>` : t
    })
    .join('')
}

/** Rough text width of a string in a sans font, in units of the font size. */
export function textEm(s: string): number {
  let w = 0
  for (const ch of s) {
    if ('il.,;:\'|!`'.includes(ch)) w += 0.28
    else if ('fjtI()[]{} -'.includes(ch)) w += 0.36
    else if ('mwMW@—'.includes(ch)) w += 0.85
    else if (/[0-9]/.test(ch)) w += 0.56
    else if (/[A-Z]/.test(ch)) w += 0.68
    else if (ch.charCodeAt(0) > 0x2e80) w += 1
    else w += 0.52
  }
  return w
}

const SCRIPT_SIZE = 0.7
const SUB_SHIFT = 0.22
const SUP_SHIFT = -0.4

/** Width of the label in points at font size `size`. */
export function markupWidth(src: string, size: number): number {
  return parseMarkup(src).reduce((w, p) => w + textEm(p.text) * size * (p.pos === 0 ? 1 : SCRIPT_SIZE), 0)
}

/** The inside of a <text> element: tspans that raise and lower the baseline. `size` is the text's font size in pt. */
export function markupSvg(src: string, size: number): string {
  const spans = parseMarkup(src)
  if (spans.every((p) => p.pos === 0)) return escapeXml(spans.map((p) => p.text).join(''))
  let offset = 0
  const out: string[] = []
  for (const p of spans) {
    const target = p.pos === 0 ? 0 : p.pos === 1 ? SUP_SHIFT * size : SUB_SHIFT * size
    const dy = target - offset
    offset = target
    const attrs = [dy ? ` dy="${Number(dy.toFixed(3))}"` : '', p.pos !== 0 ? ` font-size="${Number((size * SCRIPT_SIZE).toFixed(3))}"` : ''].join('')
    out.push(attrs ? `<tspan${attrs}>${escapeXml(p.text)}</tspan>` : escapeXml(p.text))
  }
  return out.join('')
}
