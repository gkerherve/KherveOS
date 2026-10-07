// Typing in a cell: a text box over the cell that grows with its text, with
// Excel's keys (Enter, Tab, arrows in "enter" mode, Alt+Enter for a new
// line, Ctrl+Enter to fill the selection), function autocomplete, and
// arrow-key pointing at cells while a formula expects a reference.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import type { Book } from './book'
import { AssistPopup, acceptFunction, assistFor, assistKey } from './Assist'
import { canInsertRef } from './formula'
import { a1, isPython, quoteSheet } from './model'

let measurer: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * 7
  measurer.font = font
  return Math.max(...text.split('\n').map((l) => measurer!.measureText(l).width))
}

/** Move the pointed reference (Excel's Point mode) and write it into the formula. */
export function pointAt(book: Book, r: number, c: number, r2?: number, c2?: number) {
  const e = book.state.edit
  if (!e) return
  const sh = book.active
  const own = e.sheet === sh.id
  const ref = (own ? '' : `${quoteSheet(sh.name)}!`) + (r2 !== undefined && c2 !== undefined && (r2 !== r || c2 !== c) ? `${a1(Math.min(r, r2), Math.min(c, c2))}:${a1(Math.max(r, r2), Math.max(c, c2))}` : a1(r, c))
  const start = e.point ? e.point.start : e.caret
  const end = e.point ? e.point.end : e.caret
  const text = e.text.slice(0, start) + ref + e.text.slice(end)
  book.setEdit({ text, caret: start + ref.length, point: { start, end: start + ref.length, r, c } })
}

/** May a click or an arrow insert a reference now? */
export function pointing(book: Book): boolean {
  const e = book.state.edit
  if (!e) return false
  return !!e.point || canInsertRef(e.text, e.caret)
}

export function CellEditor({
  book, rect, font, color, background, zoom,
}: {
  book: Book
  /** The cell's rectangle in sheet pixels. */
  rect: { left: number; top: number; width: number; height: number }
  font: string
  color: string
  background: string
  zoom: number
}) {
  const edit = useStore(book.store, (s) => s.edit)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [index, setIndex] = useState(0)
  const [closed, setClosed] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const text = edit?.text ?? ''
  const caret = edit?.caret ?? 0
  const py = isPython(text)

  // Focus follows the edit; the caret too when something else moved it
  // (the formula bar, a clicked reference), not after our own typing.
  const synced = useRef({ text: '', caret: -1 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !edit || edit.where !== 'cell') return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    if (synced.current.text === edit.text && synced.current.caret === edit.caret) return
    el.setSelectionRange(edit.caret, edit.caret)
    synced.current = { text: edit.text, caret: edit.caret }
  }, [edit])

  useEffect(() => {
    setIndex(0)
    setClosed(false)
  }, [text])

  useLayoutEffect(() => {
    if (ref.current) setAnchor(ref.current.getBoundingClientRect())
  }, [text, rect.left, rect.top, zoom])

  if (!edit) return null
  const assist = assistFor(book, text, caret)
  const shown = closed ? { ...assist, items: [] } : assist
  const lines = text.split('\n').length
  const lineH = Math.max(14, parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] ?? '12') * 1.25)
  const width = Math.max(rect.width, Math.min(900, textWidth(text, font) + 18))
  const height = Math.max(rect.height, lines * lineH + 6)

  const pick = (name: string) => {
    const next = acceptFunction(text, caret, assist.start, name)
    book.setEdit({ text: next.text, caret: next.caret, point: null })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (!closed && assistKey(e, shown, index, setIndex, pick)) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      if (shown.items.length) setClosed(true)
      else book.cancelEdit()
      return
    }
    if (e.key === 'Enter') {
      const newline = e.altKey || (py && !e.shiftKey && !mod)
      e.preventDefault()
      if (newline) {
        const el = e.currentTarget
        const s = el.selectionStart
        const t = text.slice(0, s) + '\n' + text.slice(el.selectionEnd)
        book.setEdit({ text: t, caret: s + 1, point: null })
        return
      }
      if (py) book.commitEdit(1, 0)
      else book.commitEdit(e.shiftKey ? -1 : 1, 0, mod)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      book.commitEdit(0, e.shiftKey ? -1 : 1)
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const d = arrows[e.key]
    if (d && edit.mode === 'enter' && !py) {
      e.preventDefault()
      if (pointing(book)) {
        const base = edit.point ?? { r: edit.r, c: edit.c }
        const sh = book.active
        pointAt(book, Math.max(0, Math.min(sh.rows - 1, base.r + d[0])), Math.max(0, Math.min(sh.cols - 1, base.c + d[1])))
      } else book.commitEdit(d[0], d[1])
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      book.setEdit({ mode: edit.mode === 'enter' ? 'edit' : 'enter' })
    }
  }

  return (
    <>
      <textarea
        ref={ref}
        className="ks-cell-editor"
        spellCheck={false}
        value={text}
        wrap="off"
        style={{ left: rect.left, top: rect.top, width, height, font, color, background, lineHeight: `${lineH}px` }}
        onChange={(e) => {
          synced.current = { text: e.target.value, caret: e.target.selectionStart }
          book.setEdit({ text: e.target.value, caret: e.target.selectionStart, point: null })
        }}
        onSelect={(e) => {
          const s = e.currentTarget.selectionStart
          synced.current = { text: e.currentTarget.value, caret: s }
          if (s !== caret) book.setEdit({ caret: s })
        }}
        onKeyDown={onKeyDown}
        onFocus={() => edit.where !== 'cell' && book.setEdit({ where: 'cell' })}
        onCopy={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        aria-label={`Edit ${a1(edit.r, edit.c)}`}
      />
      {edit.where === 'cell' && <AssistPopup anchor={anchor} state={shown} index={index} onPick={pick} />}
    </>
  )
}
