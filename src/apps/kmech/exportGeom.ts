// Drawing exports (pure): SVG in millimetres and DXF (R12 ASCII: polylines, circles, lines) for laser cutting,
// and CSV for coordinate lists.

import { esc, type Pt } from './math.ts'

export type Shape =
  | { kind: 'polyline'; pts: readonly Pt[]; closed?: boolean; layer?: string; dashed?: boolean }
  | { kind: 'circle'; c: Pt; r: number; layer?: string; dashed?: boolean }
  | { kind: 'line'; a: Pt; b: Pt; layer?: string; dashed?: boolean }
  | { kind: 'text'; at: Pt; text: string; height: number; layer?: string }

export function shapesBounds(shapes: readonly Shape[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  for (const s of shapes) {
    if (s.kind === 'polyline') for (const p of s.pts) add(p.x, p.y)
    else if (s.kind === 'circle') { add(s.c.x - s.r, s.c.y - s.r); add(s.c.x + s.r, s.c.y + s.r) }
    else if (s.kind === 'line') { add(s.a.x, s.a.y); add(s.b.x, s.b.y) }
    else { add(s.at.x, s.at.y); add(s.at.x + s.text.length * s.height * 0.6, s.at.y + s.height) }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { minX, minY, maxX, maxY }
}

const n4 = (v: number) => (Math.abs(v) < 5e-5 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''))

export interface SvgOptions {
  /** colour of the cut lines */
  stroke?: string
  strokeWidth?: number
  /** colour of the construction (layer "construction") lines */
  construction?: string
  margin?: number
  title?: string
  background?: string
}

/** An SVG document in mm (y up in the drawing, flipped for SVG). Layers become groups with ids. */
export function shapesToSvg(shapes: readonly Shape[], o: SvgOptions = {}): string {
  const b = shapesBounds(shapes)
  const m = o.margin ?? 5
  const w = b.maxX - b.minX + 2 * m
  const h = b.maxY - b.minY + 2 * m
  const stroke = o.stroke ?? '#000000'
  const cons = o.construction ?? '#4b8bf5'
  const sw = o.strokeWidth ?? 0.2
  const X = (x: number) => n4(x - b.minX + m)
  const Y = (y: number) => n4(b.maxY - y + m)
  const layers = new Map<string, string[]>()
  const push = (layer: string, s: string) => layers.set(layer, [...(layers.get(layer) ?? []), s])
  for (const s of shapes) {
    const layer = s.layer ?? 'cut'
    const dash = 'dashed' in s && s.dashed ? ' stroke-dasharray="2 1.5"' : ''
    if (s.kind === 'polyline') {
      if (s.pts.length < 2) continue
      const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join('') + (s.closed ? 'Z' : '')
      push(layer, `<path d="${d}" fill="none"${dash}/>`)
    } else if (s.kind === 'circle') push(layer, `<circle cx="${X(s.c.x)}" cy="${Y(s.c.y)}" r="${n4(s.r)}" fill="none"${dash}/>`)
    else if (s.kind === 'line') push(layer, `<line x1="${X(s.a.x)}" y1="${Y(s.a.y)}" x2="${X(s.b.x)}" y2="${Y(s.b.y)}"${dash}/>`)
    else push(layer, `<text x="${X(s.at.x)}" y="${Y(s.at.y)}" font-size="${n4(s.height)}" font-family="sans-serif" fill="${cons}" stroke="none">${esc(s.text)}</text>`)
  }
  const groups = [...layers].map(([name, items]) => `  <g id="${esc(name)}" stroke="${name === 'construction' ? cons : stroke}" stroke-width="${sw}">\n    ${items.join('\n    ')}\n  </g>`).join('\n')
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n4(w)}mm" height="${n4(h)}mm" viewBox="0 0 ${n4(w)} ${n4(h)}">`,
    o.title ? `  <title>${esc(o.title)}</title>` : '',
    o.background ? `  <rect width="100%" height="100%" fill="${o.background}"/>` : '',
    groups,
    `</svg>`,
    '',
  ].filter(Boolean).join('\n')
}

