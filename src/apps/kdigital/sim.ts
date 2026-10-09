// The logic simulator: event-driven, four-valued (0 1 X Z), with unit / per-part / zero delays, inertial or
// transport delay, tri-state nets with pull-ups, clocks, oscillation detection and a recorded history of every
// net for the timing diagram. Pure (no React, no DOM).

import { HEX_SEGMENTS, SEGMENT_NAMES, isSink, isSource, propNum, shapeOf, signalName, type Doc, type Kind, type Part } from './model.ts'
import { extractNets, pinKey, resolveTarget, type Extracted, type Problem } from './netlist.ts'
import { numberOf, resolve, sense, vand, vnot, vor, vparse, vxor, type V } from './logic.ts'

export interface SimSettings {
  /** unit: every part takes `unitDelay`; gate: each part's own delay (empty = unitDelay); zero: no delays (delta cycles) */
  delayMode: 'unit' | 'gate' | 'zero'
  unitDelay: number
  /** inertial delay swallows pulses shorter than the delay; transport passes everything */
  inertial: boolean
  /** delta cycles allowed at one instant before the zero-delay circuit is declared oscillating */
  maxDelta: number
  /** label of one time unit */
  unit: string
}

export const DEFAULT_SIM: SimSettings = { delayMode: 'unit', unitDelay: 1, inertial: true, maxDelta: 500, unit: 'ns' }

/** The valid settings of a file, only those it names. */
export function readPartialSettings(raw: unknown): Partial<SimSettings> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s: Partial<SimSettings> = {}
  if (o.delayMode === 'unit' || o.delayMode === 'gate' || o.delayMode === 'zero') s.delayMode = o.delayMode
  if (typeof o.unitDelay === 'number' && o.unitDelay >= 1 && o.unitDelay <= 1000) s.unitDelay = Math.round(o.unitDelay)
  if (typeof o.inertial === 'boolean') s.inertial = o.inertial
  if (typeof o.maxDelta === 'number' && o.maxDelta >= 10 && o.maxDelta <= 100000) s.maxDelta = Math.round(o.maxDelta)
  if (typeof o.unit === 'string' && o.unit.length <= 4 && o.unit) s.unit = o.unit
  return s
}

export function readSettings(raw: unknown): SimSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = { ...DEFAULT_SIM }
  if (o.delayMode === 'unit' || o.delayMode === 'gate' || o.delayMode === 'zero') s.delayMode = o.delayMode
  if (typeof o.unitDelay === 'number' && o.unitDelay >= 1 && o.unitDelay <= 1000) s.unitDelay = Math.round(o.unitDelay)
  if (typeof o.inertial === 'boolean') s.inertial = o.inertial
  if (typeof o.maxDelta === 'number' && o.maxDelta >= 10 && o.maxDelta <= 100000) s.maxDelta = Math.round(o.maxDelta)
  if (typeof o.unit === 'string' && o.unit.length <= 4 && o.unit) s.unit = o.unit
  return s
}

interface Ev { t: number; comp: number; out: number; v: V; dead: boolean }

type Getter = (pin: string) => V
type Setter = (pin: string, v: V) => void

export interface Comp {
  idx: number
  part: Part
  kind: Kind
  ins: string[]
  inPos: Record<string, number>
  inNet: number[]
  inDef: (V | undefined)[]
  outs: string[]
  outPos: Record<string, number>
  outNet: number[]
  delay: number
  /* eslint-disable @typescript-eslint/no-explicit-any */
  p: Record<string, any>
  st: Record<string, any>
  /* eslint-enable @typescript-eslint/no-explicit-any */
  drv: V[]
  target: V[]
  pend: Ev[][]
  get: Getter
  set: Setter
}

interface Beh {
  init?(c: Comp): void
  /** outputs that are in place at time 0 (stored state), without delay */
  preset?(c: Comp, set: Setter): void
  eval?(c: Comp, g: Getter, o: Setter, sim: Simulator): void
}

// ------------------------------------------------------------------------------ helpers for behaviours

const bus = (g: Getter, prefix: string, n: number): V[] => Array.from({ length: n }, (_, i) => sense(g(`${prefix}${i}`)))
const putBus = (o: Setter, prefix: string, vals: readonly V[]) => vals.forEach((v, i) => o(`${prefix}${i}`, v))
const unknownBits = (n: number): V[] => new Array<V>(n).fill(2)
const bitsFromNumber = (x: number, n: number): V[] => Array.from({ length: n }, (_, i) => ((Math.floor(x / 2 ** i) & 1) as V))

function parseInitBit(text: string | undefined, def: V): V {
  const s = (text ?? '').trim().toUpperCase()
  if (s === '' ) return def
  return vparse(s)
}

