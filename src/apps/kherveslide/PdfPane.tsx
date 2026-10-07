// The desktop's right-hand panel — a PDF | Overview tab widget — and the PDF
// window that holds it in "Visual + PDF in its own window" (the default, as
// on the desktop: welcome.LAYOUT_DEFAULT).
//
// PDF (preview.py): the compiled presentation, every page one under the
// other at the panel's width, 18 px apart; it keeps its scroll position when
// a new compile arrives and jumps to the slide picked in the editor.
// Overview (overview.py): PowerPoint's slide sorter — every slide as a mini
// page in a grid that wraps to the panel's width; click to go, double-click
// to edit, drag to reorder, right-click for the slide menu, and a Size slider.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff } from 'lucide-react'
import type { AppProps } from '@/os'
import { openPdf, type PdfDocument } from '@/os/services/pdf'
import type { Deck } from './model'
import type { Look } from './look'
import type { Media } from './media'
import { Thumb, deckStamp } from './Navigator'
import { useLinks, type PdfLink, type RightTab } from './link'

// ------------------------------------------------------------------ PDF

function PdfPageCanvas({ doc, index, width }: { doc: PdfDocument; index: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const info = doc.pages[index]
  useEffect(() => {
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
        c.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => {})
    return () => ac.abort()
  }, [doc, index, width, info])
  return <canvas ref={ref} className="ks2-pdfpage" data-page={index} style={{ width, height: info ? (width * info.height) / info.width : undefined }} />
}

const PAGE_SPACING = 18
const MARGIN = 6

