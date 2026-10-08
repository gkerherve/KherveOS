// Checks on a circuit before it is simulated, in plain language, pointing at the parts involved.

import type { Circuit, Elem } from './circuit.ts'
import { isGround } from './circuit.ts'

export interface Problem {
  level: 'error' | 'warning' | 'info'
  code: 'no-ground' | 'floating' | 'no-dc-path' | 'source-loop' | 'shorted-source' | 'empty' | 'inductor-loop' | 'unconnected' | 'bad-value'
  message: string
  /** element names */
  refs: string[]
  /** node names */
  nodes: string[]
}

class UF {
  parent = new Map<string, string>()
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a)
    let r = a
    while (this.parent.get(r) !== r) r = this.parent.get(r)!
    let c = a
    while (this.parent.get(c) !== r) { const nx = this.parent.get(c)!; this.parent.set(c, r); c = nx }
    return r
  }
  union(a: string, b: string): boolean {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    this.parent.set(ra, rb)
    return true
  }
}

const g = (n: string) => (isGround(n) ? '0' : n)

/** Pairs of nodes joined by a DC path through the element (capacitors and current sources do not conduct). */
function dcEdges(e: Elem): [string, string][] {
  switch (e.kind) {
    case 'R': case 'L': case 'V': case 'D': case 'S': return [[g(e.nodes[0]), g(e.nodes[1])]]
    case 'E': return [[g(e.nodes[0]), g(e.nodes[1])]]
    case 'G': return []
    case 'Q': return [[g(e.nodes[0]), g(e.nodes[2])], [g(e.nodes[1]), g(e.nodes[2])]]
    case 'M': return [[g(e.nodes[0]), g(e.nodes[2])]]
    case 'B': return [[g(e.nodes[0]), '0']]
    default: return []
  }
}

/** Pairs joined at all (a capacitor couples its nodes for AC and transient). */
function anyEdges(e: Elem): [string, string][] {
  if (e.kind === 'K') return []
  if (e.kind === 'C' || e.kind === 'I' || e.kind === 'G') return [[g(e.nodes[0]), g(e.nodes[1])]]
  const d = dcEdges(e)
  if (e.kind === 'M') return [...d, [g(e.nodes[1]), g(e.nodes[2])]]
  return d
}

export function diagnose(circuit: Circuit): Problem[] {
  const out: Problem[] = []
  const els = circuit.elements.filter((e) => e.kind !== 'K')
  if (els.length === 0) {
    return [{ level: 'info', code: 'empty', message: 'The circuit is empty: place a few parts from the palette and join them with wires.', refs: [], nodes: [] }]
  }
  const touches = (n: string) => els.some((e) => 'nodes' in e && e.nodes.some((x) => g(x) === n))
  if (!touches('0')) {
    out.push({ level: 'error', code: 'no-ground', message: 'There is no ground. Add a ground symbol (G) to the node that should be 0 V; voltages are measured from it.', refs: [], nodes: [] })
  }
  // shorted / looped voltage sources
  const vloop = new UF()
  for (const e of els) {
    if (e.kind !== 'V' && e.kind !== 'E') continue
    const a = g(e.nodes[0])
    const b = g(e.nodes[1])
    if (a === b) {
      out.push({ level: 'error', code: 'shorted-source', message: `${e.name} has both of its terminals on the same net, so it is shorted out (or has nothing to drive). Check its wiring.`, refs: [e.name], nodes: [a] })
      continue
    }
    if (!vloop.union(a, b)) {
      out.push({ level: 'error', code: 'source-loop', message: `${e.name} is in a loop made only of voltage sources: their voltages cannot all be satisfied at once. Put a resistor in series with one of them.`, refs: [e.name], nodes: [a, b] })
    }
  }
  // inductor + voltage source loops are shorts in DC
  const dcLoop = new UF()
  for (const e of els) {
    if (e.kind !== 'V' && e.kind !== 'L') continue
    const a = g(e.nodes[0])
    const b = g(e.nodes[1])
    if (a === b) continue
    if (!dcLoop.union(a, b) && e.kind === 'L' && !out.some((o) => o.refs.includes(e.name))) {
      out.push({ level: 'warning', code: 'inductor-loop', message: `${e.name} closes a loop of inductors and voltage sources. In DC an inductor is a wire, so this behaves like a short circuit.`, refs: [e.name], nodes: [a, b] })
    }
  }
  // connectivity to ground, with and without capacitors
  const dc = new UF()
  const all = new UF()
  const nodes = new Set<string>()
  for (const e of els) {
    for (const n of e.nodes) nodes.add(g(n))
    for (const [a, b] of dcEdges(e)) { dc.union(a, b); all.union(a, b) }
    for (const [a, b] of anyEdges(e)) all.union(a, b)
  }
  nodes.delete('0')
  const refsAt = (n: string) => els.filter((e) => e.nodes.some((x) => g(x) === n)).map((e) => e.name)
  const seenRoots = new Set<string>()
  if (touches('0')) {
    for (const n of nodes) {
      if (dc.find(n) === dc.find('0')) continue
      const root = all.find(n)
      if (all.find(n) !== all.find('0')) {
        const key = 'f' + root
        if (seenRoots.has(key)) continue
        seenRoots.add(key)
        const group = [...nodes].filter((m) => all.find(m) === root)
        const refs = [...new Set(group.flatMap(refsAt))]
        out.push({
          level: 'warning', code: 'floating',
          message: `Part of the circuit (${refs.slice(0, 4).join(', ')}${refs.length > 4 ? '…' : ''}) is not connected to the rest or to ground, so its voltages are meaningless. Join it to a ground or to the main circuit.`,
          refs, nodes: group,
        })
      } else {
        const key = 'd' + dc.find(n)
        if (seenRoots.has(key)) continue
        seenRoots.add(key)
        const group = [...nodes].filter((m) => dc.find(m) === dc.find(n))
        const refs = [...new Set(group.flatMap(refsAt))]
        out.push({
          level: 'warning', code: 'no-dc-path',
          message: `Node${group.length > 1 ? 's' : ''} ${group.slice(0, 4).join(', ')} ${group.length > 1 ? 'have' : 'has'} no DC path to ground (only capacitors or current sources reach ${group.length > 1 ? 'them' : 'it'}). The DC voltage there is undefined and shows as 0 V: add a resistor to ground.`,
          refs, nodes: group,
        })
      }
    }
  }
  return out
}