function edge(c: Comp, clk: V, falling = false): boolean {
  const prev = c.st.clk as V
  c.st.clk = clk
  return falling ? prev === 1 && clk === 0 : prev === 0 && clk === 1
}

export function parseMemory(text: string, words: number, bits: number): number[] {
  const out = new Array<number>(words).fill(0)
  const max = 2 ** bits
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  for (let i = 0; i < parts.length && i < words; i++) {
    const raw = parts[i].replace(/^0x/i, '').replace(/^h/i, '')
    const n = /^[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : 0
    out[i] = n % max
  }
  return out
}

const gateFn: Partial<Record<Kind, (v: V[]) => V>> = {
  buf: (v) => (sense(v[0]) as V), not: (v) => vnot(sense(v[0])),
  and: vand, or: vor, xor: vxor,
  nand: (v) => vnot(vand(v)), nor: (v) => vnot(vor(v)), xnor: (v) => vnot(vxor(v)),
}

const BEH: Partial<Record<Kind, Beh>> = {}

for (const kind of ['buf', 'not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor'] as Kind[]) {
  BEH[kind] = {
    eval: (c, g, o) => {
      const f = gateFn[kind]!
      o('Y', f(c.ins.map((n) => sense(g(n)))))
    },
  }
}

BEH.tribuf = {
  eval: (_c, g, o) => {
    const en = sense(g('EN'))
    const a = sense(g('A'))
    o('Y', en === 1 ? a : en === 0 ? 3 : 2)
  },
}

BEH.mux = {
  eval: (c, g, o) => {
    const s = c.p.sel as number
    const data = Array.from({ length: 1 << s }, (_, i) => sense(g(`D${i}`)))
    const sel = bus(g, 'S', s)
    const k = numberOf(sel)
    if (k !== null) o('Y', data[k])
    else o('Y', data.every((d) => d === data[0] && d < 2) ? data[0] : 2)
  },
}

BEH.demux = {
  eval: (c, g, o) => {
    const s = c.p.sel as number
    const d = sense(g('D'))
    const k = numberOf(bus(g, 'S', s))
    for (let i = 0; i < 1 << s; i++) o(`Y${i}`, k === null ? (d === 0 ? 0 : 2) : k === i ? d : 0)
  },
}

BEH.decoder = {
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const low = c.p.low as boolean
    const en = sense(g('EN'))
    const k = numberOf(bus(g, 'A', n))
    for (let i = 0; i < 1 << n; i++) {
      let y: V
      if (en === 0) y = 0
      else if (k === null || en === 2) y = en === 1 || en === 2 ? 2 : 0
      else y = k === i ? 1 : 0
      o(`Y${i}`, low ? vnot(y) : y)
    }
  },
}

BEH.encoder = {
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const inputs = Array.from({ length: 1 << n }, (_, i) => sense(g(`I${i}`)))
    let code = 0
    let valid: V = 0
    let unknown = false
    for (let i = inputs.length - 1; i >= 0; i--) {
      if (inputs[i] === 1) { code = i; valid = 1; break }
      if (inputs[i] === 2) { unknown = true; break }
    }
    if (unknown) { putBus(o, 'A', unknownBits(n)); o('V', 2); return }
    putBus(o, 'A', bitsFromNumber(code, n))
    o('V', valid)
  },
}

BEH.bcd7 = {
  eval: (c, g, o) => {
    const k = numberOf(bus(g, 'D', 4))
    const low = c.p.low as boolean
    for (const s of SEGMENT_NAMES) {
      let y: V
      if (k === null) y = 2
      else y = (k < 10 || c.p.hex) && HEX_SEGMENTS[k].includes(s) ? 1 : 0
      o(s, low ? vnot(y) : y)
    }
  },
}

BEH.halfadder = {
  eval: (_c, g, o) => {
    const a = sense(g('A')), b = sense(g('B'))
    o('S', vxor([a, b])); o('C', vand([a, b]))
  },
}

BEH.fulladder = {
  eval: (_c, g, o) => {
    const a = sense(g('A')), b = sense(g('B')), ci = sense(g('CI'))
    o('S', vxor([a, b, ci])); o('CO', vor([vand([a, b]), vand([ci, vxor([a, b])])]))
  },
}

BEH.adder = {
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const a = bus(g, 'A', n), b = bus(g, 'B', n)
    let carry = sense(g('CI'))
    const s: V[] = []
    for (let i = 0; i < n; i++) {
      s.push(vxor([a[i], b[i], carry]))
      carry = vor([vand([a[i], b[i]]), vand([carry, vxor([a[i], b[i]])])])
    }
    putBus(o, 'S', s)
    o('CO', carry)
  },
}

