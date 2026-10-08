// Results drawn on the schematic: a voltage on every net and a current beside every part (pure).

import { partBounds, type Doc } from './model.ts'
import type { BuildResult } from './netlist.ts'
import type { OpResult } from './sim/engine.ts'
import { formatValue } from './sim/units.ts'

export interface Annot {
  x: number
  y: number
  text: string
  kind: 'voltage' | 'current' | 'meter'
  /** the net or part reference it belongs to */
  of: string
}

const volts = (v: number) => formatValue(Math.abs(v) < 1e-9 ? 0 : v, 3, 'V')
const amps = (v: number) => formatValue(Math.abs(v) < 1e-13 ? 0 : v, 3, 'A')

/** One anchor per net: the middle of its longest wire, or a pin when it has no wire. */
export function netAnchors(doc: Doc, build: BuildResult): Map<string, { x: number; y: number }> {
  const best = new Map<string, { len: number; x: number; y: number }>()
  for (const w of doc.wires) {
    const net = build.pointNet.get(`${w.x1},${w.y1}`)
    if (!net) continue
    const len = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1)
    const cur = best.get(net)
    if (!cur || len > cur.len) best.set(net, { len, x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 })
  }
  const out = new Map<string, { x: number; y: number }>()
  for (const [n, b] of best) out.set(n, { x: b.x, y: b.y })
  for (const [k, net] of build.pointNet) {
    if (out.has(net)) continue
    const [x, y] = k.split(',').map(Number)
    out.set(net, { x, y })
  }
  return out
}

export function annotations(doc: Doc, build: BuildResult, op: OpResult, opts: { voltages?: boolean; currents?: boolean } = {}): Annot[] {
  const out: Annot[] = []
  if (opts.voltages !== false) {
    const anchors = netAnchors(doc, build)
    for (const [net, a] of anchors) {
      if (net === '0') continue
      const v = op.nodes[net]
      if (v === undefined) continue
      out.push({ x: a.x, y: a.y - 6, text: volts(v), kind: 'voltage', of: net })
    }
  }
  for (const m of build.meters) {
    const part = doc.parts.find((p) => p.ref === m.ref)
    if (!part) continue
    const b = partBounds(part)
    const text = m.kind === 'voltmeter' ? volts((op.nodes[m.plus] ?? 0) - (op.nodes[m.minus] ?? 0)) : amps(op.currents[m.element] ?? 0)
    out.push({ x: (b.x1 + b.x2) / 2, y: b.y2 + 14, text, kind: 'meter', of: m.ref })
  }
  if (opts.currents !== false) {
    for (const part of doc.parts) {
      if (part.kind === 'ground' || part.kind === 'voltmeter' || part.kind === 'ammeter') continue
      const els = build.elementsOf.get(part.ref)
      if (!els || els.length === 0) continue
      const name = els.find((e) => op.currents[e] !== undefined)
      if (!name) continue
      const i = op.currents[name]
      const b = partBounds(part)
      out.push({ x: (b.x1 + b.x2) / 2, y: b.y2 + 13, text: amps(i), kind: 'current', of: part.ref })
    }
  }
  return out
}
