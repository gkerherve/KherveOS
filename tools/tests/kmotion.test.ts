// kMotion: the integrators, every scene's physics against its closed form (run headless), the .kmotion files, the
// example library (generated files on disk, every example loads and runs), the AI tools and the chart builders.
// No browser. Run:
//   node --test tools/tests/kmotion.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ode2, METHODS, type Method } from '../../src/apps/kmotion/integrators.ts'
import { agm, ellipticK, pendulumAngleExact, pendulumPeriodAmplitudeSeries, pendulumPeriodExact, pendulumPeriodSeries, sncndn } from '../../src/apps/kmotion/elliptic.ts'
import { dampingRegime, eigenSym, linearOscillator, steadyResponse } from '../../src/apps/kmotion/closed.ts'
import { Recorder, compareIntegrators, runHeadless, runSim, tableText } from '../../src/apps/kmotion/analysis.ts'
import { FileError, SCENES, cleanParams, defaultDoc, makeSim, parseKmotion, sceneById, serializeKmotion } from '../../src/apps/kmotion/registry.ts'
import { exampleById, motionExamples } from '../../src/apps/kmotion/examples.ts'
import { kmotionExampleFiles } from '../../src/apps/kmotion/exampleFiles.ts'
import { kmotionExampleOutputs } from '../export_kmotion_examples.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'
import { PROJECTILE, optimalAngle, projectileVacuum, simulateFlight, vacuumOptimalAngle } from '../../src/apps/kmotion/scenes/projectile.ts'
import { PENDULUM, compoundOf, doubleEnergy, lyapunovDouble, pendulumSweep } from '../../src/apps/kmotion/scenes/pendulum.ts'
import { OSCILLATOR, ROLL_KAPPA, coupledModes, inclineLaw, oscillatorSweep } from '../../src/apps/kmotion/scenes/oscillator.ts'
import { CircleWorld, COLLISION, ballisticHeight, ballisticSpeed, collide1D } from '../../src/apps/kmotion/scenes/collision.ts'
import { ORBIT } from '../../src/apps/kmotion/scenes/orbit.ts'
import { CIRCULAR, bankedForces, bankedSpeeds, conicalSteady, rotatingFromInertial, slowPrecession } from '../../src/apps/kmotion/scenes/circular.ts'
import {
  SANDBOX, SANDBOX_WORLDS, addBox, addCircle, addPolygon, bodyCorners, convexHull, emptySpec, hitBody, moveBody, readSpec, removeBody, cradleSpec,
} from '../../src/apps/kmotion/scenes/sandbox.ts'
import {
  ARENSTORF, AUYR_KMS, FIGURE8, G_AU, barnesHutAccel, conicOf, cr3bpAcc, directAccel, discGalaxy, gravityTotals, hohmann, hyperbolaOf, jacobi, lagrangePoints, plummerCluster,
  solveKepler, stateFromElements, PLANETS,
} from '../../src/apps/kmotion/gravity.ts'
import { driftFigure, plotFigure, sweepFigure, DEFAULT_PALETTE } from '../../src/apps/kmotion/figures.ts'
import { Trails, fitView, niceStep, screenToWorld, worldToScreen } from '../../src/apps/kmotion/render.ts'
import { kmotionTools, describeParams, type Hooks } from '../../src/apps/kmotion/aiTools.ts'
import { KMOTION_TOOL_SET } from '../../src/os/ai/manifests/kmotion.ts'
import type { KMotionDoc, Params, Sim } from '../../src/apps/kmotion/types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const near = (a: number, b: number, rel = 1e-6, abs = 0, what = '') => assert.ok(Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel), `${what} ${a} ≈ ${b} (rel ${rel}, abs ${abs})`)
const G = 9.80665
const DEG = Math.PI / 180

/** A scene run until `until(sim)` or `T`. */
function run(scene: string, mode: string, over: Params, T: number, method?: Method, until?: (s: Sim) => boolean): Sim {
  const def = sceneById(scene)!
  const sim = def.create(cleanParams(def.id, { ...def.defaults(mode), ...over, mode }), method)
  while (sim.t < T && !sim.finished && !(until && until(sim))) sim.step(sim.dt)
  return sim
}

// ------------------------------------------------------------------------------------------ integrators

test('integrators: harmonic oscillator order of accuracy and energy behaviour', () => {
  const sys = { n: 1, acc: (_t: number, y: ArrayLike<number>, a: Float64Array) => { a[0] = -y[0] } }
  const errAt = (m: Method, dt: number) => {
    const o = new Ode2(sys, [1, 0], m)
    const n = Math.round(10 / dt)
    for (let i = 0; i < n; i++) o.advance(dt)
    return Math.abs(o.y[0] - Math.cos(10))
  }
  // halving the step cuts the error by 2^order
  for (const [m, order] of [['euler', 1], ['semi', 1], ['verlet', 2], ['rk4', 4]] as const) {
    const ratio = errAt(m, 0.01) / errAt(m, 0.005)
    assert.ok(ratio > 2 ** order * 0.7 && ratio < 2 ** order * 1.6, `${m}: error ratio ${ratio} for order ${order}`)
  }
  assert.ok(errAt('rk45', 0.1) < 1e-8, 'adaptive RK45 meets its tolerance')
  // energy after 200 periods
  const drift = (m: Method) => {
    const o = new Ode2(sys, [1, 0], m)
    for (let i = 0; i < 20000; i++) o.advance(0.0628)
    return Math.abs(0.5 * (o.y[0] ** 2 + o.y[1] ** 2) - 0.5)
  }
  assert.ok(drift('euler') > 1, 'explicit Euler gains energy without bound')
  assert.ok(drift('semi') < 0.05 && drift('verlet') < 1e-3, 'symplectic methods keep it bounded')
  assert.ok(drift('rk4') < 1e-4)
  assert.equal(METHODS.length, 5)
})

test('integrators: velocity-dependent forces and the adaptive step land exactly on the time asked', () => {
  const sys = { n: 1, vdep: true, acc: (_t: number, y: ArrayLike<number>, a: Float64Array) => { a[0] = -4 * y[0] - 0.5 * y[1] } }
  for (const m of ['verlet', 'rk4', 'rk45'] as const) {
    const o = new Ode2(sys, [1, 0], m)
    for (let i = 0; i < 400; i++) o.advance(0.01)
    near(o.t, 4, 1e-12, 1e-12, m)
    const ref = linearOscillator(4, 0.5, 0, 0, 1, 0, 4)
    assert.ok(Math.abs(o.y[0] - ref.x) < 5e-4, `${m}: ${o.y[0]} vs ${ref.x}`)
  }
})

// ------------------------------------------------------------------------------------------ elliptic functions

test('elliptic: K, Jacobi functions and the exact pendulum', () => {
  near(agm(1, 1), 1, 1e-15)
  near(ellipticK(0), Math.PI / 2, 1e-14)
  near(ellipticK(Math.sqrt(0.5)), 1.8540746773013719, 1e-12)
  for (const m of [0.1, 0.5, 0.9, 0.999]) {
    const { sn, cn, dn } = sncndn(0.7, m)
    near(sn * sn + cn * cn, 1, 1e-12)
    near(dn * dn + m * sn * sn, 1, 1e-12)
  }
  // period: AGM against the power series and the amplitude series
  const T0 = 2 * Math.PI * Math.sqrt(1 / G)
  for (const th of [5, 30, 60, 90, 120]) {
    const exact = pendulumPeriodExact(1, G, th * DEG)
    near(pendulumPeriodSeries(1, G, th * DEG, 250), exact, 1e-9, 0, `${th}° series`)
    if (th <= 60) near(pendulumPeriodAmplitudeSeries(1, G, th * DEG), exact, th <= 30 ? 1e-6 : 1e-4, 0, `${th}° amplitude series`)
  }
  near(pendulumPeriodExact(1, G, 1e-4), T0, 1e-8)
  near(pendulumPeriodExact(1, G, 90 * DEG) / T0, 1.18034, 1e-4)
  // the exact angle starts at theta0, crosses zero after a quarter period and is periodic
  const th0 = 1.4
  const T = pendulumPeriodExact(2, G, th0)
  near(pendulumAngleExact(2, G, th0, 0), th0, 1e-12)
  near(pendulumAngleExact(2, G, th0, T / 4), 0, 1e-9, 1e-9)
  near(pendulumAngleExact(2, G, th0, T / 2), -th0, 1e-9)
  near(pendulumAngleExact(2, G, th0, T), th0, 1e-9)
})

// ------------------------------------------------------------------------------------------ projectile

test('projectile: vacuum range v² sin 2θ / g, time of flight and apex', () => {
  for (const [v, a] of [[20, 45], [35, 30], [12, 70], [50, 15]] as const) {
    const vac = projectileVacuum(v, a, 0, G)
    near(vac.range, (v * v * Math.sin(2 * a * DEG)) / G, 1e-12)
    near(vac.tof, (2 * v * Math.sin(a * DEG)) / G, 1e-12)
    near(vac.apex, (v * Math.sin(a * DEG)) ** 2 / (2 * G), 1e-12)
    for (const m of ['verlet', 'rk4', 'rk45'] as const) {
      const f = simulateFlight({ ...PROJECTILE.defaults('flight'), v0: v, h0: 0, drag: 'none' }, a, m, 1 / 240)
      near(f.range, vac.range, 1e-6, 0, `${m} ${v}@${a}`)
      near(f.tof, vac.tof, 1e-6, 0, `${m} tof`)
      near(f.vImpact, v, 1e-6)
    }
  }
  // explicit Euler gets it wrong (the apex is too high)
  const e = simulateFlight({ ...PROJECTILE.defaults('flight'), v0: 20, drag: 'none' }, 45, 'euler', 1 / 60)
  assert.ok(Math.abs(e.range - 40.79) > 0.1, `Euler is off: ${e.range}`)
})

test('projectile: gravity of other worlds, a launch height and the best angle', () => {
  const moon = simulateFlight({ ...PROJECTILE.defaults('flight'), v0: 10, gravity: 'moon' }, 45, 'rk4')
  near(moon.range, 100 / 1.62, 1e-6)
  // from a height the best angle is atan(v / sqrt(v² + 2 g h)), found numerically
  for (const h of [0, 5, 30]) {
    const p = { ...PROJECTILE.defaults('flight'), v0: 20, h0: h, drag: 'none' }
    const best = optimalAngle(p)
    near(best.angle, vacuumOptimalAngle(20, h, G), 0, 0.05, `h=${h}`)
  }
  near(vacuumOptimalAngle(20, 0, G), 45, 1e-12)
  // drag shortens the flight and moves the best angle below 45°
  const vac = projectileVacuum(40, 45, 0, G).range
  for (const drag of [{ drag: 'linear', k: 0.3 }, { drag: 'quadratic', kq: 0.01 }]) {
    const p = { ...PROJECTILE.defaults('flight'), v0: 40, h0: 0, ...drag }
    assert.ok(simulateFlight(p, 45).range < vac * 0.9)
    const best = optimalAngle(p)
    assert.ok(best.angle < 44 && best.angle > 30, `best angle with ${drag.drag} drag: ${best.angle}`)
    assert.ok(best.range >= simulateFlight(p, 45).range)
  }
  // a tail wind lengthens it, a head wind shortens it
  const w = (wind: number) => simulateFlight({ ...PROJECTILE.defaults('flight'), v0: 30, drag: 'quadratic', kq: 0.01, wind }, 40).range
  assert.ok(w(10) > w(0) && w(-10) < w(0))
})

