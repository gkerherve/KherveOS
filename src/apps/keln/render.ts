// Writing entries and notebooks out (pure): HTML, XHTML for the PDF engine, Markdown, JSON and plain text. A signed
// entry gets a signature block with its hash, an amended one its addenda below it.

import { blockText, esc, fileSize, type AttachmentInfo, type RenderCtx } from './blocks.ts'
import { docText, docToHtml, docToMarkdown, type PMNode } from './doc.ts'
import { getProject, getSample, linkedSamples, entryHash, type Attachment, type Entry, type Notebook } from './model.ts'
import { docBlocks, docInstruments } from './doc.ts'

export const HONESTY_NOTE = 'A tamper-evident record kept by kELN in a file you control. It is not a certified 21 CFR Part 11 system: it shows that a record was changed after signing, it does not by itself prevent it.'

/** What the writers need from the notebook: attachments by id (images with their data: URL when embedded) and sample names. */
export function renderCtx(nb: Notebook, extra: { math?: RenderCtx['math']; imageUrl?: (a: Attachment) => string | undefined } = {}): RenderCtx {
  const atts = new Map<string, Attachment>()
  for (const e of nb.entries) for (const a of e.attachments) atts.set(a.id, a)
  return {
    attachment(id): AttachmentInfo | null {
      const a = atts.get(id)
      if (!a) return null
      const dataUrl = extra.imageUrl?.(a) ?? (a.data && /^image\/(png|jpeg|gif|webp)$/.test(a.mime) ? `data:${a.mime};base64,${a.data}` : undefined)
      return { id: a.id, name: a.name, size: a.size, sha256: a.sha256, mime: a.mime, path: a.path || undefined, dataUrl }
    },
    sampleLabel: (id) => {
      const s = getSample(nb, id)
      return s ? `${s.id} ${s.name}` : id
    },
    math: extra.math,
  }
}

/** All the words of an entry that search looks in. */
export function entryText(nb: Notebook, e: Entry): string {
  const ctx = renderCtx(nb)
  const samples = linkedSamples(e).map((id) => `${id} ${getSample(nb, id)?.name ?? ''}`)
  return [
    e.title, e.experiment, getProject(nb, e.projectId)?.name ?? '', e.author, e.tags.join(' '), docText(e.content, ctx), ...samples, ...docInstruments(e.content),
    ...e.attachments.map((a) => a.name), ...e.links.map((l) => `${l.label} ${l.target}`), ...e.addenda.map((a) => `${a.author} ${a.reason} ${docText(a.content, ctx)}`),
  ].filter(Boolean).join('\n')
}

// ------------------------------------------------------------------ HTML

export const EXPORT_CSS = `
@page{size:A4;margin:18mm 16mm}
body{font-family:Helvetica,Arial,sans-serif;font-size:10pt;line-height:1.4;color:#111}
h1{font-size:18pt;margin:0 0 4pt}h2{font-size:14pt;margin:14pt 0 4pt}h3{font-size:12pt;margin:10pt 0 3pt}h4{font-size:10.5pt}
table{border-collapse:collapse;margin:4pt 0 8pt}th,td{border:0.5pt solid #888;padding:2pt 4pt;text-align:left;vertical-align:top;font-size:9pt}th{background:#eee}
.eln-meta td,.eln-meta th{border:none;padding:1pt 8pt 1pt 0;font-size:9.5pt}.eln-meta th{background:none;color:#555;font-weight:normal}
.eln-title{font-weight:bold;margin:8pt 0 2pt}.eln-note{color:#555;font-size:8.5pt}.eln-eq{font-family:monospace}
.eln-chip{border:0.5pt solid #555;padding:0 3pt;font-size:8.5pt}.eln-mention{font-weight:bold;color:#0b6b52}
.eln-safety{border:1pt solid #c33;padding:4pt 8pt;margin:6pt 0}.eln-risk-low{border-color:#2a8}.eln-risk-medium{border-color:#c90}
.eln-sign{border:1pt solid #222;padding:6pt 10pt;margin:14pt 0;font-size:9pt}.eln-hash{font-family:monospace;font-size:8pt;word-break:break-all}
.eln-addendum{border-left:2pt solid #c90;padding-left:8pt;margin:10pt 0}
pre{background:#f4f4f4;padding:4pt;font-size:8.5pt}code{font-family:monospace}blockquote{border-left:2pt solid #aaa;margin-left:0;padding-left:8pt;color:#444}
img{max-width:100%}.eln-page{page-break-before:always}.eln-footer{color:#666;font-size:8pt;margin-top:12pt}
`

const dt = (s: string): string => s.replace('T', ' ').replace(/\.\d+Z$/, 'Z').slice(0, 19)

