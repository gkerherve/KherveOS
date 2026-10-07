// Node tests for KherveMol's TypeScript ports of the desktop logic (no browser).
// Run: node --test tools/tests/khervemol.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bondLength, color, name, textColor, valence, TABLE } from '../../src/apps/khervemol/elements.ts'
import { angle, canBond, canReattach, canSetBondOrder, constrainAtom, distance, dragAtom, formula, freeValence, fragment, proj } from '../../src/apps/khervemol/model.ts'
import { coordinationFaces, coordinationPolyhedra, hasPolyhedra, legendEntries, SITE_COLORS } from '../../src/apps/khervemol/molcolor.ts'
import { darker, dotPositions, hillFormula, implicitHydrogens, lighter, lonePairs, mix, subscript } from '../../src/apps/khervemol/molrepr.ts'
import { buildTree, continuations, rootAtom, walk } from '../../src/apps/khervemol/structure.ts'
import { Scene, ballRadius, extentOf, viewBasis } from '../../src/apps/khervemol/scene.ts'
import { bondsAt, dragGroup, groupOf, position, pose, stage, type FilmData } from '../../src/apps/khervemol/film.ts'
import { extractSmiles, insertSpecies, sectionKey } from '../../src/apps/khervemol/catalog.ts'
import { atomSpecs, bondSpecs, fitParams, modelSpecs } from '../../src/apps/khervemol/specs.ts'
import { emptyMol, type Atom, type Bond, type Mol } from '../../src/apps/khervemol/types.ts'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

/** Ethanol C-C-O with its six H, roughly tetrahedral. */
function ethanol(): { atoms: Atom[]; bonds: Bond[] } {
  const atoms: Atom[] = [
    ['C', 0, 0, 0], ['C', 1.52, 0, 0], ['O', 2.0, 1.35, 0],
    ['H', -0.36, 1.03, 0], ['H', -0.36, -0.5, 0.9], ['H', -0.36, -0.5, -0.9],
    ['H', 1.88, -0.5, 0.9], ['H', 1.88, -0.5, -0.9], ['H', 2.96, 1.35, 0],
  ]
  const bonds: Bond[] = [[0, 1, 1], [1, 2, 1], [0, 3, 1], [0, 4, 1], [0, 5, 1], [1, 6, 1], [1, 7, 1], [2, 8, 1]]
  return { atoms, bonds }
}

function mol(atoms: Atom[], bonds: Bond[], extra: Partial<Mol> = {}): Mol {
  return { ...emptyMol(), name: 'custom', label: 'test', atoms, bonds, formula: formula(atoms), ...extra }
}

