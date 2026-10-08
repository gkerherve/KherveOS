// KherveCalc's browser-side logic: number formats, the programmer mode, statistics,
// graph geometry, sessions, the keypad and the catalog.  Run:
//   node --test tools/tests/khervecalc.test.ts
// (The Python engine has its own test: khervecalc-engine.test.mjs.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatNumber, formatReal, roundDigits, sciOf, type FormatOpts, type Sci } from '../../src/apps/khervecalc/format.ts'
import { ProgError, bitsOf, progEval, progFormat, toggleBit, wrap } from '../../src/apps/khervecalc/programmer.ts'
import { histogram, oneVar, pairs, polyFit, regression, twoVar } from '../../src/apps/khervecalc/stats.ts'
import { contour, fitY, niceTicks, runs, tickLabel, traceAt, zoomAt } from '../../src/apps/khervecalc/plot.ts'
import {
  DEFAULT_SETTINGS, ansIds, defName, inputHistory, newSession, parseSession, serializeSession, upsertDef, type HistoryEntry,
} from '../../src/apps/khervecalc/session.ts'
import { KEYPAD, applyInsert } from '../../src/apps/khervecalc/keypad.ts'
import { CATALOG, complete, wordBefore } from '../../src/apps/khervecalc/catalog.ts'
import { shown, texName } from '../../src/apps/khervecalc/display.ts'

const sci = (sign: '' | '-', digits: string, exp: number): Sci => ({ sign, digits, exp })
const O = (format: FormatOpts['format'], fix = 4, digits = 12): FormatOpts => ({ format, fix, digits })

test('digits are rounded half up, carrying into a new digit', () => {
  assert.deepEqual(roundDigits('123456', 2, 3), { digits: '123', exp: 2 })
  assert.deepEqual(roundDigits('1235', 0, 3), { digits: '124', exp: 0 })
  assert.deepEqual(roundDigits('9996', 0, 3), { digits: '1', exp: 1 })
  assert.deepEqual(roundDigits('1200', 0, 10), { digits: '12', exp: 0 })
})

test('numbers are written in normal, scientific, engineering and fixed notation', () => {
  const x = sci('', '123456789', 4) // 12345.6789
  assert.equal(formatReal(x, O('normal')).text, '12345.6789')
  assert.equal(formatReal(x, O('sci', 0)).text, '1.23456789e4')
  assert.equal(formatReal(x, O('sci', 3)).text, '1.23e4')
  assert.equal(formatReal(x, O('sci', 3)).latex, '1.23\\times 10^{4}')
  assert.equal(formatReal(x, O('eng', 0)).text, '12.3456789e3')
  assert.equal(formatReal(x, O('fix', 2)).text, '12345.68')
  assert.equal(formatReal(sci('-', '25', -3), O('eng', 0)).text, '-2.5e-3')
  assert.equal(formatReal(sci('', '25', -4), O('eng', 0)).text, '250e-6')
  assert.equal(formatReal(sci('', '5', -7), O('normal')).text, '5e-7')
  assert.equal(formatReal(sci('', '5', -5), O('normal')).text, '0.00005')
  assert.equal(formatReal(sci('', '1', 15), O('normal', 4, 12)).text, '1e15')
  assert.equal(formatReal(sci('', '1', 11), O('normal', 4, 12)).text, '100000000000')
  assert.equal(formatReal(sci('', '0', 0), O('fix', 3)).text, '0.000')
  assert.equal(formatReal(sci('', '4', -4), O('fix', 3)).text, '0.000')
  assert.equal(formatReal(sci('', '6', -4), O('fix', 3)).text, '0.001')
  assert.equal(formatReal(sci('', '2', 0), O('fix', 3)).text, '2.000')
  assert.equal(formatReal(sci('', 'inf', 0), O('normal')).latex, '\\infty')
  // 50 digits stay 50 digits
  assert.equal(formatReal(sci('', '3'.repeat(50), -1), O('normal', 0, 50)).text, '0.' + '3'.repeat(50))
})

test('complex numbers as a + bi or r∠θ', () => {
  const z = { re: sci('', '3', 0), im: sci('-', '4', 0), abs: sci('', '5', 0), arg: sci('-', '5313010235', 1) }
  assert.equal(formatNumber(z, O('normal')).text, '3 - 4*i')
  assert.equal(formatNumber(z, O('normal'), 'polar', 'deg').text, '5∠-53.13010235°')
  assert.equal(formatNumber({ re: sci('', '0', 0), im: sci('', '1', 0) }, O('normal')).text, 'i')
  assert.equal(formatNumber({ re: sci('', '2', 0), im: null }, O('normal')).text, '2')
})

