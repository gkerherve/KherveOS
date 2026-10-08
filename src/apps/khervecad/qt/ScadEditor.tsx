// The Code tab's editor (the desktop's CodeView): the OpenSCAD program with
// line numbers, the desktop's highlighting (ScadHighlighter's families and
// dark colours), the selected object's lines tinted, broken lines red, wrap
// on or off, and the code toolbar's commands (undo, redo, cut, copy, paste,
// indent, dedent). The text goes back to Python when the editor loses focus
// (before Apply code reads it).

import { memo, useEffect, useRef } from 'react'
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, drawSelection, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, selectAll, undo } from '@codemirror/commands'
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Node } from '../types'
import { useQt } from './context'

const SHAPES = new Set('circle square polygon text cube sphere cylinder polyhedron import surface'.split(' '))
const TRANSFORMS = new Set('translate rotate scale mirror resize linear_extrude rotate_extrude offset projection color'.split(' '))
const BOOLEANS = new Set('union difference intersection hull minkowski'.split(' '))
const CONTROL = new Set('module function if else for let each echo assert'.split(' '))
const CONSTANTS = new Set(['true', 'false', 'undef', 'PI'])

/** OpenSCAD tokens as the desktop colours them (treepanel.ScadHighlighter). */
export const openscad = StreamLanguage.define<{ lineStart: boolean }>({
  startState: () => ({ lineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.lineStart = true
    if (stream.eatSpace()) return null
    if (state.lineStart && stream.peek() === '*') {
      stream.skipToEnd()
      return 'meta' // a disabled object: grey italic
    }
    state.lineStart = false
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      while (!stream.eol() && !stream.match('*/')) stream.next()
      return 'comment'
    }
    if (stream.match(/^"(\\.|[^"\\])*"/)) return 'string'
    if (stream.match(/^\$\w+/)) return 'special'
    if (stream.match(/^(\d+\.?\d*([eE][-+]?\d+)?|\.\d+)/)) return 'number'
    const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null
    if (word) {
      const w = word[0]
      if (CONTROL.has(w)) return 'keyword'
      if (CONSTANTS.has(w)) return 'atom'
      const call = /^\s*\(/.test(stream.string.slice(stream.pos))
      if (call && SHAPES.has(w)) return 'typeName'
      if (call && TRANSFORMS.has(w)) return 'propertyName'
      if (call && BOOLEANS.has(w)) return 'className'
      if (/^\s*=[^=]/.test(stream.string.slice(stream.pos)) && /^\s*$/.test(stream.string.slice(0, stream.start))) return 'definition'
      return null
    }
    stream.next()
    return null
  },
  tokenTable: {
    definition: t.definition(t.variableName),
    special: t.special(t.variableName),
    typeName: t.typeName,
    propertyName: t.propertyName,
    className: t.className,
    keyword: t.keyword,
    atom: t.atom,
    number: t.number,
    string: t.string,
    meta: t.meta,
    comment: t.comment,
  },
})

const DESKTOP_DARK = HighlightStyle.define([
  { tag: t.definition(t.variableName), color: '#e5c07b' },
  { tag: t.typeName, color: '#4ec9b0', fontWeight: 'bold' },
  { tag: t.propertyName, color: '#6ab0f3', fontWeight: 'bold' },
  { tag: t.className, color: '#c586c0', fontWeight: 'bold' },
  { tag: t.keyword, color: '#e06c75', fontWeight: 'bold' },
  { tag: t.atom, color: '#d19a66', fontWeight: 'bold' },
  { tag: t.special(t.variableName), color: '#c586c0', fontStyle: 'italic' },
  { tag: t.number, color: '#b5cea8' },
  { tag: t.string, color: '#ce9178' },
  { tag: t.meta, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.comment, color: '#7f848e', fontStyle: 'italic' },
])

const setMarks = StateEffect.define<{ sel: number[][]; err: number[][] }>()
const selLine = Decoration.line({ class: 'kc-code-sel' })
const errLine = Decoration.line({ class: 'kc-code-err' })

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue
      const b = new RangeSetBuilder<Decoration>()
      const lines = new Map<number, Decoration>()
      for (const [s, end] of e.value.sel) for (let l = s; l < end; l++) lines.set(l, selLine)
      for (const [s, end] of e.value.err) for (let l = s; l < end; l++) lines.set(l, errLine)
      for (const l of [...lines.keys()].sort((a, c) => a - c)) {
        if (l + 1 > tr.state.doc.lines) break
        const line = tr.state.doc.line(l + 1)
        b.add(line.from, line.from, lines.get(l)!)
      }
      deco = b.finish()
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const ScadEditor = memo(function ScadEditor({ n }: { n: Node }) {
  const { send } = useQt()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const wrap = useRef(new Compartment())
  const sent = useRef(n.text ?? '')
  const lastCmd = useRef<number | null>(null)
  const nodeRef = useRef(n)
  nodeRef.current = n

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: n.text ?? '',
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          indentUnit.of('    '),
          keymap.of([{ key: 'Tab', run: indentMore }, { key: 'Shift-Tab', run: indentLess }, ...defaultKeymap, ...historyKeymap]),
          openscad,
          syntaxHighlighting(DESKTOP_DARK),
          marksField,
          wrap.current.of(n.nowrap ? [] : EditorView.lineWrapping),
          EditorState.readOnly.of(!!n.ro),
          EditorView.domEventHandlers({
            blur: (_e, ev) => {
              const text = ev.state.doc.toString()
              if (text !== sent.current) {
                sent.current = text
                send({ op: 'text', id: nodeRef.current.id, text })
              }
            },
            keydown: (e) => {
              e.stopPropagation()
              return false
            },
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the program changed in Python (the tree was edited): show it
  useEffect(() => {
    const v = view.current
    if (!v || n.text === undefined) return
    if (v.hasFocus && v.state.doc.toString() !== sent.current) return // you are typing
    if (v.state.doc.toString() !== n.text) {
      const scroll = v.scrollDOM.scrollTop
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: n.text } })
      v.scrollDOM.scrollTop = scroll
    }
    sent.current = n.text
  }, [n.text])

  useEffect(() => {
    const v = view.current
    if (!v) return
    v.dispatch({ effects: setMarks.of({ sel: (n as Node & { sel_lines?: number[][] }).sel_lines ?? [], err: (n as Node & { err_lines?: number[][] }).err_lines ?? [] }) })
    const first = (n as Node & { sel_lines?: number[][] }).sel_lines?.[0]?.[0]
    if (first !== undefined && first + 1 <= v.state.doc.lines) {
      const pos = v.state.doc.line(first + 1).from
      v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    }
  }, [n])

  useEffect(() => {
    view.current?.dispatch({ effects: wrap.current.reconfigure(n.nowrap ? [] : EditorView.lineWrapping) })
  }, [n.nowrap])

  // the code toolbar's commands
  useEffect(() => {
    const v = view.current
    const cmd = n.cmd
    if (!v || !cmd || cmd[1] === lastCmd.current) return
    lastCmd.current = cmd[1]
    v.focus()
    const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)
    switch (cmd[0]) {
      case 'undo':
        undo(v)
        break
      case 'redo':
        redo(v)
        break
      case 'indent':
        indentMore(v)
        break
      case 'dedent':
        indentLess(v)
        break
      case 'selectAll':
        selectAll(v)
        break
      case 'copy':
        if (sel) void navigator.clipboard?.writeText(sel)
        break
      case 'cut':
        if (sel) {
          void navigator.clipboard?.writeText(sel)
          v.dispatch(v.state.replaceSelection(''))
        }
        break
      case 'paste':
        void navigator.clipboard?.readText().then((text) => v.dispatch(v.state.replaceSelection(text)))
        break
    }
  }, [n.cmd])

  return <div ref={host} className="kc-code" />
})
