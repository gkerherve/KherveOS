// The PDF preview: every page of the compiled PDF in one scrolling column, as
// the desktop's QPdfView (multi-page, 18 px between pages). Pages are drawn by
// the KherveOS PDF service (MuPDF), only near the viewport. The scroll position
// survives recompiles, and Ctrl+F searches the PDF, like the desktop.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { openPdf, type PdfDocument } from '@/os/services/pdf'

const GAP = 18
const PAD = 12
/** QPdfView at zoom 1.0: one PDF point is 96/72 screen pixels. */
const PX_PER_PT = 96 / 72
const MAX_BITMAP_PX = 12_000_000

interface Hit {
  page: number
  rects: { x: number; y: number; w: number; h: number }[]
}

const PageCanvas = memo(function PageCanvas({ pdf, index, scale, visible }: { pdf: PdfDocument; index: number; scale: number; visible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawn = useRef<{ pdf: PdfDocument; scale: number } | null>(null)
  useEffect(() => {
    if (!visible || (drawn.current?.pdf === pdf && drawn.current.scale === scale)) return
    const ac = new AbortController()
    const timer = window.setTimeout(() => {
      const info = pdf.pages[index]
      const dpr = window.devicePixelRatio || 1
      let s = scale * dpr
      const px = info.width * info.height * s * s
      if (px > MAX_BITMAP_PX) s *= Math.sqrt(MAX_BITMAP_PX / px)
      pdf
        .renderPage(index, s, { signal: ac.signal, priority: 'high' })
        .then((bmp) => {
          const c = ref.current
          if (!c || ac.signal.aborted) return bmp.close()
          c.width = bmp.width
          c.height = bmp.height
          c.getContext('2d')?.drawImage(bmp, 0, 0)
          bmp.close()
          drawn.current = { pdf, scale }
        })
        .catch(() => {})
    }, drawn.current === null ? 0 : 120)
    return () => {
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [pdf, index, scale, visible])
  return <canvas ref={ref} className="ktx-pdfv-canvas" />
})

export function PdfView({
  bytes, zoom, fit, notice, compiling, onFitZoom, onContextMenu, reveal,
}: {
  bytes: Uint8Array | null
  /** Percent; ignored while `fit` is on. */
  zoom: number
  fit: boolean
  notice: string | null
  compiling: boolean
  onFitZoom?: (pct: number) => void
  /** Right-click on a page: the page index and the text of the line under the pointer. */
  onContextMenu?: (e: React.MouseEvent, page: number, text: string) => void
  /** "Show in PDF": scroll to this text and flash it. */
  reveal?: { text: string; seq: number } | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PdfDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1]))
  const [find, setFind] = useState<{ open: boolean; query: string; hits: Hit[]; i: number }>({ open: false, query: '', hits: [], i: 0 })
  const findInput = useRef<HTMLInputElement>(null)
  /** Scroll position as a fraction, kept across a new PDF. */
  const keep = useRef<number | null>(null)

  // Open each new PDF; close the old one once the new one is shown.
  useEffect(() => {
    if (!bytes) return
    let gone = false
    const el = scroller.current
    if (el && el.scrollHeight > el.clientHeight) keep.current = el.scrollTop / el.scrollHeight
    openPdf(bytes)
      .then((doc) => {
        if (gone) return doc.close()
        setError(null)
        setPdf((old) => {
          if (old && old !== doc) window.setTimeout(() => old.close(), 0)
          return doc
        })
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      gone = true
    }
  }, [bytes])

  const pdfRef = useRef<PdfDocument | null>(null)
  pdfRef.current = pdf
  useEffect(() => () => pdfRef.current?.close(), [])

  // The width available, for fit-to-width.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxPt = pdf ? Math.max(...pdf.pages.map((p) => p.width)) : 595
  const fitPct = width > 0 ? Math.max(10, Math.floor(((width - 2 * PAD) / (maxPt * PX_PER_PT)) * 100)) : 100
  const pct = fit ? fitPct : zoom
  const scale = (pct / 100) * PX_PER_PT

  useEffect(() => {
    if (fit && width > 0) onFitZoom?.(fitPct)
  }, [fit, fitPct, width])

  // Which pages are near the viewport.
  const tops: number[] = []
  if (pdf) {
    let y = PAD
    for (const p of pdf.pages) {
      tops.push(y)
      y += p.height * scale + GAP
    }
  }
  const total = pdf ? tops[tops.length - 1] + pdf.pages[pdf.pages.length - 1].height * scale + PAD : 0

  const updateVisible = () => {
    const el = scroller.current
    if (!el || !pdf) return
    const lo = el.scrollTop - 600
    const hi = el.scrollTop + el.clientHeight + 600
    const next = new Set<number>()
    pdf.pages.forEach((p, i) => {
      const t = tops[i]
      if (t + p.height * scale >= lo && t <= hi) next.add(i)
    })
    setVisible((old) => (old.size === next.size && [...next].every((i) => old.has(i)) ? old : next))
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !pdf) return
    if (keep.current !== null) {
      el.scrollTop = keep.current * el.scrollHeight
      keep.current = null
    }
    updateVisible()
  }, [pdf, scale])

  // Find in the PDF.
  useEffect(() => {
    if (!pdf || !find.open) return
    const q = find.query.trim()
    if (!q) {
      setFind((f) => ({ ...f, hits: [], i: 0 }))
      return
    }
    let gone = false
    const t = window.setTimeout(() => {
      pdf.search(q).then((hits) => !gone && setFind((f) => ({ ...f, hits, i: 0 }))).catch(() => {})
    }, 200)
    return () => {
      gone = true
      window.clearTimeout(t)
    }
  }, [pdf, find.open, find.query])

  // Show in PDF: the first place the text appears.
  const [flashHit, setFlashHit] = useState<{ page: number; r: Hit['rects'][number] } | null>(null)
  useEffect(() => {
    if (!pdf || !reveal) return
    let gone = false
    const words = reveal.text.replace(/\s+/g, ' ').trim().split(' ')
    const tries = [words.slice(0, 6).join(' '), words.slice(0, 3).join(' '), words.slice(-3).join(' ')].filter((t) => t.length > 2)
    void (async () => {
      for (const t of tries) {
        const hits = await pdf.search(t).catch(() => [] as Hit[])
        if (gone) return
        const h = hits.find((x) => x.rects.length)
        if (!h) continue
        const el = scroller.current
        if (el) el.scrollTop = tops[h.page] + h.rects[0].y * scale - el.clientHeight / 3
        setFlashHit({ page: h.page, r: h.rects[0] })
        window.setTimeout(() => !gone && setFlashHit(null), 1600)
        return
      }
    })()
    return () => {
      gone = true
    }
  }, [pdf, reveal?.seq])

  const flatHits = find.hits.flatMap((h) => h.rects.map((r) => ({ page: h.page, r })))
  const goHit = (delta: number) => {
    if (!flatHits.length) return
    const i = (find.i + delta + flatHits.length) % flatHits.length
    setFind((f) => ({ ...f, i }))
    const h = flatHits[i]
    const el = scroller.current
    if (el) el.scrollTop = tops[h.page] + h.r.y * scale - el.clientHeight / 3
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      setFind((f) => ({ ...f, open: true }))
      window.setTimeout(() => findInput.current?.select(), 0)
    }
  }

  const contextMenu = async (e: React.MouseEvent, page: number) => {
    if (!onContextMenu || !pdf) return
    e.preventDefault()
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - box.top) / scale
    let text = ''
    try {
      const words = await pdf.pageWords(page)
      const near = words.filter((w) => y >= w.rect[1] - 2 && y <= w.rect[3] + 2)
      text = near.map((w) => w.text).join(' ')
    } catch {
      // no text: the menu still opens
    }
    onContextMenu(e, page, text)
  }

  const current = flatHits[find.i]
  return (
    <div className="ktx-pdfv" tabIndex={-1} onKeyDown={onKeyDown}>
      <div ref={scroller} className="ktx-pdfv-scroll" onScroll={updateVisible}>
        {pdf && (
          <div className="ktx-pdfv-pages" style={{ height: total, minWidth: maxPt * scale + 2 * PAD }}>
            {pdf.pages.map((p, i) => (
              <div
                key={i}
                className="ktx-pdfv-page"
                style={{ top: tops[i], width: p.width * scale, height: p.height * scale }}
                onContextMenu={(e) => void contextMenu(e, i)}
              >
                <PageCanvas pdf={pdf} index={i} scale={scale} visible={visible.has(i)} />
                {flashHit && flashHit.page === i && (
                  <div
                    className="ktx-pdfv-hit flash"
                    style={{ left: flashHit.r.x * scale - 3, top: flashHit.r.y * scale - 2, width: flashHit.r.w * scale + 6, height: flashHit.r.h * scale + 4 }}
                  />
                )}
                {find.open && find.hits.filter((h) => h.page === i).flatMap((h, hi) =>
                  h.rects.map((r, ri) => (
                    <div
                      key={`${hi}-${ri}`}
                      className={`ktx-pdfv-hit${current && current.page === i && current.r === r ? ' on' : ''}`}
                      style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
                    />
                  )),
                )}
              </div>
            ))}
          </div>
        )}
        {!pdf && (
          <div className="ktx-pdfv-empty">
            {error ? `The PDF could not be shown: ${error}` : notice ?? (compiling ? 'Compiling…' : 'The PDF appears here once the document compiles.')}
          </div>
        )}
      </div>
      {pdf && notice && <div className="ktx-pdfv-notice">{notice}</div>}
      {find.open && (
        <div className="ktx-pdfv-find" onKeyDown={(e) => e.stopPropagation()}>
          <input
            ref={findInput}
            className="k-input"
            placeholder="Find in PDF…"
            value={find.query}
            autoFocus
            onChange={(e) => setFind((f) => ({ ...f, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goHit(e.shiftKey ? -1 : 1)
              else if (e.key === 'Escape') setFind((f) => ({ ...f, open: false }))
            }}
          />
          <span className="ktx-pdfv-count">{find.query.trim() ? (flatHits.length ? `${find.i + 1} / ${flatHits.length}` : 'No matches') : ''}</span>
          <button className="k-btn small" title="Previous match" onClick={() => goHit(-1)}>▲</button>
          <button className="k-btn small" title="Next match" onClick={() => goHit(1)}>▼</button>
          <button className="k-btn small" onClick={() => setFind((f) => ({ ...f, open: false }))}>✕</button>
        </div>
      )}
    </div>
  )
}
