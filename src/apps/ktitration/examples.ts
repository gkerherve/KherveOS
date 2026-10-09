// The built-in examples of kTitration (pure data → Project). Each one is a real .ktitr project: the tests load
// every one and check the documented numbers; tools/export_ktitration_examples.ts writes them to
// public/examples/ktitration/. The measured-data examples are synthetic (a model plus noise from a fixed seed)
// and say so.

import { prepare, type AcidBaseSpec, type Item } from './acidbase.ts'
import { METAL_INDICATORS } from './data/indicators.ts'
import { pkaById, systemOf, type PkaEntry } from './data/pka.ts'
import { gaussian, rng } from './format.ts'
import { DEFAULT_FIT_SETUP, setupForKind } from './fit.ts'
import {
  edtaMetal, newProject, redoxCouple, strongItem, weakFrom, type Project, type TabId,
} from './project.ts'

export interface Example {
  id: string
  title: string
  group: string
  description: string
  project: Project
}

const entry = (id: string): PkaEntry => {
  const e = pkaById(id)
  if (!e) throw new Error(`pKa entry ${id} missing`)
  return e
}

type AB = Partial<AcidBaseSpec> & { items: Item[] }

function acidBase(id: string, title: string, group: string, description: string, ab: AB, tab: TabId = 'titration'): Example {
  const p = newProject()
  p.name = title
  p.description = description
  p.mode = 'acidbase'
  p.tab = tab
  p.acidbase = { ...p.acidbase, water: 0, vmax: null, ...ab }
  return { id, title, group, description, project: p }
}

const NaOH = (conc = 0.1) => ({ kind: 'strong-base' as const, label: 'NaOH', conc })
const HCl = (conc = 0.1) => ({ kind: 'strong-acid' as const, label: 'HCl', conc })

