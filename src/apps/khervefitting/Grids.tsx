// The desktop's two wx.grid.Grid tables, drawn like them: the Peak Fitting
// Parameters grid (two rows per peak — values on white, constraints on the
// grid colour; 19 columns; Fitting Model and background columns hidden in the
// compact view) and the Results grid (31 columns + the 1σ columns, a tick box
// per row, Atomic %, Corr. Area and Weight % in bold on the grid colour).
// Row labels 1…n, two-line column labels, 25 px rows (create_peak_params_grid,
// create_results_grid, Grid_Operations.populate_results_grid).

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { GRID_MODELS, PEAK_COLUMNS, PEAK_EXTRA_COLUMNS, RESULT_COLUMNS, RESULT_EXTRA_COLUMNS, RESULT_KEY_COLUMNS, RESULT_ORDER, isEditable } from './model'

const COLOURS: Record<string, string> = { g: 'rgb(128, 128, 128)', w: 'rgb(255, 255, 255)', c: 'var(--kf-cons)', k: 'rgb(27, 140, 60)' }

function Head({ cols, widths }: { cols: { label: string }[]; widths: number[] }) {
  return (
    <thead>
      <tr>
        <th className="kf-corner" />
        {cols.map((c, i) => (
          <th key={i} style={{ width: widths[i], minWidth: widths[i], maxWidth: widths[i] }}>
            {c.label.trim()}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export interface PeakGridProps {
  grid: string[][]
  colours?: string[]
  selected: number | null
  compact: boolean
  onSelect: (peak: number | null) => void
  onEdit: (row: number, col: number, text: string) => void
  /** Tooltips of fitted values ("value ± uncertainty"). */
  tips?: (row: number, col: number) => string | undefined
}

export function PeakGrid({ grid, colours, selected, compact, onSelect, onEdit, tips }: PeakGridProps) {
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null)
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const cols = PEAK_COLUMNS.map((c, i) => ({ ...c, i })).filter((c) => !compact || !PEAK_EXTRA_COLUMNS.includes(c.i))

  useEffect(() => {
    if (edit) input.current?.focus()
  }, [edit])
  useEffect(() => {
    if (cell && cell.r >= grid.length) setCell(null)
  }, [grid, cell])

  const start = (r: number, c: number, text?: string) => {
    if (!isEditable(r, c) || c === 13) return
    setEdit({ r, c, text: text ?? grid[r]?.[c] ?? '' })
  }
  const visible = cols.map((c) => c.i)
  const move = (r: number, c: number, dr: number, dc: number) => {
    const k = visible.indexOf(c)
    let nk = k + dc
    let nr = r + dr
    if (nk >= visible.length) {
      nk = 1
      nr += 1
    }
    if (nk < 0) nk = 0
    nr = Math.max(0, Math.min(grid.length - 1, nr))
    return { r: nr, c: visible[nk] }
  }
  const commit = (dr = 0, dc = 0) => {
    if (!edit) return
    // On the desktop typing "f" in a constraint cell means "fixed" (update_constraint).
    let text = edit.text.trim()
    if (edit.r % 2 === 1 && text.toLowerCase() === 'f') text = 'fixed'
    if (text !== (grid[edit.r]?.[edit.c] ?? '')) onEdit(edit.r, edit.c, text)
    setCell(dr || dc ? move(edit.r, edit.c, dr, dc) : { r: edit.r, c: edit.c })
    setEdit(null)
    ref.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit || !cell) return
    const go = (dr: number, dc: number) => {
      e.preventDefault()
      const n = move(cell.r, cell.c, dr, dc)
      setCell(n)
      onSelect(Math.floor(n.r / 2))
    }
    if (e.key === 'ArrowDown') return go(1, 0)
    if (e.key === 'ArrowUp') return go(-1, 0)
    if (e.key === 'ArrowRight') return go(0, 1)
    if (e.key === 'ArrowLeft') return go(0, -1)
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      return start(cell.r, cell.c)
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && cell.r % 2 === 1 && isEditable(cell.r, cell.c)) {
      e.preventDefault()
      return onEdit(cell.r, cell.c, '')
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && isEditable(cell.r, cell.c)) {
      e.preventDefault()
      start(cell.r, cell.c, e.key)
    }
  }

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(1, 0)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit(0, e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEdit(null)
      ref.current?.focus()
    }
  }

  return (
    <div className="kf-grid" ref={ref} tabIndex={0} onKeyDown={onKeyDown}>
      <table>
        <Head cols={cols} widths={cols.map((c) => c.width)} />
        <tbody>
          {grid.map((row, r) => {
            const cons = r % 2 === 1
            const peak = Math.floor(r / 2)
            const sel = !cons && selected === peak
            return (
              <tr key={r} className={cons ? 'kf-cons' : ''}>
                <th className="kf-rowlabel" onMouseDown={() => onSelect(peak)}>
                  {r + 1}
                </th>
                {cols.map(({ i: c, width }) => {
                  const text = row[c] ?? ''
                  const code = colours?.[r]?.[c] ?? '.'
                  const style = { width, minWidth: width, maxWidth: width, color: sel ? undefined : COLOURS[code] }
                  const cur = cell?.r === r && cell?.c === c
                  if (edit && edit.r === r && edit.c === c) {
                    return (
                      <td key={c} style={style} className="kf-editing">
                        <input ref={input} value={edit.text} spellCheck={false} onChange={(e) => setEdit({ ...edit, text: e.target.value })} onKeyDown={onInputKey} onBlur={() => commit()} />
                      </td>
                    )
                  }
                  if (c === 13 && !cons && cur) {
                    return (
                      <td key={c} style={style} className="kf-editing">
                        <select
                          autoFocus
                          value={text}
                          onChange={(e) => onEdit(r, 13, e.target.value)}
                          onBlur={() => setCell(null)}
                          onKeyDown={(e) => e.key === 'Escape' && setCell(null)}
                        >
                          {!GRID_MODELS.includes(text) && <option value={text}>{text}</option>}
                          {GRID_MODELS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                    )
                  }
                  return (
                    <td
                      key={c}
                      style={style}
                      className={`${sel ? 'kf-selrow' : ''}${cur ? ' kf-cur' : ''}`}
                      title={tips?.(r, c)}
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

export interface ResultsGridProps {
  rows: { key: string; cells: string[]; checked: boolean }[]
  compact: boolean
  selectedRow: number | null
  onSelectRow: (row: number | null) => void
  onToggle: (key: string, checked: boolean) => void
  onSet: (key: string, field: 'rsf' | 'txfn' | 'name', value: string) => void
}

/** Results cells the user may change: the label, RSF and TXFN (setup_grid_editability). */
const RESULT_EDIT: Record<number, 'name' | 'rsf' | 'txfn'> = { 0: 'name', 8: 'rsf', 9: 'txfn' }

export function ResultsGrid({ rows, compact, selectedRow, onSelectRow, onToggle, onSet }: ResultsGridProps) {
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const cols = RESULT_ORDER.filter((c) => !compact || !RESULT_EXTRA_COLUMNS.includes(c)).map((i) => ({ ...RESULT_COLUMNS[i], i }))
  const commit = () => {
    if (!edit) return
    const row = rows[edit.r]
    const field = RESULT_EDIT[edit.c]
    const t = edit.text.trim()
    setEdit(null)
    if (!row || !field || t === row.cells[edit.c]) return
    if (field !== 'name' && !(Number.isFinite(Number(t)) && Number(t) > 0)) return
    onSet(row.key, field, t)
  }
  return (
    <div className="kf-grid">
      <table>
        <Head cols={cols} widths={cols.map((c) => c.width)} />
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key} className={selectedRow === r ? 'kf-rsel' : ''}>
              <th className="kf-rowlabel" onMouseDown={() => onSelectRow(r)}>
                {r + 1}
              </th>
              {cols.map(({ i: c, width }) => {
                const style = { width, minWidth: width, maxWidth: width }
                let content: ReactNode = row.cells[c] ?? ''
                if (c === 7) {
                  content = <input type="checkbox" className="kf-check" checked={row.checked} onChange={(e) => onToggle(row.key, e.target.checked)} />
                }
                if (edit && edit.r === r && edit.c === c) {
                  return (
                    <td key={c} style={style} className="kf-editing">
                      <input
                        autoFocus
                        value={edit.text}
                        onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commit()
                          if (e.key === 'Escape') setEdit(null)
                        }}
                      />
                    </td>
                  )
                }
                return (
                  <td
                    key={c}
                    style={style}
                    className={`${RESULT_KEY_COLUMNS.includes(c) ? 'kf-key' : ''}${c >= 31 ? ' kf-err' : ''}${c === 7 ? ' kf-center' : ''}`}
                    onMouseDown={() => onSelectRow(r)}
                    onDoubleClick={() => RESULT_EDIT[c] && setEdit({ r, c, text: row.cells[c] ?? '' })}
                  >
                    {content}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
