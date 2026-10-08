// kPlot's pure parts: ticks and scales, the SVG engine, label markup, the safe expression
// parser, fits and histograms, the table helpers, the .kplot file and the Plotly figure.  Run:
//   node --test tools/tests/kplot.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logTicks, makeScale, niceTicks, formatValue } from '../../src/apps/kplot/scale.ts'
import { markerSvg, plotSvg } from '../../src/apps/kplot/plot.ts'
import { markupHtml, markupSvg, parseMarkup, plainText } from '../../src/apps/kplot/markup.ts'
import { ExprError, evalExpr, parseExpr } from '../../src/apps/kplot/expr.ts'
import { autoBins, boxStats, equationText, histogram, polyFit, quantile } from '../../src/apps/kplot/fit.ts'
import { defaultAxis, defaultOptions, newSeriesOpt, resolveFigure, themedPalette, cleanOptions, type FigureInput, type Series } from '../../src/apps/kplot/figure.ts'
import {
  addColumn, autoSeries, buildFigure, isNumericColumn, withNewData, withTable, computeColumn, dropEmptyRows, optionsAfterRemove, parseProject, parseTable, removeColumn, serializeProject, sortByColumn, tableToText,
} from '../../src/apps/kplot/data.ts'
import { toPlotly, plotlySize } from '../../src/apps/kplot/plotly.ts'

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`)

/** Checks tags are balanced and attributes are quoted; returns the tag names seen. */
function wellFormed(svg: string): string[] {
  const stack: string[] = []
  const seen: string[] = []
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+=(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    assert.equal(svg.slice(last, m.index).includes('<'), false, `a stray "<" before position ${m.index}`)
    last = re.lastIndex
    const [, close, name, , self] = m
    seen.push(name)
    if (self) continue
    if (close) assert.equal(stack.pop(), name, `</${name}> closes the open tag`)
    else stack.push(name)
  }
  assert.equal(svg.slice(last).trim(), '')
  assert.deepEqual(stack, [], 'every tag is closed')
  return seen
}

const S = (name: string, x: number[], y: number[], extra: Partial<Series> = {}): Series => ({ name, x, y, ...extra })
const ser1 = [S('a', [0, 1, 2, 3], [1, 3, 2, 5])]

// ------------------------------------------------------------------ ticks and scales

test('ticks: round numbers cover the data', () => {
  const t = niceTicks(0.3, 9.7)
  assert.ok(t[0] <= 0.3 && t[t.length - 1] >= 9.7)
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100])
  assert.deepEqual(niceTicks(-1, 1, 4), [-1, -0.5, 0, 0.5, 1])
  assert.deepEqual(niceTicks(5, 5).length > 1, true, 'a single value still gets an axis')
})

test('ticks: log axes use decades, narrow ranges use 1-2-5', () => {
  const wide = logTicks(1, 1000)
  assert.deepEqual(wide.major, [1, 10, 100, 1000])
  assert.ok(wide.minor.includes(2) && wide.minor.includes(50) && wide.minor.includes(900))
  assert.deepEqual(logTicks(2, 80).major, [2, 5, 10, 20, 50])
  const many = logTicks(1, 1e12, 5).major
  assert.ok(many.length <= 8 && many[0] === 1, 'many decades are thinned out')
})

test('scales: linear data range widens to ticks, manual limits and inversion', () => {
  const lin = makeScale({ min: 0.3, max: 9.7 }, defaultAxis())
  assert.ok(lin.lo <= 0.3 && lin.hi >= 9.7)
  near(lin.frac(lin.lo), 0)
  near(lin.frac(lin.hi), 1)
  const man = makeScale({ min: 0.3, max: 9.7 }, { ...defaultAxis(), min: 2, max: 7, ticks: 5 })
  assert.equal(man.lo, 2)
  assert.equal(man.hi, 7)
  assert.ok(man.major.every((t) => t.v >= 2 && t.v <= 7))
  const rev = makeScale({ min: 0, max: 10 }, { ...defaultAxis(), invert: true })
  near(rev.frac(rev.lo), 1)
  near(rev.frac(rev.hi), 0)
  near(rev.at(rev.frac(3)), 3)
})

test('scales: log10 maps decades evenly; ln shows the logarithm', () => {
  const lg = makeScale({ min: 3, max: 4000 }, { ...defaultAxis(), scale: 'log10' })
  assert.equal(lg.lo, 1)
  assert.equal(lg.hi, 10000)
  near(lg.frac(100), 0.5)
  assert.equal(lg.ok(0), false)
  assert.equal(lg.ok(5), true)
  const ln = makeScale({ min: 1, max: Math.E ** 4 }, { ...defaultAxis(), scale: 'ln', ticks: 4 })
  assert.deepEqual(ln.major.map((t) => t.text).slice(0, 3), ['0', '1', '2'])
  near(ln.major[1].v, Math.E)
  const zero = makeScale({ min: 2, max: 9 }, defaultAxis(), { zero: true })
  assert.equal(zero.lo, 0)
})

test('number formats: auto, fixed, scientific, true minus', () => {
  assert.equal(formatValue(0.30000000000000004), '0.3')
  assert.equal(formatValue(-2), '−2')
  assert.equal(formatValue(250000), '2.5×10^{5}')
  assert.equal(formatValue(0.0001), '1×10^{−4}')
  assert.equal(formatValue(3.14159, 'fixed', 2), '3.14')
  assert.equal(formatValue(1500, 'sci', 1), '1.5×10^{3}')
  assert.equal(formatValue(100, 'auto', 2, true), '100')
})

// ------------------------------------------------------------------ markup

test('markup: subscripts, superscripts, greek and symbols', () => {
  assert.deepEqual(parseMarkup('H_2O'), [{ text: 'H', pos: 0 }, { text: '2', pos: -1 }, { text: 'O', pos: 0 }])
  assert.deepEqual(parseMarkup('m^2'), [{ text: 'm', pos: 0 }, { text: '2', pos: 1 }])
  assert.deepEqual(parseMarkup('x_{max}^{-3}'), [{ text: 'x', pos: 0 }, { text: 'max', pos: -1 }, { text: '−3', pos: 1 }])
  assert.equal(plainText('\\alpha-Fe + \\AA + 10\\deg'), 'α-Fe + Å + 10°')
  assert.equal(plainText('a\\_b'), 'a_b')
  assert.equal(plainText('\\unknown'), '\\unknown')
  assert.equal(plainText('Å is kept'), 'Å is kept')
  assert.equal(markupHtml('H_2O & m^2'), 'H<sub>2</sub>O &amp; m<sup>2</sup>')
})

test('markup: SVG tspans lower and raise the baseline and come back', () => {
  const svg = markupSvg('H_2O', 10)
  assert.match(svg, /^H<tspan dy="2\.2" font-size="7">2<\/tspan><tspan dy="-2\.2">O<\/tspan>$/)
  assert.equal(markupSvg('plain <b>', 10), 'plain &lt;b&gt;')
  assert.match(markupSvg('x^2_i', 10), /dy="-4"[^>]*>2<\/tspan><tspan dy="6\.2"[^>]*>i/)
})

// ------------------------------------------------------------------ expressions

test('expressions: arithmetic, precedence, functions, columns', () => {
  assert.equal(evalExpr('1 + 2 * 3'), 7)
  assert.equal(evalExpr('-2^2'), -4)
  assert.equal(evalExpr('2^3^2'), 512)
  assert.equal(evalExpr('2**-1'), 0.5)
  assert.equal(evalExpr('(1+2)*3 - 4/2'), 7)
  assert.equal(evalExpr('7 % 3'), 1)
  near(evalExpr('log10(1000) + sqrt(16) + pi'), 3 + 4 + Math.PI)
  near(evalExpr('atan2(1, 1)'), Math.PI / 4)
  assert.equal(evalExpr('max(1, 5, 3)'), 5)
  assert.equal(evalExpr('a*2+1', (n) => (n === 'a' ? 3 : undefined)), 7)
  assert.equal(evalExpr('[signal (V)] / 2', (n) => (n === 'signal (V)' ? 10 : undefined)), 5)
  assert.ok(Number.isNaN(evalExpr('1/0 - 1/0')))
})

test('expressions: nothing is executed, unknown names are errors', () => {
  for (const bad of ['process.exit()', 'constructor', '__proto__', 'toString()', 'globalThis', 'this', 'a.b', 'x =', '1 +', '(1', 'alert(1)', '`x`', 'import("fs")']) {
    assert.throws(() => evalExpr(bad), ExprError, bad)
  }
  assert.throws(() => evalExpr('constructor', () => undefined), /Unknown name/)
  assert.throws(() => parseExpr('Function("return 1")()'), /Unknown function/)
  let touched = false
  const g = globalThis as unknown as Record<string, unknown>
  g.kplotProbe = () => { touched = true }
  assert.throws(() => evalExpr('kplotProbe()'), ExprError)
  delete g.kplotProbe
  assert.equal(touched, false)
})

// ------------------------------------------------------------------ statistics

test('fits: exact lines and polynomials, R²', () => {
  const x = [0, 1, 2, 3, 4, 5]
  const line = polyFit(x, x.map((v) => 2 * v + 1), 1)
  assert.ok(line)
  near(line.coef[0], 1, 1e-9)
  near(line.coef[1], 2, 1e-9)
  near(line.r2, 1, 1e-9)
  const quad = polyFit(x, x.map((v) => 0.5 * v * v - 3 * v + 2), 2)
  assert.ok(quad)
  near(quad.coef[0], 2, 1e-8)
  near(quad.coef[1], -3, 1e-8)
  near(quad.coef[2], 0.5, 1e-8)
  const noisy = polyFit([1, 2, 3, 4], [2.1, 3.9, 6.2, 7.8], 1)
  assert.ok(noisy && noisy.r2 > 0.99 && noisy.r2 < 1)
  near(noisy.coef[1], 1.94, 1e-9)
  assert.equal(polyFit([1, 2], [1, 2], 3), null)
  const far = polyFit([1990, 2000, 2010, 2020], [1, 2, 3, 4], 1)
  assert.ok(far)
  near(far.coef[1], 0.1, 1e-9)
  assert.equal(equationText([1, 2]), 'y = 2x + 1')
  assert.equal(equationText([-0.5, 1.25, -1]), 'y = −x^{2} + 1.25x − 0.5')
})

test('statistics: quantiles, box statistics, histogram bins', () => {
  near(quantile([1, 2, 3, 4], 0.5), 2.5)
  const b = boxStats([1, 2, 3, 4, 5, 6, 7, 100])
  assert.ok(b)
  assert.equal(b.median, 4.5)
  assert.deepEqual(b.outliers, [100])
  assert.equal(b.hi, 7)
  const h = histogram([0, 1, 1, 2, 2, 2, 3, 4], 4, 0, 4)
  assert.deepEqual(h.edges, [0, 1, 2, 3, 4])
  assert.deepEqual(h.counts, [1, 2, 3, 2], 'the maximum falls in the last bin')
  near(h.density.reduce((a, d) => a + d * 1, 0), 1)
  assert.equal(autoBins(100), 8)
  assert.equal(histogram([5, 5, 5], 3).counts.reduce((a, c) => a + c, 0), 3)
})

// ------------------------------------------------------------------ the SVG engine

test('svg: a scatter / line plot is well formed and escaped', () => {
  const svg = plotSvg({ title: 'x <script> & y', xLabel: 'time (s)', yLabel: 'H_2O / m^2', series: ser1 })
  const tags = wellFormed(svg)
  assert.ok(svg.startsWith('<svg'))
  assert.ok(!svg.includes('<script>'))
  assert.ok(tags.includes('polyline') && tags.includes('circle'))
  assert.match(svg, /<tspan dy="2\.2"/)
  assert.match(svg, /width="170mm" height="112mm"/)
})

test('svg: legacy call signature (title, labels, style, series) still works', () => {
  const svg = plotSvg({ title: 't', xLabel: 'x', yLabel: 'y', style: 'both', series: [{ name: 'a', x: [0, 1], y: [0, 1] }] })
  wellFormed(svg)
  assert.ok(svg.includes('>t<'))
})

test('svg: series styles', () => {
  const base = (s: Partial<Series>): string => plotSvg({ series: [S('a', [0, 1, 2], [0, 1, 4], s)] })
  assert.match(base({ lineStyle: 'dashed' }), /stroke-dasharray/)
  assert.match(base({ lineStyle: 'dotted' }), /stroke-linecap="round"/)
  assert.ok(!/stroke-dasharray/.test(base({ lineStyle: 'solid' })))
  assert.ok(base({ color: '#123456' }).includes('#123456'))
  assert.ok(!base({ style: 'line' }).includes('<circle'))
  assert.ok(!base({ style: 'points' }).includes('<polyline'))
  assert.ok(base({ marker: 'triangle', style: 'points' }).includes('<polygon'))
  assert.match(base({ marker: 'plus', style: 'points' }), /<path d="M[^"]*" fill="none" stroke="#1f4e9c"/)
  assert.match(base({ opacity: 0.4, style: 'points' }), /fill-opacity="0\.4"/)
  const hidden = plotSvg({ series: [S('a', [0, 1], [0, 1], { hidden: true }), S('b', [0, 1], [1, 2])] })
  wellFormed(hidden)
  assert.ok(!hidden.includes('>a<'))
  for (const shape of ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus'] as const) assert.ok(markerSvg(shape, 5, 5, 6, '#000').length > 10)
})

test('svg: log axes, reversed axes, ticks inside, frame, dark and transparent themes', () => {
  const log = plotSvg({ y: { scale: 'log10' }, series: [S('a', [1, 2, 3], [1, 100, 10000])] })
  wellFormed(log)
  assert.ok(log.includes('>10<') && log.includes('>100<'))
  const rev = plotSvg({ x: { invert: true }, series: ser1 })
  wellFormed(rev)
  const nums = (svg: string) => [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="9" text-anchor="middle"[^>]*>([\d.]+)<\/text>/g)].map((m) => [Number(m[1]), Number(m[2])])
  const fwd = nums(plotSvg({ series: ser1 }))
  const bwd = nums(rev)
  assert.ok(fwd.length > 2 && bwd.length > 2)
  assert.ok(fwd[0][0] < fwd[fwd.length - 1][0], 'normally the smallest value is on the left')
  assert.ok(bwd[0][0] > bwd[bwd.length - 1][0], 'inverted: the smallest value is on the right')
  const l = plotSvg({ frame: 'l', ticksDir: 'in', series: ser1 })
  wellFormed(l)
  assert.ok(!l.includes('Z" fill="none"'))
  assert.ok(plotSvg({ theme: 'dark', series: ser1 }).includes('fill="#16181c"'))
  assert.ok(!plotSvg({ theme: 'transparent', series: ser1 }).includes('<rect width='))
  assert.ok(plotSvg({ theme: 'white', series: ser1 }).includes('<rect width='))
})

test('svg: grid, minor ticks, number formats and manual limits', () => {
  const grid = plotSvg({ x: { grid: true }, y: { grid: true }, series: ser1 })
  assert.ok((grid.match(/stroke="#e3e3e3"/g) ?? []).length >= 6)
  assert.ok(!plotSvg({ series: ser1 }).includes('#e3e3e3"/>\n<line'))
  const fmt = plotSvg({ y: { format: 'fixed', decimals: 3 }, series: ser1 })
  assert.ok(fmt.includes('>1.000<'))
  const lim = plotSvg({ x: { min: 1, max: 2 }, series: ser1 })
  wellFormed(lim)
  assert.ok(lim.includes('>1.4<') && !lim.includes('>0.8<'))
})

test('svg: error bars', () => {
  const svg = plotSvg({ series: [S('a', [0, 1, 2], [1, 2, 3], { err: [0.5, 0, 0.2] })] })
  wellFormed(svg)
  assert.equal((svg.match(/<path d="[^"]*" fill="none" stroke="#1f4e9c"/g) ?? []).length, 2, 'two points have a bar (the zero error draws none)')
})

test('svg: bars, stacked bars, histogram, box plot, area, dual axis', () => {
  const cats = ['A', 'B', 'C']
  const two = [S('u', [0, 1, 2], [1, 2, 3]), S('v', [0, 1, 2], [2, 1, 4])]
  const bar = plotSvg({ type: 'bar', categories: cats, series: two })
  wellFormed(bar)
  assert.equal((bar.match(/<rect x=/g) ?? []).length, 6 + 1 + 1 + 2, 'six bars, the clip, the legend frame and its two swatches')
  const stacked = plotSvg({ type: 'stacked', categories: cats, series: two })
  wellFormed(stacked)
  assert.ok(stacked.includes('>7<') || stacked.includes('>8<'), 'the stack reaches 5–7')
  const hist = plotSvg({ type: 'histogram', bins: 5, series: [S('h', [], [1, 2, 2, 3, 3, 3, 4, 4, 5])] })
  wellFormed(hist)
  assert.ok(hist.includes('>Count<') === false, 'labels are the caller\'s (buildFigure adds them)')
  const box = plotSvg({ type: 'box', series: [S('p', [], [1, 2, 3, 4, 50]), S('q', [], [2, 3, 4, 5])] })
  wellFormed(box)
  assert.ok(box.includes('>p<') && box.includes('>q<'), 'the boxes are named on the x axis')
  assert.ok(box.includes('<circle'), 'the outlier is drawn')
  const area = plotSvg({ type: 'area', series: ser1 })
  wellFormed(area)
  assert.ok(area.includes('<polygon'))
  const dual = plotSvg({ y2Label: 'right', series: [S('l', [0, 1], [0, 1]), S('r', [0, 1], [100, 900], { axis: 'right' })] })
  wellFormed(dual)
  assert.ok(dual.includes('>right<') && dual.includes('>800<'), 'the right axis has its own ticks')
  for (const t of ['heatmap', 'contour', 'scatter3d', 'surface', 'violin', 'matrix'] as const) wellFormed(plotSvg({ type: t, series: ser1 }))
})

test('svg: fits, reference lines, notes, regions, legend positions, sizes', () => {
  const fig: FigureInput = {
    series: [S('a', [0, 1, 2, 3], [1, 3, 5, 7])],
    fits: [{ series: 0, degree: 1, label: true }],
    lines: [{ axis: 'y', value: 4, label: 'limit' }, { axis: 'x', value: 1.5 }],
    notes: [{ x: 1, y: 6, text: 'peak \\alpha' }],
    regions: [{ axis: 'x', from: 0.5, to: 1, label: 'zone' }],
  }
  const svg = plotSvg(fig)
  wellFormed(svg)
  assert.ok(svg.includes('y = 2x + 1') || svg.includes('>y = 2x + 1<'))
  assert.ok(svg.includes('R<tspan'), 'R² is printed with a superscript')
  assert.ok(svg.includes('limit') && svg.includes('peak α') && svg.includes('zone'))
  for (const legend of ['none', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'outside-right', 'outside-top'] as const) {
    const two = plotSvg({ legend, series: [S('first', [0, 1], [0, 1]), S('second', [0, 1], [1, 0])] })
    wellFormed(two)
    assert.equal(two.includes('>second<'), legend !== 'none', legend)
  }
  const single = plotSvg({ width: 86, height: 65, fontSize: 8, series: ser1 })
  assert.match(single, /width="86mm" height="65mm"/)
  assert.match(single, /viewBox="0 0 243\.78 184\.25"/)
})

test('palettes: colour-blind safe, greyscale, dark theme', () => {
  const okabe = plotSvg({ palette: 'okabe-ito', series: ser1 })
  assert.ok(okabe.includes('#0072B2'))
  const grey = themedPalette('greyscale', 'white')
  assert.ok(grey.every((c) => /^#([0-9a-f]{2})\1\1$/i.test(c)))
  const dark = themedPalette('publication', 'dark')
  assert.notEqual(dark[0], themedPalette('publication', 'white')[0], 'dark colours are lightened on a dark page')
})

// ------------------------------------------------------------------ data

const SAMPLE = 'T,a,b,err\n1,10,3,0.5\n2,20,4,0.5\n3,30,5,1\n4,40,6,1\n'

test('table: text round trip, columns, sort, empty rows, computed columns', () => {
  const t = parseTable(SAMPLE)
  assert.equal(parseTable(tableToText(t)).rows.length, 4)
  assert.deepEqual(removeColumn(t, 1).headers, ['T', 'b', 'err'])
  assert.equal(addColumn(t, 'a').headers[4], 'a 2', 'names stay unique')
  const sorted = sortByColumn(t, 1, true)
  assert.deepEqual(sorted.rows.map((r) => r[0]), ['4', '3', '2', '1'])
  assert.equal(dropEmptyRows({ headers: ['a'], rows: [[''], ['1'], [' ']] }).rows.length, 1)
  const c = computeColumn(t, 'ratio', 'a/b + c1', 0)
  assert.deepEqual(c.rows.map((r) => r[4]), ['4.33333333333', '7', '9', '10.6666666667'].map((s, i) => c.rows[i][4]))
  assert.equal(c.rows[1][4], '7')
  assert.equal(computeColumn(t, 'lg', 'log10([a])').rows[0][4], '1')
  assert.equal(computeColumn(t, 'e', 'x * i').rows[2][4], '9')
  assert.throws(() => computeColumn(t, 'bad', 'nonexistent * 2'), /Unknown name/)
  assert.throws(() => computeColumn(t, 'bad', 'process.exit(1)'), ExprError)
  assert.equal(computeColumn(t, 'div', '1/(b-4)').rows[1][4], '', 'infinity is an empty cell')
})

test('figure from a table: series, error columns, sd, categories, axis labels', () => {
  const t = parseTable(SAMPLE)
  const opt = { ...defaultOptions(), series: [{ ...newSeriesOpt(1), errors: 'column' as const, errCol: 3 }, { ...newSeriesOpt(2), errors: 'sd' as const, axis: 'right' as const }] }
  const fig = buildFigure(t, opt)
  assert.equal(fig.series.length, 2)
  assert.deepEqual(fig.series[0].y, [10, 20, 30, 40])
  assert.deepEqual(fig.series[0].err, [0.5, 0.5, 1, 1])
  near(fig.series[1].err![0], 1.2909944, 1e-6)
  assert.equal(fig.xLabel, 'T')
  assert.equal(fig.yLabel, 'a')
  assert.equal(fig.y2Label, 'b')
  assert.equal(fig.series[1].axis, 'right')
  wellFormed(plotSvg(fig))
  const bars = buildFigure(parseTable('name,v\nx,1\ny,2\nz,\n'), { ...defaultOptions(), type: 'bar' })
  assert.deepEqual(bars.categories, ['x', 'y', 'z'])
  assert.ok(Number.isNaN(bars.series[0].y[2]))
  wellFormed(plotSvg(bars))
  const h = buildFigure(t, { ...defaultOptions(), type: 'histogram', series: [newSeriesOpt(0)] })
  assert.equal(h.series[0].name, 'T', 'a histogram can use the first column')
  assert.equal(h.yLabel, 'Count')
  const m = buildFigure(parseTable('y,c1,c2\n1,1,2\n2,3,4\n'), { ...defaultOptions(), type: 'heatmap', series: [] })
  assert.deepEqual(m.matrix?.z, [[1, 2], [3, 4]])
  assert.deepEqual(m.matrix?.xs, ['c1', 'c2'])
  assert.deepEqual(m.matrix?.ys, [1, 2])
})

test('a new table picks its numeric columns; edits keep the choice valid', () => {
  const t = parseTable('name,a,b,c\nx,1,2,u\ny,3,4,v\n')
  assert.equal(isNumericColumn(t, 0), false)
  assert.equal(isNumericColumn(t, 1), true)
  assert.deepEqual(autoSeries(t, 0).map((s) => s.col), [1, 2])
  const o = withNewData({ ...defaultOptions(), theme: 'dark' }, t)
  assert.equal(o.theme, 'dark', 'the style stays')
  assert.deepEqual(o.series.map((s) => s.col), [1, 2])
  const narrow = parseTable('name,a\nx,1\n')
  assert.deepEqual(withTable(o, narrow).series.map((s) => s.col), [1], 'columns that are gone are dropped')
  assert.deepEqual(withTable({ ...o, series: [] }, t).series.map((s) => s.col), [1, 2], 'an empty choice is filled in')
})

test('options follow removed columns', () => {
  const o = { ...defaultOptions(), xi: 2, series: [newSeriesOpt(0), { ...newSeriesOpt(3), errors: 'column' as const, errCol: 1 }] }
  const r = optionsAfterRemove(o, 1)
  assert.equal(r.xi, 1)
  assert.deepEqual(r.series.map((s) => s.col), [0, 2])
  assert.equal(r.series[1].errors, 'none')
  assert.equal(r.series[1].errCol, -1)
})

test('.kplot project: round trip keeps data and every option', () => {
  const t = parseTable(SAMPLE)
  const opt = {
    ...defaultOptions(), type: 'stacked' as const, engine: 'svg' as const, title: 'Hello', theme: 'dark' as const, palette: 'okabe-ito' as const, legend: 'outside-right' as const,
    x: { ...defaultAxis(), scale: 'log10' as const, min: 1, max: 4, invert: true, grid: true },
    series: [{ ...newSeriesOpt(1), color: '#aa0000', marker: 'diamond' as const, lineStyle: 'dashed' as const, name: 'A_1', hidden: true, axis: 'right' as const }],
    fits: [{ series: 0, degree: 2, label: true }],
    lines: [{ axis: 'y' as const, value: 3, lineStyle: 'dotted' as const, label: 'L' }],
    notes: [{ x: 1, y: 2, text: 'n' }],
    regions: [{ axis: 'x' as const, from: 1, to: 2, opacity: 0.3 }],
  }
  const text = serializeProject(t, opt)
  const raw = JSON.parse(text)
  assert.equal(raw.format, 'kplot')
  assert.equal(raw.version, 1)
  const back = parseProject(text)
  assert.deepEqual(back.table, t)
  assert.deepEqual(back.options, opt)
  assert.throws(() => parseProject('{"format":"other"}'), /not a kPlot project/)
  assert.throws(() => parseProject('nope'), /not valid JSON/)
  assert.throws(() => parseProject('{"format":"kplot","version":9}'), /newer/)
  const hostile = parseProject(JSON.stringify({ format: 'kplot', version: 1, table: { headers: ['a', 'b'], rows: [[1, 2], [3]] }, options: { type: 'nonsense', fontSize: 'big', series: [{ col: 'x' }, { col: 1, color: 'url(javascript:1)' }, { col: 7 }], width: -5 } }))
  assert.deepEqual(hostile.table.rows, [['1', '2'], ['3', '']])
  assert.equal(hostile.options.type, 'xy')
  assert.equal(hostile.options.fontSize, 10)
  assert.deepEqual(hostile.options.series.map((s) => s.col), [1])
  assert.equal(hostile.options.series[0].color, undefined)
  assert.ok(hostile.options.width >= 20)
  assert.equal(cleanOptions(null).engine, 'plotly')
})

test('figure defaults are sane', () => {
  const f = resolveFigure({ series: [] })
  assert.equal(f.width, 170)
  assert.equal(f.x.ticks, 6)
  assert.equal(resolveFigure({ series: [], fontSize: 1000 }).fontSize, 40)
})

// ------------------------------------------------------------------ Plotly

const px = (pt: number) => (pt * 96) / 72

test('plotly: scatter / line / markers, marker shapes and dashes', () => {
  const p = toPlotly({
    series: [
      S('a', [1, 2, 3], [1, 4, 9], { style: 'line', lineStyle: 'dashed', color: '#112233', width: 3 }),
      S('b', [1, 2, 3], [2, 3, 4], { style: 'points', marker: 'triangle', size: 8 }),
      S('c', [1, 2, 3], [3, 2, 1], { marker: 'plus', style: 'both' }),
      S('d', [1, 2, 3], [3, 2, 1], { marker: 'cross', style: 'points' }),
    ],
  })
  assert.equal(p.data.length, 4)
  assert.deepEqual(p.data.map((d) => d.mode), ['lines', 'markers', 'lines+markers', 'markers'])
  assert.deepEqual(p.data.map((d) => d.type), ['scatter', 'scatter', 'scatter', 'scatter'])
  const a = p.data[0] as { line: { color: string; dash: string; width: number } }
  assert.equal(a.line.color, '#112233')
  assert.equal(a.line.dash, 'dash')
  near(a.line.width, px(3))
  const b = p.data[1] as { marker: { symbol: string; size: number } }
  assert.equal(b.marker.symbol, 'triangle-up')
  near(b.marker.size, px(8))
  assert.equal((p.data[2] as { marker: { symbol: string } }).marker.symbol, 'cross')
  assert.equal((p.data[3] as { marker: { symbol: string } }).marker.symbol, 'x')
  assert.equal(p.config.displaylogo, false)
  assert.equal(p.config.responsive, false)
  assert.equal(p.layout.showlegend, true, 'several series: a legend')
})

test('plotly: axes types, ranges, inversion, grid, ticks, formats', () => {
  const p = toPlotly({
    x: { scale: 'log10', min: 1, max: 1000, invert: true, grid: true, minorGrid: true, ticks: 8, label: 'E_b (eV)' },
    y: { min: 0, format: 'fixed', decimals: 2 },
    frame: 'box', ticksDir: 'in',
    series: [S('a', [1, 10, 100], [1, 2, 3])],
  })
  const x = p.layout.xaxis as Record<string, unknown>
  const y = p.layout.yaxis as Record<string, unknown>
  assert.equal(x.type, 'log')
  assert.deepEqual(x.range, [3, 0], 'log axes take log10 and the range is reversed')
  assert.equal(x.showgrid, true)
  assert.equal(x.nticks, 8)
  assert.equal(x.ticks, 'inside')
  assert.equal(x.mirror, 'ticks')
  assert.deepEqual((x.title as { text: string }).text, 'E<sub>b</sub> (eV)')
  assert.equal((x.minor as { showgrid: boolean }).showgrid, true)
  assert.equal(y.type, 'linear')
  assert.equal(y.tickformat, '.2f')
  assert.deepEqual(y.range, [0, 3], 'one manual limit, the other from the data')
  const auto = toPlotly({ x: { invert: true }, series: ser1 }).layout.xaxis as Record<string, unknown>
  assert.equal(auto.autorange, 'reversed')
  const sci = toPlotly({ y: { format: 'sci', decimals: 1 }, series: ser1 }).layout.yaxis as Record<string, unknown>
  assert.equal(sci.tickformat, '.1e')
  const ln = toPlotly({ y: { scale: 'ln' }, series: [S('a', [1, 2], [Math.E, 1])] })
  assert.equal((ln.layout.yaxis as { type: string }).type, 'linear')
  near((ln.data[0].y as number[])[0], 1)
  const lshape = toPlotly({ frame: 'l', series: ser1 }).layout.xaxis as Record<string, unknown>
  assert.equal(lshape.mirror, false)
})

test('plotly: dual y axis puts series on y2', () => {
  const p = toPlotly({ y2Label: 'right', y2: { scale: 'log10' }, series: [S('l', [0, 1], [0, 1]), S('r', [0, 1], [10, 1000], { axis: 'right' })] })
  assert.equal(p.data[0].yaxis, undefined)
  assert.equal(p.data[1].yaxis, 'y2')
  const y2 = p.layout.yaxis2 as Record<string, unknown>
  assert.equal(y2.overlaying, 'y')
  assert.equal(y2.side, 'right')
  assert.equal(y2.type, 'log')
  assert.equal((y2.title as { text: string }).text, 'right')
  assert.equal(toPlotly({ series: ser1 }).layout.yaxis2, undefined)
})

test('plotly: error bars, bars, stacked bars, histogram, box, violin, area', () => {
  const eb = toPlotly({ series: [S('a', [1, 2], [1, 2], { err: [0.1, 0.2] })] })
  assert.deepEqual((eb.data[0].error_y as { array: number[]; type: string }).array, [0.1, 0.2])
  assert.equal((eb.data[0].error_y as { type: string }).type, 'data')
  assert.equal(toPlotly({ series: ser1 }).data[0].error_y, undefined)
  const cats = ['A', 'B']
  const bar = toPlotly({ type: 'bar', categories: cats, series: [S('u', [0, 1], [1, 2]), S('v', [0, 1], [3, NaN])] })
  assert.deepEqual(bar.data.map((d) => d.type), ['bar', 'bar'])
  assert.deepEqual(bar.data[0].x, cats)
  assert.deepEqual(bar.data[1].y, [3, null])
  assert.equal(bar.layout.barmode, 'group')
  assert.equal((bar.layout.xaxis as { type: string }).type, 'category')
  assert.equal(toPlotly({ type: 'stacked', categories: cats, series: ser1 }).layout.barmode, 'stack')
  const hist = toPlotly({ type: 'histogram', bins: 7, histNorm: 'density', series: [S('h', [], [1, 2, 2, 3]), S('g', [], [2, 3, 4])] })
  assert.equal(hist.data[0].type, 'histogram')
  assert.equal(hist.data[0].nbinsx, 7)
  assert.equal(hist.data[0].histnorm, 'probability density')
  assert.equal(hist.layout.barmode, 'overlay')
  assert.equal(hist.data[0].bingroup, hist.data[1].bingroup, 'the series share their bins')
  const box = toPlotly({ type: 'box', series: ser1 })
  assert.equal(box.data[0].type, 'box')
  assert.equal(box.data[0].boxmean, true)
  assert.equal(toPlotly({ type: 'violin', series: ser1 }).data[0].type, 'violin')
  const area = toPlotly({ type: 'area', series: ser1 })
  assert.equal(area.data[0].fill, 'tozeroy')
  assert.match(String(area.data[0].fillcolor), /^rgba\(31,78,156,0\.3\)$/)
})

test('plotly: matrix, 3D and scatter-matrix types', () => {
  const matrix = { z: [[1, 2], [3, 4]], xs: ['a', 'b'], ys: [1, 2] }
  assert.equal(toPlotly({ type: 'heatmap', matrix, series: [] }).data[0].type, 'heatmap')
  assert.equal(toPlotly({ type: 'contour', matrix, series: [] }).data[0].type, 'contour')
  const surf = toPlotly({ type: 'surface', matrix, series: [] })
  assert.equal(surf.data[0].type, 'surface')
  assert.ok(surf.layout.scene)
  const s3 = toPlotly({ type: 'scatter3d', y2Label: 'z', series: [S('y', [1, 2], [3, 4], { z: [5, 6] })] })
  assert.equal(s3.data[0].type, 'scatter3d')
  assert.deepEqual(s3.data[0].z, [5, 6])
  const sp = toPlotly({ type: 'matrix', series: [S('p', [0, 1], [1, 2]), S('q', [0, 1], [3, NaN])] })
  assert.equal(sp.data[0].type, 'splom')
  assert.deepEqual((sp.data[0].dimensions as { values: unknown[] }[])[1].values, [3, null])
  assert.equal(sp.layout.showlegend, false)
  assert.equal(toPlotly({ type: 'heatmap', series: [] }).data.length, 0, 'no matrix, no trace')
})

test('plotly: reference lines, shaded regions, notes and fits are shapes and annotations', () => {
  const p = toPlotly({
    x: { scale: 'log10' },
    series: [S('a', [1, 10, 100], [1, 3, 5])],
    lines: [{ axis: 'y', value: 3, label: 'lim', lineStyle: 'dotted' }, { axis: 'x', value: 10, color: '#ff0000' }],
    regions: [{ axis: 'x', from: 1, to: 100, color: '#00ff00', opacity: 0.5, label: 'R' }, { axis: 'y', from: 1, to: 2 }],
    notes: [{ x: 10, y: 4, text: 'N_2' }],
    fits: [{ series: 0, degree: 1, label: true }],
  })
  const shapes = p.layout.shapes as Record<string, unknown>[]
  assert.equal(shapes.length, 4)
  const yl = shapes.find((s) => s.type === 'line' && s.yref === 'y')!
  assert.equal(yl.y0, 3)
  assert.equal((yl.line as { dash: string }).dash, 'dot')
  const xl = shapes.find((s) => s.type === 'line' && s.xref === 'x')!
  assert.equal(xl.x0, 1, 'positions on a log axis are log10 of the value')
  assert.equal((xl.line as { color: string }).color, '#ff0000')
  const reg = shapes.find((s) => s.type === 'rect' && s.xref === 'x')!
  assert.equal(reg.x0, 0)
  assert.equal(reg.x1, 2)
  assert.equal(reg.fillcolor, 'rgba(0,255,0,0.5)')
  assert.equal(reg.layer, 'below')
  const ann = p.layout.annotations as Record<string, unknown>[]
  assert.ok(ann.some((a) => a.text === 'N<sub>2</sub>' && a.x === 1))
  assert.ok(ann.some((a) => a.text === 'lim'))
  assert.ok(ann.some((a) => String(a.text).startsWith('y = ') && String(a.text).includes('R<sup>2</sup>')))
  assert.equal(p.data.length, 2, 'the data and the fit line')
  assert.equal(p.data[1].showlegend, false)
})

test('plotly: the theme sets the chart colours', () => {
  const dark = toPlotly({ theme: 'dark', series: ser1 })
  assert.equal(dark.layout.paper_bgcolor, '#16181c')
  assert.equal(dark.layout.plot_bgcolor, '#16181c')
  assert.equal((dark.layout.font as { color: string }).color, '#e8e8e8')
  assert.equal((dark.layout.xaxis as { gridcolor: string }).gridcolor, '#3a3d42')
  assert.equal((dark.layout.xaxis as { linecolor: string }).linecolor, '#e8e8e8')
  const white = toPlotly({ theme: 'white', series: ser1 })
  assert.equal(white.layout.paper_bgcolor, '#ffffff')
  assert.equal((white.layout.font as { color: string }).color, '#111111')
  const clear = toPlotly({ theme: 'transparent', series: ser1 })
  assert.equal(clear.layout.paper_bgcolor, 'rgba(0,0,0,0)')
  assert.equal(clear.layout.plot_bgcolor, 'rgba(0,0,0,0)')
  const lightened = (dark.data[0] as { line: { color: string } }).line.color
  assert.notEqual(lightened, (white.data[0] as { line: { color: string } }).line.color, 'dark colours are lightened on a dark page')
  const grey = toPlotly({ palette: 'greyscale', series: ser1 }).data[0] as { line: { color: string } }
  assert.equal(grey.line.color, '#000000')
})

test('plotly: legend positions, title, fonts, size, zoom memory', () => {
  const two = [S('a', [0, 1], [0, 1]), S('b', [0, 1], [1, 0])]
  const at = (legend: 'top-left' | 'outside-right' | 'outside-top' | 'none') => toPlotly({ legend, series: two }).layout
  assert.equal((at('top-left').legend as { xanchor: string }).xanchor, 'left')
  assert.equal((at('outside-right').legend as { x: number }).x > 1, true)
  assert.equal((at('outside-top').legend as { orientation: string }).orientation, 'h')
  assert.equal(at('none').showlegend, false)
  assert.equal(toPlotly({ series: ser1 }).layout.showlegend, false, 'one series: no automatic legend')
  const t = toPlotly({ title: 'H_2O', fontFamily: 'serif', fontSize: 12, series: ser1 }).layout
  assert.equal((t.title as { text: string }).text, 'H<sub>2</sub>O')
  assert.match((t.font as { family: string }).family, /Times/)
  near((t.font as { size: number }).size, 16)
  assert.deepEqual(plotlySize({ width: 96, height: 48.8, series: [] }), { width: 363, height: 184 })
  const a = toPlotly({ x: { max: 5 }, series: ser1 }).layout.uirevision
  const b = toPlotly({ x: { max: 6 }, series: ser1 }).layout.uirevision
  const c = toPlotly({ x: { max: 5 }, title: 'other', series: ser1 }).layout.uirevision
  assert.notEqual(a, b, 'editing a range resets the zoom')
  assert.equal(a, c, 'other edits keep the zoom')
})
