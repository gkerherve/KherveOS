// kChem's chemistry: formulas (brackets, hydrate dots, subscripts, charges), molar masses
// and composition, isotope patterns, empirical formulas, mass for a solution, dilution.
// Atomic weights are the IUPAC standard values (rounded), elements 1–118 (elements.ts).
// Pure functions: no React, no OS.

import { ATOMIC_WEIGHTS, ELECTRON_MASS, ISOTOPES } from './elements.ts'

export const ATOMIC_WEIGHT: Record<string, number> = ATOMIC_WEIGHTS

export type Counts = Record<string, number>

const SUBSCRIPTS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }
const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
}

function addInto(into: Counts, from: Counts, times: number) {
  for (const [el, n] of Object.entries(from)) into[el] = (into[el] ?? 0) + n * times
}

/** The atoms of one formula part (no hydrate dots, no charge). */
function countPart(s: string): Counts {
  const stack: Counts[] = [{}]
  let i = 0
  const number = (): number => {
    const start = i
    while (i < s.length && /\d/.test(s[i])) i++
    return i > start ? Number(s.slice(start, i)) : 1
  }
  while (i < s.length) {
    const c = s[i]
    if ('([{'.includes(c)) {
      stack.push({})
      i++
    } else if (')]}'.includes(c)) {
      i++
      const group = stack.pop()
      if (!group || stack.length === 0) throw new Error(`Unmatched "${c}" in the formula.`)
      addInto(stack[stack.length - 1], group, number())
    } else if (/[A-Z]/.test(c)) {
      let sym = c
      i++
      if (i < s.length && /[a-z]/.test(s[i])) sym += s[i++]
      if (!(sym in ATOMIC_WEIGHT)) throw new Error(`"${sym}" is not an element (symbols are case-sensitive: Co is cobalt, CO is carbon monoxide).`)
      stack[stack.length - 1][sym] = (stack[stack.length - 1][sym] ?? 0) + number()
    } else {
      throw new Error(`Unexpected "${c}" in the formula.`)
    }
  }
  if (stack.length !== 1) throw new Error('A bracket is not closed.')
  return stack[0]
}

/** Unicode super/subscripts and minus signs to plain text; superscript runs become ^2-. */
function plain(formula: string): string {
  return formula
    .replace(/[₀-₉]/g, (d) => SUBSCRIPTS[d])
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) => '^' + [...run].map((c) => SUPERSCRIPTS[c]).join(''))
    .replace(/[−–﹣－]/g, '-')
    .replace(/[•⋅∙*]/g, '·')
}

/** The phase marker "(s)", "(l)", "(g)" or "(aq)" at the end of a species. */
export function splitPhase(s: string): { body: string; phase: string } {
  const m = /^(.*\S)\s*\((s|l|g|aq)\)\s*$/.exec(s.trim())
  return m ? { body: m[1], phase: m[2] } : { body: s.trim(), phase: '' }
}

/**
 * Splits a charge off the end of a formula: "SO4^2-", "Fe3+", "NH4+", "Cr2O72-", "CO3 2-", "Cl-".
 * Without a caret a lone digit before the sign is a charge for a single atom (Fe3+, Al3+) and
 * a subscript otherwise (NH4+, NO3-); use ^ to be explicit (O2^-, SO4^2-).
 */
