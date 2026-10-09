// Standard reduction potentials (V against the standard hydrogen electrode, 25 °C) and the couples used by the
// redox titrations. Pure data. Typical CRC Handbook values; formal potentials in a given medium differ.

import { pretty } from '../format.ts'

export interface Couple {
  id: string
  /** The half-reaction, typeset. */
  half: string
  ox: string
  red: string
  /** Standard (or formal) potential in V at pH 0. */
  E0: number
  /** Electrons per formula unit of the oxidised form. */
  n: number
  /** Protons consumed per oxidised unit (E falls by 0.0592·m/n per pH unit). */
  m: number
  /** Reduced species formed per oxidised unit (Cr₂O₇²⁻ → 2 Cr³⁺ is 2). */
  b: number
  /** Formal potentials in media, e.g. Fe³⁺/Fe²⁺ 0.68 V in 1 M H₂SO₄. */
  formal?: Array<{ medium: string; E: number }>
  note?: string
}

type Row = [id: string, half: string, ox: string, red: string, E0: number, n: number, m?: number, b?: number, formal?: Couple['formal'], note?: string]

const ROWS: Row[] = [
  ['li', 'Li^+ + e^- = Li', 'Li^+', 'Li', -3.04, 1],
  ['k', 'K^+ + e^- = K', 'K^+', 'K', -2.931, 1],
  ['ca', 'Ca^2+ + 2 e^- = Ca', 'Ca^2+', 'Ca', -2.868, 2],
  ['na', 'Na^+ + e^- = Na', 'Na^+', 'Na', -2.714, 1],
  ['mg', 'Mg^2+ + 2 e^- = Mg', 'Mg^2+', 'Mg', -2.372, 2],
  ['al', 'Al^3+ + 3 e^- = Al', 'Al^3+', 'Al', -1.662, 3],
  ['zn', 'Zn^2+ + 2 e^- = Zn', 'Zn^2+', 'Zn', -0.762, 2],
  ['fe2metal', 'Fe^2+ + 2 e^- = Fe', 'Fe^2+', 'Fe', -0.447, 2],
  ['cd', 'Cd^2+ + 2 e^- = Cd', 'Cd^2+', 'Cd', -0.403, 2],
  ['ni', 'Ni^2+ + 2 e^- = Ni', 'Ni^2+', 'Ni', -0.257, 2],
  ['sn2metal', 'Sn^2+ + 2 e^- = Sn', 'Sn^2+', 'Sn', -0.138, 2],
  ['pb', 'Pb^2+ + 2 e^- = Pb', 'Pb^2+', 'Pb', -0.126, 2],
  ['h', '2 H^+ + 2 e^- = H2', 'H^+', 'H2', 0, 2, 0, 1, undefined, 'Defines the scale.'],
  ['s4o6', 'S4O6^2- + 2 e^- = 2 S2O3^2-', 'S4O6^2-', 'S2O3^2-', 0.08, 2, 0, 2, undefined, 'Iodometric titrations: thiosulfate is the reductant.'],
  ['sn4', 'Sn^4+ + 2 e^- = Sn^2+', 'Sn^4+', 'Sn^2+', 0.151, 2],
  ['cu2cu1', 'Cu^2+ + e^- = Cu^+', 'Cu^2+', 'Cu^+', 0.153, 1],
  ['agcl', 'AgCl + e^- = Ag + Cl^-', 'AgCl', 'Ag', 0.222, 1],
  ['cu', 'Cu^2+ + 2 e^- = Cu', 'Cu^2+', 'Cu', 0.342, 2],
  ['ferricyanide', 'Fe(CN)6^3- + e^- = Fe(CN)6^4-', 'Fe(CN)6^3-', 'Fe(CN)6^4-', 0.358, 1],
  ['cu1', 'Cu^+ + e^- = Cu', 'Cu^+', 'Cu', 0.521, 1],
  ['i2', 'I2 + 2 e^- = 2 I^-', 'I2', 'I^-', 0.5355, 2, 0, 2, undefined, 'In practice I₃⁻ (0.536 V) in excess iodide.'],
  ['mno4mno42', 'MnO4^- + e^- = MnO4^2-', 'MnO4^-', 'MnO4^2-', 0.558, 1],
  ['o2h2o2', 'O2 + 2 H^+ + 2 e^- = H2O2', 'O2', 'H2O2', 0.695, 2, 2],
  ['fe3', 'Fe^3+ + e^- = Fe^2+', 'Fe^3+', 'Fe^2+', 0.771, 1, 0, 1, [{ medium: '1 M H₂SO₄', E: 0.68 }, { medium: '1 M HCl', E: 0.70 }, { medium: '1 M HClO₄', E: 0.735 }]],
  ['hg2', 'Hg2^2+ + 2 e^- = 2 Hg', 'Hg2^2+', 'Hg', 0.797, 2],
  ['ag', 'Ag^+ + e^- = Ag', 'Ag^+', 'Ag', 0.7996, 1],
  ['hg', 'Hg^2+ + 2 e^- = Hg', 'Hg^2+', 'Hg', 0.851, 2],
  ['no3', 'NO3^- + 4 H^+ + 3 e^- = NO + 2 H2O', 'NO3^-', 'NO', 0.957, 3, 4],
  ['vo2', 'VO2^+ + 2 H^+ + e^- = VO^2+ + H2O', 'VO2^+', 'VO^2+', 1.0, 1, 2],
  ['ferroin', 'Fe(phen)3^3+ + e^- = Fe(phen)3^2+', 'Fe(phen)3^3+', 'Fe(phen)3^2+', 1.06, 1, 0, 1, undefined, 'Ferroin, the redox indicator.'],
  ['br2', 'Br2 + 2 e^- = 2 Br^-', 'Br2', 'Br^-', 1.066, 2, 0, 2],
  ['mno2', 'MnO2 + 4 H^+ + 2 e^- = Mn^2+ + 2 H2O', 'MnO2', 'Mn^2+', 1.224, 2, 4],
  ['o2', 'O2 + 4 H^+ + 4 e^- = 2 H2O', 'O2', 'H2O', 1.229, 4, 4],
  ['cr2o7', 'Cr2O7^2- + 14 H^+ + 6 e^- = 2 Cr^3+ + 7 H2O', 'Cr2O7^2-', 'Cr^3+', 1.33, 6, 14, 2],
  ['cl2', 'Cl2 + 2 e^- = 2 Cl^-', 'Cl2', 'Cl^-', 1.358, 2, 0, 2],
  ['pbo2', 'PbO2 + 4 H^+ + 2 e^- = Pb^2+ + 2 H2O', 'PbO2', 'Pb^2+', 1.455, 2, 4],
  ['au3', 'Au^3+ + 3 e^- = Au', 'Au^3+', 'Au', 1.498, 3],
  ['mno4', 'MnO4^- + 8 H^+ + 5 e^- = Mn^2+ + 4 H2O', 'MnO4^-', 'Mn^2+', 1.507, 5, 8, 1, undefined, 'Self-indicating: the first drop in excess colours the solution purple.'],
  ['ce4', 'Ce^4+ + e^- = Ce^3+', 'Ce^4+', 'Ce^3+', 1.72, 1, 0, 1, [{ medium: '1 M H₂SO₄', E: 1.44 }, { medium: '1 M HNO₃', E: 1.61 }, { medium: '1 M HClO₄', E: 1.70 }]],
  ['h2o2', 'H2O2 + 2 H^+ + 2 e^- = 2 H2O', 'H2O2', 'H2O', 1.776, 2, 2, 2],
  ['co3', 'Co^3+ + e^- = Co^2+', 'Co^3+', 'Co^2+', 1.92, 1],
]

export const COUPLES: readonly Couple[] = ROWS.map(([id, half, ox, red, E0, n, m = 0, b = 1, formal, note]) => ({
  id, half: pretty(half), ox: pretty(ox), red: pretty(red), E0, n, m, b,
  ...(formal ? { formal } : {}), ...(note ? { note } : {}),
}))

const byId = new Map(COUPLES.map((c) => [c.id, c]))
export const coupleById = (id: string): Couple | undefined => byId.get(id)

/** The couples that make sense in a titration (the ones with a defined oxidised and reduced solution species). */
export const TITRATION_COUPLES = ['fe3', 'Fe^3+ + e^- = Fe^2+', 'mno4', 'cr2o7', 'i2', 's4o6', 'sn4', 'vo2', 'ferricyanide', 'cu2cu1', 'br2', 'co3'] as const

export function searchCouples(query: string): Couple[] {
  const q = query.trim().toLowerCase()
  return COUPLES.filter((c) => !q || `${c.half} ${c.ox} ${c.red} ${c.E0}`.toLowerCase().includes(q))
}
