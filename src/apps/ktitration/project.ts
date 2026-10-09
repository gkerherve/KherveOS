// The kTitration project (pure): what a .ktitr file holds, its defaults, and reading/writing it.
//   { "format": "ktitr", "version": 1, "name": …, "mode": "acidbase" | "redox" | "edta" | "precip", … }
// Everything is plain JSON; files from a newer or damaged writer are repaired against the defaults instead of failing.

import type { AcidBaseSpec, Item, WeakItem } from './acidbase.ts'
import type { BufferSpec } from './buffer.ts'
import { COUPLES } from './data/potentials.ts'
import { PRECIPITATES, metalById } from './data/metals.ts'
import { pkaById, systemOf, type PkaEntry } from './data/pka.ts'
import type { EdtaSpec } from './edta.ts'
import type { ActivityModel, System } from './equilibria.ts'
import { DEFAULT_FIT_SETUP, type FitSetup } from './fit.ts'
import type { PrecipSpec } from './precip.ts'
import type { RedoxCouple, RedoxSpec } from './redox.ts'

export type Mode = 'acidbase' | 'redox' | 'edta' | 'precip'
export type TabId = 'titration' | 'speciation' | 'analyse' | 'buffer' | 'indicators' | 'reference'
export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'titration', label: 'Titration' },
  { id: 'speciation', label: 'Speciation' },
  { id: 'analyse', label: 'Analyse data' },
  { id: 'buffer', label: 'Buffer designer' },
  { id: 'indicators', label: 'Indicator chooser' },
  { id: 'reference', label: 'Reference' },
]
export const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'acidbase', label: 'Acid–base' },
  { id: 'redox', label: 'Redox' },
  { id: 'edta', label: 'EDTA (complexometric)' },
  { id: 'precip', label: 'Precipitation' },
]

export interface SpeciationSpec {
  lib: string | null
  sys: System
  forms: string[]
  conc: number
  /** Fixed ionic strength for the diagrams (0 = ideal, activities off). */
  ionic: number
  activity: ActivityModel
  temperature: number
}

export interface AnalyseSpec {
  text: string
  setup: FitSetup
  /** The analyte of the Gran plot: weak or strong. */
  gran: 'strong' | 'weak'
  /** Free-text description of where the data came from. */
  source: string
  view: 'curve' | 'derivative' | 'gran' | 'fit'
}

export interface Project {
  format: 'ktitr'
  version: 1
  name: string
  description: string
  mode: Mode
  acidbase: AcidBaseSpec
  redox: RedoxSpec
  edta: EdtaSpec
  precip: PrecipSpec
  speciation: SpeciationSpec
  analyse: AnalyseSpec
  buffer: BufferSpec
  /** The tab shown when the file opens. */
  tab: TabId
  notes: string
}

// ---------------------------------------------------------------------------------------------- builders

/** A weak acid/base item from a database entry. */
export function weakFrom(e: PkaEntry, form: number, conc: number, volume: number): WeakItem {
  return { kind: 'weak', label: e.name, pKa: [...e.pKa], z0: e.z0, form, conc, volume, ...(e.dpKadT ? { dpKadT: [...e.dpKadT] } : {}), lib: e.id }
}

export function strongItem(kind: 'strong-acid' | 'strong-base', label: string, conc: number, volume: number): Item {
  return { kind, label, conc, volume }
}

