// KherveBook's Note / File / KFit / KherveTeX / Molecule cell documents against
// the desktop (notecell.py, filecell.py, kfitcell.py, ktexcell.py, molcell.py),
// and the KFit cell's Python view against a real .kfit when one is around.
//   node --test tools/tests/khervebook-cells.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NOTE_STARTER, asText, attachmentFrom, claimPath, filesSource, humanSize, kfReference, kfitSource, ktexSource, molAtoms, molFormula, molSource,
  noteBody, noteSource, noteText, parseFiles, parseKfit, parseKtex, parseMol, parseNote, pyDumps, snippet, subscriptDigits, withAttachments,
  cellAttachments, b64ToBytes, bytesToB64, kfCode,
} from '../../src/apps/khervebook/cellfiles.ts'

const py = (code: string): string | null => {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}
const hasPython = py('print(1)') !== null

test('pyDumps writes what Python json.dumps writes', { skip: !hasPython && 'no python3' }, () => {
  const samples: unknown[] = [
    { kbook_note: 1, html: '<h2>Notes</h2><p>Type — “é” 😀 \\ "q"\n\ttab</p>', ink: null },
    { kbook_files: 1, files: [{ name: 'data.csv', size: 12, path: 'Book_files/data.csv' }] },
    { a: [1, 2.5, -3, true, false, null, []], b: {}, c: 'x' },
  ]
  for (const s of samples) {
    const want = py(`import json; print(json.dumps(json.loads(${JSON.stringify(JSON.stringify(s))})), end='')`)
    assert.equal(pyDumps(s as never), want)
  }
  assert.equal(pyDumps({ a: [1, { b: 2 }] }, 1), py('import json; print(json.dumps({"a": [1, {"b": 2}]}, indent=1), end="")'))
})

test('NOTE_STARTER is the desktop notecell.NOTE_STARTER', { skip: !hasPython && 'no python3' }, () => {
  const want = py(
    'import json; print(json.dumps({"kbook_note": 1, "html": ("<h2>Notes</h2><p>Type here like in a word processor \\u2014 use the toolbar to format text, or the pen to annotate.</p>"), "ink": None}), end="")',
  )
  assert.equal(NOTE_STARTER, want)
})

test('notes: JSON, raw HTML and plain text load like NoteCell.set_source', () => {
  const doc = parseNote(NOTE_STARTER)
  assert.match(doc.html, /^<h2>Notes<\/h2>/)
  assert.equal(doc.ink, null)
  assert.equal(parseNote('<b>hi</b>').html, '<b>hi</b>')
  assert.equal(parseNote('a < b\nc').html, '<p>a &lt; b<br>c</p>')
  const ink = { ref_w: 400, strokes: [{ color: '#c0392b', width: 3, pts: [[1, 2], [3.5, 4]] as [number, number][] }] }
  const src = noteSource({ html: '<p>x</p>', ink })
  assert.deepEqual(parseNote(src), { html: '<p>x</p>', ink })
  assert.equal(noteSource({ html: '', ink: { ref_w: 3, strokes: [] } }), '{"kbook_note": 1, "html": "", "ink": null}')
  const qt = '<!DOCTYPE HTML><html><head><style>p{}</style></head><body style=" font-family:\'Arial\';"><p>Hello <b>you</b></p></body></html>'
  assert.equal(noteBody(qt), '<p>Hello <b>you</b></p>')
  assert.equal(noteText(pyDumps({ kbook_note: 1, html: qt, ink: null })), 'Hello you')
})

