// The right-hand side, as on the desktop: the generated beamer LaTeX (live),
// the compiler console and the compiled PDF.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { openPdf, type PdfDocument } from '@/os/services/pdf'
import type { LatexError } from '@/os/services/latex'

export function LatexPanel({ tex }: { tex: string }) {
  return (
    <div className="ks2-panel-body">
      <div className="ks2-panel-tools">
        <span className="k-muted">Generated beamer source (read-only; it follows the slides)</span>
        <button className="k-icon-btn" title="Copy" onClick={() => void navigator.clipboard?.writeText(tex)}>
          <Copy size={14} />
        </button>
      </div>
      <pre className="ks2-code">{tex}</pre>
    </div>
  )
}

export function ConsolePanel({ log, errors, missing }: { log: string; errors: LatexError[]; missing: string[] }) {
  return (
    <div className="ks2-panel-body">
      {(errors.length > 0 || missing.length > 0) && (
        <ul className="ks2-errors">
          {missing.map((m) => (
            <li key={m}>Picture not found: {m} (an empty frame is printed instead)</li>
          ))}
          {errors.map((e, i) => (
            <li key={i}>
              {e.line ? <b>line {e.line}: </b> : null}
              {e.message}
            </li>
          ))}
        </ul>
      )}
      <pre className="ks2-code">{log || 'Compile (⌘R) to see the LaTeX log here.'}</pre>
    </div>
  )
}

function PdfPageCanvas({ doc, index, width }: { doc: PdfDocument; index: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const info = doc.pages[index]
    if (!info || width < 10) return
    const ac = new AbortController()
    const dpr = window.devicePixelRatio || 1
    void doc
      .renderPage(index, (width / info.width) * dpr, { signal: ac.signal, priority: index < 3 ? 'high' : 'low' })
      .then((bmp) => {
        const c = ref.current
        if (!c) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.style.width = `${width}px`
        c.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => {})
    return () => ac.abort()
  }, [doc, index, width])
  const info = doc.pages[index]
  return <canvas ref={ref} className="ks2-pdfpage" style={{ width, height: info ? (width * info.height) / info.width : undefined }} />
}

export function PdfPanel({ pdf, busy }: { pdf: Uint8Array | null; busy: boolean }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(80, el.clientWidth - 24)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf) {
      setDoc(null)
      return
    }
    let alive = true
    let d: PdfDocument | null = null
    openPdf(pdf.slice())
      .then((x) => {
        if (!alive) return x.close()
        d = x
        setDoc(x)
        setError('')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      d?.close()
    }
  }, [pdf])
  return (
    <div className="ks2-panel-body ks2-pdfpanel" ref={box}>
      {!pdf && <div className="k-empty">{busy ? 'Compiling…' : 'Compile (⌘R) to typeset the slides with LaTeX.'}</div>}
      {error && <div className="k-error">{error}</div>}
      {doc && Array.from({ length: doc.pageCount }, (_, i) => <PdfPageCanvas key={i} doc={doc} index={i} width={width} />)}
    </div>
  )
}
