// The example workspaces as .kreact files (pure): each one opens in the right tool with its reaction, network,
// profile or data filled in, and carries one notebook entry ("About this example") with what to look at and the
// numbers the engine gives. tools/export_app_examples.ts writes them to public/examples/kreaction/; the tests
// load every one and check its reaction balances or its simulation runs.

import { exampleFileName, type ExampleSource } from '../../os/exampleFiles.ts'
import { nameOfSmiles } from './compounds.ts'
import { leChatelier, parseEquilibrium, solveIce, vantHoffK2, type Disturbance } from './equilibrium.ts'
import { arrhenius, fitOrder, orderUnit } from './fit.ts'
import { findPreset, michaelisMenten, parseNetwork, simulate, summarise } from './kinetics.ts'
import { findReaction, type LibReaction } from './library.ts'
import type { NotebookEntry } from './notebook.ts'
import { analyse, catalysed, profileFromMechanism, rateEnhancement, simpleProfile } from './profile.ts'
import { analyseReaction, reactionText } from './reaction.ts'
import { defaultWorkspace, FILE_FORMAT, FILE_VERSION, serializeWorkspace, type ToolId, type Workspace } from './workspace.ts'

export const KREACTION_EXAMPLES_FOLDER = 'kReaction Examples'

const TOOL_NAMES: Record<ToolId, string> = {
  builder: 'Reaction builder', library: 'Reaction library', mechanism: 'Mechanism', predict: 'Predict products', kinetics: 'Kinetics',
  energy: 'Energy & equilibrium', notebook: 'Notebook',
}

export interface ReactionExample {
  title: string
  /** Heading in the File > Open example file menu. */
  group: 'Reactions' | 'Mechanisms' | 'Energy and equilibrium' | 'Kinetics'
  description: string
  workspace: Workspace
  /** Lines for the notebook: what the engine finds for this example. */
  results: string[]
}

const sig = (n: number, d = 4): string => (Number.isFinite(n) ? String(Number(n.toPrecision(d))) : String(n))

// ------------------------------------------------------------------ helpers

/** The builder as "Reaction library > Open in the builder" fills it (names where the table knows them). */
function builderOf(r: LibReaction): Workspace['builder'] {
  const label = (s: string) => nameOfSmiles(s) ?? s
  return { reactants: r.reactants.map(label), products: r.products.map(label), arrow: r.arrow, above: r.above, below: r.below, coeffs: r.coeffs, fromId: r.id }
}

function lib(id: string): LibReaction {
  const r = findReaction(id)
  if (!r) throw new Error(`The library has no reaction "${id}".`)
  return r
}

function mechanismExample(id: string, step: number, title: string, description: string, look: string): ReactionExample {
  const r = lib(id)
  const states = r.mechanism ?? []
  const prof = analyse(profileFromMechanism(states))
  const ws = defaultWorkspace()
  return {
    title, group: 'Mechanisms', description,
    workspace: { ...ws, tool: 'mechanism', builder: builderOf(r), mechanism: { reactionId: id, step } },
    results: [
      `${r.name}: ${r.reactants.length} reactant(s) → ${r.products.length} product(s), ${states.length} states.`,
      `States: ${states.map((s) => s.label).join(' → ')}.`,
      `Overall ΔH = ${sig(prof.dH)} kJ/mol; highest transition state ${sig(prof.eaOverall)} kJ/mol above the reactants (the rate-determining step is ${prof.steps[prof.rds]?.from ?? '?'} → ${prof.steps[prof.rds]?.to ?? '?'}).`,
      look,
    ],
  }
}

function kineticsExample(presetId: string, tab: Workspace['kinetics']['tab'], title: string, description: string, look: string[], tweak?: (k: Workspace['kinetics']) => Workspace['kinetics']): ReactionExample {
  const p = findPreset(presetId)
  if (!p) throw new Error(`No kinetics preset "${presetId}".`)
  const ws = defaultWorkspace()
  const k = { ...ws.kinetics, tab, text: p.text, tEnd: String(p.tEnd), logTime: p.logTime, presetId: p.id, hidden: [] as string[] }
  const kinetics = tweak ? tweak(k) : k
  const net = parseNetwork(kinetics.text).network
  const sim = net ? simulate(net, { tEnd: Number(kinetics.tEnd), points: 300, logTime: kinetics.logTime, method: kinetics.method }) : null
  const rows = sim?.ok ? summarise(sim).filter((s) => !kinetics.hidden.includes(s.name)).map((s) => `${s.name}: ${sig(s.initial)} → ${sig(s.final)} (maximum ${sig(s.max)} at t = ${sig(s.tMax)})`) : ['(the simulation did not run)']
  return { title, group: 'Kinetics', description, workspace: { ...ws, tool: 'kinetics', kinetics }, results: [`Network:\n${kinetics.text}`, `Run to t = ${kinetics.tEnd}:`, ...rows, ...look] }
}