/** DXF (AutoCAD R12 ASCII, millimetres): closed polylines, circles, lines, text; layers "cut" and "construction". */
export function shapesToDxf(shapes: readonly Shape[]): string {
  const out: string[] = []
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === 'number' ? n4(v) : v)
  const layerNames = [...new Set(['cut', 'construction', ...shapes.map((s) => s.layer ?? 'cut')])]
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, '4'); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, String(layerNames.length))
  layerNames.forEach((name, i) => { g(0, 'LAYER'); g(2, name); g(70, '0'); g(62, String(name === 'construction' ? 5 : i === 0 ? 7 : 1 + (i % 6))); g(6, 'CONTINUOUS') })
  g(0, 'ENDTAB'); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'ENTITIES')
  for (const s of shapes) {
    const layer = s.layer ?? 'cut'
    if (s.kind === 'polyline') {
      if (s.pts.length < 2) continue
      g(0, 'POLYLINE'); g(8, layer); g(66, '1'); g(70, s.closed ? '1' : '0')
      for (const p of s.pts) { g(0, 'VERTEX'); g(8, layer); g(10, p.x); g(20, p.y); g(30, 0) }
      g(0, 'SEQEND'); g(8, layer)
    } else if (s.kind === 'circle') { g(0, 'CIRCLE'); g(8, layer); g(10, s.c.x); g(20, s.c.y); g(30, 0); g(40, s.r) }
    else if (s.kind === 'line') { g(0, 'LINE'); g(8, layer); g(10, s.a.x); g(20, s.a.y); g(30, 0); g(11, s.b.x); g(21, s.b.y); g(31, 0) }
    else { g(0, 'TEXT'); g(8, layer); g(10, s.at.x); g(20, s.at.y); g(30, 0); g(40, s.height); g(1, s.text) }
  }
  g(0, 'ENDSEC'); g(0, 'EOF')
  return out.join('\n') + '\n'
}

/** Parses the polylines and circles back out of a DXF written by shapesToDxf (used by the tests and for checking). */
export function readDxf(text: string): Shape[] {
  const lines = text.split(/\r?\n/)
  const pairs: Array<[number, string]> = []
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()])
  const shapes: Shape[] = []
  let k = 0
  let inEntities = false
  while (k < pairs.length) {
    const [c, v] = pairs[k]
    if (c === 2 && v === 'ENTITIES') inEntities = true
    if (inEntities && c === 0 && v === 'POLYLINE') {
      let closed = false
      let layer = 'cut'
      k++
      while (k < pairs.length && !(pairs[k][0] === 0)) { if (pairs[k][0] === 70) closed = (Number(pairs[k][1]) & 1) === 1; if (pairs[k][0] === 8) layer = pairs[k][1]; k++ }
      const pts: Pt[] = []
      while (k < pairs.length && pairs[k][1] === 'VERTEX') {
        let x = 0; let y = 0
        k++
        while (k < pairs.length && pairs[k][0] !== 0) { if (pairs[k][0] === 10) x = Number(pairs[k][1]); if (pairs[k][0] === 20) y = Number(pairs[k][1]); k++ }
        pts.push({ x, y })
      }
      shapes.push({ kind: 'polyline', pts, closed, layer })
      continue
    }
    if (inEntities && c === 0 && v === 'CIRCLE') {
      let x = 0; let y = 0; let r = 0; let layer = 'cut'
      k++
      while (k < pairs.length && pairs[k][0] !== 0) { const [cc, vv] = pairs[k]; if (cc === 10) x = Number(vv); if (cc === 20) y = Number(vv); if (cc === 40) r = Number(vv); if (cc === 8) layer = vv; k++ }
      shapes.push({ kind: 'circle', c: { x, y }, r, layer })
      continue
    }
    k++
  }
  return shapes
}

/** Rows as CSV text. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<number | string>>): string {
  const cell = (v: number | string) => (typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : '') : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n'
}

/** Tab-separated text for "Open in kPlot". */
export function toTsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<number | string>>): string {
  const cell = (v: number | string) => (typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : '') : String(v).replace(/[\t\n]/g, ' '))
  return [header.map(cell).join('\t'), ...rows.map((r) => r.map(cell).join('\t'))].join('\n') + '\n'
}
