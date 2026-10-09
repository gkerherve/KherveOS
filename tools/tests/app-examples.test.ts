// The example files of kReaction, kElec and kPCB: the generator is deterministic, public/examples/<app>/ holds
// exactly what it makes (and an index.json that lists exactly the files), every file loads with its app's own
// reader, every circuit simulates with plausible results, every board is fully routed and DRC-clean, every
// reaction balances or its simulation runs, and the shared seeding helper copies once without overwriting.  Run:
//   node --test tools/tests/app-examples.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appExampleOutputs, appExamples, indexText } from '../export_app_examples.ts'
import { exampleFileName, groupExamples, readExampleIndex, seedExampleFolder, type ExampleDrive } from '../../src/os/exampleFiles.ts'

import { parseWorkspace } from '../../src/apps/kreaction/workspace.ts'
import { analyseReaction } from '../../src/apps/kreaction/reaction.ts'
import { findReaction } from '../../src/apps/kreaction/library.ts'
import { analyse as analyseProfile, catalysed } from '../../src/apps/kreaction/profile.ts'
import { parseNetwork, simulate, findPreset, michaelisMenten } from '../../src/apps/kreaction/kinetics.ts'
import { parseEquilibrium, solveIce } from '../../src/apps/kreaction/equilibrium.ts'
import { arrhenius, fitOrder, parseTable } from '../../src/apps/kreaction/fit.ts'
import { reactionExamples } from '../../src/apps/kreaction/exampleFiles.ts'

import { parseKelec } from '../../src/apps/kelec/file.ts'
import { EXAMPLES as KELEC_EXAMPLES, exampleDoc } from '../../src/apps/kelec/examples.ts'
import { canonicalIds } from '../../src/apps/kelec/exampleFiles.ts'
import { buildNetlist } from '../../src/apps/kelec/netlist.ts'
import { prepareSchematic, runPrepared, traceData } from '../../src/apps/kelec/session.ts'
import { frequencyOf, stats } from '../../src/apps/kelec/sim/measure.ts'
import type { SimResult } from '../../src/apps/kelec/sim/engine.ts'

import { parseDesign, serializeDesign } from '../../src/apps/kpcb/file.ts'
import { EXAMPLES as KPCB_EXAMPLES, routedExample } from '../../src/apps/kpcb/examples.ts'
import { analyze, ratsnest } from '../../src/apps/kpcb/analysis.ts'
import { runDrc } from '../../src/apps/kpcb/drc.ts'
import { fillZones } from '../../src/apps/kpcb/zones.ts'
import { autoroute } from '../../src/apps/kpcb/autoroute.ts'
import { outlineBox, partBox } from '../../src/apps/kpcb/board.ts'
import { getFootprint } from '../../src/apps/kpcb/footprints.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const near = (a: number, b: number, rel: number, what = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what} ${a} ≈ ${b} (±${rel * 100}%)`)
let generated: ReturnType<typeof appExamples> | null = null // the generator is slow (it routes the boards): once for the checks below
const allApps = () => (generated ??= appExamples())
const byApp = (app: string) => allApps().find((a) => a.app === app)!

// ------------------------------------------------------------------ the generator and the files on disk

