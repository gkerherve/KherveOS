// The web side of KherveCAD's OpenSCAD engine: runs the render jobs Python's
// WebEngine hands out (kcweb/app.py) in openscad.worker.ts, one at a time.
// A whole-document render waits 500 ms (the desktop's debounce) and a newer
// one replaces it; per-part renders queue behind.

import type { RenderJob } from './types'
import { nextJob } from './logic'
export { nextJob }

export interface RunResult {
  ok: boolean
  data?: Uint8Array
  stderr: string
}

const FONT_BASE = `${import.meta.env.BASE_URL}apps/khervecad/py/data/fonts/`

export class ScadRunner {
  private worker: Worker | null = null
  private nextId = 1
  private waiting = new Map<number, (r: RunResult) => void>()
  private jobs: RenderJob[] = []
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** A job finished: hand the result to Python. */
  onResult: (job: RenderJob, r: RunResult) => void = () => {}
  onBusy: (busy: boolean) => void = () => {}

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./openscad.worker.ts', import.meta.url), { type: 'module', name: 'openscad' })
      this.worker.onmessage = (e: MessageEvent<{ id: number } & RunResult>) => {
        const cb = this.waiting.get(e.data.id)
        this.waiting.delete(e.data.id)
        cb?.({ ok: e.data.ok, data: e.data.data, stderr: e.data.stderr ?? '' })
      }
      this.worker.onerror = (e) => {
        e.preventDefault()
        for (const cb of this.waiting.values()) cb({ ok: false, stderr: e.message || 'OpenSCAD stopped.' })
        this.waiting.clear()
        this.worker?.terminate()
        this.worker = null
      }
    }
    return this.worker
  }

  /** One OpenSCAD run (an export, or a job). */
  run(code: string, format: string, defines?: Record<string, string>): Promise<RunResult> {
    if (this.disposed) return Promise.resolve({ ok: false, stderr: 'closed' })
    const id = this.nextId++
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      this.ensure().postMessage({ id, code, format, defines, fontBase: new URL(FONT_BASE, location.href).href })
    })
  }

  /** Jobs from Python. */
  add(jobs: RenderJob[]) {
    for (const j of jobs) {
      if (j.kind === 'render') this.jobs = this.jobs.filter((q) => q.kind !== 'render')
      this.jobs.push(j)
    }
    if (this.timer) clearTimeout(this.timer)
    const onlyRender = this.jobs.every((j) => j.kind === 'render')
    this.timer = setTimeout(() => void this.pump(), onlyRender ? 500 : 0)
  }

  private async pump() {
    if (this.running || this.disposed) return
    this.running = true
    this.onBusy(true)
    try {
      for (;;) {
        const job = nextJob(this.jobs)
        if (!job) break
        this.jobs = this.jobs.filter((j) => j !== job)
        const r = await this.run(job.code, 'binstl', job.defines)
        if (this.disposed) return
        this.onResult(job, r)
      }
    } finally {
      this.running = false
      this.onBusy(false)
    }
  }

  dispose() {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.worker?.terminate()
    this.worker = null
  }
}
