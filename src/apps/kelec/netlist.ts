// Schematic → circuit: net extraction (union-find over wires, pins, labels and grounds), the expansion
// of every part into simulator elements, diagnostics that point at parts; and the reverse: a circuit
// (e.g. from typed SPICE) laid out as a schematic whose nets are joined by labels.

import type { BjtModel, Circuit, DiodeModel, Elem, MosModel, Source } from './sim/circuit.ts'
import { DEFAULT_BJT, DEFAULT_DIODE, DEFAULT_NMOS, DEFAULT_PMOS } from './sim/circuit.ts'
import { diagnose, type Problem } from './sim/diagnose.ts'
import { BJT_MODELS, DIODE_MODELS, MOS_MODELS, zenerModel } from './sim/models.ts'
import { formatValue, parseValue } from './sim/units.ts'
import { stubToNet } from './editor.ts'
import { PART_DEFS, defOf, emptyDoc, newPart, onSegment, pinPositions, snap, type Doc, type Part, type PartKind } from './model.ts'

export interface NetPin { ref: string; pin: string }
export interface Net { name: string; pins: NetPin[]; ground: boolean; labelled: boolean }

export interface Extracted {
  nets: Net[]
  /** "R1.2" → net name */
  pinNet: Map<string, string>
  /** "x,y" of a pin, label or wire end → net name */
  pointNet: Map<string, string>
}

class UF {
  p = new Map<string, string>()
  find(a: string): string {
    if (!this.p.has(a)) this.p.set(a, a)
    let r = a
    while (this.p.get(r) !== r) r = this.p.get(r)!
    let c = a
    while (this.p.get(c) !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n }
    return r
  }
  union(a: string, b: string) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p.set(ra, rb) }
}

const key = (x: number, y: number) => `${x},${y}`

const isGroundName = (n: string) => n === '0' || n.toLowerCase() === 'gnd'

export function extractNets(doc: Doc): Extracted {
  const uf = new UF()
  const specials = new Set<string>()
  const pinKeys: { ref: string; pin: string; k: string }[] = []
  const GND = '@gnd'
  uf.find(GND)
  for (const part of doc.parts) {
    for (const pp of pinPositions(part)) {
      const k = key(pp.x, pp.y)
      specials.add(k)
      pinKeys.push({ ref: part.ref, pin: pp.name, k })
      if (part.kind === 'ground') uf.union(k, GND)
    }
  }
  for (const l of doc.labels) {
    const k = key(l.x, l.y)
    specials.add(k)
    uf.union(k, isGroundName(l.name.trim()) ? GND : `@label:${l.name.trim()}`)
  }
  for (const w of doc.wires) {
    const a = key(w.x1, w.y1)
    const b = key(w.x2, w.y2)
    specials.add(a)
    specials.add(b)
    uf.union(a, b)
  }
  const pts = [...specials].map((s) => { const [x, y] = s.split(',').map(Number); return { x, y, k: s } })
  for (const w of doc.wires) {
    const a = key(w.x1, w.y1)
    for (const s of pts) if (s.k !== a && onSegment(s.x, s.y, w.x1, w.y1, w.x2, w.y2)) uf.union(s.k, a)
  }
  // group by root
  interface G { pins: NetPin[]; labels: string[]; ground: boolean; points: string[] }
  const groups = new Map<string, G>()
  const grp = (r: string) => { let g = groups.get(r); if (!g) { g = { pins: [], labels: [], ground: false, points: [] }; groups.set(r, g) } return g }
  for (const s of pts) grp(uf.find(s.k)).points.push(s.k)
  for (const pk of pinKeys) if (doc.parts.find((p) => p.ref === pk.ref)?.kind !== 'ground') grp(uf.find(pk.k)).pins.push({ ref: pk.ref, pin: pk.pin })
  for (const l of doc.labels) grp(uf.find(key(l.x, l.y))).labels.push(l.name.trim())
  const gndRoot = uf.find(GND)
  const nets: Net[] = []
  const pinNet = new Map<string, string>()
  const pointNet = new Map<string, string>()
  let auto = 0
  const used = new Set<string>()
  const ordered = [...groups.entries()].filter(([, g]) => g.points.length > 0)
  // nets in order of their first pin, so numbering is stable
  ordered.sort((a, b) => {
    const fa = a[1].pins[0] ? doc.parts.findIndex((p) => p.ref === a[1].pins[0].ref) : 1e9
    const fb = b[1].pins[0] ? doc.parts.findIndex((p) => p.ref === b[1].pins[0].ref) : 1e9
    return fa - fb
  })
  for (const [root, g] of ordered) {
    const ground = root === gndRoot
    let name: string
    const named = g.labels.find((n) => n && !isGroundName(n))
    if (ground) name = '0'
    else if (named) name = named
    else {
      do { auto++; name = `N${String(auto).padStart(3, '0')}` } while (used.has(name))
    }
    used.add(name)
    nets.push({ name, pins: g.pins, ground, labelled: g.labels.length > 0 })
    for (const p of g.pins) pinNet.set(`${p.ref}.${p.pin}`, name)
    for (const k of g.points) pointNet.set(k, name)
  }
  // label groups that are the same name but not wired together are one net: merge by name
  const byName = new Map<string, Net>()
  const merged: Net[] = []
  for (const n of nets) {
    const have = byName.get(n.name)
    if (have) { have.pins.push(...n.pins); have.labelled ||= n.labelled; have.ground ||= n.ground } else { byName.set(n.name, n); merged.push(n) }
  }
  return { nets: merged, pinNet, pointNet }
}

