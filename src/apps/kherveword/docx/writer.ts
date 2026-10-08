// KherveWord document → .docx (Office Open XML), written by hand so that what
// the reader (reader.ts) reads back is what was written: paragraph styles,
// direct formatting, lists (multi-level numbering), tables (merged cells,
// header rows, shading, borders), pictures (inline and floating), page and
// section breaks, headers and footers with page numbers, footnotes,
// hyperlinks, comments, tracked changes, equations (OMML) and a table of
// contents field. Plain TypeScript (no DOM): tested in Node.

import { zipSync, strToU8 } from 'fflate'
import {
  contentWidth, headingsOf, highlightName, normColor, pageDims, resolveStyle, walk,
  type DocSettings, type HeaderFooter, type PMMark, type PMNode, type StyleDef, type WordDoc,
} from '../model.ts'
import { XML_HEAD, esc, tag } from './xml.ts'
import { latexToOmml } from './omml.ts'

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_ALL =
  `xmlns:w="${NS_W}" xmlns:r="${NS_R}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const tw = (pt: number) => Math.round(pt * 20)
const PX_EMU = 9525

export interface WriteOptions {
  /** Page number of each heading (in document order), for the table of contents' cached entries. */
  headingPages?: number[]
  /** For the core properties. */
  now?: Date
}

interface Rel {
  id: string
  type: string
  target: string
  external?: boolean
}

interface HfIds {
  [k: string]: string | undefined
}

interface ListLevel {
  kind: 'bullet' | 'ordered'
  style: string
  start: number
}

class Ctx {
  rels: Rel[] = []
  media: { name: string; data: Uint8Array }[] = []
  mediaByKey = new Map<string, string>()
  footnotes: string[] = []
  abstractNums: string[] = []
  nums: string[] = []
  drawingId = 1
  changeId = 100
  commentIds = new Map<string, number>()
  commentOrder: string[] = []
  hf: HfIds = {}
  root: PMNode = { type: 'doc' }
  settings: DocSettings
  opts: WriteOptions
  constructor(settings: DocSettings, opts: WriteOptions) {
    this.settings = settings
    this.opts = opts
  }
  rel(type: string, target: string, external = false): string {
    const found = this.rels.find((r) => r.type === type && r.target === target)
    if (found) return found.id
    const id = `rId${this.rels.length + 10}`
    this.rels.push({ id, type, target, external })
    return id
  }
  commentNum(id: string): number {
    let n = this.commentIds.get(id)
    if (n === undefined) {
      n = this.commentIds.size
      this.commentIds.set(id, n)
      this.commentOrder.push(id)
    }
    return n
  }
}

// ------------------------------------------------------------------ images

/** Bytes and type of a data: URL. */
export function decodeDataUrl(src: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src)
  if (!m) return null
  const mime = (m[1] ?? 'application/octet-stream').toLowerCase()
  if (m[2]) {
    const bin = atob(m[3].replace(/\s+/g, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return { mime, data: out }
  }
  return { mime, data: strToU8(decodeURIComponent(m[3])) }
}

/** Pixel size of a PNG, JPEG or GIF. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      }
      i += 2 + len
    }
  }
  return null
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/tiff': 'tiff' }

function imageXml(node: PMNode, ctx: Ctx): string {
  const a = node.attrs ?? {}
  const src = String(a.src ?? '')
  const img = decodeDataUrl(src)
  if (!img) return a.alt ? run(`[${String(a.alt)}]`, []) : ''
  const ext = EXT[img.mime] ?? 'png'
  let name = ctx.mediaByKey.get(src)
  if (!name) {
    name = `image${ctx.media.length + 1}.${ext}`
    ctx.media.push({ name, data: img.data })
    ctx.mediaByKey.set(src, name)
  }
  const rid = ctx.rel(`${REL}/image`, `media/${name}`)
  const natural = imageSize(img.data) ?? { w: 300, h: 200 }
  let w = Number(a.width) || natural.w
  let h = Number(a.height) || (natural.w ? (w * natural.h) / natural.w : natural.h)
  const maxW = (contentWidth(ctx.settings.page) * 96) / 72
  if (w > maxW) {
    h = (h * maxW) / w
    w = maxW
  }
  const cx = Math.round(w * PX_EMU)
  const cy = Math.round(h * PX_EMU)
  const id = ctx.drawingId++
  const descr = esc(String(a.alt ?? ''))
  const graphic =
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
  const common = `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
  const docPr = `<wp:docPr id="${id}" name="Picture ${id}" descr="${descr}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
  const wrap = a.wrap === 'left' || a.wrap === 'right' ? String(a.wrap) : 'inline'
  if (wrap === 'inline') {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">${common}${docPr}${graphic}</wp:inline></w:drawing></w:r>`
  }
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${251658240 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${wrap}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `${common}<wp:wrapSquare wrapText="bothSides"/>${docPr}${graphic}</wp:anchor></w:drawing></w:r>`
  )
}

// ------------------------------------------------------------------ runs

