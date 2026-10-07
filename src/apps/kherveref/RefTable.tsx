// The reference list: sortable columns, multiple selection, keyboard,
// double-click to open the PDF, drag into a document to cite. Only the rows
// in view are drawn, so big libraries stay quick.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, FileText } from 'lucide-react'
import { authorText, container, personDisplay, year, type Entry } from './model'

export type SortCol = 'status' | 'key' | 'authors' | 'year' | 'title' | 'container' | 'added'
export interface Sort {
  col: SortCol
  desc: boolean
}

export const COLUMNS: { col: SortCol; label: string; width: string }[] = [
  { col: 'status', label: '', width: '28px' },
  { col: 'key', label: 'Key', width: 'minmax(90px, 0.9fr)' },
  { col: 'authors', label: 'Authors', width: 'minmax(90px, 0.9fr)' },
  { col: 'year', label: 'Year', width: '52px' },
  { col: 'title', label: 'Title', width: 'minmax(160px, 2.6fr)' },
  { col: 'container', label: 'Journal / Publisher', width: 'minmax(90px, 1fr)' },
  { col: 'added', label: 'Added', width: '86px' },
]
const TEMPLATE = COLUMNS.map((c) => c.width).join(' ')
const ROW_H = 26

export function sortValue(e: Entry, col: SortCol): string {
  switch (col) {
    case 'status':
      return e.needs_review ? '2' : e.files.length ? '1' : '0'
    case 'key':
      return e.key.toLowerCase()
    case 'authors':
      return authorText(e).toLowerCase()
    case 'year':
      return year(e)
    case 'title':
      return e.title.toLowerCase()
    case 'container':
      return container(e).toLowerCase()
    case 'added':
      return e.added
  }
}

export function sortEntries(entries: Entry[], sort: Sort): Entry[] {
  const dir = sort.desc ? -1 : 1
  return [...entries].sort((a, b) => {
    const x = sortValue(a, sort.col)
    const y = sortValue(b, sort.col)
    const c = x.localeCompare(y, undefined, { numeric: true })
    return c ? c * dir : a.key.localeCompare(b.key)
  })
}

interface Props {
  rows: Entry[]
  selected: Set<string>
  sort: Sort
  onSort(s: Sort): void
  onSelect(keys: string[]): void
  onOpen(e: Entry): void
  onDelete(): void
  onContextMenu(ev: React.MouseEvent, e: Entry): void
  onDragStart(ev: React.DragEvent, keys: string[]): void
  /** Shown when there are no rows. */
  empty: React.ReactNode
}

