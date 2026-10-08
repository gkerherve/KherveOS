// kElec: the SPICE engine against analytic results, the netlist parser, net extraction, the .kelec file,
// the knetlist export, the calculators and the example library. No browser. Run:
//   node --test tools/tests/kelec.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acSweep, dcSweep, operatingPoint, simulate, transient } from '../../src/apps/kelec/sim/engine.ts'
import { parseSpice, toSpice } from '../../src/apps/kelec/sim/spice.ts'
import { formatValue, parseValue, spiceValue } from '../../src/apps/kelec/sim/units.ts'
import { cornerFrequency, crossings, evalExpr, fourier, frequencyOf, resonance, riseTime, slopeDbPerDecade, stats, valueAt } from '../../src/apps/kelec/sim/measure.ts'
import { diagnose } from '../../src/apps/kelec/sim/diagnose.ts'
import type { Circuit } from '../../src/apps/kelec/sim/circuit.ts'
import { emptyDoc, newPart, pinPositions, type Doc } from '../../src/apps/kelec/model.ts'
import { buildNetlist, circuitToDoc, extractNets } from '../../src/apps/kelec/netlist.ts'
import { EXAMPLES, exampleById, exampleDoc } from '../../src/apps/kelec/examples.ts'
import { analysisOf, DEFAULT_SETTINGS, settingsFrom } from '../../src/apps/kelec/settings.ts'
import { parseKelec, serializeKelec } from '../../src/apps/kelec/file.ts'
import { toKNetlist } from '../../src/apps/kelec/netlistExport.ts'
import { docToSvg } from '../../src/apps/kelec/svg.ts'
import {
  History, addPath, cloneDoc, copyItems, deleteItems, hitPart, hitPin, hitWire, itemsInBox, junctions, mirrorItems, moveItems, pasteClip, rotateItems, route, searchParts, splitWires,
} from '../../src/apps/kelec/editor.ts'
import { annotations } from '../../src/apps/kelec/annotate.ts'
import { bomCsv, bomMarkdown, bomOf } from '../../src/apps/kelec/bom.ts'
import { kelecTools, resolveKind, type Hooks } from '../../src/apps/kelec/aiTools.ts'
import { KELEC_TOOL_SET } from '../../src/os/ai/manifests/kelec.ts'
import { stubToNet, freeSpot } from '../../src/apps/kelec/editor.ts'
import { bodeFigure, scopeFigure, traceCsv } from '../../src/apps/kelec/figures.ts'
import { acTrace, powerTable, prepareNetlist, prepareSchematic, runPrepared, summarize, traceData } from '../../src/apps/kelec/session.ts'
import {
  CALCULATORS, awg, batteryHours, bestPairs, butterworthG, butterworthLadder, colorBands, decibels, divider, impedance, ledResistor, ne555Astable, ne555Monostable, nearestE, ohm,
  parallelOf, powerFactor, rcTimeTo, rlcSeries, runCalculator, seriesOf, thevenin, valueFromBands, defaultInputs,
} from '../../src/apps/kelec/calc.ts'

const near = (a: number, b: number, rel = 1e-6, abs = 0) => assert.ok(Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel), `${a} ≈ ${b} (rel ${rel}, abs ${abs})`)
const ckt = (text: string): Circuit => parseSpice(text).circuit
const at = (r: { t: number[]; signals: Record<string, number[]> }, name: string, t: number) => valueAt(r.t, r.signals[name], t)

// ------------------------------------------------------------------------------ numbers

test('engineering notation: parse and format', () => {
  near(parseValue('4.7k')!, 4700)
  near(parseValue('1meg')!, 1e6)
  near(parseValue('1MEG')!, 1e6)
  near(parseValue('10u')!, 1e-5)
  near(parseValue('2.2nF')!, 2.2e-9)
  near(parseValue('100p')!, 1e-10)
  near(parseValue('5V')!, 5)
  near(parseValue('1e-3')!, 1e-3)
  near(parseValue('3m')!, 3e-3)
  near(parseValue('-2.5')!, -2.5)
  assert.equal(parseValue('abc'), null)
  assert.equal(parseValue(''), null)
  assert.equal(formatValue(4700), '4.7k')
  assert.equal(formatValue(2.2e-9), '2.2n')
  assert.equal(formatValue(1e6), '1M')
  assert.equal(spiceValue(1e6), '1meg')
  assert.equal(spiceValue(4700), '4.7k')
  assert.equal(spiceValue(1e-5), '10u')
})

// ------------------------------------------------------------------------------ DC

test('voltage divider and the power balance', () => {
  const op = operatingPoint(ckt(`divider
V1 in 0 10
R1 in out 1k
R2 out 0 3k
.end`))
  near(op.nodes.out, 7.5, 1e-6)
  near(op.currents.R1, 2.5e-3, 1e-6)
  near(op.power.V1, -0.025, 1e-6)
  near(op.suppliedPower, op.dissipatedPower, 1e-6)
  assert.ok(Math.abs(op.totalPower) < 1e-9)
})

test('Wheatstone bridge', () => {
  const op = operatingPoint(ckt(`bridge
V1 top 0 10
R1 top a 1k
R2 a 0 2k
R3 top b 3k
R4 b 0 5k
R5 a b 10k
.end`))
  // solve by hand: node equations
  const g = [[1 / 1000 + 1 / 2000 + 1 / 10000, -1 / 10000], [-1 / 10000, 1 / 3000 + 1 / 5000 + 1 / 10000]]
  const rhs = [10 / 1000, 10 / 3000]
  const det = g[0][0] * g[1][1] - g[0][1] * g[1][0]
  const va = (rhs[0] * g[1][1] - g[0][1] * rhs[1]) / det
  const vb = (g[0][0] * rhs[1] - g[1][0] * rhs[0]) / det
  near(op.nodes.a, va, 1e-6)
  near(op.nodes.b, vb, 1e-6)
  // a balanced bridge: no current in the detector
  const bal = operatingPoint(ckt(`b\nV1 t 0 10\nR1 t a 1k\nR2 a 0 2k\nR3 t b 3k\nR4 b 0 6k\nR5 a b 1k\n.end`))
  near(bal.currents.R5, 0, 1, 1e-9)
})

test('diode with a resistor against the Shockley solution', () => {
  const is = 1e-14
  const vt = 0.025852
  const op = operatingPoint(ckt(`d
V1 in 0 5
R1 in a 1k
D1 a 0 DM
.model DM D(IS=1e-14 N=1)
.end`))
  // bisection on (5 − v)/1k = Is (e^{v/vt} − 1)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const f = (5 - mid) / 1000 - is * (Math.exp(mid / vt) - 1)
    if (f > 0) lo = mid; else hi = mid
  }
  near(op.nodes.a, lo, 1e-5)
  near(op.currents.D1, (5 - lo) / 1000, 1e-4)
})

test('BJT bias point obeys KCL and beta', () => {
  const op = operatingPoint(ckt(`ce
VCC vcc 0 12
RB vcc b 1meg
RC vcc c 2.2k
Q1 c b 0 2N3904
.end`))
  const vbe = op.nodes.b
  const ib = (12 - vbe) / 1e6
  near(op.currents.RB, ib, 1e-6)
  assert.ok(vbe > 0.55 && vbe < 0.78, `Vbe ${vbe}`)
  const ic = op.currents.Q1
  near(op.nodes.c, 12 - ic * 2200, 1e-6)
  const beta = ic / ib
  near(beta, 416 * (1 + op.nodes.c / 74), 0.05)
  assert.ok(op.nodes.c > 0.3 && op.nodes.c < 12)
  // an independent solution of the same Ebers–Moll model (Is 6.7 fA, βF 416, βR 0.74, VAF 74 V)
  const vt = 0.025852
  let vce = 5
  let vbeSol = 0.7
  let icSol = 0
  for (let k = 0; k < 60; k++) {
    let lo = 0.3
    let hi = 0.9
    for (let i = 0; i < 100; i++) {
      const vbe = (lo + hi) / 2
      const vbc = vbe - vce
      const ib = (6.7e-15 / 416) * (Math.exp(vbe / vt) - 1) + (6.7e-15 / 0.74) * (Math.exp(vbc / vt) - 1)
      if ((12 - vbe) / 1e6 > ib) lo = vbe; else hi = vbe
    }
    vbeSol = (lo + hi) / 2
    const vbc = vbeSol - vce
    const If = 6.7e-15 * (Math.exp(vbeSol / vt) - 1)
    const Ir = 6.7e-15 * (Math.exp(vbc / vt) - 1)
    icSol = (If - Ir) * (1 - vbc / 74) - Ir / 0.74
    vce = 12 - icSol * 2200
  }
  near(vbe, vbeSol, 2e-3)
  near(op.currents.Q1, icSol, 1e-2)
  near(op.nodes.c, vce, 1e-2)
})

