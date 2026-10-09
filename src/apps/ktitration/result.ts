// One result shape for every kind of titration (pure): the curve y(V) with its derivatives, the equivalence,
// half-equivalence and buffer marks, the indicator band, the end point and the colour of the flask at any
// volume. The window and the AI tools read this; they never reach into the four models.

import {
  curve, derivative, defaultVmax, endpointError, equivalencePoints, marks, prepare, suitability, titrantAdds,
} from './acidbase.ts'
import { WATER, indicatorById, indicatorColor, indicatorGradient, metalIndicatorById, redoxIndicatorById, type Indicator } from './data/indicators.ts'
import { precipitateById } from './data/metals.ts'
import { defaultVmaxEdta, edtaColor, edtaCurve, edtaEndpoint, edtaMarks, indicatorPM, pMAt } from './edta.ts'
import { fixed, mixColors, pretty, sig } from './format.ts'
import { precipAt, precipCurve, precipEndpoint, precipLook, precipState, defaultVmaxPrecip } from './precip.ts'
import type { Mode, Project } from './project.ts'
import { defaultVmaxRedox, nernstSlope, potentialAt, redoxColor, redoxCurve, redoxEndpoint, redoxMarks, redoxState, formalAt } from './redox.ts'

export interface ResultPoint {
  V: number
  y: number
  label: string
  detail?: string
}

export interface Band {
  name: string
  lo: number
  hi: number
  /** Colours at increasing y. */
  stops: Array<{ y: number; color: string }>
  note?: string
}

export interface EndpointInfo {
  name: string
  V: number | null
  y: number | null
  errorPercent: number | null
}

export interface Look {
  y: number
  color: string
  /** Cloudiness 0–1 (precipitate). */
  cloud: number
}

export interface TitrationResult {
  mode: Mode
  /** Axis title and a short name of the quantity. */
  yLabel: string
  yShort: string
  title: string
  V: number[]
  y: number[]
  dy: number[]
  d2y: number[]
  vmax: number
  /** Whether the quantity rises with the volume. */
  rising: boolean
  start: ResultPoint | null
  eq: ResultPoint[]
  half: ResultPoint[]
  buffer: Array<{ from: number; to: number; label: string }>
  band: Band | null
  endpoint: EndpointInfo | null
  facts: Array<[string, string]>
  notes: string[]
  at(V: number): Look
  /** Set when the titration cannot be computed (the message says why). */
  invalid: string | null
}

const empty = (mode: Mode, msg: string): TitrationResult => ({
  mode, yLabel: '', yShort: '', title: '', V: [], y: [], dy: [], d2y: [], vmax: 1, rising: true, start: null, eq: [], half: [], buffer: [], band: null, endpoint: null,
  facts: [], notes: [], at: () => ({ y: NaN, color: WATER, cloud: 0 }), invalid: msg,
})

function derivs(V: number[], y: number[]) {
  const dy = derivative(V, y)
  const d2y = derivative(V, dy)
  return { dy, d2y }
}

const finite = (xs: number[]) => xs.every((x) => Number.isFinite(x))

export function computeResult(p: Project): TitrationResult {
  try {
    switch (p.mode) {
      case 'acidbase': return acidBaseResult(p)
      case 'redox': return redoxResult(p)
      case 'edta': return edtaResult(p)
      case 'precip': return precipResult(p)
    }
  } catch (e) {
    return empty(p.mode, friendly(e))
  }
}

/** A readable reason for an exception of the numerical code. */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/bracketed/i.test(m)) return 'The equilibrium could not be solved for these values: check the concentrations and volumes (very large or very small numbers).'
  return m
}

// ---------------------------------------------------------------------------------------------- acid–base

/** The colour band of an acid–base indicator for the charts. */
export function indicatorBand(ind: Indicator): Band {
  return {
    name: ind.name, lo: ind.lo, hi: ind.hi,
    stops: indicatorGradient(ind, Math.min(ind.lo, ind.stops?.[0][0] ?? ind.lo), Math.max(ind.hi, ind.stops?.[ind.stops.length - 1][0] ?? ind.hi), 16).map((g) => ({ y: g.pH, color: g.color })),
    ...(ind.note ? { note: ind.note } : {}),
  }
}

