// Node tests for KherveSlide's file format and LaTeX (no browser needed).
// Run: node --test src/apps/kherveslide/tests/format.test.mjs
// (Node ≥ 23.6 loads the .ts files directly.)
//
// The fixtures were made by the desktop KherveSlide itself (dev branch,
// tests/export_examples.py): for every example presentation in
// public/examples/kherveslide/, what the desktop writes after reading it
// (deck_to_json(deck_from_json(file)) → *.canonical.kslide) and the beamer
// LaTeX it compiles (serialize_deck → *.tex); features.kslide is an old-style
// file with the legacy fields and everything the examples don't use.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cloneDeck, fromJson, linePath, makeDeck, makeObject, makeSlide, pyFloatRepr, toJson } from '../model.ts'
import { fmt, serializeDeck } from '../serializer.ts'
import { addSlideFromBullets, bulletsOf, itemize, slideLayout, SLIDE_LAYOUTS, TEMPLATES, newFromTemplate } from '../templates.ts'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const EXAMPLES = here('../../../../public/examples/kherveslide/')
const FIX = here('./fixtures/')
const read = (p) => readFileSync(p, 'utf8')

const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith('.kslide'))

test('every example in index.json exists and loads', () => {
  const index = JSON.parse(read(EXAMPLES + 'index.json'))
  assert.equal(index.items.length, examples.length)
  for (const item of index.items) {
    assert.ok(examples.includes(item.file), item.file)
    const deck = fromJson(read(EXAMPLES + item.file))
    assert.ok(deck.slides.length > 3, `${item.file} has slides`)
  }
})

for (const f of examples) {
  const stem = f.replace(/\.kslide$/, '')

  test(`round trip: ${stem} is written back exactly as the desktop writes it`, () => {
    const want = read(FIX + `${stem}.canonical.kslide`)
    assert.equal(toJson(fromJson(read(EXAMPLES + f))), want)
    // …and a file KherveOS saved reads back to the same thing.
    assert.equal(toJson(fromJson(want)), want)
  })

  test(`LaTeX: ${stem} gives the desktop's beamer source, byte for byte`, () => {
    assert.equal(serializeDeck(fromJson(read(EXAMPLES + f))), read(FIX + `${stem}.tex`))
  })

  test(`pictures of ${stem} are shipped in media/`, () => {
    const deck = fromJson(read(EXAMPLES + f))
    const media = new Set(readdirSync(EXAMPLES + 'media'))
    const paths = [deck.theme_spec.logo, ...[...deck.slides, deck.master].flatMap((s) => s.objects.map((o) => o.path ?? ''))].filter(Boolean)
    for (const p of paths) {
      assert.match(p, /^media\//)
      assert.ok(media.has(p.slice(6)), p)
    }
  })
}

test('an old desktop file: legacy fields, ints for floats, missing keys', () => {
  const deck = fromJson(read(FIX + 'features.kslide'))
  assert.equal(toJson(deck), read(FIX + 'features.canonical.kslide'))
  // A pre-locking "standard" slide: its objects become beamer-placed.
  assert.equal(deck.slides[0].objects[1].locked, true)
  // Missing "locked" on a free slide: free.
  assert.equal(deck.slides[1].objects[3].locked, false)
  // The legacy border flag becomes the grid; cells become text.
  const table = deck.slides[0].objects[4]
  assert.equal(table.grid, 'none')
  assert.deepEqual(table.rows[3], ['6', '7', '8.5'])
  // int() truncates, bool() of 1 is true.
  assert.equal(deck.slides[0].objects[1].font_pt, 17)
  assert.equal(deck.slides[0].objects[1].bold, true)
  // \mbox{} blank lines from old PowerPoint imports are plain empty lines.
  assert.ok(!deck.slides[0].objects[1].text.includes('\\mbox{}'))
  // An unfinished Bézier segment is dropped.
  assert.equal(deck.slides[1].objects[3].curve.length, 6)
})

test('LaTeX of the feature file: flow, columns, blocks, master, theme builder, logo, video, crop', () => {
  const deck = fromJson(read(FIX + 'features.kslide'))
  assert.equal(serializeDeck(deck), read(FIX + 'features.tex'))
  deck.page_w_cm = 20
  deck.page_h_cm = 11.25
  deck.nav_symbols = false
  deck.plain_frames = false
  deck.theme_spec.footer_bar = false
  assert.equal(serializeDeck(deck), read(FIX + 'features-page.tex'))
})

test('the compile hooks rename pictures and use baked effects', () => {
  const deck = fromJson(read(FIX + 'features.kslide'))
  const tex = serializeDeck(deck, {
    imagePath: (p) => (p.endsWith('.gif') ? 'img/anim.png' : `img/${p.split('/').pop()}`),
    baked: (o) => (o.path.endsWith('example_xrd.png') ? { path: 'img/baked.png', pad: [0, 0, 0, 0] } : null),
  })
  assert.ok(tex.includes('{img/anim.png}'), 'a GIF converted to PNG is included')
  assert.ok(tex.includes('{img/baked.png}'))
  assert.ok(!tex.includes('media/example_xrd.png'))
  assert.ok(tex.includes('{img/icon_kherveslide.png}'), 'the logo goes through the hook')
  // Without the hook a GIF is an empty frame, as on the desktop.
  assert.ok(!serializeDeck(deck).includes('anim.gif'))
})

test('numbers are written as Python writes them', () => {
  assert.equal(fmt(0.03125), '0.0312')
  assert.equal(fmt(0.09375), '0.0938')
  assert.equal(fmt(-0.03125), '-0.0312')
  assert.equal(fmt(0.15625), '0.1562')
  assert.equal(fmt(1 / 3), '0.3333')
  assert.equal(fmt(-0), '-0')
  assert.equal(fmt(0.00001), '0')
  assert.equal(fmt(-0.00001), '-0')
  assert.equal(fmt(2.5), '2.5')
  assert.equal(fmt(123.45675), '123.4567')
  const reprs = [0.1, 1e-5, 1e16, 1.5e-7, 123456789012345678, 0.0001, -0, 1e300, 2, 0.5]
  assert.deepEqual(reprs.map(pyFloatRepr), ['0.1', '1e-05', '1e+16', '1.5e-07', '1.2345678901234568e+17', '0.0001', '-0.0', '1e+300', '2.0', '0.5'])
})

test('a new presentation survives a round trip and edits', () => {
  for (const name of Object.keys(TEMPLATES)) {
    const deck = newFromTemplate(name)
    const text = toJson(deck)
    assert.equal(toJson(fromJson(text)), text, name)
    assert.ok(serializeDeck(deck).includes('\\begin{document}'))
  }
  for (const name of Object.keys(SLIDE_LAYOUTS)) assert.ok(slideLayout(name).type === 'Slide', name)
  const deck = makeDeck({ slides: [makeSlide()] })
  const s = addSlideFromBullets(deck, 'Results', ['First', 'Second'], 1)
  assert.equal(deck.slides.length, 2)
  assert.equal(s.title, 'Results')
  assert.deepEqual(bulletsOf(s), ['First', 'Second'])
  const copy = fromJson(toJson(deck))
  assert.deepEqual(copy, cloneDeck(deck))
  assert.equal(itemize(['a', 'b']), '\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}')
})

test('line geometry', () => {
  const l = makeObject('SlideLine', { x: 0.1, y: 0.2, w: 0.5, h: 0.4 })
  assert.deepEqual(linePath(l), [[0.1, 0.2], [0.6, 0.6000000000000001]])
  l.curve = [0.5, 0, 0.5, 1, 1, 1]
  assert.equal(linePath(l).length, 4)
})
