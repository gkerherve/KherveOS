// KherveBook's AI tools (khervebook_list_cells, _add_cell, _edit_cell, _run,
// _open_example): what KherveAI and MCP clients can do in an open notebook.
// Names, arguments and descriptions are in src/os/ai/appManifest.ts;
// KherveBook.tsx registers these with useAppTools. Cells are numbered from 1
// for the model. Python written by an AI is shown to the user before it runs.

import { os } from '@/os'
import { appToolRegistry, clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import { pretty } from '@/os/path'
import { loadExampleIndex } from './examples'
import { isJsonCell, typeLabel, type Cell } from './format'
import { displayName, type Notebook } from './notebook'

type Args = Record<string, unknown>

const RUN_WAIT_MS = 300_000

const optText = (a: Args, k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)

async function loaded(nb: Notebook, signal?: AbortSignal) {
  if (!(await waitUntil(() => !nb.state.loading, 60_000, signal, 150))) throw new Error('The notebook is still opening. Try again in a moment.')
}

/** Cell number n (from 1) → the cell. */
function nth(nb: Notebook, n: unknown): Cell {
  const cells = nb.state.cells
  const i = typeof n === 'number' ? n - 1 : -1
  if (!Number.isInteger(i) || i < 0 || i >= cells.length) {
    throw new Error(`There is no cell ${String(n)}: the notebook has ${cells.length} cell${cells.length === 1 ? '' : 's'} (numbered from 1).`)
  }
  return cells[i]
}

const numberOf = (nb: Notebook, id: string) => nb.state.cells.findIndex((c) => c.id === id) + 1

/** What a cell's run gave: printed text and results, the error, and how many figures. */
function outcome(nb: Notebook, c: Cell, max = 4000) {
  let text = ''
  let error: string | null = null
  let figures = 0
  for (const o of c.outputs) {
    if (o.kind === 'stream') text += o.text
    else if (o.kind === 'result') text += `${o.text}\n`
    else if (o.kind === 'image') figures++
    else if (o.kind === 'error') error = `${o.ename}: ${o.evalue}`
  }
  text = text.trim()
  return {
    cell: numberOf(nb, c.id),
    ok: !error,
    ...(text && { output: clipText(text, max) }),
    ...(error && { error }),
    ...(figures && { figures }),
    ...(c.type === 'code' && !text && !error && !figures && { note: 'No output.' }),
  }
}

/** Run these cells (after the user allows their Python) and wait for them. */
async function runAndWait(nb: Notebook, cells: Cell[], ctx: { allowPython(code: string): Promise<boolean>; signal?: AbortSignal }, all = false) {
  const code = cells.filter((c) => c.type === 'code' && c.source.trim())
  if (code.length) {
    const listing = code.map((c) => (code.length > 1 ? `# cell ${numberOf(nb, c.id)}\n${c.source}` : c.source)).join('\n\n')
    if (!(await ctx.allowPython(listing))) throw new Error('The user did not allow this Python code to run.')
  }
  if (all) nb.runAll()
  else nb.runCells(cells.map((c) => c.id))
  const ids = new Set(code.map((c) => c.id))
  const done = await waitUntil(
    () => nb.state.cells.every((c) => !ids.has(c.id) || c.state === 'idle') && (!all || nb.state.pending === 0),
    RUN_WAIT_MS,
    ctx.signal,
    150,
  )
  return done
}

export function bookAiTools(nb: Notebook): AppTools {
  return {
    async new_notebook(_a, ctx) {
      await loaded(nb, ctx.signal)
      const { cells, path, origin, dirty } = nb.state
      // This window is already a new, empty notebook (KherveOS may just have opened it for this call).
      if (!path && !origin && !dirty && cells.every((c) => !c.source.trim())) return { window: ctx.windowId, cells: cells.length, new: true }
      const id = os.open('khervebook', { blank: true, _new: Date.now() })
      if (!id) throw new Error('KherveBook could not open a new window.')
      // The next khervebook_ call goes to the front window: wait until the new one takes calls.
      if (!(await appToolRegistry.waitFor('khervebook', id, 30_000, ctx.signal))) throw new Error('The new notebook window did not get ready in time.')
      return { window: id, new: true, note: 'The khervebook_ tools now work in this new notebook.' }
    },

    async list_cells(_a, ctx) {
      await loaded(nb, ctx.signal)
      const { cells, path, origin, untitled } = nb.state
      return {
        notebook: path ? pretty(path) : displayName({ path, origin, untitled }),
        ...(!path && { saved: false }),
        cells: cells.map((c, i) => {
          const errored = c.outputs.some((o) => o.kind === 'error')
          return {
            cell: i + 1,
            type: typeLabel(c).toLowerCase(),
            source: clipText(c.source, 600),
            ...(c.outputs.length && { output: errored ? 'error' : 'yes' }),
            ...(c.state !== 'idle' && { state: c.state }),
          }
        }),
      }
    },

    async add_cell(a, ctx) {
      await loaded(nb, ctx.signal)
      const type = a.type === 'markdown' ? 'markdown' : 'code'
      const source = typeof a.source === 'string' ? a.source : ''
      const count = nb.state.cells.length
      const after = typeof a.after === 'number' ? Math.max(0, Math.min(Math.round(a.after), count)) : count
      // A notebook that is just one empty code cell: fill that one instead.
      const lone = count === 1 && !nb.state.cells[0].source.trim() && nb.state.cells[0].type === 'code' && !nb.state.cells[0].outputs.length
      let id: string
      if (lone && type === 'code') {
        id = nb.state.cells[0].id
        nb.replaceSource(id, source)
      } else id = nb.addCell(type, source, after)
      const cell = nb.cell(id)!
      if (a.run !== true) return { added: numberOf(nb, id), type, cells: nb.state.cells.length }
      const finished = await runAndWait(nb, [cell], ctx)
      const now = nb.cell(id)
      if (!now) throw new Error('The cell was removed while it ran.')
      return { added: numberOf(nb, id), type, ...(type === 'code' ? outcome(nb, now) : { rendered: true }), ...(!finished && { note: 'Still running.' }) }
    },

    async edit_cell(a, ctx) {
      await loaded(nb, ctx.signal)
      const cell = nth(nb, a.cell)
      if (typeof a.source !== 'string') throw new Error('"source" must be text.')
      if (cell.type === 'other') throw new Error(`Cell ${String(a.cell)} is a ${typeLabel(cell)} cell made by the desktop app; it cannot be edited here.`)
      if (isJsonCell(cell.type)) throw new Error(`Cell ${String(a.cell)} is a ${typeLabel(cell)} cell: it is edited in its own view (or its app), not as text.`)
      nb.replaceSource(cell.id, a.source)
      return { edited: numberOf(nb, cell.id), type: typeLabel(cell).toLowerCase(), note: 'Not run: khervebook_run runs it.' }
    },

    async run(a, ctx) {
      await loaded(nb, ctx.signal)
      if (a.cell === undefined) {
        if (!nb.state.cells.some((c) => c.type === 'code' && c.source.trim())) {
          throw new Error('The notebook has no code to run: khervebook_add_cell adds a cell (with "run": true it runs at once).')
        }
        const finished = await runAndWait(nb, nb.state.cells, ctx, true)
        const results = nb.state.cells.filter((c) => c.type === 'code' && c.source.trim()).map((c) => outcome(nb, c, 1500))
        const failed = results.filter((r) => !r.ok).map((r) => r.cell)
        return {
          ran: 'all cells (Python restarted first)',
          results: results.slice(0, 40),
          ...(failed.length && { failed_cells: failed }),
          ...(!finished && { note: 'Some cells are still running.' }),
        }
      }
      const cell = nth(nb, a.cell)
      const finished = await runAndWait(nb, [cell], ctx)
      const now = nb.cell(cell.id)
      if (!now) throw new Error('The cell was removed while it ran.')
      if (now.type !== 'code') return { cell: numberOf(nb, now.id), rendered: true }
      return { ...outcome(nb, now), ...(!finished && { note: 'Still running.' }) }
    },

    async open_example(a, ctx) {
      const index = await loadExampleIndex()
      const all = index.categories.flatMap((cat) => cat.notebooks.map((n) => ({ ...n, category: cat.name })))
      const title = optText(a, 'title')?.toLowerCase()
      if (!title) {
        return { examples: index.categories.map((cat) => ({ category: cat.name, titles: cat.notebooks.map((n) => n.title) })) }
      }
      const found = all.find((n) => n.title.toLowerCase() === title) ?? all.find((n) => n.title.toLowerCase().includes(title))
      if (!found) {
        const words = title.split(/\s+/).filter((w) => w.length > 2)
        const near = all.filter((n) => words.some((w) => n.title.toLowerCase().includes(w))).map((n) => n.title)
        throw new Error(
          `No example is called "${optText(a, 'title')}". ${near.length ? `Close ones: ${near.slice(0, 12).join('; ')}.` : 'khervebook_open_example without a title lists them.'}`,
        )
      }
      // Asks the user first if the notebook shown has unsaved changes.
      const ok = await nb.openExample(found.file, found.title)
      if (!ok) throw new Error(`"${found.title}" was not opened (the user kept the current notebook, or it could not be loaded).`)
      await loaded(nb, ctx.signal)
      return { opened: found.title, category: found.category, cells: nb.state.cells.length, note: 'Its cells are running; khervebook_list_cells shows them.' }
    },
  }
}