function markOf(marks: PMMark[] | undefined, type: string): PMMark | undefined {
  return marks?.find((m) => m.type === type)
}

function rPr(marks: PMMark[] | undefined, extra = ''): string {
  if (!marks?.length && !extra) return ''
  let s = extra
  const ts = markOf(marks, 'textStyle')?.attrs ?? {}
  if (ts.fontFamily) {
    const f = esc(String(ts.fontFamily))
    s += `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>`
  }
  if (markOf(marks, 'bold')) s += '<w:b/><w:bCs/>'
  if (markOf(marks, 'italic')) s += '<w:i/><w:iCs/>'
  if (markOf(marks, 'strike')) s += '<w:strike/>'
  const color = normColor(ts.color)
  if (color) s += `<w:color w:val="${color.slice(1).toUpperCase()}"/>`
  const size = parseFloat(String(ts.fontSize ?? ''))
  if (size > 0) s += `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`
  const hl = markOf(marks, 'highlight')
  let shd = ''
  if (hl) {
    const c = normColor(hl.attrs?.color) ?? '#ffff00'
    const name = highlightName(c)
    if (name) s += `<w:highlight w:val="${name}"/>`
    else shd = `<w:shd w:val="clear" w:color="auto" w:fill="${c.slice(1).toUpperCase()}"/>`
  }
  if (markOf(marks, 'underline')) s += '<w:u w:val="single"/>'
  s += shd
  if (markOf(marks, 'superscript')) s += '<w:vertAlign w:val="superscript"/>'
  else if (markOf(marks, 'subscript')) s += '<w:vertAlign w:val="subscript"/>'
  return s ? `<w:rPr>${s}</w:rPr>` : ''
}

function run(text: string, marks: PMMark[] | undefined, deleted = false, extraRPr = ''): string {
  // Tabs become <w:tab/>; the rest is one <w:t> per piece.
  const pr = rPr(marks, extraRPr)
  const tName = deleted ? 'w:delText' : 'w:t'
  let inner = ''
  for (const piece of text.split(/(\t)/)) {
    if (piece === '\t') inner += '<w:tab/>'
    else if (piece) inner += `<${tName} xml:space="preserve">${esc(piece)}</${tName}>`
  }
  return inner ? `<w:r>${pr}${inner}</w:r>` : ''
}

interface Seg {
  xml: string
  link?: string
  ins?: Record<string, unknown>
  del?: Record<string, unknown>
  /** Comment markers: a placeholder that ends grouping. */
  raw?: boolean
}

function inlineSegs(nodes: PMNode[] | undefined, ctx: Ctx): Seg[] {
  const segs: Seg[] = []
  for (const n of nodes ?? []) {
    const marks = n.marks
    const link = markOf(marks, 'link')?.attrs?.href as string | undefined
    const ins = markOf(marks, 'insertion')?.attrs
    const del = markOf(marks, 'deletion')?.attrs
    const comments = (marks ?? []).filter((m) => m.type === 'comment').map((m) => String(m.attrs?.id ?? ''))
    for (const c of comments) segs.push({ xml: `<!--cs:${c}-->`, raw: true })
    let xml = ''
    if (n.type === 'text') xml = run(n.text ?? '', marks?.filter((m) => m.type !== 'link'), !!del, link ? '<w:rStyle w:val="Hyperlink"/>' : '')
    else if (n.type === 'hardBreak') xml = `<w:r>${rPr(marks)}<w:br/></w:r>`
    else if (n.type === 'image') xml = imageXml(n, ctx)
    else if (n.type === 'footnote') {
      ctx.footnotes.push(String(n.attrs?.text ?? ''))
      xml = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${ctx.footnotes.length}"/></w:r>`
    } else if (n.type === 'equation') xml = `<m:oMath>${latexToOmml(String(n.attrs?.latex ?? ''))}</m:oMath>`
    if (xml) segs.push({ xml, link, ins, del })
    for (const c of comments) segs.push({ xml: `<!--ce:${c}-->`, raw: true })
  }
  return segs
}

function changeAttrs(a: Record<string, unknown>, ctx: Ctx): Record<string, string | number> {
  return { 'w:id': ctx.changeId++, 'w:author': String(a.author || 'kWord'), 'w:date': String(a.date || new Date().toISOString()).replace(/\.\d+Z$/, 'Z') }
}

/** Runs with hyperlinks and tracked changes wrapped around them. */
function joinSegs(segs: Seg[], ctx: Ctx): string {
  let out = ''
  let i = 0
  while (i < segs.length) {
    const s = segs[i]
    if (s.raw || (!s.link && !s.ins && !s.del)) {
      out += s.xml
      i++
      continue
    }
    // A group of segments with the same link and the same change.
    let j = i + 1
    while (j < segs.length && !segs[j].raw && segs[j].link === s.link && segs[j].ins === s.ins && segs[j].del === s.del) j++
    let inner = segs.slice(i, j).map((x) => x.xml).join('')
    if (s.link) {
      if (s.link.startsWith('#')) inner = `<w:hyperlink w:anchor="${esc(s.link.slice(1))}" w:history="1">${inner}</w:hyperlink>`
      else inner = `<w:hyperlink r:id="${ctx.rel(`${REL}/hyperlink`, s.link, true)}" w:history="1">${inner}</w:hyperlink>`
    }
    if (s.ins) inner = tag('w:ins', changeAttrs(s.ins, ctx), inner)
    else if (s.del) inner = tag('w:del', changeAttrs(s.del, ctx), inner)
    out += inner
    i = j
  }
  return out
}

