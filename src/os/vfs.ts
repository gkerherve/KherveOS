// The KherveOS virtual file system.
//
// Files live in IndexedDB (two stores: `meta` for the tree, `data` for the
// bytes), so they survive reloads and work in every browser. The whole tree
// is mirrored in memory at boot, which makes stat/list synchronous; only file
// contents are read from IndexedDB on demand. Every change is broadcast to
// watchers, so a file saved in Notepad shows up in Files immediately.

import { useSyncExternalStore } from 'react'
import { HOME, basename, dirname, isInside, join, normalize } from './path'
import { seedFiles } from './seed'

export type FileType = 'file' | 'dir'

export interface Stat {
  path: string
  name: string
  type: FileType
  size: number
  mtime: number
  ctime: number
}

export type FsEvent =
  | { type: 'create' | 'change' | 'delete'; path: string; kind: FileType }
  | { type: 'rename'; path: string; oldPath: string; kind: FileType }

export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL' | 'EPERM'

export class FsError extends Error {
  code: FsErrorCode
  path: string
  constructor(code: FsErrorCode, path: string, message?: string) {
    super(message ?? `${code}: ${describe(code)} — ${path}`)
    this.code = code
    this.path = path
  }
}

function describe(code: FsErrorCode): string {
  switch (code) {
    case 'ENOENT': return 'no such file or folder'
    case 'EEXIST': return 'already exists'
    case 'ENOTDIR': return 'not a folder'
    case 'EISDIR': return 'is a folder'
    case 'ENOTEMPTY': return 'folder is not empty'
    case 'EINVAL': return 'invalid operation'
    case 'EPERM': return 'not allowed'
  }
}

interface Meta {
  type: FileType
  size: number
  mtime: number
  ctime: number
}

