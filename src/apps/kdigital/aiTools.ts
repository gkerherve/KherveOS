// AI tools of kDigital (the manifest is src/os/ai/manifests/kdigital.ts). Written against a small set of hooks the
// window provides, so the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { format, ParseError, variables } from './expr.ts'
import { EXAMPLES, exampleById, type Example } from './examples.ts'
import { type KdigFile, type Step, type TabId } from './file.ts'
import { extractNets } from './netlist.ts'
import { hazardNote, kmapGroups, kmapLayout } from './kmap.ts'
import { expressionsToDoc, type LogicStyle } from './layout.ts'
import { implicantBits, termNode } from './qmc.ts'
import { DEFAULT_SIM, readSettings, type SimSettings } from './sim.ts'
import { probesOrDefault, runSpec, summarizeRun } from './session.ts'
import { analyse, onSet, parseFunctions, MAX_VARS, type FunctionSet } from './truth.ts'
import { parseStimulus, type Probe } from './wave.ts'
import { defOf, signalName, type Doc } from './model.ts'
import type { Fsm } from './fsm.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { doc: Doc; settings: SimSettings; name: string; tab: TabId; booleanText: string; fsm: Fsm; dirty: boolean; probes: Probe[]; stimulus: Step[]; until: number }
  /** Puts expressions in the Boolean tab and shows it. */
  showBoolean(text: string, style: LogicStyle, focus?: string): void
  /** Replaces the circuit (one undo step) and shows it. */
  applyCircuit(doc: Doc, name: string): void
  /** Shows a finished run in the timing diagram. */
  showRun(steps: Step[], until: number, settings: SimSettings): void
  openExample(ex: Example): Promise<void>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const STYLES: LogicStyle[] = ['as-is', 'sop', 'pos', 'nand', 'nor']

/** What the AI sees of a circuit. */
export function describeCircuit(doc: Doc) {
  const ex = extractNets(doc)
  const gates: Record<string, number> = {}
  for (const p of doc.parts) gates[defOf(p).name] = (gates[defOf(p).name] ?? 0) + 1
  return {
    inputs: doc.parts.filter((p) => p.kind === 'switch' || p.kind === 'button' || p.kind === 'clock').map((p) => ({ name: signalName(p) || p.ref, kind: p.kind })),
    outputs: doc.parts.filter((p) => ['led', 'seg7', 'hex', 'probe'].includes(p.kind)).map((p) => ({ name: signalName(p) || p.ref, kind: p.kind })),
    parts: gates,
    partCount: doc.parts.length,
    nets: ex.nets.length,
    problems: ex.problems.filter((q) => q.level !== 'info').map((q) => ({ level: q.level, message: q.message })),
  }
}

/** The result of a set_expression call (also used by the tests). */
export function analyseExpressions(text: string): {
  set: FunctionSet
  results: {
    name: string
    variables: string[]
    minterms: number[]
    dontCares: number[]
    truthTable?: string[]
    canonicalSOP: string
    canonicalPOS: string
    minimalSOP: string
    minimalPOS: string
    primeImplicants: string[]
    essential: string[]
    kmap?: { groups: { term: string; cells: number[] }[]; hazards: string }
  }[]
} {
  const set = parseFunctions(text)
  if (set.errors.length && set.table.outputs.length === 0) throw new Error(set.errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(' '))
  if (set.table.vars.length > MAX_VARS) throw new Error(`At most ${MAX_VARS} variables are supported.`)
  const vars = set.table.vars
  const results = set.table.outputs.map((o) => {
    const a = analyse(vars, o.name, o.values)
    const term = (i: Parameters<typeof implicantBits>[0]) => `${implicantBits(i, vars.length)} = ${format(termNode(i, vars), 'prime')}`
    const rows = vars.length <= 4 ? o.values.map((v, r) => `${r.toString(2).padStart(vars.length, '0')} → ${v === 2 ? 'X' : v}`) : undefined
    let kmap: { groups: { term: string; cells: number[] }[]; hazards: string } | undefined
    if (vars.length >= 2 && vars.length <= 5) {
      const layout = kmapLayout(vars)
      kmap = {
        groups: kmapGroups(a.min.sop.cover, layout).map((g) => ({ term: format(implicantTerm(g.implicant, vars), 'prime'), cells: g.implicant.minterms })),
        hazards: hazardNote(a.min.sop, vars, (i) => format(implicantTerm(i, vars), 'prime')),
      }
    }
    return {
      name: o.name, variables: vars, minterms: a.on, dontCares: a.dc, truthTable: rows,
      canonicalSOP: format(a.canonicalSop, 'prime'), canonicalPOS: format(a.canonicalPos, 'prime'),
      minimalSOP: format(a.min.sopNode, 'prime'), minimalPOS: format(a.min.posNode, 'prime'),
      primeImplicants: a.min.sop.primes.map((p) => term(p)), essential: a.min.sop.essential.map((p) => format(implicantTerm(p, vars), 'prime')), kmap,
    }
  })
  return { set, results }
}

