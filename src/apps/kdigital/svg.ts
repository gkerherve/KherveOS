// The schematic as a stand-alone SVG string (File › Export as SVG / PNG), optionally coloured by the values of
// a running simulation. Pure.

import { docBounds, junctions } from './editor.ts'
import { labelPosition, signalName, type Doc, type Part, type Prim } from './model.ts'
import { livePrims, valueClass } from './display.ts'
import { shapeOf } from './model.ts'
import type { Simulator } from './sim.ts'

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface SvgColors {
  background: string; part: string; wire: string; text: string; muted: string; accent: string
  high: string; low: string; unknown: string; hiz: string
  led: Record<string, string>
}

export const LIGHT_COLORS: SvgColors = {
  background: '#ffffff', part: '#2c3e50', wire: '#2f6f3e', text: '#222222', muted: '#6b7280', accent: '#b45309',
  high: '#15803d', low: '#1d4ed8', unknown: '#dc2626', hiz: '#9ca3af', led: { red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6' },
}
export const DARK_COLORS: SvgColors = {
  background: '#14181c', part: '#c7d2de', wire: '#5ac47a', text: '#e6e6e6', muted: '#9aa3ab', accent: '#f5a524',
  high: '#4ade80', low: '#60a5fa', unknown: '#f87171', hiz: '#9ca3af', led: { red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa' },
}

function primSvg(pr: Prim, part: Part, c: SvgColors): string {
  const cls = pr.cls ?? ''
  let stroke = ''
  let fill = pr.t !== 'text' && pr.fill ? 'currentColor' : 'none'
  let width = ''
  if (cls.startsWith('led-on')) { const col = c.led[cls.split('led-')[2]] ?? c.led.red; fill = col; stroke = ` stroke="${col}"` }
  else if (cls === 'led-off') { fill = 'none'; stroke = ` stroke="${c.muted}"` }
  else if (cls === 'led-x') { fill = c.unknown; stroke = ' stroke="none"' }
  else if (cls === 'led-z') { fill = c.hiz; stroke = ' stroke="none"' }
  else if (cls === 'seg-on') { stroke = ` stroke="${c.unknown}"`; width = ' stroke-width="6"' }
  else if (cls === 'seg-off') { stroke = ` stroke="${c.muted}" stroke-opacity="0.25"`; width = ' stroke-width="5"' }
  else if (cls === 'seg-off2') { stroke = ` stroke="${c.muted}" stroke-opacity="0.25"`; width = ' stroke-width="6"' }
  else if (cls === 'seg-x') { stroke = ` stroke="${c.accent}" stroke-opacity="0.6"`; width = ' stroke-width="6"' }
  else if (cls === 'knob-on') { fill = c.high; stroke = ' stroke="none"' }
  else if (cls === 'knob-off') { fill = c.muted; stroke = ' stroke="none"' }
  if (pr.t === 'path') return `<path d="${pr.d}" fill="${fill === 'currentColor' ? 'currentColor' : 'none'}"${stroke}${width}/>`
  if (pr.t === 'circle') return `<circle cx="${pr.cx}" cy="${pr.cy}" r="${pr.r}" fill="${fill}"${stroke}/>`
  const m = part.mirror ? -1 : 1
  const fillT = cls === 'digit-on' ? c.unknown : cls === 'digit-x' ? c.accent : cls === 'digit-off' ? c.muted : 'currentColor'
  return `<text transform="translate(${pr.x} ${pr.y}) scale(${m} 1) rotate(${-part.rot})" font-size="${pr.size ?? 11}" text-anchor="${pr.anchor ?? 'middle'}" fill="${fillT}" stroke="none" font-family="sans-serif"${pr.bold ? ' font-weight="700"' : ''}>${esc(pr.s)}</text>`
}

function partSvg(part: Part, c: SvgColors, sim: Simulator | null): string {
  const prims = [...shapeOf(part).prims, ...livePrims(part, sim)].map((p) => primSvg(p, part, c)).join('')
  return `<g transform="translate(${part.x} ${part.y}) rotate(${part.rot}) scale(${part.mirror ? -1 : 1} 1)">${prims}</g>`
}

export function docToSvg(doc: Doc, colors: SvgColors = LIGHT_COLORS, sim: Simulator | null = null, margin = 30): { svg: string; width: number; height: number } {
  const b = docBounds(doc) ?? { x1: 0, y1: 0, x2: 200, y2: 100 }
  const x0 = b.x1 - margin
  const y0 = b.y1 - margin
  const width = Math.ceil(b.x2 - b.x1 + 2 * margin)
  const height = Math.ceil(b.y2 - b.y1 + 2 * margin)
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${width} ${height}" font-family="sans-serif">`)
  out.push(`<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="${colors.background}"/>`)
  out.push('<g stroke-width="1.6" stroke-linecap="round" fill="none">')
  for (const w of doc.wires) {
    let col = colors.wire
    if (sim) {
      const n = sim.nl.pointNet.get(`${w.x1},${w.y1}`)
      if (n !== undefined) col = ({ v1: colors.high, v0: colors.low, vx: colors.unknown, vz: colors.hiz } as Record<string, string>)[valueClass(sim.netVal[n])] ?? colors.wire
    }
    out.push(`<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${col}"/>`)
  }
  out.push('</g>')
  out.push(`<g fill="${colors.wire}">`)
  for (const j of junctions(doc)) out.push(`<circle cx="${j.x}" cy="${j.y}" r="3"/>`)
  out.push('</g>')
  out.push(`<g stroke="${colors.part}" color="${colors.part}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">`)
  for (const p of doc.parts) out.push(partSvg(p, colors, sim))
  out.push('</g>')
  out.push(`<g fill="${colors.text}" font-size="11">`)
  for (const p of doc.parts) {
    const name = signalName(p)
    const text = name || p.ref
    const pos = labelPosition(p)
    out.push(`<text x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}" font-weight="600">${esc(text)}</text>`)
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
  out.push('</g>')
  out.push('</svg>')
  return { svg: out.join('\n'), width, height }
}
