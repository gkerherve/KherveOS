// KhervePY's AI tools (khervepy_read, _set_code, _replace, _open_file, _run,
// _save): names, arguments and descriptions are in src/os/ai/appManifest.ts;
// KhervePY.tsx registers these with useAppTools. Edits change the text in
// the editor tab (like typing; auto-save applies); khervepy_run saves and
// runs the file after the user allows it.

import { fs, path, HOME } from '@/os'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import { isDirty, type EditorTab, type Editors } from './editors'
import type { RunResult } from './runner'

export interface PyAiHost {
  /** The editors as they are after the latest render. */
  editors(): Editors
  project(): string
  /** Show the Output panel. */
  showOutput(): void
  clearOutput(): void
  running(): boolean
  run(file: string, cwd: string, label: string): Promise<RunResult>
}

const MAX_READ = 60_000

export function khervepyAiTools(host: PyAiHost): AppTools {
  const tabOf = (p: string) => host.editors().tabs.find((t) => t.path === p) ?? null

  const active = (): EditorTab => {
    const t = host.editors().active
    if (!t) throw new Error('No file is open in kPY: open one with khervepy_open_file (create=true for a new one).')
    return t
  }

  /** Open (or create) a file in a tab, and wait for the tab to appear. */
  const openTab = async (given: string, create: boolean, signal?: AbortSignal): Promise<EditorTab> => {
    if (/[\\/]\s*$/.test(given)) throw new Error(`"${given}" is a folder: add the file name.`)
    const p = drivePath(given)
    if (fs.isDir(p)) throw new Error(`${path.pretty(p)} is a folder.`)
    if (!fs.exists(p)) {
      if (!create) throw new Error(`${path.pretty(p)} does not exist (pass create=true to make it).`)
      await fs.writeText(p, '', { mkdirs: true })
    }
    if (!(await host.editors().open(p))) throw new Error(`kPY could not open ${path.pretty(p)}.`)
    if (!(await waitUntil(() => host.editors().active?.path === p && !!tabOf(p), 10_000, signal))) throw new Error(`${path.pretty(p)} did not open in time.`)
    return tabOf(p)!
  }

  /** Change a tab's text and wait until the editor has it (saving reads the latest state). */
  const setText = async (tab: EditorTab, text: string, signal?: AbortSignal) => {
    host.editors().setText(tab.id, text)
    await waitUntil(() => host.editors().tabs.find((t) => t.id === tab.id)?.text === text, 5000, signal)
  }

  const lines = (t: string) => (t ? t.split('\n').length : 0)

  return {
    async read(a) {
      const t = typeof a.path === 'string' && a.path.trim() ? tabOf(drivePath(a.path)) : host.editors().active
      if (!t) throw new Error(typeof a.path === 'string' ? `${a.path} is not open in kPY (khervepy_open_file opens it).` : 'No file is open in kPY.')
      return {
        path: t.path ? path.pretty(t.path) : null,
        unsaved_changes: isDirty(t),
        lines: lines(t.text),
        text: clipText(t.text, MAX_READ),
        open_tabs: host.editors().tabs.map((x) => (x.path ? path.pretty(x.path) : x.title)),
        project: path.pretty(host.project()),
      }
    },

    async set_code(a, ctx) {
      const code = String(a.code ?? '')
      const tab = typeof a.path === 'string' && a.path.trim() ? await openTab(a.path.trim(), true, ctx.signal) : active()
      await setText(tab, code, ctx.signal)
      return { path: tab.path ? path.pretty(tab.path) : tab.title, lines: lines(code), saved: false, note: 'Shown in the kPY editor; khervepy_run saves and runs it.' }
    },

    async replace(a, ctx) {
      const tab = active()
      const find = String(a.find ?? '')
      if (!find) throw new Error('"find" is empty.')
      const by = String(a.replace ?? '')
      const count = tab.text.split(find).length - 1
      if (!count) throw new Error(`"${clipText(find, 200)}" is not in ${tab.title} (the match is exact). khervepy_read shows the text.`)
      const next = a.all === true ? tab.text.split(find).join(by) : tab.text.replace(find, () => by)
      await setText(tab, next, ctx.signal)
      return { replaced: a.all === true ? count : 1, matches: count, saved: false }
    },

    async open_file(a, ctx) {
      const tab = await openTab(String(a.path ?? ''), a.create === true, ctx.signal)
      return { opened: tab.path ? path.pretty(tab.path) : tab.title, lines: lines(tab.text) }
    },

    async run(a, ctx) {
      if (host.running()) throw new Error('A program is already running in kPY.')
      const tab = active()
      if (!tab.path) throw new Error('This file has never been saved: save it with a path first (khervepy_set_code with "path").')
      if (!tab.path.endsWith('.py')) throw new Error('Only .py files run.')
      if (!path.isInside(tab.path, HOME)) throw new Error('Python can only run files in the home folder (~).')
      if (!(await ctx.allowPython(tab.text))) throw new Error('The user did not allow running this file.')
      const eds = host.editors()
      if (isDirty(tab) && !(await eds.save(tab.id))) throw new Error('The file could not be saved.')
      await eds.flush()
      const project = host.project()
      const cwd = path.isInside(project, HOME) ? project : path.dirname(tab.path)
      host.showOutput()
      host.clearOutput()
      const label = path.isInside(tab.path, cwd) ? tab.path.slice(cwd.length + 1) : tab.path
      const r = await host.run(tab.path, cwd, label)
      const max = typeof a.max_chars === 'number' && a.max_chars > 0 ? a.max_chars : 8000
      return {
        file: path.pretty(tab.path),
        exit_code: r.exitCode,
        ...(r.stopped && { stopped: true }),
        stdout: clipText(r.stdout ?? '', max),
        ...(r.stderr && { stderr: clipText(r.stderr, Math.max(2000, max / 2)) }),
        ...(r.figures && { figures: r.figures }),
      }
    },

    async save(a) {
      const eds = host.editors()
      if (a.all === true) {
        if (!(await eds.saveAll())) throw new Error('Not every file was saved.')
        return { saved: eds.tabs.map((t) => (t.path ? path.pretty(t.path) : t.title)) }
      }
      const tab = active()
      if (!tab.path) throw new Error('This file has never been saved: use khervepy_set_code with a "path" to give it one.')
      const p = await eds.save(tab.id)
      if (!p) throw new Error('The file was not saved.')
      return { saved: path.pretty(p) }
    },
  }
}
