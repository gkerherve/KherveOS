// The whole state of a kReaction window (what a .kreact file holds) and the file format. Form fields are kept
// as text so that half-typed numbers survive. Pure functions.

import type { OdeMethod } from './ode.ts'
import { normalise, simpleProfile, type Profile } from './profile.ts'
import { ARROWS, type ArrowKind } from './reaction.ts'
import type { NotebookEntry } from './notebook.ts'
import { PRESETS } from './kinetics.ts'

export type ToolId = 'builder' | 'library' | 'mechanism' | 'predict' | 'kinetics' | 'energy' | 'notebook'
export const TOOL_IDS: readonly ToolId[] = ['builder', 'library', 'mechanism', 'predict', 'kinetics', 'energy', 'notebook']

export type EnergyTab = 'profile' | 'thermo' | 'equilibrium'
export type KineticsTab = 'simulate' | 'order' | 'arrhenius' | 'michaelis'

export interface BuilderState {
  reactants: string[]
  products: string[]
  arrow: ArrowKind
  above: string
  below: string
  /** Coefficients chosen by the user (after "Balance"), reactants then products; null: as typed. */
  coeffs: number[] | null
  /** The library reaction it came from, if any. */
  fromId: string | null
}

export interface KineticsState {
  tab: KineticsTab
  text: string
  tEnd: string
  logTime: boolean
  method: OdeMethod
  presetId: string
  hidden: string[]
  orderData: string
  arrData: string
  arrKind: 'arrhenius' | 'eyring'
  mm: { k1: string; km1: string; kcat: string; e0: string; s0: string }
}

export interface EnergyState {
  tab: EnergyTab
  profile: Profile
  showCatalysed: boolean
  lower: string
  /** Where the profile came from (a library id or ''). */
  source: string
  thermo: { dH: string; dS: string; T: string; T2: string; K1: string; dHvh: string }
  ice: { equation: string; initial: string; K: string; mode: 'Kc' | 'Kp'; T: string; add: string; addSpecies: string; volume: string; T2: string; dH: string }
}

export interface Workspace {
  tool: ToolId
  builder: BuilderState
  library: { selected: string | null; query: string; cls: string }
  mechanism: { reactionId: string | null; step: number }
  predict: { reactants: string[] }
  kinetics: KineticsState
  energy: EnergyState
  notebook: NotebookEntry[]
}

export function defaultWorkspace(): Workspace {
  const preset = PRESETS[0]
  return {
    tool: 'builder',
    builder: { reactants: ['ethanol', 'oxygen'], products: ['carbon dioxide', 'water'], arrow: 'forward', above: '', below: '', coeffs: null, fromId: null },
    library: { selected: null, query: '', cls: '' },
    mechanism: { reactionId: 'sn2', step: 0 },
    predict: { reactants: ['CC(=O)O', 'CCO'] },
    kinetics: {
      tab: 'simulate', text: preset.text, tEnd: String(preset.tEnd), logTime: preset.logTime, method: 'auto', presetId: preset.id, hidden: [],
      orderData: '# t (s)   [A] (mol/L)\n0   1.000\n10  0.607\n20  0.368\n30  0.223\n40  0.135\n50  0.082\n60  0.050',
      arrData: '# T (K)   k (s^-1)\n300  0.0013\n320  0.0098\n340  0.057\n360  0.27\n380  1.05',
      arrKind: 'arrhenius',
      mm: { k1: '10', km1: '1', kcat: '2', e0: '0.01', s0: '0.1, 0.2, 0.5, 1, 2, 5' },
    },
    energy: {
      tab: 'profile', profile: simpleProfile(-92, 230, 'N₂ + 3 H₂', '2 NH₃'), showCatalysed: true, lower: '80', source: 'haber',
      thermo: { dH: '-92', dS: '-199', T: '298', T2: '700', K1: '6e5', dHvh: '-92' },
      ice: { equation: 'N2O4 <=> 2 NO2', initial: 'N2O4 = 0.100, NO2 = 0', K: '0.0059', mode: 'Kc', T: '298', add: '0.05', addSpecies: 'N2O4', volume: '0.5', T2: '350', dH: '57' },
    },
    notebook: [],
  }
}

// ------------------------------------------------------------------ the .kreact file

export const FILE_FORMAT = 'kreact'
export const FILE_VERSION = 1

const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const strList = (v: unknown, d: string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d)

/** The workspace as the text of a .kreact file. */
export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(
    {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      tool: ws.tool,
      builder: ws.builder,
      library: ws.library,
      mechanism: ws.mechanism,
      predict: ws.predict,
      kinetics: ws.kinetics,
      energy: ws.energy,
      notebook: ws.notebook,
    },
    null,
    2,
  )
}

export interface ParsedFile {
  workspace: Workspace
  warnings: string[]
}

