// File ▸ Import .md / .docx / .pdf and File ▸ Export .docx, after the desktop's
// importers.py and docx_exporter.py.
//
// Markdown is a line-by-line port of import_md. Word and PDF are lighter than
// the desktop's (which lean on python-docx and PyMuPDF's font flags): headings,
// paragraphs with bold/italic/underline, lists, tables and pictures from Word;
// headings, the abstract and paragraphs from a PDF's text.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { PdfDocument } from '@/os/services/pdf'
import {
  DEFAULT_PACKAGES, defaultMeta, plainText, type Block, type Document, type Inline, type ListItem, type Mark, type Text,
} from './model'

const T = (text: string, marks: Mark[] = []): Text => ({ type: 'Text', text, marks })

// ------------------------------------------------------------------ Markdown

const MD_YAML_FENCE = /^---\s*\n([\s\S]*?)\n---\s*\n/
const MD_HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/
const MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/

const INLINE_PATTERNS: [string, RegExp][] = [
  ['display_math', /\$\$([\s\S]*?)\$\$/g],
  ['cite', /\[(@[\w:.-]+(?:;\s*@[\w:.-]+)*)\]/g],
  ['inline_math', /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g],
  ['image', /!\[([^\]]*)\]\(([^)]+)\)/g],
  ['link', /\[([^\]]+)\]\(([^)]+)\)/g],
  ['code', /`([^`]+)`/g],
  ['bold_s', /\*\*(.+?)\*\*/g],
  ['bold_u', /__(.+?)__/g],
  ['italic_s', /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g],
  ['italic_u', /(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g],
]

/** _md_parse_inlines */
export function mdInlines(text: string): Inline[] {
  const parts: Inline[] = []
  let pos = 0
  while (pos < text.length) {
    let best: RegExpExecArray | null = null
    let kind = ''
    for (const [k, re] of INLINE_PATTERNS) {
      re.lastIndex = pos
      const m = re.exec(text)
      if (m && (best === null || m.index < best.index)) {
        best = m
        kind = k
      }
    }
    if (!best) {
      if (text.slice(pos)) parts.push(T(text.slice(pos)))
      break
    }
    if (best.index > pos) parts.push(T(text.slice(pos, best.index)))
    if (kind === 'display_math' || kind === 'inline_math') parts.push({ type: 'MathInline', latex: best[1].trim() })
    else if (kind === 'cite') parts.push({ type: 'Citation', keys: best[1].split(';').map((k) => k.trim().replace(/^@+/, '')), style: 'cite' })
    else if (kind === 'image') parts.push(T(best[0]))
    else if (kind === 'link') parts.push({ type: 'Link', url: best[2], children: [T(best[1])] })
    else if (kind === 'code') parts.push(T(best[1], ['code']))
    else if (kind === 'bold_s' || kind === 'bold_u') parts.push(T(best[1], ['bold']))
    else parts.push(T(best[1], ['italic']))
    pos = best.index + best[0].length
  }
  return parts.length ? parts : [T('')]
}

const LST_SETUP =
  '\\definecolor{codegray}{rgb}{0.5,0.5,0.5}\n\\definecolor{codegreen}{rgb}{0,0.5,0}\n\\definecolor{codepurple}{rgb}{0.58,0,0.82}\n' +
  '\\definecolor{backcolour}{rgb}{0.97,0.97,0.97}\n\\lstset{\n  backgroundcolor=\\color{backcolour},\n  commentstyle=\\color{codegreen},\n' +
  '  keywordstyle=\\color{blue},\n  stringstyle=\\color{codepurple},\n  numberstyle=\\tiny\\color{codegray},\n  basicstyle=\\ttfamily\\small,\n' +
  '  breaklines=true,\n  frame=single,\n  numbers=left,\n  numbersep=5pt,\n  tabsize=4,\n  captionpos=t,\n  showstringspaces=false,\n}'

/** import_md */
export function importMarkdown(source: string): Document {
  const yaml: Record<string, string> = {}
  let body = source
  const y = MD_YAML_FENCE.exec(source)
  if (y) {
    for (let line of y[1].split(/\r?\n/)) {
      line = line.trim()
      if (!line || line.startsWith('#') || line.startsWith('-') || !line.includes(':')) continue
      const k = line.slice(0, line.indexOf(':')).trim()
      yaml[k] = line.slice(line.indexOf(':') + 1).trim().replace(/^['"]+|['"]+$/g, '')
    }
    body = source.slice(y[0].length)
  }
  const title = yaml.title ?? ''
  const author = yaml.author ?? yaml.authors ?? ''
  const bib = yaml.bibliography ?? ''
  const packages = [...DEFAULT_PACKAGES]
  if (bib) packages.push('natbib')
  const preamble: string[] = []
  if (bib) preamble.push(`\\bibliographystyle{plainnat}\n\\bibliography{${bib.replace('.bib', '')}}`)
  const children: Block[] = []
  if (title) children.push({ type: 'Title', children: [T(title)] })
  if (author) children.push({ type: 'Author', children: [T(author)] })
  let hasCode = false
  const lines = body.split('\n')
  const isBullet = (l: string) => /^[-*+]\s/.test(l)
  const isNum = (l: string) => /^\d+\.\s/.test(l)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++])
      i += 1
      hasCode = true
      const lang = fence[1]
      let caption = ''
      const prev = children.at(-1)
      if (prev && prev.type === 'Paragraph') {
        const prevText = prev.children.filter((n): n is Text => n.type === 'Text').map((n) => n.text).join('').trim()
        if (prevText.endsWith(':')) {
          caption = prevText.replace(/:+$/, '').trim()
          for (const sep of ['. ', '; ', '— ']) if (caption.includes(sep)) caption = caption.slice(caption.lastIndexOf(sep) + sep.length).trim()
        }
      }
      if (!caption) caption = lang ? lang[0].toUpperCase() + lang.slice(1).toLowerCase() : 'Code'
      caption = caption.replace(/_/g, '\\_')
      const opts = [`caption={${caption}}`]
      if (lang) opts.push(`language=${lang}`)
      children.push({ type: 'RawLatex', text: `\\begin{lstlisting}[${opts.join(', ')}]\n${code.join('\n')}\n\\end{lstlisting}` })
      continue
    }
    const stripped = line.trim()
    if (stripped.startsWith('$$')) {
      if (stripped.endsWith('$$') && stripped.length > 4) {
        children.push({ type: 'MathBlock', latex: stripped.slice(2, -2).trim(), numbered: false, label: null })
        i += 1
        continue
      }
      const math = [stripped.slice(2)]
      i += 1
      while (i < lines.length) {
        const ml = lines[i]
        if (ml.trim().endsWith('$$')) {
          math.push(ml.trim().slice(0, -2))
          i += 1
          break
        }
        math.push(ml)
        i += 1
      }
      children.push({ type: 'MathBlock', latex: math.join('\n').trim(), numbered: false, label: null })
      continue
    }
    const h = MD_HEADING.exec(line)
    if (h) {
      children.push({ type: 'Section', level: Math.min(h[1].length, 5), children: mdInlines(h[2].trim()), numbered: true, label: null })
      i += 1
      continue
    }
    const img = MD_IMAGE.exec(line.trim())
    if (img && img.index === 0) {
      children.push({ type: 'Figure', path: img[2], caption: img[1], label: null, width: '0.8\\textwidth', source: '' })
      i += 1
      continue
    }
    if (isBullet(line) || isNum(line)) {
      const ordered = isNum(line)
      const items: ListItem[] = []
      while (i < lines.length) {
        const m = ordered ? /^\d+\.\s+(.*)/.exec(lines[i]) : /^[-*+]\s+(.*)/.exec(lines[i])
        if (!m) {
          if (ordered && !lines[i].trim()) {
            let j = i + 1
            while (j < lines.length && !lines[j].trim()) j++
            if (j < lines.length && isNum(lines[j])) {
              i = j
              continue
            }
          }
          break
        }
        const itemLines = [m[1]]
        i += 1
        while (i < lines.length && lines[i].trim() && !(ordered ? isNum(lines[i]) : isBullet(lines[i]))) itemLines.push(lines[i++].trim())
        items.push({ type: 'ListItem', children: mdInlines(itemLines.join(' ')) })
      }
      children.push({ type: 'List', ordered, items })
      continue
    }
    if (line.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''))
      children.push({ type: 'Paragraph', children: [T(q.join(' '), ['italic'])], alignment: 'justify' })
      continue
    }
    if (!line.trim()) {
      i += 1
      continue
    }
    const para = [line]
    i += 1
    while (i < lines.length) {
      const nxt = lines[i]
      if (!nxt.trim() || MD_HEADING.test(nxt) || /^```/.test(nxt) || isBullet(nxt) || isNum(nxt) || nxt.startsWith('>') || nxt.trim().startsWith('$$')) break
      para.push(nxt)
      i += 1
    }
    children.push({ type: 'Paragraph', children: mdInlines(para.join(' ')), alignment: 'justify' })
  }
  if (hasCode) {
    for (const p of ['listings', 'xcolor']) if (!packages.includes(p)) packages.push(p)
    preamble.unshift(LST_SETUP)
  }
  return { type: 'Document', children, meta: defaultMeta({ title, author, documentclass: 'article', packages, preamble_extras: preamble.join('\n') }) }
}