export function splitCharge(input: string): { body: string; charge: number } {
  const s = input.trim()
  const sign = (c: string) => (c === '+' ? 1 : -1)
  let m = /^(.*?)\s*\^\s*\{?\s*(\d*)\s*([+-]+)\s*\}?$/.exec(s)
  if (m) return { body: m[1], charge: sign(m[3][0]) * (m[2] ? Number(m[2]) : m[3].length) }
  m = /^(.*?)\s*\^\s*\{?\s*([+-])\s*(\d+)\s*\}?$/.exec(s)
  if (m) return { body: m[1], charge: sign(m[2]) * Number(m[3]) }
  m = /^(.*\S)\s+(\d*)([+-]+)$/.exec(s)
  if (m) return { body: m[1], charge: sign(m[3][0]) * (m[2] ? Number(m[2]) : m[3].length) }
  m = /^(.*[A-Za-z)\]\d])([+-]+)$/.exec(s)
  if (!m) {
    if (/^[+-]$/.test(s)) return { body: s, charge: 0 }
    return { body: s, charge: 0 }
  }
  const rest = m[1]
  const signs = m[2]
  if (signs.length > 1) return { body: rest, charge: sign(signs[0]) * signs.length }
  const d = /(\d+)$/.exec(rest)
  if (d && d[1].length >= 2) return { body: rest.slice(0, -1), charge: sign(signs) * Number(d[1].slice(-1)) }
  if (d && d[1].length === 1 && /^[A-Z][a-z]?$/.test(rest.slice(0, -1))) return { body: rest.slice(0, -1), charge: sign(signs) * Number(d[1]) }
  return { body: rest, charge: sign(signs) }
}

export interface Species {
  atoms: Counts
  charge: number
  /** The formula without charge and phase. */
  body: string
  phase: string
  /** True for the electron "e-" (half-reactions). */
  electron: boolean
}

/** Parses a formula that may carry a charge and a phase: "SO4^2-", "Fe3+(aq)", "CuSO4·5H2O", "e-". */
export function parseSpecies(formula: string): Species {
  const text = plain(formula)
  if (!text.replace(/\s+/g, '')) throw new Error('Type a formula, e.g. H2O or CuSO4·5H2O.')
  const { body: unphased, phase } = splitPhase(text)
  const { body: raw, charge } = splitCharge(unphased)
  const body = raw.replace(/\s+/g, '')
  if (body === 'e' && charge !== 0) return { atoms: {}, charge, body, phase, electron: true }
  if (body === 'e' && /^e\^?$/.test(body)) throw new Error('An electron is written e- (or e^-).')
  if (!body) throw new Error('Type a formula, e.g. H2O or CuSO4·5H2O.')
  const total: Counts = {}
  for (const part of body.replace(/\./g, '·').split('·')) {
    const m = /^(\d+\/\d+|½|\d+)(.*)$/.exec(part)
    let times = 1
    let rest = part
    if (m) {
      rest = m[2]
      if (m[1] === '½') times = 0.5
      else if (m[1].includes('/')) {
        const [a, b] = m[1].split('/').map(Number)
        times = a / b
      } else times = Number(m[1])
    }
    if (!rest) throw new Error('A hydrate part needs a formula, e.g. "·5H2O".')
    addInto(total, countPart(rest), times)
  }
  return { atoms: total, charge, body, phase, electron: false }
}

/** The atoms of a formula: "Ca(OH)2", "CuSO4·5H2O" (hydrate), "Fe₂O₃". A charge ("SO4^2-") is ignored here. */
export function parseFormula(formula: string): Counts {
  return parseSpecies(formula).atoms
}

/** Molar mass in g/mol (the mass of electrons of ions is neglected). */
export function molarMass(formula: string): number {
  return countsMass(parseFormula(formula))
}

export function countsMass(atoms: Counts): number {
  return Object.entries(atoms).reduce((s, [el, n]) => s + ATOMIC_WEIGHT[el] * n, 0)
}

/** Mass percent of each element. */
export function composition(formula: string): { element: string; count: number; percent: number }[] {
  const atoms = parseFormula(formula)
  const M = countsMass(atoms)
  return Object.entries(atoms)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([element, count]) => ({ element, count, percent: (100 * ATOMIC_WEIGHT[element] * count) / M }))
}

