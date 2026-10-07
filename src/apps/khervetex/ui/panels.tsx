// The Code tab, the Console tab and the find bar.

import { useEffect, useRef, useState } from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { CodeEditor } from '@/os/ui/CodeEditor'
import type { LatexError } from '@/os/services/latex'
import { latexLanguage } from '../latexMode'
import { findCount, findNext, replaceAll, replaceCurrent, setFindQuery } from '../editor/find'

// ----------------------------------------------------------------- Code tab

export function CodeTab({
  value, error, onEdit, onReady, onContextMenu,
}: {
  value: string
  error: string | null
  onEdit: (text: string) => void
  onReady: (view: EditorView) => void
  /** Right-click: the text of the line under the caret ("Show in Visual / PDF"). */
  onContextMenu?: (e: React.MouseEvent, lineText: string) => void
}) {
  const view = useRef<EditorView | null>(null)
  return (
    <div
      className="ktx-code"
      onContextMenu={(e) => {
        const v = view.current
        if (!v || !onContextMenu) return
        e.preventDefault()
        const at = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head
        onContextMenu(e, v.state.doc.lineAt(at).text)
      }}
    >
      {error && <div className="ktx-code-note bad">{error}</div>}
      <CodeEditor
        value={value}
        language="latex"
        wrap
        lineNumbers
        fontSize={13}
        onChange={onEdit}
        onReady={(v) => {
          v.dispatch({ effects: StateEffect.appendConfig.of([latexLanguage]) })
          view.current = v
          onReady(v)
        }}
      />
    </div>
  )
}

/** Put the Code tab's cursor on a line and show it. */
export function revealLine(view: EditorView, line: number) {
  const doc = view.state.doc
  const n = Math.max(1, Math.min(doc.lines, line))
  const l = doc.line(n)
  view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
  view.focus()
}

// --------------------------------------------------------------- Console tab

export interface CompileView {
  running: boolean
  ok: boolean | null
  errors: LatexError[]
  log: string
  at: string | null
}

export function ConsoleTab({ view, onGoto }: { view: CompileView; onGoto: (err: LatexError) => void }) {
  if (view.ok === null && !view.running) {
    return <div className="ktx-console k-muted ktx-console-empty">Nothing compiled yet. Compile with ⌘↩ or the Compile button.</div>
  }
  return (
    <div className="ktx-console">
      <div className={`ktx-console-head ${view.running ? '' : view.ok ? 'ok' : 'bad'}`}>
        {view.running ? <LoaderCircle size={14} className="k-spin" /> : view.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        <span>
          {view.at ? `[${view.at}] ` : ''}LaTeX (tectonic) — {view.running ? 'compiling…' : view.ok ? (view.errors.length ? `compiled, with ${view.errors.length} error${view.errors.length > 1 ? 's' : ''} ignored` : 'compiled successfully') : 'failed'}
        </span>
      </div>
      {view.errors.length > 0 && (
        <div className="ktx-errors">
          {view.errors.map((e, i) => (
            <button key={i} className="ktx-error" onClick={() => onGoto(e)} title={e.line ? 'Show this line in the Code tab' : undefined}>
              <span className="ktx-error-where">{e.line ? `${e.file && e.file !== 'document.tex' ? `${e.file}:` : 'line '}${e.line}` : '—'}</span>
              <span>{e.message}</span>
            </button>
          ))}
        </div>
      )}
      <pre className="ktx-log">{view.log}</pre>
    </div>
  )
}

// ------------------------------------------------------------------ find bar

/** The desktop's find & replace bar along the bottom (⌘F; ⌃H adds the Replace row). */
export function FindBar({ editor, replace, onClose }: { editor: Editor; replace: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [status, setStatus] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [replace])

  useEffect(
    () => () => {
      if (!editor.isDestroyed) setFindQuery(editor.view, '', false)
    },
    [editor],
  )

  useEffect(() => {
    const n = setFindQuery(editor.view, query, caseSensitive)
    setStatus(query ? (n ? `${n} found` : 'Not found') : '')
  }, [editor, query, caseSensitive])

  const go = (forward: boolean) => {
    const i = findNext(editor.view, forward)
    const n = findCount(editor.state)
    setStatus(n ? `${i} of ${n}` : 'Not found')
  }

  return (
    <div
      className="ktx-find"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <span className="ktx-find-label">Find:</span>
      <input
        ref={input}
        className="k-input"
        placeholder="Search text..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go(!e.shiftKey)}
      />
      <button className="ktx-pbtn" onClick={() => go(false)}>Previous</button>
      <button className="ktx-pbtn default" onClick={() => go(true)}>Next</button>
      <label className="ktx-tb-check">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case
      </label>
      <button className="ktx-pbtn flat" title="Close (Esc)" onClick={onClose}>x</button>
      <span className="ktx-find-status">{status}</span>
      {replace && (
        <>
          <span className="ktx-find-label">Replace:</span>
          <input
            className="k-input"
            placeholder="Replacement text..."
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setStatus(replaceCurrent(editor.view, replacement) ? 'Replaced' : 'Not found')}
          />
          <button className="ktx-pbtn" onClick={() => setStatus(replaceCurrent(editor.view, replacement) ? 'Replaced' : 'Not found')}>Replace</button>
          <button className="ktx-pbtn" onClick={() => setStatus(`${replaceAll(editor.view, replacement)} replaced`)}>Replace all</button>
          <span />
          <span />
          <span />
        </>
      )}
    </div>
  )
}
