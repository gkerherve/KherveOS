// The logic schematic: parts, wires and net labels on a 10-unit grid, the catalogue of parts (pins, symbol,
// properties) and the geometry of rotated / mirrored parts. Pure (no React): the netlist, the simulator,
// the HDL export, the file format and the tests use it.

export type Rot = 0 | 90 | 180 | 270

export type Kind =
  | 'switch' | 'button' | 'clock' | 'const'
  | 'led' | 'seg7' | 'hex' | 'probe'
  | 'buf' | 'not' | 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor' | 'tribuf'
  | 'mux' | 'demux' | 'decoder' | 'encoder' | 'halfadder' | 'fulladder' | 'adder' | 'comparator' | 'bcd7'
  | 'srlatch' | 'dlatch' | 'dff' | 'jkff' | 'tff' | 'register' | 'counter' | 'shift'
  | 'rom' | 'ram' | 'pull'

export interface Part {
  id: string
  kind: Kind
  /** reference designator: U1, SW2, FF1 … */
  ref: string
  x: number
  y: number
  rot: Rot
  mirror: boolean
  props: Record<string, string>
}

export interface Wire { id: string; x1: number; y1: number; x2: number; y2: number }
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

export type Prim =
  | { t: 'path'; d: string; fill?: boolean; cls?: string; width?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean; cls?: string }
  | { t: 'text'; x: number; y: number; s: string; size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; cls?: string }

export interface PinDef {
  name: string
  /** drawn inside the body */
  label?: string
  x: number
  y: number
  dir: 'in' | 'out' | 'pull'
  /** clock input: a small triangle is drawn */
  clk?: boolean
  /** inverted (a bubble is drawn) */
  neg?: boolean
  /** value read when nothing is connected (control inputs: enable = 1, reset = 0) */
  def?: 0 | 1
}

export interface Shape {
  pins: PinDef[]
  /** body in local coordinates: x1, y1, x2, y2 */
  box: [number, number, number, number]
  prims: Prim[]
}

export interface PropDef {
  key: string
  label: string
  default: string
  options?: string[]
  hint?: string
  multiline?: boolean
}

export type Category = 'Inputs' | 'Outputs' | 'Gates' | 'Combinational' | 'Arithmetic' | 'Sequential' | 'Memory' | 'Other'

export interface KindDef {
  kind: Kind
  name: string
  category: Category
  prefix: string
  keywords: string[]
  props: PropDef[]
  shape(p: Part): Shape
  /** inputs, outputs and the signal name shown beside the part */
  role?: 'source' | 'sink'
}

// ------------------------------------------------------------------------------ small helpers

const path = (d: string, fill = false): Prim => ({ t: 'path', d, fill })
const circle = (cx: number, cy: number, r: number, fill = false): Prim => ({ t: 'circle', cx, cy, r, fill })
const text = (x: number, y: number, s: string, size = 11, anchor: 'start' | 'middle' | 'end' = 'middle', bold = false): Prim => ({ t: 'text', x, y, s, size, anchor, bold })

export const propNum = (p: Pick<Part, 'props'>, key: string, def: number, min = -Infinity, max = Infinity): number => {
  const raw = p.props[key]
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
}
const prop = (p: Pick<Part, 'props'>, key: string, def: string): string => (p.props[key] !== undefined && p.props[key] !== '' ? p.props[key] : def)

const DELAY: PropDef = { key: 'delay', label: 'Delay (time units)', default: '', hint: 'empty = the default delay; used in “per-gate delays” mode' }
const NAME: PropDef = { key: 'name', label: 'Signal name', default: '', hint: 'shown beside the part and used in timing diagrams' }

/** MSB first: ['D3','D2','D1','D0'] */
export const busNames = (prefix: string, n: number, msbFirst = true): string[] => {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(`${prefix}${msbFirst ? n - 1 - i : i}`)
  return out
}

interface PinSpec { name: string; label?: string; dir?: 'in' | 'out'; clk?: boolean; neg?: boolean; def?: 0 | 1 }

interface BlockOpts {
  title: string
  subtitle?: string
  left?: PinSpec[]
  right?: PinSpec[]
  top?: PinSpec[]
  bottom?: PinSpec[]
  minW?: number
  extra?: Prim[]
}

const roundUp20 = (v: number) => Math.ceil(v / 20) * 20