// ------------------------------------------------------------------------------ building the circuit

export interface MeterInfo { ref: string; kind: 'voltmeter' | 'ammeter'; plus: string; minus: string; element: string }

export interface BuildResult {
  circuit: Circuit
  problems: Problem[]
  nets: Net[]
  pinNet: Map<string, string>
  pointNet: Map<string, string>
  /** part ref → names of the circuit elements it became */
  elementsOf: Map<string, string[]>
  /** circuit element name → part ref */
  refOf: Map<string, string>
  meters: MeterInfo[]
}

class PartError extends Error {}

const num = (text: string | undefined, what: string, fallback?: number): number => {
  const v = parseValue(text ?? '')
  if (v === null) {
    if (fallback !== undefined && (text === undefined || text.trim() === '')) return fallback
    throw new PartError(`${what} “${text ?? ''}” is not a number (try 4.7k, 10u, 1meg).`)
  }
  return v
}
const pos = (text: string | undefined, what: string, fallback?: number): number => {
  const v = num(text, what, fallback)
  if (!(v > 0)) throw new PartError(`${what} must be above zero.`)
  return v
}

function applyOverrides<T extends object>(base: T, props: Record<string, string>, keys: (keyof T & string)[]): T {
  const out = { ...base } as Record<string, unknown>
  for (const k of keys) {
    const t = props[k]
    if (t !== undefined && t.trim() !== '') {
      const v = parseValue(t)
      if (v !== null) out[k] = v
    }
  }
  return out as T
}

export function diodeModelOf(p: Part): DiodeModel {
  let m: DiodeModel
  if (p.kind === 'zener') m = zenerModel(pos(p.value, 'Zener voltage', 5.1))
  else if (p.kind === 'led') m = DIODE_MODELS[`LED_${(p.value || 'red').toUpperCase()}`] ?? DIODE_MODELS.LED_RED
  else m = DIODE_MODELS[(p.value || 'D').toUpperCase()] ?? (p.kind === 'schottky' ? DIODE_MODELS.SCHOTTKY : DEFAULT_DIODE)
  return applyOverrides(m, p.props, ['is', 'n'])
}

export function bjtModelOf(p: Part): BjtModel {
  const m = BJT_MODELS[(p.value || '').toUpperCase()] ?? (p.kind === 'pnp' ? BJT_MODELS.PNP : DEFAULT_BJT)
  return applyOverrides({ ...m, pol: p.kind === 'pnp' ? -1 : 1 } as BjtModel, p.props, ['is', 'bf', 'br', 'vaf'])
}

