// The example notebooks (pure data): built with the same operations the app uses, on a fixed clock with counting
// ids, so every run gives byte-identical files (tools/export_keln_examples.ts writes them to public/examples/keln/).

import { bytesToBase64, sha256Bytes } from './hash.ts'
import { block, bold, doc, h, italic, link, math, mention, ol, p, table, tasks, ul, type PMNode } from './doc.ts'
import { newBlock, type Block } from './blocks.ts'
import { molarMass } from './formula.ts'
import { newReagent, type MeasurementData } from './reaction.ts'
import { fixedCtx, type Attachment, type Entry, type FixedCtx, type EntryLink, type InventoryItem, type Notebook, type Sample } from './model.ts'
import { addEntry, addInstrument, addSample, amendEntry, createNotebook, logExport, recordEdit, signEntry, updateEntry, upsertInventory, witnessEntry, type NewEntry } from './notebook.ts'

export const OWNER = 'Ana Martin'
export const WITNESS = 'Ben Okafor'

export interface ExampleNotebook {
  title: string
  group: 'Chemistry' | 'Measurements' | 'Biology' | 'Lab management' | 'Integrity'
  description: string
  notebook: Notebook
}

// ------------------------------------------------------------------ a small builder

interface Book {
  nb: Notebook
  ctx: FixedCtx
}

function newBook(o: { title: string; description: string; start: string; projects: Array<[string, string]>; prefix?: string; owner?: string }): Book {
  const ctx = fixedCtx(o.start, o.owner ?? OWNER, 3)
  const nb = createNotebook(ctx, { title: o.title, description: o.description, projects: o.projects.map(([code, name]) => ({ code, name })), samplePrefix: o.prefix })
  return { nb, ctx }
}

const pid = (b: Book, code: string): string => b.nb.projects.find((x) => x.code === code)!.id

function entry(b: Book, code: string, init: Omit<NewEntry, 'projectId'>): Entry {
  if (init.date) b.ctx.jump(init.date + 'Z') // the log follows the entry dates
  const r = addEntry(b.nb, { ...init, projectId: pid(b, code) }, b.ctx)
  b.nb = r.nb
  return r.entry
}

function sample(b: Book, s: Partial<Sample> & { name: string; made: string }): Sample {
  const r = addSample(b.nb, s, b.ctx)
  b.nb = r.nb
  return r.sample
}

function edit(b: Book, id: string, patch: Parameters<typeof updateEntry>[2]): void {
  b.nb = recordEdit(updateEntry(b.nb, id, patch, b.ctx), id, b.ctx, { force: true })
}

function sign(b: Book, id: string, witness?: string): void {
  b.nb = signEntry(b.nb, id, b.ctx)
  if (witness) b.nb = witnessEntry(b.nb, id, witness, b.ctx)
}

/** A small file embedded in the notebook (≤ 1 MB), with its SHA-256. */
function file(b: Book, name: string, text: string, mime: string, added: string): Attachment {
  const bytes = new TextEncoder().encode(text)
  return { id: b.ctx.id('att'), name, size: bytes.length, sha256: sha256Bytes(bytes), mime, added, addedBy: b.ctx.user, path: '', data: bytesToBase64(bytes) }
}

const meas = (title: string, columns: Array<[string, string]>, rows: string[][]): Block => {
  const data: MeasurementData = { title, columns: columns.map(([name, unit]) => ({ name, unit })), rows }
  return { kind: 'measurements', data }
}

const instrumentBlock = (o: Partial<Extract<Block, { kind: 'instrument' }>['data']>): Block => {
  const b = newBlock('instrument')
  if (b.kind === 'instrument') Object.assign(b.data, o)
  return b
}

const safetyBlock = (hazards: string[], ppe: string[], pictograms: string[], controls: string, waste: string, risk: 'low' | 'medium' | 'high' = 'low'): Block => ({
  kind: 'safety', data: { hazards, ppe, pictograms, controls, waste, risk },
})

const stepsBlock = (title: string, items: Array<[string, string?, string?]>): Block => ({
  kind: 'steps', data: { title, items: items.map(([text, doneBy = '', doneAt = '']) => ({ text, doneBy, doneAt })) },
})

const timelineBlock = (title: string, items: Array<[string, string]>): Block => ({ kind: 'timeline', data: { title, items: items.map(([time, text]) => ({ time, text })) } })

const plot = (title: string, xLabel: string, yLabel: string, series: string[], rows: string[][], kind: 'line' | 'scatter' | 'bar' = 'line'): Block => ({
  kind: 'plot', data: { title, xLabel, yLabel, kind, series, rows },
})

const f = (x: number, d = 2): string => x.toFixed(d)

// ------------------------------------------------------------------ 1. aspirin

