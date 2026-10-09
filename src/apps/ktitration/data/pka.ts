// The pKa database of kTitration: acids, bases, ampholytes and buffers at 25 °C, zero ionic strength.
// The values are typical literature values, rounded to 0.01–0.05; real solutions differ with ionic strength,
// temperature and the medium. Every entry names where the value comes from. Pure data.

import { pretty } from '../format.ts'
import type { System } from '../equilibria.ts'

export type PkaCategory = 'Carboxylic acids' | 'Inorganic acids' | 'Polyprotic acids' | 'Phenols' | 'Amines and N-bases' | 'Amino acids' | 'Biological buffers'

export interface PkaEntry {
  id: string
  name: string
  /** Formula of the neutral or most protonated species, typeset. */
  formula: string
  /** The species from fully protonated to fully deprotonated, typeset. */
  forms: string[]
  pKa: number[]
  /** Charge of the fully protonated species. */
  z0: number
  category: PkaCategory
  source: string
  note?: string
  dpKadT?: number[]
}

const CRC = 'CRC Handbook of Chemistry and Physics, dissociation constants (25 °C, I → 0), rounded'
const HARRIS = 'Harris, Quantitative Chemical Analysis, table of acid dissociation constants (25 °C)'
const GOOD = 'Good et al., Biochemistry 5 (1966) 467, and supplier buffer tables (25 °C, I ≈ 0.1)'
const LEH = 'Lehninger, Principles of Biochemistry, amino acid table (25 °C)'
const DAWSON = 'Dawson et al., Data for Biochemical Research (25 °C)'

const ch = (z: number) => (z === 0 ? '' : `^${Math.abs(z) === 1 ? '' : Math.abs(z)}${z > 0 ? '+' : '-'}`)

/** Forms of an oxo-acid HₙA: H3PO4, H2PO4⁻, HPO4²⁻, PO4³⁻. */
function hfirst(stem: string, n: number, z0: number): string[] {
  return Array.from({ length: n + 1 }, (_, j) => {
    const h = n - j
    return (h === 0 ? '' : h === 1 ? 'H' : `H${h}`) + stem + ch(z0 - j)
  })
}

type Row = [id: string, name: string, forms: string[], pKa: number[], z0: number, cat: PkaCategory, src: string, extra?: { note?: string; dpKadT?: number[] }]

const mono = (id: string, name: string, ha: string, a: string, pKa: number, cat: PkaCategory, src = CRC, extra?: Row[7]): Row => [id, name, [ha, `${a}^-`], [pKa], 0, cat, src, extra]
const amine = (id: string, name: string, bh: string, b: string, pKa: number, src = CRC, extra?: Row[7]): Row => [id, name, [`${bh}^+`, b], [pKa], 1, 'Amines and N-bases', src, extra]
const oxo = (id: string, name: string, stem: string, pKa: number[], z0: number, cat: PkaCategory, src = CRC, extra?: Row[7]): Row => [id, name, hfirst(stem, pKa.length, z0), pKa, z0, cat, src, extra]
const amino = (id: string, name: string, s: string, pKa: number[], z0: number, note?: string): Row => {
  const n = pKa.length
  return [id, name, Array.from({ length: n + 1 }, (_, j) => `${j === n ? '' : j === n - 1 ? 'H' : `H${n - j}`}${s}${ch(z0 - j)}`), pKa, z0, 'Amino acids', LEH, note ? { note } : undefined]
}
const good = (id: string, name: string, hb: string, b: string, pKa: number, z0: number, dT: number, note?: string): Row => [id, name, [`${hb}${ch(z0)}`, `${b}${ch(z0 - 1)}`], [pKa], z0, 'Biological buffers', GOOD, { dpKadT: [dT], ...(note ? { note } : {}) }]

