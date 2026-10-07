// The formula bar (the desktop's "Cell: [A1] fx [formula]"): the name box
// (type a cell or range and press Enter to go there), the function menu,
// and the cell's source, editable, with autocomplete and function help.
// Python (=PY) cells are edited here over several lines.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import { ChevronDown, ChevronUp, FunctionSquare, Terminal } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import type { Book } from './book'
import { AssistPopup, acceptFunction, assistFor, assistKey } from './Assist'
import { categoryLabel } from './formula'
import { a1, isPython, key, mergeAt, mergeRange, parseRange, rangeA1, sameRange, splitSheetRef } from './model'

/** The fx menu: functions by category, from core/catalog. */
export function functionMenu(book: Book, insert: (name: string) => void): MenuItem[] {
  const cat = book.catalog
  if (!cat) return [{ label: 'Python is starting…', disabled: true }]
  return cat.order.map((name) => ({
    label: categoryLabel(name),
    submenu: (cat.categories[name] ?? []).map((f) => ({ label: f, onClick: () => insert(f) })),
  }))
}

/** Insert "=NAME(" (or "NAME(" inside a formula) into the edit, starting one if needed. */
export function insertFunction(book: Book, name: string) {
  const e = book.state.edit
  if (!e) {
    book.startEdit(`=${name}(`, 'bar')
    book.setEdit({ mode: 'edit' })
    return
  }
  const t = e.text || '='
  const at = e.text ? e.caret : 1
  const text = t.slice(0, at) + `${name}(` + t.slice(at)
  book.setEdit({ text, caret: at + name.length + 1, point: null })
}

