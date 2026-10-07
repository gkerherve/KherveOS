// Flowcharts for LaTeX — the model behind the flowchart builder, a port of the
// desktop's khervedoc/flowchart.py. A Flowchart is a set of nodes (the classic
// flowchart shapes) on a grid and the arrows between them; toTikz writes it as
// a TikZ picture, standaloneDoc wraps that in the document the builder compiles.
// In a document the chart is a Figure (source "flowchart"): a PNG preview for
// the Visual tab, the vector PDF LaTeX includes, its source (.flow.json) and
// its TikZ (.tikz), side by side — the same files as the desktop.

/** kind → [label, TikZ shape options] */
export const KINDS: Record<string, [string, string]> = {
  terminal: ['Start / end', 'rounded rectangle, minimum width=2.4cm'],
  process: ['Process', 'rectangle, minimum width=2.6cm'],
  decision: ['Decision', 'diamond, aspect=1.8, inner sep=1pt, minimum width=2.6cm'],
  io: ['Input / output', 'trapezium, trapezium left angle=72, trapezium right angle=108, minimum width=2.4cm'],
  document: ['Document', 'tape, tape bend top=none, minimum width=2.4cm'],
  database: ['Data', 'cylinder, shape border rotate=90, aspect=0.22, minimum width=2.2cm'],
  subprocess: ['Sub-process', 'rectangle, double, double distance=1.6pt, minimum width=2.6cm'],
  connector: ['Connector', 'circle, minimum size=0.8cm, inner sep=1pt'],
  note: ['Note', 'rectangle, dashed, minimum width=2.2cm'],
}

/** Colour schemes: kind → [fill, text colour]; "line" is the arrows and outlines. */
export const SCHEMES: Record<string, Record<string, [string, string]>> = {
  Blue: { terminal: ['#1F4E79', '#FFFFFF'], process: ['#DEEBF7', '#1A1A1A'], decision: ['#FCE4C4', '#1A1A1A'], io: ['#E2EFDA', '#1A1A1A'], line: ['#404040', ''] },
  Green: { terminal: ['#2E6B30', '#FFFFFF'], process: ['#E3EDE3', '#1A1A1A'], decision: ['#FFF2CC', '#1A1A1A'], io: ['#DDEBF7', '#1A1A1A'], line: ['#404040', ''] },
  Purple: { terminal: ['#500778', '#FFFFFF'], process: ['#EFE3F5', '#1A1A1A'], decision: ['#F8D7E3', '#1A1A1A'], io: ['#E0F0EF', '#1A1A1A'], line: ['#404040', ''] },
  Pastel: { terminal: ['#F4B6C2', '#1A1A1A'], process: ['#CDE7F0', '#1A1A1A'], decision: ['#FFF1B8', '#1A1A1A'], io: ['#D5F0D5', '#1A1A1A'], line: ['#555555', ''] },
  'Black & white': { terminal: ['#FFFFFF', '#000000'], process: ['#FFFFFF', '#000000'], decision: ['#FFFFFF', '#000000'], io: ['#FFFFFF', '#000000'], line: ['#000000', ''] },
}
export const SCHEME_NAMES = Object.keys(SCHEMES)
export const DEFAULT_SCHEME = 'Blue'

export interface FcNode {
  id: string
  kind: string
  text: string
  /** Grid position: columns right, rows down. */
  x: number
  y: number
  /** "" = from the colour scheme. */
  fill: string
}

export interface FcEdge {
  src: string
  dst: string
  label: string
  route: 'auto' | 'straight' | 'elbow' | 'curve'
  dashed: boolean
  head: 'end' | 'start' | 'both' | 'none'
  src_side: string
  dst_side: string
  bend: number
}

export interface Flowchart {
  nodes: FcNode[]
  edges: FcEdge[]
  direction: 'TB' | 'LR'
  scheme: string
  font_pt: number
  col_cm: number
  row_cm: number
}

