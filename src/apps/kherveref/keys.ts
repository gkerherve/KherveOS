// Citation keys (the desktop's kherveref/keys.py): the short names LaTeX cites,
// e.g. \cite{smith2020deep}. Made when a reference enters the library, in the
// library's style, and not changed afterwards unless the user renames it.

import { year, type Entry } from './model.ts'

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'at', 'by', 'with', 'from', 'into', 'via', 'towards', 'toward', 'is', 'are', 'what',
  'how', 'why', 'do', 'does', 'le', 'la', 'les', 'un', 'une', 'des', 'der', 'die', 'das', 'el', 'los',
])

function ascii(s: string): string {
  return s
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export const KEY_STYLES: Record<string, string> = {
  author_year_word: 'smith2020surface — author, year and first title word',
  Author_Year: 'Smith2020 — author and year',
  author_year: 'smith2020 — author and year, lower case',
}
export const DEFAULT_KEY_STYLE = 'author_year_word'

export function baseKey(e: Entry, style = DEFAULT_KEY_STYLE): string {
  const people = e.authors.length ? e.authors : e.editors
  let name = ''
  if (people.length) {
    const p = people[0]
    const words = (s: string) => s.split(/\s+/).filter(Boolean)
    name = ascii(p.literal ? (words(p.literal)[0] ?? '') : p.family ? (words(p.family).at(-1) ?? '') : '')
  }
  name ||= 'anon'
  const y = year(e)
  if (style === 'Author_Year') return `${name[0].toUpperCase()}${name.slice(1)}${y}`.slice(0, 40)
  if (style === 'author_year') return `${name}${y}`.slice(0, 40)
  let word = ''
  for (const w of e.title.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!STOPWORDS.has(w.toLowerCase())) {
      word = ascii(w)
      if (word) break
    }
  }
  return `${name}${y}${word}`.slice(0, 40)
}

/** baseKey, with b, c… z, then 2, 3… appended on collision (case-insensitive: some file systems are). */
export function uniqueKey(e: Entry, taken: Iterable<string>, style = DEFAULT_KEY_STYLE): string {
  const used = new Set([...taken].map((k) => k.toLowerCase()))
  const base = baseKey(e, style)
  if (!used.has(base.toLowerCase())) return base
  for (const suffix of 'bcdefghijklmnopqrstuvwxyz') if (!used.has((base + suffix).toLowerCase())) return base + suffix
  let n = 2
  while (used.has(`${base}${n}`.toLowerCase())) n++
  return `${base}${n}`
}

/** Keys that are safe both in \cite{} and as a file name. */
export function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9_:\-./+]+$/.test(key) && key !== '.' && key !== '..' && !key.includes('/')
}
