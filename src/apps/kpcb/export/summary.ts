// A short report about a board (pure).

import { polyArea } from '../geom.ts'
import { trackLength, worldPads } from '../board.ts'
import { getFootprint } from '../footprints.ts'
import { frameBox } from '../layers.ts'
import { analyze, ratsnest } from '../analysis.ts'
import type { Design, Fills } from '../types.ts'

export interface BoardSummary {
  name: string
  widthMm: number
  heightMm: number
  areaMm2: number
  layers: number
  parts: number
  smdParts: number
  throughHoleParts: number
  pads: number
  nets: number
  tracks: number
  trackLengthMm: number
  trackLengthByLayer: { 'F.Cu': number; 'B.Cu': number }
  vias: number
  holes: number
  drills: number
  zones: number
  unconnected: number
}

export function boardSummary(d: Design, fills?: Fills): BoardSummary {
  const b = frameBox(d)
  const area = d.outline.pts.length >= 3 ? Math.abs(polyArea(d.outline.pts)) : (b.x1 - b.x0) * (b.y1 - b.y0)
  const len = { 'F.Cu': 0, 'B.Cu': 0 }
  for (const t of d.tracks) len[t.layer] += Math.hypot(t.x2 - t.x1, t.y2 - t.y1)
  let pads = 0
  let drills = d.vias.length + d.holes.length
  for (const p of d.parts) {
    for (const w of worldPads(p)) {
      pads++
      if (w.drill > 0) drills++
    }
  }
  const smd = d.parts.filter((p) => getFootprint(p.fp)?.smd).length
  const r = (n: number) => Math.round(n * 1000) / 1000
  return {
    name: d.name,
    widthMm: r(b.x1 - b.x0),
    heightMm: r(b.y1 - b.y0),
    areaMm2: r(area),
    layers: 2,
    parts: d.parts.length,
    smdParts: smd,
    throughHoleParts: d.parts.length - smd,
    pads,
    nets: d.nets.length,
    tracks: d.tracks.length,
    trackLengthMm: r(trackLength(d)),
    trackLengthByLayer: { 'F.Cu': r(len['F.Cu']), 'B.Cu': r(len['B.Cu']) },
    vias: d.vias.length,
    holes: d.holes.length,
    drills,
    zones: d.zones.length,
    unconnected: ratsnest(d, analyze(d, fills)).length,
  }
}

export function summaryText(s: BoardSummary): string {
  return [
    `Board ${s.name}: ${s.widthMm} x ${s.heightMm} mm (${s.areaMm2} mm2), ${s.layers} copper layers`,
    `${s.parts} parts (${s.smdParts} surface mount, ${s.throughHoleParts} through hole), ${s.pads} pads, ${s.nets} nets`,
    `${s.tracks} track segments, ${s.trackLengthMm} mm (top ${s.trackLengthByLayer['F.Cu']}, bottom ${s.trackLengthByLayer['B.Cu']}), ${s.vias} vias, ${s.zones} zones`,
    `${s.drills} drilled holes (${s.holes} mounting holes), ${s.unconnected} connections missing`,
  ].join('\n')
}
