// Notes (src/apps/notes): the storage format — front matter, Markdown <-> the
// editor's document, titles and tags, the library on an in-memory drive
// (folders, Recently Deleted, attachments, external edits), and the sync plan.
// Run:  node --test tools/tests/notes.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { checklistItems, docToMarkdown, markdownToDoc, docToPlain, setChecklistItem, type JNode } from '../../src/apps/notes/markdown.ts'
import {
  daysLeft, fileStem, folderNameProblem, localLinks, nameFitsTitle, parseNoteFile, relinkMarkdown, serializeNoteFile, summarize, tagsIn,
} from '../../src/apps/notes/format.ts'
import { NotesLibrary, sortNotes, type NotesFs, type NotesFsEntry } from '../../src/apps/notes/library.ts'
import { planSync } from '../../src/apps/notes/syncPlan.ts'

// ------------------------------------------------------------ an in-memory drive

class MemFs implements NotesFs {
  files = new Map<string, Uint8Array>()
  dirs = new Set<string>(['/'])
  times = new Map<string, number>()
  clock = 1_000
  private parent(p: string) {
    const i = p.lastIndexOf('/')
    return i <= 0 ? '/' : p.slice(0, i)
  }
  exists(p: string) {
    return this.files.has(p) || this.dirs.has(p)
  }
  isDir(p: string) {
    return this.dirs.has(p)
  }
  list(dir: string): NotesFsEntry[] {
    if (!this.dirs.has(dir)) throw new Error(`ENOENT ${dir}`)
    const out: NotesFsEntry[] = []
    for (const d of this.dirs) if (d !== '/' && this.parent(d) === dir) out.push({ path: d, name: d.slice(d.lastIndexOf('/') + 1), type: 'dir', size: 0, mtime: 0, ctime: 0 })
    for (const [f, data] of this.files) if (this.parent(f) === dir) out.push({ path: f, name: f.slice(f.lastIndexOf('/') + 1), type: 'file', size: data.length, mtime: this.times.get(f)!, ctime: 0 })
    return out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)))
  }
  async readText(p: string) {
    return new TextDecoder().decode(await this.readBytes(p))
  }
  async readBytes(p: string) {
    const d = this.files.get(p)
    if (!d) throw new Error(`ENOENT ${p}`)
    return d
  }
  async writeText(p: string, t: string, o: { mkdirs?: boolean } = {}) {
    return this.writeBytes(p, new TextEncoder().encode(t), o)
  }
  async writeBytes(p: string, d: Uint8Array, o: { mkdirs?: boolean } = {}) {
    if (o.mkdirs) await this.mkdir(this.parent(p), { recursive: true })
    if (!this.dirs.has(this.parent(p))) throw new Error(`ENOENT ${this.parent(p)}`)
    this.files.set(p, d)
    this.times.set(p, ++this.clock)
  }
  async mkdir(p: string, o: { recursive?: boolean } = {}) {
    if (this.dirs.has(p)) return
    if (!this.dirs.has(this.parent(p))) {
      if (!o.recursive) throw new Error(`ENOENT ${this.parent(p)}`)
      await this.mkdir(this.parent(p), o)
    }
    this.dirs.add(p)
  }
  async remove(p: string, o: { recursive?: boolean } = {}) {
    if (this.files.delete(p)) return
    if (!this.dirs.has(p)) throw new Error(`ENOENT ${p}`)
    const inside = [...this.files.keys(), ...this.dirs].filter((x) => x.startsWith(p + '/'))
    if (inside.length && !o.recursive) throw new Error('ENOTEMPTY')
    for (const x of inside) {
      this.files.delete(x)
      this.dirs.delete(x)
    }
    this.dirs.delete(p)
  }
  async rename(a: string, b: string) {
    if (this.exists(b)) throw new Error(`EEXIST ${b}`)
    if (this.files.has(a)) {
      this.files.set(b, this.files.get(a)!)
      this.times.set(b, this.times.get(a)!)
      this.files.delete(a)
      return
    }
    for (const d of [...this.dirs]) if (d === a || d.startsWith(a + '/')) {
      this.dirs.delete(d)
      this.dirs.add(b + d.slice(a.length))
    }
    for (const [f, data] of [...this.files]) if (f.startsWith(a + '/')) {
      this.files.delete(f)
      this.files.set(b + f.slice(a.length), data)
      this.times.set(b + f.slice(a.length), this.times.get(f)!)
    }
  }
  text(p: string) {
    return new TextDecoder().decode(this.files.get(p)!)
  }
}

