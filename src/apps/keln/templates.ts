// Entry templates (pure data): each one makes the content of a new draft entry, with the right headings and
// structured blocks already in place. "Duplicate as template" in the app copies any finished entry the same way.

import { block, doc, h, italic, math, p, tasks, ul, bold, type PMNode } from './doc.ts'
import { newBlock, type Block } from './blocks.ts'
import { newReagent, type MeasurementData, type ReactionData } from './reaction.ts'
import type { EntryLink } from './model.ts'

export interface Template {
  id: string
  name: string
  group: 'Chemistry' | 'Measurements' | 'Lab routine' | 'Biology' | 'Materials' | 'Office'
  description: string
  tags: string[]
  /** The suggested entry title. */
  title: string
  content(): PMNode
  links?: EntryLink[]
}

const measurements = (title: string, columns: Array<[string, string]>, rows: string[][]): Block => {
  const data: MeasurementData = { title, columns: columns.map(([name, unit]) => ({ name, unit })), rows }
  return { kind: 'measurements', data }
}

const blankRows = (cols: number, n: number): string[][] => Array.from({ length: n }, () => Array.from({ length: cols }, () => ''))

const safety = (hazards: string[] = [], ppe: string[] = ['Lab coat', 'Safety glasses', 'Nitrile gloves']): Block => {
  const b = newBlock('safety')
  if (b.kind === 'safety') { b.data.hazards = hazards; b.data.ppe = ppe }
  return b
}

const instrument = (name: string, method = '', parameters = ''): Block => {
  const b = newBlock('instrument')
  if (b.kind === 'instrument') Object.assign(b.data, { instrument: name, method, parameters })
  return b
}

const steps = (title: string, items: string[]): Block => ({ kind: 'steps', data: { title, items: items.map((text) => ({ text, doneBy: '', doneAt: '' })) } })

const reactionTemplate = (): ReactionData => ({
  title: 'Reaction', smiles: '', notes: '',
  reagents: [newReagent('reactant', { name: 'Starting material' }), newReagent('reagent', { name: 'Reagent' }), newReagent('solvent', { name: 'Solvent' }), newReagent('product', { name: 'Product' })],
})

