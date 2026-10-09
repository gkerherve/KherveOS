// The structured blocks that can be inserted into an entry's text (pure): their data, defaults, and how each one is
// written as HTML (well-formed XHTML, also used for the PDF), Markdown and searchable text.

import { computeReaction, columnStats, equationText, fmt, fmtPct, meanSd, newMeasurements, newReaction, reagentMw, type MeasurementData, type ReactionData } from './reaction.ts'
import { plotSvg } from './plot.ts'
import { textToBase64 } from './hash.ts'

// ------------------------------------------------------------------ data

export interface MaterialItem {
  name: string
  cas: string
  supplier: string
  lot: string
  amount: string
  hazard: string
  /** The inventory line this was taken from. */
  inventoryId?: string
}

export interface MaterialsData {
  title: string
  items: MaterialItem[]
}

export interface InstrumentData {
  instrument: string
  method: string
  operator: string
  started: string
  /** An attachment id (see Entry.attachments); '' for none. */
  file: string
  /** A path in the drive to the raw data, when it is linked rather than attached. */
  path: string
  parameters: string
  notes: string
}

export interface TimelineItem {
  /** "14:05" or a full ISO date-time. */
  time: string
  text: string
}

export interface TimelineData {
  title: string
  items: TimelineItem[]
}

export type RiskLevel = 'low' | 'medium' | 'high'

export interface SafetyData {
  hazards: string[]
  ppe: string[]
  pictograms: string[]
  controls: string
  waste: string
  risk: RiskLevel
}

export type PlotKind = 'line' | 'scatter' | 'bar'

export interface PlotData {
  title: string
  xLabel: string
  yLabel: string
  kind: PlotKind
  /** Names of the y series (the first data column is x). */
  series: string[]
  /** [x, y1, y2, …] as typed. */
  rows: string[][]
}

export interface StepItem {
  text: string
  doneBy: string
  /** ISO date-time. */
  doneAt: string
}

export interface StepsData {
  title: string
  items: StepItem[]
}

export interface ImageData {
  att: string
  caption: string
  /** Width in percent of the page (10-100). */
  width: number
}

export interface FileData {
  att: string
  note: string
}

export type Block =
  | { kind: 'reaction'; data: ReactionData }
  | { kind: 'materials'; data: MaterialsData }
  | { kind: 'measurements'; data: MeasurementData }
  | { kind: 'instrument'; data: InstrumentData }
  | { kind: 'timeline'; data: TimelineData }
  | { kind: 'safety'; data: SafetyData }
  | { kind: 'plot'; data: PlotData }
  | { kind: 'steps'; data: StepsData }
  | { kind: 'image'; data: ImageData }
  | { kind: 'file'; data: FileData }

export type BlockKind = Block['kind']

export const BLOCK_LABELS: Record<BlockKind, string> = {
  reaction: 'Reaction table', materials: 'Materials list', measurements: 'Measurement table', instrument: 'Instrument run', timeline: 'Observation timeline',
  safety: 'Safety / risk box', plot: 'Plot', steps: 'Protocol steps', image: 'Image', file: 'Attached file',
}

/** The block kinds the Insert menu offers (images and files come from the attachment commands). */
export const INSERTABLE_BLOCKS: BlockKind[] = ['reaction', 'materials', 'measurements', 'instrument', 'timeline', 'safety', 'plot', 'steps']

export const GHS_PICTOGRAMS: readonly string[] = [
  'Explosive', 'Flammable', 'Oxidising', 'Compressed gas', 'Corrosive', 'Acute toxicity', 'Harmful / irritant', 'Health hazard', 'Environmental hazard',
]

export const PPE_ITEMS: readonly string[] = ['Lab coat', 'Safety glasses', 'Goggles', 'Nitrile gloves', 'Face shield', 'Fume hood', 'Respirator', 'Glove box', 'Ear protection', 'Cryo gloves']

export function newBlock(kind: BlockKind): Block {
  switch (kind) {
    case 'reaction': return { kind, data: newReaction() }
    case 'materials': return { kind, data: { title: 'Materials', items: [{ name: '', cas: '', supplier: '', lot: '', amount: '', hazard: '' }] } }
    case 'measurements': return { kind, data: newMeasurements() }
    case 'instrument': return { kind, data: { instrument: '', method: '', operator: '', started: '', file: '', path: '', parameters: '', notes: '' } }
    case 'timeline': return { kind, data: { title: 'Observations', items: [] } }
    case 'safety': return { kind, data: { hazards: [], ppe: ['Lab coat', 'Safety glasses', 'Nitrile gloves'], pictograms: [], controls: '', waste: '', risk: 'low' } }
    case 'plot': return { kind, data: { title: 'Plot', xLabel: 'x', yLabel: 'y', kind: 'line', series: ['y'], rows: [['0', '0'], ['1', '1'], ['2', '4'], ['3', '9']] } }
    case 'steps': return { kind, data: { title: 'Procedure', items: [{ text: '', doneBy: '', doneAt: '' }] } }
    case 'image': return { kind, data: { att: '', caption: '', width: 60 } }
    case 'file': return { kind, data: { att: '', note: '' } }
  }
}

