// The desktop's toolbars, reduced to what the web edition does: Standard
// (files, undo, clipboard, charts, functions, Python, data tools) and Font
// (font, bold/italic/underline, alignment, colours, borders, merge, wrap,
// number format).

import { useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowDownZA, Baseline, Bold, ChartLine, ChevronDown, ClipboardPaste, Copy,
  DecimalsArrowLeft, DecimalsArrowRight, FilePlus, Filter, FolderOpen, Grid2x2, ImagePlus, Italic, PaintBucket, Percent, Play,
  Radical, Redo2, Save, Scissors, Sigma, SquareFunction, StickyNote, TableCellsMerge, Target, Terminal, Underline, Undo2, WrapText,
} from 'lucide-react'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { ColorPopover, FONTS, SIZES } from './dialogs'
import { functionMenu, insertFunction } from './FormulaBar'
import { NUMBER_FORMATS, a1, key, numberFormatLabel } from './model'
import { CHART_TYPES, insertChart } from './objects'
import { align, formatCells, quickSort, setBorders, setNumberFormat, stepDecimals, toggleFilter, toggleFlag, toggleMerge, type BorderKind } from './ops'

export interface ToolbarActions {
  newBook: () => void
  open: () => void
  save: () => void
  cut: () => void
  copy: () => void
  paste: () => void
  solver: () => void
  equation: () => void
  note: () => void
  image: () => void
}

/** Toolbar buttons keep the keyboard focus where it was (the grid or the editor). */
const keep = (e: { preventDefault: () => void }) => e.preventDefault()