function aspirin(): ExampleNotebook {
  const b = newBook({ title: 'Aspirin synthesis', description: 'Teaching-lab synthesis of acetylsalicylic acid: reaction table with % yield, recrystallisation, purity test.', start: '2026-02-09T08:00:00Z', projects: [['ASP', 'Aspirin']], prefix: 'ASP' })
  const inv: InventoryItem[] = [
    { id: 'inv-sal', name: 'Salicylic acid', formula: 'C7H6O3', cas: '69-72-7', mw: null, density: null, supplier: 'Sigma-Aldrich', lot: 'MKCP1234', amount: '500 g', hazard: 'Harmful if swallowed; eye damage', location: 'Cabinet A2' },
    { id: 'inv-ac2o', name: 'Acetic anhydride', formula: 'C4H6O3', cas: '108-24-7', mw: null, density: 1.082, supplier: 'Fisher', lot: '2283104', amount: '1 L', hazard: 'Flammable; corrosive; harmful if inhaled', location: 'Flammables cabinet' },
    { id: 'inv-h2so4', name: 'Sulfuric acid, 96 %', formula: 'H2SO4', cas: '7664-93-9', mw: null, density: 1.84, supplier: 'VWR', lot: 'K51873', amount: '2.5 L', hazard: 'Severe skin burns and eye damage', location: 'Acid cabinet' },
    { id: 'inv-etoh', name: 'Ethanol, absolute', formula: 'C2H6O', cas: '64-17-5', mw: null, density: 0.789, supplier: 'VWR', lot: 'E22091', amount: '2.5 L', hazard: 'Highly flammable', location: 'Flammables cabinet' },
  ]
  for (const i of inv) b.nb = upsertInventory(b.nb, i)
  b.nb = addInstrument(addInstrument(b.nb, 'FTIR (ATR)'), 'Melting point apparatus')
  const spectrum = file(b, 'aspirin-ir-peaks.csv', 'wavenumber_cm-1,transmittance_pct,assignment\n3000,42,O-H stretch (carboxylic acid dimer)\n1750,12,C=O stretch (ester)\n1690,10,C=O stretch (carboxylic acid)\n1605,35,C=C aromatic\n1190,18,C-O stretch\n', 'text/csv', '2026-02-09T14:20:00')
  const sal = inv[0], ac = inv[1], acid = inv[2]
  const synth = entry(b, 'ASP', {
    title: 'Synthesis of acetylsalicylic acid', date: '2026-02-09T09:30:00', tags: ['synthesis', 'teaching', 'esterification'], attachments: [spectrum], template: 'organic-synthesis',
    links: [{ kind: 'url', target: 'https://pubchem.ncbi.nlm.nih.gov/compound/Aspirin', label: 'PubChem: aspirin' }],
    content: doc(
      h(2, 'Aim'), p('Acetylate salicylic acid with acetic anhydride (sulfuric acid as catalyst) to give aspirin, and determine the percentage yield.'),
      h(2, 'Reaction'),
      block({ kind: 'reaction', data: {
        title: 'Salicylic acid + acetic anhydride', smiles: 'OC(=O)c1ccccc1O.CC(=O)OC(C)=O>>CC(=O)Oc1ccccc1C(O)=O.CC(O)=O', notes: 'Acetic anhydride in excess (about 3.7 equiv) drives the reaction.',
        reagents: [
          newReagent('reactant', { name: sal.name, formula: sal.formula, mass: 2.0, cas: sal.cas }),
          newReagent('reactant', { name: ac.name, formula: ac.formula, volume: 5.0, density: 1.082, cas: ac.cas }),
          newReagent('catalyst', { name: acid.name, formula: acid.formula, volume: 0.1, density: 1.84, cas: acid.cas }),
          newReagent('product', { name: 'Aspirin (crude)', formula: 'C9H8O4', actual: 2.12 }),
          newReagent('product', { name: 'Acetic acid', formula: 'C2H4O2' }),
        ],
      } }),
      h(2, 'Safety'), block(safetyBlock(['Acetic anhydride: corrosive, lachrymator', 'Sulfuric acid: severe burns'], ['Lab coat', 'Goggles', 'Nitrile gloves', 'Fume hood'], ['Corrosive', 'Flammable'], 'Add the acid dropwise; work in the hood', 'Aqueous filtrate to the acidic aqueous waste', 'medium')),
      h(2, 'Procedure'),
      block(stepsBlock('Procedure', [
        ['Weigh 2.00 g of salicylic acid into a 50 mL Erlenmeyer flask', OWNER, '2026-02-09T09:40:00'], ['Add 5.0 mL acetic anhydride and 5 drops of concentrated sulfuric acid (fume hood)', OWNER, '2026-02-09T09:48:00'],
        ['Warm in a water bath at 75 °C for 15 min, swirling', OWNER, '2026-02-09T10:05:00'], ['Cool, add 20 mL cold water slowly, then chill in an ice bath', OWNER, '2026-02-09T10:30:00'], ['Filter on a Buchner funnel and wash with cold water', OWNER, '2026-02-09T10:50:00'],
      ])),
      block(timelineBlock('Observations', [['2026-02-09T09:52:00', 'Solid dissolved on warming; faint yellow tint.'], ['2026-02-09T10:22:00', 'White needles started to crystallise on cooling.'], ['2026-02-09T11:10:00', 'Dry crude product: white crystalline solid, 2.12 g.']])),
      h(2, 'Characterisation'),
      block(instrumentBlock({ instrument: 'FTIR (ATR)', method: 'ATR, 32 scans, 4 cm-1', operator: OWNER, started: '2026-02-09T14:15:00', file: spectrum.id, notes: 'No broad phenol O-H near 3200 cm-1: the starting material is consumed.' })),
      p('IR peaks are in the attached file (', link('aspirin-ir-peaks.csv', 'keln-att:' + spectrum.id), '). Melting point of the crude product: 133-136 °C (literature 136 °C).'),
      h(2, 'Yield'), p('The reaction table gives the theoretical yield from the limiting reagent (salicylic acid): 2.61 g. Isolated: 2.12 g, so about 81 %. Losses: transfers and the mother liquor.'),
    ),
  })
  entry(b, 'ASP', {
    title: 'Recrystallisation and melting point', date: '2026-02-10T09:00:00', tags: ['purification'], experiment: synth.experiment,
    content: doc(
      h(2, 'Procedure'), ol(['Dissolve the crude aspirin in the minimum hot ethanol (about 8 mL).'], ['Add warm water until cloudy, reheat to clear, cool slowly.'], ['Filter, wash with ice-cold 1:1 ethanol/water, dry overnight.']),
      block(meas('Melting point', [['Sample', ''], ['Onset', '°C'], ['Clear point', '°C']], [['Crude', '133', '136'], ['Recrystallised', '135', '136.5'], ['Literature', '135', '136']])),
      p('The recrystallised material melts sharply at the literature value. Recovery: 1.78 g from 2.12 g (84 %).'),
    ),
  })
  entry(b, 'ASP', {
    title: 'Ferric chloride test for free phenol', date: '2026-02-10T11:30:00', tags: ['analysis', 'purity'], experiment: synth.experiment,
    content: doc(
      p('Small amount of each solid dissolved in 1 mL ethanol, 2 drops of 1 % FeCl', text_sub('3'), ' added.'),
      block(meas('Colour test', [['Sample', ''], ['Colour', ''], ['Phenol present', '']], [['Salicylic acid (reference)', 'deep violet', 'yes'], ['Crude aspirin', 'pale violet', 'trace'], ['Recrystallised aspirin', 'yellow', 'no']])),
      p('Conclusion: recrystallisation removes the residual salicylic acid.'),
    ),
  })
  edit(b, synth.id, { tags: [...synth.tags, 'yield'] })
  return { title: 'Aspirin synthesis', group: 'Chemistry', description: 'Reaction table with limiting reagent and % yield (2.00 g salicylic acid, 2.61 g theoretical), attached IR peak list.', notebook: b.nb }
}

function text_sub(t: string): PMNode {
  return { type: 'text', text: t, marks: [{ type: 'subscript' }] }
}

// ------------------------------------------------------------------ 2. titration

