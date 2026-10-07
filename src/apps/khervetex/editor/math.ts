// LaTeX maths drawn with KaTeX for the visual editor. The LaTeX itself goes to
// the PDF unchanged; this is only the on-screen preview.

import katex from 'katex'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'

const cache = new Map<string, { html: string; ok: boolean }>()

// Commands KaTeX does not know but that only label or number an equation.
const STRIP_RE = /\\(?:label|tag\*?)\{[^}]*\}|\\(?:nonumber|notag)\b/g

/** KaTeX HTML for `latex`, or ok:false when KaTeX cannot read it. */
export function renderMath(latex: string, display: boolean): { html: string; ok: boolean } {
  const key = `${display ? 'D' : 'I'}${latex}`
  const hit = cache.get(key)
  if (hit) return hit
  let out: { html: string; ok: boolean }
  try {
    const html = katex.renderToString(latex.replace(STRIP_RE, ''), {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxExpand: 1000,
      maxSize: 40,
    })
    out = { html, ok: true }
  } catch {
    out = { html: '', ok: false }
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, out)
  return out
}

/** Fill `el` with the maths, or with its LaTeX source when KaTeX cannot draw it. */
export function paintMath(el: HTMLElement, latex: string, display: boolean): void {
  const { html, ok } = renderMath(latex, display)
  el.classList.toggle('ktx-math-error', !ok && !!latex.trim())
  if (ok) el.innerHTML = html
  else el.textContent = latex.trim() ? (display ? latex : `$${latex}$`) : display ? 'Empty equation' : '$ $'
}
