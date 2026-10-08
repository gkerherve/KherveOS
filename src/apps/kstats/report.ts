// The tables of results as plain rows of text (for the clipboard, CSV files and the Markdown report).
// Pure (no browser).

import { columnValues, usableColumns, type Data } from './data.ts'
import type { CompareRow, FitResult } from './fits.ts'
import { describe, fixed, fmt, fmtP, outliers } from './math.ts'
import type { CorrMatrix, TestResult } from './tests.ts'

export type Rows = string[][]

export const STATS_HEADER = ['column', 'n', 'mean', 'sd', 'sem', '95% CI low', '95% CI high', 'median', 'Q1', 'Q3', 'IQR', 'min', 'max', 'skewness', 'excess kurtosis', 'IQR outliers']

/** Descriptive statistics of the columns that are not ignored (header row first). */
export function statsRows(data: Data): Rows {
  const rows: Rows = [STATS_HEADER]
  for (const ci of usableColumns(data)) {
    const { values } = columnValues(data.table, ci)
    const d = describe(values)
    if (!d) continue
    rows.push([
      data.table.headers[ci], String(d.n), fmt(d.mean), fmt(d.sd), fmt(d.sem), fmt(d.ciLo), fmt(d.ciHi), fmt(d.median),
      fmt(d.q1), fmt(d.q3), fmt(d.iqr), fmt(d.min), fmt(d.max), fixed(d.skew, 2), fixed(d.kurt, 2), String(outliers(values).iqr.length),
    ])
  }
  return rows
}

export function paramRows(fit: FitResult): Rows {
  return [
    ['parameter', 'estimate', 'std. error', '95% CI low', '95% CI high', 't', 'p'],
    ...fit.params.map((q) => [q.name, fmt(q.value), fmt(q.se), fmt(q.lo), fmt(q.hi), fixed(q.t, 2), fmtP(q.p)]),
  ]
}

export function fitSummaryRows(fit: FitResult): Rows {
  return [
    ['n', String(fit.n)], ['R²', fixed(fit.r2, 5)], ['adjusted R²', fixed(fit.adjR2, 5)], ['RMSE', fmt(fit.rmse)],
    ['residual sd', fmt(fit.residualSd)], ['AIC', fixed(fit.aic, 2)], ['AICc', Number.isFinite(fit.aicc) ? fixed(fit.aicc, 2) : '–'],
    ...(fit.chi2red !== null ? [['reduced χ²', fmt(fit.chi2red)]] : []),
  ]
}

export function compareRows(rows: CompareRow[]): Rows {
  return [
    ['rank', 'model', 'parameters', 'R²', 'adjusted R²', 'RMSE', 'AIC', 'ΔAIC', 'weight'],
    ...rows.map((r, i) =>
      r.fit
        ? [String(i + 1), r.label, String(r.fit.k), fixed(r.fit.r2, 4), fixed(r.fit.adjR2, 4), fmt(r.fit.rmse), fixed(r.fit.aic, 2), fixed(r.deltaAic, 2), fixed(r.weight, 3)]
        : ['–', r.label, '', '', '', '', '', '', r.error ?? 'could not be fitted']),
  ]
}

export function testRows(t: TestResult): Rows {
  return [['test', t.name], ['result', t.summary], ...t.rows]
}

export function corrRows(m: CorrMatrix): Rows {
  return [['', ...m.names], ...m.names.map((n, i) => [n, ...m.r[i].map((v) => fixed(v, 3))])]
}

export const tsv = (rows: Rows) => rows.map((r) => r.join('\t')).join('\n')

export const csv = (rows: Rows) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'

function md(rows: Rows): string {
  const esc = (c: string) => c.replace(/\|/g, '\\|')
  const head = rows[0].map(esc)
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n')
}

export interface ReportInput {
  title: string
  data: Data
  fit: { fit: FitResult; x: string; y: string; used: number; total: number } | null
  compare: CompareRow[] | null
  tests: TestResult[]
  correlation: CorrMatrix | null
}

/** A Markdown report of everything that has been computed. */
export function buildReport(r: ReportInput): string {
  const out: string[] = [`# ${r.title}`, '', `${r.data.table.rows.length} rows, ${r.data.table.headers.length} columns (${new Date().toISOString().slice(0, 10)}).`, '']
  const stats = statsRows(r.data)
  if (stats.length > 1) out.push('## Descriptive statistics', '', md(stats), '')
  if (r.fit) {
    const { fit } = r.fit
    out.push(
      `## Fit of ${r.fit.y} against ${r.fit.x}`, '', `**${fit.label}**: \`${fit.equation}\``, '',
      `${r.fit.used} of ${r.fit.total} rows used${fit.weighted ? ' (weighted by the uncertainties)' : ''}.`, '',
      md(paramRows(fit)), '', md([['quantity', 'value'], ...fitSummaryRows(fit)]), '',
    )
    if (!fit.converged) out.push('_The iteration did not fully converge; check the fit by eye._', '')
  }
  if (r.compare && r.compare.length) out.push('## Model comparison', '', md(compareRows(r.compare)), '', 'Ranked by AIC (AICc for small samples); weight is the Akaike weight.', '')
  for (const t of r.tests) out.push(`## ${t.name}`, '', t.summary, '', md([['quantity', 'value'], ...t.rows]), '', ...t.notes.map((n) => `_${n}_`), '')
  if (r.correlation) out.push('## Correlation matrix', '', md(corrRows(r.correlation)), '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
