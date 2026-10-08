// Bill of materials and pick-and-place files (pure).

import { frameBox } from '../layers.ts'
import { getFootprint } from '../footprints.ts'
import type { Design, Part } from '../types.ts'

export interface BomLine {
  qty: number
  refs: string[]
  value: string
  footprint: string
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Parts that are bought and soldered (not mounting holes). */
const fitted = (p: Part) => !p.fp.startsWith('MountingHole')

/** Parts grouped by value and footprint, references in natural order. */
export function bom(d: Design): BomLine[] {
  const groups = new Map<string, BomLine>()
  for (const p of d.parts.filter(fitted)) {
    const key = `${p.value}\u0000${p.fp}`
    const g = groups.get(key) ?? { qty: 0, refs: [], value: p.value, footprint: p.fp }
    g.qty++
    g.refs.push(p.ref)
    groups.set(key, g)
  }
  const lines = [...groups.values()]
  for (const l of lines) l.refs.sort(natural)
  return lines.sort((a, b) => natural(a.refs[0], b.refs[0]))
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function bomCsv(d: Design): string {
  const rows = [['Qty', 'References', 'Value', 'Footprint'], ...bom(d).map((l) => [String(l.qty), l.refs.join(' '), l.value, l.footprint])]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function bomMarkdown(d: Design): string {
  const lines = bom(d)
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  return [
    `# Bill of materials: ${d.name}`,
    '',
    '| Qty | References | Value | Footprint |',
    '| ---: | --- | --- | --- |',
    ...lines.map((l) => `| ${l.qty} | ${esc(l.refs.join(', '))} | ${esc(l.value)} | ${esc(l.footprint)} |`),
    '',
    `${lines.reduce((n, l) => n + l.qty, 0)} parts, ${lines.length} different.`,
    '',
  ].join('\n')
}

/** Pick-and-place: positions in mm from the lower left corner of the board, y up, rotation counter-clockwise. */
export function pickAndPlaceCsv(d: Design, smdOnly = false): string {
  const f = frameBox(d)
  const rows: string[][] = [['Ref', 'Val', 'Package', 'PosX', 'PosY', 'Rot', 'Side']]
  const parts = d.parts.filter(fitted).filter((p) => !smdOnly || getFootprint(p.fp)?.smd)
  for (const p of [...parts].sort((a, b) => natural(a.ref, b.ref))) {
    rows.push([
      p.ref, p.value, p.fp, (p.x - f.x0).toFixed(3), (f.y1 - p.y).toFixed(3), String(((Math.round(p.rot * 1000) / 1000) % 360 + 360) % 360), p.side === 'F' ? 'top' : 'bottom',
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}