/** True when a value looks like one of our blocks (the editor stores the block as a node attribute). */
export function isBlock(x: unknown): x is Block {
  const b = x as { kind?: unknown; data?: unknown } | null
  return !!b && typeof b.kind === 'string' && b.kind in BLOCK_LABELS && typeof b.data === 'object' && b.data !== null
}

// ------------------------------------------------------------------ escaping

// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g

/** Escape text for HTML/XHTML content and attributes. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A markdown table cell. */
const mdCell = (s: unknown): string => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

// ------------------------------------------------------------------ rendering context

export interface AttachmentInfo {
  id: string
  name: string
  size: number
  sha256: string
  mime: string
  path?: string
  /** A data: URL, for images that can be shown. */
  dataUrl?: string
}

/** What the writers need to know about the notebook around a block. */
export interface RenderCtx {
  attachment(id: string): AttachmentInfo | null
  sampleLabel(id: string): string
  /** LaTeX to HTML (the app passes KaTeX); without it the LaTeX source is shown. */
  math?: (latex: string, display: boolean) => string
}

export const plainCtx: RenderCtx = { attachment: () => null, sampleLabel: (id) => id }

export const fileSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(1)} MB`)

const table = (head: string[], rows: string[][], cls = 'eln-table'): string =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`

const mdTable = (head: string[], rows: string[][]): string =>
  `| ${head.map(mdCell).join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n')}`

/** The rows of the reaction table as strings (shared by HTML, Markdown and the editor). */
export function reactionRows(d: ReactionData): { head: string[]; rows: string[][]; limiting: string; equation: string } {
  const res = computeReaction(d)
  const head = ['Role', 'Compound', 'Formula', 'MW (g/mol)', 'Mass (g)', 'Volume (mL)', 'mmol', 'Equiv', 'Theoretical (g)', 'Actual (g)', 'Yield']
  const rows = d.reagents.map((r, i) => {
    const row = res.rows[i]
    const isProduct = r.role === 'product'
    return [
      r.role + (row.limiting ? ' (limiting)' : ''), r.name, r.formula, fmt(reagentMw(r), 5),
      isProduct ? '' : fmt(row.mass), isProduct ? '' : fmt(row.volume), isProduct ? fmt(row.theoreticalMmol) : fmt(row.mmol), isProduct ? '' : fmt(row.equiv),
      isProduct ? fmt(row.theoretical) : '', isProduct ? fmt(r.actual) : '', isProduct ? fmtPct(row.yieldPct) : '',
    ]
  })
  const lim = res.limitingIndex != null ? d.reagents[res.limitingIndex] : null
  return { head, rows, limiting: lim ? lim.name || lim.formula || `row ${res.limitingIndex! + 1}` : '', equation: equationText(d) }
}

function stepMark(s: { doneBy: string; doneAt: string }): string {
  return s.doneAt || s.doneBy ? `${s.doneBy || '?'}, ${s.doneAt.replace('T', ' ').slice(0, 16)}` : ''
}

// ------------------------------------------------------------------ HTML

