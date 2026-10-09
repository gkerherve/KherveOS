// The example library: ready circuits as pure data (parts at positions, nets as pin lists). The wires are
// routed by autoroute.ts when an example is opened. Every example is simulated by the tests.

import { buildLayout, type LayoutSpec, type PartSpec } from './autoroute.ts'
import type { Doc, PartKind, Rot } from './model.ts'
import type { SimSettings } from './settings.ts'

export interface Expect {
  /** a signal such as V(out) or I(R1) */
  signal: string
  /** which number of the result: the DC value, the last value, or a statistic over the time window */
  kind: 'op' | 'final' | 'max' | 'min' | 'pp' | 'mean' | 'freq'
  value: number
  /** relative tolerance (or absolute when value is 0) */
  tol: number
  /** statistics start here (seconds) */
  from?: number
}

export interface Example {
  id: string
  title: string
  category: 'Basics' | 'Filters' | 'Rectifiers' | 'Transistors' | 'Op-amps' | 'Oscillators' | 'Power'
  description: string
  layout: LayoutSpec
  sim: Partial<SimSettings>
  /** traces shown first in the scope */
  show: string[]
  stacked?: boolean
  expect: Expect[]
}

const P = (ref: string, kind: PartKind, x: number, y: number, value?: string, rot?: Rot, props?: Record<string, string>): PartSpec => ({ ref, kind, x, y, value, rot, props })
const GND = (ref: string, x: number, y: number): PartSpec => P(ref, 'ground', x, y)

