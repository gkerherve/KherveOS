// Full-text search over entries with filters (pure). Operators can be typed in the box: tag:xrd project:ASP author:ana
// status:signed sample:S-0001 instrument:XPS from:2026-01-01 to:2026-03-31 is:favourite; "quoted phrases" and words are ANDed.

import { docInstruments } from './doc.ts'
import { dayOf, getProject, linkedSamples, isAmended, type Entry, type Notebook, type SearchFilters, type Status } from './model.ts'
import { entryText } from './render.ts'

export interface ParsedQuery {
  words: string[]
  filters: SearchFilters
}

const STATUSES = new Set(['draft', 'signed', 'witnessed', 'amended'])

/** Splits a typed query into free words and the filters its operators stand for. */
export function parseQuery(q: string): ParsedQuery {
  const filters: SearchFilters = {}
  const words: string[] = []
  const re = /(\w+):("[^"]*"|\S+)|"([^"]+)"|(\S+)/g
  for (let m = re.exec(q); m; m = re.exec(q)) {
    if (m[1]) {
      const key = m[1].toLowerCase()
      const val = m[2].replace(/^"|"$/g, '')
      if (key === 'tag') filters.tag = val
      else if (key === 'project') filters.project = val
      else if (key === 'author') filters.author = val
      else if (key === 'sample') filters.sample = val
      else if (key === 'instrument') filters.instrument = val
      else if (key === 'from') filters.from = val
      else if (key === 'to') filters.to = val
      else if (key === 'status' && STATUSES.has(val.toLowerCase())) filters.status = val.toLowerCase() as Status | 'amended'
      else if (key === 'is' && /^fav/i.test(val)) filters.favourite = true
      else words.push(`${m[1]}:${val}`.toLowerCase())
    } else if (m[3]) words.push(m[3].toLowerCase())
    else if (m[4]) words.push(m[4].toLowerCase())
  }
  return { words, filters }
}

export interface SearchHit {
  entry: Entry
  score: number
  snippet: string
}

/** True when the entry passes the filters (project may be an id or a code; names compare without case). */
export function matchesFilters(nb: Notebook, e: Entry, f: SearchFilters): boolean {
  const ci = (a: string, b: string): boolean => a.toLowerCase().includes(b.toLowerCase())
  if (f.project) {
    const p = getProject(nb, e.projectId)
    if (!(e.projectId === f.project || p?.code.toLowerCase() === f.project.toLowerCase() || (p && ci(p.name, f.project)))) return false
  }
  if (f.tag && !e.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase().replace(/^#/, ''))) return false
  if (f.author && !ci(e.author, f.author)) return false
  const day = dayOf(e.date)
  if (f.from && day < f.from) return false
  if (f.to && day > f.to) return false
  if (f.status) {
    if (f.status === 'amended' ? !isAmended(e) : e.status !== f.status) return false
  }
  if (f.sample && !linkedSamples(e).some((s) => s.toLowerCase() === f.sample!.toLowerCase())) return false
  if (f.instrument && !docInstruments(e.content).some((i) => ci(i, f.instrument!))) return false
  if (f.favourite && !e.favourite) return false
  return true
}

const countOf = (hay: string, needle: string): number => {
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0 && n < 20; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

function snippetOf(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, ' ')
  const low = flat.toLowerCase()
  const at = words.map((w) => low.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const from = Math.max(0, at - 40)
  return (from > 0 ? '…' : '') + flat.slice(from, from + 150) + (from + 150 < flat.length ? '…' : '')
}

/** Entries matching a query and filters, best first (no words: newest first). */
export function searchEntries(nb: Notebook, query: string, filters: SearchFilters = {}): SearchHit[] {
  const parsed = parseQuery(query)
  const f: SearchFilters = { ...filters, ...parsed.filters }
  const hits: SearchHit[] = []
  for (const e of nb.entries) {
    if (!matchesFilters(nb, e, f)) continue
    if (!parsed.words.length) { hits.push({ entry: e, score: 0, snippet: snippetOf(entryText(nb, e), []) }); continue }
    const text = entryText(nb, e)
    const low = text.toLowerCase()
    if (!parsed.words.every((w) => low.includes(w))) continue
    let score = 0
    for (const w of parsed.words) {
      score += (e.title.toLowerCase().includes(w) ? 6 : 0) + (e.experiment.toLowerCase().includes(w) ? 5 : 0) + (e.tags.some((t) => t.toLowerCase().includes(w)) ? 3 : 0) + Math.min(countOf(low, w), 8)
    }
    hits.push({ entry: e, score, snippet: snippetOf(text, parsed.words) })
  }
  return hits.sort((a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date))
}

/** True when nothing narrows the search. */
export const noFilters = (f: SearchFilters): boolean => !Object.values(f).some((v) => v !== undefined && v !== '' && v !== false)

/** Recent entries (by last change), favourites first when asked. */
export function recentEntries(nb: Notebook, limit = 10): Entry[] {
  return [...nb.entries].sort((a, b) => b.modified.localeCompare(a.modified) || b.date.localeCompare(a.date)).slice(0, limit)
}