// ------------------------------------------------------------------ paragraphs

interface ParaExtra {
  numId?: number
  ilvl?: number
  /** Indent of a later paragraph in a list item (no number). */
  listIndent?: number
  /** A section break after this paragraph. */
  sectPr?: string
  style?: string
}

function pPr(n: PMNode, extra: ParaExtra = {}): string {
  const a = n.attrs ?? {}
  const style = extra.style ?? String(a.style ?? 'Normal')
  let s = ''
  if (style && style !== 'Normal') s += `<w:pStyle w:val="${esc(style)}"/>`
  if (extra.numId !== undefined) s += `<w:numPr><w:ilvl w:val="${extra.ilvl ?? 0}"/><w:numId w:val="${extra.numId}"/></w:numPr>`
  const border = a.border as string | null
  if (border) {
    const b = (side: string) => `<w:${side} w:val="single" w:sz="6" w:space="1" w:color="auto"/>`
    const sides = border === 'box' ? ['top', 'left', 'bottom', 'right'] : border === 'topBottom' ? ['top', 'bottom'] : [border]
    s += `<w:pBdr>${['top', 'left', 'bottom', 'right'].filter((x) => sides.includes(x)).map(b).join('')}</w:pBdr>`
  }
  const shading = normColor(a.shading)
  if (shading) s += `<w:shd w:val="clear" w:color="auto" w:fill="${shading.slice(1).toUpperCase()}"/>`
  const tabs = Array.isArray(a.tabs) ? (a.tabs as { pos: number; align?: string }[]) : []
  if (tabs.length) s += `<w:tabs>${tabs.map((t) => `<w:tab w:val="${t.align === 'center' || t.align === 'right' || t.align === 'decimal' ? t.align : 'left'}" w:pos="${tw(t.pos)}"/>`).join('')}</w:tabs>`
  const sp: Record<string, string | number | undefined> = {}
  if (typeof a.spaceBefore === 'number') sp['w:before'] = tw(a.spaceBefore)
  if (typeof a.spaceAfter === 'number') sp['w:after'] = tw(a.spaceAfter)
  if (typeof a.lineHeight === 'number') {
    sp['w:line'] = Math.round(a.lineHeight * 240)
    sp['w:lineRule'] = 'auto'
  }
  if (Object.keys(sp).length) s += tag('w:spacing', sp)
  const ind: Record<string, string | number | undefined> = {}
  if (typeof a.indentLeft === 'number') ind['w:left'] = tw(a.indentLeft)
  else if (extra.listIndent !== undefined) ind['w:left'] = extra.listIndent
  if (typeof a.indentRight === 'number') ind['w:right'] = tw(a.indentRight)
  if (typeof a.indentFirst === 'number') {
    if (a.indentFirst < 0) ind['w:hanging'] = tw(-a.indentFirst)
    else ind['w:firstLine'] = tw(a.indentFirst)
  }
  if (Object.keys(ind).length) s += tag('w:ind', ind)
  const align = a.align as string | null
  if (align) s += `<w:jc w:val="${align === 'justify' ? 'both' : align}"/>`
  if (extra.sectPr) s += extra.sectPr
  return s ? `<w:pPr>${s}</w:pPr>` : ''
}

function paragraph(n: PMNode, ctx: Ctx, extra: ParaExtra = {}): string {
  return `<w:p>${pPr(n, extra)}${joinSegs(inlineSegs(n.content, ctx), ctx)}</w:p>`
}

// ------------------------------------------------------------------ lists

