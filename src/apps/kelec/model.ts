// The schematic: parts, wires and labels on a 10-unit grid, the symbol of every part (as drawing
// primitives that the editor and the SVG export both use), pin geometry and the part catalogue.
// Pure (no React): the netlist, the tests and the file format use it.

export type PartKind =
  | 'resistor' | 'potentiometer' | 'capacitor' | 'electrolytic' | 'inductor' | 'transformer'
  | 'battery' | 'vsine' | 'vpulse' | 'isource' | 'ground'
  | 'diode' | 'schottky' | 'zener' | 'led'
  | 'npn' | 'pnp' | 'nmos' | 'pmos'
  | 'opamp' | 'opamp1' | 'vcvs' | 'vccs'
  | 'switch' | 'switch_timed'
  | 'voltmeter' | 'ammeter'
  | 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor'

export type Rot = 0 | 90 | 180 | 270

export interface Part {
  id: string
  kind: PartKind
  /** reference designator, R1, C2, U1… ("" for ground) */
  ref: string
  value: string
  x: number
  y: number
  rot: Rot
  mirror: boolean
  props: Record<string, string>
}

export interface Wire { id: string; x1: number; y1: number; x2: number; y2: number }
/** A net label: a flag at a point; `flip` points it to the left. */
export interface NetLabel { id: string; name: string; x: number; y: number; flip?: boolean }
export interface Note { id: string; text: string; x: number; y: number }

export interface Doc {
  parts: Part[]
  wires: Wire[]
  labels: NetLabel[]
  notes: Note[]
}

export const GRID = 10

export const emptyDoc = (): Doc => ({ parts: [], wires: [], labels: [], notes: [] })

// ------------------------------------------------------------------------------ catalogue

