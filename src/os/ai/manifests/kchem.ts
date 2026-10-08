// AI tools of kChem (molar masses, equations, stoichiometry, solutions, dilutions, pH, gases, elements).
// ≤ 6 arguments each. The code is in src/apps/kchem/aiTools.ts.

import type { AppToolSet } from '../appToolsCore.ts'
import { num, object, oneOf, str } from './schema.ts'

export const KCHEM_TOOL_SET: AppToolSet = {
  app: 'kchem',
  name: 'kChem',
  summary: 'chemistry at the bench: molar mass, equation balancing, yields, solutions, pH, gas laws, elements.',
  keywords: [
    'kchem', 'chemistry', 'molar mass', 'molar', 'molecular weight', 'formula', 'mole', 'moles', 'stoichiometry', 'yield', 'dilution', 'molarity', 'solution', 'weigh',
    'balance', 'equation', 'limiting reagent', 'ph', 'buffer', 'acid', 'gas law', 'ideal gas', 'periodic table', 'element',
  ],
  tools: [
    {
      action: 'molar_mass',
      description: 'The molar mass (g/mol) of a formula, the mass percent of each element, and the monoisotopic mass. Brackets, hydrate dots (CuSO4·5H2O), subscripts and charges (SO4^2-) work.',
      inputSchema: object({ formula: str('The formula, e.g. "Ca(OH)2" or "CuSO4·5H2O".') }, ['formula']),
    },
    {
      action: 'stoichiometry',
      description: 'From a mass of reactant to the moles and mass of product, with the coefficients of the balanced equation. Shows it in kChem. For several reactants use limiting_reagent.',
      inputSchema: object(
        {
          reactant: str('The reactant formula, e.g. "H2".'),
          mass_g: num('The mass of reactant in grams.'),
          reactant_coefficient: num('Its coefficient in the balanced equation.'),
          product: str('The product formula, e.g. "H2O".'),
          product_coefficient: num('Its coefficient in the balanced equation.'),
        },
        ['reactant', 'mass_g', 'reactant_coefficient', 'product', 'product_coefficient'],
      ),
    },
    {
      action: 'solution',
      description: 'The mass (g) of a compound to weigh out for a solution of a given molarity and volume (dissolve and make up to the volume).',
      inputSchema: object(
        {
          formula: str('The compound, e.g. "NaCl".'),
          molarity: num('The concentration in mol/L.'),
          volume_ml: num('The final volume in mL.'),
        },
        ['formula', 'molarity', 'volume_ml'],
      ),
    },
    {
      action: 'dilution',
      description: 'Solve C1·V1 = C2·V2. Give three of the four values; the missing one is found (units just have to match).',
      inputSchema: object({ c1: num('C1, the stock concentration.'), v1: num('V1, the stock volume.'), c2: num('C2, the wanted concentration.'), v2: num('V2, the wanted final volume.') }),
    },
    {
      action: 'balance_equation',
      description: 'Balance a chemical equation (exact, smallest whole coefficients). Charges, hydrates, brackets and e- work; says why when it is impossible or not unique. Shows it in kChem.',
      inputSchema: object({ equation: str('The equation, e.g. "Fe + O2 -> Fe2O3" or "Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O".') }, ['equation']),
      readOnly: true,
    },
    {
      action: 'limiting_reagent',
      description: 'Limiting reagent, theoretical yield of every product, excess left and percent yield for a reaction with several reactants. Balances the equation if it has no coefficients. Amounts by mass, moles or solution.',
      inputSchema: object(
        {
          equation: str('The equation, e.g. "2 H2 + O2 -> 2 H2O" or just "H2 + O2 -> H2O".'),
          amounts: {
            type: 'array',
            description: 'One entry per reactant you know the amount of (the others are taken in excess).',
            items: object({
              formula: str('The reactant formula exactly as in the equation.'),
              mass_g: num('Its mass in grams.'),
              moles: num('Or its amount in moles.'),
              volume_ml: num('Or the volume of its solution in mL (with molarity).'),
              molarity: num('The solution concentration in mol/L.'),
            }, ['formula']),
          },
          actual_yield_g: num('The weighed (actual) yield in grams, for the percent yield.'),
          yield_product: str('The product formula the actual yield is for (default: the first product).'),
        },
        ['equation', 'amounts'],
      ),
      readOnly: true,
    },
    {
      action: 'ph',
      description: 'pH calculations at 25 °C: strong or weak acid or base of a concentration (exact), a buffer (Henderson–Hasselbalch), or pH ⇄ [H+] conversions.',
      inputSchema: object(
        {
          type: oneOf(['strong_acid', 'strong_base', 'weak_acid', 'weak_base', 'buffer', 'from_ph', 'from_h'], 'What to compute: the pH of a strong/weak acid/base, of a buffer, or the conversion from a pH or an [H+].'),
          concentration: num('Concentration in mol/L (the acid for a buffer).'),
          pk: str('pKa of the acid (several separated by commas for a polyprotic acid), or pKb for weak_base. E.g. "4.76".'),
          k: num('Ka (or Kb for weak_base) instead of pk, e.g. 1.8e-5.'),
          base_concentration: num('For a buffer: the concentration of the conjugate base in mol/L.'),
          value: num('For from_ph the pH, for from_h the [H+] in mol/L.'),
        },
        ['type'],
      ),
      readOnly: true,
    },
    {
      action: 'element',
      description: 'Look up an element by symbol, name or number: weight, group, block, electron configuration, electronegativity, melting/boiling points, density, oxidation states. Shows it in the periodic table.',
      inputSchema: object({ query: str('Symbol, name or atomic number, e.g. "Fe", "iron" or "26".') }, ['query']),
      readOnly: true,
    },
    {
      action: 'gas_law',
      description: 'Ideal gas law PV = nRT: give three of pressure, volume, amount and temperature and the missing one is found.',
      inputSchema: object({
        pressure_atm: num('Pressure in atm.'),
        volume_l: num('Volume in litres.'),
        moles: num('Amount in mol.'),
        temperature_k: num('Temperature in kelvin.'),
        temperature_c: num('Or the temperature in °C.'),
      }),
      readOnly: true,
    },
  ],
}
