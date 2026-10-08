// The PDF engine: everything that touches MuPDF. It runs inside the PDF worker
// (pdf.worker.ts), but takes the MuPDF module as a parameter and never touches
// the DOM, so it can also be exercised from Node in tests.
//
// Coordinates: MuPDF reports page geometry, text and annotations in the page's
// display space — PDF points, origin at the top-left of the (rotated) page,
// y going down. Everything here uses that space, and so do the apps.
//
// Editing model. Viewers (KherveRef…) just render: annotations stay in the
// document and MuPDF draws them. Editors (KhervePDF) call `detach()` once after
// opening: the editable annotations are taken out of the live document and
// handed to the app, which draws and edits them itself; `save({ annotations })`
// writes them back into a copy of the document. Annotations the user did not
// touch are put back as their original PDF objects, so nothing is lost.
// Structural edits (pages, forms, redaction, outline…) go into MuPDF's journal,
// one operation each, so they can be undone and redone.

import type * as MuPDF from 'mupdf'
import type {
  PdfAnnot, PdfAnnotKind, PdfExportImagesOptions, PdfFieldType, PdfLink, PdfMetadata, PdfOutlineItem, PdfPageInfo, PdfPoint,
  PdfRect, PdfSaveOptions, PdfSearchHit, PdfStampTextOptions, PdfTextEdit, PdfWidget, PdfWord,
} from './pdf'

type Mu = typeof MuPDF

/** Pixels straight out of MuPDF (RGBA, premultiplied onto white). The worker turns them into an ImageBitmap. */
export interface RawImage {
  kind: 'raw-image'
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export interface OpenResult {
  /** Set when the document is encrypted and the password is missing or wrong. */
  needsPassword?: boolean
  id: number
  pages: PdfPageInfo[]
  metadata: PdfMetadata
  encrypted: boolean
  hasForms: boolean
}

export interface HistoryResult {
  pages: PdfPageInfo[]
  canUndo: boolean
  canRedo: boolean
}

interface Original {
  sig: string
  popup: number | null
}

interface DocState {
  doc: MuPDF.PDFDocument
  password: string
  /** Recently used pages (LRU, most recent last). */
  pages: Map<number, MuPDF.PDFPage>
  /** Annotations taken out by detach(), by object number. */
  originals: Map<number, Original>
  journal: boolean
}

const PAGE_CACHE = 12
/** Annotation flags (PDF 32000 table 165). */
const HIDDEN = 2
const NO_VIEW = 32
/** Refuse to allocate absurd bitmaps (pixels). */
const MAX_PIXELS = 64_000_000
const HEX = /^#?([0-9a-f]{6})$/i

// ------------------------------------------------------------------ helpers

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn()
    return v === undefined || v === null ? fallback : v
  } catch {
    return fallback
  }
}

export function colorToHex(c: readonly number[] | null | undefined): string | null {
  if (!c || c.length === 0) return null
  let r: number, g: number, b: number
  if (c.length === 1) r = g = b = c[0]
  else if (c.length === 3) [r, g, b] = c
  else if (c.length === 4) {
    const [C, M, Y, K] = c
    r = (1 - C) * (1 - K)
    g = (1 - M) * (1 - K)
    b = (1 - Y) * (1 - K)
  } else return null
  return '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')
}