// ---------------------------------------------------------------------- PDF

const PDF_BOILERPLATE = new RegExp(
  '(Contents\\s+lists\\s+available\\s+at|journal\\s+homepage\\s*:|View\\s+Article\\s+Online|View\\s+Journal|Open\\s+Access\\s+Article' +
    '|This\\s+article\\s+is\\s+licensed\\s+under|Cite\\s+this\\s*:|Published\\s+on\\s+\\d|Received\\s+\\d.*Accepted\\s+\\d' +
    '|Available\\s+online\\s+\\d|DOI\\s*:\\s*10\\.\\d|https?://doi\\.org/|www\\.elsevier\\.com|All\\s+rights\\s+reserved|CrossMark|ScienceDirect' +
    '|E-mail\\s+address(es)?\\s*:|Corresponding\\s+author|^\\s*(PAPER|COMMUNICATION|REVIEW|ARTICLE|LETTER)\\s*$)',
  'i',
)
const PDF_SECTION = /^(\d+)\.?(\d+\.?)?\s+[A-Z][^.]{0,80}$/
const PDF_ABSTRACT = /^(abstract|a\s+b\s+s\s+t\s+r\s+a\s+c\s+t)\b[:.]?\s*/i
const PDF_KEYWORDS = /^keywords?\s*:/i

