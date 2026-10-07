// A text box's LaTeX shown as it prints, for the canvas, the slide sorter and
// the slideshow: lists (nested itemize / enumerate with the theme's bullets),
// line breaks as the serializer emits them, text styles, colours, links and
// maths typeset by KaTeX (mhchem for \ce{…}). The PDF (LaTeX service) stays the
// exact check, as on the desktop, whose canvas does the same.
//
// The output is built from escaped text and KaTeX's HTML only (trust: false),
// so it is safe to put in innerHTML. No DOM here.

import katex from 'katex'
import 'katex/contrib/mhchem'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const mathCache = new Map<string, string>()

/** KaTeX HTML for `tex`, or the source in a warning colour when KaTeX can't read it. */
export function mathHtml(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex
  const hit = mathCache.get(key)
  if (hit !== undefined) return hit
  let out: string
  const src = tex.replace(/\\(?:label|tag\*?)\{[^}]*\}|\\(?:nonumber|notag)\b/g, '')
  try {
    out = katex.renderToString(src, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 40 })
  } catch {
    out = `<span class="ks2-tex-error" title="Not understood by the maths preview (the PDF is exact)">${esc(display ? tex : `$${tex}$`)}</span>`
  }
  if (mathCache.size > 3000) mathCache.clear()
  mathCache.set(key, out)
  return out
}

/** xcolor's names the desktop canvas knows. */
export const NAMED_COLORS: Record<string, string> = {
  red: '#FF0000', green: '#00A000', blue: '#0000FF', orange: '#FF8000', black: '#000000', white: '#FFFFFF', gray: '#808080',
  purple: '#BF0040', teal: '#008080', cyan: '#00FFFF', magenta: '#FF00FF', brown: '#BF8040', violet: '#800080', olive: '#808000',
  darkgray: '#404040', lightgray: '#BFBFBF', yellow: '#FFFF00', lime: '#BFFF00', pink: '#FFBFBF',
}

/** A colour spec of \textcolor / \color ("red", "red!50", "[HTML]{1A2B3C}") as CSS. */
function cssColor(model: string, spec: string): string {
  if (/^html$/i.test(model) && /^[0-9a-f]{6}$/i.test(spec.trim())) return '#' + spec.trim()
  if (/^rgb$/i.test(model)) {
    const n = spec.split(',').map(Number)
    if (n.length === 3 && n.every((v) => v >= 0 && v <= 1)) return `rgb(${n.map((v) => Math.round(v * 255)).join(',')})`
  }
  const [name, pct] = spec.trim().split('!')
  const base = NAMED_COLORS[name] ?? (/^[0-9a-f]{6}$/i.test(name) ? '#' + name : null)
  if (!base) return 'inherit'
  const p = Number(pct)
  if (pct !== undefined && p >= 0 && p <= 100) return `color-mix(in srgb, ${base} ${p}%, white)`
  return base
}

export function today(d = new Date()): string {
  const month = d.toLocaleString('en-GB', { month: 'long' })
  return `${month} ${d.getDate()}, ${d.getFullYear()}`
}

/** The balanced {…} starting at s[i] === '{': [content, index after]. */
function group(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const ch = s[j]
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return [s.slice(i + 1), s.length]
}

/** An optional [..] argument at s[i]. */
function optArg(s: string, i: number): [string, number] | null {
  if (s[i] !== '[') return null
  const j = s.indexOf(']', i)
  return j < 0 ? null : [s.slice(i + 1, j), j + 1]
}

const skipSpaces = (s: string, i: number) => {
  while (s[i] === ' ' || s[i] === '\t') i++
  return i
}

