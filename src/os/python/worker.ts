// Runs Pyodide (CPython compiled to WebAssembly) off the main thread, so a
// long computation never freezes the desktop. One worker = one Python
// process; see kernel.ts for the main-thread side.
//
// The user's home folder (/home/user) is mirrored into Python's in-memory file
// system: the kernel pushes changes in before each run, and after the run we
// report back every file Python created, changed or deleted.

import runtimeSource from './runtime.py?raw'
import { PYODIDE_VERSION } from '../version'

const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const HOME = '/home/user'

// Minimal typings for the parts of Pyodide we use.
interface PyProxy {
  toJs(opts?: { dict_converter?: typeof Object.fromEntries; create_pyproxies?: boolean }): unknown
  destroy(): void
  (...args: unknown[]): unknown
}
interface EmFS {
  mkdirTree(path: string): void
  writeFile(path: string, data: Uint8Array | string): void
  readFile(path: string): Uint8Array
  readdir(path: string): string[]
  stat(path: string): { mode: number; size: number; mtime: Date | number }
  isDir(mode: number): boolean
  unlink(path: string): void
  rmdir(path: string): void
  analyzePath(path: string): { exists: boolean }
}
interface Pyodide {
  version: string
  FS: EmFS
  globals: { get(name: string): PyProxy }
  pyimport(name: string): PyProxy & Record<string, PyProxy>
  runPython(code: string): unknown
  runPythonAsync(code: string): Promise<unknown>
  loadPackage(names: string | string[], opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>
  setStdout(opts: { write: (buf: Uint8Array) => number; isatty?: boolean }): void
  setStderr(opts: { write: (buf: Uint8Array) => number; isatty?: boolean }): void
}

export interface FsFile {
  path: string
  data: Uint8Array
}
export interface FsChanges {
  files: FsFile[]
  dirs: string[]
  deletes: string[]
}

export type WorkerRequest =
  | { type: 'init'; id: number }
  | { type: 'fs'; id: number; changes: FsChanges }
  | { type: 'cell'; id: number; code: string; ns: string }
  | { type: 'repl'; id: number; line: string; ns: string }
  | { type: 'repl-cancel'; id: number; ns: string }
  | { type: 'script'; id: number; path: string; argv: string[]; cwd: string }
  | { type: 'install'; id: number; packages: string[] }
  | { type: 'reset'; id: number; ns: string }

export type WorkerResponse =
  | { type: 'done'; id: number; value: unknown; changes: FsChanges }
  | { type: 'fail'; id: number; error: string }
  | { type: 'stdout' | 'stderr'; id: number; text: string }
  | { type: 'status'; id: number; text: string }

const ctx = self as unknown as {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

let py: Pyodide | null = null
let runtime: (PyProxy & Record<string, PyProxy>) | null = null
let currentId = 0
let snapshot = new Map<string, string>() // path -> "mtime:size" for files, "dir" for folders

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  ctx.postMessage(msg, transfer)
}

function streamWriter(kind: 'stdout' | 'stderr') {
  const decoder = new TextDecoder()
  return (buf: Uint8Array) => {
    const text = decoder.decode(buf, { stream: true })
    if (text) post({ type: kind, id: currentId, text })
    return buf.length
  }
}

async function init() {
  if (py) return py.version
  const mod = (await import(/* @vite-ignore */ `${INDEX_URL}pyodide.mjs`)) as {
    loadPyodide(opts: { indexURL: string; env?: Record<string, string> }): Promise<Pyodide>
  }
  // MPLCONFIGDIR: keep matplotlib's cache out of the user's home folder.
  py = await mod.loadPyodide({ indexURL: INDEX_URL, env: { HOME, MPLBACKEND: 'Agg', MPLCONFIGDIR: '/tmp/matplotlib' } })
  py.setStdout({ write: streamWriter('stdout'), isatty: false })
  py.setStderr({ write: streamWriter('stderr'), isatty: false })
  py.FS.mkdirTree(HOME)
  py.FS.mkdirTree('/kherveos')
  py.FS.writeFile('/kherveos/kherveos_runtime.py', runtimeSource)
  py.runPython(`import sys, os\nsys.path.insert(0, '/kherveos')\nos.chdir('${HOME}')`)
  runtime = py.pyimport('kherveos_runtime')
  takeSnapshot()
  return py.version
}

// ------------------------------------------------------------- file mirror

function walk(dir: string, visit: (path: string, isDir: boolean, st: { size: number; mtime: Date | number }) => void) {
  const FS = py!.FS
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    const p = `${dir}/${name}`
    const st = FS.stat(p)
    const isDir = FS.isDir(st.mode)
    visit(p, isDir, st)
    if (isDir) walk(p, visit)
  }
}