function acidBaseResult(p: Project): TitrationResult {
  const s = p.acidbase
  if (s.items.length === 0) return empty('acidbase', 'Add something to the flask: an acid, a base or a mixture.')
  if (!s.items.every((i) => i.conc >= 0 && i.volume >= 0) || s.items.every((i) => i.conc * i.volume === 0)) return empty('acidbase', 'The flask is empty: give the concentration and the volume of the analyte.')
  if (!(s.titrant.conc > 0)) return empty('acidbase', 'Give the concentration of the titrant.')
  const eqs = equivalencePoints(s)
  const c = curve(s)
  if (!finite(c.pH)) return empty('acidbase', 'The pH could not be computed for these values.')
  const m = marks(s)
  const pr = prepare(s)
  const { dy, d2y } = derivs(c.V, c.pH)
  const ind = indicatorById(s.indicator)
  const band: Band | null = ind ? indicatorBand(ind) : null
  const facts: Array<[string, string]> = [['Initial pH', fixed(m.start.pH, 2)]]
  const notes: string[] = []
  m.eq.forEach((e) => {
    facts.push([`Equivalence ${e.index}`, `${fixed(e.V, 2)} mL, pH ${fixed(e.pH, 2)}${e.resolved ? '' : ' (not a clear jump)'}`])
    if (!e.resolved) notes.push(`Equivalence point ${e.index} (${e.label}) shows no clear jump: the next step overlaps, or it is too weak to titrate in water.`)
  })
  m.half.forEach((h) => facts.push([`Half-equivalence (pKa ${fixed(h.pKa, 2)})`, `${fixed(h.V, 2)} mL, pH ${fixed(h.pH, 2)}`]))
  let endpoint: EndpointInfo | null = null
  if (ind && !ind.stops) {
    // judged against the equivalence point with the biggest jump near the indicator's colour change
    let best: ReturnType<typeof endpointError> | null = null
    for (let k = 1; k <= eqs.length; k++) {
      const r = endpointError(s, ind.pKin, k)
      if (r.V !== null && (best === null || Math.abs(r.errorPercent ?? 1e9) < Math.abs(best.errorPercent ?? 1e9))) best = r
    }
    if (best && best.V !== null) {
      endpoint = { name: ind.name, V: best.V, y: ind.pKin, errorPercent: best.errorPercent }
      facts.push([`${ind.name} changes`, `${fixed(best.V, 2)} mL (pH ${fixed(ind.pKin, 2)}): error ${fixed(best.errorPercent ?? NaN, 2)} % at equivalence ${best.eqIndex}, ${suitability(best.errorPercent)}`])
    } else notes.push(`${ind.name} never changes colour on this curve.`)
  }
  if (s.activity !== 'none') notes.push(`Activity coefficients: ${s.activity === 'davies' ? 'Davies equation' : 'extended Debye–Hückel'}; pH here is −log a(H⁺). Ionic strength at the start ${sig(c.I[0], 3)} M.`)
  if (s.temperature !== 25) notes.push(`Temperature ${s.temperature} °C: pKw changes the neutral point and the pKa values follow their temperature coefficients where the database has them.`)
  const first = s.items[0]
  return {
    mode: 'acidbase', yLabel: 'pH', yShort: 'pH', title: `${s.items.map((i) => i.label).join(' + ')} with ${s.titrant.label}`,
    V: c.V, y: c.pH, dy, d2y, vmax: defaultVmax(s), rising: titrantAdds(s.titrant) === 'base',
    start: { V: 0, y: m.start.pH, label: 'Start' },
    eq: m.eq.map((e) => ({ V: e.V, y: e.pH, label: `EP${e.index}`, detail: e.label })),
    half: m.half.map((h) => ({ V: h.V, y: h.pH, label: `½ (pKa ${fixed(h.pKa, 2)})` })),
    buffer: m.buffer.map((b) => ({ from: b.from, to: b.to, label: `buffer, pKa ${fixed(b.pKa, 2)}` })),
    band, endpoint, facts, notes,
    at: (V) => {
      const pH = pr.ph(V)
      return { y: pH, color: ind ? indicatorColor(ind, pH) : WATER, cloud: 0 }
    },
    invalid: first ? null : 'Empty flask',
  }
}

// ---------------------------------------------------------------------------------------------- redox

