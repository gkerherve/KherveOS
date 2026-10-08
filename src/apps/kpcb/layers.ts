// The artwork of every layer as drawing primitives (pure): strokes, flashes and filled regions.
// Gerber files, SVG and PNG images and the 3D texture are all made from these.

import type { Pt } from './geom.ts'
import { polyBox } from './geom.ts'
import { outlineBox, designBox, netOfPad, partCourtyard, partSilk, refTextPos, REF_TEXT_H, worldPads } from './board.ts'
import { strokeWidth, textStrokes } from './font.ts'
import type { Design, Fills, LayerId } from './types.ts'

export type Prim =
  | { k: 'seg'; a: Pt; b: Pt; w: number; net?: string }
  | { k: 'flash'; x: number; y: number; shape: 'circle' | 'rect' | 'oval' | 'roundrect'; w: number; h: number; rot: number; rr: number; net?: string }
  | { k: 'region'; outer: Pt[]; holes: Pt[][]; net?: string }

export const MASK_MARGIN = 0.05
export const SILK_WIDTH = 0.12
export const EDGE_WIDTH = 0.1

function padFlash(x: number, y: number, shape: 'round' | 'rect' | 'oval' | 'roundrect', w: number, h: number, rot: number, rr: number, grow: number, net?: string): Prim {
  let s: 'circle' | 'rect' | 'oval' | 'roundrect' = shape === 'round' ? (Math.abs(w - h) < 1e-9 ? 'circle' : 'oval') : shape
  if (s === 'oval' && Math.abs(w - h) < 1e-9) s = 'circle'
  return { k: 'flash', x, y, shape: s, w: w + 2 * grow, h: h + 2 * grow, rot: ((rot % 360) + 360) % 360, rr, ...(net ? { net } : {}) }
}

/** The primitives of one layer, in drawing order (regions first). */
export function layerPrims(d: Design, layer: LayerId, fills?: Fills): Prim[] {
  const out: Prim[] = []
  const side = layer.startsWith('F.') ? 'F' : layer.startsWith('B.') ? 'B' : null
  switch (layer) {
    case 'F.Cu':
    case 'B.Cu': {
      if (fills) {
        for (const z of d.zones) {
          if (z.layer !== layer) continue
          for (const p of fills[z.id] ?? []) out.push({ k: 'region', outer: p.outer, holes: p.holes, net: z.net })
        }
      }
      for (const t of d.tracks) if (t.layer === layer) out.push({ k: 'seg', a: { x: t.x1, y: t.y1 }, b: { x: t.x2, y: t.y2 }, w: t.w, net: t.net })
      for (const part of d.parts) {
        for (const p of worldPads(part)) {
          if (!p.layers.includes(layer)) continue
          out.push(padFlash(p.x, p.y, p.def.shape, p.w, p.h, p.rot, p.def.rr ?? 0.25, 0, netOfPad(d, part.ref, p.n) || undefined))
        }
      }
      for (const v of d.vias) out.push({ k: 'flash', x: v.x, y: v.y, shape: 'circle', w: v.d, h: v.d, rot: 0, rr: 0, net: v.net })
      break
    }
    case 'F.Mask':
    case 'B.Mask': {
      const cu = side === 'F' ? 'F.Cu' : 'B.Cu'
      for (const part of d.parts) {
        for (const p of worldPads(part)) if (p.layers.includes(cu)) out.push(padFlash(p.x, p.y, p.def.shape, p.w, p.h, p.rot, p.def.rr ?? 0.25, MASK_MARGIN))
      }
      break
    }
    case 'F.Paste':
    case 'B.Paste': {
      const cu = side === 'F' ? 'F.Cu' : 'B.Cu'
      for (const part of d.parts) {
        if (part.side !== side) continue
        for (const p of worldPads(part)) if (p.def.drill === undefined && p.layers.includes(cu)) out.push(padFlash(p.x, p.y, p.def.shape, p.w, p.h, p.rot, p.def.rr ?? 0.25, 0))
      }
      break
    }
    case 'F.Silk':
    case 'B.Silk': {
      for (const part of d.parts) {
        if (part.side !== side) continue
        for (const [a, b] of partSilk(part)) out.push({ k: 'seg', a, b, w: SILK_WIDTH })
        if (!part.hideRef) {
          const tp = refTextPos(part)
          for (const [a, b] of textStrokes(part.ref, tp.x, tp.y, REF_TEXT_H, side === 'B')) out.push({ k: 'seg', a, b, w: strokeWidth(REF_TEXT_H) })
        }
      }
      break
    }
    case 'Courtyard': {
      for (const part of d.parts) {
        const c = partCourtyard(part)
        for (let i = 0; i < c.length; i++) out.push({ k: 'seg', a: c[i], b: c[(i + 1) % c.length], w: 0.05 })
      }
      break
    }
    case 'Edge.Cuts': {
      const r = d.outline.pts
      for (let i = 0; i < r.length && r.length >= 3; i++) out.push({ k: 'seg', a: r[i], b: r[(i + 1) % r.length], w: EDGE_WIDTH })
      break
    }
    case 'Drill': {
      for (const h of drillHits(d)) out.push({ k: 'flash', x: h.x, y: h.y, shape: 'circle', w: h.d, h: h.d, rot: 0, rr: 0 })
      break
    }
  }
  return out
}

