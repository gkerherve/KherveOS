// The peak table (the desktop's peak_params_grid): two rows per peak, the
// values and, tinted below them, the constraints ("Fixed", "1:1e7",
// "A+1.2#0.2", "B*0.5", "C1s_A*1"…). Double-click, Enter or just type to edit
// a cell; Enter keeps it, Escape cancels, Tab moves on. Python checks every
// edit as the desktop does and refuses what the desktop refuses.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ALL_MODELS, MODEL_GROUPS, PEAK_COLUMNS, isEditable } from './model'

export interface PeakTableProps {
  grid: string[][]
  selected: number | null
  onSelect: (peak: number | null) => void
  onEdit: (row: number, col: number, text: string) => void
  /** Columns to show (the desktop hides none; narrow windows can drop the background ones). */
  compact: boolean
}

const COMPACT_COLS = 14

export function PeakTable({ grid, selected, onSelect, onEdit, compact }: PeakTableProps) {
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ncols = compact ? COMPACT_COLS : PEAK_COLUMNS.length

  useEffect(() => {
    if (edit) inputRef.current?.focus()
  }, [edit])
  useEffect(() => {
    if (cell && cell.r >= grid.length) setCell(null)
  }, [grid, cell])

  const start = (r: number, c: number, text?: string) => {
    if (!isEditable(r, c) || c === 13) return
    setEdit({ r, c, text: text ?? grid[r]?.[c] ?? '' })
  }

  const commit = (move?: { dr: number; dc: number }) => {
    if (!edit) return
    const old = grid[edit.r]?.[edit.c] ?? ''
    if (edit.text !== old) onEdit(edit.r, edit.c, edit.text.trim())
    const next = move ? nextCell(edit.r, edit.c, move.dr, move.dc) : { r: edit.r, c: edit.c }
    setEdit(null)
    setCell(next)
    tableRef.current?.focus()
  }

  const nextCell = (r: number, c: number, dr: number, dc: number) => {
    let nr = Math.max(0, Math.min(grid.length - 1, r + dr))
    let nc = c + dc
    if (nc >= ncols) {
      nc = 1
      nr = Math.min(grid.length - 1, nr + 1)
    }
    if (nc < 0) nc = 0
    return { r: nr, c: nc }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit || !cell) return
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const n = nextCell(cell.r, cell.c, dr, dc)
      setCell(n)
      onSelect(Math.floor(n.r / 2))
    }
    if (e.key === 'ArrowDown') return move(1, 0)
    if (e.key === 'ArrowUp') return move(-1, 0)
    if (e.key === 'ArrowRight') return move(0, 1)
    if (e.key === 'ArrowLeft') return move(0, -1)
    if (e.key === 'Tab') return move(0, e.shiftKey ? -1 : 1)
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      start(cell.r, cell.c)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && cell.r % 2 === 1) {
      e.preventDefault()
      onEdit(cell.r, cell.c, '')
      return
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      start(cell.r, cell.c, e.key)
    }
  }

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit({ dr: 1, dc: 0 })
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit({ dr: 0, dc: e.shiftKey ? -1 : 1 })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEdit(null)
      tableRef.current?.focus()
    }
  }

  if (!grid.length) {
    return (
      <div className="kf-table kf-empty">
        No peaks yet. Make a background, then add peaks: <b>Add Peak</b> puts one where the data is highest above the fit, a double-click on the plot puts one there.
      </div>
    )
  }

  return (
    <div className="kf-table" ref={tableRef} tabIndex={0} onKeyDown={onKeyDown}>
      <table>
        <colgroup>
          {PEAK_COLUMNS.slice(0, ncols).map((col, i) => (
            <col key={i} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {PEAK_COLUMNS.slice(0, ncols).map((col, i) => (
              <th key={i} title={col.title}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => {
            const peak = Math.floor(r / 2)
            const cons = r % 2 === 1
            return (
              <tr key={r} className={`${cons ? 'kf-cons' : 'kf-vals'}${selected === peak ? ' kf-sel' : ''}`}>
                {row.slice(0, ncols).map((text, c) => {
                  const isCur = cell?.r === r && cell?.c === c
                  const editable = isEditable(r, c)
                  if (edit && edit.r === r && edit.c === c) {
                    return (
                      <td key={c} className="kf-editing">
                        <input
                          ref={inputRef}
                          className="kf-cell-input"
                          value={edit.text}
                          spellCheck={false}
                          onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                          onKeyDown={onInputKey}
                          onBlur={() => commit()}
                        />
                      </td>
                    )
                  }
                  if (c === 13 && !cons) {
                    return (
                      <td key={c} className={isCur ? 'kf-cur' : ''}>
                        <select
                          className="kf-cell-select"
                          value={text}
                          onChange={(e) => onEdit(r, 13, e.target.value)}
                          onFocus={() => {
                            setCell({ r, c })
                            onSelect(peak)
                          }}
                        >
                          {!ALL_MODELS.includes(text) && <option value={text}>{text}</option>}
                          {MODEL_GROUPS.map((g) => (
                            <optgroup key={g.name} label={g.name}>
                              {g.models.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                    )
                  }
                  return (
                    <td
                      key={c}
                      className={`${isCur ? 'kf-cur' : ''}${editable ? '' : ' kf-ro'}${c >= 10 && c <= 12 && !cons ? ' kf-calc' : ''}`}
                      title={cons && editable ? `${PEAK_COLUMNS[c].label} constraint` : undefined}
                      onMouseDown={() => {
                        setCell({ r, c })
                        onSelect(peak)
                      }}
                      onDoubleClick={() => start(r, c)}
                    >
                      {text}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
