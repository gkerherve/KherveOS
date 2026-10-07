// The sheet tabs under the grid, like the desktop's (workbook.py): the
// ◀ ▶ + ∨ corner buttons, then one tab per sheet with its close button —
// click to show it, double-click to rename, drag to reorder, × to delete
// (after asking), right-click for New / Rename / Delete / Duplicate / Move.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import { X } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { addSheet, duplicateSheet, moveSheet, removeSheet, renameSheet } from './ops'

export function SheetTabs({ book }: { book: Book }) {
  const sheets = useStore(book.store, (s) => s.sheets)
  const active = useStore(book.store, (s) => s.active)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState<{ id: string; over: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const press = useRef<{ id: string; x: number; moved: boolean } | null>(null)
  const index = sheets.findIndex((s) => s.id === active)

  const startRename = (id: string) => {
    setRenaming(id)
    setDraft(sheets.find((s) => s.id === id)?.name ?? '')
  }
  const finishRename = () => {
    if (renaming) void renameSheet(book, renaming, draft)
    setRenaming(null)
    book.refocus()
  }

  const del = async (id: string) => {
    if (sheets.length <= 1) return
    const name = sheets.find((s) => s.id === id)?.name ?? ''
    if (await os.dialog.confirm(`Delete '${name}'?`, { title: 'Delete Sheet' })) await removeSheet(book, id)
    book.refocus()
  }

  const menu = (e: { clientX: number; clientY: number }, id: string | null) => {
    const i = id ? sheets.findIndex((s) => s.id === id) : -1
    const items: MenuItem[] = [{ label: 'New Sheet', onClick: () => void addSheet(book, sheets.length) }]
    if (id) {
      items.push({ label: 'Rename Sheet…', onClick: () => startRename(id) })
      if (sheets.length > 1) items.push({ label: 'Delete Sheet', onClick: () => void del(id) })
      items.push('-', { label: 'Duplicate Sheet', onClick: () => void duplicateSheet(book, id) }, '-')
      if (i > 0) items.push({ label: 'Move Left', onClick: () => void moveSheet(book, id, i - 1) })
      if (i < sheets.length - 1) items.push({ label: 'Move Right', onClick: () => void moveSheet(book, id, i + 1) })
    }
    os.contextMenu(e, items)
  }

  const overIndex = (clientX: number): number => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return tabs.length - 1
  }

  const onDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || renaming) return
    press.current = { id, x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.abs(e.clientX - p.x) < 6) return
    p.moved = true
    setDragging({ id: p.id, over: overIndex(e.clientX) })
  }
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current
    press.current = null
    setDragging(null)
    if (!p) return
    if (p.moved) {
      const to = overIndex(e.clientX)
      const from = sheets.findIndex((s) => s.id === p.id)
      if (to !== from) void moveSheet(book, p.id, to)
    } else book.activate(p.id)
    book.refocus()
  }

  return (
    <div
      className="ks-tabs"
      onContextMenu={(e) => {
        e.preventDefault()
        menu(e, null)
      }}
    >
      <div className="ks-tabs-nav">
        <button className="ks-tabs-btn" title="Previous sheet" disabled={index <= 0} onClick={() => book.activate(sheets[index - 1].id)}>◀</button>
        <button className="ks-tabs-btn" title="Next sheet" disabled={index >= sheets.length - 1} onClick={() => book.activate(sheets[index + 1].id)}>▶</button>
        <button className="ks-tabs-btn" title="Add sheet" onClick={() => void addSheet(book, sheets.length)}>+</button>
        <button
          className="ks-tabs-btn"
          title="Show all sheets"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            os.contextMenu({ clientX: r.left, clientY: r.top }, sheets.map((s) => ({ label: s.name, checked: s.id === active, onClick: () => book.activate(s.id) })), { above: true })
          }}
        >
          ∨
        </button>
      </div>
      <div className="ks-tabs-strip" ref={strip}>
        {sheets.map((s, i) => (
          <div key={s.id} className={`ks-tab-slot${dragging && dragging.over === i && dragging.id !== s.id ? ' drop' : ''}`} data-tab>
            {renaming === s.id ? (
              <input
                className="ks-tab-input"
                value={draft}
                autoFocus
                maxLength={31}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') finishRename()
                  if (e.key === 'Escape') {
                    setRenaming(null)
                    book.refocus()
                  }
                }}
              />
            ) : (
              <div
                className={`ks-tab${s.id === active ? ' on' : ''}${dragging?.id === s.id ? ' moving' : ''}`}
                role="tab"
                aria-selected={s.id === active}
                tabIndex={-1}
                onPointerDown={(e) => !(e.target as HTMLElement).closest('.ks-tab-x') && onDown(e, s.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => {
                  press.current = null
                  setDragging(null)
                }}
                onDoubleClick={() => startRename(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  menu(e, s.id)
                }}
                title="Double-click to rename, drag to move"
              >
                <span>{s.name}</span>
                <button
                  className="ks-tab-x"
                  title="Delete sheet"
                  aria-label={`Delete ${s.name}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void del(s.id)
                  }}
                >
                  <X size={12} strokeWidth={2.6} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
