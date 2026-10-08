// Acids, bases and pH at 25 °C (Kw = 1e-14): conversions, strong and weak acids and bases
// (exact: the weak acid quadratic, and a full charge balance for polyprotic acids), buffers
// (Henderson–Hasselbalch) and titration curves. Pure functions.

export const KW = 1e-14
export const PKW = 14

export const pOf = (x: number) => -Math.log10(x)

export interface PhSet {
  pH: number
  pOH: number
  H: number
  OH: number
}

export function phFrom(kind: 'pH' | 'pOH' | 'H' | 'OH', value: number): PhSet {
  let pH: number
  switch (kind) {
    case 'pH': pH = value; break
    case 'pOH': pH = PKW - value; break
    case 'H':
      if (!(value > 0)) throw new Error('[H+] must be above zero.')
      pH = pOf(value)
      break
    case 'OH':
      if (!(value > 0)) throw new Error('[OH-] must be above zero.')
      pH = PKW - pOf(value)
      break
  }
  if (!Number.isFinite(pH)) throw new Error('Type a number.')
  return { pH, pOH: PKW - pH, H: Math.pow(10, -pH), OH: Math.pow(10, pH - PKW) }
}

export interface Solution {
  pH: number
  H: number
  OH: number
  /** Fraction of the acid (or base) that is ionised in the first step, when it makes sense. */
  alpha: number | null
  /** Fractions of each protonation state, fully protonated first (acids only). */
  distribution: number[] | null
}

/** pH of a strong acid of concentration C (mol/L) giving `protons` H+ each, water's own H+ included. */
export function strongAcid(C: number, protons = 1): Solution {
  if (!(C >= 0)) throw new Error('The concentration must be zero or more.')
  const Ca = C * protons
  const H = (Ca + Math.sqrt(Ca * Ca + 4 * KW)) / 2
  return { pH: pOf(H), H, OH: KW / H, alpha: 1, distribution: null }
}

/** pH of a strong base of concentration C (mol/L) giving `hydroxides` OH- each. */
export function strongBase(C: number, hydroxides = 1): Solution {
  if (!(C >= 0)) throw new Error('The concentration must be zero or more.')
  const Cb = C * hydroxides
  const OH = (Cb + Math.sqrt(Cb * Cb + 4 * KW)) / 2
  return { pH: PKW - pOf(OH), H: KW / OH, OH, alpha: 1, distribution: null }
}

/** Fractions of an acid H_nA in each state (H_nA … A^n-) at a given [H+] (pKas in order). */
export function distribution(pKas: number[], H: number): number[] {
  const n = pKas.length
  // terms[j] = product of the first j Ka's / H^j  (j protons removed)
  const terms: number[] = [1]
  for (let j = 1; j <= n; j++) terms.push(terms[j - 1] * Math.pow(10, -pKas[j - 1]) / H)
  const sum = terms.reduce((a, b) => a + b, 0)
  return terms.map((t) => t / sum)
}

/** Average number of protons lost per acid molecule at [H+]. */
function protonsLost(pKas: number[], H: number): number {
  return distribution(pKas, H).reduce((s, a, j) => s + j * a, 0)
}

/** Solves a monotonic function of x = log10(H) by bisection. */
function bisect(f: (logH: number) => number, lo = -16, hi = 2): number {
  let a = lo
  let b = hi
  let fa = f(a)
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2
    const fm = f(m)
    if (fm === 0) return m
    if ((fa < 0) === (fm < 0)) {
      a = m
      fa = fm
    } else b = m
    if (b - a < 1e-14) break
  }
  return (a + b) / 2
}

/**
 * pH of a solution of a (poly)protic weak acid alone in water: the charge balance
 * [H+] = [OH-] + C·Σ j·α_j, solved exactly. `pKas` has one value per proton. A strong acid is a pKa below 0.
 */
export function weakAcid(C: number, pKas: number[]): Solution {
  if (!(C >= 0)) throw new Error('The concentration must be zero or more.')
  if (pKas.length === 0 || pKas.some((p) => !Number.isFinite(p))) throw new Error('Give the pKa (or Ka).')
  if (C === 0) return { pH: 7, H: 1e-7, OH: 1e-7, alpha: 0, distribution: distribution(pKas, 1e-7) }
  const g = (logH: number) => {
    const H = Math.pow(10, logH)
    return H - KW / H - C * protonsLost(pKas, H)
  }
  const logH = bisect(g)
  const H = Math.pow(10, logH)
  const dist = distribution(pKas, H)
  return { pH: -logH, H, OH: KW / H, alpha: dist.length > 1 ? 1 - dist[0] : null, distribution: dist }
}

