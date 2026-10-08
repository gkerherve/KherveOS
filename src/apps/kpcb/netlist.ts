// Netlists (pure): kElec's interchange object ("knetlist"), a simple text format and a subset of
// KiCad's s-expression netlist, turned into parts and nets, and merged into a design.
//
//   knetlist  { format: 'knetlist', version: 1, name, components: [{ ref, kind, value, footprint?, pins[] }],
//               nets: [{ name, pins: [{ ref, pin }] }] }
//
//   text      # a comment
//             R1 10k R_0805 | VCC:1 OUT:2          REF [VALUE] [FOOTPRINT] | NET:PIN NET:PIN …
//             U1 NE555 DIP-8 | GND:1 TRIG:2 OUT:3 VCC:4 VCC:8
//             (the value is "-" when empty; without a footprint the reference's letters pick one)
//
//   KiCad     (export (components (comp (ref R1) (value 10k) (footprint Resistor_SMD:R_0805_2012Metric)))
//                     (nets (net (code 1) (name "VCC") (node (ref R1) (pin 1)))))

import { getFootprint } from './footprints.ts'
import { guessClass, uid } from './board.ts'
import type { Design, Net, Part } from './types.ts'

export interface KNetlist {
  format: 'knetlist'
  version: 1
  name: string
  components: Array<{ ref: string; kind: string; value: string; footprint?: string; pins: string[] }>
  nets: Array<{ name: string; pins: Array<{ ref: string; pin: string }> }>
}

/** What an import produces: parts with footprints, nets by pad number. */
export interface ImportedNetlist {
  name: string
  parts: Array<{ ref: string; value: string; fp: string }>
  nets: Net[]
  warnings: string[]
}

export const KINDS = [
  'resistor', 'capacitor', 'electrolytic', 'inductor', 'diode', 'led', 'zener', 'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'connector', 'ic',
  'switch', 'potentiometer', 'source', 'other',
]

export function isKnetlist(x: unknown): x is KNetlist {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return o.format === 'knetlist' && Array.isArray(o.components) && Array.isArray(o.nets)
}

// ------------------------------------------------------------ default footprints and pin names

/** The footprint a part of this kind gets when the netlist names none. */
export function defaultFootprint(kind: string, pinCount = 2): string {
  switch (kind) {
    case 'resistor': return 'R_0805'
    case 'capacitor': return 'C_0805'
    case 'electrolytic': return 'CP_Radial_THT'
    case 'inductor': return 'L_Axial_THT'
    case 'diode': case 'zener': return 'D_SOD-123'
    case 'led': return 'LED_0805'
    case 'npn': case 'pnp': return 'TO-92'
    case 'nmos': case 'pmos': return 'SOT-23'
    case 'opamp': return 'DIP-8'
    case 'switch': return 'SW_Push_6mm'
    case 'potentiometer': return 'Potentiometer_3296W'
    case 'ic':
      return pinCount <= 8 ? 'DIP-8' : pinCount <= 14 ? 'DIP-14' : pinCount <= 16 ? 'DIP-16' : 'DIP-28'
    default:
      return headerFor(pinCount)
  }
}

function headerFor(n: number): string {
  if (n <= 1) return 'PinHeader_1x02'
  if (n <= 10) return `PinHeader_1x${String(n).padStart(2, '0')}`
  if (n <= 15) return 'PinHeader_1x15'
  if (n <= 20) return 'PinHeader_1x20'
  return 'PinHeader_2x10'
}

const BJT: Record<string, string> = { B: '1', C: '2', E: '3', BASE: '1', COLLECTOR: '2', EMITTER: '3' }
const BJT_SOT23: Record<string, string> = { B: '1', E: '2', C: '3', BASE: '1', EMITTER: '2', COLLECTOR: '3' }
const MOS: Record<string, string> = { G: '1', D: '2', S: '3', GATE: '1', DRAIN: '2', SOURCE: '3' }
const MOS_SOT23: Record<string, string> = { G: '1', S: '2', D: '3', GATE: '1', SOURCE: '2', DRAIN: '3' }
const DIODE: Record<string, string> = { A: '1', K: '2', C: '2', ANODE: '1', CATHODE: '2', '+': '1', '-': '2' }
const OPAMP: Record<string, string> = { 'IN-': '2', 'IN+': '3', 'V-': '4', OUT: '6', 'V+': '7', '-': '2', '+': '3', VEE: '4', VCC: '7' }
const POT: Record<string, string> = { A: '1', W: '2', B: '3', CCW: '1', WIPER: '2', CW: '3' }

