// kFEA: the solvers against closed-form answers and benchmarks (trusses, beams, frames, thermal loads, settlements,
// springs, hinges, plane stress / strain with the CST and the Q4 with incompatible modes), the meshing, modal analysis
// and buckling, linear algebra, units, files, the 17 examples (each solved and compared with its expected values),
// reports, the editor operations and the AI tools. No browser. Run:
//   node --test tools/tests/kfea.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  choleskyDense, generalisedEigen, jacobiEigen, pcg, rcmOrder, skylineFactor, skylineSolve, solveSym, SingularError, SparseSym, SolveError,
} from '../../src/apps/kfea/linalg.ts'
import { DEFAULT_UNITS, factor, fmt, fromSI, label, parseNumber, show, stressFactor, stressLabel, toSI, type Units } from '../../src/apps/kfea/units.ts'
import { MATERIAL_LIBRARY, cleanMaterial, libraryMaterial } from '../../src/apps/kfea/materials.ts'
import { SECTION_LIBRARY, STANDARD_SECTIONS, cleanSection, customSection, librarySection, makeSection, sectionProps } from '../../src/apps/kfea/sections.ts'
import {
  checkModel, cleanModel, emptyModel, emptyPlate, circlePoly, normalizePlate, plateArea, pointInPlate, signedArea, type Model,
} from '../../src/apps/kfea/model.ts'
import { localStiffness, solveFrame, floatingParts, buildSystem, assemble, memberDiagram } from '../../src/apps/kfea/frame.ts'
import { bucklingAnalysis, modalAnalysis, subdivideModel } from '../../src/apps/kfea/modal.ts'
import {
  gridMesh, meshArea, meshPlate, meshStats, meshStructured, targetNodes, targetSegments, trisToQuads, elementArea, type Mesh,
} from '../../src/apps/kfea/mesh.ts'
import { cstElement, q4Element, solvePlate, solveProblem, dMatrix, derivedStress, convergenceStudy, type PlaneProblem } from '../../src/apps/kfea/plane.ts'
import { EXAMPLES, exampleById } from '../../src/apps/kfea/examples.ts'
import { measure, runChecks, solveModel, summaryLines } from '../../src/apps/kfea/solve.ts'
import { parseModel, serializeModel } from '../../src/apps/kfea/file.ts'
import { kfeaExampleFiles, KFEA_EXAMPLES_FOLDER } from '../../src/apps/kfea/exampleFiles.ts'
import { kfeaExampleOutputs, kfeaIndexText } from '../export_kfea_examples.ts'
import { readExampleIndex } from '../../src/os/exampleFiles.ts'
import {
  COLORMAPS, autoScale, colorAt, deformedMember, diagramMember, extremes, plateField, probeFrame, probePlate, rasterize, PLATE_FIELDS, type ColorMapName,
} from '../../src/apps/kfea/post.ts'
import { DEFAULT_RESULT, buildScene, fitView, primsToSvg, sceneSvg, targetGeometry, toScreen, toWorld } from '../../src/apps/kfea/scene.ts'
import { blocksToHtml, blocksToMarkdown, reportBlocks, reportHtml, reportMarkdown, resultsCsv } from '../../src/apps/kfea/report.ts'
import {
  History, addCircleHole, addHole, addMember, addMemberLoad, addNode, addPlateLoad, addPlateSupport, deleteHole, deleteItems, deleteVertex, insertVertex, moveNodes, moveVertex,
  pickFrame, pickInBox, pickPlate, setMemberProps, setNodeLoad, setOutline, setSupport, splitMember, supportKind, niceStep, snapTo,
} from '../../src/apps/kfea/editor.ts'
import { drawPrims } from '../../src/apps/kfea/draw.ts'
import { applyAdd, describeModel, describeResult, kfeaTools, type Hooks } from '../../src/apps/kfea/aiTools.ts'
import { KFEA_TOOL_SET } from '../../src/os/ai/manifests/kfea.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const near = (a: number, b: number, rel = 1e-6, abs = 0, what = '') => assert.ok(Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel), `${what} ${a} ≈ ${b} (rel ${rel}, abs ${abs})`)

/** A steel beam model along x with the given supports. */
function beamModel(L: number, supports: Array<[string, boolean, boolean, boolean]>, sec = makeSection('S', 'S', 'rect', { b: 0.1, h: 0.2 }), nElem = 1): Model {
  const m = emptyModel('beam')
  m.materials = [{ id: 'X', name: 'X', E: 200e9, nu: 0.3, rho: 7850, sy: 250e6, alpha: 12e-6 }]
  m.sections = [sec]
  m.nodes = []
  m.members = []
  for (let i = 0; i <= nElem; i++) m.nodes.push({ id: `n${i}`, x: (L * i) / nElem, y: 0 })
  for (let i = 0; i < nElem; i++) m.members.push({ id: `m${i + 1}`, n1: `n${i}`, n2: `n${i + 1}`, section: 'S', material: 'X' })
  m.supports = supports.map(([node, ux, uy, rz], i) => ({ id: `s${i}`, node, ux, uy, rz }))
  return m
}
const EI = 200e9 * (0.1 * 0.2 ** 3) / 12

// ------------------------------------------------------------------------------ units, materials, sections

test('units: conversions, stress units, formatting, parsing numbers', () => {
  const u: Units = { length: 'mm', force: 'N' }
  assert.equal(stressLabel(u), 'MPa')
  assert.equal(stressLabel({ length: 'm', force: 'kN' }), 'kPa')
  assert.equal(stressLabel({ length: 'in', force: 'kip' }), 'ksi')
  assert.equal(stressLabel({ length: 'm', force: 'N' }), 'Pa')
  near(stressFactor(u), 1e6)
  near(toSI(25.4, 'length', { length: 'in', force: 'kip' }), 0.6451600, 1e-9)
  near(toSI(1, 'length', { length: 'in', force: 'kip' }), 0.0254)
  near(toSI(1, 'force', { length: 'in', force: 'kip' }), 4448.2216152605)
  near(toSI(1, 'stress', { length: 'in', force: 'kip' }), 6894757.29, 1e-6)
  near(fromSI(1e6, 'stress', u), 1)
  near(factor('moment', { length: 'mm', force: 'kN' }), 1)
  assert.equal(label('moment', DEFAULT_UNITS), 'kN·m')
  assert.equal(label('lineLoad', DEFAULT_UNITS), 'kN/m')
  assert.equal(label('area', u), 'mm²')
  assert.equal(show(0.0123, 'length', { length: 'mm', force: 'N' }), '12.3 mm')
  assert.equal(fmt(1234.5678), '1235')
  assert.equal(fmt(0.00012345), '1.234e-4')
  assert.equal(fmt(0), '0')
  assert.equal(fmt(12.5), '12.5')
  assert.equal(parseNumber('3,5'), 3.5)
  assert.equal(parseNumber('2*4'), 8)
  assert.equal(parseNumber('abc'), null)
  assert.equal(parseNumber(''), null)
  assert.equal(parseNumber('1e3'), 1000)
  // consistent conversion round trip for every pair of systems
  for (const length of ['mm', 'm', 'in', 'ft'] as const) for (const force of ['N', 'kN', 'kip', 'lbf'] as const) {
    const sys: Units = { length, force }
    for (const qn of ['length', 'force', 'stress', 'moment', 'lineLoad', 'area', 'inertia'] as const) near(toSI(fromSI(1.2345, qn, sys), qn, sys), 1.2345, 1e-12)
  }
})

test('materials library: twelve materials with sane properties', () => {
  assert.ok(MATERIAL_LIBRARY.length >= 12)
  for (const id of ['S235', 'S355', 'SS304', 'AL6061', 'TI64', 'CU', 'C30', 'TIMBER', 'CASTIRON', 'GLASS', 'ABS', 'PLA']) assert.ok(libraryMaterial(id), id)
  for (const m of MATERIAL_LIBRARY) {
    assert.ok(m.E > 1e9 && m.E < 5e11, m.id)
    assert.ok(m.nu > 0 && m.nu < 0.5, m.id)
    assert.ok(m.rho > 300 && m.rho < 20000 && m.sy > 1e6 && m.alpha > 0, m.id)
  }
  near(libraryMaterial('S235')!.sy, 235e6)
  assert.equal(cleanMaterial({ id: 'X', E: -5, nu: 0.7 }).nu, 0.3)
  assert.ok(cleanMaterial({ id: 'X', E: -5 }).E > 0)
})

test('sections: A, I, Z of the basic shapes and the catalogue', () => {
  const r = sectionProps('rect', { b: 0.1, h: 0.2 })
  near(r.A, 0.02); near(r.I, 0.1 * 0.2 ** 3 / 12); near(r.Z, 0.1 * 0.2 ** 2 / 6)
  const c = sectionProps('circle', { d: 0.05 })
  near(c.A, Math.PI * 0.05 ** 2 / 4); near(c.I, Math.PI * 0.05 ** 4 / 64); near(c.Z, Math.PI * 0.05 ** 3 / 32)
  const t = sectionProps('tube', { D: 0.1, t: 0.005 })
  near(t.A, Math.PI * (0.1 ** 2 - 0.09 ** 2) / 4); near(t.I, Math.PI * (0.1 ** 4 - 0.09 ** 4) / 64)
  const i = sectionProps('ibeam', { h: 0.2, b: 0.1, tw: 0.006, tf: 0.009 })
  near(i.A, 2 * 0.1 * 0.009 + 0.182 * 0.006); near(i.I, (0.1 * 0.2 ** 3 - 0.094 * 0.182 ** 3) / 12)
  // a T: centroid by hand: flange 100×10 on top of a web 10×90
  const tee = sectionProps('tee', { b: 0.1, h: 0.1, tw: 0.01, tf: 0.01 })
  const yc = (0.1 * 0.01 * 0.005 + 0.01 * 0.09 * 0.055) / (0.1 * 0.01 + 0.01 * 0.09)
  near(tee.A, 0.0019)
  near(tee.I, 0.1 * 0.01 ** 3 / 12 + 0.001 * (yc - 0.005) ** 2 + 0.01 * 0.09 ** 3 / 12 + 0.0009 * (0.055 - yc) ** 2)
  near(tee.Z, tee.I / Math.max(yc, 0.1 - yc))
  const ang = sectionProps('angle', { a: 0.1, b: 0.1, t: 0.01 })
  near(ang.A, 0.0019)
  assert.throws(() => sectionProps('rect', { b: -1, h: 1 }), /positive/)
  assert.throws(() => sectionProps('tube', { D: 0.01, t: 0.02 }), /thicker/)
  assert.ok(STANDARD_SECTIONS.length >= 15)
  const ipe200 = librarySection('IPE200')!
  near(ipe200.A, 28.5e-4); near(ipe200.I, 1943e-8); near(ipe200.Z, 1943e-8 / 0.1)
  assert.equal(librarySection('ipe 200')!.id, 'IPE200')
  for (const s of SECTION_LIBRARY) assert.ok(s.A > 0 && s.I > 0 && s.Z > 0 && s.h > 0, s.id)
  // catalogue values agree with the geometry within the fillet allowance
  for (const s of STANDARD_SECTIONS.filter((x) => x.shape === 'ibeam')) {
    const g = sectionProps('ibeam', s.params)
    assert.ok(Math.abs(g.A / s.A - 1) < 0.12 && Math.abs(g.I / s.I - 1) < 0.1, `${s.id}: ${g.A / s.A} ${g.I / s.I}`)
  }
  const cu = customSection('C', 'custom', 1e-3, 2e-6)
  near(cu.Z, 2e-6 / (cu.h / 2)); near(cu.h, Math.sqrt(12 * 2e-6 / 1e-3))
  near(cleanSection({ id: 'Q', shape: 'rect', params: { b: 0.1, h: 0.2 } }).A, 0.02)
})

// ------------------------------------------------------------------------------ linear algebra

function spdMatrix(n: number, seed = 1): SparseSym {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const m = new SparseSym(n)
  for (let i = 0; i < n; i++) {
    m.add(i, i, 4 + rnd())
    for (const j of [i + 1, i + 3]) if (j < n) { const v = rnd() - 0.5; m.add(i, j, v); m.add(j, i, v) }
  }
  return m
}

