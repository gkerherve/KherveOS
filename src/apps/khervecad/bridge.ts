// KherveCAD's Python: the window's own Pyodide worker (PythonKernel) running
// the desktop KherveCAD (public/apps/khervecad/py/khervecad.zip, exported from
// ../KherveCAD by tools/export_khervecad.py) on a headless Qt (kcweb/qtshim).
// The desktop MainWindow is built there; this file sends it the user's input
// and gets back what changed (see kcweb/app.py).
//
// One request runs at a time. Input that arrives meanwhile is queued and goes
// with the next request; a mouse move replaces the previous unsent move, so a
// drag never falls behind. Answers come between two markers on stdout.

import { PythonKernel, type KernelStatus } from '@/os/python/kernel'
import type { Reply, UiEvent } from './types'
import { enqueue, extractReply } from './logic'

const BASE = `${import.meta.env.BASE_URL}apps/khervecad/py/`
const ROOT = '/kherveos/khervecad'

/** kcweb sources installed beside the desktop package (relative to py/). */
export const KCWEB_FILES = [
  'kcweb/__init__.py',
  'kcweb/app.py',
  'kcweb/bridge.py',
  'kcweb/fonts.py',
  'kcweb/gview.py',
  'kcweb/sketch.py',
  'kcweb/ui.py',
  'kcweb/view3d.py',
  'kcweb/qtshim/PyQt5/__init__.py',
  'kcweb/qtshim/PyQt5/_core.py',
  'kcweb/qtshim/PyQt5/_widgets.py',
  'kcweb/qtshim/PyQt5/_views.py',
  'kcweb/qtshim/PyQt5/_dialogs.py',
  'kcweb/qtshim/PyQt5/_graphics.py',
  'kcweb/qtshim/PyQt5/_painter.py',
  'kcweb/qtshim/PyQt5/QtCore.py',
  'kcweb/qtshim/PyQt5/QtGui.py',
  'kcweb/qtshim/PyQt5/QtWidgets.py',
  'kcweb/qtshim/PyQt5/QtSvg.py',
  'kcweb/qtshim/PyQt5/QtNetwork.py',
  'kcweb/qtshim/PyQt5/QtPrintSupport.py',
  'kcweb/qtshim/PyQt5/QtOpenGL.py',
  'kcweb/qtshim/PyQt5/QtMultimedia.py',
  'kcweb/qtshim/PyQt5/QtWebEngineWidgets.py',
  'kcweb/qtshim/PyQt5/QtSql.py',
  'kcweb/qtshim/PyQt5/QtXml.py',
  'kcweb/qtshim/PyQt5/QtDBus.py',
  'kcweb/qtshim/PyQt5/sip.py',
  'kcweb/qtshim/sip.py',
]

/** A Python string literal (JSON's escapes are all valid Python). */
export const pyStr = (s: string) => JSON.stringify(s)

export interface BootOptions {
  settings: Record<string, unknown>
  language: string
}

export class CadBridge {
  readonly kernel: PythonKernel
  /** Every reply (boot included), in order. */
  onReply: (r: Reply) => void = () => {}
  /** Loading messages ("Loading numpy…"), or null. */
  onProgress: (text: string | null) => void = () => {}
  /** Python failed or stopped. */
  onFailure: (message: string) => void = () => {}
  /** True while a request runs. */
  onBusy: (busy: boolean) => void = () => {}

  private queue: UiEvent[] = []
  private answers: unknown[] = []
  private running = false
  private booted = false
  private disposed = false
  private wantFull = false
  private unsub: () => void

  constructor(ns: string) {
    this.kernel = new PythonKernel(ns)
    this.unsub = this.kernel.onStatus((s: KernelStatus) => {
      if ((s === 'off' || s === 'dead') && this.booted && !this.disposed) {
        this.booted = false
        this.onFailure('Python stopped. Reopen KherveCAD to continue (unsaved changes are lost).')
      }
    })
  }