// ------------------------------------------------------------------ the examples

function ethanolCombustion(): ReactionExample {
  const r = lib('combustion-ethanol')
  const input = { reactants: ['ethanol', 'oxygen'], products: ['carbon dioxide', 'water'], arrow: 'forward' as const, above: 'O2', below: 'flame' }
  const a = analyseReaction(input)
  if (!a.balance || (a.balance.status !== 'ok' && a.balance.status !== 'balanced')) throw new Error('The ethanol combustion must balance.')
  const coeffs = a.balance.coefficients
  const ws = defaultWorkspace()
  return {
    title: 'Ethanol combustion, balanced', group: 'Reactions',
    description: 'Ethanol burning in oxygen, balanced by the exact balancer (nullspace of the atom matrix): C2H6O + 3 O2 → 2 CO2 + 3 H2O.',
    workspace: { ...ws, tool: 'builder', builder: { ...input, coeffs, fromId: r.id } },
    results: [
      `Balancer: ${reactionText(a, input, coeffs)}`,
      `Coefficients: ${coeffs.join(', ')} (reactants then products). Atoms, mass and charge balance.`,
      `Molar masses: ${[...a.reactants, ...a.products].map((s, i) => `${coeffs[i]} × ${s.label} = ${sig(s.mass * coeffs[i], 5)} g/mol`).join('; ')}.`,
      `ΔH combustion = ${r.dH} kJ per mole of ethanol. Press Balance to see the balancer's answer again, or change a species.`,
    ],
  }
}

function libraryOverview(): ReactionExample {
  const ws = defaultWorkspace()
  return {
    title: 'Industrial processes in the library', group: 'Reactions',
    description: 'The reaction library filtered to the industrial class (Haber–Bosch, the contact process, N2O4): open one in the builder, the mechanism viewer or the energy profile from here.',
    workspace: { ...ws, tool: 'library', library: { selected: 'haber', query: '', cls: 'Industrial' } },
    results: ['The library holds 51 reactions in 14 classes, each with an explanation, conditions, ΔH and Ea where known, and a step-by-step mechanism for many.', 'Choose a class or type in the search box; Open in builder / mechanism / energy profile send the reaction to those tools.'],
  }
}

function hydrogenationProfile(): ReactionExample {
  const r = lib('hydrogenation')
  const profile = simpleProfile(r.dH ?? -137, r.ea ?? 180, 'C₂H₄ + H₂', 'C₂H₆')
  const lower = 150
  const base = analyse(profile)
  const cat = analyse(catalysed(profile, lower))
  const ws = defaultWorkspace()
  return {
    title: 'Hydrogenation of ethene: catalysed or not', group: 'Energy and equilibrium',
    description: 'The energy profile of C2H4 + H2 → C2H6 with and without a metal catalyst (Pd, Pt, Ni): the catalyst opens a path with a far lower barrier and leaves ΔH unchanged.',
    workspace: { ...ws, tool: 'energy', builder: builderOf(r), energy: { ...ws.energy, tab: 'profile', profile, showCatalysed: true, lower: String(lower), source: r.id } },
    results: [
      `Uncatalysed: ΔH = ${sig(base.dH)} kJ/mol, Ea (forward) = ${sig(base.eaOverall)} kJ/mol, Ea (reverse) = ${sig(base.eaReverse)} kJ/mol.`,
      `Catalysed (barrier lowered by ${lower} kJ/mol): Ea = ${sig(cat.eaOverall)} kJ/mol; ΔH is the same, ${sig(cat.dH)} kJ/mol.`,
      `At 298 K the rate constant is about ${rateEnhancement(base.eaOverall, cat.eaOverall, 298.15).toExponential(2)} times larger with the catalyst.`,
      'Change "Barrier lowered by" or the energies in the table to see the curves move.',
    ],
  }
}