const stamp = (st: { size: number; mtime: Date | number }) =>
  `${typeof st.mtime === 'number' ? st.mtime : st.mtime.getTime()}:${st.size}`

function takeSnapshot() {
  snapshot = new Map()
  walk(HOME, (p, isDir, st) => snapshot.set(p, isDir ? 'dir' : stamp(st)))
}

function removeTree(path: string) {
  const FS = py!.FS
  if (!FS.analyzePath(path).exists) return
  if (FS.isDir(FS.stat(path).mode)) {
    for (const name of FS.readdir(path)) if (name !== '.' && name !== '..') removeTree(`${path}/${name}`)
    FS.rmdir(path)
  } else FS.unlink(path)
}

function applyChanges(ch: FsChanges) {
  const FS = py!.FS
  for (const d of ch.deletes) removeTree(d)
  for (const d of ch.dirs) FS.mkdirTree(d)
  for (const f of ch.files) {
    FS.mkdirTree(f.path.slice(0, f.path.lastIndexOf('/')) || '/')
    FS.writeFile(f.path, f.data)
  }
  takeSnapshot()
}

/** What Python changed under /home/user since the last snapshot. */
function collectChanges(): FsChanges {
  const FS = py!.FS
  const seen = new Set<string>()
  const changes: FsChanges = { files: [], dirs: [], deletes: [] }
  walk(HOME, (p, isDir, st) => {
    seen.add(p)
    const before = snapshot.get(p)
    if (isDir) {
      if (before !== 'dir') changes.dirs.push(p)
    } else if (before !== stamp(st)) {
      changes.files.push({ path: p, data: FS.readFile(p) })
    }
  })
  for (const p of snapshot.keys()) {
    // Only report the top-most deleted path; its children go with it.
    if (!seen.has(p) && !changes.deletes.some((d) => p.startsWith(d + '/'))) changes.deletes.push(p)
  }
  takeSnapshot()
  return changes
}

// ------------------------------------------------------------------- runs

function toJs(v: unknown): unknown {
  if (v && typeof v === 'object' && 'toJs' in (v as object)) {
    const proxy = v as PyProxy
    const js = proxy.toJs({ dict_converter: Object.fromEntries })
    proxy.destroy()
    return js
  }
  return v
}

async function loadImports(id: number, code: string) {
  await py!.loadPackagesFromImports(code, {
    messageCallback: (m) => post({ type: 'status', id, text: m }),
    errorCallback: (m) => post({ type: 'stderr', id, text: m + '\n' }),
  })
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  if (msg.type === 'init') return init()
  if (!py || !runtime) await init()
  const rt = runtime!
  switch (msg.type) {
    case 'fs':
      applyChanges(msg.changes)
      return null
    case 'cell':
      await loadImports(msg.id, msg.code)
      return toJs(await (rt.run_cell(msg.code, msg.ns) as Promise<unknown>))
    case 'repl':
      await loadImports(msg.id, msg.line)
      return toJs(await (rt.run_repl_line(msg.line, msg.ns) as Promise<unknown>))
    case 'repl-cancel':
      rt.repl_reset_buffer(msg.ns)
      return null
    case 'script': {
      const FS = py!.FS
      if (FS.analyzePath(msg.path).exists) {
        const source = new TextDecoder().decode(FS.readFile(msg.path))
        await loadImports(msg.id, source)
      }
      return toJs(await (rt.run_script(msg.path, msg.argv, msg.cwd) as Promise<unknown>))
    }
    case 'install': {
      await py!.loadPackage('micropip', { messageCallback: (m) => post({ type: 'status', id: msg.id, text: m }) })
      const micropip = py!.pyimport('micropip')
      for (const pkg of msg.packages) {
        post({ type: 'status', id: msg.id, text: `Installing ${pkg}…` })
        await (micropip.install(pkg) as Promise<unknown>)
        post({ type: 'stdout', id: msg.id, text: `Installed ${pkg}\n` })
      }
      return null
    }
    case 'reset':
      rt.reset(msg.ns)
      return null
  }
}

// Requests run strictly one after another, like a real Python process.
let queue: Promise<void> = Promise.resolve()

ctx.onmessage = (e) => {
  const msg = e.data
  queue = queue.then(async () => {
    currentId = msg.id
    try {
      const value = await handle(msg)
      const changes = py && msg.type !== 'fs' && msg.type !== 'init' ? collectChanges() : { files: [], dirs: [], deletes: [] }
      post({ type: 'done', id: msg.id, value, changes }, changes.files.map((f) => f.data.buffer as ArrayBuffer))
    } catch (err) {
      post({ type: 'fail', id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
