// KherveCalc's link to its Python engine: the window's own Pyodide worker
// (PythonKernel) with engine.py installed as the module kcalc_engine.
// Requests run one at a time; a newer live preview replaces an older one
// still waiting. Cancel = restart Python (then the session is replayed).

import { PythonKernel, type CellResult, type KernelStatus } from '@/os/python/kernel'
import ENGINE_SRC from './engine.py?raw'
import { between, installCode, requestCode } from './pyglue'

export interface Pending {
  op: string
  /** Since when the current request runs (ms), for "computing… 3 s". */
  since: number
}

type Job = {
  req: Record<string, unknown>
  resolve: (v: Record<string, unknown> | null) => void
  reject: (e: Error) => void
}

export class CalcBridge {
  readonly kernel: PythonKernel
  /** Busy state changed (null = idle). */
  onBusy: (p: Pending | null) => void = () => {}
  /** Package downloads ("Loading scipy…") while Python starts. */
  onProgress: (text: string | null) => void = () => {}
  /** The engine was (re)installed: the app replays its session. */
  onRestarted: () => Promise<void> = async () => {}

  private queue: Job[] = []
  private running = false
  private installedFor: PythonKernel | null = null
  private installing: Promise<void> | null = null
  private disposed = false
  /** Bumped by cancel(): answers of an older generation are "Cancelled". */
  private generation = 0
  private unsub: () => void

  constructor(ns: string) {
    this.kernel = new PythonKernel(ns)
    this.unsub = this.kernel.onStatus((s: KernelStatus) => {
      if (s === 'off' || s === 'dead') this.installedFor = null
    })
  }

  get status(): KernelStatus {
    return this.kernel.status
  }

  /** Send a request to the engine. Resolves with its answer (or null when a newer preview replaced it). */
  call<T = Record<string, unknown>>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    return new Promise<Record<string, unknown> | null>((resolve, reject) => {
      if (op === 'preview') {
        // only the latest preview matters
        for (const j of this.queue.filter((q) => q.req.op === 'preview')) j.resolve(null)
        this.queue = this.queue.filter((q) => q.req.op !== 'preview')
      }
      this.queue.push({ req: { op, ...args }, resolve, reject })
      void this.pump()
    }) as Promise<T>
  }

  /** Run Python code in the calculator's namespace (the Programs tab). */
  async runProgram(code: string, onOut: (kind: 'out' | 'err' | 'info', text: string) => void): Promise<CellResult> {
    await this.ensure()
    this.running = true
    this.onBusy({ op: 'program', since: Date.now() })
    try {
      return await this.kernel.runCell(code, {
        onStdout: (t) => onOut('out', t),
        onStderr: (t) => onOut('err', t),
        onStatus: (t) => onOut('info', t.endsWith('\n') ? t : t + '\n'),
      })
    } finally {
      this.running = false
      this.onBusy(null)
      void this.pump()
    }
  }

  /** Stop whatever runs (restart Python). Waiting requests fail; the session is replayed. */
  async cancel(): Promise<void> {
    const err = new Error('Cancelled')
    this.generation++
    for (const j of this.queue.splice(0)) j.reject(err)
    this.installedFor = null
    this.installing = null
    await this.kernel.restart().catch(() => {})
    this.onBusy(null)
    try {
      await this.ensure()
    } catch {
      /* reported on the next call */
    }
  }

  dispose() {
    this.disposed = true
    this.unsub()
    for (const j of this.queue.splice(0)) j.reject(new Error('kCalc was closed.'))
    this.kernel.dispose()
  }

  /** Python running with the engine installed (installs it after a start or a restart). */
  async ensure(): Promise<void> {
    if (this.installedFor === this.kernel && this.kernel.status !== 'off' && this.kernel.status !== 'dead') return
    this.installing ??= this.install().finally(() => (this.installing = null))
    await this.installing
  }

  private async install() {
    this.onProgress('Starting Python…')
    try {
      await this.kernel.start()
      const code = installCode(ENGINE_SRC)
      const r = await this.kernel.runCell(code, { onStatus: (t) => this.onProgress(t) })
      if (!r.ok) throw new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'The engine could not start.')
      this.installedFor = this.kernel
    } finally {
      this.onProgress(null)
    }
    // Put the session back (definitions, lists, earlier answers): after the first start and after a cancel.
    await this.onRestarted()
  }

  /** A request straight to the engine (used while replaying, outside the queue). */
  async direct(op: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.exec({ op, ...args })
  }

  private async exec(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    const b64 = toBase64(new TextEncoder().encode(JSON.stringify(req)))
    let out = ''
    const r = await this.kernel.runCell(requestCode(b64), { onStdout: (t) => (out += t) })
    const answer = between(out)
    if (!r.ok || answer === null) throw new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'The engine gave no answer.')
    return JSON.parse(new TextDecoder().decode(fromBase64(answer))) as Record<string, unknown>
  }

  private async pump() {
    if (this.running || this.disposed) return
    const job = this.queue.shift()
    if (!job) return
    this.running = true
    this.onBusy({ op: String(job.req.op), since: Date.now() })
    const gen = this.generation
    try {
      await this.ensure()
      job.resolve(await this.exec(job.req))
    } catch (e) {
      job.reject(gen !== this.generation ? new Error('Cancelled') : e instanceof Error ? e : new Error(String(e)))
    } finally {
      this.running = false
      if (!this.queue.length) this.onBusy(null)
      void this.pump()
    }
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