function titration(): ExampleNotebook {
  const b = newBook({ title: 'Titration lab', description: 'Standardisation of NaOH against KHP, and the acetic acid content of vinegar.', start: '2026-03-02T08:00:00Z', projects: [['TIT', 'Titrations']], prefix: 'TIT' })
  const khpMass = [0.5106, 0.5231, 0.5017]
  const mwKhp = molarMass('KHC8H4O4')!
  const titres = [24.92, 25.55, 24.51]
  const conc = khpMass.map((m, i) => (m / mwKhp) / (titres[i] / 1000))
  const links: EntryLink[] = [{ kind: 'path', target: '/home/user/Documents/kTitration Examples', label: 'kTitration example curves (strong base into weak acid)' }]
  const std = entry(b, 'TIT', {
    title: 'Standardisation of NaOH with potassium hydrogen phthalate', date: '2026-03-02T09:00:00', tags: ['titration', 'standardisation'], links, template: 'titration',
    content: doc(
      h(2, 'Aim'), p('Find the exact concentration of the ~0.1 mol/L NaOH solution with the primary standard KHP (', math('M = ' + f(mwKhp, 2) + '\\ \\mathrm{g/mol}'), ').'),
      h(2, 'Solutions'), block({ kind: 'materials', data: { title: 'Solutions', items: [
        { name: 'NaOH (about 0.1 mol/L)', cas: '1310-73-2', supplier: 'prepared 2026-02-27', lot: '', amount: 'burette', hazard: 'Corrosive' },
        { name: 'Potassium hydrogen phthalate (KHP)', cas: '877-24-7', supplier: 'Merck, primary standard', lot: 'HC27481', amount: '0.5 g per run', hazard: '' },
        { name: 'Phenolphthalein, 1 %', cas: '77-09-8', supplier: '', lot: '', amount: '2 drops', hazard: '' }] } }),
      h(2, 'Results'),
      block(meas('KHP titrations', [['Run', ''], ['m(KHP)', 'g'], ['Titre of NaOH', 'mL'], ['c(NaOH)', 'mol/L']], khpMass.map((m, i) => [String(i + 1), String(m), String(titres[i]), conc[i].toFixed(4)]))),
      p('Each run: ', math('c_{\\mathrm{NaOH}} = \\frac{m_{\\mathrm{KHP}}}{M_{\\mathrm{KHP}}\\,V_{\\mathrm{NaOH}}}'), '. Run 2 used a slightly larger sample. The three results agree to 0.5 %.'),
      block(plot('Concentration by run', 'Run', 'c(NaOH) (mol/L)', ['c'], conc.map((c, i) => [String(i + 1), c.toFixed(4)]), 'scatter')),
      h(2, 'Comparison with the simulator'), p('Open the kTitration examples (link on the right) for the full pH curve of this titration: the equivalence point near pH 8.7 matches the phenolphthalein end point.'),
    ),
  })
  entry(b, 'TIT', {
    title: 'Acetic acid in vinegar', date: '2026-03-04T10:15:00', tags: ['titration', 'assay', 'food'], links,
    content: doc(
      h(2, 'Method'), p('10.00 mL of vinegar diluted to 100.0 mL; 25.00 mL aliquots titrated with the standardised NaOH from ', italic(std.experiment), '.'),
      block(meas('Vinegar aliquots', [['Run', ''], ['Titre', 'mL']], [['1', '17.85'], ['2', '17.90'], ['3', '17.80']])),
      p('Mean titre 17.85 mL → acetic acid ', math('\\approx 4.5\\ \\%\\ (m/V)'), ', matching the label (4.5 %).'),
    ),
  })
  return { title: 'Titration lab (NaOH standardisation)', group: 'Chemistry', description: 'Replicate titres with mean ± sd, calculations with KaTeX maths and a link to the kTitration example files.', notebook: b.nb }
}

// ------------------------------------------------------------------ 3. TGA

function tga(): ExampleNotebook {
  const b = newBook({ title: 'TGA run log', description: 'Thermogravimetric runs on a calcium oxalate monohydrate standard and a polymer filler.', start: '2026-03-10T08:00:00Z', projects: [['TGA', 'Thermal analysis']], prefix: 'TGA' })
  b.nb = addInstrument(b.nb, 'TGA (Netzsch STA 449)')
  const m0 = molarMass('CaC2O4·H2O')!
  const loss = (frag: string): number => (100 * molarMass(frag)!) / m0
  const s1 = sample(b, { name: 'Calcium oxalate monohydrate (standard)', composition: 'CaC2O4·H2O', batch: 'Sigma 21400', location: 'Desiccator 2', made: '2026-03-10', status: 'in use' })
  const s2 = sample(b, { name: 'PE with CaCO3 filler', composition: 'HDPE + 20 wt% CaCO3', batch: 'compounded 2026-03-01', location: 'Shelf B', made: '2026-03-01', status: 'in use' })
  const curve = [[30, 100], [100, 99.8], [150, 88], [250, 87.6], [400, 87.4], [450, 80], [520, 68.2], [600, 68], [700, 55], [780, 38.3], [850, 38.1]]
  const run1 = entry(b, 'TGA', {
    title: 'Calcium oxalate monohydrate, N2, 10 K/min', date: '2026-03-10T10:00:00', tags: ['TGA', 'standard', 'calibration'], samples: [s1.id], template: 'tga-session',
    content: doc(
      h(2, 'Sample'), p('Sample ', mention(s1.id, s1.id), ', 12.34 mg in an alumina crucible (85 µL), empty crucible as reference.'),
      h(2, 'Method'), block(instrumentBlock({ instrument: 'TGA (Netzsch STA 449)', method: 'Dynamic, 10 K/min', operator: OWNER, started: '2026-03-10T10:20:00', parameters: 'N2 50 mL/min protective + 20 mL/min purge; 30 to 850 °C; baseline subtracted' })),
      h(2, 'Mass-loss steps'),
      block(meas('Mass loss vs theory', [['Step', ''], ['T range', '°C'], ['Found', '%'], ['Theory', '%']], [
        ['−H2O', '100-250', '12.3', f(loss('H2O'), 1)], ['−CO', '400-550', '19.1', f(loss('CO'), 1)], ['−CO2', '650-800', '30.0', f(loss('CO2'), 1)], ['Residue CaO', '', '38.3', f(100 - loss('H2O') - loss('CO') - loss('CO2'), 1)],
      ])),
      block(plot('TGA curve, CaC2O4·H2O', 'Temperature (°C)', 'Mass (%)', ['Mass'], curve.map(([t, m]) => [String(t), String(m)]))),
      p('Three well-separated steps as expected: dehydration, CaC', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, 'O', { type: 'text', text: '4', marks: [{ type: 'subscript' }] }, ' → CaCO', { type: 'text', text: '3', marks: [{ type: 'subscript' }] }, ' + CO, and CaCO', { type: 'text', text: '3', marks: [{ type: 'subscript' }] }, ' → CaO + CO', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, '. The balance is within 0.2 % of theory.'),
    ),
  })
  entry(b, 'TGA', {
    title: 'PE with CaCO3 filler: filler content', date: '2026-03-11T14:00:00', tags: ['TGA', 'polymer'], samples: [s2.id], experiment: run1.experiment,
    content: doc(
      p('Sample ', mention(s2.id, s2.id), ', 9.87 mg, air 50 mL/min, 10 K/min to 900 °C.'),
      block(meas('Steps', [['Step', ''], ['T range', '°C'], ['Mass loss', '%']], [['Polymer burn-off', '350-550', '78.9'], ['CaCO3 → CaO + CO2', '620-780', '8.8'], ['Residue', '', '12.3']])),
      p('CO2 loss of 8.8 % corresponds to ', math('8.8 \\times \\frac{100.09}{44.01} = 20.0\\ \\%'), ' CaCO3: the filler content is 20 wt%, as compounded.'),
    ),
  })
  return { title: 'TGA run log (calcium oxalate)', group: 'Measurements', description: 'Instrument-run blocks, mass-loss table checked against theory computed from formulas, a TGA curve, linked samples.', notebook: b.nb }
}

