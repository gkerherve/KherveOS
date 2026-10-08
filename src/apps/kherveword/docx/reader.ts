// .docx (Office Open XML, from Word, LibreOffice, Google Docs, Pages or
// KherveWord) → KherveWord document. Reads paragraph and character styles
// (with theme fonts), direct formatting, numbering (multi-level lists),
// tables (merged cells, header rows, shading, borders, nested tables),
// pictures, text boxes (as paragraphs), page and section breaks, headers and
// footers with page fields, footnotes and endnotes, hyperlinks, comments,
// tracked changes, equations (OMML → LaTeX), table-of-contents fields, and the
// page setup. Plain TypeScript (no DOM): tested in Node.

import { unzipSync, strFromU8 } from 'fflate'
import {
  HIGHLIGHTS, PAGE_SIZES, defaultSettings, defaultStyles, emptyHF, normColor,
  type Comment, type DocSettings, type HeaderFooter, type PMMark, type PMNode, type StyleDef, type WordDoc,
} from '../model.ts'
import { findAll, isEl, kid, kids, onOff, parseXml, path, textOf, val, type XmlElement } from './xml.ts'
import { ommlToLatex } from './omml.ts'

const twPt = (v: string | undefined) => (v === undefined || v === '' ? undefined : Math.round((Number(v) / 20) * 100) / 100)

interface Rel {
  type: string
  target: string
  external: boolean
}

interface LevelDef {
  fmt: string
  text: string
  start: number
  /** Left indent of the level, points. */
  indent?: number
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const ID_BY_NAME: Record<string, string> = {
  normal: 'Normal', title: 'Title', subtitle: 'Subtitle', quote: 'Quote', 'intense quote': 'IntenseQuote', caption: 'Caption',
  'no spacing': 'NoSpacing', 'list paragraph': 'ListParagraph',
}

/** Paragraph info before lists are put together. */
interface Para {
  node: PMNode
  num?: { numId: string; ilvl: number }
  /** Left indent in points (direct or from the style), for list continuation. */
  indent?: number
  /** Blocks to put before / after (page breaks, text boxes, section breaks). */
  before: PMNode[]
  after: PMNode[]
  /** The paragraph is only part of a table of contents field: drop it. */
  drop?: boolean
}

interface Field {
  instr: string
  result: boolean
  link?: string
}

class Reader {
  files: Record<string, Uint8Array>
  docPath = 'word/document.xml'
  rels = new Map<string, Rel>()
  partRels = new Map<string, Map<string, Rel>>()
  styles: Record<string, StyleDef> = {}
  /** File style id → KherveWord style id. */
  styleIds = new Map<string, string>()
  styleNum = new Map<string, { numId: string; ilvl: number }>()
  charStyles = new Map<string, XmlElement>()
  tableBorders = new Map<string, XmlElement>()
  numLevels = new Map<string, LevelDef[]>()
  footnotes = new Map<string, string>()
  endnotes = new Map<string, string>()
  comments: Record<string, Comment> = {}
  themeMajor = 'Calibri Light'
  themeMinor = 'Calibri'
  activeComments: string[] = []
  fields: Field[] = []
  tocPending = false
  numCount = new Map<string, number>()
  constructor(files: Record<string, Uint8Array>) {
    this.files = files
  }

  xml(name: string): XmlElement | undefined {
    const f = this.files[name]
    if (!f) return undefined
    try {
      return parseXml(strFromU8(f))
    } catch {
      return undefined
    }
  }

  relsOf(part: string): Map<string, Rel> {
    const cached = this.partRels.get(part)
    if (cached) return cached
    const dir = part.split('/').slice(0, -1).join('/')
    const name = part.split('/').pop()
    const out = new Map<string, Rel>()
    const x = this.xml(`${dir ? `${dir}/` : ''}_rels/${name}.rels`)
    for (const r of kids(x, 'rel:Relationship').concat(kids(x, 'Relationship'))) {
      const external = r.attrs.TargetMode === 'External'
      out.set(r.attrs.Id, { type: r.attrs.Type ?? '', target: external ? r.attrs.Target : resolveTarget(part, r.attrs.Target ?? ''), external })
    }
    this.partRels.set(part, out)
    return out
  }

  partOfType(kind: string): string | undefined {
    for (const r of this.rels.values()) if (r.type.endsWith(`/${kind}`)) return r.target
    return undefined
  }

  // ---------------------------------------------------------------- parts

  readTheme() {
    const t = this.partOfType('theme')
    const x = t ? this.xml(t) : undefined
    const scheme = x ? findAll(x, 'a:fontScheme')[0] : undefined
    const major = path(scheme, 'a:majorFont', 'a:latin')?.attrs.typeface
    const minor = path(scheme, 'a:minorFont', 'a:latin')?.attrs.typeface
    if (major) this.themeMajor = major
    if (minor) this.themeMinor = minor
  }

  font(rFonts: XmlElement | undefined): string | undefined {
    if (!rFonts) return undefined
    const a = rFonts.attrs
    const direct = a['w:ascii'] ?? a['w:hAnsi'] ?? a['w:cs'] ?? a['w:eastAsia']
    if (direct) return direct
    const theme = a['w:asciiTheme'] ?? a['w:hAnsiTheme']
    if (theme) return theme.startsWith('major') ? this.themeMajor : this.themeMinor
    return undefined
  }

