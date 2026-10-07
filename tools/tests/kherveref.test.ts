// KherveRef's parsing and library format: BibTeX/BibLaTeX, LaTeX accents, DOI /
// arXiv / ISBN detection (also in PDF text), citation keys, the desktop's
// on-disk library layout, the importer, citation styles.
// Run:  node --test tools/tests/kherveref.test.ts   (Node ≥ 23 runs TypeScript directly.)
//
// Several cases are the desktop KherveRef's own tests (tests/test_bibtex.py,
// test_latex.py), so both apps read and write .bib files the same way.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as bibtex from '../../src/apps/kherveref/bibtex.ts'
import { latexToUnicode, protectCase, stripBraces, unicodeToLatex } from '../../src/apps/kherveref/latex.ts'
import { analysePdf, classify, cleanDoi, findArxiv, findDoi, findIsbn, largestText, splitIdentifiers, type PageWord } from '../../src/apps/kherveref/ids.ts'
import { baseKey, isValidKey, uniqueKey } from '../../src/apps/kherveref/keys.ts'
import { fromCsl, toCsl } from '../../src/apps/kherveref/csl.ts'
import {
  DuplicateIndex, fromDict, matchesSearch, newEntry, parseName, parseNames, person, personDisplay, toDict, type Entry,
} from '../../src/apps/kherveref/model.ts'
import { createLibrary, openLibrary, isLibrary, type LibFs } from '../../src/apps/kherveref/library.ts'
import { Importer, refreshFromIdentifiers, type Services } from '../../src/apps/kherveref/importer.ts'
import { sha1Fallback, sha1Hex } from '../../src/apps/kherveref/sha1.ts'
import { formatBibliography, formatCitation, formatReference, htmlToText, STYLES } from '../../src/apps/kherveref/cite.ts'

// ------------------------------------------------------------------ BibTeX

const SAMPLE = String.raw`
@string{jacs = "J. Am. Chem. Soc."}
@comment{ignored @article{nope, title={x}} }
@preamble{"\newcommand{\noop}[1]{}"}

@Article{smith2020,
  author    = {Smith, John and M{\"u}ller, Anna and {World Health Organization}},
  title     = {{XPS} study of {TiO2} surfaces},
  journal   = jacs,
  year      = 2020,
  month     = may,
  volume    = {142},
  pages     = {10--20},
  doi       = {https://doi.org/10.1021/JACS.0C00001},
  keywords  = {xps; titania},
  file      = {:smith.pdf:PDF},
  custom    = {kept}
}

@phdthesis{doe2019, author = "Jane Doe", title = "A thesis",
  school = "Imperial College London", year = "2019"}

@online{web, title={Page}, url={https://example.com/a_b}, date={2021-03-04},
  journaltitle={Ignored container}}

@article{broken, title = {missing close
`

test('parse a .bib like the desktop', () => {
  const res = bibtex.parse(SAMPLE)
  assert.deepEqual(res.entries.map((e) => e.key), ['smith2020', 'doe2019', 'web'])
  const s = res.entries[0]
  assert.equal(s.type, 'article')
  assert.deepEqual(s.authors.map(personDisplay), ['Smith, John', 'Müller, Anna', 'World Health Organization'])
  assert.equal(s.title, 'XPS study of TiO2 surfaces')
  assert.equal(s.journal, 'J. Am. Chem. Soc.')
  assert.equal(s.date, '2020-05')
  assert.equal(s.pages, '10–20')
  assert.equal(s.doi, '10.1021/JACS.0C00001')
  assert.deepEqual(s.keywords, ['xps', 'titania'])
  assert.deepEqual(s.extra, { file: ':smith.pdf:PDF', custom: 'kept' })
  const d = res.entries[1]
  assert.deepEqual([d.type, d.thesis_type, d.institution, d.date], ['thesis', 'phd', 'Imperial College London', '2019'])
  const w = res.entries[2]
  assert.deepEqual([w.type, w.date, w.url], ['online', '2021-03-04', 'https://example.com/a_b'])
  assert.equal(res.warnings.length, 1)
  assert.match(res.warnings[0], /malformed/)
})

test('parenthesised entries and # concatenation', () => {
  assert.equal(bibtex.parse('@string{a="Foo"} @misc(k1, title = a # " bar")').entries[0].title, 'Foo bar')
})

