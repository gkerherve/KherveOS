// Node tests for KherveNote's file format, LaTeX and page conversion (no browser).
// Run: node --test src/apps/khervenote/tests/format.test.mjs
// (Node ≥ 23.6 loads the .ts files directly.)
//
// The fixtures were made by the desktop KherveNote itself (dev branch, see
// export_desktop_fixtures.py): the example notes in public/examples/khervenote/
// as the desktop saves them, the LaTeX its serializer writes for each (both
// layouts), plain_text(), a features note using everything the examples
// don't, and markdown_blocks() / tex() cases.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import {
  fromDict, makeBlock, makeNote, makeSection, markdownBlocks, newNote, noteJson, plainText, sectionSpeechRange, speechBetween, timeLabel, toDict,
} from '../model.ts'
import { escape, mathSpans, richToLatex, tex, textToLatex, toLatex } from '../serializer.ts'
import { readKnote, readNoteOnly, safeAssetPath, writeKnote } from '../knote.ts'
import { docToNote, inlineNodes, inlineText, noteToDoc } from '../convert.ts'
import { filterTree, labelOf, matches, noteInfo, safeName } from '../library.ts'
import { Chunker, isHallucination, resample, RATE } from '../chunker.ts'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const FIX = here('./fixtures/')
const EXAMPLES = here('../../../../public/examples/khervenote/')
const bytes = (p) => new Uint8Array(readFileSync(p))
const text = (p) => readFileSync(p, 'utf-8')

const index = JSON.parse(text(EXAMPLES + 'index.json')).items
const stem = (f) => f.replace(/\.knote$/, '')

/** The note.json inside a desktop-written .knote, as parsed JSON. */
const rawJson = (b) => JSON.parse(strFromU8(unzipSync(b, { filter: (f) => f.name === 'note.json' })['note.json']))

test('there are the eight desktop examples', () => {
  assert.equal(index.length, 8)
  for (const it of index) assert.ok(readdirSync(EXAMPLES).includes(it.file), it.file)
})

test('desktop notes load and save back to the same note.json', () => {
  for (const file of [...index.map((i) => EXAMPLES + i.file), FIX + 'features.knote']) {
    const b = bytes(file)
    const { note, assets } = readKnote(b)
    assert.deepEqual(toDict(note), rawJson(b), file)
    // Written again by KherveOS and read again: the same note, the same files.
    const again = writeKnote(note, assets)
    assert.deepEqual(rawJson(again), rawJson(b), file)
    const back = readKnote(again)
    assert.deepEqual([...back.assets.keys()].sort(), [...assets.keys()].sort())
    for (const [k, v] of assets) assert.deepEqual(back.assets.get(k), v)
  }
})

test('note.json is written as the desktop writes it', () => {
  // Speech times are floats on the desktop (Segment.t = float(...)): "t": 5.0.
  const b = bytes(FIX + 'features.knote')
  const original = strFromU8(unzipSync(b)['note.json'])
  const ours = noteJson(readKnote(b).note)
  // Python writes 12.5 / 60.0 alike, JavaScript cannot tell 60 from 60.0
  // outside the transcript: compare with whole-number floats folded to ints.
  const fold = (s) => s.replace(/("(?:t|t0|duration)": )(\d+)\.0\b/g, '$1$2')
  assert.equal(fold(ours), fold(original))
  assert.match(ours, /"t": 5\.0,\n {3}"text": "Good afternoon/)
  assert.equal(features().meta.layout, 'paged')
})

function features() {
  return readKnote(bytes(FIX + 'features.knote')).note
}

test('features note: every field survives', () => {
  const n = features()
  assert.equal(n.meta.vocabulary, 'XPS, ToF-SIMS, LLZO')
  assert.equal(n.recordings[0].path, 'assets/rec-0001.ogg')
  assert.deepEqual(n.attachments, [{ path: 'assets/att-0001/Slides.pdf', name: 'Slides.pdf' }])
  const marks = n.sections[1].blocks[0].marks
  assert.deepEqual(marks[0], [0, 4, 'b'])
  assert.equal(n.sections[3].title, '')
})

test('unsafe zip entries are refused', () => {
  assert.equal(safeAssetPath('../../etc/passwd'), null)
  assert.equal(safeAssetPath('/abs'), null)
  assert.equal(safeAssetPath('assets/a/../../x'), null)
  assert.equal(safeAssetPath('assets/x.png'), 'assets/x.png')
  assert.equal(safeAssetPath('./assets\\y.png'), 'assets/y.png')
})

test('a newer format is refused', () => {
  assert.throws(() => fromDict({ format: 2 }), /newer KherveNote/)
  assert.throws(() => fromDict({ sections: [{ blocks: [{ kind: 'nope' }] }] }), /unknown block kind/)
})

test('LaTeX matches the desktop for every example, both layouts', () => {
  for (const it of index) {
    const { note } = readKnote(bytes(EXAMPLES + it.file))
    assert.equal(toLatex(note), text(FIX + stem(it.file) + '.continuous.tex'), it.file)
    assert.equal(toLatex(note, { layout: 'paged', showTimes: true, transcript: true }), text(FIX + stem(it.file) + '.paged.tex'), it.file)
    assert.equal(plainText(note), text(FIX + stem(it.file) + '.txt'), it.file)
  }
})

test('LaTeX matches the desktop for the features note', () => {
  const n = features()
  assert.equal(toLatex(n, { layout: 'continuous' }), text(FIX + 'features.continuous.tex'))
  assert.equal(toLatex(n, { showTimes: true, transcript: true }), text(FIX + 'features.paged.tex'))
  assert.equal(plainText(n), text(FIX + 'features.txt'))
})

test('tex / escape / text_to_latex / rich_to_latex cases', () => {
  const cases = JSON.parse(text(FIX + 'latex_cases.json'))
  for (const [input, want] of cases.tex) assert.equal(tex(input), want, input)
  for (const [input, want] of cases.escape) assert.equal(escape(input), want, input)
  for (const [input, want] of cases.text_to_latex) assert.equal(textToLatex(input), want, input)
  for (const [input, marks, want] of cases.rich_to_latex) assert.equal(richToLatex(input, marks), want, input)
})

test('a missing picture becomes a placeholder', () => {
  const n = features()
  assert.match(toLatex(n, { hasAsset: () => false }), /\[missing image: assets\/abc123\.png\]/)
  assert.match(toLatex(n, { hasAsset: () => true }), /\\includegraphics\[[^\]]*\]\{assets\/abc123\.png\}/)
})

