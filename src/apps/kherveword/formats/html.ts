// KherveWord document → HTML: the CSS of the paragraph styles (used by the
// editor too), a stand-alone .html export, and the XHTML that MuPDF lays out
// into a PDF (export_pdf without a print dialog). Plain TypeScript: tested in Node.

import {
  contentWidth, expandTokens, fontStack, hfIsEmpty, isMono, isSerif, normColor, pageDims, resolveStyle,
  type DocSettings, type HeaderFooter, type PMMark, type PMNode, type StyleDef, type WordDoc,
} from '../model.ts'

/** Word's single line is about 1.17 × the font size (keep in step with editor/extensions.ts). */
const LINE = 1.17

function styleRule(s: StyleDef, pdf: boolean): string {
  const css: string[] = []
  if (s.font) css.push(`font-family:${pdf ? pdfFont(s.font) : fontStack(s.font)}`)
  if (s.size) css.push(`font-size:${s.size}pt`)
  css.push(`font-weight:${s.bold ? 'bold' : 'normal'}`)
  css.push(`font-style:${s.italic ? 'italic' : 'normal'}`)
  if (s.underline) css.push('text-decoration:underline')
  if (s.allCaps) css.push('text-transform:uppercase')
  css.push(`color:${normColor(s.color) ?? '#000000'}`)
  css.push(`text-align:${s.align ?? 'left'}`)
  css.push(`padding-top:${s.spaceBefore ?? 0}pt`)
  css.push(`padding-bottom:${s.spaceAfter ?? 0}pt`)
  css.push(`line-height:${((s.lineHeight ?? 1) * LINE).toFixed(3)}`)
  css.push(`margin-left:${s.indentLeft ?? 0}pt`)
  css.push(`margin-right:${s.indentRight ?? 0}pt`)
  css.push(`text-indent:${s.indentFirst ?? 0}pt`)
  if (s.borderBottom) css.push('border-bottom:0.75pt solid #4472c4')
  if (s.shading) css.push(`background-color:${s.shading}`)
  return css.join(';')
}

/** CSS for every paragraph style, inside `scope` (e.g. ".kw-doc"). */
export function stylesCss(styles: Record<string, StyleDef>, scope: string, pdf = false): string {
  let out = `${scope} .kw-p{${styleRule(resolveStyle(styles, 'Normal'), pdf)}}\n`
  for (const id of Object.keys(styles)) {
    const cls = id.replace(/[^A-Za-z0-9_-]/g, '')
    out += `${scope} .kw-s-${cls}{${styleRule(resolveStyle(styles, id), pdf)}}\n`
  }
  return out
}

function pdfFont(font: string): string {
  return isMono(font) ? 'monospace' : isSerif(font) ? 'serif' : 'sans-serif'
}

// ------------------------------------------------------------------ document → HTML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const HEAD_TAG: Record<string, string> = { Title: 'h1', Heading1: 'h1', Heading2: 'h2', Heading3: 'h3', Heading4: 'h4', Heading5: 'h5', Heading6: 'h6' }

export interface HtmlOptions {
  /** 'web': a stand-alone page; 'pdf': simple XHTML for MuPDF. */
  mode: 'web' | 'pdf'
  /** Equations as HTML (KaTeX in the browser); default: the LaTeX in italics. */
  math?: (latex: string, display: boolean) => string
  /** Headings with their pages, for the table of contents. */
  toc?: { text: string; level: number; page?: number }[]
}

interface Ctx {
  opts: HtmlOptions
  notes: string[]
  settings: DocSettings
}

function markWrap(html: string, marks: PMMark[] | undefined, ctx: Ctx): string {
  let s = html
  const style: string[] = []
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        s = `<b>${s}</b>`
        break
      case 'italic':
        s = `<i>${s}</i>`
        break
      case 'underline':
        s = `<u>${s}</u>`
        break
      case 'strike':
        s = `<s>${s}</s>`
        break
      case 'subscript':
        s = `<sub>${s}</sub>`
        break
      case 'superscript':
        s = `<sup>${s}</sup>`
        break
      case 'textStyle': {
        const a = m.attrs ?? {}
        if (a.fontFamily) style.push(`font-family:${ctx.opts.mode === 'pdf' ? pdfFont(String(a.fontFamily)) : fontStack(String(a.fontFamily))}`)
        if (a.fontSize) style.push(`font-size:${a.fontSize}`)
        if (a.color) style.push(`color:${a.color}`)
        break
      }
      case 'highlight':
        style.push(`background-color:${m.attrs?.color ?? '#ffff00'}`)
        break
      case 'link':
        s = `<a href="${esc(String(m.attrs?.href ?? ''))}">${s}</a>`
        break
      case 'insertion':
        s = `<ins>${s}</ins>`
        break
      default:
        break
    }
  }
  return style.length ? `<span style="${style.join(';')}">${s}</span>` : s
}

