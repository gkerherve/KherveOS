// The built-in kMech examples as .kmech files (pure): tools/export_kmech_examples.ts writes them to
// public/examples/kmech/ (with index.json); the tests open and analyse every one.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES } from './examples.ts'
import { serializeKMech } from './doc.ts'

export const KMECH_EXAMPLES_FOLDER = 'kMech Examples'

export function kmechExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((e, i) => ({
    file: exampleFileName(i + 1, e.title, 'kmech'),
    title: e.title,
    description: e.description,
    group: e.group,
    content: serializeKMech(e.doc),
  }))
}
