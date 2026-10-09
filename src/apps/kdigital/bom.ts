// The bill of parts of a circuit: counts by kind and the total number of gate inputs. Pure.

import { defOf, isSink, isSource, propNum, type Doc } from './model.ts'

const GATES = new Set(['buf', 'not', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'tribuf'])
const SEQUENTIAL = new Set(['srlatch', 'dlatch', 'dff', 'jkff', 'tff', 'register', 'counter', 'shift', 'ram'])

export interface GateCount {
  total: number
  gates: number
  sequential: number
  inputs: number
  outputs: number
  /** the number of inputs of all the simple gates */
  gateInputs: number
  rows: { name: string; count: number }[]
}

export function gateCount(doc: Doc): GateCount {
  const by = new Map<string, number>()
  let gates = 0, sequential = 0, inputs = 0, outputs = 0, gateInputs = 0
  for (const p of doc.parts) {
    let name = defOf(p).name
    if (GATES.has(p.kind)) {
      gates++
      const n = p.kind === 'buf' || p.kind === 'not' || p.kind === 'tribuf' ? 1 : propNum(p, 'inputs', 2, 2, 8)
      gateInputs += n
      if (n > 1 || p.kind === 'tribuf') name = p.kind === 'tribuf' ? name : `${name} (${n} inputs)`
    }
    if (SEQUENTIAL.has(p.kind)) sequential++
    if (isSource(p.kind)) inputs++
    if (isSink(p.kind)) outputs++
    by.set(name, (by.get(name) ?? 0) + 1)
  }
  return { total: doc.parts.length, gates, sequential, inputs, outputs, gateInputs, rows: [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }
}

/** The bill of parts as CSV. */
export function bomCsv(doc: Doc): string {
  const rows = gateCount(doc).rows
  return ['Part,Count', ...rows.map((r) => `"${r.name.replace(/"/g, '""')}",${r.count}`)].join('\n') + '\n'
}
