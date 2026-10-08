// KherveFitting's Python: the window's own Pyodide worker (PythonKernel)
// with the desktop's wx-free fitting core (kfcore, from KherveFitting's
// Functions.py and libraries/) and the web bridge (kfweb) installed in it,
// from public/apps/khervefitting/py/.
//
// Requests queue up while Python is busy and go together in one run; the
// answers come back as JSON between two markers on stdout, so anything the
// desktop code prints can never be mistaken for them.

import { PythonKernel, type KernelStatus } from '@/os/python/kernel'
import type { View } from './model'

const BASE = `${import.meta.env.BASE_URL}apps/khervefitting/py/`
const ROOT = '/kherveos/khervefitting'
const START = '\x02KF-JSON\x03'
const END = '\x02/KF-JSON\x03'

/** The files installed in the worker (relative to py/). */
export const PY_FILES = [
  'kfcore/__init__.py',
  'kfcore/compat.py',
  'kfcore/numberformat.py',
  'kfcore/shirley.py',
  'kfcore/peak_functions.py',
  'kfcore/backgrounds.py',
  'kfcore/grid.py',
  'kfcore/session.py',
  'kfcore/uncertainty.py',
  'kfcore/fitting.py',
  'kfcore/sheets.py',
  'kfcore/background.py',
  'kfcore/curves.py',
  'kfcore/results.py',
  'kfcore/workbook.py',
  'kfcore/importers.py',
  // dev-AI tools (kfweb/features.py)
  'kfcore/peaklib.py',
  'kfcore/sheetops.py',
  'kfcore/becorr.py',
  'kfcore/samples.py',
  'kfcore/survey.py',
  'kfcore/dparam.py',
  'kfcore/area.py',
  'kfcore/pca.py',
  'kfcore/fitops.py',
  'kfcore/interact.py',
  'kfweb/__init__.py',
  'kfweb/gridstyle.py',
  'kfweb/tables.py',
  'kfweb/features.py',
  'kfweb/bridge.py',
  'data/library.json',
  'data/autoid.json',
  'data/splittings.json',
]

/**
 * The pure-Python packages the engine needs that Pyodide does not ship, at the
 * desktop's versions (KherveFittingPro requirements.txt), served with the app
 * from py/wheels/ and unpacked in the worker: installing them from PyPI with
 * micropip could stall "Opening…" for minutes, or fail offline.
 */
export const WHEELS = [
  'lmfit-1.3.2-py3-none-any.whl',
  'asteval-1.0.5-py3-none-any.whl',
  'dill-0.4.1-py3-none-any.whl',
  'openpyxl-3.1.2-py2.py3-none-any.whl',
  'et_xmlfile-1.1.0-py3-none-any.whl',
  'vamas-0.1.1-py3-none-any.whl',
]

/** Files the engine runs without (a missing one is skipped). */
const OPTIONAL = new Set<string>()

export interface Answer {
  ok: boolean
  error?: string
  trace?: string
  rejected?: boolean
  view?: View
  canUndo?: boolean
  canRedo?: boolean
  [field: string]: unknown
}

/**
 * How a bridge installs its Python and talks to it. KherveFitting's own is the
 * default; the technique apps (src/apps/khervetech) bring theirs.
 */
export interface BridgeConfig {
  /** The Python cell that installs the engine in a fresh worker. */
  install: () => Promise<string>
  /** The Python cell that answers a batch of requests (printing the answers). */
  run: (requests: { op: string; args: unknown }[]) => string
  /** The answers in what that cell printed, or null. */
  parse: (out: string) => Answer[] | null
  /** Named in the error requests get when the window closes. */
  name?: string
}

interface Job {
  op: string
  args: unknown
  resolve: (a: Answer) => void
  reject: (e: Error) => void
}

/** A Python string literal (JSON's escapes are all valid Python). */
const pyStr = (s: string) => JSON.stringify(s)

const INSTALL = `def _kf_wheels(wheels, root):
    import base64, io, os, zipfile
    site = root + '/site'
    os.makedirs(site, exist_ok=True)
    for name, b64 in wheels.items():
        mark = site + '/.' + name
        if os.path.exists(mark):
            continue
        zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))).extractall(site)
        open(mark, 'w').close()


def _kf_install(files, root):
    import importlib, os, sys
    for rel, text in files.items():
        path = root + '/' + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    if root not in sys.path:
        sys.path.insert(0, root)
    site = root + '/site'
    if site not in sys.path:
        sys.path.insert(1, site)
    for name in [m for m in sys.modules if m.split('.')[0] in ('kfweb', 'kfcore')]:
        del sys.modules[name]
    importlib.invalidate_caches()
`

