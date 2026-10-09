// The Reaction table block (pure): reagent rows with mass, volume (with density) or mmol, equivalents against the
// limiting reagent, theoretical and actual yield. Plus the Measurement table statistics (mean ± sd).

import { molarMass } from './formula.ts'

export type ReagentRole = 'reactant' | 'reagent' | 'catalyst' | 'solvent' | 'product'

export interface Reagent {
  name: string
  formula: string
  /** g/mol typed by the user; empty → from the formula. */
  mw: number | null
  role: ReagentRole
  /** Stoichiometric coefficient in the balanced equation (default 1). */
  coef: number
  /** Amount, in whichever way it was measured: mass (g), volume (mL, needs the density) or mmol. Empty ones are null. */
  mass: number | null
  volume: number | null
  density: number | null
  mmol: number | null
  /** Purity in percent (default 100): the mmol come from mass × purity. */
  purity: number | null
  /** Force this row as the limiting reagent. */
  limiting?: boolean
  /** Actual isolated mass of a product (g). */
  actual: number | null
  cas?: string
}

export interface ReactionData {
  title: string
  /** Reaction SMILES "A.B>>C" for the optional scheme drawing. */
  smiles: string
  reagents: Reagent[]
  notes: string
}

export function newReagent(role: ReagentRole = 'reactant', over: Partial<Reagent> = {}): Reagent {
  return { name: '', formula: '', mw: null, role, coef: 1, mass: null, volume: null, density: null, mmol: null, purity: null, actual: null, ...over }
}

export function newReaction(): ReactionData {
  return { title: 'Reaction', smiles: '', reagents: [newReagent('reactant'), newReagent('reactant'), newReagent('product')], notes: '' }
}

export interface ReagentRow {
  index: number
  mw: number | null
  /** The amount in mmol however it was given. */
  mmol: number | null
  mass: number | null
  volume: number | null
  equiv: number | null
  limiting: boolean
  /** Products: the most that could be made (g), and the percentage yield. */
  theoretical: number | null
  theoreticalMmol: number | null
  yieldPct: number | null
  /** What is missing or odd about this row (shown as a hint). */
  problem: string | null
}

export interface ReactionResult {
  rows: ReagentRow[]
  limitingIndex: number | null
  /** mmol of the limiting reagent divided by its coefficient: how many "reaction units" the experiment can run. */
  extent: number | null
}

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x)

/** Molar mass of a row: typed, else from the formula. */
export function reagentMw(r: Reagent): number | null {
  if (finite(r.mw) && r.mw > 0) return r.mw
  return r.formula.trim() ? molarMass(r.formula) : null
}

/** mmol of a row from whatever amount was given (mass × purity / MW, volume × density, or mmol directly). */
export function reagentMmol(r: Reagent): number | null {
  const mw = reagentMw(r)
  const purity = finite(r.purity) && r.purity > 0 ? r.purity / 100 : 1
  if (finite(r.mmol) && r.mmol > 0 && !finite(r.mass) && !(finite(r.volume) && finite(r.density))) return r.mmol
  if (finite(r.mass) && r.mass > 0 && mw) return ((r.mass * purity) / mw) * 1000
  if (finite(r.volume) && r.volume > 0 && finite(r.density) && r.density > 0 && mw) return (((r.volume * r.density) * purity) / mw) * 1000
  if (finite(r.mmol) && r.mmol > 0) return r.mmol
  return null
}

const round = (x: number, d: number): number => Number(x.toFixed(d))

