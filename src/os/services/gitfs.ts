// A file system for isomorphic-git, over the KherveOS virtual drive.
//
// isomorphic-git expects the Node promise API (readFile, writeFile, unlink,
// readdir, mkdir, rmdir, stat, lstat, readlink, symlink). This adapter maps
// it onto the drive (src/os/vfs.ts), which keeps files in IndexedDB, and
// throws Node-style errors (isomorphic-git only looks at `err.code`).
//
// The drive has no symlinks and no permission bits: files are 100644,
// folders 040000, and a symlink checked out of a repo becomes a small file
// holding the link's target (what git does with core.symlinks = false).

import type { Stat } from '../vfs'
import { dirname, normalize } from '../path'

/** The part of the drive the adapter uses. src/os/vfs.ts implements it; tests use an in-memory stand-in. */
export interface GitDrive {
  stat(path: string): Stat | null
  list(dir: string): Stat[]
  readBytes(path: string): Promise<Uint8Array>
  writeBytes(path: string, data: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>
}

/** What stat/lstat return: the fields isomorphic-git reads (it normalises them itself). */
export interface GitStats {
  type: 'file' | 'dir'
  mode: number
  size: number
  ino: number
  dev: number
  uid: number
  gid: number
  mtimeMs: number
  ctimeMs: number
  mtime: Date
  ctime: Date
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

type Options = string | { encoding?: string | null; mode?: number; recursive?: boolean; force?: boolean } | null | undefined

export interface GitFsError extends Error {
  code: string
  syscall: string
  path: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function fail(code: string, syscall: string, path: string): GitFsError {
  const err = new Error(`${code}: ${syscall} '${path}'`) as GitFsError
  err.code = code
  err.syscall = syscall
  err.path = path
  return err
}

function clean(path: unknown, syscall: string): string {
  if (typeof path !== 'string' || !path) throw fail('EINVAL', syscall, String(path))
  return normalize(path.startsWith('/') ? path : `/${path}`)
}

function encodingOf(opts: Options): string | null {
  if (typeof opts === 'string') return opts
  return opts?.encoding ?? null
}

/** Bytes to store. A view into a bigger buffer is copied, so the drive never keeps (or stores) the whole buffer. */
function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') return encoder.encode(data)
  if (data instanceof Uint8Array) {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.constructor === Uint8Array
      ? data
      : new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  return encoder.encode(String(data ?? ''))
}

/**
 * Stats for isomorphic-git. Its index compares mtime only to the second, so a
 * file saved twice within one second at the same size would look unchanged;
 * the drive's millisecond mtime goes into `ino` (which the index compares too)
 * so every save is noticed.
 */
function toStats(s: Stat): GitStats {
  const dir = s.type === 'dir'
  return {
    type: s.type,
    mode: dir ? 0o040000 : 0o100644,
    size: dir ? 0 : s.size,
    ino: Math.floor(s.mtime) % 2 ** 32,
    dev: 1,
    uid: 1,
    gid: 1,
    mtimeMs: s.mtime,
    ctimeMs: s.ctime,
    mtime: new Date(s.mtime),
    ctime: new Date(s.ctime),
    isFile: () => !dir,
    isDirectory: () => dir,
    isSymbolicLink: () => false,
  }
}

/** The fs object to hand to isomorphic-git: `git.clone({ fs: createGitFs(drive), … })`. */
export function createGitFs(drive: GitDrive) {
  const stat = async (path: string): Promise<GitStats> => {
    const p = clean(path, 'stat')
    const s = drive.stat(p)
    if (!s) throw fail('ENOENT', 'stat', p)
    return toStats(s)
  }

  const parentOf = (p: string, syscall: string) => {
    const parent = drive.stat(dirname(p))
    if (!parent) throw fail('ENOENT', syscall, p)
    if (parent.type !== 'dir') throw fail('ENOTDIR', syscall, p)
  }

  const promises = {
    async readFile(path: string, opts?: Options): Promise<Uint8Array | string> {
      const p = clean(path, 'open')
      const s = drive.stat(p)
      if (!s) throw fail('ENOENT', 'open', p)
      if (s.type === 'dir') throw fail('EISDIR', 'read', p)
      const data = await drive.readBytes(p)
      const encoding = encodingOf(opts)
      return encoding ? decoder.decode(data) : data
    },

    async writeFile(path: string, data: unknown, _opts?: Options): Promise<void> {
      const p = clean(path, 'open')
      if (drive.stat(p)?.type === 'dir') throw fail('EISDIR', 'open', p)
      parentOf(p, 'open')
      await drive.writeBytes(p, toBytes(data))
    },

    async unlink(path: string): Promise<void> {
      const p = clean(path, 'unlink')
      const s = drive.stat(p)
      if (!s) throw fail('ENOENT', 'unlink', p)
      if (s.type === 'dir') throw fail('EISDIR', 'unlink', p)
      await drive.remove(p)
    },

    async readdir(path: string): Promise<string[]> {
      const p = clean(path, 'scandir')
      const s = drive.stat(p)
      if (!s) throw fail('ENOENT', 'scandir', p)
      if (s.type !== 'dir') throw fail('ENOTDIR', 'scandir', p)
      return drive.list(p).map((c) => c.name)
    },

    async mkdir(path: string, opts?: Options | number): Promise<void> {
      const p = clean(path, 'mkdir')
      const recursive = typeof opts === 'object' && !!opts?.recursive
      const s = drive.stat(p)
      if (s) {
        if (recursive && s.type === 'dir') return
        throw fail('EEXIST', 'mkdir', p)
      }
      if (recursive && !drive.stat(dirname(p))) await promises.mkdir(dirname(p), { recursive: true })
      parentOf(p, 'mkdir')
      try {
        await drive.mkdir(p)
      } catch (err) {
        // Two concurrent mkdirs of the same folder: the second one lost the race.
        if ((err as { code?: string }).code === 'EEXIST' && drive.stat(p)?.type === 'dir' && recursive) return
        throw err
      }
    },

    async rmdir(path: string, opts?: Options): Promise<void> {
      const p = clean(path, 'rmdir')
      if (typeof opts === 'object' && opts?.recursive) return promises.rm(p, { recursive: true })
      const s = drive.stat(p)
      if (!s) throw fail('ENOENT', 'rmdir', p)
      if (s.type !== 'dir') throw fail('ENOTDIR', 'rmdir', p)
      if (drive.list(p).length) throw fail('ENOTEMPTY', 'rmdir', p)
      await drive.remove(p)
    },

    /** fs.promises.rm: isomorphic-git uses it for `rmdir(dir, { recursive: true })`. */
    async rm(path: string, opts?: Options): Promise<void> {
      const p = clean(path, 'rm')
      const o = typeof opts === 'object' ? opts : null
      const s = drive.stat(p)
      if (!s) {
        if (o?.force) return
        throw fail('ENOENT', 'rm', p)
      }
      if (s.type === 'dir' && !o?.recursive) throw fail('EISDIR', 'rm', p)
      await drive.remove(p, { recursive: true })
    },

    stat,
    lstat: stat,

    /** The drive has no symlinks. */
    async readlink(path: string): Promise<string> {
      throw fail('ENOENT', 'readlink', clean(path, 'readlink'))
    },

    /** A symlink from a repo becomes a plain file holding its target. */
    async symlink(target: string, path: string): Promise<void> {
      const p = clean(path, 'symlink')
      if (drive.stat(p)) throw fail('EEXIST', 'symlink', p)
      parentOf(p, 'symlink')
      await drive.writeBytes(p, encoder.encode(String(target)))
    },
  }

  return { promises }
}

export type GitFs = ReturnType<typeof createGitFs>