const ROWS: Row[] = [
  // carboxylic and other monoprotic organic acids
  mono('formic', 'Formic acid', 'HCOOH', 'HCOO', 3.75, 'Carboxylic acids'),
  mono('acetic', 'Acetic acid', 'CH3COOH', 'CH3COO', 4.76, 'Carboxylic acids', CRC, { dpKadT: [0.0002] }),
  mono('propionic', 'Propionic acid', 'C2H5COOH', 'C2H5COO', 4.87, 'Carboxylic acids'),
  mono('butanoic', 'Butanoic acid', 'C3H7COOH', 'C3H7COO', 4.82, 'Carboxylic acids'),
  mono('benzoic', 'Benzoic acid', 'C6H5COOH', 'C6H5COO', 4.2, 'Carboxylic acids'),
  mono('lactic', 'Lactic acid', 'CH3CH(OH)COOH', 'CH3CH(OH)COO', 3.86, 'Carboxylic acids'),
  mono('glycolic', 'Glycolic acid', 'HOCH2COOH', 'HOCH2COO', 3.83, 'Carboxylic acids'),
  mono('pyruvic', 'Pyruvic acid', 'CH3COCOOH', 'CH3COCOO', 2.5, 'Carboxylic acids'),
  mono('chloroacetic', 'Chloroacetic acid', 'ClCH2COOH', 'ClCH2COO', 2.87, 'Carboxylic acids'),
  mono('dichloroacetic', 'Dichloroacetic acid', 'Cl2CHCOOH', 'Cl2CHCOO', 1.35, 'Carboxylic acids'),
  mono('trichloroacetic', 'Trichloroacetic acid', 'Cl3CCOOH', 'Cl3CCOO', 0.66, 'Carboxylic acids', CRC, { note: 'Nearly a strong acid; the value is uncertain (0.5–0.7).' }),
  mono('trifluoroacetic', 'Trifluoroacetic acid', 'CF3COOH', 'CF3COO', 0.52, 'Carboxylic acids'),
  mono('sorbic', 'Sorbic acid', 'C5H7COOH', 'C5H7COO', 4.76, 'Carboxylic acids'),
  mono('ibuprofen', 'Ibuprofen', 'C13H18O2', 'C13H17O2', 4.45, 'Carboxylic acids', CRC, { note: 'Poorly soluble: titrate in a mixed solvent.' }),
  mono('aspirin', 'Acetylsalicylic acid (aspirin)', 'C9H8O4', 'C9H7O4', 3.49, 'Carboxylic acids', CRC, { note: 'Hydrolyses slowly in water.' }),
  mono('barbituric', 'Barbituric acid', 'C4H4N2O3', 'C4H3N2O3', 4.01, 'Carboxylic acids'),
  mono('uric', 'Uric acid', 'C5H4N4O3', 'C5H3N4O3', 5.4, 'Carboxylic acids', DAWSON),
  mono('acetylacetone', 'Acetylacetone', 'CH3COCH2COCH3', 'CH3COCHCOCH3', 8.99, 'Carboxylic acids'),
  // inorganic monoprotic
  mono('hf', 'Hydrofluoric acid', 'HF', 'F', 3.17, 'Inorganic acids'),
  mono('hcn', 'Hydrocyanic acid', 'HCN', 'CN', 9.21, 'Inorganic acids'),
  mono('hocl', 'Hypochlorous acid', 'HOCl', 'OCl', 7.54, 'Inorganic acids'),
  mono('hobr', 'Hypobromous acid', 'HOBr', 'OBr', 8.59, 'Inorganic acids'),
  mono('hno2', 'Nitrous acid', 'HNO2', 'NO2', 3.35, 'Inorganic acids'),
  mono('hn3', 'Hydrazoic acid', 'HN3', 'N3', 4.72, 'Inorganic acids'),
  mono('h2o2', 'Hydrogen peroxide', 'H2O2', 'HO2', 11.62, 'Inorganic acids'),
  mono('hclo2', 'Chlorous acid', 'HClO2', 'ClO2', 1.94, 'Inorganic acids'),
  mono('hso4', 'Hydrogensulfate', 'HSO4^-', 'SO4^2', 1.99, 'Inorganic acids', CRC, { note: 'Second step of sulfuric acid; the first step is strong.' }),
  [ 'boric', 'Boric acid', ['B(OH)3', 'B(OH)4^-'], [9.24], 0, 'Inorganic acids', CRC, { note: 'A Lewis acid (B(OH)₃ + 2 H₂O ⇌ B(OH)₄⁻ + H₃O⁺). With mannitol or glycerol it titrates as a much stronger acid.' } ],
  [ 'arsenous', 'Arsenous acid', ['H3AsO3', 'H2AsO3^-'], [9.23], 0, 'Inorganic acids', CRC ],
  [ 'phosphate2', 'Dihydrogenphosphate / hydrogenphosphate', ['H2PO4^-', 'HPO4^2-'], [7.2], -1, 'Inorganic acids', CRC, { note: 'The middle step of phosphoric acid: the pair used in phosphate buffers (pH 6–8).', dpKadT: [-0.0028] } ],
  [ 'hcro4', 'Hydrogenchromate', ['HCrO4^-', 'CrO4^2-'], [6.49], -1, 'Inorganic acids', CRC ],
  // polyprotic
  oxo('carbonic', 'Carbonic acid (CO₂ + H₂O)', 'CO3', [6.35, 10.33], 0, 'Polyprotic acids', CRC, { note: 'Apparent constants that include dissolved CO₂ (open systems exchange CO₂ with the air; the model keeps it in solution).', dpKadT: [-0.008, -0.009] }),
  oxo('phosphoric', 'Phosphoric acid', 'PO4', [2.15, 7.2, 12.35], 0, 'Polyprotic acids', CRC, { dpKadT: [0.005, -0.0028, -0.026] }),
  oxo('phosphorous', 'Phosphorous acid', 'HPO3', [1.3, 6.7], 0, 'Polyprotic acids', CRC, { note: 'Diprotic: the third hydrogen sits on phosphorus and does not ionise.' }),
  oxo('pyrophosphoric', 'Pyrophosphoric acid', 'P2O7', [0.85, 1.96, 6.6, 9.41], 0, 'Polyprotic acids'),
  oxo('arsenic', 'Arsenic acid', 'AsO4', [2.25, 6.77, 11.6], 0, 'Polyprotic acids'),
  oxo('selenous', 'Selenous acid', 'SeO3', [2.62, 8.32], 0, 'Polyprotic acids'),
  oxo('sulfurous', 'Sulfurous acid (SO₂ + H₂O)', 'SO3', [1.85, 7.2], 0, 'Polyprotic acids'),
  [ 'h2s', 'Hydrogen sulfide', ['H2S', 'HS^-', 'S^2-'], [7.02, 13.9], 0, 'Polyprotic acids', CRC, { note: 'The second constant is uncertain (13–19).' } ],
  oxo('silicic', 'Silicic acid', 'SiO4', [9.84, 13.2], 0, 'Polyprotic acids'),
  [ 'oxalic', 'Oxalic acid', ['H2C2O4', 'HC2O4^-', 'C2O4^2-'], [1.25, 4.27], 0, 'Polyprotic acids', HARRIS ],
  [ 'malonic', 'Malonic acid', ['CH2(COOH)2', 'CH2(COOH)COO^-', 'CH2(COO)2^2-'], [2.85, 5.7], 0, 'Polyprotic acids', CRC ],
  [ 'succinic', 'Succinic acid', ['H2Succ', 'HSucc^-', 'Succ^2-'], [4.21, 5.64], 0, 'Polyprotic acids', CRC ],
  [ 'glutaric', 'Glutaric acid', ['H2Glut', 'HGlut^-', 'Glut^2-'], [4.34, 5.27], 0, 'Polyprotic acids', CRC ],
  [ 'adipic', 'Adipic acid', ['H2Adip', 'HAdip^-', 'Adip^2-'], [4.43, 5.41], 0, 'Polyprotic acids', CRC ],
  [ 'maleic', 'Maleic acid', ['H2Mal', 'HMal^-', 'Mal^2-'], [1.92, 6.27], 0, 'Polyprotic acids', CRC ],
  [ 'fumaric', 'Fumaric acid', ['H2Fum', 'HFum^-', 'Fum^2-'], [3.02, 4.48], 0, 'Polyprotic acids', CRC ],
  [ 'phthalic', 'Phthalic acid', ['H2Phth', 'HPhth^-', 'Phth^2-'], [2.95, 5.41], 0, 'Polyprotic acids', CRC ],
  [ 'tartaric', 'Tartaric acid', ['H2Tar', 'HTar^-', 'Tar^2-'], [2.98, 4.34], 0, 'Polyprotic acids', CRC ],
  [ 'malic', 'Malic acid', ['H2Mlc', 'HMlc^-', 'Mlc^2-'], [3.4, 5.2], 0, 'Polyprotic acids', CRC ],
  [ 'citric', 'Citric acid', ['H3Cit', 'H2Cit^-', 'HCit^2-', 'Cit^3-'], [3.13, 4.76, 6.4], 0, 'Polyprotic acids', CRC, { note: 'The three steps overlap: the curve has one broad jump at the end.' } ],
  [ 'salicylic', 'Salicylic acid', ['H2Sal', 'HSal^-', 'Sal^2-'], [2.97, 13.6], 0, 'Polyprotic acids', CRC ],
  [ 'ascorbic', 'Ascorbic acid (vitamin C)', ['H2Asc', 'HAsc^-', 'Asc^2-'], [4.17, 11.57], 0, 'Polyprotic acids', CRC ],
  [ 'edta', 'EDTA (H₆Y²⁺ … Y⁴⁻)', ['H6Y^2+', 'H5Y^+', 'H4Y', 'H3Y^-', 'H2Y^2-', 'HY^3-', 'Y^4-'], [0.0, 1.5, 2.0, 2.69, 6.13, 10.37], 2, 'Polyprotic acids', HARRIS, { note: 'The disodium salt Na₂H₂Y is form 4. Y⁴⁻ is the species that binds metals.' } ],
  [ 'nta', 'Nitrilotriacetic acid (NTA)', ['H3Nta', 'H2Nta^-', 'HNta^2-', 'Nta^3-'], [1.65, 2.94, 10.33], 0, 'Polyprotic acids', CRC ],
  // phenols
  mono('phenol', 'Phenol', 'C6H5OH', 'C6H5O', 9.99, 'Phenols'),
  mono('ocresol', 'o-Cresol', 'CH3C6H4OH', 'CH3C6H4O', 10.29, 'Phenols'),
  mono('mcresol', 'm-Cresol', 'CH3C6H4OH', 'CH3C6H4O', 10.09, 'Phenols'),
  mono('pcresol', 'p-Cresol', 'CH3C6H4OH', 'CH3C6H4O', 10.26, 'Phenols'),
  mono('pchlorophenol', '4-Chlorophenol', 'ClC6H4OH', 'ClC6H4O', 9.41, 'Phenols'),
  mono('pnitrophenol', 'p-Nitrophenol', 'O2NC6H4OH', 'O2NC6H4O', 7.15, 'Phenols'),
  mono('dnp', '2,4-Dinitrophenol', '(O2N)2C6H3OH', '(O2N)2C6H3O', 4.09, 'Phenols'),
  mono('picric', 'Picric acid', '(O2N)3C6H2OH', '(O2N)3C6H2O', 0.38, 'Phenols'),
  [ 'hydroquinone', 'Hydroquinone', ['C6H4(OH)2', 'C6H4(OH)O^-', 'C6H4(O)2^2-'], [9.85, 11.4], 0, 'Phenols', CRC ],
  // amines and N-bases
  amine('ammonia', 'Ammonia / ammonium', 'NH4', 'NH3', 9.25, CRC, { dpKadT: [-0.031] }),
  amine('methylamine', 'Methylamine', 'CH3NH3', 'CH3NH2', 10.64),
  amine('ethylamine', 'Ethylamine', 'C2H5NH3', 'C2H5NH2', 10.65),
  amine('propylamine', 'Propylamine', 'C3H7NH3', 'C3H7NH2', 10.57),
  amine('dimethylamine', 'Dimethylamine', '(CH3)2NH2', '(CH3)2NH', 10.73),
  amine('diethylamine', 'Diethylamine', '(C2H5)2NH2', '(C2H5)2NH', 10.98),
  amine('trimethylamine', 'Trimethylamine', '(CH3)3NH', '(CH3)3N', 9.8),
  amine('triethylamine', 'Triethylamine', '(C2H5)3NH', '(C2H5)3N', 10.75),
  amine('ethanolamine', 'Ethanolamine', 'HOC2H4NH3', 'HOC2H4NH2', 9.5),
  amine('diethanolamine', 'Diethanolamine', '(HOC2H4)2NH2', '(HOC2H4)2NH', 8.88),
  amine('triethanolamine', 'Triethanolamine', '(HOC2H4)3NH', '(HOC2H4)3N', 7.76),
  amine('benzylamine', 'Benzylamine', 'C6H5CH2NH3', 'C6H5CH2NH2', 9.34),
  amine('aniline', 'Aniline', 'C6H5NH3', 'C6H5NH2', 4.6),
  amine('pyridine', 'Pyridine', 'C5H5NH', 'C5H5N', 5.23),
  amine('lutidine', '2,6-Lutidine', '(CH3)2C5H3NH', '(CH3)2C5H3N', 6.72),
  amine('quinoline', 'Quinoline', 'C9H7NH', 'C9H7N', 4.9),
  amine('imidazole', 'Imidazole', 'C3H5N2', 'C3H4N2', 6.99, CRC, { dpKadT: [-0.02] }),
  amine('piperidine', 'Piperidine', 'C5H10NH2', 'C5H10NH', 11.12),
  amine('morpholine', 'Morpholine', 'C4H8ONH2', 'C4H8ONH', 8.49),
  amine('hydrazine', 'Hydrazine', 'N2H5', 'N2H4', 8.07),
  amine('hydroxylamine', 'Hydroxylamine', 'NH3OH', 'NH2OH', 5.96),
  amine('guanidine', 'Guanidine', 'C(NH2)3', 'HNC(NH2)2', 13.6, CRC, { note: 'A very strong base: only the protonated form exists in water.' }),
  amine('urea', 'Urea', 'CO(NH2)2H', 'CO(NH2)2', 0.1, CRC, { note: 'A very weak base.' }),
  [ 'ethylenediamine', 'Ethylenediamine', ['H2en^2+', 'Hen^+', 'en'], [6.85, 9.93], 2, 'Amines and N-bases', HARRIS ],
  [ 'piperazine', 'Piperazine', ['H2Pip^2+', 'HPip^+', 'Pip'], [5.35, 9.73], 2, 'Amines and N-bases', CRC ],
  [ 'nicotine', 'Nicotine', ['H2Nic^2+', 'HNic^+', 'Nic'], [3.12, 8.02], 2, 'Amines and N-bases', CRC ],
  // amino acids (Lehninger: pK₁ carboxyl, then the side chain where there is one, then the amino group)
  amino('glycine', 'Glycine', 'Gly', [2.34, 9.6], 1, 'The simplest amino acid; isoelectric point 5.97.'),
  amino('alanine', 'Alanine', 'Ala', [2.34, 9.69], 1),
  amino('valine', 'Valine', 'Val', [2.32, 9.62], 1),
  amino('leucine', 'Leucine', 'Leu', [2.36, 9.6], 1),
  amino('isoleucine', 'Isoleucine', 'Ile', [2.36, 9.68], 1),
  amino('serine', 'Serine', 'Ser', [2.21, 9.15], 1),
  amino('threonine', 'Threonine', 'Thr', [2.63, 10.43], 1),
  amino('proline', 'Proline', 'Pro', [1.99, 10.6], 1),
  amino('phenylalanine', 'Phenylalanine', 'Phe', [1.83, 9.13], 1),
  amino('tryptophan', 'Tryptophan', 'Trp', [2.38, 9.39], 1),
  amino('methionine', 'Methionine', 'Met', [2.28, 9.21], 1),
  amino('asparagine', 'Asparagine', 'Asn', [2.02, 8.8], 1),
  amino('glutamine', 'Glutamine', 'Gln', [2.17, 9.13], 1),
  amino('aspartic', 'Aspartic acid', 'Asp', [1.88, 3.65, 9.6], 1, 'Acidic side chain (pKR 3.65): isoelectric point 2.77.'),
  amino('glutamic', 'Glutamic acid', 'Glu', [2.19, 4.25, 9.67], 1, 'Acidic side chain (pKR 4.25): isoelectric point 3.22.'),
  amino('lysine', 'Lysine', 'Lys', [2.18, 8.95, 10.53], 2, 'Basic side chain: isoelectric point 9.74.'),
  amino('arginine', 'Arginine', 'Arg', [2.17, 9.04, 12.48], 2, 'Basic side chain: isoelectric point 10.76.'),
  amino('histidine', 'Histidine', 'His', [1.82, 6.0, 9.17], 2, 'Imidazole side chain (pKR 6.0): isoelectric point 7.59.'),
  amino('cysteine', 'Cysteine', 'Cys', [1.96, 8.18, 10.28], 1, 'Thiol side chain (pKR 8.18). The thiol oxidises in air.'),
  amino('tyrosine', 'Tyrosine', 'Tyr', [2.2, 9.11, 10.07], 1, 'Phenol side chain (pKR 10.07).'),
  [ 'betaalanine', 'β-Alanine', ['H2βAla^+', 'HβAla', 'βAla^-'], [3.55, 10.24], 1, 'Amino acids', DAWSON ],
  [ 'gaba', 'GABA (4-aminobutyric acid)', ['H2GABA^+', 'HGABA', 'GABA^-'], [4.03, 10.56], 1, 'Amino acids', DAWSON ],
  [ 'taurine', 'Taurine', ['H2Tau^+', 'HTau', 'Tau^-'], [1.5, 9.06], 1, 'Amino acids', DAWSON ],
  [ 'glycylglycine', 'Glycylglycine', ['H2GlyGly^+', 'HGlyGly', 'GlyGly^-'], [3.14, 8.25], 1, 'Amino acids', GOOD, { dpKadT: [0, -0.025] } ],
  // buffers
  good('mes', 'MES', 'MES', 'MES', 6.15, 0, -0.011),
  good('ada', 'ADA', 'HADA', 'ADA', 6.6, -1, -0.011, 'pKa₂ of N-(2-acetamido)iminodiacetic acid.'),
  good('pipes', 'PIPES', 'HPIPES', 'PIPES', 6.76, -1, -0.0085),
  good('aces', 'ACES', 'ACES', 'ACES', 6.78, 0, -0.02),
  good('mopso', 'MOPSO', 'MOPSO', 'MOPSO', 6.9, 0, -0.015),
  good('bes', 'BES', 'BES', 'BES', 7.09, 0, -0.016),
  good('mops', 'MOPS', 'MOPS', 'MOPS', 7.2, 0, -0.015),
  good('tes', 'TES', 'TES', 'TES', 7.4, 0, -0.02),
  good('hepes', 'HEPES', 'HEPES', 'HEPES', 7.48, 0, -0.014, 'The most used cell-culture buffer; pH falls 0.17 from 25 to 37 °C.'),
  good('dipso', 'DIPSO', 'DIPSO', 'DIPSO', 7.52, 0, -0.015),
  good('epps', 'EPPS (HEPPS)', 'EPPS', 'EPPS', 8.0, 0, -0.015),
  good('tricine', 'Tricine', 'Tricine', 'Tricine', 8.05, 0, -0.021),
  good('taps', 'TAPS', 'TAPS', 'TAPS', 8.4, 0, -0.018),
  good('bicine', 'Bicine', 'Bicine', 'Bicine', 8.26, 0, -0.018),
  good('ches', 'CHES', 'CHES', 'CHES', 9.5, 0, -0.009),
  good('caps', 'CAPS', 'CAPS', 'CAPS', 10.4, 0, -0.009),
  [ 'tris', 'Tris (tris(hydroxymethyl)aminomethane)', ['TrisH^+', 'Tris'], [8.07], 1, 'Biological buffers', GOOD, { note: 'Very temperature-sensitive: pKa falls 0.028 per degree, so pH 7.4 at 25 °C is pH 7.1 at 37 °C.', dpKadT: [-0.028] } ],
  [ 'bistris', 'Bis-Tris', ['BisTrisH^+', 'BisTris'], [6.46], 1, 'Biological buffers', GOOD, { dpKadT: [-0.017] } ],
  [ 'cacodylic', 'Cacodylic acid', ['(CH3)2AsO2H', '(CH3)2AsO2^-'], [6.27], 0, 'Biological buffers', GOOD, { note: 'Contains arsenic: toxic.' } ],
]

