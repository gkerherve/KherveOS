// Practice and quiz (pure): an unknown-concentration titration to do by hand, and multiple-choice questions
// computed from the same model, both from a seed so a session can be repeated.

import { equivalencePoints, marks, phAt, type AcidBaseSpec } from './acidbase.ts'
import { rankIndicators } from './chooser.ts'
import { INDICATORS } from './data/indicators.ts'
import { PKA, pkaById } from './data/pka.ts'
import { rng } from './format.ts'
import { weakFrom } from './project.ts'

export interface PracticeTask {
  spec: AcidBaseSpec
  /** The concentration to find (mol/L) in the sample of `aliquot` mL. Hidden from the learner. */
  trueConc: number
  aliquot: number
  label: string
  titrantLabel: string
  titrantConc: number
  /** What the learner is told. */
  brief: string
}

const SAMPLES = ['acetic', 'formic', 'lactic', 'benzoic', 'propionic', 'chloroacetic', 'ammonia', 'methylamine', 'pyridine', 'hcl'] as const

/** An unknown to titrate: a weak or strong acid/base of random concentration, 25.00 mL, a 0.1000 or 0.2000 M titrant. */
export function makePractice(seed: number): PracticeTask {
  const r = rng(seed)
  const pick = SAMPLES[Math.floor(r() * SAMPLES.length)]
  const conc = Math.round((0.04 + r() * 0.16) * 10000) / 10000
  const titrantConc = r() < 0.5 ? 0.1 : 0.2
  const aliquot = 25
  if (pick === 'hcl') {
    return {
      spec: { items: [{ kind: 'strong-acid', label: 'HCl (unknown)', conc, volume: aliquot }], water: 0, titrant: { kind: 'strong-base', label: 'NaOH', conc: titrantConc }, temperature: 25, activity: 'none', background: 0, vmax: null, indicator: 'bromothymolblue' },
      trueConc: conc, aliquot, label: 'HCl', titrantLabel: 'NaOH', titrantConc,
      brief: `${aliquot.toFixed(2)} mL of hydrochloric acid of unknown concentration is titrated with ${titrantConc.toFixed(4)} M NaOH.`,
    }
  }
  const e = pkaById(pick)!
  const base = e.z0 === 1 && e.pKa.length === 1 && e.category === 'Amines and N-bases'
  const item = weakFrom(e, base ? 1 : 0, conc, aliquot)
  item.label = `${e.name} (unknown)`
  return {
    spec: {
      items: [item], water: 0,
      titrant: base ? { kind: 'strong-acid', label: 'HCl', conc: titrantConc } : { kind: 'strong-base', label: 'NaOH', conc: titrantConc },
      temperature: 25, activity: 'none', background: 0, vmax: null, indicator: base ? 'methylred' : 'phenolphthalein',
    },
    trueConc: conc, aliquot, label: e.name, titrantLabel: base ? 'HCl' : 'NaOH', titrantConc,
    brief: `${aliquot.toFixed(2)} mL of ${e.name.toLowerCase()} of unknown concentration is titrated with ${titrantConc.toFixed(4)} M ${base ? 'HCl' : 'NaOH'}.`,
  }
}

export type Grade = 'excellent' | 'close' | 'off'

/** Excellent within 1 %, close within 3 %. */
export function gradeConcentration(trueConc: number, answer: number): { grade: Grade; errorPercent: number } {
  const errorPercent = (100 * (answer - trueConc)) / trueConc
  const a = Math.abs(errorPercent)
  return { grade: a <= 1 ? 'excellent' : a <= 3 ? 'close' : 'off', errorPercent }
}

/** The concentration an equivalence volume gives (what the learner should calculate). */
export const concFromVolume = (task: PracticeTask, Veq: number) => (Veq * task.titrantConc) / task.aliquot

export function practiceEquivalence(task: PracticeTask): number {
  return equivalencePoints(task.spec)[0]?.V ?? NaN
}

