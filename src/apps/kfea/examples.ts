// The built-in examples of kFEA: classic textbook and benchmark problems with a closed-form or published answer.
// Every example carries its expected results in its description and as `checks` (a named quantity, the value, a
// tolerance): tools/tests/kfea.test.ts solves every one and compares. The models are plain data (the plates are
// meshed when they are solved).

import { emptyModel, emptyPlate, type Model, type Pt } from './model.ts'
import { libraryMaterial, type Material } from './materials.ts'
import { librarySection, makeSection, type Section } from './sections.ts'
import { fmt } from './units.ts'
import type { Check } from './solve.ts'

export interface Example {
  id: string
  title: string
  group: string
  description: string
  model: Model
  checks: Check[]
}

const mat = (id: string): Material => libraryMaterial(id)!
const sec = (id: string): Section => librarySection(id)!
const kN = 1000
const mm = 1e-3

/** Puts the library materials and sections that the model uses into it, and the expected values from the checks. */
function finish(m: Model, checks: Check[]): Model {
  const mats = new Set<string>(m.members.map((x) => x.material))
  if (m.plate) mats.add(m.plate.material)
  m.materials = m.materials.filter((x) => mats.has(x.id))
  for (const id of mats) if (!m.materials.some((x) => x.id === id)) m.materials.push(mat(id))
  const secs = new Set<string>(m.members.map((x) => x.section))
  m.sections = m.sections.filter((x) => secs.has(x.id))
  for (const id of secs) if (!m.sections.some((x) => x.id === id)) m.sections.push(sec(id))
  const e: Record<string, number> = {}
  for (const c of checks) if (!c.range) e[c.key] = c.value
  if (Object.keys(e).length) m.expected = e
  return m
}

function frame(name: string, description: string, analysis: Model['analysis']): Model {
  const m = emptyModel(analysis)
  m.name = name
  m.description = description
  m.units = { length: 'm', force: 'kN' }
  m.materials = []
  m.sections = []
  return m
}

const R = (n: number, d = 6) => Number(n.toFixed(d))

// ----------------------------------------------------------------------------- trusses

function simpleTruss(): Example {
  const P = 10 * kN
  const bar = sec('CIRC50')
  const E = mat('S235').E
  const L = [4, Math.hypot(2, 3), Math.hypot(2, 3)]
  const N = [P / 3, -(P * Math.hypot(2, 3)) / 6, -(P * Math.hypot(2, 3)) / 6]
  const desc0 = 'A triangular truss: pin at A, roller at B, 10 kN down at the apex C. '
  const m = frame('Simple truss (method of joints)', '', 'truss')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 4, y: 0 }, { id: 'C', x: 2, y: 3 }]
  m.members = [
    { id: 'AB', n1: 'A', n2: 'B', section: bar.id, material: 'S235' },
    { id: 'AC', n1: 'A', n2: 'C', section: bar.id, material: 'S235' },
    { id: 'BC', n1: 'B', n2: 'C', section: bar.id, material: 'S235' },
  ]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: false }, { id: 's2', node: 'B', ux: false, uy: true, rz: false }]
  m.nodeLoads = [{ id: 'l1', node: 'C', fx: 0, fy: -P, mz: 0 }]
  // virtual work: the deflection of C is Σ N² L / (P E A)
  const dC = N.reduce((s, n, i) => s + (n * n * L[i]) / (P * E * bar.A), 0)
  const checks: Check[] = [
    { key: 'ry:A', value: P / 2, tol: 1e-6 }, { key: 'ry:B', value: P / 2, tol: 1e-6 },
    { key: 'N:AB', value: N[0], tol: 1e-6 }, { key: 'N:AC', value: N[1], tol: 1e-6 }, { key: 'N:BC', value: N[2], tol: 1e-6 },
    { key: 'uy:C', value: -dC, tol: 1e-6 },
  ]
  m.description = `${desc0}Expected (method of joints): reactions 5 kN each; AB = +${fmt(N[0] / kN, 5)} kN (tension), AC = BC = ${fmt(N[1] / kN, 5)} kN (compression); the apex moves ${fmt(dC * 1000, 4)} mm down.`
  return { id: 'truss-simple', title: 'Simple truss', group: 'Trusses', description: m.description, model: finish(m, checks), checks }
}

