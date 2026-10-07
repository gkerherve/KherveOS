// Find (⌘F): searches every page as you type and steps through the matches.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
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
        const start = Math.max(0, hits.findIndex((h) => h.page >= tab.view.page))
        tab.search = { query, hits, index: hits.length ? start : -1, busy: false }
        tab.emit()
        if (hits.length) go(start)
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
  const status = !q.trim() ? '' : s?.busy ? 'Searching…' : s && s.hits.length ? `${s.index + 1} of ${s.hits.length}` : 'No matches'

  return (
    <div className="kp-find" onPointerDown={(e) => e.stopPropagation()}>
      <Search size={14} className="k-muted" />
      <input
        ref={input}
        value={q}
        placeholder="Find in document"
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
      <button className="k-icon-btn" title="Previous match (⇧↩)" disabled={!s?.hits.length} onClick={() => go((s?.index ?? 0) - 1)}>
        <ChevronUp size={15} />
      </button>
      <button className="k-icon-btn" title="Next match (↩)" disabled={!s?.hits.length} onClick={() => go((s?.index ?? -1) + 1)}>
        <ChevronDown size={15} />
      </button>
      <button className="k-icon-btn" title="Close (Esc)" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  )
}
