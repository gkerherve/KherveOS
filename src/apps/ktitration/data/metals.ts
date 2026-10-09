// Metal–EDTA formation constants and side reactions (hydroxo and ammine complexes), and solubility products.
// Pure data; typical values at 25 °C and I = 0.1 (Harris, Quantitative Chemical Analysis; CRC Handbook), rounded.

import { pretty } from '../format.ts'

export interface Metal {
  id: string
  symbol: string
  ion: string
  /** log K of the M–EDTA complex (M + Y⁴⁻ ⇌ MY). */
  logKMY: number
  /** log β of the hydroxo complexes M(OH)n (cumulative), approximate. */
  hydroxo: number[]
  /** log β of the ammine complexes M(NH₃)n (cumulative). */
  ammine: number[]
  source: string
}

const HARRIS = 'Harris, Quantitative Chemical Analysis (EDTA complexes, 25 °C, I = 0.1); side reactions from the CRC Handbook, approximate'

type Row = [symbol: string, ion: string, logKMY: number, hydroxo: number[], ammine: number[]]
const ROWS: Row[] = [
  ['Mg', 'Mg^2+', 8.79, [2.6], []],
  ['Ca', 'Ca^2+', 10.65, [1.3], []],
  ['Sr', 'Sr^2+', 8.73, [0.8], []],
  ['Ba', 'Ba^2+', 7.86, [0.6], []],
  ['Mn', 'Mn^2+', 13.89, [3.4], []],
  ['Fe2', 'Fe^2+', 14.3, [4.5], []],
  ['Co', 'Co^2+', 16.45, [4.3, 8.4], [2.1, 3.7, 4.8, 5.5]],
  ['Ni', 'Ni^2+', 18.4, [4.1, 8.0], [2.75, 4.95, 6.64, 7.79]],
  ['Cu', 'Cu^2+', 18.78, [6.3, 12.8], [4.04, 7.47, 10.27, 11.75]],
  ['Zn', 'Zn^2+', 16.5, [4.4, 10.1], [2.27, 4.61, 7.01, 9.06]],
  ['Cd', 'Cd^2+', 16.5, [3.9, 7.7], [2.65, 4.75, 6.19, 7.12]],
  ['Hg', 'Hg^2+', 21.5, [10.6, 21.8], []],
  ['Pb', 'Pb^2+', 18.0, [6.3, 10.9], []],
  ['Al', 'Al^3+', 16.4, [9.0, 17.9, 26.0, 33.0], []],
  ['Fe3', 'Fe^3+', 25.1, [11.8, 22.3], []],
  ['Bi', 'Bi^3+', 27.8, [12.4, 25.1], []],
]

export const METALS: readonly Metal[] = ROWS.map(([symbol, ion, logKMY, hydroxo, ammine]) => ({
  id: symbol.toLowerCase(), symbol, ion: pretty(ion), logKMY, hydroxo, ammine, source: HARRIS,
}))

const byId = new Map(METALS.map((m) => [m.id, m]))
export const metalById = (id: string): Metal | undefined => byId.get(id.toLowerCase())

/** EDTA protonation constants (pKa of H₆Y²⁺ … HY³⁻). */
export const EDTA_PKA = [0.0, 1.5, 2.0, 2.69, 6.13, 10.37]

// ---------------------------------------------------------------------------------------------- solubility products

export interface Precipitate {
  id: string
  formula: string
  cation: string
  anion: string
  /** Formula units: cations and anions per formula unit. */
  nCat: number
  nAn: number
  Ksp: number
  note?: string
}

type KRow = [id: string, formula: string, cation: string, anion: string, nCat: number, nAn: number, Ksp: number, note?: string]
const KROWS: KRow[] = [
  ['agcl', 'AgCl', 'Ag^+', 'Cl^-', 1, 1, 1.77e-10],
  ['agbr', 'AgBr', 'Ag^+', 'Br^-', 1, 1, 5.35e-13],
  ['agi', 'AgI', 'Ag^+', 'I^-', 1, 1, 8.52e-17],
  ['agscn', 'AgSCN', 'Ag^+', 'SCN^-', 1, 1, 1.03e-12],
  ['agcn', 'AgCN', 'Ag^+', 'CN^-', 1, 1, 5.97e-17],
  ['ag2cro4', 'Ag2CrO4', 'Ag^+', 'CrO4^2-', 2, 1, 1.12e-12, 'Brick-red: the Mohr end point.'],
  ['ag2so4', 'Ag2SO4', 'Ag^+', 'SO4^2-', 2, 1, 1.2e-5],
  ['ag3po4', 'Ag3PO4', 'Ag^+', 'PO4^3-', 3, 1, 8.9e-17],
  ['cui', 'CuI', 'Cu^+', 'I^-', 1, 1, 1.27e-12],
  ['cuscn', 'CuSCN', 'Cu^+', 'SCN^-', 1, 1, 1.77e-13],
  ['hg2cl2', 'Hg2Cl2', 'Hg2^2+', 'Cl^-', 1, 2, 1.43e-18],
  ['pbcl2', 'PbCl2', 'Pb^2+', 'Cl^-', 1, 2, 1.7e-5],
  ['pbi2', 'PbI2', 'Pb^2+', 'I^-', 1, 2, 9.8e-9],
  ['pbso4', 'PbSO4', 'Pb^2+', 'SO4^2-', 1, 1, 2.53e-8],
  ['pbcro4', 'PbCrO4', 'Pb^2+', 'CrO4^2-', 1, 1, 2.8e-13],
  ['baso4', 'BaSO4', 'Ba^2+', 'SO4^2-', 1, 1, 1.08e-10],
  ['bacro4', 'BaCrO4', 'Ba^2+', 'CrO4^2-', 1, 1, 1.17e-10],
  ['srso4', 'SrSO4', 'Sr^2+', 'SO4^2-', 1, 1, 3.44e-7],
  ['caco3', 'CaCO3', 'Ca^2+', 'CO3^2-', 1, 1, 3.36e-9],
  ['caf2', 'CaF2', 'Ca^2+', 'F^-', 1, 2, 3.45e-11],
  ['cac2o4', 'CaC2O4', 'Ca^2+', 'C2O4^2-', 1, 1, 2.7e-9],
  ['mgoh2', 'Mg(OH)2', 'Mg^2+', 'OH^-', 1, 2, 5.61e-12],
  ['znoh2', 'Zn(OH)2', 'Zn^2+', 'OH^-', 1, 2, 3e-17],
  ['cuoh2', 'Cu(OH)2', 'Cu^2+', 'OH^-', 1, 2, 2.2e-20],
  ['feoh3', 'Fe(OH)3', 'Fe^3+', 'OH^-', 1, 3, 2.79e-39],
  ['aloh3', 'Al(OH)3', 'Al^3+', 'OH^-', 1, 3, 3e-34],
]

export const PRECIPITATES: readonly Precipitate[] = KROWS.map(([id, formula, cation, anion, nCat, nAn, Ksp, note]) => ({
  id, formula: pretty(formula), cation: pretty(cation), anion: pretty(anion), nCat, nAn, Ksp, ...(note ? { note } : {}),
}))

const kspById = new Map(PRECIPITATES.map((p) => [p.id, p]))
export const precipitateById = (id: string): Precipitate | undefined => kspById.get(id)
