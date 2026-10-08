// Notes' AI tools (notes_list, _read, _create, _append, _set_checklist_item,
// _move, _delete): names, arguments and descriptions are in
// src/os/ai/manifests/notes.ts; Notes.tsx registers these with useAppTools.
// They work on the library (the files in ~/Notes); the window shows the result.

import { clipText, type AppTools } from '@/os/ai/appTools'
import { pretty } from '@/os/path'
import { library } from './store'
import { TRASH, type Note } from './library'
import { checklistItems, docToMarkdown, markdownToDoc, setChecklistItem } from './markdown'

export interface NotesUi {
  /** Show a note in the window. */
  show(id: string): void
  /** Write what is typed in the open note now (before a tool reads or changes it). */
  flush(): Promise<void>
}

const MAX_READ = 40_000

/** "Notes" / "" = the top folder; "Work / Projects" = "Work/Projects". */
function folderArg(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^~\/Notes\/?/, '').replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '')
  return s.toLowerCase() === 'notes' ? '' : s
}

const folderName = (f: string) => (f === '' ? 'Notes' : f === TRASH ? 'Recently Deleted' : f)

function summary(n: Note) {
  return {
    id: n.id,
    title: n.title || 'New Note',
    folder: folderName(n.deleted ? TRASH : n.folder),
    modified: n.modified,
    created: n.created,
    ...(n.pinned && { pinned: true }),
    ...(n.tags.length && { tags: n.tags }),
    ...(n.deleted && { deleted: n.deleted, from: folderName(n.from ?? '') }),
    preview: clipText(n.preview, 120),
  }
}

function need(ref: unknown): Note {
  const r = String(ref ?? '').trim()
  if (!r) throw new Error('Say which note: its id or title (notes_list shows them).')
  const n = library.find(r)
  if (n) return n
  const lower = r.toLowerCase()
  const some = library.all().filter((x) => !x.deleted && x.title.toLowerCase().includes(lower))
  if (some.length > 1) throw new Error(`Several notes match "${r}": ${some.slice(0, 8).map((x) => `"${x.title}" (${x.id})`).join(', ')}. Give the id.`)
  throw new Error(`No note "${r}". notes_list shows the notes.`)
}

/** A folder by name, made if missing (each level checked). */
async function ensureFolder(folder: string): Promise<string> {
  if (!folder || library.folders().includes(folder)) return folder
  const match = library.folders().find((f) => f.toLowerCase() === folder.toLowerCase())
  if (match) return match
  let parent = ''
  for (const part of folder.split('/')) {
    const next = parent ? `${parent}/${part}` : part
    const existing = library.folders().find((f) => f.toLowerCase() === next.toLowerCase())
    parent = existing ?? (await library.createFolder(parent, part))
  }
  return parent
}

