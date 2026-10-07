// The PDF worker: loads MuPDF (WebAssembly, ~10 MB, fetched once and cached by
// the browser) and runs the engine's operations one message at a time.
// See pdf.ts for the main-thread side.

import wasmUrl from '../../../node_modules/mupdf/dist/mupdf-wasm.wasm?url'
import { PdfEngine, type PdfEngineOps, type RawImage } from './pdf.engine'

type Request = { id: number; op: keyof PdfEngineOps; args: unknown[] }
type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string; name?: string; fatal?: boolean }

const ctx = self as unknown as {
  postMessage(msg: Reply, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<Request>) => void) | null
  close(): void
}

// MuPDF finds its .wasm next to its own module, which breaks once a bundler
// moves the module; point it at the copy Vite serves instead.
;(globalThis as Record<string, unknown>).$libmupdf_wasm_Module = { locateFile: () => wasmUrl }

const ready: Promise<PdfEngine> = import('mupdf').then((mupdf) => {
  mupdf.setLog({
    warning: (m: string) => console.debug('[mupdf]', m),
    error: (m: string) => console.warn('[mupdf]', m),
  })
  return new PdfEngine(mupdf)
})

function isRaw(v: unknown): v is RawImage {
  return !!v && typeof v === 'object' && (v as RawImage).kind === 'raw-image'
}

/** Buffers in the result can be handed over instead of copied. */
function transferables(v: unknown, out: Transferable[] = []): Transferable[] {
  if (v instanceof ImageBitmap) out.push(v)
  else if (v instanceof Uint8Array && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) out.push(v.buffer as ArrayBuffer)
  else if (Array.isArray(v)) for (const x of v) if (x instanceof Uint8Array) transferables(x, out)
  return out
}

ctx.onmessage = async (e) => {
  const { id, op, args } = e.data
  try {
    const engine = await ready
    const fn = engine[op] as unknown as (...a: unknown[]) => unknown
    if (typeof fn !== 'function') throw new Error(`Unknown PDF operation: ${String(op)}`)
    // All MuPDF work happens synchronously here, so messages never interleave inside it.
    let result = fn.apply(engine, args)
    if (isRaw(result)) {
      if (typeof createImageBitmap === 'function') {
        result = await createImageBitmap(new ImageData(result.pixels as Uint8ClampedArray<ArrayBuffer>, result.width, result.height))
      } else {
        // No bitmaps in this worker (older Safari): send the pixels, the page makes the bitmap.
        ctx.postMessage({ id, ok: true, result }, [result.pixels.buffer as ArrayBuffer])
        return
      }
    }
    ctx.postMessage({ id, ok: true, result }, transferables(result))
  } catch (err) {
    const fatal = err instanceof WebAssembly.RuntimeError
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : undefined, fatal })
    // Out of memory and similar: MuPDF is unusable now. Closing makes the page start a new worker.
    if (fatal) {
      console.error('[pdf] engine crashed', err)
      ctx.close()
    }
  }
}
