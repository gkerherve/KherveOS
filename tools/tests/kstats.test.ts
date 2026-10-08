// kStats: distributions, descriptive statistics, curve fits (polynomial and Levenberg–Marquardt),
// hypothesis tests, the table helpers and the report.  Reference values are from SciPy.  Run:
//   node --test tools/tests/kstats.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  betai, chi2Sf, fSf, gammaQ, lgamma, normCdf, normQuantile, tCdf, tCritical, tTwoSided,
} from '../../src/apps/kstats/distributions.ts'
import { describe, histogram, outliers, polyFit, quantile, ranks, fmtP } from '../../src/apps/kstats/math.ts'
import {
  MODELS, compareModels, curve, fitModel, isFit, levenbergMarquardt, modelFromName, predict, type FitResult,
} from '../../src/apps/kstats/fits.ts'
import {
  anova, correlation, correlationMatrix, correlationTest, mannWhitney, normality, oneSampleT, pairedT, welchT, type TestResult,
} from '../../src/apps/kstats/tests.ts'
import {
  addColumn, cleanRows, columnValues, deleteColumn, fromCsv, parseData, sortRows, toCsv, toTsv, usableColumns, type Data,
} from '../../src/apps/kstats/data.ts'
import { buildReport, statsRows } from '../../src/apps/kstats/report.ts'
import { fitFigure, histogramFigure, boxFigure, residualFigure, heatmapFigure } from '../../src/apps/kstats/figures.ts'

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`)
const rel = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`)
const ok = <T extends TestResult>(r: T | string): T => {
  assert.equal(typeof r, 'object', String(r))
  return r as T
}
const good = (r: FitResult | { error: string }): FitResult => {
  assert.ok(isFit(r), isFit(r) ? '' : (r as { error: string }).error)
  return r as FitResult
}

test('distributions: gamma, normal, t, F, chi-square', () => {
  near(lgamma(5), Math.log(24), 1e-10)
  near(lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-10)
  near(betai(2, 3, 0.4), 0.5248, 1e-9)
  near(gammaQ(1, 2), Math.exp(-2), 1e-12)
  near(normCdf(1.959963984540054), 0.975, 1e-12)
  near(normQuantile(0.975), 1.959963984540054, 1e-9)
  near(normQuantile(0.001), -3.090232306167813, 1e-8)
  near(tTwoSided(2.0, 10), 0.07338803477074039, 1e-10)
  near(tCritical(0.05, 10), 2.2281388519649385, 1e-8)
  near(tCritical(0.05, 3), 3.182446305284263, 1e-8)
  near(tCdf(-1.3, 4.5), 0.12809804397201696, 1e-9)
  near(fSf(9.264705882352942, 2, 15), 0.0023987773293929083, 1e-10)
  near(chi2Sf(5.991, 2), 0.05001161502657909, 1e-9)
  near(chi2Sf(10, 3), 0.01856613546304323, 1e-10)
})

test('descriptive statistics: quartiles, skewness, kurtosis, CI', () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9, 30])!
  near(d.q1, 4)
  near(d.q3, 7)
  near(d.iqr, 3)
  near(d.skew, 2.7009186895769766, 1e-9)
  near(d.kurt, 7.630047373716138, 1e-9)
  near(d.ciHi - d.ciLo, 2 * tCritical(0.05, 8) * d.sem, 1e-9)
  near(quantile([1, 2, 3, 4], 0.5), 2.5)
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])
})

test('outliers: IQR fences and Grubbs', () => {
  const o = outliers([2, 4, 4, 4, 5, 5, 7, 9, 30])
  assert.deepEqual(o.iqr, [8])
  const g = o.grubbs!
  near(g.g, 2.59303280528138, 1e-9)
  near(g.critical, 2.215004223325564, 1e-6)
  near(g.p, 0.00010091216255967769, 1e-8)
  assert.equal(g.outlier, true)
  assert.equal(g.index, 8)
  assert.equal(outliers([1, 2, 3, 4, 5]).iqr.length, 0)
})

