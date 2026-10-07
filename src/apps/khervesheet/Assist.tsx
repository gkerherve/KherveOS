// Formula help while typing, shared by the in-cell editor and the formula
// bar: matching functions from core/catalog (Tab or Enter picks one) and
// the syntax and description of the function the caret is in.

import { createContext, useContext, useMemo, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Book } from './book'
import { callAt, helpOf, matchFunctions, wordBefore } from './formula'

/** The app's root element: popups are drawn inside it (scoped styles). */
export const RootContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

export interface AssistState {
  /** Matching function names (empty: none to show). */
  items: string[]
  /** Where the word being completed starts. */
  start: number
  help: { name: string; syntax: string; text: string; arg: number } | null
}

export function assistFor(book: Book, text: string, caret: number): AssistState {
  const w = wordBefore(text, caret)
  const items = w && w.word.length >= 1 ? matchFunctions(book.functions, w.word) : []
  const exact = items.length === 1 && w && items[0] === w.word.toUpperCase()
  const call = callAt(text, caret)
  const h = call ? helpOf(book.catalog, call.name) : null
  return {
    items: exact ? [] : items,
    start: w?.start ?? caret,
    help: call && h ? { name: call.name, syntax: h.syntax, text: h.text, arg: call.arg } : null,
  }
}

/** Replace the word being typed by a function name and its "(". */
export function acceptFunction(text: string, caret: number, start: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret)
  const open = after.startsWith('(') ? '' : '('
  const next = text.slice(0, start) + name + open + after
  return { text: next, caret: start + name.length + 1 }
}

/** Bold the argument the caret is in: "SUM(number1, **number2**, ...)". */
function Syntax({ syntax, arg }: { syntax: string; arg: number }) {
  const m = /^([^(]*\()(.*)(\).*)$/.exec(syntax)
  if (!m) return <code>{syntax}</code>
  const args = m[2].split(',')
  return (
    <code>
      {m[1]}
      {args.map((a, i) => (
        <span key={i}>
          {i > 0 && ','}
          {i === Math.min(arg, args.length - 1) ? <b>{a}</b> : a}
        </span>
      ))}
      {m[3]}
    </code>
  )
}

export function AssistPopup({
  anchor, state, index, onPick,
}: {
  /** The input's rectangle (client coordinates). */
  anchor: DOMRect | null
  state: AssistState
  index: number
  onPick: (name: string) => void
}) {
  const root = useContext(RootContext)
  const box = root?.current?.getBoundingClientRect()
  const pos = useMemo(() => {
    if (!anchor || !box) return null
    return { left: Math.max(4, anchor.left - box.left), top: anchor.bottom - box.top + 2 }
  }, [anchor, box])
  if (!root?.current || !pos || (!state.items.length && !state.help)) return null
  return createPortal(
    <div className="ks-assist" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      {state.items.length > 0 && (
        <ul className="ks-assist-list" role="listbox">
          {state.items.map((name, i) => (
            <li key={name} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => onPick(name)}>
              {name}
            </li>
          ))}
        </ul>
      )}
      {state.items.length > 0 ? (
        <AssistHelp name={state.items[Math.min(index, state.items.length - 1)]} />
      ) : (
        state.help && (
          <div className="ks-assist-help">
            <Syntax syntax={state.help.syntax} arg={state.help.arg} />
            {state.help.text && <p>{state.help.text}</p>}
          </div>
        )
      )}
    </div>,
    root.current,
  )
}

function AssistHelp({ name }: { name: string }) {
  const root = useContext(BookContext)
  const h = root ? helpOf(root.catalog, name) : null
  if (!h) return null
  return (
    <div className="ks-assist-help">
      <code>{h.syntax}</code>
      {h.text && <p>{h.text}</p>}
    </div>
  )
}

export const BookContext = createContext<Book | null>(null)

/** Keys for an open function list; returns true when the key was used. */
export function assistKey(
  e: { key: string; preventDefault: () => void; shiftKey: boolean },
  state: AssistState,
  index: number,
  setIndex: (i: number) => void,
  pick: (name: string) => void,
): boolean {
  if (!state.items.length) return false
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setIndex((index + 1) % state.items.length)
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    setIndex((index - 1 + state.items.length) % state.items.length)
    return true
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault()
    pick(state.items[Math.min(index, state.items.length - 1)])
    return true
  }
  return false
}