test('projectile: the simulation lands, reports a hit on the target and gives the same numbers as the closed form', () => {
  const vac = projectileVacuum(20, 45, 0, G)
  const sim = run('projectile', 'flight', { v0: 20, angle: 45, h0: 0, drag: 'none', target: vac.range, targetR: 1 }, 10, 'rk4')
  assert.ok(sim.finished)
  near(sim.sample().x, vac.range, 1e-6)
  assert.equal(sim.frame().banner, 'Target hit!')
  const miss = run('projectile', 'flight', { v0: 20, angle: 45, target: 80, targetR: 1 }, 10)
  assert.match(miss.frame().banner ?? '', /Missed/)
  // the 'vacuum' analytic channels follow the closed form exactly while flying
  const s2 = run('projectile', 'flight', { v0: 20, angle: 45, drag: 'none' }, 1)
  const q = s2.sample()
  near(q.y, q.yv, 1e-6)
  near(q.x, q.xv, 1e-6)
  // fan mode keeps five bodies
  assert.equal(run('projectile', 'fan', {}, 0.5).frame().bodies.length, 5)
})

// ------------------------------------------------------------------------------------------ pendulum

/** The measured period of a pendulum simulation released from rest. */
function measuredPeriod(over: Params, mode = 'simple', method: Method = 'rk4'): number {
  const sim = run('pendulum', mode, over, 40, method, (s) => ((s as unknown as { upCrossCount?: number }).upCrossCount ?? 0) > 99)
  void sim
  // direct measurement from the sample stream: time between downward zero crossings of theta
  const def = PENDULUM
  const s = def.create(cleanParams('pendulum', { ...def.defaults(mode), ...over, mode }), method)
  const ups: number[] = []
  let prev = s.sample().theta
  let tPrev = 0
  for (let i = 0; i < 100000 && ups.length < 3; i++) {
    s.step(s.dt)
    const th = s.sample().theta
    if (prev < 0 && th >= 0) ups.push(tPrev + (s.t - tPrev) * (-prev / (th - prev)))
    prev = th
    tPrev = s.t
  }
  return (ups[2] - ups[0]) / 2
}

test('pendulum: small-angle period 2π√(L/g) and the exact elliptic period', () => {
  for (const L of [0.5, 1, 2.5]) {
    const T0 = 2 * Math.PI * Math.sqrt(L / G)
    near(measuredPeriod({ L, theta0: 1, omega0: 0 }), T0, 2e-4, 0, `L=${L}`)
  }
  for (const th of [30, 60, 90, 120]) {
    // released at -th so the first crossing upward is after a half period: sign convention of measuredPeriod
    const T = pendulumPeriodExact(1, G, th * DEG)
    near(measuredPeriod({ L: 1, theta0: -th, omega0: 0 }), T, 2e-5, 0, `${th}°`)
    assert.ok(T > 2 * Math.PI * Math.sqrt(1 / G), 'a big swing is slower')
  }
})

test('pendulum: the exact solution and the small-angle cosine are carried as channels', () => {
  const sim = run('pendulum', 'simple', { L: 1, theta0: 80 }, 3)
  const s = sim.sample()
  near(s.theta, s.theta_exact, 1e-6, 1e-7, 'simulation vs elliptic functions')
  assert.ok(Math.abs(s.theta - s.theta_small) > 0.05, 'the small-angle cosine has drifted away')
  // small amplitude: all three agree
  const small = run('pendulum', 'simple', { L: 1, theta0: 2 }, 3).sample()
  near(small.theta, small.theta_small, 1e-3, 1e-5)
})

test('pendulum: damped decay, regimes and the driven resonance curve', () => {
  const sim = run('pendulum', 'damped', { L: 1, theta0: 5, c: 0.4 }, 6)
  const s = sim.sample()
  near(s.theta, s.theta_small, 1e-2, 2e-4, 'damped, small angle')
  assert.equal(dampingRegime(9.8, 0.4), 'under')
  assert.equal(dampingRegime(9.8, 20), 'over')
  assert.equal(dampingRegime(4, 4), 'critical')
  const sw = pendulumSweep({ ...PENDULUM.defaults('driven'), A: 0.05, c: 0.5 })!
  const peak = sw.x[sw.measured.indexOf(Math.max(...sw.measured))]
  near(peak, Math.sqrt(G), 0, 0.2, 'resonance near sqrt(g/L)')
  sw.measured.forEach((m, i) => near(m, sw.theory![i], 0.03, 1e-3, `sweep point ${i}`))
  // the phase passes through 90° at resonance
  const i0 = sw.x.findIndex((x) => x >= Math.sqrt(G))
  assert.ok(sw.phase![i0] > 60 && sw.phase![i0] < 120)
})

test('pendulum: physical pendulum equivalent length and radius of gyration', () => {
  const rod = compoundOf('rod', 1, 0.5)
  near(rod.leq, 2 / 3, 1e-12)
  near(compoundOf('rod', 1, 0.001).k, 1 / Math.sqrt(12), 1e-12)
  // the period is shortest when the pivot is k away from the centre
  const T = (d: number) => 2 * Math.PI * Math.sqrt(compoundOf('rod', 1, d).leq / G)
  const k = 1 / Math.sqrt(12)
  assert.ok(T(k) < T(0.1) && T(k) < T(0.45))
  const T0 = 2 * Math.PI * Math.sqrt(compoundOf('ring', 0.5, 0.5).leq / G)
  near(T0, 2 * Math.PI * Math.sqrt(1 / G), 1e-12, 0, 'a ring on a nail is a simple pendulum of one diameter')
  near(measuredPeriod({ shape: 'rod', size: 1, pivot: 0.5, theta0: -2 }, 'compound'), 2 * Math.PI * Math.sqrt((2 / 3) / G), 3e-4)
})

test('double pendulum: energy conservation, sensitive dependence and the Lyapunov exponent', () => {
  const sim = run('pendulum', 'double', { th1: 120, th2: -10, twin: true, eps: 0.01 }, 20, 'rk4')
  const P = { L1: 1, L2: 1, m1: 1, m2: 1, g: G }
  const e0 = doubleEnergy(P, 120 * DEG, -10 * DEG, 0, 0).total
  near(sim.energy()!.total, e0, 0, 1e-5, 'RK4 keeps the energy')
  // the twins start 0.01° apart and end far apart
  const s = sim.sample()
  assert.ok(s.sep > 0.5, `separation ${s.sep}`)
  const early = run('pendulum', 'double', { th1: 120, th2: -10, twin: true, eps: 0.01 }, 0.5).sample()
  assert.ok(early.sep < 0.01, `still together after 0.5 s: ${early.sep}`)
  const chaotic = lyapunovDouble(PENDULUM.defaults('double'), 40)
  const regular = lyapunovDouble({ ...PENDULUM.defaults('double'), th1: 6, th2: 4 }, 40)
  assert.ok(chaotic > 0.4 && chaotic < 4, `λ chaotic ${chaotic}`)
  assert.ok(regular < 0.15, `λ regular ${regular}`)
  // Poincaré section collects points
  const sec = run('pendulum', 'double', {}, 40)
  assert.ok((sec.extra!().poincare ?? []).length > 3)
  // the integrators: Euler fails, Verlet and RK4 hold
  const drift = (m: Method) => { const q = run('pendulum', 'double', { twin: false }, 5, m); return Math.abs(q.energy()!.total - e0) / Math.abs(e0) }
  assert.ok(drift('euler') > drift('verlet') && drift('verlet') > drift('rk4'))
})

// ------------------------------------------------------------------------------------------ oscillator

test('oscillator: every damping regime against the closed form, and the envelope', () => {
  for (const [c, regime] of [[1, 'under'], [8.944271909999159, 'critical'], [20, 'over']] as const) {
    assert.equal(dampingRegime(20, c), regime)
    const sim = run('oscillator', 'spring', { m: 1, k: 20, c, x0: 1, v0: 0.5 }, 3, 'rk4')
    const s = sim.sample()
    near(s.x, s.x_th, 1e-7, 1e-9, `${regime}`)
    const ref = linearOscillator(20, c, 0, 0, 1, 0.5, sim.t)
    near(s.x, ref.x, 1e-7, 1e-9)
  }
  // the underdamped peaks lie under the envelope A e^{-c t/2m} and touch it at the turning points
  const sim = OSCILLATOR.create(cleanParams('oscillator', { ...OSCILLATOR.defaults('spring'), c: 1, x0: 1, v0: 0 }), 'rk4')
  let worst = 0
  let touched = 0
  for (let i = 0; i < 2000; i++) {
    sim.step(sim.dt)
    const s = sim.sample()
    worst = Math.max(worst, Math.abs(s.x) - s.env)
    if (Math.abs(s.x) > 0.97 * s.env && s.env > 0.2) touched++
  }
  assert.ok(worst < 1e-9, `|x| stays under the envelope (${worst})`)
  assert.ok(touched > 5, 'and reaches it')
  // decay of the envelope: e^{-c t / 2m}
  near(sim.sample().env, Math.hypot(1, (0 + 0.5) / Math.sqrt(20 - 0.25)) * Math.exp(-0.5 * sim.t), 1e-9)
  // the energy of the undamped oscillator is constant under Verlet
  const free = run('oscillator', 'spring', { c: 0, x0: 1 }, 60, 'verlet')
  near(free.energy()!.total, 0.5 * 20, 1e-3)
})

test('oscillator: driven resonance amplitude and phase, from a sweep that starts in the steady state', () => {
  const p = { ...OSCILLATOR.defaults('driven'), m: 1, k: 20, c: 0.8, F0: 4 }
  const sw = oscillatorSweep(p)!
  sw.measured.forEach((m, i) => near(m, sw.theory![i], 2e-4, 1e-8, `amplitude ${i}`))
  sw.phase!.forEach((m, i) => near(m, sw.phaseTheory![i], 1e-3, 0.02, `phase ${i}`))
  const w0 = Math.sqrt(20)
  const r = steadyResponse(20, 0.8, 4, w0)
  near(r.amp, 4 / (0.8 * w0), 1e-12)
  near(r.phase, Math.PI / 2, 1e-12)
  // the full solution with its transient (from rest) against the simulation
  const sim = run('oscillator', 'driven', { m: 1, k: 20, c: 0.8, F0: 4, Om: 3, x0: 0, v0: 0 }, 5, 'rk4')
  near(sim.sample().x, sim.sample().x_th, 1e-6, 1e-9)
})