function warrenTruss(): Example {
  const P = 100 * kN
  const h = 8 * Math.sin(Math.PI / 3)
  const m = frame('Warren truss bridge', '', 'truss')
  const bot = [0, 8, 16, 24]
  bot.forEach((x, i) => m.nodes.push({ id: `A${i}`, x, y: 0 }))
  ;[4, 12, 20].forEach((x, i) => m.nodes.push({ id: `U${i + 1}`, x, y: h }))
  const add = (id: string, a: string, b: string) => m.members.push({ id, n1: a, n2: b, section: 'TUBE114x6', material: 'S355' })
  add('b1', 'A0', 'A1'); add('b2', 'A1', 'A2'); add('b3', 'A2', 'A3')
  add('t1', 'U1', 'U2'); add('t2', 'U2', 'U3')
  add('d1', 'A0', 'U1'); add('d2', 'U1', 'A1'); add('d3', 'A1', 'U2'); add('d4', 'U2', 'A2'); add('d5', 'A2', 'U3'); add('d6', 'U3', 'A3')
  m.supports = [{ id: 's1', node: 'A0', ux: true, uy: true, rz: false }, { id: 's2', node: 'A3', ux: false, uy: true, rz: false }]
  m.nodeLoads = [{ id: 'l1', node: 'A1', fx: 0, fy: -P, mz: 0 }, { id: 'l2', node: 'A2', fx: 0, fy: -P, mz: 0 }]
  const dN = -P / Math.sin(Math.PI / 3)
  const checks: Check[] = [
    { key: 'ry:A0', value: P, tol: 1e-6 }, { key: 'ry:A3', value: P, tol: 1e-6 },
    { key: 'N:d1', value: dN, tol: 1e-6 }, { key: 'N:b1', value: -dN / 2, tol: 1e-6 }, { key: 'N:t1', value: dN, tol: 1e-6 },
    { key: 'N:b2', value: (P * 12 - P * 4) / h, tol: 1e-6 },
  ]
  m.description = `A 24 m Warren bridge truss of equilateral triangles (8 m sides), tubes 114.3×6 in S355, 100 kN at each lower joint. Expected: reactions 100 kN; end diagonals ${fmt(dN / kN, 5)} kN (compression), first bottom chord +${fmt(-dN / 2 / kN, 5)} kN, top chord ${fmt(dN / kN, 5)} kN, middle bottom chord +${fmt((P * 8) / h / kN, 5)} kN.`
  return { id: 'truss-warren', title: 'Warren truss bridge', group: 'Trusses', description: m.description, model: finish(m, checks), checks }
}

function prattTruss(): Example {
  const P = 100 * kN
  const m = frame('Pratt truss', '', 'truss')
  for (let i = 0; i <= 4; i++) m.nodes.push({ id: `B${i}`, x: 3 * i, y: 0 })
  for (let i = 0; i <= 4; i++) m.nodes.push({ id: `T${i}`, x: 3 * i, y: 3 })
  const add = (id: string, a: string, b: string) => m.members.push({ id, n1: a, n2: b, section: 'TUBE114x6', material: 'S235' })
  for (let i = 1; i <= 4; i++) add(`bb${i}`, `B${i - 1}`, `B${i}`)
  for (let i = 1; i <= 4; i++) add(`tt${i}`, `T${i - 1}`, `T${i}`)
  for (let i = 0; i <= 4; i++) add(`v${i}`, `B${i}`, `T${i}`)
  add('d1', 'T0', 'B1'); add('d2', 'T1', 'B2'); add('d3', 'T3', 'B2'); add('d4', 'T4', 'B3')
  m.supports = [{ id: 's1', node: 'B0', ux: true, uy: true, rz: false }, { id: 's2', node: 'B4', ux: false, uy: true, rz: false }]
  m.nodeLoads = [1, 2, 3].map((i) => ({ id: `l${i}`, node: `B${i}`, fx: 0, fy: -P, mz: 0 }))
  const checks: Check[] = [
    { key: 'ry:B0', value: 1.5 * P, tol: 1e-6 }, { key: 'ry:B4', value: 1.5 * P, tol: 1e-6 },
    { key: 'N:v0', value: -1.5 * P, tol: 1e-6 }, { key: 'N:d1', value: 1.5 * P * Math.SQRT2, tol: 1e-6 },
    { key: 'N:bb1', value: 0, tol: 0, abs: 1e-6 }, { key: 'N:bb2', value: 1.5 * P, tol: 1e-6 },
  ]
  m.description = `A Pratt truss, 4 panels of 3 m, 3 m deep, 100 kN at each lower joint. Expected: reactions 150 kN; end post ${fmt(-1.5 * P / kN, 4)} kN (compression), first diagonal +${fmt((1.5 * P * Math.SQRT2) / kN, 5)} kN, the first bottom chord is unloaded and the next one carries +${fmt(1.5 * P / kN, 4)} kN.`
  return { id: 'truss-pratt', title: 'Pratt truss', group: 'Trusses', description: m.description, model: finish(m, checks), checks }
}

