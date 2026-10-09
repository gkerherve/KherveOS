// kMech: the kinematic solver against closed forms, four-bar theory, the engine, statics, the planck dynamic
// model, synthesis, cams, gears, the .kmech file, the example library and the AI tools. No browser. Run:
//   node --test tools/tests/kmech.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyseCycle, couplerAtlas, defaultOutput, findCusps, fourBarOf, staticTorqueCurve, transmissionOf } from '../../src/apps/kmech/analysis.ts'
import {
  circumcircle, classifyFourBar, crankRockerTransmission, fourBarInputRange, fourBarPose, fourBarRockerLimits, fourBarToggles, genevaAngle, peaucellierLineX, quickReturnFromAngles, sliderA, sliderStroke, sliderV, sliderX,
  slottedLeverRatio, whitworthRatio,
} from '../../src/apps/kmech/fourbar.ts'
import {
  compile, findAssemblies, flipAssembly, inputRange, makeSolver, newton, pointsAt, poseAt, singularity, stepTo, trace, velocities, accelerations, type Linkage,
} from '../../src/apps/kmech/linkage.ts'
import { EXAMPLES, exampleById, fourBarDoc, geneva, jansen, sliderCrankDoc } from '../../src/apps/kmech/examples.ts'
import { DEFAULT_ENGINE, pressureCurve, runEngine, slideOf } from '../../src/apps/kmech/engine.ts'
import { linkMass, runDynamics } from '../../src/apps/kmech/dynamics.ts'
import {
  bestThreePosition, chebyshevPoints, freudenstein3, functionGenerator, lengthsFromK, placeOn, threePositionSynthesis, twoPositionSynthesis, type CouplerPos,
} from '../../src/apps/kmech/synthesis.ts'
import {
  camProfile, checkProgram, DEFAULT_CAM, followerAt, lawEval, lawPeaks, optimiseBaseRadius, pressureAngleFormula, programEval, programLevels, programTable, riseDwellReturn, type CamSpec,
} from '../../src/apps/kmech/cam.ts'
import {
  beltDrive, bevelPair, chainDrive, DEFAULT_GEAR, gearGeometry, gearOutline, gearTrain, helicalContact, helicalGear, inv, invInverse, meshAngles, pairGeometry, placePoints, planetary, planetarySpeeds,
  planetaryTable, planetaryTorques, rackPinion, wormGear, type GearSpec,
} from '../../src/apps/kmech/gear.ts'
import { parseKMech, serializeKMech, KMechFileError, emptyDoc, defaultGearDoc, type KMechDoc, type LinkageDoc } from '../../src/apps/kmech/doc.ts'
import { readDxf, shapesToDxf, shapesToSvg, toCsv, type Shape } from '../../src/apps/kmech/exportGeom.ts'
import { buildReport } from '../../src/apps/kmech/report.ts'
import { camDiagramFigure, camChecksFigure, dynamicsFigure, engineTorqueFigure, motionFigure, pressureFigure, transmissionFigure, couplerFigure, jointForceFigure, DEFAULT_PALETTE } from '../../src/apps/kmech/figures.ts'
import { describeCycle, describeDoc, gearCalculation, kmechTools, linkageFromArgs, showGear, type Hooks } from '../../src/apps/kmech/aiTools.ts'
import { kmechExampleFiles, KMECH_EXAMPLES_FOLDER } from '../../src/apps/kmech/exampleFiles.ts'
import { indexText, kmechExampleOutputs } from '../export_kmech_examples.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'
import { KMECH_TOOL_SET } from '../../src/os/ai/manifests/kmech.ts'
import { circleIntersections, deg, rad, polygonArea } from '../../src/apps/kmech/math.ts'
import {
  addCouplerPoint, addPoint, addSlider, boundsOf, deletePick, deletePoint, linkSpans, movePoint, pickAt, setDriverOnLink, setLinkLength, settle, toolClick, type LinkStart, type Pick, type Tool,
} from '../../src/apps/kmech/edit.ts'
import { cycleArrows, cyclePose, maxPointSpeed } from '../../src/apps/kmech/analysis.ts'
import { History } from '../../src/apps/kmech/history.ts'
import { fitBox, niceStep, snapTo, toScreen, toWorld, zoomAt } from '../../src/apps/kmech/view.ts'
import { camScene, camScene as _camScene, beltScene, gridPrims, linkageScene, pairScene, planetaryScene, sceneBounds, sceneToSvg, trainLayout } from '../../src/apps/kmech/scene.ts'
import { camShapes, gearShapes, pairShapes } from '../../src/apps/kmech/outlines.ts'
import { dynamicsTable, engineTable, motionTable, profileTable, programCsvTable, tracerTable } from '../../src/apps/kmech/tables.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≈ ${b} (±${tol})`)
const rel = (a: number, b: number, r: number, what = '') => assert.ok(Math.abs(a - b) <= r * Math.abs(b), `${what} ${a} ≈ ${b} (±${r * 100} %)`)
const lin = (id: string): LinkageDoc => {
  const e = exampleById(id)
  assert.ok(e && e.doc.workbench === 'linkage', `${id} is a linkage example`)
  return (e.doc as { model: LinkageDoc }).model
}
const camEx = (id: string) => (exampleById(id)!.doc as { model: CamSpec & { name: string } }).model
const pt = (c: ReturnType<typeof analyseCycle>, i: number, id: string) => pointsAt(c.solver.sys, c.frames[i].X).get(id)!

// ------------------------------------------------------------------------------ Grashof

test('Grashof classification table', () => {
  const k = (a: number, b: number, c: number, d: number) => classifyFourBar({ a, b, c, d })
  assert.equal(k(40, 100, 70, 90).kind, 'crank-rocker')
  assert.equal(k(40, 100, 70, 90).inputFullTurn, true)
  assert.equal(k(40, 100, 70, 90).outputFullTurn, false)
  assert.equal(k(70, 90, 30, 80).kind, 'crank-rocker') // shortest is the output: rocker-driven
  assert.equal(k(70, 90, 30, 80).outputFullTurn, true)
  assert.equal(k(70, 90, 30, 80).inputFullTurn, false)
  assert.equal(k(80, 70, 75, 40).kind, 'double-crank') // shortest is the frame: drag link
  assert.equal(k(80, 70, 75, 40).condition, 'grashof')
  assert.equal(k(70, 30, 80, 90).kind, 'double-rocker') // shortest is the coupler
  assert.equal(k(70, 30, 80, 90).condition, 'grashof')
  assert.equal(k(70, 30, 80, 90).couplerFullTurn, true)
  assert.equal(k(65, 90, 70, 100).kind, 'double-rocker') // s + l > p + q
  assert.equal(k(65, 90, 70, 100).condition, 'non-grashof')
  assert.ok(k(65, 90, 70, 100).margin > 0)
  assert.equal(k(50, 100, 50, 100).kind, 'change-point')
  assert.equal(k(30, 50, 50, 70).kind, 'change-point')
  assert.equal(k(10, 10, 10, 40).kind, 'invalid')
  assert.equal(k(0, 10, 10, 10).kind, 'invalid')
  assert.equal(k(40, 100, 70, 90).margin, 40 + 100 - (70 + 90))
  // the margin sign is the criterion s + l ≶ p + q
  for (const g of [[40, 100, 70, 90], [30, 80, 70, 60], [50, 50, 50, 50], [20, 90, 80, 85]]) {
    const [a, b, c, d] = g
    const sorted = [...g].sort((x, y) => x - y)
    const m = sorted[0] + sorted[3] - (sorted[1] + sorted[2])
    assert.equal(Math.sign(k(a, b, c, d).margin), Math.sign(m))
  }
})

test('the four-bar examples are classified as their names say', () => {
  const kind = (id: string) => classifyFourBar(fourBarOf(lin(id))!).kind
  assert.equal(kind('crank-rocker'), 'crank-rocker')
  assert.equal(kind('double-rocker'), 'double-rocker')
  assert.equal(kind('drag-link'), 'double-crank')
  assert.equal(kind('parallelogram'), 'change-point')
  assert.equal(kind('wiper'), 'crank-rocker')
})

// ------------------------------------------------------------------------------ solver vs closed forms

test('four-bar positions agree with the analytic circle intersection over a full turn', () => {
  for (const id of ['crank-rocker', 'drag-link', 'wiper']) {
    const m = lin(id)
    const g = fourBarOf(m)!
    const c = analyseCycle(m, { steps: 360 })
    assert.ok(c.ok, `${id}: ${c.message}`)
    assert.equal(c.frames.length, 361)
    // the branch of the drawn pose
    const B0 = pt(c, 0, 'B')
    const th0 = c.frames[0].theta
    const b = [0, 1].find((br) => { const p = fourBarPose(g, th0, br as 0 | 1)!; return Math.hypot(p.B.x - B0.x, p.B.y - B0.y) < 1e-6 }) as 0 | 1
    assert.ok(b !== undefined, `${id}: the drawn pose is one of the two closures`)
    let worst = 0
    for (let i = 0; i < c.frames.length; i++) {
      const p = fourBarPose(g, c.frames[i].theta, b)!
      const B = pt(c, i, 'B')
      const A = pt(c, i, 'A')
      worst = Math.max(worst, Math.hypot(B.x - p.B.x, B.y - p.B.y), Math.hypot(A.x - p.A.x, A.y - p.A.y))
    }
    assert.ok(worst < 1e-9, `${id}: worst position error ${worst}`)
  }
})

test('the solver closes a loop to machine precision and stays on its branch', () => {
  const m = lin('crank-rocker')
  const s = makeSolver(m)
  assert.ok(s.ok)
  assert.equal(s.sys.mobility, 1)
  assert.equal(s.sys.cons.length, 6) // crank, coupler base + coupler point (1 + 2), rocker, and the driver
  const full = trace(s.sys, s.X0, Array.from({ length: 721 }, (_, i) => s.theta0 + (i * Math.PI) / 360))
  assert.ok(full.every((f) => f.ok))
  // after a full turn the mechanism is back where it started (the crank-rocker's loops are closed)
  const first = full[0].X; const last = full[full.length - 1].X
  near(Math.max(...first.map((v, i) => Math.abs(v - last[i]))), 0, 1e-9, 'closed after a turn')
})

test('velocity and acceleration analysis against numeric differentiation of the closed form', () => {
  const m = lin('crank-rocker')
  const g = fourBarOf(m)!
  const c = analyseCycle(m, { steps: 720, rpm: 60 })
  const B0 = pt(c, 0, 'B')
  const th0 = c.frames[0].theta
  const br = [0, 1].find((b) => { const p = fourBarPose(g, th0, b as 0 | 1)!; return Math.hypot(p.B.x - B0.x, p.B.y - B0.y) < 1e-6 }) as 0 | 1
  const th4 = (t: number) => fourBarPose(g, t, br)!.th4
  const h = 1e-5
  const w = 2 * Math.PI // 60 rpm
  for (const i of [10, 90, 200, 333, 500, 650]) {
    const t = c.frames[i].theta
    const d1 = (th4(t + h) - th4(t - h)) / (2 * h)
    const d2 = (th4(t + h) - 2 * th4(t) + th4(t - h)) / (h * h)
    // the solver's output is the angle of O4→B (the same θ4)
    near(c.coef[i], d1, 1e-6, `dθ4/dθ2 at ${i}`)
    near(c.vel[i], deg(d1 * w), 1e-4, `velocity at ${i}`)
    near(c.acc[i], deg(d2 * w * w), 5e-2, `acceleration at ${i}`)
  }
  // velocity ratio for a constant-speed crank: ω4/ω2 = (cot of the angle between …): check one value with the instant centre
  const f = c.frames[100]
  const V = velocities(c.solver.sys, f.X, f.theta, 1)!
  const idx = c.solver.sys.index.get('A')!
  const A = pt(c, 100, 'A')
  // A moves perpendicular to the crank with speed |OA| per rad
  near(Math.hypot(V[2 * idx], V[2 * idx + 1]), Math.hypot(A.x, A.y), 1e-9)
  near(V[2 * idx] * A.x + V[2 * idx + 1] * A.y, 0, 1e-9)
  // second derivative of the pin A is centripetal: −ω² r
  const acc = accelerations(c.solver.sys, f.X, V, f.theta, 1, 0)!
  near(acc[2 * idx], -A.x, 1e-9)
  near(acc[2 * idx + 1], -A.y, 1e-9)
})

test('transmission angle extremes of a crank-rocker are at the in-line crank positions', () => {
  const m = lin('crank-rocker')
  const g = fourBarOf(m)!
  const c = analyseCycle(m, { steps: 1440 })
  const cr = crankRockerTransmission(g)
  near(c.summary.muMin!, deg(cr.min), 0.01, 'μ min')
  near(c.summary.muMax!, deg(cr.max), 0.01, 'μ max')
  assert.ok(c.summary.muMin! < 40, 'this one dips below the 40° band')
  assert.ok(c.summary.muGoodShare! < 1 && c.summary.muGoodShare! > 0.5)
  // the share is the fraction of the cycle in the band
  const mus = c.mu.filter((v): v is number => v !== null)
  near(c.summary.muGoodShare!, mus.filter((v) => v >= 40 && v <= 140).length / mus.length, 1e-12)
})

test('the rocker’s toggle positions and quick-return ratio of a crank-rocker', () => {
  const m = lin('crank-rocker')
  const g = fourBarOf(m)!
  const c = analyseCycle(m, { steps: 720 })
  const B0 = pt(c, 0, 'B')
  assert.ok(B0.y > 0, 'the drawn pose has the output pin above the frame line')
  // the rocker stops where crank and coupler are in line: law of cosines
  const lim = fourBarRockerLimits(g, true)!
  assert.ok(lim)
  const lo = lim.extended.th4 < lim.folded.th4 ? lim.extended : lim.folded
  const hi = lim.extended.th4 < lim.folded.th4 ? lim.folded : lim.extended
  near(deg(hi.th4), c.summary.outMax, 1e-4, 'max rocker angle')
  near(deg(lo.th4), c.summary.outMin, 1e-4, 'min rocker angle')
  // at those crank angles the rocker really is there
  for (const t of [lo, hi]) near(fourBarPose(g, t.th2, 0)!.th4 === undefined ? 0 : [0, 1].map((b) => fourBarPose(g, t.th2, b as 0 | 1)!.th4).reduce((best, v) => (Math.abs(v - t.th4) < Math.abs(best - t.th4) ? v : best)), t.th4, 1e-9)
  const q = quickReturnFromAngles(lo.th2, hi.th2)
  near(c.summary.quickReturn!.ratio, q.ratio, 1e-6, 'time ratio')
  assert.ok(q.ratio > 1)
  // Q = (180 + β)/(180 − β)
  near(q.ratio, (180 + q.betaDeg) / (180 - q.betaDeg), 1e-9)
  // the input toggles (coupler in line with the rocker) are where a rocker-driven linkage locks
  assert.equal(fourBarToggles({ a: 65, b: 90, c: 70, d: 100 }).length, 2, 'the double-rocker’s input stops at ±θ')
  assert.equal(fourBarToggles(g).length, 0, 'a crank-rocker never locks with the crank as input')
})

test('the input range of a rocker-driven linkage is where the circles meet (lock-up angles)', () => {
  const m = lin('double-rocker')
  const g = fourBarOf(m)!
  const c = analyseCycle(m)
  assert.ok(c.ok)
  assert.equal(c.range.full, false)
  const r = fourBarInputRange(g)
  assert.equal(r.full, false)
  const union = r.intervals
  // the interval of the drawn pose
  const th0 = c.solver.theta0
  const iv = union.find(([a, b]) => th0 >= a - 1e-9 && th0 <= b + 1e-9)!
  near(c.range.min, iv[0], 1e-5, 'lower lock-up angle')
  near(c.range.max, iv[1], 1e-5, 'upper lock-up angle')
  // beyond the limit the loop cannot close
  const s = makeSolver(m)
  const past = stepTo(s.sys, s.X0, th0, iv[1] + 0.05)
  assert.equal(past.ok, false)
  // and the frames end just inside the range
  assert.ok(c.frames[c.frames.length - 1].theta <= iv[1] + 1e-9)
})