export function mosModelOf(p: Part): MosModel {
  const m = MOS_MODELS[(p.value || '').toUpperCase()] ?? (p.kind === 'pmos' ? DEFAULT_PMOS : DEFAULT_NMOS)
  return applyOverrides({ ...m, pol: p.kind === 'pmos' ? -1 : 1 } as MosModel, p.props, ['vto', 'kp', 'lambda', 'w', 'l'])
}

function expand(part: Part, net: (pin: string) => string, connected: (pin: string) => boolean): Elem[] {
  const r = part.ref
  const pr = part.props
  const n = net
  switch (part.kind) {
    case 'resistor': return [{ kind: 'R', name: r, nodes: [n('1'), n('2')], value: pos(part.value, 'Resistance') }]
    case 'potentiometer': {
      const total = pos(part.value, 'Resistance')
      const x = Math.min(0.999, Math.max(0.001, num(pr.pos, 'Wiper position', 0.5)))
      return [
        { kind: 'R', name: `${r}a`, nodes: [n('1'), n('W')], value: total * x },
        { kind: 'R', name: `${r}b`, nodes: [n('W'), n('2')], value: total * (1 - x) },
      ]
    }
    case 'capacitor': case 'electrolytic': {
      const e: Elem = { kind: 'C', name: r, nodes: [n('1'), n('2')], value: pos(part.value, 'Capacitance') }
      if (pr.ic?.trim()) e.ic = num(pr.ic, 'Initial voltage')
      return [e]
    }
    case 'inductor': {
      const e: Elem = { kind: 'L', name: r, nodes: [n('1'), n('2')], value: pos(part.value, 'Inductance') }
      if (pr.ic?.trim()) e.ic = num(pr.ic, 'Initial current')
      return [e]
    }
    case 'transformer': {
      const lp = pos(pr.lp, 'Primary inductance', 1)
      const ratio = pos(part.value, 'Turns ratio', 1)
      const k = Math.min(0.99999, Math.max(0, num(pr.k, 'Coupling', 0.999)))
      return [
        { kind: 'L', name: `L${r}p`, nodes: [n('P1'), n('P2')], value: lp },
        { kind: 'L', name: `L${r}s`, nodes: [n('S1'), n('S2')], value: lp * ratio * ratio },
        { kind: 'K', name: `K${r}`, l1: `L${r}p`, l2: `L${r}s`, k },
      ]
    }
    case 'battery': {
      const src: Source = { dc: num(part.value, 'Voltage'), acMag: pr.ac?.trim() ? num(pr.ac, 'AC amplitude') : 0, acPhase: 0 }
      return [{ kind: 'V', name: r, nodes: [n('+'), n('-')], src }]
    }
    case 'vsine': {
      const offset = num(pr.offset, 'DC offset', 0)
      const src: Source = {
        dc: offset, acMag: pr.ac?.trim() ? num(pr.ac, 'AC amplitude') : 0, acPhase: 0,
        wave: { kind: 'sin', offset, amp: num(part.value, 'Amplitude'), freq: pos(pr.freq, 'Frequency'), delay: num(pr.delay, 'Delay', 0), damping: 0, phase: num(pr.phase, 'Phase', 0) },
      }
      return [{ kind: 'V', name: r, nodes: [n('+'), n('-')], src }]
    }
    case 'vpulse': {
      const v1 = num(pr.v1, 'Low level', 0)
      const src: Source = {
        dc: v1, acMag: 0, acPhase: 0,
        wave: {
          kind: 'pulse', v1, v2: num(part.value, 'High level'), delay: num(pr.delay, 'Delay', 0), rise: num(pr.rise, 'Rise time', 0), fall: num(pr.fall, 'Fall time', 0),
          width: num(pr.width, 'Pulse width', 0.5e-3), period: num(pr.period, 'Period', 0),
        },
      }
      return [{ kind: 'V', name: r, nodes: [n('+'), n('-')], src }]
    }
    case 'isource': {
      const src: Source = { dc: num(part.value, 'Current'), acMag: pr.ac?.trim() ? num(pr.ac, 'AC amplitude') : 0, acPhase: 0 }
      // the arrow points up: the current leaves through the top (+) pin, so SPICE's n− is the top pin
      return [{ kind: 'I', name: r, nodes: [n('-'), n('+')], src }]
    }
    case 'ground': return []
    case 'diode': case 'schottky': case 'zener': case 'led':
      return [{ kind: 'D', name: r, nodes: [n('1'), n('2')], model: diodeModelOf(part) }]
    case 'npn': case 'pnp': return [{ kind: 'Q', name: r, nodes: [n('C'), n('B'), n('E')], model: bjtModelOf(part) }]
    case 'nmos': case 'pmos': return [{ kind: 'M', name: r, nodes: [n('D'), n('G'), n('S')], model: mosModelOf(part) }]
    case 'opamp': case 'opamp1': {
      const sp = connected('V+')
      const sn = connected('V-')
      const supply = sp || sn
      const supplyNodes = supply ? [sp ? n('V+') : '0', sn ? n('V-') : '0'] : []
      const rail = pos(pr.rail, 'Output limit', 15)
      if (part.kind === 'opamp') {
        return [{ kind: 'B', name: r, nodes: [n('OUT'), n('IN+'), n('IN-'), ...supplyNodes], fn: { type: 'opamp', gain: pos(pr.gain, 'Open-loop gain', 1e6), rail, supply, ro: 0 } }]
      }
      const a0 = pos(pr.a0, 'DC gain', 1e5)
      const gbw = pos(pr.gbw, 'Gain-bandwidth', 1e6)
      const fp = gbw / a0
      const rr = 1000
      const cc = 1 / (2 * Math.PI * fp * rr)
      // gain stage, one pole, then the output buffer. The gain stage's own limit (1000 × the swing) bounds the
      // internal node and gives a realistic slew rate (about 2π·GBW·15 V/A0 per µs).
      return [
        { kind: 'B', name: `${r}_gain`, nodes: [`${r}.x`, n('IN+'), n('IN-')], fn: { type: 'opamp', gain: a0, rail: rail * 1000, supply: false, ro: 0 } },
        { kind: 'R', name: `R${r}`, nodes: [`${r}.x`, `${r}.y`], value: rr },
        { kind: 'C', name: `C${r}`, nodes: [`${r}.y`, '0'], value: cc },
        { kind: 'B', name: r, nodes: [n('OUT'), `${r}.y`, '0', ...supplyNodes], fn: { type: 'opamp', gain: 1, rail, supply, ro: 0 } },
      ]
    }
    case 'vcvs': return [{ kind: 'E', name: r, nodes: [n('O+'), n('O-'), n('C+'), n('C-')], value: num(part.value, 'Gain') }]
    case 'vccs': return [{ kind: 'G', name: r, nodes: [n('O+'), n('O-'), n('C+'), n('C-')], value: num(part.value, 'Transconductance') }]
    case 'switch':
      return [{ kind: 'S', name: r, nodes: [n('1'), n('2')], ron: pos(pr.ron, 'On resistance', 0.01), roff: 1e9, spec: { fixed: part.value !== 'open' } }]
    case 'switch_timed':
      return [{
        kind: 'S', name: r, nodes: [n('1'), n('2')], ron: pos(pr.ron, 'On resistance', 0.01), roff: 1e9,
        spec: { delay: num(pr.delay, 'Closes at', 0), on: pos(pr.on, 'Closed for', 1e-3), period: num(pr.period, 'Period', 0) },
      }]
    case 'voltmeter': return [{ kind: 'R', name: `R${r}`, nodes: [n('+'), n('-')], value: 1e9 }]
    case 'ammeter': return [{ kind: 'V', name: `V${r}`, nodes: [n('+'), n('-')], src: { dc: 0, acMag: 0, acPhase: 0 } }]
    case 'and': case 'or': case 'nand': case 'nor': case 'xor': case 'xnor':
      return [{ kind: 'B', name: r, nodes: [n('Y'), n('A'), n('B')], fn: { type: 'gate', gate: part.kind, vdd: pos(pr.vdd, 'Supply', 5), ro: 50 } }]
    case 'not': return [{ kind: 'B', name: r, nodes: [n('Y'), n('A')], fn: { type: 'gate', gate: 'not', vdd: pos(pr.vdd, 'Supply', 5), ro: 50 } }]
  }
}

