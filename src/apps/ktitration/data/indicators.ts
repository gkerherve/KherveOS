// Indicators: acid–base (transition range, colours) and redox, metal-ion and precipitation endpoints. Pure data.
// The colours are the colours of the solution (not theme colours): a pale water blue stands for "colourless".

import { mixColors } from '../format.ts'

export const WATER = '#d9ecf5'

export interface Indicator {
  id: string
  name: string
  /** Start and end of the visible transition (pH). */
  lo: number
  hi: number
  /** Colour on the acid and on the base side. */
  acid: string
  base: string
  acidName: string
  baseName: string
  /** pH of the colour midpoint (≈ (lo + hi)/2). */
  pKin: number
  /** For indicators with several colours: stops [pH, colour], used instead of the two-colour mix. */
  stops?: Array<[number, string]>
  note?: string
}

type Row = [id: string, name: string, lo: number, hi: number, acidName: string, acid: string, baseName: string, base: string, note?: string]

const ROWS: Row[] = [
  ['methylviolet', 'Methyl violet', 0.0, 1.6, 'yellow', '#e6d83a', 'blue-violet', '#5b4fc4'],
  ['malachitegreen', 'Malachite green (acid range)', 0.2, 1.8, 'yellow', '#e3d442', 'blue-green', '#2a9a8a'],
  ['cresolred_a', 'Cresol red (acid range)', 0.2, 1.8, 'red', '#d8453a', 'yellow', '#ecd24a'],
  ['metanilyellow', 'Metanil yellow', 1.2, 2.3, 'red', '#d8503e', 'yellow', '#efd23c'],
  ['thymolblue_a', 'Thymol blue (acid range)', 1.2, 2.8, 'red', '#d8453a', 'yellow', '#efd23c'],
  ['tropaeolin00', 'Tropaeolin OO', 1.3, 3.2, 'red', '#d94a36', 'yellow', '#efd23c'],
  ['orangeiv', 'Orange IV', 1.4, 2.8, 'red', '#d9503a', 'yellow', '#f0cf38'],
  ['dnp24', '2,4-Dinitrophenol', 2.8, 4.0, 'colourless', WATER, 'yellow', '#f0e03c'],
  ['methylyellow', 'Methyl yellow', 2.9, 4.0, 'red', '#d8473a', 'yellow', '#f0d93c'],
  ['bromophenolblue', 'Bromophenol blue', 3.0, 4.6, 'yellow', '#ead93c', 'blue-violet', '#4a52b8'],
  ['congored', 'Congo red', 3.0, 5.0, 'blue-violet', '#5a58b0', 'red', '#d8403a'],
  ['methylorange', 'Methyl orange', 3.1, 4.4, 'red', '#d8403a', 'yellow-orange', '#f2b53a', 'The classic indicator for strong acid and weak-base titrations.'],
  ['bromocresolgreen', 'Bromocresol green', 3.8, 5.4, 'yellow', '#ecd93c', 'blue', '#2f5fb8'],
  ['methylred', 'Methyl red', 4.4, 6.2, 'red', '#d8403a', 'yellow', '#f0d63c', 'Good for weak bases (ammonia) titrated with a strong acid.'],
  ['chlorophenolred', 'Chlorophenol red', 4.8, 6.4, 'yellow', '#ecd63c', 'red-violet', '#b02f78'],
  ['bromocresolpurple', 'Bromocresol purple', 5.2, 6.8, 'yellow', '#ecd63c', 'purple', '#7a3f99'],
  ['bromophenolred', 'Bromophenol red', 5.2, 7.0, 'yellow', '#ecd63c', 'red', '#c93a4f'],
  ['pnitrophenol', 'p-Nitrophenol', 5.4, 7.5, 'colourless', WATER, 'yellow', '#f0dc3c'],
  ['alizarin', 'Alizarin', 5.5, 6.8, 'yellow', '#e8d23c', 'red', '#c4403a'],
  ['bromothymolblue', 'Bromothymol blue', 6.0, 7.6, 'yellow', '#ecd93c', 'blue', '#2f62c4', 'Changes at neutral pH: suits strong acid with strong base.'],
  ['neutralred', 'Neutral red', 6.8, 8.0, 'red', '#d8403a', 'yellow', '#efc83c'],
  ['phenolred', 'Phenol red', 6.8, 8.4, 'yellow', '#ecd93c', 'red', '#d83a52'],
  ['cresolred_b', 'Cresol red (base range)', 7.2, 8.8, 'yellow', '#ecd63c', 'red-violet', '#b02f78'],
  ['mcresolpurple', 'm-Cresol purple', 7.4, 9.0, 'yellow', '#ecd63c', 'purple', '#7a3f99'],
  ['curcumin', 'Curcumin', 7.4, 8.6, 'yellow', '#ecd03c', 'red-brown', '#b8402f'],
  ['thymolblue_b', 'Thymol blue (base range)', 8.0, 9.6, 'yellow', '#ecd63c', 'blue', '#2f5fb8'],
  ['phenolphthalein', 'Phenolphthalein', 8.2, 10.0, 'colourless', WATER, 'pink', '#e5348f', 'The standard indicator for weak acid with strong base.'],
  ['ocresolphthalein', 'o-Cresolphthalein', 8.2, 9.8, 'colourless', WATER, 'red', '#d83a52'],
  ['thymolphthalein', 'Thymolphthalein', 9.4, 10.6, 'colourless', WATER, 'blue', '#3f5fc4', 'Changes later than phenolphthalein: useful for weak acids with a high equivalence pH.'],
  ['alizarinyellow', 'Alizarin yellow R', 10.1, 12.0, 'yellow', '#ecd63c', 'red', '#c4403a'],
  ['tropaeolino', 'Tropaeolin O', 11.0, 13.0, 'yellow', '#efd03c', 'orange', '#e8832f'],
  ['indigocarmine', 'Indigo carmine', 11.4, 13.0, 'blue', '#3f5fc4', 'yellow', '#ecd63c'],
  ['nitramine', 'Nitramine', 10.8, 13.0, 'colourless', WATER, 'orange-brown', '#c26a2f'],
  ['litmus', 'Litmus', 4.5, 8.3, 'red', '#d8403a', 'blue', '#3f5fc4', 'A mixture of dyes; a rough test, not a titration indicator.'],
]