function redoxResult(p: Project): TitrationResult {
  const s = p.redox
  if (!(s.analyte.conc > 0) || !(s.analyte.volume > 0) || !(s.titrant.conc > 0)) return empty('redox', 'Give the concentrations and the sample volume.')
  const st = redoxState(s)
  const c = redoxCurve(s)
  const y = c.E
  if (!finite(y)) return empty('redox', 'The potential could not be computed for these values.')
  const { dy, d2y } = derivs(c.V, y)
  const mk = redoxMarks(s)
  const ind = redoxIndicatorById(s.indicator)
  const ep = redoxEndpoint(s)
  const k = nernstSlope(s.temperature)
  const band: Band | null = ind && ep.range ? { name: ind.name, lo: ep.range[0], hi: ep.range[1], stops: [{ y: ep.range[0] - 0.1, color: ind.red }, { y: ind.E0, color: mixColors(ind.red, ind.ox, 0.5) }, { y: ep.range[1] + 0.1, color: ind.ox }], ...(ind.note ? { note: ind.note } : {}) } : null
  const a = s.analyte.couple
  const t = s.titrant.couple
  const facts: Array<[string, string]> = [
    ['Equivalence volume', `${fixed(st.Veq, 3)} mL`],
    ['E at equivalence (solved)', `${fixed(mk.Eeq, 4)} V`],
    ['E at equivalence (weighted mean)', `${fixed(mk.EeqFormula, 4)} V${a.b === 1 && t.b === 1 ? '' : ' (exact only when both couples have one reduced species)'}`],
    [`E at ½ V_eq`, `${fixed(mk.Ehalf, 4)} V (analyte formal potential ${fixed(formalAt(a, s.pH, s.temperature), 3)} V)`],
    ['Jump across ±0.1 %', `${fixed(mk.jump, 3)} V`],
    ['Nernst slope', `${fixed(k * 1000, 2)} mV/decade per electron`],
  ]
  if (ep.indicator && ep.V !== null) facts.push([`${ep.indicator.name} changes`, `${fixed(ep.V, 3)} mL (E ${fixed(ep.indicator.E0, 3)} V): error ${fixed(ep.errorPercent ?? NaN, 2)} %`])
  const notes: string[] = []
  if (a.m || t.m) notes.push(`The couples that consume H⁺ depend on pH: formal potentials here are at pH ${s.pH}.`)
  if (ind && ep.V === null) notes.push(`${ind.name} never changes colour on this curve.`)
  const arrow = a.n === t.n ? '' : ` (n = ${a.n} and ${t.n})`
  return {
    mode: 'redox', yLabel: 'E (V vs SHE)', yShort: 'E', title: `${a.red && s.analyte.start === 'red' ? a.red : a.ox} with ${s.analyte.start === 'red' ? t.ox : t.red}${arrow}`,
    V: c.V, y, dy, d2y, vmax: defaultVmaxRedox(s), rising: s.analyte.start === 'red',
    start: null, eq: [{ V: st.Veq, y: mk.Eeq, label: 'EP', detail: 'equivalence point' }],
    half: [{ V: st.Veq / 2, y: mk.Ehalf, label: '½ V_eq' }], buffer: [], band,
    endpoint: ep.indicator && ep.V !== null ? { name: ep.indicator.name, V: ep.V, y: ep.indicator.E0, errorPercent: ep.errorPercent } : null,
    facts, notes, at: (V) => ({ y: potentialAt(s, Math.max(V, 1e-9)), color: redoxColor(s, V), cloud: 0 }), invalid: null,
  }
}

// ---------------------------------------------------------------------------------------------- EDTA