function inline(nodes: PMNode[] | undefined, ctx: Ctx): string {
  let out = ''
  for (const n of nodes ?? []) {
    if (n.marks?.some((m) => m.type === 'deletion')) continue
    switch (n.type) {
      case 'text':
        out += markWrap(esc(n.text ?? '').replace(/\t/g, ctx.opts.mode === 'pdf' ? ' ' : '<span class="kw-tab">\t</span>'), n.marks, ctx)
        break
      case 'hardBreak':
        out += '<br/>'
        break
      case 'image': {
        const a = n.attrs ?? {}
        const float = a.wrap === 'left' || a.wrap === 'right' ? ` style="float:${a.wrap};margin:2pt 9pt"` : ''
        out += `<img src="${esc(String(a.src ?? ''))}" alt="${esc(String(a.alt ?? ''))}"${a.width ? ` width="${Math.round(Number(a.width))}"` : ''}${a.height ? ` height="${Math.round(Number(a.height))}"` : ''}${float}/>`
        break
      }
      case 'footnote':
        ctx.notes.push(String(n.attrs?.text ?? ''))
        out += `<sup class="kw-fnref">${ctx.notes.length}</sup>`
        break
      case 'equation': {
        const latex = String(n.attrs?.latex ?? '')
        out += ctx.opts.math ? ctx.opts.math(latex, false) : `<i>${esc(latex)}</i>`
        break
      }
      default:
        break
    }
  }
  return out
}

function paraStyle(a: Record<string, unknown>): string {
  const css: string[] = []
  if (a.align) css.push(`text-align:${a.align}`)
  if (typeof a.indentLeft === 'number') css.push(`margin-left:${a.indentLeft}pt`)
  if (typeof a.indentRight === 'number') css.push(`margin-right:${a.indentRight}pt`)
  if (typeof a.indentFirst === 'number') css.push(`text-indent:${a.indentFirst}pt`)
  if (typeof a.spaceBefore === 'number') css.push(`padding-top:${a.spaceBefore}pt`)
  if (typeof a.spaceAfter === 'number') css.push(`padding-bottom:${a.spaceAfter}pt`)
  if (typeof a.lineHeight === 'number') css.push(`line-height:${(a.lineHeight * LINE).toFixed(3)}`)
  if (a.shading) css.push(`background-color:${a.shading}`)
  if (a.border === 'box') css.push('border:0.75pt solid #000')
  if (a.border === 'top' || a.border === 'topBottom') css.push('border-top:0.75pt solid #000')
  if (a.border === 'bottom' || a.border === 'topBottom') css.push('border-bottom:0.75pt solid #000')
  return css.length ? ` style="${css.join(';')}"` : ''
}

function blocks(nodes: PMNode[] | undefined, ctx: Ctx): string {
  let out = ''
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': {
        const style = String(n.attrs?.style ?? 'Normal')
        const tag = HEAD_TAG[style] ?? 'p'
        const body = inline(n.content, ctx)
        out += `<${tag} class="kw-p kw-s-${style.replace(/[^A-Za-z0-9_-]/g, '')}"${paraStyle(n.attrs ?? {})}>${body || (ctx.opts.mode === 'pdf' ? '&#160;' : '<br/>')}</${tag}>\n`
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const tag = n.type === 'bulletList' ? 'ul' : 'ol'
        const ls = String(n.attrs?.listStyle ?? '')
        const type = ls && ls !== 'outline' ? ` style="list-style-type:${ls === 'dash' ? "'– '" : ls}"` : ''
        const start = n.type === 'orderedList' && Number(n.attrs?.start ?? 1) !== 1 ? ` start="${Number(n.attrs?.start)}"` : ''
        out += `<${tag}${type}${start}>${(n.content ?? []).map((li) => `<li>${blocks(li.content, ctx)}</li>`).join('')}</${tag}>\n`
        break
      }
      case 'table': {
        const borders = String(n.attrs?.borders ?? 'all')
        out += `<table class="kw-table" data-borders="${borders}">${(n.content ?? [])
          .map(
            (r) =>
              `<tr>${(r.content ?? [])
                .map((c) => {
                  const a = c.attrs ?? {}
                  const tag = c.type === 'tableHeader' ? 'th' : 'td'
                  const span = `${Number(a.colspan ?? 1) > 1 ? ` colspan="${a.colspan}"` : ''}${Number(a.rowspan ?? 1) > 1 ? ` rowspan="${a.rowspan}"` : ''}`
                  const w = Array.isArray(a.colwidth) ? (a.colwidth as number[]).reduce((s, x) => s + (x || 0), 0) : 0
                  const css = [a.background ? `background-color:${a.background}` : '', a.valign ? `vertical-align:${a.valign}` : '', w ? `width:${w}px` : ''].filter(Boolean).join(';')
                  return `<${tag}${span}${css ? ` style="${css}"` : ''}>${blocks(c.content, ctx)}</${tag}>`
                })
                .join('')}</tr>`,
          )
          .join('')}</table>\n`
        break
      }
      case 'pageBreak':
        out += '<div class="kw-break"></div>\n'
        break
      case 'horizontalRule':
        out += '<hr/>\n'
        break
      case 'equationBlock': {
        const latex = String(n.attrs?.latex ?? '')
        out += `<div class="kw-eq-block">${ctx.opts.math ? ctx.opts.math(latex, true) : `<i>${esc(latex)}</i>`}</div>\n`
        break
      }
      case 'toc': {
        const items = (ctx.opts.toc ?? []).filter((h) => h.level <= 3)
        out += `<div class="kw-toc"><p class="kw-toc-title">Contents</p>${items
          .map((h) => `<p class="kw-toc-${h.level}">${esc(h.text)}${h.page ? `<span class="kw-toc-page"> ${h.page}</span>` : ''}</p>`)
          .join('')}</div>\n`
        break
      }
      default:
        if (n.content) out += blocks(n.content, ctx)
    }
  }
  return out
}