function haberIce(): ReactionExample {
  const equation = 'N2 + 3 H2 <=> 2 NH3'
  const initial = 'N2 = 50, H2 = 150, NH3 = 0'
  const Kp = 1.6e-4
  const parsed = parseEquilibrium(equation, initial)
  const res = solveIce(parsed.species, Kp)
  const ws = defaultWorkspace()
  const eq = Object.fromEntries(res.rows.map((x) => [x.name, x.equilibrium]))
  const total = res.rows.reduce((a, x) => a + x.equilibrium, 0)
  return {
    title: 'Haber–Bosch equilibrium (Kp)', group: 'Energy and equilibrium',
    description: 'N2 + 3 H2 ⇌ 2 NH3 at 400 °C (673 K) with Kp = 1.6e-4 atm⁻² from 50 atm N2 and 150 atm H2: the ICE table gives the partial pressures at equilibrium and the conversion.',
    workspace: { ...ws, tool: 'energy', builder: builderOf(lib('haber')), energy: { ...ws.energy, tab: 'equilibrium', source: 'haber', ice: { ...ws.energy.ice, equation, initial, K: String(Kp), mode: 'Kp', T: '673', add: '50', addSpecies: 'H2', volume: '0.5', T2: '773', dH: '-92' } } },
    results: [
      `Kp = ${Kp} atm⁻² (Δn(gas) = ${parsed.dnGas}), initial partial pressures: ${initial}.`,
      `At equilibrium: ${res.rows.map((x) => `${x.name} = ${sig(x.equilibrium)} atm`).join(', ')}; total ${sig(total)} atm (from 200 atm).`,
      `Mole fraction of ammonia ${sig((eq.NH3 / total) * 100)} %; conversion of the limiting reactant ${sig((res.conversion ?? 0) * 100)} %; extent ξ = ${sig(res.extent)} atm.`,
      `The reaction is exothermic (ΔH = −92 kJ/mol): at 773 K, van 't Hoff gives Kp = ${vantHoffK2(Kp, 673, 773, -92).toExponential(2)}, much less ammonia. Compressing the mixture to half its volume (the "volume" box) or adding H2 shifts it forward.`,
    ],
  }
}

function n2o4LeChatelier(): ReactionExample {
  const equation = 'N2O4 <=> 2 NO2'
  const initial = 'N2O4 = 0.100, NO2 = 0'
  const K = 0.0059
  const parsed = parseEquilibrium(equation, initial)
  const res = solveIce(parsed.species, K)
  const ws = defaultWorkspace()
  const shift = (label: string, d: Disturbance): string => {
    const s = leChatelier(parsed.species, K, res, d)
    return `${label}: moves ${s.direction}; new equilibrium ${s.result.rows.map((x) => `${x.name} = ${sig(x.equilibrium)}`).join(', ')} mol/L.`
  }
  return {
    title: 'N2O4 ⇌ 2 NO2 and Le Chatelier', group: 'Energy and equilibrium',
    description: 'The brown/colourless gas equilibrium N2O4 ⇌ 2 NO2 (Kc = 0.0059 at 298 K, ΔH = +57 kJ/mol) with the Le Chatelier panel ready: add N2O4, halve the volume or heat to 350 K and press Apply.',
    workspace: { ...ws, tool: 'energy', builder: builderOf(lib('n2o4')), energy: { ...ws.energy, tab: 'equilibrium', source: 'n2o4', ice: { ...ws.energy.ice, equation, initial, K: String(K), mode: 'Kc', T: '298', add: '0.05', addSpecies: 'N2O4', volume: '0.5', T2: '350', dH: '57' } } },
    results: [
      `Start: 0.100 mol/L N2O4 only. At equilibrium ${res.rows.map((x) => `${x.name} = ${sig(x.equilibrium)}`).join(', ')} mol/L; ${sig((res.conversion ?? 0) * 100)} % of the N2O4 has dissociated.`,
      shift('Add 0.05 mol/L N2O4', { kind: 'add', species: 'N2O4', amount: 0.05 }),
      shift('Compress to half the volume', { kind: 'volume', factor: 0.5 }),
      shift('Heat from 298 K to 350 K (ΔH = +57 kJ/mol)', { kind: 'temperature', T1: 298, T2: 350, dH: 57 }),
      'Press Apply in the Le Chatelier panel to see each shift in the app.',
    ],
  }
}

/** Second-order data: 1/[A] = 1/[A]0 + k t with [A]0 = 1.000 mol/L and k = 0.040 L/(mol s), with a little measurement scatter. */
function secondOrderData(): string {
  const t = [0, 10, 20, 40, 60, 90, 120, 180]
  const noise = [0, 0.004, -0.003, 0.005, -0.004, 0.003, -0.005, 0.002]
  const rows = t.map((x, i) => `${x}\t${(((1 / (1 + 0.04 * x)) * (1 + noise[i])).toFixed(4))}`)
  return `# t (s)   [A] (mol/L)\n${rows.join('\n')}`
}