function edtaResult(p: Project): TitrationResult {
  const s = p.edta
  if (!(s.conc > 0) || !(s.volume > 0) || !(s.titrantConc > 0)) return empty('edta', 'Give the metal concentration, the sample volume and the EDTA concentration.')
  const c = edtaCurve(s)
  if (!finite(c.pM)) return empty('edta', 'The curve could not be computed for these values.')
  const { dy, d2y } = derivs(c.V, c.pM)
  const mk = edtaMarks(s)
  const ep = edtaEndpoint(s)
  const ind = metalIndicatorById(s.indicator === 'custom' ? 'ebt' : s.indicator)
  const pMt = indicatorPM(s)
  const band: Band | null = ind && pMt !== null ? { name: s.indicator === 'custom' ? 'Custom indicator' : ind.name, lo: pMt - 1, hi: pMt + 1, stops: [{ y: pMt - 1.5, color: ind.bound }, { y: pMt, color: mixColors(ind.bound, ind.free, 0.5) }, { y: pMt + 1.5, color: ind.free }], ...(ind.note ? { note: ind.note } : {}) } : null
  const metal = s.metal.ion
  const facts: Array<[string, string]> = [
    ['Equivalence volume', `${fixed(mk.Veq, 3)} mL`],
    ['α(Y⁴⁻) at this pH', sig(mk.alphaY, 3)],
    [`α(${metal}) side reactions`, sig(mk.alphaM, 4)],
    ["log K′f (conditional)", `${fixed(mk.logKcond, 2)} (log K_f ${s.metal.logKMY})`],
    ['pM at start', fixed(mk.pM0, 2)],
    ['pM at equivalence', `${fixed(mk.pMeq, 2)} (formula ${fixed(mk.pMeqFormula, 2)})`],
    ['Jump across ±0.1 %', `${fixed(mk.jump, 2)} pM units`],
  ]
  const notes: string[] = []
  if (mk.logKcond < 7) notes.push('log K′f below ~7: the end point is poor. Raise the pH (if the metal does not precipitate) or use a back titration.')
  if (ep.pM !== null && ep.V !== null) facts.push([`Indicator changes`, `${fixed(ep.V, 3)} mL (pM ${fixed(ep.pM, 2)}): error ${fixed(ep.errorPercent ?? NaN, 2)} %`])
  else if (s.indicator && s.indicator !== 'custom') notes.push(`${ind?.name ?? 'The indicator'} has no data for ${metal}: choose “custom” and give log K′ of the metal–indicator complex.`)
  return {
    mode: 'edta', yLabel: `pM (p${s.metal.symbol})`, yShort: `p${s.metal.symbol}`, title: `${metal} with EDTA at pH ${s.pH}`,
    V: c.V, y: c.pM, dy, d2y, vmax: defaultVmaxEdta(s), rising: true,
    start: { V: 0, y: mk.pM0, label: 'Start' }, eq: [{ V: mk.Veq, y: mk.pMeq, label: 'EP', detail: 'equivalence point' }], half: [], buffer: [], band,
    endpoint: ep.V !== null && ep.pM !== null ? { name: 'Indicator', V: ep.V, y: ep.pM, errorPercent: ep.errorPercent } : null,
    facts, notes, at: (V) => ({ y: pMAt(s, V), color: edtaColor(s, V), cloud: 0 }), invalid: null,
  }
}

// ---------------------------------------------------------------------------------------------- precipitation

function precipResult(p: Project): TitrationResult {
  const s = p.precip
  if (!(s.titrantConc > 0)) return empty('precip', 'Give the concentration of the titrant.')
  if (s.mode === 'silver-titrant' && (s.anions.length === 0 || s.anions.every((a) => a.conc * a.volume === 0))) return empty('precip', 'Add an anion to the flask (chloride, bromide, iodide…).')
  if (s.mode === 'thiocyanate-titrant' && !(s.silver.conc * s.silver.volume > 0)) return empty('precip', 'Give the concentration and the volume of the silver solution.')
  const c = precipCurve(s)
  if (!finite(c.pAg)) return empty('precip', 'The curve could not be computed for these values.')
  const { dy, d2y } = derivs(c.V, c.pAg)
  const st = precipState(s)
  const ep = precipEndpoint(s)
  const facts: Array<[string, string]> = st.eq.map((e, i): [string, string] => {
    const sol = precipAt(s, e.V)
    return [`Equivalence ${i + 1} (${precipitateById(e.salt)?.formula ?? e.label})`, `${fixed(e.V, 3)} mL, pAg ${fixed(sol.pAg, 2)}`]
  })
  const notes: string[] = []
  if (ep.indicator && ep.V !== null) {
    facts.push([ep.indicator === 'mohr' ? 'Mohr end point (Ag₂CrO₄ appears)' : 'Volhard end point (FeSCN²⁺ red)', `${fixed(ep.V, 3)} mL: error ${fixed(ep.errorPercent ?? NaN, 2)} %`])
    notes.push(ep.indicator === 'mohr' ? 'Mohr: neutral to weakly basic solutions only (pH 6.5–10). Chromate must be present at a moderate concentration; the end point comes slightly late.' : 'Volhard: titrate in acid (≥ 0.3 M HNO₃) so Fe³⁺ stays dissolved; for chloride, remove the AgCl or add nitrobenzene to stop it reacting with SCN⁻.')
  }
  const eqs = st.eq
  return {
    mode: 'precip', yLabel: 'pAg', yShort: 'pAg',
    title: s.mode === 'silver-titrant' ? `${s.anions.map((a) => precipitateById(a.salt)?.anion ?? a.salt).join(' + ')} with AgNO₃` : 'Ag⁺ with KSCN (Volhard)',
    V: c.V, y: c.pAg, dy, d2y, vmax: defaultVmaxPrecip(s), rising: s.mode === 'thiocyanate-titrant',
    start: null, eq: eqs.map((e, i) => ({ V: e.V, y: precipAt(s, e.V).pAg, label: `EP${i + 1}`, detail: e.label })), half: [], buffer: [], band: null,
    endpoint: ep.V !== null ? { name: ep.indicator === 'mohr' ? 'Mohr (chromate)' : 'Volhard (Fe³⁺)', V: ep.V, y: precipAt(s, ep.V).pAg, errorPercent: ep.errorPercent } : null,
    facts, notes, at: (V) => {
      const l = precipLook(s, V)
      return { y: precipAt(s, Math.max(V, 1e-9)).pAg, color: l.color, cloud: l.cloud }
    }, invalid: null,
  }
}