/**
 * The pad number for a pin of a component. `pins` is the component's pin list; passives use '1' and
 * '2' (diodes A, K), a BJT B, C, E (pads 1, 2, 3 of a TO-92 or TO-220; a SOT-23 follows its datasheet:
 * 1 = B, 2 = E, 3 = C), a MOSFET G, D, S, an op-amp IN+, IN-, OUT, V+, V- (the 741 pinout of a DIP-8).
 */
export function padFor(kind: string, fp: string, pin: string, pins: readonly string[]): string {
  const key = pin.trim().toUpperCase()
  const sot = /^SOT-23$/i.test(fp)
  let m: string | undefined
  if (kind === 'npn' || kind === 'pnp') m = (sot ? BJT_SOT23 : BJT)[key]
  else if (kind === 'nmos' || kind === 'pmos') m = (sot ? MOS_SOT23 : MOS)[key]
  else if (kind === 'diode' || kind === 'led' || kind === 'zener') m = DIODE[key]
  else if (kind === 'opamp') m = OPAMP[key]
  else if (kind === 'potentiometer') m = POT[key]
  if (m) return m
  if (/^\d+$/.test(pin.trim())) return pin.trim()
  const i = pins.indexOf(pin)
  return String(i >= 0 ? i + 1 : pin)
}

// ------------------------------------------------------------ kElec's object

/** Turn a knetlist into parts (with footprints) and nets (by pad number). */
export function fromKnetlist(nl: KNetlist): ImportedNetlist {
  const warnings: string[] = []
  const kinds = new Map<string, string>()
  const compPins = new Map<string, string[]>()
  const fps = new Map<string, string>()
  const parts: ImportedNetlist['parts'] = []
  for (const c of nl.components) {
    const kind = KINDS.includes(c.kind) ? c.kind : 'other'
    let fp = c.footprint && getFootprint(c.footprint) ? getFootprint(c.footprint)!.name : ''
    if (c.footprint && !fp) warnings.push(`${c.ref}: footprint "${c.footprint}" is not in the library, using the default for a ${kind}`)
    if (!fp) fp = getFootprint(defaultFootprint(kind, c.pins.length))?.name ?? defaultFootprint(kind, c.pins.length)
    kinds.set(c.ref, kind)
    compPins.set(c.ref, c.pins)
    fps.set(c.ref, fp)
    parts.push({ ref: c.ref, value: c.value ?? '', fp })
  }
  const nets: Net[] = []
  for (const n of nl.nets) {
    const pins: Net['pins'] = []
    for (const p of n.pins) {
      const kind = kinds.get(p.ref)
      if (!kind) {
        warnings.push(`net ${n.name}: ${p.ref} is not a component`)
        continue
      }
      const pad = padFor(kind, fps.get(p.ref) ?? '', String(p.pin), compPins.get(p.ref) ?? [])
      const f = getFootprint(fps.get(p.ref) ?? '')
      if (f && !f.pads.some((d) => d.n === pad)) warnings.push(`${p.ref}.${p.pin}: no pad "${pad}" on ${f.name}`)
      if (!pins.some((q) => q.ref === p.ref && q.pin === pad)) pins.push({ ref: p.ref, pin: pad })
    }
    if (pins.length) nets.push({ name: n.name, cls: guessClass(n.name), pins })
  }
  return { name: nl.name || 'board', parts, nets, warnings }
}

// ------------------------------------------------------------ the simple text format