// ----------------------------------------------------------------------------- beams

function cantilever(): Example {
  const L = 3
  const P = 10 * kN
  const s = sec('IPE200')
  const E = mat('S235').E
  const d = (P * L ** 3) / (3 * E * s.I)
  const m = frame('Cantilever beam with a tip load', '', 'beam')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: L, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: s.id, material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: true }]
  m.nodeLoads = [{ id: 'l1', node: 'B', fx: 0, fy: -P, mz: 0 }]
  const checks: Check[] = [
    { key: 'uy:B', value: -d, tol: 1e-6 }, { key: 'ry:A', value: P, tol: 1e-6 }, { key: 'mz:A', value: P * L, tol: 1e-6 },
    { key: 'rz:B', value: -(P * L * L) / (2 * E * s.I), tol: 1e-6 }, { key: 'Mmax:M1', value: P * L, tol: 1e-6 },
  ]
  m.description = `IPE 200 in S235, 3 m long, fixed at A, 10 kN down at the tip. Expected: tip deflection PL³/3EI = ${fmt(d * 1000, 5)} mm, tip rotation PL²/2EI = ${fmt((P * L * L) / (2 * E * s.I), 4)} rad, fixed-end moment PL = 30 kN·m.`
  return { id: 'beam-cantilever', title: 'Cantilever beam with a tip load', group: 'Beams', description: m.description, model: finish(m, checks), checks }
}

function simplySupported(): Example {
  const L = 6
  const w = 12 * kN
  const s = sec('IPE240')
  const E = mat('S235').E
  const d = (5 * w * L ** 4) / (384 * E * s.I)
  const m = frame('Simply supported beam with a uniform load', '', 'beam')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: L, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: s.id, material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: false }, { id: 's2', node: 'B', ux: false, uy: true, rz: false }]
  m.memberLoads = [{ id: 'q1', member: 'M1', type: 'dist', dir: 'y', w1: -w, w2: -w }]
  const checks: Check[] = [
    { key: 'v:M1@0.5', value: -d, tol: 1e-6 }, { key: 'Mmax:M1', value: (w * L * L) / 8, tol: 1e-6 },
    { key: 'ry:A', value: (w * L) / 2, tol: 1e-6 }, { key: 'Vmax:M1', value: (w * L) / 2, tol: 1e-6 },
    { key: 'rz:A', value: -(w * L ** 3) / (24 * E * s.I), tol: 1e-6 },
  ]
  m.description = `IPE 240 in S235, 6 m span, 12 kN/m. Expected: midspan deflection 5wL⁴/384EI = ${fmt(d * 1000, 5)} mm, maximum moment wL²/8 = 54 kN·m, reactions 36 kN, end rotation wL³/24EI = ${fmt((w * L ** 3) / (24 * E * s.I), 4)} rad.`
  return { id: 'beam-ss-udl', title: 'Simply supported beam, uniform load', group: 'Beams', description: m.description, model: finish(m, checks), checks }
}

function proppedCantilever(): Example {
  const L = 5
  const w = 10 * kN
  const s = sec('IPE200')
  const E = mat('S235').E
  const m = frame('Propped cantilever', '', 'beam')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: L, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: s.id, material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: true }, { id: 's2', node: 'B', ux: false, uy: true, rz: false }]
  m.memberLoads = [{ id: 'q1', member: 'M1', type: 'dist', dir: 'y', w1: -w, w2: -w }]
  const mid = (w * L ** 4) / (192 * E * s.I)
  const checks: Check[] = [
    { key: 'ry:B', value: (3 * w * L) / 8, tol: 1e-6 }, { key: 'ry:A', value: (5 * w * L) / 8, tol: 1e-6 }, { key: 'mz:A', value: (w * L * L) / 8, tol: 1e-6 },
    { key: 'v:M1@0.5', value: -mid, tol: 1e-6 },
  ]
  m.description = `IPE 200, 5 m, fixed at A and a roller at B, 10 kN/m. Expected: R_B = 3wL/8 = 18.75 kN, R_A = 5wL/8 = 31.25 kN, fixed-end moment wL²/8 = 31.25 kN·m, midspan deflection wL⁴/192EI = ${fmt(mid * 1000, 5)} mm.`
  return { id: 'beam-propped', title: 'Propped cantilever', group: 'Beams', description: m.description, model: finish(m, checks), checks }
}

