// kPlot's data: editing a table (columns, rows, sort, computed columns), turning the table and
// the options into the figure the engines draw, and the .kplot project file.
// Pure TypeScript (the shared table reader is src/os/table.ts).

import { detectDelimiter, parseTable, toNumber, type Table } from '../../os/table.ts'
import { ExprError, columnLookup, parseExpr, evalExpr } from './expr.ts'
import { sd } from './fit.ts'
import { cleanOptions, isPlotlyOnly, newSeriesOpt, type FigureInput, type Options, type Series, type SeriesOpt } from './figure.ts'

export type { Table }
export { detectDelimiter, parseTable, toNumber }

export const SAMPLE = 'temperature (K),conductivity (S/m),reference (S/m)\n100,1.2,1.1\n150,2.4,2.5\n200,3.9,4.0\n250,5.1,5.2\n300,6.6,6.4\n350,8.0,8.1\n'

// ------------------------------------------------------------------ the table as text

/** CSV (tabs when a cell has a comma). */
export function tableToText(t: Table): string {
  if (!t.headers.length) return ''
  const sep = [...t.headers, ...t.rows.flat()].some((c) => c.includes(',')) ? '\t' : ','
  return [t.headers, ...t.rows].map((r) => r.join(sep)).join('\n') + '\n'
}

export const cloneTable = (t: Table): Table => ({ headers: [...t.headers], rows: t.rows.map((r) => [...r]) })

/** A cell for a number: 12 significant digits, no binary noise. */
export function cellText(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toPrecision(12))) : ''
}

// ------------------------------------------------------------------ editing