  styleFromXml(pPr: XmlElement | undefined, rPr: XmlElement | undefined, s: StyleDef) {
    if (rPr) {
      const f = this.font(kid(rPr, 'w:rFonts'))
      if (f) s.font = f
      const sz = val(rPr, 'w:sz')
      if (sz) s.size = Number(sz) / 2
      const b = onOff(rPr, 'w:b')
      if (b !== undefined) s.bold = b
      const i = onOff(rPr, 'w:i')
      if (i !== undefined) s.italic = i
      const caps = onOff(rPr, 'w:caps')
      if (caps) s.allCaps = true
      const u = val(rPr, 'w:u')
      if (u && u !== 'none') s.underline = true
      const c = val(rPr, 'w:color')
      if (c && c !== 'auto') s.color = normColor(c) ?? undefined
    }
    if (pPr) {
      const jc = val(pPr, 'w:jc')
      if (jc) s.align = jcAlign(jc)
      const sp = kid(pPr, 'w:spacing')
      if (sp) {
        if (sp.attrs['w:before'] !== undefined) s.spaceBefore = twPt(sp.attrs['w:before'])
        if (sp.attrs['w:after'] !== undefined) s.spaceAfter = twPt(sp.attrs['w:after'])
        const lh = lineHeight(sp, s.size ?? 11)
        if (lh) s.lineHeight = lh
      }
      const ind = kid(pPr, 'w:ind')
      if (ind) {
        const l = ind.attrs['w:left'] ?? ind.attrs['w:start']
        if (l !== undefined) s.indentLeft = twPt(l)
        const r = ind.attrs['w:right'] ?? ind.attrs['w:end']
        if (r !== undefined) s.indentRight = twPt(r)
        if (ind.attrs['w:hanging'] !== undefined) s.indentFirst = -(twPt(ind.attrs['w:hanging']) ?? 0)
        else if (ind.attrs['w:firstLine'] !== undefined) s.indentFirst = twPt(ind.attrs['w:firstLine'])
      }
      const ol = val(pPr, 'w:outlineLvl')
      if (ol !== undefined && Number(ol) < 9) s.outline = Number(ol) + 1
      const bottom = path(pPr, 'w:pBdr', 'w:bottom')
      if (bottom && bottom.attrs['w:val'] !== 'nil' && bottom.attrs['w:val'] !== 'none') s.borderBottom = true
      const shd = kid(pPr, 'w:shd')?.attrs['w:fill']
      if (shd && shd !== 'auto') s.shading = normColor(shd) ?? undefined
    }
  }

  readStyles() {
    const x = this.xml(this.partOfType('styles') ?? 'word/styles.xml')
    if (!x) return
    const defaults = kid(x, 'w:docDefaults')
    const defR = path(defaults, 'w:rPrDefault', 'w:rPr')
    const defP = path(defaults, 'w:pPrDefault', 'w:pPr')
    const base: StyleDef = { id: 'Normal', name: 'Normal' }
    this.styleFromXml(defP, defR, base)
    const raw: { el: XmlElement; id: string }[] = []
    for (const st of kids(x, 'w:style')) {
      const type = st.attrs['w:type']
      const fileId = st.attrs['w:styleId'] ?? ''
      if (type === 'character') {
        this.charStyles.set(fileId, st)
        continue
      }
      if (type === 'table') {
        const b = path(st, 'w:tblPr', 'w:tblBorders')
        if (b) this.tableBorders.set(fileId, b)
        continue
      }
      if (type !== 'paragraph') continue
      const name = val(st, 'w:name') ?? fileId
      const lower = name.toLowerCase()
      const h = /^heading\s*(\d)$/.exec(lower)
      const id = h ? `Heading${h[1]}` : (ID_BY_NAME[lower] ?? (fileId.replace(/[^A-Za-z0-9_-]/g, '') || 'Style'))
      this.styleIds.set(fileId, id)
      raw.push({ el: st, id })
    }
    const known = defaultStyles()
    for (const { el, id } of raw) {
      const name = known[id]?.name ?? val(el, 'w:name') ?? id
      const s: StyleDef = { id, name }
      const basedOn = val(el, 'w:basedOn')
      if (basedOn) s.basedOn = basedOn
      const next = val(el, 'w:next')
      if (next) s.next = next
      s.quick = !!kid(el, 'w:qFormat') && !onOff(el, 'w:semiHidden')
      if (known[id]) s.quick = known[id].quick
      this.styleFromXml(kid(el, 'w:pPr'), kid(el, 'w:rPr'), s)
      if (/^Heading\d$/.test(id) && !s.outline) s.outline = Number(id.slice(7))
      const numPr = path(el, 'w:pPr', 'w:numPr')
      if (numPr) {
        const numId = val(numPr, 'w:numId')
        if (numId && numId !== '0') this.styleNum.set(id, { numId, ilvl: Number(val(numPr, 'w:ilvl') ?? 0) })
      }
      if (id === 'Normal') {
        for (const [k, v] of Object.entries(base)) if (v !== undefined && (s as unknown as Record<string, unknown>)[k] === undefined && k !== 'id' && k !== 'name') (s as unknown as Record<string, unknown>)[k] = v
      }
      this.styles[id] = s
    }
    for (const s of Object.values(this.styles)) {
      if (s.basedOn) s.basedOn = this.styleIds.get(s.basedOn) ?? s.basedOn
      if (s.next) s.next = this.styleIds.get(s.next) ?? s.next
      if (s.basedOn && !this.styles[s.basedOn] && !known[s.basedOn]) delete s.basedOn
      if (s.next && !this.styles[s.next] && !known[s.next]) delete s.next
    }
    if (!this.styles.Normal) this.styles.Normal = { ...known.Normal, ...base, id: 'Normal', name: 'Normal', quick: true }
  }

  readNumbering() {
    const x = this.xml(this.partOfType('numbering') ?? 'word/numbering.xml')
    if (!x) return
    const abstract = new Map<string, LevelDef[]>()
    for (const an of kids(x, 'w:abstractNum')) {
      const levels: LevelDef[] = []
      for (const l of kids(an, 'w:lvl')) {
        const ind = path(l, 'w:pPr', 'w:ind')
        levels[Number(l.attrs['w:ilvl'] ?? 0)] = {
          fmt: val(l, 'w:numFmt') ?? 'decimal',
          text: val(l, 'w:lvlText') ?? '',
          start: Number(val(l, 'w:start') ?? 1),
          indent: twPt(ind?.attrs['w:left'] ?? ind?.attrs['w:start']),
        }
      }
      abstract.set(an.attrs['w:abstractNumId'], levels)
      // numStyleLink: levels come from another abstractNum (rare); ignored.
    }
    for (const n of kids(x, 'w:num')) {
      const base = abstract.get(val(n, 'w:abstractNumId') ?? '') ?? []
      const levels = base.map((l) => ({ ...l }))
      for (const o of kids(n, 'w:lvlOverride')) {
        const i = Number(o.attrs['w:ilvl'] ?? 0)
        const so = val(o, 'w:startOverride')
        if (so && levels[i]) levels[i].start = Number(so)
        const lvl = kid(o, 'w:lvl')
        if (lvl) levels[i] = { fmt: val(lvl, 'w:numFmt') ?? 'decimal', text: val(lvl, 'w:lvlText') ?? '', start: Number(val(lvl, 'w:start') ?? 1), indent: twPt(path(lvl, 'w:pPr', 'w:ind')?.attrs['w:left']) }
      }
      this.numLevels.set(n.attrs['w:numId'], levels)
    }
  }