test('histogram counts every value', () => {
  const h = histogram([1, 2, 2, 3, 3, 3, 4, 4, 5, 9], 4)
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 10)
  assert.equal(h.edges.length, 5)
})

test('polynomial fit: known coefficients, standard errors and CI against SciPy linregress', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = [2.1, 3.9, 6.2, 7.8, 10.3, 11.9, 14.2, 15.8]
  const f = good(fitModel('poly1', x, y))
  near(f.p[1], 1.9880952380952381, 1e-10)
  near(f.p[0], 0.07857142857142918, 1e-10)
  near(f.params[1].se, 0.03267490293688586, 1e-10)
  near(f.params[0].se, 0.16500017178579013, 1e-10)
  near(f.r2, 0.9983819117783936, 1e-10)
  near(f.params[1].hi - f.params[1].value, 0.07995260723127758, 1e-9)
  assert.equal(f.dof, 6)
  assert.ok(f.adjR2 < f.r2)
  assert.match(f.equation, /^y = /)
  // exact polynomials, also far from zero (internal scaling)
  const xs = Array.from({ length: 12 }, (_, i) => 1000 + i * 10)
  const q = good(fitModel('poly3', xs, xs.map((v) => 3 - 0.01 * v + 2e-5 * v * v - 1e-8 * v ** 3)))
  rel(q.p[2], 2e-5, 1e-6)
  rel(q.p[3], -1e-8, 1e-6)
  near(q.r2, 1, 1e-9)
  // agrees with the original polyFit
  const old = polyFit(x, y, 2)!
  const nw = good(fitModel('poly2', x, y))
  old.coefficients.forEach((c, k) => near(nw.p[k], c, 1e-8))
})

test('prediction: confidence band is narrowest at the mean of x and prediction interval is wider', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = [2.1, 3.9, 6.2, 7.8, 10.3, 11.9, 14.2, 15.8]
  const f = good(fitModel('poly1', x, y))
  const mid = predict(f, 4.5)
  const edge = predict(f, 8)
  assert.ok(mid.se < edge.se)
  assert.ok(mid.phi - mid.plo > mid.hi - mid.lo)
  near(mid.y, f.p[0] + f.p[1] * 4.5, 1e-9)
  // the SE of the mean response: s * sqrt(1/n) at x = mean
  near(mid.se, f.residualSd * Math.sqrt(1 / 8), 1e-9)
  const c = curve(f, 1, 8, 50)
  assert.equal(c.length, 50)
})

test('Levenberg–Marquardt recovers an exponential from noisy data (SciPy curve_fit values)', () => {
  const noise = [0.01, -0.02, 0.015, 0.0, -0.01, 0.02, -0.015, 0.005, 0.01, -0.02, 0.0, 0.01, -0.01, 0.02, -0.005, 0.0, 0.01, -0.015, 0.005, 0.0, -0.01, 0.01, 0.0, -0.005, 0.01]
  const x = Array.from({ length: 25 }, (_, i) => (i * 5) / 24)
  const y = x.map((v, i) => 2.5 * Math.exp(-0.7 * v) + noise[i])
  const f = good(fitModel('exp', x, y))
  near(f.p[0], 2.50069339, 1e-4)
  near(f.p[1], -0.69978785, 1e-4)
  near(f.params[0].se, 0.00797314, 1e-4)
  near(f.params[1].se, 0.00343271, 1e-4)
  assert.ok(f.params[1].lo < -0.7 && f.params[1].hi > -0.7)
  assert.ok(f.converged)
})