const toIndicator = ([id, name, lo, hi, acidName, acid, baseName, base, note]: Row): Indicator => ({
  id, name, lo, hi, acid, base, acidName, baseName, pKin: (lo + hi) / 2, ...(note ? { note } : {}),
})

/** The two-colour indicators plus the multicolour ones (universal indicator and red-cabbage juice). */
export const INDICATORS: readonly Indicator[] = [
  ...ROWS.map(toIndicator),
  {
    id: 'universal', name: 'Universal indicator', lo: 3, hi: 11, pKin: 7, acid: '#d8403a', base: '#5b3f99', acidName: 'red', baseName: 'violet',
    stops: [[1, '#d8302f'], [3, '#e8502f'], [4, '#f08a2f'], [5, '#f2c12f'], [6, '#c8d63a'], [7, '#4fae4a'], [8, '#2f9a8a'], [9, '#2f6cb8'], [10, '#4a4fb8'], [11, '#6a3f99'], [13, '#7a2f80']],
    note: 'A blend: a different colour at every pH, so it gives a reading, not a sharp endpoint.',
  },
  {
    id: 'cabbage', name: 'Red-cabbage juice (anthocyanin)', lo: 2, hi: 12, pKin: 7, acid: '#d8303f', base: '#d8d03a', acidName: 'red', baseName: 'yellow',
    stops: [[1, '#d8303f'], [3, '#e0407a'], [5, '#b05fa8'], [6, '#8a5fb8'], [7, '#6a62c8'], [8, '#4a7ec0'], [9, '#3f9aa0'], [10, '#3fa878'], [11, '#7fb84a'], [12, '#d8d03a'], [14, '#e8c83a']],
    note: 'A kitchen indicator with many colours.',
  },
]

const byId = new Map(INDICATORS.map((i) => [i.id, i]))
export const indicatorById = (id: string | null | undefined): Indicator | undefined => (id ? byId.get(id) : undefined)

/** Colour of the solution containing the indicator at a pH (hex). */
export function indicatorColor(ind: Indicator, pH: number): string {
  if (ind.stops) {
    const s = ind.stops
    if (pH <= s[0][0]) return s[0][1]
    for (let i = 1; i < s.length; i++) {
      if (pH <= s[i][0]) return mixColors(s[i - 1][1], s[i][1], (pH - s[i - 1][0]) / (s[i][0] - s[i - 1][0]))
    }
    return s[s.length - 1][1]
  }
  const q = 1 / (1 + Math.pow(10, ind.pKin - pH)) // fraction in the basic form
  return mixColors(ind.acid, ind.base, q)
}

/** Colours across a pH range, for gradient bars: n stops from pH `from` to `to`. */
export function indicatorGradient(ind: Indicator, from = 0, to = 14, n = 29): Array<{ pH: number; color: string }> {
  return Array.from({ length: n }, (_, i) => {
    const pH = from + ((to - from) * i) / (n - 1)
    return { pH, color: indicatorColor(ind, pH) }
  })
}

/** Indicators whose range contains the pH (colour changes there), sorted by how central the pH is. */
export function indicatorsAt(pH: number): Indicator[] {
  return INDICATORS.filter((i) => !i.stops && pH >= i.lo && pH <= i.hi).sort((a, b) => Math.abs(a.pKin - pH) - Math.abs(b.pKin - pH))
}

// ---------------------------------------------------------------------------------------------- redox indicators

export interface RedoxIndicator {
  id: string
  name: string
  /** Formal potential (V vs SHE) of the indicator couple. */
  E0: number
  /** Electrons of the indicator couple. */
  n: number
  /** Colour of the oxidised and reduced forms. */
  ox: string
  red: string
  oxName: string
  redName: string
  note?: string
}