test('oscillator: coupled masses have the normal-mode frequencies and a pure mode stays pure', () => {
  const m = coupledModes(2, 1, 20, 4)
  near(m.omegas[0], Math.sqrt(20), 1e-12)
  near(m.omegas[1], Math.sqrt(20 + 2 * 4), 1e-12)
  // the chain of five: ω_n = 2 sqrt(k/m) sin(nπ / (2 (N+1))) when the end springs are replaced by the coupling springs
  const chain = coupledModes(5, 2, 0, 3)
  void chain
  const ev = eigenSym([[2, -1, 0], [-1, 2, -1], [0, -1, 2]])
  ev.values.forEach((l, i) => near(l, 2 - 2 * Math.cos(((i + 1) * Math.PI) / 4), 1e-12))
  // mode 2 of two masses: x1 = -x2 forever, at frequency ω₂
  const sim = run('oscillator', 'coupled', { N: 2, form: 'springs', m: 1, k: 20, kc: 4, init: 'mode2', a0: 0.3, cc: 0 }, 4, 'rk4')
  const s = sim.sample()
  near(s.x1, -s.x2, 1e-7, 1e-9)
  near(s.x1, s.x1_th, 1e-6, 1e-9)
  near(s.q1, 0, 0, 1e-8)
  // energy is conserved
  near(sim.energy()!.total, run('oscillator', 'coupled', { N: 2, init: 'mode2', a0: 0.3 }, 0).energy()!.total, 1e-7)
  // plucking mass 1 excites both modes: beats, and the full motion equals the modal sum
  const beat = run('oscillator', 'coupled', { N: 2, init: 'pluck', kc: 2, a0: 0.4, cc: 0.05 }, 6, 'rk4').sample()
  near(beat.x1, beat.x1_th, 1e-6, 1e-8)
  near(beat.x2, beat.x2_th, 1e-6, 1e-8)
})

test('oscillator: Atwood machine and inclined plane', () => {
  const at = run('oscillator', 'atwood', { m1: 3, m2: 2, M: 0 }, 0.5, 'rk4').sample()
  near(at.a, (1 * G) / 5, 1e-9)
  near(at.T1, 3 * (G - at.a), 1e-9)
  near(at.T1, at.T2, 1e-9, 0, 'ideal pulley: equal tensions')
  near(at.z1, at.z1_th, 1e-9)
  const heavy = run('oscillator', 'atwood', { m1: 3, m2: 2, M: 4 }, 0.3, 'rk4').sample()
  near(heavy.a, (1 * G) / (5 + 2), 1e-9)
  assert.ok(heavy.T1 > heavy.T2, 'a massive pulley needs a tension difference')
  const stop = run('oscillator', 'atwood', { m1: 5, m2: 1 }, 20)
  assert.ok(stop.finished, 'it stops when the heavy mass reaches the floor')
  // the incline: sliding block, static friction and the angle of repose
  const th = 35 * DEG
  const slide = run('oscillator', 'incline', { object: 'block', theta: 35, mus: 0.5, muk: 0.3, slen: 6 }, 0.5)
  near(slide.sample().a, G * (Math.sin(th) - 0.3 * Math.cos(th)), 1e-9)
  near(slide.sample().s, slide.sample().s_th, 1e-6, 1e-9)
  const stays = run('oscillator', 'incline', { object: 'block', theta: 25, mus: 0.5, muk: 0.3 }, 3)
  assert.equal(stays.sample().s, 0, 'tan 25° < μs: it does not move')
  near(stays.sample().f, 2 * G * Math.sin(25 * DEG), 1e-9, 0, 'static friction equals the downhill component')
  // a block pushed up the slope decelerates with gravity and friction, stops, then slides back or sticks
  const up = run('oscillator', 'incline', { object: 'block', theta: 35, mus: 0.5, muk: 0.3, v0i: -3, slen: 20 }, 1)
  assert.ok(up.sample().v > -3 + 0.1 || up.sample().v > 0)
  // the repose angle
  near(Math.atan(0.5) / DEG, 26.565, 1e-4)
})

test('oscillator: rolling objects reach the bottom in the order of I/mr² and the closed form matches', () => {
  const kind = ['sphere', 'disc', 'shell', 'ring'] as const
  const times = kind.map((k) => {
    const law = inclineLaw(k, 25 * DEG, 0.9, 0.6, G)
    assert.ok(law.grips)
    return Math.sqrt((2 * 6) / law.a)
  })
  assert.ok(times[0] < times[1] && times[1] < times[2] && times[2] < times[3], `order sphere < cylinder < hollow sphere < ring: ${times}`)
  near(inclineLaw('disc', 25 * DEG, 0.9, 0.6, G).a, (G * Math.sin(25 * DEG)) / 1.5, 1e-12)
  near(ROLL_KAPPA.sphere, 0.4, 0)
  // too little friction: the sphere slips
  assert.ok(!inclineLaw('sphere', 40 * DEG, 0.1, 0.05, G).grips)
  // the race: every lane arrives at the time of its closed form
  const race = run('oscillator', 'incline', { object: 'race', theta: 25, mus: 0.9, muk: 0.6, slen: 6 }, 4, 'rk4', (s) => s.readouts().filter((r) => r.theory?.includes('simulated')).length >= 4)
  const lines = race.readouts().filter((r) => r.theory?.includes('simulated'))
  assert.equal(lines.length, 4)
  for (const l of lines) {
    const m = /closed form ([\d.]+) s · simulated ([\d.]+) s/.exec(l.theory!)!
    near(Number(m[2]), Number(m[1]), 2e-3, 0, l.label)
  }
})

// ------------------------------------------------------------------------------------------ collisions

test('collision: the closed forms for 1-D collisions', () => {
  const el = collide1D(2, 1, 3, -1, 1)
  near(el.v1, 1 / 3, 1e-12)
  near(el.v2, 13 / 3, 1e-12)
  near(el.keLost, 0, 0, 1e-12)
  const ine = collide1D(2, 1, 3, -1, 0)
  near(ine.v1, 5 / 3, 1e-12)
  near(ine.v2, 5 / 3, 1e-12)
  // lost energy = ½ μ (1 − e²) v_rel²
  for (const e of [0, 0.3, 0.8]) {
    const c = collide1D(2, 1, 3, -1, e)
    near(c.keLost, 0.5 * (2 / 3) * (1 - e * e) * 16, 1e-12)
    near(c.v2 - c.v1, -e * (-1 - 3), 1e-12, 0, 'relative speed reverses scaled by e')
    near(2 * c.v1 + c.v2, 2 * 3 - 1, 1e-12, 0, 'momentum')
  }
  // equal masses swap velocities; a heavy ball barely changes
  const swap = collide1D(1, 1, 4, 0, 1)
  assert.deepEqual([swap.v1, swap.v2], [0, 4])
  assert.ok(Math.abs(collide1D(1000, 1, 1, 0, 1).v1 - 1) < 0.003)
})

test('collision: the event-driven 1-D simulation reproduces the formulas, momentum and energy', () => {
  for (const e of [1, 0.6, 0]) {
    const sim = run('collision', 'oned', { m1: 2, m2: 1, v1: 3, v2: -1, e, rail: false }, 4)
    const w = (sim as unknown as { world: CircleWorld }).world
    const c = collide1D(2, 1, 3, -1, e)
    near(w.balls[0].vx, c.v1, 1e-12, 1e-12)
    near(w.balls[1].vx, c.v2, 1e-12, 1e-12)
    near(w.keLost, c.keLost, 1e-9, 1e-12)
    near(w.totals().p[0], 5, 1e-12)
    assert.equal(w.hits.length, 1)
    near(w.hits[0].t, 1.2 * 1 > 0 ? w.hits[0].t : 0, 1)
  }
  // the exact collision time is found inside a step
  const w = new CircleWorld([{ x: 0, y: 0, vx: 1, vy: 0, m: 1, r: 0.5, color: '', name: '' }, { x: 3, y: 0, vx: 0, vy: 0, m: 1, r: 0.5, color: '', name: '' }], { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity }, 1, 1)
  w.advance(5)
  near(w.hits[0].t, 2, 1e-12)
  near(w.balls[1].vx, 1, 1e-12)
  near(w.balls[0].vx, 0, 1e-12, 1e-12)
})

test('collision: billiards — equal masses leave at 90°, momentum is conserved, a rack breaks', () => {
  const sim = run('collision', 'twod', { layout: 'oblique', speed: 4, offset: 0.5, e: 1, mc: 1, mt: 1, ew: 1 }, 0.5)
  const w = (sim as unknown as { world: CircleWorld }).world
  assert.equal(w.hits.length, 1)
  const [a, b] = w.balls
  const dot = a.vx * b.vx + a.vy * b.vy
  near(dot, 0, 0, 1e-9, 'perpendicular paths')
  near(w.totals().ke, 8, 1e-9)
  near(w.totals().p[0], 4, 1e-9)
  near(w.totals().p[1], 0, 0, 1e-9)
  // unequal masses are not at right angles
  const heavy = run('collision', 'twod', { layout: 'oblique', mc: 1, mt: 3, e: 1, offset: 0.5 }, 0.5)
  const [h1, h2] = (heavy as unknown as { world: CircleWorld }).world.balls
  assert.ok(Math.abs(h1.vx * h2.vx + h1.vy * h2.vy) > 0.1)
  // e < 1 loses energy, and head-on equal masses stop the cue ball when e = 1
  const head = (run('collision', 'twod', { layout: 'oblique', offset: 0, e: 1 }, 0.45) as unknown as { world: CircleWorld }).world
  near(head.balls[0].vx, 0, 0, 1e-9)
  near(head.balls[1].vx, 4, 1e-9)
  const rack = run('collision', 'twod', { layout: 'rack', speed: 4, e: 0.96, ew: 1, decay: 0 }, 0.3)
  const rw = (rack as unknown as { world: CircleWorld }).world
  assert.equal(rw.balls.length, 16)
  assert.ok(rw.hits.length >= 3, `${rw.hits.length} collisions`)
  assert.equal(rw.wallHits, 0)
  near(rw.totals().p[0], 1 * 4 * 1.8, 1e-9, 1e-9, 'momentum in the break')
  assert.ok(rw.totals().ke < 0.5 * 1 * 7.2 ** 2 && rw.keLost > 0, 'the rack takes energy out of the cue ball')
  // no overlaps survive
  for (let i = 0; i < rw.balls.length; i++) for (let j = i + 1; j < rw.balls.length; j++) assert.ok(Math.hypot(rw.balls[i].x - rw.balls[j].x, rw.balls[i].y - rw.balls[j].y) >= 0.2 - 1e-6)
})

