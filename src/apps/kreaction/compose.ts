// One picture of a whole equation: structures (or formulas when there is no structure) with coefficients,
// "+" signs, the arrow and the conditions above and below it. Pure string building, used for the PNG / SVG
// export, the notebook and the report.

import { svgSize } from './svgtheme.ts'

export interface PicSpecies {
  /** SVG of the structure, or null to write the label instead. */
  svg: string | null
  label: string
  coeff: number
}

export interface EquationPicture {
  reactants: PicSpecies[]
  products: PicSpecies[]
  arrow: string
  above: string
  below: string
  /** Text colour: "currentColor" for the screen, "#000" for files. */
  ink?: string
  /** White background (for files). */
  background?: boolean
  height?: number
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function equationSvg(p: EquationPicture): string {
  const H = p.height ?? 140
  const ink = p.ink ?? '#000000'
  const parts: string[] = []
  let x = 10
  const text = (s: string, size: number, anchor: 'start' | 'middle', px: number, py: number, weight = 'normal') =>
    `<text x='${px}' y='${py}' font-size='${size}' text-anchor='${anchor}' font-family='sans-serif' font-weight='${weight}' fill='${ink}'>${esc(s)}</text>`
  const species = (list: PicSpecies[]) => {
    list.forEach((s, i) => {
      if (i > 0) {
        parts.push(text('+', 26, 'middle', x + 14, H / 2 + 9))
        x += 28
      }
      if (s.coeff !== 1) {
        parts.push(text(String(s.coeff), 22, 'start', x, H / 2 + 8, 'bold'))
        x += 14 + 12 * String(s.coeff).length
      }
      if (s.svg) {
        const { w, h } = svgSize(s.svg)
        const scale = Math.min(1, H / h)
        const W = Math.round(w * scale)
        const Hh = Math.round(h * scale)
        const inner = s.svg.replace(/<svg([^>]*?)\s(?:width|height)='[^']*'/g, '<svg$1').replace(/<svg([^>]*?)\s(?:width|height)='[^']*'/g, '<svg$1')
        parts.push(inner.replace(/<svg/, `<svg x='${x}' y='${Math.round((H - Hh) / 2)}' width='${W}' height='${Hh}'`))
        x += W
      } else {
        const wText = Math.max(40, s.label.length * 13)
        parts.push(text(s.label, 22, 'middle', x + wText / 2, H / 2 + 8))
        x += wText
      }
    })
  }
  species(p.reactants)
  const arrowW = Math.max(90, 8 * Math.max(p.above.length, p.below.length) + 20)
  x += 14
  const y = H / 2
  parts.push(`<line x1='${x}' y1='${y}' x2='${x + arrowW}' y2='${y}' stroke='${ink}' stroke-width='2'/>`)
  parts.push(`<path d='M ${x + arrowW - 10} ${y - 6} L ${x + arrowW} ${y} L ${x + arrowW - 10} ${y + 6}' fill='none' stroke='${ink}' stroke-width='2'/>`)
  if (p.arrow === '⇌') parts.push(`<path d='M ${x + 10} ${y + 10} L ${x} ${y + 10} M ${x + 10} ${y + 4} L ${x} ${y + 10}' fill='none' stroke='${ink}' stroke-width='2'/>`)
  if (p.above) parts.push(text(p.above, 12, 'middle', x + arrowW / 2, y - 10))
  if (p.below) parts.push(text(p.below, 12, 'middle', x + arrowW / 2, y + 22))
  x += arrowW + 14
  species(p.products)
  const W = x + 10
  const bg = p.background ? `<rect width='${W}' height='${H}' fill='#FFFFFF'/>` : ''
  return `<svg xmlns='http://www.w3.org/2000/svg' version='1.1' width='${W}px' height='${H}px' viewBox='0 0 ${W} ${H}'>${bg}${parts.join('')}</svg>`
}