const DB_NAME = 'kherveos-fs'
const PROTECTED = new Set(['/', '/home', HOME])
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, fail) => {
    tx.oncomplete = () => ok()
    tx.onerror = () => fail(tx.error)
    tx.onabort = () => fail(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

class VirtualFS {
  private db!: IDBDatabase
  private meta = new Map<string, Meta>()
  private children = new Map<string, Set<string>>()
  private listeners = new Set<(ev: FsEvent) => void>()
  private version = 0
  readonly ready: Promise<void>

  constructor() {
    this.ready = this.boot()
  }

  // ---------------------------------------------------------------- boot

  private async boot() {
    this.db = await new Promise<IDBDatabase>((ok, fail) => {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('meta')
        open.result.createObjectStore('data')
      }
      open.onsuccess = () => ok(open.result)
      open.onerror = () => fail(open.error)
    })
    const tx = this.db.transaction('meta', 'readonly')
    const store = tx.objectStore('meta')
    const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())])
    keys.forEach((k, i) => this.index(k as string, values[i] as Meta))
    if (!this.meta.has('/')) await this.seed()
  }

  private async seed() {
    const now = Date.now()
    const tx = this.db.transaction(['meta', 'data'], 'readwrite')
    const put = (path: string, type: FileType, data?: Uint8Array) => {
      const m: Meta = { type, size: data?.byteLength ?? 0, mtime: now, ctime: now }
      tx.objectStore('meta').put(m, path)
      if (data) tx.objectStore('data').put(data, path)
      this.index(path, m)
    }
    for (const dir of ['/', '/home', HOME, '/tmp']) put(dir, 'dir')
    for (const item of seedFiles()) {
      // make sure every parent folder exists
      const parts = item.path.split('/').filter(Boolean)
      for (let i = 1; i < parts.length; i++) {
        const dir = '/' + parts.slice(0, i).join('/')
        if (!this.meta.has(dir)) put(dir, 'dir')
      }
      if (item.dir) {
        if (!this.meta.has(item.path)) put(item.path, 'dir')
      } else {
        put(item.path, 'file', typeof item.content === 'string' ? encoder.encode(item.content) : item.content)
      }
    }
    await done(tx)
  }

  private index(path: string, m: Meta) {
    this.meta.set(path, m)
    if (path !== '/') {
      const parent = dirname(path)
      let set = this.children.get(parent)
      if (!set) this.children.set(parent, (set = new Set()))
      set.add(basename(path))
    }
    if (m.type === 'dir' && !this.children.has(path)) this.children.set(path, new Set())
  }

  private unindex(path: string) {
    this.meta.delete(path)
    this.children.delete(path)
    this.children.get(dirname(path))?.delete(basename(path))
  }

  private emit(ev: FsEvent) {
    this.version++
    for (const l of [...this.listeners]) {
      try { l(ev) } catch (e) { console.error('[vfs] watcher failed', e) }
    }
  }

  // ------------------------------------------------------------- queries

  stat(path: string): Stat | null {
    const p = normalize(path)
    const m = this.meta.get(p)
    return m ? { path: p, name: p === '/' ? '/' : basename(p), ...m } : null
  }

  exists(path: string): boolean {
    return this.meta.has(normalize(path))
  }

  isDir(path: string): boolean {
    return this.meta.get(normalize(path))?.type === 'dir'
  }

  isFile(path: string): boolean {
    return this.meta.get(normalize(path))?.type === 'file'
  }

  /** Folder contents: folders first, then files, each sorted by name. */
  list(dir: string): Stat[] {
    const d = normalize(dir)
    const m = this.meta.get(d)
    if (!m) throw new FsError('ENOENT', d)
    if (m.type !== 'dir') throw new FsError('ENOTDIR', d)
    const names = [...(this.children.get(d) ?? [])]
    return names
      .map((n) => this.stat(join(d, n))!)
      .filter(Boolean)
      .sort((a, b) =>
        a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      )
  }

  /** Every path below `dir` (not including `dir`), parents before children. */
  walk(dir: string): Stat[] {
    const out: Stat[] = []
    const visit = (d: string) => {
      for (const s of this.list(d)) {
        out.push(s)
        if (s.type === 'dir') visit(s.path)
      }
    }
    visit(normalize(dir))
    return out
  }

  /** "Untitled.txt" → "Untitled 2.txt" when the name is taken. */
  uniqueName(dir: string, name: string): string {
    if (!this.exists(join(dir, name))) return name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`
      if (!this.exists(join(dir, candidate))) return candidate
    }
  }

  usage(): { files: number; folders: number; bytes: number } {
    let files = 0, folders = 0, bytes = 0
    for (const m of this.meta.values()) {
      if (m.type === 'dir') folders++
      else { files++; bytes += m.size }
    }
    return { files, folders, bytes }
  }

  getVersion = () => this.version

  // --------------------------------------------------------------- reads

  async readBytes(path: string): Promise<Uint8Array> {
    const p = normalize(path)
    const m = this.meta.get(p)
    if (!m) throw new FsError('ENOENT', p)
    if (m.type === 'dir') throw new FsError('EISDIR', p)
    const tx = this.db.transaction('data', 'readonly')
    const data = await req(tx.objectStore('data').get(p))
    return data instanceof Uint8Array ? data : new Uint8Array(0)
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path))
  }

  // -------------------------------------------------------------- writes

  private checkParent(p: string) {
    const parent = dirname(p)
    const pm = this.meta.get(parent)
    if (!pm) throw new FsError('ENOENT', parent)
    if (pm.type !== 'dir') throw new FsError('ENOTDIR', parent)
  }

  async writeBytes(path: string, data: Uint8Array, opts: { mkdirs?: boolean } = {}): Promise<void> {
    const p = normalize(path)
    if (p === '/') throw new FsError('EISDIR', p)
    const existing = this.meta.get(p)
    if (existing?.type === 'dir') throw new FsError('EISDIR', p)
    if (opts.mkdirs) await this.mkdir(dirname(p), { recursive: true })
    this.checkParent(p)
    const now = Date.now()
    const m: Meta = { type: 'file', size: data.byteLength, mtime: now, ctime: existing?.ctime ?? now }
    const tx = this.db.transaction(['meta', 'data'], 'readwrite')
    tx.objectStore('meta').put(m, p)
    tx.objectStore('data').put(data, p)
    await done(tx)
    this.index(p, m)
    this.emit({ type: existing ? 'change' : 'create', path: p, kind: 'file' })
  }

  async writeText(path: string, text: string, opts: { mkdirs?: boolean } = {}): Promise<void> {
    return this.writeBytes(path, encoder.encode(text), opts)
  }

  async mkdir(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const p = normalize(path)
    const existing = this.meta.get(p)
    if (existing) {
      if (existing.type === 'dir' && opts.recursive) return
      throw new FsError(existing.type === 'dir' ? 'EEXIST' : 'ENOTDIR', p)
    }
    if (opts.recursive && !this.meta.has(dirname(p))) await this.mkdir(dirname(p), { recursive: true })
    this.checkParent(p)
    const now = Date.now()
    const m: Meta = { type: 'dir', size: 0, mtime: now, ctime: now }
    const tx = this.db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(m, p)
    await done(tx)
    this.index(p, m)
    this.emit({ type: 'create', path: p, kind: 'dir' })
  }

  async remove(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const p = normalize(path)
    if (PROTECTED.has(p)) throw new FsError('EPERM', p, `${p} is a system folder and cannot be removed`)
    const m = this.meta.get(p)
    if (!m) throw new FsError('ENOENT', p)
    const doomed = m.type === 'dir' ? this.walk(p).map((s) => s.path) : []
    if (doomed.length && !opts.recursive) throw new FsError('ENOTEMPTY', p)
    doomed.push(p)
    const tx = this.db.transaction(['meta', 'data'], 'readwrite')
    for (const d of doomed) {
      tx.objectStore('meta').delete(d)
      tx.objectStore('data').delete(d)
    }
    await done(tx)
    for (const d of doomed.reverse()) this.unindex(d)
    this.emit({ type: 'delete', path: p, kind: m.type })
  }

  /** Move or rename a file or a whole folder. */
  async rename(from: string, to: string, opts: { overwrite?: boolean } = {}): Promise<void> {
    const src = normalize(from)
    const dst = normalize(to)
    if (src === dst) return
    if (PROTECTED.has(src)) throw new FsError('EPERM', src)
    const m = this.meta.get(src)
    if (!m) throw new FsError('ENOENT', src)
    if (m.type === 'dir' && isInside(dst, src)) throw new FsError('EINVAL', dst, 'Cannot move a folder into itself')
    const target = this.meta.get(dst)
    if (target) {
      if (!opts.overwrite || target.type === 'dir' || m.type === 'dir') throw new FsError('EEXIST', dst)
      await this.remove(dst)
    }
    this.checkParent(dst)
    const moves: [string, string][] = [[src, dst]]
    if (m.type === 'dir') for (const s of this.walk(src)) moves.push([s.path, dst + s.path.slice(src.length)])
    const tx = this.db.transaction(['meta', 'data'], 'readwrite')
    const metaStore = tx.objectStore('meta')
    const dataStore = tx.objectStore('data')
    const moved: [string, Meta][] = []
    for (const [a, b] of moves) {
      const am = this.meta.get(a)!
      metaStore.delete(a)
      metaStore.put(am, b)
      if (am.type === 'file') {
        const data = await req(dataStore.get(a))
        dataStore.delete(a)
        dataStore.put(data ?? new Uint8Array(0), b)
      }
      moved.push([b, am])
    }
    await done(tx)
    for (const [a] of [...moves].reverse()) this.unindex(a)
    for (const [b, bm] of moved) this.index(b, bm)
    this.emit({ type: 'rename', path: dst, oldPath: src, kind: m.type })
  }

  async copy(from: string, to: string): Promise<void> {
    const src = normalize(from)
    const dst = normalize(to)
    const m = this.meta.get(src)
    if (!m) throw new FsError('ENOENT', src)
    if (this.meta.has(dst)) throw new FsError('EEXIST', dst)
    if (m.type === 'file') return this.writeBytes(dst, await this.readBytes(src))
    if (isInside(dst, src)) throw new FsError('EINVAL', dst, 'Cannot copy a folder into itself')
    await this.mkdir(dst)
    for (const child of this.list(src)) await this.copy(child.path, join(dst, child.name))
  }

  /** Wipe everything and start again from the default files. */
  async reset(): Promise<void> {
    const tx = this.db.transaction(['meta', 'data'], 'readwrite')
    tx.objectStore('meta').clear()
    tx.objectStore('data').clear()
    await done(tx)
    this.meta.clear()
    this.children.clear()
    await this.seed()
    this.emit({ type: 'change', path: '/', kind: 'dir' })
  }

  // ------------------------------------------------------------ watching

  watch(listener: (ev: FsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribe = (cb: () => void): (() => void) => this.watch(() => cb())
}

export const fs = new VirtualFS()

/** Re-render whenever anything in the file system changes. */
export function useFsVersion(): number {
  return useSyncExternalStore(fs.subscribe, fs.getVersion)
}

/** The contents of a folder, kept live. Returns null if it doesn't exist. */
export function useDir(dir: string): Stat[] | null {
  useFsVersion()
  try {
    return fs.list(dir)
  } catch {
    return null
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