/** A rectangular block: inputs on the left, outputs on the right, control pins on the top / bottom. */
function block(o: BlockOpts): Shape {
  const left = o.left ?? []
  const right = o.right ?? []
  const top = o.top ?? []
  const bottom = o.bottom ?? []
  const m = Math.max(left.length, right.length, 1)
  const H = Math.max(40, 20 * (m + 1))
  const lw = Math.max(0, ...left.map((s) => (s.label ?? s.name).length))
  const rw = Math.max(0, ...right.map((s) => (s.label ?? s.name).length))
  const tb = Math.max(top.length, bottom.length)
  const inner = lw * 6.4 + rw * 6.4 + Math.max(o.title.length * 8.2, (o.subtitle?.length ?? 0) * 5.6) + 18
  const W = Math.max(o.minW ?? 60, 20 * (tb + 1), roundUp20(inner))
  const pins: PinDef[] = []
  const prims: Prim[] = [path(`M${-W / 2} ${-H / 2} H${W / 2} V${H / 2} H${-W / 2} Z`)]
  const place = (list: PinSpec[], side: 'L' | 'R' | 'T' | 'B') => {
    const k = list.length
    list.forEach((s, i) => {
      const c = (i - (k - 1) / 2) * 20
      const dir = s.dir ?? (side === 'R' ? 'out' : 'in')
      const label = s.label ?? s.name
      let x = 0, y = 0
      if (side === 'L') { x = -W / 2 - 10; y = c } else if (side === 'R') { x = W / 2 + 10; y = c } else if (side === 'T') { x = c; y = -H / 2 - 10 } else { x = c; y = H / 2 + 10 }
      pins.push({ name: s.name, label, x, y, dir, clk: s.clk, neg: s.neg, def: s.def })
      const bubble = s.neg ? 6 : 0
      if (side === 'L') {
        prims.push(path(`M${x} ${y} H${-W / 2 - bubble}`))
        if (s.neg) prims.push(circle(-W / 2 - 3, y, 3))
        if (s.clk) prims.push(path(`M${-W / 2} ${y - 5} L${-W / 2 + 7} ${y} L${-W / 2} ${y + 5}`))
        if (label && !s.clk) prims.push(text(-W / 2 + 4, y + 3.5, label, 10, 'start'))
        else if (label) prims.push(text(-W / 2 + 10, y + 3.5, label, 10, 'start'))
      } else if (side === 'R') {
        prims.push(path(`M${W / 2 + bubble} ${y} H${x}`))
        if (s.neg) prims.push(circle(W / 2 + 3, y, 3))
        if (label) prims.push(text(W / 2 - 4, y + 3.5, label, 10, 'end'))
      } else if (side === 'T') {
        prims.push(path(`M${x} ${y} V${-H / 2 - bubble}`))
        if (s.neg) prims.push(circle(x, -H / 2 - 3, 3))
        if (label) prims.push(text(x, -H / 2 + 12, label, 10))
      } else {
        prims.push(path(`M${x} ${H / 2 + bubble} V${y}`))
        if (s.neg) prims.push(circle(x, H / 2 + 3, 3))
        if (s.clk) prims.push(path(`M${x - 5} ${H / 2} L${x} ${H / 2 - 7} L${x + 5} ${H / 2}`))
        if (label) prims.push(text(x, H / 2 - (s.clk ? 10 : 4), label, 10))
      }
    })
  }
  place(left, 'L'); place(right, 'R'); place(top, 'T'); place(bottom, 'B')
  prims.push(text(0, o.subtitle ? -2 : 4, o.title, 12, 'middle', true))
  if (o.subtitle) prims.push(text(0, 11, o.subtitle, 9))
  if (o.extra) prims.push(...o.extra)
  return { pins, box: [-W / 2, -H / 2, W / 2, H / 2], prims }
}

// ------------------------------------------------------------------------------ gates

const GATE_INPUTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function gateShape(kind: 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor' | 'buf' | 'not', n: number): Shape {
  const h = Math.max(20, n * 10)
  const ys = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 20)
  const pins: PinDef[] = ys.map((y, i) => ({ name: GATE_INPUTS[i], x: -30, y, dir: 'in' as const }))
  pins.push({ name: 'Y', x: 30, y: 0, dir: 'out' })
  const prims: Prim[] = []
  const bubble = kind === 'nand' || kind === 'nor' || kind === 'xnor' || kind === 'not'
  let outX = 20
  if (kind === 'and' || kind === 'nand') {
    prims.push(path(`M-20 ${-h} H0 A20 ${h} 0 0 1 0 ${h} H-20 Z`))
    for (const y of ys) prims.push(path(`M-30 ${y} H-20`))
  } else if (kind === 'or' || kind === 'nor' || kind === 'xor' || kind === 'xnor') {
    const x = kind === 'xor' || kind === 'xnor' ? 6 : 0
    prims.push(path(`M${-20 - x * 0} ${-h} Q5 ${-h} 20 0 Q5 ${h} -20 ${h} Q-8 0 -20 ${-h} Z`))
    if (x) prims.push(path(`M-26 ${-h} Q-14 0 -26 ${h}`))
    for (const y of ys) {
      const back = -14 - 6 * (y / h) ** 2
      prims.push(path(`M-30 ${y} H${(x ? back - 6 : back).toFixed(1)}`))
    }
  } else {
    // buffer / inverter: a triangle
    outX = kind === 'not' ? 12 : 15
    prims.push(path(`M-15 ${-15} L-15 15 L${outX} 0 Z`), path('M-30 0 H-15'))
  }
  if (bubble) {
    prims.push(circle(outX + 3, 0, 3), path(`M${outX + 6} 0 H30`))
  } else prims.push(path(`M${outX} 0 H30`))
  return { pins, box: [-20, -h, 20, h], prims }
}

