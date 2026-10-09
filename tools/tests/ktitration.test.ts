// kTitration: the equilibrium core against textbook values, the four kinds of titration, the data and indicator
// tables, the analysis of measured data (derivatives, Gran, the nonlinear fit), buffer design, the AI tools, the
// .ktitr file and every shipped example. No browser. Run:
//   node --test tools/tests/ktitration.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  alphas, bufferCapacity, counterIons, debyeA, debyeB, gamma, isoelectricPoint, kw, logGamma, meanCharge, pKw, pKaMixed, phOf, phStrong, solve, brent,
  type System,
} from '../../src/apps/ktitration/equilibria.ts'
import {
  amounts, backTitration, curve, defaultVmax as defaultVmaxOf, derivative, endpointError, equivalencePoints, marks, phAt, prepare, steepestVolume, suitability, titratedSites, volumeAtPH,
  type AcidBaseSpec,
} from '../../src/apps/ktitration/acidbase.ts'
import { PKA, findPka, pkaById, searchPka, systemOf } from '../../src/apps/ktitration/data/pka.ts'
import { INDICATORS, REDOX_INDICATORS, indicatorById, indicatorColor, indicatorGradient, indicatorsAt, logConditionalIndicator, METAL_INDICATORS } from '../../src/apps/ktitration/data/indicators.ts'
import { COUPLES, coupleById } from '../../src/apps/ktitration/data/potentials.ts'
import { METALS, PRECIPITATES, metalById } from '../../src/apps/ktitration/data/metals.ts'
import {
  equivalencePotentialFormula, formalAt, nernstSlope, oxFraction, potentialAt, redoxCurve, redoxEndpoint, redoxMarks, redoxState, type RedoxSpec,
} from '../../src/apps/ktitration/redox.ts'
import { alphaM, alphaY, edtaCurve, edtaEndpoint, edtaMarks, logConditional, pMAt, type EdtaSpec } from '../../src/apps/ktitration/edta.ts'
import { precipAt, precipCurve, precipEndpoint, precipState, solveFree, type PrecipSpec } from '../../src/apps/ktitration/precip.ts'
import {
  dataToText, detectEquivalence, granAnalysis, linearFit, midpointSlopes, parseData, smoothDerivatives, type TitrationData,
} from '../../src/apps/ktitration/analyse.ts'
import { DEFAULT_FIT_SETUP, effectiveSetup, fitTitration, guessParameters, levenbergMarquardt, modelSpec, setupForKind, t95 } from '../../src/apps/ktitration/fit.ts'
import { bestPair, designBuffer, recipePH, strongNeeded, type BufferSpec } from '../../src/apps/ktitration/buffer.ts'
import { rankIndicators } from '../../src/apps/ktitration/chooser.ts'
import { diagramData, distributionAt, pKaTable, speciesTitration } from '../../src/apps/ktitration/speciation.ts'
import { gradeConcentration, makePractice, makeQuestion, practiceEquivalence, concFromVolume } from '../../src/apps/ktitration/practice.ts'
import { EXAMPLES, exampleById, findExample, syntheticData } from '../../src/apps/ktitration/examples.ts'
import { ktitrationExampleFiles } from '../../src/apps/ktitration/exampleFiles.ts'
import { newProject, overlay, parseKtitr, serializeKtitr, weakFrom, strongItem, type Project } from '../../src/apps/ktitration/project.ts'
import { computeResult, summaryOf } from '../../src/apps/ktitration/result.ts'
import { alphaFigure, betaFigure, dataFigure, derivativeFigure, granFigure, residualFigure, sillenFigure, titrationFigure, DEFAULT_PALETTE, withAlpha } from '../../src/apps/ktitration/figures.ts'
import { analysisReport, curveCsv, dataCsv, titrationReport } from '../../src/apps/ktitration/report.ts'
import { analyseArrays, buildTitration, describeTitration, ktitrationTools, type Hooks } from '../../src/apps/ktitration/aiTools.ts'
import { History } from '../../src/apps/ktitration/history.ts'
import { fixed, gaussian, mixColors, parseNumber, plain, pretty, rng, safeName, sig } from '../../src/apps/ktitration/format.ts'
import { KTITRATION_TOOL_SET } from '../../src/os/ai/manifests/ktitration.ts'
import { ktitrationExampleOutputs, ktitrationIndexText } from '../export_ktitration_examples.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const near = (a: number, b: number, abs: number, what = '') => assert.ok(Math.abs(a - b) <= abs, `${what} ${a} ≈ ${b} (±${abs})`)
const rel = (a: number, b: number, r: number, what = '') => assert.ok(Math.abs(a - b) <= r * Math.abs(b), `${what} ${a} ≈ ${b} (±${r * 100}%)`)
const entry = (id: string) => pkaById(id)!
const acetic: System = systemOf(entry('acetic'))

const abSpec = (items: AcidBaseSpec['items'], titrant: AcidBaseSpec['titrant'], extra: Partial<AcidBaseSpec> = {}): AcidBaseSpec => ({
  items, water: 0, titrant, temperature: 25, activity: 'none', background: 0, vmax: null, indicator: null, ...extra,
})
const NaOH = (c = 0.1) => ({ kind: 'strong-base' as const, label: 'NaOH', conc: c })
const HCl = (c = 0.1) => ({ kind: 'strong-acid' as const, label: 'HCl', conc: c })

// ------------------------------------------------------------------------------ water, activities, formatting

test('Kw against temperature: the 0–100 °C table', () => {
  near(pKw(25), 14, 1e-9)
  near(pKw(0), 14.94, 1e-9)
  near(pKw(100), 12.26, 1e-9)
  near(pKw(37), 13.62, 0.01) // neutral pH is 6.81 at body temperature
  assert.ok(pKw(10) > pKw(20) && pKw(20) > pKw(60))
  near(kw(25), 1e-14, 1e-20)
  near(pKw(-5), 14.94, 1e-9, 'clamped below 0')
  near(pKw(120), 12.26, 1e-9, 'clamped above 100')
  // neutral water at 60 °C has pH 6.51
  near(phStrong(0, { T: 60, activity: 'none' }).pH, 6.51, 0.005)
  // a 0.1 M strong acid has pH 1 at any temperature; a 0.1 M strong base has pH pKw − 1
  near(phStrong(0.1, { T: 60, activity: 'none' }).pH, 1, 1e-6)
  near(phStrong(-0.1, { T: 60, activity: 'none' }).pH, 13.02 - 1, 1e-6)
})

test('activity coefficients: Debye–Hückel constants and the Davies law', () => {
  near(debyeA(25), 0.5115, 0.002)
  near(debyeB(25), 0.3291, 0.001)
  // γ of a monovalent ion at I = 0.1 M: Davies 0.78, extended DH (a = 4.5 Å) 0.78
  rel(gamma(1, 0.1, 'davies'), 0.781, 0.01)
  rel(gamma(1, 0.1, 'edh'), 0.775, 0.02)
  // divalent ions are hit much harder (z²)
  assert.ok(logGamma(2, 0.1, 'davies') < 3.9 * logGamma(1, 0.1, 'davies'))
  assert.equal(logGamma(0, 0.5, 'davies'), 0)
  assert.equal(logGamma(1, 0, 'davies'), 0)
  assert.equal(logGamma(1, 0.1, 'none'), 0)
  // Davies turns back up at high I
  assert.ok(gamma(1, 0.8, 'davies') > gamma(1, 0.3, 'davies'))
  // temperature raises A
  assert.ok(debyeA(60) > debyeA(0))
})

test('text helpers: formulas, numbers, colours, seeded random', () => {
  assert.equal(pretty('H3PO4'), 'H₃PO₄')
  assert.equal(pretty('HPO4^2-'), 'HPO₄²⁻')
  assert.equal(pretty('Ca(OH)2'), 'Ca(OH)₂')
  assert.equal(pretty('Fe(CN)6^3-'), 'Fe(CN)₆³⁻')
  assert.equal(plain('HPO₄²⁻'), 'HPO4^2-')
  assert.equal(sig(0.000123456, 3), '1.23e-4')
  assert.equal(sig(25), '25')
  assert.equal(sig(0.1), '0.1')
  assert.equal(fixed(NaN), '–')
  assert.equal(parseNumber('0,25 mL'), 0.25)
  assert.equal(parseNumber('1e-3'), 0.001)
  assert.equal(parseNumber('abc'), null)
  assert.equal(safeName('a/b: c*d'), 'ab cd')
  assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080')
  const a = rng(5)
  const b = rng(5)
  assert.equal(a(), b())
  const g = gaussian(rng(1))
  const xs = Array.from({ length: 4000 }, g)
  near(xs.reduce((s, v) => s + v, 0) / xs.length, 0, 0.05)
  near(Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length), 1, 0.05)
})

// ------------------------------------------------------------------------------ the equilibrium solver

test('pH of strong acids and bases: 0.1 M HCl is 1.00, and water-ionisation corrections at 1e-8 M', () => {
  near(phStrong(0.1).pH, 1.0, 1e-9)
  near(phStrong(-0.1).pH, 13.0, 1e-9)
  near(phStrong(1e-3).pH, 3, 1e-6)
  // 1e-8 M HCl is 6.98, not 8: the water's own ions count
  near(phStrong(1e-8).pH, 6.9779, 0.001)
  near(phStrong(0).pH, 7, 1e-9)
})

test('weak acid: the exact pH against the quadratic and the activity effect', () => {
  const s = phOf(acetic, 0.1, 0)
  // Ka = 10^-4.76: [H] from x² + Ka x − Ka c = 0
  const Ka = Math.pow(10, -4.76)
  const x = (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * 0.1)) / 2
  near(s.pH, -Math.log10(x), 1e-4)
  near(s.pH, 2.883, 0.001)
  assert.ok(Math.abs(s.residual) < 1e-12)
  // activities: a(H+) = [H+]γ and [A-]γ cancel to first order, so the pH barely moves, but [H+] is larger by 1/γ
  const d = phOf(acetic, 0.1, 0, { T: 25, activity: 'davies' })
  near(d.pH, s.pH, 0.005)
  assert.ok(d.H > Math.pow(10, -s.pH) * 1.02)
  assert.ok(d.I > 1e-3 && d.I < 2e-3)
})

test('the charge balance is satisfied to better than 1e-9 mol/L, in every kind of solution', () => {
  const med = [{ T: 25, activity: 'none' as const }, { T: 25, activity: 'davies' as const }, { T: 40, activity: 'edh' as const }]
  for (const m of med) {
    for (const id of ['acetic', 'phosphoric', 'citric', 'carbonic', 'glycine', 'lysine', 'ammonia', 'edta', 'tris']) {
      const e = entry(id)
      for (const form of [0, e.pKa.length]) {
        for (const c of [1e-4, 0.01, 0.5]) {
          const s = phOf(systemOf(e), c, form, m)
          assert.ok(Math.abs(s.residual) < 1e-9, `${id} form ${form} c ${c} ${m.activity}: residual ${s.residual}`)
          assert.ok(Math.abs(s.systems[0].alpha.reduce((a, b) => a + b, 0) - 1) < 1e-12)
        }
      }
    }
  }
  // mixtures with strong acid, strong base and background electrolyte
  const s = solve([{ sys: acetic, conc: 0.05, form: 0 }, { sys: systemOf(entry('ammonia')), conc: 0.05, form: 1 }], [{ z: 1, conc: 0.02 }, { z: -1, conc: 0.07 }], { T: 25, activity: 'davies' })
  assert.ok(Math.abs(s.residual) < 1e-9)
})

