// The reaction library: curated reactions as pure data (SMILES, coefficients, conditions, an explanation) and,
// for many, a step-by-step mechanism with the structures of every intermediate, the electron pushing in words
// and illustrative relative energies for the energy profile (kJ/mol; textbook-sized, not computed).
// tools/tests/kreaction.test.ts checks that every reaction and every mechanism state is atom- and charge-balanced.

import type { ArrowKind } from './reaction.ts'

export type ReactionClass =
  | 'Substitution' | 'Elimination' | 'Addition' | 'Carbonyl chemistry' | 'Aromatic substitution' | 'Oxidation / reduction'
  | 'Coupling' | 'Acid–base' | 'Combustion' | 'Industrial' | 'Biochemical' | 'Pericyclic' | 'Radical' | 'Precipitation / displacement'

export const REACTION_CLASSES: readonly ReactionClass[] = [
  'Substitution', 'Elimination', 'Addition', 'Carbonyl chemistry', 'Aromatic substitution', 'Oxidation / reduction', 'Coupling',
  'Acid–base', 'Combustion', 'Industrial', 'Biochemical', 'Pericyclic', 'Radical', 'Precipitation / displacement',
]

/** One state along a mechanism: the species present, what happened to get here, and the energies. */
export interface MechState {
  /** Short title ("Carbocation", "Tetrahedral intermediate"…). */
  label: string
  /** SMILES of every species present at this point (all of them, so the state balances). */
  species: string[]
  /** What happens to arrive here: the electron pushing in words (for state 0: the starting point). */
  text: string
  /** Energy of this state, kJ/mol relative to the reactants. */
  energy: number
  /** Energy of the transition state on the way here (≥ both neighbours); absent for state 0. */
  ts?: number
}

export interface LibReaction {
  id: string
  name: string
  cls: ReactionClass
  reactants: string[]
  products: string[]
  /** Smallest whole-number coefficients, reactants then products. */
  coeffs: number[]
  arrow: ArrowKind
  /** Text above the arrow: reagents and catalysts. */
  above: string
  /** Text below the arrow: solvent, temperature, light. */
  below: string
  explanation: string
  /** Species that take part in the mechanism without being in the overall equation (catalysts, solvent, acid). */
  extras?: string[]
  /** Overall reaction enthalpy in kJ/mol of the equation as written, when known. */
  dH?: number
  /** Activation energy in kJ/mol of the uncatalysed forward reaction, when known. */
  ea?: number
  mechanism?: MechState[]
}

const S = (label: string, species: string[], energy: number, text: string, ts?: number): MechState => ({ label, species, energy, text, ts })

const ACYL = 'Cl[Al-](Cl)(Cl)Cl'
const ALCL3 = 'Cl[Al](Cl)Cl'
const PH = 'c1ccccc1'

