// The shapes of kCode's curriculum, and small helpers for writing lessons.
// (No React and no "@/" imports: Node tests the lesson data.)

import type { Check } from './checks.ts'

export type Language = 'python' | 'javascript'
export type Level = 'beginner' | 'intermediate' | 'advanced'
/** Python packages a lesson imports (the tests skip it where they are missing). */
export type Need = 'numpy' | 'scipy' | 'matplotlib' | 'pandas'

export interface Lesson {
  /** Unique, stable: progress and the AI tools refer to it ("py-lists"). */
  id: string
  language: Language
  title: string
  level: Level
  /** About how long it takes. */
  minutes: number
  /** The explanation (markdown, see markdown.ts). */
  text: string
  /** What to do, for a lesson with checks ("Your turn"). */
  task?: string
  /** The code the editor starts with. */
  code: string
  hint?: string
  solution?: string
  /** Automatic checks for the exercise (see checks.ts). A lesson without them is done when it runs. */
  checks?: Check[]
  needs?: Need[]
}

export interface Chapter {
  id: string
  title: string
  lessons: Lesson[]
}

export interface Course {
  id: string
  title: string
  language: Language
  blurb: string
  chapters: Chapter[]
}

/** Blocks of markdown joined into a text. */
export const doc = (...blocks: string[]): string => blocks.join('\n\n')
/** A fenced code block for a lesson text. */
export const pyBlock = (code: string): string => '```python\n' + code.replace(/^\n+|\s+$/g, '') + '\n```'
export const jsBlock = (code: string): string => '```javascript\n' + code.replace(/^\n+|\s+$/g, '') + '\n```'
/**
 * Code as it is typed in a lesson file: tag a template, backslashes stay as written
 * (Python "\n" is two characters), the common indentation and surrounding blank lines go,
 * and one final newline is kept.
 */
export function src(strings: TemplateStringsArray, ...values: unknown[]): string {
  const raw = String.raw({ raw: strings.raw }, ...values)
  const lines = raw.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length))
  return lines.map((l) => l.slice(Math.min(indent, /^ */.exec(l)![0].length))).join('\n') + '\n'
}