function metaTable(nb: Notebook, e: Entry): string {
  const project = getProject(nb, e.projectId)
  const samples = linkedSamples(e).map((id) => id + (getSample(nb, id) ? ` ${getSample(nb, id)!.name}` : ''))
  const rows: [string, string][] = [
    ['Experiment', e.experiment], ['Project', project ? `${project.code} ${project.name}` : ''], ['Date', dt(e.date).slice(0, 16)], ['Author', e.author],
    ['Status', e.status + (e.addenda.length ? ' (amended)' : '')], ['Tags', e.tags.join(', ')], ['Samples', samples.join('; ')], ['Instruments', docInstruments(e.content).join('; ')],
  ]
  return `<table class="eln-meta"><tbody>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
}

function signatureBlock(nb: Notebook, e: Entry): string {
  if (e.status === 'draft' || !e.signature) return '<p class="eln-note">Draft: not signed.</p>'
  const mine = nb.audit.filter((r) => r.entryId === e.id)
  return `<div class="eln-sign"><b>Signed</b> by ${esc(e.signature.user)} on ${esc(dt(e.signature.time))} UTC.<br/>Content hash (SHA-256): <span class="eln-hash">${esc(e.signature.hash)}</span>` +
    (e.witness ? `<br/><b>Witnessed</b> by ${esc(e.witness.user)} on ${esc(dt(e.witness.time))} UTC.` : '<br/>Not witnessed.') +
    (mine.length ? `<br/>Audit log: ${mine.length} records for this entry (first ${esc(dt(mine[0].time))}, last ${esc(dt(mine[mine.length - 1].time))}).` : '') +
    `<br/><span class="eln-note">${esc(HONESTY_NOTE)}</span></div>`
}

/** The body of one entry (no <html> wrapper). */
export function entryBodyHtml(nb: Notebook, e: Entry, ctx: RenderCtx = renderCtx(nb)): string {
  const atts = e.attachments.length
    ? `<h3>Attachments</h3><table class="eln-table"><thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Where</th></tr></thead><tbody>${e.attachments.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(fileSize(a.size))}</td><td class="eln-hash">${esc(a.sha256.slice(0, 24))}…</td><td>${esc(a.path || 'inside the notebook')}</td></tr>`).join('')}</tbody></table>`
    : ''
  const links = e.links.length ? `<h3>Links</h3><ul>${e.links.map((l) => `<li>${esc(l.label || l.target)}: ${esc(l.target)}</li>`).join('')}</ul>` : ''
  const addenda = e.addenda.map((a) => `<div class="eln-addendum"><div class="eln-title">Addendum by ${esc(a.author)}, ${esc(dt(a.time))} UTC</div><p class="eln-note">Reason: ${esc(a.reason)}</p>${docToHtml(a.content, ctx)}<p class="eln-hash">${esc(a.hash)}</p></div>`).join('')
  return `<div class="eln-entry"><h1>${esc(e.title)}</h1>${metaTable(nb, e)}${docToHtml(e.content, ctx)}${atts}${links}${addenda}${signatureBlock(nb, e)}</div>`
}

export interface DocOptions {
  /** xhtml: XML prolog and namespace, for the PDF engine. */
  mode?: 'html' | 'xhtml'
  ctx?: RenderCtx
}

function wrap(title: string, body: string, mode: 'html' | 'xhtml'): string {
  const head = `<meta charset="utf-8"/><title>${esc(title)}</title><style>${EXPORT_CSS}</style>`
  return mode === 'xhtml'
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`
    : `<!DOCTYPE html>\n<html lang="en"><head>${head}</head><body>${body}</body></html>\n`
}

export function entryToDocument(nb: Notebook, e: Entry, o: DocOptions = {}): string {
  return wrap(`${e.experiment} ${e.title}`, entryBodyHtml(nb, e, o.ctx ?? renderCtx(nb)) + `<p class="eln-footer">${esc(nb.title)} · exported from kELN</p>`, o.mode ?? 'html')
}

/** The audit log as a table (the last page of a notebook export). */
export function auditTableHtml(nb: Notebook): string {
  return `<h2>Audit log</h2><p class="eln-note">${esc(HONESTY_NOTE)}</p><table class="eln-table"><thead><tr><th>#</th><th>Time (UTC)</th><th>User</th><th>Action</th><th>Entry</th><th>Hash</th></tr></thead><tbody>` +
    nb.audit.map((r) => `<tr><td>${r.seq}</td><td>${esc(dt(r.time))}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td>${esc(r.number)}</td><td class="eln-hash">${esc(r.hash.slice(0, 16))}</td></tr>`).join('') + '</tbody></table>'
}

