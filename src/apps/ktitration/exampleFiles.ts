// The built-in examples as .ktitr files (pure). tools/export_ktitration_examples.ts writes them to
// public/examples/ktitration/; the tests load every one and check the documented numbers.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES } from './examples.ts'
import { serializeKtitr } from './project.ts'

export const KTITRATION_EXAMPLES_FOLDER = 'kTitration Examples'

export function ktitrationExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'ktitr'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: serializeKtitr({ ...ex.project, name: ex.title, description: ex.description }),
  }))
}