const BULLETS: Record<string, string> = { disc: '•', circle: '◦', square: '▪', dash: '–' }
const BULLET_CYCLE = ['disc', 'circle', 'square']
const ORDER_CYCLE = ['decimal', 'lower-alpha', 'lower-roman']
const NUM_FMT: Record<string, string> = { decimal: 'decimal', outline: 'decimal', 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman' }

function listLevels(list: PMNode): ListLevel[] {
  const levels: ListLevel[] = []
  const visit = (l: PMNode, depth: number, outline: boolean) => {
    if (depth > 8) return
    const kind = l.type === 'bulletList' ? 'bullet' : 'ordered'
    const own = String(l.attrs?.listStyle ?? '')
    // Nested ordered lists of an outline list (1.1, 1.1.1) are outline too.
    const style = own || (kind === 'ordered' && outline ? 'outline' : kind === 'bullet' ? BULLET_CYCLE[depth % 3] : ORDER_CYCLE[depth % 3])
    if (!levels[depth]) levels[depth] = { kind, style, start: Number(l.attrs?.start ?? 1) || 1 }
    for (const item of l.content ?? []) for (const c of item.content ?? []) if (c.type === 'bulletList' || c.type === 'orderedList') visit(c, depth + 1, kind === 'ordered' && style === 'outline')
  }
  visit(list, 0, false)
  for (let d = 0; d < 9; d++) {
    if (!levels[d]) {
      const prev = levels[d - 1] ?? { kind: 'bullet', style: 'disc', start: 1 }
      levels[d] = prev.kind === 'bullet' ? { kind: 'bullet', style: BULLET_CYCLE[d % 3], start: 1 } : { kind: 'ordered', style: prev.style === 'outline' ? 'outline' : ORDER_CYCLE[d % 3], start: 1 }
    }
  }
  return levels
}

function numberingFor(list: PMNode, ctx: Ctx): number {
  const levels = listLevels(list)
  const absId = ctx.abstractNums.length
  const lvls = levels
    .map((l, d) => {
      const left = 720 * (d + 1)
      const pPr = `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>`
      if (l.kind === 'bullet') {
        const ch = BULLETS[l.style] ?? '•'
        return `<w:lvl w:ilvl="${d}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/>${pPr}</w:lvl>`
      }
      const fmt = NUM_FMT[l.style] ?? 'decimal'
      let text = `%${d + 1}.`
      if (l.style === 'outline') text = Array.from({ length: d + 1 }, (_, k) => `%${k + 1}`).join('.') + '.'
      else if (l.style === 'lower-alpha' || l.style === 'lower-roman') text = `%${d + 1})`
      return `<w:lvl w:ilvl="${d}"><w:start w:val="${l.start}"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>${pPr}</w:lvl>`
    })
    .join('')
  ctx.abstractNums.push(`<w:abstractNum w:abstractNumId="${absId}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`)
  const numId = ctx.nums.length + 1
  ctx.nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${absId}"/></w:num>`)
  return numId
}

function listXml(list: PMNode, ctx: Ctx, numId: number, depth: number): string {
  let out = ''
  for (const item of list.content ?? []) {
    let first = true
    for (const c of item.content ?? []) {
      if (c.type === 'bulletList' || c.type === 'orderedList') out += listXml(c, ctx, numId, depth + 1)
      else if (c.type === 'paragraph') {
        out += first ? paragraph(c, ctx, { numId, ilvl: Math.min(depth, 8) }) : paragraph(c, ctx, { listIndent: 720 * (depth + 1) })
        first = false
      } else {
        out += block(c, ctx)
        first = false
      }
    }
    if (first) out += `<w:p>${pPr({ type: 'paragraph' }, { numId, ilvl: Math.min(depth, 8) })}</w:p>`
  }
  return out
}

// ------------------------------------------------------------------ tables

const BORDER = (side: string, on: boolean) => (on ? `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>` : `<w:${side} w:val="nil"/>`)

function tableXml(t: PMNode, ctx: Ctx): string {
  const rows = t.content ?? []
  // Lay the cells out on a grid (rowspan/colspan).
  type Placed = { cell: PMNode; row: number; col: number; colspan: number; rowspan: number }
  const grid: (Placed | undefined)[][] = []
  const placed: Placed[] = []
  rows.forEach((r, ri) => {
    grid[ri] ??= []
    let col = 0
    for (const cell of r.content ?? []) {
      while (grid[ri][col]) col++
      const colspan = Math.max(1, Number(cell.attrs?.colspan ?? 1))
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan ?? 1))
      const p: Placed = { cell, row: ri, col, colspan, rowspan }
      placed.push(p)
      for (let dr = 0; dr < rowspan; dr++) {
        grid[ri + dr] ??= []
        for (let dc = 0; dc < colspan; dc++) grid[ri + dr][col + dc] = p
      }
      col += colspan
    }
  })
  const ncols = Math.max(1, ...grid.map((r) => r.length))
  // Column widths: from the cells' colwidth (px), else shared equally.
  const widths: (number | null)[] = Array(ncols).fill(null)
  for (const p of placed) {
    const cw = p.cell.attrs?.colwidth as number[] | null | undefined
    if (Array.isArray(cw)) cw.forEach((w, k) => w && widths[p.col + k] === null && (widths[p.col + k] = w))
  }
  const total = tw(contentWidth(ctx.settings.page))
  const known = widths.reduce<number>((s, w) => s + (w ? Math.round(w * 15) : 0), 0)
  const unknownCount = widths.filter((w) => !w).length
  const each = unknownCount ? Math.max(400, Math.round((total - known) / unknownCount)) : 0
  const gridTw = widths.map((w) => (w ? Math.round(w * 15) : each))
  const borders = String(t.attrs?.borders ?? 'all')
  const outer = borders !== 'none'
  const insideH = borders === 'all' || borders === 'horizontal'
  const insideV = borders === 'all'
  const edges = borders === 'horizontal' ? { left: false, right: false } : { left: outer, right: outer }
  const tblBorders = `<w:tblBorders>${BORDER('top', outer)}${BORDER('left', edges.left)}${BORDER('bottom', outer)}${BORDER('right', edges.right)}${BORDER('insideH', insideH)}${BORDER('insideV', insideV)}</w:tblBorders>`
  const hasHeader = (rows[0]?.content ?? []).some((c) => c.type === 'tableHeader')
  let out = `<w:tbl><w:tblPr><w:tblStyle w:val="KherveTable"/><w:tblW w:w="0" w:type="auto"/>${tblBorders}<w:tblLayout w:type="fixed"/><w:tblLook w:val="${hasHeader ? '0420' : '0400'}" w:firstRow="${hasHeader ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>`
  out += `<w:tblGrid>${gridTw.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
  rows.forEach((r, ri) => {
    const header = (r.content ?? []).length > 0 && (r.content ?? []).every((c) => c.type === 'tableHeader')
    let tr = `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`
    for (let c = 0; c < ncols; ) {
      const p = grid[ri]?.[c]
      if (!p) {
        tr += `<w:tc><w:tcPr><w:tcW w:w="${gridTw[c]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
        c++
        continue
      }
      const width = gridTw.slice(p.col, p.col + p.colspan).reduce((s, w) => s + w, 0)
      let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`
      if (p.colspan > 1) tcPr += `<w:gridSpan w:val="${p.colspan}"/>`
      if (p.rowspan > 1) tcPr += p.row === ri ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>'
      const bg = normColor(p.cell.attrs?.background)
      if (bg) tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="${bg.slice(1).toUpperCase()}"/>`
      const va = p.cell.attrs?.valign
      if (va === 'middle' || va === 'bottom') tcPr += `<w:vAlign w:val="${va === 'middle' ? 'center' : 'bottom'}"/>`
      let inner = ''
      if (p.row === ri) {
        const content = p.cell.content ?? []
        inner = content.map((b) => block(b, ctx)).join('')
        if (!content.length || content[content.length - 1].type !== 'paragraph') inner += '<w:p/>'
      } else inner = '<w:p/>'
      tr += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${inner}</w:tc>`
      c += p.colspan
    }
    out += `${tr}</w:tr>`
  })
  return `${out}</w:tbl>`
}

// ------------------------------------------------------------------ blocks

function tocXml(ctx: Ctx): string {
  const heads = headingsOf(ctx.root, ctx.settings.styles)
    .map((h, index) => ({ ...h, index }))
    .filter((h) => h.level <= 3)
  const pages = ctx.opts.headingPages ?? []
  const right = tw(contentWidth(ctx.settings.page))
  const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  const title = '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>'
  if (!heads.length) return `${title}<w:p>${begin}<w:r><w:t>No headings yet.</w:t></w:r>${end}</w:p>`
  const items = heads.map((h, i) => {
    const page = pages[h.index] ?? ''
    const p = `<w:pPr><w:pStyle w:val="TOC${h.level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${right}"/></w:tabs></w:pPr>`
    const body = `<w:r><w:t xml:space="preserve">${esc(h.text)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r>`
    return `<w:p>${p}${i === 0 ? begin : ''}${body}${i === heads.length - 1 ? end : ''}</w:p>`
  })
  return title + items.join('')
}

function block(n: PMNode, ctx: Ctx): string {
  switch (n.type) {
    case 'paragraph':
      return paragraph(n, ctx)
    case 'bulletList':
    case 'orderedList':
      return listXml(n, ctx, numberingFor(n, ctx), 0)
    case 'table':
      return tableXml(n, ctx)
    case 'pageBreak':
      if (n.attrs?.kind === 'section') return `<w:p><w:pPr>${sectPr(ctx, true)}</w:pPr></w:p>`
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    case 'horizontalRule':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'
    case 'equationBlock':
      return `<w:p><m:oMathPara><m:oMath>${latexToOmml(String(n.attrs?.latex ?? ''))}</m:oMath></m:oMathPara></w:p>`
    case 'toc':
      return tocXml(ctx)
    case 'blockquote':
      return (n.content ?? []).map((c) => block(c.type === 'paragraph' ? { ...c, attrs: { ...c.attrs, style: 'Quote' } } : c, ctx)).join('')
    default:
      if (n.content) return n.content.map((c) => block(c, ctx)).join('')
      return ''
  }
}

// ------------------------------------------------------------------ sections

function sectPr(ctx: Ctx, nextPage = false): string {
  const p = ctx.settings.page
  const { w, h } = pageDims(p)
  const m = p.margins
  let refs = ''
  for (const [kind, key] of [['header', 'h'], ['footer', 'f']] as const) {
    const def = ctx.hf[`${key}default`]
    const first = ctx.hf[`${key}first`]
    if (def) refs += `<w:${kind}Reference w:type="default" r:id="${def}"/>`
    if (first) refs += `<w:${kind}Reference w:type="first" r:id="${first}"/>`
  }
  return (
    `<w:sectPr>${refs}${nextPage ? '<w:type w:val="nextPage"/>' : ''}<w:pgSz w:w="${tw(w)}" w:h="${tw(h)}"${p.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(m.header)}" w:footer="${tw(m.footer)}" w:gutter="0"/>` +
    `<w:cols w:space="708"/>${ctx.settings.differentFirst ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`
  )
}

