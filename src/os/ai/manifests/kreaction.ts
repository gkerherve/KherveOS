// AI tools of kReaction (reactions, mechanisms, kinetics, energy profiles, equilibrium). ≤ 6 arguments each.
// The code is in src/apps/kreaction/aiTools.ts (the calculations in aiCore.ts).

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, num, object, oneOf, str } from './schema.ts'

const SPECIES = { type: 'array', items: { type: 'string' }, description: 'Names ("ethanol"), SMILES ("CCO") or formulas ("O2", "Fe2O3"); ions in brackets: [Na+].' }

export const KREACTION_TOOL_SET: AppToolSet = {
  app: 'kreaction',
  name: 'kReaction',
  summary: 'molecular reactions: balance, mechanisms, predict products, kinetics, energy profiles, equilibrium.',
  keywords: [
    'kreaction', 'reaction', 'reactions', 'mechanism', 'kinetics', 'rate constant', 'half-life', 'arrhenius', 'activation energy', 'equilibrium', 'ice table',
    'smiles', 'organic', 'energy profile', 'balance', 'products', 'sn1', 'sn2', 'diels-alder', 'le chatelier',
  ],
  tools: [
    {
      action: 'set_reaction',
      description:
        'Put a reaction in the builder, check atoms, mass and charge, and balance it with the smallest whole numbers. Species are names, SMILES or formulas. With no arguments it reads the reaction on screen.',
      inputSchema: object({
        reactants: SPECIES,
        products: SPECIES,
        arrow: oneOf(['forward', 'equilibrium'], 'Arrow type (default forward).'),
        above: str('Text above the arrow: catalyst or reagent, e.g. "H2SO4".'),
        below: str('Text below the arrow: solvent, temperature, e.g. "78 °C".'),
        balance: bool('Apply the balancing coefficients when the reaction is not balanced (default true).'),
      }),
    },
    {
      action: 'load_example',
      description: 'Open a library reaction (about 50: SN1, SN2, E2, aldol, Grignard, Diels–Alder, combustion, Haber…) with its explanation and mechanism steps. Without id it lists them.',
      inputSchema: object({
        id: str('Library id such as "sn2" or "fischer". Leave out to list all ids.'),
        into: oneOf(['builder', 'mechanism', 'energy'], 'Where to show it: the reaction builder (default), the step-by-step mechanism viewer, or the energy profile.'),
      }),
      readOnly: true,
    },
    {
      action: 'predict_products',
      description: 'Predict products of the reactants with reaction templates run by RDKit (esterification, SN2, alkene additions, Grignard, Diels–Alder…). Give reagents as reactants too: HBr is "Br", Br2 "BrBr", hydroxide "[OH-]".',
      inputSchema: object(
        { reactants: SPECIES, only: str('Optional template id to try only one reaction type, e.g. "esterification".') },
        ['reactants'],
      ),
      readOnly: true,
    },
    {
      action: 'simulate_kinetics',
      description: 'Integrate a reaction network (mass action, stiff-capable) and return concentrations at sample times, maxima and half-lives. Give the network text or a preset id; with neither it runs the network on screen.',
      inputSchema: object({
        network: str('Lines: "A = 1", "fixed B = 3", "A + B <=> C ; kf = 2, kr = 0.5", "A -> B ; k = 0.1", Arrhenius "; A = 1e8, Ea = 50" after "T = 300". Or a preset id: first-order, consecutive, michaelis-menten, brusselator, robertson…'),
        t_end: num('End time (any unit consistent with the constants).'),
        samples: num('Number of time points to return (default 10, at most 60).'),
        log_time: bool('Space the points logarithmically in time.'),
        method: oneOf(['auto', 'rk45', 'rk4', 'stiff'], 'ODE solver (default auto: switches to the stiff solver if needed).'),
      }),
      readOnly: true,
    },
    {
      action: 'fit_order',
      description: 'Analyse kinetic data. mode "order": (time, concentration) pairs give the order, rate constant ± error and half-life. mode "arrhenius" or "eyring": (T in K, k) pairs give Ea or ΔH‡ and ΔS‡.',
      inputSchema: object({
        data: str('Lines of "x y" pairs (spaces, tabs or commas), e.g. "0 1.0\\n10 0.61\\n20 0.37".'),
        x: { type: 'array', items: { type: 'number' }, description: 'x values (time, or temperature in K) when not using data.' },
        y: { type: 'array', items: { type: 'number' }, description: 'y values (concentration, or rate constant k).' },
        mode: oneOf(['order', 'arrhenius', 'eyring'], 'What to fit (default order).'),
      }),
      readOnly: true,
    },
    {
      action: 'equilibrium',
      description: 'Solve an equilibrium exactly (ICE table) from the equation, initial amounts and K: equilibrium amounts, Q versus K, direction. Or give dH (kJ/mol), dS (J/mol/K) and T (K) for ΔG and K.',
      inputSchema: object({
        equation: str('Reaction with an arrow, e.g. "N2 + 3 H2 <=> 2 NH3". (s) and (l) species are left out of Q.'),
        initial: str('Initial concentrations or pressures, e.g. "N2 = 1, H2 = 3".'),
        K: num('Equilibrium constant (Kc or Kp, matching the initial amounts).'),
        dH: num('Reaction enthalpy ΔH° in kJ/mol.'),
        dS: num('Reaction entropy ΔS° in J/(mol K).'),
        T: num('Temperature in K.'),
      }),
      readOnly: true,
    },
    {
      action: 'export_report',
      description: 'Save a Markdown report of the reaction in the builder (equation, structures as SVG, species table, balance), optionally with the notebook. Asks the user first.',
      inputSchema: object({
        path: str('File to write, ending in .md or .txt (default ~/Documents/kreaction-report.md).'),
        include_notebook: bool('Append the pinned notebook entries.'),
      }),
    },
  ],
}
