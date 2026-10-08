// find_bar.FindBar: the floating "Find:" bar at the top of the page view —
// searches every page as you type, Enter / Next / Prev step through the
// matches (with wrap-around), Esc or ✕ closes it.

import { useEffect, useRef, useState } from 'react'
import { unionRect } from './geometry'
import { useTab, type PdfTab } from './model'
import type { PdfRect } from '@/os/services/pdf'

export function FindBar({ tab, focusKey, onClose }: { tab: PdfTab; focusKey: number; onClose: () => void }) {
  useTab(tab)
  const [q, setQ] = useState(tab.search?.query ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  const go = (i: number) => {
    const s = tab.search
    if (!s || !s.hits.length) return
    const index = ((i % s.hits.length) + s.hits.length) % s.hits.length
    tab.search = { ...s, index }
    const h = s.hits[index]
    const r = unionRect(h.rects.map((x) => [x.x, x.y, x.x + x.w, x.y + x.h] as PdfRect))
    tab.goto(h.page, r ?? undefined, true)
  }

  useEffect(() => {
    const query = q.trim()
    if (!query) {
      if (tab.search) {
        tab.search = null
        tab.emit()
      }
      return
    }
    tab.search = { query, hits: tab.search?.query === query ? tab.search.hits : [], index: tab.search?.index ?? 0, busy: true }
    tab.emit()
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const hits = await tab.pdf.search(query)
        if (!alive || tab.search?.query !== query) return
        // Like the desktop: the first match of the document is current.
        tab.search = { query, hits, index: hits.length ? 0 : -1, busy: false }
        tab.emit()
        if (hits.length) go(0)
      } catch {
        if (alive) {
          tab.search = { query, hits: [], index: -1, busy: false }
          tab.emit()
        }
      }
    }, 220)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, tab.docVersion])

  const s = tab.search
  const status = !q.trim() ? '' : s?.busy ? '…' : s && s.hits.length ? `${s.index + 1} / ${s.hits.length}` : '0 matches'

  return (
    <div className="kp-find" onPointerDown={(e) => e.stopPropagation()}>
      <span>Find:</span>
      <input
        ref={input}
        value={q}
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation()
            go((s?.index ?? -1) + (e.shiftKey ? -1 : 1))
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <span className="kp-find-count">{status}</span>
      <button className="kp-find-btn" onClick={() => go((s?.index ?? 0) - 1)}>Prev</button>
      <button className="kp-find-btn" onClick={() => go((s?.index ?? -1) + 1)}>Next</button>
      <button className="kp-find-x" title="Close (Esc)" onClick={onClose}>✕</button>
    </div>
  )
}