export type Prim =
  | { t: 'path'; d: string; fill?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { t: 'text'; x: number; y: number; s: string; size?: number; anchor?: 'start' | 'middle' | 'end' }

export interface PinDef {
  name: string
  /** what is drawn next to it (A, K, +, …) */
  label?: string
  x: number
  y: number
}

export interface PropDef {
  key: string
  label: string
  default: string
  options?: string[]
  hint?: string
}

export type Category = 'Passive' | 'Sources' | 'Semiconductors' | 'Amplifiers' | 'Switches' | 'Logic' | 'Meters'

export interface PartDef {
  kind: PartKind
  name: string
  category: Category
  prefix: string
  pins: PinDef[]
  /** the main value: label, default, options (a menu) and unit shown in the properties panel */
  value?: { label: string; default: string; options?: string[]; unit?: string; hint?: string }
  props: PropDef[]
  keywords: string[]
  /** local bounding box: x1, y1, x2, y2 */
  box: [number, number, number, number]
  draw(p: Part): Prim[]
  /** where the "R1  10k" label sits relative to the part, in local space */
  labelAt?: 'top' | 'right'
}

const path = (d: string, fill = false): Prim => ({ t: 'path', d, fill })
const circle = (cx: number, cy: number, r: number, fill = false): Prim => ({ t: 'circle', cx, cy, r, fill })
const text = (x: number, y: number, s: string, size = 11, anchor: 'start' | 'middle' | 'end' = 'middle'): Prim => ({ t: 'text', x, y, s, size, anchor })

const pin = (name: string, x: number, y: number, label?: string): PinDef => ({ name, x, y, label })
const two = (a = '1', b = '2'): PinDef[] => [pin(a, -30, 0), pin(b, 30, 0)]
const vert = (a = '+', b = '-'): PinDef[] => [pin(a, 0, -30), pin(b, 0, 30)]

const DIODES = ['1N4148', '1N4007', 'D']
const SCHOTTKYS = ['1N5819', 'SCHOTTKY']
const NPNS = ['2N3904', 'BC547', 'NPN']
const PNPS = ['2N3906', 'BC557', 'PNP']
const NMOSS = ['2N7000', 'NMOS']
const PMOSS = ['BS250', 'PMOS']
export const LED_COLORS = ['red', 'yellow', 'green', 'blue', 'white']

const DIODE_PROPS: PropDef[] = [
  { key: 'is', label: 'Saturation current Is', default: '', hint: 'empty = from the model' }, { key: 'n', label: 'Ideality n', default: '' },
]
const BJT_PROPS: PropDef[] = [
  { key: 'is', label: 'Saturation current Is', default: '', hint: 'empty = from the model' }, { key: 'bf', label: 'Forward beta', default: '' },
  { key: 'br', label: 'Reverse beta', default: '' }, { key: 'vaf', label: 'Early voltage', default: '' },
]
const MOS_PROPS: PropDef[] = [
  { key: 'vto', label: 'Threshold Vto', default: '', hint: 'empty = from the model' }, { key: 'kp', label: 'Transconductance Kp (A/V²)', default: '' },
  { key: 'lambda', label: 'Lambda (1/V)', default: '' }, { key: 'w', label: 'Width W', default: '' }, { key: 'l', label: 'Length L', default: '' },
]

const diodeBody = (extra: Prim[] = []): Prim[] => [
  path('M-30 0 L-8 0 M8 0 L30 0'),
  path('M-8 -9 L-8 9 L8 0 Z'),
  ...extra,
]

const gateBox = (label: string, inputs: 1 | 2, bubble: boolean): Prim[] => {
  const prims: Prim[] = [path('M-20 -20 L20 -20 L20 20 L-20 20 Z'), text(0, 4, label, 12)]
  if (inputs === 2) prims.push(path('M-30 -10 L-20 -10 M-30 10 L-20 10'))
  else prims.push(path('M-30 0 L-20 0'))
  if (bubble) prims.push(circle(23, 0, 3), path('M26 0 L30 0'))
  else prims.push(path('M20 0 L30 0'))
  return prims
}

const gate = (kind: PartKind, name: string, label: string, inputs: 1 | 2, bubble: boolean, words: string[]): PartDef => ({
  kind, name, category: 'Logic', prefix: 'U',
  pins: inputs === 2 ? [pin('A', -30, -10), pin('B', -30, 10), pin('Y', 30, 0)] : [pin('A', -30, 0), pin('Y', 30, 0)],
  props: [{ key: 'vdd', label: 'Supply (V)', default: '5' }],
  keywords: ['logic', 'gate', 'digital', ...words],
  box: [-30, -22, 30, 22],
  draw: () => gateBox(label, inputs, bubble),
})

const CATALOGUE: PartDef[] = [
  {
    kind: 'resistor', name: 'Resistor', category: 'Passive', prefix: 'R', pins: two(),
    value: { label: 'Resistance', default: '1k', unit: 'Ω' }, props: [], keywords: ['resistor', 'ohm', 'resistance'],
    box: [-30, -10, 30, 10], draw: () => [path('M-30 0 L-20 0 L-16 -8 L-8 8 L0 -8 L8 8 L16 -8 L20 0 L30 0')],
  },
  {
    kind: 'potentiometer', name: 'Potentiometer', category: 'Passive', prefix: 'RV', pins: [pin('1', -30, 0), pin('2', 30, 0), pin('W', 0, -30, 'W')],
    value: { label: 'Resistance', default: '10k', unit: 'Ω' }, props: [{ key: 'pos', label: 'Wiper position (0–1)', default: '0.5' }], keywords: ['potentiometer', 'pot', 'variable resistor', 'trimmer'],
    box: [-30, -30, 30, 10],
    draw: () => [path('M-30 0 L-20 0 L-16 -8 L-8 8 L0 -8 L8 8 L16 -8 L20 0 L30 0'), path('M0 -30 L0 -9'), path('M0 -8 L-3.5 -15 L3.5 -15 Z', true)],
  },
  {
    kind: 'capacitor', name: 'Capacitor', category: 'Passive', prefix: 'C', pins: two(),
    value: { label: 'Capacitance', default: '100n', unit: 'F' }, props: [{ key: 'ic', label: 'Initial voltage', default: '', hint: 'used with “start from initial conditions”' }], keywords: ['capacitor', 'cap', 'farad'],
    box: [-30, -14, 30, 14], draw: () => [path('M-30 0 L-4 0 M-4 -12 L-4 12 M4 -12 L4 12 M4 0 L30 0')],
  },
  {
    kind: 'electrolytic', name: 'Electrolytic capacitor', category: 'Passive', prefix: 'C', pins: [pin('1', -30, 0, '+'), pin('2', 30, 0, '-')],
    value: { label: 'Capacitance', default: '100u', unit: 'F' }, props: [{ key: 'ic', label: 'Initial voltage', default: '' }], keywords: ['electrolytic', 'capacitor', 'polarized', 'polarised', 'cap'],
    box: [-30, -16, 30, 14],
    draw: () => [path('M-30 0 L-4 0 M-4 -12 L-4 12 M30 0 L6 0 M6 -12 Q0 0 6 12'), text(-14, -8, '+', 11)],
  },
  {
    kind: 'inductor', name: 'Inductor', category: 'Passive', prefix: 'L', pins: two(),
    value: { label: 'Inductance', default: '10m', unit: 'H' }, props: [{ key: 'ic', label: 'Initial current', default: '' }], keywords: ['inductor', 'coil', 'choke', 'henry'],
    box: [-30, -10, 30, 6], draw: () => [path('M-30 0 L-20 0 A5 5 0 0 1 -10 0 A5 5 0 0 1 0 0 A5 5 0 0 1 10 0 A5 5 0 0 1 20 0 L30 0')],
  },
  {
    kind: 'transformer', name: 'Transformer', category: 'Passive', prefix: 'T',
    pins: [pin('P1', -30, -20), pin('P2', -30, 20), pin('S1', 30, -20), pin('S2', 30, 20)],
    value: { label: 'Turns ratio Ns/Np', default: '1' },
    props: [{ key: 'lp', label: 'Primary inductance (H)', default: '1' }, { key: 'k', label: 'Coupling', default: '0.999' }],
    keywords: ['transformer', 'coupled', 'mutual'], box: [-30, -22, 30, 22],
    draw: () => [
      path('M-30 -20 L-14 -20 A5 5 0 0 1 -14 -10 A5 5 0 0 1 -14 0 A5 5 0 0 1 -14 10 A5 5 0 0 1 -14 20 L-30 20'),
      path('M30 -20 L14 -20 A5 5 0 0 0 14 -10 A5 5 0 0 0 14 0 A5 5 0 0 0 14 10 A5 5 0 0 0 14 20 L30 20'),
      path('M-3 -20 L-3 20 M3 -20 L3 20'),
      circle(-22, -15, 1.5, true), circle(22, -15, 1.5, true),
    ],
  },
  {
    kind: 'battery', name: 'DC voltage source', category: 'Sources', prefix: 'V', pins: vert(),
    value: { label: 'Voltage', default: '5', unit: 'V' }, props: [{ key: 'ac', label: 'AC amplitude', default: '', hint: 'for the AC sweep' }], keywords: ['battery', 'voltage source', 'dc', 'supply', 'power'],
    box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -4 M-12 -4 L12 -4 M-6 4 L6 4 M0 4 L0 30'), text(10, -12, '+', 11, 'start')],
    labelAt: 'right',
  },
  {
    kind: 'vsine', name: 'AC / sine source', category: 'Sources', prefix: 'V', pins: vert(),
    value: { label: 'Amplitude', default: '1', unit: 'V' },
    props: [
      { key: 'freq', label: 'Frequency (Hz)', default: '1k' }, { key: 'offset', label: 'DC offset', default: '0' }, { key: 'phase', label: 'Phase (deg)', default: '0' },
      { key: 'delay', label: 'Delay (s)', default: '0' }, { key: 'ac', label: 'AC amplitude', default: '1', hint: 'for the AC sweep' },
    ],
    keywords: ['sine', 'ac', 'generator', 'function', 'source', 'signal'], box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -14 M0 14 L0 30'), circle(0, 0, 14), path('M-8 0 Q-4 -9 0 0 T8 0'), text(10, -17, '+', 10, 'start')],
    labelAt: 'right',
  },
  {
    kind: 'vpulse', name: 'Pulse / square source', category: 'Sources', prefix: 'V', pins: vert(),
    value: { label: 'High level', default: '5', unit: 'V' },
    props: [
      { key: 'v1', label: 'Low level (V)', default: '0' }, { key: 'delay', label: 'Delay (s)', default: '0' }, { key: 'rise', label: 'Rise time (s)', default: '1n' },
      { key: 'fall', label: 'Fall time (s)', default: '1n' }, { key: 'width', label: 'Pulse width (s)', default: '0.5m' }, { key: 'period', label: 'Period (s)', default: '1m' },
    ],
    keywords: ['pulse', 'square', 'clock', 'step', 'source', 'generator'], box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -14 M0 14 L0 30'), circle(0, 0, 14), path('M-8 4 L-8 -4 L0 -4 L0 4 L8 4 L8 -4'), text(10, -17, '+', 10, 'start')],
    labelAt: 'right',
  },
  {
    kind: 'isource', name: 'Current source', category: 'Sources', prefix: 'I', pins: vert(),
    value: { label: 'Current', default: '1m', unit: 'A' }, props: [{ key: 'ac', label: 'AC amplitude', default: '' }], keywords: ['current source', 'source', 'amp'],
    box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -14 M0 14 L0 30'), circle(0, 0, 14), path('M0 8 L0 -8'), path('M0 -9 L-3.5 -2 L3.5 -2 Z', true)],
    labelAt: 'right',
  },
  {
    kind: 'ground', name: 'Ground', category: 'Sources', prefix: 'GND', pins: [pin('GND', 0, 0)],
    props: [], keywords: ['ground', 'gnd', '0v', 'reference'], box: [-12, 0, 12, 22],
    draw: () => [path('M0 0 L0 10 M-12 10 L12 10 M-8 15 L8 15 M-4 20 L4 20')],
  },
  {
    kind: 'diode', name: 'Diode', category: 'Semiconductors', prefix: 'D', pins: [pin('1', -30, 0, 'A'), pin('2', 30, 0, 'K')],
    value: { label: 'Model', default: '1N4148', options: DIODES }, props: DIODE_PROPS, keywords: ['diode', 'rectifier', '1n4148', '1n4007'],
    box: [-30, -10, 30, 10], draw: () => diodeBody([path('M8 -9 L8 9')]),
  },
  {
    kind: 'schottky', name: 'Schottky diode', category: 'Semiconductors', prefix: 'D', pins: [pin('1', -30, 0, 'A'), pin('2', 30, 0, 'K')],
    value: { label: 'Model', default: '1N5819', options: SCHOTTKYS }, props: DIODE_PROPS, keywords: ['schottky', 'diode', 'fast', '1n5819'],
    box: [-30, -12, 30, 12], draw: () => diodeBody([path('M4 -7 L4 -9 L8 -9 L8 9 L12 9 L12 7')]),
  },
  {
    kind: 'zener', name: 'Zener diode', category: 'Semiconductors', prefix: 'D', pins: [pin('1', -30, 0, 'A'), pin('2', 30, 0, 'K')],
    value: { label: 'Zener voltage', default: '5.1', unit: 'V' }, props: DIODE_PROPS, keywords: ['zener', 'diode', 'regulator', 'reference'],
    box: [-30, -12, 30, 12], draw: () => diodeBody([path('M12 -9 L8 -9 L8 9 L4 9')]),
  },
  {
    kind: 'led', name: 'LED', category: 'Semiconductors', prefix: 'D', pins: [pin('1', -30, 0, 'A'), pin('2', 30, 0, 'K')],
    value: { label: 'Colour', default: 'red', options: LED_COLORS }, props: [], keywords: ['led', 'light', 'diode', 'lamp'],
    box: [-30, -20, 30, 10],
    draw: () => diodeBody([path('M8 -9 L8 9'), path('M-2 -11 L6 -19 M2 -19 L6 -19 L6 -15'), path('M5 -8 L13 -16 M9 -16 L13 -16 L13 -12')]),
  },
  {
    kind: 'npn', name: 'NPN transistor', category: 'Semiconductors', prefix: 'Q', pins: [pin('B', -30, 0), pin('C', 10, -30), pin('E', 10, 30)],
    value: { label: 'Model', default: '2N3904', options: NPNS }, props: BJT_PROPS, keywords: ['npn', 'bjt', 'transistor', 'bipolar', '2n3904', 'bc547'],
    box: [-30, -30, 14, 30],
    draw: () => [path('M-30 0 L-6 0 M-6 -14 L-6 14 M-6 -5 L10 -17 L10 -30 M-6 5 L10 17 L10 30'), path('M6.8 14.6 L-0.9 13.2 L3.3 7.6 Z', true)],
  },
  {
    kind: 'pnp', name: 'PNP transistor', category: 'Semiconductors', prefix: 'Q', pins: [pin('B', -30, 0), pin('C', 10, -30), pin('E', 10, 30)],
    value: { label: 'Model', default: '2N3906', options: PNPS }, props: BJT_PROPS, keywords: ['pnp', 'bjt', 'transistor', 'bipolar', '2n3906', 'bc557'],
    box: [-30, -30, 14, 30],
    draw: () => [path('M-30 0 L-6 0 M-6 -14 L-6 14 M-6 -5 L10 -17 L10 -30 M-6 5 L10 17 L10 30'), path('M-2 8 L1.5 15 L5.7 9.4 Z', true)],
  },
  {
    kind: 'nmos', name: 'N-channel MOSFET', category: 'Semiconductors', prefix: 'M', pins: [pin('G', -30, 0), pin('D', 10, -30), pin('S', 10, 30)],
    value: { label: 'Model', default: '2N7000', options: NMOSS }, props: MOS_PROPS, keywords: ['nmos', 'mosfet', 'fet', 'transistor', 'n-channel', '2n7000'],
    box: [-30, -30, 14, 30],
    draw: () => [
      path('M-30 0 L-10 0 M-10 -12 L-10 12 M-4 -14 L-4 -6 M-4 -3 L-4 3 M-4 6 L-4 14'),
      path('M-4 -10 L10 -10 L10 -30 M-4 10 L10 10 L10 30 M-4 0 L10 0 L10 10'), path('M-4 0 L2 -3 L2 3 Z', true),
    ],
  },
  {
    kind: 'pmos', name: 'P-channel MOSFET', category: 'Semiconductors', prefix: 'M', pins: [pin('G', -30, 0), pin('D', 10, -30), pin('S', 10, 30)],
    value: { label: 'Model', default: 'BS250', options: PMOSS }, props: MOS_PROPS, keywords: ['pmos', 'mosfet', 'fet', 'transistor', 'p-channel', 'bs250'],
    box: [-30, -30, 14, 30],
    draw: () => [
      path('M-30 0 L-10 0 M-10 -12 L-10 12 M-4 -14 L-4 -6 M-4 -3 L-4 3 M-4 6 L-4 14'),
      path('M-4 -10 L10 -10 L10 -30 M-4 10 L10 10 L10 30 M-4 0 L10 0 L10 10'), path('M4 0 L-2 -3 L-2 3 Z', true),
    ],
  },
  {
    kind: 'opamp', name: 'Op-amp (ideal)', category: 'Amplifiers', prefix: 'U',
    pins: [pin('IN-', -30, -10, '−'), pin('IN+', -30, 10, '+'), pin('OUT', 40, 0), pin('V+', 0, -30), pin('V-', 0, 30)],
    props: [{ key: 'gain', label: 'Open-loop gain', default: '1e6' }, { key: 'rail', label: 'Output limit ±V', default: '15', hint: 'used when the supply pins are not wired' }],
    keywords: ['opamp', 'op-amp', 'operational amplifier', 'amplifier', 'comparator'], box: [-30, -30, 40, 30],
    draw: () => [
      path('M-20 -30 L-20 30 L30 0 Z'), path('M-30 -10 L-20 -10 M-30 10 L-20 10 M30 0 L40 0 M0 -30 L0 -18 M0 30 L0 18'),
      text(-15, -7, '−', 11, 'start'), text(-15, 14, '+', 11, 'start'),
    ],
  },
  {
    kind: 'opamp1', name: 'Op-amp (single pole)', category: 'Amplifiers', prefix: 'U',
    pins: [pin('IN-', -30, -10, '−'), pin('IN+', -30, 10, '+'), pin('OUT', 40, 0), pin('V+', 0, -30), pin('V-', 0, 30)],
    props: [
      { key: 'a0', label: 'DC gain', default: '100k' }, { key: 'gbw', label: 'Gain-bandwidth (Hz)', default: '1meg' },
      { key: 'rail', label: 'Output limit ±V', default: '15' },
    ],
    keywords: ['opamp', 'op-amp', 'amplifier', 'finite gain', 'bandwidth', 'real'], box: [-30, -30, 40, 30],
    draw: () => [
      path('M-20 -30 L-20 30 L30 0 Z'), path('M-30 -10 L-20 -10 M-30 10 L-20 10 M30 0 L40 0 M0 -30 L0 -18 M0 30 L0 18'),
      text(-15, -7, '−', 11, 'start'), text(-15, 14, '+', 11, 'start'), text(4, 5, 'GBW', 8, 'start'),
    ],
  },
  {
    kind: 'vcvs', name: 'Voltage-controlled voltage source', category: 'Amplifiers', prefix: 'E',
    pins: [pin('O+', 0, -30), pin('O-', 0, 30), pin('C+', -30, -10), pin('C-', -30, 10)],
    value: { label: 'Gain', default: '10' }, props: [], keywords: ['vcvs', 'controlled', 'dependent', 'source', 'amplifier'], box: [-30, -30, 20, 30],
    draw: () => [path('M-20 -20 L20 -20 L20 20 L-20 20 Z M0 -30 L0 -20 M0 20 L0 30 M-30 -10 L-20 -10 M-30 10 L-20 10'), text(0, 5, 'E', 14)],
  },
  {
    kind: 'vccs', name: 'Voltage-controlled current source', category: 'Amplifiers', prefix: 'G',
    pins: [pin('O+', 0, -30), pin('O-', 0, 30), pin('C+', -30, -10), pin('C-', -30, 10)],
    value: { label: 'Transconductance', default: '1m', unit: 'S' }, props: [], keywords: ['vccs', 'controlled', 'dependent', 'transconductance', 'source'], box: [-30, -30, 20, 30],
    draw: () => [path('M-20 -20 L20 -20 L20 20 L-20 20 Z M0 -30 L0 -20 M0 20 L0 30 M-30 -10 L-20 -10 M-30 10 L-20 10'), text(0, 5, 'G', 14)],
  },
  {
    kind: 'switch', name: 'Switch (manual)', category: 'Switches', prefix: 'SW', pins: two(),
    value: { label: 'State', default: 'closed', options: ['closed', 'open'] }, props: [{ key: 'ron', label: 'On resistance (Ω)', default: '10m' }],
    keywords: ['switch', 'toggle', 'button', 'spst'], box: [-30, -16, 30, 6],
    draw: (p) => [path('M-30 0 L-10 0 M10 0 L30 0'), circle(-10, 0, 2, true), circle(10, 0, 2, true), path(p.value === 'open' ? 'M-10 0 L8 -14' : 'M-10 0 L10 0')],
  },
  {
    kind: 'switch_timed', name: 'Switch (timed)', category: 'Switches', prefix: 'SW', pins: two(),
    props: [
      { key: 'delay', label: 'Closes at (s)', default: '1m' }, { key: 'on', label: 'Closed for (s)', default: '1m' }, { key: 'period', label: 'Period (s, 0 = once)', default: '0' },
      { key: 'ron', label: 'On resistance (Ω)', default: '10m' },
    ],
    keywords: ['switch', 'timed', 'clock', 'pwm', 'h-bridge'], box: [-30, -16, 30, 6],
    draw: () => [path('M-30 0 L-10 0 M10 0 L30 0'), circle(-10, 0, 2, true), circle(10, 0, 2, true), path('M-10 0 L8 -14'), path('M2 -18 L2 -22 L6 -22 L6 -18', false)],
  },
  {
    kind: 'voltmeter', name: 'Voltmeter', category: 'Meters', prefix: 'VM', pins: vert(),
    props: [], keywords: ['voltmeter', 'meter', 'probe', 'measure', 'voltage'], box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -14 M0 14 L0 30'), circle(0, 0, 14), text(0, 5, 'V', 14), text(10, -17, '+', 10, 'start')], labelAt: 'right',
  },
  {
    kind: 'ammeter', name: 'Ammeter', category: 'Meters', prefix: 'A', pins: vert(),
    props: [], keywords: ['ammeter', 'meter', 'probe', 'measure', 'current'], box: [-14, -30, 14, 30],
    draw: () => [path('M0 -30 L0 -14 M0 14 L0 30'), circle(0, 0, 14), text(0, 5, 'A', 14), text(10, -17, '+', 10, 'start')], labelAt: 'right',
  },
  gate('and', 'AND gate', '&', 2, false, ['and']),
  gate('or', 'OR gate', '≥1', 2, false, ['or']),
  gate('not', 'NOT gate (inverter)', '1', 1, true, ['not', 'inverter']),
  gate('nand', 'NAND gate', '&', 2, true, ['nand']),
  gate('nor', 'NOR gate', '≥1', 2, true, ['nor']),
  gate('xor', 'XOR gate', '=1', 2, false, ['xor', 'exclusive']),
  gate('xnor', 'XNOR gate', '=1', 2, true, ['xnor']),
]

export const PART_DEFS: Record<PartKind, PartDef> = Object.fromEntries(CATALOGUE.map((d) => [d.kind, d])) as Record<PartKind, PartDef>
export const PART_LIST: PartDef[] = CATALOGUE
export const CATEGORIES: Category[] = ['Passive', 'Sources', 'Semiconductors', 'Amplifiers', 'Switches', 'Logic', 'Meters']

export const defOf = (p: Part | PartKind): PartDef => PART_DEFS[typeof p === 'string' ? p : p.kind]

// ------------------------------------------------------------------------------ geometry

/** Local point → world, applying mirror (x → −x), then rotation (clockwise on screen), then the part's position. */
export function toWorld(p: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>, lx: number, ly: number): { x: number; y: number } {
  let x = p.mirror ? -lx : lx
  let y = ly
  for (let i = 0; i < p.rot / 90; i++) { const t = x; x = -y; y = t }
  return { x: p.x + x, y: p.y + y }
}

export interface PinPos { name: string; label?: string; x: number; y: number }

export function pinPositions(p: Part): PinPos[] {
  return defOf(p).pins.map((d) => ({ name: d.name, label: d.label, ...toWorld(p, d.x, d.y) }))
}

export function partBounds(p: Part): { x1: number; y1: number; x2: number; y2: number } {
  const [a, b, c, d] = defOf(p).box
  const q1 = toWorld(p, a, b)
  const q2 = toWorld(p, c, d)
  return { x1: Math.min(q1.x, q2.x), y1: Math.min(q1.y, q2.y), x2: Math.max(q1.x, q2.x), y2: Math.max(q1.y, q2.y) }
}

export const snap = (v: number, step = GRID) => Math.round(v / step) * step

export function onSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
  if (px < Math.min(x1, x2) - 1e-9 || px > Math.max(x1, x2) + 1e-9 || py < Math.min(y1, y2) - 1e-9 || py > Math.max(y1, y2) + 1e-9) return false
  const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
  return Math.abs(cross) < 1e-6
}


