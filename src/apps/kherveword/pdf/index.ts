// The main-thread side of the PDF worker (started on first use).

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { resolve: (v: { pdf: Uint8Array; pages: number }) => void; reject: (e: Error) => void }>()

export function htmlToPdfInWorker(html: string, widthPt: number, heightPt: number): Promise<{ pdf: Uint8Array; pages: number }> {
  if (!worker) {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'kherveword-pdf' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; pdf?: Uint8Array; pages?: number; error?: string }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.ok) w.resolve({ pdf: e.data.pdf!, pages: e.data.pages ?? 0 })
      else w.reject(new Error(e.data.error ?? 'PDF failed'))
    }
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(e.message || 'The PDF worker failed.'))
      waiting.clear()
      worker = null
    }
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ id, html, w: widthPt, h: heightPt })
  })
}
