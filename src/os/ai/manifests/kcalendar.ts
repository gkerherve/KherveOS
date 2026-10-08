// AI tools of Calendar (a month calendar with events). ≤ 6 arguments each.
// The code is in src/apps/kcalendar/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { object, str } from './schema.ts'

export const KCALENDAR_TOOL_SET: AppToolSet = {
  app: 'kcalendar',
  name: 'Calendar',
  summary: 'a month calendar with events: list what is planned between two days, add an event, delete one (asks first).',
  keywords: ['kcalendar', 'calendar', 'agenda', 'event', 'appointment', 'meeting', 'schedule', 'reminder', 'date', 'planned'],
  tools: [
    {
      action: 'events',
      description: 'The events in Calendar, in order, optionally between two days (YYYY-MM-DD, both included).',
      inputSchema: object({ from: str('First day, YYYY-MM-DD (optional).'), to: str('Last day, YYYY-MM-DD (optional).') }),
    },
    {
      action: 'add',
      description: 'Add an event to Calendar on a day, at a time (HH:MM) or all day. Shows that day in the window.',
      inputSchema: object(
        {
          date: str('The day, YYYY-MM-DD.'),
          title: str('What the event is.'),
          time: str('Start time HH:MM, or leave empty for all day.'),
          note: str('A note (optional).'),
        },
        ['date', 'title'],
      ),
    },
    {
      action: 'delete',
      description: 'Delete a Calendar event by its id (from kcalendar_events). Asks the user first.',
      inputSchema: object({ id: str('The event id.') }, ['id']),
    },
  ],
}
