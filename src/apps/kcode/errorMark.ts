// Highlights the line of an error in a CodeMirror editor (kCode's output links to it).

import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

const setErrorLine = StateEffect.define<number | null>()
const lineMark = Decoration.line({ class: 'kcd-errline' })

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) deco = Decoration.none // an edit makes the error stale
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue
      const n = e.value
      deco = n && n >= 1 && n <= tr.state.doc.lines ? Decoration.set([lineMark.range(tr.state.doc.line(n).from)]) : Decoration.none
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** Mark line `line` (1-based) as the error line, or clear the mark with null; `jump` also moves the cursor there. */
export function showErrorLine(view: EditorView, line: number | null, jump = false): void {
  if (!view.state.field(errorLineField, false)) view.dispatch({ effects: StateEffect.appendConfig.of(errorLineField) })
  const ok = line !== null && line >= 1 && line <= view.state.doc.lines
  view.dispatch({
    effects: setErrorLine.of(line),
    ...(jump && ok ? { selection: { anchor: view.state.doc.line(line).from }, scrollIntoView: true } : {}),
  })
  if (jump) view.focus()
}
