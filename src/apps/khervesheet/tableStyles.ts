// Table Design: the desktop's built-in table styles (table_styles.py,
// Plain / Grid / List in 11 accent colours) and how they are applied to the
// selection (mainwindow._apply_table_style): header row, banded rows, borders.

import type { Book } from './book'
import type { Border, Fmt } from './model'
import { patchFmt } from './model'
import { formatCells } from './ops'

export interface TableStyle {
  name: string
  category: 'Plain' | 'Grid' | 'List'
  header_bg: string
  header_fg: string
  header_bold: boolean
  even_bg: string
  odd_bg: string
  text_fg: string
  border_color: string | null
  border_header_bottom: boolean
  border_outer: boolean
  border_inner: boolean
}

const ACCENTS: [string, string][] = [
  ['#404040', 'Black'],
  ['#4472c4', 'Blue'],
  ['#ed7d31', 'Orange'],
  ['#a5a5a5', 'Grey'],
  ['#ffc000', 'Gold'],
  ['#5b9bd5', 'Light Blue'],
  ['#70ad47', 'Green'],
  ['#e74c3c', 'Red'],
  ['#9b59b6', 'Purple'],
  ['#ff69b4', 'Pink'],
  ['#2ecc71', 'Bright Green'],
]

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const hex = (v: number[]) => '#' + v.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')
/** Toward white by factor (QColor maths, truncated like int()). */
const lighten = (h: string, f = 0.75) => hex(rgb(h).map((c) => Math.trunc(c + (255 - c) * f)))
const darken = (h: string, f = 0.3) => hex(rgb(h).map((c) => Math.trunc(c * (1 - f))))

function style(p: Partial<TableStyle> & Pick<TableStyle, 'name' | 'category' | 'header_bg'>): TableStyle {
  return {
    header_fg: '#ffffff', header_bold: true, even_bg: '#ffffff', odd_bg: '#f2f2f2', text_fg: '#000000', border_color: null,
    border_header_bottom: true, border_outer: false, border_inner: false, ...p,
  }
}

function build(): TableStyle[] {
  const out: TableStyle[] = []
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `Plain Light ${n}`, category: 'Plain', header_bg: '#ffffff', header_fg: a, odd_bg: lighten(a, 0.85), border_color: a }))
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `Plain Medium ${n}`, category: 'Plain', header_bg: a, odd_bg: lighten(a, 0.85), border_color: a, border_outer: true }))
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `Grid Light ${n}`, category: 'Grid', header_bg: a, odd_bg: lighten(a, 0.7), border_color: a, border_outer: true, border_inner: true }))
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `Grid Medium ${n}`, category: 'Grid', header_bg: a, even_bg: lighten(a, 0.75), odd_bg: lighten(a, 0.55), border_color: a, border_outer: true }))
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `Grid Dark ${n}`, category: 'Grid', header_bg: a, even_bg: lighten(a, 0.7), odd_bg: lighten(a, 0.4), border_color: a, border_outer: true, border_inner: true }))
  for (const [a, n] of ACCENTS) {
    const d = darken(a, 0.25)
    out.push(style({ name: `Grid Accent ${n}`, category: 'Grid', header_bg: d, even_bg: lighten(a, 0.2), odd_bg: lighten(a, 0.45), text_fg: '#ffffff', border_color: d, border_outer: true, border_inner: true }))
  }
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `List Light ${n}`, category: 'List', header_bg: '#ffffff', header_fg: a, odd_bg: lighten(a, 0.85), border_color: a }))
  for (const [a, n] of ACCENTS) out.push(style({ name: `List Medium ${n}`, category: 'List', header_bg: a, odd_bg: lighten(a, 0.75) }))
  for (const [a, n] of ACCENTS)
    out.push(style({ name: `List Dark ${n}`, category: 'List', header_bg: darken(a, 0.2), even_bg: lighten(a, 0.75), odd_bg: lighten(a, 0.55), border_header_bottom: false }))
  return out
}

export const TABLE_STYLES = build()

/** Format the (first) selected range with a table style. */
export function applyTableStyle(book: Book, st: TableStyle, useHeader: boolean, useBanding: boolean) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const { r1: r0, r2: rl, c1: c0, c2: cl } = g
  const b = (width = 1): Border => ({ style: 1, color: st.border_color ?? st.header_bg, width })
  void formatCells(
    book,
    (f: Fmt | undefined, r: number, c: number) => {
      const isHeader = r === r0 && useHeader
      const dataRow = r - r0 - (useHeader ? 1 : 0)
      const p: Partial<Fmt> = {
        bg: isHeader ? st.header_bg : useBanding && dataRow % 2 === 1 ? st.odd_bg : st.even_bg,
        font_color: isHeader ? st.header_fg : st.text_fg,
      }
      if (isHeader && st.header_bold) p.bold = true
      if (st.border_color) {
        if (st.border_outer) {
          if (r === r0) p.b_top = b()
          if (r === rl) p.b_bottom = b()
          if (c === c0) p.b_left = b()
          if (c === cl) p.b_right = b()
        }
        if (st.border_inner) {
          if (c < cl) p.b_right = b()
          if (r < rl) p.b_bottom = b()
        }
        if (isHeader && st.border_header_bottom) p.b_bottom = b(2)
        else if (!isHeader && r === r0 && st.border_header_bottom) p.b_top = b(2)
      }
      return patchFmt(f, p)
    },
    'Table Style',
    Array.from({ length: (rl - r0 + 1) * (cl - c0 + 1) }, (_, i) => ({ r: r0 + Math.floor(i / (cl - c0 + 1)), c: c0 + (i % (cl - c0 + 1)) })),
  )
}