/** The formula in Hill order (C, H, then the rest alphabetically; all alphabetical without carbon). */
export function hillFormula(atoms: Counts): string {
  const els = Object.keys(atoms).filter((e) => atoms[e] > 0)
  const rest = els.filter((e) => e !== 'C' && e !== 'H').sort()
  const order = 'C' in atoms ? ['C', ...(els.includes('H') ? ['H'] : []), ...rest] : els.sort()
  return order.map((e) => e + (atoms[e] === 1 ? '' : trimNumber(atoms[e]))).join('')
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

/** Degrees of unsaturation (rings + double bonds) of an organic formula, or null without carbon. */
export function unsaturation(atoms: Counts, charge = 0): number | null {
  if (!atoms.C) return null
  const halogens = (atoms.F ?? 0) + (atoms.Cl ?? 0) + (atoms.Br ?? 0) + (atoms.I ?? 0)
  const group15 = (atoms.N ?? 0) + (atoms.P ?? 0)
  const v = (2 * atoms.C + 2 + group15 - (atoms.H ?? 0) - halogens + charge) / 2
  return Number.isInteger(v) && v >= 0 ? v : null
}

// ------------------------------------------------------------ typeset

export interface FormulaPart {
  text: string
  kind: 'n' | 'sub' | 'sup'
}

/** A formula split into normal / subscript / superscript parts: "SO4^2-" → SO, ₄, ²⁻. */
export function typeset(formula: string): FormulaPart[] {
  const text = plain(formula)
  const { body: unphased, phase } = splitPhase(text)
  let body = unphased
  let charge = 0
  try {
    const c = splitCharge(unphased)
    body = c.body
    charge = c.charge
  } catch {
    /* leave as typed */
  }
  const parts: FormulaPart[] = []
  const push = (t: string, kind: FormulaPart['kind']) => {
    if (!t) return
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += t
    else parts.push({ text: t, kind })
  }
  body = body.replace(/\s+/g, '')
  let atStart = true
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (/\d/.test(c)) {
      let j = i
      while (j < body.length && /\d/.test(body[j])) j++
      const run = body.slice(i, j)
      const prev = body[i - 1]
      // digits are a subscript after an element or a closing bracket; a coefficient at the start or after "·"
      push(run, !atStart && prev !== undefined && /[A-Za-z)\]}]/.test(prev) ? 'sub' : 'n')
      i = j - 1
    } else {
      push(c, 'n')
    }
    atStart = c === '·' || c === '/' ? true : false
  }
  if (charge !== 0) push(`${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '−'}`, 'sup')
  if (phase) push(`(${phase})`, 'n')
  return parts
}

// ------------------------------------------------------------ masses and isotopes

export interface IsotopePeak {
  /** Mass of the peak in u (m/z for ions). */
  mass: number
  /** Nominal (integer) mass of the cluster. */
  nominal: number
  /** Relative abundance, the tallest peak = 100. */
  abundance: number
  /** Probability among all isotopologues. */
  fraction: number
}

export interface MassInfo {
  average: number
  /** Mass of the most abundant isotope of each element. */
  monoisotopic: number
  charge: number
  /** m/z of the monoisotopic ion, or null for a neutral. */
  mz: number | null
  /** Elements without a natural isotope table (a single peak at the atomic weight is used). */
  approximate: string[]
  peaks: IsotopePeak[]
  /** True when the formula is too big for a pattern (the peaks are then left out). */
  tooBig: boolean
}

interface Dist {
  [nominal: number]: { p: number; pm: number }
}

function convolve(a: Dist, b: Dist): Dist {
  const out: Dist = {}
  for (const [ka, va] of Object.entries(a)) {
    const ma = va.pm / va.p
    for (const [kb, vb] of Object.entries(b)) {
      const k = Number(ka) + Number(kb)
      const p = va.p * vb.p
      const o = out[k] ?? (out[k] = { p: 0, pm: 0 })
      o.p += p
      o.pm += p * (ma + vb.pm / vb.p)
    }
  }
  const max = Math.max(...Object.values(out).map((v) => v.p))
  for (const k of Object.keys(out)) if (out[Number(k)].p < max * 1e-12) delete out[Number(k)]
  return out
}

function elementDist(el: string): { dist: Dist; known: boolean } {
  const iso = ISOTOPES[el]
  const dist: Dist = {}
  if (!iso) {
    dist[Math.round(ATOMIC_WEIGHT[el])] = { p: 1, pm: ATOMIC_WEIGHT[el] }
    return { dist, known: false }
  }
  const total = iso.reduce((s, i) => s + i.abundance, 0)
  for (const i of iso) {
    const k = Math.round(i.mass)
    const p = i.abundance / total
    const o = dist[k] ?? (dist[k] = { p: 0, pm: 0 })
    o.p += p
    o.pm += p * i.mass
  }
  return { dist, known: true }
}