/** Runs for header/footer text with {PAGE}, {PAGES}, {DATE}, {TITLE} as fields. */
function hfRuns(text: string): string {
  let out = ''
  const lines = text.split('\n')
  lines.forEach((line, li) => {
    if (li) out += '<w:r><w:br/></w:r>'
    for (const part of line.split(/(\{(?:PAGE|PAGES|NUMPAGES|DATE|TITLE)\})/i)) {
      if (!part) continue
      const tok = part.toUpperCase()
      const field = tok === '{PAGE}' ? 'PAGE' : tok === '{PAGES}' || tok === '{NUMPAGES}' ? 'NUMPAGES' : tok === '{DATE}' ? 'DATE \\@ "d MMMM yyyy"' : tok === '{TITLE}' ? 'TITLE' : null
      if (field) out += `<w:fldSimple w:instr=" ${esc(field)} "><w:r><w:t>${field === 'PAGE' || field === 'NUMPAGES' ? '1' : ''}</w:t></w:r></w:fldSimple>`
      else out += run(part, [])
    }
  })
  return out
}

function hfXml(kind: 'hdr' | 'ftr', hf: HeaderFooter, settings: DocSettings): string {
  const cw = tw(contentWidth(settings.page))
  const style = kind === 'hdr' ? 'Header' : 'Footer'
  const parts = [hf.left, hf.center, hf.right]
  let body: string
  if (!hf.left && !hf.right) body = `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:jc w:val="center"/></w:pPr>${hfRuns(hf.center)}</w:p>`
  else if (!hf.left && !hf.center) body = `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:jc w:val="right"/></w:pPr>${hfRuns(hf.right)}</w:p>`
  else {
    body =
      `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="center" w:pos="${Math.round(cw / 2)}"/><w:tab w:val="right" w:pos="${cw}"/></w:tabs></w:pPr>` +
      parts.map((p, i) => (i ? '<w:r><w:tab/></w:r>' : '') + hfRuns(p)).join('') +
      '</w:p>'
  }
  return `${XML_HEAD}<w:${kind} ${NS_ALL}>${body}</w:${kind}>`
}