export function notesAiTools(ui: NotesUi): AppTools {
  const ready = async () => {
    if (!library.loaded) await library.load()
    await ui.flush()
  }

  return {
    async list(a) {
      await ready()
      const limit = Math.max(1, Math.min(200, Number(a.limit) || 50))
      const query = String(a.query ?? '')
      const view = a.deleted === true
        ? { kind: 'trash' as const }
        : a.tag
          ? { kind: 'tag' as const, tag: String(a.tag).replace(/^#/, '').toLowerCase() }
          : a.folder !== undefined && a.folder !== ''
            ? { kind: 'folder' as const, folder: folderArg(a.folder) }
            : { kind: 'all' as const }
      if (view.kind === 'folder' && view.folder && !library.folders().includes(view.folder)) {
        throw new Error(`There is no folder "${String(a.folder)}". Folders: Notes${library.folders().map((f) => `, ${f}`).join('')}.`)
      }
      let notes = library.list(view, 'modified', query)
      if (query && view.kind === 'folder') notes = notes.filter((n) => n.folder === view.folder)
      const counts = library.counts()
      return {
        folders: [{ name: 'Notes', notes: counts.get('') ?? 0 }, ...library.folders().map((f) => ({ name: f, notes: counts.get(f) ?? 0 })), { name: 'Recently Deleted', notes: counts.get(TRASH) ?? 0 }],
        tags: library.tags().map(([t, n]) => ({ tag: t, notes: n })),
        total: notes.length,
        notes: notes.slice(0, limit).map(summary),
        ...(notes.length > limit && { more: notes.length - limit }),
        storage: pretty(library.root),
      }
    },

    async read(a) {
      await ready()
      const n = need(a.note)
      ui.show(n.id)
      const items = checklistItems(markdownToDoc(n.body))
      return {
        ...summary(n),
        file: pretty(n.path),
        markdown: clipText(n.body, MAX_READ),
        ...(n.body.length > MAX_READ && { truncated: true }),
        ...(items.length && { checklist: items.map((i) => ({ item: i.index, text: i.text, checked: i.checked })) }),
      }
    },

    async create(a) {
      await ready()
      const text = String(a.text ?? '').replace(/\r\n?/g, '\n').trim()
      if (!text) throw new Error('"text" is empty: give the note in Markdown, title first.')
      const folder = await ensureFolder(folderArg(a.folder))
      const n = await library.create(folder, text + '\n', { pinned: a.pinned === true })
      ui.show(n.id)
      return { created: summary(n), file: pretty(n.path) }
    },

    async append(a) {
      await ready()
      const n = need(a.note)
      if (n.deleted) throw new Error(`"${n.title}" is in Recently Deleted: restore it first (notes_move).`)
      const add = String(a.text ?? '').replace(/\r\n?/g, '\n').trim()
      if (!add) throw new Error('"text" is empty.')
      const body = n.body.replace(/\s+$/, '')
      // A list item after a list joins it; anything else is a new paragraph.
      const joins = /^\s*([-*+]|\d+[.)])\s/.test(add) && /(^|\n)\s*([-*+]|\d+[.)])\s[^\n]*$/.test(body)
      const saved = await library.save(n.id, `${body}${body ? (joins ? '\n' : '\n\n') : ''}${add}\n`)
      ui.show(saved.id)
      return { appended: true, note: summary(saved) }
    },

    async set_checklist_item(a) {
      await ready()
      const n = need(a.note)
      if (n.deleted) throw new Error(`"${n.title}" is in Recently Deleted: restore it first (notes_move).`)
      const doc = markdownToDoc(n.body)
      const items = checklistItems(doc)
      if (!items.length) throw new Error(`"${n.title}" has no checklist.`)
      const want = String(a.item ?? '').trim()
      let index = /^\d+$/.test(want) ? Number(want) : 0
      if (!index) {
        const lower = want.toLowerCase()
        const hits = items.filter((i) => i.text.toLowerCase() === lower)
        const loose = hits.length ? hits : items.filter((i) => i.text.toLowerCase().includes(lower))
        if (loose.length !== 1) {
          throw new Error(
            loose.length
              ? `Several items match "${want}": ${loose.map((i) => `${i.index}. ${i.text}`).join('; ')}. Give the number.`
              : `No item "${want}". Items: ${items.map((i) => `${i.index}. ${i.text}`).join('; ')}.`,
          )
        }
        index = loose[0].index
      }
      const checked = a.checked !== false
      const saved = await library.save(n.id, docToMarkdown(setChecklistItem(doc, index, checked)))
      ui.show(saved.id)
      const item = checklistItems(markdownToDoc(saved.body))[index - 1]
      return { item: index, text: item?.text, checked }
    },

    async move(a) {
      await ready()
      const n = need(a.note)
      const folder = await ensureFolder(folderArg(a.folder))
      const moved = n.deleted ? await library.restore(n.id, folder) : await library.move(n.id, folder)
      ui.show(moved.id)
      return { moved: summary(moved), file: pretty(moved.path) }
    },

    async delete(a, ctx) {
      await ready()
      const n = need(a.note)
      if (n.deleted) return { already: 'in Recently Deleted', note: summary(n) }
      if (!(await ctx.confirm(`move the note "${n.title || 'New Note'}" to Recently Deleted`, 'It is kept there 30 days and can be restored.'))) {
        throw new Error('The user did not allow deleting the note.')
      }
      const gone = await library.trash(n.id)
      return { deleted: summary(gone), restore_with: 'notes_move' }
    },
  }
}