export function buildNetlist(doc: Doc, title = ''): BuildResult {
  const ex = extractNets(doc)
  const problems: Problem[] = []
  const elements: Elem[] = []
  const elementsOf = new Map<string, string[]>()
  const refOf = new Map<string, string>()
  const meters: MeterInfo[] = []
  // unique references: warn about duplicates
  const seen = new Set<string>()
  for (const part of doc.parts) {
    if (part.kind === 'ground') continue
    if (!part.ref.trim()) {
      problems.push({ level: 'error', code: 'bad-value', message: `A ${defOf(part).name.toLowerCase()} has no reference name: give it one in the properties (R1, C2…).`, refs: [], nodes: [] })
      continue
    }
    if (seen.has(part.ref.toLowerCase())) {
      problems.push({ level: 'error', code: 'bad-value', message: `Two parts are called ${part.ref}: rename one of them so each part has its own name.`, refs: [part.ref], nodes: [] })
      continue
    }
    seen.add(part.ref.toLowerCase())
    const netOf = (pin: string) => ex.pinNet.get(`${part.ref}.${pin}`) ?? '0'
    const pinCount = (pin: string) => {
      const name = ex.pinNet.get(`${part.ref}.${pin}`)
      const net = name === undefined ? undefined : ex.nets.find((q) => q.name === name)
      return net ? net.pins.length : 0
    }
    const connected = (pin: string) => {
      const name = ex.pinNet.get(`${part.ref}.${pin}`)
      const net = name === undefined ? undefined : ex.nets.find((q) => q.name === name)
      return !!net && (net.pins.length > 1 || net.ground || net.labelled)
    }
    const def = defOf(part)
    // dangling pins
    const dangling = def.pins.filter((d) => pinCount(d.name) <= 1 && !connected(d.name) && !(part.kind.startsWith('opamp') && (d.name === 'V+' || d.name === 'V-')))
    if (dangling.length > 0) {
      problems.push({
        level: 'warning', code: 'unconnected',
        message: `${part.ref}: ${dangling.map((d) => `pin ${d.label ?? d.name}`).join(' and ')} ${dangling.length > 1 ? 'are' : 'is'} not connected to anything.`,
        refs: [part.ref], nodes: [],
      })
    }
    try {
      const els = expand(part, netOf, connected)
      for (const e of els) { elements.push(e); refOf.set(e.name, part.ref) }
      elementsOf.set(part.ref, els.map((e) => e.name))
      if (part.kind === 'voltmeter') meters.push({ ref: part.ref, kind: 'voltmeter', plus: netOf('+'), minus: netOf('-'), element: els[0].name })
      if (part.kind === 'ammeter') meters.push({ ref: part.ref, kind: 'ammeter', plus: netOf('+'), minus: netOf('-'), element: els[0].name })
    } catch (e) {
      if (e instanceof PartError) problems.push({ level: 'error', code: 'bad-value', message: `${part.ref}: ${e.message}`, refs: [part.ref], nodes: [] })
      else throw e
    }
  }
  const circuit: Circuit = { title, elements }
  for (const p of diagnose(circuit)) problems.push({ ...p, refs: [...new Set(p.refs.map((x) => refOf.get(x) ?? x))] })
  return { circuit, problems, nets: ex.nets, pinNet: ex.pinNet, pointNet: ex.pointNet, elementsOf, refOf, meters }
}