export function uniqueHeader(t: Table, wanted: string): string {
  const base = wanted.trim() || 'column'
  const have = new Set(t.headers.map((h) => h.toLowerCase()))
  if (!have.has(base.toLowerCase())) return base
  for (let k = 2; ; k++) if (!have.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`
}

export function addColumn(t: Table, name: string, values?: string[]): Table {
  const out = cloneTable(t)
  out.headers.push(uniqueHeader(t, name))
  out.rows.forEach((r, i) => r.push(values?.[i] ?? ''))
  return out
}

export function removeColumn(t: Table, i: number): Table {
  const out = cloneTable(t)
  out.headers.splice(i, 1)
  out.rows.forEach((r) => r.splice(i, 1))
  return out
}

export function renameColumn(t: Table, i: number, name: string): Table {
  const out = cloneTable(t)
  out.headers[i] = name.trim() || `column ${i + 1}`
  return out
}

export function addRow(t: Table): Table {
  const out = cloneTable(t)
  out.rows.push(out.headers.map(() => ''))
  return out
}

export function removeRow(t: Table, i: number): Table {
  const out = cloneTable(t)
  out.rows.splice(i, 1)
  return out
}

export function setCell(t: Table, r: number, c: number, value: string): Table {
  const rows = t.rows.slice()
  rows[r] = rows[r].slice()
  rows[r][c] = value
  return { headers: t.headers, rows }
}

/** Sort the rows by a column: numbers by value, otherwise as text; empty cells last. */
export function sortByColumn(t: Table, col: number, descending = false): Table {
  const cells = t.rows.map((r) => r[col] ?? '')
  const numeric = cells.every((c) => c.trim() === '' || Number.isFinite(toNumber(c)))
  const sign = descending ? -1 : 1
  const rows = t.rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const ca = (a.r[col] ?? '').trim()
    const cb = (b.r[col] ?? '').trim()
    if (ca === '' || cb === '') return ca === cb ? a.i - b.i : ca === '' ? 1 : -1
    const d = numeric ? toNumber(ca) - toNumber(cb) : ca.localeCompare(cb)
    return d === 0 ? a.i - b.i : d * sign
  })
  return { headers: t.headers, rows: rows.map((x) => x.r) }
}

export function dropEmptyRows(t: Table): Table {
  return { headers: t.headers, rows: t.rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => [...r]) }
}

/** A new column from an expression of the others: `a*2+1`, `log10([signal (V)])`, `x`, `i` (the row number), `c2`… */
export function computeColumn(t: Table, name: string, expression: string, xi = 0): Table {
  const tree = parseExpr(expression)
  const values = t.rows.map((row, i) => {
    const lookup = columnLookup(t.headers, row, toNumber, { x: toNumber(row[xi]), i: i + 1, row: i + 1 })
    try {
      return cellText(evalExpr(tree, lookup))
    } catch (e) {
      if (e instanceof ExprError && /^Unknown name/.test(e.message)) throw e
      return ''
    }
  })
  if (t.rows.length === 0) evalExpr(tree, () => 1) // still report unknown names
  return addColumn(t, name, values)
}

// ------------------------------------------------------------------ options follow the columns

/** Options after column `i` has been removed from the table. */
export function optionsAfterRemove(opt: Options, i: number): Options {
  const shift = (c: number) => (c > i ? c - 1 : c)
  return {
    ...opt,
    xi: Math.max(0, shift(opt.xi === i ? 0 : opt.xi)),
    series: opt.series.filter((s) => s.col !== i).map((s) => ({ ...s, col: shift(s.col), errCol: s.errCol === i ? -1 : s.errCol > i ? s.errCol - 1 : s.errCol, errors: s.errCol === i && s.errors === 'column' ? 'none' : s.errors })),
  }
}

/** Options that fit the table: columns that do not exist are dropped. */
export function fitOptions(opt: Options, t: Table): Options {
  const w = t.headers.length
  const xi = Math.min(Math.max(0, opt.xi), Math.max(0, w - 1))
  const seen = new Set<number>()
  const series: SeriesOpt[] = []
  const usesX = !['histogram', 'box', 'violin', 'matrix'].includes(opt.type)
  for (const s of opt.series) {
    if (s.col >= w || (usesX && s.col === xi) || seen.has(s.col)) continue
    seen.add(s.col)
    series.push(s.errCol >= w ? { ...s, errCol: -1, errors: s.errors === 'column' ? 'none' : s.errors } : s)
  }
  return { ...opt, xi, series }
}

/** Whether most filled cells of a column are numbers. */
export function isNumericColumn(t: Table, i: number): boolean {
  const cells = t.rows.map((r) => (r[i] ?? '').trim()).filter((c) => c !== '')
  return cells.length > 0 && cells.filter((c) => Number.isFinite(toNumber(c))).length >= cells.length / 2
}

/** The columns to plot by default: the numeric ones besides the x column (at most 6). */
export function autoSeries(t: Table, xi: number): SeriesOpt[] {
  const cols = t.headers.map((_, i) => i).filter((i) => i !== xi && isNumericColumn(t, i))
  return cols.slice(0, 6).map((c) => newSeriesOpt(c))
}

/** Options for a newly loaded table: the style stays, the columns are chosen again (the first column is x). */
export function withNewData(opt: Options, t: Table): Options {
  const xi = 0
  return { ...opt, xi, series: autoSeries(t, xi), fits: [], notes: [], lines: [], regions: [] }
}

/** The options after the table changed: columns that are gone are dropped, and an empty choice is filled in. */
export function withTable(opt: Options, t: Table): Options {
  const o = fitOptions(opt, t)
  return o.series.length ? o : { ...o, series: autoSeries(t, o.xi) }
}

// ------------------------------------------------------------------ the figure

function axisValues(cells: string[]): (number | string)[] {
  const nums = cells.map(toNumber)
  return nums.every(Number.isFinite) ? nums : cells.map((c, i) => c || String(i + 1))
}

/** What the engines draw for this table and these options. */
export function buildFigure(table: Table, rawOpt: Options): FigureInput {
  const opt = fitOptions(rawOpt, table)
  const H = table.headers
  const type = opt.type
  const rows = table.rows
  const xName = H[opt.xi] ?? ''
  const nameOf = (s: SeriesOpt) => s.name || H[s.col] || `column ${s.col + 1}`
  const series: Series[] = []

  const errorsFor = (so: SeriesOpt, yAll: number[], idx: number[]): number[] | undefined => {
    if (so.errors === 'column' && so.errCol >= 0) return idx.map((r) => Math.abs(toNumber(rows[r][so.errCol])) || 0)
    if (so.errors === 'sd') {
      const e = sd(yAll.filter(Number.isFinite))
      return idx.map(() => e)
    }
    return undefined
  }

  let categories: string[] | undefined
  let matrix: FigureInput['matrix']

  if (type === 'bar' || type === 'stacked') {
    categories = rows.map((r, k) => (r[opt.xi] ?? '').trim() || String(k + 1))
    for (const so of opt.series) {
      const all = rows.map((r) => toNumber(r[so.col]))
      const idx = rows.map((_, k) => k)
      series.push({ ...style(so), name: nameOf(so), x: idx, y: all, err: errorsFor(so, all, idx) })
    }
  } else if (type === 'histogram' || type === 'box' || type === 'violin') {
    for (const so of opt.series) {
      const y = rows.map((r) => toNumber(r[so.col])).filter(Number.isFinite)
      series.push({ ...style(so), name: nameOf(so), x: y.map((_, k) => k), y })
    }
  } else if (type === 'matrix') {
    for (const so of opt.series) {
      const y = rows.map((r) => toNumber(r[so.col]))
      series.push({ ...style(so), name: nameOf(so), x: y.map((_, k) => k), y })
    }
  } else if (type === 'heatmap' || type === 'contour' || type === 'surface') {
    const cols = opt.series.length ? opt.series.map((s) => s.col) : H.map((_, i) => i).filter((i) => i !== opt.xi)
    const keep = rows.map((_, k) => k).filter((k) => cols.some((c) => Number.isFinite(toNumber(rows[k][c]))))
    matrix = {
      z: keep.map((k) => cols.map((c) => toNumber(rows[k][c]))),
      xs: axisValues(cols.map((c) => H[c] ?? '')),
      ys: axisValues(keep.map((k) => rows[k][opt.xi] ?? '')),
    }
  } else if (type === 'scatter3d') {
    const [sy, sz] = opt.series
    const idx = rows.map((_, k) => k).filter((k) => [opt.xi, sy?.col, sz?.col].every((c) => c !== undefined && Number.isFinite(toNumber(rows[k][c as number]))))
    if (sy) {
      series.push({ ...style(sy), name: nameOf(sy), x: idx.map((k) => toNumber(rows[k][opt.xi])), y: idx.map((k) => toNumber(rows[k][sy.col])), z: sz ? idx.map((k) => toNumber(rows[k][sz.col])) : undefined })
    }
  } else {
    // xy, area
    for (const so of opt.series) {
      const idx: number[] = []
      const x: number[] = []
      const y: number[] = []
      rows.forEach((r, k) => {
        const a = toNumber(r[opt.xi])
        const b = toNumber(r[so.col])
        if (Number.isFinite(a) && Number.isFinite(b)) { idx.push(k); x.push(a); y.push(b) }
      })
      series.push({ ...style(so), name: nameOf(so), x, y, err: errorsFor(so, y, idx) })
    }
  }

  function style(so: SeriesOpt): Partial<Series> {
    const s: Partial<Series> = {}
    if (so.color) s.color = so.color
    if (so.style) s.style = so.style
    if (so.lineStyle) s.lineStyle = so.lineStyle
    if (so.width) s.width = so.width
    if (so.marker) s.marker = so.marker
    if (so.size) s.size = so.size
    if (so.opacity !== undefined) s.opacity = so.opacity
    if (so.hidden) s.hidden = true
    if (so.axis) s.axis = so.axis
    return s
  }

  // automatic axis labels
  const visible = series.filter((s) => !s.hidden)
  const left = visible.filter((s) => s.axis !== 'right')
  const right = visible.filter((s) => s.axis === 'right')
  const unit = (names: string[]) => (names.length === 1 ? names[0] : '')
  let xLabel = opt.x.label
  let yLabel = opt.y.label
  if (!xLabel) xLabel = type === 'histogram' ? unit(visible.map((s) => s.name)) : type === 'box' || type === 'violin' || type === 'matrix' ? '' : xName
  if (!yLabel) {
    yLabel = type === 'histogram' ? (opt.histNorm === 'density' ? 'Density' : 'Count') : type === 'stacked' ? '' : unit(left.map((s) => s.name))
    if (type === 'box' || type === 'violin') yLabel = unit(visible.map((s) => s.name))
  }
  let y2Label = opt.y2.label || unit(right.map((s) => s.name))
  if (type === 'scatter3d') {
    yLabel = opt.y.label || (opt.series[0] ? nameOf(opt.series[0]) : '')
    y2Label = opt.y2.label || (opt.series[1] ? nameOf(opt.series[1]) : '')
  }

  const { engine: _e, xi: _x, series: _s, ...rest } = opt
  void _e; void _x; void _s
  return { ...rest, series, categories, xLabel, yLabel, y2Label, matrix }
}

/** Whether the engine named can draw this chart type (the SVG engine draws Plotly-only types as scatter). */
export const svgDraws = (type: Options['type']): boolean => !isPlotlyOnly(type)

// ------------------------------------------------------------------ project file

export interface Project {
  format: 'kplot'
  version: 1
  table: Table
  options: Options
}

export function serializeProject(table: Table, options: Options): string {
  const p: Project = { format: 'kplot', version: 1, table, options }
  return JSON.stringify(p, null, 1)
}

/** Read a .kplot file. Throws an Error with a plain message when it is not one. */
export function parseProject(text: string): { table: Table; options: Options } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not a kPlot project (it is not valid JSON).')
  }
  const o = raw as Partial<Project> | null
  if (!o || typeof o !== 'object' || o.format !== 'kplot') throw new Error('This file is not a kPlot project (format "kplot" expected).')
  if (typeof o.version === 'number' && o.version > 1) throw new Error(`This project was saved by a newer kPlot (version ${o.version}).`)
  const t = (o.table ?? {}) as Partial<Table>
  const headers = Array.isArray(t.headers) ? t.headers.map(String) : []
  const rows = Array.isArray(t.rows) ? t.rows.map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? ''))) : []
  const table: Table = { headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? '')) }
  return { table, options: fitOptions(cleanOptions(o.options), table) }
}