function continuousBeam(): Example {
  const L = 4
  const w = 15 * kN
  const s = sec('IPE240')
  const m = frame('Two-span continuous beam', '', 'beam')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: L, y: 0 }, { id: 'C', x: 2 * L, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: s.id, material: 'S235' }, { id: 'M2', n1: 'B', n2: 'C', section: s.id, material: 'S235' }]
  m.supports = [
    { id: 's1', node: 'A', ux: true, uy: true, rz: false }, { id: 's2', node: 'B', ux: false, uy: true, rz: false }, { id: 's3', node: 'C', ux: false, uy: true, rz: false },
  ]
  m.memberLoads = [
    { id: 'q1', member: 'M1', type: 'dist', dir: 'y', w1: -w, w2: -w }, { id: 'q2', member: 'M2', type: 'dist', dir: 'y', w1: -w, w2: -w },
  ]
  const checks: Check[] = [
    { key: 'ry:B', value: (5 * w * L) / 4, tol: 1e-6 }, { key: 'ry:A', value: (3 * w * L) / 8, tol: 1e-6 }, { key: 'ry:C', value: (3 * w * L) / 8, tol: 1e-6 },
    { key: 'M:M1@1', value: -(w * L * L) / 8, tol: 1e-6 },
  ]
  m.description = 'IPE 240, two equal spans of 4 m, 15 kN/m on both. Expected (three-moment equation): R_B = 5wL/4 = 75 kN, R_A = R_C = 3wL/8 = 22.5 kN, hogging moment over the middle support wL²/8 = 30 kN·m.'
  return { id: 'beam-continuous', title: 'Two-span continuous beam', group: 'Beams', description: m.description, model: finish(m, checks), checks }
}

// ----------------------------------------------------------------------------- frames

function portalFrame(): Example {
  const H = 20 * kN
  const h = 4
  const L = 6
  const col = sec('HEA200')
  const beam = sec('IPE300')
  const E = mat('S235').E
  const k = (beam.I / L) / (col.I / h)
  const sway = (H * h ** 3 * (1 + 1.5 * k)) / (6 * E * col.I * (1 + 6 * k))
  const m = frame('Portal frame under lateral load', '', 'frame')
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: h }, { id: 'C', x: L, y: h }, { id: 'D', x: L, y: 0 }]
  m.members = [
    { id: 'c1', n1: 'A', n2: 'B', section: col.id, material: 'S235' }, { id: 'bm', n1: 'B', n2: 'C', section: beam.id, material: 'S235' }, { id: 'c2', n1: 'D', n2: 'C', section: col.id, material: 'S235' },
  ]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: true }, { id: 's2', node: 'D', ux: true, uy: true, rz: true }]
  m.nodeLoads = [{ id: 'l1', node: 'B', fx: H, fy: 0, mz: 0 }]
  const checks: Check[] = [
    { key: 'ux:B', value: sway, tol: 1e-2 }, { key: 'ux:C', value: sway, tol: 1e-2 }, { key: 'rx:A', value: -H / 2, tol: 1e-2 }, { key: 'rx:D', value: -H / 2, tol: 1e-2 },
  ]
  m.description = `Fixed-base portal frame, columns HEA 200 (4 m), beam IPE 300 (6 m), 20 kN horizontal at the left corner. Expected (slope-deflection, axial strains neglected, so the solver agrees within 1 %): each base takes 10 kN, sway Δ = H h³ (1 + 1.5k) / (6 E Ic (1 + 6k)) = ${fmt(sway * 1000, 5)} mm with k = (Ib/L)/(Ic/h) = ${fmt(k, 4)}.`
  return { id: 'frame-portal', title: 'Portal frame under lateral load', group: 'Frames', description: m.description, model: finish(m, checks), checks }
}