test('Levenberg–Marquardt: Gaussian, Lorentzian, logistic, saturating, power, log', () => {
  const x = Array.from({ length: 41 }, (_, i) => -5 + i * 0.25)
  const noise = x.map((_, i) => Math.sin(i * 7.3) * 0.02)
  const g = good(fitModel('gauss', x, x.map((v, i) => 3 * Math.exp(-((v - 0.5) ** 2) / (2 * 1.2 ** 2)) + noise[i])))
  near(g.p[0], 2.99998235, 1e-4)
  near(g.p[1], 0.50000258, 1e-4)
  near(Math.abs(g.p[2]), 1.20001493, 1e-4)
  near(g.params[0].se, 0.0061023, 1e-4)

  const lor = good(fitModel('lorentz', x, x.map((v) => 4 / (1 + ((v - 1) / 0.8) ** 2))))
  near(lor.p[0], 4, 1e-6)
  near(lor.p[1], 1, 1e-6)
  near(Math.abs(lor.p[2]), 0.8, 1e-6)

  const xs = Array.from({ length: 30 }, (_, i) => i * 0.5)
  const lg = good(fitModel('logistic', xs, xs.map((v) => 10 / (1 + Math.exp(-1.2 * (v - 7))))))
  near(lg.p[0], 10, 1e-5)
  near(lg.p[1], 1.2, 1e-5)
  near(lg.p[2], 7, 1e-5)

  const xm = [0.5, 1, 2, 4, 8, 16, 32]
  const mm = good(fitModel('mm', xm, xm.map((v) => (12 * v) / (3 + v))))
  near(mm.p[0], 12, 1e-6)
  near(mm.p[1], 3, 1e-6)

  const xp = [1, 2, 3, 4, 5, 6, 7]
  const pw = good(fitModel('power', xp, xp.map((v) => 2 * v ** 1.5)))
  near(pw.p[0], 2, 1e-6)
  near(pw.p[1], 1.5, 1e-6)

  const lg2 = good(fitModel('log', xp, xp.map((v) => 1 + 2 * Math.log(v))))
  near(lg2.p[0], 1, 1e-9)
  near(lg2.p[1], 2, 1e-9)
  assert.ok('error' in fitModel('log', [-1, 1, 2, 3], [1, 2, 3, 4]))
})

test('analytic gradients match finite differences', () => {
  const pts: Record<string, number[]> = { exp: [1.3, -0.4], power: [2, 1.5], mm: [5, 2], gauss: [3, 0.5, 1.2], lorentz: [4, 1, 0.8], logistic: [10, 1.2, 7] }
  for (const m of MODELS) {
    if (!m.grad) continue
    const p = pts[m.id]
    const x = 1.7
    const g = m.grad(x, p)
    p.forEach((v, j) => {
      const h = 1e-6
      const a = p.slice()
      const b = p.slice()
      a[j] = v + h
      b[j] = v - h
      near(g[j], (m.f(x, a) - m.f(x, b)) / (2 * h), 1e-5)
    })
  }
})

test('weighted fit against SciPy curve_fit(sigma=…)', () => {
  const f = good(fitModel('poly1', [1, 2, 3, 4, 5], [1.1, 2.3, 2.8, 4.4, 4.9], { sigma: [0.1, 0.2, 0.1, 0.4, 0.2] }))
  near(f.p[0], 0.16661829, 1e-6)
  near(f.p[1], 0.92467344, 1e-6)
  near(f.params[0].se, 0.18553419, 1e-6)
  near(f.params[1].se, 0.06952235, 1e-6)
  assert.equal(f.weighted, true)
  assert.ok(f.chi2red !== null)
  assert.ok('error' in fitModel('poly1', [1, 2, 3], [1, 2, 3], { sigma: [1, 0, 1] }))
})

test('generic levenbergMarquardt with a numeric gradient', () => {
  const x = [0, 1, 2, 3, 4, 5]
  const r = levenbergMarquardt((v, p) => p[0] * Math.exp(p[1] * v), null, [1, -0.1], x, x.map((v) => 3 * Math.exp(-0.5 * v)), x.map(() => 1))
  near(r.p[0], 3, 1e-5)
  near(r.p[1], -0.5, 1e-5)
})

