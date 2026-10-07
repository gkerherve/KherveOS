// Turning cell sources and outputs into HTML: Markdown (marked + DOMPurify)
// with $…$ / $$…$$ math (KaTeX), LaTeX cells, and terminal-ish output text.

import { Marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { figureUrl } from '@/os/python/kernel'
import { isLatexDocument, type Output } from './format'
import { renderLatexDocument } from './latexdoc'

// --------------------------------------------------------------------- math

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** KaTeX HTML for one formula. Throws katex.ParseError on bad input. */
export function texToHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: true,
    strict: 'ignore', // e.g. "\\" line breaks in display mode, which KaTeX handles fine
    trust: false,
    maxExpand: 1000,
    maxSize: 40,
  })
}

function mathOrError(tex: string, display: boolean, delim: [string, string]): string {
  try {
    return texToHtml(tex, display)
  } catch (e) {
    return `<span class="nb-math-error" title="${escapeHtml(errorText(e))}">${escapeHtml(delim[0] + tex + delim[1])}</span>`
  }
}

// ----------------------------------------------------------------- markdown
//
// Math is tokenized before Markdown can touch it (so `_` and `*` inside a
// formula stay TeX), rendered to a placeholder, and the KaTeX output is put
// back after DOMPurify has cleaned the Markdown HTML.

type MathToken = Tokens.Generic & { tex: string; display: boolean; delim: [string, string] }