function gateDef(kind: 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor', name: string, words: string[]): KindDef {
  return {
    kind, name, category: 'Gates', prefix: 'U', keywords: ['gate', 'logic', ...words],
    props: [{ key: 'inputs', label: 'Inputs (2–8)', default: '2' }, DELAY],
    shape: (p) => gateShape(kind, propNum(p, 'inputs', 2, 2, 8)),
  }
}

// ------------------------------------------------------------------------------ seven-segment drawing

/** End points of the seven segments of a display centred on the origin, 26 × 50. */
export const SEGMENTS: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g', [number, number, number, number]> = {
  a: [-10, -24, 10, -24], b: [13, -21, 13, -3], c: [13, 3, 13, 21], d: [-10, 24, 10, 24], e: [-13, 3, -13, 21], f: [-13, -21, -13, -3], g: [-10, 0, 10, 0],
}
export const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

/** One segment of the display as a path, scaled about (cx, cy). */
export function segmentPath(name: keyof typeof SEGMENTS, cx = 20, cy = 0, k = 2.2): string {
  const [x1, y1, x2, y2] = SEGMENTS[name]
  return `M${(cx + x1 * k).toFixed(1)} ${(cy + y1 * k).toFixed(1)} L${(cx + x2 * k).toFixed(1)} ${(cy + y2 * k).toFixed(1)}`
}

/** Which segments light for each hexadecimal digit (a b c d e f g). */
export const HEX_SEGMENTS: string[] = [
  'abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg',
]

// ------------------------------------------------------------------------------ catalogue

const bitsProp = (def = '4', label = 'Bits (1–8)'): PropDef => ({ key: 'bits', label, default: def })
const initProp = (label = 'Initial value'): PropDef => ({ key: 'init', label, default: '0', hint: '0, 1 or X (unknown); a number for registers and counters' })
const edgeProp: PropDef = { key: 'edge', label: 'Clock edge', default: 'rising', options: ['rising', 'falling'] }

const ioShape = (pins: PinDef[], box: Shape['box'], prims: Prim[]): Shape => ({ pins, box, prims })

