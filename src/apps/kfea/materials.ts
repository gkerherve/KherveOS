// The materials library of kFEA (SI: Pa, kg/m³, 1/K). `sy` is the yield stress used for the safety factor (for
// brittle materials, concrete and timber: the strength used for design). Properties are typical handbook values.

export interface Material {
  id: string
  name: string
  /** Young's modulus, Pa */
  E: number
  /** Poisson's ratio */
  nu: number
  /** density, kg/m³ */
  rho: number
  /** yield (or design) strength, Pa */
  sy: number
  /** thermal expansion coefficient, 1/K */
  alpha: number
}

export const MATERIAL_LIBRARY: readonly Material[] = [
  { id: 'S235', name: 'Structural steel S235', E: 210e9, nu: 0.3, rho: 7850, sy: 235e6, alpha: 12e-6 },
  { id: 'S355', name: 'Structural steel S355', E: 210e9, nu: 0.3, rho: 7850, sy: 355e6, alpha: 12e-6 },
  { id: 'SS304', name: 'Stainless steel 304', E: 193e9, nu: 0.29, rho: 8000, sy: 215e6, alpha: 17.3e-6 },
  { id: 'AL6061', name: 'Aluminium 6061-T6', E: 68.9e9, nu: 0.33, rho: 2700, sy: 276e6, alpha: 23.6e-6 },
  { id: 'TI64', name: 'Titanium Ti-6Al-4V', E: 113.8e9, nu: 0.342, rho: 4430, sy: 880e6, alpha: 8.6e-6 },
  { id: 'CU', name: 'Copper (annealed)', E: 117e9, nu: 0.34, rho: 8960, sy: 70e6, alpha: 16.5e-6 },
  { id: 'C30', name: 'Concrete C30', E: 33e9, nu: 0.2, rho: 2400, sy: 30e6, alpha: 10e-6 },
  { id: 'TIMBER', name: 'Timber (spruce C24)', E: 11e9, nu: 0.3, rho: 420, sy: 24e6, alpha: 5e-6 },
  { id: 'CASTIRON', name: 'Cast iron (grey)', E: 110e9, nu: 0.26, rho: 7200, sy: 200e6, alpha: 10.5e-6 },
  { id: 'GLASS', name: 'Glass (soda-lime)', E: 70e9, nu: 0.22, rho: 2500, sy: 45e6, alpha: 9e-6 },
  { id: 'ABS', name: 'ABS plastic', E: 2.3e9, nu: 0.35, rho: 1050, sy: 40e6, alpha: 90e-6 },
  { id: 'PLA', name: 'PLA plastic', E: 3.5e9, nu: 0.36, rho: 1240, sy: 50e6, alpha: 68e-6 },
]

export function libraryMaterial(id: string): Material | undefined {
  return MATERIAL_LIBRARY.find((m) => m.id === id)
}

/** A material with every field checked (a file or an AI call may leave some out). */
export function cleanMaterial(m: Partial<Material> & { id: string }): Material {
  const base = libraryMaterial(m.id) ?? MATERIAL_LIBRARY[0]
  const pos = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  const nu = typeof m.nu === 'number' && m.nu > -1 && m.nu < 0.5 ? m.nu : base.nu
  return {
    id: m.id,
    name: typeof m.name === 'string' && m.name ? m.name : base.name,
    E: pos(m.E, base.E),
    nu,
    rho: typeof m.rho === 'number' && m.rho >= 0 ? m.rho : base.rho,
    sy: pos(m.sy, base.sy),
    alpha: typeof m.alpha === 'number' && Number.isFinite(m.alpha) ? m.alpha : base.alpha,
  }
}

/** Shear modulus. */
export const shearModulus = (m: Material): number => m.E / (2 * (1 + m.nu))