// ------------------------------------------------------------------------------ circuit → schematic

/** Part kind for a simulator element (null if it is only part of another part). */
function kindFor(e: Elem): PartKind | null {
  switch (e.kind) {
    case 'R': return 'resistor'
    case 'C': return 'capacitor'
    case 'L': return 'inductor'
    case 'V': return e.src.wave?.kind === 'sin' ? 'vsine' : e.src.wave?.kind === 'pulse' ? 'vpulse' : 'battery'
    case 'I': return 'isource'
    case 'D': return e.model.bv ? 'zener' : /^LED/i.test(e.model.name ?? '') ? 'led' : /schottky|5819/i.test(e.model.name ?? '') ? 'schottky' : 'diode'
    case 'Q': return e.model.pol > 0 ? 'npn' : 'pnp'
    case 'M': return e.model.pol > 0 ? 'nmos' : 'pmos'
    case 'E': return 'vcvs'
    case 'G': return 'vccs'
    case 'S': return 'fixed' in e.spec ? 'switch' : 'switch_timed'
    case 'B': return e.fn.type === 'opamp' ? 'opamp' : e.fn.gate
    case 'K': return null
  }
}

const fmt = (v: number) => formatValue(v, 6).replace('µ', 'u')
const fnum = (v: number) => String(Number(v.toPrecision(6)))