export function redoxCouple(id: string, formal?: number): RedoxCouple {
  const c = COUPLES.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown couple ${id}`)
  return { label: `${c.ox} / ${c.red}`, ox: c.ox, red: c.red, E0: formal ?? c.E0, n: c.n, m: c.m, b: c.b }
}

export function edtaMetal(id: string): EdtaSpec['metal'] {
  const m = metalById(id)
  if (!m) throw new Error(`Unknown metal ${id}`)
  return { symbol: m.symbol, ion: m.ion, logKMY: m.logKMY, hydroxo: [...m.hydroxo], ammine: [...m.ammine] }
}

export function defaultAcidBase(): AcidBaseSpec {
  const ac = pkaById('acetic') as PkaEntry
  return {
    items: [weakFrom(ac, 0, 0.1, 25)],
    water: 0,
    titrant: { kind: 'strong-base', label: 'NaOH', conc: 0.1 },
    temperature: 25, activity: 'none', background: 0, vmax: null, indicator: 'phenolphthalein',
  }
}

export function defaultRedox(): RedoxSpec {
  return {
    analyte: { couple: redoxCouple('fe3', 0.68), start: 'red', conc: 0.05, volume: 25 },
    titrant: { couple: redoxCouple('ce4', 1.44), conc: 0.1 },
    water: 0, pH: 0, temperature: 25, indicator: 'ferroin', vmax: null,
  }
}

export function defaultEdta(): EdtaSpec {
  return { metal: edtaMetal('ca'), conc: 0.003, volume: 100, water: 0, titrantConc: 0.01, pH: 10, ammonia: 0.1, indicator: 'ebt', customLogK: 5, vmax: null }
}

export function defaultPrecip(): PrecipSpec {
  return {
    mode: 'silver-titrant', anions: [{ salt: 'agcl', conc: 0.05, volume: 25 }], silver: { conc: 0.05, volume: 25 }, titrantConc: 0.05, water: 0,
    indicator: 'mohr', chromate: 0.0025, iron: 0.01, vmax: null,
  }
}

export function defaultSpeciation(): SpeciationSpec {
  const e = pkaById('phosphoric') as PkaEntry
  return { lib: e.id, sys: systemOf(e), forms: [...e.forms], conc: 0.1, ionic: 0, activity: 'none', temperature: 25 }
}

export function defaultBuffer(): BufferSpec {
  const e = pkaById('phosphoric') as PkaEntry
  return {
    sys: systemOf(e), lib: e.id, forms: [...e.forms], mode: 'salts', formA: 1, formB: 2, pH: 7.4, conc: 0.1, volume: 1000, temperature: 25,
    activity: 'davies', ionicStrength: null, stockA: 1, stockB: 1, cation: 'Na', anion: 'Cl',
  }
}

export function newProject(): Project {
  return {
    format: 'ktitr', version: 1, name: 'Untitled', description: '', mode: 'acidbase',
    acidbase: defaultAcidBase(), redox: defaultRedox(), edta: defaultEdta(), precip: defaultPrecip(),
    speciation: defaultSpeciation(),
    analyse: { text: '', setup: { ...DEFAULT_FIT_SETUP, pKa: DEFAULT_FIT_SETUP.pKa.map((p) => ({ ...p })) }, gran: 'weak', source: '', view: 'curve' },
    buffer: defaultBuffer(),
    tab: 'titration', notes: '',
  }
}

// ---------------------------------------------------------------------------------------------- files

/** Text of a .ktitr file: keys in a fixed order, 2-space indent, trailing newline. */
export function serializeKtitr(p: Project): string {
  const ordered: Project = {
    format: 'ktitr', version: 1, name: p.name, description: p.description, mode: p.mode, tab: p.tab,
    acidbase: p.acidbase, redox: p.redox, edta: p.edta, precip: p.precip, speciation: p.speciation, analyse: p.analyse, buffer: p.buffer, notes: p.notes,
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Raw values laid over the defaults: numbers must be finite, strings strings, arrays arrays; unknown keys are dropped. */
export function overlay<T>(def: T, raw: unknown): T {
  if (Array.isArray(def)) return (Array.isArray(raw) ? (raw as unknown as T) : def)
  if (isObj(def)) {
    if (!isObj(raw)) return def
    const out: Record<string, unknown> = { ...def }
    for (const k of Object.keys(def)) {
      const dv = (def as Record<string, unknown>)[k]
      if (!(k in raw)) continue
      const rv = raw[k]
      if (dv === null) out[k] = rv === null || ['number', 'string', 'boolean'].includes(typeof rv) ? rv : dv
      else out[k] = overlay(dv, rv)
    }
    return out as T
  }
  if (typeof def === 'number') return (typeof raw === 'number' && Number.isFinite(raw) ? raw : def) as T
  if (typeof def === 'string') return (typeof raw === 'string' ? raw : def) as T
  if (typeof def === 'boolean') return (typeof raw === 'boolean' ? raw : def) as T
  return def
}

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
const str = (x: unknown, d: string) => (typeof x === 'string' ? x : d)

function cleanItems(raw: unknown, fallback: Item[]): Item[] {
  if (!Array.isArray(raw)) return fallback
  const out: Item[] = []
  for (const r of raw) {
    if (!isObj(r)) continue
    const kind = r.kind
    if (kind === 'strong-acid' || kind === 'strong-base') out.push({ kind, label: str(r.label, kind === 'strong-acid' ? 'Strong acid' : 'Strong base'), conc: Math.max(0, num(r.conc, 0.1)), volume: Math.max(0, num(r.volume, 25)) })
    else if (kind === 'weak' && Array.isArray(r.pKa) && r.pKa.every((v) => typeof v === 'number' && Number.isFinite(v)) && r.pKa.length >= 1 && r.pKa.length <= 8) {
      const n = r.pKa.length
      out.push({
        kind: 'weak', label: str(r.label, 'Weak acid'), pKa: r.pKa as number[], z0: Math.round(num(r.z0, 0)), form: Math.max(0, Math.min(n, Math.round(num(r.form, 0)))),
        conc: Math.max(0, num(r.conc, 0.1)), volume: Math.max(0, num(r.volume, 25)),
        ...(Array.isArray(r.dpKadT) && r.dpKadT.length === n && r.dpKadT.every((v) => typeof v === 'number') ? { dpKadT: r.dpKadT as number[] } : {}),
        ...(typeof r.lib === 'string' ? { lib: r.lib } : {}),
      })
    }
  }
  return out
}

/** Reads a .ktitr file. Throws a readable Error when it is not one. */
export function parseKtitr(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a kTitration file (the text is not valid JSON).')
  }
  if (!isObj(raw) || raw.format !== 'ktitr') throw new Error('This is not a kTitration file (it has no "format": "ktitr").')
  if (typeof raw.version === 'number' && raw.version > 1) throw new Error(`This file was made by a newer kTitration (version ${raw.version}).`)
  const d = newProject()
  const p = overlay(d, raw)
  p.acidbase = { ...overlay(d.acidbase, raw.acidbase), items: cleanItems(isObj(raw.acidbase) ? raw.acidbase.items : null, d.acidbase.items) }
  p.acidbase.titrant = overlay(d.acidbase.titrant, isObj(raw.acidbase) ? raw.acidbase.titrant : null)
  p.acidbase.vmax = isObj(raw.acidbase) && typeof raw.acidbase.vmax === 'number' && raw.acidbase.vmax > 0 ? raw.acidbase.vmax : null
  p.acidbase.indicator = isObj(raw.acidbase) && typeof raw.acidbase.indicator === 'string' ? raw.acidbase.indicator : isObj(raw.acidbase) && raw.acidbase.indicator === null ? null : d.acidbase.indicator
  if (!['acidbase', 'redox', 'edta', 'precip'].includes(p.mode)) p.mode = 'acidbase'
  if (!TABS.some((t) => t.id === p.tab)) p.tab = 'titration'
  p.format = 'ktitr'
  p.version = 1
  // sub-objects that are nullable in the defaults
  p.redox.indicator = isObj(raw.redox) && (typeof raw.redox.indicator === 'string' || raw.redox.indicator === null) ? (raw.redox.indicator as string | null) : d.redox.indicator
  p.redox.vmax = isObj(raw.redox) && typeof raw.redox.vmax === 'number' && raw.redox.vmax > 0 ? raw.redox.vmax : null
  p.edta.indicator = isObj(raw.edta) && (typeof raw.edta.indicator === 'string' || raw.edta.indicator === null) ? (raw.edta.indicator as string | null) : d.edta.indicator
  p.edta.vmax = isObj(raw.edta) && typeof raw.edta.vmax === 'number' && raw.edta.vmax > 0 ? raw.edta.vmax : null
  p.precip.indicator = isObj(raw.precip) && (raw.precip.indicator === 'mohr' || raw.precip.indicator === 'volhard' || raw.precip.indicator === null) ? raw.precip.indicator : d.precip.indicator
  p.precip.vmax = isObj(raw.precip) && typeof raw.precip.vmax === 'number' && raw.precip.vmax > 0 ? raw.precip.vmax : null
  p.buffer.ionicStrength = isObj(raw.buffer) && typeof raw.buffer.ionicStrength === 'number' && raw.buffer.ionicStrength > 0 ? raw.buffer.ionicStrength : null
  p.analyse.setup.guessC = isObj(raw.analyse) && isObj(raw.analyse.setup) && typeof raw.analyse.setup.guessC === 'number' ? raw.analyse.setup.guessC : null
  return repair(p, d)
}

const goodPka = (x: unknown): x is number[] => Array.isArray(x) && x.length >= 1 && x.length <= 8 && x.every((v) => typeof v === 'number' && Number.isFinite(v))

/** Things the field-by-field merge cannot check: lists whose length must agree with another field. */
function repair(p: Project, d: Project): Project {
  // analysis set-up: npk steps, one {value, fit} each
  const s = p.analyse.setup
  s.npk = Math.max(1, Math.min(4, Math.round(s.npk) || 1))
  const pk = Array.isArray(s.pKa) ? s.pKa : []
  s.pKa = Array.from({ length: s.npk }, (_, i) => {
    const e = pk[i] as unknown
    return isObj(e) && typeof e.value === 'number' && Number.isFinite(e.value) ? { value: e.value, fit: e.fit !== false } : { value: [3, 7, 11, 13][i] ?? 7, fit: true }
  })
  s.form = Math.max(0, Math.min(s.npk, Math.round(s.form) || 0))
  if (!['base', 'acid'].includes(s.titrant)) s.titrant = 'base'
  if (!['strong', 'weak'].includes(p.analyse.gran)) p.analyse.gran = 'weak'
  if (!['curve', 'derivative', 'gran', 'fit'].includes(p.analyse.view)) p.analyse.view = 'curve'
  // speciation and buffer systems
  if (!goodPka(p.speciation.sys.pKa)) p.speciation.sys = d.speciation.sys
  if (!Array.isArray(p.speciation.forms) || p.speciation.forms.length !== p.speciation.sys.pKa.length + 1 || !p.speciation.forms.every((f) => typeof f === 'string')) p.speciation.forms = []
  if (!goodPka(p.buffer.sys.pKa)) { p.buffer.sys = d.buffer.sys; p.buffer.lib = d.buffer.lib }
  const nb = p.buffer.sys.pKa.length
  if (!Array.isArray(p.buffer.forms) || p.buffer.forms.length !== nb + 1 || !p.buffer.forms.every((f) => typeof f === 'string')) p.buffer.forms = []
  p.buffer.formA = Math.max(0, Math.min(nb, Math.round(p.buffer.formA) || 0))
  p.buffer.formB = Math.max(0, Math.min(nb, Math.round(p.buffer.formB) || 0))
  if (!['salts', 'acid-base', 'base-acid'].includes(p.buffer.mode)) p.buffer.mode = 'salts'
  // redox, EDTA, precipitation
  if (p.redox.analyte.start !== 'red' && p.redox.analyte.start !== 'ox') p.redox.analyte.start = 'red'
  for (const c of [p.redox.analyte.couple, p.redox.titrant.couple]) {
    if (!(c.n >= 1)) c.n = 1
    if (!(c.b >= 1)) c.b = 1
    if (!(c.m >= 0)) c.m = 0
  }
  p.edta.metal.hydroxo = Array.isArray(p.edta.metal.hydroxo) ? p.edta.metal.hydroxo.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []
  p.edta.metal.ammine = Array.isArray(p.edta.metal.ammine) ? p.edta.metal.ammine.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []
  p.precip.anions = (Array.isArray(p.precip.anions) ? p.precip.anions : []).filter((a): a is PrecipSpec['anions'][number] => isObj(a) && typeof a.salt === 'string' && PRECIPITATES.some((x) => x.id === a.salt) && typeof a.conc === 'number' && typeof a.volume === 'number')
  if (p.precip.anions.length === 0) p.precip.anions = d.precip.anions
  if (p.precip.mode !== 'silver-titrant' && p.precip.mode !== 'thiocyanate-titrant') p.precip.mode = 'silver-titrant'
  return p
}

/** Which spec the project's mode shows. */
export const activeSpec = (p: Project) => p[p.mode]

/** Names of the species of a system: from the database when the entry is known, else “species j (charge)”. */
export function formLabels(item: { lib?: string | null; pKa: number[]; z0: number }): string[] {
  const e = item.lib ? pkaById(item.lib) : undefined
  if (e && e.forms.length === item.pKa.length + 1) return e.forms
  return Array.from({ length: item.pKa.length + 1 }, (_, j) => {
    const z = item.z0 - j
    return `species ${j} (charge ${z > 0 ? '+' : z < 0 ? '−' : ''}${Math.abs(z)})`
  })
}
