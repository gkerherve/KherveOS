// The Code tab, the Console tab, the PDF panel and the find bar.

import { useEffect, useRef, useState } from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, ExternalLink, FileText, LoaderCircle, Play, Replace, X,
} from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { CodeEditor } from '@/os/ui/CodeEditor'
import type { LatexError } from '@/os/services/latex'
import { latexLanguage } from '../latexMode'
import { findCount, findNext, replaceAll, replaceCurrent, setFindQuery } from '../editor/find'

// ----------------------------------------------------------------- Code tab

export function CodeTab({
  value, error, onEdit, onReady,
}: {
  value: string
  error: string | null
  onEdit: (text: string) => void
  onReady: (view: EditorView) => void
}) {
  return (
    <div className="ktx-code">
      <div className={`ktx-code-note${error ? ' bad' : ''}`}>
        {error ?? 'The LaTeX of this document. Edits here are read back into the document, like an imported .tex.'}
      </div>
      <CodeEditor
        value={value}
        language="latex"
        wrap
        lineNumbers
        fontSize={13}
        onChange={onEdit}
        onReady={(view) => {
          view.dispatch({ effects: StateEffect.appendConfig.of([latexLanguage]) })
          onReady(view)
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

// ----------------------------------------------------------------- PDF panel

export function PdfPanel({
  url, view, onCompile, onDownload, onClose, notice,
}: {
  url: string | null
  view: CompileView
  onCompile: () => void
  onDownload: () => void
  onClose: () => void
  notice: string | null
}) {
  return (
    <div className="ktx-pdf">
      <div className="ktx-pdf-bar">
        <FileText size={14} />
        <span className="ktx-pdf-title">PDF</span>
        {view.running && <LoaderCircle size={14} className="k-spin" />}
        {!view.running && view.ok === false && <span className="ktx-pdf-bad">Not compiled — see the Console</span>}
        <span style={{ flex: 1 }} />
        <button className="k-icon-btn" title="Compile now (⌘↩)" onClick={onCompile}>
          <Play size={14} />
        </button>
        <button className="k-icon-btn" title="Open in a browser tab" disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener')}>
          <ExternalLink size={14} />
        </button>
        <button className="k-icon-btn" title="Download the PDF" disabled={!url} onClick={onDownload}>
          <Download size={14} />
        </button>
        <button className="k-icon-btn" title="Hide the PDF (⌘4)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {url ? (
        <iframe key={url} className="ktx-pdf-frame" src={`${url}#view=FitH&zoom=page-width`} title="PDF preview" />
      ) : (
        <div className="ktx-pdf-empty k-muted">
          {notice ?? (view.running ? 'Typesetting…' : 'The PDF appears here once the document compiles.')}
        </div>
      )}
      {url && notice && <div className="ktx-pdf-notice">{notice}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ find bar

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [status, setStatus] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    return () => {
      if (!editor.isDestroyed) setFindQuery(editor.view, '', false)
    }
  }, [editor])

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
    <div className="ktx-find" onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
    }}>
      <input
        ref={input}
        className="k-input"
        placeholder="Find"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go(!e.shiftKey)}
      />
      <button className="k-icon-btn" title="Previous (⇧↩)" onClick={() => go(false)}>
        <ArrowUp size={14} />
      </button>
      <button className="k-icon-btn" title="Next (↩)" onClick={() => go(true)}>
        <ArrowDown size={14} />
      </button>
      <label className="ktx-check small">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case
      </label>
      <input
        className="k-input"
        placeholder="Replace with"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && setStatus(`${replaceCurrent(editor.view, replacement) ? 'Replaced' : 'Not found'}`)}
      />
      <button className="k-btn small" onClick={() => replaceCurrent(editor.view, replacement)}>
        <Replace size={13} /> Replace
      </button>
      <button className="k-btn small" onClick={() => setStatus(`${replaceAll(editor.view, replacement)} replaced`)}>
        Replace all
      </button>
      <span className="ktx-find-status">{status}</span>
      <button className="k-icon-btn" title="Close (Esc)" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
