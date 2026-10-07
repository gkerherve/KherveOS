// The slideshow: full screen, one slide at a time, keyboard driven. Like the
// desktop's Slideshow menu it can present the compiled PDF; it can also show
// the slides as drawn on the canvas (no server needed). The presenter view
// (P) shows the current and next slide, a timer and the clock, as the
// desktop's presenter view does. The desktop has no speaker notes.
//
// Keys: → ↓ Space PageDown Enter N next · ← ↑ PageUp Backspace previous ·
// Home / End · a number then Enter jumps · B black / W white screen ·
// P presenter view · Esc ends.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Monitor, MonitorPlay, X } from 'lucide-react'
import { openPdf, type PdfDocument } from '@/os/services/pdf'
import type { Deck } from './model'
import type { Look } from './look'
import type { Media } from './media'
import { SlideView, geometry } from './SlideView'

interface Props {
  deck: Deck
  look: Look
  media: Media
  backdrop: (string | null)[] | null
  /** The compiled presentation, to present the PDF itself. */
  pdf: Uint8Array | null
  /** Index into the shown slides (hidden ones are left out). */
  start: number
  presenter: boolean
  onExit: (shownIndex: number) => void
}

function useSize(ref: React.RefObject<HTMLElement | null>, dep: unknown = null) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref, dep])
  return size
}

function PdfPage({ doc, index, w, h }: { doc: PdfDocument; index: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const info = doc.pages[index]
    if (!info || !w || !h) return
    const ac = new AbortController()
    const fit = Math.min(w / info.width, h / info.height)
    const dpr = window.devicePixelRatio || 1
    void doc
      .renderPage(index, fit * dpr, { signal: ac.signal, priority: 'high' })
      .then((bmp) => {
        const c = ref.current
        if (!c) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.style.width = `${bmp.width / dpr}px`
        c.style.height = `${bmp.height / dpr}px`
        c.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => {})
    return () => ac.abort()
  }, [doc, index, w, h])
  return <canvas ref={ref} className="ks2-present-pdf" />
}

export function Present({ deck, look, media, backdrop, pdf, start, presenter: presenterAtStart, onExit }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLDivElement>(null)
  const shown = deck.slides.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden)
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const count = doc ? doc.pageCount : shown.length
  const [page, setPage] = useState(Math.max(0, Math.min(start, count - 1)))
  const [screen, setScreen] = useState<'' | 'black' | 'white'>('')
  const [presenter, setPresenter] = useState(presenterAtStart)
  const [typed, setTyped] = useState('')
  const [t0, setT0] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [controls, setControls] = useState(false)
  const live = useRef({ page, count })
  live.current = { page, count }
  const main = useSize(mainRef, presenter)
  const next = useSize(nextRef, presenter)

  useEffect(() => {
    if (!pdf) return
    let d: PdfDocument | null = null
    let alive = true
    void openPdf(pdf.slice()).then((x) => {
      if (alive) setDoc((d = x))
      else x.close()
    })
    return () => {
      alive = false
      d?.close()
    }
  }, [pdf])

  const goto = useCallback((i: number) => {
    if (i >= 0 && i < live.current.count) {
      setPage(i)
      setScreen('')
    }
  }, [])
  const exit = useCallback(() => onExit(live.current.page), [onExit])

  // Full screen on the stage; leaving it (Esc) ends the show.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    void el.requestFullscreen?.().catch(() => {})
    const onChange = () => {
      if (document.fullscreenElement !== el) exit()
    }
    const t = setTimeout(() => document.addEventListener('fullscreenchange', onChange), 300)
    return () => {
      clearTimeout(t)
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [exit])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    const p = live.current.page
    const k = e.key
    if (/^\d$/.test(k)) {
      setTyped((t) => (t + k).slice(-4))
      return
    }
    if (k === 'Enter' && typed) {
      goto(Number(typed) - 1)
      setTyped('')
      return
    }
    setTyped('')
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n', 'N'].includes(k)) goto(p + 1)
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) goto(p - 1)
    else if (k === 'Home') goto(0)
    else if (k === 'End') goto(live.current.count - 1)
    else if (k === 'b' || k === 'B' || k === '.') setScreen((s) => (s === 'black' ? '' : 'black'))
    else if (k === 'w' || k === 'W' || k === ',') setScreen((s) => (s === 'white' ? '' : 'white'))
    else if (k === 'p' || k === 'P') setPresenter((v) => !v)
    else if (k === 'Escape') exit()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const g = geometry(deck)
  const view = (i: number, box: { w: number; h: number }) => {
    if (i < 0 || i >= count || !box.w || !box.h) return null
    if (doc) return <PdfPage doc={doc} index={i} w={box.w} h={box.h} />
    const width = Math.min(box.w, (box.h * g.W) / g.H)
    const it = shown[i]
    return <SlideView deck={deck} slide={it.s} look={look} media={media} width={width} backdrop={backdrop?.[it.i] ?? null} className="ks2-present-slide" />
  }
  const elapsed = Math.max(0, Math.floor((now - t0) / 1000))
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div
      ref={stageRef}
      className={`ks2-present${presenter ? ' presenter' : ''}`}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={() => setControls(true)}
      onMouseLeave={() => setControls(false)}
    >
      <div
        className="ks2-present-main"
        ref={mainRef}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.ks2-present-bar')) return
          goto(live.current.page + 1)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          goto(live.current.page - 1)
        }}
      >
        {view(page, main)}
        {screen && <div className={`ks2-present-blank ${screen}`} />}
      </div>
      {presenter && (
        <div className="ks2-present-side">
          <div className="ks2-present-label">Next</div>
          <div className="ks2-present-next" ref={nextRef}>
            {page + 1 < count ? view(page + 1, next) : <div className="ks2-present-end">End of the slideshow</div>}
          </div>
          <div className="ks2-present-clock">
            <div>
              <span className="ks2-present-big">{mmss}</span>
              <button className="k-btn" onClick={() => setT0(Date.now())}>
                Restart timer
              </button>
            </div>
            <div className="ks2-present-big">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div>
              Slide {page + 1} of {count}
              {typed && <span className="ks2-present-typed"> → {typed}</span>}
            </div>
            <div className="ks2-present-help">→ next · ← previous · B black · W white · P presenter view · Esc end</div>
          </div>
        </div>
      )}
      <div className={`ks2-present-bar${controls ? ' shown' : ''}`}>
        <button className="k-icon-btn" title="Previous (←)" onClick={() => goto(page - 1)}>
          <ChevronLeft size={18} />
        </button>
        <span>
          {page + 1} / {count}
        </span>
        <button className="k-icon-btn" title="Next (→)" onClick={() => goto(page + 1)}>
          <ChevronRight size={18} />
        </button>
        <button className="k-icon-btn" title="Presenter view (P)" onClick={() => setPresenter((v) => !v)}>
          {presenter ? <MonitorPlay size={16} /> : <Monitor size={16} />}
        </button>
        <button className="k-icon-btn" title="End the slideshow (Esc)" onClick={exit}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
