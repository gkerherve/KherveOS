// AI tools of kTitration. ≤ 6 arguments each, at most 4 tools.
// The code is in src/apps/ktitration/aiTools.ts.

import type { AppToolSet, Schema } from '../appToolsCore.ts'
import { num, object, oneOf, str } from './schema.ts'

const anyObject = (description: string): Schema => ({ type: 'object', description, additionalProperties: true })
const numbers = (description: string): Schema => ({ type: 'array', items: { type: 'number' }, description })

export const KTITRATION_TOOL_SET: AppToolSet = {
  app: 'ktitration',
  name: 'kTitration',
  summary: 'titration lab: exact curves (acid–base, redox, EDTA, precipitation), indicators, buffers, data fitting.',
  keywords: [
    'ktitration', 'titration', 'titrate', 'ph', 'indicator', 'buffer', 'speciation', 'acid', 'base', 'equivalence', 'pka', 'henderson', 'burette', 'edta', 'redox', 'nernst',
    'mohr', 'volhard', 'gran', 'phenolphthalein', 'analyte', 'endpoint',
  ],
  tools: [
    {
      action: 'get_state',
      description: 'What kTitration shows: the titration in the window (kind, equivalence volumes, pH or potential at the marks, indicator error), the data being analysed and the fit result.',
      inputSchema: object({}),
      readOnly: true,
    },
    {
      action: 'titrate',
      description: 'Set up a titration and return its key points: equivalence volumes, pH/E/pM/pAg there, half-equivalence pH, and the best indicators. Replaces the titration shown. Acid–base names come from a table of ~130 acids and bases.',
      inputSchema: object({
        type: oneOf(['acidbase', 'redox', 'edta', 'precip'], 'Kind of titration (default acidbase).'),
        analyte: str('acidbase: "acetic acid", "HCl", "ammonia", "phosphoric acid", "glycine"… ; redox: Fe2+, Sn2+, I2; edta: a metal (Ca, Mg, Zn…); precip: Cl-, Br-, I- or Ag+.'),
        analyte_conc: num('Analyte concentration in mol/L.'),
        analyte_volume: num('Analyte volume in mL (default 25).'),
        titrant_conc: num('Titrant concentration in mol/L (default 0.1; EDTA 0.01).'),
        options: anyObject('Optional: titrant ("NaOH","HCl","ammonia","Ce4+","MnO4-","Cr2O7 2-","S2O3 2-"), form (protonation state weighed in, 0 = fully protonated), pKa (list, for an analyte not in the table), z0, water_mL, temperature, activity ("davies"), indicator, pH, ammonia, chromate, mixture [{name,conc,volume}].'),
      }, ['analyte']),
    },
    {
      action: 'analyse_data',
      description: 'Analyse a measured titration curve (volume in mL, pH): equivalence points from the derivatives, Gran plot, and a Levenberg–Marquardt fit of the full model giving the analyte concentration and pKa values with standard errors. Shows it in the Analyse tab.',
      inputSchema: object({
        V: numbers('Titrant volumes in mL, increasing.'),
        pH: numbers('The pH at each volume.'),
        aliquot_mL: num('Sample volume in mL (default 25).'),
        titrant_conc: num('Titrant concentration in mol/L (default 0.1).'),
        options: anyObject('Optional: kind ("acid" HnA with base, "base" with acid, "anion" like Na2CO3, "cation" like NH4Cl, "aminoacid"), n_pKa (1–4), total_volume_mL (sample + water), pKa_guess [..], activity, temperature.'),
      }, ['V', 'pH']),
    },
    {
      action: 'load_example',
      description: 'Open one of the ~34 ready examples (HCl/NaOH, acetic acid, carbonate, phosphoric, glycine, antacid, EDTA hardness, Fe/Ce, Mohr chloride, buffers, synthetic data to analyse…). Without an id, lists them.',
      inputSchema: object({ id: str('The example id (e.g. "acetic-naoh", "carbonate-hcl", "mohr-chloride") or part of its title. Leave out to list them.') }),
    },
  ],
}
