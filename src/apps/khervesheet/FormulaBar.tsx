// The formula bar (the desktop's "Cell: [A1] fx [formula]" and the grip
// under it, sheet.py): the name box (type a cell or range and press Enter to
// go there), the function menu, and the cell's source, editable, with
// autocomplete and function help. The grip resizes the bar (double-click:
// one line). A =PY cell turns it into the desktop's Python editor: monospace,
// highlighted, Enter for a new line and Ctrl+Enter to run, the "PY" badge on
// the right and the loop period, Play/Stop and pop-out buttons beside it.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import type { MenuItem } from '@/os'
import type { Book } from './book'
import { AssistPopup, acceptFunction, assistFor, assistKey } from './Assist'
import { categoryLabel, toggleAbsoluteRef } from './formula'
import { pointAt, pointing } from './CellEditor'
import { Ico } from './icons'
import { a1, isPython, key, mergeAt, mergeRange, parseRange, rangeA1, sameRange, splitSheetRef, stripMarker } from './model'
import { Highlight, PyBadge, loopPeriodMenu } from './PyEditor'

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

export function FormulaBar({ book, onPopOut, onInsertFunction }: { book: Book; onPopOut: (code: string) => void; onInsertFunction: () => void }) {
  const sel = useStore(book.store, (s) => s.sel)
  const edit = useStore(book.store, (s) => s.edit)
  useStore(book.store, (s) => s.version)
  const active = useStore(book.store, (s) => s.active)
  const sh = book.sheet(active)
  const cell = sh.cells.get(key(sel.active.r, sel.active.c))
  const source = edit ? edit.text : (cell?.s ?? '')
  // Python mode: a =PY cell, or after a bare "=PY" (the desktop's set_python_mode).
  const py = isPython(source) && (!edit || !!edit.python)
  /** The bar's height set with the grip (null: one line, or 96 px for Python). */
  const [barMax, setBarMax] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [index, setIndex] = useState(0)
  const [closed, setClosed] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const hl = useRef<HTMLPreElement>(null)
  const grip = useRef<{ y: number; h: number } | null>(null)
  const g = sel.ranges[sel.ranges.length - 1]
  const m = mergeAt(sh.merges, sel.active.r, sel.active.c)
  const onlyMerge = !!m && sameRange(mergeRange(m), g)
  const where = sel.ranges.length === 1 && (g.r1 !== g.r2 || g.c1 !== g.c2) && !edit && !onlyMerge ? rangeA1(g) : a1(sel.active.r, sel.active.c)
  const loop = book.loopOf(sh, sel.active.r, sel.active.c)
  const storedPy = isPython(cell?.s ?? '')

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
  }, [source, barMax, py])

  // Desktop heights: one line (22 px) or the grip's; Python at least 72, 96 by default.
  const height = py ? Math.max(72, barMax ?? 96) : Math.max(24, barMax ?? 24)
  const caret = edit?.caret ?? 0
  const assist = edit && edit.where === 'bar' && !py ? assistFor(book, source, caret) : { items: [], start: 0, help: null }
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
      // Enter applies; Alt+Enter a new line. In Python mode Enter is a new
      // line and Ctrl+Enter runs (_FormulaEdit). A bare "=PY" switches the
      // bar to Python mode instead of being kept.
      if (py ? !mod : e.altKey) return // a new line
      e.preventDefault()
      if (!py && isPython(source) && !source.trim().slice(3).trim()) {
        book.setEdit({ text: '=PY\n', caret: 4, python: true, point: null })
        return
      }
      book.commitEdit(py ? 0 : e.shiftKey ? -1 : 1, 0, mod && !py)
      return
    }
    if (e.key === 'F4' && !py) {
      e.preventDefault()
      const next = toggleAbsoluteRef(source, e.currentTarget.selectionStart)
      if (next) book.setEdit({ text: next.text, caret: next.caret, point: null })
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const d = arrows[e.key]
    if (d && !py && !mod && !e.altKey && edit.mode === 'enter' && pointing(book)) {
      // Arrow keys point at cells while the formula expects a reference.
      e.preventDefault()
      const base = edit.point ?? { r: edit.r, c: edit.c }
      const sh2 = book.active
      pointAt(book, Math.max(0, Math.min(sh2.rows - 1, base.r + d[0])), Math.max(0, Math.min(sh2.cols - 1, base.c + d[1])))
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (py && !e.shiftKey) {
        // Indent the code instead of leaving the cell.
        const el = e.currentTarget
        const s = el.selectionStart
        const t = source.slice(0, s) + '    ' + source.slice(el.selectionEnd)
        // (the focus effect puts the caret after the indent)
        book.setEdit({ text: t, caret: s + 4, point: null })
        return
      }
      book.commitEdit(0, e.shiftKey ? -1 : 1)
    }
  }

  const popOut = () => {
    const e = book.state.edit
    const text = e ? e.text : (cell?.s ?? '')
    const code = isPython(text) ? stripMarker(text) : isPython(cell?.s ?? '') ? stripMarker(cell!.s) : ''
    if (e) book.cancelEdit()
    onPopOut(code)
  }
  const btnAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { clientX: r.left, clientY: r.bottom }
  }
  const syncScroll = () => {
    const el = input.current
    if (el && hl.current) hl.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`
  }
  useLayoutEffect(syncScroll, [source, py])

  return (
    <>
      <div className={`ks-fbar${py ? ' py' : ''}`}>
        <span className="ks-cell-label">Cell:</span>
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
          title="Insert Function (Shift+F3)"
          aria-label="Insert Function"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onInsertFunction}
        >
          fx
        </button>
        <div className={`ks-fbar-input${py ? ' py' : ''}`} style={{ height }}>
          {py && <Highlight code={source} innerRef={hl} className="ks-fbar-hl" />}
          <textarea
            ref={input}
            value={source}
            spellCheck={false}
            wrap="off"
            aria-label="Formula bar"
            title={py ? 'Python cell: Enter for a new line, Ctrl+Enter (⌘Enter) to run it' : undefined}
            placeholder={edit ? '' : 'Value or =formula  (e.g. =SUM(A1:A10), =B1+C1)'}
            onScroll={syncScroll}
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
          {py && (
            <>
              <div className="ks-py-btns" onMouseDown={(e) => e.preventDefault()}>
                <button
                  className="ks-py-btn"
                  title="Set loop period (auto-refresh interval)"
                  aria-label="Set loop period"
                  onClick={(e) => storedPy && loopPeriodMenu(book, sh.id, sel.active.r, sel.active.c, btnAt(e.currentTarget))}
                >
                  <Ico name="py_timer" size={22} />
                </button>
                {loop ? (
                  <button className="ks-py-btn" title="Stop loop" aria-label="Stop loop" onClick={() => book.setPyLoop(sh, sel.active.r, sel.active.c, null)}>
                    <Ico name="py_stop" size={22} />
                  </button>
                ) : (
                  <button
                    className="ks-py-btn"
                    title="Start loop"
                    aria-label="Start loop"
                    onClick={() => storedPy && book.setPyLoop(sh, sel.active.r, sel.active.c, book.savedLoop(sh, sel.active.r, sel.active.c) ?? 1)}
                  >
                    <Ico name="py_play" size={22} />
                  </button>
                )}
                <button className="ks-py-btn" title="Open Python in a larger editor" aria-label="Open Python in a larger editor" onClick={popOut}>
                  <Ico name="py_open_in_new" size={22} />
                </button>
              </div>
              <PyBadge loop={loop} className="ks-fbar-badge" />
            </>
          )}
          {edit && edit.where === 'bar' && <AssistPopup anchor={anchor} state={shown} index={index} onPick={pick} />}
        </div>
      </div>
      <div
        className="ks-fbar-grip"
        title="Drag to resize the formula bar (double-click: one line)"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          grip.current = { y: e.clientY, h: height }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = grip.current
          if (d) setBarMax(Math.max(24, Math.min(600, d.h + e.clientY - d.y)))
        }}
        onPointerUp={() => {
          grip.current = null
        }}
        onDoubleClick={() => setBarMax(null)}
      />
    </>
  )
}
