// AI tools of kElec (the manifest is src/os/ai/manifests/kelec.ts). Written against a small set of hooks
// the window provides, so the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { CALCULATORS, runCalculator } from './calc.ts'
import { circuitToDoc, buildNetlist } from './netlist.ts'
import { EXAMPLES, exampleById, type Example } from './examples.ts'
import { cloneDoc, freeSpot, stubToNet } from './editor.ts'
import { PART_DEFS, PART_LIST, newPart, type Doc, type Part, type PartKind, type Rot } from './model.ts'
import { analysisOf, settingsFrom, type AnalysisKind, type SimSettings } from './settings.ts'
import { prepareNetlist, prepareSchematic, summarize, type Prepared, type RunOutput } from './session.ts'
import { parseSpice, SpiceError, toSpice } from './sim/spice.ts'

type Tools = Parameters<typeof useAppTools>[1]

export type ExportFormat = 'kelec' | 'svg' | 'png' | 'cir' | 'bom' | 'bom-md' | 'knetlist' | 'csv' | 'kpcb'

export interface Hooks {
  state(): { doc: Doc; sim: SimSettings; name: string; netlist: string; dirty: boolean; tab: string }
  /** Replaces the circuit (one undo step), optionally with new settings, name or netlist text. */
  apply(doc: Doc, what: string, extra?: { sim?: Partial<SimSettings>; name?: string; netlist?: string; fit?: boolean }): void
  /** Runs the prepared simulation and shows its results in the window. */
  run(p: Prepared): Promise<RunOutput>
  showCalculator(id: string, inputs: Record<string, string>): void
  openExample(ex: Example): Promise<void>
  center(): { x: number; y: number }
  defaultPath(format: ExportFormat): string
  exportAs(format: ExportFormat, path: string | null): Promise<string>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const KIND_WORDS: Record<string, PartKind> = {
  r: 'resistor', res: 'resistor', pot: 'potentiometer', c: 'capacitor', cap: 'capacitor', l: 'inductor', ind: 'inductor', v: 'battery', vdc: 'battery', dc: 'battery',
  vac: 'vsine', ac: 'vsine', sine: 'vsine', sin: 'vsine', pulse: 'vpulse', square: 'vpulse', i: 'isource', idc: 'isource', gnd: 'ground', d: 'diode', led: 'led',
  q: 'npn', bjt: 'npn', m: 'nmos', mosfet: 'nmos', opamp: 'opamp', 'op-amp': 'opamp', sw: 'switch', transformer: 'transformer',
}

export function resolveKind(text: string): PartKind {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (t in PART_DEFS) return t as PartKind
  if (t in KIND_WORDS) return KIND_WORDS[t]
  const byName = PART_LIST.find((d) => d.name.toLowerCase().replace(/\s+/g, '') === t)
  if (byName) return byName.kind
  throw new Error(`Unknown part “${text}”. Kinds: ${PART_LIST.map((d) => d.kind).join(', ')}.`)
}

/** What the AI sees of a circuit. */
export function describeCircuit(doc: Doc, sim: SimSettings, name: string) {
  const built = buildNetlist(doc, name)
  return {
    name,
    parts: doc.parts.filter((p) => p.kind !== 'ground').map((p) => ({
      ref: p.ref, kind: p.kind, value: p.value, ...(Object.values(p.props).some((v) => v) ? { props: Object.fromEntries(Object.entries(p.props).filter(([, v]) => v)) } : {}),
      at: [p.x, p.y], rotation: p.rot, pins: Object.fromEntries(PART_DEFS[p.kind].pins.map((d) => [d.name, built.pinNet.get(`${p.ref}.${d.name}`) ?? null])),
    })),
    nets: built.nets.filter((n) => n.pins.length > 0).map((n) => ({ name: n.name, pins: n.pins.map((q) => `${q.ref}.${q.pin}`) })),
    problems: built.problems.filter((p) => p.level !== 'info').map((p) => ({ level: p.level, message: p.message, parts: p.refs })),
    simulation: sim,
  }
}

function pinRef(doc: Doc, text: string): { part: Part; pin: string } {
  const [ref, pin] = text.split('.')
  const part = doc.parts.find((p) => p.ref.toLowerCase() === (ref ?? '').toLowerCase())
  if (!part) throw new Error(`There is no part “${ref}”. Parts: ${doc.parts.filter((p) => p.ref).map((p) => p.ref).join(', ') || 'none'}.`)
  const names = PART_DEFS[part.kind].pins.map((d) => d.name)
  const found = names.find((n) => n.toLowerCase() === (pin ?? '').toLowerCase()) ?? PART_DEFS[part.kind].pins.find((d) => d.label?.toLowerCase() === (pin ?? '').toLowerCase())?.name
  if (!found) throw new Error(`${part.ref} has no pin “${pin ?? ''}”: its pins are ${names.join(', ')}.`)
  return { part, pin: found }
}

const PARAM_KEYS: Record<string, keyof SimSettings> = {
  source: 'dcSource', start: 'dcStart', stop: 'dcStop', step: 'dcStep', fstart: 'acStart', fstop: 'acStop', points: 'acPoints', tstop: 'tranStop', tstep: 'tranStep', tmax: 'tranMax',
}

export function kelecTools(h: Hooks): Tools {
  return {
    get_circuit: async (a) => {
      const s = h.state()
      const format = String(a.format ?? 'summary')
      if (format === 'spice') {
        const built = buildNetlist(s.doc, s.name)
        const text = s.doc.parts.length === 0 && s.netlist.trim() ? s.netlist : toSpice(built.circuit, [analysisOf(s.sim)])
        return { spice: text }
      }
      return describeCircuit(s.doc, s.sim, s.name)
    },

    load_example: async (a) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, topic: e.category, shows: e.description.split('. ')[0] })), note: 'Call load_example with an id to open one.' }
      const ex = exampleById(id) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(id.toLowerCase()))
      if (!ex) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      await h.openExample(ex)
      const s = h.state()
      return { loaded: ex.title, description: ex.description, ...describeCircuit(s.doc, s.sim, s.name) }
    },

    set_netlist: async (a) => {
      const text = String(a.text ?? '')
      if (!text.trim()) throw new Error('text: give the SPICE netlist.')
      let parsed
      try { parsed = parseSpice(text) } catch (e) { throw new Error(e instanceof SpiceError ? e.message : msg(e)) }
      if (parsed.circuit.elements.length === 0) throw new Error('The netlist has no parts.')
      const doc = circuitToDoc(parsed.circuit)
      const s = h.state()
      const sim = parsed.analyses[0] ? settingsFrom(parsed.analyses[0], s.sim) : s.sim
      h.apply(doc, 'Load netlist', { sim, name: a.name ? String(a.name) : parsed.circuit.title || s.name, netlist: text, fit: true })
      const built = buildNetlist(doc)
      return {
        loaded: parsed.circuit.elements.length, analyses: parsed.analyses.map((x) => x.type), warnings: parsed.warnings,
        problems: built.problems.filter((p) => p.level !== 'info').map((p) => p.message),
        note: 'The netlist is drawn as a schematic (nets joined by labels) and kept in the Netlist tab. Call simulate to run it.',
      }
    },

    add_part: async (a) => {
      const kind = resolveKind(String(a.kind ?? ''))
      const s = h.state()
      const doc = cloneDoc(s.doc)
      const c = h.center()
      const spot = a.x !== undefined && a.y !== undefined ? { x: Number(a.x), y: Number(a.y) } : freeSpot(doc, c.x - 200, c.y - 100)
      const rot = ([0, 90, 180, 270] as number[]).includes(Number(a.rotation)) ? (Number(a.rotation) as Rot) : 0
      const part = newPart(doc, kind, spot.x, spot.y, { rot })
      if (a.value !== undefined && a.value !== null && String(a.value) !== '') part.value = String(a.value)
      doc.parts.push(part)
      const wanted = a.connect && typeof a.connect === 'object' ? (a.connect as Record<string, unknown>) : {}
      const names = PART_DEFS[kind].pins.map((d) => d.name)
      const connected: Record<string, string> = {}
      for (const [pin, net] of Object.entries(wanted)) {
        const found = names.find((n) => n.toLowerCase() === pin.toLowerCase()) ?? PART_DEFS[kind].pins.find((d) => d.label?.toLowerCase() === pin.toLowerCase())?.name
        if (!found) throw new Error(`${PART_DEFS[kind].name} has no pin “${pin}”: its pins are ${names.join(', ')}.`)
        const netName = String(net).trim()
        if (!netName) continue
        stubToNet(doc, part, found, netName)
        connected[found] = netName
      }
      h.apply(doc, `Add ${PART_DEFS[kind].name}`)
      return { added: part.ref || 'ground', kind, value: part.value, at: [part.x, part.y], pins: names, connected, note: 'Pins joined by net name share a net: use the same name on other parts (or connect).' }
    },

    connect: async (a) => {
      const s = h.state()
      const doc = cloneDoc(s.doc)
      const from = pinRef(doc, String(a.from ?? ''))
      const to = pinRef(doc, String(a.to ?? ''))
      const built = buildNetlist(doc)
      const netA = built.pinNet.get(`${from.part.ref}.${from.pin}`)
      const netB = built.pinNet.get(`${to.part.ref}.${to.pin}`)
      if (netA && netA === netB) return { connected: true, net: netA, note: 'They were already on the same net.' }
      const given = a.net !== undefined && String(a.net).trim() ? String(a.net).trim() : ''
      const isNamed = (n: string | undefined) => !!n && (n === '0' || !/^N\d+$/.test(n))
      let net = given || (isNamed(netA) ? netA! : isNamed(netB) ? netB! : '')
      if (!net) {
        const used = new Set(built.nets.map((n) => n.name))
        for (let i = 1; ; i++) { if (!used.has(`n${i}`)) { net = `n${i}`; break } }
      }
      for (const [side, cur] of [[from, netA], [to, netB]] as const) if (cur !== net) stubToNet(doc, side.part, side.pin, net)
      h.apply(doc, 'Connect')
      return { connected: true, net, pins: [`${from.part.ref}.${from.pin}`, `${to.part.ref}.${to.pin}`] }
    },

    simulate: async (a) => {
      const s = h.state()
      const analysis = String(a.analysis ?? s.sim.analysis) as AnalysisKind
      if (!['op', 'dc', 'ac', 'tran'].includes(analysis)) throw new Error('analysis must be op, dc, ac or tran.')
      const settings: SimSettings = { ...s.sim, analysis }
      const params = a.params && typeof a.params === 'object' ? (a.params as Record<string, unknown>) : {}
      for (const [k, v] of Object.entries(params)) {
        if (k === 'uic') settings.uic = !!v
        else if (k in PARAM_KEYS) (settings as unknown as Record<string, string>)[PARAM_KEYS[k]] = String(v)
        else throw new Error(`Unknown parameter “${k}”. Use source/start/stop/step (dc), fstart/fstop/points (ac), tstop/tstep/tmax/uic (tran).`)
      }
      const useNetlist = String(a.source ?? '') === 'netlist' || (s.doc.parts.length === 0 && s.netlist.trim() !== '')
      const prepared = useNetlist ? prepareNetlist(s.netlist, settings, analysis) : prepareSchematic(s.doc, settings, s.name)
      const signals = Array.isArray(a.signals) ? a.signals.map(String) : typeof a.signals === 'string' && a.signals.trim() ? a.signals.split(/[,;]+/).map((x) => x.trim()).filter(Boolean) : []
      const out = await h.run(prepared)
      return summarize(out, signals, Math.min(60, Math.max(3, Number(a.samples) || 12)))
    },

    calculate: async (a) => {
      const id = String(a.calculator ?? '').trim()
      if (!id) {
        return { calculators: CALCULATORS.map((c) => ({ id: c.id, name: c.name, inputs: c.fields.map((f) => `${f.key}${f.options ? ` (${f.options.map((o) => o.value).join('|')})` : ''}`) })) }
      }
      const inputs: Record<string, string> = {}
      if (a.inputs && typeof a.inputs === 'object') for (const [k, v] of Object.entries(a.inputs as Record<string, unknown>)) inputs[k] = v === null ? '' : String(v)
      const out = runCalculator(id, inputs)
      h.showCalculator(id, inputs)
      return { calculator: id, results: out.rows.map((r) => ({ [r.label]: r.value })), notes: out.notes }
    },

    export: async (a, ctx) => {
      const format = String(a.format ?? 'kelec') as ExportFormat
      if (!['kelec', 'svg', 'png', 'cir', 'bom', 'bom-md', 'knetlist', 'csv', 'kpcb'].includes(format)) throw new Error('format: kelec, svg, png, cir, bom, bom-md, knetlist, csv or kpcb.')
      if (format === 'kpcb') return { sent: await h.exportAs('kpcb', null) }
      const path = a.path ? String(a.path) : h.defaultPath(format)
      if (!(await ctx.confirm(`Write ${path}`, `kElec exports the circuit as ${format.toUpperCase()}. An existing file is replaced.`))) throw new Error('The user did not allow writing that file.')
      return { saved: await h.exportAs(format, path) }
    },
  }
}

