// kReaction's chemistry (no browser, no RDKit): formulas and SMILES, the exact balancer, the reaction library
// (every reaction and every mechanism state must balance), the ODE solvers against analytic solutions, the
// kinetics syntax, order determination, Arrhenius, ICE tables, energy profiles and the .kreact file.  Run:
//   node --test tools/tests/kreaction.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATOMIC_WEIGHTS, hillFormula, molarMass, normalize, parseFormula, splitCharge, typeset } from '../../src/apps/kreaction/formula.ts'
import { readSmiles } from '../../src/apps/kreaction/smiles.ts'
import { COMPOUNDS, findCompound, nameOfSmiles, searchCompounds } from '../../src/apps/kreaction/compounds.ts'
import { balanceSpecies, checkBalance, nullSpace, toIntegers, type BalSpecies } from '../../src/apps/kreaction/balance.ts'
import { analyseReaction, parseEquationText, reactionSmiles, resolveSpecies, splitCoefficient } from '../../src/apps/kreaction/reaction.ts'
import { LIBRARY, REACTION_CLASSES, findReaction, searchLibrary } from '../../src/apps/kreaction/library.ts'
import { TEMPLATES } from '../../src/apps/kreaction/templates.ts'
import { solveLinear, solveOde, type OdeSystem } from '../../src/apps/kreaction/ode.ts'
import {
  PRESETS, consecutiveB, consecutiveMax, firstOrder, michaelisMenten, networkSystem, parseNetwork, simulate, summarise, timeGrid,
} from '../../src/apps/kreaction/kinetics.ts'
import { arrhenius, eyring, fitOrder, linreg, parseTable } from '../../src/apps/kreaction/fit.ts'
import {
  dGFromK, kcToKp, kpToKc, leChatelier, parseEquilibrium, quotient, solveIce, thermo, vantHoffDH, vantHoffK2,
} from '../../src/apps/kreaction/equilibrium.ts'
import { analyse, catalysed, curve, normalise, profileFromMechanism, simpleProfile } from '../../src/apps/kreaction/profile.ts'
import { defaultWorkspace, parseWorkspace, serializeWorkspace } from '../../src/apps/kreaction/workspace.ts'
import { newEntry, toMarkdown, toPlainText } from '../../src/apps/kreaction/notebook.ts'
import { reportMarkdown } from '../../src/apps/kreaction/report.ts'
import { staticSvg, themeSvg } from '../../src/apps/kreaction/svgtheme.ts'
import { gibbsFigure, iceFigure, kineticsFigure, michaelisFigure, onWhite, PRINT_PALETTE, profileFigure } from '../../src/apps/kreaction/figures.ts'
import { equationSvg } from '../../src/apps/kreaction/compose.ts'
import {
  describeReaction, exampleDetails, fitRequest, kineticsRequest, listExamples, reactionRequest, runEquilibrium, runFit, runKinetics, speciesList,
} from '../../src/apps/kreaction/aiCore.ts'
import { formToText, networkToForm, readRateFields, reactionToNetwork, writeRateFields } from '../../src/apps/kreaction/kinetics.ts'
import { KREACTION_TOOL_SET } from '../../src/os/ai/manifests/kreaction.ts'

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`)
const rel = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} ≈ ${b} (±${tol * 100}%)`)

const sp = (formula: string): BalSpecies => {
  const f = parseFormula(formula)
  return { label: formula, atoms: f.atoms, charge: f.charge }
}
const coeffsOf = (text: string): number[] => {
  const eq = parseEquationText(text)
  const r = balanceSpecies(eq.reactants.map(sp), eq.products.map(sp))
  assert.ok(r.status === 'ok' || r.status === 'balanced', r.message)
  return r.coefficients
}

// ------------------------------------------------------------------ formulas and SMILES

test('formulas: brackets, hydrates, charges, Hill order, molar masses', () => {
  assert.deepEqual(parseFormula('Ca(OH)2').atoms, { Ca: 1, O: 2, H: 2 })
  assert.deepEqual(parseFormula('K4[Fe(CN)6]').atoms, { K: 4, Fe: 1, C: 6, N: 6 })
  assert.deepEqual(parseFormula('CuSO4·5H2O').atoms, { Cu: 1, S: 1, O: 9, H: 10 })
  assert.deepEqual(parseFormula('Fe₂O₃').atoms, { Fe: 2, O: 3 })
  assert.deepEqual(parseFormula('SO4^2-'), { atoms: { S: 1, O: 4 }, charge: -2 })
  assert.deepEqual(parseFormula('SO42-'), { atoms: { S: 1, O: 4 }, charge: -2 })
  assert.deepEqual(parseFormula('Fe3+'), { atoms: { Fe: 1 }, charge: 3 })
  assert.deepEqual(parseFormula('NH4+'), { atoms: { N: 1, H: 4 }, charge: 1 })
  assert.deepEqual(parseFormula('NO3-'), { atoms: { N: 1, O: 3 }, charge: -1 })
  assert.deepEqual(parseFormula('Cr2O72-'), { atoms: { Cr: 2, O: 7 }, charge: -2 })
  assert.deepEqual(parseFormula('H2O(l)').atoms, { H: 2, O: 1 })
  assert.deepEqual(parseFormula('e-'), { atoms: {}, charge: -1 })
  assert.deepEqual(splitCharge('Ca^{2+}'), { body: 'Ca', charge: 2 })
  assert.equal(normalize('SO₄²⁻'), 'SO4^2-')
  assert.throws(() => parseFormula('Xx2'), /not an element/)
  assert.throws(() => parseFormula('Ca(OH'), /Unclosed|Unmatched/)
  assert.equal(hillFormula({ H: 6, O: 1, C: 2 }), 'C2H6O')
  assert.equal(hillFormula({ Na: 1, Cl: 1 }), 'ClNa')
  assert.equal(hillFormula({ S: 1, O: 4 }, -2), 'O4S2−')
  rel(molarMass(parseFormula('H2O').atoms), 18.015)
  rel(molarMass(parseFormula('CuSO4·5H2O').atoms), 249.68, 1e-3)
  assert.deepEqual(typeset('H2SO4').map((p) => `${p.kind}:${p.text}`), ['n:H', 'sub:2', 'n:SO', 'sub:4'])
  const keys = Object.keys(ATOMIC_WEIGHTS)
  assert.deepEqual([keys[0], keys[5], keys[7], keys[25], keys[78], keys[91]], ['H', 'C', 'O', 'Fe', 'Au', 'U'], 'table is in order of Z')
})

test('SMILES → formula: ethanol, benzene, aspirin, glucose, charges, aromatics', () => {
  const f = (s: string) => hillFormula(readSmiles(s).atoms)
  assert.equal(f('CCO'), 'C2H6O')
  assert.equal(f('c1ccccc1'), 'C6H6')
  assert.equal(f('CC(=O)Oc1ccccc1C(=O)O'), 'C9H8O4')
  assert.equal(f('OCC1OC(O)C(O)C(O)C1O'), 'C6H12O6')
  assert.equal(f('Cn1cnc2c1c(=O)n(C)c(=O)n2C'), 'C8H10N4O2', 'caffeine (pyrrole-type nitrogen)')
  assert.equal(f('c1ccncc1'), 'C5H5N')
  assert.equal(f('c1cc[nH]c1'), 'C4H5N')
  assert.equal(f('c1ccoc1'), 'C4H4O')
  assert.equal(f('c1ccc2ccccc2c1'), 'C10H8')
  assert.equal(f('C#N'), 'CHN')
  assert.equal(f('O=C=O'), 'CO2')
  assert.equal(f('[H][H]'), 'H2')
  assert.equal(f('C1CC1'), 'C3H6')
  assert.equal(f('CC(C)(C)Br'), 'C4H9Br')
  assert.equal(f('OS(=O)(=O)O'), 'H2O4S')
  assert.equal(f('F'), 'FH')
  assert.deepEqual(readSmiles('[Na+].[Cl-]'), { atoms: { Na: 1, Cl: 1 }, charge: 0, fragments: 2, heavy: 2 })
  assert.equal(readSmiles('[NH4+]').charge, 1)
  assert.deepEqual(readSmiles('[NH4+]').atoms, { N: 1, H: 4 })
  assert.equal(readSmiles('[O-2]').charge, -2)
  assert.equal(readSmiles('[Fe+3]').charge, 3)
  assert.equal(readSmiles('[C@@H](F)(Cl)Br').atoms.H, 1)
  for (const bad of ['', 'C(', 'C1CC', 'CC)', 'Xx', 'C=', 'H2O', 'Na', '[Zz]', 'C%1']) assert.throws(() => readSmiles(bad), Error, bad)
})

