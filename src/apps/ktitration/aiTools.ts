// AI tools of kTitration (the manifest is src/os/ai/manifests/ktitration.ts). Written against a small set of
// hooks the window provides, so the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { equivalencePoints, titrantAdds, type AcidBaseSpec, type Item } from './acidbase.ts'
import { detectEquivalence, granAnalysis, parseData } from './analyse.ts'
import { rankIndicators } from './chooser.ts'
import { INDICATORS } from './data/indicators.ts'
import { METALS, PRECIPITATES } from './data/metals.ts'
import { COUPLES } from './data/potentials.ts'
import { PKA, findPka } from './data/pka.ts'
import { findExample, EXAMPLES } from './examples.ts'
import { fitTitration, setupForKind, DEFAULT_FIT_SETUP, type FitResult } from './fit.ts'
import { fixed } from './format.ts'
import { edtaMetal, newProject, redoxCouple, strongItem, weakFrom, type Project } from './project.ts'
import { computeResult, summaryOf } from './result.ts'
import type { ActivityModel } from './equilibria.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { project: Project; dirty: boolean; fit: FitResult | null }
  /** Replaces the project shown (an unsaved document), optionally running the fit of the Analyse tab. */
  apply(p: Project, opts?: { runFit?: boolean }): void
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : d)

// ---------------------------------------------------------------------------------------------- building a titration from words

const STRONG_ACIDS: Record<string, string> = { hcl: 'HCl', hno3: 'HNO₃', hclo4: 'HClO₄', hbr: 'HBr', hi: 'HI', 'strong acid': 'Strong acid' }
const STRONG_BASES: Record<string, string> = { naoh: 'NaOH', koh: 'KOH', lioh: 'LiOH', 'strong base': 'Strong base' }

function activityOf(v: unknown): ActivityModel {
  const s = String(v ?? '').toLowerCase()
  return s === 'davies' || s === 'edh' ? s : 'none'
}

/** The weak item of a database entry with a sensible default form: bases as the free base, acids fully protonated. */
function weakByName(name: string, conc: number, volume: number, formOpt: unknown): Item {
  const e = findPka(name)
  if (!e) throw new Error(`“${name}” is not in the pKa table. Give its pKa values in options.pKa (and options.z0 and options.form), or use a name like “acetic acid”, “phosphoric acid”, “glycine”, “ammonia”.`)
  const n = e.pKa.length
  const defForm = e.category === 'Amines and N-bases' ? n : e.category === 'Biological buffers' && e.z0 === 1 ? n : 0
  const form = formOpt === undefined || formOpt === null ? defForm : Math.max(0, Math.min(n, Math.round(num(formOpt, defForm))))
  return weakFrom(e, form, conc, volume)
}

function itemFromWords(name: string, conc: number, volume: number, opts: Record<string, unknown>): Item {
  const key = name.trim().toLowerCase()
  if (STRONG_ACIDS[key]) return strongItem('strong-acid', STRONG_ACIDS[key], conc, volume)
  if (STRONG_BASES[key]) return strongItem('strong-base', STRONG_BASES[key], conc, volume)
  if (Array.isArray(opts.pKa) && opts.pKa.length) {
    const pKa = opts.pKa.map(Number)
    if (!pKa.every(Number.isFinite)) throw new Error('options.pKa must be a list of numbers.')
    const n = pKa.length
    const form = Math.max(0, Math.min(n, Math.round(num(opts.form, 0))))
    return { kind: 'weak', label: name || 'Analyte', pKa, z0: Math.round(num(opts.z0, 0)), form, conc, volume }
  }
  return weakByName(name, conc, volume, opts.form)
}