test('MOSFET as a switch: on and off against the triode equation', () => {
  const build = (vg: number) => ckt(`m\nVDD dd 0 5\nRD dd d 100\nVG g 0 ${vg}\nM1 d g 0 0 NM\n.model NM NMOS(VTO=2 KP=0.12)\n.end`)
  const off = operatingPoint(build(0))
  near(off.nodes.d, 5, 1e-6)
  const on = operatingPoint(build(5))
  // (5 − v)/100 = beta ((vgs − vt) v − v²/2)  with beta = 0.12, vgs − vt = 3
  const beta = 0.12
  const a = beta / 2
  const b = -(beta * 3 + 0.01)
  const c = 0.05
  const v = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)
  near(on.nodes.d, v, 1e-5)
  assert.ok(on.nodes.d < 0.5)
  assert.match(on.devices.M1, /triode/)
})

test('inverting and non-inverting op-amp gains', () => {
  const inv = operatingPoint(ckt(`inv\nV1 in 0 0.1\nR1 in n 1k\nR2 n out 10k\nX1 0 n out OPAMP\n.end`))
  near(inv.nodes.out, -1, 1e-4)
  const non = operatingPoint(ckt(`non\nV1 in 0 0.1\nR1 n 0 1k\nR2 n out 9k\nX1 in n out OPAMP\n.end`))
  near(non.nodes.out, 1, 1e-4)
  // output limit
  const sat = operatingPoint(ckt(`sat\nV1 in 0 5\nR1 in n 1k\nR2 n out 100k\nX1 0 n out OPAMP RAIL=12\n.end`))
  assert.ok(sat.nodes.out < -11.9 && sat.nodes.out > -12.1, `${sat.nodes.out}`)
})

test('Zener regulator holds its voltage', () => {
  const run = (vin: number) => operatingPoint(ckt(`z\nV1 in 0 ${vin}\nR1 in o 470\nD1 0 o DZ\nRL o 0 2k\n.model DZ D(IS=1e-14 BV=5.1 IBV=5m)\n.end`)).nodes.o
  const lo = run(10)
  const hi = run(14)
  assert.ok(lo > 4.7 && lo < 5.5, `${lo}`)
  assert.ok(hi - lo < 0.1, `line regulation ${hi - lo}`)
  const dc = dcSweep(ckt(`z\nV1 in 0 0\nR1 in o 470\nD1 0 o DZ\nRL o 0 2k\n.model DZ D(IS=1e-14 BV=5.1 IBV=5m)\n.end`), 'V1', 0, 14, 1)
  assert.equal(dc.x.length, 15)
  assert.ok(dc.signals['V(o)'][14] < 5.6)
  assert.ok(dc.signals['V(o)'][3] < 3.1 && dc.signals['V(o)'][3] > 2.3)
})

test('DC sweep of a resistive circuit is linear', () => {
  const r = dcSweep(ckt(`l\nV1 in 0 0\nR1 in o 1k\nR2 o 0 1k\n.end`), 'V1', 0, 10, 2)
  assert.deepEqual(r.x, [0, 2, 4, 6, 8, 10])
  r.x.forEach((x, i) => near(r.signals['V(o)'][i], x / 2, 1e-6, 1e-9))
})

test('a current source into a resistor, VCVS and VCCS', () => {
  const op = operatingPoint(ckt(`s\nI1 0 a 2m\nR1 a 0 1k\nE1 b 0 a 0 3\nG1 0 c a 0 1m\nR2 c 0 1k\n.end`))
  near(op.nodes.a, 2, 1e-6)
  near(op.nodes.b, 6, 1e-6)
  near(op.nodes.c, 2, 1e-6)
})

// ------------------------------------------------------------------------------ transient

test('RC step response v(t) = V (1 − e^{−t/RC}), error under 0.5 %', () => {
  const r = transient(ckt(`rc
V1 in 0 PULSE(0 5 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.end`), { tstop: 5e-3 })
  for (const t of [0.2e-3, 0.5e-3, 1e-3, 2e-3, 3e-3, 5e-3]) {
    const exact = 5 * (1 - Math.exp(-t / 1e-3))
    near(at(r, 'V(out)', t), exact, 5e-3)
  }
  // discharge as well
  const d = transient(ckt(`rc
V1 in 0 PULSE(5 0 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.end`), { tstop: 4e-3 })
  near(at(d, 'V(out)', 1e-3), 5 * Math.exp(-1), 5e-3)
  near(at(d, 'V(out)', 3e-3), 5 * Math.exp(-3), 5e-3, 1e-3)
})

test('RL step response i(t) = V/R (1 − e^{−tR/L})', () => {
  const r = transient(ckt(`rl
V1 in 0 PULSE(0 10 0 1n 1n 1 2)
R1 in a 100
L1 a 0 100m
.end`), { tstop: 5e-3 })
  const tau = 100e-3 / 100
  for (const t of [0.5e-3, 1e-3, 2e-3, 4e-3]) near(at(r, 'I(L1)', t), 0.1 * (1 - Math.exp(-t / tau)), 5e-3)
})

test('RLC step response rings at the damped natural frequency', () => {
  const L = 10e-3
  const C = 1e-6
  const R = 20
  const r = transient(ckt(`rlc
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in a ${R}
L1 a out ${L}
C1 out 0 ${C}
.end`), { tstop: 3e-3 })
  const a = R / (2 * L)
  const w0 = 1 / Math.sqrt(L * C)
  const wd = Math.sqrt(w0 * w0 - a * a)
  for (const t of [0.2e-3, 0.4e-3, 0.8e-3, 1.5e-3]) {
    const exact = 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t))
    near(at(r, 'V(out)', t), exact, 0.02, 0.01)
  }
  // overshoot of an under-damped response
  const s = stats(r.t, r.signals['V(out)'])
  assert.ok(s.max > 1.5 && s.max < 2)
})

test('initial conditions: a capacitor starting at 5 V discharges', () => {
  const r = transient(ckt(`ic\nR1 a 0 1k\nC1 a 0 1u IC=5\n.end`), { tstop: 3e-3, uic: true })
  near(at(r, 'V(a)', 0), 5, 1e-6)
  near(at(r, 'V(a)', 1e-3), 5 * Math.exp(-1), 5e-3)
})

test('half-wave rectifier peak is about Vpk − Vd, smoothed by a capacitor', () => {
  const r = transient(ckt(`hw
V1 in 0 SIN(0 5 50)
D1 in out DM
R1 out 0 1k
.model DM D(IS=1e-14 N=1)
.end`), { tstop: 0.06 })
  const s = stats(r.t, r.signals['V(out)'])
  assert.ok(s.max > 4.2 && s.max < 4.5, `peak ${s.max}`)
  assert.ok(s.min > -1e-3)
  const sm = transient(ckt(`hw
V1 in 0 SIN(0 5 50)
D1 in out DM
R1 out 0 1k
C1 out 0 100u
.model DM D(IS=1e-14 N=1)
.end`), { tstop: 0.15 })
  const tail = stats(sm.t, sm.signals['V(out)'], 0.1)
  assert.ok(tail.min > 2.5, `ripple floor ${tail.min}`)
  assert.ok(tail.max > 4.2)
})

test('a timed switch is a breakpoint: an RC charges only while it is closed', () => {
  const r = transient(ckt(`sw
V1 in 0 5
S1 in a TIMED(1m 1m 0)
R1 a out 1k
C1 out 0 1u
R2 out 0 1meg
.end`), { tstop: 4e-3 })
  near(at(r, 'V(out)', 0.9e-3), 0, 1, 0.01)
  near(at(r, 'V(out)', 2e-3), 5 * (1 - Math.exp(-1)), 2e-2, 0.02)
  // after opening, the capacitor holds (2 MΩ-ish leakage only)
  assert.ok(at(r, 'V(out)', 3.9e-3) > 3.0)
})

test('coupled inductors (transformer) step up an AC voltage', () => {
  const r = transient(ckt(`tr
V1 in 0 SIN(0 1 1k)
L1 in 0 1
L2 out 0 4
K1 L1 L2 0.9999
R1 out 0 100k
.end`), { tstop: 5e-3 })
  const s = stats(r.t, r.signals['V(out)'], 3e-3)
  near(s.max, 2, 0.03)
})

