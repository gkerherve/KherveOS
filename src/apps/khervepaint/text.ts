// Text metrics. The desktop lays text out with Qt (QGraphicsTextItem: a
// 4 px document margin around the lines, point sizes at 96 dpi). In the
// browser we measure with a canvas; under Node (tests) a fixed-width estimate
// stands in.

import { PT } from './model'

export interface FontSpec {
  family: string
  /** Points. */
  size: number
  bold?: boolean
  italic?: boolean
}

export interface LineMetrics {
  width: number
  ascent: number
  descent: number
}

export type Measurer = (text: string, font: FontSpec) => LineMetrics

/** Qt's QTextDocument margin. */
export const TEXT_MARGIN = 4

/** Families to try after the document's own (Segoe UI is rarely installed off Windows). */
export const FONT_FALLBACK = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"

export function cssFamily(family: string): string {
  const f = family.trim()
  if (!f) return FONT_FALLBACK
  const quoted = /^[\w-]+$/.test(f) ? f : `'${f.replace(/'/g, '')}'`
  return `${quoted}, ${FONT_FALLBACK}`
}

export function cssFont(font: FontSpec): string {
  return `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${font.size * PT}px ${cssFamily(font.family)}`
}

/** Rough metrics: average glyph 0.55 em, Segoe-like ascent/descent. */
const estimate: Measurer = (text, font) => {
  const px = font.size * PT
  return { width: text.length * px * (font.bold ? 0.58 : 0.55), ascent: px * 1.06, descent: px * 0.27 }
}

let measurer: Measurer = estimate

export function setMeasurer(m: Measurer | null) {
  measurer = m ?? estimate
  cache.clear()
}

const cache = new Map<string, LineMetrics>()

export function measureLine(text: string, font: FontSpec): LineMetrics {
  const key = `${font.family}|${font.size}|${font.bold ? 1 : 0}|${font.italic ? 1 : 0}|${text}`
  let m = cache.get(key)
  if (!m) {
    m = measurer(text, font)
    if (cache.size > 4000) cache.clear()
    cache.set(key, m)
  }
  return m
}

export interface TextLayout {
  lines: string[]
  widths: number[]
  width: number
  lineHeight: number
  ascent: number
  /** The whole box, margins included (QGraphicsTextItem.boundingRect()). */
  boxW: number
  boxH: number
}

export function layoutText(text: string, font: FontSpec): TextLayout {
  const lines = text.split('\n')
  const widths = lines.map((l) => measureLine(l, font).width)
  const m = measureLine('Hg', font)
  const lineHeight = m.ascent + m.descent
  const width = Math.max(0, ...widths)
  return {
    lines,
    widths,
    width,
    lineHeight,
    ascent: m.ascent,
    boxW: width + 2 * TEXT_MARGIN,
    boxH: lines.length * lineHeight + 2 * TEXT_MARGIN,
  }
}

/** Break `text` into lines no wider than `maxW` (labels wrap like Qt's TextWordWrap). */
export function wrapText(text: string, font: FontSpec, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const next = line + w
      if (line.trim() && measureLine(next.trimEnd(), font).width > maxW) {
        out.push(line.trimEnd())
        line = w.trimStart()
      } else line = next
    }
    out.push(line.trimEnd())
  }
  return out
}

/** A measurer backed by a 2D canvas (browser only). */
export function canvasMeasurer(): Measurer | null {
  if (typeof document === 'undefined') return null
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  return (text, font) => {
    ctx.font = cssFont(font)
    const m = ctx.measureText(text || ' ')
    const px = font.size * PT
    const ascent = m.fontBoundingBoxAscent ?? px * 0.95
    const descent = m.fontBoundingBoxDescent ?? px * 0.25
    return { width: text ? m.width : 0, ascent, descent }
  }
}
