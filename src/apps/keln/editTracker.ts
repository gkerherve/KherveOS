// Tells a real edit from the editor tidying its own document (pure). Tiptap normalises what it loads (default
// attributes, a trailing empty paragraph, a transaction when it becomes editable…) and says "update" for it; none of
// that is something the user did, so it must never write an audit record or mark the notebook unsaved. The tracker keeps
// the editor's own first output as the baseline and reports a change only when the document differs from the last
// content that was committed (ignoring trailing empty paragraphs).

import { canonical } from './hash.ts'
import type { PMNode } from './doc.ts'

/** The document without the empty paragraphs at its end (the editor adds one after a block). */
export function withoutTrailingEmpty(d: PMNode): PMNode {
  const content = [...(d.content ?? [])]
  while (content.length > 1) {
    const last = content[content.length - 1]
    if (last.type === 'paragraph' && !last.content?.length) content.pop()
    else break
  }
  return { ...d, content }
}

export const contentKey = (d: PMNode): string => canonical(withoutTrailingEmpty(d))

export interface EditTracker {
  /** The document as the editor first showed it (after its own normalisation). */
  reset(json: PMNode): void
  /** True when `json` differs from the baseline: a real edit. */
  changed(json: PMNode): boolean
  /** `json` is what to store, or null when nothing really changed. Remembers it as the new baseline. */
  take(json: PMNode): PMNode | null
}

export function createTracker(initial?: PMNode): EditTracker {
  let base = initial ? contentKey(initial) : ''
  return {
    reset: (json) => { base = contentKey(json) },
    changed: (json) => contentKey(json) !== base,
    take: (json) => {
      const k = contentKey(json)
      if (k === base) return null
      base = k
      return json
    },
  }
}
