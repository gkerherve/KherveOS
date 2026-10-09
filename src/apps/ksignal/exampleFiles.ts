// The built-in examples as .ksig files (pure): written to public/examples/ksignal/ by tools/export_ksignal_examples.ts.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES } from './examples.ts'
import { serializeKsig } from './project.ts'

export const KSIGNAL_EXAMPLES_FOLDER = 'kSignal Examples'

export function ksignalExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((e, i) => ({
    file: exampleFileName(i + 1, e.title, 'ksig'),
    title: e.title,
    description: e.description,
    group: e.group,
    content: serializeKsig(e.project),
  }))
}