  get isBooted() {
    return this.booted
  }

  /** Load Python, install KherveCAD and build its window. */
  async boot(opts: BootOptions): Promise<void> {
    await this.kernel.start()
    const base = new URL(BASE, location.href).href
    const files = JSON.stringify(KCWEB_FILES)
    // numpy and fontTools are imported deep inside the desktop code, where
    // Pyodide's import scan cannot see them: load them up front
    const install = `import numpy, fontTools
import os, sys
from pyodide.http import pyfetch
_kc_root = ${pyStr(ROOT)}
_kc_base = ${pyStr(base)}
for _kc_rel in __import__('json').loads(${pyStr(files)}):
    _kc_r = await pyfetch(_kc_base + _kc_rel, cache='no-cache')
    if not _kc_r.ok:
        raise OSError(_kc_rel + ': HTTP ' + str(_kc_r.status))
    _kc_path = _kc_root + '/' + _kc_rel
    os.makedirs(os.path.dirname(_kc_path), exist_ok=True)
    with open(_kc_path, 'w', encoding='utf-8') as _kc_f:
        _kc_f.write(await _kc_r.string())
for _kc_p in (_kc_root + '/kcweb/qtshim', _kc_root):
    if _kc_p not in sys.path:
        sys.path.insert(0, _kc_p)
from kcweb import bridge as _kc_bridge
await _kc_bridge.install(_kc_base, _kc_root)
del _kc_r, _kc_rel, _kc_path, _kc_f, _kc_p`
    const r = await this.kernel.runCell(install, { onStatus: (t) => this.onProgress(t) })
    this.onProgress(null)
    if (!r.ok) throw new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'KherveCAD could not be installed.')
    this.onProgress('Building the window…')
    const reply = await this.request({ boot: 1, pkg: `${ROOT}/khervecad`, settings: opts.settings, language: opts.language })
    this.onProgress(null)
    if (!reply) throw new Error('KherveCAD did not start.')
    this.booted = true
    this.onReply(reply)
    void this.pump()
  }

  /** Queue one input event. */
  send(ev: UiEvent) {
    if (this.disposed) return
    this.queue = enqueue(this.queue, ev)
    void this.pump()
  }

  /** Answer the open modal question. */
  answer(value: unknown) {
    if (this.disposed) return
    this.answers.push(value)
    void this.pump()
  }

  /** Ask for everything again (after the web side lost its cache). */
  refreshAll() {
    this.wantFull = true
    void this.pump()
  }

  dispose() {
    this.disposed = true
    this.unsub()
    this.kernel.dispose()
  }

  private async request(payload: unknown): Promise<Reply | null> {
    let out = ''
    const code = `__import__('kcweb.bridge', fromlist=['reply']).reply(${pyStr(JSON.stringify(payload))})`
    const r = await this.kernel.runCell(code, {
      onStdout: (t) => (out += t),
      onStderr: (t) => console.warn('[khervecad]', t),
      onStatus: (t) => this.onProgress(t),
    })
    const reply = extractReply(out)
    if (!reply && !r.ok) throw new Error(r.error ? `${r.error.type}: ${r.error.message}` : 'Python gave no answer.')
    return reply
  }

  private async pump() {
    if (this.running || this.disposed || !this.booted) return
    this.running = true
    this.onBusy(true)
    try {
      while (!this.disposed && (this.queue.length || this.answers.length || this.wantFull)) {
        const events = this.queue
        this.queue = []
        const payload: Record<string, unknown> = { events }
        if (this.answers.length) payload.answer = this.answers.shift()
        if (this.wantFull) {
          payload.full = true
          this.wantFull = false
        }
        try {
          const reply = await this.request(payload)
          if (reply) this.onReply(reply)
        } catch (e) {
          this.onFailure(e instanceof Error ? e.message : String(e))
          break
        }
      }
    } finally {
      this.running = false
      this.onBusy(false)
    }
  }
}