const SIZES: Record<string, number> = {
  tiny: 0.5, scriptsize: 0.7, footnotesize: 0.8, small: 0.9, normalsize: 1, large: 1.2, Large: 1.44, LARGE: 1.728, huge: 2.074, Huge: 2.488,
}
const SYMBOLS: Record<string, string> = {
  textbar: '|', textbullet: '•', ldots: '…', dots: '…', textendash: '–', textemdash: '—', textdegree: '°', copyright: '©',
  textregistered: '®', texttrademark: '™', S: '§', P: '¶', dag: '†', ddag: '‡', pounds: '£', euro: '€', textasciitilde: '~',
  textasciicircum: '^', textbackslash: '\\', textless: '&lt;', textgreater: '&gt;', LaTeX: 'LaTeX', TeX: 'TeX', quad: ' ', qquad: '  ',
  enspace: ' ', hfill: ' ', newline: '<br>', linebreak: '<br>', par: '<br>', centering: '', raggedright: '', raggedleft: '', noindent: '',
  medskip: '', smallskip: '', bigskip: '', pause: '', selectfont: '', relax: '', item: '', mbox: '', ignorespaces: '', unskip: '',
}
const STYLE_CMDS: Record<string, [string, string]> = {
  textbf: ['<b>', '</b>'], textit: ['<i>', '</i>'], emph: ['<em>', '</em>'], textsl: ['<i>', '</i>'], underline: ['<u>', '</u>'],
  uline: ['<u>', '</u>'], texttt: ['<span class="ks2-tt">', '</span>'], textsf: ['<span class="ks2-sf">', '</span>'],
  textrm: ['<span class="ks2-rm">', '</span>'], textsc: ['<span style="font-variant:small-caps">', '</span>'],
  textsuperscript: ['<sup>', '</sup>'], textsubscript: ['<sub>', '</sub>'], textup: ['<span style="font-style:normal">', '</span>'],
  textmd: ['<span style="font-weight:normal">', '</span>'], textnormal: ['<span style="font-weight:normal;font-style:normal">', '</span>'],
  alert: ['<span class="ks2-alert">', '</span>'], structure: ['<span class="ks2-structure">', '</span>'], mbox: ['', ''], text: ['', ''],
  hbox: ['', ''], only: ['', ''], onslide: ['', ''], uncover: ['', ''], visible: ['', ''], invisible: ['<span style="visibility:hidden">', '</span>'],
}
/** Switches that act to the end of the group. */
const SWITCHES: Record<string, string> = {
  bfseries: 'font-weight:bold', itshape: 'font-style:italic', slshape: 'font-style:italic', ttfamily: 'font-family:var(--ks2-tt)',
  sffamily: 'font-family:var(--ks2-sf)', rmfamily: 'font-family:var(--ks2-rm)', scshape: 'font-variant:small-caps', mdseries: 'font-weight:normal',
  upshape: 'font-style:normal', bf: 'font-weight:bold', it: 'font-style:italic', em: 'font-style:italic', tt: 'font-family:var(--ks2-tt)',
}
/** Commands whose arguments are dropped (spacing, labels…). */
const DROP_ARGS: Record<string, number> = {
  vspace: 1, 'vspace*': 1, hspace: 1, 'hspace*': 1, label: 1, setlength: 2, addtolength: 2, footnote: 1, index: 1, vskip: 0, hskip: 0,
  includegraphics: 1, setbeamercolor: 2, setbeamertemplate: 1, usebeamercolor: 1,
}