// ------------------------------------------------------------------ 4. XPS with lineage

function xps(): ExampleNotebook {
  const b = newBook({ title: 'XPS measurement sessions', description: 'XPS of a TiO2 film on silicon, as grown, annealed and sputter-cleaned (sample lineage).', start: '2026-03-16T08:00:00Z', projects: [['XPS', 'TiO2 films']], prefix: 'XPS' })
  b.nb = addInstrument(b.nb, 'XPS (Thermo K-Alpha)')
  const wafer = sample(b, { name: 'Si(100) wafer, native oxide', composition: 'Si / SiO2', batch: 'W-2026-02', location: 'Wafer box 3', made: '2026-02-20' })
  const film = sample(b, { name: 'TiO2 film 20 nm (as grown)', composition: 'TiO2', batch: 'ALD run 41', location: 'Box 3 / slot 7', made: '2026-03-02', parents: [wafer.id] })
  const ann = sample(b, { name: 'TiO2 film annealed 400 °C', composition: 'TiO2 (anatase)', batch: 'ALD run 41', location: 'Box 3 / slot 8', made: '2026-03-09', parents: [film.id], notes: 'Air, 2 h, 5 K/min ramp.' })
  const sput = sample(b, { name: 'TiO2 film after Ar+ sputtering', composition: 'TiO2-x', batch: 'ALD run 41', location: 'Box 3 / slot 9', made: '2026-03-16', parents: [film.id], status: 'consumed', notes: 'Etched in the XPS chamber, 1 keV, 60 s.' })
  void ann
  const instr = (started: string, params: string): Block => instrumentBlock({ instrument: 'XPS (Thermo K-Alpha)', method: 'Al Kα monochromated, 400 µm spot', operator: OWNER, started, parameters: params })
  const s1 = entry(b, 'XPS', {
    title: 'As-grown TiO2 film: survey and core levels', date: '2026-03-16T10:00:00', tags: ['XPS', 'TiO2', 'surface'], samples: [film.id], template: 'xps-session',
    content: doc(
      h(2, 'Samples'), p('Measured ', mention(film.id, film.id), ' (from ', mention(wafer.id, wafer.id), '), mounted with carbon tape, flood gun on.'),
      h(2, 'Acquisition'), block(instr('2026-03-16T10:30:00', 'Pass energy 200 eV survey / 50 eV core; charge neutraliser on; C 1s at 284.8 eV')),
      block(meas('Regions', [['Region', ''], ['Centre', 'eV'], ['Peak position', 'eV'], ['FWHM', 'eV'], ['Atomic', '%']], [['Ti 2p3/2', '459', '458.7', '1.1', '22.4'], ['O 1s', '531', '530.0', '1.3', '60.1'], ['C 1s', '285', '284.8', '1.4', '17.5']])),
      p('Ti 2p', { type: 'text', text: '3/2', marks: [{ type: 'subscript' }] }, ' at 458.7 eV with a 5.7 eV spin-orbit splitting is Ti', { type: 'text', text: '4+', marks: [{ type: 'superscript' }] }, ' in TiO', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, '. The O/Ti ratio is 2.7 before cleaning: surface hydroxyl and adventitious oxygen.'),
      block(plot('Ti 2p region (schematic peak list)', 'Binding energy (eV)', 'Intensity (a.u.)', ['Ti 2p'], [['470', '10'], ['466', '12'], ['464.4', '60'], ['462', '15'], ['459', '10'], ['458.7', '100'], ['457', '14'], ['454', '8']], 'line')),
      p('Fit the spectra in KherveFitting; the open document is linked from the instrument block.'),
    ),
  })
  entry(b, 'XPS', {
    title: 'After Ar+ sputter cleaning', date: '2026-03-16T14:30:00', tags: ['XPS', 'depth'], samples: [sput.id], experiment: s1.experiment,
    content: doc(
      p(mention(sput.id, sput.id), ' is the same film after 60 s of 1 keV Ar', { type: 'text', text: '+', marks: [{ type: 'superscript' }] }, ' (derived from ', mention(film.id, film.id), ').'),
      block(instr('2026-03-16T14:50:00', 'Pass energy 50 eV; sputter 1 keV, 60 s')),
      block(meas('Regions', [['Region', ''], ['Peak position', 'eV'], ['Atomic', '%']], [['Ti 2p3/2', '458.6', '30.9'], ['Ti3+ shoulder', '457.2', '3.1'], ['O 1s', '529.9', '61.6'], ['C 1s', '284.8', '4.4']])),
      p('Carbon drops from 17.5 % to 4.4 %, the O/Ti ratio is now 2.0, and a Ti', { type: 'text', text: '3+', marks: [{ type: 'superscript' }] }, ' shoulder appears: preferential oxygen removal by the ion beam.'),
    ),
  })
  entry(b, 'XPS', {
    title: 'Annealed film (400 °C)', date: '2026-03-18T11:00:00', tags: ['XPS', 'anatase'], samples: [ann.id], experiment: s1.experiment,
    content: doc(
      p(mention(ann.id, ann.id), ' measured with the same settings as the as-grown film.'),
      block(meas('Comparison', [['Quantity', ''], ['As grown', ''], ['Annealed', '']], [['Ti 2p3/2 (eV)', '458.7', '458.5'], ['FWHM Ti 2p3/2 (eV)', '1.1', '0.95'], ['C 1s (at%)', '17.5', '9.8']])),
      p('Narrower Ti 2p and less carbon after annealing, consistent with better crystallinity (see the XRD notebook).'),
    ),
  })
  return { title: 'XPS session with sample lineage', group: 'Measurements', description: 'A wafer → film → annealed / sputtered lineage, instrument runs with parameters, core-level tables.', notebook: b.nb }
}

// ------------------------------------------------------------------ 5. pH meter calibration

