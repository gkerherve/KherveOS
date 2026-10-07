// KherveSheet's Python editor helpers against the desktop (python_engine.py,
// mainwindow._show_statistics).  Run:  node --test tools/tests/khervesheet-python.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorLineFrom, fmt6g, fmtLoopPeriod, pyTokens, statisticsText } from '../../src/apps/khervesheet/pytext.ts'

test('highlighting follows PythonHighlighter (rules in order, later ones win)', () => {
  const kinds = (line: string) => pyTokens(line).map((t) => [t.kind, t.text])
  assert.deepEqual(kinds('def f(x): return 2'), [[1, 'def'], [0, ' f(x): '], [1, 'return'], [0, ' '], [2, '2']])
  // A keyword inside a string is a string; anything after # is a comment.
  assert.deepEqual(kinds('s = "for 3"  # if 4'), [[0, 's = '], [3, '"for 3"'], [0, '  '], [4, '# if 4']])
  assert.deepEqual(kinds('x1 = 1.5'), [[0, 'x1 = '], [2, '1.5']])
  assert.deepEqual(pyTokens(''), [])
})

test('the error line comes from the last "<py-cell>" frame', () => {
  const tb = 'Traceback (most recent call last):\n  File "/x/core/python.py", line 363, in _exec_with_value\n  File "<py-cell>", line 2, in <module>\n    f()\n  File "<py-cell>", line 5, in f\nNameError: x'
  assert.equal(errorLineFrom(tb), 5)
  assert.equal(errorLineFrom('ValueError: no frame'), null)
  assert.equal(errorLineFrom(null), null)
})

test('loop periods are labelled like fmt_loop_period', () => {
  assert.equal(fmtLoopPeriod(0.1), '0.1s')
  assert.equal(fmtLoopPeriod(0.5), '0.5s')
  assert.equal(fmtLoopPeriod(5), '5s')
  assert.equal(fmtLoopPeriod(59.6), '1m')
  assert.equal(fmtLoopPeriod(90), '1m')
  assert.equal(fmtLoopPeriod(900), '15m')
  assert.equal(fmtLoopPeriod(7200), '2h')
})

test('numbers are written as Python "%.6g"', () => {
  const cases: [number, string][] = [
    [0.1, '0.1'], [1234567, '1.23457e+06'], [123456, '123456'], [0.0001, '0.0001'], [1.234e-5, '1.234e-05'], [-2.5e-7, '-2.5e-07'],
    [3.14159265, '3.14159'], [1e21, '1e+21'], [99.99999, '100'], [2, '2'], [1 / 3, '0.333333'], [-0.5, '-0.5'], [6.02214076e23, '6.02214e+23'],
  ]
  for (const [v, want] of cases) assert.equal(fmt6g(v), want, String(v))
})

test('Statistics on Selection matches the desktop message', () => {
  assert.equal(statisticsText([1, 2, 3, 4]), 'Count: 4\nSum: 10\nMean: 2.5\nStd Dev: 1.11803\nMin: 1\nMax: 4\nMedian: 2.5')
  assert.equal(statisticsText([]), null)
})