const CATALOGUE: KindDef[] = [
  // ---- inputs
  {
    kind: 'switch', name: 'Toggle switch', category: 'Inputs', prefix: 'SW', role: 'source', keywords: ['input', 'switch', 'toggle', 'logic level', 'source'],
    props: [NAME, { key: 'value', label: 'Initial value', default: '0', options: ['0', '1'] }],
    shape: () => ioShape([{ name: 'Y', x: 30, y: 0, dir: 'out' }], [-20, -12, 20, 12], [path('M-20 -12 H20 V12 H-20 Z'), path('M20 0 H30')]),
  },
  {
    kind: 'button', name: 'Push button', category: 'Inputs', prefix: 'PB', role: 'source', keywords: ['input', 'button', 'push', 'momentary', 'reset'],
    props: [NAME, { key: 'value', label: 'Rest value', default: '0', options: ['0', '1'], hint: 'the level when the button is not pressed' }],
    shape: () => ioShape([{ name: 'Y', x: 30, y: 0, dir: 'out' }], [-14, -14, 14, 14], [circle(0, 0, 12), circle(0, 0, 6), path('M12 0 H30')]),
  },
  {
    kind: 'clock', name: 'Clock', category: 'Inputs', prefix: 'CK', role: 'source', keywords: ['input', 'clock', 'oscillator', 'square wave', 'frequency', 'duty'],
    props: [
      NAME, { key: 'period', label: 'Period (time units)', default: '20', hint: 'at least 2' }, { key: 'duty', label: 'Duty cycle (% high)', default: '50' },
      { key: 'offset', label: 'Start delay (time units)', default: '0' },
    ],
    shape: () => ioShape([{ name: 'Y', x: 30, y: 0, dir: 'out' }], [-20, -14, 20, 14], [path('M-20 -14 H20 V14 H-20 Z'), path('M-14 6 H-8 V-6 H0 V6 H8 V-6 H14'), path('M20 0 H30')]),
  },
  {
    kind: 'const', name: 'Constant 0 / 1', category: 'Inputs', prefix: 'K', role: 'source', keywords: ['input', 'constant', 'vcc', 'ground', 'high', 'low', 'tie'],
    props: [{ key: 'value', label: 'Value', default: '1', options: ['0', '1', 'X', 'Z'] }, NAME],
    shape: (p) => ioShape([{ name: 'Y', x: 20, y: 0, dir: 'out' }], [-12, -12, 12, 12], [path('M-12 -12 H12 V12 H-12 Z'), text(0, 4, prop(p, 'value', '1'), 12, 'middle', true), path('M12 0 H20')]),
  },
  // ---- outputs
  {
    kind: 'led', name: 'LED', category: 'Outputs', prefix: 'LED', role: 'sink', keywords: ['output', 'led', 'lamp', 'indicator', 'light'],
    props: [NAME, { key: 'color', label: 'Colour', default: 'red', options: ['red', 'green', 'yellow', 'blue'] }],
    shape: () => ioShape([{ name: 'A', x: -30, y: 0, dir: 'in' }], [-14, -14, 14, 14], [circle(0, 0, 12), circle(0, 0, 4), path('M-30 0 H-12')]),
  },
  {
    kind: 'seg7', name: '7-segment display', category: 'Outputs', prefix: 'DS', role: 'sink', keywords: ['output', '7 segment', 'seven segment', 'display', 'digit'],
    props: [NAME, { key: 'active', label: 'Segments light when', default: 'high', options: ['high', 'low'] }],
    shape: () => {
      const names = [...SEGMENT_NAMES]
      const pins = names.map((n, i): PinDef => ({ name: n, label: n, x: -50, y: (i - 3) * 20, dir: 'in' }))
      const prims: Prim[] = [path('M-30 -80 H70 V80 H-30 Z')]
      pins.forEach((q) => prims.push(path(`M-50 ${q.y} H-30`), text(-26, q.y + 3.5, q.label ?? '', 10, 'start')))
      for (const sName of SEGMENT_NAMES) prims.push({ t: 'path', d: segmentPath(sName), cls: 'seg-off', width: 5 })
      return { pins, box: [-30, -80, 70, 80], prims }
    },
  },
  {
    kind: 'hex', name: 'Hex digit display', category: 'Outputs', prefix: 'HX', role: 'sink', keywords: ['output', 'hex', 'hexadecimal', 'digit', 'display', 'number'],
    props: [NAME],
    shape: () => {
      const pins = busNames('D', 4).map((n, i): PinDef => ({ name: n, label: n, x: -40, y: (i - 1.5) * 20, dir: 'in' }))
      const prims: Prim[] = [path('M-20 -50 H40 V50 H-20 Z')]
      pins.forEach((q) => prims.push(path(`M-40 ${q.y} H-20`), text(-16, q.y + 3.5, q.label ?? '', 10, 'start')))
      return { pins, box: [-20, -50, 40, 50], prims }
    },
  },
  {
    kind: 'probe', name: 'Bus probe', category: 'Outputs', prefix: 'BP', role: 'sink', keywords: ['output', 'probe', 'bus', 'number', 'value', 'display', 'decimal', 'binary'],
    props: [NAME, bitsProp('4', 'Bits (1–16)'), { key: 'radix', label: 'Shown as', default: 'hex', options: ['hex', 'decimal', 'binary', 'signed'] }],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 16)
      const pins = busNames('B', n).map((nm, i): PinDef => ({ name: nm, label: nm, x: -50, y: (i - (n - 1) / 2) * 20, dir: 'in' }))
      const H = Math.max(40, 20 * (n + 1))
      const prims: Prim[] = [path(`M-30 ${-H / 2} H40 V${H / 2} H-30 Z`)]
      pins.forEach((q) => prims.push(path(`M-50 ${q.y} H-30`), text(-26, q.y + 3.5, q.label ?? '', 10, 'start')))
      return { pins, box: [-30, -H / 2, 40, H / 2], prims }
    },
  },
  // ---- gates
  {
    kind: 'buf', name: 'Buffer', category: 'Gates', prefix: 'U', keywords: ['gate', 'buffer', 'delay', 'logic'], props: [DELAY],
    shape: () => gateShape('buf', 1),
  },
  {
    kind: 'not', name: 'NOT gate (inverter)', category: 'Gates', prefix: 'U', keywords: ['gate', 'not', 'inverter', 'invert', 'logic', 'complement'], props: [DELAY],
    shape: () => gateShape('not', 1),
  },
  gateDef('and', 'AND gate', ['and']),
  gateDef('or', 'OR gate', ['or']),
  gateDef('nand', 'NAND gate', ['nand']),
  gateDef('nor', 'NOR gate', ['nor']),
  gateDef('xor', 'XOR gate', ['xor', 'exclusive']),
  gateDef('xnor', 'XNOR gate', ['xnor', 'equivalence']),
  {
    kind: 'tribuf', name: 'Tri-state buffer', category: 'Gates', prefix: 'U', keywords: ['gate', 'tri-state', 'tristate', 'three state', 'bus', 'high impedance', 'enable'], props: [DELAY],
    shape: () => ({
      pins: [{ name: 'A', x: -30, y: 0, dir: 'in' }, { name: 'Y', x: 30, y: 0, dir: 'out' }, { name: 'EN', x: 0, y: 20, dir: 'in', def: 1 }],
      box: [-15, -15, 15, 15],
      prims: [path('M-15 -15 L-15 15 L15 0 Z'), path('M-30 0 H-15 M15 0 H30'), path('M0 20 V7')],
    }),
  },
  // ---- combinational blocks
  {
    kind: 'mux', name: 'Multiplexer', category: 'Combinational', prefix: 'U', keywords: ['mux', 'multiplexer', 'select', 'data selector', '2:1', '4:1', '8:1'],
    props: [{ key: 'select', label: 'Select lines (1–3)', default: '1' }, DELAY],
    shape: (p) => {
      const s = propNum(p, 'select', 1, 1, 3)
      return block({
        title: 'MUX', subtitle: `${1 << s}:1`, minW: 60,
        left: Array.from({ length: 1 << s }, (_, i) => ({ name: `D${i}` })),
        right: [{ name: 'Y' }],
        bottom: busNames('S', s, false).map((n) => ({ name: n })),
      })
    },
  },
  {
    kind: 'demux', name: 'Demultiplexer', category: 'Combinational', prefix: 'U', keywords: ['demux', 'demultiplexer', 'select', 'distribute'],
    props: [{ key: 'select', label: 'Select lines (1–3)', default: '1' }, DELAY],
    shape: (p) => {
      const s = propNum(p, 'select', 1, 1, 3)
      return block({
        title: 'DEMUX', subtitle: `1:${1 << s}`, left: [{ name: 'D' }], right: Array.from({ length: 1 << s }, (_, i) => ({ name: `Y${i}` })),
        bottom: busNames('S', s, false).map((n) => ({ name: n })),
      })
    },
  },
  {
    kind: 'decoder', name: 'Decoder', category: 'Combinational', prefix: 'U', keywords: ['decoder', 'demux', 'one-hot', '2 to 4', '3 to 8', 'address', '74138'],
    props: [
      { key: 'bits', label: 'Address bits (1–3)', default: '2' }, { key: 'active', label: 'Outputs active', default: 'high', options: ['high', 'low'] }, DELAY,
    ],
    shape: (p) => {
      const n = propNum(p, 'bits', 2, 1, 3)
      const low = prop(p, 'active', 'high') === 'low'
      return block({
        title: 'DEC', subtitle: `${n}→${1 << n}`, left: busNames('A', n).map((x) => ({ name: x })),
        right: Array.from({ length: 1 << n }, (_, i) => ({ name: `Y${i}`, neg: low })), top: [{ name: 'EN', def: 1 }],
      })
    },
  },
  {
    kind: 'encoder', name: 'Priority encoder', category: 'Combinational', prefix: 'U', keywords: ['encoder', 'priority', '4 to 2', '8 to 3', 'binary'],
    props: [{ key: 'bits', label: 'Output bits (1–3)', default: '2' }, DELAY],
    shape: (p) => {
      const n = propNum(p, 'bits', 2, 1, 3)
      return block({
        title: 'ENC', subtitle: `${1 << n}→${n}`, left: Array.from({ length: 1 << n }, (_, i) => ({ name: `I${i}` })),
        right: [...busNames('A', n).map((x) => ({ name: x })), { name: 'V', label: 'V' }],
      })
    },
  },
  {
    kind: 'bcd7', name: 'BCD to 7-segment decoder', category: 'Combinational', prefix: 'U', keywords: ['bcd', '7 segment', 'seven segment', 'decoder', 'display driver', '7447', '7448'],
    props: [
      { key: 'hex', label: 'Show A–F for 10–15', default: 'no', options: ['no', 'yes'] }, { key: 'active', label: 'Outputs active', default: 'high', options: ['high', 'low'] }, DELAY,
    ],
    shape: () => block({ title: 'BCD', subtitle: '→7seg', left: busNames('D', 4).map((n) => ({ name: n })), right: [...SEGMENT_NAMES].map((n) => ({ name: n })) }),
  },
  // ---- arithmetic
  {
    kind: 'halfadder', name: 'Half adder', category: 'Arithmetic', prefix: 'U', keywords: ['adder', 'half adder', 'sum', 'carry', 'arithmetic'], props: [DELAY],
    shape: () => block({ title: 'HA', left: [{ name: 'A' }, { name: 'B' }], right: [{ name: 'S' }, { name: 'C' }] }),
  },
  {
    kind: 'fulladder', name: 'Full adder', category: 'Arithmetic', prefix: 'U', keywords: ['adder', 'full adder', 'sum', 'carry', 'arithmetic'], props: [DELAY],
    shape: () => block({ title: 'FA', left: [{ name: 'A' }, { name: 'B' }, { name: 'CI' }], right: [{ name: 'S' }, { name: 'CO' }] }),
  },
  {
    kind: 'adder', name: 'N-bit adder', category: 'Arithmetic', prefix: 'U', keywords: ['adder', 'ripple carry', 'sum', 'arithmetic', '4-bit', '74283'],
    props: [bitsProp(), DELAY],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 8)
      return block({
        title: 'ADD', subtitle: `${n} bit`, left: [...busNames('A', n), ...busNames('B', n)].map((x) => ({ name: x })), right: busNames('S', n).map((x) => ({ name: x })),
        top: [{ name: 'CI', def: 0 }], bottom: [{ name: 'CO', dir: 'out' }],
      })
    },
  },
  {
    kind: 'comparator', name: 'Magnitude comparator', category: 'Arithmetic', prefix: 'U', keywords: ['comparator', 'compare', 'magnitude', 'equal', 'greater', 'less', '7485'],
    props: [bitsProp(), DELAY],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 8)
      return block({
        title: 'CMP', left: [...busNames('A', n), ...busNames('B', n)].map((x) => ({ name: x })),
        right: [{ name: 'GT', label: 'A>B' }, { name: 'EQ', label: 'A=B' }, { name: 'LT', label: 'A<B' }],
      })
    },
  },
  // ---- sequential
  {
    kind: 'srlatch', name: 'SR latch', category: 'Sequential', prefix: 'FF', keywords: ['latch', 'sr', 'set reset', 'flip-flop', 'memory', 'nor', 'nand'],
    props: [{ key: 'type', label: 'Built from', default: 'nor', options: ['nor', 'nand'], hint: 'NOR: S and R active high. NAND: S and R active low.' }, DELAY],
    shape: (p) => {
      const low = prop(p, 'type', 'nor') === 'nand'
      return block({ title: 'SR', left: [{ name: 'S', neg: low }, { name: 'R', neg: low }], right: [{ name: 'Q' }, { name: 'QN', label: 'Q', neg: true }] })
    },
  },
  {
    kind: 'dlatch', name: 'D latch', category: 'Sequential', prefix: 'FF', keywords: ['latch', 'd latch', 'transparent', 'gated', 'enable', 'memory'],
    props: [initProp(), DELAY],
    shape: () => block({ title: 'D', subtitle: 'latch', left: [{ name: 'D' }, { name: 'EN', label: 'EN', def: 1 }], right: [{ name: 'Q' }, { name: 'QN', label: 'Q', neg: true }] }),
  },
  {
    kind: 'dff', name: 'D flip-flop', category: 'Sequential', prefix: 'FF', keywords: ['flip-flop', 'dff', 'd type', 'register', 'memory', 'edge', 'set', 'reset', 'enable'],
    props: [edgeProp, initProp(), { key: 'en', label: 'Clock enable pin', default: 'no', options: ['no', 'yes'] }, DELAY],
    shape: (p) => ffShape(p, 'D', [{ name: 'D' }]),
  },
  {
    kind: 'jkff', name: 'JK flip-flop', category: 'Sequential', prefix: 'FF', keywords: ['flip-flop', 'jk', 'toggle', 'memory', 'edge', 'set', 'reset'],
    props: [edgeProp, initProp(), { key: 'en', label: 'Clock enable pin', default: 'no', options: ['no', 'yes'] }, DELAY],
    shape: (p) => ffShape(p, 'JK', [{ name: 'J' }, { name: 'K' }]),
  },
  {
    kind: 'tff', name: 'T flip-flop', category: 'Sequential', prefix: 'FF', keywords: ['flip-flop', 'toggle', 't type', 'divider', 'counter', 'edge'],
    props: [edgeProp, initProp(), { key: 'en', label: 'Clock enable pin', default: 'no', options: ['no', 'yes'] }, DELAY],
    shape: (p) => ffShape(p, 'T', [{ name: 'T', def: 1 }]),
  },
  {
    kind: 'register', name: 'Register', category: 'Sequential', prefix: 'U', keywords: ['register', 'storage', 'parallel load', 'memory', '74374', 'latch'],
    props: [bitsProp(), initProp('Initial value (number)'), DELAY],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 8)
      return block({
        title: 'REG', subtitle: `${n} bit`, left: [...busNames('D', n).map((x) => ({ name: x })), { name: 'CLK', clk: true }, { name: 'EN', def: 1 }, { name: 'CLR', def: 0 }],
        right: busNames('Q', n).map((x) => ({ name: x })),
      })
    },
  },
  {
    kind: 'counter', name: 'Counter', category: 'Sequential', prefix: 'U', keywords: ['counter', 'up down', 'binary', 'modulo', 'load', 'reset', '74163', '74193', 'count'],
    props: [bitsProp(), { key: 'modulus', label: 'Modulus', default: '', hint: 'empty = 2^bits (counts 0 … modulus−1, then wraps)' }, initProp('Initial value (number)'), DELAY],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 8)
      return block({
        title: 'CTR', subtitle: `${n} bit`, left: [...busNames('D', n).map((x) => ({ name: x })), { name: 'CLK', clk: true }],
        right: [...busNames('Q', n).map((x) => ({ name: x })), { name: 'CO' }],
        top: [{ name: 'EN', def: 1 }, { name: 'UP', def: 1 }], bottom: [{ name: 'LD', def: 0 }, { name: 'RST', def: 0 }],
      })
    },
  },
  {
    kind: 'shift', name: 'Shift register', category: 'Sequential', prefix: 'U', keywords: ['shift register', 'serial', 'sipo', 'piso', 'ring counter', 'johnson', '74164', '74194'],
    props: [
      bitsProp(), { key: 'dir', label: 'Shifts', default: 'right', options: ['right', 'left'], hint: 'right: SIN enters the most significant bit' },
      { key: 'parallel', label: 'Parallel load pins', default: 'no', options: ['no', 'yes'] }, { key: 'init', label: 'Initial / reset value (binary)', default: '', hint: 'e.g. 1000, most significant bit first; empty = all 0' }, DELAY,
    ],
    shape: (p) => {
      const n = propNum(p, 'bits', 4, 1, 8)
      const par = prop(p, 'parallel', 'no') === 'yes'
      return block({
        title: 'SHIFT', subtitle: `${n} bit`, left: [...(par ? busNames('D', n).map((x) => ({ name: x })) : []), { name: 'SIN' }, { name: 'CLK', clk: true }],
        right: busNames('Q', n).map((x) => ({ name: x })), top: [{ name: 'EN', def: 1 }], bottom: [...(par ? [{ name: 'LD', def: 0 as const }] : []), { name: 'RST', def: 0 as const }],
      })
    },
  },
  // ---- memory
  {
    kind: 'rom', name: 'ROM', category: 'Memory', prefix: 'U', keywords: ['rom', 'memory', 'lookup table', 'lut', 'read only', 'truth table', 'store'],
    props: [
      { key: 'abits', label: 'Address bits (1–8)', default: '4' }, { key: 'dbits', label: 'Data bits (1–8)', default: '8' },
      { key: 'data', label: 'Contents (hex words, in order)', default: '', multiline: true, hint: 'e.g. 3F 06 5B 4F — missing words read as 0' }, DELAY,
    ],
    shape: (p) => block({
      title: 'ROM', subtitle: `${1 << propNum(p, 'abits', 4, 1, 8)}×${propNum(p, 'dbits', 8, 1, 8)}`,
      left: busNames('A', propNum(p, 'abits', 4, 1, 8)).map((x) => ({ name: x })), right: busNames('D', propNum(p, 'dbits', 8, 1, 8)).map((x) => ({ name: x })),
    }),
  },
  {
    kind: 'ram', name: 'RAM', category: 'Memory', prefix: 'U', keywords: ['ram', 'memory', 'read write', 'store', 'sram'],
    props: [
      { key: 'abits', label: 'Address bits (1–6)', default: '3' }, { key: 'dbits', label: 'Data bits (1–8)', default: '4' },
      { key: 'data', label: 'Initial contents (hex words)', default: '', multiline: true }, DELAY,
    ],
    shape: (p) => {
      const a = propNum(p, 'abits', 3, 1, 6)
      const d = propNum(p, 'dbits', 4, 1, 8)
      return block({
        title: 'RAM', subtitle: `${1 << a}×${d}`, left: [...busNames('A', a), ...busNames('DI', d)].map((x) => ({ name: x })),
        right: busNames('DO', d).map((x) => ({ name: x })), top: [{ name: 'WE', def: 0 }], bottom: [{ name: 'CLK', clk: true }],
      })
    },
  },
  // ---- other
  {
    kind: 'pull', name: 'Pull-up / pull-down', category: 'Other', prefix: 'R', keywords: ['pull up', 'pull down', 'resistor', 'tri-state', 'bus'],
    props: [{ key: 'level', label: 'Pulls the net to', default: '1', options: ['1', '0'] }],
    shape: (p) => ioShape([{ name: 'P', x: 0, y: -10, dir: 'pull' }], [-6, -10, 6, 20], [
      path('M0 -10 V-6 L-5 -3 L5 3 L-5 9 L5 15 L0 18'), text(10, 12, prop(p, 'level', '1') === '1' ? '1' : '0', 10, 'start'),
    ]),
  },
]