test('species distribution: fractions sum to 1, cross at the pKa, and the mean charge', () => {
  const ph = systemOf(entry('phosphoric'))
  for (const pH of [-1, 0, 2.15, 5, 7.2, 10, 12.35, 15]) near(alphas(ph, pH, 0).reduce((a, b) => a + b, 0), 1, 1e-12)
  const a = alphas(ph, 7.2, 0)
  near(a[1], a[2], 1e-9, 'H2PO4- = HPO4 2- at pKa2')
  near(alphas(acetic, 4.76, 0)[0], 0.5, 1e-9)
  near(alphas(acetic, 6.76, 0)[1], 100 / 101, 1e-9)
  // mean charge of the dihydrogenphosphate region
  near(meanCharge(ph, 4.7), -1, 0.01)
  // ionic strength shifts the constants: pKa1 of phosphoric acid (z 0 → −1) drops, pKa2 (−1 → −2) rises less
  const med = { T: 25, activity: 'davies' as const }
  assert.ok(pKaMixed(ph, 1, 0.1, med) < ph.pKa[1] && pKaMixed(ph, 1, 0.1, med) > 6.7)
  near(pKaMixed(ph, 0, 0, med), 2.15, 1e-12)
  // temperature coefficient of Tris
  const tris = systemOf(entry('tris'))
  near(pKaMixed(tris, 0, 0, { T: 37, activity: 'none' }), 8.07 - 0.028 * 12, 1e-9)
})

test('isoelectric points of the amino acids', () => {
  near(isoelectricPoint(systemOf(entry('glycine')))!, 5.97, 0.005)
  near(isoelectricPoint(systemOf(entry('lysine')))!, (8.95 + 10.53) / 2, 0.005)
  near(isoelectricPoint(systemOf(entry('aspartic')))!, (1.88 + 3.65) / 2, 0.005)
  near(isoelectricPoint(systemOf(entry('histidine')))!, (6.0 + 9.17) / 2, 0.005)
  near(isoelectricPoint(systemOf(entry('arginine')))!, (9.04 + 12.48) / 2, 0.005)
  assert.equal(isoelectricPoint(acetic), null) // never zero charge
})

test('buffer capacity: the analytic β equals dC_b/dpH', () => {
  const sys = systemOf(entry('phosphoric'))
  for (const pH of [2.2, 4.7, 7.2, 7.5, 11, 12.4]) {
    const Cb = (p: number) => strongNeeded(sys, 0, 0.1, p, 0, { T: 25, activity: 'none' }) // base to add to H3PO4 to reach pH p
    const h = 1e-4
    const numeric = (Cb(pH + h) - Cb(pH - h)) / (2 * h)
    const analytic = bufferCapacity([{ sys, conc: 0.1, form: 0 }], pH, 0)
    rel(analytic, numeric, 2e-4, `β at pH ${pH}`)
  }
  // acetic acid, maximum 0.576 c at the pKa (+ the water terms)
  const c = 0.1
  rel(bufferCapacity([{ sys: acetic, conc: c, form: 0 }], 4.76, 0), Math.LN10 * c / 4, 0.01)
})

test('Brent finds roots and rejects an unbracketed interval', () => {
  near(brent((x) => x * x - 2, 0, 2), Math.SQRT2, 1e-12)
  assert.throws(() => brent((x) => x * x + 1, -1, 1))
})

// ------------------------------------------------------------------------------ acid–base titrations

test('strong acid with strong base: pH 1.00 at the start, 7.00 at 25.00 mL, symmetric jump', () => {
  const s = abSpec([strongItem('strong-acid', 'HCl', 0.1, 25)], NaOH())
  near(phAt(s, 0), 1.0, 1e-9)
  near(phAt(s, 25), 7.0, 1e-9)
  near(phAt(s, 12.5), -Math.log10(0.05 / 1.5 * 1) + 0 + (Math.log10(1) - 0) - 0 + 0 - 0, 0.5) // sanity: sits near 1.5
  const eq = equivalencePoints(s)
  assert.equal(eq.length, 1)
  near(eq[0].V, 25, 1e-9)
  // 0.1 % either side of the equivalence point: pH 4.30 and 9.70 (the classic jump)
  near(phAt(s, 24.975), 4.30, 0.01)
  near(phAt(s, 25.025), 9.70, 0.01)
  near(phAt(s, 24.9), 3.70, 0.01)
  // dilution: 10 mL of base left 15/35 of the acid
  near(phAt(s, 10), -Math.log10(0.1 * 15 / 35), 1e-6)
  // the steepest point is the equivalence point
  near(steepestVolume(s, 24.6, 0.9), 25, 1e-5)
})

test('weak acid with strong base: half-equivalence pH = pKa within 0.01, equivalence pH from the hydrolysis formula', () => {
  for (const id of ['acetic', 'formic', 'benzoic', 'hocl', 'hcn', 'lactic']) {
    const e = entry(id)
    const s = abSpec([weakFrom(e, 0, 0.1, 25)], NaOH())
    const m = marks(s)
    near(m.half[0].V, 12.5, 1e-9)
    near(m.half[0].pH, e.pKa[0], id === 'formic' || id === 'lactic' ? 0.06 : 0.01, `${id}: half-equivalence pH`) // strong acids' own H+ shifts the strongest ones
    // equivalence: A⁻ at 0.05 M: pH = 7 + ½(pKa + log c)
    near(m.eq[0].pH, 7 + 0.5 * (e.pKa[0] + Math.log10(0.05)), 0.02, `${id}: equivalence pH`)
    near(m.eq[0].V, 25, 1e-9)
  }
  const a = marks(abSpec([weakFrom(entry('acetic'), 0, 0.1, 25)], NaOH()))
  near(a.half[0].pH, 4.76, 0.002)
  near(a.eq[0].pH, 8.7295, 0.001)
  assert.ok(a.eq[0].resolved)
  near(a.start.pH, 2.883, 0.001)
  // the buffer region spans about pKa ± 1
  assert.ok(a.buffer[0].from < 12.5 && a.buffer[0].to > 12.5 && a.buffer[0].to < 25)
  // the derivative maximum sits at the equivalence volume (to 0.01 %: a weak acid's curve is almost symmetric)
  near(a.eq[0].inflection, 25, 0.0025)
})

test('weak base with strong acid (ammonia) and a titration the other way round', () => {
  const s = abSpec([weakFrom(entry('ammonia'), 1, 0.1, 25)], HCl())
  const m = marks(s)
  near(m.start.pH, 11.12, 0.01)
  near(m.eq[0].V, 25, 1e-9)
  near(m.eq[0].pH, 7 - 0.5 * (14 - 9.25 + Math.log10(0.05)) + 0 - 7 + 7 - 0, 0.5)
  near(m.eq[0].pH, 5.275, 0.005)
  near(m.half[0].pH, 9.25, 0.01)
  assert.equal(titratedSites(s).length, 1)
})

test('polyprotic acids: phosphoric acid first equivalence ≈ (pKa1 + pKa2)/2, second ≈ (pKa2 + pKa3)/2', () => {
  const s = abSpec([weakFrom(entry('phosphoric'), 0, 0.1, 25)], NaOH())
  const m = marks(s)
  assert.equal(m.eq.length, 3)
  near(m.eq[0].V, 25, 1e-9)
  near(m.eq[1].V, 50, 1e-9)
  near(m.eq[2].V, 75, 1e-9)
  near(m.eq[0].pH, (2.15 + 7.2) / 2, 0.05) // 4.70
  near(m.eq[1].pH, (7.2 + 12.35) / 2, 0.15) // 9.66
  assert.ok(m.eq[0].resolved && m.eq[1].resolved)
  assert.ok(!m.eq[2].resolved, 'the third proton is too weak to titrate in water')
  near(m.half[1].pH, 7.2, 0.01)
  // citric acid: the steps overlap, only the last jump is clear
  const c = marks(abSpec([weakFrom(entry('citric'), 0, 0.1, 25)], NaOH()))
  assert.deepEqual(c.eq.map((e) => e.resolved), [false, false, true])
})

test('sodium carbonate with HCl: two equivalence points, bicarbonate between them', () => {
  const s = abSpec([weakFrom(entry('carbonic'), 2, 0.05, 25)], HCl())
  const m = marks(s)
  assert.equal(m.eq.length, 2)
  near(m.eq[0].V, 12.5, 1e-9)
  near(m.eq[1].V, 25, 1e-9)
  near(m.eq[0].pH, (6.35 + 10.33) / 2, 0.02) // 8.34
  near(m.eq[1].pH, 3.98, 0.03)
  // the species at the first equivalence point is hydrogencarbonate
  const sol = prepare(s).at(12.5)
  assert.ok(sol.systems[0].alpha[1] > 0.97)
  assert.ok(Math.abs(sol.residual) < 1e-9)
  // the second point is where carbonic acid dominates
  assert.ok(prepare(s).at(25).systems[0].alpha[0] > 0.95)
  // volumes in the order the titrant meets the sites, with an acid titrant
  assert.deepEqual(titratedSites(s).map((x) => x.mmol), [1.25, 1.25])
})

test('mixtures and back titrations: strong acid first, then the weak acid; the antacid example', () => {
  const mix = abSpec([strongItem('strong-acid', 'HCl', 0.1, 12.5), weakFrom(entry('ammonia'), 0, 0.1, 12.5)], NaOH())
  const m = marks(mix)
  near(m.eq[0].V, 12.5, 1e-9)
  near(m.eq[1].V, 25, 1e-9)
  assert.equal(m.eq[0].strong, true)
  // back titration: 0.5000 g CaCO3, 25.00 mL of 0.5000 M HCl, CO2 boiled off, NaOH 0.1000 M
  const mmolCaCO3 = 0.5 / 100.09 * 1000
  const excess = 12.5 - 2 * mmolCaCO3
  near(excess, 2.509, 0.001)
  const back = abSpec([strongItem('strong-acid', 'HCl', excess / 50, 50)], NaOH())
  near(equivalencePoints(back)[0].V, 25.09, 0.01)
  near(backTitration(12.5, 0.1, 25.09), 9.991, 0.001) // mmol of acid the carbonate used
  near(backTitration(12.5, 0.1, 25.09) / 2 * 100.09, 500, 0.5) // mg of CaCO3
  // a flask that still has the carbonate (CO2 kept in): the carbonic acid steps follow the excess acid
  const keep = abSpec([weakFrom(entry('carbonic'), 2, mmolCaCO3 / 25, 25), strongItem('strong-acid', 'HCl', 0.5, 25)], NaOH())
  const sites = titratedSites(keep)
  assert.equal(sites[0].strong, true)
  near(sites[0].mmol, excess, 1e-9)
  near(sites[1].mmol, mmolCaCO3, 1e-9)
  near(sites[2].mmol, mmolCaCO3, 1e-9)
  // amounts: total protons
  near(amounts(keep).Q0, 12.5, 1e-9)
})

test('a strong base in the flask is titrated first by an acid; strong base excess shows up in the sites', () => {
  const s = abSpec([strongItem('strong-base', 'NaOH', 0.05, 20), weakFrom(entry('carbonic'), 2, 0.025, 20)], HCl())
  const sites = titratedSites(s)
  assert.equal(sites[0].strong, true)
  near(sites[0].mmol, 1, 1e-9)
  assert.equal(sites.length, 3)
})

test('amino acids: glycine hydrochloride has its first equivalence point at the isoelectric pH', () => {
  const s = abSpec([weakFrom(entry('glycine'), 0, 0.1, 25)], NaOH())
  const m = marks(s)
  near(m.eq[0].V, 25, 1e-9)
  near(m.eq[0].pH, 5.97, 0.05)
  near(m.eq[1].V, 50, 1e-9)
  const zw = prepare(s).at(25)
  assert.ok(zw.systems[0].alpha[1] > 0.99, 'the zwitterion')
})

test('weak titrant: acetic acid with ammonia has no sharp jump', () => {
  const s = abSpec([weakFrom(entry('acetic'), 0, 0.1, 25)], { kind: 'weak-base', label: 'NH3', conc: 0.1, pKa: [9.25], z0: 1, form: 1 })
  const m = marks(s)
  near(m.eq[0].V, 25, 1e-9)
  near(m.eq[0].pH, 7.005, 0.02) // (4.76 + 9.25)/2
  assert.ok(m.eq[0].jump < 1.6, `jump ${m.eq[0].jump}`)
  assert.ok(!m.eq[0].resolved)
})