// ------------------------------------------------------------------ styles

function styleRPr(s: StyleDef): string {
  let r = ''
  if (s.font) r += `<w:rFonts w:ascii="${esc(s.font)}" w:hAnsi="${esc(s.font)}" w:cs="${esc(s.font)}" w:eastAsia="${esc(s.font)}"/>`
  if (s.bold !== undefined) r += s.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/>'
  if (s.italic !== undefined) r += s.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/>'
  if (s.allCaps) r += '<w:caps/>'
  const c = normColor(s.color)
  if (c) r += `<w:color w:val="${c.slice(1).toUpperCase()}"/>`
  if (s.size) r += `<w:sz w:val="${Math.round(s.size * 2)}"/><w:szCs w:val="${Math.round(s.size * 2)}"/>`
  if (s.underline) r += '<w:u w:val="single"/>'
  return r ? `<w:rPr>${r}</w:rPr>` : ''
}

function stylePPr(s: StyleDef, isHeading: boolean): string {
  let p = ''
  if (isHeading) p += '<w:keepNext/><w:keepLines/>'
  if (s.borderBottom) p += '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="4472C4"/></w:pBdr>'
  const shd = normColor(s.shading)
  if (shd) p += `<w:shd w:val="clear" w:color="auto" w:fill="${shd.slice(1).toUpperCase()}"/>`
  const sp: Record<string, number | string | undefined> = {}
  if (s.spaceBefore !== undefined) sp['w:before'] = tw(s.spaceBefore)
  if (s.spaceAfter !== undefined) sp['w:after'] = tw(s.spaceAfter)
  if (s.lineHeight !== undefined) {
    sp['w:line'] = Math.round(s.lineHeight * 240)
    sp['w:lineRule'] = 'auto'
  }
  if (Object.keys(sp).length) p += tag('w:spacing', sp)
  const ind: Record<string, number | undefined> = {}
  if (s.indentLeft !== undefined) ind['w:left'] = tw(s.indentLeft)
  if (s.indentRight !== undefined) ind['w:right'] = tw(s.indentRight)
  if (s.indentFirst !== undefined) {
    if (s.indentFirst < 0) ind['w:hanging'] = tw(-s.indentFirst)
    else ind['w:firstLine'] = tw(s.indentFirst)
  }
  if (Object.keys(ind).length) p += tag('w:ind', ind)
  if (s.align) p += `<w:jc w:val="${s.align === 'justify' ? 'both' : s.align}"/>`
  if (s.outline) p += `<w:outlineLvl w:val="${s.outline - 1}"/>`
  return p ? `<w:pPr>${p}</w:pPr>` : ''
}

