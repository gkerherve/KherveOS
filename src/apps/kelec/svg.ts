// The schematic as a stand-alone SVG string (File › Export as SVG / PNG).

import { junctions, docBounds } from './editor.ts'
import { defOf, labelPosition, partLabel, type Doc, type Part, type Prim } from './model.ts'

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface SvgColors { background: string; part: string; wire: string; text: string; muted: string; accent: string }

export const LIGHT_COLORS: SvgColors = { background: '#ffffff', part: '#1b4f72', wire: '#1f7a3a', text: '#222222', muted: '#666666', accent: '#b45309' }
export const DARK_COLORS: SvgColors = { background: '#14181c', part: '#7fb8e6', wire: '#5ac47a', text: '#e6e6e6', muted: '#9aa3ab', accent: '#f5a524' }

export function primSvg(pr: Prim, part: Part): string {
  if (pr.t === 'path') return `<path d="${pr.d}" fill="${pr.fill ? 'currentColor' : 'none'}"/>`
  if (pr.t === 'circle') return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${pr.fill ? 'currentColor' : 'none'}"/>`
  const m = part.mirror ? -1 : 1
  return `<text transform="translate(${pr.x} ${pr.y}) scale(${m} 1) rotate(${-part.rot})" font-size="${pr.size ?? 11}" text-anchor="${pr.anchor ?? 'middle'}" fill="currentColor" stroke="none" font-family="sans-serif">${esc(pr.s)}</text>`
}

/** The symbol group of a part, positioned and rotated. */
export function partSvg(part: Part): string {
  const prims = defOf(part).draw(part).map((p) => primSvg(p, part)).join('')
  return `<g transform="translate(${part.x} ${part.y}) rotate(${part.rot}) scale(${part.mirror ? -1 : 1} 1)">${prims}</g>`
}

export function docToSvg(doc: Doc, colors: SvgColors = LIGHT_COLORS, margin = 30): { svg: string; width: number; height: number } {
  const b = docBounds(doc) ?? { x1: 0, y1: 0, x2: 200, y2: 100 }
  const x0 = b.x1 - margin
  const y0 = b.y1 - margin
  const width = Math.ceil(b.x2 - b.x1 + 2 * margin)
  const height = Math.ceil(b.y2 - b.y1 + 2 * margin)
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${width} ${height}" font-family="sans-serif">`)
  out.push(`<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="${colors.background}"/>`)
  out.push(`<g stroke="${colors.wire}" stroke-width="1.6" stroke-linecap="round" fill="none">`)
  for (const w of doc.wires) out.push(`<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}"/>`)
  out.push('</g>')
  out.push(`<g fill="${colors.wire}">`)
  for (const j of junctions(doc)) out.push(`<circle cx="${j.x}" cy="${j.y}" r="3"/>`)
  out.push('</g>')
  out.push(`<g stroke="${colors.part}" color="${colors.part}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">`)
  for (const p of doc.parts) out.push(partSvg(p))
  out.push('</g>')
  out.push(`<g fill="${colors.text}" font-size="11">`)
  for (const p of doc.parts) {
    const t = partLabel(p)
    if (!t.ref && !t.value) continue
    const pos = labelPosition(p)
    out.push(`<text x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}" font-weight="600">${esc(t.ref)}</text>`)
    if (t.value) out.push(`<text x="${pos.x}" y="${pos.vy}" text-anchor="${pos.anchor}" fill="${colors.muted}">${esc(t.value)}</text>`)
  }
  for (const l of doc.labels) {
    const w = 10 + l.name.length * 6.5
    const d = l.flip ? -1 : 1
    out.push(`<path d="M${l.x} ${l.y} L${l.x + d * 6} ${l.y - 7} L${l.x + d * w} ${l.y - 7} L${l.x + d * w} ${l.y + 7} L${l.x + d * 6} ${l.y + 7} Z" fill="none" stroke="${colors.accent}" stroke-width="1.2"/>`)
    out.push(`<text x="${l.flip ? l.x - 9 : l.x + 9}" y="${l.y + 4}" text-anchor="${l.flip ? 'end' : 'start'}" fill="${colors.accent}">${esc(l.name)}</text>`)
  }
  for (const n of doc.notes) {
    n.text.split('\n').forEach((line, i) => out.push(`<text x="${n.x}" y="${n.y + i * 15}" fill="${colors.muted}">${esc(line)}</text>`))
  }
  out.push('</g></svg>')
  return { svg: out.join('\n'), width, height }
}
