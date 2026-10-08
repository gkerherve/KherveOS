// AI tools of kChem (the manifest is src/os/ai/manifests/kchem.ts). Each call also shows its inputs
// in the matching tool of the window.

import type { useAppTools } from '@/os/ai/appTools'
import { bufferPH, phFrom, strongAcid, strongBase, weakAcid, weakBase } from './acids'
import { balance, parseEquation } from './balance'
import { composition, dilution, fmt, hillFormula, massForSolution, massInfo, molarMass, parseSpecies } from './chem'
import { electronConfiguration, findElement, valenceElectrons } from './elements'
import type { AmountForm, Forms } from './forms'
import { DEFAULT_AMOUNT } from './forms'
import { ATM, idealGas, toKelvin } from './gases'
import { stoichiometry } from './stoich'
import type { ToolId } from './ui'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  /** Fills in a tool's inputs and shows the tool. */
  show<K extends keyof Forms>(tool: ToolId, form: K, patch: Partial<Forms[K]>): void
  /** The formula currently in the Formula tool, to build on. */
  forms(): Forms
}

/** A number argument, or null when it was left out. */
const opt = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v))
const req = (v: unknown, what: string): number => {
  const n = Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) throw new Error(`${what} must be a number.`)
  return n
}
const str = (n: number | null): string => (n === null ? '' : String(n))
const sig = (n: number, digits = 6) => Number(n.toPrecision(digits))

/** "2.15, 7.2" → [2.15, 7.2] */
function numbers(v: unknown, what: string): number[] {
  if (typeof v === 'number') return [v]
  const parts = String(v ?? '').split(/[,;\s]+/).filter(Boolean)
  if (parts.length === 0) throw new Error(`${what} is needed.`)
  return parts.map((p) => {
    const n = Number(p)
    if (!Number.isFinite(n)) throw new Error(`"${p}" is not a number.`)
    return n
  })
}

const amountForm = (patch: Partial<AmountForm>): AmountForm => ({ ...DEFAULT_AMOUNT, ...patch })