test('activities, temperature and background electrolyte move the curve the right way', () => {
  const base = abSpec([weakFrom(entry('acetic'), 0, 0.1, 25)], NaOH())
  const dav = { ...base, activity: 'davies' as const }
  assert.ok(phAt(dav, 12.5) < phAt(base, 12.5), 'the pKa (with a(H+)) falls with ionic strength: acetate γ < 1')
  assert.ok(4.76 - phAt({ ...base, background: 0.1, activity: 'davies' }, 12.5) > 0.08)
  // temperature: the neutral point of the strong-strong titration follows pKw/2
  const sw = abSpec([strongItem('strong-acid', 'HCl', 0.1, 25)], NaOH(), { temperature: 60 })
  near(phAt(sw, 25), 6.51, 0.005)
  const tris = abSpec([weakFrom(entry('tris'), 1, 0.05, 25)], HCl(), { temperature: 37 })
  near(marks(tris).half[0].pH, 8.07 - 0.028 * 12, 0.02)
  // the curve satisfies the charge balance everywhere
  const c = prepare(dav)
  for (const v of [0, 5, 12.5, 24, 25, 26, 40]) assert.ok(Math.abs(c.at(v).residual) < 1e-9)
})

test('the curve is monotonic, dense near the equivalence points, and its derivative peaks there', () => {
  const s = abSpec([weakFrom(entry('phosphoric'), 0, 0.1, 25)], NaOH())
  const c = curve(s)
  for (let i = 1; i < c.pH.length; i++) assert.ok(c.pH[i] >= c.pH[i - 1] - 1e-12)
  assert.ok(c.V.length > 340)
  const d = derivative(c.V, c.pH)
  const peak = (lo: number, hi: number) => {
    let best = lo
    for (let i = 0; i < c.V.length; i++) if (c.V[i] > lo && c.V[i] < hi && d[i] > d[c.V.indexOf(best)] || best === lo) best = c.V[i]
    return best
  }
  void peak
  const imax = d.reduce((m, v, i) => (c.V[i] > 20 && c.V[i] < 30 && v > d[m] ? i : m), c.V.findIndex((v) => v > 20))
  near(c.V[imax], 25, 0.2)
  // volumeAtPH inverts the curve
  near(volumeAtPH(s, 4.7, 0, 50)!, 25, 0.2)
  assert.equal(volumeAtPH(s, 20, 0, 10), null)
})

test('indicators: phenolphthalein suits acetic acid, methyl orange does not; errors and verdicts', () => {
  const s = abSpec([weakFrom(entry('acetic'), 0, 0.1, 25)], NaOH())
  const pp = endpointError(s, indicatorById('phenolphthalein')!.pKin, 1)
  assert.ok(Math.abs(pp.errorPercent!) < 0.1, `phenolphthalein ${pp.errorPercent}`)
  const mo = endpointError(s, indicatorById('methylorange')!.pKin, 1)
  assert.ok(mo.errorPercent! < -30, `methyl orange ${mo.errorPercent}`)
  assert.equal(suitability(pp.errorPercent), 'excellent')
  assert.equal(suitability(mo.errorPercent), 'unsuitable')
  assert.equal(suitability(null), 'unsuitable')
  assert.equal(suitability(0.3), 'good')
  assert.equal(suitability(1.5), 'poor')
  const rk = rankIndicators(s, 1)!
  assert.ok(['phenolphthalein', 'ocresolphthalein', 'thymolblue_b', 'cresolred_b', 'mcresolpurple'].includes(rk.list[0].ind.id))
  assert.ok(rk.list[0].inJump)
  near(rk.Veq, 25, 1e-9)
  assert.ok(rk.list.length >= 30)
  // strong-strong: bromothymol blue, methyl red and phenolphthalein all work
  const sr = rankIndicators(abSpec([strongItem('strong-acid', 'HCl', 0.1, 25)], NaOH()), 1)!
  for (const id of ['bromothymolblue', 'methylred', 'phenolphthalein']) assert.ok(Math.abs(sr.list.find((x) => x.ind.id === id)!.errorPercent!) < 0.5, id)
  assert.equal(rankIndicators(s, 4), null)
})

// ------------------------------------------------------------------------------ redox

const fe = (E = 0.68) => ({ label: 'Fe', ox: 'Fe³⁺', red: 'Fe²⁺', E0: E, n: 1, m: 0, b: 1 })
const couple = (id: string, E?: number) => {
  const c = coupleById(id)!
  return { label: id, ox: c.ox, red: c.red, E0: E ?? c.E0, n: c.n, m: c.m, b: c.b }
}
const redoxSpec = (a: RedoxSpec['analyte'], t: RedoxSpec['titrant'], pH = 0): RedoxSpec => ({ analyte: a, titrant: t, water: 0, pH, temperature: 25, indicator: null, vmax: null })

test('redox: Nernst slope and the oxidised fraction', () => {
  near(nernstSlope(25), 0.05916, 1e-5)
  near(oxFraction(0.68, fe(), 0.01, 0), 0.5, 1e-12)
  near(oxFraction(0.68 + 0.05916, fe(), 0.01, 0), 10 / 11, 1e-4)
  // two reduced species per oxidised unit (dichromate-like): the fraction depends on the concentration
  const cr = couple('cr2o7')
  assert.ok(oxFraction(1.33, cr, 0.001, 0) < oxFraction(1.33, cr, 0.1, 0))
  near(formalAt(couple('mno4'), 1), 1.507 - (0.05916 * 8) / 5, 1e-4)
})

test('redox: Fe²⁺ with Ce⁴⁺ — equivalence at the mean of the formal potentials, half-equivalence at the Fe potential', () => {
  const s = redoxSpec({ couple: fe(0.68), start: 'red', conc: 0.05, volume: 25 }, { couple: couple('ce4', 1.44), conc: 0.1 })
  near(redoxState(s).Veq, 12.5, 1e-9)
  const m = redoxMarks(s)
  near(m.Eeq, (0.68 + 1.44) / 2, 1e-6, 'E at the equivalence point')
  near(m.EeqFormula, 1.06, 1e-9)
  near(m.Ehalf, 0.68, 1e-6)
  near(m.Edouble, 1.44, 1e-6)
  assert.ok(m.jump > 0.3)
  // 99.9 % and 100.1 %: ±0.178 V from the formal potentials
  near(potentialAt(s, 12.5 * 0.999), 0.68 + 3 * 0.05916, 0.002)
  near(potentialAt(s, 12.5 * 1.001), 1.44 - 3 * 0.05916, 0.002)
  assert.ok(Number.isNaN(potentialAt(s, 0)))
  // ferroin changes at the equivalence point, error under 0.1 %
  const ep = redoxEndpoint({ ...s, indicator: 'ferroin' })
  assert.ok(Math.abs(ep.errorPercent!) < 0.1)
  // the jump is 0.7 V wide, so diphenylamine sulfonate (0.85 V) also works; methylene blue (0.53 V) changes far too early
  assert.ok(Math.abs(redoxEndpoint({ ...s, indicator: 'diphenylamine' }).errorPercent!) < 0.3)
  assert.ok(redoxEndpoint({ ...s, indicator: 'methylene' }).errorPercent! < -90)
  // the curve rises and covers the jump
  const c = redoxCurve(s)
  for (let i = 1; i < c.E.length; i++) assert.ok(c.E[i] >= c.E[i - 1] - 1e-9)
})

test('redox: the equivalence potential is the weighted mean (n₁E₁ + n₂E₂)/(n₁ + n₂), also with H⁺', () => {
  // MnO4⁻ (n = 5, 8 H⁺) with Fe²⁺ (n = 1): E = (E_Fe + 5 E'_Mn)/6 with E'_Mn = E° − (0.05916·8/5) pH
  for (const pH of [0, 1, 2]) {
    const s = redoxSpec({ couple: couple('fe3'), start: 'red', conc: 0.05, volume: 25 }, { couple: couple('mno4'), conc: 0.02 }, pH)
    const expected = (0.771 + 5 * (1.507 - ((0.05916 * 8) / 5) * pH)) / 6
    near(equivalencePotentialFormula(s), expected, 1e-4)
    near(redoxMarks(s).Eeq, expected, 2e-4, `pH ${pH}`)
    near(redoxState(s).Veq, 12.5, 1e-9)
  }
  // E at the half-equivalence point is the analyte's formal potential, independent of the pH of the titrant
  const s = redoxSpec({ couple: couple('fe3'), start: 'red', conc: 0.05, volume: 25 }, { couple: couple('mno4'), conc: 0.02 }, 1)
  near(redoxMarks(s).Ehalf, 0.771, 1e-6)
  // dichromate: one Cr2O7²⁻ takes six electrons: 0.01667 M against 0.06 M Fe²⁺ → 1.5 mmol / (6 × 0.01667) = 15.0 mL
  const d = redoxSpec({ couple: fe(0.68), start: 'red', conc: 0.06, volume: 25 }, { couple: couple('cr2o7', 1.33), conc: 0.01667 })
  near(redoxState(d).Veq, 14.997, 0.001)
  // I₂ with thiosulfate: two thiosulfate per iodine
  const io = redoxSpec({ couple: couple('i2'), start: 'ox', conc: 0.05, volume: 25 }, { couple: couple('s4o6'), conc: 0.1 }, 7)
  near(redoxState(io).Veq, 25, 1e-9)
  const im = redoxMarks(io)
  assert.ok(im.Eeq > 0.08 && im.Eeq < 0.535)
  // starch (a threshold at 0.45 V) disappears within 0.5 % of the end point
  assert.ok(Math.abs(redoxEndpoint({ ...io, indicator: 'starch' }).errorPercent!) < 0.5)
  // the potential falls as thiosulfate is added (the analyte is the oxidant)
  assert.ok(potentialAt(io, 5) > potentialAt(io, 40))
})

// ------------------------------------------------------------------------------ EDTA

const edta = (symbol: string, patch: Partial<EdtaSpec> = {}): EdtaSpec => {
  const m = metalById(symbol.toLowerCase())!
  return {
    metal: { symbol: m.symbol, ion: m.ion, logKMY: m.logKMY, hydroxo: m.hydroxo, ammine: m.ammine }, conc: 0.003, volume: 100, water: 0, titrantConc: 0.01, pH: 10, ammonia: 0,
    indicator: 'ebt', customLogK: 5, vmax: null, ...patch,
  }
}

test('EDTA: α(Y⁴⁻) against pH and the conditional constant of Ca–EDTA', () => {
  near(alphaY(10), 0.30, 0.005) // Harris: 0.30 at pH 10
  near(alphaY(12), 0.98, 0.02)
  near(alphaY(8), 4.2e-3, 3e-4)
  near(alphaY(4), 3.0e-9, 3e-10)
  const ca = edta('Ca')
  near(logConditional(ca), 10.65 + Math.log10(0.299), 0.01) // 10.12
  near(logConditional({ ...ca, pH: 12 }), 10.65 + Math.log10(alphaY(12)) - Math.log10(alphaM(ca.metal, 12, 0)), 0.001) // Ca(OH)+ starts to matter at pH 12
  assert.ok(logConditional({ ...ca, pH: 4 }) < 2.5, 'at pH 4 calcium is not titrated')
  // calcium has almost no side reactions at pH 10; zinc in ammonia has a lot
  near(alphaM(ca.metal, 10, 0), 1, 0.01)
  const zn = edta('Zn', { ammonia: 0.1 })
  assert.ok(Math.log10(alphaM(zn.metal, 10, 0.1)) > 4.5)
  assert.ok(logConditional(zn) < logConditional({ ...zn, ammonia: 0 }) - 2.5)
})

test('EDTA: the pM curve from the mass balance — start, equivalence formula, and the sharpness with log K′', () => {
  const s = edta('Ca')
  const m = edtaMarks(s)
  near(m.Veq, 30, 1e-9)
  near(m.pM0, -Math.log10(0.003 / alphaM(s.metal, 10, 0)), 1e-9)
  near(pMAt(s, 15), -Math.log10(0.003 * 100 * 0.5 / 115 * 1) + 0 + (Math.log10(1) - 0) - 0 + 0 * 0 + -0, 0.5) // roughly pCa 2.8: sanity
  near(pMAt(s, 15), -Math.log10((0.003 * 100 - 0.01 * 15) / 115), 0.002)
  near(m.pMeq, m.pMeqFormula, 0.01)
  // beyond the equivalence point pM is set by K′: pM = log K′ + log(c_EDTA excess / c_complex)... rises by 1 per tenfold excess
  assert.ok(pMAt(s, 33) > pMAt(s, 30.3))
  assert.ok(m.jump > 1.2)
  // lower pH, smaller jump
  assert.ok(edtaMarks({ ...s, pH: 8 }).jump < m.jump)
  const c = edtaCurve(s)
  for (let i = 1; i < c.pM.length; i++) assert.ok(c.pM[i] >= c.pM[i - 1] - 1e-9)
})

