// The sheet tabs under the grid, like the desktop's: ◀ ▶ + and the sheet
// list, then one tab per sheet — click to show it, double-click to rename,
// drag to reorder, right-click for the rest.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import { ChevronLeft, ChevronRight, ChevronsUpDown, Plus } from 'lucide-react'
import { os } from '@/os'
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

  const menu = (e: { clientX: number; clientY: number }, id: string) => {
    const i = sheets.findIndex((s) => s.id === id)
    os.contextMenu(e, [
      { label: 'Insert Sheet', onClick: () => void addSheet(book, i + 1) },
      { label: 'Rename…', onClick: () => startRename(id) },
      { label: 'Duplicate', onClick: () => void duplicateSheet(book, id) },
      { label: 'Delete', danger: true, disabled: sheets.length <= 1, onClick: () => void removeSheet(book, id) },
      '-',
      { label: 'Move Left', disabled: i <= 0, onClick: () => void moveSheet(book, id, i - 1) },
      { label: 'Move Right', disabled: i >= sheets.length - 1, onClick: () => void moveSheet(book, id, i + 1) },
    ])
  }

  const overIndex = (clientX: number): number => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) return i
    }
    return tabs.length - 1
  }

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0 || renaming) return
    press.current = { id, x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p) return
    if (!p.moved && Math.abs(e.clientX - p.x) < 6) return
    p.moved = true
    setDragging({ id: p.id, over: overIndex(e.clientX) })
  }
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
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
    <div className="ks-tabs" onContextMenu={(e) => e.preventDefault()}>
      <div className="ks-tabs-nav">
        <button className="k-icon-btn" title="Previous sheet" disabled={index <= 0} onClick={() => book.activate(sheets[index - 1].id)}>
          <ChevronLeft size={15} />
        </button>
        <button className="k-icon-btn" title="Next sheet" disabled={index >= sheets.length - 1} onClick={() => book.activate(sheets[index + 1].id)}>
          <ChevronRight size={15} />
        </button>
        <button className="k-icon-btn" title="Add a sheet" onClick={() => void addSheet(book, sheets.length)}>
          <Plus size={15} />
        </button>
        <button
          className="k-icon-btn"
          title="All sheets"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            os.contextMenu({ clientX: r.left, clientY: r.top }, sheets.map((s) => ({ label: s.name, checked: s.id === active, onClick: () => book.activate(s.id) })), { above: true })
          }}
        >
          <ChevronsUpDown size={14} />
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
              <button
                className={`ks-tab${s.id === active ? ' on' : ''}${dragging?.id === s.id ? ' moving' : ''}`}
                onPointerDown={(e) => onDown(e, s.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => {
                  press.current = null
                  setDragging(null)
                }}
                onDoubleClick={() => startRename(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  menu(e, s.id)
                }}
                title="Double-click to rename, drag to move"
              >
                {s.name}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