function bracketFrame(): Example {
  const P = 5 * kN
  const m = frame('Cantilever bracket frame', '', 'frame')
  m.nodes = [{ id: 'A', x: 0, y: 1.2 }, { id: 'B', x: 1.5, y: 1.2 }, { id: 'D', x: 2.5, y: 1.2 }, { id: 'C', x: 0, y: 0 }]
  m.members = [
    { id: 'arm1', n1: 'A', n2: 'B', section: 'IPE160', material: 'S235' }, { id: 'arm2', n1: 'B', n2: 'D', section: 'IPE160', material: 'S235' },
    { id: 'brace', n1: 'C', n2: 'B', section: 'TUBE60x4', material: 'S235', releaseStart: true, releaseEnd: true },
  ]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: false }, { id: 's2', node: 'C', ux: true, uy: true, rz: false }]
  m.nodeLoads = [{ id: 'l1', node: 'D', fx: 0, fy: -P, mz: 0 }]
  const vb = (P * 2.5) / 1.5
  const lb = Math.hypot(1.5, 1.2)
  const checks: Check[] = [
    { key: 'N:brace', value: -(vb * lb) / 1.2, tol: 1e-6 }, { key: 'rx:A', value: -(vb * 1.5) / 1.2, tol: 1e-6 }, { key: 'ry:A', value: P - vb, tol: 1e-6 },
    { key: 'M:arm1@1', value: -P * 1, tol: 1e-6 }, { key: 'N:arm1', value: (vb * 1.5) / 1.2, tol: 1e-6 },
  ]
  m.description = `A wall bracket: a continuous IPE 160 arm pinned at A and hung at B on a hinged tube brace from C; 5 kN down at the tip D, 1 m beyond B. Expected (statics): the brace carries ${fmt(-(vb * lb) / 1.2 / kN, 5)} kN (compression), the arm has a hogging moment of 5 kN·m at B and a tension of ${fmt((vb * 1.5) / 1.2 / kN, 5)} kN, the wall reaction at A is ${fmt(-(vb * 1.5) / 1.2 / kN, 5)} kN horizontally and ${fmt((P - vb) / kN, 5)} kN vertically.`
  return { id: 'frame-bracket', title: 'Cantilever bracket frame', group: 'Frames', description: m.description, model: finish(m, checks), checks }
}

function steppedBar(): Example {
  const P = 20 * kN
  const E = mat('S235').E
  const lens = [0.5, 0.4, 0.6]
  const sizes = [40, 30, 20]
  const m = frame('Stepped bar under axial load', '', 'frame')
  let x = 0
  m.nodes.push({ id: 'N0', x, y: 0 })
  lens.forEach((l, i) => { x += l; m.nodes.push({ id: `N${i + 1}`, x: R(x), y: 0 }) })
  m.sections = sizes.map((s) => makeSection(`SQ${s}`, `Square ${s}×${s} mm`, 'rect', { b: s * mm, h: s * mm }))
  lens.forEach((_, i) => m.members.push({ id: `s${i + 1}`, n1: `N${i}`, n2: `N${i + 1}`, section: `SQ${sizes[i]}`, material: 'S235' }))
  m.supports = [{ id: 's0', node: 'N0', ux: true, uy: true, rz: true }]
  m.nodeLoads = [{ id: 'l1', node: 'N3', fx: P, fy: 0, mz: 0 }]
  const delta = lens.reduce((s, l, i) => s + (P * l) / (E * (sizes[i] * mm) ** 2), 0)
  const checks: Check[] = [
    { key: 'ux:N3', value: delta, tol: 1e-6 }, { key: 'N:s1', value: P, tol: 1e-6 }, { key: 'N:s3', value: P, tol: 1e-6 }, { key: 'rx:N0', value: -P, tol: 1e-6 },
  ]
  m.description = `A bar of three squares (40, 30 and 20 mm, lengths 0.5, 0.4, 0.6 m) fixed at the left, 20 kN pull at the right end. Expected: the force is 20 kN in every part; the end moves Σ P L / (E A) = ${fmt(delta * 1000, 5)} mm. The stress is 12.5, 22.2 and 50 MPa.`
  return { id: 'bar-stepped', title: 'Stepped bar (axial)', group: 'Bars', description: m.description, model: finish(m, checks), checks }
}

function thermalBar(): Example {
  const dT = 40
  const s = makeSection('SQ50', 'Square 50×50 mm', 'rect', { b: 50 * mm, h: 50 * mm })
  const { E, alpha } = mat('S235')
  const m = frame('Heated bar between two walls', '', 'frame')
  m.sections = [s]
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 2, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: 'SQ50', material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: true }, { id: 's2', node: 'B', ux: true, uy: true, rz: true }]
  m.memberLoads = [{ id: 't1', member: 'M1', type: 'thermal', dT, dTg: 0 }]
  const N = -E * s.A * alpha * dT
  const checks: Check[] = [{ key: 'N:M1', value: N, tol: 1e-6 }, { key: 'rx:A', value: -N, tol: 1e-6 }, { key: 'maxStress', value: E * alpha * dT, tol: 1e-6 }]
  m.description = `A 50×50 mm steel bar, 2 m long, fixed in two walls and heated by 40 K. Expected: it cannot expand, so it is compressed: N = −E A α ΔT = ${fmt(N / kN, 5)} kN, a stress of E α ΔT = ${fmt((E * alpha * dT) / 1e6, 4)} MPa.`
  return { id: 'bar-thermal', title: 'Heated bar between walls', group: 'Bars', description: m.description, model: finish(m, checks), checks }
}