function Btn({ title, onClick, children, on, disabled, label }: { title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; on?: boolean; disabled?: boolean; label?: string }) {
  return (
    <button className={`ks-tb${on ? ' on' : ''}${label ? ' wide' : ''}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onMouseDown={keep} onClick={onClick}>
      {children}
      {label && <span>{label}</span>}
    </button>
  )
}

function Split({ title, onClick, onMenu, children }: { title: string; onClick: () => void; onMenu: (r: DOMRect) => void; children: ReactNode }) {
  return (
    <span className="ks-split">
      <button className="ks-tb" title={title} aria-label={title} onMouseDown={keep} onClick={onClick}>
        {children}
      </button>
      <button className="ks-tb ks-tb-arrow" title={`${title} options`} aria-label={`${title} options`} onMouseDown={keep} onClick={(e) => onMenu(e.currentTarget.parentElement!.getBoundingClientRect())}>
        <ChevronDown size={11} />
      </button>
    </span>
  )
}

const Sep = () => <span className="ks-tb-sep" />

/** Excel's AutoSum: =SUM over the numbers just above (or left of) the active cell. */
export function autoSum(book: Book) {
  const sh = book.active
  const { r, c } = sh.sel.active
  const isNum = (rr: number, cc: number) => {
    const cell = sh.cells.get(key(rr, cc))
    return !!cell && cell.n !== null && !cell.s.startsWith('=SUM')
  }
  let top = r
  while (top > 0 && isNum(top - 1, c)) top--
  if (top < r) return book.startEdit(`=SUM(${a1(top, c)}:${a1(r - 1, c)})`)
  let left = c
  while (left > 0 && isNum(r, left - 1)) left--
  if (left < c) return book.startEdit(`=SUM(${a1(r, left)}:${a1(r, c - 1)})`)
  book.startEdit('=SUM(')
}

export function Toolbar({ book, root, actions }: { book: Book; root: HTMLElement | null; actions: ToolbarActions }) {
  const sel = useStore(book.store, (s) => s.sel)
  useStore(book.store, (s) => s.version)
  const canUndo = useStore(book.store, (s) => s.canUndo)
  const canRedo = useStore(book.store, (s) => s.canRedo)
  const pyPending = useStore(book.store, (s) => s.pyPending)
  const formatBar = useStore(book.store, (s) => s.view.formatBar)
  const active = useStore(book.store, (s) => s.active)
  const sh = book.sheet(active)
  const f = sh.formats.get(key(sel.active.r, sel.active.c)) ?? {}
  const [fill, setFill] = useState('#ffff00')
  const [ink, setInk] = useState('#ff0000')
  const [chartType, setChartType] = useState('Line')
  const [popover, setPopover] = useState<{ kind: 'fill' | 'ink'; at: DOMRect } | null>(null)
  const h = (f.alignment ?? 0) & 0x0f

  const menuAt = (r: DOMRect, items: MenuItem[]) => os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items)
  const borders = (r: DOMRect) => {
    const item = (label: string, kind: BorderKind): MenuItem => ({ label, onClick: () => setBorders(book, kind) })
    menuAt(r, [
      item('All Borders', 'all'), item('Outside Borders', 'outside'), item('Thick Box Border', 'thick'), item('Inside Borders', 'inside'), '-',
      item('Top Border', 'top'), item('Bottom Border', 'bottom'), item('Left Border', 'left'), item('Right Border', 'right'), '-',
      item('No Border', 'none'),
    ])
  }

  return (
    <div className="ks-toolbars" onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
      <div className="ks-toolbar">
        <Btn title="New (Ctrl+N)" onClick={actions.newBook}><FilePlus size={17} /></Btn>
        <Btn title="Open (Ctrl+O)" onClick={actions.open}><FolderOpen size={17} /></Btn>
        <Btn title="Save (Ctrl+S)" onClick={actions.save}><Save size={17} /></Btn>
        <Sep />
        <Btn title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void book.undo()}><Undo2 size={17} /></Btn>
        <Btn title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => void book.redo()}><Redo2 size={17} /></Btn>
        <Sep />
        <Btn title="Cut (Ctrl+X)" onClick={actions.cut}><Scissors size={16} /></Btn>
        <Btn title="Copy (Ctrl+C)" onClick={actions.copy}><Copy size={16} /></Btn>
        <Btn title="Paste (Ctrl+V)" onClick={actions.paste}><ClipboardPaste size={16} /></Btn>
        <Sep />
        <Btn title="AutoSum" onClick={() => autoSum(book)}><Sigma size={17} /></Btn>
        <Btn title="Insert a function" onClick={(e) => menuAt(e.currentTarget.getBoundingClientRect(), functionMenu(book, (fn) => insertFunction(book, fn)))}><SquareFunction size={17} /></Btn>
        <Btn title="Python cell (=PY)" onClick={() => {
          book.startEdit('=PY\n', 'bar')
          book.setEdit({ mode: 'edit' })
        }}><Terminal size={16} /></Btn>
        <Sep />
        <Split
          title={`Insert a ${chartType} chart of the selection`}
          onClick={() => insertChart(book, chartType)}
          onMenu={(r) => menuAt(r, CHART_TYPES.map((t) => ({ label: t, checked: t === chartType, onClick: () => {
            setChartType(t)
            insertChart(book, t)
          } })))}
        >
          <ChartLine size={17} />
        </Split>
        <Btn title="Equation" onClick={actions.equation}><Radical size={16} /></Btn>
        <Btn title="Picture" onClick={actions.image}><ImagePlus size={16} /></Btn>
        <Btn title="Note (Shift+F2)" onClick={actions.note}><StickyNote size={16} /></Btn>
        <Sep />
        <Btn title="Sort A → Z" onClick={() => quickSort(book, true)}><ArrowDownAZ size={17} /></Btn>
        <Btn title="Sort Z → A" onClick={() => quickSort(book, false)}><ArrowDownZA size={17} /></Btn>
        <Btn title="Filter" on={!!sh.filter} onClick={() => toggleFilter(book)}><Filter size={16} /></Btn>
        <Btn title="Solver" onClick={actions.solver}><Target size={17} /></Btn>
        <span className="ks-tb-space" />
        {pyPending > 0 && (
          <button className="ks-tb-run" title="Run this workbook's Python (=PY) cells" onMouseDown={keep} onClick={() => void book.trustPython()}>
            <Play size={14} /> Run {pyPending} Python cell{pyPending === 1 ? '' : 's'}
          </button>
        )}
      </div>
      {formatBar && (
        <div className="ks-toolbar">
          <select
            className="ks-tb-select font"
            title="Font"
            value={f.font_family ?? 'Default'}
            onChange={(e) => void formatCells(book, { font_family: e.target.value === 'Default' ? undefined : e.target.value }, 'Font')}
          >
            {FONTS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            className="ks-tb-select size"
            title="Font size (pt)"
            value={f.font_size ?? 9}
            onChange={(e) => void formatCells(book, { font_size: Number(e.target.value) === 9 ? undefined : Number(e.target.value) }, 'Font Size')}
          >
            {[...new Set([...SIZES, f.font_size ?? 9])].sort((a, b) => a - b).map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <Sep />
          <Btn title="Bold (Ctrl+B)" on={!!f.bold} onClick={() => toggleFlag(book, 'bold', 'Bold')}><Bold size={16} /></Btn>
          <Btn title="Italic (Ctrl+I)" on={!!f.italic} onClick={() => toggleFlag(book, 'italic', 'Italic')}><Italic size={16} /></Btn>
          <Btn title="Underline (Ctrl+U)" on={!!f.underline} onClick={() => toggleFlag(book, 'underline', 'Underline')}><Underline size={16} /></Btn>
          <Sep />
          <Btn title="Align left" on={h === 0x1} onClick={() => align(book, h === 0x1 ? null : 'left')}><AlignLeft size={16} /></Btn>
          <Btn title="Center" on={h === 0x4} onClick={() => align(book, h === 0x4 ? null : 'center')}><AlignCenter size={16} /></Btn>
          <Btn title="Align right" on={h === 0x2} onClick={() => align(book, h === 0x2 ? null : 'right')}><AlignRight size={16} /></Btn>
          <Sep />
          <Split title="Fill colour" onClick={() => void formatCells(book, { bg: fill }, 'Fill Colour')} onMenu={(r) => setPopover({ kind: 'fill', at: r })}>
            <span className="ks-colorbtn"><PaintBucket size={15} /><i style={{ background: fill }} /></span>
          </Split>
          <Split title="Font colour" onClick={() => void formatCells(book, { font_color: ink }, 'Font Colour')} onMenu={(r) => setPopover({ kind: 'ink', at: r })}>
            <span className="ks-colorbtn"><Baseline size={15} /><i style={{ background: ink }} /></span>
          </Split>
          <Btn title="Borders" onClick={(e) => borders(e.currentTarget.getBoundingClientRect())}><Grid2x2 size={16} /></Btn>
          <Btn title="Merge / unmerge cells" onClick={() => toggleMerge(book)}><TableCellsMerge size={16} /></Btn>
          <Btn title="Wrap text" on={!!f.wrap_text} onClick={() => toggleFlag(book, 'wrap_text', 'Wrap Text')}><WrapText size={16} /></Btn>
          <Sep />
          <select
            className="ks-tb-select numfmt"
            title="Number format"
            value={NUMBER_FORMATS.some((n) => n.fmt === (f.number_format ?? 'General')) ? (f.number_format ?? 'General') : '__other'}
            onChange={(e) => e.target.value !== '__other' && setNumberFormat(book, e.target.value)}
          >
            {NUMBER_FORMATS.map((n) => (
              <option key={n.fmt} value={n.fmt}>{n.label}</option>
            ))}
            {!NUMBER_FORMATS.some((n) => n.fmt === (f.number_format ?? 'General')) && <option value="__other">{numberFormatLabel(f.number_format)}</option>}
          </select>
          <Btn title="Percentage" on={f.number_format === 'Percentage'} onClick={() => setNumberFormat(book, f.number_format === 'Percentage' ? null : 'Percentage')}><Percent size={15} /></Btn>
          <Btn title="Fewer decimals" onClick={() => stepDecimals(book, -1)}><DecimalsArrowLeft size={16} /></Btn>
          <Btn title="More decimals" onClick={() => stepDecimals(book, 1)}><DecimalsArrowRight size={16} /></Btn>
        </div>
      )}
      {popover && root && (
        <ColorPopover
          root={root}
          at={popover.at}
          value={popover.kind === 'fill' ? fill : ink}
          allowNone
          noneLabel={popover.kind === 'fill' ? 'No fill' : 'Automatic'}
          onPick={(c) => {
            if (popover.kind === 'fill') {
              if (c) setFill(c)
              void formatCells(book, { bg: c ?? undefined }, 'Fill Colour')
            } else {
              if (c) setInk(c)
              void formatCells(book, { font_color: c ?? undefined }, 'Font Colour')
            }
            book.refocus()
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
