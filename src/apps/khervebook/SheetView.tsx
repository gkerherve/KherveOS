// A sheet cell: the embedded workbook (desktop sheetcell.py). A "View"
// drop-down picks a sheet or a plot; a formula bar shows the raw text of the
// current grid cell ("value or =formula"); the grid shows computed values.
// Edits are undo steps of the notebook, and Python recomputes the formulas.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { MenuItem } from '@/os'
import { figureUrl } from '@/os/python/kernel'
import type { SheetResult } from './format'
import type { Notebook } from './notebook'
import { activeIndex, colLetter, copyBlock, isFormula, parseWorkbook, pasteBlock, ref, setCells, type Workbook } from './sheet'

const ROW_H = 24
const COL_W = 84
const MAX_H = 300 // a tall grid scrolls inside itself past this (desktop TABLE_MAX_H)

type View = { kind: 'sheet'; i: number } | { kind: 'plot'; j: number }
interface Sel {
  r: number
  c: number
  r2: number
  c2: number
}

const norm = (s: Sel) => ({ r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) })

interface SheetViewProps {
  nb: Notebook
  id: string
  source: string
  result: SheetResult | null
  /** The grid's height from the resize grip (null: fit, up to 300 px). */
  height: number | null
  /** Open the cell's right-click menu with these sheet items added. */
  onMenu: (e: MouseEvent, extra: MenuItem[]) => void
}