/** Inline LaTeX → HTML (styles, colours, maths, escapes, dashes and quotes). */
export function inlineHtml(s: string): string {
  let out = ''
  let i = 0
  let closers = 0 // spans opened by switches, closed at the end of this group
  while (i < s.length) {
    const ch = s[i]
    if (ch === '$') {
      const disp = s[i + 1] === '$'
      const open = disp ? 2 : 1
      let j = i + open
      while (j < s.length && !(s[j] === '$' && s[j - 1] !== '\\')) j++
      const tex = s.slice(i + open, j)
      out += mathHtml(tex, disp)
      i = j + open
      continue
    }
    if (ch === '{') {
      const [inner, next] = group(s, i)!
      out += inlineHtml(inner)
      i = next
      continue
    }
    if (ch === '}') {
      i++
      continue
    }
    if (ch === '~') {
      out += ' '
      i++
      continue
    }
    if (ch === '%') {
      // A comment runs to the end of the line.
      const j = s.indexOf('\n', i)
      i = j < 0 ? s.length : j
      continue
    }
    if (ch === '-' && s.startsWith('---', i)) {
      out += '—'
      i += 3
      continue
    }
    if (ch === '-' && s.startsWith('--', i)) {
      out += '–'
      i += 2
      continue
    }
    if (ch === '`' && s[i + 1] === '`') {
      out += '“'
      i += 2
      continue
    }
    if (ch === "'" && s[i + 1] === "'") {
      out += '”'
      i += 2
      continue
    }
    if (ch === '`') {
      out += '‘'
      i++
      continue
    }
    if (ch === "'") {
      out += '’'
      i++
      continue
    }
    if (ch !== '\\') {
      out += esc(ch)
      i++
      continue
    }
    // ---- a command
    const nxt = s[i + 1] ?? ''
    if (nxt === '\\') {
      out += '<br>'
      i = s[i + 2] === '[' ? (optArg(s, i + 2)?.[1] ?? i + 2) : i + 2
      continue
    }
    if (nxt === '(') {
      const j = s.indexOf('\\)', i + 2)
      const end = j < 0 ? s.length : j
      out += mathHtml(s.slice(i + 2, end), false)
      i = end + 2
      continue
    }
    if (nxt === '[') {
      const j = s.indexOf('\\]', i + 2)
      const end = j < 0 ? s.length : j
      out += `<span class="ks2-display">${mathHtml(s.slice(i + 2, end), true)}</span>`
      i = end + 2
      continue
    }
    if ('&%$#_{}'.includes(nxt) && nxt) {
      out += esc(nxt)
      i += 2
      continue
    }
    if (nxt === ',' || nxt === ';' || nxt === ':' || nxt === ' ' || nxt === '!' || nxt === '/') {
      out += nxt === ',' ? ' ' : nxt === '!' || nxt === '/' ? '' : ' '
      i += 2
      continue
    }
    const m = /^[A-Za-z]+\*?/.exec(s.slice(i + 1))
    if (!m) {
      out += esc(nxt)
      i += 2
      continue
    }
    let name = m[0]
    let j = i + 1 + name.length
    if (name.endsWith('*') && !(name in DROP_ARGS)) {
      name = name.slice(0, -1)
      j--
    }
    const arg = (k: number): [string, number] => {
      const a = skipSpaces(s, k)
      return group(s, a) ?? [s[a] ?? '', a + 1]
    }
    if (name === 'textcolor') {
      let model = ''
      const o = optArg(s, j)
      if (o) [model, j] = o
      const [spec, a] = arg(j)
      const [body, b] = arg(a)
      out += `<span style="color:${cssColor(model, spec)}">${inlineHtml(body)}</span>`
      i = b
      continue
    }
    if (name === 'color') {
      let model = ''
      const o = optArg(s, j)
      if (o) [model, j] = o
      const [spec, a] = arg(j)
      out += `<span style="color:${cssColor(model, spec)}">`
      closers++
      i = a
      continue
    }
    if (name === 'colorbox') {
      let model = ''
      const o = optArg(s, j)
      if (o) [model, j] = o
      const [spec, a] = arg(j)
      const [body, b] = arg(a)
      out += `<span style="background:${cssColor(model, spec)};padding:0 .15em">${inlineHtml(body)}</span>`
      i = b
      continue
    }
    if (name === 'href') {
      const [, a] = arg(j)
      const [body, b] = arg(a)
      out += `<span class="ks2-link">${inlineHtml(body)}</span>`
      i = b
      continue
    }
    if (name === 'url') {
      const [u, a] = arg(j)
      out += `<span class="ks2-link ks2-tt">${esc(u)}</span>`
      i = a
      continue
    }
    if (name === 'ce' || name === 'pu') {
      const [body, a] = arg(j)
      out += mathHtml(`\\${name}{${body}}`, false)
      i = a
      continue
    }
    if (name === 'today') {
      out += esc(today())
      i = s[j] === '{' && s[j + 1] === '}' ? j + 2 : j
      continue
    }
    if (name in STYLE_CMDS) {
      if (s[skipSpaces(s, j)] === '<') {
        // \only<2>{…}: overlay specifications are ignored.
        const k = s.indexOf('>', j)
        if (k > 0) j = k + 1
      }
      const [a, b] = STYLE_CMDS[name]
      const [body, next] = arg(j)
      out += a + inlineHtml(body) + b
      i = next
      continue
    }
    if (name in SIZES) {
      out += `<span style="font-size:${SIZES[name]}em">`
      closers++
      i = j
      continue
    }
    if (name in SWITCHES) {
      out += `<span style="${SWITCHES[name]}">`
      closers++
      i = j
      continue
    }
    if (name in DROP_ARGS) {
      let k = j
      for (let n = 0; n < DROP_ARGS[name]; n++) {
        const o = optArg(s, skipSpaces(s, k))
        if (o) k = o[1]
        k = arg(k)[1]
      }
      i = k
      continue
    }
    if (name in SYMBOLS) {
      out += SYMBOLS[name]
      i = s[j] === '{' && s[j + 1] === '}' ? j + 2 : j
      continue
    }
    // Unknown: keep what it wraps (\chemfig{…} and friends show their source).
    if (s[j] === '{') {
      const [body, next] = group(s, j)!
      out += `<span class="ks2-tex-cmd">\\${esc(name)}{${esc(body)}}</span>`
      i = next
    } else {
      out += `<span class="ks2-tex-cmd">\\${esc(name)}</span>`
      i = j
    }
  }
  return out + '</span>'.repeat(closers)
}

