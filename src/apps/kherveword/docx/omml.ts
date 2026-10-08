// Equations in .docx: LaTeX (what KherveWord edits, shown with KaTeX) to
// Office Math Markup (OMML, what Word edits) and back. Covers the common
// constructs — fractions, scripts, roots, sums and integrals, delimiters,
// accents, functions, matrices, Greek and operator symbols; anything else is
// kept as text. Plain TypeScript, tested in Node.

import { esc, kid, kids, textOf, type XmlElement } from './xml.ts'

// ------------------------------------------------------------------ symbols

export const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
  upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '⋅', pm: '±', mp: '∓', div: '÷', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  sim: '∼', simeq: '≃', cong: '≅', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', rightarrow: '→', to: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦', in: '∈', notin: '∉', ni: '∋', subset: '⊂',
  subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅', varnothing: '∅', angle: '∠',
  circ: '∘', bullet: '∙', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', hbar: 'ℏ', ell: 'ℓ', prime: '′', langle: '⟨',
  rangle: '⟩', degree: '°', ll: '≪', gg: '≫', perp: '⊥', parallel: '∥', neg: '¬', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗',
  star: '⋆', dagger: '†', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', wp: '℘', uparrow: '↑', downarrow: '↓', lbrace: '{', rbrace: '}', vert: '|',
  Vert: '‖', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', setminus: '∖', therefore: '∴', because: '∵', quad: ' ', qquad: '  ',
}
const SYMBOL_OF: Record<string, string> = {}
for (const [k, v] of Object.entries(SYMBOLS)) if (!(v in SYMBOL_OF)) SYMBOL_OF[v] = k

const NARY: Record<string, string> = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' }
const NARY_OF: Record<string, string> = Object.fromEntries(Object.entries(NARY).map(([k, v]) => [v, k]))
const ACCENTS: Record<string, string> = { hat: '̂', widehat: '̂', bar: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widetilde: '̃', check: '̌', breve: '̆' }
const ACCENT_OF: Record<string, string> = { '̂': 'hat', '̅': 'bar', '̄': 'bar', '⃗': 'vec', '̇': 'dot', '̈': 'ddot', '̃': 'tilde', '̌': 'check', '̆': 'breve' }
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'arg', 'deg', 'dim', 'ker', 'Pr', 'mod'])
const MATRIX_DELIMS: Record<string, [string, string]> = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] }

// ------------------------------------------------------------------ LaTeX → OMML

type Tok = { k: 'cmd'; v: string } | { k: 'ch'; v: string } | { k: '{' } | { k: '}' } | { k: '^' } | { k: '_' } | { k: '&' } | { k: 'nl' }

function tokenize(s: string): Tok[] {
  const out: Tok[] = []
  for (let i = 0; i < s.length; ) {
    const c = s[i]
    if (c === '\\') {
      if (s[i + 1] === '\\') {
        out.push({ k: 'nl' })
        i += 2
        continue
      }
      const m = /^[a-zA-Z]+/.exec(s.slice(i + 1))
      if (m) {
        out.push({ k: 'cmd', v: m[0] })
        i += 1 + m[0].length
      } else {
        out.push({ k: 'cmd', v: s[i + 1] ?? '' })
        i += 2
      }
    } else if (c === '{') {
      out.push({ k: '{' })
      i++
    } else if (c === '}') {
      out.push({ k: '}' })
      i++
    } else if (c === '^') {
      out.push({ k: '^' })
      i++
    } else if (c === '_') {
      out.push({ k: '_' })
      i++
    } else if (c === '&') {
      out.push({ k: '&' })
      i++
    } else if (/\s/.test(c)) {
      i++
    } else {
      out.push({ k: 'ch', v: c })
      i++
    }
  }
  return out
}

