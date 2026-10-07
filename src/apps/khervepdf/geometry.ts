// Geometry for annotations in page space (PDF points, display orientation,
// y down): bounding boxes, hit tests, moves, page-rotation remapping, and the
// text layout MuPDF uses for free-text boxes.

import type { PdfAnnot, PdfPageInfo, PdfPoint, PdfRect } from '@/os/services/pdf'

export type Pt = PdfPoint

export function normRect(a: Pt, b: Pt): PdfRect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

export function unionRect(rects: PdfRect[]): PdfRect | null {
  if (!rects.length) return null
  let [x0, y0, x1, y1] = rects[0]
  for (const r of rects) {
    x0 = Math.min(x0, r[0])
    y0 = Math.min(y0, r[1])
    x1 = Math.max(x1, r[2])
    y1 = Math.max(y1, r[3])
  }
  return [x0, y0, x1, y1]
}

export function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

export function inflate(r: PdfRect, d: number): PdfRect {
  return [r[0] - d, r[1] - d, r[2] + d, r[3] + d]
}

export function inRect(r: PdfRect, x: number, y: number, pad = 0): boolean {
  return x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad
}

export function distToSegment(p: Pt, q: Pt, x: number, y: number): number {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  if (dx === 0 && dy === 0) return Math.hypot(x - p[0], y - p[1])
  const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (p[0] + t * dx), y - (p[1] + t * dy))
}

/** The icon of a sticky note (MuPDF draws them 20 × 20). */
export function noteRect(a: PdfAnnot): PdfRect {
  const [x, y] = a.rect ?? [0, 0]
  return [x, y, x + 20, y + 20]
}

/** Bounding box of an annotation, including its stroke. */
export function annotBBox(a: PdfAnnot): PdfRect | null {
  const half = (a.width ?? 0) / 2
  switch (a.kind) {
    case 'ink': {
      const pts = (a.strokes ?? []).flat()
      if (!pts.length) return null
      return inflate(unionRect(pts.map((p) => [p[0], p[1], p[0], p[1]] as PdfRect))!, half)
    }
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
      return unionRect(a.rects ?? (a.rect ? [a.rect] : []))
    case 'line':
    case 'arrow':
      return a.line ? inflate(normRect(a.line[0], a.line[1]), Math.max(half, a.kind === 'arrow' ? arrowHead(a.width) : 0)) : null
    case 'rect':
    case 'ellipse':
      return a.rect ? inflate(a.rect, half) : null
    case 'note':
      return noteRect(a)
    default:
      return a.rect ?? null
  }
}

export const arrowHead = (width: number) => Math.max(6, width * 4.5)

/** The annotation drawn on top under (x, y), or null. `tol` in points. */
export function hitAnnot(annots: PdfAnnot[], page: number, x: number, y: number, tol: number): PdfAnnot | null {
  for (let i = annots.length - 1; i >= 0; i--) {
    const a = annots[i]
    if (a.page !== page) continue
    switch (a.kind) {
      case 'ink':
        for (const s of a.strokes ?? []) {
          if (s.length === 1 && Math.hypot(x - s[0][0], y - s[0][1]) <= Math.max(tol, a.width)) return a
          for (let j = 0; j + 1 < s.length; j++) if (distToSegment(s[j], s[j + 1], x, y) <= Math.max(tol, a.width)) return a
        }
        break
      case 'line':
      case 'arrow':
        if (a.line && distToSegment(a.line[0], a.line[1], x, y) <= Math.max(tol, a.width)) return a
        break
      case 'highlight':
      case 'underline':
      case 'strikeout':
      case 'squiggly':
        if ((a.rects ?? []).some((r) => inRect(r, x, y, Math.max(1, tol / 2)))) return a
        break
      default: {
        const b = annotBBox(a)
        if (b && inRect(b, x, y, tol)) return a
      }
    }
  }
  return null
}

const mapRect = (r: PdfRect, f: (p: Pt) => Pt): PdfRect => {
  const p = f([r[0], r[1]])
  const q = f([r[2], r[3]])
  return normRect(p, q)
}

