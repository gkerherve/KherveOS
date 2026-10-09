// The built-in example circuits as .kdig files (pure). Each one is built with the Builder, with the stimulus and
// probes for its timing diagram. tools/export_kdigital_examples.ts writes them to public/examples/kdigital/; the
// tests simulate every one and check the behaviour the description promises.

import { Builder } from './builder.ts'
import { parse } from './expr.ts'
import { analyse, parseFunctions } from './truth.ts'
import { addLogic, connectTap, expressionsToDoc } from './layout.ts'
import { fsmToCircuit, sequenceDetector, type Fsm } from './fsm.ts'
import { canonicalIds, type KdigFile, type Step } from './file.ts'
import { snap } from './model.ts'

export interface Example {
  id: string
  title: string
  group: string
  description: string
  build(): KdigFile
}

let lastBuilder: Builder | null = null

/** The builder of the example that was built last (the tests compare the drawing with what it meant to connect). */
export const lastBuilt = (): Builder | null => lastBuilder

const file = (name: string, description: string, b: Builder, extra: Partial<KdigFile> = {}): KdigFile => {
  lastBuilder = b
  return { format: 'kdig', version: 1, name, description, tab: 'circuit', circuit: canonicalIds(b.build()), ...extra }
}

const seq = (names: string[], rows: (number | string)[][], dt: number, t0 = 0): Step[] =>
  rows.map((row, i) => ({ t: t0 + i * dt, set: Object.fromEntries(names.map((n, k) => [n, row[k]])) }))

const bitsOf = (n: number, w: number): number[] => Array.from({ length: w }, (_, i) => (n >> (w - 1 - i)) & 1)

// ------------------------------------------------------------------------------ basics

function halfAdder(): KdigFile {
  const b = new Builder()
  const A = b.add('switch', 0, 0, { name: 'A' })
  const B = b.add('switch', 0, 80, { name: 'B' })
  const X = b.add('xor', 140, 20)
  const N = b.add('and', 140, 100)
  const S = b.add('led', 260, 20, { name: 'S', color: 'green' })
  const C = b.add('led', 260, 100, { name: 'C', color: 'red' })
  b.fan(`${A}.Y`, [`${X}.A`, `${N}.A`])
  b.fan(`${B}.Y`, [`${X}.B`, `${N}.B`])
  b.link(`${X}.Y`, `${S}.A`)
  b.link(`${N}.Y`, `${C}.A`)
  b.note(0, -40, 'Half adder: S = A xor B (sum), C = A and B (carry)')
  return file('Half adder', 'Adds two bits: an XOR gives the sum, an AND gives the carry. Click the switches.', b, {
    stimulus: seq(['A', 'B'], [[0, 0], [0, 1], [1, 0], [1, 1]], 20), until: 80,
  })
}

function fullAdder(): KdigFile {
  const b = new Builder()
  const A = b.add('switch', 0, 0, { name: 'A' })
  const B = b.add('switch', 0, 60, { name: 'B' })
  const CI = b.add('switch', 0, 150, { name: 'Cin' })
  const X1 = b.add('xor', 150, 30)
  const A1 = b.add('and', 150, 130)
  const X2 = b.add('xor', 300, 50)
  const A2 = b.add('and', 300, 150)
  const O = b.add('or', 420, 120)
  const S = b.add('led', 420, 50, { name: 'S', color: 'green' })
  const CO = b.add('led', 520, 120, { name: 'Cout', color: 'red' })
  b.fan(`${A}.Y`, [`${X1}.A`, `${A1}.A`])
  b.fan(`${B}.Y`, [`${X1}.B`, `${A1}.B`])
  b.link(`${X1}.Y`, `${X2}.A`)
  b.link(`${X1}.Y`, `${A2}.A`, { label: 'x' })
  b.link(`${CI}.Y`, `${X2}.B`, { label: 'cin' })
  b.link(`${CI}.Y`, `${A2}.B`, { label: 'cin' })
  b.link(`${X2}.Y`, `${S}.A`)
  b.link(`${A1}.Y`, `${O}.A`, { label: 'g' })
  b.link(`${A2}.Y`, `${O}.B`)
  b.link(`${O}.Y`, `${CO}.A`)
  b.note(0, -40, 'Full adder: S = A xor B xor Cin, Cout = AB + Cin(A xor B)')
  return file('Full adder', 'Two half adders and an OR: adds A, B and a carry-in. All eight input combinations are in the timing diagram.', b, {
    stimulus: seq(['A', 'B', 'Cin'], Array.from({ length: 8 }, (_, i) => bitsOf(i, 3)), 20), until: 160,
  })
}

