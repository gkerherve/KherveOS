// OpenDocument Text (.odt, LibreOffice / OpenOffice) → HTML for KherveWord's
// import: headings, paragraphs (alignment), character formatting from
// automatic and named styles, links, lists, tables (spanned cells), pictures,
// notes (kept as footnotes) and line breaks. Plain TypeScript: tested in Node.

import { unzipSync, strFromU8 } from 'fflate'
import { isEl, kid, kids, parseXml, textOf, type XmlElement } from '../docx/xml.ts'

interface TextProps {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  sup?: boolean
  sub?: boolean
  color?: string
  size?: string
  font?: string
  bg?: string
  align?: string
  parent?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function odtToHtml(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const content = files['content.xml']
  if (!content) throw new Error('This is not an OpenDocument text file (content.xml is missing).')
  const root = parseXml(strFromU8(content))
  const styles = new Map<string, TextProps>()
  const listKinds = new Map<string, 'ul' | 'ol'>()
  const readStyles = (container: XmlElement | undefined) => {
    for (const st of kids(container)) {
      if (st.name === 'style:style') {
        const tp = kid(st, 'style:text-properties')?.attrs ?? {}
        const pp = kid(st, 'style:paragraph-properties')?.attrs ?? {}
        const props: TextProps = { parent: st.attrs['style:parent-style-name'] }
        if (tp['fo:font-weight'] === 'bold' || Number(tp['fo:font-weight']) >= 600) props.b = true
        if (tp['fo:font-style'] === 'italic' || tp['fo:font-style'] === 'oblique') props.i = true
        const ul = tp['style:text-underline-style']
        if (ul && ul !== 'none') props.u = true
        const lt = tp['style:text-line-through-style']
        if (lt && lt !== 'none') props.s = true
        const pos = tp['style:text-position']
        if (pos) {
          if (/^super|^\d/.test(pos) && !pos.startsWith('0')) props.sup = true
          if (/^sub|^-/.test(pos)) props.sub = true
        }
        if (tp['fo:color']) props.color = tp['fo:color']
        if (tp['fo:font-size'] && !tp['fo:font-size'].endsWith('%')) props.size = tp['fo:font-size']
        if (tp['style:font-name']) props.font = tp['style:font-name']
        if (tp['fo:background-color'] && tp['fo:background-color'] !== 'transparent') props.bg = tp['fo:background-color']
        if (pp['fo:text-align']) props.align = pp['fo:text-align'] === 'end' ? 'right' : pp['fo:text-align'] === 'start' ? 'left' : pp['fo:text-align']
        styles.set(st.attrs['style:name'], props)
      } else if (st.name === 'text:list-style') {
        const first = kids(st)[0]
        listKinds.set(st.attrs['style:name'], first?.name === 'text:list-level-style-number' ? 'ol' : 'ul')
      }
    }
  }
  if (files['styles.xml']) {
    try {
      const sx = parseXml(strFromU8(files['styles.xml']))
      readStyles(kid(sx, 'office:styles'))
      readStyles(kid(sx, 'office:automatic-styles'))
    } catch {
      /* styles are optional */
    }
  }
  readStyles(kid(root, 'office:automatic-styles'))
  const resolve = (name: string | undefined): TextProps => {
    const out: TextProps = {}
    const chain: TextProps[] = []
    const seen = new Set<string>()
    let n = name
    while (n && !seen.has(n)) {
      seen.add(n)
      const s = styles.get(n)
      if (!s) break
      chain.unshift(s)
      n = s.parent
    }
    for (const s of chain) Object.assign(out, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)))
    return out
  }
  const wrapText = (html: string, p: TextProps): string => {
    if (!html) return html
    const css: string[] = []
    if (p.color) css.push(`color:${p.color}`)
    if (p.size) css.push(`font-size:${p.size}`)
    if (p.font) css.push(`font-family:'${p.font.replace(/'/g, '')}'`)
    if (p.bg) css.push(`background-color:${p.bg}`)
    let s = html
    if (p.sub) s = `<sub>${s}</sub>`
    if (p.sup) s = `<sup>${s}</sup>`
    if (p.s) s = `<s>${s}</s>`
    if (p.u) s = `<u>${s}</u>`
    if (p.i) s = `<i>${s}</i>`
    if (p.b) s = `<b>${s}</b>`
    if (css.length) s = `<span style="${css.join(';')}">${s}</span>`
    return s
  }
  const inline = (el: XmlElement): string => {
    let out = ''
    for (const c of el.children) {
      if (!isEl(c)) {
        out += esc(c.replace(/\s+/g, ' '))
        continue
      }
      switch (c.name) {
        case 'text:span':
          out += wrapText(inline(c), resolve(c.attrs['text:style-name']))
          break
        case 'text:a':
          out += `<a href="${esc(c.attrs['xlink:href'] ?? '')}">${inline(c)}</a>`
          break
        case 'text:s':
          out += ' '.repeat(Math.max(1, Number(c.attrs['text:c'] ?? 1)))
          break
        case 'text:tab':
          out += '\t'
          break
        case 'text:line-break':
          out += '<br>'
          break
        case 'text:note': {
          const body = kid(c, 'text:note-body')
          const t = kids(body)
            .map((p) => textOf(p))
            .join(' ')
            .trim()
          out += `<span data-type="footnote" data-text="${esc(t)}"></span>`
          break
        }
        case 'draw:frame': {
          const img = kid(c, 'draw:image')
          const href = img?.attrs['xlink:href']
          const data = href ? files[href] : undefined
          if (data) {
            const ext = href!.split('.').pop()!.toLowerCase()
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
            const w = c.attrs['svg:width']
            const px = w ? cssPx(w) : undefined
            out += `<img src="data:${mime};base64,${toBase64(data)}"${px ? ` width="${Math.round(px)}"` : ''}>`
          }
          break
        }
        case 'text:soft-page-break':
        case 'text:bookmark':
        case 'text:bookmark-start':
        case 'text:bookmark-end':
        case 'office:annotation':
          break
        default:
          out += inline(c)
      }
    }
    return out
  }
  const blocks = (el: XmlElement): string => {
    let out = ''
    for (const c of kids(el)) {
      switch (c.name) {
        case 'text:h': {
          const level = Math.min(6, Math.max(1, Number(c.attrs['text:outline-level'] ?? 1)))
          out += `<h${level}>${inline(c)}</h${level}>`
          break
        }
        case 'text:p': {
          const p = resolve(c.attrs['text:style-name'])
          const name = (c.attrs['text:style-name'] ?? '').toLowerCase()
          const body = wrapText(inline(c), { ...p, align: undefined })
          if (name === 'title') out += `<h1 data-style="Title">${body}</h1>`
          else out += `<p${p.align && p.align !== 'left' ? ` style="text-align:${p.align}"` : ''}>${body}</p>`
          break
        }
        case 'text:list': {
          const kind = listKinds.get(c.attrs['text:style-name'] ?? '') ?? 'ul'
          out += `<${kind}>${kids(c, 'text:list-item').map((li) => `<li>${blocks(li)}</li>`).join('')}</${kind}>`
          break
        }
        case 'table:table': {
          const rows: XmlElement[] = []
          const collect = (t: XmlElement) => {
            for (const r of kids(t)) {
              if (r.name === 'table:table-row') rows.push(r)
              else if (r.name === 'table:table-header-rows' || r.name === 'table:table-rows') collect(r)
            }
          }
          collect(c)
          out += `<table>${rows
            .map(
              (r) =>
                `<tr>${kids(r, 'table:table-cell')
                  .map((cell) => {
                    const span = Number(cell.attrs['table:number-columns-spanned'] ?? 1)
                    const rs = Number(cell.attrs['table:number-rows-spanned'] ?? 1)
                    return `<td${span > 1 ? ` colspan="${span}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${blocks(cell) || '<p></p>'}</td>`
                  })
                  .join('')}</tr>`,
            )
            .join('')}</table>`
          break
        }
        case 'text:section':
        case 'text:index-body':
          out += blocks(c)
          break
        case 'text:table-of-content':
          out += '<div data-type="toc"></div>'
          break
        default:
          break
      }
    }
    return out
  }
  const text = kid(kid(root, 'office:body'), 'office:text')
  return text ? blocks(text) : ''
}

function cssPx(v: string): number | undefined {
  const m = /^([\d.]+)(cm|mm|in|pt|px)?$/.exec(v)
  if (!m) return undefined
  const n = Number(m[1])
  const u = m[2] ?? 'px'
  return u === 'cm' ? (n * 96) / 2.54 : u === 'mm' ? (n * 96) / 25.4 : u === 'in' ? n * 96 : u === 'pt' ? (n * 96) / 72 : n
}