function calibration(): ExampleNotebook {
  const b = newBook({ title: 'pH meter calibration log', description: 'Weekly two- and three-point calibration of the bench pH meter.', start: '2026-01-05T08:00:00Z', projects: [['CAL', 'Calibrations']], prefix: 'CAL' })
  b.nb = addInstrument(b.nb, 'pH meter (Mettler SevenCompact)')
  const weeks: Array<[string, string[][], string, string]> = [
    ['2026-01-05', [['4.01', '4.02', '98.1', '0.01'], ['7.00', '7.00', '', '0.00'], ['10.01', '10.04', '', '0.03']], '98.1', 'pass'],
    ['2026-01-12', [['4.01', '4.00', '97.6', '-0.01'], ['7.00', '7.01', '', '0.01'], ['10.01', '10.02', '', '0.01']], '97.6', 'pass'],
    ['2026-01-19', [['4.01', '4.08', '95.2', '0.07'], ['7.00', '7.03', '', '0.03'], ['10.01', '10.11', '', '0.10']], '95.2', 'fail: electrode replaced'],
    ['2026-01-26', [['4.01', '4.01', '99.0', '0.00'], ['7.00', '7.00', '', '0.00'], ['10.01', '10.01', '', '0.00']], '99.0', 'pass (new electrode)'],
  ]
  for (const [day, rows, slope, result] of weeks) {
    entry(b, 'CAL', {
      title: `pH meter calibration ${day}`, date: `${day}T08:30:00`, tags: ['calibration', 'pH'], template: 'calibration-log',
      content: doc(
        block(instrumentBlock({ instrument: 'pH meter (Mettler SevenCompact)', method: 'Three-point calibration', operator: OWNER, started: `${day}T08:30:00`, parameters: 'Buffers pH 4.01, 7.00, 10.01 at 25.0 °C; slope ' + slope + ' %' })),
        block(meas('Buffer check', [['Buffer', 'pH'], ['Reading', 'pH'], ['Slope', '%'], ['Deviation', 'pH']], rows)),
        p('Result: ', bold(result), '. Acceptance: slope 95-105 %, deviation ≤ 0.05 pH at pH 4 and 7.'),
        tasks(['Slope within 95-105 %', result.startsWith('pass')], ['Label updated with the next due date', true]),
      ),
    })
  }
  return { title: 'pH meter calibration log', group: 'Measurements', description: 'Four weekly calibration entries from the calibration template, with a failed week and the corrective action.', notebook: b.nb }
}

// ------------------------------------------------------------------ 6. PCR

function pcr(): ExampleNotebook {
  const b = newBook({ title: 'PCR plate set-up and gel', description: 'Amplification of a 612 bp fragment in 12 reactions, checked on an agarose gel.', start: '2026-04-06T08:00:00Z', projects: [['PCR', 'Genotyping']], prefix: 'DNA' })
  b.nb = addInstrument(addInstrument(b.nb, 'Thermal cycler (Bio-Rad T100)'), 'Gel imager')
  const n = 12 * 1.1
  const mix: Array<[string, string, string, number]> = [['Water', '', '', 13.3], ['Buffer', '10×', '1×', 2.5], ['dNTPs', '10 mM', '0.2 mM', 0.5], ['Forward primer', '10 µM', '0.4 µM', 1.0], ['Reverse primer', '10 µM', '0.4 µM', 1.0], ['Polymerase', '5 U/µL', '1 U', 0.2]]
  const setup = entry(b, 'PCR', {
    title: 'PCR set-up: 612 bp amplicon, 12 reactions', date: '2026-04-06T09:30:00', tags: ['PCR', 'genotyping'], template: 'pcr-setup',
    content: doc(
      h(2, 'Target'), p('Exon 4 of the test locus, expected size 612 bp. Primers F4/R4 (Tm 58 °C).'),
      h(2, 'Master mix'),
      block(meas('Master mix, 20 µL reactions (+10 % overage)', [['Component', ''], ['Stock', ''], ['Final', ''], ['Per reaction', 'µL'], [`× ${n.toFixed(1)}`, 'µL']], [
        ...mix.map(([name, stock, final, per]) => [name, stock, final, per.toFixed(1), (per * n).toFixed(1)]), ['Template DNA', '20 ng/µL', '1 ng/µL', '1.0', 'added per well'],
      ])),
      h(2, 'Cycling'),
      block(meas('Thermal cycler programme', [['Step', ''], ['Temperature', '°C'], ['Time', 's'], ['Cycles', '']], [['Initial denaturation', '95', '180', '1'], ['Denaturation', '95', '30', '30'], ['Annealing', '58', '30', ''], ['Extension', '72', '45', ''], ['Final extension', '72', '300', '1']])),
      h(2, 'Plate map'),
      table(['', '1', '2', '3', '4'], [['A', 'NTC', 'positive', 'S1', 'S2'], ['B', 'S3', 'S4', 'S5', 'S6'], ['C', 'S7', 'S8', 'S9', 'S10']]),
      block(stepsBlock('Set-up', [['Thaw reagents on ice, vortex and spin', OWNER, '2026-04-06T09:40:00'], ['Prepare the master mix on ice', OWNER, '2026-04-06T09:55:00'], ['Dispense 19 µL per well, add 1 µL template', OWNER, '2026-04-06T10:15:00'], ['Seal, spin, load cycler', OWNER, '2026-04-06T10:25:00']])),
    ),
  })
  entry(b, 'PCR', {
    title: 'Agarose gel of the PCR products', date: '2026-04-06T13:30:00', tags: ['gel', 'PCR'], experiment: setup.experiment, template: 'gel-electrophoresis',
    content: doc(
      ul([bold('Gel: '), '1.5 % agarose in 1× TAE with SYBR Safe'], [bold('Run: '), '100 V, 45 min'], [bold('Ladder: '), '100 bp, 5 µL']),
      block(instrumentBlock({ instrument: 'Gel imager', method: 'Blue-light transilluminator', operator: OWNER, started: '2026-04-06T14:30:00', notes: 'Exposure 0.5 s' })),
      block(meas('Lanes', [['Lane', ''], ['Sample', ''], ['Band', 'bp']], [['1', 'Ladder', ''], ['2', 'NTC', 'none'], ['3', 'Positive', '612'], ['4', 'S1', '612'], ['5', 'S2', '612'], ['6', 'S3', 'none']])),
      p('S3 failed to amplify (primer-site variant suspected): repeat with the second primer pair.'),
    ),
  })
  return { title: 'PCR plate set-up and gel', group: 'Biology', description: 'Master-mix calculation, cycling programme, plate map and the checking gel.', notebook: b.nb }
}

// ------------------------------------------------------------------ 7. thin films

