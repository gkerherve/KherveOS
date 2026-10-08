// The kChem notebook: calculations pinned with a label, kept in localStorage, copied or
// exported as Markdown / plain text. No React.

export interface NotebookEntry {
  id: string
  label: string
  /** The tool it came from ("Formula", "Acids & pH"…). */
  tool: string
  /** The inputs and results as plain text lines. */
  text: string
  /** Milliseconds since the epoch. */
  time: number
}

export const NOTEBOOK_KEY = 'kherveos.kchem.notebook'
export const MAX_ENTRIES = 300

export function newEntry(tool: string, label: string, text: string, time = Date.now()): NotebookEntry {
  return { id: `${time.toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: label.trim() || tool, tool, text: text.trim(), time }
}

/** The saved notebook, or [] (a private window, cleared storage or junk is fine). */
export function loadNotebook(): NotebookEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTEBOOK_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is NotebookEntry => !!e && typeof e === 'object' && typeof (e as NotebookEntry).id === 'string' && typeof (e as NotebookEntry).text === 'string')
      .map((e) => ({ id: e.id, label: String(e.label ?? ''), tool: String(e.tool ?? ''), text: e.text, time: Number(e.time) || 0 }))
      .slice(-MAX_ENTRIES)
  } catch {
    return []
  }
}

export function saveNotebook(entries: NotebookEntry[]): void {
  try {
    localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    /* private mode or full: the notebook just stays in memory */
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function stamp(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The notebook as Markdown: a heading per entry, the lines in a code block. */
export function toMarkdown(entries: NotebookEntry[], title = 'kChem notebook'): string {
  const out = [`# ${title}`, '']
  if (entries.length === 0) out.push('_Nothing pinned yet._', '')
  for (const e of entries) {
    out.push(`## ${e.label}`, '', `*${e.tool} · ${stamp(e.time)}*`, '', '```', e.text, '```', '')
  }
  return out.join('\n')
}

/** The notebook as plain text. */
export function toPlainText(entries: NotebookEntry[], title = 'kChem notebook'): string {
  const out = [title, '='.repeat(title.length), '']
  for (const e of entries) out.push(`${e.label}  [${e.tool}, ${stamp(e.time)}]`, e.text, '')
  return out.join('\n')
}

/** One entry as text to copy. */
export function entryText(e: NotebookEntry): string {
  return `${e.label}\n${e.text}`
}
