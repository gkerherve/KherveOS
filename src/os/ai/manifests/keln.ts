// AI tools of kELN: read the notebook, add a draft entry, search, open an example. At most 4 tools, ≤ 6 arguments each.
// Signing, witnessing and amending are deliberately not offered: they are a person's act.
// The code is in src/apps/keln/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { object, str } from './schema.ts'

export const KELN_TOOL_SET: AppToolSet = {
  app: 'keln',
  name: 'kELN',
  summary: 'electronic lab notebook: dated entries, samples, signatures; AI adds drafts and searches.',
  keywords: ['keln', 'notebook', 'lab notebook', 'eln', 'sample', 'entry', 'experiment', 'signature', 'protocol', 'audit', 'lab book'],
  tools: [
    {
      action: 'get_state',
      description: 'What kELN shows: the open notebook (title, path, counts, projects), the selected entry, recent entries and the template ids. Say so if no notebook is open.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'add_entry',
      description: 'Add a DRAFT entry to the open notebook (or the .keln file at path) from a template, with optional Markdown text; returns its id and experiment number. Asks the user first. A person signs it, not the AI.',
      inputSchema: object({
        title: str('Entry title.'),
        template: str('Template id or name: blank, organic-synthesis, titration, xps-session, tga-session, xrd-session, calibration-log, cell-culture, pcr-setup, gel-electrophoresis, thin-film, instrument-maintenance, solution-prep, literature-note, meeting-actions, risk-assessment. Default blank.'),
        project: str('Project code or name (default: the only project).'),
        tags: str('Comma-separated tags.'),
        text: str('Markdown added after the template (headings, lists, tables, $maths$).'),
        path: str('Notebook file to use instead of the open notebook, e.g. ~/Documents/kELN/lab.keln.'),
      }, ['title']),
      destructive: true,
    },
    {
      action: 'search',
      description: 'Full-text search of entries (titles, text, reaction tables, samples, instruments). The query accepts tag:x sample:ID instrument:x status:signed from:2026-01-01 to:2026-03-31. Returns matching entries with snippets.',
      inputSchema: object({
        query: str('Words and operators, e.g. "yield tag:synthesis".'),
        project: str('Only this project (code or name).'),
        tag: str('Only entries with this tag.'),
        status: str('draft, signed, witnessed or amended.'),
        from: str('Only entries from this date (YYYY-MM-DD).'),
        path: str('Notebook file to search instead of the open notebook.'),
      }),
      readOnly: true,
    },
    {
      action: 'load_example',
      description: 'Open one of the example notebooks (aspirin synthesis, titration, TGA, XPS with sample lineage, calibration, PCR, thin films, audit chain demo, tamper demo…). Without an id, lists them.',
      inputSchema: object({ id: str('Number or part of the title from the list, e.g. "aspirin". Leave out to list them.') }),
    },
  ],
}
