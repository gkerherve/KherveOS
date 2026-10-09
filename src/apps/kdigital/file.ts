// The .kdig file: JSON  {format: "kdig", version: 1, circuit, probes, stimulus, expressions, fsm, settings …}.
// One file holds the whole workbench: the schematic, the timing probes and stimulus, the Boolean functions, the
// state machine and the simulation settings. Pure.

import { KIND_DEFS, defaultProps, emptyDoc, type Doc, type Kind, type Part, type Rot } from './model.ts'
import { DEFAULT_SIM, readPartialSettings, type SimSettings } from './sim.ts'
import { emptyFsm, type Encoding, type Fsm } from './fsm.ts'
import type { Probe } from './wave.ts'
import type { LogicStyle } from './layout.ts'

export type TabId = 'circuit' | 'boolean' | 'fsm' | 'numbers' | 'hdl'

export interface Step { t: number; set: Record<string, string | number> }

export interface BooleanState { text: string; style: LogicStyle; /** which output is drawn on the Karnaugh map */ focus?: string }
export interface NumbersState { value: string; base: number; bits: number }

export interface KdigFile {
  format: 'kdig'
  version: 1
  name?: string
  description?: string
  tab?: TabId
  circuit?: Doc
  probes?: Probe[]
  stimulus?: Step[]
  until?: number
  sim?: Partial<SimSettings>
  boolean?: BooleanState
  fsm?: Fsm
  numbers?: NumbersState
}

export const TAB_IDS: TabId[] = ['circuit', 'boolean', 'fsm', 'numbers', 'hdl']

/** The same drawing with its ids numbered p1…, w1…, l1…, n1… in the order of the lists (so the same text comes out every time). */
export function canonicalIds(doc: Doc): Doc {
  return {
    parts: doc.parts.map((p, i) => ({ ...p, id: `p${i + 1}`, props: sortedProps(p.props) })),
    wires: doc.wires.map((w, i) => ({ ...w, id: `w${i + 1}` })),
    labels: doc.labels.map((l, i) => ({ ...l, id: `l${i + 1}` })),
    notes: doc.notes.map((n, i) => ({ ...n, id: `n${i + 1}` })),
  }
}

function sortedProps(props: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(props).sort()) out[k] = props[k]
  return out
}

export interface NewFileOptions { name?: string }

export function emptyFile(name = 'Untitled'): KdigFile {
  return { format: 'kdig', version: 1, name, circuit: emptyDoc(), boolean: { text: 'F = A & B | !C', style: 'as-is' }, fsm: emptyFsm(), numbers: { value: '42', base: 10, bits: 8 } }
}

export const serializeKdig = (f: KdigFile): string => JSON.stringify(f, null, 2) + '\n'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : isNum(v) ? String(v) : d)

/** Reads a .kdig file; throws a readable error when it is not one. Unknown parts are skipped. */
export function parseKdig(text: string): KdigFile {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This is not a kDigital file (it is not valid JSON).') }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'kdig') throw new Error('This is not a kDigital file (the format field should be “kdig”).')
  const o = raw as Record<string, unknown>
  if (isNum(o.version) && o.version > 1) throw new Error(`This file was made by a newer kDigital (version ${o.version}).`)
  const out: KdigFile = { format: 'kdig', version: 1 }
  if (typeof o.name === 'string') out.name = o.name
  if (typeof o.description === 'string') out.description = o.description
  if (typeof o.tab === 'string' && (TAB_IDS as string[]).includes(o.tab)) out.tab = o.tab as TabId
  out.circuit = parseDoc(o.circuit)
  if (Array.isArray(o.probes)) out.probes = o.probes.flatMap(readProbe)
  if (Array.isArray(o.stimulus)) out.stimulus = o.stimulus.flatMap(readStep)
  if (isNum(o.until) && o.until > 0) out.until = Math.round(o.until)
  if (o.sim && typeof o.sim === 'object') out.sim = readPartialSettings(o.sim)
  if (o.boolean && typeof o.boolean === 'object') {
    const b = o.boolean as Record<string, unknown>
    const style = ['as-is', 'sop', 'pos', 'nand', 'nor'].includes(str(b.style)) ? (b.style as LogicStyle) : 'as-is'
    out.boolean = { text: str(b.text), style, ...(typeof b.focus === 'string' ? { focus: b.focus } : {}) }
  }
  if (o.fsm && typeof o.fsm === 'object') out.fsm = readFsm(o.fsm as Record<string, unknown>)
  if (o.numbers && typeof o.numbers === 'object') {
    const n = o.numbers as Record<string, unknown>
    out.numbers = { value: str(n.value, '0'), base: [2, 8, 10, 16].includes(Number(n.base)) ? Number(n.base) : 10, bits: Math.min(64, Math.max(2, Math.round(Number(n.bits) || 8))) }
  }
  return out
}