  notesText(part: string | undefined, tag: string, into: Map<string, string>) {
    const x = part ? this.xml(part) : undefined
    for (const fn of kids(x, tag)) {
      const type = fn.attrs['w:type']
      if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue
      const text = kids(fn, 'w:p')
        .map((p) => plainText(p))
        .join('\n')
        .trim()
      into.set(fn.attrs['w:id'], text)
    }
  }

  readComments() {
    const part = this.partOfType('comments')
    const x = part ? this.xml(part) : undefined
    for (const c of kids(x, 'w:comment')) {
      this.comments[`c${c.attrs['w:id']}`] = {
        author: c.attrs['w:author'] ?? '',
        date: c.attrs['w:date'] ?? '',
        text: kids(c, 'w:p')
          .map((p) => plainText(p))
          .join('\n')
          .trim(),
      }
    }
  }

  // ---------------------------------------------------------------- runs

  marksFromRPr(rPr: XmlElement | undefined, base: PMMark[]): PMMark[] {
    let marks = base.slice()
    if (!rPr) return marks
    const rStyle = val(rPr, 'w:rStyle')
    if (rStyle) {
      const cs = this.charStyles.get(rStyle)
      const name = (val(cs, 'w:name') ?? rStyle).toLowerCase()
      const ignore = /hyperlink|footnote|endnote|annotation|comment|char$|placeholder|page number/.test(name)
      if (cs && !ignore) marks = this.marksFromRPr(kid(cs, 'w:rPr'), marks)
    }
    const set = (type: string, on: boolean | undefined) => {
      if (on === undefined) return
      marks = marks.filter((m) => m.type !== type)
      if (on) marks.push({ type })
    }
    set('bold', onOff(rPr, 'w:b'))
    set('italic', onOff(rPr, 'w:i'))
    const u = val(rPr, 'w:u')
    if (kid(rPr, 'w:u')) set('underline', u !== 'none' && u !== '0')
    const strike = onOff(rPr, 'w:strike') ?? onOff(rPr, 'w:dstrike')
    set('strike', strike)
    const va = val(rPr, 'w:vertAlign')
    if (va === 'superscript') set('superscript', true)
    else if (va === 'subscript') set('subscript', true)
    else if (va === 'baseline') {
      set('superscript', false)
      set('subscript', false)
    }
    const ts: Record<string, unknown> = { ...(marks.find((m) => m.type === 'textStyle')?.attrs ?? {}) }
    const f = this.font(kid(rPr, 'w:rFonts'))
    if (f) ts.fontFamily = f
    const sz = val(rPr, 'w:sz')
    if (sz) ts.fontSize = `${Number(sz) / 2}pt`
    const c = val(rPr, 'w:color')
    if (c && c !== 'auto') ts.color = normColor(c)
    if (Object.values(ts).some((v) => v)) {
      marks = marks.filter((m) => m.type !== 'textStyle')
      marks.push({ type: 'textStyle', attrs: ts })
    }
    const hl = val(rPr, 'w:highlight')
    const shd = kid(rPr, 'w:shd')?.attrs['w:fill']
    if (hl && hl !== 'none') {
      marks = marks.filter((m) => m.type !== 'highlight')
      marks.push({ type: 'highlight', attrs: { color: HIGHLIGHTS[hl] ?? '#ffff00' } })
    } else if (shd && shd !== 'auto' && shd.toLowerCase() !== 'ffffff') {
      marks = marks.filter((m) => m.type !== 'highlight')
      marks.push({ type: 'highlight', attrs: { color: normColor(shd) } })
    }
    return marks
  }

  /** The marks that come from where a run is (hyperlink, change, comments, fields). */
  contextMarks(base: PMMark[]): PMMark[] {
    let marks = base
    const link = [...this.fields].reverse().find((f) => f.result && f.link)?.link
    if (link && !marks.some((m) => m.type === 'link')) marks = [...marks, { type: 'link', attrs: { href: link } }]
    for (const id of this.activeComments) marks = [...marks, { type: 'comment', attrs: { id } }]
    return marks
  }

  /** Inside a field's instructions, or the cached result of a table of contents. */
  hidden(): boolean {
    return this.fields.some((f) => !f.result || /^\s*TOC\b/i.test(f.instr))
  }

