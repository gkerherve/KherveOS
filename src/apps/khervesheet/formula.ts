// Reading formulas while they are typed: the references they name (drawn as
// coloured boxes on the grid, like Excel and the desktop), where a clicked
// cell may be inserted, and the function under the caret (autocomplete and
// its help, from core/catalog).

import { colIndex, normRange, type Range } from './model'

/** The function catalogue core/catalog.py sends at start. */
export interface Catalog {
  categories: Record<string, string[]>
  order: string[]
  help: Record<string, string>
}

/** The desktop's reference highlight colours (CellFormatDelegate.REF_COLORS). */
export const REF_COLORS = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#e74c3c', '#9b59b6']

export interface RefToken {
  start: number
  end: number
  /** The sheet named before "!", or null. */
  sheet: string | null
  range: Range
  color: string
}

const STRING = /"(?:[^"]|"")*"/g
const TOKEN =
  /((?:'[^']+'|[A-Za-z_][\w.]*)\s*!\s*)?(\$?[A-Za-z]{1,3}\$?\d{1,7}(?:\s*:\s*\$?[A-Za-z]{1,3}\$?\d{1,7})?)(?![\w(])/g
const END = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/

/** The cell references in a formula, in order, each with its colour. */
export function refTokens(text: string): RefToken[] {
  if (!text.startsWith('=')) return []
  const masked = text.replace(STRING, (m) => ' '.repeat(m.length))
  const out: RefToken[] = []
  const colorOf = new Map<string, string>()
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(masked); m; m = TOKEN.exec(masked)) {
    const before = masked[m.index - 1] ?? ''
    if (/[\w.$]/.test(before)) continue
    const ends = m[2].split(':').map((p) => END.exec(p.replace(/\s/g, '')))
    if (ends.some((e) => !e)) continue
    const [a, b] = [ends[0]!, ends[ends.length - 1]!]
    const r1 = Number(a[2]) - 1
    const r2 = Number(b[2]) - 1
    if (r1 < 0 || r2 < 0) continue
    const sheet = m[1] ? m[1].replace(/\s*!\s*$/, '').replace(/^'|'$/g, '') : null
    const id = `${sheet ?? ''}!${m[2].replace(/[\s$]/g, '').toUpperCase()}`
    if (!colorOf.has(id)) colorOf.set(id, REF_COLORS[colorOf.size % REF_COLORS.length])
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      sheet,
      range: normRange(r1, colIndex(a[1]), r2, colIndex(b[1])),
      color: colorOf.get(id)!,
    })
  }
  return out
}

/** A clicked cell may be inserted at the caret (after "=", "(", ",", an operator). */
export function canInsertRef(text: string, caret: number): boolean {
  if (!text.startsWith('=') || /^\s*=PY(\s|$)/i.test(text)) return false
  const before = text.slice(0, caret).replace(/\s+$/, '')
  if (!before.length) return false
  const last = before[before.length - 1]
  if ('=(+-*/^,;:<>&'.includes(last)) {
    // Not inside a "text" literal.
    return (before.match(/"/g) ?? []).length % 2 === 0
  }
  return false
}

/** The word being typed just before the caret, if it can be a function name. */
export function wordBefore(text: string, caret: number): { start: number; word: string } | null {
  if (!text.startsWith('=') || /^\s*=PY(\s|$)/i.test(text)) return null
  const before = text.slice(0, caret)
  if ((before.match(/"/g) ?? []).length % 2 === 1) return null
  const m = /([A-Za-z][A-Za-z0-9_.]*)$/.exec(before)
  if (!m) return null
  const start = caret - m[1].length
  const prev = text.slice(0, start).replace(/\s+$/, '')
  if (prev.length && !'=(+-*/^,;:<>&'.includes(prev[prev.length - 1])) return null
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null
  return { start, word: m[1] }
}

/** The innermost function call around the caret and which argument it is in. */
export function callAt(text: string, caret: number): { name: string; arg: number } | null {
  if (!text.startsWith('=')) return null
  const stack: { name: string; arg: number }[] = []
  let inStr = false
  for (let i = 1; i < caret && i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (ch === '(') {
      const m = /([A-Za-z][A-Za-z0-9_.]*)\s*$/.exec(text.slice(0, i))
      stack.push({ name: m ? m[1].toUpperCase() : '', arg: 0 })
    } else if (ch === ')') stack.pop()
    else if ((ch === ',' || ch === ';') && stack.length) stack[stack.length - 1].arg++
  }
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return stack[i]
  return null
}

export function allFunctions(cat: Catalog): string[] {
  const set = new Set<string>()
  for (const name of cat.order) for (const f of cat.categories[name] ?? []) set.add(f)
  for (const fns of Object.values(cat.categories)) for (const f of fns) set.add(f)
  return [...set].sort()
}

/** Catalogue functions starting with `prefix` (dots and underscores alike). */
export function matchFunctions(all: string[], prefix: string, limit = 12): string[] {
  const p = prefix.toUpperCase().replace(/_/g, '.')
  if (!p) return []
  const starts = all.filter((f) => f.startsWith(p))
  return starts.slice(0, limit)
}

/** "SUM(number1, number2, ...)" and its one-line description. */
export function helpOf(cat: Catalog | null, name: string): { syntax: string; text: string } | null {
  if (!cat) return null
  const h = cat.help[name] ?? cat.help[name.replace(/_/g, '.')]
  if (!h) return null
  const [syntax, ...rest] = h.split('\n')
  return { syntax, text: rest.join(' ').trim() }
}

/** The catalogue category names without the menu's "&&". */
export const categoryLabel = (name: string) => name.replace(/&&/g, '&')

/** F4: cycle the reference at the caret A1 → $A$1 → A$1 → $A1 → A1 (sheet._toggle_absolute_ref). */
export function toggleAbsoluteRef(text: string, caret: number): { text: string; caret: number } | null {
  const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index
    const end = start + m[0].length
    if (start <= caret && caret <= end) {
      const [, dc, letters, dr, digits] = m
      const next = !dc && !dr ? `$${letters}$${digits}` : dc && dr ? `${letters}$${digits}` : !dc && dr ? `$${letters}${digits}` : `${letters}${digits}`
      return { text: text.slice(0, start) + next + text.slice(end), caret: start + next.length }
    }
  }
  return null
}