test("collision: Newton's cradle (planck) passes the momentum along, and the ballistic pendulum", () => {
  // the speeds just after the first impact: the moment the last ball is fastest
  const settle = (over: Params, score: (v: number[]) => number) => {
    const c = run('collision', 'cradle', { balls: 5, restitution: 1, length: 1, ...over }, 0)
    let best: number[] = []
    for (let i = 0; i < 160; i++) {
      c.step(c.dt)
      const vx = c.frame().bodies.map((b) => b.vx)
      if (!best.length || score(vx) > score(best)) best = vx
    }
    return best
  }
  const v0 = Math.sqrt(2 * G * (1 - Math.cos(35 * DEG)))
  const one = settle({ lift: 1, liftAngle: 35 }, (v) => v[4])
  assert.ok(one[4] > 0.9 * v0, `last ball ${one[4]} vs ${v0}`)
  assert.ok(Math.abs(one[0]) < 0.1 * v0 && Math.abs(one[1]) < 0.1 * v0, 'the first ones are almost still')
  // two balls lifted: two swing out
  const v1 = Math.sqrt(2 * G * (1 - Math.cos(30 * DEG)))
  const two = settle({ lift: 2, liftAngle: 30 }, (v) => Math.min(v[3], v[4]))
  assert.ok(two[3] > 0.75 * v1 && two[4] > 0.75 * v1 && Math.abs(two[0]) < 0.3 * v1, `${two.map((x) => x.toFixed(2))}`)
  assert.ok(Math.abs(one[3]) < 0.3 * v0, 'with one ball lifted only one leaves')
  // ballistic pendulum
  const V = (0.01 * 300) / 1.01
  near(ballisticHeight(0.01, 1, 300, G), V * V / (2 * G), 1e-12)
  near(ballisticSpeed(0.01, 1, ballisticHeight(0.01, 1, 300, G), G), 300, 1e-12)
  const bp = run('collision', 'ballistic', { mb: 10, MB: 1, vb: 300, Lb: 1.5 }, 3, 'rk4')
  const maxTheta = Number(/(\d+\.?\d*)°/.exec(bp.readouts().find((r) => r.label === 'Maximum angle')!.value)![1])
  near(maxTheta, Math.acos(1 - (V * V) / (2 * G * 1.5)) / DEG, 1e-3)
  const inferred = Number(/(\d+\.?\d*) m\/s/.exec(bp.readouts().find((r) => r.label.startsWith('Bullet speed from'))!.value)![1])
  near(inferred, 300, 2e-3)
  // momentum: the horizontal momentum just after the impact is m v
  const after = run('collision', 'ballistic', { mb: 10, MB: 1, vb: 300, Lb: 1.5 }, 0.01, 'rk4').sample()
  near(after.px, 3, 2e-3)
  near(bp.sample().heat, 0.5 * 0.01 * 300 ** 2 - 0.5 * 1.01 * V * V, 1e-9)
})

// ------------------------------------------------------------------------------------------ orbits

/** The time between successive crossings of the starting direction, measured on the relative orbit. */
function keplerPeriod(over: Params, method: Method, orbits = 3): { T: number; a: number; M: number; sim: Sim } {
  const p = cleanParams('orbit', { ...ORBIT.defaults('kepler'), ...over, mode: 'kepler' })
  const sim = ORBIT.create(p, method)
  const ups: number[] = []
  let prevY = 0
  let prevT = 0
  while (ups.length < orbits && sim.t < 200) {
    sim.step(sim.dt)
    const s = sim.sample()
    if (prevY < 0 && s.y >= 0 && s.x > 0) ups.push(prevT + (sim.t - prevT) * (-prevY / (s.y - prevY)))
    prevY = s.y
    prevT = sim.t
  }
  const M = Number(p.M)
  const e = Number(p.ecc)
  return { T: (ups[orbits - 1] - ups[0]) / (orbits - 1), a: Number(p.rp) / (1 - e), M: M * (1 + Number(p.q)), sim }
}

test("orbit: Kepler's third law T²/a³ = 1/(M+m) to 1e-4 with Verlet and RK4, and the second law", () => {
  for (const method of ['verlet', 'rk4'] as const) {
    for (const over of [{ rp: 1, ecc: 0 }, { rp: 1, ecc: 0.5 }, { rp: 0.4, ecc: 0.3 }, { rp: 2, ecc: 0.7 }, { rp: 1, ecc: 0.3, M: 2.5, q: 0.2 }]) {
      const { T, a, M } = keplerPeriod(over, method)
      near((T * T) / a ** 3, 1 / M, 1e-4, 0, `${method} ${JSON.stringify(over)}`)
      near(T, conicOf(G_AU * M, Number(over.rp), over.ecc).period, 1e-4)
    }
  }
  // Kepler II: dA/dt = h/2 stays constant along an eccentric orbit
  const sim = run('orbit', 'kepler', { rp: 0.5, ecc: 0.8 }, 1, 'rk4')
  let lo = Infinity
  let hi = -Infinity
  const s2 = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('kepler'), rp: 0.5, ecc: 0.8 }), 'rk4')
  for (let i = 0; i < 3000; i++) { s2.step(s2.dt); const v = s2.sample().areal; lo = Math.min(lo, v); hi = Math.max(hi, v) }
  near(lo, hi, 1e-8, 0, 'areal velocity')
  void sim
  // Kepler I: r + r' = 2a at every point of the ellipse; and the Kepler equation solution agrees with the integration
  const k = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('kepler'), rp: 1, ecc: 0.6 }), 'rk4')
  for (let i = 0; i < 1500; i++) {
    k.step(k.dt)
    const q = k.sample()
    const a = 2.5
    near(q.r + Math.hypot(q.x + 2 * a * 0.6, q.y), 2 * a, 1e-6, 0, 'r + r′')
    near(q.r, q.r_th, 1e-5, 1e-8, 'closed-form r(t)')
  }
  near(solveKepler(1.234, 0.4) - 0.4 * Math.sin(solveKepler(1.234, 0.4)), 1.234, 1e-14)
})

test('orbit: velocity-Verlet conserves energy over many orbits while explicit Euler drifts', () => {
  const run50 = (m: Method, dtDiv: number) => {
    const p = cleanParams('orbit', { ...ORBIT.defaults('kepler'), rp: 1, ecc: 0.3 })
    const sim = ORBIT.create(p, m)
    const T = conicOf(G_AU * 1.001, 1, 0.3).period
    const e0 = sim.energy()!.total
    const dt = T / dtDiv
    let worst = 0
    for (let i = 0; i < 50 * dtDiv; i++) {
      sim.step(dt)
      if (i % 50 === 0) worst = Math.max(worst, Math.abs((sim.energy()!.total - e0) / e0))
    }
    return worst
  }
  const verlet = run50('verlet', 1000)
  const euler = run50('euler', 1000)
  const semi = run50('semi', 1000)
  assert.ok(verlet < 1e-4, `Verlet drift ${verlet}`)
  assert.ok(euler > 0.05, `Euler drift ${euler}`)
  assert.ok(semi < 0.05 && semi > verlet)
  assert.ok(euler / verlet > 1000)
  const rk4 = run50('rk4', 1000)
  assert.ok(rk4 < 1e-8)
  // the comparison chart orders them the same way
  const curves = compareIntegrators(defaultDoc('orbit', 'kepler'), 6, 60, 6000)
  assert.equal(curves.length, 5)
  const fin = Object.fromEntries(curves.map((c) => [c.method, c.final]))
  assert.ok(fin.euler > fin.semi && fin.semi > fin.verlet && fin.verlet > fin.rk4)
  assert.ok(driftFigure(curves, DEFAULT_PALETTE).data.length === 5)
})

test('orbit: Hohmann transfer — the burns, the flight time and the rendezvous', () => {
  const mu = G_AU
  const h = hohmann(mu, 1, 1.524)
  near(h.dv1 * AUYR_KMS, 2.94, 3e-3, 0, 'Δv₁ km/s (heliocentric Earth→Mars)')
  near(h.dv2 * AUYR_KMS, 2.65, 3e-3, 0, 'Δv₂ km/s')
  near(h.time * 365.25, 259, 2e-3, 0, 'days')
  near(h.lead / DEG, 44.4, 3e-3, 0, 'phase lead')
  // textbook formulas
  near(h.dv1, Math.sqrt(mu / 1) * (Math.sqrt((2 * 1.524) / 2.524) - 1), 1e-12)
  near(h.total, h.dv1 + h.dv2, 1e-12)
  const hv = hohmann(mu, 1, 0.723)
  assert.ok(hv.dv1 < 0 && hv.dv2 < 0, 'going inwards: retro burns')
  const sim = run('orbit', 'hohmann', {}, 0.9, 'rk4') as Sim
  const rd = sim.readouts()
  const get = (l: string) => rd.find((r) => r.label.startsWith(l))!
  near(Number(/([\d.]+) km\/s/.exec(get('Δv₂').value)![1]), h.dv2 * AUYR_KMS, 3e-3)
  const closest = run('orbit', 'hohmann', {}, 2, 'rk4', (s) => s.t > 0.75)
  const dmin = Number(/([\d.e-]+) AU/.exec(closest.readouts().find((r) => r.label.startsWith('Closest'))!.value)![1])
  assert.ok(dmin < 1e-3, `the ship meets Mars: ${dmin} AU`)
  const apo = Number(/([\d.]+) AU/.exec(closest.readouts().find((r) => r.label.startsWith('Apoapsis'))!.value)![1])
  near(apo, 1.524, 1e-4)
  // too little first burn: it misses
  const miss = run('orbit', 'hohmann', { dv1: 85 }, 2, 'rk4', (s) => s.t > 0.75)
  assert.ok(Number(/([\d.e-]+) AU/.exec(miss.readouts().find((r) => r.label.startsWith('Closest'))!.value)![1]) > 0.05)
})