  inline(el: XmlElement, marks: PMMark[], para: Para, part: string, out: PMNode[]) {
    for (const c of el.children) {
      if (!isEl(c)) continue
      switch (c.name) {
        case 'w:r':
          this.run(c, marks, para, part, out)
          break
        case 'w:hyperlink': {
          const rid = c.attrs['r:id']
          const href = rid ? this.relsOf(part).get(rid)?.target : c.attrs['w:anchor'] ? `#${c.attrs['w:anchor']}` : undefined
          this.inline(c, href ? [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href } }] : marks, para, part, out)
          break
        }
        case 'w:ins':
        case 'w:moveTo':
          this.inline(c, [...marks, { type: 'insertion', attrs: { id: `t${c.attrs['w:id'] ?? ''}`, author: c.attrs['w:author'] ?? '', date: c.attrs['w:date'] ?? '' } }], para, part, out)
          break
        case 'w:del':
        case 'w:moveFrom':
          this.inline(c, [...marks, { type: 'deletion', attrs: { id: `t${c.attrs['w:id'] ?? ''}`, author: c.attrs['w:author'] ?? '', date: c.attrs['w:date'] ?? '' } }], para, part, out)
          break
        case 'w:fldSimple': {
          const instr = c.attrs['w:instr'] ?? ''
          const hm = /HYPERLINK\s+"([^"]+)"/i.exec(instr)
          this.inline(c, hm ? [...marks, { type: 'link', attrs: { href: hm[1] } }] : marks, para, part, out)
          break
        }
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:bdo':
        case 'w:dir':
          this.inline(c, marks, para, part, out)
          break
        case 'w:sdt':
          this.inline(kid(c, 'w:sdtContent') ?? c, marks, para, part, out)
          break
        case 'mc:AlternateContent':
          this.inline(kid(c, 'mc:Choice') ?? kid(c, 'mc:Fallback') ?? c, marks, para, part, out)
          break
        case 'w:commentRangeStart':
          this.activeComments.push(`c${c.attrs['w:id']}`)
          break
        case 'w:commentRangeEnd': {
          const id = `c${c.attrs['w:id']}`
          this.activeComments = this.activeComments.filter((x) => x !== id)
          break
        }
        case 'm:oMath':
          if (!this.hidden()) out.push({ type: 'equation', attrs: { latex: ommlToLatex(c) } })
          break
        case 'm:oMathPara':
          for (const m of kids(c, 'm:oMath')) if (!this.hidden()) out.push({ type: 'equation', attrs: { latex: ommlToLatex(m), display: true } })
          break
        default:
          break
      }
    }
  }

  run(r: XmlElement, outer: PMMark[], para: Para, part: string, out: PMNode[]) {
    const rPr = kid(r, 'w:rPr')
    if (onOff(rPr, 'w:vanish')) return
    const runMarks = this.marksFromRPr(rPr, outer.filter((m) => m.type === 'link' || m.type === 'insertion' || m.type === 'deletion' || m.type === 'comment'))
    const text = (s: string) => {
      if (!s || this.hidden()) return
      out.push({ type: 'text', text: s, marks: this.contextMarks(runMarks) })
    }
    for (const c of r.children) {
      if (!isEl(c)) continue
      switch (c.name) {
        case 'w:t':
        case 'w:delText':
          text(textOf(c))
          break
        case 'w:tab':
        case 'w:ptab':
          text('\t')
          break
        case 'w:br':
          if (this.hidden()) break
          if (c.attrs['w:type'] === 'page') out.push({ type: '__pagebreak' })
          else if (c.attrs['w:type'] === 'column') out.push({ type: '__pagebreak' })
          else out.push({ type: 'hardBreak', marks: this.contextMarks(runMarks).filter((m) => m.type !== 'comment') })
          break
        case 'w:cr':
          if (!this.hidden()) out.push({ type: 'hardBreak' })
          break
        case 'w:noBreakHyphen':
          text('‑')
          break
        case 'w:softHyphen':
          text('­')
          break
        case 'w:sym': {
          const code = parseInt(c.attrs['w:char'] ?? '', 16)
          if (Number.isFinite(code)) text(String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code))
          break
        }
        case 'w:fldChar': {
          const t = c.attrs['w:fldCharType']
          if (t === 'begin') this.fields.push({ instr: '', result: false })
          else if (t === 'separate') {
            const f = this.fields[this.fields.length - 1]
            if (f) {
              f.result = true
              const hm = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(f.instr)
              if (hm) f.link = /\\l/.test(f.instr) && !hm[1].includes(':') ? `#${hm[1]}` : hm[1]
              if (/^\s*TOC\b/i.test(f.instr)) this.tocPending = true
            }
          } else if (t === 'end') {
            const f = this.fields.pop()
            // A TOC field with no cached result (separate missing).
            if (f && !f.result && /^\s*TOC\b/i.test(f.instr)) this.tocPending = true
          }
          break
        }
        case 'w:instrText': {
          const f = this.fields[this.fields.length - 1]
          if (f && !f.result) f.instr += textOf(c)
          break
        }
        case 'w:footnoteReference':
        case 'w:endnoteReference': {
          if (this.hidden()) break
          const id = c.attrs['w:id']
          const t = (c.name === 'w:footnoteReference' ? this.footnotes : this.endnotes).get(id) ?? ''
          out.push({ type: 'footnote', attrs: { text: t } })
          break
        }
        case 'w:drawing':
          this.drawing(c, para, part, out)
          break
        case 'w:pict':
        case 'w:object': {
          const img = findAll(c, 'v:imagedata')[0]
          const rid = img?.attrs['r:id']
          if (rid) {
            const node = this.image(rid, part, null, null, 'inline', '')
            if (node) out.push(node)
          }
          const box = findAll(c, 'w:txbxContent')[0]
          if (box) para.after.push(...this.blocks(kids(box), part))
          break
        }
        case 'mc:AlternateContent': {
          const pick = kid(c, 'mc:Choice') ?? kid(c, 'mc:Fallback')
          if (pick) this.run({ ...r, children: pick.children }, outer, para, part, out)
          break
        }
        case 'm:oMath':
          if (!this.hidden()) out.push({ type: 'equation', attrs: { latex: ommlToLatex(c) } })
          break
        default:
          break
      }
    }
  }

  image(rid: string, part: string, w: number | null, h: number | null, wrap: string, alt: string): PMNode | null {
    const rel = this.relsOf(part).get(rid)
    if (!rel || rel.external) return null
    const bytes = this.files[rel.target]
    if (!bytes) return null
    const ext = rel.target.split('.').pop()!.toLowerCase()
    const mime = MIME[ext] ?? 'application/octet-stream'
    return { type: 'image', attrs: { src: `data:${mime};base64,${toBase64(bytes)}`, alt: alt || null, width: w, height: h, wrap } }
  }

  drawing(d: XmlElement, para: Para, part: string, out: PMNode[]) {
    for (const holder of kids(d)) {
      const ext = kid(holder, 'wp:extent')
      const w = ext ? Math.round(Number(ext.attrs.cx) / 9525) : null
      const h = ext ? Math.round(Number(ext.attrs.cy) / 9525) : null
      let wrap = 'inline'
      if (holder.name === 'wp:anchor') {
        const align = path(holder, 'wp:positionH', 'wp:align')
        wrap = align && textOf(align) === 'right' ? 'right' : 'left'
        if (kid(holder, 'wp:wrapTopAndBottom') || kid(holder, 'wp:wrapNone')) wrap = 'inline'
      }
      const alt = kid(holder, 'wp:docPr')?.attrs.descr ?? ''
      const blip = findAll(holder, 'a:blip')[0]
      const rid = blip?.attrs['r:embed']
      if (rid && !this.hidden()) {
        const node = this.image(rid, part, w, h, wrap, alt)
        if (node) out.push(node)
      }
      const box = findAll(holder, 'w:txbxContent')[0]
      if (box) para.after.push(...this.blocks(kids(box), part))
    }
  }

  // ---------------------------------------------------------------- paragraphs

  paragraph(p: XmlElement, part: string): Para {
    const pPr = kid(p, 'w:pPr')
    const fileStyle = val(pPr, 'w:pStyle')
    let style = fileStyle ? (this.styleIds.get(fileStyle) ?? fileStyle) : 'Normal'
    const attrs: Record<string, unknown> = { style }
    const para: Para = { node: { type: 'paragraph', attrs }, before: [], after: [] }
    const startedHidden = this.hidden()
    // Direct paragraph formatting.
    const jc = val(pPr, 'w:jc')
    if (jc) attrs.align = jcAlign(jc)
    const sp = kid(pPr, 'w:spacing')
    if (sp) {
      if (sp.attrs['w:before'] !== undefined) attrs.spaceBefore = twPt(sp.attrs['w:before'])
      if (sp.attrs['w:after'] !== undefined) attrs.spaceAfter = twPt(sp.attrs['w:after'])
      const lh = lineHeight(sp, 11)
      if (lh) attrs.lineHeight = lh
    }
    const ind = kid(pPr, 'w:ind')
    if (ind) {
      const l = ind.attrs['w:left'] ?? ind.attrs['w:start']
      if (l !== undefined) attrs.indentLeft = twPt(l)
      const r = ind.attrs['w:right'] ?? ind.attrs['w:end']
      if (r !== undefined) attrs.indentRight = twPt(r)
      if (ind.attrs['w:hanging'] !== undefined) attrs.indentFirst = -(twPt(ind.attrs['w:hanging']) ?? 0)
      else if (ind.attrs['w:firstLine'] !== undefined) attrs.indentFirst = twPt(ind.attrs['w:firstLine'])
    }
    const bdr = kid(pPr, 'w:pBdr')
    if (bdr) {
      const on = (s: string) => {
        const b = kid(bdr, `w:${s}`)
        return !!b && b.attrs['w:val'] !== 'nil' && b.attrs['w:val'] !== 'none'
      }
      const t = on('top')
      const b = on('bottom')
      const l = on('left')
      const r = on('right')
      attrs.border = t && b && l && r ? 'box' : t && b ? 'topBottom' : b ? 'bottom' : t ? 'top' : null
    }
    const shd = kid(pPr, 'w:shd')?.attrs['w:fill']
    if (shd && shd !== 'auto') attrs.shading = normColor(shd)
    const tabs = kids(kid(pPr, 'w:tabs'), 'w:tab').filter((t) => t.attrs['w:val'] !== 'clear')
    if (tabs.length) attrs.tabs = tabs.map((t) => ({ pos: twPt(t.attrs['w:pos']) ?? 0, align: t.attrs['w:val'] === 'end' ? 'right' : t.attrs['w:val'] === 'start' ? 'left' : (t.attrs['w:val'] ?? 'left') }))
    if (onOff(pPr, 'w:pageBreakBefore')) para.before.push({ type: 'pageBreak', attrs: { kind: 'page' } })
    // Numbering: direct, or from the style.
    const numPr = kid(pPr, 'w:numPr')
    let num: { numId: string; ilvl: number } | undefined
    if (numPr) {
      const numId = val(numPr, 'w:numId')
      if (numId && numId !== '0') num = { numId, ilvl: Number(val(numPr, 'w:ilvl') ?? 0) }
    } else num = this.styleNum.get(style)
    if (num && this.numLevels.get(num.numId)) {
      para.num = num
      delete attrs.indentLeft
      delete attrs.indentFirst
      if (style === 'ListParagraph') attrs.style = style = 'Normal'
    }
    para.indent = (attrs.indentLeft as number | undefined) ?? this.styles[style]?.indentLeft
    // Section break after this paragraph.
    if (kid(pPr, 'w:sectPr')) para.after.push({ type: 'pageBreak', attrs: { kind: 'section' } })
    // Paragraph mark revision (pPr/rPr ins|del) is not kept.
    const inl: PMNode[] = []
    this.inline(p, [], para, part, inl)
    const meaningful = inl.some((n) => n.type !== 'text' || n.text?.trim())
    if (!meaningful && (startedHidden || this.hidden() || this.tocPending)) para.drop = true
    para.node.content = mergeText(inl)
    return para
  }

  /** Paragraphs split at page breaks, as blocks. */
  paraBlocks(para: Para): PMNode[] {
    const content = para.node.content ?? []
    // A paragraph holding only display equations becomes equation blocks.
    if (content.length && content.every((n) => n.type === 'equation' && n.attrs?.display)) {
      return [...para.before, ...content.map((n) => ({ type: 'equationBlock', attrs: { latex: n.attrs?.latex } })), ...para.after]
    }
    // Word's horizontal line: an empty paragraph with a bottom border.
    const a = para.node.attrs ?? {}
    if (!content.length && a.border === 'bottom' && (a.style ?? 'Normal') === 'Normal' && Object.keys(a).every((k) => k === 'style' || k === 'border')) {
      return [...para.before, { type: 'horizontalRule' }, ...para.after]
    }
    const pieces: PMNode[][] = [[]]
    for (const n of content) {
      if (n.type === '__pagebreak') pieces.push([])
      else pieces[pieces.length - 1].push(n.type === 'equation' ? { type: 'equation', attrs: { latex: n.attrs?.latex } } : n)
    }
    const out: PMNode[] = [...para.before]
    const isSection = para.after.some((n) => n.type === 'pageBreak' && n.attrs?.kind === 'section')
    pieces.forEach((piece, i) => {
      if (i > 0) out.push({ type: 'pageBreak', attrs: { kind: 'page' } })
      const empty = !piece.length
      // Drop the empty paragraphs around a page break, and an empty paragraph that only carries a section break.
      if (empty && (pieces.length > 1 || isSection)) return
      out.push({ ...para.node, content: piece.length ? piece : undefined })
    })
    out.push(...para.after)
    return out
  }

  // ---------------------------------------------------------------- blocks

  blocks(elements: XmlElement[], part: string): PMNode[] {
    const out: PMNode[] = []
    type Open = { list: PMNode; numId: string; ilvl: number; indent?: number }
    let stack: Open[] = []
    const flush = () => {
      stack = []
    }
    const emitToc = () => {
      if (!this.tocPending) return
      this.tocPending = false
      const prev = out[out.length - 1]
      if (prev?.type === 'paragraph' && /^TOC ?Heading$/i.test(String(prev.attrs?.style ?? ''))) out.pop()
      out.push({ type: 'toc' })
    }
    const listPara = (para: Para) => {
      const { numId, ilvl } = para.num!
      const levels = this.numLevels.get(numId) ?? []
      const def = levels[ilvl] ?? { fmt: 'bullet', text: '•', start: 1 }
      const kind = def.fmt === 'bullet' ? 'bulletList' : 'orderedList'
      if (stack.length && stack[0].numId !== numId && ilvl === 0) flush()
      while (stack.length > ilvl + 1) stack.pop()
      if (stack.length === ilvl + 1 && stack[ilvl].list.type !== kind) stack.pop()
      while (stack.length < ilvl + 1) {
        const depth = stack.length
        const d = levels[depth] ?? def
        const k = depth === ilvl ? kind : d.fmt === 'bullet' ? 'bulletList' : 'orderedList'
        const list = this.newList(k, d, levels, depth, numId)
        if (!stack.length) out.push(list)
        else {
          const parent = stack[stack.length - 1].list
          let item = parent.content![parent.content!.length - 1]
          if (!item) {
            item = { type: 'listItem', content: [{ type: 'paragraph', attrs: { style: 'Normal' } }] }
            parent.content!.push(item)
          }
          item.content!.push(list)
        }
        stack.push({ list, numId, ilvl: depth, indent: d.indent ?? 36 * (depth + 1) })
      }
      const top = stack[stack.length - 1]
      const blocks = this.paraBlocks(para)
      const first = blocks.find((b) => b.type === 'paragraph') ?? { type: 'paragraph', attrs: { style: 'Normal' } }
      top.list.content!.push({ type: 'listItem', content: [first] })
      if (ilvl === 0) this.numCount.set(numId, (this.numCount.get(numId) ?? 0) + 1)
      for (const b of blocks) if (b !== first) out.push(b)
    }
    for (const el of elements) {
      switch (el.name) {
        case 'w:p': {
          const para = this.paragraph(el, part)
          emitToc()
          if (para.drop) {
            flush()
            break
          }
          if (para.num) {
            listPara(para)
            break
          }
          // A later paragraph of a list item: indented like the item's text.
          if (stack.length && para.indent !== undefined) {
            const level = [...stack].reverse().find((s) => s.indent !== undefined && Math.abs(s.indent - para.indent!) < 0.5)
            if (level) {
              const item = level.list.content![level.list.content!.length - 1]
              const node = { ...para.node, attrs: { ...para.node.attrs } }
              delete (node.attrs as Record<string, unknown>).indentLeft
              item.content!.push(node)
              break
            }
          }
          flush()
          out.push(...this.paraBlocks(para))
          break
        }
        case 'w:tbl':
          emitToc()
          flush()
          out.push(this.table(el, part))
          break
        case 'w:sdt': {
          const gallery = findAll(kid(el, 'w:sdtPr'), 'w:docPartGallery')[0]?.attrs['w:val'] ?? ''
          if (/table of contents/i.test(gallery)) {
            flush()
            this.tocPending = true
            emitToc()
            // Skip the TOC's own paragraphs (heading and cached entries).
            break
          }
          out.push(...this.blocks(kids(kid(el, 'w:sdtContent')), part))
          break
        }
        case 'w:customXml':
        case 'w:ins':
        case 'w:moveTo':
          out.push(...this.blocks(kids(el), part))
          break
        case 'mc:AlternateContent':
          out.push(...this.blocks(kids(kid(el, 'mc:Choice') ?? kid(el, 'mc:Fallback')), part))
          break
        case 'm:oMathPara':
          for (const m of kids(el, 'm:oMath')) out.push({ type: 'equationBlock', attrs: { latex: ommlToLatex(m) } })
          break
        case 'w:commentRangeStart':
          this.activeComments.push(`c${el.attrs['w:id']}`)
          break
        case 'w:commentRangeEnd': {
          const id = `c${el.attrs['w:id']}`
          this.activeComments = this.activeComments.filter((x) => x !== id)
          break
        }
        default:
          break
      }
    }
    emitToc()
    return out
  }

  newList(type: string, d: LevelDef, levels: LevelDef[], depth: number, numId: string): PMNode {
    if (type === 'bulletList') {
      const t = d.text
      const style = /[◦o○]/.test(t) ? 'circle' : /[▪■§]/.test(t) ? 'square' : /[–\-]/.test(t) ? 'dash' : 'disc'
      const def = ['disc', 'circle', 'square'][depth % 3]
      return { type: 'bulletList', attrs: { listStyle: style === def ? null : style }, content: [] }
    }
    const fmtStyle: Record<string, string> = { decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman', decimalZero: 'decimal' }
    let style = fmtStyle[d.fmt] ?? 'decimal'
    if ((d.text.match(/%\d/g) ?? []).length > 1 || (levels[depth + 1]?.text.match(/%\d/g) ?? []).length > 1) style = 'outline'
    const def = ['decimal', 'lower-alpha', 'lower-roman'][depth % 3]
    const parentOutline = depth > 0 && ((levels[depth - 1]?.text.match(/%\d/g) ?? []).length > 1 || (levels[depth]?.text.match(/%\d/g) ?? []).length > 1)
    let start = d.start || 1
    if (depth === 0) start += this.numCount.get(numId) ?? 0
    // Nested levels of an outline list (1.1, 1.1.1) inherit "outline".
    const listStyle = style === def || (parentOutline && style === 'outline') ? null : style
    return { type: 'orderedList', attrs: { start, listStyle }, content: [] }
  }

  table(t: XmlElement, part: string): PMNode {
    const tblPr = kid(t, 'w:tblPr')
    const gridW = kids(kid(t, 'w:tblGrid'), 'w:gridCol').map((g) => Math.round(Number(g.attrs['w:w'] ?? 0) / 15))
    let bordersEl = kid(tblPr, 'w:tblBorders')
    const styleId = val(tblPr, 'w:tblStyle')
    if (!bordersEl && styleId) bordersEl = this.tableBorders.get(styleId)
    const on = (s: string) => {
      const b = kid(bordersEl, `w:${s}`)
      return !!b && b.attrs['w:val'] !== 'nil' && b.attrs['w:val'] !== 'none'
    }
    let borders = 'all'
    if (!bordersEl) borders = styleId && /grid|kherve/i.test(styleId) ? 'all' : 'none'
    else {
      const outer = on('top') || on('bottom')
      const iH = on('insideH')
      const iV = on('insideV')
      const sides = on('left') || on('right')
      borders = iH && iV ? 'all' : !outer && !iH && !iV ? 'none' : iH && !iV && !sides ? 'horizontal' : outer && !iH && !iV ? 'outer' : 'all'
    }
    // Rows (rows may sit inside sdt/customXml wrappers).
    const rowEls: XmlElement[] = []
    const collect = (el: XmlElement) => {
      for (const c of kids(el)) {
        if (c.name === 'w:tr') rowEls.push(c)
        else if (c.name === 'w:sdt') collect(kid(c, 'w:sdtContent') ?? c)
        else if (c.name === 'w:customXml') collect(c)
      }
    }
    collect(t)
    type Cell = { node: PMNode; col: number; span: number }
    const rows: { header: boolean; cells: Cell[] }[] = []
    const above = new Map<number, Cell>() // grid column → the cell above that may continue (vMerge)
    for (const tr of rowEls) {
      const header = !!kid(kid(tr, 'w:trPr'), 'w:tblHeader') && onOff(kid(tr, 'w:trPr'), 'w:tblHeader') !== false
      const cells: Cell[] = []
      let col = Number(val(kid(tr, 'w:trPr'), 'w:gridBefore') ?? 0)
      const cellEls: XmlElement[] = []
      const collectCells = (el: XmlElement) => {
        for (const c of kids(el)) {
          if (c.name === 'w:tc') cellEls.push(c)
          else if (c.name === 'w:sdt') collectCells(kid(c, 'w:sdtContent') ?? c)
          else if (c.name === 'w:customXml') collectCells(c)
        }
      }
      collectCells(tr)
      for (const tc of cellEls) {
        const tcPr = kid(tc, 'w:tcPr')
        const span = Math.max(1, Number(val(tcPr, 'w:gridSpan') ?? 1))
        const vm = kid(tcPr, 'w:vMerge')
        const vmVal = vm?.attrs['w:val']
        if (vm && vmVal !== 'restart') {
          const up = above.get(col)
          if (up) {
            up.node.attrs!.rowspan = Number(up.node.attrs!.rowspan ?? 1) + 1
            col += span
            continue
          }
        }
        const attrs: Record<string, unknown> = { colspan: span, rowspan: 1 }
        const widths = gridW.slice(col, col + span)
        attrs.colwidth = widths.length === span && widths.every((w) => w > 0) ? widths : null
        const shd = kid(tcPr, 'w:shd')?.attrs['w:fill']
        if (shd && shd !== 'auto') attrs.background = normColor(shd)
        const va = val(tcPr, 'w:vAlign')
        if (va === 'center' || va === 'bottom') attrs.valign = va === 'center' ? 'middle' : 'bottom'
        let content = this.blocks(kids(tc), part)
        if (!content.length) content = [{ type: 'paragraph', attrs: { style: 'Normal' } }]
        const cell: Cell = { node: { type: header ? 'tableHeader' : 'tableCell', attrs, content }, col, span }
        cells.push(cell)
        above.set(col, cell)
        col += span
      }
      rows.push({ header, cells })
    }
    const content = rows
      .filter((r) => r.cells.length)
      .map((r) => ({ type: 'tableRow', content: r.cells.map((c) => c.node) }))
    if (!content.length) content.push({ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', attrs: { style: 'Normal' } }] }] })
    return { type: 'table', attrs: { borders }, content }
  }

  // ---------------------------------------------------------------- headers and footers

  headerFooter(part: string | undefined): HeaderFooter {
    const x = part ? this.xml(part) : undefined
    const hf = emptyHF()
    if (!x) return hf
    const lines: { left: string[]; center: string[]; right: string[] } = { left: [], center: [], right: [] }
    for (const p of findAll(x, 'w:p')) {
      const text = hfText(p)
      if (!text.replace(/\t/g, '').trim()) continue
      const parts = text.split('\t')
      const pPr = kid(p, 'w:pPr')
      const jc = jcAlign(val(pPr, 'w:jc') ?? 'left')
      const firstTab = kids(kid(pPr, 'w:tabs'), 'w:tab').find((t) => t.attrs['w:val'] !== 'clear')?.attrs['w:val']
      if (parts.length === 1) (jc === 'center' ? lines.center : jc === 'right' ? lines.right : lines.left).push(parts[0].trim())
      else if (parts.length === 2) {
        if (parts[0].trim()) lines.left.push(parts[0].trim())
        ;(firstTab === 'right' || firstTab === 'end' ? lines.right : lines.center).push(parts[1].trim())
      } else {
        if (parts[0].trim()) lines.left.push(parts[0].trim())
        if (parts[1].trim()) lines.center.push(parts[1].trim())
        const rest = parts.slice(2).join(' ').trim()
        if (rest) lines.right.push(rest)
      }
    }
    hf.left = lines.left.join('\n')
    hf.center = lines.center.join('\n')
    hf.right = lines.right.join('\n')
    return hf
  }
}

/** Text of a header/footer paragraph, with {PAGE}/{PAGES}/{DATE}/{TITLE} for fields. */
function hfText(p: XmlElement): string {
  let out = ''
  const stack: { instr: string; result: boolean }[] = []
  const token = (instr: string) => {
    const w = instr.trim().split(/\s+/)[0]?.toUpperCase()
    return w === 'PAGE' ? '{PAGE}' : w === 'NUMPAGES' || w === 'SECTIONPAGES' ? '{PAGES}' : w === 'DATE' || w === 'TIME' || w === 'CREATEDATE' ? '{DATE}' : w === 'TITLE' ? '{TITLE}' : null
  }
  const walkEl = (el: XmlElement) => {
    for (const c of el.children) {
      if (!isEl(c)) continue
      if (c.name === 'w:fldSimple') {
        const t = token(c.attrs['w:instr'] ?? '')
        if (t) out += t
        else walkEl(c)
      } else if (c.name === 'w:fldChar') {
        const t = c.attrs['w:fldCharType']
        if (t === 'begin') stack.push({ instr: '', result: false })
        else if (t === 'separate') {
          const f = stack[stack.length - 1]
          if (f) {
            f.result = true
            const tok = token(f.instr)
            if (tok) out += tok
          }
        } else if (t === 'end') {
          const f = stack.pop()
          if (f && !f.result) {
            const tok = token(f.instr)
            if (tok) out += tok
          }
        }
      } else if (c.name === 'w:instrText') {
        const f = stack[stack.length - 1]
        if (f) f.instr += textOf(c)
      } else if (c.name === 'w:t') {
        const f = stack[stack.length - 1]
        if (!f || (f.result && !token(f.instr))) out += textOf(c)
      } else if (c.name === 'w:tab' || c.name === 'w:ptab') {
        if (!(p.name === 'w:pPr')) out += '\t'
      } else if (c.name === 'w:br' || c.name === 'w:cr') out += ' '
      else if (c.name === 'w:pPr' || c.name === 'w:rPr' || c.name === 'w:drawing' || c.name === 'w:pict') continue
      else walkEl(c)
    }
  }
  walkEl(p)
  return out
}

function plainText(p: XmlElement): string {
  let s = ''
  const walkEl = (el: XmlElement) => {
    for (const c of el.children) {
      if (!isEl(c)) continue
      if (c.name === 'w:t' || c.name === 'w:delText') s += textOf(c)
      else if (c.name === 'w:tab') s += '\t'
      else if (c.name === 'w:br' || c.name === 'w:cr') s += '\n'
      else if (c.name === 'w:instrText' || c.name === 'w:pPr' || c.name === 'w:rPr') continue
      else walkEl(c)
    }
  }
  walkEl(p)
  return s
}

function jcAlign(jc: string): 'left' | 'center' | 'right' | 'justify' {
  if (jc === 'center') return 'center'
  if (jc === 'right' || jc === 'end') return 'right'
  if (jc === 'both' || jc === 'distribute' || jc === 'justify' || jc.startsWith('thai')) return 'justify'
  return 'left'
}

function lineHeight(sp: XmlElement, sizePt: number): number | undefined {
  const line = sp.attrs['w:line']
  if (line === undefined) return undefined
  const rule = sp.attrs['w:lineRule'] ?? 'auto'
  const n = Number(line)
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (rule === 'auto') return Math.round((n / 240) * 100) / 100
  // Exact / at least: as a multiple of the font's single line (about 1.17 × size).
  return Math.round((n / 20 / (sizePt * 1.17)) * 100) / 100
}

/** Merge neighbouring text nodes that have the same marks. */
export function mergeText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (n.text ?? '') }
    } else out.push(n.type === 'text' && !n.marks?.length ? { type: 'text', text: n.text } : n)
  }
  return out
}