export function blockToHtml(b: Block, ctx: RenderCtx): string {
  switch (b.kind) {
    case 'reaction': {
      const d = b.data
      const { head, rows, limiting, equation } = reactionRows(d)
      return `<div class="eln-block eln-reaction"><div class="eln-title">${esc(d.title || 'Reaction')}</div>${equation.trim() !== '→' ? `<p class="eln-eq">${esc(equation)}</p>` : ''}` +
        table(head, rows) + (limiting ? `<p class="eln-note">Limiting reagent: <b>${esc(limiting)}</b></p>` : '') + (d.notes ? `<p>${esc(d.notes)}</p>` : '') + '</div>'
    }
    case 'materials': {
      const d = b.data
      return `<div class="eln-block"><div class="eln-title">${esc(d.title || 'Materials')}</div>` +
        table(['Name', 'CAS', 'Supplier', 'Lot', 'Amount', 'Hazard'], d.items.map((m) => [m.name, m.cas, m.supplier, m.lot, m.amount, m.hazard])) + '</div>'
    }
    case 'measurements': {
      const d = b.data
      const head = d.columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name))
      const stats = d.columns.map((_, i) => columnStats(d.rows, i))
      const rows = [...d.rows.map((r) => d.columns.map((_, i) => r[i] ?? '')), ...(stats.some((s) => s.n > 1) ? [stats.map((s) => meanSd(s)), stats.map((s) => (s.n ? `n = ${s.n}` : ''))] : [])]
      return `<div class="eln-block"><div class="eln-title">${esc(d.title || 'Measurements')}</div>${table(head, rows)}${stats.some((s) => s.n > 1) ? '<p class="eln-note">Last two rows: mean ± standard deviation, and the number of values.</p>' : ''}</div>`
    }
    case 'instrument': {
      const d = b.data
      const att = d.file ? ctx.attachment(d.file) : null
      const kv: [string, string][] = [['Instrument', d.instrument], ['Method', d.method], ['Operator', d.operator], ['Started', d.started.replace('T', ' ').slice(0, 16)], ['Parameters', d.parameters],
        ['Data file', att ? `${att.name} (${fileSize(att.size)}, SHA-256 ${att.sha256.slice(0, 16)}…)` : d.path], ['Notes', d.notes]]
      return `<div class="eln-block"><div class="eln-title">Instrument run</div><table class="eln-table eln-kv"><tbody>${kv.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`
    }
    case 'timeline': {
      const d = b.data
      return `<div class="eln-block"><div class="eln-title">${esc(d.title || 'Observations')}</div>` + table(['Time', 'Observation'], d.items.map((i) => [i.time.replace('T', ' ').slice(0, 16), i.text])) + '</div>'
    }
    case 'safety': {
      const d = b.data
      return `<div class="eln-block eln-safety eln-risk-${d.risk}"><div class="eln-title">Safety and risk: ${esc(d.risk)}</div>` +
        (d.pictograms.length ? `<p>${d.pictograms.map((p) => `<span class="eln-chip">${esc(p)}</span>`).join(' ')}</p>` : '') +
        (d.hazards.length ? `<p><b>Hazards:</b> ${esc(d.hazards.join('; '))}</p>` : '') + (d.ppe.length ? `<p><b>PPE:</b> ${esc(d.ppe.join(', '))}</p>` : '') +
        (d.controls ? `<p><b>Controls:</b> ${esc(d.controls)}</p>` : '') + (d.waste ? `<p><b>Waste:</b> ${esc(d.waste)}</p>` : '') + '</div>'
    }
    case 'plot': {
      const d = b.data
      const svg = plotSvg(d, { width: 560, height: 320, scheme: 'print' })
      return `<div class="eln-block"><div class="eln-title">${esc(d.title)}</div><p><img class="eln-plot" alt="${esc(d.title)}" width="560" height="320" src="data:image/svg+xml;base64,${textToBase64(svg)}"/></p></div>`
    }
    case 'steps': {
      const d = b.data
      return `<div class="eln-block"><div class="eln-title">${esc(d.title || 'Procedure')}</div>` +
        table(['', 'Step', 'Done by / when'], d.items.map((s) => [s.doneAt ? '[x]' : '[ ]', s.text, stepMark(s)])) + '</div>'
    }
    case 'image': {
      const d = b.data
      const a = d.att ? ctx.attachment(d.att) : null
      if (!a) return `<p class="eln-note">[image not available]</p>`
      const w = Math.max(10, Math.min(100, d.width || 60))
      return `<div class="eln-block eln-figure">${a.dataUrl ? `<p><img alt="${esc(d.caption || a.name)}" style="width:${w}%" src="${esc(a.dataUrl)}"/></p>` : `<p>${esc(a.name)}</p>`}${d.caption ? `<p class="eln-note">${esc(d.caption)}</p>` : ''}<p class="eln-note">${esc(a.name)}, SHA-256 ${esc(a.sha256.slice(0, 16))}…</p></div>`
    }
    case 'file': {
      const d = b.data
      const a = d.att ? ctx.attachment(d.att) : null
      return `<p class="eln-file">Attached file: <b>${esc(a?.name ?? '(missing)')}</b>${a ? ` (${fileSize(a.size)}, SHA-256 ${esc(a.sha256.slice(0, 16))}…)` : ''}${d.note ? ` ${esc(d.note)}` : ''}</p>`
    }
  }
}

// ------------------------------------------------------------------ Markdown

