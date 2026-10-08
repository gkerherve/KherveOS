// A tiny stroke font for silkscreen text (reference designators, labels): every glyph is a few
// polylines on a 4 × 6 grid (y down), so the same strokes can be drawn on screen, written to
// Gerber and put in an SVG. Pure TypeScript.

import type { Pt } from './geom.ts'

const G: Record<string, number[][]> = {
  A: [[0, 6, 2, 0, 4, 6], [0.8, 3.6, 3.2, 3.6]],
  B: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [3, 3, 4, 4, 4, 5, 3, 6, 0, 6]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
  G: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[4, 0, 4, 5, 3, 6, 1, 6, 0, 5]],
  K: [[0, 0, 0, 6], [4, 0, 0, 3.5], [1.5, 2.5, 4, 6]],
  L: [[0, 0, 0, 6, 4, 6]],
  M: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
  O: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]],
  P: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  Q: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [2.5, 4.5, 4, 6.5]],
  R: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [2, 3, 4, 6]],
  S: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  U: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
  V: [[0, 0, 2, 6, 4, 0]],
  W: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]],
  X: [[0, 0, 4, 6], [4, 0, 0, 6]],
  Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]],
  Z: [[0, 0, 4, 0, 0, 6, 4, 6]],
  '0': [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [0.8, 5.2, 3.2, 0.8]],
  '1': [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
  '2': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
  '3': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1.5, 3], [3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  '4': [[3, 6, 3, 0, 0, 4, 4, 4]],
  '5': [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  '6': [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  '7': [[0, 0, 4, 0, 1.5, 6]],
  '8': [[1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0], [1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  '9': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 4, 3]],
  '.': [[2, 5.6, 2, 6]],
  '-': [[0.5, 3, 3.5, 3]],
  '+': [[0.5, 3, 3.5, 3], [2, 1.5, 2, 4.5]],
  '/': [[0, 6, 4, 0]],
  _: [[0, 6, 4, 6]],
  '(': [[3, 0, 1, 2, 1, 4, 3, 6]],
  ')': [[1, 0, 3, 2, 3, 4, 1, 6]],
  '#': [[1, 0, 1, 6], [3, 0, 3, 6], [0, 2, 4, 2], [0, 4, 4, 4]],
  '=': [[0.5, 2, 3.5, 2], [0.5, 4, 3.5, 4]],
  ':': [[2, 1.8, 2, 2.2], [2, 4.2, 2, 4.6]],
  ',': [[2, 5.5, 1.5, 6.5]],
  '%': [[0, 0, 1, 0, 1, 1, 0, 1, 0, 0], [3, 5, 4, 5, 4, 6, 3, 6, 3, 5], [4, 0, 0, 6]],
  '*': [[0.5, 1.5, 3.5, 4.5], [3.5, 1.5, 0.5, 4.5], [2, 1, 2, 5]],
  '<': [[3.5, 1, 0.5, 3, 3.5, 5]],
  '>': [[0.5, 1, 3.5, 3, 0.5, 5]],
}

/** Characters without a glyph of their own. */
const ALIAS: Record<string, string> = { µ: 'U', μ: 'U', Ω: 'O', '°': 'O' }

const GLYPH_W = 4
const GLYPH_H = 6
const ADVANCE = 5

/** Width of a text of height `h`. */
export function textWidth(text: string, h: number): number {
  const n = [...text].length
  return n === 0 ? 0 : ((n * ADVANCE - (ADVANCE - GLYPH_W)) * h) / GLYPH_H
}

/**
 * The strokes of a text centred on (cx, cy): pairs of end points. `mirror` flips it left to right
 * (text on the bottom side, drawn the way the board is seen from the top).
 */
export function textStrokes(text: string, cx: number, cy: number, h: number, mirror = false): Array<[Pt, Pt]> {
  const s = h / GLYPH_H
  const chars = [...text.toUpperCase()]
  const total = textWidth(text, h)
  const out: Array<[Pt, Pt]> = []
  chars.forEach((ch, i) => {
    const glyph = G[ch] ?? G[ALIAS[ch] ?? '']
    if (!glyph) return
    const ox = i * ADVANCE * s - total / 2
    for (const line of glyph) {
      for (let k = 0; k + 3 < line.length; k += 2) {
        const ax = ox + line[k] * s
        const bx = ox + line[k + 2] * s
        out.push([
          { x: cx + (mirror ? -ax : ax), y: cy + (line[k + 1] - GLYPH_H / 2) * s },
          { x: cx + (mirror ? -bx : bx), y: cy + (line[k + 3] - GLYPH_H / 2) * s },
        ])
      }
    }
  })
  return out
}

/** Stroke thickness that looks right for a text height. */
export const strokeWidth = (h: number) => Math.max(0.1, h * 0.15)
