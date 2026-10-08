// Gerber RS-274X and Excellon drill files (pure). Every copper, silkscreen, mask, paste and edge layer
// becomes one .gbr file in a frame whose origin is the lower left corner of the board (y up);
// pads are flashes with apertures (standard C, R, O and macros for rounded and rotated pads), tracks
// are strokes, zone copper is regions (the holes of a pour are cut with clear polarity).

import type { Pt } from '../geom.ts'
import { drillHits, frameBox, layerPrims } from '../layers.ts'
import type { DrillHit, Prim } from '../layers.ts'
import type { Design, Fills, LayerId } from '../types.ts'

export interface GerberFile {
  name: string
  layer: LayerId | 'PTH' | 'NPTH'
  text: string
  /** Counts for checking: D03 flashes, D01 draws outside regions, G36 regions. */
  flashes: number
  draws: number
  regions: number
}

export interface Frame {
  x0: number
  y1: number
}

/** The origin of the exports: the lower left corner of the board outline. */
export function frameOf(d: Design): Frame {
  const b = frameBox(d)
  return { x0: b.x0, y1: b.y1 }
}

const FUNCTIONS: Partial<Record<LayerId, [string, string]>> = {
  'F.Cu': ['Copper,L1,Top', 'Positive'],
  'B.Cu': ['Copper,L2,Bot', 'Positive'],
  'F.Silk': ['Legend,Top', 'Positive'],
  'B.Silk': ['Legend,Bot', 'Positive'],
  'F.Mask': ['Soldermask,Top', 'Negative'],
  'B.Mask': ['Soldermask,Bot', 'Negative'],
  'F.Paste': ['Paste,Top', 'Positive'],
  'B.Paste': ['Paste,Bot', 'Positive'],
  'Edge.Cuts': ['Profile,NP', 'Positive'],
}

export const GERBER_LAYERS: readonly LayerId[] = ['F.Cu', 'B.Cu', 'F.Silk', 'B.Silk', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'Edge.Cuts']

const fileSuffix = (l: LayerId) => l.replace('.', '_')

/** mm → integer coordinate with 6 decimals (format 4.6). */
const co = (mm: number) => String(Math.round(mm * 1e6))

const MACROS = [
  '%AMROTRECT*21,1,$1,$2,0,0,$3*%',
  '%AMOVALROT*21,1,$1-$2,$2,0,0,$3*1,1,$2,0.5x$1-0.5x$2,0,$3*1,1,$2,-0.5x$1+0.5x$2,0,$3*%',
  '%AMRRECT*21,1,$1-2x$3,$2,0,0,$4*21,1,$1,$2-2x$3,0,0,$4*1,1,2x$3,0.5x$1-$3,0.5x$2-$3,$4*1,1,2x$3,-0.5x$1+$3,0.5x$2-$3,$4*1,1,2x$3,-0.5x$1+$3,-0.5x$2+$3,$4*1,1,2x$3,0.5x$1-$3,-0.5x$2+$3,$4*%',
]

