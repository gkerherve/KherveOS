// KherveMol's Python: the window's own Pyodide worker (PythonKernel) with the
// desktop's engine (public/apps/khervemol/py/khervemol — the desktop modules,
// unchanged), a PyQt5 stand-in (only QColor does anything) and the web bridge
// (kmweb). Requests queue while Python is busy and go together in one run;
// the answers come back as JSON between two markers on stdout.

import { PythonKernel, type KernelStatus } from '@/os/python/kernel'
import type { Mol } from './types'

const BASE = `${import.meta.env.BASE_URL}apps/khervemol/py/`
const ROOT = '/kherveos/khervemol'
const START = '\x02KM-JSON\x03'
const END = '\x02/KM-JSON\x03'

/** The files installed in the worker besides the desktop modules (khervemol/files.json lists those). */
const OWN_FILES = [
  'PyQt5/__init__.py',
  'PyQt5/_stub.py',
  'PyQt5/QtCore.py',
  'PyQt5/QtGui.py',
  'PyQt5/QtWidgets.py',
  'kmweb/__init__.py',
  'kmweb/readers.py',
  'kmweb/bridge.py',
]
/** ASE for CIF files (as the desktop's symmetry.py), from PyPI, served with KherveOS. */
const ASE_WHEEL = 'ase-3.29.0-py3-none-any.whl'

export interface Answer {
  ok: boolean
  error?: string
  trace?: string
  rejected?: boolean
  /** A newer request of the same kind replaced this one before it ran. */
  superseded?: boolean
  mol?: Mol
  [field: string]: unknown
}

interface Job {
  op: string
  args: unknown
  key?: string
  resolve: (a: Answer) => void
  reject: (e: Error) => void
}

const pyStr = (s: string) => JSON.stringify(s)

const INSTALL = `def _km_install(files, root):
    import importlib, os, sys
    for rel, text in files.items():
        path = root + '/' + rel
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    for p in (root,):
        if p not in sys.path:
            sys.path.insert(0, p)
    for name in [m for m in sys.modules if m.split('.')[0] in ('kmweb', 'khervemol', 'PyQt5')]:
        del sys.modules[name]
    importlib.invalidate_caches()
    os.environ['KHERVEMOL_WHEELS'] = root + '/wheels'
`

export class MolBridge {
  readonly kernel: PythonKernel
  /** Package-loading messages ("Loading scipy…"), or null. */
  onProgress: (text: string | null) => void = () => {}
  onBusy: (n: number) => void = () => {}
  /** Python stopped and started again: the structure in it is gone. */
  onLost: () => void = () => {}

  private queue: Job[] = []
  private running = false
  private installedFor: PythonKernel | null = null
  private installs = 0
  private files: Promise<Record<string, string>> | null = null
  private aseFor: PythonKernel | null = null
  private unsub: () => void
  private disposed = false

  constructor(ns: string) {
    this.kernel = new PythonKernel(ns)
    this.unsub = this.kernel.onStatus((s: KernelStatus) => {
      if (s === 'off' || s === 'dead') {
        this.installedFor = null
        this.aseFor = null
      }
    })
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  call(op: string, args: unknown = {}): Promise<Answer> {
    return new Promise<Answer>((resolve, reject) => {
      this.queue.push({ op, args, resolve, reject })
      this.onBusy(this.pending)
      void this.pump()
    })
  }

  /** Like call, but a still-waiting request with the same key is replaced (drags, sliders). */
  latest(key: string, op: string, args: unknown = {}): Promise<Answer> {
    const old = this.queue.find((j) => j.key === key)
    if (old) {
      this.queue = this.queue.filter((j) => j !== old)
      old.resolve({ ok: false, superseded: true })
    }
    return new Promise<Answer>((resolve, reject) => {
      this.queue.push({ op, args, key, resolve, reject })
      this.onBusy(this.pending)
      void this.pump()
    })
  }

  dispose() {
    this.disposed = true
    this.unsub()
    for (const j of this.queue) j.reject(new Error('kMol was closed.'))
    this.queue = []
    this.kernel.dispose()
  }

  private loadFiles(): Promise<Record<string, string>> {
    this.files ??= (async () => {
      const r = await fetch(`${BASE}files.json`, { cache: 'no-cache' })
      if (!r.ok) throw new Error(`files.json: HTTP ${r.status}`)
      const engine = (await r.json()) as string[]
      const all = [...engine, ...OWN_FILES]
      const pairs = await Promise.all(
        all.map(async (rel) => {
          const f = await fetch(BASE + rel, { cache: 'no-cache' })
          if (!f.ok) throw new Error(`${rel}: HTTP ${f.status}`)
          return [rel, await f.text()] as const
        }),
      )
      return Object.fromEntries(pairs)
    })().catch((e: unknown) => {
      this.files = null
      throw e
    })
    return this.files
  }

  private async install() {
    const files = await this.loadFiles()
    await this.kernel.start()
    const code = `${INSTALL}_km_install(__import__('json').loads(${pyStr(JSON.stringify(files))}), ${pyStr(ROOT)})\ndel _km_install`
    const r = await this.kernel.runCell(code)
    if (!r.ok) throw new Error(r.error?.message ?? 'The kMol engine could not be installed.')
    this.installedFor = this.kernel
    this.installs++
  }

  /** Put the ASE wheel where kmweb.bridge._load_ase unpacks it (CIF import). */
  async ensureAse(): Promise<void> {
    if (this.aseFor === this.kernel) return
    const r = await fetch(`${BASE}wheels/${ASE_WHEEL}`)
    if (!r.ok) throw new Error(`${ASE_WHEEL}: HTTP ${r.status}`)
    const b64 = toBase64(new Uint8Array(await r.arrayBuffer()))
    await this.kernel.start()
    const code =
      `import base64 as _b, os as _o\n_o.makedirs(${pyStr(ROOT + '/wheels')}, exist_ok=True)\n` +
      `open(${pyStr(`${ROOT}/wheels/${ASE_WHEEL}`)}, 'wb').write(_b.b64decode(${pyStr(b64)}))\ndel _b, _o`
    const res = await this.kernel.runCell(code)
    if (!res.ok) throw new Error(res.error?.message ?? 'ASE could not be installed.')
    this.aseFor = this.kernel
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
      if (this.queue.length) void this.pump()
    }
  }

  private async runBatch(jobs: Job[]) {
    const requests = jobs.map((j) => ({ op: j.op, args: j.args }))
    const code = `await __import__('kmweb.bridge', fromlist=['run']).run(${pyStr(JSON.stringify(requests))})`
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
    if (!answers || answers.length !== jobs.length) {
      const err = failure ?? new Error('Python answered the wrong number of requests.')
      for (const j of jobs) j.reject(err)
      return
    }
    jobs.forEach((j, n) => j.resolve(answers[n]))
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
