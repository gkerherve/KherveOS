// Geometry and text for drawing a recorded matplotlib figure (types.ts Fig)
// the way matplotlib does: axes boxes from figure fractions, data → pixel
// scales (linear / log, either direction), the tick locator and formatter of
// KherveFitting's port (mpl.ts), mathtext ($^{-1}$, $_0$, \Psi), legend
// positions. Plain functions, no DOM: Node tests load this file.

import { PT, autoTicks, formatTicks, minorTicks } from '../khervefitting/mpl.ts'
import type { AxesJ, Fig } from './types.ts'

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** The axes rectangle in pixels (figure fractions are from the bottom left). */
export function axesBox(pos: [number, number, number, number], W: number, H: number): Box {
  const [x, y, w, h] = pos
  return { x0: x * W, x1: (x + w) * W, y0: H - (y + h) * H, y1: H - y * H }
}

export interface Scale {
  /** value → pixel */
  to: (v: number) => number
  /** pixel → value */
  from: (p: number) => number
  lo: number
  hi: number
}

/** A data → pixel scale: lim[0] at p0, lim[1] at p1 (so a reversed lim draws reversed). */
export function makeScale(lim: [number, number], p0: number, p1: number, log = false): Scale {
  const f = log ? (v: number) => Math.log10(Math.max(v, 1e-300)) : (v: number) => v
  const g = log ? (v: number) => 10 ** v : (v: number) => v
  const a = f(lim[0])
  const b = f(lim[1])
  const span = b - a || 1
  return {
    to: (v) => p0 + ((f(v) - a) / span) * (p1 - p0),
    from: (p) => g(a + ((p - p0) / (p1 - p0)) * span),
    lo: Math.min(lim[0], lim[1]),
    hi: Math.max(lim[0], lim[1]),
  }
}

/** The limits of an axes, falling back to [0, 1] for what Python could not compute. */
export function limitsOf(ax: AxesJ): { x: [number, number]; y: [number, number] } {
  const fix = (l: [number | null, number | null]): [number, number] => {
    const a = l[0] ?? 0
    const b = l[1] ?? 1
    return a === b ? [a - 0.5, b + 0.5] : [a, b]
  }
  return { x: fix(ax.xlim), y: fix(ax.ylim) }
}

export interface Ticks {
  major: number[]
  minor: number[]
  labels: string[]
  /** The "×10ⁿ" / offset text matplotlib puts at the end of the axis, or ''. */
  corner: string
}

/** Major / minor ticks and their labels, as AutoLocator + ScalarFormatter (ticklabel_format style). */
export function axisTicks(lim: [number, number], lengthPx: number, labelPt: number, axis: 'x' | 'y', format: string, fixed?: number[] | null, fixedLabels?: string[] | null, minorN = 0): Ticks {
  const lo = Math.min(lim[0], lim[1])
  const hi = Math.max(lim[0], lim[1])
  if (fixed) {
    const major = fixed.filter((t) => t >= lo - 1e-12 * Math.abs(hi - lo) && t <= hi + 1e-12 * Math.abs(hi - lo))
    const labels = fixedLabels ?? formatTicks(major, lo, hi, false).labels
    return { major, minor: [], labels, corner: '' }
  }
  const major = autoTicks(lo, hi, Math.abs(lengthPx), labelPt, axis)
  let f = formatTicks(major, lo, hi, format === 'sci')
  if (format === 'plain' && f.order !== 0) {
    // ticklabel_format(style='plain'): no ×10ⁿ, as many decimals as the step needs
    const step = major.length > 1 ? Math.abs(major[1] - major[0]) : 1
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
    f = { labels: major.map((t) => minusSign(t.toFixed(dec))), order: 0, offset: f.offset }
  }
  const inside = major.map((t, i) => [t, f.labels[i]] as const).filter(([t]) => t >= lo - Math.abs(hi - lo) * 1e-9 && t <= hi + Math.abs(hi - lo) * 1e-9)
  let corner = ''
  if (f.order !== 0) corner = `×10${superscriptText(f.order)}`
  if (f.offset) corner = (corner ? `${corner}` : '') + `${f.offset > 0 ? '+' : MINUS}${trimNumber(Math.abs(f.offset))}`
  return {
    major: inside.map(([t]) => t),
    labels: inside.map(([, l]) => l),
    minor: minorN > 1 ? minorTicks(major, lo, hi, minorN) : [],
    corner,
  }
}

const MINUS = '−'
const minusSign = (s: string) => (s.startsWith('-') ? MINUS + s.slice(1) : s)
const trimNumber = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6)))

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
export const superscriptText = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('')

// ------------------------------------------------------------------ mathtext

export interface Run {
  t: string
  /** 'sup' / 'sub' shifted runs, or plain. */
  s?: 'sup' | 'sub'
  italic?: boolean
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', circ: '°', degree: '°', cdot: '·', times: '×',
  pm: '±', AA: 'Å', approx: '≈', leq: '≤', geq: '≥', infty: '∞', partial: '∂', rightarrow: '→', to: '→', prime: '′', ell: 'ℓ',
  langle: '⟨', rangle: '⟩', mathrm: '', mathit: '', mathbf: '', rm: '', it: '', bf: '', ',': ' ', ';': ' ', '!': '', ' ': ' ', quad: '  ',
}

