// kReaction against the real RDKit (MinimalLib, WebAssembly) in Node: every SMILES of the compound table, the
// library and its mechanisms is read, RDKit's formula agrees with the built-in SMILES reader, every reaction
// template runs on its example, and the depiction is themed. Skipped when RDKit cannot be loaded.  Run:
//   node --test tools/tests/kreaction-rdkit.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { MainModule } from '@rdkit/rdkit'
import { COMPOUNDS } from '../../src/apps/kreaction/compounds.ts'
import { LIBRARY } from '../../src/apps/kreaction/library.ts'
import { TEMPLATES } from '../../src/apps/kreaction/templates.ts'
import { readSmiles } from '../../src/apps/kreaction/smiles.ts'
import { analyseReaction } from '../../src/apps/kreaction/reaction.ts'
import {
  assignments, canonicalSmiles, compositionFromJson, depict, descriptors, isValidSmiles, molComposition, predictAll, reactantCount, runTemplate, symbolOf,
} from '../../src/apps/kreaction/rdengine.ts'
import { themeSvg, staticSvg } from '../../src/apps/kreaction/svgtheme.ts'

let rd: MainModule | null = null
try {
  const require = createRequire(import.meta.url)
  const dir = fileURLToPath(new URL('../../node_modules/@rdkit/rdkit/dist/', import.meta.url))
  const init = require(`${dir}RDKit_minimal.js`) as (o: unknown) => Promise<MainModule>
  rd = await init({ locateFile: (f: string) => dir + f })
} catch {
  rd = null
}
const skip = rd === null ? 'RDKit could not be loaded in Node' : false

const same = (a: { atoms: Record<string, number>; charge: number }, b: { atoms: Record<string, number>; charge: number }) => {
  for (const k of new Set([...Object.keys(a.atoms), ...Object.keys(b.atoms)])) if ((a.atoms[k] ?? 0) !== (b.atoms[k] ?? 0)) return false
  return a.charge === b.charge
}

test('RDKit reads every SMILES and agrees with the built-in formula reader', { skip }, () => {
  const all = new Set<string>()
  for (const c of COMPOUNDS) all.add(c.smiles)
  for (const r of LIBRARY) {
    r.reactants.concat(r.products, r.extras ?? []).forEach((s) => all.add(s))
    r.mechanism?.forEach((st) => st.species.forEach((s) => all.add(s)))
  }
  for (const t of TEMPLATES) t.example.reactants.concat(t.example.expect).forEach((s) => all.add(s))
  assert.ok(all.size > 200, `${all.size} structures`)
  for (const s of all) {
    assert.ok(isValidSmiles(rd!, s), `RDKit rejects ${s}`)
    const mine = readSmiles(s)
    const theirs = molComposition(rd!, s)!
    assert.ok(same(mine, theirs), `${s}: built-in ${JSON.stringify(mine.atoms)} ${mine.charge} vs RDKit ${JSON.stringify(theirs.atoms)} ${theirs.charge}`)
  }
  assert.ok(!isValidSmiles(rd!, 'C(C'))
  assert.ok(!isValidSmiles(rd!, 'C1CC'))
  assert.equal(canonicalSmiles(rd!, 'OCC'), 'CCO')
  assert.equal(canonicalSmiles(rd!, 'nonsense'), null)
  assert.deepEqual([symbolOf(1), symbolOf(8), symbolOf(17), symbolOf(26)], ['H', 'O', 'Cl', 'Fe'])
})

test('the hooks plug RDKit into the species resolver', { skip }, () => {
  const hooks = { valid: (s: string) => isValidSmiles(rd!, s), composition: (s: string) => molComposition(rd!, s) }
  const a = analyseReaction({ reactants: ['CCO', 'O=O'], products: ['O=C=O', 'O'], arrow: 'forward', above: '', below: '' }, hooks)
  assert.ok(a.ready)
  assert.deepEqual(a.balance?.coefficients, [1, 3, 2, 3])
  const bad = analyseReaction({ reactants: ['C(C'], products: ['C'], arrow: 'forward', above: '', below: '' }, hooks)
  assert.equal(bad.ready, false)
  assert.match(bad.errors[0], /not a known name/)
})

