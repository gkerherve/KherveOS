// Reports and tables (pure): a Markdown or HTML report of the model, loads and results with SVG figures, and CSV of the
// results. Values are shown in the model's display units.

import type { FrameResult } from './frame.ts'
import { ANALYSIS_NAMES, materialOf, sectionOf, type Model } from './model.ts'
import { derivedStress, type PlaneResult } from './plane.ts'
import { extremes, plateField, PLATE_FIELDS } from './post.ts'
import { measure, summaryLines, type AnyResult } from './solve.ts'
import { fmt, fromSI, label, LENGTH_M, type Quantity, type Units } from './units.ts'

export type Block =
  | { k: 'h'; level: number; text: string }
  | { k: 'p'; text: string }
  | { k: 'table'; head: string[]; rows: string[][]; caption?: string }
  | { k: 'figure'; svg: string; caption: string }

export interface Figure { title: string; svg: string }

const q = (v: number, quantity: Quantity, u: Units, digits = 5): string => fmt(fromSI(v, quantity, u), digits)
const hq = (name: string, quantity: Quantity, u: Units): string => {
  const l = label(quantity, u)
  return l ? `${name} (${l})` : name
}

export function reportBlocks(model: Model, result: AnyResult | null, figures: readonly Figure[] = [], date = ''): Block[] {
  const u = model.units
  const b: Block[] = []
  b.push({ k: 'h', level: 1, text: `${model.name} — kFEA report` })
  b.push({ k: 'p', text: `${ANALYSIS_NAMES[model.analysis]}${model.study !== 'static' ? ` (${model.study})` : ''}. Units: ${u.length}, ${u.force}.${date ? ` ${date}` : ''}` })
  if (model.description) b.push({ k: 'p', text: model.description })
  // model
  b.push({ k: 'h', level: 2, text: 'Model' })
  const mats = model.materials.filter((m) => (model.plate?.material === m.id) || model.members.some((x) => x.material === m.id))
  b.push({
    k: 'table', caption: 'Materials',
    head: ['Material', hq('E', 'stress', u), 'ν', 'ρ (kg/m³)', hq('yield', 'stress', u), 'α (1/K)'],
    rows: mats.map((m) => [m.name, q(m.E, 'stress', u), fmt(m.nu, 3), fmt(m.rho, 4), q(m.sy, 'stress', u), fmt(m.alpha, 3)]),
  })
  if (model.plate) {
    const p = model.plate
    b.push({
      k: 'table', caption: 'Plate',
      head: ['Item', 'Value'],
      rows: [
        ['Thickness', `${q(p.thickness, 'length', u)} ${label('length', u)}`], ['Material', materialOf(model, p.material)?.name ?? p.material],
        ['Outline vertices', String(p.outline.length)], ['Holes', String(p.holes.length)], ['Mesh size', `${q(p.mesh.size, 'length', u)} ${label('length', u)}, ${p.mesh.type === 'tri' ? 'triangles' : 'quadrilaterals'}`],
      ],
    })
    b.push({ k: 'table', caption: 'Outline', head: ['#', hq('x', 'length', u), hq('y', 'length', u)], rows: p.outline.map((pt, i) => [String(i), q(pt.x, 'length', u), q(pt.y, 'length', u)]) })
    b.push({
      k: 'table', caption: 'Supports',
      head: ['Support', 'Where', 'Held'],
      rows: p.supports.map((s, i) => [`S${i + 1}`, describeTarget(s.target), `${s.ux ? 'x ' : ''}${s.uy ? 'y' : ''}`.trim()]),
    })
    b.push({
      k: 'table', caption: 'Loads',
      head: ['Load', 'Where', 'Value'],
      rows: p.loads.map((l, i) => [`L${i + 1}`, l.type === 'thermal' ? 'whole plate' : describeTarget(l.target), l.type === 'pressure' ? `pressure ${q(l.p, 'stress', u)} ${label('stress', u)}` : l.type === 'traction' ? `traction (${q(l.tx, 'stress', u)}, ${q(l.ty, 'stress', u)}) ${label('stress', u)}` : l.type === 'thermal' ? `ΔT = ${fmt(l.dT, 4)} K` : `force (${q(l.fx, 'force', u)}, ${q(l.fy, 'force', u)}) ${label('force', u)}`]),
    })
  } else {
    const secs = model.sections.filter((s) => model.members.some((m) => m.section === s.id))
    b.push({
      k: 'table', caption: 'Sections',
      head: ['Section', hq('A', 'area', u), hq('I', 'inertia', u), `Z (${u.length}³)`, hq('depth', 'length', u)],
      rows: secs.map((s) => [s.name, fmt(fromSI(s.A, 'area', u), 5), fmt(fromSI(s.I, 'inertia', u), 5), fmt(s.Z / LENGTH_M[u.length] ** 3, 5), q(s.h, 'length', u)]),
    })
    b.push({ k: 'table', caption: 'Nodes', head: ['Node', hq('x', 'length', u), hq('y', 'length', u)], rows: model.nodes.map((n) => [n.id, q(n.x, 'length', u), q(n.y, 'length', u)]) })
    b.push({
      k: 'table', caption: 'Members',
      head: ['Member', 'From', 'To', 'Section', 'Material', 'Hinges'],
      rows: model.members.map((m) => [m.id, m.n1, m.n2, sectionOf(model, m.section)?.name ?? m.section, materialOf(model, m.material)?.name ?? m.material, `${m.releaseStart ? 'start ' : ''}${m.releaseEnd ? 'end' : ''}`.trim() || '–']),
    })
    b.push({
      k: 'table', caption: 'Supports',
      head: ['Node', 'Held', 'Springs', 'Settlement'],
      rows: model.supports.map((s) => [s.node, [s.ux && !s.kx ? 'x' : '', s.uy && !s.ky ? 'y' : '', s.rz && !s.kr ? 'rotation' : ''].filter(Boolean).join(', ') || '–', [s.kx ? `kx ${q(s.kx, 'stiffness', u)}` : '', s.ky ? `ky ${q(s.ky, 'stiffness', u)}` : '', s.kr ? `kr ${q(s.kr, 'rotStiffness', u)}` : ''].filter(Boolean).join(', ') || '–', [s.dx ? `dx ${q(s.dx, 'length', u)}` : '', s.dy ? `dy ${q(s.dy, 'length', u)}` : '', s.drz ? `rot ${fmt(s.drz, 4)} rad` : ''].filter(Boolean).join(', ') || '–']),
    })
    if (model.nodeLoads.length) b.push({ k: 'table', caption: 'Nodal loads', head: ['Node', hq('Fx', 'force', u), hq('Fy', 'force', u), hq('Mz', 'moment', u)], rows: model.nodeLoads.map((l) => [l.node, q(l.fx, 'force', u), q(l.fy, 'force', u), q(l.mz, 'moment', u)]) })
    if (model.memberLoads.length) {
      b.push({
        k: 'table', caption: 'Member loads',
        head: ['Member', 'Type', 'Value'],
        rows: model.memberLoads.map((l) => [l.member, l.type === 'dist' ? 'distributed' : l.type === 'point' ? 'point' : 'thermal',
          l.type === 'dist' ? `${q(l.w1, 'lineLoad', u)}${l.w2 !== l.w1 ? ` → ${q(l.w2, 'lineLoad', u)}` : ''} ${label('lineLoad', u)} (${l.dir})${l.a !== undefined || l.b !== undefined ? `, from ${q(l.a ?? 0, 'length', u)}` : ''}`
            : l.type === 'point' ? `${q(l.p, 'force', u)} ${label('force', u)} (${l.dir}) at ${q(l.a, 'length', u)} ${label('length', u)}` : `ΔT ${fmt(l.dT, 4)} K, gradient ${fmt(l.dTg, 4)} K`]),
      })
    }
    if (model.gravity > 0) b.push({ k: 'p', text: `Self weight included (g = ${fmt(model.gravity, 5)} m/s²).` })
  }
  // results
  if (result) {
    b.push({ k: 'h', level: 2, text: 'Results' })
    for (const line of summaryLines(model, result)) b.push({ k: 'p', text: line })
    if (result.kind === 'frame') frameTables(model, result, b)
    else if (result.kind === 'plane') plateTables(model, result, b)
    else {
      b.push({
        k: 'table', caption: result.kind === 'modal' ? 'Natural frequencies' : 'Buckling load factors',
        head: result.kind === 'modal' ? ['Mode', 'ω (rad/s)', 'f (Hz)', 'T (s)'] : ['Mode', 'Load factor'],
        rows: result.kind === 'modal' ? result.modes.map((m, i) => [String(i + 1), fmt(m.omega, 6), fmt(m.frequency, 6), fmt(m.period, 5)]) : result.modes.map((m, i) => [String(i + 1), fmt(m.factor, 6)]),
      })
    }
    if (model.expected) {
      const rows: string[][] = []
      for (const [key, value] of Object.entries(model.expected ?? {})) {
        try {
          const got = measure(model, result, key)
          rows.push([key, fmt(value, 6), fmt(got, 6), fmt(value !== 0 ? (got / value - 1) * 100 : 0, 3)])
        } catch { /* the key is not for this result */ }
      }
      if (rows.length) b.push({ k: 'table', caption: 'Check against the expected values (SI units)', head: ['Quantity', 'Expected', 'Computed', 'Difference (%)'], rows })
    }
  }
  for (const f of figures) b.push({ k: 'figure', svg: f.svg, caption: f.title })
  return b
}