// ---------------------------------------------------------------------------------------------- quiz

export interface Question {
  id: string
  kind: 'halfEq' | 'startPH' | 'eqPH' | 'indicator' | 'eqVolume' | 'steps'
  prompt: string
  choices: string[]
  answer: number
  explanation: string
}

const MONO = PKA.filter((e) => e.pKa.length === 1 && e.z0 === 0 && e.pKa[0] > 2.5 && e.pKa[0] < 10 && ['Carboxylic acids', 'Phenols', 'Inorganic acids'].includes(e.category))
const POLY = PKA.filter((e) => e.pKa.length >= 2 && e.pKa.length <= 3 && e.z0 === 0 && e.category === 'Polyprotic acids')

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Numeric options: the right one and distractors at least 0.4 apart from each other. */
function numericChoices(right: number, decoys: number[], digits: number, r: () => number): { choices: string[]; answer: number } {
  const vals = [right]
  for (const d of decoys) if (vals.every((v) => Math.abs(v - d) >= 0.4 * Math.pow(10, -digits + 1))) vals.push(d)
  let k = 1
  while (vals.length < 4) {
    const d = right + (r() < 0.5 ? -1 : 1) * k * 0.5
    if (vals.every((v) => Math.abs(v - d) >= 0.3)) vals.push(d)
    k++
  }
  const order = shuffle(vals.slice(0, 4), r)
  return { choices: order.map((v) => v.toFixed(digits)), answer: order.indexOf(right) }
}