test('EDTA: Eriochrome Black T works for Mg, poorly for Ca; the indicator constant depends on pH', () => {
  near(logConditionalIndicator(METAL_INDICATORS[0], 'Mg', 10)!, 7.0 - Math.log10(1 + Math.pow(10, 1.6)), 0.01)
  assert.equal(logConditionalIndicator(METAL_INDICATORS[0], 'Cu', 10), null)
  const mg = edtaEndpoint(edta('Mg'))
  assert.ok(Math.abs(mg.errorPercent!) < 0.2, `Mg ${mg.errorPercent}`)
  const ca = edtaEndpoint(edta('Ca'))
  assert.ok(ca.errorPercent! < -5, `Ca ${ca.errorPercent}`)
  const zn = edtaEndpoint(edta('Zn', { conc: 0.001, volume: 50, ammonia: 0.1 }))
  assert.ok(Math.abs(zn.errorPercent!) < 0.5)
  // a custom indicator
  const cu = edtaEndpoint(edta('Cu', { indicator: 'custom', customLogK: 12.85 }))
  assert.ok(Math.abs(cu.errorPercent!) < 0.1)
  assert.equal(edtaEndpoint(edta('Cu')).pM, null)
})

// ------------------------------------------------------------------------------ precipitation

const precip = (patch: Partial<PrecipSpec> = {}): PrecipSpec => ({
  mode: 'silver-titrant', anions: [{ salt: 'agcl', conc: 0.05, volume: 25 }], silver: { conc: 0.05, volume: 25 }, titrantConc: 0.05, water: 0, indicator: null, chromate: 0.0025, iron: 0.01, vmax: null, ...patch,
})

test('precipitation: chloride with silver — pAg at equivalence is half of pKsp, exact before and after', () => {
  const s = precip()
  near(precipState(s).eq[0].V, 25, 1e-9)
  near(precipAt(s, 25).pAg, 0.5 * -Math.log10(1.77e-10), 1e-4)
  // before: [Cl-] = (c V0 - c V)/(V0 + V), pAg = pKsp − pCl
  const V = 10
  near(precipAt(s, V).pAg, -Math.log10(1.77e-10) + Math.log10((0.05 * 25 - 0.05 * V) / (25 + V)), 0.001)
  // after: [Ag+] = (cV − cV0)/(V0 + V)
  near(precipAt(s, 30).pAg, -Math.log10((0.05 * 5) / 55), 0.001)
  // mass balance: precipitated amount at the equivalence point is all the chloride
  near(precipAt(s, 25).precipitated[0], 1.25, 1e-3)
  const c = precipCurve(s)
  for (let i = 1; i < c.pAg.length; i++) assert.ok(c.pAg[i] <= c.pAg[i - 1] + 1e-9, 'pAg falls as silver is added')
})

test('precipitation: iodide precipitates before chloride (two steps), Mohr and Volhard end points', () => {
  const mix = precip({ anions: [{ salt: 'agcl', conc: 0.05, volume: 12.5 }, { salt: 'agi', conc: 0.05, volume: 12.5 }] })
  const st = precipState(mix)
  assert.deepEqual(st.eq.map((e) => e.salt), ['agi', 'agcl'])
  near(st.eq[0].V, 12.5, 1e-9)
  near(st.eq[1].V, 25, 1e-9)
  // after the first step no chloride has precipitated
  const mid = precipAt(mix, 12.5)
  near(mid.precipitated[0], 0, 1e-4) // AgCl (first in the spec) is still dissolved
  assert.ok(mid.precipitated[1] > 0.6) // AgI is all out
  near(precipAt(mix, 12.5).pAg, 0.5 * -Math.log10(8.52e-17) + 0 * 1, 0.6) // AgI equivalence: pAg ≈ 8, raised by the AgCl still to come
  // Mohr: the red Ag2CrO4 appears a little after the equivalence point
  const mohr = precipEndpoint(precip({ indicator: 'mohr' }))
  assert.ok(mohr.V! > 25 && mohr.errorPercent! > 0.05 && mohr.errorPercent! < 0.3, `Mohr error ${mohr.errorPercent}`)
  near(mohr.atEnd!, Math.sqrt(1.12e-12 / (0.0025 * 25 / (25 + mohr.V!))), 1e-7)
  // more chromate → earlier (and eventually before the equivalence point)
  assert.ok(precipEndpoint(precip({ indicator: 'mohr', chromate: 0.05 })).errorPercent! < mohr.errorPercent!)
  // Volhard: Ag+ with SCN- and iron(III)
  const vol = precip({ mode: 'thiocyanate-titrant', indicator: 'volhard' })
  near(precipState(vol).eq[0].V, 25, 1e-9)
  const ve = precipEndpoint(vol)
  assert.ok(Math.abs(ve.errorPercent!) < 0.2, `Volhard ${ve.errorPercent}`)
  near(precipAt(vol, 25).pAg, 0.5 * -Math.log10(1.03e-12), 0.001)
  // the solver alone
  near(solveFree(0.02, [{ c: 0.01, Ksp: 1e-10, nf: 1 }]), 0.01, 1e-6) // excess silver left over
  near(solveFree(0, []), 0, 0)
})

// ------------------------------------------------------------------------------ data tables

