// Samples and materials (pure): the lineage tree, the inventory → reaction table link, and the label sheet
// (a Code-128 barcode of the sample ID plus text, as an HTML page for printing or PDF).

import { code128Svg } from './code128.ts'
import { esc } from './blocks.ts'
import { textToBase64 } from './hash.ts'
import { newReagent, type Reagent, type ReagentRole } from './reaction.ts'
import type { InventoryItem, Notebook, Sample } from './model.ts'
import { molarMass } from './formula.ts'

export interface LineageNode {
  sample: Sample
  children: LineageNode[]
}

/** The forest of samples: roots are those with no (known) parent; a sample with two parents appears under each. */
export function lineageForest(samples: readonly Sample[]): LineageNode[] {
  const byId = new Map(samples.map((s) => [s.id, s]))
  const kids = new Map<string, Sample[]>()
  for (const s of samples) for (const p of s.parents) if (byId.has(p)) kids.set(p, [...(kids.get(p) ?? []), s])
  const build = (s: Sample, seen: Set<string>): LineageNode => ({
    sample: s,
    children: (kids.get(s.id) ?? []).filter((c) => !seen.has(c.id)).map((c) => build(c, new Set([...seen, s.id]))),
  })
  return samples.filter((s) => !s.parents.some((p) => byId.has(p))).map((s) => build(s, new Set()))
}

/** A sample's ancestors (nearest first, each once). */
export function ancestors(samples: readonly Sample[], id: string): Sample[] {
  const byId = new Map(samples.map((s) => [s.id, s]))
  const out: Sample[] = []
  const seen = new Set<string>([id])
  let layer = byId.get(id)?.parents ?? []
  while (layer.length) {
    const next: string[] = []
    for (const pid of layer) {
      const s = byId.get(pid)
      if (!s || seen.has(pid)) continue
      seen.add(pid)
      out.push(s)
      next.push(...s.parents)
    }
    layer = next
  }
  return out
}

/** A sample's descendants (nearest first, each once). */
export function descendants(samples: readonly Sample[], id: string): Sample[] {
  const out: Sample[] = []
  const seen = new Set<string>([id])
  let layer = [id]
  while (layer.length) {
    const next: string[] = []
    for (const s of samples) {
      if (!seen.has(s.id) && s.parents.some((p) => layer.includes(p))) {
        seen.add(s.id)
        out.push(s)
        next.push(s.id)
      }
    }
    layer = next
  }
  return out
}

/** The tree around one sample as indented text, for the inspector and the exports. */
export function lineageText(samples: readonly Sample[], id: string): string {
  const root = ancestors(samples, id).filter((a) => a.parents.length === 0)[0]?.id ?? id
  const lines: string[] = []
  const walk = (n: LineageNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${depth ? '└ ' : ''}${n.sample.id}  ${n.sample.name}${n.sample.id === id ? '   ← this sample' : ''}`)
    n.children.forEach((c) => walk(c, depth + 1))
  }
  const forest = lineageForest(samples).find((t) => t.sample.id === root)
  if (forest) walk(forest, 0)
  return lines.join('\n')
}

/** The entries (experiment numbers) that mention or link a sample. */
export function entriesUsing(nb: Notebook, sampleId: string): string[] {
  return nb.entries.filter((e) => e.samples.includes(sampleId) || JSON.stringify(e.content).includes(`"id":"${sampleId}"`)).map((e) => e.id)
}

// ------------------------------------------------------------------ inventory

/** A reaction table row from an inventory line (MW from the line, else from its formula). */
export function reagentFromInventory(item: InventoryItem, role: ReagentRole = 'reactant'): Reagent {
  return newReagent(role, { name: item.name, formula: item.formula, mw: item.mw ?? (item.formula ? molarMass(item.formula) : null), density: item.density, cas: item.cas })
}

export function inventoryMatches(items: readonly InventoryItem[], query: string): InventoryItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((i) => [i.name, i.formula, i.cas, i.supplier, i.location, i.hazard].some((f) => f.toLowerCase().includes(q)))
}

// ------------------------------------------------------------------ labels

export interface LabelOptions {
  /** Label size in millimetres. */
  widthMm: number
  heightMm: number
  /** Labels per row on the sheet. */
  columns: number
  title: string
  /** Extra lines under the name: composition, batch, location… */
  fields: Array<'composition' | 'batch' | 'location' | 'made' | 'project'>
}

export const DEFAULT_LABEL: LabelOptions = { widthMm: 60, heightMm: 30, columns: 3, title: 'Sample labels', fields: ['batch', 'location', 'made'] }

export function labelHtml(s: Sample, nb: Notebook, o: LabelOptions): string {
  const svg = code128Svg(s.id, { module: 1.3, height: 26, caption: false, quiet: 4 })
  const project = nb.projects.find((p) => p.id === s.projectId)?.code ?? ''
  const field = (f: LabelOptions['fields'][number]): string => (f === 'project' ? project : s[f])
  const lines = o.fields.map((f) => [f, field(f)] as const).filter(([, v]) => v).map(([f, v]) => `${f === 'made' ? 'Made' : f === 'composition' ? '' : f[0].toUpperCase() + f.slice(1) + ': '}${v}`)
  return `<div class="lab"><div class="lab-id">${esc(s.id)}</div><div class="lab-name">${esc(s.name)}</div><div class="lab-bar"><img alt="${esc(s.id)}" height="${(26 * 1.0).toFixed(0)}" src="data:image/svg+xml;base64,${textToBase64(svg)}"/></div>` +
    `<div class="lab-lines">${lines.map((l) => esc(l)).join('<br/>')}</div></div>`
}

/** The whole label sheet as an XHTML page (fixed-size cells in a table, so print and the PDF engine both lay it out). */
export function labelSheetHtml(samples: readonly Sample[], nb: Notebook, o: LabelOptions = DEFAULT_LABEL): string {
  const rows: Sample[][] = []
  for (let i = 0; i < samples.length; i += o.columns) rows.push(samples.slice(i, i + o.columns))
  const css = `@page{size:A4;margin:10mm}body{font-family:Helvetica,Arial,sans-serif;margin:0}` +
    `table{border-collapse:collapse}td{width:${o.widthMm}mm;height:${o.heightMm}mm;border:0.3mm dashed #999;padding:1.5mm;vertical-align:top;overflow:hidden}` +
    `.lab-id{font-weight:bold;font-size:11pt}.lab-name{font-size:8.5pt}.lab-lines{font-size:7pt;color:#333}.lab-bar{margin:1mm 0}h1{font-size:12pt}`
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>${esc(o.title)}</title><style>${css}</style></head><body>` +
    `<table><tbody>${rows.map((r) => `<tr>${Array.from({ length: o.columns }, (_, i) => `<td>${r[i] ? labelHtml(r[i], nb, o) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
}