test('File cells: multi-file and legacy formats, sizes, sidecar names', () => {
  const src = '{"kbook_files": 1, "files": [{"name": "a.csv", "size": 3, "embed": "YSxi"}, {"name": "b.png", "size": 9, "path": "Nb_files/b.png"}]}'
  const files = parseFiles(src)
  assert.equal(files.length, 2)
  assert.equal(filesSource(files), src)
  assert.deepEqual(parseFiles('{"kbook_file": 1, "name": "x.txt", "size": 0, "embed": "aGk="}'), [{ name: 'x.txt', size: 2, embed: 'aGk=' }])
  assert.deepEqual(parseFiles('not json'), [])
  assert.equal(attachmentFrom({ size: 3 }), null)
  // desktop _human_size
  assert.equal(humanSize(0), '0 B')
  assert.equal(humanSize(1023), '1023 B')
  assert.equal(humanSize(1536), '1.5 KB')
  assert.equal(humanSize(5 * 1024 * 1024), '5.0 MB')
  // desktop _Attachment._claim
  const claimed = new Set<string>()
  assert.equal(claimPath('Book', 'data.csv', claimed), 'Book_files/data.csv')
  assert.equal(claimPath('Book', 'data.csv', claimed), 'Book_files/data-2.csv')
  assert.equal(claimPath('Book', 'data.csv', claimed), 'Book_files/data-3.csv')
  assert.equal(claimPath('Book', 'README', claimed), 'Book_files/README')
  assert.equal(kfReference('my "data".csv'), 'kf("my \\"data\\".csv")')
})

test('File previews: text detection and the 6-line snippet', () => {
  const enc = new TextEncoder()
  assert.equal(asText(enc.encode('x,y\n1,2\n'), '.csv'), 'x,y\n1,2\n')
  assert.equal(asText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 2]), '.zip'), null)
  assert.equal(asText(enc.encode('plain words here'), '.weird'), 'plain words here')
  assert.equal(asText(new Uint8Array([0xe9, 0x74, 0xe9]), '.txt'), 'été')
  const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
  assert.equal(snippet(long), 'line 0\nline 1\nline 2\nline 3\nline 4\nline 5\n…')
  assert.equal(snippet('short'), 'short')
})

test('KFit, KherveTeX and Molecule sources round-trip in the desktop key order', () => {
  const k = parseKfit('{"kbook_kfit": 1, "sheet": "C1s", "view": "data", "file": {"name": "a.kfit", "size": 10, "path": "N_files/a.kfit"}, "origin": "/home/user/a.kfit"}')
  assert.equal(k.view, 'data')
  assert.equal(kfitSource(k), '{"kbook_kfit": 1, "sheet": "C1s", "view": "data", "file": {"name": "a.kfit", "size": 10, "path": "N_files/a.kfit"}, "origin": "/home/user/a.kfit"}')
  assert.equal(kfitSource(parseKfit('')), '{"kbook_kfit": 1, "sheet": "", "view": "plot"}')
  const t = '{"kbook_ktex": 1, "page": 2, "file": {"name": "d.ktexz", "size": 5, "embed": "AAAA"}, "origin": "/x/d.ktexz"}'
  assert.equal(ktexSource(parseKtex(t)), t)
  const kmol = { format: 'khervemol', version: 5, mol3d: { name: 'water', label: 'Water', atoms: [['O', 0, 0, 0], ['H', 0.96, 0, 0], ['H', -0.24, 0.93, 0]], bonds: [[0, 1, 1], [0, 2, 1]] } }
  const m = parseMol(molSource({ kmol: kmol as never, view: '2d', query: 'water' }))
  assert.equal(m.view, '2d')
  assert.equal(m.query, 'water')
  const atoms = molAtoms(m.kmol)
  assert.equal(atoms.name, 'Water')
  assert.equal(atoms.atoms.length, 3)
  assert.deepEqual(atoms.bonds, [[0, 1, 1], [0, 2, 1]])
  assert.equal(molFormula(atoms.atoms), 'H2O')
  assert.equal(molFormula([{ el: 'O' }, { el: 'C' }, { el: 'H' }, { el: 'H' }, { el: 'N' }, { el: 'C' }]), 'C2H2NO')
  assert.equal(subscriptDigits('C8H10N4O2'), 'C₈H₁₀N₄O₂')
  // a bare .kmol document (no kbook_mol wrapper) is the molecule itself
  assert.equal(parseMol(JSON.stringify(kmol)).kmol.format, 'khervemol')
})

