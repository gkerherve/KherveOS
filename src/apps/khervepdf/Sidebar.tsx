// The side panel: page thumbnails (click to jump, drag to reorder, right-click
// for page operations) and the table of contents (bookmarks; when the PDF has
// none, headings detected from the text, as in the desktop app).

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, ChevronDown, ChevronRight, PanelLeftClose } from 'lucide-react'
import { os } from '@/os'
import type { PdfDocument, PdfOutlineItem, PdfPageInfo } from '@/os/services/pdf'
import { useTab, type PdfTab } from './model'

const THUMB_W = 132
const ITEM_PAD = 10
const LABEL_H = 18

const Thumb = memo(function Thumb({ pdf, index, info, renderKey }: { pdf: PdfDocument; index: number; info: PdfPageInfo; renderKey: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ac = new AbortController()
    const dpr = window.devicePixelRatio || 1
    pdf
      .renderPage(index, (THUMB_W * dpr) / info.width, { signal: ac.signal, priority: 'low' })
      .then((bmp) => {
        const c = ref.current
        if (!c || ac.signal.aborted) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')?.drawImage(bmp, 0, 0)
        bmp.close()
      })
      .catch(() => {})
    return () => ac.abort()
  }, [pdf, index, info, renderKey])
  return <canvas ref={ref} className="kp-thumb-canvas" style={{ width: THUMB_W, height: (THUMB_W * info.height) / info.width }} />
})