// ------------------------------------------------------------------ block level

const DISPLAY_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'displaymath', 'eqnarray', 'eqnarray*']
const ALIGN_ENVS: Record<string, string> = { center: 'center', flushleft: 'left', flushright: 'right' }

/** Display maths spans (possibly several lines) → placeholders, with their HTML. */
function liftDisplayMath(text: string, store: string[]): string {
  const put = (html: string) => {
    store.push(html)
    return `\u0000${store.length - 1}\u0000`
  }
  let t = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => put(mathHtml(m, true)))
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => put(mathHtml(m, true)))
  for (const env of DISPLAY_ENVS) {
    const e = env.replace('*', '\\*')
    const re = new RegExp(`\\\\begin\\{${e}\\}([\\s\\S]*?)\\\\end\\{${e}\\}`, 'g')
    t = t.replace(re, (_, m: string) => {
      const base = env.replace('*', '')
      const tex = base === 'align' || base === 'eqnarray' ? `\\begin{aligned}${m}\\end{aligned}` : base === 'gather' ? `\\begin{gathered}${m}\\end{gathered}` : m
      return put(mathHtml(tex, true))
    })
  }
  return t
}

function restore(html: string, store: string[]): string {
  return html.replace(/\u0000(\d+)\u0000/g, (_, n: string) => `<div class="ks2-display">${store[Number(n)]}</div>`)
}

/**
 * A text box's LaTeX as HTML. Lines follow the serializer: a line is a line
 * (Enter is a \\ there), an empty line between text lines is a blank line, and
 * itemize / enumerate nest.
 */