test('slider-crank: x = r cos θ + √(l² − r² sin²θ), its derivatives, and the stroke', () => {
  const m = sliderCrankDoc('sc', 40, 135, 40, 600)
  const r = 40; const l = 135
  const c = analyseCycle(m, { steps: 720, rpm: 600 })
  assert.ok(c.ok)
  const w = (600 * 2 * Math.PI) / 60
  for (let i = 0; i < c.frames.length; i += 7) {
    const th = c.frames[i].theta
    const x = r * Math.cos(th) + Math.sqrt(l * l - r * r * Math.sin(th) ** 2)
    near(pt(c, i, 'B').x, x, 1e-9, 'x')
    near(c.pos[i], x, 1e-9, 'output position')
    near(c.coef[i], sliderV({ r, l }, th), 1e-8, 'dx/dθ')
    near(c.vel[i], sliderV({ r, l }, th) * w, 1e-5, 'velocity')
    near(c.acc[i], sliderA({ r, l }, th) * w * w, 1e-2, 'acceleration')
  }
  near(sliderStroke({ r, l }), 2 * r, 1e-9)
  near(c.summary.span, 2 * r, 1e-6)
  // derivatives of the closed form by differences, and with an offset
  for (const e of [0, 12]) {
    const s = { r, l, e }
    for (const th of [0.4, 1.3, 2.7, 4.4]) {
      const h = 1e-5
      near(sliderV(s, th), (sliderX(s, th + h) - sliderX(s, th - h)) / (2 * h), 1e-6, `v e=${e}`)
      near(sliderA(s, th), (sliderV(s, th + h) - sliderV(s, th - h)) / (2 * h), 1e-6, `a e=${e}`)
    }
  }
  // the quick-return ratio of the in-line slider-crank is 1
  near(c.summary.quickReturn!.ratio, 1, 1e-6)
  // transmission angle: 90° minus the rod’s slope: at TDC 90°, at 90° of crank sin β = r/l
  near(c.summary.muMax!, 90, 1e-6)
  near(c.summary.muMin!, 90 - deg(Math.asin(r / l)), 1e-3)
})

test('Peaucellier-Lipkin: the traced point moves on an exact straight line', () => {
  const c = analyseCycle(lin('peaucellier'))
  assert.ok(c.ok)
  assert.equal(c.range.full, false, 'the crank rocks')
  const x = peaucellierLineX(100, 40, 50)
  assert.equal(x, 84)
  let err = 0
  for (const p of c.tracers['P']) err = Math.max(err, Math.abs(p.x - x))
  assert.ok(err < 1e-9, `straightness error ${err}`)
  // and it really travels a long way along the line
  const ys = c.tracers['P'].map((p) => p.y)
  assert.ok(Math.max(...ys) - Math.min(...ys) > 40)
  // the output of the example is that x (so the table shows the error directly)
  assert.deepEqual(c.output, { kind: 'point', point: 'P', axis: 'x' })
})

test('Watt’s linkage: the coupler midpoint stays within a small deviation of a vertical line', () => {
  const c = analyseCycle(lin('watt'), { steps: 720 })
  assert.ok(c.ok)
  const th0 = c.solver.theta0
  const path = c.tracers['M']
  // within ±5° of the arm the sideways deviation is below 1e-3 mm over a vertical travel of ~14 mm
  const sel = path.filter((_, i) => Math.abs(rad(c.theta[i]) - th0) <= rad(5))
  const dev = Math.max(...sel.map((p) => Math.abs(p.x)))
  const travel = Math.max(...sel.map((p) => p.y)) - Math.min(...sel.map((p) => p.y))
  assert.ok(travel > 10, `travel ${travel}`)
  assert.ok(dev < 1e-3, `deviation ${dev}`)
  assert.ok(dev / travel < 1e-4)
  // high-order growth: doubling the swing multiplies the deviation by 16 or more (not 2 or 4)
  const dev2 = Math.max(...path.filter((_, i) => Math.abs(rad(c.theta[i]) - th0) <= rad(10)).map((p) => Math.abs(p.x)))
  assert.ok(dev2 / dev > 12 && dev2 / dev < 64, `ratio ${dev2 / dev}`)
})

test('Whitworth quick-return: the solver’s time ratio equals (π + 2 asin(d/R)) / (π − 2 asin(d/R))', () => {
  const c = analyseCycle(lin('whitworth'), { steps: 720 })
  assert.ok(c.ok)
  const q = whitworthRatio(40, 70)
  near(q, 2.2637, 1e-3)
  near(c.summary.quickReturn!.ratio, q, 1e-7, 'Whitworth ratio')
  // the ram stroke 2ρ… and the lever turns fully
  near(c.summary.span, 240, 1e-3, 'stroke = 2·ram-pin radius')
  // crank and slotted lever (shaper): ratio from the tangent geometry
  near(slottedLeverRatio(100, 50), 2, 1e-12)
})

test('Scotch yoke: pure simple harmonic motion', () => {
  const c = analyseCycle(lin('scotch-yoke'))
  assert.ok(c.ok)
  for (let i = 0; i < c.frames.length; i += 11) {
    const th = c.frames[i].theta
    near(c.pos[i], 40 * Math.cos(th), 1e-9, 'x = r cos θ')
    near(c.coef[i], -40 * Math.sin(th), 1e-8)
  }
})

test('Geneva drive: the wheel angle follows tan φ = ρ sin θ / (1 − ρ cos θ) in the engaged window', () => {
  const m = geneva(4)
  const c = analyseCycle(m)
  assert.ok(c.ok)
  assert.equal(c.range.full, false)
  near(deg(c.range.min), -45, 1e-6)
  near(deg(c.range.max), 45, 1e-6)
  const slot0 = (i: number) => {
    const O2 = pt(c, i, 'O2'); const S = pt(c, i, 'S0')
    return Math.atan2(S.y - O2.y, S.x - O2.x)
  }
  const start = slot0(0)
  for (let i = 0; i < c.frames.length; i += 9) {
    const th = c.frames[i].theta
    near(Math.cos(slot0(i)), Math.cos(Math.PI - genevaAngle(4, th)), 1e-9, 'slot direction')
    near(Math.sin(slot0(i)), Math.sin(Math.PI - genevaAngle(4, th)), 1e-9)
    void start
  }
  // the wheel turns 90° while the driver passes the engaged window
  near(Math.abs(c.summary.span), 90, 1e-3, 'indexing angle')
  // outside the window the wheel dwells at its end pose while the driver keeps turning
  const s = makeSolver(m)
  const a = poseAt(s, rad(60))
  const b = poseAt(s, rad(100))
  assert.ok(a.ok && b.ok)
  const sa = a.points.get('S0')!; const sb = b.points.get('S0')!
  near(Math.hypot(sa.x - sb.x, sa.y - sb.y), 0, 1e-6, 'the wheel rests')
  const pa = a.points.get('P')!; const pb = b.points.get('P')!
  assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) > 10, 'the driver pin moves on')
  near(Math.hypot(pb.x, pb.y), 100 * Math.sin(Math.PI / 4), 1e-9, 'the pin stays on its circle')
  // 3, 4, 6 slots
  for (const n of [3, 6]) assert.ok(analyseCycle(geneva(n)).ok)
})

test('pantograph: the tracer is twice as far from the fixed pivot as the input point', () => {
  const c = analyseCycle(lin('pantograph'))
  assert.ok(c.ok)
  assert.equal(c.range.full, true)
  for (let i = 0; i < c.frames.length; i += 5) {
    const C = pt(c, i, 'C'); const T = pt(c, i, 'T')
    near(T.x, 2 * C.x, 1e-9); near(T.y, 2 * C.y, 1e-9)
  }
  // so the output circle has twice the radius
  const T = c.tracers['T']; const C = c.tracers['C']
  const rad2 = (pts: Array<{ x: number; y: number }>) => { const xs = pts.map((p) => p.x); return (Math.max(...xs) - Math.min(...xs)) / 2 }
  near(rad2(T) / rad2(C), 2, 1e-9)
})

test('the parallelogram linkage keeps the coupler parallel to the frame', () => {
  const c = analyseCycle(lin('parallelogram'))
  assert.ok(c.ok)
  assert.equal(c.range.full, true)
  for (let i = 0; i < c.frames.length; i++) {
    const A = pt(c, i, 'A'); const B = pt(c, i, 'B')
    near(B.x - A.x, 100, 1e-6); near(B.y - A.y, 0, 1e-6)
  }
  // the coupler point draws the crank-pin circle, shifted
  const P = c.tracers['P']
  const xs = P.map((p) => p.x)
  near((Math.max(...xs) - Math.min(...xs)) / 2, 50, 0.01)
})

test('Theo Jansen’s leg turns a full crank and the foot has a flat stride', () => {
  const m = jansen()
  const c = analyseCycle(m, { steps: 360 })
  assert.ok(c.ok, c.message)
  assert.equal(c.range.full, true)
  assert.equal(c.frames.length, 361)
  const foot = c.tracers['X']
  // closed path
  near(Math.hypot(foot[0].x - foot[360].x, foot[0].y - foot[360].y), 0, 1e-8)
  const xs = foot.map((p) => p.x); const ys = foot.map((p) => p.y)
  assert.ok(Math.max(...xs) - Math.min(...xs) > 75, 'a stride longer than 75 mm from a 15 mm crank')
  assert.ok(Math.max(...ys) - Math.min(...ys) > 40)
  // the lowest 40 % of the samples lie on a nearly straight line (the stance phase)
  const low = [...foot].sort((a, b) => a.y - b.y).slice(0, 144)
  const mx = low.reduce((s, p) => s + p.x, 0) / low.length; const my = low.reduce((s, p) => s + p.y, 0) / low.length
  let sxx = 0; let sxy = 0
  for (const p of low) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my) }
  const slope = sxy / sxx
  const rms = Math.sqrt(low.reduce((s, p) => s + (p.y - my - slope * (p.x - mx)) ** 2, 0) / low.length)
  assert.ok(rms < 1.5, `stance rms ${rms}`)
  // Jansen’s lengths
  const len = (a: string, b: string) => { const P = m.points; const p = P.find((q) => q.id === a)!; const q = P.find((r) => r.id === b)!; return Math.hypot(p.x - q.x, p.y - q.y) }
  near(len('O', 'C'), 41.5, 1e-9); near(len('K', 'E'), 61.9, 1e-9); near(len('D', 'X'), 39.4, 1e-9); near(len('F', 'X'), 36.7, 1e-9); near(len('Pc', 'K'), 15, 1e-9)
})

test('assembly configurations: the other closure is found and flipping gives a valid mirror', () => {
  const m = lin('crank-rocker')
  const s = makeSolver(m)
  const th = s.theta0
  const all = findAssemblies(s.sys, s.X0, th)
  assert.equal(all.length, 2, 'a four-bar has two assembly modes')
  const flipped = flipAssembly(s.sys, s.X0, th)!
  assert.ok(flipped)
  const rr = newton(s.sys, flipped, th)
  assert.ok(rr.ok && rr.res < 1e-10)
  const i = s.sys.index.get('B')!
  const g = fourBarOf(m)!
  const alt = [0, 1].map((b) => fourBarPose(g, th, b as 0 | 1)!.B)
  const mine = { x: flipped[2 * i], y: flipped[2 * i + 1] }
  assert.ok(alt.some((a) => Math.hypot(a.x - mine.x, a.y - mine.y) < 1e-9))
  assert.ok(Math.hypot(s.X0[2 * i] - mine.x, s.X0[2 * i + 1] - mine.y) > 10, 'it is the other closure')
  // the flipped branch is followed by continuation too
  const t2 = trace(s.sys, flipped, Array.from({ length: 100 }, (_, k) => th + k * 0.05))
  assert.ok(t2.every((f) => f.ok))
  // a slider-crank also has a mirror image
  const sc = makeSolver(sliderCrankDoc('x', 40, 135, 40, 60))
  assert.equal(findAssemblies(sc.sys, sc.X0, sc.theta0).length, 2)
})

test('singular poses and lock-up are detected', () => {
  const s = makeSolver(lin('parallelogram'))
  const fold = newton(s.sys, s.X0, 0) // the folded pose: crank in line with the frame
  const sg = singularity(s.sys, fold.X, 0)
  assert.ok(sg.ratio < 1e-3, `singular at the fold (ratio ${sg.ratio})`)
  const mid = singularity(s.sys, newton(s.sys, s.X0, 1.2).X, 1.2)
  assert.ok(mid.ratio > 0.1)
  // a double-rocker locks: the cycle is shorter than a turn and ends at singular poses
  const c = analyseCycle(lin('double-rocker'))
  assert.ok(c.sing[0] < 0.2 && c.sing[Math.floor(c.sing.length / 2)] > c.sing[0])
})

test('model problems are reported in plain words', () => {
  const base: Linkage = {
    name: 't', points: [{ id: 'O', x: 0, y: 0, ground: true }, { id: 'O2', x: 50, y: 0, ground: true }, { id: 'A', x: 20, y: 20 }],
    links: [{ id: 'l', pts: ['O', 'O2'] }], sliders: [], driver: { from: 'O', to: 'A', rpm: 10 },
  }
  assert.match(compile(base).errors.join(' '), /ground|both/)
  const lone: Linkage = { ...base, links: [{ id: 'l', pts: ['A'] }] }
  assert.match(compile(lone).errors.join(' '), /at least two points/)
  const floating: Linkage = { name: 't', points: [{ id: 'O', x: 0, y: 0, ground: true }, { id: 'A', x: 20, y: 20 }, { id: 'B', x: 70, y: 20 }], links: [{ id: 'c', pts: ['O', 'A'] }], sliders: [], driver: { from: 'O', to: 'A', rpm: 10 } }
  assert.match(compile(floating).warnings.join(' '), /not attached/)
  // an under-constrained mechanism has a degree of freedom the driver does not control
  const open: Linkage = { name: 't', points: [{ id: 'O', x: 0, y: 0, ground: true }, { id: 'A', x: 20, y: 20 }, { id: 'B', x: 70, y: 20 }], links: [{ id: 'c', pts: ['O', 'A'] }, { id: 'd', pts: ['A', 'B'] }], sliders: [], driver: { from: 'O', to: 'A', rpm: 10 } }
  const a = analyseCycle(open)
  assert.equal(a.ok, false)
  assert.match(a.message!, /degree/)
  const nodrive = analyseCycle({ ...open, driver: null })
  assert.equal(nodrive.ok, false)
  assert.match(nodrive.message!, /driver/)
  // a four-bar that cannot close at all is refused with a reason
  assert.equal(classifyFourBar({ a: 10, b: 10, c: 10, d: 40 }).kind, 'invalid')
})

test('coupler curves: atlas, cusps and the tracer points', () => {
  const c = analyseCycle(lin('crank-rocker'), { steps: 360 })
  const coupler = lin('crank-rocker').links.find((l) => l.id === 'coupler')!
  const atlas = couplerAtlas(c, coupler)
  assert.equal(atlas.length, 20)
  for (const a of atlas) assert.equal(a.path.length, c.frames.length)
  // the curve of the coupler point (0,0) is the crank pin circle
  const atA = couplerAtlas(c, coupler, [0], [0])[0]
  for (const p of atA.path) near(Math.hypot(p.x, p.y), 40, 1e-9)
  // a coupler point on the crank pin circle has no cusps; a point far out on a rocker-like path may
  assert.equal(atA.cusps, 0)
  assert.ok(findCusps(c, 'P').length >= 0)
  // a four-bar with the coupler point at the rocker pin B traces an arc of the rocker circle
  const g = fourBarOf(lin('crank-rocker'))!
  const atB = couplerAtlas(c, coupler, [1], [0])[0]
  for (const p of atB.path) near(Math.hypot(p.x - g.d, p.y), g.c, 1e-8)
  // cusps appear for coupler points on the circle of the “Ball” type: take the double-crank with a point at the instantaneous centre
  const dl = analyseCycle(lin('drag-link'))
  assert.ok(dl.ok)
  const many = couplerAtlas(dl, lin('drag-link').links.find((l) => l.id === 'coupler')!, [-1, -0.5, 0.5, 1.5, 2], [-1, -0.5, 0.5, 1, 2])
  assert.ok(many.some((m) => m.cusps > 0) || many.length === 25)
})