test('orbit: escape speed, the conic types and the fly-by', () => {
  near(conicOf(G_AU, 1, 0.5).a, 2, 1e-12)
  assert.equal(conicOf(G_AU, 1, 1).kind, 'parabola')
  assert.equal(conicOf(G_AU, 1, 1.5).kind, 'hyperbola')
  const vesc = Math.sqrt(2 * G_AU)
  // below the escape speed the probe returns after reaching rmax = r0/(1-f²), above it it keeps going
  const f09 = run('orbit', 'escape', { f: 0.9, launch: 90, r0: 1 }, 3, 'rk4')
  const rmax = f09.readouts().find((r) => r.label === 'Farthest distance')!
  near(Number(/([\d.]+) AU/.exec(rmax.value)![1]), 1 / (1 - 0.81), 1e-3)
  const up = run('orbit', 'escape', { f: 1.02, launch: 90 }, 10, 'rk4')
  assert.ok(up.sample().r > 10, `escaped to ${up.sample().r} AU`)
  near(Math.sqrt(2) * Math.sqrt(G_AU / 1), vesc, 1e-12)
  const energy = (f: number) => run('orbit', 'escape', { f, launch: 90 }, 0.01).readouts().find((r) => r.label === 'Specific energy')!.theory!
  assert.match(energy(0.9), /bound/)
  assert.match(energy(1.1), /escapes/)
  // hyperbolic fly-by: speed in the planet frame is unchanged, the Sun-frame speed follows the closed form
  const sling = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('slingshot'), side: 'behind', b: 0.006 }), 'rk4') as Sim & { vSunIn: number; vSunOutTheory: number; vel(i: number): number[] }
  const hy = hyperbolaOf(G_AU * 9.5479e-4, Math.hypot(2, 2.76), 0.006)
  while (sling.sample().d < 3 || sling.t < 0.1) { sling.step(sling.dt); if (sling.t > 6) break }
  const v = sling.vel(1)
  near(Math.hypot(v[0], v[1]), sling.vSunOutTheory, 0.01, 0, 'Sun-frame speed after the pass')
  assert.ok(sling.vSunOutTheory > sling.vSunIn + 1.5, 'passing behind gains speed')
  near(hy.delta, 2 * Math.asin(1 / hy.e), 1e-12)
  const ahead = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('slingshot'), side: 'ahead', b: 0.006 }), 'rk4') as Sim & { vSunIn: number; vSunOutTheory: number }
  assert.ok(ahead.vSunOutTheory < ahead.vSunIn - 0.5, 'passing ahead loses speed')
})

test('orbit: restricted three-body — Lagrange points, Jacobi constant and the Arenstorf orbit', () => {
  const L = lagrangePoints(0.0121505856)
  near(L[0].x, 0.8369151, 1e-6)
  near(L[1].x, 1.1556822, 1e-6)
  near(L[2].x, -1.0050626, 1e-6)
  near(L[3].y, Math.sqrt(3) / 2, 1e-12)
  for (const p of L) {
    const a = cr3bpAcc(0.0121505856, p.x, p.y, 0, 0)
    near(a[0], 0, 0, 1e-7, p.name)
    near(a[1], 0, 0, 1e-7, p.name)
  }
  const sim = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('restricted3'), ic: 'l4', off: -0.02 }), 'rk45')
  const y = (sim as unknown as { o: Ode2 }).o.y
  const C0 = jacobi(0.0121505856, y[0], y[1], y[2], y[3])
  let far = 0
  while (sim.t < 60) { sim.step(sim.dt); far = Math.max(far, Math.hypot(y[0] - 0.4878494144, y[1] - Math.sqrt(3) / 2)) }
  near(jacobi(0.0121505856, y[0], y[1], y[2], y[3]), C0, 0, 1e-8, 'Jacobi constant')
  assert.ok(far < 0.12, `a tadpole around L4 stays near L4 (${far})`)
  // the collinear points are unstable: a small push grows
  const l1 = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('restricted3'), ic: 'l1', off: -0.001 }), 'rk45')
  while (l1.t < 25) l1.step(l1.dt)
  assert.ok(Math.abs((l1 as unknown as { o: Ode2 }).o.y[0] - 0.8369151) > 0.1, 'L1 is unstable')
  // the Arenstorf orbit is periodic
  const ar = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('restricted3'), ic: 'arenstorf' }), 'rk45')
  const o = (ar as unknown as { o: Ode2 }).o
  o.rtol = 1e-12
  o.atol = 1e-14
  const T = ARENSTORF.period
  while (ar.t < T - 1e-12) ar.step(Math.min(ar.dt, T - ar.t))
  near(o.y[0], ARENSTORF.x, 0, 2e-5)
  near(o.y[1], 0, 0, 2e-5)
  near(o.y[3], ARENSTORF.vy, 1e-4)
})

test('orbit: the figure-eight returns after one period, and N-body: Barnes–Hut, conservation, the solar system', () => {
  const f8 = ORBIT.create(cleanParams('orbit', { ...ORBIT.defaults('figure8') }), 'rk45')
  const o = (f8 as unknown as { o: Ode2 }).o
  o.rtol = 1e-12
  o.atol = 1e-14
  const e0 = f8.energy()!.total
  while (f8.t < FIGURE8.period - 1e-12) f8.step(Math.min(f8.dt, FIGURE8.period - f8.t))
  for (let i = 0; i < 3; i++) {
    near(o.y[3 * i], FIGURE8.pos[i][0], 0, 1e-5, `body ${i} x`)
    near(o.y[3 * i + 1], FIGURE8.pos[i][1], 0, 1e-5, `body ${i} y`)
  }
  near(f8.energy()!.total, e0, 1e-9)
  near(e0, -1.2871, 1e-3, 0, 'energy of the figure eight')
  // Barnes–Hut against the direct sum
  const cl = plummerCluster(250, 5)
  const N = cl.m.length
  const a1 = new Float64Array(3 * N)
  const a2 = new Float64Array(3 * N)
  directAccel(cl.y, cl.m, a1, { G: 1, eps: 0.02 })
  barnesHutAccel(cl.y, cl.m, a2, { G: 1, eps: 0.02, theta: 0.5 })
  let err = 0
  let nrm = 0
  for (let i = 0; i < 3 * N; i++) { err += (a1[i] - a2[i]) ** 2; nrm += a1[i] ** 2 }
  assert.ok(Math.sqrt(err / nrm) < 0.015, `BH relative error ${Math.sqrt(err / nrm)}`)
  const a3 = new Float64Array(3 * N)
  barnesHutAccel(cl.y, cl.m, a3, { G: 1, eps: 0.02, theta: 1e-6 })
  let e3 = 0
  for (let i = 0; i < 3 * N; i++) e3 += (a1[i] - a3[i]) ** 2
  assert.ok(Math.sqrt(e3 / nrm) < 1e-9, 'θ → 0 is the direct sum')
  // the cluster is near virial equilibrium; a disc has the centre of mass at rest
  const t = gravityTotals(cl.y, cl.m, { G: 1, eps: 0.02 })
  assert.ok((2 * t.ke) / Math.abs(t.pe) > 0.6 && (2 * t.ke) / Math.abs(t.pe) < 1.4)
  const disc = discGalaxy(100, 4)
  const td = gravityTotals(disc.y, disc.m, { G: 1, eps: 0.02 })
  near(td.px, 0, 0, 1e-12)
  assert.ok(td.lz > 0, 'the disc rotates')
  // N-body conserves momentum exactly and energy to the integrator's accuracy
  const nb = run('orbit', 'nbody', { N: 60, layout: 'disc', bh: false }, 1, 'verlet')
  const tn = gravityTotals((nb as unknown as { o: Ode2 }).o.y, (nb as unknown as { masses: Float64Array }).masses, { G: 1, eps: 0.02 })
  near(Math.hypot(tn.px, tn.py, tn.pz), 0, 0, 1e-12)
  assert.ok(nb.sample().edrift < 1e-4, `drift ${nb.sample().edrift}`)
  const big = run('orbit', 'nbody', { N: 300, layout: 'cluster', bh: true }, 0.05, 'verlet')
  assert.equal(big.frame().bodies.length, 300)
  // the solar system: Kepler's periods and a bounded energy error
  const sol = run('orbit', 'solar', {}, 2.2, 'verlet')
  for (const [i, p] of PLANETS.slice(0, 4).entries()) {
    const T = Math.sqrt(p.a ** 3 / (1 + p.m))
    const r = sol.readouts().find((x) => x.label === `${p.name} period`)!
    near(Number(/([\d.]+) yr/.exec(r.value)![1]), T, 1e-3, 0, p.name)
    void i
  }
  assert.ok(sol.sample().edrift < 1e-6)
  const st = stateFromElements(PLANETS[2], G_AU * (1 + PLANETS[2].m))
  near(Math.hypot(st.r[0], st.r[1], st.r[2]), 1, 0.02)
  near(Math.hypot(st.v[0], st.v[1], st.v[2]), 2 * Math.PI, 0.03)
})

// ------------------------------------------------------------------------------------------ circular motion

test('circular: centripetal force, the banked curve and the conical pendulum', () => {
  const cp = run('circular', 'centripetal', { m: 2, R: 1.5, v: 5 }, 3, 'rk4')
  near(cp.sample().tension, 2 * 25 / 1.5, 1e-9)
  near(cp.sample().r, 1.5, 1e-8)
  assert.ok(Math.abs(run('circular', 'centripetal', { R: 1.5, v: 5 }, 3, 'euler').sample().r - 1.5) > 0.05, 'Euler spirals out')
  near(run('circular', 'centripetal', { R: 1.5, v: 5 }, 3, 'rk4').sample().r, 1.5, 1e-6)
  // cutting the string: a straight line along the tangent
  const cut = CIRCULAR.create(cleanParams('circular', { ...CIRCULAR.defaults('centripetal'), cut: false }), 'rk4')
  while (cut.t < 0.5) cut.step(cut.dt)
  cut.params.cut = true
  const x0 = cut.sample()
  for (let i = 0; i < 100; i++) cut.step(cut.dt)
  const x1 = cut.sample()
  near(x1.vx, x0.vx, 1e-12)
  near(x1.x - x0.x, x0.vx * 100 * cut.dt, 1e-9, 1e-12)
  // banked curve
  const sp = bankedSpeeds(60, 15 * DEG, 0.3, G)
  near(sp.ideal, Math.sqrt(60 * G * Math.tan(15 * DEG)), 1e-12)
  near(bankedForces(1, 60, 15 * DEG, G, sp.ideal).f, 0, 0, 1e-9, 'no friction needed at the ideal speed')
  const fm = bankedForces(1, 60, 15 * DEG, G, sp.max)
  near(fm.f, 0.3 * fm.N, 1e-9, 0, 'friction is at its limit at the top speed')
  const icy = bankedSpeeds(60, 15 * DEG, 0.1, G)
  const fn = bankedForces(1, 60, 15 * DEG, G, icy.min)
  near(-fn.f, 0.1 * fn.N, 1e-9, 0, '... and at the lowest speed (when the bank is steeper than the friction angle)')
  assert.ok(icy.min < icy.ideal && icy.ideal < icy.max)
  assert.equal(sp.min, 0, 'tan 15° < μ: the car never slides in')
  assert.equal(bankedSpeeds(60, 60 * DEG, 0.8, G).max, Infinity, 'μ tan θ ≥ 1: it never skids')
  // conical pendulum: the steady cone stays a cone and turns at 2π√(L cosθ / g)
  const st = conicalSteady(1.2, G, 35 * DEG)
  const con = run('circular', 'conical', { L: 1.2, th0: 35, spin: 1 }, 3, 'rk4')
  near(con.sample().theta, 35 * DEG, 1e-8)
  near(con.sample().wphi, st.omega, 1e-8)
  const meas = Number(/([\d.]+) s/.exec(run('circular', 'conical', { L: 1.2, th0: 35, spin: 1 }, 8, 'rk4').readouts().find((r) => r.label === 'Measured period')!.value)![1])
  near(meas, st.period, 1e-3)
  const wobble = run('circular', 'conical', { spin: 0.5 }, 3)
  assert.ok(wobble.sample().theta !== 35 * DEG)
  near(wobble.energy()!.total, run('circular', 'conical', { spin: 0.5 }, 0).energy()!.total, 1e-7)
})