function describeTarget(t: import('./model.ts').Target): string {
  switch (t.kind) {
    case 'edge': return `${t.loop === 0 ? 'outline' : `hole ${t.loop}`} edge ${t.edge}`
    case 'loop': return t.loop === 0 ? 'whole outline' : `hole ${t.loop}`
    case 'line': return `line (${fmt(t.x1, 4)}, ${fmt(t.y1, 4)}) – (${fmt(t.x2, 4)}, ${fmt(t.y2, 4)})`
    case 'circle': return `circle r = ${fmt(t.r, 4)}`
    case 'vertex': return `${t.loop === 0 ? 'outline' : `hole ${t.loop}`} vertex ${t.vertex}`
    default: return `point (${fmt(t.x, 4)}, ${fmt(t.y, 4)})`
  }
}

function frameTables(model: Model, r: FrameResult, b: Block[]): void {
  const u = model.units
  b.push({
    k: 'table', caption: 'Joint displacements',
    head: ['Node', hq('ux', 'length', u), hq('uy', 'length', u), 'rz (rad)'],
    rows: r.nodeIds.map((id, i) => [id, q(r.u[3 * i], 'length', u), q(r.u[3 * i + 1], 'length', u), fmt(r.u[3 * i + 2], 5)]),
  })
  b.push({ k: 'table', caption: 'Reactions', head: ['Node', hq('Rx', 'force', u), hq('Ry', 'force', u), hq('M', 'moment', u)], rows: r.reactions.map((x) => [x.node, q(x.rx, 'force', u), q(x.ry, 'force', u), q(x.mz, 'moment', u)]) })
  b.push({
    k: 'table', caption: 'Member forces (N tension positive, V shear, M sagging positive)',
    head: ['Member', hq('N start', 'force', u), hq('N end', 'force', u), hq('V start', 'force', u), hq('V end', 'force', u), hq('M start', 'moment', u), hq('M end', 'moment', u), hq('max |M|', 'moment', u), hq('σ max', 'stress', u), 'Safety'],
    rows: r.members.map((m) => [m.id, q(m.N1, 'force', u), q(m.N2, 'force', u), q(m.V1, 'force', u), q(m.V2, 'force', u), q(m.M1, 'moment', u), q(m.M2, 'moment', u), q(m.maxM, 'moment', u), q(m.maxStress, 'stress', u), Number.isFinite(m.safety) ? fmt(m.safety, 3) : '∞']),
  })
}