const sampleEntry = (): Entry =>
  newEntry({
    key: 'smith2020', type: 'article',
    authors: [person('Müller', 'Anna'), person('van der Berg', 'Jan'), person('', '', 'World Health Organization')],
    title: 'XPS study of TiO2', date: '2020-05', journal: 'J. Phys.', volume: '3', pages: '10–20', doi: '10.1/x_y',
    eprint: '2001.00001', eprinttype: 'arxiv', keywords: ['a', 'b'],
  })

test('BibLaTeX output', () => {
  const out = bibtex.entryToBibtex(sampleEntry(), 'biblatex')
  assert.ok(out.startsWith('@article{smith2020,\n'))
  assert.ok(out.includes('author       = {Müller, Anna and van der Berg, Jan and {World Health Organization}}'))
  assert.ok(out.includes('title        = {{XPS} study of {TiO2}}'))
  assert.ok(out.includes('journaltitle = {J. Phys.}'))
  assert.ok(out.includes('date         = {2020-05}'))
  assert.ok(out.includes('pages        = {10--20}'))
  assert.ok(out.includes('doi          = {10.1/x_y}'))
  assert.ok(out.includes('eprinttype   = {arxiv}'))
})

test('classic BibTeX output', () => {
  const out = bibtex.entryToBibtex(sampleEntry(), 'bibtex')
  assert.ok(out.includes(String.raw`M{\"{u}}ller, Anna`))
  assert.ok(out.includes('journal       = {J. Phys.}'))
  assert.ok(out.includes('year          = {2020}'))
  assert.ok(out.includes('month         = {may}'))
  assert.ok(out.includes('archiveprefix = {arXiv}'))
})

test('thesis and online mapping', () => {
  const t = newEntry({ key: 't', type: 'thesis', thesis_type: 'master', title: 'T', institution: 'Uni', date: '2019' })
  assert.ok(bibtex.entryToBibtex(t, 'bibtex').startsWith('@mastersthesis{t,'))
  assert.ok(bibtex.entryToBibtex(t, 'bibtex').includes('school'))
  assert.ok(bibtex.entryToBibtex(t, 'biblatex').includes('type        = {mathesis}'))
  const o = newEntry({ key: 'o', type: 'online', title: 'Page', url: 'https://x.org' })
  const out = bibtex.entryToBibtex(o, 'bibtex')
  assert.ok(out.startsWith('@misc{o,') && out.includes(String.raw`\url{https://x.org}`))
})

test('round trip through both dialects', () => {
  for (const dialect of bibtex.DIALECTS) {
    const back = bibtex.parse(bibtex.toBibtex([sampleEntry()], dialect)).entries[0]
    const e = sampleEntry()
    for (const name of ['key', 'type', 'title', 'date', 'journal', 'volume', 'pages', 'doi', 'eprint', 'eprinttype', 'keywords'] as const)
      assert.deepEqual(back[name], e[name], `${dialect} ${name}`)
    assert.deepEqual(back.authors.map(personDisplay), e.authors.map(personDisplay))
  }
})

test('output is sorted and deterministic', () => {
  const a = newEntry({ key: 'b', title: 'B' })
  const b = newEntry({ key: 'A', title: 'A' })
  assert.equal(bibtex.toBibtex([a, b]), bibtex.toBibtex([b, a]))
  assert.ok(bibtex.toBibtex([a, b]).indexOf('{A,') < bibtex.toBibtex([a, b]).indexOf('{b,'))
})

test('malformed input never throws', () => {
  for (const junk of ['@', '@article', '@article{', '@article{k, title=', '@article{k, title={x}', '@@@{{{', '@string{x', 'no entries']) {
    const res = bibtex.parse(junk)
    assert.ok(Array.isArray(res.entries))
  }
})

// ------------------------------------------------------------------- LaTeX