export function notebookToDocument(nb: Notebook, o: DocOptions & { entries?: Entry[]; audit?: boolean } = {}): string {
  const ctx = o.ctx ?? renderCtx(nb)
  const entries = [...(o.entries ?? nb.entries)].sort((a, b) => a.date.localeCompare(b.date))
  const signed = nb.entries.filter((e) => e.status !== 'draft').length
  const cover = `<h1>${esc(nb.title)}</h1><table class="eln-meta"><tbody><tr><th>Owner</th><td>${esc(nb.owner)}</td></tr><tr><th>Created</th><td>${esc(dt(nb.created))}</td></tr>` +
    `<tr><th>Entries</th><td>${entries.length}${entries.length !== nb.entries.length ? ` of ${nb.entries.length}` : ''} (${signed} signed)</td></tr><tr><th>Samples</th><td>${nb.samples.length}</td></tr></tbody></table>` +
    (nb.description ? `<p>${esc(nb.description)}</p>` : '') +
    (entries.length ? `<h2>Contents</h2><ul>${entries.map((e) => `<li>${esc(e.experiment)} · ${esc(e.title)} (${esc(e.date.slice(0, 10))}, ${e.status})</li>`).join('')}</ul>` : '')
  const body = cover + entries.map((e) => `<div class="eln-page">${entryBodyHtml(nb, e, ctx)}</div>`).join('') + (o.audit === false ? '' : `<div class="eln-page">${auditTableHtml(nb)}</div>`)
  return wrap(nb.title, body, o.mode ?? 'html')
}

// ------------------------------------------------------------------ Markdown, JSON, text

export function entryToMarkdown(nb: Notebook, e: Entry, ctx: RenderCtx = renderCtx(nb)): string {
  const project = getProject(nb, e.projectId)
  const head = [
    `# ${e.title}`, '',
    `- Experiment: ${e.experiment}`, project ? `- Project: ${project.code} ${project.name}` : '', `- Date: ${dt(e.date).slice(0, 16)}`, `- Author: ${e.author}`,
    `- Status: ${e.status}${e.addenda.length ? ' (amended)' : ''}`, e.tags.length ? `- Tags: ${e.tags.join(', ')}` : '',
    linkedSamples(e).length ? `- Samples: ${linkedSamples(e).join(', ')}` : '',
  ].filter((l, i) => l !== '' || i === 1).join('\n')
  const atts = e.attachments.length ? `\n\n## Attachments\n\n${e.attachments.map((a) => `- ${a.name} (${fileSize(a.size)}, SHA-256 ${a.sha256})`).join('\n')}` : ''
  const add = e.addenda.map((a) => `\n\n## Addendum by ${a.author}, ${dt(a.time)} UTC\n\nReason: ${a.reason}\n\n${docToMarkdown(a.content, ctx).trim()}`).join('')
  const sig = e.signature ? `\n\n---\n\nSigned by ${e.signature.user} on ${dt(e.signature.time)} UTC. Content hash (SHA-256): \`${e.signature.hash}\`${e.witness ? `\n\nWitnessed by ${e.witness.user} on ${dt(e.witness.time)} UTC.` : ''}` : ''
  return `${head}\n\n${docToMarkdown(e.content, ctx).trim()}${atts}${add}${sig}\n`
}

export function notebookToMarkdown(nb: Notebook, ctx: RenderCtx = renderCtx(nb)): string {
  const entries = [...nb.entries].sort((a, b) => a.date.localeCompare(b.date))
  return `# ${nb.title}\n\n${nb.description ? `${nb.description}\n\n` : ''}Owner: ${nb.owner}. ${entries.length} entries, ${nb.samples.length} samples.\n\n${entries.map((e) => entryToMarkdown(nb, e, ctx).replace(/^# /m, '## ')).join('\n---\n\n')}`
}

/** One entry as JSON, with what it refers to (its project, samples, audit records); embedded file data is left out. */
export function entryToJson(nb: Notebook, e: Entry): string {
  const { attachments, ...rest } = e
  return JSON.stringify({
    format: 'keln-entry', version: 1, notebook: { id: nb.id, title: nb.title }, entry: { ...rest, attachments: attachments.map(({ data: _d, ...a }) => (void _d, a)) }, contentHash: entryHash(e),
    project: getProject(nb, e.projectId) ?? null, samples: linkedSamples(e).map((id) => getSample(nb, id)).filter(Boolean), audit: nb.audit.filter((r) => r.entryId === e.id),
  }, null, 1) + '\n'
}

/** A short plain-text summary (the AI tools, notifications). */
export function entrySummary(nb: Notebook, e: Entry): { id: string; number: string; title: string; date: string; status: string; tags: string[]; project: string; blocks: string[]; words: number } {
  const ctx = renderCtx(nb)
  return {
    id: e.id, number: e.experiment, title: e.title, date: e.date, status: e.status + (e.addenda.length ? ' (amended)' : ''), tags: e.tags, project: getProject(nb, e.projectId)?.code ?? '',
    blocks: docBlocks(e.content).map((b) => `${b.kind}: ${blockText(b, ctx).slice(0, 60)}`), words: docText(e.content, ctx).split(/\s+/).filter(Boolean).length,
  }
}

export type { PMNode }
