// Slideshow: one whole page at a time on a dark stage, in the window or full
// screen; by hand (click, arrows, wheel) or continuously every N seconds.
// Ported from the desktop KhervePDF's SlideshowView.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import type { PdfAnnot } from '@/os/services/pdf'
import { AnnotSvg } from './AnnotSvg'
import type { PdfTab } from './model'

export interface SlideSettings {
  continuous: boolean
  seconds: number
  loop: boolean
}

export const INTERVAL_MIN = 1
export const INTERVAL_MAX = 600
const HIDE_MS = 2500
const WHEEL_COOLDOWN = 250

interface Props {
  tab: PdfTab
  start: number
  fullscreen: boolean
  settings: SlideSettings
  onSettings: (s: SlideSettings) => void
  onPage: (page: number) => void
  onToggleFullscreen: () => void
  onExit: (page: number) => void
}

export function Slideshow({ tab, start, fullscreen, settings, onSettings, onPage, onToggleFullscreen, onExit }: Props) {
  const pdf = tab.pdf
  const n = pdf.pageCount
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(Math.max(0, Math.min(start, n - 1)))
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [controls, setControls] = useState(true)
  const [progress, setProgress] = useState(0)
  const cache = useRef(new Map<string, ImageBitmap>())
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheel = useRef({ acc: 0, at: 0 })
  const live = useRef({ page, settings })
  live.current = { page, settings }

  // ---- navigation
  const goto = useCallback(
    (i: number) => {
      if (i < 0 || i >= n) return
      setPage(i)
      setProgress(0)
      onPage(i)
    },
    [n, onPage],
  )
  const next = useCallback(() => {
    const { page: p, settings: s } = live.current
    if (p + 1 < n) goto(p + 1)
    else if (s.loop && n > 1) goto(0)
  }, [n, goto])
  const prev = useCallback(() => {
    const { page: p, settings: s } = live.current
    if (p > 0) goto(p - 1)
    else if (s.loop && n > 1) goto(n - 1)
  }, [n, goto])

  // ---- full screen
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    if (fullscreen && document.fullscreenElement !== el) void el.requestFullscreen?.().catch(() => onToggleFullscreen())
    if (!fullscreen && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    el.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen])
  useEffect(() => {
    const onChange = () => {
      // Leaving full screen with Esc ends the show, like the desktop app.
      if (fullscreen && document.fullscreenElement !== stageRef.current) onExit(live.current.page)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [fullscreen, onExit])
  useEffect(
    () => () => {
      if (document.fullscreenElement === stageRef.current) void document.exitFullscreen().catch(() => {})
      for (const b of cache.current.values()) b.close()
      cache.current.clear()
    },
    [],
  )

  // ---- stage size
  useLayoutEffect(() => {
    const el = stageRef.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const info = pdf.pages[page]
  const fit = info && size.w && size.h ? Math.min(size.w / info.width, size.h / info.height) : 0

  // ---- render the page (and keep the next one ready)
  useEffect(() => {
    if (!fit) return
    const dpr = window.devicePixelRatio || 1
    const ac = new AbortController()
    const keyOf = (i: number) => `${i}:${size.w}x${size.h}:${tab.docVersion}`
    const get = async (i: number) => {
      const k = keyOf(i)
      const have = cache.current.get(k)
      if (have) return have
      const p = pdf.pages[i]
      const f = Math.min(size.w / p.width, size.h / p.height)
      const bmp = await pdf.renderPage(i, f * dpr, { signal: ac.signal, priority: 'high' })
      cache.current.set(k, bmp)
      while (cache.current.size > 3) {
        const [oldest, b] = cache.current.entries().next().value as [string, ImageBitmap]
        if (oldest === keyOf(live.current.page)) break
        cache.current.delete(oldest)
        b.close()
      }
      return bmp
    }
    void get(page)
      .then((bmp) => {
        const c = canvasRef.current
        if (!c || ac.signal.aborted) return
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')?.drawImage(bmp, 0, 0)
        const nxt = page + 1 < n ? page + 1 : live.current.settings.loop ? 0 : -1
        if (nxt >= 0 && nxt !== page) void get(nxt).catch(() => {})
      })
      .catch(() => {})
    return () => ac.abort()
  }, [pdf, page, fit, size.w, size.h, n, tab.docVersion])

  // ---- continuous: turn the page every N seconds
  useEffect(() => {
    if (!settings.continuous) return
    const startAt = performance.now() - progress * settings.seconds * 1000
    const timer = setInterval(() => {
      const f = (performance.now() - startAt) / (settings.seconds * 1000)
      if (f < 1) return setProgress(f)
      const { page: p, settings: s } = live.current
      if (p + 1 >= n && !s.loop) {
        onSettings({ ...s, continuous: false })
        setProgress(0)
        return
      }
      next()
    }, 50)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.continuous, settings.seconds, page])

  // ---- the control bar hides itself when the mouse rests
  const wake = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), HIDE_MS)
  }, [])
  useEffect(() => {
    wake()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [wake])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    if (k === 'Escape') onExit(page)
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) next()
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) prev()
    else if (k === 'Home') goto(0)
    else if (k === 'End') goto(n - 1)
    else if (k === 'p' || k === 'P') onSettings({ ...settings, continuous: !settings.continuous })
    else if (k === 'f' || k === 'F') onToggleFullscreen()
    else return
    e.preventDefault()
    e.stopPropagation()
    wake()
  }

  const annots: PdfAnnot[] = tab.annots.filter((a) => a.page === page && a.kind !== 'redact')
  const w = info ? info.width * fit : 0
  const h = info ? info.height * fit : 0

  return (
    <div
      ref={stageRef}
      className={`kp-stage${fullscreen ? ' full' : ''}${controls ? '' : ' idle'}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.kp-stage-bar')) return
        e.currentTarget.focus()
        if (e.button === 0) next()
        wake()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        prev()
      }}
      onWheel={(e) => {
        const wl = wheel.current
        wl.acc += e.deltaY
        const now = performance.now()
        if (Math.abs(wl.acc) >= 60 && now - wl.at >= WHEEL_COOLDOWN) {
          if (wl.acc > 0) next()
          else prev()
          wl.acc = 0
          wl.at = now
        }
        wake()
      }}
    >
      {info && (
        <div className="kp-stage-page" style={{ width: w, height: h }}>
          <canvas ref={canvasRef} className="kp-page-canvas" />
          <AnnotSvg page={info} annots={annots} />
        </div>
      )}
      {settings.continuous && <div className="kp-stage-progress" style={{ width: `${progress * 100}%` }} />}
      <div className="kp-stage-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button title="Previous page (←)" onClick={prev}><Icon name="prev_page" size={22} /></button>
        <button
          className={settings.continuous ? 'on' : ''}
          title={settings.continuous ? 'Pause automatic advance (P)' : 'Advance automatically (P)'}
          onClick={() => onSettings({ ...settings, continuous: !settings.continuous })}
        >
          <Icon name={settings.continuous ? 'pause' : 'play'} size={22} />
        </button>
        <button title="Next page (→ / Space)" onClick={next}><Icon name="next_page" size={22} /></button>
        <span className="kp-stage-label">{page + 1} / {n}</span>
        <label className="kp-stage-secs" title="Seconds each page stays on screen">
          <input
            type="number"
            min={INTERVAL_MIN}
            max={INTERVAL_MAX}
            value={settings.seconds}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value))
              if (v >= INTERVAL_MIN && v <= INTERVAL_MAX) onSettings({ ...settings, seconds: v })
            }}
          />
          s
        </label>
        <button className={settings.loop ? 'on' : ''} title="Loop back to the first page after the last" onClick={() => onSettings({ ...settings, loop: !settings.loop })}>
          <Icon name="loop" size={22} />
        </button>
        <button title={fullscreen ? 'Show in this window instead (F)' : 'Show full screen (F)'} onClick={onToggleFullscreen}>
          <Icon name={fullscreen ? 'exit_full' : 'fullscreen'} size={22} />
        </button>
        <button title="End slideshow (Esc)" onClick={() => onExit(page)}><Icon name="close_x" size={22} /></button>
      </div>
    </div>
  )
}