export function computeReaction(data: ReactionData): ReactionResult {
  const mmols = data.reagents.map((r) => (r.role === 'product' ? null : reagentMmol(r)))
  // the limiting reagent: the forced one, else the reactant with the smallest mmol/coefficient
  let found = data.reagents.findIndex((r, i) => r.limiting && r.role !== 'product' && mmols[i] != null)
  if (found < 0) {
    let best = Infinity
    data.reagents.forEach((r, i) => {
      const m = mmols[i]
      if (r.role !== 'reactant' || m == null) return
      const unit = m / Math.max(r.coef || 1, 1e-9)
      if (unit < best - 1e-12) { best = unit; found = i }
    })
  }
  const limitingIndex: number | null = found >= 0 ? found : null
  const lim = limitingIndex == null ? null : data.reagents[limitingIndex]
  const extent = limitingIndex != null && lim ? (mmols[limitingIndex] as number) / Math.max(lim.coef || 1, 1e-9) : null
  const limMmol = limitingIndex != null ? mmols[limitingIndex] : null

  const rows = data.reagents.map((r, index): ReagentRow => {
    const mw = reagentMw(r)
    let problem: string | null = null
    if (r.formula.trim() && !molarMass(r.formula) && !finite(r.mw)) problem = `Cannot read the formula “${r.formula}”.`
    else if (!mw && (finite(r.mass) || finite(r.volume))) problem = 'Give a formula or a molar mass.'
    else if (finite(r.volume) && !finite(r.density) && !finite(r.mass)) problem = 'A volume needs a density.'
    if (r.role === 'product') {
      const coef = Math.max(r.coef || 1, 1e-9)
      const thMmol = extent != null ? extent * coef : null
      const th = thMmol != null && mw ? (thMmol * mw) / 1000 : null
      const pct = th && finite(r.actual) && r.actual >= 0 ? (r.actual / th) * 100 : null
      return {
        index, mw, mmol: finite(r.actual) && mw ? (r.actual / mw) * 1000 : null, mass: finite(r.actual) ? r.actual : null, volume: null, equiv: null, limiting: false,
        theoretical: th, theoreticalMmol: thMmol, yieldPct: pct, problem: problem ?? (th == null && extent == null ? 'No limiting reagent yet.' : null),
      }
    }
    const mmol = mmols[index]
    const mass = finite(r.mass) ? r.mass : mmol != null && mw ? (mmol * mw) / 1000 : null
    const volume = finite(r.volume) ? r.volume : mass != null && finite(r.density) && r.density > 0 ? mass / r.density : null
    return {
      index, mw, mmol, mass, volume, equiv: mmol != null && limMmol ? mmol / limMmol : null, limiting: index === limitingIndex,
      theoretical: null, theoreticalMmol: null, yieldPct: null, problem,
    }
  })
  return { rows, limitingIndex, extent }
}

/** A number the way a lab book writes it: 3 significant figures, no trailing noise. */
export function fmt(x: number | null | undefined, digits = 3): string {
  if (x == null || !Number.isFinite(x)) return ''
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1000 || a < 0.001) return Number(x.toPrecision(digits)).toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e').replace('e+', 'e')
  return String(round(x, Math.max(0, digits - 1 - Math.floor(Math.log10(a)))))
}

/** Percentage with one decimal. */
export const fmtPct = (x: number | null): string => (x == null || !Number.isFinite(x) ? '' : `${x.toFixed(1)} %`)

/** Reactants → products as text, e.g. "C7H6O3 + C4H6O3 → C9H8O4 + C2H4O2". */
export function equationText(data: ReactionData): string {
  const side = (roles: ReagentRole[]) => data.reagents.filter((r) => roles.includes(r.role) && (r.formula || r.name)).map((r) => `${r.coef > 1 ? r.coef : ''}${r.formula || r.name}`).join(' + ')
  return `${side(['reactant'])} → ${side(['product'])}`
}

// ------------------------------------------------------------------ measurement tables

export interface MeasurementColumn {
  name: string
  unit: string
}

export interface MeasurementData {
  title: string
  columns: MeasurementColumn[]
  /** One row per measurement, one string per column ("" = empty). */
  rows: string[][]
}

export function newMeasurements(): MeasurementData {
  return { title: 'Measurements', columns: [{ name: 'Value', unit: '' }], rows: [[''], [''], ['']] }
}

export interface ColumnStats {
  n: number
  mean: number | null
  /** Sample standard deviation (n − 1); null for fewer than two values. */
  sd: number | null
  min: number | null
  max: number | null
}

/** A cell as a number: "12.5", "1,5" and "1.2e-3" work; "<0.1" or text do not. */
export function cellNumber(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  return Number(t)
}

export function columnStats(rows: string[][], col: number): ColumnStats {
  const v = rows.map((r) => cellNumber(r[col] ?? '')).filter((x): x is number => x != null)
  if (!v.length) return { n: 0, mean: null, sd: null, min: null, max: null }
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v) }
}

/** "12.34 ± 0.05" with the spread shown to two significant figures and the mean to the same decimals. */
export function meanSd(s: ColumnStats): string {
  if (s.mean == null) return ''
  if (s.sd == null || s.sd === 0) return fmt(s.mean, 4)
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(Math.abs(s.sd))))
  const d = Math.min(decimals, 8)
  return `${s.mean.toFixed(d)} ± ${s.sd.toFixed(d)}`
}