/** A titration project from a short description (the AI's `titrate` tool). Throws readable errors. */
export function buildTitration(a: Record<string, unknown>): Project {
  const type = String(a.type ?? 'acidbase').toLowerCase().replace(/[-_ ]/g, '')
  const analyte = String(a.analyte ?? '').trim()
  const conc = num(a.analyte_conc, NaN)
  const volume = num(a.analyte_volume, 25)
  const tc = num(a.titrant_conc, NaN)
  const opts = isObj(a.options) ? a.options : {}
  const p = newProject()
  p.tab = 'titration'
  if (!(volume > 0)) throw new Error('analyte_volume must be a positive number of mL.')
  if (type === 'acidbase' || type === 'acid' || type === 'base') {
    if (!analyte && !Array.isArray(opts.mixture)) throw new Error('analyte: name the acid or base (e.g. "acetic acid", "HCl", "ammonia", "phosphoric acid").')
    const water = num(opts.water_mL, 0)
    let items: Item[]
    if (Array.isArray(opts.mixture) && opts.mixture.length) {
      items = opts.mixture.map((m) => {
        if (!isObj(m)) throw new Error('options.mixture: a list of {name, conc, volume}.')
        return itemFromWords(String(m.name ?? ''), num(m.conc, NaN), num(m.volume, 25), m)
      })
    } else {
      if (!(conc > 0)) throw new Error('analyte_conc must be a positive concentration in mol/L.')
      items = [itemFromWords(analyte, conc, volume, opts)]
    }
    if (items.some((i) => !(i.conc > 0))) throw new Error('Every flask item needs a positive concentration.')
    // the titrant: given, or the natural one
    const given = String(opts.titrant ?? '').trim().toLowerCase()
    const acidic = items.some((i) => i.kind === 'strong-acid' || (i.kind === 'weak' && i.form < i.pKa.length)) && !(items.length === 1 && items[0].kind === 'weak' && items[0].form === items[0].pKa.length)
    const baseTitrant = given ? (STRONG_BASES[given] !== undefined || given === 'ammonia' || given === 'nh3') : acidic
    const titrantLabel = given ? (STRONG_ACIDS[given] ?? STRONG_BASES[given] ?? (given === 'ammonia' || given === 'nh3' ? 'NH₃' : given)) : baseTitrant ? 'NaOH' : 'HCl'
    const tConc = tc > 0 ? tc : 0.1
    const titrant: AcidBaseSpec['titrant'] = given === 'ammonia' || given === 'nh3'
      ? { kind: 'weak-base', label: 'NH₃', conc: tConc, pKa: [9.25], z0: 1, form: 1 }
      : { kind: baseTitrant ? 'strong-base' : 'strong-acid', label: titrantLabel, conc: tConc }
    p.mode = 'acidbase'
    p.acidbase = {
      items, water, titrant, temperature: num(opts.temperature, 25), activity: activityOf(opts.activity), background: num(opts.background, 0), vmax: null,
      indicator: typeof opts.indicator === 'string' ? (INDICATORS.find((i) => i.id === opts.indicator || i.name.toLowerCase() === String(opts.indicator).toLowerCase())?.id ?? null) : titrantAdds(titrant) === 'base' ? 'phenolphthalein' : 'methylorange',
    }
    p.name = `${items.map((i) => i.label).join(' + ')} with ${titrantLabel}`
    return p
  }
  if (type === 'redox') {
    const w = analyte.toLowerCase().replace(/[()\s]/g, '')
    const table: Record<string, { couple: string; start: 'red' | 'ox'; formal?: number }> = {
      'fe2+': { couple: 'fe3', start: 'red', formal: 0.68 }, iron2: { couple: 'fe3', start: 'red', formal: 0.68 }, ironii: { couple: 'fe3', start: 'red', formal: 0.68 },
      'sn2+': { couple: 'sn4', start: 'red' }, tinii: { couple: 'sn4', start: 'red' }, i2: { couple: 'i2', start: 'ox' }, iodine: { couple: 'i2', start: 'ox' },
      'fe(cn)64-': { couple: 'ferricyanide', start: 'red' }, ferrocyanide: { couple: 'ferricyanide', start: 'red' },
    }
    const t = table[w]
    if (!t) throw new Error('redox analyte: Fe2+, Sn2+, I2 or ferrocyanide.')
    if (!(conc > 0)) throw new Error('analyte_conc must be a positive concentration in mol/L.')
    const tw = String(opts.titrant ?? (t.start === 'red' ? 'Ce4+' : 'S2O3 2-')).toLowerCase().replace(/[()\s]/g, '')
    const ttable: Record<string, { couple: string; formal?: number; conc: number }> = {
      'ce4+': { couple: 'ce4', formal: 1.44, conc: 0.1 }, ceriumiv: { couple: 'ce4', formal: 1.44, conc: 0.1 }, 'mno4-': { couple: 'mno4', conc: 0.02 }, permanganate: { couple: 'mno4', conc: 0.02 },
      'cr2o72-': { couple: 'cr2o7', conc: 0.01667 }, dichromate: { couple: 'cr2o7', conc: 0.01667 }, 's2o32-': { couple: 's4o6', conc: 0.1 }, thiosulfate: { couple: 's4o6', conc: 0.1 }, 'i2': { couple: 'i2', conc: 0.05 },
    }
    const tt = ttable[tw]
    if (!tt) throw new Error('redox titrant: Ce4+, MnO4-, Cr2O7 2- (for Fe2+, Sn2+) or S2O3 2- (for I2).')
    p.mode = 'redox'
    p.redox = {
      analyte: { couple: redoxCouple(t.couple, num(opts.analyte_E0, t.formal ?? COUPLES.find((c) => c.id === t.couple)!.E0)), start: t.start, conc, volume },
      titrant: { couple: redoxCouple(tt.couple, num(opts.titrant_E0, tt.formal ?? COUPLES.find((c) => c.id === tt.couple)!.E0)), conc: tc > 0 ? tc : tt.conc },
      water: num(opts.water_mL, 0), pH: num(opts.pH, t.start === 'ox' ? 7 : 0), temperature: num(opts.temperature, 25),
      indicator: typeof opts.indicator === 'string' ? opts.indicator : t.start === 'red' ? (tt.couple === 'mno4' ? 'permanganate' : tt.couple === 'cr2o7' ? 'diphenylamine' : 'ferroin') : null, vmax: null,
    }
    p.name = `${analyte} with ${String(opts.titrant ?? tw)}`
    return p
  }
  if (type === 'edta' || type === 'complexometric') {
    const metal = METALS.find((m) => m.symbol.toLowerCase() === analyte.toLowerCase().replace(/[^a-z0-9]/gi, '') || m.ion.replace(/[^A-Za-z0-9+]/g, '').toLowerCase().startsWith(analyte.toLowerCase().replace(/[^a-z0-9]/gi, '')))
    if (!metal) throw new Error(`EDTA analyte: a metal ion: ${METALS.map((m) => m.symbol).join(', ')}.`)
    if (!(conc > 0)) throw new Error('analyte_conc must be a positive concentration in mol/L.')
    p.mode = 'edta'
    p.edta = {
      metal: edtaMetal(metal.id), conc, volume, water: num(opts.water_mL, 0), titrantConc: tc > 0 ? tc : 0.01, pH: num(opts.pH, 10), ammonia: num(opts.ammonia, 0),
      indicator: typeof opts.indicator === 'string' ? opts.indicator : ['Mg', 'Ca', 'Zn'].includes(metal.symbol) ? 'ebt' : null, customLogK: num(opts.indicator_logK, 5), vmax: null,
    }
    p.name = `${metal.ion} with EDTA`
    return p
  }
  if (type === 'precip' || type === 'precipitation') {
    const key = analyte.toLowerCase().replace(/[^a-z]/g, '')
    p.mode = 'precip'
    if (key === 'ag' || key === 'silver') {
      if (!(conc > 0)) throw new Error('analyte_conc must be a positive concentration in mol/L.')
      p.precip = { ...p.precip, mode: 'thiocyanate-titrant', silver: { conc, volume }, titrantConc: tc > 0 ? tc : 0.05, water: num(opts.water_mL, 0), indicator: 'volhard', iron: num(opts.iron, 0.01) }
      p.name = 'Silver with thiocyanate'
      return p
    }
    const salt = PRECIPITATES.find((x) => x.id === `ag${key}` || (key === 'chloride' && x.id === 'agcl') || (key === 'bromide' && x.id === 'agbr') || (key === 'iodide' && x.id === 'agi') || (key === 'thiocyanate' && x.id === 'agscn') || x.id === key)
    if (!salt) throw new Error('precipitation analyte: Cl-, Br-, I-, SCN-, CN- or Ag+ (Volhard).')
    if (!(conc > 0)) throw new Error('analyte_conc must be a positive concentration in mol/L.')
    p.precip = { ...p.precip, mode: 'silver-titrant', anions: [{ salt: salt.id, conc, volume }], titrantConc: tc > 0 ? tc : conc, water: num(opts.water_mL, 0), indicator: opts.indicator === 'none' ? null : 'mohr', chromate: num(opts.chromate, 0.0025) }
    p.name = `${salt.anion} with silver nitrate`
    return p
  }
  throw new Error('type: acidbase, redox, edta or precip.')
}

