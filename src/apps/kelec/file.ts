// The .kelec file: JSON  {format: "kelec", version: 1, parts, wires, labels, notes, sim}.

import { PART_DEFS, defaultProps, emptyDoc, type Doc, type Note, type Part, type PartKind, type Rot } from './model.ts'
import { DEFAULT_SETTINGS, type SimSettings } from './settings.ts'

export interface KelecFile {
  format: 'kelec'
  version: 1
  name?: string
  parts: Part[]
  wires: Doc['wires']
  labels: Doc['labels']
  notes: Note[]
  sim: SimSettings
  /** the text of the netlist tab, when it was used */
  netlist?: string
}

export function toKelec(doc: Doc, sim: SimSettings, name?: string, netlist?: string): KelecFile {
  const f: KelecFile = { format: 'kelec', version: 1, parts: doc.parts, wires: doc.wires, labels: doc.labels, notes: doc.notes, sim }
  if (name) f.name = name
  if (netlist?.trim()) f.netlist = netlist
  return f
}

export const serializeKelec = (doc: Doc, sim: SimSettings, name?: string, netlist?: string): string => JSON.stringify(toKelec(doc, sim, name, netlist), null, 2) + '\n'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : isNum(v) ? String(v) : d)

export interface Loaded { doc: Doc; sim: SimSettings; name: string; netlist: string }

/** Reads a .kelec file; throws a readable error when it is not one. Unknown parts are skipped. */
export function parseKelec(text: string): Loaded {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This is not a kElec file (it is not valid JSON).') }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'kelec') throw new Error('This is not a kElec file (the format field should be “kelec”).')
  const o = raw as Record<string, unknown>
  if (isNum(o.version) && o.version > 1) throw new Error(`This file was made by a newer kElec (version ${o.version}).`)
  const doc = emptyDoc()
  const ids = new Set<string>()
  const uid = (id: unknown, prefix: string) => {
    let s = typeof id === 'string' && id && !ids.has(id) ? id : `${prefix}${ids.size}_${Math.random().toString(36).slice(2, 6)}`
    while (ids.has(s)) s += 'x'
    ids.add(s)
    return s
  }
  for (const p of Array.isArray(o.parts) ? o.parts : []) {
    const q = p as Partial<Part>
    if (!q || typeof q.kind !== 'string' || !(q.kind in PART_DEFS)) continue
    const kind = q.kind as PartKind
    const rot = ([0, 90, 180, 270] as number[]).includes(q.rot as number) ? (q.rot as Rot) : 0
    const props = { ...defaultProps(kind) }
    if (q.props && typeof q.props === 'object') for (const [k, v] of Object.entries(q.props)) props[k] = str(v)
    doc.parts.push({ id: uid(q.id, 'p'), kind, ref: str(q.ref), value: q.value === undefined ? PART_DEFS[kind].value?.default ?? '' : str(q.value), x: isNum(q.x) ? q.x : 0, y: isNum(q.y) ? q.y : 0, rot, mirror: !!q.mirror, props })
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
  const sim: SimSettings = { ...DEFAULT_SETTINGS }
  if (o.sim && typeof o.sim === 'object') {
    const s = o.sim as Record<string, unknown>
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SimSettings)[]) {
      if (k === 'uic') sim.uic = !!s.uic
      else if (k === 'analysis') { if (['op', 'dc', 'ac', 'tran'].includes(str(s.analysis))) sim.analysis = s.analysis as SimSettings['analysis'] } else if (s[k] !== undefined) (sim as unknown as Record<string, string>)[k] = str(s[k])
    }
  }
  return { doc, sim, name: str(o.name), netlist: str(o.netlist) }
}
