// Runs the learner's JavaScript in a Web Worker made from a blob: no access to the page,
// and a timeout that ends endless loops. (The worker's program is in jsworker.ts.)

import type { Check, CheckResult } from './checks.ts'
import { JS_WORKER_SOURCE } from './jsworker.ts'
import type { RunError } from './report.ts'

export const JS_TIMEOUT_MS = 5000

export interface JsOutcome {
  /** Ran to the end. */
  ok: boolean
  value: string | null
  error: RunError | null
  checks: CheckResult[] | null
  timedOut: boolean
  stopped: boolean
}

export interface JsRun {
  promise: Promise<JsOutcome>
  /** End the run now (the Stop button). */
  stop(): void
}

export interface JsOptions {
  checks?: Check[]
  timeoutMs?: number
  onLog?: (level: 'log' | 'info' | 'warn' | 'error', text: string) => void
}

const failed = (message: string, extra: Partial<JsOutcome> = {}): JsOutcome => ({
  ok: false, value: null, error: { name: 'Error', message, line: null }, checks: null, timedOut: false, stopped: false, ...extra,
})

export function startJavaScript(code: string, opts: JsOptions = {}): JsRun {
  let worker: Worker | null = null
  let url: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let finish: (o: JsOutcome) => void = () => {}
  let over = false
  const promise = new Promise<JsOutcome>((resolve) => { finish = resolve })
  const end = (o: JsOutcome) => {
    if (over) return
    over = true
    clearTimeout(timer)
    worker?.terminate()
    if (url) URL.revokeObjectURL(url)
    finish(o)
  }
  try {
    url = URL.createObjectURL(new Blob([JS_WORKER_SOURCE], { type: 'text/javascript' }))
    worker = new Worker(url)
  } catch (e) {
    end(failed(`JavaScript could not start: ${e instanceof Error ? e.message : String(e)}`))
    return { promise, stop() {} }
  }
  const limit = opts.timeoutMs ?? JS_TIMEOUT_MS
  timer = setTimeout(() => end({ ...failed(`The code ran for more than ${limit / 1000} seconds and was stopped. Is there a loop that never ends?`), timedOut: true }), limit)
  worker.onmessage = (e: MessageEvent<{ type: string; [k: string]: unknown }>) => {
    const m = e.data
    if (m.type === 'log') opts.onLog?.(m.level as 'log', String(m.text))
    else if (m.type === 'done') {
      const err = m.error as { name: string; message: string; line: number | null } | undefined
      end({
        ok: m.ok === true,
        value: typeof m.value === 'string' ? m.value : null,
        error: err ? { name: err.name, message: err.message, line: err.line ?? null } : null,
        checks: Array.isArray(m.checks) ? (m.checks as CheckResult[]) : null,
        timedOut: false,
        stopped: false,
      })
    }
  }
  worker.onerror = (e) => {
    e.preventDefault()
    end(failed(e.message || 'The code stopped unexpectedly.'))
  }
  worker.postMessage({ code, checks: opts.checks ?? [] })
  return { promise, stop: () => end({ ...failed('Stopped.'), error: null, stopped: true }) }
}