test('element data matches the desktop (elements.py)', () => {
  assert.equal(name('C'), 'Carbon')
  assert.equal(valence('C'), 4)
  assert.equal(valence('O'), 2)
  close(bondLength('C', 'O', 1), 1.43)
  close(bondLength('O', 'C', 2), 1.23)
  close(bondLength('C', 'N', 3), 1.16)
  assert.equal(textColor('N'), '#fff') // a saturated blue reads dark
  assert.equal(TABLE.length, 118)
  assert.match(color('O'), /^#[0-9a-f]{6}$/i)
})

test('the isometric projection is model._proj', () => {
  const [sx, sy, d] = proj(1, 0, 0, 0, 0)
  close(sx, 1)
  close(sy, 0)
  close(d, 0)
  // z points up the screen (screen y grows down) at elevation 0
  close(proj(0, 0, 1, 0, 0)[1], -1)
  // the camera basis agrees with the projection
  const [r, u, f] = viewBasis(0.3, 0.2)
  const p: [number, number, number] = [0.7, -1.1, 0.4]
  const [px, py, pd] = proj(...p, 0.3, 0.2)
  close(px, r[0] * p[0] + r[1] * p[1] + r[2] * p[2])
  close(-py, u[0] * p[0] + u[1] * p[1] + u[2] * p[2])
  close(pd, f[0] * p[0] + f[1] * p[1] + f[2] * p[2])
})

test('valence checks gate bonds and orders', () => {
  const { atoms, bonds } = ethanol()
  assert.equal(freeValence(atoms, bonds, 0), 0)
  assert.equal(canBond(atoms, bonds, 0, 2), false) // C is full
  const a: Atom[] = [['C', 0, 0, 0], ['O', 1.4, 0, 0]]
  const b: Bond[] = [[0, 1, 1]]
  assert.equal(canSetBondOrder(a, b, 0, 2), true)
  assert.equal(canSetBondOrder(a, b, 0, 3), false) // O has valence 2
  assert.deepEqual([...fragment(bonds, 2, 1)].sort(), [2, 8])
})

test('re-attaching refuses a fragment onto itself', () => {
  const { atoms, bonds } = ethanol()
  // O (2) hangs off C1 through bond 1; its own H (8) travels with it
  assert.equal(canReattach(atoms, bonds, 2, 1, 8), false)
  // C0 is full, so O cannot go there either
  assert.equal(canReattach(atoms, bonds, 2, 1, 0), false)
})

test('a locked drag keeps the bond length (constrain_atom)', () => {
  const atoms: Atom[] = [['C', 0, 0, 0], ['O', 1.43, 0, 0]]
  const bonds: Bond[] = [[0, 1, 1]]
  dragAtom(atoms, 1, 30, -20, 0.4, 0.3, 1.6, 40, bonds)
  close(distance(atoms, 0, 1), 1.43, 1e-5)
  const free: Atom[] = [['C', 0, 0, 0], ['O', 1.43, 0, 0]]
  dragAtom(free, 1, 40, 0, 0, 0, 1, 40, null)
  close(free[1][1], 1.43 + 1) // 40 px at 40 px/Å
  const tri: Atom[] = [['C', 0, 0, 0], ['C', 2, 0, 0], ['O', 1, 3, 0]]
  constrainAtom(tri, [[0, 2, 1], [1, 2, 1]], 2)
  close(distance(tri, 0, 2), 1.43, 1e-4)
  close(distance(tri, 1, 2), 1.43, 1e-4)
})

test('angles and the Hill formula', () => {
  const { atoms } = ethanol()
  assert.equal(formula(atoms), 'C2H6O')
  close(angle([['H', 1, 0, 0], ['O', 0, 0, 0], ['H', 0, 1, 0]], 0, 1, 2), 90)
})

test('implicit hydrogens and the skeletal formula (molrepr)', () => {
  const sk: [string, number, number][] = [['C', 0, 0], ['C', 46, 0], ['O', 69, 40]]
  const b: Bond[] = [[0, 1, 1], [1, 2, 1]]
  assert.deepEqual(implicitHydrogens(sk, b), [3, 2, 1])
  assert.equal(hillFormula(sk, b), 'C₂H₆O')
  assert.equal(hillFormula(sk, b, true, false), 'C2H6O')
  assert.equal(subscript(1), '')
  assert.equal(subscript(12), '₁₂')
  assert.equal(lonePairs('O', 2, 0), 2)
  assert.equal(lonePairs('Fe', 2, 0), 0)
  // two pairs on the hydroxyl O, four dots, none on the bond direction
  const dots = dotPositions(2, sk, b, 14, 2.6)
  // the desktop's molrepr.dot_positions for the same atom
  const want = [[78.25166604983954, 50.82435565298214], [73.74833395016046, 53.424355652982136], [64.25166604983954, 53.42435565298214], [59.74833395016046, 50.82435565298215]]
  dots.forEach((d, i) => {
    close(d[0], want[i][0], 1e-9)
    close(d[1], want[i][1], 1e-9)
  })
})

test('colour helpers follow Qt (QColor lighter / darker)', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(darker('#808080', 200), '#404040')
  assert.equal(lighter('#404040', 200), '#808080')
  assert.equal(lighter('#ffffff', 150), '#ffffff')
})

test('the structure outline walks as the desktop does (structure_tree.walk)', () => {
  const { atoms, bonds } = ethanol()
  // desktop output for this ethanol: rooted at the O end, the chain C1, C0 below it
  const rows = walk(atoms, bonds)
  assert.deepEqual(
    rows.map((r) => [r.atom, r.parent, r.grand, r.order, r.ring]),
    [[2, null, null, 0, false], [1, 2, null, 1, false], [0, 1, 2, 1, false], [3, 0, 1, 1, false], [4, 0, 1, 1, false], [5, 0, 1, 1, false], [6, 1, 2, 1, false], [7, 1, 2, 1, false], [8, 2, null, 1, false]],
  )
  assert.deepEqual([...continuations(atoms, rows)].sort(), [[1, 0], [2, 1]])
  assert.equal(rootAtom(atoms, bonds), 2)
  // the backbone stays at one indent: O, C1, C0 are siblings under the root
  const { roots } = buildTree(atoms, bonds)
  assert.deepEqual(roots.map((n) => n.atom), [2, 1, 0])
  // caffeine: the desktop's order (ring closures included) and chain picks
  const caf = JSON.parse(readFileSync(new URL('./fixtures/khervemol/caffeine.json', import.meta.url), 'utf8')) as { atoms: Atom[]; bonds: Bond[] }
  const crow = walk(caf.atoms, caf.bonds)
  assert.deepEqual(crow.map((r) => r.atom), [0, 1, 2, 3, 4, 5, 12, 10, 11, 8, 6, 5, 7, 9, 18, 19, 20, 13, 21, 22, 23, 17, 5, 14, 15, 16])
  assert.deepEqual([...continuations(caf.atoms, crow)].sort((a, b) => a[0] - b[0]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 12], [6, 7], [8, 9], [10, 8], [12, 10]])
})