export function hexToRgb(hex: string | null | undefined, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const m = HEX.exec(hex ?? '')
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function quadBox(q: readonly number[]): PdfRect {
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function rectToQuad([x0, y0, x1, y1]: PdfRect): MuPDF.Quad {
  return [x0, y0, x1, y0, x0, y1, x1, y1]
}

function normRect([x0, y0, x1, y1]: readonly number[]): PdfRect {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * A fingerprint of everything the editor can change about an annotation.
 * An annotation whose fingerprint is unchanged at save time is written back
 * as its original PDF object.
 */
export function annotSig(a: PdfAnnot): string {
  return JSON.stringify([
    a.kind, (a.color ?? '').toLowerCase(), r2(a.opacity ?? 1), r2(a.width ?? 1), a.fill ? a.fill.toLowerCase() : null,
    a.rect ? a.rect.map(r2) : null,
    a.rects ? a.rects.map((r) => r.map(r2)) : null,
    a.strokes ? a.strokes.map((s) => s.map((p) => p.map(r2))) : null,
    a.line ? a.line.map((p) => p.map(r2)) : null,
    a.text ?? null, a.fontSize != null ? r2(a.fontSize) : null, a.font ?? null,
  ])
}

/** "D:20260710121449+01'00'" → ISO 8601 (the raw string if it doesn't parse). */
export function pdfDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(raw.trim())
  if (!m) return raw
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz] = m
  let zone = 'Z'
  if (tz && tz !== 'Z') zone = `${tz.slice(0, 3)}:${tz.slice(3).replace(/'/g, '').padEnd(2, '0').slice(0, 2)}`
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`
  return Number.isNaN(Date.parse(iso)) ? raw : new Date(iso).toISOString()
}

const MARKUP: Record<string, PdfAnnotKind> = {
  Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', Squiggly: 'squiggly',
}
const MARKUP_TYPE: Record<string, MuPDF.PDFAnnotationType> = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', squiggly: 'Squiggly',
}

/** The characters MuPDF's simple Latin fonts can show (WinAnsi), as a PDF literal string. */
function pdfLiteral(text: string): string {
  let out = '('
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (c >= 32 && c < 127) out += ch
    else if (c >= 160 && c < 256) out += '\\' + c.toString(8).padStart(3, '0')
    else out += '?'
  }
  return out + ')'
}

const fmtMatrix = (m: readonly number[]) => m.map((v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(5))).join(' ')

/** '#rrggbb' of a structured-text colour (RGB 0–1 components, or a packed integer). */
function colorHex(c: unknown): string {
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
  if (Array.isArray(c) && c.length >= 3) return '#' + c.slice(0, 3).map((v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')
  if (Array.isArray(c) && c.length === 1) return '#' + Array(3).fill(Math.round(clamp01(c[0]) * 255).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

/** The base-14 font for a short name ('Helv', 'TiRo', 'Cour') and a style. */
export function base14Name(font: string | undefined, bold = false, italic = false): string {
  if (font === 'TiRo') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman'
  if (font === 'Cour') return bold && italic ? 'Courier-BoldOblique' : bold ? 'Courier-Bold' : italic ? 'Courier-Oblique' : 'Courier'
  return bold && italic ? 'Helvetica-BoldOblique' : bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica'
}

/** Break text into lines no wider than `width` (paragraphs on '\n'; a word longer than a line stays whole). */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = para.split(/[ \t]+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (line && measure(next) > width) {
        out.push(line)
        line = w
      } else line = next
    }
    out.push(line)
  }
  return out
}

// ------------------------------------------------------------------- engine

export class PdfEngine {
  private mu: Mu
  private docs = new Map<number, DocState>()
  private nextId = 1

  constructor(mu: Mu) {
    this.mu = mu
  }

  // ------------------------------------------------------------ documents

  open(data: Uint8Array, password = ''): OpenResult {
    const doc = new this.mu.PDFDocument(data)
    let encrypted = false
    if (doc.needsPassword()) {
      encrypted = true
      if (!password || !doc.authenticatePassword(password)) {
        doc.destroy()
        return { needsPassword: true, id: 0, pages: [], metadata: {}, encrypted, hasForms: false }
      }
    } else {
      encrypted = safe(() => doc.getMetaData('encryption'), 'None') !== 'None'
    }
    const id = this.nextId++
    const d: DocState = { doc, password, pages: new Map(), originals: new Map(), journal: false }
    this.docs.set(id, d)
    return { id, pages: this.pagesInfo(d), metadata: this.metadata(d), encrypted, hasForms: this.hasForms(d) }
  }

  close(id: number) {
    const d = this.docs.get(id)
    if (!d) return
    this.dropPages(d)
    d.doc.destroy()
    this.docs.delete(id)
  }

  private get(id: number): DocState {
    const d = this.docs.get(id)
    if (!d) throw new Error('This PDF is no longer open.')
    return d
  }

  private page(d: DocState, index: number): MuPDF.PDFPage {
    const cached = d.pages.get(index)
    if (cached) {
      d.pages.delete(index)
      d.pages.set(index, cached)
      return cached
    }
    const n = d.doc.countPages()
    if (!(index >= 0 && index < n)) throw new RangeError(`There is no page ${index + 1} (the document has ${n}).`)
    const page = d.doc.loadPage(index)
    d.pages.set(index, page)
    while (d.pages.size > PAGE_CACHE) {
      const [oldest, p] = d.pages.entries().next().value as [number, MuPDF.PDFPage]
      d.pages.delete(oldest)
      p.destroy()
    }
    return page
  }

  private dropPages(d: DocState) {
    for (const p of d.pages.values()) p.destroy()
    d.pages.clear()
  }

  private pagesInfo(d: DocState): PdfPageInfo[] {
    const n = d.doc.countPages()
    const out: PdfPageInfo[] = []
    for (let i = 0; i < n; i++) {
      const cached = d.pages.get(i)
      const page = cached ?? d.doc.loadPage(i)
      try {
        const [x0, y0, x1, y1] = page.getBounds()
        const rot = safe(() => page.getObject().getInheritable('Rotate'), null)
        const rotation = rot && rot.isNumber() ? ((Math.round(rot.asNumber() / 90) * 90) % 360 + 360) % 360 : 0
        out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, rotation, label: safe(() => page.getLabel(), String(i + 1)) })
      } finally {
        if (!cached) page.destroy()
      }
    }
    return out
  }

  private metadata(d: DocState): PdfMetadata {
    const get = (k: string) => safe(() => d.doc.getMetaData(k), '') || undefined
    return {
      title: get('info:Title'),
      author: get('info:Author'),
      subject: get('info:Subject'),
      keywords: get('info:Keywords'),
      creator: get('info:Creator'),
      producer: get('info:Producer'),
      creationDate: pdfDate(get('info:CreationDate')),
    }
  }

  private hasForms(d: DocState): boolean {
    return safe(() => {
      const fields = d.doc.getTrailer().get('Root').get('AcroForm').get('Fields')
      return fields.isArray() && fields.length > 0
    }, false)
  }

  /** Run `fn` as one undoable step. */
  private op<T>(d: DocState, name: string, fn: () => T): T {
    if (!d.journal) {
      d.doc.enableJournal()
      d.journal = true
    }
    d.doc.beginOperation(name)
    try {
      const r = fn()
      d.doc.endOperation()
      return r
    } catch (e) {
      try {
        d.doc.abandonOperation()
      } catch {
        /* the operation may already be closed */
      }
      throw e
    } finally {
      this.dropPages(d)
    }
  }

  info(id: number): { pages: PdfPageInfo[]; metadata: PdfMetadata; hasForms: boolean } {
    const d = this.get(id)
    return { pages: this.pagesInfo(d), metadata: this.metadata(d), hasForms: this.hasForms(d) }
  }

  // ------------------------------------------------------------ rendering

  /** Render a page (or `clip`, a part of it in page points) at `scale` device pixels per point. */
  render(id: number, index: number, scale: number, clip: PdfRect | null = null, extras = true): RawImage {
    const d = this.get(id)
    const page = this.page(d, index)
    const area = clip ?? (page.getBounds() as PdfRect)
    const bbox: MuPDF.Rect = [
      Math.floor(area[0] * scale), Math.floor(area[1] * scale), Math.ceil(area[2] * scale), Math.ceil(area[3] * scale),
    ]
    const w = bbox[2] - bbox[0]
    const h = bbox[3] - bbox[1]
    if (w < 1 || h < 1) throw new RangeError('Nothing to render.')
    if (w * h > MAX_PIXELS) throw new RangeError('The page is too large to render at this zoom.')
    const pix = new this.mu.Pixmap(this.mu.ColorSpace.DeviceRGB, bbox, true)
    try {
      pix.clear(255) // opaque white paper
      const dev = new this.mu.DrawDevice(this.mu.Matrix.identity, pix)
      try {
        const m = this.mu.Matrix.scale(scale, scale)
        if (extras) page.run(dev, m)
        else page.runPageContents(dev, m)
        dev.close()
      } catch (e) {
        // A broken content stream: show what was drawn so far.
        console.warn('[pdf] render', e)
      } finally {
        dev.destroy()
      }
      return { kind: 'raw-image', width: pix.getWidth(), height: pix.getHeight(), pixels: this.copyPixels(pix) }
    } finally {
      pix.destroy()
    }
  }

  private copyPixels(pix: MuPDF.Pixmap): Uint8ClampedArray {
    const w = pix.getWidth()
    const h = pix.getHeight()
    const stride = pix.getStride()
    const src = pix.getPixels()
    if (stride === w * 4) return new Uint8ClampedArray(src)
    const out = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) out.set(src.subarray(y * stride, y * stride + w * 4), y * w * 4)
    return out
  }

  /** PNG or JPEG of whole pages, with `annotations` drawn in. */
  exportImages(id: number, pages: number[], options: PdfExportImagesOptions = {}): Uint8Array[] {
    const d = this.get(id)
    const tmp = options.annotations ? this.bakedCopy(d, options.annotations) : null
    const doc = tmp ?? d.doc
    const scale = (options.dpi ?? 150) / 72
    const out: Uint8Array[] = []
    try {
      for (const i of pages) {
        const page = doc.loadPage(i)
        try {
          const area = (options.clip ?? page.getBounds()) as PdfRect
          const bbox: MuPDF.Rect = [
            Math.floor(area[0] * scale), Math.floor(area[1] * scale), Math.ceil(area[2] * scale), Math.ceil(area[3] * scale),
          ]
          if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > MAX_PIXELS) throw new RangeError('Image too large; choose a lower resolution.')
          const pix = new this.mu.Pixmap(this.mu.ColorSpace.DeviceRGB, bbox, false)
          try {
            pix.clear(255)
            const dev = new this.mu.DrawDevice(this.mu.Matrix.identity, pix)
            try {
              page.run(dev, this.mu.Matrix.scale(scale, scale))
              dev.close()
            } finally {
              dev.destroy()
            }
            out.push(options.format === 'jpeg' ? new Uint8Array(pix.asJPEG(options.quality ?? 90)) : new Uint8Array(pix.asPNG()))
          } finally {
            pix.destroy()
          }
        } finally {
          page.destroy()
        }
      }
    } finally {
      tmp?.destroy()
    }
    return out
  }

  // ----------------------------------------------------------------- text

  text(id: number, index: number): string {
    const st = this.page(this.get(id), index).toStructuredText('preserve-whitespace')
    try {
      return st.asText()
    } finally {
      st.destroy()
    }
  }

  /** The words of a page in reading order, with their boxes. */
  words(id: number, index: number): PdfWord[] {
    const st = this.page(this.get(id), index).toStructuredText('preserve-whitespace')
    const words: PdfWord[] = []
    let line = -1
    let block = -1
    let cur: PdfWord | null = null
    try {
      st.walk({
        beginTextBlock() {
          block++
        },
        beginLine() {
          line++
          cur = null
        },
        endLine() {
          cur = null
        },
        onChar(c, _origin, font, size, q, color) {
          if (!c.trim()) {
            cur = null
            return
          }
          const [x0, y0, x1, y1] = quadBox(q)
          if (!cur) {
            cur = { text: c, rect: [x0, y0, x1, y1], line, block, size, font: safe(() => font.getName(), ''), color: colorHex(color) }
            words.push(cur)
          } else {
            cur.text += c
            const r = cur.rect
            r[0] = Math.min(r[0], x0)
            r[1] = Math.min(r[1], y0)
            r[2] = Math.max(r[2], x1)
            r[3] = Math.max(r[3], y1)
          }
        },
      })
    } finally {
      st.destroy()
    }
    return words
  }

  search(id: number, needle: string, maxHits = 5000): PdfSearchHit[] {
    const d = this.get(id)
    const hits: PdfSearchHit[] = []
    if (!needle.trim()) return hits
    const n = d.doc.countPages()
    for (let i = 0; i < n && hits.length < maxHits; i++) {
      const page = d.pages.get(i) ?? d.doc.loadPage(i)
      try {
        for (const quads of page.search(needle, 'ignore-case') ?? []) {
          hits.push({
            page: i,
            rects: quads.map((q) => {
              const [x0, y0, x1, y1] = quadBox(q)
              return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
            }),
          })
          if (hits.length >= maxHits) break
        }
      } finally {
        if (!d.pages.has(i)) page.destroy()
      }
    }
    return hits
  }

  links(id: number, index: number): PdfLink[] {
    const d = this.get(id)
    const out: PdfLink[] = []
    for (const link of this.page(d, index).getLinks()) {
      try {
        const uri = link.getURI()
        const item: PdfLink = { rect: link.getBounds() as PdfRect, uri }
        if (!link.isExternal()) {
          const p = safe(() => d.doc.resolveLink(link), -1)
          if (p >= 0) item.page = p
        }
        out.push(item)
      } finally {
        link.destroy()
      }
    }
    return out
  }

  // -------------------------------------------------------------- outline

  outline(id: number): PdfOutlineItem[] {
    const d = this.get(id)
    type Item = { title?: string; uri?: string; open: boolean; page?: number; down?: Item[] }
    const map = (items: Item[]): PdfOutlineItem[] =>
      items.map((it) => {
        let page = typeof it.page === 'number' && it.page >= 0 ? it.page : null
        if (page === null && it.uri && it.uri.startsWith('#')) page = safe(() => d.doc.resolveLink(it.uri!), -1)
        const out: PdfOutlineItem = { title: it.title ?? '', page: page !== null && page >= 0 ? page : null, open: it.open }
        if (it.uri) out.uri = it.uri
        if (it.down?.length) out.children = map(it.down)
        return out
      })
    return map((safe(() => d.doc.loadOutline(), null) ?? []) as Item[])
  }

  /** Replace the whole outline (bookmarks). One undoable step. */
  setOutline(id: number, items: PdfOutlineItem[]): void {
    const d = this.get(id)
    this.op(d, 'Edit bookmarks', () => {
      const it = d.doc.outlineIterator()
      try {
        let guard = 0
        while (it.item() && guard++ < 100_000) it.delete()
        const insert = (list: PdfOutlineItem[]) => {
          for (const item of list) {
            const uri = item.page !== null && item.page >= 0 ? `#page=${item.page + 1}` : item.uri
            it.insert({ title: item.title, uri, open: item.open ?? false })
            if (item.children?.length) {
              it.prev()
              it.down()
              insert(item.children)
              it.up()
              it.next()
            }
          }
        }
        insert(items)
      } finally {
        it.destroy()
      }
    })
  }

  /**
   * A table of contents guessed from the text when the PDF has none: lines set
   * noticeably larger than the body text become headings (ported from KhervePDF).
   */
  headings(id: number, maxPages = 150): PdfOutlineItem[] {
    const d = this.get(id)
    const n = Math.min(d.doc.countPages(), maxPages)
    const chars = new Map<number, number>()
    const lines: { page: number; size: number; text: string }[] = []
    type JLine = { text?: string; font?: { size?: number } }
    type JBlock = { type?: string; lines?: JLine[] }
    for (let i = 0; i < n; i++) {
      const page = d.pages.get(i) ?? d.doc.loadPage(i)
      try {
        const st = page.toStructuredText('preserve-whitespace')
        try {
          const json = JSON.parse(st.asJSON()) as { blocks?: JBlock[] }
          for (const b of json.blocks ?? []) {
            if (b.type !== 'text') continue
            for (const l of b.lines ?? []) {
              const text = (l.text ?? '').trim()
              const size = Math.round((l.font?.size ?? 0) * 10) / 10
              if (text.length < 3 || !size) continue
              chars.set(size, (chars.get(size) ?? 0) + text.length)
              lines.push({ page: i, size, text })
            }
          }
        } finally {
          st.destroy()
        }
      } catch {
        /* skip unreadable pages */
      } finally {
        if (!d.pages.has(i)) page.destroy()
      }
    }
    if (!lines.length) return []
    let body = 0
    let most = -1
    for (const [size, count] of chars) if (count > most) [body, most] = [size, count]
    const heads = lines.filter((l) => l.size > body * 1.2 && l.text.length <= 200).slice(0, 500)
    const sizes = [...new Set(heads.map((h) => h.size))].sort((a, b) => b - a)
    const level = (s: number) => Math.min(6, sizes.indexOf(s) + 1)
    const root: PdfOutlineItem[] = []
    const stack: { level: number; item: PdfOutlineItem }[] = []
    for (const h of heads) {
      const lv = level(h.size)
      const item: PdfOutlineItem = { title: h.text, page: h.page, open: lv < 2 }
      while (stack.length && stack[stack.length - 1].level >= lv) stack.pop()
      const parent = stack[stack.length - 1]?.item
      if (parent) (parent.children ??= []).push(item)
      else root.push(item)
      stack.push({ level: lv, item })
    }
    return root
  }

  // ---------------------------------------------------------- annotations

  private readAnnot(a: MuPDF.PDFAnnotation, page: number): PdfAnnot | null {
    const type = safe(() => a.getType(), 'Unknown' as MuPDF.PDFAnnotationType)
    const num = safe(() => a.getObject().asIndirect(), 0)
    const base = {
      id: `pdf:${num}`,
      page,
      orig: num || undefined,
      color: colorToHex(safe(() => a.getColor(), [] as MuPDF.AnnotColor)) ?? '#000000',
      opacity: r2(safe(() => a.getOpacity(), 1)),
      width: safe(() => (a.hasBorder() ? a.getBorderWidth() : 1), 1),
      author: safe(() => (a.hasAuthor() ? a.getAuthor() : ''), '') || undefined,
    }
    switch (type) {
      case 'Ink': {
        const strokes = safe(() => a.getInkList(), [] as MuPDF.Point[][]).filter((s) => s.length > 0) as PdfPoint[][]
        return strokes.length ? { ...base, kind: 'ink', strokes } : null
      }
      case 'Highlight':
      case 'Underline':
      case 'StrikeOut':
      case 'Squiggly': {
        let rects = safe(() => a.getQuadPoints(), [] as MuPDF.Quad[]).map(quadBox)
        if (!rects.length) rects = [normRect(a.getBounds())]
        return { ...base, kind: MARKUP[type], rects, color: base.color === '#000000' && type === 'Highlight' ? '#ffff00' : base.color }
      }
      case 'Square':
      case 'Circle': {
        const fill = safe(() => (a.hasInteriorColor() ? colorToHex(a.getInteriorColor()) : null), null)
        return { ...base, kind: type === 'Square' ? 'rect' : 'ellipse', rect: normRect(a.getRect()), fill }
      }
      case 'Line': {
        const [p, q] = a.getLine() as [PdfPoint, PdfPoint]
        const ends = safe(() => (a.hasLineEndingStyles() ? a.getLineEndingStyles() : null), null)
        const arrowAt = (s: string | undefined) => !!s && /Arrow/.test(s)
        const startArrow = arrowAt(ends?.start)
        const endArrow = arrowAt(ends?.end)
        if (startArrow && !endArrow) return { ...base, kind: 'arrow', line: [q, p] }
        return { ...base, kind: endArrow ? 'arrow' : 'line', line: [p, q] }
      }
      case 'Text':
        return { ...base, kind: 'note', rect: normRect(a.getRect()), text: safe(() => a.getContents(), ''), color: colorToHex(safe(() => a.getColor(), [] as MuPDF.AnnotColor)) ?? '#ffff00' }
      case 'FreeText': {
        const da = safe(() => a.getDefaultAppearance(), { font: 'Helv', size: 12, color: [0] as MuPDF.AnnotColor })
        return {
          ...base,
          kind: 'text',
          rect: normRect(a.getRect()),
          text: safe(() => a.getContents(), ''),
          fontSize: da.size || 12,
          font: da.font || 'Helv',
          color: colorToHex(da.color) ?? '#000000',
          width: 0,
        }
      }
      case 'Redact':
        return { ...base, kind: 'redact', rect: normRect(safe(() => a.getRect(), a.getBounds())), color: '#ff0000' }
      default:
        return null
    }
  }

  /** The annotations in the document (all pages, or one), without changing anything. */
  annotations(id: number, index: number | null = null): PdfAnnot[] {
    const d = this.get(id)
    const out: PdfAnnot[] = []
    const pages = index === null ? [...Array(d.doc.countPages()).keys()] : [index]
    for (const i of pages) {
      for (const a of this.page(d, i).getAnnotations()) {
        const m = safe(() => this.readAnnot(a, i), null)
        if (m) out.push(m)
      }
    }
    return out
  }

  /**
   * Take the editable annotations out of the document (all pages, or `pages`)
   * and return them. The caller now owns them; pass them to save().
   */
  detach(id: number, pages: number[] | null = null): PdfAnnot[] {
    const d = this.get(id)
    const run = () => this.detachPages(d, pages ?? [...Array(d.doc.countPages()).keys()])
    // Before the first edit there is no journal yet, so the detach is not an undoable step.
    return d.journal ? this.op(d, 'Detach annotations', run) : run()
  }

  private detachPages(d: DocState, pages: number[]): PdfAnnot[] {
    const out: PdfAnnot[] = []
    for (const i of pages) {
      const page = d.doc.loadPage(i)
      try {
        for (const a of page.getAnnotations().slice()) {
          try {
            // Hidden annotations stay as they are: MuPDF does not draw them, so neither should the editor.
            if (safe(() => a.getFlags(), 0) & (HIDDEN | NO_VIEW)) continue
            const m = this.readAnnot(a, i)
            if (!m || !m.orig) continue
            // MuPDF lists no Popup annotations, but removes a note's popup with it: remember it.
            const popup = safe(() => a.getObject().get('Popup'), null)
            d.originals.set(m.orig, { sig: annotSig(m), popup: popup && popup.isIndirect() ? popup.asIndirect() : null })
            page.deleteAnnotation(a)
            out.push(m)
          } catch (e) {
            console.warn('[pdf] left an annotation in place', e)
          }
        }
      } finally {
        page.destroy()
      }
    }
    this.dropPages(d)
    return out
  }

  /** Add annotations to the live document (viewers that edit in place). One undoable step. */
  addAnnotations(id: number, annots: PdfAnnot[]): PdfAnnot[] {
    const d = this.get(id)
    return this.op(d, 'Add annotations', () => {
      const out: PdfAnnot[] = []
      for (const a of annots) {
        const page = d.doc.loadPage(a.page)
        try {
          const created = this.createAnnot(page, a)
          if (created) {
            const num = created.getObject().asIndirect()
            out.push({ ...a, id: `pdf:${num}`, orig: undefined })
          }
        } finally {
          page.destroy()
        }
      }
      return out
    })
  }

  /** Delete annotations from the live document by id ("pdf:<object number>"). One undoable step. */
  removeAnnotations(id: number, ids: string[]): void {
    const d = this.get(id)
    const wanted = new Set(ids)
    this.op(d, 'Delete annotations', () => {
      const n = d.doc.countPages()
      for (let i = 0; i < n; i++) {
        const page = d.doc.loadPage(i)
        try {
          for (const a of page.getAnnotations().slice()) {
            if (wanted.has(`pdf:${safe(() => a.getObject().asIndirect(), 0)}`)) page.deleteAnnotation(a)
          }
        } finally {
          page.destroy()
        }
      }
    })
  }

  private createAnnot(page: MuPDF.PDFPage, a: PdfAnnot): MuPDF.PDFAnnotation | null {
    const rgb = hexToRgb(a.color)
    const opacity = clamp01(a.opacity ?? 1)
    const width = Math.max(0, a.width ?? 1)
    let annot: MuPDF.PDFAnnotation
    switch (a.kind) {
      case 'ink': {
        if (!a.strokes?.length) return null
        annot = page.createAnnotation('Ink')
        annot.setInkList(a.strokes)
        annot.setColor(rgb)
        annot.setBorderWidth(Math.max(0.25, width))
        break
      }
      case 'highlight':
      case 'underline':
      case 'strikeout':
      case 'squiggly': {
        const rects = a.rects?.length ? a.rects : a.rect ? [a.rect] : []
        if (!rects.length) return null
        annot = page.createAnnotation(MARKUP_TYPE[a.kind])
        annot.setQuadPoints(rects.map((r) => rectToQuad(normRect(r))))
        annot.setColor(rgb)
        break
      }
      case 'rect':
      case 'ellipse': {
        if (!a.rect) return null
        annot = page.createAnnotation(a.kind === 'rect' ? 'Square' : 'Circle')
        annot.setRect(normRect(a.rect))
        annot.setColor(rgb)
        annot.setBorderWidth(width)
        if (a.fill) annot.setInteriorColor(hexToRgb(a.fill))
        break
      }
      case 'line':
      case 'arrow': {
        if (!a.line) return null
        annot = page.createAnnotation('Line')
        annot.setLine(a.line[0], a.line[1])
        if (a.kind === 'arrow') annot.setLineEndingStyles('None', 'OpenArrow')
        annot.setColor(rgb)
        annot.setBorderWidth(Math.max(0.25, width))
        break
      }
      case 'note': {
        if (!a.rect) return null
        annot = page.createAnnotation('Text')
        const [x, y] = a.rect
        annot.setRect([x, y, x + 20, y + 20])
        annot.setContents(a.text ?? '')
        annot.setColor(rgb)
        break
      }
      case 'text': {
        if (!a.rect) return null
        annot = page.createAnnotation('FreeText')
        annot.setRect(normRect(a.rect))
        annot.setContents(a.text ?? '')
        annot.setDefaultAppearance(a.font || 'Helv', a.fontSize || 12, rgb)
        annot.setBorderWidth(0)
        break
      }
      case 'redact': {
        if (!a.rect) return null
        annot = page.createAnnotation('Redact')
        annot.setRect(normRect(a.rect))
        break
      }
      case 'image': {
        if (!a.rect || !a.image) return null
        annot = page.createAnnotation('Stamp')
        annot.setRect(normRect(a.rect))
        const img = new this.mu.Image(a.image)
        try {
          annot.setStampImage(img)
        } finally {
          img.destroy()
        }
        break
      }
      default:
        return null
    }
    if (opacity < 1) annot.setOpacity(opacity)
    if (a.author) safe(() => annot.setAuthor(a.author!), undefined)
    annot.update()
    return annot
  }

  /** A copy of the document (as a new MuPDF document) with `annots` written in. */
  private bakedCopy(d: DocState, annots: PdfAnnot[]): MuPDF.PDFDocument {
    const snap = d.doc.saveToBuffer('')
    let tmp: MuPDF.PDFDocument
    try {
      tmp = new this.mu.PDFDocument(snap.asUint8Array())
    } finally {
      snap.destroy()
    }
    if (tmp.needsPassword()) tmp.authenticatePassword(d.password)
    try {
      this.bake(tmp, annots, d.originals)
    } catch (e) {
      tmp.destroy()
      throw e
    }
    return tmp
  }

  private bake(doc: MuPDF.PDFDocument, annots: PdfAnnot[], originals: Map<number, Original>) {
    const n = doc.countPages()
    const pages = new Map<number, MuPDF.PDFPage>()
    const pageAt = (i: number) => {
      let p = pages.get(i)
      if (!p) pages.set(i, (p = doc.loadPage(i)))
      return p
    }
    const images: PdfAnnot[] = []
    try {
      for (const a of annots) {
        if (!(a.page >= 0 && a.page < n)) continue
        if (a.kind === 'image') {
          images.push(a)
          continue
        }
        const page = pageAt(a.page)
        if (a.orig && this.reinsert(doc, page, a, originals)) continue
        try {
          this.createAnnot(page, a)
        } catch (e) {
          console.warn('[pdf] could not write annotation', a.kind, e)
        }
      }
      // Pictures and signatures become part of the page, like the desktop KhervePDF does.
      for (const a of images) {
        try {
          this.stampImage(doc, pageAt(a.page), a.rect!, a.image!)
        } catch (e) {
          console.warn('[pdf] could not stamp image', e)
        }
      }
    } finally {
      for (const p of pages.values()) p.destroy()
    }
  }

  /** Put an untouched original annotation object back on its page. */
  private reinsert(doc: MuPDF.PDFDocument, page: MuPDF.PDFPage, a: PdfAnnot, originals: Map<number, Original>): boolean {
    const o = originals.get(a.orig!)
    if (!o || o.sig !== annotSig(a)) return false
    return safe(() => {
      const ref = doc.newIndirect(a.orig!)
      const dict = ref.resolve()
      if (!dict.isDictionary()) return false
      const pageObj = page.getObject()
      const P = dict.get('P')
      if (P.isIndirect() && P.asIndirect() !== pageObj.asIndirect()) return false
      let arr = pageObj.get('Annots')
      if (!arr.isArray()) arr = pageObj.put('Annots', doc.newArray())
      arr.push(ref)
      if (o.popup) arr.push(doc.newIndirect(o.popup))
      return true
    }, false)
  }

  // ------------------------------------------------------- page content

  private ownResources(doc: MuPDF.PDFDocument, pageObj: MuPDF.PDFObject): MuPDF.PDFObject {
    let res = pageObj.get('Resources')
    if (!res.isDictionary()) {
      const inherited = pageObj.getInheritable('Resources')
      res = doc.newDictionary()
      if (inherited.isDictionary()) inherited.forEach((v, k) => res.put(k, v))
      pageObj.put('Resources', res)
    }
    return res
  }

  private subDict(doc: MuPDF.PDFDocument, dict: MuPDF.PDFObject, key: string): MuPDF.PDFObject {
    const v = dict.get(key)
    return v.isDictionary() ? v : dict.put(key, doc.newDictionary())
  }

  private freeName(dict: MuPDF.PDFObject, prefix: string): string {
    for (let i = 1; ; i++) if (dict.get(prefix + i).isNull()) return prefix + i
  }

  /** Append drawing commands to a page, isolated from its existing content. */
  private appendContent(doc: MuPDF.PDFDocument, pageObj: MuPDF.PDFObject, ops: string) {
    const contents = pageObj.get('Contents')
    const arr = doc.newArray()
    arr.push(doc.addStream('q\n', {}))
    if (contents.isArray()) contents.forEach((v) => arr.push(v))
    else if (!contents.isNull()) arr.push(contents)
    arr.push(doc.addStream('\nQ\n' + ops, {}))
    pageObj.put('Contents', arr)
  }

  private stampImage(doc: MuPDF.PDFDocument, page: MuPDF.PDFPage, rect: PdfRect, bytes: Uint8Array) {
    const img = new this.mu.Image(bytes)
    try {
      const pageObj = page.getObject()
      const xobjects = this.subDict(doc, this.ownResources(doc, pageObj), 'XObject')
      const name = this.freeName(xobjects, 'KhvImg')
      xobjects.put(name, doc.addImage(img))
      // Fit inside the rectangle, keeping the picture's proportions.
      let [x0, y0, x1, y1] = normRect(rect)
      const iw = img.getWidth()
      const ih = img.getHeight()
      if (iw > 0 && ih > 0) {
        const k = Math.min((x1 - x0) / iw, (y1 - y0) / ih)
        const w = iw * k
        const h = ih * k
        x0 += ((x1 - x0) - w) / 2
        y0 += ((y1 - y0) - h) / 2
        x1 = x0 + w
        y1 = y0 + h
      }
      const m = this.mu.Matrix.concat([x1 - x0, 0, 0, -(y1 - y0), x0, y1], this.mu.Matrix.invert(page.getTransform()))
      this.appendContent(doc, pageObj, `q ${fmtMatrix(m)} cm /${name} Do Q\n`)
    } finally {
      img.destroy()
    }
  }

  /** Write text onto pages (watermarks, page numbers). One undoable step. */
  stampText(id: number, o: PdfStampTextOptions): PdfPageInfo[] {
    const d = this.get(id)
    const n = d.doc.countPages()
    const pages = (o.pages ?? [...Array(n).keys()]).filter((i) => i >= 0 && i < n)
    this.op(d, o.position === 'diagonal' ? 'Watermark' : 'Page numbers', () => {
      const font = new this.mu.Font('Helvetica')
      try {
        const fontRef = d.doc.addSimpleFont(font, 'Latin')
        const size = Math.max(1, o.size ?? 12)
        const [r, g, b] = hexToRgb(o.color, [0.4, 0.4, 0.4])
        const opacity = clamp01(o.opacity ?? 1)
        let gsRef: MuPDF.PDFObject | null = null
        if (opacity < 1) {
          const gs = d.doc.newDictionary()
          gs.put('Type', d.doc.newName('ExtGState'))
          gs.put('ca', opacity)
          gs.put('CA', opacity)
          gsRef = d.doc.addObject(gs)
        }
        for (const i of pages) {
          const page = d.doc.loadPage(i)
          try {
            const text = (o.text ?? '').replace(/\{n\}/g, String(i + 1)).replace(/\{total\}/g, String(n))
            if (!text) continue
            let w = 0
            for (const ch of text) w += safe(() => font.advanceGlyph(font.encodeCharacter(ch), 0), 0.5) * size
            const [bx0, by0, bx1, by1] = page.getBounds()
            const cx = (bx0 + bx1) / 2
            const margin = o.margin ?? 24
            let tm: number[]
            if (o.position === 'diagonal') {
              const angle = Math.atan2(by1 - by0, bx1 - bx0)
              const c = Math.cos(angle)
              const s = Math.sin(angle)
              const cy = (by0 + by1) / 2
              const X = cx - (w / 2) * c + 0.35 * size * s
              const Y = cy + (w / 2) * s + 0.35 * size * c
              tm = [c, -s, -s, -c, X, Y]
            } else if (o.position === 'top') {
              tm = [1, 0, 0, -1, cx - w / 2, by0 + margin + size * 0.75]
            } else {
              tm = [1, 0, 0, -1, cx - w / 2, by1 - margin]
            }
            const m = this.mu.Matrix.concat(tm as MuPDF.Matrix, this.mu.Matrix.invert(page.getTransform()))
            const pageObj = page.getObject()
            const res = this.ownResources(d.doc, pageObj)
            const fonts = this.subDict(d.doc, res, 'Font')
            const fname = this.freeName(fonts, 'KhvF')
            fonts.put(fname, fontRef)
            let gsOp = ''
            if (gsRef) {
              const states = this.subDict(d.doc, res, 'ExtGState')
              const gname = this.freeName(states, 'KhvGS')
              states.put(gname, gsRef)
              gsOp = `/${gname} gs `
            }
            this.appendContent(
              d.doc, pageObj,
              `q ${gsOp}${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg BT /${fname} ${size} Tf ${fmtMatrix(m)} Tm ${pdfLiteral(text)} Tj ET Q\n`,
            )
          } finally {
            page.destroy()
          }
        }
      } finally {
        font.destroy()
      }
    })
    return this.pagesInfo(d)
  }

  // ---------------------------------------------------------------- saving

  private saveOptions(o: PdfSaveOptions): string {
    const opts = [o.compact ? 'garbage=deduplicate' : 'garbage=compact', 'compress=yes']
    if (o.compact) opts.push('compress-fonts=yes', 'compress-images=yes', 'objstms=yes')
    if (o.encrypt) {
      const { userPassword = '', ownerPassword = '' } = o.encrypt
      if (/,/.test(userPassword + ownerPassword)) throw new Error('Passwords cannot contain commas.')
      if (!userPassword && !ownerPassword) opts.push('encrypt=none')
      else {
        opts.push('encrypt=aes-256')
        if (userPassword) opts.push(`user-password=${userPassword}`)
        opts.push(`owner-password=${ownerPassword || userPassword}`)
      }
    }
    return opts.join(',')
  }

  private bytes(buf: MuPDF.Buffer): Uint8Array {
    try {
      return new Uint8Array(buf.asUint8Array())
    } finally {
      buf.destroy()
    }
  }

  /** The document as PDF bytes. With `annotations`, those are written in (the live document is not changed). */
  save(id: number, o: PdfSaveOptions = {}): Uint8Array {
    const d = this.get(id)
    const opts = this.saveOptions(o)
    if (!o.annotations) return this.bytes(d.doc.saveToBuffer(opts))
    const tmp = this.bakedCopy(d, o.annotations)
    try {
      return this.bytes(tmp.saveToBuffer(opts))
    } finally {
      tmp.destroy()
    }
  }

  setMetadata(id: number, meta: PdfMetadata): PdfMetadata {
    const d = this.get(id)
    this.op(d, 'Document properties', () => {
      const keys: [keyof PdfMetadata, string][] = [
        ['title', 'info:Title'], ['author', 'info:Author'], ['subject', 'info:Subject'], ['keywords', 'info:Keywords'],
        ['creator', 'info:Creator'], ['producer', 'info:Producer'],
      ]
      for (const [k, key] of keys) if (meta[k] !== undefined) d.doc.setMetaData(key, meta[k] ?? '')
    })
    return this.metadata(d)
  }

  // ----------------------------------------------------------------- pages

  insertBlankPage(id: number, at: number, width = 595.28, height = 841.89): PdfPageInfo[] {
    const d = this.get(id)
    this.op(d, 'Insert page', () => {
      const obj = d.doc.addPage([0, 0, width, height], 0, {}, '')
      d.doc.insertPage(Math.max(0, Math.min(at, d.doc.countPages())), obj)
    })
    return this.pagesInfo(d)
  }

  deletePages(id: number, pages: number[]): PdfPageInfo[] {
    const d = this.get(id)
    const n = d.doc.countPages()
    const doomed = [...new Set(pages)].filter((i) => i >= 0 && i < n).sort((a, b) => b - a)
    if (doomed.length >= n) throw new Error('A PDF needs at least one page.')
    this.op(d, 'Delete pages', () => {
      for (const i of doomed) d.doc.deletePage(i)
    })
    return this.pagesInfo(d)
  }

  rotatePages(id: number, pages: number[], delta: number): PdfPageInfo[] {
    const d = this.get(id)
    this.op(d, 'Rotate pages', () => {
      for (const i of new Set(pages)) {
        const page = d.doc.loadPage(i)
        try {
          const obj = page.getObject()
          const cur = obj.getInheritable('Rotate')
          const now = cur.isNumber() ? cur.asNumber() : 0
          obj.put('Rotate', (((Math.round((now + delta) / 90) * 90) % 360) + 360) % 360)
        } finally {
          page.destroy()
        }
      }
    })
    return this.pagesInfo(d)
  }

  /** New page order: `order[i]` is the old index of the page that ends up at i. */
  rearrangePages(id: number, order: number[]): PdfPageInfo[] {
    const d = this.get(id)
    const n = d.doc.countPages()
    if (order.length !== n || new Set(order).size !== n || order.some((i) => !(i >= 0 && i < n))) {
      throw new Error('Not a reordering of the pages.')
    }
    this.op(d, 'Reorder pages', () => d.doc.rearrangePages(order))
    return this.pagesInfo(d)
  }

  /** Insert all pages of another PDF at `at` (-1 = the end). With `detach`, its annotations are handed back. */
  insertPdf(id: number, data: Uint8Array, at: number, password = '', detach = false): { pages: PdfPageInfo[]; count: number; annotations: PdfAnnot[] } | { needsPassword: true } {
    const d = this.get(id)
    const src = new this.mu.PDFDocument(data)
    try {
      if (src.needsPassword() && (!password || !src.authenticatePassword(password))) return { needsPassword: true }
      const count = src.countPages()
      const n = d.doc.countPages()
      const start = at < 0 || at > n ? n : at
      let annotations: PdfAnnot[] = []
      this.op(d, 'Insert PDF', () => {
        this.graftPages(d.doc, src, [...Array(count).keys()], start)
        if (detach) annotations = this.detachPages(d, [...Array(count).keys()].map((i) => start + i))
      })
      return { pages: this.pagesInfo(d), count, annotations }
    } finally {
      src.destroy()
    }
  }

  /**
   * Copy pages from `src` into `dst` at `at`, with their annotations and links
   * (MuPDF's graftPage leaves those behind). Links to pages that are not copied
   * are dropped; form fields are not copied.
   */
  private graftPages(dst: MuPDF.PDFDocument, src: MuPDF.PDFDocument, pages: number[], at: number) {
    const map = dst.newGraftMap()
    try {
      pages.forEach((p, k) => map.graftPage(at + k, src, p))
      const pageMap = new Map<number, MuPDF.PDFObject>()
      pages.forEach((p, k) => pageMap.set(src.findPage(p).asIndirect(), dst.findPage(at + k)))
      pages.forEach((p, k) => this.copyAnnots(dst, map, src.findPage(p), dst.findPage(at + k), pageMap))
    } finally {
      map.destroy()
    }
  }

  private copyAnnots(dst: MuPDF.PDFDocument, map: MuPDF.PDFGraftMap, srcPage: MuPDF.PDFObject, dstPage: MuPDF.PDFObject, pageMap: Map<number, MuPDF.PDFObject>) {
    const annots = srcPage.get('Annots')
    if (!annots.isArray()) return
    const copies: MuPDF.PDFObject[] = []
    annots.forEach((ref) => {
      try {
        const a = ref.resolve()
        if (!a.isDictionary()) return
        const sub = a.get('Subtype')
        const subtype = sub.isName() ? sub.asName() : ''
        if (subtype === 'Popup' || subtype === 'Widget') return
        // A destination is [page /Fit…]: point it at the copied page, or drop the link.
        let dest: MuPDF.PDFObject | null = null
        let action: MuPDF.PDFObject | null = a.get('A')
        const rawDest = a.get('Dest')
        const goTo = action.isDictionary() && action.get('S').isName() && action.get('S').asName() === 'GoTo' ? action.get('D') : null
        const target = rawDest.isArray() ? rawDest : goTo && goTo.isArray() ? goTo : null
        if (target) {
          const first = target.get(0)
          if (first.isIndirect()) {
            const mapped = pageMap.get(first.asIndirect())
            if (!mapped) return
            dest = dst.newArray()
            dest.push(mapped)
            for (let i = 1; i < target.length; i++) dest.push(map.graftObject(target.get(i)))
            if (goTo) action = null
          }
        } else if (!rawDest.isNull()) {
          dest = map.graftObject(rawDest)
        }
        const copy = dst.newDictionary()
        a.forEach((v, k) => {
          if (k === 'P' || k === 'Popup' || k === 'Parent' || k === 'IRT' || k === 'StructParent' || k === 'Dest' || k === 'A') return
          copy.put(k, map.graftObject(v))
        })
        if (dest) copy.put('Dest', dest)
        if (action && !action.isNull()) copy.put('A', map.graftObject(action))
        copy.put('P', dstPage)
        copies.push(dst.addObject(copy))
      } catch (e) {
        console.warn('[pdf] could not copy an annotation', e)
      }
    })
    if (!copies.length) return
    let out = dstPage.get('Annots')
    if (!out.isArray()) out = dstPage.put('Annots', dst.newArray())
    for (const c of copies) out.push(c)
  }

  /** New PDFs made of some pages: one PDF per group. With `annotations`, those are written in first. */
  extractPages(id: number, groups: number[][], annotations: PdfAnnot[] | null = null): Uint8Array[] {
    const d = this.get(id)
    const source = annotations ? this.bakedCopy(d, annotations) : d.doc
    try {
      const n = source.countPages()
      return groups.map((group) => {
        const out = new this.mu.PDFDocument()
        try {
          const pages = group.filter((i) => i >= 0 && i < n)
          if (!pages.length) throw new Error('No pages to extract.')
          this.graftPages(out, source, pages, 0)
          return this.bytes(out.saveToBuffer('garbage=compact,compress=yes'))
        } finally {
          out.destroy()
        }
      })
    } finally {
      if (source !== d.doc) source.destroy()
    }
  }

  // ----------------------------------------------------------------- forms

  private readWidget(w: MuPDF.PDFWidget, page: number): PdfWidget {
    const type = safe(() => w.getFieldType(), 'button') as PdfFieldType
    const isText = type === 'text'
    let onState: string | undefined
    if (type === 'checkbox' || type === 'radiobutton') {
      onState = safe(() => {
        const n = w.getObject().get('AP').get('N')
        let found: string | undefined
        if (n.isDictionary()) n.forEach((_v, k) => { if (typeof k === 'string' && k !== 'Off' && !found) found = k })
        return found
      }, undefined) ?? 'Yes'
    }
    return {
      id: safe(() => w.getObject().asIndirect(), 0),
      page,
      type,
      name: safe(() => w.getName(), ''),
      label: safe(() => w.getLabel(), ''),
      rect: normRect(safe(() => w.getRect(), w.getBounds())),
      value: safe(() => w.getValue(), ''),
      options: type === 'combobox' || type === 'listbox' ? safe(() => w.getOptions(), [] as string[]) : [],
      multiline: isText && safe(() => w.isMultiline(), false),
      password: isText && safe(() => w.isPassword(), false),
      comb: isText && safe(() => w.isComb(), false),
      maxLen: isText ? safe(() => w.getMaxLen(), 0) : 0,
      readOnly: safe(() => w.isReadOnly(), false),
      fontSize: safe(() => w.getDefaultAppearance().size, 0),
      onState,
    }
  }

  widgets(id: number, index: number): PdfWidget[] {
    const page = this.page(this.get(id), index)
    return page.getWidgets().map((w) => this.readWidget(w, index))
  }

  /** Fill in a form field: text for text and choice fields, true/false for check boxes and radio buttons. */
  setField(id: number, index: number, widgetId: number, value: string | boolean): PdfWidget[] {
    const d = this.get(id)
    this.op(d, 'Fill in form', () => {
      const page = d.doc.loadPage(index)
      try {
        const w = page.getWidgets().find((x) => safe(() => x.getObject().asIndirect(), -1) === widgetId)
        if (!w) throw new Error('That form field is gone.')
        if (w.isReadOnly()) throw new Error('That field is read-only.')
        const type = w.getFieldType()
        if (type === 'checkbox' || type === 'radiobutton') {
          const info = this.readWidget(w, index)
          const on = type === 'radiobutton' ? info.value === info.onState : info.value !== 'Off' && info.value !== ''
          const want = typeof value === 'boolean' ? value : value !== 'Off' && value !== ''
          if (on !== want) w.toggle()
        } else if (type === 'combobox' || type === 'listbox') {
          w.setChoiceValue(String(value))
        } else if (type === 'text') {
          w.setTextValue(String(value))
        } else {
          throw new Error('That field cannot be filled in.')
        }
        w.update()
        page.update()
      } finally {
        page.destroy()
      }
    })
    return this.widgets(id, index)
  }

  // ------------------------------------------------------------- redaction

  /** Permanently remove everything under the given areas (black boxes). One undoable step. */
  redact(id: number, areas: { page: number; rect: PdfRect }[]): PdfPageInfo[] {
    const d = this.get(id)
    const byPage = new Map<number, PdfRect[]>()
    for (const a of areas) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a.rect])
    this.op(d, 'Redact', () => {
      for (const [i, rects] of byPage) {
        const page = d.doc.loadPage(i)
        try {
          for (const r of rects) {
            const annot = page.createAnnotation('Redact')
            annot.setRect(normRect(r))
            annot.update()
          }
          page.applyRedactions(true, this.mu.PDFPage.REDACT_IMAGE_PIXELS, this.mu.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, this.mu.PDFPage.REDACT_TEXT_REMOVE)
        } finally {
          page.destroy()
        }
      }
    })
    return this.pagesInfo(d)
  }

  /**
   * Replace text on pages (KhervePDF's Edit Text / Move Text / Delete Selected
   * Text): the text under `erase` is removed (nothing else, no black boxes),
   * then `text` is written into `rect`, wrapped to its width. One undoable step.
   */
  rewriteText(id: number, edits: PdfTextEdit[]): PdfPageInfo[] {
    const d = this.get(id)
    this.op(d, 'Edit text', () => {
      for (const e of edits) {
        const page = d.doc.loadPage(e.page)
        try {
          if (e.erase.length) {
            for (const r of e.erase) {
              const annot = page.createAnnotation('Redact')
              annot.setRect(normRect(r))
              annot.update()
            }
            page.applyRedactions(false, this.mu.PDFPage.REDACT_IMAGE_NONE, this.mu.PDFPage.REDACT_LINE_ART_NONE, this.mu.PDFPage.REDACT_TEXT_REMOVE)
          }
          if (e.text && e.rect) this.writeText(d, page, e)
        } finally {
          page.destroy()
        }
      }
    })
    return this.pagesInfo(d)
  }

  private writeText(d: DocState, page: MuPDF.PDFPage, e: PdfTextEdit) {
    const font = new this.mu.Font(base14Name(e.font, e.bold, e.italic))
    try {
      const fontRef = d.doc.addSimpleFont(font, 'Latin')
      const size = Math.max(1, e.size ?? 11)
      const [r, g, b] = hexToRgb(e.color, [0, 0, 0])
      const [x0, y0, x1] = normRect(e.rect!)
      const measure = (s: string) => {
        let w = 0
        for (const ch of s) w += safe(() => font.advanceGlyph(font.encodeCharacter(ch), 0), 0.5) * size
        return w
      }
      const width = Math.max(size, x1 - x0)
      const lines = wrapText(e.text!, width, measure)
      const pageObj = page.getObject()
      const res = this.ownResources(d.doc, pageObj)
      const fonts = this.subDict(d.doc, res, 'Font')
      const fname = this.freeName(fonts, 'KhvF')
      fonts.put(fname, fontRef)
      const inv = this.mu.Matrix.invert(page.getTransform())
      const leading = (e.leading ?? 1.2) * size
      let ops = `q ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg BT /${fname} ${size} Tf\n`
      lines.forEach((ln, i) => {
        if (!ln) return
        const w = measure(ln)
        let x = x0
        if (e.align === 'center') x = x0 + (width - w) / 2
        else if (e.align === 'right') x = x0 + width - w
        const y = y0 + size * 0.85 + i * leading
        const m = this.mu.Matrix.concat([1, 0, 0, -1, x, y], inv)
        ops += `${fmtMatrix(m)} Tm ${pdfLiteral(ln)} Tj\n`
      })
      ops += 'ET Q\n'
      this.appendContent(d.doc, pageObj, ops)
    } finally {
      font.destroy()
    }
  }

  // --------------------------------------------------------------- history

  private history(d: DocState): HistoryResult {
    return {
      pages: this.pagesInfo(d),
      canUndo: d.journal && safe(() => d.doc.canUndo(), false),
      canRedo: d.journal && safe(() => d.doc.canRedo(), false),
    }
  }

  undo(id: number): HistoryResult {
    const d = this.get(id)
    this.dropPages(d)
    if (d.journal && d.doc.canUndo()) d.doc.undo()
    return this.history(d)
  }

  redo(id: number): HistoryResult {
    const d = this.get(id)
    this.dropPages(d)
    if (d.journal && d.doc.canRedo()) d.doc.redo()
    return this.history(d)
  }
}

/** The operations the worker runs, by name. */
export type PdfEngineOps = {
  [K in keyof PdfEngine as PdfEngine[K] extends (...args: never[]) => unknown ? K : never]: PdfEngine[K]
}