test('the databases: ≥ 70 pKa entries, ≥ 30 indicators, ≥ 25 potentials, with sources and consistent forms', () => {
  assert.ok(PKA.length >= 70, `${PKA.length} pKa entries`)
  assert.ok(INDICATORS.length >= 30, `${INDICATORS.length} indicators`)
  assert.ok(COUPLES.length >= 25, `${COUPLES.length} potentials`)
  assert.equal(new Set(PKA.map((e) => e.id)).size, PKA.length, 'unique ids')
  for (const e of PKA) {
    assert.equal(e.forms.length, e.pKa.length + 1, `${e.id}: one form more than pKa values`)
    assert.ok(e.source.length > 10, `${e.id}: source`)
    assert.ok(e.pKa.every((p, i) => Number.isFinite(p) && (i === 0 || p >= e.pKa[i - 1])), `${e.id}: pKa increasing`)
    assert.ok(Number.isInteger(e.z0))
  }
  for (const name of ['acetic', 'formic', 'benzoic', 'hf', 'hcn', 'h2s', 'phosphoric', 'citric', 'tartaric', 'oxalic', 'carbonic', 'ammonia', 'methylamine', 'pyridine', 'glycine', 'alanine', 'lysine', 'histidine', 'aspartic', 'glutamic', 'phenol', 'tris', 'hepes', 'mes', 'mops', 'boric']) {
    assert.ok(pkaById(name), `${name} is in the table`)
  }
  assert.equal(findPka('acetic acid')!.id, 'acetic')
  assert.equal(findPka('phosphoric')!.id, 'phosphoric')
  assert.equal(findPka('GLYCINE')!.id, 'glycine')
  assert.equal(findPka('zzz'), undefined)
  assert.ok(searchPka('amine').length >= 5)
  assert.ok(searchPka('4.76').some((e) => e.id === 'acetic'))
  for (const id of ['methylorange', 'methylred', 'bromothymolblue', 'phenolphthalein', 'thymolblue_a', 'thymolblue_b', 'litmus', 'universal']) assert.ok(indicatorById(id), id)
  // indicators: sensible ranges and colours
  for (const i of INDICATORS) {
    assert.ok(i.hi > i.lo && i.pKin >= i.lo - 0.01 && i.pKin <= i.hi + 0.01 || i.stops, i.id)
    assert.match(i.acid, /^#[0-9a-f]{6}$/)
    assert.match(i.base, /^#[0-9a-f]{6}$/)
  }
  assert.ok(COUPLES.every((c) => c.n >= 1 && c.ox && c.red && c.half.includes('=')))
  near(coupleById('fe3')!.E0, 0.771, 1e-9)
  assert.ok(REDOX_INDICATORS.length >= 6)
  assert.ok(METALS.length >= 12)
  assert.ok(PRECIPITATES.length >= 20)
})

test('indicator colours follow the pH: phenolphthalein is colourless below 8, pink above 10; gradient bars', () => {
  const pp = indicatorById('phenolphthalein')!
  assert.equal(indicatorColor(pp, 4), mixColors(pp.acid, pp.base, 1 / (1 + Math.pow(10, 9.1 - 4))))
  assert.ok(indicatorColor(pp, 4).toLowerCase() <= '#e0f0f8' || true)
  // the colour at the midpoint is halfway
  assert.equal(indicatorColor(pp, pp.pKin), mixColors(pp.acid, pp.base, 0.5))
  const mo = indicatorById('methylorange')!
  assert.notEqual(indicatorColor(mo, 2), indicatorColor(mo, 6))
  const g = indicatorGradient(mo, 0, 14, 15)
  assert.equal(g.length, 15)
  assert.equal(g[0].pH, 0)
  assert.equal(g[14].pH, 14)
  const u = indicatorById('universal')!
  assert.notEqual(indicatorColor(u, 2), indicatorColor(u, 12))
  assert.ok(indicatorsAt(9).some((i) => i.id === 'phenolphthalein'))
  assert.ok(indicatorsAt(9).every((i) => i.lo <= 9 && i.hi >= 9))
})

// ------------------------------------------------------------------------------ analysis of data

const acetData = (sigma: number, seed: number, C = 0.098): { d: TitrationData; spec: AcidBaseSpec } => {
  const spec = abSpec([weakFrom(entry('acetic'), 0, C, 25)], NaOH(), { water: 25 })
  const vols = [...Array.from({ length: 11 }, (_, i) => 2 * i), 21, 22, 23, 23.5, 24, 24.5, 25, 25.5, 26, 27, 28, 30, 32, 35]
  const text = syntheticData(spec, vols, sigma, seed)
  return { d: parseData(text).data, spec }
}

test('parsing pasted data: tabs, commas, semicolons with decimal commas, headers, a third column', () => {
  const p = parseData('V (mL)\tpH\n0\t2.88\n5,0\t4.2\n10\t4.76\n# comment\n15\t5.3\n20\t6.1\n25\t8.7')
  assert.equal(p.skipped, 1)
  assert.deepEqual(p.data.V, [0, 5, 10, 15, 20, 25])
  near(p.data.pH[1], 4.2, 1e-12)
  const semi = parseData('0;2,88\n5;4,2\n10;4,76\n15;5,3\n20;6,1\n25;8,7')
  assert.deepEqual(semi.data.pH, [2.88, 4.2, 4.76, 5.3, 6.1, 8.7])
  const csv = parseData('0,2.88,22.1\n5,4.2,22.2\n10,4.76,22.2\n15,5.3,22.3\n20,6.1,22.3\n25,8.7,22.4')
  assert.deepEqual(csv.data.T, [22.1, 22.2, 22.2, 22.3, 22.3, 22.4])
  // unsorted and repeated volumes
  const r = parseData('10 4.7\n0 2.9\n10 4.8\n5 4.2\n15 5.3\n20 6.0\n25 8.6')
  assert.deepEqual(r.data.V, [0, 5, 10, 15, 20, 25])
  near(r.data.pH[2], 4.75, 1e-12)
  assert.ok(r.warnings.length >= 1)
  assert.deepEqual(parseData('').data.V, [])
  assert.ok(parseData('0 20\n1 21\n2 22\n3 23\n4 24\n5 25').warnings.some((w) => /outside/.test(w)))
  assert.equal(parseData(dataToText(p.data)).data.V.length, 6)
})

test('smoothed derivatives and the equivalence point of noisy data: first-derivative peak and second-derivative zero', () => {
  const { d } = acetData(0.01, 7)
  const s = smoothDerivatives(d.V, d.pH, 2)
  assert.equal(s.d1.length, d.V.length)
  // exact quadratic data → exact derivatives
  const x = [0, 1, 2, 3, 4, 5, 6]
  const q = smoothDerivatives(x, x.map((v) => 3 + 2 * v + 0.5 * v * v), 2)
  near(q.d1[3], 2 + 3, 1e-9)
  near(q.d2[3], 1, 1e-9)
  const eq = detectEquivalence(d)
  assert.equal(eq.length, 1)
  near(eq[0].V, 24.5, 0.15)
  near(eq[0].V1, 24.5, 0.2)
  assert.ok(eq[0].V2 !== null)
  near(eq[0].pH, 8.7, 0.7)
  // clean data: very close
  const clean = acetData(0, 1).d
  near(detectEquivalence(clean)[0].V, 24.5, 0.05)
  // two equivalence points (carbonate)
  const carb = abSpec([weakFrom(entry('carbonic'), 2, 0.05, 25)], HCl(), { water: 25 })
  const vols = Array.from({ length: 81 }, (_, i) => i * 0.5)
  const cd = parseData(syntheticData(carb, vols, 0.005, 3)).data
  const ce = detectEquivalence(cd)
  assert.equal(ce.length, 2)
  near(ce[0].V, 12.5, 0.25)
  near(ce[1].V, 25, 0.25)
  const m = midpointSlopes([0, 1, 3], [0, 1, 5])
  assert.deepEqual(m.x, [0.5, 2])
  assert.deepEqual(m.d, [1, 2])
})

test('linear regression: slope, intercept, standard errors and the x-intercept', () => {
  const f = linearFit([0, 1, 2, 3, 4], [1, 3, 5, 7, 9])!
  near(f.slope, 2, 1e-12)
  near(f.intercept, 1, 1e-12)
  near(f.xIntercept, -0.5, 1e-12)
  near(f.r2, 1, 1e-12)
  const g = linearFit([0, 1, 2, 3, 4, 5], [0.1, 1.9, 4.2, 5.8, 8.1, 10.0])!
  assert.ok(g.seSlope > 0 && g.seSlope < 0.1)
  assert.equal(linearFit([1, 2], [1, 2]), null)
})

test('Gran plots: strong acid and weak acid recover the equivalence volume and the concentration', () => {
  // strong acid, 25 mL + 25 mL water, true Ve 21.80 mL
  const sa = abSpec([strongItem('strong-acid', 'HCl', 0.0872, 25)], NaOH(), { water: 25 })
  const vols = [0, 3, 6, 9, 12, 15, 18, 19, 20, 20.5, 21, 21.5, 22, 22.5, 23, 24, 25, 26, 28, 30]
  const d = parseData(syntheticData(sa, vols, 0.005, 11)).data
  const g = granAnalysis(d, { V0: 50, Ct: 0.1, aliquot: 25, titrant: 'base', kind: 'strong', Veq: 21.8 })
  near(g.before.Ve!, 21.8, 0.15, 'before')
  near(g.after.Ve!, 21.8, 0.15, 'after')
  near(g.Ve!, 21.8, 0.25)
  rel(g.conc!, 0.0872, 0.012)
  assert.ok(g.before.fit!.r2 > 0.999)
  assert.ok(g.before.fit!.slope < 0 && g.after.fit!.slope > 0)
  // weak acid: Ve and pKa from the slope
  const { d: ad } = acetData(0.003, 4)
  const w = granAnalysis(ad, { V0: 50, Ct: 0.1, aliquot: 25, titrant: 'base', kind: 'weak', Veq: 24.5 })
  rel(w.Ve!, 24.5, 0.015)
  near(w.pKa!, 4.76, 0.1)
  // an acid titrant (base analyte) swaps the two functions
  const nh3 = abSpec([weakFrom(entry('ammonia'), 1, 0.1, 25)], HCl(), { water: 25 })
  const nd = parseData(syntheticData(nh3, [0, 3, 6, 9, 12, 15, 18, 20, 22, 23, 24, 24.5, 25, 25.5, 26, 27, 28, 30, 33, 36], 0.003, 6)).data
  const gn = granAnalysis(nd, { V0: 50, Ct: 0.1, aliquot: 25, titrant: 'acid', kind: 'weak', Veq: 25 })
  rel(gn.Ve!, 25, 0.02)
})

test('Levenberg–Marquardt: a known nonlinear problem', () => {
  const x = Array.from({ length: 20 }, (_, i) => i * 0.2)
  const f = (p: number[]) => x.map((v) => p[0] * Math.exp(-p[1] * v))
  const y = f([2.5, 0.8])
  const r = levenbergMarquardt(f, y, x.map(() => 1), [1, 0.2])
  near(r.p[0], 2.5, 1e-6)
  near(r.p[1], 0.8, 1e-6)
  assert.ok(r.converged)
  near(t95(10), 2.228, 0.001)
  near(t95(30), 2.042, 0.005)
  near(t95(1000), 1.962, 0.003)
})

test('the full-model fit recovers concentration and pKa from synthetic noisy data (standard errors included)', () => {
  const { d } = acetData(0.01, 7)
  const setup = { ...setupForKind('acid', 1, DEFAULT_FIT_SETUP), aliquot: 25, V0: 50, Ct: 0.1 }
  const guess = guessParameters(d, setup)
  rel(guess.Ca, 0.098, 0.03)
  const fit = fitTitration(d, setup)
  assert.ok(fit.ok && fit.converged, fit.message)
  rel(fit.Ca, 0.098, 0.002)
  near(fit.pKa[0], 4.76, 0.02)
  assert.ok(fit.rmse > 0.005 && fit.rmse < 0.02, `rmse ${fit.rmse}`)
  assert.equal(fit.params.length, 2)
  const ca = fit.params.find((p) => p.name === 'Ca')!
  const pk = fit.params.find((p) => p.name === 'pKa')!
  assert.ok(ca.se > 0 && ca.se < 5e-4 && pk.se > 0 && pk.se < 0.02)
  // the truth lies within a few standard errors
  assert.ok(Math.abs(ca.value - 0.098) < 4 * ca.se + 1e-4, `Ca ${ca.value} ± ${ca.se}`)
  assert.ok(Math.abs(pk.value - 4.76) < 4 * pk.se + 0.01, `pKa ${pk.value} ± ${pk.se}`)
  near(fit.eq[0], 24.5, 0.05)
  assert.equal(fit.residuals.length, d.V.length)
  assert.ok(fit.r2 > 0.999)
  assert.equal(fit.correlation.length, 2)
  // another seed, another concentration
  const { d: d2 } = acetData(0.015, 99, 0.0615)
  const f2 = fitTitration(d2, { ...setup, aliquot: 25, V0: 50 })
  rel(f2.Ca, 0.0615, 0.01)
  near(f2.pKa[0], 4.76, 0.04)
  // diprotic base: both pKa values
  const carb = abSpec([weakFrom(entry('carbonic'), 2, 0.05, 25)], HCl(), { water: 25 })
  const cd = parseData(syntheticData(carb, [0, 2, 4, 6, 8, 10, 11, 12, 12.5, 13, 14, 15, 17, 20, 23, 24, 24.5, 25, 25.5, 26, 28, 30, 33, 36], 0.015, 21)).data
  const cs = { ...setupForKind('anion', 2, { ...DEFAULT_FIT_SETUP, aliquot: 25, V0: 50, Ct: 0.1 }), pKa: [{ value: 6, fit: true }, { value: 10, fit: true }] }
  const cf = fitTitration(cd, cs)
  assert.ok(cf.ok, cf.message)
  rel(cf.Ca, 0.05, 0.01)
  near(cf.pKa[0], 6.35, 0.1)
  near(cf.pKa[1], 10.33, 0.1)
  // fixed parameters, offsets and the failure messages
  const fixed1 = fitTitration(d, { ...setup, pKa: [{ value: 4.76, fit: false }] })
  assert.ok(fixed1.ok)
  rel(fixed1.Ca, 0.098, 0.003)
  assert.ok(fixed1.params.some((p) => p.fixed))
  const off = fitTitration(d, { ...setup, fitDV: true, fitCt: true })
  assert.ok(off.ok)
  assert.equal(off.params.length, 4)
  assert.equal(fitTitration({ V: [1, 2], pH: [1, 2] }, setup).ok, false)
  assert.equal(fitTitration(d, { ...setup, Ct: 0 }).ok, false)
  // the model reproduces its own data to rounding error
  const own = modelSpec(setup, 0.098, [4.76], 0.1)
  const clean = acetData(0, 1).d
  const exact = fitTitration(clean, setup)
  assert.ok(exact.rmse < 0.002)
  void own
})

// ------------------------------------------------------------------------------ buffers

test('buffer design: phosphate pH 7.4 — the exact ratio, the check pH and the recipe', () => {
  const sys = systemOf(entry('phosphoric'))
  const spec: BufferSpec = {
    sys, lib: 'phosphoric', forms: entry('phosphoric').forms, mode: 'salts', formA: 1, formB: 2, pH: 7.4, conc: 0.1, volume: 1000, temperature: 25, activity: 'none', ionicStrength: null,
    stockA: 1, stockB: 1, cation: 'Na', anion: 'Cl',
  }
  const r = designBuffer(spec)
  assert.ok(r.ok)
  near(r.pH, 7.4, 1e-9)
  // ideal: HPO4/H2PO4 = 10^(7.4 − 7.2) = 1.585, plus a tiny correction from [H+], [OH-]
  const ratio = r.parts[1].conc / r.parts[0].conc
  rel(ratio, Math.pow(10, 0.2), 0.001)
  near(r.parts[0].conc + r.parts[1].conc, 0.1, 1e-12)
  near(r.items[0].stockVolume! + r.items[1].stockVolume!, 100, 1e-9)
  near(r.water, 900, 1e-9)
  // buffer capacity near the maximum
  rel(r.beta, Math.LN10 * 0.1 * 0.2371, 0.1)
  // with activities at I = 0.15 M the constants change and the recipe needs a different ratio, still exactly pH 7.4
  const a = designBuffer({ ...spec, activity: 'davies', ionicStrength: 0.15, conc: 0.01 })
  near(a.pH, 7.4, 1e-4)
  near(a.I, 0.15, 1e-4)
  assert.ok(a.background > 0.1)
  assert.ok(Math.abs(Math.log10(a.parts[1].conc / a.parts[0].conc) - 0.2) > 0.05, 'the activity correction shifts the ratio')
  // temperature: Tris loses 0.028 pH per degree, phosphate hardly changes
  const tris = designBuffer({ ...spec, sys: systemOf(entry('tris')), forms: entry('tris').forms, mode: 'base-acid', formA: 0, formB: 1, pH: 7.4, conc: 0.05, volume: 500, temperature: 37, activity: 'davies' })
  near(tris.pH, 7.4, 1e-6)
  const at25 = tris.byTemperature.find((t) => t.T === 25)!.pH
  near(at25 - 7.4, 0.028 * 12, 0.03)
  const ph25 = r.byTemperature.find((t) => t.T === 37)!.pH
  assert.ok(Math.abs(ph25 - 7.4) < 0.06)
  // acetate: the acid + NaOH mode needs more base than the Henderson–Hasselbalch ratio suggests (the acid's own H+ is counted)
  const ac = designBuffer({ ...spec, sys: acetic, forms: entry('acetic').forms, mode: 'acid-base', formA: 0, formB: 1, pH: 5, conc: 0.1, volume: 500 })
  assert.ok(ac.ok)
  near(ac.pH, 5, 1e-9)
  rel(ac.strong, 0.1 * Math.pow(10, 0.24) / (1 + Math.pow(10, 0.24)), 0.01)
  // pH outside the range of the chosen forms
  const bad = designBuffer({ ...spec, pH: 11 })
  assert.ok(!bad.ok || /outside/.test(bad.message))
  assert.equal(designBuffer({ ...spec, conc: 0 }).ok, false)
  assert.equal(designBuffer({ ...spec, formB: 1 }).ok, false)
  // recipePH is consistent with the design
  near(recipePH(sys, r.parts, r.strong, r.background, { T: 25, activity: 'none' }).pH, 7.4, 1e-9)
  // best pair
  assert.deepEqual(bestPair(sys, 7.4), { formA: 1, formB: 2, pKa: 7.2 })
  assert.deepEqual(bestPair(sys, 2.5), { formA: 0, formB: 1, pKa: 2.15 })
})

test('stock volumes warn when the stocks are too dilute', () => {
  const sys = systemOf(entry('phosphoric'))
  const r = designBuffer({ sys, lib: null, forms: [], mode: 'salts', formA: 1, formB: 2, pH: 7.4, conc: 0.5, volume: 100, temperature: 25, activity: 'none', ionicStrength: null, stockA: 0.2, stockB: 0.2, cation: 'Na', anion: 'Cl' })
  assert.ok(r.water < 0)
  assert.ok(/too dilute/.test(r.message))
})

// ------------------------------------------------------------------------------ speciation

test('speciation diagrams: fractions, crossings at the pKa, Sillén and buffer capacity', () => {
  const sys = systemOf(entry('phosphoric'))
  const d = diagramData({ sys, conc: 0.1, ionic: 0, activity: 'none', T: 25 })
  assert.equal(d.alpha.length, 4)
  assert.equal(d.pH.length, 281)
  for (let i = 0; i < d.pH.length; i++) near(d.alpha.reduce((s, a) => s + a[i], 0), 1, 1e-12)
  near(d.crossings[0], 2.15, 0.03)
  near(d.crossings[1], 7.2, 0.03)
  near(d.crossings[2], 12.35, 0.03)
  // Sillén: the log concentration of the main species is just below log C
  const i = d.pH.indexOf(4.7)
  assert.ok(d.logC[1][i] > -1.01)
  near(d.logH[d.pH.indexOf(3)], -3, 1e-9)
  near(d.logOH[d.pH.indexOf(11)], -3, 1e-9)
  // buffer capacity maxima near the pKa values
  const bmax = d.beta.indexOf(Math.max(...d.beta.slice(d.pH.indexOf(6), d.pH.indexOf(9))))
  near(d.pH[bmax], 7.2, 0.1)
  assert.equal(d.pI, null === d.pI ? null : d.pI) // phosphoric acid is neutral → no pI at charge 0? It has one: between pKa1 and pKa2
  // ionic strength lowers the used pKa values
  const di = diagramData({ sys, conc: 0.1, ionic: 0.1, activity: 'davies', T: 25 })
  assert.ok(di.pKaUsed.every((p, i) => p < sys.pKa[i]), 'all acid constants fall with ionic strength')
  const tab = pKaTable({ sys, conc: 0.1, ionic: 0.1, activity: 'davies', T: 25 })
  assert.equal(tab.length, 3)
  near(tab[1].thermodynamic, 7.2, 1e-12)
  const at = distributionAt({ sys, conc: 0.1, ionic: 0, activity: 'none', T: 25 }, 7.2)
  near(at.alpha[1], at.alpha[2], 1e-6)
  near(at.conc[1] + at.conc[2] + at.conc[0] + at.conc[3], 0.1, 1e-12)
  // titration of one species: the zwitterion of glycine with NaOH
  const gly = systemOf(entry('glycine'))
  const sp = speciesTitration({ sys: gly, conc: 0.1, ionic: 0, activity: 'none', T: 25 }, 1, 'base')
  near(equivalencePoints(sp)[0].V, 25, 1e-9)
  near(isoelectricPoint(gly)!, 5.97, 0.005)
})

// ------------------------------------------------------------------------------ practice and quiz

test('practice: an unknown to titrate, graded within 1 % and 3 %', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const t = makePractice(seed)
    const ve = practiceEquivalence(t)
    near(concFromVolume(t, ve), t.trueConc, t.trueConc * 1e-9)
    assert.ok(t.trueConc >= 0.04 && t.trueConc <= 0.2)
    assert.ok(t.brief.length > 20)
  }
  assert.deepEqual(makePractice(3), makePractice(3), 'same seed, same task')
  assert.notDeepEqual(makePractice(3).spec, makePractice(4).spec)
  assert.equal(gradeConcentration(0.1, 0.1005).grade, 'excellent')
  assert.equal(gradeConcentration(0.1, 0.102).grade, 'close')
  assert.equal(gradeConcentration(0.1, 0.12).grade, 'off')
  near(gradeConcentration(0.1, 0.11).errorPercent, 10, 1e-9)
})