const n6 = (v: number) => (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')

/** The aperture definition for a pad shape, or a width for strokes. */
function apertureFor(p: Prim): string {
  if (p.k === 'seg') return `C,${n6(p.w)}`
  if (p.k !== 'flash') return ''
  const rot = p.rot % 360
  const quarter = Math.abs(rot % 90) < 1e-6
  const swap = quarter && Math.round(rot / 90) % 2 === 1
  const w = swap ? p.h : p.w
  const h = swap ? p.w : p.h
  switch (p.shape) {
    case 'circle': return `C,${n6(p.w)}`
    case 'rect': return quarter ? `R,${n6(w)}X${n6(h)}` : `ROTRECT,${n6(p.w)}X${n6(p.h)}X${n6(rot)}`
    case 'oval': return quarter ? `O,${n6(w)}X${n6(h)}` : p.w >= p.h ? `OVALROT,${n6(p.w)}X${n6(p.h)}X${n6(rot)}` : `OVALROT,${n6(p.h)}X${n6(p.w)}X${n6(rot + 90)}`
    case 'roundrect': return `RRECT,${n6(p.w)}X${n6(p.h)}X${n6(Math.min(p.w, p.h) * p.rr)}X${n6(rot)}`
  }
}

/** One layer as a Gerber file. */
export function gerberLayer(d: Design, layer: LayerId, fills: Fills | undefined, name: string, frame: Frame = frameOf(d)): GerberFile {
  const prims = layerPrims(d, layer, fills)
  const X = (x: number) => `X${co(x - frame.x0)}`
  const Y = (y: number) => `Y${co(frame.y1 - y)}`
  const xy = (p: Pt) => `${X(p.x)}${Y(p.y)}`
  const aps = new Map<string, number>()
  const apOf = (def: string) => {
    let n = aps.get(def)
    if (n === undefined) aps.set(def, (n = 10 + aps.size))
    return n
  }
  const body: string[] = []
  let flashes = 0
  let draws = 0
  let regions = 0
  let cur = -1
  let lastEnd: Pt | null = null
  let polarity = 'D'
  const polar = (p: 'D' | 'C') => {
    if (p !== polarity) {
      body.push(`%LP${p}*%`)
      polarity = p
    }
  }
  const select = (n: number) => {
    if (n !== cur) {
      body.push(`D${n}*`)
      cur = n
    }
  }
  const ring = (pts: readonly Pt[]) => {
    body.push('G36*')
    body.push(`${xy(pts[0])}D02*`)
    for (let i = 1; i < pts.length; i++) body.push(`${xy(pts[i])}D01*`)
    body.push(`${xy(pts[0])}D01*`)
    body.push('G37*')
    regions++
  }

  for (const p of prims) {
    if (p.k === 'region') {
      polar('D')
      ring(p.outer)
      if (p.holes.length) {
        polar('C')
        for (const h of p.holes) ring(h)
        polar('D')
      }
    }
  }
  polar('D')
  for (const p of prims) {
    if (p.k === 'seg') {
      if (Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) < 1e-9) {
        select(apOf(apertureFor({ ...p, k: 'seg' })))
        body.push(`${xy(p.a)}D03*`)
        flashes++
        continue
      }
      select(apOf(apertureFor(p)))
      if (!lastEnd || Math.abs(lastEnd.x - p.a.x) > 1e-9 || Math.abs(lastEnd.y - p.a.y) > 1e-9) body.push(`${xy(p.a)}D02*`)
      body.push(`${xy(p.b)}D01*`)
      lastEnd = p.b
      draws++
    } else if (p.k === 'flash') {
      select(apOf(apertureFor(p)))
      body.push(`${X(p.x)}${Y(p.y)}D03*`)
      lastEnd = null
      flashes++
    }
    if (p.k !== 'seg') lastEnd = null
  }

  const [fn, pol] = FUNCTIONS[layer] ?? ['Other,Drill', 'Positive']
  const head = [
    'G04 Created by kPCB, KherveOS*',
    `%TF.GenerationSoftware,KherveOS,kPCB,1.0*%`,
    `%TF.FileFunction,${fn}*%`,
    `%TF.FilePolarity,${pol}*%`,
    '%FSLAX46Y46*%',
    'G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*',
    '%MOMM*%',
    ...MACROS,
    ...[...aps.entries()].map(([def, n]) => `%ADD${n}${def}*%`),
    '%LPD*%',
    'G01*',
  ]
  // the body starts with the first selected aperture; the aperture definitions come first
  const text = [...head, ...body, 'M02*'].join('\n') + '\n'
  return { name, layer, text, flashes, draws, regions }
}

// ------------------------------------------------------------ Excellon

function excellon(hits: DrillHit[], plated: boolean, name: string, frame: Frame): GerberFile | null {
  if (!hits.length) return null
  const tools = [...new Set(hits.map((h) => Math.round(h.d * 1000) / 1000))].sort((a, b) => a - b)
  const lines = [
    'M48',
    '; DRILL file created by kPCB, KherveOS',
    '; FORMAT={-:-/ absolute / metric / decimal}',
    `; #@! TF.FileFunction,${plated ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH'}`,
    'FMAT,2',
    'METRIC,TZ',
    ...tools.map((t, i) => `T${i + 1}C${t.toFixed(3)}`),
    '%',
    'G90',
    'G05',
  ]
  tools.forEach((t, i) => {
    lines.push(`T${i + 1}`)
    for (const h of hits) {
      if (Math.abs(Math.round(h.d * 1000) / 1000 - t) > 1e-9) continue
      lines.push(`X${(h.x - frame.x0).toFixed(3)}Y${(frame.y1 - h.y).toFixed(3)}`)
    }
  })
  lines.push('T0', 'M30')
  return { name, layer: plated ? 'PTH' : 'NPTH', text: lines.join('\n') + '\n', flashes: 0, draws: hits.length, regions: 0 }
}

/** Every Gerber layer and the plated / non-plated drill files. */
export function exportGerbers(d: Design, fills?: Fills): GerberFile[] {
  const frame = frameOf(d)
  const files: GerberFile[] = []
  for (const l of GERBER_LAYERS) {
    if ((l === 'B.Paste' || l === 'F.Paste') && !layerPrims(d, l).length) continue
    files.push(gerberLayer(d, l, fills, `${d.name}-${fileSuffix(l)}.gbr`, frame))
  }
  const hits = drillHits(d)
  const pth = excellon(hits.filter((h) => h.plated), true, `${d.name}-PTH.drl`, frame)
  const npth = excellon(hits.filter((h) => !h.plated), false, `${d.name}-NPTH.drl`, frame)
  if (pth) files.push(pth)
  if (npth) files.push(npth)
  return files
}