export function blockToMarkdown(b: Block, ctx: RenderCtx): string {
  switch (b.kind) {
    case 'reaction': {
      const { head, rows, limiting, equation } = reactionRows(b.data)
      return `**${b.data.title || 'Reaction'}**\n\n${equation.trim() !== '→' ? `${equation}\n\n` : ''}${mdTable(head, rows)}${limiting ? `\n\nLimiting reagent: **${limiting}**` : ''}`
    }
    case 'materials': return `**${b.data.title}**\n\n${mdTable(['Name', 'CAS', 'Supplier', 'Lot', 'Amount', 'Hazard'], b.data.items.map((m) => [m.name, m.cas, m.supplier, m.lot, m.amount, m.hazard]))}`
    case 'measurements': {
      const d = b.data
      const head = d.columns.map((c) => (c.unit ? `${c.name} (${c.unit})` : c.name))
      const stats = d.columns.map((_, i) => columnStats(d.rows, i))
      const rows = [...d.rows.map((r) => d.columns.map((_, i) => r[i] ?? '')), ...(stats.some((s) => s.n > 1) ? [stats.map((s) => meanSd(s))] : [])]
      return `**${d.title}**\n\n${mdTable(head, rows)}`
    }
    case 'instrument': {
      const d = b.data
      const att = d.file ? ctx.attachment(d.file) : null
      return `**Instrument run**\n\n${[['Instrument', d.instrument], ['Method', d.method], ['Operator', d.operator], ['Started', d.started], ['Parameters', d.parameters], ['Data file', att?.name ?? d.path], ['Notes', d.notes]]
        .filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    }
    case 'timeline': return `**${b.data.title}**\n\n${b.data.items.map((i) => `- ${i.time.replace('T', ' ').slice(0, 16)}: ${i.text}`).join('\n')}`
    case 'safety': {
      const d = b.data
      return `**Safety and risk (${d.risk})**\n\n${[d.pictograms.length ? `- Pictograms: ${d.pictograms.join(', ')}` : '', d.hazards.length ? `- Hazards: ${d.hazards.join('; ')}` : '', d.ppe.length ? `- PPE: ${d.ppe.join(', ')}` : '',
        d.controls ? `- Controls: ${d.controls}` : '', d.waste ? `- Waste: ${d.waste}` : ''].filter(Boolean).join('\n')}`
    }
    case 'plot': return `**${b.data.title}** (plot of ${b.data.series.join(', ')} against ${b.data.xLabel})\n\n${mdTable([b.data.xLabel, ...b.data.series], b.data.rows)}`
    case 'steps': return `**${b.data.title}**\n\n${b.data.items.map((s) => `- [${s.doneAt ? 'x' : ' '}] ${s.text}${stepMark(s) ? ` (${stepMark(s)})` : ''}`).join('\n')}`
    case 'image': {
      const a = b.data.att ? ctx.attachment(b.data.att) : null
      return a ? `![${b.data.caption || a.name}](${a.path ?? a.name})${b.data.caption ? `\n\n*${b.data.caption}*` : ''}` : '[image not available]'
    }
    case 'file': {
      const a = b.data.att ? ctx.attachment(b.data.att) : null
      return `Attached file: ${a ? `[${a.name}](${a.path ?? a.name}) (SHA-256 ${a.sha256})` : '(missing)'}${b.data.note ? ` ${b.data.note}` : ''}`
    }
  }
}

// ------------------------------------------------------------------ text (search, summaries)

export function blockText(b: Block, ctx: RenderCtx = plainCtx): string {
  switch (b.kind) {
    case 'reaction': return [b.data.title, equationText(b.data), ...b.data.reagents.flatMap((r) => [r.name, r.formula, r.cas ?? '']), b.data.notes].filter(Boolean).join(' ')
    case 'materials': return [b.data.title, ...b.data.items.flatMap((m) => [m.name, m.cas, m.supplier, m.lot, m.hazard])].filter(Boolean).join(' ')
    case 'measurements': return [b.data.title, ...b.data.columns.map((c) => c.name), ...b.data.rows.flat()].filter(Boolean).join(' ')
    case 'instrument': {
      const d = b.data
      return [d.instrument, d.method, d.operator, d.parameters, d.notes, d.path, d.file ? ctx.attachment(d.file)?.name ?? '' : ''].filter(Boolean).join(' ')
    }
    case 'timeline': return [b.data.title, ...b.data.items.map((i) => `${i.time} ${i.text}`)].filter(Boolean).join(' ')
    case 'safety': return [...b.data.hazards, ...b.data.ppe, ...b.data.pictograms, b.data.controls, b.data.waste].filter(Boolean).join(' ')
    case 'plot': return [b.data.title, b.data.xLabel, b.data.yLabel, ...b.data.series].filter(Boolean).join(' ')
    case 'steps': return [b.data.title, ...b.data.items.map((s) => `${s.text} ${s.doneBy}`)].filter(Boolean).join(' ')
    case 'image': return [b.data.caption, b.data.att ? ctx.attachment(b.data.att)?.name ?? '' : ''].filter(Boolean).join(' ')
    case 'file': return [b.data.note, b.data.att ? ctx.attachment(b.data.att)?.name ?? '' : ''].filter(Boolean).join(' ')
  }
}
