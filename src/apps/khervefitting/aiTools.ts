// KherveFitting's AI tools (khervefitting_list_core_levels, _select_core_level,
// _set_background, _add_peak, _fit, _get_peaks, _get_results, _open_example):
// what KherveAI and MCP clients can do in an open KherveFitting window — the
// main tools of the desktop dev-AI MCP table (libraries/MCP/mcp_tools.py:
// list_sheets, select_sheet, set_background, set_peaks, fit, get_peaks,
// export_results, open_project). Names, arguments and descriptions are in
// src/os/ai/appManifest.ts; KherveFitting.tsx registers these with useAppTools.
// Every change goes through the same Python requests as the window's buttons,
// so Undo works and the plot follows.

import type { AppTools } from '@/os/ai/appTools'
import { waitUntil } from '@/os/ai/appTools'
import type { Answer } from './bridge'
import type { Doc } from './doc'
import type { ExampleMenu } from './examples'
import { peaksOf, sampleOf, type View } from './model'

type Args = Record<string, unknown>

export interface AiDeps {
  doc: Doc
  open: (path: string) => Promise<boolean>
  openExample: (file: string, title: string) => Promise<void>
  examples: () => Promise<ExampleMenu[]>
}

const text = (a: Args, k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)
const number = (a: Args, k: string) => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : typeof a[k] === 'string' && Number.isFinite(Number(a[k])) && (a[k] as string).trim() ? Number(a[k]) : undefined)

async function ready(doc: Doc, signal?: AbortSignal) {
  const ok = await waitUntil(() => !!doc.state.view && !doc.state.loading, 120_000, signal, 200)
  if (!ok) throw new Error('KherveFitting is still starting (Python). Try again in a moment.')
  await doc.bridge.idle()
}

function viewOf(doc: Doc): View {
  const v = doc.state.view
  if (!v || !v.sheets.length) throw new Error('No file is open in KherveFitting. Use khervefitting_open_example, or open a workbook / VAMAS file first.')
  return v
}

async function call(doc: Doc, op: string, args: Args = {}): Promise<Answer> {
  const a = await doc.call(op, args)
  if (!a.ok) throw new Error(a.error ?? `KherveFitting could not do "${op}".`)
  return a
}

async function onSheet(doc: Doc, a: Args) {
  const v = viewOf(doc)
  const want = text(a, 'sheet')
  if (!want || want === v.sheet) return v
  const name = v.sheets.find((s) => s === want) ?? v.sheets.find((s) => s.toLowerCase() === want.toLowerCase())
  if (!name) throw new Error(`There is no core level "${want}". The sheets are: ${v.sheets.join(', ')}.`)
  await call(doc, 'select', { sheet: name })
  return viewOf(doc)
}

function peakTable(v: View) {
  return peaksOf(v.grid).map((p) => {
    const row = v.grid[p.index * 2]
    const cons = v.grid[p.index * 2 + 1] ?? []
    return {
      id: p.letter, label: p.label, position: row[2], height: row[3], fwhm: row[4], lg: row[5], area: row[6], model: row[13],
      conc: row[10], constraints: { position: cons[2], height: cons[3], fwhm: cons[4], lg: cons[5], area: cons[6] },
    }
  })
}

function summary(v: View) {
  const xs = (v.x ?? []).filter((x): x is number => x !== null)
  return {
    sheet: v.sheet,
    sample: sampleOf(v.sheet),
    be_range: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
    points: xs.length,
    background: v.background?.type ? { method: v.background.type, low: v.background.low, high: v.background.high, regions: v.background.ranges.length } : null,
    peaks: v.grid.length / 2,
  }
}