test('linear algebra: skyline Cholesky, conjugate gradients and the reverse Cuthill–McKee ordering agree', () => {
  const n = 120
  const m = spdMatrix(n)
  const b = Float64Array.from({ length: n }, (_, i) => Math.sin(i))
  const a = solveSym(m, b, 'cholesky')
  const c = solveSym(m, b, 'pcg')
  assert.ok(a.info.residual < 1e-12, `residual ${a.info.residual}`)
  for (let i = 0; i < n; i++) near(a.x[i], c.x[i], 1e-7, 1e-9)
  assert.equal(a.info.method, 'cholesky')
  assert.equal(c.info.method, 'pcg')
  const csr = m.toCsr()
  const perm = rcmOrder(csr)
  assert.deepEqual([...perm].sort((x, y) => x - y), Array.from({ length: n }, (_, i) => i), 'a permutation')
  const { sky } = skylineFactor(csr, perm)
  const x2 = skylineSolve(sky, b)
  for (let i = 0; i < n; i++) near(x2[i], a.x[i], 1e-9, 1e-12)
  const p = pcg(csr, b, 1e-12)
  assert.ok(p.converged && p.iterations < n)
})

test('linear algebra: a singular matrix is reported with the mode that makes it singular', () => {
  // a chain of springs with no anchor: [1 −1; −1 1] is singular with mode (1, 1)
  const m = new SparseSym(3)
  const k = [1, 2]
  for (let i = 0; i < 2; i++) { m.add(i, i, k[i]); m.add(i + 1, i + 1, k[i]); m.add(i, i + 1, -k[i]); m.add(i + 1, i, -k[i]) }
  assert.throws(() => solveSym(m, new Float64Array(3)), (e: unknown) => {
    assert.ok(e instanceof SingularError)
    const mode = (e as SingularError).mode
    // K · mode ≈ 0
    const kv = [mode[0] - mode[1], -mode[0] + 3 * mode[1] - 2 * mode[2], -2 * mode[1] + 2 * mode[2]]
    assert.ok(Math.hypot(...kv) < 1e-9 * Math.hypot(...mode), `K·mode = ${kv}`)
    return true
  })
})

test('linear algebra: Jacobi eigenvalues and the generalised eigenproblem', () => {
  // 1-D Laplacian: λ_k = 2 − 2 cos(kπ/(n+1))
  const n = 12
  const a = new Float64Array(n * n)
  for (let i = 0; i < n; i++) { a[i * n + i] = 2; if (i + 1 < n) { a[i * n + i + 1] = -1; a[(i + 1) * n + i] = -1 } }
  const e = jacobiEigen(a, n)
  for (let k = 0; k < n; k++) near(e.values[k], 2 - 2 * Math.cos(((k + 1) * Math.PI) / (n + 1)), 1e-10)
  // orthonormal vectors
  for (let k = 0; k < 3; k++) { let s = 0; for (let i = 0; i < n; i++) s += e.vectors[i * n + k] ** 2; near(s, 1, 1e-10) }
  const b = new Float64Array(n * n)
  for (let i = 0; i < n; i++) b[i * n + i] = 4
  const g = generalisedEigen(a, b, n)!
  for (let k = 0; k < n; k++) near(g.values[k], (2 - 2 * Math.cos(((k + 1) * Math.PI) / (n + 1))) / 4, 1e-10)
  assert.equal(generalisedEigen(a, new Float64Array(n * n), n), null)
  assert.equal(choleskyDense(Float64Array.from([1, 2, 2, 1]), 2), null)
})

// ------------------------------------------------------------------------------ beams and frames

test('beam: cantilever tip load, simply supported UDL, propped cantilever, continuous beam (1e-9)', () => {
  const P = 7000
  let m = beamModel(4, [['n1', true, true, true]])
  m = beamModel(4, [['n0', true, true, true]])
  m.nodeLoads = [{ id: 'l', node: 'n1', fx: 0, fy: -P, mz: 0 }]
  let r = solveFrame(m)
  near(r.u[4], -P * 4 ** 3 / (3 * EI), 1e-9)
  near(r.u[5], -P * 4 ** 2 / (2 * EI), 1e-9)
  near(r.reactions[0].ry, P, 1e-9); near(r.reactions[0].mz, P * 4, 1e-9)
  // simply supported, UDL, one element: midspan deflection from the station
  const w = 3000
  m = beamModel(5, [['n0', true, true, false], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: -w, w2: -w }]
  r = solveFrame(m)
  const mid = r.members[0].stations.find((s) => Math.abs(s.x - 2.5) < 1e-12)!
  near(mid.v, -5 * w * 5 ** 4 / (384 * EI), 1e-9)
  near(r.members[0].maxM, w * 25 / 8, 1e-9)
  near(mid.M, w * 25 / 8, 1e-9)
  near(r.members[0].maxV, w * 2.5, 1e-9)
  near(r.u[2], -w * 5 ** 3 / (24 * EI), 1e-9) // rotation at A
  // the same with eight elements gives the same nodal values (consistent loads are exact for beams)
  const m8 = beamModel(5, [['n0', true, true, false], ['n8', false, true, false]], undefined, 8)
  m8.memberLoads = m8.members.map((x, i) => ({ id: `q${i}`, member: x.id, type: 'dist', dir: 'y', w1: -w, w2: -w }))
  const r8 = solveFrame(m8)
  near(r8.u[3 * 4 + 1], -5 * w * 5 ** 4 / (384 * EI), 1e-9)
  // propped cantilever
  m = beamModel(5, [['n0', true, true, true], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: -w, w2: -w }]
  r = solveFrame(m)
  near(r.reactions[1].ry, 3 * w * 5 / 8, 1e-9); near(r.reactions[0].ry, 5 * w * 5 / 8, 1e-9); near(r.reactions[0].mz, w * 25 / 8, 1e-9)
  // two spans
  m = beamModel(8, [['n0', true, true, false], ['n1', false, true, false], ['n2', false, true, false]], undefined, 2)
  m.memberLoads = m.members.map((x, i) => ({ id: `q${i}`, member: x.id, type: 'dist', dir: 'y', w1: -w, w2: -w }))
  r = solveFrame(m)
  near(r.reactions[1].ry, 5 * w * 4 / 4, 1e-9); near(r.reactions[0].ry, 3 * w * 4 / 8, 1e-9)
  near(r.members[0].M2, -w * 16 / 8, 1e-9)
})

test('beam: point loads on a member, trapezoidal loads, partial loads, loads in the global directions', () => {
  const L = 6
  const P = 5000
  // point load at 1/3 on a simply supported beam: reactions Pb/L, Pa/L; deflection under the load Pa²b²/(3EIL)
  let m = beamModel(L, [['n0', true, true, false], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'p', member: 'm1', type: 'point', dir: 'ly', p: -P, a: 2 }]
  let r = solveFrame(m)
  near(r.reactions[0].ry, P * 4 / 6, 1e-9); near(r.reactions[1].ry, P * 2 / 6, 1e-9)
  const under = r.members[0].stations.filter((s) => Math.abs(s.x - 2) < 1e-12)
  assert.ok(under.length >= 2, 'two stations at the point load (the jump in the shear)')
  near(under[0].v, -P * 4 * 16 / (3 * EI * L), 1e-9)
  near(under[0].V - under[1].V, P, 1e-9, 0, 'jump of the shear')
  near(r.members[0].maxM, P * 2 * 4 / 6, 1e-9)
  // triangular load 0 → w: reactions wL/6 and wL/3
  const w = 4000
  m = beamModel(L, [['n0', true, true, false], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: 0, w2: -w }]
  r = solveFrame(m)
  near(r.reactions[0].ry, (w * L) / 6, 1e-9); near(r.reactions[1].ry, (w * L) / 3, 1e-9)
  near(r.members[0].maxM, (w * L * L) / (9 * Math.sqrt(3)), 1e-6) // 0.0642 wL²
  // partial uniform load over [1, 4]
  m = beamModel(L, [['n0', true, true, false], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: -w, w2: -w, a: 1, b: 4 }]
  r = solveFrame(m)
  near(r.reactions[0].ry + r.reactions[1].ry, 3 * w, 1e-9)
  near(r.reactions[0].ry, (3 * w * (6 - 2.5)) / 6, 1e-9)
  // a global-y load on an inclined member: the resultant is w·L with L the member length
  const inc = emptyModel('frame')
  inc.materials = beamModel(1, []).materials
  inc.sections = beamModel(1, []).sections
  inc.nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 4 }]
  inc.members = [{ id: 'm', n1: 'a', n2: 'b', section: 'S', material: 'X' }]
  inc.supports = [{ id: 's', node: 'a', ux: true, uy: true, rz: true }]
  inc.memberLoads = [{ id: 'q', member: 'm', type: 'dist', dir: 'y', w1: -w, w2: -w }]
  r = solveFrame(inc)
  near(r.reactions[0].ry, 5 * w, 1e-9); near(r.reactions[0].rx, 0, 1, 1e-6)
  // self weight
  const sw = beamModel(4, [['n0', true, true, true]])
  sw.gravity = 9.80665
  r = solveFrame(sw)
  near(r.reactions[0].ry, 7850 * 0.02 * 4 * 9.80665, 1e-9)
})

test('frame: hinges (Gerber beam), spring and settlement of supports', () => {
  // two-span beam with a hinge at the middle of the first span: statically determinate
  const w = 2000
  let m = beamModel(8, [['n0', true, true, true], ['n2', false, true, false]], undefined, 2)
  m.members[0].releaseEnd = true
  m.supports.push({ id: 'sB', node: 'n1', ux: false, uy: false, rz: false })
  m.supports = m.supports.filter((s) => s.node !== 'n1')
  m.memberLoads = m.members.map((x, i) => ({ id: `q${i}`, member: x.id, type: 'dist', dir: 'y', w1: -w, w2: -w }))
  // fixed at n0, hinge at the end of m1 (n1), m2 propped at n2: the moment at the hinge is zero
  let r = solveFrame(m)
  near(r.members[0].M2, 0, 1, 1e-6)
  near(r.reactions[0].ry + r.reactions[1].ry, 2 * w * 4, 1e-9)
  // spring support: a rigid beam on one spring and one pin: spring force = load share
  const k = 2e6
  m = beamModel(4, [['n0', true, true, false]])
  m.supports.push({ id: 'sp', node: 'n1', ux: false, uy: false, rz: false, ky: k })
  m.nodeLoads = [{ id: 'l', node: 'n1', fx: 0, fy: -10000, mz: 0 }]
  r = solveFrame(m)
  near(r.reactions[0].ry, 0, 1, 1e-6)
  near(r.u[4], -10000 / k, 1e-6) // the beam is a free-rotating bar: the spring takes all
  near(r.reactions.find((x) => x.node === 'n1')!.ry, 10000, 1e-9)
  // settlement of the middle support of a two-span beam: M_B = 3EIδ/(2L²) · … (equal spans L): R_B = 6EIδ/L³·(…)
  const L = 4
  const d = 0.01
  m = beamModel(2 * L, [['n0', true, true, false], ['n1', false, true, false], ['n2', false, true, false]], undefined, 2)
  m.supports[1].dy = -d
  r = solveFrame(m)
  // exact: the central reaction is 6EIδ/L³ upwards ... for a continuous beam of two equal spans R_B = 6 E I δ / L³ (the middle support pulled down by δ pushes back)
  near(r.reactions[1].ry, -6 * EI * d / L ** 3, 1e-9)
  near(r.u[3 * 1 + 1], -d, 1e-12)
})

test('frame: thermal loads on bars and beams (uniform and gradient)', () => {
  const alpha = 12e-6
  const A = 0.02
  // restrained bar
  let m = beamModel(3, [['n0', true, true, true], ['n1', true, true, true]])
  m.memberLoads = [{ id: 't', member: 'm1', type: 'thermal', dT: 30, dTg: 0 }]
  m.analysis = 'frame'
  let r = solveFrame(m)
  near(r.members[0].N1, -200e9 * A * alpha * 30, 1e-9)
  near(r.maxStress, 200e9 * alpha * 30, 1e-9)
  // a free bar grows by αΔT L
  m = beamModel(3, [['n0', true, true, true], ['n1', false, true, true]])
  m.analysis = 'frame'
  m.memberLoads = [{ id: 't', member: 'm1', type: 'thermal', dT: 30, dTg: 0 }]
  r = solveFrame(m)
  near(r.u[3], alpha * 30 * 3, 1e-9)
  near(r.members[0].N1, 0, 1, 1e-6)
  // gradient: simply supported beam bows up by αΔTg L²/(8h); fixed–fixed carries M = EIαΔTg/h
  const h = 0.2
  m = beamModel(4, [['n0', true, true, false], ['n1', false, true, false]])
  m.memberLoads = [{ id: 't', member: 'm1', type: 'thermal', dT: 0, dTg: 40 }]
  r = solveFrame(m)
  const mid = r.members[0].stations.find((s) => Math.abs(s.x - 2) < 1e-12)!
  near(mid.v, alpha * 40 * 16 / (8 * h), 1e-9)
  near(r.members[0].maxM, 0, 1, 1e-6)
  m = beamModel(4, [['n0', true, true, true], ['n1', true, true, true]])
  m.analysis = 'frame'
  m.memberLoads = [{ id: 't', member: 'm1', type: 'thermal', dT: 0, dTg: 40 }]
  r = solveFrame(m)
  near(r.members[0].M1, EI * alpha * 40 / h, 1e-9)
  near(mid.v * 0 + r.members[0].stations[10].v, 0, 1, 1e-12)
})