BEH.comparator = {
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const a = bus(g, 'A', n), b = bus(g, 'B', n)
    for (let i = n - 1; i >= 0; i--) {
      if (a[i] > 1 || b[i] > 1) { o('GT', 2); o('EQ', 2); o('LT', 2); return }
      if (a[i] !== b[i]) { const gt = a[i] > b[i]; o('GT', gt ? 1 : 0); o('EQ', 0); o('LT', gt ? 0 : 1); return }
    }
    o('GT', 0); o('EQ', 1); o('LT', 0)
  },
}

// ---- latches and flip-flops

BEH.srlatch = {
  init: (c) => { c.st = { q: 2, forb: false } },
  eval: (c, g, o) => {
    const nand = c.p.nand as boolean
    let s = sense(g('S')), r = sense(g('R'))
    if (nand) { s = vnot(s); r = vnot(r) }
    const st = c.st
    let q = st.q as V
    let forbidden = false
    if (s === 1 && r === 1) { forbidden = true; st.forb = true }
    else if (s === 1 && r === 0) { q = 1; st.forb = false }
    else if (s === 0 && r === 1) { q = 0; st.forb = false }
    else if (s === 0 && r === 0) { if (st.forb) { q = 2; st.forb = false } }
    else q = 2
    st.q = q
    if (forbidden) { const v: V = nand ? 1 : 0; o('Q', v); o('QN', v) } else { o('Q', q); o('QN', vnot(q)) }
  },
}

BEH.dlatch = {
  init: (c) => { c.st = { q: parseInitBit(c.part.props.init, 0) } },
  preset: (c, set) => { set('Q', c.st.q); set('QN', vnot(c.st.q)) },
  eval: (c, g, o) => {
    const en = sense(g('EN')), d = sense(g('D'))
    let q = c.st.q as V
    if (en === 1) q = d
    else if (en !== 0 && q !== d) q = 2
    c.st.q = q
    o('Q', q); o('QN', vnot(q))
  },
}

function flipflop(next: (c: Comp, g: Getter, q: V) => V): Beh {
  return {
    init: (c) => { c.st = { q: parseInitBit(c.part.props.init, 0), clk: 2 } },
    preset: (c, set) => { set('Q', c.st.q); set('QN', vnot(c.st.q)) },
    eval: (c, g, o) => {
      const clk = sense(g('CLK'))
      const hit = edge(c, clk, c.p.falling as boolean)
      const s = sense(g('S')), r = sense(g('R'))
      let q = c.st.q as V
      if (s === 1 && r === 1) q = 2
      else if (s === 1) q = 1
      else if (r === 1) q = 0
      else if (s !== 0 || r !== 0) q = 2
      else if (hit) {
        const en = c.p.hasEn ? sense(g('EN')) : 1
        const n = next(c, g, q)
        if (en === 1) q = n
        else if (en !== 0 && n !== q) q = 2
      }
      c.st.q = q
      o('Q', q); o('QN', vnot(q))
    },
  }
}

BEH.dff = flipflop((_c, g) => sense(g('D')))
BEH.jkff = flipflop((_c, g, q) => {
  const j = sense(g('J')), k = sense(g('K'))
  if (j === 0 && k === 0) return q
  if (j === 1 && k === 0) return 1
  if (j === 0 && k === 1) return 0
  if (j === 1 && k === 1) return vnot(q)
  return 2
})
BEH.tff = flipflop((_c, g, q) => {
  const t = sense(g('T'))
  return t === 0 ? q : t === 1 ? vnot(q) : 2
})

BEH.register = {
  init: (c) => {
    const n = c.p.bits as number
    const v = Number(c.part.props.init)
    c.st = { q: Number.isFinite(v) ? bitsFromNumber(v, n) : bitsFromNumber(0, n), clk: 2 }
  },
  preset: (c, set) => putBus(set, 'Q', c.st.q),
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const hit = edge(c, sense(g('CLK')))
    const clr = sense(g('CLR'))
    let q = c.st.q as V[]
    if (clr === 1) q = bitsFromNumber(Number(c.part.props.init) || 0, n)
    else if (clr !== 0) q = unknownBits(n)
    else if (hit) {
      const en = sense(g('EN'))
      const d = bus(g, 'D', n)
      if (en === 1) q = d
      else if (en !== 0) q = q.map((b, i) => (b === d[i] ? b : 2) as V)
    }
    c.st.q = q
    putBus(o, 'Q', q)
  },
}