const ROOT = '/home/user/Notes'
const DAY = 86_400_000

async function freshLibrary(now = () => Date.parse('2026-10-08T10:00:00Z')) {
  const fs = new MemFs()
  await fs.mkdir('/home/user', { recursive: true })
  const lib = new NotesLibrary(fs, ROOT, now)
  await lib.load()
  return { fs, lib }
}

// ------------------------------------------------------------ front matter

test('front matter: written and read back, unknown keys kept', () => {
  const text = serializeNoteFile(
    { id: 'n-1', created: '2026-10-08T09:00:00.000Z', modified: '2026-10-08T09:30:00.000Z', pinned: true, tags: ['work', 'ideas'], extra: [['author', 'Ada']] },
    'Shopping\n- [ ] milk #home\n',
  )
  assert.equal(
    text,
    '---\nid: n-1\ncreated: 2026-10-08T09:00:00.000Z\nmodified: 2026-10-08T09:30:00.000Z\npinned: true\ntags: [work, ideas]\nauthor: Ada\n---\nShopping\n- [ ] milk #home\n',
  )
  const back = parseNoteFile(text)
  assert.equal(back.hadHeader, true)
  assert.equal(back.header.id, 'n-1')
  assert.equal(back.header.pinned, true)
  assert.deepEqual(back.header.tags, ['work', 'ideas'])
  assert.deepEqual(back.header.extra, [['author', 'Ada']])
  assert.equal(back.body, 'Shopping\n- [ ] milk #home\n')
})

test('front matter: a file without one, YAML block lists, quotes, CRLF', () => {
  assert.deepEqual(parseNoteFile('# Just text\n'), { header: {}, body: '# Just text\n', hadHeader: false })
  const p = parseNoteFile('---\r\ntags:\r\n  - a\r\n  - "b c"\r\npinned: yes\r\nfolder: "Work: 2026"\r\n---\r\nBody')
  assert.deepEqual(p.header.tags, ['a', 'b c'])
  assert.equal(p.header.pinned, true)
  assert.equal(p.header.folder, 'Work: 2026')
  assert.equal(p.body, 'Body')
  // Values that YAML would misread are quoted.
  const t = serializeNoteFile({ id: 'n-2', deleted: '2026-10-01T00:00:00.000Z', folder: 'Work: 2026' }, 'x')
  assert.match(t, /folder: "Work: 2026"/)
  assert.equal(parseNoteFile(t).header.folder, 'Work: 2026')
})

// ------------------------------------------------------------ Markdown

const RICH: JNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Trip to Brest' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Some ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'gone', marks: [{ type: 'strike' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'x = 1', marks: [{ type: 'code' }] },
        { type: 'text', text: ' and a ' },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.org/a b' } }] },
        { type: 'text', text: ' #travel' },
      ],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tickets' }] }] },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Pack' }] },
            { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Raincoat' }] }] }] },
          ],
        },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }] },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print("hi")\n# not a heading' }] },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Day' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan' }] }] }] },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mon' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Port | lighthouse' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Dinner' }] }] },
          ],
        },
      ],
    },
    { type: 'image', attrs: { src: 'Attachments/beach photo.png', alt: 'Beach', title: null } },
    { type: 'attachment', attrs: { src: 'Attachments/tickets.pdf', name: 'tickets.pdf' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }, { type: 'hardBreak' }, { type: 'text', text: '# still text, 1. not a list, *stars* and snake_case' }] },
  ],
}