// ----------------------------------------------------------------------------- dynamics and stability

function beamFrequency(): Example {
  const L = 1
  const s = makeSection('R20x40', 'Rectangle 20×40 mm', 'rect', { b: 20 * mm, h: 40 * mm })
  const { E, rho } = mat('S235')
  const w1 = 1.8751040687 ** 2 * Math.sqrt((E * s.I) / (rho * s.A * L ** 4))
  const m = frame('Cantilever natural frequency', '', 'beam')
  m.study = 'modal'
  m.sections = [s]
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: L, y: 0 }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: 'R20x40', material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: true }]
  m.units = { length: 'mm', force: 'N' }
  const checks: Check[] = [
    { key: 'omega1', value: w1, tol: 1e-4 }, { key: 'omega2', value: (4.6940911 / 1.8751040687) ** 2 * w1, tol: 1e-3 }, { key: 'freq1', value: w1 / (2 * Math.PI), tol: 1e-4 },
  ]
  m.description = `A steel cantilever, 1 m long, 20×40 mm (bending in the 40 mm direction). Expected: ω₁ = (1.875)² √(EI/ρAL⁴) = ${fmt(w1, 6)} rad/s = ${fmt(w1 / (2 * Math.PI), 5)} Hz; the second mode is (4.694/1.875)² = 6.267 times higher. Use Solve to see the mode shapes.`
  return { id: 'modal-cantilever', title: 'Cantilever natural frequency', group: 'Dynamics and stability', description: m.description, model: finish(m, checks), checks }
}

function eulerColumn(): Example {
  const L = 3
  const s = sec('HEA200')
  const E = mat('S235').E
  const Pcr = (Math.PI ** 2 * E * s.I) / L ** 2
  const m = frame('Euler column buckling', '', 'frame')
  m.study = 'buckling'
  m.nodes = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: L }]
  m.members = [{ id: 'M1', n1: 'A', n2: 'B', section: s.id, material: 'S235' }]
  m.supports = [{ id: 's1', node: 'A', ux: true, uy: true, rz: false }, { id: 's2', node: 'B', ux: true, uy: false, rz: false }]
  m.nodeLoads = [{ id: 'l1', node: 'B', fx: 0, fy: -1 * kN, mz: 0 }]
  const checks: Check[] = [{ key: 'lambda1', value: Pcr / kN, tol: 1e-3 }, { key: 'lambda2', value: (4 * Pcr) / kN, tol: 2e-3 }]
  m.description = `A pinned–pinned HEA 200 column, 3 m, loaded by 1 kN (the buckling factor is the critical load in kN). Expected: Euler P_cr = π² E I / L² = ${fmt(Pcr / kN, 6)} kN (weak-axis buckling is not modelled: the frame is 2-D, bending about the strong axis); the second mode is four times higher.`
  return { id: 'buckling-euler', title: 'Euler column buckling', group: 'Dynamics and stability', description: m.description, model: finish(m, checks), checks }
}

// ----------------------------------------------------------------------------- plates

/** The quarter of a rectangular plate with a circular hole at the corner (symmetry on the two straight edges). */
function holeQuarter(): Example {
  const a = 5 * mm
  const W = 50 * mm
  const H = 100 * mm
  const sigma = 100e6
  const arc: Pt[] = []
  for (let i = 0; i < 12; i++) arc.push({ x: a * Math.sin((i / 12) * (Math.PI / 2)), y: a * Math.cos((i / 12) * (Math.PI / 2)) })
  const m = emptyModel('plane-stress')
  m.name = 'Plate with a central hole in tension'
  m.units = { length: 'mm', force: 'N' }
  m.materials = []
  m.sections = []
  const p = emptyPlate()
  p.outline = [{ x: a, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }, ...arc]
  p.thickness = 10 * mm
  p.material = 'S235'
  p.mesh = { size: 5 * mm, type: 'tri', holeFactor: 1, refine: [{ x: a, y: 0, size: 0.4 * mm }, { x: 0, y: a, size: 1.2 * mm }], structured: false, smooth: 6 }
  p.supports = [
    { id: 'ps1', target: { kind: 'line', x1: a, y1: 0, x2: W, y2: 0 }, ux: false, uy: true },
    { id: 'ps2', target: { kind: 'line', x1: 0, y1: a, x2: 0, y2: H }, ux: true, uy: false },
  ]
  p.loads = [{ id: 'pl1', type: 'traction', target: { kind: 'line', x1: 0, y1: H, x2: W, y2: H }, tx: 0, ty: sigma }]
  m.plate = p
  // Peterson (finite width): Ktn = 3 − 3.14 d/W + 3.667 (d/W)² − 1.527 (d/W)³ on the net section stress
  const r = (2 * a) / (2 * W)
  const ktn = 3 - 3.14 * r + 3.667 * r * r - 1.527 * r ** 3
  const smax = (ktn * sigma) / (1 - r)
  const checks: Check[] = [{ key: 'maxsy', value: smax, tol: 0.06 }]
  m.description = `A 100 × 200 mm steel plate (10 mm thick) with a 10 mm hole, 100 MPa tension. One quarter is modelled with symmetry supports. Expected: the stress at the hole edge is Kt σ with Kt ≈ 3 for a small hole (Kirsch); with the finite width (Peterson) σ_max = ${fmt(smax / 1e6, 4)} MPa = ${fmt(smax / sigma, 3)} σ. The mesh is refined at the edge of the hole (refinement points); the triangles give the peak within a few percent.`
  return { id: 'plate-hole', title: 'Plate with a central hole in tension', group: 'Plates', description: m.description, model: finish(m, checks), checks }
}