test('every compound in the table: SMILES reads and gives the listed formula', () => {
  assert.ok(COMPOUNDS.length >= 150, `${COMPOUNDS.length} compounds`)
  const names = new Set<string>()
  for (const c of COMPOUNDS) {
    const info = readSmiles(c.smiles)
    assert.equal(hillFormula(info.atoms), c.formula.replace(/[+-]$/, ''), `${c.name} ${c.smiles}`)
    assert.ok(!names.has(c.name), `duplicate ${c.name}`)
    names.add(c.name)
  }
  assert.equal(findCompound('Ethanol')?.smiles, 'CCO')
  assert.equal(findCompound('NaCl')?.name, 'sodium chloride')
  assert.equal(findCompound('  ACETIC   ACID ')?.smiles, 'CC(=O)O')
  assert.equal(findCompound('unobtainium'), null)
  assert.equal(nameOfSmiles('CCO'), 'ethanol')
  assert.equal(searchCompounds('ethanol')[0].name, 'ethanol')
  assert.ok(searchCompounds('ethan').some((c) => c.name === 'ethanol'))
  assert.ok(searchCompounds('acid').length >= 8)
  assert.ok(searchCompounds('aspirin').some((c) => c.formula === 'C9H8O4'))
  assert.deepEqual(searchCompounds(''), [])
})

// ------------------------------------------------------------------ balancing

test('the balancer: classic equations', () => {
  assert.deepEqual(coeffsOf('Fe + O2 -> Fe2O3'), [4, 3, 2])
  assert.deepEqual(coeffsOf('C3H8 + O2 -> CO2 + H2O'), [1, 5, 3, 4])
  assert.deepEqual(coeffsOf('KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O'), [2, 16, 2, 2, 5, 8])
  assert.deepEqual(coeffsOf('H2 + O2 -> H2O'), [2, 1, 2])
  assert.deepEqual(coeffsOf('Al + HCl -> AlCl3 + H2'), [2, 6, 2, 3])
  assert.deepEqual(coeffsOf('C6H12O6 + O2 -> CO2 + H2O'), [1, 6, 6, 6])
  assert.deepEqual(coeffsOf('Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O'), [3, 2, 1, 6])
  assert.deepEqual(coeffsOf('Cu + HNO3 -> Cu(NO3)2 + NO + H2O'), [3, 8, 3, 2, 4])
  // ionic equations balance charge too
  assert.deepEqual(coeffsOf('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O'), [1, 5, 8, 1, 5, 4])
  assert.deepEqual(coeffsOf('Cr2O72- + Fe2+ + H+ -> Cr3+ + Fe3+ + H2O'), [1, 6, 14, 2, 6, 7])
  assert.deepEqual(coeffsOf('Ag+ + Cl- -> AgCl'), [1, 1, 1])
  const done = balanceSpecies([sp('H2'), sp('Cl2')], [sp('HCl')])
  assert.equal(done.status, 'ok')
  assert.deepEqual(done.coefficients, [1, 1, 2])
  assert.equal(balanceSpecies([sp('H2')], [sp('H2')]).status, 'balanced')
})

test('the balancer: impossible, non-unique and invalid cases are explained', () => {
  const none = balanceSpecies([sp('H2'), sp('O2')], [sp('H2'), sp('N2')])
  assert.equal(none.status, 'impossible')
  assert.match(none.message, /O is only on the reactant side/)
  assert.match(none.message, /N is only on the product side/)
  const wrongSide = balanceSpecies([sp('H2'), sp('H2O')], [sp('O2')])
  assert.equal(wrongSide.status, 'impossible')
  const charge = balanceSpecies([sp('Na')], [sp('Na+')])
  assert.equal(charge.status, 'impossible')
  const multi = balanceSpecies([sp('H2'), sp('O2'), sp('H2O2')], [sp('H2O'), sp('H2O2')])
  assert.notEqual(multi.status, 'ok')
  const two = balanceSpecies([sp('CH4'), sp('O2')], [sp('CO2'), sp('H2O'), sp('CO')])
  assert.equal(two.status, 'multiple')
  assert.ok(two.coefficients.every((c) => c > 0))
  assert.ok(checkBalance([sp('CH4'), sp('O2')], [sp('CO2'), sp('H2O'), sp('CO')], two.coefficients).balanced)
  assert.match(two.message, /Not unique/)
  assert.equal(balanceSpecies([], [sp('H2')]).status, 'invalid')
  // the same compound twice on a side shares its total evenly
  const twice = balanceSpecies([sp('CH3CHO'), sp('CH3CHO')], [sp('C4H8O2')])
  assert.deepEqual(twice.coefficients, [1, 1, 1])
})

test('nullSpace / toIntegers: exact fractions', () => {
  const ns = nullSpace([[1, 2, 3], [2, 4, 6]], 3)
  assert.equal(ns.length, 2)
  assert.deepEqual(toIntegers([{ n: 1n, d: 2n }, { n: 3n, d: 4n }]), [2n, 3n])
  // a large system stays exact
  const big = balanceSpecies([sp('C20H42'), sp('O2')], [sp('CO2'), sp('H2O')])
  assert.deepEqual(big.coefficients, [2, 61, 40, 42])
})

test('checkBalance reports atoms, mass and charge', () => {
  const ok = checkBalance([sp('Fe'), sp('O2')], [sp('Fe2O3')], [4, 3, 2])
  assert.ok(ok.balanced && ok.atomsOk && ok.chargeOk && ok.massOk)
  near(ok.massLeft, ok.massRight, 1e-9)
  const bad = checkBalance([sp('Fe'), sp('O2')], [sp('Fe2O3')], [1, 1, 1])
  assert.ok(!bad.balanced)
  assert.deepEqual(bad.rows.map((r) => r.what), ['Fe', 'O'])
  const ion = checkBalance([sp('Ag+'), sp('Cl-')], [sp('AgCl')], [1, 1, 1])
  assert.ok(ion.balanced)
  assert.ok(ion.rows.some((r) => r.what === 'charge'))
  assert.ok(!checkBalance([sp('Na')], [sp('Na+')], [1, 1]).chargeOk)
})

