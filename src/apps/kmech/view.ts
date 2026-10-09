// The canvas view (pure): world coordinates are millimetres with y up; the screen has y down.

import type { Pt } from './math.ts'

export interface View {
  /** world point at the centre of the canvas */
  cx: number
  cy: number
  /** pixels per mm */
  scale: number
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 400

export const toScreen = (v: View, w: number, h: number, p: Pt): Pt => ({ x: w / 2 + (p.x - v.cx) * v.scale, y: h / 2 - (p.y - v.cy) * v.scale })
export const toWorld = (v: View, w: number, h: number, x: number, y: number): Pt => ({ x: v.cx + (x - w / 2) / v.scale, y: v.cy - (y - h / 2) / v.scale })

/** Zoom by `factor` keeping the world point under the screen position (x, y) fixed. */
export function zoomAt(v: View, w: number, h: number, x: number, y: number, factor: number): View {
  const before = toWorld(v, w, h, x, y)
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const next = { ...v, scale }
  const after = toWorld(next, w, h, x, y)
  return { ...next, cx: v.cx + before.x - after.x, cy: v.cy + before.y - after.y }
}

/** A view that shows the box with a margin (fraction of the size). */
export function fitBox(b: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number, margin = 0.12): View {
  const bw = Math.max(1e-6, b.maxX - b.minX)
  const bh = Math.max(1e-6, b.maxY - b.minY)
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w / (bw * (1 + 2 * margin)), h / (bh * (1 + 2 * margin)))))
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale }
}

/** A "nice" grid step (1, 2 or 5 × 10ⁿ mm) so that grid lines are about `target` px apart. */
export function niceStep(scale: number, target = 24): number {
  const raw = target / scale
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

export const snapTo = (v: number, step: number): number => Math.round(v / step) * step