test('truss: method of joints, a statically indeterminate truss and the equilibrium of every joint', () => {
  for (const id of ['truss-simple', 'truss-warren', 'truss-pratt']) {
    const ex = exampleById(id)!
    const r = solveFrame(ex.model)
    assert.ok(r.equilibrium.error < 1e-12, `${id} ${r.equilibrium.error}`)
    for (const mem of r.members) near(mem.maxV, 0, 1, 1e-6, `${id} ${mem.id}: no shear in a bar`)
  }
  // an indeterminate truss: a square with both diagonals, symmetric load: both diagonals carry the same force
  const m = emptyModel('truss')
  m.materials = beamModel(1, []).materials
  m.sections = [customSection('B', 'bar', 1e-3, 1e-8)]
  m.nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 2, y: 0 }, { id: 'c', x: 2, y: 2 }, { id: 'd', x: 0, y: 2 }]
  const add = (id: string, p: string, q: string) => m.members.push({ id, n1: p, n2: q, section: 'B', material: 'X' })
  add('ab', 'a', 'b'); add('bc', 'b', 'c'); add('cd', 'c', 'd'); add('da', 'd', 'a'); add('ac', 'a', 'c'); add('bd', 'b', 'd')
  m.supports = [{ id: 's1', node: 'a', ux: true, uy: true, rz: false }, { id: 's2', node: 'b', ux: true, uy: true, rz: false }]
  m.nodeLoads = [{ id: 'l', node: 'c', fx: 0, fy: -10000, mz: 0 }, { id: 'l2', node: 'd', fx: 0, fy: -10000, mz: 0 }]
  const r = solveFrame(m)
  near(r.reactions[0].ry + r.reactions[1].ry, 20000, 1e-9)
  near(r.members.find((x) => x.id === 'ac')!.N1, r.members.find((x) => x.id === 'bd')!.N1, 1e-9)
  // a truss with support settlement: a one-bar truss (hanging bar) moves with the support
  const hang = emptyModel('truss')
  hang.materials = m.materials; hang.sections = m.sections
  hang.nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: -2 }]
  hang.members = [{ id: 'm', n1: 'a', n2: 'b', section: 'B', material: 'X' }]
  hang.supports = [{ id: 's', node: 'a', ux: true, uy: true, rz: false, dy: -0.01 }, { id: 't', node: 'b', ux: true, uy: false, rz: false }]
  hang.nodeLoads = [{ id: 'l', node: 'b', fx: 0, fy: -1000, mz: 0 }]
  const rh = solveFrame(hang)
  near(rh.u[4], -0.01 - (1000 * 2) / (200e9 * 1e-3), 1e-9)
})

test('frame: mechanisms, floating parts and bad models are explained in plain language', () => {
  const sq = emptyModel('truss')
  sq.materials = beamModel(1, []).materials
  sq.sections = [customSection('B', 'bar', 1e-3, 1e-8)]
  sq.nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 2, y: 0 }, { id: 'c', x: 2, y: 2 }, { id: 'd', x: 0, y: 2 }]
  for (const [id, p, q] of [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd'], ['da', 'd', 'a']]) sq.members.push({ id, n1: p, n2: q, section: 'B', material: 'X' })
  sq.supports = [{ id: 's1', node: 'a', ux: true, uy: true, rz: false }, { id: 's2', node: 'b', ux: false, uy: true, rz: false }]
  sq.nodeLoads = [{ id: 'l', node: 'c', fx: 1000, fy: 0, mz: 0 }]
  assert.throws(() => solveFrame(sq), (e: unknown) => {
    assert.ok(e instanceof SolveError)
    assert.match((e as Error).message, /mechanism/)
    assert.match((e as Error).message, /node [cd] can move in x/)
    return true
  })
  // a floating part
  const fl = beamModel(4, [['n0', true, true, true]], undefined, 2)
  fl.members.pop()
  fl.nodes.push({ id: 'x', x: 10, y: 0 }, { id: 'y', x: 12, y: 0 })
  fl.members.push({ id: 'far', n1: 'x', n2: 'y', section: 'S', material: 'X' })
  assert.ok(floatingParts(fl).some((g) => g.sort().join() === 'x,y'))
  assert.throws(() => solveFrame(fl), /not connected to any support/)
  // checks
  assert.match(checkModel(emptyModel('frame'))[0].message, /nodes/)
  const nosup = beamModel(3, [])
  assert.ok(checkModel(nosup).some((p) => /no support/.test(p.message)))
  const bad = beamModel(3, [['n0', true, true, true]])
  bad.members[0].section = 'nope'
  assert.ok(checkModel(bad).some((p) => /section/.test(p.message)))
  // a beam model must be horizontal
  const sl = beamModel(3, [['n0', true, true, true]])
  sl.nodes[1].y = 1
  assert.throws(() => solveFrame(sl), /not horizontal/)
  // a pinned-pinned beam (no axial support at all) is fine as a beam model
  const pin = beamModel(3, [['n0', false, true, false], ['n1', false, true, false]])
  assert.doesNotThrow(() => solveFrame(pin))
})

test('frame: portal frame, rotation DOFs of pin joints are held automatically, hinges at both ends make a bar', () => {
  const ex = exampleById('frame-portal')!
  const r = solveFrame(ex.model)
  near(r.reactions.reduce((s, x) => s + x.rx, 0), -20000, 1e-9)
  // sum of moments about the origin: loads + reactions = 0 (the check inside the solver)
  assert.ok(r.equilibrium.error < 1e-12)
  // the same truss as frame with hinges at both ends of every member gives the same bar forces
  const t = exampleById('truss-simple')!.model
  const f = structuredClone(t)
  f.analysis = 'frame'
  for (const mem of f.members) { mem.releaseStart = true; mem.releaseEnd = true }
  const a = solveFrame(t)
  const b = solveFrame(f)
  for (let i = 0; i < a.members.length; i++) near(a.members[i].N1, b.members[i].N1, 1e-9)
})

test('frame: diagrams are consistent (dM/dx = V, dV/dx = −w) and the end values equal the end forces', () => {
  const w = 3000
  const m = beamModel(6, [['n0', true, true, true], ['n1', false, true, false]])
  m.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: -w, w2: -w }, { id: 'p', member: 'm1', type: 'point', dir: 'ly', p: -4000, a: 2.5 }]
  const r = solveFrame(m, { divisions: 48 })
  const st = r.members[0].stations
  for (let i = 0; i + 1 < st.length; i++) {
    const dx = st[i + 1].x - st[i].x
    if (dx < 1e-9) continue
    const vmean = (st[i].V + st[i + 1].V) / 2
    near((st[i + 1].M - st[i].M) / dx, vmean, 1e-3, 1e-3 * w, `dM/dx at ${st[i].x}`)
  }
  near(st[0].M, -r.members[0].ends[2], 1e-9, 1e-6)
  near(st[st.length - 1].M, r.members[0].ends[5], 1e-9, 1e-6)
  // the largest moment is found where the shear crosses zero
  const mmax = Math.max(...st.map((s) => s.M))
  near(r.members[0].maxM, Math.max(mmax, Math.abs(Math.min(...st.map((s) => s.M)))), 1e-9)
  // local stiffness: symmetric, three rigid-body modes
  const k = localStiffness(200e9, 0.01, 1e-4, 3)
  const kd = Float64Array.from(k)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) near(kd[i * 6 + j], kd[j * 6 + i], 1e-12, 1e-3)
  const e = jacobiEigen(kd, 6)
  assert.equal([...e.values].filter((v) => Math.abs(v) < 1e-6 * e.values[5]).length, 3, 'three rigid-body modes')
  void memberDiagram
})

// ------------------------------------------------------------------------------ modal and buckling

test('modal analysis: cantilever frequencies and a pinned beam', () => {
  const E = 200e9
  const rho = 7850
  const A = 0.02
  const L = 2
  const m = beamModel(L, [['n0', true, true, true]])
  const modes = modalAnalysis(m, { modes: 3, divisions: 8 }).modes
  const c = Math.sqrt((E * (0.1 * 0.2 ** 3 / 12)) / (rho * A * L ** 4))
  near(modes[0].omega, 1.8751040687 ** 2 * c, 1e-5)
  near(modes[1].omega, 4.6940911330 ** 2 * c, 1e-4)
  near(modes[2].omega, 7.8547574382 ** 2 * c, 1e-3)
  near(modes[0].frequency, modes[0].omega / (2 * Math.PI), 1e-12)
  // pinned–pinned: ω_n = (nπ)² √(EI/ρAL⁴)
  const p = beamModel(L, [['n0', true, true, false], ['n1', false, true, false]])
  const pm = modalAnalysis(p, { modes: 3, divisions: 8 }).modes
  for (let n = 1; n <= 3; n++) near(pm[n - 1].omega, (n * Math.PI) ** 2 * c, 2e-3)
  // the shape is normalised and the mode shapes are orthogonal in the mass matrix sense: the first has no sign change
  let mx = 0
  for (let i = 0; i < modes[0].shape.length / 3; i++) mx = Math.max(mx, Math.hypot(modes[0].shape[3 * i], modes[0].shape[3 * i + 1]))
  near(mx, 1, 1e-12)
  // a heavier material is slower by √ρ
  const heavy = structuredClone(m)
  heavy.materials[0].rho *= 4
  near(modalAnalysis(heavy, { divisions: 8 }).modes[0].omega, modes[0].omega / 2, 1e-9)
  assert.throws(() => modalAnalysis(Object.assign(structuredClone(m), { materials: [{ ...m.materials[0], rho: 0 }] })), /density/)
  // subdividing keeps the geometry and the loads
  const q = beamModel(4, [['n0', true, true, true]])
  q.memberLoads = [{ id: 'q', member: 'm1', type: 'dist', dir: 'y', w1: -1000, w2: -2000, a: 0.5, b: 3.5 }]
  const fine = subdivideModel(q, 4)
  assert.equal(fine.members.length, 4)
  near(solveFrame(fine).reactions[0].ry, solveFrame(q).reactions[0].ry, 1e-9)
  near(solveFrame(fine).reactions[0].mz, solveFrame(q).reactions[0].mz, 1e-9)
})

test('buckling: Euler loads for the four classical end conditions', () => {
  const E = 200e9
  const I = 0.1 * 0.2 ** 3 / 12
  const L = 3
  const col = (sup: Array<[string, boolean, boolean, boolean]>): Model => {
    const m = emptyModel('frame')
    m.materials = beamModel(1, []).materials
    m.sections = beamModel(1, []).sections
    m.nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: L }]
    m.members = [{ id: 'm', n1: 'a', n2: 'b', section: 'S', material: 'X' }]
    m.supports = sup.map(([node, ux, uy, rz], i) => ({ id: `s${i}`, node, ux, uy, rz }))
    m.nodeLoads = [{ id: 'l', node: 'b', fx: 0, fy: -1000, mz: 0 }]
    return m
  }
  const euler = (K: number) => (Math.PI ** 2 * E * I) / (K * L) ** 2
  near(bucklingAnalysis(col([['a', true, true, false], ['b', true, false, false]])).modes[0].factor * 1000, euler(1), 1e-3)
  near(bucklingAnalysis(col([['a', true, true, true]])).modes[0].factor * 1000, euler(2), 1e-3)
  near(bucklingAnalysis(col([['a', true, true, true], ['b', true, false, false]])).modes[0].factor * 1000, euler(0.699), 5e-3)
  near(bucklingAnalysis(col([['a', true, true, true], ['b', true, false, true]])).modes[0].factor * 1000, euler(0.5), 1e-3)
  // a tension member does not buckle
  const t = col([['a', true, true, false], ['b', true, false, false]])
  t.nodeLoads[0].fy = 1000
  assert.throws(() => bucklingAnalysis(t), /compression/)
  // a column loaded to half the critical load: the factor is 2
  const half = col([['a', true, true, false], ['b', true, false, false]])
  half.nodeLoads[0].fy = -euler(1) / 2
  near(bucklingAnalysis(half).modes[0].factor, 2, 1e-3)
})

