// The simulator in a Web Worker (so a long transient never freezes the window, and Stop can end it).
// See ../simClient.ts for the window side.

import type { Analysis, Circuit } from './circuit.ts'
import { SimError, simulate, type SimResult } from './engine.ts'

type Request = { id: number; circuit: Circuit; analysis: Analysis }
type Reply = { id: number; ok: true; result: SimResult } | { id: number; ok: false; error: string; refs: string[] }

const ctx = self as unknown as { postMessage(msg: Reply): void; onmessage: ((e: MessageEvent<Request>) => void) | null }

ctx.onmessage = (e) => {
  const { id, circuit, analysis } = e.data
  try {
    ctx.postMessage({ id, ok: true, result: simulate(circuit, analysis) })
  } catch (err) {
    const refs = err instanceof SimError ? err.refs : []
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err), refs })
  }
}