function orderFromData(): ReactionExample {
  const orderData = secondOrderData()
  const rows = orderData.split('\n').slice(1).map((l) => l.split('\t').map(Number))
  const fit = fitOrder(rows.map((r) => r[0]), rows.map((r) => r[1]))
  const ws = defaultWorkspace()
  return {
    title: 'Reaction order from data', group: 'Kinetics',
    description: 'Concentration against time for an unknown reaction (synthetic, with scatter): the order analysis fits zero, first and second order and picks the straight line, which is second order here.',
    workspace: { ...ws, tool: 'kinetics', kinetics: { ...ws.kinetics, tab: 'order', orderData } },
    results: [
      `Data:\n${orderData}`,
      `Best fit: order ${fit.best?.order ?? '?'}, k = ${sig(fit.best?.k ?? NaN)} ${orderUnit(fit.best?.order ?? 2)}, [A]0 = ${sig(fit.best?.c0 ?? NaN)} mol/L, half-life ${sig(fit.best?.halfLife ?? NaN)} s, R² = ${sig(fit.best?.fit.r2 ?? NaN, 6)}.`,
      `R² of the three plots: ${fit.fits.map((f) => `order ${f.order}: ${sig(f.fit.r2, 5)}`).join('; ')}.`,
      'The data were made with k = 0.040 L/(mol s). Paste your own two columns (time, concentration) over them.',
    ],
  }
}

/** k = A exp(−Ea / RT) with Ea = 60 kJ/mol and A = 1e9 s⁻¹, rounded to 3 digits and nudged ±1.5 %. */
function arrheniusData(): string {
  const T = [300, 310, 320, 330, 340, 350, 360, 370, 380]
  const noise = [0.01, -0.012, 0.008, -0.006, 0.015, -0.01, 0.005, -0.014, 0.012]
  const rows = T.map((x, i) => `${x}\t${(1e9 * Math.exp(-60000 / (8.314462618 * x)) * (1 + noise[i])).toPrecision(3)}`)
  return `# T (K)   k (s^-1)\n${rows.join('\n')}`
}

function arrheniusPlot(): ReactionExample {
  const arrData = arrheniusData()
  const rows = arrData.split('\n').slice(1).map((l) => l.split('\t').map(Number))
  const r = arrhenius(rows.map((x) => x[0]), rows.map((x) => x[1]))
  const ws = defaultWorkspace()
  return {
    title: 'Arrhenius plot: activation energy', group: 'Kinetics',
    description: 'Rate constants measured from 300 to 380 K (synthetic, with 1 % scatter): ln k against 1/T is a straight line whose slope gives the activation energy and whose intercept gives the pre-exponential factor.',
    workspace: { ...ws, tool: 'kinetics', kinetics: { ...ws.kinetics, tab: 'arrhenius', arrKind: 'arrhenius', arrData } },
    results: [
      `Data:\n${arrData}`,
      `Fit: Ea = ${sig(r.Ea)} ± ${sig(r.EaSE, 2)} kJ/mol, A = ${r.A.toExponential(2)} s⁻¹, k(298 K) = ${r.k298.toExponential(2)} s⁻¹, R² = ${sig(r.fit.r2, 6)}.`,
      'The data were made with Ea = 60 kJ/mol and A = 1e9 s⁻¹. Switch to the Eyring plot for ΔH‡ and ΔS‡.',
    ],
  }
}

function michaelis(): ReactionExample {
  const ex = kineticsExample(
    'michaelis-menten', 'michaelis', 'Michaelis–Menten enzyme kinetics',
    'E + S ⇌ ES → E + P with k1 = 10, k−1 = 1, kcat = 2 and [E]0 = 0.01: the initial velocities at six substrate concentrations follow the hyperbola v = Vmax·S / (KM + S), and the Lineweaver–Burk plot recovers KM and Vmax.',
    [],
    (k) => ({ ...k, text: k.text.replace('E = 0.1', `E = ${k.mm.e0}`) }),
  )
  const mm = ex.workspace.kinetics.mm
  const r = michaelisMenten({ k1: Number(mm.k1), km1: Number(mm.km1), kcat: Number(mm.kcat), e0: Number(mm.e0), s0: mm.s0.split(/[\s,;]+/).map(Number) })
  return {
    ...ex,
    results: [
      ex.results[0],
      `Michaelis–Menten (E + S ⇌ ES → E + P): KM = (k−1 + kcat)/k1 = ${sig(r.km)}, Vmax = kcat[E]0 = ${sig(r.vmax)}.`,
      `Initial velocities: ${r.points.map((p) => `S = ${p.s0}: v = ${sig(p.v)}`).join('; ')}.`,
      `Lineweaver–Burk fit: KM = ${sig(r.lb.km)}, Vmax = ${sig(r.lb.vmax)}, R² = ${sig(r.lb.r2, 6)}.`,
      'The Simulate tab holds the same network over time: after a very fast transient the enzyme sits in a steady state.',
    ],
  }
}

