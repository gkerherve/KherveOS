// The built-in examples as .kfea files (pure). tools/export_kfea_examples.ts writes them to public/examples/kfea/ (with
// index.json); the app copies them once into ~/Documents/kFEA Examples (src/os/exampleFiles.ts) and lists them in
// File › Open example. The tests solve every one.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES } from './examples.ts'
import { serializeModel } from './file.ts'

export const KFEA_EXAMPLES_FOLDER = 'kFEA Examples'

export function kfeaExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((e, i) => ({
    file: exampleFileName(i + 1, e.title, 'kfea'),
    title: e.title,
    description: e.description,
    group: e.group,
    content: serializeModel(e.model),
  }))
}
