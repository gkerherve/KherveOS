// The NIST entries of the selected element, sortable by any column. Only the
// rows in view are drawn, so tens of thousands of entries scroll smoothly.

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { NistDb, Sort, SortKey } from './data'

const ROW_H = 26
const OVERSCAN = 10

type Col = { key: SortKey; label: string; width: string; num?: boolean }
const COLS: Col[] = [
  { key: 'element', label: 'El.', width: '44px' },
  { key: 'line', label: 'Line', width: '70px' },
  { key: 'be', label: 'BE (eV)', width: '76px', num: true },
  { key: 'formula', label: 'Formula', width: 'minmax(90px, 1fr)' },
  { key: 'name', label: 'Name', width: 'minmax(120px, 1.6fr)' },
  { key: 'journal', label: 'Journal', width: 'minmax(120px, 1.6fr)' },
]
const TEMPLATE = COLS.map((c) => c.width).join(' ')

interface Props {
  db: NistDb
  /** Row numbers, already in table order. */
  rows: number[]
  sort: Sort
  onSort: (key: SortKey) => void
  onRowClick: (row: number) => void
  onRowMenu: (row: number, e: MouseEvent) => void
  /** The row whose details are open. */
  active: number | null
  status: ReactNode
}

export default function ResultsTable({ db, rows, sort, onSort, onRowClick, onRowMenu, active, status }: Props) {
  const body = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(300)

  useEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new element, filter or order starts at the top.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0
    setScrollTop(0)
  }, [rows])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)

  return (
    <div className="kdb-results">
      <div className="kdb-thead" style={{ gridTemplateColumns: TEMPLATE }}>
        {COLS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`${c.num ? 'kdb-num' : ''}${sort.key === c.key ? ' kdb-sorted' : ''}`}
            onClick={() => onSort(c.key)}
            title={`Sort by ${c.label}`}
          >
            {c.label}
            {sort.key === c.key && (sort.dir === 1 ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
          </button>
        ))}
      </div>
      <div className="kdb-tbody" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {rows.length ? (
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(first, last).map((r, i) => (
              <div
                key={r}
                className={`kdb-trow${(first + i) % 2 ? ' kdb-odd' : ''}${r === active ? ' kdb-active' : ''}`}
                style={{ top: (first + i) * ROW_H, height: ROW_H, gridTemplateColumns: TEMPLATE }}
                onClick={() => onRowClick(r)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onRowMenu(r, e)
                }}
                title="Click for all details of this entry; right-click to copy the reference"
              >
                <span>{db.element[r]}</span>
                <span>{db.line[r]}</span>
                <span className="kdb-num">{Number.isNaN(db.be[r]) ? '' : db.be[r].toFixed(2)}</span>
                <span>{db.formula[r]}</span>
                <span>{db.name[r]}</span>
                <span>{db.journal[r]}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="kdb-empty">No entries match. Try another line, or clear the Formula and Name boxes.</div>
        )}
      </div>
      <div className="kdb-tstatus">{status}</div>
    </div>
  )
}