test('decode accents and symbols', () => {
  assert.equal(latexToUnicode(String.raw`M{\"u}ller`), 'Müller')
  assert.equal(stripBraces(latexToUnicode(String.raw`{\"{U}}ber {DNA}`)), 'Über DNA')
  assert.equal(latexToUnicode(String.raw`\'{e}t\'e`), 'été')
  assert.equal(latexToUnicode(String.raw`Fran\c{c}ois`), 'François')
  assert.equal(latexToUnicode(String.raw`\v{S}ar\'{\i}`), 'Šarí')
  assert.equal(latexToUnicode(String.raw`{\ss}`), 'ß')
  assert.equal(latexToUnicode(String.raw`pp. 10--20 --- A \& B`), 'pp. 10–20 — A & B')
  assert.equal(latexToUnicode(String.raw`$\alpha$--Fe`), String.raw`$\alpha$–Fe`)
})

test('encode round trip', () => {
  for (const s of ['Müller', 'François', 'Šarí', 'Straße', 'Ørsted', 'A & B 10%', '10–20']) assert.equal(stripBraces(latexToUnicode(unicodeToLatex(s))), s)
  assert.equal(unicodeToLatex('Müller & Co', false), String.raw`Müller \& Co`)
})

test('protect case', () => {
  assert.equal(protectCase('XPS of TiO2 at pH 7 by McDonald'), '{XPS} of {TiO2} at {pH} 7 by {McDonald}')
  assert.equal(protectCase('Deep learning'), 'Deep learning')
  assert.equal(protectCase('Already {DNA} and $X$'), 'Already {DNA} and $X$')
})

// ------------------------------------------------------------- identifiers

test('DOIs in running text', () => {
  assert.equal(findDoi('Published 2020. DOI: 10.1103/PhysRevB.99.045001; received'), '10.1103/PhysRevB.99.045001')
  assert.equal(findDoi('see https://doi.org/10.1016/j.apsusc.2020.146(2)).'), '10.1016/j.apsusc.2020.146(2)')
  assert.equal(findDoi('(doi:10.1000/abc)'), '10.1000/abc')
  assert.equal(findDoi('no identifier here, 10.5 is a number'), '')
  assert.equal(cleanDoi('10.1000/xyz.'), '10.1000/xyz')
})

test('arXiv ids and ISBNs', () => {
  assert.equal(findArxiv('arXiv:2101.00001v2 [cond-mat]'), '2101.00001')
  assert.equal(findArxiv('https://arxiv.org/abs/hep-th/9901001'), 'hep-th/9901001')
  assert.equal(findIsbn('ISBN-13: 978-0-262-03384-8'), '9780262033848')
  assert.equal(findIsbn('ISBN 0-306-40615-2'), '0306406152')
  assert.equal(findIsbn('ISBN 978-0-262-03384-9'), '', 'bad check digit')
})

test('classify what people paste', () => {
  assert.deepEqual(classify('https://doi.org/10.1038/nphys1170'), ['doi', '10.1038/nphys1170'])
  assert.deepEqual(classify('2101.00001'), ['arxiv', '2101.00001'])
  assert.deepEqual(classify('arXiv:2101.00001v3'), ['arxiv', '2101.00001'])
  assert.deepEqual(classify('978 0 262 03384 8'), ['isbn', '9780262033848'])
  assert.equal(classify('hello'), null)
  const { ids, unknown } = splitIdentifiers('10.1038/nphys1170\narXiv:2101.00001 10.1000/abc\n\nnonsense\n10.1038/NPHYS1170')
  assert.deepEqual(ids, [['doi', '10.1038/nphys1170'], ['arxiv', '2101.00001'], ['doi', '10.1000/abc']])
  assert.deepEqual(unknown, ['nonsense'])
})

test('a PDF\'s DOI: metadata first, then the text', () => {
  const fromMeta = analysePdf({ meta: { subject: 'Nature Physics, doi:10.1038/nphys1170', title: 'x' }, text: 'Something 10.9999/other', pages: 3 })
  assert.equal(fromMeta.doi, '10.1038/nphys1170')
  const fromText = analysePdf({
    meta: { title: 'Microsoft Word - draft.docx', author: 'user' },
    text: 'A great paper\nJournal of Things 12 (2019) 1–9\nhttps://doi.org/10.1016/j.things.2019.01.002\nAbstract. We did things. '.repeat(2),
    pages: 9,
    bigTitle: 'A great paper on things',
  })
  assert.equal(fromText.doi, '10.1016/j.things.2019.01.002')
  assert.equal(fromText.title, 'A great paper on things', 'junk metadata titles are ignored')
  assert.equal(fromText.authors, '', '"user" is not an author')
  assert.equal(fromText.year, '2019')
  assert.ok(fromText.hasText)
  const scanned = analysePdf({ meta: {}, text: '   ', pages: 1 })
  assert.equal(scanned.hasText, false)
  assert.equal(scanned.doi, '')
  const book = analysePdf({ meta: {}, text: 'Copyright 2009. ISBN 978-0-262-03384-8. All rights reserved.', pages: 1 })
  assert.equal(book.isbn, '9780262033848')
})