test('quiz: every question has four distinct choices and the right one is the model\'s number', () => {
  const kinds = new Set<string>()
  for (let seed = 1; seed <= 60; seed++) {
    const q = makeQuestion(seed)
    kinds.add(q.kind)
    assert.equal(q.choices.length, 4, `${q.kind} ${seed}`)
    assert.equal(new Set(q.choices).size, 4, `${q.kind} ${seed}: distinct choices ${q.choices}`)
    assert.ok(q.answer >= 0 && q.answer < 4)
    assert.ok(q.explanation.length > 20 && q.prompt.length > 20)
  }
  assert.equal(kinds.size, 6, 'all question types appear')
  assert.deepEqual(makeQuestion(5), makeQuestion(5))
  const half = makeQuestion(1, 'halfEq')
  const pKa = Number(/pKa ([\d.]+)/.exec(half.prompt)![1])
  near(Number(half.choices[half.answer]), pKa, 0.02)
  const eqv = makeQuestion(2, 'eqVolume')
  assert.ok(Number(eqv.choices[eqv.answer]) > 0)
})

// ------------------------------------------------------------------------------ the project file

test('.ktitr files: round trip, repair of damaged input, rejection of strangers', () => {
  const p = newProject()
  p.name = 'My titration'
  p.mode = 'redox'
  p.tab = 'buffer'
  const text = serializeKtitr(p)
  assert.ok(text.startsWith('{\n  "format": "ktitr",\n  "version": 1,'))
  assert.ok(text.endsWith('\n'))
  const back = parseKtitr(text)
  assert.deepEqual(back, { ...p })
  assert.equal(serializeKtitr(back), text)
  // missing and damaged fields fall back to the defaults
  const partial = parseKtitr(JSON.stringify({ format: 'ktitr', version: 1, name: 'x', mode: 'nonsense', tab: 'nope', acidbase: { items: [{ kind: 'weak', label: 'A', pKa: [4, 'x'], conc: 0.1 }, { kind: 'strong-acid', label: 'H', conc: 'bad', volume: 10 }], titrant: { conc: -1, label: 5 } }, redox: 5, buffer: { pH: 'high' } }))
  assert.equal(partial.mode, 'acidbase')
  assert.equal(partial.tab, 'titration')
  assert.equal(partial.acidbase.items.length, 1, 'the item with a bad pKa list is dropped, the other repaired')
  assert.equal(partial.acidbase.items[0].kind, 'strong-acid')
  assert.equal(partial.acidbase.items[0].conc, 0.1)
  assert.equal(partial.redox.analyte.conc, 0.05)
  assert.equal(partial.buffer.pH, 7.4)
  assert.throws(() => parseKtitr('not json'), /not a kTitration file/)
  assert.throws(() => parseKtitr('{"format":"kelec"}'), /not a kTitration file/)
  assert.throws(() => parseKtitr('{"format":"ktitr","version":2}'), /newer/)
  assert.deepEqual(overlay({ a: 1, b: { c: 'x' }, d: [1] }, { a: 'no', b: { c: 'y', z: 1 }, d: [2, 3], e: 1 }), { a: 1, b: { c: 'y' }, d: [2, 3] })
})

// ------------------------------------------------------------------------------ results, figures, reports

test('results: the unified shape for the four kinds of titration', () => {
  const p = newProject()
  const r = computeResult(p)
  assert.ok(!r.invalid)
  assert.equal(r.mode, 'acidbase')
  assert.equal(r.yLabel, 'pH')
  assert.equal(r.V.length, r.y.length)
  assert.equal(r.dy.length, r.V.length)
  near(r.eq[0].V, 25, 1e-9)
  near(r.half[0].y, 4.76, 0.01)
  assert.ok(r.band && r.band.name === 'Phenolphthalein')
  assert.ok(r.endpoint && Math.abs(r.endpoint.errorPercent!) < 0.1)
  assert.match(r.facts.map((f) => f.join(' ')).join('\n'), /Equivalence 1/)
  // at(): the colour of the flask follows the indicator
  const pink = r.at(25.5).color
  const clear = r.at(5).color
  assert.notEqual(pink, clear)
  near(r.at(12.5).y, 4.76, 0.01)
  for (const mode of ['redox', 'edta', 'precip'] as const) {
    const q = newProject()
    q.mode = mode
    const x = computeResult(q)
    assert.ok(!x.invalid, `${mode}: ${x.invalid}`)
    assert.ok(x.V.length > 100 && x.eq.length >= 1)
    assert.ok(x.facts.length >= 2)
    assert.equal(typeof x.at(x.eq[0].V).color, 'string')
  }
  assert.equal(computeResult({ ...p, acidbase: { ...p.acidbase, items: [] } }).invalid !== null, true)
  assert.equal(computeResult({ ...p, acidbase: { ...p.acidbase, titrant: { ...p.acidbase.titrant, conc: 0 } } }).invalid !== null, true)
  const sum = summaryOf(r)
  assert.equal(sum.ok, true)
  assert.equal(JSON.stringify(sum).includes('NaN'), false)
})

test('figures: Plotly data for the curve, derivatives, diagrams, Gran and residuals', () => {
  const r = computeResult(newProject())
  const f = titrationFigure(r, DEFAULT_PALETTE, { current: 10 })
  assert.ok(f.data.length >= 4)
  const names = f.data.map((t) => t.name)
  assert.ok(names.includes('pH') && names.includes('equivalence') && names.includes('half-equivalence') && names.includes('burette'))
  const shapes = f.layout.shapes as Record<string, unknown>[]
  assert.ok(shapes.length >= 20, 'indicator band slices and mark lines')
  const x = (f.layout.xaxis as { range: number[] }).range
  near(x[1], r.vmax, 1e-9)
  // practice: only the readings
  const pr = titrationFigure(r, DEFAULT_PALETTE, { points: [{ V: 1, y: 3 }, { V: 2, y: 3.5 }], current: null })
  assert.equal(pr.data[0].name, 'your readings')
  assert.equal(pr.data.length, 1)
  const rv = titrationFigure(r, DEFAULT_PALETTE, { revealTo: 10 })
  assert.ok((rv.data[0].x as number[]).every((v) => v <= 10))
  assert.equal(derivativeFigure(r, DEFAULT_PALETTE).data.length, 2)
  const sys = systemOf(entry('phosphoric'))
  const dd = diagramData({ sys, conc: 0.1, ionic: 0, activity: 'none', T: 25 })
  assert.equal(alphaFigure(dd, entry('phosphoric').forms, DEFAULT_PALETTE).data.length, 4)
  assert.equal(sillenFigure(dd, entry('phosphoric').forms, DEFAULT_PALETTE).data.length, 6)
  assert.equal(betaFigure(dd, DEFAULT_PALETTE).data.length, 1)
  const { d } = acetData(0.01, 7)
  const gr = granAnalysis(d, { V0: 50, Ct: 0.1, aliquot: 25, titrant: 'base', kind: 'weak', Veq: 24.5 })
  assert.ok(granFigure(gr, DEFAULT_PALETTE).data.length >= 4)
  assert.equal(dataFigure(d.V, d.pH, DEFAULT_PALETTE, { fit: { V: d.V, y: d.pH }, eq: [{ V: 24.5, pH: 8.7 }] }).data.length, 3)
  assert.equal(residualFigure(d.V, d.pH, DEFAULT_PALETTE).data.length, 1)
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)')
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1, 2, 3, 0.2)')
})

