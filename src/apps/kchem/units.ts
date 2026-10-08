// Common lab units: mass, volume, pressure, energy, temperature, amount, concentration, length.
// Pure functions.

export interface UnitDef {
  id: string
  /** Value of one of this unit in the category's base unit. */
  factor: number
}

export interface Category {
  id: string
  label: string
  units: UnitDef[]
  /** The base unit's name (for the hint). */
  base: string
}

const NA = 6.02214076e23
const EV = 1.602176634e-19
const CAL = 4.184

/** Energy: the base is the joule per molecule/object; "per mole" units divide by Avogadro's number. */
const ENERGY: UnitDef[] = [
  { id: 'J', factor: 1 },
  { id: 'kJ', factor: 1e3 },
  { id: 'cal', factor: CAL },
  { id: 'kcal', factor: CAL * 1e3 },
  { id: 'eV', factor: EV },
  { id: 'meV', factor: EV * 1e-3 },
  { id: 'Wh', factor: 3600 },
  { id: 'kWh', factor: 3.6e6 },
  { id: 'Eh (hartree)', factor: 4.3597447222071e-18 },
  { id: 'J/mol', factor: 1 / NA },
  { id: 'kJ/mol', factor: 1e3 / NA },
  { id: 'cal/mol', factor: CAL / NA },
  { id: 'kcal/mol', factor: (CAL * 1e3) / NA },
  { id: 'cm⁻¹ (wavenumber)', factor: 1.98644586e-23 },
  { id: 'K (k_B·T)', factor: 1.380649e-23 },
]

export const CATEGORIES: Category[] = [
  {
    id: 'mass', label: 'Mass', base: 'g',
    units: [
      { id: 'kg', factor: 1e3 }, { id: 'g', factor: 1 }, { id: 'mg', factor: 1e-3 }, { id: 'µg', factor: 1e-6 }, { id: 'ng', factor: 1e-9 },
      { id: 'lb', factor: 453.59237 }, { id: 'oz', factor: 28.349523125 }, { id: 'u (Da)', factor: 1.66053906660e-24 },
    ],
  },
  {
    id: 'volume', label: 'Volume', base: 'L',
    units: [
      { id: 'L', factor: 1 }, { id: 'mL', factor: 1e-3 }, { id: 'µL', factor: 1e-6 }, { id: 'm³', factor: 1e3 }, { id: 'cm³', factor: 1e-3 },
      { id: 'dm³', factor: 1 }, { id: 'gal (US)', factor: 3.785411784 }, { id: 'qt (US)', factor: 0.946352946 }, { id: 'fl oz (US)', factor: 0.0295735295625 },
    ],
  },
  {
    id: 'pressure', label: 'Pressure', base: 'Pa',
    units: [
      { id: 'Pa', factor: 1 }, { id: 'kPa', factor: 1e3 }, { id: 'MPa', factor: 1e6 }, { id: 'bar', factor: 1e5 }, { id: 'mbar', factor: 100 },
      { id: 'atm', factor: 101325 }, { id: 'mmHg', factor: 133.322387415 }, { id: 'Torr', factor: 101325 / 760 }, { id: 'psi', factor: 6894.757293168 },
    ],
  },
  { id: 'energy', label: 'Energy', base: 'J', units: ENERGY },
  { id: 'temperature', label: 'Temperature', base: 'K', units: [{ id: 'K', factor: 1 }, { id: '°C', factor: 1 }, { id: '°F', factor: 1 }] },
  {
    id: 'amount', label: 'Amount of substance', base: 'mol',
    units: [{ id: 'mol', factor: 1 }, { id: 'mmol', factor: 1e-3 }, { id: 'µmol', factor: 1e-6 }, { id: 'nmol', factor: 1e-9 }, { id: 'kmol', factor: 1e3 }],
  },
  {
    id: 'molarity', label: 'Concentration (molar)', base: 'mol/L',
    units: [
      { id: 'mol/L (M)', factor: 1 }, { id: 'mM', factor: 1e-3 }, { id: 'µM', factor: 1e-6 }, { id: 'nM', factor: 1e-9 }, { id: 'pM', factor: 1e-12 }, { id: 'mol/m³', factor: 1e-3 },
    ],
  },
  {
    id: 'massconc', label: 'Concentration (mass)', base: 'g/L',
    units: [
      { id: 'g/L', factor: 1 }, { id: 'mg/mL', factor: 1 }, { id: 'kg/m³', factor: 1 }, { id: 'mg/L (ppm)', factor: 1e-3 }, { id: 'µg/L (ppb)', factor: 1e-6 },
      { id: 'µg/mL', factor: 1e-3 }, { id: 'g/100 mL (% w/v)', factor: 10 }, { id: 'ng/mL', factor: 1e-6 },
    ],
  },
  {
    id: 'length', label: 'Length', base: 'm',
    units: [
      { id: 'm', factor: 1 }, { id: 'cm', factor: 1e-2 }, { id: 'mm', factor: 1e-3 }, { id: 'µm', factor: 1e-6 }, { id: 'nm', factor: 1e-9 },
      { id: 'Å', factor: 1e-10 }, { id: 'pm', factor: 1e-12 }, { id: 'in', factor: 0.0254 },
    ],
  },
]

export function getCategory(id: string): Category {
  const c = CATEGORIES.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown category ${id}.`)
  return c
}

const toKelvin = (v: number, u: string) => (u === '°C' ? v + 273.15 : u === '°F' ? ((v - 32) * 5) / 9 + 273.15 : v)
const fromKelvin = (k: number, u: string) => (u === '°C' ? k - 273.15 : u === '°F' ? ((k - 273.15) * 9) / 5 + 32 : k)

/** Converts a value between two units of a category. */
export function convert(category: string, value: number, from: string, to: string): number {
  if (!Number.isFinite(value)) throw new Error('Type a number.')
  const cat = getCategory(category)
  const f = cat.units.find((u) => u.id === from)
  const t = cat.units.find((u) => u.id === to)
  if (!f || !t) throw new Error(`Unknown unit in ${cat.label}.`)
  if (category === 'temperature') {
    const k = toKelvin(value, from)
    if (k < 0) throw new Error('That is below absolute zero.')
    return fromKelvin(k, to)
  }
  return (value * f.factor) / t.factor
}

/** The value in every unit of the category. */
export function convertAll(category: string, value: number, from: string): { unit: string; value: number }[] {
  return getCategory(category).units.map((u) => ({ unit: u.id, value: convert(category, value, from, u.id) }))
}
