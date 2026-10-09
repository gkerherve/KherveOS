// Buffer design (pure): how much of each component gives a buffer of a target pH, total concentration and ionic
// strength, exactly (charge balance at the target pH, activities optional), the volumes of stock solutions for a
// final volume, the buffer capacity, and what the temperature does to the pH of the recipe.

import {
  alphas, bufferCapacity, counterIons, pKaMixed, solve, netCharge, type ActivityModel, type Dissolved, type Ion, type Medium, type System,
} from './equilibria.ts'

export type BufferMode = 'salts' | 'acid-base' | 'base-acid'

export interface BufferSpec {
  /** The buffer system and, where it came from, the database id. */
  sys: System
  lib: string | null
  /** Names of the species (index = protons lost), for the recipe; may be empty. */
  forms: string[]
  /** 'salts': two forms of the system (NaH₂PO₄ + Na₂HPO₄); 'acid-base': acid form + strong base (HAc + NaOH); 'base-acid': base form + strong acid (Tris + HCl). */
  mode: BufferMode
  /** The two forms used (indices; for the one-form modes `formA` is the form weighed in). */
  formA: number
  formB: number
  /** Target pH, total concentration of the buffer system (mol/L), final volume (mL). */
  pH: number
  conc: number
  volume: number
  /** Temperature at which the pH is wanted (°C). */
  temperature: number
  activity: ActivityModel
  /** Target ionic strength (mol/L), or null to leave it as it comes. */
  ionicStrength: number | null
  /** Stock solutions: concentration of each component stock (mol/L). */
  stockA: number
  stockB: number
  /** Name of the counter-ion salt and the strong reagent for the labels. */
  cation: string
  anion: string
}

export interface RecipePart {
  label: string
  /** mmol in the final volume, and mol/L. */
  mmol: number
  conc: number
  /** Volume of the stock solution (mL) — null for the salt that is added dry. */
  stockVolume: number | null
}

export interface Recipe {
  ok: boolean
  message: string
  /** Concentrations in the buffer. */
  parts: Array<{ form: number; conc: number }>
  /** Strong base (positive) or strong acid (negative) added, mol/L. */
  strong: number
  /** NaCl/KCl (1:1 salt) added to reach the ionic strength, mol/L. */
  background: number
  /** pH actually obtained (check), ionic strength, buffer capacity (mol/L per pH) and activity coefficient of H⁺. */
  pH: number
  I: number
  beta: number
  items: RecipePart[]
  water: number
  /** The pH of this same recipe at other temperatures (°C → pH). */
  byTemperature: Array<{ T: number; pH: number }>
}

function ionsOf(parts: Array<{ sys: System; form: number; conc: number }>, strong: number, background: number): { items: Dissolved[]; ions: Ion[] } {
  const items: Dissolved[] = parts.map((p) => ({ sys: p.sys, form: p.form, conc: p.conc }))
  const ions: Ion[] = []
  for (const d of items) ions.push(...counterIons(d))
  if (strong > 0) ions.push({ z: 1, conc: strong })
  else if (strong < 0) ions.push({ z: -1, conc: -strong })
  if (background > 0) ions.push({ z: 1, conc: background }, { z: -1, conc: background })
  return { items, ions }
}

/** pH of a recipe (concentrations in the final solution). */
export function recipePH(sys: System, parts: Array<{ form: number; conc: number }>, strong: number, background: number, med: Medium) {
  const { items, ions } = ionsOf(parts.map((p) => ({ ...p, sys })), strong, background)
  return solve(items, ions, med)
}

/** Ionic strength of the buffer species and ions at a pH, with activity coefficients taken at `Iact`. */
function bufferIonic(sys: System, parts: Array<{ form: number; conc: number }>, strong: number, pH: number, Iact = 0, med: Medium = { T: 25, activity: 'none' }): number {
  const { items, ions } = ionsOf(parts.map((p) => ({ ...p, sys })), strong, 0)
  let s = Math.pow(10, -pH) + Math.pow(10, pH - 14)
  for (const i of ions) s += i.z * i.z * i.conc
  for (const d of items) {
    const a = alphas(d.sys, pH, Iact, med)
    a.forEach((x, j) => { s += x * d.conc * (d.sys.z0 - j) ** 2 })
  }
  return s / 2
}