test('a ring closure comes out once, as a leaf', () => {
  const atoms: Atom[] = [['C', 0, 0, 0], ['C', 1, 0, 0], ['C', 1, 1, 0], ['C', 0, 1, 0]]
  const bonds: Bond[] = [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 0, 1]]
  const rows = walk(atoms, bonds)
  assert.equal(rows.filter((r) => r.ring).length, 1)
  assert.equal(rows.filter((r) => !r.ring).length, 4)
})

test('coordination polyhedra: an octahedron has 8 faces, a cube 6', () => {
  const oct: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  assert.equal(coordinationFaces(oct).length, 8)
  const cube: [number, number, number][] = []
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z])
  const faces = coordinationFaces(cube)
  assert.equal(faces.length, 6)
  assert.ok(faces.every((f) => f.length === 4))
  const atoms: Atom[] = [['Ti', 0, 0, 0], ...oct.map((p) => ['O', ...p] as Atom)]
  const bonds: Bond[] = oct.map((_p, i) => [0, i + 1, 1])
  assert.equal(hasPolyhedra(bonds), true)
  assert.equal(coordinationPolyhedra(atoms, bonds).length, 8)
})

test('the legend lists each colour once, naming lattice sites', () => {
  const atoms: Atom[] = [['Fe', 0, 0, 0], ['Fe', 1, 0, 0], ['Fe', 0.5, 0.5, 0.5, SITE_COLORS.body]]
  const rows = legendEntries(atoms, {})
  assert.equal(rows.length, 2)
  assert.equal(rows[1].label, 'Fe — Iron (body centre)')
  assert.equal(legendEntries(atoms, { Fe: '#123456' })[0].color, '#123456')
})

test('the GL scene: radii per style, fit and picking', () => {
  const { atoms, bonds } = ethanol()
  const m = mol(atoms, bonds, { bond: 1 })
  assert.equal(ballRadius('C', 'sticks'), 0.16)
  close(ballRadius('C', 'space_filling'), 1.7)
  const sc = new Scene(m, 'ball_and_stick')
  const [c, r] = extentOf(sc.pos, sc.radii)
  assert.deepEqual(c, sc.center)
  close(r, sc.bound)
  const ppa = sc.fitPpa(400, 300)
  close(ppa, (0.5 * 300 * 0.92) / Math.max(sc.bound, 1.5))
  const pts = sc.screen(m.az, m.el, ppa, 400, 300)
  assert.equal(sc.pickAtom(pts[2][0], pts[2][1], m.az, m.el, ppa, 400, 300), 2)
  assert.equal(sc.pickAtom(-50, -50, m.az, m.el, ppa, 400, 300), null)
  // vertex arrays: 6 vertices × 9 floats per atom; sticks two-coloured
  assert.equal(sc.sphereData().length, atoms.length * 54)
  assert.ok(sc.cylinderData().length > 0)
  // spreading moves the atoms apart from the centroid
  const wide = new Scene(mol(atoms, bonds, { bond: 2 }), 'ball_and_stick')
  close(Math.hypot(...[0, 1, 2].map((k) => wide.pos[1][k] - wide.pos[0][k])), 2 * 1.52, 1e-9)
  // space filling ignores the spread
  close(new Scene(mol(atoms, bonds, { bond: 2 }), 'space_filling').factor, 1)
})

test('the reaction film: bonds break, then form', () => {
  const f: FilmData = {
    title: 't', elements: ['H', 'H'], reac_spread: [[0, 0, 0], [1, 0, 0]], reac_packed: [[0.2, 0, 0], [0.8, 0, 0]],
    prod_spread: [[5, 0, 0], [7, 0, 0]], prod_packed: [[4, 0, 0], [6, 0, 0]], prod_mols: [0, 1], pi: [0, 1],
    rbonds: [[0, 1, 1]], pbonds: [], top: 3, bottom: -3, left: -5, right: 5, phases: [0.25, 0.75], break: 0.42, form: 0.58, arc: 1.3, duration: 7,
  }
  assert.deepEqual(position(f, 0, 0), [0, 0, 0])
  assert.deepEqual(position(f, 0, 1), [5, 0, 0])
  assert.equal(bondsAt(f, 0.1).length, 1)
  assert.equal(bondsAt(f, 0.5).length, 0)
  assert.equal(stage(f, 0.9), 'Products separate')
})