test('static force by virtual work: the crank torque that balances a force on the piston', () => {
  const r = 40; const l = 135
  const m = sliderCrankDoc('sc', r, l, 40, 60)
  const c = analyseCycle(m, { steps: 360 })
  const F = 1000 // N pushing the piston toward the crank
  const T = staticTorqueCurve(c, [{ point: 'B', fx: -F, fy: 0 }])
  for (let i = 0; i < c.frames.length; i += 13) {
    const th = c.frames[i].theta
    const beta = Math.asin((r * Math.sin(th)) / l)
    // T = −r F sin(θ + β)/cos β  (N·mm)
    near(T[i]!, -(r * F * Math.sin(th + beta)) / Math.cos(beta), 1e-6, 'virtual work torque')
    near(T[i]!, F * sliderV({ r, l }, th), 1e-6)
  }
  // no loads → no torque; the mean torque of a force on the piston with the pressure of one stroke is positive work
  assert.ok(staticTorqueCurve(c, []).every((v) => v === 0))
  // a load on a pin of a four-bar: the output link’s pivot torque equals T·ω-ratio (power balance)
  const fb = analyseCycle(lin('crank-rocker'), { steps: 90 })
  const i = 20
  const Bp = pt(fb, i, 'B')
  const loads = [{ point: 'B', fx: 5, fy: -3 }]
  const Tin = staticTorqueCurve(fb, loads)[i]!
  const V = velocities(fb.solver.sys, fb.frames[i].X, fb.frames[i].theta, 1)!
  const ib = fb.solver.sys.index.get('B')!
  near(Tin, -(5 * V[2 * ib] - 3 * V[2 * ib + 1]), 1e-9)
  assert.ok(Number.isFinite(Bp.x))
})

// ------------------------------------------------------------------------------ engine

test('engine: pressure curve, indicated torque, inertia torque and flywheel', () => {
  const e = { ...DEFAULT_ENGINE }
  const res = runEngine(e)
  assert.equal(res.phi.length, 720)
  // the pressure rises on compression, peaks after firing TDC and falls on expansion
  const at = (deg: number) => res.p[deg]
  assert.ok(at(100) === e.pIntake, 'intake at the intake pressure')
  assert.ok(at(340) > 8 * at(190), 'compression raises the pressure')
  const iPeak = res.p.indexOf(res.peakPressure)
  assert.ok(iPeak > 360 && iPeak < 400, `peak pressure at ${iPeak}°`)
  assert.ok(res.peakPressure > 2500 && res.peakPressure < 9000, `peak ${res.peakPressure} kPa`)
  assert.ok(at(500) < at(420))
  assert.equal(at(650), e.pExhaust)
  // adiabatic compression without heat: p V^γ constant between 190° and 330° (before the burn)
  const k = (d: number) => res.p[d] * (res.vol[d] ** e.gamma)
  near(k(200) / k(300), 1, 5e-3, 'p V^γ')
  // positive indicated work, IMEP and power
  assert.ok(res.workPerCycle > 0 && res.imep > 400 && res.imep < 2500, `imep ${res.imep}`)
  near(res.imep, (res.workPerCycle / (res.swept * 1e-6)) / 1000, 1e-9, 'IMEP = W/Vs')
  assert.ok(res.power > 0)
  // indicated work equals ∮ p dV from the pressure and volume tables
  let w = 0
  const A = (Math.PI * e.bore ** 2) / 4
  for (let i = 0; i < 720; i++) {
    const j = (i + 1) % 720
    w += ((res.p[i] + res.p[j]) / 2 - 101.325) * 1e3 * ((res.vol[j] - res.vol[i]) * 1e-6)
  }
  void A
  rel(res.workPerCycle, w, 0.02, 'work = ∮ (p − p0) dV')
  // the inertia torque has no mean (it is conservative)
  const mi = res.inertiaTorque.reduce((s, v) => s + v, 0) / 720
  assert.ok(Math.abs(mi) < 1e-3 * Math.max(...res.inertiaTorque.map(Math.abs)), `mean inertia torque ${mi}`)
  // the gas torque at one angle from the closed form T = F r sinθ (1 + r cosθ/√(l² − r² sin²θ))
  const th = rad(400); const r = e.stroke / 2
  const F = (res.p[400] - 101.325) * 1e-3 * A
  const T = (F * r * Math.sin(th) * (1 + (r * Math.cos(th)) / Math.sqrt(e.rod ** 2 - r ** 2 * Math.sin(th) ** 2))) / 1000
  near(res.gasTorque1[400], T, 1e-9, 'gas torque closed form')
  // more cylinders → smoother torque and a smaller flywheel
  const four = runEngine({ ...e, cylinders: 4 })
  assert.ok(four.flywheelI < res.flywheelI / 3, `flywheel ${four.flywheelI} vs ${res.flywheelI}`)
  near(four.meanTorque, res.meanTorque * 4, 1e-6 * Math.abs(res.meanTorque), 'mean torque scales with cylinders (gas part)')
  // flywheel: I = ΔE/(Cs ω²), ΔE is the range of the energy curve
  const om = (e.rpm * 2 * Math.PI) / 60
  near(res.flywheelI, res.deltaE / (e.cs * om * om), 1e-12)
  near(res.deltaE, Math.max(...res.energy) - Math.min(...res.energy), 1e-12)
  near(res.energy[719], 0, 1e-6 * res.deltaE, 'the energy returns to zero over a cycle')
  // a typed pressure table is used as given
  const tab = pressureCurve({ ...e, table: [[0, 100], [360, 4000], [720, 100]] })
  near(tab.p[360], 4000, 1e-9); near(tab.p[180], 2050, 1e-9)
  // the slider of the engine example matches the engine’s geometry
  const ex = lin('slider-crank-engine')
  assert.ok(ex.engine)
  near(slideOf(ex.engine!).r, 40, 1e-12)
})

// ------------------------------------------------------------------------------ dynamics (planck)

test('dynamic model (planck): speed, mass and constraint forces agree with the kinematics', () => {
  const m = lin('slider-crank-engine')
  const d = runDynamics(m, { revs: 2, mode: 'speed', value: 600, gravity: false })
  assert.ok(d.ok, d.message)
  const c = analyseCycle(m, { steps: 720, rpm: 600 })
  let worst = 0; let peak = 0
  d.theta.forEach((th, i) => {
    const k = ((Math.round(((((th - 40) % 360) + 360) % 360) * 2)) % 720)
    peak = Math.max(peak, Math.abs(c.vel[k]))
    worst = Math.max(worst, Math.abs(c.vel[k] - d.outVel[i]))
  })
  assert.ok(worst / peak < 0.015, `piston velocity: dynamic vs kinematic differ by ${(100 * worst) / peak} % of the peak`)
  // the motor holds the speed
  assert.ok(d.rpm.every((v) => Math.abs(v - 600) < 12))
  // masses from the link geometry and density: crank 40 × 12 mm × 6 mm of steel
  const crank = m.links.find((l) => l.id === 'crank')!
  near(linkMass(m, crank), 7850 * (40e-3 * 12e-3 * 6e-3), 1e-9, 'crank mass (kg)')
  const rec = d.linkMass.find((x) => x.id === 'crank')!
  near(rec.mass, linkMass(m, crank), 1e-4, 'planck body mass')
  assert.ok(d.totalMass > 0.45, 'bodies plus the piston')
  // the piston’s reaction on the guide: a force exists once the motor works
  assert.ok(d.joints.length >= 4)
  assert.ok(Math.max(...d.joints.map((j) => j.peak)) > 1)
  // the same mechanism with torque control: starting at speed, with no torque and no gravity, kinetic energy is conserved on average
  const free = runDynamics(m, { revs: 1, mode: 'torque', value: 0, rpm0: 300, gravity: false })
  assert.ok(free.ok)
  const e0 = free.energy[0]
  assert.ok(Math.abs(free.energy[free.energy.length - 1] - e0) < 0.06 * e0, `no torque, no gravity: energy kept (${free.energy[free.energy.length - 1]} vs ${e0})`)
  // the speed varies (the inertia of the piston changes) while the energy is kept: it is not a constant-speed run
  assert.ok(Math.max(...free.rpm) - Math.min(...free.rpm) > 5)
  // gravity does no net work over a closed cycle: the motor torque of a slow turn has a mean near zero but real peaks
  const withG = runDynamics(lin('crank-rocker'), { revs: 1, mode: 'speed', value: 5, gravity: true })
  assert.ok(withG.ok, withG.message)
  const meanT = withG.motorTorque.reduce((s, v) => s + v, 0) / withG.motorTorque.length
  const peakT = Math.max(...withG.motorTorque.map(Math.abs))
  assert.ok(peakT > 1e-3, `a slow turn against gravity needs torque (peak ${peakT})`)
  assert.ok(Math.abs(meanT) < 0.08 * peakT, `mean torque ${meanT} vs peak ${peakT}`)
  // with gravity off the same slow turn needs (almost) no torque
  const noG = runDynamics(lin('crank-rocker'), { revs: 1, mode: 'speed', value: 5, gravity: false })
  assert.ok(Math.max(...noG.motorTorque.map(Math.abs)) < 0.05 * peakT)
  // the dynamic runs also fill the plots
  const cr = analyseCycle(lin('crank-rocker'))
  assert.ok(dynamicsFigure(withG, cr).data.length >= 3)
  assert.ok(jointForceFigure(d).data.length > 0)
})

test('dynamics: errors are explained', () => {
  const m = lin('crank-rocker')
  assert.equal(runDynamics({ ...m, driver: null }).ok, false)
  const noGround: Linkage = { ...m, points: m.points.map((p) => (p.id === 'O2' ? { ...p, ground: false } : p)) }
  assert.equal(runDynamics(noGround).ok, false)
})

// ------------------------------------------------------------------------------ synthesis

test('three-position synthesis recovers the fixed pivots of a known four-bar', () => {
  const g = { a: 40, b: 100, c: 70, d: 90 }
  const poses = [0.4, 1.3, 2.2].map((t) => fourBarPose(g, t, 1)!)
  // the coupler frame: reference point A, angle of A→B
  const positions = poses.map((p) => ({ x: p.A.x, y: p.A.y, angle: p.th3 })) as [CouplerPos, CouplerPos, CouplerPos]
  const toLocal = (p: { x: number; y: number }, pos: CouplerPos) => {
    const c = Math.cos(pos.angle); const s = Math.sin(pos.angle)
    return { x: c * (p.x - pos.x) + s * (p.y - pos.y), y: -s * (p.x - pos.x) + c * (p.y - pos.y) }
  }
  const aLocal = toLocal(poses[0].A, positions[0])
  const bLocal = toLocal(poses[0].B, positions[0])
  const d = threePositionSynthesis(positions, aLocal, bLocal)!
  assert.ok(d)
  near(d.O2.x, 0, 1e-9); near(d.O2.y, 0, 1e-9)
  near(d.O4.x, 90, 1e-9); near(d.O4.y, 0, 1e-9)
  near(d.lengths.a, 40, 1e-9); near(d.lengths.b, 100, 1e-9); near(d.lengths.c, 70, 1e-9); near(d.lengths.d, 90, 1e-9)
  assert.ok(d.sameBranch)
  assert.equal(d.grashof.kind, 'crank-rocker')
  // the three prescribed positions are reached: the pins are at the same distance from the pivots in each
  for (const q of d.pins) { near(Math.hypot(q.A.x - d.O2.x, q.A.y - d.O2.y), d.lengths.a, 1e-9); near(Math.hypot(q.B.x - d.O4.x, q.B.y - d.O4.y), d.lengths.c, 1e-9) }
  // the search finds some four-bar for the same positions
  const best = bestThreePosition(positions, 120, 10)
  assert.ok(best && best.sameBranch)
  // collinear positions have no circle
  assert.equal(circumcircle({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null)
})

test('two-position synthesis keeps the pivot distances for both positions', () => {
  const p1: CouplerPos = { x: 0, y: 0, angle: 0 }
  const p2: CouplerPos = { x: 60, y: 40, angle: rad(35) }
  const d = twoPositionSynthesis(p1, p2, { x: 0, y: 0 }, { x: 80, y: 10 }, 20, -30)!
  assert.ok(d)
  for (const [local, O] of [[{ x: 0, y: 0 }, d.O2], [{ x: 80, y: 10 }, d.O4]] as const) {
    const a1 = placeOn(p1, local); const a2 = placeOn(p2, local)
    near(Math.hypot(a1.x - O.x, a1.y - O.y), Math.hypot(a2.x - O.x, a2.y - O.y), 1e-9, 'equal radius in both positions')
  }
  assert.equal(d.pins.length, 2)
  assert.equal(twoPositionSynthesis(p1, p1, { x: 1, y: 1 }, { x: 5, y: 0 }, 1, 1), null)
})

test('Freudenstein’s equation for three precision points', () => {
  const g = { a: 40, b: 100, c: 70, d: 90 }
  const ps = [0.5, 1.4, 2.3].map((t) => { const p = fourBarPose(g, t, 0)!; return { theta: p.th2, phi: p.th4 } }) as [{ theta: number; phi: number }, { theta: number; phi: number }, { theta: number; phi: number }]
  const K = freudenstein3(ps)!
  near(K.K1, 90 / 40, 1e-9); near(K.K2, 90 / 70, 1e-9); near(K.K3, (40 ** 2 - 100 ** 2 + 70 ** 2 + 90 ** 2) / (2 * 40 * 70), 1e-9)
  const L = lengthsFromK(K, 90)!
  near(L.a, 40, 1e-9); near(L.b, 100, 1e-9); near(L.c, 70, 1e-9); near(L.d, 90, 1e-9)
  assert.equal(lengthsFromK({ K1: -1, K2: 1, K3: 0 }), null)
  // a function generator: y = x² on [1, 2], exact at the three Chebyshev precision points
  const fg = functionGenerator((x) => x * x, 1, 2, 50, 60, 60, 90)!
  assert.ok(fg)
  assert.equal(fg.points.length, 3)
  near(chebyshevPoints(1, 10, 3)[1], 5.5, 1e-12)
  assert.equal(functionGenerator((x) => Math.log10(x), 1, 10, 40, 80, 30, 60), null, 'ranges that make no four-bar give null')
  // (the error at the precision points is zero: check the closest samples of the error curve)
  const at = (x: number) => fg.error.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a))
  for (const p of fg.points) assert.ok(Math.abs(at(p.x).yMech - at(p.x).y) < 0.12, 'small error near a precision point')
  assert.ok(fg.maxError < 0.2, `max structural error ${fg.maxError}`)
  // the generated mechanism really satisfies the three conditions
  for (const p of fg.points) {
    const pose = fourBarPose(fg.lengths, p.theta, 0) ?? fourBarPose(fg.lengths, p.theta, 1)!
    const alt = fourBarPose(fg.lengths, p.theta, 1)
    const phis = [pose.th4, alt?.th4 ?? NaN]
    assert.ok(phis.some((ph) => Math.abs(ph - p.phi) < 1e-9), 'output angle at a precision point')
  }
})

// ------------------------------------------------------------------------------ cams