/** Measured-looking data: the model's pH plus Gaussian noise (σ in pH units), V rounded to 0.01 mL, pH to 0.001. */
export function syntheticData(spec: AcidBaseSpec, volumes: number[], sigma: number, seed: number): string {
  const rand = gaussian(rng(seed))
  const p = prepare(spec)
  return volumes.map((v) => `${v.toFixed(2)}\t${(p.ph(v) + sigma * rand()).toFixed(3)}`).join('\n') + '\n'
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = []
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

function syntheticAcetic(): Example {
  const spec: AcidBaseSpec = { items: [weakFrom(entry('acetic'), 0, 0.098, 25)], water: 25, titrant: NaOH(0.1), temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null }
  const vols = [...range(0, 20, 2), ...range(21, 23, 1), ...range(23.5, 25.5, 0.5), 26, 27, 28, 30, 32, 35]
  const p = newProject()
  p.name = 'Analyse these experimental data'
  p.description =
    'SYNTHETIC data, not a real experiment: acetic acid of unknown concentration (25.00 mL + 25 mL water) titrated with 0.1000 M NaOH, generated from the exact model plus 0.010 pH noise. Find the equivalence volume, the concentration and the pKa with the derivative, the Gran plot and the full fit.'
  p.mode = 'acidbase'
  p.tab = 'analyse'
  p.analyse = {
    text: syntheticData(spec, vols, 0.01, 7), gran: 'weak', source: 'synthetic: true values C = 0.0980 M, pKa = 4.76', view: 'fit',
    setup: { ...setupForKind('acid', 1, DEFAULT_FIT_SETUP), aliquot: 25, V0: 50, Ct: 0.1, pKa: [{ value: 4.7, fit: true }] },
  }
  p.acidbase = { ...spec, indicator: 'phenolphthalein' }
  return { id: 'data-acetic', title: 'Analyse data: acetic acid (synthetic)', group: 'Data analysis', description: p.description, project: p }
}

function syntheticGran(): Example {
  const spec: AcidBaseSpec = { items: [strongItem('strong-acid', 'HCl', 0.0872, 25)], water: 25, titrant: NaOH(0.1), temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null }
  const vols = [...range(0, 18, 3), ...range(19, 21, 0.5), 21.5, 22, 22.5, 23, 23.5, 24, 25, 26, 28, 30]
  const p = newProject()
  p.name = 'Gran plot'
  p.description =
    'SYNTHETIC data, not a real experiment: hydrochloric acid of unknown concentration (25.00 mL + 25 mL water) with 0.1000 M NaOH, 0.010 pH noise. The Gran plot straightens the curve on both sides of the equivalence point and finds it from the points far from the jump, where the pH is most reliable.'
  p.mode = 'acidbase'
  p.tab = 'analyse'
  p.analyse = {
    text: syntheticData(spec, vols, 0.01, 11), gran: 'strong', source: 'synthetic: true value C = 0.0872 M, equivalence 21.80 mL', view: 'gran',
    setup: { ...setupForKind('acid', 1, DEFAULT_FIT_SETUP), aliquot: 25, V0: 50, Ct: 0.1 },
  }
  p.acidbase = { ...spec, indicator: 'bromothymolblue' }
  return { id: 'gran-plot', title: 'Gran plot: strong acid (synthetic)', group: 'Data analysis', description: p.description, project: p }
}

function syntheticCarbonate(): Example {
  const spec: AcidBaseSpec = { items: [weakFrom(entry('carbonic'), 2, 0.05, 25)], water: 25, titrant: HCl(0.1), temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null }
  const vols = [...range(0, 10, 2), ...range(11, 13.5, 0.5), 14, 15, 17, 20, 23, 24, 24.5, 25, 25.5, 26, 27, 28, 30, 32, 35, 38]
  const p = newProject()
  p.name = 'Analyse a diprotic base'
  p.description =
    'SYNTHETIC data, not a real experiment: sodium carbonate of unknown concentration (25.00 mL + 25 mL water) with 0.1000 M HCl, 0.015 pH noise. Two equivalence points; the fit finds both pKa values and the concentration.'
  p.mode = 'acidbase'
  p.tab = 'analyse'
  p.analyse = {
    text: syntheticData(spec, vols, 0.015, 21), gran: 'weak', source: 'synthetic: true values C = 0.0500 M, pKa 6.35 and 10.33', view: 'fit',
    setup: { ...setupForKind('anion', 2, { ...DEFAULT_FIT_SETUP, aliquot: 25, V0: 50, Ct: 0.1 }), pKa: [{ value: 6, fit: true }, { value: 10, fit: true }] },
  }
  p.acidbase = { ...spec, indicator: 'methylorange' }
  return { id: 'data-carbonate', title: 'Analyse data: sodium carbonate (synthetic)', group: 'Data analysis', description: p.description, project: p }
}

export const EXAMPLES: readonly Example[] = [
  // ----------------------------------------------------------------------------------------------- acid–base basics
  acidBase('hcl-naoh', 'HCl with NaOH', 'Acid-base basics',
    'The strong–strong titration: 25.00 mL of 0.1000 M HCl with 0.1000 M NaOH. The pH starts at 1.00, the equivalence point is at 25.00 mL and pH 7.00, and the jump covers pH 4–10, so almost any indicator will do. Bromothymol blue is drawn.',
    { items: [strongItem('strong-acid', 'HCl', 0.1, 25)], titrant: NaOH(), indicator: 'bromothymolblue' }),
  acidBase('acetic-naoh', 'Acetic acid with NaOH', 'Acid-base basics',
    'A weak acid, pKa 4.76: 25.00 mL of 0.1000 M acetic acid with 0.1000 M NaOH. At the half-equivalence point (12.50 mL) the pH equals the pKa. The equivalence point is basic (pH 8.73), so phenolphthalein is right and methyl orange is not.',
    { items: [weakFrom(entry('acetic'), 0, 0.1, 25)], titrant: NaOH(), indicator: 'phenolphthalein' }),
  acidBase('ammonia-hcl', 'Ammonia with HCl', 'Acid-base basics',
    'A weak base: 25.00 mL of 0.1000 M ammonia with 0.1000 M HCl. The ammonium ion is a weak acid (pKa 9.25), so the equivalence point is acidic (pH 5.28) and methyl red is the indicator.',
    { items: [weakFrom(entry('ammonia'), 1, 0.1, 25)], titrant: HCl(), indicator: 'methylred' }),
  acidBase('weak-weak', 'Acetic acid with ammonia', 'Acid-base basics',
    'A weak acid titrated with a weak base has no sharp jump: the pH changes by less than 2 units around the equivalence point and no indicator gives a good end point. This is why strong titrants are used.',
    { items: [weakFrom(entry('acetic'), 0, 0.1, 25)], titrant: { kind: 'weak-base', label: 'NH₃', conc: 0.1, pKa: [9.25], z0: 1, form: 1 }, indicator: 'bromothymolblue' }),
  acidBase('mixture-hcl-acetic', 'Mixture: HCl and acetic acid', 'Acid-base basics',
    'A strong and a weak acid together, 12.50 mL of each at 0.1000 M, with 0.1000 M NaOH. The strong acid is titrated first (equivalence at 12.50 mL, pH about 3.1), then acetic acid (25.00 mL, pH 8.58). The first step is only a shoulder: acetic acid (pKa 4.76) is too strong to leave a sharp jump after the HCl. The best indicator for the first end point still errs by about 3 % (methyl orange 8 %); phenolphthalein gives the total of both acids.',
    { items: [strongItem('strong-acid', 'HCl', 0.1, 12.5), weakFrom(entry('acetic'), 0, 0.1, 12.5)], titrant: NaOH(), indicator: 'phenolphthalein' }),
  acidBase('mixture-hcl-nh4', 'Mixture: HCl and ammonium chloride', 'Acid-base basics',
    'A strong acid and a weak acid that is much weaker, 12.50 mL of each at 0.1000 M, with 0.1000 M NaOH: now both steps are sharp. HCl is neutralised first (12.50 mL, pH 5.4, methyl red), then NH₄⁺ (25.00 mL, pH 10.8): the second jump is weak because ammonium is a weak acid, and only alizarin yellow R comes within 2 %.',
    { items: [strongItem('strong-acid', 'HCl', 0.1, 12.5), weakFrom(entry('ammonia'), 0, 0.1, 12.5)], titrant: NaOH(), indicator: 'methylred' }),
  // ----------------------------------------------------------------------------------------------- polyprotic
  acidBase('carbonate-hcl', 'Sodium carbonate with HCl', 'Polyprotic and mixtures',
    '25.00 mL of 0.0500 M Na₂CO₃ with 0.1000 M HCl. Carbonate is protonated to hydrogencarbonate (first equivalence point, 12.50 mL, pH 8.3: a gentle bend that phenolphthalein shows only roughly) and then to carbonic acid (second, 25.00 mL, pH 4.0: sharper, methyl orange). Between them bicarbonate is the main species.',
    { items: [weakFrom(entry('carbonic'), 2, 0.05, 25)], titrant: HCl(), indicator: 'methylorange' }),
  acidBase('phosphoric-naoh', 'Phosphoric acid with NaOH', 'Polyprotic and mixtures',
    'Three pKa values (2.15, 7.20, 12.35), two usable jumps. 25.00 mL of 0.1000 M H₃PO₄ with 0.1000 M NaOH: the first equivalence point (25 mL) is at pH ≈ (pKa1 + pKa2)/2 = 4.7, the second (50 mL) at ≈ (pKa2 + pKa3)/2 = 9.8 (9.7 exactly). The third proton cannot be titrated in water (pKa 12.35).',
    { items: [weakFrom(entry('phosphoric'), 0, 0.1, 25)], titrant: NaOH(), indicator: 'thymolphthalein' }),
  acidBase('citric-naoh', 'Citric acid with NaOH', 'Polyprotic and mixtures',
    'Citric acid has three pKa values close together (3.13, 4.76, 6.40), so the steps overlap and the curve has one broad rise with a single clear jump at the third equivalence point (75 mL for 25.00 mL of 0.1000 M acid with 0.1000 M NaOH). Used to buffer between pH 2.5 and 7.5.',
    { items: [weakFrom(entry('citric'), 0, 0.1, 25)], titrant: NaOH(), indicator: 'phenolphthalein' }),
  acidBase('oxalic-naoh', 'Oxalic acid with NaOH', 'Polyprotic and mixtures',
    'Oxalic acid, pKa 1.25 and 4.27, 25.00 mL of 0.0500 M with 0.1000 M NaOH. The two steps are close (ΔpKa 3.0), so the first jump is weak and only the total (25.00 mL) is sharp: titrate to the second end point with phenolphthalein.',
    { items: [weakFrom(entry('oxalic'), 0, 0.05, 25)], titrant: NaOH(), indicator: 'phenolphthalein' }),
  acidBase('edta-protonation', 'EDTA protonation (H₄Y with NaOH)', 'Polyprotic and mixtures',
    'The free acid H₄Y (pKa 2.00, 2.69, 6.13, 10.37) with 0.1000 M NaOH. The first two protons are lost together (pKa values only 0.7 apart), then one at pH 6.1 and the last at 10.4: this is why EDTA titrations need a buffer. The species Y⁴⁻, which binds metals, is only 30 % of the EDTA at pH 10.',
    { items: [weakFrom(entry('edta'), 2, 0.01, 25)], titrant: NaOH(), indicator: 'mcresolpurple' }),
  // ----------------------------------------------------------------------------------------------- amino acids
  acidBase('glycine-naoh', 'Glycine hydrochloride with NaOH', 'Amino acids',
    'The amino acid glycine as its hydrochloride (H₂Gly⁺) with NaOH: pKa 2.34 (carboxyl) and 9.60 (ammonium). The zwitterion Gly± dominates between them and the isoelectric point is (2.34 + 9.60)/2 = 5.97, almost exactly the pH at the first equivalence point (5.99). The second equivalence point (50 mL, pH 11.05) is a weak jump: the amino group is hard to titrate sharply.',
    { items: [weakFrom(entry('glycine'), 0, 0.1, 25)], titrant: NaOH(), indicator: 'bromocresolpurple' }, 'speciation'),
  acidBase('histidine-naoh', 'Histidine dihydrochloride with NaOH', 'Amino acids',
    'Histidine as H₃His²⁺ (pKa 1.82 carboxyl, 6.00 imidazole, 9.17 amino) with NaOH: three equivalence points at 25, 50 and 75 mL. The imidazole group is the one that buffers near physiological pH; the isoelectric point is (6.00 + 9.17)/2 = 7.59.',
    { items: [weakFrom(entry('histidine'), 0, 0.1, 25)], titrant: NaOH(), indicator: null }),
  // ----------------------------------------------------------------------------------------------- real samples
  acidBase('vinegar', 'Vinegar analysis', 'Real samples',
    'Acetic acid in vinegar: 5.00 mL of vinegar (about 5 % w/v, 0.83 M) diluted with 45 mL water and titrated with 0.5000 M NaOH, phenolphthalein. The equivalence volume (8.3 mL) gives the concentration: c = V·c_NaOH/5.00 mL. Check the error of the indicator in the Indicator chooser.',
    { items: [weakFrom(entry('acetic'), 0, 0.8333, 5)], water: 45, titrant: NaOH(0.5), indicator: 'phenolphthalein' }),
  acidBase('antacid-back', 'Antacid: back titration', 'Real samples',
    'An antacid tablet (0.5000 g CaCO₃) is dissolved in 25.00 mL of 0.5000 M HCl (12.50 mmol, 9.991 mmol used up), the CO₂ is boiled off, and the 2.509 mmol of excess acid is titrated with 0.1000 M NaOH (25.09 mL). Then mmol CaCO₃ = (mmol HCl − mmol NaOH)/2 and the mass is that times 100.09 mg/mmol.',
    { items: [strongItem('strong-acid', 'HCl left after boiling', 2.509 / 50, 50)], titrant: NaOH(), indicator: 'methylred' }),
  acidBase('boric-mannitol', 'Boric acid with mannitol', 'Real samples',
    'Boric acid is too weak to titrate (pKa 9.24), but mannitol forms a much stronger acid complex with it (apparent pKa about 5 with excess mannitol): 25.00 mL of 0.1000 M boric acid plus mannitol titrates sharply with NaOH to a phenolphthalein end point. The apparent pKa used here is 5.15 and depends on the mannitol concentration.',
    { items: [{ kind: 'weak', label: 'Boric acid + mannitol (apparent)', pKa: [5.15], z0: 0, form: 0, conc: 0.1, volume: 25 }], titrant: NaOH(), indicator: 'phenolphthalein' }),
  acidBase('tris-hcl-37', 'Tris buffer with HCl at 37 °C', 'Real samples',
    'Tris base (0.0500 M, 25.00 mL) with 0.1000 M HCl at 37 °C. The pKa of Tris falls 0.028 per degree: 8.07 at 25 °C but 7.73 at 37 °C, and Kw changes too. Change the temperature in the setup to see the curve move.',
    { items: [weakFrom(entry('tris'), 1, 0.05, 25)], titrant: HCl(), temperature: 37, indicator: null }),
  // ----------------------------------------------------------------------------------------------- complexometric
  edtaExample('edta-hard-water', 'Hard water: Ca²⁺ with EDTA', 'Complexometric',
    'Calcium in hard water: 100.0 mL (120 mg Ca per litre, 3.00 mM) with 0.01000 M EDTA at pH 10 (ammonia buffer). The conditional constant K′ = K_f·α(Y⁴⁻) is 10^10.1 and the equivalence point is at 30.00 mL. Eriochrome Black T binds calcium weakly (log K′ 3.8 at pH 10), so its colour changes about 7 % early: see the error in the results; the magnesium example shows a good end point.',
    'ca', { conc: 0.003, volume: 100, ammonia: 0 }),
  edtaExample('edta-mg', 'Magnesium with EDTA and EBT', 'Complexometric',
    'Magnesium (3.00 mM, 100.0 mL) with 0.01000 M EDTA at pH 10. Eriochrome Black T binds Mg strongly (log K′ ≈ 5.4 at this pH), so the red-to-blue change falls within the jump: the textbook hardness titration. The equivalence point is at 30.00 mL.',
    'mg', { conc: 0.003, volume: 100, ammonia: 0 }),
  edtaExample('edta-zn-ammonia', 'Zinc with EDTA in ammonia buffer', 'Complexometric',
    'Zinc (1.00 mM, 50.0 mL) with 0.01000 M EDTA in 0.10 M ammonia buffer at pH 10. Ammonia holds zinc as Zn(NH₃)ₙ²⁺: α(Zn) ≈ 10^4.8 (hydroxide alone gives 10^2.1), which lowers the conditional constant by 2.7 orders of magnitude and shortens the jump compared with the same pH without ammonia.',
    'zn', { conc: 0.001, volume: 50, ammonia: 0.1 }),
  // ----------------------------------------------------------------------------------------------- redox
  redoxExample('fe-ce', 'Fe²⁺ with Ce⁴⁺', 'Redox',
    'The classic redox titration: 25.00 mL of 0.0500 M Fe²⁺ with 0.1000 M Ce⁴⁺ in 1 M H₂SO₄ (formal potentials 0.68 and 1.44 V). Equivalence at 12.50 mL; at that point E is the mean of the two formal potentials, 1.06 V, which is the transition potential of ferroin.',
    { couple: redoxCouple('fe3', 0.68), start: 'red', conc: 0.05, volume: 25 }, { couple: redoxCouple('ce4', 1.44), conc: 0.1 }, 0, 'ferroin'),
  redoxExample('fe-mno4', 'Fe²⁺ with permanganate', 'Redox',
    'Iron(II) (0.0500 M, 25.00 mL) with 0.02000 M KMnO₄ in strong acid (pH 0). The equivalence potential is (E°(Fe) + 5E°(MnO₄⁻))/6 = 1.38 V, closer to the permanganate couple because it takes five electrons. Permanganate is its own indicator. Change the pH to see the equivalence potential fall by 0.079 V per pH unit (the permanganate couple consumes eight H⁺).',
    { couple: redoxCouple('fe3'), start: 'red', conc: 0.05, volume: 25 }, { couple: redoxCouple('mno4'), conc: 0.02 }, 0, 'permanganate'),
  redoxExample('fe-dichromate', 'Fe²⁺ with dichromate', 'Redox',
    'Iron(II) (0.0600 M, 25.00 mL) with 0.01667 M K₂Cr₂O₇ (a primary standard, six electrons per dichromate). Diphenylamine sulfonate is the indicator; it needs phosphoric acid in practice so that its colour change falls inside the jump.',
    { couple: redoxCouple('fe3', 0.68), start: 'red', conc: 0.06, volume: 25 }, { couple: redoxCouple('cr2o7', 1.33), conc: 0.01667 }, 0, 'diphenylamine'),
  redoxExample('iodine-thiosulfate', 'Iodine with thiosulfate', 'Redox',
    'Iodometry: 25.00 mL of 0.0500 M I₂ (in iodide solution) with 0.1000 M sodium thiosulfate, two S₂O₃²⁻ per I₂. Equivalence at 25.00 mL. In the lab starch is added near the end: the blue colour vanishes at the equivalence point.',
    { couple: redoxCouple('i2'), start: 'ox', conc: 0.05, volume: 25 }, { couple: redoxCouple('s4o6'), conc: 0.1 }, 7, 'starch'),
  // ----------------------------------------------------------------------------------------------- precipitation
  precipExample('mohr-chloride', 'Chloride by the Mohr method', 'Precipitation',
    'Chloride, 25.00 mL of 0.0500 M NaCl with 0.0500 M AgNO₃ and 2.5 mM chromate indicator. The equivalence point is at 25.00 mL, pAg 4.88; the red Ag₂CrO₄ appears when [Ag⁺] reaches (K_sp/[CrO₄²⁻])^½, a little after the equivalence point.',
    { mode: 'silver-titrant', anions: [{ salt: 'agcl', conc: 0.05, volume: 25 }], titrantConc: 0.05, indicator: 'mohr', chromate: 0.0025 }),
  precipExample('chloride-iodide', 'Iodide and chloride with silver', 'Precipitation',
    'A mixture of 12.50 mL of 0.0500 M iodide and 12.50 mL of 0.0500 M chloride with 0.0500 M AgNO₃. AgI (K_sp 8.5×10⁻¹⁷) is far less soluble than AgCl, so iodide is precipitated first (12.50 mL) and chloride next (25.00 mL): two steps in pAg.',
    { mode: 'silver-titrant', anions: [{ salt: 'agi', conc: 0.05, volume: 12.5 }, { salt: 'agcl', conc: 0.05, volume: 12.5 }], titrantConc: 0.05, indicator: null }),
  precipExample('volhard-silver', 'Silver by the Volhard method', 'Precipitation',
    'Silver, 25.00 mL of 0.0500 M Ag⁺ in nitric acid, with 0.0500 M KSCN and iron(III) (10 mM) as indicator. AgSCN forms (equivalence 25.00 mL); the first excess thiocyanate gives the blood-red FeSCN²⁺.',
    { mode: 'thiocyanate-titrant', silver: { conc: 0.05, volume: 25 }, titrantConc: 0.05, indicator: 'volhard', iron: 0.01 }),
  // ----------------------------------------------------------------------------------------------- buffers
  bufferExample('buffer-phosphate-74', 'Phosphate buffer, pH 7.4', 'Buffers',
    'A 10 mM phosphate buffer of pH 7.4 made isotonic with NaCl (I = 0.15 M, like PBS): NaH₂PO₄ and Na₂HPO₄ from 1 M stocks in 1000 mL, plus the salt. The ratio is not the Henderson–Hasselbalch value 1.58: at I = 0.15 M the activity coefficients lower the effective pKa₂ from 7.20 to about 6.8.',
    { sys: systemOf(entry('phosphoric')), lib: 'phosphoric', forms: entry('phosphoric').forms, mode: 'salts', formA: 1, formB: 2, pH: 7.4, conc: 0.01, volume: 1000, temperature: 25, activity: 'davies', ionicStrength: 0.15 }),
  bufferExample('buffer-tris-37', 'Tris-HCl buffer, pH 7.4 at 37 °C', 'Buffers',
    'Tris 50 mM at pH 7.4 at 37 °C, made from Tris base and 1 M HCl in 500 mL. Tris is the buffer most sensitive to temperature (−0.028 pH per °C): a buffer made to pH 7.4 at 37 °C reads about 7.75 at 25 °C — check the table of the same recipe at other temperatures.',
    { sys: systemOf(entry('tris')), lib: 'tris', forms: entry('tris').forms, mode: 'base-acid', formA: 0, formB: 1, pH: 7.4, conc: 0.05, volume: 500, temperature: 37, activity: 'davies', ionicStrength: null }),
  bufferExample('buffer-acetate-476', 'Acetate buffer, pH 5.00', 'Buffers',
    'Acetic acid 0.100 M brought to pH 5.00 with NaOH: 1 M acetic acid and 1 M NaOH in 500 mL. Exactly as many equivalents of base as the charge balance requires — more than Henderson–Hasselbalch gives, because the buffer must also cancel the acid\'s own protons.',
    { sys: systemOf(entry('acetic')), lib: 'acetic', forms: entry('acetic').forms, mode: 'acid-base', formA: 0, formB: 1, pH: 5.0, conc: 0.1, volume: 500, temperature: 25, activity: 'none', ionicStrength: null }),
  // ----------------------------------------------------------------------------------------------- data
  syntheticAcetic(),
  syntheticGran(),
  syntheticCarbonate(),
]

// ---------------------------------------------------------------------------------------------- builders for the other kinds

function redoxExample(id: string, title: string, group: string, description: string, analyte: Project['redox']['analyte'], titrant: Project['redox']['titrant'], pH: number, indicator: string | null): Example {
  const p = newProject()
  p.name = title
  p.description = description
  p.mode = 'redox'
  p.redox = { analyte, titrant, water: 0, pH, temperature: 25, indicator, vmax: null }
  return { id, title, group, description, project: p }
}

function edtaExample(id: string, title: string, group: string, description: string, metal: string, extra: { conc: number; volume: number; ammonia: number }): Example {
  const p = newProject()
  p.name = title
  p.description = description
  p.mode = 'edta'
  p.edta = { ...p.edta, metal: edtaMetal(metal), conc: extra.conc, volume: extra.volume, ammonia: extra.ammonia, pH: 10, titrantConc: 0.01, indicator: METAL_INDICATORS[0].logK[edtaMetal(metal).symbol] !== undefined ? 'ebt' : null }
  return { id, title, group, description, project: p }
}

function precipExample(id: string, title: string, group: string, description: string, patch: Partial<Project['precip']>): Example {
  const p = newProject()
  p.name = title
  p.description = description
  p.mode = 'precip'
  p.precip = { ...p.precip, ...patch }
  return { id, title, group, description, project: p }
}

function bufferExample(id: string, title: string, group: string, description: string, patch: Partial<Project['buffer']>): Example {
  const p = newProject()
  p.name = title
  p.description = description
  p.tab = 'buffer'
  p.buffer = { ...p.buffer, stockA: 1, stockB: 1, cation: 'Na', anion: 'Cl', ...patch }
  // the Titration tab shows the buffer's own titration, so it is not empty
  p.acidbase = { ...p.acidbase, temperature: p.buffer.temperature, items: [{ kind: 'weak', label: p.buffer.sys.label, pKa: p.buffer.sys.pKa, z0: p.buffer.sys.z0, form: p.buffer.mode === 'base-acid' ? Math.max(p.buffer.formA, p.buffer.formB) : Math.min(p.buffer.formA, p.buffer.formB), conc: 0.1, volume: 25, ...(p.buffer.sys.dpKadT ? { dpKadT: p.buffer.sys.dpKadT } : {}) }], titrant: p.buffer.mode === 'salts' || p.buffer.mode === 'acid-base' ? NaOH() : HCl(), indicator: null }
  return { id, title, group, description, project: p }
}

export const exampleById = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id)

export function findExample(text: string): Example | undefined {
  const t = text.trim().toLowerCase()
  return exampleById(t) ?? EXAMPLES.find((e) => e.title.toLowerCase() === t) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(t))
}
