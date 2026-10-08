// AI tools of kReaction (the manifest is src/os/ai/manifests/kreaction.ts). Each call also shows what it did in
// the window. The calculations are in aiCore.ts.

import type { MainModule } from '@rdkit/rdkit'
import { os, HOME } from '@/os'
import type { useAppTools } from '@/os/ai/appTools'
import {
  describeReaction, exampleDetails, fitRequest, kineticsRequest, listExamples, predictionAnswer, reactionRequest, runEquilibrium, runFit, runKinetics, speciesList,
} from './aiCore'
import { findCompound } from './compounds'
import { toMarkdown } from './notebook'
import { isValidSmiles, predictAll } from './rdengine'
import type { ArrowKind } from './reaction'
import { resolveHooks } from './structures'
import { TEMPLATES } from './templates'
import type { ToolId, Workspace } from './workspace'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  ws(): Workspace
  update(fn: (w: Workspace) => Workspace): void
  go(tool: ToolId): void
  loadReaction(id: string, into: 'builder' | 'mechanism' | 'energy'): void
  setReaction(r: { reactants: string[]; products: string[]; arrow?: ArrowKind; above?: string; below?: string; coeffs?: number[] | null }, show?: boolean): void
  /** Waits for RDKit (null if it cannot run here). */
  rd(): Promise<MainModule | null>
  /** The Markdown report of the reaction in the builder. */
  reportText(): Promise<string>
}

export function kreactionTools(h: Hooks): Tools {
  return {
    set_reaction: async (a) => {
      const req = reactionRequest(a)
      const hooks = resolveHooks(await h.rd())
      if (!req) {
        // no arguments: describe the reaction in the builder
        const b = h.ws().builder
        const rows = [...b.reactants, ...b.products]
        const given = b.coeffs && b.coeffs.length === rows.length ? b.coeffs.filter((_, i) => rows[i].trim() !== '') : null
        return describeReaction({ reactants: b.reactants, products: b.products, arrow: b.arrow, above: b.above, below: b.below }, false, hooks, given).result
      }
      const ans = describeReaction(req.input, req.balance, hooks)
      const rows = req.input.reactants.length + req.input.products.length
      h.setReaction({ ...req.input, coeffs: ans.coefficients.length === rows ? ans.coefficients : null }, true)
      return ans.result
    },

    load_example: async (a) => {
      const id = String(a.id ?? '').trim()
      if (id === '') return { examples: listExamples(), tip: 'Call load_example with one of these ids.' }
      const details = exampleDetails(id)
      const into = String(a.into ?? 'builder')
      const target = into === 'mechanism' && details.mechanism ? 'mechanism' : into === 'energy' ? 'energy' : 'builder'
      h.loadReaction(id, target)
      return details
    },

    predict_products: async (a) => {
      const names = speciesList(a.reactants)
      if (names.length === 0) throw new Error('reactants: give at least one reactant (name or SMILES).')
      const rd = await h.rd()
      if (!rd) throw new Error('The reaction engine (RDKit) could not be loaded in this browser.')
      const smiles = names.map((n) => findCompound(n)?.smiles ?? n)
      const bad = smiles.filter((s) => !isValidSmiles(rd, s))
      if (bad.length) throw new Error(`RDKit cannot read: ${bad.join(', ')}. Use a SMILES string or a name from the compound table.`)
      const only = String(a.only ?? '').trim()
      const templates = only ? TEMPLATES.filter((t) => t.id === only) : TEMPLATES
      if (only && templates.length === 0) throw new Error(`Unknown template "${only}". Template ids: ${TEMPLATES.map((t) => t.id).join(', ')}.`)
      h.update((w) => ({ ...w, predict: { reactants: names } }))
      h.go('predict')
      return predictionAnswer(predictAll(rd, templates, smiles), smiles)
    },

    simulate_kinetics: async (a) => {
      const k = h.ws().kinetics
      const req = kineticsRequest(a, k)
      const result = runKinetics(req)
      h.update((w) => ({
        ...w,
        kinetics: { ...w.kinetics, tab: 'simulate', text: req.text, tEnd: String(req.tEnd), logTime: req.logTime, method: req.method, presetId: req.presetId, hidden: [] },
      }))
      h.go('kinetics')
      return result
    },

    fit_order: async (a) => {
      const req = fitRequest(a)
      const result = runFit(req)
      const table = req.x.map((x, i) => `${x}\t${req.y[i]}`).join('\n')
      h.update((w) => ({
        ...w,
        kinetics:
          req.mode === 'order'
            ? { ...w.kinetics, tab: 'order', orderData: `# t\tc\n${table}` }
            : { ...w.kinetics, tab: 'arrhenius', arrData: `# T (K)\tk\n${table}`, arrKind: req.mode },
      }))
      h.go('kinetics')
      return result
    },

    equilibrium: async (a) => {
      const result = runEquilibrium(a)
      h.update((w) => {
        const e = w.energy
        if (String(a.equation ?? '').trim() !== '') {
          return { ...w, energy: { ...e, tab: 'equilibrium', ice: { ...e.ice, equation: String(a.equation), initial: String(a.initial ?? ''), K: String(a.K), T: a.T !== undefined ? String(a.T) : e.ice.T } } }
        }
        return { ...w, energy: { ...e, tab: 'thermo', thermo: { ...e.thermo, dH: String(a.dH), dS: String(a.dS), T: String(a.T) } } }
      })
      h.go('energy')
      return result
    },

    export_report: async (a, ctx) => {
      const requested = String(a.path ?? '').trim()
      const path = requested || `${HOME}/Documents/kreaction-report.md`
      if (!/\.(md|txt)$/i.test(path)) throw new Error('path must end in .md or .txt.')
      let text = await h.reportText()
      if (a.include_notebook === true) text += `\n\n${toMarkdown(h.ws().notebook, 'Notebook')}`
      if (!(await ctx.confirm('Save a kReaction report', `Create or replace ${path}`))) throw new Error('The user did not allow writing the report.')
      await os.fs.writeText(path, text, { mkdirs: true })
      return { path, characters: text.length }
    },
  }
}