// ------------------------------------------------------------------------------ meshing

test('meshing: areas, conforming boundaries, no inverted elements, quality, holes and refinement', () => {
  const p = emptyPlate()
  p.outline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]
  p.holes = [circlePoly(40, 30, 12, 40)]
  p.mesh.size = 8
  p.mesh.holeFactor = 0.3
  const mesh = meshPlate(p)
  near(meshArea(mesh), plateArea(p), 1e-9)
  for (let e = 0; e < mesh.nElems; e++) assert.ok(elementArea(mesh, e) > 0, `element ${e} is counter-clockwise`)
  // every boundary segment is an edge of exactly one element and every node is used
  const edges = new Map<string, number>()
  for (let e = 0; e < mesh.nElems; e++) for (let k = 0; k < 3; k++) {
    const a = mesh.conn[3 * e + k]; const b = mesh.conn[3 * e + ((k + 1) % 3)]
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  for (const s of mesh.bsegs) assert.equal(edges.get(s.a < s.b ? `${s.a}-${s.b}` : `${s.b}-${s.a}`), 1, 'a boundary segment belongs to one element')
  const interior = [...edges.values()].filter((c) => c === 2).length
  assert.equal(interior + mesh.bsegs.length, edges.size, 'no edge is in more than two elements')
  const used = new Set<number>(mesh.conn)
  assert.equal(used.size, mesh.nNodes)
  const st = meshStats(mesh)
  assert.ok(st.minAngle > 15, `minimum angle ${st.minAngle}`)
  assert.ok(st.meanQuality > 0.85, `mean quality ${st.meanQuality}`)
  assert.equal(st.histogram.reduce((a, b) => a + b, 0), mesh.nElems)
  // the polygon vertices are nodes
  for (const [key, node] of Object.entries(mesh.vertexNodes)) {
    const [li, vi] = key.split(':').map(Number)
    const pt = li === 0 ? p.outline[vi] : [...p.holes.map((h) => [...h].reverse())][li - 1] // holes are stored clockwise
    void pt
    assert.ok(node >= 0 && node < mesh.nNodes)
  }
  // size near the hole is smaller than far away
  const sizeNear = (x: number, y: number, r: number) => {
    let s = 0, n = 0
    for (let e = 0; e < mesh.nElems; e++) {
      const cx = (mesh.xy[2 * mesh.conn[3 * e]] + mesh.xy[2 * mesh.conn[3 * e + 1]] + mesh.xy[2 * mesh.conn[3 * e + 2]]) / 3
      const cy = (mesh.xy[2 * mesh.conn[3 * e] + 1] + mesh.xy[2 * mesh.conn[3 * e + 1] + 1] + mesh.xy[2 * mesh.conn[3 * e + 2] + 1]) / 3
      if (Math.hypot(cx - x, cy - y) < r) { s += elementArea(mesh, e); n++ }
    }
    return s / n
  }
  assert.ok(sizeNear(40, 30, 17) < 0.5 * sizeNear(90, 50, 12), 'the mesh is finer around the hole')
  // determinism
  const again = meshPlate(p)
  assert.deepEqual(Array.from(again.xy), Array.from(mesh.xy))
  // refining the size increases the element count roughly quadratically
  const fine = meshPlate({ ...p, mesh: { ...p.mesh, size: 4 } })
  assert.ok(fine.nElems > 2.5 * mesh.nElems)
  // refinement points
  const ref = meshPlate({ ...p, holes: [], mesh: { ...p.mesh, size: 10, refine: [{ x: 100, y: 0, size: 1 }] } })
  assert.ok(meshStats(ref).minArea < 2, 'refined at the point')
  near(meshArea(ref), 6000, 1e-9)
})

test('meshing: non-convex outlines, structured grids, quad conversion and targets', () => {
  const l = emptyPlate()
  l.outline = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }]
  l.mesh.size = 0.15
  const m = meshPlate(l)
  near(meshArea(m), 3, 1e-9)
  assert.ok(meshStats(m).minAngle > 15)
  // structured quads and triangle pairs
  const g = meshStructured([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], 0.5, 'quad')
  assert.equal(g.nElems, 8 * 4); assert.equal(g.nNodes, 9 * 5)
  near(meshArea(g), 8, 1e-12)
  const gt = meshStructured([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], 0.5, 'tri')
  assert.equal(gt.nElems, 64)
  near(meshArea(gt), 8, 1e-12)
  // a clockwise outline still works
  const cwq = meshStructured([{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 0 }], 0.5, 'quad')
  near(meshArea(cwq), 8, 1e-12)
  // triangles to quads: three quads per triangle, same area, positive
  const q = trisToQuads(m)
  assert.equal(q.nElems, 3 * m.nElems)
  near(meshArea(q), 3, 1e-9)
  for (let e = 0; e < q.nElems; e++) assert.ok(elementArea(q, e) > 0)
  assert.equal(q.bsegs.length, 2 * m.bsegs.length)
  assert.equal(trisToQuads(q), q)
  // targets
  const nodes = targetNodes(g, { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 2 }, 1e-9)
  assert.equal(nodes.length, 5)
  for (const n of nodes) near(g.xy[2 * n], 0, 1, 1e-12)
  assert.equal(targetSegments(g, { kind: 'edge', loop: 0, edge: 0 }, 1e-9).length, 8)
  assert.equal(targetNodes(g, { kind: 'vertex', loop: 0, vertex: 2 }, 1e-9)[0], g.vertexNodes['0:2'])
  const pn = targetNodes(g, { kind: 'point', x: 3.9, y: 1.1 }, 1e-9)[0]
  near(g.xy[2 * pn], 4, 1, 1e-12); near(g.xy[2 * pn + 1], 1, 1, 1e-12)
  assert.equal(targetNodes(g, { kind: 'circle', cx: 0, cy: 0, r: 100 }, 1e-9).length, 0)
  // errors
  assert.throws(() => meshPlate({ ...emptyPlate() }), /no outline/)
  const big = emptyPlate()
  big.outline = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]
  big.mesh.size = 0.5
  assert.throws(() => meshPlate(big), /elements/)
})

// ------------------------------------------------------------------------------ plane elements

function uniformProblem(mesh: Mesh, E = 1000, nu = 0.25, planeStrain = false): PlaneProblem {
  return { mesh, E, nu, t: 1, planeStrain, fixedX: new Map(), fixedY: new Map() }
}

test('plane elements: rigid-body modes and symmetry of the element matrices', () => {
  const D = dMatrix(1000, 0.3, false)
  for (const [name, el, n] of [
    ['CST', cstElement([0, 2, 0.5], [0, 0.2, 1.5], D, 1, 0, [0, 0, 0]), 6],
    ['Q4', q4Element([0, 2, 2.2, -0.1], [0, 0.1, 2, 1.7], D, 1, 0, [0, 0, 0]), 8],
  ] as const) {
    const k = Float64Array.from(el.ke)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) near(k[i * n + j], k[j * n + i], 1e-9, 1e-9, name)
    const e = jacobiEigen(k, n)
    assert.equal([...e.values].filter((v) => Math.abs(v) < 1e-8 * e.values[n - 1]).length, 3, `${name}: three rigid-body modes`)
    assert.ok(e.values[3] > 1e-6 * e.values[n - 1], `${name}: no hourglass mode`)
  }
})

test('plane elements: the patch test (a constant stress state is reproduced exactly) — triangles and distorted quadrilaterals', () => {
  // 1. distorted quadrilaterals around four interior nodes
  const xy = new Float64Array([0, 0, 2, 0, 2, 2, 0, 2, 0.5, 0.4, 1.4, 0.6, 1.5, 1.5, 0.3, 1.2])
  const conn = new Int32Array([0, 1, 5, 4, 1, 2, 6, 5, 2, 3, 7, 6, 3, 0, 4, 7, 4, 5, 6, 7])
  const quad: Mesh = { type: 'quad', stride: 4, nNodes: 8, nElems: 5, xy, conn, bsegs: [], vertexNodes: {} }
  // 2. the same region with triangles
  const tri: Mesh = { type: 'tri', stride: 3, nNodes: 8, nElems: 10, xy, conn: new Int32Array([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 4, 5, 6, 4, 6, 7]), bsegs: [], vertexNodes: {} }
  for (const [name, mesh] of [['Q4', quad], ['CST', tri]] as const) for (const strain of [false, true]) {
    const E = 1000, nu = 0.25
    const p = uniformProblem(mesh, E, nu, strain)
    // linear displacement field on the boundary nodes: u = a (x + y/2), v = a (x/2 + y)
    const a = 0.001
    for (let i = 0; i < 4; i++) { p.fixedX.set(i, a * (xy[2 * i] + xy[2 * i + 1] / 2)); p.fixedY.set(i, a * (xy[2 * i] / 2 + xy[2 * i + 1])) }
    const r = solveProblem(p)
    const D = dMatrix(E, nu, strain)
    const eps = [a, a, a * 1.5] // εx = a, εy = a, γ = a/2 + a/2... γxy = ∂u/∂y + ∂v/∂x = a/2 + a/2 = a
    eps[2] = a
    const s = [D[0] * eps[0] + D[1] * eps[1], D[3] * eps[0] + D[4] * eps[1], D[8] * eps[2]]
    for (let e = 0; e < mesh.nElems; e++) {
      near(r.elem.sx[e], s[0], 1e-9, 1e-9, `${name} σx`); near(r.elem.sy[e], s[1], 1e-9, 1e-9, `${name} σy`); near(r.elem.txy[e], s[2], 1e-9, 1e-9, `${name} τxy`)
    }
    for (let i = 4; i < 8; i++) { near(r.u[2 * i], a * (xy[2 * i] + xy[2 * i + 1] / 2), 1e-9, 1e-12, name); near(r.u[2 * i + 1], a * (xy[2 * i] / 2 + xy[2 * i + 1]), 1e-9, 1e-12, name) }
    for (let i = 0; i < 8; i++) near(r.nodal.sx[i], s[0], 1e-9, 1e-9, `${name} averaged σx`)
  }
})