test('Fourier analysis and THD of a clean sine and of a clipped one', () => {
  const clean = transient(ckt(`s\nV1 a 0 SIN(0 1 1k)\nR1 a 0 1k\n.end`), { tstop: 5e-3 })
  const f = fourier(clean.t, clean.signals['V(a)'], 1000, 9, 2)
  near(f.harmonics[0].mag, 1, 5e-3)
  assert.ok(f.thd < 5e-3, `thd ${f.thd}`)
  const clip = transient(ckt(`c\nV1 in 0 SIN(0 3 1k)\nR1 in o 1k\nD1 o 0 DM\nD2 0 o DM\n.model DM D(IS=1e-14)\n.end`), { tstop: 5e-3 })
  const g = fourier(clip.t, clip.signals['V(o)'], 1000, 9, 2)
  assert.ok(g.thd > 0.05)
  near(frequencyOf(clean.t, clean.signals['V(a)'])!, 1000, 5e-3)
})

test('measurements: rise time of an RC, RMS and average of a sine', () => {
  const r = transient(ckt(`rc\nV1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.end`), { tstop: 8e-3 })
  near(riseTime(r.t, r.signals['V(out)'])!, 2.2e-3, 0.03)
  const s = transient(ckt(`s\nV1 a 0 SIN(0 2 1k)\nR1 a 0 1k\n.end`), { tstop: 4e-3 })
  const st = stats(s.t, s.signals['V(a)'])
  near(st.rms, 2 / Math.SQRT2, 5e-3)
  near(st.mean, 0, 1, 5e-3)
  assert.equal(crossings(s.t, s.signals['V(a)'], 0, 1).length >= 3, true)
})

// ------------------------------------------------------------------------------ AC

test('RC low-pass: −3 dB at fc, −20 dB/decade, −45° at fc', () => {
  const fc = 1 / (2 * Math.PI * 1e3 * 1e-6)
  const ac = acSweep(ckt(`lp\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.end`), 1, 1e6, 100)
  const mag = ac.mag['V(out)']
  const f3 = cornerFrequency(ac.freq, mag)!
  near(f3, fc, 5e-3)
  near(slopeDbPerDecade(ac.freq, mag, 10 * fc, 100 * fc), -20, 0.02)
  const k = ac.freq.findIndex((f) => f >= fc)
  const frac = (fc - ac.freq[k - 1]) / (ac.freq[k] - ac.freq[k - 1])
  const ph = ac.phase['V(out)'][k - 1] + frac * (ac.phase['V(out)'][k] - ac.phase['V(out)'][k - 1])
  near(ph, -45, 0.02)
  near(mag[0], 1, 1e-4)
})

test('series RLC resonance: f0 = 1/(2π√LC) and Q from the half-power bandwidth', () => {
  const L = 10e-3
  const C = 100e-9
  const R = 10
  const ac = acSweep(ckt(`rlc\nV1 in 0 AC 1\nL1 in a ${L}\nC1 a b ${C}\nR1 b 0 ${R}\n.end`), 100, 1e6, 400)
  const res = resonance(ac.freq, ac.mag['V(b)'])
  near(res.f0, 1 / (2 * Math.PI * Math.sqrt(L * C)), 5e-3)
  near(res.peak, 1, 5e-3)
  near(res.q!, Math.sqrt(L / C) / R, 0.03)
})

test('AC of a BJT amplifier and of a finite-gain op-amp', () => {
  const amp = acSweep(ckt(`ce
VCC vcc 0 12
V1 in 0 AC 1
C1 in b 10u
R1 vcc b 100k
R2 b 0 22k
RC vcc c 3.3k
RE e 0 1k
CE e 0 100u
Q1 c b e 2N3904
.end`), 10, 1e6, 20)
  const gain = ac => Math.max(...ac.mag['V(c)'])
  assert.ok(gain(amp) > 20, `mid-band gain ${gain(amp)}`)
  // a unity-gain follower with GBW 1 MHz is −3 dB near 1 MHz: build it from the schematic part model
  const circ: Circuit = {
    title: 'gbw',
    elements: [
      { kind: 'V', name: 'V1', nodes: ['in', '0'], src: { dc: 0, acMag: 1, acPhase: 0 } },
      { kind: 'E', name: 'E1', nodes: ['x', '0', 'in', 'out'], value: 1e5 },
      { kind: 'R', name: 'R1', nodes: ['x', 'y'], value: 1000 },
      { kind: 'C', name: 'C1', nodes: ['y', '0'], value: 1 / (2 * Math.PI * 10 * 1000) },
      { kind: 'B', name: 'U1', nodes: ['out', 'y', '0'], fn: { type: 'opamp', gain: 1, rail: 15, supply: false, ro: 0 } },
    ],
  }
  const f = acSweep(circ, 1e3, 1e8, 50)
  near(cornerFrequency(f.freq, f.mag['V(out)'])!, 1e6, 0.05)
})

// ------------------------------------------------------------------------------ SPICE text

test('SPICE parser: suffixes, waveforms, continuation lines, .param and analyses', () => {
  const p = parseSpice(`* a test circuit
.param rl=2k
V1 in 0 DC 5 AC 1 SIN(0 1 1meg)
V2 b 0 PULSE(0 5 1u 10n 10n 5u 10u)
R1 in out {rl*2}
R2 out 0 4.7k ; load
C1 out 0 10u IC=1
L1 out x
+ 100m
D1 x 0 1N4148
Q1 x in 0 2N3904
.dc V1 0 5 0.5
.ac dec 10 1 1meg
.tran 1u 2m uic
.op
.end`)
  const el = (n: string) => p.circuit.elements.find((e) => e.name === n)!
  near((el('R1') as { value: number }).value, 4000)
  near((el('R2') as { value: number }).value, 4700)
  near((el('C1') as { value: number }).value, 1e-5)
  assert.equal((el('C1') as { ic?: number }).ic, 1)
  near((el('L1') as { value: number }).value, 0.1)
  const v1 = el('V1') as { src: { dc: number; acMag: number; wave: { kind: string; freq: number } } }
  assert.equal(v1.src.dc, 5)
  assert.equal(v1.src.acMag, 1)
  near(v1.src.wave.freq, 1e6)
  assert.equal(p.analyses.length, 4)
  assert.deepEqual(p.analyses.map((a) => a.type), ['dc', 'ac', 'tran', 'op'])
  assert.equal((p.analyses[2] as { uic?: boolean }).uic, true)
  assert.equal(p.circuit.title, 'a test circuit')
})

test('SPICE parser: errors are readable and carry line numbers', () => {
  assert.throws(() => parseSpice('t\nR1 a b\n.end'), /Line 2/)
  assert.throws(() => parseSpice('t\nQ1 a b c NOSUCH\n.end'), /not defined/)
  assert.throws(() => parseSpice('t\nR1 a 0 1k\nR1 b 0 1k\n.end'), /used twice/)
  assert.throws(() => parseSpice('t\nR1 a 0 -5\n.end'), /above zero/)
  assert.throws(() => parseSpice('t\nZ1 a 0 5\n.end'), /not a part/)
})

test('SPICE round trip: netlist → circuit → netlist → circuit', () => {
  const text = `round trip
V1 in 0 DC 5 SIN(0 1 1k)
R1 in a 4.7k
R2 a 0 1meg
C1 a b 10u
L1 b 0 2.2m
D1 a b DM
Q1 b a 0 QM
M1 a in 0 0 MM
E1 c 0 a 0 2
S1 c d ON
X1 a b e OPAMP GAIN=100k RAIL=12
X2 a b f AND VDD=3.3
.model DM D(IS=2.5n N=1.75)
.model QM NPN(IS=1e-14 BF=250 BR=3 VAF=80)
.model MM NMOS(VTO=1.5 KP=0.05 LAMBDA=0.02 W=2 L=1)
.end`
  const a = parseSpice(text).circuit
  const out = toSpice(a, [{ type: 'op' }])
  const b = parseSpice(out).circuit
  assert.equal(b.elements.length, a.elements.length)
  for (let i = 0; i < a.elements.length; i++) {
    const strip = (e: unknown) => JSON.parse(JSON.stringify(e, (k, v) => (k === 'name' && typeof v === 'string' && /^[A-Z_0-9]*MOD|^D$|^DM$|^QM$|^MM$/.test(v) ? undefined : v)))
    assert.deepEqual(strip(b.elements[i]), strip(a.elements[i]), `element ${a.elements[i].name}`)
  }
  // the numbers come through: same operating point
  const o1 = operatingPoint(ckt(`rt\nV1 in 0 5\nR1 in a 4.7k\nR2 a 0 1meg\nD1 a 0 D\n.end`))
  const o2 = operatingPoint(parseSpice(toSpice(ckt(`rt\nV1 in 0 5\nR1 in a 4.7k\nR2 a 0 1meg\nD1 a 0 D\n.end`))).circuit)
  near(o1.nodes.a, o2.nodes.a, 1e-9)
})