/** Strong base (+) or acid (−) in mol/L that brings C mol/L of the system, weighed in as `form`, to the target pH at ionic strength I (0 = ideal). */
export function strongNeeded(sys: System, form: number, C: number, pH: number, I: number, med: Medium): number {
  const { items, ions } = ionsOf([{ sys, form, conc: C }], 0, 0)
  return -netCharge(items, ions, pH, I, med)
}

function designBufferUnsafe(b: BufferSpec): Recipe {
  const med: Medium = { T: b.temperature, activity: b.activity }
  const n = b.sys.pKa.length
  const fail = (message: string): Recipe => ({
    ok: false, message, parts: [], strong: 0, background: 0, pH: NaN, I: 0, beta: 0, items: [], water: b.volume, byTemperature: [],
  })
  if (!(b.conc > 0) || !(b.volume > 0)) return fail('Give the total concentration and the final volume.')
  if (!Number.isFinite(b.pH)) return fail('Give the target pH.')
  if (b.formA < 0 || b.formA > n || b.formB < 0 || b.formB > n) return fail('Pick forms of the buffer system.')
  const target = b.ionicStrength !== null && b.ionicStrength > 0 ? b.ionicStrength : null
  let message = ''
  const compute = (Iuse: number) => {
    if (b.mode === 'salts') {
      if (b.formA === b.formB) return null
      const j1 = Math.min(b.formA, b.formB)
      const j2 = Math.max(b.formA, b.formB)
      const x = strongNeeded(b.sys, j1, b.conc, b.pH, Iuse, med) // base needed to turn form j1 into the mixture
      const c2 = x / (j2 - j1)
      if (c2 < -1e-12 || c2 > b.conc + 1e-12) {
        message = `pH ${b.pH} is outside the range of this pair of forms (it would need ${c2 < 0 ? 'less than none' : 'more than all'} of the second form). Pick the forms with pKa near the target.`
        return { parts: [{ form: j1, conc: Math.max(0, Math.min(b.conc, b.conc - c2)) }, { form: j2, conc: Math.max(0, Math.min(b.conc, c2)) }], strong: 0 }
      }
      return { parts: [{ form: j1, conc: b.conc - c2 }, { form: j2, conc: c2 }], strong: 0 }
    }
    const form = b.mode === 'acid-base' ? Math.min(b.formA, b.formB) : Math.max(b.formA, b.formB)
    const x = strongNeeded(b.sys, form, b.conc, b.pH, Iuse, med)
    if ((b.mode === 'acid-base' && x < -1e-12) || (b.mode === 'base-acid' && x > 1e-12)) {
      message = `At pH ${b.pH} the ${b.mode === 'acid-base' ? 'acid form needs acid, not base' : 'base form needs base, not acid'}: use the other mode or the other form.`
      return { parts: [{ form, conc: b.conc }], strong: 0 }
    }
    return { parts: [{ form, conc: b.conc }], strong: x }
  }
  // activity coefficients are taken at the ionic strength the solution ends up with: the target when the buffer
  // alone stays below it (the rest is a background salt), else the buffer's own, found by iteration
  let Iuse = b.activity === 'none' ? 0 : target ?? 0
  let r = compute(Iuse)
  if (!r) return fail('Choose two different forms.')
  let Ibuf = bufferIonic(b.sys, r.parts, r.strong, b.pH, Iuse, med)
  if (b.activity !== 'none' && !(target !== null && Ibuf <= target + 1e-9)) {
    for (let k = 0; k < 60; k++) {
      Iuse = Ibuf
      r = compute(Iuse) ?? r
      const next = bufferIonic(b.sys, r.parts, r.strong, b.pH, Iuse, med)
      if (Math.abs(next - Ibuf) < 1e-12) { Ibuf = next; break }
      Ibuf = 0.4 * Ibuf + 0.6 * next
    }
    r = compute(Ibuf) ?? r
    Ibuf = bufferIonic(b.sys, r.parts, r.strong, b.pH, Ibuf, med)
  }
  const parts = r.parts
  const strong = r.strong
  let background = 0
  if (target !== null) {
    background = Math.max(0, target - Ibuf)
    if (target < Ibuf - 1e-9) message ||= `The buffer alone already has I = ${Ibuf.toFixed(3)} M, above the ${target} M asked for.`
  }
  const sol = recipePH(b.sys, parts, strong, background, med)
  const dis = parts.map((p) => ({ sys: b.sys, form: p.form, conc: p.conc }))
  const beta = bufferCapacity(dis, sol.pH, sol.I, med)
  const items: RecipePart[] = []
  const mmolOf = (c: number) => (c * b.volume)
  const namesOf = (j: number) => b.forms[j] ?? `${b.sys.label}, species ${j}`
  parts.forEach((p, i) => {
    if (p.conc > 1e-12) items.push({ label: namesOf(p.form), mmol: mmolOf(p.conc), conc: p.conc, stockVolume: (mmolOf(p.conc)) / (i === 0 ? b.stockA : b.stockB) })
  })
  if (Math.abs(strong) > 1e-12) items.push({ label: strong > 0 ? `Strong base (${b.cation}OH)` : `Strong acid (H${b.anion})`, mmol: mmolOf(Math.abs(strong)), conc: Math.abs(strong), stockVolume: mmolOf(Math.abs(strong)) / b.stockB })
  if (background > 1e-12) items.push({ label: `Background salt (${b.cation}${b.anion})`, mmol: mmolOf(background), conc: background, stockVolume: null })
  const used = items.reduce((s, i) => s + (i.stockVolume ?? 0), 0)
  const water = b.volume - used
  if (water < 0) message ||= 'The stock solutions are too dilute for this final volume: use more concentrated stocks or a larger volume.'
  const temps = [4, 20, 25, 30, 37, 45].filter((t, i, a) => a.indexOf(t) === i)
  const byTemperature = temps.map((T) => ({ T, pH: recipePH(b.sys, parts, strong, background, { T, activity: b.activity }).pH }))
  return {
    ok: message === '' || water >= 0, message: message || 'Exact solution of the charge balance at the target pH.', parts, strong, background, pH: sol.pH, I: sol.I, beta, items, water, byTemperature,
  }
}