class Parser {
  i = 0
  toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }
  peek(): Tok | undefined {
    return this.toks[this.i]
  }
  /** A sequence of atoms until "}" / end / a stop token. Returns OMML. */
  seq(stop?: (t: Tok) => boolean): string {
    let out = ''
    let run = ''
    let runStyle = ''
    const flush = () => {
      if (run) out += mr(run, runStyle)
      run = ''
      runStyle = ''
    }
    for (;;) {
      const t = this.peek()
      if (!t || t.k === '}' || (stop && stop(t))) break
      // {a \atop b}, {a \over b}, {n \choose k}: what came before is the top.
      if (t.k === 'cmd' && (t.v === 'atop' || t.v === 'over' || t.v === 'choose')) {
        flush()
        this.i++
        const den = this.seq(stop)
        const f = `<m:f>${t.v === 'over' ? '' : '<m:fPr><m:type m:val="noBar"/></m:fPr>'}<m:num>${out}</m:num><m:den>${den}</m:den></m:f>`
        return t.v === 'choose' ? dXml('(', ')', f) : f
      }
      // A plain character joins the current run unless a script follows it.
      const atom = this.atom()
      if (atom === null) continue
      const next = this.peek()
      if (next && (next.k === '^' || next.k === '_')) {
        flush()
        out += this.scripts(atom.xml)
      } else if (atom.text !== undefined && atom.style === runStyle) {
        run += atom.text
      } else if (atom.text !== undefined) {
        flush()
        run = atom.text
        runStyle = atom.style ?? ''
      } else {
        flush()
        out += atom.xml
      }
    }
    flush()
    return out
  }
  group(): string {
    const t = this.peek()
    if (t?.k === '{') {
      this.i++
      const inner = this.seq()
      if (this.peek()?.k === '}') this.i++
      return inner
    }
    const a = this.atom()
    return a ? a.xml : ''
  }
  /** Text of a {…} group as typed (for \text, \operatorname, environment names). */
  rawGroup(): string {
    if (this.peek()?.k !== '{') return ''
    this.i++
    let s = ''
    let depth = 0
    for (;;) {
      const t = this.toks[this.i++]
      if (!t) break
      if (t.k === '}' && depth === 0) break
      if (t.k === '{') depth++
      if (t.k === '}') depth--
      s += t.k === 'cmd' ? (SYMBOLS[t.v] ?? (t.v.length === 1 ? t.v : `\\${t.v}`)) : t.k === 'ch' ? t.v : t.k === '{' ? '{' : t.k === '}' ? '}' : t.k === '^' ? '^' : t.k === '_' ? '_' : ''
    }
    return s.replace(/\u0001/g, ' ')
  }
  scripts(base: string): string {
    let sub: string | null = null
    let sup: string | null = null
    for (;;) {
      const t = this.peek()
      if (t?.k === '^' && sup === null) {
        this.i++
        sup = this.group()
      } else if (t?.k === '_' && sub === null) {
        this.i++
        sub = this.group()
      } else break
    }
    const e = `<m:e>${base}</m:e>`
    if (sub !== null && sup !== null) return `<m:sSubSup>${e}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`
    if (sup !== null) return `<m:sSup>${e}<m:sup>${sup}</m:sup></m:sSup>`
    return `<m:sSub>${e}<m:sub>${sub ?? ''}</m:sub></m:sSub>`
  }
  atom(): { xml: string; text?: string; style?: string } | null {
    const t = this.toks[this.i++]
    if (!t) return null
    if (t.k === 'ch') return { xml: mr(t.v), text: t.v }
    if (t.k === '{') {
      const inner = this.seq()
      if (this.peek()?.k === '}') this.i++
      return { xml: inner }
    }
    if (t.k === '^' || t.k === '_') {
      // A script with no base.
      this.i--
      return { xml: this.scripts('') }
    }
    if (t.k === '&' || t.k === 'nl') return { xml: '' }
    if (t.k !== 'cmd') return null
    const c = t.v
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac' || c === 'cfrac') {
      const num = this.group()
      const den = this.group()
      return { xml: `<m:f><m:num>${num}</m:num><m:den>${den}</m:den></m:f>` }
    }
    if (c === 'binom') {
      const a = this.group()
      const b = this.group()
      return { xml: `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${a}</m:num><m:den>${b}</m:den></m:f></m:e></m:d>` }
    }
    if (c === 'sqrt') {
      let deg = ''
      if (this.peek()?.k === 'ch' && (this.peek() as { v: string }).v === '[') {
        this.i++
        deg = this.seq((x) => x.k === 'ch' && x.v === ']')
        this.i++
      }
      const e = this.group()
      return { xml: `<m:rad>${deg ? '' : '<m:radPr><m:degHide m:val="1"/></m:radPr>'}<m:deg>${deg}</m:deg><m:e>${e}</m:e></m:rad>` }
    }
    if (c in NARY) {
      let sub = ''
      let sup = ''
      for (;;) {
        const p = this.peek()
        if (p?.k === '_') {
          this.i++
          sub = this.group()
        } else if (p?.k === '^') {
          this.i++
          sup = this.group()
        } else if (p?.k === 'cmd' && (p.v === 'limits' || p.v === 'nolimits')) this.i++
        else break
      }
      const isInt = c.includes('int')
      // The operand: the term that follows (up to + − = , or the group's end).
      // ({…} right after the operator is the operand, as ommlToLatex writes it.)
      const e = this.peek()?.k === '{' ? this.group() : this.seq((x) => (x.k === 'ch' && '+-=<>,'.includes(x.v)) || x.k === '&' || x.k === 'nl' || (x.k === 'cmd' && (x.v === 'right' || x.v === 'end')))
      const pr = `<m:naryPr><m:chr m:val="${NARY[c]}"/>${isInt ? '' : '<m:limLoc m:val="undOvr"/>'}${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>`
      return { xml: `<m:nary>${pr}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${e}</m:e></m:nary>` }
    }
    if (c === 'left') {
      const open = this.delim()
      const inner = this.seq((x) => x.k === 'cmd' && x.v === 'right')
      let close = ''
      if (this.peek()?.k === 'cmd') {
        this.i++
        close = this.delim()
      }
      return { xml: dXml(open, close, inner) }
    }
    if (c === 'right') return { xml: '' }
    if (c === 'text' || c === 'mathrm' || c === 'textrm' || c === 'operatorname' || c === 'mathbf' || c === 'textbf' || c === 'mathit' || c === 'textit' || c === 'mathsf' || c === 'mathcal' || c === 'mathbb') {
      const raw = this.rawGroup()
      const style = c === 'mathbf' || c === 'textbf' ? 'b' : c === 'mathit' || c === 'textit' ? 'i' : 'p'
      const nor = c === 'text' || c === 'textrm' || c === 'textbf' || c === 'textit'
      return { xml: mr(raw, style, nor), text: nor ? undefined : raw, style }
    }
    if (c in ACCENTS) {
      const e = this.group()
      return { xml: `<m:acc><m:accPr><m:chr m:val="${ACCENTS[c]}"/></m:accPr><m:e>${e}</m:e></m:acc>` }
    }
    if (c === 'overline' || c === 'underline') {
      const e = this.group()
      return { xml: `<m:bar><m:barPr><m:pos m:val="${c === 'overline' ? 'top' : 'bot'}"/></m:barPr><m:e>${e}</m:e></m:bar>` }
    }
    if (c === 'begin') {
      const env = this.rawGroup()
      const rows: string[][] = [[]]
      for (;;) {
        const cell = this.seq((x) => x.k === '&' || x.k === 'nl' || (x.k === 'cmd' && x.v === 'end'))
        rows[rows.length - 1].push(cell)
        const p = this.toks[this.i]
        if (!p) break
        this.i++
        if (p.k === '&') continue
        if (p.k === 'nl') {
          rows.push([])
          continue
        }
        if (p.k === 'cmd' && p.v === 'end') {
          this.rawGroup()
          break
        }
        if (p.k === '}') break
      }
      while (rows.length > 1 && rows[rows.length - 1].every((x) => !x)) rows.pop()
      const m = `<m:m>${rows.map((r) => `<m:mr>${r.map((x) => `<m:e>${x}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`
      const [o, cl] = MATRIX_DELIMS[env] ?? ['', '']
      if (env === 'aligned' || env === 'align' || env === 'align*' || env === 'eqnarray') {
        return { xml: `<m:eqArr>${rows.map((r) => `<m:e>${r.join('')}</m:e>`).join('')}</m:eqArr>` }
      }
      return { xml: o || cl ? dXml(o, cl, m) : m }
    }
    if (FUNCS.has(c)) {
      const name = mr(c, 'p')
      const p = this.peek()
      if (c === 'lim' && p?.k === '_') {
        this.i++
        const lim = this.group()
        return { xml: `<m:limLow><m:e>${name}</m:e><m:lim>${lim}</m:lim></m:limLow>` }
      }
      return { xml: name, text: c, style: 'p' }
    }
    if (c in SYMBOLS) return { xml: mr(SYMBOLS[c]), text: SYMBOLS[c] }
    if (c === ',' || c === ':' || c === ';' || c === ' ') return { xml: mr(' '), text: ' ' }
    if (c === '!') return { xml: '' }
    if (c === '{' || c === '}' || c === '%' || c === '$' || c === '#' || c === '_' || c === '&') return { xml: mr(c), text: c }
    if (c === 'displaystyle' || c === 'textstyle' || c === 'limits' || c === 'nolimits') return { xml: '' }
    // Unknown: keep the command as text, so nothing is lost.
    return { xml: mr(`\\${c}`), text: `\\${c}` }
  }
  delim(): string {
    const t = this.toks[this.i++]
    if (!t) return ''
    if (t.k === 'ch') return t.v === '.' ? '' : t.v
    if (t.k === 'cmd') return t.v === '{' ? '{' : t.v === '}' ? '}' : t.v === '|' ? '‖' : (SYMBOLS[t.v] ?? '')
    return ''
  }
}

