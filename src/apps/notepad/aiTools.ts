// Notepad's AI tools (notepad_read, _set_text, _replace, _insert, _save):
// names, arguments and descriptions are in src/os/ai/appManifest.ts;
// Notepad.tsx registers these with useAppTools. Edits change the text in the
// editor (unsaved, like typing); notepad_save writes the file.

import { fs } from '@/os'
import { dirname, pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'

export interface NotepadDoc {
  /** The latest document state (updated at once by setText / markSaved). */
  get(): { text: string; saved: string; filePath: string | null; loading: boolean }
  setText(text: string): void
  markSaved(path: string, text: string): void
}

const MAX_READ = 40_000

export function notepadAiTools(doc: NotepadDoc): AppTools {
  const ready = async (signal?: AbortSignal) => {
    if (!(await waitUntil(() => !doc.get().loading, 30_000, signal))) throw new Error('kText is still opening the file. Try again in a moment.')
  }
  const lineCount = (t: string) => (t ? t.split('\n').length : 0)

  return {
    async read(_a, ctx) {
      await ready(ctx.signal)
      const { text, saved, filePath } = doc.get()
      return {
        path: filePath ? pretty(filePath) : null,
        ...(!filePath && { note: 'A new document, never saved.' }),
        unsaved_changes: text !== saved,
        lines: lineCount(text),
        text: clipText(text, MAX_READ),
        ...(text.length > MAX_READ && { truncated: true }),
      }
    },

    async set_text(a, ctx) {
      await ready(ctx.signal)
      const text = String(a.text ?? '')
      doc.setText(text)
      return { lines: lineCount(text), characters: text.length, saved: false }
    },

    async replace(a, ctx) {
      await ready(ctx.signal)
      const find = String(a.find ?? '')
      if (!find) throw new Error('"find" is empty.')
      const by = String(a.replace ?? '')
      const { text } = doc.get()
      const count = text.split(find).length - 1
      if (!count) throw new Error(`"${clipText(find, 200)}" is not in the document (the match is exact, case included). notepad_read shows the text.`)
      const next = a.all === true ? text.split(find).join(by) : text.replace(find, () => by)
      doc.setText(next)
      return { replaced: a.all === true ? count : 1, matches: count, saved: false }
    },

    async insert(a, ctx) {
      await ready(ctx.signal)
      const add = String(a.text ?? '')
      const { text } = doc.get()
      const lines = text.split('\n')
      let next: string
      let at: number
      if (typeof a.line === 'number' && a.line >= 1 && a.line <= lines.length) {
        at = Math.round(a.line)
        const offset = lines.slice(0, at - 1).reduce((n, l) => n + l.length + 1, 0)
        next = text.slice(0, offset) + add + text.slice(offset)
      } else {
        // At the end, on a line of its own.
        at = text && !text.endsWith('\n') ? lines.length + 1 : Math.max(1, lines.length)
        next = text && !text.endsWith('\n') ? `${text}\n${add}` : text + add
      }
      doc.setText(next)
      return { inserted_at_line: at, lines: lineCount(next), saved: false }
    },

    async save(a, ctx) {
      await ready(ctx.signal)
      const { text, filePath } = doc.get()
      const given = typeof a.path === 'string' && a.path.trim() ? a.path.trim() : null
      if (!given && !filePath) throw new Error('This document has never been saved: give "path", e.g. "~/Documents/notes.txt".')
      if (given && /[\\/]\s*$/.test(given)) throw new Error(`"${given}" is a folder: add the file name.`)
      const p = given ? drivePath(given) : filePath!
      if (fs.isDir(p)) throw new Error(`${pretty(p)} is a folder.`)
      if (!given && !fs.isDir(dirname(p))) throw new Error(`The folder of ${pretty(p)} is gone: give "path".`)
      if (p !== filePath && fs.exists(p) && !(await ctx.confirm(`replace ${pretty(p)}`, 'What is in it now will be lost.'))) {
        throw new Error(`The user did not allow replacing ${pretty(p)}.`)
      }
      await fs.writeText(p, text, { mkdirs: true })
      doc.markSaved(p, text)
      return { saved: pretty(p), characters: text.length }
    },
  }
}