/** What the AI gets back from `titrate`: the key points and, for acid–base, the best indicators. */
export function describeTitration(p: Project) {
  const r = computeResult(p)
  const out: Record<string, unknown> = { name: p.name, mode: p.mode, ...summaryOf(r) }
  if (p.mode === 'acidbase' && !r.invalid) {
    const eq = equivalencePoints(p.acidbase)
    const first = eq.findIndex((_, i) => (r.eq[i] ? true : false)) + 1
    if (first > 0) {
      const rk = rankIndicators(p.acidbase, first)
      if (rk) out.suitable_indicators = rk.list.slice(0, 4).map((x) => ({ indicator: x.ind.name, range: `pH ${x.ind.lo}–${x.ind.hi}`, error_percent: x.errorPercent === null ? null : Number(x.errorPercent.toFixed(3)), verdict: x.verdict }))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------- analysing data

export interface AnalysisOutput {
  project: Project
  summary: Record<string, unknown>
}

/** Analyse V/pH arrays: equivalence points, Gran, and the model fit. */
export function analyseArrays(a: Record<string, unknown>, base: Project = newProject()): AnalysisOutput {
  const V = Array.isArray(a.V) ? a.V.map(Number) : []
  const pH = Array.isArray(a.pH) ? a.pH.map(Number) : []
  if (V.length < 5 || V.length !== pH.length || !V.concat(pH).every(Number.isFinite)) throw new Error('V and pH must be equal-length lists of at least 5 numbers (mL and pH).')
  const text = V.map((v, i) => `${v}\t${pH[i]}`).join('\n')
  const parsed = parseData(text)
  const d = parsed.data
  const opts = isObj(a.options) ? a.options : {}
  const aliquot = num(a.aliquot_mL, 25)
  const Ct = num(a.titrant_conc, 0.1)
  const kindId = String(opts.kind ?? 'acid')
  const npk = Math.max(1, Math.min(4, Math.round(num(opts.n_pKa, 1))))
  let setup = { ...setupForKind(kindId, npk, DEFAULT_FIT_SETUP), aliquot, V0: num(opts.total_volume_mL, aliquot), Ct, activity: activityOf(opts.activity), temperature: num(opts.temperature, 25) }
  if (Array.isArray(opts.pKa_guess)) setup = { ...setup, pKa: setup.pKa.map((x, i) => ({ value: num((opts.pKa_guess as unknown[])[i], x.value), fit: true })) }
  const eq = detectEquivalence(d)
  const fit = fitTitration(d, setup)
  const first = eq[0]
  const gran = first
    ? granAnalysis(d, { V0: setup.V0, Ct, aliquot, titrant: setup.titrant, kind: npk === 1 && String(opts.gran ?? 'weak') !== 'strong' ? 'weak' : 'strong', Veq: first.V })
    : null
  const project: Project = {
    ...base, mode: 'acidbase', tab: 'analyse',
    analyse: { ...base.analyse, text: parsed.data.V.map((v, i) => `${v}\t${parsed.data.pH[i]}`).join('\n') + '\n', setup, source: 'supplied by the AI', view: fit.ok ? 'fit' : 'curve', gran: npk === 1 ? 'weak' : 'strong' },
  }
  const summary = {
    points: d.V.length,
    equivalence_points: eq.map((e, i) => ({ n: i + 1, V_mL: Number(fixed(e.V, 3)), pH: Number(fixed(e.pH, 2)), concentration_if_n_protons_M: Number(((Ct * e.V) / (aliquot * (i + 1))).toPrecision(4)) })),
    gran: gran ? { Ve_mL: gran.Ve === null ? null : Number(fixed(gran.Ve, 3)), concentration_M: gran.conc === null ? null : Number(gran.conc.toPrecision(4)) } : null,
    fit: fit.ok
      ? { converged: fit.converged, rmse_pH: Number(fit.rmse.toPrecision(3)), concentration_M: Number(fit.Ca.toPrecision(5)), pKa: fit.pKa.map((x) => Number(x.toFixed(3))), parameters: fit.params.map((q) => ({ name: q.name, value: Number(q.value.toPrecision(5)), se: Number(q.se.toPrecision(2)) })), equivalence_volumes_mL: fit.eq.map((x) => Number(x.toFixed(3))) }
      : { ok: false, message: fit.message },
    warnings: parsed.warnings,
  }
  return { project, summary }
}

// ---------------------------------------------------------------------------------------------- the tools

export function ktitrationTools(h: Hooks): Tools {
  return {
    get_state: async () => {
      const s = h.state()
      const r = computeResult(s.project)
      const text = s.project.analyse.text.trim()
      return {
        name: s.project.name, unsaved: s.dirty, mode: s.project.mode, tab: s.project.tab,
        titration: describeTitration(s.project),
        data: text ? { points: parseData(text).data.V.length, fit: s.fit?.ok ? { concentration_M: Number(s.fit.Ca.toPrecision(5)), pKa: s.fit.pKa, rmse_pH: Number(s.fit.rmse.toPrecision(3)) } : null } : null,
        valid: !r.invalid,
      }
    },

    titrate: async (a, ctx) => {
      const s = h.state()
      let p: Project
      try { p = buildTitration(a) } catch (e) { throw new Error(msg(e)) }
      if (s.dirty && !(await ctx.confirm('Replace the titration shown in kTitration', 'The current titration has unsaved changes that would be lost.'))) throw new Error('The user did not allow replacing the unsaved titration.')
      h.apply(p)
      return describeTitration(p)
    },

    analyse_data: async (a, ctx) => {
      const s = h.state()
      const out = analyseArrays(a, s.project)
      if (s.dirty && !(await ctx.confirm('Replace the data in kTitration', 'The current document has unsaved changes that would be lost.'))) throw new Error('The user did not allow replacing the unsaved document.')
      h.apply(out.project, { runFit: true })
      return out.summary
    },

    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, group: e.group })), note: 'Call load_example with an id to open one.' }
      const ex = findExample(id)
      if (!ex) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      if (h.state().dirty && !(await ctx.confirm(`Open the example “${ex.title}”`, 'The current document has unsaved changes that would be lost.'))) throw new Error('The user did not allow replacing the unsaved document.')
      h.apply(structuredClone(ex.project), { runFit: ex.project.tab === 'analyse' })
      return { loaded: ex.title, description: ex.description, ...describeTitration(ex.project) }
    },
  }
}

export const PKA_COUNT = PKA.length