const BLOCK_RULES: [RegExp, [string, string]][] = [
  [/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/, ['$$', '$$']],
  [/^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/, ['\\[', '\\]']],
  [/^ {0,3}(\\begin\{(equation|align|alignat|gather|multline|flalign|eqnarray)(\*?)\}[\s\S]+?\\end\{\2\3\})[ \t]*(?:\n+|$)/, ['', '']],
]
const BLOCK_START = /\n {0,3}(?:\$\$|\\\[|\\begin\{(?:equation|align|alignat|gather|multline|flalign|eqnarray))/

const INLINE_RULES: [RegExp, boolean, [string, string]][] = [
  [/^\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/, true, ['$$', '$$']],
  // $…$: no space just inside the dollars, no digit right after ("$5 and $10" is money)
  [/^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/, false, ['$', '$']],
  [/^\\\(([\s\S]+?)\\\)/, false, ['\\(', '\\)']],
  [/^\\\[([\s\S]+?)\\\]/, true, ['\\[', '\\]']],
]
const INLINE_START = /\$|\\\(|\\\[/
const MATH_SPANS = /\$\$[\s\S]+?\$\$|\$(?![\s$])(?:\\.|[^\\$\n])+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g

let mathParts: string[] = []
let mathNonce = ''

function placeholder(t: MathToken): string {
  const i = mathParts.push(mathOrError(t.tex, t.display, t.delim)) - 1
  return `<span data-nb-math="${mathNonce}-${i}"></span>`
}

/** Paths without a URL scheme are files on the KherveOS drive, resolved by the view. */
const isDrivePath = (href: string) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') && !href.startsWith('#')

const md = new Marked({
  gfm: true,
  breaks: false,
  extensions: [
    {
      name: 'nbMathBlock',
      level: 'block',
      start(src: string) {
        const i = src.search(BLOCK_START)
        return i < 0 ? undefined : i + 1
      },
      tokenizer(src: string) {
        for (const [re, delim] of BLOCK_RULES) {
          const m = re.exec(src)
          if (m) return { type: 'nbMathBlock', raw: m[0], tex: m[1].trim(), display: true, delim } as MathToken
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return `<div class="nb-math-block">${placeholder(token as MathToken)}</div>\n`
      },
    },
    {
      name: 'nbMath',
      level: 'inline',
      start(src: string) {
        const i = src.search(INLINE_START)
        return i < 0 ? undefined : i
      },
      tokenizer(src: string) {
        for (const [re, display, delim] of INLINE_RULES) {
          const m = re.exec(src)
          if (m) return { type: 'nbMath', raw: m[0], tex: m[1].trim(), display, delim } as MathToken
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return placeholder(token as MathToken)
      },
    },
  ],
  hooks: {
    // Keep * and _ inside formulas from being taken as emphasis delimiters.
    emStrongMask(src: string) {
      return src.replace(MATH_SPANS, (m) => m[0] + 'a'.repeat(Math.max(0, m.length - 2)) + m[m.length - 1])
    },
  },
  renderer: {
    image({ href, title, text }: Tokens.Image) {
      if (!isDrivePath(href)) return false
      const t = title ? ` title="${escapeHtml(title)}"` : ''
      return `<img data-nb-src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t}>`
    },
  },
})

/** Sanitised HTML for a Markdown cell. */
export function renderMarkdown(src: string): string {
  mathParts = []
  mathNonce = Math.random().toString(36).slice(2, 8)
  let html: string
  try {
    html = md.parse(src, { async: false })
  } catch (e) {
    return `<pre class="nb-math-error">${escapeHtml(errorText(e))}</pre>`
  }
  const clean = DOMPurify.sanitize(html)
  const parts = mathParts
  const re = new RegExp(`<span data-nb-math="${mathNonce}-(\\d+)"></span>`, 'g')
  return clean.replace(re, (_m, i: string) => parts[Number(i)] ?? '')
}

// --------------------------------------------------------------- LaTeX cells

export type LatexResult = { ok: true; html: string; document: boolean } | { ok: false; error: string }

/**
 * A LaTeX cell is one equation in display mode, or (like the desktop) a whole
 * document when it has \section, \textbf, \begin{document}… Equations may
 * carry their own delimiters ($…$, $$…$$) or mix text with $…$ formulas
 * (matplotlib mathtext style); both are understood.
 */
export function renderLatex(source: string): LatexResult {
  const t = source.trim()
  if (!t) return { ok: true, html: '', document: false }
  if (isLatexDocument(t)) {
    try {
      return { ok: true, html: renderLatexDocument(t), document: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  }
  const eq = renderEquation(t)
  return eq.ok ? { ...eq, document: false } : eq
}

function renderEquation(t: string): { ok: true; html: string } | { ok: false; error: string } {
  try {
    const whole = /^\$\$([\s\S]+)\$\$$/.exec(t) ?? /^\\\[([\s\S]+)\\\]$/.exec(t) ?? /^\$([^$]+)\$$/.exec(t)
    if (whole && !whole[1].includes('$')) return { ok: true, html: texToHtml(whole[1], true) }
    if (/(^|[^\\])\$/.test(t)) {
      // "Energy: $E = mc^2$" — text with inline formulas
      let html = ''
      let last = 0
      for (const m of t.matchAll(/(?<!\\)\$((?:\\.|[^\\$])+?)\$/g)) {
        const at = m.index ?? 0
        html += escapeHtml(t.slice(last, at)) + texToHtml(m[1], false)
        last = at + m[0].length
      }
      html += escapeHtml(t.slice(last))
      return { ok: true, html: `<span class="nb-tex-mixed">${html}</span>` }
    }
    return { ok: true, html: texToHtml(t, true) }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

// ------------------------------------------------------------------ outputs

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g

/** Terminal-ish text for display: colour codes dropped, \r overwrites the line (progress bars). */
export function cleanText(text: string | string[] | null | undefined): string {
  // Outputs read from files may carry their text as a list of lines, or none at all.
  let t = (Array.isArray(text) ? text.join('') : (text ?? '')).replace(ANSI, '')
  if (t.includes('\r')) {
    t = t
      .replace(/\r+\n/g, '\n')
      .split('\n')
      .map((line) => {
        if (!line.includes('\r')) return line
        let shown = ''
        for (const part of line.split('\r')) shown = part + shown.slice(part.length)
        return shown
      })
      .join('\n')
  }
  return t.endsWith('\n') ? t.slice(0, -1) : t
}

export function imageSrc(o: Extract<Output, { kind: 'image' }>): string {
  if (o.mime === 'image/svg+xml') return svgUrl(o.data)
  if (o.mime === 'image/png') return figureUrl(o.data)
  return `data:${o.mime};base64,${o.data}`
}

/** An SVG as an <img> source: drawn like a picture, so its scripts never run. */
export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------- dark page fix

function rgb(css: string): [number, number, number] | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(css)
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.2)) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/**
 * Notes written on the desktop's white page may carry inline colours: a
 * highlight (pale background) gets dark text, and near-black text is
 * lightened, so both stay readable on the dark notebook.
 */
export function fitInlineColors(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const bg = rgb(el.style.backgroundColor)
    if (bg) {
      if (luminance(bg) > 0.45) el.style.color = '#16191a'
      return
    }
    const fg = rgb(el.style.color)
    if (fg && luminance(fg) < 0.06) el.style.color = `color-mix(in srgb, ${el.style.color} 35%, var(--k-text))`
  })
}
