// Pure helpers for KhervePDF (no DOM, no PDF engine) — tested by
// tools/tests/khervepdf.test.ts.

import type { PdfRect, PdfWord } from '@/os/services/pdf'

/** 100 % zoom = the desktop's 144 dpi base: two CSS pixels per PDF point. */
export const ZOOM_BASE = 144 / 72

/** The zoom combo's presets (MainWindow._build_toolbar). */
export const ZOOM_ITEMS = ['Fit Width', '50%', '75%', '100%', '125%', '150%', '200%', '300%', '400%']

/** MainWindow._apply_zoom_combo: "Fit…" → 'fit'; "150", "150 %", "150%" → 1.5; else null. */
export function parseZoomText(text: string): 'fit' | number | null {
  const t = text.trim()
  if (t.toLowerCase().startsWith('fit')) return 'fit'
  const v = Number(t.replace(/[%\s]+$/, '').trim())
  if (!t || !Number.isFinite(v) || v <= 0) return null
  return Math.max(0.1, Math.min(8, v / 100))
}

/** MainWindow._sync_zoom_combo: what the combo shows. */
export function zoomComboText(autoFit: boolean, percent: number): string {
  return autoFit ? 'Fit Width' : `${Math.round(percent)}%`
}

/** Move item `from` so it lands at index `to` (tab reordering). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice()
  if (from < 0 || from >= out.length) return out
  const [x] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x)
  return out
}

/** The short base-14 name and style for a font name found in a PDF ("ABCDEF+Times-BoldItalic"). */
export function fontStyleOf(name: string | undefined): { font: 'Helv' | 'TiRo' | 'Cour'; bold: boolean; italic: boolean } {
  const n = (name ?? '').replace(/^[A-Z]{6}\+/, '')
  const low = n.toLowerCase()
  const font = /times|roman|serif|georgia|garamond|cambria|minion|palatino|book/.test(low) && !/sans/.test(low)
    ? 'TiRo'
    : /courier|mono|consol/.test(low) ? 'Cour' : 'Helv'
  return { font, bold: /bold|black|heavy|semibold|demi/.test(low), italic: /italic|oblique/.test(low) }
}

export interface Paragraph {
  page: number
  /** Indices into the page's words. */
  words: number[]
  rect: PdfRect
  /** One rectangle per line (what is erased). */
  lines: PdfRect[]
  size: number
  fontName: string
  color: string
  align: 'left' | 'center' | 'right' | 'justify'
}

function union(rs: PdfRect[]): PdfRect {
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))]
}

/** Rectangles of runs of words that share a line. */
export function lineBoxes(words: PdfWord[]): PdfRect[] {
  const out: PdfRect[] = []
  let cur: PdfRect | null = null
  let line = -1
  for (const w of words) {
    if (cur && w.line === line) cur = union([cur, w.rect])
    else {
      if (cur) out.push(cur)
      cur = [...w.rect] as PdfRect
      line = w.line
    }
  }
  if (cur) out.push(cur)
  return out
}

function mostCommon<T>(xs: T[], fallback: T): T {
  const n = new Map<T, number>()
  let best = fallback
  let bestN = 0
  for (const x of xs) {
    const k = (n.get(x) ?? 0) + 1
    n.set(x, k)
    if (k > bestN) [best, bestN] = [x, k]
  }
  return best
}

/**
 * The paragraph under a point (pdftab._find_text_block_detailed): the words of
 * the text block under it, split into paragraphs at a vertical gap larger than
 * a line, keeping the one that contains the point.
 */
export function paragraphAt(words: PdfWord[], page: number, x: number, y: number, slop = 2): Paragraph | null {
  const hit = words.findIndex((w) => x >= w.rect[0] - slop && x <= w.rect[2] + slop && y >= w.rect[1] - slop && y <= w.rect[3] + slop)
  let idx = hit
  if (idx < 0) {
    // Between the words of a block: the block whose box holds the point.
    const blocks = new Map<number, number[]>()
    words.forEach((w, i) => blocks.set(w.block ?? w.line, [...(blocks.get(w.block ?? w.line) ?? []), i]))
    for (const ids of blocks.values()) {
      const r = union(ids.map((i) => words[i].rect))
      if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) {
        idx = ids[0]
        break
      }
    }
    if (idx < 0) return null
  }
  const block = words[idx].block ?? words[idx].line
  const ids = words.map((_, i) => i).filter((i) => (words[i].block ?? words[i].line) === block)
  // Split the block where the gap between two lines is bigger than a line height.
  const groups: number[][] = []
  let lineNo = -1
  let lineTop = 0
  let lineBottom = -Infinity
  let prevBottom = -Infinity
  for (const i of ids) {
    const w = words[i]
    if (w.line !== lineNo) {
      if (lineNo >= 0) prevBottom = lineBottom
      lineNo = w.line
      lineTop = w.rect[1]
      lineBottom = w.rect[3]
      const h = w.rect[3] - w.rect[1]
      if (!groups.length || lineTop - prevBottom > h * 0.9) groups.push([])
    } else lineBottom = Math.max(lineBottom, w.rect[3])
    groups[groups.length - 1].push(i)
  }
  const group = groups.find((g) => g.includes(idx)) ?? ids
  const ws = group.map((i) => words[i])
  const lines = lineBoxes(ws)
  const rect = union(lines)
  const size = mostCommon(ws.map((w) => Math.round((w.size ?? (w.rect[3] - w.rect[1]) / 1.2) * 2) / 2), 11)
  return {
    page, words: group, rect, lines, size,
    fontName: mostCommon(ws.map((w) => w.font ?? ''), ''),
    color: mostCommon(ws.map((w) => w.color ?? '#000000'), '#000000'),
    align: detectAlign(lines, rect, size),
  }
}

/** pdftab._detect_alignment: from how the line edges line up. */
export function detectAlign(lines: PdfRect[], rect: PdfRect, size: number): Paragraph['align'] {
  if (lines.length < 2) return 'left'
  const tol = size * 0.6
  const body = lines.slice(0, -1)
  const leftOk = body.every((l) => Math.abs(l[0] - rect[0]) < tol)
  const rightOk = body.every((l) => Math.abs(l[2] - rect[2]) < tol)
  if (leftOk && rightOk) return 'justify'
  if (leftOk) return 'left'
  if (rightOk) return 'right'
  const mid = (rect[0] + rect[2]) / 2
  if (lines.every((l) => Math.abs((l[0] + l[2]) / 2 - mid) < tol)) return 'center'
  return 'left'
}

/**
 * The text of some words. Line breaks are kept when `preserveBreaks`;
 * otherwise lines are joined with spaces and a hyphen at a line end is
 * dropped ("flex- ibility" → "flexibility").
 */
export function wordsText(words: PdfWord[], preserveBreaks = false): string {
  let out = ''
  words.forEach((w, i) => {
    if (i) {
      const newLine = w.line !== words[i - 1].line
      if (newLine && preserveBreaks) out += '\n'
      else if (newLine && /[A-Za-z]-$/.test(out)) out = out.slice(0, -1)
      else out += ' '
    }
    out += w.text
  })
  return out
}

/** Unix seconds → "2026-10-08 14:05" (history_dialog). */
export function formatCommitTime(seconds: number): string {
  const d = new Date(seconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The path of a file relative to a repository root, or null when it is not inside. */
export function relativeTo(root: string, file: string): string | null {
  const r = root.replace(/\/+$/, '')
  return file.startsWith(r + '/') ? file.slice(r.length + 1) : null
}