/** Flip-flop symbol: data pins on the left, CLK, optional EN; S on top, R below; Q and Q̅ on the right. */
function ffShape(p: Part, title: string, data: PinSpec[]): Shape {
  const falling = prop(p, 'edge', 'rising') === 'falling'
  const en = prop(p, 'en', 'no') === 'yes'
  return block({
    title, left: [...data, { name: 'CLK', clk: true, neg: falling }, ...(en ? [{ name: 'EN', def: 1 as const }] : [])],
    right: [{ name: 'Q' }, { name: 'QN', label: 'Q', neg: true }], top: [{ name: 'S', def: 0 }], bottom: [{ name: 'R', def: 0 }],
  })
}

export const KIND_DEFS: Record<Kind, KindDef> = Object.fromEntries(CATALOGUE.map((d) => [d.kind, d])) as Record<Kind, KindDef>
export const KIND_LIST: KindDef[] = CATALOGUE
export const CATEGORIES: Category[] = ['Inputs', 'Outputs', 'Gates', 'Combinational', 'Arithmetic', 'Sequential', 'Memory', 'Other']

export const defOf = (p: Part | Kind): KindDef => KIND_DEFS[typeof p === 'string' ? p : p.kind]
export const isSource = (k: Kind): boolean => KIND_DEFS[k].role === 'source'
export const isSink = (k: Kind): boolean => KIND_DEFS[k].role === 'sink'

