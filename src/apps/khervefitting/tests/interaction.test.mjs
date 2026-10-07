// Node tests for the desktop's keyboard and plot-limit rules (interaction.ts:
// On_Key_Defs.py, PlotConfig.adjust_plot_limits, FittingWindow.on_key_down).
// Run: node --test src/apps/khervefitting/tests/interaction.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjustLimits, intensityKey, keyAction, panKey, shiftOffset, stepDigit, stepPeak, xAxisStep, zoomKey } from '../interaction.ts'

const L = { xmin: 280, xmax: 300, ymin: -15, ymax: 1200 }
const ys = [100, 1000, 200]
const near = (a, b) => Math.abs(a - b) < 1e-9

test('x steps: 2 % of the span (≥ 0.2) for zoom and edges, 1 % (≥ 0.1) for Ctrl+Left/Right', () => {
  assert.equal(xAxisStep(L), 0.4)
  assert.equal(xAxisStep({ ...L, xmin: 299, xmax: 300 }), 0.2)
  const z = zoomKey(L, false)
  assert.ok(near(z.xmin, 280.4) && near(z.xmax, 299.6))
  const o = zoomKey(L, true)
  assert.ok(near(o.xmin, 279.6) && near(o.xmax, 300.4))
  const left = panKey(L, true)
  assert.ok(near(left.xmin, 279.8) && near(left.xmax, 299.8), 'Ctrl+Left lowers both limits')
  const right = panKey(L, false)
  assert.ok(near(right.xmin, 280.2) && near(right.xmax, 300.2))
})

test('Ctrl+Up / Ctrl+Down: the top of the intensity axis by 5 % of the tallest point', () => {
  assert.equal(intensityKey(L, true, ys).ymax, 1250)
  assert.equal(intensityKey(L, false, ys).ymax, 1150)
  assert.equal(intensityKey({ ...L, ymax: -10 }, false, ys).ymax, -15, 'never below Ymin')
})

test('edge arrows follow the icons on the reversed BE axis (PlotConfig.adjust_plot_limits)', () => {
  // High BE + (Right-Red icon): the left (high BE) edge moves right → Xmax decreases
  assert.ok(near(adjustLimits(L, 'high_be', 'increase', ys).xmax, 299.6))
  assert.ok(near(adjustLimits(L, 'high_be', 'decrease', ys).xmax, 300.4))
  // Low BE + (Left-blue icon): the right (low BE) edge moves left → Xmin increases
  assert.ok(near(adjustLimits(L, 'low_be', 'increase', ys).xmin, 280.4))
  assert.ok(near(adjustLimits(L, 'low_be', 'decrease', ys).xmin, 279.6))
  // forward axes (Raman, XAS): the other way round
  assert.ok(near(adjustLimits(L, 'high_be', 'increase', ys, true).xmax, 300.4))
  assert.equal(adjustLimits(L, 'high_int', 'increase', ys).ymax, 1250)
  assert.equal(adjustLimits(L, 'low_int', 'decrease', ys).ymin, -35)
  assert.equal(adjustLimits(L, 'low_int', 'increase', ys).ymin, 5)
})

const ctx = { limits: L, ys, forward: false, selected: false, bkgTab: false, fitTab: false, hasPeaks: true, typing: false }
const k = (key, mods = {}, c = {}) => keyAction({ key, ctrl: false, shift: false, alt: false, ...mods }, { ...ctx, ...c })

