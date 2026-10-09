// The built-in circuits as .kelec files (pure): the wires are routed, the ids numbered in order (so the same
// text comes out every time) and the analysis, scope traces and layout stored with the schematic. The files
// are written to public/examples/kelec/ by tools/export_app_examples.ts; the tests simulate every one.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES, exampleDoc, type Example } from './examples.ts'
import { serializeKelec } from './file.ts'
import type { Doc } from './model.ts'
import { DEFAULT_SETTINGS } from './settings.ts'

export const KELEC_EXAMPLES_FOLDER = 'kElec Examples'

/** The same drawing with its ids numbered p1…, w1…, l1…, n1… in the order of the lists. */
export function canonicalIds(doc: Doc): Doc {
  return {
    parts: doc.parts.map((p, i) => ({ ...p, id: `p${i + 1}` })),
    wires: doc.wires.map((w, i) => ({ ...w, id: `w${i + 1}` })),
    labels: doc.labels.map((l, i) => ({ ...l, id: `l${i + 1}` })),
    notes: doc.notes.map((n, i) => ({ ...n, id: `n${i + 1}` })),
  }
}

/** The text of an example's .kelec file. */
export function exampleFileText(ex: Example): string {
  return serializeKelec(canonicalIds(exampleDoc(ex)), { ...DEFAULT_SETTINGS, ...ex.sim }, ex.title, '', { show: ex.show, stacked: ex.stacked })
}

export function kelecExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'kelec'),
    title: ex.title,
    description: ex.description,
    group: ex.category,
    content: exampleFileText(ex),
  }))
}