/** Fill in a part's value and properties from a simulator element. */
function fillPart(part: Part, e: Elem) {
  const set = (k: string, v: number | string | undefined) => { if (v !== undefined && v !== '') part.props[k] = typeof v === 'number' ? fmt(v) : v }
  switch (e.kind) {
    case 'R': case 'C': case 'L': part.value = fmt(e.value); if ('ic' in e && e.ic !== undefined) set('ic', e.ic); break
    case 'V': case 'I': {
      const w = e.src.wave
      if (w?.kind === 'sin') {
        part.value = fmt(w.amp); set('freq', w.freq); set('offset', w.offset); set('phase', w.phase); set('delay', w.delay)
        part.props.ac = e.src.acMag ? fmt(e.src.acMag) : ''
      } else if (w?.kind === 'pulse') {
        part.value = fmt(w.v2); set('v1', w.v1); set('delay', w.delay); set('rise', w.rise); set('fall', w.fall); set('width', w.width); set('period', w.period)
      } else {
        part.value = fmt(e.src.dc)
        if (e.src.acMag) part.props.ac = fmt(e.src.acMag)
      }
      break
    }
    case 'D': {
      const m = e.model
      if (m.bv) part.value = fnum(m.bv)
      else if (/^LED_/i.test(m.name ?? '')) part.value = (m.name ?? 'LED_RED').slice(4).toLowerCase()
      else if (m.name && DIODE_MODELS[m.name.toUpperCase()]) part.value = m.name.toUpperCase()
      else { part.value = 'D'; part.props.is = m.is.toExponential(3); part.props.n = fnum(m.n) }
      break
    }
    case 'Q': {
      const m = e.model
      if (m.name && BJT_MODELS[m.name.toUpperCase()]) part.value = m.name.toUpperCase()
      else { part.value = m.pol > 0 ? 'NPN' : 'PNP'; part.props.is = m.is.toExponential(3); part.props.bf = fnum(m.bf); part.props.br = fnum(m.br); if (m.vaf) part.props.vaf = fnum(m.vaf) }
      break
    }
    case 'M': {
      const m = e.model
      part.value = m.pol > 0 ? 'NMOS' : 'PMOS'
      part.props.vto = fnum(m.vto); part.props.kp = fnum(m.kp); part.props.lambda = fnum(m.lambda); part.props.w = fnum(m.w); part.props.l = fnum(m.l)
      break
    }
    case 'E': case 'G': part.value = fmt(e.value); break
    case 'S':
      part.props.ron = fmt(e.ron)
      if ('fixed' in e.spec) part.value = e.spec.fixed ? 'closed' : 'open'
      else { set('delay', e.spec.delay); set('on', e.spec.on); set('period', e.spec.period) }
      break
    case 'B':
      if (e.fn.type === 'opamp') { part.props.gain = fnum(e.fn.gain); part.props.rail = fnum(e.fn.rail) } else part.props.vdd = fnum(e.fn.vdd)
      break
    case 'K': break
  }
}