export interface DrillHit {
  x: number
  y: number
  d: number
  plated: boolean
}

/** Every hole to drill: pads with drills, vias, free holes. */
export function drillHits(d: Design): DrillHit[] {
  const out: DrillHit[] = []
  for (const part of d.parts) for (const p of worldPads(part)) if (p.drill > 0) out.push({ x: p.x, y: p.y, d: p.drill, plated: p.plated })
  for (const v of d.vias) out.push({ x: v.x, y: v.y, d: v.drill, plated: true })
  for (const h of d.holes) out.push({ x: h.x, y: h.y, d: h.d, plated: false })
  return out
}

/** The area an image or Gerber frame covers: the board outline, or everything on the board. */
export function frameBox(d: Design) {
  return outlineBox(d) ?? designBox(d) ?? { x0: 0, y0: 0, x1: 50, y1: 50 }
}

// ------------------------------------------------------------ images

export type Scheme = 'board' | 'bw'

export interface ViewItem {
  prims: Prim[]
  color: string
  /** Hole drawn with this colour on top (drills). */
  kind: 'board' | 'copper' | 'pad' | 'silk' | 'drill' | 'edge'
}

export interface SchemeColors {
  bg: string
  board: string
  copper: string
  pad: string
  silk: string
  drill: string
  edge: string
}

export const SCHEMES: Record<Scheme, SchemeColors> = {
  board: { bg: '#141816', board: '#1c6b3c', copper: '#2f9a5a', pad: '#d9d4b8', silk: '#f4f4ee', drill: '#0c0f0d', edge: '#e8d78a' },
  bw: { bg: '#ffffff', board: '#ffffff', copper: '#000000', pad: '#000000', silk: '#707070', drill: '#ffffff', edge: '#000000' },
}

/** The layers of a view of the top or bottom of the board, in drawing order. */
export function viewItems(d: Design, fills: Fills | undefined, side: 'F' | 'B', scheme: Scheme): ViewItem[] {
  const c = SCHEMES[scheme]
  const cu = side === 'F' ? 'F.Cu' : 'B.Cu'
  const edge = layerPrims(d, 'Edge.Cuts')
  const items: ViewItem[] = []
  if (d.outline.pts.length >= 3) items.push({ prims: [{ k: 'region', outer: d.outline.pts, holes: [] }], color: c.board, kind: 'board' })
  items.push({ prims: layerPrims(d, cu, fills), color: c.copper, kind: 'copper' })
  items.push({ prims: layerPrims(d, side === 'F' ? 'F.Mask' : 'B.Mask'), color: c.pad, kind: 'pad' })
  items.push({ prims: layerPrims(d, side === 'F' ? 'F.Silk' : 'B.Silk'), color: c.silk, kind: 'silk' })
  items.push({ prims: layerPrims(d, 'Drill'), color: c.drill, kind: 'drill' })
  items.push({ prims: edge, color: c.edge, kind: 'edge' })
  return items
}

export function primsBox(prims: readonly Prim[]) {
  const pts: Pt[] = []
  for (const p of prims) {
    if (p.k === 'seg') pts.push(p.a, p.b)
    else if (p.k === 'flash') pts.push({ x: p.x - p.w / 2, y: p.y - p.h / 2 }, { x: p.x + p.w / 2, y: p.y + p.h / 2 })
    else pts.push(...p.outer)
  }
  return pts.length ? polyBox(pts) : null
}