test('species resolution: names, SMILES, formulas, errors; equation text', () => {
  assert.equal(resolveSpecies('ethanol').smiles, 'CCO')
  assert.equal(resolveSpecies('ethanol').kind, 'name')
  assert.equal(resolveSpecies('CCO').kind, 'smiles')
  assert.equal(resolveSpecies('CCO').label, 'C2H6O')
  assert.equal(resolveSpecies('O2').name, 'oxygen')
  assert.equal(resolveSpecies('Mn2O7').kind, 'formula')
  assert.equal(resolveSpecies('Mn2O7').label, 'Mn2O7')
  assert.equal(resolveSpecies('H2SO4').label, 'H2SO4', 'a formula typed as a name keeps its form')
  assert.equal(resolveSpecies('H2SO4').smiles, 'OS(=O)(=O)O')
  assert.equal(resolveSpecies('sulfuric acid').label, 'H2O4S')
  assert.equal(resolveSpecies('NaCl').name, 'sodium chloride')
  const two = resolveSpecies('2 H2')
  assert.equal(two.typedCoeff, 2)
  assert.deepEqual(two.atoms, { H: 2 })
  assert.equal(resolveSpecies('C(C').kind, 'invalid')
  assert.match(resolveSpecies('???').error ?? '', /not a known name/)
  assert.equal(resolveSpecies('').kind, 'invalid')
  assert.deepEqual(splitCoefficient('3 CO2'), { coeff: 3, rest: 'CO2' })
  assert.deepEqual(splitCoefficient('CO2'), { coeff: null, rest: 'CO2' })
  assert.deepEqual(splitCoefficient('2H2'), { coeff: 2, rest: 'H2' })
  assert.deepEqual(splitCoefficient('3[Na+]'), { coeff: 3, rest: '[Na+]' })
  assert.deepEqual(splitCoefficient('2-propanol'), { coeff: null, rest: '2-propanol' })
  assert.deepEqual(splitCoefficient('1,2-dibromoethane'), { coeff: null, rest: '1,2-dibromoethane' })
  // hooks let RDKit have the last word
  assert.equal(resolveSpecies('CCO', { valid: () => false }).kind, 'invalid')

  const eq = parseEquationText('CCO + O2 -> CO2 + H2O')
  assert.deepEqual(eq.reactants, ['CCO', 'O2'])
  assert.deepEqual(eq.products, ['CO2', 'H2O'])
  assert.equal(parseEquationText('N2 + 3 H2 <=> 2 NH3').arrow, 'equilibrium')
  assert.deepEqual(parseEquationText('CC(=O)O + CCO -> CC(=O)OCC + O').reactants, ['CC(=O)O', 'CCO'])
  assert.deepEqual(parseEquationText('[Na+].[OH-] + Cl -> [Na+].[Cl-] + O').reactants, ['[Na+].[OH-]', 'Cl'])
  assert.throws(() => parseEquationText('A + B'), /arrow/)

  const a = analyseReaction({ reactants: ['ethanol', 'O2'], products: ['CO2', 'H2O'], arrow: 'forward', above: '', below: '' })
  assert.ok(a.ready)
  assert.deepEqual(a.balance?.coefficients, [1, 3, 2, 3])
  assert.ok(!a.check?.balanced)
  assert.equal(reactionSmiles(a), 'CCO.O=O>>O=C=O.O')
  const b = analyseReaction({ reactants: ['ethanol', 'O2'], products: ['CO2', 'H2O'], arrow: 'forward', above: '', below: '' }, {}, [1, 3, 2, 3])
  assert.ok(b.check?.balanced)
  assert.equal(analyseReaction({ reactants: ['bogus!'], products: ['water'], arrow: 'forward', above: '', below: '' }).ready, false)
})

// ------------------------------------------------------------------ the library

const side = (list: string[], coeffs: number[]) => {
  const atoms: Record<string, number> = {}
  let charge = 0
  list.forEach((s, i) => {
    const info = readSmiles(s)
    charge += info.charge * coeffs[i]
    for (const [e, n] of Object.entries(info.atoms)) atoms[e] = (atoms[e] ?? 0) + n * coeffs[i]
  })
  return { atoms, charge }
}

