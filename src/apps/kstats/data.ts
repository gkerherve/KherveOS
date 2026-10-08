// The data table of kStats: reading and writing text, cleaning, sorting, adding and removing
// columns. Pure (no browser). The reader is the shared one (src/os/table.ts) plus quoted fields.

import { detectDelimiter, parseTable, toNumber, type Table } from '../../os/table.ts'

export type { Table }

export interface Data {
  table: Table
  /** Columns left out of the analyses (parallel to table.headers). */
  ignored: boolean[]
}

/** Split text into cells, honouring "quoted, fields" and doubled quotes. */
function splitQuoted(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Text → table. Quoted fields are understood; the first row is the header if it has words in it. */
export function readTable(text: string): Table {
  if (!text.includes('"')) return parseTable(text)
  const cells = splitQuoted(text, detectDelimiter(text)).map((r) => r.map((c) => c.trim()))
  if (cells.length === 0) return { headers: [], rows: [] }
  const width = Math.max(...cells.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const isHeader = cells[0].some((c) => c !== '' && Number.isNaN(toNumber(c)))
  const body = (isHeader ? cells.slice(1) : cells).map(pad)
  const headers = isHeader ? pad(cells[0]).map((h, i) => h || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`)
  return { headers, rows: body }
}

export const fromCsv = readTable

export function parseData(text: string): Data {
  const table = readTable(text)
  return { table, ignored: table.headers.map(() => false) }
}

const quote = (c: string, d: string) => (c.includes(d) || c.includes('"') || /[\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)

/** The table as CSV (a cell with a comma, a quote or a line break is quoted). */
export function toCsv(table: Table, delimiter = ','): string {
  return [table.headers, ...table.rows].map((r) => r.map((c) => quote(c, delimiter)).join(delimiter)).join('\n') + '\n'
}

/** Tab-separated text, without the ignored columns (for the clipboard and for kPlot). */
export function toTsv(table: Table, ignored: boolean[] = []): string {
  const keep = table.headers.map((_, i) => !ignored[i])
  const clean = (c: string) => c.replace(/[\t\r\n]+/g, ' ')
  return [table.headers, ...table.rows].map((r) => r.filter((_, i) => keep[i]).map(clean).join('\t')).join('\n')
}

/** The numbers of one column and the (0-based) rows they come from. */
export function columnValues(table: Table, ci: number): { values: number[]; rows: number[] } {
  const values: number[] = []
  const rows: number[] = []
  table.rows.forEach((r, i) => {
    const v = toNumber(r[ci])
    if (Number.isFinite(v)) {
      values.push(v)
      rows.push(i)
    }
  })
  return { values, rows }
}

/** A column as an array aligned with the rows (NaN where the cell is not a number). */
export function columnAligned(table: Table, ci: number): number[] {
  return table.rows.map((r) => toNumber(r[ci]))
}

/** The rows whose cells are numbers in all these columns, and how many rows were left out. */
export function cleanRows(table: Table, cols: number[]): { kept: number[]; dropped: number } {
  const kept: number[] = []
  table.rows.forEach((r, i) => {
    if (cols.every((c) => Number.isFinite(toNumber(r[c])))) kept.push(i)
  })
  return { kept, dropped: table.rows.length - kept.length }
}

/** x and y (and optional uncertainties) from the rows where all are numbers. */
export function xySigma(table: Table, xi: number, yi: number, si = -1) {
  const cols = si >= 0 ? [xi, yi, si] : [xi, yi]
  const { kept, dropped } = cleanRows(table, cols)
  return {
    x: kept.map((i) => toNumber(table.rows[i][xi])),
    y: kept.map((i) => toNumber(table.rows[i][yi])),
    sigma: si >= 0 ? kept.map((i) => toNumber(table.rows[i][si])) : undefined,
    rows: kept,
    dropped,
    total: table.rows.length,
  }
}

/** Columns that are not ignored and hold at least one number. */
export function usableColumns(data: Data): number[] {
  const out: number[] = []
  data.table.headers.forEach((_, i) => {
    if (!data.ignored[i] && data.table.rows.some((r) => Number.isFinite(toNumber(r[i])))) out.push(i)
  })
  return out
}

/** The table with the rows ordered by a column (numbers by value, else alphabetically; blanks last). */
export function sortRows(table: Table, ci: number, ascending = true): Table {
  const rows = [...table.rows]
  const dir = ascending ? 1 : -1
  rows.sort((a, b) => {
    const ea = (a[ci] ?? '').trim() === ''
    const eb = (b[ci] ?? '').trim() === ''
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
    const na = toNumber(a[ci])
    const nb = toNumber(b[ci])
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir
    return a[ci].localeCompare(b[ci], undefined, { numeric: true }) * dir
  })
  return { ...table, rows }
}

export function addColumn(data: Data, name?: string): Data {
  const n = data.table.headers.length
  return {
    table: {
      headers: [...data.table.headers, name ?? `column ${n + 1}`],
      rows: data.table.rows.map((r) => [...r, '']),
    },
    ignored: [...data.ignored, false],
  }
}

export function deleteColumn(data: Data, ci: number): Data {
  return {
    table: { headers: data.table.headers.filter((_, i) => i !== ci), rows: data.table.rows.map((r) => r.filter((_, i) => i !== ci)) },
    ignored: data.ignored.filter((_, i) => i !== ci),
  }
}

export function renameColumn(data: Data, ci: number, name: string): Data {
  return { ...data, table: { ...data.table, headers: data.table.headers.map((h, i) => (i === ci ? name : h)) } }
}

export function addRow(data: Data, at?: number): Data {
  const blank = data.table.headers.map(() => '')
  const rows = [...data.table.rows]
  rows.splice(at ?? rows.length, 0, blank)
  return { ...data, table: { ...data.table, rows } }
}

export function deleteRows(data: Data, which: number[]): Data {
  const gone = new Set(which)
  return { ...data, table: { ...data.table, rows: data.table.rows.filter((_, i) => !gone.has(i)) } }
}

export function setCell(data: Data, r: number, c: number, value: string): Data {
  const rows = data.table.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row))
  return { ...data, table: { ...data.table, rows } }
}

/** Paste a block of cells (rows of text) with its top-left corner at (r, c), growing the table when needed. */
export function pasteBlock(data: Data, r: number, c: number, block: string[][]): Data {
  let d = data
  const width = Math.max(...block.map((b) => b.length))
  while (d.table.headers.length < c + width) d = addColumn(d)
  while (d.table.rows.length < r + block.length) d = addRow(d)
  const rows = d.table.rows.map((row) => [...row])
  block.forEach((cells, i) => cells.forEach((v, j) => { rows[r + i][c + j] = v }))
  return { ...d, table: { ...d.table, rows } }
}
