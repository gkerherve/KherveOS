// Solutions at the bench: what to weigh for a concentration (molarity, molality, % w/v, % w/w,
// ppm), conversions between concentration units, serial dilutions and mixing. Pure functions.

export type WeighKind = 'molarity' | 'molality' | 'wv' | 'ww' | 'ppm'

export const WEIGH_KINDS: { id: WeighKind; label: string; unit: string; sizeLabel: string; sizeUnit: string }[] = [
  { id: 'molarity', label: 'Molarity', unit: 'mol/L', sizeLabel: 'Final volume', sizeUnit: 'mL' },
  { id: 'molality', label: 'Molality', unit: 'mol/kg', sizeLabel: 'Mass of solvent', sizeUnit: 'g' },
  { id: 'wv', label: '% w/v', unit: 'g/100 mL', sizeLabel: 'Final volume', sizeUnit: 'mL' },
  { id: 'ww', label: '% w/w', unit: '% by mass', sizeLabel: 'Mass of solution', sizeUnit: 'g' },
  { id: 'ppm', label: 'ppm (mg/L)', unit: 'mg/L', sizeLabel: 'Final volume', sizeUnit: 'mL' },
]

/**
 * Grams of solute to weigh for a concentration.
 *  molarity: mol/L × volume (mL);  molality: mol/kg × mass of solvent (g);
 *  wv: g/100 mL × volume (mL);  ww: % × mass of solution (g);  ppm: mg/L × volume (mL).
 * `purity` (percent, default 100) scales the mass to weigh for an impure reagent.
 */
export function weighOut(kind: WeighKind, value: number, size: number, molarMass: number, purity = 100): number {
  if (!(value >= 0) || !(size >= 0)) throw new Error('Concentration and size must be zero or more.')
  if (!(purity > 0 && purity <= 100)) throw new Error('Purity must be above 0 and at most 100 %.')
  let g: number
  switch (kind) {
    case 'molarity': g = value * (size / 1000) * molarMass; break
    case 'molality': g = value * (size / 1000) * molarMass; break
    case 'wv': g = (value / 100) * size; break
    case 'ww': g = (value / 100) * size; break
    case 'ppm': g = (value * (size / 1000)) / 1000; break
  }
  return (g * 100) / purity
}

export type ConcUnit = 'M' | 'gL' | 'wv' | 'ww' | 'ppm' | 'molal' | 'x'

export const CONC_UNITS: { id: ConcUnit; label: string }[] = [
  { id: 'M', label: 'mol/L (M)' },
  { id: 'gL', label: 'g/L' },
  { id: 'wv', label: '% w/v (g/100 mL)' },
  { id: 'ww', label: '% w/w' },
  { id: 'ppm', label: 'ppm (mg/L)' },
  { id: 'molal', label: 'molality (mol/kg)' },
  { id: 'x', label: 'mole fraction (water)' },
]

const WATER = 18.015

/** Concentration in g/L of solute from any unit. `density` is that of the solution in g/mL. */
function toGramsPerLitre(unit: ConcUnit, value: number, mm: number, density: number): number {
  const rho = density * 1000 // g/L of solution
  switch (unit) {
    case 'M': return value * mm
    case 'gL': return value
    case 'wv': return value * 10
    case 'ppm': return value / 1000
    case 'ww': return (value / 100) * rho
    case 'molal': {
      const g = value * mm // grams of solute per kg of solvent
      return (g * rho) / (1000 + g)
    }
    case 'x': {
      // x = n / (n + n_water) in water: grams solute per mole of solution mixture
      if (value >= 1) throw new Error('A mole fraction must be below 1.')
      const gSolute = value * mm
      const gWater = (1 - value) * WATER
      return (gSolute / (gSolute + gWater)) * rho
    }
  }
}

function fromGramsPerLitre(unit: ConcUnit, c: number, mm: number, density: number): number {
  const rho = density * 1000
  switch (unit) {
    case 'M': return c / mm
    case 'gL': return c
    case 'wv': return c / 10
    case 'ppm': return c * 1000
    case 'ww': return (100 * c) / rho
    case 'molal': {
      const solvent = rho - c
      if (solvent <= 0) throw new Error('The density is too low for this concentration (the solute alone would outweigh the solution).')
      return c / mm / (solvent / 1000)
    }
    case 'x': {
      const solvent = rho - c
      if (solvent <= 0) throw new Error('The density is too low for this concentration.')
      const n = c / mm
      return n / (n + solvent / WATER)
    }
  }
}

/** Converts a concentration to every unit. Needs the molar mass of the solute and the solution's density (g/mL). */
export function convertConcentration(unit: ConcUnit, value: number, molarMass: number, density: number): Record<ConcUnit, number> {
  if (!(value >= 0)) throw new Error('A concentration must be zero or more.')
  if (!(molarMass > 0)) throw new Error('Give the solute (or its molar mass).')
  if (!(density > 0)) throw new Error('Give the density of the solution (g/mL; 1.00 for a dilute aqueous one).')
  const c = toGramsPerLitre(unit, value, molarMass, density)
  const out = {} as Record<ConcUnit, number>
  for (const u of CONC_UNITS) {
    try {
      out[u.id] = u.id === unit ? value : fromGramsPerLitre(u.id, c, molarMass, density)
    } catch {
      out[u.id] = NaN
    }
  }
  return out
}

export interface SerialStep {
  step: number
  concentration: number
  /** Total dilution from the stock. */
  totalFactor: number
  /** Volume taken from the previous tube. */
  transfer: number
  /** Diluent added. */
  diluent: number
  /** Final volume of the tube. */
  volume: number
}

/** A serial dilution: each step takes volume/factor from the previous tube and adds diluent. */
export function serialDilution(stock: number, factor: number, steps: number, volume: number): SerialStep[] {
  if (!(stock > 0)) throw new Error('The stock concentration must be above zero.')
  if (!(factor > 1)) throw new Error('The dilution factor must be above 1 (10 means 1 part in 10).')
  if (!Number.isInteger(steps) || steps < 1 || steps > 30) throw new Error('Use 1 to 30 steps.')
  if (!(volume > 0)) throw new Error('The volume of each tube must be above zero.')
  const rows: SerialStep[] = []
  for (let i = 1; i <= steps; i++) {
    const totalFactor = Math.pow(factor, i)
    rows.push({ step: i, concentration: stock / totalFactor, totalFactor, transfer: volume / factor, diluent: volume - volume / factor, volume })
  }
  return rows
}

/** Mixing two solutions of the same solute (volumes assumed additive). */
export function mixSolutions(c1: number, v1: number, c2: number, v2: number): { concentration: number; volume: number; amount1: number; amount2: number } {
  if (![c1, v1, c2, v2].every((x) => Number.isFinite(x) && x >= 0)) throw new Error('Concentrations and volumes must be numbers of zero or more.')
  const volume = v1 + v2
  if (volume === 0) throw new Error('The total volume is zero.')
  return { concentration: (c1 * v1 + c2 * v2) / volume, volume, amount1: c1 * v1, amount2: c2 * v2 }
}