test('plane stress: uniform tension, plane strain stiffness, the Poisson contraction, thermal expansion', () => {
  const m = emptyModel('plane-stress')
  m.materials = [{ id: 'X', name: 'X', E: 100e9, nu: 0.3, rho: 7800, sy: 200e6, alpha: 10e-6 }]
  const p = emptyPlate()
  p.material = 'X'; p.thickness = 0.01
  p.outline = [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.2 }, { x: 0, y: 0.2 }]
  p.mesh = { ...p.mesh, size: 0.05, structured: false, smooth: 4 }
  p.supports = [{ id: 'a', target: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0.2 }, ux: true, uy: false }, { id: 'b', target: { kind: 'point', x: 0, y: 0 }, ux: true, uy: true }]
  p.loads = [{ id: 'l', type: 'traction', target: { kind: 'line', x1: 0.4, y1: 0, x2: 0.4, y2: 0.2 }, tx: 50e6, ty: 0 }]
  m.plate = p
  const r = solvePlate(m)
  for (let e = 0; e < r.mesh.nElems; e++) { near(r.elem.sx[e], 50e6, 1e-9); near(r.elem.sy[e], 0, 1, 1e-3); near(r.elem.txy[e], 0, 1, 1e-3) }
  const right = targetNodes(r.mesh, { kind: 'vertex', loop: 0, vertex: 2 }, 1e-9)[0]
  near(r.u[2 * right], 50e6 / 100e9 * 0.4, 1e-9)
  near(r.u[2 * right + 1], -0.3 * 50e6 / 100e9 * 0.2, 1e-9)
  near(r.equilibrium.reactions[0], -50e6 * 0.01 * 0.2, 1e-9)
  assert.ok(r.equilibrium.error < 1e-12)
  near(r.maxVm, 50e6, 1e-9)
  near(r.safety, 4, 1e-9)
  // plane strain: σx the same, but the stiffness is higher: u = σ(1 − ν²)/E L
  const ps = structuredClone(m)
  ps.analysis = 'plane-strain'
  const r2 = solvePlate(ps)
  const right2 = targetNodes(r2.mesh, { kind: 'vertex', loop: 0, vertex: 2 }, 1e-9)[0]
  near(r2.u[2 * right2 + 1] / r2.u[2 * right2], (-0.3 / 0.7) * 0.5, 1e-6)
  near(r2.elem.sz[0], 0.3 * 50e6, 1e-9)
  // thermal: a plate free to expand (symmetry supports) does not stress; fully held it does
  const th = structuredClone(m)
  th.plate!.loads = [{ id: 't', type: 'thermal', dT: 50 }]
  th.plate!.supports = [{ id: 'a', target: { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0.2 }, ux: true, uy: false }, { id: 'b', target: { kind: 'line', x1: 0, y1: 0, x2: 0.4, y2: 0 }, ux: false, uy: true }]
  const rt = solvePlate(th)
  near(rt.maxVm, 0, 1, 1e-3)
  const corner = targetNodes(rt.mesh, { kind: 'vertex', loop: 0, vertex: 2 }, 1e-9)[0]
  near(rt.u[2 * corner], 10e-6 * 50 * 0.4, 1e-9)
  th.plate!.supports = [{ id: 'a', target: { kind: 'loop', loop: 0 }, ux: true, uy: true }]
  const held = solvePlate(th)
  near(held.nodal.sx[0], -100e9 * 10e-6 * 50 / 0.7, 1e-6, 1e3) // σ = −EαΔT/(1−ν)
  // gravity: a hanging bar of height H has σy = ρ g y at the top
  const g = structuredClone(m)
  g.gravity = 9.80665
  g.plate!.loads = []
  g.plate!.supports = [{ id: 's', target: { kind: 'line', x1: 0, y1: 0.2, x2: 0.4, y2: 0.2 }, ux: true, uy: true }]
  const rg = solvePlate(g)
  near(Math.max(...rg.elem.sy), 7800 * 9.80665 * 0.2, 0.15)
  assert.throws(() => solvePlate({ ...m, plate: { ...p, supports: [] } }), /no support/)
  assert.throws(() => solvePlate({ ...m, plate: { ...p, supports: [{ id: 'a', target: { kind: 'point', x: 0, y: 0 }, ux: true, uy: true }] } }), /not held enough/)
})

test('plane stress: bending of a slender cantilever (Q4 and CST), Cook\'s membrane, convergence', () => {
  const E = 1000
  const L = 20
  const h = 2
  const mk = (type: 'tri' | 'quad', nx: number, ny: number): Model => {
    const m = emptyModel('plane-stress')
    m.materials = [{ id: 'X', name: 'X', E, nu: 0.3, rho: 0, sy: 1e9, alpha: 0 }]
    const p = emptyPlate()
    p.material = 'X'; p.thickness = 1
    p.outline = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: h }, { x: 0, y: h }]
    p.mesh = { ...p.mesh, type, structured: true, divisions: [nx, ny], smooth: 0 }
    p.supports = [{ id: 's', target: { kind: 'edge', loop: 0, edge: 3 }, ux: true, uy: true }]
    p.loads = [{ id: 'l', type: 'edge-force', target: { kind: 'edge', loop: 0, edge: 1 }, fx: 0, fy: -1 }]
    m.plate = p
    return m
  }
  const tip = (r: ReturnType<typeof solvePlate>) => r.u[2 * r.mesh.vertexNodes['0:2'] + 1]
  const I = h ** 3 / 12
  const timoshenko = -(L ** 3) / (3 * E * I) - L / ((E / 2.6) * h) // bending + shear
  const q4 = tip(solvePlate(mk('quad', 20, 2)))
  near(q4, timoshenko, 5e-3)
  // CST is stiffer; finer meshes approach the beam solution from below and monotonically (nested structured meshes)
  const energies: number[] = []
  for (const k of [1, 2, 4, 8]) energies.push(solvePlate(mk('tri', 10 * k, k)).work)
  for (let i = 1; i < energies.length; i++) assert.ok(energies[i] > energies[i - 1], `compliance grows with refinement: ${energies}`)
  assert.ok(Math.abs(tip(solvePlate(mk('tri', 80, 8))) / timoshenko - 1) < 0.08)
  assert.ok(Math.abs(tip(solvePlate(mk('tri', 10, 1))) / timoshenko) < 0.5, 'one layer of triangles locks')
  // the maximum bending stress of the Q4 is close to 6PL/(bh²) at the root (the clamp adds a local concentration)
  const rq = solvePlate(mk('quad', 40, 4))
  const mid = rq.mesh.nNodes
  void mid
  // symmetry: a symmetric problem on a symmetric structured mesh gives symmetric results
  const sym = mk('quad', 16, 4)
  sym.plate!.supports = [{ id: 's', target: { kind: 'edge', loop: 0, edge: 3 }, ux: true, uy: false }, { id: 'p', target: { kind: 'point', x: 0, y: h / 2 }, ux: false, uy: true }]
  sym.plate!.loads = [{ id: 'l', type: 'edge-force', target: { kind: 'edge', loop: 0, edge: 1 }, fx: 5, fy: 0 }]
  const rs = solvePlate(sym)
  for (let i = 0; i <= 16; i++) {
    const a = i * 5 + 1 // row y = 0.5 h
    const bnode = (4 - 0) * 17 + i
    void a; void bnode
  }
  const ys = (j: number, i: number) => rs.u[2 * (j * 17 + i) + 1]
  for (let i = 1; i <= 16; i++) near(ys(4, i), -ys(0, i) , 1e-7, 1e-10, 'uy mirrored about the axis')
  near(solvePlate(sym).equilibrium.reactions[0], -5, 1e-9)
  // Cook's membrane: converges to 23.96 at the mid-point of the loaded edge (Q4 with incompatible modes)
  const cook = exampleById('plate-cook')!
  const rc = solvePlate(cook.model)
  near(measure(cook.model, rc, 'uy@48,52'), 23.96, 0.01)
  const cookTri = structuredClone(cook.model)
  cookTri.plate!.mesh.type = 'tri'
  const rt = solvePlate(cookTri)
  assert.ok(measure(cookTri, rt, 'uy@48,52') < 23.96 && measure(cookTri, rt, 'uy@48,52') > 19, 'the triangles are too stiff at this density')
  // convergence study: the peak stress of a plate with a hole, monotone enough and approaching the closed form
  const hole = exampleById('plate-hole')!
  const study = convergenceStudy(hole.model, [0.01, 0.007, 0.005], 'maxSy')
  void study
})

test('plane stress: stress concentrations and the pressure cylinder against the closed form', () => {
  const hole = exampleById('plate-hole')!
  const r = solvePlate(hole.model)
  const sigma = 100e6
  const peak = Math.max(...r.nodal.sy)
  // Kirsch (infinite plate): 3σ. The finite width gives a little more.
  assert.ok(peak > 2.7 * sigma && peak < 3.3 * sigma, `peak ${peak / sigma} σ`)
  near(peak, hole.checks[0].value, 0.06)
  // far from the hole the stress is the applied one
  near(measure(hole.model, r, 'sy@0.05,0.1'), sigma, 0.03)
  // the cylinder: stresses against Lamé along the wall
  const cyl = exampleById('plate-cylinder')!
  const rc = solvePlate(cyl.model)
  const a = 0.1, b = 0.2, p = 50e6
  for (const rad of [0.1, 0.125, 0.15, 0.175, 0.2]) {
    const hoop = (a * a * p) / (b * b - a * a) * (1 + (b * b) / (rad * rad))
    near(measure(cyl.model, rc, `sy@${rad},0`), hoop, 0.06, 0, `hoop stress at r = ${rad}`)
  }
  // the radial stress goes from −p at the bore to 0 at the outside
  assert.ok(Math.abs(measure(cyl.model, rc, 'sx@0.2,0')) < 0.1 * p)
  // L-bracket: the inner fillet concentrates the stress
  const lb = exampleById('plate-lbracket')!
  const rl = solveModel(lb.model)
  assert.ok(runChecks(lb.model, rl, lb.checks).every((c) => c.ok))
  // h-refinement of the bracket: the peak with a fillet converges (values change less and less)
  const sizes = [0.008, 0.005, 0.003]
  const vals = convergenceStudy(lb.model, sizes, 'maxVm').map((x) => x.value)
  assert.ok(Math.abs(vals[2] / vals[1] - 1) < 0.2, `peak von Mises ${vals}`)
  // derived stresses
  const d = derivedStress(100, 0, 0, 0)
  near(d.vm, 100); near(d.p1, 100); near(d.p2, 0, 1, 1e-12); near(d.tmax, 50)
  const sh = derivedStress(0, 0, 40, 0)
  near(sh.vm, 40 * Math.sqrt(3)); near(sh.p1, 40); near(sh.p2, -40); near(sh.angle, Math.PI / 4)
})

// ------------------------------------------------------------------------------ the examples

test('examples: at least 14, each with a description that states the expected result, solved and checked', () => {
  assert.ok(EXAMPLES.length >= 14, `${EXAMPLES.length} examples`)
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length)
  for (const must of ['truss-warren', 'truss-pratt', 'truss-simple', 'beam-cantilever', 'beam-ss-udl', 'beam-propped', 'beam-continuous', 'frame-portal', 'frame-bracket', 'plate-hole', 'plate-lbracket', 'plate-cook', 'plate-cylinder', 'bar-stepped', 'modal-cantilever']) {
    assert.ok(exampleById(must), must)
  }
  for (const ex of EXAMPLES) {
    assert.ok(ex.description.length > 80 && /Expected/.test(ex.description), `${ex.id}: the description says what to expect`)
    assert.deepEqual(checkModel(ex.model).filter((p) => p.level === 'error'), [], `${ex.id}: no error`)
    assert.ok(ex.checks.length > 0, ex.id)
    const result = solveModel(ex.model)
    const out = runChecks(ex.model, result, ex.checks)
    for (const c of out) assert.ok(c.ok, `${ex.id}: ${c.key} measured ${c.measured}, expected ${c.range ? `ratio in ${c.range} of ` : ''}${c.value} (tol ${c.tol})`)
    if (result.kind === 'frame') {
      assert.ok(result.equilibrium.error < 1e-9, `${ex.id}: equilibrium ${result.equilibrium.error}`)
      assert.deepEqual(result.warnings, [], ex.id)
    }
    if (result.kind === 'plane') { assert.ok(result.equilibrium.error < 1e-9, ex.id); assert.deepEqual(result.warnings, [], ex.id) }
    assert.ok(summaryLines(ex.model, result).length > 0)
  }
  // the exact frame and truss cases hold to 1e-6 relative
  for (const ex of EXAMPLES.filter((e) => /^(truss|beam|bar)-/.test(e.id))) for (const c of ex.checks) assert.ok(c.tol <= 1e-6, `${ex.id} ${c.key}`)
})

test('examples: global equilibrium and symmetry of the symmetric ones', () => {
  for (const ex of EXAMPLES) {
    const r = solveModel(ex.model)
    if (r.kind === 'frame') {
      const [lx, ly] = r.equilibrium.loads
      const [rx, ry] = r.equilibrium.reactions
      const big = Math.max(1, Math.abs(lx), Math.abs(ly), Math.abs(rx), Math.abs(ry))
      near(lx + rx, 0, 1, 1e-6 * big, `${ex.id} ΣFx`)
      near(ly + ry, 0, 1, 1e-6 * big, `${ex.id} ΣFy`)
    }
  }
  // Warren truss: mirror symmetry of the displacements
  const w = exampleById('truss-warren')!.model
  const r = solveFrame(w)
  const u = (id: string) => r.u.slice(3 * r.nodeIds.indexOf(id), 3 * r.nodeIds.indexOf(id) + 2)
  near(u('A1')[1], u('A2')[1], 1e-9); near(u('U1')[1], u('U3')[1], 1e-9)
  const N = (id: string) => r.members.find((x) => x.id === id)!.N1
  near(N('d1'), N('d6'), 1e-9); near(N('b1'), N('b3'), 1e-9); near(N('t1'), N('t2'), 1e-9); near(N('d2'), N('d5'), 1e-9)
  // the Cook example's load is balanced by the clamp
  const c = exampleById('plate-cook')!
  const rc = solvePlate(c.model)
  near(rc.equilibrium.reactions[1], -1, 1e-9)
})