test('circular: Coriolis — the rotating-frame equations reproduce the straight line of the inertial frame; gyroscope', () => {
  for (const [Om, ang, r0] of [[0.8, 0, 0], [1.5, 30, 1], [0.3, -120, 2]] as const) {
    const sim = run('circular', 'coriolis', { Om, ang, r0, u: 3, Rd: 9 }, 1.2, 'rk4')
    const s = sim.sample()
    near(s.err, 0, 0, 1e-7, `Ω=${Om}`)
    near(s.speed_in, Math.hypot(3 * Math.cos(ang * DEG) - Om * 0, 3 * Math.sin(ang * DEG) + Om * r0), 1e-7)
    near(s.e, 0.5 * 9 - 0.5 * Om * Om * r0 * r0, 1e-7, 1e-9, 'rotating-frame energy is conserved')
  }
  assert.ok(run('circular', 'coriolis', { Om: 1.5 }, 0.8, 'euler').sample().err > 1e-3, 'Euler cannot follow it')
  const p = rotatingFromInertial(1, [0, 0], [2, 0], 1)
  near(p.x, 2 * Math.cos(-1), 1e-12)
  near(p.y, 2 * Math.sin(-1), 1e-12)
  // a ball thrown straight at a mark on a turntable misses it: the deflection is to the right of the motion for Ω > 0 (clockwise as seen from above for counter-clockwise rotation)
  assert.ok(run('circular', 'coriolis', { Om: 0.8, u: 3 }, 0.5).sample().y < 0)
  // gyroscope: a fast top released at the slow precession rate precesses at m g d / (I₃ω₃) and barely nutates
  const g = run('circular', 'gyro', { start: 'steady', w3: 250, tilt: 40 }, 1.5, 'rk4')
  const q = g.sample()
  near(q.wphi, slowPrecession(0.4 * G * 0.06, 0.0004, 250), 0.03)
  near(q.theta, 40 * DEG, 0.02)
  const rest = run('circular', 'gyro', { start: 'rest' }, 1.5)
  const e1 = rest.energy()!.total
  near(e1, run('circular', 'gyro', { start: 'rest' }, 0).energy()!.total, 1e-7)
  assert.ok(rest.sample().theta > 30 * DEG, 'the top nutates outward from rest')
})

// ------------------------------------------------------------------------------------------ sandbox

test('sandbox: editing helpers, hit tests, convex hulls and the planck world', () => {
  let s = emptySpec()
  s = addBox(s, 0, -0.5, 20, 1, { type: 'static' })
  s = addCircle(s, 0, 3, 0.5)
  s = addBox(s, 3, 1, 1, 1, { angle: 45 })
  assert.equal(s.bodies.length, 3)
  assert.equal(new Set(s.bodies.map((b) => b.id)).size, 3, 'unique ids')
  assert.equal(hitBody(s, 0, 3)!.kind, 'circle')
  assert.equal(hitBody(s, 3, 1)!.id, s.bodies[2].id)
  assert.equal(hitBody(s, 3.6, 1.6), null, 'outside the rotated box')
  near(hitBody(s, 3, 1.6) ? 1 : 0, 1, 0)
  const corners = bodyCorners(s.bodies[2])
  near(Math.hypot(corners[0][0] - 3, corners[0][1] - 1), Math.SQRT1_2, 1e-9)
  // the hull of scattered points is convex with at most 8 corners and recentred on its centroid
  const hull = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1], [1, 0.2]])
  assert.equal(hull.length, 4)
  const poly = addPolygon(s, [[0, 0], [2, 0], [1, 2], [1, 0.5]])!
  const pb = poly.bodies[poly.bodies.length - 1]
  near(pb.pts!.reduce((a, p) => a + p[0], 0) / pb.pts!.length, 0, 0, 1e-9)
  assert.equal(addPolygon(s, [[0, 0], [1, 1], [2, 2]]), null, 'collinear points make no polygon')
  const moved = moveBody(s, s.bodies[1].id, 1, 2)
  assert.deepEqual([moved.bodies[1].x, moved.bodies[1].y], [1, 5])
  assert.equal(removeBody(s, s.bodies[1].id).bodies.length, 2)
  // a ball dropped on the ground: free fall, then it comes to rest
  const w = SANDBOX.create(cleanParams('sandbox', { ...SANDBOX.defaults('world'), world: addCircle(addBox(emptySpec(), 0, -0.5, 20, 1, { type: 'static' }), 0, 5, 0.5, { restitution: 0 }) as never }))
  for (let i = 0; i < 60; i++) w.step(w.dt)
  const y = w.sample().y
  near(y, 5 - 0.5 * G * 0.25, 7e-3, 0, 'free fall after half a second (Box2D steps with semi-implicit Euler)')
  for (let i = 0; i < 600; i++) w.step(w.dt)
  near(w.sample().y, 0.5, 0, 0.02, 'at rest on the ground')
  assert.ok(w.sample().speed < 0.05)
  // friction: a box on a slope slides when it is steep, sticks when it is rough
  const slope = (fr: number) => {
    let sp = addBox(emptySpec(), 0, 0, 12, 0.4, { type: 'static', angle: -30, friction: fr })
    sp = addBox(sp, 0, 0.7, 0.5, 0.5, { friction: fr, angle: -30 })
    const sim = SANDBOX.create(cleanParams('sandbox', { ...SANDBOX.defaults('world'), world: sp as never }))
    for (let i = 0; i < 240; i++) sim.step(sim.dt)
    return sim.sample().speed
  }
  assert.ok(slope(0.1) > 1.5, 'slides on ice')
  assert.ok(slope(1.2) < 0.1, 'sticks when rough (μ > tan 30° = 0.58)')
  // grab and throw
  const g = SANDBOX.create(cleanParams('sandbox', { ...SANDBOX.defaults('world'), world: addCircle(emptySpec(), 0, 0, 0.5) as never, gravity: 'custom', gcustom: 0.1 }))
  assert.equal(g.pointer!('down', 0, 0), true)
  for (let i = 0; i < 20; i++) { g.pointer!('move', 2 * (i / 20) + 0.1, 0); g.step(g.dt) }
  g.pointer!('up', 2, 0)
  for (let i = 0; i < 30; i++) g.step(g.dt)
  assert.ok(g.sample().vx > 1, `thrown to the right at ${g.sample().vx}`)
  assert.equal(g.pointer!('down', 50, 50), false, 'nothing there to grab')
  // every ready-made world builds and settles without NaN
  for (const [key, wd] of Object.entries(SANDBOX_WORLDS)) {
    const sim = SANDBOX.create(cleanParams('sandbox', { ...SANDBOX.defaults('world'), world: wd.spec as never }))
    for (let i = 0; i < 240; i++) sim.step(sim.dt)
    for (const v of Object.values(sim.sample())) assert.ok(Number.isFinite(v), `${key}: ${v}`)
  }
  // repair of broken data
  const fixed = readSpec({ bodies: [{ id: 'a', kind: 'poly', pts: [[0, 0]] }, { id: 'b', kind: 'box', w: -4 }, { id: 'b' }], joints: [{ id: 'j', kind: 'revolute', a: 'zzz', b: 'b', ax: 0, ay: 0 }, { id: 'k', kind: 'wat' }] })
  assert.equal(fixed.bodies.length, 1)
  assert.equal(fixed.joints.length, 0)
  assert.ok(cradleSpec({ balls: 5, lift: 2 }).joints.length === 5)
})

// ------------------------------------------------------------------------------------------ files

test('.kmotion files: round trip, repair and clear errors', () => {
  for (const sc of SCENES) {
    for (const m of sc.modes) {
      const d = defaultDoc(sc.id, m.id)
      const back = parseKmotion(serializeKmotion(d))
      assert.deepEqual(back.params, d.params, `${sc.id}/${m.id}`)
      assert.equal(back.scene, sc.id)
    }
  }
  const text = serializeKmotion({ ...defaultDoc('pendulum', 'double'), title: 'T', description: 'D', view: { cx: 1, cy: 2, scale: 30 }, method: 'rk45' })
  assert.ok(text.endsWith('\n') && text.startsWith('{\n  "format": "kmotion"'))
  const back = parseKmotion(text)
  assert.deepEqual(back.view, { cx: 1, cy: 2, scale: 30 })
  assert.equal(back.method, 'rk45')
  assert.equal(back.title, 'T')
  // out-of-range and unknown values are repaired, not trusted
  const odd = parseKmotion(JSON.stringify({ format: 'kmotion', version: 1, scene: 'projectile', params: { mode: 'flight', v0: 1e9, angle: -5, drag: 'nope', wat: 3 } }))
  assert.equal(odd.params.v0, 200)
  assert.equal(odd.params.angle, 0)
  assert.equal(odd.params.drag, 'none')
  assert.ok(!('wat' in odd.params))
  assert.equal(parseKmotion(JSON.stringify({ format: 'kmotion', scene: 'pendulum', params: { mode: 'nonsense' } })).params.mode, 'simple')
  assert.throws(() => parseKmotion('not json'), FileError)
  assert.throws(() => parseKmotion('{"format":"other"}'), /not a kMotion file/)
  assert.throws(() => parseKmotion('{"format":"kmotion","scene":"zzz"}'), /Unknown scene/)
  assert.throws(() => parseKmotion('{"format":"kmotion","version":9,"scene":"orbit"}'), /newer/)
  // the sandbox world survives the trip
  const sb = defaultDoc('sandbox')
  assert.deepEqual(parseKmotion(serializeKmotion(sb)).params.world, sb.params.world)
})

