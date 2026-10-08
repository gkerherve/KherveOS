// The editable grid of kStats: cells are edited in place (committed on Enter or when you leave the
// cell), a column header has a name, an "ignore" check and a menu; pasting a block from a
// spreadsheet fills cells from where you paste. Only the rows in view are drawn.

import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, EyeOff } from 'lucide-react'
import { os } from '@/os'
import { toNumber, detectDelimiter } from '@/os/table'
import {
  addColumn, addRow, deleteColumn, deleteRows, pasteBlock, renameColumn, setCell, sortRows, type Data,
} from './data'

const ROW_H = 26

interface Props {
  data: Data
  commit(next: Data): void
  xCol: number
  yCol: number
}

function Cell({ value, r, c, bad, empty, onCommit, onPaste }: {
  value: string; r: number; c: number; bad: boolean; empty: boolean
  onCommit(v: string): void
  onPaste(e: ClipboardEvent<HTMLInputElement>): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const done = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.key === 'Enter') e.preventDefault()
      const dr = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1
      if (e.key !== 'Enter') e.preventDefault()
      done()
      const grid = (e.currentTarget.closest('.ks-grid') as HTMLElement | null)
      const next = grid?.querySelector<HTMLInputElement>(`input[data-r="${r + dr}"][data-c="${c}"]`)
      next?.focus()
      next?.select()
    } else if (e.key === 'Escape') {
      setDraft(null)
      e.currentTarget.blur()
    }
  }
  return (
    <input
      className={`ks-cell${bad ? ' bad' : ''}${empty ? ' empty' : ''}`}
      data-r={r}
      data-c={c}
      value={draft ?? value}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={onKey}
      onPaste={onPaste}
      title={bad ? 'This is not a number, so the analyses leave this row out.' : undefined}
    />
  )
}

export default function DataGrid({ data, commit, xCol, yCol }: Props) {
  const { table, ignored } = data
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 400 })

  // numeric columns: most of the filled cells are numbers
  const numeric = useMemo(
    () => table.headers.map((_, c) => {
      let filled = 0
      let nums = 0
      for (const r of table.rows) {
        if ((r[c] ?? '').trim() === '') continue
        filled++
        if (Number.isFinite(toNumber(r[c]))) nums++
      }
      return filled > 0 && nums / filled >= 0.5
    }),
    [table],
  )

  const total = table.rows.length
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 8)
  const last = Math.min(total, Math.ceil((scroll.top + scroll.height) / ROW_H) + 8)

  const paste = (r: number, c: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return // a single value: the normal paste
    e.preventDefault()
    const d = text.includes('\t') ? '\t' : detectDelimiter(text)
    const block = text.replace(/\r?\n$/, '').split(/\r?\n/).map((l) => l.split(d).map((v) => v.trim().replace(/^"|"$/g, '')))
    commit(pasteBlock(data, r, c, block))
  }

  const headerMenu = (e: MouseEvent, c: number) => {
    e.preventDefault()
    e.stopPropagation()
    const name = table.headers[c]
    os.contextMenu(e, [
      { label: 'Sort ascending', onClick: () => commit({ ...data, table: sortRows(table, c, true) }) },
      { label: 'Sort descending', onClick: () => commit({ ...data, table: sortRows(table, c, false) }) },
      '-',
      { label: ignored[c] ? 'Use in the analyses' : 'Ignore in the analyses', onClick: () => commit({ ...data, ignored: ignored.map((v, i) => (i === c ? !v : v)) }) },
      '-',
      { label: 'Insert column after', onClick: () => commit(insertColumnAfter(data, c)) },
      {
        label: `Delete column "${name}"`,
        danger: true,
        disabled: table.headers.length <= 1,
        onClick: () => commit(deleteColumn(data, c)),
      },
    ])
  }

  const rowMenu = (e: MouseEvent, r: number) => {
    e.preventDefault()
    os.contextMenu(e, [
      { label: 'Insert row above', onClick: () => commit(addRow(data, r)) },
      { label: 'Insert row below', onClick: () => commit(addRow(data, r + 1)) },
      '-',
      { label: 'Delete row', danger: true, onClick: () => commit(deleteRows(data, [r])) },
    ])
  }

  if (table.headers.length === 0) {
    return (
      <div className="ks-empty">
        <p>No data yet.</p>
        <button className="k-btn" onClick={() => commit(addColumn({ table: { headers: [], rows: [] }, ignored: [] }, 'x'))}>Start an empty table</button>
      </div>
    )
  }

  return (
    <div
      className="ks-grid"
      ref={box}
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
    >
      <table style={{ width: `${44 + table.headers.length * 120}px` }}>
        <thead>
          <tr>
            <th className="ks-rownum" />
            {table.headers.map((h, c) => (
              <th key={c} className={`${ignored[c] ? 'off' : ''}${c === xCol ? ' x' : ''}${c === yCol ? ' y' : ''}`} onContextMenu={(e) => headerMenu(e, c)}>
                <div className="ks-head">
                  <input
                    className="ks-headname"
                    defaultValue={h}
                    key={h}
                    spellCheck={false}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== h) commit(renameColumn(data, c, v))
                      else e.target.value = h
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    aria-label={`Name of column ${c + 1}`}
                  />
                  {ignored[c] && <EyeOff size={12} aria-label="ignored" />}
                  <button className="k-icon-btn ks-head-menu" onClick={(e) => headerMenu(e, c)} aria-label={`Column ${h} menu`}>
                    <ChevronDown size={13} />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 && <tr style={{ height: first * ROW_H }} aria-hidden />}
          {table.rows.slice(first, last).map((row, k) => {
            const r = first + k
            return (
              <tr key={r} style={{ height: ROW_H }}>
                <td className="ks-rownum" onContextMenu={(e) => rowMenu(e, r)}>{r + 1}</td>
                {table.headers.map((_, c) => {
                  const v = row[c] ?? ''
                  const filled = v.trim() !== ''
                  return (
                    <td key={c} className={ignored[c] ? 'off' : ''}>
                      <Cell
                        value={v}
                        r={r}
                        c={c}
                        bad={numeric[c] && filled && !Number.isFinite(toNumber(v))}
                        empty={numeric[c] && !filled}
                        onCommit={(nv) => commit(setCell(data, r, c, nv))}
                        onPaste={paste(r, c)}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {last < total && <tr style={{ height: (total - last) * ROW_H }} aria-hidden />}
        </tbody>
      </table>
    </div>
  )
}

function insertColumnAfter(data: Data, c: number): Data {
  const added = addColumn(data)
  const n = added.table.headers.length
  const order = [...Array.from({ length: c + 1 }, (_, i) => i), n - 1, ...Array.from({ length: n - c - 2 }, (_, i) => c + 1 + i)]
  return {
    table: { headers: order.map((i) => added.table.headers[i]), rows: added.table.rows.map((r) => order.map((i) => r[i])) },
    ignored: order.map((i) => added.ignored[i]),
  }
}
