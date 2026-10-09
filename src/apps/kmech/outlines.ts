// Cutting outlines for export (pure): cam profile and gear outlines as shapes for SVG and DXF.

import { camProfile, type CamProfile, type CamSpec } from './cam.ts'
import type { Shape } from './exportGeom.ts'
import { gearOutline, meshAngles, placePoints, type GearGeometry, type PairGeometry } from './gear.ts'

/** The cam outline (layer "cut"), its bore, and the base circle, prime circle and pitch curve (layer "construction"). */
export function camShapes(m: CamSpec, profile: CamProfile = camProfile(m, 720)): Shape[] {
  const shapes: Shape[] = [{ kind: 'polyline', pts: profile.profile, closed: true, layer: 'cut' }]
  if (m.bore > 0) shapes.push({ kind: 'circle', c: { x: 0, y: 0 }, r: m.bore / 2, layer: 'cut' })
  shapes.push({ kind: 'circle', c: { x: 0, y: 0 }, r: m.baseRadius, layer: 'construction', dashed: true })
  if (m.follower === 'roller') {
    shapes.push({ kind: 'circle', c: { x: 0, y: 0 }, r: profile.stats.primeRadius, layer: 'construction', dashed: true })
    shapes.push({ kind: 'polyline', pts: profile.pitch, closed: true, layer: 'construction', dashed: true })
  }
  return shapes
}

/** One gear: the outline and a bore (layer "cut"), the pitch and base circles (layer "construction"). */
export function gearShapes(g: GearGeometry, bore = 0, at = { x: 0, y: 0 }, angle = 0, withCircles = true): Shape[] {
  const out: Shape[] = [{ kind: 'polyline', pts: placePoints(gearOutline(g, 16, 6), angle, at), closed: true, layer: 'cut' }]
  if (bore > 0) out.push({ kind: 'circle', c: at, r: bore / 2, layer: 'cut' })
  if (withCircles) {
    out.push({ kind: 'circle', c: at, r: g.d / 2, layer: 'construction', dashed: true })
    out.push({ kind: 'circle', c: at, r: g.db / 2, layer: 'construction', dashed: true })
  }
  return out
}

/** The pair in mesh at the working centre distance (gear 2 on the +x axis). */
export function pairShapes(pg: PairGeometry, bore = 0): Shape[] {
  const a = meshAngles(pg.g1, pg.g2, 0)
  return [...gearShapes(pg.g1, bore, { x: 0, y: 0 }, a.phi1), ...gearShapes(pg.g2, bore, { x: pg.aw, y: 0 }, a.phi2)]
}