function lBracket(): Example {
  const t = 10 * mm
  const F = 2 * kN
  const r = 5
  const arc: Pt[] = []
  for (let i = 1; i < 8; i++) { const ang = (270 - (90 * i) / 8) * (Math.PI / 180); arc.push({ x: (30 + r + r * Math.cos(ang)) * mm, y: (30 + r + r * Math.sin(ang)) * mm }) }
  const m = emptyModel('plane-stress')
  m.name = 'L-bracket, inner corner stress concentration'
  m.units = { length: 'mm', force: 'N' }
  m.materials = []
  m.sections = []
  const p = emptyPlate()
  const pt = (x: number, y: number): Pt => ({ x: x * mm, y: y * mm })
  p.outline = [pt(0, 0), pt(100, 0), pt(100, 30), pt(35, 30), ...arc, pt(30, 35), pt(30, 100), pt(0, 100)]
  p.thickness = t
  p.material = 'AL6061'
  p.mesh = { size: 5 * mm, type: 'tri', holeFactor: 1, refine: [{ x: 32.5 * mm, y: 32.5 * mm, size: 0.8 * mm }], structured: false, smooth: 6 }
  p.supports = [{ id: 'ps1', target: { kind: 'line', x1: 0, y1: 100 * mm, x2: 30 * mm, y2: 100 * mm }, ux: true, uy: true }]
  p.loads = [{ id: 'pl1', type: 'edge-force', target: { kind: 'line', x1: 100 * mm, y1: 0, x2: 100 * mm, y2: 30 * mm }, fx: 0, fy: -F }]
  m.plate = p
  // the section through the vertical leg (x from 0 to 30 mm) carries F down (compression) and the moment F · (100 − 15) mm
  const Mom = F * 0.085
  const nominal = (6 * Mom) / (t * 0.03 ** 2) + F / (t * 0.03)
  const checks: Check[] = [{ key: 'maxvm', value: nominal, tol: 0, range: [1.2, 3.2] }]
  m.description = `An aluminium L-bracket, 10 mm thick, 30 mm wide legs, fixed at the top of the vertical leg, 2 kN down on the end of the horizontal leg. The inner corner has a 5 mm fillet. Expected: beam theory gives a nominal stress of ${fmt(nominal / 1e6, 4)} MPa in the vertical leg; the corner concentrates it, so the peak von Mises stress is expected to be about 1.5 to 2.5 times higher. Try the convergence study: without the fillet the peak would grow without limit.`
  return { id: 'plate-lbracket', title: 'L-bracket, inner corner', group: 'Plates', description: m.description, model: finish(m, checks), checks }
}