export const REDOX_INDICATORS: readonly RedoxIndicator[] = [
  { id: 'ferroin', name: 'Ferroin (Fe(phen)₃²⁺)', E0: 1.06, n: 1, ox: '#7fc4e8', red: '#d8403a', oxName: 'pale blue', redName: 'red', note: 'The classic indicator for Ce(IV) titrations.' },
  { id: 'nitroferroin', name: 'Nitroferroin', E0: 1.25, n: 1, ox: '#7fc4e8', red: '#d8503a', oxName: 'pale blue', redName: 'red' },
  { id: 'diphenylamine', name: 'Diphenylamine sulfonate', E0: 0.85, n: 2, ox: '#7a3fa8', red: WATER, oxName: 'violet', redName: 'colourless', note: 'Used with dichromate; add phosphoric acid to lower the Fe(III)/Fe(II) potential.' },
  { id: 'phenylanthranilic', name: 'N-Phenylanthranilic acid', E0: 1.08, n: 2, ox: '#a83f78', red: WATER, oxName: 'purple-red', redName: 'colourless' },
  { id: 'methylene', name: 'Methylene blue', E0: 0.53, n: 2, ox: '#2f62c4', red: WATER, oxName: 'blue', redName: 'colourless' },
  { id: 'indigo', name: 'Indigo tetrasulfonate', E0: 0.36, n: 2, ox: '#2f5fb8', red: '#ecd63c', oxName: 'blue', redName: 'yellow-colourless' },
  { id: 'starch', name: 'Starch (iodine complex)', E0: 0.45, n: 2, ox: '#26307a', red: WATER, oxName: 'blue-black', redName: 'colourless', note: 'Blue while iodine is present, colourless when it is used up. Modelled as a threshold at about 0.45 V (0.05 M iodide).' },
  { id: 'safranine', name: 'Safranine T', E0: 0.24, n: 2, ox: '#c83a66', red: WATER, oxName: 'red', redName: 'colourless' },
  { id: 'permanganate', name: 'Permanganate (self-indicating)', E0: 1.4, n: 5, ox: '#b02f98', red: WATER, oxName: 'purple', redName: 'colourless', note: 'The first persistent pink of excess MnO₄⁻; no indicator is added. Modelled as a threshold at about 1.40 V.' },
]

const redoxById = new Map(REDOX_INDICATORS.map((i) => [i.id, i]))
export const redoxIndicatorById = (id: string | null | undefined): RedoxIndicator | undefined => (id ? redoxById.get(id) : undefined)

/** Colour of a redox indicator at the electrode potential E (V) at temperature T (°C). */
export function redoxIndicatorColor(ind: RedoxIndicator, E: number, T = 25): string {
  const k = (Math.LN10 * 8.314462618 * (T + 273.15)) / 96485.33212
  const x = 1 / (1 + Math.pow(10, (-ind.n * (E - ind.E0)) / k)) // fraction oxidised
  return mixColors(ind.red, ind.ox, x)
}

// ---------------------------------------------------------------------------------------------- complexometric indicators

export interface MetalIndicator {
  id: string
  name: string
  /** Colour of the free indicator at the working pH, and of its metal complex. */
  free: string
  bound: string
  freeName: string
  boundName: string
  /** Acid constants of the indicator (to make the formation constants conditional), highest charge first. */
  pKa: number[]
  /** log K of M–In (formation from the fully deprotonated indicator), by metal symbol. */
  logK: Record<string, number>
  note?: string
}

export const METAL_INDICATORS: readonly MetalIndicator[] = [
  {
    id: 'ebt', name: 'Eriochrome Black T', free: '#3f5fc4', bound: '#c83a52', freeName: 'blue (pH 7–11)', boundName: 'wine red', pKa: [6.3, 11.6],
    logK: { Mg: 7.0, Ca: 5.4, Zn: 12.9 },
    note: 'Works at pH 10 (ammonia buffer). Calcium alone gives a poor end point; a little Mg–EDTA makes it sharp.',
  },
]

const metalIndById = new Map(METAL_INDICATORS.map((i) => [i.id, i]))
export const metalIndicatorById = (id: string | null | undefined): MetalIndicator | undefined => (id ? metalIndById.get(id) : undefined)

/** log K′ of the metal–indicator complex at a pH: log K − log(1 + [H]/Ka₃ + [H]²/(Ka₂Ka₃)). null when the metal is not known for this indicator. */
export function logConditionalIndicator(ind: MetalIndicator, symbol: string, pH: number): number | null {
  const logK = ind.logK[symbol]
  if (logK === undefined) return null
  const h = Math.pow(10, -pH)
  const [k2, k3] = ind.pKa.map((p) => Math.pow(10, -p))
  return logK - Math.log10(1 + h / k3 + (h * h) / (k2 * k3))
}