test('simulate() dispatches on the analysis and reports readable errors', () => {
  const c = ckt('x\nV1 a 0 1\nR1 a 0 1k\n.end')
  assert.equal(simulate(c, { type: 'op' }).type, 'op')
  assert.equal(simulate(c, { type: 'dc', source: 'V1', start: 0, stop: 1, step: 0.5 }).type, 'dc')
  assert.throws(() => simulate(c, { type: 'ac', fstart: 1, fstop: 1e3, perDecade: 5 }), /AC value|AC amplitude/)
  assert.throws(() => simulate(c, { type: 'dc', source: 'R1', start: 0, stop: 1, step: 0.5 }), /voltage or current source/)
  assert.throws(() => operatingPoint(ckt('x\nV1 a 0 1\nV2 a 0 2\n.end')), /singular|cannot be solved/)
})

test('trace expressions', () => {
  const sig = { 'V(a)': [1, 2, 3], 'V(b)': [0.5, 1, 1.5], 'I(R1)': [1e-3, 2e-3, 3e-3] }
  assert.deepEqual(evalExpr('V(a)-V(b)', sig, 3), [0.5, 1, 1.5])
  evalExpr('V(a)*I(R1)', sig, 3).forEach((v, i) => near(v, [1e-3, 4e-3, 9e-3][i], 1e-9))
  assert.deepEqual(evalExpr('2*(V(b)+1k*I(R1))', sig, 3), [3, 6, 9])
  assert.throws(() => evalExpr('V(zz)', sig, 3), /no signal/)
})

// ------------------------------------------------------------------------------ diagnostics

test('diagnostics: no ground, floating part, source loop', () => {
  const noGnd = diagnose(ckt('t\nV1 a b 5\nR1 a b 1k\n.end'))
  assert.ok(noGnd.some((p) => p.code === 'no-ground'))
  const floating = diagnose(ckt('t\nV1 a 0 5\nR1 a 0 1k\nR2 x y 1k\n.end'))
  assert.ok(floating.some((p) => p.code === 'floating' && p.refs.includes('R2')))
  const loop = diagnose(ckt('t\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.end'))
  assert.ok(loop.some((p) => p.code === 'source-loop' && p.refs.includes('V2')))
  const capOnly = diagnose(ckt('t\nV1 a 0 5\nC1 a b 1u\nR1 b c 1k\n.end'))
  assert.ok(capOnly.some((p) => p.code === 'no-dc-path'))
  const fine = diagnose(ckt('t\nV1 a 0 5\nR1 a 0 1k\n.end'))
  assert.equal(fine.length, 0)
  assert.equal(diagnose({ title: '', elements: [] })[0].code, 'empty')
})


// ------------------------------------------------------------------------------ schematic nets

const docWith = (...parts: ReturnType<typeof newPart>[]): Doc => ({ ...emptyDoc(), parts })

test('net extraction: wires, T-junctions, labels, grounds, crossings', () => {
  const doc = emptyDoc()
  const r1 = newPart(doc, 'resistor', 100, 100)
  doc.parts.push(r1)
  const r2 = newPart(doc, 'resistor', 300, 100)
  doc.parts.push(r2)
  const g = newPart(doc, 'ground', 40, 160)
  doc.parts.push(g)
  // R1.2 (130,100) and R2.1 (270,100) are joined only by a label of the same name
  doc.labels.push({ id: 'l1', name: 'x', x: 130, y: 100 }, { id: 'l2', name: 'x', x: 270, y: 100 })
  // R1.1 (70,100) down to the ground symbol by a wire
  doc.wires.push({ id: 'w1', x1: 70, y1: 100, x2: 70, y2: 160 }, { id: 'w2', x1: 70, y1: 160, x2: 40, y2: 160 })
  const ex = extractNets(doc)
  assert.equal(ex.pinNet.get('R1.2'), ex.pinNet.get('R2.1'))
  assert.equal(ex.pinNet.get('R1.2'), 'x')
  assert.equal(ex.pinNet.get('R1.1'), '0')
  assert.notEqual(ex.pinNet.get('R2.2'), '0')
  // a label named 0 or GND is ground too
  doc.labels.push({ id: 'l3', name: 'GND', x: 330, y: 100 })
  assert.equal(extractNets(doc).pinNet.get('R2.2'), '0')
  // two crossing wires are not joined; a wire ending on another wire is
  const cross: Doc = { ...emptyDoc(), wires: [{ id: 'a', x1: 0, y1: 0, x2: 100, y2: 0 }, { id: 'b', x1: 50, y1: -50, x2: 50, y2: 50 }, { id: 'c', x1: 80, y1: 0, x2: 80, y2: 40 }] }
  const ex2 = extractNets(cross)
  assert.equal(ex2.pointNet.get('0,0'), ex2.pointNet.get('80,40'))
  assert.notEqual(ex2.pointNet.get('0,0'), ex2.pointNet.get('50,-50'))
  // a pin lying on a wire's interior touches it
  const through: Doc = docWith()
  through.parts.push(newPart(through, 'resistor', 100, 100))
  through.wires.push({ id: 'w', x1: 0, y1: 100, x2: 200, y2: 100 })
  const ex3 = extractNets(through)
  assert.equal(ex3.pinNet.get('R1.1'), ex3.pinNet.get('R1.2'))
})

test('building a circuit from a schematic: diagnostics point at parts', () => {
  const empty = buildNetlist(emptyDoc())
  assert.equal(empty.problems[0].code, 'empty')
  // no ground, a dangling pin, a bad value, a duplicate reference
  const doc = emptyDoc()
  doc.parts.push(newPart(doc, 'battery', 100, 100, { value: '5' }))
  doc.parts.push(newPart(doc, 'resistor', 200, 100, { value: '1k' }))
  doc.parts.push(newPart(doc, 'resistor', 300, 100, { value: 'abc' }))
  doc.parts.push(newPart(doc, 'resistor', 400, 100, { value: '1k', ref: 'R1' }))
  doc.wires.push({ id: 'w', x1: 100, y1: 70, x2: 170, y2: 100 })
  const b = buildNetlist(doc)
  const codes = b.problems.map((p) => p.code)
  assert.ok(codes.includes('no-ground'))
  assert.ok(codes.includes('unconnected'))
  assert.ok(b.problems.some((p) => p.code === 'bad-value' && p.refs.includes('R2')), 'R2 has a bad value')
  assert.ok(b.problems.some((p) => p.code === 'bad-value' && /Two parts are called R1/.test(p.message)))
  assert.throws(() => prepareSchematic(doc, DEFAULT_SETTINGS), /abc|Two parts/)
})

// ------------------------------------------------------------------------------ example library

