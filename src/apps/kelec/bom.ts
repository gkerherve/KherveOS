// The bill of materials of a schematic: identical parts grouped, as CSV or a Markdown table (pure).

import { defOf, partLabel, type Doc, type Part } from './model.ts'
import { footprintFor } from './netlistExport.ts'

export interface BomRow { refs: string[]; qty: number; part: string; value: string; footprint: string }

const SKIP = new Set(['ground', 'voltmeter', 'ammeter'])

function natural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

export function bomOf(doc: Doc): BomRow[] {
  const groups = new Map<string, { parts: Part[] }>()
  for (const p of doc.parts) {
    if (SKIP.has(p.kind)) continue
    const k = `${p.kind}|${partLabel(p).value}|${p.value}|${JSON.stringify(p.props)}`
    const g = groups.get(k) ?? { parts: [] }
    g.parts.push(p)
    groups.set(k, g)
  }
  const rows: BomRow[] = [...groups.values()].map(({ parts }) => {
    const p = parts[0]
    return {
      refs: parts.map((x) => x.ref).sort(natural), qty: parts.length, part: defOf(p).name,
      value: partLabel(p).value || p.value, footprint: footprintFor(p) ?? '',
    }
  })
  return rows.sort((a, b) => natural(a.refs[0], b.refs[0]))
}

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function bomCsv(doc: Doc): string {
  const lines = ['References,Quantity,Part,Value,Footprint']
  for (const r of bomOf(doc)) lines.push([r.refs.join(' '), String(r.qty), r.part, r.value, r.footprint].map(q).join(','))
  return lines.join('\n') + '\n'
}

export function bomMarkdown(doc: Doc, title = 'Bill of materials'): string {
  const rows = bomOf(doc)
  const lines = [`# ${title}`, '', '| References | Qty | Part | Value | Footprint |', '|---|---:|---|---|---|']
  for (const r of rows) lines.push(`| ${r.refs.join(', ')} | ${r.qty} | ${r.part} | ${r.value.replace(/\|/g, '\\|')} | ${r.footprint} |`)
  lines.push('', `${rows.reduce((n, r) => n + r.qty, 0)} parts in ${rows.length} lines.`)
  return lines.join('\n') + '\n'
}