function ripple4(): KdigFile {
  const b = new Builder()
  const names = ['A3', 'A2', 'A1', 'A0', 'B3', 'B2', 'B1', 'B0']
  names.forEach((n, i) => { const r = b.add('switch', 0, i * 40, { name: n }); b.tie(`${r}.Y`, n, 20) })
  const ci = b.add('switch', 0, 8 * 40 + 20, { name: 'Cin' })
  b.tie(`${ci}.Y`, 'Cin', 20)
  const fa: string[] = []
  for (let i = 0; i < 4; i++) {
    const x = 240 + i * 170
    const ref = b.add('fulladder', x, 60)
    fa.push(ref)
    b.tie(`${ref}.A`, `A${i}`, 20)
    b.tie(`${ref}.B`, `B${i}`, 20)
    if (i === 0) b.tie(`${ref}.CI`, 'Cin', 20)
    else b.link(`${fa[i - 1]}.CO`, `${ref}.CI`)
    b.tie(`${ref}.S`, `S${i}`, 20)
  }
  const co = b.add('led', 240 + 4 * 170 - 60, 60, { name: 'Cout', color: 'red' })
  b.link(`${fa[3]}.CO`, `${co}.A`)
  // the sum on LEDs and on a seven-segment display (hex)
  for (let i = 0; i < 4; i++) {
    const led = b.add('led', 300 + i * 100, 300, { name: `S${3 - i}`, color: 'green' })
    b.tie(`${led}.A`, `S${3 - i}`, 20)
  }
  const dec = b.add('bcd7', 240, 480, { hex: 'yes' })
  ;['S3', 'S2', 'S1', 'S0'].forEach((n, i) => b.tie(`${dec}.D${3 - i}`, n, 20))
  const seg = b.add('seg7', 420, 480, { name: 'SUM' })
  ;['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((s) => b.link(`${dec}.${s}`, `${seg}.${s}`))
  const bp = b.add('probe', 600, 480, { name: 'Sum', bits: '5', radix: 'decimal' })
  ;['Cout', 'S3', 'S2', 'S1', 'S0'].forEach((n, i) => b.tie(`${bp}.B${4 - i}`, n, 20))
  b.tie(`${fa[3]}.CO`, 'Cout', 20)
  b.note(240, 0, '4-bit ripple-carry adder: the carry of each full adder feeds the next one')
  const stim: Step[] = []
  const pairs: [number, number, number][] = [[0, 0, 0], [3, 4, 0], [7, 1, 0], [9, 6, 0], [15, 1, 0], [15, 15, 1], [8, 8, 0], [5, 10, 1]]
  pairs.forEach(([a, c, ci0], i) => {
    const set: Record<string, number> = { Cin: ci0 }
    bitsOf(a, 4).forEach((v, k) => { set[`A${3 - k}`] = v })
    bitsOf(c, 4).forEach((v, k) => { set[`B${3 - k}`] = v })
    stim.push({ t: i * 60, set })
  })
  return file('4-bit ripple-carry adder', 'A + B + Cin on four full adders: the sum on LEDs, on a 7-segment display (hex) and as a bus in the timing diagram. The carry ripples through, one gate delay at a time.', b, {
    stimulus: stim, until: 8 * 60,
    probes: [
      { name: 'A', bits: ['A3', 'A2', 'A1', 'A0'], radix: 'decimal' }, { name: 'B', bits: ['B3', 'B2', 'B1', 'B0'], radix: 'decimal' }, { name: 'Cin', bits: ['Cin'] },
      { name: 'Sum', bits: ['Cout', 'S3', 'S2', 'S1', 'S0'], radix: 'decimal' }, { name: 'Cout', bits: ['Cout'] },
    ],
  })
}

function mux2(): KdigFile {
  const b = new Builder()
  const D0 = b.add('switch', 0, 0, { name: 'D0' })
  const D1 = b.add('switch', 0, 100, { name: 'D1' })
  const S = b.add('switch', 0, 200, { name: 'S' })
  const N = b.add('not', 110, 200)
  const A0 = b.add('and', 250, 10)
  const A1 = b.add('and', 250, 110)
  const O = b.add('or', 370, 60)
  const Y = b.add('led', 470, 60, { name: 'Y', color: 'green' })
  b.link(`${S}.Y`, `${N}.A`)
  b.link(`${S}.Y`, `${A1}.B`, { label: 'S' })
  b.link(`${N}.Y`, `${A0}.B`)
  b.link(`${D0}.Y`, `${A0}.A`)
  b.link(`${D1}.Y`, `${A1}.A`)
  b.link(`${A0}.Y`, `${O}.A`)
  b.link(`${A1}.Y`, `${O}.B`)
  b.link(`${O}.Y`, `${Y}.A`)
  b.note(0, -40, '2:1 multiplexer: Y = D0·S\' + D1·S')
  return file('2:1 multiplexer', 'S picks which data input reaches Y. Built from a NOT, two ANDs and an OR.', b, {
    stimulus: seq(['D0', 'D1', 'S'], [[0, 1, 0], [0, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0], [0, 0, 1]], 20), until: 120,
  })
}

function mux4(): KdigFile {
  const expr = parse("!S1 & !S0 & D0 | !S1 & S0 & D1 | S1 & !S0 & D2 | S1 & S0 & D3", { splitUpper: false })
  const b = expressionsToDoc([{ name: 'Y', expr }], 'as-is').builder
  b.note(-10, -80, '4:1 multiplexer: Y = S1\'S0\'D0 + S1\'S0 D1 + S1 S0\' D2 + S1 S0 D3')
  const stim: Step[] = []
  const times = [[1, 0, 1, 0, 0, 0], [1, 0, 1, 0, 0, 1], [1, 0, 1, 0, 1, 0], [1, 0, 1, 0, 1, 1]]
  times.forEach((row, i) => stim.push({ t: i * 20, set: { D0: row[0], D1: row[1], D2: row[2], D3: row[3], S1: row[4], S0: row[5] } }))
  return file('4:1 multiplexer', 'Two select lines choose one of four data inputs: four AND gates and an OR. The mux block in the palette does the same in one part.', b, {
    stimulus: stim, until: 80, boolean: { text: 'Y = !S1 & !S0 & D0 | !S1 & S0 & D1 | S1 & !S0 & D2 | S1 & S0 & D3', style: 'as-is' },
  })
}

// ------------------------------------------------------------------------------ memory

function srLatch(): KdigFile {
  const b = new Builder()
  const R = b.add('switch', 0, 0, { name: 'R' })
  const S = b.add('switch', 0, 170, { name: 'S' })
  const N1 = b.add('nor', 240, 40)
  const N2 = b.add('nor', 240, 130)
  const Q = b.add('led', 420, 40, { name: 'Q', color: 'green' })
  const QN = b.add('led', 420, 130, { name: 'QN', color: 'red' })
  b.link(`${R}.Y`, `${N1}.A`)
  b.link(`${S}.Y`, `${N2}.B`)
  // Q feeds the lower gate, QN the upper gate: the two wires cross
  b.route(`${N1}.Y`, `${N2}.A`, [[300, 40], [300, 85], [200, 85], [200, 120]])
  b.route(`${N2}.Y`, `${N1}.B`, [[330, 130], [330, 70], [190, 70], [190, 50]])
  b.route(`${N1}.Y`, `${Q}.A`, [[300, 40]])
  b.route(`${N2}.Y`, `${QN}.A`, [[330, 130]])
  b.note(0, -50, 'SR latch from two NOR gates (Q = NOR(R, QN), QN = NOR(S, Q))')
  b.note(0, 230, 'S=1: set. R=1: reset. S=R=0: remember. S=R=1: forbidden (both outputs 0).')
  const steps: Step[] = [
    { t: 0, set: { S: 0, R: 0 } },
    { t: 20, set: { S: 1 } }, // set
    { t: 40, set: { S: 0 } }, // hold 1
    { t: 60, set: { R: 1 } }, // reset
    { t: 80, set: { R: 0 } }, // hold 0
    { t: 100, set: { S: 1, R: 1 } }, // forbidden: Q = QN = 0
    { t: 120, set: { R: 0 } }, // release R first: the latch is set
    { t: 140, set: { S: 0 } },
  ]
  return file('SR latch from NOR gates', 'The simplest memory: two cross-coupled NOR gates. Set it, reset it, then press S and R together to see the forbidden state (both outputs 0).', b, { stimulus: steps, until: 170 })
}

function dLatchNand(b: Builder, x: number, y: number, dTie: string, enTie: string, qTie: string, qnTie: string): void {
  const nD = b.add('not', x + 30, y + 10)
  const s = b.add('nand', x + 110, y - 40)
  const r = b.add('nand', x + 110, y + 50)
  const q = b.add('nand', x + 270, y - 40)
  const qn = b.add('nand', x + 270, y + 50)
  b.tie(`${nD}.A`, dTie, 20)
  b.tie(`${s}.A`, dTie, 20)
  b.tie(`${s}.B`, enTie, 20)
  b.tie(`${r}.B`, enTie, 20)
  b.link(`${nD}.Y`, `${r}.A`)
  b.link(`${s}.Y`, `${q}.A`)
  b.link(`${r}.Y`, `${qn}.B`)
  // the cross-coupling: Q feeds the lower gate, QN the upper one
  b.route(`${q}.Y`, `${qn}.A`, [[x + 320, y - 40], [x + 320, y + 5], [x + 220, y + 5], [x + 220, y + 40]])
  b.route(`${qn}.Y`, `${q}.B`, [[x + 340, y + 50], [x + 340, y - 5], [x + 210, y - 5], [x + 210, y - 30]])
  b.tieAt(`${q}.Y`, [x + 320, y - 40], [1, 0], qTie, 20)
  b.tieAt(`${qn}.Y`, [x + 340, y + 50], [1, 0], qnTie, 20)
}

function dffMasterSlave(): KdigFile {
  const b = new Builder()
  const D = b.add('switch', 0, 0, { name: 'D' })
  b.tie(`${D}.Y`, 'D', 20)
  const CK = b.add('clock', 0, 120, { name: 'CLK', period: '40' })
  b.tie(`${CK}.Y`, 'CLK', 20)
  const inv = b.add('not', 120, 190)
  b.tie(`${inv}.A`, 'CLK', 20)
  b.tie(`${inv}.Y`, 'CLKn', 20)
  dLatchNand(b, 220, 60, 'D', 'CLKn', 'Qm', 'Qmn')
  dLatchNand(b, 740, 60, 'Qm', 'CLK', 'Q', 'Qn')
  const lm = b.add('led', 600, 230, { name: 'Qm', color: 'yellow' })
  b.tie(`${lm}.A`, 'Qm', 20)
  const lq = b.add('led', 1180, 70, { name: 'Q', color: 'green' })
  b.tie(`${lq}.A`, 'Q', 20)
  const lqn = b.add('led', 1180, 130, { name: 'Qn', color: 'red' })
  b.tie(`${lqn}.A`, 'Qn', 20)
  b.note(220, -30, 'Master latch (open while CLK = 0)')
  b.note(740, -30, 'Slave latch (open while CLK = 1)')
  b.note(0, 290, 'Master–slave D flip-flop from NAND gates: Q takes D on the rising clock edge.')
  const d: Step[] = [[0, 1], [50, 0], [130, 1], [170, 0], [210, 1], [250, 1], [290, 0]].map(([t, v]) => ({ t, set: { D: v } }))
  return file('D flip-flop from NAND gates (master–slave)', 'Two gated D latches back to back: the master follows D while CLK is low, the slave copies it while CLK is high, so Q only changes on the rising edge.', b, {
    stimulus: d, until: 340, sim: { delayMode: 'unit' },
    probes: [{ name: 'CLK', bits: ['CLK'] }, { name: 'D', bits: ['D'] }, { name: 'Qm (master)', bits: ['Qm'] }, { name: 'Q', bits: ['Q'] }],
  })
}

// ------------------------------------------------------------------------------ counters and registers

function counter7seg(): KdigFile {
  const b = new Builder()
  const ck = b.add('clock', 0, 0, { name: 'CLK', period: '20' })
  b.tie(`${ck}.Y`, 'CLK', 20)
  const rst = b.add('button', 0, 70, { name: 'RST' })
  b.tie(`${rst}.Y`, 'RST', 20)
  const ff: string[] = []
  for (let i = 0; i < 4; i++) {
    const y = 40 + i * 140
    const t = b.add('tff', 360, y, { name: '' })
    ff.push(t)
    b.tie(`${t}.CLK`, 'CLK', 20)
    b.tie(`${t}.R`, 'RST', 20)
    b.tie(`${t}.Q`, `Q${i}`, 20)
  }
  // T0 = 1 (a constant), T1 = Q0, T2 = Q0 Q1, T3 = Q0 Q1 Q2
  const one = b.add('const', 240, 40, { value: '1', name: '' })
  b.link(`${one}.Y`, `${ff[0]}.T`)
  b.tie(`${ff[1]}.T`, 'Q0', 20)
  const a2 = b.add('and', 200, 40 + 2 * 140 - 10)
  b.tie(`${a2}.A`, 'Q0', 20); b.tie(`${a2}.B`, 'Q1', 20)
  b.link(`${a2}.Y`, `${ff[2]}.T`)
  const a3 = b.add('and', 200, 40 + 3 * 140 - 10, { inputs: '3' })
  b.tie(`${a3}.A`, 'Q0', 20); b.tie(`${a3}.B`, 'Q1', 20); b.tie(`${a3}.C`, 'Q2', 20)
  b.link(`${a3}.Y`, `${ff[3]}.T`)
  const dec = b.add('bcd7', 640, 260, { hex: 'yes' })
  ;['Q3', 'Q2', 'Q1', 'Q0'].forEach((n, i) => b.tie(`${dec}.D${3 - i}`, n, 20))
  const seg = b.add('seg7', 820, 260, { name: 'COUNT' })
  ;['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((s) => b.link(`${dec}.${s}`, `${seg}.${s}`))
  const bp = b.add('probe', 640, 480, { name: 'Count', bits: '4', radix: 'decimal' })
  ;['Q3', 'Q2', 'Q1', 'Q0'].forEach((n, i) => b.tie(`${bp}.B${3 - i}`, n, 20))
  b.note(0, -50, '4-bit synchronous counter from T flip-flops: T0=1, T1=Q0, T2=Q0·Q1, T3=Q0·Q1·Q2')
  b.note(0, 620, 'All flip-flops share CLK; RST clears them.')
  return file('4-bit synchronous counter with 7-segment display', 'Four T flip-flops count 0…15 and wrap; a BCD/hex decoder drives the 7-segment digit. Press RST to clear.', b, {
    stimulus: [{ t: 0, set: { RST: 1 } }, { t: 8, set: { RST: 0 } }], until: 360,
    probes: [{ name: 'CLK', bits: ['CLK'] }, { name: 'Q3', bits: ['Q3'] }, { name: 'Q2', bits: ['Q2'] }, { name: 'Q1', bits: ['Q1'] }, { name: 'Q0', bits: ['Q0'] }, { name: 'count', bits: ['Q3', 'Q2', 'Q1', 'Q0'], radix: 'decimal' }],
  })
}

function shiftRegister(): KdigFile {
  const b = new Builder()
  const sin = b.add('switch', 0, 0, { name: 'SIN' })
  const ck = b.add('clock', 0, 130, { name: 'CLK', period: '20' })
  b.tie(`${ck}.Y`, 'CLK', 20)
  const ff: string[] = []
  for (let i = 0; i < 4; i++) {
    const t = b.add('dff', 200 + i * 170, 20, { init: '0', name: '' })
    ff.push(t)
    b.tie(`${t}.CLK`, 'CLK', 20)
    const led = b.add('led', 200 + i * 170, 150, { name: `Q${i}`, color: i % 2 ? 'yellow' : 'green' })
    b.tie(`${t}.Q`, `Q${i}`, 20)
    b.tie(`${led}.A`, `Q${i}`, 20)
  }
  b.link(`${sin}.Y`, `${ff[0]}.D`)
  for (let i = 0; i < 3; i++) b.link(`${ff[i]}.Q`, `${ff[i + 1]}.D`)
  b.note(0, -50, '4-bit serial-in shift register: every clock edge moves the data one flip-flop to the right')
  const pattern = [1, 0, 1, 1, 0, 0, 0, 0]
  return file('4-bit shift register', 'Four D flip-flops in a row: the bit on SIN moves one place per clock. Watch 1011 travel through.', b, {
    stimulus: pattern.map((v, i) => ({ t: i * 20, set: { SIN: v } })), until: 190,
    probes: [{ name: 'CLK', bits: ['CLK'] }, { name: 'SIN', bits: ['SIN'] }, ...[0, 1, 2, 3].map((i) => ({ name: `Q${i}`, bits: [`${ff[i]}.Q`] }))],
  })
}

function ringCounter(): KdigFile {
  const b = new Builder()
  const ck = b.add('clock', 0, 60, { name: 'CLK', period: '20' })
  b.tie(`${ck}.Y`, 'CLK', 20)
  const rst = b.add('button', 0, 150, { name: 'RST' })
  b.tie(`${rst}.Y`, 'RST', 20)
  // ring counter: one 1 circulates
  const ring = b.add('shift', 240, 60, { bits: '4', dir: 'right', init: '1000' })
  b.tie(`${ring}.CLK`, 'CLK', 20)
  b.tie(`${ring}.RST`, 'RST', 20)
  b.tie(`${ring}.SIN`, 'R0', 20)
  b.tie(`${ring}.Q0`, 'R0', 20)
  ;[3, 2, 1, 0].forEach((q, i) => {
    const led = b.add('led', 440 + 0, 0 + i * 40, { name: `R${q}`, color: 'green' })
    b.tie(`${ring}.Q${q}`, `R${q}x`, 20)
    b.tie(`${led}.A`, `R${q}x`, 20)
  })
  // Johnson (twisted ring) counter: SIN is the inverse of the last stage
  const jo = b.add('shift', 240, 300, { bits: '4', dir: 'right', init: '0000' })
  b.tie(`${jo}.CLK`, 'CLK', 20)
  b.tie(`${jo}.RST`, 'RST', 20)
  const inv = b.add('not', 100, 290)
  b.tie(`${inv}.A`, 'J0', 20)
  b.tie(`${jo}.Q0`, 'J0', 20)
  b.link(`${inv}.Y`, `${jo}.SIN`, { label: 'Jin' })
  ;[3, 2, 1, 0].forEach((q, i) => {
    const led = b.add('led', 440, 240 + i * 40, { name: `J${q}`, color: 'yellow' })
    b.tie(`${jo}.Q${q}`, `J${q}x`, 20)
    b.tie(`${led}.A`, `J${q}x`, 20)
  })
  b.note(200, -50, 'Ring counter: 1000 → 0100 → 0010 → 0001 → 1000 …')
  b.note(200, 190, 'Johnson (twisted-ring) counter: 8 states from 4 flip-flops')
  return file('Ring and Johnson counters', 'A shift register fed back on itself. The ring counter circulates a single 1 (4 states); the Johnson counter feeds back the inverse of the last stage (8 states). RST goes back to the start.', b, {
    stimulus: [{ t: 0, set: { RST: 1 } }, { t: 8, set: { RST: 0 } }], until: 320,
    probes: [
      { name: 'CLK', bits: ['CLK'] },
      { name: 'ring', bits: [`${ring}.Q3`, `${ring}.Q2`, `${ring}.Q1`, `${ring}.Q0`], radix: 'binary' },
      { name: 'johnson', bits: [`${jo}.Q3`, `${jo}.Q2`, `${jo}.Q1`, `${jo}.Q0`], radix: 'binary' },
    ],
  })
}

// ------------------------------------------------------------------------------ arithmetic

function alu4(): KdigFile {
  const b = new Builder()
  const names = ['A3', 'A2', 'A1', 'A0', 'B3', 'B2', 'B1', 'B0']
  names.forEach((n, i) => { const r = b.add('switch', 0, i * 40, { name: n }); b.tie(`${r}.Y`, n, 20) })
  const ci = b.add('switch', 0, 340, { name: 'Cin' }); b.tie(`${ci}.Y`, 'Cin', 20)
  const s1 = b.add('switch', 0, 400, { name: 'S1' }); b.tie(`${s1}.Y`, 'S1', 20)
  const s0 = b.add('switch', 0, 460, { name: 'S0' }); b.tie(`${s0}.Y`, 'S0', 20)
  const fa: string[] = []
  for (let bit = 0; bit < 4; bit++) {
    const y = 40 + bit * 150
    const g1 = b.add('and', 260, y - 40)
    const g2 = b.add('or', 260, y + 10)
    const g3 = b.add('xor', 260, y + 60)
    const add = b.add('fulladder', 260, y + 110)
    fa.push(add)
    b.tie(`${g1}.A`, `A${bit}`, 20); b.tie(`${g1}.B`, `B${bit}`, 20)
    b.tie(`${g2}.A`, `A${bit}`, 20); b.tie(`${g2}.B`, `B${bit}`, 20)
    b.tie(`${g3}.A`, `A${bit}`, 20); b.tie(`${g3}.B`, `B${bit}`, 20)
    b.tie(`${add}.A`, `A${bit}`, 20); b.tie(`${add}.B`, `B${bit}`, 20)
    if (bit === 0) b.tie(`${add}.CI`, 'Cin', 20)
    else b.tie(`${add}.CI`, `c${bit}`, 20)
    b.tie(`${add}.CO`, `c${bit + 1}`, 20)
    const m = b.add('mux', 480, y + 30, { select: '2' })
    b.link(`${g1}.Y`, `${m}.D0`)
    b.link(`${g2}.Y`, `${m}.D1`)
    b.link(`${g3}.Y`, `${m}.D2`)
    b.tie(`${add}.S`, `sum${bit}`, 20)
    b.tie(`${m}.D3`, `sum${bit}`, 20)
    b.tie(`${m}.S0`, 'S0', 20)
    b.tie(`${m}.S1`, 'S1', 20)
    const led = b.add('led', 620, y + 30, { name: `F${bit}`, color: 'green' })
    b.link(`${m}.Y`, `${led}.A`)
  }
  const co = b.add('led', 620, 40 + 4 * 150, { name: 'Cout', color: 'red' })
  b.tie(`${co}.A`, 'c4', 20)
  b.note(240, -50, '4-bit ALU: S1 S0 = 00 AND, 01 OR, 10 XOR, 11 ADD (with carry in and out)')
  const stim: Step[] = []
  const rows: [number, number, number, number][] = [[6, 3, 0, 0], [6, 3, 1, 0], [6, 3, 2, 0], [6, 3, 3, 0], [9, 7, 3, 0], [15, 1, 3, 0], [9, 7, 3, 1]]
  rows.forEach(([a, c, op, cin], i) => {
    const set: Record<string, number> = { Cin: cin, S1: op >> 1, S0: op & 1 }
    bitsOf(a, 4).forEach((v, k) => { set[`A${3 - k}`] = v })
    bitsOf(c, 4).forEach((v, k) => { set[`B${3 - k}`] = v })
    stim.push({ t: i * 50, set })
  })
  return file('4-bit ALU (add / and / or / xor)', 'Four identical bit slices: AND, OR, XOR and a full adder feed a 4:1 multiplexer chosen by S1 S0; the carry ripples through the adders.', b, {
    stimulus: stim, until: rows.length * 50,
    probes: [
      { name: 'A', bits: ['A3', 'A2', 'A1', 'A0'], radix: 'decimal' }, { name: 'B', bits: ['B3', 'B2', 'B1', 'B0'], radix: 'decimal' },
      { name: 'S1', bits: ['S1'] }, { name: 'S0', bits: ['S0'] }, { name: 'F', bits: ['F3', 'F2', 'F1', 'F0'].map((n) => n), radix: 'decimal' },
    ],
  })
}

// ------------------------------------------------------------------------------ minimisation

function bcd7seg(): KdigFile {
  const text = [
    '# BCD → 7-segment: D3 D2 D1 D0 are the BCD digit (0–9); 10–15 never occur, so they are don\'t-cares',
    'a(D3,D2,D1,D0) = Σm(0,2,3,5,6,7,8,9) + d(10,11,12,13,14,15)',
    'b(D3,D2,D1,D0) = Σm(0,1,2,3,4,7,8,9) + d(10,11,12,13,14,15)',
    'c(D3,D2,D1,D0) = Σm(0,1,3,4,5,6,7,8,9) + d(10,11,12,13,14,15)',
    'd(D3,D2,D1,D0) = Σm(0,2,3,5,6,8,9) + d(10,11,12,13,14,15)',
    'e(D3,D2,D1,D0) = Σm(0,2,6,8) + d(10,11,12,13,14,15)',
    'f(D3,D2,D1,D0) = Σm(0,4,5,6,8,9) + d(10,11,12,13,14,15)',
    'g(D3,D2,D1,D0) = Σm(2,3,4,5,6,8,9) + d(10,11,12,13,14,15)',
  ].join('\n')
  const fs = parseFunctions(text)
  const outputs = fs.table.outputs.map((o) => ({ name: o.name, expr: analyse(fs.table.vars, o.name, o.values).min.sopNode }))
  const b = new Builder()
  const res = addLogic(b, outputs, { x0: 0, y0: 0, makeInputs: true, vars: ['D3', 'D2', 'D1', 'D0'] })
  const seg = b.add('seg7', snap(res.right + 160), 80, { name: 'DIGIT' })
  outputs.forEach((o) => connectTap(b, res.taps[o.name], `${seg}.${o.name}`))
  b.note(0, -50, 'BCD-to-7-segment decoder: each segment is the minimal sum of products found with a Karnaugh map')
  const stim: Step[] = Array.from({ length: 10 }, (_, d) => ({ t: d * 20, set: Object.fromEntries(bitsOf(d, 4).map((v, k) => [`D${3 - k}`, v])) }))
  return file('BCD to 7-segment decoder (K-map minimised)', 'Seven functions of four variables with don\'t-cares for the unused codes 10–15, minimised by Quine–McCluskey (open the Boolean tab to see the K-maps) and drawn as gates.', b, {
    tab: 'boolean', stimulus: stim, until: 200, boolean: { text, style: 'sop', focus: 'a' },
    probes: [{ name: 'digit', bits: ['D3', 'D2', 'D1', 'D0'], radix: 'decimal' }, ...outputs.map((o) => ({ name: o.name, bits: [`${seg}.${o.name}`] }))],
  })
}

function majority(): KdigFile {
  const expr = parse('A&B | A&C | B&C')
  const b = expressionsToDoc([{ name: 'M', expr }], 'as-is').builder
  b.note(-10, -80, 'Majority voter: M = AB + AC + BC (a 2-out-of-3 vote)')
  return file('Majority voter (K-map)', 'The output is 1 when at least two of the three inputs are 1. The K-map shows three overlapping pairs — and why this cover has no hazards.', b, {
    tab: 'boolean', boolean: { text: 'M(A,B,C) = Σm(3,5,6,7)', style: 'as-is', focus: 'M' },
    stimulus: seq(['A', 'B', 'C'], Array.from({ length: 8 }, (_, i) => bitsOf(i, 3)), 20), until: 160,
  })
}

function parity(): KdigFile {
  const b = new Builder()
  ;['D3', 'D2', 'D1', 'D0'].forEach((n, i) => { const r = b.add('switch', 0, i * 50, { name: n }); b.tie(`${r}.Y`, n, 20) })
  const err = b.add('switch', 0, 250, { name: 'FAULT' }); b.tie(`${err}.Y`, 'FAULT', 20)
  // generator
  const g1 = b.add('xor', 200, 30)
  const g2 = b.add('xor', 200, 130)
  const g3 = b.add('xor', 340, 80)
  b.tie(`${g1}.A`, 'D3', 20); b.tie(`${g1}.B`, 'D2', 20)
  b.tie(`${g2}.A`, 'D1', 20); b.tie(`${g2}.B`, 'D0', 20)
  b.link(`${g1}.Y`, `${g3}.A`)
  b.link(`${g2}.Y`, `${g3}.B`)
  const pled = b.add('led', 460, 80, { name: 'P', color: 'yellow' })
  b.link(`${g3}.Y`, `${pled}.A`)
  b.tie(`${g3}.Y`, 'P', 20)
  // the line: a fault flips D0
  const ft = b.add('xor', 200, 250)
  b.tie(`${ft}.A`, 'D0', 20); b.tie(`${ft}.B`, 'FAULT', 20)
  b.tie(`${ft}.Y`, 'D0r', 20)
  // checker
  const c1 = b.add('xor', 600, 30)
  const c2 = b.add('xor', 600, 130)
  const c3 = b.add('xor', 740, 80)
  const c4 = b.add('xor', 860, 100)
  b.tie(`${c1}.A`, 'D3', 20); b.tie(`${c1}.B`, 'D2', 20)
  b.tie(`${c2}.A`, 'D1', 20); b.tie(`${c2}.B`, 'D0r', 20)
  b.link(`${c1}.Y`, `${c3}.A`)
  b.link(`${c2}.Y`, `${c3}.B`)
  b.link(`${c3}.Y`, `${c4}.A`)
  b.tie(`${c4}.B`, 'P', 20)
  const eled = b.add('led', 980, 100, { name: 'ERROR', color: 'red' })
  b.link(`${c4}.Y`, `${eled}.A`)
  b.note(160, -20, 'Even-parity generator: P = D3 xor D2 xor D1 xor D0')
  b.note(560, -20, 'Checker: ERROR = 1 when the received word has odd parity')
  b.note(160, 200, 'FAULT flips D0 on the way (a single-bit error)')
  const rows: [number, number][] = [[0b1011, 0], [0b1011, 1], [0b0110, 0], [0b0110, 1], [0b1111, 0], [0b1111, 1]]
  return file('Parity generator and checker', 'P makes the number of 1s even. The checker XORs all five bits: ERROR lights up when a single bit is flipped (use FAULT) — and misses double errors.', b, {
    stimulus: rows.map(([d, f], i) => ({ t: i * 30, set: { D3: (d >> 3) & 1, D2: (d >> 2) & 1, D1: (d >> 1) & 1, D0: d & 1, FAULT: f } })), until: rows.length * 30,
  })
}

// ------------------------------------------------------------------------------ state machines

function trafficFsm(): Fsm {
  return {
    name: 'Traffic light', type: 'moore', inputs: ['T'], outputs: ['NS_R', 'NS_Y', 'NS_G', 'EW_R', 'EW_Y', 'EW_G'], encoding: 'binary',
    states: [
      { id: 'a', name: 'NS_GREEN', x: 120, y: 120, out: '001100', initial: true },
      { id: 'b', name: 'NS_YELLOW', x: 420, y: 120, out: '010100' },
      { id: 'c', name: 'EW_GREEN', x: 420, y: 330, out: '100001' },
      { id: 'd', name: 'EW_YELLOW', x: 120, y: 330, out: '100010' },
    ],
    transitions: [
      { id: 't0', from: 'a', to: 'a', cond: '0', out: '', bend: 0 }, { id: 't1', from: 'a', to: 'b', cond: '1', out: '', bend: 0 },
      { id: 't2', from: 'b', to: 'b', cond: '0', out: '', bend: 0 }, { id: 't3', from: 'b', to: 'c', cond: '1', out: '', bend: 0 },
      { id: 't4', from: 'c', to: 'c', cond: '0', out: '', bend: 0 }, { id: 't5', from: 'c', to: 'd', cond: '1', out: '', bend: 0 },
      { id: 't6', from: 'd', to: 'd', cond: '0', out: '', bend: 0 }, { id: 't7', from: 'd', to: 'a', cond: '1', out: '', bend: 0 },
    ],
  }
}

function trafficLight(): KdigFile {
  const fsm = trafficFsm()
  const impl = fsmToCircuit(fsm)
  const b = impl.builder
  const stim: Step[] = [{ t: 0, set: { RST: 1 } }, { t: 8, set: { RST: 0 } }]
  // T pulses: the timer expires every other clock
  for (let k = 0; k < 12; k++) stim.push({ t: 20 * k + 2, set: { T: k % 2 === 1 ? 1 : 0 } })
  return file('Traffic-light controller (Moore FSM)', 'Four states, a timer input T and six lamp outputs that depend only on the state (Moore). The FSM tab has the diagram, the state table and the equations; this circuit is its D-flip-flop implementation.', b, {
    tab: 'fsm', fsm, stimulus: stim, until: 260, probes: impl.probes,
  })
}

function detector1011(): KdigFile {
  const fsm = sequenceDetector('1011', { overlap: true, type: 'mealy' })
  fsm.name = '1011 detector (Mealy)'
  const impl = fsmToCircuit(fsm)
  const b = impl.builder
  const bits = '0110101101101011110'
  const stim: Step[] = [{ t: 0, set: { RST: 1 } }, { t: 8, set: { RST: 0 } }]
  bits.split('').forEach((c, i) => stim.push({ t: 20 * i + 2, set: { X: Number(c) } }))
  return file('1011 sequence detector (Mealy FSM, with overlap)', 'Output Y goes to 1 at the same clock edge that completes 1011 (a Mealy output), and overlapping matches such as 1011011 are found twice. The timing diagram shows the input stream and Y.', b, {
    tab: 'fsm', fsm, stimulus: stim, until: 20 * bits.length + 10, probes: impl.probes,
  })
}

// ------------------------------------------------------------------------------ hazards

function hazardCircuit(fixed: boolean): KdigFile {
  const b = new Builder()
  const A = b.add('switch', 0, 0, { name: 'A', value: '1' })
  const B = b.add('switch', 0, 120, { name: 'B', value: '1' })
  const C = b.add('switch', 0, 200, { name: 'C', value: '1' })
  b.tie(`${A}.Y`, 'A', 20); b.tie(`${B}.Y`, 'B', 20); b.tie(`${C}.Y`, 'C', 20)
  const inv = b.add('not', 140, 40)
  b.tie(`${inv}.A`, 'A', 20)
  b.tie(`${inv}.Y`, 'An', 20)
  const g1 = b.add('and', 300, 40)
  b.tie(`${g1}.A`, 'A', 20); b.tie(`${g1}.B`, 'B', 20)
  const g2 = b.add('and', 300, 130)
  b.tie(`${g2}.A`, 'An', 20); b.tie(`${g2}.B`, 'C', 20)
  const orIn = fixed ? 3 : 2
  const o = b.add('or', 460, 100, fixed ? { inputs: '3' } : {})
  b.link(`${g1}.Y`, `${o}.A`)
  b.link(`${g2}.Y`, `${o}.B`)
  if (fixed) {
    const g3 = b.add('and', 300, 220)
    b.tie(`${g3}.A`, 'B', 20); b.tie(`${g3}.B`, 'C', 20)
    b.link(`${g3}.Y`, `${o}.C`)
    b.note(260, 270, 'Consensus term BC covers the gap between AB and A\'C')
  }
  void orIn
  const F = b.add('led', 580, 100, { name: 'F', color: 'green' })
  b.link(`${o}.Y`, `${F}.A`)
  b.tie(`${o}.Y`, 'Fnet', 20)
  b.note(0, -50, fixed ? 'F = AB + A\'C + BC  (hazard-free: the redundant term BC holds the output)' : 'F = AB + A\'C  (static-1 hazard when A falls with B = C = 1)')
  const stim: Step[] = [
    { t: 0, set: { A: 1, B: 1, C: 1 } },
    { t: 20, set: { A: 0 } },
    { t: 40, set: { A: 1 } },
    { t: 60, set: { A: 0 } },
  ]
  return file(fixed ? 'Hazard fixed with a consensus term' : 'Static-1 hazard (glitch)', fixed
    ? 'The same function with the redundant term BC added: with B = C = 1 one AND gate always stays on, so F no longer glitches when A changes.'
    : 'With B = C = 1 the output should stay 1 while A toggles, but the inverter makes A\' arrive one gate delay late: both AND gates are 0 for an instant and F glitches. Zoom into the timing diagram.', b, {
    stimulus: stim, until: 90, sim: { delayMode: 'unit', inertial: true },
    boolean: { text: 'F = A&B | !A&C' + (fixed ? ' | B&C' : ''), style: 'as-is', focus: 'F' },
    probes: [{ name: 'A', bits: ['A'] }, { name: "A'", bits: ['An'] }, { name: 'AB', bits: [`${g1}.Y`] }, { name: "A'C", bits: [`${g2}.Y`] }, { name: 'F', bits: ['Fnet'] }],
  })
}

function ringOscillator(): KdigFile {
  const b = new Builder()
  const en = b.add('switch', 0, 100, { name: 'EN', value: '0' })
  const nd = b.add('nand', 140, 100)
  const n2 = b.add('not', 300, 100)
  const n3 = b.add('not', 440, 100)
  b.link(`${en}.Y`, `${nd}.A`)
  b.link(`${nd}.Y`, `${n2}.A`)
  b.link(`${n2}.Y`, `${n3}.A`)
  b.route(`${n3}.Y`, `${nd}.B`, [[520, 100], [520, 180], [90, 180], [90, 110], [110, 110]])
  const led = b.add('led', 620, 100, { name: 'OUT', color: 'green' })
  b.route(`${n3}.Y`, `${led}.A`, [[520, 100]])
  b.tie(`${n3}.Y`, 'ring', 20)
  b.note(0, 20, 'Ring oscillator: three inversions in a loop never settle.')
  b.note(0, 215, 'Set EN = 1: the loop oscillates with period 6 gate delays (kDigital reports the oscillation).')
  return file('Ring oscillator', 'A NAND and two inverters in a loop. With EN = 0 the loop is held; with EN = 1 it oscillates — the simulator notices and tells you.', b, {
    stimulus: [{ t: 0, set: { EN: 0 } }, { t: 30, set: { EN: 1 } }], until: 200, probes: [{ name: 'EN', bits: ['EN'] }, { name: 'OUT', bits: ['ring'] }],
  })
}

function triStateBus(): KdigFile {
  const b = new Builder()
  const a = b.add('switch', 0, 0, { name: 'A' })
  const ea = b.add('switch', 0, 70, { name: 'ENA' })
  const c = b.add('switch', 0, 160, { name: 'B' })
  const eb = b.add('switch', 0, 230, { name: 'ENB' })
  const t1 = b.add('tribuf', 160, 30)
  const t2 = b.add('tribuf', 160, 190)
  b.link(`${a}.Y`, `${t1}.A`)
  b.link(`${ea}.Y`, `${t1}.EN`, { label: 'ENA' })
  b.link(`${c}.Y`, `${t2}.A`)
  b.link(`${eb}.Y`, `${t2}.EN`, { label: 'ENB' })
  b.tie(`${t1}.Y`, 'BUS', 20)
  b.tie(`${t2}.Y`, 'BUS', 20)
  const pu = b.add('pull', 420, 140, { level: '1' })
  b.tie(`${pu}.P`, 'BUS', 20)
  const led = b.add('led', 380, 40, { name: 'BUS', color: 'green' })
  b.tie(`${led}.A`, 'BUS', 20)
  b.note(0, -50, 'Two tri-state buffers share one bus line; a pull-up gives the line a level when nobody drives it')
  const rows = [[1, 1, 0, 0, 0], [0, 1, 1, 0, 0], [0, 0, 1, 0, 1], [0, 1, 1, 1, 1], [1, 1, 0, 1, 1], [0, 1, 0, 0, 0]]
  return file('Tri-state bus with a pull-up', 'Only one buffer may drive the bus at a time. With both disabled the line floats (Z) and the pull-up makes it 1; with both enabled and different data you get a conflict (X).', b, {
    stimulus: seq(['A', 'ENA', 'B', 'ENB'], rows.map((r) => r.slice(0, 4)), 25), until: 25 * rows.length,
    probes: [{ name: 'A', bits: ['A'] }, { name: 'ENA', bits: ['ENA'] }, { name: 'B', bits: ['B'] }, { name: 'ENB', bits: ['ENB'] }, { name: 'BUS', bits: ['BUS'] }],
  })
}

function romDigits(): KdigFile {
  const b = new Builder()
  ;['A3', 'A2', 'A1', 'A0'].forEach((n, i) => { const r = b.add('switch', 0, i * 50, { name: n }); b.tie(`${r}.Y`, n, 20) })
  // segments g f e d c b a as a 7-bit word: bit 6 = a … bit 0 = g
  const words = ['7E', '30', '6D', '79', '33', '5B', '5F', '70', '7F', '7B', '77', '1F', '4E', '3D', '4F', '47']
  const rom = b.add('rom', 240, 80, { abits: '4', dbits: '7', data: words.join(' ') })
  ;['A3', 'A2', 'A1', 'A0'].forEach((n, i) => b.tie(`${rom}.A${3 - i}`, n, 20))
  const seg = b.add('seg7', 540, 80, { name: 'DIGIT' })
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  order.forEach((s, i) => b.link(`${rom}.D${6 - i}`, `${seg}.${s}`))
  b.note(0, -50, 'A ROM as a lookup table: 16 words of 7 bits drive a 7-segment display (hexadecimal digits)')
  return file('ROM lookup table for a 7-segment display', 'The four switches are the address; the ROM word is the segment pattern. Edit the contents in the Properties panel to draw your own symbols.', b, {
    stimulus: Array.from({ length: 16 }, (_, n) => ({ t: n * 20, set: Object.fromEntries(bitsOf(n, 4).map((v, k) => [`A${3 - k}`, v])) })), until: 320,
    probes: [{ name: 'address', bits: ['A3', 'A2', 'A1', 'A0'], radix: 'hex' }, { name: 'word', bits: [6, 5, 4, 3, 2, 1, 0].map((i) => `${rom}.D${i}`), radix: 'hex' }],
  })
}

function qmcWorkbench(): KdigFile {
  const text = [
    '# Quine–McCluskey with don\'t-cares (a standard textbook example)',
    'F(A,B,C,D) = Σm(4,8,10,11,12,15) + d(9,14)',
    'G(A,B,C,D) = Σm(0,1,2,5,6,7,8,9,10,14)',
  ].join('\n')
  const fs = parseFunctions(text)
  const outs = fs.table.outputs.map((o) => ({ name: o.name, expr: analyse(fs.table.vars, o.name, o.values).min.sopNode }))
  const b2 = expressionsToDoc(outs, 'sop').builder
  return file('Minimisation with don\'t-cares (Quine–McCluskey)', 'Two four-variable functions: F has don\'t-cares (click a truth-table output to cycle 0 → 1 → X). See the prime-implicant chart, the K-map groups and the minimal SOP and POS.', b2, {
    tab: 'boolean', boolean: { text, style: 'sop', focus: 'F' },
  })
}

function numberWorkbench(): KdigFile {
  const b = new Builder()
  b.note(0, 0, 'The Numbers tab shows an integer in every representation,\nIEEE-754 bit fields (click a bit to flip it) and\nbinary arithmetic step by step.')
  return file('Number systems and IEEE-754', 'Open the Numbers tab: type a number and see binary, octal, hex, two\'s complement, Gray, BCD, fixed point and the IEEE-754 half / single / double bit fields.', b, {
    tab: 'numbers', numbers: { value: '-118.625', base: 10, bits: 8 },
  })
}

// ------------------------------------------------------------------------------ the list

export const EXAMPLES: Example[] = [
  { id: 'half-adder', title: 'Half adder', group: 'Basics', description: 'XOR and AND add two bits.', build: halfAdder },
  { id: 'full-adder', title: 'Full adder', group: 'Basics', description: 'Two half adders and an OR add three bits.', build: fullAdder },
  { id: 'mux-2to1', title: '2:1 multiplexer', group: 'Basics', description: 'A select line picks one of two inputs.', build: mux2 },
  { id: 'mux-4to1', title: '4:1 multiplexer', group: 'Basics', description: 'Two select lines pick one of four inputs.', build: mux4 },
  { id: 'adder-4bit', title: '4-bit ripple-carry adder', group: 'Arithmetic', description: 'Four full adders with a 7-segment sum.', build: ripple4 },
  { id: 'alu-4bit', title: '4-bit ALU (add / and / or / xor)', group: 'Arithmetic', description: 'Four bit slices and a mux per bit.', build: alu4 },
  { id: 'sr-latch', title: 'SR latch from NOR gates', group: 'Memory', description: 'Cross-coupled NORs and the forbidden state.', build: srLatch },
  { id: 'dff-master-slave', title: 'D flip-flop from NAND gates (master–slave)', group: 'Memory', description: 'Two gated latches make an edge-triggered flip-flop.', build: dffMasterSlave },
  { id: 'counter-7seg', title: '4-bit synchronous counter with 7-segment display', group: 'Counters and registers', description: 'T flip-flops count 0…15 and wrap.', build: counter7seg },
  { id: 'shift-register', title: '4-bit shift register', group: 'Counters and registers', description: 'Serial in, bits move one place per clock.', build: shiftRegister },
  { id: 'ring-johnson', title: 'Ring and Johnson counters', group: 'Counters and registers', description: 'A shift register fed back on itself.', build: ringCounter },
  { id: 'rom-7seg', title: 'ROM lookup table for a 7-segment display', group: 'Counters and registers', description: 'A ROM as a truth table.', build: romDigits },
  { id: 'bcd-7seg', title: 'BCD to 7-segment decoder (K-map minimised)', group: 'Minimisation', description: 'Seven functions with don\'t-cares, minimised.', build: bcd7seg },
  { id: 'majority', title: 'Majority voter (K-map)', group: 'Minimisation', description: 'Two out of three, with its Karnaugh map.', build: majority },
  { id: 'qmc-dont-care', title: 'Minimisation with don\'t-cares (Quine–McCluskey)', group: 'Minimisation', description: 'Prime implicants, chart, K-map and POS.', build: qmcWorkbench },
  { id: 'parity', title: 'Parity generator and checker', group: 'Minimisation', description: 'XOR trees detect a single-bit error.', build: parity },
  { id: 'traffic-light', title: 'Traffic-light controller (Moore FSM)', group: 'State machines', description: 'Four states, six lamps, a timer input.', build: trafficLight },
  { id: 'detector-1011', title: '1011 sequence detector (Mealy FSM, with overlap)', group: 'State machines', description: 'Finds 1011 in a bit stream, overlaps included.', build: detector1011 },
  { id: 'hazard', title: 'Static-1 hazard (glitch)', group: 'Hazards and delays', description: 'A glitch caused by unequal gate delays.', build: () => hazardCircuit(false) },
  { id: 'hazard-fixed', title: 'Hazard fixed with a consensus term', group: 'Hazards and delays', description: 'A redundant AND term removes the glitch.', build: () => hazardCircuit(true) },
  { id: 'ring-oscillator', title: 'Ring oscillator', group: 'Hazards and delays', description: 'An odd number of inversions oscillates.', build: ringOscillator },
  { id: 'tristate-bus', title: 'Tri-state bus with a pull-up', group: 'Hazards and delays', description: 'Shared line: Z, X and pull-ups.', build: triStateBus },
  { id: 'numbers', title: 'Number systems and IEEE-754', group: 'Numbers', description: 'Representations, bit fields, arithmetic.', build: numberWorkbench },
]

export const exampleById = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id)
