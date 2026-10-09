// kELN: hashes, formulas, the reaction table, Code-128, the notebook operations, the audit chain and Verify, every
// example notebook, templates, search, exports. No browser. Run:
//   node --test tools/tests/keln.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { base64ToBytes, canonical, hashOf, sha256, sha256Bytes, sha256File } from '../../src/apps/keln/hash.ts'
import { FormulaError, hillFormula, massPercent, molarMass, parseFormula, prettyFormula } from '../../src/apps/keln/formula.ts'
import { cellNumber, columnStats, computeReaction, fmt, meanSd, newReagent, reagentMmol, type ReactionData } from '../../src/apps/keln/reaction.ts'
import { PATTERNS, STOP, checkDigit, code128Svg, decodeValues, encodeValues, modules, valuesFromModules } from '../../src/apps/keln/code128.ts'
import { block, bold, doc, docBlocks, docInstruments, docMentions, docText, docToHtml, docToMarkdown, h, markdownToDoc, mention, p, tasks, titleOfMarkdown, ul, type PMNode } from '../../src/apps/keln/doc.ts'
import { blockToHtml, newBlock, plainCtx, type Block } from '../../src/apps/keln/blocks.ts'
import { niceTicks, plotSvg } from '../../src/apps/keln/plot.ts'
import { entryHash, fixedCtx, LockedError, KelnError, parseKeln, serializeKeln, linkedSamples, type Notebook } from '../../src/apps/keln/model.ts'
import {
  addEntry, addProject, addSample, amendEntry, createNotebook, deleteEntry, duplicateEntry, experimentsOf, hasUnloggedEdit, logExport, nextSampleId, recordEdit, removeSample, signEntry, tagCounts, updateEntry,
  updateSample, witnessEntry,
} from '../../src/apps/keln/notebook.ts'
import { reportSummary, verifyNotebook } from '../../src/apps/keln/audit.ts'
import { ancestors, descendants, labelSheetHtml, lineageForest, lineageText, reagentFromInventory } from '../../src/apps/keln/samples.ts'
import { TEMPLATES, instantiateTemplate, getTemplate, templateGroups } from '../../src/apps/keln/templates.ts'
import { entriesByDay, monthGrid, timeline, latestMonth } from '../../src/apps/keln/calendar.ts'
import { parseQuery, searchEntries } from '../../src/apps/keln/search.ts'
import { entryBodyHtml, entryToDocument, entryToJson, entryToMarkdown, notebookToDocument, notebookToMarkdown, renderCtx } from '../../src/apps/keln/render.ts'
import { exampleNotebooks, tamperedCopy } from '../../src/apps/keln/exampleData.ts'
import { kelnExampleFiles } from '../../src/apps/keln/exampleFiles.ts'
import { importFile, knoteToMarkdown } from '../../src/apps/keln/importers.ts'
import { zipSync, strToU8 } from 'fflate'
import { getSchema, Node as TipNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Highlight } from '@tiptap/extension-highlight'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import Image from '@tiptap/extension-image'
import { createTracker, contentKey, withoutTrailingEmpty } from '../../src/apps/keln/editTracker.ts'
import { addInstrument } from '../../src/apps/keln/notebook.ts'
import { kelnTools, type Hooks } from '../../src/apps/keln/aiTools.ts'
import { KELN_TOOL_SET } from '../../src/os/ai/manifests/keln.ts'
import { kelnExampleOutputs } from '../export_keln_examples.ts'

const near = (a: number, b: number, abs: number) => assert.ok(Math.abs(a - b) <= abs, `${a} ≈ ${b} (±${abs})`)

/** A mini XML check: tags nest properly, only the five XML entities are used. */
function assertWellFormed(xml: string, what: string) {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/i, '')
  const stack: string[] = []
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  let last = 0
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const between = body.slice(last, m.index)
    assert.ok(!/[<>]/.test(between), `${what}: stray angle bracket near “${between.slice(0, 40)}”`)
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(between), `${what}: bad entity in “${between.slice(0, 60)}”`)
    last = m.index + m[0].length
    if (m[4]) continue
    if (m[1]) assert.equal(stack.pop(), m[2], `${what}: </${m[2]}> closes the wrong element`)
    else stack.push(m[2])
  }
  assert.ok(!/[<>]/.test(body.slice(last)), `${what}: stray bracket at the end`)
  assert.deepEqual(stack, [], `${what}: unclosed elements`)
}

// ------------------------------------------------------------------------------ hashes

test('SHA-256 matches known vectors and node:crypto', async () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255)
    assert.equal(sha256Bytes(bytes), createHash('sha256').update(bytes).digest('hex'), `length ${n}`)
  }
  assert.equal(sha256('héllo ✓'), createHash('sha256').update('héllo ✓', 'utf8').digest('hex'))
  const big = new Uint8Array(300_000).map((_, i) => (i * 7) & 255)
  assert.equal(await sha256File(big), createHash('sha256').update(big).digest('hex'))
})

test('canonical JSON is order independent', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}')
  assert.equal(hashOf({ x: 1, y: 2 }), hashOf({ y: 2, x: 1 }))
  assert.notEqual(hashOf({ x: 1 }), hashOf({ x: 2 }))
})

// ------------------------------------------------------------------------------ formulas

test('formula parser and molar masses', () => {
  near(molarMass('C7H6O3')!, 138.12, 0.01)
  near(molarMass('C9H8O4')!, 180.16, 0.01)
  near(molarMass('Ca(OH)2')!, 74.09, 0.01)
  near(molarMass('CuSO4·5H2O')!, 249.69, 0.02)
  near(molarMass('CuSO4.5H2O')!, 249.69, 0.02)
  near(molarMass('Fe2(SO4)3')!, 399.86, 0.02)
  near(molarMass('K4[Fe(CN)6]')!, 368.35, 0.02)
  near(molarMass('H₂O')!, 18.015, 0.001)
  near(molarMass('NaCl(aq)')!, 58.44, 0.01)
  near(molarMass('Co')!, 58.933, 0.001)
  assert.deepEqual(parseFormula('C2H5OH'), { C: 2, H: 6, O: 1 })
  assert.equal(hillFormula(parseFormula('C9H8O4')), 'C9H8O4')
  assert.equal(hillFormula(parseFormula('OHC2H5')), 'C2H6O')
  assert.equal(prettyFormula('C9H8O4'), 'C₉H₈O₄')
  assert.equal(molarMass('Xx2'), null)
  assert.equal(molarMass('C6H12O6)'), null)
  assert.equal(molarMass('(CH3'), null)
  assert.throws(() => parseFormula(''), FormulaError)
  near(massPercent('H2O')!.O, 88.81, 0.02)
})

// ------------------------------------------------------------------------------ reaction table

function aspirinData(actual: number | null = 2.12): ReactionData {
  return {
    title: 'Aspirin', smiles: '', notes: '',
    reagents: [
      newReagent('reactant', { name: 'Salicylic acid', formula: 'C7H6O3', mass: 2.0 }),
      newReagent('reactant', { name: 'Acetic anhydride', formula: 'C4H6O3', volume: 5.0, density: 1.082 }),
      newReagent('catalyst', { name: 'H2SO4', formula: 'H2SO4', volume: 0.1, density: 1.84 }),
      newReagent('product', { name: 'Aspirin', formula: 'C9H8O4', actual }),
      newReagent('product', { name: 'Acetic acid', formula: 'C2H4O2' }),
    ],
  }
}