test('plain numbers become digit strings', () => {
  assert.deepEqual(sciOf(-0.00123), sci('-', '123', -3))
  assert.deepEqual(sciOf(0), sci('', '0', 0))
  assert.equal(sciOf(NaN).digits, 'nan')
})

test('programmer mode: bases, word sizes, two’s complement and bit operations', () => {
  const h32 = { base: 16, bits: 32, signed: true } as const
  assert.equal(progEval('FF + 1', h32), 256n)
  assert.equal(progEval('0xFF and 0x0F', h32), 15n)
  assert.equal(progEval('1 << 4 | 1', h32), 17n)
  assert.equal(progEval('not 0', h32), -1n)
  assert.equal(progFormat(-1n, 16, 32, true), 'FFFFFFFF')
  assert.equal(progFormat(-1n, 10, 32, true), '-1')
  assert.equal(progFormat(-1n, 10, 32, false), '4294967295')
  assert.equal(progEval('7FFFFFFF + 1', h32), -2147483648n)
  assert.equal(progEval('7FFFFFFF + 1', { ...h32, signed: false }), 2147483648n)
  assert.equal(progEval('FF + 1', { base: 16, bits: 8, signed: false }), 0n)
  assert.equal(progEval('1010 xor 0110', { base: 2, bits: 8, signed: false }), 12n)
  assert.equal(progEval('rol(0x81, 1)', { base: 10, bits: 8, signed: false }), 3n)
  assert.equal(progEval('0x81 ror 1', { base: 10, bits: 8, signed: false }), 0xc0n)
  assert.equal(progEval('-8 >> 1', { base: 10, bits: 8, signed: true }), -4n)
  assert.equal(progEval('-8 >>> 1', { base: 10, bits: 8, signed: true }), 124n)
  assert.equal(progEval('popcount(0xFF00)', h32), 8n)
  assert.equal(progEval('1Fh + 10b + 17o', { base: 10, bits: 32, signed: true }), 31n + 2n + 15n)
  assert.equal(progEval('17 / 5 * 5 + 17 mod 5', { base: 10, bits: 32, signed: true }), 17n)
  assert.equal(progEval('2 ** 10', { base: 10, bits: 32, signed: true }), 1024n)
  assert.equal(progEval('ans * 2', { base: 10, bits: 32, signed: true }, { ans: 21n }), 42n)
  assert.throws(() => progEval('1 / 0', h32), ProgError)
  assert.throws(() => progEval('12', { base: 2, bits: 8, signed: false }), /not a binary number/)
  assert.throws(() => progEval('(1 + 2', h32), /Missing '\)'/)
  assert.equal(progFormat(0xabcdn, 2, 16, false, true), '1010 1011 1100 1101')
  assert.equal(progFormat(1234567n, 10, 32, true, true), '1,234,567')
  assert.deepEqual(bitsOf(5n, 8), [0, 0, 0, 0, 0, 1, 0, 1])
  assert.equal(toggleBit(0n, 7, { bits: 8, signed: true }), -128n)
  assert.equal(wrap(300n, 8, false), 44n)
})

test('one-variable statistics like a calculator', () => {
  const s = oneVar([2, 4, 4, 4, 5, 5, 7, 9])
  assert.equal(s.n, 8)
  assert.equal(s.mean, 5)
  assert.equal(s.sigma, 2)
  assert.ok(Math.abs(s.sx - 2.138089935) < 1e-9)
  assert.equal(s.median, 4.5)
  assert.equal(s.q1, 4)
  assert.equal(s.q3, 6)
  assert.deepEqual(s.mode, [4])
  const odd = oneVar([1, 2, 3, 4, 5, 6, 7])
  assert.equal(odd.q1, 2)
  assert.equal(odd.q3, 6)
  assert.equal(oneVar([1, 2], [3, 1]).mean, 1.25) // frequencies
  assert.throws(() => oneVar([]), /empty/)
})