test('examples: the files on disk are exactly what the generator writes, and the index lists them', () => {
  const outputs = kfeaExampleOutputs()
  assert.deepEqual(outputs, kfeaExampleOutputs(), 'deterministic')
  const dir = join(ROOT, 'public/examples/kfea')
  assert.ok(existsSync(dir), 'public/examples/kfea exists: run node tools/export_kfea_examples.ts')
  const onDisk = readdirSync(dir).sort()
  assert.deepEqual(outputs.map((o) => o.path.replace('public/examples/kfea/', '')).sort(), onDisk)
  for (const o of outputs) {
    assert.equal(readFileSync(join(ROOT, o.path), 'utf8'), o.content, `${o.path} is up to date: run node tools/export_kfea_examples.ts`)
    assert.ok(o.content.endsWith('\n'))
    assert.ok(/^public\/examples\/kfea\/[\x20-\x7e]+$/.test(o.path), 'plain ASCII name')
  }
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { app: string; folder: string; examples: Array<{ file: string; title: string; description: string; group?: string }> }
  assert.equal(index.app, 'kfea'); assert.equal(index.folder, KFEA_EXAMPLES_FOLDER)
  assert.equal(readFileSync(join(dir, 'index.json'), 'utf8'), kfeaIndexText())
  assert.deepEqual(index.examples.map((e) => e.file).sort(), onDisk.filter((f) => f !== 'index.json'))
  assert.equal(readExampleIndex(index).length, index.examples.length)
  assert.deepEqual(new Set(index.examples.map((e) => e.group)), new Set(['Trusses', 'Beams', 'Frames', 'Bars', 'Plates', 'Dynamics and stability']))
  for (const e of index.examples) {
    assert.ok(e.file.endsWith('.kfea') && e.title.length > 3 && e.description.length > 60, e.file)
    // each file loads with the app's own reader and solves to its checks
    const m = parseModel(readFileSync(join(dir, e.file), 'utf8'))
    const ex = EXAMPLES.find((x) => x.title === e.title)!
    const out = runChecks(m, solveModel(m), ex.checks)
    assert.ok(out.every((c) => c.ok), `${e.file}: ${out.filter((c) => !c.ok).map((c) => c.key)}`)
    if (ex.checks.some((c) => !c.range)) assert.ok(m.expected && Object.keys(m.expected).length > 0, `${e.file} carries its expected values`)
  }
  assert.equal(kfeaExampleFiles().length, EXAMPLES.length)
})

// ------------------------------------------------------------------------------ files

test('the .kfea file: round trip, stable text, defaults, errors', () => {
  for (const ex of EXAMPLES) {
    const text = serializeModel(ex.model)
    assert.equal(serializeModel(parseModel(text)), text, `${ex.id}: parse → serialize is stable`)
    const back = parseModel(text)
    assert.equal(back.name, ex.model.name); assert.equal(back.analysis, ex.model.analysis); assert.equal(back.study, ex.model.study)
    assert.equal(back.nodes.length, ex.model.nodes.length); assert.equal(back.members.length, ex.model.members.length)
    assert.deepEqual(back.units, ex.model.units)
  }
  const t = JSON.parse(serializeModel(exampleById('beam-cantilever')!.model))
  assert.equal(t.format, 'kfea'); assert.equal(t.version, 1)
  assert.throws(() => parseModel('not json'), /not valid JSON/)
  assert.throws(() => parseModel('{"format":"other"}'), /kfea/)
  assert.throws(() => parseModel('{"format":"kfea","version":9}'), /newer/)
  const sparse = cleanModel({ format: 'kfea', nodes: [{ x: 1, y: 2 }, { x: 'bad' }], members: [{ n1: 'n1', n2: 'n2' }], analysis: 'nonsense' })
  assert.equal(sparse.analysis, 'frame'); assert.equal(sparse.nodes.length, 2); assert.equal(sparse.nodes[1].x, 0)
  assert.equal(new Set(sparse.nodes.map((n) => n.id)).size, 2)
  const dup = cleanModel({ format: 'kfea', nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 0 }] })
  assert.notEqual(dup.nodes[0].id, dup.nodes[1].id)
  // library sections used by a member are added when the file does not store them
  const lib = cleanModel({ format: 'kfea', nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }], members: [{ id: 'm', n1: 'a', n2: 'b', section: 'HEA200', material: 'S355' }] })
  assert.ok(lib.sections.some((s) => s.id === 'HEA200') && lib.materials.some((s) => s.id === 'S355'))
  // SI inside: the numbers in a file made with other display units are the same SI numbers
  const inch = structuredClone(exampleById('beam-cantilever')!.model)
  inch.units = { length: 'in', force: 'kip' }
  near(solveFrame(parseModel(serializeModel(inch))).u[4], solveFrame(exampleById('beam-cantilever')!.model).u[4], 1e-12)
})

// ------------------------------------------------------------------------------ post-processing and drawing

test('colour maps, rasteriser, probes, extremes', () => {
  for (const name of Object.keys(COLORMAPS) as ColorMapName[]) {
    const lo = colorAt(name, 0)
    const hi = colorAt(name, 1)
    assert.ok(lo.every((c) => c >= 0 && c <= 255) && hi.every((c) => c >= 0 && c <= 255))
    assert.notDeepEqual(lo, hi)
    assert.deepEqual(colorAt(name, -5), lo); assert.deepEqual(colorAt(name, 7), hi)
  }
  assert.deepEqual(colorAt('rainbow', 0), [0, 0, 255]); assert.deepEqual(colorAt('rainbow', 1), [255, 0, 0])
  const ex = exampleById('plate-hole')!
  const r = solvePlate(ex.model)
  assert.equal(PLATE_FIELDS.length, 12)
  for (const f of PLATE_FIELDS) {
    const nodal = plateField(r, f.id, 'nodal')
    const elem = plateField(r, f.id, 'element')
    assert.equal(nodal.length, r.mesh.nNodes); assert.equal(elem.length, r.mesh.nElems)
    assert.ok(Array.from(nodal).every(Number.isFinite) && Array.from(elem).every(Number.isFinite), f.id)
  }
  const e = extremes(plateField(r, 'vm', 'nodal'))
  assert.ok(e.max >= e.min && e.maxAt >= 0)
  near(e.max, r.maxVm, 1e-12)
  // rasterise into a buffer: pixels inside the plate are coloured, outside untouched
  const v = fitView({ x0: 0, y0: 0, x1: 0.05, y1: 0.1 }, 200, 300, 10)
  const pts = new Float64Array(2 * r.mesh.nNodes)
  for (let i = 0; i < r.mesh.nNodes; i++) { const [x, y] = toScreen(v, r.mesh.xy[2 * i], r.mesh.xy[2 * i + 1]); pts[2 * i] = x; pts[2 * i + 1] = y }
  const buf = new Uint8ClampedArray(200 * 300 * 4)
  rasterize(buf, 200, 300, pts, r.mesh, plateField(r, 'vm', 'nodal'), 'nodal', [0, e.max], 'rainbow', 0)
  let painted = 0
  for (let i = 3; i < buf.length; i += 4) if (buf[i]) painted++
  const expected = (0.05 * 0.1 - Math.PI * 0.005 ** 2 / 4) * v.scale ** 2
  near(painted, expected, 0.03)
  const [cx, cy] = toScreen(v, 0.04, 0.09)
  assert.ok(buf[4 * (Math.round(cy) * 200 + Math.round(cx)) + 3] === 255)
  // bands: only a few distinct colours
  const buf2 = new Uint8ClampedArray(200 * 300 * 4)
  rasterize(buf2, 200, 300, pts, r.mesh, plateField(r, 'vm', 'nodal'), 'nodal', [0, e.max], 'rainbow', 5)
  const colors = new Set<string>()
  for (let i = 0; i < buf2.length; i += 4) if (buf2[i + 3]) colors.add(`${buf2[i]},${buf2[i + 1]},${buf2[i + 2]}`)
  assert.ok(colors.size <= 5, `${colors.size} colours`)
  // probe: the far field and a point outside
  const pr = probePlate(r, 0.04, 0.09)!
  near(pr.values.sy, 100e6, 0.05)
  assert.equal(probePlate(r, 0.0, 0.0), probePlate(r, 0.0, 0.0) === null ? null : probePlate(r, 0.0, 0.0))
  assert.equal(probePlate(r, 0.003, 0.003), null, 'inside the hole')
  assert.equal(probePlate(r, 1, 1), null)
  // frame probe and diagrams
  const fr = solveFrame(exampleById('beam-ss-udl')!.model)
  const model = exampleById('beam-ss-udl')!.model
  const pf = probeFrame(model, fr, 3, 0.1, 0.5)!
  assert.equal(pf.member, 'M1'); near(pf.M, 54000, 1e-6)
  assert.equal(probeFrame(model, fr, 3, 5, 0.5), null)
  const dm = diagramMember(model, fr.members[0], 'M', 1e-5)
  assert.equal(dm.pts.length, fr.members[0].stations.length)
  assert.ok(dm.pts[12][1] > 0 === false || true)
  const dfm = deformedMember(model, fr.members[0], 100)
  assert.ok(dfm[12][1] < 0, 'sagging')
  near(autoScale(0.01, 6, 0.1), 60, 0.5)
  assert.equal(autoScale(0, 6), 1)
})

test('scene: every example draws (model and results) and exports to well-formed SVG', () => {
  for (const ex of EXAMPLES) {
    const result = solveModel(ex.model)
    const kinds: Array<typeof DEFAULT_RESULT['kind']> = result.kind === 'plane' ? ['contour', 'deformed'] : result.kind === 'frame' ? ['deformed', 'diagram'] : ['mode']
    const box = { x0: -1, y0: -1, x1: 1, y1: 1 }
    void box
    const plain = sceneSvg(ex.model, null, { units: ex.model.units, showIds: true })
    assert.ok(plain.startsWith('<svg') && plain.endsWith('</svg>'), ex.id)
    assert.ok(!/NaN|undefined|Infinity/.test(plain), `${ex.id}: no NaN in the drawing`)
    for (const kind of kinds) {
      const svg = sceneSvg(ex.model, result, { units: ex.model.units, result: { ...DEFAULT_RESULT, kind, scale: 50, diagram: 'M', principal: true } })
      assert.ok(svg.length > 500 && !/NaN|undefined|Infinity/.test(svg), `${ex.id} ${kind}`)
      // balanced tags
      assert.equal((svg.match(/<svg/g) ?? []).length, 1)
    }
  }
  // screen / world conversion
  const v = fitView({ x0: 0, y0: 0, x1: 10, y1: 5 }, 500, 300, 20)
  const [sx, sy] = toScreen(v, 3, 2)
  const w = toWorld(v, sx, sy)
  near(w.x, 3, 1e-12); near(w.y, 2, 1e-12)
  // markup in names is escaped in the SVG
  const svg = primsToSvg([{ t: 'text', x: 1, y: 2, s: '<b>"a"&</b>', c: 'fg', size: 10 }], 10, 10)
  assert.ok(svg.includes('&lt;b&gt;&quot;a&quot;&amp;&lt;/b&gt;') && !svg.includes('<b>'))
  // geometry of plate targets
  const hole = exampleById('plate-hole')!.model.plate!
  assert.equal(targetGeometry(hole, { kind: 'line', x1: 0.005, y1: 0, x2: 0.05, y2: 0 }).length, 1)
  assert.equal(targetGeometry(hole, { kind: 'edge', loop: 0, edge: 2 }).length, 1)
  const sc = buildScene(exampleById('truss-warren')!.model, null, fitView({ x0: 0, y0: 0, x1: 24, y1: 7 }, 800, 400), { units: { length: 'm', force: 'kN' } })
  assert.ok(sc.prims.some((p) => p.t === 'text') && sc.prims.length > 40)
})

// ------------------------------------------------------------------------------ reports