/** Apply a point transform to every coordinate of an annotation. */
export function mapAnnot(a: PdfAnnot, f: (p: Pt) => Pt, rectKinds = true): PdfAnnot {
  const out: PdfAnnot = { ...a }
  if (a.strokes) out.strokes = a.strokes.map((s) => s.map(f))
  if (a.line) out.line = [f(a.line[0]), f(a.line[1])]
  if (a.rects) out.rects = a.rects.map((r) => mapRect(r, f))
  if (a.rect && rectKinds) out.rect = mapRect(a.rect, f)
  return out
}

export function moveAnnot(a: PdfAnnot, dx: number, dy: number): PdfAnnot {
  return mapAnnot(a, ([x, y]) => [x + dx, y + dy])
}

/**
 * Keep annotations on the same spot of the content when their page turns by
 * `delta` degrees (clockwise). `before` is the page as it was.
 */
export function rotateAnnot(a: PdfAnnot, delta: number, before: PdfPageInfo): PdfAnnot {
  const d = ((Math.round(delta / 90) * 90) % 360 + 360) % 360
  if (!d) return a
  const { x: ox, y: oy, width: w, height: h } = before
  const f = ([x, y]: Pt): Pt => {
    const u = x - ox
    const v = y - oy
    if (d === 90) return [ox + (h - v), oy + u]
    if (d === 180) return [ox + (w - u), oy + (h - v)]
    return [ox + v, oy + (w - u)]
  }
  if (a.kind === 'note' || a.kind === 'text' || a.kind === 'image') {
    // These stay upright: their box moves with the content, its size stays.
    const b = a.kind === 'note' ? noteRect(a) : a.rect!
    const c = f([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
    const hw = (b[2] - b[0]) / 2
    const hh = (b[3] - b[1]) / 2
    return { ...a, rect: [c[0] - hw, c[1] - hh, c[0] + hw, c[1] + hh] }
  }
  return mapAnnot(a, f)
}

// ------------------------------------------------------------- free text

let measureCtx: CanvasRenderingContext2D | null = null

export function fontFamilyFor(font?: string): string {
  if (font === 'TiRo' || font === 'TiRoman' || font === 'Times') return '"Times New Roman", Times, serif'
  if (font === 'Cour' || font === 'Courier') return '"Courier New", Courier, monospace'
  return 'Helvetica, Arial, sans-serif'
}

/** Width of `text` in points at `size`. */
export function textWidth(text: string, size: number, font?: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * size * 0.55
  measureCtx.font = `${size * 10}px ${fontFamilyFor(font)}`
  return measureCtx.measureText(text).width / 10
}

/** Lines as MuPDF lays out a FreeText box: wrapped at `maxWidth` (if given). */
export function layoutText(text: string, size: number, font?: string, maxWidth?: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!maxWidth || textWidth(para, size, font) <= maxWidth) {
      out.push(para)
      continue
    }
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && textWidth(next.trimEnd(), size, font) > maxWidth) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line = next
    }
    out.push(line)
  }
  return out
}

/** MuPDF: first baseline 0.8 em below the top, 1.2 em between lines, no inner margin. */
export const TEXT_ASCENT = 0.8
export const TEXT_LEADING = 1.2

/** A box that fits `text` without wrapping, top-left at (x, y). */
export function fitTextRect(x: number, y: number, text: string, size: number, font?: string): PdfRect {
  const lines = text.split('\n')
  const w = Math.max(size * 2, ...lines.map((l) => textWidth(l, size, font)))
  return [x, y, x + w * 1.03 + 2, y + Math.max(1, lines.length) * size * TEXT_LEADING + size * 0.3]
}

/** Parse "1-3, 5, 9-" style page ranges (1-based) into sorted 0-based indices. */
export function parsePageRange(text: string, count: number): number[] {
  const out = new Set<number>()
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim()
    if (!part) continue
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part)
    if (m) {
      let a = m[1] ? parseInt(m[1], 10) : 1
      let b = m[2] ? parseInt(m[2], 10) : count
      if (a > b) [a, b] = [b, a]
      for (let n = Math.max(1, a); n <= Math.min(count, b); n++) out.add(n - 1)
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10)
      if (n >= 1 && n <= count) out.add(n - 1)
    }
  }
  return [...out].sort((x, y) => x - y)
}
