// Node tests for KherveFitting's TypeScript logic (no browser needed).
// Run: node --test src/apps/khervefitting/tests/logic.test.mjs
// (Node ≥ 23.6 loads the .ts files directly.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  exponentFor, extent, fromPx, hitLine, hitTop, nearestIndex, niceTicks, ordered, padded, scale, superscript, tickLabel, toPx, valueAt,
  zoomRange,
} from '../plotmath.ts'
import { ALL_MODELS, PEAK_COLUMNS, isEditable, num, peaksOf, reversedAxis, sampleOf, xLabel } from '../model.ts'
import { exampleFileName, jsonSibling, parseIndex, safeFile } from '../examples.ts'

test('the binding-energy axis runs from high (left) to low (right)', () => {
  const s = scale({ min: 280, max: 300 }, 100, 500, true)
  assert.equal(toPx(s, 300), 100)
  assert.equal(toPx(s, 280), 500)
  assert.equal(fromPx(s, 300), 290)
  const k = scale({ min: 280, max: 300 }, 100, 500, false)
  assert.equal(toPx(k, 280), 100)
})

test('pixels and data values round-trip', () => {
  const s = scale({ min: -3.5, max: 1e5 }, 412, 12)
  for (const v of [-3.5, 0, 1234.5, 99999]) assert.ok(Math.abs(fromPx(s, toPx(s, v)) - v) < 1e-6)
})

test('extent skips nulls and non-finite values', () => {
  assert.deepEqual(extent([3, null, 1, NaN], [7, Infinity]), { min: 1, max: 7 })
  assert.equal(extent([null], null, undefined), null)
})

test('ticks are round numbers inside the range', () => {
  const { ticks, step } = niceTicks(281.3, 297.9, 6)
  assert.equal(step, 2)
  assert.equal(ticks[0], 282)
  assert.equal(ticks.at(-1), 296)
  assert.ok(ticks.every((t) => t >= 281.3 && t <= 297.9))
  const unit = niceTicks(0, 1, 5)
  assert.equal(unit.step, 0.2)
  assert.equal(unit.ticks.length, 6)
  assert.ok(Math.abs(unit.ticks[5] - 1) < 1e-12)
  assert.equal(tickLabel(0.6000000000000001, 0.2), '0.6')
  assert.equal(tickLabel(284, 2), '284')
  assert.equal(tickLabel(1e5, 2e4), '100000')
})

test('intensity axis exponent (×10⁴) like matplotlib’s scientific labels', () => {
  assert.equal(exponentFor(5000), 0)
  assert.equal(exponentFor(137411), 5)
  assert.equal(superscript(5), '⁵')
  assert.equal(superscript(-12), '⁻¹²')
})

test('zooming keeps the point under the mouse', () => {
  const r = zoomRange({ min: 280, max: 300 }, 285, 0.5)
  assert.deepEqual(r, { min: 282.5, max: 292.5 })
  assert.deepEqual(ordered(5, 2), { min: 2, max: 5 })
  assert.deepEqual(padded({ min: 0, max: 100 }, 0, 0.1), { min: 0, max: 110 })
})

test('finding peaks and lines under the mouse', () => {
  const tops = [{ x: 100, y: 50 }, null, { x: 104, y: 52 }]
  assert.equal(hitTop(tops, 103, 52), 2)
  assert.equal(hitTop(tops, 300, 300), -1)
  assert.equal(hitLine([10, 200], 204), 1)
  assert.equal(hitLine([10, null], 50), -1)
})

test('values between data points are interpolated (spectra run high to low)', () => {
  const xs = [290, 289, 288, 287]
  const ys = [10, 20, 30, 40]
  assert.equal(nearestIndex(xs, 288.4), 2)
  assert.equal(valueAt(xs, ys, 288.5), 25)
  assert.equal(valueAt(xs, ys, 289), 20)
  assert.equal(valueAt(xs, [10, null, 30, 40], 289), null)
})

test('the peak table: editable cells, peaks, numbers', () => {
  assert.equal(PEAK_COLUMNS.length, 19)
  assert.ok(isEditable(0, 2) && isEditable(1, 2) && isEditable(0, 13))
  assert.ok(!isEditable(0, 0) && !isEditable(1, 13) && !isEditable(0, 10))
  const grid = [
    ['A', 'C1s C-C', '284.80', '1000', '1.2', '30', '1500', '', '', '', '60.0', '100.00', '0.00', 'GL (Area)', 'Shirley', '280', '295', '0', '0'],
    ['', '', '280,295', '1:1e7', '0.3:3.5', '2:80', '1:1e7', '0.3:3', '0.3:3', '0.01:2', '', '', '', '', '', '', '', '', ''],
    ['B', 'C1s C-O', '286.30', '500', '1.2', '30', '750', '', '', '', '40.0', '50.00', '1.50', 'GL (Area)', 'Shirley', '280', '295', '0', '0'],
    ['', '', 'A+1.5#0.2', '1:1e7', 'A*1', 'A*1', '1:1e7', '0.3:3', '0.3:3', '0.01:2', '', '', '', '', '', '', '', '', ''],
  ]
  const p = peaksOf(grid)
  assert.equal(p.length, 2)
  assert.deepEqual([p[1].letter, p[1].position, p[1].height, p[1].model], ['B', 286.3, 500, 'GL (Area)'])
  assert.equal(num(''), null)
  assert.equal(num('1e4'), 10000)
  assert.equal(num('abc'), null)
  assert.ok(ALL_MODELS.includes('SGL (Area)') && ALL_MODELS.includes('LA (Area, σ/γ, γ)'))
})

test('sheets: sample numbers and axes as on the desktop', () => {
  assert.equal(sampleOf('C1s'), 0)
  assert.equal(sampleOf('Sr3d2'), 2)
  assert.equal(reversedAxis('C1s'), true)
  assert.equal(reversedAxis('Raman_x'), false)
  assert.equal(reversedAxis('XAS~CeM34'), false)
  assert.equal(xLabel('O1s'), 'Binding Energy (eV)')
})

test('the examples index: only safe relative workbook paths', () => {
  const menus = parseIndex({
    menus: [
      { name: 'C', items: [{ title: 'Carbon SP2', file: 'C/Carbon SP2.xlsx' }, { title: 'bad', file: '../etc/passwd.xlsx' }], groups: [{ name: 'PET', items: [{ title: 'PET', file: 'C/PET/PET.xlsx' }] }] },
      { name: 'Metals', items: [{ title: 'Pt (VAMAS)', file: 'zz Metals/Pt4f.vms' }, { file: 'https://x.org/a.xlsx' }, { file: '/abs.xlsx' }, { file: 'a.json' }] },
      'junk',
    ],
  })
  assert.equal(menus.length, 2)
  assert.deepEqual(menus[0].items.map((x) => x.file), ['C/Carbon SP2.xlsx'])
  assert.equal(menus[0].groups[0].items[0].title, 'PET')
  assert.deepEqual(menus[1].items.map((x) => x.file), ['zz Metals/Pt4f.vms'])
  assert.throws(() => parseIndex([]))
  assert.ok(safeFile('a/b c.xlsx') && !safeFile('a\\b.xlsx') && !safeFile('x.py'))
  assert.equal(jsonSibling('/home/user/C1s.xlsx'), '/home/user/C1s.json')
  assert.equal(exampleFileName('Pt4f (VAMAS)'), 'Pt4f.xlsx')
  assert.equal(exampleFileName('a/b:c'), 'a b c.xlsx')
})