export class FitBridge {
  readonly kernel: PythonKernel
  /** Package-loading messages ("Loading scipy…"), or null. */
  onProgress: (text: string | null) => void = () => {}
  /** Requests waiting or running. */
  onBusy: (n: number) => void = () => {}
  /** Python stopped and started again: the open file is gone. */
  onLost: () => void = () => {}

  private queue: Job[] = []
  private running = false
  private installedFor: PythonKernel | null = null
  private installs = 0
  private files: Promise<Record<string, string>> | null = null
  private wheels: Promise<Record<string, string>> | null = null
  private waiters: (() => void)[] = []
  private unsub: () => void
  private disposed = false

  private readonly config: BridgeConfig

  constructor(ns: string, config?: BridgeConfig) {
    this.config = config ?? {
      install: () => this.kfInstall(),
      run: (requests) => `await __import__('kfweb.bridge', fromlist=['run']).run(${pyStr(JSON.stringify(requests))})`,
      parse: (out) => {
        const i = out.lastIndexOf(START)
        const k = i >= 0 ? out.indexOf(END, i) : -1
        return i >= 0 && k > i ? (JSON.parse(out.slice(i + START.length, k)) as Answer[]) : null
      },
    }
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

  /** Queue a request. */
  call(op: string, args: unknown = {}): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      this.queue.push({ op, args, resolve, reject })
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
    for (const j of this.queue) j.reject(new Error(`${this.config.name ?? 'KherveFitting'} was closed.`))
    this.queue = []
    this.kernel.dispose()
  }

  private loadFiles(): Promise<Record<string, string>> {
    this.files ??= Promise.all(
      PY_FILES.map(async (rel) => {
        const r = await fetch(BASE + rel, { cache: 'no-cache' })
        if (!r.ok) {
          if (OPTIONAL.has(rel)) return null
          throw new Error(`${rel}: HTTP ${r.status}`)
        }
        return [rel, await r.text()] as const
      }),
    )
      .then((pairs) => Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)))
      .catch((e: unknown) => {
        this.files = null
        throw e
      })
    return this.files
  }

  private loadWheels(): Promise<Record<string, string>> {
    this.wheels ??= Promise.all(
      WHEELS.map(async (w) => {
        const r = await fetch(`${BASE}wheels/${w}`)
        if (!r.ok) throw new Error(`wheels/${w}: HTTP ${r.status}`)
        return [w, toBase64(new Uint8Array(await r.arrayBuffer()))] as const
      }),
    )
      .then((pairs) => Object.fromEntries(pairs))
      .catch((e: unknown) => {
        this.wheels = null
        throw e
      })
    return this.wheels
  }

  private async kfInstall(): Promise<string> {
    const [files, wheels] = await Promise.all([this.loadFiles(), this.loadWheels()])
    return (
      `${INSTALL}_kf_wheels(__import__('json').loads(${pyStr(JSON.stringify(wheels))}), ${pyStr(ROOT)})\n` +
      `_kf_install(__import__('json').loads(${pyStr(JSON.stringify(files))}), ${pyStr(ROOT)})\ndel _kf_install, _kf_wheels`
    )
  }

  private async install() {
    const code = await this.config.install()
    await this.kernel.start()
    const r = await this.kernel.runCell(code)
    if (!r.ok) throw new Error(r.error?.message ?? 'The fitting engine could not be installed.')
    this.installedFor = this.kernel
    this.installs++
  }

  private async pump() {
    if (this.running || this.disposed) return
    this.running = true
    try {
      while (this.queue.length && !this.disposed) {
        if (this.installedFor !== this.kernel || this.kernel.status === 'off' || this.kernel.status === 'dead') {
          const again = this.installs > 0
          try {
            await this.install()
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            for (const j of this.queue.splice(0)) j.reject(err)
            break
          }
          if (again) this.onLost()
        }
        await this.runBatch(this.queue.splice(0))
      }
    } finally {
      this.running = false
      this.onBusy(this.pending)
      if (!this.queue.length) for (const w of this.waiters.splice(0)) w()
      else void this.pump()
    }
  }

  private async runBatch(jobs: Job[]) {
    const requests = jobs.map((j) => ({ op: j.op, args: j.args }))
    const code = this.config.run(requests)
    let out = ''
    let answers: Answer[] | null = null
    let failure: Error | null = null
    try {
      const r = await this.kernel.runCell(code, {
        onStdout: (t) => (out += t),
        onStatus: (t) => this.onProgress(t),
      })
      answers = this.config.parse(out)
      if (!answers) failure = new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'Python gave no answer.')
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e))
    } finally {
      this.onProgress(null)
    }
    if (!answers || answers.length !== jobs.length) {
      const err = failure ?? new Error('Python answered the wrong number of requests.')
      for (const j of jobs) j.reject(err)
      return
    }
    jobs.forEach((j, n) => j.resolve(answers[n]))
  }
}

// ---------------------------------------------------------------- bytes

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