/** pin name of the part for the i-th node of an element of that kind */
function pinOrder(e: Elem): string[] {
  switch (e.kind) {
    case 'R': case 'C': case 'L': case 'D': case 'S': return ['1', '2']
    case 'V': return ['+', '-']
    case 'I': return ['-', '+']
    case 'Q': return ['C', 'B', 'E']
    case 'M': return ['D', 'G', 'S']
    case 'E': case 'G': return ['O+', 'O-', 'C+', 'C-']
    case 'B': return e.fn.type === 'opamp' ? ['OUT', 'IN+', 'IN-', 'V+', 'V-'] : e.fn.gate === 'not' ? ['Y', 'A'] : ['Y', 'A', 'B']
    case 'K': return []
  }
}

/**
 * Lay a circuit out as a schematic: parts on a grid, each pin with a short stub carrying a net
 * label (or a ground symbol), so the nets are joined by name rather than by wires.
 */
export function circuitToDoc(circuit: Circuit): Doc {
  const doc = emptyDoc()
  const coupled = new Map<string, { k: Elem & { kind: 'K' } }>()
  for (const e of circuit.elements) if (e.kind === 'K') { coupled.set(e.l1.toLowerCase(), { k: e }); coupled.set(e.l2.toLowerCase(), { k: e }) }
  const done = new Set<string>()
  const items: { part: Part; nodes: string[] }[] = []
  for (const e of circuit.elements) {
    if (e.kind === 'K' || done.has(e.name.toLowerCase())) continue
    const co = e.kind === 'L' ? coupled.get(e.name.toLowerCase()) : undefined
    if (co && e.kind === 'L') {
      const other = circuit.elements.find((x) => x.kind === 'L' && x.name.toLowerCase() === (co.k.l1.toLowerCase() === e.name.toLowerCase() ? co.k.l2 : co.k.l1).toLowerCase())
      if (other && other.kind === 'L' && !done.has(other.name.toLowerCase())) {
        const [p, s] = co.k.l1.toLowerCase() === e.name.toLowerCase() ? [e, other] : [other, e]
        done.add(p.name.toLowerCase()); done.add(s.name.toLowerCase())
        const part = newPart(doc, 'transformer', 0, 0, { ref: p.name.replace(/^L/i, 'T') || 'T1' })
        const lp = (p as { value: number }).value
        part.value = fnum(Math.sqrt((s as { value: number }).value / lp))
        part.props.lp = fmt(lp)
        part.props.k = fnum(co.k.k)
        doc.parts.push(part)
        items.push({ part, nodes: [...(p as { nodes: string[] }).nodes, ...(s as { nodes: string[] }).nodes] })
        continue
      }
    }
    const kind = kindFor(e)
    if (!kind) continue
    done.add(e.name.toLowerCase())
    const part = newPart(doc, kind, 0, 0, { ref: e.name })
    fillPart(part, e)
    doc.parts.push(part)
    // an op-amp's supply pins are only wired when the model uses them
    items.push({ part, nodes: e.kind === 'B' ? e.nodes : e.nodes })
  }
  const cols = Math.max(2, Math.ceil(Math.sqrt(items.length * 1.4)))
  items.forEach((it, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    it.part.x = 100 + col * 200
    it.part.y = 100 + row * 150
    const order = it.part.kind === 'transformer' ? ['P1', 'P2', 'S1', 'S2'] : pinOrder(circuit.elements.find((x) => x.name === it.part.ref) ?? ({ kind: 'R' } as Elem))
    it.nodes.forEach((node, k) => {
      if (node === undefined || order[k] === undefined) return
      stubToNet(doc, it.part, order[k], node)
    })
  })
  return doc
}

export { PART_DEFS, snap }