export function FormulaBar({ book, onPythonOutput }: { book: Book; onPythonOutput: () => void }) {
  const sel = useStore(book.store, (s) => s.sel)
  const edit = useStore(book.store, (s) => s.edit)
  useStore(book.store, (s) => s.version)
  const active = useStore(book.store, (s) => s.active)
  const sh = book.sheet(active)
  const cell = sh.cells.get(key(sel.active.r, sel.active.c))
  const source = edit ? edit.text : (cell?.s ?? '')
  const py = isPython(source)
  const [expanded, setExpanded] = useState(false)
  const [name, setName] = useState('')
  const [index, setIndex] = useState(0)
  const [closed, setClosed] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const g = sel.ranges[sel.ranges.length - 1]
  const m = mergeAt(sh.merges, sel.active.r, sel.active.c)
  const onlyMerge = !!m && sameRange(mergeRange(m), g)
  const where = sel.ranges.length === 1 && (g.r1 !== g.r2 || g.c1 !== g.c2) && !edit && !onlyMerge ? rangeA1(g) : a1(sel.active.r, sel.active.c)

  useEffect(() => setName(where), [where])
  useEffect(() => {
    setIndex(0)
    setClosed(false)
  }, [source])

  // Focus follows the edit; the caret too when something else moved it
  // (the cell editor, a clicked reference), not after our own typing.
  const synced = useRef({ text: '', caret: -1 })
  useLayoutEffect(() => {
    const el = input.current
    if (!el || !edit || edit.where !== 'bar') return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (synced.current.text === edit.text && synced.current.caret === edit.caret) return
    el.setSelectionRange(edit.caret, edit.caret)
    synced.current = { text: edit.text, caret: edit.caret }
  }, [edit])

  useLayoutEffect(() => {
    if (input.current) setAnchor(input.current.getBoundingClientRect())
  }, [source, expanded])

  const rows = py || expanded ? Math.min(14, Math.max(4, source.split('\n').length + 1)) : 1
  const caret = edit?.caret ?? 0
  const assist = edit && edit.where === 'bar' ? assistFor(book, source, caret) : { items: [], start: 0, help: null }
  const shown = closed ? { ...assist, items: [] } : assist
  const pick = (fn: string) => {
    const next = acceptFunction(source, caret, assist.start, fn)
    book.setEdit({ text: next.text, caret: next.caret, point: null })
  }

  const go = () => {
    const t = name.trim()
    const { sheet, cells } = splitSheetRef(t)
    if (sheet) {
      const target = book.byName(sheet)
      if (!target) return book.showFlash(`There is no sheet called "${sheet}".`)
      book.activate(target.id)
    }
    const s2 = book.active
    const r = parseRange(cells, s2.rows, s2.cols)
    if (!r) return book.showFlash(`"${t}" is not a cell or a range.`)
    book.select({ ranges: [r], active: { r: r.r1, c: r.c1 }, anchor: { r: r.r1, c: r.c1 } })
    book.refocus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!edit) return
    if (!closed && assistKey(e, shown, index, setIndex, pick)) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      if (shown.items.length) setClosed(true)
      else book.cancelEdit()
      return
    }
    if (e.key === 'Enter') {
      if (e.altKey || (py && !e.shiftKey && !mod)) return // a new line
      e.preventDefault()
      book.commitEdit(py ? 0 : e.shiftKey ? -1 : 1, 0, mod && !py)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      book.commitEdit(0, e.shiftKey ? -1 : 1)
    }
  }

  const output = sh.py.get(key(sel.active.r, sel.active.c))
  return (
    <div className="ks-fbar">
      <input
        className="ks-namebox"
        value={name}
        aria-label="Cell or range (type one and press Enter to go there)"
        title="Type a cell or range (B12, A1:C5, Sheet2!A1) and press Enter"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') go()
          if (e.key === 'Escape') {
            setName(where)
            book.refocus()
          }
        }}
        onBlur={() => setName(where)}
      />
      <button
        className="ks-fx"
        title="Insert a function"
        aria-label="Insert a function"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, functionMenu(book, (fn) => insertFunction(book, fn)))
        }}
      >
        <FunctionSquare size={16} />
      </button>
      <div className={`ks-fbar-input${py ? ' py' : ''}`}>
        {py && <span className="ks-py-badge">PY</span>}
        <textarea
          ref={input}
          value={source}
          rows={rows}
          spellCheck={false}
          wrap={py ? 'off' : 'soft'}
          aria-label="Formula bar"
          placeholder={edit ? '' : 'Value or =formula (e.g. =SUM(A1:A10)); =PY for Python'}
          onFocus={(e) => {
            const at = e.currentTarget.selectionStart
            synced.current = { text: e.currentTarget.value, caret: at }
            if (!book.state.edit) {
              book.startEdit(undefined, 'bar')
              book.setEdit({ mode: 'edit', caret: at })
            } else if (book.state.edit.where !== 'bar') book.setEdit({ where: 'bar' })
          }}
          onChange={(e) => {
            synced.current = { text: e.target.value, caret: e.target.selectionStart }
            if (!book.state.edit) {
              book.startEdit(e.target.value, 'bar')
              book.setEdit({ mode: 'edit', caret: e.target.selectionStart })
            } else book.setEdit({ text: e.target.value, caret: e.target.selectionStart, point: null })
          }}
          onSelect={(e) => {
            const at = e.currentTarget.selectionStart
            synced.current = { text: e.currentTarget.value, caret: at }
            if (edit && at !== edit.caret) book.setEdit({ caret: at })
          }}
          onKeyDown={onKeyDown}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
        />
        {edit && edit.where === 'bar' && <AssistPopup anchor={anchor} state={shown} index={index} onPick={pick} />}
      </div>
      {(output?.err || output?.out) && (
        <button className={`ks-fbar-btn${output.err ? ' err' : ''}`} title="Python output and errors" onMouseDown={(e) => e.preventDefault()} onClick={onPythonOutput}>
          <Terminal size={15} />
        </button>
      )}
      {!py && (
        <button className="ks-fbar-btn" title={expanded ? 'One line' : 'More lines'} onMouseDown={(e) => e.preventDefault()} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      )}
    </div>
  )
}