export const PKA: readonly PkaEntry[] = ROWS.map(([id, name, forms, pKa, z0, category, source, extra]) => ({
  id,
  name,
  formula: pretty(forms[0]),
  forms: forms.map(pretty),
  pKa,
  z0,
  category,
  source,
  ...(extra?.note ? { note: extra.note } : {}),
  ...(extra?.dpKadT ? { dpKadT: extra.dpKadT } : {}),
}))

const byId = new Map(PKA.map((e) => [e.id, e]))

export const pkaById = (id: string): PkaEntry | undefined => byId.get(id)

/** The entry whose id or name matches (case-insensitive, ignoring accents' effect on plain ASCII), or whose name contains the text. */
export function findPka(text: string): PkaEntry | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  return (
    byId.get(t) ??
    PKA.find((e) => e.name.toLowerCase() === t) ??
    PKA.find((e) => e.formula.toLowerCase() === t || e.forms.some((f) => f.toLowerCase() === t)) ??
    PKA.find((e) => e.name.toLowerCase().startsWith(t)) ??
    PKA.find((e) => e.name.toLowerCase().includes(t))
  )
}

/** The system of an entry, ready for the equilibrium code. */
export function systemOf(e: PkaEntry): System {
  return { label: e.name, pKa: [...e.pKa], z0: e.z0, ...(e.dpKadT ? { dpKadT: [...e.dpKadT] } : {}) }
}

export function searchPka(query: string, category?: PkaCategory | ''): PkaEntry[] {
  const q = query.trim().toLowerCase()
  return PKA.filter((e) => (!category || e.category === category) && (!q || `${e.name} ${e.formula} ${e.forms.join(' ')} ${e.pKa.join(' ')} ${e.category}`.toLowerCase().includes(q)))
}

export const PKA_CATEGORIES: PkaCategory[] = ['Carboxylic acids', 'Inorganic acids', 'Polyprotic acids', 'Phenols', 'Amines and N-bases', 'Amino acids', 'Biological buffers']
