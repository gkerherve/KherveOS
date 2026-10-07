// The notes library on the KherveOS drive (the desktop's library.py and
// history.py): ~/Documents/KherveNote, its folders, earlier versions of every
// note, and the deleted notes. Nothing is ever hard-deleted: "Move to Trash"
// puts a note in <library>/.trash, and before a note is saved over, the
// version on the drive goes to <library>/.history/<note id>/.

import { fs, path, HOME } from '@/os'
import { readNoteOnly, EXTENSION } from './knote'
import { brokenInfo, noteInfo, safeName, sortNotes, stemOf, untitledStem, type Folder, type NoteInfo } from './library'

export const LIBRARY_ROOT = `${HOME}/Documents/KherveNote`
export const EXAMPLES_FOLDER = 'Examples'
const HISTORY = '.history'
export const TRASH = '.trash'
/** Seconds between two kept versions of the same note. */
const MIN_INTERVAL = 300
/** Versions kept per note. */
const KEEP = 40

const infoCache = new Map<string, { mtime: number; info: NoteInfo }>()

export async function readInfo(p: string): Promise<NoteInfo> {
  const st = fs.stat(p)
  const mtime = st?.mtime ?? 0
  const hit = infoCache.get(p)
  if (hit && hit.mtime === mtime) return hit.info
  let info: NoteInfo
  try {
    info = noteInfo(p, readNoteOnly(await fs.readBytes(p)), mtime)
  } catch {
    info = brokenInfo(p, mtime)
  }
  infoCache.set(p, { mtime, info })
  return info
}

export async function scan(root = LIBRARY_ROOT): Promise<Folder> {
  if (!fs.exists(root)) await fs.mkdir(root, { recursive: true })
  return scanDir(root)
}

async function scanDir(dir: string): Promise<Folder> {
  const out: Folder = { path: dir, name: path.basename(dir), folders: [], notes: [] }
  const entries = fs.list(dir).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.type === 'dir') out.folders.push(await scanDir(e.path))
    else if (e.name.endsWith(EXTENSION)) out.notes.push(await readInfo(e.path))
  }
  out.notes = sortNotes(out.notes)
  return out
}

export function uniquePath(folder: string, stem: string, suffix = EXTENSION): string {
  let p = path.join(folder, `${stem}${suffix}`)
  for (let n = 2; fs.exists(p); n++) p = path.join(folder, `${stem} (${n})${suffix}`)
  return p
}

export function newNotePath(folder: string, title: string, now = new Date()): string {
  return uniquePath(folder, title.trim() ? safeName(title) : untitledStem(now))
}

export async function makeFolder(parent: string, name = 'New folder'): Promise<string> {
  const p = uniquePath(parent, safeName(name, 'New folder'), '')
  await fs.mkdir(p, { recursive: true })
  return p
}

/** Move a note or folder into `destFolder`; a name taken there gets " (2)". */
export async function moveItem(src: string, destFolder: string): Promise<string> {
  if (path.dirname(src) === destFolder) return src
  if (fs.isDir(src) && (destFolder === src || path.isInside(destFolder, src))) throw new Error('A folder cannot go inside itself.')
  const isDir = fs.isDir(src)
  const dest = uniquePath(destFolder, isDir ? path.basename(src) : stemOf(src), isDir ? '' : path.extname(src))
  await fs.rename(src, dest)
  infoCache.delete(src)
  return dest
}

export async function renameItem(src: string, newName: string): Promise<string> {
  const isDir = fs.isDir(src)
  const stem = safeName(newName, isDir ? path.basename(src) : stemOf(src))
  if (stem === (isDir ? path.basename(src) : stemOf(src))) return src
  const dest = uniquePath(path.dirname(src), stem, isDir ? '' : path.extname(src))
  await fs.rename(src, dest)
  infoCache.delete(src)
  return dest
}

/** "Move to Trash": into <library>/.trash, never a hard delete. */
export async function trashItem(src: string, root = LIBRARY_ROOT): Promise<string> {
  const trash = path.join(root, TRASH)
  if (!fs.exists(trash)) await fs.mkdir(trash, { recursive: true })
  return moveItem(src, trash)
}

