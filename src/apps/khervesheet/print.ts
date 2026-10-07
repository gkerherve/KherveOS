// File ▸ Print… / the Print button: the desktop opens its Print dialog
// (printing.py: the used range, gridlines, page setup). Here the used range
// (or the selection, if larger than one cell) goes to the browser's print
// dialog as a table with the cells' fonts, colours, alignment and borders,
// and the charts and pictures are left out.

import type { Book } from './book'
import { H_MASK, key, mergeAt, mergeRange, usedExtent, type Border } from './model'

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
const css = (b: Border | undefined) => (b ? `${Math.max(1, b.width)}px ${b.style === 2 ? 'dashed' : b.style === 3 ? 'dotted' : 'solid'} ${b.color}` : '')

export function printSheet(book: Book, gridlines = true) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const sel = g.r1 !== g.r2 || g.c1 !== g.c2
  const used = usedExtent(sh)
  if (!sel && used.rows < 0) return book.showFlash('There is nothing to print on this sheet.')
  const r1 = sel ? g.r1 : 0
  const c1 = sel ? g.c1 : 0
  const r2 = sel ? g.r2 : used.rows
  const c2 = sel ? g.c2 : used.cols
  const geo = book.geometry(sh)
  const rows: string[] = []
  for (let r = r1; r <= r2; r++) {
    if (!geo.rows.size(r)) continue
    const cells: string[] = []
    for (let c = c1; c <= c2; c++) {
      if (!geo.cols.size(c)) continue
      const m = mergeAt(sh.merges, r, c)
      let span = ''
      if (m) {
        const mr = mergeRange(m)
        if (mr.r1 !== r || mr.c1 !== c) continue
        span = ` rowspan="${mr.r2 - mr.r1 + 1}" colspan="${mr.c2 - mr.c1 + 1}"`
      }
      const k = key(r, c)
      const f = sh.formats.get(k)
      const cell = sh.cells.get(k)
      const st: string[] = [`width:${geo.cols.size(c)}px`, `height:${geo.rows.size(r)}px`]
      if (f?.bg) st.push(`background:${f.bg}`)
      if (f?.font_color) st.push(`color:${f.font_color}`)
      if (f?.bold) st.push('font-weight:bold')
      if (f?.italic) st.push('font-style:italic')
      if (f?.underline) st.push('text-decoration:underline')
      if (f?.font_family) st.push(`font-family:'${f.font_family}'`)
      st.push(`font-size:${f?.font_size ?? 9}pt`)
      const h = (f?.alignment ?? 0) & H_MASK
      const numeric = cell?.n !== null && cell?.n !== undefined
      st.push(`text-align:${h === 0x2 ? 'right' : h === 0x4 ? 'center' : h === 0x1 ? 'left' : numeric ? 'right' : 'left'}`)
      if (f?.wrap_text) st.push('white-space:pre-wrap')
      for (const [side, b] of [['top', f?.b_top], ['bottom', f?.b_bottom], ['left', f?.b_left], ['right', f?.b_right]] as const)
        if (b) st.push(`border-${side}:${css(b)}`)
      cells.push(`<td${span} style="${st.join(';')}">${esc(cell?.t ?? '')}</td>`)
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sh.name)}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;margin:12mm}
    table{border-collapse:collapse;table-layout:fixed}
    td{padding:0 3px;overflow:hidden;white-space:pre;vertical-align:middle;${gridlines ? 'border:1px solid #d0d7d2;' : ''}}
    @page{margin:12mm}
  </style></head><body><table>${rows.join('')}</table></body></html>`
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      setTimeout(() => frame.remove(), 60_000)
    }
  }
  document.body.appendChild(frame)
}