function thinFilms(): ExampleNotebook {
  const b = newBook({ title: 'Thin-film deposition series', description: 'DC magnetron sputtering of copper films at three powers; one film annealed.', start: '2026-04-20T08:00:00Z', projects: [['TFD', 'Sputtered Cu films']], prefix: 'TF' })
  b.nb = addInstrument(addInstrument(b.nb, 'Sputter coater (AJA)'), 'Profilometer')
  const sub = sample(b, { name: 'Glass slide, cleaned', composition: 'borosilicate glass', batch: 'B-114', location: 'Cleanroom box', made: '2026-04-20' })
  const powers = [100, 200, 300]
  const rate = [0.18, 0.37, 0.55]
  const films = powers.map((w, i) => sample(b, { name: `Cu film ${w} W`, composition: 'Cu', batch: 'run ' + (i + 1), location: 'Slide box A', made: `2026-04-2${i + 1}`, parents: [sub.id] }))
  const ann = sample(b, { name: 'Cu film 200 W annealed', composition: 'Cu', location: 'Slide box A', made: '2026-04-24', parents: [films[1].id], notes: 'Vacuum anneal 300 °C, 1 h.' })
  const runs = films.map((film, i) => entry(b, 'TFD', {
    title: `Cu deposition at ${powers[i]} W`, date: `2026-04-2${i + 1}T10:00:00`, tags: ['sputtering', 'Cu'], samples: [film.id, sub.id], template: 'thin-film',
    content: doc(
      p('Film ', mention(film.id, film.id), ' on ', mention(sub.id, sub.id), '.'),
      block(instrumentBlock({ instrument: 'Sputter coater (AJA)', method: 'DC magnetron, Cu 99.99 % target', operator: OWNER, started: `2026-04-2${i + 1}T10:30:00`, parameters: `Ar 20 sccm, 3 mTorr, ${powers[i]} W, 10 min, room temperature` })),
      block(meas('Parameters and result', [['Power', 'W'], ['Pressure', 'mTorr'], ['Time', 'min'], ['Thickness', 'nm'], ['Rate', 'nm/s']], [[String(powers[i]), '3', '10', String(Math.round(rate[i] * 600)), String(rate[i])]])),
      block(timelineBlock('Observations', [[`2026-04-2${i + 1}T10:35:00`, 'Plasma struck at 20 W, ramped to the set power.'], [`2026-04-2${i + 1}T10:46:00`, 'Shutter closed; film has the usual copper colour.']])),
    ),
  }))
  entry(b, 'TFD', {
    title: 'Thickness vs power and annealing of the 200 W film', date: '2026-04-24T15:00:00', tags: ['profilometry', 'annealing'], samples: [films[0].id, films[1].id, films[2].id, ann.id], experiment: runs[0].experiment,
    content: doc(
      block(instrumentBlock({ instrument: 'Profilometer', method: 'Step height at a scratch', operator: OWNER, started: '2026-04-24T14:00:00', parameters: '2 mg stylus force, 5 scans per film' })),
      block(plot('Deposition rate', 'Power (W)', 'Rate (nm/s)', ['Rate'], powers.map((w, i) => [String(w), String(rate[i])]), 'line')),
      p('The rate is linear in power (', math('R \\approx 1.8\\times 10^{-3}\\,P'), ' nm/s per W). ', mention(ann.id, ann.id), ' was annealed from ', mention(films[1].id, films[1].id), ': sheet resistance fell from 0.42 to 0.31 Ω/sq.'),
    ),
  })
  return { title: 'Thin-film deposition series', group: 'Measurements', description: 'A substrate with three films and an annealed child: lineage tree, deposition parameters, rate plot, label printing.', notebook: b.nb }
}

// ------------------------------------------------------------------ 8. maintenance

function maintenance(): ExampleNotebook {
  const b = newBook({ title: 'Instrument maintenance log', description: 'Service records for the XPS, the analytical balance and the rotary pump.', start: '2026-01-12T08:00:00Z', projects: [['MNT', 'Maintenance']], prefix: 'MNT' })
  b.nb = addInstrument(addInstrument(b.nb, 'XPS (Thermo K-Alpha)'), 'Analytical balance (Sartorius)')
  const mk = (title: string, date: string, name: string, items: string[], parts: string[][], note: string): void => {
    entry(b, 'MNT', {
      title, date, tags: ['maintenance', name.split(' ')[0]], template: 'instrument-maintenance',
      content: doc(
        h(2, 'Instrument'), block(instrumentBlock({ instrument: name, method: 'Scheduled maintenance', operator: OWNER, started: date })),
        h(2, 'Checklist'), block(stepsBlock('Service steps', items.map((t) => [t, OWNER, date] as [string, string, string]))),
        h(2, 'Parts and consumables'), block(meas('Parts replaced', [['Part', ''], ['Lot / serial', ''], ['Quantity', '']], parts)),
        p(note),
      ),
    })
  }
  mk('XPS: annual source and pump service', '2026-01-12T09:00:00', 'XPS (Thermo K-Alpha)', ['Vent the load lock and inspect the seals', 'Replace the rotary pump oil', 'Replace the X-ray source filament', 'Bake the analysis chamber 24 h', 'Run the Au 4f / Ag 3d / Cu 2p calibration'], [['Pump oil', 'L-2290', '1 L'], ['Filament', 'SN 50184', '1']], 'Au 4f7/2 at 84.00 eV, Ag 3d5/2 FWHM 0.52 eV: back in service. Next service due 2027-01.')
  mk('Balance: quarterly adjustment', '2026-02-02T10:00:00', 'Analytical balance (Sartorius)', ['Level the balance', 'Internal adjustment', 'Check 1 g, 10 g, 100 g reference masses'], [['Reference mass set', 'E2-2231', '3']], 'All three reference masses within 0.1 mg. Next check due 2026-05.')
  mk('Rotary pump: oil change', '2026-03-23T14:00:00', 'XPS (Thermo K-Alpha)', ['Switch off and cool the pump', 'Drain and flush', 'Refill with new oil', 'Leak check'], [['Pump oil', 'L-2301', '0.7 L']], 'The old oil was dark: shorten the interval to 6 months.')
  return { title: 'Instrument maintenance log', group: 'Lab management', description: 'Maintenance template filled in three times: checklists with who/when ticks and parts replaced.', notebook: b.nb }
}

// ------------------------------------------------------------------ 9. meeting actions

