// Formatted citations and reference-list entries in common styles.
//
// The desktop KherveRef formats with citeproc-py and 35+ CSL style files; KherveOS
// has no CSL processor, so the most used styles are written out here by hand
// (same ids as the desktop's). Output is HTML (<i>, <b>) and plain text.
// Numbered styles have no number outside a document, so an in-text citation
// falls back to APA's author–date form, as on the desktop.

import { personShort, year, type Entry, type Person } from './model.ts'

export const STYLES: Record<string, string> = {
  apa: 'APA 7th (author–date)',
  'harvard-cite-them-right': 'Harvard (Cite Them Right)',
  'chicago-author-date': 'Chicago (author–date)',
  vancouver: 'Vancouver (numbered)',
  ieee: 'IEEE (numbered)',
  nature: 'Nature (numbered)',
  'american-chemical-society': 'ACS (numbered)',
}
export const DEFAULT_STYLE = 'apa'
export const isNumeric = (style: string) => (STYLES[style] ?? '').includes('(numbered)')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const i = (s: string) => (s ? `<i>${esc(s)}</i>` : '')
const b = (s: string) => (s ? `<b>${esc(s)}</b>` : '')

export function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** "John Ronald" → ["J", "R"]; "Jean-Paul" → ["J.-P"] style pieces (no dots). */
function initials(given: string, withDots: boolean): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .split('-')
        .map((part) => (part ? [...part][0].toUpperCase() + (withDots ? '.' : '') : ''))
        .join('-'),
    )
    .join(withDots ? ' ' : '')
}

/** "Family, I. I." */
const familyInitials = (p: Person) => (p.literal ? p.literal : p.given ? `${p.family}, ${initials(p.given, true)}` : p.family)
/** "I. I. Family" */
const initialsFamily = (p: Person) => (p.literal ? p.literal : p.given ? `${initials(p.given, true)} ${p.family}` : p.family)

/** a, b, c, & d — with `and` as the last joiner and `serial` for the comma before it. */
function joinNames(names: string[], and: string, serial = true): string {
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return `${names[0]}${serial && and.trim() === '&' ? ',' : ''} ${and} ${names[1]}`
  return `${names.slice(0, -1).join(', ')}${serial ? ',' : ''} ${and} ${names[names.length - 1]}`
}

const people = (e: Entry) => (e.authors.length ? e.authors : e.editors)
const ensureEnd = (s: string, ch = '.') => (!s || /[.?!]$/.test(htmlToText(s)) ? s : s + ch)
const pagesOf = (e: Entry) => e.pages.replace(/--?/g, '–')
const doiUrl = (e: Entry) => (e.doi ? `https://doi.org/${e.doi}` : e.url)
const isChapter = (e: Entry) => ['incollection', 'inbook', 'inproceedings'].includes(e.type)
const isBookLike = (e: Entry) => ['book', 'thesis', 'report'].includes(e.type)
const container = (e: Entry) => e.journal || e.booktitle
const arxiv = (e: Entry) => (e.eprinttype === 'arxiv' && e.eprint ? e.eprint : '')

// ---------------------------------------------------------- author–date

function authorDateNames(e: Entry, and: string): string {
  const ps = people(e)
  if (!ps.length) return ''
  if (ps.length > 2) return `${personShort(ps[0])} et al.`
  return ps.map(personShort).join(` ${and} `)
}

/** In-text citation of one or more references: "(Smith & Jones, 2020; Doe et al., 2019)". */
export function formatCitation(entries: Entry[], style = DEFAULT_STYLE): string {
  const st = isNumeric(style) ? DEFAULT_STYLE : style
  const and = st === 'apa' ? '&' : 'and'
  const sep = st === 'chicago-author-date' ? ' ' : ', '
  const parts = entries.map((e) => {
    const who = authorDateNames(e, and) || (e.title ? `“${e.title.split(/\s+/).slice(0, 4).join(' ')}”` : e.key)
    return `${who}${sep}${year(e) || 'n.d.'}`
  })
  return `(${parts.join('; ')})`
}