export const EXAMPLES: Example[] = [
  {
    id: 'divider', title: 'Voltage divider', category: 'Basics',
    description: 'Two resistors share 10 V in the ratio R2/(R1+R2): the output is 7.5 V. Run DC and read the node voltages on the schematic; change R2 and run again.',
    layout: {
      parts: [P('V1', 'battery', 100, 200, '10'), P('R1', 'resistor', 240, 140, '1k', 90), P('R2', 'resistor', 240, 230, '3k', 90), GND('GND1', 100, 270)],
      nets: { in: ['V1.+', 'R1.1'], out: ['R1.2', 'R2.1'], '0': ['V1.-', 'R2.2', 'GND1.GND'] },
    },
    sim: { analysis: 'op' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'op', value: 7.5, tol: 1e-4 }, { signal: 'I(R1)', kind: 'op', value: 2.5e-3, tol: 1e-4 }],
  },
  {
    id: 'rc-step', title: 'RC charge and discharge', category: 'Basics',
    description: 'A 5 V square wave drives a 1 kΩ / 1 µF network (τ = 1 ms). The capacitor charges during the high half and discharges during the low half. Run a transient and read the 63 % point.',
    layout: {
      parts: [P('V1', 'vpulse', 100, 200, '5', 0, { v1: '0', rise: '1n', fall: '1n', width: '4m', period: '8m' }), P('R1', 'resistor', 220, 140, '1k'), P('C1', 'capacitor', 320, 200, '1u', 90), GND('GND1', 210, 270)],
      nets: { in: ['V1.+', 'R1.1'], out: ['R1.2', 'C1.1'], '0': ['V1.-', 'C1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '16m' }, show: ['V(in)', 'V(out)'],
    expect: [{ signal: 'V(out)', kind: 'max', value: 5 * (1 - Math.exp(-4)), tol: 0.02 }, { signal: 'V(out)', kind: 'min', value: 0, tol: 0.01 }],
  },
  {
    id: 'rc-lowpass', title: 'RC low-pass filter (Bode plot)', category: 'Filters',
    description: 'A 1.59 kΩ / 100 nF low-pass: −3 dB at 1 kHz, falling 20 dB per decade, with 45° of phase lag at the corner. Run the AC sweep and place the cursors on the curve.',
    layout: {
      parts: [P('V1', 'vsine', 100, 200, '1', 0, { freq: '1k', ac: '1' }), P('R1', 'resistor', 220, 140, '1.59k'), P('C1', 'capacitor', 320, 200, '100n', 90), GND('GND1', 210, 270)],
      nets: { in: ['V1.+', 'R1.1'], out: ['R1.2', 'C1.1'], '0': ['V1.-', 'C1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'ac', acStart: '10', acStop: '100k', acPoints: '30' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'op', value: 1, tol: 1e-3 }],
  },
  {
    id: 'rlc-resonance', title: 'RLC resonance (band-pass)', category: 'Filters',
    description: 'A series RLC circuit with the output across the resistor peaks at f₀ = 1/(2π√LC) ≈ 5.03 kHz. The quality factor Q = √(L/C)/R ≈ 31.6 sets how narrow the peak is.',
    layout: {
      parts: [P('V1', 'vsine', 100, 200, '1', 0, { freq: '5k', ac: '1' }), P('L1', 'inductor', 220, 140, '10m'), P('C1', 'capacitor', 330, 140, '100n'), P('R1', 'resistor', 430, 200, '10', 90), GND('GND1', 260, 270)],
      nets: { in: ['V1.+', 'L1.1'], _a: ['L1.2', 'C1.1'], out: ['C1.2', 'R1.1'], '0': ['V1.-', 'R1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'ac', acStart: '1k', acStop: '20k', acPoints: '300' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'max', value: 1, tol: 0.01 }],
  },
  {
    id: 'rlc-step', title: 'RLC step response', category: 'Filters',
    description: 'A 1 V step into a series RLC (R = 20 Ω, L = 10 mH, C = 1 µF) rings at about 1.6 kHz and overshoots before settling: an under-damped second-order system.',
    layout: {
      parts: [P('V1', 'vpulse', 100, 200, '1', 0, { v1: '0', rise: '1n', fall: '1n', width: '1', period: '0' }), P('R1', 'resistor', 220, 140, '20'), P('L1', 'inductor', 330, 140, '10m'), P('C1', 'capacitor', 420, 200, '1u', 90), GND('GND1', 260, 270)],
      nets: { in: ['V1.+', 'R1.1'], _a: ['R1.2', 'L1.1'], out: ['L1.2', 'C1.1'], '0': ['V1.-', 'C1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '3m' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'max', value: 1.7, tol: 0.1 }, { signal: 'V(out)', kind: 'final', value: 1, tol: 0.25 }],
  },
  {
    id: 'halfwave', title: 'Half-wave rectifier with smoothing', category: 'Rectifiers',
    description: 'One diode passes only the positive half-cycles; the 100 µF capacitor holds the peak between them, leaving a ripple. The peak is Vpk − 0.65 V.',
    layout: {
      parts: [P('V1', 'vsine', 100, 200, '5', 0, { freq: '50', ac: '' }), P('D1', 'diode', 220, 140, '1N4148'), P('R1', 'resistor', 340, 210, '1k', 90), P('C1', 'electrolytic', 420, 210, '100u', 90), GND('GND1', 220, 290)],
      nets: { in: ['V1.+', 'D1.1'], out: ['D1.2', 'R1.1', 'C1.1'], '0': ['V1.-', 'R1.2', 'C1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '100m' }, show: ['V(in)', 'V(out)'],
    expect: [{ signal: 'V(out)', kind: 'max', value: 4.35, tol: 0.05 }, { signal: 'V(out)', kind: 'min', value: 3.2, tol: 0.2, from: 0.06 }],
  },
  {
    id: 'bridge', title: 'Full-wave bridge rectifier', category: 'Rectifiers',
    description: 'Four diodes steer both half-cycles the same way round the load. The output is a rectified sine, smoothed by the 100 µF capacitor; the floating source is shown as V(a) − V(b).',
    layout: {
      parts: [
        P('V1', 'vsine', 260, 175, '5', 270, { freq: '50', ac: '' }), P('D1', 'diode', 200, 130, '1N4007', 270), P('D3', 'diode', 200, 220, '1N4007', 270),
        P('D2', 'diode', 320, 130, '1N4007', 270), P('D4', 'diode', 320, 220, '1N4007', 270), P('R1', 'resistor', 410, 175, '1k', 90), P('C1', 'electrolytic', 480, 175, '100u', 90), GND('GND1', 260, 290),
      ],
      labelAt: { b: 'D2.1', a: 'D1.1' },
      nets: { a: ['D1.1', 'D3.2', 'V1.+'], b: ['D2.1', 'D4.2', 'V1.-'], out: ['D1.2', 'D2.2', 'R1.1', 'C1.1'], '0': ['D3.1', 'D4.1', 'R1.2', 'C1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '100m' }, show: ['V(out)', 'V(a)-V(b)'], expect: [{ signal: 'V(out)', kind: 'max', value: 3.7, tol: 0.15 }, { signal: 'V(out)', kind: 'min', value: 3.0, tol: 0.4, from: 0.06 }],
  },
  {
    id: 'zener', title: 'Zener voltage regulator', category: 'Rectifiers',
    description: 'A 5.1 V Zener and a 470 Ω resistor hold the output nearly constant while the input sweeps from 0 to 20 V. Run the DC sweep of V1 and watch the output flatten above 5.5 V.',
    layout: {
      parts: [P('V1', 'battery', 100, 200, '12'), P('R1', 'resistor', 220, 140, '470'), P('D1', 'zener', 320, 210, '5.1', 270), P('RL', 'resistor', 420, 210, '2k', 90), GND('GND1', 220, 290)],
      nets: { in: ['V1.+', 'R1.1'], out: ['R1.2', 'D1.2', 'RL.1'], '0': ['V1.-', 'D1.1', 'RL.2', 'GND1.GND'] },
    },
    sim: { analysis: 'dc', dcSource: 'V1', dcStart: '0', dcStop: '20', dcStep: '0.25' }, show: ['V(out)', 'V(in)'], expect: [{ signal: 'V(out)', kind: 'final', value: 5.3, tol: 0.1 }],
  },
  {
    id: 'clipper', title: 'Diode clipper', category: 'Rectifiers',
    description: 'Two anti-parallel diodes limit the output to about ±0.65 V however large the 5 V sine input is. The resistor takes the difference.',
    layout: {
      parts: [P('V1', 'vsine', 100, 200, '5', 0, { freq: '1k', ac: '' }), P('R1', 'resistor', 220, 140, '1k'), P('D1', 'diode', 330, 200, '1N4148', 90), P('D2', 'diode', 400, 200, '1N4148', 270), GND('GND1', 215, 270)],
      nets: { in: ['V1.+', 'R1.1'], out: ['R1.2', 'D1.1', 'D2.2'], '0': ['V1.-', 'D1.2', 'D2.1', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '3m' }, show: ['V(in)', 'V(out)'], expect: [{ signal: 'V(out)', kind: 'max', value: 0.7, tol: 0.1 }, { signal: 'V(out)', kind: 'min', value: -0.7, tol: 0.1 }],
  },
  {
    id: 'doubler', title: 'Voltage doubler', category: 'Rectifiers',
    description: 'The first capacitor and diode clamp the waveform; the second diode and capacitor then peak-detect it, so the output approaches twice the input peak (about 8.5 V from 5 V).',
    layout: {
      parts: [
        P('V1', 'vsine', 100, 200, '5', 0, { freq: '1k', ac: '' }), P('C1', 'capacitor', 200, 140, '10u'), P('D1', 'diode', 270, 210, '1N4148', 270), P('D2', 'diode', 340, 140, '1N4148'),
        P('C2', 'capacitor', 430, 210, '10u', 90), P('RL', 'resistor', 500, 210, '10k', 90), GND('GND1', 270, 290),
      ],
      nets: { in: ['V1.+', 'C1.1'], a: ['C1.2', 'D1.2', 'D2.1'], out: ['D2.2', 'C2.1', 'RL.1'], '0': ['V1.-', 'D1.1', 'C2.2', 'RL.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '30m' }, show: ['V(in)', 'V(out)'], expect: [{ signal: 'V(out)', kind: 'final', value: 8.5, tol: 0.1 }],
  },
  {
    id: 'led', title: 'LED with a resistor', category: 'Basics',
    description: 'A red LED drops about 1.9 V, so a 330 Ω resistor from 5 V gives roughly 9 mA. The schematic shows the current; try other colours in the LED’s properties.',
    layout: {
      parts: [P('V1', 'battery', 100, 200, '5'), P('R1', 'resistor', 220, 140, '330'), P('D1', 'led', 320, 200, 'red', 90), GND('GND1', 210, 270)],
      nets: { in: ['V1.+', 'R1.1'], _a: ['R1.2', 'D1.1'], '0': ['V1.-', 'D1.2', 'GND1.GND'] },
    },
    sim: { analysis: 'op' }, show: ['I(D1)'], expect: [{ signal: 'I(D1)', kind: 'op', value: 9.4e-3, tol: 0.1 }],
  },
  {
    id: 'ce-amp', title: 'BJT common-emitter amplifier', category: 'Transistors',
    description: 'A 2N3904 biased by a divider (R1/R2) amplifies a 2 mV, 1 kHz signal by about 200 with the emitter bypassed. Run DC to see the bias point, then a transient to see input and output stacked.',
    layout: {
      parts: [
        P('VCC', 'battery', 40, 140, '12'), P('VIN', 'vsine', 60, 270, '0.002', 0, { freq: '1k', ac: '1' }), P('C1', 'capacitor', 130, 200, '10u'), P('R1', 'resistor', 200, 110, '47k', 90),
        P('R2', 'resistor', 200, 230, '10k', 90), P('RC', 'resistor', 330, 110, '4.7k', 90), P('Q1', 'npn', 320, 200, '2N3904'), P('RE', 'resistor', 330, 260, '1k', 90),
        P('CE', 'electrolytic', 410, 260, '100u', 90), GND('GND1', 200, 330),
      ],
      nets: { vcc: ['VCC.+', 'R1.1', 'RC.1'], in: ['VIN.+', 'C1.1'], b: ['C1.2', 'R1.2', 'R2.1', 'Q1.B'], out: ['RC.2', 'Q1.C'], e: ['Q1.E', 'RE.1', 'CE.1'], '0': ['VCC.-', 'VIN.-', 'R2.2', 'RE.2', 'CE.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '5m' }, show: ['V(out)', 'V(in)'], stacked: true,
    expect: [{ signal: 'V(out)', kind: 'pp', value: 1.0, tol: 0.5, from: 2e-3 }, { signal: 'V(out)', kind: 'mean', value: 5.4, tol: 0.2, from: 2e-3 }],
  },
  {
    id: 'mosfet-switch', title: 'MOSFET switch', category: 'Transistors',
    description: 'A 2N7000 pulls a 100 Ω load to ground when its gate is driven to 5 V and lets it float to 5 V when the gate is low. Watch the drain voltage follow the inverted gate pulse.',
    layout: {
      parts: [
        P('VDD', 'battery', 80, 180, '5'), P('RD', 'resistor', 260, 110, '100', 90), P('M1', 'nmos', 250, 200, '2N7000'),
        P('VG', 'vpulse', 160, 270, '5', 0, { v1: '0', rise: '10n', fall: '10n', width: '0.5m', period: '1m' }), GND('GND1', 200, 330),
      ],
      nets: { vdd: ['VDD.+', 'RD.1'], drain: ['RD.2', 'M1.D'], gate: ['VG.+', 'M1.G'], '0': ['VDD.-', 'VG.-', 'M1.S', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '3m' }, show: ['V(gate)', 'V(drain)'], stacked: true,
    expect: [{ signal: 'V(drain)', kind: 'max', value: 5, tol: 0.01 }, { signal: 'V(drain)', kind: 'min', value: 0.172, tol: 0.1 }],
  },
  {
    id: 'inverting', title: 'Inverting op-amp amplifier', category: 'Op-amps',
    description: 'Gain = −Rf/Rin = −10: a 100 mV, 1 kHz sine comes out inverted and ten times larger. The inverting input is a virtual ground.',
    layout: {
      parts: [P('V1', 'vsine', 80, 200, '0.1', 0, { freq: '1k', ac: '1' }), P('Rin', 'resistor', 230, 190, '1k'), P('Rf', 'resistor', 340, 120, '10k'), P('U1', 'opamp', 340, 200), GND('GND1', 200, 290)],
      nets: { in: ['V1.+', 'Rin.1'], n: ['Rin.2', 'U1.IN-', 'Rf.1'], out: ['U1.OUT', 'Rf.2'], '0': ['V1.-', 'U1.IN+', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '3m' }, show: ['V(in)', 'V(out)'], expect: [{ signal: 'V(out)', kind: 'pp', value: 2, tol: 0.02, from: 1e-3 }],
  },
  {
    id: 'noninverting', title: 'Non-inverting op-amp amplifier', category: 'Op-amps',
    description: 'Gain = 1 + Rf/Rg = 10, with the output in phase with the input and a very high input impedance.',
    layout: {
      parts: [P('V1', 'vsine', 80, 270, '0.1', 0, { freq: '1k', ac: '1' }), P('Rg', 'resistor', 260, 270, '1k', 90), P('Rf', 'resistor', 340, 120, '9k'), P('U1', 'opamp', 340, 200), GND('GND1', 170, 340)],
      nets: { in: ['V1.+', 'U1.IN+'], n: ['U1.IN-', 'Rg.1', 'Rf.1'], out: ['U1.OUT', 'Rf.2'], '0': ['V1.-', 'Rg.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '3m' }, show: ['V(in)', 'V(out)'], expect: [{ signal: 'V(out)', kind: 'pp', value: 2, tol: 0.02, from: 1e-3 }],
  },
  {
    id: 'integrator', title: 'Op-amp integrator', category: 'Op-amps',
    description: 'A ±1 V square wave into R = 10 kΩ and C = 100 nF integrates into a triangle wave (slope V/RC = 1000 V/s). The 1 MΩ resistor stops the output drifting; the run starts from zero.',
    layout: {
      parts: [
        P('V1', 'vpulse', 80, 200, '1', 0, { v1: '-1', rise: '1n', fall: '1n', width: '0.5m', period: '1m' }), P('Rin', 'resistor', 230, 190, '10k'), P('C1', 'capacitor', 340, 120, '100n'),
        P('Rp', 'resistor', 340, 60, '1meg'), P('U1', 'opamp', 340, 200), GND('GND1', 200, 290),
      ],
      nets: { in: ['V1.+', 'Rin.1'], n: ['Rin.2', 'U1.IN-', 'C1.1', 'Rp.1'], out: ['U1.OUT', 'C1.2', 'Rp.2'], '0': ['V1.-', 'U1.IN+', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '5m', uic: true }, show: ['V(in)', 'V(out)'], stacked: true, expect: [{ signal: 'V(out)', kind: 'pp', value: 0.5, tol: 0.1, from: 2e-3 }],
  },
  {
    id: 'diffamp', title: 'Differential amplifier', category: 'Op-amps',
    description: 'Out = (R2/R1)·(V2 − V1) = 10 × (2.1 V − 2.0 V) = 1.0 V: the amplifier ignores what the two inputs have in common and magnifies their difference.',
    layout: {
      parts: [
        P('V1', 'battery', 60, 150, '2'), P('V2', 'battery', 60, 290, '2.1'), P('R1', 'resistor', 200, 150, '1k'), P('R2', 'resistor', 360, 100, '10k'), P('R3', 'resistor', 200, 250, '1k'),
        P('R4', 'resistor', 280, 300, '10k', 90), P('U1', 'opamp', 360, 200), GND('GND1', 170, 350),
      ],
      nets: { a: ['V1.+', 'R1.1'], n: ['R1.2', 'U1.IN-', 'R2.1'], b: ['V2.+', 'R3.1'], p: ['R3.2', 'U1.IN+', 'R4.1'], out: ['U1.OUT', 'R2.2'], '0': ['V1.-', 'V2.-', 'R4.2', 'GND1.GND'] },
    },
    sim: { analysis: 'op' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'op', value: 1, tol: 1e-3 }],
  },
  {
    id: 'relaxation', title: 'Op-amp relaxation oscillator', category: 'Oscillators',
    description: 'The op-amp compares the capacitor voltage with a fraction of its own output (positive feedback), so it flips each time the capacitor reaches the threshold: a square wave of f = 1/(2RC·ln3) ≈ 455 Hz. The capacitor starts with 0.5 V to tip it out of its balanced state.',
    layout: {
      parts: [
        P('U1', 'opamp', 330, 200, undefined, 0, { rail: '12' }), P('Rt', 'resistor', 250, 110, '10k'), P('Ct', 'capacitor', 180, 250, '100n', 90, { ic: '0.5' }),
        P('R2', 'resistor', 440, 110, '10k'), P('R3', 'resistor', 260, 320, '10k', 90), GND('GND1', 180, 340),
      ],
      labelAt: { out: 'U1.OUT', inv: 'U1.IN-', pos: 'U1.IN+' },
      nets: { inv: ['U1.IN-', 'Rt.1', 'Ct.1'], out: ['U1.OUT', 'Rt.2', 'R2.2'], pos: ['U1.IN+', 'R2.1', 'R3.1'], '0': ['Ct.2', 'R3.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '20m', uic: true }, show: ['V(out)', 'V(inv)'], expect: [{ signal: 'V(out)', kind: 'freq', value: 455, tol: 0.1, from: 4e-3 }],
  },
  {
    id: 'multivibrator', title: 'Transistor astable multivibrator', category: 'Oscillators',
    description: 'Two cross-coupled transistors take turns to conduct, each held off by a capacitor that charges through a 47 kΩ resistor: a square wave at about 1/(1.38·R·C) ≈ 1.5 kHz at each collector. The caps start empty (initial conditions) so the circuit starts in a definite state.',
    layout: {
      parts: [
        P('VCC', 'battery', 60, 200, '5'), P('RB1', 'resistor', 160, 110, '47k', 90), P('RC1', 'resistor', 240, 110, '1k', 90), P('RC2', 'resistor', 400, 110, '1k', 90), P('RB2', 'resistor', 480, 110, '47k', 90),
        { ref: 'Q1', kind: 'npn', x: 230, y: 210, value: '2N3904' }, { ref: 'Q2', kind: 'npn', x: 410, y: 210, value: '2N3904', mirror: true },
        P('C1', 'capacitor', 320, 360, '10n'), P('C2', 'capacitor', 320, 410, '10n'), GND('GND1', 320, 290),
      ],
      nets: { vcc: ['VCC.+', 'RB1.1', 'RC1.1', 'RC2.1', 'RB2.1'], c1: ['RC1.2', 'Q1.C'], c2: ['RC2.2', 'Q2.C'], b1: ['RB1.2', 'Q1.B'], b2: ['RB2.2', 'Q2.B'], '0': ['VCC.-', 'Q1.E', 'Q2.E', 'GND1.GND'] },
      taps: [{ name: 'c1', pin: 'C1.1' }, { name: 'b2', pin: 'C1.2' }, { name: 'c2', pin: 'C2.1' }, { name: 'b1', pin: 'C2.2' }],
      notes: [{ text: 'C1 couples collector 1 to base 2; C2 couples collector 2 to base 1 (joined by net label).', x: 140, y: 470 }],
    },
    sim: { analysis: 'tran', tranStop: '3m', uic: true }, show: ['V(c1)', 'V(c2)'], stacked: true, expect: [{ signal: 'V(c1)', kind: 'freq', value: 1500, tol: 0.15, from: 0.6e-3 }, { signal: 'V(c1)', kind: 'max', value: 5, tol: 0.02 }],
  },
  {
    id: 'timer555', title: '555 timer (built from comparators)', category: 'Oscillators',
    description: 'A 555 astable from its parts: a three-resistor divider, two comparators, an SR latch of two NOR gates and a discharge transistor. f ≈ 1.44/((R1 + 2·R2)·C) ≈ 690 Hz. Nets joined by name (labels) keep the drawing readable.',
    layout: {
      parts: [
        P('VCC', 'battery', 60, 200, '5'), P('RA', 'resistor', 160, 100, '5k', 90), P('RB', 'resistor', 160, 190, '5k', 90), P('RC', 'resistor', 160, 280, '5k', 90),
        P('U1', 'opamp', 360, 100), P('U2', 'opamp', 360, 240), P('G1', 'nor', 560, 100), P('G2', 'nor', 560, 240),
        P('R1', 'resistor', 700, 80, '1k', 90), P('R2', 'resistor', 700, 170, '10k', 90), P('C1', 'capacitor', 700, 260, '100n', 90), P('M1', 'nmos', 840, 200, '2N7000'),
      ],
      nets: {
        ref2: ['RA.2', 'RB.1'], ref1: ['RB.2', 'RC.1'], dis: ['R1.2', 'R2.1'], thr: ['R2.2', 'C1.1'],
        '@vcc': ['VCC.+', 'RA.1', 'R1.1', 'U1.V+', 'U2.V+'], '@0': ['VCC.-', 'RC.2', 'C1.2', 'M1.S', 'U1.V-', 'U2.V-'],
        '@r': ['U1.OUT', 'G1.A'], '@s': ['U2.OUT', 'G2.A'], '@q': ['G1.Y', 'G2.B'], '@qb': ['G2.Y', 'G1.B', 'M1.G'],
      },
      taps: [
        { name: 'ref2', pin: 'U1.IN-' }, { name: 'ref1', pin: 'U2.IN+' }, { name: 'thr', pin: 'U1.IN+' }, { name: 'thr', pin: 'U2.IN-' }, { name: 'dis', pin: 'M1.D' },
      ],
    },
    sim: { analysis: 'tran', tranStop: '10m', uic: true }, show: ['V(thr)', 'V(q)'], stacked: true, expect: [{ signal: 'V(thr)', kind: 'max', value: 3.33, tol: 0.08, from: 1e-3 }, { signal: 'V(thr)', kind: 'min', value: 1.67, tol: 0.15, from: 1e-3 }, { signal: 'V(q)', kind: 'freq', value: 690, tol: 0.1, from: 2e-3 }],
  },
  {
    id: 'wheatstone', title: 'Wheatstone bridge', category: 'Basics',
    description: 'Two dividers side by side: the voltmeter reads the difference between their midpoints. With R4 = 2.2 kΩ the bridge is slightly unbalanced (−0.10 V); set R4 to 2k and it reads 0.',
    layout: {
      parts: [
        P('V1', 'battery', 60, 160, '5'), P('R1', 'resistor', 150, 110, '1k', 90), P('R2', 'resistor', 150, 210, '2k', 90), P('R3', 'resistor', 290, 110, '1k', 90), P('R4', 'resistor', 290, 210, '2.2k', 90),
        P('VM1', 'voltmeter', 220, 160, undefined, 270), GND('GND1', 220, 290),
      ],
      nets: { top: ['V1.+', 'R1.1', 'R3.1'], a: ['R1.2', 'R2.1', 'VM1.+'], b: ['R3.2', 'R4.1', 'VM1.-'], '0': ['V1.-', 'R2.2', 'R4.2', 'GND1.GND'] },
    },
    sim: { analysis: 'op' }, show: ['V(a)-V(b)'], expect: [{ signal: 'V(a)', kind: 'op', value: 3.3333, tol: 1e-3 }, { signal: 'V(b)', kind: 'op', value: 3.4375, tol: 1e-3 }],
  },
  {
    id: 'thevenin', title: 'Thevenin equivalent', category: 'Basics',
    description: 'Looking back from the load, the source and divider act like 8 V behind 667 Ω. With RL = 1 kΩ the load gets 8 × 1k/(1.667k) = 4.8 V. Run DC to check.',
    layout: {
      parts: [P('V1', 'battery', 100, 200, '12'), P('R1', 'resistor', 220, 140, '1k'), P('R2', 'resistor', 320, 200, '2k', 90), P('RL', 'resistor', 420, 200, '1k', 90), GND('GND1', 210, 270)],
      nets: { in: ['V1.+', 'R1.1'], load: ['R1.2', 'R2.1', 'RL.1'], '0': ['V1.-', 'R2.2', 'RL.2', 'GND1.GND'] },
      notes: [{ text: 'Open circuit: Vth = 12 V × 2k/3k = 8 V;  Rth = 1k ‖ 2k = 667 Ω', x: 100, y: 330 }, { text: 'With RL = 1k: VL = 8 V × 1k/(667 + 1k) = 4.8 V', x: 100, y: 350 }],
    },
    sim: { analysis: 'op' }, show: ['V(load)'], expect: [{ signal: 'V(load)', kind: 'op', value: 4.8, tol: 1e-3 }],
  },
  {
    id: 'hbridge', title: 'H-bridge motor driver', category: 'Power',
    description: 'Four timed switches reverse the current through a motor modelled as 10 Ω + 5 mH. The diagonal pairs close in turn with a 0.1 ms dead time; the freewheel diodes carry the inductor current during it (and make the brief ±13.7 V spikes).',
    layout: {
      parts: [
        P('VS', 'battery', 50, 170, '12'),
        P('SW1', 'switch_timed', 200, 90, undefined, 90, { delay: '0', on: '0.9m', period: '2m' }), P('SW2', 'switch_timed', 200, 250, undefined, 90, { delay: '1m', on: '0.9m', period: '2m' }),
        P('SW3', 'switch_timed', 400, 90, undefined, 90, { delay: '1m', on: '0.9m', period: '2m' }), P('SW4', 'switch_timed', 400, 250, undefined, 90, { delay: '0', on: '0.9m', period: '2m' }),
        P('D1', 'diode', 130, 90, '1N4007', 270), P('D2', 'diode', 130, 250, '1N4007', 270), P('D3', 'diode', 470, 90, '1N4007', 270), P('D4', 'diode', 470, 250, '1N4007', 270),
        P('R1', 'resistor', 260, 170, '10'), P('L1', 'inductor', 340, 170, '5m'), GND('GND1', 270, 330),
      ],
      nets: {
        vs: ['VS.+', 'SW1.1', 'D1.2', 'SW3.1', 'D3.2'], oa: ['SW1.2', 'SW2.1', 'D1.1', 'D2.2', 'R1.1'], ob: ['SW3.2', 'SW4.1', 'D3.1', 'D4.2', 'L1.2'],
        _m: ['R1.2', 'L1.1'], '0': ['VS.-', 'SW2.2', 'D2.1', 'SW4.2', 'D4.1', 'GND1.GND'],
      },
    },
    sim: { analysis: 'tran', tranStop: '8m', tranMax: '10u' }, show: ['V(oa)-V(ob)', 'I(R1)'], stacked: true, expect: [{ signal: 'V(oa)-V(ob)', kind: 'max', value: 13.7, tol: 0.05 }, { signal: 'V(oa)-V(ob)', kind: 'min', value: -13.7, tol: 0.05 }],
  },
  {
    id: 'rc-ladder', title: '3-stage RC ladder low-pass', category: 'Filters',
    description: 'Three 1 kΩ / 100 nF sections one after the other. Each section loads the one before it, so the corner (−3 dB at about 0.2 / (2πRC) ≈ 320 Hz) is far below that of a single RC (1.59 kHz), the roll-off steepens to 60 dB per decade and the phase lag reaches 105° at 1 kHz. Run the AC sweep and compare V(n1), V(n2) and V(out).',
    layout: {
      parts: [
        P('V1', 'vsine', 80, 200, '1', 0, { freq: '1k', ac: '1' }), P('R1', 'resistor', 190, 140, '1k'), P('C1', 'capacitor', 260, 200, '100n', 90),
        P('R2', 'resistor', 330, 140, '1k'), P('C2', 'capacitor', 400, 200, '100n', 90), P('R3', 'resistor', 470, 140, '1k'), P('C3', 'capacitor', 540, 200, '100n', 90), GND('GND1', 300, 270),
      ],
      nets: { in: ['V1.+', 'R1.1'], n1: ['R1.2', 'C1.1', 'R2.1'], n2: ['R2.2', 'C2.1', 'R3.1'], out: ['R3.2', 'C3.1'], '0': ['V1.-', 'C1.2', 'C2.2', 'C3.2', 'GND1.GND'] },
    },
    sim: { analysis: 'ac', acStart: '10', acStop: '100k', acPoints: '40' }, show: ['V(n1)', 'V(n2)', 'V(out)'], expect: [{ signal: 'V(out)', kind: 'op', value: 1, tol: 1e-2 }],
  },
  {
    id: 'lc-butterworth', title: 'LC low-pass, Butterworth 3rd order', category: 'Filters',
    description: 'A doubly terminated C–L–C ladder (1 kΩ source and load, 15.9 nF, 31.8 mH, 15.9 nF) with a maximally flat response: −3 dB at 10 kHz (the 0.5 V at DC falls to 0.35 V), then 60 dB per decade. The sweep is the Bode plot; compare it with the RC ladder, which has no flat top.',
    layout: {
      parts: [
        P('V1', 'vsine', 80, 200, '1', 0, { freq: '1k', ac: '1' }), P('Rs', 'resistor', 190, 140, '1k'), P('C1', 'capacitor', 270, 200, '15.9n', 90), P('L1', 'inductor', 360, 140, '31.8m'),
        P('C2', 'capacitor', 450, 200, '15.9n', 90), P('RL', 'resistor', 540, 200, '1k', 90), GND('GND1', 300, 270),
      ],
      nets: { in: ['V1.+', 'Rs.1'], a: ['Rs.2', 'C1.1', 'L1.1'], out: ['L1.2', 'C2.1', 'RL.1'], '0': ['V1.-', 'C1.2', 'C2.2', 'RL.2', 'GND1.GND'] },
    },
    sim: { analysis: 'ac', acStart: '100', acStop: '1meg', acPoints: '40' }, show: ['V(out)'], expect: [{ signal: 'V(out)', kind: 'op', value: 0.5, tol: 1e-2 }],
  },
  {
    id: 'emitter-follower', title: 'Common-collector (emitter follower)', category: 'Transistors',
    description: 'A 2N3904 with its collector on the supply and the output taken from the emitter: the gain is just under 1, the emitter sits about 0.7 V below the base (5.0 V), and the input impedance is high while the output impedance is low (about re ≈ 25 Ω here), so it drives the 10 kΩ load without loss. Run a transient and compare V(in) with V(out).',
    layout: {
      parts: [
        P('VCC', 'battery', 40, 140, '12'), P('VIN', 'vsine', 60, 270, '1', 0, { freq: '1k', ac: '1' }), P('C1', 'capacitor', 130, 200, '10u'), P('R1', 'resistor', 200, 110, '47k', 90),
        P('R2', 'resistor', 200, 230, '47k', 90), P('Q1', 'npn', 320, 200, '2N3904'), P('RE', 'resistor', 330, 260, '1k', 90), P('C2', 'capacitor', 410, 230, '10u'),
        P('RL', 'resistor', 500, 260, '10k', 90), GND('GND1', 200, 330),
      ],
      nets: { vcc: ['VCC.+', 'R1.1', 'Q1.C'], in: ['VIN.+', 'C1.1'], b: ['C1.2', 'R1.2', 'R2.1', 'Q1.B'], e: ['Q1.E', 'RE.1', 'C2.1'], out: ['C2.2', 'RL.1'], '0': ['VCC.-', 'VIN.-', 'R2.2', 'RE.2', 'RL.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '5m' }, show: ['V(in)', 'V(out)'], stacked: true,
    expect: [{ signal: 'V(out)', kind: 'pp', value: 1.99, tol: 0.03, from: 2e-3 }, { signal: 'V(e)', kind: 'mean', value: 5.03, tol: 0.03, from: 2e-3 }],
  },
  {
    id: 'schmitt', title: 'Schmitt trigger (op-amp)', category: 'Op-amps',
    description: 'Positive feedback (18 kΩ / 2 kΩ) gives the comparator two thresholds, ±10 V × 2k/20k = ±1 V. A 3 V, 1 kHz sine drives the inverting input; the output flips to the opposite rail each time the input crosses the threshold that the output itself has just set (V(pos)), so noise smaller than the 2 V hysteresis cannot make it chatter.',
    layout: {
      parts: [P('V1', 'vsine', 100, 200, '3', 0, { freq: '1k', ac: '' }), P('U1', 'opamp', 330, 200, undefined, 0, { rail: '10' }), P('Rf', 'resistor', 360, 290, '18k'), P('Rg', 'resistor', 240, 300, '2k', 90), GND('GND1', 100, 290)],
      nets: { in: ['V1.+', 'U1.IN-'], out: ['U1.OUT', 'Rf.2'], pos: ['U1.IN+', 'Rf.1', 'Rg.1'], '0': ['V1.-', 'Rg.2', 'GND1.GND'] },
    },
    sim: { analysis: 'tran', tranStop: '4m' }, show: ['V(in)', 'V(out)', 'V(pos)'], stacked: true,
    expect: [{ signal: 'V(out)', kind: 'max', value: 10, tol: 0.02 }, { signal: 'V(out)', kind: 'min', value: -10, tol: 0.02 }, { signal: 'V(pos)', kind: 'max', value: 1, tol: 0.03 }, { signal: 'V(out)', kind: 'freq', value: 1000, tol: 0.02, from: 1e-3 }],
  },
  {
    id: 'precision-rectifier', title: 'Precision full-wave rectifier', category: 'Rectifiers',
    description: 'Two op-amps and two diodes remove the 0.65 V diode drop: U1 is an inverting half-wave stage (D1 and D2 inside its feedback), U2 adds that half-wave to the input in the ratio 2 : 1 and so gives |Vin| exactly, even for a 1 V sine that a plain diode bridge would cut to 0.35 V. Run the transient and compare V(in) and V(out).',
    layout: {
      parts: [
        P('V1', 'vsine', 60, 220, '1', 0, { freq: '1k', ac: '' }), P('R1', 'resistor', 160, 160, '10k'), P('U1', 'opamp', 300, 170, undefined, 0, { rail: '15' }),
        P('D1', 'diode', 300, 90, '1N4148', 180), P('R2', 'resistor', 250, 40, '10k'), P('D2', 'diode', 350, 40, '1N4148', 0),
        P('R3', 'resistor', 470, 230, '5k'), P('R4', 'resistor', 470, 290, '10k'), P('U2', 'opamp', 600, 190, undefined, 0, { rail: '15' }), P('R5', 'resistor', 610, 110, '10k'), GND('GND1', 200, 330),
      ],
      nets: {
        '@in': ['V1.+', 'R1.1', 'R4.1'], n1: ['R1.2', 'U1.IN-', 'D1.2', 'R2.1'], o1: ['U1.OUT', 'D1.1', 'D2.2'], '@a': ['R2.2', 'D2.1', 'R3.1'],
        n2: ['R3.2', 'R4.2', 'U2.IN-', 'R5.1'], out: ['U2.OUT', 'R5.2'], '0': ['V1.-', 'U1.IN+', 'U2.IN+', 'GND1.GND'],
      },
    },
    sim: { analysis: 'tran', tranStop: '4m' }, show: ['V(in)', 'V(out)'], stacked: true,
    expect: [{ signal: 'V(out)', kind: 'max', value: 1, tol: 0.03 }, { signal: 'V(out)', kind: 'min', value: 0, tol: 0.03, from: 1e-3 }],
  },
]

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id)
}

/** The schematic of an example (wires are routed on the way). */
export function exampleDoc(ex: Example): Doc {
  return buildLayout(ex.layout)
}