function meetings(): ExampleNotebook {
  const b = newBook({ title: 'Group meeting action list', description: 'Weekly group meetings: decisions and who does what by when.', start: '2026-05-04T08:00:00Z', projects: [['GRP', 'Group meetings']], prefix: 'GRP' })
  const m1 = entry(b, 'GRP', {
    title: 'Group meeting 4 May', date: '2026-05-04T10:00:00', tags: ['meeting'], template: 'meeting-actions',
    content: doc(
      h(2, 'Attendees'), p('Ana Martin, Ben Okafor, Chen Wei, Dara Singh.'),
      h(2, 'Discussion'), ul(['XPS beam time in June: 3 days booked.'], ['TiO2 films: annealing study results look good.'], ['Safety walk-round next week.']),
      h(2, 'Decisions'), ul(['Prepare six more films for the June beam time.'], ['Move to the new label scheme for samples.']),
      h(2, 'Actions'), block(meas('Actions', [['Action', ''], ['Owner', ''], ['Due', ''], ['Done', '']], [['Prepare six TiO2 films', 'Ana', '2026-05-20', ''], ['Order Ar+ sputter gun filament', 'Ben', '2026-05-08', 'yes'], ['Write the safety checklist', 'Chen', '2026-05-11', ''], ['Book the PCR room', 'Dara', '2026-05-06', 'yes']])),
      tasks(['Send the minutes', true], ['Add actions to the calendar', false]),
    ),
  })
  entry(b, 'GRP', {
    title: 'Group meeting 11 May', date: '2026-05-11T10:00:00', tags: ['meeting'], experiment: m1.experiment,
    content: doc(
      h(2, 'Follow-up'), tasks(['Ar+ gun filament ordered', true], ['Safety checklist drafted', true], ['Six films prepared', false]),
      h(2, 'New actions'), block(meas('Actions', [['Action', ''], ['Owner', ''], ['Due', ''], ['Done', '']], [['Review the safety checklist', 'Ana', '2026-05-15', ''], ['Calibrate the pipettes', 'Dara', '2026-05-18', '']])),
    ),
  })
  return { title: 'Group meeting action list', group: 'Lab management', description: 'Meeting notes with a checklist and an action table (owner, due date, done).', notebook: b.nb }
}

// ------------------------------------------------------------------ 10. cell culture

function cellCulture(): ExampleNotebook {
  const b = newBook({ title: 'Cell culture passages', description: 'Maintenance of HEK293 cells: passage records, observations and contamination checks.', start: '2026-05-18T08:00:00Z', projects: [['CELL', 'HEK293 culture']], prefix: 'CELL' })
  b.nb = addInstrument(b.nb, 'Inverted microscope')
  const pass = (n: number, day: string, conf: number, ratio: string, note: string): void => {
    entry(b, 'CELL', {
      title: `HEK293 passage ${n}`, date: `${day}T09:30:00`, tags: ['cell culture', 'HEK293'], template: 'cell-culture',
      content: doc(
        block(meas('Cell line', [['Cell line', ''], ['Passage', ''], ['Confluence', '%'], ['Viability', '%'], ['Split ratio', '']], [['HEK293', String(n), String(conf), '96', ratio]])),
        block(stepsBlock('Passage', [['Check morphology and contamination', OWNER, `${day}T09:40:00`], ['Wash with PBS', OWNER, `${day}T09:50:00`], ['Trypsinise 3 min and neutralise', OWNER, `${day}T09:55:00`], ['Count and seed', OWNER, `${day}T10:15:00`]])),
        block(timelineBlock('Observations', [[`${day}T09:35:00`, note]])),
      ),
    })
  }
  pass(14, '2026-05-18', 85, '1:6', 'Healthy, adherent, no contamination.')
  pass(15, '2026-05-21', 90, '1:8', 'Slight clumping; media changed.')
  pass(16, '2026-05-25', 80, '1:6', 'Healthy.')
  return { title: 'Cell culture passages', group: 'Biology', description: 'Three passages from the cell-culture template with steps, counts and observations.', notebook: b.nb }
}

// ------------------------------------------------------------------ 11. reagents and solutions

function solutions(): ExampleNotebook {
  const b = newBook({ title: 'Reagents and solutions', description: 'Chemical inventory (CAS, supplier, hazard), solution preparations and a risk assessment.', start: '2026-02-23T08:00:00Z', projects: [['SOL', 'Solutions']], prefix: 'SOL' })
  const items: Array<[string, string, string, number | null, string, string, string, string]> = [
    ['Sodium hydroxide, pellets', 'NaOH', '1310-73-2', null, 'Merck', 'Corrosive: severe skin burns', 'Base cabinet', '1 kg'], ['Hydrochloric acid, 37 %', 'HCl', '7647-01-0', 1.19, 'VWR', 'Corrosive; respiratory irritant', 'Acid cabinet', '2.5 L'],
    ['Potassium hydrogen phthalate', 'KHC8H4O4', '877-24-7', null, 'Merck', '', 'Shelf C1', '250 g'], ['Sodium chloride', 'NaCl', '7647-14-5', null, 'Sigma-Aldrich', '', 'Shelf C2', '1 kg'],
    ['Ethanol, absolute', 'C2H6O', '64-17-5', 0.789, 'VWR', 'Highly flammable', 'Flammables cabinet', '2.5 L'], ['Acetone', 'C3H6O', '67-64-1', 0.791, 'VWR', 'Highly flammable; eye irritation', 'Flammables cabinet', '2.5 L'],
    ['Tris base', 'C4H11NO3', '77-86-1', null, 'Sigma-Aldrich', 'Irritant', 'Shelf C3', '500 g'], ['Copper(II) sulfate pentahydrate', 'CuSO4·5H2O', '7758-99-8', null, 'Merck', 'Harmful; very toxic to aquatic life', 'Shelf D1', '500 g'],
    ['Toluene', 'C7H8', '108-88-3', 0.867, 'Fisher', 'Flammable; reproductive toxicity; aspiration hazard', 'Flammables cabinet', '1 L'], ['Silver nitrate', 'AgNO3', '7761-88-8', null, 'Sigma-Aldrich', 'Oxidiser; corrosive; very toxic to aquatic life', 'Locked cabinet', '25 g'],
  ]
  items.forEach(([name, formula, cas, density, supplier, hazard, location, amount], i) => {
    b.nb = upsertInventory(b.nb, { id: `inv-${String(i + 1).padStart(3, '0')}`, name, formula, cas, mw: null, density, supplier, lot: '', amount, hazard, location })
  })
  const mNaOH = 0.1 * 0.5 * molarMass('NaOH')!
  entry(b, 'SOL', {
    title: '0.1 mol/L NaOH, 500 mL', date: '2026-02-23T09:15:00', tags: ['solution', 'base'], template: 'solution-prep',
    content: doc(
      h(2, 'Target'), p('500 mL of 0.1 mol/L NaOH: ', math('m = c\\,V\\,M = 0.1 \\times 0.500 \\times ' + f(molarMass('NaOH')!, 2) + ' = ' + f(mNaOH, 3) + '\\ \\mathrm{g}'), '.'),
      block({ kind: 'materials', data: { title: 'Materials', items: [{ name: 'Sodium hydroxide, pellets', cas: '1310-73-2', supplier: 'Merck', lot: '', amount: f(mNaOH, 2) + ' g', hazard: 'Corrosive' }, { name: 'Water, deionised', cas: '7732-18-5', supplier: '', lot: '', amount: 'to 500 mL', hazard: '' }] } }),
      block(stepsBlock('Preparation', [['Weigh 2.00 g NaOH quickly (hygroscopic)', OWNER, '2026-02-23T09:25:00'], ['Dissolve in about 400 mL boiled, cooled water', OWNER, '2026-02-23T09:35:00'], ['Make up to 500 mL, mix, store in a PE bottle', OWNER, '2026-02-23T09:50:00']])),
      p('Standardise against KHP before use (see the titration notebook); the true concentration is typically 0.098 mol/L because NaOH absorbs CO', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, ' and water.'),
    ),
  })
  entry(b, 'SOL', {
    title: 'Risk assessment: working with silver nitrate and toluene', date: '2026-02-24T11:00:00', tags: ['risk', 'safety'], template: 'risk-assessment',
    content: doc(
      h(2, 'Activity'), p('Preparation of 0.01 mol/L AgNO', { type: 'text', text: '3', marks: [{ type: 'subscript' }] }, ' for argentometric titration; toluene used for rinsing glassware.'),
      block(safetyBlock(['AgNO3: oxidiser, corrosive, stains skin', 'Toluene: flammable, reproductive toxicity'], ['Lab coat', 'Goggles', 'Nitrile gloves', 'Fume hood'], ['Oxidising', 'Corrosive', 'Flammable', 'Health hazard', 'Environmental hazard'], 'Weigh AgNO3 over a tray; toluene only in the hood, away from ignition sources', 'Silver waste in the heavy-metal bottle; toluene in the halogen-free organic waste', 'medium')),
      block(meas('Risk matrix', [['Hazard', ''], ['Likelihood (1-5)', ''], ['Severity (1-5)', ''], ['Risk', ''], ['Control', '']], [['Skin contact with AgNO3', '2', '2', '4', 'gloves, tray'], ['Toluene vapour', '2', '3', '6', 'fume hood'], ['Silver waste in drain', '1', '4', '4', 'collection bottle']])),
      tasks(['Reviewed by the supervisor', true], ['Reviewed by the safety officer', false]),
    ),
  })
  return { title: 'Reagents and solutions', group: 'Chemistry', description: 'A ten-line chemical inventory that feeds the reaction table, a solution preparation and a risk assessment.', notebook: b.nb }
}