export function RefTable({ rows, selected, sort, onSort, onSelect, onOpen, onDelete, onContextMenu, onDragStart, empty }: Props) {
  const body = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const [view, setView] = useState({ top: 0, height: 600 })

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the (last) selected row in view.
  const lastSelected = [...selected].pop()
  useEffect(() => {
    const el = body.current
    if (!el || !lastSelected) return
    const i = rows.findIndex((r) => r.key === lastSelected)
    if (i < 0) return
    if (i * ROW_H < el.scrollTop) el.scrollTop = i * ROW_H
    else if ((i + 1) * ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * ROW_H - el.clientHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected])

  const click = (ev: React.MouseEvent, e: Entry, index: number) => {
    body.current?.focus()
    if (ev.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.key === anchor.current)
      if (a >= 0) {
        const [lo, hi] = a < index ? [a, index] : [index, a]
        onSelect(rows.slice(lo, hi + 1).map((r) => r.key))
        return
      }
    }
    if (ev.metaKey || ev.ctrlKey) {
      const next = new Set(selected)
      if (next.has(e.key)) next.delete(e.key)
      else next.add(e.key)
      anchor.current = e.key
      onSelect([...next])
      return
    }
    anchor.current = e.key
    onSelect([e.key])
  }

  const keyDown = (ev: React.KeyboardEvent) => {
    if (!rows.length) return
    const cur = rows.findIndex((r) => r.key === lastSelected)
    const move = (to: number) => {
      ev.preventDefault()
      const i = Math.max(0, Math.min(rows.length - 1, to))
      if (ev.shiftKey && anchor.current) {
        const a = rows.findIndex((r) => r.key === anchor.current)
        const [lo, hi] = a < i ? [a, i] : [i, a]
        onSelect([...rows.slice(lo, hi + 1).map((r) => r.key).filter((k) => k !== rows[i].key), rows[i].key])
      } else {
        anchor.current = rows[i].key
        onSelect([rows[i].key])
      }
    }
    const page = Math.max(1, Math.floor(view.height / ROW_H) - 1)
    if (ev.key === 'ArrowDown') move(cur + 1)
    else if (ev.key === 'ArrowUp') move(cur < 0 ? 0 : cur - 1)
    else if (ev.key === 'PageDown') move(cur + page)
    else if (ev.key === 'PageUp') move(cur - page)
    else if (ev.key === 'Home') move(0)
    else if (ev.key === 'End') move(rows.length - 1)
    else if (ev.key === 'Enter' && cur >= 0) {
      ev.preventDefault()
      onOpen(rows[cur])
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected.size) {
      ev.preventDefault()
      onDelete()
    } else if (ev.key === 'a' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault()
      onSelect(rows.map((r) => r.key))
    }
  }

  const first = Math.max(0, Math.floor(view.top / ROW_H) - 10)
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + 10)

  return (
    <div className="kr-table">
      <div className="kr-thead" style={{ gridTemplateColumns: TEMPLATE }}>
        {COLUMNS.map((c) => (
          <div
            key={c.col}
            className={`kr-th${sort.col === c.col ? ' sorted' : ''}`}
            onClick={() => onSort({ col: c.col, desc: sort.col === c.col ? !sort.desc : c.col === 'added' || c.col === 'year' })}
            title={c.col === 'status' ? 'Sort by status (PDF, needs checking)' : `Sort by ${c.label.toLowerCase()}`}
          >
            <span>{c.label}</span>
            {sort.col === c.col && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
          </div>
        ))}
      </div>
      <div
        className="kr-tbody"
        ref={body}
        tabIndex={0}
        onKeyDown={keyDown}
        onScroll={(ev) => setView({ top: ev.currentTarget.scrollTop, height: ev.currentTarget.clientHeight })}
      >
        {rows.length === 0 ? (
          <div className="kr-table-empty">{empty}</div>
        ) : (
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(first, last).map((e, k) => {
              const i = first + k
              const sel = selected.has(e.key)
              return (
                <div
                  key={e.key}
                  className={`kr-tr${sel ? ' selected' : ''}${i % 2 ? ' alt' : ''}`}
                  style={{ top: i * ROW_H, height: ROW_H, gridTemplateColumns: TEMPLATE }}
                  onMouseDown={(ev) => {
                    // Pressing on a row of a multiple selection may start dragging them all: decide on click.
                    const plain = !ev.shiftKey && !ev.metaKey && !ev.ctrlKey
                    if (ev.button === 0 && !(sel && plain && selected.size > 1)) click(ev, e, i)
                    else body.current?.focus()
                  }}
                  onClick={(ev) => {
                    if (sel && selected.size > 1 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) click(ev, e, i)
                  }}
                  onDoubleClick={() => onOpen(e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault()
                    if (!sel) onSelect([e.key])
                    onContextMenu(ev, e)
                  }}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, sel ? [...selected] : [e.key])}
                >
                  <div className="kr-td kr-status">
                    {e.needs_review ? (
                      <span title="Needs checking: the details were guessed">
                        <AlertTriangle size={13} className="kr-warn" />
                      </span>
                    ) : e.files.length ? (
                      <span title="PDF attached">
                        <FileText size={13} />
                      </span>
                    ) : null}
                  </div>
                  <div className="kr-td kr-mono">{e.key}</div>
                  <div className="kr-td" title={(e.authors.length ? e.authors : e.editors).map(personDisplay).join('; ')}>
                    {authorText(e)}
                  </div>
                  <div className="kr-td">{year(e)}</div>
                  <div className="kr-td" title={e.title}>
                    {e.title}
                  </div>
                  <div className="kr-td">{container(e)}</div>
                  <div className="kr-td k-muted">{e.added.slice(0, 10)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