test('compare models ranks the true model first', () => {
  const x = Array.from({ length: 40 }, (_, i) => -4 + i * 0.2)
  const noise = x.map((_, i) => Math.sin(i * 5.1) * 0.03)
  const y = x.map((v, i) => 5 * Math.exp(-(v ** 2) / (2 * 0.9 ** 2)) + noise[i])
  const rows = compareModels(x, y)
  assert.equal(rows[0].model, 'gauss')
  near(rows[0].weight + rows.slice(1).reduce((s, r) => s + (r.fit ? r.weight : 0), 0), 1, 1e-9)
  assert.ok(rows.some((r) => r.error)) // power and log need x > 0
  const line = compareModels([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [3, 5, 7.1, 8.9, 11.2, 13, 14.9, 17.1, 19, 21.1])
  assert.ok(['poly1', 'poly2', 'poly3'].includes(line[0].model))
  assert.equal(modelFromName('Gaussian'), 'gauss')
  assert.equal(modelFromName('poly 3'), 'poly3')
  assert.equal(modelFromName('linear'), 'poly1')
  assert.equal(modelFromName('nonsense'), null)
})

test('t-tests against SciPy', () => {
  const a = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1]
  const b = [4.2, 4.8, 5.0, 4.1, 5.2, 4.6, 4.4]
  const one = ok(oneSampleT(a, 5.0, 'A'))
  near(one.statistic.value, 3.569625885346298, 1e-9)
  near(one.p, 0.009101473008820856, 1e-10)
  assert.match(one.summary, /significantly different from 5/)
  const w = ok(welchT(a, b, ['A', 'B']))
  near(w.statistic.value, 4.3174498293519745, 1e-9)
  near(w.p, 0.0008369597341419573, 1e-10)
  assert.equal(w.significant, true)
  const pr = ok(pairedT(a.slice(0, 7), b, ['A', 'B']))
  near(pr.statistic.value, 5.1333567333034, 1e-9)
  near(pr.p, 0.0021499357346581893, 1e-10)
  assert.equal(typeof pairedT([1, 2], [1], ['A', 'B']), 'string')
  assert.equal(typeof oneSampleT([3, 3, 3], 3), 'string')
})

test('ANOVA: the textbook example, with Bonferroni pairs', () => {
  const r = ok(anova([
    { name: 'a', values: [6, 8, 4, 5, 3, 4] }, { name: 'b', values: [8, 12, 9, 11, 6, 8] }, { name: 'c', values: [13, 9, 11, 8, 7, 12] },
  ]))
  near(r.statistic.value, 9.264705882352942, 1e-9)
  near(r.p, 0.0023987773293929083, 1e-10)
  assert.equal(r.pairwise.length, 3)
  assert.ok(r.pairwise.every((q) => q.pAdjusted >= q.p))
  assert.equal(typeof anova([{ name: 'a', values: [1, 2] }]), 'string')
})

test('correlations: Pearson, Spearman, CI, matrix', () => {
  const p = ok(correlationTest([1, 2, 3, 4, 5], [2, 4, 5, 4, 5], ['x', 'y']))
  near(p.statistic.value, 0.7745966692414834, 1e-10)
  near(p.p, 0.12402706265755456, 1e-9)
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const ys = [2, 1, 4, 3, 7, 8, 6, 10, 9, 12]
  const sp = ok(correlationTest(xs, ys, ['x', 'y'], true))
  near(sp.statistic.value, 0.9272727272727272, 1e-10)
  near(sp.p, 0.00011203450639397582, 1e-8)
  const c = correlation(xs, ys)!
  near(c.lo, 0.7469180791383616, 1e-9)
  near(c.hi, 0.9851445793476197, 1e-9)
  const m = correlationMatrix(['x', 'y'], [xs, ys])
  near(m.r[0][0], 1)
  near(m.r[0][1], m.r[1][0])
  near(m.r[0][1], c.r)
  assert.equal(correlation([1, 1, 1, 1], [1, 2, 3, 4]), null)
})