test('the generator is deterministic: two runs give identical files, in a fixed order, with 2-space JSON', () => {
  const a = appExampleOutputs()
  const b = appExampleOutputs()
  assert.deepEqual(a, b)
  assert.ok(a.length > 50)
  assert.equal(new Set(a.map((o) => o.path)).size, a.length, 'unique paths')
  for (const o of a) {
    assert.ok(o.content.endsWith('\n'), `${o.path} ends with a newline`)
    assert.ok(/^public\/examples\/(kreaction|kelec|kpcb)\/[\x20-\x7e]+$/.test(o.path), `${o.path}: plain ASCII name`)
    if (o.path.endsWith('.json') || /\.(kreact|kelec)$/.test(o.path)) assert.ok(o.content.startsWith('{\n  "'), `${o.path}: indented by 2`)
    JSON.parse(o.content)
  }
  // ids and file names carry no time or random part
  assert.ok(!/p[0-9a-z]{9,}/.test(byApp('kelec').files[0].content.match(/"id": "[^"]+"/)![0]))
})

test('public/examples/<app>/ holds exactly the generated files, and index.json lists exactly the files that exist', () => {
  for (const a of allApps()) {
    const dir = join(ROOT, 'public/examples', a.app)
    assert.ok(existsSync(dir), `${dir} exists: run node tools/export_app_examples.ts`)
    const onDisk = readdirSync(dir).sort()
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { app: string; folder: string; examples: { file: string; title: string; description: string; group?: string }[] }
    assert.equal(index.app, a.app)
    assert.equal(index.folder, a.folder)
    assert.deepEqual([...index.examples.map((e) => e.file), 'index.json'].sort(), onDisk, `${a.app}: the index lists exactly the files`)
    assert.equal(readFileSync(join(dir, 'index.json'), 'utf8'), indexText(a), `${a.app}: index.json is up to date`)
    for (const e of index.examples) {
      assert.ok(e.file.endsWith(`.${a.ext}`), e.file)
      assert.ok(e.title.length > 2 && e.description.length > 20, `${e.file}: a title and a description`)
      assert.equal(readFileSync(join(dir, e.file), 'utf8'), a.files.find((f) => f.file === e.file)!.content, `${e.file} is up to date: run node tools/export_app_examples.ts`)
    }
    // what the apps read
    assert.equal(readExampleIndex(index).length, index.examples.length)
  }
  assert.deepEqual(allApps().map((a) => a.folder), ['kReaction Examples', 'kElec Examples', 'kPCB Examples'])
})

test('file names: numbered, plain ASCII, no characters a drive or URL dislikes', () => {
  assert.equal(exampleFileName(3, 'SN2 mechanism: bromoethane + hydroxide', 'kreact'), '03 SN2 mechanism - bromoethane + hydroxide.kreact')
  assert.equal(exampleFileName(10, 'N₂O₄ ⇌ 2 NO₂ and Le Chatelier', 'kreact'), '10 N2O4 = 2 NO2 and Le Chatelier.kreact')
  assert.equal(exampleFileName(1, 'A → B → C: "x"/y?', 'kreact'), '01 A to B to C - -x-y-.kreact')
  assert.equal(exampleFileName(12, 'Diels–Alder', 'kreact'), '12 Diels-Alder.kreact')
  for (const a of allApps()) for (const f of a.files) assert.ok(/^\d\d [\x20-\x7e]+$/.test(f.file) && !/[\\/:*?"<>|]/.test(f.file), f.file)
})

// ------------------------------------------------------------------ kReaction

test('kReaction: at least 12 examples, each opens in the right tool with a notebook note, and its reaction or simulation checks out', () => {
  const exs = reactionExamples()
  const files = byApp('kreaction').files
  assert.ok(exs.length >= 12 && files.length === exs.length, `${exs.length} examples`)
  assert.deepEqual(exs.map((e) => e.workspace.tool), [
    'builder', 'library', 'mechanism', 'mechanism', 'mechanism', 'mechanism', 'mechanism', 'energy', 'energy', 'energy', 'kinetics', 'kinetics', 'kinetics', 'kinetics', 'kinetics',
  ])
  exs.forEach((ex, i) => {
    const text = files[i].content
    const raw = JSON.parse(text) as Record<string, unknown>
    assert.equal(raw.format, 'kreact')
    assert.equal(raw.version, 1)
    assert.equal(raw.title, ex.title)
    const { workspace, warnings } = parseWorkspace(text)
    assert.deepEqual(warnings, [], ex.title)
    assert.equal(workspace.tool, ex.workspace.tool, ex.title)
    assert.equal(workspace.notebook.length, 1)
    assert.equal(workspace.notebook[0].label, 'About this example')
    assert.ok(workspace.notebook[0].text.includes(ex.title) && workspace.notebook[0].text.length > 150)
    assert.deepEqual(workspace.builder, ex.workspace.builder, `${ex.title}: the builder round-trips`)
    assert.deepEqual(workspace.energy, ex.workspace.energy)
    assert.deepEqual(workspace.kinetics, ex.workspace.kinetics)
    // the builder always holds a reaction that balances with its coefficients
    const b = workspace.builder
    const a = analyseReaction({ reactants: b.reactants, products: b.products, arrow: b.arrow, above: b.above, below: b.below }, {}, b.coeffs)
    assert.deepEqual(a.errors, [], `${ex.title}: species resolve`)
    if (b.fromId) {
      const lib = findReaction(b.fromId)
      assert.ok(lib, `${ex.title}: library reaction ${b.fromId}`)
      assert.deepEqual(b.coeffs, lib.coeffs)
    }
    if (b.coeffs && a.check) assert.ok(a.check.balanced, `${ex.title}: atoms, mass and charge balance`)
    if (ex.group === 'Reactions' && ex.workspace.tool === 'builder') assert.ok(a.balance && (a.balance.status === 'ok' || a.balance.status === 'balanced'))
  })
})

test('kReaction examples: the numbers in each tool are what the notes say', () => {
  const all = Object.fromEntries(reactionExamples().map((e) => [e.title, e.workspace]))
  const get = (start: string) => {
    const k = Object.keys(all).find((t) => t.startsWith(start))
    assert.ok(k, start)
    return all[k]
  }
  // ethanol: the balancer's coefficients, and a text that says so
  const eth = get('Ethanol')
  assert.deepEqual(eth.builder.coeffs, [1, 3, 2, 3])
  assert.deepEqual([eth.builder.reactants, eth.builder.products], [['ethanol', 'oxygen'], ['carbon dioxide', 'water']])
  // mechanisms exist, the step is inside them, and every state of each balances (the library test does it too)
  for (const t of ['SN2', 'SN1', 'Fischer', 'Diels', 'Aldol']) {
    const w = get(t)
    const lib = findReaction(w.mechanism.reactionId!)
    assert.ok(lib?.mechanism && w.mechanism.step >= 0 && w.mechanism.step < lib.mechanism.length, t)
    assert.equal(w.builder.fromId, lib.id)
  }
  // hydrogenation: a valid profile, and the catalyst lowers the barrier by the stated amount
  const h = get('Hydrogenation')
  const p = analyseProfile(h.energy.profile)
  assert.ok(p.valid)
  near(p.dH, -137, 1e-9)
  near(p.eaOverall, 180, 1e-9)
  const cat = analyseProfile(catalysed(h.energy.profile, Number(h.energy.lower)))
  near(cat.eaOverall, 30, 1e-9)
  near(cat.dH, p.dH, 1e-9)
  assert.ok(h.energy.showCatalysed && h.energy.tab === 'profile')
  // Haber: the Kp ICE table solves and the equilibrium has Q = K
  const hb = get('Haber').energy
  assert.equal(hb.tab, 'equilibrium')
  assert.equal(hb.ice.mode, 'Kp')
  const hbp = parseEquilibrium(hb.ice.equation, hb.ice.initial)
  const hbr = solveIce(hbp.species, Number(hb.ice.K))
  assert.ok(hbr.ok && hbr.direction === 'forward')
  near(hbr.Q, Number(hb.ice.K), 1e-9, 'Q = Kp')
  assert.equal(hbp.dnGas, -2)
  const nh3 = hbr.rows.find((r) => r.name === 'NH3')!
  assert.ok(nh3.equilibrium > 40 && nh3.equilibrium < 55, `NH3 ${nh3.equilibrium}`)
  // N2O4: textbook 11 % dissociation from 0.1 M with Kc = 0.0059, and the disturbance boxes are filled
  const n = get('N2O4').energy
  const nr = solveIce(parseEquilibrium(n.ice.equation, n.ice.initial).species, Number(n.ice.K))
  assert.ok(nr.ok)
  near(nr.rows[1].equilibrium, 0.02286, 1e-3)
  assert.deepEqual([n.ice.add, n.ice.addSpecies, n.ice.volume, n.ice.T2, n.ice.dH], ['0.05', 'N2O4', '0.5', '350', '57'])
  // kinetics: the networks parse and run; the preset is the one named; hidden species exist
  for (const t of ['Consecutive', 'Michaelis', 'Brusselator']) {
    const k = get(t).kinetics
    const net = parseNetwork(k.text)
    assert.ok(net.network, `${t}: ${net.errors.join(' ')}`)
    const sim = simulate(net.network, { tEnd: Number(k.tEnd), points: 120, logTime: k.logTime, method: k.method })
    assert.ok(sim.ok, `${t}: ${sim.message}`)
    for (const h of k.hidden) assert.ok(net.network.species.includes(h), `${t}: hidden ${h}`)
    assert.ok(findPreset(k.presetId), t)
  }
  const cons = get('Consecutive').kinetics
  assert.equal(cons.tab, 'simulate')
  const cs = simulate(parseNetwork(cons.text).network!, { tEnd: 20, points: 400, method: 'auto' })
  const iB = cs.species.indexOf('B')
  near(Math.max(...cs.c.map((r) => r[iB])), 0.545, 0.01, 'B max')
  const mmw = get('Michaelis').kinetics
  assert.equal(mmw.tab, 'michaelis')
  const mm = michaelisMenten({ k1: Number(mmw.mm.k1), km1: Number(mmw.mm.km1), kcat: Number(mmw.mm.kcat), e0: Number(mmw.mm.e0), s0: mmw.mm.s0.split(/[\s,;]+/).map(Number) })
  near(mm.lb.km, 0.3, 0.01)
  near(mm.lb.vmax, 0.02, 0.01)
  assert.ok(mmw.text.includes(`E = ${mmw.mm.e0}`), 'the simulated network uses the same enzyme amount')
  const bru = get('Brusselator').kinetics
  const bs = simulate(parseNetwork(bru.text).network!, { tEnd: Number(bru.tEnd), points: 600, method: 'auto' })
  const xs = bs.c.map((r) => r[bs.species.indexOf('X')])
  assert.ok(Math.max(...xs.slice(300)) > 2 && Math.min(...xs.slice(300)) < 0.8, 'X still oscillates late in the run')
  // data: second order from the data, Ea = 60 kJ/mol from the Arrhenius plot
  const od = get('Reaction order').kinetics
  assert.equal(od.tab, 'order')
  const t = parseTable(od.orderData)
  assert.equal(t.x.length, 8)
  const f = fitOrder(t.x, t.y)
  assert.equal(f.best?.order, 2)
  assert.ok(!f.ambiguous)
  near(f.best!.k, 0.04, 0.02)
  const ad = get('Arrhenius').kinetics
  assert.equal(ad.tab, 'arrhenius')
  const at = parseTable(ad.arrData)
  assert.equal(at.x.length, 9)
  const ar = arrhenius(at.x, at.y)
  near(ar.Ea, 60, 0.01)
  assert.ok(ar.fit.r2 > 0.999)
  // the library tool shows a class
  assert.equal(get('Industrial').library.cls, 'Industrial')
})

// ------------------------------------------------------------------ kElec

const KELEC_NEW = ['rc-ladder', 'lc-butterworth', 'emitter-follower', 'schmitt', 'precision-rectifier']

function simulateFile(text: string) {
  const l = parseKelec(text)
  const out = runPrepared(prepareSchematic(l.doc, l.sim, l.name))
  return { l, r: out.result as SimResult }
}

function measured(r: SimResult, signal: string, kind: string, from?: number): number {
  if (r.type === 'op') return r.op.values[signal]
  if (r.type === 'dc') return r.sweep.signals[signal].at(-1)!
  if (r.type === 'ac') return kind === 'max' ? Math.max(...r.ac.mag[signal]) : r.ac.mag[signal][0]
  const y = traceData(r, signal)
  const st = stats(r.tran.t, y, from ?? -Infinity)
  return kind === 'max' ? st.max : kind === 'min' ? st.min : kind === 'pp' ? st.pp : kind === 'mean' ? st.mean : kind === 'final' ? st.last : frequencyOf(r.tran.t, y, from) ?? NaN
}

test('kElec: every built-in example is a .kelec file, 5 new circuits are among them, and each file loads and simulates as the example does', () => {
  const files = byApp('kelec').files
  assert.equal(files.length, KELEC_EXAMPLES.length)
  assert.ok(files.length >= 28, `${files.length} files`)
  for (const id of KELEC_NEW) assert.ok(KELEC_EXAMPLES.some((e) => e.id === id), id)
  assert.equal(new Set(files.map((f) => f.group)).size, 7, 'seven categories')
  KELEC_EXAMPLES.forEach((ex, i) => {
    const f = files[i]
    assert.ok(f.file.startsWith(`${String(i + 1).padStart(2, '0')} ${ex.title.replace(/[:/]/g, '')}`.slice(0, 6)), f.file)
    const raw = JSON.parse(f.content) as { format: string; version: number; name: string; show?: string[] }
    assert.equal(raw.format, 'kelec')
    assert.equal(raw.version, 1)
    assert.equal(raw.name, ex.title)
    const { l, r } = simulateFile(f.content)
    // the schematic, the analysis and the traces are those of the example
    assert.deepEqual(l.doc, canonicalIds(exampleDoc(ex)), `${ex.id}: the drawing round-trips`)
    assert.equal(l.sim.analysis, ex.sim.analysis ?? 'op', `${ex.id}: right analysis pre-selected`)
    assert.equal(r.type, l.sim.analysis)
    assert.deepEqual(l.show, ex.show)
    assert.equal(l.stacked, !!ex.stacked)
    assert.equal(l.name, ex.title)
    const errors = buildNetlist(l.doc, l.name).problems.filter((p) => p.level === 'error')
    assert.deepEqual(errors.map((e) => e.message), [], ex.id)
    // every trace the scope should show first exists in the result
    if (r.type === 'tran' || r.type === 'dc') for (const sg of ex.show) assert.ok(traceData(r, sg).every(Number.isFinite), `${ex.id}: trace ${sg}`)
    if (r.type === 'ac') for (const sg of ex.show) assert.ok(sg in r.ac.mag, `${ex.id}: trace ${sg}`)
    // plausible results: what the example promises
    for (const e of ex.expect) {
      const got = measured(r, e.signal, e.kind, e.from)
      assert.ok(Math.abs(got - e.value) <= Math.max(e.tol * Math.abs(e.value), e.value === 0 ? e.tol : 0), `${ex.id}: ${e.signal} ${e.kind} = ${got}, expected ${e.value} ± ${e.tol}`)
    }
  })
})

test('kElec new circuits: the RC ladder, the Butterworth LC filter, the follower, the Schmitt trigger and the precision rectifier behave as described', () => {
  const run = (id: string) => simulateFile(byApp('kelec').files[KELEC_EXAMPLES.findIndex((e) => e.id === id)].content).r
  const ac = (r: SimResult, sig: string) => {
    assert.equal(r.type, 'ac')
    if (r.type !== 'ac') throw new Error('ac')
    const at = (f: number) => {
      const i = r.ac.freq.findIndex((x) => x >= f * 0.999)
      assert.ok(i >= 0, `${f} Hz in the sweep`)
      return { mag: r.ac.mag[sig][i], phase: r.ac.phase[sig][i], f: r.ac.freq[i] }
    }
    return at
  }
  // 3-stage RC ladder: flat at DC, -3 dB near 0.2/(2πRC) = 318 Hz (not 1.59 kHz), 60 dB/decade, -105° at 1 kHz
  const rc = ac(run('rc-ladder'), 'V(out)')
  near(rc(10).mag, 1, 0.01)
  const low = rc(316)
  near(low.mag, Math.SQRT1_2, 0.05, 'RC ladder −3 dB at 316 Hz')
  near(rc(1585).mag, 0.156, 0.05, 'at 1/(2πRC) the ladder passes 0.156')
  near(rc(100000).mag, 1 / (2 * Math.PI * 1e-4 * 1e5) ** 3, 0.02, 'far above the corner it falls as 1/(ωRC)³: 60 dB per decade')
  near(rc(1000).phase, -105.5, 0.02)
  assert.ok(ac(run('rc-ladder'), 'V(n1)')(316).mag > low.mag, 'each section loads the one before')
  // LC Butterworth 3rd order, doubly terminated: DC 0.5, 0.5/√2 at 10 kHz, 0.5/√(1+(f/fc)^6) beyond
  const lc = ac(run('lc-butterworth'), 'V(out)')
  near(lc(100).mag, 0.5, 0.001)
  near(lc(10000).mag, 0.5 / Math.SQRT2, 0.03, 'Butterworth corner')
  for (const f of [3000, 20000, 50000]) {
    const p = lc(f) // the sweep's own frequency at or just above f
    near(p.mag, 0.5 / Math.sqrt(1 + (p.f / 10000) ** 6), 0.03, `Butterworth at ${p.f} Hz`)
  }
  assert.ok(Math.abs(lc(3000).mag - 0.5) < 0.005, 'maximally flat below the corner')
  // emitter follower: gain just under 1, no inversion, the emitter sits about 0.7 V under the base
  const ef = run('emitter-follower')
  assert.equal(ef.type, 'tran')
  if (ef.type !== 'tran') throw new Error('tran')
  const vin = stats(ef.tran.t, traceData(ef, 'V(in)'), 2e-3)
  const vout = stats(ef.tran.t, traceData(ef, 'V(out)'), 2e-3)
  near(vout.pp / vin.pp, 0.99, 0.01, 'follower gain')
  const vb = stats(ef.tran.t, traceData(ef, 'V(b)'), 2e-3).mean
  const ve = stats(ef.tran.t, traceData(ef, 'V(e)'), 2e-3).mean
  assert.ok(vb - ve > 0.55 && vb - ve < 0.8, `Vbe ${vb - ve}`)
  let inPhase = 0
  for (let i = 0; i < ef.tran.t.length; i++) if (ef.tran.t[i] > 2e-3 && Math.sign(traceData(ef, 'V(in)')[i]) === Math.sign(traceData(ef, 'V(out)')[i])) inPhase++
  assert.ok(inPhase / ef.tran.t.filter((x) => x > 2e-3).length > 0.9, 'in phase')
  // Schmitt trigger: rails ±10 V, thresholds ±1 V (V(pos)), same frequency as the input, and it switches exactly when V(in) meets V(pos)
  const st = run('schmitt')
  assert.equal(st.type, 'tran')
  if (st.type !== 'tran') throw new Error('tran')
  const out = traceData(st, 'V(out)')
  const pos = traceData(st, 'V(pos)')
  const inp = traceData(st, 'V(in)')
  near(Math.max(...out), 10, 0.01)
  near(Math.min(...out), -10, 0.01)
  near(Math.max(...pos), 1, 0.03)
  near(frequencyOf(st.tran.t, out, 1e-3)!, 1000, 0.01)
  let flips = 0
  for (let i = 1; i < out.length; i++) {
    if (st.tran.t[i] > 1e-3 && Math.sign(out[i]) !== Math.sign(out[i - 1])) {
      flips++
      assert.ok(Math.abs(inp[i] - pos[i - 1]) < 0.35, `flip when V(in) reaches the threshold V(pos) had: ${inp[i]} vs ${pos[i - 1]}`)
    }
  }
  assert.ok(flips >= 4, `${flips} flips`)
  // precision rectifier: |Vin| to within 3 % even at 1 V, which a diode bridge (0.65 V drop) would cut to about 0.35 V
  const pr = run('precision-rectifier')
  assert.equal(pr.type, 'tran')
  if (pr.type !== 'tran') throw new Error('tran')
  const pin = traceData(pr, 'V(in)')
  const pout = traceData(pr, 'V(out)')
  let worst = 0
  for (let i = 0; i < pout.length; i++) if (pr.tran.t[i] > 0.5e-3) worst = Math.max(worst, Math.abs(pout[i] - Math.abs(pin[i])))
  assert.ok(worst < 0.03, `|error| ≤ 30 mV, got ${worst}`)
  near(frequencyOf(pr.tran.t, pout, 1e-3)!, 2000, 0.01)
})

// ------------------------------------------------------------------ kPCB

test('kPCB: every built-in board (the 3 old and 5 new) is a .kpcb file, fully routed, DRC-clean and inside its outline', () => {
  const files = byApp('kpcb').files
  assert.equal(files.length, KPCB_EXAMPLES.length)
  assert.ok(files.length >= 8)
  for (const id of ['5v-supply', 'attiny85-breakout', 'led-bargraph', 'uart-breakout', 'lm358-amplifier']) assert.ok(KPCB_EXAMPLES.some((e) => e.id === id), id)
  KPCB_EXAMPLES.forEach((ex, i) => {
    const text = files[i].content
    const raw = JSON.parse(text) as { format: string; version: number }
    assert.equal(raw.format, 'kpcb')
    assert.equal(raw.version, 1)
    const d = parseDesign(text)
    assert.equal(serializeDesign(d), text, `${ex.id}: the file round-trips`)
    const fills = fillZones(d)
    assert.equal(ratsnest(d, analyze(d, fills)).length, 0, `${ex.id}: fully routed`)
    assert.deepEqual(runDrc(d, fills).map((v) => `${v.severity} ${v.rule}: ${v.message}`), [], `${ex.id}: DRC-clean (no errors, no warnings)`)
    assert.ok(d.tracks.length > 5 && d.tracks.every((t) => t.auto), ex.id)
    assert.ok(d.zones.length >= 1 && d.zones.every((z) => z.net === 'GND'), `${ex.id}: ground plane`)
    // every part has a footprint and sits inside the board
    const ob = outlineBox(d)!
    for (const p of d.parts) {
      assert.ok(getFootprint(p.fp), `${ex.id}: ${p.ref} footprint ${p.fp}`)
      const b = partBox(p)
      assert.ok(b.x0 >= ob.x0 && b.y0 >= ob.y0 && b.x1 <= ob.x1 && b.y1 <= ob.y1, `${ex.id}: ${p.ref} inside the outline`)
    }
    // nets only name parts and pads that exist
    for (const n of d.nets) for (const pin of n.pins) {
      const part = d.parts.find((p) => p.ref === pin.ref)
      assert.ok(part && getFootprint(part.fp)!.pads.some((pad) => pad.n === pin.pin), `${ex.id}: net ${n.name} pin ${pin.ref}.${pin.pin}`)
    }
    // the same board as the app's "Open example"
    assert.equal(serializeDesign(routedExample(ex.id)), text)
  })
})

test('kPCB new boards: they are built from a netlist, routed to 100 % by the auto-router and have the parts they promise', () => {
  const parts = (id: string) => KPCB_EXAMPLES.find((e) => e.id === id)!.build()
  const fps = (id: string) => parts(id).parts.map((p) => p.fp)
  for (const id of ['5v-supply', 'attiny85-breakout', 'led-bargraph', 'uart-breakout', 'lm358-amplifier']) {
    const d = parts(id)
    assert.ok(ratsnest(d, analyze(d, fillZones(d))).length > 0, `${id} starts unrouted`)
    const r = autoroute(d)
    assert.equal(r.completion, 100, `${id}: ${r.remaining} left (${r.failedNets.join(',')})`)
    assert.equal(r.remaining, 0)
    assert.deepEqual(runDrc(r.design, fillZones(r.design)).map((v) => v.message), [], id)
  }
  // 5 V supply: LM7805 in a TO-220, two electrolytics, a diode, an LED with its resistor, two 2-pin terminals
  const ps = parts('5v-supply')
  assert.equal(ps.parts.find((p) => p.value === 'LM7805')!.fp, 'TO-220_Vertical')
  assert.equal(fps('5v-supply').filter((f) => /^CP_Radial/.test(f)).length, 2)
  assert.ok(fps('5v-supply').includes('D_DO-41') && fps('5v-supply').includes('LED_3mm') && fps('5v-supply').filter((f) => f === 'TerminalBlock_2x5.08').length === 2)
  assert.deepEqual(ps.nets.find((n) => n.name === '5V')!.pins.map((p) => `${p.ref}.${p.pin}`).sort(), ['C2.1', 'J2.1', 'R1.1', 'U1.3'])
  // ATtiny85: a DIP-8, decoupling, reset pull-up, LED + resistor, pin headers; VCC on pin 8, GND on pin 4, reset on pin 1
  const at = parts('attiny85-breakout')
  assert.ok(at.parts.some((p) => p.value === 'ATtiny85' && p.fp === 'DIP-8'))
  assert.ok(at.nets.find((n) => n.name === 'VCC')!.pins.some((p) => p.ref === 'U1' && p.pin === '8'))
  assert.ok(at.nets.find((n) => n.name === 'GND')!.pins.some((p) => p.ref === 'U1' && p.pin === '4'))
  assert.ok(at.nets.find((n) => n.name === 'RESET')!.pins.some((p) => p.ref === 'R1') && at.nets.find((n) => n.name === 'VCC')!.pins.some((p) => p.ref === 'R1'))
  assert.ok(fps('attiny85-breakout').filter((f) => /^PinHeader/.test(f)).length >= 2)
  // bar graph: 10 LEDs in one row, each with a resistor, a 1x10 header, two layers
  const bg = parts('led-bargraph')
  const leds = bg.parts.filter((p) => p.fp === 'LED_3mm')
  assert.equal(leds.length, 10)
  assert.equal(bg.parts.filter((p) => p.fp === 'R_0805').length, 10)
  assert.equal(new Set(leds.map((p) => p.y)).size, 1, 'one row')
  assert.ok(fps('led-bargraph').includes('PinHeader_1x10'))
  assert.equal(bg.zones.length, 1)
  // UART breakout: 1x6 and 1x4 headers, a bypass cap between VCC and GND, TX and RX crossed
  const ua = parts('uart-breakout')
  assert.deepEqual(fps('uart-breakout').sort(), ['C_0805', 'PinHeader_1x04', 'PinHeader_1x06'])
  assert.ok(ua.nets.find((n) => n.name === 'TX')!.pins.some((p) => p.ref === 'FTDI' && p.pin === '4') && ua.nets.find((n) => n.name === 'TX')!.pins.some((p) => p.ref === 'UART' && p.pin === '4'))
  assert.ok(ua.parts.every((p) => !p.hideRef), 'the reference names are the silkscreen labels')
  // LM358 amplifier: DIP-8, gain resistors, input / output / supply headers, ground planes on both layers
  const op = parts('lm358-amplifier')
  assert.ok(op.parts.some((p) => p.value === 'LM358' && p.fp === 'DIP-8'))
  assert.ok(op.parts.filter((p) => p.fp === 'R_0805').length === 2 && op.parts.filter((p) => /^PinHeader/.test(p.fp)).length === 3)
  assert.deepEqual(op.zones.map((z) => z.layer).sort(), ['B.Cu', 'F.Cu'])
  assert.deepEqual(op.nets.find((n) => n.name === 'FB')!.pins.map((p) => `${p.ref}.${p.pin}`).sort(), ['R1.2', 'R2.1', 'U1.2'])
})

// ------------------------------------------------------------------ the shared seeding helper

/** A drive in memory, a server of files and a localStorage, for seedExampleFolder. */
function harness(server: Record<string, string>) {
  const disk = new Map<string, string>()
  const dirs = new Set<string>()
  const fs: ExampleDrive = {
    exists: (p) => disk.has(p) || dirs.has(p),
    writeBytes: async (p, data) => {
      dirs.add(p.slice(0, p.lastIndexOf('/')))
      disk.set(p, new TextDecoder().decode(data))
    },
  }
  const store = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  const old = { fetch: g.fetch, localStorage: g.localStorage }
  const requests: string[] = []
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  g.fetch = async (url: string) => {
    requests.push(url)
    const name = decodeURIComponent(url.replace(/^\/examples\/demo\//, ''))
    const body = server[name]
    return body === undefined ? { ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer }
  }
  return { fs, disk, dirs, store, requests, restore: () => { g.fetch = old.fetch; g.localStorage = old.localStorage } }
}

test('seedExampleFolder: copies once, never overwrites, never brings back a deleted file, picks up new ones, tolerates failures', async () => {
  const index = (names: string[]) => JSON.stringify({ examples: names.map((n) => ({ file: n, title: n.replace(/\.demo$/, ''), group: n.startsWith('a') ? 'A' : 'B' })).concat([{ file: '../evil.demo', title: 'x', group: '' }, { file: 'dir/x.demo', title: 'y', group: '' }]) })
  const server: Record<string, string> = { 'index.json': index(['a one.demo', 'b two.demo']), 'a one.demo': 'ONE', 'b two.demo': 'TWO' }
  const h = harness(server)
  try {
    const opts = { app: 'demo', folderName: 'Demo Examples', fs: h.fs }
    const dir = '/home/user/Documents/Demo Examples'
    const first = await seedExampleFolder(opts)
    assert.deepEqual(first.map((f) => f.path), [`${dir}/a one.demo`, `${dir}/b two.demo`], 'path-like names in the index are ignored')
    assert.equal(h.disk.get(`${dir}/a one.demo`), 'ONE')
    assert.deepEqual(groupExamples(first).map((g) => [g.group, g.files.length]), [['A', 1], ['B', 1]])
    // the user edits one and deletes the other; a second run touches nothing
    h.disk.set(`${dir}/a one.demo`, 'MY EDIT')
    h.disk.delete(`${dir}/b two.demo`)
    const again = await seedExampleFolder(opts)
    assert.equal(h.disk.get(`${dir}/a one.demo`), 'MY EDIT', 'a changed file is never overwritten')
    assert.ok(!h.disk.has(`${dir}/b two.demo`), 'a deleted file does not come back')
    assert.deepEqual(again.map((f) => f.file), ['a one.demo'], 'and is not offered')
    // a new example in a later version is added
    server['index.json'] = index(['a one.demo', 'b two.demo', 'c three.demo'])
    server['c three.demo'] = 'THREE'
    const third = await seedExampleFolder(opts)
    assert.equal(h.disk.get(`${dir}/c three.demo`), 'THREE')
    assert.deepEqual(third.map((f) => f.file), ['a one.demo', 'c three.demo'])
    // one file the server lacks does not stop the others
    server['index.json'] = index(['a one.demo', 'd four.demo', 'e five.demo'])
    server['e five.demo'] = 'FIVE'
    const fourth = await seedExampleFolder(opts)
    assert.deepEqual(fourth.map((f) => f.file), ['a one.demo', 'e five.demo'])
    // a removed folder is made again in full
    for (const k of [...h.disk.keys()]) h.disk.delete(k)
    h.dirs.clear()
    const fresh = await seedExampleFolder(opts)
    assert.deepEqual(fresh.map((f) => f.file), ['a one.demo', 'e five.demo'])
    // no index on the server: nothing, no error
    delete server['index.json']
    assert.deepEqual(await seedExampleFolder(opts), [])
    // storage that throws, and a server that throws
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    server['index.json'] = index(['a one.demo'])
    assert.equal((await seedExampleFolder({ ...opts, folderName: 'Other' })).length, 1)
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => { throw new Error('offline') }
    assert.deepEqual(await seedExampleFolder(opts), [])
  } finally {
    h.restore()
  }
})

test('readExampleIndex and groupExamples: bad entries are dropped, groups keep their first-seen order', () => {
  assert.deepEqual(readExampleIndex(null), [])
  assert.deepEqual(readExampleIndex({ examples: 5 }), [])
  const r = readExampleIndex({ examples: [{ file: 'a.x', title: 'A', description: 'd', group: 'G' }, { file: '' }, { file: 'b.x' }, { title: 'no file' }, 7, { file: 'sub/c.x' }] })
  assert.deepEqual(r, [{ file: 'a.x', title: 'A', description: 'd', group: 'G' }, { file: 'b.x', title: 'b' }])
  const g = groupExamples([{ file: 'a', title: 'a', path: '/a', group: 'Y' }, { file: 'b', title: 'b', path: '/b', group: 'X' }, { file: 'c', title: 'c', path: '/c', group: 'Y' }, { file: 'd', title: 'd', path: '/d' }])
  assert.deepEqual(g.map((x) => [x.group, x.files.map((f) => f.file).join('')]), [['Y', 'ac'], ['X', 'b'], ['', 'd']])
})
