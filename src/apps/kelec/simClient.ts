// Runs a simulation in a worker; Stop terminates it. Falls back to the main thread if workers are unavailable.

import type { Analysis, Circuit } from './sim/circuit'
import { SimError, simulate, type SimResult } from './sim/engine'

export interface SimJob {
  promise: Promise<SimResult>
  cancel(): void
}

interface Reply { id: number; ok: boolean; result?: SimResult; error?: string; refs?: string[] }

let nextId = 1

export function startSimulation(circuit: Circuit, analysis: Analysis): SimJob {
  let worker: Worker | null = null
  let rejectJob: ((e: Error) => void) | null = null
  const promise = new Promise<SimResult>((resolve, reject) => {
    rejectJob = reject
    try {
      worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module', name: 'kelec-sim' })
    } catch {
      // no workers: run here (briefly blocks the window)
      setTimeout(() => {
        try { resolve(simulate(circuit, analysis)) } catch (e) { reject(e instanceof Error ? e : new Error(String(e))) }
      }, 0)
      return
    }
    const id = nextId++
    worker.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.id !== id) return
      worker?.terminate()
      worker = null
      if (e.data.ok) resolve(e.data.result!)
      else reject(new SimError(e.data.error ?? 'The simulation failed.', e.data.refs ?? []))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      worker?.terminate()
      worker = null
      // the worker could not start (blocked or failed to load): do it here
      try { resolve(simulate(circuit, analysis)) } catch (err) { reject(err instanceof Error ? err : new Error(String(err))) }
    }
    worker.postMessage({ id, circuit, analysis })
  })
  return {
    promise,
    cancel() {
      worker?.terminate()
      worker = null
      rejectJob?.(new SimError('Stopped.'))
    },
  }
}