export function fittingAiTools(d: AiDeps): AppTools {
  const { doc } = d
  return {
    list_core_levels: async (_a, ctx) => {
      await ready(doc, ctx.signal)
      const v = viewOf(doc)
      return { file: doc.state.path ?? doc.state.untitled, shown: v.sheet, sheets: v.sheets, current: summary(v) }
    },
    select_core_level: async (a, ctx) => {
      await ready(doc, ctx.signal)
      return summary(await onSheet(doc, a))
    },
    set_background: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const v = await onSheet(doc, a)
      const xs = (v.x ?? []).filter((x): x is number => x !== null)
      if (!xs.length) throw new Error(`${v.sheet} has no data.`)
      const lo = number(a, 'low') ?? Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) / 15
      const hi = number(a, 'high') ?? Math.min(...xs) + (14 * (Math.max(...xs) - Math.min(...xs))) / 15
      const method = text(a, 'method') ?? 'Smart'
      const r = await call(doc, 'background', {
        method, low: Math.min(lo, hi), high: Math.max(lo, hi), offsetLow: number(a, 'offset_low') ?? 0, offsetHigh: number(a, 'offset_high') ?? 0,
        record: 'replace',
      })
      return { sheet: v.sheet, background: r.view?.background ? { method: r.view.background.type, low: r.view.background.low, high: r.view.background.high } : null }
    },
    add_peak: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const v = await onSheet(doc, a)
      if (!v.background?.type) throw new Error(`${v.sheet} has no background yet: call khervefitting_set_background first.`)
      const model = text(a, 'model')
      const x = number(a, 'position')
      const args: Args = {}
      if (model) args.model = model
      if (x !== undefined) {
        // Height above the background from the data at that position, as a click on the plot.
        const xs = v.x ?? []
        let best = -1
        let bd = Infinity
        xs.forEach((xi, i) => {
          if (xi !== null && Math.abs(xi - x) < bd) {
            bd = Math.abs(xi - x)
            best = i
          }
        })
        args.x = x
        args.y = number(a, 'height') !== undefined && best >= 0 ? (v.bkg?.[best] ?? 0) + number(a, 'height')! : (v.y?.[best] ?? 0)
      }
      const r = await call(doc, 'add_peak', args)
      let after = viewOf(doc)
      const index = typeof r.index === 'number' ? r.index : after.grid.length / 2 - 1
      const label = text(a, 'label')
      if (label) {
        await call(doc, 'set_cell', { row: index * 2, col: 1, text: label })
        after = viewOf(doc)
      }
      for (const [k, col] of [['fwhm', 4], ['lg', 5]] as const) {
        const val = number(a, k)
        if (val !== undefined) await call(doc, 'set_cell', { row: index * 2, col, text: String(val) })
      }
      after = viewOf(doc)
      return { sheet: after.sheet, added: peakTable(after)[index], peaks: after.grid.length / 2 }
    },
    fit: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const v = await onSheet(doc, a)
      if (!v.grid.length) throw new Error(`${v.sheet} has no peaks to fit: add peaks first.`)
      const passes = number(a, 'passes') ?? 6
      const r = await call(doc, 'fit', passes <= 1 ? { mode: 'once' } : { mode: 'stable', stable: passes, maxPasses: number(a, 'max_passes') ?? 40 })
      const after = viewOf(doc)
      const log = (r.log as { chi?: number; r2: number; redChi2: number }[] | undefined) ?? []
      doc.set({ fitLog: log as never })
      return { sheet: after.sheet, chi: after.stats?.Chi ?? log.at(-1)?.chi ?? null, r2: after.stats?.R2 ?? log.at(-1)?.r2 ?? null, red_chi2: after.stats?.RedChi ?? log.at(-1)?.redChi2 ?? null, passes: log.length, peaks: peakTable(after) }
    },
    get_peaks: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const v = await onSheet(doc, a)
      return { ...summary(v), fit: v.stats ?? null, peaks: peakTable(v) }
    },
    get_results: async (a, ctx) => {
      await ready(doc, ctx.signal)
      const v = await onSheet(doc, a)
      if (a.export === true && v.grid.length) await call(doc, 'export')
      const after = viewOf(doc)
      return {
        sample: sampleOf(after.sheet),
        rows: (after.resultsGrid ?? []).map((r) => ({ name: r.cells[0], position: r.cells[1], fwhm: r.cells[3], area: r.cells[5], atomic_percent: r.cells[6], counted: r.checked, rsf: r.cells[8], sheet: r.cells[21], weight_percent: r.cells[29] })),
      }
    },
    open_example: async (a, ctx) => {
      const menus = await d.examples()
      const all = menus.flatMap((m) => [...m.items, ...m.groups.flatMap((g) => g.items)])
      const want = text(a, 'name')
      if (!want) return { examples: all.map((x) => x.title) }
      const lc = want.toLowerCase()
      const hit = all.find((x) => x.title.toLowerCase() === lc) ?? all.find((x) => x.title.toLowerCase().includes(lc) || x.file.toLowerCase().includes(lc))
      if (!hit) throw new Error(`No example matches "${want}". Some are: ${all.slice(0, 25).map((x) => x.title).join(', ')}…`)
      if (doc.state.dirty && !(await ctx.confirm(`open the example "${hit.title}" in KherveFitting`, 'The open workbook has unsaved changes; they will be lost.'))) {
        throw new Error('The user kept the open workbook.')
      }
      doc.set({ dirty: false })
      await d.openExample(hit.file, hit.title)
      await ready(doc, ctx.signal)
      const v = viewOf(doc)
      return { opened: hit.title, sheets: v.sheets, shown: v.sheet }
    },
  }
}
