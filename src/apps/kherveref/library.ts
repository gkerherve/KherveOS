// A KherveRef library on the KherveOS drive, in the desktop app's format
// (kherveref/library.py + store.py, format 2), so a library folder copied
// between the desktop and KherveOS opens in both:
//
//   <Name>/
//     <Name>.kref                  the library (JSON manifest)
//     PDFs/<key>.pdf               attached papers, named by citation key
//     library.bib                  every reference as classic BibTeX (KherveTeX reads it),
//                                  regenerated after each change
//     .kherveref/references/<key>.json   one reference per file
//     .kherveref/collections.json        the collection tree
//     .gitignore
//
// Written against a small file-system interface (os.fs satisfies it) so the
// Node tests can check the files byte for byte.

import { toBibtex } from './bibtex.ts'
import { isValidKey, uniqueKey, DEFAULT_KEY_STYLE } from './keys.ts'
import { cmpCodePoints, fromDict, nowIso, toDict, type Attachment, type Entry } from './model.ts'
import { sha1Hex } from './sha1.ts'

export interface LibFs {
  exists(path: string): boolean
  isDir(path: string): boolean
  list(dir: string): { name: string; type: 'file' | 'dir' }[]
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  writeText(path: string, text: string, opts?: { mkdirs?: boolean }): Promise<void>
  writeBytes(path: string, data: Uint8Array, opts?: { mkdirs?: boolean }): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string, opts?: { overwrite?: boolean }): Promise<void>
}

export const FORMAT_VERSION = 2
export const SUFFIX = '.kref'
export const DATA_DIR = '.kherveref'
export const ENTRIES_DIR = 'references'
export const FILES_DIR = 'PDFs'
export const COLLECTIONS = 'collections.json'
export const CACHE_DIR = 'cache'
export const LIBRARY_BIB = 'library.bib'
const GITIGNORE = `${DATA_DIR}/${CACHE_DIR}/\n.DS_Store\nThumbs.db\n`
const V1_MANIFEST = 'library.json'

export class LibraryError extends Error {}

export interface Collection {
  id: string
  name: string
  parent: string
}

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')
const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? ''
const dirname = (p: string) => p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'

/** Python's json.dumps(…, indent=2, sort_keys=True) — keys sorted at every level. */
function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort(cmpCodePoints)
        .map((k) => [k, sortedKeys(o[k])]),
    )
  }
  return v
}
export const jsonText = (data: unknown, sortKeys = false) => JSON.stringify(sortKeys ? sortedKeys(data) : data, null, 2) + '\n'

export function manifestName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '') || 'Library'
  return safe + SUFFIX
}

export function findManifest(fs: LibFs, root: string): string | null {
  if (!fs.isDir(root)) return null
  const found = fs
    .list(root)
    .filter((s) => s.type === 'file' && s.name.endsWith(SUFFIX))
    .map((s) => s.name)
    .sort(cmpCodePoints)
  const stem = basename(root)
  const own = found.find((n) => n.slice(0, -SUFFIX.length) === stem)
  return own ? join(root, own) : found.length ? join(root, found[0]) : null
}

/** The library folder for `path`: the folder itself, or the folder holding a .kref file. */
export function libraryRoot(fs: LibFs, path: string): string {
  return path.toLowerCase().endsWith(SUFFIX) && fs.exists(path) && !fs.isDir(path) ? dirname(path) : path.replace(/\/+$/, '')
}

export function isLibrary(fs: LibFs, path: string): boolean {
  const root = libraryRoot(fs, path)
  return findManifest(fs, root) !== null || fs.exists(join(root, V1_MANIFEST))
}

async function makeDirs(fs: LibFs, root: string) {
  for (const d of [join(root, DATA_DIR, ENTRIES_DIR), join(root, FILES_DIR)]) {
    if (!fs.isDir(d)) await fs.mkdir(d, { recursive: true })
    // Git does not track empty folders.
    if (!fs.exists(join(d, '.gitkeep'))) await fs.writeText(join(d, '.gitkeep'), '')
  }
}

export async function createLibrary(fs: LibFs, root: string, name?: string): Promise<Library> {
  root = root.replace(/\/+$/, '')
  if (isLibrary(fs, root)) throw new LibraryError(`${root} already holds a KherveRef library`)
  if (fs.exists(root) && fs.list(root).some((s) => s.name !== '.git' && s.name !== '.DS_Store'))
    throw new LibraryError(`${root} is not empty`)
  const libName = name || basename(root)
  if (!fs.isDir(root)) await fs.mkdir(root, { recursive: true })
  await makeDirs(fs, root)
  await fs.writeText(join(root, manifestName(libName)), jsonText({ format: FORMAT_VERSION, name: libName, dialect: 'biblatex', app: 'KherveRef' }, true))
  await fs.writeText(join(root, DATA_DIR, COLLECTIONS), jsonText({ collections: [] }, true))
  await fs.writeText(join(root, '.gitignore'), GITIGNORE)
  const lib = new Library(fs, root, libName)
  await lib.writeLibraryBib()
  return lib
}

