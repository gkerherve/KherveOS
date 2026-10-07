// The main window's LaTeX and Console tabs, as on the desktop.
//
// LaTeX (latex_view.py): the generated beamer source, live and editable, with
// line numbers and LaTeX colouring. Editing it enters "manual edit" mode: the
// banner says the slides won't overwrite the edits, the compile uses the
// edited text, and "Regenerate from slides" goes back. A real slide edit also
// regenerates it (window._refresh_latex).
// Console: the compiler's log, in the desktop's terminal look.

import { useMemo, useRef } from 'react'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { CodeEditor } from '@/os/ui/CodeEditor'
import type { LatexError } from '@/os/services/latex'

// ------------------------------------------------------------------ LaTeX colouring

interface TexState {
  math: false | '$' | '$$' | '\\[' | '\\('
  env: boolean
}

const texLanguage = StreamLanguage.define<TexState>({
  name: 'latex',
  startState: () => ({ math: false, env: false }),
  token(stream, state) {
    if (state.env) {
      // The name after \begin / \end.
      if (stream.match(/^\{[A-Za-z*@]+\}/)) {
        state.env = false
        return 'typeName'
      }
      state.env = false
    }
    if (stream.match('%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (state.math) {
      if ((state.math === '$$' && stream.match('$$')) || (state.math === '$' && stream.match('$')) || (state.math === '\\[' && stream.match('\\]')) || (state.math === '\\(' && stream.match('\\)'))) {
        state.math = false
        return 'string'
      }
      if (stream.match(/^\\[A-Za-z@]+/)) return 'string'
      stream.next()
      return 'string'
    }
    if (stream.match('$$')) {
      state.math = '$$'
      return 'string'
    }
    if (stream.match('\\[')) {
      state.math = '\\['
      return 'string'
    }
    if (stream.match('\\(')) {
      state.math = '\\('
      return 'string'
    }
    if (stream.match('$')) {
      state.math = '$'
      return 'string'
    }
    const cmd = stream.match(/^\\(begin|end)\b/)
    if (cmd) {
      state.env = true
      return 'keyword'
    }
    if (stream.match(/^\\(section|subsection|frametitle|title|author|date|usetheme|usecolortheme|documentclass|usepackage)\b/)) return 'heading'
    if (stream.match(/^\\[A-Za-z@]+\*?/) || stream.match(/^\\./)) return 'function'
    if (stream.match(/^[{}]/)) return 'bracket'
    if (stream.match(/^\[[^\]\n]*\]/)) return 'number'
    if (stream.match(/^[&#^_~]/)) return 'atom'
    stream.next()
    return null
  },
  tokenTable: { typeName: t.typeName, heading: t.heading, function: t.function(t.variableName), bracket: t.bracket, atom: t.atom },
})

const texHighlight = HighlightStyle.define([
  { tag: t.typeName, color: 'var(--k-syn-type)' },
  { tag: t.function(t.variableName), color: 'var(--k-syn-function)' },
  { tag: t.heading, color: 'var(--k-syn-keyword)', fontWeight: '600' },
  { tag: t.keyword, color: 'var(--k-syn-keyword)' },
  { tag: t.string, color: 'var(--k-syn-string)' },
  { tag: t.number, color: 'var(--k-syn-number)' },
  { tag: t.atom, color: 'var(--k-syn-number)' },
  { tag: t.bracket, color: 'var(--k-muted)' },
  { tag: t.comment, color: 'var(--k-syn-comment)', fontStyle: 'italic' },
])

/** The LaTeX tab: shows `source`; `onEdit` gets the user's edits (manual mode). */
export function LatexTab({
  source, overridden, onEdit, onRegenerate, onView,
}: {
  source: string
  overridden: boolean
  onEdit: (text: string) => void
  onRegenerate: () => void
  onView?: (v: EditorView) => void
}) {
  const shown = useRef(source)
  shown.current = source
  const ready = useMemo(
    () => (v: EditorView) => {
      v.dispatch({ effects: StateEffect.appendConfig.of([texLanguage, syntaxHighlighting(texHighlight)]) })
      onView?.(v)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  return (
    <div className="ks2-latextab">
      {overridden && (
        <div className="ks2-latex-banner">
          <span>Manual LaTeX edits — the slides won't overwrite them.</span>
          <button className="k-btn small" title="Discard the manual LaTeX edits and rebuild the source from the Visual slides" onClick={onRegenerate}>
            Regenerate from slides
          </button>
        </div>
      )}
      <CodeEditor
        className="ks2-latex-editor"
        value={source}
        lineNumbers
        language="plain"
        fontSize={12.5}
        onReady={ready}
        onChange={(v) => {
          if (v !== shown.current) onEdit(v)
        }}
      />
    </div>
  )
}

// ------------------------------------------------------------------ Console

export function ConsoleTab({ log, errors, missing }: { log: string; errors: LatexError[]; missing: string[] }) {
  return (
    <div className="ks2-console">
      {(errors.length > 0 || missing.length > 0) && (
        <div className="ks2-console-errors">
          {missing.map((m) => (
            <div key={m}>Picture not found: {m} (an empty frame is printed instead)</div>
          ))}
          {errors.map((e, i) => (
            <div key={i}>
              {e.line ? `line ${e.line}: ` : ''}
              {e.message}
            </div>
          ))}
        </div>
      )}
      <pre className="ks2-console-log">{log}</pre>
    </div>
  )
}
