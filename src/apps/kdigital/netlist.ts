// Schematic → nets: union-find over wire ends, pins and net labels, net names, and the problems a student
// would want to hear about (unconnected inputs, nets nobody drives, outputs wired together). Pure.

import { defOf, isSink, isSource, onSegment, pinPositions, signalName, type Doc, type Part } from './model.ts'

export interface NetPin { ref: string; pin: string; dir: 'in' | 'out' | 'pull' }
export interface NetInfo { index: number; name: string; pins: NetPin[]; labels: string[]; labelled: boolean }

export interface Problem { level: 'error' | 'warn' | 'info'; message: string; refs: string[] }

export interface Extracted {
  nets: NetInfo[]
  /** "U1.Y" → index into nets */
  pinNet: Map<string, number>
  /** "x,y" of a pin, label or wire end → index into nets */
  pointNet: Map<string, number>
  problems: Problem[]
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

export const pinKey = (ref: string, pin: string) => `${ref}.${pin}`

export function extractNets(doc: Doc): Extracted {
  const uf = new UF()
  const specials = new Set<string>()
  const pinKeys: { ref: string; pin: string; dir: NetPin['dir']; k: string }[] = []
  for (const part of doc.parts) {
    for (const pp of pinPositions(part)) {
      const k = key(pp.x, pp.y)
      specials.add(k)
      pinKeys.push({ ref: part.ref, pin: pp.name, dir: pp.dir, k })
    }
  }
  for (const l of doc.labels) {
    const k = key(l.x, l.y)
    specials.add(k)
    uf.union(k, `@label:${l.name.trim()}`)
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
  interface G { pins: NetPin[]; labels: string[]; points: string[]; first: number }
  const groups = new Map<string, G>()
  const grp = (r: string) => { let g = groups.get(r); if (!g) { g = { pins: [], labels: [], points: [], first: Infinity }; groups.set(r, g) } return g }
  for (const s of pts) grp(uf.find(s.k)).points.push(s.k)
  const partIndex = new Map(doc.parts.map((p, i) => [p.ref, i]))
  for (const pk of pinKeys) {
    const g = grp(uf.find(pk.k))
    g.pins.push({ ref: pk.ref, pin: pk.pin, dir: pk.dir })
    g.first = Math.min(g.first, partIndex.get(pk.ref) ?? Infinity)
  }
  for (const l of doc.labels) grp(uf.find(key(l.x, l.y))).labels.push(l.name.trim())
  const ordered = [...groups.values()].filter((g) => g.points.length > 0).sort((a, b) => a.first - b.first)
  // groups sharing a label name are one net
  const merged: G[] = []
  const byLabel = new Map<string, G>()
  for (const g of ordered) {
    const have = g.labels.map((n) => byLabel.get(n)).find(Boolean)
    if (have) {
      have.pins.push(...g.pins); have.labels.push(...g.labels); have.points.push(...g.points); have.first = Math.min(have.first, g.first)
      for (const n of g.labels) byLabel.set(n, have)
    } else {
      merged.push(g)
      for (const n of g.labels) byLabel.set(n, g)
    }
  }
  const byRef = new Map(doc.parts.map((p) => [p.ref, p]))
  const used = new Set<string>()
  const nets: NetInfo[] = []
  const pinNet = new Map<string, number>()
  const pointNet = new Map<string, number>()
  let auto = 0
  const uniq = (base: string) => {
    let n = base
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`
    used.add(n)
    return n
  }
  // names: labels win, then the name of an input or output part, then n1, n2…
  const named = merged.map((g) => {
    const label = g.labels.find((n) => n)
    if (label) return label
    for (const q of g.pins) {
      const p = byRef.get(q.ref)
      if (!p || !(isSource(p.kind) || isSink(p.kind)) || !signalName(p)) continue
      // a display with several pins names its nets after the pin: DIGIT_a, Count_B3
      return p.kind === 'seg7' || p.kind === 'hex' || p.kind === 'probe' ? `${signalName(p)}_${q.pin}` : signalName(p)
    }
    return ''
  })
  merged.forEach((_g, i) => { if (named[i]) named[i] = uniq(named[i]) })
  merged.forEach((g, i) => {
    let name = named[i]
    if (!name) { do { auto++ } while (used.has(`n${auto}`)); name = `n${auto}`; used.add(name) }
    const index = nets.length
    nets.push({ index, name, pins: g.pins, labels: [...new Set(g.labels)], labelled: g.labels.length > 0 })
    for (const q of g.pins) pinNet.set(pinKey(q.ref, q.pin), index)
    for (const k of g.points) pointNet.set(k, index)
  })
  return { nets, pinNet, pointNet, problems: diagnose(doc, nets, pinNet) }
}

function diagnose(doc: Doc, nets: NetInfo[], pinNet: Map<string, number>): Problem[] {
  const problems: Problem[] = []
  if (doc.parts.length === 0) return [{ level: 'info', message: 'The sheet is empty: add inputs, gates and outputs from the palette.', refs: [] }]
  const byRef = new Map(doc.parts.map((p) => [p.ref, p]))
  const seenRefs = new Set<string>()
  for (const p of doc.parts) {
    if (seenRefs.has(p.ref)) problems.push({ level: 'error', message: `Two parts are called ${p.ref}.`, refs: [p.ref] })
    seenRefs.add(p.ref)
  }
  for (const part of doc.parts) {
    const def = defOf(part)
    if (def.kind === 'pull') continue
    for (const pin of pinPositions(part)) {
      if (pin.dir !== 'in') continue
      const net = nets[pinNet.get(pinKey(part.ref, pin.name)) ?? -1]
      const shape = def.shape(part).pins.find((q) => q.name === pin.name)
      const alone = !net || (net.pins.length <= 1 && !net.labelled)
      if (alone) {
        if (shape?.def === undefined) problems.push({ level: 'warn', message: `${part.ref}.${pin.name} is not connected: it reads as unknown (X).`, refs: [part.ref] })
        continue
      }
      const driven = net.pins.some((q) => q.dir === 'out' || q.dir === 'pull')
      if (!driven && shape?.def === undefined) problems.push({ level: 'warn', message: `${part.ref}.${pin.name} is on net ${net.name}, which nothing drives.`, refs: [part.ref] })
    }
  }
  for (const net of nets) {
    const drivers = net.pins.filter((q) => q.dir === 'out')
    const nonTri = drivers.filter((q) => byRef.get(q.ref)?.kind !== 'tribuf')
    if (drivers.length > 1 && nonTri.length > 0) {
      problems.push({ level: 'error', message: `Net ${net.name} has ${drivers.length} outputs wired together (${drivers.map((q) => `${q.ref}.${q.pin}`).join(', ')}): they can fight. Use tri-state buffers to share a line.`, refs: [...new Set(drivers.map((q) => q.ref))] })
    }
  }
  const names = new Map<string, Part[]>()
  for (const p of doc.parts) {
    const n = signalName(p)
    if (n && (isSource(p.kind) || isSink(p.kind))) names.set(n, [...(names.get(n) ?? []), p])
  }
  for (const [n, list] of names) {
    const sources = list.filter((p) => isSource(p.kind))
    if (sources.length > 1) problems.push({ level: 'warn', message: `Several inputs are named ${n}: the timing diagram and the AI tools cannot tell them apart.`, refs: sources.map((p) => p.ref) })
  }
  return problems
}

/** The pins that belong to the net of a given pin or label name. */
export function netByName(ex: Extracted, name: string): NetInfo | undefined {
  return ex.nets.find((n) => n.name === name || n.labels.includes(name))
}

/** The net a "target" refers to: a net/label name, a signal name of an input or output, or a pin "U1.Y". */
export function resolveTarget(doc: Doc, ex: Extracted, target: string): NetInfo | undefined {
  const t = target.trim()
  if (/^[A-Za-z]+\d*\.[A-Za-z0-9]+$/.test(t)) {
    const i = ex.pinNet.get(t)
    if (i !== undefined) return ex.nets[i]
  }
  const direct = netByName(ex, t)
  if (direct) return direct
  const part = doc.parts.find((p) => signalName(p) === t || p.ref === t)
  if (part) {
    const pin = defOf(part).shape(part).pins[0]
    if (pin) {
      const i = ex.pinNet.get(pinKey(part.ref, pin.name))
      if (i !== undefined) return ex.nets[i]
    }
  }
  return undefined
}