export function defaultProps(kind: Kind): Record<string, string> {
  const o: Record<string, string> = {}
  for (const pr of KIND_DEFS[kind].props) o[pr.key] = pr.default
  return o
}

export const shapeOf = (p: Part): Shape => KIND_DEFS[p.kind].shape(p)

// ------------------------------------------------------------------------------ geometry

/** Local point → world: mirror (x → −x), then rotation (clockwise on screen), then the part's position. */
export function toWorld(p: Pick<Part, 'x' | 'y' | 'rot' | 'mirror'>, lx: number, ly: number): { x: number; y: number } {
  let x = p.mirror ? -lx : lx
  let y = ly
  for (let i = 0; i < p.rot / 90; i++) { const t = x; x = -y; y = t }
  return { x: p.x + x, y: p.y + y }
}

export interface PinPos { name: string; label?: string; dir: PinDef['dir']; x: number; y: number }

export function pinPositions(p: Part): PinPos[] {
  return shapeOf(p).pins.map((d) => ({ name: d.name, label: d.label, dir: d.dir, ...toWorld(p, d.x, d.y) }))
}

export function partBounds(p: Part): { x1: number; y1: number; x2: number; y2: number } {
  const [a, b, c, d] = shapeOf(p).box
  const q1 = toWorld(p, a, b)
  const q2 = toWorld(p, c, d)
  return { x1: Math.min(q1.x, q2.x), y1: Math.min(q1.y, q2.y), x2: Math.max(q1.x, q2.x), y2: Math.max(q1.y, q2.y) }
}