function hfLine(h: HeaderFooter, title: string): string {
  return [h.left, h.center, h.right].map((x) => esc(expandTokens(x, 1, 1, title))).join(' &#160; ')
}

/** A stand-alone HTML page (or MuPDF XHTML) for the document. */
export function docToHtml(wd: WordDoc, opts: HtmlOptions): string {
  const ctx: Ctx = { opts, notes: [], settings: wd.settings }
  const body = blocks(wd.doc.content, ctx)
  const s = wd.settings
  const { w, h } = pageDims(s.page)
  const m = s.page.margins
  const pdf = opts.mode === 'pdf'
  const notes = ctx.notes.length
    ? `<div class="kw-notes"><hr/>${ctx.notes.map((t, i) => `<p class="kw-note"><sup>${i + 1}</sup> ${esc(t)}</p>`).join('')}</div>`
    : ''
  const css =
    `@page{size:${w}pt ${h}pt;margin:${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt}` +
    `body{margin:${pdf ? 0 : '2em auto'};${pdf ? '' : `max-width:${contentWidth(s.page)}pt;`}background:#fff;color:#000}` +
    `ul,ol{margin:0;padding-left:18pt}li>p{margin-left:0}` +
    `table.kw-table{border-collapse:collapse;margin:0}table.kw-table td,table.kw-table th{padding:2pt 5pt;vertical-align:top;text-align:left}` +
    `table[data-borders="all"] td,table[data-borders="all"] th{border:0.75pt solid #000}` +
    `table[data-borders="outer"]{border:0.75pt solid #000}` +
    `table[data-borders="horizontal"] td,table[data-borders="horizontal"] th{border-top:0.75pt solid #000;border-bottom:0.75pt solid #000}` +
    `th{font-weight:bold}.kw-break{page-break-before:always;break-before:page;height:0}` +
    `.kw-eq-block{text-align:center;padding:4pt 0}.kw-toc-title{font-size:16pt;color:#2f5496}.kw-toc-2{margin-left:11pt}.kw-toc-3{margin-left:22pt}` +
    `.kw-notes{font-size:9pt}.kw-note{margin:0}hr{border:0;border-top:0.75pt solid #000}a{color:#0563c1}ins{color:#1d6b2f}` +
    `.kw-header,.kw-footer{font-size:9pt;color:#555}` +
    stylesCss(s.styles, 'body', pdf)
  const header = !pdf && !hfIsEmpty(s.header) ? `<div class="kw-header">${hfLine(s.header, s.title)}</div>` : ''
  const footer = !pdf && !hfIsEmpty(s.footer) ? `<div class="kw-footer">${hfLine(s.footer, s.title)}</div>` : ''
  const title = esc(s.title || 'Document')
  if (pdf) return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><style>${css}</style></head><body>${body}${notes}</body></html>`
  return `<!DOCTYPE html>\n<html lang="${esc(s.lang || 'en')}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title><meta name="generator" content="KherveWord"/><style>${css}</style></head><body>${header}${body}${notes}${footer}</body></html>\n`
}