test('the title is the largest type near the top of page 1', () => {
  const w = (text: string, x: number, y: number, h: number, line: number): PageWord => ({ text, rect: [x, y, x + 40, y + h], line })
  const words = [
    w('Journal', 50, 30, 9, 0), w('of', 100, 30, 9, 0), w('Things', 120, 30, 9, 0),
    w('Surface', 50, 90, 18, 1), w('chemistry', 130, 90, 18, 1), w('of', 220, 90, 18, 1),
    w('titanium', 50, 112, 18, 2), w('dioxide', 140, 112, 18, 2),
    w('A.', 50, 150, 11, 3), w('Author', 70, 150, 11, 3),
    w('Huge', 50, 700, 40, 4), w('footer', 120, 700, 40, 4),
  ]
  assert.equal(largestText(words, 792), 'Surface chemistry of titanium dioxide')
  assert.equal(largestText([], 792), '')
})

// -------------------------------------------------------------------- keys

test('citation keys', () => {
  const e = newEntry({ authors: [person('van der Berg', 'Jan')], date: '2020-05', title: 'The surface of Ørsted crystals' })
  assert.equal(baseKey(e), 'berg2020surface')
  assert.equal(baseKey(e, 'Author_Year'), 'Berg2020')
  assert.equal(baseKey(e, 'author_year'), 'berg2020')
  assert.equal(uniqueKey(e, ['berg2020surface', 'BERG2020SURFACEB']), 'berg2020surfacec')
  assert.equal(baseKey(newEntry({ title: 'The notes' })), 'anonnotes')
  assert.equal(baseKey(newEntry({ authors: [person('', '', 'World Health Organization')], date: '2021', title: 'Report' })), 'world2021report')
  assert.ok(isValidKey('smith2020:a-b.c+d') && !isValidKey('a/b') && !isValidKey('..') && !isValidKey('a b'))
})

test('names', () => {
  assert.deepEqual(parseName('Ludwig van Beethoven'), person('van Beethoven', 'Ludwig'))
  assert.deepEqual(parseName('Family, Jr, Given'), person('Family Jr', 'Given'))
  assert.deepEqual(parseName('{World Health Organization}'), person('', '', 'World Health Organization'))
  assert.equal(parseNames('A, B and C, D and others').length, 2)
})

// -------------------------------------------------------------------- CSL

test('CSL-JSON from Crossref', () => {
  const e = fromCsl({
    type: 'journal-article', title: ['Measured &amp; <i>measurement</i>'], 'container-title': ['Nature Physics'],
    author: [{ given: 'Markus', family: 'Aspelmeyer' }, { name: 'The Collaboration' }, { family: 'Broek', 'non-dropping-particle': 'van den' }],
    issued: { 'date-parts': [[2009, 4]] }, volume: '5', page: '11-12', DOI: '10.1038/nphys1170', URL: 'http://dx.doi.org/10.1038/nphys1170',
    ISSN: ['1745-2473', '1745-2481'],
  })
  assert.equal(e.type, 'article')
  assert.equal(e.title, 'Measured & measurement')
  assert.equal(e.journal, 'Nature Physics')
  assert.deepEqual(e.authors.map(personDisplay), ['Aspelmeyer, Markus', 'The Collaboration', 'van den Broek'])
  assert.equal(e.date, '2009-04')
  assert.equal(e.pages, '11–12')
  assert.equal(e.url, '', 'a URL that is just the DOI is dropped')
  assert.equal(e.issn, '1745-2473')
  const back = fromCsl(toCsl(newEntry({ ...e, key: 'k' })))
  assert.equal(back.title, e.title)
  assert.equal(back.date, e.date)
})

// ------------------------------------------------------- the library files