export function PdfView({ pdf, busy, page, pageTick }: { pdf: Uint8Array | null; busy: boolean; page: number; pageTick: number }) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(80, el.clientWidth - 2 * MARGIN - 14)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf) {
      setDoc(null)
      return
    }
    let alive = true
    openPdf(pdf.slice())
      .then((x) => {
        if (!alive) return x.close()
        // The old pages stay on screen until the new ones are drawn (same canvases).
        setDoc(x)
        setError('')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [pdf])
  useEffect(() => () => doc?.close(), [doc])

  // Jump to the page of the slide picked in the editor (each shown slide is one page);
  // a new compile keeps the scroll position, as preview.show_pdf does.
  const jumped = useRef(-1)
  useEffect(() => {
    const el = box.current
    if (!el || !doc || jumped.current === pageTick) return
    jumped.current = pageTick
    const target = el.querySelector<HTMLElement>(`[data-page="${Math.min(page, doc.pageCount - 1)}"]`)
    if (target) el.scrollTop = target.offsetTop - MARGIN
  }, [page, pageTick, doc])

  return (
    <div className="ks2-pdfview" ref={box}>
      {!doc && !error && <div className="ks2-pdf-empty">{busy ? 'Compiling…' : pdf ? '' : 'The compiled PDF shows here. Compile with the ▶ button (⌘R).'}</div>}
      {error && <div className="ks2-pdf-empty k-error">{error}</div>}
      {doc && (
        <div className="ks2-pdfpages" style={{ gap: PAGE_SPACING, padding: MARGIN }}>
          {Array.from({ length: doc.pageCount }, (_, i) => (
            <PdfPageCanvas key={i} doc={doc} index={i} width={width} />
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Overview

interface OverviewProps {
  deck: Deck
  look: Look
  media: Media
  backdrop: (string | null)[] | null
  current: number
  onGo: (i: number) => void
  onOpen: (i: number) => void
  onReorder: (order: number[]) => void
  onMenu: (e: React.MouseEvent, i: number) => void
}

let overviewSize = 200

export function Overview({ deck, look, media, backdrop, current, onGo, onOpen, onReorder, onMenu }: OverviewProps) {
  const [size, setSize] = useState(overviewSize)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const stamp = deckStamp(deck, look)
  return (
    <div className="ks2-overview">
      <div className="ks2-overview-head">
        <b>All slides</b>
        <span className="ks2-overview-hint">click to go · double-click to edit · drag to reorder</span>
        <span>Size</span>
        <input
          type="range"
          min={110}
          max={420}
          value={size}
          title="Size of the mini pages"
          onChange={(e) => {
            overviewSize = Number(e.target.value)
            setSize(overviewSize)
          }}
        />
      </div>
      <div className="ks2-overview-grid">
        {deck.slides.map((s, i) => (
          <div
            key={i}
            className={`ks2-ov-item${i === current ? ' current' : ''}${s.hidden ? ' hidden' : ''}${dropAt === i && dragFrom !== null ? ' drop' : ''}`}
            title={(s.title || `Slide ${i + 1}`) + (s.hidden ? ' — hidden' : '')}
            draggable
            onClick={() => onGo(i)}
            onDoubleClick={() => onOpen(i)}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu(e, i)
            }}
            onDragStart={(e) => {
              setDragFrom(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-ks2-slide', String(i))
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return
              e.preventDefault()
              setDropAt(i)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDropAt(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null && dragFrom !== i) {
                const order = deck.slides.map((_, k) => k)
                order.splice(dragFrom, 1)
                order.splice(i, 0, dragFrom)
                onReorder(order)
              }
              setDragFrom(null)
              setDropAt(null)
            }}
          >
            <div className="ks2-ov-pic">
              <Thumb deck={deck} slide={s} look={look} media={media} width={size} backdrop={backdrop?.[i] ?? null} stamp={stamp + JSON.stringify(s)} />
              {s.hidden && (
                <span className="ks2-nav-eye">
                  <EyeOff size={12} />
                </span>
              )}
            </div>
            <span className="ks2-ov-num">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the PDF | Overview tabs

export function RightTabs({ link }: { link: PdfLink }) {
  const a = link.actions
  const tabs: [RightTab, string][] = [['pdf', 'PDF'], ['overview', 'Overview']]
  return (
    <div className="ks2-righttabs">
      <div className="ks2-qtabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={`ks2-qtab${link.tab === k ? ' active' : ''}`} onClick={() => a.tab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ks2-qtab-body">
        {link.tab === 'pdf' ? (
          <PdfView pdf={link.pdf} busy={link.busy} page={link.page} pageTick={link.pageTick} />
        ) : (
          <Overview
            deck={link.deck}
            look={link.look}
            media={link.media}
            backdrop={link.backdrop}
            current={link.current}
            onGo={a.goto}
            onOpen={a.open}
            onReorder={a.reorder}
            onMenu={a.slideMenu}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the PDF window

/** The second window: os.open('kherveslide', { pdfFor: <main window id> }). Closing it docks the panel back (desktop _PdfWindow). */
export function PdfWindow({ win, args }: AppProps) {
  const mainId = String(args.pdfFor)
  const link = useLinks((s) => s.links[mainId])
  const present = !!link

  // The main window went away (or never published): this window goes too.
  useEffect(() => {
    if (present) return
    const t = setTimeout(() => {
      if (!useLinks.getState().links[mainId]) win.close(true)
    }, 1500)
    return () => clearTimeout(t)
  }, [present, mainId, win])

  useEffect(() => {
    if (link) win.setTitle(`${link.title} — PDF`)
  }, [win, link?.title, link])
  useEffect(() => {
    win.setMenus(link?.menus ?? null)
  }, [win, link?.menus, link])
  useEffect(() => () => win.setMenus(null), [win])
  useEffect(() => {
    win.setCloseGuard(() => {
      useLinks.getState().links[mainId]?.actions.dock()
      return true
    })
    return () => win.setCloseGuard(null)
  }, [win, mainId])

  return <div className="k-app ks2-app ks2-pdfwindow">{link ? <RightTabs link={link} /> : <div className="ks2-pdf-empty">The presentation was closed.</div>}</div>
}