function apa(e: Entry): string {
  const ps = people(e)
  let names = ''
  if (ps.length) {
    const list = ps.length > 20 ? [...ps.slice(0, 19).map(familyInitials), '…', familyInitials(ps[ps.length - 1])] : ps.map(familyInitials)
    names = ps.length > 20 ? list.join(', ') : joinNames(list, '&')
    if (!e.authors.length) names += ps.length > 1 ? ' (Eds.)' : ' (Ed.)'
  }
  const date = `(${year(e) || 'n.d.'}).`
  const tail = doiUrl(e) ? ` ${esc(doiUrl(e))}` : ''
  let body: string
  if (e.type === 'article' && e.journal) {
    const vol = e.volume ? `, ${i(e.volume)}${e.number ? `(${esc(e.number)})` : ''}` : ''
    body = `${esc(ensureEnd(e.title))} ${i(e.journal)}${vol}${e.pages ? `, ${esc(pagesOf(e))}` : ''}.`
  } else if (isChapter(e)) {
    const eds = e.editors.length ? `${joinNames(e.editors.map(initialsFamily), '&')} (${e.editors.length > 1 ? 'Eds.' : 'Ed.'}), ` : ''
    const pp = e.pages ? ` (pp. ${esc(pagesOf(e))})` : ''
    body = `${esc(ensureEnd(e.title))} In ${esc(eds)}${i(container(e))}${pp}.${e.publisher ? ` ${esc(e.publisher)}.` : ''}`
  } else if (e.type === 'thesis') {
    const kind = e.thesis_type === 'master' ? "Master's thesis" : 'Doctoral dissertation'
    body = `${i(e.title)} [${kind}${e.institution ? `, ${esc(e.institution)}` : ''}].`
  } else if (isBookLike(e)) {
    const ed = e.edition ? ` (${esc(e.edition)}${/^\d+$/.test(e.edition) ? ordinal(+e.edition) : ''} ed.)` : ''
    body = `${i(e.title)}${ed}.${e.publisher || e.institution ? ` ${esc(e.publisher || e.institution)}.` : ''}`
  } else {
    const where = arxiv(e) ? 'arXiv' : container(e) || e.publisher || e.institution
    body = `${i(e.title)}.${where ? ` ${esc(where)}.` : ''}`
  }
  return `${names ? `${esc(ensureEnd(names))} ` : ''}${date} ${body}${tail}`
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return s
}

function harvard(e: Entry): string {
  const ps = people(e)
  const names = ps.length > 3 ? `${familyInitials(ps[0])} et al.` : joinNames(ps.map(familyInitials), 'and', false)
  const y = `(${year(e) || 'no date'})`
  const tail = e.doi ? ` doi:${esc(e.doi)}.` : e.url ? ` Available at: ${esc(e.url)}.` : ''
  let body: string
  if (e.type === 'article' && e.journal) {
    const vol = [e.volume, e.number ? `(${e.number})` : ''].join('')
    body = `‘${esc(e.title)}’, ${i(e.journal)}${vol ? `, ${esc(vol)}` : ''}${e.pages ? `, pp. ${esc(pagesOf(e))}` : ''}.`
  } else if (isChapter(e)) {
    body = `‘${esc(e.title)}’, in ${i(container(e))}.${e.publisher ? ` ${esc(e.publisher)}` : ''}${e.pages ? `, pp. ${esc(pagesOf(e))}` : ''}.`
  } else if (e.type === 'thesis') {
    body = `${i(e.title)}. ${e.thesis_type === 'master' ? 'MSc' : 'PhD'} thesis${e.institution ? `. ${esc(e.institution)}` : ''}.`
  } else {
    const pub = e.publisher || e.institution || (arxiv(e) ? 'arXiv' : container(e))
    body = `${i(e.title)}.${e.location && pub ? ` ${esc(e.location)}: ${esc(pub)}.` : pub ? ` ${esc(pub)}.` : ''}`
  }
  return `${names ? `${esc(names)} ` : ''}${y} ${body}${tail}`
}