/** A PDF's text as a document: lines → paragraphs, numbered headings, abstract, keywords. */
export async function importPdf(pdf: PdfDocument, onProgress?: (page: number, total: number) => void): Promise<Document> {
  const children: Block[] = []
  let para: string[] = []
  const flush = () => {
    const t = para.join(' ').replace(/(\w)- (\w)/g, '$1$2').replace(/\s+/g, ' ').trim()
    if (t) children.push({ type: 'Paragraph', children: [T(t)], alignment: 'justify' })
    para = []
  }
  let titleDone = false
  for (let p = 0; p < pdf.pageCount; p++) {
    onProgress?.(p + 1, pdf.pageCount)
    const info = pdf.pages[p]
    const words = await pdf.pageWords(p)
    const lines = new Map<number, { text: string[]; top: number; bottom: number; left: number; h: number }>()
    for (const w of words) {
      const l = lines.get(w.line) ?? { text: [], top: w.rect[1], bottom: w.rect[3], left: w.rect[0], h: 0 }
      l.text.push(w.text)
      l.top = Math.min(l.top, w.rect[1])
      l.bottom = Math.max(l.bottom, w.rect[3])
      l.left = Math.min(l.left, w.rect[0])
      l.h = Math.max(l.h, w.rect[3] - w.rect[1])
      lines.set(w.line, l)
    }
    const sorted = [...lines.values()].sort((a, b) => a.top - b.top)
    const heights = sorted.map((l) => l.h).sort((a, b) => a - b)
    const bodyH = heights[Math.floor(heights.length / 2)] || 10
    let prevBottom = -Infinity
    for (const l of sorted) {
      if (l.top < info.height * 0.06 || l.bottom > info.height * 0.94) continue
      const text = l.text.join(' ').trim()
      if (!text || PDF_BOILERPLATE.test(text)) continue
      const gap = l.top - prevBottom
      prevBottom = l.bottom
      if (!titleDone && p === 0 && l.h > bodyH * 1.5) {
        flush()
        const last = children.at(-1)
        if (last && last.type === 'Title') last.children.push(T(` ${text}`))
        else children.push({ type: 'Title', children: [T(text)] })
        continue
      }
      if (children.length) titleDone = true
      if (PDF_SECTION.test(text) && text.length < 90) {
        flush()
        const m = PDF_SECTION.exec(text)!
        children.push({ type: 'Section', level: m[2] ? 2 : 1, children: [T(text.replace(/^\d+(\.\d+)*\.?\s+/, ''))], numbered: true, label: null })
        continue
      }
      if (PDF_ABSTRACT.test(text) && text.length < 20) {
        flush()
        continue
      }
      if (PDF_KEYWORDS.test(text)) {
        flush()
        children.push({ type: 'Keywords', children: [T(text.replace(PDF_KEYWORDS, '').trim())] })
        continue
      }
      if (gap > bodyH * 0.9) flush()
      para.push(text)
    }
    flush()
  }
  // The first paragraph after the title block, when it was labelled "Abstract", stays a paragraph: the user decides.
  return { type: 'Document', children, meta: defaultMeta() }
}

