// A Python "process" for an app: wraps one Pyodide worker (worker.ts).
//
//   const py = new PythonKernel('notebook-1')
//   const r = await py.runCell('1 + 1', { onStdout: (t) => … })   // r.result === '2'
//
// Each kernel has its own worker, so one app's long computation never blocks
// another app. The first start downloads Python (~10 MB, then cached by the
// browser). Files under /home/user are kept in sync both ways automatically.

import { fs, type FsEvent } from '../vfs'
import { HOME, isInside } from '../path'
import type { FsChanges, WorkerRequest, WorkerResponse } from './worker'

export type KernelStatus = 'off' | 'starting' | 'idle' | 'busy' | 'dead'

export interface RunHandlers {
  onStdout?: (text: string) => void
  onStderr?: (text: string) => void
  /** Progress messages such as "Loading numpy, scipy". */
  onStatus?: (text: string) => void
}

export interface PyError {
  type: string
  message: string
  traceback: string
}

export interface CellResult {
  ok: boolean
  /** repr() of the cell's trailing expression, if it had one. */
  result: string | null
  /** matplotlib figures, base64-encoded PNG (no data: prefix). */
  figures: string[]
  error: PyError | null
}

export interface ReplResult {
  ok: boolean
  /** The statement is incomplete: show a "..." prompt and send the next line. */
  more: boolean
  /** The user typed exit() / quit(). */
  exit?: boolean
  figures: string[]
}

export interface ScriptResult {
  ok: boolean
  exit_code: number
  figures: string[]
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  handlers?: RunHandlers
}

type Dirty = 'put' | 'dir' | 'delete'

export class PythonKernel {
  readonly ns: string
  status: KernelStatus = 'off'
  version: string | null = null

  private worker: Worker | null = null
  private starting: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<(s: KernelStatus) => void>()
  private dirty = new Map<string, Dirty>()
  private applying = new Set<string>()
  private unwatch: (() => void) | null = null
  private busy = 0

  constructor(ns = 'main') {
    this.ns = ns
  }

  // ------------------------------------------------------------- lifecycle

  /** Load Python (if not already). Safe to call many times. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.boot()
    return this.starting
  }

  private async boot() {
    this.setStatus('starting')
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `python-${this.ns}` })
    this.worker = worker
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => void this.onMessage(e.data)
    worker.onerror = (e) => {
      e.preventDefault()
      if (this.worker !== worker) return // an old, already replaced worker
      this.terminate(new Error(e.message || 'Python stopped unexpectedly.'))
      this.setStatus('dead')
    }
    // restart()/dispose() may replace or stop this worker while it is still starting.
    const superseded = () => this.worker !== worker
    try {
      this.version = (await this.request({ type: 'init' })) as string
      if (superseded()) throw new Error('Python was restarted.')
      // Mirror the whole home folder into Python, then follow changes.
      this.dirty.clear()
      this.unwatch?.()
      this.unwatch = fs.watch((ev) => this.onFsEvent(ev))
      const changes: FsChanges = { files: [], dirs: [], deletes: [] }
      for (const s of fs.walk(HOME)) {
        if (s.type === 'dir') changes.dirs.push(s.path)
        else changes.files.push({ path: s.path, data: await fs.readBytes(s.path) })
      }
      if (superseded()) throw new Error('Python was restarted.')
      await this.request({ type: 'fs', changes }, undefined, changes.files.map((f) => f.data.buffer as ArrayBuffer))
      if (superseded()) throw new Error('Python was restarted.')
      this.setStatus('idle')
    } catch (err) {
      worker.terminate()
      // Only clean up if this is still the current worker; otherwise a newer
      // start owns the state and must not be clobbered.
      if (superseded()) throw err instanceof Error ? err : new Error(String(err))
      this.setStatus('dead')
      this.starting = null
      this.worker = null
      throw new Error(
        `Python could not start: ${err instanceof Error ? err.message : String(err)}. It is downloaded from cdn.jsdelivr.net the first time — check your internet connection.`,
      )
    }
  }

  /** Stop Python and start a fresh one. Variables are lost; files are kept. */
  async restart(): Promise<void> {
    this.terminate(new Error('Python was restarted.'))
    await this.start()
  }

  /** Stop Python for good (call when the app's window closes). */
  dispose() {
    this.terminate(new Error('Python was stopped.'))
    this.listeners.clear()
  }

  private terminate(reason: Error) {
    this.worker?.terminate()
    this.worker = null
    this.starting = null
    this.unwatch?.()
    this.unwatch = null
    for (const p of this.pending.values()) p.reject(reason)
    this.pending.clear()
    this.busy = 0
    this.setStatus('off')
  }