test('Markdown: what a rich note looks like on disk', () => {
  const md = docToMarkdown(RICH)
  assert.equal(
    md,
    [
      '# Trip to Brest',
      '',
      'Some **bold**, *italic*, <u>under</u>, ~~gone~~, `x = 1` and a [link](https://example.org/a%20b) #travel',
      '',
      '- [x] Tickets',
      '- [ ] Pack',
      '  - [ ] Raincoat',
      '',
      '* one',
      '',
      '3. three',
      '',
      '> Quoted',
      '',
      '```python',
      'print("hi")',
      '# not a heading',
      '```',
      '',
      '---',
      '',
      '| Day | Plan |',
      '| --- | --- |',
      '| Mon | Port \\| lighthouse<br>Dinner |',
      '',
      '![Beach](Attachments/beach%20photo.png)',
      '',
      '[tickets.pdf](Attachments/tickets.pdf)',
      '',
      'Line one\\',
      '\\# still text, 1. not a list, \\*stars\\* and snake_case',
      '',
    ].join('\n'),
  )
})

test('Markdown: a rich note comes back the same', () => {
  const back = markdownToDoc(docToMarkdown(RICH))
  // Links come back decoded only for files next to the note; web addresses stay as written.
  const expected = JSON.parse(JSON.stringify(RICH).replace('https://example.org/a b', 'https://example.org/a%20b'))
  assert.deepEqual(back, expected)
  assert.equal(docToMarkdown(back), docToMarkdown(RICH))
})

test('Markdown: marks hug the text, nested marks, empty note', () => {
  const doc: JNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a ' },
          { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'text', text: ' end' },
        ],
      },
      { type: 'paragraph' },
    ],
  }
  const md = docToMarkdown(doc)
  assert.equal(md, 'a **bold *both*** end\n')
  assert.deepEqual(markdownToDoc(md).content![0].content, [
    { type: 'text', text: 'a ' },
    { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
    { type: 'text', text: ' end' },
  ])
  assert.equal(docToMarkdown({ type: 'doc', content: [{ type: 'paragraph' }] }), '')
  assert.deepEqual(markdownToDoc(''), { type: 'doc', content: [{ type: 'paragraph' }] })
})

test('Markdown: files written by other editors', () => {
  const doc = markdownToDoc('Title\n\n* a\n* b\n\n1) x\n\n- [X] done\n- not a task\n\nText with ![pic](Attachments/p.png) inside\n\n&amp; &lt;b&gt;\n')
  const types = doc.content!.map((n) => n.type)
  assert.deepEqual(types, ['paragraph', 'bulletList', 'orderedList', 'taskList', 'paragraph', 'image', 'paragraph'])
  assert.equal(doc.content![3].content![0].attrs!.checked, true)
  assert.equal(doc.content![3].content![1].attrs!.checked, false)
  assert.equal(docToPlain({ type: 'doc', content: [doc.content![6]] }), '& <b>')
})

test('plain text: checklists, lists and tables', () => {
  const plain = docToPlain(RICH)
  assert.match(plain, /^Trip to Brest\n/)
  assert.match(plain, /☑ Tickets\n☐ Pack\n {2}☐ Raincoat/)
  assert.match(plain, /3\. three/)
  assert.match(plain, /Mon\tPort \| lighthouse Dinner/)
  assert.doesNotMatch(docToPlain(RICH, { markers: false }), /☑/)
})

