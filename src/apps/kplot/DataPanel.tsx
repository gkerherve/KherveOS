// The data of kPlot: an editable grid (or the raw text), column and row tools, computed columns.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownAZ, FunctionSquare, MoreHorizontal, Plus, Rows3, Sigma, Table2, Text, Eraser } from 'lucide-react'
import { os } from '@/os'
import {
  addColumn, addRow, computeColumn, dropEmptyRows, parseTable, removeRow, renameColumn, setCell, sortByColumn, tableToText, type Table,
} from './data'
import { EXPR_FUNCTIONS } from './expr'

const ROW_H = 26
const OVERSCAN = 8

interface Props {
  table: Table
  xi: number
  onChange(t: Table, key?: string): void
  onRemoveColumn(i: number): void
  onSetX(i: number): void
  onStatus(message: string): void
}

export default function DataPanel({ table, xi, onChange, onRemoveColumn, onSetX, onStatus }: Props) {
  const [view, setView] = useState<'grid' | 'text'>('grid')
  const [draft, setDraft] = useState<string | null>(null)
  const [calc, setCalc] = useState<{ name: string; expr: string; error: string } | null>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 300 })
  const scroller = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setScroll((s) => (s.height === el.clientHeight ? s : { top: el.scrollTop, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])

  const rows = table.rows.length
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN)
  const last = Math.min(rows, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN)
  const text = useMemo(() => (view === 'text' ? tableToText(table) : ''), [view, table])

  const focusCell = (r: number, c: number) => {
    const el = scroller.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`)
    if (el) { el.focus(); el.select() } else if (scroller.current) {
      scroller.current.scrollTop = Math.max(0, r * ROW_H - scroll.height / 2)
      requestAnimationFrame(() => scroller.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`)?.focus())
    }
  }

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (r + 1 < rows) focusCell(r + 1, c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (r > 0) focusCell(r - 1, c) }
  }

  /** Pasting a block (from a spreadsheet) fills cells from the one pasted into, adding rows and columns. */
  const onCellPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const t = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const block = t.replace(/\r?\n$/, '').split(/\r?\n/).map((l) => l.split('\t'))
    let out: Table = { headers: [...table.headers], rows: table.rows.map((x) => [...x]) }
    const width = Math.max(...block.map((b) => b.length))
    while (out.headers.length < c + width) out = addColumn(out, `column ${out.headers.length + 1}`)
    while (out.rows.length < r + block.length) out = addRow(out)
    block.forEach((line, i) => line.forEach((v, j) => { out = setCell(out, r + i, c + j, v.trim()) }))
    onChange(out)
    onStatus(`Pasted ${block.length} × ${width} cells`)
  }

  const columnMenu = (e: React.MouseEvent, c: number) => {
    os.contextMenu(e, [
      { label: 'Use as x', checked: xi === c, onClick: () => onSetX(c) },
      '-',
      { label: 'Sort ascending', onClick: () => onChange(sortByColumn(table, c, false)) },
      { label: 'Sort descending', onClick: () => onChange(sortByColumn(table, c, true)) },
      '-',
      { label: 'Delete column', danger: true, disabled: table.headers.length <= 1, onClick: () => onRemoveColumn(c) },
    ])
  }

  const rowMenu = (e: React.MouseEvent, r: number) => {
    e.preventDefault()
    os.contextMenu(e, [
      { label: 'Insert row below', onClick: () => { const t = addRow(table); t.rows.splice(r + 1, 0, t.rows.pop()!); onChange(t) } },
      { label: 'Delete row', danger: true, onClick: () => onChange(removeRow(table, r)) },
    ])
  }

  const applyCalc = () => {
    if (!calc) return
    try {
      onChange(computeColumn(table, calc.name || 'computed', calc.expr, xi))
      setCalc(null)
    } catch (e) {
      setCalc({ ...calc, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const clean = () => {
    const t = dropEmptyRows(table)
    onStatus(t.rows.length === rows ? 'No empty rows' : `Dropped ${rows - t.rows.length} empty row${rows - t.rows.length === 1 ? '' : 's'}`)
    onChange(t)
  }

  return (
    <div className="kp-data">
      <div className="kp-datahead">
        <div className="kp-seg" role="group" aria-label="Data view">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => { setView('grid'); setDraft(null) }} title="Edit as a grid"><Table2 size={13} /> Grid</button>
          <button className={view === 'text' ? 'active' : ''} onClick={() => setView('text')} title="Edit as text (CSV, tab or semicolon)"><Text size={13} /> Text</button>
        </div>
        <span className="k-muted kp-count">{rows} × {table.headers.length}</span>
      </div>

      {view === 'grid' && (
        <div className="kp-datatools">
          <button className="k-icon-btn" title="Add a row" aria-label="Add a row" onClick={() => onChange(addRow(table))}><Rows3 size={14} /></button>
          <button className="k-icon-btn" title="Add an empty column" aria-label="Add a column" onClick={() => onChange(addColumn(table, `column ${table.headers.length + 1}`))}><Plus size={14} /></button>
          <button className="k-icon-btn" title="Computed column from an expression" aria-label="Computed column" onClick={() => setCalc(calc ? null : { name: '', expr: '', error: '' })}><FunctionSquare size={14} /></button>
          <button className="k-icon-btn" title="Sort by the x column" aria-label="Sort by x" onClick={() => { onChange(sortByColumn(table, xi)) }}><ArrowDownAZ size={14} /></button>
          <button className="k-icon-btn" title="Drop empty rows" aria-label="Drop empty rows" onClick={clean}><Eraser size={14} /></button>
        </div>
      )}

      {calc && view === 'grid' && (
        <div className="kp-calc">
          <input className="k-input kp-in" placeholder="New column name" value={calc.name} onChange={(e) => setCalc({ ...calc, name: e.target.value })} aria-label="New column name" />
          <input
            className="k-input kp-in"
            placeholder="expression, e.g. a*2+1 or log10([signal (V)])"
            value={calc.expr}
            autoFocus
            spellCheck={false}
            onChange={(e) => setCalc({ ...calc, expr: e.target.value, error: '' })}
            onKeyDown={(e) => e.key === 'Enter' && applyCalc()}
            aria-label="Expression"
          />
          <div className="kp-calc-row">
            <button className="k-btn" onClick={applyCalc} disabled={!calc.expr.trim()}><Sigma size={13} /> Add column</button>
            <button className="k-btn" onClick={() => setCalc(null)}>Cancel</button>
          </div>
          {calc.error && <div className="kp-error">{calc.error}</div>}
          <div className="k-muted kp-hint">
            Columns: their names (in [brackets] when they have spaces), c1, c2…; x (the x column), i (row number).
            Operators + − * / ^ %; functions {EXPR_FUNCTIONS.slice(0, 12).join(', ')}…; pi, e.
          </div>
        </div>
      )}

      {view === 'grid' ? (
        <div
          className="kp-grid"
          ref={scroller}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        >
          <table>
            <thead>
              <tr>
                <th className="kp-rn" />
                {table.headers.map((h, c) => (
                  <th key={c} className={c === xi ? 'kp-xcol' : ''}>
                    <div className="kp-th">
                      <input
                        className="kp-cell kp-hcell"
                        value={h}
                        aria-label={`Column ${c + 1} name`}
                        onChange={(e) => onChange({ headers: table.headers.map((x, k) => (k === c ? e.target.value : x)), rows: table.rows }, `h${c}`)}
                        onBlur={(e) => { if (!e.target.value.trim()) onChange(renameColumn(table, c, '')) }}
                      />
                      <button className="k-icon-btn kp-mini" aria-label={`Column ${c + 1} menu`} onClick={(e) => columnMenu(e, c)}><MoreHorizontal size={12} /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={table.headers.length + 1} /></tr>}
              {table.rows.slice(first, last).map((row, k) => {
                const r = first + k
                return (
                  <tr key={r} style={{ height: ROW_H }}>
                    <td className="kp-rn" onContextMenu={(e) => rowMenu(e, r)}>{r + 1}</td>
                    {row.map((v, c) => (
                      <td key={c} className={c === xi ? 'kp-xcol' : ''}>
                        <input
                          className="kp-cell"
                          data-cell={`${r}:${c}`}
                          value={v}
                          inputMode="decimal"
                          spellCheck={false}
                          onChange={(e) => onChange(setCell(table, r, c, e.target.value), `c${r}:${c}`)}
                          onKeyDown={(e) => onCellKey(e, r, c)}
                          onPaste={(e) => onCellPaste(e, r, c)}
                          onContextMenu={(e) => rowMenu(e, r)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
              {last < rows && <tr style={{ height: (rows - last) * ROW_H }}><td colSpan={table.headers.length + 1} /></tr>}
            </tbody>
          </table>
          {rows === 0 && <div className="k-muted kp-empty">No rows yet. Add one, paste a table, or open a file.</div>}
        </div>
      ) : (
        <textarea
          className="k-input kp-text"
          value={draft ?? text}
          spellCheck={false}
          aria-label="The data as text: one row per line, columns separated by commas, tabs or semicolons"
          onChange={(e) => { setDraft(e.target.value); onChange(parseTable(e.target.value), 'text') }}
          onBlur={() => setDraft(null)}
        />
      )}
    </div>
  )
}