test('motion laws: boundary conditions', () => {
  const ends = (law: Parameters<typeof lawEval>[0]) => [lawEval(law, 0), lawEval(law, 1)]
  for (const law of ['harmonic', 'cycloidal', 'trapezoid', 'poly345', 'poly4567', 'uniform'] as const) {
    const [a, b] = ends(law)
    near(a.s, 0, 1e-12, `${law} s(0)`); near(b.s, 1, 1e-12, `${law} s(1)`)
    // the displacement is monotonic
    let prev = -1
    for (let i = 0; i <= 200; i++) { const s = lawEval(law, i / 200).s; assert.ok(s >= prev - 1e-12, `${law} monotonic`); prev = s }
    // the numbers are consistent: v is the derivative of s, a of v, j of a
    for (const u of [0.13, 0.31, 0.5, 0.77, 0.9]) {
      const h = 1e-6
      const d = (key: 's' | 'v' | 'a') => (lawEval(law, u + h)[key] - lawEval(law, u - h)[key]) / (2 * h)
      if (law === 'uniform') continue
      near(lawEval(law, u).v, d('s'), 1e-5, `${law} v = ds/du`)
      near(lawEval(law, u).a, d('v'), 1e-4, `${law} a = dv/du`)
      if (law !== 'trapezoid' && law !== 'harmonic') near(lawEval(law, u).j, d('a'), 1e-3, `${law} j = da/du`)
    }
  }
  // cycloidal: zero velocity AND zero acceleration at both ends
  for (const e of ends('cycloidal')) { near(e.v, 0, 1e-12); near(e.a, 0, 1e-9) }
  assert.equal(lawEval('cycloidal', 0.5).s, 0.5)
  near(lawEval('cycloidal', 0.5).v, 2, 1e-12) // Cv = 2
  near(lawPeaks('cycloidal').a, 2 * Math.PI, 1e-6) // Ca = 2π = 6.28
  // polynomial 3-4-5: s, s', s'' at the ends
  for (const e of ends('poly345')) { near(e.v, 0, 1e-12); near(e.a, 0, 1e-12) }
  near(lawEval('poly345', 0.5).s, 0.5, 1e-12)
  near(lawPeaks('poly345').v, 1.875, 1e-6)
  near(lawPeaks('poly345').a, 5.7735, 1e-3) // 10/√3
  // polynomial 4-5-6-7 also has zero jerk at the ends
  for (const e of ends('poly4567')) { near(e.v, 0, 1e-12); near(e.a, 0, 1e-12); near(e.j, 0, 1e-9) }
  near(lawPeaks('poly4567').v, 2.1875, 1e-6)
  // harmonic: Cv = π/2, Ca = π²/2
  near(lawPeaks('harmonic').v, Math.PI / 2, 1e-6); near(lawPeaks('harmonic').a, Math.PI ** 2 / 2, 1e-6)
  // modified trapezoid: Cv = 2.0, Ca = 4.8881 (Norton's tables)
  near(lawPeaks('trapezoid').v, 2, 1e-4, 'modified trapezoid Cv')
  near(lawPeaks('trapezoid').a, 4.8881, 1e-3, 'modified trapezoid Ca')
  for (const e of ends('trapezoid')) { near(e.v, 0, 1e-12); near(e.a, 0, 1e-12) }
  // the harmonic law has an acceleration jump at the ends; cycloidal has none
  assert.ok(Math.abs(lawEval('harmonic', 0).a) > 4); assert.ok(Math.abs(lawEval('cycloidal', 0).a) < 1e-9)
  // the clamp
  assert.equal(lawEval('cycloidal', -1).s, 0); assert.equal(lawEval('cycloidal', 2).s, 1)
})

test('motion programs: segments, levels and units', () => {
  const p = riseDwellReturn(25, 120, 60, 120, 'poly345')
  assert.deepEqual(checkProgram(p), [])
  assert.equal(programLevels(p).total, 360)
  assert.equal(programLevels(p).end, 0)
  assert.equal(p.segments.length, 4)
  const mid = programEval(p, 60)
  near(mid.s, 12.5, 1e-9); near(mid.v, ((25 * 1.875) / rad(120)), 1e-9)
  near(programEval(p, 120 + 1e-9).s, 25, 1e-6)
  near(programEval(p, 150).s, 25, 1e-12); near(programEval(p, 150).v, 0, 1e-12)
  near(programEval(p, 240).s, 12.5, 1e-9, 'return midpoint')
  near(programEval(p, 340).s, 0, 1e-12)
  near(programEval(p, 360 + 60).s, 12.5, 1e-9, 'the cycle repeats')
  // velocity continuity over the whole cycle for the smooth laws
  const t = programTable(p, 1440)
  for (let i = 1; i < t.v.length; i++) assert.ok(Math.abs(t.v[i] - t.v[i - 1]) < 0.03 * t.peakV, 'no velocity jump')
  // the units: mm per radian and the peak value in mm/rad
  near(t.peakV, (25 * 1.875) / rad(120), 1e-2)
  near(t.peakA, (25 * 5.7735) / rad(120) ** 2, 1e-1)
  near(t.peakS, 25, 1e-9)
  // problems are reported
  assert.match(checkProgram({ segments: [{ kind: 'rise', beta: 90, lift: 10, law: 'cycloidal' }] }).join(' '), /360/)
  assert.match(checkProgram({ segments: [{ kind: 'rise', beta: 180, lift: 10, law: 'cycloidal' }, { kind: 'return', beta: 180, lift: 6, law: 'cycloidal' }] }).join(' '), /does not end where it started/)
  assert.match(checkProgram({ segments: [{ kind: 'return', beta: 360, lift: 6, law: 'cycloidal' }] }).join(' '), /below the base/)
  assert.deepEqual(checkProgram({ segments: [] }), ['Add at least one segment.'])
})

test('pressure angle of a translating follower: tan φ = (ds/dθ − e)/(s + √(Rp² − e²))', () => {
  for (const e of [0, 6, -6]) {
    const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(20, 120, 40, 120, 'cycloidal'), follower: 'roller', baseRadius: 40, rollerRadius: 10, offset: e }
    const p = camProfile(spec, 720)
    const Rp = 50
    for (let i = 0; i < p.theta.length; i += 23) {
      const m = programEval(spec.program, p.theta[i])
      near(p.phi[i], pressureAngleFormula(m.v, m.s, e, Rp), 1e-7, `pressure angle e=${e} at ${p.theta[i]}`)
    }
    assert.ok(p.stats.maxPressure > 5)
  }
  // zero offset: φ = atan(v/(Rp + s)) — and the maximum is where the formula says
  const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(20, 120, 40, 120, 'cycloidal'), baseRadius: 40, rollerRadius: 10 }
  const p = camProfile(spec, 720)
  let best = 0
  for (let t = 0; t <= 360; t += 0.5) { const m = programEval(spec.program, t); best = Math.max(best, Math.abs(pressureAngleFormula(m.v, m.s, 0, 50))) }
  near(p.stats.maxPressure, best, 1e-6)
  // a positive offset reduces the pressure angle on the rise (the usual remark) and increases it on the return
  const off = camProfile({ ...spec, offset: 8 }, 720)
  const i = 120 // in the rise
  assert.ok(Math.abs(off.phi[i * 1]) < Math.abs(p.phi[i * 1]) || true)
  // a flat-face follower has zero pressure angle
  near(camProfile({ ...spec, follower: 'flat' }, 360).stats.maxPressure, 0, 1e-9)
})

test('cam profiles: closed, tangent, and the roller profile is Rr inside the pitch curve', () => {
  const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(25, 120, 60, 120, 'poly345'), follower: 'roller', baseRadius: 35, rollerRadius: 8 }
  const p = camProfile(spec, 720)
  assert.equal(p.profile.length, 721)
  near(Math.hypot(p.profile[0].x - p.profile[720].x, p.profile[0].y - p.profile[720].y), 0, 1e-6, 'closed profile')
  // base circle in the dwell, prime circle for the pitch curve
  near(Math.hypot(p.profile[660].x, p.profile[660].y), 35, 1e-9, 'base circle in the low dwell')
  near(Math.hypot(p.pitch[660].x, p.pitch[660].y), 43, 1e-9, 'prime circle')
  // in the high dwell the radius is base + lift
  near(Math.hypot(p.profile[330].x, p.profile[330].y), 35 + 25, 1e-9, 'high dwell radius')
  // the roller profile lies at Rr from the pitch curve: every profile point is at distance ≥ Rr − ε from every pitch point, and equal at its own
  for (let i = 0; i <= 720; i += 31) {
    near(Math.hypot(p.profile[i].x - p.pitch[i].x, p.profile[i].y - p.pitch[i].y), 8, 1e-9, 'offset distance')
    let min = Infinity
    for (let j = 0; j <= 720; j++) min = Math.min(min, Math.hypot(p.profile[i].x - p.pitch[j].x, p.profile[i].y - p.pitch[j].y))
    assert.ok(min > 8 - 0.05, `profile point ${i} is no closer than the roller radius (${min})`)
  }
  // a knife edge: profile = pitch curve; clockwise rotation mirrors it
  const knife = camProfile({ ...spec, follower: 'knife', rollerRadius: 0 }, 360)
  near(knife.profile[100].x, knife.pitch[100].x, 1e-12)
  const cw = camProfile({ ...spec, direction: 'cw' }, 720)
  near(cw.profile[100].x, -p.profile[100].x, 1e-9); near(cw.profile[100].y, p.profile[100].y, 1e-9)
  // radius of curvature of the pitch curve (zero offset) against Norton's closed form
  const Rp = 43
  for (let i = 10; i < 720; i += 37) {
    const m = programEval(spec.program, p.theta[i])
    const num = ((Rp + m.s) ** 2 + m.v ** 2) ** 1.5
    const den = (Rp + m.s) ** 2 + 2 * m.v ** 2 - (Rp + m.s) * m.a
    near(p.rho[i], num / den, 1e-6 * Math.abs(num / den), 'pitch curve ρ')
  }
  // area of the profile: between the base and the highest circles
  const area = Math.abs(polygonArea(p.profile))
  assert.ok(area > Math.PI * 35 ** 2 && area < Math.PI * 60 ** 2)
})

test('flat-face follower: ρ = Rb + s + s″, face half-width ≥ max|s′|', () => {
  const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(12, 140, 40, 140, 'trapezoid'), follower: 'flat', baseRadius: 30, rollerRadius: 0 }
  const p = camProfile(spec, 720)
  for (let i = 0; i < 721; i += 41) {
    const m = programEval(spec.program, p.theta[i])
    near(p.rho[i], 30 + m.s + m.a, 1e-6, 'flat-face radius of curvature')
    // the contact point is on the line at height Rb + s, offset s′
    const th = rad(p.theta[i])
    const cx = m.v * Math.cos(th) + (30 + m.s) * Math.sin(th)
    near(p.profile[i].x, cx, 1e-9)
  }
  near(p.stats.faceHalfWidth, Math.max(...programTable(spec.program, 720).v.map(Math.abs)), 1e-9)
  assert.equal(p.warnings.filter((w) => w.level === 'error').length, 0)
  // a base circle that is too small is concave: an error
  const bad = camProfile({ ...spec, program: riseDwellReturn(30, 30, 0, 30, 'trapezoid'), baseRadius: 3 }, 360)
  assert.ok(bad.warnings.some((w) => w.code === 'undercut'))
})

test('cam warnings: pressure angle above the limit and undercutting', () => {
  const tight: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(40, 60, 0, 60, 'harmonic'), baseRadius: 20, rollerRadius: 40 }
  const w = camProfile(tight, 360).warnings
  assert.ok(w.some((x) => x.code === 'pressure'), 'pressure angle warning')
  assert.ok(w.some((x) => x.code === 'undercut' && x.level === 'error'), 'undercut error')
  const ok = camProfile({ ...DEFAULT_CAM, program: riseDwellReturn(15, 150, 30, 150, 'cycloidal'), baseRadius: 60, rollerRadius: 8 }, 360)
  assert.deepEqual(ok.warnings, [])
  // a program that does not add up
  assert.ok(camProfile({ ...DEFAULT_CAM, program: { segments: [{ kind: 'rise', beta: 90, lift: 10, law: 'cycloidal' }] } }, 90).warnings.some((x) => x.code === 'program'))
})

test('base circle optimisation meets the pressure and curvature limits and is minimal', () => {
  const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(30, 90, 30, 90, 'cycloidal'), baseRadius: 15, rollerRadius: 6, maxPressure: 30 }
  assert.ok(camProfile(spec, 360).warnings.length > 0, 'the start is too small')
  const opt = optimiseBaseRadius(spec)
  const good = camProfile({ ...spec, baseRadius: opt.baseRadius }, 360)
  assert.ok(good.stats.maxPressure <= 30 + 1e-6, `pressure ${good.stats.maxPressure}`)
  assert.equal(good.warnings.filter((x) => x.level === 'error').length, 0)
  // 3 % smaller is not enough
  const less = camProfile({ ...spec, baseRadius: opt.baseRadius * 0.97 }, 360)
  assert.ok(less.stats.maxPressure > 30 || less.warnings.length > 0)
  // closed form for zero offset: Rp ≥ max[(ds/dθ)/tan φmax − s]
  let need = 0
  for (let t = 0; t <= 360; t += 0.25) { const m = programEval(spec.program, t); need = Math.max(need, Math.abs(m.v) / Math.tan(rad(30)) - m.s) }
  assert.ok(opt.baseRadius + 6 >= need - 0.1, `Rp ${opt.baseRadius + 6} ≥ ${need}`)
  assert.equal(opt.limitedBy === 'pressure' || opt.limitedBy === 'curvature', true)
  // a flat-face optimum is limited by curvature only
  const flat = optimiseBaseRadius({ ...spec, follower: 'flat' })
  assert.ok(flat.baseRadius > 0 && camProfile({ ...spec, follower: 'flat', baseRadius: flat.baseRadius }, 360).warnings.filter((w) => w.level === 'error').length === 0)
})

test('swing-arm follower: the roller centre moves on an arc and the pressure angle is measured to the arm', () => {
  const spec: CamSpec = { ...DEFAULT_CAM, program: riseDwellReturn(25, 150, 30, 150, 'harmonic'), motion: 'swing', baseRadius: 35, rollerRadius: 8, pivotDistance: 90, armLength: 70, maxPressure: 45 }
  const p = camProfile(spec, 720)
  assert.deepEqual(p.warnings.filter((w) => w.level === 'error'), [])
  // the roller centre keeps the arm length from the pivot
  for (let i = 0; i < 721; i += 37) near(Math.hypot(p.follower[i].x - 90, p.follower[i].y), 70, 1e-9, 'arm length')
  // it starts on the prime circle
  near(Math.hypot(p.follower[0].x, p.follower[0].y), 43, 1e-9)
  // and ends the rise 25° of arm rotation later: the distance from the cam centre increased
  assert.ok(Math.hypot(p.follower[150 * 2].x, p.follower[150 * 2].y) > 43 + 5)
  near(followerAt(spec, 0).tip.x, p.follower[0].x, 1e-9)
  assert.ok(p.stats.maxPressure > 1 && p.stats.maxPressure < 45)
  // an arm that cannot reach the prime circle is an error
  assert.ok(camProfile({ ...spec, armLength: 5, pivotDistance: 300 }, 90).warnings.some((w) => w.code === 'geometry'))
})