export function makeQuestion(seed: number, kind?: Question['kind']): Question {
  const r = rng(seed)
  const kinds: Question['kind'][] = ['halfEq', 'startPH', 'eqPH', 'indicator', 'eqVolume', 'steps']
  const k = kind ?? kinds[Math.floor(r() * kinds.length)]
  const e = MONO[Math.floor(r() * MONO.length)]
  const conc = [0.05, 0.1, 0.2][Math.floor(r() * 3)]
  const spec = (en: typeof e, c: number, vol = 25, tc = c): AcidBaseSpec => ({
    items: [weakFrom(en, 0, c, vol)], water: 0, titrant: { kind: 'strong-base', label: 'NaOH', conc: tc }, temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null,
  })
  const name = e.name.toLowerCase()
  switch (k) {
    case 'halfEq': {
      const m = marks(spec(e, conc))
      const right = Math.round(m.half[0].pH * 100) / 100
      const { choices, answer } = numericChoices(right, [right + 1, right - 1, 7, (right + 7) / 2].map((x) => Math.round(x * 100) / 100), 2, r)
      return { id: `${k}-${seed}`, kind: k, prompt: `${conc.toFixed(3)} M ${name} (pKa ${e.pKa[0]}) is titrated with NaOH of the same concentration. What is the pH after exactly half the volume needed to reach the equivalence point has been added?`, choices, answer, explanation: `Half way, [HA] = [A⁻], so pH = pKa = ${e.pKa[0]} (Henderson–Hasselbalch). The exact charge balance gives ${right.toFixed(2)}.` }
    }
    case 'startPH': {
      const right = Math.round(phAt(spec(e, conc), 0) * 100) / 100
      const { choices, answer } = numericChoices(right, [-Math.log10(conc), right + 1, 7, right - 1].map((x) => Math.round(x * 100) / 100), 2, r)
      return { id: `${k}-${seed}`, kind: k, prompt: `What is the pH of a ${conc.toFixed(3)} M solution of ${name} (pKa ${e.pKa[0]}) before any base is added?`, choices, answer, explanation: `A weak acid ionises only a little: [H⁺] ≈ √(Ka·c) gives pH ≈ ½(pKa − log c) = ${(0.5 * (e.pKa[0] - Math.log10(conc))).toFixed(2)}; the exact solution is ${right.toFixed(2)}. A strong acid of the same concentration would have pH ${(-Math.log10(conc)).toFixed(2)}.` }
    }
    case 'eqPH': {
      const m = marks(spec(e, conc))
      const right = Math.round(m.eq[0].pH * 100) / 100
      const { choices, answer } = numericChoices(right, [7, right - 2, right + 1, e.pKa[0]].map((x) => Math.round(x * 100) / 100), 2, r)
      return { id: `${k}-${seed}`, kind: k, prompt: `${conc.toFixed(3)} M ${name} (pKa ${e.pKa[0]}) is titrated with NaOH of the same concentration. What is the pH at the equivalence point?`, choices, answer, explanation: `At the equivalence point only the conjugate base is left, A⁻ at about c/2, which hydrolyses: pH = 7 + ½(pKa + log c_A⁻) = ${(7 + 0.5 * (e.pKa[0] + Math.log10(conc / 2))).toFixed(2)}; exactly ${right.toFixed(2)}. It is above 7 because the salt of a weak acid is basic.` }
    }
    case 'indicator': {
      const s = spec(e, conc)
      const rk = rankIndicators(s, 1)!
      const best = rk.list[0].ind
      const decoys = shuffle(rk.list.filter((x) => (x.errorPercent === null || Math.abs(x.errorPercent) > 3) && !x.ind.stops).map((x) => x.ind), r).slice(0, 3)
      const options = shuffle([best, ...decoys], r)
      return { id: `${k}-${seed}`, kind: k, prompt: `Which indicator gives the smallest titration error for ${conc.toFixed(3)} M ${name} (pKa ${e.pKa[0]}) titrated with NaOH?`, choices: options.map((o) => `${o.name} (pH ${o.lo}–${o.hi})`), answer: options.indexOf(best), explanation: `The pH at the equivalence point is ${marks(s).eq[0].pH.toFixed(1)}; the indicator should change colour inside the steep part of the curve, pH ${rk.jump[0].toFixed(1)}–${rk.jump[1].toFixed(1)} here. ${best.name} changes at pH ${best.pKin.toFixed(1)}.` }
    }
    case 'eqVolume': {
      const vol = [20, 25, 50][Math.floor(r() * 3)]
      const tc = [0.1, 0.2, 0.05][Math.floor(r() * 3)]
      const right = Math.round(((conc * vol) / tc) * 100) / 100
      const { choices, answer } = numericChoices(right, [right * 2, right / 2, right * 1.5, (conc * vol) / (tc * 2)].map((x) => Math.round(x * 100) / 100), 2, r)
      return { id: `${k}-${seed}`, kind: k, prompt: `How many mL of ${tc.toFixed(3)} M NaOH are needed to reach the equivalence point of ${vol.toFixed(1)} mL of ${conc.toFixed(3)} M ${name}?`, choices, answer, explanation: `One mole of NaOH per mole of acid: V = c·V₀/c_NaOH = ${conc}×${vol}/${tc} = ${right} mL.` }
    }
    default: {
      const p = POLY[Math.floor(r() * POLY.length)]
      const s: AcidBaseSpec = { items: [weakFrom(p, 0, 0.1, 25)], water: 0, titrant: { kind: 'strong-base', label: 'NaOH', conc: 0.1 }, temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null }
      const m = marks(s)
      const right = m.eq.filter((x) => x.resolved).length
      const opts = shuffle([1, 2, 3, 4].map(String), r)
      return {
        id: `${k}-${seed}`, kind: 'steps', prompt: `How many distinct jumps does the curve of 0.1 M ${p.name.toLowerCase()} (pKa ${p.pKa.join(', ')}) titrated with 0.1 M NaOH show in water?`,
        choices: opts, answer: opts.indexOf(String(right)),
        explanation: `A step shows as its own jump when it is far from its neighbours (ΔpKa ≳ 3–4) and its pKa is below about 11. Here ${right} step${right === 1 ? '' : 's'} qualif${right === 1 ? 'ies' : 'y'}.`,
      }
    }
  }
}

export const INDICATOR_COUNT = INDICATORS.length