test('Mann–Whitney and normality', () => {
  const small = ok(mannWhitney([1, 2, 3], [4, 5, 6], ['a', 'b']))
  near(small.p, 0.08085559837005224, 1e-9)
  const a = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1]
  const b = [4.2, 4.8, 5.0, 4.1, 5.2, 4.6, 4.4]
  const mw = ok(mannWhitney(a, b, ['a', 'b']))
  near(mw.p, 0.004577922357685606, 1e-4)
  const jb = ok(normality([1, 2, 2, 3, 3, 3, 4, 4, 5, 9, 1, 2, 3, 4]))
  near(jb.statistic.value, 10.099115385142117, 1e-9)
  near(jb.p, 0.006412168969094406, 1e-10)
  assert.equal(typeof normality([1, 2, 3]), 'string')
  assert.equal(fmtP(0.00001), '< 0.0001')
  assert.equal(fmtP(0.0734), '0.0734')
})

test('data: parse, clean, sort, columns, CSV round trip', () => {
  const d = parseData('time,signal,note\n0,1.5,a\n1,,b\n2,3.5,"c, d"\n3,x,e\n')
  assert.deepEqual(d.table.headers, ['time', 'signal', 'note'])
  assert.equal(d.table.rows[2][2], 'c, d')
  const used = cleanRows(d.table, [0, 1])
  assert.deepEqual(used.kept, [0, 2])
  assert.equal(used.dropped, 2)
  const cv = columnValues(d.table, 1)
  assert.deepEqual(cv.values, [1.5, 3.5])
  assert.deepEqual(cv.rows, [0, 2])
  const sorted = sortRows(d.table, 0, false)
  assert.equal(sorted.rows[0][0], '3')
  const withCol = addColumn(d, 'extra')
  assert.equal(withCol.table.headers.length, 4)
  assert.equal(withCol.ignored.length, 4)
  assert.equal(deleteColumn(withCol, 3).table.headers.length, 3)
  const csv = toCsv(d.table)
  assert.deepEqual(fromCsv(csv).rows, d.table.rows)
  assert.ok(csv.includes('"c, d"'))
  const tsv = toTsv({ headers: ['a', 'b'], rows: [['1', '2']] }, [false, true])
  assert.equal(tsv, 'a\n1')
  // decimal commas with semicolons
  const dc = parseData('a;b\n1,5;2,5\n3,5;4,5\n')
  assert.deepEqual(columnValues(dc.table, 0).values, [1.5, 3.5])
  const ignored: Data = { table: d.table, ignored: [false, true, true] }
  assert.deepEqual(usableColumns(ignored), [0])
})

test('report and figures are built from the results', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = [2.1, 3.9, 6.2, 7.8, 10.3, 11.9, 14.2, 15.8]
  const data = parseData('x,y\n' + x.map((v, i) => `${v},${y[i]}`).join('\n'))
  const fit = good(fitModel('poly1', x, y))
  const rows = statsRows(data)
  assert.equal(rows[0][0], 'column')
  assert.equal(rows.length, 3)
  const md = buildReport({ title: 'Test', data, fit: { fit, x: 'x', y: 'y', used: 8, total: 8 }, compare: compareModels(x, y), tests: [], correlation: null })
  assert.match(md, /^# Test/)
  assert.match(md, /## Fit/)
  assert.match(md, /\| a1 \|/)
  const fig = fitFigure({ x, y, fit, xLabel: 'x', yLabel: 'y' })
  assert.ok(fig.data.length >= 3)
  assert.ok(histogramFigure(y, 'y').data.length >= 1)
  assert.ok(boxFigure([{ name: 'y', values: y }], false).data.length === 1)
  assert.ok(residualFigure(x, fit).data.length >= 1)
  assert.equal(heatmapFigure(correlationMatrix(['x', 'y'], [x, y])).data[0].type, 'heatmap')
  JSON.stringify(fig) // plain data
})
