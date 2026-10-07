// The reference model: a port of the desktop KherveRef's kherveref/model.py.
// Every importer (BibTeX, CSL-JSON, DOI/arXiv/ISBN lookups, PDFs) produces
// Entry objects; every exporter reads them. Field names follow BibLaTeX.
// toDict/fromDict give the exact JSON of .kherveref/references/<key>.json.
//
// Pure TypeScript (no '@/' imports): the Node tests import it directly.

export const ENTRY_TYPES: Record<string, string> = {
  article: 'Journal article',
  inproceedings: 'Conference paper',
  book: 'Book',
  inbook: 'Book chapter',
  incollection: 'Chapter in edited book',
  thesis: 'Thesis',
  report: 'Report',
  online: 'Web page / online',
  dataset: 'Dataset',
  software: 'Software',
  patent: 'Patent',
  unpublished: 'Unpublished / preprint',
  misc: 'Other',
}

/** Text fields of an Entry, in display / export order. */
export const TEXT_FIELDS = [
  'title', 'subtitle', 'date', 'journal', 'booktitle', 'publisher', 'institution', 'volume', 'number', 'pages', 'edition', 'series',
  'location', 'doi', 'url', 'isbn', 'issn', 'eprint', 'eprinttype', 'thesis_type', 'abstract', 'note', 'language',
] as const
export type TextField = (typeof TEXT_FIELDS)[number]

const PARTICLES = new Set([
  'von', 'van', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'dos', 'das', 'la', 'le', 'ter', 'ten', 'zu', 'af', 'al', 'el', 'bin', 'ibn',
  'st.', 'y',
])

export interface Person {
  family: string
  given: string
  /** An organisation ("World Health Organization"): never split. */
  literal: string
}

export const person = (family = '', given = '', literal = ''): Person => ({ family, given, literal })

export function personDisplay(p: Person): string {
  if (p.literal) return p.literal
  return p.given ? `${p.family}, ${p.given}` : p.family
}

export const personShort = (p: Person): string => p.literal || p.family

function personToDict(p: Person): Record<string, string> {
  if (p.literal) return { literal: p.literal }
  const d: Record<string, string> = { family: p.family }
  if (p.given) d.given = p.given
  return d
}

function personFromDict(d: unknown): Person {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  return person(str(o.family), str(o.given), str(o.literal))
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase()

/** One name: "Family, Given", "Family, Jr, Given", "Given Family", "Given von Family", or "{Organisation}". */
export function parseName(text: string): Person {
  const s = text.split(/\s+/).filter(Boolean).join(' ')
  if (!s) return person()
  if (s.startsWith('{') && s.endsWith('}') && balanced(s.slice(1, -1))) return person('', '', s.slice(1, -1))
  const parts = splitTopLevel(s, ',')
  if (parts.length >= 2) {
    let family = parts[0].trim()
    let given: string
    if (parts.length >= 3) {
      family = `${family} ${parts[1].trim()}`
      given = parts.slice(2).map((p) => p.trim()).join(', ')
    } else given = parts[1].trim()
    return person(unbrace(family), unbrace(given))
  }
  const words = s.split(' ')
  if (words.length === 1) return person(unbrace(words[0]))
  // The family name starts at the first lower-case particle after the given names, else it is the last word.
  let start = words.length - 1
  for (let i = 1; i < words.length - 1; i++) {
    const w = words[i]
    if (PARTICLES.has(w.toLowerCase()) && isLower(w[0])) {
      start = i
      break
    }
  }
  return person(unbrace(words.slice(start).join(' ')), unbrace(words.slice(0, start).join(' ')))
}

/** A BibTeX name list ("A and B and others") or one name per line. */
export function parseNames(text: string): Person[] {
  const chunks = text.trim().includes('\n') ? text.split(/\r?\n/) : splitTopLevel(text, ' and ', true)
  const out: Person[] = []
  for (const c of chunks) {
    const t = c.trim()
    if (t && t.toLowerCase() !== 'others') out.push(parseName(t))
  }
  return out
}

function balanced(s: string): boolean {
  let depth = 0
  for (const ch of s) {
    depth += ch === '{' ? 1 : ch === '}' ? -1 : 0
    if (depth < 0) return false
  }
  return depth === 0
}

const unbrace = (s: string) => s.replace(/[{}]/g, '').trim()

/** Split on `sep` outside braces. */
export function splitTopLevel(s: string, sep: string, ignoreCase = false): string[] {
  const hay = ignoreCase ? s.toLowerCase() : s
  const needle = ignoreCase ? sep.toLowerCase() : sep
  const out: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (depth === 0 && hay.startsWith(needle, i)) {
      out.push(s.slice(last, i))
      i += needle.length
      last = i
      continue
    }
    i++
  }
  out.push(s.slice(last))
  return out
}

