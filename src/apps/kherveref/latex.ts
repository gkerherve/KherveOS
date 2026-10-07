// LaTeX <-> Unicode for BibTeX field values (the desktop's kherveref/latex.py).
// The library stores plain Unicode ("Müller", "–"); .bib files often spell
// accents as macros ({\"u}, \'{e}, \c{c}), decoded on import. The classic
// BibTeX writer encodes them back; the BibLaTeX writer keeps UTF-8.

const ACCENTS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', u: '̆',
  v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
}
const COMBINING_TO_MACRO: Record<string, string> = Object.fromEntries(Object.entries(ACCENTS).map(([k, v]) => [v, k]))

/** Letter-like macros. */
const SYMBOLS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð',
  th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ', S: '§', P: '¶', copyright: '©', textregistered: '®', texttrademark: '™', textdegree: '°',
  textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  dag: '†', ddag: '‡', textellipsis: '…', ldots: '…', dots: '…', textasciitilde: '~', textbackslash: '\\', pounds: '£', euro: '€',
  textmu: 'µ',
}
const NOT_ENCODED = new Set([
  'ldots', 'dots', 'textellipsis', 'i', 'j', 'textasciitilde', 'textbackslash', 'textendash', 'textemdash', 'textquoteleft',
  'textquoteright', 'textquotedblleft', 'textquotedblright',
])
const SYMBOL_TO_MACRO: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOLS)
    .filter(([k]) => !NOT_ENCODED.has(k))
    .map(([k, v]) => [v, k]),
)
SYMBOL_TO_MACRO['…'] = 'ldots'

const ESCAPED: Record<string, string> = { '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_' }

const ACCENT_RE = /\{?\\(['`^"~=.]|[uvHckrdb](?=[\s{]))\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij]|[A-Za-z]))\}?/g
const SYMBOL_RE = new RegExp(
  '\\{?\\\\(' +
    Object.keys(SYMBOLS)
      .sort((a, b) => b.length - a.length)
      .join('|') +
    ')(?![A-Za-z])(?:\\{\\})?\\s?\\}?',
  'g',
)
const MATH_SPLIT = /(\$[^$]*\$)/

/** Apply `fn` to the parts of `s` outside $math$. */
function outsideMath(s: string, fn: (part: string) => string): string {
  const parts = s.split(MATH_SPLIT)
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i])
  return parts.join('')
}

/** Decode accent and symbol macros, escaped specials and dashes. Math and unknown macros are left alone. */
export function latexToUnicode(s: string): string {
  if (!s.includes('\\') && !s.includes('--') && !s.includes('~')) return s
  return outsideMath(s, (p) => {
    p = p.replace(ACCENT_RE, (_m, macro: string, b1?: string, b2?: string) => {
      let base = b1 || b2 || ''
      if (base === '\\i' || base === '\\j') base = base[1]
      return (base + ACCENTS[macro]).normalize('NFC')
    })
    p = p.replace(SYMBOL_RE, (_m, name: string) => SYMBOLS[name])
    for (const [ch, esc] of Object.entries(ESCAPED)) p = p.split(esc).join(ch)
    p = p.replace(/---/g, '—').replace(/--/g, '–')
    p = p.replace(/(?<!\\)~/g, '\u00a0') // a tie is a no-break space
    return p.replace(/``/g, '“').replace(/''/g, '”')
  })
}

/** Encode for a .bib value. Escapes BibTeX specials always; with `asciiOnly` also turns accented letters into macros. */
export function unicodeToLatex(s: string, asciiOnly = true): string {
  return outsideMath(s, (part) => {
    const out: string[] = []
    for (const ch of part) {
      if (ch in ESCAPED && !(out.length && out[out.length - 1].endsWith('\\'))) out.push(ESCAPED[ch])
      else if (!asciiOnly || ch.codePointAt(0)! < 128) out.push(ch)
      else out.push(encodeChar(ch))
    }
    return out.join('')
  })
}

function encodeChar(ch: string): string {
  if (ch === '–') return '--'
  if (ch === '—') return '---'
  if (ch === ' ') return '~'
  if (ch === '‘') return '`'
  if (ch === '’') return "'"
  if (ch === '“') return '``'
  if (ch === '”') return "''"
  if (ch in SYMBOL_TO_MACRO) return `{\\${SYMBOL_TO_MACRO[ch]}}`
  const decomposed = [...ch.normalize('NFD')]
  const base = decomposed[0]
  const marks = decomposed.slice(1)
  if (marks.length && marks.every((m) => m in COMBINING_TO_MACRO) && base.codePointAt(0)! < 128) {
    // Always the braced form: {\"{o}}, {\'{\i}}, {\c{c}}.
    let out = base === 'i' || base === 'j' ? `\\${base}` : base
    for (const m of marks) out = `\\${COMBINING_TO_MACRO[m]}{${out}}`
    return `{${out}}`
  }
  return ch // no ASCII spelling: leave it for the engine
}

/** Drop BibTeX case-protection braces ({DNA} -> DNA), keeping math. */
export function stripBraces(s: string): string {
  return outsideMath(s, (p) => p.replace(/(?<!\\)[{}]/g, ''))
}

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()

/** Brace words BibTeX styles must not lower-case: acronyms (XPS), mixed case (TiO2, pH, McDonald), single capitals after the first word. */
export function protectCase(title: string): string {
  const parts = title.split(/(\$[^$]*\$|\\[A-Za-z]+|\{[^{}]*\})/)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*/gu, (w: string, offset: number) => {
      const chars = [...w]
      if (chars.slice(1).some(isUpper) || (chars.length === 1 && isUpper(w) && offset > 0)) return `{${w}}`
      return w
    })
  }
  return parts.join('')
}