test('the example library: every example builds, is wired as described, simulates and gives plausible values', () => {
  assert.ok(EXAMPLES.length >= 20, `${EXAMPLES.length} examples`)
  const ids = new Set(EXAMPLES.map((e) => e.id))
  assert.equal(ids.size, EXAMPLES.length)
  for (const ex of EXAMPLES) {
    const doc = exampleDoc(ex)
    const b = buildNetlist(doc, ex.title)
    const errors = b.problems.filter((p) => p.level === 'error')
    assert.equal(errors.length, 0, `${ex.id}: ${errors.map((e) => e.message).join('; ')}`)
    for (const [name, pins] of Object.entries(ex.layout.nets)) {
      const nets = new Set(pins.filter((q) => !q.startsWith('GND')).map((q) => b.pinNet.get(q) ?? `?${q}`))
      assert.equal(nets.size, 1, `${ex.id}: net ${name} is split or merged: ${[...nets].join(' | ')}`)
    }
    // nets stay apart
    const seen = new Map<string, string>()
    for (const [name, pins] of Object.entries(ex.layout.nets)) {
      if (name.startsWith('@')) continue
      const actual = b.pinNet.get(pins.find((q) => !q.startsWith('GND'))!)!
      assert.ok(!seen.has(actual) || seen.get(actual) === name || name === '0', `${ex.id}: nets ${seen.get(actual)} and ${name} are shorted together`)
      seen.set(actual, name)
    }
    const settings = { ...DEFAULT_SETTINGS, ...ex.sim }
    const out = runPrepared(prepareSchematic(doc, settings, ex.title))
    for (const e of ex.expect) {
      const r = out.result
      let got = NaN
      if (r.type === 'op') got = r.op.values[e.signal]
      else if (r.type === 'tran') {
        const y = traceData(r, e.signal)
        const st = stats(r.tran.t, y, e.from ?? -Infinity)
        got = e.kind === 'max' ? st.max : e.kind === 'min' ? st.min : e.kind === 'pp' ? st.pp : e.kind === 'mean' ? st.mean : e.kind === 'final' ? st.last : e.kind === 'freq' ? frequencyOf(r.tran.t, y, e.from) ?? NaN : NaN
      } else if (r.type === 'dc') got = r.sweep.signals[e.signal].at(-1)!
      else if (r.type === 'ac') got = e.kind === 'max' ? Math.max(...r.ac.mag[e.signal]) : r.ac.mag[e.signal][0]
      assert.ok(Math.abs(got - e.value) <= Math.max(e.tol * Math.abs(e.value), e.value === 0 ? e.tol : 0), `${ex.id}: ${e.signal} ${e.kind} = ${got}, expected ${e.value} ± ${e.tol}`)
    }
    // the SVG export and the .kelec file round trip
    const svg = docToSvg(doc).svg
    assert.ok(svg.startsWith('<svg') && svg.includes('</svg>'))
    const back = parseKelec(serializeKelec(doc, settings, ex.title))
    assert.deepEqual(back.doc, doc, `${ex.id}: .kelec round trip`)
    assert.deepEqual(back.sim, settings)
  }
  assert.ok(exampleById('divider'))
})

test('energy balance on a real circuit: the sources supply what the parts dissipate', () => {
  for (const id of ['divider', 'led', 'diffamp', 'wheatstone', 'thevenin']) {
    const ex = exampleById(id)!
    const out = runPrepared(prepareSchematic(exampleDoc(ex), { ...DEFAULT_SETTINGS, analysis: 'op' }))
    assert.equal(out.result.type, 'op')
    if (out.result.type !== 'op') continue
    const t = powerTable(out.result.op)
    assert.ok(t.supplied > 0, id)
    near(t.supplied, t.dissipated, 1e-6, 1e-9)
    const sum = t.rows.reduce((a, r) => a + r.power, 0)
    assert.ok(Math.abs(sum) < 1e-6 * Math.max(t.supplied, 1e-9), `${id}: ΣP = ${sum}`)
  }
})

test('annotations: a voltage per net and a current per part after a DC run', () => {
  const ex = exampleById('divider')!
  const doc = exampleDoc(ex)
  const prep = prepareSchematic(doc, { ...DEFAULT_SETTINGS })
  const out = runPrepared(prep)
  if (out.result.type !== 'op') throw new Error('op expected')
  const ann = annotations(doc, prep.build!, out.result.op)
  assert.ok(ann.some((a) => a.kind === 'voltage' && a.of === 'out' && a.text === '7.5 V'))
  assert.ok(ann.some((a) => a.kind === 'current' && a.of === 'R1' && /2.5/.test(a.text)))
})

// ------------------------------------------------------------------------------ .kelec and kPCB

test('.kelec: strict about the format, lenient about content', () => {
  assert.throws(() => parseKelec('nope'), /not valid JSON/)
  assert.throws(() => parseKelec('{"format":"other"}'), /not a kElec file/)
  assert.throws(() => parseKelec('{"format":"kelec","version":9}'), /newer/)
  const r = parseKelec(JSON.stringify({ format: 'kelec', version: 1, parts: [{ kind: 'resistor', ref: 'R1', x: 10, y: 20, value: '2k', rot: 90 }, { kind: 'warpdrive' }], wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 'a' }] }))
  assert.equal(r.doc.parts.length, 1)
  assert.equal(r.doc.parts[0].rot, 90)
  assert.equal(r.doc.parts[0].value, '2k')
  assert.equal(r.doc.wires.length, 1)
  assert.deepEqual(r.sim, DEFAULT_SETTINGS)
  const ex = exampleById('rc-lowpass')!
  const text = serializeKelec(exampleDoc(ex), { ...DEFAULT_SETTINGS, ...ex.sim }, 'demo')
  const j = JSON.parse(text)
  assert.equal(j.format, 'kelec')
  assert.equal(j.version, 1)
  assert.ok(Array.isArray(j.parts) && Array.isArray(j.wires) && Array.isArray(j.labels) && j.sim)
})

