// Chemical formulas (pure): "C7H6O3", "Ca(OH)2", "CuSO4·5H2O", "Fe2(SO4)3" → composition, molar mass, Hill order.
// Charges and states ("^2+", "(aq)") are ignored. Standard atomic weights (conventional values).

const WEIGHTS: Record<string, number> = {
  H: 1.008, D: 2.014, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982,
  Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906,
  Zr: 91.224, Nb: 92.906, Mo: 95.95, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.9,
  Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Er: 167.26,
  Yb: 173.05, Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59, Tl: 204.38, Pb: 207.2,
  Bi: 208.98, Th: 232.04, U: 238.03,
}

export const ELEMENTS: readonly string[] = Object.keys(WEIGHTS)

export class FormulaError extends Error {}

export type Composition = Record<string, number>

function add(into: Composition, from: Composition, times: number) {
  for (const [el, n] of Object.entries(from)) into[el] = (into[el] ?? 0) + n * times
}

/** Atoms per element. Throws FormulaError (with a readable message) for anything it does not understand. */
export function parseFormula(input: string): Composition {
  const text = input.replace(/\s+/g, '').replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/\((?:aq|s|l|g)\)$/i, '').replace(/\^?\d*[+-]$/, '')
  if (!text) throw new FormulaError('Empty formula.')
  let i = 0

  const number = (decimal = false): number | null => {
    const m = (decimal ? /^\d+(?:\.\d+)?/ : /^\d+/).exec(text.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }

  function group(close: string | null): Composition {
    const total: Composition = {}
    let current: Composition = {}
    const flush = () => { add(total, current, 1); current = {} }
    while (i < text.length) {
      const c = text[i]
      if (c === close) { flush(); return total }
      if (c === ')' || c === ']') throw new FormulaError(`Unmatched “${c}” in ${input}.`)
      if (c === '·' || c === '.' || c === '*' || c === '•') {
        i++
        flush()
        // a hydrate: CuSO4·5H2O
        const k = number(true) ?? 1
        const rest = group(close)
        add(total, rest, k)
        return total
      }
      if (c === '(' || c === '[') {
        i++
        const inner = group(c === '(' ? ')' : ']')
        i++ // the closing bracket
        const k = number() ?? 1
        add(current, inner, k)
        flush()
        continue
      }
      const m = /^[A-Z][a-z]?/.exec(text.slice(i))
      if (!m) throw new FormulaError(`Unexpected “${c}” in ${input}.`)
      let el = m[0]
      if (!(el in WEIGHTS) && el.length === 2 && el[1] >= 'a') {
        // “Co” vs “C” + “o”: fall back to the one-letter element when the two-letter one does not exist
        el = el[0]
      }
      if (!(el in WEIGHTS)) throw new FormulaError(`Unknown element “${el}” in ${input}.`)
      i += el.length
      const k = number() ?? 1
      current[el] = (current[el] ?? 0) + k
      flush()
    }
    if (close) throw new FormulaError(`Missing “${close}” in ${input}.`)
    flush()
    return total
  }

  return group(null)
}

/** g/mol of a formula, or null when it cannot be read. */
export function molarMass(formula: string): number | null {
  try {
    const comp = parseFormula(formula)
    let m = 0
    for (const [el, n] of Object.entries(comp)) m += WEIGHTS[el] * n
    return m
  } catch {
    return null
  }
}

/** Hill order: C, H, then the others alphabetically (no carbon: all alphabetical). "C9H8O4". */
export function hillFormula(comp: Composition): string {
  const els = Object.keys(comp).filter((e) => comp[e] > 0)
  const order = els.includes('C') ? ['C', ...(els.includes('H') ? ['H'] : []), ...els.filter((e) => e !== 'C' && e !== 'H').sort()] : els.sort()
  return order.map((e) => `${e}${comp[e] === 1 ? '' : Number(comp[e].toFixed(4))}`).join('')
}

/** Subscript digits for display: "C₉H₈O₄". */
export const prettyFormula = (f: string): string => f.replace(/(?<=[A-Za-z)\]])(\d+)/g, (d) => d.replace(/\d/g, (c) => String.fromCharCode(0x2080 + Number(c))))

/** Element-by-element mass fractions (percent), e.g. for a composition check. */
export function massPercent(formula: string): Record<string, number> | null {
  try {
    const comp = parseFormula(formula)
    const total = Object.entries(comp).reduce((s, [el, n]) => s + WEIGHTS[el] * n, 0)
    return Object.fromEntries(Object.entries(comp).map(([el, n]) => [el, (100 * WEIGHTS[el] * n) / total]))
  } catch {
    return null
  }
}