BEH.counter = {
  init: (c) => {
    const n = c.p.bits as number
    const m = c.p.mod as number
    const v = Number(c.part.props.init)
    c.st = { q: Number.isFinite(v) ? ((Math.round(v) % m) + m) % m : 0, clk: 2 }
    void n
  },
  preset: (c, set) => putBus(set, 'Q', c.st.q === null ? unknownBits(c.p.bits) : bitsFromNumber(c.st.q, c.p.bits)),
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const m = c.p.mod as number
    const hit = edge(c, sense(g('CLK')))
    const rst = sense(g('RST'))
    let q = c.st.q as number | null
    const en = sense(g('EN'))
    const up = sense(g('UP'))
    if (rst === 1) q = ((Math.round(Number(c.part.props.init) || 0) % m) + m) % m
    else if (rst !== 0) q = null
    else if (hit) {
      const ld = sense(g('LD'))
      if (ld === 1) { const k = numberOf(bus(g, 'D', n)); q = k === null ? null : k % m }
      else if (ld !== 0) q = null
      else if (en === 1) {
        if (q !== null) q = up === 1 ? (q + 1) % m : up === 0 ? (q - 1 + m) % m : null
      } else if (en !== 0) q = null
    }
    c.st.q = q
    putBus(o, 'Q', q === null ? unknownBits(n) : bitsFromNumber(q, n))
    if (q === null) o('CO', 2)
    else {
      const terminal = up === 1 ? q === m - 1 : up === 0 ? q === 0 : null
      o('CO', terminal === null ? 2 : en === 1 ? (terminal ? 1 : 0) : en === 0 ? 0 : 2)
    }
  },
}

function shiftInit(c: Comp): V[] {
  const n = c.p.bits as number
  const text = (c.part.props.init ?? '').trim()
  if (!text) return bitsFromNumber(0, n)
  const bits = text.replace(/[^01xXzZ]/g, '').padStart(n, '0').slice(-n)
  return Array.from({ length: n }, (_, i) => vparse(bits[n - 1 - i]))
}

BEH.shift = {
  init: (c) => { c.st = { q: shiftInit(c), clk: 2 } },
  preset: (c, set) => putBus(set, 'Q', c.st.q),
  eval: (c, g, o) => {
    const n = c.p.bits as number
    const hit = edge(c, sense(g('CLK')))
    const rst = sense(g('RST'))
    let q = c.st.q as V[]
    if (rst === 1) q = shiftInit(c)
    else if (rst !== 0) q = unknownBits(n)
    else if (hit) {
      const en = sense(g('EN'))
      const ld = c.p.parallel ? sense(g('LD')) : 0
      let next: V[]
      if (ld === 1) next = bus(g, 'D', n)
      else {
        const sin = sense(g('SIN'))
        next = c.p.right ? [...q.slice(1), sin] : [sin, ...q.slice(0, n - 1)]
      }
      if (en === 1) q = next
      else if (en !== 0) q = q.map((b, i) => (b === next[i] ? b : 2) as V)
    }
    c.st.q = q
    putBus(o, 'Q', q)
  },
}

BEH.rom = {
  init: (c) => { c.st = { mem: parseMemory(c.part.props.data ?? '', 1 << c.p.abits, c.p.dbits) } },
  eval: (c, g, o) => {
    const k = numberOf(bus(g, 'A', c.p.abits))
    putBus(o, 'D', k === null ? unknownBits(c.p.dbits) : bitsFromNumber((c.st.mem as number[])[k] ?? 0, c.p.dbits))
  },
}

BEH.ram = {
  init: (c) => { c.st = { mem: parseMemory(c.part.props.data ?? '', 1 << c.p.abits, c.p.dbits) as (number | null)[], clk: 2 } },
  eval: (c, g, o) => {
    const a = numberOf(bus(g, 'A', c.p.abits))
    const hit = edge(c, sense(g('CLK')))
    const mem = c.st.mem as (number | null)[]
    if (hit) {
      const we = sense(g('WE'))
      if (we === 1) {
        if (a !== null) mem[a] = numberOf(bus(g, 'DI', c.p.dbits))
        else mem.fill(null)
      } else if (we !== 0) {
        if (a !== null) mem[a] = null
        else mem.fill(null)
      }
    }
    if (a === null) putBus(o, 'DO', unknownBits(c.p.dbits))
    else { const w = mem[a]; putBus(o, 'DO', w === null || w === undefined ? unknownBits(c.p.dbits) : bitsFromNumber(w, c.p.dbits)) }
  },
}

