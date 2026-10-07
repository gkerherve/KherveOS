// The editor's change bar: a thin gutter showing lines added, modified or
// deleted since the last commit (the desktop app's QScintilla markers).
// Added to an editor after it is created: view.dispatch({ effects: StateEffect.appendConfig.of(changeBar) }).

import { RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { LineMarkers } from '@/os/services/git'

type Kind = 'added' | 'modified' | 'deleted'

class ChangeMarker extends GutterMarker {
  kind: Kind
  constructor(kind: Kind) {
    super()
    this.kind = kind
  }
  eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.kind === this.kind
  }
  toDOM(): Node {
    const el = document.createElement('div')
    el.className = `kpy-cb kpy-cb-${this.kind}`
    return el
  }
}

const MARKERS: Record<Kind, ChangeMarker> = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  deleted: new ChangeMarker('deleted'),
}

/** Replace the markers (0-based line numbers, as git.lineMarkers returns them). */
export const setChangeMarkers = StateEffect.define<LineMarkers | null>()

const field = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setChangeMarkers)) continue
      const m = e.value
      if (!m) return RangeSet.empty
      const doc = tr.state.doc
      const ranges: Range<GutterMarker>[] = []
      const add = (line: number, kind: Kind) => {
        if (line >= 0 && line < doc.lines) ranges.push(MARKERS[kind].range(doc.line(line + 1).from))
      }
      for (const l of m.added) add(l, 'added')
      for (const l of m.modified) add(l, 'modified')
      for (const l of m.deleted) add(l, 'deleted')
      return RangeSet.of(ranges, true)
    }
    return tr.docChanged ? value.map(tr.changes) : value
  },
})

export const changeBar: Extension = [
  field,
  gutter({
    class: 'kpy-changebar',
    markers: (v) => v.state.field(field),
  }),
  EditorView.baseTheme({ '.kpy-changebar': { width: '4px' } }),
]

/** Has the change bar been added to this editor yet? */
export function hasChangeBar(view: EditorView): boolean {
  return view.state.field(field, false) !== undefined
}