test('regressions recover their models', () => {
  const X = [1, 2, 3, 4, 5, 6]
  const lin = regression(X, X.map((x) => 3 + 2 * x), 'linear')
  assert.ok(Math.abs(lin.coeffs[0] - 3) < 1e-9 && Math.abs(lin.coeffs[1] - 2) < 1e-9)
  assert.ok(Math.abs(lin.r2 - 1) < 1e-12)
  assert.ok(Math.abs((lin.r ?? 0) - 1) < 1e-12)
  const quad = regression(X, X.map((x) => 1 - x + 0.5 * x * x), 'quadratic')
  quad.coeffs.forEach((c, i) => assert.ok(Math.abs(c - [1, -1, 0.5][i]) < 1e-8))
  const ex = regression(X, X.map((x) => 2 * Math.exp(0.3 * x)), 'exponential')
  assert.ok(Math.abs(ex.coeffs[0] - 2) < 1e-9 && Math.abs(ex.coeffs[1] - 0.3) < 1e-9)
  const pw = regression(X, X.map((x) => 5 * x ** 1.5), 'power')
  assert.ok(Math.abs(pw.coeffs[0] - 5) < 1e-9 && Math.abs(pw.coeffs[1] - 1.5) < 1e-9)
  const lg = regression(X, X.map((x) => 1 + 2 * Math.log(x)), 'logarithmic')
  assert.ok(Math.abs(lg.coeffs[1] - 2) < 1e-9)
  assert.match(lin.expr, /\*x/)
  // far from the origin, the scaled fit stays accurate
  const big = [1000, 1001, 1002, 1003, 1004]
  const c = polyFit(big, big.map((x) => x * x), 2)
  assert.ok(Math.abs(c[2] - 1) < 1e-6 && Math.abs(c[1]) < 1e-3)
  const [px, py] = pairs([1, null, 3], [4, 5, null])
  assert.deepEqual([px, py], [[1], [4]])
  assert.ok(Math.abs(twoVar([1, 2, 3], [2, 4, 6.5]).r - 0.9986) < 1e-3)
  assert.deepEqual(histogram([1, 2, 2, 3, 3, 3], 3).counts, [1, 2, 3])
})

test('graph geometry: ticks, zoom, poles, contours, trace', () => {
  assert.deepEqual(niceTicks(-10, 10, 4).ticks, [-10, -5, 0, 5, 10])
  assert.equal(niceTicks(0, 1, 10).step, 0.1)
  assert.equal(tickLabel(0.30000000000000004, 0.1), '0.3')
  const z = zoomAt({ xmin: -10, xmax: 10, ymin: -10, ymax: 10 }, 0, 0, 0.5)
  assert.deepEqual(z, { xmin: -5, xmax: 5, ymin: -5, ymax: 5 })
  // tan x jumps from +big to -big at a pole: two runs
  const view = { xmin: -2, xmax: 2, ymin: -5, ymax: 5 }
  const r = runs([1.5, 1.56, 1.58, 1.6], [14, 92, -108, -34], view)
  assert.ok(!r.some((run) => run.some((p) => p[1] === 92) && run.some((p) => p[1] === -108)), 'no line across the pole')
  assert.equal(runs([0, 0.1, 0.2], [1, 2, 3], view).length, 1)
  assert.equal(runs([0, 1, null, 2, 3], [0, 1, null, 2, 3], view).length, 2)
  // circle x² + y² = 1 on a 3×3 grid around the origin crosses all four edges
  const segs = contour([[1, 0, 1], [0, -1, 0], [1, 0, 1]].map((r) => r.map((v) => v)), [-1, 0, 1], [-1, 0, 1])
  assert.ok(segs.length >= 4)
  assert.deepEqual(traceAt([0, 1, 2], [0, 10, 20], 1.5), { x: 1.5, y: 15 })
  const fy = fitY([[...Array.from({ length: 100 }, (_, i) => i), 1e6]], { xmin: 0, xmax: 1, ymin: -1, ymax: 1 })
  assert.ok(fy.ymax < 200, 'a pole does not squash the view')
})

test('sessions round-trip and survive bad files', () => {
  const s = newSession()
  s.history.push({ id: 'a', input: '1+1', answer: { ok: true, text: '2', latex: '2' }, mode: { number: 'exact', angle: 'rad', digits: 12 }, time: 1 })
  s.defs = ['a := 2']
  s.lists.L1 = [1, 2, null, 4]
  s.settings.angle = 'deg'
  const back = parseSession(serializeSession(s))
  assert.deepEqual(back.history[0].input, '1+1')
  assert.deepEqual(back.lists.L1, [1, 2, null, 4])
  assert.equal(back.settings.angle, 'deg')
  assert.deepEqual(back.defs, ['a := 2'])
  const odd = parseSession(JSON.stringify({ format: 'kcalc', settings: { digits: 5000, angle: 'turns' }, view: { xmin: 1, xmax: 0 } }))
  assert.equal(odd.settings.digits, 1000)
  assert.equal(odd.settings.angle, DEFAULT_SETTINGS.angle)
  assert.equal(odd.view.xmin, -10)
  assert.throws(() => parseSession('{"format": "kbook"}'), /not a KherveCalc session/)
  assert.throws(() => parseSession('nope'), /not a KherveCalc session/)
})

