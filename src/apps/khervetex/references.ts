// How citations and cross-references read on screen: "[1]", "Smith (2020)",
// "2.1", "(3)", the way the PDF will show them (khervedoc/references.py).
// Display only; the LaTeX is untouched.

export interface BibEntry {
  author: string
  year: string
  title: string
}

const ENTRY_START_RE = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g
const BIBITEM_RE = /\\bibitem(?:\[([^\]]*)\])?\{([^}]+)\}/g
const BIB_SOURCE_RE = /\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g

/** The value of `name = {..}` / `"..."` / bare in a BibTeX entry body. */
function fieldValue(body: string, name: string): string {
  const m = new RegExp(`(?<![\\w-])${name}\\s*=\\s*`, 'i').exec(body)
  if (!m) return ''
  const i = m.index + m[0].length
  if (i >= body.length) return ''
  if (body[i] === '{') {
    let depth = 0
    for (let j = i; j < body.length; j++) {
      if (body[j] === '{') depth++
      else if (body[j] === '}') {
        depth--
        if (depth === 0) return body.slice(i + 1, j)
      }
    }
    return body.slice(i + 1)
  }
  if (body[i] === '"') {
    const j = body.indexOf('"', i + 1)
    return body.slice(i + 1, j === -1 ? undefined : j)
  }
  return /^[^,}\s]*/.exec(body.slice(i))?.[0] ?? ''
}

/** Author, year and title of every entry in some BibTeX source (malformed entries are skipped). */
export function parseBibtex(text: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>()
  const starts = [...text.matchAll(ENTRY_START_RE)]
  starts.forEach((m, n) => {
    const kind = m[1].toLowerCase()
    if (kind === 'comment' || kind === 'string' || kind === 'preamble') return
    const end = n + 1 < starts.length ? starts[n + 1].index! : text.length
    const body = text.slice(m.index! + m[0].length, end)
    entries.set(m[2], {
      author: fieldValue(body, 'author') || fieldValue(body, 'editor'),
      year: fieldValue(body, 'year') || fieldValue(body, 'date').slice(0, 4),
      title: fieldValue(body, 'title'),
    })
  })
  return entries
}

/** The .bib files a raw-LaTeX block names in \\bibliography{} / \\addbibresource{}. */
export function bibSources(raw: string): string[] {
  const out: string[] = []
  for (const m of raw.matchAll(BIB_SOURCE_RE)) {
    for (const name of m[1].split(',')) {
      let n = name.trim()
      if (!n) continue
      if (!n.endsWith('.bib')) n += '.bib'
      out.push(n)
    }
  }
  return out
}

const clean = (s: string): string => s.replace(/[{}]/g, '').trim()

/** 'Smith, J. and Doe, A. and Roe, B.' → 'Smith et al.' */
export function shortAuthor(author: string): string {
  const people = clean(author).split(/\s+and\s+/).map((p) => p.trim()).filter(Boolean)
  if (!people.length) return ''
  const surname = (p: string) => (p.includes(',') ? p.split(',')[0].trim() : p.split(/\s+/).at(-1) ?? p)
  if (people.length === 1) return surname(people[0])
  if (people.length === 2) return `${surname(people[0])} and ${surname(people[1])}`
  return `${surname(people[0])} et al.`
}

/** What the resolver needs to know about one numbered object. */
export type Numbered =
  | { kind: 'section'; level: number; numbered: boolean; label: string | null }
  | { kind: 'figure' | 'table'; label: string | null }
  | { kind: 'equation'; numbered: boolean; label: string | null }

export class ReferenceResolver {
  entries = new Map<string, BibEntry>()
  bibitemLabels = new Map<string, string>()
  citeNumbers = new Map<string, number>()
  labels = new Map<string, string>()
  /** The number shown for each object passed in, in order (null when unnumbered). */
  numbers: (string | null)[] = []

  /**
   * @param rawBlocks the text of the raw-LaTeX blocks (for \\bibitem)
   * @param bibTexts BibTeX sources: the .bib files beside the document and kherveref.bib
   * @param citations every citation's keys, in reading order
   * @param objects the sections, figures, tables and equations, in order
   */
  constructor(rawBlocks: string[], bibTexts: string[], citations: string[][], objects: Numbered[]) {
    for (const raw of rawBlocks) {
      for (const m of raw.matchAll(BIBITEM_RE)) {
        const key = m[2].trim()
        if (!this.entries.has(key)) this.entries.set(key, { author: '', year: '', title: '' })
        if (m[1]) this.bibitemLabels.set(key, m[1])
      }
    }
    for (const text of bibTexts) {
      for (const [key, entry] of parseBibtex(text)) if (!this.entries.has(key)) this.entries.set(key, entry)
    }
    for (const keys of citations) for (const k of keys) if (!this.citeNumbers.has(k)) this.citeNumbers.set(k, this.citeNumbers.size + 1)
    this.numberObjects(objects)
  }

  private numberObjects(objects: Numbered[]) {
    const hasChapters = objects.some((o) => o.kind === 'section' && o.level === 0)
    const counters = [0, 0, 0, 0, 0, 0, 0]
    let fig = 0
    let tab = 0
    let eq = 0
    const prefixed = (n: number) => (hasChapters ? `${counters[0]}.${n}` : String(n))
    for (const o of objects) {
      let number: string | null = null
      if (o.kind === 'section') {
        if (o.numbered) {
          const lvl = Math.max(0, Math.min(6, o.level))
          counters[lvl] += 1
          for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0
          if (lvl === 0) fig = tab = eq = 0
          number = counters.slice(hasChapters ? 0 : 1, lvl + 1).join('.')
          if (o.label) this.labels.set(o.label, number)
          // LaTeX numbers \chapter … \subsubsection (secnumdepth 3).
          if (lvl > 3) number = null
        }
      } else if (o.kind === 'figure') {
        number = prefixed(++fig)
        if (o.label) this.labels.set(o.label, number)
      } else if (o.kind === 'table') {
        number = prefixed(++tab)
        if (o.label) this.labels.set(o.label, number)
      } else if (o.kind === 'equation' && o.numbered) {
        number = prefixed(++eq)
        if (o.label) this.labels.set(o.label, number)
      }
      this.numbers.push(number)
    }
  }

  citeText(keys: string[], style = 'cite'): string {
    if (style === 'citet' || style === 'citep') {
      const parts = keys.map((k) => {
        const e = this.entries.get(k)
        const who = shortAuthor(e?.author ?? '')
        const year = clean(e?.year ?? '')
        if (!who) return `${k}?`
        if (style === 'citet') return year ? `${who} (${year})` : who
        return year ? `${who}, ${year}` : who
      })
      return style === 'citet' ? parts.join('; ') : `(${parts.join('; ')})`
    }
    const shown = keys.map((k) => {
      const label = this.bibitemLabels.get(k)
      if (label) return label
      if (this.entries.size && !this.entries.has(k)) return `${k}?`
      return String(this.citeNumbers.get(k) ?? '?')
    })
    return `[${shown.join(', ')}]`
  }

  refText(label: string, kind = 'ref'): string {
    if (kind === 'pageref') return 'p. ?'
    const number = this.labels.get(label) ?? '??'
    return kind === 'eqref' ? `(${number})` : number
  }
}