export interface Attachment {
  /** Relative to the library root, "/" separated: "PDFs/smith2020.pdf". */
  path: string
  sha1: string
}

/** "2026-10-07T12:00:00+00:00", as Python's datetime.isoformat() writes it. */
export function nowIso(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

export interface Entry {
  key: string
  type: string
  authors: Person[]
  editors: Person[]
  title: string
  subtitle: string
  /** "2020", "2020-05" or "2020-05-17" */
  date: string
  /** BibLaTeX journaltitle */
  journal: string
  booktitle: string
  publisher: string
  /** Also the school of a thesis. */
  institution: string
  volume: string
  number: string
  pages: string
  edition: string
  series: string
  location: string
  doi: string
  url: string
  isbn: string
  issn: string
  /** e.g. an arXiv id */
  eprint: string
  /** e.g. "arxiv" */
  eprinttype: string
  /** "phd" / "master" for @thesis */
  thesis_type: string
  abstract: string
  note: string
  language: string
  keywords: string[]
  /** Any other BibTeX field, kept verbatim so imports round-trip. */
  extra: Record<string, string>
  // Library bookkeeping, never exported to BibTeX.
  files: Attachment[]
  collections: string[]
  notes: string
  needs_review: boolean
  added: string
  modified: string
}

export function newEntry(init: Partial<Entry> = {}): Entry {
  const e: Entry = {
    key: '', type: 'article', authors: [], editors: [], title: '', subtitle: '', date: '', journal: '', booktitle: '', publisher: '',
    institution: '', volume: '', number: '', pages: '', edition: '', series: '', location: '', doi: '', url: '', isbn: '', issn: '',
    eprint: '', eprinttype: '', thesis_type: '', abstract: '', note: '', language: '', keywords: [], extra: {}, files: [], collections: [],
    notes: '', needs_review: false, added: '', modified: '',
  }
  return Object.assign(e, init)
}

export function cloneEntry(e: Entry): Entry {
  return fromDict(toDict(e))
}

export function year(e: Entry): string {
  const m = /^\s*(\d{4})/.exec(e.date)
  return m ? m[1] : ''
}

/** Where it was published, for the table's Journal column. */
export function container(e: Entry): string {
  return e.journal || e.booktitle || e.publisher || e.institution || (e.eprinttype === 'arxiv' && e.eprint ? `arXiv:${e.eprint}` : '')
}

export function authorText(e: Entry, limit = 2): string {
  const names = e.authors.length ? e.authors : e.editors
  if (!names.length) return ''
  if (names.length > limit) return `${personShort(names[0])} et al.`
  return names.map(personShort).join(' & ')
}

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort()

/** Python's sorted() order for strings: by code point. */
export const cmpCodePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The JSON object of references/<key>.json, keys in the desktop's order. */
export function toDict(e: Entry): Record<string, unknown> {
  const d: Record<string, unknown> = { key: e.key, type: e.type }
  if (e.authors.length) d.authors = e.authors.map(personToDict)
  if (e.editors.length) d.editors = e.editors.map(personToDict)
  for (const name of TEXT_FIELDS) if (e[name]) d[name] = e[name]
  if (e.keywords.length) d.keywords = [...e.keywords]
  const extraKeys = Object.keys(e.extra).sort(cmpCodePoints)
  if (extraKeys.length) d.extra = Object.fromEntries(extraKeys.map((k) => [k, e.extra[k]]))
  if (e.files.length) d.files = e.files.map((a) => ({ path: a.path, sha1: a.sha1 }))
  if (e.collections.length) d.collections = sortedUnique(e.collections)
  if (e.notes) d.notes = e.notes
  if (e.needs_review) d.needs_review = true
  if (e.added) d.added = e.added
  if (e.modified) d.modified = e.modified
  return d
}

export function fromDict(raw: unknown): Entry {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const e = newEntry({ key: str(d.key), type: str(d.type) || 'misc' })
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  e.authors = list(d.authors).map(personFromDict)
  e.editors = list(d.editors).map(personFromDict)
  for (const name of TEXT_FIELDS) e[name] = str(d[name])
  e.keywords = list(d.keywords).map(str)
  const extra = d.extra && typeof d.extra === 'object' ? (d.extra as Record<string, unknown>) : {}
  e.extra = Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, str(v)]))
  e.files = list(d.files).map((a) =>
    typeof a === 'string' ? { path: a, sha1: '' } : { path: str((a as Record<string, unknown>)?.path), sha1: str((a as Record<string, unknown>)?.sha1) },
  )
  e.collections = list(d.collections).map(str)
  e.notes = str(d.notes)
  e.needs_review = !!d.needs_review
  e.added = str(d.added)
  e.modified = str(d.modified)
  return e
}