// ------------------------------------------------------------------ history

export interface Version {
  path: string
  when: Date
  title: string
  firstLine: string
  size: number
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})/

function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

function whenOf(name: string, fallback: number): Date {
  const m = STAMP_RE.exec(name)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : new Date(fallback)
}

const historyDir = (root: string, noteId: string) => path.join(root, HISTORY, noteId)

/**
 * Keep a copy of the note at `file` as it is on the drive now, unless the
 * newest kept version is less than MIN_INTERVAL older. Versions are named by
 * the note's own modification time, so that is what is compared.
 */
export async function snapshot(noteId: string, file: string, root = LIBRARY_ROOT, force = false): Promise<string | null> {
  const st = fs.stat(file)
  if (!noteId || !st || st.type !== 'file') return null
  const dir = historyDir(root, noteId)
  if (!fs.exists(dir)) await fs.mkdir(dir, { recursive: true })
  const existing = fs
    .list(dir)
    .filter((e) => e.name.endsWith(EXTENSION))
    .map((e) => ({ e, when: whenOf(e.name, e.mtime).getTime() }))
    .sort((a, b) => a.when - b.when)
  if (existing.length && !force && st.mtime - existing[existing.length - 1].when < MIN_INTERVAL * 1000) return null
  const dest = uniquePath(dir, stampOf(new Date(st.mtime)))
  await fs.copy(file, dest)
  const all = fs
    .list(dir)
    .filter((e) => e.name.endsWith(EXTENSION))
    .sort((a, b) => whenOf(a.name, a.mtime).getTime() - whenOf(b.name, b.mtime).getTime())
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await fs.remove(old.path)
  return dest
}

/** Kept versions of a note, newest first. */
export async function versions(noteId: string, root = LIBRARY_ROOT): Promise<Version[]> {
  const dir = historyDir(root, noteId)
  if (!noteId || !fs.isDir(dir)) return []
  const out: Version[] = []
  for (const e of fs.list(dir).filter((x) => x.name.endsWith(EXTENSION))) {
    const info = await readInfo(e.path)
    out.push({ path: e.path, when: whenOf(e.name, e.mtime), title: info.title, firstLine: info.firstLine.slice(0, 80), size: e.size })
  }
  return out.sort((a, b) => b.when.getTime() - a.when.getTime())
}

// ----------------------------------------------------------------- examples

export interface ExampleItem {
  title: string
  speaker: string
  place: string
  file: string
}

const EXAMPLES_URL = `${import.meta.env.BASE_URL}examples/khervenote/`

export async function exampleIndex(): Promise<ExampleItem[]> {
  const r = await fetch(`${EXAMPLES_URL}index.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`The examples could not be downloaded (HTTP ${r.status}).`)
  const raw = (await r.json()) as { items?: unknown }
  const items = Array.isArray(raw.items) ? raw.items : []
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.file === 'string' && /\.knote$/.test(x.file) && !x.file.includes('/') && !x.file.includes('..'))
    .map((x) => ({ title: String(x.title ?? x.file), speaker: String(x.speaker ?? ''), place: String(x.place ?? ''), file: x.file as string }))
}

/**
 * Help ▸ Example notes: write every example into <library>/Examples — never
 * over a file already there, so edited examples are kept.
 */
export async function installExamples(root = LIBRARY_ROOT): Promise<string[]> {
  const folder = path.join(root, EXAMPLES_FOLDER)
  if (!fs.exists(folder)) await fs.mkdir(folder, { recursive: true })
  const out: string[] = []
  for (const item of await exampleIndex()) {
    const target = path.join(folder, item.file)
    if (!fs.exists(target)) {
      const r = await fetch(EXAMPLES_URL + encodeURIComponent(item.file))
      if (!r.ok) continue
      await fs.writeBytes(target, new Uint8Array(await r.arrayBuffer()))
    }
    out.push(target)
  }
  return out
}
