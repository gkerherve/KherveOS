// A built-in table of common compounds: name → SMILES (and the formula it must give, checked by the tests).
// Pure data and a search; the reaction builder accepts any of these names instead of a SMILES.

export interface Compound {
  name: string
  smiles: string
  /** Hill formula (for display and for the test that the SMILES is right). */
  formula: string
  /** Other names people type. */
  aliases?: string[]
}

type Row = [name: string, smiles: string, formula: string, ...aliases: string[]]

const ROWS: Row[] = [
  // --- small molecules and gases
  ['water', 'O', 'H2O', 'h2o', 'oxidane'],
  ['hydrogen', '[H][H]', 'H2', 'dihydrogen', 'h2'],
  ['oxygen', 'O=O', 'O2', 'dioxygen', 'o2'],
  ['nitrogen', 'N#N', 'N2', 'dinitrogen', 'n2'],
  ['chlorine', 'ClCl', 'Cl2', 'cl2'],
  ['bromine', 'BrBr', 'Br2', 'br2'],
  ['iodine', 'II', 'I2', 'i2'],
  ['fluorine', 'FF', 'F2', 'f2'],
  ['ozone', '[O-][O+]=O', 'O3', 'o3'],
  ['carbon dioxide', 'O=C=O', 'CO2', 'co2'],
  ['carbon monoxide', '[C-]#[O+]', 'CO', 'co'],
  ['ammonia', 'N', 'H3N', 'nh3'],
  ['hydrogen peroxide', 'OO', 'H2O2', 'h2o2'],
  ['hydrogen chloride', 'Cl', 'ClH', 'hcl', 'hydrochloric acid'],
  ['hydrogen bromide', 'Br', 'BrH', 'hbr', 'hydrobromic acid'],
  ['hydrogen iodide', 'I', 'HI', 'hi'],
  ['hydrogen fluoride', 'F', 'FH', 'hf'],
  ['hydrogen sulfide', 'S', 'H2S', 'h2s'],
  ['sulfur dioxide', 'O=S=O', 'O2S', 'so2'],
  ['sulfur trioxide', 'O=S(=O)=O', 'O3S', 'so3'],
  ['sulfuric acid', 'OS(=O)(=O)O', 'H2O4S', 'h2so4'],
  ['nitric acid', 'O[N+](=O)[O-]', 'HNO3', 'hno3'],
  ['phosphoric acid', 'OP(=O)(O)O', 'H3O4P', 'h3po4'],
  ['nitric oxide', '[N]=O', 'NO', 'no', 'nitrogen monoxide'],
  ['nitrogen dioxide', '[O]N=O', 'NO2', 'no2'],
  ['dinitrogen tetroxide', 'O=[N+]([O-])[N+](=O)[O-]', 'N2O4', 'n2o4'],
  ['nitronium', 'O=[N+]=O', 'NO2+', 'nitronium ion'],
  ['carbonic acid', 'OC(O)=O', 'CH2O3', 'h2co3'],
  ['aluminium chloride', 'Cl[Al](Cl)Cl', 'AlCl3', 'alcl3', 'aluminum chloride'],
  ['boric acid', 'OB(O)O', 'BH3O3', 'h3bo3'],
  // --- ions
  ['proton', '[H+]', 'H+', 'h+', 'hydrogen ion'],
  ['hydronium', '[OH3+]', 'H3O+', 'h3o+'],
  ['hydroxide', '[OH-]', 'HO-', 'oh-', 'hydroxide ion'],
  ['hydride', '[H-]', 'H-', 'hydride ion'],
  ['chloride', '[Cl-]', 'Cl-', 'cl-', 'chloride ion'],
  ['bromide', '[Br-]', 'Br-', 'br-', 'bromide ion'],
  ['iodide', '[I-]', 'I-', 'iodide ion'],
  ['ammonium', '[NH4+]', 'H4N+', 'nh4+', 'ammonium ion'],
  ['sodium ion', '[Na+]', 'Na+', 'na+'],
  ['cyanide', '[C-]#N', 'CN-', 'cn-', 'cyanide ion'],
  ['acetate', 'CC(=O)[O-]', 'C2H3O2-', 'ethanoate'],
  ['bicarbonate', 'OC([O-])=O', 'CHO3-', 'hydrogencarbonate', 'hco3-'],
  ['methoxide', 'C[O-]', 'CH3O-', 'methoxide ion'],
  ['ethoxide', 'CC[O-]', 'C2H5O-', 'ethoxide ion'],
  ['tert-butoxide', 'CC(C)(C)[O-]', 'C4H9O-', 'tert-butoxide ion'],
  ['bisulfate', 'OS(=O)(=O)[O-]', 'HO4S-', 'hydrogensulfate', 'hso4-'],
  // --- salts and inorganic compounds
  ['sodium chloride', '[Na+].[Cl-]', 'ClNa', 'nacl', 'table salt', 'salt'],
  ['sodium hydroxide', '[Na+].[OH-]', 'HNaO', 'naoh', 'caustic soda'],
  ['potassium hydroxide', '[K+].[OH-]', 'HKO', 'koh'],
  ['potassium chloride', '[K+].[Cl-]', 'ClK', 'kcl'],
  ['sodium bromide', '[Na+].[Br-]', 'BrNa', 'nabr'],
  ['sodium nitrate', '[Na+].[O-][N+](=O)[O-]', 'NNaO3', 'nano3'],
  ['sodium sulfate', '[Na+].[Na+].[O-]S([O-])(=O)=O', 'Na2O4S', 'na2so4'],
  ['sodium carbonate', '[Na+].[Na+].[O-]C([O-])=O', 'CNa2O3', 'na2co3', 'soda ash'],
  ['sodium bicarbonate', '[Na+].OC([O-])=O', 'CHNaO3', 'nahco3', 'baking soda', 'sodium hydrogencarbonate'],
  ['sodium acetate', '[Na+].CC(=O)[O-]', 'C2H3NaO2', 'naoac'],
  ['sodium cyanide', '[Na+].[C-]#N', 'CNNa', 'nacn'],
  ['sodium methoxide', '[Na+].C[O-]', 'CH3NaO', 'naome'],
  ['sodium ethoxide', '[Na+].CC[O-]', 'C2H5NaO', 'naoet'],
  ['sodium borohydride', '[Na+].[BH4-]', 'BH4Na', 'nabh4'],
  ['lithium aluminium hydride', '[Li+].[AlH4-]', 'AlH4Li', 'lialh4', 'lah'],
  ['calcium carbonate', '[Ca+2].[O-]C([O-])=O', 'CCaO3', 'caco3', 'limestone'],
  ['calcium oxide', '[Ca+2].[O-2]', 'CaO', 'cao', 'quicklime'],
  ['calcium hydroxide', '[Ca+2].[OH-].[OH-]', 'CaH2O2', 'ca(oh)2', 'slaked lime'],
  ['calcium chloride', '[Ca+2].[Cl-].[Cl-]', 'CaCl2', 'cacl2'],
  ['magnesium oxide', '[Mg+2].[O-2]', 'MgO', 'mgo'],
  ['magnesium chloride', '[Mg+2].[Cl-].[Cl-]', 'Cl2Mg', 'mgcl2'],
  ['silver nitrate', '[Ag+].[O-][N+](=O)[O-]', 'AgNO3', 'agno3'],
  ['silver chloride', '[Ag+].[Cl-]', 'AgCl', 'agcl'],
  ['iron(iii) oxide', '[Fe+3].[Fe+3].[O-2].[O-2].[O-2]', 'Fe2O3', 'fe2o3', 'rust', 'ferric oxide'],
  ['aluminium oxide', '[Al+3].[Al+3].[O-2].[O-2].[O-2]', 'Al2O3', 'al2o3', 'alumina'],
  ['potassium permanganate', '[K+].[O-][Mn](=O)(=O)=O', 'KMnO4', 'kmno4'],
  ['manganese(ii) chloride', '[Mn+2].[Cl-].[Cl-]', 'Cl2Mn', 'mncl2'],
  ['copper(ii) sulfate', '[Cu+2].[O-]S([O-])(=O)=O', 'CuO4S', 'cuso4'],
  ['zinc chloride', '[Zn+2].[Cl-].[Cl-]', 'Cl2Zn', 'zncl2'],
  // --- elements
  ['hydrogen atom', '[H]', 'H', 'h'],
  ['sodium', '[Na]', 'Na', 'na'],
  ['magnesium', '[Mg]', 'Mg', 'mg'],
  ['aluminium', '[Al]', 'Al', 'al', 'aluminum'],
  ['iron', '[Fe]', 'Fe', 'fe'],
  ['copper', '[Cu]', 'Cu', 'cu'],
  ['zinc', '[Zn]', 'Zn', 'zn'],
  ['carbon', '[C]', 'C', 'graphite'],
  ['sulfur', '[S]', 'S', 's'],
  ['palladium', '[Pd]', 'Pd', 'pd'],
  ['chlorine radical', '[Cl]', 'Cl', 'chlorine atom'],
  ['methyl radical', '[CH3]', 'CH3', 'methyl'],
  // --- alkanes, alkenes, alkynes
  ['methane', 'C', 'CH4', 'ch4'],
  ['ethane', 'CC', 'C2H6'],
  ['propane', 'CCC', 'C3H8'],
  ['butane', 'CCCC', 'C4H10'],
  ['isobutane', 'CC(C)C', 'C4H10', '2-methylpropane'],
  ['pentane', 'CCCCC', 'C5H12'],
  ['hexane', 'CCCCCC', 'C6H14'],
  ['octane', 'CCCCCCCC', 'C8H18'],
  ['cyclohexane', 'C1CCCCC1', 'C6H12'],
  ['ethene', 'C=C', 'C2H4', 'ethylene'],
  ['propene', 'CC=C', 'C3H6', 'propylene'],
  ['but-1-ene', 'C=CCC', 'C4H8', '1-butene'],
  ['but-2-ene', 'CC=CC', 'C4H8', '2-butene'],
  ['isobutene', 'CC(C)=C', 'C4H8', '2-methylpropene'],
  ['cyclohexene', 'C1=CCCCC1', 'C6H10'],
  ['buta-1,3-diene', 'C=CC=C', 'C4H6', '1,3-butadiene', 'butadiene'],
  ['cyclopentadiene', 'C1=CC=CC1', 'C5H6'],
  ['ethyne', 'C#C', 'C2H2', 'acetylene'],
  ['propyne', 'CC#C', 'C3H4'],
  // --- aromatics
  ['benzene', 'c1ccccc1', 'C6H6'],
  ['toluene', 'Cc1ccccc1', 'C7H8', 'methylbenzene'],
  ['phenol', 'Oc1ccccc1', 'C6H6O'],
  ['aniline', 'Nc1ccccc1', 'C6H7N'],
  ['nitrobenzene', '[O-][N+](=O)c1ccccc1', 'C6H5NO2'],
  ['chlorobenzene', 'Clc1ccccc1', 'C6H5Cl'],
  ['bromobenzene', 'Brc1ccccc1', 'C6H5Br'],
  ['benzoic acid', 'OC(=O)c1ccccc1', 'C7H6O2'],
  ['benzaldehyde', 'O=Cc1ccccc1', 'C7H6O'],
  ['acetophenone', 'CC(=O)c1ccccc1', 'C8H8O'],
  ['styrene', 'C=Cc1ccccc1', 'C8H8', 'vinylbenzene'],
  ['benzenesulfonic acid', 'OS(=O)(=O)c1ccccc1', 'C6H6O3S'],
  ['cumene', 'CC(C)c1ccccc1', 'C9H12', 'isopropylbenzene'],
  ['biphenyl', 'c1ccc(cc1)-c1ccccc1', 'C12H10'],
  ['naphthalene', 'c1ccc2ccccc2c1', 'C10H8'],
  ['phenylboronic acid', 'OB(O)c1ccccc1', 'C6H7BO2'],
  ['phenylmagnesium bromide', 'Br[Mg]c1ccccc1', 'C6H5BrMg'],
  ['triphenylphosphine', 'c1ccc(cc1)P(c1ccccc1)c1ccccc1', 'C18H15P', 'pph3'],
  ['triphenylphosphine oxide', 'O=P(c1ccccc1)(c1ccccc1)c1ccccc1', 'C18H15OP'],
  ['methylenetriphenylphosphorane', 'C=P(c1ccccc1)(c1ccccc1)c1ccccc1', 'C19H17P', 'wittig reagent'],
  // --- alcohols, ethers, halides
  ['methanol', 'CO', 'CH4O', 'methyl alcohol'],
  ['ethanol', 'CCO', 'C2H6O', 'ethyl alcohol', 'alcohol'],
  ['propan-1-ol', 'CCCO', 'C3H8O', '1-propanol'],
  ['propan-2-ol', 'CC(C)O', 'C3H8O', 'isopropanol', '2-propanol', 'isopropyl alcohol'],
  ['butan-1-ol', 'CCCCO', 'C4H10O', '1-butanol'],
  ['tert-butanol', 'CC(C)(C)O', 'C4H10O', '2-methylpropan-2-ol', 'tert-butyl alcohol'],
  ['ethylene glycol', 'OCCO', 'C2H6O2', 'ethane-1,2-diol'],
  ['glycerol', 'OCC(O)CO', 'C3H8O3', 'glycerine', 'propane-1,2,3-triol'],
  ['diethyl ether', 'CCOCC', 'C4H10O', 'ether', 'ethoxyethane'],
  ['dimethyl ether', 'COC', 'C2H6O', 'methoxymethane'],
  ['ethyl methyl ether', 'CCOC', 'C3H8O', 'methoxyethane'],
  ['tetrahydrofuran', 'C1CCOC1', 'C4H8O', 'thf'],
  ['ethylene oxide', 'C1CO1', 'C2H4O', 'oxirane', 'epoxyethane'],
  ['chloromethane', 'CCl', 'CH3Cl', 'methyl chloride'],
  ['bromomethane', 'CBr', 'CH3Br', 'methyl bromide'],
  ['iodomethane', 'CI', 'CH3I', 'methyl iodide'],
  ['bromoethane', 'CCBr', 'C2H5Br', 'ethyl bromide'],
  ['chloroethane', 'CCCl', 'C2H5Cl', 'ethyl chloride'],
  ['2-bromopropane', 'CC(C)Br', 'C3H7Br', 'isopropyl bromide'],
  ['2-chloropropane', 'CC(C)Cl', 'C3H7Cl', 'isopropyl chloride'],
  ['1-bromobutane', 'CCCCBr', 'C4H9Br', 'butyl bromide'],
  ['tert-butyl bromide', 'CC(C)(C)Br', 'C4H9Br', '2-bromo-2-methylpropane'],
  ['tert-butyl chloride', 'CC(C)(C)Cl', 'C4H9Cl', '2-chloro-2-methylpropane'],
  ['1,2-dibromoethane', 'BrCCBr', 'C2H4Br2'],
  ['chloroform', 'ClC(Cl)Cl', 'CHCl3', 'trichloromethane'],
  ['dichloromethane', 'ClCCl', 'CH2Cl2', 'dcm', 'methylene chloride'],
  ['carbon tetrachloride', 'ClC(Cl)(Cl)Cl', 'CCl4', 'tetrachloromethane'],
  ['methylmagnesium bromide', 'C[Mg]Br', 'CH3BrMg', 'ch3mgbr'],
  ['ethylmagnesium bromide', 'CC[Mg]Br', 'C2H5BrMg', 'etmgbr'],
  // --- carbonyls, acids, esters, amides
  ['formaldehyde', 'C=O', 'CH2O', 'methanal'],
  ['acetaldehyde', 'CC=O', 'C2H4O', 'ethanal'],
  ['propanal', 'CCC=O', 'C3H6O'],
  ['acetone', 'CC(C)=O', 'C3H6O', 'propanone'],
  ['butanone', 'CCC(C)=O', 'C4H8O', 'methyl ethyl ketone', 'mek'],
  ['cyclohexanone', 'O=C1CCCCC1', 'C6H10O'],
  ['acrolein', 'C=CC=O', 'C3H4O', 'propenal'],
  ['3-hydroxybutanal', 'CC(O)CC=O', 'C4H8O2', 'aldol'],
  ['crotonaldehyde', 'CC=CC=O', 'C4H6O', 'but-2-enal'],
  ['formic acid', 'OC=O', 'CH2O2', 'methanoic acid'],
  ['acetic acid', 'CC(=O)O', 'C2H4O2', 'ethanoic acid', 'vinegar'],
  ['propanoic acid', 'CCC(=O)O', 'C3H6O2'],
  ['butanoic acid', 'CCCC(=O)O', 'C4H8O2'],
  ['oxalic acid', 'OC(=O)C(O)=O', 'C2H2O4', 'ethanedioic acid'],
  ['lactic acid', 'CC(O)C(=O)O', 'C3H6O3'],
  ['citric acid', 'OC(=O)CC(O)(CC(O)=O)C(O)=O', 'C6H8O7'],
  ['salicylic acid', 'OC(=O)c1ccccc1O', 'C7H6O3'],
  ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4', 'acetylsalicylic acid'],
  ['acetyl chloride', 'CC(=O)Cl', 'C2H3ClO', 'ethanoyl chloride'],
  ['acetic anhydride', 'CC(=O)OC(C)=O', 'C4H6O3', 'ethanoic anhydride'],
  ['maleic anhydride', 'O=C1C=CC(=O)O1', 'C4H2O3'],
  ['methyl acetate', 'COC(C)=O', 'C3H6O2', 'methyl ethanoate'],
  ['ethyl acetate', 'CCOC(C)=O', 'C4H8O2', 'ethyl ethanoate', 'etoac'],
  ['ethyl acetoacetate', 'CCOC(=O)CC(C)=O', 'C6H10O3'],
  ['methyl benzoate', 'COC(=O)c1ccccc1', 'C8H8O2'],
  ['methyl acrylate', 'C=CC(=O)OC', 'C4H6O2'],
  ['acetamide', 'CC(N)=O', 'C2H5NO', 'ethanamide'],
  ['n-methylacetamide', 'CNC(C)=O', 'C3H7NO'],
  ['urea', 'NC(N)=O', 'CH4N2O', 'carbamide'],
  // --- nitrogen compounds
  ['methylamine', 'CN', 'CH5N'],
  ['ethylamine', 'CCN', 'C2H7N'],
  ['dimethylamine', 'CNC', 'C2H7N'],
  ['trimethylamine', 'CN(C)C', 'C3H9N'],
  ['methylammonium', 'C[NH3+]', 'CH6N+', 'methylammonium ion'],
  ['acetonitrile', 'CC#N', 'C2H3N', 'ethanenitrile'],
  ['hydrogen cyanide', 'C#N', 'CHN', 'hcn'],
  ['n-benzylidenemethylamine', 'CN=Cc1ccccc1', 'C8H9N'],
  ['glycine', 'NCC(=O)O', 'C2H5NO2', 'gly'],
  ['alanine', 'CC(N)C(=O)O', 'C3H7NO2', 'ala'],
  // --- solvents, sugars and drugs
  ['dmso', 'CS(C)=O', 'C2H6OS', 'dimethyl sulfoxide'],
  ['dmf', 'CN(C)C=O', 'C3H7NO', 'dimethylformamide'],
  ['glucose', 'OCC1OC(O)C(O)C(O)C1O', 'C6H12O6', 'dextrose'],
  ['fructose', 'OCC1(O)OCC(O)C(O)C1O', 'C6H12O6'],
  ['sucrose', 'OCC1OC(CO)(OC2OC(CO)C(O)C(O)C2O)C(O)C1O', 'C12H22O11', 'table sugar'],
  ['caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2'],
  ['paracetamol', 'CC(=O)Nc1ccc(O)cc1', 'C8H9NO2', 'acetaminophen'],
  ['ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'C13H18O2'],
  ['norbornene anhydride', 'O=C1OC(=O)C2C1C1C=CC2C1', 'C9H8O3'],
]

export const COMPOUNDS: readonly Compound[] = ROWS.map(([name, smiles, formula, ...aliases]) => ({ name, smiles, formula, aliases }))

const BY_KEY = new Map<string, Compound>()
for (const c of COMPOUNDS) {
  BY_KEY.set(c.name.toLowerCase(), c)
  for (const a of c.aliases ?? []) if (!BY_KEY.has(a.toLowerCase())) BY_KEY.set(a.toLowerCase(), c)
}

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** The compound called exactly this (name or alias, any case), or null. */
export function findCompound(name: string): Compound | null {
  return BY_KEY.get(clean(name)) ?? null
}

/** The first compound whose SMILES is exactly this one (used to show a name next to a structure). */
export function nameOfSmiles(smiles: string): string | null {
  const s = smiles.trim()
  for (const c of COMPOUNDS) if (c.smiles === s) return c.name
  return null
}

/** Compounds matching a search text, best first: exact, prefix, word prefix, substring, alias. */
export function searchCompounds(query: string, limit = 12): Compound[] {
  const q = clean(query)
  if (q === '') return []
  const scored: { c: Compound; score: number }[] = []
  for (const c of COMPOUNDS) {
    const name = c.name.toLowerCase()
    let score = 0
    if (name === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 60
    else if (name.includes(q)) score = 40
    else if (c.aliases?.some((a) => a.toLowerCase() === q)) score = 90
    else if (c.aliases?.some((a) => a.toLowerCase().startsWith(q))) score = 50
    else if (c.aliases?.some((a) => a.toLowerCase().includes(q))) score = 30
    else if (c.formula.toLowerCase() === q) score = 70
    if (score > 0) scored.push({ c, score: score - Math.min(20, name.length / 4) })
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
  return scored.slice(0, limit).map((x) => x.c)
}