export const LIBRARY: readonly LibReaction[] = [
  // ------------------------------------------------------------------ substitution and elimination
  {
    id: 'sn2', name: 'SN2: bromoethane + hydroxide', cls: 'Substitution',
    reactants: ['CCBr', '[OH-]'], products: ['CCO', '[Br-]'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'NaOH', below: 'DMSO or acetone, 25 °C', dH: -55, ea: 85,
    explanation: 'Bimolecular nucleophilic substitution. The nucleophile attacks the carbon from the side opposite the leaving group while the C–Br bond breaks, all in one step, so the rate depends on both the halide and the nucleophile (rate = k[RBr][HO⁻]). The carbon is inverted like an umbrella in the wind (Walden inversion). It is fastest for methyl and primary halides, with strong nucleophiles in polar aprotic solvents.',
    mechanism: [
      S('Reactants', ['CCBr', '[OH-]'], 0, 'Hydroxide (the nucleophile, with lone pairs on oxygen) meets bromoethane. Bromine is more electronegative than carbon, so the C–Br carbon is slightly positive (δ+).'),
      S('Products', ['CCO', '[Br-]'], -55, 'A lone pair on O of HO⁻ attacks the carbon from the back side, opposite to Br, while the C–Br bonding pair leaves with bromine as Br⁻. One concerted step through a five-coordinate transition state [HO···CH2(CH3)···Br]⁻; the carbon is inverted.', 85),
    ],
  },
  {
    id: 'sn1', name: 'SN1: tert-butyl bromide hydrolysis', cls: 'Substitution',
    reactants: ['CC(C)(C)Br', 'O'], products: ['CC(C)(C)O', 'Br'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'H2O', below: 'water / acetone, 25 °C', dH: -20, ea: 95,
    explanation: 'Unimolecular substitution. The slow step is the ionisation of the C–Br bond to a stabilised tertiary carbocation; the nucleophile (here the solvent) then captures it in a fast step. The rate depends on the halide only (rate = k[RBr]). It is favoured by tertiary substrates, good leaving groups and polar protic solvents; a stereocentre would racemise.',
    mechanism: [
      S('Reactants', ['CC(C)(C)Br', 'O'], 0, 'tert-Butyl bromide in water. The C–Br bond is polarised and weak because the three methyl groups can stabilise a positive charge on carbon.'),
      S('Carbocation', ['C[C+](C)C', '[Br-]', 'O'], 70, 'Rate-determining step: the C–Br bonding pair leaves with bromine (heterolysis), giving a planar tertiary carbocation and Br⁻. Polar protic water stabilises both ions.', 90),
      S('Oxonium ion', ['CC(C)(C)[OH2+]', '[Br-]'], 55, 'A lone pair on the oxygen of water attacks the empty p orbital of the carbocation from either face, forming a C–O bond (fast).', 72),
      S('Products', ['CC(C)(C)O', '[H+]', '[Br-]'], -20, 'A second water molecule (not drawn) removes a proton from the oxonium ion: the O–H bonding pair stays on oxygen and gives tert-butanol and H⁺ (with Br⁻: HBr).', 58),
    ],
  },
  {
    id: 'e2', name: 'E2: 2-bromopropane + ethoxide', cls: 'Elimination',
    reactants: ['CC(C)Br', 'CC[O-]'], products: ['CC=C', 'CCO', '[Br-]'], coeffs: [1, 1, 1, 1, 1], arrow: 'forward',
    above: 'NaOEt', below: 'ethanol, 55 °C', dH: -30, ea: 90,
    explanation: 'Bimolecular elimination. A strong base removes a β-hydrogen at the same moment the leaving group departs and the C=C double bond forms. The H and the leaving group must be anti-periplanar. Rate = k[RBr][base]. Strong, bulky bases and heat favour E2 over SN2; the more substituted alkene (Zaitsev) usually wins.',
    mechanism: [
      S('Reactants', ['CC(C)Br', 'CC[O-]'], 0, 'Ethoxide is a strong base. 2-Bromopropane has six β-hydrogens on the two methyl groups.'),
      S('Products', ['CC=C', 'CCO', '[Br-]'], -30, 'One concerted step: a lone pair on O⁻ takes a β-hydrogen, the C–H bonding pair becomes the new C=C π bond, and the C–Br bonding pair leaves with Br⁻. The H–C–C–Br unit is anti-periplanar in the transition state.', 90),
    ],
  },
  {
    id: 'e1', name: 'E1: tert-butyl bromide to isobutene', cls: 'Elimination',
    reactants: ['CC(C)(C)Br'], products: ['CC(C)=C', 'Br'], coeffs: [1, 1, 1], arrow: 'forward',
    extras: ['O'], above: 'H2O (weak base)', below: 'heat, polar protic solvent', dH: 70, ea: 95,
    explanation: 'Unimolecular elimination shares the slow ionisation step with SN1; a weak base then removes a β-proton from the carbocation to form the alkene. It competes with SN1 and wins at higher temperature (the entropy gain of making more molecules).',
    mechanism: [
      S('Reactants', ['CC(C)(C)Br', 'O'], 0, 'tert-Butyl bromide with water as a weak base and solvent.'),
      S('Carbocation', ['C[C+](C)C', '[Br-]', 'O'], 70, 'Rate-determining ionisation: the C–Br bonding pair leaves with Br⁻, leaving a tertiary carbocation.', 90),
      S('Products', ['CC(C)=C', '[OH3+]', '[Br-]'], 62, 'Water uses a lone pair to remove a proton from a methyl group next to the cation; the C–H bonding pair becomes the π bond of the alkene (isobutene).', 78),
    ],
  },
  {
    id: 'williamson', name: 'Williamson ether synthesis', cls: 'Substitution',
    reactants: ['[Na+].CC[O-]', 'CBr'], products: ['CCOC', '[Na+].[Br-]'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'NaOEt', below: 'ethanol or THF', dH: -90, ea: 80,
    explanation: 'An alkoxide displaces a halide from a methyl or primary alkyl halide by the SN2 mechanism, making an ether. Secondary and tertiary halides give elimination instead, so the more hindered group should come from the alkoxide.',
    mechanism: [
      S('Reactants', ['[Na+].CC[O-]', 'CBr'], 0, 'Sodium ethoxide (nucleophile) and bromomethane (unhindered electrophile).'),
      S('Products', ['CCOC', '[Na+].[Br-]'], -90, 'Backside SN2 attack of the ethoxide oxygen lone pair on the CH3 carbon; the C–Br pair leaves as Br⁻. NaBr precipitates in some solvents, which helps drive the reaction.', 80),
    ],
  },
  {
    id: 'alcohol-hbr', name: 'Alcohol to alkyl bromide with HBr', cls: 'Substitution',
    reactants: ['CC(C)(C)O', 'Br'], products: ['CC(C)(C)Br', 'O'], coeffs: [1, 1, 1, 1], arrow: 'equilibrium',
    above: 'HBr (conc.)', below: '0–25 °C', dH: -10, ea: 85,
    explanation: 'OH is a poor leaving group, so the strong acid first protonates it to make water, a good leaving group. A tertiary alcohol then ionises (SN1) and bromide captures the carbocation. Primary alcohols follow SN2 instead.',
    mechanism: [
      S('Reactants', ['CC(C)(C)O', 'Br'], 0, 'tert-Butanol and hydrogen bromide, a strong acid.'),
      S('Protonated alcohol', ['CC(C)(C)[OH2+]', '[Br-]'], 5, 'A lone pair on the alcohol oxygen takes the proton from HBr; the H–Br bonding pair leaves with bromine. OH₂⁺ is a far better leaving group than OH⁻.', 10),
      S('Carbocation', ['C[C+](C)C', 'O', '[Br-]'], 65, 'Rate-determining step: the C–O bonding pair leaves with the water molecule, giving the tertiary carbocation.', 85),
      S('Products', ['CC(C)(C)Br', 'O'], -10, 'Bromide uses a lone pair to bond to the empty p orbital of the carbocation (fast, barrierless in practice).', 70),
    ],
  },
  {
    id: 'dehydration', name: 'Dehydration of ethanol to ethene', cls: 'Elimination',
    reactants: ['CCO'], products: ['C=C', 'O'], coeffs: [1, 1, 1], arrow: 'equilibrium', extras: ['[H+]'],
    above: 'conc. H2SO4', below: '170 °C', dH: 45, ea: 150,
    explanation: 'Heating an alcohol with a strong acid removes water to give an alkene. The acid turns OH into a good leaving group; for a primary alcohol the loss of water and of a β-proton happen together (E2-like). Below about 140 °C diethyl ether forms instead.',
    mechanism: [
      S('Reactants', ['CCO', '[H+]'], 0, 'Ethanol in hot concentrated sulfuric acid (the proton is shown as H⁺).'),
      S('Protonated alcohol', ['CC[OH2+]'], -5, 'A lone pair on oxygen accepts H⁺: the alcohol becomes an oxonium ion with a good leaving group (water).', 5),
      S('Products', ['C=C', 'O', '[H+]'], 45, 'A base (HSO4⁻ or water, not drawn) removes a β-hydrogen while the C–O bond breaks and the C–H pair forms the C=C bond. H⁺ is regenerated, so the acid is a catalyst. Ethene is a gas and leaves, driving the equilibrium.', 120),
    ],
  },

  // ------------------------------------------------------------------ additions
  {
    id: 'hydration', name: 'Acid-catalysed hydration of propene (Markovnikov)', cls: 'Addition',
    reactants: ['CC=C', 'O'], products: ['CC(C)O'], coeffs: [1, 1, 1], arrow: 'equilibrium', extras: ['[H+]'],
    above: 'H3PO4 (or H2SO4)', below: '300 °C, 70 atm (industrial)', dH: -52, ea: 90,
    explanation: 'Water adds across the double bond. The proton goes to the carbon that already has more hydrogens, giving the more stable secondary carbocation (Markovnikov\'s rule), and water then attacks that cation, so the OH ends up on the more substituted carbon. Propan-2-ol (isopropanol) is made this way industrially.',
    mechanism: [
      S('Reactants', ['CC=C', 'O', '[H+]'], 0, 'Propene, water and an acid catalyst (H⁺).'),
      S('Carbocation', ['C[CH+]C', 'O'], 55, 'The π bond of the alkene acts as a nucleophile: its electron pair takes H⁺ from the acid and bonds to the terminal CH2, leaving the positive charge on the middle (secondary) carbon. Rate-determining.', 70),
      S('Oxonium ion', ['CC(C)[OH2+]'], 20, 'A lone pair on the oxygen of water attacks the carbocation and forms a C–O bond.', 58),
      S('Products', ['CC(C)O', '[H+]'], -52, 'Another water molecule (not drawn) removes a proton from the oxonium ion, giving propan-2-ol and regenerating the acid catalyst.', 30),
    ],
  },
  {
    id: 'br2-addition', name: 'Bromination of an alkene', cls: 'Addition',
    reactants: ['C=C', 'BrBr'], products: ['BrCCBr'], coeffs: [1, 1, 1], arrow: 'forward',
    above: 'Br2', below: 'CH2Cl2, 25 °C', dH: -120, ea: 35,
    explanation: 'Bromine adds across a C=C bond (the test for unsaturation: the orange colour disappears). The alkene polarises Br–Br and forms a cyclic bromonium ion; bromide then opens it from the opposite face, so the addition is anti.',
    mechanism: [
      S('Reactants', ['C=C', 'BrBr'], 0, 'Ethene meets bromine. The electron-rich π bond polarises the Br–Br bond as it approaches.'),
      S('Bromonium ion', ['C1C[Br+]1', '[Br-]'], 25, 'The π electrons attack the nearer Br, pushing the Br–Br bonding pair onto the far Br as Br⁻; a lone pair on the attacked Br bridges both carbons, forming a three-membered bromonium ion.', 35),
      S('Product', ['BrCCBr'], -120, 'Br⁻ attacks one carbon from the back side (anti to the bromonium bridge); the C–Br⁺ bond breaks, opening the ring to give 1,2-dibromoethane.', 30),
    ],
  },
  {
    id: 'hbr-addition', name: 'Markovnikov addition of HBr to propene', cls: 'Addition',
    reactants: ['CC=C', 'Br'], products: ['CC(C)Br'], coeffs: [1, 1, 1], arrow: 'forward',
    above: 'HBr', below: 'no peroxides, 0 °C', dH: -75, ea: 70,
    explanation: 'The proton adds to the carbon with more hydrogens, so the bromine ends up on the more substituted carbon (Markovnikov): the intermediate is the more stable secondary carbocation. With peroxides the mechanism becomes a radical chain and the addition is anti-Markovnikov.',
    mechanism: [
      S('Reactants', ['CC=C', 'Br'], 0, 'Propene and hydrogen bromide, a strong acid.'),
      S('Carbocation', ['C[CH+]C', '[Br-]'], 55, 'The π electrons of the alkene attack the H of H–Br; the H–Br pair leaves as Br⁻. H goes to the terminal carbon, giving the secondary carbocation. Rate-determining.', 70),
      S('Product', ['CC(C)Br'], -75, 'Br⁻ uses a lone pair to bond to the cationic carbon: 2-bromopropane.', 60),
    ],
  },
  {
    id: 'hydrogenation', name: 'Catalytic hydrogenation of ethene', cls: 'Addition',
    reactants: ['C=C', '[H][H]'], products: ['CC'], coeffs: [1, 1, 1], arrow: 'forward',
    above: 'Pd/C (or Pt, Ni)', below: 'H2, 1–5 atm, 25 °C', dH: -137, ea: 180,
    explanation: 'H2 and the alkene both adsorb on the metal surface; the H–H bond is split into surface hydrogens that are added in turn to the same face of the double bond (syn addition, Horiuti–Polanyi mechanism). Without the catalyst the barrier is far too high. The reaction is strongly exothermic.',
  },
  {
    id: 'diels-alder', name: 'Diels–Alder: butadiene + ethene', cls: 'Pericyclic',
    reactants: ['C=CC=C', 'C=C'], products: ['C1=CCCCC1'], coeffs: [1, 1, 1], arrow: 'forward',
    above: '', below: 'heat (about 200 °C, pressure)', dH: -170, ea: 115,
    explanation: 'A [4+2] cycloaddition: a conjugated diene (4 π electrons) and a dienophile (2 π electrons) form a six-membered ring in one concerted step, making two new σ bonds from two π bonds. It is thermally allowed (suprafacial, 6 electrons) and stereospecific. Electron-poor dienophiles and electron-rich dienes react much faster.',
    mechanism: [
      S('Reactants', ['C=CC=C', 'C=C'], 0, 'Butadiene in its reactive s-cis conformation and ethene (the dienophile).'),
      S('Product', ['C1=CCCCC1'], -170, 'One concerted, cyclic movement of six electrons: the dienophile π bond and the two diene π bonds shift together, forming two new C–C σ bonds at the ends and a new C=C π bond between the diene\'s middle carbons. No intermediate.', 115),
    ],
  },
  {
    id: 'diels-alder-cp', name: 'Diels–Alder: cyclopentadiene + maleic anhydride', cls: 'Pericyclic',
    reactants: ['C1=CC=CC1', 'O=C1C=CC(=O)O1'], products: ['O=C1OC(=O)C2C1C1C=CC2C1'], coeffs: [1, 1, 1], arrow: 'forward',
    above: '', below: 'ethyl acetate / hexane, 25 °C', dH: -150, ea: 55,
    explanation: 'A textbook Diels–Alder at room temperature: cyclopentadiene is locked in the reactive s-cis shape and maleic anhydride is an electron-poor dienophile. The endo adduct is formed fastest (secondary orbital overlap), even though the exo adduct is slightly more stable.',
    mechanism: [
      S('Reactants', ['C1=CC=CC1', 'O=C1C=CC(=O)O1'], 0, 'Cyclopentadiene (diene) and maleic anhydride (dienophile with two electron-withdrawing carbonyls).'),
      S('Endo adduct', ['O=C1OC(=O)C2C1C1C=CC2C1'], -150, 'The diene approaches the dienophile face to face with the anhydride carbonyls tucked under the diene (endo). Both new C–C σ bonds form at the same time; the cyclopentadiene CH2 becomes the one-carbon bridge of a norbornene.', 55),
    ],
  },
  {
    id: 'epoxide-opening', name: 'Ring opening of ethylene oxide with water', cls: 'Addition',
    reactants: ['C1CO1', 'O'], products: ['OCCO'], coeffs: [1, 1, 1], arrow: 'forward', extras: ['[H+]'],
    above: 'H2SO4 (cat.)', below: '60 °C', dH: -100, ea: 80,
    explanation: 'The strained three-membered ring of an epoxide is opened by nucleophiles. Under acid catalysis the ring oxygen is protonated and water attacks; this is how ethylene glycol (antifreeze) is made. The ring strain (about 115 kJ/mol) gives the large exothermicity.',
    mechanism: [
      S('Reactants', ['C1CO1', 'O', '[H+]'], 0, 'Ethylene oxide, water and an acid catalyst.'),
      S('Protonated epoxide', ['C1C[OH+]1', 'O'], 0, 'A lone pair on the epoxide oxygen takes H⁺, making a much better electrophile.', 8),
      S('Oxonium ion', ['OCC[OH2+]'], -60, 'A lone pair on water attacks a ring carbon from the back side; the C–O bond of the ring breaks and the strain is released.', 40),
      S('Products', ['OCCO', '[H+]'], -100, 'Loss of a proton gives ethylene glycol and regenerates the catalyst.', -50),
    ],
  },

  // ------------------------------------------------------------------ carbonyl chemistry
  {
    id: 'aldol', name: 'Aldol addition of ethanal', cls: 'Carbonyl chemistry',
    reactants: ['CC=O'], products: ['CC(O)CC=O'], coeffs: [2, 1], arrow: 'equilibrium', extras: ['[OH-]'],
    above: 'NaOH (cat.)', below: 'water, 5–10 °C', dH: -30, ea: 45,
    explanation: 'Two aldehydes combine into a β-hydroxy aldehyde (an "aldol"). A base removes an α-hydrogen to make a nucleophilic enolate, which adds to the carbonyl carbon of a second molecule. Heating dehydrates the aldol to an α,β-unsaturated aldehyde (aldol condensation).',
    mechanism: [
      S('Reactants', ['CC=O', 'CC=O', '[OH-]'], 0, 'Two ethanal molecules and hydroxide. The α-hydrogens (next to C=O) are weakly acidic (pKa about 17).'),
      S('Enolate', ['C=C[O-]', 'O', 'CC=O'], 20, 'Hydroxide uses a lone pair to remove an α-hydrogen; the C–H bonding pair becomes a C=C π bond and the C=O π pair moves onto oxygen, giving the resonance-stabilised enolate.', 35),
      S('Alkoxide', ['CC([O-])CC=O', 'O'], 5, 'The enolate carbon (nucleophile) attacks the carbonyl carbon of the second ethanal; its C=O π pair moves onto oxygen as an alkoxide. A new C–C bond forms.', 45),
      S('Products', ['CC(O)CC=O', '[OH-]'], -10, 'The alkoxide takes a proton from water, giving 3-hydroxybutanal and regenerating hydroxide.', 10),
    ],
  },
  {
    id: 'aldol-condensation', name: 'Aldol condensation of ethanal', cls: 'Carbonyl chemistry',
    reactants: ['CC=O'], products: ['CC=CC=O', 'O'], coeffs: [2, 1, 1], arrow: 'forward',
    above: 'NaOH', below: 'heat', dH: -20, ea: 70,
    explanation: 'On heating, the aldol loses water (E1cB: deprotonation at the α-carbon, then loss of hydroxide) to give a conjugated α,β-unsaturated aldehyde, here crotonaldehyde. The extended conjugation makes the dehydration favourable.',
  },
  {
    id: 'claisen', name: 'Claisen condensation of ethyl acetate', cls: 'Carbonyl chemistry',
    reactants: ['CCOC(C)=O'], products: ['CCOC(=O)CC(C)=O', 'CCO'], coeffs: [2, 1, 1], arrow: 'equilibrium', extras: ['CC[O-]'],
    above: 'NaOEt (1 equiv.)', below: 'ethanol, then H3O+ work-up', dH: 30, ea: 60,
    explanation: 'Two esters condense to a β-keto ester. An alkoxide forms an ester enolate, which attacks a second ester; the tetrahedral intermediate expels ethoxide. The reaction as a whole is uphill, but the β-keto ester is acidic and is deprotonated by ethoxide, which pulls the equilibrium over. A full equivalent of base is needed.',
    mechanism: [
      S('Reactants', ['CCOC(C)=O', 'CCOC(C)=O', 'CC[O-]'], 0, 'Two ethyl acetate molecules and sodium ethoxide (the same alkoxide as the ester, to avoid transesterification).'),
      S('Ester enolate', ['C=C([O-])OCC', 'CCO', 'CCOC(C)=O'], 25, 'Ethoxide removes an α-hydrogen; the C–H pair forms C=C and the C=O π pair moves to oxygen: an ester enolate and ethanol.', 40),
      S('Tetrahedral intermediate', ['CCOC(=O)CC(C)([O-])OCC', 'CCO'], 15, 'The enolate carbon attacks the carbonyl carbon of a second ester; the C=O π pair moves onto oxygen, forming a C–C bond and a tetrahedral alkoxide.', 50),
      S('β-Keto ester', ['CCOC(=O)CC(C)=O', 'CC[O-]', 'CCO'], 20, 'The alkoxide lone pair re-forms C=O and pushes out ethoxide as the leaving group: ethyl acetoacetate.', 35),
      S('Stabilised enolate', ['CCOC(=O)C=C(C)[O-]', 'CCO', 'CCO'], -30, 'Ethoxide removes the very acidic hydrogen between the two carbonyls (pKa about 11), giving a delocalised enolate. This irreversible step drives the whole sequence; acid work-up then gives the β-keto ester.', 25),
    ],
  },
  {
    id: 'grignard', name: 'Grignard addition to acetone', cls: 'Carbonyl chemistry',
    reactants: ['CC(C)=O', 'C[Mg]Br', 'O'], products: ['CC(C)(C)O', 'O[Mg]Br'], coeffs: [1, 1, 1, 1, 1], arrow: 'forward',
    above: 'CH3MgBr, then H3O+', below: 'dry diethyl ether, 0 °C', dH: -200, ea: 40,
    explanation: 'An organomagnesium halide is a carbon nucleophile (a "carbanion" bound to Mg). It adds to the carbonyl carbon of a ketone or aldehyde to make a new C–C bond and, after water work-up, a tertiary (ketone) or secondary (aldehyde) alcohol. It must be done in dry ether: water destroys the reagent.',
    mechanism: [
      S('Reactants', ['CC(C)=O', 'C[Mg]Br', 'O'], 0, 'Acetone and methylmagnesium bromide (water is added only at the work-up). The C–Mg bond is polarised towards carbon: C is δ−.'),
      S('Magnesium alkoxide', ['CC(C)(C)O[Mg]Br', 'O'], -120, 'The C–Mg bonding pair attacks the carbonyl carbon (forming the new C–C bond); the C=O π pair moves onto oxygen, which binds to Mg⁺ (Mg also coordinates the carbonyl oxygen first).', 40),
      S('Alcohol', ['CC(C)(C)O', 'O[Mg]Br'], -135, 'Work-up with water: the alkoxide oxygen takes a proton from H2O and Mg(OH)Br is released: 2-methylpropan-2-ol.', -100),
    ],
  },
  {
    id: 'fischer', name: 'Fischer esterification', cls: 'Carbonyl chemistry',
    reactants: ['CC(=O)O', 'CCO'], products: ['CC(=O)OCC', 'O'], coeffs: [1, 1, 1, 1], arrow: 'equilibrium', extras: ['[H+]'],
    above: 'H2SO4 (cat.)', below: 'reflux', dH: -3, ea: 65,
    explanation: 'An acid and an alcohol give an ester and water, catalysed by a strong acid, in an equilibrium (K about 4 for acetic acid + ethanol). Use an excess of the alcohol or remove the water (Dean–Stark) to push it forward. The mechanism is often remembered as PADPED: Protonate, Add, Deprotonate, Protonate, Eliminate, Deprotonate.',
    mechanism: [
      S('Reactants', ['CC(=O)O', 'CCO', '[H+]'], 0, 'Ethanoic acid, ethanol and an acid catalyst.'),
      S('Protonated acid', ['CC(=[OH+])O', 'CCO'], -10, 'A lone pair on the carbonyl oxygen takes H⁺. The positive charge delocalises onto carbon, making the carbonyl carbon far more electrophilic.', 5),
      S('Addition', ['CC(O)(O)[OH+]CC'], 15, 'A lone pair on the oxygen of ethanol attacks the carbonyl carbon; the C=O π pair moves onto oxygen (which loses its positive charge): a tetrahedral intermediate.', 40),
      S('Proton transfer', ['CC(O)([OH2+])OCC'], 10, 'A proton moves from the oxonium oxygen to one of the OH groups (through the solvent), turning an OH into OH₂⁺, a good leaving group.', 20),
      S('Loss of water', ['CC(=[OH+])OCC', 'O'], 18, 'A lone pair on the other oxygen pushes down to re-form C=O and expels water: a protonated ester.', 38),
      S('Products', ['CC(=O)OCC', 'O', '[H+]'], -3, 'Loss of the proton from the carbonyl oxygen gives ethyl ethanoate (ethyl acetate) and regenerates the acid catalyst.', 20),
    ],
  },
  {
    id: 'saponification', name: 'Ester hydrolysis in base (saponification)', cls: 'Carbonyl chemistry',
    reactants: ['CCOC(C)=O', '[OH-]'], products: ['CC(=O)[O-]', 'CCO'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'NaOH', below: 'water / ethanol, reflux', dH: -60, ea: 55,
    explanation: 'Hydroxide cleaves an ester into a carboxylate and an alcohol. It is irreversible because the carboxylic acid formed is immediately deprotonated by the base. This is how soap is made from fats (triglycerides). The mechanism is nucleophilic acyl substitution through a tetrahedral intermediate.',
    mechanism: [
      S('Reactants', ['CCOC(C)=O', '[OH-]'], 0, 'Ethyl ethanoate and hydroxide. The carbonyl carbon is electrophilic.'),
      S('Tetrahedral intermediate', ['CC([O-])(O)OCC'], 30, 'A lone pair on HO⁻ attacks the carbonyl carbon; the C=O π pair moves onto oxygen as an alkoxide.', 55),
      S('Acid and alkoxide', ['CC(=O)O', 'CC[O-]'], 25, 'The alkoxide lone pair re-forms C=O and expels ethoxide, the leaving group.', 40),
      S('Products', ['CC(=O)[O-]', 'CCO'], -60, 'Ethoxide is a strong base and removes the acidic proton from ethanoic acid. This irreversible acid–base step gives acetate and ethanol and pulls the reaction to completion.', 25),
    ],
  },
  {
    id: 'amide-acyl-chloride', name: 'Amide from an acyl chloride and an amine', cls: 'Carbonyl chemistry',
    reactants: ['CC(=O)Cl', 'CN'], products: ['CC(=O)NC', 'C[NH3+]', '[Cl-]'], coeffs: [1, 2, 1, 1, 1], arrow: 'forward',
    above: '2 equiv. amine (or amine + Et3N)', below: 'CH2Cl2, 0 °C', dH: -120, ea: 30,
    explanation: 'Acyl chlorides are the most reactive carboxylic acid derivatives. An amine adds to the carbonyl carbon and chloride leaves; a second equivalent of amine (or a tertiary amine) takes up the HCl formed, so two moles of amine are needed.',
    mechanism: [
      S('Reactants', ['CC(=O)Cl', 'CN', 'CN'], 0, 'Ethanoyl chloride and two molecules of methylamine (one nucleophile, one base).'),
      S('Tetrahedral intermediate', ['CC([O-])(Cl)[NH2+]C', 'CN'], 40, 'The nitrogen lone pair of methylamine attacks the very electrophilic carbonyl carbon; the C=O π pair moves onto oxygen.', 55),
      S('Protonated amide', ['CC(=O)[NH2+]C', '[Cl-]', 'CN'], 10, 'The oxygen lone pair re-forms C=O and chloride, an excellent leaving group, departs.', 45),
      S('Products', ['CC(=O)NC', 'C[NH3+]', '[Cl-]'], -90, 'A second methylamine removes the N–H proton, giving N-methylethanamide and methylammonium chloride.', 20),
    ],
  },
  {
    id: 'amide-direct', name: 'Amide from a carboxylic acid and an amine', cls: 'Carbonyl chemistry',
    reactants: ['CC(=O)O', 'CN'], products: ['CC(=O)NC', 'O'], coeffs: [1, 1, 1, 1], arrow: 'equilibrium',
    above: 'heat (or a coupling agent such as DCC)', below: '160–200 °C, water removed', dH: -5, ea: 120,
    explanation: 'Acid and amine first make an ammonium carboxylate salt, which only loses water on strong heating. In the laboratory, coupling reagents (DCC, EDC) or conversion to an acyl chloride are used instead; this is also how peptide bonds are made.',
  },
  {
    id: 'nabh4', name: 'Reduction of a ketone with NaBH4', cls: 'Oxidation / reduction',
    reactants: ['CC(C)=O', '[H-]', 'O'], products: ['CC(C)O', '[OH-]'], coeffs: [1, 1, 1, 1, 1], arrow: 'forward',
    above: 'NaBH4', below: 'methanol or ethanol, 0–25 °C', dH: -75, ea: 40,
    explanation: 'Sodium borohydride delivers a hydride ion (H⁻) to the carbonyl carbon, turning ketones into secondary alcohols and aldehydes into primary alcohols. It is mild: it leaves esters and amides alone (LiAlH4 reduces those). The equation shows the hydride transferred and the proton from the solvent.',
    mechanism: [
      S('Reactants', ['CC(C)=O', '[H-]', 'O'], 0, 'Propanone, hydride from BH4⁻ (drawn as H⁻) and a protic solvent (water/alcohol).'),
      S('Alkoxide', ['CC(C)[O-]', 'O'], -60, 'The B–H bonding pair attacks the carbonyl carbon as a hydride; the C=O π pair moves onto oxygen, giving an alkoxide.', 30),
      S('Alcohol', ['CC(C)O', '[OH-]'], -75, 'The alkoxide takes a proton from the solvent (work-up), giving propan-2-ol.', -40),
    ],
  },
  {
    id: 'wittig', name: 'Wittig reaction: benzaldehyde to styrene', cls: 'Carbonyl chemistry',
    reactants: ['O=Cc1ccccc1', 'C=P(c1ccccc1)(c1ccccc1)c1ccccc1'], products: ['C=Cc1ccccc1', 'O=P(c1ccccc1)(c1ccccc1)c1ccccc1'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'Ph3P=CH2 (ylide)', below: 'THF, 25 °C', dH: -250, ea: 40,
    explanation: 'A phosphorus ylide turns a C=O into a C=C: the carbonyl oxygen ends up on phosphorus as triphenylphosphine oxide, whose very strong P=O bond (about 540 kJ/mol) provides the driving force. The ylide carbon is nucleophilic; the sequence goes through a four-membered oxaphosphetane.',
    mechanism: [
      S('Reactants', ['O=Cc1ccccc1', 'C=P(c1ccccc1)(c1ccccc1)c1ccccc1'], 0, 'Benzaldehyde and methylenetriphenylphosphorane (an ylide: carbanion next to a phosphonium).'),
      S('Oxaphosphetane', ['C1(c2ccccc2)OP(c2ccccc2)(c2ccccc2)(c2ccccc2)C1'], -40, '[2+2] cycloaddition: the nucleophilic ylide carbon attacks the carbonyl carbon while the oxygen bonds to phosphorus, closing a four-membered P–C–C–O ring.', 30),
      S('Products', ['C=Cc1ccccc1', 'O=P(c1ccccc1)(c1ccccc1)c1ccccc1'], -250, 'The ring fragments: the two new double bonds form (C=C and P=O) as the ring bonds break. The formation of the strong P=O bond makes this step highly exothermic.', -20),
    ],
  },
  {
    id: 'imine', name: 'Imine formation: benzaldehyde + methylamine', cls: 'Carbonyl chemistry',
    reactants: ['O=Cc1ccccc1', 'CN'], products: ['CN=Cc1ccccc1', 'O'], coeffs: [1, 1, 1, 1], arrow: 'equilibrium', extras: ['[H+]'],
    above: 'trace acid (pH 4–5)', below: 'remove water (molecular sieves)', dH: -10, ea: 55,
    explanation: 'A primary amine and an aldehyde or ketone condense to an imine (Schiff base) with loss of water. The rate peaks at mildly acidic pH: acid activates the carbonyl and the leaving OH, but too much acid protonates the amine nucleophile.',
    mechanism: [
      S('Reactants', ['O=Cc1ccccc1', 'CN', '[H+]'], 0, 'Benzaldehyde, methylamine and a trace of acid.'),
      S('Carbinolamine', ['OC(c1ccccc1)NC', '[H+]'], -10, 'The nitrogen lone pair attacks the carbonyl carbon, the C=O π pair moves to oxygen, and a proton shift gives the neutral hemiaminal (carbinolamine).', 30),
      S('Protonated carbinolamine', ['[OH2+]C(c1ccccc1)NC'], 15, 'The OH oxygen takes H⁺, converting it into the good leaving group water.', 25),
      S('Iminium ion', ['C[NH+]=Cc1ccccc1', 'O'], 20, 'The nitrogen lone pair pushes down to form C=N⁺ and water leaves.', 45),
      S('Products', ['CN=Cc1ccccc1', 'O', '[H+]'], 8, 'Loss of the N–H proton gives the neutral imine and regenerates the acid catalyst.', 25),
    ],
  },

  // ------------------------------------------------------------------ aromatic chemistry
  {
    id: 'fc-alkylation', name: 'Friedel–Crafts alkylation: cumene from benzene', cls: 'Aromatic substitution',
    reactants: ['CC(C)Cl', PH], products: ['CC(C)c1ccccc1', 'Cl'], coeffs: [1, 1, 1, 1], arrow: 'forward', extras: [ALCL3],
    above: 'AlCl3', below: '0–25 °C, excess benzene', dH: -80, ea: 80,
    explanation: 'A Lewis acid generates a carbocation from an alkyl halide, which substitutes a hydrogen of the aromatic ring (electrophilic aromatic substitution). Limits: the product is more reactive than benzene (polyalkylation) and primary cations rearrange to more stable ones.',
    mechanism: [
      S('Reactants', ['CC(C)Cl', PH, ALCL3], 0, '2-Chloropropane, benzene and aluminium chloride (a Lewis acid with an empty orbital on Al).'),
      S('Carbocation', ['C[CH+]C', ACYL, PH], 60, 'A chlorine lone pair donates into the empty orbital of AlCl3; the C–Cl bonding pair leaves with Cl, giving the isopropyl cation and AlCl4⁻.', 70),
      S('Arenium ion', ['CC(C)C1C=CC=C[CH+]1', ACYL], 45, 'The π electrons of benzene attack the carbocation, forming a C–C bond. The ring loses aromaticity: the positive charge is delocalised over three carbons (the arenium ion, or σ complex). Rate-determining.', 80),
      S('Products', ['CC(C)c1ccccc1', 'Cl', ALCL3], -20, 'AlCl4⁻ removes the proton from the sp³ carbon; the C–H pair restores the aromatic ring. HCl is released and AlCl3 regenerated.', 50),
    ],
  },
  {
    id: 'fc-acylation', name: 'Friedel–Crafts acylation: acetophenone', cls: 'Aromatic substitution',
    reactants: ['CC(=O)Cl', PH], products: ['CC(=O)c1ccccc1', 'Cl'], coeffs: [1, 1, 1, 1], arrow: 'forward', extras: [ALCL3],
    above: 'AlCl3 (> 1 equiv.)', below: '0–60 °C', dH: -60, ea: 70,
    explanation: 'The acylium ion formed from an acyl chloride and AlCl3 substitutes a ring hydrogen. Unlike alkylation, the acylium does not rearrange and the ketone product is deactivated, so it stops after one substitution. The product binds AlCl3, so slightly more than one equivalent of catalyst is used.',
    mechanism: [
      S('Reactants', ['CC(=O)Cl', PH, ALCL3], 0, 'Ethanoyl chloride, benzene and AlCl3.'),
      S('Acylium ion', ['CC#[O+]', ACYL, PH], 30, 'AlCl3 pulls chloride off the acyl chloride (the C–Cl pair leaves). The acylium ion CH3–C≡O⁺ is stabilised by the oxygen lone pair.', 45),
      S('Arenium ion', ['CC(=O)C1C=CC=C[CH+]1', ACYL], 50, 'The π electrons of benzene attack the acylium carbon; the ring loses aromaticity (σ complex). Rate-determining.', 70),
      S('Products', ['CC(=O)c1ccccc1', 'Cl', ALCL3], -30, 'AlCl4⁻ removes the ring proton and the aromatic ring re-forms; HCl and AlCl3 are released (the ketone then complexes AlCl3 until work-up).', 60),
    ],
  },
  {
    id: 'nitration', name: 'Nitration of benzene', cls: 'Aromatic substitution',
    reactants: [PH, 'O[N+](=O)[O-]'], products: ['[O-][N+](=O)c1ccccc1', 'O'], coeffs: [1, 1, 1, 1], arrow: 'forward', extras: ['OS(=O)(=O)O'],
    above: 'conc. HNO3 / conc. H2SO4', below: '50 °C', dH: -117, ea: 85,
    explanation: 'The "mixed acid" makes the nitronium ion NO2⁺, a strong electrophile that attacks benzene. Keeping the temperature near 50 °C avoids dinitration. The nitro group deactivates the ring and directs further substitution to the meta positions.',
    mechanism: [
      S('Reactants', [PH, 'O[N+](=O)[O-]', 'OS(=O)(=O)O'], 0, 'Benzene, nitric acid and the stronger acid sulfuric acid.'),
      S('Nitronium ion', ['O=[N+]=O', 'OS(=O)(=O)[O-]', 'O', PH], 35, 'Sulfuric acid protonates HNO3 on an OH oxygen; water then leaves, giving the linear nitronium ion O=N⁺=O (and HSO4⁻).', 50),
      S('Arenium ion', ['[O-][N+](=O)C1C=CC=C[CH+]1', 'OS(=O)(=O)[O-]', 'O'], 55, 'The π electrons of benzene attack the nitrogen of NO2⁺; aromaticity is lost and the positive charge is delocalised (σ complex). Rate-determining.', 85),
      S('Products', ['[O-][N+](=O)c1ccccc1', 'OS(=O)(=O)O', 'O'], -100, 'HSO4⁻ removes the proton on the sp³ carbon and the C–H pair restores the aromatic ring: nitrobenzene. H2SO4 is regenerated, so it is a catalyst.', 60),
    ],
  },
  {
    id: 'sulfonation', name: 'Sulfonation of benzene', cls: 'Aromatic substitution',
    reactants: [PH, 'O=S(=O)=O'], products: ['OS(=O)(=O)c1ccccc1'], coeffs: [1, 1, 1], arrow: 'equilibrium',
    above: 'fuming H2SO4 (SO3)', below: 'heat', dH: -40, ea: 85,
    explanation: 'Sulfur trioxide is the electrophile. Unlike most electrophilic aromatic substitutions, sulfonation is reversible: adding hot dilute acid removes the SO3H group again, which makes it useful as a temporary blocking group.',
  },
  {
    id: 'bromination-benzene', name: 'Bromination of benzene', cls: 'Aromatic substitution',
    reactants: [PH, 'BrBr'], products: ['Brc1ccccc1', 'Br'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'Br2, FeBr3', below: '25 °C, dark', dH: -45, ea: 75,
    explanation: 'Benzene does not add bromine (it would lose aromaticity); with a Lewis acid catalyst, Br2 is polarised to a strong electrophile Br⁺···FeBr4⁻ and a hydrogen is substituted. Same arenium-ion mechanism as nitration.',
  },

  // ------------------------------------------------------------------ oxidation and reduction, coupling
  {
    id: 'ethanol-ethanal', name: 'Catalytic oxidation of ethanol to ethanal', cls: 'Oxidation / reduction',
    reactants: ['CCO', 'O=O'], products: ['CC=O', 'O'], coeffs: [2, 1, 2, 2], arrow: 'forward',
    above: 'Cu catalyst', below: '300 °C, air', dH: -240, ea: 90,
    explanation: 'Passing alcohol vapour and air over hot copper removes two hydrogens from a primary alcohol to give an aldehyde (dehydrogenation and oxidation). In the lab, PCC or a Swern oxidation stops at the aldehyde too, whereas acidified dichromate carries on to the acid.',
  },
  {
    id: 'ethanol-ethanoic', name: 'Oxidation of ethanol to ethanoic acid', cls: 'Oxidation / reduction',
    reactants: ['CCO', 'O=O'], products: ['CC(=O)O', 'O'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'K2Cr2O7 / H2SO4 (or acetic acid bacteria)', below: 'reflux', dH: -490, ea: 80,
    explanation: 'A strong oxidant (acidified dichromate, orange to green; or air with Acetobacter in vinegar-making) takes a primary alcohol through the aldehyde to the carboxylic acid. The equation uses O2 as the net oxidant; with dichromate the electrons are transferred to Cr(VI).',
  },
  {
    id: 'suzuki', name: 'Suzuki–Miyaura coupling', cls: 'Coupling',
    reactants: ['Brc1ccccc1', 'OB(O)c1ccccc1', '[Na+].[OH-]'], products: ['c1ccc(cc1)-c1ccccc1', '[Na+].[Br-]', 'OB(O)O'], coeffs: [1, 1, 1, 1, 1, 1], arrow: 'forward', extras: ['[Pd]'],
    above: 'Pd(PPh3)4 (cat.), base', below: 'toluene / water, 80 °C', dH: -150, ea: 70,
    explanation: 'A palladium-catalysed cross-coupling of an organohalide with an organoboron compound makes a new C–C bond (Nobel Prize 2010). The catalytic cycle: oxidative addition, transmetalation (activated by base) and reductive elimination. Here the Pd ligands are left out for clarity.',
    mechanism: [
      S('Reactants', ['Brc1ccccc1', 'OB(O)c1ccccc1', '[Na+].[OH-]', '[Pd]'], 0, 'Bromobenzene, phenylboronic acid, base and a Pd(0) catalyst.'),
      S('Oxidative addition', ['Br[Pd]c1ccccc1', 'OB(O)c1ccccc1', '[Na+].[OH-]'], -40, 'Pd(0) inserts into the C–Br bond: its electrons form the C–Pd and Pd–Br bonds, so Pd goes from oxidation state 0 to +2.', 30),
      S('Transmetalation', ['c1ccccc1[Pd]c1ccccc1', '[Na+].[Br-]', 'OB(O)O'], -60, 'Hydroxide adds to boron making a nucleophilic boronate; the phenyl group moves from B to Pd while bromide leaves Pd as NaBr, giving a diaryl-palladium(II) complex and boric acid.', 20),
      S('Reductive elimination', ['c1ccc(cc1)-c1ccccc1', '[Pd]', '[Na+].[Br-]', 'OB(O)O'], -250, 'The two aryl groups couple: the two Pd–C bonding pairs become the new C–C bond and Pd returns to oxidation state 0, ready for the next cycle.', -35),
    ],
  },

  // ------------------------------------------------------------------ acid–base, precipitation, displacement
  {
    id: 'neutralisation', name: 'Neutralisation: HCl + NaOH', cls: 'Acid–base',
    reactants: ['Cl', '[Na+].[OH-]'], products: ['[Na+].[Cl-]', 'O'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: '', below: 'water, 25 °C', dH: -57, ea: 5,
    explanation: 'A strong acid and a strong base react completely to a salt and water; in ionic form it is just H⁺ + OH⁻ → H2O, with ΔH ≈ −57 kJ/mol for any strong acid and strong base. The proton transfer has almost no barrier.',
    mechanism: [
      S('Reactants', ['Cl', '[Na+].[OH-]'], 0, 'Hydrochloric acid (fully dissociated) and sodium hydroxide.'),
      S('Products', ['[Na+].[Cl-]', 'O'], -57, 'A lone pair on HO⁻ takes the proton from H–Cl; the H–Cl bonding pair leaves with chlorine. Na⁺ and Cl⁻ are spectators.', 5),
    ],
  },
  {
    id: 'baking-soda', name: 'Baking soda + vinegar', cls: 'Acid–base',
    reactants: ['[Na+].OC([O-])=O', 'CC(=O)O'], products: ['[Na+].CC(=O)[O-]', 'O', 'O=C=O'], coeffs: [1, 1, 1, 1, 1], arrow: 'forward',
    above: '', below: 'water, 25 °C', ea: 30,
    explanation: 'A weak acid (ethanoic acid) protonates hydrogencarbonate to carbonic acid, which falls apart into water and carbon dioxide gas (the fizz). The reaction is endothermic but driven by the entropy of the gas released.',
  },
  {
    id: 'agcl', name: 'Precipitation of silver chloride', cls: 'Precipitation / displacement',
    reactants: ['[Ag+].[O-][N+](=O)[O-]', '[Na+].[Cl-]'], products: ['[Ag+].[Cl-]', '[Na+].[O-][N+](=O)[O-]'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: '', below: 'aqueous solution', dH: -65, ea: 10,
    explanation: 'Mixing solutions of silver nitrate and sodium chloride gives a white precipitate of silver chloride (the chloride test). Ag⁺(aq) + Cl⁻(aq) → AgCl(s) is the net ionic equation; Na⁺ and NO3⁻ are spectator ions.',
  },
  {
    id: 'mg-hcl', name: 'Magnesium + hydrochloric acid', cls: 'Precipitation / displacement',
    reactants: ['[Mg]', 'Cl'], products: ['[Mg+2].[Cl-].[Cl-]', '[H][H]'], coeffs: [1, 2, 1, 1], arrow: 'forward',
    above: '', below: 'aqueous HCl, 25 °C', dH: -467, ea: 40,
    explanation: 'A metal above hydrogen in the reactivity series displaces hydrogen from an acid: Mg is oxidised to Mg²⁺ (loses two electrons) and H⁺ is reduced to H2. Bubbles of hydrogen and a warm test tube are the signs.',
  },
  {
    id: 'rusting', name: 'Rusting of iron', cls: 'Oxidation / reduction',
    reactants: ['[Fe]', 'O=O'], products: ['[Fe+3].[Fe+3].[O-2].[O-2].[O-2]'], coeffs: [4, 3, 2], arrow: 'forward',
    above: '', below: 'moist air', dH: -1648, ea: 50,
    explanation: 'Iron is oxidised by oxygen in the presence of water to iron(III) oxide (hydrated: rust). The overall equation hides the electrochemistry: Fe is oxidised at anodic areas, O2 + 2 H2O is reduced at cathodic areas, and the two are linked through the water layer.',
  },
  {
    id: 'permanganate-hcl', name: 'Permanganate + hydrochloric acid', cls: 'Oxidation / reduction',
    reactants: ['[K+].[O-][Mn](=O)(=O)=O', 'Cl'], products: ['[K+].[Cl-]', '[Mn+2].[Cl-].[Cl-]', 'ClCl', 'O'], coeffs: [2, 16, 2, 2, 5, 8], arrow: 'forward',
    above: '', below: 'conc. HCl, 25 °C', ea: 60,
    explanation: 'A classic redox equation to balance by the half-reaction method: MnO4⁻ (Mn +7) is reduced to Mn²⁺ and Cl⁻ is oxidised to Cl2 (5 e⁻ per Mn, 2 e⁻ per Cl2, so 2 Mn : 5 Cl2). Chlorine is released, which is why it is the old laboratory preparation of Cl2.',
  },
  {
    id: 'aspirin', name: 'Synthesis of aspirin', cls: 'Carbonyl chemistry',
    reactants: ['OC(=O)c1ccccc1O', 'CC(=O)OC(C)=O'], products: ['CC(=O)Oc1ccccc1C(=O)O', 'CC(=O)O'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'H3PO4 (cat.)', below: '70–80 °C, 15 min', ea: 70,
    explanation: 'The phenolic OH of salicylic acid is acetylated by ethanoic anhydride (nucleophilic acyl substitution; ethanoic acid is the leaving group). Water precipitates the crude aspirin, which is recrystallised from ethanol/water; a violet iron(III) chloride test shows leftover salicylic acid.',
  },
  {
    id: 'sucrose-hydrolysis', name: 'Hydrolysis of sucrose', cls: 'Biochemical',
    reactants: ['OCC1OC(CO)(OC2OC(CO)C(O)C(O)C2O)C(O)C1O', 'O'], products: ['OCC1OC(O)C(O)C(O)C1O', 'OCC1(O)OCC(O)C(O)C1O'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'H+ or invertase', below: 'water, 25–60 °C', dH: -5, ea: 107,
    explanation: 'Sucrose splits into glucose and fructose. The mixture ("invert sugar") rotates plane-polarised light the opposite way to sucrose, hence the name. The enzyme invertase lowers the activation energy from about 107 to about 40 kJ/mol.',
  },

  // ------------------------------------------------------------------ radical
  {
    id: 'radical-chlorination', name: 'Radical chlorination of methane', cls: 'Radical',
    reactants: ['C', 'ClCl'], products: ['CCl', 'Cl'], coeffs: [1, 1, 1, 1], arrow: 'forward',
    above: 'Cl2', below: 'UV light (hν) or 300 °C', dH: -100, ea: 4,
    explanation: 'A radical chain reaction in three stages: initiation (light splits Cl2 into two chlorine atoms), propagation (Cl• abstracts H from CH4, then CH3• abstracts Cl from Cl2, regenerating Cl•: a chain), and termination (two radicals combine). The chain is shown here in its shortest form; real reactions give a mixture of CH3Cl, CH2Cl2, CHCl3 and CCl4.',
    mechanism: [
      S('Reactants', ['C', 'ClCl'], 0, 'Methane and chlorine in the dark do not react.'),
      S('Initiation', ['C', '[Cl]', '[Cl]'], 243, 'A photon (hν) breaks the Cl–Cl bond homolytically (bond energy 243 kJ/mol): each Cl keeps one electron (single-headed fishhook arrows).', 243),
      S('Propagation', ['[CH3]', 'Cl', '[Cl]'], 251, 'A chlorine atom abstracts a hydrogen from methane: the unpaired electron of Cl• and one electron of the C–H bond form the H–Cl bond, leaving the methyl radical.', 261),
      S('Termination', ['CCl', 'Cl'], -100, 'Two radicals combine: the methyl radical and the chlorine atom pair their electrons to form the C–Cl bond (barrierless).', 251),
    ],
  },

  // ------------------------------------------------------------------ combustion
  {
    id: 'combustion-methane', name: 'Combustion of methane', cls: 'Combustion',
    reactants: ['C', 'O=O'], products: ['O=C=O', 'O'], coeffs: [1, 2, 1, 2], arrow: 'forward',
    above: 'O2', below: 'flame', dH: -890, ea: 200,
    explanation: 'Complete combustion of natural gas: CH4 + 2 O2 → CO2 + 2 H2O, ΔH° = −890 kJ/mol (liquid water). With too little oxygen carbon monoxide or soot forms. The ignition energy is needed to start the radical chain.',
  },
  {
    id: 'combustion-propane', name: 'Combustion of propane', cls: 'Combustion',
    reactants: ['CCC', 'O=O'], products: ['O=C=O', 'O'], coeffs: [1, 5, 3, 4], arrow: 'forward',
    above: 'O2', below: 'flame', dH: -2220, ea: 200,
    explanation: 'C3H8 + 5 O2 → 3 CO2 + 4 H2O, ΔH° = −2220 kJ/mol: the fuel in camping gas and gas barbecues. Balance carbon first, then hydrogen, then oxygen.',
  },
  {
    id: 'combustion-ethanol', name: 'Combustion of ethanol', cls: 'Combustion',
    reactants: ['CCO', 'O=O'], products: ['O=C=O', 'O'], coeffs: [1, 3, 2, 3], arrow: 'forward',
    above: 'O2', below: 'flame', dH: -1367, ea: 200,
    explanation: 'C2H5OH + 3 O2 → 2 CO2 + 3 H2O, ΔH° = −1367 kJ/mol. The oxygen already in the alcohol means it releases less energy per gram (30 kJ/g) than petrol (46 kJ/g).',
  },
  {
    id: 'combustion-glucose', name: 'Respiration: oxidation of glucose', cls: 'Biochemical',
    reactants: ['OCC1OC(O)C(O)C(O)C1O', 'O=O'], products: ['O=C=O', 'O'], coeffs: [1, 6, 6, 6], arrow: 'forward',
    above: 'enzymes', below: '37 °C', dH: -2803, ea: 150,
    explanation: 'C6H12O6 + 6 O2 → 6 CO2 + 6 H2O, ΔH° = −2803 kJ/mol. Cells carry out this in some 30 enzyme-controlled steps (glycolysis, Krebs cycle, oxidative phosphorylation) and capture about 40 % of the energy as ATP instead of releasing it as a flame.',
  },
  {
    id: 'photosynthesis', name: 'Photosynthesis', cls: 'Biochemical',
    reactants: ['O=C=O', 'O'], products: ['OCC1OC(O)C(O)C(O)C1O', 'O=O'], coeffs: [6, 6, 1, 6], arrow: 'forward',
    above: 'chlorophyll', below: 'light (hν)', dH: 2803, ea: 150,
    explanation: '6 CO2 + 6 H2O → C6H12O6 + 6 O2, ΔH° = +2803 kJ/mol: respiration run backwards, powered by sunlight. The light reactions split water and make ATP and NADPH; the Calvin cycle uses them to fix CO2 into sugar.',
  },

  // ------------------------------------------------------------------ industrial and equilibria
  {
    id: 'haber', name: 'Haber–Bosch ammonia synthesis', cls: 'Industrial',
    reactants: ['N#N', '[H][H]'], products: ['N'], coeffs: [1, 3, 2], arrow: 'equilibrium',
    above: 'Fe catalyst (K2O, Al2O3 promoters)', below: '400–500 °C, 150–300 atm', dH: -92, ea: 230,
    explanation: 'N2 + 3 H2 ⇌ 2 NH3, ΔH° = −92 kJ/mol. Exothermic and 4 → 2 gas molecules, so Le Chatelier says low temperature and high pressure favour ammonia; but the N≡N bond is so strong that a compromise temperature and an iron catalyst are needed to get a useful rate. About 1 % of the world\'s energy goes into it.',
  },
  {
    id: 'contact', name: 'Contact process: SO2 to SO3', cls: 'Industrial',
    reactants: ['O=S=O', 'O=O'], products: ['O=S(=O)=O'], coeffs: [2, 1, 2], arrow: 'equilibrium',
    above: 'V2O5 catalyst', below: '420–450 °C, 1–2 atm', dH: -198, ea: 250,
    explanation: '2 SO2 + O2 ⇌ 2 SO3, ΔH° = −198 kJ/mol, the key step of sulfuric acid manufacture. The SO3 is absorbed in conc. H2SO4 rather than water (which makes a mist), and a double-contact design pushes the conversion above 99.5 %.',
  },
  {
    id: 'n2o4', name: 'Dissociation of dinitrogen tetroxide', cls: 'Industrial',
    reactants: ['O=[N+]([O-])[N+](=O)[O-]'], products: ['[O]N=O'], coeffs: [1, 2], arrow: 'equilibrium',
    above: '', below: 'gas phase, 25 °C', dH: 57, ea: 57,
    explanation: 'N2O4(g, colourless) ⇌ 2 NO2(g, brown), ΔH° = +57 kJ/mol, Kc = 0.0059 mol/L at 25 °C. A favourite equilibrium problem and demonstration: heating the tube turns it darker brown (endothermic, Le Chatelier); compressing it makes it paler.',
  },
  {
    id: 'h2o2', name: 'Decomposition of hydrogen peroxide', cls: 'Biochemical',
    reactants: ['OO'], products: ['O', 'O=O'], coeffs: [2, 2, 1], arrow: 'forward',
    above: 'MnO2 or catalase', below: '25 °C', dH: -196, ea: 75,
    explanation: '2 H2O2 → 2 H2O + O2, ΔH = −196 kJ for the equation as written (−98 kJ per mole of H2O2). It is thermodynamically very favourable but slow: the uncatalysed activation energy is about 75 kJ/mol, MnO2 lowers it to about 58 and the enzyme catalase to about 8 kJ/mol. Foam from a drop of blood on a cut is this reaction.',
  },
]

export const LIBRARY_BY_ID: ReadonlyMap<string, LibReaction> = new Map(LIBRARY.map((r) => [r.id, r]))

export function findReaction(id: string): LibReaction | null {
  return LIBRARY_BY_ID.get(id) ?? null
}

/** Reactions matching a search text (name, class, reagents, explanation) and optionally a class. */
export function searchLibrary(query: string, cls: ReactionClass | '' = ''): LibReaction[] {
  const q = query.trim().toLowerCase()
  return LIBRARY.filter((r) => {
    if (cls && r.cls !== cls) return false
    if (!q) return true
    return `${r.name} ${r.cls} ${r.above} ${r.below} ${r.explanation}`.toLowerCase().includes(q)
  })
}