test('Ctrl keys (⌘ on a Mac) as KeyEventHandlers._handle_ctrl_key_combinations', () => {
  assert.deepEqual(k('z', { ctrl: true }), { type: 'command', id: 'undo' })
  assert.deepEqual(k('y', { ctrl: true }), { type: 'command', id: 'redo' })
  assert.deepEqual(k('s', { ctrl: true }), { type: 'command', id: 'save' })
  assert.deepEqual(k('o', { ctrl: true }), { type: 'command', id: 'open' })
  assert.deepEqual(k('p', { ctrl: true }), { type: 'command', id: 'fitting' })
  assert.deepEqual(k('k', { ctrl: true }), { type: 'command', id: 'shortcuts' })
  assert.deepEqual(k('b', { ctrl: true }), { type: 'command', id: 'energyScale' })
  assert.deepEqual(k('[', { ctrl: true }), { type: 'sheet', step: -1 })
  assert.deepEqual(k('9', { ctrl: true }), { type: 'sheet', step: -1 })
  assert.deepEqual(k(']', { ctrl: true }), { type: 'sheet', step: 1 })
  assert.deepEqual(k('0', { ctrl: true }), { type: 'sheet', step: 1 })
  assert.equal(k('ArrowUp', { ctrl: true }).limits.ymax, 1250)
  assert.ok(near(k('ArrowLeft', { ctrl: true }).limits.xmin, 279.8))
  assert.ok(near(k('-', { ctrl: true }).limits.xmin, 279.6))
  assert.ok(near(k('=', { ctrl: true }).limits.xmin, 280.4))
  assert.ok(near(k('+', { ctrl: true }).limits.xmin, 280.4))
  // a modifier key works even while typing (wx: only plain keys belong to the text field)
  assert.deepEqual(k('z', { ctrl: true }, { typing: true }), { type: 'command', id: 'undo' })
})

test('Shift+Left / Shift+Right move the high-BE edge', () => {
  assert.ok(near(k('ArrowLeft', { shift: true }).limits.xmax, 299.6))
  assert.ok(near(k('ArrowRight', { shift: true }).limits.xmax, 300.4))
})

test('Alt keys act on the selected peak only', () => {
  assert.equal(k('ArrowLeft', { alt: true }), null)
  const s = { selected: true }
  assert.deepEqual(k('ArrowLeft', { alt: true }, s), { type: 'peak', key: 'left' })
  assert.deepEqual(k('ArrowRight', { alt: true }, s), { type: 'peak', key: 'right' })
  assert.deepEqual(k('ArrowUp', { alt: true }, s), { type: 'peak', key: 'up' })
  assert.deepEqual(k('ArrowDown', { alt: true }, s), { type: 'peak', key: 'down' })
  assert.deepEqual(k('ArrowRight', { alt: true, shift: true }, s), { type: 'peak', key: 'wider' })
  assert.deepEqual(k('ArrowLeft', { alt: true, shift: true }, s), { type: 'peak', key: 'narrower' })
})

test('Tab / Q: region on the BKG tab, peak on the Fitting tab, the hint otherwise; never while typing', () => {
  assert.deepEqual(k('Tab', {}, { bkgTab: true }), { type: 'nextRegion' })
  assert.deepEqual(k('Tab', {}, { fitTab: true }), { type: 'peakStep', step: 1 })
  assert.deepEqual(k('Tab', { shift: true }, { fitTab: true }), { type: 'peakStep', step: -1 })
  assert.deepEqual(k('q', {}, { fitTab: true }), { type: 'peakStep', step: -1 })
  assert.deepEqual(k('Tab'), { type: 'needFittingTab' })
  assert.deepEqual(k('q'), { type: 'needFittingTab' })
  assert.equal(k('q', {}, { fitTab: true, typing: true }), null)
  assert.equal(k('ArrowUp'), null)
  assert.equal(stepPeak(null, 3, 1), 0)
  assert.equal(stepPeak(null, 3, -1), 2)
  assert.equal(stepPeak(2, 3, 1), 0)
  assert.equal(stepPeak(0, 3, -1), 2)
})

test('Up / Down in the BKG fields step the digit right of the cursor', () => {
  assert.equal(stepDigit('284.50', 2, true), '285.50')
  assert.equal(stepDigit('284.50', 4, true), '284.60')
  assert.equal(stepDigit('284.50', 5, false), '284.49')
  assert.equal(stepDigit('-29.06', 1, true), '-19.06')
  assert.equal(stepDigit('284.50', 3, true), null, 'on the dot')
  assert.equal(stepDigit('284.50', 6, true), null, 'at the end')
  assert.equal(stepDigit('5', 0, true), '6')
})

test('Shift+click: the nearer line takes the offset (mouse height − data there, never positive)', () => {
  const xs = [300, 295, 290, 285, 280]
  const yv = [500, 600, 900, 700, 400]
  assert.deepEqual(shiftOffset(281, 350, [280, 300], xs, yv), { side: 'l', value: -50 })
  assert.deepEqual(shiftOffset(299, 450, [280, 300], xs, yv), { side: 'h', value: -50 })
  assert.deepEqual(shiftOffset(299, 900, [280, 300], xs, yv), { side: 'h', value: 0 })
})