export const SheetView = memo(function SheetView({ nb, id, source, result, height, onMenu }: SheetViewProps) {
  const book = useMemo(() => parseWorkbook(source), [source])
  const [view, setView] = useState<View>(() => ({ kind: 'sheet', i: activeIndex(book) }))
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0, r2: 0, c2: 0 })
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const [bar, setBar] = useState<string | null>(null)
  const [scroll, setScroll] = useState({ top: 0, h: MAX_H })
  const gridRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  /** The edit in progress, read by blur handlers that may run after it ended. */
  const editRef = useRef(edit)
  editRef.current = edit
  const startEdit = (r: number, c: number, text: string) => {
    editRef.current = { r, c, text }
    setEdit({ r, c, text })
  }
  const cancelEdit = () => {
    editRef.current = null
    setEdit(null)
    gridRef.current?.focus()
  }

  const staticPlots = book.plots
  const formulaPlots = result?.plots ?? []
  // Keep the view valid when sheets or plots go away (undo, recompute).
  const sheetIndex = view.kind === 'sheet' ? Math.min(view.i, book.sheets.length - 1) : 0
  const plotCount = staticPlots.length + formulaPlots.length
  const shownView: View = view.kind === 'plot' && view.j >= plotCount ? { kind: 'sheet', i: activeIndex(book) } : view.kind === 'sheet' ? { kind: 'sheet', i: sheetIndex } : view
  const sheet = book.sheets[sheetIndex]
  const display = result?.display[sheetIndex] ?? {}
  const hasFormulas = useMemo(() => book.sheets.some((s) => Object.values(s.data).some(isFormula)), [book])

  const raw = (r: number, c: number) => sheet.data[ref(r, c)] ?? ''
  const shown = (r: number, c: number) => {
    const v = raw(r, c)
    return v && isFormula(v) ? (display[ref(r, c)] ?? v) : v
  }

  const commit = (edits: { r: number; c: number; raw: string }[]) => {
    const name = sheet.name
    nb.editSheet(id, (b: Workbook) => ({ ...setCells(b, sheetIndex, edits), active: name }))
  }

  const contentH = ROW_H * (sheet.rows + 1) + 2
  const gridH = height ?? Math.min(contentH, MAX_H)

  // Rows on screen (plus a margin): big sheets render only what is visible.
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 8)
  const last = Math.min(sheet.rows - 1, Math.ceil((scroll.top + scroll.h) / ROW_H) + 8)

  useLayoutEffect(() => {
    const el = gridRef.current
    if (el) setScroll({ top: el.scrollTop, h: el.clientHeight })
  }, [gridH, sheetIndex])

  /** Keep the current cell on screen. */
  const reveal = (r: number, c: number) => {
    const el = gridRef.current
    if (!el) return
    const top = (r + 1) * ROW_H
    if (top - ROW_H < el.scrollTop) el.scrollTop = Math.max(0, top - ROW_H)
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
    const left = 34 + c * COL_W
    if (left < el.scrollLeft + 34) el.scrollLeft = Math.max(0, left - 34)
    else if (left + COL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = left + COL_W - el.clientWidth
  }

  const moveTo = (r: number, c: number, extend = false) => {
    const rr = Math.max(0, Math.min(sheet.rows - 1, r))
    const cc = Math.max(0, Math.min(sheet.cols - 1, c))
    setSel((s) => (extend ? { ...s, r2: rr, c2: cc } : { r: rr, c: cc, r2: rr, c2: cc }))
    setBar(null)
    reveal(rr, cc)
  }

  const finishEdit = (move: 'down' | 'right' | 'left' | 'none') => {
    const cur = editRef.current
    if (!cur) return
    const { r, c, text } = cur
    editRef.current = null
    setEdit(null)
    if (text !== raw(r, c)) commit([{ r, c, raw: text }])
    gridRef.current?.focus()
    if (move === 'down') moveTo(r + 1, c)
    else if (move === 'right') moveTo(r, c + 1)
    else if (move === 'left') moveTo(r, c - 1)
  }

  const clearSelection = () => {
    const { r1, r2, c1, c2 } = norm(sel)
    const edits: { r: number; c: number; raw: string }[] = []
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (raw(r, c)) edits.push({ r, c, raw: '' })
    if (edits.length) commit(edits)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (edit || e.target !== gridRef.current) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    let handled = true
    if (k === 'ArrowUp') moveTo((e.shiftKey ? sel.r2 : sel.r) - 1, e.shiftKey ? sel.c2 : sel.c, e.shiftKey)
    else if (k === 'ArrowDown') moveTo((e.shiftKey ? sel.r2 : sel.r) + 1, e.shiftKey ? sel.c2 : sel.c, e.shiftKey)
    else if (k === 'ArrowLeft') moveTo(e.shiftKey ? sel.r2 : sel.r, (e.shiftKey ? sel.c2 : sel.c) - 1, e.shiftKey)
    else if (k === 'ArrowRight') moveTo(e.shiftKey ? sel.r2 : sel.r, (e.shiftKey ? sel.c2 : sel.c) + 1, e.shiftKey)
    else if (k === 'Tab') moveTo(sel.r, sel.c + (e.shiftKey ? -1 : 1))
    else if (k === 'Enter' && mod && e.shiftKey) handled = false // Run All, at the notebook
    else if (k === 'Enter' && (e.shiftKey || mod)) nb.run(id, e.shiftKey ? 'advance' : 'stay') // recompute, like any cell
    else if (k === 'Enter') startEdit(sel.r, sel.c, raw(sel.r, sel.c))
    else if (k === 'F2') startEdit(sel.r, sel.c, raw(sel.r, sel.c))
    else if (k === 'Delete' || k === 'Backspace') clearSelection()
    else if (k === 'Escape') nb.focus(id, 'command')
    else if (k.length === 1 && !mod && !e.altKey) startEdit(sel.r, sel.c, k)
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const selectedText = () => {
    const { r1, r2, c1, c2 } = norm(sel)
    return copyBlock(shown, r1, c1, r2, c2)
  }
  const onCopy = (e: ClipboardEvent) => {
    if (edit) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', selectedText())
  }
  const onCut = (e: ClipboardEvent) => {
    if (edit) return
    onCopy(e)
    clearSelection()
  }
  const onPaste = (e: ClipboardEvent) => {
    if (edit) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const { r1, c1 } = norm(sel)
    const name = sheet.name
    nb.editSheet(id, (b) => ({ ...pasteBlock(b, sheetIndex, r1, c1, text), active: name }))
  }

  // Stop a drag-select when the mouse is released anywhere.
  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const plotItems = (kind: 'line' | 'bar' | 'scatter') => () => {
    const n = norm(sel)
    const single = n.r1 === n.r2 && n.c1 === n.c2
    const range = single ? { r1: 0, r2: sheet.rows - 1, c1: 0, c2: sheet.cols - 1 } : n
    nb.createPlot(id, sheetIndex, range, kind)
  }

  const contextMenu = (e: MouseEvent) => {
    const { r1, r2, c1, c2 } = norm(sel)
    const hasSel = r1 !== r2 || c1 !== c2
    const views: MenuItem[] = [
      ...book.sheets.map((s, i): MenuItem => ({ label: s.name, checked: shownView.kind === 'sheet' && shownView.i === i, onClick: () => setView({ kind: 'sheet', i }) })),
      ...[...staticPlots.map((p) => p.title), ...formulaPlots.map((_p, k) => `Plot ${k + 1}`)].map(
        (t, j): MenuItem => ({ label: t, checked: shownView.kind === 'plot' && shownView.j === j, onClick: () => setView({ kind: 'plot', j }) }),
      ),
      '-',
      { label: 'Add Sheet', onClick: () => addSheet() },
    ]
    onMenu(e, [
      { label: 'View', submenu: views },
      {
        label: hasSel ? 'Create Plot from Selection' : 'Create Plot',
        submenu: [
          { label: 'Line', onClick: plotItems('line') },
          { label: 'Bar', onClick: plotItems('bar') },
          { label: 'Scatter', onClick: plotItems('scatter') },
        ],
      },
    ])
  }

  const addSheet = () => {
    const n = book.sheets.length
    nb.editSheet(id, (b) => {
      let k = b.sheets.length + 1
      while (b.sheets.some((s) => s.name === `Sheet${k}`)) k++
      const name = `Sheet${k}`
      return { ...b, sheets: [...b.sheets, { name, rows: 6, cols: 4, data: {} }], active: name }
    })
    setView({ kind: 'sheet', i: n })
  }

  // Toolbar row 2 (add/delete rows and columns) acts on the current cell.
  useEffect(() => nb.registerSheet(id, { sheetIndex, row: sel.r, col: sel.c, addSheet }), [nb, id, sheetIndex, sel.r, sel.c, book])
  useEffect(() => () => nb.registerSheet(id, null), [nb, id])

  const viewValue = shownView.kind === 'sheet' ? `s${shownView.i}` : `p${shownView.j}`
  const curRaw = raw(sel.r, sel.c)
  const nr = norm(sel)
  const rows: number[] = []
  for (let r = first; r <= last; r++) rows.push(r)
  const cols = Array.from({ length: sheet.cols }, (_, c) => c)

  return (
    <div
      className="nb-workbook"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        contextMenu(e)
      }}
    >
      <div className="nb-sheet-head">
        <span className="nb-sheet-view-label">View:</span>
        <select
          className="k-input nb-sheet-view"
          value={viewValue}
          title="Choose which sheet or plot to show"
          onChange={(e) => {
            const v = e.target.value
            setView(v.startsWith('s') ? { kind: 'sheet', i: Number(v.slice(1)) } : { kind: 'plot', j: Number(v.slice(1)) })
            setEdit(null)
          }}
        >
          {book.sheets.map((s, i) => (
            <option key={`s${i}`} value={`s${i}`}>
              {s.name}
            </option>
          ))}
          {staticPlots.map((p, j) => (
            <option key={`p${j}`} value={`p${j}`}>
              {p.title}
            </option>
          ))}
          {formulaPlots.map((_p, k) => (
            <option key={`f${k}`} value={`p${staticPlots.length + k}`}>
              Plot {k + 1}
            </option>
          ))}
        </select>
        {!result && hasFormulas && <span className="nb-sheet-hint">Run the cell (▶) to compute the =formulas with Python</span>}
      </div>

      {shownView.kind === 'plot' ? (
        <div className="nb-sheet-plot">
          <img
            src={figureUrl(shownView.j < staticPlots.length ? staticPlots[shownView.j].png : formulaPlots[shownView.j - staticPlots.length])}
            alt="Plot"
            draggable={false}
          />
        </div>
      ) : (
        <>
          <div className="nb-sheet-bar">
            <span className="nb-sheet-ref">{ref(sel.r, sel.c)}</span>
            <input
              className="nb-sheet-formula"
              spellCheck={false}
              value={bar ?? curRaw}
              placeholder="value or =formula  (Python; A1 refs, A1:B5 ranges)"
              onChange={(e) => setBar(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (bar !== null && bar !== curRaw) commit([{ r: sel.r, c: sel.c, raw: bar }])
                  setBar(null)
                  gridRef.current?.focus()
                } else if (e.key === 'Escape') {
                  setBar(null)
                  gridRef.current?.focus()
                }
              }}
              onBlur={() => {
                if (bar !== null && bar !== curRaw) commit([{ r: sel.r, c: sel.c, raw: bar }])
                setBar(null)
              }}
            />
          </div>
          <div
            ref={gridRef}
            className="nb-grid"
            tabIndex={0}
            style={{ height: gridH }}
            onKeyDown={onKeyDown}
            onCopy={onCopy}
            onCut={onCut}
            onPaste={onPaste}
            onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}
          >
            <table style={{ width: 34 + sheet.cols * COL_W }}>
              <colgroup>
                <col style={{ width: 34 }} />
                {cols.map((c) => (
                  <col key={c} style={{ width: COL_W }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="nb-grid-corner" />
                  {cols.map((c) => (
                    <th key={c} className={c >= nr.c1 && c <= nr.c2 ? 'on' : undefined}>
                      {colLetter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {first > 0 && <tr style={{ height: first * ROW_H }} aria-hidden />}
                {rows.map((r) => (
                  <tr key={r}>
                    <th className={r >= nr.r1 && r <= nr.r2 ? 'on' : undefined}>{r + 1}</th>
                    {cols.map((c) => {
                      const k = ref(r, c)
                      const v = sheet.data[k]
                      const formula = !!v && isFormula(v)
                      const text = formula ? (display[k] ?? v) : (v ?? '')
                      const isSel = r >= nr.r1 && r <= nr.r2 && c >= nr.c1 && c <= nr.c2
                      const cls = [
                        isSel ? 'sel' : '',
                        r === sel.r && c === sel.c ? 'cur' : '',
                        formula && display[k] === undefined ? 'pending' : '',
                        formula && text.startsWith('#ERR') ? 'err' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      if (edit && edit.r === r && edit.c === c) {
                        return (
                          <td key={c} className="editing">
                            <input
                              className="nb-grid-input"
                              autoFocus
                              spellCheck={false}
                              value={edit.text}
                              onChange={(e) => {
                                const next = { ...edit, text: e.target.value }
                                editRef.current = next
                                setEdit(next)
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  finishEdit('down')
                                } else if (e.key === 'Tab') {
                                  e.preventDefault()
                                  finishEdit(e.shiftKey ? 'left' : 'right')
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  cancelEdit()
                                }
                              }}
                              onBlur={() => finishEdit('none')}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={c}
                          className={cls || undefined}
                          title={formula ? v : undefined}
                          onMouseDown={(e) => {
                            if (e.button !== 0) {
                              if (!isSel) moveTo(r, c)
                              return
                            }
                            dragging.current = true
                            moveTo(r, c, e.shiftKey)
                          }}
                          onMouseEnter={() => dragging.current && moveTo(r, c, true)}
                          onDoubleClick={() => startEdit(r, c, raw(r, c))}
                        >
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {last < sheet.rows - 1 && <tr style={{ height: (sheet.rows - 1 - last) * ROW_H }} aria-hidden />}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
})