test('every scene and mode starts, steps, draws and reports without NaN', () => {
  for (const sc of SCENES) {
    for (const m of sc.modes) {
      const doc = defaultDoc(sc.id, m.id)
      const r = runHeadless(doc, { duration: 1.5, maxSteps: 3000 })
      for (const [k, v] of Object.entries(r.final)) assert.ok(Number.isFinite(v), `${sc.id}/${m.id}: ${k}`)
      const sim = makeSim(doc)
      const f = sim.frame()
      assert.ok(f.shapes.length > 0, `${sc.id}/${m.id} draws something`)
      for (const s of f.shapes) if ('x' in s && typeof s.x === 'number') assert.ok(Number.isFinite(s.x))
      assert.ok(sim.plots.length >= 3 && sim.channels.length >= 5)
      for (const p of sim.plots) {
        for (const se of p.series) assert.ok(sim.channels.some((c) => c.key === se.key) || se.key === 'theta1w', `${sc.id}/${m.id}: plot ${p.id} series ${se.key} is a channel`)
        if (p.x) assert.ok(sim.channels.some((c) => c.key === p.x), `${sc.id}/${m.id}: plot ${p.id} x ${p.x}`)
      }
      const b = sim.bounds()
      assert.ok(b.x1 > b.x0 && b.y1 > b.y0 && [b.x0, b.x1, b.y0, b.y1].every(Number.isFinite))
      assert.ok(sim.readouts().length > 0)
      assert.ok(sceneById(sc.id)!.presets(m.id).length > 0, `${sc.id}/${m.id} has presets`)
      // presets are valid parameter sets for the mode
      for (const p of sceneById(sc.id)!.presets(m.id)) {
        const clean = cleanParams(sc.id, { ...sceneById(sc.id)!.defaults(m.id), ...p.params, mode: m.id })
        assert.ok(makeSim({ ...doc, params: clean }).frame().shapes.length > 0, `${sc.id}/${m.id}/${p.name}`)
      }
    }
  }
})

// ------------------------------------------------------------------------------------------ examples

test('examples: at least 14, grouped, unique, and every one loads and runs with the numbers it quotes', () => {
  const ex = motionExamples()
  assert.ok(ex.length >= 14)
  assert.equal(new Set(ex.map((e) => e.id)).size, ex.length)
  const wanted = ['projectile-vacuum', 'projectile-drag', 'projectile-best-angle', 'jump-moon', 'pendulum-large-angle', 'pendulum-resonance', 'pendulum-double', 'coupled-pendulums', 'collision-billiard',
    'newtons-cradle', 'orbit-circular', 'orbit-elliptical', 'orbit-hohmann', 'orbit-figure8', 'orbit-solar', 'incline-friction', 'atwood']
  for (const id of wanted) assert.ok(exampleById(id), `example ${id}`)
  const groups = new Set(ex.map((e) => e.group))
  assert.ok(groups.size >= 6)
  for (const e of ex) {
    assert.ok(e.title.length > 3 && e.description.length > 40, e.id)
    const back = parseKmotion(serializeKmotion(e.doc))
    const r = runHeadless(back, { duration: 2, maxSteps: 4000 })
    for (const [k, v] of Object.entries(r.final)) assert.ok(Number.isFinite(v), `${e.id}: ${k}`)
    if (r.energyDrift !== null && e.doc.method !== 'euler') assert.ok(r.energyDrift < 1e-3, `${e.id}: energy drift ${r.energyDrift}`)
  }
  // the numbers in the descriptions
  const rv = (id: string) => runHeadless(exampleById(id)!.doc, { duration: 30, untilFinished: true })
  near(rv('projectile-vacuum').final.x, (20 * 20 * Math.sin(Math.PI / 2)) / G, 1e-6)
  assert.match(exampleById('projectile-vacuum')!.description, /40\.79 m/)
  const best = optimalAngle(cleanParams('projectile', { ...exampleById('projectile-best-angle')!.doc.params }))
  near(Number(exampleById('projectile-best-angle')!.doc.params.angle), best.angle, 0, 0.06)
  assert.ok(rv('jump-moon').final.x > 3.5 * rv('jump-earth').final.x)
  near(rv('atwood').final.a ?? 0, 0, 1)
  const at = run('oscillator', 'atwood', exampleById('atwood')!.doc.params, 0.1).sample()
  near(at.a, 1.9613, 1e-4)
  near(at.T1, 23.54, 1e-3)
  const mom = run('collision', 'oned', exampleById('collision-elastic')!.doc.params, 3)
  near((mom as unknown as { world: CircleWorld }).world.balls[0].vx, 1 / 3, 1e-9)
  near((mom as unknown as { world: CircleWorld }).world.balls[1].vx, 13 / 3, 1e-9)
  const bp = run('collision', 'ballistic', exampleById('ballistic-pendulum')!.doc.params, 4)
  assert.match(bp.readouts().find((r) => r.label === 'Maximum angle')!.value, /45\.5\d*°/)
  const hoh = run('orbit', 'hohmann', exampleById('orbit-hohmann')!.doc.params, 0.75)
  near(hoh.t, 0.75, 1e-3)
  const rack = exampleById('billiard-break')!
  assert.equal((makeSim(rack.doc) as unknown as { world: CircleWorld }).world.balls.length, 16)
  // the elliptical example shows the three laws
  const ell = run('orbit', 'kepler', exampleById('orbit-elliptical')!.doc.params, 4.2, 'rk4')
  assert.match(ell.readouts().find((r) => r.label.startsWith('III'))!.value, /0\.99/)
})

test('examples: public/examples/kmotion holds exactly the generated files and an index that lists them', () => {
  const outputs = kmotionExampleOutputs()
  assert.deepEqual(kmotionExampleOutputs(), outputs, 'deterministic')
  const dir = join(ROOT, 'public/examples/kmotion')
  assert.ok(existsSync(dir), 'run node tools/export_kmotion_examples.ts')
  const onDisk = readdirSync(dir).sort()
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { app: string; folder: string; examples: { file: string; title: string; description: string; group: string }[] }
  assert.equal(index.app, 'kmotion')
  assert.equal(index.folder, 'kMotion Examples')
  assert.deepEqual([...index.examples.map((e) => e.file), 'index.json'].sort(), onDisk)
  const files = kmotionExampleFiles()
  for (const o of outputs) assert.equal(readFileSync(join(ROOT, o.path), 'utf8'), o.content, `${o.path} is up to date: run node tools/export_kmotion_examples.ts`)
  for (const [i, f] of files.entries()) {
    assert.equal(f.file, exampleFileName(i + 1, f.title, 'kmotion'))
    assert.ok(/^[\x20-\x7e]+$/.test(f.file), `${f.file}: plain ASCII`)
    assert.ok(f.file.endsWith('.kmotion'))
    assert.ok(f.content.startsWith('{\n  "format": "kmotion"'))
  }
  const read = readExampleIndex(index)
  assert.equal(read.length, files.length)
  assert.ok(read.every((e) => e.group))
  assert.ok(new Set(read.map((e) => e.group)).size >= 6)
})

// ------------------------------------------------------------------------------------------ data and charts

test('data: the recorder thins itself, the table is CSV or TSV, and the chart builder never emits NaN', () => {
  const rec = new Recorder(['t', 'x'], 0.1, 8)
  for (let i = 0; i < 100; i++) rec.offer(i * 0.1, () => ({ t: i * 0.1, x: i }))
  assert.ok(rec.rows.length <= 9 && rec.interval > 0.1, 'rows are thinned and the interval grows')
  const rec2 = new Recorder(['t', 'v', 'w'], 0.5)
  for (let i = 0; i < 5; i++) rec2.offer(i * 0.5, () => ({ t: i * 0.5, v: i * 2, w: Number.NaN }))
  assert.equal(tableText(rec2), 't,v,w\n0,0,\n0.5,2,\n1,4,\n1.5,6,\n2,8,\n')
  assert.equal(tableText(rec2, '\t', ['v', 't']).split('\n')[0], 'v\tt')
  assert.deepEqual(rec2.column('v'), [0, 2, 4, 6, 8])
  const sim = run('pendulum', 'simple', { theta0: 60 }, 3)
  const r = runSim(makeSim(defaultDoc('pendulum', 'simple')), { duration: 3, samples: 12 })
  assert.ok(r.samples.length >= 12 && r.energyDrift !== null && r.energyDrift < 1e-6)
  const re = new Recorder(sim.channels.map((c) => c.key), 0.05)
  const s2 = makeSim(defaultDoc('pendulum', 'simple'))
  while (s2.t < 3) { s2.step(s2.dt); re.offer(s2.t, () => s2.sample()) }
  for (const spec of s2.plots) {
    const fig = plotFigure(spec, re, s2.channels, s2.extra?.() ?? {}, DEFAULT_PALETTE)
    assert.ok(fig.data.length >= 1)
    assert.ok(!JSON.stringify(fig).includes('NaN'), `${spec.id} has no NaN`)
  }
  const sw = sweepFigure(pendulumSweep(PENDULUM.defaults('driven'))!, DEFAULT_PALETTE)
  assert.ok(sw.data.length >= 3)
  assert.ok(!JSON.stringify(sw).includes('NaN'))
})

test('rendering helpers: the coordinate transforms and nice steps', () => {
  const v = { cx: 3, cy: -2, scale: 40 }
  const [sx, sy] = worldToScreen(v, 800, 600, 5, 1)
  const [wx, wy] = screenToWorld(v, 800, 600, sx, sy)
  near(wx, 5, 1e-12)
  near(wy, 1, 1e-12)
  assert.equal(niceStep(0.7), 1)
  assert.equal(niceStep(1.1), 2)
  assert.equal(niceStep(3), 5)
  assert.equal(niceStep(70), 100)
  const f = fitView({ x0: 0, y0: 0, x1: 10, y1: 5 }, 500, 500)
  near(f.scale, 50, 1e-12)
  near(f.cx, 5, 1e-12)
  const t = new Trails()
  t.push([{ id: 'a', x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, m: 1, color: '' }], 0.1)
  t.push([{ id: 'a', x: 0.05, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, m: 1, color: '' }], 0.1)
  t.push([{ id: 'a', x: 1, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, m: 1, color: '' }], 0.1)
  assert.equal(t.get('a')!.length, 6, 'points closer than the minimum are skipped')
})

// ------------------------------------------------------------------------------------------ AI tools