// ------------------------------------------------------------------ 12. audit chain demo

function auditDemo(): ExampleNotebook {
  const b = newBook({ title: 'Audit chain demo', description: 'Shows signing, witnessing and amending. Use Notebook > Verify notebook to recompute the SHA-256 chain.', start: '2026-06-01T08:00:00Z', projects: [['DEM', 'Demonstration']], prefix: 'DEM' })
  b.nb = addInstrument(b.nb, 'pH meter (Mettler SevenCompact)')
  const buffer = entry(b, 'DEM', {
    title: 'Preparation of 50 mmol/L phosphate buffer, pH 7.4', date: '2026-06-01T09:00:00', tags: ['buffer', 'signed'],
    content: doc(
      h(2, 'Procedure'), p('Dissolved 0.69 g NaH', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, 'PO', { type: 'text', text: '4', marks: [{ type: 'subscript' }] }, ' and 3.55 g Na', { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, 'HPO', { type: 'text', text: '4', marks: [{ type: 'subscript' }] }, ' in 900 mL water, adjusted to pH with HCl, made up to 1 L.'),
      block(instrumentBlock({ instrument: 'pH meter (Mettler SevenCompact)', method: 'Calibrated at pH 4.01 / 7.00 / 10.01 the same morning', operator: OWNER, started: '2026-06-01T09:20:00' })),
      block(meas('pH check', [['Reading', 'pH']], [['7.83'], ['7.84'], ['7.83']])),
    ),
  })
  edit(b, buffer.id, { title: 'Preparation of 50 mmol/L phosphate buffer, pH 7.4' })
  sign(b, buffer.id, WITNESS)
  b.nb = amendEntry(b.nb, buffer.id, doc(p('Correction: the pH readings were mistyped. The correct readings are ', bold('7.38, 7.39, 7.38'), ' (digits transposed); the buffer is at the target pH 7.4. The signed text above is left as written.')), 'Transposed digits in the pH readings', b.ctx)
  const crystal = entry(b, 'DEM', {
    title: 'Crystal growth of CuSO4 from solution', date: '2026-06-02T10:00:00', tags: ['crystals', 'signed'],
    content: doc(p('Saturated CuSO', { type: 'text', text: '4', marks: [{ type: 'subscript' }] }, ' solution at 40 °C cooled slowly to room temperature over 48 h. Blue triclinic crystals up to 6 mm.'), block(timelineBlock('Observations', [['2026-06-02T10:30:00', 'Seed crystal added.'], ['2026-06-03T10:30:00', 'Crystals visible, 2 mm.'], ['2026-06-04T10:30:00', 'Harvested; 6 mm largest.']]))),
  })
  sign(b, crystal.id)
  b.nb = logExport(b.nb, crystal.id, 'PDF', b.ctx)
  entry(b, 'DEM', { title: 'Next experiment (draft)', date: '2026-06-05T09:00:00', tags: ['draft'], content: doc(h(2, 'Plan'), p('Draft entries can be edited freely; the audit log records the edits but the entry is not signed.')) })
  return { title: 'Audit chain demo (signed, witnessed, amended)', group: 'Integrity', description: 'One entry signed, witnessed and amended; one signed; one draft. Verify notebook confirms the chain.', notebook: b.nb }
}

/** The same notebook with one audit record changed after the fact (a back-dated signature). Verify flags exactly that record. */
export function tamperedCopy(nb: Notebook): { notebook: Notebook; seq: number } {
  const copy = JSON.parse(JSON.stringify(nb)) as Notebook
  const i = copy.audit.findIndex((r, k) => r.action === 'entry-signed' && copy.audit.slice(0, k).filter((x) => x.action === 'entry-signed').length === 1)
  copy.audit[i] = { ...copy.audit[i], time: '2026-05-30T08:00:00.000Z', user: 'Mallory' }
  copy.title = 'Tamper demo'
  copy.description = 'A copy of the audit demo in which the record of a signature was altered after the fact (time and user changed). Verify notebook flags that exact record.'
  return { notebook: copy, seq: i + 1 }
}

function tamperDemo(): ExampleNotebook {
  const { notebook } = tamperedCopy(auditDemo().notebook)
  return { title: 'Tamper demo (one altered record)', group: 'Integrity', description: 'Deliberately altered: Verify notebook reports the exact audit record that no longer matches.', notebook }
}

export function exampleNotebooks(): ExampleNotebook[] {
  return [aspirin(), titration(), tga(), xps(), calibration(), pcr(), thinFilms(), maintenance(), meetings(), cellCulture(), solutions(), auditDemo(), tamperDemo()]
}
