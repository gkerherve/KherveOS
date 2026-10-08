// A lesson as a kBook notebook (the ".kbook" format shared with the desktop KherveBook:
// {"format": "kbook", "version": 1, "cells": [{type, source}]}). No React, no "@/" imports.

import type { Lesson } from './lessonTypes.ts'

export interface NotebookCell {
  type: 'markdown' | 'code'
  source: string
}

export interface KBook {
  format: 'kbook'
  version: 1
  cells: NotebookCell[]
}

/** The checks of a lesson as plain assert statements (checks that read the printed text are left out). */
export function checkCellSource(lesson: Lesson): string {
  return (lesson.checks ?? [])
    .filter((c) => !c.test.includes('OUTPUT'))
    .map((c) => `# ${c.label}\n${c.test}`)
    .join('\n\n')
}

/** The notebook for a Python lesson with the learner's current code. */
export function lessonNotebook(lesson: Lesson, code: string): KBook {
  const cells: NotebookCell[] = [
    { type: 'markdown', source: `# ${lesson.title}\n\n${lesson.text}${lesson.task ? `\n\n**Your turn.** ${lesson.task}` : ''}` },
    { type: 'code', source: code.replace(/\n$/, '') },
  ]
  const checks = checkCellSource(lesson)
  if (checks) {
    cells.push({ type: 'markdown', source: '## Check your work\n\nRun this cell after your code: each check passes when nothing is raised.' })
    cells.push({ type: 'code', source: checks })
  }
  return { format: 'kbook', version: 1, cells }
}