function chicago(e: Entry): string {
  const ps = people(e)
  const full = (p: Person, first: boolean) => (p.literal ? p.literal : p.given ? (first ? `${p.family}, ${p.given}` : `${p.given} ${p.family}`) : p.family)
  const list = ps.length > 10 ? [...ps.slice(0, 7).map((p, k) => full(p, k === 0)), 'et al.'] : ps.map((p, k) => full(p, k === 0))
  const names = ps.length > 10 ? list.join(', ') : joinNames(list, 'and')
  const tail = doiUrl(e) ? ` ${esc(doiUrl(e))}.` : ''
  let body: string
  if (e.type === 'article' && e.journal) {
    const vol = e.volume ? ` ${esc(e.volume)}${e.number ? ` (${esc(e.number)})` : ''}` : ''
    body = `“${esc(ensureEnd(e.title))}” ${i(e.journal)}${vol}${e.pages ? `: ${esc(pagesOf(e))}` : ''}.`
  } else if (isChapter(e)) {
    body = `“${esc(ensureEnd(e.title))}” In ${i(container(e))}${e.pages ? `, ${esc(pagesOf(e))}` : ''}.${e.publisher ? ` ${e.location ? `${esc(e.location)}: ` : ''}${esc(e.publisher)}.` : ''}`
  } else {
    const pub = e.publisher || e.institution || (arxiv(e) ? 'arXiv' : container(e))
    body = `${i(ensureEnd(e.title))}${pub ? ` ${e.location ? `${esc(e.location)}: ` : ''}${esc(pub)}.` : ''}`
  }
  return `${names ? `${esc(ensureEnd(names))} ` : ''}${year(e) || 'n.d.'}. ${body}${tail}`
}

// ------------------------------------------------------------- numbered

function vancouver(e: Entry): string {
  const ps = people(e)
  const v = (p: Person) => (p.literal ? p.literal : p.given ? `${p.family} ${initials(p.given, false).replace(/-/g, '')}` : p.family)
  const names = ps.length > 6 ? `${ps.slice(0, 6).map(v).join(', ')}, et al.` : ps.map(v).join(', ')
  const tail = e.doi ? ` doi:${esc(e.doi)}` : e.url ? ` Available from: ${esc(e.url)}` : ''
  let body: string
  if (e.type === 'article' && e.journal) {
    const vol = `${e.volume}${e.number ? `(${e.number})` : ''}`
    body = `${esc(ensureEnd(e.title))} ${esc(e.journal)}. ${year(e)}${vol ? `;${esc(vol)}` : ''}${e.pages ? `:${esc(pagesOf(e))}` : ''}.`
  } else if (isChapter(e)) {
    body = `${esc(ensureEnd(e.title))} In: ${esc(container(e))}.${e.publisher ? ` ${e.location ? `${esc(e.location)}: ` : ''}${esc(e.publisher)};` : ''} ${year(e)}.${e.pages ? ` p. ${esc(pagesOf(e))}.` : ''}`
  } else {
    const pub = e.publisher || e.institution || (arxiv(e) ? 'arXiv' : '')
    body = `${esc(ensureEnd(e.title))}${pub ? ` ${e.location ? `${esc(e.location)}: ` : ''}${esc(pub)};` : ''} ${year(e)}.`
  }
  return `${names ? `${esc(ensureEnd(names))} ` : ''}${body}${tail}`
}

const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

function ieee(e: Entry): string {
  const ps = people(e)
  const names = ps.length > 6 ? `${initialsFamily(ps[0])} et al.` : joinNames(ps.map(initialsFamily), 'and')
  const m = /^\d{4}-(\d{2})/.exec(e.date)
  const when = `${m && +m[1] >= 1 && +m[1] <= 12 ? `${MONTH_ABBR[+m[1] - 1]} ` : ''}${year(e)}`
  const tail = e.doi ? `, doi: ${esc(e.doi)}.` : '.'
  let body: string
  if (e.type === 'article' && e.journal) {
    const bits = [i(e.journal), e.volume && `vol. ${esc(e.volume)}`, e.number && `no. ${esc(e.number)}`, e.pages && `pp. ${esc(pagesOf(e))}`, when && esc(when)]
    body = `“${esc(e.title)},” ${bits.filter(Boolean).join(', ')}`
  } else if (isChapter(e)) {
    const bits = [`in ${i(container(e))}`, e.location && e.publisher ? `${esc(e.location)}: ${esc(e.publisher)}` : esc(e.publisher), esc(when), e.pages && `pp. ${esc(pagesOf(e))}`]
    body = `“${esc(e.title)},” ${bits.filter(Boolean).join(', ')}`
  } else if (arxiv(e)) {
    body = `“${esc(e.title)},” ${esc(when)}, arXiv:${esc(arxiv(e))}`
  } else {
    const pub = e.publisher || e.institution
    body = `${i(e.title)}. ${pub ? `${e.location ? `${esc(e.location)}: ` : ''}${esc(pub)}, ` : ''}${esc(when)}`
  }
  return `${names ? `${esc(names)}, ` : ''}${body}${tail}`
}