test('molecules on a surface: pose and drag', () => {
  const atoms: Atom[] = [['Cu', 0, 0, 0], ['Cu', 2, 0, 0], ['C', 1, 0, 3], ['O', 1, 0, 4.1]]
  const groups = [{ name: 'CO', start: 2, count: 2 }]
  assert.equal(groupOf(groups, 3), 0)
  assert.equal(groupOf(groups, 1), null)
  close(pose(atoms, groups, 0).height, 3)
  dragGroup(atoms, groups[0], 0, -10, 0, 0, 1, 10, true)
  close(pose(atoms, groups, 0).height, 4)
})

test('reaction text helpers (builders_ui.insert_species, ai extract_smiles)', () => {
  assert.equal(insertSpecies('A -> B', '@M', 0), 'A + @M -> B')
  assert.equal(insertSpecies('A -> B', '@M', 1), 'A -> B + @M')
  assert.equal(insertSpecies('', '@M', 0), '@M -> ')
  assert.equal(extractSmiles('Here it is.\nSMILES: CCO.'), 'CCO')
  assert.equal(extractSmiles('```smiles\nc1ccccc1\n```'), 'c1ccccc1')
  assert.equal(extractSmiles('no molecule'), null)
  assert.equal(sectionKey('Molecules — 696'), 'Molecules')
})

test('classic shape specs (model._model)', () => {
  const { atoms, bonds } = ethanol()
  const specs = modelSpecs(atoms, bonds, 400, 400, { tagAtoms: true, rscale: 0.92 })
  assert.equal(specs.filter((s) => s._atom !== undefined).length, atoms.length)
  assert.equal(specs.filter((s) => s._bond !== undefined).length, bonds.length)
  // spheres are drawn back to front, after the sticks
  const firstAtom = specs.findIndex((s) => s.shape === 'circle')
  assert.ok(specs.slice(firstAtom).every((s) => s.shape === 'circle'))
  assert.equal(bondSpecs([0, 0], [10, 0], 2).length, 2)
  assert.equal(atomSpecs(0, 0, 10, 'C', true).length, 2)
  const fp = fitParams(atoms, 400, 400, 0.4, 0.3, 1.6)
  assert.ok(fp.scale > 0)
})

test('scenes and specs match the desktop (glview.Scene, model._model)', () => {
  const ref = JSON.parse(readFileSync(new URL('./fixtures/khervemol/desktop_scenes.json', import.meta.url), 'utf8'))
  const asMol = (d: Record<string, unknown>): Mol => ({ ...emptyMol(), ...(d as Partial<Mol>), formula: formula(d.atoms as Atom[]) })
  const x = ref.srtio3
  const sc = new Scene(asMol(x.mol), 'ball_and_stick')
  sc.center.forEach((v, k) => close(v, x.center[k], 1e-9))
  close(sc.bound, x.bound, 1e-9)
  assert.equal(sc.cylinderData().length / 13, x.cyl)
  assert.equal(sc.polyData().length / 9, x.poly)
  assert.equal(sc.faces().length, x.faces)
  x.colors.forEach((c: number[], i: number) => c.forEach((v, k) => close(sc.colors[i][k], v, 1e-9)))
  const c = ref.caffeine
  const st = new Scene(asMol(c.mol), 'sticks')
  st.center.forEach((v, k) => close(v, c.sticks.center[k], 1e-9))
  close(st.bound, c.sticks.bound, 1e-9)
  assert.equal(st.cylinderData().length / 13, c.sticks.cyl)
  const m = asMol(c.mol)
  const specs = modelSpecs(m.atoms, m.bonds, 400, 400, { rscale: m.rscale, az: m.az, el: m.el, bondScale: m.bond, tagAtoms: true })
  assert.equal(specs.length, c.n)
  for (const [mine, theirs] of [[specs[0], c.first], [specs[specs.length - 1], c.last], [specs.find((s) => s.shape === 'circle'), c.circle0]]) {
    for (const k of Object.keys(theirs)) {
      const a = (mine as Record<string, unknown>)[k], b = theirs[k]
      if (typeof b === 'number') close(a as number, b, 1e-6)
      else assert.deepEqual(a, b, k)
    }
  }
})