export function kchemTools(h: Hooks): Tools {
  return {
    molar_mass: async (a) => {
      const f = String(a.formula ?? '')
      const sp = parseSpecies(f)
      const comp = composition(f)
      const info = massInfo(f)
      h.show('formula', 'formula', { formula: f })
      return {
        formula: f,
        molar_mass_g_per_mol: Number(info.average.toPrecision(6)),
        monoisotopic_mass: Number(info.monoisotopic.toPrecision(9)),
        ...(sp.charge ? { charge: sp.charge } : {}),
        composition: comp.map((c) => ({ element: c.element, atoms: c.count, mass_percent: fmt(c.percent) })),
      }
    },
    stoichiometry: async (a) => {
      const fa = String(a.reactant ?? '')
      const fb = String(a.product ?? '')
      const ma = req(a.mass_g, 'mass_g')
      const ca = req(a.reactant_coefficient, 'reactant_coefficient')
      const cb = req(a.product_coefficient, 'product_coefficient')
      if (!(ca > 0) || !(cb > 0)) throw new Error('The coefficients must be above zero.')
      const molesA = ma / molarMass(fa)
      const molesB = (molesA * cb) / ca
      const massB = molesB * molarMass(fb)
      h.show('stoich', 'stoich', { quick: { a: fa, mass: String(ma), ca: String(ca), b: fb, cb: String(cb) } })
      return { moles_reactant: sig(molesA, 5), moles_product: sig(molesB, 5), product_mass_g: sig(massB, 5) }
    },
    solution: async (a) => {
      const formula = String(a.formula ?? '')
      const molarity = req(a.molarity, 'molarity')
      const volume = req(a.volume_ml, 'volume_ml')
      const grams = massForSolution(formula, molarity, volume)
      h.show('solutions', 'solutions', { sub: 'weigh', weigh: { ...h.forms().solutions.weigh, formula, kind: 'molarity', value: String(molarity), size: String(volume) } })
      return { weigh_g: sig(grams, 5), molar_mass: sig(molarMass(formula)), note: 'Dissolve in water and make up to the volume.' }
    },
    dilution: async (a) => {
      const c1 = opt(a.c1)
      const v1 = opt(a.v1)
      const c2 = opt(a.c2)
      const v2 = opt(a.v2)
      const r = dilution(c1, v1, c2, v2)
      h.show('dilution', 'dilution', { c1: str(c1), v1: str(v1), c2: str(c2), v2: str(v2) })
      return { c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 }
    },
    balance_equation: async (a) => {
      const equation = String(a.equation ?? '')
      h.show('balance', 'balance', { equation })
      const r = balance(equation)
      if (!r.ok) throw new Error(r.message)
      return {
        balanced: r.text,
        coefficients: r.equation.reactants.concat(r.equation.products).map((s, i) => ({ species: s.formula, coefficient: r.coefficients[i] })),
        already_balanced: r.alreadyBalanced,
      }
    },
    limiting_reagent: async (a) => {
      const equation = String(a.equation ?? '')
      const eq = parseEquation(equation)
      const all = [...eq.reactants, ...eq.products]
      let text = equation
      if (all.some((s) => s.coeff === null)) {
        const b = balance(eq)
        if (!b.ok) throw new Error(b.message)
        text = b.text
      }
      const bal = parseEquation(text)
      const given = Array.isArray(a.amounts) ? (a.amounts as Record<string, unknown>[]) : []
      if (given.length === 0) throw new Error('amounts: give the amount of at least one reactant.')
      const norm = (f: string): string => {
        try {
          const sp = parseSpecies(f)
          return `${hillFormula(sp.atoms)}/${sp.charge}`
        } catch {
          return f.trim()
        }
      }
      const amountForms: AmountForm[] = bal.reactants.map(() => amountForm({ value: '' }))
      const amounts = bal.reactants.map((s, i) => {
        const g = given.find((x) => norm(String(x.formula ?? '')) === norm(s.formula))
        if (!g) return null
        const mass = opt(g.mass_g)
        const moles = opt(g.moles)
        const vol = opt(g.volume_ml)
        const conc = opt(g.molarity)
        if (mass !== null) {
          amountForms[i] = amountForm({ kind: 'mass', value: String(mass), unit: 'g' })
          return { kind: 'mass' as const, value: mass, unit: 'g' }
        }
        if (moles !== null) {
          amountForms[i] = amountForm({ kind: 'moles', value: String(moles), unit: 'mol' })
          return { kind: 'moles' as const, value: moles, unit: 'mol' }
        }
        if (vol !== null && conc !== null) {
          amountForms[i] = amountForm({ kind: 'solution', value: String(vol), unit: 'mL', conc: String(conc) })
          return { kind: 'solution' as const, value: vol, unit: 'mL', conc }
        }
        throw new Error(`amounts: ${s.formula} needs mass_g, moles, or volume_ml with molarity.`)
      })
      const unknown = given.filter((g) => !bal.reactants.some((s) => norm(s.formula) === norm(String(g.formula ?? ''))))
      if (unknown.length) throw new Error(`amounts: ${unknown.map((u) => String(u.formula)).join(', ')} is not a reactant of the equation (reactants: ${bal.reactants.map((s) => s.formula).join(', ')}).`)
      const actualG = opt(a.actual_yield_g)
      let prod = 0
      if (a.yield_product) {
        prod = bal.products.findIndex((s) => norm(s.formula) === norm(String(a.yield_product)))
        if (prod < 0) throw new Error(`yield_product must be one of: ${bal.products.map((s) => s.formula).join(', ')}.`)
      }
      const r = stoichiometry({ equation: text, amounts, actual: actualG === null ? null : { product: prod, grams: actualG } })
      h.show('stoich', 'stoich', {
        equation: text,
        amounts: Object.fromEntries(amountForms.map((x, i) => [i, x])),
        actualProduct: prod,
        actual: actualG === null ? '' : String(actualG),
      })
      return {
        balanced_equation: text,
        limiting_reagent: r.limiting,
        reaction_extent_mol: sig(r.extent),
        reactants: r.reactants.map((x) => ({
          formula: x.formula, moles_given: x.molesGiven === null ? 'in excess' : sig(x.molesGiven), moles_used: sig(x.molesReacted),
          moles_left: x.molesLeft === null ? 'in excess' : sig(x.molesLeft), mass_left_g: x.massLeft === null ? 'in excess' : sig(x.massLeft),
        })),
        products: r.products.map((x) => ({ formula: x.formula, moles: sig(x.molesReacted), theoretical_yield_g: sig(x.massReacted) })),
        ...(r.percentYield ? { percent_yield: sig(r.percentYield.percent, 4), percent_yield_of: r.percentYield.formula } : {}),
      }
    },
    ph: async (a) => {
      const type = String(a.type ?? '')
      const C = opt(a.concentration)
      const need = (): number => {
        if (C === null) throw new Error('concentration is needed (mol/L).')
        return C
      }
      const constants = (isBase: boolean): number[] => {
        const k = opt(a.k)
        if (k !== null) {
          if (!(k > 0)) throw new Error('k (Ka or Kb) must be above zero.')
          return [-Math.log10(k)]
        }
        return numbers(a.pk, isBase ? 'pk (the pKb)' : 'pk (the pKa) or k (the Ka)')
      }
      const pack = (s: { pH: number; H: number; OH: number; alpha?: number | null }) => ({
        pH: sig(s.pH, 5), pOH: sig(14 - s.pH, 5), h_molar: Number(s.H.toPrecision(4)), oh_molar: Number(s.OH.toPrecision(4)),
        ...(s.alpha !== null && s.alpha !== undefined && s.alpha < 1 ? { fraction_ionised: sig(s.alpha, 4) } : {}),
      })
      switch (type) {
        case 'strong_acid': {
          const s = strongAcid(need())
          h.show('acids', 'acids', { sub: 'strong', strong: { type: 'acid', conc: String(C), n: '1' } })
          return pack(s)
        }
        case 'strong_base': {
          const s = strongBase(need())
          h.show('acids', 'acids', { sub: 'strong', strong: { type: 'base', conc: String(C), n: '1' } })
          return pack(s)
        }
        case 'weak_acid': {
          const pks = constants(false)
          const s = weakAcid(need(), pks)
          h.show('acids', 'acids', { sub: 'weak', weak: { type: 'acid', conc: String(C), mode: 'pKa', constants: pks.map((x) => String(sig(x, 5))).join(', ') } })
          return pack(s)
        }
        case 'weak_base': {
          const pks = constants(true)
          const s = weakBase(need(), pks[0])
          h.show('acids', 'acids', { sub: 'weak', weak: { type: 'base', conc: String(C), mode: 'pKb', constants: String(sig(pks[0], 5)) } })
          return pack(s)
        }
        case 'buffer': {
          const pks = constants(false)
          const base = req(a.base_concentration, 'base_concentration')
          const acid = need()
          const pH = bufferPH(pks[0], acid, base)
          h.show('acids', 'acids', { sub: 'buffer', buffer: { ...h.forms().acids.buffer, pKa: String(sig(pks[0], 5)), acid: String(acid), base: String(base) } })
          return { pH: sig(pH, 4), note: 'Henderson–Hasselbalch: pH = pKa + log([A-]/[HA]).' }
        }
        case 'from_ph':
        case 'from_h': {
          const v = req(a.value, 'value')
          const s = phFrom(type === 'from_ph' ? 'pH' : 'H', v)
          h.show('acids', 'acids', { sub: 'ph', ph: { kind: type === 'from_ph' ? 'pH' : 'H', value: String(v) } })
          return pack(s)
        }
        default:
          throw new Error('type must be strong_acid, strong_base, weak_acid, weak_base, buffer, from_ph or from_h.')
      }
    },
    element: async (a) => {
      const e = findElement(String(a.query ?? ''))
      if (!e) throw new Error(`No element matches "${String(a.query)}". Use a symbol (Fe), a name (iron) or an atomic number (26).`)
      h.show('periodic', 'periodic', { selected: e.z, query: '', filter: '' })
      return {
        name: e.name,
        symbol: e.symbol,
        atomic_number: e.z,
        atomic_weight: e.weight,
        ...(e.radioactive ? { note: 'No stable isotope: the weight is the mass number of the longest-lived isotope.' } : {}),
        category: e.category,
        group: e.group,
        period: e.period,
        block: e.block,
        electron_configuration: electronConfiguration(e.z),
        valence_electrons: valenceElectrons(e),
        electronegativity_pauling: e.en,
        melting_point_k: e.mp,
        boiling_point_k: e.bp,
        density_g_cm3: e.density,
        state_at_25c: e.state,
        oxidation_states: e.oxidation,
        discovered: e.year === 'ancient' ? 'known since antiquity' : `${e.year}, ${e.discoverer}`,
      }
    },
    gas_law: async (a) => {
      const P = opt(a.pressure_atm)
      const V = opt(a.volume_l)
      const n = opt(a.moles)
      const Tk = opt(a.temperature_k)
      const Tc = opt(a.temperature_c)
      if (Tk !== null && Tc !== null) throw new Error('Give the temperature in kelvin or in °C, not both.')
      const T = Tk ?? (Tc === null ? null : toKelvin(Tc, '°C'))
      const r = idealGas({ P: P === null ? null : P * ATM, V: V === null ? null : V / 1000, n, T })
      h.show('gases', 'gases', {
        sub: 'ideal',
        ideal: { P: str(P), Pu: 'atm', V: str(V), Vu: 'L', n: str(n), T: Tk !== null || Tc === null ? str(Tk) : String(Tc), Tu: Tk !== null || Tc === null ? 'K' : '°C' },
      })
      return { solved: r.solved, pressure_atm: sig(r.P / ATM), volume_l: sig(r.V * 1000), moles: sig(r.n), temperature_k: sig(r.T) }
    },
  }
}