function defaultFootprintForRef(ref: string, maxPin: number): string {
  const p = /^[A-Za-z]+/.exec(ref)?.[0].toUpperCase() ?? ''
  switch (p) {
    case 'R': return 'R_0805'
    case 'C': return 'C_0805'
    case 'L': return 'L_Axial_THT'
    case 'D': return 'D_SOD-123'
    case 'LED': return 'LED_0805'
    case 'Q': return 'TO-92'
    case 'U': case 'IC': return defaultFootprint('ic', maxPin)
    case 'SW': case 'S': return 'SW_Push_6mm'
    case 'Y': case 'X': return 'Crystal_HC49-U'
    case 'BZ': return 'Buzzer_12mm'
    case 'RV': case 'VR': return 'Potentiometer_3296W'
    case 'TP': return 'TestPoint_Pad_D1.5mm'
    case 'H': return 'MountingHole_M3'
    case 'A': return 'Arduino_Nano'
    default: return headerFor(maxPin)
  }
}

export function parseTextNetlist(text: string): ImportedNetlist {
  const warnings: string[] = []
  const parts: ImportedNetlist['parts'] = []
  const nets = new Map<string, Net>()
  let name = 'board'
  const lines = text.split(/\r?\n/)
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln].replace(/#.*$/, '').trim()
    if (!raw) continue
    const title = /^(?:title|name)\s*:\s*(.+)$/i.exec(raw)
    if (title) {
      name = title[1].trim()
      continue
    }
    const bar = raw.indexOf('|')
    const head = (bar < 0 ? raw : raw.slice(0, bar)).trim().split(/\s+/)
    const pairs = bar < 0 ? [] : raw.slice(bar + 1).trim().split(/\s+/).filter(Boolean)
    const ref = head[0]
    if (!ref || !/^[A-Za-z][A-Za-z0-9_]*$/.test(ref)) {
      warnings.push(`line ${ln + 1}: "${raw}" does not start with a reference`)
      continue
    }
    let value = ''
    let fp = ''
    if (head.length === 2) {
      if (getFootprint(head[1])) fp = head[1]
      else value = head[1]
    } else if (head.length >= 3) {
      value = head[1]
      fp = head[2]
    }
    if (value === '-') value = ''
    const pins: Array<[string, string]> = []
    for (const pr of pairs) {
      const i = pr.lastIndexOf(':')
      if (i <= 0 || i === pr.length - 1) {
        warnings.push(`line ${ln + 1}: "${pr}" should be NET:PIN`)
        continue
      }
      pins.push([pr.slice(0, i), pr.slice(i + 1)])
    }
    const maxPin = Math.max(2, ...pins.map(([, p]) => Number(p) || 0))
    let f = fp ? getFootprint(fp) : undefined
    if (fp && !f) warnings.push(`${ref}: footprint "${fp}" is not in the library`)
    if (!f) f = getFootprint(defaultFootprintForRef(ref, maxPin))
    if (parts.some((p) => p.ref === ref)) {
      warnings.push(`line ${ln + 1}: ${ref} appears twice`)
      continue
    }
    parts.push({ ref, value, fp: f?.name ?? fp })
    for (const [net, pin] of pins) {
      if (f && !f.pads.some((d) => d.n === pin)) warnings.push(`${ref}: no pad "${pin}" on ${f.name}`)
      let n = nets.get(net)
      if (!n) nets.set(net, (n = { name: net, cls: guessClass(net), pins: [] }))
      if (!n.pins.some((q) => q.ref === ref && q.pin === pin)) n.pins.push({ ref, pin })
    }
  }
  return { name, parts, nets: [...nets.values()], warnings }
}