function readProbe(p: unknown): Probe[] {
  const q = p as Record<string, unknown>
  if (!q || typeof q.name !== 'string' || !Array.isArray(q.bits)) return []
  const bits = q.bits.filter((b): b is string => typeof b === 'string')
  if (bits.length === 0) return []
  const probe: Probe = { name: q.name, bits }
  if (q.radix === 'hex' || q.radix === 'decimal' || q.radix === 'binary') probe.radix = q.radix
  return [probe]
}

function readStep(s: unknown): Step[] {
  const q = s as Record<string, unknown>
  if (!q || !isNum(q.t) || q.t < 0 || !q.set || typeof q.set !== 'object') return []
  const set: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(q.set as Record<string, unknown>)) if (typeof v === 'string' || isNum(v)) set[k] = v
  return [{ t: Math.round(q.t), set }]
}

export function parseDoc(raw: unknown): Doc {
  const doc = emptyDoc()
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = new Set<string>()
  const refs = new Set<string>()
  const uid = (id: unknown, prefix: string) => {
    let s = typeof id === 'string' && id && !ids.has(id) ? id : `${prefix}${ids.size}_${Math.random().toString(36).slice(2, 6)}`
    while (ids.has(s)) s += 'x'
    ids.add(s)
    return s
  }
  for (const p of Array.isArray(o.parts) ? o.parts : []) {
    const q = p as Partial<Part>
    if (!q || typeof q.kind !== 'string' || !(q.kind in KIND_DEFS)) continue
    const kind = q.kind as Kind
    const rot = ([0, 90, 180, 270] as number[]).includes(q.rot as number) ? (q.rot as Rot) : 0
    const props = { ...defaultProps(kind) }
    if (q.props && typeof q.props === 'object') for (const [k, v] of Object.entries(q.props)) props[k] = str(v)
    let ref = str(q.ref) || `${KIND_DEFS[kind].prefix}${refs.size + 1}`
    while (refs.has(ref)) ref += '_'
    refs.add(ref)
    doc.parts.push({ id: uid(q.id, 'p'), kind, ref, x: isNum(q.x) ? q.x : 0, y: isNum(q.y) ? q.y : 0, rot, mirror: !!q.mirror, props })
  }
  for (const w of Array.isArray(o.wires) ? o.wires : []) {
    const q = w as Record<string, unknown>
    if (isNum(q.x1) && isNum(q.y1) && isNum(q.x2) && isNum(q.y2)) doc.wires.push({ id: uid(q.id, 'w'), x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2 })
  }
  for (const l of Array.isArray(o.labels) ? o.labels : []) {
    const q = l as Record<string, unknown>
    if (isNum(q.x) && isNum(q.y) && typeof q.name === 'string') {
      const label: Doc['labels'][number] = { id: uid(q.id, 'l'), name: q.name, x: q.x, y: q.y }
      if (typeof q.flip === 'boolean') label.flip = q.flip
      doc.labels.push(label)
    }
  }
  for (const n of Array.isArray(o.notes) ? o.notes : []) {
    const q = n as Record<string, unknown>
    if (isNum(q.x) && isNum(q.y) && typeof q.text === 'string') doc.notes.push({ id: uid(q.id, 'n'), text: q.text, x: q.x, y: q.y })
  }
  return doc
}

function readFsm(o: Record<string, unknown>): Fsm {
  const f = emptyFsm()
  f.name = str(o.name, 'Machine')
  f.type = o.type === 'mealy' ? 'mealy' : 'moore'
  if (Array.isArray(o.inputs)) f.inputs = o.inputs.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  if (Array.isArray(o.outputs)) f.outputs = o.outputs.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  f.encoding = (['binary', 'gray', 'onehot'] as Encoding[]).includes(o.encoding as Encoding) ? (o.encoding as Encoding) : 'binary'
  const ids = new Set<string>()
  for (const s of Array.isArray(o.states) ? o.states : []) {
    const q = s as Record<string, unknown>
    if (!q || typeof q.id !== 'string' || ids.has(q.id)) continue
    ids.add(q.id)
    f.states.push({ id: q.id, name: str(q.name, q.id), x: isNum(q.x) ? q.x : 0, y: isNum(q.y) ? q.y : 0, out: str(q.out), ...(q.initial ? { initial: true } : {}) })
  }
  const tids = new Set<string>()
  for (const t of Array.isArray(o.transitions) ? o.transitions : []) {
    const q = t as Record<string, unknown>
    if (!q || typeof q.from !== 'string' || typeof q.to !== 'string' || !ids.has(q.from) || !ids.has(q.to)) continue
    let id = typeof q.id === 'string' && q.id ? q.id : `t${tids.size}`
    while (tids.has(id)) id += 'x'
    tids.add(id)
    f.transitions.push({ id, from: q.from, to: q.to, cond: str(q.cond), out: str(q.out), bend: isNum(q.bend) ? Math.max(-1.5, Math.min(1.5, q.bend)) : 0 })
  }
  return f
}

export { DEFAULT_SIM }
