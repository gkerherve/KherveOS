// Runs a hypothesis test chosen by name on columns of the table (the window and the AI tools share this).
// Pure (no browser).

import { cleanRows, columnValues, type Table } from './data.ts'
import { toNumber } from '../../os/table.ts'
import { anova, correlationTest, mannWhitney, normality, oneSampleT, pairedT, welchT, type TestResult } from './tests.ts'

export type TestKind = 'ttest1' | 'welch' | 'paired' | 'anova' | 'mannwhitney' | 'pearson' | 'spearman' | 'normality'

export interface TestKindInfo {
  id: TestKind
  label: string
  /** How many columns it takes: 1, 2, or "many" (a group per column). */
  columns: 1 | 2 | 'many'
  /** Takes a value to compare the mean against. */
  mu?: boolean
  hint: string
}

export const TEST_KINDS: TestKindInfo[] = [
  { id: 'ttest1', label: 'One-sample t-test', columns: 1, mu: true, hint: 'Is the mean of a column different from a given value?' },
  { id: 'welch', label: "Two-sample t-test (Welch)", columns: 2, hint: 'Do two independent columns have different means?' },
  { id: 'paired', label: 'Paired t-test', columns: 2, hint: 'Do two columns measured on the same rows differ (before / after)?' },
  { id: 'anova', label: 'One-way ANOVA', columns: 'many', hint: 'Do three or more columns (groups) have different means?' },
  { id: 'mannwhitney', label: 'Mann–Whitney U', columns: 2, hint: 'Rank-based comparison of two columns; no normality needed.' },
  { id: 'pearson', label: 'Pearson correlation', columns: 2, hint: 'Is there a straight-line relationship between two columns?' },
  { id: 'spearman', label: 'Spearman correlation', columns: 2, hint: 'Is there a rank (monotonic) relationship between two columns?' },
  { id: 'normality', label: 'Normality (skewness, kurtosis, Jarque–Bera)', columns: 1, hint: 'Does a column look normally distributed?' },
]

export function testKind(name: string): TestKind | null {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const alias: Record<string, TestKind> = {
    t: 'ttest1', ttest: 'ttest1', onesamplet: 'ttest1', onesample: 'ttest1', ttest1: 'ttest1', welch: 'welch', welcht: 'welch', ttest2: 'welch',
    twosample: 'welch', twosamplet: 'welch', unpaired: 'welch', paired: 'paired', pairedt: 'paired', anova: 'anova', onewayanova: 'anova',
    mannwhitney: 'mannwhitney', mannwhitneyu: 'mannwhitney', wilcoxon: 'mannwhitney', pearson: 'pearson', correlation: 'pearson', spearman: 'spearman',
    normality: 'normality', normal: 'normality', jarquebera: 'normality', jb: 'normality',
  }
  return alias[s] ?? null
}

export interface TestConfig {
  kind: TestKind
  /** Column indexes: one, two, or the groups of an ANOVA. */
  cols: number[]
  mu: number
  alpha: number
}

/** The result, or a sentence saying why the test cannot run. `used` counts the rows/values behind it. */
export function runTest(table: Table, cfg: TestConfig): TestResult | string {
  const info = TEST_KINDS.find((k) => k.id === cfg.kind)!
  const name = (i: number) => table.headers[i] ?? `column ${i + 1}`
  const need = info.columns === 'many' ? 2 : info.columns
  if (cfg.cols.length < need) return `Pick ${info.columns === 'many' ? 'at least 2 columns (the groups)' : info.columns === 1 ? 'a column' : 'two columns'} for this test.`
  const alpha = cfg.alpha
  if (cfg.kind === 'ttest1') return oneSampleT(columnValues(table, cfg.cols[0]).values, cfg.mu, name(cfg.cols[0]), alpha)
  if (cfg.kind === 'normality') return normality(columnValues(table, cfg.cols[0]).values, name(cfg.cols[0]), alpha)
  if (cfg.kind === 'anova') {
    return anova(cfg.cols.map((c) => ({ name: name(c), values: columnValues(table, c).values })), alpha)
  }
  const [a, b] = cfg.cols
  const names: [string, string] = [name(a), name(b)]
  if (cfg.kind === 'welch') return welchT(columnValues(table, a).values, columnValues(table, b).values, names, alpha)
  if (cfg.kind === 'mannwhitney') return mannWhitney(columnValues(table, a).values, columnValues(table, b).values, names, alpha)
  // paired tests and correlations use the rows where both are numbers
  const { kept } = cleanRows(table, [a, b])
  const xs = kept.map((i) => toNumber(table.rows[i][a]))
  const ys = kept.map((i) => toNumber(table.rows[i][b]))
  if (cfg.kind === 'paired') return pairedT(xs, ys, names, alpha)
  return correlationTest(xs, ys, names, cfg.kind === 'spearman', alpha)
}