function params(p: Part): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  switch (p.kind) {
    case 'mux': case 'demux': out.sel = propNum(p, 'select', 1, 1, 3); break
    case 'decoder': out.bits = propNum(p, 'bits', 2, 1, 3); out.low = p.props.active === 'low'; break
    case 'encoder': out.bits = propNum(p, 'bits', 2, 1, 3); break
    case 'bcd7': out.hex = p.props.hex === 'yes'; out.low = p.props.active === 'low'; break
    case 'adder': case 'comparator': case 'register': out.bits = propNum(p, 'bits', 4, 1, 8); break
    case 'counter': {
      const bits = propNum(p, 'bits', 4, 1, 8)
      out.bits = bits
      out.mod = Math.min(2 ** bits, Math.max(2, propNum(p, 'modulus', 2 ** bits, 2, 256)))
      if (!(p.props.modulus ?? '').trim()) out.mod = 2 ** bits
      break
    }
    case 'shift': out.bits = propNum(p, 'bits', 4, 1, 8); out.right = (p.props.dir ?? 'right') !== 'left'; out.parallel = p.props.parallel === 'yes'; break
    case 'rom': out.abits = propNum(p, 'abits', 4, 1, 8); out.dbits = propNum(p, 'dbits', 8, 1, 8); break
    case 'ram': out.abits = propNum(p, 'abits', 3, 1, 6); out.dbits = propNum(p, 'dbits', 4, 1, 8); break
    case 'srlatch': out.nand = p.props.type === 'nand'; break
    case 'dff': case 'jkff': case 'tff': out.falling = p.props.edge === 'falling'; out.hasEn = p.props.en === 'yes'; break
    default: break
  }
  return out
}

// ------------------------------------------------------------------------------ the simulator

export interface Oscillation { net: string; time: number; zeroDelay: boolean }

