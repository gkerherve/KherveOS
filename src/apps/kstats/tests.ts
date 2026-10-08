// Hypothesis tests of kStats, each with a plain-language sentence and the numbers behind it:
// one-sample, Welch and paired t-tests, one-way ANOVA (with Bonferroni pairwise comparisons),
// Pearson and Spearman correlation, Mann–Whitney U and a normality check (Jarque–Bera).
// Pure (no browser).

import { chi2Sf, fSf, normQuantile, normTwoSided, tCritical, tTwoSided } from './distributions.ts'
import { fixed, fmt, fmtP, mean, moments, ranks, sd } from './math.ts'

export interface TestResult {
  id: string
  name: string
  /** The test statistic, e.g. { label: 't(9)', value: 3.1 }. */
  statistic: { label: string; value: number }
  p: number
  /** Significant at `alpha`? */
  significant: boolean
  alpha: number
  /** One plain-language sentence. */
  summary: string
  /** The numbers: label → value (already formatted). */
  rows: [string, string][]
  /** Cautions, e.g. a small sample. */
  notes: string[]
}

export interface Group {
  name: string
  values: number[]
}

const verdict = (p: number, alpha: number) => (p < alpha ? 'significantly' : 'not significantly')
const stat = (v: number) => fixed(v, 3)

function build(
  id: string, name: string, label: string, value: number, p: number, alpha: number, summary: string,
  rows: [string, string][], notes: string[] = [],
): TestResult {
  return { id, name, statistic: { label, value }, p, significant: p < alpha, alpha, summary, rows, notes }
}

function tNote(n: number, notes: string[]) {
  if (n < 8) notes.push('Small sample: the t-test assumes roughly normal data, which is hard to judge with so few values.')
}

/** One-sample t-test of the mean against `mu0`. */
export function oneSampleT(values: number[], mu0: number, label = 'the sample', alpha = 0.05): TestResult | string {
  const n = values.length
  if (n < 2) return 'A one-sample t-test needs at least 2 values.'
  const m = mean(values)
  const s = sd(values)
  const se = s / Math.sqrt(n)
  if (se === 0) return 'All the values are identical, so there is no spread to test against.'
  const t = (m - mu0) / se
  const df = n - 1
  const p = tTwoSided(t, df)
  const h = tCritical(1 - 0.95, df) * se
  const notes: string[] = []
  tNote(n, notes)
  return build(
    'ttest1', 'One-sample t-test', `t(${df})`, t, p, alpha,
    `The mean of ${label} (${fmt(m)}) is ${verdict(p, alpha)} different from ${fmt(mu0)} (t(${df}) = ${stat(t)}, p = ${fmtP(p)}).`,
    [['n', String(n)], ['mean', fmt(m)], ['sd', fmt(s)], ['standard error', fmt(se)], ['tested against', fmt(mu0)],
      ['95 % CI of the mean', `${fmt(m - h)} to ${fmt(m + h)}`], ['t', stat(t)], ['degrees of freedom', String(df)], ['p-value', fmtP(p)],
      ["Cohen's d", fixed((m - mu0) / s, 2)]],
    notes,
  )
}

/** Welch's two-sample t-test (unequal variances). */
export function welchT(a: number[], b: number[], names: [string, string] = ['A', 'B'], alpha = 0.05): TestResult | string {
  if (a.length < 2 || b.length < 2) return "Welch's t-test needs at least 2 values in each sample."
  const ma = mean(a)
  const mb = mean(b)
  const va = sd(a) ** 2 / a.length
  const vb = sd(b) ** 2 / b.length
  if (va + vb === 0) return 'Both samples are constant, so there is no spread to test.'
  const se = Math.sqrt(va + vb)
  const t = (ma - mb) / se
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  const p = tTwoSided(t, df)
  const h = tCritical(0.05, df) * se
  const sp = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / (a.length + b.length - 2))
  const notes: string[] = []
  tNote(Math.min(a.length, b.length), notes)
  return build(
    'welch', "Welch's two-sample t-test", `t(${fixed(df, 1)})`, t, p, alpha,
    `${names[0]} (mean ${fmt(ma)}) and ${names[1]} (mean ${fmt(mb)}) differ ${verdict(p, alpha)} (t(${fixed(df, 1)}) = ${stat(t)}, p = ${fmtP(p)}).`,
    [['n', `${a.length} and ${b.length}`], ['means', `${fmt(ma)} and ${fmt(mb)}`], ['difference of means', fmt(ma - mb)],
      ['95 % CI of the difference', `${fmt(ma - mb - h)} to ${fmt(ma - mb + h)}`], ['t', stat(t)], ['degrees of freedom', fixed(df, 2)],
      ['p-value', fmtP(p)], ["Cohen's d", fixed(sp > 0 ? (ma - mb) / sp : NaN, 2)]],
    notes,
  )
}

