// The example notebooks as .keln files (pure). tools/export_keln_examples.ts writes them to public/examples/keln/;
// the app copies them into ~/Documents/kELN Examples (src/os/exampleFiles.ts) and the tests verify every one.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { exampleNotebooks } from './exampleData.ts'
import { serializeKeln } from './model.ts'

export const KELN_EXAMPLES_FOLDER = 'kELN Examples'

export function kelnExampleFiles(): ExampleSource[] {
  return exampleNotebooks().map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'keln'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: serializeKeln(ex.notebook),
  }))
}