// ---------------------------------------------------------------------------------------------- helpers for text

/** One line per fact, for reports and the AI. */
export function factsText(r: TitrationResult): string {
  return r.facts.map(([k, v]) => `${k}: ${v}`).join('\n')
}

/** Just enough numbers for an AI to answer with: no arrays. */
export function summaryOf(r: TitrationResult) {
  if (r.invalid) return { ok: false, problem: r.invalid }
  return {
    ok: true,
    quantity: r.yShort,
    title: r.title,
    start: r.start ? { V_mL: 0, value: Number(r.start.y.toFixed(3)) } : null,
    equivalence: r.eq.map((e) => ({ V_mL: Number(e.V.toFixed(3)), value: Number(e.y.toFixed(3)), what: e.detail ?? e.label })),
    half_equivalence: r.half.map((h) => ({ V_mL: Number(h.V.toFixed(3)), value: Number(h.y.toFixed(3)), what: h.label })),
    endpoint: r.endpoint ? { indicator: r.endpoint.name, V_mL: r.endpoint.V === null ? null : Number(r.endpoint.V.toFixed(3)), error_percent: r.endpoint.errorPercent === null ? null : Number(r.endpoint.errorPercent.toFixed(3)) } : null,
    facts: Object.fromEntries(r.facts),
    notes: r.notes,
  }
}

export { pretty }

// ---------------------------------------------------------------------------------------------- where the titration is

/** A sentence about the state of the flask at volume V. */
export function phaseAt(r: TitrationResult, V: number): string {
  if (r.invalid || !r.eq.length) return ''
  if (V <= 0) return 'Nothing added yet.'
  for (let i = 0; i < r.eq.length; i++) {
    const e = r.eq[i]
    if (Math.abs(V - e.V) <= Math.max(0.005 * e.V, 0.004)) return `At equivalence point ${i + 1}${e.detail ? `: ${e.detail}` : ''}.`
  }
  const first = r.eq[0]
  const last = r.eq[r.eq.length - 1]
  for (const b of r.buffer) if (V >= b.from && V <= b.to) return `In a buffer region (${b.label}).`
  if (V < first.V) return r.eq.length > 1 ? 'Before the first equivalence point.' : 'Before the equivalence point: the analyte is in excess.'
  if (V > last.V) return 'Past the last equivalence point: titrant is in excess.'
  const k = r.eq.findIndex((e) => e.V > V)
  return `Between equivalence points ${k} and ${k + 1}.`
}

export interface SpeciesBar {
  label: string
  parts: Array<{ name: string; fraction: number }>
}

/** The species of every weak system in the flask at volume V (acid–base titrations only). */
export function speciesAt(p: Project, V: number, forms: (item: Project['acidbase']['items'][number]) => string[]): SpeciesBar[] {
  if (p.mode !== 'acidbase') return []
  try {
    const sol = prepare(p.acidbase).at(V)
    const weak = p.acidbase.items.filter((i) => i.kind === 'weak')
    const bars: SpeciesBar[] = weak.map((it, k) => ({ label: it.label, parts: sol.systems[k].alpha.map((a, j) => ({ name: forms(it)[j] ?? `species ${j}`, fraction: a })) }))
    if (p.acidbase.titrant.kind === 'weak-base' || p.acidbase.titrant.kind === 'weak-acid') {
      const k = weak.length
      const t = p.acidbase.titrant
      if (sol.systems[k]) bars.push({ label: t.label, parts: sol.systems[k].alpha.map((a, j) => ({ name: `species ${j}`, fraction: a })) })
    }
    return bars
  } catch {
    return []
  }
}