/** A matplotlib label as text runs: "$...$" parts are mathtext (^{…} up, _{…} down, \Greek). */
export function mathRuns(text: string): Run[] {
  const out: Run[] = []
  const push = (t: string, s?: 'sup' | 'sub', italic?: boolean) => {
    if (!t) return
    const last = out[out.length - 1]
    if (last && last.s === s && !!last.italic === !!italic) last.t += t
    else out.push(s ? { t, s, ...(italic ? { italic } : {}) } : italic ? { t, italic } : { t })
  }
  const parts = text.split('$')
  parts.forEach((part, i) => {
    if (i % 2 === 0) return push(part)
    let k = 0
    const group = (): string => {
      if (part[k] === '{') {
        let depth = 1
        let j = k + 1
        while (j < part.length && depth) {
          if (part[j] === '{') depth++
          else if (part[j] === '}') depth--
          j++
        }
        const inner = part.slice(k + 1, j - 1)
        k = j
        return plainMath(inner)
      }
      if (part[k] === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(part.slice(k))!
        k += m[0].length
        return GREEK[m[1]] ?? m[1]
      }
      return part[k++] ?? ''
    }
    while (k < part.length) {
      const c = part[k]
      if (c === '^' || c === '_') {
        k++
        push(group(), c === '^' ? 'sup' : 'sub')
      } else if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(part.slice(k))!
        k += m[0].length
        const name = m[1]
        if (name in GREEK && GREEK[name] === '' && part[k] === '{') {
          push(group())
        } else push(GREEK[name] ?? name)
      } else if (c === '{' || c === '}') k++
      else {
        push(c === '-' ? MINUS : c, undefined, /[A-Za-z]/.test(c))
        k++
      }
    }
  })
  return out
}

function plainMath(s: string): string {
  return s.replace(/\\([A-Za-z]+|.)/g, (_m, n: string) => GREEK[n] ?? n).replace(/[{}]/g, '').replace(/-/g, MINUS)
}

/** The plain text of a mathtext label (for widths, titles, exports). */
export const plainText = (text: string) => mathRuns(text).map((r) => r.t).join('')

// ------------------------------------------------------------------ legend

export interface LegendBox {
  x: number
  y: number
  w: number
  h: number
}

/** Where matplotlib puts a legend of w × h px inside the box (borderaxespad 0.5 em). */
export function legendPlace(loc: string, box: Box, w: number, h: number, fontPx: number): LegendBox {
  const pad = 0.5 * fontPx
  let l = loc === 'best' ? 'upper right' : loc
  if (l === 'right') l = 'center right'
  const x = l.includes('left') ? box.x0 + pad : l.includes('right') ? box.x1 - pad - w : (box.x0 + box.x1 - w) / 2
  const y = l.startsWith('upper') ? box.y0 + pad : l.startsWith('lower') ? box.y1 - pad - h : (box.y0 + box.y1 - h) / 2
  return { x, y, w, h }
}

// ------------------------------------------------------------------ figure helpers

/** The axes the user works on: the first one that is not a twin. */
export function mainAxes(fig: Fig | null): AxesJ | null {
  if (!fig) return null
  return fig.axes.find((a) => a.twinOf === undefined) ?? fig.axes[0] ?? null
}

/** Points → pixels (100 dpi, as wx's FigureCanvas). */
export const px = (pt: number) => pt * PT

/** matplotlib dash patterns (in units of the line width) for a linestyle. */
export function dashArray(ls: string | undefined, lw: number): string | undefined {
  const w = Math.max(lw, 0.5)
  if (ls === '--' || ls === 'dashed') return `${px(3.7 * w).toFixed(2)} ${px(1.6 * w).toFixed(2)}`
  if (ls === ':' || ls === 'dotted') return `${px(1 * w).toFixed(2)} ${px(1.65 * w).toFixed(2)}`
  if (ls === '-.' || ls === 'dashdot') return `${px(6.4 * w).toFixed(2)} ${px(1.6 * w).toFixed(2)} ${px(1 * w).toFixed(2)} ${px(1.6 * w).toFixed(2)}`
  return undefined
}

/** Default zorder of an artist kind (matplotlib: patches 1, collections 1, lines 2, texts 3). */
export function zOf(k: string, z?: number): number {
  if (typeof z === 'number') return z
  if (k === 'line' || k === 'axline') return 2
  if (k === 'text' || k === 'annotation') return 3
  return 1
}

/** The nearest of the red range lines to x (On_Mouse_Defs: the nearer line is the one dragged). */
export function nearestLine(x: number, lines: Record<string, number>): number | null {
  let best: number | null = null
  let d = Infinity
  for (const [k, v] of Object.entries(lines)) {
    const dd = Math.abs(v - x)
    if (dd < d) {
      d = dd
      best = Number(k)
    }
  }
  return best
}