function mr(text: string, style = '', nor = false): string {
  const pr = style || nor ? `<m:rPr>${nor ? '<m:nor/>' : ''}${style ? `<m:sty m:val="${style}"/>` : ''}</m:rPr>` : ''
  return `<m:r>${pr}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`
}

function dXml(open: string, close: string, inner: string): string {
  return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr><m:e>${inner}</m:e></m:d>`
}

/** The inside of an <m:oMath> for a LaTeX formula. */
export function latexToOmml(latex: string): string {
  try {
    // Spaces in \text{…} matter: keep them through the tokenizer.
    const kept = latex.replace(/\\(text|textrm|textbf|textit|mbox|operatorname)\{([^{}]*)\}/g, (_m, c: string, t: string) => `\\${c}{${t.replace(/ /g, '\u0001')}}`)
    const p = new Parser(tokenize(kept))
    let out = ''
    while (p.i < p.toks.length) {
      out += p.seq()
      if (p.peek()?.k === '}') p.i++ // stray closing brace
    }
    return out || mr(' ')
  } catch {
    return mr(latex)
  }
}

// ------------------------------------------------------------------ OMML → LaTeX

const arg = (s: string) => `{${s}}`

function runText(r: XmlElement): string {
  const t = kids(r, 'm:t').map(textOf).join('')
  const rPr = kid(r, 'm:rPr')
  const sty = kid(rPr, 'm:sty')?.attrs['m:val']
  const nor = !!kid(rPr, 'm:nor')
  if (nor) return `\\text{${t.replace(/ /g, '\u0001')}}`
  if (FUNCS.has(t.trim()) && (sty === 'p' || !sty)) return `\\${t.trim()} `
  let out = ''
  for (const ch of t) {
    if (SYMBOL_OF[ch] && ch !== '{' && ch !== '}' && ch !== '|') out += `\\${SYMBOL_OF[ch]} `
    else if (ch === ' ') out += '\\,'
    else if (ch === '{' || ch === '}' || ch === '%' || ch === '#' || ch === '&' || ch === '$') out += `\\${ch}`
    else out += ch
  }
  if (sty === 'p' && /[a-zA-Z]{2,}/.test(t)) return `\\mathrm{${out}}`
  if (sty === 'b') return `\\mathbf{${out}}`
  return out
}

function kidsLatex(el: XmlElement | undefined): string {
  if (!el) return ''
  let s = ''
  for (const c of el.children) if (typeof c !== 'string') s += toLatex(c)
  return tidy(s)
}

function tidy(s: string): string {
  // A space ends a command name only when a letter follows.
  return s.replace(/(\\[a-zA-Z]+) +(?![a-zA-Z])/g, '$1').replace(/ +(?=[\s}^_)\]]|$)/g, '').replace(/ +/g, ' ')
}

function delimLatex(ch: string | undefined, fallback: string, side: 'left' | 'right'): string {
  const c = ch === undefined ? fallback : ch
  if (c === '') return `\\${side}.`
  if (c === '{' || c === '}') return `\\${side}\\${c}`
  if (c === '‖') return `\\${side}\\|`
  if (c === '⟨') return `\\${side}\\langle `
  if (c === '⟩') return `\\${side}\\rangle `
  return `\\${side}${c}`
}

/** LaTeX for an OMML element (an <m:oMath> or any part of one). */
export function ommlToLatex(el: XmlElement): string {
  // Spaces inside \text{} are kept apart from the tidying.
  return toLatex(el).replace(/\u0001/g, ' ')
}

function toLatex(el: XmlElement): string {
  const v = (parent: XmlElement | undefined, name: string) => kid(parent, name)?.attrs['m:val']
  switch (el.name) {
    case 'm:oMathPara':
    case 'm:oMath':
    case 'm:e':
    case 'm:num':
    case 'm:den':
    case 'm:sub':
    case 'm:sup':
    case 'm:deg':
    case 'm:lim':
    case 'm:fName':
      return kidsLatex(el)
    case 'm:r':
      return runText(el)
    case 'w:r':
      return kids(el, 'w:t').map(textOf).join('')
    case 'm:f': {
      const type = v(kid(el, 'm:fPr'), 'm:type')
      const num = kidsLatex(kid(el, 'm:num'))
      const den = kidsLatex(kid(el, 'm:den'))
      return type === 'noBar' ? `{${num} \\atop ${den}}` : type === 'lin' ? `${num}/${den}` : `\\frac${arg(num)}${arg(den)}`
    }
    case 'm:sSup':
      return `${wrapBase(kidsLatex(kid(el, 'm:e')))}^${arg(kidsLatex(kid(el, 'm:sup')))}`
    case 'm:sSub':
      return `${wrapBase(kidsLatex(kid(el, 'm:e')))}_${arg(kidsLatex(kid(el, 'm:sub')))}`
    case 'm:sSubSup':
      return `${wrapBase(kidsLatex(kid(el, 'm:e')))}_${arg(kidsLatex(kid(el, 'm:sub')))}^${arg(kidsLatex(kid(el, 'm:sup')))}`
    case 'm:sPre':
      return `{}_${arg(kidsLatex(kid(el, 'm:sub')))}^${arg(kidsLatex(kid(el, 'm:sup')))}${kidsLatex(kid(el, 'm:e'))}`
    case 'm:rad': {
      const hide = v(kid(el, 'm:radPr'), 'm:degHide')
      const deg = kidsLatex(kid(el, 'm:deg'))
      const e = kidsLatex(kid(el, 'm:e'))
      return hide === '1' || hide === 'on' || hide === 'true' || !deg ? `\\sqrt${arg(e)}` : `\\sqrt[${deg}]${arg(e)}`
    }
    case 'm:nary': {
      const pr = kid(el, 'm:naryPr')
      const ch = v(pr, 'm:chr') ?? '∫'
      const name = NARY_OF[ch]
      const sub = kidsLatex(kid(el, 'm:sub'))
      const sup = kidsLatex(kid(el, 'm:sup'))
      const op = name ? `\\${name}` : ch
      return `${op}${sub ? `_${arg(sub)}` : ''}${sup ? `^${arg(sup)}` : ''}${arg(kidsLatex(kid(el, 'm:e')))}`
    }
    case 'm:d': {
      const pr = kid(el, 'm:dPr')
      const open = v(pr, 'm:begChr')
      const close = v(pr, 'm:endChr')
      const sep = v(pr, 'm:sepChr') ?? '|'
      const inner = kids(el, 'm:e').map(kidsLatex).join(sep === '|' ? ' | ' : sep)
      // A matrix in parentheses/brackets reads back as pmatrix/bmatrix.
      const es = kids(el, 'm:e')
      const only = es.length === 1 ? kids(es[0]) : []
      if (only.length === 1 && only[0].name === 'm:m') {
        const env = Object.entries(MATRIX_DELIMS).find(([, d]) => d[0] === (open ?? '(') && d[1] === (close ?? ')'))?.[0]
        if (env) return matrixLatex(only[0], env)
      }
      return `${delimLatex(open, '(', 'left')}${inner}${delimLatex(close, ')', 'right')}`
    }
    case 'm:m':
      return matrixLatex(el, 'matrix')
    case 'm:eqArr':
      return `\\begin{aligned}${kids(el, 'm:e').map(kidsLatex).join(' \\\\ ')}\\end{aligned}`
    case 'm:acc': {
      const ch = v(kid(el, 'm:accPr'), 'm:chr') ?? '̂'
      return `\\${ACCENT_OF[ch] ?? 'hat'}${arg(kidsLatex(kid(el, 'm:e')))}`
    }
    case 'm:bar': {
      const pos = v(kid(el, 'm:barPr'), 'm:pos')
      return `\\${pos === 'top' ? 'overline' : 'underline'}${arg(kidsLatex(kid(el, 'm:e')))}`
    }
    case 'm:func':
      return `${kidsLatex(kid(el, 'm:fName'))} ${kidsLatex(kid(el, 'm:e'))}`
    case 'm:limLow':
      return `${kidsLatex(kid(el, 'm:e'))}_${arg(kidsLatex(kid(el, 'm:lim')))}`
    case 'm:limUpp':
      return `${kidsLatex(kid(el, 'm:e'))}^${arg(kidsLatex(kid(el, 'm:lim')))}`
    case 'm:groupChr':
    case 'm:box':
    case 'm:borderBox':
      return kidsLatex(kid(el, 'm:e'))
    case 'm:phant':
      return ''
    default:
      if (el.name.endsWith('Pr')) return ''
      return kidsLatex(el)
  }
}

function wrapBase(s: string): string {
  return s.length <= 1 || /^\\[a-zA-Z]+ ?$/.test(s) ? s.trim() : `{${s}}`
}

function matrixLatex(m: XmlElement, env: string): string {
  const rows = kids(m, 'm:mr').map((r) => kids(r, 'm:e').map(kidsLatex).join(' & '))
  return `\\begin{${env}}${rows.join(' \\\\ ')}\\end{${env}}`
}
