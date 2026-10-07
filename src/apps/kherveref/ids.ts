// Identifiers in text (the desktop's fetch.py detection and pdf_meta.py): DOIs,
// arXiv ids, ISBNs, and what a PDF says about itself — its DOI from the
// metadata or the text of the first pages, else a title guessed from the
// largest type near the top of page 1.

import { parseName, type Person } from './model.ts'

export type IdKind = 'doi' | 'arxiv' | 'isbn'

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>{}]+)/i
const ARXIV_NEW_RE = /(?:arxiv[:\s/]*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(v\d+)?/i
const ARXIV_OLD_RE = /(?:arxiv[:\s/]*|arxiv\.org\/(?:abs|pdf)\/)([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i
const ISBN_RE = /\bISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx])/g

/** Trim what a regex over running text drags along: trailing punctuation and an unmatched closing bracket. */
export function cleanDoi(raw: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[' }
  let d = raw.trim().replace(/[.,;:'"]+$/, '')
  const count = (c: string) => d.split(c).length - 1
  while (d && d[d.length - 1] in pairs && count(d[d.length - 1]) > count(pairs[d[d.length - 1]])) d = d.slice(0, -1).replace(/[.,;:]+$/, '')
  return d
}

export function findDoi(text: string): string {
  const m = DOI_RE.exec(text)
  return m ? cleanDoi(m[1]) : ''
}

export function findArxiv(text: string): string {
  const m = ARXIV_NEW_RE.exec(text) ?? ARXIV_OLD_RE.exec(text)
  return m ? m[1] : ''
}

export function isbnOk(s: string): boolean {
  if (s.length === 10) {
    if (!/^\d{9}[\dX]$/.test(s)) return false
    let total = 0
    for (let i = 0; i < 10; i++) total += (10 - i) * (s[i] === 'X' ? 10 : +s[i])
    return total % 11 === 0
  }
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    let total = 0
    for (let i = 0; i < 13; i++) total += +s[i] * (i % 2 === 0 ? 1 : 3)
    return total % 10 === 0
  }
  return false
}

export function findIsbn(text: string): string {
  for (const m of text.matchAll(ISBN_RE)) {
    const digits = m[1].replace(/[\s-]/g, '').toUpperCase()
    if (isbnOk(digits)) return digits
  }
  return ''
}

/** [kind, value] for something typed or pasted: a bare id, "doi:…", "arXiv:…", or a URL. null when it is none. */
export function classify(input: string): [IdKind, string] | null {
  const s = input.trim()
  if (!s) return null
  if (/arxiv/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) {
    const a = findArxiv(s.toLowerCase().includes('arxiv') ? s : `arXiv:${s}`)
    if (a) return ['arxiv', a]
  }
  const d = findDoi(s)
  if (d) return ['doi', d]
  const digits = s.replace(/^isbn[:\s]*/i, '').replace(/[\s-]/g, '').toUpperCase()
  if (isbnOk(digits)) return ['isbn', digits]
  return null
}

/** Every identifier in pasted text: one per line (or per space-separated word on a line). */
export function splitIdentifiers(text: string): { ids: [IdKind, string][]; unknown: string[] } {
  const ids: [IdKind, string][] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    // Word by word ("doi: 10.1/x  arXiv:2101.00001"); else the whole line ("ISBN 978 0 262 03384 8").
    const words = t.split(/[\s,;]+/).filter(Boolean)
    let found = words.map((w) => classify(w)).filter((f): f is [IdKind, string] => !!f)
    if (!found.length) {
      const whole = classify(t)
      if (!whole) {
        unknown.push(t)
        continue
      }
      found = [whole]
    }
    for (const f of found) {
      const k = `${f[0]}:${f[1].toLowerCase()}`
      if (!seen.has(k)) {
        seen.add(k)
        ids.push(f)
      }
    }
  }
  return { ids, unknown: unknown.filter(Boolean) }
}

/** Authors from a PDF's Author field: "A; B", "A, B and C". */
export function personList(names: string): Person[] {
  let parts = names.trim().split(/\s*;\s*|\s+and\s+|\s*&\s*/)
  if (parts.length === 1 && (parts[0].match(/,/g) ?? []).length > 1) parts = parts[0].split(',')
  return parts.filter((p) => p.trim()).map(parseName)
}

// ------------------------------------------------------------------- PDFs

const JUNK_TITLE = /(^microsoft (word|powerpoint)|\.(docx?|pdf|tex|dvi|indd)$|^untitled|^document\d*$|^slide \d|^\s*$|^[\w-]+\d{3,}[\w-]*$)/i
const HEADER_NOISE =
  /(journal|proceedings|contents lists available|elsevier|springer|www\.|http|vol\.|volume|issue|pages?|received|accepted|published|copyright|©|licen[sc]e|doi|issn|arxiv|preprint|article|research paper)/i

export function goodTitle(t: string): boolean {
  const s = t.trim()
  return s.length >= 10 && s.length <= 300 && !JUNK_TITLE.test(s) && s.split(/\s+/).length >= 2
}

/** A word on a page, as the PDF service gives it: [x0, y0, x1, y1] in points, y down; same `line` = same line. */
export interface PageWord {
  text: string
  rect: [number, number, number, number]
  line: number
}

/**
 * The run of lines in the biggest type in the top two thirds of the page —
 * usually the title. Word heights stand in for font sizes.
 */
export function largestText(words: PageWord[], pageHeight: number): string {
  const byLine = new Map<number, PageWord[]>()
  for (const w of words) {
    if (!w.text.trim()) continue
    const l = byLine.get(w.line) ?? []
    l.push(w)
    byLine.set(w.line, l)
  }
  const height = pageHeight || 1
  const lines: { size: number; y: number; text: string }[] = []
  for (const ws of byLine.values()) {
    ws.sort((a, b) => a.rect[0] - b.rect[0])
    const y = Math.min(...ws.map((w) => w.rect[1]))
    if (y > height * 0.66) continue
    const size = Math.max(...ws.map((w) => w.rect[3] - w.rect[1]))
    lines.push({ size, y, text: ws.map((w) => w.text).join(' ').trim() })
  }
  const candidates = lines.filter((l) => l.text.length > 3 && !HEADER_NOISE.test(l.text))
  if (!candidates.length) return ''
  const top = Math.max(...candidates.map((c) => c.size))
  const picked = candidates.filter((c) => c.size >= top * 0.94).sort((a, b) => a.y - b.y)
  // Only the first contiguous group (a title may wrap onto 2–4 lines).
  const out: string[] = []
  let lastY: number | null = null
  for (const { size, y, text } of picked) {
    if (lastY !== null && y - lastY > size * 2.2) break
    out.push(text)
    lastY = y
  }
  const title = out.join(' ').split(/\s+/).filter(Boolean).join(' ').replace(/(\w)- (\w)/g, '$1$2')
  return goodTitle(title) ? title : ''
}

export interface PdfInfo {
  doi: string
  arxiv: string
  isbn: string
  title: string
  authors: string
  year: string
  hasText: boolean
  pages: number
}

export interface PdfFacts {
  meta: { title?: string; author?: string; subject?: string; keywords?: string; creationDate?: string }
  /** Text of the first pages. */
  text: string
  pages: number
  /** Title guessed from the type sizes on page 1 (largestText). */
  bigTitle?: string
}

/** What a PDF says about itself: identifiers first from its metadata, then from its text. */
export function analysePdf({ meta, text, pages, bigTitle = '' }: PdfFacts): PdfInfo {
  const info: PdfInfo = { doi: '', arxiv: '', isbn: '', title: '', authors: '', year: '', hasText: text.trim().length > 50, pages }
  info.doi = findDoi([meta.subject, meta.keywords, meta.title].filter(Boolean).join(' ')) || findDoi(text)
  info.arxiv = findArxiv(text) || findArxiv(meta.subject ?? '')
  info.isbn = info.doi ? '' : findIsbn(text)
  const mt = (meta.title ?? '').trim()
  info.title = goodTitle(mt) ? mt : bigTitle
  const author = (meta.author ?? '').trim()
  if (author && !/(user|admin|owner|^[a-z]+\d*$)/i.test(author)) info.authors = author
  for (const src of [meta.creationDate ?? '', text.slice(0, 3000)]) {
    const y = /(?:D:)?((?:19|20)\d{2})/.exec(src)
    if (y) {
      info.year = y[1]
      break
    }
  }
  return info
}