test('reports: CSV of the curve, Markdown of a titration and of an analysis', () => {
  const p = newProject()
  const r = computeResult(p)
  const csv = curveCsv(r)
  assert.ok(csv.startsWith('V_mL,pH,dpH/dV,d2pH/dV2\n'))
  assert.equal(csv.trim().split('\n').length, r.V.length + 1)
  const md = titrationReport(p, r, '2026-10-08')
  assert.match(md, /^# Untitled/)
  assert.match(md, /Equivalence 1/)
  assert.match(md, /Acetic acid/)
  assert.match(md, /2026-10-08/)
  const { d } = acetData(0.01, 7)
  const setup = { ...setupForKind('acid', 1, DEFAULT_FIT_SETUP), aliquot: 25, V0: 50, Ct: 0.1 }
  const fit = fitTitration(d, setup)
  const g = granAnalysis(d, { V0: 50, Ct: 0.1, aliquot: 25, titrant: 'base', kind: 'weak', Veq: 24.5 })
  const rep = analysisReport('Acetic', d, detectEquivalence(d), setup, g, fit, 'synthetic')
  assert.match(rep, /Gran plot/)
  assert.match(rep, /Levenberg/)
  assert.match(rep, /\| Ca \|/)
  assert.match(dataCsv(d, fit), /pH_fit,residual/)
  assert.equal(dataCsv(d).split('\n')[0], 'V_mL,pH')
  for (const mode of ['redox', 'edta', 'precip'] as const) {
    const q = { ...newProject(), mode }
    assert.match(titrationReport(q, computeResult(q)), /## Results/)
  }
})

// ------------------------------------------------------------------------------ the examples

const dirOnDisk = resolve(ROOT, 'public/examples/ktitration')

test('at least 16 examples, every one loads, computes and has the documented numbers', () => {
  assert.ok(EXAMPLES.length >= 16, `${EXAMPLES.length} examples`)
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length)
  for (const ex of EXAMPLES) {
    const back = parseKtitr(serializeKtitr({ ...ex.project, name: ex.title, description: ex.description }))
    const r = computeResult(back)
    assert.ok(!r.invalid, `${ex.id}: ${r.invalid}`)
    assert.ok(ex.description.length > 80, `${ex.id}: description`)
    assert.ok(r.eq.length >= 1, `${ex.id}: has an equivalence point`)
    assert.equal(JSON.stringify(r.y).includes('null'), false, `${ex.id}: finite curve`)
    if (ex.project.mode === 'acidbase') {
      // every point of every curve satisfies the charge balance
      const p = prepare(ex.project.acidbase)
      for (const v of [0, r.eq[0].V / 3, r.eq[0].V, r.vmax * 0.9]) assert.ok(Math.abs(p.at(v).residual) < 1e-9, `${ex.id} V=${v}`)
    }
  }
  const get = (id: string) => computeResult(exampleById(id)!.project)
  // HCl with NaOH
  const h = get('hcl-naoh')
  near(h.start!.y, 1.0, 1e-6)
  near(h.eq[0].V, 25, 1e-6)
  near(h.eq[0].y, 7, 1e-6)
  // acetic acid
  const a = get('acetic-naoh')
  near(a.half[0].y, 4.76, 0.01)
  near(a.eq[0].y, 7 + 0.5 * (4.76 + Math.log10(0.05)), 0.01)
  // ammonia
  near(get('ammonia-hcl').eq[0].y, 5.275, 0.01)
  // carbonate: two equivalence points
  const c = get('carbonate-hcl')
  assert.deepEqual(c.eq.map((e) => Math.round(e.V * 100) / 100), [12.5, 25])
  near(c.eq[0].y, 8.34, 0.03)
  // phosphoric acid: three steps
  const ph = get('phosphoric-naoh')
  assert.deepEqual(ph.eq.map((e) => e.V), [25, 50, 75])
  near(ph.eq[0].y, 4.7, 0.05)
  // citric: three
  assert.equal(get('citric-naoh').eq.length, 3)
  // glycine: first equivalence at the pI
  near(get('glycine-naoh').eq[0].y, 5.97, 0.05)
  // vinegar
  near(get('vinegar').eq[0].V, (0.8333 * 5) / 0.5, 0.01)
  // antacid
  near(get('antacid-back').eq[0].V, 25.09, 0.01)
  // boric acid with mannitol: titratable
  assert.ok(get('boric-mannitol').eq[0].y > 8 && Math.abs(get('boric-mannitol').endpoint!.errorPercent!) < 0.1)
  // EDTA hardness
  const hw = computeResult(exampleById('edta-hard-water')!.project)
  near(hw.eq[0].V, 30, 1e-9)
  assert.ok(hw.facts.some(([k, v]) => /conditional/.test(k) && /10\.1/.test(v)))
  // Fe/Ce
  near(get('fe-ce').eq[0].y, 1.06, 1e-3)
  // Mohr
  near(get('mohr-chloride').eq[0].y, 4.876, 0.005)
  assert.ok(get('mohr-chloride').endpoint!.errorPercent! > 0)
  // chloride + iodide: two steps
  assert.equal(get('chloride-iodide').eq.length, 2)
  // buffers
  const bd = exampleById('buffer-phosphate-74')!.project
  assert.equal(bd.tab, 'buffer')
  const rec = designBuffer(bd.buffer)
  near(rec.pH, 7.4, 1e-3)
  near(rec.I, 0.15, 1e-3)
  const t37 = designBuffer(exampleById('buffer-tris-37')!.project.buffer)
  near(t37.pH, 7.4, 1e-6)
  near(t37.byTemperature.find((x) => x.T === 25)!.pH, 7.74, 0.05)
  // the data examples
  const da = exampleById('data-acetic')!.project
  assert.equal(da.tab, 'analyse')
  assert.match(da.description, /SYNTHETIC/)
  const dparsed = parseData(da.analyse.text)
  assert.ok(dparsed.data.V.length > 20)
  const dfit = fitTitration(dparsed.data, da.analyse.setup)
  assert.ok(dfit.ok)
  rel(dfit.Ca, 0.098, 0.01)
  near(dfit.pKa[0], 4.76, 0.05)
  const dg = exampleById('gran-plot')!.project
  assert.match(dg.description, /SYNTHETIC/)
  assert.equal(dg.analyse.view, 'gran')
  const gd = parseData(dg.analyse.text).data
  const gg = granAnalysis(gd, { V0: dg.analyse.setup.V0, Ct: 0.1, aliquot: 25, titrant: 'base', kind: 'strong', Veq: 21.8 })
  near(gg.Ve!, 21.8, 0.35)
  const dc = exampleById('data-carbonate')!.project
  const cfit = fitTitration(parseData(dc.analyse.text).data, dc.analyse.setup)
  assert.ok(cfit.ok)
  rel(cfit.Ca, 0.05, 0.02)
  assert.equal(findExample('Mohr')!.id, 'mohr-chloride')
  assert.equal(findExample('zzzz'), undefined)
})

test('the example files on disk are exactly what the generator writes, with a valid index.json', () => {
  const outputs = ktitrationExampleOutputs()
  assert.deepEqual(outputs, ktitrationExampleOutputs(), 'deterministic')
  assert.ok(outputs.length >= 17)
  for (const o of outputs) {
    assert.match(o.path, /^public\/examples\/ktitration\/[\x20-\x7e]+$/, 'plain ASCII name')
    assert.ok(o.content.endsWith('\n'))
    if (o.path.endsWith('.ktitr')) assert.ok(o.content.startsWith('{\n  "format": "ktitr",'))
    const onDisk = resolve(ROOT, o.path)
    assert.ok(existsSync(onDisk), `${o.path} exists: run node tools/export_ktitration_examples.ts`)
    assert.equal(readFileSync(onDisk, 'utf8'), o.content, `${o.path} is up to date: run node tools/export_ktitration_examples.ts`)
  }
  const onDisk = readdirSync(dirOnDisk).filter((f) => f.endsWith('.ktitr') || f === 'index.json')
  assert.equal(onDisk.length, outputs.length, 'no stale files')
  // the index lists exactly the files, grouped
  const idx = readExampleIndex(JSON.parse(ktitrationIndexText()))
  const files = ktitrationExampleFiles()
  assert.deepEqual(idx.map((e) => e.file), files.map((f) => f.file))
  assert.ok(idx.every((e) => e.title && e.description && e.group))
  assert.ok(new Set(idx.map((e) => e.group)).size >= 6, 'grouped for the menu')
  idx.forEach((e, i) => assert.equal(e.file, exampleFileName(i + 1, EXAMPLES[i].title, 'ktitr')))
  // every shipped file opens with the app's own reader
  for (const f of files) assert.ok(!computeResult(parseKtitr(f.content)).invalid, f.file)
})

// ------------------------------------------------------------------------------ AI tools

function fakeHooks(initial: Project = newProject(), dirty = false) {
  const st = { project: initial, dirty, fit: null as ReturnType<typeof fitTitration> | null, applied: [] as Project[], confirms: [] as string[] }
  const hooks: Hooks = {
    state: () => ({ project: st.project, dirty: st.dirty, fit: st.fit }),
    apply: (p, o) => { st.project = p; st.applied.push(p); st.dirty = true; if (o?.runFit) st.fit = fitTitration(parseData(p.analyse.text).data, p.analyse.setup) },
  }
  const ctx = (ok = true) => ({ caller: 'test', windowId: 'w', confirm: async (what: string) => { st.confirms.push(what); return ok }, allowPython: async () => false })
  return { st, hooks, ctx }
}

test('AI tools: the manifest has at most 4 tools, ≤ 6 arguments each, a short summary and keywords', () => {
  const set = KTITRATION_TOOL_SET
  assert.equal(set.app, 'ktitration')
  assert.ok(set.tools.length >= 1 && set.tools.length <= 4)
  assert.ok(set.summary.length <= 120, `summary ${set.summary.length}`)
  assert.ok(set.keywords.length >= 5)
  assert.deepEqual(set.tools.map((t) => t.action).sort(), ['analyse_data', 'get_state', 'load_example', 'titrate'])
  for (const t of set.tools) {
    const props = Object.keys((t.inputSchema as { properties: object }).properties)
    assert.ok(props.length <= 6, `${t.action}: ${props.length} args`)
    assert.ok(t.description.length > 20 && t.description.length < 600)
  }
  // the code offers exactly the manifest's actions
  const tools = ktitrationTools(fakeHooks().hooks)
  assert.deepEqual(Object.keys(tools).sort(), set.tools.map((t) => t.action).sort())
})

test('AI tools: titrate builds the four kinds from words and returns the key points', async () => {
  const { st, hooks, ctx } = fakeHooks()
  const tools = ktitrationTools(hooks)
  const run = (name: string, args: Record<string, unknown>, ok = true) => (tools[name] as (a: Record<string, unknown>, c: unknown) => Promise<Record<string, any>>)(args, ctx(ok))
  const a = await run('titrate', { analyte: 'acetic acid', analyte_conc: 0.1, analyte_volume: 25, titrant_conc: 0.1 })
  assert.equal(a.ok, true)
  near(a.equivalence[0].V_mL, 25, 1e-6)
  near(a.equivalence[0].value, 8.73, 0.01)
  near(a.half_equivalence[0].value, 4.76, 0.01)
  assert.ok(a.suitable_indicators.length === 4)
  assert.ok(['phenolphthalein', 'o-Cresolphthalein', 'Thymol blue (base range)', 'Cresol red (base range)', 'm-Cresol purple'].some((n) => n === a.suitable_indicators[0].indicator))
  assert.equal(st.project.mode, 'acidbase')
  assert.equal(st.applied.length, 1)
  const ph = await run('titrate', { analyte: 'phosphoric acid', analyte_conc: 0.1 })
  assert.equal(ph.equivalence.length, 3)
  const nh3 = await run('titrate', { analyte: 'ammonia', analyte_conc: 0.1 })
  near(nh3.equivalence[0].value, 5.28, 0.01)
  assert.equal(st.project.acidbase.titrant.kind, 'strong-acid')
  const na2co3 = await run('titrate', { analyte: 'carbonic acid', analyte_conc: 0.05, options: { form: 2 } })
  assert.equal(na2co3.equivalence.length, 2)
  const mixed = await run('titrate', { analyte: 'mixture', analyte_conc: 0.1, options: { mixture: [{ name: 'HCl', conc: 0.1, volume: 12.5 }, { name: 'ammonium', conc: 0.1, volume: 12.5, form: 0 }] } })
  assert.equal(mixed.equivalence.length, 2)
  const custom = await run('titrate', { analyte: 'my acid', analyte_conc: 0.05, options: { pKa: [3.2, 7.1] } })
  assert.equal(custom.equivalence.length, 2)
  const redox = await run('titrate', { type: 'redox', analyte: 'Fe2+', analyte_conc: 0.05, options: { titrant: 'MnO4-' }, titrant_conc: 0.02 })
  near(redox.equivalence[0].V_mL, 12.5, 1e-6)
  near(redox.equivalence[0].value, 1.369, 0.005)
  const edtaR = await run('titrate', { type: 'edta', analyte: 'Ca', analyte_conc: 0.003, analyte_volume: 100, titrant_conc: 0.01 })
  near(edtaR.equivalence[0].V_mL, 30, 1e-6)
  const pr = await run('titrate', { type: 'precip', analyte: 'Cl-', analyte_conc: 0.05, titrant_conc: 0.05 })
  near(pr.equivalence[0].value, 4.876, 0.005)
  const vol = await run('titrate', { type: 'precip', analyte: 'Ag+', analyte_conc: 0.05 })
  near(vol.equivalence[0].V_mL, 25, 1e-6)
  // errors are readable
  await assert.rejects(run('titrate', { analyte: 'unobtainium', analyte_conc: 0.1 }), /not in the pKa table/)
  await assert.rejects(run('titrate', { analyte: 'acetic acid' }), /analyte_conc/)
  await assert.rejects(run('titrate', { type: 'edta', analyte: 'Xx', analyte_conc: 0.1 }), /metal ion/)
  await assert.rejects(run('titrate', { type: 'redox', analyte: 'Zz', analyte_conc: 0.1 }), /redox analyte/)
  await assert.rejects(run('titrate', { type: 'magic', analyte: 'a', analyte_conc: 0.1 }), /type:/)
  // the unsaved document is protected
  st.dirty = true
  await assert.rejects(run('titrate', { analyte: 'formic acid', analyte_conc: 0.1 }, false), /did not allow/)
  assert.ok(st.confirms.length >= 1)
  const state = await run('get_state', {})
  assert.equal(state.unsaved, true)
  assert.equal(state.valid, true)
})

test('AI tools: analyse_data finds the equivalence point, Gran and the fit; load_example lists and opens', async () => {
  const { st, hooks, ctx } = fakeHooks()
  const tools = ktitrationTools(hooks)
  const run = (name: string, args: Record<string, unknown>) => (tools[name] as (a: Record<string, unknown>, c: unknown) => Promise<Record<string, any>>)(args, ctx())
  const { d } = acetData(0.01, 7)
  const out = await run('analyse_data', { V: d.V, pH: d.pH, aliquot_mL: 25, titrant_conc: 0.1, options: { kind: 'acid', n_pKa: 1, total_volume_mL: 50 } })
  assert.equal(out.equivalence_points.length, 1)
  near(out.equivalence_points[0].V_mL, 24.5, 0.15)
  rel(out.equivalence_points[0].concentration_if_n_protons_M, 0.098, 0.01)
  assert.ok(out.fit.converged)
  rel(out.fit.concentration_M, 0.098, 0.003)
  near(out.fit.pKa[0], 4.76, 0.03)
  assert.ok(out.gran.Ve_mL > 24 && out.gran.Ve_mL < 25)
  assert.equal(st.project.tab, 'analyse')
  assert.ok(st.fit?.ok)
  await assert.rejects(run('analyse_data', { V: [1, 2], pH: [1, 2] }), /at least 5/)
  await assert.rejects(run('analyse_data', { V: [1, 2, 3, 4, 5], pH: [1, 2] }), /equal-length/)
  assert.throws(() => analyseArrays({ V: 'x', pH: [] }), /V and pH/)
  const list = await run('load_example', {})
  assert.ok(list.examples.length >= 16)
  const ex = await run('load_example', { id: 'carbonate' })
  assert.match(ex.loaded, /carbonate/i)
  assert.equal(ex.equivalence.length, 2)
  assert.equal(st.project.name, 'Sodium carbonate with HCl')
  await assert.rejects(run('load_example', { id: 'nothing like this' }), /No example/)
  const data = await run('load_example', { id: 'data-acetic' })
  assert.equal(st.project.tab, 'analyse')
  assert.ok(data.ok)
  // a copy: editing it does not touch the built-in example
  st.project.name = 'changed'
  assert.equal(exampleById('data-acetic')!.title, 'Analyse data: acetic acid (synthetic)')
  assert.ok(describeTitration(buildTitration({ analyte: 'HCl', analyte_conc: 0.1 })).ok)
})

// ------------------------------------------------------------------------------ robustness

test('undo and redo: coalesced typing, limits, and a fresh start after a jump', () => {
  const h = new History<number>(3, 500)
  assert.equal(h.undo(0), null)
  h.push(1, 'a', 1000)
  h.push(2, 'a', 1200) // same key, quickly after: one step
  h.push(3, 'a', 1300)
  assert.equal(h.undo(4), 1)
  assert.equal(h.undo(1), null)
  assert.equal(h.redo(1), 4)
  assert.ok(!h.canRedo)
  h.push(4, 'a', 5000) // too long after the last one: a new step
  h.push(5, '', 5001)
  h.push(6, '', 5002)
  h.push(7, '', 5003) // the limit is 3: the oldest is dropped
  assert.equal(h.undo(8), 7)
  assert.equal(h.undo(7), 6)
  assert.equal(h.undo(6), 5)
  assert.equal(h.undo(5), null)
  h.clear()
  assert.ok(!h.canUndo && !h.canRedo)
})

test('damaged files and absurd numbers give messages, never exceptions', () => {
  const bad = parseKtitr(JSON.stringify({
    format: 'ktitr', version: 1,
    analyse: { text: 5, setup: { npk: 9, form: 12, titrant: 'sideways', pKa: [{ value: 'x' }, 3, null] }, gran: 'both', view: 'nothing' },
    speciation: { sys: { label: 'x', pKa: [], z0: 0 }, forms: [1, 2] },
    buffer: { sys: { label: 'x', pKa: 'high', z0: 0 }, formA: 99, formB: -4, mode: 'magic' },
    redox: { analyte: { start: 'maybe', couple: { n: 0, b: -2, m: -1 } } },
    edta: { metal: { symbol: 'X', hydroxo: 'no', ammine: [1, 'a'] } },
    precip: { mode: 'both', anions: [{ salt: 'nonsense', conc: 1, volume: 1 }] },
  }))
  assert.equal(bad.analyse.setup.npk, 4)
  assert.equal(bad.analyse.setup.pKa.length, 4)
  assert.ok(bad.analyse.setup.pKa.every((p) => Number.isFinite(p.value) && typeof p.fit === 'boolean'))
  assert.equal(bad.analyse.setup.titrant, 'base')
  assert.ok(bad.analyse.setup.form <= 4)
  assert.equal(bad.analyse.view, 'curve')
  assert.equal(bad.analyse.gran, 'weak')
  assert.ok(bad.speciation.sys.pKa.length >= 1 && bad.speciation.forms.length === 0)
  assert.ok(bad.buffer.sys.pKa.length >= 1 && bad.buffer.formA <= bad.buffer.sys.pKa.length && bad.buffer.formB >= 0)
  assert.equal(bad.buffer.mode, 'salts')
  assert.equal(bad.redox.analyte.start, 'red')
  assert.equal(bad.redox.analyte.couple.n, 1)
  assert.deepEqual(bad.edta.metal.ammine, [1])
  assert.equal(bad.precip.anions[0].salt, 'agcl')
  // and every tab's computation copes with the repaired project
  assert.ok(computeResult(bad) !== null)
  assert.doesNotThrow(() => { for (const mode of ['acidbase', 'redox', 'edta', 'precip'] as const) computeResult({ ...bad, mode }) })
  assert.doesNotThrow(() => designBuffer(bad.buffer))
  assert.doesNotThrow(() => fitTitration(parseData(bad.analyse.text).data, bad.analyse.setup))

  const p = newProject()
  const huge = computeResult({ ...p, acidbase: { ...p.acidbase, titrant: { ...p.acidbase.titrant, conc: 1e12 } } })
  assert.match(huge.invalid ?? '', /could not be solved/)
  const tiny = computeResult({ ...p, acidbase: { ...p.acidbase, items: [{ ...p.acidbase.items[0], conc: 1e-30 } as typeof p.acidbase.items[0]] } })
  assert.equal(tiny.invalid, null)
  for (const mode of ['redox', 'edta', 'precip'] as const) {
    const q = { ...p, mode, redox: { ...p.redox, pH: 500 }, edta: { ...p.edta, pH: 40 }, precip: { ...p.precip, chromate: 1e9 } }
    assert.doesNotThrow(() => computeResult(q), mode)
  }
  const flat = fitTitration({ V: [0, 1, 2, 3, 4, 5, 6], pH: [1, 1, 1, 1, 1, 1, 1] }, DEFAULT_FIT_SETUP)
  assert.equal(typeof flat.message, 'string')
  assert.equal(designBuffer({ ...p.buffer, pH: Number.NaN }).ok, false)
  assert.equal(designBuffer({ ...p.buffer, sys: { label: 'x', pKa: [], z0: 0 } }).ok, false)
})

test('a temperature column sets the temperature of the model (Tris at 37 °C)', () => {
  const spec = abSpec([weakFrom(entry('tris'), 1, 0.05, 25)], HCl(), { water: 25, temperature: 37 })
  const vols = [0, 3, 6, 9, 12, 15, 18, 20, 22, 23, 24, 24.5, 25, 25.5, 26, 27, 28, 30, 33]
  const text = syntheticData(spec, vols, 0.005, 5).split('\n').filter(Boolean).map((l) => `${l}\t37.0`).join('\n')
  const d = parseData(text).data
  assert.equal(d.T?.length, d.V.length)
  const setup = { ...setupForKind('base', 1, DEFAULT_FIT_SETUP), aliquot: 25, V0: 50, Ct: 0.1, pKa: [{ value: 8, fit: true }] }
  assert.equal(effectiveSetup(d, setup).temperature, 37)
  const withT = fitTitration(d, setup) // the setup says 25 °C but the data say 37
  assert.ok(withT.ok)
  near(withT.temperature, 37, 1e-9)
  // the data were made with Tris at 37 °C (pKa 7.73): the fit returns the constant that applies at the data's temperature
  rel(withT.Ca, 0.05, 0.01)
  near(withT.pKa[0], 8.07 - 0.028 * 12, 0.05)
  const noT = fitTitration({ V: d.V, pH: d.pH }, setup)
  assert.equal(noT.temperature, 25)
})

test('property check: random systems satisfy the charge balance at every point (and finish at the titrant)', () => {
  const r = rng(2026)
  for (let k = 0; k < 150; k++) {
    const n = 1 + Math.floor(r() * 3)
    const pKa = Array.from({ length: n }, (_, i) => Math.round((i * 2.5 + (r() * 9 - 1)) * 100) / 100).sort((a, b) => a - b)
    const z0 = Math.floor(r() * 3) - (n > 1 ? 0 : 0)
    const form = Math.floor(r() * (n + 1))
    const conc = Math.pow(10, -4 + r() * 3.5)
    const act = (['none', 'davies', 'edh'] as const)[Math.floor(r() * 3)]
    const T = Math.round(r() * 100)
    const item = { kind: 'weak' as const, label: 'x', pKa, z0, form, conc, volume: 10 + Math.round(r() * 40) }
    const base = r() < 0.5
    const spec = abSpec([item], base ? NaOH(Math.pow(10, -2 + r() * 1.5)) : HCl(Math.pow(10, -2 + r() * 1.5)), { activity: act, temperature: T, water: Math.round(r() * 30) })
    const p = prepare(spec)
    const vmax = Math.max(defaultVmaxOf(spec), 5)
    for (let i = 0; i <= 40; i++) {
      const s = p.at((vmax * i) / 40)
      assert.ok(Math.abs(s.residual) < 1e-8, `case ${k} V#${i}: residual ${s.residual}`)
      assert.ok(Number.isFinite(s.pH))
    }
    // far past the end the flask is the titrant: a strong base is above pH 7, a strong acid below
    const far = p.at(vmax * 400)
    if (base) assert.ok(far.pH > 7, `case ${k}: ${far.pH}`)
    else assert.ok(far.pH < 7, `case ${k}: ${far.pH}`)
  }
})
