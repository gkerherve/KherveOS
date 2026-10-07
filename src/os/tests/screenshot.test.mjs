// Node tests for screenshots' file names and sizes (no browser).
// Run: node --test src/os/tests/screenshot.test.mjs   (Node ≥ 23.6 loads the .ts directly)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitWithin, freeName, screenshotFileName, splitDataUrl } from '../screenshotCore.ts'

test('names a screenshot like macOS, in local time', () => {
  assert.equal(screenshotFileName(new Date(2026, 9, 7, 9, 5, 3)), 'Screenshot 2026-10-07 at 09.05.03.png')
  assert.equal(screenshotFileName(new Date(2026, 0, 31, 23, 59, 59)), 'Screenshot 2026-01-31 at 23.59.59.png')
})

test('two screenshots in the same second get "2", "3"…', () => {
  const taken = new Set(['Screenshot 2026-10-07 at 09.05.03.png', 'Screenshot 2026-10-07 at 09.05.03 2.png'])
  assert.equal(freeName('Screenshot 2026-10-07 at 09.05.03.png', (n) => taken.has(n)), 'Screenshot 2026-10-07 at 09.05.03 3.png')
  assert.equal(freeName('a.png', () => false), 'a.png')
  assert.equal(freeName('noext', (n) => n === 'noext'), 'noext 2')
})

test('fits a picture into a size without growing it', () => {
  assert.deepEqual(fitWithin(3136, 1000, 1568), { w: 1568, h: 500, scale: 0.5 })
  assert.deepEqual(fitWithin(1000, 3136, 1568), { w: 500, h: 1568, scale: 0.5 })
  assert.deepEqual(fitWithin(800, 600, 1568), { w: 800, h: 600, scale: 1 })
  assert.deepEqual(fitWithin(0, 0, 1568), { w: 1, h: 1, scale: 1 })
})

test('splits a base64 data URL', () => {
  assert.deepEqual(splitDataUrl('data:image/png;base64,iVBORw0K'), { mime: 'image/png', data: 'iVBORw0K' })
  assert.equal(splitDataUrl('data:text/plain,hello'), null)
  assert.equal(splitDataUrl('https://example.com/a.png'), null)
})