/** The mass of the most abundant isotope of an element (its atomic weight when it has no table). */
export function monoisotopicOf(el: string): number {
  const iso = ISOTOPES[el]
  if (!iso) return ATOMIC_WEIGHT[el]
  return iso.reduce((best, i) => (i.abundance > best.abundance ? i : best)).mass
}

/** Average and monoisotopic mass of a formula, and its isotope pattern (mass-spec peaks). */
export function massInfo(formula: string, minRelative = 0.01): MassInfo {
  const sp = parseSpecies(formula)
  const atoms = sp.atoms
  let mono = 0
  const approximate: string[] = []
  let dist: Dist = { 0: { p: 1, pm: 0 } }
  // the width of the pattern grows with sqrt(atoms × variance): beyond ~200 u of spread it is not computed
  let variance = 0
  const parts: { d: Dist; n: number }[] = []
  for (const [el, n] of Object.entries(atoms)) {
    mono += monoisotopicOf(el) * n
    const { dist: d, known } = elementDist(el)
    if (!known) approximate.push(el)
    const vals = Object.entries(d).map(([k, v]) => [Number(k), v.p] as const)
    const mean = vals.reduce((a, [k, p]) => a + k * p, 0)
    variance += Math.max(0, Math.round(n)) * vals.reduce((a, [k, p]) => a + p * (k - mean) ** 2, 0)
    parts.push({ d, n: Math.max(0, Math.round(n)) })
  }
  const tooBig = variance > 46000
  if (!tooBig) {
    for (const part of parts) {
      // d^n by repeated squaring
      let k = part.n
      let base = part.d
      while (k > 0) {
        if (k % 2 === 1) dist = convolve(dist, base)
        k = Math.floor(k / 2)
        if (k > 0) base = convolve(base, base)
      }
    }
  }
  const q = sp.charge
  const shift = (m: number) => (q === 0 ? m : (m - q * ELECTRON_MASS) / Math.abs(q))
  const maxP = Math.max(...Object.values(dist).map((v) => v.p))
  const peaks = tooBig ? [] : Object.entries(dist)
    .map(([k, v]) => ({ mass: shift(v.pm / v.p), nominal: Number(k), abundance: (100 * v.p) / maxP, fraction: v.p }))
    .filter((p) => p.abundance >= minRelative)
    .sort((a, b) => a.nominal - b.nominal)
  return {
    average: countsMass(atoms),
    monoisotopic: mono,
    charge: q,
    mz: q === 0 ? null : shift(mono),
    approximate,
    peaks,
    tooBig,
  }
}

// ------------------------------------------------------------ empirical formula

export interface EmpiricalInput {
  element: string
  /** Percent, grams or moles (see `mode`). */
  amount: number
}

export interface EmpiricalResult {
  /** The empirical formula in Hill order, e.g. "CH2O". */
  empirical: string
  atoms: Counts
  empiricalMass: number
  /** Ratios of the moles to the smallest one. */
  ratios: Record<string, number>
  /** The factor the ratios were multiplied by to make whole numbers. */
  factor: number
  /** With a molar mass: the molecular formula and the multiple of the empirical formula. */
  molecular: string | null
  multiple: number | null
}

/**
 * The empirical formula from a composition (percent or grams: they are divided by the atomic
 * weights) or from moles; with a molar mass also the molecular formula.
 */