test('ans numbering skips errors; definitions replace older ones', () => {
  const e = (id: string, ok: boolean): HistoryEntry => ({ id, input: id, answer: { ok }, mode: { number: 'exact', angle: 'rad', digits: 12 }, time: 0 })
  const h = [e('a', true), e('b', false), e('c', true), e('d', true)]
  assert.deepEqual(ansIds(h), ['d', 'c', 'a'])
  assert.deepEqual(ansIds(h, 2), ['a'])
  assert.equal(defName('f(x, y) := x*y'), 'f')
  assert.equal(defName('a:=3'), 'a')
  assert.equal(defName('5 -> b'), 'b')
  assert.equal(defName('2 + 2'), null)
  assert.deepEqual(upsertDef(['a := 1', 'b := 2'], 'a', 'a := 5'), ['b := 2', 'a := 5'])
  assert.deepEqual(inputHistory([e('x', true), e('x', true), e('y', true)]), ['x', 'y'])
})

test('keypad inserts are well formed', () => {
  for (const row of KEYPAD) {
    assert.equal(row.length, 6, 'six keys a row')
    for (const k of row) {
      for (const face of [k, k.shift, k.alpha]) {
        if (!face?.insert) continue
        assert.ok((face.insert.match(/\|/g) ?? []).length <= 1, `${face.label}: one cursor mark`)
        const body = face.insert.replace('|', '')
        const open = (body.match(/\(/g) ?? []).length
        const close = (body.match(/\)/g) ?? []).length
        if (!['(', ')', '[', ']'].includes(body)) assert.equal(open, close, `${face.label}: balanced brackets`)
      }
    }
  }
  assert.deepEqual(applyInsert('2+3', 2, 3, 'sqrt(|)'), { text: '2+sqrt(3)', cursor: 8 })
  assert.deepEqual(applyInsert('x', 1, 1, '^2'), { text: 'x^2', cursor: 3 })
})

test('completion and the catalog', () => {
  assert.deepEqual(wordBefore('2*sq', 4), { word: 'sq', start: 2 })
  assert.equal(wordBefore('3_km', 4).word, '')
  assert.equal(wordBefore('#hb', 3).word, '')
  assert.equal(complete('integ')[0].name, 'integrate')
  assert.ok(complete('si').some((c) => c.name === 'sin'))
  const names = CATALOG.map((c) => `${c.cat}:${c.name}`)
  assert.equal(new Set(names).size, names.length, 'no duplicates in a category')
})

test('answers are shown exact, decimal or as fractions', () => {
  const S = { ...DEFAULT_SETTINGS }
  const sqrt2 = { ok: true, kind: 'value' as const, latex: '\\sqrt{2}', text: 'sqrt(2)', exact: true, show_approx: true, num: { re: sci('', '14142135623730950488', 0), im: null } }
  const ex = shown(sqrt2, S)
  assert.equal(ex.latex, '\\sqrt{2}')
  assert.equal(ex.approxText, '1.41421356237')
  const dec = shown(sqrt2, { ...S, number: 'decimal', digits: 5 })
  assert.equal(dec.text, '1.4142')
  assert.equal(dec.approxLatex, undefined)
  const int = shown({ ok: true, kind: 'value', latex: '120', text: '120', exact: true, num: { re: sci('', '12', 2), im: null } }, S)
  assert.equal(int.approxLatex, undefined)
  const q = shown({ ok: true, kind: 'quantity', latex: '21600\\, \\mathrm{m}', text: '21600*_m', exact: true, unit_latex: '\\mathrm{m}', unit_text: '_m', num: { re: sci('', '216', 4), im: null } }, S)
  assert.equal(q.approxLatex, undefined)
  assert.equal(shown({ ok: false, error: 'Missing )' }, S).error, 'Missing )')
  assert.equal(texName('x_1'), 'x_{1}')
  assert.equal(texName('alpha'), '\\alpha')
})