test('knetlist export has the agreed shape', () => {
  const ex = exampleById('ce-amp')!
  const k = toKNetlist(exampleDoc(ex), 'CE amp')
  assert.equal(k.format, 'knetlist')
  assert.equal(k.version, 1)
  assert.equal(k.name, 'CE amp')
  const kinds = ['resistor', 'capacitor', 'electrolytic', 'inductor', 'diode', 'led', 'zener', 'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'connector', 'ic', 'switch', 'potentiometer', 'source', 'other']
  const footprints = ['R_0805', 'R_0603', 'R_Axial_THT', 'C_0805', 'C_0603', 'C_Radial_THT', 'CP_Radial_THT', 'L_Axial_THT', 'D_SOD-123', 'D_DO-35', 'LED_0805', 'LED_5mm', 'SOT-23', 'TO-92', 'TO-220', 'DIP-8', 'SOIC-8', 'PinHeader_1x02', 'PinHeader_1x03', 'PinHeader_1x04']
  const refs = new Set(k.components.map((c) => c.ref))
  assert.equal(refs.size, k.components.length)
  for (const c of k.components) {
    assert.ok(kinds.includes(c.kind), c.kind)
    if (c.footprint) assert.ok(footprints.includes(c.footprint), `${c.ref}: ${c.footprint}`)
    assert.ok(c.pins.length >= 2)
    assert.equal(typeof c.value, 'string')
  }
  const q1 = k.components.find((c) => c.ref === 'Q1')!
  assert.equal(q1.kind, 'npn')
  assert.deepEqual([...q1.pins].sort(), ['B', 'C', 'E'])
  assert.equal(q1.footprint, 'TO-92')
  assert.equal(k.components.find((c) => c.ref === 'R1')!.value, '47kΩ')
  for (const n of k.nets) for (const p of n.pins) {
    assert.ok(refs.has(p.ref), `${n.name}: unknown ${p.ref}`)
    assert.ok(k.components.find((c) => c.ref === p.ref)!.pins.includes(p.pin), `${p.ref} has no pin ${p.pin}`)
  }
  const gnd = k.nets.find((n) => n.name === 'GND')!
  assert.ok(gnd.pins.some((p) => p.ref === 'RE'))
  assert.ok(!k.components.some((c) => c.kind === 'other' && c.ref.startsWith('GND')))
  // every pin of a component is on at most one net
  const used = new Set<string>()
  for (const n of k.nets) for (const p of n.pins) { const key = `${p.ref}.${p.pin}`; assert.ok(!used.has(key), key); used.add(key) }
  // op-amp pins
  const oa = toKNetlist(exampleDoc(exampleById('inverting')!))
  assert.deepEqual(oa.components.find((c) => c.ref === 'U1')!.pins, ['IN+', 'IN-', 'OUT', 'V+', 'V-'])
  assert.equal(oa.components.find((c) => c.ref === 'U1')!.kind, 'opamp')
})

test('SPICE export of a schematic and a netlist laid out as a schematic simulate the same', () => {
  for (const id of ['divider', 'ce-amp', 'inverting', 'zener', 'wheatstone']) {
    const ex = exampleById(id)!
    const built = buildNetlist(exampleDoc(ex))
    const cir = toSpice(built.circuit, [{ type: 'op' }])
    assert.match(cir, /\.end/)
    const again = parseSpice(cir)
    const a = operatingPoint(built.circuit)
    const b = operatingPoint(again.circuit)
    for (const [k, v] of Object.entries(a.nodes)) near(b.nodes[k], v, 1e-6, 1e-9)
    // …and laid out as a schematic, then rebuilt
    const doc = circuitToDoc(again.circuit)
    const rebuilt = buildNetlist(doc)
    assert.equal(rebuilt.problems.filter((p) => p.level === 'error').length, 0, `${id}: ${rebuilt.problems.map((p) => p.message).join('; ')}`)
    const c = operatingPoint(rebuilt.circuit)
    for (const [k, v] of Object.entries(a.nodes)) if (!/^N\d+$/.test(k)) near(c.nodes[k], v, 1e-6, 1e-9)
  }
})

test('netlist text → schematic → netlist keeps every part and value', () => {
  const text = `lp
V1 in 0 SIN(0 1 1k) AC 1
R1 in out 4.7k
C1 out 0 10u
L1 out x 2.2m
D1 x 0 1N4148
Q1 x out 0 2N3904
M1 x in 0 0 2N7000
X1 in out y OPAMP
.end`
  const p = parseSpice(text).circuit
  const doc = circuitToDoc(p)
  assert.equal(doc.parts.filter((q) => q.kind !== 'ground').length, p.elements.length)
  const back = buildNetlist(doc).circuit
  const names = (c: Circuit) => c.elements.map((e) => e.name).sort()
  assert.deepEqual(names(back), names(p))
  const r1 = back.elements.find((e) => e.name === 'R1') as { value: number }
  near(r1.value, 4700)
  const c1 = back.elements.find((e) => e.name === 'C1') as { value: number }
  near(c1.value, 1e-5, 1e-3)
})

// ------------------------------------------------------------------------------ editing

test('moving a part rubber-bands its wires and keeps them orthogonal', () => {
  const ex = exampleById('divider')!
  const doc = exampleDoc(ex)
  const r1 = doc.parts.find((p) => p.ref === 'R1')!
  const before = buildNetlist(doc)
  const moved = moveItems(doc, new Set([r1.id]), 20, 30)
  const after = buildNetlist(moved)
  assert.equal(moved.parts.find((p) => p.ref === 'R1')!.x, r1.x + 20)
  for (const w of moved.wires) assert.ok(w.x1 === w.x2 || w.y1 === w.y2, `diagonal wire ${JSON.stringify(w)}`)
  // connectivity is unchanged
  assert.equal(after.pinNet.get('R1.1'), before.pinNet.get('R1.1'))
  assert.equal(after.pinNet.get('R1.2'), before.pinNet.get('R1.2'))
  assert.equal(after.pinNet.get('R2.1'), before.pinNet.get('R2.1'))
  assert.equal(after.nets.length, before.nets.length)
  // the original is untouched
  assert.equal(doc.parts.find((p) => p.ref === 'R1')!.x, r1.x)
})

test('rotate and mirror move the pins as expected; delete removes only the selection', () => {
  const doc = emptyDoc()
  const p = newPart(doc, 'resistor', 100, 100)
  doc.parts.push(p)
  const pins = (d: Doc) => pinPositions(d.parts[0]).map((q) => `${q.name}@${q.x},${q.y}`)
  assert.deepEqual(pins(doc), ['1@70,100', '2@130,100'])
  const r = rotateItems(doc, new Set([p.id]))
  assert.deepEqual(pins(r), ['1@100,70', '2@100,130'])
  assert.equal(r.parts[0].rot, 90)
  const rr = rotateItems(rotateItems(rotateItems(r, new Set([p.id])), new Set([p.id])), new Set([p.id]))
  assert.deepEqual(pins(rr), pins(doc))
  const m = mirrorItems(doc, new Set([p.id]))
  assert.deepEqual(pins(m), ['1@130,100', '2@70,100'])
  const q = newPart(doc, 'capacitor', 300, 100)
  doc.parts.push(q)
  const d = deleteItems(doc, new Set([p.id]))
  assert.equal(d.parts.length, 1)
  assert.equal(d.parts[0].ref, 'C1')
})

test('copy and paste give new references; splitting wires at pins; junction dots; hit tests; history', () => {
  const ex = exampleById('rc-step')!
  const doc = exampleDoc(ex)
  const ids = new Set(doc.parts.filter((p) => p.ref === 'R1' || p.ref === 'C1').map((p) => p.id))
  const clip = copyItems(doc, ids)
  const pasted = pasteClip(doc, clip, 30, 30)
  assert.equal(pasted.doc.parts.length, doc.parts.length + 2)
  const refs = pasted.doc.parts.map((p) => p.ref).filter(Boolean)
  assert.equal(new Set(refs).size, refs.length)
  assert.ok(refs.includes('R2') && refs.includes('C2'))
  // a long wire through a pin is split there
  const d2 = emptyDoc()
  d2.parts.push(newPart(d2, 'resistor', 100, 100))
  d2.wires.push({ id: 'w', x1: 0, y1: 100, x2: 200, y2: 100 })
  const s = splitWires(d2)
  assert.equal(s.wires.length, 3)
  assert.ok(junctions(s).length >= 2)
  // addPath makes the segments and ignores zero-length ones
  const a = addPath(emptyDoc(), route(0, 0, 40, 30, true))
  assert.equal(a.wires.length, 2)
  // hit tests
  assert.ok(hitPart(d2, 100, 100))
  assert.equal(hitPart(d2, 400, 400), null)
  assert.ok(hitPin(d2, 71, 101))
  assert.ok(hitWire(s, 20, 102))
  assert.ok(itemsInBox(doc, 0, 0, 1000, 1000).size > 5)
  const h = new History()
  const e = emptyDoc()
  h.push(e)
  const u = h.undo(doc)
  assert.equal(u, e)
  assert.ok(h.canRedo)
  assert.equal(h.redo(e), doc)
  assert.deepEqual(cloneDoc(doc), doc)
  assert.ok(searchParts('opamp').some((d) => d.kind === 'opamp'))
  assert.ok(searchParts('zener').length >= 1)
  assert.ok(searchParts('').length >= 30)
})

// ------------------------------------------------------------------------------ results

test('scope figures and CSV export', () => {
  const ex = exampleById('rc-step')!
  const out = runPrepared(prepareSchematic(exampleDoc(ex), { ...DEFAULT_SETTINGS, ...ex.sim }))
  const fig = scopeFigure(out.result, { traces: ['V(in)', 'V(out)'], stacked: false, cursors: [1e-3, null] })!
  assert.equal(fig.data.length, 2)
  assert.equal((fig.layout.shapes as unknown[]).length, 1)
  const stacked = scopeFigure(out.result, { traces: ['V(in)', 'V(out)', 'I(R1)'], stacked: true })!
  assert.ok('yaxis3' in stacked.layout)
  const csv = traceCsv(out.result, ['V(out)'])
  assert.ok(csv.startsWith('Time,V(out)\n'))
  assert.ok(csv.split('\n').length > 100)
  const bode = runPrepared(prepareSchematic(exampleDoc(exampleById('rc-lowpass')!), { ...DEFAULT_SETTINGS, ...exampleById('rc-lowpass')!.sim }))
  const bf = bodeFigure(bode.result, { traces: ['V(out)'], stacked: false })!
  assert.equal(bf.data.length, 2)
  assert.ok(traceCsv(bode.result, ['V(out)']).startsWith('frequency_Hz,'))
  if (bode.result.type === 'ac') {
    const t = acTrace(bode.result.ac, 'V(out)/V(in)')
    near(t.mag[0], 1, 1e-3)
    assert.ok(t.phase.at(-1)! < -80)
  }
  const sum = summarize(out, ['V(out)'])
  assert.equal(sum.analysis, 'tran')
  assert.ok((sum.traces as Record<string, { max: number }>)['V(out)'].max > 4.5)
  const sumAc = summarize(bode, ['V(out)'])
  const tr = (sumAc.traces as Record<string, { minus3dB_frequency_Hz: number }>)['V(out)']
  near(tr.minus3dB_frequency_Hz, 1001, 0.03)
})

test('a netlist run uses the text’s own .tran line and reports parse errors with the line', () => {
  const p = prepareNetlist('t\nV1 in 0 PULSE(0 5 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m\n.end', DEFAULT_SETTINGS)
  assert.equal(p.analysis.type, 'tran')
  const out = runPrepared(p)
  assert.equal(out.result.type, 'tran')
  assert.equal(settingsFrom(p.analysis).tranStop, '0.005')
  assert.throws(() => prepareNetlist('t\nR1 a\n.end', DEFAULT_SETTINGS), /Line 2/)
  assert.throws(() => analysisOf({ ...DEFAULT_SETTINGS, analysis: 'tran', tranStop: 'abc' }), /not a number/)
  assert.equal(analysisOf({ ...DEFAULT_SETTINGS, analysis: 'ac' }).type, 'ac')
})

// ------------------------------------------------------------------------------ calculators

test('calculators: Ohm, colour code, preferred values, dividers, filters, 555, wire, decibels, Thevenin', () => {
  const o = ohm(5, null, 1000, null)
  near(o.i, 5e-3)
  near(o.p, 0.025)
  near(ohm(null, 0.01, null, 0.5).r, 5000)
  assert.throws(() => ohm(5, null, null, null), /two/)
  assert.deepEqual(colorBands(4700, 5, 4), ['yellow', 'violet', 'red', 'gold'])
  assert.deepEqual(colorBands(0.47, 5, 4), ['yellow', 'violet', 'silver', 'gold'])
  assert.deepEqual(colorBands(1e6, 1, 5), ['brown', 'black', 'black', 'yellow', 'brown'])
  assert.equal(colorBands(2200, 1, 6, 50).length, 6)
  near(valueFromBands(['yellow', 'violet', 'red', 'gold']).value, 4700)
  assert.equal(valueFromBands(['yellow', 'violet', 'red', 'gold']).tolerance, 5)
  near(valueFromBands(['brown', 'black', 'black', 'yellow', 'brown']).value, 1e6)
  assert.equal(valueFromBands(['brown', 'black', 'black', 'black', 'brown', 'red']).tempco, 50)
  assert.throws(() => valueFromBands(['gold', 'black', 'red', 'gold']), /digit/)
  const e = nearestE(3300, 'E24')
  assert.equal(e.value, 3300)
  near(nearestE(4400, 'E12').value, 4700)
  near(nearestE(1234, 'E96').value, 1240)
  const best = bestPairs(5000, 'E12', 3)
  assert.ok(Math.abs(best[0].errorPct) < 0.01, `${best[0].errorPct}`)
  near(parallelOf([1000, 1000]), 500)
  const d = divider(12, 10000, 4700, 10000)
  near(d.unloaded, 12 * 4700 / 14700)
  assert.ok(d.loaded < d.unloaded)
  const led = ledResistor(5, 2, 0.01)
  near(led.r, 300)
  assert.throws(() => ledResistor(1.5, 2, 0.01), /above/)
  near(rcTimeTo(5, 0, 5 * (1 - Math.exp(-1)), 1000, 1e-6), 1e-3, 1e-9)
  assert.throws(() => rcTimeTo(5, 0, 6, 1000, 1e-6), /never/)
  const rlc = rlcSeries(10, 10e-3, 100e-9)
  near(rlc.f0, 5032.9, 1e-3)
  near(rlc.q, 31.62, 1e-3)
  assert.match(rlc.kind, /under/)
  butterworthG(3).forEach((g, i) => near(g, [1, 2, 1][i], 1e-9))
  const lad = butterworthLadder(3, 1000, 50, 'lowpass')
  assert.deepEqual(lad.map((q) => q.kind), ['C', 'L', 'C'])
  near(lad[0].value, 1 / (2 * Math.PI * 1000 * 50), 1e-9)
  near(lad[1].value, (2 * 50) / (2 * Math.PI * 1000), 1e-9)
  const a = ne555Astable(1000, 10000, 100e-9)
  near(a.freq, 1.44 / (21000 * 100e-9), 0.01)
  near(a.duty, 11000 / 21000, 1e-9)
  near(ne555Monostable(10000, 1e-6), 0.010986, 1e-3)
  near(awg(22).diameter, 0.644, 0.01)
  near(awg(10).area, 5.26, 0.01)
  near(awg(22).ohmPerM, 0.0529, 0.02)
  assert.ok(awg(22).chassisAmps >= 5 && awg(22).chassisAmps <= 8)
  assert.equal(decibels('vratio', 10)[0].value, '20.000 dB')
  assert.equal(decibels('pratio', 100)[0].value, '20.000 dB')
  assert.match(decibels('dbm_w', 30)[0].value, /1 W/)
  const t = thevenin(12 * 2 / 3, (1000 * 2000) / 3000, null)
  near(t.isc, 8 / 666.667, 1e-6)
  const z = impedance(1000, 100, 10e-3, 1e-6)
  near(z.xl, 62.83, 1e-3)
  near(z.xc, 159.15, 1e-3)
  near(z.series.im, 62.83 - 159.15, 1e-3)
  const pf = powerFactor(1000, 0.7, 230, 50, 0.95)
  near(pf.s, 1428.57, 1e-3)
  assert.ok(pf.capacitor! > 0 && pf.capacitor! < 1e-3)
  const bat = batteryHours(2000, 50, 0.05, 10, 80)
  near(bat.avgMa, 5.045, 1e-3)
  near(bat.hours, 1600 / 5.045, 1e-3)
  assert.equal(seriesOf([1, 2, 3]), 6)
})

test('every calculator runs with its default inputs and its rows can be copied', () => {
  assert.ok(CALCULATORS.length >= 17)
  for (const c of CALCULATORS) {
    const out = runCalculator(c.id, defaultInputs(c))
    assert.ok(out.rows.length > 0, c.id)
    for (const r of out.rows) assert.ok(r.label && r.value, `${c.id}: empty row`)
  }
  assert.throws(() => runCalculator('nope', {}), /no calculator/)
  assert.throws(() => runCalculator('ohm', { v: '5', i: '', r: '', p: '' }), /two/)
  const f = runCalculator('filter', { kind: 'bw_lp', f: '1k', r: '50', n: '5' })
  assert.equal(f.rows.length, 5)
  const cc = runCalculator('colorcode', { mode: 'toValue', colors: 'brown black red gold' })
  assert.match(cc.rows[0].value, /1 kΩ/)
  assert.equal(cc.draw?.kind, 'bands')
  const imp = runCalculator('impedance', {})
  assert.equal(imp.draw?.kind, 'phasor')
})


// ------------------------------------------------------------------------------ BOM

test('bill of materials groups identical parts', () => {
  const doc = exampleDoc(exampleById('ce-amp')!)
  const rows = bomOf(doc)
  const total = rows.reduce((n, r) => n + r.qty, 0)
  assert.equal(total, doc.parts.filter((p) => !['ground', 'voltmeter', 'ammeter'].includes(p.kind)).length)
  const csv = bomCsv(doc)
  assert.ok(csv.startsWith('References,Quantity,Part,Value,Footprint'))
  assert.match(csv, /Q1,1,NPN transistor,2N3904,TO-92/)
  const md = bomMarkdown(doc, 'CE')
  assert.match(md, /^# CE/)
  assert.match(md, /\| R1 \| 1 \| Resistor \| 47kΩ \| R_0805 \|/)
  // two equal resistors share a line
  const d2 = exampleDoc(exampleById('relaxation')!)
  assert.ok(bomOf(d2).some((r) => r.qty === 3 && r.refs.join() === 'R2,R3,Rt'))
})

// ------------------------------------------------------------------------------ AI tools

function fakeHooks(initial: Doc = emptyDoc()) {
  const st = { doc: initial, sim: { ...DEFAULT_SETTINGS }, name: 'Untitled', netlist: '' }
  const calls: string[] = []
  const hooks: Hooks = {
    state: () => ({ ...st, dirty: false, tab: 'schematic' }),
    apply: (d, what, extra) => { st.doc = d; calls.push(what); if (extra?.sim) st.sim = { ...st.sim, ...extra.sim }; if (extra?.name) st.name = extra.name; if (extra?.netlist !== undefined) st.netlist = extra.netlist },
    run: async (p) => runPrepared(p),
    showCalculator: (id) => { calls.push(`calc:${id}`) },
    openExample: async (ex) => { st.doc = exampleDoc(ex); st.sim = { ...DEFAULT_SETTINGS, ...ex.sim }; st.name = ex.title; calls.push(`example:${ex.id}`) },
    center: () => ({ x: 300, y: 200 }),
    defaultPath: (f) => `/home/user/Documents/kElec/test.${f}`,
    exportAs: async (f, p) => { calls.push(`export:${f}:${p}`); return p ?? 'sent' },
  }
  const tools = kelecTools(hooks) as Record<string, (a: Record<string, unknown>, ctx: { confirm: (w: string) => Promise<boolean> }) => Promise<Record<string, unknown>>>
  const ctx = (ok = true) => ({ caller: 'test', windowId: 'w', confirm: async () => ok, allowPython: async () => false }) as never
  return { st, calls, tools, ctx }
}

test('the manifest names exactly the tools the code offers (at most 8, each with at most 6 arguments)', () => {
  const { tools } = fakeHooks()
  assert.deepEqual(Object.keys(tools).sort(), KELEC_TOOL_SET.tools.map((t) => t.action).sort())
  assert.ok(KELEC_TOOL_SET.tools.length <= 8)
  for (const t of KELEC_TOOL_SET.tools) assert.ok(Object.keys(t.inputSchema.properties as object).length <= 6, t.action)
  assert.ok(KELEC_TOOL_SET.summary.length <= 120)
})

test('AI: examples, set_netlist, simulate, add_part, connect', async () => {
  const { tools, st, ctx } = fakeHooks()
  const list = await tools.load_example({}, ctx())
  assert.ok((list.examples as unknown[]).length >= 20)
  await assert.rejects(tools.load_example({ id: 'nope' }, ctx()), /No example/)
  const net = await tools.set_netlist({ text: 'V1 in 0 10\nR1 in out 1k\nR2 out 0 3k\n.op' }, ctx())
  assert.equal(net.loaded, 3)
  assert.equal(st.doc.parts.filter((p) => p.kind !== 'ground').length, 3)
  const sim = await tools.simulate({ analysis: 'op' }, ctx())
  near((sim.node_voltages_V as Record<string, number>).out, 7.5, 1e-4)
  const ac = await tools.simulate({ analysis: 'tran', params: { tstop: '2m' }, signals: ['V(out)'] }, ctx())
  assert.equal(ac.analysis, 'tran')
  await assert.rejects(tools.simulate({ analysis: 'dc', params: { bogus: 1 } }, ctx()), /Unknown parameter/)
  // build a circuit part by part
  await tools.set_netlist({ text: 'V1 in 0 5\n.op' }, ctx())
  const added = await tools.add_part({ kind: 'resistor', value: '2k', connect: { '1': 'in', '2': 'out' } }, ctx())
  assert.equal(added.added, 'R1')
  const added2 = await tools.add_part({ kind: 'r', value: '2k', connect: { '1': 'out', '2': '0' } }, ctx())
  assert.equal(added2.added, 'R2')
  const op = await tools.simulate({ analysis: 'op' }, ctx())
  near((op.node_voltages_V as Record<string, number>).out, 2.5, 1e-4)
  const c = await tools.get_circuit({}, ctx())
  assert.ok((c.parts as { ref: string }[]).some((p) => p.ref === 'R1'))
  const spice = await tools.get_circuit({ format: 'spice' }, ctx())
  assert.match(String(spice.spice), /R1 in out 2k/)
  // connect two loose pins by net
  const a = await tools.add_part({ kind: 'capacitor', value: '1u' }, ctx())
  const k = await tools.connect({ from: 'R2.1', to: `${a.added}.1` }, ctx())
  assert.equal(k.connected, true)
  const b = buildNetlist(st.doc)
  assert.equal(b.pinNet.get('R2.1'), b.pinNet.get(`${a.added}.1`))
  await assert.rejects(tools.connect({ from: 'R9.1', to: 'R1.1' }, ctx()), /no part/)
  await assert.rejects(tools.connect({ from: 'R1.9', to: 'R1.1' }, ctx()), /no pin/)
  await assert.rejects(tools.add_part({ kind: 'resistor', connect: { Z: 'x' } }, ctx()), /no pin/)
  assert.equal(resolveKind('Op-Amp'), 'opamp')
  assert.equal(resolveKind('NPN transistor'), 'npn')
  assert.throws(() => resolveKind('flux capacitor'), /Unknown part/)
})

test('AI: calculators and exports ask first', async () => {
  const { tools, calls, ctx } = fakeHooks()
  const list = await tools.calculate({}, ctx())
  assert.ok((list.calculators as unknown[]).length >= 17)
  const r = await tools.calculate({ calculator: 'divider', inputs: { vin: '12', r1: '10k', r2: '4.7k' } }, ctx())
  assert.ok(JSON.stringify(r.results).includes('3.8367'), JSON.stringify(r.results))
  assert.ok(calls.includes('calc:divider'))
  await assert.rejects(tools.calculate({ calculator: 'ohm', inputs: { v: '5' } }, ctx()), /two/)
  await assert.rejects(tools.export({ format: 'svg' }, ctx(false)), /did not allow/)
  assert.deepEqual(await tools.export({ format: 'svg', path: '/x/y.svg' }, ctx(true)), { saved: '/x/y.svg' })
  assert.deepEqual(await tools.export({ format: 'kpcb' }, ctx(false)), { sent: 'sent' })
  await assert.rejects(tools.export({ format: 'doc' }, ctx()), /format/)
})

test('stubs join pins to nets by name and free spots avoid parts', () => {
  const doc = emptyDoc()
  const r = newPart(doc, 'resistor', 100, 100)
  doc.parts.push(r)
  stubToNet(doc, r, '1', 'in')
  stubToNet(doc, r, '2', '0')
  const b = buildNetlist(doc)
  assert.equal(b.pinNet.get('R1.1'), 'in')
  assert.equal(b.pinNet.get('R1.2'), '0')
  const s = freeSpot(doc, 100, 100)
  assert.ok(Math.abs(s.x - 100) >= 50 || Math.abs(s.y - 100) >= 40)
})

test('an oscillator has no DC operating point: the transient starts from zero by itself', () => {
  const ex = exampleById('timer555')!
  const prep = prepareSchematic(exampleDoc(ex), { ...DEFAULT_SETTINGS, ...ex.sim, uic: false })
  assert.throws(() => operatingPoint(prep.circuit), /no steady DC solution/)
  const r = transient(prep.circuit, { tstop: 6e-3 })
  assert.ok(r.notes.length === 1 && /started from zero/.test(r.notes[0]))
  const f = frequencyOf(r.t, r.signals['V(q)'], 2e-3)!
  near(f, 690, 0.1)
})

test('a Schmitt trigger settles into a stable state and switches at its thresholds', () => {
  const text = (amp: number) => `s\nV1 in 0 SIN(0 ${amp} 1k)\nX1 pos in out OPAMP RAIL=10\nR1 out pos 20k\nR2 pos 0 10k\n.end`
  const op = operatingPoint(ckt(text(4)))
  assert.ok(Math.abs(op.nodes.out) > 9.9, `latched at a rail, not balanced: ${op.nodes.out}`)
  // ±3.33 V thresholds: a 4 V sine switches it every half-cycle, a 3 V sine cannot
  const r = transient(ckt(text(4)), { tstop: 4e-3 })
  const s = stats(r.t, r.signals['V(out)'], 1e-3)
  assert.ok(s.max > 9.9 && s.min < -9.9, `${s.min} … ${s.max}`)
  near(frequencyOf(r.t, r.signals['V(out)'], 1e-3)!, 1000, 0.02)
  // switching happens near 10/3 V of input
  const up = crossings(r.t, r.signals['V(out)'], 0, 1)[0]
  assert.ok(Math.abs(valueAt(r.t, r.signals['V(in)'], up)) > 3.2 && Math.abs(valueAt(r.t, r.signals['V(in)'], up)) < 3.5)
  const quiet = transient(ckt(text(3)), { tstop: 4e-3 })
  const q = stats(quiet.t, quiet.signals['V(out)'])
  assert.ok(q.pp < 0.5, 'stays latched')
})

test('the single-pole op-amp has the gain-bandwidth product it is given', () => {
  const doc = emptyDoc()
  const v = newPart(doc, 'vsine', 100, 100, { value: '0.1' })
  v.props.ac = '1'
  doc.parts.push(v)
  const u = newPart(doc, 'opamp1', 300, 100)
  u.props.gbw = '1meg'
  u.props.a0 = '100k'
  doc.parts.push(u)
  stubToNet(doc, v, '+', 'in')
  stubToNet(doc, v, '-', '0')
  stubToNet(doc, u, 'IN+', 'in')
  stubToNet(doc, u, 'IN-', 'out')
  stubToNet(doc, u, 'OUT', 'out')
  const b = buildNetlist(doc)
  assert.equal(b.problems.filter((p) => p.level === 'error').length, 0, b.problems.map((p) => p.message).join())
  const ac = acSweep(b.circuit, 1e3, 1e8, 40)
  near(cornerFrequency(ac.freq, ac.mag['V(out)'])!, 1e6, 0.06)
  near(ac.mag['V(out)'][0], 1, 1e-3)
  // large signals are not slew-limited below about a volt per microsecond
  const step = transient(b.circuit, { tstop: 20e-6, tmax: 0.1e-6 })
  assert.ok(Math.abs(step.signals['V(out)'].at(-1)!) <= 0.11)
})