function pageFromSectPr(sect: XmlElement | undefined, settings: DocSettings) {
  const pgSz = kid(sect, 'w:pgSz')
  if (pgSz) {
    const w = (Number(pgSz.attrs['w:w']) || 11906) / 20
    const h = (Number(pgSz.attrs['w:h']) || 16838) / 20
    const landscape = pgSz.attrs['w:orient'] === 'landscape' || w > h
    const pw = Math.min(w, h)
    const ph = Math.max(w, h)
    const named = Object.entries(PAGE_SIZES).find(([, s]) => Math.abs(s.width - pw) < 3 && Math.abs(s.height - ph) < 3)?.[0]
    settings.page.size = named ?? 'Custom'
    settings.page.width = named ? PAGE_SIZES[named].width : pw
    settings.page.height = named ? PAGE_SIZES[named].height : ph
    settings.page.orientation = landscape ? 'landscape' : 'portrait'
  }
  const m = kid(sect, 'w:pgMar')
  if (m) {
    const g = (k: string, d: number) => (m.attrs[k] !== undefined ? Math.abs(Number(m.attrs[k])) / 20 : d)
    const mg = settings.page.margins
    settings.page.margins = { top: g('w:top', mg.top), right: g('w:right', mg.right), bottom: g('w:bottom', mg.bottom), left: g('w:left', mg.left), header: g('w:header', mg.header), footer: g('w:footer', mg.footer) }
  }
}