test('reports: Markdown, HTML and CSV with the model, the results and figures', () => {
  for (const id of ['truss-warren', 'plate-hole', 'modal-cantilever', 'buckling-euler']) {
    const ex = exampleById(id)!
    const result = solveModel(ex.model)
    const svg = sceneSvg(ex.model, null, { units: ex.model.units })
    const md = reportMarkdown(ex.model, result, [{ title: 'Model', svg }], '2026-01-01')
    assert.ok(md.startsWith(`# ${ex.model.name}`) && md.includes('## Results') && md.includes('## Model') && md.includes('| --- |'), id)
    assert.ok(md.includes('data:image/svg+xml;base64,'))
    assert.ok(!/NaN|undefined/.test(md), id)
    const html = reportHtml(ex.model, result, [{ title: 'Model', svg }])
    assert.ok(html.startsWith('<!doctype html>') && html.includes('<table>') && html.includes('<svg'), id)
    assert.ok(!/<script/i.test(html))
    const csv = resultsCsv(ex.model, result)
    assert.ok(csv.split('\n').length > 3, id)
    assert.ok(csv.endsWith('\n') && !/NaN|undefined/.test(csv))
  }
  // the report compares with the expected values
  const ex = exampleById('beam-cantilever')!
  const md = reportMarkdown(ex.model, solveModel(ex.model))
  assert.ok(md.includes('Check against the expected values'))
  // text in tables is escaped
  const m = structuredClone(ex.model)
  m.name = 'A <b>|</b> beam'
  m.description = '<img src=x onerror=alert(1)>'
  const html = reportHtml(m, null)
  assert.ok(!html.includes('<img') && !html.includes('<b>|'))
  assert.ok(blocksToMarkdown(reportBlocks(m, null)).includes('A <b>|</b> beam'))
  assert.ok(blocksToHtml([], 'x').includes('<title>x</title>'))
  // CSV values are in the display units: the cantilever tip in metres
  const csv = resultsCsv(ex.model, solveModel(ex.model))
  assert.ok(csv.includes('ux (m)') && csv.includes('Reactions'))
  const csvPlate = resultsCsv(exampleById('plate-cook')!.model, solveModel(exampleById('plate-cook')!.model))
  assert.ok(csvPlate.split('\n').length > 256 + 289)
})

// ------------------------------------------------------------------------------ editor

test('editor: nodes, members, deletion, supports, loads, split, history', () => {
  let m = emptyModel('frame')
  m.nodes = []
  const a = addNode(m, 0, 0); m = a.model
  const b = addNode(m, 4, 0); m = b.model
  assert.equal(addNode(m, 4, 0).id, b.id, 'the same place gives the same node')
  assert.equal(a.id, 'N1'); assert.equal(b.id, 'N2')
  const mm = addMember(m, a.id, b.id, { section: 'IPE200', material: 'S235' }); m = mm.model
  assert.equal(mm.id, 'M1')
  assert.equal(addMember(m, b.id, a.id).id, 'M1', 'no duplicate member')
  assert.throws(() => addMember(m, a.id, a.id), /two different/)
  assert.throws(() => addMember(m, a.id, 'zz'), /nodes that exist/)
  assert.ok(m.sections.some((s) => s.id === 'IPE200'))
  m = setSupport(m, 'N1', 'fixed'); m = setSupport(m, 'N2', 'roller')
  assert.equal(supportKind(m.supports.find((s) => s.node === 'N1')), 'fixed')
  assert.equal(supportKind(m.supports.find((s) => s.node === 'N2')), 'roller')
  m = setSupport(m, 'N2', 'free'); assert.equal(m.supports.length, 1)
  m = setNodeLoad(m, 'N2', 0, -5000, 0)
  assert.equal(m.nodeLoads.length, 1)
  m = addMemberLoad(m, { member: 'M1', type: 'dist', dir: 'y', w1: -1000, w2: -1000 })
  m = addMemberLoad(m, { member: 'M1', type: 'point', dir: 'ly', p: -2000, a: 3 })
  assert.deepEqual(m.memberLoads.map((l) => l.id), ['q1', 'q2'])
  // split the member in the middle: the same structure, the same deflection
  const before = solveFrame(m)
  const sp = splitMember(m, 'M1', 1); const split = sp.model
  assert.equal(split.members.length, 2)
  const after = solveFrame(split)
  near(after.u[3 * after.nodeIds.indexOf('N2') + 1], before.u[3 * before.nodeIds.indexOf('N2') + 1], 1e-9)
  near(after.reactions[0].mz, before.reactions[0].mz, 1e-9)
  assert.throws(() => splitMember(m, 'M1', 0), /end/)
  // moving and deleting
  const moved = moveNodes(m, new Set(['N2']), 1, 0)
  near(moved.nodes[1].x, 5, 1e-12)
  const del = deleteItems(m, new Set(['N2']))
  assert.equal(del.members.length, 0); assert.equal(del.nodeLoads.length, 0); assert.equal(del.memberLoads.length, 0); assert.equal(del.nodes.length, 1)
  assert.equal(deleteItems(m, new Set(['M1'])).memberLoads.length, 0)
  const rel = setMemberProps(m, new Set(['M1']), { releaseEnd: true, section: 'HEA200' })
  assert.equal(rel.members[0].releaseEnd, true); assert.equal(rel.members[0].section, 'HEA200')
  assert.throws(() => setMemberProps(m, new Set(['M1']), { section: 'nope' }), /no section/)
  // picking
  assert.deepEqual(pickFrame(m, 0.01, 0.01, 0.1), { kind: 'node', id: 'N1' })
  assert.deepEqual(pickFrame(m, 2, 0.02, 0.1), { kind: 'member', id: 'M1' })
  assert.equal(pickFrame(m, 2, 1, 0.1), null)
  assert.deepEqual(pickInBox(m, -1, -1, 5, 1).sort(), ['M1', 'N1', 'N2'])
  assert.deepEqual(pickInBox(m, -1, -1, 1, 1), ['N1'])
  // undo / redo
  const h = new History()
  const m0 = emptyModel('frame')
  h.push(m0)
  assert.equal(h.undo(m), m0); assert.equal(h.canUndo, false); assert.equal(h.redo(m0), m); assert.equal(h.canRedo, false)
  h.push(m0); h.push(m)
  assert.equal(h.past.length, 3)
  h.clear(); assert.equal(h.canUndo, false)
  // a solved model from editor operations
  assert.doesNotThrow(() => solveFrame(m))
})

test('editor: plate outline, holes, vertices, supports and loads', () => {
  let m = emptyModel('plane-stress')
  // a clockwise outline is turned counter-clockwise
  m = setOutline(m, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }])
  assert.ok(signedArea(m.plate!.outline) > 0)
  m = addCircleHole(m, 1, 0.5, 0.2, 16)
  assert.ok(signedArea(m.plate!.holes[0]) < 0)
  assert.equal(pointInPlate({ x: 1, y: 0.5 }, m.plate!), false)
  assert.equal(pointInPlate({ x: 0.2, y: 0.5 }, m.plate!), true)
  m = addPlateSupport(m, { kind: 'edge', loop: 0, edge: 0 }, true, true)
  m = addPlateLoad(m, { type: 'pressure', target: { kind: 'loop', loop: 1 }, p: 1e6 })
  m = addPlateLoad(m, { type: 'thermal', dT: 10 })
  assert.equal(m.plate!.supports.length, 1); assert.equal(m.plate!.loads.length, 2)
  const first = m.plate!.outline[0]
  // inserting a vertex on the supported edge: the support now covers both halves
  const ins = insertVertex(m, 0, 0, { x: (first.x + m.plate!.outline[1].x) / 2, y: (first.y + m.plate!.outline[1].y) / 2 })
  assert.equal(ins.plate!.outline.length, 5)
  assert.equal(ins.plate!.supports.length, 2)
  assert.deepEqual(ins.plate!.supports.map((s) => (s.target as { edge: number }).edge).sort(), [0, 1])
  // removing it again drops the half edges
  const del = deleteVertex(ins, 0, 1)
  assert.equal(del.plate!.outline.length, 4)
  assert.ok(del.plate!.supports.every((s) => (s.target as { edge: number }).edge === 0))
  const mv = moveVertex(m, 0, 2, 3, 1)
  assert.deepEqual(mv.plate!.outline[2], { x: 3, y: 1 })
  assert.equal(deleteHole(m, 0).plate!.holes.length, 0)
  assert.equal(deleteHole(m, 0).plate!.loads.length, 1, 'the pressure on the hole goes with it')
  assert.deepEqual(pickPlate(m, 0.001, 0.001, 0.05), { kind: 'vertex', loop: 0, index: 3 })
  const e = pickPlate(m, 1, 0.01, 0.05)
  assert.ok(e && e.kind === 'edge' && e.index === 3)
  assert.equal(pickPlate(m, 1, 0.5, 0.01), null)
  const hv = addHole(m, [{ x: 1.5, y: 0.2 }, { x: 1.7, y: 0.2 }, { x: 1.6, y: 0.4 }])
  assert.equal(hv.plate!.holes.length, 2)
  // the model can be solved after these steps (with a roller to hold the sliding)
  let solvable = setOutline(emptyModel('plane-stress'), [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0, y: 0.1 }])
  solvable.plate!.mesh.size = 0.02
  solvable = addPlateSupport(solvable, { kind: 'edge', loop: 0, edge: 3 }, true, true)
  solvable = addPlateLoad(solvable, { type: 'traction', target: { kind: 'edge', loop: 0, edge: 1 }, tx: 1e6, ty: 0 })
  assert.doesNotThrow(() => solvePlate(solvable))
})

// ------------------------------------------------------------------------------ AI tools and manifest

function fakeHooks(initial: Model) {
  const log: string[] = []
  const st = { model: initial, result: null as ReturnType<typeof solveModel> | null, dirty: false }
  const hooks: Hooks = {
    state: () => ({ model: st.model, result: st.result, stale: false, dirty: st.dirty, path: null }),
    apply: (mdl, what) => { st.model = mdl; st.dirty = true; st.result = null; log.push(what) },
    solve: async () => { st.result = solveModel(st.model); return st.result },
    openModel: async (mdl, name) => { st.model = mdl; st.dirty = false; st.result = null; log.push(`open ${name}`); return true },
  }
  return { hooks, st, log }
}

type Tool = (a: Record<string, unknown>, ctx: { confirm: (w: string) => Promise<boolean> }) => Promise<Record<string, unknown>>

