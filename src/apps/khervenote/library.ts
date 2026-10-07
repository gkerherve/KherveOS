// The notes library, the part without the drive (the desktop's library.py):
// what a note shows in the Notes panel, the search, and safe file names.
// Plain TypeScript so Node can test it; the drive side is store.ts.
//
// All notes live in one folder (~/Documents/KherveNote) whose sub-folders are
// the folders of the Notes panel — plain files and folders, never an index
// the files could disagree with.

import { plainText, pyStrip, type Note } from './model.ts'

export interface NoteInfo {
  path: string
  title: string
  date: string
  speaker: string
  place: string
  started: string
  /** Everything searchable, lower-cased. */
  text: string
  firstLine: string
  mtime: number
}

export interface Folder {
  path: string
  name: string
  folders: Folder[]
  notes: NoteInfo[]
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const stemOf = (p: string) => {
  const b = baseName(p)
  const dot = b.lastIndexOf('.')
  return dot > 0 ? b.slice(0, dot) : b
}

export function noteInfo(path: string, note: Note, mtime: number): NoteInfo {
  const m = note.meta
  const text = [m.title, m.speaker, m.date, m.place, note.summary, plainText(note)].join(' ').toLowerCase()
  let first = ''
  outer: for (const sec of note.sections) {
    for (const t of [sec.title, ...sec.blocks.filter((b) => b.text).map((b) => b.text)]) {
      if (pyStrip(t)) {
        first = t
        break outer
      }
    }
  }
  return { path, title: m.title, date: m.date, speaker: m.speaker, place: m.place, started: m.started, text, firstLine: pyStrip(first), mtime }
}

/** A note that could not be read is still listed, by its file name. */
export function brokenInfo(path: string, mtime: number): NoteInfo {
  return { path, title: '', date: '', speaker: '', place: '', started: '', text: stemOf(path).toLowerCase(), firstLine: '', mtime }
}

/** Its title; a note without one shows its first words. */
export function labelOf(info: NoteInfo): string {
  if (pyStrip(info.title)) return pyStrip(info.title)
  if (info.firstLine) {
    const words = info.firstLine.split(/\s+/).filter(Boolean)
    return words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '')
  }
  return stemOf(info.path)
}

/** Newest first: the session start, falling back to the file time. */
export function sortNotes(notes: NoteInfo[]): NoteInfo[] {
  const key = (n: NoteInfo) => n.started || new Date(n.mtime).toISOString().slice(0, 19)
  return [...notes].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0))
}

/** Every word of `query` appears in the note (title, date, people, text) or in its file name. */
export function matches(info: NoteInfo, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = info.text + ' ' + stemOf(info.path).toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The part of the tree that matches: matching notes, plus folders whose name matches (with everything in them). */
export function filterTree(folder: Folder, query: string): Folder | null {
  if (!query.trim()) return folder
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.every((w) => folder.name.toLowerCase().includes(w))) return folder
  const folders = folder.folders.map((f) => filterTree(f, query)).filter((f): f is Folder => !!f)
  const notes = folder.notes.filter((n) => matches(n, query))
  return folders.length || notes.length ? { ...folder, folders, notes } : null
}

/** How many notes a tree holds. */
export function countNotes(folder: Folder): number {
  return folder.notes.length + folder.folders.reduce((n, f) => n + countNotes(f), 0)
}

/** Every note of a tree, folders first. */
export function allNotes(folder: Folder): NoteInfo[] {
  return [...folder.folders.flatMap(allNotes), ...folder.notes]
}

const UNSAFE = /[\\/:*?"<>|\x00-\x1f]/g

/** A name that is safe as a file name (library.safe_name). */
export function safeName(name: string, fallback = 'Untitled'): string {
  let s = pyStrip(name.replace(UNSAFE, ' '))
  s = s.replace(/^\.+|\.+$/g, '')
  s = s.replace(/\s+/g, ' ')
  return Array.from(s).slice(0, 80).join('') || fallback
}

/** "Note 2026-10-07 14.16", the name of a note without a title. */
export function untitledStem(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Note ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}`
}