/** Fill fields this entry lacks from `other` (a looked-up record), never overwriting the user's. */
export function mergeMissing(e: Entry, other: Entry): void {
  if (!e.authors.length && other.authors.length) e.authors = other.authors.map((p) => ({ ...p }))
  if (!e.editors.length && other.editors.length) e.editors = other.editors.map((p) => ({ ...p }))
  for (const name of TEXT_FIELDS) if (!e[name] && other[name]) e[name] = other[name]
  if (!e.keywords.length) e.keywords = [...other.keywords]
  for (const [k, v] of Object.entries(other.extra)) if (!(k in e.extra)) e.extra[k] = v
}

/** Take every bibliographic field from `other` (a trusted lookup), keeping key, files, collections, notes and dates. */
export function replaceBibliographic(e: Entry, other: Entry): void {
  const keep = new Set(['key', 'files', 'collections', 'notes', 'added', 'modified', 'needs_review'])
  for (const k of Object.keys(other) as (keyof Entry)[]) {
    if (keep.has(k)) continue
    const v = other[k]
    const empty = Array.isArray(v) ? !v.length : v && typeof v === 'object' ? !Object.keys(v).length : !v
    if (empty) continue
    ;(e as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? { ...x } : x)) : typeof v === 'object' ? { ...v } : v
  }
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;]+$/, '')
    .toLowerCase()
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function normalizeArxiv(eprint: string): string {
  return eprint.trim().replace(/^arxiv:\s*/i, '').replace(/v\d+$/, '').toLowerCase()
}

export function normalizeIsbn(s: string): string {
  return [...s.toUpperCase()].filter((c) => /[0-9X]/.test(c)).join('')
}

// ------------------------------------------------------------ duplicates

const firstFamily = (e: Entry) => {
  const people = e.authors.length ? e.authors : e.editors
  return people.length ? normalizeTitle(personShort(people[0])) : ''
}

/** Finds a reference already in the library by DOI, arXiv id, ISBN, attached-file hash, or title + year. */
export class DuplicateIndex {
  doi = new Map<string, string>()
  arxiv = new Map<string, string>()
  isbn = new Map<string, string>()
  sha1 = new Map<string, string>()
  title = new Map<string, string>()
  /** Short titles ("Notes") only count with the first author. */
  titleAuthor = new Map<string, string>()

  static build(entries: Iterable<Entry>): DuplicateIndex {
    const idx = new DuplicateIndex()
    for (const e of entries) idx.add(e)
    return idx
  }

  add(e: Entry): void {
    if (e.doi) this.doi.set(normalizeDoi(e.doi), e.key)
    if (e.eprint && e.eprinttype === 'arxiv') this.arxiv.set(normalizeArxiv(e.eprint), e.key)
    if (e.isbn) this.isbn.set(normalizeIsbn(e.isbn), e.key)
    for (const a of e.files) if (a.sha1) this.sha1.set(a.sha1, e.key)
    const t = normalizeTitle(e.title)
    if (t.length > 12) this.title.set(`${t}|${year(e)}`, e.key)
    const fam = firstFamily(e)
    if (t && fam) this.titleAuthor.set(`${t}|${year(e)}|${fam}`, e.key)
  }

  find(e: Entry, sha1 = ''): string | null {
    if (sha1 && this.sha1.has(sha1)) return this.sha1.get(sha1)!
    if (e.doi && this.doi.has(normalizeDoi(e.doi))) return this.doi.get(normalizeDoi(e.doi))!
    if (e.eprint && e.eprinttype === 'arxiv' && this.arxiv.has(normalizeArxiv(e.eprint))) return this.arxiv.get(normalizeArxiv(e.eprint))!
    if (e.isbn && this.isbn.has(normalizeIsbn(e.isbn))) return this.isbn.get(normalizeIsbn(e.isbn))!
    const t = normalizeTitle(e.title)
    if (t.length > 12 && this.title.has(`${t}|${year(e)}`)) return this.title.get(`${t}|${year(e)}`)!
    const fam = firstFamily(e)
    if (t && fam) return this.titleAuthor.get(`${t}|${year(e)}|${fam}`) ?? null
    return null
  }
}

// ---------------------------------------------------------------- search

/** Every word of `query` appears in the reference (key, title, authors, journal, ids, notes, tags). */
export function matchesSearch(e: Entry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [
    e.key, e.title, e.subtitle, container(e), e.date, e.doi, e.eprint, e.isbn, e.note, e.notes, e.keywords.join(' '),
    ...[...e.authors, ...e.editors].map(personDisplay),
  ]
    .join(' ')
    .toLowerCase()
  return words.every((w) => hay.includes(w))
}
