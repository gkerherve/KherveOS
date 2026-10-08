// What a run of the learner's code produced, and how it reads as text (for the output
// pane and for the AI tools). No React, no "@/" imports.

import type { CheckResult } from './checks.ts'
import type { Language } from './lessonTypes.ts'

/** A piece of output. `out` is stdout / console.log, `err` stderr / console.error. */
export interface Seg {
  kind: 'out' | 'err' | 'warn' | 'status'
  text: string
}

export interface RunError {
  name: string
  message: string
  /** The line of the learner's code, when known. */
  line: number | null
  /** Python's full traceback. */
  traceback?: string
}

export interface RunReport {
  language: Language
  /** Ran to the end without an error (and was not stopped). */
  ok: boolean
  segs: Seg[]
  /** PNG pictures (base64) of matplotlib figures. */
  figures: string[]
  /** The value of the last expression, as text. */
  value: string | null
  error: RunError | null
  /** Results of the checks, if they were asked for and the code ran. */
  checks: CheckResult[] | null
  ms: number
  stopped: boolean
  timedOut: boolean
}

export const emptyReport = (language: Language): RunReport => ({
  language, ok: false, segs: [], figures: [], value: null, error: null, checks: null, ms: 0, stopped: false, timedOut: false,
})

/** Output beyond this is dropped (a runaway print loop must not eat the browser). */
export const MAX_OUTPUT_CHARS = 200_000

/** Add output: neighbouring pieces of the same kind are joined. Returns false once the limit is reached. */
export function pushSeg(segs: Seg[], seg: Seg): boolean {
  let size = 0
  for (const s of segs) size += s.text.length
  if (size >= MAX_OUTPUT_CHARS) return false
  const text = size + seg.text.length > MAX_OUTPUT_CHARS ? seg.text.slice(0, MAX_OUTPUT_CHARS - size) : seg.text
  const last = segs[segs.length - 1]
  if (last && last.kind === seg.kind && seg.kind !== 'status') segs[segs.length - 1] = { kind: last.kind, text: last.text + text }
  else segs.push({ kind: seg.kind, text })
  if (text.length < seg.text.length) segs.push({ kind: 'status', text: '\n(output cut short)\n' })
  return true
}

/** The error as one readable line ("NameError: name 'x' is not defined (line 3)"). */
export function errorLine(e: RunError): string {
  return `${e.name}: ${e.message}${e.line ? ` (line ${e.line})` : ''}`
}

/** Everything printed, then the value, then the error: what the AI gets back. */
export function reportText(r: RunReport, maxChars = 12_000): string {
  const parts: string[] = []
  const printed = r.segs.filter((s) => s.kind !== 'status').map((s) => s.text).join('')
  if (printed) parts.push(printed.replace(/\n+$/, ''))
  if (r.value !== null) parts.push(`=> ${r.value}`)
  if (r.figures.length) parts.push(`(${r.figures.length} figure${r.figures.length > 1 ? 's' : ''} shown)`)
  if (r.error) parts.push(r.error.traceback ? r.error.traceback : errorLine(r.error))
  if (r.timedOut) parts.push('Stopped: the code ran too long.')
  else if (r.stopped) parts.push('Stopped.')
  const text = parts.join('\n') || '(no output)'
  return text.length > maxChars ? text.slice(0, maxChars) + '\n… (cut short)' : text
}