export const TEMPLATES: Template[] = [
  {
    id: 'blank', name: 'Blank entry', group: 'Office', description: 'An empty page.', tags: [], title: 'New entry',
    content: () => doc(p()),
  },
  {
    id: 'organic-synthesis', name: 'Organic synthesis', group: 'Chemistry', description: 'Aim, reaction table with yield, procedure, work-up, characterisation.', tags: ['synthesis'], title: 'Synthesis of …',
    content: () => doc(
      h(2, 'Aim'), p('What is made, from what, and why.'),
      h(2, 'Reaction'), block({ kind: 'reaction', data: reactionTemplate() }),
      h(2, 'Safety'), block(safety(['Check the SDS of every reagent and solvent'])),
      h(2, 'Procedure'), block(steps('Procedure', ['Charge the flask', 'Add reagent', 'Heat / stir for the stated time', 'Monitor by TLC'])),
      h(2, 'Work-up'), p('Quench, extract, wash, dry, concentrate.'),
      h(2, 'Characterisation'), block(measurements('Characterisation', [['Property', ''], ['Found', ''], ['Literature', '']], [['Appearance', '', ''], ['Melting point', '', ''], ['IR / NMR / MS', '', '']])),
      h(2, 'Yield and conclusion'), p('Isolated mass, % yield (see the reaction table), purity, what to change next time.'),
    ),
  },
  {
    id: 'titration', name: 'Titration', group: 'Chemistry', description: 'Standardisation or assay with replicates, mean ± sd, and a link to kTitration examples.', tags: ['titration'], title: 'Titration of …',
    links: [{ kind: 'path', target: '/home/user/Documents/kTitration Examples', label: 'kTitration example curves' }],
    content: () => doc(
      h(2, 'Aim'), p('Determine the concentration of … by titration with … (indicator or pH electrode).'),
      h(2, 'Solutions'), block({ kind: 'materials', data: { title: 'Solutions', items: [{ name: 'Titrant', cas: '', supplier: '', lot: '', amount: '0.1000 mol/L', hazard: '' }, { name: 'Analyte', cas: '', supplier: '', lot: '', amount: '25.00 mL', hazard: '' }] } }),
      h(2, 'Burette readings'), block(measurements('Titration volumes', [['Run', ''], ['Initial', 'mL'], ['Final', 'mL'], ['Titre', 'mL']], [['1', '0.00', '', ''], ['2', '', '', ''], ['3', '', '', '']])),
      h(2, 'Calculation'), p('At the equivalence point ', math('n_{\\text{acid}} = n_{\\text{base}}'), ', so ', math('c_1 V_1 = c_2 V_2'), '.'),
      h(2, 'Result'), p('Concentration (mean ± sd) and the uncertainty budget. Compare the curve with the kTitration examples linked on the right.'),
    ),
  },
  {
    id: 'xps-session', name: 'XPS measurement session', group: 'Measurements', description: 'Survey and core-level scans, charge correction, sample list.', tags: ['XPS', 'surface'], title: 'XPS session …',
    content: () => doc(
      h(2, 'Samples'), p('Mount and sample IDs: ', italic('type @ to link the sample'), '.'),
      h(2, 'Instrument'), block(instrument('XPS', 'Al Kα, survey + core levels', 'Pass energy 160 eV (survey) / 20 eV (core); flood gun on insulators')),
      h(2, 'Acquisition'), block(measurements('Scans', [['Region', ''], ['Start', 'eV'], ['End', 'eV'], ['Step', 'eV'], ['Dwell', 'ms'], ['Sweeps', '']], [['Survey', '1200', '0', '1', '50', '2'], ['C 1s', '294', '280', '0.1', '100', '5'], ['O 1s', '540', '525', '0.1', '100', '5'], ['', '', '', '', '', '']])),
      h(2, 'Charge correction'), p('Adventitious C 1s set to 284.8 eV; shift applied: ___ eV.'),
      h(2, 'Observations'), block(newBlock('timeline')),
      h(2, 'Analysis'), p('Open the files in KherveFitting from the instrument block above; note peak positions and atomic percentages here.'),
    ),
  },
  {
    id: 'tga-session', name: 'TGA run', group: 'Measurements', description: 'Thermogravimetric run with a mass-loss table and a curve.', tags: ['TGA', 'thermal'], title: 'TGA run …',
    content: () => doc(
      h(2, 'Sample'), p('Sample ', italic('type @ to link the sample'), ', mass loaded: ___ mg, crucible: alumina 70 µL.'),
      h(2, 'Method'), block(instrument('TGA', 'Dynamic, 10 K/min', 'Atmosphere N2 50 mL/min; 30 to 800 °C; baseline subtracted')),
      h(2, 'Mass-loss steps'), block(measurements('Mass loss', [['Step', ''], ['T start', '°C'], ['T end', '°C'], ['Mass loss', '%']], [['1 (water)', '', '', ''], ['2', '', '', ''], ['Residue at 800 °C', '', '', '']])),
      h(2, 'Curve'), block({ kind: 'plot', data: { title: 'TGA curve', xLabel: 'Temperature (°C)', yLabel: 'Mass (%)', kind: 'line', series: ['Mass'], rows: [['30', '100'], ['200', '99'], ['400', '60'], ['600', '35'], ['800', '33']] } }),
      h(2, 'Interpretation'), p('Assign each step (dehydration, decomposition, oxidation) and compare with the expected composition.'),
    ),
  },
  {
    id: 'xrd-session', name: 'XRD measurement', group: 'Measurements', description: 'Powder or thin-film diffraction scan with a peak table.', tags: ['XRD', 'structure'], title: 'XRD scan …',
    content: () => doc(
      h(2, 'Sample'), p('Sample ', italic('type @ to link the sample'), ' (powder / film on …).'),
      h(2, 'Instrument'), block(instrument('XRD', 'Bragg-Brentano θ-2θ', 'Cu Kα, 40 kV 40 mA, 10-80° 2θ, step 0.02°, 1 s/step')),
      h(2, 'Peaks'), block(measurements('Peak list', [['2θ', '°'], ['d', 'Å'], ['Intensity', 'counts'], ['hkl', '']], blankRows(4, 5))),
      h(2, 'Phase identification'), p('Reference cards matched, crystallite size from the Scherrer equation ', math('D = \\frac{K\\lambda}{\\beta\\cos\\theta}'), '.'),
    ),
  },
  {
    id: 'calibration-log', name: 'Calibration log', group: 'Lab routine', description: 'pH meter, balance or pipette: standards, readings, deviation, pass/fail.', tags: ['calibration', 'QC'], title: 'Calibration: …',
    content: () => doc(
      h(2, 'Device'), block(instrument('pH meter', 'Two-point calibration', 'Buffers pH 4.01 and 7.00, 25 °C')),
      h(2, 'pH meter'), block(measurements('pH calibration', [['Buffer', 'pH'], ['Reading', 'pH'], ['Slope', '%'], ['Deviation', 'pH']], [['4.01', '', '', ''], ['7.00', '', '', ''], ['10.01', '', '', '']])),
      h(2, 'Balance'), block(measurements('Balance check', [['Reference mass', 'g'], ['Reading', 'g']], [['1.0000', ''], ['10.0000', ''], ['100.0000', '']])),
      h(2, 'Pipette (gravimetric)'), block(measurements('Pipette 1000 µL', [['Mass of water', 'g']], blankRows(1, 5))),
      h(2, 'Result'), tasks(['Within tolerance', false], ['Label updated with the next due date', false], ['Out of tolerance: removed from use and reported', false]),
    ),
  },
  {
    id: 'cell-culture', name: 'Cell culture passage', group: 'Biology', description: 'Passage record: cell line, confluence, split ratio, media, contamination check.', tags: ['cell culture'], title: 'Passage of … cells',
    content: () => doc(
      h(2, 'Cells'), block(measurements('Cell line', [['Cell line', ''], ['Passage', ''], ['Confluence', '%'], ['Viability', '%'], ['Split ratio', '']], [['', '', '', '', '']])),
      h(2, 'Reagents'), block({ kind: 'materials', data: { title: 'Media and reagents', items: [{ name: 'Medium', cas: '', supplier: '', lot: '', amount: '', hazard: '' }, { name: 'Trypsin-EDTA', cas: '', supplier: '', lot: '', amount: '', hazard: '' }, { name: 'PBS', cas: '', supplier: '', lot: '', amount: '', hazard: '' }] } }),
      h(2, 'Steps'), block(steps('Passage', ['Check morphology and contamination under the microscope', 'Wash with PBS', 'Trypsinise and neutralise', 'Count cells', 'Seed new flasks', 'Label flasks (line, passage, date, initials)'])),
      h(2, 'Observations'), block(newBlock('timeline')),
    ),
  },
  {
    id: 'pcr-setup', name: 'PCR set-up', group: 'Biology', description: 'Master mix table, cycling programme and plate map.', tags: ['PCR', 'molecular biology'], title: 'PCR: …',
    content: () => doc(
      h(2, 'Target'), p('Gene / amplicon, primers, expected size.'),
      h(2, 'Master mix'), block(measurements('Master mix (per reaction, µL)', [['Component', ''], ['Stock', ''], ['Final', ''], ['Per reaction', 'µL'], ['× reactions', 'µL']], [['Water', '', '', '', ''], ['Buffer', '10×', '1×', '2.5', ''], ['dNTPs', '10 mM', '0.2 mM', '0.5', ''], ['Forward primer', '10 µM', '0.4 µM', '1.0', ''], ['Reverse primer', '10 µM', '0.4 µM', '1.0', ''], ['Polymerase', '5 U/µL', '1 U', '0.2', ''], ['Template', '', '', '1.0', '']])),
      h(2, 'Cycling'), block(measurements('Thermal cycler', [['Step', ''], ['Temperature', '°C'], ['Time', 's'], ['Cycles', '']], [['Initial denaturation', '95', '180', '1'], ['Denaturation', '95', '30', '30'], ['Annealing', '58', '30', ''], ['Extension', '72', '60', ''], ['Final extension', '72', '300', '1']])),
      h(2, 'Plate map'), block(measurements('Plate (well: sample)', [['Well', ''], ['Sample', ''], ['Control', '']], [['A1', '', 'negative'], ['A2', '', 'positive'], ['A3', '', '']])),
    ),
  },
  {
    id: 'gel-electrophoresis', name: 'Gel electrophoresis', group: 'Biology', description: 'Gel, buffer, ladder, loading table, run conditions, result.', tags: ['gel', 'electrophoresis'], title: 'Gel: …',
    content: () => doc(
      h(2, 'Gel'), ul([bold('Gel: '), '1 % agarose in 1× TAE, stain …'], [bold('Buffer: '), '1× TAE'], [bold('Run: '), '100 V, 40 min']),
      h(2, 'Loading'), block(measurements('Lanes', [['Lane', ''], ['Sample', ''], ['Volume', 'µL']], [['1', 'Ladder', '5'], ['2', '', ''], ['3', '', ''], ['4', '', '']])),
      h(2, 'Image'), p('Attach the gel image (Attach ▸ Image) and note the band sizes.'),
      h(2, 'Result'), p('Expected vs observed band sizes.'),
    ),
  },
  {
    id: 'thin-film', name: 'Thin-film deposition run', group: 'Materials', description: 'Deposition parameters, substrate and the new sample (lineage).', tags: ['thin film', 'deposition'], title: 'Deposition: …',
    content: () => doc(
      h(2, 'Substrate and sample'), p('Substrate ', italic('type @ to link the sample'), ' → film sample (create it in the Samples register with the substrate as parent).'),
      h(2, 'Process'), block(instrument('Sputter coater', 'Magnetron sputtering', 'Base pressure < 5e-7 mbar; Ar flow 20 sccm')),
      h(2, 'Parameters'), block(measurements('Deposition parameters', [['Target', ''], ['Power', 'W'], ['Pressure', 'mbar'], ['Substrate T', '°C'], ['Time', 'min'], ['Thickness', 'nm']], [['', '', '', '', '', ''], ['', '', '', '', '', '']])),
      h(2, 'Post-treatment'), p('Annealing or cleaning steps after the run.'),
      h(2, 'Observations'), block(newBlock('timeline')),
    ),
  },
  {
    id: 'instrument-maintenance', name: 'Instrument maintenance', group: 'Lab routine', description: 'Routine service checklist with parts replaced and next due date.', tags: ['maintenance'], title: 'Maintenance: …',
    content: () => doc(
      h(2, 'Instrument'), block(instrument('', 'Scheduled maintenance')),
      h(2, 'Checklist'), block(steps('Service steps', ['Visual inspection', 'Clean and lubricate', 'Replace consumables', 'Run the performance test', 'Update the logbook label'])),
      h(2, 'Parts and consumables'), block(measurements('Parts replaced', [['Part', ''], ['Lot / serial', ''], ['Quantity', '']], blankRows(3, 3))),
      h(2, 'Performance test'), p('Result and whether the instrument is back in service. Next service due: ____'),
    ),
  },
  {
    id: 'solution-prep', name: 'Solution preparation', group: 'Lab routine', description: 'Weighing, dilution calculation, final concentration, label.', tags: ['solution'], title: 'Preparation of … solution',
    content: () => doc(
      h(2, 'Target'), p('Volume ___ mL of ___ mol/L. Mass needed ', math('m = c \\, V \\, M'), '.'),
      h(2, 'Materials'), block({ kind: 'materials', data: { title: 'Materials', items: [{ name: '', cas: '', supplier: '', lot: '', amount: '', hazard: '' }] } }),
      h(2, 'Steps'), block(steps('Preparation', ['Weigh the solid', 'Dissolve in about 80 % of the volume', 'Transfer to the volumetric flask and make up', 'Mix and label (name, concentration, date, initials, expiry)'])),
      h(2, 'Result'), block(measurements('Final solution', [['Mass weighed', 'g'], ['Volume', 'mL'], ['Concentration', 'mol/L']], [['', '', '']])),
    ),
  },
  {
    id: 'literature-note', name: 'Literature note', group: 'Office', description: 'Reference, summary, key results, relevance and to-do.', tags: ['literature'], title: 'Paper: …',
    content: () => doc(
      h(2, 'Reference'), p('Authors, title, journal, year, DOI.'),
      h(2, 'Summary'), p('In three sentences.'),
      h(2, 'Key results'), ul(['…'], ['…']),
      h(2, 'Relevance to my work'), p(''),
      h(2, 'To do'), tasks(['Check the methods against ours', false], ['Request the data', false]),
    ),
  },
  {
    id: 'meeting-actions', name: 'Group-meeting action list', group: 'Office', description: 'Attendees, decisions and actions with owner and due date.', tags: ['meeting'], title: 'Group meeting …',
    content: () => doc(
      h(2, 'Attendees'), p(''),
      h(2, 'Discussion'), ul(['…']),
      h(2, 'Decisions'), ul(['…']),
      h(2, 'Actions'), block(measurements('Actions', [['Action', ''], ['Owner', ''], ['Due', ''], ['Done', '']], [['', '', '', ''], ['', '', '', ''], ['', '', '', '']])),
      h(2, 'Next meeting'), p(''),
    ),
  },
  {
    id: 'risk-assessment', name: 'Risk assessment', group: 'Lab routine', description: 'Hazards, controls, residual risk, emergency and waste, sign-off.', tags: ['safety', 'risk'], title: 'Risk assessment: …',
    content: () => doc(
      h(2, 'Activity'), p('What will be done, where, by whom.'),
      h(2, 'Hazards and controls'), block(safety(['…'], ['Lab coat', 'Safety glasses', 'Nitrile gloves', 'Fume hood'])),
      block(measurements('Risk matrix', [['Hazard', ''], ['Likelihood (1-5)', ''], ['Severity (1-5)', ''], ['Risk', ''], ['Control', '']], blankRows(5, 3))),
      h(2, 'Emergency'), p('Spill, fire, exposure, first aid, contacts.'),
      h(2, 'Sign-off'), tasks(['Reviewed by the supervisor', false], ['Reviewed by the safety officer', false]),
    ),
  },
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export interface TemplateVars {
  /** Replaces "…" in the title when given. */
  subject?: string
}

/** The fields of a new draft from a template. */
export function instantiateTemplate(t: Template, vars: TemplateVars = {}): { title: string; content: PMNode; tags: string[]; template: string; links: EntryLink[] } {
  const title = vars.subject ? (t.title.includes('…') ? t.title.replace('…', vars.subject) : `${t.title} ${vars.subject}`) : t.title
  return { title, content: JSON.parse(JSON.stringify(t.content())) as PMNode, tags: [...t.tags], template: t.id, links: (t.links ?? []).map((l) => ({ ...l })) }
}

/** Templates grouped for the New entry menu. */
export function templateGroups(): Array<{ group: string; templates: Template[] }> {
  const m = new Map<string, Template[]>()
  for (const t of TEMPLATES) m.set(t.group, [...(m.get(t.group) ?? []), t])
  return [...m].map(([group, templates]) => ({ group, templates }))
}