const implicantTerm = termNode

export function kdigitalTools(h: Hooks): Tools {
  return {
    get_state: async (a) => {
      const s = h.state()
      const what = String(a.what ?? 'summary')
      const base = { tab: s.tab, name: s.name, unsavedChanges: s.dirty }
      const circuit = describeCircuit(s.doc)
      if (what === 'circuit') return { ...base, circuit, probes: s.probes.map((p) => ({ name: p.name, bits: p.bits })), delayMode: s.settings.delayMode, stimulus: s.stimulus, until: s.until }
      if (what === 'boolean') {
        try { const r = analyseExpressions(s.booleanText); return { ...base, text: s.booleanText, functions: r.results.map((x) => ({ name: x.name, minimalSOP: x.minimalSOP, minimalPOS: x.minimalPOS })) } } catch (e) { return { ...base, text: s.booleanText, error: msg(e) } }
      }
      if (what === 'fsm') return { ...base, fsm: { name: s.fsm.name, type: s.fsm.type, inputs: s.fsm.inputs, outputs: s.fsm.outputs, states: s.fsm.states.map((x) => x.name), transitions: s.fsm.transitions.length } }
      return { ...base, circuit, booleanText: s.booleanText, fsm: s.fsm.states.length ? { name: s.fsm.name, states: s.fsm.states.length } : null, examples: EXAMPLES.length, note: 'Call get_state with what = circuit, boolean or fsm for details; load_example lists the examples.' }
    },

    set_expression: async (a, ctx) => {
      const text = String(a.expression ?? '').trim()
      if (!text) throw new Error('expression: give a Boolean expression such as "F = A & B | !C" or "F(A,B,C,D) = Σm(1,3,5,7) + d(0)" (one function per line).')
      const style = STYLES.includes(String(a.style) as LogicStyle) ? (String(a.style) as LogicStyle) : 'as-is'
      let analysed
      try { analysed = analyseExpressions(text) } catch (e) { throw new Error(e instanceof ParseError ? `${e.message} (at character ${e.pos + 1})` : msg(e)) }
      const first = analysed.results[0]
      h.showBoolean(text, style, first?.name)
      const out: Record<string, unknown> = { functions: analysed.results, parseErrors: analysed.set.errors.map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)) }
      if (a.build_circuit === true) {
        if (!(await ctx.confirm('Replace the circuit', 'kDigital draws gates for these expressions and replaces the current schematic (you can undo).'))) throw new Error('The user did not allow replacing the circuit.')
        // an expression as typed is drawn as typed (or minimised, for the other styles); a minterm list is drawn as its minimal sum of products
        const outputs = analysed.set.table.outputs.map((o) => {
          const given = analysed.set.specs.find((sp) => sp.name === o.name && sp.node)
          return { name: o.name, expr: given ? given.node! : analyse(analysed.set.table.vars, o.name, o.values).min.sopNode }
        })
        const built = expressionsToDoc(outputs, style)
        h.applyCircuit(built.doc, first?.name ?? 'Logic')
        out.circuit = { gates: built.summary.gates, counts: built.summary.counts, inputs: built.summary.inputs }
      }
      return out
    },

    simulate: async (a) => {
      const s = h.state()
      let doc = s.doc
      let name = s.name
      let settings = s.settings
      let steps: Step[] = s.stimulus
      let until = s.until
      let probes: Probe[] | undefined = s.probes
      const exampleId = String(a.example ?? '').trim()
      if (exampleId) {
        const ex = exampleById(exampleId) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(exampleId.toLowerCase()))
        if (!ex) throw new Error(`No example “${exampleId}”: call load_example without an id to list them.`)
        const f: KdigFile = ex.build()
        doc = f.circuit!; name = ex.title; settings = { ...DEFAULT_SIM, ...readSettings(f.sim) }; steps = f.stimulus ?? []; until = f.until ?? 100; probes = f.probes
      } else if (typeof a.expression === 'string' && a.expression.trim()) {
        const r = analyseExpressions(a.expression)
        const outs = r.set.specs.filter((sp) => sp.node).map((sp) => ({ name: sp.name, expr: sp.node! }))
        const defs = outs.length === r.set.specs.length ? outs : r.set.table.outputs.map((o) => ({ name: o.name, expr: analyse(r.set.table.vars, o.name, o.values).min.sopNode }))
        doc = expressionsToDoc(defs, 'as-is').doc
        name = 'Expression'; probes = undefined
        if (!(typeof a.stimulus === 'string' && a.stimulus.trim())) {
          // all input combinations
          const vars = r.set.table.vars
          steps = Array.from({ length: 1 << Math.min(vars.length, 6) }, (_, i) => ({ t: i * 20, set: Object.fromEntries(vars.map((v, k) => [v, (i >> (vars.length - 1 - k)) & 1])) }))
          until = steps.length * 20
        }
      }
      if (typeof a.stimulus === 'string' && a.stimulus.trim()) {
        const p = parseStimulus(a.stimulus)
        if (p.errors.length) throw new Error(p.errors.join(' '))
        steps = p.steps
        if (!Number.isFinite(Number(a.until))) until = Math.max(until, (p.steps[p.steps.length - 1]?.t ?? 0) + 40)
      }
      if (Number.isFinite(Number(a.until)) && Number(a.until) > 0) until = Math.min(100000, Math.round(Number(a.until)))
      if (typeof a.delay === 'string' && ['unit', 'gate', 'zero'].includes(a.delay)) settings = { ...settings, delayMode: a.delay as SimSettings['delayMode'] }
      if (doc.parts.length === 0) throw new Error('There is no circuit to simulate: load an example, build one, or pass an expression.')
      let use = probesOrDefault(doc, probes)
      const want = Array.isArray(a.signals) ? a.signals.map(String) : typeof a.signals === 'string' && a.signals.trim() ? a.signals.split(/[,;\s]+/).filter(Boolean) : []
      if (want.length) {
        const all = probesOrDefault(doc, undefined)
        const picked = want.map((w) => all.find((p) => p.name === w) ?? s.probes.find((p) => p.name === w) ?? { name: w, bits: [w] })
        use = picked
      }
      const sim = runSpec({ doc, settings, steps, until })
      const sum = summarizeRun(sim, use, until)
      h.showRun(steps, until, settings)
      return { circuit: name, delayMode: settings.delayMode, ...sum, note: 'The waveforms are also shown in the Timing diagram of kDigital. Samples are one per step time units; changes lists every change.' }
    },

    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, group: e.group, about: e.description })), note: 'Call load_example with an id to open one.' }
      const ex = exampleById(id) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(id.toLowerCase()))
      if (!ex) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      if (h.state().dirty && !(await ctx.confirm('Replace the current work', `Opening the “${ex.title}” example replaces the current kDigital document, which has unsaved changes.`))) throw new Error('The user did not allow replacing the unsaved work.')
      await h.openExample(ex)
      const s = h.state()
      return { loaded: ex.title, description: ex.description, tab: s.tab, circuit: describeCircuit(s.doc) }
    },
  }
}

export { onSet, variables }