/** A small binary heap of times. */
class TimeHeap {
  a: number[] = []
  push(t: number) {
    const a = this.a
    a.push(t)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  peek(): number | undefined { return this.a[0] }
  pop(): number | undefined {
    const a = this.a
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && a[l] < a[m]) m = l
        if (r < a.length && a[r] < a[m]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get size() { return this.a.length }
}

const MAX_HISTORY = 200000

export class Simulator {
  readonly doc: Doc
  readonly nl: Extracted
  readonly comps: Comp[] = []
  readonly settings: SimSettings
  netVal: V[]
  time = 0
  eventCount = 0
  oscillations: Oscillation[] = []
  /** per net: times and values of every change (the first entry is the value at time 0) */
  hist: { t: number[]; v: V[] }[]
  private drivers: { comp: number; out: number }[][]
  private readers: number[][]
  private pull: (V | undefined)[]
  private byTime = new Map<number, Ev[]>()
  private heap = new TimeHeap()
  private forceAll = true
  private toggles: number[]
  private flagged = new Set<number>()
  private sources = new Map<string, number>()
  private clockHalf = new Map<number, { high: number; low: number }>()

  constructor(doc: Doc, settings: SimSettings = DEFAULT_SIM, nl: Extracted = extractNets(doc)) {
    this.doc = doc
    this.nl = nl
    this.settings = settings
    const nNets = nl.nets.length
    this.netVal = new Array<V>(nNets).fill(3)
    this.hist = nl.nets.map(() => ({ t: [], v: [] }))
    this.drivers = nl.nets.map(() => [])
    this.readers = nl.nets.map(() => [])
    this.pull = new Array(nNets).fill(undefined)
    this.toggles = new Array<number>(nNets).fill(0)
    for (const part of doc.parts) this.addComp(part)
    this.start()
  }

  private addComp(part: Part) {
    const shape = shapeOf(part)
    const ins: string[] = []
    const outs: string[] = []
    const inNet: number[] = []
    const outNet: number[] = []
    const inDef: (V | undefined)[] = []
    for (const pin of shape.pins) {
      const net = this.nl.pinNet.get(pinKey(part.ref, pin.name)) ?? -1
      if (pin.dir === 'pull') { if (net >= 0) this.pull[net] = part.props.level === '0' ? 0 : 1; continue }
      if (pin.dir === 'in') {
        ins.push(pin.name); inNet.push(net)
        const driven = net >= 0 && this.nl.nets[net].pins.some((q) => q.dir === 'out' || q.dir === 'pull')
        inDef.push(!driven && pin.def !== undefined ? pin.def : undefined)
      } else { outs.push(pin.name); outNet.push(net) }
    }
    const idx = this.comps.length
    const kind = part.kind
    let delay = 0
    if (!isSource(kind) && !isSink(kind) && BEH[kind]) {
      if (this.settings.delayMode === 'zero') delay = 0
      else if (this.settings.delayMode === 'unit') delay = this.settings.unitDelay
      else delay = propNum(part, 'delay', this.settings.unitDelay, 0, 100000)
    }
    const comp: Comp = {
      idx, part, kind, ins, inPos: Object.fromEntries(ins.map((n, i) => [n, i])), inNet, inDef, outs, outPos: Object.fromEntries(outs.map((n, i) => [n, i])), outNet,
      delay, p: params(part), st: {}, drv: outs.map(() => 2 as V), target: outs.map(() => 2 as V), pend: outs.map(() => []),
      get: () => 2, set: () => undefined,
    }
    comp.get = (pin) => {
      const i = comp.inPos[pin]
      if (i === undefined) return 2
      const d = comp.inDef[i]
      if (d !== undefined) return d
      const n = comp.inNet[i]
      return n < 0 ? 3 : this.netVal[n]
    }
    comp.set = (pin, v) => {
      const o = comp.outPos[pin]
      if (o !== undefined) this.schedule(comp, o, v)
    }
    inNet.forEach((n) => { if (n >= 0 && !this.readers[n].includes(idx)) this.readers[n].push(idx) })
    outNet.forEach((n, o) => { if (n >= 0) this.drivers[n].push({ comp: idx, out: o }) })
    this.comps.push(comp)
    BEH[kind]?.init?.(comp)
    const name = signalName(part)
    if (isSource(kind)) {
      this.sources.set(part.ref, idx)
      if (name && !this.sources.has(name)) this.sources.set(name, idx)
    }
  }

  private start() {
    // stored state is in place at time 0
    for (const c of this.comps) {
      const b = BEH[c.kind]
      if (b?.preset) b.preset(c, (pin, v) => { const o = c.outPos[pin]; if (o !== undefined) { c.drv[o] = v; c.target[o] = v } })
    }
    for (let n = 0; n < this.netVal.length; n++) {
      this.netVal[n] = this.resolveNet(n)
      this.record(n, 0, this.netVal[n])
    }
    // the sources: a first event at time 0, clocks keep going by themselves
    for (const c of this.comps) {
      if (!isSource(c.kind)) continue
      const p = c.part
      if (p.kind === 'clock') {
        const period = propNum(p, 'period', 20, 2, 1000000)
        const duty = propNum(p, 'duty', 50, 1, 99)
        const high = Math.min(period - 1, Math.max(1, Math.round((period * duty) / 100)))
        const low = period - high
        const offset = propNum(p, 'offset', 0, 0, 1000000)
        this.clockHalf.set(c.idx, { high, low })
        this.queue(c.idx, 0, 0, 0)
        this.queue(c.idx, 0, 1, offset + low)
      } else if (p.kind === 'const') {
        this.queue(c.idx, 0, vparse(p.props.value ?? '1'), 0)
      } else {
        this.queue(c.idx, 0, vparse(p.props.value ?? '0'), 0)
      }
    }
  }

  // ---- events

  private queue(comp: number, out: number, v: V, t: number): Ev {
    const ev: Ev = { t, comp, out, v, dead: false }
    let list = this.byTime.get(t)
    if (!list) { list = []; this.byTime.set(t, list); this.heap.push(t) }
    list.push(ev)
    return ev
  }

  private schedule(c: Comp, o: number, v: V) {
    const pend = c.pend[o]
    if (this.settings.inertial) {
      for (const ev of pend) ev.dead = true
      pend.length = 0
    }
    const ref = pend.length ? pend[pend.length - 1].v : c.drv[o]
    if (v === ref) return
    pend.push(this.queue(c.idx, o, v, this.time + c.delay))
    c.target[o] = v
  }

  private resolveNet(n: number): V {
    const ds = this.drivers[n]
    if (ds.length === 0) return this.pull[n] ?? 3
    let vals: V[]
    if (ds.length === 1) vals = [this.comps[ds[0].comp].drv[ds[0].out]]
    else vals = ds.map((d) => this.comps[d.comp].drv[d.out])
    const r = resolve(vals)
    return r === 3 && this.pull[n] !== undefined ? this.pull[n]! : r
  }

  private record(n: number, t: number, v: V) {
    const h = this.hist[n]
    const k = h.t.length - 1
    if (k >= 0 && h.t[k] === t) { h.v[k] = v; return }
    if (k >= 0 && h.v[k] === v) return
    h.t.push(t); h.v.push(v)
    if (h.t.length > MAX_HISTORY) { h.t.splice(0, MAX_HISTORY / 2); h.v.splice(0, MAX_HISTORY / 2) }
  }

  /** All events at time t (and the ones they cause at the same time, in delta cycles). */
  private process(t: number) {
    this.time = Math.max(this.time, t)
    let delta = 0
    for (;;) {
      const list = this.byTime.get(t)
      if (list) this.byTime.delete(t)
      if ((!list || list.length === 0) && !this.forceAll) break
      const changed = new Set<number>()
      let external = false
      for (const ev of list ?? []) {
        if (ev.dead) continue
        const c = this.comps[ev.comp]
        const pend = c.pend[ev.out]
        const at = pend.indexOf(ev)
        if (at >= 0) pend.splice(at, 1)
        this.eventCount++
        c.drv[ev.out] = ev.v
        const net = c.outNet[ev.out]
        if (net >= 0) changed.add(net)
        if (isSource(c.kind)) {
          external = true
          const half = this.clockHalf.get(c.idx)
          if (half && ev.v !== 2) this.queue(c.idx, 0, ev.v === 1 ? 0 : 1, t + (ev.v === 1 ? half.high : half.low))
        }
      }
      if (external) { this.toggles.fill(0); this.flagged.clear() }
      const dirty = new Set<number>()
      for (const n of changed) {
        const nv = this.resolveNet(n)
        if (nv === this.netVal[n]) continue
        this.netVal[n] = nv
        this.record(n, t, nv)
        this.toggles[n]++
        if (this.toggles[n] > 40 && !this.flagged.has(n)) {
          this.flagged.add(n)
          this.oscillations.push({ net: this.nl.nets[n].name, time: t, zeroDelay: false })
        }
        for (const ci of this.readers[n]) dirty.add(ci)
      }
      if (this.forceAll) { this.comps.forEach((c) => dirty.add(c.idx)); this.forceAll = false }
      for (const ci of [...dirty].sort((a, b) => a - b)) {
        const c = this.comps[ci]
        const b = BEH[c.kind]
        if (b?.eval) b.eval(c, c.get, c.set, this)
      }
      delta++
      if (delta > this.settings.maxDelta) {
        // zero-delay loop: the circuit never settles at this instant
        const stuck = [...changed][0]
        if (stuck !== undefined) this.oscillations.push({ net: this.nl.nets[stuck].name, time: t, zeroDelay: true })
        for (const n of changed) { this.netVal[n] = 2; this.record(n, t, 2) }
        // drop what is still pending at this instant
        const rest = this.byTime.get(t)
        if (rest) { for (const ev of rest) { ev.dead = true; const p = this.comps[ev.comp].pend[ev.out]; const k = p.indexOf(ev); if (k >= 0) p.splice(k, 1) } this.byTime.delete(t) }
        break
      }
    }
  }

  // ---- running

  /** The time of the next event, if any. */
  nextTime(): number | null {
    for (;;) {
      const t = this.heap.peek()
      if (t === undefined) return null
      if (this.byTime.has(t) || (this.forceAll && t <= this.time)) return t
      this.heap.pop() // stale entry
    }
  }

  /** Processes everything up to and including `until`; the time is then `until`. */
  run(until: number, budget = 2_000_000): void {
    const startEvents = this.eventCount
    while (this.eventCount - startEvents < budget) {
      const t = this.nextTime()
      if (t === null || t > until) break
      this.heap.pop()
      this.process(t)
    }
    if (this.eventCount - startEvents < budget) this.time = Math.max(this.time, until)
  }

  /** Processes the next instant that has events; returns its time or null. */
  stepEvent(): number | null {
    const t = this.nextTime()
    if (t === null) return null
    this.heap.pop()
    this.process(t)
    return t
  }

  /** Runs until nothing is pending (without clocks); false when something keeps going. */
  settle(maxTime = 1_000_000): boolean {
    const limit = this.time + maxTime
    for (let i = 0; i < 5_000_000; i++) {
      const t = this.nextTime()
      if (t === null) return true
      if (t > limit) return false
      this.heap.pop()
      this.process(t)
      if (this.clockHalf.size > 0 && t > this.time + 50 * 1000) return false
    }
    return false
  }

  /** Back to time 0 with the same circuit and settings. */
  reset(): Simulator { return new Simulator(this.doc, this.settings, this.nl) }

  // ---- inputs

  inputNames(): string[] {
    const out: string[] = []
    for (const c of this.comps) if (c.kind === 'switch' || c.kind === 'button') out.push(signalName(c.part) || c.part.ref)
    return out
  }

  /** Changes a switch / button / constant now (or at time `at`). Returns false for an unknown name. */
  setInput(name: string, value: V | number | string, at?: number): boolean {
    const i = this.sources.get(name)
    if (i === undefined) return false
    const c = this.comps[i]
    if (c.kind === 'clock') return false
    const t = Math.max(at ?? this.time, this.time)
    this.queue(i, 0, typeof value === 'number' && value <= 3 ? (value as V) : vparse(value), t)
    return true
  }

  /** The level an input has now (last value that was set). */
  inputValue(name: string): V | null {
    const i = this.sources.get(name)
    return i === undefined ? null : this.comps[i].drv[0]
  }

  // ---- reading

  netIndex(target: string): number {
    return resolveTarget(this.doc, this.nl, target)?.index ?? -1
  }

  value(target: string): V {
    const n = this.netIndex(target)
    return n < 0 ? 2 : this.netVal[n]
  }

  /** A bus read as a number, names given MSB first; null when a bit is unknown. */
  number(targets: readonly string[]): number | null {
    return numberOf([...targets].reverse().map((t) => this.value(t)))
  }

  pinValue(ref: string, pin: string): V {
    const n = this.nl.pinNet.get(pinKey(ref, pin))
    return n === undefined ? 2 : this.netVal[n]
  }

  valueAt(net: number, t: number): V {
    const h = this.hist[net]
    if (!h || h.t.length === 0 || t < h.t[0]) return 2
    let lo = 0, hi = h.t.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (h.t[mid] <= t) lo = mid; else hi = mid - 1
    }
    return h.v[lo]
  }

  compOf(ref: string): Comp | undefined { return this.comps.find((c) => c.part.ref === ref) }

  /** The stored value of a counter / register / shift register / flip-flop (a number, or null when unknown). */
  stored(ref: string): number | null | undefined {
    const c = this.compOf(ref)
    if (!c) return undefined
    const q = c.st.q as V | V[] | number | null | undefined
    if (q === undefined) return undefined
    if (q === null) return null
    if (typeof q === 'number' && c.kind === 'counter') return q
    if (Array.isArray(q)) return numberOf(q)
    return q > 1 ? null : q
  }

  memory(ref: string): (number | null)[] | undefined {
    const c = this.compOf(ref)
    return c && Array.isArray(c.st.mem) ? [...(c.st.mem as (number | null)[])] : undefined
  }

  problems(): Problem[] {
    const out = [...this.nl.problems]
    for (const o of this.oscillations) {
      out.push({ level: 'warn', message: o.zeroDelay ? `Net ${o.net} never settles at t=${o.time} (zero-delay loop): it is shown as X.` : `Net ${o.net} keeps toggling with no input change (oscillation) from t=${o.time}.`, refs: [] })
    }
    return out
  }
}

// ------------------------------------------------------------------------------ one-shot helpers

export interface Stimulus { t: number; set: Record<string, string | number> }

/** Applies a list of timed input changes and runs to `until`. */
export function runStimulus(sim: Simulator, steps: readonly Stimulus[], until: number): void {
  const sorted = [...steps].sort((a, b) => a.t - b.t)
  for (const s of sorted) {
    sim.run(s.t)
    for (const [name, v] of Object.entries(s.set)) sim.setInput(name, v)
  }
  sim.run(until)
}

/** The truth table of a combinational circuit: rows over the switch / button inputs, the named outputs' values. */
export function circuitTable(doc: Doc, settings: SimSettings = { ...DEFAULT_SIM, delayMode: 'zero' }, maxInputs = 12): {
  inputs: string[]
  outputs: string[]
  rows: { inputs: number[]; outputs: V[] }[]
  sequential: boolean
} {
  const parts = doc.parts
  const inputs = parts.filter((p) => p.kind === 'switch' || p.kind === 'button').map((p) => signalName(p) || p.ref)
  const outputs: { name: string; target: string }[] = []
  for (const p of parts) {
    if (p.kind === 'led') outputs.push({ name: signalName(p) || p.ref, target: p.ref })
  }
  const sequential = parts.some((p) => ['srlatch', 'dlatch', 'dff', 'jkff', 'tff', 'register', 'counter', 'shift', 'ram', 'clock'].includes(p.kind))
  if (inputs.length > maxInputs) throw new Error(`The circuit has ${inputs.length} inputs: its table would have too many rows.`)
  const sim = new Simulator(doc, settings)
  sim.settle()
  const rows: { inputs: number[]; outputs: V[] }[] = []
  for (let r = 0; r < 1 << inputs.length; r++) {
    const bits = inputs.map((_, k) => (r >> (inputs.length - 1 - k)) & 1)
    inputs.forEach((name, k) => sim.setInput(name, bits[k]))
    sim.settle()
    rows.push({ inputs: bits, outputs: outputs.map((o) => sim.value(o.target)) })
  }
  return { inputs, outputs: outputs.map((o) => o.name), rows, sequential }
}
