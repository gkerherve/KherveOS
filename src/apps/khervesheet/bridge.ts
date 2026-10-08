// KherveSheet's Python: the window's own Pyodide worker (PythonKernel) with
// the desktop's calculation core (khervesheet/core, unchanged) and the web
// bridge (ksweb) installed in it, from public/apps/khervesheet/py/.
//
// Requests queue up while Python is busy and go together in one run; each
// answer comes back as JSON between two markers on stdout, so a =PY cell's
// own printing can never be mistaken for it.

import { PythonKernel, type KernelStatus } from '@/os/python/kernel'

const BASE = `${import.meta.env.BASE_URL}apps/khervesheet/py/`
const ROOT = '/kherveos/khervesheet'
const START = '\x02KS-JSON\x03'
const END = '\x02/KS-JSON\x03'

/** The Python files installed in the worker (relative to py/). */
export const PY_FILES = [
  'khervesheet/__init__.py',
  'khervesheet/core/__init__.py',
  'khervesheet/core/catalog.py',
  'khervesheet/core/charts.py',
  'khervesheet/core/compiler.py',
  'khervesheet/core/engine.py',
  'khervesheet/core/fitting.py',
  'khervesheet/core/functions.py',
  'khervesheet/core/numbers.py',
  'khervesheet/core/python.py',
  'khervesheet/core/refs.py',
  'khervesheet/core/solver.py',
  'khervesheet/core/values.py',
  'khervesheet/core/xlsx.py',
  'ksweb/__init__.py',
  'ksweb/bridge.py',
  'ksweb/chartsio.py',
  'ksweb/edit.py',
  'ksweb/ksheetio.py',
  'ksweb/workbook.py',
]

export interface Answer {
  ok: boolean
  error?: string
  trace?: string
  [field: string]: unknown
}

interface Job {
  op: string
  args: unknown
  hints: string[]
  resolve: (a: Answer) => void
  reject: (e: Error) => void
}

/** A Python string literal (JSON's escapes are all valid Python). */
const pyStr = (s: string) => JSON.stringify(s)

const INSTALL = `def _ks_install(files, root):
    import importlib, os, sys
    for rel, text in files.items():
        path = root + '/' + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    if root not in sys.path:
        sys.path.insert(0, root)
    for name in [m for m in sys.modules if m.split('.')[0] in ('ksweb', 'khervesheet')]:
        del sys.modules[name]
    importlib.invalidate_caches()
`

export class SheetBridge {
  readonly kernel: PythonKernel
  /** Package-loading messages ("Loading numpy…"), or null. */
  onProgress: (text: string | null) => void = () => {}
  /** Requests waiting or running. */
  onBusy: (n: number) => void = () => {}
  /** Python had to start again: the requests that rebuild the workbook. */
  onRestart: () => { op: string; args: unknown }[] = () => []

  private queue: Job[] = []
  private running = false
  private installedFor: PythonKernel | null = null
  private generation = 0
  private files: Promise<Record<string, string>> | null = null
  private waiters: (() => void)[] = []
  private unsub: () => void
  private disposed = false

  constructor(ns: string) {
    this.kernel = new PythonKernel(ns)
    this.unsub = this.kernel.onStatus((s: KernelStatus) => {
      if (s === 'off' || s === 'dead') this.installedFor = null
    })
  }

  get status(): KernelStatus {
    return this.kernel.status
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  /** Queue a request; `hints` are packages it will need (loaded first, with progress). */
  call<T extends Answer = Answer>(op: string, args: unknown = {}, hints: string[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ op, args, hints, resolve: resolve as (a: Answer) => void, reject })
      this.onBusy(this.pending)
      void this.pump()
    })
  }

  /** Resolves once nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  dispose() {
    this.disposed = true
    this.unsub()
    for (const j of this.queue) j.reject(new Error('kSheet was closed.'))
    this.queue = []
    this.kernel.dispose()
  }

  private loadFiles(): Promise<Record<string, string>> {
    this.files ??= Promise.all(
      PY_FILES.map(async (rel) => {
        const r = await fetch(BASE + rel, { cache: 'no-cache' })
        if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`)
        return [rel, await r.text()] as const
      }),
    )
      .then((pairs) => Object.fromEntries(pairs))
      .catch((e: unknown) => {
        this.files = null
        throw e
      })
    return this.files
  }

  private async install() {
    const files = await this.loadFiles()
    await this.kernel.start()
    const code = `${INSTALL}_ks_install(__import__('json').loads(${pyStr(JSON.stringify(files))}), ${pyStr(ROOT)})\ndel _ks_install`
    const r = await this.kernel.runCell(code)
    if (!r.ok) throw new Error(r.error?.message ?? 'The spreadsheet engine could not be installed.')
    this.installedFor = this.kernel
    this.generation++
  }

  private async pump() {
    if (this.running || this.disposed) return
    this.running = true
    try {
      while (this.queue.length && !this.disposed) {
        let restart: { op: string; args: unknown }[] = []
        if (this.installedFor !== this.kernel || this.kernel.status === 'off' || this.kernel.status === 'dead') {
          const before = this.generation
          try {
            await this.install()
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            for (const j of this.queue.splice(0)) j.reject(err)
            break
          }
          if (before > 0) restart = this.onRestart()
        }
        const jobs = this.queue.splice(0)
        await this.runBatch(jobs, restart)
      }
    } finally {
      this.running = false
      this.onBusy(this.pending)
      if (!this.queue.length) for (const w of this.waiters.splice(0)) w()
      else void this.pump()
    }
  }

  private async runBatch(jobs: Job[], restart: { op: string; args: unknown }[]) {
    const hints = new Set<string>(['numpy'])
    for (const j of jobs) for (const h of j.hints) if (/^[a-z_][a-z0-9_]*$/i.test(h)) hints.add(h)
    const requests = [...restart, ...jobs.map((j) => ({ op: j.op, args: j.args }))]
    const head = `if False:\n    import ${[...hints].join(', ')}\n`
    const code = `${head}await __import__('ksweb.bridge', fromlist=['run']).run(${pyStr(JSON.stringify(requests))})`
    let out = ''
    let answers: Answer[] | null = null
    let failure: Error | null = null
    try {
      const r = await this.kernel.runCell(code, {
        onStdout: (t) => (out += t),
        onStatus: (t) => this.onProgress(t),
      })
      const i = out.lastIndexOf(START)
      const k = i >= 0 ? out.indexOf(END, i) : -1
      if (i >= 0 && k > i) answers = JSON.parse(out.slice(i + START.length, k)) as Answer[]
      else failure = new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'Python gave no answer.')
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e))
    } finally {
      this.onProgress(null)
    }
    if (!answers || answers.length !== requests.length) {
      const err = failure ?? new Error('Python answered the wrong number of requests.')
      for (const j of jobs) j.reject(err)
      return
    }
    const own = answers.slice(restart.length)
    jobs.forEach((j, n) => j.resolve(own[n]))
  }
}
