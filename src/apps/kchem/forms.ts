// What the user has typed in each tool of kChem. It lives in the app (not in the tool) so that the
// tools keep their inputs when you switch between them, and the AI tools can fill them in.

import type { AmountKind } from './stoich'
import type { ConcUnit, WeighKind } from './solutions'

export interface EmpRow {
  el: string
  amount: string
}

export interface FormulaForm {
  formula: string
  emp: { mode: 'percent' | 'mass' | 'moles'; rows: EmpRow[]; molarMass: string }
}

export interface BalanceForm {
  equation: string
}

export interface AmountForm {
  kind: AmountKind
  value: string
  unit: string
  conc: string
  purity: string
  molarVolume: string
}

export interface StoichForm {
  equation: string
  /** Amounts by reactant position. */
  amounts: Record<number, AmountForm>
  actualProduct: number
  actual: string
  /** The quick one-reactant-to-one-product conversion. */
  quick: { a: string; mass: string; ca: string; b: string; cb: string }
}

export interface SolutionsForm {
  sub: 'weigh' | 'convert' | 'serial' | 'mix'
  weigh: { formula: string; kind: WeighKind; value: string; size: string; purity: string }
  conv: { formula: string; unit: ConcUnit; value: string; density: string }
  serial: { stock: string; factor: string; steps: string; volume: string }
  mix: { c1: string; v1: string; c2: string; v2: string }
}

export interface DilutionForm {
  c1: string
  v1: string
  c2: string
  v2: string
}

export interface AcidsForm {
  sub: 'ph' | 'strong' | 'weak' | 'buffer' | 'titration' | 'table'
  ph: { kind: 'pH' | 'pOH' | 'H' | 'OH'; value: string }
  strong: { type: 'acid' | 'base'; conc: string; n: string }
  weak: { type: 'acid' | 'base'; conc: string; constants: string; mode: 'pKa' | 'Ka' | 'pKb' | 'Kb' }
  buffer: { pKa: string; acid: string; base: string; target: string; total: string; volume: string; acidF: string; baseF: string }
  titr: { analyte: 'acid' | 'base'; conc: string; volume: string; titrant: string; constants: string; max: string }
}

export interface GasesForm {
  sub: 'ideal' | 'combined' | 'density' | 'dalton' | 'vdw'
  ideal: { P: string; Pu: string; V: string; Vu: string; n: string; T: string; Tu: string }
  combined: { P1: string; V1: string; T1: string; P2: string; V2: string; T2: string; Pu: string; Vu: string; Tu: string }
  density: { formula: string; P: string; Pu: string; T: string; Tu: string; density: string }
  dalton: { total: string; Pu: string; rows: { label: string; moles: string }[] }
  vdw: { gas: string; P: string; V: string; n: string; T: string }
}

export interface ConverterForm {
  category: string
  value: string
  from: string
  to: string
}

export interface PeriodicForm {
  selected: number | null
  query: string
  filter: string
  colour: 'category' | 'state' | 'block'
  /** A click on an element also adds it to the formula. */
  append: boolean
}

export interface Forms {
  formula: FormulaForm
  balance: BalanceForm
  stoich: StoichForm
  solutions: SolutionsForm
  dilution: DilutionForm
  acids: AcidsForm
  gases: GasesForm
  converter: ConverterForm
  periodic: PeriodicForm
}

export const DEFAULT_AMOUNT: AmountForm = { kind: 'mass', value: '', unit: 'g', conc: '1', purity: '100', molarVolume: '22.414' }

export const DEFAULT_FORMS: Forms = {
  formula: {
    formula: 'CuSO4·5H2O',
    emp: { mode: 'percent', rows: [{ el: 'C', amount: '40.0' }, { el: 'H', amount: '6.7' }, { el: 'O', amount: '53.3' }], molarMass: '' },
  },
  balance: { equation: 'KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O' },
  stoich: {
    equation: '2 H2 + O2 -> 2 H2O',
    amounts: { 0: { ...DEFAULT_AMOUNT, value: '4.0' }, 1: { ...DEFAULT_AMOUNT, value: '32.0' } },
    actualProduct: 0,
    actual: '',
    quick: { a: 'H2', mass: '2.016', ca: '2', b: 'H2O', cb: '2' },
  },
  solutions: {
    sub: 'weigh',
    weigh: { formula: 'NaCl', kind: 'molarity', value: '0.1', size: '250', purity: '100' },
    conv: { formula: 'NaCl', unit: 'M', value: '1', density: '1.04' },
    serial: { stock: '1', factor: '10', steps: '6', volume: '10' },
    mix: { c1: '1', v1: '100', c2: '0.1', v2: '200' },
  },
  dilution: { c1: '10', v1: '', c2: '1', v2: '100' },
  acids: {
    sub: 'weak',
    ph: { kind: 'pH', value: '7.4' },
    strong: { type: 'acid', conc: '0.01', n: '1' },
    weak: { type: 'acid', conc: '0.1', constants: '4.76', mode: 'pKa' },
    buffer: { pKa: '4.76', acid: '0.1', base: '0.1', target: '5', total: '0.1', volume: '1', acidF: 'CH3COOH', baseF: 'CH3COONa' },
    titr: { analyte: 'acid', conc: '0.1', volume: '25', titrant: '0.1', constants: '4.76', max: '' },
  },
  gases: {
    sub: 'ideal',
    ideal: { P: '1', Pu: 'atm', V: '', Vu: 'L', n: '1', T: '273.15', Tu: 'K' },
    combined: { P1: '1', V1: '10', T1: '300', P2: '2', V2: '', T2: '300', Pu: 'atm', Vu: 'L', Tu: 'K' },
    density: { formula: 'CO2', P: '1', Pu: 'atm', T: '273.15', Tu: 'K', density: '' },
    dalton: { total: '1', Pu: 'atm', rows: [{ label: 'N2', moles: '0.78' }, { label: 'O2', moles: '0.21' }, { label: 'Ar', moles: '0.01' }] },
    vdw: { gas: 'CO2', P: '', V: '1', n: '1', T: '300' },
  },
  converter: { category: 'energy', value: '1', from: 'eV', to: 'kJ/mol' },
  periodic: { selected: 26, query: '', filter: '', colour: 'category', append: true },
}
