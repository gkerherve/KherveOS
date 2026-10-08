// The AI tools of a technique app (<app>_open_file, _open_example,
// _list_sheets, _select_sheet, _run, _get_results, _export): names, arguments
// and descriptions are in src/os/ai/manifests/technique.ts. Every change goes
// through the engine's requests — `run` sets the analysis window's controls
// and runs the handler its button runs — so the window, the plot and Undo
// follow, exactly as when the user does it.

import type { AppTools } from '@/os/ai/appTools'
import { waitUntil } from '@/os/ai/appTools'
import { fs, HOME } from '@/os'
import { basename, dirname, join } from '@/os/path'
import type { Answer } from '@/apps/khervefitting/bridge'
import type { TechDoc } from './doc'
import type { TechAppSpec } from './spec'
import type { ActionTable } from './actions'

type Args = Record<string, unknown>

export interface TechAiDeps {
  doc: TechDoc
  spec: TechAppSpec
  actions?: ActionTable
  open: (path: string) => Promise<boolean>
  examples: () => Promise<string[]>
  examplesDir: string
}

const text = (a: Args, k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)
const number = (a: Args, k: string) => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : typeof a[k] === 'string' && (a[k] as string).trim() && Number.isFinite(Number(a[k])) ? Number(a[k]) : undefined)
const home = (p: string) => (p.startsWith('~/') ? join(HOME, p.slice(2)) : p === '~' ? HOME : p)

async function ready(doc: TechDoc, signal?: AbortSignal) {
  const ok = await waitUntil(() => doc.state.ready, 120_000, signal, 200)
  if (!ok) throw new Error('The app is still starting (Python). Try again in a moment.')
  await doc.bridge.idle()
}

async function call(doc: TechDoc, op: string, args: Args = {}): Promise<Answer> {
  const a = await doc.call(op, args)
  if (!a.ok) throw new Error(a.error ?? `Could not do "${op}".`)
  return a
}

function project(doc: TechDoc) {
  const s = doc.state
  return { file: s.file || null, sheets: s.sheets, current: s.sheet || null }
}

function needProject(doc: TechDoc, name: string) {
  if (!doc.state.sheets.length) throw new Error(`No project is open in ${name}. Use open_example or open_file first.`)
}

function sheetName(doc: TechDoc, a: Args): string | undefined {
  const want = text(a, 'sheet')
  if (!want) return undefined
  const s = doc.state.sheets
  const found = s.find((x) => x === want) ?? s.find((x) => x.toLowerCase() === want.toLowerCase())
  if (!found) throw new Error(`There is no sheet "${want}". The sheets are: ${s.join(', ')}.`)
  return found
}

export function techAiTools({ doc, spec, actions, open, examples, examplesDir }: TechAiDeps): AppTools {
  return {
    open_file: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const path = text(a, 'path')
      if (!path) throw new Error('Give the path of the file.')
      const p = home(path)
      if (!fs.isFile(p)) throw new Error(`There is no file ${path}.`)
      if (!(await open(p))) throw new Error(`${basename(p)} could not be opened.`)
      return project(doc)
    },
    open_example: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const files = await examples()
      const want = text(a, 'name')
      if (!want) return { examples: files }
      const low = want.toLowerCase()
      const file = files.find((f) => f.toLowerCase() === low) ?? files.find((f) => f.toLowerCase().includes(low)) ?? files.find((f) => low.split(/\s+/).every((w) => f.toLowerCase().includes(w)))
      if (!file) throw new Error(`No example matches "${want}". The examples are: ${files.join(', ')}.`)
      await open(join(examplesDir, file))
      return { opened: file, ...project(doc) }
    },
    list_sheets: async (_a, ctx) => {
      await ready(doc, ctx.signal)
      return { ...project(doc), technique: spec.tech }
    },
    select_sheet: async (a, ctx) => {
      await ready(doc, ctx.signal)
      needProject(doc, spec.name)
      const sheet = sheetName(doc, a)
      if (!sheet) throw new Error('Give the sheet name.')
      await call(doc, 'select', { sheet })
      return project(doc)
    },
    run: async (a, ctx) => {
      await ready(doc, ctx.signal)
      needProject(doc, spec.name)
      const name = text(a, 'action') ?? ''
      const def = actions?.[name]
      if (!def) throw new Error(`Unknown action "${name}". The actions are: ${Object.keys(actions ?? {}).join(', ')}.`)
      const options = (a.options && typeof a.options === 'object' ? a.options : {}) as Record<string, unknown>
      const low = number(a, 'low')
      const high = number(a, 'high')
      const run = { low, high, options }
      const args: Args = { call: typeof def.call === 'function' ? def.call(run) : def.call, read: def.read, set: def.set ? def.set(run) : {} }
      if (def.args) args.args = def.args(run)
      const sheet = sheetName(doc, a)
      if (sheet) args.sheet = sheet
      if (def.range && low !== undefined && high !== undefined) args.range = [low, high]
      const r = await call(doc, 'drive', args)
      return { sheet: r.sheet, messages: r.messages, results: r.read, sheets: doc.state.sheets }
    },
    get_results: async (a, ctx) => {
      await ready(doc, ctx.signal)
      needProject(doc, spec.name)
      const r = await call(doc, 'results', { sheet: sheetName(doc, a) })
      return r.results
    },
    export: async (a, ctx) => {
      await ready(doc, ctx.signal)
      needProject(doc, spec.name)
      const format = text(a, 'format') ?? 'kfit'
      const path = text(a, 'path')
      if (format === 'kfit') {
        const target = path ? home(path) : undefined
        if (target && fs.exists(target) && !(await ctx.confirm(`replace ${target}`))) throw new Error('The user kept the existing file.')
        const r = await call(doc, 'save', target ? { path: target } : {})
        return { saved: r.path }
      }
      const sheet = sheetName(doc, a) ?? doc.state.sheet
      const r = await call(doc, 'table', { sheet })
      const t = r.table as { columns: string[]; data: (number | null)[][] }
      const sep = format === 'csv' ? ',' : '\t'
      const n = Math.max(0, ...t.data.map((c) => c.length))
      const lines = [t.columns.join(sep)]
      for (let i = 0; i < n; i++) lines.push(t.data.map((c) => (c[i] === null || c[i] === undefined ? '' : String(c[i]))).join(sep))
      const dir = doc.state.file ? dirname(doc.state.file) : join(HOME, 'Documents', spec.name)
      const target = path ? home(path) : join(dir, `${sheet.replace(/[^\w.-]+/g, '_')}.${format}`)
      if (fs.exists(target) && !(await ctx.confirm(`replace ${target}`))) throw new Error('The user kept the existing file.')
      await fs.writeText(target, lines.join('\n') + '\n', { mkdirs: true })
      return { written: target, columns: t.columns, rows: n }
    },
  }
}
