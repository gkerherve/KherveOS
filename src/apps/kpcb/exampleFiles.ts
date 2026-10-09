// The example boards as .kpcb files (pure): each built-in example routed by the auto-router and saved, so that
// it opens finished and DRC-clean from the user's Files app. tools/export_app_examples.ts writes them to
// public/examples/kpcb/ (with index.json); the tests check every one is 100 % routed with no DRC error.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { EXAMPLES, routedExample } from './examples.ts'
import { serializeDesign } from './file.ts'

export const KPCB_EXAMPLES_FOLDER = 'kPCB Examples'

export function kpcbExampleFiles(): ExampleSource[] {
  return EXAMPLES.map((e, i) => ({
    file: exampleFileName(i + 1, e.title, 'kpcb'),
    title: e.title,
    description: e.description,
    content: serializeDesign(routedExample(e.id)),
  }))
}