// --------------------------------------------------------------------- Word

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function wAttr(el: Element, name: string): string | null {
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`)
}
function child(el: Element, name: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === name) return c
  return null
}
function onOff(el: Element | null): boolean {
  if (!el) return false
  const v = wAttr(el, 'val')
  return v === null || !['0', 'false', 'none'].includes(v)
}

/** A .docx as a document: headings by style, runs with their marks, lists, tables, pictures. */
export function importDocx(bytes: Uint8Array): { doc: Document; pictures: { name: string; bytes: Uint8Array }[] } {
  const zip = unzipSync(bytes)
  const xml = zip['word/document.xml']
  if (!xml) throw new Error('This is not a Word document (no word/document.xml).')
  const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
  const doc = parse(strFromU8(xml))
  const rels = new Map<string, string>()
  const relXml = zip['word/_rels/document.xml.rels']
  if (relXml) for (const r of Array.from(parse(strFromU8(relXml)).getElementsByTagName('Relationship'))) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')
  const styleNames = new Map<string, string>()
  const stylesXml = zip['word/styles.xml']
  if (stylesXml) {
    for (const s of Array.from(parse(strFromU8(stylesXml)).getElementsByTagNameNS(W, 'style'))) {
      const id = wAttr(s, 'styleId') ?? ''
      const nm = child(s, 'name')
      styleNames.set(id, (nm && wAttr(nm, 'val')) || id)
    }
  }
  const pictures: { name: string; bytes: Uint8Array }[] = []
  const children: Block[] = []
  let list: { ordered: boolean; items: ListItem[] } | null = null
  const endList = () => {
    if (list) children.push({ type: 'List', ordered: list.ordered, items: list.items })
    list = null
  }
  const runs = (p: Element): Inline[] => {
    const out: Inline[] = []
    const walk = (el: Element, link: string | null) => {
      for (const c of Array.from(el.children)) {
        if (c.localName === 'hyperlink') {
          const id = c.getAttributeNS(R, 'id') ?? c.getAttribute('r:id')
          walk(c, id ? rels.get(id) ?? null : null)
        } else if (c.localName === 'r') {
          const rPr = child(c, 'rPr')
          const marks: Mark[] = []
          if (rPr) {
            if (onOff(child(rPr, 'b'))) marks.push('bold')
            if (onOff(child(rPr, 'i'))) marks.push('italic')
            const u = child(rPr, 'u')
            if (u && wAttr(u, 'val') !== 'none') marks.push('underline')
            if (onOff(child(rPr, 'strike'))) marks.push('strikethrough')
            if (onOff(child(rPr, 'smallCaps'))) marks.push('smallcaps')
            const va = child(rPr, 'vertAlign')
            if (va && wAttr(va, 'val') === 'subscript') marks.push('subscript')
            if (va && wAttr(va, 'val') === 'superscript') marks.push('superscript')
          }
          let text = ''
          for (const t of Array.from(c.children)) {
            if (t.localName === 't') text += t.textContent ?? ''
            else if (t.localName === 'tab') text += '\t'
            else if (t.localName === 'br') text += ' '
            else if (t.localName === 'drawing') {
              const blip = t.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0]
              const id = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttribute('r:embed')
              const target = id ? rels.get(id) : undefined
              const data = target ? zip[`word/${target.replace(/^\/?word\//, '')}`] : undefined
              if (target && data) pictures.push({ name: target.split('/').pop() ?? 'image.png', bytes: data })
            }
          }
          if (text) out.push(link ? { type: 'Link', url: link, children: [T(text, marks)] } : T(text, marks))
        }
      }
    }
    walk(p, null)
    return out
  }
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  for (const el of body ? Array.from(body.children) : []) {
    if (el.localName === 'tbl') {
      endList()
      const rows: string[][] = []
      for (const tr of Array.from(el.children).filter((c) => c.localName === 'tr')) {
        rows.push(Array.from(tr.children).filter((c) => c.localName === 'tc').map((tc) => (tc.textContent ?? '').trim()))
      }
      if (rows.length) children.push({ type: 'Table', rows, caption: '', label: null, alignment: '', style: '' })
      continue
    }
    if (el.localName !== 'p') continue
    const pPr = child(el, 'pPr')
    const styleEl = pPr && child(pPr, 'pStyle')
    const styleId = (styleEl && wAttr(styleEl, 'val')) || ''
    const style = (styleNames.get(styleId) ?? styleId).toLowerCase()
    const picsBefore = pictures.length
    const inl = runs(el)
    const isList = !!(pPr && child(pPr, 'numPr')) || style.startsWith('list')
    const jc = pPr && child(pPr, 'jc')
    const alignV = jc ? wAttr(jc, 'val') : null
    const alignment = alignV === 'center' ? 'center' : alignV === 'right' || alignV === 'end' ? 'right' : alignV === 'both' ? 'justify' : 'left'
    const hm = /^heading\s*(\d)/.exec(style)
    const text = plainText(inl).trim()
    if (style === 'title') {
      endList()
      if (text) children.push({ type: 'Title', children: inl })
    } else if (style === 'subtitle' || style === 'author') {
      endList()
      if (text) children.push({ type: 'Author', children: inl })
    } else if (hm) {
      endList()
      if (text) children.push({ type: 'Section', level: Math.min(5, Math.max(1, Number(hm[1]))), children: inl, numbered: true, label: null })
    } else if (isList && text) {
      const ordered = style.includes('number')
      if (!list || list.ordered !== ordered) {
        endList()
        list = { ordered, items: [] }
      }
      list.items.push({ type: 'ListItem', children: inl })
    } else {
      endList()
      if (text) children.push({ type: 'Paragraph', children: inl, alignment })
    }
    for (let k = picsBefore; k < pictures.length; k++) {
      children.push({ type: 'Figure', path: `@picture:${k}`, caption: '', label: null, width: '0.8\\textwidth', source: '' })
    }
  }
  endList()
  return { doc: { type: 'Document', children, meta: defaultMeta() }, pictures }
}