test('the continuous height cap can be overridden', () => {
  assert.match(toLatex(features(), { layout: 'continuous', limitPt: 100 }), /\\knote@limit=100\.00pt/)
})

test('markdown_blocks matches the desktop', () => {
  for (const c of JSON.parse(text(FIX + 'markdown.json'))) {
    const got = markdownBlocks(c.text).map((b) => {
      const d = toDict(makeNote({ sections: [makeSection({ blocks: [b] })] })).sections[0].blocks[0]
      delete d.id
      return d
    })
    assert.deepEqual(got, c.blocks, c.text)
  }
})

test('maths spans as the serializer reads them', () => {
  assert.deepEqual(mathSpans('costs $5 and $10'), [])
  assert.deepEqual(mathSpans('a $x$ b'), [{ from: 2, to: 5, latex: 'x', display: false }])
  assert.deepEqual(mathSpans('$$ y $$'), [{ from: 0, to: 7, latex: 'y', display: true }])
  assert.equal(mathSpans('\\(a\\) \\[b\\]').length, 2)
})

test('times show as the time of day, or since the start', () => {
  const n = makeNote()
  n.meta.started = '2026-10-05T09:00:00'
  assert.equal(timeLabel(n, 145), '09:02:25')
  assert.equal(timeLabel(n, 145.9, true, false), '09:02')
  assert.equal(timeLabel(n, 3725, false), '1:02:05')
  n.meta.started = ''
  assert.equal(timeLabel(n, 65), '01:05')
  assert.equal(timeLabel(n, null), '')
})

test('a new note starts now', () => {
  const n = newNote(new Date(2026, 9, 7, 14, 5, 9))
  assert.equal(n.meta.started, '2026-10-07T14:05:09')
  assert.equal(n.meta.date, '07 October 2026')
  assert.equal(n.meta.id.length, 32)
  assert.equal(n.sections.length, 1)
})

test('the speech of a section starts the lead time before its heading', () => {
  const n = features()
  assert.deepEqual(sectionSpeechRange(n, 0, 120), { start: null, end: -60 })
  assert.deepEqual(sectionSpeechRange(n, 1, 30), { start: 30, end: 90 })
  assert.deepEqual(sectionSpeechRange(n, 3, 0), { start: 300, end: null })
  assert.equal(speechBetween(n, 60, 70).length, 1)
})

// --------------------------------------------------------------- the page

test('page round trip: note → page → note keeps every block', () => {
  for (const file of [...index.map((i) => EXAMPLES + i.file), FIX + 'features.knote']) {
    const { note } = readKnote(bytes(file))
    const back = docToNote(noteToDoc(note), note)
    // Marks compare by what each character carries (the page merges runs).
    const styles = (b) => Array.from(b.text, (_, i) => (b.marks ?? []).filter((m) => m[0] <= i && i < m[0] + m[1]).map((m) => m[2]).sort().join(''))
    const strip = (n) => toDict(n).sections.map((s) => ({ ...s, id: undefined, blocks: s.blocks.map((b) => ({ ...b, id: undefined, marks: styles(b) })) }))
    assert.deepEqual(strip(back), strip(note), file)
    assert.equal(toLatex(back), toLatex(note), file)
  }
})