/** Paired t-test on the differences a − b (equal lengths, row by row). */
export function pairedT(a: number[], b: number[], names: [string, string] = ['A', 'B'], alpha = 0.05): TestResult | string {
  if (a.length !== b.length) return 'A paired t-test needs the same number of values in both columns.'
  if (a.length < 2) return 'A paired t-test needs at least 2 pairs.'
  const d = a.map((v, i) => v - b[i])
  const md = mean(d)
  const sdd = sd(d)
  if (sdd === 0) return 'All the differences are identical, so there is no spread to test.'
  const n = d.length
  const se = sdd / Math.sqrt(n)
  const t = md / se
  const df = n - 1
  const p = tTwoSided(t, df)
  const h = tCritical(0.05, df) * se
  const notes: string[] = []
  tNote(n, notes)
  return build(
    'paired', 'Paired t-test', `t(${df})`, t, p, alpha,
    `The paired difference ${names[0]} − ${names[1]} (mean ${fmt(md)}) is ${verdict(p, alpha)} different from 0 (t(${df}) = ${stat(t)}, p = ${fmtP(p)}).`,
    [['pairs', String(n)], ['mean difference', fmt(md)], ['sd of the differences', fmt(sdd)], ['95 % CI of the difference', `${fmt(md - h)} to ${fmt(md + h)}`],
      ['t', stat(t)], ['degrees of freedom', String(df)], ['p-value', fmtP(p)], ["Cohen's d", fixed(md / sdd, 2)]],
    notes,
  )
}

export interface Pairwise {
  a: string
  b: string
  diff: number
  p: number
  pAdjusted: number
}

/** One-way ANOVA across groups, with Bonferroni-adjusted pairwise comparisons. */
export function anova(groups: Group[], alpha = 0.05): (TestResult & { pairwise: Pairwise[] }) | string {
  const g = groups.filter((x) => x.values.length > 0)
  if (g.length < 2) return 'ANOVA needs at least 2 groups (columns) with numbers in them.'
  const N = g.reduce((s, x) => s + x.values.length, 0)
  const k = g.length
  if (N - k < 1) return 'ANOVA needs more values than groups.'
  const grand = g.reduce((s, x) => s + x.values.reduce((a, b) => a + b, 0), 0) / N
  let ssb = 0
  let ssw = 0
  for (const x of g) {
    const m = mean(x.values)
    ssb += x.values.length * (m - grand) ** 2
    ssw += x.values.reduce((s, v) => s + (v - m) ** 2, 0)
  }
  const dfb = k - 1
  const dfw = N - k
  const msb = ssb / dfb
  const msw = ssw / dfw
  if (msw === 0) return 'Every group is constant, so the variation within groups is zero.'
  const F = msb / msw
  const p = fSf(F, dfb, dfw)
  const eta2 = ssb / (ssb + ssw)
  const pairs: Pairwise[] = []
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const diff = mean(g[i].values) - mean(g[j].values)
      const t = diff / Math.sqrt(msw * (1 / g[i].values.length + 1 / g[j].values.length))
      const pp = tTwoSided(t, dfw)
      pairs.push({ a: g[i].name, b: g[j].name, diff, p: pp, pAdjusted: Math.min(1, (pp * k * (k - 1)) / 2) })
    }
  }
  const notes: string[] = []
  if (g.some((x) => x.values.length < 3)) notes.push('Some groups have fewer than 3 values.')
  notes.push('ANOVA assumes similar spread in every group and roughly normal data.')
  const rows: [string, string][] = [
    ['groups', String(k)], ['values', String(N)], ['F', stat(F)], ['degrees of freedom', `${dfb}, ${dfw}`], ['p-value', fmtP(p)],
    ['between-group SS', fmt(ssb)], ['within-group SS', fmt(ssw)], ['eta squared', fixed(eta2, 3)],
  ]
  const sig = pairs.filter((q) => q.pAdjusted < alpha)
  if (p < alpha) rows.push(['Bonferroni pairs', sig.length ? sig.map((q) => `${q.a} vs ${q.b} (p = ${fmtP(q.pAdjusted)})`).join('; ') : 'none individually significant'])
  const base = build(
    'anova', 'One-way ANOVA', `F(${dfb}, ${dfw})`, F, p, alpha,
    `The group means ${p < alpha ? 'differ significantly' : 'do not differ significantly'} (F(${dfb}, ${dfw}) = ${stat(F)}, p = ${fmtP(p)})${
      p < alpha && sig.length ? `; after Bonferroni correction ${sig.map((q) => `${q.a} and ${q.b}`).join(', ')} differ` : ''
    }.`,
    rows, notes,
  )
  return { ...base, pairwise: pairs }
}