test('attachments of every kind are found and replaced (save → sidecar paths)', () => {
  const kf = kfitSource({ file: { name: 'a.kfit', size: 3, embed: 'AAAA' }, sheet: 'O1s', view: 'plot', origin: '' })
  assert.deepEqual(cellAttachments('kfit', kf), [{ name: 'a.kfit', size: 3, embed: 'AAAA' }])
  const saved = withAttachments('kfit', kf, [{ name: 'a.kfit', size: 3, path: 'Nb_files/a.kfit' }])
  assert.equal(saved, '{"kbook_kfit": 1, "sheet": "O1s", "view": "plot", "file": {"name": "a.kfit", "size": 3, "path": "Nb_files/a.kfit"}}')
  assert.deepEqual(cellAttachments('code', 'print(1)'), [])
  const bytes = new Uint8Array([0, 1, 2, 250, 255])
  assert.deepEqual(b64ToBytes(bytesToB64(bytes)), bytes)
})

test('kf() and kfit() behave like the desktop kernel helpers', { skip: !hasPython && 'no python3' }, () => {
  const code = kfCode({ 'data.csv': '/home/user/Notebooks/Book_files/data.csv' }, '/home/user/Notebooks', [])
  const out = py(
    code +
      '\nprint(kf("data.csv"))\nprint(kf())\n' +
      'try:\n    kf("nope.csv")\nexcept FileNotFoundError as e:\n    print("FNF", e)\n' +
      'try:\n    kfit("C1s")\nexcept NameError as e:\n    print("NE", e)\n',
  )
  assert.equal(
    out,
    "/home/user/Notebooks/Book_files/data.csv\n/home/user/Notebooks\nFNF no attached file named 'nope.csv' (check the File cell's name)\n" +
      'NE no KherveFitting project yet — add a KFit cell and load a .kfit into it\n',
  )
  assert.match(kfCode({}, null, [{ path: null, name: 'null.kfit', title: '' }]), /make_kfit\(__import__\('json'\)\.loads\(".*null\.kfit/)
})

// ------------------------------------------------- the KFit cell's Python

const KFIT = '/Users/gkerherv/Documents/PycharmProjects/KherveFittingPro/Data-Examples/2p Al ... Zn/26 - Fe - Iron/Fe2O3.kfit'
const hasKfitDeps = hasPython && py('import h5py, numpy, matplotlib; print(1)') !== null

test('kbook_kfit.view draws a sheet and tabulates it like kfitcell', { skip: (!hasKfitDeps || !existsSync(KFIT)) && 'needs python3 with h5py/matplotlib and a .kfit' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kbtest-'))
  const script = join(dir, 't.py')
  writeFileSync(
    script,
    [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(join(process.cwd(), 'public/apps/khervebook/py'))})`,
      'from kbook_kfit import view',
      `p = ${JSON.stringify(KFIT)}`,
      'r = json.loads(view.render(p, "Fe2p", "plot", "Fe2O3.kfit"))',
      'd = json.loads(view.render(p, "Fe2p", "data", "Fe2O3.kfit"))',
      'k = view.make_kfit([{"path": p, "name": "Fe2O3.kfit", "title": ""}])',
      'print(json.dumps({"names": r["names"][:4], "sheet": r["sheet"], "png": len(r.get("png", "")), "headers": d["headers"], "n": d["nrows"], "peaks": len(k("Fe2p").peaks), "by_name": k(cell="Fe2O3").names[:2]}))',
    ].join('\n'),
  )
  const r = spawnSync('python3', [script], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout) as { names: string[]; sheet: string; png: number; headers: string[]; n: number; peaks: number; by_name: string[] }
  assert.deepEqual(out.names, ['Survey', 'C1s', 'O1s', 'Fe2p'])
  assert.equal(out.sheet, 'Fe2p')
  assert.ok(out.png > 10000)
  assert.equal(out.headers[0], 'Binding Energy (eV)')
  assert.equal(out.headers[out.headers.length - 1], 'Envelope')
  assert.equal(out.n, 321)
  assert.equal(out.peaks, 6)
  assert.deepEqual(out.by_name, ['Survey', 'C1s'])
})