test('reaction table: mmol, equivalents, limiting reagent, theoretical and % yield (aspirin)', () => {
  const r = computeReaction(aspirinData())
  assert.equal(r.limitingIndex, 0, 'salicylic acid is limiting')
  near(r.rows[0].mmol!, 14.48, 0.01)
  near(r.rows[1].mmol!, 53.0, 0.1) // 5.0 mL × 1.082 / 102.09
  near(r.rows[1].equiv!, 3.66, 0.02)
  near(r.rows[0].equiv!, 1, 1e-9)
  near(r.rows[2].equiv!, 0.13, 0.01)
  near(r.rows[3].theoretical!, 2.61, 0.005) // 2.00 g salicylic acid → 2.61 g aspirin
  near(r.rows[3].theoreticalMmol!, 14.48, 0.01)
  near(r.rows[3].yieldPct!, 81.3, 0.1)
  near(r.rows[4].theoretical!, 0.87, 0.01) // acetic acid
  assert.equal(r.rows[4].yieldPct, null, 'no actual mass, no yield')
  assert.equal(computeReaction(aspirinData(null)).rows[3].yieldPct, null)
})

test('reaction table: forced limiting reagent, coefficients, purity, mmol input, problems', () => {
  const d = aspirinData()
  d.reagents[1].limiting = true
  const forced = computeReaction(d)
  assert.equal(forced.limitingIndex, 1)
  near(forced.rows[0].equiv!, 14.48 / 53.0, 0.005)
  // 2 A + B → C: coefficients decide the limiting reagent
  const two: ReactionData = { title: '', smiles: '', notes: '', reagents: [
    newReagent('reactant', { name: 'A', formula: 'H2', mmol: 10, coef: 2 }), newReagent('reactant', { name: 'B', formula: 'O2', mmol: 4 }), newReagent('product', { name: 'C', formula: 'H2O', coef: 2, actual: 0.1 }),
  ] }
  const t = computeReaction(two)
  assert.equal(t.limitingIndex, 1, 'A gives 5 units, B gives 4')
  near(t.rows[2].theoreticalMmol!, 8, 1e-9)
  near(t.rows[2].theoretical!, (8 * 18.015) / 1000, 1e-4)
  // purity
  near(reagentMmol(newReagent('reactant', { formula: 'NaCl', mass: 1, purity: 50 }))!, 8.555, 0.01)
  assert.equal(reagentMmol(newReagent('reactant', { formula: 'NaCl' })), null)
  const bad = computeReaction({ title: '', smiles: '', notes: '', reagents: [newReagent('reactant', { name: 'x', formula: 'Qq9', mass: 1 }), newReagent('reactant', { volume: 2, formula: 'H2O' })] })
  assert.match(bad.rows[0].problem ?? '', /formula/i)
  assert.match(bad.rows[1].problem ?? '', /density/i)
  assert.equal(bad.limitingIndex, null)
  assert.equal(fmt(14.4799), '14.5')
  assert.equal(fmt(0.0005), '5e-4')
})

test('measurement statistics: mean ± sd', () => {
  const rows = [['24.92'], ['25.55'], ['24.51'], ['x'], ['']]
  const s = columnStats(rows, 0)
  assert.equal(s.n, 3)
  near(s.mean!, 24.9933, 1e-3)
  near(s.sd!, 0.5239, 1e-3) // sample standard deviation (n − 1)
  assert.match(meanSd(s), /^24\.99 ± 0\.52$/)
  assert.equal(meanSd(columnStats([['5']], 0)), '5')
  assert.equal(meanSd(columnStats([], 0)), '')
  assert.equal(cellNumber('1,5'), 1.5)
  assert.equal(cellNumber('1.2e-3'), 0.0012)
  assert.equal(cellNumber('<0.1'), null)
})

// ------------------------------------------------------------------------------ Code 128

test('Code 128: check digits, patterns, round trips', () => {
  for (const [i, pat] of PATTERNS.entries()) {
    const total = [...pat].reduce((a, c) => a + Number(c), 0)
    assert.equal(total, i === STOP ? 13 : 11, `symbol ${i} has ${i === STOP ? 13 : 11} modules`)
    assert.equal(pat.length, i === STOP ? 7 : 6)
  }
  assert.equal(new Set(PATTERNS).size, 107, 'every pattern is different')
  // Wikipedia's example: PJJ123C in code set A has check symbol 54
  const a = encodeValues('PJJ123C', 'A')
  assert.deepEqual(a, [103, 48, 42, 42, 17, 18, 19, 35, 54, 106])
  assert.equal(checkDigit(a.slice(0, -2)), 54)
  // set C: 105 + 12·1 + 34·2 = 185 = 82 (mod 103)
  assert.deepEqual(encodeValues('1234', 'C'), [105, 12, 34, 82, 106])
  // set B: "Hello" start 104; H=40 e=69 l=76 l=76 o=79 → 104 + 40 + 138 + 228 + 304 + 395 = 1209 mod 103 = 76
  assert.deepEqual(encodeValues('Hello', 'B'), [104, 40, 69, 76, 76, 79, 76, 106])
  for (const text of ['XPS-0001', 'S-0001', 'TF-0003', 'ASP-2026-001', 'a1234b', '123456', '12345', 'hello world', 'Tab\there']) {
    const values = encodeValues(text)
    assert.equal(decodeValues(values), text, `round trip ${text}`)
    const widths = modules(text)
    assert.deepEqual(valuesFromModules(widths), values, `modules round trip ${text}`)
    assert.equal(widths.reduce((x, y) => x + y, 0), (values.length - 1) * 11 + 13)
  }
  assert.equal(decodeValues([...encodeValues('abc').slice(0, -2), 5, 106]), null, 'wrong check digit')
  assert.throws(() => encodeValues('é'), /ASCII/)
  assert.throws(() => encodeValues(''), /Nothing/)
  assert.ok(encodeValues('1234567890').includes(105) || encodeValues('1234567890')[0] === 105, 'long digit runs use set C')
  const svg = code128Svg('XPS-0001')
  assertWellFormed(svg, 'barcode svg')
  assert.match(svg, /^<svg[^>]*width="[\d.]+"/)
  assert.ok((svg.match(/h[\d.]+v40/g) ?? []).length >= 30, 'bars are drawn')
})

// ------------------------------------------------------------------------------ documents