function nature(e: Entry): string {
  const ps = people(e)
  const list = ps.map(familyInitials)
  const names = ps.length > 5 ? `${list[0]} et al.` : list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}` : list.join('')
  const tail = doiUrl(e) ? ` ${esc(doiUrl(e))}` : ''
  let body: string
  if (e.type === 'article' && e.journal) body = `${esc(ensureEnd(e.title))} ${i(e.journal)} ${b(e.volume)}${e.pages ? `, ${esc(pagesOf(e))}` : ''} (${year(e)}).`
  else if (isChapter(e)) body = `${esc(ensureEnd(e.title))} in ${i(container(e))}${e.pages ? ` ${esc(pagesOf(e))}` : ''} (${esc([e.publisher, year(e)].filter(Boolean).join(', '))}).`
  else body = `${i(e.title)} (${esc([e.publisher || e.institution || (arxiv(e) ? 'arXiv' : ''), year(e)].filter(Boolean).join(', '))}).`
  return `${names ? `${esc(ensureEnd(names))} ` : ''}${body}${tail}`
}

function acs(e: Entry): string {
  const ps = people(e)
  const names = ps.map(familyInitials).join('; ')
  const tail = e.doi ? ` https://doi.org/${esc(e.doi)}.` : ''
  let body: string
  if (e.type === 'article' && e.journal) {
    body = `${esc(ensureEnd(e.title))} ${i(e.journal)} ${b(year(e))}${e.volume ? `, ${i(e.volume)}` : ''}${e.number ? ` (${esc(e.number)})` : ''}${e.pages ? `, ${esc(pagesOf(e))}` : ''}.`
  } else if (isChapter(e)) {
    body = `${esc(ensureEnd(e.title))} In ${i(container(e))};${e.publisher ? ` ${esc(e.publisher)}${e.location ? `: ${esc(e.location)}` : ''},` : ''} ${year(e)}${e.pages ? `; pp ${esc(pagesOf(e))}` : ''}.`
  } else {
    const pub = e.publisher || e.institution || (arxiv(e) ? 'arXiv' : '')
    body = `${i(e.title)};${pub ? ` ${esc(pub)}${e.location ? `: ${esc(e.location)}` : ''},` : ''} ${year(e)}.`
  }
  return `${names ? `${esc(ensureEnd(names))} ` : ''}${body}${tail}`
}

const FORMATTERS: Record<string, (e: Entry) => string> = {
  apa, 'harvard-cite-them-right': harvard, 'chicago-author-date': chicago, vancouver, ieee, nature, 'american-chemical-society': acs,
}

/** One reference-list entry (HTML). Numbered styles get their label from `n` (1-based). */
export function formatReference(e: Entry, style = DEFAULT_STYLE, n?: number): string {
  const html = (FORMATTERS[style] ?? apa)(e).replace(/\s+/g, ' ').replace(/ ([.,;:])/g, '$1').trim()
  if (n === undefined || !isNumeric(style)) return html
  if (style === 'ieee') return `[${n}] ${html}`
  if (style === 'american-chemical-society') return `(${n}) ${html}`
  return `${n}. ${html}`
}

/** A reference list: author–date styles sorted by author and year, numbered ones in the given order. */
export function formatBibliography(entries: Entry[], style = DEFAULT_STYLE): string[] {
  const list = isNumeric(style)
    ? entries
    : [...entries].sort((a, b) => {
        const ka = `${(people(a)[0] && personShort(people(a)[0])) || a.title} ${year(a)}`.toLowerCase()
        const kb = `${(people(b)[0] && personShort(people(b)[0])) || b.title} ${year(b)}`.toLowerCase()
        return ka.localeCompare(kb)
      })
  return list.map((e, k) => formatReference(e, style, k + 1))
}