function plateTables(model: Model, r: PlaneResult, b: Block[]): void {
  const u = model.units
  b.push({
    k: 'table', caption: 'Extremes of the nodal fields',
    head: ['Field', 'Minimum', 'Maximum'],
    rows: PLATE_FIELDS.map((f) => {
      const e = extremes(plateField(r, f.id, 'nodal'))
      return [`${f.label}${f.quantity !== 'none' ? ` (${label(f.quantity, u)})` : ''}`, fmt(fromSI(e.min, f.quantity, u), 5), fmt(fromSI(e.max, f.quantity, u), 5)]
    }),
  })
  const rows: string[][] = []
  for (let i = 0; i < r.mesh.nNodes; i++) {
    if (!r.reactions[2 * i] && !r.reactions[2 * i + 1]) continue
    rows.push([String(i), q(r.mesh.xy[2 * i], 'length', u), q(r.mesh.xy[2 * i + 1], 'length', u), q(r.reactions[2 * i], 'force', u), q(r.reactions[2 * i + 1], 'force', u)])
  }
  let sx = 0, sy = 0
  for (let i = 0; i < r.mesh.nNodes; i++) { sx += r.reactions[2 * i]; sy += r.reactions[2 * i + 1] }
  b.push({ k: 'p', text: `Total reaction: ${q(sx, 'force', u)} ${label('force', u)} in x, ${q(sy, 'force', u)} ${label('force', u)} in y (${rows.length} supported nodes).` })
}