/** An in-memory drive with os.fs's methods. */
class MemFs implements LibFs {
  files = new Map<string, Uint8Array>()
  dirs = new Set<string>(['/'])
  private parent = (p: string) => p.split('/').slice(0, -1).join('/') || '/'
  exists(p: string) {
    return this.files.has(p) || this.dirs.has(p)
  }
  isDir(p: string) {
    return this.dirs.has(p)
  }
  list(dir: string) {
    const out: { name: string; type: 'file' | 'dir' }[] = []
    for (const d of this.dirs) if (d !== dir && this.parent(d) === dir) out.push({ name: d.split('/').pop()!, type: 'dir' })
    for (const f of this.files.keys()) if (this.parent(f) === dir) out.push({ name: f.split('/').pop()!, type: 'file' })
    return out
  }
  async readText(p: string) {
    return new TextDecoder().decode(await this.readBytes(p))
  }
  async readBytes(p: string) {
    const f = this.files.get(p)
    if (!f) throw new Error(`ENOENT ${p}`)
    return f
  }
  async writeText(p: string, t: string, o?: { mkdirs?: boolean }) {
    await this.writeBytes(p, new TextEncoder().encode(t), o)
  }
  async writeBytes(p: string, d: Uint8Array, o: { mkdirs?: boolean } = {}) {
    if (!this.dirs.has(this.parent(p))) {
      if (!o.mkdirs) throw new Error(`ENOENT ${this.parent(p)}`)
      await this.mkdir(this.parent(p), { recursive: true })
    }
    this.files.set(p, d)
  }
  async mkdir(p: string) {
    const parts = p.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) this.dirs.add('/' + parts.slice(0, i).join('/'))
  }
  async remove(p: string) {
    this.files.delete(p)
    this.dirs.delete(p)
  }
  async rename(a: string, b: string) {
    this.files.set(b, this.files.get(a)!)
    this.files.delete(a)
  }
  text(p: string) {
    return new TextDecoder().decode(this.files.get(p))
  }
}

const ROOT = '/home/user/Documents/KherveRef'

test('a new library has the desktop layout', async () => {
  const fs = new MemFs()
  const lib = await createLibrary(fs, ROOT)
  assert.equal(lib.name, 'KherveRef')
  assert.equal(fs.text(`${ROOT}/KherveRef.kref`), '{\n  "app": "KherveRef",\n  "dialect": "biblatex",\n  "format": 2,\n  "name": "KherveRef"\n}\n')
  assert.equal(fs.text(`${ROOT}/.kherveref/collections.json`), '{\n  "collections": []\n}\n')
  assert.equal(fs.text(`${ROOT}/.gitignore`), '.kherveref/cache/\n.DS_Store\nThumbs.db\n')
  assert.ok(fs.exists(`${ROOT}/.kherveref/references/.gitkeep`) && fs.exists(`${ROOT}/PDFs/.gitkeep`))
  assert.ok(isLibrary(fs, ROOT) && isLibrary(fs, `${ROOT}/KherveRef.kref`))
  await assert.rejects(createLibrary(fs, ROOT), /already holds/)
})