export async function openLibrary(fs: LibFs, path: string): Promise<Library> {
  const root = libraryRoot(fs, path)
  const manifest = findManifest(fs, root)
  if (!manifest) {
    if (fs.exists(join(root, V1_MANIFEST)))
      throw new LibraryError(`${root} was made by KherveRef 0.1–0.5: open it once in the desktop KherveRef, which brings it up to date.`)
    throw new LibraryError(`${root} is not a KherveRef library`)
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(await fs.readText(manifest))
  } catch (e) {
    throw new LibraryError(`Cannot read ${manifest}: ${(e as Error).message}`)
  }
  if (Number(data.format ?? 0) > FORMAT_VERSION) throw new LibraryError(`${root} was written by a newer KherveRef — update the app`)
  await makeDirs(fs, root)
  if (!fs.exists(join(root, DATA_DIR, COLLECTIONS))) await fs.writeText(join(root, DATA_DIR, COLLECTIONS), jsonText({ collections: [] }, true))
  const lib = new Library(fs, root, String(data.name || basename(manifest).slice(0, -SUFFIX.length)))
  lib.dialect = String(data.dialect ?? 'biblatex')
  lib.keyStyle = String(data.key_style ?? DEFAULT_KEY_STYLE)
  await lib.load()
  return lib
}

export class Library {
  fs: LibFs
  root: string
  name: string
  dialect = 'biblatex'
  keyStyle = DEFAULT_KEY_STYLE
  entries = new Map<string, Entry>()
  collections: Collection[] = []

  constructor(fs: LibFs, root: string, name: string) {
    this.fs = fs
    this.root = root
    this.name = name
  }

  get entriesDir() {
    return join(this.root, DATA_DIR, ENTRIES_DIR)
  }
  get filesDir() {
    return join(this.root, FILES_DIR)
  }
  get collectionsPath() {
    return join(this.root, DATA_DIR, COLLECTIONS)
  }
  get manifest() {
    return findManifest(this.fs, this.root) ?? join(this.root, manifestName(this.name))
  }

  /** The drive path of an attachment. */
  filePath(a: Attachment): string {
    return join(this.root, a.path)
  }

  entryPath(key: string): string {
    if (!isValidKey(key)) throw new LibraryError(`invalid citation key "${key}"`)
    return join(this.entriesDir, `${key}.json`)
  }

  async load(): Promise<void> {
    const entries = new Map<string, Entry>()
    const names = this.fs.isDir(this.entriesDir)
      ? this.fs
          .list(this.entriesDir)
          .filter((s) => s.type === 'file' && s.name.endsWith('.json'))
          .map((s) => s.name)
          .sort(cmpCodePoints)
      : []
    for (const n of names) {
      try {
        const e = fromDict(JSON.parse(await this.fs.readText(join(this.entriesDir, n))))
        e.key ||= n.slice(0, -5)
        entries.set(e.key, e)
      } catch {
        /* unreadable: skipped, like the desktop */
      }
    }
    this.entries = entries
    this.collections = await this.loadCollections()
  }