/** Read a .docx (or .dotx/.docm) file. */
export function readDocx(bytes: Uint8Array): WordDoc {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('This is not a Word document (.docx): it is not a zip package.')
  }
  const r = new Reader(files)
  const pkgRels = r.relsOf('')
  const main = [...pkgRels.values()].find((x) => x.type.endsWith('/officeDocument'))
  if (main) r.docPath = main.target
  if (!files[r.docPath]) {
    if (files['word/document.xml']) r.docPath = 'word/document.xml'
    else throw new Error('This file has no Word document inside (word/document.xml is missing). Old .doc files are not supported: save them as .docx.')
  }
  r.rels = r.relsOf(r.docPath)
  r.readTheme()
  r.readStyles()
  r.readNumbering()
  r.notesText(r.partOfType('footnotes'), 'w:footnote', r.footnotes)
  r.notesText(r.partOfType('endnotes'), 'w:endnote', r.endnotes)
  r.readComments()

  const docXml = r.xml(r.docPath)
  const body = kid(docXml, 'w:body')
  if (!body) throw new Error('The Word document has no body.')
  const settings = defaultSettings()
  settings.styles = { ...defaultStyles(), ...r.styles }
  settings.comments = r.comments
  const content = r.blocks(kids(body), r.docPath)
  const sect = kid(body, 'w:sectPr') ?? findAll(body, 'w:sectPr').pop()
  pageFromSectPr(sect, settings)
  const refs = (kind: string) => {
    const out: Record<string, string | undefined> = {}
    for (const ref of kids(sect, `w:${kind}Reference`)) out[ref.attrs['w:type'] ?? 'default'] = r.rels.get(ref.attrs['r:id'] ?? '')?.target
    return out
  }
  const hr = refs('header')
  const fr = refs('footer')
  settings.header = r.headerFooter(hr.default)
  settings.footer = r.headerFooter(fr.default)
  if (kid(sect, 'w:titlePg') && onOff(sect, 'w:titlePg') !== false) {
    settings.differentFirst = true
    settings.firstHeader = r.headerFooter(hr.first)
    settings.firstFooter = r.headerFooter(fr.first)
  }
  const sx = r.xml(r.partOfType('settings') ?? 'word/settings.xml')
  if (sx && kid(sx, 'w:trackRevisions') && onOff(sx, 'w:trackRevisions') !== false) settings.trackChanges = true
  const lang = val(path(r.xml(r.partOfType('styles') ?? 'word/styles.xml'), 'w:docDefaults', 'w:rPrDefault', 'w:rPr'), 'w:lang')
  if (lang) settings.lang = lang
  const coreRel = [...pkgRels.values()].find((x) => x.type.endsWith('/core-properties'))
  const core = r.xml(coreRel?.target ?? 'docProps/core.xml')
  if (core) {
    settings.title = textOf(kid(core, 'dc:title')).trim()
    settings.author = textOf(kid(core, 'dc:creator')).trim()
  }
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { style: 'Normal' } }] }, settings }
}