test('the library: at least 40 reactions, unique ids, balanced by formulas and by the balancer', () => {
  assert.ok(LIBRARY.length >= 40, `${LIBRARY.length} reactions`)
  const ids = new Set<string>()
  for (const r of LIBRARY) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`)
    ids.add(r.id)
    assert.ok(REACTION_CLASSES.includes(r.cls), `${r.id}: class ${r.cls}`)
    assert.ok(r.explanation.length > 60 && r.name.length > 3, r.id)
    assert.equal(r.coeffs.length, r.reactants.length + r.products.length, `${r.id}: coefficient count`)
    assert.ok(r.coeffs.every((c) => Number.isInteger(c) && c > 0), `${r.id}: coefficients`)
    const L = side(r.reactants, r.coeffs.slice(0, r.reactants.length))
    const P = side(r.products, r.coeffs.slice(r.reactants.length))
    const keys = new Set([...Object.keys(L.atoms), ...Object.keys(P.atoms)])
    for (const k of keys) assert.equal(L.atoms[k] ?? 0, P.atoms[k] ?? 0, `${r.id}: ${k} atoms`)
    assert.equal(L.charge, P.charge, `${r.id}: charge`)
    // through the species resolver and the balancer
    const a = analyseReaction({ reactants: r.reactants, products: r.products, arrow: r.arrow, above: '', below: '' }, {}, r.coeffs)
    assert.ok(a.ready && a.check?.balanced, `${r.id}: analyse`)
    assert.ok(['ok', 'balanced', 'multiple'].includes(a.balance?.status ?? ''), `${r.id}: balancer ${a.balance?.status}`)
    if (a.balance?.status === 'ok' || a.balance?.status === 'balanced') assert.deepEqual(a.balance.coefficients, r.coeffs, `${r.id}: smallest coefficients`)
  }
  assert.ok(findReaction('sn2'))
  assert.equal(findReaction('nope'), null)
  assert.ok(searchLibrary('grignard').some((r) => r.id === 'grignard'))
  assert.ok(searchLibrary('', 'Combustion').length >= 3)
})

test('the library covers the required reaction types', () => {
  const need = ['sn1', 'sn2', 'e1', 'e2', 'aldol', 'claisen', 'grignard', 'fischer', 'saponification', 'amide-acyl-chloride', 'diels-alder', 'hydrogenation',
    'hydration', 'br2-addition', 'hbr-addition', 'fc-alkylation', 'fc-acylation', 'nitration', 'sulfonation', 'wittig', 'suzuki', 'williamson', 'neutralisation',
    'combustion-methane', 'combustion-ethanol', 'combustion-glucose', 'haber', 'photosynthesis', 'nabh4']
  for (const id of need) assert.ok(findReaction(id), id)
  assert.ok(LIBRARY.filter((r) => r.mechanism).length >= 20, 'mechanisms')
})

test('every mechanism: states balance, transition states sit on top, energies are numbers', () => {
  for (const r of LIBRARY) {
    if (!r.mechanism) continue
    const m = r.mechanism
    assert.ok(m.length >= 2, `${r.id}: steps`)
    const base = side([...r.reactants, ...(r.extras ?? [])], [...r.coeffs.slice(0, r.reactants.length), ...(r.extras ?? []).map(() => 1)])
    m.forEach((st, i) => {
      const s = side(st.species, st.species.map(() => 1))
      const keys = new Set([...Object.keys(s.atoms), ...Object.keys(base.atoms)])
      for (const k of keys) assert.equal(s.atoms[k] ?? 0, base.atoms[k] ?? 0, `${r.id} state ${i} (${st.label}): ${k}`)
      assert.equal(s.charge, base.charge, `${r.id} state ${i}: charge`)
      assert.ok(st.text.length > 20, `${r.id} state ${i}: text`)
      assert.ok(Number.isFinite(st.energy), `${r.id} state ${i}: energy`)
      if (i === 0) assert.equal(st.energy, 0, `${r.id}: reactants are the zero of energy`)
      if (i > 0) {
        assert.ok(st.ts !== undefined, `${r.id} state ${i}: ts`)
        assert.ok((st.ts as number) >= Math.max(m[i - 1].energy, st.energy), `${r.id} state ${i}: TS below a neighbour`)
      }
    })
    const info = analyse(profileFromMechanism(m))
    assert.ok(info.valid, `${r.id}: profile ${info.message}`)
  }
})

test('templates: at least 25, valid shape', () => {
  assert.ok(TEMPLATES.length >= 25, `${TEMPLATES.length}`)
  const ids = new Set<string>()
  for (const t of TEMPLATES) {
    assert.ok(!ids.has(t.id), t.id)
    ids.add(t.id)
    assert.ok(t.smarts.length >= 1 && t.smarts.every((s) => s.includes('>>')), t.id)
    for (const r of t.example.reactants) readSmiles(r)
    readSmiles(t.example.expect)
    assert.ok(t.needs.length >= 1 && t.conditions && t.rule, t.id)
  }
})

// ------------------------------------------------------------------ ODE solvers

test('ODE: exponential decay with every method', () => {
  const sys: OdeSystem = { n: 1, f: (_t, y, out) => { out[0] = -0.7 * y[0] }, jac: (_t, _y, J) => { J[0][0] = -0.7 } }
  const times = [0, 1, 2, 5, 10]
  for (const method of ['rk4', 'rk45', 'stiff', 'auto'] as const) {
    const sol = solveOde(sys, [2], { times, method, rtol: 1e-9 })
    assert.ok(sol.ok, method)
    times.forEach((t, i) => near(sol.y[i][0], 2 * Math.exp(-0.7 * t), method === 'stiff' ? 2e-5 : method === 'rk4' ? 1e-5 : 1e-7))
  }
})

test('ODE: harmonic oscillator keeps its energy (RK45)', () => {
  const sys: OdeSystem = { n: 2, f: (_t, y, out) => { out[0] = y[1]; out[1] = -y[0] } }
  const times = Array.from({ length: 41 }, (_, i) => (i * 2 * Math.PI) / 10)
  const sol = solveOde(sys, [1, 0], { times, method: 'rk45', rtol: 1e-10, atol: 1e-12 })
  const end = sol.y[sol.y.length - 1]
  near(end[0], 1, 1e-6)
  near(end[1], 0, 1e-6)
})

test('ODE: the stiff Robertson problem (t = 40), solved by Auto', () => {
  const k1 = 0.04, k2 = 3e7, k3 = 1e4
  const sys: OdeSystem = {
    n: 3,
    f: (_t, y, o) => {
      o[0] = -k1 * y[0] + k3 * y[1] * y[2]
      o[1] = k1 * y[0] - k3 * y[1] * y[2] - k2 * y[1] * y[1]
      o[2] = k2 * y[1] * y[1]
    },
  }
  const sol = solveOde(sys, [1, 0, 0], { times: [0, 0.4, 4, 40], method: 'auto', rtol: 1e-7, atol: 1e-12 })
  assert.ok(sol.ok)
  assert.equal(sol.method, 'stiff', 'switched to the stiff solver')
  const y = sol.y[3]
  near(y[0], 0.7158, 2e-4)
  rel(y[1], 9.185e-6, 5e-3)
  near(y[2], 0.2842, 2e-4)
  assert.ok(sol.steps < 20000, `${sol.steps} steps`)
  near(y[0] + y[1] + y[2], 1, 1e-8)
})

test('linear solver', () => {
  const A = [[2, 1], [1, 3]]
  const b = [3, 5]
  assert.ok(solveLinear(A, b))
  near(b[0], 0.8)
  near(b[1], 1.4)
  assert.ok(!solveLinear([[1, 2], [2, 4]], [1, 2]))
})

// ------------------------------------------------------------------ the kinetics syntax and simulator

const net = (text: string) => {
  const r = parseNetwork(text)
  assert.deepEqual(r.errors, [])
  return r.network!
}

test('network syntax: species, steps, Arrhenius, fixed, errors', () => {
  const n = net('# decay\nT = 25 C\n[A]0 = 2\nB = 0\nfixed M = 1\nA + M -> B + M ; k = 0.1\n2 B <=> C ; kf = 3, K = 6\nC -> D ; A = 1e10, Ea = 50')
  assert.deepEqual(n.species, ['A', 'B', 'M', 'C', 'D'])
  assert.deepEqual(n.init, [2, 0, 1, 0, 0])
  assert.deepEqual(n.fixed, [false, false, true, false, false])
  near(n.T!, 298.15, 1e-9)
  assert.equal(n.steps.length, 3)
  assert.equal(n.steps[1].reversible, true)
  near(n.steps[1].kr, 0.5)
  near(n.steps[1].reactants[0].n, 2)
  rel(n.steps[2].kf, 1e10 * Math.exp(-50 / (8.314462618e-3 * 298.15)), 1e-9)
  assert.deepEqual(parseNetwork('A -> B').errors.length, 1)
  assert.match(parseNetwork('A -> B').errors[0], /No rate constant/)
  assert.match(parseNetwork('A -> B ; A = 1e8, Ea = 50').errors[0], /temperature/)
  assert.match(parseNetwork('A <=> B ; kf = 1').errors[0], /reverse/)
  assert.match(parseNetwork('hello world').errors[0], /Line 1/)
  assert.match(parseNetwork('').errors[0], /at least one/)
  assert.match(parseNetwork('A -> 3 ; k = 1').errors[0], /not a species/)
  assert.deepEqual(net('0 -> A ; k = 0.01\nA -> 0 ; k = 0.1').steps.map((s) => s.reactants.length + s.products.length), [1, 1])
  assert.equal(parseNetwork('X = 1\nA -> B ; k=1').warnings.length, 1)
})

test('kinetics: first order against the analytic solution', () => {
  const sim = simulate(net('A = 1.5\nB = 0\nA -> B ; k = 0.2'), { tEnd: 20, points: 50 })
  assert.ok(sim.ok)
  sim.t.forEach((t, i) => {
    near(sim.c[i][0], firstOrder(1.5, 0.2, t), 1e-7)
    near(sim.c[i][0] + sim.c[i][1], 1.5, 1e-9)
  })
  const s = summarise(sim)
  near(s[0].tHalf!, Math.LN2 / 0.2, 0.05)
})

test('kinetics: second order 2A → B', () => {
  const sim = simulate(net('A = 1\n2 A -> B ; k = 0.5'), { tEnd: 10, points: 40 })
  sim.t.forEach((t, i) => near(sim.c[i][0], 1 / (1 + 2 * 0.5 * t), 1e-7))
})

test('kinetics: A → B → C, maximum of B at ln(k2/k1)/(k2−k1)', () => {
  const k1 = 0.5, k2 = 0.2
  const sim = simulate(net(`A = 1\nA -> B ; k = ${k1}\nB -> C ; k = ${k2}`), { tEnd: 20, points: 2000, method: 'rk45' })
  const analytic = consecutiveMax(k1, k2)
  near(analytic.t, Math.log(k2 / k1) / (k2 - k1), 1e-12)
  const b = summarise(sim).find((x) => x.name === 'B')!
  near(b.tMax, analytic.t, 0.02)
  near(b.max, analytic.b, 1e-4)
  sim.t.forEach((t, i) => near(sim.c[i][1], consecutiveB(k1, k2, 1, t), 1e-7))
  near(consecutiveMax(0.3, 0.3).t, 1 / 0.3, 1e-9)
})

test('kinetics: reversible A ⇌ B reaches K, parallel steps keep the ratio, mass is conserved', () => {
  const rev = simulate(net('A = 1\nA <=> B ; kf = 0.3, kr = 0.1'), { tEnd: 60, points: 60 })
  const end = rev.c[rev.c.length - 1]
  near(end[1] / end[0], 3, 1e-4)
  const par = simulate(net('A = 1\nA -> B ; k = 0.3\nA -> C ; k = 0.1'), { tEnd: 80, points: 40 })
  const e = par.c[par.c.length - 1]
  near(e[1] / e[2], 3, 1e-6)
  near(e[1], 0.75, 1e-4)
  const mid = par.c[10]
  near(mid[1] / mid[2], 3, 1e-6)
})

test('kinetics: Michaelis–Menten steady state and Lineweaver–Burk', () => {
  const k1 = 10, km1 = 1, kcat = 2, e0 = 0.01
  const res = michaelisMenten({ k1, km1, kcat, e0, s0: [0.1, 0.2, 0.5, 1, 2, 5] })
  near(res.km, 0.3, 1e-12)
  near(res.vmax, 0.02, 1e-12)
  for (const p of res.points) rel(p.v, p.vTheory, 0.03)
  rel(res.lb.vmax, 0.02, 0.03)
  rel(res.lb.km, 0.3, 0.06)
  assert.ok(res.lb.r2 > 0.999)
  // the full simulation reaches the steady state of ES: [ES] = E0 S / (Km + S)
  const sim = simulate(net(`E = ${e0}\nS = 1\nE + S <=> ES ; kf = ${k1}, kr = ${km1}\nES -> E + P ; k = ${kcat}`), { tEnd: 2, points: 20 })
  const es = sim.c[sim.c.length - 1][sim.species.indexOf('ES')]
  rel(es, (e0 * 1) / (0.3 + 1), 0.02)
})

test('kinetics: stiff network (Robertson text) and the Brusselator oscillates', () => {
  const rob = PRESETS.find((p) => p.id === 'robertson')!
  const sim = simulate(net(rob.text), { tEnd: 40, points: 40 })
  assert.ok(sim.ok)
  assert.equal(sim.method, 'stiff')
  near(sim.c[sim.c.length - 1][0], 0.7158, 5e-4)
  const bru = PRESETS.find((p) => p.id === 'brusselator')!
  const b = simulate(net(bru.text), { tEnd: 60, points: 600 })
  const x = b.c.map((r) => r[b.species.indexOf('X')])
  let turns = 0
  for (let i = 2; i < x.length; i++) if ((x[i - 1] - x[i - 2]) * (x[i] - x[i - 1]) < 0) turns++
  assert.ok(turns >= 8, `${turns} turning points`)
})

test('kinetics: every preset parses, runs and conserves what it should', () => {
  assert.ok(PRESETS.length >= 11)
  for (const p of PRESETS) {
    const n = net(p.text)
    const sim = simulate(n, { tEnd: p.tEnd, points: 120, logTime: p.logTime })
    assert.ok(sim.ok, p.id)
    assert.ok(sim.c.every((row) => row.every((v) => Number.isFinite(v) && v > -1e-6)), `${p.id}: finite, non-negative`)
    assert.ok(p.note.length > 40)
  }
  const sir = net(PRESETS.find((p) => p.id === 'sir')!.text)
  const s = simulate(sir, { tEnd: 120, points: 200 })
  for (const row of s.c) near(row[0] + row[1] + row[2], 1, 1e-7)
  const auto = simulate(net(PRESETS.find((p) => p.id === 'autocatalysis')!.text), { tEnd: 40, points: 100 })
  assert.ok(auto.c[auto.c.length - 1][1] > 0.99)
  const g = timeGrid(100, 10, true)
  assert.equal(g[0], 0)
  near(g[g.length - 1], 100, 1e-9)
  assert.ok(g[1] < 0.01)
  const sys = networkSystem(net('A = 1\nB = 0.5\nA + B <=> C ; kf = 2, kr = 1'))
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  sys.jac!(0, [1, 0.5, 0.2], J)
  near(J[0][0], -2 * 0.5)
  near(J[0][1], -2 * 1)
  near(J[0][2], 1)
  near(J[2][2], -1)
})

// ------------------------------------------------------------------ fitting

test('regression and data parsing', () => {
  const f = linreg([1, 2, 3, 4], [2.1, 3.9, 6.2, 7.8])
  near(f.slope, 1.94, 1e-9)
  assert.ok(f.r2 > 0.99)
  assert.ok(f.seSlope > 0)
  const t = parseTable('# t  c\n0 1.0\n1, 0.5\n2;0.25\nhello world\n3\t0.125')
  assert.deepEqual(t.x, [0, 1, 2, 3])
  assert.deepEqual(t.y, [1, 0.5, 0.25, 0.125])
  assert.equal(t.skipped, 1)
})

// small deterministic noise so the test is repeatable
const noise = (() => {
  let s = 12345
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296 - 0.5
  }
})()

test('order determination recovers the order, k and half-life from noisy data', () => {
  const t = Array.from({ length: 16 }, (_, i) => i * 5)
  const c0 = 1.0
  const k1 = 0.03
  const first = fitOrder(t, t.map((x) => c0 * Math.exp(-k1 * x) * (1 + 0.01 * noise())))
  assert.equal(first.best?.order, 1)
  rel(first.best!.k, k1, 0.03)
  rel(first.best!.halfLife, Math.LN2 / k1, 0.03)
  assert.ok(first.best!.kSE < 0.002)
  const k2 = 0.04
  const second = fitOrder(t, t.map((x) => c0 / (1 + k2 * c0 * x) * (1 + 0.005 * noise())))
  assert.equal(second.best?.order, 2)
  rel(second.best!.k, k2, 0.03)
  rel(second.best!.halfLife, 1 / (k2 * c0), 0.04)
  const k0 = 0.01
  const tz = t.slice(0, 14)
  const z = fitOrder(tz, tz.map((x) => c0 - k0 * x + 0.002 * noise()))
  assert.equal(z.best?.order, 0)
  rel(z.best!.k, k0, 0.03)
  rel(z.best!.halfLife, c0 / (2 * k0), 0.03)
  assert.equal(fitOrder([0, 1], [1, 0.5]).best, null)
  assert.match(fitOrder([0, 1], [1, 0.5]).message, /three/)
  // linearised data are exposed for plotting
  assert.equal(first.fits[1].yData.length, t.length)
})

test('Arrhenius recovers Ea and A (and Eyring ΔH‡, ΔS‡)', () => {
  const Ea = 75 // kJ/mol
  const A = 2e11
  const T = [290, 300, 310, 320, 330, 340, 350]
  const k = T.map((x) => A * Math.exp(-(Ea * 1000) / (8.314462618 * x)) * (1 + 0.01 * noise()))
  const r = arrhenius(T, k)
  rel(r.Ea, Ea, 0.01)
  rel(r.A, A, 0.3)
  assert.ok(r.EaSE > 0 && r.EaSE < 2)
  assert.ok(r.fit.r2 > 0.999)
  rel(r.k298, A * Math.exp(-(Ea * 1000) / (8.314462618 * 298.15)), 0.05)
  const dH = 60, dS = -40
  const kE = T.map((x) => ((1.380649e-23 * x) / 6.62607015e-34) * Math.exp(dS / 8.314462618) * Math.exp(-(dH * 1000) / (8.314462618 * x)))
  const e = eyring(T, kE)
  near(e.dH, dH, 1e-6)
  near(e.dS, dS, 1e-4)
  near(e.dG298, dH - (298.15 * dS) / 1000, 1e-4)
})

// ------------------------------------------------------------------ energy and equilibrium

test('thermodynamics: ΔG, K, van \'t Hoff, Kp/Kc', () => {
  const t = thermo(-92, -199, 298)
  near(t.dG, -92 + (298 * 199) / 1000, 1e-9)
  rel(t.K, Math.exp(-(t.dG * 1000) / (8.314462618 * 298)), 1e-12)
  assert.match(t.verdict, /Spontaneous below/)
  near(t.crossover!, 92 / 0.199, 1e-6)
  assert.match(thermo(-10, 50, 300).verdict, /every temperature/)
  assert.match(thermo(10, -50, 300).verdict, /any temperature/)
  assert.match(thermo(50, 150, 300).verdict, /above/)
  near(dGFromK(1, 298), 0, 1e-12)
  rel(dGFromK(10, 298.15), -5.708, 1e-3)
  const K2 = vantHoffK2(1e5, 298, 500, -92)
  assert.ok(K2 < 1e5)
  near(vantHoffDH(1e5, 298, K2, 500), -92, 1e-6)
  rel(kcToKp(0.0059, 298.15, 1), 0.0059 * 0.082057366 * 298.15, 1e-9)
  rel(kpToKc(kcToKp(3.2, 400, -2), 400, -2), 3.2, 1e-12)
  rel(kcToKp(1, 300, 1, 'bar'), 0.08314462618 * 300, 1e-9)
})

test('ICE table: N2O4 ⇌ 2 NO2 (textbook), exact root', () => {
  const p = parseEquilibrium('N2O4 <=> 2 NO2', 'N2O4 = 0.100, NO2 = 0')
  assert.equal(p.dnGas, 1)
  assert.deepEqual(p.species.map((s) => s.nu), [-1, 2])
  const K = 0.0059
  const r = solveIce(p.species, K)
  assert.ok(r.ok)
  const x = (-K + Math.sqrt(K * K + 1.6 * K)) / 8 // 4x²/(0.1 − x) = K
  near(r.extent, x, 1e-12)
  near(r.rows[0].equilibrium, 0.1 - x, 1e-12)
  near(r.rows[1].equilibrium, 2 * x, 1e-12)
  near(r.Q, K, K * 1e-9)
  assert.equal(r.direction, 'forward')
  assert.ok(r.conversion! > 0.1 && r.conversion! < 0.2)
  // from the other side: only product, reverse reaction
  const rev = solveIce(parseEquilibrium('N2O4 <=> 2 NO2', 'NO2 = 0.2').species, K)
  assert.equal(rev.direction, 'reverse')
  near(rev.rows[1].equilibrium ** 2 / rev.rows[0].equilibrium, K, 1e-9)
  // at equilibrium already
  const here = solveIce([{ ...p.species[0], initial: 0.1 - x }, { ...p.species[1], initial: 2 * x }], K)
  assert.equal(here.direction, 'equilibrium')
  near(here.extent, 0, 1e-10)
})

test('ICE table: other stoichiometries, solids, extremes and errors', () => {
  // N2 + 3 H2 ⇌ 2 NH3
  const h = parseEquilibrium('N2 + 3 H2 <=> 2 NH3', 'N2 = 1, H2 = 3')
  const r = solveIce(h.species, 0.5)
  const [n2, h2, nh3] = r.rows.map((x) => x.equilibrium)
  near(nh3 ** 2 / (n2 * h2 ** 3), 0.5, 1e-9)
  near(n2, 1 - r.extent, 1e-12)
  // H2 + I2 ⇌ 2 HI, K = 54.3, from 1 M each: 2x/(1 − x) = √K, [HI] = 2x
  const hi = solveIce(parseEquilibrium('H2 + I2 <=> 2 HI', 'H2 = 1, I2 = 1').species, 54.3)
  const rootK = Math.sqrt(54.3)
  rel(hi.rows[2].equilibrium, (2 * rootK) / (2 + rootK), 1e-9)
  // very small and very large K
  const tiny = solveIce(parseEquilibrium('A <=> B', 'A = 1').species, 1e-12)
  rel(tiny.rows[1].equilibrium, 1e-12, 1e-6)
  const huge = solveIce(parseEquilibrium('A <=> B', 'A = 1').species, 1e12)
  rel(huge.rows[0].equilibrium, 1e-12, 1e-3) // 1 − ξ loses digits when the reaction is almost complete
  // a solid does not appear in Q: C(s) + CO2 ⇌ 2 CO
  const s = parseEquilibrium('C(s) + CO2(g) <=> 2 CO(g)', 'C(s) = 1, CO2 = 1')
  assert.equal(s.species[0].active, false)
  const sr = solveIce(s.species, 2)
  near(sr.rows[2].equilibrium ** 2 / sr.rows[1].equilibrium, 2, 1e-9)
  assert.equal(s.dnGas, 1)
  assert.ok(!solveIce(parseEquilibrium('A <=> B', 'A = 1').species, -1).ok)
  assert.ok(!solveIce(parseEquilibrium('A <=> B', 'A = 0, B = 0').species, 1).ok)
  assert.throws(() => parseEquilibrium('A B', ''), /arrow/)
  assert.throws(() => parseEquilibrium('A <=> B', 'C = 1'), /not in the reaction/)
  assert.throws(() => parseEquilibrium('A + A <=> B', ''), /twice/)
  near(quotient(h.species, 0), Infinity === quotient(h.species, 0) ? Infinity : 0, 0)
})

test('Le Chatelier: adding reactant, compressing, heating an endothermic reaction', () => {
  const p = parseEquilibrium('N2O4 <=> 2 NO2', 'N2O4 = 0.100')
  const K = 0.0059
  const eq = solveIce(p.species, K)
  const add = leChatelier(p.species, K, eq, { kind: 'add', species: 'N2O4', amount: 0.05 })
  assert.equal(add.direction, 'forward')
  assert.ok(add.result.rows[1].equilibrium > eq.rows[1].equilibrium)
  const squeeze = leChatelier(p.species, K, eq, { kind: 'volume', factor: 0.5 })
  assert.equal(squeeze.direction, 'reverse', 'fewer moles of gas are favoured at high pressure')
  const expand = leChatelier(p.species, K, eq, { kind: 'volume', factor: 2 })
  assert.equal(expand.direction, 'forward')
  const heat = leChatelier(p.species, K, eq, { kind: 'temperature', T1: 298, T2: 350, dH: 57 })
  assert.equal(heat.direction, 'forward')
  assert.ok(heat.K2 > K)
  const cool = leChatelier(p.species, K, eq, { kind: 'temperature', T1: 298, T2: 250, dH: 57 })
  assert.equal(cool.direction, 'reverse')
  assert.match(add.explanation, /Q = /)
  assert.throws(() => leChatelier(p.species, K, eq, { kind: 'add', species: 'X', amount: 1 }), /not in the reaction/)
})

test('energy profiles: Ea, ΔH, rate-determining step, Hammond, catalyst, curve', () => {
  const p = simpleProfile(-92, 230)
  const a = analyse(p)
  assert.ok(a.valid)
  near(a.dH, -92)
  near(a.eaOverall, 230)
  near(a.eaReverse, 322)
  assert.equal(a.rds, 0)
  assert.match(a.steps[0].hammond, /Exothermic/)
  const cat = catalysed(p, 80)
  near(cat.points[1].energy, 150)
  near(analyse(cat).dH, -92)
  assert.ok(catalysed(p, 1e6).points[1].energy > 0, 'never below the reactants')
  const two = normalise([{ label: 'R', energy: 0 }, { label: 'TS1', energy: 80 }, { label: 'I', energy: 20 }, { label: 'TS2', energy: 50 }, { label: 'P', energy: -30 }])
  const b = analyse(two)
  assert.equal(b.rds, 0)
  near(b.steps[1].eaF, 30)
  near(b.span, 80)
  assert.deepEqual(two.points.map((x) => x.kind), ['reactant', 'ts', 'intermediate', 'ts', 'product'])
  assert.ok(!analyse(normalise([{ label: 'R', energy: 0 }, { label: 'TS', energy: -5 }, { label: 'P', energy: 10 }])).valid)
  assert.ok(!analyse({ points: [] }).valid)
  const c = curve(two, 10)
  near(c.x[0], 0)
  near(c.y[0], 0)
  near(c.x[c.x.length - 1], 4)
  near(c.y[c.y.length - 1], -30)
  assert.ok(Math.max(...c.y) <= 80 + 1e-9)
  // from a library mechanism
  const sn1 = analyse(profileFromMechanism(findReaction('sn1')!.mechanism!))
  assert.ok(sn1.valid)
  assert.equal(sn1.steps.length, 3)
  assert.equal(sn1.rds, 0, 'ionisation is rate-determining')
})

// ------------------------------------------------------------------ file, notebook, report, pictures

test('.kreact round trip and tolerant reading', () => {
  const ws = defaultWorkspace()
  ws.builder.reactants = ['CCO', 'O2']
  ws.builder.coeffs = [1, 3, 2, 3]
  ws.builder.above = 'Cu'
  ws.kinetics.text = 'A -> B ; k = 2'
  ws.kinetics.hidden = ['B']
  ws.energy.profile = simpleProfile(-50, 100, 'Start', 'End')
  ws.notebook = [newEntry('Builder', 'Combustion', 'C2H6O + 3 O2 → 2 CO2 + 3 H2O', ['<svg/>'], 1700000000000)]
  const text = serializeWorkspace(ws)
  const json = JSON.parse(text)
  assert.equal(json.format, 'kreact')
  assert.equal(json.version, 1)
  const back = parseWorkspace(text)
  assert.deepEqual(back.warnings, [])
  assert.deepEqual(back.workspace.builder, ws.builder)
  assert.deepEqual(back.workspace.kinetics, ws.kinetics)
  assert.deepEqual(back.workspace.energy, ws.energy)
  assert.deepEqual(back.workspace.notebook, ws.notebook)
  assert.equal(serializeWorkspace(back.workspace), text)
  // missing parts take defaults, junk is ignored
  const partial = parseWorkspace(JSON.stringify({ format: 'kreact', version: 1, builder: { reactants: ['C'], arrow: 'nonsense' }, kinetics: { logTime: 'yes' } }))
  assert.deepEqual(partial.workspace.builder.reactants, ['C'])
  assert.equal(partial.workspace.builder.arrow, 'forward')
  assert.equal(partial.workspace.kinetics.logTime, defaultWorkspace().kinetics.logTime)
  assert.match(parseWorkspace(JSON.stringify({ format: 'kreact', version: 9 })).warnings[0], /version 9/)
  assert.throws(() => parseWorkspace('{"format": "kbook"}'), /not a \.kreact/)
  assert.throws(() => parseWorkspace('nope'), /not valid JSON/)
})

test('notebook and report as Markdown', () => {
  const e1 = newEntry('Reaction builder', 'Methane combustion', 'CH4 + 2 O2 → CO2 + 2 H2O', ['<svg viewBox=\'0 0 10 10\'></svg>'], 1700000000000)
  const e2 = newEntry('Kinetics', '', 'k = 0.05', [], 1700000100000)
  assert.equal(e2.label, 'Kinetics')
  const md = toMarkdown([e1, e2])
  assert.match(md, /^# kReaction notebook/)
  assert.match(md, /## Methane combustion/)
  assert.match(md, /!\[Methane combustion\]\(data:image\/svg\+xml;base64,/)
  assert.match(toMarkdown([]), /Nothing pinned/)
  assert.match(toPlainText([e1]), /Methane combustion/)

  const a = analyseReaction({ reactants: ['methane', 'oxygen'], products: ['carbon dioxide', 'water'], arrow: 'forward', above: 'flame', below: '' }, {}, [1, 2, 1, 2])
  const svgs = new Map([['C', '<svg/>']])
  const report = reportMarkdown({ analysis: a, input: { arrow: 'forward', above: 'flame', below: '' }, coeffs: [1, 2, 1, 2], svgs, sections: [{ heading: 'Notes', body: 'hello' }], date: new Date('2026-01-02') })
  assert.match(report, /# Reaction report/)
  assert.match(report, /\*\*CH4 \+ 2 O2 → CO2 \+ 2 H2O\*\*/)
  assert.match(report, /Conditions: flame/)
  assert.match(report, /balanced in atoms, mass and charge/)
  assert.match(report, /\| mass \(g\/mol\) \|/)
  assert.match(report, /## Notes\n\nhello/)
  assert.match(report, /!\[methane\]\(data:image\/svg\+xml/)
})

test('SVG theming: strokes follow the text colour, elements use theme variables, print version has a white background', () => {
  const raw = "<?xml version='1.0' encoding='iso-8859-1'?>\n<svg version='1.1' width='200px' height='150px' viewBox='0 0 200 150'>\n<!-- END OF HEADER -->\n" +
    "<path class='bond-0' d='M 1,1 L 2,2' style='fill:none;stroke:#FF0000;stroke-width:2.0px' />\n<path class='bond-1' d='M 2,2 L 3,3' style='fill:none;stroke:#000000;stroke-width:2.0px' />\n" +
    "<path class='atom-0' d='M 1 1 L 2 2' fill='#0000FF'/>\n<path class='atom-1' d='M 1 1 L 2 2' fill='#000000'/>\n</svg>"
  const t = themeSvg(raw)
  assert.ok(!t.includes('<?xml') && !t.includes('END OF HEADER'))
  assert.ok(t.includes('stroke:currentColor'))
  assert.ok(t.includes('stroke:var(--k-danger)'))
  assert.ok(t.includes("style='fill:var(--k-link)'"))
  assert.ok(t.includes("style='fill:currentColor'"))
  assert.ok(!t.includes('#000000') && !t.includes('#FF0000'))
  const s = staticSvg(raw)
  assert.ok(s.includes('#000000') && s.includes("<rect width='200' height='150'"))
})

test('chart figures are plain Plotly data', () => {
  const sim = simulate(net('A = 1\nA -> B ; k = 1'), { tEnd: 5, points: 20, logTime: true })
  const fig = kineticsFigure({ sim, hidden: ['B'], logTime: true })
  assert.equal(fig.data.length, 1)
  assert.equal(((fig.layout.xaxis as Record<string, unknown>).type), 'log')
  assert.equal((fig.data[0].x as number[]).length, sim.t.length - 1, 'log axis drops t = 0')
  const p = profileFigure({ profile: simpleProfile(-20, 60), overlay: catalysed(simpleProfile(-20, 60), 20), active: 1 })
  assert.ok(p.data.length >= 4)
  assert.ok((p.layout.annotations as unknown[]).length >= 2)
  JSON.stringify(p) // serialisable
})

test('equation pictures (SVG) hold structures, coefficients and conditions', () => {
  const svg = equationSvg({
    reactants: [{ svg: "<svg viewBox='0 0 100 80' width='100px' height='80px'><path d='M0 0'/></svg>", label: 'CH4', coeff: 1 }, { svg: null, label: 'O2', coeff: 2 }],
    products: [{ svg: null, label: 'CO2', coeff: 1 }, { svg: null, label: 'H2O', coeff: 2 }],
    arrow: '→', above: 'flame', below: '', background: true,
  })
  assert.match(svg, /^<svg xmlns=/)
  assert.ok(svg.includes('>flame<') && svg.includes('>O2<') && svg.includes('>H2O<') && svg.includes('>+<'))
  assert.ok(svg.includes("<svg x='10'"), 'the structure is placed inside')
  assert.ok(svg.includes("fill='#FFFFFF'"))
  assert.ok(!/width='100px'/.test(svg.replace(/^<svg[^>]*>/, '')), 'inner size attributes are replaced')
  assert.match(svg, /viewBox='0 0 \d+ 140'/)
})

test('network form: text ⇄ form round trip and rate fields', () => {
  const text = 'T = 300\nA = 1\nfixed M = 2\nA + M <=> B ; kf = 3, kr = 1\nB -> C ; A = 1e9, Ea = 40'
  const net1 = net(text)
  const form = networkToForm(net1)
  assert.equal(form.T, '300')
  assert.deepEqual(form.species.map((x) => [x.name, x.init, x.fixed]), [['A', '1', false], ['M', '2', true], ['B', '0', false], ['C', '0', false]])
  assert.equal(form.steps.length, 2)
  const back = net(formToText(form))
  assert.deepEqual(back.species, net1.species)
  assert.deepEqual(back.init, net1.init)
  assert.deepEqual(back.fixed, net1.fixed)
  back.steps.forEach((st, i) => {
    near(st.kf, net1.steps[i].kf, Math.abs(net1.steps[i].kf) * 1e-12)
    near(st.kr, net1.steps[i].kr, Math.abs(net1.steps[i].kr) * 1e-12)
  })
  const f = readRateFields('kf = 3, kr = 1')
  assert.equal(f.arrhenius, false)
  assert.equal(writeRateFields(f, true), 'kf = 3, kr = 1')
  assert.equal(writeRateFields({ ...f, kr: 'K=4' }, true), 'kf = 3, K = 4')
  const arr = readRateFields('A = 1e9, Ea = 40')
  assert.ok(arr.arrhenius)
  assert.equal(writeRateFields(arr, false), 'A = 1e9, Ea = 40')
  assert.equal(writeRateFields({ ...arr, A: '2e9' }, true), 'Af = 2e9, Eaf = 40')
})

test('a balanced reaction becomes a kinetic model', () => {
  const text = reactionToNetwork([{ label: 'C2H6O', coeff: 1 }, { label: 'O2', coeff: 3 }], [{ label: 'CO2', coeff: 2 }, { label: 'H2O', coeff: 3 }], false)
  const n = net(text)
  assert.deepEqual(n.species, ['C2H6O', 'O2', 'CO2', 'H2O'])
  assert.equal(n.steps[0].reactants[1].n, 3)
  assert.equal(n.steps[0].products[0].n, 2)
  const ions = net(reactionToNetwork([{ label: 'Ag+', coeff: 1 }, { label: 'Cl−', coeff: 1 }], [{ label: 'AgCl', coeff: 1 }], true))
  assert.deepEqual(ions.species, ['Ag', 'Cl', 'AgCl'])
  assert.ok(ions.steps[0].reversible)
})

test('AI tools: the answers are plain data and the manifest fits the limits', () => {
  assert.ok(KREACTION_TOOL_SET.tools.length <= 7)
  assert.ok(KREACTION_TOOL_SET.summary.length <= 120)
  for (const t of KREACTION_TOOL_SET.tools) assert.ok(Object.keys((t.inputSchema.properties ?? {}) as object).length <= 6, t.action)
  assert.deepEqual(KREACTION_TOOL_SET.tools.map((t) => t.action), ['set_reaction', 'load_example', 'predict_products', 'simulate_kinetics', 'fit_order', 'equilibrium', 'export_report'])

  // set_reaction
  assert.equal(reactionRequest({}), null)
  const req = reactionRequest({ reactants: ['ethanol', 'O2'], products: ['CO2', 'water'] })!
  assert.equal(req.balance, true)
  const ans = describeReaction(req.input, req.balance)
  assert.equal(ans.result.balanced, true)
  assert.deepEqual(ans.coefficients, [1, 3, 2, 3])
  assert.match(String(ans.result.equation), /^C2H6O \+ 3 O2 → 2 CO2 \+ 3 H2O$|^ethanol/)
  const sp = (ans.result.species as { role: string; coefficient: number; smiles?: string }[])
  assert.equal(sp[0].smiles, 'CCO')
  assert.equal(sp[1].coefficient, 3)
  const whole = reactionRequest({ reactants: 'CH4 + O2 -> CO2 + H2O' })!
  assert.deepEqual(whole.input.products, ['CO2', 'H2O'])
  assert.deepEqual(describeReaction(whole.input, true).coefficients, [1, 2, 1, 2])
  assert.equal(describeReaction(whole.input, false).result.balanced, false)
  assert.throws(() => reactionRequest({ reactants: ['H2'] }), /both reactants and products/)
  const bad = describeReaction({ reactants: ['C(C'], products: ['H2O'], arrow: 'forward', above: '', below: '' }, true)
  assert.ok(Array.isArray(bad.result.errors))
  assert.deepEqual(speciesList('A + B'), ['A', 'B'])
  assert.deepEqual(speciesList(['x', ' ', 'y']), ['x', 'y'])

  // load_example
  const list = listExamples()
  assert.ok(list.length >= 40 && list.every((e) => typeof e.id === 'string'))
  const ex = exampleDetails('sn1') as { mechanism: { step: number }[]; equation: string; explanation: string }
  assert.equal(ex.mechanism.length, 4)
  assert.match(ex.equation, /→/)
  assert.throws(() => exampleDetails('sn'), /Did you mean/)

  // simulate_kinetics
  const fallback = { text: 'A -> B ; k = 1', tEnd: '5', logTime: false, method: 'auto' as const }
  const kreq = kineticsRequest({ network: 'consecutive', samples: 5 }, fallback)
  assert.equal(kreq.presetId, 'consecutive')
  assert.equal(kreq.tEnd, 20)
  const kres = runKinetics(kreq) as { times: number[]; concentrations: Record<string, number[]>; summary: { species: string; time_of_maximum: number }[] }
  assert.equal(kres.times.length, 5)
  assert.equal(kres.concentrations.A.length, 5)
  near(kres.summary.find((x) => x.species === 'B')!.time_of_maximum, 3.05, 0.1)
  assert.equal(runKinetics(kineticsRequest({}, fallback)).t_end, 5)
  assert.throws(() => runKinetics(kineticsRequest({ network: 'A -> B' }, fallback)), /No rate constant/)
  assert.throws(() => kineticsRequest({ t_end: -1 }, fallback), /above zero/)

  // fit_order
  const t = [0, 10, 20, 30, 40, 50]
  const fit = runFit(fitRequest({ x: t, y: t.map((x) => Math.exp(-0.03 * x)) })) as { order: number; rate_constant: number; half_life: number }
  assert.equal(fit.order, 1)
  near(fit.rate_constant, 0.03, 1e-6)
  const fromText = runFit(fitRequest({ data: '0 1\n10 0.5\n20 0.25\n30 0.125' })) as { order: number }
  assert.equal(fromText.order, 1)
  const ea = runFit(fitRequest({ mode: 'arrhenius', x: [300, 320, 340, 360], y: [300, 320, 340, 360].map((T) => 1e10 * Math.exp(-60000 / (8.314462618 * T))) })) as { activation_energy_kJ_per_mol: number }
  near(ea.activation_energy_kJ_per_mol, 60, 1e-4)
  assert.throws(() => fitRequest({ x: [1, 2] , y: [1, 2] }), /at least three/i)
  assert.throws(() => fitRequest({ mode: 'foo', x: [1, 2, 3], y: [1, 2, 3] }), /mode must be/)

  // equilibrium
  const eq = runEquilibrium({ equation: 'N2O4 <=> 2 NO2', initial: 'N2O4 = 0.1', K: 0.0059, T: 298 }) as { ice_table: { species: string; equilibrium: number }[]; direction: string; Kp_from_Kc: number }
  rel(eq.ice_table[1].equilibrium, 2 * (-0.0059 + Math.sqrt(0.0059 ** 2 + 1.6 * 0.0059)) / 8, 1e-5)
  assert.match(eq.direction, /forward/)
  assert.ok(eq.Kp_from_Kc > 0.14 && eq.Kp_from_Kc < 0.15)
  const th = runEquilibrium({ dH: -92, dS: -199, T: 298 }) as { thermodynamics: { delta_G_kJ_per_mol: number; K: number } }
  near(th.thermodynamics.delta_G_kJ_per_mol, -32.698, 1e-3)
  assert.throws(() => runEquilibrium({}), /ICE table/)
  assert.throws(() => runEquilibrium({ equation: 'A <=> B' }), /K must be a number/)
})

test('more charts', () => {
  const g = gibbsFigure(-92, -199, 298)
  assert.equal(g.data.length, 2)
  const ice = iceFigure([{ name: 'A', initial: 1, equilibrium: 0.2 }, { name: 'B', initial: 0, equilibrium: 0.8 }])
  assert.equal(ice.data.length, 2)
  const mm = michaelisMenten({ k1: 10, km1: 1, kcat: 2, e0: 0.01, s0: [0.1, 0.3, 1, 3] })
  const figs = michaelisFigure(mm)
  assert.ok(figs.saturation.data.length === 2 && figs.lineweaver.data.length === 2)
  const white = onWhite(figs.saturation)
  assert.equal(white.layout.paper_bgcolor, '#ffffff')
  assert.equal(PRINT_PALETTE.surface, '#ffffff')
})
