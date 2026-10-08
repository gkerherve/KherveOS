// AI tools of kCode (learning Python and JavaScript). ≤ 6 arguments each.
// The code is in src/apps/kcode/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { object, oneOf, str } from './schema.ts'

export const KCODE_TOOL_SET: AppToolSet = {
  app: 'kcode',
  name: 'kCode',
  summary: 'learn Python and JavaScript: lessons with checked exercises, hints, progress, a scratchpad.',
  keywords: ['kcode', 'code', 'coding', 'learn', 'lesson', 'lessons', 'tutorial', 'exercise', 'python', 'javascript', 'program', 'programming', 'course'],
  tools: [
    {
      action: 'lessons',
      description: 'The lessons of kCode: id, language, title, course, chapter, level and whether the learner has finished it. Optional filters by course, language or words.',
      inputSchema: object({
        course: str('Only this course: "python-basics", "python-science", "javascript-basics" or "lab-recipes".'),
        language: oneOf(['python', 'javascript'], 'Only lessons in this language.'),
        query: str('Only lessons whose title or text contains these words.'),
      }),
      readOnly: true,
    },
    {
      action: 'open',
      description: 'Open a lesson of kCode by its id (from kcode_lessons).',
      inputSchema: object({ lesson: str('The lesson id, e.g. "py-lists".') }, ['lesson']),
    },
    {
      action: 'run',
      description: 'Put code in the open kCode lesson (or the scratchpad) and run it (Python or JavaScript, as the lesson). Returns the output, the value of the last expression and any error.',
      inputSchema: object({ code: str('The code to run.') }, ['code']),
    },
    {
      action: 'check',
      description: 'Run the open lesson\'s code with its exercise checks and return which checks passed and why the others failed. A lesson with no checks is only run. A passed exercise is marked as completed.',
      inputSchema: object({}),
    },
    {
      action: 'hint',
      description: 'Show and return the hint of the open lesson (never the solution), with the task.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'progress',
      description: 'How far the learner is: lessons completed, per course, the practice streak, the open lesson and the next one.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'set_code',
      description: 'Replace the code in the editor of the open lesson (or the scratchpad) without running it, so the learner can read it and run it.',
      inputSchema: object({ code: str('The new code.') }, ['code']),
    },
  ],
}