/** Arrowheads: key → [label, TikZ arrow]. */
export const HEADS: Record<string, [string, string]> = {
  end: ['→  Arrow', '->'], start: ['←  Reversed arrow', '<-'], both: ['↔  Both ends', '<->'], none: ['—  Line, no arrow', '-'],
}
export const SIDES: Record<string, string> = { auto: 'Automatic', north: 'Top', south: 'Bottom', east: 'Right', west: 'Left' }
const STUB: Record<string, string> = { north: '(0,0.35)', south: '(0,-0.35)', east: '(0.35,0)', west: '(-0.35,0)' }

export function newChart(over: Partial<Flowchart> = {}): Flowchart {
  return { nodes: [], edges: [], direction: 'TB', scheme: DEFAULT_SCHEME, font_pt: 11, col_cm: 3.6, row_cm: 1.7, ...over }
}

export const nodeOf = (fc: Flowchart, id: string) => fc.nodes.find((n) => n.id === id) ?? null

export function newId(fc: Flowchart): string {
  const used = new Set(fc.nodes.map((n) => n.id))
  let i = 1
  while (used.has(`n${i}`)) i++
  return `n${i}`
}

export function connect(fc: Flowchart, src: string, dst: string, label = ''): FcEdge | null {
  if (src === dst || !nodeOf(fc, src) || !nodeOf(fc, dst)) return null
  const old = fc.edges.find((e) => e.src === src && e.dst === dst)
  if (old) return old
  const e: FcEdge = { src, dst, label, route: 'auto', dashed: false, head: 'end', src_side: 'auto', dst_side: 'auto', bend: 30 }
  fc.edges.push(e)
  return e
}

/** Flowchart.add: a node one step on from `after` (down or right, on a free spot), joined to it. */
export function addNode(fc: Flowchart, kind: string, text = '', after: string | null = null, label = ''): FcNode {
  let x = 0
  let y = 0
  const prev = after ? nodeOf(fc, after) : null
  if (prev) {
    const [dx, dy] = fc.direction === 'TB' ? [0, 1] : [1, 0]
    x = prev.x + dx
    y = prev.y + dy
    while (fc.nodes.some((n) => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5)) {
      x += dy
      y += dx
    }
  } else if (fc.nodes.length) {
    const last = fc.nodes[fc.nodes.length - 1]
    ;[x, y] = fc.direction === 'TB' ? [last.x, last.y + 1] : [last.x + 1, last.y]
  }
  const n: FcNode = { id: newId(fc), kind, text: text || KINDS[kind][0], x, y, fill: '' }
  fc.nodes.push(n)
  if (prev) connect(fc, prev.id, n.id, label)
  return n
}

export function removeNode(fc: Flowchart, id: string) {
  fc.nodes = fc.nodes.filter((n) => n.id !== id)
  fc.edges = fc.edges.filter((e) => e.src !== id && e.dst !== id)
}

/** to_json: json.dumps(asdict(self), indent=2). */
export function chartToJson(fc: Flowchart): string {
  return JSON.stringify(
    {
      nodes: fc.nodes.map((n) => ({ id: n.id, kind: n.kind, text: n.text, x: n.x, y: n.y, fill: n.fill })),
      edges: fc.edges.map((e) => ({ src: e.src, dst: e.dst, label: e.label, route: e.route, dashed: e.dashed, head: e.head, src_side: e.src_side, dst_side: e.dst_side, bend: e.bend })),
      direction: fc.direction, scheme: fc.scheme, font_pt: fc.font_pt, col_cm: fc.col_cm, row_cm: fc.row_cm,
    },
    null,
    2,
  )
}

export function chartFromJson(text: string): Flowchart {
  const d = JSON.parse(text) as Partial<Flowchart> & { nodes?: Partial<FcNode>[]; edges?: Partial<FcEdge>[] }
  const fc = newChart({
    ...(d.direction ? { direction: d.direction } : {}), ...(d.scheme ? { scheme: d.scheme } : {}),
    ...(d.font_pt ? { font_pt: d.font_pt } : {}), ...(d.col_cm ? { col_cm: d.col_cm } : {}), ...(d.row_cm ? { row_cm: d.row_cm } : {}),
  })
  fc.nodes = (d.nodes ?? []).map((n) => ({ id: String(n.id), kind: n.kind ?? 'process', text: n.text ?? '', x: Number(n.x ?? 0), y: Number(n.y ?? 0), fill: n.fill ?? '' }))
  fc.edges = (d.edges ?? []).map((e) => ({
    src: String(e.src), dst: String(e.dst), label: e.label ?? '', route: e.route ?? 'auto', dashed: !!e.dashed, head: e.head ?? 'end',
    src_side: e.src_side ?? 'auto', dst_side: e.dst_side ?? 'auto', bend: Number(e.bend ?? 30),
  }))
  return fc
}

