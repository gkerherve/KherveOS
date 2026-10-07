// Dimension (ruler) items: the measured length and where its label sits,
// shared by the canvas renderer and the SVG writer.

import type { DimensionItem } from './model'

export const UNIT_PER_MM: Record<string, number> = { mm: 1, cm: 0.1, in: 1 / 25.4 }

/** Length in millimetres at the document's dpi. */
export function dimLengthMm(it: DimensionItem, dpi: number): number {
  return (Math.hypot(it.x2 - it.x1, it.y2 - it.y1) / Math.max(dpi, 1)) * 25.4
}

/** The label text and its centre: 14 px off the middle of the line, on its left side. */
export function dimLabel(it: DimensionItem, dpi: number): { text: string; x: number; y: number } {
  const value = dimLengthMm(it, dpi) * (UNIT_PER_MM[it.unit] ?? 1)
  const text = `${it.prefix}${value.toFixed(Math.max(0, Math.min(20, it.decimals)))} ${it.unit}${it.suffix}`
  const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
  const mid = { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 }
  return { text, x: mid.x + Math.sin(a) * 14, y: mid.y - Math.cos(a) * 14 }
}