export interface Correlation {
  r: number
  n: number
  p: number
  lo: number
  hi: number
}

function corrCore(x: number[], y: number[]): number {
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN
}

/** Correlation coefficient with p-value and 95 % CI (Fisher z). `spearman` ranks the data first. */
export function correlation(x: number[], y: number[], spearman = false): Correlation | null {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const a = spearman ? ranks(x.slice(0, n)) : x.slice(0, n)
  const b = spearman ? ranks(y.slice(0, n)) : y.slice(0, n)
  const r = corrCore(a, b)
  if (!Number.isFinite(r)) return null
  const rc = Math.max(-1, Math.min(1, r))
  const p = Math.abs(rc) >= 1 ? 0 : tTwoSided((rc * Math.sqrt(n - 2)) / Math.sqrt(1 - rc * rc), n - 2)
  let lo = rc
  let hi = rc
  if (n > 3 && Math.abs(rc) < 1) {
    const z = Math.atanh(rc)
    const se = spearman ? Math.sqrt((1 + (rc * rc) / 2) / (n - 3)) : 1 / Math.sqrt(n - 3)
    const h = normQuantile(0.975) * se
    lo = Math.tanh(z - h)
    hi = Math.tanh(z + h)
  } else if (n <= 3) {
    lo = -1
    hi = 1
  }
  return { r: rc, n, p, lo, hi }
}

function strength(r: number): string {
  const a = Math.abs(r)
  return a >= 0.9 ? 'very strong' : a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'very weak or no'
}

/** Pearson or Spearman correlation test. */
export function correlationTest(
  x: number[], y: number[], names: [string, string] = ['x', 'y'], spearman = false, alpha = 0.05,
): TestResult | string {
  const c = correlation(x, y, spearman)
  if (!c) return 'A correlation needs at least 3 pairs, and neither column can be constant.'
  const kind = spearman ? 'Spearman' : 'Pearson'
  const dir = c.r > 0 ? 'positive' : 'negative'
  const notes: string[] = []
  if (c.n < 10) notes.push('Few pairs: a correlation from so little data can be misleading.')
  if (spearman) notes.push('The p-value uses the t approximation, which is good for 10 or more pairs.')
  return build(
    spearman ? 'spearman' : 'pearson', `${kind} correlation`, spearman ? 'ρ' : 'r', c.r, c.p, alpha,
    `${names[0]} and ${names[1]} have a ${p0(c.p, alpha) ? `${strength(c.r)} ${dir}` : 'no significant'} ${spearman ? 'rank ' : ''}correlation (${spearman ? 'ρ' : 'r'} = ${fixed(c.r, 3)}, p = ${fmtP(c.p)}, n = ${c.n}).`,
    [['n', String(c.n)], [spearman ? 'ρ' : 'r', fixed(c.r, 4)], ['95 % CI', `${fixed(c.lo, 3)} to ${fixed(c.hi, 3)}`], ['p-value', fmtP(c.p)],
      [spearman ? 'ρ²' : 'r² (variance shared)', fixed(c.r * c.r, 4)]],
    notes,
  )
}

const p0 = (p: number, alpha: number) => p < alpha