// ------------------------------------------------------------------ layout

function ancestors(u: string, out: Record<string, string[]>): Set<string> {
  const rev: Record<string, string[]> = {}
  for (const [a, bs] of Object.entries(out)) for (const b of bs) (rev[b] ??= []).push(a)
  const seen = new Set<string>()
  const stack = [u]
  while (stack.length) {
    const x = stack.pop()!
    for (const p of rev[x] ?? []) {
      if (!seen.has(p)) {
        seen.add(p)
        stack.push(p)
      }
    }
  }
  return seen
}

/** auto_layout: rank by the longest path from a start (loops ignored), spread each rank around the centre. */
export function autoLayout(fc: Flowchart) {
  const ids = fc.nodes.map((n) => n.id)
  if (!ids.length) return
  const out: Record<string, string[]> = {}
  const indeg: Record<string, number> = {}
  for (const i of ids) {
    out[i] = []
    indeg[i] = 0
  }
  for (const e of fc.edges) {
    if (e.src in out && e.dst in out) {
      out[e.src].push(e.dst)
      indeg[e.dst] += 1
    }
  }
  const starts = ids.filter((i) => indeg[i] === 0)
  if (!starts.length) starts.push(ids[0])
  const rank: Record<string, number> = {}
  for (const s of starts) rank[s] = 0
  const order = [...starts]
  const seenEdges = new Set<string>()
  for (let k = 0; k < order.length; k++) {
    const u = order[k]
    for (const v of out[u]) {
      const key = `${u}\u0000${v}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      if (!(v in rank)) {
        rank[v] = rank[u] + 1
        order.push(v)
      } else if (rank[v] <= rank[u] && !ancestors(u, out).has(v)) {
        rank[v] = rank[u] + 1
        order.push(v)
      }
    }
  }
  for (const i of ids) rank[i] ??= 0
  const levels = new Map<number, string[]>()
  for (const i of ids) levels.set(rank[i], [...(levels.get(rank[i]) ?? []), i])
  for (const [r, members] of levels) {
    members.forEach((id, j) => {
      const off = j - (members.length - 1) / 2
      const n = nodeOf(fc, id)!
      if (fc.direction === 'TB') [n.x, n.y] = [off, r]
      else [n.x, n.y] = [r, off]
    })
  }
}

// -------------------------------------------------------------------- TikZ

const hex = (h: string) => (h || '').replace(/^#+/, '').toUpperCase()

/** kind → [fill, text] for the chart's scheme. */
export function colours(fc: Flowchart): Record<string, [string, string]> {
  const base = SCHEMES[fc.scheme] ?? SCHEMES[DEFAULT_SCHEME]
  const out: Record<string, [string, string]> = {}
  for (const kind of Object.keys(KINDS)) {
    const fallback: [string, string] = ['subprocess', 'document', 'database'].includes(kind)
      ? base.process
      : kind === 'connector' ? base.terminal : ['#FFFFFF', '#555555']
    out[kind] = base[kind] ?? fallback
  }
  out.line = base.line
  return out
}

function edgeLabel(e: FcEdge): string {
  return e.label ? ` node[pos=0.25, auto, font=\\sffamily\\footnotesize, inner sep=2pt, text width=] {${e.label}}` : ''
}

const OUT_ANGLE: Record<string, number> = { east: 0, north: 90, west: 180, south: 270 }

function curvedRoute(e: FcEdge, lbl: string): string {
  const start = e.src_side in STUB ? `(${e.src}.${e.src_side})` : `(${e.src})`
  const end = e.dst_side in STUB ? `(${e.dst}.${e.dst_side})` : `(${e.dst})`
  let how: string
  if (e.src_side in STUB && e.dst_side in STUB) how = `out=${OUT_ANGLE[e.src_side]}, in=${OUT_ANGLE[e.dst_side]}`
  else if (e.bend === 0) return `${start} --${lbl} ${end}`
  else how = e.bend > 0 ? `bend left=${e.bend}` : `bend right=${-e.bend}`
  return `${start} to[${how}]${lbl} ${end}`
}

function sidedRoute(e: FcEdge, lbl: string): string {
  let start = `(${e.src})`
  if (e.src_side in STUB) start = `(${e.src}.${e.src_side}) -- ++${STUB[e.src_side]}`
  const end = e.dst_side in STUB ? `(${e.dst}.${e.dst_side})` : `(${e.dst})`
  if (e.route === 'straight') return `${start} --${lbl} ${end}`
  let turn: string
  if (e.dst_side === 'north' || e.dst_side === 'south') turn = '-|'
  else if (e.dst_side === 'east' || e.dst_side === 'west') turn = '|-'
  else turn = e.src_side === 'east' || e.src_side === 'west' ? '|-' : '-|'
  return `${start} ${turn}${lbl} ${end}`
}

function route(fc: Flowchart, e: FcEdge): string {
  const a = nodeOf(fc, e.src)!
  const b = nodeOf(fc, e.dst)!
  const lbl = edgeLabel(e)
  if (e.route === 'curve') return curvedRoute(e, lbl)
  if (e.src_side !== 'auto' || e.dst_side !== 'auto') return sidedRoute(e, lbl)
  if (e.route === 'straight' || Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) {
    if ((fc.direction === 'TB' && b.y < a.y && Math.abs(a.x - b.x) < 0.01) || (fc.direction === 'LR' && b.x < a.x && Math.abs(a.y - b.y) < 0.01)) {
      const side = fc.direction === 'TB' ? 'west' : 'south'
      const step = fc.direction === 'TB' ? '++(-1.9,0)' : '++(0,-1.3)'
      const turn = fc.direction === 'TB' ? '|-' : '-|'
      return `(${e.src}.${side}) -- ${step}${lbl} ${turn} (${e.dst}.${side})`
    }
    return `(${e.src}) --${lbl} (${e.dst})`
  }
  const firstAcross = fc.direction === 'TB' ? a.x !== b.x : a.y !== b.y
  const decision = a.kind === 'decision'
  const turn = fc.direction === 'TB' ? (decision && firstAcross ? '-|' : '|-') : decision && firstAcross ? '|-' : '-|'
  return `(${e.src}) ${turn}${lbl} (${e.dst})`
}

/** Python's f"{x:.2f}". */
function f2(x: number): string {
  const s = x.toFixed(2)
  return (x < 0 || Object.is(x, -0)) && !s.startsWith('-') ? `-${s}` : s
}

/** to_tikz */
export function toTikz(fc: Flowchart): string {
  const cols = colours(fc)
  const lines = [
    '\\begin{tikzpicture}[',
    `  font=\\sffamily\\fontsize{${fc.font_pt}}{${Math.round(fc.font_pt * 1.2)}}\\selectfont,`,
    '  >={Stealth[length=2.4mm]},',
    '  every node/.style={align=center, minimum height=0.9cm, inner sep=4pt, text width=2.4cm},',
    '  line/.style={draw=fc-line, thick},',
    ']',
  ]
  const defs = [`\\definecolor{fc-line}{HTML}{${hex(cols.line[0])}}`]
  for (const kind of Object.keys(KINDS)) {
    const [fill, txt] = cols[kind]
    defs.push(`\\definecolor{fc-${kind}}{HTML}{${hex(fill)}}`)
    defs.push(`\\definecolor{fc-${kind}-text}{HTML}{${hex(txt)}}`)
  }
  const body: string[] = []
  for (const n of fc.nodes) {
    const shape = (KINDS[n.kind] ?? KINDS.process)[1]
    const width = n.kind !== 'connector' ? '' : ', text width=0.5cm'
    let fill = `fc-${n.kind}`
    if (n.fill) {
      defs.push(`\\definecolor{fc-${n.id}}{HTML}{${hex(n.fill)}}`)
      fill = `fc-${n.id}`
    }
    body.push(`  \\node[${shape}${width}, draw=fc-line, fill=${fill}, text=fc-${n.kind}-text] (${n.id}) at (${f2(n.x * fc.col_cm)},${f2(-n.y * fc.row_cm)}) {${n.text}};`)
  }
  for (const e of fc.edges) {
    if (!nodeOf(fc, e.src) || !nodeOf(fc, e.dst)) continue
    const arrow = (HEADS[e.head] ?? HEADS.end)[1]
    body.push(`  \\draw[line, ${arrow}${e.dashed ? ', dashed' : ''}] ${route(fc, e)};`)
  }
  return [...defs, ...lines, ...body, '\\end{tikzpicture}'].join('\n') + '\n'
}

export const TIKZ_LIBRARIES = ['shapes.geometric', 'shapes.misc', 'shapes.symbols', 'arrows.meta']

/** standalone_doc */
export function standaloneDoc(fc: Flowchart): string {
  return [
    '\\documentclass[border=4pt]{standalone}', '\\usepackage{lmodern}', '\\usepackage{tikz}', `\\usetikzlibrary{${TIKZ_LIBRARIES.join(',')}}`,
    '\\begin{document}', toTikz(fc).trimEnd(), '\\end{document}', '',
  ].join('\n')
}

// --------------------------------------------------------------- templates

function chain(fc: Flowchart, steps: [string, string][]) {
  let prev: FcNode | null = null
  for (const [kind, text] of steps) prev = addNode(fc, kind, text, prev ? prev.id : null)
}

export const TEMPLATES: Record<string, () => Flowchart> = {
  'Simple process': () => {
    const fc = newChart()
    chain(fc, [['terminal', 'Start'], ['process', 'Collect data'], ['process', 'Analyse'], ['terminal', 'Report']])
    return fc
  },
  'Decision with a loop': () => {
    const fc = newChart()
    const start = addNode(fc, 'terminal', 'Start')
    const run = addNode(fc, 'process', 'Run the experiment', start.id)
    const check = addNode(fc, 'decision', 'Result valid?', run.id)
    addNode(fc, 'terminal', 'Publish', check.id, 'Yes')
    const fix: FcNode = { id: newId(fc), kind: 'process', text: 'Adjust the setup', x: 1.3, y: check.y, fill: '' }
    fc.nodes.push(fix)
    connect(fc, check.id, fix.id, 'No')
    connect(fc, fix.id, run.id)
    return fc
  },
  'Algorithm (sum to n)': () => {
    const fc = newChart()
    const s = addNode(fc, 'terminal', 'Start')
    const i = addNode(fc, 'io', 'Read $n$', s.id)
    const init = addNode(fc, 'process', '$i \\leftarrow 1$, $s \\leftarrow 0$', i.id)
    const test = addNode(fc, 'decision', '$i \\le n$?', init.id)
    const body = addNode(fc, 'process', '$s \\leftarrow s + i$\\\\$i \\leftarrow i+1$', test.id, 'Yes')
    connect(fc, body.id, test.id)
    const out: FcNode = { id: newId(fc), kind: 'io', text: 'Print $s$', x: 1.3, y: test.y, fill: '' }
    fc.nodes.push(out)
    const end: FcNode = { id: newId(fc), kind: 'terminal', text: 'End', x: 1.3, y: test.y + 1.4, fill: '' }
    fc.nodes.push(end)
    connect(fc, test.id, out.id, 'No')
    connect(fc, out.id, end.id)
    return fc
  },
  'Data pipeline (left to right)': () => {
    const fc = newChart({ direction: 'LR', row_cm: 1.8, col_cm: 3.4 })
    chain(fc, [['database', 'Raw data'], ['process', 'Clean'], ['subprocess', 'Model'], ['document', 'Report']])
    return fc
  },
}

/** natural_width: keeps the chart near its natural size on a 15 cm text block. */
export function naturalWidth(widthPt: number): string {
  const wCm = (widthPt / 72) * 2.54
  const frac = Math.min(1, Math.max(0.3, Math.round((wCm / 15) * 100) / 100))
  return `${String(frac)}\\textwidth`
}