/** Word's own names for its built-in styles (so Word maps them to its gallery). */
const WORD_NAMES: Record<string, string> = {
  Normal: 'Normal', Title: 'Title', Subtitle: 'Subtitle', Heading1: 'heading 1', Heading2: 'heading 2', Heading3: 'heading 3', Heading4: 'heading 4',
  Heading5: 'heading 5', Heading6: 'heading 6', Quote: 'Quote', IntenseQuote: 'Intense Quote', Caption: 'caption', NoSpacing: 'No Spacing',
  ListParagraph: 'List Paragraph',
}

function stylesXml(settings: DocSettings): string {
  const styles = settings.styles
  const normal = resolveStyle(styles, 'Normal')
  const font = esc(normal.font ?? 'Calibri')
  let out =
    `${XML_HEAD}<w:styles xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${Math.round((normal.size ?? 11) * 2)}"/><w:szCs w:val="${Math.round((normal.size ?? 11) * 2)}"/><w:lang w:val="${esc(settings.lang || 'en-GB')}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="${tw(normal.spaceAfter ?? 8)}" w:line="${Math.round((normal.lineHeight ?? 1.08) * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  for (const s of Object.values(styles)) {
    const name = WORD_NAMES[s.id] ?? s.name
    const isDefault = s.id === 'Normal'
    out +=
      `<w:style w:type="paragraph"${isDefault ? ' w:default="1"' : ''} w:styleId="${esc(s.id)}"${s.id in WORD_NAMES || !s.id.startsWith('Custom') ? '' : ' w:customStyle="1"'}>` +
      `<w:name w:val="${esc(name)}"/>${s.basedOn && styles[s.basedOn] ? `<w:basedOn w:val="${esc(s.basedOn)}"/>` : ''}${s.next ? `<w:next w:val="${esc(s.next)}"/>` : ''}` +
      `${s.outline ? '<w:uiPriority w:val="9"/>' : ''}${s.quick ? '<w:qFormat/>' : ''}${stylePPr(s, !!s.outline)}${styleRPr(s)}</w:style>`
  }
  const fixed = [
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>',
    '<w:style w:type="table" w:styleId="KherveTable"><w:name w:val="kWord Table"/><w:basedOn w:val="TableGrid"/><w:uiPriority w:val="39"/><w:tblPr/><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr></w:style>',
    '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="440"/></w:pPr></w:style>',
  ]
  return `${out}${fixed.join('')}</w:styles>`
}

// ------------------------------------------------------------------ the package


export function writeDocx(wd: WordDoc, opts: WriteOptions = {}): Uint8Array {
  const settings = wd.settings
  const ctx = new Ctx(settings, opts)
  ctx.root = wd.doc
  const files: Record<string, Uint8Array> = {}

  // Headers and footers first: the section properties refer to them.
  const hfParts: [string, 'hdr' | 'ftr', HeaderFooter | undefined, string][] = [
    ['hdefault', 'hdr', settings.header, 'header1.xml'],
    ['fdefault', 'ftr', settings.footer, 'footer1.xml'],
  ]
  if (settings.differentFirst) {
    hfParts.push(['hfirst', 'hdr', settings.firstHeader ?? { left: '', center: '', right: '' }, 'header2.xml'])
    hfParts.push(['ffirst', 'ftr', settings.firstFooter ?? { left: '', center: '', right: '' }, 'footer2.xml'])
  }
  for (const [key, kind, hf, file] of hfParts) {
    const empty = !hf || (!hf.left && !hf.center && !hf.right)
    if (empty && !key.endsWith('first')) continue
    files[`word/${file}`] = strToU8(hfXml(kind, hf ?? { left: '', center: '', right: '' }, settings))
    ctx.hf[key] = ctx.rel(`${REL}/${kind === 'hdr' ? 'header' : 'footer'}`, file)
  }

  // The body.
  let body = ''
  for (const n of wd.doc.content ?? []) body += block(n, ctx)
  // Comments: keep the first start and the last end of each.
  body = placeComments(body, ctx)
  // An equation at the top level of a paragraph only; a body must end with a paragraph before sectPr.
  const documentXml = `${XML_HEAD}<w:document ${NS_ALL}><w:body>${body}${sectPr(ctx)}</w:body></w:document>`
  files['word/document.xml'] = strToU8(documentXml)
  files['word/styles.xml'] = strToU8(stylesXml(settings))
  ctx.rel(`${REL}/styles`, 'styles.xml')

  // Settings.
  files['word/settings.xml'] = strToU8(
    `${XML_HEAD}<w:settings xmlns:w="${NS_W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">` +
      `<w:zoom w:percent="100"/>${settings.trackChanges ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>` +
      `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>` +
      `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
      `<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/></m:mathPr><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`,
  )
  ctx.rel(`${REL}/settings`, 'settings.xml')

  if (ctx.abstractNums.length) {
    files['word/numbering.xml'] = strToU8(`${XML_HEAD}<w:numbering xmlns:w="${NS_W}">${ctx.abstractNums.join('')}${ctx.nums.join('')}</w:numbering>`)
    ctx.rel(`${REL}/numbering`, 'numbering.xml')
  }
  // Footnotes (the two separators are required by Word).
  files['word/footnotes.xml'] = strToU8(
    `${XML_HEAD}<w:footnotes ${NS_ALL}>` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      ctx.footnotes
        .map(
          (t, i) =>
            `<w:footnote w:id="${i + 1}">${t
              .split('\n')
              .map((line, li) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${li === 0 ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ''}${run(line, [])}</w:p>`)
              .join('')}</w:footnote>`,
        )
        .join('') +
      '</w:footnotes>',
  )
  ctx.rel(`${REL}/footnotes`, 'footnotes.xml')

  if (ctx.commentOrder.length) {
    const items = ctx.commentOrder.map((id) => {
      const c = settings.comments[id] ?? { author: 'kWord', date: new Date().toISOString(), text: '' }
      const initials = c.author.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3)
      const paras = (c.text || ' ').split('\n').map(
        (line, li) => `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${li === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}${run(line, [])}</w:p>`,
      )
      return tag('w:comment', { 'w:id': ctx.commentNum(id), 'w:author': c.author || 'kWord', 'w:date': c.date.replace(/\.\d+Z$/, 'Z'), 'w:initials': initials }, paras.join(''))
    })
    files['word/comments.xml'] = strToU8(`${XML_HEAD}<w:comments ${NS_ALL}>${items.join('')}</w:comments>`)
    ctx.rel(`${REL}/comments`, 'comments.xml')
  }

  for (const m of ctx.media) files[`word/media/${m.name}`] = m.data

  files['word/_rels/document.xml.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      ctx.rels.map((r) => tag('Relationship', { Id: r.id, Type: r.type, Target: r.target, TargetMode: r.external ? 'External' : undefined })).join('') +
      '</Relationships>',
  )

  // Package parts.
  const now = (opts.now ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z')
  files['docProps/core.xml'] = strToU8(
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(settings.title)}</dc:title><dc:creator>${esc(settings.author)}</dc:creator><cp:lastModifiedBy>${esc(settings.author)}</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  )
  files['docProps/app.xml'] = strToU8(
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>kWord</Application></Properties>`,
  )
  files['_rels/.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  )
  const W = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
  const overrides: [string, string][] = [
    ['/word/document.xml', `${W}.document.main+xml`],
    ['/word/styles.xml', `${W}.styles+xml`],
    ['/word/settings.xml', `${W}.settings+xml`],
    ['/word/footnotes.xml', `${W}.footnotes+xml`],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ]
  if (files['word/numbering.xml']) overrides.push(['/word/numbering.xml', `${W}.numbering+xml`])
  if (files['word/comments.xml']) overrides.push(['/word/comments.xml', `${W}.comments+xml`])
  for (const f of Object.keys(files)) {
    const m = /^word\/(header|footer)\d+\.xml$/.exec(f)
    if (m) overrides.push([`/${f}`, `${W}.${m[1]}+xml`])
  }
  const defaults: [string, string][] = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
  ]
  const exts = new Set(ctx.media.map((m) => m.name.split('.').pop()!))
  const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tiff: 'image/tiff' }
  for (const e of exts) defaults.push([e, MIME[e] ?? 'application/octet-stream'])
  files['[Content_Types].xml'] = strToU8(
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      defaults.map(([e, t]) => tag('Default', { Extension: e, ContentType: t })).join('') +
      overrides.map(([p, t]) => tag('Override', { PartName: p, ContentType: t })).join('') +
      '</Types>',
  )
  // [Content_Types].xml first, as Word writes it.
  const ordered: Record<string, Uint8Array> = { '[Content_Types].xml': files['[Content_Types].xml'] }
  for (const [k, v] of Object.entries(files)) if (k !== '[Content_Types].xml') ordered[k] = v
  return zipSync(ordered, { level: 6 })
}

/** Replace the comment placeholders: the first start and the last end of each comment. */
function placeComments(body: string, ctx: Ctx): string {
  const first = new Map<string, number>()
  const last = new Map<string, number>()
  const re = /<!--c([se]):([^>]*?)-->/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m[1] === 's' && !first.has(m[2])) first.set(m[2], m.index)
    if (m[1] === 'e') last.set(m[2], m.index)
  }
  return body.replace(re, (_all, kind: string, id: string, offset: number) => {
    if (!ctx.settings.comments[id]) return ''
    if (kind === 's' && first.get(id) === offset) return `<w:commentRangeStart w:id="${ctx.commentNum(id)}"/>`
    if (kind === 'e' && last.get(id) === offset) {
      const n = ctx.commentNum(id)
      return `<w:commentRangeEnd w:id="${n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r>`
    }
    return ''
  })
}

/** Every image source used (to turn drive paths or blob: URLs into data: URLs before writing). */
export function imageSources(doc: PMNode): string[] {
  const out: string[] = []
  walk(doc, (n) => {
    if (n.type === 'image' && n.attrs?.src) out.push(String(n.attrs.src))
  })
  return out
}