/** Bounds including the pin stubs. */
export function partExtent(p: Part): { x1: number; y1: number; x2: number; y2: number } {
  const b = partBounds(p)
  let { x1, y1, x2, y2 } = b
  for (const pp of pinPositions(p)) { x1 = Math.min(x1, pp.x); y1 = Math.min(y1, pp.y); x2 = Math.max(x2, pp.x); y2 = Math.max(y2, pp.y) }
  return { x1, y1, x2, y2 }
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

export function nextRef(doc: Doc, prefix: string): string {
  const used = new Set(doc.parts.map((p) => p.ref))
  for (let i = 1; i < 100000; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`
  return `${prefix}?`
}

/** The next free signal name for an input (A, B, C…) or an output (Y, Z, …). */
export function nextSignalName(doc: Doc, kind: Kind): string {
  const used = new Set(doc.parts.map((p) => p.props.name).filter(Boolean))
  const input = isSource(kind)
  const letters = input ? 'ABCDEFGHIJKLMNOPQRSTUVWX' : 'YZWVUTSRQPONMLKJ'
  for (const c of letters) if (!used.has(c)) return c
  for (let i = 1; ; i++) { const n = `${input ? 'In' : 'Out'}${i}`; if (!used.has(n)) return n }
}

export function newPart(doc: Doc, kind: Kind, x: number, y: number, init: Partial<Part> = {}): Part {
  const def = KIND_DEFS[kind]
  const props = defaultProps(kind)
  if (def.role && 'name' in props && !init.props?.name) props.name = nextSignalName(doc, kind)
  if (kind === 'clock' && !init.props?.name) props.name = 'CLK'
  return { id: newId('p'), kind, ref: nextRef(doc, def.prefix), x: snap(x), y: snap(y), rot: 0, mirror: false, ...init, props: { ...props, ...(init.props ?? {}) } }
}

export const ROT_NEXT: Record<Rot, Rot> = { 0: 90, 90: 180, 180: 270, 270: 0 }

/** The name shown for a part: its signal name for inputs and outputs. */
export const signalName = (p: Part): string => (p.props.name?.trim() ? p.props.name.trim() : '')

/** Where the reference text goes (world coordinates, plus the text anchor). */
export function labelPosition(p: Part): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const b = partBounds(p)
  return { x: (b.x1 + b.x2) / 2, y: b.y1 - 5, anchor: 'middle' }
}

/** Where an input / output's signal name goes: above the body. */
export function namePosition(p: Part): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const b = partBounds(p)
  return { x: (b.x1 + b.x2) / 2, y: b.y1 - 6, anchor: 'middle' }
}