// ---------------------------------------------------------- export to Word

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function runXml(n: Inline, extra: Mark[] = []): string {
  switch (n.type) {
    case 'Text': {
      const marks = [...n.marks, ...extra]
      const pr = [
        marks.includes('bold') && '<w:b/>', marks.includes('italic') && '<w:i/>', marks.includes('underline') && '<w:u w:val="single"/>',
        marks.includes('strikethrough') && '<w:strike/>', marks.includes('smallcaps') && '<w:smallCaps/>',
        marks.includes('code') && '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>',
        marks.includes('subscript') && '<w:vertAlign w:val="subscript"/>', marks.includes('superscript') && '<w:vertAlign w:val="superscript"/>',
      ].filter(Boolean).join('')
      return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(n.text)}</w:t></w:r>`
    }
    case 'MathInline': return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${esc(n.latex)}</w:t></w:r>`
    case 'Link': case 'Highlight': case 'Comment': return n.children.map((c) => runXml(c, extra)).join('')
    case 'Footnote': return `<w:r><w:t xml:space="preserve"> (${esc(plainText(n.children))})</w:t></w:r>`
    case 'Citation': return `<w:r><w:t xml:space="preserve">[${esc(n.keys.join(', '))}]</w:t></w:r>`
    case 'CrossRef': return `<w:r><w:t xml:space="preserve">${esc(n.label)}</w:t></w:r>`
    case 'InlineRaw': return `<w:r><w:t xml:space="preserve">${esc(n.latex)}</w:t></w:r>`
  }
}

