// Copy and paste. The system clipboard gets tab-separated text (what the
// cells show), which every spreadsheet and text editor understands. A copy
// made here also remembers the cells' sources and formats, shared by every
// KherveSheet window (like the desktop's _CELL_CLIPBOARD); pasting text that
// matches it pastes the formulas (their references shifted) and formats.

import type { Fmt, Range } from './model'

export interface Clip {
  /** The text put on the system clipboard. */
  text: string
  sheetId: string
  range: Range
  /** Each cell's source, row by row ("" for empty). */
  sources: string[][]
  /** Each cell's shown text. */
  texts: string[][]
  formats: (Fmt | undefined)[][]
}

let current: Clip | null = null

export const setClip = (c: Clip | null) => {
  current = c
}
export const getClip = () => current

/** The internal copy, if the clipboard still holds what it put there. */
export function clipFor(text: string): Clip | null {
  if (!current) return null
  const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n$/, '')
  return norm(current.text) === norm(text) ? current : null
}

const needsQuotes = /[\t\n\r"]/

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((v) => (needsQuotes.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t')).join('\n')
}

/** Tab-separated text as rows of fields; quoted fields may hold tabs and line breaks. */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  let atStart = true
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && atStart) {
      quoted = true
      atStart = false
      i++
      continue
    }
    if (ch === '\t') {
      row.push(field)
      field = ''
      atStart = true
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      atStart = true
      i++
      continue
    }
    field += ch
    atStart = false
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
