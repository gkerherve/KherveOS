// A themed CodeMirror 6 editor. Used by Notepad and by KherveBook cells.

import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
  placeholder as placeholderExt, type KeyBinding, type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'

export type EditorLanguage = 'python' | 'markdown' | 'javascript' | 'typescript' | 'json' | 'latex' | 'plain'

export function languageForExtension(ext: string): EditorLanguage {
  switch (ext) {
    case '.py': return 'python'
    case '.md': return 'markdown'
    case '.js': case '.mjs': case '.jsx': return 'javascript'
    case '.ts': case '.tsx': return 'typescript'
    case '.json': case '.kbook': case '.ipynb': return 'json'
    case '.tex': case '.bib': return 'latex'
    default: return 'plain'
  }
}

function languageExtension(lang: EditorLanguage): Extension {
  switch (lang) {
    case 'python': return python()
    case 'markdown': return markdown()
    case 'javascript': return javascript({ jsx: true })
    case 'typescript': return javascript({ typescript: true, jsx: true })
    case 'json': return json()
    default: return []
  }
}

// Token colours come from CSS variables (see global.css), so they follow the theme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--k-syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--k-syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--k-syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--k-syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--k-syn-function)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--k-syn-def)' },
  { tag: [t.className, t.typeName, t.namespace], color: 'var(--k-syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--k-syn-property)' },
  { tag: [t.self, t.special(t.variableName)], color: 'var(--k-syn-keyword)' },
  { tag: t.heading, color: 'var(--k-syn-keyword)', fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--k-link)', textDecoration: 'underline' },
  { tag: t.meta, color: 'var(--k-syn-comment)' },
  { tag: t.invalid, color: 'var(--k-danger)' },
])

const baseTheme = EditorView.theme({
  '&': { color: 'var(--k-text)', backgroundColor: 'var(--k-bg)', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--k-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--k-text)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--k-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--k-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--k-text) 4%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--k-bg)', color: 'var(--k-muted)', border: 'none', borderRight: '1px solid var(--k-border)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--k-text)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--k-selection)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--k-warning) 35%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--k-accent) 40%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--k-accent) 14%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--k-chrome)', color: 'var(--k-text)', borderColor: 'var(--k-border)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit', fontSize: '12px' },
  '.cm-placeholder': { color: 'var(--k-placeholder)' },
})

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: EditorLanguage
  wrap?: boolean
  lineNumbers?: boolean
  /** Grow with the content instead of scrolling (notebook cells). */
  autoHeight?: boolean
  fontSize?: number
  placeholder?: string
  readOnly?: boolean
  autoFocus?: boolean
  /** Extra key bindings, checked before the defaults (e.g. Shift-Enter to run). */
  keys?: KeyBinding[]
  onFocus?: () => void
  onBlur?: () => void
  onReady?: (view: EditorView) => void
  /** Called when the text or the selection changes (cursor position, …). */
  onUpdate?: (update: ViewUpdate) => void
  className?: string
}

export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props
  const comps = useRef({
    lang: new Compartment(), wrap: new Compartment(), gutter: new Compartment(), size: new Compartment(), ro: new Compartment(),
  })

  useEffect(() => {
    const c = comps.current
    const p = latest.current
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          keymap.of([
            // Delegate to the latest props so bindings can use fresh state.
            ...(p.keys ?? []).map((k, i) => ({
              ...k,
              run: (view: EditorView) => latest.current.keys?.[i]?.run?.(view) ?? false,
            })),
          ]),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          indentUnit.of('    '),
          syntaxHighlighting(highlight),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          baseTheme,
          p.placeholder ? placeholderExt(p.placeholder) : [],
          c.lang.of(languageExtension(p.language ?? 'plain')),
          c.wrap.of(p.wrap ? EditorView.lineWrapping : []),
          c.gutter.of(p.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine()] : []),
          c.size.of(EditorView.theme({ '&': { fontSize: `${p.fontSize ?? 13}px` } })),
          c.ro.of(EditorState.readOnly.of(!!p.readOnly)),
          p.autoHeight ? EditorView.theme({ '&': { height: 'auto' }, '.cm-scroller': { overflow: 'visible' } }) : [],
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange?.(u.state.doc.toString())
            if (u.focusChanged) (u.view.hasFocus ? latest.current.onFocus : latest.current.onBlur)?.()
            if (u.docChanged || u.selectionSet) latest.current.onUpdate?.(u)
          }),
        ],
      }),
    })
    view.current = v
    p.onReady?.(v)
    if (p.autoFocus) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  // Keep the document in step when the value changes from outside (file loaded…).
  useEffect(() => {
    const v = view.current
    if (v && props.value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } })
    }
  }, [props.value])

  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.lang.reconfigure(languageExtension(props.language ?? 'plain')) })
  }, [props.language])
  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.wrap.reconfigure(props.wrap ? EditorView.lineWrapping : []) })
  }, [props.wrap])
  useEffect(() => {
    view.current?.dispatch({
      effects: comps.current.gutter.reconfigure(props.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine()] : []),
    })
  }, [props.lineNumbers])
  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.size.reconfigure(EditorView.theme({ '&': { fontSize: `${props.fontSize ?? 13}px` } })) })
  }, [props.fontSize])
  useEffect(() => {
    view.current?.dispatch({ effects: comps.current.ro.reconfigure(EditorState.readOnly.of(!!props.readOnly)) })
  }, [props.readOnly])

  return <div ref={host} className={`k-code-editor${props.autoHeight ? ' auto' : ''} ${props.className ?? ''}`} />
}