// ---------------------------------------------------------------------------- rendering

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const c of bytes) bin += String.fromCharCode(c)
  return btoa(bin)
}

export function blocksToMarkdown(blocks: readonly Block[]): string {
  const out: string[] = []
  for (const bl of blocks) {
    switch (bl.k) {
      case 'h': out.push(`${'#'.repeat(bl.level)} ${bl.text}`); break
      case 'p': out.push(bl.text); break
      case 'table':
        if (!bl.rows.length) break
        if (bl.caption) out.push(`**${bl.caption}**`)
        out.push([`| ${bl.head.map(mdCell).join(' | ')} |`, `| ${bl.head.map(() => '---').join(' | ')} |`, ...bl.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n'))
        break
      default: out.push(`![${bl.caption}](data:image/svg+xml;base64,${b64(bl.svg)})\n\n*${bl.caption}*`)
    }
  }
  return out.join('\n\n') + '\n'
}

export function blocksToHtml(blocks: readonly Block[], title: string): string {
  const body: string[] = []
  for (const bl of blocks) {
    switch (bl.k) {
      case 'h': body.push(`<h${bl.level}>${escHtml(bl.text)}</h${bl.level}>`); break
      case 'p': body.push(`<p>${escHtml(bl.text)}</p>`); break
      case 'table':
        if (!bl.rows.length) break
        body.push(`<table>${bl.caption ? `<caption>${escHtml(bl.caption)}</caption>` : ''}<thead><tr>${bl.head.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr></thead><tbody>${bl.rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
        break
      default: body.push(`<figure>${bl.svg}<figcaption>${escHtml(bl.caption)}</figcaption></figure>`)
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>
body{font:14px/1.5 Helvetica,Arial,sans-serif;max-width:920px;margin:24px auto;padding:0 16px;color:#1f2937}
h1{font-size:24px;border-bottom:2px solid #ea580c;padding-bottom:6px}h2{margin-top:28px;color:#9a3412}
table{border-collapse:collapse;margin:12px 0;font-size:13px}caption{text-align:left;font-weight:bold;padding:4px 0}
th,td{border:1px solid #d1d5db;padding:3px 9px;text-align:right}th{background:#f3f4f6}td:first-child,th:first-child{text-align:left}
figure{margin:16px 0}figure svg{max-width:100%;height:auto;border:1px solid #e5e7eb}figcaption{font-size:12px;color:#6b7280}
</style></head><body>${body.join('\n')}</body></html>`
}

export const reportMarkdown = (model: Model, result: AnyResult | null, figures: readonly Figure[] = [], date = ''): string => blocksToMarkdown(reportBlocks(model, result, figures, date))
export const reportHtml = (model: Model, result: AnyResult | null, figures: readonly Figure[] = [], date = ''): string => blocksToHtml(reportBlocks(model, result, figures, date), `${model.name} — kFEA report`)

// ---------------------------------------------------------------------------- CSV

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
const csv = (rows: string[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\n')

/** The results as CSV: several tables one after another (a title line, a header line, the rows), in display units. */
export function resultsCsv(model: Model, r: AnyResult): string {
  const u = model.units
  const parts: string[] = []
  const table = (title: string, head: string[], rows: string[][]) => parts.push(csv([[title], head, ...rows]))
  if (r.kind === 'frame') {
    table('Joint displacements', ['node', hq('ux', 'length', u), hq('uy', 'length', u), 'rz (rad)'], r.nodeIds.map((id, i) => [id, q(r.u[3 * i], 'length', u, 8), q(r.u[3 * i + 1], 'length', u, 8), fmt(r.u[3 * i + 2], 8)]))
    table('Reactions', ['node', hq('Rx', 'force', u), hq('Ry', 'force', u), hq('M', 'moment', u)], r.reactions.map((x) => [x.node, q(x.rx, 'force', u, 8), q(x.ry, 'force', u, 8), q(x.mz, 'moment', u, 8)]))
    table('Member end forces', ['member', hq('N1', 'force', u), hq('V1', 'force', u), hq('M1', 'moment', u), hq('N2', 'force', u), hq('V2', 'force', u), hq('M2', 'moment', u), hq('max stress', 'stress', u), 'safety factor'],
      r.members.map((m) => [m.id, q(m.N1, 'force', u, 8), q(m.V1, 'force', u, 8), q(m.M1, 'moment', u, 8), q(m.N2, 'force', u, 8), q(m.V2, 'force', u, 8), q(m.M2, 'moment', u, 8), q(m.maxStress, 'stress', u, 8), Number.isFinite(m.safety) ? fmt(m.safety, 6) : '']))
  } else if (r.kind === 'plane') {
    const m = r.mesh
    table('Nodes', ['node', hq('x', 'length', u), hq('y', 'length', u), hq('ux', 'length', u), hq('uy', 'length', u), hq('sx', 'stress', u), hq('sy', 'stress', u), hq('txy', 'stress', u), hq('von Mises', 'stress', u), hq('sigma1', 'stress', u), hq('sigma2', 'stress', u)],
      Array.from({ length: m.nNodes }, (_, i) => {
        const d = derivedStress(r.nodal.sx[i], r.nodal.sy[i], r.nodal.txy[i], r.nodal.sz[i])
        return [String(i), q(m.xy[2 * i], 'length', u, 8), q(m.xy[2 * i + 1], 'length', u, 8), q(r.u[2 * i], 'length', u, 8), q(r.u[2 * i + 1], 'length', u, 8), q(r.nodal.sx[i], 'stress', u, 8), q(r.nodal.sy[i], 'stress', u, 8), q(r.nodal.txy[i], 'stress', u, 8), q(d.vm, 'stress', u, 8), q(d.p1, 'stress', u, 8), q(d.p2, 'stress', u, 8)]
      }))
    table('Elements (stress at the centroid)', ['element', 'nodes', hq('sx', 'stress', u), hq('sy', 'stress', u), hq('txy', 'stress', u), hq('von Mises', 'stress', u)],
      Array.from({ length: m.nElems }, (_, e) => {
        const d = derivedStress(r.elem.sx[e], r.elem.sy[e], r.elem.txy[e], r.elem.sz[e])
        return [String(e), Array.from({ length: m.stride }, (_, k) => m.conn[m.stride * e + k]).join(' '), q(r.elem.sx[e], 'stress', u, 8), q(r.elem.sy[e], 'stress', u, 8), q(r.elem.txy[e], 'stress', u, 8), q(d.vm, 'stress', u, 8)]
      }))
  } else if (r.kind === 'modal') {
    table('Natural frequencies', ['mode', 'omega (rad/s)', 'frequency (Hz)', 'period (s)'], r.modes.map((m, i) => [String(i + 1), fmt(m.omega, 10), fmt(m.frequency, 10), fmt(m.period, 10)]))
  } else {
    table('Buckling load factors', ['mode', 'load factor'], r.modes.map((m, i) => [String(i + 1), fmt(m.factor, 10)]))
  }
  return parts.join('\n\n') + '\n'
}

