// BibTeX / BibLaTeX import and export (the desktop's kherveref/bibtex.py).
//
// Import accepts either dialect (journal or journaltitle, year or date, school
// or institution…). Export writes:
//  - "biblatex": UTF-8, `date`, `journaltitle`, @thesis, @online… (File ▸ Export default);
//  - "bibtex": classic BibTeX for natbib (what KherveTeX compiles with): ASCII
//    with accent macros, year/month, journal, @phdthesis, @techreport…
// Output is deterministic (fixed field order, sorted by key), byte-identical
// to the desktop app's for the same library.

import { latexToUnicode, protectCase, stripBraces, unicodeToLatex } from './latex.ts'
import { cmpCodePoints, newEntry, parseNames, person, year, type Entry, type Person } from './model.ts'

export const DIALECTS = ['biblatex', 'bibtex'] as const
export type Dialect = (typeof DIALECTS)[number]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAMES: Record<string, number> = {
  ...Object.fromEntries(MONTHS.map((m, i) => [m, i + 1])),
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/** BibTeX entry type → [model type, thesis_type] */
const TYPE_IN: Record<string, [string, string]> = {
  article: ['article', ''], inproceedings: ['inproceedings', ''], conference: ['inproceedings', ''], proceedings: ['book', ''],
  book: ['book', ''], mvbook: ['book', ''], booklet: ['book', ''], inbook: ['inbook', ''], bookinbook: ['inbook', ''],
  incollection: ['incollection', ''], collection: ['book', ''], phdthesis: ['thesis', 'phd'], mastersthesis: ['thesis', 'master'],
  thesis: ['thesis', ''], techreport: ['report', ''], report: ['report', ''], manual: ['report', ''], online: ['online', ''],
  electronic: ['online', ''], www: ['online', ''], webpage: ['online', ''], dataset: ['dataset', ''], data: ['dataset', ''],
  software: ['software', ''], patent: ['patent', ''], unpublished: ['unpublished', ''], misc: ['misc', ''],
}

/** BibTeX field → model field (direct copies, LaTeX decoded). */
const FIELD_IN: Record<string, keyof Entry> = {
  title: 'title', subtitle: 'subtitle', journal: 'journal', journaltitle: 'journal', booktitle: 'booktitle', publisher: 'publisher',
  institution: 'institution', school: 'institution', organization: 'institution', volume: 'volume', number: 'number', issue: 'number',
  pages: 'pages', edition: 'edition', series: 'series', address: 'location', location: 'location', doi: 'doi', url: 'url', isbn: 'isbn',
  issn: 'issn', eprint: 'eprint', eprinttype: 'eprinttype', archiveprefix: 'eprinttype', abstract: 'abstract', note: 'note',
  language: 'language', langid: 'language',
}
/** Identifiers and URLs: never LaTeX-decoded. */
const VERBATIM = new Set(['doi', 'url', 'eprint', 'isbn', 'issn', 'file'])
/** Read but not stored as `extra` (rebuilt on export, or app-specific). */
const DROPPED = new Set(['year', 'month', 'date', 'author', 'editor', 'keywords', 'type', 'timestamp', 'owner', 'urldate'])

export interface ParseResult {
  entries: Entry[]
  warnings: string[]
}

// ------------------------------------------------------------------ lexing

class BibError extends Error {}

const IDENT = /[^\s,={}()"#%'@]+/y
const isSpace = (c: string) => /\s/.test(c)

class Reader {
  s: string
  i = 0
  constructor(text: string) {
    this.s = text
  }

  ws() {
    while (this.i < this.s.length && isSpace(this.s[this.i])) this.i++
  }

  peek(): string {
    return this.i < this.s.length ? this.s[this.i] : ''
  }

  ident(): string {
    IDENT.lastIndex = this.i
    const m = IDENT.exec(this.s)
    if (!m) return ''
    this.i = IDENT.lastIndex
    return m[0]
  }

  braced(): string {
    if (this.s[this.i] !== '{') throw new BibError('expected "{"')
    let depth = 0
    const start = this.i + 1
    while (this.i < this.s.length) {
      const ch = this.s[this.i]
      if (ch === '\\') {
        this.i += 2
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          this.i++
          return this.s.slice(start, this.i - 1)
        }
      }
      this.i++
    }
    throw new BibError('unbalanced braces')
  }

  quoted(): string {
    this.i++
    let depth = 0
    const start = this.i
    while (this.i < this.s.length) {
      const ch = this.s[this.i]
      if (ch === '\\') {
        this.i += 2
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '"' && depth === 0) {
        this.i++
        return this.s.slice(start, this.i - 1)
      }
      this.i++
    }
    throw new BibError('unterminated quoted value')
  }

  /** A field value: pieces joined by #, macros expanded. */
  value(strings: Map<string, string>): string {
    const out: string[] = []
    for (;;) {
      this.ws()
      const ch = this.peek()
      if (ch === '{') out.push(this.braced())
      else if (ch === '"') out.push(this.quoted())
      else {
        const word = this.ident()
        if (!word) throw new BibError('expected a value')
        out.push(/^\d+$/.test(word) ? word : (strings.get(word.toLowerCase()) ?? word))
      }
      this.ws()
      if (this.peek() === '#') {
        this.i++
        continue
      }
      return out.join('')
    }
  }
}

/** Parse BibTeX/BibLaTeX source. Malformed entries are skipped with a warning instead of failing the whole file. */
export function parse(text: string): ParseResult {
  const res: ParseResult = { entries: [], warnings: [] }
  const strings = new Map(MONTHS.map((m) => [m, m]))
  const r = new Reader(text)
  for (;;) {
    const at = r.s.indexOf('@', r.i)
    r.i = at < 0 ? r.s.length : at
    if (r.i >= r.s.length) break
    const start = r.i
    r.i++
    const kind = r.ident().toLowerCase()
    r.ws()
    const open = r.peek()
    if (open !== '{' && open !== '(') continue
    const close = open === '{' ? '}' : ')'
    r.i++
    try {
      if (kind === 'comment') {
        r.i--
        if (close === '}') r.braced()
        continue
      }
      if (kind === 'preamble') {
        r.value(strings)
        r.ws()
        r.i++
        continue
      }
      if (kind === 'string') {
        r.ws()
        const name = r.ident().toLowerCase()
        r.ws()
        r.i++ // '='
        strings.set(name, r.value(strings))
        r.ws()
        r.i++
        continue
      }
      r.ws()
      const key = r.ident()
      r.ws()
      if (r.peek() === ',') r.i++
      const raw = new Map<string, string>()
      for (;;) {
        r.ws()
        if (r.peek() === close || r.peek() === '') {
          r.i++
          break
        }
        const name = r.ident().toLowerCase()
        r.ws()
        if (r.peek() !== '=') throw new BibError(`expected '=' after '${name}'`)
        r.i++
        raw.set(name, r.value(strings))
        r.ws()
        if (r.peek() === ',') r.i++
      }
      if (!key) {
        res.warnings.push(`Skipped a @${kind} entry with no key`)
        continue
      }
      res.entries.push(entryFromFields(kind, key, raw))
    } catch (e) {
      if (!(e instanceof BibError)) throw e
      const line = r.s.slice(0, start).split('\n').length
      res.warnings.push(`Line ${line}: skipped a malformed entry (${e.message})`)
      r.i = start + 1
    }
  }
  return res
}

// ------------------------------------------------------- fields → model

const clean = (value: string) => stripBraces(latexToUnicode(value)).split(/\s+/).filter(Boolean).join(' ')

function dateFrom(raw: Map<string, string>): string {
  const date = raw.get('date')
  if (date) {
    const m = /^\s*(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(date)
    if (m) return [m[1], m[2], m[3]].filter(Boolean).map((g, i) => (i ? String(parseInt(g!, 10)).padStart(2, '0') : g)).join('-')
  }
  const y = /\d{4}/.exec(raw.get('year') ?? '')
  if (!y) return ''
  const month = (raw.get('month') ?? '').trim().toLowerCase().replace(/\.+$/, '')
  let mnum: number | undefined
  if (/^\d+$/.test(month)) {
    const n = parseInt(month, 10)
    mnum = n >= 1 && n <= 12 ? n : undefined
  } else mnum = MONTH_NAMES[month] ?? MONTH_NAMES[month.slice(0, 3)]
  return mnum ? `${y[0]}-${String(mnum).padStart(2, '0')}` : y[0]
}

const cleanPerson = (p: Person): Person => person(clean(p.family), clean(p.given), clean(p.literal))

export function entryFromFields(kind: string, key: string, raw: Map<string, string>): Entry {
  const [typ, thesis] = TYPE_IN[kind] ?? ['misc', '']
  const e = newEntry({ key, type: typ, thesis_type: thesis })
  e.authors = parseNames(raw.get('author') ?? '').map(cleanPerson)
  e.editors = parseNames(raw.get('editor') ?? '').map(cleanPerson)
  e.date = dateFrom(raw)
  const fields = e as unknown as Record<string, string>
  for (const [name, value] of raw) {
    const target = FIELD_IN[name]
    if (target) {
      if (fields[target]) continue // journal and journaltitle both present
      fields[target] = VERBATIM.has(name) ? value.trim() : clean(value)
    } else if (!DROPPED.has(name)) e.extra[name] = value.trim()
  }
  if (e.eprinttype) e.eprinttype = e.eprinttype.toLowerCase()
  const t = raw.get('type')
  if (t) {
    if (kind === 'thesis') {
      const tl = t.toLowerCase()
      e.thesis_type = tl.includes('phd') || tl.includes('doctor') ? 'phd' : tl.includes('master') || tl === 'mathesis' ? 'master' : t
    } else if (typ !== 'thesis') e.extra.type = t
  }
  const kw = raw.get('keywords') ?? ''
  if (kw) e.keywords = kw.split(/[;,]/).filter((k) => k.trim()).map(clean)
  if (e.doi) e.doi = e.doi.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '')
  return e
}

// ------------------------------------------------------- model → BibTeX

const TYPE_OUT_BIBTEX: Record<string, string> = {
  article: 'article', inproceedings: 'inproceedings', book: 'book', inbook: 'inbook', incollection: 'incollection', report: 'techreport',
  online: 'misc', dataset: 'misc', software: 'misc', patent: 'misc', unpublished: 'unpublished', misc: 'misc',
}

/** Python's str.islower(): has a cased character and none is upper case. */
const pyIsLower = (s: string) => s === s.toLowerCase() && s !== s.toUpperCase()

function nameOut(p: Person, asciiOnly: boolean): string {
  const enc = (s: string) => unicodeToLatex(s, asciiOnly)
  if (p.literal) return `{${enc(p.literal)}}`
  if (!p.given) return enc(p.family)
  let family = enc(p.family)
  // A family name with a space is braced unless it starts with a particle ("van der Berg").
  if (p.family.includes(' ') && !pyIsLower(p.family.split(/\s+/).filter(Boolean)[0])) family = `{${family}}`
  return `${family}, ${enc(p.given)}`
}

export function entryToBibtex(e: Entry, dialect: Dialect = 'biblatex'): string {
  const bl = dialect === 'biblatex'
  const asciiOnly = !bl
  const enc = (s: string) => unicodeToLatex(s, asciiOnly)
  const fields: [string, string][] = []
  const add = (name: string, value: string, raw = false) => {
    if (value) fields.push([name, raw ? value : enc(value)])
  }

  const kind = bl ? e.type : e.type === 'thesis' ? (e.thesis_type === 'master' ? 'mastersthesis' : 'phdthesis') : (TYPE_OUT_BIBTEX[e.type] ?? 'misc')

  if (e.authors.length) add('author', e.authors.map((p) => nameOut(p, asciiOnly)).join(' and '), true)
  if (e.editors.length) add('editor', e.editors.map((p) => nameOut(p, asciiOnly)).join(' and '), true)
  if (e.title) add('title', protectCase(enc(e.title)), true)
  if (e.subtitle) {
    if (bl) add('subtitle', protectCase(enc(e.subtitle)), true)
    else if (e.title) fields[fields.length - 1] = ['title', protectCase(enc(`${e.title}: ${e.subtitle}`))]
  }
  if (e.journal) add(bl ? 'journaltitle' : 'journal', e.journal)
  add('booktitle', e.booktitle)
  if (bl) add('date', e.date, true)
  else {
    add('year', year(e), true)
    const m = /^\d{4}-(\d{2})/.exec(e.date)
    if (m && +m[1] >= 1 && +m[1] <= 12) fields.push(['month', MONTHS[+m[1] - 1]])
  }
  add('volume', e.volume)
  add('number', e.number)
  add('pages', e.pages.replace(/[–—]/g, '--'))
  add('edition', e.edition)
  add('series', e.series)
  add('publisher', e.publisher)
  if (e.institution) {
    if (e.type === 'thesis' && !bl) add('school', e.institution)
    else if (['inproceedings', 'misc', 'online'].includes(e.type) && !bl) add('organization', e.institution)
    else add('institution', e.institution)
  }
  if (e.type === 'thesis' && bl && e.thesis_type) add('type', { phd: 'phdthesis', master: 'mathesis' }[e.thesis_type] ?? e.thesis_type)
  add(bl ? 'location' : 'address', e.location)
  add('doi', e.doi, true)
  add('url', e.url, true)
  add('isbn', e.isbn, true)
  add('issn', e.issn, true)
  if (e.eprint) {
    add('eprint', e.eprint, true)
    if (e.eprinttype) add(bl ? 'eprinttype' : 'archiveprefix', bl ? e.eprinttype : e.eprinttype.replace(/arxiv/g, 'arXiv'), true)
  }
  if (!bl && ['online', 'dataset', 'software'].includes(e.type) && e.url) add('howpublished', `\\url{${e.url}}`, true)
  if (!bl && e.type === 'unpublished' && !e.note && e.eprint) add('note', `arXiv:${e.eprint}`)
  add('note', e.note)
  add(bl ? 'langid' : 'language', e.language)
  if (e.keywords.length) add('keywords', e.keywords.join(', '))
  add('abstract', e.abstract)
  const taken = new Set(fields.map(([n]) => n))
  for (const name of Object.keys(e.extra).sort(cmpCodePoints)) if (!taken.has(name)) fields.push([name, e.extra[name]])

  const width = Math.max(0, ...fields.map(([n]) => n.length))
  const body = fields.map(([n, v]) => `  ${n.padEnd(width)} = {${v}}`).join(',\n')
  return `@${kind}{${e.key},\n${body}\n}\n`
}

export function sortByKey(entries: Iterable<Entry>): Entry[] {
  return [...entries].sort((a, b) => cmpCodePoints(a.key.toLowerCase(), b.key.toLowerCase()))
}

export function toBibtex(entries: Iterable<Entry>, dialect: Dialect = 'biblatex'): string {
  if (!DIALECTS.includes(dialect)) throw new Error(`unknown dialect ${dialect}`)
  return sortByKey(entries)
    .map((e) => entryToBibtex(e, dialect))
    .join('\n')
}
