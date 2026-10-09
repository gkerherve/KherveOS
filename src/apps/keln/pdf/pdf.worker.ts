// kELN's PDF worker: MuPDF lays the entry's HTML out into PDF pages.

import wasmUrl from '../../../../node_modules/mupdf/dist/mupdf-wasm.wasm?url'
import { htmlToPdf } from './pdfCore'

;(globalThis as Record<string, unknown>).$libmupdf_wasm_Module = { locateFile: () => wasmUrl }

const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent<{ id: number; html: string; w: number; h: number }>) => void) | null }

const ready = import('mupdf')

ctx.onmessage = async (e) => {
  const { id, html, w, h } = e.data
  try {
    const mupdf = await ready
    const { pdf, pages } = htmlToPdf(mupdf, html, w, h)
    ctx.postMessage({ id, ok: true, pdf, pages }, [pdf.buffer as ArrayBuffer])
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