test('document text, blocks, mentions, markdown in and out', () => {
  const d = doc(
    h(1, 'Title'), p('A ', bold('bold'), ' and a mention ', mention('S-0001'), '.'), ul(['one'], ['two']), tasks(['do it', true]),
    block(newBlock('reaction')), block({ kind: 'instrument', data: { ...(newBlock('instrument') as Extract<Block, { kind: 'instrument' }>).data, instrument: 'XPS' } }),
  )
  assert.deepEqual(docMentions(d), ['S-0001'])
  assert.equal(docBlocks(d).length, 2)
  assert.deepEqual(docInstruments(d), ['XPS'])
  assert.match(docText(d), /Title\nA bold and a mention @S-0001\./)
  const md = docToMarkdown(d)
  assert.match(md, /^# Title/)
  assert.match(md, /\*\*bold\*\*/)
  assert.match(md, /- \[x\] do it/)
  const back = markdownToDoc('# Heading\n\nSome *emphasis*, **strong**, `code` and $E=mc^2$.\n\n- [x] done\n- [ ] todo\n\n1. first\n2. second\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nprint(1)\n```\n\n$$\nx^2\n$$\n')
  const types = (back.content ?? []).map((n) => n.type)
  assert.deepEqual(types, ['heading', 'paragraph', 'taskList', 'orderedList', 'table', 'codeBlock', 'mathBlock'])
  assert.match(docText(back), /E=mc\^2/)
  assert.equal(back.content![1].content!.find((n) => n.type === 'mathInline')!.attrs!.latex, 'E=mc^2')
  assert.equal(titleOfMarkdown('intro\n## The Title ##\ntext'), 'The Title')
  assert.equal(titleOfMarkdown('just a line'), 'just a line')
  // the html is safe: unsafe link schemes are dropped, text is escaped
  const html = docToHtml(doc({ type: 'paragraph', content: [{ type: 'text', text: '<script>x</script>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }))
  assert.equal(html, '<p>&lt;script&gt;x&lt;/script&gt;</p>')
})

test('plot svg', () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10])
  const svg = plotSvg({ title: 'T & Co', xLabel: 'x', yLabel: 'y', kind: 'line', series: ['a', 'b'], rows: [['0', '1', '2'], ['1', '3', '1'], ['2', '2', '']] }, { width: 400, height: 250, scheme: 'print' })
  assertWellFormed(svg, 'plot')
  assert.match(svg, /T &amp; Co/)
  assert.match(plotSvg({ title: '', xLabel: '', yLabel: '', kind: 'bar', series: ['a'], rows: [['x', '1'], ['y', '2']] }, { width: 400, height: 250, scheme: 'app' }), /<rect x=/)
  assert.match(plotSvg({ title: '', xLabel: '', yLabel: '', kind: 'line', series: ['a'], rows: [['', '']] }, { width: 400, height: 250, scheme: 'print' }), /No numbers/)
})

// ------------------------------------------------------------------------------ notebook operations

const fresh = (): { nb: Notebook; ctx: ReturnType<typeof fixedCtx>; pid: string } => {
  const ctx = fixedCtx('2026-01-01T08:00:00Z', 'Ana Martin')
  const nb = createNotebook(ctx, { title: 'Test', projects: [{ code: 'asp', name: 'Aspirin' }, { code: 'XPS', name: 'XPS' }] })
  return { nb, ctx, pid: nb.projects[0].id }
}

test('entries: numbers PROJ-YYYY-NNN, drafts edit, signed entries lock', () => {
  let { nb, ctx, pid } = fresh()
  assert.equal(nb.projects[0].code, 'ASP')
  const a = addEntry(nb, { projectId: pid, title: 'One', date: '2026-02-03T09:00:00' }, ctx)
  nb = a.nb
  const b = addEntry(nb, { projectId: pid, title: 'Two', date: '2026-02-04T09:00:00' }, ctx)
  nb = b.nb
  const c = addEntry(nb, { projectId: pid, title: 'Next year', date: '2027-01-04T09:00:00' }, ctx)
  nb = c.nb
  const d = addEntry(nb, { projectId: pid, title: 'Same experiment', date: '2026-02-05T09:00:00', experiment: a.entry.experiment }, ctx)
  nb = d.nb
  assert.deepEqual([a.entry.experiment, b.entry.experiment, c.entry.experiment, d.entry.experiment], ['ASP-2026-001', 'ASP-2026-002', 'ASP-2027-001', 'ASP-2026-001'])
  assert.deepEqual(experimentsOf(nb, pid).map((x) => [x.number, x.entries.length]), [['ASP-2026-001', 2], ['ASP-2026-002', 1], ['ASP-2027-001', 1]])
  assert.throws(() => addEntry(nb, { projectId: 'nope', title: 'x' }, ctx), KelnError)
  assert.throws(() => addProject(nb, { code: 'ASP', name: 'again' }, ctx), /already/)
  nb = updateEntry(nb, a.entry.id, { title: 'One (edited)', tags: ['x', 'y'], content: doc(p('hello')) }, ctx)
  assert.equal(nb.entries[0].title, 'One (edited)')
  assert.deepEqual(tagCounts(nb), [{ tag: 'x', count: 1 }, { tag: 'y', count: 1 }])
  assert.equal(hasUnloggedEdit(nb, a.entry.id), true)
  nb = recordEdit(nb, a.entry.id, ctx)
  assert.equal(hasUnloggedEdit(nb, a.entry.id), false)
  const n = nb.audit.length
  assert.equal(recordEdit(nb, a.entry.id, ctx).audit.length, n, 'unchanged content logs nothing')
  nb = signEntry(nb, a.entry.id, ctx)
  assert.equal(nb.entries[0].status, 'signed')
  assert.throws(() => updateEntry(nb, a.entry.id, { title: 'changed' }, ctx), LockedError)
  assert.throws(() => deleteEntry(nb, a.entry.id, ctx), LockedError)
  nb = updateEntry(nb, a.entry.id, { favourite: true }, ctx)
  assert.equal(nb.entries[0].favourite, true, 'the favourite flag is not part of the record')
  assert.equal(entryHash(nb.entries[0]), nb.entries[0].signature!.hash)
  nb = deleteEntry(nb, b.entry.id, ctx)
  assert.equal(nb.entries.some((e) => e.id === b.entry.id), false)
  assert.equal(nb.audit.at(-1)!.action, 'entry-deleted')
})

test('sign, witness, amend: the signed content never changes', async () => {
  let { nb, ctx, pid } = fresh()
  const e = addEntry(nb, { projectId: pid, title: 'Signed work', date: '2026-02-03T09:00:00', content: doc(p('measured 7.38')), tags: ['t'] }, ctx)
  nb = e.nb
  const id = e.entry.id
  assert.throws(() => witnessEntry(nb, id, 'Ben', ctx), /Sign the entry first/)
  assert.throws(() => amendEntry(nb, id, doc(p('x')), 'why', ctx), /draft/)
  nb = signEntry(nb, id, ctx)
  const signedHash = nb.entries[0].signature!.hash
  const contentBefore = JSON.stringify(nb.entries[0].content)
  assert.throws(() => signEntry(nb, id, ctx), /already signed/)
  assert.throws(() => witnessEntry(nb, id, 'ana martin', ctx), /different person/)
  assert.throws(() => witnessEntry(nb, id, '  ', ctx), /name/)
  nb = witnessEntry(nb, id, 'Ben Okafor', ctx)
  assert.equal(nb.entries[0].status, 'witnessed')
  assert.equal(nb.entries[0].witness!.user, 'Ben Okafor')
  assert.equal(nb.audit.at(-1)!.user, 'Ben Okafor')
  assert.throws(() => witnessEntry(nb, id, 'Cleo', ctx), /already witnessed/)
  assert.throws(() => amendEntry(nb, id, doc(p('x')), ' ', ctx), /why/)
  nb = amendEntry(nb, id, doc(p('Correction: 7.83 was a typo.')), 'typo', ctx)
  const e2 = nb.entries[0]
  assert.equal(e2.addenda.length, 1)
  assert.equal(JSON.stringify(e2.content), contentBefore, 'the signed text is untouched')
  assert.equal(entryHash(e2), signedHash, 'the content hash does not move')
  assert.equal(e2.signature!.hash, signedHash)
  assert.equal(e2.status, 'witnessed')
  assert.equal(nb.audit.at(-1)!.action, 'entry-amended')
  assert.equal(nb.audit.at(-1)!.hash, e2.addenda[0].hash)
  assert.throws(() => updateEntry(nb, id, { content: doc(p('rewrite')) }, ctx), LockedError)
  nb = logExport(nb, id, 'PDF', ctx)
  nb = logExport(nb, null, 'JSON', ctx)
  assert.equal(nb.audit.at(-1)!.action, 'notebook-exported')
  const report = await verifyNotebook(nb)
  assert.equal(report.ok, true, reportSummary(report))
  assert.equal(report.signedEntries, 1)
  assert.deepEqual(nb.audit.map((r) => r.action), ['notebook-created', 'entry-created', 'entry-signed', 'entry-witnessed', 'entry-amended', 'entry-exported', 'notebook-exported'])
})

test('Verify finds a changed record, a removed record and a changed signed entry', async () => {
  let { nb, ctx, pid } = fresh()
  for (const t of ['A', 'B', 'C']) {
    const r = addEntry(nb, { projectId: pid, title: t, date: '2026-02-03T09:00:00', content: doc(p(`text ${t}`)) }, ctx)
    nb = signEntry(r.nb, r.entry.id, ctx)
  }
  assert.equal((await verifyNotebook(nb)).ok, true)
  // 1. a field of one record is changed (without recomputing its hash)
  const k = nb.audit.findIndex((r) => r.action === 'entry-signed' && r.detail.includes('Ana'))
  const altered = { ...nb, audit: nb.audit.map((r, i) => (i === k ? { ...r, user: 'Mallory' } : r)) }
  const r1 = await verifyNotebook(altered)
  assert.equal(r1.ok, false)
  assert.equal(r1.firstBadSeq, k + 1)
  assert.deepEqual(r1.issues.map((i) => i.seq), [k + 1], 'exactly that record')
  assert.match(r1.issues[0].message, /altered/)
  // 2. the record is changed AND its hash recomputed: the next record no longer follows it
  const { recordHash } = await import('../../src/apps/keln/model.ts')
  const fixed = { ...altered, audit: altered.audit.map((r, i) => (i === k ? { ...r, rec: recordHash({ ...r, rec: undefined } as never) } : r)) }
  const r2 = await verifyNotebook(fixed)
  assert.equal(r2.ok, false)
  assert.equal(r2.firstBadSeq, k + 2)
  assert.match(r2.issues[0].message, /does not follow/)
  // 3. a record is removed
  const removed = { ...nb, audit: nb.audit.filter((_, i) => i !== 3) }
  const r3 = await verifyNotebook(removed)
  assert.equal(r3.ok, false)
  assert.equal(r3.firstBadSeq, 4, 'the first record after the gap')
  // 4. a signed entry's text is changed in the file
  const edited = { ...nb, entries: nb.entries.map((e, i) => (i === 1 ? { ...e, content: doc(p('quietly changed')) } : e)) }
  const r4 = await verifyNotebook(edited)
  assert.equal(r4.ok, false)
  assert.equal(r4.firstBadSeq, null, 'the chain itself is intact')
  assert.equal(r4.issues.length, 1)
  assert.equal(r4.issues[0].entryId, nb.entries[1].id)
  assert.match(r4.issues[0].message, /changed after/)
  assert.match(reportSummary(r4), /problem/)
  // 5. an embedded attachment that does not match its hash
  const att = { id: 'a1', name: 'x.txt', size: 3, sha256: sha256('abc'), mime: 'text/plain', added: '', addedBy: '', path: '', data: 'YWJj' }
  assert.deepEqual(base64ToBytes('YWJj'), new TextEncoder().encode('abc'))
  const withAtt = (data: string): Notebook => {
    const f = fresh()
    const r = addEntry(f.nb, { projectId: f.pid, title: 'With file', attachments: [{ ...att, data }] }, f.ctx)
    return r.nb
  }
  assert.equal((await verifyNotebook(withAtt('YWJj'))).ok, true)
  const bad = await verifyNotebook(withAtt('YWJk'))
  assert.equal(bad.ok, false)
  assert.match(bad.issues[0].message, /does not match the hash/)
})

test('duplicate as template, samples, lineage and removal rules', () => {
  let { nb, ctx, pid } = fresh()
  const e = addEntry(nb, { projectId: pid, title: 'Original', date: '2026-02-03T09:00:00', content: doc(p('x'), block(newBlock('timeline'))) }, ctx)
  nb = signEntry(e.nb, e.entry.id, ctx)
  const dup = duplicateEntry(nb, e.entry.id, ctx)
  assert.equal(dup.entry.status, 'draft')
  assert.equal(dup.entry.signature, null)
  assert.equal(dup.entry.title, 'Original (copy)')
  assert.notEqual(dup.entry.experiment, e.entry.experiment)
  assert.deepEqual(dup.entry.content, nb.entries[0].content)
  nb = dup.nb
  const s1 = addSample(nb, { name: 'Wafer', made: '2026-01-01' }, ctx)
  assert.equal(s1.sample.id, 'S-0001')
  nb = s1.nb
  const s2 = addSample(nb, { name: 'Film', made: '2026-01-02', parents: [s1.sample.id] }, ctx)
  nb = s2.nb
  const s3 = addSample(nb, { name: 'Annealed', made: '2026-01-03', parents: [s2.sample.id] }, ctx)
  nb = s3.nb
  const s4 = addSample(nb, { name: 'Other film', made: '2026-01-03', parents: [s1.sample.id] }, ctx)
  nb = s4.nb
  assert.equal(nextSampleId(nb), 'S-0005')
  assert.equal(nextSampleId(nb, 'XPS', 3), 'XPS-001')
  assert.throws(() => addSample(nb, { id: 'S-0001', name: 'dup', made: '' }, ctx), /already/)
  assert.deepEqual(ancestors(nb.samples, 'S-0003').map((s) => s.id), ['S-0002', 'S-0001'])
  assert.deepEqual(descendants(nb.samples, 'S-0001').map((s) => s.id).sort(), ['S-0002', 'S-0003', 'S-0004'])
  const forest = lineageForest(nb.samples)
  assert.equal(forest.length, 1)
  assert.deepEqual(forest[0].children.map((c) => c.sample.id), ['S-0002', 'S-0004'])
  assert.deepEqual(forest[0].children[0].children.map((c) => c.sample.id), ['S-0003'])
  assert.match(lineageText(nb.samples, 'S-0003'), /S-0001 {2}Wafer\n {2}└ S-0002 {2}Film\n {4}└ S-0003 {2}Annealed {3}← this sample/)
  assert.throws(() => updateSample(nb, 'S-0001', { parents: ['S-0003'] }), /cannot be its parent/)
  assert.throws(() => updateSample(nb, 'S-0001', { parents: ['S-0001'] }), /own parent/)
  nb = updateSample(nb, 'S-0004', { status: 'consumed' })
  assert.equal(nb.samples[3].status, 'consumed')
  // a sample used in an entry cannot be removed, an unused one can
  nb = updateEntry(nb, dup.entry.id, { content: doc(p('uses ', mention('S-0002'))) }, ctx)
  assert.deepEqual(linkedSamples(nb.entries.find((x) => x.id === dup.entry.id)!), ['S-0002'])
  assert.throws(() => removeSample(nb, 'S-0002'), /used in 1 entry/)
  assert.equal(removeSample(nb, 'S-0003').samples.length, 3)
  // inventory → reaction table
  const r = reagentFromInventory({ id: 'i', name: 'Ethanol', formula: 'C2H6O', cas: '64-17-5', mw: null, density: 0.789, supplier: '', lot: '', amount: '', hazard: '', location: '' })
  assert.equal(r.name, 'Ethanol')
  near(r.mw!, 46.07, 0.01)
  assert.equal(r.density, 0.789)
})

test('labels: barcode sheet is well-formed and carries each ID', () => {
  const { nb, ctx } = fresh()
  let n2 = nb
  for (const name of ['One', 'Two & three', 'Four']) n2 = addSample(n2, { name, made: '2026-01-01', location: 'Shelf <A>', batch: 'B1' }, ctx).nb
  const html = labelSheetHtml(n2.samples, n2)
  assertWellFormed(html, 'label sheet')
  for (const s of n2.samples) assert.ok(html.includes(s.id))
  assert.match(html, /Two &amp; three/)
  assert.match(html, /Shelf &lt;A&gt;/)
  assert.equal((html.match(/<img /g) ?? []).length, 3)
})

// ------------------------------------------------------------------------------ the file

test('.keln round trip and errors', () => {
  for (const ex of exampleNotebooks()) {
    const text = serializeKeln(ex.notebook)
    const back = parseKeln(text)
    assert.deepEqual(back, ex.notebook, ex.title)
    assert.equal(serializeKeln(back), text, `${ex.title} serialises identically`)
  }
  assert.throws(() => parseKeln('not json'), /not valid JSON/)
  assert.throws(() => parseKeln('{"format":"kbook"}'), /not a kELN notebook/)
  assert.throws(() => parseKeln('{"format":"keln","version":9}'), /newer kELN/)
  const minimal = parseKeln('{"format":"keln","version":1,"title":"Mini"}')
  assert.equal(minimal.title, 'Mini')
  assert.deepEqual(minimal.entries, [])
  assert.equal(minimal.settings.samplePrefix, 'S')
  const ex = exampleNotebooks()[0].notebook
  assert.equal(JSON.parse(serializeKeln(ex)).format, 'keln')
})

// ------------------------------------------------------------------------------ the examples

test('example notebooks: 13 of them, each verified, with several entries', async () => {
  const all = exampleNotebooks()
  assert.ok(all.length >= 12)
  const titles = all.map((e) => e.title)
  for (const need of [/Aspirin/, /Titration/, /TGA/, /XPS/, /calibration/i, /PCR/, /Thin-film/, /maintenance/i, /meeting/i, /Audit chain demo/, /Tamper demo/]) {
    assert.ok(titles.some((t) => need.test(t)), `an example matches ${need}`)
  }
  for (const ex of all) {
    const nb = ex.notebook
    assert.ok(nb.entries.length >= 2, `${ex.title} has several entries`)
    assert.ok(nb.audit.length >= nb.entries.length + 1, `${ex.title} has an audit log`)
    const report = await verifyNotebook(nb)
    if (/Tamper/.test(ex.title)) continue
    assert.equal(report.ok, true, `${ex.title}: ${reportSummary(report)}`)
    // every record chains to the one before
    nb.audit.forEach((r, i) => assert.equal(r.prev, i ? nb.audit[i - 1].rec : ''))
    // every entry has a project, a number and content with text
    for (const e of nb.entries) {
      assert.ok(nb.projects.some((p) => p.id === e.projectId), `${e.title} has a project`)
      assert.match(e.experiment, /^[A-Z0-9]+-20\d\d-\d{3}$/)
      assert.ok(docText(e.content).length > 10, `${e.title} has text`)
      // mentions and sample links resolve
      for (const s of linkedSamples(e)) assert.ok(nb.samples.some((x) => x.id === s), `${e.experiment} links ${s}`)
      for (const b of docBlocks(e.content)) {
        if (b.kind === 'instrument' && b.data.file) assert.ok(e.attachments.some((a) => a.id === b.data.file), 'instrument file is attached')
      }
    }
  }
})

test('example notebooks are the files on disk (regenerate with node tools/export_keln_examples.ts)', () => {
  const root = new URL('../../', import.meta.url)
  const outputs = kelnExampleOutputs()
  assert.equal(outputs.length, exampleNotebooks().length + 1)
  for (const o of outputs) {
    const url = new URL(o.path, root)
    assert.ok(existsSync(url), `${o.path} exists`)
    assert.equal(readFileSync(url, 'utf8'), o.content, `${o.path} is up to date`)
  }
  const files = kelnExampleFiles()
  assert.deepEqual(files.map((f) => f.file).slice(0, 2), ['01 Aspirin synthesis.keln', '02 Titration lab (NaOH standardisation).keln'])
  assert.ok(files.every((f) => f.group && f.description))
  assert.deepEqual([...new Set(files.map((f) => f.group))], ['Chemistry', 'Measurements', 'Biology', 'Lab management', 'Integrity'])
  // and the examples are identical on every run
  assert.equal(kelnExampleFiles().map((f) => sha256(f.content)).join(), files.map((f) => sha256(f.content)).join())
})

test('aspirin example: reaction table gives 2.61 g theoretical and ~81 % yield', () => {
  const nb = exampleNotebooks()[0].notebook
  const entry = nb.entries[0]
  const rx = docBlocks(entry.content).find((b) => b.kind === 'reaction')!
  assert.equal(rx.kind, 'reaction')
  if (rx.kind !== 'reaction') return
  const r = computeReaction(rx.data)
  assert.equal(rx.data.reagents[0].name, 'Salicylic acid')
  assert.equal(rx.data.reagents[0].mass, 2)
  near(r.rows[3].theoretical!, 2.61, 0.005)
  near(r.rows[3].yieldPct!, 81.3, 0.1)
  assert.ok(entry.attachments.length === 1 && entry.attachments[0].sha256.length === 64, 'spectrum attached with a hash')
  assert.equal(sha256Bytes(base64ToBytes(entry.attachments[0].data!)), entry.attachments[0].sha256)
  assert.ok(nb.inventory.length >= 4)
  assert.ok(entry.links.some((l) => l.kind === 'url'))
})

test('titration example links the kTitration example folder; TGA theory columns come from formulas', () => {
  const t = exampleNotebooks()[1].notebook
  assert.ok(t.entries[0].links.some((l) => l.kind === 'path' && /kTitration Examples/.test(l.target)))
  const tga = exampleNotebooks()[2].notebook
  const steps = docBlocks(tga.entries[0].content).find((b) => b.kind === 'measurements' && b.data.title === 'Mass loss vs theory')
  assert.ok(steps && steps.kind === 'measurements')
  if (steps?.kind === 'measurements') assert.equal(steps.data.rows[0][3], '12.3') // H2O in CaC2O4·H2O
})

test('XPS and thin-film examples have sample lineage', () => {
  const x = exampleNotebooks()[3].notebook
  const forest = lineageForest(x.samples)
  assert.equal(forest.length, 1)
  assert.equal(forest[0].sample.id, 'XPS-0001')
  assert.deepEqual(forest[0].children[0].children.map((c) => c.sample.id), ['XPS-0003', 'XPS-0004'])
  const tf = exampleNotebooks()[6].notebook
  const f2 = lineageForest(tf.samples)
  assert.equal(f2[0].children.length, 3)
  assert.equal(ancestors(tf.samples, 'TF-0005').map((s) => s.id).join(), 'TF-0003,TF-0001'.replace('TF-0003', 'TF-0003'))
})

test('audit demo: signed + witnessed + amended; Tamper demo is flagged at exactly the changed record', async () => {
  const all = exampleNotebooks()
  const demo = all.find((e) => /^Audit chain demo/.test(e.title))!.notebook
  const buffer = demo.entries[0]
  assert.equal(buffer.status, 'witnessed')
  assert.equal(buffer.addenda.length, 1)
  assert.equal(demo.entries[1].status, 'signed')
  assert.equal(demo.entries[2].status, 'draft')
  assert.equal(entryHash(buffer), buffer.signature!.hash, 'amendment did not touch the signed content')
  assert.match(JSON.stringify(buffer.content), /7\.83/, 'the signed text still says 7.83')
  assert.match(docText(buffer.addenda[0].content), /7\.38/)
  assert.ok(demo.audit.some((r) => r.action === 'entry-exported'))
  const ok = await verifyNotebook(demo)
  assert.equal(ok.ok, true, reportSummary(ok))
  assert.equal(ok.signedEntries, 2)
  const tamper = all.find((e) => /^Tamper demo/.test(e.title))!.notebook
  const { seq } = tamperedCopy(demo)
  const bad = await verifyNotebook(tamper)
  assert.equal(bad.ok, false)
  assert.equal(bad.firstBadSeq, seq)
  assert.deepEqual(bad.issues.map((i) => i.seq), [seq])
  assert.match(bad.issues[0].message, new RegExp(`Record ${seq} `))
  assert.equal(tamper.audit[seq - 1].user, 'Mallory')
  assert.equal(demo.audit[seq - 1].user, 'Ana Martin')
})

// ------------------------------------------------------------------------------ templates

test('templates: at least 12, all instantiate into well-formed documents', () => {
  assert.ok(TEMPLATES.length >= 12)
  const ids = new Set(TEMPLATES.map((t) => t.id))
  assert.equal(ids.size, TEMPLATES.length)
  for (const need of ['organic-synthesis', 'titration', 'xps-session', 'tga-session', 'xrd-session', 'calibration-log', 'cell-culture', 'pcr-setup', 'gel-electrophoresis', 'thin-film', 'instrument-maintenance', 'solution-prep', 'literature-note', 'meeting-actions', 'risk-assessment']) {
    assert.ok(ids.has(need), need)
  }
  const { nb, ctx, pid } = fresh()
  let book = nb
  for (const t of TEMPLATES) {
    const inst = instantiateTemplate(t, { subject: 'Test subject' })
    assert.equal(inst.template, t.id)
    assert.match(inst.title, /Test subject/)
    assert.equal(inst.content.type, 'doc')
    const r = addEntry(book, { projectId: pid, title: inst.title, content: inst.content, tags: inst.tags, template: inst.template, links: inst.links, date: '2026-03-03T09:00:00' }, ctx)
    book = r.nb
    const html = entryBodyHtml(book, r.entry)
    assertWellFormed(html, t.id)
    assert.ok(html.length > 200)
    // independent copies
    assert.notEqual(instantiateTemplate(t).content, instantiateTemplate(t).content)
  }
  assert.equal(getTemplate('titration')!.links![0].target, '/home/user/Documents/kTitration Examples')
  assert.ok(docBlocks(getTemplate('organic-synthesis')!.content()).some((b) => b.kind === 'reaction'))
  assert.ok(docBlocks(getTemplate('risk-assessment')!.content()).some((b) => b.kind === 'safety'))
  assert.ok(templateGroups().length >= 4)
})

// ------------------------------------------------------------------------------ blocks as HTML

test('every block kind writes well-formed HTML', () => {
  const kinds = ['reaction', 'materials', 'measurements', 'instrument', 'timeline', 'safety', 'plot', 'steps', 'image', 'file'] as const
  for (const k of kinds) {
    const b = newBlock(k)
    assertWellFormed(blockToHtml(b, plainCtx), k)
  }
  const nb = exampleNotebooks()[0].notebook
  const ctx = renderCtx(nb)
  for (const e of nb.entries) assertWellFormed(entryBodyHtml(nb, e, ctx), e.title)
  const rx = blockToHtml({ kind: 'reaction', data: aspirinData() }, plainCtx)
  assert.match(rx, /Limiting reagent: <b>Salicylic acid<\/b>/)
  assert.match(rx, /81\.\d %/)
  assert.match(blockToHtml({ kind: 'measurements', data: { title: 'M', columns: [{ name: 'v', unit: 'mL' }], rows: [['1'], ['2'], ['3']] } }, plainCtx), /2\.0 ± 1\.0/)
})

// ------------------------------------------------------------------------------ search and calendar

test('search: words, phrases, operators and filters', () => {
  const nb = exampleNotebooks().find((e) => /XPS/.test(e.title))!.notebook
  const q = parseQuery('titanium tag:XPS "core level" status:signed from:2026-03-01 is:favourite sample:XPS-0002')
  assert.deepEqual(q.words, ['titanium', 'core level'])
  assert.equal(q.filters.tag, 'XPS')
  assert.equal(q.filters.status, 'signed')
  assert.equal(q.filters.from, '2026-03-01')
  assert.equal(q.filters.favourite, true)
  assert.equal(q.filters.sample, 'XPS-0002')
  assert.equal(searchEntries(nb, '').length, nb.entries.length)
  const hits = searchEntries(nb, 'sputter')
  assert.ok(hits.length >= 1 && hits[0].snippet.toLowerCase().includes('sputter'))
  assert.equal(searchEntries(nb, 'zzzzzz').length, 0)
  assert.equal(searchEntries(nb, '', { sample: 'XPS-0004' }).length, 1)
  assert.equal(searchEntries(nb, 'sample:XPS-0003').length, 1)
  assert.ok(searchEntries(nb, '', { instrument: 'k-alpha' }).length === 2)
  assert.equal(searchEntries(nb, '', { from: '2026-03-17' }).length, 1)
  assert.equal(searchEntries(nb, '', { to: '2026-03-16' }).length, 2)
  assert.equal(searchEntries(nb, 'tag:anatase').length, 1)
  assert.equal(searchEntries(nb, '', { project: 'XPS' }).length, 3)
  assert.equal(searchEntries(nb, '', { project: 'nothing' }).length, 0)
  assert.equal(searchEntries(nb, '', { author: 'martin' }).length, 3)
  assert.equal(searchEntries(nb, '', { status: 'signed' }).length, 0)
  assert.equal(searchEntries(nb, '', { favourite: true }).length, 0)
  assert.ok(searchEntries(nb, 'Ti 2p').length >= 1)
  // title matches rank above body matches
  const ranked = searchEntries(nb, 'annealed')
  assert.match(ranked[0].entry.title, /Annealed/)
  const demo = exampleNotebooks().find((e) => /^Audit chain demo/.test(e.title))!.notebook
  assert.equal(searchEntries(demo, '', { status: 'amended' }).length, 1)
  assert.equal(searchEntries(demo, '', { status: 'witnessed' }).length, 1)
  assert.equal(searchEntries(demo, '', { status: 'draft' }).length, 1)
  assert.equal(searchEntries(demo, 'status:signed').length, 1)
  // the reaction table words are searchable
  assert.ok(searchEntries(exampleNotebooks()[0].notebook, 'acetic anhydride').length >= 1)
})

test('calendar: month grid and days with entries', () => {
  const grid = monthGrid(2026, 2) // March 2026 starts on a Sunday
  assert.equal(grid.length, 6)
  assert.equal(grid[0][0].getDate(), 23) // Monday 23 Feb
  assert.equal(grid[0][6].getDate(), 1)
  const nb = exampleNotebooks().find((e) => /XPS/.test(e.title))!.notebook
  const days = entriesByDay(nb.entries)
  assert.deepEqual([...days.keys()].sort(), ['2026-03-16', '2026-03-18'])
  assert.equal(days.get('2026-03-16')!.length, 2)
  assert.deepEqual(timeline(nb.entries).map((m) => m.month), ['2026-03'])
  assert.deepEqual(latestMonth(nb.entries, new Date(2020, 0, 1)), { year: 2026, month: 2 })
  assert.deepEqual(latestMonth([], new Date(2020, 4, 1)), { year: 2020, month: 4 })
})

// ------------------------------------------------------------------------------ exports

test('exports: HTML, XHTML, Markdown, JSON; signed entries carry the hash block', () => {
  const nb = exampleNotebooks().find((e) => /^Audit chain demo/.test(e.title))!.notebook
  const e = nb.entries[0]
  for (const mode of ['html', 'xhtml'] as const) {
    const html = entryToDocument(nb, e, { mode })
    assertWellFormed(html, `entry ${mode}`)
    assert.ok(html.includes(e.signature!.hash), 'signature hash is printed')
    assert.match(html, /Witnessed<\/b> by Ben Okafor/)
    assert.match(html, /Addendum by Ana Martin/)
    assert.match(html, /not a certified 21 CFR Part 11 system/)
    assert.equal(html.startsWith('<?xml'), mode === 'xhtml')
  }
  assertWellFormed(notebookToDocument(nb, { mode: 'xhtml' }), 'notebook xhtml')
  assert.match(notebookToDocument(nb), /Audit log/)
  assert.doesNotMatch(notebookToDocument(nb, { audit: false }), /<h2>Audit log<\/h2>/)
  const md = entryToMarkdown(nb, e)
  assert.match(md, /^# Preparation of 50 mmol\/L phosphate buffer/)
  assert.match(md, /Signed by Ana Martin/)
  assert.match(md, /## Addendum by Ana Martin/)
  assert.ok(md.includes(e.signature!.hash))
  assert.match(notebookToMarkdown(nb), /^# Audit chain demo/)
  const json = JSON.parse(entryToJson(nb, e))
  assert.equal(json.format, 'keln-entry')
  assert.equal(json.contentHash, entryHash(e))
  assert.ok(json.audit.length >= 3)
  assert.match(entryToDocument(nb, nb.entries[2]), /Draft: not signed/)
  // markdown → entry round trip keeps the words
  const back = markdownToDoc(entryToMarkdown(nb, nb.entries[1]))
  assert.match(docText(back), /Saturated CuSO/)
  const aspirin = exampleNotebooks()[0].notebook
  assertWellFormed(entryToDocument(aspirin, aspirin.entries[0], { mode: 'xhtml' }), 'aspirin xhtml')
  assert.match(entryToMarkdown(aspirin, aspirin.entries[0]), /\| Role \| Compound/)
})

// ------------------------------------------------------------------------------ AI tools

function hooksFor(start: Notebook | null) {
  const log: string[] = []
  const state = { nb: start, path: start ? '/home/user/Documents/kELN/test.keln' : null, dirty: false }
  const files = new Map<string, string>()
  const hooks: Hooks = {
    state: () => ({ notebook: state.nb, path: state.path, dirty: state.dirty }),
    apply: (nb, path) => { state.nb = nb; state.path = path ?? state.path; state.dirty = true; log.push(`apply ${nb.entries.length}`) },
    readFile: async (path) => { const t = files.get(path); if (t == null) throw new Error('no such file'); return t },
    writeFile: async (path, text) => { files.set(path, text); log.push(`write ${path}`) },
    openNotebook: async (path, nb) => { state.nb = nb; state.path = path; log.push(`open ${path}`) },
    user: () => 'Ana Martin',
    examples: () => [{ title: 'Aspirin synthesis', file: '01 Aspirin synthesis.keln', path: '/home/user/Documents/kELN Examples/01 Aspirin synthesis.keln' }],
    openExample: async (path) => { log.push(`example ${path}`) },
  }
  return { hooks, state, log, files }
}

const ctxOf = (answers: boolean[] = [true]) => {
  const asked: string[] = []
  let i = 0
  return { asked, ctx: { caller: 'test', windowId: 'w', confirm: async (what: string) => { asked.push(what); return answers[i++] ?? false }, allowPython: async () => false } }
}

test('AI tools: get_state, add_entry (confirms before writing), search, load_example; no signing', async () => {
  assert.ok(KELN_TOOL_SET.tools.length <= 4)
  assert.deepEqual(KELN_TOOL_SET.tools.map((t) => t.action), ['get_state', 'add_entry', 'search', 'load_example'])
  for (const t of KELN_TOOL_SET.tools) {
    assert.ok(Object.keys((t.inputSchema as { properties: object }).properties).length <= 6)
    assert.ok(t.description.length <= 400)
  }
  assert.ok(KELN_TOOL_SET.tools.every((t) => !/^(sign|witness|amend)/.test(t.action)), 'signing is not offered to the AI')
  assert.ok(KELN_TOOL_SET.tools.find((t) => t.action === 'add_entry')!.description.includes('DRAFT'))
  assert.ok(KELN_TOOL_SET.summary.length <= 120)

  const nb = exampleNotebooks()[0].notebook
  const { hooks, state, files, log } = hooksFor(nb)
  const tools = kelnTools(hooks) as Record<string, (a: Record<string, unknown>, c: ReturnType<typeof ctxOf>['ctx']) => Promise<Record<string, unknown>>>
  const st = await tools.get_state({}, ctxOf().ctx)
  assert.equal((st as { open: boolean }).open, true)
  assert.equal((st as { entries: number }).entries, 3)
  const found = await tools.search({ query: 'recovery' }, ctxOf().ctx) as { count: number; entries: Array<{ number: string }> }
  assert.equal(found.count, 1)
  // declined → nothing written
  const no = ctxOf([false])
  await assert.rejects(() => tools.add_entry({ title: 'AI entry', template: 'titration', project: 'ASP', tags: 'ai, test' }, no.ctx), /declined|not allowed|cancel/i)
  assert.equal(state.nb!.entries.length, 3)
  assert.equal(no.asked.length, 1)
  const yes = ctxOf([true])
  const made = await tools.add_entry({ title: 'AI entry', template: 'titration', project: 'ASP', tags: 'ai, test', subject: 'HCl' }, yes.ctx) as { id: string; number: string; saved: boolean }
  assert.equal(state.nb!.entries.length, 4)
  assert.match(made.number, /^ASP-\d{4}-\d{3}$/)
  const created = state.nb!.entries.find((e) => e.id === made.id)!
  assert.equal(created.status, 'draft')
  assert.equal(created.template, 'titration')
  assert.deepEqual(created.tags, ['ai', 'test'])
  assert.equal(created.author, 'Ana Martin')
  assert.equal(made.saved, true)
  assert.ok([...files.keys()].some((p) => p.endsWith('test.keln')))
  const saved = parseKeln(files.get('/home/user/Documents/kELN/test.keln')!)
  assert.equal(saved.entries.length, 4)
  // it works on a notebook path as well
  const h2 = hooksFor(null)
  h2.files.set('/home/user/a.keln', serializeKeln(nb))
  const t2 = kelnTools(h2.hooks) as typeof tools
  const via = await t2.add_entry({ path: '/home/user/a.keln', title: 'By path', project: 'ASP' }, ctxOf([true]).ctx) as { id: string }
  assert.ok(via.id)
  assert.equal(parseKeln(h2.files.get('/home/user/a.keln')!).entries.length, 4)
  await assert.rejects(() => t2.add_entry({ title: 'No notebook' }, ctxOf([true]).ctx), /open|path/i)
  await assert.rejects(() => tools.add_entry({ title: 'x', template: 'nope', project: 'ASP' }, ctxOf([true]).ctx), /template/i)
  const ex = await tools.load_example({}, ctxOf().ctx) as { examples: unknown[] }
  assert.equal(ex.examples.length, 1)
  const opened = await tools.load_example({ id: 'aspirin' }, ctxOf().ctx) as { opened: string }
  assert.equal(opened.opened, 'Aspirin synthesis')
  assert.ok(log.includes('example /home/user/Documents/kELN Examples/01 Aspirin synthesis.keln'))
  await assert.rejects(() => tools.load_example({ id: 'nothing like it' }, ctxOf().ctx), /No example matches/)
  assert.equal(h2.state.nb, null)
})

// ------------------------------------------------------------------------------ import

test('import: Markdown, plain text and kNote notes become draft content', () => {
  const md = importFile('lab-notes.md', new TextEncoder().encode('# Buffer check\n\nThe pH was **7.4** at $25\\,^\\circ C$.\n\n- one\n- two\n'))
  assert.equal(md.title, 'Buffer check')
  assert.deepEqual(md.content.content!.map((n) => n.type), ['heading', 'paragraph', 'bulletList'])
  assert.deepEqual(md.tags, ['imported'])
  const txt = importFile('plain.txt', new TextEncoder().encode('just words here'))
  assert.equal(txt.title, 'just words here')
  const note = {
    meta: { title: 'Seminar on XPS', speaker: 'Dr. Lee', date: '2026-03-03', place: 'Room 4' }, summary: 'Core levels and charge correction.',
    sections: [{ title: 'Basics', blocks: [{ kind: 'typed', text: 'Photoelectric effect.' }, { kind: 'important', text: 'Calibrate on C 1s.' }, { kind: 'item', text: 'Survey first', level: 0, numbered: false }, { kind: 'question', text: 'Why flood gun?' }] }],
  }
  const out = knoteToMarkdown(note)
  assert.equal(out.title, 'Seminar on XPS')
  assert.match(out.markdown, /^# Seminar on XPS\n\nSpeaker: Dr\. Lee/)
  assert.match(out.markdown, /## Basics/)
  assert.match(out.markdown, /\*\*Key point:\*\* Calibrate on C 1s\./)
  const zip = zipSync({ 'note.json': strToU8(JSON.stringify(note)) })
  const imp = importFile('seminar.knote', zip)
  assert.equal(imp.title, 'Seminar on XPS')
  assert.match(docText(imp.content), /Photoelectric effect/)
  assert.deepEqual(imp.tags, ['imported', 'knote'])
  assert.throws(() => importFile('bad.knote', new Uint8Array([1, 2, 3])), /ZIP/)
  assert.throws(() => knoteToMarkdown(42), /kNote/)
})

// ------------------------------------------------------------------------------ the editor schema

test('every template, example entry, addendum and import fits the editor schema (Tiptap, no DOM needed)', () => {
  // the same nodes as src/apps/keln/editorExt.tsx (their views are React/DOM, the schema is only names, groups and attrs)
  const stub = (name: string, group: string, inline: boolean) => TipNode.create({ name, group, inline, atom: true, addAttributes() { return { latex: { default: '' }, id: { default: '' }, label: { default: '' }, block: { default: null } } } })
  const schema = getSchema([
    StarterKit, Highlight, Subscript, Superscript, TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableHeader, TableCell, Image.configure({ inline: true }),
    stub('mathInline', 'inline', true), stub('mathBlock', 'block', false), stub('sampleMention', 'inline', true), stub('elnBlock', 'block', false),
  ])
  const check = (json: PMNode, what: string) => {
    try { schema.nodeFromJSON(json).check() } catch (e) { assert.fail(`${what}: ${(e as Error).message}`) }
  }
  for (const t of TEMPLATES) check(t.content(), `template ${t.id}`)
  let n = 0
  for (const ex of exampleNotebooks()) {
    for (const e of ex.notebook.entries) {
      check(e.content, `${ex.title} / ${e.title}`)
      for (const a of e.addenda) check(a.content, `${ex.title} / addendum`)
      n++
    }
  }
  assert.ok(n >= 30, `${n} entries checked`)
  check(markdownToDoc('# T\n\n- [ ] a\n- [x] b\n\n1. one\n   - nested\n\n| a | b |\n|---|---|\n| $x$ | **y** |\n\n> quote\n\n```js\ncode\n```\n\n---\n\n![alt](https://example.org/x.png)\n\n$$\nE=mc^2\n$$\n'), 'markdown import')
  check(importFile('x.knote', zipSync({ 'note.json': strToU8(JSON.stringify({ meta: { title: 'N' }, sections: [{ title: 'S', blocks: [{ kind: 'item', text: 'a', level: 1 }, { kind: 'typed', text: 'b' }] }] })) })).content, 'knote import')
  // the editor's own JSON for a new block round-trips
  check(doc(block(newBlock('reaction')), p('after')), 'new block')
  assert.throws(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'nothing' }] }), /Unknown node type|nothing/)
})

// ------------------------------------------------------------------------------ opening is not editing

test('opening a notebook and selecting entries never changes it: no edit, no audit record, byte-identical', () => {
  // the editor's own normalisation, without a DOM: the schema round trip plus the empty paragraph the editor adds after a block
  const stub = (name: string, group: string, inline: boolean) => TipNode.create({ name, group, inline, atom: true, addAttributes() { return { latex: { default: '' }, id: { default: '' }, label: { default: '' }, block: { default: null } } } })
  const schema = getSchema([
    StarterKit, Highlight, Subscript, Superscript, TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableHeader, TableCell, Image.configure({ inline: true }),
    stub('mathInline', 'inline', true), stub('mathBlock', 'block', false), stub('sampleMention', 'inline', true), stub('elnBlock', 'block', false),
  ])
  const editorOutput = (d: PMNode, trailing: boolean): PMNode => {
    const json = schema.nodeFromJSON(d).toJSON() as PMNode
    return trailing ? { ...json, content: [...(json.content ?? []), { type: 'paragraph' }] } : json
  }
  let entries = 0
  for (const f of kelnExampleFiles()) {
    const before = f.content
    const nb = parseKeln(before)
    const auditBefore = JSON.stringify(nb.audit)
    for (const e of nb.entries) {
      entries++
      // "select" the entry: the editor loads the stored content and reports whatever it does on its own
      const tracker = createTracker(e.content) // before onCreate
      const loaded = editorOutput(e.content, false)
      tracker.reset(loaded) // onCreate
      for (const noise of [loaded, editorOutput(e.content, true), withoutTrailingEmpty(loaded)]) {
        assert.equal(tracker.changed(noise), false, `${f.title} / ${e.title}: the editor's own output is not an edit`)
        assert.equal(tracker.take(noise), null, `${f.title} / ${e.title}: nothing to store`)
      }
      // a signed entry is never written on load, whatever the editor reports
      if (e.status !== 'draft') assert.equal(entryHash(e), e.signature!.hash)
      // the first real keystroke is an edit, and only that
      const typed: PMNode = { ...loaded, content: [...(loaded.content ?? []), p('a real edit')] }
      assert.equal(tracker.changed(typed), true)
      assert.deepEqual(tracker.take(typed), typed)
      assert.equal(tracker.changed(typed), false, 'committed: the new baseline')
      // undoing it is an edit again (back to what the editor first showed)
      assert.equal(tracker.changed(loaded), true)
      // the instrument names an Instrument run block remembers on blur are already known: no change
      for (const b of docBlocks(e.content)) if (b.kind === 'instrument' && b.data.instrument.trim()) assert.equal(addInstrument(nb, b.data.instrument), nb, `${f.title}: ${b.data.instrument} is known`)
    }
    assert.equal(serializeKeln(nb), before, `${f.title}: parse and write give the same bytes`)
    assert.equal(JSON.stringify(nb.audit), auditBefore)
  }
  assert.ok(entries >= 30)
  // trailing empty paragraphs and attribute order do not count; real differences do
  const a = doc(p('x'), block(newBlock('timeline')))
  assert.equal(contentKey(a), contentKey({ ...a, content: [...a.content!, { type: 'paragraph' }, { type: 'paragraph' }] }))
  assert.notEqual(contentKey(doc(p('x'))), contentKey(doc(p('y'))))
  assert.equal(withoutTrailingEmpty(doc(p())).content!.length, 1, 'a document keeps at least one paragraph')
})
