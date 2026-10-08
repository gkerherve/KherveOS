// SVG image of the top or bottom of a board (pure): the realistic green board or black and white
// for printing. The bottom is mirrored, as you see it when you turn the board over.

import { frameBox, SCHEMES, viewItems } from '../layers.ts'
import type { Prim, Scheme, ViewItem } from '../layers.ts'
import type { Design, Fills } from '../types.ts'

export interface SvgOptions {
  side?: 'F' | 'B'
  scheme?: Scheme
  /** Space around the board in mm (default 1.5). */
  margin?: number
}

const f = (n: number) => String(Math.round(n * 1e4) / 1e4)

function primSvg(p: Prim, color: string): string {
  if (p.k === 'seg') return `<line x1="${f(p.a.x)}" y1="${f(p.a.y)}" x2="${f(p.b.x)}" y2="${f(p.b.y)}" stroke="${color}" stroke-width="${f(p.w)}" stroke-linecap="round"/>`
  if (p.k === 'region') {
    const path = [p.outer, ...p.holes].map((r) => `M${r.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}Z`).join('')
    return `<path d="${path}" fill="${color}" fill-rule="evenodd"/>`
  }
  if (p.shape === 'circle') return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.w / 2)}" fill="${color}"/>`
  const rx = p.shape === 'oval' ? Math.min(p.w, p.h) / 2 : p.shape === 'roundrect' ? Math.min(p.w, p.h) * p.rr : 0
  const tf = p.rot ? ` transform="rotate(${f(-p.rot)} ${f(p.x)} ${f(p.y)})"` : ''
  return `<rect x="${f(p.x - p.w / 2)}" y="${f(p.y - p.h / 2)}" width="${f(p.w)}" height="${f(p.h)}" rx="${f(rx)}"${tf} fill="${color}"/>`
}

export function renderSvg(d: Design, fills: Fills | undefined, opts: SvgOptions = {}): string {
  const side = opts.side ?? 'F'
  const scheme = opts.scheme ?? 'board'
  const m = opts.margin ?? 1.5
  const b = frameBox(d)
  const x0 = b.x0 - m
  const y0 = b.y0 - m
  const w = b.x1 - b.x0 + 2 * m
  const h = b.y1 - b.y0 + 2 * m
  const items: ViewItem[] = viewItems(d, fills, side, scheme)
  const body = items.map((it) => `<g data-layer="${it.kind}">${it.prims.map((p) => primSvg(p, it.color)).join('')}</g>`).join('\n')
  const flip = side === 'B' ? ` transform="matrix(-1 0 0 1 ${f(2 * x0 + w)} 0)"` : ''
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}">`,
    `<title>${d.name.replace(/[<&]/g, '')} (${side === 'F' ? 'top' : 'bottom'})</title>`,
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="${SCHEMES[scheme].bg}"/>`,
    `<g${flip}>`,
    body,
    '</g>',
    '</svg>',
    '',
  ].join('\n')
}