/** The forms (j, j+1) of the system whose pKa is nearest to the target pH: the natural choice for a buffer. */
export function bestPair(sys: System, pH: number): { formA: number; formB: number; pKa: number } {
  let best = 0
  let d = Infinity
  sys.pKa.forEach((p, i) => {
    if (Math.abs(p - pH) < d) { d = Math.abs(p - pH); best = i }
  })
  return { formA: best, formB: best + 1, pKa: sys.pKa[best] ?? NaN }
}

/** Useful buffer range of the system: every pKa ± 1. */
export function bufferRanges(sys: System): Array<[number, number]> {
  return sys.pKa.map((p) => [p - 1, p + 1])
}

/** Henderson–Hasselbalch estimate of the base/acid ratio (the classroom shortcut, for comparison with the exact result). */
export function hendersonRatio(pH: number, pKa: number): number {
  return Math.pow(10, pH - pKa)
}

export { pKaMixed }

/** Designs the buffer; a recipe with `ok: false` and a message instead of an exception when the numbers make no sense. */
export function designBuffer(b: BufferSpec): Recipe {
  try {
    return designBufferUnsafe(b)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    return { ok: false, message: /bracketed/i.test(m) ? 'The equilibrium could not be solved for these values.' : m, parts: [], strong: 0, background: 0, pH: NaN, I: 0, beta: 0, items: [], water: b.volume, byTemperature: [] }
  }
}