  onStatus(cb: (s: KernelStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setStatus(s: KernelStatus) {
    if (this.status === s) return
    this.status = s
    for (const cb of [...this.listeners]) cb(s)
  }

  // ------------------------------------------------------------------ runs

  /** Run a notebook cell: shared variables, trailing expression echoed, figures captured. */
  runCell(code: string, handlers?: RunHandlers): Promise<CellResult> {
    return this.run({ type: 'cell', code, ns: this.ns }, handlers) as Promise<CellResult>
  }

  /** Feed one line to the interactive prompt (>>> / ...). */
  runReplLine(line: string, handlers?: RunHandlers): Promise<ReplResult> {
    return this.run({ type: 'repl', line, ns: this.ns }, handlers) as Promise<ReplResult>
  }

  /** Forget a half-typed multi-line statement (Ctrl+C at a "..." prompt). */
  cancelReplInput(): Promise<void> {
    return this.run({ type: 'repl-cancel', ns: this.ns }) as Promise<void>
  }

  /** `python path args…` — a fresh __main__ each time. */
  runScript(path: string, argv: string[], cwd: string, handlers?: RunHandlers): Promise<ScriptResult> {
    return this.run({ type: 'script', path, argv, cwd }, handlers) as Promise<ScriptResult>
  }

  /** pip-install pure-Python packages from PyPI (via micropip). */
  install(packages: string[], handlers?: RunHandlers): Promise<void> {
    return this.run({ type: 'install', packages }, handlers) as Promise<void>
  }

  /** Forget all variables of this kernel's namespace (keeps Python loaded). */
  resetNamespace(): Promise<void> {
    return this.run({ type: 'reset', ns: this.ns }) as Promise<void>
  }

  private async run(msg: DistributiveOmit<WorkerRequest, 'id'>, handlers?: RunHandlers): Promise<unknown> {
    await this.start()
    await this.flush()
    this.busy++
    this.setStatus('busy')
    try {
      return await this.request(msg, handlers)
    } finally {
      this.busy = Math.max(0, this.busy - 1)
      if (this.busy === 0 && this.worker) this.setStatus('idle')
    }
  }

  private request(msg: DistributiveOmit<WorkerRequest, 'id'>, handlers?: RunHandlers, transfer?: Transferable[]): Promise<unknown> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('Python is not running.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, handlers })
      worker.postMessage({ ...msg, id } as WorkerRequest, transfer ?? [])
    })
  }

  private async onMessage(msg: WorkerResponse) {
    const p = this.pending.get(msg.id)
    switch (msg.type) {
      case 'stdout':
        p?.handlers?.onStdout?.(msg.text)
        return
      case 'stderr':
        p?.handlers?.onStderr?.(msg.text)
        return
      case 'status':
        p?.handlers?.onStatus?.(msg.text)
        return
      case 'done':
        this.pending.delete(msg.id)
        try {
          await this.applyFromPython(msg.changes)
        } catch (e) {
          console.error('[python] could not save files written by Python', e)
        }
        p?.resolve(msg.value)
        return
      case 'fail':
        this.pending.delete(msg.id)
        p?.reject(new Error(msg.error))
        return
    }
  }

  // ------------------------------------------------------------ file sync

  private onFsEvent(ev: FsEvent) {
    if (this.applying.has(ev.path)) return
    const touch = (path: string, kind: Dirty) => {
      if (!isInside(path, HOME)) return
      if (kind === 'delete') for (const k of [...this.dirty.keys()]) if (isInside(k, path)) this.dirty.delete(k)
      this.dirty.set(path, kind)
    }
    if (ev.type === 'rename') {
      touch(ev.oldPath, 'delete')
      if (ev.kind === 'dir') {
        touch(ev.path, 'dir')
        for (const s of fs.walk(ev.path)) touch(s.path, s.type === 'dir' ? 'dir' : 'put')
      } else touch(ev.path, 'put')
    } else if (ev.type === 'delete') touch(ev.path, 'delete')
    else if (ev.path === '/' && ev.type === 'change') {
      // The whole drive was reset: start the mirror again from scratch.
      touch(HOME, 'delete')
      touch(HOME, 'dir')
      for (const s of fs.walk(HOME)) touch(s.path, s.type === 'dir' ? 'dir' : 'put')
    } else touch(ev.path, ev.kind === 'dir' ? 'dir' : 'put')
  }

  private async flush() {
    if (!this.dirty.size || !this.worker) return
    const entries = [...this.dirty]
    this.dirty.clear()
    const changes: FsChanges = { files: [], dirs: [], deletes: [] }
    for (const [path, kind] of entries) {
      if (kind === 'delete') changes.deletes.push(path)
      else if (kind === 'dir') changes.dirs.push(path)
      else if (fs.isFile(path)) changes.files.push({ path, data: await fs.readBytes(path) })
    }
    await this.request({ type: 'fs', changes }, undefined, changes.files.map((f) => f.data.buffer as ArrayBuffer))
  }

  private async applyFromPython(ch: FsChanges) {
    if (!ch.files.length && !ch.dirs.length && !ch.deletes.length) return
    const all = [...ch.deletes, ...ch.dirs, ...ch.files.map((f) => f.path)]
    all.forEach((p) => this.applying.add(p))
    try {
      for (const d of ch.deletes) if (fs.exists(d)) await fs.remove(d, { recursive: true }).catch(() => {})
      for (const d of ch.dirs) await fs.mkdir(d, { recursive: true }).catch(() => {})
      for (const f of ch.files) await fs.writeBytes(f.path, f.data, { mkdirs: true }).catch(() => {})
    } finally {
      all.forEach((p) => this.applying.delete(p))
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** "data:image/png;base64,…" for an <img src>. */
export const figureUrl = (b64: string) => `data:image/png;base64,${b64}`
