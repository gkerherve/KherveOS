// The AI tool sets of the technique apps (src/apps/khervetech: KherveTGA,
// KherveBET…), built the same way for each: open a file or an example, list /
// select sheets, run one analysis of the desktop's analysis window with its
// main parameters, read the results, export. ≤ 6 arguments each. The code is
// src/apps/khervetech/aiTools.ts; each app's `run` actions are in
// src/apps/kherve<tech>/actions.ts (the window's own controls and handlers).

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })

export interface TechniqueToolSetSpec {
  app: string
  name: string
  summary: string
  keywords: string[]
  /** The file types it imports, for the open_file description. */
  files: string
  /** The `run` actions, and what low / high / options mean for each (one line each). */
  actions: Record<string, string>
}

export function techniqueToolSet(s: TechniqueToolSetSpec): AppToolSet {
  const actionNames = Object.keys(s.actions)
  return {
    app: s.app,
    name: s.name,
    summary: s.summary,
    keywords: s.keywords,
    tools: [
      {
        action: 'open_file',
        description: `Open a file in ${s.name}: a project (.kfit) or a raw ${s.files} file, imported as the desktop's File > Import does (a .kfit project is written next to it). Paths are on the KherveOS drive (~/…).`,
        inputSchema: object({ path: str('The file, e.g. "~/Documents/' + s.name + ' Examples/…".') }, ['path']),
      },
      {
        action: 'open_example',
        description: `Open one of ${s.name}'s example files (copied to ~/Documents/${s.name} Examples). Without a name, lists them.`,
        inputSchema: object({ name: str('Part of the file name, e.g. "' + Object.keys(s.actions)[0] + '".') }),
      },
      {
        action: 'list_sheets',
        description: `The open project: its file, its sheets (the measured runs and the derived ${s.name.replace('Kherve', '')}~… sheets) and the one on the plot.`,
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'select_sheet',
        description: 'Show a sheet on the main plot (as the toolbar sheet selector).',
        inputSchema: object({ sheet: str('The sheet name.') }, ['sheet']),
      },
      {
        action: 'run',
        description: `Run one analysis of the ${s.name} analysis window as its button does (one undo step). Returns the window's messages and result boxes / tables; get_results gives the stored numbers. What each action does and takes is in the "action" argument.`,
        inputSchema: object(
          {
            action: oneOf(actionNames, 'What to run:\n' + actionNames.map((a) => `- ${a}: ${s.actions[a]}`).join('\n')),
            sheet: str('The sheet to run it on (default: the one on the plot).'),
            low: num('Lower bound (see the action).'),
            high: num('Upper bound (see the action).'),
            options: anyObject('Other settings of that action, by the names given above.'),
          },
          ['action'],
        ),
      },
      {
        action: 'get_results',
        description: 'The results stored on a sheet by the analyses (steps, peaks, events, fits, surface areas…), as numbers.',
        inputSchema: object({ sheet: str('The sheet (default: the one on the plot).') }),
        readOnly: true,
      },
      {
        action: 'export',
        description: 'Save the project (.kfit, Quick Save or a new path) or write a sheet\'s columns as CSV / TXT / DAT.',
        inputSchema: object({ format: oneOf(['kfit', 'csv', 'txt', 'dat'], 'What to write.'), path: str('Where (default: next to the project).'), sheet: str('The sheet, for csv / txt / dat.') }, ['format']),
      },
    ],
  }
}
