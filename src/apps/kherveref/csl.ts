// CSL-JSON <-> model (the desktop's kherveref/csl.py). CSL-JSON is what DOI
// content negotiation (Crossref, DataCite) returns, what the KherveOS server's
// /api/refs lookups answer with, and what Zotero exports.

import { newEntry, person, type Entry, type Person } from './model.ts'

const TYPE_IN: Record<string, string> = {
  'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article', review: 'article',
  'journal-article': 'article', 'paper-conference': 'inproceedings', 'proceedings-article': 'inproceedings', book: 'book',
  monograph: 'book', 'edited-book': 'book', 'reference-book': 'book', chapter: 'incollection', 'book-chapter': 'incollection',
  'entry-encyclopedia': 'incollection', 'entry-dictionary': 'incollection', thesis: 'thesis', dissertation: 'thesis', report: 'report',
  webpage: 'online', 'post-weblog': 'online', post: 'online', dataset: 'dataset', software: 'software', patent: 'patent',
  manuscript: 'unpublished', 'posted-content': 'unpublished', preprint: 'unpublished',
}
const TYPE_OUT: Record<string, string> = {
  article: 'article-journal', inproceedings: 'paper-conference', book: 'book', inbook: 'chapter', incollection: 'chapter', thesis: 'thesis',
  report: 'report', online: 'webpage', dataset: 'dataset', software: 'software', patent: 'patent', unpublished: 'manuscript', misc: 'document',
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', deg: '°', times: '×', minus: '−', plusmn: '±', micro: 'µ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', Aring: 'Å', aring: 'å', eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä',
}

/** Python's html.unescape for the entities metadata services use. */
export function htmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[body] ?? m
  })
}

function text(v: unknown): string {
  if (Array.isArray(v)) v = v.length ? v[0] : ''
  const s = htmlUnescape(v === null || v === undefined ? '' : String(v)).replace(/<\/?(i|b|em|strong|sup|sub|scp|span|jats:[a-z]+)[^>]*>/g, '')
  return s.split(/\s+/).filter(Boolean).join(' ')
}

function cslPerson(d: Record<string, unknown>): Person {
  if (d.literal || d.name) return person('', '', text(d.literal || d.name))
  let family = text(d.family)
  const particle = text(d['non-dropping-particle'])
  if (particle) family = `${particle} ${family}`
  let given = text(d.given)
  if (d['dropping-particle']) given = `${given} ${text(d['dropping-particle'])}`.trim()
  if (d.suffix) family = `${family} ${text(d.suffix)}`
  return person(family, given)
}

function cslDate(d: unknown): string {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ''
  const o = d as Record<string, unknown>
  const dp = Array.isArray(o['date-parts']) ? (o['date-parts'] as unknown[]) : [[]]
  const first = Array.isArray(dp[0]) ? (dp[0] as unknown[]) : []
  const parts = first.filter((p) => p !== null && p !== undefined && p !== '')
  if (parts.length) {
    const rest = parts
      .slice(1, 3)
      .map((p) => parseInt(String(p), 10))
      .filter((n) => Number.isFinite(n))
      .map((n) => String(n).padStart(2, '0'))
    return [String(parts[0]), ...rest].join('-')
  }
  const m = /\d{4}/.exec(String(o.raw || o.literal || ''))
  return m ? m[0] : ''
}

const people = (v: unknown): Person[] =>
  (Array.isArray(v) ? v : []).filter((p) => p && typeof p === 'object').map((p) => cslPerson(p as Record<string, unknown>))

export function fromCsl(raw: unknown): Entry {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const typ = TYPE_IN[String(d.type ?? '').toLowerCase()] ?? 'misc'
  const e = newEntry({ type: typ })
  e.authors = people(d.author)
  e.editors = people(d.editor)
  e.title = text(d.title)
  e.subtitle = text(d.subtitle)
  const cont = text(d['container-title'])
  if (['incollection', 'inbook', 'inproceedings'].includes(typ)) e.booktitle = cont || text(d['event-title'] || d.event)
  else if (cont) e.journal = cont
  for (const k of ['issued', 'published-print', 'published-online', 'created']) {
    e.date = cslDate(d[k])
    if (e.date) break
  }
  e.publisher = text(d.publisher)
  e.location = text(d['publisher-place'])
  e.volume = text(d.volume)
  e.number = text(d.issue || d.number)
  e.pages = text(d.page).replace(/-/g, '–')
  e.edition = text(d.edition)
  e.series = text(d['collection-title'])
  e.doi = text(d.DOI)
  e.url = text(d.URL)
  if (e.doi && e.url.toLowerCase().includes(e.doi.toLowerCase())) e.url = '' // just the DOI again
  e.isbn = text(d.ISBN)
  e.issn = text(d.ISSN)
  e.abstract = text(d.abstract)
  e.language = text(d.language)
  e.note = typ !== 'misc' ? text(d.note) : ''
  if (typ === 'thesis') {
    e.institution = e.publisher
    e.publisher = ''
    const genre = text(d.genre).toLowerCase()
    e.thesis_type = genre.includes('phd') || genre.includes('doctor') ? 'phd' : genre.includes('master') ? 'master' : ''
  }
  if (typ === 'report' && e.publisher && !e.institution) {
    e.institution = e.publisher
    e.publisher = ''
  }
  const kw = d.keyword
  if (typeof kw === 'string' && kw) e.keywords = kw.split(/[;,]/).map((k) => k.trim()).filter(Boolean)
  if (typ === 'unpublished' && `${e.doi}${e.url}`.toLowerCase().includes('arxiv')) {
    const m = /(\d{4}\.\d{4,5})/.exec(`${e.doi} ${e.url}`)
    if (m) {
      e.eprint = m[1]
      e.eprinttype = 'arxiv'
    }
  }
  if (typeof d.id === 'string' && /^[A-Za-z][\w:-]*$/.test(d.id)) e.key = d.id
  return e
}

export function toCsl(e: Entry): Record<string, unknown> {
  const d: Record<string, unknown> = { id: e.key, type: TYPE_OUT[e.type] ?? 'document' }
  const p = (x: Person) => (x.literal ? { literal: x.literal } : x.given ? { family: x.family, given: x.given } : { family: x.family })
  if (e.authors.length) d.author = e.authors.map(p)
  if (e.editors.length) d.editor = e.editors.map(p)
  const pairs: Record<string, string> = {
    title: e.title, 'container-title': e.journal || e.booktitle,
    publisher: e.publisher || (['thesis', 'report'].includes(e.type) ? e.institution : ''), 'publisher-place': e.location,
    volume: e.volume, issue: e.number, page: e.pages.replace(/–/g, '-'), edition: e.edition, 'collection-title': e.series, DOI: e.doi,
    URL: e.url, ISBN: e.isbn, ISSN: e.issn, abstract: e.abstract, language: e.language, note: e.note,
  }
  for (const [k, v] of Object.entries(pairs)) if (v) d[k] = v
  if (e.date) {
    const parts = e.date.split('-').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
    if (parts.length) d.issued = { 'date-parts': [parts] }
  }
  if (e.keywords.length) d.keyword = e.keywords.join(', ')
  return d
}