/** The text format of a design's netlist (round trip of parseTextNetlist). */
export function toTextNetlist(d: Design): string {
  const lines = [`title: ${d.name}`]
  for (const p of d.parts) {
    const pairs: string[] = []
    for (const n of d.nets) for (const q of n.pins) if (q.ref === p.ref) pairs.push(`${n.name}:${q.pin}`)
    lines.push(`${p.ref} ${p.value || '-'} ${p.fp}${pairs.length ? ` | ${pairs.join(' ')}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

// ------------------------------------------------------------ KiCad's s-expressions

type Sexp = string | Sexp[]

function parseSexp(text: string): Sexp {
  let i = 0
  const n = text.length
  const read = (): Sexp => {
    while (i < n && /\s/.test(text[i])) i++
    if (text[i] === '(') {
      i++
      const list: Sexp[] = []
      for (;;) {
        while (i < n && /\s/.test(text[i])) i++
        if (i >= n) throw new Error('The netlist ends inside a parenthesis.')
        if (text[i] === ')') {
          i++
          return list
        }
        list.push(read())
      }
    }
    if (text[i] === '"') {
      let s = ''
      i++
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) i++
        s += text[i++]
      }
      i++
      return s
    }
    let s = ''
    while (i < n && !/[\s()]/.test(text[i])) s += text[i++]
    return s
  }
  return read()
}

const field = (list: Sexp[], key: string): string | undefined => {
  for (const x of list) if (Array.isArray(x) && x[0] === key && typeof x[1] === 'string') return x[1]
  return undefined
}
const children = (list: Sexp[], key: string): Sexp[][] => list.filter((x): x is Sexp[] => Array.isArray(x) && x[0] === key)

/** Map a KiCad footprint ("Resistor_SMD:R_0805_2012Metric") to ours. */
export function footprintFromKicad(name: string): string | undefined {
  const base = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
  const direct = getFootprint(base)
  if (direct) return direct.name
  let m: RegExpExecArray | null
  if ((m = /^R_(0402|0603|0805|1206)/.exec(base))) return `R_${m[1]}`
  if ((m = /^C_(0603|0805|1206)/.exec(base))) return `C_${m[1]}`
  if ((m = /^LED_(0603|0805|1206)/.exec(base))) return `LED_${m[1]}`
  if ((m = /^LED_D(3|5)\.0mm/.exec(base))) return `LED_${m[1]}mm`
  if ((m = /^CP_Radial_D(5|6\.3|8)(?:\.0)?mm/.exec(base))) return getFootprint(`CP_Radial_D${m[1]}${m[1].includes('.') ? '' : '.0'}mm`)?.name
  if ((m = /^R_Axial.*P(7\.62|10\.16)/.exec(base))) return `R_Axial_THT_P${m[1]}`
  if ((m = /^(?:DIP|PDIP)-(\d+)/.exec(base))) return getFootprint(`DIP-${m[1]}`)?.name
  if ((m = /^SOIC-(\d+)/.exec(base))) return getFootprint(`SOIC-${m[1]}`)?.name
  if ((m = /^TSSOP-(\d+)/.exec(base))) return getFootprint(`TSSOP-${m[1]}`)?.name
  if ((m = /^(?:LQFP|TQFP)-(\d+)/.exec(base))) return getFootprint(`QFP-${m[1]}`)?.name
  if ((m = /^PinHeader_(\d)x(\d+)/.exec(base))) return getFootprint(`PinHeader_${m[1]}x${m[2].padStart(2, '0')}`)?.name
  if (/^SOT-23/.test(base)) return 'SOT-23'
  if (/^TO-92/.test(base)) return 'TO-92'
  if (/^TO-220/.test(base)) return 'TO-220_Vertical'
  return undefined
}

export function parseKicadNetlist(text: string): ImportedNetlist {
  const root = parseSexp(text)
  if (!Array.isArray(root) || root[0] !== 'export') throw new Error('This is not a KiCad netlist (it should start with "(export").')
  const warnings: string[] = []
  const parts: ImportedNetlist['parts'] = []
  const comps = children(root, 'components')[0] ?? []
  for (const c of children(comps, 'comp')) {
    const ref = field(c, 'ref')
    if (!ref) continue
    const kfp = field(c, 'footprint') ?? ''
    let fp = kfp ? footprintFromKicad(kfp) : undefined
    if (!fp) {
      if (kfp) warnings.push(`${ref}: footprint "${kfp}" is not in the library`)
      const pinCount = children(root, 'nets').flatMap((ns) => children(ns, 'net')).reduce((m, n) => m + children(n, 'node').filter((nd) => field(nd, 'ref') === ref).length, 0)
      fp = getFootprint(defaultFootprintForRef(ref, Math.max(2, pinCount)))?.name ?? 'PinHeader_1x02'
    }
    parts.push({ ref, value: field(c, 'value') ?? '', fp })
  }
  const nets: Net[] = []
  const nl = children(root, 'nets')[0] ?? []
  for (const n of children(nl, 'net')) {
    const name = field(n, 'name') ?? `net${field(n, 'code') ?? nets.length + 1}`
    const pins: Net['pins'] = []
    for (const nd of children(n, 'node')) {
      const ref = field(nd, 'ref')
      const pin = field(nd, 'pin')
      if (ref && pin && parts.some((p) => p.ref === ref) && !pins.some((q) => q.ref === ref && q.pin === pin)) pins.push({ ref, pin })
    }
    if (pins.length) nets.push({ name, cls: guessClass(name), pins })
  }
  const design = field(children(root, 'design')[0] ?? [], 'source') ?? 'board'
  return { name: design.replace(/\.[^.]+$/, '').replace(/^.*[\\/]/, '') || 'board', parts, nets, warnings }
}

/** Any of the three: a knetlist object or its JSON, the text format, or a KiCad netlist. */
export function parseNetlist(input: unknown): ImportedNetlist {
  if (isKnetlist(input)) return fromKnetlist(input)
  if (typeof input === 'string') {
    const t = input.trim()
    if (t.startsWith('{')) {
      const obj: unknown = JSON.parse(t)
      if (isKnetlist(obj)) return fromKnetlist(obj)
      throw new Error('This JSON is not a knetlist ({"format":"knetlist", "components":…, "nets":…}).')
    }
    if (t.startsWith('(')) return parseKicadNetlist(t)
    return parseTextNetlist(t)
  }
  throw new Error('Not a netlist: expected a knetlist object or text.')
}

// ------------------------------------------------------------ merging into a design

export interface NetlistReport {
  added: string[]
  removed: string[]
  changed: string[]
  warnings: string[]
}

/**
 * Put an imported netlist in a design. "replace" starts the parts and tracks again (outline, holes,
 * zones and rules stay); "update" keeps placed parts and tracks, adds the new parts (at the origin:
 * arrange them afterwards), changes values and footprints, and flags the parts that left the netlist.
 */
export function applyNetlist(d: Design, imp: ImportedNetlist, mode: 'replace' | 'update'): { design: Design; report: NetlistReport } {
  const report: NetlistReport = { added: [], removed: [], changed: [], warnings: [...imp.warnings] }
  const classOf = new Map(d.nets.map((n) => [n.name, n.cls]))
  const nets: Net[] = imp.nets.map((n) => ({ ...n, cls: classOf.get(n.name) ?? n.cls, pins: n.pins.map((p) => ({ ...p })) }))
  if (mode === 'replace') {
    const parts: Part[] = imp.parts.map((p) => ({ id: uid('p'), ref: p.ref, value: p.value, fp: p.fp, x: 0, y: 0, rot: 0, side: 'F' as const }))
    report.added = imp.parts.map((p) => p.ref)
    return { design: { ...d, name: d.name === 'untitled' ? imp.name : d.name, parts, nets, tracks: [], vias: [], zones: d.zones.map((z) => ({ ...z })) }, report }
  }
  const have = new Map(d.parts.map((p) => [p.ref, p]))
  const incoming = new Set(imp.parts.map((p) => p.ref))
  const parts: Part[] = []
  for (const p of d.parts) {
    if (incoming.has(p.ref)) {
      const n = imp.parts.find((q) => q.ref === p.ref)!
      if (n.fp !== p.fp || (n.value !== p.value && n.value)) {
        report.changed.push(p.ref)
        parts.push({ ...p, fp: n.fp, value: n.value || p.value, stale: false })
      } else parts.push(p.stale ? { ...p, stale: false } : p)
    } else {
      if (!p.stale) report.removed.push(p.ref)
      parts.push({ ...p, stale: true })
    }
  }
  imp.parts.forEach((p) => {
    if (have.has(p.ref)) return
    report.added.push(p.ref)
    parts.push({ id: uid('p'), ref: p.ref, value: p.value, fp: p.fp, x: 0, y: 0, rot: 0, side: 'F' })
  })
  return { design: { ...d, name: d.name === 'untitled' ? imp.name : d.name, parts, nets }, report }
}