test('the editor (TipTap schema) accepts every document the parser makes, and gives it back unchanged', async () => {
  // editor.ts imports its neighbours without ".ts" (Vite resolves it): teach Node the same.
  register(
    'data:text/javascript,' +
      encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (e) {
    if (/^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + '.ts', context)
    throw e
  }
}`),
  )
  const { getSchema } = await import('@tiptap/core')
  const { Node } = await import('@tiptap/pm/model')
  const { notesExtensions } = await import('../../src/apps/notes/editor.ts')
  const schema = getSchema(notesExtensions({} as never))
  const md = docToMarkdown(RICH)
  const doc = Node.fromJSON(schema, markdownToDoc(md))
  doc.check()
  // The editor's JSON has every attribute filled in; the Markdown is the same.
  assert.equal(docToMarkdown(doc.toJSON() as JNode), md)
})

test('checklist items: numbered in reading order, ticked by number', () => {
  const doc = markdownToDoc('Trip\n\n- [x] Tickets\n- [ ] Pack\n  - [ ] Raincoat\n\n- [ ] Taxi\n')
  assert.deepEqual(checklistItems(doc), [
    { index: 1, text: 'Tickets', checked: true },
    { index: 2, text: 'Pack', checked: false },
    { index: 3, text: 'Raincoat', checked: false },
    { index: 4, text: 'Taxi', checked: false },
  ])
  const md = docToMarkdown(setChecklistItem(doc, 3, true))
  // (A blank line between items of one list does not split it.)
  assert.equal(md, 'Trip\n\n- [x] Tickets\n- [ ] Pack\n  - [x] Raincoat\n- [ ] Taxi\n')
  assert.throws(() => setChecklistItem(doc, 9, true), /no checklist item 9/)
})

// ------------------------------------------------------------ titles, tags, names

test('the first line is the title; tags are #words', () => {
  const s = summarize('- [ ] Buy milk #home\n- [x] Call Bob\n\nMore text #Work, #2 #co-op')
  assert.equal(s.title, 'Buy milk #home')
  assert.equal(s.preview, 'Call Bob More text #Work, #2 #co-op')
  assert.deepEqual(s.tags, ['home', 'work', 'co-op'])
  assert.deepEqual(tagsIn('# Heading\nissue#3 http://x.org/#frag (#idée)'), ['idée'])
  assert.equal(summarize('').title, '')
})

test('file names from titles', () => {
  assert.equal(fileStem('  Plans: 2026/27 <draft>?  '), 'Plans 2026 27 draft')
  assert.equal(fileStem(''), 'New Note')
  assert.equal(fileStem('...hidden'), 'hidden')
  assert.equal(fileStem('x'.repeat(200)).length, 80)
  assert.ok(nameFitsTitle('Plans.md', 'Plans'))
  assert.ok(nameFitsTitle('Plans 2.md', 'Plans'))
  assert.ok(!nameFitsTitle('Plans.md', 'Plan'))
  assert.equal(folderNameProblem('Attachments'), '"Attachments" is kept for the app\'s own use.')
  assert.equal(folderNameProblem('a/b'), 'Folder names cannot contain \\ / : * ? " < > |')
  assert.equal(folderNameProblem('Work'), null)
})

test('attachment links are found and rewritten', () => {
  const body = '![a](Attachments/a%20b.png)\n\n[f](Attachments/f.pdf "x")\n\n[w](https://x.org) [h](#top)'
  assert.deepEqual(localLinks(body), ['Attachments/a b.png', 'Attachments/f.pdf'])
  assert.equal(relinkMarkdown(body, 'Attachments/a b.png', 'Attachments/a b 2.png').split('\n')[0], '![a](Attachments/a%20b%202.png)')
  assert.match(relinkMarkdown(body, 'Attachments/f.pdf', 'Attachments/g.pdf'), /\[f\]\(Attachments\/g\.pdf "x"\)/)
})

test('Recently Deleted keeps notes 30 days', () => {
  const now = Date.parse('2026-10-31T00:00:00Z')
  assert.equal(daysLeft('2026-10-30T00:00:00Z', now), 29)
  assert.equal(daysLeft('2026-10-01T00:00:00Z', now), 0)
  assert.equal(daysLeft(undefined, now), 30)
})

// ------------------------------------------------------------ the library

test('library: first run makes ~/Notes with a welcome note', async () => {
  const { fs, lib } = await freshLibrary()
  assert.ok(fs.isDir(ROOT))
  const all = lib.all()
  assert.equal(all.length, 1)
  assert.equal(all[0].title, 'Welcome to Notes')
  assert.equal(all[0].path, `${ROOT}/Welcome to Notes.md`)
  assert.deepEqual(all[0].tags, ['notes'])
})

test('library: create, type a title, the file follows; pin; sort', async () => {
  let t = Date.parse('2026-10-08T10:00:00Z')
  const { fs, lib } = await freshLibrary(() => (t += 1000))
  const n = await lib.create('')
  assert.equal(n.path, `${ROOT}/New Note.md`)
  const saved = await lib.save(n.id, 'Groceries\n\n- [ ] eggs #home\n')
  assert.equal(saved.path, `${ROOT}/Groceries.md`)
  assert.ok(!fs.exists(`${ROOT}/New Note.md`))
  const file = parseNoteFile(fs.text(saved.path))
  assert.equal(file.header.id, n.id)
  assert.deepEqual(file.header.tags, ['home'])
  assert.equal(file.body, 'Groceries\n\n- [ ] eggs #home\n')
  // Same title again: "Groceries 2.md", and it keeps that name while the title stays.
  const other = await lib.create('', 'Groceries\n')
  assert.equal(other.path, `${ROOT}/Groceries 2.md`)
  assert.equal((await lib.save(other.id, 'Groceries\nmore\n')).path, `${ROOT}/Groceries 2.md`)
  await lib.setPinned(other.id, true)
  assert.match(fs.text(`${ROOT}/Groceries 2.md`), /\npinned: true\n/)
  const order = lib.list({ kind: 'all' }, 'title').map((x) => x.path)
  assert.equal(order[0], `${ROOT}/Groceries 2.md`, 'pinned first')
  assert.deepEqual(sortNotes(lib.all(), 'title', false).map((x) => x.title), ['Groceries', 'Groceries', 'Welcome to Notes'])
  // An empty new note leaves no file behind.
  const empty = await lib.create('')
  assert.equal(await lib.discardIfEmpty(empty.id), true)
  assert.ok(!fs.exists(empty.path))
})

test('library: search and tags', async () => {
  const { lib } = await freshLibrary()
  await lib.create('', 'Trip\nBrest in May #travel\n')
  await lib.create('', 'Budget\nmay costs #money\n')
  assert.deepEqual(lib.list({ kind: 'all' }, 'title', 'may').map((n) => n.title), ['Budget', 'Trip'])
  assert.deepEqual(lib.list({ kind: 'all' }, 'title', 'may #travel').map((n) => n.title), ['Trip'])
  assert.deepEqual(lib.list({ kind: 'tag', tag: 'money' }, 'title').map((n) => n.title), ['Budget'])
  assert.deepEqual(lib.tags(), [['money', 1], ['notes', 1], ['travel', 1]])
  assert.equal(lib.find('trip')?.title, 'Trip')
  assert.equal(lib.find('nothing like it'), undefined)
})

test('library: folders, moving with attachments, Recently Deleted and restore', async () => {
  const { fs, lib } = await freshLibrary()
  assert.equal(await lib.createFolder('', 'Work'), 'Work')
  assert.equal(await lib.createFolder('Work', 'Projects'), 'Work/Projects')
  await assert.rejects(lib.createFolder('', 'Work'), /already a folder/)
  await assert.rejects(lib.createFolder('', 'Recently Deleted'), /kept for the app/)
  const n = await lib.create('Work', 'Plan\n')
  const link = await lib.addAttachment(n.id, 'chart.png', new Uint8Array([1, 2, 3]))
  assert.equal(link, 'Attachments/chart.png')
  await lib.save(n.id, `Plan\n\n![chart](${link})\n`)
  assert.ok(fs.exists(`${ROOT}/Work/Attachments/chart.png`))
  assert.deepEqual(lib.folders(), ['Work', 'Work/Projects'])
  assert.equal(lib.counts().get('Work'), 1)

  const moved = await lib.move(n.id, 'Work/Projects')
  assert.equal(moved.path, `${ROOT}/Work/Projects/Plan.md`)
  assert.ok(fs.exists(`${ROOT}/Work/Projects/Attachments/chart.png`))
  assert.ok(!fs.exists(`${ROOT}/Work/Attachments/chart.png`))

  const gone = await lib.trash(n.id)
  assert.equal(gone.path, `${ROOT}/Recently Deleted/Plan.md`)
  assert.equal(gone.from, 'Work/Projects')
  assert.ok(fs.exists(`${ROOT}/Recently Deleted/Attachments/chart.png`))
  const header = parseNoteFile(fs.text(gone.path)).header
  assert.equal(header.folder, 'Work/Projects')
  assert.ok(header.deleted)
  assert.deepEqual(lib.list({ kind: 'trash' }, 'modified').map((x) => x.id), [n.id])
  assert.deepEqual(lib.list({ kind: 'all' }, 'modified', 'plan'), [], 'search skips Recently Deleted')
  await assert.rejects(lib.save(n.id, 'x'), /Recently Deleted/)

  const back = await lib.restore(n.id)
  assert.equal(back.path, `${ROOT}/Work/Projects/Plan.md`)
  assert.equal(back.deleted, undefined)
  assert.doesNotMatch(fs.text(back.path), /deleted:|folder:/)
  assert.ok(fs.exists(`${ROOT}/Work/Projects/Attachments/chart.png`))
})

test('library: duplicate copies attachments; delete for good removes them', async () => {
  const { fs, lib } = await freshLibrary()
  const n = await lib.create('', 'Pic\n')
  const link = await lib.addAttachment(n.id, 'a.png', new Uint8Array([9]))
  await lib.save(n.id, `Pic\n\n![a](${link})\n`)
  const copy = await lib.duplicate(n.id)
  assert.notEqual(copy.id, n.id)
  assert.equal(copy.path, `${ROOT}/Pic 2.md`)
  assert.match(copy.body, /Attachments\/a%202\.png/)
  assert.ok(fs.exists(`${ROOT}/Attachments/a 2.png`))
  await lib.trash(copy.id)
  await lib.destroy(copy.id)
  assert.ok(!fs.exists(`${ROOT}/Recently Deleted/Pic.md`))
  assert.ok(!fs.exists(`${ROOT}/Recently Deleted/Attachments/a 2.png`))
  assert.ok(fs.exists(`${ROOT}/Attachments/a.png`), 'the original keeps its picture')
})

test('library: rename and delete folders', async () => {
  const { fs, lib } = await freshLibrary()
  await lib.createFolder('', 'Old')
  await lib.createFolder('Old', 'Sub')
  const a = await lib.create('Old', 'A\n')
  const b = await lib.create('Old/Sub', 'B\n')
  await lib.trash(b.id)
  assert.equal(await lib.renameFolder('Old', 'New'), 'New')
  assert.deepEqual(lib.folders(), ['New', 'New/Sub'])
  assert.equal(lib.get(a.id)!.path, `${ROOT}/New/A.md`)
  assert.equal(lib.get(b.id)!.from, 'New/Sub', 'deleted notes remember the new name')
  await fs.writeText(`${ROOT}/New/notes.txt`, 'not a note')
  assert.deepEqual(lib.folderContents('New'), { notes: 1, folders: 1, otherFiles: 1 })
  assert.equal(await lib.deleteFolder('New'), 1)
  assert.ok(!fs.exists(`${ROOT}/New`))
  assert.deepEqual(lib.folders(), [])
  assert.equal(lib.get(a.id)!.folder, 'Recently Deleted')
  assert.equal(lib.get(a.id)!.from, 'New')
  // Restoring into a folder that is gone makes it again.
  const r = await lib.restore(a.id)
  assert.equal(r.path, `${ROOT}/New/A.md`)
  assert.deepEqual(lib.folders(), ['New'])
})

test('library: files changed by other apps are read again', async () => {
  const { fs, lib } = await freshLibrary()
  const n = await lib.create('', 'Mine\n')
  // Notepad edits the file; Files adds a note without front matter.
  await fs.writeText(n.path, fs.text(n.path).replace('Mine\n', 'Mine\nedited elsewhere\n'))
  await fs.writeText(`${ROOT}/From Files.md`, 'From Files\nhello #imported\n')
  const changed = await lib.refresh()
  assert.deepEqual(changed, [n.id])
  assert.equal(lib.get(n.id)!.preview, 'edited elsewhere')
  const imported = lib.byPath(`${ROOT}/From Files.md`)!
  assert.ok(imported.id.startsWith('p:'))
  assert.deepEqual(imported.tags, ['imported'])
  // Its first save gives it an id of its own.
  const saved = await lib.save(imported.id, 'From Files\nhello again #imported\n')
  assert.ok(!saved.id.startsWith('p:'))
  assert.match(fs.text(saved.path), /^---\nid: n-/)
  // A note deleted in Files is gone.
  await fs.remove(n.path)
  assert.deepEqual(await lib.refresh(), [n.id])
  assert.equal(lib.get(n.id), undefined)
})

test('library: notes older than 30 days in Recently Deleted are deleted when it opens', async () => {
  const fs = new MemFs()
  await fs.mkdir(`${ROOT}/Recently Deleted`, { recursive: true })
  await fs.writeText(`${ROOT}/Recently Deleted/Old.md`, serializeNoteFile({ id: 'n-old', deleted: '2026-09-01T00:00:00.000Z', folder: '' }, 'Old\n'))
  await fs.writeText(`${ROOT}/Recently Deleted/Recent.md`, serializeNoteFile({ id: 'n-new', deleted: '2026-10-07T00:00:00.000Z', folder: '' }, 'Recent\n'))
  const lib = new NotesLibrary(fs, ROOT, () => Date.parse('2026-10-08T00:00:00Z'))
  await lib.load()
  assert.ok(!fs.exists(`${ROOT}/Recently Deleted/Old.md`))
  assert.deepEqual(lib.all().map((n) => n.id), ['n-new'])
  assert.equal(daysLeft(lib.get('n-new')!.deleted, Date.parse('2026-10-08T00:00:00Z') + DAY), 28)
})

// ------------------------------------------------------------ sync

test('sync plan: three-way, by content hash', () => {
  const plan = planSync(
    { 'same.md': 'h1', 'edited.md': 'L2', 'new-here.md': 'n1', 'both.md': 'L3', 'kept.md': 'k1', 'del-there.md': 'd1', 'edit-vs-del.md': 'e2' },
    { 'same.md': 'h1', 'edited.md': 'e1', 'new-there.md': 'r1', 'both.md': 'R3', 'del-here.md': 'x1', 'edit-vs-del.md': null, 'gone.md': null },
    { 'same.md': 'h1', 'edited.md': 'e1', 'both.md': 'b0', 'kept.md': 'k1', 'del-there.md': 'd1', 'del-here.md': 'x1', 'edit-vs-del.md': 'e1' },
  )
  assert.deepEqual(plan.upload.sort(), ['del-there.md', 'edit-vs-del.md', 'edited.md', 'kept.md', 'new-here.md'])
  assert.deepEqual(plan.download.sort(), ['new-there.md'])
  assert.deepEqual(plan.deleteRemote.sort(), ['del-here.md'])
  assert.deepEqual(plan.deleteLocal.sort(), [])
  assert.deepEqual(plan.conflicts, ['both.md'])
  // Missing on the server without a tombstone (a new server, a lost file): sent again, never deleted here.
  assert.equal(plan.base['same.md'], 'h1')
  assert.ok(!('gone.md' in plan.base))
})

test('sync plan: deletions both ways', () => {
  const plan = planSync({ 'a.md': 'a1' }, { 'a.md': null, 'b.md': 'b1' }, { 'a.md': 'a1', 'b.md': 'b1' })
  assert.deepEqual(plan.deleteLocal, ['a.md'])
  assert.deepEqual(plan.deleteRemote, ['b.md'], 'deleted here, unchanged there: delete there')
  assert.deepEqual(plan.download, [])
  // Edited there while deleted here: the edit wins.
  assert.deepEqual(planSync({}, { 'c.md': 'c2' }, { 'c.md': 'c1' }).download, ['c.md'])
})