function Thumbnails({ tab, onMovePage, onPageMenu }: {
  tab: PdfTab
  onMovePage: (from: number, to: number) => void
  onPageMenu: (e: React.MouseEvent, page: number) => void
}) {
  const pages = tab.pdf.pages
  const ref = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState({ top: 0, height: 0 })
  const [drop, setDrop] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const current = tab.view.page

  const tops = useMemo(() => {
    let y = 6
    return pages.map((p) => {
      const top = y
      y += (THUMB_W * p.height) / p.width + LABEL_H + ITEM_PAD * 2
      return top
    })
  }, [pages])
  const total = tops.length ? tops[tops.length - 1] + (THUMB_W * pages[pages.length - 1].height) / pages[pages.length - 1].width + LABEL_H + ITEM_PAD * 2 + 6 : 0

  useLayoutEffect(() => {
    const el = ref.current!
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  // Keep the current page's thumbnail in view.
  useEffect(() => {
    const el = ref.current
    if (!el || !tops.length || dragFrom.current !== null) return
    const top = tops[Math.min(current, tops.length - 1)]
    const bottom = (tops[current + 1] ?? total) - 6
    if (top < el.scrollTop) el.scrollTop = top - 6
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 6
  }, [current, tops, total])

  const first = Math.max(0, tops.findIndex((_t, i) => (tops[i + 1] ?? total) >= vp.top - 200))
  let last = first
  while (last + 1 < tops.length && tops[last + 1] < vp.top + vp.height + 200) last++

  const dropIndex = (e: React.DragEvent, i: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? i + 1 : i
  }

  return (
    <div ref={ref} className="kp-thumbs" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}>
      <div style={{ height: total, position: 'relative' }}>
        {tops.slice(first, last + 1).map((top, k) => {
          const i = first + k
          const info = pages[i]
          return (
            <div
              key={i}
              className={`kp-thumb${i === current ? ' current' : ''}${drop === i ? ' drop-before' : ''}${drop === i + 1 && i === pages.length - 1 ? ' drop-after' : ''}`}
              style={{ top, height: (THUMB_W * info.height) / info.width + LABEL_H + ITEM_PAD * 2 }}
              draggable
              title="Click to go to this page — drag to move it"
              onClick={() => tab.goto(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                onPageMenu(e, i)
              }}
              onDragStart={(e) => {
                dragFrom.current = i
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-khervepdf-page', String(i))
              }}
              onDragEnd={() => {
                dragFrom.current = null
                setDrop(null)
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDrop(dropIndex(e, i))
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragFrom.current
                const to = dropIndex(e, i)
                dragFrom.current = null
                setDrop(null)
                if (from === null || to === from || to === from + 1) return
                onMovePage(from, to > from ? to - 1 : to)
              }}
            >
              <div className="kp-thumb-frame">
                <Thumb pdf={tab.pdf} index={i} info={info} renderKey={tab.docVersion} />
              </div>
              <div className="kp-thumb-label">{info.label !== String(i + 1) ? `${info.label} (${i + 1})` : i + 1}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OutlineNode({ item, depth, path, current, onGo, onMenu }: {
  item: PdfOutlineItem
  depth: number
  path: number[]
  current: number
  onGo: (page: number) => void
  onMenu: (e: React.MouseEvent, path: number[]) => void
}) {
  const [open, setOpen] = useState(item.open ?? depth < 1)
  const kids = item.children ?? []
  return (
    <div>
      <div
        className={`kp-outline-row${item.page === current ? ' current' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        title={item.page !== null ? `Page ${item.page + 1}` : item.uri}
        onClick={() => item.page !== null && onGo(item.page)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(e, path)
        }}
      >
        <span
          className="kp-outline-twist"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {kids.length ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </span>
        <span className="kp-outline-title">{item.title || 'Untitled'}</span>
        {item.page !== null && <span className="kp-outline-page">{item.page + 1}</span>}
      </div>
      {open && kids.map((k, i) => (
        <OutlineNode key={i} item={k} depth={depth + 1} path={[...path, i]} current={current} onGo={onGo} onMenu={onMenu} />
      ))}
    </div>
  )
}

function Outline({ tab, onEdit }: { tab: PdfTab; onEdit: (items: PdfOutlineItem[]) => void }) {
  // Read again when pages were added, removed or moved (the page array changes then).
  const cache = tab.outlineCache && tab.outlineCache.pages === tab.pdf.pages ? tab.outlineCache : null
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (cache || tab.pdf.closed) return
    let alive = true
    const pages = tab.pdf.pages
    setLoading(true)
    void (async () => {
      try {
        const items = await tab.pdf.outline()
        const detected = !items.length
        const list = detected ? await tab.pdf.detectHeadings() : items
        if (!alive) return
        tab.outlineCache = { items: list, detected, pages }
        tab.emit()
      } catch {
        if (alive) {
          tab.outlineCache = { items: [], detected: false, pages }
          tab.emit()
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [tab, cache])

  const items = cache?.items ?? []
  const real = cache && !cache.detected ? items : []

  const itemAt = (list: PdfOutlineItem[], path: number[]) => path.reduce<PdfOutlineItem | null>((it, i) => (it ? it.children?.[i] ?? null : list[i] ?? null), null)
  const without = (list: PdfOutlineItem[], path: number[]): PdfOutlineItem[] => {
    if (path.length === 1) return list.filter((_, i) => i !== path[0])
    return list.map((it, i) => (i === path[0] ? { ...it, children: without(it.children ?? [], path.slice(1)) } : it))
  }
  const renamed = (list: PdfOutlineItem[], path: number[], title: string): PdfOutlineItem[] =>
    list.map((it, i) => (i !== path[0] ? it : path.length === 1 ? { ...it, title } : { ...it, children: renamed(it.children ?? [], path.slice(1), title) }))

  const onMenu = (e: React.MouseEvent, path: number[]) => {
    if (cache?.detected) {
      os.contextMenu(e, [{ label: 'Keep These Headings as Bookmarks', onClick: () => onEdit(items) }])
      return
    }
    const it = itemAt(real, path)
    if (!it) return
    os.contextMenu(e, [
      {
        label: 'Rename…',
        onClick: async () => {
          const title = await os.dialog.prompt('Bookmark name:', { title: 'Rename bookmark', defaultValue: it.title })
          if (title !== null && title.trim()) onEdit(renamed(real, path, title.trim()))
        },
      },
      { label: 'Delete Bookmark', danger: true, onClick: () => onEdit(without(real, path)) },
    ])
  }

  const add = async () => {
    const page = tab.view.page
    const title = await os.dialog.prompt(`Bookmark for page ${page + 1}:`, { title: 'Add bookmark', defaultValue: `Page ${page + 1}` })
    if (title === null || !title.trim()) return
    const next = [...real, { title: title.trim(), page, open: false }]
    next.sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
    onEdit(next)
  }

  return (
    <div className="kp-outline">
      <div className="kp-outline-bar">
        <span className="k-muted">{cache?.detected && items.length ? 'Detected headings' : 'Bookmarks'}</span>
        <button className="k-icon-btn" title="Add a bookmark for this page" onClick={() => void add()}>
          <BookmarkPlus size={15} />
        </button>
      </div>
      <div className="kp-outline-tree">
        {loading && !cache && <div className="k-empty">Reading…</div>}
        {cache && !items.length && <div className="k-empty">No table of contents</div>}
        {items.map((it, i) => (
          <OutlineNode key={i} item={it} depth={0} path={[i]} current={tab.view.page} onGo={(p) => tab.goto(p)} onMenu={onMenu} />
        ))}
      </div>
    </div>
  )
}

export function Sidebar({ tab, onClose, onMovePage, onPageMenu, onEditOutline }: {
  tab: PdfTab
  onClose: () => void
  onMovePage: (from: number, to: number) => void
  onPageMenu: (e: React.MouseEvent, page: number) => void
  onEditOutline: (items: PdfOutlineItem[]) => void
}) {
  useTab(tab)
  const [mode, setMode] = useState<'pages' | 'outline'>('pages')
  return (
    <div className="kp-sidebar">
      <div className="kp-side-tabs">
        <button className={mode === 'pages' ? 'active' : ''} onClick={() => setMode('pages')}>Pages</button>
        <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}>Contents</button>
        <span className="k-spacer" />
        <button className="k-icon-btn" title="Hide the side panel" onClick={onClose}>
          <PanelLeftClose size={15} />
        </button>
      </div>
      {mode === 'pages' ? (
        <Thumbnails tab={tab} onMovePage={onMovePage} onPageMenu={onPageMenu} />
      ) : (
        <Outline tab={tab} onEdit={onEditOutline} />
      )}
    </div>
  )
}
