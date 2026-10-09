// The built-in circuits as .kdig files (pure): the ids are numbered in order, so the same text comes out every
// time. The files are written to public/examples/kdigital/ by tools/export_kdigital_examples.ts; the tests
// simulate every one.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES } from './examples.ts'
import { serializeKdig } from './file.ts'

export const KDIGITAL_EXAMPLES_FOLDER = 'kDigital Examples'

export function kdigitalExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'kdig'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: serializeKdig(ex.build()),
  }))
}