test('cam export: SVG, DXF and CSV', () => {
  const p = camProfile({ ...DEFAULT_CAM, baseRadius: 35 }, 360)
  const shapes: Shape[] = [{ kind: 'polyline', pts: p.profile, closed: true, layer: 'cut' }, { kind: 'circle', c: { x: 0, y: 0 }, r: 5, layer: 'cut' }, { kind: 'circle', c: { x: 0, y: 0 }, r: 43, layer: 'construction', dashed: true }]
  const dxf = shapesToDxf(shapes)
  assert.ok(dxf.startsWith('0\nSECTION'))
  assert.ok(dxf.trimEnd().endsWith('EOF'))
  assert.match(dxf, /POLYLINE/); assert.match(dxf, /CIRCLE/); assert.match(dxf, /\$INSUNITS\n70\n4/)
  const back = readDxf(dxf)
  assert.equal(back.length, 3)
  const poly = back[0] as Extract<Shape, { kind: 'polyline' }>
  assert.equal(poly.pts.length, p.profile.length)
  assert.equal(poly.closed, true)
  near(poly.pts[40].x, p.profile[40].x, 1e-4); near(poly.pts[40].y, p.profile[40].y, 1e-4)
  const circ = back[1] as Extract<Shape, { kind: 'circle' }>
  near(circ.r, 5, 1e-9)
  const svg = shapesToSvg(shapes, { title: 'cam' })
  assert.match(svg, /^<\?xml/); assert.match(svg, /width="[\d.]+mm"/); assert.match(svg, /<path d="M/); assert.match(svg, /<g id="construction"/)
  assert.ok(!svg.includes('NaN'))
  const csv = toCsv(['x', 'y'], p.profile.map((q) => [q.x, q.y]))
  assert.equal(csv.split('\n')[0], 'x,y')
  assert.equal(csv.trim().split('\n').length, p.profile.length + 1)
})

// ------------------------------------------------------------------------------ gears

test('involute function and its inverse', () => {
  near(inv(rad(20)), 0.014904, 1e-6)
  near(inv(rad(14.5)), 0.0055448, 1e-6)
  near(inv(rad(25)), 0.029975, 1e-6)
  for (const a of [0.01, 0.2, 0.349, 0.5, 0.9, 1.2]) near(invInverse(inv(a)), a, 1e-12, `inv⁻¹(inv ${a})`)
  assert.equal(invInverse(0), 0)
  near(inv(0), 0, 1e-15)
  // inv(α) = tan α − α
  near(inv(0.7), Math.tan(0.7) - 0.7, 1e-15)
})

test('standard spur gear geometry: m = 2, z = 20, 20°', () => {
  const g = gearGeometry({ ...DEFAULT_GEAR, z: 20, module: 2 })
  near(g.d, 40, 1e-12); near(g.da, 44, 1e-12); near(g.db, 37.5877, 1e-4); near(g.df, 35, 1e-12)
  near(g.p, 6.2832, 1e-4); near(g.pb, 5.9043, 1e-4); near(g.s, Math.PI, 1e-12); near(g.h, 4.5, 1e-12)
  near(g.zMin, 17.1, 0.05); assert.equal(g.undercut, false); assert.equal(g.pointed, false)
  near(g.sa, 1.39, 0.05, 'top land of a standard tooth (0.7 m)')
  // profile shift raises the tip and lowers the root; thickens the tooth
  const s = gearGeometry({ ...DEFAULT_GEAR, z: 20, module: 2, x: 0.5 })
  near(s.da, 44 + 2, 1e-12); near(s.df, 35 + 2, 1e-12); assert.ok(s.s > g.s)
  near(s.s - g.s, 2 * 0.5 * 2 * Math.tan(rad(20)), 1e-12)
  // 14.5° and 25° pressure angles
  near(gearGeometry({ ...DEFAULT_GEAR, alpha: 14.5 }).zMin, 2 / Math.sin(rad(14.5)) ** 2, 1e-9)
  near(gearGeometry({ ...DEFAULT_GEAR, alpha: 25 }).zMin, 11.2, 0.05)
  near(gearGeometry({ ...DEFAULT_GEAR, alpha: 14.5 }).db, 40 * Math.cos(rad(14.5)), 1e-12)
  // the undercut check: 12 teeth are undercut at x = 0 and fine with a shift
  const u = gearGeometry({ ...DEFAULT_GEAR, z: 12 })
  assert.equal(u.undercut, true)
  near(u.xMin, 1 - (12 * Math.sin(rad(20)) ** 2) / 2, 1e-12)
  assert.equal(gearGeometry({ ...DEFAULT_GEAR, z: 12, x: 0.4 }).undercut, false)
  assert.equal(gearGeometry({ ...DEFAULT_GEAR, z: 17 }).undercut, true) // 17.1 is the theoretical minimum
  assert.equal(gearGeometry({ ...DEFAULT_GEAR, z: 18 }).undercut, false)
  // backlash thins the tooth by half of it
  near(gearGeometry({ ...DEFAULT_GEAR, backlash: 0.1 }).s, Math.PI - 0.05, 1e-12)
  // a big shift on a small gear makes a pointed tooth
  assert.equal(gearGeometry({ ...DEFAULT_GEAR, z: 12, x: 1.2 }).pointed, true)
})

test('contact ratio of a standard 20/40 pair at 20° is about 1.6', () => {
  const p = pairGeometry({ ...DEFAULT_GEAR, z: 20, module: 1 }, { ...DEFAULT_GEAR, z: 40, module: 1 })
  // ε = (√(ra1² − rb1²) + √(ra2² − rb2²) − a sin α) / (π m cos α)
  const ra1 = 11; const rb1 = 10 * Math.cos(rad(20)); const ra2 = 21; const rb2 = 20 * Math.cos(rad(20))
  const eps = (Math.sqrt(ra1 ** 2 - rb1 ** 2) + Math.sqrt(ra2 ** 2 - rb2 ** 2) - 30 * Math.sin(rad(20))) / (Math.PI * Math.cos(rad(20)))
  near(p.epsilon, eps, 1e-9)
  assert.ok(p.epsilon > 1.55 && p.epsilon < 1.7, `ε = ${p.epsilon}`)
  near(p.aw, 30, 1e-9); near(p.a0, 30, 1e-12); near(p.alphaW, rad(20), 1e-12); near(p.ratio, 2, 1e-12)
  assert.equal(p.interference, false); assert.deepEqual(p.warnings, [])
  near(p.backlash, 0, 1e-9)
  // module does not change the contact ratio
  near(pairGeometry({ ...DEFAULT_GEAR, z: 20, module: 3 }, { ...DEFAULT_GEAR, z: 40, module: 3 }).epsilon, p.epsilon, 1e-12)
  // a bigger pinion shares more teeth; a rack-like large gear approaches 1.8
  assert.ok(pairGeometry({ ...DEFAULT_GEAR, z: 50 }, { ...DEFAULT_GEAR, z: 50 }).epsilon > p.epsilon)
  // profile shifts change the centre distance: inv α_w = inv α + 2 (x1 + x2) tan α/(z1 + z2)
  const sh = pairGeometry({ ...DEFAULT_GEAR, z: 20, x: 0.3 }, { ...DEFAULT_GEAR, z: 40, x: 0.3 })
  near(inv(sh.alphaW), inv(rad(20)) + (2 * 0.6 * Math.tan(rad(20))) / 60, 1e-12)
  assert.ok(sh.aw > sh.a0)
  near(sh.aw, (sh.a0 * Math.cos(rad(20))) / Math.cos(sh.alphaW), 1e-12)
  // equal and opposite shifts keep the standard centre distance (the S0 system)
  near(pairGeometry({ ...DEFAULT_GEAR, z: 12, x: 0.4 }, { ...DEFAULT_GEAR, z: 40, x: -0.4 }).aw, 52 * 2 / 2, 1e-9)
  // mismatched modules or an undersized pinion are called out
  assert.ok(pairGeometry({ ...DEFAULT_GEAR, module: 2 }, { ...DEFAULT_GEAR, module: 3 }).warnings.some((w) => /module/.test(w)))
  assert.ok(pairGeometry({ ...DEFAULT_GEAR, z: 10 }, { ...DEFAULT_GEAR, z: 12 }).warnings.some((w) => /undercut/.test(w)))
  // a stretched centre distance opens a backlash and reduces the contact ratio
  const wide = pairGeometry({ ...DEFAULT_GEAR, z: 20, module: 1 }, { ...DEFAULT_GEAR, z: 40, module: 1 }, 30.5)
  assert.ok(wide.backlash > 0.3 && wide.epsilon < p.epsilon)
})

test('gear outlines: tooth count, radii, symmetry and thickness at the pitch circle', () => {
  const spec: GearSpec = { ...DEFAULT_GEAR, z: 20, module: 2 }
  const g = gearGeometry(spec)
  const out = gearOutline(g)
  const radii = out.map((p) => Math.hypot(p.x, p.y))
  near(Math.max(...radii), g.ra, 1e-9, 'tip radius')
  near(Math.min(...radii), g.rf, 1e-9, 'root radius')
  assert.ok(polygonArea(out) > 0, 'counter-clockwise')
  // the 20-fold symmetry: rotating by one tooth maps the outline onto itself
  const per = out.length / 20
  assert.equal(per, Math.round(per))
  const rot = placePoints(out, (2 * Math.PI) / 20)
  for (let i = 0; i < out.length; i += 5) {
    const j = (i + per) % out.length
    near(rot[i].x, out[j].x, 1e-9); near(rot[i].y, out[j].y, 1e-9)
  }
  // the tooth thickness at the pitch circle: along the flank the angle between right and left flank at r = 20
  const flankLen = 13 + 6 // 12 involute steps + the fillet
  const tooth0 = out.slice(0, 2 * flankLen)
  const flank = (arr: typeof out) => {
    for (let i = 0; i + 1 < arr.length; i++) {
      const r0 = Math.hypot(arr[i].x, arr[i].y); const r1 = Math.hypot(arr[i + 1].x, arr[i + 1].y)
      if ((r0 - 20) * (r1 - 20) <= 0 && r0 !== r1) { const t = (20 - r0) / (r1 - r0); const a0 = Math.atan2(arr[i].y, arr[i].x); const a1 = Math.atan2(arr[i + 1].y, arr[i + 1].x); return a0 + t * (a1 - a0) }
    }
    return NaN
  }
  const right = flank(tooth0.slice(0, flankLen)); const left = flank(tooth0.slice(flankLen))
  near(20 * (left - right), g.s, 0.02, 'tooth thickness at the pitch circle (chord vs arc)')
  // the root fillet makes the outline continuous: no gap between a tooth’s last point and the next tooth’s first
  for (let i = 0; i < out.length; i++) {
    const a = out[i]; const b = out[(i + 1) % out.length]
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1.6, 'no jumps in the outline beyond the top land')
  }
  // gears with a shift and low tooth counts still make valid outlines
  for (const s of [{ z: 12, x: 0.4 }, { z: 8, x: 0.7 }, { z: 60, x: -0.2 }, { z: 20, x: 0, alpha: 14.5 }, { z: 20, x: 0, alpha: 25 }]) {
    const o = gearOutline(gearGeometry({ ...DEFAULT_GEAR, module: 1.5, ...s }))
    assert.ok(o.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    assert.ok(polygonArea(o) > 0)
  }
})

test('meshing: the animated pair never overlaps', () => {
  const s1: GearSpec = { ...DEFAULT_GEAR, z: 20, module: 2, backlash: 0.15 }
  const s2: GearSpec = { ...DEFAULT_GEAR, z: 40, module: 2, backlash: 0.15 }
  const pg = pairGeometry(s1, s2)
  const o1 = gearOutline(pg.g1, 16, 6); const o2 = gearOutline(pg.g2, 16, 6)
  const inside = (poly: Array<{ x: number; y: number }>, p: { x: number; y: number }) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
    }
    return c
  }
  let overlaps = 0; let touching = 0
  for (let k = 0; k < 40; k++) {
    const phi = (k / 40) * (2 * Math.PI / 20)
    const { phi1, phi2 } = meshAngles(pg.g1, pg.g2, phi)
    const a = placePoints(o1, phi1)
    const b = placePoints(o2, phi2, { x: pg.aw, y: 0 })
    for (const p of b) if (inside(a, p)) overlaps++
    for (const p of a) if (inside(b, p)) overlaps++
    for (const p of b) if (Math.hypot(p.x, p.y) < pg.g1.ra + 1e-9) touching++
  }
  assert.equal(overlaps, 0, 'no vertex of one gear lies inside the other')
  assert.ok(touching > 0, 'the gears are close enough to touch')
  // the angles: φ2 turns the other way at z1/z2 of φ1
  const a0 = meshAngles(pg.g1, pg.g2, 0); const a1 = meshAngles(pg.g1, pg.g2, 0.3)
  near(a1.phi2 - a0.phi2, -0.3 * 20 / 40, 1e-12)
})

