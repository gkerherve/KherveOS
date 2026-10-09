// The built-in examples as .kclim files (pure). They are written to public/examples/kclimate/ by
// tools/export_kclimate_examples.ts; the tests open every one and check what it shows.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { buildExamples } from './examples.ts'
import { serializeKclim } from './project.ts'

export const KCLIMATE_EXAMPLES_FOLDER = 'kClimate Examples'

export function kclimateExampleFiles(): ExampleSource[] {
  return buildExamples().map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'kclim'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: serializeKclim(ex.project),
  }))
}
