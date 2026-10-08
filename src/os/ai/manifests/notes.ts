// AI tools of Notes (src/apps/notes): list/search, read, create, append,
// tick checklist items, move, delete. The code is in src/apps/notes/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, object, str } from './schema.ts'

const NOTE = str('The note: its id (from notes_list) or its title.')

export const NOTES_TOOL_SET: AppToolSet = {
  app: 'notes',
  name: 'Notes',
  summary: 'notes like Apple Notes / Google Keep: folders, checklists, #tags, pinned notes (Markdown files in ~/Notes).',
  keywords: ['note', 'notes', 'checklist', 'to-do', 'todo', 'shopping list', 'remind me', 'jot', 'memo'],
  tools: [
    {
      action: 'list',
      description: 'List or search the notes: folders with counts, tags, and notes (id, title, folder, dates, pinned, tags, preview). Newest first, pinned on top.',
      inputSchema: object({
        query: str('Words to search for in titles and text; "#tag" filters by tag.'),
        folder: str('Only this folder ("Notes" for the top folder, "Work/Projects" for a subfolder).'),
        tag: str('Only notes with this tag (without "#").'),
        deleted: bool('List Recently Deleted instead.'),
        limit: int('At most this many notes (default 50).'),
      }),
      readOnly: true,
    },
    {
      action: 'read',
      description: 'Read a note as Markdown, with its checklist items numbered, and show it in the Notes window.',
      inputSchema: object({ note: NOTE }, ['note']),
      readOnly: true,
    },
    {
      action: 'create',
      description: 'Make a new note from Markdown. The first line is the title; "- [ ] item" makes a checklist, #word a tag.',
      inputSchema: object({
        text: str('The note in Markdown, title first, e.g. "Shopping\\n- [ ] milk\\n- [ ] eggs #home".'),
        folder: str('Folder to put it in (made if missing; default: Notes).'),
        pinned: bool('Pin it to the top.'),
      }, ['text']),
    },
    {
      action: 'append',
      description: 'Add Markdown at the end of a note (e.g. more checklist items "- [ ] bread").',
      inputSchema: object({ note: NOTE, text: str('Markdown to add.') }, ['note', 'text']),
    },
    {
      action: 'set_checklist_item',
      description: 'Tick or untick a checklist item of a note, by its number (from notes_read) or its text.',
      inputSchema: object({
        note: NOTE,
        item: str('The item number ("2") or words of its text ("milk").'),
        checked: bool('true = ticked (default), false = not ticked.'),
      }, ['note', 'item']),
    },
    {
      action: 'move',
      description: 'Move a note to another folder (made if missing), or restore it from Recently Deleted.',
      inputSchema: object({ note: NOTE, folder: str('The folder, e.g. "Work" ("Notes" = the top folder).') }, ['note', 'folder']),
    },
    {
      action: 'delete',
      description: 'Move a note to Recently Deleted (kept 30 days, can be restored with notes_move).',
      inputSchema: object({ note: NOTE }, ['note']),
      destructive: true,
    },
  ],
}