test('references are saved as the desktop saves them, and library.bib follows', async () => {
  const fs = new MemFs()
  const lib = await createLibrary(fs, ROOT)
  const e = sampleEntry()
  e.key = ''
  e.collections = ['c2', 'c1', 'c1']
  await lib.addEntry(e)
  assert.equal(e.key, 'muller2020xps', 'keys are ASCII')
  await lib.attachFile(e, new TextEncoder().encode('%PDF-1.4 fake'), '.PDF')
  await lib.saveEntry(e)
  await lib.writeLibraryBib()
  const json = fs.text(`${ROOT}/.kherveref/references/muller2020xps.json`)
  const d = JSON.parse(json)
  assert.deepEqual(Object.keys(d), ['key', 'type', 'authors', 'title', 'date', 'journal', 'volume', 'pages', 'doi', 'eprint', 'eprinttype', 'keywords', 'files', 'collections', 'added', 'modified'])
  assert.deepEqual(d.collections, ['c1', 'c2'])
  assert.deepEqual(d.files, [{ path: 'PDFs/muller2020xps.pdf', sha1: createHash('sha1').update('%PDF-1.4 fake').digest('hex') }])
  assert.match(d.added, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/)
  assert.ok(json.endsWith('}\n') && json.includes('\n  "authors": [\n    {\n      "family": "Müller",'))
  const bib = fs.text(`${ROOT}/library.bib`)
  assert.ok(bib.startsWith('% KherveRef — generated by KherveRef. Do not edit: changes are overwritten.\n\n@article{muller2020xps,'))
  assert.ok(bib.includes('journal       = {J. Phys.}'), 'library.bib is classic BibTeX')

  lib.collections.push({ id: 'c1', name: 'Surfaces', parent: '' }, { id: 'c2', name: 'Oxides', parent: 'c1' })
  await lib.saveCollections()
  assert.equal(
    fs.text(`${ROOT}/.kherveref/collections.json`),
    '{\n  "collections": [\n    {\n      "id": "c1",\n      "name": "Surfaces"\n    },\n    {\n      "id": "c2",\n      "name": "Oxides",\n      "parent": "c1"\n    }\n  ]\n}\n',
  )
  assert.deepEqual([...lib.descendants('c1')].sort(), ['c1', 'c2'])

  const again = await openLibrary(fs, `${ROOT}/KherveRef.kref`)
  assert.deepEqual(toDict(again.entries.get('muller2020xps')!), toDict(e))
  assert.equal(again.collections.length, 2)

  await again.renameKey('muller2020xps', 'mueller2020')
  assert.ok(fs.exists(`${ROOT}/PDFs/mueller2020.pdf`) && !fs.exists(`${ROOT}/PDFs/muller2020xps.pdf`))
  assert.ok(fs.exists(`${ROOT}/.kherveref/references/mueller2020.json`) && !fs.exists(`${ROOT}/.kherveref/references/muller2020xps.json`))
  await assert.rejects(again.renameKey('mueller2020', 'bad key'))
  await again.deleteEntry(again.entries.get('mueller2020')!)
  assert.ok(!fs.exists(`${ROOT}/PDFs/mueller2020.pdf`))
})

test('a reference file written by the desktop reads back unchanged', () => {
  const desktop = {
    key: 'smith2020', type: 'article', authors: [{ family: 'Smith', given: 'J.' }, { literal: 'CERN' }], title: 'T', date: '2020',
    keywords: ['x'], extra: { b: '2', a: '1' }, files: [{ path: 'PDFs/smith2020.pdf', sha1: 'ab' }], collections: ['z', 'a'],
    notes: 'n', needs_review: true, added: '2020-01-01T00:00:00+00:00', modified: '2020-01-02T00:00:00+00:00',
  }
  const out = toDict(fromDict(desktop))
  assert.deepEqual(Object.keys(out.extra as object), ['a', 'b'])
  assert.deepEqual(out.collections, ['a', 'z'])
  assert.equal(out.needs_review, true)
  assert.equal(fromDict({ key: 'k', files: ['PDFs/k.pdf'] }).files[0].path, 'PDFs/k.pdf', 'format-1 attachments are plain strings')
})

test('newer or old-format libraries are refused with a reason', async () => {
  const fs = new MemFs()
  await fs.writeText('/lib/x.kref', JSON.stringify({ format: 9, name: 'x' }), { mkdirs: true })
  await assert.rejects(openLibrary(fs, '/lib'), /newer KherveRef/)
  await fs.writeText('/old/library.json', '{}', { mkdirs: true })
  await assert.rejects(openLibrary(fs, '/old'), /desktop KherveRef/)
})

// --------------------------------------------------------------- importer

function fakeServices(records: Record<string, Entry>, opts: { offline?: boolean; pdf?: Partial<ReturnType<typeof analysePdf>> } = {}) {
  class Offline extends Error {}
  const calls: string[] = []
  const services: Services = {
    async lookupId(kind, id) {
      calls.push(`${kind}:${id}`)
      if (opts.offline) throw new Offline('server not reachable')
      const r = records[`${kind}:${id}`]
      if (!r) throw new Error('no record')
      return { entry: fromDict(toDict(r)), source: 'Crossref' }
    },
    async searchTitle(title) {
      calls.push(`title:${title}`)
      return null
    },
    async inspectPdf() {
      return { doi: '', arxiv: '', isbn: '', title: '', authors: '', year: '', hasText: true, pages: 1, ...opts.pdf }
    },
    isNetworkError: (e) => e instanceof Offline,
  }
  return { services, calls }
}