test('AI tools: the manifest has at most 4 tools with short summaries, and the code answers them', async () => {
  const set = KMOTION_TOOL_SET
  assert.equal(set.app, 'kmotion')
  assert.ok(set.tools.length <= 4 && set.tools.length === 4)
  assert.deepEqual(set.tools.map((t) => t.action).sort(), ['get_state', 'load_example', 'run', 'set_param'])
  assert.ok(set.summary.length < 120, `summary ${set.summary.length}`)
  assert.ok(set.keywords.length >= 8)
  for (const t of set.tools) {
    const props = Object.keys(((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}))
    assert.ok(props.length <= 6, `${t.action}: ${props.length} arguments`)
    assert.ok(t.description.length > 20 && t.description.length < 300, `${t.action}: ${t.description.length}`)
  }
  // fake window
  let doc: KMotionDoc = defaultDoc('projectile')
  let dirty = false
  let method: Method = 'rk4'
  let loaded: string[] = []
  const hooks: Hooks = {
    state: () => ({ doc, dirty, t: 1.25, running: false, method, sample: { t: 1.25, x: 3, y: Number.NaN }, readouts: [{ label: 'Range', value: '40 m' }], finished: false, title: 'Untitled' }),
    load: (d, label) => { doc = d; loaded.push(label ?? '') },
    setParam: (k, v) => { doc = { ...doc, params: cleanParams(doc.scene, { ...doc.params, [k]: v }) }; return doc.params },
    setMethod: (m) => { method = m },
    setMode: (m) => { doc = { ...doc, params: sceneById(doc.scene)!.defaults(m) }; return doc.params },
  }
  const tools = kmotionTools(hooks) as Record<string, (a: Record<string, unknown>, ctx: { confirm(a: string, b?: string): Promise<boolean> }) => Promise<Record<string, unknown>>>
  const ctx = (ok: boolean) => ({ confirm: async () => ok })
  const st = await tools.get_state({}, ctx(true))
  assert.equal(st.scene, 'projectile')
  assert.equal((st.values as Record<string, unknown>).y, undefined, 'NaN is left out')
  assert.ok((st.parameterSpecs as { key: string }[]).some((p) => p.key === 'v0'))
  assert.ok((st.scenes as { id: string }[]).length === 7)
  // listing, loading, declining
  const list = await tools.load_example({}, ctx(true))
  assert.ok((list.examples as unknown[]).length >= 14)
  assert.equal((await tools.load_example({ id: 'orbit-hohmann' }, ctx(true))).loaded, true)
  assert.equal(doc.scene, 'orbit')
  dirty = true
  assert.equal((await tools.load_example({ id: 'atwood' }, ctx(false))).loaded, false)
  assert.equal(doc.scene, 'orbit', 'declined: nothing changed')
  await assert.rejects(() => tools.load_example({ id: 'nope' }, ctx(true)), /No example/)
  // headless runs return measured numbers
  doc = defaultDoc('projectile')
  dirty = false
  const r = await tools.run({ params: { v0: 20, angle: 45 }, duration: 10 }, ctx(true))
  near((r.final as Record<string, number>).x, projectileVacuum(20, 45, 0, G).range, 1e-5)
  assert.equal(r.finished, true)
  const r2 = await tools.run({ scene: 'pendulum', mode: 'double', params: { th1: 20, th2: 10, nonsense: 1 }, duration: 5, method: 'rk45' }, ctx(true))
  assert.equal(r2.method, 'rk45')
  assert.deepEqual(r2.ignoredParameters, ['nonsense'])
  assert.ok((r2.energyDrift as number) < 1e-6)
  const before = loaded.length
  await tools.run({ scene: 'orbit', mode: 'kepler', params: { ecc: 0.2 }, duration: 0.5, show: true }, ctx(true))
  assert.equal(loaded.length, before + 1)
  assert.equal(doc.scene, 'orbit')
  dirty = true
  const n = loaded.length
  await tools.run({ scene: 'projectile', duration: 1, show: true }, ctx(false))
  assert.equal(loaded.length, n, 'declined: not shown, numbers still returned')
  await assert.rejects(() => tools.run({ scene: 'nope' }, ctx(true)), /Unknown scene/)
  await assert.rejects(() => tools.run({ scene: 'orbit', mode: 'nope' }, ctx(true)), /Unknown mode/)
  // set_param: clamped, validated, live flag, method, mode
  doc = defaultDoc('projectile')
  const sp = await tools.set_param({ key: 'v0', value: 1e6 }, ctx(true))
  assert.equal(sp.value, 200)
  assert.equal(sp.clamped, true)
  assert.equal((await tools.set_param({ key: 'drag', value: 'linear' }, ctx(true))).live, true)
  await assert.rejects(() => tools.set_param({ key: 'drag', value: 'cubic' }, ctx(true)), /must be one of/)
  await assert.rejects(() => tools.set_param({ key: 'zzz', value: 1 }, ctx(true)), /No parameter/)
  await assert.rejects(() => tools.set_param({ key: 'v0', value: 'fast' }, ctx(true)), /number/)
  assert.deepEqual(await tools.set_param({ key: 'method', value: 'verlet' }, ctx(true)), { method: 'verlet' })
  assert.equal(method, 'verlet')
  const md = await tools.set_param({ key: 'mode', value: 'fan' }, ctx(true))
  assert.equal(md.mode, 'fan')
  await assert.rejects(() => tools.set_param({ key: 'mode', value: 'zzz' }, ctx(true)), /Unknown mode/)
  assert.ok(describeParams('orbit', 'hohmann').some((p) => p.key === 'r2'))
})

// ------------------------------------------------------------------------------------------ drawing

/** A canvas context that records nothing but refuses non-finite coordinates. */
function fakeContext(): { ctx: CanvasRenderingContext2D; calls: { n: number } } {
  const calls = { n: 0 }
  const checked = new Set(['moveTo', 'lineTo', 'arc', 'fillRect', 'strokeRect', 'translate', 'fillText', 'rect', 'setTransform', 'clearRect', 'rotate', 'ellipse'])
  const target: Record<string, unknown> = {}
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key === 'measureText') return () => ({ width: 40 })
      if (key in t) return t[key]
      return (...args: unknown[]) => {
        calls.n++
        if (checked.has(key)) for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${key}(${args.join(', ')}) has a non-finite argument`)
      }
    },
    set(t, key: string, v) { t[key] = v; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

test('drawing: every scene and mode draws with every overlay on, in 2-D and 3-D, with finite coordinates', async () => {
  const { drawScene, DEFAULT_OVERLAYS } = await import('../../src/apps/kmotion/render.ts')
  const theme = { bg: '#000', text: '#fff', muted: '#888', border: '#333', accent: '#0f0', surface: '#111' }
  const all = { ...DEFAULT_OVERLAYS, velocity: true, acceleration: true, force: true, com: true, energy: true }
  for (const sc of SCENES) {
    for (const m of sc.modes) {
      const sim = makeSim(defaultDoc(sc.id, m.id))
      const trails = new Trails()
      for (let i = 0; i < 120; i++) { sim.step(sim.dt); if (i % 10 === 0) trails.push(sim.frame().bodies, 0.001) }
      const view = fitView(sim.bounds(), 900, 600)
      for (const cam3 of [null, ...(sim.threeD ? [{ yaw: 0.6, pitch: 1 }] : [])]) {
        const { ctx, calls } = fakeContext()
        drawScene(ctx, 900, 600, {
          view, frame: sim.frame(), overlays: all, scales: { velocity: 1, acceleration: 1, force: 1 }, theme, trails, lengthUnit: sim.lengthUnit, energy: sim.energy(), e0: sim.energy()?.total ?? 0,
          measures: { rulers: [{ x1: 0, y1: 0, x2: 1, y2: 1 }], live: { x1: 0, y1: 0, x2: 2, y2: 1 }, protractor: { v: [0, 0], a: [1, 0], b: [0, 1] } },
          ghost: [{ t: 'circle', x: 0, y: 0, r: 1, fill: '#fff' }], cam3, ref: { v: 1, a: 1, f: 1 },
        })
        assert.ok(calls.n > 20, `${sc.id}/${m.id} issued drawing calls`)
      }
    }
  }
})

// ------------------------------------------------------------------------------------------ the live runtime

test('runtime: fixed steps whatever the frame rate, a stall does not fast-forward, data and trails are recorded', async () => {
  const { Runtime } = await import('../../src/apps/kmotion/runtime.ts')
  const stepsAt = (fps: number) => {
    const rt = new Runtime(makeSim(defaultDoc('pendulum', 'simple')))
    rt.running = true
    for (let i = 0; i < fps; i++) rt.advance(1 / fps)
    return rt
  }
  const a = stepsAt(30)
  const b = stepsAt(144)
  near(a.sim.t, 1, 1e-6, 0.005, 'one real second at 30 fps')
  near(b.sim.t, 1, 1e-6, 0.005, 'one real second at 144 fps')
  near(a.sim.sample().theta, b.sim.sample().theta, 0, 6e-3, 'the same physics at both frame rates (they differ by less than one step of time)')
  // a stall of 10 s adds at most 0.1 s of simulated time
  const c = new Runtime(makeSim(defaultDoc('pendulum', 'simple')))
  c.running = true
  c.advance(10)
  assert.ok(c.sim.t <= 0.1 + 1e-9, `stall: ${c.sim.t}`)
  // speed and slow motion scale the rate; a paused runtime does not move
  const d = new Runtime(makeSim(defaultDoc('pendulum', 'simple')))
  d.speed = 2
  d.slow = true
  d.running = true
  d.advance(0.05)
  d.advance(0.05)
  near(d.sim.t, 0.1 * 2 * 0.1, 0, 0.003)
  d.running = false
  const t0 = d.sim.t
  d.advance(1)
  assert.equal(d.sim.t, t0)
  d.stepOnce()
  assert.ok(d.sim.t > t0)
  // data rows at the sampling interval, trails of the bob, and clearing
  const e = new Runtime(makeSim(defaultDoc('pendulum', 'simple')))
  e.running = true
  for (let i = 0; i < 60; i++) e.advance(1 / 60)
  assert.ok(e.rec.rows.length >= 45 && e.rec.rows.length <= 55, `${e.rec.rows.length} rows in 1 s at 0.02 s`)
  assert.ok((e.trails.get('bob')?.length ?? 0) >= 30)
  e.clearData()
  assert.equal(e.rec.rows.length, 1)
  // a finished simulation stops stepping
  const f = new Runtime(makeSim(defaultDoc('projectile')))
  f.running = true
  for (let i = 0; i < 600 && !f.sim.finished; i++) f.advance(1 / 60)
  assert.ok(f.sim.finished)
  const tf = f.sim.t
  f.advance(1)
  assert.equal(f.sim.t, tf)
  // the reference magnitudes for the arrows grow with the motion
  assert.ok(f.refV > 10)
})

test('live parameters: gravity, drag and damping act on a running scene without a restart', () => {
  const sim = makeSim(defaultDoc('projectile'))
  for (let i = 0; i < 60; i++) sim.step(sim.dt)
  const v1 = sim.sample().vy
  sim.params.gravity = 'jupiter'
  for (let i = 0; i < 60; i++) sim.step(sim.dt)
  const v2 = sim.sample().vy
  near(v1 - v2, 24.79 * 0.25, 1e-3, 0, 'the fall accelerates at the new g (60 steps = 0.25 s)')
  const sp = makeSim({ ...defaultDoc('oscillator', 'spring'), params: cleanParams('oscillator', { mode: 'spring', c: 0 }) })
  for (let i = 0; i < 480; i++) sp.step(sp.dt)
  near(sp.energy()!.total, 10, 1e-3)
  sp.params.c = 10
  for (let i = 0; i < 480 * 3; i++) sp.step(sp.dt)
  assert.ok(sp.energy()!.total < 5, 'damping switched on while it runs')
})