test('inline marks and line breaks', () => {
  const nodes = inlineNodes('Bold and\nitalic', [[0, 4, 'b'], [9, 6, 'i']])
  assert.deepEqual(nodes.map((n) => n.type), ['text', 'text', 'hardBreak', 'text'])
  assert.deepEqual(nodes[0].marks, [{ type: 'bold' }])
  assert.deepEqual(inlineText(nodes), { text: 'Bold and\nitalic', marks: [[0, 4, 'b'], [9, 6, 'i']] })
  // Overlapping styles come back as one run per style.
  const over = inlineText(inlineNodes('overlap here', [[0, 7, 'b'], [3, 9, 'u']]))
  assert.deepEqual(over.marks, [[0, 7, 'b'], [3, 9, 'u']])
})

test('empty paragraphs are dropped; a page starting with a section has no lead-in', () => {
  const base = makeNote()
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, t: 3 }, content: [{ type: 'text', text: '  Intro ' }] },
      { type: 'paragraph', attrs: { kind: 'typed', t: null } },
      { type: 'paragraph', attrs: { kind: 'important', t: 4 }, content: [{ type: 'text', text: 'Key' }] },
      { type: 'knItem', attrs: { level: 1, numbered: true, t: 5 }, content: [{ type: 'text', text: '  item  ', marks: [{ type: 'bold' }] }] },
    ],
  }
  const n = docToNote(doc, base)
  assert.equal(n.sections.length, 1)
  assert.equal(n.sections[0].title, 'Intro')
  assert.deepEqual(n.sections[0].blocks.map((b) => b.kind), ['important', 'item'])
  assert.deepEqual(n.sections[0].blocks[1].marks, [[0, 4, 'b']])
  assert.equal(n.sections[0].blocks[1].text, 'item')
})

// ---------------------------------------------------------------- library

test('library: labels, search and safe names', () => {
  const { note } = readKnote(bytes(EXAMPLES + index[0].file))
  const info = noteInfo('/home/user/Documents/KherveNote/Examples/x.knote', note, 0)
  assert.equal(labelOf(info), note.meta.title)
  assert.ok(matches(info, 'eigenvalues MARTIN'))
  assert.ok(!matches(info, 'eigenvalues zebra'))
  const untitled = noteInfo('/a/Note 1.knote', makeNote({ sections: [makeSection({ blocks: [makeBlock({ text: 'one two three four five six seven eight nine' })] })] }), 0)
  assert.equal(labelOf(untitled), 'one two three four five six seven eight…')
  const tree = { path: '/r', name: 'r', notes: [], folders: [{ path: '/r/Examples', name: 'Examples', folders: [], notes: [info, untitled] }] }
  assert.equal(filterTree(tree, 'examples').folders[0].notes.length, 2)
  assert.equal(filterTree(tree, 'eigen').folders[0].notes.length, 1)
  assert.equal(filterTree(tree, 'nothing-here'), null)
  assert.equal(safeName('a/b:c*?.'), 'a b c ') // as the desktop's safe_name
  assert.equal(safeName(' Lecture: 3/4 '), 'Lecture 3 4')
  assert.equal(safeName('  ..  '), 'Untitled')
  assert.equal(safeName('x'.repeat(100)).length, 80)
})

test('only note.json is read for the list', () => {
  const n = readNoteOnly(bytes(FIX + 'features.knote'))
  assert.equal(n.meta.title, 'Features & tests: 100% of $x$')
})

// ------------------------------------------------------------------ audio

function tone(seconds, amp = 0.2, freq = 220) {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
  return out
}
const silence = (s) => new Float32Array(Math.round(s * RATE))
const concat = (...xs) => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of xs) (out.set(x, o), (o += x.length))
  return out
}

test('the chunker cuts speech at pauses and drops silence', () => {
  const c = new Chunker()
  const audio = concat(silence(1), tone(2), silence(1), tone(3), silence(1))
  const chunks = []
  for (let i = 0; i < audio.length; i += 1600) chunks.push(...c.feed(audio.subarray(i, i + 1600)))
  chunks.push(...c.flush())
  assert.equal(chunks.length, 2)
  // Each chunk starts a little (7 frames) before the sound.
  assert.ok(Math.abs(chunks[0].start / RATE - (1 - 0.21)) < 0.05, String(chunks[0].start / RATE))
  assert.ok(Math.abs(chunks[1].start / RATE - (4 - 0.21)) < 0.05, String(chunks[1].start / RATE))
  const quiet = new Chunker()
  assert.equal(quiet.feed(silence(5)).length + quiet.flush().length, 0)
})

test('long speech without a pause is cut at 10 s', () => {
  const c = new Chunker()
  const audio = tone(25)
  const chunks = []
  for (let i = 0; i < audio.length; i += 1600) chunks.push(...c.feed(audio.subarray(i, i + 1600)))
  assert.ok(chunks.length >= 2)
  for (const ch of chunks) assert.ok(ch.audio.length <= 10 * RATE + 1)
})

test('resampling to 16 kHz and Whisper\'s noise phrases', () => {
  const x = new Float32Array(48000).fill(0.5)
  const y = resample(x, 48000)
  assert.equal(y.length, 16000)
  assert.ok(Math.abs(y[100] - 0.5) < 1e-6)
  assert.ok(isHallucination(' Thank you. '))
  assert.ok(!isHallucination('Thank you for coming to the lecture.'))
})