  private async loadCollections(): Promise<Collection[]> {
    try {
      const data = JSON.parse(await this.fs.readText(this.collectionsPath)) as { collections?: unknown[] }
      return (data.collections ?? [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !!(c as Record<string, unknown>).id)
        .map((c) => ({ id: String(c.id), name: String(c.name ?? ''), parent: String(c.parent ?? '') }))
    } catch {
      return []
    }
  }

  async saveCollections(): Promise<void> {
    const data = { collections: this.collections.map((c) => ({ id: c.id, name: c.name, ...(c.parent ? { parent: c.parent } : {}) })) }
    await this.fs.writeText(this.collectionsPath, jsonText(data, true))
  }

  async saveEntry(e: Entry): Promise<void> {
    if (!e.added) e.added = nowIso()
    e.modified = nowIso()
    await this.fs.writeText(this.entryPath(e.key), jsonText(toDict(e)))
    this.entries.set(e.key, e)
  }

  /** Give `e` a fresh unique key (keeping an imported key when valid and free), and save it. */
  async addEntry(e: Entry): Promise<Entry> {
    const taken = new Set([...this.entries.keys()].map((k) => k.toLowerCase()))
    if (!e.key || !isValidKey(e.key) || taken.has(e.key.toLowerCase())) e.key = uniqueKey(e, this.entries.keys(), this.keyStyle)
    await this.saveEntry(e)
    return e
  }

  /** Remove the reference and the attachments in PDFs/ it has. */
  async deleteEntry(e: Entry): Promise<void> {
    const p = this.entryPath(e.key)
    if (this.fs.exists(p)) await this.fs.remove(p)
    for (const a of e.files) {
      const fp = this.filePath(a)
      if (a.path.startsWith(`${FILES_DIR}/`) && this.fs.exists(fp)) await this.fs.remove(fp)
    }
    this.entries.delete(e.key)
  }

  /** Copy a file into PDFs/ as <key>.<ext> (or <key>-2.<ext>…) and record it on the entry (not saved here). */
  async attachFile(e: Entry, data: Uint8Array, ext = '.pdf'): Promise<Attachment> {
    ext = ext.toLowerCase() || '.bin'
    let name = `${e.key}${ext}`
    for (let n = 2; this.fs.exists(join(this.filesDir, name)); n++) name = `${e.key}-${n}${ext}`
    await this.fs.writeBytes(join(this.filesDir, name), data, { mkdirs: true })
    const att = { path: `${FILES_DIR}/${name}`, sha1: await sha1Hex(data) }
    e.files.push(att)
    return att
  }

  /** Take an attachment off a reference (and delete its file when it is in PDFs/). Saves the entry. */
  async removeAttachment(e: Entry, index: number): Promise<void> {
    const [a] = e.files.splice(index, 1)
    if (a && a.path.startsWith(`${FILES_DIR}/`) && this.fs.exists(this.filePath(a))) await this.fs.remove(this.filePath(a))
    await this.saveEntry(e)
  }

  /** Rename a citation key, and the PDFs named after it. Documents citing the old key need updating. */
  async renameKey(oldKey: string, newKey: string): Promise<Entry> {
    const e = this.entries.get(oldKey)
    if (!e) throw new LibraryError(`No reference "${oldKey}"`)
    if (oldKey === newKey) return e
    if (!isValidKey(newKey)) throw new LibraryError(`"${newKey}" can't be a key: use letters, digits and _ : - . +`)
    if ([...this.entries.keys()].some((k) => k !== oldKey && k.toLowerCase() === newKey.toLowerCase()))
      throw new LibraryError(`There is already a reference "${newKey}"`)
    for (const att of e.files) {
      const name = att.path.split('/').pop() ?? ''
      if (!att.path.startsWith(`${FILES_DIR}/`) || !name.startsWith(oldKey)) continue
      const rest = name.slice(oldKey.length)
      if (rest && !'.-'.includes(rest[0])) continue // another key that merely starts the same
      const target = `${FILES_DIR}/${newKey}${rest}`
      if (this.fs.exists(this.filePath(att)) && !this.fs.exists(join(this.root, target))) {
        await this.fs.rename(this.filePath(att), join(this.root, target))
        att.path = target
      }
    }
    const old = this.entryPath(oldKey)
    if (this.fs.exists(old)) await this.fs.remove(old)
    this.entries.delete(oldKey)
    e.key = newKey
    await this.saveEntry(e)
    return e
  }

  /** Remember the key style in the .kref, so every computer names new references the same way. */
  async setKeyStyle(style: string): Promise<void> {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await this.fs.readText(this.manifest))
    } catch {
      data = { format: FORMAT_VERSION, name: this.name }
    }
    data.key_style = style
    await this.fs.writeText(this.manifest, jsonText(data, true))
    this.keyStyle = style
  }

  /** The text of library.bib: classic BibTeX (KherveTeX compiles with natbib + bibtex). */
  libraryBibText(): string {
    return `% ${this.name} — generated by KherveRef. Do not edit: changes are overwritten.\n\n` + toBibtex(this.entries.values(), 'bibtex')
  }

  /** Regenerate library.bib when its content changes. Every change to entries must end with this. */
  async writeLibraryBib(): Promise<void> {
    const path = join(this.root, LIBRARY_BIB)
    const text = this.libraryBibText()
    try {
      if (this.fs.exists(path) && (await this.fs.readText(path)) === text) return
    } catch {
      /* rewrite it */
    }
    await this.fs.writeText(path, text)
  }

  // ------------------------------------------------------- collections

  newCollectionId(): string {
    const bytes = new Uint8Array(4)
    globalThis.crypto.getRandomValues(bytes)
    return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('')
  }

  /** A collection id with every collection below it. */
  descendants(id: string): Set<string> {
    const out = new Set<string>()
    const todo = [id]
    while (todo.length) {
      const c = todo.pop()!
      if (out.has(c)) continue
      out.add(c)
      for (const x of this.collections) if (x.parent === c) todo.push(x.id)
    }
    return out
  }
}
