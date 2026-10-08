// kChem's chemistry (no browser): formulas and masses, isotope patterns, empirical formulas, the
// equation balancer, stoichiometry with a limiting reagent, solutions, acids and pH, gases, units,
// the periodic table data and the notebook.  Run:
//   node --test tools/tests/kchem.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  composition, dilution, empiricalFormula, fmt, getSigFigs, hillFormula, massForSolution, massInfo, molarMass, parseFormula, parseNum,
  parseSpecies, setSigFigs, splitCharge, typeset, unsaturation,
} from '../../src/apps/kchem/chem.ts'
import { ATOMIC_WEIGHTS, ELEMENTS, ISOTOPES, electronConfiguration, findElement, gridPosition, searchElements } from '../../src/apps/kchem/elements.ts'
import { balance, checkBalance, nullSpace, parseEquation } from '../../src/apps/kchem/balance.ts'
import { stoichiometry } from '../../src/apps/kchem/stoich.ts'
import { convertConcentration, mixSolutions, serialDilution, weighOut } from '../../src/apps/kchem/solutions.ts'
import {
  bufferPH, bufferRecipe, phFrom, strongAcid, strongBase, titrationCurve, weakAcid, weakAcidQuadratic, weakBase,
} from '../../src/apps/kchem/acids.ts'
import {
  ATM, VDW_GASES, combinedGas, fromKelvin, gasDensity, idealGas, molarMassFromDensity, partialPressures, toKelvin, vdwMoles, vdwPressure, vdwTemperature, vdwVolume,
} from '../../src/apps/kchem/gases.ts'
import { convert } from '../../src/apps/kchem/units.ts'
import { newEntry, toMarkdown, toPlainText } from '../../src/apps/kchem/notebook.ts'

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`)

const coeffs = (text: string): number[] => {
  const r = balance(text)
  assert.ok(r.ok, r.ok ? '' : r.message)
  return r.ok ? r.coefficients : []
}

// ------------------------------------------------------------------ formulas

test('molar masses: water, hydrate, brackets, 118 elements', () => {
  near(molarMass('H2O'), 18.015, 0.001)
  near(molarMass('CuSO4·5H2O'), 249.68, 0.01)
  near(molarMass('CuSO4.5H2O'), 249.68, 0.01)
  near(molarMass('Ca(OH)2'), 74.09, 0.01)
  near(molarMass('Fe₂O₃'), 159.69, 0.01)
  near(molarMass('K4[Fe(CN)6]'), 368.35, 0.02)
  near(molarMass('Og'), 294, 0)
  near(molarMass('U'), 238.03, 0.001)
  assert.equal(Object.keys(ATOMIC_WEIGHTS).length, 118)
  assert.equal(ELEMENTS.length, 118)
  assert.deepEqual(parseFormula('Mg(NO3)2'), { Mg: 1, N: 2, O: 6 })
  assert.throws(() => parseFormula('Xx2'), /not an element/)
  assert.throws(() => parseFormula('Ca(OH'), /not closed|Unmatched|bracket/)
  const total = composition('CuSO4·5H2O').reduce((s, c) => s + c.percent, 0)
  near(total, 100, 1e-9)
})

test('charges are understood: SO4^2-, Fe3+, NH4+, Cr2O72-, superscripts', () => {
  assert.deepEqual(splitCharge('SO4^2-'), { body: 'SO4', charge: -2 })
  assert.deepEqual(splitCharge('Fe3+'), { body: 'Fe', charge: 3 })
  assert.deepEqual(splitCharge('Fe^3+'), { body: 'Fe', charge: 3 })
  assert.deepEqual(splitCharge('NH4+'), { body: 'NH4', charge: 1 })
  assert.deepEqual(splitCharge('NO3-'), { body: 'NO3', charge: -1 })
  assert.deepEqual(splitCharge('Cr2O72-'), { body: 'Cr2O7', charge: -2 })
  assert.deepEqual(splitCharge('CO3 2-'), { body: 'CO3', charge: -2 })
  assert.deepEqual(splitCharge('Cl-'), { body: 'Cl', charge: -1 })
  assert.deepEqual(splitCharge('H^+'), { body: 'H', charge: 1 })
  assert.deepEqual(splitCharge('Ca^{2+}'), { body: 'Ca', charge: 2 })
  assert.deepEqual(splitCharge('H2O'), { body: 'H2O', charge: 0 })
  const so4 = parseSpecies('SO₄²⁻')
  assert.equal(so4.charge, -2)
  assert.deepEqual(so4.atoms, { S: 1, O: 4 })
  near(molarMass('SO4^2-'), 96.06, 0.01)
  assert.deepEqual(parseSpecies('H2O(l)').atoms, { H: 2, O: 1 })
  assert.equal(parseSpecies('Na+(aq)').phase, 'aq')
  assert.equal(parseSpecies('e-').electron, true)
})

test('formulas are typeset with subscripts and superscripts', () => {
  assert.deepEqual(typeset('H2O'), [{ text: 'H', kind: 'n' }, { text: '2', kind: 'sub' }, { text: 'O', kind: 'n' }])
  assert.deepEqual(typeset('SO4^2-'), [{ text: 'SO', kind: 'n' }, { text: '4', kind: 'sub' }, { text: '2−', kind: 'sup' }])
  const hyd = typeset('CuSO4·5H2O').map((p) => `${p.kind}:${p.text}`).join(' ')
  assert.equal(hyd, 'n:CuSO sub:4 n:·5H sub:2 n:O')
  assert.equal(hillFormula({ H: 2, O: 1, C: 3 }), 'C3H2O')
  assert.equal(hillFormula({ Na: 1, Cl: 1 }), 'ClNa')
})

test('mass spectrum: monoisotopic mass and the isotope pattern', () => {
  const w = massInfo('H2O')
  near(w.average, 18.015, 0.001)
  near(w.monoisotopic, 18.010565, 0.0001)
  assert.equal(w.peaks[0].nominal, 18)
  near(w.peaks[0].abundance, 100, 1e-9)
  near(w.peaks[1].abundance, 0.0371 + 0.2 * 0.0 + 0.0, 0.1) // M+1 of water is tiny
  // chloroform: CHCl3, the Cl3 pattern 100 : 96 : 31 : 3.4
  const c = massInfo('CHCl3')
  near(c.monoisotopic, 117.9144, 0.001)
  const rel = (n: number) => c.peaks.find((p) => p.nominal === n)?.abundance ?? 0
  near(rel(120) / rel(118), 0.96, 0.03)
  near(rel(122) / rel(118), 0.31, 0.02)
  // C60: M+1 is about 66 % of M
  const c60 = massInfo('C60')
  near(c60.monoisotopic, 720, 1e-9)
  near(c60.peaks[1].abundance, 100 * 60 * 0.0107 / 0.9893, 3)
  // fractions add up to 1
  const total = massInfo('C6H12O6').peaks.reduce((s, p) => s + p.fraction, 0)
  near(total, 1, 1e-3) // tiny peaks below 0.01 % are not listed
  // bromine: 1 : 1
  const br = massInfo('Br2')
  near(br.peaks.find((p) => p.nominal === 160)!.abundance, 100, 1e-6)
  near(br.peaks.find((p) => p.nominal === 158)!.abundance, 51.0, 0.6)
  // an ion: m/z of SO4^2-
  const so4 = massInfo('SO4^2-')
  near(so4.mz!, 47.9764, 0.001)
  // a huge formula gets no pattern (and is not computed)
  assert.equal(massInfo('Hg1000000').tooBig, true)
  assert.equal(massInfo('C100000H200000').tooBig, false)
  // every isotope table sums to 100 %
  for (const [el, list] of Object.entries(ISOTOPES)) {
    near(list.reduce((s, i) => s + i.abundance, 0), 100, 0.05)
    assert.ok(el in ATOMIC_WEIGHTS)
  }
})

test('empirical and molecular formula from a composition', () => {
  const r = empiricalFormula([{ element: 'C', amount: 40.0 }, { element: 'H', amount: 6.7 }, { element: 'O', amount: 53.3 }], 'percent')
  assert.equal(r.empirical, 'CH2O')
  near(r.empiricalMass, 30.026, 0.001)
  const glucose = empiricalFormula([{ element: 'C', amount: 40.0 }, { element: 'H', amount: 6.7 }, { element: 'O', amount: 53.3 }], 'percent', 180.16)
  assert.equal(glucose.molecular, 'C6H12O6')
  assert.equal(glucose.multiple, 6)
  // from masses: 2.52 g Fe and 1.08 g O → Fe2O3
  assert.equal(empiricalFormula([{ element: 'Fe', amount: 2.52 }, { element: 'O', amount: 1.08 }], 'mass').empirical, 'Fe2O3')
  // ratio 1 : 1.5 → ×2
  assert.equal(empiricalFormula([{ element: 'Al', amount: 2 }, { element: 'O', amount: 3 }], 'moles').empirical, 'Al2O3')
  assert.equal(empiricalFormula([{ element: 'Ca', amount: 1 }, { element: 'P', amount: 2 / 3 }, { element: 'O', amount: 8 / 3 }], 'moles').empirical, 'Ca3O8P2')
  assert.throws(() => empiricalFormula([{ element: 'Zz', amount: 1 }]), /not an element/)
  near(unsaturation(parseFormula('C6H6'))!, 4, 0)
  assert.equal(unsaturation(parseFormula('H2O')), null)
})

test('numbers: significant figures and parsing', () => {
  assert.equal(getSigFigs(), 4)
  assert.equal(fmt(18.01528), '18.02')
  assert.equal(fmt(0.000123456), '1.235e-4')
  assert.equal(fmt(1234567), '1.235e6')
  assert.equal(fmt(Infinity), '–')
  setSigFigs(6)
  assert.equal(fmt(18.01528), '18.0153')
  setSigFigs(4)
  assert.equal(fmt(100), '100')
  assert.equal(parseNum('1,5'), 1.5)
  assert.equal(parseNum(' '), null)
  assert.ok(Number.isNaN(parseNum('abc')))
})

// ------------------------------------------------------------------ balancer

test('the balancer finds the smallest whole coefficients', () => {
  assert.deepEqual(coeffs('Fe + O2 -> Fe2O3'), [4, 3, 2])
  assert.deepEqual(coeffs('C3H8 + O2 -> CO2 + H2O'), [1, 5, 3, 4])
  assert.deepEqual(coeffs('KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O'), [2, 16, 2, 2, 5, 8])
  assert.deepEqual(coeffs('H2 + O2 = H2O'), [2, 1, 2])
  assert.deepEqual(coeffs('Al + O2 → Al2O3'), [4, 3, 2])
  assert.deepEqual(coeffs('Fe+O2->Fe2O3'), [4, 3, 2])
  assert.deepEqual(coeffs('CuSO4·5H2O -> CuSO4 + H2O'), [1, 1, 5])
  assert.deepEqual(coeffs('Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O'), [3, 2, 1, 6])
  assert.deepEqual(coeffs('C6H12O6(s) + O2(g) -> CO2(g) + H2O(l)'), [1, 6, 6, 6])
})

test('the balancer handles charges and electrons', () => {
  assert.deepEqual(coeffs('Cr2O7^2- + Fe^2+ + H^+ -> Cr^3+ + Fe^3+ + H2O'), [1, 6, 14, 2, 6, 7])
  assert.deepEqual(coeffs('Cr2O7^2- + Fe2+ + H+ -> Cr3+ + Fe3+ + H2O'), [1, 6, 14, 2, 6, 7])
  assert.deepEqual(coeffs('MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O'), [1, 5, 8, 1, 5, 4])
  assert.deepEqual(coeffs('MnO4^- + H^+ + e^- -> Mn^2+ + H2O'), [1, 8, 5, 1, 4])
  assert.deepEqual(coeffs('Cu + Ag+ -> Cu2+ + Ag'), [1, 2, 1, 2])
  assert.deepEqual(coeffs('Na+ + Cl- -> NaCl'), [1, 1, 1])
})

test('the balancer rejects what cannot be balanced, with a reason', () => {
  const none = balance('H2 + O2 -> H2O + H2O2')
  assert.equal(none.ok, false)
  if (!none.ok) {
    assert.equal(none.nullity, 2)
    assert.match(none.message, /Not unique|infinitely many/)
  }
  const one = balance('H2 + O2 -> NaCl')
  assert.equal(one.ok, false)
  if (!one.ok) assert.match(one.message, /appears only on the/)
  const impossible = balance('H2O -> H2O2')
  assert.equal(impossible.ok, false)
  const noArrow = balance('Fe + O2')
  assert.equal(noArrow.ok, false)
  if (!noArrow.ok) assert.match(noArrow.message, /arrow/)
  assert.equal(balance('Fe + Xx -> FeXx').ok, false)
  assert.equal(balance('').ok, false)
  // a species that does not take part would need a zero coefficient
  const extra = balance('H2 + O2 + N2 -> H2O')
  assert.equal(extra.ok, false)
})

test('equations keep what was typed, and balance is checked', () => {
  const eq = parseEquation('2 H2 + O2 -> 2 H2O')
  assert.deepEqual(eq.reactants.map((s) => s.coeff), [2, null])
  assert.deepEqual(eq.products.map((s) => s.coeff), [2])
  const r = balance('2 H2 + O2 -> 2 H2O')
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.text, '2 H2 + O2 → 2 H2O')
    assert.equal(checkBalance(r.equation, r.coefficients).balanced, true)
    assert.equal(checkBalance(r.equation, [1, 1, 1]).balanced, false)
  }
  assert.equal(nullSpace([[1, -1], [2, -2]], 2).length, 1)
})

// ------------------------------------------------------------------ stoichiometry

test('stoichiometry: limiting reagent, excess and percent yield', () => {
  // 4.00 g H2 + 32.0 g O2 → H2O: H2 4.00/2.016 = 1.984 mol (needs 0.992 mol O2); O2 1.000 mol → O2 is in excess? 2 H2 + O2: extents 0.992 and 1.0 → H2 limiting
  const r = stoichiometry({
    equation: '2 H2 + O2 -> 2 H2O',
    amounts: [{ kind: 'mass', value: 4, unit: 'g' }, { kind: 'mass', value: 32, unit: 'g' }],
    actual: { product: 0, grams: 30 },
  })
  assert.deepEqual(r.limiting, ['H2'])
  near(r.extent, 4 / 2.016 / 2, 1e-6)
  near(r.products[0].massReacted, (4 / 2.016) * 18.015, 1e-6)
  near(r.reactants[1].massLeft!, 32 - (4 / 2.016 / 2) * 31.998, 1e-6)
  near(r.percentYield!.percent, (100 * 30) / ((4 / 2.016) * 18.015), 1e-6)

  // an excess reagent given as a solution; the other not given (in excess)
  const s = stoichiometry({
    equation: 'AgNO3 + NaCl -> AgCl + NaNO3',
    amounts: [{ kind: 'solution', value: 50, unit: 'mL', conc: 0.1 }, null],
  })
  near(s.products[0].molesReacted, 0.005, 1e-12)
  near(s.products[0].massReacted, 0.005 * 143.32, 0.01)
  assert.equal(s.reactants[1].molesLeft, null)

  // two reactants in exactly stoichiometric amounts: both limiting
  const t = stoichiometry({ equation: 'N2 + 3 H2 -> 2 NH3', amounts: [{ kind: 'moles', value: 1, unit: 'mol' }, { kind: 'moles', value: 3, unit: 'mol' }] })
  assert.deepEqual(t.limiting, ['N2', 'H2'])
  near(t.products[0].molesReacted, 2, 1e-9)

  assert.throws(() => stoichiometry({ equation: 'H2 + O2 -> H2O', amounts: [{ kind: 'moles', value: 1, unit: 'mol' }, null] }), /not balanced/)
  assert.throws(() => stoichiometry({ equation: '2 H2 + O2 -> 2 H2O', amounts: [null, null] }), /at least one/)
  assert.throws(() => stoichiometry({ equation: '2 H2 + O2 -> 2 H2O', amounts: [null] }), /Give an amount/)
})

// ------------------------------------------------------------------ solutions

test('solutions: what to weigh, conversions, serial dilution, mixing', () => {
  near(massForSolution('NaCl', 0.1, 250), 1.461, 0.01)
  near(weighOut('molarity', 0.1, 250, 58.44), 1.461, 0.001)
  near(weighOut('wv', 0.9, 1000, 58.44), 9, 1e-9)
  near(weighOut('ppm', 50, 500, 58.44), 0.025, 1e-9)
  near(weighOut('molality', 1, 500, 58.44), 29.22, 1e-9)
  near(weighOut('ww', 10, 200, 58.44), 20, 1e-9)
  near(weighOut('molarity', 1, 100, 100, 50), 20, 1e-9) // 50 % pure
  const c = convertConcentration('M', 1, 58.44, 1.04) // 1 M NaCl, density 1.04
  near(c.gL, 58.44, 1e-9)
  near(c.ww, 5.619, 0.01)
  near(c.molal, 1 / ((1040 - 58.44) / 1000), 1e-6)
  near(c.ppm, 58440, 1e-6)
  near(c.wv, 5.844, 1e-9)
  // round trip through % w/w
  near(convertConcentration('ww', c.ww, 58.44, 1.04).M, 1, 1e-9)
  near(convertConcentration('molal', c.molal, 58.44, 1.04).M, 1, 1e-9)
  near(convertConcentration('x', c.x, 58.44, 1.04).M, 1, 1e-9)
  const rows = serialDilution(1, 10, 4, 10)
  assert.equal(rows.length, 4)
  near(rows[3].concentration, 1e-4, 1e-12)
  near(rows[0].transfer, 1, 1e-12)
  near(rows[0].diluent, 9, 1e-12)
  assert.throws(() => serialDilution(1, 1, 3, 10), /above 1/)
  const m = mixSolutions(1, 100, 0.5, 300)
  near(m.concentration, 0.625, 1e-12)
  near(m.volume, 400, 1e-12)
  const d = dilution(1, null, 0.1, 100)
  near(d.v1, 10, 1e-9)
  assert.throws(() => dilution(1, null, null, 100), /exactly one/)
})

// ------------------------------------------------------------------ acids

test('pH: conversions, strong and weak acids and bases', () => {
  const p = phFrom('H', 1e-3)
  near(p.pH, 3, 1e-12)
  near(p.pOH, 11, 1e-12)
  near(phFrom('pOH', 4).pH, 10, 1e-12)
  near(phFrom('OH', 1e-2).pH, 12, 1e-12)
  near(strongAcid(0.01).pH, 2, 1e-3)
  near(strongAcid(0.005, 2).pH, 2, 1e-3)
  near(strongAcid(1e-8).pH, 6.98, 0.01) // water's own H+ counts
  near(strongBase(0.01).pH, 12, 1e-3)
  // 0.1 M acetic acid, Ka = 1.8e-5 (pKa 4.745)
  const pKa = -Math.log10(1.8e-5)
  const ac = weakAcid(0.1, [pKa])
  near(ac.pH, 2.875, 0.002)
  assert.equal(fmt(ac.pH, 3), '2.88')
  near(ac.alpha!, 0.0133, 0.0005)
  near(-Math.log10(weakAcidQuadratic(0.1, 1.8e-5)), 2.8753, 0.001)
  // ammonia 0.1 M, pKb 4.75
  near(weakBase(0.1, 4.75).pH, 11.12, 0.01)
  // phosphoric acid 0.1 M (pKa 2.15, 7.20, 12.35)
  const h3 = weakAcid(0.1, [2.15, 7.2, 12.35])
  near(h3.pH, 1.62, 0.02)
  near(h3.distribution!.reduce((a, b) => a + b, 0), 1, 1e-9)
  // sodium-free pure water
  near(weakAcid(0, [4.76]).pH, 7, 1e-9)
})

test('buffers: Henderson–Hasselbalch and recipes', () => {
  near(bufferPH(4.76, 0.1, 0.1), 4.76, 1e-12)
  near(bufferPH(4.76, 0.1, 1), 5.76, 1e-12)
  const r = bufferRecipe(7.2, 7.4, 0.1, 1)
  near(r.ratio, 1.5849, 0.001)
  near(r.molesAcid + r.molesBase, 0.1, 1e-12)
  near(bufferPH(7.2, r.molesAcid, r.molesBase), 7.4, 1e-9)
  assert.equal(r.weak, false)
  assert.equal(bufferRecipe(4.76, 7, 0.1, 1).weak, true)
  assert.throws(() => bufferPH(4.76, 0, 1), /needed/)
})

test('titration curves: acetic acid with NaOH', () => {
  const pKa = 4.76
  const t = titrationCurve({ analyte: 'acid', concentration: 0.1, volume: 25, pKs: [pKa], titrant: 0.1 })
  near(t.equivalence[0], 25, 1e-9)
  near(t.start, 2.88, 0.02)
  near(t.halfPH, pKa, 0.03)
  near(t.equivalencePH[0], 8.72, 0.05)
  // strong acid / strong base: pH 7 at equivalence
  const s = titrationCurve({ analyte: 'acid', concentration: 0.1, volume: 25, pKs: [-3], titrant: 0.1 })
  near(s.equivalencePH[0], 7, 0.01)
  near(s.start, 1, 0.01)
  // diprotic: two equivalence points
  const d = titrationCurve({ analyte: 'acid', concentration: 0.1, volume: 20, pKs: [2, 7], titrant: 0.1 })
  assert.deepEqual(d.equivalence, [20, 40])
  // a base titrated with a strong acid starts high and ends low
  const b = titrationCurve({ analyte: 'base', concentration: 0.1, volume: 25, pKs: [4.75], titrant: 0.1 })
  assert.ok(b.points[0].pH > 11 && b.points[b.points.length - 1].pH < 3)
  near(b.equivalencePH[0], 5.28, 0.05)
  // pH rises with volume for an acid
  for (let i = 1; i < t.points.length; i++) assert.ok(t.points[i].pH >= t.points[i - 1].pH - 1e-9)
})

// ------------------------------------------------------------------ gases

test('ideal gas law and combined gas law', () => {
  const v = idealGas({ P: ATM, V: null, n: 1, T: 273.15 })
  near(v.V * 1000, 22.414, 0.001)
  const n = idealGas({ P: ATM, V: 0.0224, n: null, T: 273.15 })
  near(n.n, 1, 0.001)
  const T = idealGas({ P: ATM, V: 0.0224141, n: 1, T: null })
  near(T.T, 273.15, 0.01)
  assert.throws(() => idealGas({ P: 1, V: 1, n: 1, T: 1 }), /exactly one/)
  assert.throws(() => idealGas({ P: -1, V: null, n: 1, T: 300 }), /above zero/)
  near(toKelvin(25, '°C'), 298.15, 1e-9)
  near(toKelvin(32, '°F'), 273.15, 1e-9)
  near(fromKelvin(373.15, '°F'), 212, 1e-9)
  const c = combinedGas({ P1: 1, V1: 10, T1: 300, P2: 2, V2: null, T2: 600 })
  near(c.V2!, 10, 1e-9)
  near(gasDensity(ATM, 273.15, 44.01), 1.964, 0.005) // CO2 at STP
  near(molarMassFromDensity(ATM, 273.15, 1.964), 44.01, 0.05)
  const pp = partialPressures([{ label: 'N2', moles: 0.78 }, { label: 'O2', moles: 0.21 }, { label: 'Ar', moles: 0.01 }], 100000)
  near(pp[0].pressure, 78000, 1e-6)
  near(pp.reduce((s, p) => s + p.pressure, 0), 100000, 1e-6)
})

test('van der Waals: CO2 deviates from the ideal gas', () => {
  const co2 = VDW_GASES.find((g) => g.formula === 'CO2')!
  const P = vdwPressure(co2, 1, 1, 300)
  near(P, 22.4, 0.1)
  near(vdwTemperature(co2, 1, 1, P), 300, 1e-6)
  near(vdwVolume(co2, 1, P, 300), 1, 1e-6)
  near(vdwMoles(co2, P, 1, 300), 1, 1e-6)
  // at 1 atm the gas is almost ideal
  near(vdwVolume(co2, 1, 1.01325, 273.15), 22.26, 0.1)
  assert.throws(() => vdwPressure(co2, 1, 0.01, 300), /smaller than the molecules/)
})

// ------------------------------------------------------------------ units

test('units: lab conversions', () => {
  near(convert('mass', 1, 'kg', 'g'), 1000, 1e-9)
  near(convert('volume', 1, 'gal (US)', 'L'), 3.785411784, 1e-9)
  near(convert('pressure', 1, 'atm', 'mmHg'), 760, 1e-3)
  near(convert('pressure', 1, 'bar', 'kPa'), 100, 1e-9)
  near(convert('energy', 1, 'eV', 'kJ/mol'), 96.485, 0.001)
  near(convert('energy', 1, 'kcal', 'kJ'), 4.184, 1e-9)
  near(convert('energy', 1, 'kcal/mol', 'kJ/mol'), 4.184, 1e-9)
  near(convert('temperature', 100, '°C', '°F'), 212, 1e-9)
  near(convert('temperature', 0, 'K', '°C'), -273.15, 1e-9)
  assert.throws(() => convert('temperature', -5, 'K', '°C'), /absolute zero/)
  near(convert('molarity', 5, 'mM', 'µM'), 5000, 1e-9)
  near(convert('massconc', 1, 'mg/L (ppm)', 'µg/L (ppb)'), 1000, 1e-9)
  near(convert('length', 1, 'nm', 'Å'), 10, 1e-9)
  assert.throws(() => convert('mass', 1, 'kg', 'zz'), /Unknown unit/)
})

// ------------------------------------------------------------------ elements

test('the periodic table: 118 elements with their data', () => {
  const fe = findElement('Fe')!
  assert.equal(fe.z, 26)
  assert.equal(fe.name, 'Iron')
  assert.equal(fe.weight, 55.845)
  assert.equal(fe.group, 8)
  assert.equal(fe.period, 4)
  assert.equal(fe.block, 'd')
  assert.equal(fe.category, 'transition')
  assert.equal(fe.state, 'solid')
  assert.equal(electronConfiguration(26), '[Ar] 3d6 4s2')
  assert.equal(electronConfiguration(26, false), '1s2 2s2 2p6 3s2 3p6 3d6 4s2')
  // the exceptions
  assert.equal(electronConfiguration(24), '[Ar] 3d5 4s1') // Cr
  assert.equal(electronConfiguration(29), '[Ar] 3d10 4s1') // Cu
  assert.equal(electronConfiguration(46), '[Kr] 4d10') // Pd
  assert.equal(electronConfiguration(47), '[Kr] 4d10 5s1') // Ag
  assert.equal(electronConfiguration(79), '[Xe] 4f14 5d10 6s1') // Au
  assert.equal(electronConfiguration(57), '[Xe] 5d1 6s2') // La
  assert.equal(electronConfiguration(64), '[Xe] 4f7 5d1 6s2') // Gd
  assert.equal(electronConfiguration(92), '[Rn] 5f3 6d1 7s2') // U
  // regular ones
  assert.equal(electronConfiguration(1), '1s1')
  assert.equal(electronConfiguration(2), '1s2')
  assert.equal(electronConfiguration(8), '[He] 2s2 2p4')
  assert.equal(electronConfiguration(11), '[Ne] 3s1')
  assert.equal(electronConfiguration(35), '[Ar] 3d10 4s2 4p5')
  assert.equal(electronConfiguration(56), '[Xe] 6s2')
  assert.equal(electronConfiguration(82), '[Xe] 4f14 5d10 6s2 6p2')
  assert.equal(electronConfiguration(118), '[Rn] 5f14 6d10 7s2 7p6')
  // every configuration holds exactly Z electrons
  for (const e of ELEMENTS) {
    const full = electronConfiguration(e.z, false)
    const sum = full.split(' ').reduce((s, t) => s + Number(t.slice(2)), 0)
    assert.equal(sum, e.z, `${e.symbol} has ${e.z} electrons`)
  }
  // positions and categories
  assert.deepEqual(ELEMENTS.map((e) => e.z), Array.from({ length: 118 }, (_, i) => i + 1))
  assert.equal(findElement('He')!.group, 18)
  assert.equal(findElement('Na')!.category, 'alkali')
  assert.equal(findElement('Cl')!.category, 'halogen')
  assert.equal(findElement('Si')!.category, 'metalloid')
  assert.equal(findElement('Ce')!.category, 'lanthanide')
  assert.equal(findElement('U')!.category, 'actinide')
  assert.equal(findElement('Og')!.group, 18)
  assert.equal(findElement('Lu')!.group, 3)
  assert.equal(findElement('Hg')!.state, 'liquid')
  assert.equal(findElement('Br')!.state, 'liquid')
  assert.equal(findElement('Ne')!.state, 'gas')
  assert.equal(findElement('Cs')!.state, 'solid')
  assert.equal(findElement('Og')!.state, 'unknown')
  assert.deepEqual(gridPosition(findElement('La')!), { row: 9, col: 3 })
  assert.deepEqual(gridPosition(findElement('Lu')!), { row: 6, col: 3 })
  assert.deepEqual(gridPosition(findElement('Og')!), { row: 7, col: 18 })
  assert.deepEqual(gridPosition(findElement('He')!), { row: 1, col: 18 })
  // no two elements share a cell
  const cells = new Set(ELEMENTS.map((e) => JSON.stringify(gridPosition(e))))
  assert.equal(cells.size, 118)
  // lookup and search
  assert.equal(findElement('iron')!.symbol, 'Fe')
  assert.equal(findElement('26')!.symbol, 'Fe')
  assert.equal(findElement(79)!.symbol, 'Au')
  assert.equal(findElement('nothing'), null)
  assert.equal(searchElements('gold')[0].symbol, 'Au')
  assert.equal(searchElements('Fe')[0].symbol, 'Fe')
  assert.ok(searchElements('halogen').length >= 5)
  assert.equal(findElement('Au')!.oxidation[0], 3)
  assert.equal(findElement('Fe')!.en, 1.83)
  assert.equal(findElement('Hg')!.mp, 234.32)
})

// ------------------------------------------------------------------ notebook

test('the notebook exports Markdown and text', () => {
  const a = newEntry('Formula', 'Water', 'H2O\nM = 18.02 g/mol', 1_700_000_000_000)
  const b = newEntry('Gases', '', '1 mol at 273.15 K → 22.41 L', 1_700_000_100_000)
  assert.equal(b.label, 'Gases')
  const md = toMarkdown([a, b])
  assert.match(md, /^# kChem notebook/)
  assert.match(md, /## Water/)
  assert.match(md, /```\nH2O\nM = 18.02 g\/mol\n```/)
  const txt = toPlainText([a, b], 'My notes')
  assert.match(txt, /^My notes\n========/)
  assert.match(txt, /Water {2}\[Formula, /)
  assert.match(toMarkdown([]), /Nothing pinned yet/)
})
