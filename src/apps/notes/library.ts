// Notes: the notes on the drive (see format.ts for the files). One library per
// page, shared by the Notes window and its AI tools. Every change goes
// through a queue, so saves, moves and re-scans never overlap; changes made
// by other apps (Files, Notepad, a sync) are picked up by `refresh()`.
//
// It talks to the drive through a small interface (NotesFs) that the KherveOS
// VFS fits, so Node tests can run it on an in-memory drive.

import { basename, dirname, join, isInside } from '../../os/path.ts'
import {
  TRASH, TRASH_DAYS, daysLeft, fileStem, folderNameProblem, localLinks, nameFitsTitle, newNoteId, parseNoteFile, relinkMarkdown,
  serializeNoteFile, summarize, type NoteHeader,
} from './format.ts'
import { ATTACHMENTS } from './markdown.ts'

export interface NotesFsEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
  ctime: number
}

/** What the library needs from the drive (the KherveOS VFS has all of it). */
export interface NotesFs {
  exists(p: string): boolean
  isDir(p: string): boolean
  list(dir: string): NotesFsEntry[]
  readText(p: string): Promise<string>
  writeText(p: string, text: string, opts?: { mkdirs?: boolean }): Promise<void>
  readBytes(p: string): Promise<Uint8Array>
  writeBytes(p: string, data: Uint8Array, opts?: { mkdirs?: boolean }): Promise<void>
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>
  remove(p: string, opts?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface Note {
  id: string
  path: string
  /** Its folder, relative to the Notes folder: "" is Notes itself, "Work/Projects" a subfolder, TRASH for Recently Deleted. */
  folder: string
  title: string
  preview: string
  /** Plain text of the whole note (search). */
  text: string
  tags: string[]
  /** The Markdown after the front matter. */
  body: string
  created: string
  modified: string
  pinned: boolean
  /** Recently Deleted only: when, and the folder it came from. */
  deleted?: string
  from?: string
  header: NoteHeader
  mtime: number
  size: number
}

export type NoteSort = 'modified' | 'created' | 'title'

export type NotesView =
  | { kind: 'all' }
  | { kind: 'folder'; folder: string }
  | { kind: 'trash' }
  | { kind: 'tag'; tag: string }

/** Pinned first (except in Recently Deleted), then by the chosen order. */
export function sortNotes(notes: Note[], sort: NoteSort, pinnedFirst = true): Note[] {
  const by = (a: Note, b: Note) => {
    if (sort === 'title') return (a.title || 'New Note').localeCompare(b.title || 'New Note', undefined, { sensitivity: 'base', numeric: true })
    const k = sort === 'created' ? 'created' : 'modified'
    return b[k] < a[k] ? -1 : b[k] > a[k] ? 1 : 0
  }
  return [...notes].sort((a, b) => (pinnedFirst && a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : by(a, b)))
}

/** Does a note match a search ("milk #home" = has "milk" and the tag home)? */
export function matchesQuery(note: Note, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = `${note.title}\n${note.text}`.toLowerCase()
  return words.every((w) => (w.startsWith('#') && w.length > 1 ? note.tags.includes(w.slice(1)) : hay.includes(w)))
}

const isNoteFile = (name: string) => /\.md$/i.test(name) && !name.startsWith('.')

export class NotesLibrary {
  readonly root: string
  private fs: NotesFs
  private now: () => number
  private notes = new Map<string, Note>()
  private folderList: string[] = []
  private listeners = new Set<() => void>()
  private version = 0
  private own = new Map<string, number>()
  private queue: Promise<unknown> = Promise.resolve()
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  loaded = false
  /** Called after a refresh that found notes changed by someone else (ids). */
  onExternalChange: ((ids: string[]) => void) | null = null

  constructor(fs: NotesFs, root: string, now: () => number = () => Date.now()) {
    this.fs = fs
    this.root = root
    this.now = now
  }

  // ------------------------------------------------------------ observing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = () => this.version

  private emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  /** Run one change at a time. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  /** Mark paths as written by the library while `fn` runs, so the drive's events about them are not "external". */
  private async owning<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    for (const p of paths) this.own.set(p, (this.own.get(p) ?? 0) + 1)
    try {
      return await fn()
    } finally {
      setTimeout(() => {
        for (const p of paths) {
          const n = (this.own.get(p) ?? 1) - 1
          if (n <= 0) this.own.delete(p)
          else this.own.set(p, n)
        }
      }, 0)
    }
  }

  /** A drive event: true when it is someone else's change inside the Notes folder (a refresh is scheduled). */
  noticeFsEvent(path: string, oldPath?: string): boolean {
    const inside = (p?: string) => !!p && isInside(p, this.root)
    if (!inside(path) && !inside(oldPath)) return false
    if (this.own.has(path) || (oldPath && this.own.has(oldPath))) return false
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh().then((ids) => {
        if (ids.length) this.onExternalChange?.(ids)
      })
    }, 200)
    return true
  }

  // ------------------------------------------------------------ reading

  dirOf(folder: string): string {
    return folder ? join(this.root, folder) : this.root
  }

  get trashDir(): string {
    return join(this.root, TRASH)
  }

  get(id: string): Note | undefined {
    return this.notes.get(id)
  }

  byPath(path: string): Note | undefined {
    for (const n of this.notes.values()) if (n.path === path) return n
    return undefined
  }

  all(): Note[] {
    return [...this.notes.values()]
  }

  /** User folders, relative paths, parents before children ("Work", "Work/Projects"). */
  folders(): string[] {
    return this.folderList
  }

  /** Notes directly in each folder (TRASH for Recently Deleted). */
  counts(): Map<string, number> {
    const m = new Map<string, number>()
    for (const n of this.notes.values()) m.set(n.folder, (m.get(n.folder) ?? 0) + 1)
    return m
  }

  /** Every tag, with how many notes (not deleted) have it. */
  tags(): [string, number][] {
    const m = new Map<string, number>()
    for (const n of this.notes.values()) if (!n.deleted) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }

  /** The notes of a view, filtered by a search and sorted. A search looks through every folder (not Recently Deleted). */
  list(view: NotesView, sort: NoteSort, query = ''): Note[] {
    const q = query.trim()
    let notes = this.all()
    if (q && view.kind !== 'trash') notes = notes.filter((n) => !n.deleted)
    else if (view.kind === 'trash') notes = notes.filter((n) => n.deleted)
    else if (view.kind === 'all') notes = notes.filter((n) => !n.deleted)
    else if (view.kind === 'folder') notes = notes.filter((n) => !n.deleted && n.folder === view.folder)
    else notes = notes.filter((n) => !n.deleted && n.tags.includes(view.tag))
    if (q) notes = notes.filter((n) => matchesQuery(n, q))
    return sortNotes(notes, sort, view.kind !== 'trash')
  }

  /** Find a note by id, or by title (exact, then the only one containing it). */
  find(ref: string): Note | undefined {
    const r = ref.trim()
    if (!r) return undefined
    const byId = this.notes.get(r)
    if (byId) return byId
    const live = this.all().filter((n) => !n.deleted)
    const lower = r.toLowerCase()
    const exact = live.filter((n) => n.title.toLowerCase() === lower)
    if (exact.length) return sortNotes(exact, 'modified', false)[0]
    const part = live.filter((n) => n.title.toLowerCase().includes(lower))
    return part.length === 1 ? part[0] : undefined
  }

  /** Where an attachment link of a note points on the drive. */
  resolve(note: Note, href: string): string {
    return join(dirname(note.path), href)
  }

  // ------------------------------------------------------------ scanning

  /** Read the Notes folder (first time: create it with a welcome note). */
  load(): Promise<string[]> {
    return this.run(() => this.scan())
  }

  /** Re-read what changed on the drive. Returns the ids whose text changed or that went away. */
  refresh(): Promise<string[]> {
    return this.run(() => this.scan())
  }

  private async scan(): Promise<string[]> {
    if (!this.fs.isDir(this.root)) {
      await this.owning([this.root], async () => {
        await this.fs.mkdir(this.root, { recursive: true })
        if (!this.loaded) await this.writeWelcome()
      })
    }
    const before = new Map(this.notes)
    const byPath = new Map<string, Note>()
    for (const n of this.notes.values()) byPath.set(n.path, n)
    const next = new Map<string, Note>()
    const folders: string[] = []
    const changed: string[] = []

    const readNote = async (e: NotesFsEntry, folder: string) => {
      const cached = byPath.get(e.path)
      let note: Note
      if (cached && cached.mtime === e.mtime && cached.size === e.size && cached.folder === folder) note = cached
      else {
        let text: string
        try {
          text = await this.fs.readText(e.path)
        } catch {
          return
        }
        note = this.makeNote(e, folder, text)
      }
      if (next.has(note.id)) note = { ...note, id: `p:${note.path}` }
      next.set(note.id, note)
      const old = before.get(note.id)
      if (old && (old.body !== note.body || old.path !== note.path)) changed.push(note.id)
    }

    const visit = async (dir: string, rel: string) => {
      let entries: NotesFsEntry[]
      try {
        entries = this.fs.list(dir)
      } catch {
        return
      }
      for (const e of entries) {
        if (e.type === 'dir') {
          if (e.name === ATTACHMENTS || e.name.startsWith('.')) continue
          if (!rel && e.name === TRASH) {
            for (const t of this.fs.list(e.path)) if (t.type === 'file' && isNoteFile(t.name)) await readNote(t, TRASH)
            continue
          }
          const sub = rel ? `${rel}/${e.name}` : e.name
          folders.push(sub)
          await visit(e.path, sub)
        } else if (isNoteFile(e.name)) {
          await readNote(e, rel)
        }
      }
    }
    await visit(this.root, '')

    for (const id of before.keys()) if (!next.has(id)) changed.push(id)
    this.notes = next
    this.folderList = folders
    const wasLoaded = this.loaded
    this.loaded = true
    if (!wasLoaded) await this.purgeExpired()
    this.emit()
    return changed
  }

  private makeNote(e: { path: string; mtime: number; ctime: number; size: number }, folder: string, text: string): Note {
    const { header, body } = parseNoteFile(text)
    const s = summarize(body)
    const iso = (t: number) => new Date(t).toISOString()
    return {
      id: header.id || `p:${e.path}`,
      path: e.path,
      folder,
      title: s.title,
      preview: s.preview,
      text: s.text,
      tags: s.tags,
      body,
      created: header.created || iso(e.ctime),
      modified: header.modified || iso(e.mtime),
      pinned: !!header.pinned,
      ...(folder === TRASH && { deleted: header.deleted || iso(e.mtime), from: header.folder ?? '' }),
      header,
      mtime: e.mtime,
      size: e.size,
    }
  }

  /** Read one note file back after the library wrote it (keeps the cache in step with the drive). */
  private restat(note: Note, text: string): Note {
    const dir = dirname(note.path)
    const e = this.fs.list(dir).find((x) => x.path === note.path)
    const fresh = this.makeNote({ path: note.path, mtime: e?.mtime ?? this.now(), ctime: e?.ctime ?? this.now(), size: e?.size ?? text.length }, note.folder, text)
    return { ...fresh, id: note.id }
  }

  private async writeWelcome() {
    // The same bytes on every computer, so syncing two fresh computers is no conflict.
    const when = '2026-10-08T00:00:00.000Z'
    const body = [
      '# Welcome to Notes',
      '',
      'Your notes are plain Markdown files in **~/Notes**: you can see them in Files and open them in Notepad. The first line of a note is its title.',
      '',
      '- [x] Write a note: ⌘N (or File › New Note)',
      '- [ ] Make a checklist: ⌘⇧L',
      '- [ ] Tag it (type # and a word), pin it, put it in a folder',
      '- [ ] Drag a picture or a file from Files into a note',
      '',
      'Deleted notes stay 30 days in **Recently Deleted**. #notes',
      '',
    ].join('\n')
    await this.fs.writeText(join(this.root, 'Welcome to Notes.md'), serializeNoteFile({ id: 'n-welcome', created: when, modified: when, tags: ['notes'] }, body))
  }

  // ------------------------------------------------------------ helpers

  private uniquePath(dir: string, stem: string, ext: string, except?: string): string {
    for (let i = 1; ; i++) {
      const p = join(dir, `${stem}${i === 1 ? '' : ` ${i}`}${ext}`)
      if (p === except || !this.fs.exists(p)) return p
    }
  }

  private iso() {
    return new Date(this.now()).toISOString()
  }

  private noteText(note: Note): string {
    const header: NoteHeader = {
      ...note.header,
      id: note.id.startsWith('p:') ? undefined : note.id,
      created: note.created,
      modified: note.modified,
      pinned: note.pinned,
      tags: note.tags,
      deleted: note.deleted,
      folder: note.deleted ? (note.from ?? '') : undefined,
    }
    return serializeNoteFile(header, note.body)
  }

  /** Write a note (and give a path-only note a real id). */
  private async write(note: Note): Promise<Note> {
    const n = note.id.startsWith('p:') ? { ...note, id: newNoteId(this.now()) } : note
    const text = this.noteText(n)
    await this.owning([n.path], () => this.fs.writeText(n.path, text, { mkdirs: true }))
    const fresh = this.restat(n, text)
    if (note.id !== fresh.id) this.notes.delete(note.id)
    this.notes.set(fresh.id, fresh)
    return fresh
  }

  /** Is this attachment (absolute path) linked from another note than `exceptId`? */
  private linkedElsewhere(abs: string, exceptId: string): boolean {
    for (const n of this.notes.values()) {
      if (n.id === exceptId) continue
      if (localLinks(n.body).some((l) => this.resolve(n, l) === abs)) return true
    }
    return false
  }

  /**
   * Move (or copy) a note's attachments from its folder to `toDir`; returns
   * the body with links rewritten where a name had to change.
   */
  private async carryAttachments(note: Note, toDir: string, mode: 'move' | 'copy'): Promise<string> {
    let body = note.body
    const fromDir = dirname(note.path)
    if (fromDir === toDir && mode === 'move') return body
    for (const link of localLinks(note.body)) {
      if (!link.startsWith(`${ATTACHMENTS}/`)) continue
      const src = join(fromDir, link)
      if (!this.fs.exists(src) || this.fs.isDir(src)) continue
      const name = basename(src)
      const dot = name.lastIndexOf('.')
      const dst = this.uniquePath(join(toDir, ATTACHMENTS), dot > 0 ? name.slice(0, dot) : name, dot > 0 ? name.slice(dot) : '')
      await this.owning([src, dst, join(toDir, ATTACHMENTS)], async () => {
        if (!this.fs.isDir(join(toDir, ATTACHMENTS))) await this.fs.mkdir(join(toDir, ATTACHMENTS), { recursive: true })
        if (mode === 'copy' || this.linkedElsewhere(src, note.id)) await this.fs.writeBytes(dst, await this.fs.readBytes(src))
        else await this.fs.rename(src, dst)
      })
      const rel = `${ATTACHMENTS}/${basename(dst)}`
      if (rel !== link) body = relinkMarkdown(body, link, rel)
    }
    return body
  }

  /** Move a note's file to another folder (attachments too). */
  private async relocate(note: Note, toFolder: string, header: Partial<Pick<Note, 'deleted' | 'from'>>): Promise<Note> {
    const toDir = toFolder === TRASH ? this.trashDir : this.dirOf(toFolder)
    await this.owning([toDir], () => this.fs.mkdir(toDir, { recursive: true }))
    const body = await this.carryAttachments(note, toDir, 'move')
    const to = this.uniquePath(toDir, fileStem(note.title || 'New Note'), '.md')
    await this.owning([note.path, to], () => this.fs.rename(note.path, to))
    const moved: Note = { ...note, path: to, folder: toFolder, body, deleted: header.deleted, from: header.from }
    return this.write(moved)
  }

  private async removeAttachments(note: Note) {
    for (const link of localLinks(note.body)) {
      if (!link.startsWith(`${ATTACHMENTS}/`)) continue
      const abs = this.resolve(note, link)
      if (this.fs.exists(abs) && !this.linkedElsewhere(abs, note.id)) await this.owning([abs], () => this.fs.remove(abs))
    }
  }

  private need(id: string): Note {
    const n = this.notes.get(id)
    if (!n) throw new Error('That note is gone (deleted or moved by another app).')
    return n
  }

  private checkFolder(folder: string) {
    if (folder && !this.folderList.includes(folder)) throw new Error(`There is no folder "${folder}".`)
  }

  // ------------------------------------------------------------ notes

  /** A new note in a folder ("" = Notes). An empty one is removed again by `discardIfEmpty`. */
  create(folder: string, body = '', opts: { pinned?: boolean } = {}): Promise<Note> {
    return this.run(async () => {
      this.checkFolder(folder)
      const s = summarize(body)
      const dir = this.dirOf(folder)
      const path = this.uniquePath(dir, fileStem(s.title || 'New Note'), '.md')
      const now = this.iso()
      const note: Note = {
        id: newNoteId(this.now()), path, folder, ...s, body, created: now, modified: now, pinned: !!opts.pinned, header: {}, mtime: 0, size: 0,
      }
      const saved = await this.write(note)
      this.emit()
      return saved
    })
  }

  /** New text for a note (auto-save): the file follows the title. */
  save(id: string, body: string): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      if (note.deleted) throw new Error('Notes in Recently Deleted cannot be edited: restore it first.')
      if (body === note.body && !note.id.startsWith('p:')) return note
      const s = summarize(body)
      let path = note.path
      if (!nameFitsTitle(basename(path), s.title || 'New Note')) {
        path = this.uniquePath(dirname(path), fileStem(s.title || 'New Note'), '.md', note.path)
        if (path !== note.path) await this.owning([note.path, path], () => this.fs.rename(note.path, path))
      }
      const saved = await this.write({ ...note, ...s, path, body, modified: this.iso() })
      this.emit()
      return saved
    })
  }

  setPinned(id: string, pinned: boolean): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      if (note.pinned === pinned) return note
      const saved = await this.write({ ...note, pinned })
      this.emit()
      return saved
    })
  }

  /** Remove a note that was never written in (no text): nothing to keep. */
  discardIfEmpty(id: string): Promise<boolean> {
    return this.run(async () => {
      const note = this.notes.get(id)
      if (!note || note.deleted || note.body.trim()) return false
      await this.owning([note.path], () => this.fs.remove(note.path))
      this.notes.delete(id)
      this.emit()
      return true
    })
  }

  move(id: string, folder: string): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      this.checkFolder(folder)
      if (note.deleted) throw new Error('Restore the note first.')
      if (note.folder === folder) return note
      const moved = await this.relocate(note, folder, {})
      this.emit()
      return moved
    })
  }

  /** To Recently Deleted (kept TRASH_DAYS days). */
  trash(id: string): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      if (note.deleted) return note
      const moved = await this.relocate(note, TRASH, { deleted: this.iso(), from: note.folder })
      this.emit()
      return moved
    })
  }

  /** Back from Recently Deleted to its folder (made again if it is gone). */
  restore(id: string, folder?: string): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      if (!note.deleted) return note
      let to = folder ?? note.from ?? ''
      if (to && folderNameProblemPath(to)) to = ''
      if (to && !this.folderList.includes(to)) this.addFolderPaths(to)
      const moved = await this.relocate(note, to, {})
      this.emit()
      return moved
    })
  }

  /** Delete for good (only from Recently Deleted). */
  destroy(id: string): Promise<void> {
    return this.run(async () => {
      const note = this.need(id)
      if (!note.deleted) throw new Error('Only notes in Recently Deleted can be deleted for good.')
      await this.removeAttachments(note)
      await this.owning([note.path], () => this.fs.remove(note.path))
      this.notes.delete(id)
      this.emit()
    })
  }

  emptyTrash(): Promise<number> {
    return this.run(async () => {
      let n = 0
      for (const note of this.all().filter((x) => x.deleted)) {
        await this.removeAttachments(note)
        await this.owning([note.path], () => this.fs.remove(note.path))
        this.notes.delete(note.id)
        n++
      }
      this.emit()
      return n
    })
  }

  /** Delete notes that have been in Recently Deleted for TRASH_DAYS days. */
  private async purgeExpired(): Promise<number> {
    let n = 0
    for (const note of this.all()) {
      if (!note.deleted || daysLeft(note.deleted, this.now()) > 0) continue
      await this.removeAttachments(note)
      await this.owning([note.path], () => this.fs.remove(note.path))
      this.notes.delete(note.id)
      n++
    }
    return n
  }

  /** A copy next to the note, with its own copies of the attachments. */
  duplicate(id: string): Promise<Note> {
    return this.run(async () => {
      const note = this.need(id)
      if (note.deleted) throw new Error('Restore the note first.')
      const dir = dirname(note.path)
      const body = await this.carryAttachments(note, dir, 'copy')
      const path = this.uniquePath(dir, fileStem(note.title || 'New Note'), '.md')
      const now = this.iso()
      const copy: Note = { ...note, id: newNoteId(this.now()), path, body, created: now, modified: now, pinned: false, header: { extra: note.header.extra } }
      const saved = await this.write(copy)
      this.emit()
      return saved
    })
  }

  /** Copy a picture or file into the note's Attachments folder; returns the link to put in the note. */
  addAttachment(id: string, name: string, data: Uint8Array): Promise<string> {
    return this.run(async () => {
      const note = this.need(id)
      const dir = join(dirname(note.path), ATTACHMENTS)
      const clean = name.replace(/[\\/:*?"<>|#\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'file'
      const dot = clean.lastIndexOf('.')
      const path = this.uniquePath(dir, dot > 0 ? clean.slice(0, dot) : clean, dot > 0 ? clean.slice(dot) : '')
      await this.owning([path, dir], () => this.fs.writeBytes(path, data, { mkdirs: true }))
      return `${ATTACHMENTS}/${basename(path)}`
    })
  }

  // ------------------------------------------------------------ folders

  private addFolderPaths(folder: string) {
    const parts = folder.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      if (!this.folderList.includes(p)) this.folderList.push(p)
    }
    this.folderList.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  }

  /** A new folder in `parent` ("" = at the top). Returns its relative path. */
  createFolder(parent: string, name: string): Promise<string> {
    return this.run(async () => {
      const problem = folderNameProblem(name)
      if (problem) throw new Error(problem)
      this.checkFolder(parent)
      const rel = parent ? `${parent}/${name.trim()}` : name.trim()
      const dir = this.dirOf(rel)
      if (this.fs.exists(dir)) throw new Error(`There is already a folder "${name.trim()}" there.`)
      await this.owning([dir], () => this.fs.mkdir(dir, { recursive: true }))
      this.addFolderPaths(rel)
      this.emit()
      return rel
    })
  }

  /** Rename a folder; notes in it (and in Recently Deleted, from it) follow. Returns the new relative path. */
  renameFolder(folder: string, name: string): Promise<string> {
    return this.run(async () => {
      this.checkFolder(folder)
      if (!folder) throw new Error('The Notes folder cannot be renamed.')
      const problem = folderNameProblem(name)
      if (problem) throw new Error(problem)
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
      const rel = parent ? `${parent}/${name.trim()}` : name.trim()
      if (rel === folder) return rel
      const from = this.dirOf(folder)
      const to = this.dirOf(rel)
      if (this.fs.exists(to) && to.toLowerCase() !== from.toLowerCase()) throw new Error(`There is already a folder "${name.trim()}" there.`)
      await this.owning([from, to], () => this.fs.rename(from, to))
      const moved = (f: string) => (f === folder ? rel : f.startsWith(`${folder}/`) ? rel + f.slice(folder.length) : f)
      for (const n of this.all()) {
        if (n.deleted) {
          if (n.from !== undefined && moved(n.from) !== n.from) await this.write({ ...n, from: moved(n.from) })
          continue
        }
        if (n.folder === folder || n.folder.startsWith(`${folder}/`)) {
          const path = to + n.path.slice(from.length)
          this.notes.set(n.id, { ...n, folder: moved(n.folder), path })
        }
      }
      this.folderList = this.folderList.map(moved)
      // Paths and modification times changed: read them again.
      await this.scan()
      return rel
    })
  }

  /** What deleting a folder would do: notes go to Recently Deleted, other files are lost. */
  folderContents(folder: string): { notes: number; folders: number; otherFiles: number } {
    const dir = this.dirOf(folder)
    let notes = 0
    let folders = 0
    let otherFiles = 0
    const visit = (d: string) => {
      for (const e of this.fs.list(d)) {
        if (e.type === 'dir') {
          if (e.name !== ATTACHMENTS) folders++
          visit(e.path)
        } else if (isNoteFile(e.name) && basename(d) !== ATTACHMENTS) notes++
        else if (basename(d) !== ATTACHMENTS) otherFiles++
      }
    }
    if (this.fs.isDir(dir)) visit(dir)
    return { notes, folders, otherFiles }
  }

  /** Delete a folder: its notes (subfolders too) go to Recently Deleted, then the folder goes. */
  deleteFolder(folder: string): Promise<number> {
    return this.run(async () => {
      this.checkFolder(folder)
      if (!folder) throw new Error('The Notes folder cannot be deleted.')
      let n = 0
      for (const note of this.all()) {
        if (note.deleted || !(note.folder === folder || note.folder.startsWith(`${folder}/`))) continue
        await this.relocate(note, TRASH, { deleted: this.iso(), from: note.folder })
        n++
      }
      const dir = this.dirOf(folder)
      if (this.fs.exists(dir)) await this.owning([dir], () => this.fs.remove(dir, { recursive: true }))
      this.folderList = this.folderList.filter((f) => f !== folder && !f.startsWith(`${folder}/`))
      this.emit()
      return n
    })
  }
}

/** A stored "folder:" that is not a safe relative path is restored to Notes. */
function folderNameProblemPath(rel: string): boolean {
  return rel.split('/').some((part) => folderNameProblem(part) !== null) || rel.includes('..')
}

export { TRASH, TRASH_DAYS }
