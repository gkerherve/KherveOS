// Small tables of text (pasted or from a .csv / .tsv / .txt file): the delimiter is
// guessed from the first line, and a first row with any non-number is the header.
// Used by kStats and kPlot.

export interface Table {
  headers: string[]
  rows: string[][]
}

/** The most likely delimiter of a text: tab, semicolon or comma. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  let best = ','
  for (const d of ['\t', ';']) if (first.split(d).length > first.split(best).length) best = d
  return best
}

/** A number as people write it: "1,5" and "1.5" are both 1.5 when the cell is only a number. */
export function toNumber(cell: string | undefined): number {
  if (cell === undefined) return NaN
  const t = cell.trim().replace(/^"|"$/g, '')
  if (/^[-+]?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'))
  return t === '' ? NaN : Number(t)
}

export function parseTable(text: string, delimiter = detectDelimiter(text)): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const cells = lines.map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '')))
  if (cells.length === 0) return { headers: [], rows: [] }
  const width = Math.max(...cells.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const isHeader = cells[0].some((c) => c !== '' && Number.isNaN(toNumber(c)))
  const body = (isHeader ? cells.slice(1) : cells).map(pad)
  const headers = isHeader ? pad(cells[0]).map((h, i) => h || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`)
  return { headers, rows: body }
}

/** The numbers of one column (cells that are not numbers are left out). */
export function column(table: Table, index: number): number[] {
  return table.rows.map((r) => toNumber(r[index])).filter((v) => Number.isFinite(v))
}

/** Pairs of (x, y) where both are numbers, in row order. */
export function pairs(table: Table, xi: number, yi: number): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  for (const r of table.rows) {
    const a = toNumber(r[xi])
    const b = toNumber(r[yi])
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a)
      y.push(b)
    }
  }
  return { x, y }
}
