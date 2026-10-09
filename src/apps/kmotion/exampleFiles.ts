// The built-in experiments as .kmotion files (pure): file names, index entries and the text of each file.
// tools/export_kmotion_examples.ts writes them to public/examples/kmotion/.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { motionExamples } from './examples.ts'
import { serializeKmotion } from './registry.ts'

export const KMOTION_EXAMPLES_FOLDER = 'kMotion Examples'

export function kmotionExampleFiles(): ExampleSource[] {
  return motionExamples().map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'kmotion'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: serializeKmotion(ex.doc),
  }))
}