const NPHYS = newEntry({ type: 'article', title: 'Measured measurement', authors: [person('Aspelmeyer', 'Markus')], date: '2009', doi: '10.1038/nphys1170', journal: 'Nature Physics' })

test('add by DOI, never twice', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services, calls } = fakeServices({ 'doi:10.1038/nphys1170': NPHYS })
  const imp = new Importer(lib, services, { collection: 'c1' })
  const o = await imp.addIdentifier('doi', '10.1038/nphys1170')
  assert.equal(o.status, 'added')
  assert.equal(o.key, 'aspelmeyer2009measured')
  assert.deepEqual(lib.entries.get(o.key)!.collections, ['c1'])
  const again = await imp.addIdentifier('doi', '10.1038/NPHYS1170')
  assert.equal(again.status, 'duplicate')
  assert.equal(calls.length, 1, 'a known DOI is not looked up again')
  assert.equal((await imp.addIdentifier('doi', '10.1/missing')).status, 'failed')
  assert.equal(imp.headline(), '1 added, 1 already in the library, 1 failed')
  await imp.finish()
  assert.ok(lib.libraryBibText().includes('@article{aspelmeyer2009measured,'))
})

test('offline: the reference is kept, to check later', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services } = fakeServices({}, { offline: true })
  const o = await new Importer(lib, services).addIdentifier('arxiv', '2101.00001')
  assert.equal(o.status, 'review')
  const e = lib.entries.get(o.key)!
  assert.equal(e.eprint, '2101.00001')
  assert.equal(e.needs_review, true)
})

test('a PDF: found by its DOI; the same file or paper is not added twice', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services } = fakeServices({ 'doi:10.1038/nphys1170': NPHYS }, { pdf: { doi: '10.1038/nphys1170' } })
  const imp = new Importer(lib, services)
  const pdf = new TextEncoder().encode('%PDF one')
  const o = await imp.addPdf(pdf, 'paper.pdf')
  assert.equal(o.status, 'added')
  assert.equal(lib.entries.get(o.key)!.files[0].path, `PDFs/${o.key}.pdf`)
  assert.equal((await imp.addPdf(pdf, 'copy.pdf')).status, 'duplicate')
  assert.equal((await imp.addPdf(new TextEncoder().encode('%PDF other print'), 'v2.pdf')).status, 'duplicate')
})

test('a PDF for a reference already there is attached to it', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services } = fakeServices({ 'doi:10.1038/nphys1170': NPHYS }, { pdf: { doi: '10.1038/nphys1170' } })
  const imp = new Importer(lib, services)
  const added = await imp.addIdentifier('doi', '10.1038/nphys1170')
  const o = await imp.addPdf(new TextEncoder().encode('%PDF'), 'p.pdf')
  assert.equal(o.status, 'attached')
  assert.equal(o.key, added.key)
  assert.equal(lib.entries.get(added.key)!.files.length, 1)
})

test('a PDF without identifiers is guessed and marked for checking', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services, calls } = fakeServices({}, { pdf: { title: 'A study of surface things', authors: 'Ada Lovelace; Charles Babbage', year: '1843' } })
  const o = await new Importer(lib, services).addPdf(new TextEncoder().encode('%PDF x'), 'scan_01.pdf')
  assert.equal(o.status, 'review')
  assert.deepEqual(calls, ['title:A study of surface things'])
  const e = lib.entries.get(o.key)!
  assert.equal(e.title, 'A study of surface things')
  assert.deepEqual(e.authors.map(personDisplay), ['Lovelace, Ada', 'Babbage, Charles'])
  assert.equal(o.key, 'lovelace1843study')
})

test('import BibTeX and CSL-JSON text', async () => {
  const lib = await createLibrary(new MemFs(), ROOT)
  const { services } = fakeServices({})
  const imp = new Importer(lib, services)
  await imp.importText(SAMPLE, 'refs.bib')
  assert.deepEqual([...lib.entries.keys()].sort(), ['doe2019', 'smith2020', 'web'], 'imported keys are kept')
  await imp.importText(SAMPLE, 'refs.bib')
  // As on the desktop, only "web" (a short title, no author, no identifier) can't be recognised.
  assert.deepEqual(imp.outcomes.slice(-3).map((o) => o.status), ['duplicate', 'duplicate', 'added'])
  await imp.importText(JSON.stringify([{ type: 'book', title: 'A CSL book', author: [{ family: 'Doe', given: 'J' }], issued: { 'date-parts': [[1999]] } }]), 'x.json')
  assert.ok(lib.entries.has('doe1999csl'))
})