test('JSON composition', { skip }, () => {
  const m = rd!.get_mol('[NH4+]')!
  assert.deepEqual(compositionFromJson(m.get_json()), { atoms: { N: 1, H: 4 }, charge: 1 })
  m.delete()
})

test('every template gives its expected product from its example', { skip }, () => {
  for (const t of TEMPLATES) {
    const outcomes = runTemplate(rd!, t, t.example.reactants)
    const want = canonicalSmiles(rd!, t.example.expect)!
    assert.ok(outcomes.length > 0, `${t.id}: no outcome`)
    assert.ok(outcomes.some((o) => o.products.includes(want)), `${t.id}: wanted ${want}, got ${outcomes.map((o) => o.products.join('.')).join(' | ')}`)
    for (const o of outcomes) for (const p of o.products) assert.ok(isValidSmiles(rd!, p), `${t.id}: ${p}`)
  }
})

test('predictAll: esterification of acetic acid and ethanol, regiochemistry and several outcomes', { skip }, () => {
  const ester = predictAll(rd!, TEMPLATES, ['CC(=O)O', 'CCO'])
  assert.ok(ester.some((p) => p.template.id === 'esterification' && p.products.includes('CCOC(C)=O')))
  assert.ok(ester.some((p) => p.template.id === 'deprotonation'))
  // Markovnikov: propene + HBr gives 2-bromopropane only
  const hbr = predictAll(rd!, TEMPLATES.filter((t) => t.id === 'hydrohalogenation'), ['C=CC', 'Br'])
  assert.deepEqual(hbr.map((p) => p.products.join('.')), ['CC(C)Br'])
  // toluene nitration: ortho, meta and para
  const nitro = predictAll(rd!, TEMPLATES.filter((t) => t.id === 'nitration'), ['Cc1ccccc1'])
  assert.equal(nitro.length, 3)
  // 2-bromobutane: two alkenes by E2
  const e2 = predictAll(rd!, TEMPLATES.filter((t) => t.id === 'e2'), ['CCC(C)Br'])
  assert.ok(e2.length >= 2)
  // one reactant for a two-reactant template: the molecule reacts with itself
  const aldol = predictAll(rd!, TEMPLATES.filter((t) => t.id === 'aldol'), ['CC=O'])
  assert.ok(aldol.some((p) => p.products.includes('CC(O)CC=O')))
  // nothing to do: a clear empty result
  assert.deepEqual(predictAll(rd!, TEMPLATES, ['O=C=O']).filter((p) => p.template.id === 'esterification'), [])
  assert.deepEqual(predictAll(rd!, TEMPLATES, ['not a smiles']), [])
  assert.equal(reactantCount(TEMPLATES[0].smarts[0]), 2)
  assert.deepEqual(assignments(2, 2), [[0, 1], [1, 0]])
  assert.deepEqual(assignments(1, 2), [[0, 0]])
  assert.deepEqual(assignments(0, 2), [])
})

test('depictions are SVG, themed for the screen and plain for files', { skip }, () => {
  const svg = depict(rd!, 'NC(Cl)c1ccc(Br)cc1[N+](=O)[O-]', { width: 240, height: 180 })!
  assert.match(svg, /<svg/)
  const themed = themeSvg(svg)
  assert.ok(themed.includes('currentColor'))
  assert.ok(themed.includes('var(--k-link)'), 'nitrogen is drawn in the link colour')
  assert.ok(themed.includes('var(--k-danger)'), 'oxygen is drawn in the danger colour')
  assert.ok(!/#000000/i.test(themed))
  assert.match(staticSvg(svg), /<rect width='240' height='180'/)
  assert.equal(depict(rd!, 'C(C'), null)
  const d = descriptors(rd!, 'CC(=O)Oc1ccccc1C(=O)O')!
  assert.ok(Math.abs(d.amw! - 180.16) < 0.01)
  assert.ok(d.logp! > 0.5 && d.logp! < 2)
  assert.equal(d.hbd, 1)
  assert.match(d.inchi ?? '', /^InChI=1S\/C9H8O4/)
  assert.equal(d.inchikey, 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N')
})