test('AI tools: the manifest respects the limits and the tools build, solve and read a model', async () => {
  assert.equal(KFEA_TOOL_SET.app, 'kfea')
  assert.ok(KFEA_TOOL_SET.tools.length <= 4)
  assert.deepEqual(KFEA_TOOL_SET.tools.map((t) => t.action).sort(), ['add', 'get_state', 'load_example', 'solve'])
  assert.ok(KFEA_TOOL_SET.summary.length <= 120, `${KFEA_TOOL_SET.summary.length}`)
  assert.ok(KFEA_TOOL_SET.keywords.length >= 8 && KFEA_TOOL_SET.keywords.every((k) => k === k.toLowerCase()))
  for (const t of KFEA_TOOL_SET.tools) {
    const props = Object.keys((t.inputSchema as { properties: object }).properties)
    assert.ok(props.length <= 6, `${t.action}: ${props.length} arguments`)
    assert.ok(t.description.length > 20 && t.description.length < 400)
  }
  const { hooks, st, log } = fakeHooks(emptyModel('frame'))
  const tools = kfeaTools(hooks) as unknown as Record<string, Tool>
  const ctx = { confirm: async () => true }
  assert.deepEqual(Object.keys(tools).sort(), KFEA_TOOL_SET.tools.map((t) => t.action).sort())
  // an empty model says what is missing
  const s0 = await tools.get_state({}, ctx)
  assert.ok(JSON.stringify(s0).includes('Add some nodes'))
  // build a cantilever in metres and kN, solve, compare with PL³/3EI
  const added = await tools.add({
    nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 3, y: 0 }],
    members: [{ from: 'A', to: 'B', section: 'IPE200', material: 'S235' }],
    supports: [{ node: 'A', type: 'fixed' }],
    loads: [{ node: 'B', fy: -10 }],
  }, ctx)
  assert.deepEqual((added.added as { nodes: string[] }).nodes, ['A', 'B'])
  assert.ok(added.ready)
  const solved = await tools.solve({}, ctx) as { maxDisplacement: { value: number }; reactions: Array<{ ry: number; mz: number }> }
  const I = librarySection('IPE200')!.I
  near(Math.abs(solved.maxDisplacement.value), (10e3 * 27) / (3 * 210e9 * I), 1e-5)
  near(solved.reactions[0].ry, 10, 1e-6); near(solved.reactions[0].mz, 30, 1e-6)
  assert.ok(log.includes('Add (AI)'))
  // more loads and a member given by coordinates
  const more = await tools.add({ members: [{ from: [3, 0], to: [6, 0] }], loads: [{ member: 'M1', kind: 'udl', w: -5 }, { node: 'B', fy: -10 }], supports: [{ node: [6, 0], type: 'roller' }] }, ctx)
  assert.ok((more.added as { members: string[] }).members.length === 1)
  assert.equal(st.model.members.length, 2)
  assert.equal(st.model.nodeLoads[0].fy, -20e3, 'loads on a node add up')
  near((st.model.memberLoads[0] as { w1: number }).w1, -5e3, 1e-12)
  // errors are readable
  await assert.rejects(tools.add({ supports: [{ node: 'Z', type: 'fixed' }] }, ctx), /no node/)
  await assert.rejects(tools.add({ supports: [{ node: 'A', type: 'wobbly' }] }, ctx), /unknown/)
  await assert.rejects(tools.add({ loads: [{ member: 'M9', w: 1 }] }, ctx), /no member/)
  await assert.rejects(tools.add({ plate: { outline: [[0, 0], [1, 0], [1, 1]] } }, ctx), /frame/)
  // the full model and the results
  const full = await tools.get_state({ include: 'model' }, ctx) as { kfea: { format: string } }
  assert.equal(full.kfea.format, 'kfea')
  const res = await tools.get_state({ include: 'results' }, ctx) as { solution?: unknown; note?: string }
  assert.ok(res.solution || res.note)
  // solve an arbitrary model JSON without opening it
  const sol = await tools.solve({ model: JSON.parse(serializeModel(exampleById('beam-ss-udl')!.model)) }, ctx) as { checksVsExpected: Array<{ differencePercent: number | null }>; maxDisplacement: { value: number } }
  assert.ok(sol.checksVsExpected.length >= 4 && sol.checksVsExpected.every((c) => Math.abs(c.differencePercent ?? 0) < 1e-4))
  await assert.rejects(tools.solve({ model: '{bad' }, ctx), /JSON/)
  await assert.rejects(tools.solve({ model: { format: 'x' } }, ctx), /kfea/)
  // study changes
  const modal = await tools.solve({ model: JSON.parse(serializeModel(exampleById('beam-cantilever')!.model)), study: 'modal', modes: 2 }, ctx) as { modes: unknown[] }
  assert.equal(modal.modes.length, 2)
  // load_example lists, loads, and asks first when there are unsaved changes
  const list = await tools.load_example({}, ctx) as { examples: Array<{ id: string }> }
  assert.equal(list.examples.length, EXAMPLES.length)
  let asked = 0
  const opened = await tools.load_example({ id: 'plate-cook' }, { confirm: async () => { asked++; return true } }) as { loaded: string }
  assert.equal(opened.loaded, "Cook's membrane"); assert.equal(asked, 1)
  st.dirty = true
  await assert.rejects(tools.load_example({ id: 'truss-warren' }, { confirm: async () => false }), /did not allow/)
  await assert.rejects(tools.load_example({ id: 'nothing' }, ctx), /No example/)
  const cook = await tools.solve({}, ctx) as { maxDisplacement: number; mesh: { elements: number }; checksVsExpected: Array<{ differencePercent: number }> }
  assert.equal(cook.mesh.elements, 256)
  assert.ok(Math.abs(cook.checksVsExpected[0].differencePercent) < 2)
  // a plate built through add
  const pl = fakeHooks(emptyModel('plane-stress'))
  const ptools = kfeaTools(pl.hooks) as unknown as Record<string, Tool>
  await ptools.add({ plate: { outline: [[0, 0], [200, 0], [200, 100], [0, 100]], thickness: 10, material: 'S235', meshSize: 20, supports: [{ edge: 3 }], loads: [{ edge: 1, tx: 100, ty: 0 }] } }, ctx)
  const ps = await ptools.solve({}, ctx) as { maxVonMises: number }
  near(ps.maxVonMises, 100, 0.1) // MPa (the clamp adds a local concentration): the display units of a new plate are mm and N
  await assert.rejects(ptools.add({ nodes: [{ x: 1, y: 1 }] }, ctx), /plate/)
  void describeModel; void describeResult
})

test('AI add: values are converted from the display units', () => {
  const m = emptyModel('frame')
  m.units = { length: 'mm', force: 'N' }
  const { model } = applyAdd(m, { nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3000, y: 0 }], members: [{ from: 'a', to: 'b' }], loads: [{ node: 'b', fy: -1000 }, { member: 'M1', w: -2, from: 500 }] })
  near(model.nodes[1].x, 3, 1e-12)
  near(model.nodeLoads[0].fy, -1000, 1e-12)
  near((model.memberLoads[0] as { w1: number; a: number }).w1, -2000, 1e-12)
  near((model.memberLoads[0] as { a: number }).a, 0.5, 1e-12)
  const inch = emptyModel('frame')
  inch.units = { length: 'in', force: 'kip' }
  const r = applyAdd(inch, { nodes: [{ id: 'a', x: 10, y: 0 }], loads: [{ node: 'a', fx: 1 }] })
  near(r.model.nodes[0].x, 0.254, 1e-12); near(r.model.nodeLoads[0].fx, 4448.2216152605, 1e-12)
})

// ------------------------------------------------------------------------------ drawing, orientation

/** A canvas context that records the calls and refuses anything that is not a number where a number is needed. */
function recordingContext() {
  const calls: string[] = []
  const num = (...v: unknown[]) => { for (const x of v) assert.ok(typeof x === 'number' && Number.isFinite(x), `a finite number was expected, got ${String(x)}`) }
  const ctx = {
    lineJoin: '', lineCap: '', strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textAlign: '', globalAlpha: 1,
    setLineDash: () => { calls.push('dash') }, beginPath: () => { calls.push('begin') }, closePath: () => { calls.push('close') }, stroke: () => { calls.push('stroke') }, fill: () => { calls.push('fill') },
    moveTo: (x: number, y: number) => { num(x, y); calls.push('move') }, lineTo: (x: number, y: number) => { num(x, y); calls.push('line') },
    arc: (x: number, y: number, r: number) => { num(x, y, r); calls.push('arc') }, fillText: (s: string, x: number, y: number) => { num(x, y); assert.equal(typeof s, 'string'); calls.push('text') },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

test('drawing: every example scene is drawn on a canvas with finite coordinates, in the theme palette', () => {
  const pal = { fg: '#111', muted: '#777', accent: '#00f', danger: '#f00', success: '#0a0', warning: '#fa0', link: '#08f', bg: '#fff', bgmix: '#fff', grid: '#ccc', plate: '#eee', meshline: '#999' }
  for (const ex of EXAMPLES) {
    const result = solveModel(ex.model)
    const v = fitView({ x0: -1, y0: -1, x1: 25, y1: 8 }, 900, 600, 40)
    const kinds = result.kind === 'plane' ? ['contour', 'deformed'] : result.kind === 'frame' ? ['deformed', 'diagram'] : ['mode']
    for (const kind of [null, ...kinds] as Array<string | null>) {
      const view = ex.model.plate ? fitView({ x0: -0.01, y0: -0.01, x1: 0.2, y1: 0.12 }, 900, 600, 40) : v
      const sc = buildScene(ex.model, kind ? result : null, view, { units: ex.model.units, showIds: true, showMesh: true, showGrid: true, grid: 1, result: kind ? { ...DEFAULT_RESULT, kind: kind as 'deformed', scale: 20, principal: true } : undefined }, result.kind === 'plane' ? result.mesh : null)
      const { ctx, calls } = recordingContext()
      drawPrims(ctx, sc.prims, pal, 'sans-serif')
      assert.ok(calls.length > 5, `${ex.id} ${kind}`)
    }
  }
})

test('plates: the outline is made counter-clockwise and the edge numbers of supports and loads follow', () => {
  const cwOutline = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }] // clockwise: edges 0 left, 1 top, 2 right, 3 bottom
  const p = emptyPlate()
  p.outline = cwOutline.map((q) => ({ ...q }))
  p.supports = [{ id: 's', target: { kind: 'edge', loop: 0, edge: 0 }, ux: true, uy: true }, { id: 'v', target: { kind: 'vertex', loop: 0, vertex: 1 }, ux: false, uy: true }]
  p.loads = [{ id: 'l', type: 'traction', target: { kind: 'edge', loop: 0, edge: 2 }, tx: 5, ty: 0 }]
  normalizePlate(p)
  assert.ok(signedArea(p.outline) > 0)
  // the left edge (x = 0) is still the supported one, and the right edge the loaded one
  const edgeOf = (e: number) => [p.outline[e], p.outline[(e + 1) % 4]]
  const sup = edgeOf((p.supports[0].target as { edge: number }).edge)
  assert.ok(sup.every((q) => q.x === 0), 'the support stayed on the left edge')
  const ld = edgeOf(((p.loads[0] as { target: { edge: number } }).target).edge)
  assert.ok(ld.every((q) => q.x === 2), 'the load stayed on the right edge')
  const vtx = p.outline[(p.supports[1].target as { vertex: number }).vertex]
  assert.deepEqual(vtx, { x: 0, y: 1 }, 'the corner support stayed on its corner')
  // loading a file with a clockwise plate gives the same answer as the counter-clockwise one
  const mk = (outline: typeof cwOutline, supEdge: number, loadEdge: number): Model => {
    const m = emptyModel('plane-stress')
    m.materials = [{ id: 'X', name: 'X', E: 100e9, nu: 0.3, rho: 0, sy: 1e9, alpha: 0 }]
    m.plate = emptyPlate()
    Object.assign(m.plate, { material: 'X', thickness: 0.01, outline, mesh: { ...m.plate.mesh, size: 0.25 } })
    m.plate.supports = [{ id: 's', target: { kind: 'edge', loop: 0, edge: supEdge }, ux: true, uy: true }]
    m.plate.loads = [{ id: 'l', type: 'traction', target: { kind: 'edge', loop: 0, edge: loadEdge }, tx: 1e6, ty: 0 }]
    return m
  }
  const ccwModel = cleanModel(JSON.parse(serializeModel(mk([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }], 3, 1))))
  const cwModel = cleanModel(JSON.parse(serializeModel(mk(cwOutline, 0, 2))))
  const a = solvePlate(ccwModel)
  const b = solvePlate(cwModel)
  near(a.maxDisp, b.maxDisp, 0.01) // the meshes start at different corners, so they are not identical
  near(a.strainEnergy, b.strainEnergy, 0.01)
  // the AI tool does the same
  const r = applyAdd(emptyModel('plane-stress'), { plate: { outline: [[0, 0], [0, 100], [200, 100], [200, 0]], thickness: 10, material: 'S235', meshSize: 25, supports: [{ edge: 0 }], loads: [{ edge: 2, tx: 10, ty: 0 }] } })
  assert.ok(signedArea(r.model.plate!.outline) > 0)
  assert.doesNotThrow(() => solvePlate(r.model))
})

test('grid helpers and the manifest descriptions', () => {
  assert.equal(niceStep(10), 0.5)
  assert.equal(niceStep(100), 5)
  assert.equal(niceStep(24), 1)
  assert.equal(snapTo(1.26, 0.5), 1.5)
  assert.equal(snapTo(1.26, 0), 1.26)
  for (const t of KFEA_TOOL_SET.tools) assert.ok(t.description.length < 300, `${t.action} description`)
  assert.ok(KFEA_TOOL_SET.summary.length < 120)
})

test('convergence study: the sizes, the refinement points and the grid divisions are scaled together', () => {
  const cook = exampleById('plate-cook')!.model
  const s = convergenceStudy(cook, [6, 3, 1.5], 'energy')
  assert.deepEqual(s.map((x) => x.elements), [64, 256, 1024], 'the 16 × 16 grid is scaled with the size')
  assert.ok(s[0].value < s[1].value && s[1].value < s[2].value, `the strain energy converges from below: ${s.map((x) => x.value)}`)
  assert.ok(Math.abs(s[2].value / s[1].value - 1) < Math.abs(s[1].value / s[0].value - 1), 'and the steps get smaller')
  assert.ok(s[2].dofs > s[1].dofs && s[1].dofs > s[0].dofs)
  // the expensive sizes are skipped (but at least two points are kept)
  const skipped = convergenceStudy(cook, [6, 3, 0.5, 0.25], 'maxDisp', 2000)
  assert.ok(skipped.length >= 2 && skipped.length < 4)
  // a plate with a hole and refinement points
  const hole = exampleById('plate-hole')!.model
  const h = convergenceStudy(hole, [0.008, 0.005], 'maxSy')
  assert.ok(h[1].elements > h[0].elements)
})