/** A monoprotic weak acid by the plain quadratic x² + Ka·x − Ka·C = 0 (water ignored): [H+] = x. */
export function weakAcidQuadratic(C: number, Ka: number): number {
  return (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * C)) / 2
}

/** pH of a weak base (as B, with the pKa of its conjugate acid BH+, or pKb): solved like the acid in pOH. */
export function weakBase(C: number, pKb: number): Solution {
  const r = weakAcid(C, [pKb])
  return { pH: PKW - r.pH, H: r.OH, OH: r.H, alpha: r.alpha, distribution: null }
}

export const pKbFromPKa = (pKa: number) => PKW - pKa

// ------------------------------------------------------------ buffers

/** Henderson–Hasselbalch: pH = pKa + log10([A-]/[HA]). */
export function bufferPH(pKa: number, acid: number, base: number): number {
  if (!(acid > 0) || !(base > 0)) throw new Error('Both the acid and its conjugate base are needed (above zero).')
  return pKa + Math.log10(base / acid)
}

export interface BufferRecipe {
  /** [A-]/[HA] needed. */
  ratio: number
  /** Moles of the acid form and of the conjugate base for the volume asked. */
  molesAcid: number
  molesBase: number
  /** Alternative: start from the acid only and add this many moles of strong base (NaOH) to reach the pH. */
  molesStrongBase: number
  /** Alternative: start from the base only and add this many moles of strong acid (HCl). */
  molesStrongAcid: number
  /** True when the pH is further than one unit from the pKa (a poor buffer). */
  weak: boolean
}

/** The amounts for a buffer of a target pH: total buffer concentration (mol/L) and volume (L). */
export function bufferRecipe(pKa: number, targetPH: number, totalConc: number, volumeL: number): BufferRecipe {
  if (!(totalConc > 0) || !(volumeL > 0)) throw new Error('The buffer concentration and volume must be above zero.')
  const ratio = Math.pow(10, targetPH - pKa)
  const total = totalConc * volumeL
  const molesBase = (total * ratio) / (1 + ratio)
  const molesAcid = total - molesBase
  return { ratio, molesAcid, molesBase, molesStrongBase: molesBase, molesStrongAcid: molesAcid, weak: Math.abs(targetPH - pKa) > 1 }
}

// ------------------------------------------------------------ titration

export interface TitrationPoint {
  /** Volume of titrant added (mL). */
  volume: number
  pH: number
}

export interface TitrationCurve {
  points: TitrationPoint[]
  /** Equivalence volumes (mL), one per proton. */
  equivalence: number[]
  /** pH at each equivalence point. */
  equivalencePH: number[]
  /** pH at half of the first equivalence volume. */
  halfPH: number
  start: number
}

export interface TitrationInput {
  /** 'acid' titrated with a strong base, or 'base' titrated with a strong acid. */
  analyte: 'acid' | 'base'
  /** Analyte concentration (mol/L) and volume (mL). */
  concentration: number
  volume: number
  /** pKa of each proton (acid) or of the conjugate acid for each protonation step of the base (use pKb for a base: pass pKb values). Strong: [-3]. */
  pKs: number[]
  /** Titrant concentration (mol/L). */
  titrant: number
  /** Volume to go up to (mL); default 1.6 × the last equivalence. */
  maxVolume?: number
  points?: number
}

/** pH during a titration, from the charge balance (exact: includes water and every dissociation step). */
export function titrationPH(a: Pick<TitrationInput, 'analyte' | 'concentration' | 'volume' | 'pKs' | 'titrant'>, titrantMl: number): number {
  const total = a.volume + titrantMl
  const C = (a.concentration * a.volume) / total
  const T = (a.titrant * titrantMl) / total
  const g = (logH: number) => {
    const H = Math.pow(10, logH)
    return T + H - KW / H - C * protonsLost(a.pKs, H)
  }
  // for a base the same equation holds in the OH- scale
  const logH = bisect(g, -17, 3)
  return a.analyte === 'acid' ? -logH : PKW + logH
}

/** The whole titration curve of an acid with NaOH (or of a base with HCl). */
export function titrationCurve(input: TitrationInput): TitrationCurve {
  const { concentration, volume, titrant, pKs } = input
  if (![concentration, volume, titrant].every((x) => x > 0)) throw new Error('Concentrations and volumes must be above zero.')
  if (pKs.length === 0 || pKs.length > 3) throw new Error('Give 1 to 3 pKa values.')
  const eq1 = (concentration * volume) / titrant
  const equivalence = pKs.map((_, i) => eq1 * (i + 1))
  const last = equivalence[equivalence.length - 1]
  const maxV = input.maxVolume && input.maxVolume > 0 ? input.maxVolume : last * 1.6
  const n = Math.min(600, Math.max(40, input.points ?? 240))
  const set = new Set<number>()
  for (let i = 0; i <= n; i++) set.add((maxV * i) / n)
  // extra points around each equivalence for a sharp jump
  for (const e of equivalence) for (const d of [-0.5, -0.2, -0.05, -0.01, 0.01, 0.05, 0.2, 0.5]) if (e + d > 0 && e + d < maxV) set.add(e + d)
  const vols = [...set].sort((a, b) => a - b)
  const points = vols.map((v) => ({ volume: v, pH: titrationPH(input, v) }))
  return {
    points,
    equivalence,
    equivalencePH: equivalence.map((e) => titrationPH(input, e)),
    halfPH: titrationPH(input, eq1 / 2),
    start: titrationPH(input, 0),
  }
}