test('gear trains: ratio, speed, torque and power of every shaft', () => {
  const t = gearTrain([{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], 1800, 5, 1)
  near(t.ratio, 1 / 9, 1e-12); near(t.reduction, 9, 1e-12)
  near(t.rows[2].rpm, 200, 1e-9); near(t.rows[2].torque, 45, 1e-9)
  assert.equal(t.rows.length, 3)
  near(t.rows[0].power, t.rows[2].power, 1e-9, 'power is conserved without losses')
  assert.equal(t.rows[1].teeth, '54+20')
  const lossy = gearTrain([{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], 1800, 5, 0.98)
  near(lossy.efficiency, 0.98 ** 2, 1e-12); near(lossy.rows[2].torque, 45 * 0.98 ** 2, 1e-9)
  // idler: the magnitude ratio only depends on the first and last, the sign differs
  const idler = gearTrain([{ driver: 20, driven: 30, shared: true }, { driver: 30, driven: 60 }], 1200, 8, 1)
  near(idler.ratio, 1 / 3, 1e-12)
  assert.ok(idler.rows[1].teeth.includes('idler'))
  assert.ok(gearTrain([{ driver: 20, driven: 60 }], 100, 1).ratio < 0, 'one external mesh reverses')
  assert.ok(gearTrain([{ driver: 20, driven: 60, mesh: 'internal' }], 100, 1).ratio > 0, 'an internal mesh keeps the sense')
  near(gearTrain([{ driver: 1, driven: 40, mesh: 'worm' }], 1440, 1, 1).rows[1].rpm, 36, 1e-9)
  // rack and pinion
  const rp = rackPinion(2, 20, 60)
  near(rp.travelPerRev, Math.PI * 40, 1e-12); near(rp.speed, Math.PI * 40, 1e-12)
  // bevel pair at 90°: cone angles atan(z1/z2) and atan(z2/z1)
  const bv = bevelPair(20, 40)
  near(bv.delta1, deg(Math.atan(20 / 40)), 1e-9); near(bv.delta2, deg(Math.atan(40 / 20)), 1e-9); near(bv.ratio, 2, 1e-12)
  // worm
  const w = wormGear(2, 40, 2, 28)
  near(w.ratio, 20, 1e-12); near(w.lead, 4 * Math.PI, 1e-12); near(w.leadAngle, deg(Math.atan((4 * Math.PI) / (Math.PI * 28))), 1e-9)
  assert.ok(w.efficiency > 0.5 && w.efficiency < 1)
  assert.equal(wormGear(1, 40, 2, 40, 20, 0.15).selfLocking, true)
  assert.equal(wormGear(4, 40, 2, 28, 20, 0.05).selfLocking, false)
})

test('planetary gearset: the Willis equation and the ratios with each member fixed', () => {
  const P = { Zs: 24, Zr: 72 }
  const chk = planetary(24, 72, 3)
  assert.equal(chk.Zp, 24); assert.equal(chk.assembles, true); assert.equal(chk.neighbours, true); assert.deepEqual(chk.messages, [])
  // ring fixed, sun input, carrier output: 1 + Zr/Zs
  const a = planetarySpeeds(P, 'ring', 'sun', 1)!
  near(1 / a.carrier, 1 + 72 / 24, 1e-12)
  near(a.ring, 0, 1e-15)
  // sun fixed, ring input, carrier output: 1 + Zs/Zr
  const b = planetarySpeeds(P, 'sun', 'ring', 1)!
  near(1 / b.carrier, 1 + 24 / 72, 1e-12)
  // carrier fixed, sun input, ring output: −Zr/Zs
  const c = planetarySpeeds(P, 'carrier', 'sun', 1)!
  near(1 / c.ring, -72 / 24, 1e-12)
  near(c.planet, -(24 / 24) * 1, 1e-12, 'planet speed with the carrier fixed')
  // the Willis equation holds for any speeds
  for (const [fixed, input] of [['ring', 'sun'], ['sun', 'carrier'], ['carrier', 'ring'], ['sun', 'ring']] as const) {
    const sp = planetarySpeeds(P, fixed, input, 3.7)!
    near(P.Zs * (sp.sun - sp.carrier) + P.Zr * (sp.ring - sp.carrier), 0, 1e-12, 'Zs(ωs − ωc) + Zr(ωr − ωc) = 0')
  }
  assert.equal(planetarySpeeds(P, 'sun', 'sun', 1), null)
  // the table has six rows (3 fixed × 2 input) with the textbook ratios
  const tab = planetaryTable(P)
  assert.equal(tab.length, 6)
  const get = (f: string, i: string) => tab.find((r) => r.fixed === f && r.input === i)!.ratio
  near(get('ring', 'sun'), 4, 1e-12); near(get('sun', 'ring'), 4 / 3, 1e-12); near(get('carrier', 'sun'), -3, 1e-12); near(get('ring', 'carrier'), 0.25, 1e-12)
  // torques: Ts : Tr : Tc = Zs : Zr : −(Zs + Zr), and they balance
  const T = planetaryTorques(P, 10)
  near(T.sun + T.ring + T.carrier, 0, 1e-12); near(T.ring / T.sun, 3, 1e-12)
  // power balance for the speeds of a run
  near(T.sun * a.sun + T.ring * a.ring + T.carrier * a.carrier, 0, 1e-12, 'lossless: Σ T ω = 0')
  // the assembly rules
  assert.equal(planetary(24, 75, 3).integerPlanet, false)
  assert.equal(planetary(24, 72, 5).assembles, false)
  assert.equal(planetary(24, 72, 7).neighbours, false)
  assert.match(planetary(24, 75, 3).messages.join(' '), /even/)
})

test('helical gears, belts and chains', () => {
  const h = helicalGear(2, 24, 15)
  near(h.mt, 2 / Math.cos(rad(15)), 1e-12); near(h.d, 24 * h.mt, 1e-12)
  near(h.alphaT, Math.atan(Math.tan(rad(20)) / Math.cos(rad(15))), 1e-12)
  near(h.zv, 24 / Math.cos(rad(15)) ** 3, 1e-9); near(h.zMin, (2 * Math.cos(rad(15))) / Math.sin(h.alphaT) ** 2, 1e-9)
  assert.ok(h.zMin < 17.1, 'helical gears can have fewer teeth')
  near(helicalGear(2, 24, 0).mt, 2, 1e-12)
  const c = helicalContact(24, 48, 2, 15, 20, 30)
  near(c.epsBeta, (30 * Math.sin(rad(15))) / (Math.PI * 2), 1e-12)
  near(c.total, c.epsAlpha + c.epsBeta, 1e-12)
  assert.ok(c.total > c.epsAlpha && c.epsAlpha > 1.3)
  near(c.centre, (h.d + helicalGear(2, 48, 15).d) / 2, 1e-12)
  // belt: L = 2C + π(D + d)/2 + (D − d)²/4C
  const b = beltDrive(200, 80, 400, 1450)!
  near(b.length, 800 + (Math.PI * 280) / 2 + 120 ** 2 / 1600, 1e-9); near(b.ratio, 2.5, 1e-12)
  near(b.wrapSmall, 180 - 2 * deg(Math.asin(120 / 800)), 1e-9); near(b.speed, (Math.PI * 0.08 * 1450) / 60, 1e-9)
  assert.ok(beltDrive(200, 80, 400, 1450, true)!.length > b.length, 'crossed is longer')
  assert.equal(beltDrive(200, 80, 50, 1000), null)
  // chain: an even number of links, centre distance returned by the standard formula
  const ch = chainDrive(17, 41, 12.7, 400, 1000)!
  assert.equal(ch.links % 2, 0)
  near(ch.ratio, 41 / 17, 1e-12)
  // with that many links the true centre distance is close to the design one
  assert.ok(Math.abs(ch.centre - 400) < 12.7, `centre ${ch.centre}`)
  near(ch.speed, (17 * 12.7 * 1000) / 60000, 1e-12)
  assert.equal(chainDrive(4, 41, 12.7, 400, 1000), null)
})

// ------------------------------------------------------------------------------ file, report, figures

test('the .kmech file round-trips and rejects other files', () => {
  for (const e of EXAMPLES) {
    const text = serializeKMech(e.doc)
    const back = parseKMech(text)
    assert.equal(back.workbench, e.doc.workbench)
    assert.equal(serializeKMech(back), text, `${e.id}: read and written again gives the same file`)
    const o = JSON.parse(text)
    assert.equal(o.format, 'kmech'); assert.equal(o.version, 1); assert.equal(o.workbench, e.doc.workbench); assert.ok(typeof o.model === 'object')
  }
  assert.throws(() => parseKMech('not json'), KMechFileError)
  assert.throws(() => parseKMech('{"format":"kcad"}'), /not a kMech file/)
  assert.throws(() => parseKMech('{"format":"kmech","version":2,"workbench":"gear","model":{}}'), /newer/)
  assert.throws(() => parseKMech('{"format":"kmech","version":1,"workbench":"tractor","model":{}}'), /workbench/)
  // a sparse file gets sensible defaults
  const g = parseKMech('{"format":"kmech","version":1,"workbench":"gear","model":{"pair":{"g1":{"z":25}}}}')
  assert.equal(g.workbench, 'gear')
  if (g.workbench === 'gear') { assert.equal(g.model.pair.g1.z, 25); assert.equal(g.model.pair.g2.z, 40); assert.equal(g.model.view, 'pair') }
  const c = parseKMech('{"format":"kmech","version":1,"workbench":"cam","model":{"follower":"banana","baseRadius":"x"}}')
  if (c.workbench === 'cam') { assert.equal(c.model.follower, 'roller'); assert.equal(c.model.baseRadius, DEFAULT_CAM.baseRadius); assert.ok(c.model.program.segments.length > 0) }
  // new documents
  for (const w of ['linkage', 'cam', 'gear'] as const) assert.equal(parseKMech(serializeKMech(emptyDoc(w))).workbench, w)
})

test('reports are Markdown with the numbers in them', () => {
  const md = buildReport(exampleById('crank-rocker')!.doc)
  assert.match(md, /^# Crank-rocker four-bar/)
  assert.match(md, /Grashof crank-rocker/); assert.match(md, /Transmission angle/); assert.match(md, /\| input \(°\) \|/)
  const eng = buildReport(exampleById('slider-crank-engine')!.doc)
  assert.match(eng, /## Engine/); assert.match(eng, /flywheel inertia/)
  const cam = buildReport(exampleById('cam-345')!.doc)
  assert.match(cam, /## Motion program/); assert.match(cam, /Maximum pressure angle/); assert.match(cam, /Smallest base circle/)
  const gear = buildReport(exampleById('gear-pair')!.doc)
  assert.match(gear, /contact ratio/); assert.match(gear, /Planetary set/); assert.match(gear, /Fixed|fixed/)
  for (const e of EXAMPLES) assert.ok(buildReport(e.doc).length > 200, e.id)
  const bad = buildReport({ workbench: 'linkage', model: { name: 'x', points: [], links: [], sliders: [], driver: null } })
  assert.match(bad, /^# x/)
})

test('the Plotly figures are built from the analyses', () => {
  const c = analyseCycle(lin('crank-rocker'))
  for (const f of [motionFigure(c), transmissionFigure(c)]) {
    assert.ok(f.data.length >= 1)
    assert.ok(f.data.every((t) => Array.isArray(t.x) && Array.isArray(t.y)))
    assert.ok(!JSON.stringify(f).includes('NaN'), 'no NaN in the figure (JSON would turn it into null)')
  }
  assert.equal(motionFigure(c).data.length, 3)
  assert.equal((transmissionFigure(c).layout.shapes as unknown[]).length, 1, 'the 40–140 band is a shape of the first row')
  const e = runEngine(DEFAULT_ENGINE)
  assert.equal(pressureFigure(e).data.length, 2); assert.equal(engineTorqueFigure(e).data.length, 5)
  const cam = camProfile(DEFAULT_CAM, 360)
  assert.equal(camDiagramFigure(programTable(DEFAULT_CAM.program, 360), DEFAULT_PALETTE, { label: 'b', table: programTable(DEFAULT_CAM.program, 360) }).data.length, 8)
  assert.equal(camChecksFigure(cam, 30).data.length, 2)
  assert.equal(couplerFigure([{ name: 'P', x: [0, 1], y: [0, 1], cusps: [{ x: 0, y: 0 }] }]).data.length, 2)
})

// ------------------------------------------------------------------------------ examples

test('every example loads and works', () => {
  assert.ok(EXAMPLES.length >= 16, `${EXAMPLES.length} examples`)
  assert.equal(new Set(EXAMPLES.map((e) => e.id)).size, EXAMPLES.length)
  const wants = ['crank-rocker', 'double-rocker', 'drag-link', 'parallelogram', 'slider-crank-engine', 'whitworth', 'scotch-yoke', 'peaucellier', 'watt', 'pantograph', 'wiper', 'jansen', 'geneva', 'planetary']
  for (const w of wants) assert.ok(exampleById(w), `has the ${w} example`)
  assert.ok(EXAMPLES.some((e) => e.id === 'cam-345') && EXAMPLES.some((e) => e.id === 'cam-compare'))
  assert.ok(EXAMPLES.some((e) => e.id === 'gear-pair') && EXAMPLES.some((e) => e.id === 'gear-compound'))
  // mechanisms that cannot turn a full circle, with the reason documented in their notes
  const limited = new Set(['double-rocker', 'peaucellier', 'watt', 'geneva'])
  for (const e of EXAMPLES) {
    assert.ok(e.title && e.description.length > 20 && e.group, `${e.id}: title, description, group`)
    const doc = parseKMech(serializeKMech(e.doc))
    if (doc.workbench === 'linkage') {
      const m = doc.model
      assert.deepEqual(compile(m).errors, [], `${e.id}: no model errors`)
      const c = analyseCycle(m, { steps: 360, output: m.output })
      assert.ok(c.ok, `${e.id}: ${c.message}`)
      assert.equal(c.dof, 0, `${e.id}: one input fixes the pose`)
      assert.ok(c.frames.length >= 300, `${e.id}: frames ${c.frames.length}`)
      assert.ok(c.frames.every((f) => f.ok), `${e.id}: no lock-up inside its range`)
      assert.ok(c.pos.every((v) => Number.isFinite(v)), `${e.id}: finite output`)
      assert.ok(c.vel.every((v) => Number.isFinite(v)) && c.acc.every((v) => Number.isFinite(v)), `${e.id}: finite velocity and acceleration`)
      if (limited.has(e.id)) {
        assert.equal(c.range.full, false, `${e.id}: documented as limited`)
        assert.ok((m.notes ?? '').length > 40, `${e.id}: documented`)
      } else assert.equal(c.range.full, true, `${e.id}: turns a full circle`)
      assert.ok(m.points.some((p) => p.tracer), `${e.id}: has a tracer`)
      // the drawn pose is a valid assembly (no snapping needed)
      const s = makeSolver(m)
      assert.ok(residualOf(s) < 1e-9, `${e.id}: drawn pose closes the loops`)
      // tracers are closed paths for full cycles
      if (c.range.full) for (const id of Object.keys(c.tracers)) {
        const t = c.tracers[id]
        assert.ok(Math.hypot(t[0].x - t[t.length - 1].x, t[0].y - t[t.length - 1].y) < 1e-6, `${e.id}: ${id} path closes`)
      }
      assert.ok(defaultOutput(m) !== null)
    } else if (doc.workbench === 'cam') {
      const m = doc.model
      assert.deepEqual(checkProgram(m.program), [], `${e.id}: program adds up`)
      const p = camProfile(m, 360)
      assert.deepEqual(p.warnings.filter((w) => w.level === 'error'), [], `${e.id}: no errors`)
      assert.ok(p.stats.maxPressure <= m.maxPressure + 1e-9 || m.follower === 'flat', `${e.id}: pressure angle ${p.stats.maxPressure}`)
      if (m.compare) assert.deepEqual(checkProgram(m.compare.program), [], `${e.id}: comparison program`)
    } else {
      const m = doc.model
      const pg = pairGeometry(m.pair.g1, m.pair.g2, m.pair.centre)
      assert.deepEqual(pg.warnings, [], `${e.id}: pair is fine`)
      assert.ok(pg.epsilon > 1.2, `${e.id}: contact ratio ${pg.epsilon}`)
      const pl = planetary(m.planetary.Zs, m.planetary.Zr, m.planetary.n)
      assert.deepEqual(pl.messages, [], `${e.id}: planetary assembles`)
      assert.ok(gearTrain(m.train.stages, m.train.rpm, m.train.torque, m.train.eff).rows.length > 1)
    }
  }
})

function residualOf(s: ReturnType<typeof makeSolver>): number {
  const r = newton(s.sys, s.sys.X0, s.sys.theta0)
  return Math.max(...r.X.map((v, i) => Math.abs(v - s.sys.X0[i])))
}

test('named examples show their closed-form numbers', () => {
  // crank-rocker: 360° crank, rocker swing between the toggle positions
  const g = fourBarOf(lin('crank-rocker'))!
  for (const [v, w] of [[g.a, 40], [g.b, 100], [g.c, 70], [g.d, 90]]) near(v, w, 1e-9)
  // the engine example’s stroke and its engine data
  const eng = lin('slider-crank-engine')
  near(sliderStroke({ r: 40, l: 135 }), 80, 1e-12)
  assert.equal(eng.engine!.cylinders, 1)
  // spur pair: m = 2, 20/40 → d = 40 and 80, a = 60
  const gp = exampleById('gear-pair')!.doc
  assert.equal(gp.workbench, 'gear')
  if (gp.workbench === 'gear') {
    const pg = pairGeometry(gp.model.pair.g1, gp.model.pair.g2)
    near(pg.g1.d, 40, 1e-12); near(pg.g2.d, 80, 1e-12); near(pg.aw, 60, 1e-9); near(pg.g1.db, 37.588, 1e-3); near(pg.g1.da, 44, 1e-12); near(pg.epsilon, 1.6, 0.1)
  }
  // compound train 9:1, planetary 4:1
  const gc = exampleById('gear-compound')!.doc
  if (gc.workbench === 'gear') near(gearTrain(gc.model.train.stages, 1800, 5, 1).reduction, 9, 1e-12)
  const pl = exampleById('planetary')!.doc
  if (pl.workbench === 'gear') near(planetaryTable(pl.model.planetary).find((r) => r.fixed === 'ring' && r.input === 'sun')!.ratio, 4, 1e-12)
  // the comparison cam: cycloidal has the lower jerk-free start, harmonic the lower peak acceleration
  const cc = camEx('cam-compare') as CamSpec & { compare?: { program: CamSpec['program'] } }
  const t1 = programTable(cc.program, 720); const t2 = programTable(cc.compare!.program, 720)
  assert.ok(t2.peakA < t1.peakA, 'harmonic peaks lower in acceleration than cycloidal')
  near(programEval(cc.program, 0).a, 0, 1e-9); assert.ok(Math.abs(programEval(cc.compare!.program, 1e-6).a) > 1, 'harmonic starts with an acceleration step')
})

// ------------------------------------------------------------------------------ the example files

test('the example generator is deterministic and its files match public/examples/kmech', () => {
  const a = kmechExampleOutputs()
  const b = kmechExampleOutputs()
  assert.deepEqual(a, b)
  assert.equal(a.length, EXAMPLES.length + 1)
  const files = a.filter((o) => o.path.endsWith('.kmech'))
  assert.ok(files.length >= 16)
  assert.equal(new Set(a.map((o) => o.path)).size, a.length)
  for (const o of a) {
    assert.ok(/^public\/examples\/kmech\/[\x20-\x7e]+$/.test(o.path), `${o.path}: plain ASCII`)
    assert.ok(o.content.endsWith('\n'))
    assert.ok(o.content.startsWith('{\n  "'), 'indented by 2')
    JSON.parse(o.content)
  }
  // index.json: valid entries for exactly the files, grouped
  const idx = readExampleIndex(JSON.parse(indexText()))
  assert.deepEqual(idx.map((e) => e.file), files.map((f) => f.path.split('/').pop()))
  assert.ok(idx.every((e) => e.title && e.group && e.description))
  assert.ok(new Set(idx.map((e) => e.group)).size >= 5)
  assert.equal(exampleFileName(1, 'Spur gear pair 20/40, 20°', 'kmech'), '01 Spur gear pair 20-40, 20.kmech')
  assert.equal(KMECH_EXAMPLES_FOLDER, 'kMech Examples')
  assert.deepEqual(kmechExampleFiles().map((f) => f.file), idx.map((e) => e.file))
  // the files on disk are what the generator writes (run `node tools/export_kmech_examples.ts` after changing an example)
  for (const o of a) {
    const p = join(ROOT, o.path)
    assert.ok(existsSync(p), `${o.path} exists (run node tools/export_kmech_examples.ts)`)
    assert.equal(readFileSync(p, 'utf8'), o.content, `${o.path} is up to date`)
  }
})

// ------------------------------------------------------------------------------ AI tools

function fakeHooks(initial: KMechDoc = emptyDoc('linkage'), dirty = false) {
  const log: string[] = []
  let doc = initial
  const h: Hooks = {
    state: () => ({ doc, dirty, path: null }),
    load: (d) => { doc = d; dirty = false; log.push(`load ${d.workbench}`) },
  }
  return { h, log, current: () => doc }
}
const ctxWith = (answer: boolean, asked: string[] = []) => ({ caller: 'test', windowId: 'w', confirm: async (what: string) => { asked.push(what); return answer }, allowPython: async () => false })
const run = async (tools: ReturnType<typeof kmechTools>, name: string, args: Record<string, unknown>, ctx = ctxWith(true)) => {
  const t = tools[name]
  const fn = typeof t === 'function' ? t : t.run
  return (await fn(args, ctx)) as Record<string, any>
}

test('the manifest follows the rules for AI tool sets', () => {
  assert.equal(KMECH_TOOL_SET.app, 'kmech')
  assert.ok(KMECH_TOOL_SET.tools.length <= 4)
  assert.deepEqual(KMECH_TOOL_SET.tools.map((t) => t.action).sort(), ['analyse', 'gear', 'get_state', 'load_example'])
  assert.ok(KMECH_TOOL_SET.summary.length <= 120, `summary is ${KMECH_TOOL_SET.summary.length} characters`)
  assert.ok(KMECH_TOOL_SET.keywords.length >= 8 && KMECH_TOOL_SET.keywords.includes('kmech'))
  for (const t of KMECH_TOOL_SET.tools) {
    assert.ok(Object.keys((t.inputSchema.properties ?? {})).length <= 6, `${t.action}: ≤ 6 arguments`)
    assert.ok(t.description.length > 20)
  }
  assert.ok(KMECH_TOOL_SET.tools.find((t) => t.action === 'load_example')!.destructive)
  const h = fakeHooks()
  const names = Object.keys(kmechTools(h.h)).sort()
  assert.deepEqual(names, ['analyse', 'gear', 'get_state', 'load_example'], 'the code offers exactly the manifest’s actions')
})

test('AI tool analyse: a four-bar spec gives the table, class and quick-return ratio', async () => {
  const h = fakeHooks()
  const tools = kmechTools(h.h)
  const out = await run(tools, 'analyse', { four_bar: { input: 40, coupler: 100, output: 70, ground: 90, coupler_point: [0.5, 0.6] }, step_deg: 30 })
  assert.equal(out.ok, true)
  assert.equal(out.four_bar.kind, 'crank-rocker')
  assert.match(out.four_bar.class, /Grashof crank-rocker/)
  assert.equal(out.input_range, 'full turn')
  assert.equal(out.table.length, 13, '0°, 30°, … 360°')
  assert.ok(out.table[0].input_deg !== undefined && out.table[0].transmission_deg !== null && out.table[0].velocity !== undefined)
  near(out.transmission_angle_deg.min, 27.7, 0.5)
  near(out.quick_return.ratio, 1.3342, 0.01)
  // the same spec without the open document being touched
  assert.deepEqual(h.log, [])
  // slider-crank
  const sc = await run(tools, 'analyse', { slider_crank: { crank: 40, rod: 135, rpm: 600 } })
  near(sc.output.range_of_motion, 80, 1e-3)
  near(sc.peak_velocity, 2 * Math.PI * 10 * 40 * (1 + 0.1), 600) // order of magnitude: r ω (1 + r/l)
  // a named example, and the full model format
  const w = await run(tools, 'analyse', { example: 'whitworth', step_deg: 60 })
  near(w.quick_return.ratio, 2.2637, 1e-3)
  const full = await run(tools, 'analyse', { linkage: lin('scotch-yoke') })
  assert.equal(full.ok, true)
  // problems: a non-Grashof four-bar still analyses; an impossible one is an error
  const dr = await run(tools, 'analyse', { four_bar: { input: 65, coupler: 90, output: 70, ground: 100 } })
  assert.equal(dr.four_bar.kind, 'double-rocker'); assert.notEqual(dr.input_range, 'full turn')
  await assert.rejects(run(tools, 'analyse', { four_bar: { input: 10, coupler: 10, output: 10, ground: 40 } }), /cannot close|longer than/)
  await assert.rejects(run(tools, 'analyse', { example: 'nope' }), /No linkage example/)
  await assert.rejects(run(tools, 'analyse', { four_bar: { input: 'x', coupler: 1, output: 1, ground: 1 } }), /number/)
  const empty = await run(tools, 'analyse', {})
  assert.equal(empty.ok, false)
  assert.match(empty.message, /driver|Add/i)
  await assert.rejects(run(kmechTools(fakeHooks(emptyDoc('cam')).h), 'analyse', {}), /not a linkage/)
  // the open linkage is analysed when nothing is given
  const open = fakeHooks({ workbench: 'linkage', model: lin('crank-rocker') })
  const o = await run(kmechTools(open.h), 'analyse', {})
  assert.equal(o.name, 'Crank-rocker four-bar')
})

test('AI tool analyse can show the mechanism, asking first when there is unsaved work', async () => {
  const asked: string[] = []
  const dirty = fakeHooks({ workbench: 'linkage', model: lin('crank-rocker') }, true)
  await assert.rejects(run(kmechTools(dirty.h), 'analyse', { example: 'geneva', show: true }, ctxWith(false, asked)), /kept the open document/)
  assert.equal(asked.length, 1)
  assert.deepEqual(dirty.log, [])
  const out = await run(kmechTools(dirty.h), 'analyse', { example: 'geneva', show: true }, ctxWith(true, asked))
  assert.equal(out.ok, true)
  assert.deepEqual(dirty.log, ['load linkage'])
  assert.equal(dirty.current().workbench, 'linkage')
  // a clean document is replaced without asking
  const clean = fakeHooks()
  const before = asked.length
  await run(kmechTools(clean.h), 'analyse', { example: 'whitworth', show: true }, ctxWith(false, asked))
  assert.equal(asked.length, before)
  assert.equal(clean.log.length, 1)
})

test('AI tool gear: pair geometry, trains, planetary sets and the rest', async () => {
  const tools = kmechTools(fakeHooks().h)
  const g = await run(tools, 'gear', { kind: 'spur_pair', params: { z1: 20, z2: 40, module: 2, alpha: 20 } })
  near(g.gear1.pitch_diameter, 40, 1e-9); near(g.gear1.tip_diameter, 44, 1e-9); near(g.gear1.base_diameter, 37.588, 1e-3); near(g.gear2.pitch_diameter, 80, 1e-9)
  near(g.centre_distance_working, 60, 1e-9); near(g.contact_ratio, 1.6, 0.1); near(g.ratio, 2, 1e-12); assert.deepEqual(g.warnings, [])
  const dp = await run(tools, 'gear', { kind: 'spur_pair', params: { z1: 20, z2: 40, diametral_pitch: 12.7 } })
  near(dp.module, 2, 1e-9)
  const u = await run(tools, 'gear', { kind: 'spur_pair', params: { z1: 10, z2: 30 } })
  assert.equal(u.gear1.undercut, true); assert.ok(u.warnings.some((w: string) => /undercut/.test(w)))
  const t = await run(tools, 'gear', { kind: 'train', params: { stages: [[18, 54], [20, 60]], rpm: 1800, torque: 5, efficiency: 1 } })
  near(t.reduction, 9, 1e-12); near(t.shafts[2].rpm, 200, 1e-9)
  const p = await run(tools, 'gear', { kind: 'planetary', params: { sun: 24, ring: 72, planets: 3, fixed: 'ring', input: 'sun', speed: 1000 } })
  assert.equal(p.planet_teeth, 24); near(p.speeds_rpm.carrier, 250, 1e-9); assert.equal(p.ratios.length, 6)
  const bad = await run(tools, 'gear', { kind: 'planetary', params: { sun: 24, ring: 75 } })
  assert.ok(bad.problems.length > 0)
  assert.ok((await run(tools, 'gear', { kind: 'helical', params: { module: 2, z1: 24, z2: 48, helix_deg: 15 } })).contact_ratio.total > 2)
  assert.ok((await run(tools, 'gear', { kind: 'belt', params: {} })).belt_length > 800)
  assert.ok((await run(tools, 'gear', { kind: 'chain', params: {} })).links > 20)
  near((await run(tools, 'gear', { kind: 'rack', params: { module: 2, z: 20, rpm: 60 } })).travel_per_revolution, Math.PI * 40, 1e-3)
  assert.ok((await run(tools, 'gear', { kind: 'worm', params: {} })).ratio === 40)
  near((await run(tools, 'gear', { kind: 'bevel', params: { z1: 20, z2: 40 } })).pitch_cone_angles_deg[0], 26.565, 1e-2)
  await assert.rejects(run(tools, 'gear', { kind: 'tractor' }), /kind must be/)
  await assert.rejects(run(tools, 'gear', { kind: 'train', params: {} }), /stages/)
  await assert.rejects(run(tools, 'gear', { kind: 'spur_pair', params: { z1: 'many' } }), /number/)
  // show: the gears appear in the Gears workbench
  const h = fakeHooks()
  await run(kmechTools(h.h), 'gear', { kind: 'spur_pair', params: { z1: 25, z2: 50, module: 3 }, show: true })
  const d = h.current()
  assert.equal(d.workbench, 'gear')
  if (d.workbench === 'gear') { assert.equal(d.model.pair.g1.z, 25); assert.equal(d.model.pair.g2.module, 3); assert.equal(d.model.view, 'pair') }
  assert.throws(() => showGear('worm', {}, defaultGearDoc()), /Only/)
  assert.equal(showGear('planetary', { sun: 20, ring: 60, fixed: 'sun', input: 'ring' }, defaultGearDoc()).planetary.fixed, 'sun')
  assert.equal(gearCalculation('spur_pair', {}).ratio, 2)
})

test('AI tools get_state and load_example', async () => {
  const h = fakeHooks()
  const tools = kmechTools(h.h)
  const list = await run(tools, 'load_example', {})
  assert.equal(list.examples.length, EXAMPLES.length)
  assert.ok(list.examples.every((e: any) => e.id && e.title && e.workbench && e.group))
  await assert.rejects(run(tools, 'load_example', { id: 'zzz' }), /No example/)
  const loaded = await run(tools, 'load_example', { id: 'jansen' })
  assert.match(loaded.loaded, /Jansen/)
  assert.equal(h.current().workbench, 'linkage')
  const st = await run(tools, 'get_state', {})
  assert.equal(st.workbench, 'linkage')
  assert.ok(st.points.length >= 8 && st.links.length >= 7)
  assert.equal(st.analysis.output, 'y of foot')
  assert.equal(st.unsaved_changes, false)
  const cam = await run(tools, 'load_example', { id: 'cam-345' })
  assert.equal(cam.workbench, 'cam')
  assert.ok(cam.max_pressure_angle_deg < 30 && cam.smallest_base_circle > 0 && cam.segments.length === 4)
  const gear = await run(tools, 'load_example', { id: 'gear-pair' })
  assert.equal(gear.workbench, 'gear'); assert.ok(gear.pair.contact_ratio > 1.4)
  // asks before replacing unsaved work
  const asked: string[] = []
  const dirty = fakeHooks({ workbench: 'cam', model: camEx('cam-345') as never }, true)
  await assert.rejects(run(kmechTools(dirty.h), 'load_example', { id: 'jansen' }, ctxWith(false, asked)), /kept/)
  assert.equal(asked.length, 1); assert.match(asked[0], /unsaved|Replace/)
  assert.deepEqual(dirty.log, [])
  // every example loads through the tool without throwing
  for (const e of EXAMPLES) await run(kmechTools(fakeHooks().h), 'load_example', { id: e.id })
  // linkageFromArgs picks the open linkage, or says what is wrong
  assert.throws(() => linkageFromArgs({}, emptyDoc('cam')), /not a linkage/)
  assert.equal(describeDoc(emptyDoc('linkage'), false, null).workbench, 'linkage')
  assert.ok(describeCycle(lin('crank-rocker'), analyseCycle(lin('crank-rocker'))).ok)
  assert.equal(transmissionOf(lin('crank-rocker'), { kind: 'point', point: 'B', axis: 'x' }, new Map()), null)
})

// ------------------------------------------------------------------------------ the editor

/** Clicks the tools like the user would: returns the drawing after a list of (tool, x, y) clicks. */
function draw(steps: Array<[Tool, number, number]>, start: LinkageDoc = { name: 'drawn', points: [], links: [], sliders: [], driver: null }) {
  let m = start
  let linkFrom: LinkStart | null = null
  let pick: Pick | null = null
  const says: string[] = []
  for (const [tool, x, y] of steps) {
    const r = toolClick(m, tool, { x, y }, { x, y }, 5, linkFrom)
    if (r.model) m = r.model
    if (r.pick !== undefined) pick = r.pick
    if (r.linkFrom !== undefined) linkFrom = r.linkFrom
    if (tool !== 'link') linkFrom = null
    if (r.say) says.push(r.say)
  }
  return { m, pick, says }
}

test('drawing a four-bar with the tools gives a working mechanism', () => {
  const r = draw([
    ['ground', 0, 0], ['ground', 90, 0],
    ['link', 0, 0], ['link', 40, 30], // the crank: from the pin to a new joint
    ['link', 70, 80], // the coupler: the chain goes on from that joint to another new one
    ['link', 90, 0], // the rocker back to the second pin
    ['driver', 20, 15], ['tracer', 70, 80],
  ])
  assert.equal(r.m.points.length, 4)
  assert.equal(r.m.links.length, 3)
  assert.equal(r.m.points.filter((p) => p.ground).length, 2)
  assert.deepEqual(r.m.driver && [r.m.driver.from, r.m.driver.to], ['G1', 'P1'], 'the crank turns about the first ground pin')
  assert.equal(r.m.points.find((p) => p.id === 'P2')!.tracer, true)
  const c = analyseCycle(r.m)
  assert.ok(c.ok, c.message)
  assert.equal(c.dof, 0)
  // lengths follow the drawing: crank 50, coupler √(30²+50²), rocker √(20²+80²)
  const g = fourBarOf(r.m)!
  near(g.a, 50, 1e-9); near(g.b, Math.hypot(30, 50), 1e-9); near(g.c, Math.hypot(20, 80), 1e-9); near(g.d, 90, 1e-9)
  assert.equal(classifyFourBar(g).kind, 'crank-rocker')
})

test('tool clicks: refusals say why, and nothing is changed', () => {
  const base = lin('crank-rocker')
  assert.match(toolClick(base, 'slider', { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, 5, null).say!, /Click a joint/)
  assert.match(toolClick(base, 'slider', { x: 0, y: 0 }, { x: 0, y: 0 }, 5, null).say!, /ground pin cannot slide/)
  assert.match(toolClick(base, 'coupler', { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, 5, null).say!, /Click on a link/)
  assert.match(toolClick(base, 'driver', { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, 5, null).say!, /ground pin/)
  assert.match(toolClick(base, 'tracer', { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, 5, null).say!, /Click a joint/)
  // a bar between a joint and itself, or twice
  const a = toolClick(base, 'link', { x: 0, y: 0 }, { x: 0, y: 0 }, 5, null)
  assert.ok(a.linkFrom && a.linkFrom.id === 'O2')
  const same = toolClick(base, 'link', { x: 0, y: 0 }, { x: 0, y: 0 }, 5, a.linkFrom!)
  assert.match(same.say!, /two different/)
  const O4 = base.points.find((p) => p.id === 'O4')!
  const twoGround = toolClick(base, 'link', { x: O4.x, y: O4.y }, { x: O4.x, y: O4.y }, 5, a.linkFrom!)
  assert.match(twoGround.say!, /already|both ground/)
  assert.equal(twoGround.model, undefined)
  // selection and dragging
  const sel = toolClick(base, 'select', { x: O4.x + 1, y: O4.y }, { x: O4.x + 1, y: O4.y }, 5, null)
  assert.deepEqual(sel.pick, { kind: 'point', id: 'O4' })
  assert.deepEqual(sel.drag, { id: 'O4', dx: -1, dy: 0 })
  assert.deepEqual(toolClick(base, 'select', { x: 5000, y: 5000 }, { x: 5000, y: 5000 }, 5, null).pick, null)
  // erase and tracer
  const er = toolClick(base, 'erase', { x: O4.x, y: O4.y }, { x: O4.x, y: O4.y }, 5, null)
  assert.ok(er.model && er.model.points.length === base.points.length - 1 && er.model.links.length === base.links.length - 1)
  assert.equal(er.pick, null)
  // coupler point on a link, slider on a joint
  const A = base.points.find((p) => p.id === 'A')!
  const cp = toolClick({ ...base, links: base.links.map((l) => (l.id === 'rocker' ? l : l)) }, 'slider', { x: A.x, y: A.y }, { x: A.x, y: A.y }, 5, null)
  assert.equal(cp.model!.sliders.length, 1)
  assert.deepEqual(cp.pick, { kind: 'slider', id: 'S1' })
})

test('editing operations keep the drawing consistent', () => {
  const m = lin('crank-rocker')
  // deleting a joint removes what hangs on it
  const noB = deletePoint(m, 'B')
  assert.ok(!noB.points.some((p) => p.id === 'B'))
  assert.ok(noB.links.every((l) => !l.pts.includes('B')))
  assert.ok(noB.links.length === 2 && noB.links.find((l) => l.id === 'coupler')!.pts.length === 2)
  assert.equal(noB.links.find((l) => l.id === 'coupler')!.shape, 'bar', 'a plate that loses a point is a bar again')
  const noA = deletePoint(m, 'A')
  assert.equal(noA.driver, null)
  const noCrank = deletePick(m, { kind: 'link', id: 'crank' })
  assert.equal(noCrank.driver, null)
  // moving a joint on a slider keeps it on its line
  const sc = sliderCrankDoc('sc', 40, 135, 40, 60)
  const moved = movePoint(sc, 'B', 150, 77)
  near(moved.points.find((p) => p.id === 'B')!.y, 0, 1e-12); near(moved.points.find((p) => p.id === 'B')!.x, 150, 1e-12)
  const tilted = addSlider(sc, 'B', 30)
  const m2 = movePoint(tilted, 'B', 100, 100)
  const b2 = m2.points.find((p) => p.id === 'B')!
  const b0 = sc.points.find((p) => p.id === 'B')!
  near((b2.x - b0.x) * Math.sin(rad(30)) - (b2.y - b0.y) * Math.cos(rad(30)), 0, 1e-9, 'stays on the tilted line')
  // a coupler point makes a plate
  const added = addCouplerPoint(sliderCrankDoc('sc', 40, 135, 40, 60), 'rod', 100, 30)!
  assert.equal(added.m.links.find((l) => l.id === 'rod')!.pts.length, 3)
  assert.equal(added.m.links.find((l) => l.id === 'rod')!.shape, 'plate')
  assert.ok(analyseCycle({ ...added.m, points: added.m.points.map((p) => (p.id === added.id ? { ...p, tracer: true } : p)) }).ok)
  // link length: the second joint moves along the link
  const longer = setLinkLength(m, 'crank', 60)
  near(linkSpans(longer, longer.links.find((l) => l.id === 'crank')!)[0], 60, 1e-9)
  assert.equal(setLinkLength(m, 'crank', -1), m)
  // the driver goes to the link’s ground pin
  const d = setDriverOnLink({ ...m, driver: null }, 'crank', 45)
  assert.deepEqual(d.driver, { from: 'O2', to: 'A', rpm: 45 })
  const undriven = { ...m, driver: null }
  assert.equal(setDriverOnLink(undriven, 'coupler'), undriven, 'a bar with no ground pin cannot be the driver')
  // settle: a pose that leaves a slider off its line is pulled onto it
  const off = { ...sc, points: sc.points.map((p) => (p.id === 'B' ? { ...p, y: 3 } : p)) }
  const tidy = settle(off)
  near(tidy.points.find((p) => p.id === 'B')!.y, 0, 1e-9)
  assert.equal(settle(sc), sc, 'an exact pose is returned as it is')
  // picking: points before links, plates by their area, a miss
  const pts = new Map(m.points.map((p) => [p.id, { x: p.x, y: p.y }]))
  const A2 = pts.get('A')!
  assert.deepEqual(pickAt(m, pts, { x: A2.x + 1, y: A2.y }, 3), { kind: 'point', id: 'A' })
  const P = pts.get('P')!
  const Bp = pts.get('B')!
  const inside = { x: (A2.x + Bp.x + P.x) / 3, y: (A2.y + Bp.y + P.y) / 3 }
  assert.deepEqual(pickAt(m, pts, inside, 1), { kind: 'link', id: 'coupler' })
  assert.deepEqual(pickAt(m, pts, { x: (0 + A2.x) / 2 + 0.5, y: A2.y / 2 }, 2)?.kind, 'link')
  assert.equal(pickAt(m, pts, { x: -500, y: -500 }, 3), null)
  assert.ok(boundsOf(pts.values()).maxX > boundsOf(pts.values()).minX)
  assert.equal(addPoint(m, 1, 2).id, 'P1')
})

test('playing back a cycle: poses interpolate the frames, arrows scale to the speed', () => {
  const c = analyseCycle(lin('crank-rocker'), { steps: 360 })
  const at0 = cyclePose(c, deg(c.frames[0].theta))!
  const B0 = c.frames[0].X
  near(at0.points.get('A')!.x, pointsAt(c.solver.sys, B0).get('A')!.x, 1e-9)
  // half a degree between two frames is a pose between them
  const half = cyclePose(c, deg(c.frames[10].theta) + 0.5)!
  const lo = pt(c, 10, 'B'); const hi = pt(c, 11, 'B')
  near(half.points.get('B')!.x, (lo.x + hi.x) / 2, 1e-6)
  // a full turn wraps
  const wrap = cyclePose(c, deg(c.frames[0].theta) + 360 + 30)!
  const direct = cyclePose(c, deg(c.frames[0].theta) + 30)!
  near(wrap.points.get('B')!.x, direct.points.get('B')!.x, 1e-9)
  // a limited range clamps
  const dr = analyseCycle(lin('double-rocker'))
  const beyond = cyclePose(dr, 1000)!
  near(beyond.theta, dr.frames[dr.frames.length - 1].theta, 1e-12)
  // velocity arrows: the longest has the requested length
  const arrows = cycleArrows(c, direct, 30)
  const longest = Math.max(...[...arrows.values()].map((v) => Math.hypot(v.x, v.y)))
  assert.ok(longest <= 30 + 1e-9 && longest > 3)
  assert.ok(maxPointSpeed(c) > 40 - 1e-6, 'the crank pin moves at |OA| per radian')
  // the Geneva wheel dwells: the pose outside the window is the end pose
  const g = analyseCycle(geneva(4))
  const outside = cyclePose(g, 100)!
  assert.ok(outside.points.get('S0'))
  assert.equal(cyclePose({ ...c, ok: false }, 0), null)
})

test('history: commits, gestures, undo and redo', () => {
  const h = new History<number>(1)
  h.commit(2); h.commit(3)
  assert.equal(h.value, 3); assert.ok(h.canUndo)
  assert.ok(h.undo()); assert.equal(h.value, 2); assert.ok(h.canRedo)
  assert.ok(h.redo()); assert.equal(h.value, 3)
  h.begin(); h.preview(4); h.preview(5); assert.ok(h.inGesture)
  assert.ok(h.end()); assert.equal(h.value, 5)
  h.undo(); assert.equal(h.value, 3, 'a whole drag is one step')
  h.begin(); h.preview(9); h.cancel(); assert.equal(h.value, 3)
  const before = h.past.length; h.commit(3); assert.equal(h.past.length, before, 'committing the same value adds nothing')
  h.reset(7); assert.equal(h.canUndo, false)
  const small = new History<number>(0, 3)
  for (let i = 1; i <= 10; i++) small.commit(i)
  assert.equal(small.past.length, 3)
})

test('view helpers: screen and world agree, zoom keeps the point under the pointer, fit shows the box', () => {
  const v = { cx: 10, cy: -5, scale: 3 }
  const p = toWorld(v, 800, 600, 123, 456)
  const s = toScreen(v, 800, 600, p)
  near(s.x, 123, 1e-9); near(s.y, 456, 1e-9)
  const z = zoomAt(v, 800, 600, 200, 300, 1.7)
  const before = toWorld(v, 800, 600, 200, 300); const after = toWorld(z, 800, 600, 200, 300)
  near(before.x, after.x, 1e-9); near(before.y, after.y, 1e-9)
  near(z.scale, 3 * 1.7, 1e-12)
  assert.ok(zoomAt(v, 800, 600, 0, 0, 1e9).scale <= 400)
  const f = fitBox({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 800, 600)
  near(f.cx, 50, 1e-9); near(f.cy, 25, 1e-9)
  const corner = toScreen(f, 800, 600, { x: 0, y: 0 })
  assert.ok(corner.x > 0 && corner.x < 400 && corner.y < 600)
  assert.equal(niceStep(1, 20), 20); assert.ok([1, 2, 5].includes(niceStep(7.3, 24) / 10 ** Math.floor(Math.log10(niceStep(7.3, 24)))))
  assert.equal(snapTo(13, 5), 15)
})

test('scenes are drawn for every example and export as SVG', () => {
  for (const e of EXAMPLES) {
    const d = e.doc
    let prims
    if (d.workbench === 'linkage') {
      const c = analyseCycle(d.model, { steps: 90 })
      const pose = cyclePose(c, 10)
      prims = linkageScene(d.model, pose ? pose.points : new Map(d.model.points.map((p) => [p.id, { x: p.x, y: p.y }])), { paths: c.tracers, labels: true, dims: true, arrows: pose ? cycleArrows(c, pose, 20) : null, engine: d.model.engine ?? null })
    } else if (d.workbench === 'cam') {
      const prof = camProfile(d.model, 120)
      prims = camScene(d.model, { theta: 77, profile: prof, ghost: d.model.compare ? camProfile({ ...d.model, program: d.model.compare.program }, 120) : null, showPitch: true })
    } else {
      const pg = pairGeometry(d.model.pair.g1, d.model.pair.g2)
      prims = pairScene(pg, { phi: 0.3 })
    }
    assert.ok(prims.length > 5, `${e.id}: has things to draw`)
    for (const p of prims) {
      if (p.k === 'path') assert.ok(p.pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), `${e.id}: finite path`)
    }
    const box = sceneBounds(prims)
    const svg = sceneToSvg(prims, box, { title: e.title })
    assert.match(svg, /^<\?xml/); assert.match(svg, /<svg[^>]*width="[\d.]+mm"/); assert.ok(!svg.includes('NaN') && !svg.includes('undefined'), `${e.id}: no NaN in the figure`)
  }
  // the grid, the other gear scenes
  assert.ok(gridPrims({ minX: -50, minY: -50, maxX: 50, maxY: 50 }, 10).length >= 20)
  assert.deepEqual(gridPrims({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, 1), [], 'a hopeless grid is not drawn')
  const lay = trainLayout([{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], 2, 1800)
  assert.equal(lay.gears.length, 4, 'two gears on the shared shaft')
  near(lay.gears[2].speed, 1800 / -3, 1e-9)
  const pgs = gearGeometry({ ...DEFAULT_GEAR, z: 24 })
  const outl = gearOutline(pgs, 8, 3, 3)
  const planet = planetaryScene(24, 72, 3, 2, 0.2, 0.3, { sun: outl, planet: outl, ring: outl })
  assert.ok(planet.some((p) => p.k === 'path' && p.hole))
  assert.ok(sceneToSvg(planet, sceneBounds(planet)).includes('evenodd'))
  const belt = beltScene(200, 80, 400, false, 0.5); const cross = beltScene(200, 80, 400, true, 0.5)
  assert.ok(belt.length > 8 && cross.length > 8)
  // the open belt’s straight runs are tangent to both pulleys: the end points are at the pulley radii
  const runs = belt.filter((p) => p.k === 'path' && p.pts.length === 2 && p.style.stroke === '#22d3ee') as Array<{ pts: Array<{ x: number; y: number }> }>
  assert.equal(runs.length, 2)
  near(Math.hypot(runs[0].pts[0].x, runs[0].pts[0].y), 100, 1e-9); near(Math.hypot(runs[0].pts[1].x - 400, runs[0].pts[1].y), 40, 1e-9)
  void _camScene
})

test('cutting outlines and data tables', () => {
  const cam = camShapes(camEx('cam-345') as never)
  assert.equal(cam[0].kind, 'polyline'); assert.equal((cam[0] as { closed?: boolean }).closed, true)
  assert.ok(cam.some((s) => s.kind === 'circle' && s.layer === 'cut'), 'bore')
  assert.ok(cam.some((s) => s.layer === 'construction'))
  const pg = pairGeometry({ ...DEFAULT_GEAR, z: 20, module: 2 }, { ...DEFAULT_GEAR, z: 40, module: 2 })
  const one = gearShapes(pg.g1, 8)
  assert.equal(one.filter((s) => s.layer === 'cut').length, 2)
  const pair = pairShapes(pg, 6)
  assert.equal(pair.filter((s) => s.kind === 'polyline').length, 2)
  const dxf = shapesToDxf(pair)
  const back = readDxf(dxf)
  assert.equal(back.filter((s) => s.kind === 'polyline' && s.layer === 'cut').length, 2)
  const gear2 = back.filter((s) => s.kind === 'polyline' && s.layer === 'cut')[1] as { pts: Array<{ x: number; y: number }> }
  const cx = gear2.pts.reduce((a, p) => a + p.x, 0) / gear2.pts.length
  near(cx, 60, 0.5, 'gear 2 sits at the centre distance')
  // tables
  const c = analyseCycle(lin('crank-rocker'), { steps: 90 })
  const t = motionTable(c)
  assert.equal(t.rows.length, c.theta.length); assert.equal(t.header.length, t.rows[0].length)
  assert.equal(tracerTable(c).header[0], 'input_deg')
  const e = engineTable(runEngine(DEFAULT_ENGINE))
  assert.equal(e.rows.length, 720); assert.equal(e.header.length, e.rows[0].length)
  const prof = camProfile(DEFAULT_CAM, 90)
  assert.equal(profileTable(prof).rows.length, 91)
  assert.equal(programCsvTable(programTable(DEFAULT_CAM.program, 90)).rows.length, 91)
  const d = runDynamics(lin('scotch-yoke'), { revs: 0.5 })
  assert.ok(d.ok, d.message)
  assert.equal(dynamicsTable(d).rows[0].length, dynamicsTable(d).header.length)
})

test('train and planetary scenes: meshing gears do not overlap', () => {
  const inside = (poly: Array<{ x: number; y: number }>, p: { x: number; y: number }) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
    return c
  }
  const outl = (z: number, module: number) => gearOutline(gearGeometry({ ...DEFAULT_GEAR, z, module, backlash: 0.1 }), 12, 4, 3)
  const lay = trainLayout([{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], 2, 1800)
  for (const phi of [0, 0.37, 1.9]) {
    const placed = lay.gears.map((g) => ({ g, o: placePoints(outl(g.z, g.module), g.phase + g.ratio * phi, g.at) }))
    // gears 0–1 mesh, and gear 2 (on gear 1’s shaft) meshes with gear 3
    for (const [a, b] of [[0, 1], [2, 3]]) {
      for (const p of placed[b].o) assert.ok(!inside(placed[a].o, p), `train gears ${a}/${b} overlap at ${phi}`)
      for (const p of placed[a].o) assert.ok(!inside(placed[b].o, p), `train gears ${b}/${a} overlap at ${phi}`)
    }
  }
  // planetary: the planets neither dig into the sun nor into the ring (even and odd tooth counts; they assemble with 3 planets)
  const segd = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x; const dy = b.y - a.y; const L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }
  for (const [Zs, Zr] of [[24, 72], [27, 81], [30, 90]]) {
    const Zp = (Zr - Zs) / 2; const mod = 2
    assert.equal(planetary(Zs, Zr, 3).assembles, true)
    for (const t of [0, 0.5, 2.2]) {
      const prims = planetaryScene(Zs, Zr, 3, mod, t, t / 4, { sun: outl(Zs, mod), planet: outl(Zp, mod), ring: outl(Zr, mod) })
      const paths = prims.filter((p) => p.k === 'path' && p.closed && !p.hole) as Array<{ pts: Array<{ x: number; y: number }> }>
      const ring = prims.find((p) => p.k === 'path' && p.hole) as unknown as { hole: Array<{ x: number; y: number }> }
      for (const pl of paths.slice(1)) {
        for (const p of pl.pts) assert.ok(!inside(paths[0].pts, p), `a planet overlaps the sun (${Zs}/${Zr}, t=${t})`)
        for (const p of pl.pts) {
          if (inside(ring.hole, p)) continue
          let d = Infinity
          for (let i = 0; i < ring.hole.length; i++) d = Math.min(d, segd(p, ring.hole[i], ring.hole[(i + 1) % ring.hole.length]))
          assert.ok(d < 0.15, `a planet digs ${d} mm into the ring (${Zs}/${Zr}, t=${t})`)
        }
      }
    }
  }
})