function cookMembrane(): Example {
  const m = emptyModel('plane-stress')
  m.name = "Cook's membrane"
  m.units = { length: 'm', force: 'N' }
  m.materials = [{ id: 'UNIT', name: 'Unit material (E = 1, ν = 1/3)', E: 1, nu: 1 / 3, rho: 0, sy: 1, alpha: 0 }]
  m.sections = []
  const p = emptyPlate()
  p.outline = [{ x: 0, y: 0 }, { x: 48, y: 44 }, { x: 48, y: 60 }, { x: 0, y: 44 }]
  p.thickness = 1
  p.material = 'UNIT'
  p.mesh = { size: 3, type: 'quad', holeFactor: 1, refine: [], structured: true, divisions: [16, 16], smooth: 0 }
  p.supports = [{ id: 'ps1', target: { kind: 'edge', loop: 0, edge: 3 }, ux: true, uy: true }]
  p.loads = [{ id: 'pl1', type: 'edge-force', target: { kind: 'edge', loop: 0, edge: 1 }, fx: 0, fy: 1 }]
  m.plate = p
  const checks: Check[] = [{ key: 'uy@48,52', value: 23.96, tol: 0.02 }]
  m.description = "The classic benchmark: a tapered panel clamped on the left, a total shear force of 1 on the right edge, E = 1, ν = 1/3, thickness 1. Expected: the vertical displacement at the middle of the loaded edge converges to 23.96 (this model: 16 × 16 bilinear quadrilaterals with incompatible modes, which are accurate in bending). With triangles the same answer needs a much finer mesh: switch the element type and compare."
  return { id: 'plate-cook', title: "Cook's membrane", group: 'Plates', description: m.description, model: finish(m, checks), checks }
}

function pressureCylinder(): Example {
  const a = 100 * mm
  const b = 200 * mm
  const p0 = 50e6
  const { E, nu } = mat('S235')
  const n = 24
  const m = emptyModel('plane-strain')
  m.name = 'Thick-walled cylinder under internal pressure'
  m.units = { length: 'mm', force: 'N' }
  m.materials = []
  m.sections = []
  const pl = emptyPlate()
  const outerMid: Pt[] = []
  const innerMid: Pt[] = []
  for (let i = 1; i < n; i++) outerMid.push({ x: b * Math.cos((i / n) * (Math.PI / 2)), y: b * Math.sin((i / n) * (Math.PI / 2)) })
  for (let i = 1; i < n; i++) innerMid.push({ x: a * Math.cos(((n - i) / n) * (Math.PI / 2)), y: a * Math.sin(((n - i) / n) * (Math.PI / 2)) })
  // counter-clockwise: (a,0) → (b,0), the outer arc up to (0,b), then (0,a) and the inner arc back down to (a,0)
  pl.outline = [{ x: a, y: 0 }, { x: b, y: 0 }, ...outerMid, { x: 0, y: b }, { x: 0, y: a }, ...innerMid]
  pl.thickness = 10 * mm
  pl.material = 'S235'
  pl.mesh = { size: 12 * mm, type: 'tri', holeFactor: 1, refine: [], structured: false, smooth: 6 }
  pl.supports = [
    { id: 'ps1', target: { kind: 'line', x1: a, y1: 0, x2: b, y2: 0 }, ux: false, uy: true },
    { id: 'ps2', target: { kind: 'line', x1: 0, y1: a, x2: 0, y2: b }, ux: true, uy: false },
  ]
  pl.loads = [{ id: 'pl1', type: 'pressure', target: { kind: 'circle', cx: 0, cy: 0, r: a }, p: p0 }]
  m.plate = pl
  const k = (a * a * p0) / (b * b - a * a)
  const ur = ((1 + nu) / E) * k * ((1 - 2 * nu) * a + (b * b) / a)
  const hoop = k * (1 + (b * b) / (a * a))
  const checks: Check[] = [
    { key: 'ux@0.1,0', value: ur, tol: 0.02 }, { key: 'sy@0.1,0', value: hoop, tol: 0.04 }, { key: 'sy@0.2,0', value: 2 * k, tol: 0.05 },
  ]
  m.description = `A long steel cylinder (inner radius 100 mm, outer 200 mm) under 50 MPa internal pressure, plane strain, one quarter with symmetry supports. Expected (Lamé): hoop stress at the bore σθ = p (b²+a²)/(b²−a²) = ${fmt(hoop / 1e6, 5)} MPa, outer-surface hoop stress ${fmt((2 * k) / 1e6, 4)} MPa, radial displacement of the bore u = ${fmt(ur * 1000, 5)} mm.`
  return { id: 'plate-cylinder', title: 'Thick-walled cylinder (Lamé)', group: 'Plates', description: m.description, model: finish(m, checks), checks }
}

export const EXAMPLES: Example[] = [
  simpleTruss(), warrenTruss(), prattTruss(),
  cantilever(), simplySupported(), proppedCantilever(), continuousBeam(),
  portalFrame(), bracketFrame(),
  steppedBar(), thermalBar(),
  holeQuarter(), lBracket(), cookMembrane(), pressureCylinder(),
  beamFrequency(), eulerColumn(),
]

export function exampleById(id: string): Example | undefined {
  const key = id.trim().toLowerCase()
  return EXAMPLES.find((e) => e.id === key) ?? EXAMPLES.find((e) => e.title.toLowerCase().includes(key))
}