/** Every example, in the order of the files. */
export function reactionExamples(): ReactionExample[] {
  return [
    ethanolCombustion(),
    libraryOverview(),
    mechanismExample('sn2', 1, 'SN2 mechanism: bromoethane + hydroxide', 'Bimolecular substitution in one concerted step with back-side attack and inversion; step through it in the mechanism viewer.', 'Opens on the last state (the products) with the electron pushing in words; the energy profile has one barrier of 85 kJ/mol.'),
    mechanismExample('sn1', 1, 'SN1 mechanism: tert-butyl bromide hydrolysis', 'Unimolecular substitution: the slow ionisation to a tertiary carbocation, then capture by water. Four states with the energy of each.', 'The carbocation is the high-energy intermediate: the first transition state (90 kJ/mol) is the rate-determining step.'),
    mechanismExample('fischer', 2, 'Fischer esterification mechanism', 'Acid-catalysed ester formation from acetic acid and ethanol in six states: protonation, addition, proton transfer and loss of water, all reversible.', 'Opens at the addition step (state 3 of 6): the alcohol has attacked the protonated carbonyl; step back and forward to follow the proton shuffling.'),
    mechanismExample('diels-alder-cp', 1, 'Diels–Alder: cyclopentadiene + maleic anhydride', 'A concerted [4+2] cycloaddition giving the endo adduct: six electrons move in one cyclic transition state.', 'One barrier (55 kJ/mol) and a strongly exothermic step (−150 kJ/mol): the reaction is fast at room temperature.'),
    mechanismExample('aldol', 1, 'Aldol addition mechanism', 'Base-catalysed addition of ethanal to itself: enolate formation, attack on a second carbonyl and protonation of the alkoxide to 3-hydroxybutanal.', 'The enolate (state 2) is the nucleophile; its attack on the second ethanal (the highest barrier) is the rate-determining step.'),
    hydrogenationProfile(),
    haberIce(),
    n2o4LeChatelier(),
    kineticsExample(
      'consecutive', 'simulate', 'Consecutive reactions A → B → C',
      'Two first-order steps in a row (k1 = 0.5, k2 = 0.2): the intermediate B rises, peaks and falls while C appears after an induction period.',
      ['B peaks at t = ln(k1/k2)/(k1 − k2) = 3.05 with [B]max = 0.545 (analytic); compare the maximum above.'],
    ),
    michaelis(),
    kineticsExample(
      'brusselator', 'simulate', 'Brusselator oscillator',
      'A model chemical oscillator: with B > 1 + A² (here 3 > 2) the concentrations of X and Y settle onto a limit cycle and oscillate for ever.',
      ['X and Y chase each other round a limit cycle; lower B below 2 (edit "fixed B = 3") to see the oscillation die out.'],
      (k) => ({ ...k, hidden: ['A', 'B', 'D', 'E'] }),
    ),
    orderFromData(),
    arrheniusPlot(),
  ]
}

// ------------------------------------------------------------------ files

const aboutEntry = (ex: ReactionExample): NotebookEntry => ({
  id: 'example', label: 'About this example', tool: TOOL_NAMES[ex.workspace.tool], text: [ex.title, '', ex.description, '', ...ex.results].join('\n'), time: 0,
})

/** The text of one example's .kreact file: the workspace with the about entry in its notebook, plus title and description. */
export function reactionFileText(ex: ReactionExample): string {
  const o = JSON.parse(serializeWorkspace({ ...ex.workspace, notebook: [aboutEntry(ex)] })) as Record<string, unknown>
  const { format, version, ...rest } = o
  return JSON.stringify({ format: format ?? FILE_FORMAT, version: version ?? FILE_VERSION, title: ex.title, description: ex.description, ...rest }, null, 2) + '\n'
}

export function kreactionExampleFiles(): ExampleSource[] {
  return reactionExamples().map((ex, i) => ({
    file: exampleFileName(i + 1, ex.title, 'kreact'),
    title: ex.title,
    description: ex.description,
    group: ex.group,
    content: reactionFileText(ex),
  }))
}