// ------------------------------------------------------------ common acids

export interface AcidInfo {
  name: string
  /** Formula of the fully protonated form. */
  formula: string
  pKa: number[]
  /** What it is good for. */
  note?: string
}

export const COMMON_ACIDS: AcidInfo[] = [
  { name: 'Hydrochloric acid', formula: 'HCl', pKa: [-6.3], note: 'strong' },
  { name: 'Nitric acid', formula: 'HNO3', pKa: [-1.4], note: 'strong' },
  { name: 'Sulfuric acid', formula: 'H2SO4', pKa: [-3, 1.99], note: 'strong, then pKa2 1.99' },
  { name: 'Phosphoric acid', formula: 'H3PO4', pKa: [2.15, 7.2, 12.35], note: 'phosphate buffer near 7.2' },
  { name: 'Oxalic acid', formula: 'H2C2O4', pKa: [1.25, 4.27] },
  { name: 'Sulfurous acid', formula: 'H2SO3', pKa: [1.85, 7.2] },
  { name: 'Hydrofluoric acid', formula: 'HF', pKa: [3.17], note: 'weak, very hazardous' },
  { name: 'Nitrous acid', formula: 'HNO2', pKa: [3.15] },
  { name: 'Formic acid', formula: 'HCOOH', pKa: [3.75] },
  { name: 'Lactic acid', formula: 'C3H6O3', pKa: [3.86] },
  { name: 'Benzoic acid', formula: 'C7H6O2', pKa: [4.2] },
  { name: 'Ascorbic acid', formula: 'C6H8O6', pKa: [4.17, 11.6] },
  { name: 'Citric acid', formula: 'C6H8O7', pKa: [3.13, 4.76, 6.4], note: 'citrate buffer 3–6.5' },
  { name: 'Acetic acid', formula: 'CH3COOH', pKa: [4.76], note: 'acetate buffer near 4.76' },
  { name: 'Carbonic acid', formula: 'H2CO3', pKa: [6.35, 10.33], note: 'bicarbonate buffer' },
  { name: 'Hydrogen sulfide', formula: 'H2S', pKa: [7.0, 12.9] },
  { name: 'Hypochlorous acid', formula: 'HOCl', pKa: [7.54] },
  { name: 'Ammonium ion', formula: 'NH4+', pKa: [9.25], note: 'NH3 is the base (pKb 4.75)' },
  { name: 'Boric acid', formula: 'H3BO3', pKa: [9.24] },
  { name: 'Hydrocyanic acid', formula: 'HCN', pKa: [9.21], note: 'very toxic' },
  { name: 'Glycine', formula: 'C2H5NO2', pKa: [2.34, 9.6] },
  { name: 'MES', formula: 'C6H13NO4S', pKa: [6.1], note: 'biological buffer' },
  { name: 'PIPES', formula: 'C8H18N2O6S2', pKa: [6.76], note: 'biological buffer' },
  { name: 'MOPS', formula: 'C7H15NO4S', pKa: [7.2], note: 'biological buffer' },
  { name: 'HEPES', formula: 'C8H18N2O4S', pKa: [7.48], note: 'biological buffer' },
  { name: 'Tris (as TrisH+)', formula: 'C4H12NO3+', pKa: [8.07], note: 'biological buffer' },
]

export const COMMON_BASES: { name: string; formula: string; pKb: number }[] = [
  { name: 'Ammonia', formula: 'NH3', pKb: 4.75 },
  { name: 'Methylamine', formula: 'CH3NH2', pKb: 3.36 },
  { name: 'Ethylamine', formula: 'C2H5NH2', pKb: 3.35 },
  { name: 'Pyridine', formula: 'C5H5N', pKb: 8.77 },
  { name: 'Aniline', formula: 'C6H5NH2', pKb: 9.37 },
  { name: 'Hydrazine', formula: 'N2H4', pKb: 5.9 },
  { name: 'Acetate ion', formula: 'CH3COO-', pKb: 9.24 },
  { name: 'Carbonate ion', formula: 'CO3^2-', pKb: 3.67 },
]