/** Reads a .kreact file; anything missing takes its default. Throws an Error when it is not a kReaction file. */
export function parseWorkspace(text: string): ParsedFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a .kreact file (it is not valid JSON).')
  }
  const o = obj(raw)
  if (o.format !== FILE_FORMAT) throw new Error('This is not a .kreact file (the "format" field is missing).')
  const warnings: string[] = []
  if (typeof o.version === 'number' && o.version > FILE_VERSION) warnings.push(`The file is version ${o.version}; this kReaction reads version ${FILE_VERSION}, so some parts may be ignored.`)
  const d = defaultWorkspace()

  const b = obj(o.builder)
  const builder: BuilderState = {
    reactants: strList(b.reactants, d.builder.reactants),
    products: strList(b.products, d.builder.products),
    arrow: oneOf(b.arrow, Object.keys(ARROWS) as ArrowKind[], 'forward'),
    above: str(b.above, ''),
    below: str(b.below, ''),
    coeffs: Array.isArray(b.coeffs) && b.coeffs.every((x) => typeof x === 'number') ? (b.coeffs as number[]) : null,
    fromId: typeof b.fromId === 'string' ? b.fromId : null,
  }
  if (builder.reactants.length === 0) builder.reactants = ['']
  if (builder.products.length === 0) builder.products = ['']

  const lib = obj(o.library)
  const mech = obj(o.mechanism)
  const k = obj(o.kinetics)
  const mm = obj(k.mm)
  const e = obj(o.energy)
  const th = obj(e.thermo)
  const ice = obj(e.ice)
  const profile = parseProfile(e.profile) ?? d.energy.profile

  const workspace: Workspace = {
    tool: oneOf(o.tool, TOOL_IDS, 'builder'),
    builder,
    library: { selected: typeof lib.selected === 'string' ? lib.selected : null, query: str(lib.query, ''), cls: str(lib.cls, '') },
    mechanism: { reactionId: typeof mech.reactionId === 'string' ? mech.reactionId : null, step: typeof mech.step === 'number' ? Math.max(0, Math.floor(mech.step)) : 0 },
    predict: { reactants: strList(obj(o.predict).reactants, d.predict.reactants) },
    kinetics: {
      tab: oneOf(k.tab, ['simulate', 'order', 'arrhenius', 'michaelis'] as const, 'simulate'),
      text: str(k.text, d.kinetics.text),
      tEnd: str(k.tEnd, d.kinetics.tEnd),
      logTime: bool(k.logTime, d.kinetics.logTime),
      method: oneOf(k.method, ['auto', 'rk4', 'rk45', 'stiff'] as const, 'auto'),
      presetId: str(k.presetId, ''),
      hidden: strList(k.hidden, []),
      orderData: str(k.orderData, d.kinetics.orderData),
      arrData: str(k.arrData, d.kinetics.arrData),
      arrKind: oneOf(k.arrKind, ['arrhenius', 'eyring'] as const, 'arrhenius'),
      mm: {
        k1: str(mm.k1, d.kinetics.mm.k1), km1: str(mm.km1, d.kinetics.mm.km1), kcat: str(mm.kcat, d.kinetics.mm.kcat),
        e0: str(mm.e0, d.kinetics.mm.e0), s0: str(mm.s0, d.kinetics.mm.s0),
      },
    },
    energy: {
      tab: oneOf(e.tab, ['profile', 'thermo', 'equilibrium'] as const, 'profile'),
      profile,
      showCatalysed: bool(e.showCatalysed, true),
      lower: str(e.lower, d.energy.lower),
      source: str(e.source, ''),
      thermo: {
        dH: str(th.dH, d.energy.thermo.dH), dS: str(th.dS, d.energy.thermo.dS), T: str(th.T, d.energy.thermo.T), T2: str(th.T2, d.energy.thermo.T2),
        K1: str(th.K1, d.energy.thermo.K1), dHvh: str(th.dHvh, d.energy.thermo.dHvh),
      },
      ice: {
        equation: str(ice.equation, d.energy.ice.equation), initial: str(ice.initial, d.energy.ice.initial), K: str(ice.K, d.energy.ice.K),
        mode: ice.mode === 'Kp' ? 'Kp' : 'Kc', T: str(ice.T, d.energy.ice.T), add: str(ice.add, d.energy.ice.add),
        addSpecies: str(ice.addSpecies, d.energy.ice.addSpecies), volume: str(ice.volume, d.energy.ice.volume), T2: str(ice.T2, d.energy.ice.T2), dH: str(ice.dH, d.energy.ice.dH),
      },
    },
    notebook: parseNotebook(o.notebook),
  }
  return { workspace, warnings }
}

function parseProfile(v: unknown): Profile | null {
  const pts = obj(v).points
  if (!Array.isArray(pts)) return null
  const list = pts
    .map((p) => obj(p))
    .filter((p) => typeof p.energy === 'number' && Number.isFinite(p.energy))
    .map((p) => ({ label: str(p.label, ''), energy: p.energy as number }))
  return list.length >= 3 && list.length % 2 === 1 ? normalise(list) : null
}

function parseNotebook(v: unknown): NotebookEntry[] {
  if (!Array.isArray(v)) return []
  const out: NotebookEntry[] = []
  for (const x of v) {
    const e = obj(x)
    if (typeof e.id !== 'string' || typeof e.text !== 'string') continue
    out.push({
      id: e.id, label: str(e.label, ''), tool: str(e.tool, ''), text: e.text, time: typeof e.time === 'number' ? e.time : 0,
      svgs: strList(e.svgs, []),
    })
  }
  return out
}
