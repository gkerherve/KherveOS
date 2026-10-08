// The maths of kStats, kPlot and kChem, and the table reader they share (no browser).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describe, polyFit, evaluate } from '../../src/apps/kstats/math.ts'
import { niceTicks, plotSvg, escapeXml } from '../../src/apps/kplot/plot.ts'
import { molarMass, parseFormula, dilution, massForSolution, composition } from '../../src/apps/kchem/chem.ts'
import { parseTable, column, detectDelimiter } from '../../src/os/table.ts'

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`)

test('table: delimiter, header and numbers', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';')
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t')
  const t = parseTable('time (s),signal\n0,1.5\n1,2.5\n')
  assert.deepEqual(t.headers, ['time (s)', 'signal'])
  assert.deepEqual(column(t, 1), [1.5, 2.5])
  const bare = parseTable('1,2\n3,4')
  assert.deepEqual(bare.headers, ['column 1', 'column 2'])
  assert.equal(bare.rows.length, 2)
})

test('statistics: mean, sample sd, median', () => {
  const d = describe([2, 4, 4, 4, 5, 5, 7, 9])
  assert.ok(d)
  near(d.mean, 5)
  near(d.sd, 2.138, 0.001)
  near(d.median, 4.5)
  assert.equal(describe([]), null)
})

test('fits: a straight line through exact points, a quadratic, R²', () => {
  const x = [0, 1, 2, 3, 4]
  const line = polyFit(x, x.map((v) => 2 * v + 1), 1)
  assert.ok(line)
  near(line.coefficients[0], 1, 1e-9)
  near(line.coefficients[1], 2, 1e-9)
  near(line.r2, 1, 1e-9)
  const quad = polyFit(x, x.map((v) => v * v), 2)
  assert.ok(quad)
  near(evaluate(quad, 10), 100, 1e-6)
  assert.equal(polyFit([1, 2], [1, 2], 3), null, 'not enough points for degree 3')
})

test('plot: round ticks cover the data, labels are escaped', () => {
  const t = niceTicks(0.3, 9.7)
  assert.ok(t[0] <= 0.3 && t[t.length - 1] >= 9.7)
  assert.ok(t.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9), 'ticks are round numbers')
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;')
  const svg = plotSvg({ title: 'x <script>', xLabel: 'x', yLabel: 'y', style: 'both', series: [{ name: 'a', x: [0, 1], y: [0, 1] }] })
  assert.ok(svg.startsWith('<svg'))
  assert.ok(!svg.includes('<script>'))
})

test('chemistry: molar masses, hydrates, brackets, composition', () => {
  near(molarMass('H2O'), 18.015, 0.01)
  near(molarMass('Ca(OH)2'), 74.09, 0.02)
  near(molarMass('CuSO4·5H2O'), 249.68, 0.05)
  near(molarMass('Fe₂O₃'), 159.69, 0.05)
  assert.deepEqual(parseFormula('Mg(NO3)2'), { Mg: 1, N: 2, O: 6 })
  const total = composition('H2O').reduce((s, c) => s + c.percent, 0)
  near(total, 100, 1e-6)
  assert.throws(() => parseFormula('Xx2'), /not an element/)
  assert.throws(() => parseFormula('Ca(OH'), /not closed|Unmatched|bracket/)
})

test('chemistry: solutions and dilutions', () => {
  near(massForSolution('NaCl', 0.1, 250), 1.461, 0.01)
  const d = dilution(1, null, 0.1, 100)
  near(d.v1, 10)
  assert.throws(() => dilution(1, null, null, 100), /exactly one/)
})