export function empiricalFormula(
  input: EmpiricalInput[],
  mode: 'percent' | 'mass' | 'moles' = 'percent',
  molarMassGiven: number | null = null,
  tolerance = 0.07,
): EmpiricalResult {
  const rows = input.filter((r) => r.element.trim() !== '')
  if (rows.length === 0) throw new Error('Give at least one element and its amount.')
  const seen = new Set<string>()
  const moles: [string, number][] = []
  for (const r of rows) {
    const el = r.element.trim()
    if (!(el in ATOMIC_WEIGHT)) throw new Error(`"${el}" is not an element symbol.`)
    if (!(r.amount >= 0) || !Number.isFinite(r.amount)) throw new Error(`The amount of ${el} must be a number of zero or more.`)
    if (seen.has(el)) throw new Error(`${el} is listed twice.`)
    seen.add(el)
    if (r.amount > 0) moles.push([el, mode === 'moles' ? r.amount : r.amount / ATOMIC_WEIGHT[el]])
  }
  if (moles.length === 0) throw new Error('All the amounts are zero.')
  const min = Math.min(...moles.map(([, n]) => n))
  const ratios: Record<string, number> = Object.fromEntries(moles.map(([e, n]) => [e, n / min]))
  let factor = 0
  for (let k = 1; k <= 12; k++) {
    if (Object.values(ratios).every((r) => Math.abs(r * k - Math.round(r * k)) <= tolerance * Math.max(1, Math.sqrt(k)))) {
      factor = k
      break
    }
  }
  if (factor === 0) throw new Error('These amounts do not give small whole-number ratios: check the percentages (they should add up to about 100 %).')
  const atoms: Counts = Object.fromEntries(moles.map(([e]) => [e, Math.round(ratios[e] * factor)]))
  const empiricalMass = countsMass(atoms)
  let molecular: string | null = null
  let multiple: number | null = null
  if (molarMassGiven !== null && Number.isFinite(molarMassGiven) && molarMassGiven > 0) {
    const m = Math.round(molarMassGiven / empiricalMass)
    if (m >= 1 && Math.abs(molarMassGiven / empiricalMass - m) / m < 0.12) {
      multiple = m
      molecular = hillFormula(Object.fromEntries(Object.entries(atoms).map(([e, n]) => [e, n * m])))
    } else {
      throw new Error(`The molar mass ${fmt(molarMassGiven)} g/mol is not a whole multiple of the empirical mass ${fmt(empiricalMass)} g/mol.`)
    }
  }
  return { empirical: hillFormula(atoms), atoms, empiricalMass, ratios, factor, molecular, multiple }
}

// ------------------------------------------------------------ solutions

/** Grams to weigh out for a solution: molarity (mol/L) × volume (mL) × molar mass. */
export function massForSolution(formula: string, molarity: number, volumeMl: number): number {
  return molarity * (volumeMl / 1000) * molarMass(formula)
}

/**
 * Dilution C1·V1 = C2·V2. Give three of the four values; the missing one (null) is solved.
 */
export function dilution(c1: number | null, v1: number | null, c2: number | null, v2: number | null): { c1: number; v1: number; c2: number; v2: number } {
  const vals = [c1, v1, c2, v2]
  const missing = vals.filter((v) => v === null).length
  if (missing !== 1) throw new Error('Leave exactly one of the four values empty: that is the one to find.')
  if (c1 === null) return { c1: ((c2 as number) * (v2 as number)) / (v1 as number), v1: v1 as number, c2: c2 as number, v2: v2 as number }
  if (v1 === null) return { c1, v1: (c2 as number) * (v2 as number) / c1, c2: c2 as number, v2: v2 as number }
  if (c2 === null) return { c1, v1, c2: (c1 * v1) / (v2 as number), v2: v2 as number }
  return { c1, v1, c2, v2: (c1 * v1) / c2 }
}

// ------------------------------------------------------------ numbers

let SIG = 4

/** The significant figures `fmt` uses (2–10), the user's setting. */
export function setSigFigs(n: number) {
  SIG = Math.min(10, Math.max(2, Math.round(n) || 4))
}
export function getSigFigs(): number {
  return SIG
}

/** A number for people, with the chosen significant figures (4 by default). */
export function fmt(v: number, sig: number = SIG): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '–'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-3) return v.toExponential(sig - 1).replace('e+', 'e')
  return String(Number(v.toPrecision(sig)))
}

/** Parses a number typed in a box: comma or point, empty = null, junk = NaN. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.').replace(/\s+/g, '')
  if (t === '') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : NaN
}