test('look a reference up again', async () => {
  const { services } = fakeServices({ 'doi:10.1038/nphys1170': NPHYS })
  const e = newEntry({ key: 'mine', doi: '10.1038/nphys1170', title: 'guessed', needs_review: true, notes: 'my notes', files: [{ path: 'PDFs/mine.pdf', sha1: '' }] })
  assert.match(await refreshFromIdentifiers(e, services), /DOI/)
  assert.equal(e.title, 'Measured measurement')
  assert.equal(e.key, 'mine')
  assert.equal(e.notes, 'my notes')
  assert.equal(e.files.length, 1)
  assert.equal(e.needs_review, false)
  await assert.rejects(refreshFromIdentifiers(newEntry({ title: 'short' }), services))
})

test('duplicates by title, year and first author', () => {
  const idx = DuplicateIndex.build([newEntry({ key: 'a', title: 'Notes', date: '2020', authors: [person('Doe', 'J')] })])
  assert.equal(idx.find(newEntry({ title: 'notes', date: '2020', authors: [person('Doe', 'Jane')] })), 'a')
  assert.equal(idx.find(newEntry({ title: 'notes', date: '2020', authors: [person('Roe', 'Jane')] })), null)
})

test('search', () => {
  const e = sampleEntry()
  assert.ok(matchesSearch(e, 'müller xps'))
  assert.ok(matchesSearch(e, '10.1/x_y'))
  assert.ok(!matchesSearch(e, 'müller graphene'))
})

// -------------------------------------------------------------------- SHA-1

test('SHA-1 fallback matches Node', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100_000]) {
    const data = new Uint8Array(n).map((_, i) => (i * 31) & 255)
    assert.equal(sha1Fallback(data), createHash('sha1').update(data).digest('hex'), `${n} bytes`)
  }
  assert.equal(await sha1Hex(new TextEncoder().encode('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d')
})

// --------------------------------------------------------------- citations

test('citation styles', () => {
  const e = newEntry({
    key: 'k', type: 'article', authors: [person('Smith', 'John Ronald'), person('Müller', 'Anna')], title: 'XPS of oxides', date: '2020-05',
    journal: 'Surface Science', volume: '12', number: '3', pages: '10–20', doi: '10.1/x',
  })
  assert.equal(formatCitation([e]), '(Smith & Müller, 2020)')
  assert.equal(formatCitation([e], 'harvard-cite-them-right'), '(Smith and Müller, 2020)')
  assert.equal(formatCitation([e], 'vancouver'), '(Smith & Müller, 2020)', 'numbered styles fall back to APA in text')
  assert.equal(
    htmlToText(formatReference(e, 'apa')),
    'Smith, J. R., & Müller, A. (2020). XPS of oxides. Surface Science, 12(3), 10–20. https://doi.org/10.1/x',
  )
  assert.equal(formatReference(e, 'apa').includes('<i>Surface Science</i>'), true)
  assert.equal(htmlToText(formatReference(e, 'vancouver', 1)), '1. Smith JR, Müller A. XPS of oxides. Surface Science. 2020;12(3):10–20. doi:10.1/x')
  assert.equal(htmlToText(formatReference(e, 'ieee', 2)), '[2] J. R. Smith and A. Müller, “XPS of oxides,” Surface Science, vol. 12, no. 3, pp. 10–20, May 2020, doi: 10.1/x.')
  for (const style of Object.keys(STYLES)) {
    for (const t of ['article', 'book', 'incollection', 'thesis', 'unpublished', 'misc', 'online']) {
      const text = htmlToText(formatReference(newEntry({ ...e, type: t, booktitle: 'Book', publisher: 'Pub' }), style))
      assert.ok(text.includes('XPS of oxides') && !text.includes('undefined') && !text.includes('  '), `${style} ${t}: ${text}`)
    }
  }
  assert.equal(formatBibliography([e, newEntry({ key: 'a', authors: [person('Adams', 'A')], title: 'First', date: '2001' })]).length, 2)
})