const para = (inner: string, style?: string, jc?: string) =>
  `<w:p>${style || jc ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>` : ''}${inner}</w:p>`

/** A Word file of the document: headings, paragraphs and their formatting, lists, tables, equations as LaTeX text. */
export function exportDocx(doc: Document): Uint8Array {
  const body: string[] = []
  for (const b of doc.children) {
    switch (b.type) {
      case 'Title': body.push(para(b.children.map((c) => runXml(c)).join(''), 'Title')); break
      case 'Author': case 'Affiliation': case 'Correspondence': body.push(para(b.children.map((c) => runXml(c)).join(''), 'Subtitle')); break
      case 'Abstract': body.push(para(b.children.map((c) => runXml(c, ['italic'])).join(''))); break
      case 'Keywords': body.push(para(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Keywords: </w:t></w:r>${b.children.map((c) => runXml(c)).join('')}`)); break
      case 'Section': body.push(para(b.children.map((c) => runXml(c)).join(''), `Heading${Math.min(5, Math.max(1, b.level || 1))}`)); break
      case 'Frame': body.push(para(b.children.map((c) => runXml(c)).join(''), 'Heading1')); break
      case 'Paragraph': {
        const jc = b.alignment === 'center' ? 'center' : b.alignment === 'right' ? 'right' : b.alignment === 'justify' ? 'both' : undefined
        body.push(para(b.children.map((c) => runXml(c)).join(''), undefined, jc))
        break
      }
      case 'List':
        b.items.forEach((it, k) => body.push(para(`<w:r><w:t xml:space="preserve">${b.ordered ? `${k + 1}.` : '•'}\t</w:t></w:r>${it.children.map((c) => runXml(c)).join('')}`, 'ListParagraph')))
        break
      case 'MathBlock': body.push(para(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${esc(b.latex)}</w:t></w:r>`, undefined, 'center')); break
      case 'Figure': body.push(para(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">[Figure: ${esc(b.caption || b.path)}]</w:t></w:r>`, undefined, 'center')); break
      case 'Table': {
        const rows = b.rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(`<w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r>`)}</w:tc>`).join('')}</w:tr>`).join('')
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')}</w:tblBorders></w:tblPr>${rows}</w:tbl>`)
        if (b.caption) body.push(para(`<w:r><w:t xml:space="preserve">${esc(b.caption)}</w:t></w:r>`, 'Caption', 'center'))
        break
      }
      case 'RawLatex': body.push(para(`<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t xml:space="preserve">${esc(b.text)}</w:t></w:r>`)); break
    }
  }
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>' +
    [heading(1, 32), heading(2, 28), heading(3, 26), heading(4, 24), heading(5, 24)].join('') +
    '</w:styles>'
  const zip: Zippable = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'word/styles.xml': strToU8(styles),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>',
    ),
  }
  return zipSync(zip, { level: 6 })
}