export function texToHtml(text: string): string {
  const store: string[] = []
  const src = liftDisplayMath(text || '', store)
  const out: string[] = []
  const lists: { tag: 'ul' | 'ol'; open: boolean }[] = []
  const aligns: string[] = []
  const closeLi = () => {
    const top = lists[lists.length - 1]
    if (top?.open) {
      out.push('</li>')
      top.open = false
    }
  }
  const closeAll = () => {
    while (lists.length) {
      closeLi()
      out.push(`</${lists.pop()!.tag}>`)
    }
  }
  const lines = src.split('\n')
  lines.forEach((raw, idx) => {
    let s = raw.trim()
    let mb = /^\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?/.exec(s)
    while (mb) {
      const tag = mb[1] === 'enumerate' ? 'ol' : 'ul'
      out.push(`<${tag}>`)
      lists.push({ tag, open: false })
      s = s.slice(mb[0].length).trim()
      mb = /^\\begin\{(itemize|enumerate|description)\}(\[[^\]]*\])?/.exec(s)
    }
    const me = /^\\end\{(itemize|enumerate|description)\}/.exec(s)
    if (me) {
      closeLi()
      const top = lists.pop()
      if (top) out.push(`</${top.tag}>`)
      const rest = s.slice(me[0].length).trim()
      if (rest) out.push(`<div>${inlineHtml(rest)}</div>`)
      return
    }
    const ma = /^\\(begin|end)\{(center|flushleft|flushright|minipage|quote|quotation|columns|column|block|alertblock|exampleblock)\}(\{[^}]*\}|\[[^\]]*\])*/.exec(s)
    if (ma) {
      if (ma[2] in ALIGN_ENVS) {
        if (ma[1] === 'begin') aligns.push(ALIGN_ENVS[ma[2]])
        else aligns.pop()
      }
      s = s.slice(ma[0].length).trim()
      if (!s) return
    }
    if (s.startsWith('\\item') && lists.length) {
      closeLi()
      let rest = s.slice(5)
      let label = ''
      const o = optArg(rest, 0)
      if (o) {
        label = o[0]
        rest = rest.slice(o[1])
      }
      out.push(label ? `<li class="ks2-labelled"><span class="ks2-label">${inlineHtml(label)}</span>${inlineHtml(rest.trim())}` : `<li>${inlineHtml(rest.trim())}`)
      lists[lists.length - 1].open = true
      return
    }
    if (lists.length && lists[lists.length - 1].open) {
      // A continuation line of the item.
      if (s) out.push(' ' + inlineHtml(s))
      return
    }
    if (lists.length) {
      if (s) out.push(`<div>${inlineHtml(s)}</div>`)
      return
    }
    const align = aligns.length ? ` style="text-align:${aligns[aligns.length - 1]}"` : ''
    if (s) out.push(`<div${align}>${inlineHtml(s)}</div>`)
    else {
      // An empty line: a blank line between two text lines, nothing elsewhere.
      const before = lines.slice(0, idx).reverse().find((x) => x.trim()) ?? ''
      const after = lines.slice(idx + 1).find((x) => x.trim()) ?? ''
      const plain = (x: string) => !!x.trim() && !/^\s*\\(begin|end|item)/.test(x)
      if (plain(before) && plain(after)) out.push('<div class="ks2-blank"> </div>')
    }
  })
  closeAll()
  return restore(out.join(''), store) || '&nbsp;'
}

/** The inner maths when the whole box is one expression ($…$, \[…\], \(…\)), else null. */
export function mathOnly(text: string): { tex: string; display: boolean } | null {
  const t = (text || '').trim()
  if (t.length >= 2 && t.startsWith('$') && t.endsWith('$') && !t.startsWith('$$') && !t.slice(1, -1).includes('$')) return { tex: t.slice(1, -1).trim(), display: false }
  if (t.startsWith('\\[') && t.endsWith('\\]')) return { tex: t.slice(2, -2).trim(), display: true }
  if (t.startsWith('\\(') && t.endsWith('\\)')) return { tex: t.slice(2, -2).trim(), display: false }
  return null
}

/** Plain text of a box (AI tools, the slide sorter's tooltips). */
export function texToPlain(text: string): string {
  return (text || '')
    .replace(/\\begin\{(itemize|enumerate)\}|\\end\{(itemize|enumerate)\}/g, '')
    .replace(/\\item\s*/g, '• ')
    .replace(/\\(textbf|textit|emph|underline|alert|structure|texttt)\{([^{}]*)\}/g, '$2')
    .replace(/\\textcolor(\[[^\]]*\])?\{[^}]*\}\{([^{}]*)\}/g, '$2')
    .replace(/\\\\/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}
