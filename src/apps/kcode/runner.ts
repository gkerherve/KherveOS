// Runs code for kCode: Python in the app's own Pyodide kernel, JavaScript in a worker.
// One runner per window; `stop()` ends the run in progress, `dispose()` releases Python.

import { PythonKernel } from '@/os/python/kernel'
import type { Check } from './checks.ts'
import { inputShim, parsePythonChecks, pyErrorLine, pythonHarness, usesInput } from './checks.ts'
import { startJavaScript, type JsRun } from './jsrunner.ts'
import type { Language } from './lessonTypes.ts'
import { emptyReport, type RunReport, type Seg } from './report.ts'

export interface RunOptions {
  language: Language
  code: string
  /** Run these checks after the code (when it ran without error). */
  checks?: Check[]
  /** Answers for Python's input(), one per call. */
  answers?: string[]
  onSeg?: (seg: Seg) => void
}

export class Runner {
  private kernel: PythonKernel | null = null
  private js: JsRun | null = null
  private stopped = false
  private listeners = new Set<(running: boolean) => void>()
  running = false

  onRunning(cb: (running: boolean) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setRunning(r: boolean) {
    this.running = r
    for (const cb of [...this.listeners]) cb(r)
  }

  async run(opts: RunOptions): Promise<RunReport> {
    this.stopped = false
    this.setRunning(true)
    const t0 = performance.now()
    let report: RunReport
    try {
      report = opts.language === 'python' ? await this.runPython(opts) : await this.runJavaScript(opts)
    } finally {
      this.setRunning(false)
    }
    report.ms = performance.now() - t0
    if (opts.checks?.length && report.ok && !report.checks) {
      report.error = { name: 'Checks', message: 'The checks could not run. Did the code end early (a return or exit at the top level)?', line: null }
    }
    return report
  }

  /** Stop the run in progress. Python is restarted (its variables are lost); JavaScript's worker is ended. */
  stop() {
    if (!this.running) return
    this.stopped = true
    this.js?.stop()
    if (this.kernel && this.kernel.status !== 'off') {
      this.kernel.restart().catch(() => { /* the next run starts it again */ })
    }
  }

  /** Start Python afresh (the "Restart Python" menu item). */
  async restartPython() {
    if (this.kernel) await this.kernel.restart()
  }

  dispose() {
    this.js?.stop()
    this.kernel?.dispose()
    this.kernel = null
    this.listeners.clear()
  }

  private async runJavaScript(opts: RunOptions): Promise<RunReport> {
    const report = emptyReport('javascript')
    this.js = startJavaScript(opts.code, {
      checks: opts.checks,
      onLog: (level, text) => opts.onSeg?.({ kind: level === 'error' ? 'err' : level === 'warn' ? 'warn' : 'out', text: text + '\n' }),
    })
    const r = await this.js.promise
    this.js = null
    report.ok = r.ok
    report.value = r.value
    report.error = r.timedOut ? null : r.error
    report.checks = r.checks
    report.timedOut = r.timedOut
    report.stopped = r.stopped || this.stopped
    return report
  }

  private async runPython(opts: RunOptions): Promise<RunReport> {
    const report = emptyReport('python')
    const kernel = (this.kernel ??= new PythonKernel('kcode'))
    const emit = (kind: Seg['kind']) => (text: string) => opts.onSeg?.({ kind, text })
    let printed = ''
    try {
      if (kernel.status === 'off') opts.onSeg?.({ kind: 'status', text: 'Starting Python (the first time takes a few seconds)…\n' })
      await kernel.resetNamespace() // every run starts clean, like running a file
      if (usesInput(opts.code)) await kernel.runCell(inputShim(opts.answers ?? []))
      const res = await kernel.runCell(opts.code, {
        onStdout: (t) => { printed += t; emit('out')(t) },
        onStderr: emit('err'),
        onStatus: (t) => emit('status')(t + '\n'),
      })
      report.figures = res.figures
      report.value = res.result
      if (!res.ok && res.error) {
        report.error = { name: res.error.type, message: res.error.message, line: pyErrorLine(res.error.traceback), traceback: res.error.traceback }
        return report
      }
      report.ok = true
      if (opts.checks?.length) {
        let marked = ''
        await kernel.runCell(pythonHarness(opts.checks, printed), { onStdout: (t) => { marked += t } })
        report.checks = parsePythonChecks(marked)
      }
    } catch (e) {
      if (this.stopped) report.stopped = true
      else report.error = { name: 'Error', message: e instanceof Error ? e.message : String(e), line: null }
      report.ok = false
    }
    report.stopped = report.stopped || this.stopped
    return report
  }
}
