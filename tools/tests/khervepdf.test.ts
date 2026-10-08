// Node tests for KhervePDF's pure logic (no browser, no MuPDF).
// Run: node --test tools/tests/khervepdf.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectAlign, fontStyleOf, formatCommitTime, lineBoxes, moveItem, paragraphAt, parseZoomText, relativeTo, wordsText, ZOOM_BASE, ZOOM_ITEMS,
  zoomComboText,
} from '../../src/apps/khervepdf/logic.ts'
import { OPTIONS_TOOLS, PALETTE, TOOLS, toolStatusName } from '../../src/apps/khervepdf/tools.ts'
import { base14Name, wrapText } from '../../src/os/services/pdf.engine.ts'
import type { PdfWord } from '../../src/os/services/pdf.ts'

test('zoom combo: presets, typed percentages, fit width (MainWindow._apply_zoom_combo)', () => {
  assert.deepEqual(ZOOM_ITEMS, ['Fit Width', '50%', '75%', '100%', '125%', '150%', '200%', '300%', '400%'])
  assert.equal(parseZoomText('Fit Width'), 'fit')
  assert.equal(parseZoomText('fit'), 'fit')
  assert.equal(parseZoomText('150%'), 1.5)
  assert.equal(parseZoomText(' 80 % '), 0.8)
  assert.equal(parseZoomText('2000'), 8) // _set_zoom clamps to 0.1–8
  assert.equal(parseZoomText('abc'), null)
  assert.equal(parseZoomText(''), null)
  assert.equal(zoomComboText(true, 123), 'Fit Width')
  assert.equal(zoomComboText(false, 124.6), '125%')
  assert.equal(ZOOM_BASE, 2) // 100 % = 144 dpi
})

test('toolbar: the desktop tools in order, dropdowns on the drawing tools', () => {
  const bar = TOOLS.filter((t) => t.toolbar).map((t) => t.id)
  assert.deepEqual(bar, [
    'hand', 'select', 'select_text', 'snapshot', 'pen', 'highlight', 'underline', 'strikeout', 'text', 'edit_text', 'move_text',
    'line', 'arrow', 'rect', 'ellipse', 'note', 'signature', 'erase',
  ])
  assert.deepEqual([...OPTIONS_TOOLS].sort(), ['arrow', 'edit_text', 'ellipse', 'highlight', 'line', 'pen', 'rect', 'strikeout', 'text', 'underline'])
  assert.equal(PALETTE.length, 4)
  assert.ok(PALETTE.every((r) => r.length === 10))
  assert.equal(toolStatusName('select_text'), 'Select text')
  assert.equal(toolStatusName('hand'), 'Hand')
})

test('moveItem reorders tabs', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b'])
})

test('fontStyleOf maps PDF font names to the base-14 fonts', () => {
  assert.deepEqual(fontStyleOf('ABCDEF+Times-BoldItalic'), { font: 'TiRo', bold: true, italic: true })
  assert.deepEqual(fontStyleOf('Arial-BoldMT'), { font: 'Helv', bold: true, italic: false })
  assert.deepEqual(fontStyleOf('CourierNewPSMT'), { font: 'Cour', bold: false, italic: false })
  assert.deepEqual(fontStyleOf('SourceSansPro-Regular'), { font: 'Helv', bold: false, italic: false })
  assert.equal(base14Name('TiRo', true, false), 'Times-Bold')
  assert.equal(base14Name('Helv', false, true), 'Helvetica-Oblique')
  assert.equal(base14Name(undefined), 'Helvetica')
  assert.equal(base14Name('Cour', true, true), 'Courier-BoldOblique')
})

test('wrapText breaks at the width, keeps paragraphs and long words', () => {
  const m = (s: string) => s.length // one unit per character
  assert.deepEqual(wrapText('aa bb cc dd', 5, m), ['aa bb', 'cc dd'])
  assert.deepEqual(wrapText('one\n\ntwo', 10, m), ['one', '', 'two'])
  assert.deepEqual(wrapText('supercalifragilistic x', 5, m), ['supercalifragilistic', 'x'])
})

// Two paragraphs of a block: lines 0–1, then a gap, then line 2.
const W = (text: string, x0: number, y0: number, line: number, block = 0): PdfWord => ({
  text, rect: [x0, y0, x0 + text.length * 5, y0 + 10], line, block, size: 9, font: 'Times-Roman', color: '#112233',
})
const words: PdfWord[] = [
  W('Hello', 10, 10, 0), W('world', 45, 10, 0),
  W('flex-', 10, 22, 1), W('ibility', 45, 22, 1),
  W('Next', 10, 60, 2), W('para', 45, 60, 2),
  W('Other', 300, 10, 3, 1),
]

test('paragraphAt finds the paragraph under the point (Edit / Move Text)', () => {
  const p = paragraphAt(words, 0, 50, 15)!
  assert.deepEqual(p.words, [0, 1, 2, 3])
  assert.deepEqual(p.rect, [10, 10, 80, 32])
  assert.equal(p.size, 9)
  assert.equal(p.fontName, 'Times-Roman')
  assert.equal(p.color, '#112233')
  assert.equal(p.lines.length, 2)
  const q = paragraphAt(words, 0, 12, 63)!
  assert.deepEqual(q.words, [4, 5])
  assert.deepEqual(paragraphAt(words, 0, 305, 12)!.words, [6])
  assert.equal(paragraphAt(words, 0, 200, 200), null)
})

test('wordsText joins lines and drops line-end hyphens unless line breaks are kept', () => {
  const ws = words.slice(0, 4)
  assert.equal(wordsText(ws), 'Hello world flex- ibility')
  assert.equal(wordsText(ws, true), 'Hello world\nflex- ibility')
  const split = [W('a', 0, 0, 0), W('flex-', 10, 0, 0), W('ibility', 0, 12, 1)]
  assert.equal(wordsText(split), 'a flexibility')
  assert.equal(wordsText(split, true), 'a flex-\nibility')
  assert.deepEqual(lineBoxes(ws), [[10, 10, 70, 20], [10, 22, 80, 32]])
})

test('detectAlign', () => {
  assert.equal(detectAlign([[0, 0, 100, 10], [0, 12, 100, 22], [0, 24, 40, 34]], [0, 0, 100, 34], 10), 'justify')
  assert.equal(detectAlign([[0, 0, 80, 10], [0, 12, 100, 22], [0, 24, 40, 34]], [0, 0, 100, 34], 10), 'left')
  assert.equal(detectAlign([[20, 0, 100, 10], [5, 12, 100, 22]], [5, 0, 100, 22], 10), 'right')
  assert.equal(detectAlign([[20, 0, 80, 10], [10, 12, 90, 22]], [10, 0, 90, 22], 10), 'center')
  assert.equal(detectAlign([[0, 0, 10, 10]], [0, 0, 10, 10], 10), 'left')
})

test('git helpers', () => {
  assert.equal(relativeTo('/home/u/Documents', '/home/u/Documents/a/b.pdf'), 'a/b.pdf')
  assert.equal(relativeTo('/home/u/Documents/', '/home/u/Documents/b.pdf'), 'b.pdf')
  assert.equal(relativeTo('/home/u/Doc', '/home/u/Documents/b.pdf'), null)
  assert.match(formatCommitTime(1_700_000_000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})