/** Mann–Whitney U test (normal approximation with tie and continuity corrections). */
export function mannWhitney(a: number[], b: number[], names: [string, string] = ['A', 'B'], alpha = 0.05): TestResult | string {
  const n1 = a.length
  const n2 = b.length
  if (n1 < 2 || n2 < 2) return 'The Mann–Whitney test needs at least 2 values in each sample.'
  const all = [...a, ...b]
  const rk = ranks(all)
  const r1 = rk.slice(0, n1).reduce((s, v) => s + v, 0)
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const u2 = n1 * n2 - u1
  const N = n1 + n2
  const counts = new Map<number, number>()
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1)
  let tie = 0
  for (const c of counts.values()) tie += c ** 3 - c
  const sigma2 = ((n1 * n2) / 12) * (N + 1 - tie / (N * (N - 1)))
  if (sigma2 <= 0) return 'Every value is identical, so the ranks cannot separate the samples.'
  const mu = (n1 * n2) / 2
  const z = (Math.abs(u1 - mu) - 0.5) / Math.sqrt(sigma2)
  const zc = Math.max(0, z)
  const p = normTwoSided(zc)
  const rb = (2 * u1) / (n1 * n2) - 1
  const notes: string[] = ['The p-value is the normal approximation (good from about 8 values per sample).']
  return build(
    'mannwhitney', 'Mann–Whitney U test', 'U', Math.min(u1, u2), p, alpha,
    `${names[0]} and ${names[1]} differ ${verdict(p, alpha)} in their typical values (U = ${fmt(Math.min(u1, u2))}, z = ${stat(zc)}, p = ${fmtP(p)}).`,
    [['n', `${n1} and ${n2}`], ['U (first sample)', fmt(u1)], ['U (second sample)', fmt(u2)], ['z', stat(zc)], ['p-value', fmtP(p)],
      ['medians', `${fmt(median(a))} and ${fmt(median(b))}`], ['rank-biserial r', fixed(rb, 3)]],
    notes,
  )
}

function median(v: number[]): number {
  const s = [...v].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Normality indicator: skewness, excess kurtosis and the Jarque–Bera test. */
export function normality(values: number[], label = 'the sample', alpha = 0.05): TestResult | string {
  const n = values.length
  if (n < 8) return 'The normality check needs at least 8 values.'
  if (sd(values) === 0) return 'All the values are identical.'
  const { g1, g2 } = moments(values)
  const jb = (n / 6) * (g1 * g1 + (g2 * g2) / 4)
  const p = chi2Sf(jb, 2)
  const notes = ['Jarque–Bera is an approximation that works best with 30 or more values.']
  return build(
    'normality', 'Normality (Jarque–Bera)', 'JB', jb, p, alpha,
    `${label[0].toUpperCase()}${label.slice(1)} ${p < alpha ? 'does not look normally distributed' : 'is consistent with a normal distribution'} (skewness ${fixed(g1, 2)}, excess kurtosis ${fixed(g2, 2)}, JB = ${stat(jb)}, p = ${fmtP(p)}).`,
    [['n', String(n)], ['skewness', fixed(g1, 3)], ['excess kurtosis', fixed(g2, 3)], ['Jarque–Bera', stat(jb)], ['p-value', fmtP(p)]],
    notes,
  )
}

// ------------------------------------------------------------ correlation matrix

export interface CorrMatrix {
  names: string[]
  r: number[][]
  p: number[][]
  n: number[][]
}

/** Pairwise correlations (rows with both values) of several columns, given as aligned arrays with NaN for missing. */
export function correlationMatrix(names: string[], cols: number[][], spearman = false): CorrMatrix {
  const k = names.length
  const r = Array.from({ length: k }, () => new Array<number>(k).fill(NaN))
  const p = Array.from({ length: k }, () => new Array<number>(k).fill(NaN))
  const n = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const xs: number[] = []
      const ys: number[] = []
      for (let t = 0; t < cols[i].length; t++) {
        if (Number.isFinite(cols[i][t]) && Number.isFinite(cols[j][t])) {
          xs.push(cols[i][t])
          ys.push(cols[j][t])
        }
      }
      n[i][j] = n[j][i] = xs.length
      if (i === j) {
        r[i][j] = xs.length > 1 ? 1 : NaN
        p[i][j] = 0
        continue
      }
      const c = correlation(xs, ys, spearman)
      if (c) {
        r[i][j] = r[j][i] = c.r
        p[i][j] = p[j][i] = c.p
      }
    }
  }
  return { names, r, p, n }
}