// ------------------------------------------------------------------------------ creating parts

let counter = 0
export const newId = (prefix = 'e'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export function defaultProps(kind: PartKind): Record<string, string> {
  const o: Record<string, string> = {}
  for (const pr of PART_DEFS[kind].props) o[pr.key] = pr.default
  return o
}

/** The first free reference number for a prefix: R1, R2… */
export function nextRef(doc: Doc, prefix: string): string {
  const used = new Set(doc.parts.map((p) => p.ref))
  for (let i = 1; i < 10000; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`
  return `${prefix}?`
}

export function newPart(doc: Doc, kind: PartKind, x: number, y: number, init: Partial<Part> = {}): Part {
  const def = PART_DEFS[kind]
  return {
    id: newId('p'), kind, ref: kind === 'ground' ? '' : nextRef(doc, def.prefix), value: def.value?.default ?? '',
    x: snap(x), y: snap(y), rot: 0, mirror: false, props: defaultProps(kind), ...init,
  }
}

/** Where the reference and the value text go (world coordinates, plus the text anchor): beside a tall part, above and below a wide one. */
export function labelPosition(p: Part): { x: number; y: number; vy: number; anchor: 'start' | 'middle' | 'end' } {
  const b = partBounds(p)
  const vertical = b.y2 - b.y1 > b.x2 - b.x1
  if (vertical) return { x: b.x2 + 6, y: (b.y1 + b.y2) / 2 - 2, vy: (b.y1 + b.y2) / 2 + 10, anchor: 'start' }
  return { x: (b.x1 + b.x2) / 2, y: b.y1 - 4, vy: b.y2 + 12, anchor: 'middle' }
}

export const ROT_NEXT: Record<Rot, Rot> = { 0: 90, 90: 180, 180: 270, 270: 0 }

/** The text shown beside a part: "R1" and its value. */
export function partLabel(p: Part): { ref: string; value: string } {
  const def = defOf(p)
  if (p.kind === 'ground') return { ref: '', value: '' }
  let value = p.value
  if (p.kind === 'zener' && value) value = `${value}V`
  else if (p.kind === 'battery' && value) value = `${value}V`
  else if (p.kind === 'vsine') value = `${p.value || '0'}V ${p.props.freq || ''}Hz`
  else if (p.kind === 'vpulse') value = `${p.props.v1 || '0'}/${p.value || '0'}V`
  else if (p.kind === 'isource' && value) value = `${value}A`
  else if (p.kind === 'resistor' || p.kind === 'potentiometer') value = value ? `${value}Ω` : ''
  else if (p.kind === 'capacitor' || p.kind === 'electrolytic') value = value ? `${value}F` : ''
  else if (p.kind === 'inductor') value = value ? `${value}H` : ''
  else if (def.kind === 'transformer') value = `1:${p.value || '1'}`
  else if (p.kind === 'opamp' || p.kind === 'opamp1') value = p.kind === 'opamp' ? 'ideal' : `GBW ${p.props.gbw || ''}`
  else if (p.kind === 'switch_timed') value = ''
  else if (p.kind === 'voltmeter' || p.kind === 'ammeter') value = ''
  return { ref: p.ref, value }
}
